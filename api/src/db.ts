import mongoose from 'mongoose';
import { config } from './config.js';
import { logger } from './logger.js';

export type DbState = 'connected' | 'down' | 'not_configured';

mongoose.set('bufferCommands', false);
mongoose.set('strictQuery', true);

let retryTimer: NodeJS.Timeout | null = null;

async function tryConnect(): Promise<void> {
  try {
    await mongoose.connect(config.mongoUrl, { serverSelectionTimeoutMS: 3000, dbName: 'leakdesk' });
    logger.info('mongo connected');
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'mongo unavailable; retrying in 5 s, analyses run in memory');
    retryTimer = setTimeout(() => void tryConnect(), 5000);
    retryTimer.unref();
  }
}

export async function connectDb(): Promise<void> {
  if (!config.mongoUrl) {
    logger.info('MONGO_URL not set; using in-memory store');
    return;
  }
  await tryConnect();
}

export function dbState(): DbState {
  if (!config.mongoUrl) return 'not_configured';
  return mongoose.connection.readyState === 1 ? 'connected' : 'down';
}

export async function closeDb(): Promise<void> {
  if (retryTimer) clearTimeout(retryTimer);
  await mongoose.disconnect();
}
