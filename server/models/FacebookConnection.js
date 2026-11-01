import mongoose from 'mongoose';
import { tenantScope } from './plugins/tenantScope.js';

export const CONNECTION_STATUSES = ['active', 'expired', 'revoked', 'error'];

// A Facebook account a workspace has authorized. The access token is stored encrypted
// (see services/tokenCrypto.js) and is never selected by default.
const facebookConnectionSchema = new mongoose.Schema(
  {
    facebookUserId: { type: String, required: true },
    name: { type: String, trim: true, maxlength: 200 },
    userTokenCipher: { type: String, select: false },
    tokenExpiresAt: { type: Date, default: null },
    dataAccessExpiresAt: { type: Date, default: null },
    grantedScopes: { type: [String], default: [] },
    status: { type: String, enum: CONNECTION_STATUSES, default: 'active' },
    statusReason: { type: String, maxlength: 300, default: null },
    lastVerifiedAt: { type: Date, default: null },
    connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

facebookConnectionSchema.plugin(tenantScope);
facebookConnectionSchema.index({ workspaceId: 1, facebookUserId: 1 }, { unique: true });
// Used by Meta's deauthorize callback, which identifies only the Facebook user.
facebookConnectionSchema.index({ facebookUserId: 1 });

export const FacebookConnection = mongoose.model('FacebookConnection', facebookConnectionSchema);
