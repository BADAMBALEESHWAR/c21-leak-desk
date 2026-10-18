import { randomUUID } from 'node:crypto';
import compression from 'compression';
import express, { Router } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { authFromEnv, authMiddleware, type AuthSettings } from './auth.js';
import { oauthFromEnv, type OAuthSettings } from './auth-oauth.js';
import { auditTrail } from './audit.js';
import { ENGINE_VERSION } from './engine/types.js';
import { errorHandler, HttpError } from './errors.js';
import { logger } from './logger.js';
import { analysesRouter } from './routes/analyses.js';
import { authRouter } from './routes/auth.js';
import { checksRouter } from './routes/checks.js';
import { datasetsRouter } from './routes/datasets.js';
import { decisionsRouter } from './routes/decisions.js';
import { healthRouter } from './routes/health.js';
import { i18nRouter } from './routes/i18n.js';
import { pulseRouter } from './routes/pulse.js';
import { scenariosRouter } from './routes/scenarios.js';
import { accountRouter } from './routes/account.js';
import { importRouter } from './routes/import.js';
import { advisorRouter } from './routes/advisor.js';
import { aiRouter } from './routes/ai.js';
import { askRouter } from './routes/ask.js';
import { autopilotRouter } from './routes/autopilot.js';
import { digestRouter } from './routes/digest.js';

/** CORS: the CloudFront origin(s) in CORS_ORIGIN plus localhost for development (§17). */
function allowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  const list = (process.env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes(origin)) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

export function createApp(options: { auth?: AuthSettings; oauth?: OAuthSettings } = {}) {
  const auth = options.auth ?? authFromEnv();
  const oauth = options.oauth ?? oauthFromEnv();
  const app = express();
  app.locals.auth = auth;
  app.disable('x-powered-by');
  // HSTS for a year, subdomains included (helmet's default is 180 days); the other helmet headers unchanged.
  app.use(helmet({ strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true } }));
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
        // Sign-in callbacks carry a one-time code and state in the query string: never logged.
        req: (req: { id: unknown; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url.replace(/([?&](?:code|state)=)[^&]*/g, '$1[redacted]') }),
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
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-Id, Authorization, X-Profyn-AI');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'x-request-id, x-engine-version, Content-Disposition');
    }
    if (req.method === 'OPTIONS') return void res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: config.maxBodyBytes }));
  app.use(authMiddleware(auth, oauth));
  app.use(auditTrail);

  const api = Router();
  api.use(healthRouter);
  api.use(authRouter(auth, oauth));
  api.use(accountRouter(oauth));
  api.use(importRouter);
  api.use(checksRouter);
  api.use(i18nRouter);
  api.use(datasetsRouter);
  api.use(analysesRouter);
  api.use(scenariosRouter);
  api.use(decisionsRouter);
  api.use(pulseRouter);
  // v2 AI endpoints: Autopilot, Fix Advisor, Ask Profyn, Digest, AI status.
  api.use(autopilotRouter);
  api.use(advisorRouter);
  api.use(askRouter);
  api.use(digestRouter);
  api.use(aiRouter);
  app.use('/api/v1', api);

  app.use((req, _res, next) => next(new HttpError(404, 'not_found', `No route for ${req.method} ${req.path}.`)));
  app.use(errorHandler);
  return app;
}
