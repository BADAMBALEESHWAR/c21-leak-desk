import { createApp } from './app.js';
import { config } from './config.js';
import { closeDb, connectDb } from './db.js';
import { logger } from './logger.js';

async function main() {
  await connectDb();
  const server = createApp().listen(config.port, () => {
    logger.info({ port: config.port, data_dir: config.dataDir, ai: config.aiDisabled ? 'disabled' : 'enabled' }, 'leakdesk api listening');
  });
  const stop = () => {
    server.close(() => void closeDb().finally(() => process.exit(0)));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

void main();
