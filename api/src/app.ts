import { randomUUID } from 'node:crypto';
import compression from 'compression';
import express, { Router } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { ENGINE_VERSION } from './engine/types.js';
import { errorHandler, HttpError } from './errors.js';
import { logger } from './logger.js';
import { analysesRouter } from './routes/analyses.js';
import { checksRouter } from './routes/checks.js';
import { datasetsRouter } from './routes/datasets.js';
import { decisionsRouter } from './routes/decisions.js';
import { healthRouter } from './routes/health.js';
import { scenariosRouter } from './routes/scenarios.js';

/** CORS: the CloudFront origin(s) in CORS_ORIGIN plus localhost for development (§17). */
function allowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  const list = (process.env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes(origin)) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  // Large analyses (10,000 orders ≈ 16 MB of JSON) compress roughly tenfold.
  app.use(compression({ threshold: 2048 }));
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string) || randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      customProps: (req) => ({ request_id: req.id }),
      // No headers in logs: they can carry tokens, and CloudWatch keeps everything.
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
    }),
  );
  app.use((req, res, next) => {
    res.setHeader('x-engine-version', ENGINE_VERSION);
    const origin = allowedOrigin(req.headers.origin);
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'x-request-id, x-engine-version, Content-Disposition');
    }
    if (req.method === 'OPTIONS') return void res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: config.maxBodyBytes }));

  const api = Router();
  api.use(healthRouter);
  api.use(checksRouter);
  api.use(datasetsRouter);
  api.use(analysesRouter);
  api.use(scenariosRouter);
  api.use(decisionsRouter);
  app.use('/api/v1', api);

  app.use((req, _res, next) => next(new HttpError(404, 'not_found', `No route for ${req.method} ${req.path}.`)));
  app.use(errorHandler);
  return app;
}
