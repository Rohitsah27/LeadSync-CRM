import mongoose from 'mongoose';
import { tenantScope } from './plugins/tenantScope.js';

export const SYNC_STATUSES = ['ok', 'partial', 'permission', 'rate_limited', 'invalid', 'error'];

const questionSchema = new mongoose.Schema(
  {
    key: { type: String, maxlength: 200 },
    label: { type: String, maxlength: 500 },
    type: { type: String, maxlength: 100 },
  },
  { _id: false },
);

// A Facebook Lead Ads form on one of the workspace's connected Pages, plus where its lead sync
// has got to. Deleted when its Page is disconnected; the leads it produced are kept.
const leadFormSchema = new mongoose.Schema(
  {
    pageId: { type: String, required: true },
    formId: { type: String, required: true },
    name: { type: String, trim: true, maxlength: 300 },
    status: { type: String, maxlength: 50 },
    locale: { type: String, maxlength: 50 },
    questions: { type: [questionSchema], default: [] },
    facebookLeadsCount: { type: Number, default: null },
    facebookCreatedTime: { type: Date, default: null },

    syncEnabled: { type: Boolean, default: true },
    // While false, a sync resumes from `backfillCursor` and reads every lead; once true, a sync
    // only reads from the newest lead back to the first one it already has.
    backfillComplete: { type: Boolean, default: false },
    backfillCursor: { type: String, default: null },
    syncingSince: { type: Date, default: null },
    lastSyncedAt: { type: Date, default: null },
    lastSyncStatus: { type: String, enum: SYNC_STATUSES, default: null },
    lastSyncMessage: { type: String, maxlength: 500, default: null },
  },
  { timestamps: true },
);

leadFormSchema.plugin(tenantScope);
leadFormSchema.index({ workspaceId: 1, formId: 1 }, { unique: true });
leadFormSchema.index({ workspaceId: 1, pageId: 1 });

export const LeadForm = mongoose.model('LeadForm', leadFormSchema);
