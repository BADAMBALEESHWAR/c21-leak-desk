// Profyn's own sign-in: the Cognito user-pool API called directly over HTTPS (USER_PASSWORD_AUTH, public client, no
// secret, no hosted page, no library). Tokens stay in this browser; the API verifies the id token on every call.
import type { AuthConfig } from '../api/types';
import { APP_PATH } from '../brand';
import { i18n } from '../i18n';

export const LOGIN_PATH = '/login/';
const SESSION_KEY = 'profyn.session';
const MODE_KEY = 'profyn.mode';

export interface UserClaims {
  sub: string;
  email: string | null;
  exp: number | null;
}

interface StoredSession {
  id: string;
  refresh: string | null;
  email: string | null;
}

/** A failed Cognito call, with a message a person can act on. `code` drives the next screen (e.g. "confirm"). */
export class AuthError extends Error {
  constructor(
    public readonly code: 'bad_credentials' | 'confirm' | 'exists' | 'password' | 'code' | 'limit' | 'new_password' | 'not_ready' | 'network' | 'other',
    message: string,
    /** Cognito session for a NEW_PASSWORD_REQUIRED challenge. */
    public readonly session?: string,
    /** The message's translation key, so a screen can show it again after the language changes. */
    public readonly i18nKey?: string,
  ) {
    super(message);
  }
}

/** Messages a person can act on: translated when the error is made (never at module load), English by default. */
const MESSAGES = {
  badCredentials: { key: 'auth.badCredentials', text: 'Email or password is not right.' },
  confirmFirst: { key: 'auth.confirmFirst', text: 'Confirm your email first: enter the code we sent you.' },
  exists: { key: 'auth.exists', text: 'An account with this email already exists. Sign in instead.' },
  passwordRule: { key: 'auth.passwordRule', text: 'Use at least 8 characters with an upper-case letter, a lower-case letter and a number.' },
  codeWrong: { key: 'auth.codeWrong', text: 'That code is not right. Check the latest email and try again.' },
  codeExpired: { key: 'auth.codeExpired', text: 'That code has expired. Ask for a new one.' },
  tooMany: { key: 'auth.tooMany', text: 'Too many attempts. Wait a minute, then try again.' },
  checkFields: { key: 'auth.checkFields', text: 'Check the email and password and try again.' },
  network: { key: 'auth.network', text: 'Could not reach the sign-in service. Check the connection and try again.' },
  failed: { key: 'auth.failed', text: 'Sign-in failed. Try again.' },
  incomplete: { key: 'auth.incomplete', text: 'Sign-in did not complete. Try again.' },
  newPassword: { key: 'auth.newPassword', text: 'Choose a new password to finish signing in.' },
  notReady: { key: 'auth.notReady', text: 'Sign-in is being set up — use Try the demo.' },
} as const;

type AuthMessage = (typeof MESSAGES)[keyof typeof MESSAGES];

function authError(code: AuthError['code'], m: AuthMessage, session?: string): AuthError {
  return new AuthError(code, i18n.t(m.key, m.text), session, m.key);
}

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function tabStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function decodeClaims(token: string): UserClaims | null {
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const c = JSON.parse(decodeURIComponent(escape(json))) as { sub?: string; email?: string; exp?: number };
    if (!c.sub) return null;
    return { sub: c.sub, email: c.email ?? null, exp: typeof c.exp === 'number' ? c.exp : null };
  } catch {
    return null;
  }
}

function readSession(): StoredSession | null {
  try {
    const raw = store()?.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function writeSession(s: StoredSession | null): void {
  try {
    if (s) store()?.setItem(SESSION_KEY, JSON.stringify(s));
    else store()?.removeItem(SESSION_KEY);
  } catch {
    // Storage blocked (private mode): sign-in lasts for this page only.
  }
}

const fresh = (token: string, marginS = 60) => {
  const c = decodeClaims(token);
  return Boolean(c && (c.exp === null || c.exp * 1000 > Date.now() + marginS * 1000));
};

/** Demo mode: "Try the demo" opens /app/?mode=demo. It lasts for the tab and never sends a token. */
export function isDemoMode(): boolean {
  try {
    const p = new URLSearchParams(window.location.search).get('mode');
    if (p === 'demo') tabStore()?.setItem(MODE_KEY, 'demo');
    if (p === 'account') tabStore()?.removeItem(MODE_KEY);
    return tabStore()?.getItem(MODE_KEY) === 'demo';
  } catch {
    return false;
  }
}

export function leaveDemoMode(): void {
  tabStore()?.removeItem(MODE_KEY);
}

/** The id token for API calls, or null when signed out, expired or in demo mode. Synchronous: no refresh here. */
export function getIdToken(): string | null {
  if (isDemoMode()) return null;
  const s = readSession();
  return s && fresh(s.id, 0) ? s.id : null;
}

export function currentUser(): UserClaims | null {
  const s = readSession();
  if (!s) return null;
  const c = decodeClaims(s.id);
  return c ? { ...c, email: c.email ?? s.email } : null;
}

/** Reads /auth/config; anything but a usable answer means sign-in is not set up. */
export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch('/api/v1/auth/config', { headers: { Accept: 'application/json' } });
    if (!res.ok) return { enabled: false };
    const body = (await res.json()) as AuthConfig;
    const usable = body.enabled === true && typeof body.client_id === 'string' && typeof body.region === 'string';
    return usable ? body : { ...body, enabled: false };
  } catch {
    return { enabled: false };
  }
}

