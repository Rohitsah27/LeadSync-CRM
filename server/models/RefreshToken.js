import mongoose from 'mongoose';

// Only a SHA-256 hash of each refresh token is stored. Tokens rotate on every use and belong
// to a family, so replaying an already-rotated token can revoke the whole login session.
const refreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    familyId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    rotatedAt: { type: Date, default: null },
    replacedById: { type: mongoose.Schema.Types.ObjectId, default: null },
    userAgent: { type: String, maxlength: 300 },
    ip: { type: String, maxlength: 64 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
