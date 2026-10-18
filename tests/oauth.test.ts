import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../api/src/app';
import type { AuthSettings } from '../api/src/auth';
import { signJwt, verifyJwt, type OAuthSettings } from '../api/src/auth-oauth';

// v2 §2: Google and GitHub sign-in with the providers stubbed (global fetch). The callback checks the signed state,
// exchanges the code on the server, upserts the user, logs the sign-in and sets our own session cookie.

const oauth: OAuthSettings = {
  google: { clientId: 'google-client', clientSecret: 'google-secret' },
  github: { clientId: 'github-client', clientSecret: 'github-secret' },
  sessionSecret: 'test-session-secret-0123456789abcdef',
  publicUrl: 'https://profyn.example',
  secureCookies: true,
};
const noCognito: AuthSettings = { enabled: false, verify: null, publicConfig: { enabled: false, domain: null, client_id: null, region: 'ap-south-1' } };
const app = createApp({ auth: noCognito, oauth });
const api = '/api/v1';

interface Person {
  google?: { sub: string; email: string; name: string };
  github?: { id: number; login: string; email: string };
}
let person: Person = {};
const fetchCalls: Array<{ url: string; body?: string }> = [];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  fetchCalls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), body: typeof init?.body === 'string' ? init.body : undefined });
      const u = String(url);
      if (u === 'https://oauth2.googleapis.com/token') return new URLSearchParams(String(init?.body)).get('code') === 'bad' ? json({ error: 'invalid_grant' }, 400) : json({ access_token: 'g-token' });
      if (u === 'https://openidconnect.googleapis.com/v1/userinfo') {
        const g = person.google!;
        return json({ sub: g.sub, email: g.email, email_verified: true, name: g.name, picture: 'https://img.example/a.png', locale: 'en-IN' });
      }
      if (u === 'https://github.com/login/oauth/access_token') return json({ access_token: 'gh-token' });
      if (u === 'https://api.github.com/user') return json({ id: person.github!.id, login: person.github!.login, name: null, avatar_url: 'https://img.example/b.png' });
      if (u === 'https://api.github.com/user/emails') return json([{ email: 'old@example.in', primary: false, verified: true }, { email: person.github!.email, primary: true, verified: true }]);
      return json({ error: 'unexpected' }, 404);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const cookieValue = (res: request.Response, name: string) => {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`));
  return raw ? { raw, value: raw.split(';')[0].slice(name.length + 1) } : null;
};

/** Runs a full sign-in for `provider`; returns the session cookie header and the callback response. */
async function signIn(provider: 'google' | 'github', who: Person, returnTo = '/app/') {
  person = who;
  const start = await request(app).get(`${api}/auth/${provider}`).query({ return: returnTo });
  const state = new URL(start.headers.location).searchParams.get('state')!;
  const stateCookie = cookieValue(start, 'profyn_oauth')!;
  const cb = await request(app).get(`${api}/auth/${provider}/callback`).query({ code: 'good-code', state }).set('Cookie', `profyn_oauth=${stateCookie.value}`);
  const session = cookieValue(cb, 'profyn_session');
  return { start, cb, cookie: session ? `profyn_session=${session.value}` : '', session };
}

describe('provider sign-in', () => {
  it('lists the configured providers', async () => {
    expect((await request(app).get(`${api}/auth/providers`)).body).toEqual({ google: true, github: true, email: false });
    const off = createApp({ auth: noCognito, oauth: { ...oauth, google: null, github: null } });
    expect((await request(off).get(`${api}/auth/providers`)).body).toEqual({ google: false, github: false, email: false });
    expect((await request(off).get(`${api}/auth/google`)).status).toBe(404);
  });

  it('starts with a redirect to Google carrying a state that matches a signed, short-lived cookie', async () => {
    const r = await request(app).get(`${api}/auth/google`).query({ return: '/app/?tab=ledger' });
    expect(r.status).toBe(302);
    const to = new URL(r.headers.location);
    expect(to.origin + to.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(to.searchParams.get('redirect_uri')).toBe('https://profyn.example/api/v1/auth/google/callback');
    expect(to.searchParams.get('scope')).toBe('openid email profile');
    expect(to.searchParams.get('client_id')).toBe('google-client');
    const c = cookieValue(r, 'profyn_oauth')!;
    expect(c.raw).toMatch(/HttpOnly/);
    expect(c.raw).toMatch(/SameSite=Lax/);
    expect(c.raw).toMatch(/Secure/);
    expect(c.raw).toMatch(/Path=\/api\/v1\/auth/);
    expect(c.raw).toMatch(/Max-Age=600/);
    expect(verifyJwt<{ st: string; r: string }>(decodeURIComponent(c.value), oauth.sessionSecret!)).toMatchObject({ st: to.searchParams.get('state'), r: '/app/?tab=ledger' });
  });

  it('the Google callback exchanges the code on the server, sets the session cookie and returns to the app', async () => {
    const { cb, session, cookie } = await signIn('google', { google: { sub: 'g-111', email: 'asha@brand.in', name: 'Asha Rao' } }, '/app/?tab=ledger');
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('/app/?tab=ledger');
    expect(session!.raw).toMatch(/HttpOnly/);
    expect(session!.raw).toMatch(/Secure/);
    expect(session!.raw).toMatch(/SameSite=Lax/);
    expect(session!.raw).toMatch(/Path=\/;/);
    expect(session!.raw).toMatch(new RegExp(`Max-Age=${7 * 86400}`));
    const token = fetchCalls.find((c) => c.url === 'https://oauth2.googleapis.com/token')!;
    const form = new URLSearchParams(token.body);
    expect(Object.fromEntries(form)).toMatchObject({ code: 'good-code', client_secret: 'google-secret', grant_type: 'authorization_code', redirect_uri: 'https://profyn.example/api/v1/auth/google/callback' });

    const me = await request(app).get(`${api}/me`).set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ user: { email: 'asha@brand.in', name: 'Asha Rao', provider: 'google' }, consent: { ai: false, email_digest: false }, workspace: 'account' });
    expect(me.body.logins).toHaveLength(1);
    expect(me.body.logins[0]).toMatchObject({ provider: 'google' });
    expect(me.body.logins[0].ip_hash).toMatch(/^[0-9a-f]{12}$/);
    // The same person signing in again is the same account, with two sign-ins.
    const again = await signIn('google', { google: { sub: 'g-111', email: 'asha@brand.in', name: 'Asha Rao' } });
    const me2 = await request(app).get(`${api}/me`).set('Cookie', again.cookie);
    expect(me2.body.user._id).toBe(me.body.user._id);
    expect(me2.body.logins).toHaveLength(2);
  });

  it('GitHub sign-in reads the primary verified email', async () => {
    const { cb, cookie } = await signIn('github', { github: { id: 4242, login: 'ravi-k', email: 'ravi@brand.in' } });
    expect(cb.status).toBe(302);
    const me = await request(app).get(`${api}/me`).set('Cookie', cookie);
    expect(me.body.user).toMatchObject({ email: 'ravi@brand.in', name: 'ravi-k', provider: 'github' });
  });

  it('a bad or missing state is 400; nothing is signed in', async () => {
    const start = await request(app).get(`${api}/auth/google`);
    const stateCookie = cookieValue(start, 'profyn_oauth')!;
    const wrong = await request(app).get(`${api}/auth/google/callback`).query({ code: 'x', state: 'not-the-state' }).set('Cookie', `profyn_oauth=${stateCookie.value}`);
    expect([wrong.status, wrong.body.error.code]).toEqual([400, 'invalid_state']);
    expect(cookieValue(wrong, 'profyn_session')).toBeNull();
    const state = new URL(start.headers.location).searchParams.get('state')!;
    const noCookie = await request(app).get(`${api}/auth/google/callback`).query({ code: 'x', state });
    expect(noCookie.status).toBe(400);
    // A state started for GitHub is not accepted by the Google callback.
    const gh = await request(app).get(`${api}/auth/github`);
    const ghState = new URL(gh.headers.location).searchParams.get('state')!;
    const crossed = await request(app).get(`${api}/auth/google/callback`).query({ code: 'x', state: ghState }).set('Cookie', `profyn_oauth=${cookieValue(gh, 'profyn_oauth')!.value}`);
    expect(crossed.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });

  it('only same-site return paths are honoured', async () => {
    for (const evil of ['//evil.example/app/', 'https://evil.example/', '/\\evil.example']) {
      const { cb } = await signIn('google', { google: { sub: 'g-222', email: 'x@brand.in', name: 'X' } }, evil);
      expect(cb.headers.location).toBe('/app/');
    }
  });

  it('a refused code exchange returns to the app with auth_error and no session', async () => {
    person = { google: { sub: 'g-333', email: 'y@brand.in', name: 'Y' } };
    const start = await request(app).get(`${api}/auth/google`);
    const state = new URL(start.headers.location).searchParams.get('state')!;
    const cb = await request(app).get(`${api}/auth/google/callback`).query({ code: 'bad', state }).set('Cookie', `profyn_oauth=${cookieValue(start, 'profyn_oauth')!.value}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('/app/?auth_error=oauth_failed');
    expect(cookieValue(cb, 'profyn_session')).toBeNull();
  });

  it('a tampered or expired session cookie is a guest; logout clears the cookie', async () => {
    const { cookie } = await signIn('google', { google: { sub: 'g-444', email: 'z@brand.in', name: 'Z' } });
    const tampered = cookie.slice(0, -3) + (cookie.endsWith('abc') ? 'xyz' : 'abc');
    const r = await request(app).get(`${api}/me`).set('Cookie', tampered);
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ user: null, workspace: 'demo' });
    const expired = signJwt({ iss: 'profyn', sub: 'anyone', provider: 'google', email: null, name: null, iat: 1, exp: 2 }, oauth.sessionSecret!);
    expect((await request(app).get(`${api}/me`).set('Cookie', `profyn_session=${expired}`)).status).toBe(401);
    const out = await request(app).post(`${api}/auth/logout`).set('Cookie', cookie);
    expect(out.status).toBe(204);
    expect(cookieValue(out, 'profyn_session')!.raw).toMatch(/Max-Age=0/);
  });

  it('consent is off by default, can be changed, and rides on req.user', async () => {
    const { cookie } = await signIn('google', { google: { sub: 'g-555', email: 'c@brand.in', name: 'C' } });
    const p = await request(app).patch(`${api}/me/consent`).set('Cookie', cookie).send({ ai: true });
    expect(p.body.consent).toEqual({ ai: true, email_digest: false });
    expect((await request(app).get(`${api}/me`).set('Cookie', cookie)).body.consent).toEqual({ ai: true, email_digest: false });
    expect((await request(app).patch(`${api}/me/consent`).set('Cookie', cookie).send({ ai: 'yes' })).status).toBe(422);
    expect((await request(app).patch(`${api}/me/consent`).send({ ai: true })).status).toBe(401);
  });
});

