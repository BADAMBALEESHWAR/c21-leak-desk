import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { bindSession } from '../api/client';
import type { AuthConfig } from '../api/types';
import { parseHash } from '../lib/router';
import { clearSession, currentUser, ensureIdToken, fetchAuthConfig, isDemoMode, leaveDemoMode, loginHref, signOut as doSignOut } from './auth';

export interface AuthUser {
  sub: string;
  email: string | null;
}

/**
 * demo: "Try the demo" (?mode=demo), sign-in not set up, or no valid session. No token is sent; uploads go to the shared
 * demo workspace. account: a valid session and not demo. Every call carries the id token and data is the owner's.
 */
export type AppMode = 'demo' | 'account';

interface AuthValue {
  /** False until the mode is known; nothing that depends on it renders before. */
  ready: boolean;
  config: AuthConfig;
  mode: AppMode;
  /** The signed-in owner in workspace mode; null in demo mode. */
  user: AuthUser | null;
  /** Demo mode with a session in this browser: offer the way back to the workspace. */
  hasSession: boolean;
  /** The session ended (expired, or the API refused it): ask the person to sign in again. */
  sessionEnded: boolean;
  signOut: () => void;
  /** "Sign in": the login page, which brings the person back here (never into demo mode). */
  loginUrl: string;
  /** "Back to your workspace" from demo mode. */
  backToWorkspace: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>.');
  return v;
}

export const WORKSPACE_URL = '/app/?mode=account';

/** Where to come back to after signing in: this page and route, without ?mode=demo and without a one-time deep link. */
function returnPath(): string {
  const params = new URLSearchParams(window.location.search);
  params.delete('mode');
  const query = params.toString();
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  const hash = raw ? `#/${parseHash(window.location.hash).route}` : '';
  return `${window.location.pathname}${query ? `?${query}` : ''}${hash}`;
}

/**
 * auth.ts keeps the session under this key and exports no way to forget it without leaving the page; a session the API
 * refuses is cleared here the same way (writeSession(null)), so a reload opens the demo with "Sign in" instead of failing again.
 */
function forgetRejectedSession(): void {
  clearSession();
}

interface Resolved {
  config: AuthConfig;
  account: boolean;
  user: AuthUser | null;
  hasSession: boolean;
  sessionEnded: boolean;
}

let resolving: Promise<Resolved> | null = null;

/** Decided once per page load (ensureIdToken may renew or clear the session, so it must not run twice). */
function resolveMode(): Promise<Resolved> {
  resolving ??= (async () => {
    const config = await fetchAuthConfig();
    const demo = isDemoMode();
    const stored = currentUser();
    // ensureIdToken renews an expired token with the refresh token; null means no usable session.
    const token = config.enabled && !demo ? await ensureIdToken(config) : null;
    const claims = token ? currentUser() : null;
    const account = Boolean(token && claims);
    return {
      config,
      account,
      user: account && claims ? { sub: claims.sub, email: claims.email } : null,
      hasSession: config.enabled && demo && stored !== null,
      // A session that was here and could not be renewed: say so rather than quietly showing the demo.
      sessionEnded: config.enabled && !demo && stored !== null && !account,
    };
  })();
  return resolving;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<AuthConfig>({ enabled: false });
  const [mode, setMode] = useState<AppMode>('demo');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [hasSession, setHasSession] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [loginUrl, setLoginUrl] = useState(() => loginHref(returnPath()));

  useEffect(() => {
    let cancelled = false;
    void resolveMode().then((r) => {
      if (cancelled) return;
      setConfig(r.config);
      setMode(r.account ? 'account' : 'demo');
      setUser(r.user);
      setHasSession(r.hasSession);
      setSessionEnded(r.sessionEnded);
      bindSession({
        account: r.account,
        renew: () => ensureIdToken(r.config),
        onEnded: () => {
          forgetRejectedSession();
          setSessionEnded(true);
        },
      });
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep "Sign in" pointing back at the current route.
  useEffect(() => {
    const update = () => setLoginUrl(loginHref(returnPath()));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  const signOut = useCallback(() => {
    bindSession(null);
    doSignOut();
  }, []);

  const backToWorkspace = useCallback(() => {
    leaveDemoMode();
    window.location.assign(WORKSPACE_URL);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ ready, config, mode, user, hasSession, sessionEnded, signOut, loginUrl, backToWorkspace }),
    [ready, config, mode, user, hasSession, sessionEnded, signOut, loginUrl, backToWorkspace],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
