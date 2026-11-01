import mongoose from 'mongoose';
import { tenantScope } from './plugins/tenantScope.js';

export const PAGE_STATUSES = ['active', 'invalid'];

// A Facebook Page a workspace chose to receive leads from. The Page access token is stored
// encrypted and is never selected by default. `invalid` means the token is gone and the Page
// needs its Facebook connection reconnected.
const facebookPageSchema = new mongoose.Schema(
  {
    connectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FacebookConnection',
      required: true,
    },
    pageId: { type: String, required: true },
    name: { type: String, trim: true, maxlength: 200 },
    category: { type: String, trim: true, maxlength: 200 },
    pictureUrl: { type: String, maxlength: 2000 },
    tasks: { type: [String], default: [] },
    pageTokenCipher: { type: String, select: false },
    tokenExpiresAt: { type: Date, default: null },
    status: { type: String, enum: PAGE_STATUSES, default: 'active' },
    statusReason: { type: String, maxlength: 300, default: null },
    lastVerifiedAt: { type: Date, default: null },
    connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

facebookPageSchema.plugin(tenantScope);
// A Page feeds one workspace at a time, so webhook events can be routed by Page id alone.
facebookPageSchema.index({ pageId: 1 }, { unique: true });
facebookPageSchema.index({ workspaceId: 1, connectionId: 1 });

export const FacebookPage = mongoose.model('FacebookPage', facebookPageSchema);
