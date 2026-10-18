import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from './logger.js';
import { AuditEventModel } from './models/index.js';
import { SmallStore } from './platform-store.js';
import { newId } from './repo.js';

// Per-account audit log (Trust §5.2): imports, AI calls, decisions, exports, sign-ins, consent changes. Owners read it
// at GET /me/audit. The shared demo workspace (guests) keeps no log: nothing in it belongs to anyone.

export type AuditKind = 'import' | 'ai_call' | 'decision' | 'export' | 'login' | 'consent' | 'mapping';

export interface AuditEvent {
  _id: string;
  account: string;
  at: Date;
  kind: AuditKind;
  detail: Record<string, unknown>;
}

/**
 * What to record. `detail` and any other fields are merged, so both of these work:
 *   audit.record(req, { kind: 'ai_call', detail: { feature: 'advisor', model, fields_sent: [...], accepted: true } })
 *   audit.record(req, { kind: 'ai_call', feature: 'advisor', model, fields_sent: [...], accepted: false, reason: 'guard' })
 * For an AI call, send: feature, model, fields_sent (names only, never values), accepted (boolean), reason?.
 */
export type AuditInput = { kind: AuditKind; detail?: Record<string, unknown> } & Record<string, unknown>;

const store = new SmallStore<AuditEvent>('audit', AuditEventModel, 20000);
// Same rule as auth.ts accountOf (not imported: auth.ts records sign-ins here).
const GUEST = 'guest';
const accountOf = (user: { sub: string } | undefined) => user?.sub ?? GUEST;

/** Keeps detail small and value-free where it matters: long strings are cut, nested objects kept as they are. */
function clean(detail: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(detail).map(([k, v]) => [k, typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v]));
}

async function recordFor(account: string, input: AuditInput): Promise<void> {
  if (!account || account === GUEST) return;
  try {
    const { kind, detail, ...rest } = input;
    await store.put({ _id: newId(), account, at: new Date(), kind, detail: clean({ ...(detail ?? {}), ...rest }) });
  } catch (err) {
    logger.warn({ err: (err as Error).message, kind: input.kind }, 'audit write failed');
  }
}

export const audit = {
  /** Records an event for the signed-in caller; a guest request records nothing. Never throws. */
  record: (req: Pick<Request, 'user'>, input: AuditInput): Promise<void> => recordFor(accountOf(req.user), input),
  /** For events without a request user yet (a sign-in callback). */
  recordFor,
  /** Newest first. */
  list: (account: string, limit = 200) => store.find({ account }, 'at', limit),
  all: (account: string) => store.find({ account }, 'at', 0, true),
  remove: (account: string) => store.remove({ account }),
};

/** Routes owned by other modules that belong in the log, matched once the response has gone out successfully. */
const TRAIL: Array<{ method: string; re: RegExp; kind: AuditKind; detail: (m: RegExpExecArray, req: Request) => Record<string, unknown> }> = [
  { method: 'POST', re: /^\/api\/v1\/analyses\/([^/]+)\/decisions$/, kind: 'decision', detail: (m) => ({ analysis_id: m[1] }) },
  { method: 'GET', re: /^\/api\/v1\/decisions\/([^/]+)\/export$/, kind: 'export', detail: (m, req) => ({ what: 'decision', decision_id: m[1], format: req.query.format ?? null }) },
  { method: 'GET', re: /^\/api\/v1\/analyses\/([^/]+)\/export$/, kind: 'export', detail: (m, req) => ({ what: 'ledger', analysis_id: m[1], format: req.query.format ?? null }) },
];

/** Logs decisions and exports made by signed-in owners, without touching the routes that serve them. */
export const auditTrail: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const path = (req.originalUrl || req.url).split('?')[0];
  const hit = TRAIL.find((x) => x.method === req.method && x.re.test(path));
  if (hit) {
    res.on('finish', () => {
      if (res.statusCode >= 400 || !req.user) return;
      void recordFor(accountOf(req.user), { kind: hit.kind, detail: hit.detail(hit.re.exec(path)!, req) });
    });
  }
  next();
};
