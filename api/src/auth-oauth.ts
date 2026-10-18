import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Profile } from './users.js';

// Google and GitHub sign-in (Authorization Code flow, code exchanged on the server) and Profyn's own session:
// an HS256 JWT signed with SESSION_SECRET in the httpOnly cookie `profyn_session`. No new dependencies.

export const SESSION_COOKIE = 'profyn_session';
export const STATE_COOKIE = 'profyn_oauth';
export const SESSION_DAYS = 7;
const STATE_MINUTES = 10;
export const DEFAULT_PUBLIC_URL = 'https://d2gmrabs4sk8gk.cloudfront.net';
export const DEFAULT_RETURN = '/app/';

export type OAuthProvider = 'google' | 'github';

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface OAuthSettings {
  google: OAuthClient | null;
  github: OAuthClient | null;
  /** Signs sessions and sign-in state; with none, provider sign-in and session cookies are off. */
  sessionSecret: string | null;
  /** Public base URL; redirect URIs are PUBLIC_URL + /api/v1/auth/{provider}/callback. */
  publicUrl: string;
  /** Secure cookies everywhere except a localhost PUBLIC_URL (plain-http development). */
  secureCookies: boolean;
}

/** From env: GOOGLE_CLIENT_ID/SECRET, GITHUB_CLIENT_ID/SECRET, SESSION_SECRET, PUBLIC_URL. */
export function oauthFromEnv(env = process.env): OAuthSettings {
  const pair = (id?: string, secret?: string): OAuthClient | null => (id && secret ? { clientId: id, clientSecret: secret } : null);
  const sessionSecret = env.SESSION_SECRET && env.SESSION_SECRET !== 'none' ? env.SESSION_SECRET : null;
  const publicUrl = (env.PUBLIC_URL || DEFAULT_PUBLIC_URL).replace(/\/+$/, '');
  return {
    google: sessionSecret ? pair(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET) : null,
    github: sessionSecret ? pair(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET) : null,
    sessionSecret,
    publicUrl,
    secureCookies: !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(publicUrl),
  };
}

export const redirectUri = (s: OAuthSettings, provider: OAuthProvider) => `${s.publicUrl}/api/v1/auth/${provider}/callback`;

// ---- HS256 JWT ----

const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url');
const sign = (data: string, secret: string) => createHmac('sha256', secret).update(data).digest();

export function signJwt(payload: Record<string, unknown>, secret: string): string {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify(payload));
  return `${head}.${body}.${b64(sign(`${head}.${body}`, secret))}`;
}

