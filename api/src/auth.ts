import type { RequestHandler } from 'express';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { HttpError } from './errors.js';

// Sign-in with Amazon Cognito. The judge path never needs a login: requests without a token are guests.
// With sign-in configured, a guest's decisions stay in memory ("demo workspace"); a signed-in user's are saved.

export interface AuthUser {
  sub: string;
  email: string | null;
}

export type TokenVerifier = (token: string) => Promise<AuthUser>;

export interface AuthSettings {
  enabled: boolean;
  verify: TokenVerifier | null;
  publicConfig: { enabled: boolean; domain: string | null; client_id: string | null; region: string };
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export const GUEST = 'guest';
export const accountOf = (user: AuthUser | undefined) => user?.sub ?? GUEST;

/** From env: COGNITO_POOL_ID, COGNITO_CLIENT_ID, COGNITO_DOMAIN (all three, or sign-in stays off). */
export function authFromEnv(env = process.env): AuthSettings {
  const poolId = env.COGNITO_POOL_ID || '';
  const clientId = env.COGNITO_CLIENT_ID || '';
  const domain = env.COGNITO_DOMAIN || '';
  const region = env.COGNITO_REGION || poolId.split('_')[0] || 'ap-south-1';
  const enabled = Boolean(poolId && clientId && domain);
  let verify: TokenVerifier | null = null;
  if (enabled) {
    const verifier = CognitoJwtVerifier.create({ userPoolId: poolId, tokenUse: 'id', clientId });
    verify = async (token) => {
      const payload = await verifier.verify(token);
      return { sub: payload.sub, email: typeof payload.email === 'string' ? payload.email : null };
    };
  }
  return { enabled, verify, publicConfig: { enabled, domain: enabled ? domain : null, client_id: enabled ? clientId : null, region } };
}

/** Sets req.user for a valid Bearer token; a bad token is 401; no token is a guest. */
export function authMiddleware(settings: AuthSettings): RequestHandler {
  return (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header || !settings.enabled || !settings.verify) return next();
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return next(new HttpError(401, 'unauthorized', 'Use "Authorization: Bearer <id token>".'));
    settings
      .verify(token)
      .then((user) => {
        req.user = user;
        next();
      })
      .catch(() => next(new HttpError(401, 'unauthorized', 'Your session has expired or is invalid. Sign in again.', { hint: 'Guests can keep using the demo without signing in.' })));
  };
}

/** A record is visible to its owner; guest records (and records from before sign-in existed) to everyone. */
export function canSee(account: string | undefined, user: AuthUser | undefined): boolean {
  return !account || account === GUEST || account === user?.sub;
}
