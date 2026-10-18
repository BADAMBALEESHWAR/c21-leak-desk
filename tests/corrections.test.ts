import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../api/src/app';
import type { AuthSettings } from '../api/src/auth';

// Fixing a flagged row: PATCH /datasets/:id/rows re-runs the same validation and saves a new dataset version.

const api = '/api/v1';
const app = createApp();

async function load(source: string, a = app, token?: string) {
  const r = request(a).post(`${api}/datasets`).send({ source });
  return (await (token ? r.set('Authorization', `Bearer ${token}`) : r)).body;
}

describe('corrections', () => {
  it('fixing null_refund O05 refund_inr gives a new version without the unknown flag; the old version is unchanged', async () => {
    const old = await load('null_refund');
    expect(old.flags.some((f: any) => f.order_id === 'O05' && f.reason === 'unknown')).toBe(true);
    expect(old.corrections).toEqual([]);

    const r = await request(app).patch(`${api}/datasets/${old.dataset_id}/rows`).send({ order_id: 'O05', changes: { refund_inr: 900 }, note: 'Refund confirmed in the payment gateway report.' });
    expect(r.status).toBe(201);
    expect(r.body.dataset_id).not.toBe(old.dataset_id);
    expect(r.body).toMatchObject({ supersedes: old.dataset_id, rows_kept: 20, still_flagged: [], corrected_order_ids: ['O05'] });
    expect(r.body.corrections).toEqual([
      { order_id: 'O05', line: expect.any(Number), field: 'refund_inr', from: null, to: 900, at: expect.any(String), by: 'guest', note: 'Refund confirmed in the payment gateway report.' },
    ]);
    expect(r.body.corrections_added).toEqual(r.body.corrections);
    expect(r.body.flags.some((f: any) => f.order_id === 'O05')).toBe(false);

    const analysis = (await request(app).post(`${api}/datasets/${r.body.dataset_id}/analyses`).send({})).body;
    expect(analysis.totals.unknown_count).toBe(0);
    expect(analysis.totals.contribution_inr).toBe(6000);

    const before = (await request(app).get(`${api}/datasets/${old.dataset_id}`)).body;
    expect(before.flags.some((f: any) => f.order_id === 'O05' && f.reason === 'unknown')).toBe(true);
    expect(before.corrections).toEqual([]);
    expect((await request(app).post(`${api}/datasets/${old.dataset_id}/analyses`).send({})).body.totals.unknown_count).toBe(1);

    const after = (await request(app).get(`${api}/datasets/${r.body.dataset_id}`)).body;
    expect(after).toMatchObject({ corrected_order_ids: ['O05'], corrections: r.body.corrections });
  });

  it('fixing a rejected row from refund_over_gross (O03 refund 1500 → 150) moves it into the kept rows', async () => {
    const old = await load('refund_over_gross');
    expect(old.rows_kept).toBe(19);
    expect(old.rejected_rows).toEqual([expect.objectContaining({ order_id: 'O03', line: expect.any(Number), raw: expect.objectContaining({ refund_inr: 1500 }) })]);

    const r = await request(app).patch(`${api}/datasets/${old.dataset_id}/rows`).send({ order_id: 'O03', changes: { refund_inr: 150 } });
    expect(r.status).toBe(201);
    expect([r.body.rows_kept, r.body.rows_rejected, r.body.rejected_rows]).toEqual([20, 0, []]);
    expect(r.body.kept_ids).toContain('O03');
    expect(r.body.still_flagged).toEqual([]);
    expect(r.body.corrections[0]).toMatchObject({ order_id: 'O03', field: 'refund_inr', from: 1500, to: 150 });
  });

  it('a rejected row is found by its line too; corrections carry over to the next version', async () => {
    const old = await load('bad_values');
    const r1 = await request(app).patch(`${api}/datasets/${old.dataset_id}/rows`).send({ line: 4, changes: { product_cost_inr: 400 } });
    expect(r1.status).toBe(201);
    expect(r1.body.kept_ids).toContain('O03');
    const r2 = await request(app).patch(`${api}/datasets/${r1.body.dataset_id}/rows`).send({ line: 9, changes: { date: '2026-09-09' } });
    expect(r2.body.corrections.map((c: any) => [c.order_id, c.line, c.field])).toEqual([
      ['O03', 4, 'product_cost_inr'],
      ['O08', 9, 'date'],
    ]);
    expect(r2.body.rejected_rows.map((x: any) => [x.order_id, x.line])).toEqual([['O06', 7]]);
    expect(r2.body.flags.filter((f: any) => f.action === 'rejected').map((f: any) => f.line)).toEqual([7]);
  });

  it('a negative value is 422 with the reason, and nothing is saved', async () => {
    const old = await load('null_refund');
    const r = await request(app).patch(`${api}/datasets/${old.dataset_id}/rows`).send({ order_id: 'O05', changes: { refund_inr: -900 } });
    expect([r.status, r.body.error.code, r.body.error.path]).toEqual([422, 'schema_invalid', 'changes.refund_inr']);
    expect(r.body.error.message).toBe('refund_inr must not be negative.');
    const impossible = await request(app).patch(`${api}/datasets/${old.dataset_id}/rows`).send({ order_id: 'O05', changes: { refund_inr: 5000 } });
    expect([impossible.status, impossible.body.error.path]).toEqual([422, 'changes.refund_inr']);
    expect((await request(app).get(`${api}/datasets/${old.dataset_id}`)).body.corrections).toEqual([]);
  });

  it('another account gets 404', async () => {
    const auth: AuthSettings = {
      enabled: true,
      verify: async (t) => {
        if (t === 'token-a') return { sub: 'user-a', email: 'a@brand.in' };
        if (t === 'token-b') return { sub: 'user-b', email: 'b@brand.in' };
        throw new Error('bad token');
      },
      publicConfig: { enabled: true, domain: 'x', client_id: 'y', region: 'ap-south-1' },
    };
    const signed = createApp({ auth });
    const mine = await load('null_refund', signed, 'token-a');
    const other = await request(signed).patch(`${api}/datasets/${mine.dataset_id}/rows`).set('Authorization', 'Bearer token-b').send({ order_id: 'O05', changes: { refund_inr: 900 } });
    expect([other.status, other.body.error.code]).toEqual([404, 'not_found']);
    const own = await request(signed).patch(`${api}/datasets/${mine.dataset_id}/rows`).set('Authorization', 'Bearer token-a').send({ order_id: 'O05', changes: { refund_inr: 900 } });
    expect(own.status).toBe(201);
    expect(own.body.corrections[0].by).toBe('user-a');
  });

  it('unknown rows and fields are refused', async () => {
    const old = await load('fixture');
    expect((await request(app).patch(`${api}/datasets/${old.dataset_id}/rows`).send({ order_id: 'NOPE', changes: { refund_inr: 1 } })).status).toBe(404);
    expect((await request(app).patch(`${api}/datasets/${old.dataset_id}/rows`).send({ order_id: 'O01', changes: { order_id: 'X' } })).status).toBe(422);
    expect((await request(app).patch(`${api}/datasets/${old.dataset_id}/rows`).send({ order_id: 'O01', changes: {} })).status).toBe(422);
  });
});
