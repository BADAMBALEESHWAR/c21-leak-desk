import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../api/src/app';
import type { AuthSettings } from '../api/src/auth';
import { DecisionModel } from '../api/src/models';

// Tests run without Mongo; this switch stands in for a connected database for one save.
const db = vi.hoisted(() => ({ connected: false }));
vi.mock('../api/src/db', async (load) => {
  const real = await load<typeof import('../api/src/db')>();
  return { ...real, dbState: () => (db.connected ? 'connected' : real.dbState()) };
});

// Sign-in with a stand-in verifier (no AWS needed). Two users and a guest.
const USERS: Record<string, { sub: string; email: string }> = {
  'token-a': { sub: 'user-a', email: 'a@brand.in' },
  'token-b': { sub: 'user-b', email: 'b@brand.in' },
};
const auth: AuthSettings = {
  enabled: true,
  verify: async (t) => {
    if (!USERS[t]) throw new Error('bad token');
    return USERS[t];
  },
  publicConfig: { enabled: true, domain: 'profyn-auth.auth.ap-south-1.amazoncognito.com', client_id: 'test-client', region: 'ap-south-1' },
};
const app = createApp({ auth });
const api = '/api/v1';
const as = (t?: string) => (r: request.Test) => (t ? r.set('Authorization', `Bearer ${t}`) : r);

async function decide(token?: string) {
  const d = await as(token)(request(app).post(`${api}/datasets`).send({ source: 'fixture' }));
  const a = await as(token)(request(app).post(`${api}/datasets/${d.body.dataset_id}/analyses`).send({}));
  const body = { intervention: 'charge_return_shipping', expected_delta_inr: 200, test_30d: 'Charge return shipping for 30 days.', stop_rule: 'Stop if orders fall.', owner: 'Ops lead' };
  const s = await as(token)(request(app).post(`${api}/analyses/${a.body.analysis_id}/decisions`).send(body));
  return { analysisId: a.body.analysis_id as string, decision: s.body };
}

