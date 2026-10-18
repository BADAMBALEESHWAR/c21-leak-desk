import { existsSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../api/src/app';
import type { AuthSettings } from '../api/src/auth';
import type { OAuthSettings } from '../api/src/auth-oauth';
import { audit } from '../api/src/audit';
import { DATA } from './helpers';

// v2 §5.2 (trust): audit log, full export and hard delete per account; security headers; health region.
// §7: API error messages in the caller's language (Accept-Language), English unchanged.

const oauth: OAuthSettings = {
  google: { clientId: 'gc', clientSecret: 'gs' },
  github: null,
  sessionSecret: 'account-test-secret-0123456789abcdef',
  publicUrl: 'http://localhost:5173',
  secureCookies: false,
};
const noCognito: AuthSettings = { enabled: false, verify: null, publicConfig: { enabled: false, domain: null, client_id: null, region: 'ap-south-1' } };
const app = createApp({ auth: noCognito, oauth });
const api = '/api/v1';

let who = { sub: 'g-1', email: 'one@brand.in', name: 'One' };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (String(url).includes('/token') ? json({ access_token: 't' }) : json({ ...who, email_verified: true }))),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function signIn(sub: string, email: string) {
  who = { sub, email, name: email.split('@')[0] };
  const start = await request(app).get(`${api}/auth/google`);
  const state = new URL(start.headers.location).searchParams.get('state')!;
  const stateCookie = ([] as string[]).concat(start.headers['set-cookie']).find((c) => c.startsWith('profyn_oauth='))!.split(';')[0];
  const cb = await request(app).get(`${api}/auth/google/callback`).query({ code: 'c', state }).set('Cookie', stateCookie);
  const session = ([] as string[]).concat(cb.headers['set-cookie']).find((c) => c.startsWith('profyn_session='))!;
  // localhost PUBLIC_URL: no Secure flag, so plain-http development works.
  expect(session).not.toMatch(/Secure/);
  return session.split(';')[0];
}

const CSV =
  'order_id,date,gross_inr,discount_inr,refund_inr,net_sales_inr,product_cost_inr,recovered_product_cost_inr,shipping_inr,payment_fee_inr,return_cost_inr,returned\nZ1,2026-09-20,1000,0,0,1000,400,0,60,20,0,false\n';

async function workIn(cookie: string) {
  const d = await request(app).post(`${api}/datasets`).set('Cookie', cookie).attach('file', Buffer.from(CSV), 'september.csv');
  const a = await request(app).post(`${api}/datasets/${d.body.dataset_id}/analyses`).set('Cookie', cookie).send({});
  const s = await request(app).post(`${api}/analyses/${a.body.analysis_id}/scenarios`).set('Cookie', cookie).send({ overrides: { recovery_pct: 90 } });
  const body = { intervention: 'charge_return_shipping', expected_delta_inr: 200, test_30d: 'Charge return shipping for 30 days.', stop_rule: 'Stop if orders fall.', owner: 'Ops lead' };
  const dec = await request(app).post(`${api}/analyses/${a.body.analysis_id}/decisions`).set('Cookie', cookie).send(body);
  await request(app).get(`${api}/decisions/${dec.body.decision_id}/export?format=md`).set('Cookie', cookie);
  return { datasetId: d.body.dataset_id as string, analysisId: a.body.analysis_id as string, scenarioId: s.body.scenario_id as string, decisionId: dec.body.decision_id as string };
}

