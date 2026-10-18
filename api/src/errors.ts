import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { config } from './config.js';
import { AttributionConflict, OverrideInvalid } from './engine/types.js';
import { messageLang, translate } from './i18n/index.js';

// Error catalogue (Blueprint §16.1). Body: {error:{code, message, path?, hint?, issues?}}.
export type ErrorCode =
  | 'file_too_large'
  | 'unsupported_type'
  | 'schema_invalid'
  | 'no_valid_rows'
  | 'override_invalid'
  | 'not_found'
  | 'attribution_conflict'
  | 'db_unavailable'
  | 'unauthorized'
  | 'invalid_state'
  | 'provider_disabled'
  | 'oauth_failed'
  | 'internal';

export interface Issue {
  path: string;
  message: string;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly extra: { path?: string; hint?: string; issues?: Issue[] } = {},
  ) {
    super(message);
  }
}

/** Express 4 does not forward rejected promises; this does. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): RequestHandler =>
  (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res, next))
      .catch(next);
  };

export const notFound = (what: string, id: string) => new HttpError(404, 'not_found', `${what} ${id} was not found.`, { hint: 'Load a dataset and run an analysis first.' });

export function zodIssues(err: ZodError, prefix = ''): Issue[] {
  return err.issues.map((i) => ({ path: [prefix, ...i.path.map(String)].filter(Boolean).join('.'), message: i.message }));
}

export interface ErrorResponse {
  status: number;
  code: ErrorCode;
  message: string;
  extra: HttpError['extra'];
}

/** The HTTP status and body an error becomes; null for an unexpected error (500). Used by the handler and by /checks. */
export function errorResponse(err: unknown): ErrorResponse | null {
  if (err instanceof ZodError) {
    const issues = zodIssues(err);
    const first = issues[0];
    return { status: 422, code: 'schema_invalid', message: `${first.path || 'body'} ${first.message}`, extra: { path: first.path, issues, hint: 'Fix the named field and send again.' } };
  }
  if (err instanceof OverrideInvalid) {
    return { status: 422, code: 'override_invalid', message: err.message, extra: { path: 'overrides', hint: 'Change one assumption at a time.' } };
  }
  if (err instanceof AttributionConflict) {
    return { status: 409, code: 'attribution_conflict', message: err.message, extra: { hint: err.rule } };
  }
  if (err instanceof HttpError) {
    return { status: err.status, code: err.code, message: err.message, extra: err.extra };
  }
  const e = err as { type?: string; code?: string } | null;
  if (e?.type === 'entity.too.large' || e?.code === 'LIMIT_FILE_SIZE') {
    return { status: 413, code: 'file_too_large', message: `A file is larger than ${Math.round(config.maxBodyBytes / 1048576)} MB.`, extra: { hint: 'Split it by month and upload the files together.' } };
  }
  if (e?.type === 'entity.parse.failed') {
    return { status: 422, code: 'schema_invalid', message: 'The body is not valid JSON.', extra: { path: 'body', hint: 'Check the file is UTF-8 JSON.' } };
  }
  return null;
}

/** The same error in Hindi or Telugu (Accept-Language or ?lang=); English stays exactly as written. */
export function localizeError(known: ErrorResponse, lang: ReturnType<typeof messageLang>): ErrorResponse {
  if (lang === 'en') return known;
  const extra = { ...known.extra };
  if (extra.hint) extra.hint = translate(extra.hint, lang);
  if (extra.issues) extra.issues = extra.issues.map((i) => ({ ...i, message: translate(i.message, lang) }));
  return { ...known, message: translate(known.message, lang), extra };
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const lang = messageLang(req);
  res.vary('Accept-Language');
  if (lang !== 'en') res.setHeader('Content-Language', lang);
  const found = errorResponse(err);
  if (found) {
    const known = localizeError(found, lang);
    res.status(known.status).json({ error: { code: known.code, message: known.message, ...known.extra } });
    return;
  }
  req.log?.error({ err }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal', message: translate('Something failed on the server. The request id is in the logs.', lang), hint: `request_id ${String(req.id)}` } });
};