const FRIENDLY: Record<string, [AuthError['code'], AuthMessage]> = {
  NotAuthorizedException: ['bad_credentials', MESSAGES.badCredentials],
  UserNotFoundException: ['bad_credentials', MESSAGES.badCredentials],
  UserNotConfirmedException: ['confirm', MESSAGES.confirmFirst],
  UsernameExistsException: ['exists', MESSAGES.exists],
  InvalidPasswordException: ['password', MESSAGES.passwordRule],
  CodeMismatchException: ['code', MESSAGES.codeWrong],
  ExpiredCodeException: ['code', MESSAGES.codeExpired],
  LimitExceededException: ['limit', MESSAGES.tooMany],
  TooManyRequestsException: ['limit', MESSAGES.tooMany],
  TooManyFailedAttemptsException: ['limit', MESSAGES.tooMany],
  InvalidParameterException: ['other', MESSAGES.checkFields],
};

async function cognito<T>(cfg: AuthConfig, target: string, body: Record<string, unknown>): Promise<T> {
  if (!cfg.enabled || !cfg.client_id || !cfg.region) throw authError('not_ready', MESSAGES.notReady);
  let res: Response;
  try {
    res = await fetch(`https://cognito-idp.${cfg.region}.amazonaws.com/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}` },
      body: JSON.stringify({ ClientId: cfg.client_id, ...body }),
    });
  } catch {
    throw authError('network', MESSAGES.network);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const type = String(json.__type ?? '').split('#').pop() ?? '';
    const friendly = FRIENDLY[type];
    if (friendly) throw authError(friendly[0], friendly[1]);
    // Cognito's own wording for a case not mapped above (it comes only in English).
    throw typeof json.message === 'string' ? new AuthError('other', json.message) : authError('other', MESSAGES.failed);
  }
  return json as T;
}

interface AuthResult {
  AuthenticationResult?: { IdToken: string; RefreshToken?: string };
  ChallengeName?: string;
  Session?: string;
}

function keep(result: AuthResult, email: string): UserClaims {
  const r = result.AuthenticationResult;
  if (!r?.IdToken) throw authError('other', MESSAGES.incomplete);
  const previous = readSession();
  writeSession({ id: r.IdToken, refresh: r.RefreshToken ?? previous?.refresh ?? null, email });
  leaveDemoMode();
  return currentUser() as UserClaims;
}

