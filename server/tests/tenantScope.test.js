import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TenantScopeError, tenantScope } from '../models/plugins/tenantScope.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/db.js';

// A stand-in for every future tenant model (Lead, FacebookPage, ...).
const widgetSchema = new mongoose.Schema({ name: String, qty: { type: Number, default: 0 } });
widgetSchema.plugin(tenantScope);
const Widget = mongoose.model('TenantWidget', widgetSchema);

const tenantA = new mongoose.Types.ObjectId();
const tenantB = new mongoose.Types.ObjectId();
let a1;
let b1;

// Queries are lazy; wrapping in an async function makes them run so rejections can be asserted.
const run = (build) => (async () => build())();
const names = (docs) => docs.map((doc) => doc.name).sort();

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  [a1, , b1] = await Widget.create([
    { workspaceId: tenantA, name: 'a1' },
    { workspaceId: tenantA, name: 'a2' },
    { workspaceId: tenantB, name: 'b1' },
  ]);
});

describe('fail-closed guard', () => {
  it.each([
    ['find', () => Widget.find()],
    ['find with unrelated filter', () => Widget.find({ name: 'a1' })],
    ['findOne', () => Widget.findOne({ name: 'a1' })],
    ['findById', () => Widget.findById(a1._id)],
    ['exists', () => Widget.exists({ name: 'a1' })],
    ['countDocuments', () => Widget.countDocuments()],
    ['estimatedDocumentCount', () => Widget.estimatedDocumentCount()],
    ['distinct', () => Widget.distinct('name')],
    ['updateOne', () => Widget.updateOne({ _id: a1._id }, { qty: 5 })],
    ['updateMany', () => Widget.updateMany({}, { qty: 5 })],
    ['findOneAndUpdate', () => Widget.findOneAndUpdate({ _id: a1._id }, { qty: 5 })],
    ['findOneAndDelete', () => Widget.findOneAndDelete({ _id: a1._id })],
    ['replaceOne', () => Widget.replaceOne({ _id: a1._id }, { name: 'x' })],
    ['deleteOne', () => Widget.deleteOne({ _id: a1._id })],
    ['deleteMany', () => Widget.deleteMany({})],
  ])('rejects %s without a workspaceId', async (_label, build) => {
    await expect(run(build)).rejects.toThrow(TenantScopeError);
  });

  it('leaves the data untouched when a query is rejected', async () => {
    await expect(run(() => Widget.deleteMany({}))).rejects.toThrow(TenantScopeError);

    expect(await Widget.countDocuments().unscoped()).toBe(3);
  });

  it.each([
    ['$ne', { $ne: tenantA }],
    ['$in across tenants', { $in: [tenantA, tenantB] }],
    ['$exists', { $exists: true }],
    ['null', null],
    ['undefined', undefined],
    ['a malformed id', 'not-an-object-id'],
  ])('rejects a workspaceId filter that is not a single id (%s)', async (_label, value) => {
    await expect(run(() => Widget.find({ workspaceId: value }))).rejects.toThrow(TenantScopeError);
  });

  it('rejects a workspaceId that only appears inside $or', async () => {
    const query = () => Widget.find({ $or: [{ workspaceId: tenantA }, { workspaceId: tenantB }] });

    await expect(run(query)).rejects.toThrow(TenantScopeError);
  });

  it('allows a filter on a single id, as an ObjectId or a hex string', async () => {
    expect(names(await Widget.find({ workspaceId: tenantA }))).toEqual(['a1', 'a2']);
    expect(names(await Widget.find({ workspaceId: tenantA.toString() }))).toEqual(['a1', 'a2']);
  });

  it('lets a deliberate .unscoped() lookup see across tenants', async () => {
    expect(await Widget.find().unscoped()).toHaveLength(3);
    expect(await Widget.countDocuments().unscoped()).toBe(3);
    expect(await Widget.findById(b1._id).unscoped()).toBeTruthy();
  });

  it.each([
    ['a plain field', { workspaceId: tenantB }],
    ['$set', { $set: { workspaceId: tenantB } }],
    ['$unset', { $unset: { workspaceId: '' } }],
    ['$rename onto it', { $rename: { name: 'workspaceId' } }],
    ['a pipeline update', [{ $set: { workspaceId: tenantB } }]],
  ])('refuses to move a document to another workspace via %s', async (_label, update) => {
    const filter = { workspaceId: tenantA, _id: a1._id };

    // Mongoose only accepts pipeline updates with this option; it is harmless for the others.
    const options = { updatePipeline: true };

    await expect(run(() => Widget.updateOne(filter, update, options))).rejects.toThrow(
      TenantScopeError,
    );
    await expect(run(() => Widget.findOneAndUpdate(filter, update, options))).rejects.toThrow(
      TenantScopeError,
    );

    const stored = await Widget.findById(a1._id).unscoped();
    expect(String(stored.workspaceId)).toBe(String(tenantA));
  });

  it('allows ordinary updates on a scoped filter', async () => {
    await Widget.updateOne({ workspaceId: tenantA, _id: a1._id }, { qty: 7 });

    expect((await Widget.findById(a1._id).unscoped()).qty).toBe(7);
  });

  it('requires aggregations to start with a $match on a single workspaceId', async () => {
    const group = { $group: { _id: null, total: { $sum: 1 } } };

    await expect(run(() => Widget.aggregate([group]))).rejects.toThrow(TenantScopeError);
    await expect(run(() => Widget.aggregate([{ $match: { name: 'a1' } }, group]))).rejects.toThrow(
      TenantScopeError,
    );
    await expect(
      run(() =>
        Widget.aggregate([{ $match: { workspaceId: { $in: [tenantA, tenantB] } } }, group]),
      ),
    ).rejects.toThrow(TenantScopeError);
    await expect(
      run(() => Widget.aggregate([group, { $match: { workspaceId: tenantA } }])),
    ).rejects.toThrow(TenantScopeError);

    const [result] = await Widget.aggregate([{ $match: { workspaceId: tenantA } }, group]);
    expect(result.total).toBe(2);
  });

  it('makes workspaceId a required field', async () => {
    await expect(new Widget({ name: 'orphan' }).validate()).rejects.toThrow(/workspaceId/);
  });
});