describe('sign-in and accounts', () => {
  it('publishes only public sign-in settings', async () => {
    const r = await request(app).get(`${api}/auth/config`);
    expect(r.body).toEqual(auth.publicConfig);
    expect(JSON.stringify(r.body)).not.toMatch(/secret/i);
  });

  it('/me shows the signed-in user, or a guest in the demo workspace', async () => {
    expect((await request(app).get(`${api}/me`).set('Authorization', 'Bearer token-a')).body).toMatchObject({ user: { email: 'a@brand.in' }, workspace: 'account' });
    expect((await request(app).get(`${api}/me`)).body).toMatchObject({ user: null, auth_enabled: true, workspace: 'demo' });
  });

  it('a bad token is 401 with a clear message; no token is never blocked', async () => {
    const bad = await request(app).get(`${api}/me`).set('Authorization', 'Bearer nope');
    expect([bad.status, bad.body.error.code]).toEqual([401, 'unauthorized']);
    expect((await request(app).get(`${api}/checks`)).body.all_pass).toBe(true);
    expect((await request(app).get(`${api}/worked-order`)).body.contribution_inr).toBe(230);
  });

  it('a guest decision is saved to the database under account "guest" in the demo workspace; a signed-in decision is the user’s', async () => {
    const d = await request(app).post(`${api}/datasets`).send({ source: 'fixture' });
    const a = await request(app).post(`${api}/datasets/${d.body.dataset_id}/analyses`).send({});
    const body = { intervention: 'charge_return_shipping', expected_delta_inr: 200, test_30d: 'Charge return shipping for 30 days.', stop_rule: 'Stop if orders fall.', owner: 'Ops lead' };
    const create = vi.spyOn(DecisionModel, 'create').mockImplementation((async (doc: unknown) => doc) as never);
    db.connected = true;
    let guest: request.Response;
    let written: unknown[];
    try {
      guest = await request(app).post(`${api}/analyses/${a.body.analysis_id}/decisions`).send(body);
      written = create.mock.calls.map((c) => c[0]);
    } finally {
      db.connected = false;
      create.mockRestore();
    }
    expect(guest.status).toBe(201);
    expect(guest.body).toMatchObject({ persisted: true, workspace: 'demo' });
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ _id: guest.body.decision_id, account: 'guest' });

    const mine = await decide('token-a');
    expect(mine.decision.workspace).toBe('account');
    // Lists stay scoped: the signed-in user never lists the guest's decision, and the guest never lists the user's.
    const listA = (await request(app).get(`${api}/decisions`).set('Authorization', 'Bearer token-a')).body as Array<{ decision_id: string }>;
    const listGuest = (await request(app).get(`${api}/decisions`)).body as Array<{ decision_id: string }>;
    expect(listA.map((x) => x.decision_id)).not.toContain(guest.body.decision_id);
    expect(listGuest.map((x) => x.decision_id)).toContain(guest.body.decision_id);
    expect(listGuest.map((x) => x.decision_id)).not.toContain(mine.decision.decision_id);
  });

  it('users never see each other’s analyses or decisions', async () => {
    const { analysisId, decision } = await decide('token-a');
    expect((await request(app).get(`${api}/analyses/${analysisId}`).set('Authorization', 'Bearer token-b')).status).toBe(404);
    expect((await request(app).get(`${api}/analyses/${analysisId}`)).status).toBe(404);
    expect((await request(app).get(`${api}/decisions/${decision.decision_id}`).set('Authorization', 'Bearer token-b')).status).toBe(404);
    expect((await request(app).get(`${api}/analyses/${analysisId}`).set('Authorization', 'Bearer token-a')).status).toBe(200);
    const listB = (await request(app).get(`${api}/decisions`).set('Authorization', 'Bearer token-b')).body as Array<{ decision_id: string }>;
    expect(listB.some((x) => x.decision_id === decision.decision_id)).toBe(false);
  });

  it('the workspace lists only the signed-in owner\'s saved data, newest first, with its latest analysis', async () => {
    const mine = await decide('token-a');
    const other = await decide('token-b');
    const ws = (await request(app).get(`${api}/workspace`).set('Authorization', 'Bearer token-a')).body;
    expect(ws.workspace).toBe('account');
    expect(ws.user.email).toBe('a@brand.in');
    const ids = ws.datasets.map((d: { latest_analysis: { analysis_id: string } | null }) => d.latest_analysis?.analysis_id);
    expect(ids).toContain(mine.analysisId);
    expect(ids).not.toContain(other.analysisId);
    expect(ws.latest.analysis_id).toBe(mine.analysisId);
    expect(ws.datasets[0]).toMatchObject({ rows_kept: 20, latest_analysis: { contribution_inr: 6000 } });
    // Adding to saved data makes a new version; the workspace lists only the newest one.
    const base = ws.datasets.find((d: { latest_analysis: { analysis_id: string } | null }) => d.latest_analysis?.analysis_id === mine.analysisId).dataset_id;
    const csv = 'order_id,date,gross_inr,discount_inr,refund_inr,net_sales_inr,product_cost_inr,recovered_product_cost_inr,shipping_inr,payment_fee_inr,return_cost_inr,returned\nN1,2026-09-20,1000,0,0,1000,400,0,60,20,0,false\nO01,2026-09-02,1000,100,0,900,400,0,60,20,0,false\n';
    const added = await request(app).post(`${api}/datasets`).set('Authorization', 'Bearer token-a').field('append_to', base).attach('file', Buffer.from(csv), 'more.csv');
    expect(added.body).toMatchObject({ rows_kept: 21, rows_added: 1, duplicates_ignored: 1 });
    expect((await request(app).post(`${api}/datasets`).set('Authorization', 'Bearer token-b').field('append_to', base).attach('file', Buffer.from(csv), 'more.csv')).status).toBe(404);
    const ws2 = (await request(app).get(`${api}/workspace`).set('Authorization', 'Bearer token-a')).body;
    const listed = ws2.datasets.map((d: { dataset_id: string }) => d.dataset_id);
    expect(listed).toContain(added.body.dataset_id);
    expect(listed).not.toContain(base);
    const guest = (await request(app).get(`${api}/workspace`)).body;
    expect(guest).toEqual({ workspace: 'demo', user: null, datasets: [], latest: null });
  });

  it('a scenario is only readable by the account that owns its analysis', async () => {
    const { analysisId } = await decide('token-a');
    const s = await as('token-a')(request(app).post(`${api}/analyses/${analysisId}/scenarios`).send({ overrides: { recovery_pct: 90 } }));
    expect(s.status).toBe(201);
    expect((await request(app).get(`${api}/scenarios/${s.body.scenario_id}`).set('Authorization', 'Bearer token-a')).status).toBe(200);
    expect((await request(app).get(`${api}/scenarios/${s.body.scenario_id}`).set('Authorization', 'Bearer token-b')).status).toBe(404);
    expect((await request(app).post(`${api}/scenarios/${s.body.scenario_id}/test-plan`)).status).toBe(404);
  });

  it('with sign-in off (no Cognito settings), everything behaves as before', async () => {
    const plain = createApp({ auth: { enabled: false, verify: null, publicConfig: { enabled: false, domain: null, client_id: null, region: 'ap-south-1' } } });
    expect((await request(plain).get(`${api}/auth/config`)).body.enabled).toBe(false);
    expect((await request(plain).get(`${api}/me`).set('Authorization', 'Bearer anything')).body.user).toBeNull();
  });
});
