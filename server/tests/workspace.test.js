import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { User } from '../models/User.js';
import { Workspace } from '../models/Workspace.js';
import { hashPassword } from '../services/password.service.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/db.js';

const app = createApp();
const API = '/api/v1';
const MEMBER_PASSWORD = 'member-password-1';

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function signUp(email, businessName) {
  const res = await request(app)
    .post(`${API}/auth/register`)
    .send({ name: 'Owner Person', businessName, email, password: 'owner-password-123' });

  return { token: res.body.accessToken, user: res.body.user, workspace: res.body.workspace };
}

/** Adds a teammate directly (invitations arrive later) and returns their session token. */
async function addMember(workspaceId, { email, role = 'member', name = 'Team Mate' }) {
  const user = await User.inWorkspace(workspaceId).create({
    name,
    email,
    role,
    passwordHash: await hashPassword(MEMBER_PASSWORD),
  });
  const res = await request(app)
    .post(`${API}/auth/login`)
    .send({ email, password: MEMBER_PASSWORD });

  return { user, token: res.body.accessToken };
}

let acme;
let globex;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  acme = await signUp('owner@acme.example', 'Acme Realty');
  globex = await signUp('owner@globex.example', 'Globex Autos');
});

describe('GET /workspace', () => {
  it('requires authentication', async () => {
    expect((await request(app).get(`${API}/workspace`)).status).toBe(401);
  });

  it('returns the caller’s workspace, role and member count', async () => {
    const res = await request(app).get(`${API}/workspace`).set(bearer(acme.token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      workspace: { id: acme.workspace.id, name: 'Acme Realty' },
      memberCount: 1,
      role: 'owner',
    });
  });

  it('counts only members of the caller’s own workspace', async () => {
    await addMember(acme.workspace.id, { email: 'a2@acme.example' });
    await addMember(acme.workspace.id, { email: 'a3@acme.example' });

    const acmeRes = await request(app).get(`${API}/workspace`).set(bearer(acme.token));
    const globexRes = await request(app).get(`${API}/workspace`).set(bearer(globex.token));

    expect(acmeRes.body.memberCount).toBe(3);
    expect(globexRes.body.memberCount).toBe(1);
  });
});

