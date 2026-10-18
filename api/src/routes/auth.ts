import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import type { AuthSettings } from '../auth.js';
import {
  authorizeUrl,
  beginState,
  checkState,
  clearSession,
  clientIp,
  fetchProfile,
  issueSession,
  oauthFromEnv,
  safeReturn,
  type OAuthProvider,
  type OAuthSettings,
} from '../auth-oauth.js';
import { ah, HttpError } from '../errors.js';
import { messageLang, t } from '../i18n/index.js';
import { DEFAULT_CONSENT, logins, users } from '../users.js';

/** Public sign-in settings for the web app (no secrets), Google/GitHub sign-in, and the signed-in owner. */
export function authRouter(settings: AuthSettings, oauth: OAuthSettings = oauthFromEnv()) {
  const router = Router();
  const signInEnabled = () => settings.enabled || Boolean(oauth.google || oauth.github);

  router.get('/auth/config', (_req, res) => {
    res.json(settings.publicConfig);
  });

  /** Which sign-in buttons to show. */
  router.get('/auth/providers', (_req, res) => {
    res.json({ google: Boolean(oauth.google), github: Boolean(oauth.github), email: settings.enabled });
  });

  const providerName = { google: 'Google', github: 'GitHub' } as const;
  const enabled = (provider: OAuthProvider) => {
    if (!oauth[provider] || !oauth.sessionSecret) {
      throw new HttpError(404, 'provider_disabled', `${providerName[provider]} sign-in is not set up on this server.`, { hint: 'Open the sign-in page and choose a provider again.' });
    }
  };

  /** Adds ?auth_error=… to a return path, for a sign-in the owner cancelled or the provider refused. */
  const withError = (path: string, code: string) => `${path}${path.includes('?') ? '&' : '?'}auth_error=${encodeURIComponent(code)}`;

  for (const provider of ['google', 'github'] as const) {
    router.get(`/auth/${provider}`, (req: Request, res: Response) => {
      enabled(provider);
      const state = beginState(res, oauth, provider, safeReturn(req.query.return));
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, authorizeUrl(oauth, provider, state));
    });

    router.get(
      `/auth/${provider}/callback`,
      ah(async (req, res) => {
        enabled(provider);
        res.setHeader('Cache-Control', 'no-store');
        const back = checkState(req, res, oauth, provider);
        if (!back) {
          throw new HttpError(400, 'invalid_state', 'The sign-in link has expired or was not started here. Start sign-in again.', { hint: 'Open the sign-in page and choose a provider again.' });
        }
        if (typeof req.query.error === 'string') return void res.redirect(302, withError(back, req.query.error === 'access_denied' ? 'access_denied' : 'provider_error'));
        const code = typeof req.query.code === 'string' ? req.query.code : '';
        if (!code) throw new HttpError(400, 'invalid_state', 'The sign-in reply had no code. Start sign-in again.', { hint: 'Open the sign-in page and choose a provider again.' });
        let profile;
        try {
          profile = await fetchProfile(oauth, provider, code);
        } catch (err) {
          req.log?.warn({ provider, err: (err as Error).message }, 'sign-in code exchange failed');
          return void res.redirect(302, withError(back, 'oauth_failed'));
        }
        const { user, created } = await users.upsert(profile);
        await logins.record({ user_id: user._id, provider, ip: clientIp(req), user_agent: req.headers['user-agent'] ?? null, secret: oauth.sessionSecret! });
        await audit.recordFor(user._id, { kind: 'login', detail: { provider, new_account: created } });
        // Guests share one demo workspace (account "guest"), so there is no guest-owned data to move to the new account.
        issueSession(res, oauth, user);
        req.log?.info({ provider, user_id: user._id, created }, 'signed in');
        res.redirect(302, back);
      }),
    );
  }

  router.post('/auth/logout', (_req, res) => {
    clearSession(res, oauth);
    res.status(204).end();
  });

  /** The signed-in owner with their last 20 sign-ins and consent; a guest gets 401 (still saying "demo workspace"). */
  router.get(
    '/me',
    ah(async (req, res) => {
      if (!req.user) {
        // ?quiet=1: the app asks on every load; a guest is a normal answer there, not an error in the browser console.
        if (req.query.quiet === '1') return void res.json({ user: null, auth_enabled: signInEnabled(), workspace: 'demo' });
        const message = t('msg.sign_in_required', messageLang(req));
        return void res.status(401).json({ error: { code: 'unauthorized', message }, user: null, auth_enabled: signInEnabled(), workspace: 'demo' });
      }
      const record = await users.get(req.user.sub);
      const consent = { ...DEFAULT_CONSENT, ...(record?.consent ?? req.user.consent ?? {}) };
      const recent = await logins.recent(req.user.sub, 20);
      res.json({
        user: {
          _id: req.user.sub,
          sub: req.user.sub,
          provider: record?.provider ?? req.user.provider ?? 'email',
          email: record?.email ?? req.user.email,
          name: record?.name ?? req.user.name ?? null,
          avatar_url: record?.avatar_url ?? req.user.avatar_url ?? null,
          locale: record?.locale ?? null,
          created_at: record?.created_at ?? null,
          last_login_at: record?.last_login_at ?? null,
          consent,
        },
        logins: recent.map((l) => ({ at: l.at, provider: l.provider, user_agent: l.user_agent, ip_hash: l.ip_hash ? l.ip_hash.slice(0, 12) : null })),
        consent,
        auth_enabled: signInEnabled(),
        workspace: 'account',
      });
    }),
  );

  const ConsentPatch = z.object({ ai: z.boolean().optional(), email_digest: z.boolean().optional() }).strict();

  router.patch(
    '/me/consent',
    ah(async (req, res) => {
      if (!req.user) throw new HttpError(401, 'unauthorized', 'Sign in to use your account.');
      const patch = ConsentPatch.parse(req.body ?? {});
      let record = await users.setConsent(req.user.sub, patch);
      if (!record) {
        // A session whose user record is not in this process (no database): keep the choice from now on.
        await users.restore({ _id: req.user.sub, provider: req.user.provider, email: req.user.email, name: req.user.name ?? null });
        record = await users.setConsent(req.user.sub, patch);
      }
      const consent = { ...DEFAULT_CONSENT, ...(record?.consent ?? {}), ...patch };
      void audit.record(req, { kind: 'consent', ...patch });
      res.json({ consent });
    }),
  );

  return router;
}