describe('owner isolation with session cookies', () => {
  it('user A’s analysis is 404 for user B and for guests', async () => {
    const a = await signIn('google', { google: { sub: 'g-aaa', email: 'a@brand.in', name: 'A' } });
    const b = await signIn('github', { github: { id: 777, login: 'bee', email: 'b@brand.in' } });
    const d = await request(app).post(`${api}/datasets`).set('Cookie', a.cookie).send({ source: 'fixture' });
    const an = await request(app).post(`${api}/datasets/${d.body.dataset_id}/analyses`).set('Cookie', a.cookie).send({});
    expect(an.status).toBe(201);
    expect((await request(app).get(`${api}/analyses/${an.body.analysis_id}`).set('Cookie', a.cookie)).status).toBe(200);
    expect((await request(app).get(`${api}/analyses/${an.body.analysis_id}`).set('Cookie', b.cookie)).status).toBe(404);
    expect((await request(app).get(`${api}/analyses/${an.body.analysis_id}`)).status).toBe(404);
    expect((await request(app).get(`${api}/datasets/${d.body.dataset_id}`).set('Cookie', b.cookie)).status).toBe(404);
    const ws = await request(app).get(`${api}/workspace`).set('Cookie', a.cookie);
    expect(ws.body.workspace).toBe('account');
    expect(ws.body.latest.analysis_id).toBe(an.body.analysis_id);
  });

  it('a Cognito bearer and a session cookie resolve to the same req.user shape; Cognito users are recorded too', async () => {
    const cognito: AuthSettings = {
      enabled: true,
      verify: async (t) => {
        if (t !== 'token-e') throw new Error('bad');
        return { sub: 'cognito-sub-e', email: 'e@brand.in' };
      },
      publicConfig: { enabled: true, domain: 'x.auth.ap-south-1.amazoncognito.com', client_id: 'c', region: 'ap-south-1' },
    };
    const both = createApp({ auth: cognito, oauth });
    const me = await request(both).get(`${api}/me`).set('Authorization', 'Bearer token-e');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ _id: 'cognito-sub-e', sub: 'cognito-sub-e', email: 'e@brand.in', provider: 'email' });
    expect(me.body.logins[0]).toMatchObject({ provider: 'email' });
    expect((await request(both).get(`${api}/auth/providers`)).body).toEqual({ google: true, github: true, email: true });
    expect((await request(both).get(`${api}/me`).set('Authorization', 'Bearer nope')).status).toBe(401);
  });
});