export async function signIn(cfg: AuthConfig, email: string, password: string): Promise<UserClaims> {
  const out = await cognito<AuthResult>(cfg, 'InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: email.trim(), PASSWORD: password } });
  if (out.ChallengeName === 'NEW_PASSWORD_REQUIRED') throw authError('new_password', MESSAGES.newPassword, out.Session);
  return keep(out, email.trim());
}

/** Answers NEW_PASSWORD_REQUIRED (an account created for you with a temporary password). */
export async function completeNewPassword(cfg: AuthConfig, email: string, session: string, newPassword: string): Promise<UserClaims> {
  const out = await cognito<AuthResult>(cfg, 'RespondToAuthChallenge', {
    ChallengeName: 'NEW_PASSWORD_REQUIRED',
    Session: session,
    ChallengeResponses: { USERNAME: email.trim(), NEW_PASSWORD: newPassword },
  });
  return keep(out, email.trim());
}

export async function signUp(cfg: AuthConfig, email: string, password: string): Promise<void> {
  await cognito(cfg, 'SignUp', { Username: email.trim(), Password: password, UserAttributes: [{ Name: 'email', Value: email.trim() }] });
}

export async function confirmSignUp(cfg: AuthConfig, email: string, code: string): Promise<void> {
  await cognito(cfg, 'ConfirmSignUp', { Username: email.trim(), ConfirmationCode: code.trim() });
}

export async function resendCode(cfg: AuthConfig, email: string): Promise<void> {
  await cognito(cfg, 'ResendConfirmationCode', { Username: email.trim() });
}

export async function forgotPassword(cfg: AuthConfig, email: string): Promise<void> {
  await cognito(cfg, 'ForgotPassword', { Username: email.trim() });
}

export async function confirmForgotPassword(cfg: AuthConfig, email: string, code: string, newPassword: string): Promise<void> {
  await cognito(cfg, 'ConfirmForgotPassword', { Username: email.trim(), ConfirmationCode: code.trim(), Password: newPassword });
}

/** A usable id token, renewing it with the refresh token when it has expired. null means "show the login page". */
export async function ensureIdToken(cfg: AuthConfig): Promise<string | null> {
  if (isDemoMode()) return null;
  const s = readSession();
  if (!s) return null;
  if (fresh(s.id)) return s.id;
  if (!s.refresh && fresh(s.id, 0)) return s.id; // no way to renew: use it while it lasts
  if (!s.refresh || !cfg.enabled) {
    writeSession(null);
    return null;
  }
  try {
    const out = await cognito<AuthResult>(cfg, 'InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH', AuthParameters: { REFRESH_TOKEN: s.refresh } });
    keep(out, s.email ?? '');
    return readSession()?.id ?? null;
  } catch (err) {
    // A dropped connection keeps the session for the next try; a refused refresh token ends it.
    if (!(err instanceof AuthError && err.code === 'network')) writeSession(null);
    return null;
  }
}

/** Forgets the session in this browser without leaving the page (e.g. the API refused the token). */
export function clearSession(): void {
  writeSession(null);
}

/** Ends a Google / GitHub session: the API clears its httpOnly cookie. Never throws. */
export async function logoutCookie(): Promise<void> {
  try {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } });
  } catch {
    // Offline: the cookie expires on its own.
  }
}

/** Forgets the session in this browser (and the sign-in cookie on the API), then returns to the landing page. */
export function signOut(): void {
  writeSession(null);
  leaveDemoMode();
  void logoutCookie().finally(() => window.location.assign('/'));
}

// ---- Google / GitHub sign-in (cookie session) -------------------------------------------------------------------------

export type OAuthProvider = 'google' | 'github';

export interface CookieUser {
  sub: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  provider: string;
}

/**
 * GET /me with the httpOnly profyn_session cookie: the signed-in Google / GitHub user, or null for a guest (401), a
 * server without cookie sign-in, or a network failure.
 */
export async function fetchCookieUser(): Promise<CookieUser | null> {
  try {
    const res = await fetch('/api/v1/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { user?: Record<string, unknown> | null };
    const u = body?.user;
    if (!u || typeof u !== 'object' || typeof u._id !== 'string' || typeof u.provider !== 'string') return null;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
    return { sub: u._id, email: str(u.email), name: str(u.name), avatarUrl: str(u.avatar_url), provider: u.provider };
  } catch {
    return null;
  }
}

/** Which sign-in buttons to show; anything but a usable answer hides Google and GitHub. */
export async function fetchProviders(): Promise<{ google: boolean; github: boolean; email: boolean }> {
  try {
    const res = await fetch('/api/v1/auth/providers', { headers: { Accept: 'application/json' } });
    if (!res.ok) return { google: false, github: false, email: false };
    const b = (await res.json()) as Record<string, unknown>;
    return { google: b.google === true, github: b.github === true, email: b.email === true };
  } catch {
    return { google: false, github: false, email: false };
  }
}

/** Full-page navigation to the provider; the API sets the cookie and sends the person back to `next`. */
export const providerHref = (provider: OAuthProvider, next: string = APP_PATH) => `/api/v1/auth/${provider}?return=${encodeURIComponent(next)}`;

/** Where "Sign in" goes; `next` brings the person back (default: their workspace). */
export const loginHref = (next: string = APP_PATH) => `${LOGIN_PATH}?next=${encodeURIComponent(next)}`;

/** "Sign-in is being set up — use Try the demo." in the current UI language. */
export const signInNotReady = (): string => i18n.t(MESSAGES.notReady.key, MESSAGES.notReady.text);
