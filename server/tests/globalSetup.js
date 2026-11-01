import { MongoMemoryServer } from 'mongodb-memory-server';

// One in-memory MongoDB for the whole run; each test file uses its own database on it.
export default async function setup({ provide }) {
  const mongod = await MongoMemoryServer.create();
  provide('mongoUri', mongod.getUri());

  return async () => {
    await mongod.stop();
  };
}
