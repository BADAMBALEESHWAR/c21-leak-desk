import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { config } from './config.js';
import { AttributionConflict, OverrideInvalid } from './engine/types.js';

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

function send(res: Response, status: number, code: ErrorCode, message: string, extra: HttpError['extra'] = {}) {
  res.status(status).json({ error: { code, message, ...extra } });
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    const issues = zodIssues(err);
    const first = issues[0];
    send(res, 422, 'schema_invalid', `${first.path || 'body'} ${first.message}`, { path: first.path, issues, hint: 'Fix the named field and send again.' });
    return;
  }
  if (err instanceof OverrideInvalid) {
    send(res, 422, 'override_invalid', err.message, { path: 'overrides', hint: 'Change one assumption at a time.' });
    return;
  }
  if (err instanceof AttributionConflict) {
    send(res, 409, 'attribution_conflict', err.message, { hint: err.rule });
    return;
  }
  if (err instanceof HttpError) {
    send(res, err.status, err.code, err.message, err.extra);
    return;
  }
  const e = err as { type?: string; code?: string };
  if (e.type === 'entity.too.large' || e.code === 'LIMIT_FILE_SIZE') {
    send(res, 413, 'file_too_large', `A file is larger than ${Math.round(config.maxBodyBytes / 1048576)} MB.`, { hint: 'Split it by month and upload the files together.' });
    return;
  }
  if (e.type === 'entity.parse.failed') {
    send(res, 422, 'schema_invalid', 'The body is not valid JSON.', { path: 'body', hint: 'Check the file is UTF-8 JSON.' });
    return;
  }
  req.log?.error({ err }, 'unhandled error');
  send(res, 500, 'internal', 'Something failed on the server. The request id is in the logs.', { hint: `request_id ${String(req.id)}` });
};
