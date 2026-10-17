// Profyn's own sign-in: the Cognito user-pool API called directly over HTTPS (USER_PASSWORD_AUTH, public client, no
// secret, no hosted page, no library). Tokens stay in this browser; the API verifies the id token on every call.
import type { AuthConfig } from '../api/types';
import { APP_PATH } from '../brand';

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
  ) {
    super(message);
  }
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

const FRIENDLY: Record<string, [AuthError['code'], string]> = {
  NotAuthorizedException: ['bad_credentials', 'Email or password is not right.'],
  UserNotFoundException: ['bad_credentials', 'Email or password is not right.'],
  UserNotConfirmedException: ['confirm', 'Confirm your email first: enter the code we sent you.'],
  UsernameExistsException: ['exists', 'An account with this email already exists. Sign in instead.'],
  InvalidPasswordException: ['password', 'Use at least 8 characters with an upper-case letter, a lower-case letter and a number.'],
  CodeMismatchException: ['code', 'That code is not right. Check the latest email and try again.'],
  ExpiredCodeException: ['code', 'That code has expired. Ask for a new one.'],
  LimitExceededException: ['limit', 'Too many attempts. Wait a minute, then try again.'],
  TooManyRequestsException: ['limit', 'Too many attempts. Wait a minute, then try again.'],
  TooManyFailedAttemptsException: ['limit', 'Too many attempts. Wait a minute, then try again.'],
  InvalidParameterException: ['other', 'Check the email and password and try again.'],
};

async function cognito<T>(cfg: AuthConfig, target: string, body: Record<string, unknown>): Promise<T> {
  if (!cfg.enabled || !cfg.client_id || !cfg.region) throw new AuthError('not_ready', SIGN_IN_NOT_READY);
  let res: Response;
  try {
    res = await fetch(`https://cognito-idp.${cfg.region}.amazonaws.com/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}` },
      body: JSON.stringify({ ClientId: cfg.client_id, ...body }),
    });
  } catch {
    throw new AuthError('network', 'Could not reach the sign-in service. Check the connection and try again.');
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const type = String(json.__type ?? '').split('#').pop() ?? '';
    const [code, message] = FRIENDLY[type] ?? ['other', typeof json.message === 'string' ? json.message : 'Sign-in failed. Try again.'];
    throw new AuthError(code, message);
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
  if (!r?.IdToken) throw new AuthError('other', 'Sign-in did not complete. Try again.');
  const previous = readSession();
  writeSession({ id: r.IdToken, refresh: r.RefreshToken ?? previous?.refresh ?? null, email });
  leaveDemoMode();
  return currentUser() as UserClaims;
}

export async function signIn(cfg: AuthConfig, email: string, password: string): Promise<UserClaims> {
  const out = await cognito<AuthResult>(cfg, 'InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: email.trim(), PASSWORD: password } });
  if (out.ChallengeName === 'NEW_PASSWORD_REQUIRED') throw new AuthError('new_password', 'Choose a new password to finish signing in.', out.Session);
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

/** Forgets the session in this browser and returns to the landing page. */
export function signOut(): void {
  writeSession(null);
  leaveDemoMode();
  window.location.assign('/');
}

/** Where "Sign in" goes; `next` brings the person back (default: their workspace). */
export const loginHref = (next: string = APP_PATH) => `${LOGIN_PATH}?next=${encodeURIComponent(next)}`;

export const SIGN_IN_NOT_READY = 'Sign-in is being set up — use Try the demo.';