describe('audit log, export and delete', () => {
  it('guests have no account endpoints', async () => {
    expect((await request(app).get(`${api}/me/audit`)).status).toBe(401);
    expect((await request(app).get(`${api}/me/export`)).status).toBe(401);
    expect((await request(app).delete(`${api}/me`).send({ confirm: 'DELETE' })).status).toBe(401);
  });

  it('the audit log lists sign-ins, imports, decisions, exports and AI calls, newest first', async () => {
    const cookie = await signIn('g-audit', 'audit@brand.in');
    const ids = await workIn(cookie);
    // The AI builder records calls through audit.record(req, …): field names only.
    const me = await request(app).get(`${api}/me`).set('Cookie', cookie);
    await audit.record({ user: { sub: me.body.user._id, email: null } }, { kind: 'ai_call', feature: 'advisor', model: 'gemini-2.5-flash', fields_sent: ['leak_totals', 'return_rate_pct'], accepted: true });
    await new Promise((r) => setTimeout(r, 20));
    const log = (await request(app).get(`${api}/me/audit`).set('Cookie', cookie)).body as Array<{ at: string; kind: string; detail: string; data: Record<string, unknown> }>;
    const kinds = log.map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['login', 'import', 'decision', 'export', 'ai_call']));
    expect(log[0].kind).toBe('ai_call');
    expect(log.find((e) => e.kind === 'ai_call')!.detail).toBe('AI advisor via gemini-2.5-flash: sent leak_totals, return_rate_pct; accepted.');
    expect(log.find((e) => e.kind === 'import')!).toMatchObject({ detail: 'Imported 1 orders from september.csv.', data: { dataset_id: ids.datasetId } });
    expect(log.find((e) => e.kind === 'decision')!.data).toEqual({ analysis_id: ids.analysisId });
    for (const e of log) expect(Date.parse(e.at)).not.toBeNaN();
  });

  it('export returns every record of the owner as a JSON attachment, and nobody else’s', async () => {
    const cookieA = await signIn('g-exp-a', 'expa@brand.in');
    const cookieB = await signIn('g-exp-b', 'expb@brand.in');
    const a = await workIn(cookieA);
    const b = await workIn(cookieB);
    await request(app).post(`${api}/import/mappings`).set('Cookie', cookieA).send({ headers: ['Ref', 'Day'], mapping: { order_id: 'Ref', date: 'Day' } });
    const r = await request(app).get(`${api}/me/export`).set('Cookie', cookieA);
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/^attachment; filename="profyn-export-\d{4}-\d{2}-\d{2}\.json"$/);
    const x = r.body;
    expect(x.user).toMatchObject({ email: 'expa@brand.in', provider: 'google' });
    expect(x.datasets.map((d: { _id: string }) => d._id)).toEqual([a.datasetId]);
    expect(x.datasets[0].rows).toHaveLength(1);
    expect(x.analyses.map((d: { _id: string }) => d._id)).toEqual([a.analysisId]);
    expect(x.scenarios.map((d: { _id: string }) => d._id)).toEqual([a.scenarioId]);
    expect(x.decisions.map((d: { _id: string }) => d._id)).toEqual([a.decisionId]);
    expect(x.column_mappings).toHaveLength(1);
    expect(x.logins.length).toBeGreaterThanOrEqual(1);
    expect(x.audit.some((e: { kind: string }) => e.kind === 'import')).toBe(true);
    expect(x.consent).toEqual({ ai: false, email_digest: false });
    const text = JSON.stringify(x);
    for (const id of Object.values(b)) expect(text).not.toContain(id);
    expect(text).not.toContain('expb@brand.in');
  });

  it('DELETE /me needs {confirm:"DELETE"}, then removes every record, upload and sign-in of the owner (204)', async () => {
    const cookieA = await signIn('g-del-a', 'dela@brand.in');
    const cookieB = await signIn('g-del-b', 'delb@brand.in');
    const a = await workIn(cookieA);
    const b = await workIn(cookieB);
    const upload = path.join(DATA, 'uploads', 'uploads', `${a.datasetId}-september.csv`);
    expect(existsSync(upload)).toBe(true);

    const refused = await request(app).delete(`${api}/me`).set('Cookie', cookieA).send({ confirm: 'yes' });
    expect([refused.status, refused.body.error.path]).toEqual([422, 'confirm']);

    const del = await request(app).delete(`${api}/me`).set('Cookie', cookieA).send({ confirm: 'DELETE' });
    expect(del.status).toBe(204);
    expect(([] as string[]).concat(del.headers['set-cookie']).join(';')).toMatch(/profyn_session=;.*Max-Age=0/);
    expect(existsSync(upload)).toBe(false);

    // The old cookie no longer signs anyone in, and the records are gone.
    expect((await request(app).get(`${api}/me`).set('Cookie', cookieA)).status).toBe(401);
    expect((await request(app).get(`${api}/analyses/${a.analysisId}`).set('Cookie', cookieA)).status).toBe(404);
    expect((await request(app).get(`${api}/datasets/${a.datasetId}`)).status).toBe(404);
    expect((await request(app).get(`${api}/scenarios/${a.scenarioId}`)).status).toBe(404);
    expect((await request(app).get(`${api}/decisions/${a.decisionId}`)).status).toBe(404);
    // Another owner is untouched.
    expect((await request(app).get(`${api}/analyses/${b.analysisId}`).set('Cookie', cookieB)).status).toBe(200);
    expect((await request(app).get(`${api}/decisions/${b.decisionId}`).set('Cookie', cookieB)).status).toBe(200);
    // Signing in again starts a fresh, empty account.
    const again = await signIn('g-del-a', 'dela@brand.in');
    const fresh = (await request(app).get(`${api}/me/export`).set('Cookie', again)).body;
    expect([fresh.datasets.length, fresh.analyses.length, fresh.decisions.length]).toEqual([0, 0, 0]);
  });
});

