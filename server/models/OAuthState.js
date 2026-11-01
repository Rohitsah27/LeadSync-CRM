import mongoose from 'mongoose';
import { tenantScope } from './plugins/tenantScope.js';

export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

// One row per in-flight "Connect Facebook" attempt. Only a hash of the state is stored, and the
// row is deleted when the callback consumes it, so each state works once.
const oauthStateSchema = new mongoose.Schema({
  stateHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now, expires: OAUTH_STATE_TTL_SECONDS },
});

oauthStateSchema.plugin(tenantScope);

export const OAuthState = mongoose.model('OAuthState', oauthStateSchema);
