import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';
import { env } from './env.js';

mongoose.set('strictQuery', true);

mongoose.connection.on('error', (err) => logger.error({ err: err.message }, 'MongoDB error'));
mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));

const STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

export async function connectDB(uri = env.mongodbUri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  // Log only host and database name; the connection string carries credentials.
  logger.info(
    { host: mongoose.connection.host, db: mongoose.connection.name },
    'MongoDB connected',
  );
}

export async function disconnectDB() {
  await mongoose.disconnect();
}

export function dbState() {
  return STATES[mongoose.connection.readyState] ?? 'unknown';
}
