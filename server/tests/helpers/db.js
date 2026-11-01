import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { inject } from 'vitest';
import { connectDB, disconnectDB } from '../../config/db.js';

export async function connectTestDb() {
  await connectDB(`${inject('mongoUri')}leadsync_${randomUUID().slice(0, 8)}`);
  // Unique indexes must exist before tests rely on them.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}

export async function clearTestDb() {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
}

export async function disconnectTestDb() {
  await mongoose.connection.dropDatabase();
  await disconnectDB();
}
