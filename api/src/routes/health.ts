import { Router } from 'express';
import { aiStatus } from '../ai/client.js';
import { dbState } from '../db.js';
import { ENGINE_VERSION } from '../engine/types.js';
import { storageKind } from '../storage.js';

export const healthRouter = Router();
const startedAt = Date.now();

healthRouter.get('/health', (_req, res) => {
  const db = dbState();
  res.status(db === 'down' ? 503 : 200).json({
    status: db === 'down' ? 'degraded' : 'ok',
    db: db === 'connected' ? 'ok' : db === 'down' ? 'down' : 'memory',
    ai: aiStatus(),
    storage: storageKind(),
    // Where saved data lives: the AWS region with S3 storage (Mumbai unless AWS_REGION says otherwise), else this machine.
    region: storageKind() === 's3' ? process.env.AWS_REGION || 'ap-south-1' : 'local',
    engine_version: ENGINE_VERSION,
    uptime_s: Math.round((Date.now() - startedAt) / 1000),
  });
});
