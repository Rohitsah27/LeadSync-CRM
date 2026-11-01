import bcrypt from 'bcrypt';
import { env } from '../config/env.js';

// Checked when no user matches, so response time does not reveal which emails are registered.
const decoyHash = bcrypt.hash('decoy-password-for-timing', env.auth.bcryptRounds);

export function hashPassword(plain) {
  return bcrypt.hash(plain, env.auth.bcryptRounds);
}

export async function verifyPassword(plain, hash) {
  if (!hash) {
    await bcrypt.compare(plain, await decoyHash);
    return false;
  }
  return bcrypt.compare(plain, hash);
}