describe('PATCH /workspace', () => {
  const rename = (token, body) =>
    request(app).patch(`${API}/workspace`).set(bearer(token)).send(body);

  it('lets the owner rename the workspace', async () => {
    const res = await rename(acme.token, { name: '  Acme Properties  ' });

    expect(res.status).toBe(200);
    expect(res.body.workspace.name).toBe('Acme Properties');
    expect((await Workspace.findById(acme.workspace.id)).name).toBe('Acme Properties');
  });

  it('lets an admin rename it', async () => {
    const admin = await addMember(acme.workspace.id, {
      email: 'admin@acme.example',
      role: 'admin',
    });

    expect((await rename(admin.token, { name: 'Renamed By Admin' })).status).toBe(200);
  });

  it('forbids plain members, and checks the role before the body', async () => {
    const member = await addMember(acme.workspace.id, { email: 'member@acme.example' });

    const res = await rename(member.token, { name: 'Hijacked' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    const invalidBody = await rename(member.token, { name: '' });
    expect(invalidBody.status).toBe(403);

    expect((await Workspace.findById(acme.workspace.id)).name).toBe('Acme Realty');
  });

  it('applies a demotion on the very next request', async () => {
    const admin = await addMember(acme.workspace.id, {
      email: 'admin@acme.example',
      role: 'admin',
    });
    expect((await rename(admin.token, { name: 'First Rename' })).status).toBe(200);

    await User.inWorkspace(acme.workspace.id).updateOne(
      { _id: admin.user._id },
      { role: 'member' },
    );

    expect((await rename(admin.token, { name: 'Second Rename' })).status).toBe(403);
  });

  it('requires authentication', async () => {
    expect((await request(app).patch(`${API}/workspace`).send({ name: 'Anything' })).status).toBe(
      401,
    );
  });

  it.each([
    ['too short', { name: 'A' }],
    ['too long', { name: 'x'.repeat(101) }],
    ['missing', {}],
    ['not a string', { name: 42 }],
  ])('rejects a name that is %s', async (_label, body) => {
    const res = await rename(acme.token, body);

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('name');
  });

  it('cannot be pointed at another workspace through the body, query or headers', async () => {
    const res = await request(app)
      .patch(`${API}/workspace?workspaceId=${globex.workspace.id}&id=${globex.workspace.id}`)
      .set(bearer(acme.token))
      .set('X-Workspace-Id', globex.workspace.id)
      .send({
        name: 'Acme Renamed',
        id: globex.workspace.id,
        workspaceId: globex.workspace.id,
        ownerId: globex.user.id,
      });

    expect(res.status).toBe(200);
    expect(res.body.workspace.id).toBe(acme.workspace.id);

    const acmeAfter = await Workspace.findById(acme.workspace.id);
    const globexAfter = await Workspace.findById(globex.workspace.id);
    expect(acmeAfter.name).toBe('Acme Renamed');
    expect(String(acmeAfter.ownerId)).toBe(acme.user.id);
    expect(globexAfter.name).toBe('Globex Autos');
  });
});

describe('members', () => {
  it('lists only the caller’s workspace, oldest first, without secrets', async () => {
    await addMember(acme.workspace.id, { email: 'a2@acme.example', name: 'Second Person' });
    await addMember(globex.workspace.id, { email: 'g2@globex.example', name: 'Globex Second' });

    const res = await request(app).get(`${API}/workspace/members`).set(bearer(acme.token));

    expect(res.status).toBe(200);
    expect(res.body.members.map((m) => m.email)).toEqual(['owner@acme.example', 'a2@acme.example']);
    expect(res.body.members[0]).toMatchObject({ role: 'owner', isActive: true });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|globex/i);
  });

  it('is visible to plain members and shows deactivated colleagues', async () => {
    const member = await addMember(acme.workspace.id, { email: 'member@acme.example' });
    const gone = await addMember(acme.workspace.id, { email: 'gone@acme.example' });
    await User.inWorkspace(acme.workspace.id).updateOne(
      { _id: gone.user._id },
      { isActive: false },
    );

    const res = await request(app).get(`${API}/workspace/members`).set(bearer(member.token));

    expect(res.status).toBe(200);
    expect(res.body.members.find((m) => m.email === 'gone@acme.example').isActive).toBe(false);
  });

  it('requires authentication', async () => {
    expect((await request(app).get(`${API}/workspace/members`)).status).toBe(401);
  });

  it('returns a single member of the caller’s own workspace', async () => {
    const mate = await addMember(acme.workspace.id, { email: 'a2@acme.example' });

    const res = await request(app)
      .get(`${API}/workspace/members/${mate.user.id}`)
      .set(bearer(acme.token));

    expect(res.status).toBe(200);
    expect(res.body.member).toMatchObject({ id: mate.user.id, email: 'a2@acme.example' });
  });

  it('reports members of other workspaces as not found, in both directions', async () => {
    const forAcme = await request(app)
      .get(`${API}/workspace/members/${globex.user.id}`)
      .set(bearer(acme.token));
    const forGlobex = await request(app)
      .get(`${API}/workspace/members/${acme.user.id}`)
      .set(bearer(globex.token));

    for (const res of [forAcme, forGlobex]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(JSON.stringify(res.body)).not.toMatch(/@/);
    }
  });

  it.each([
    ['an unknown id', '64b7f0c2a1b2c3d4e5f60718'],
    ['a malformed id', 'abc'],
    ['a short id', '123'],
  ])('returns 404 for %s', async (_label, id) => {
    const res = await request(app).get(`${API}/workspace/members/${id}`).set(bearer(acme.token));

    expect(res.status).toBe(404);
  });
});

describe('tenant isolation of the profile endpoints', () => {
  it('keeps a user in their workspace even when the body names another', async () => {
    const res = await request(app)
      .patch(`${API}/users/me`)
      .set(bearer(acme.token))
      .send({ name: 'Renamed Owner', workspaceId: globex.workspace.id });

    expect(res.status).toBe(200);
    expect(res.body.user.workspaceId).toBe(acme.workspace.id);

    const stored = await User.findById(acme.user.id).unscoped();
    expect(String(stored.workspaceId)).toBe(acme.workspace.id);
    expect(stored.name).toBe('Renamed Owner');
  });

  it('never exposes the other workspace through /users/me', async () => {
    const res = await request(app).get(`${API}/users/me`).set(bearer(acme.token));

    expect(res.body.workspace.id).toBe(acme.workspace.id);
    expect(JSON.stringify(res.body)).not.toMatch(/globex/i);
  });
});
