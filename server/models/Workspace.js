import mongoose from 'mongoose';

const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true },
);

export const Workspace = mongoose.model('Workspace', workspaceSchema);
