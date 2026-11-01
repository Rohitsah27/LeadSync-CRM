import mongoose from 'mongoose';
import { tenantScope } from './plugins/tenantScope.js';

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost'];
export const LEAD_SOURCES = ['facebook_lead_ads', 'facebook_organic'];

const customFieldSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, maxlength: 200 },
    value: { type: String, maxlength: 2000 },
  },
  { _id: false },
);

// One person who filled in a Facebook form. Name, email and phone are stored readable so they can
// be searched; the complete original Facebook response is kept encrypted and never returned.
const leadSchema = new mongoose.Schema(
  {
    pageId: { type: String, required: true },
    pageName: { type: String, maxlength: 200 },
    formId: { type: String, required: true },
    formName: { type: String, maxlength: 300 },
    facebookLeadId: { type: String, required: true },
    fullName: { type: String, trim: true, maxlength: 200 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, trim: true, maxlength: 50 },
    customFields: { type: [customFieldSchema], default: [] },
    leadStatus: { type: String, enum: LEAD_STATUSES, default: 'new' },
    createdTime: { type: Date, required: true },
    source: { type: String, enum: LEAD_SOURCES, default: 'facebook_lead_ads' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rawPayloadCipher: { type: String, select: false },
    syncedAt: { type: Date },
  },
  { timestamps: true },
);

leadSchema.plugin(tenantScope);
// The same Facebook lead can only ever be stored once per workspace.
leadSchema.index({ workspaceId: 1, facebookLeadId: 1 }, { unique: true });
leadSchema.index({ workspaceId: 1, createdTime: -1, _id: -1 });
leadSchema.index({ workspaceId: 1, leadStatus: 1, createdTime: -1 });
leadSchema.index({ workspaceId: 1, formId: 1, createdTime: -1 });

export const Lead = mongoose.model('Lead', leadSchema);
