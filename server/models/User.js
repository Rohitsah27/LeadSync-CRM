import mongoose from 'mongoose';
import { tenantScope } from './plugins/tenantScope.js';

// Ordered from least to most privileged; a role's index is its rank.
export const USER_ROLES = ['member', 'admin', 'owner'];

const userSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      unique: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: USER_ROLES, default: 'member' },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    passwordChangedAt: { type: Date },
  },
  { timestamps: true },
);

userSchema.plugin(tenantScope);

export const User = mongoose.model('User', userSchema);