describe('security headers and region', () => {
  it('HSTS for a year with subdomains, plus the existing helmet headers; health names the region', async () => {
    const r = await request(app).get(`${api}/health`);
    expect(r.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.body.region).toBe('local');
  });
});

describe('localized API errors', () => {
  it('the same 422 reads in English by default and in Telugu or Hindi on request', async () => {
    const en = await request(app).post(`${api}/import/map`).send({});
    const te = await request(app).post(`${api}/import/map`).set('Accept-Language', 'te-IN,te;q=0.9,en;q=0.5').send({});
    const hi = await request(app).post(`${api}/import/map?lang=hi`).send({});
    expect([en.status, te.status, hi.status]).toEqual([422, 422, 422]);
    expect(en.body.error).toMatchObject({ code: 'schema_invalid', message: 'headers Required', hint: 'Fix the named field and send again.' });
    expect(te.body.error).toMatchObject({ code: 'schema_invalid', path: 'headers', message: 'headers అవసరం', hint: 'పేర్కొన్న ఫీల్డ్‌ను సరిచేసి మళ్లీ పంపండి.' });
    expect(te.body.error.issues[0].message).toBe('అవసరం');
    expect(te.headers['content-language']).toBe('te');
    expect(hi.body.error.message).toBe('headers आवश्यक है');
  });

  it('messages with values keep the values and translate the words', async () => {
    const te = await request(app).get(`${api}/datasets/abc123`).set('Accept-Language', 'te');
    expect(te.body.error).toMatchObject({ code: 'not_found', message: 'డేటాసెట్ abc123 కనబడలేదు.', hint: 'ముందుగా ఒక డేటాసెట్ లోడ్ చేసి విశ్లేషణ నడపండి.' });
    const hi = await request(app).get(`${api}/nope`).set('Accept-Language', 'hi');
    expect(hi.body.error.message).toBe('GET /api/v1/nope के लिए कोई रूट नहीं है।');
    const en = await request(app).get(`${api}/nope`);
    expect(en.body.error.message).toBe('No route for GET /api/v1/nope.');
    // Row problems inside "Every row was rejected" are translated too.
    const bad = 'order_id,date,gross_inr,discount_inr,product_cost_inr,shipping_inr,returned\nB1,2026-09-02,-5,0,10,10,false\n';
    const rejected = await request(app).post(`${api}/datasets`).set('Accept-Language', 'te').set('Content-Type', 'text/csv').send(bad);
    expect(rejected.status).toBe(422);
    expect(rejected.body.error.message).toBe('ప్రతి వరుస తిరస్కరించబడింది. మొదటి సమస్య: B1లో gross_inr రుణాత్మకం కాకూడదు — వరుస తొలగించబడింది.');
  });
});
