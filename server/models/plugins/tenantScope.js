import mongoose from 'mongoose';

/**
 * Tenant isolation for models whose documents belong to a workspace.
 *
 * - Adds a required, indexed `workspaceId` if the schema does not define one.
 * - Fails closed: every find, update, delete or count must filter on a single `workspaceId`,
 *   and an aggregation must start with a `$match` on it. Anything else throws, so a forgotten
 *   filter cannot silently read or change another tenant's data.
 * - A document can never be moved to another workspace through an update.
 * - `Model.inWorkspace(id)` returns the usual query methods with the filter built in.
 * - `.unscoped()` is the explicit, greppable opt-out for lookups made before a workspace is
 *   known, such as signing in by email.
 *
 * Not covered: `bulkWrite` and raw collection access bypass Mongoose middleware.
 */
export class TenantScopeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TenantScopeError';
  }
}

const GUARDED_QUERY_OPS = [
  'countDocuments',
  'deleteMany',
  'deleteOne',
  'distinct',
  'estimatedDocumentCount',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
];
const UPDATING_OPS = new Set([
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
]);
const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

/** True only for a plain id value, so operators like `$ne` or `$in` do not count as scoping. */
function isTenantId(value) {
  return (
    value instanceof mongoose.Types.ObjectId ||
    (typeof value === 'string' && OBJECT_ID_HEX.test(value))
  );
}

function toTenantId(value) {
  if (!isTenantId(value)) throw new TenantScopeError('A valid workspaceId is required');
  return new mongoose.Types.ObjectId(value);
}

function touchesWorkspaceId(update) {
  if (!update || typeof update !== 'object') return false;
  if (Array.isArray(update)) return update.some(touchesWorkspaceId);

  return Object.entries(update).some(([key, value]) => {
    if (key === 'workspaceId') return true;
    if (!key.startsWith('$') || !value || typeof value !== 'object') return false;
    if (key === '$rename')
      return 'workspaceId' in value || Object.values(value).includes('workspaceId');
    return 'workspaceId' in value;
  });
}

export function tenantScope(schema) {
  if (!schema.path('workspaceId')) {
    schema.add({
      workspaceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Workspace',
        required: true,
        index: true,
      },
    });
  }

  schema.pre(GUARDED_QUERY_OPS, { query: true, document: false }, function guardQuery() {
    if (this._tenantUnscoped) return;

    const model = this.model.modelName;
    if (!isTenantId(this.getFilter().workspaceId)) {
      throw new TenantScopeError(
        `${model}.${this.op}() must filter on a single workspaceId. ` +
          `Use ${model}.inWorkspace(id), or add .unscoped() for a deliberate cross-tenant lookup.`,
      );
    }
    if (UPDATING_OPS.has(this.op) && touchesWorkspaceId(this.getUpdate())) {
      throw new TenantScopeError(`${model}.${this.op}() must not change workspaceId.`);
    }
  });

  schema.pre('aggregate', function guardAggregate() {
    const [first] = this.pipeline();
    if (!isTenantId(first?.$match?.workspaceId)) {
      throw new TenantScopeError(
        'Aggregations on tenant models must start with a $match on a single workspaceId.',
      );
    }
  });

  schema.query.unscoped = function unscoped() {
    this._tenantUnscoped = true;
    return this;
  };

  schema.statics.inWorkspace = function inWorkspace(workspaceId) {
    const model = this;
    const id = toTenantId(workspaceId);
    // Spread last so a caller-supplied workspaceId can never override the scope.
    const scope = (filter) => ({ ...filter, workspaceId: id });

    return Object.freeze({
      find: (filter, ...rest) => model.find(scope(filter), ...rest),
      findOne: (filter, ...rest) => model.findOne(scope(filter), ...rest),
      findById: (docId, ...rest) => model.findOne(scope({ _id: docId ?? null }), ...rest),
      exists: (filter) => model.exists(scope(filter)),
      countDocuments: (filter, ...rest) => model.countDocuments(scope(filter), ...rest),
      updateOne: (filter, update, ...rest) => model.updateOne(scope(filter), update, ...rest),
      updateMany: (filter, update, ...rest) => model.updateMany(scope(filter), update, ...rest),
      findOneAndUpdate: (filter, update, ...rest) =>
        model.findOneAndUpdate(scope(filter), update, ...rest),
      deleteOne: (filter, ...rest) => model.deleteOne(scope(filter), ...rest),
      deleteMany: (filter, ...rest) => model.deleteMany(scope(filter), ...rest),
      create: (doc) => model.create({ ...doc, workspaceId: id }),
    });
  };
}
