import type { Request, RequestHandler } from 'express';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { audit } from './audit.js';
import { clearSession, clientIp, oauthFromEnv, readSession, type OAuthSettings, type SessionClaims } from './auth-oauth.js';
import { dbState } from './db.js';
import { HttpError } from './errors.js';
import { logger } from './logger.js';
import { DEFAULT_CONSENT, logins, users, type Consent } from './users.js';

// Sign-in with Amazon Cognito. The judge path never needs a login: requests without a token are guests.
// With sign-in configured, a guest works in the "demo workspace": its records are saved under account "guest".

export interface AuthUser {
  sub: string;
  email: string | null;
  /** How the owner signed in: google, github or email (Cognito). */
  provider?: string;
  name?: string | null;
  avatar_url?: string | null;
  /** The owner's choices (AI on uploaded data, email digest); absent for guests. */
  consent?: Consent;
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

/** Cognito subs whose sign-in was logged recently (one logins row per id-token lifetime, not per request). */
const cognitoSeen = new Map<string, number>();
const COGNITO_LOGIN_EVERY_MS = 8 * 3600_000;
/** Accounts deleted in this process: their session cookies stop working at once. */
export const revokedAccounts = new Set<string>();

/** A Cognito user is upserted into users (provider "email") on first sight; their consent rides on req.user. Never throws. */
async function cognitoAccount(user: AuthUser, req: Request, oauth: OAuthSettings): Promise<AuthUser> {
  try {
    let record = await users.get(user.sub);
    if (!record || Date.now() - (cognitoSeen.get(user.sub) ?? 0) > COGNITO_LOGIN_EVERY_MS) {
      const up = await users.upsert({ provider: 'email', provider_id: user.sub, email: user.email, name: record?.name ?? null, avatar_url: null, locale: null });
      record = up.user;
      cognitoSeen.set(user.sub, Date.now());
      await logins.record({ user_id: record._id, provider: 'email', ip: clientIp(req), user_agent: req.headers['user-agent'] ?? null, secret: oauth.sessionSecret ?? 'profyn' });
      await audit.recordFor(record._id, { kind: 'login', detail: { provider: 'email', new_account: up.created } });
    }
    return { ...user, provider: 'email', name: record.name, consent: { ...DEFAULT_CONSENT, ...(record.consent ?? {}) } };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'could not record the signed-in user');
    return user;
  }
}

/** The owner behind a valid session cookie; null when the account no longer exists. */
async function sessionAccount(claims: SessionClaims): Promise<AuthUser | null> {
  if (revokedAccounts.has(claims.sub)) return null;
  const record = await users.get(claims.sub).catch(() => null);
  if (record) {
    return { sub: record._id, email: record.email, provider: record.provider, name: record.name, avatar_url: record.avatar_url, consent: { ...DEFAULT_CONSENT, ...(record.consent ?? {}) } };
  }
  // Connected and not there: deleted. Otherwise (no database, or it is down) the signed claims stand in.
  if (dbState() === 'connected') return null;
  return { sub: claims.sub, email: claims.email, provider: claims.provider, name: claims.name, consent: { ...DEFAULT_CONSENT } };
}

/**
 * Sets req.user for a valid Cognito Bearer token (a bad token is 401) or a valid profyn_session cookie (Google or
 * GitHub sign-in); a bad or expired cookie is cleared and the request continues as a guest. Nothing at all is a guest.
 */
export function authMiddleware(settings: AuthSettings, oauth: OAuthSettings = oauthFromEnv()): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (header && settings.enabled && settings.verify) {
      const [scheme, token] = header.split(' ');
      if (scheme !== 'Bearer' || !token) return next(new HttpError(401, 'unauthorized', 'Use "Authorization: Bearer <id token>".'));
      settings.verify(token).then(
        (user) =>
          cognitoAccount(user, req, oauth).then((u) => {
            req.user = u;
            next();
          }),
        () => next(new HttpError(401, 'unauthorized', 'Your session has expired or is invalid. Sign in again.', { hint: 'Guests can keep using the demo without signing in.' })),
      );
      return;
    }
    const claims = readSession(req, oauth);
    if (!claims) {
      if (oauth.sessionSecret && req.headers.cookie?.includes('profyn_session=')) clearSession(res, oauth);
      return next();
    }
    sessionAccount(claims).then(
      (user) => {
        if (user) req.user = user;
        else clearSession(res, oauth);
        next();
      },
      () => next(),
    );
  };
}

/** A record is visible to its owner; guest records (and records from before sign-in existed) to everyone. */
export function canSee(account: string | undefined, user: AuthUser | undefined): boolean {
  return !account || account === GUEST || account === user?.sub;
}