describe('inWorkspace()', () => {
  it('only reads the workspace it was created for', async () => {
    const scoped = Widget.inWorkspace(tenantA);

    expect(names(await scoped.find())).toEqual(['a1', 'a2']);
    expect((await scoped.findOne({ name: 'a1' })).name).toBe('a1');
    expect(await scoped.findOne({ name: 'b1' })).toBeNull();
    expect(await scoped.countDocuments()).toBe(2);
    expect(await scoped.exists({ name: 'b1' })).toBeNull();
  });

  it('cannot reach another workspace by id', async () => {
    const scoped = Widget.inWorkspace(tenantA);

    expect(await scoped.findById(b1._id)).toBeNull();
    expect((await scoped.findById(a1._id)).name).toBe('a1');
    expect(await scoped.findById(undefined)).toBeNull();
  });

  it('ignores a caller-supplied workspaceId in the filter', async () => {
    const scoped = Widget.inWorkspace(tenantA);

    // The scope wins over whatever the caller passes, so no other tenant's document can appear.
    expect(names(await scoped.find({ workspaceId: tenantB }))).toEqual(['a1', 'a2']);
    expect(names(await scoped.find({ workspaceId: { $ne: tenantA } }))).toEqual(['a1', 'a2']);
    expect(names(await scoped.find({ workspaceId: { $in: [tenantA, tenantB] } }))).toEqual([
      'a1',
      'a2',
    ]);
  });

  it('keeps other conditions ANDed with the scope, including $or', async () => {
    const found = await Widget.inWorkspace(tenantA).find({
      $or: [{ name: 'b1' }, { name: 'a1' }],
    });

    expect(names(found)).toEqual(['a1']);
  });

  it('only updates its own documents', async () => {
    const scoped = Widget.inWorkspace(tenantA);

    expect((await scoped.updateOne({ name: 'b1' }, { qty: 9 })).matchedCount).toBe(0);
    expect(await scoped.findOneAndUpdate({ name: 'b1' }, { qty: 9 })).toBeNull();
    expect((await scoped.updateMany({}, { qty: 1 })).modifiedCount).toBe(2);

    expect((await Widget.findById(b1._id).unscoped()).qty).toBe(0);
  });

  it('only deletes its own documents', async () => {
    const scoped = Widget.inWorkspace(tenantA);

    expect((await scoped.deleteOne({ name: 'b1' })).deletedCount).toBe(0);
    expect((await scoped.deleteMany({})).deletedCount).toBe(2);

    expect(await Widget.find().unscoped()).toHaveLength(1);
    expect(await Widget.findById(b1._id).unscoped()).toBeTruthy();
  });

  it('stamps new documents with its workspace, whatever the caller passes', async () => {
    const created = await Widget.inWorkspace(tenantA).create({
      name: 'new',
      workspaceId: tenantB,
    });

    expect(String(created.workspaceId)).toBe(String(tenantA));
  });

  it('accepts the workspace id as a string', async () => {
    expect(await Widget.inWorkspace(tenantB.toString()).countDocuments()).toBe(1);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a malformed id', 'nope'],
    ['an operator object', { $ne: 1 }],
  ])('refuses to build a scope from %s', (_label, value) => {
    expect(() => Widget.inWorkspace(value)).toThrow(TenantScopeError);
  });
});