/** The payload of a valid, unexpired HS256 token signed with `secret`; null otherwise. */
export function verifyJwt<T = Record<string, unknown>>(token: string, secret: string, now = Date.now()): (T & { exp: number }) | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  try {
    const given = Buffer.from(sig, 'base64url');
    const expected = sign(`${head}.${body}`, secret);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    if (JSON.parse(Buffer.from(head, 'base64url').toString('utf8')).alg !== 'HS256') return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload?.exp !== 'number' || payload.exp * 1000 <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---- cookies ----

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    let value = part.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export const cookieOf = (req: Request, name: string) => parseCookies(req.headers.cookie)[name];

function setCookie(res: Response, name: string, value: string, opts: { maxAge: number; path: string; secure: boolean }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path}`, `Max-Age=${opts.maxAge}`, 'HttpOnly', 'SameSite=Lax'];
  if (opts.maxAge === 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (opts.secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export interface SessionClaims {
  sub: string;
  provider: string;
  email: string | null;
  name: string | null;
  iat: number;
  exp: number;
}

export function issueSession(res: Response, s: OAuthSettings, user: { _id: string; provider: string; email: string | null; name: string | null }) {
  const iat = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = { sub: user._id, provider: user.provider, email: user.email, name: user.name, iat, exp: iat + SESSION_DAYS * 86400 };
  setCookie(res, SESSION_COOKIE, signJwt({ iss: 'profyn', ...claims }, s.sessionSecret!), { maxAge: SESSION_DAYS * 86400, path: '/', secure: s.secureCookies });
}

export const clearSession = (res: Response, s: OAuthSettings) => setCookie(res, SESSION_COOKIE, '', { maxAge: 0, path: '/', secure: s.secureCookies });

/** Claims of a valid session cookie, or null (none, tampered, expired, or sessions off). */
export function readSession(req: Request, s: OAuthSettings): SessionClaims | null {
  if (!s.sessionSecret) return null;
  const token = cookieOf(req, SESSION_COOKIE);
  if (!token) return null;
  const claims = verifyJwt<SessionClaims & { iss?: string }>(token, s.sessionSecret);
  return claims && claims.iss === 'profyn' && typeof claims.sub === 'string' ? claims : null;
}

// ---- sign-in state (CSRF) ----

/** A return path on this site only: "/app/…", never "//host" or "https://…". */
export function safeReturn(value: unknown): string {
  if (typeof value !== 'string' || value.length > 300) return DEFAULT_RETURN;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f]/.test(value)) return DEFAULT_RETURN;
  if (!/^\/[A-Za-z0-9\-._~/?=&%#+,:@]*$/.test(value)) return DEFAULT_RETURN;
  return value;
}

const STATE_PATH = '/api/v1/auth';

/** Starts sign-in: a random state in a signed, short-lived cookie; the same value goes to the provider. */
export function beginState(res: Response, s: OAuthSettings, provider: OAuthProvider, returnTo: string): string {
  const state = randomBytes(18).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + STATE_MINUTES * 60;
  setCookie(res, STATE_COOKIE, signJwt({ st: state, p: provider, r: returnTo, exp }, s.sessionSecret!), { maxAge: STATE_MINUTES * 60, path: STATE_PATH, secure: s.secureCookies });
  return state;
}

/** The return path when the callback's state matches the cookie set at the start for this provider; null otherwise. */
export function checkState(req: Request, res: Response, s: OAuthSettings, provider: OAuthProvider): string | null {
  const cookie = cookieOf(req, STATE_COOKIE);
  setCookie(res, STATE_COOKIE, '', { maxAge: 0, path: STATE_PATH, secure: s.secureCookies });
  const given = typeof req.query.state === 'string' ? req.query.state : '';
  if (!cookie || !given || !s.sessionSecret) return null;
  const claims = verifyJwt<{ st: string; p: string; r: string }>(cookie, s.sessionSecret);
  if (!claims || claims.p !== provider || typeof claims.st !== 'string') return null;
  const a = Buffer.from(claims.st);
  const b = Buffer.from(given);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return safeReturn(claims.r);
}

// ---- providers ----

export function authorizeUrl(s: OAuthSettings, provider: OAuthProvider, state: string): string {
  const client = s[provider]!;
  if (provider === 'google') {
    const q = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: redirectUri(s, 'google'),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }
  const q = new URLSearchParams({ client_id: client.clientId, redirect_uri: redirectUri(s, 'github'), scope: 'read:user user:email', state, allow_signup: 'true' });
  return `https://github.com/login/oauth/authorize?${q}`;
}

export class OAuthFailure extends Error {}

async function getJson(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new OAuthFailure(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

async function googleProfile(s: OAuthSettings, code: string): Promise<Profile> {
  const c = s.google!;
  const token = await getJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri(s, 'google'), grant_type: 'authorization_code' }).toString(),
  });
  if (!str(token?.access_token)) throw new OAuthFailure('google returned no access token');
  const info = await getJson('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' } });
  if (!str(info?.sub)) throw new OAuthFailure('google returned no subject');
  return {
    provider: 'google',
    provider_id: String(info.sub),
    // An unverified address is not trusted as the owner's email.
    email: info.email_verified === false ? null : str(info.email),
    name: str(info.name),
    avatar_url: str(info.picture),
    locale: str(info.locale),
  };
}

async function githubProfile(s: OAuthSettings, code: string): Promise<Profile> {
  const c = s.github!;
  const token = await getJson('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, code, redirect_uri: redirectUri(s, 'github') }).toString(),
  });
  if (!str(token?.access_token)) throw new OAuthFailure(`github returned no access token${token?.error ? ` (${token.error})` : ''}`);
  const headers = { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Profyn', 'X-GitHub-Api-Version': '2022-11-28' };
  const user = await getJson('https://api.github.com/user', { headers });
  if (user?.id === undefined || user?.id === null) throw new OAuthFailure('github returned no user id');
  let email: string | null = null;
  try {
    const emails = (await getJson('https://api.github.com/user/emails', { headers })) as Array<{ email: string; primary: boolean; verified: boolean }>;
    const verified = Array.isArray(emails) ? emails.filter((e) => e.verified) : [];
    email = str((verified.find((e) => e.primary) ?? verified[0])?.email);
  } catch {
    email = null;
  }
  return { provider: 'github', provider_id: String(user.id), email, name: str(user.name) ?? str(user.login), avatar_url: str(user.avatar_url), locale: null };
}

/** Exchanges the code on the server and reads the profile. Throws OAuthFailure. */
export function fetchProfile(s: OAuthSettings, provider: OAuthProvider, code: string): Promise<Profile> {
  return provider === 'google' ? googleProfile(s, code) : githubProfile(s, code);
}

/** The caller's address as CloudFront saw it (its own entry is the last in X-Forwarded-For). */
export function clientIp(req: Request): string | null {
  const xff = req.headers['x-forwarded-for'];
  const list = (Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return list[list.length - 1] ?? req.socket?.remoteAddress ?? null;
}
