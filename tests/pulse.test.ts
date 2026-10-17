import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../api/src/app';
import { analyze } from '../api/src/engine/analyze';
import { pulseChannels, pulseInsights, pulseMonths, pulseOverview, pulseProducts } from '../api/src/engine/pulse';
import { FIXTURE, rows } from './helpers';

// Pulse reads the same reconciled orders as the ledger, so its totals must equal the ledger's.
const demo = rows('demo_12m.json');

describe('Pulse owner analytics (12-month synthetic demo)', () => {
  for (const mode of ['allocate', 'channel'] as const) {
    it(`monthly contribution sums to the reconciled total in ${mode} mode`, () => {
      const a = analyze(demo, { attribution: mode });
      const m = pulseMonths(a).months;
      expect(m).toHaveLength(12);
      expect(m.reduce((s, x) => s + x.contribution_inr, 0)).toBe(a.totals.contribution_inr);
      expect(m.reduce((s, x) => s + x.net_sales_inr, 0)).toBe(a.totals.net_sales_inr);
      expect(pulseProducts(a).products.reduce((s, x) => s + x.contribution_inr, 0)).toBe(a.totals.contribution_inr);
    });
  }

  const a = analyze(demo, { attribution: 'allocate' });

  it('finds the festive month as best for net sales and worst for contribution', () => {
    const o = pulseOverview(a);
    expect(o.best.net_sales?.month).toBe('2025-10');
    expect(o.worst.contribution?.month).toBe('2025-10');
    expect(o.month).toBe('2026-09');
    expect(o.deltas?.net_sales_pct).not.toBeNull();
  });

  it('ranks P2 first on units but labels it "fix" with the returns lever', () => {
    const p2 = pulseProducts(a).products.find((p) => p.product_id === 'P2')!;
    expect(p2.rank_units).toBe(1);
    expect(p2.rank_contribution).toBeGreaterThan(3);
    expect([p2.label, p2.lever]).toEqual(['fix', 'returns']);
  });

  it('shows COD returning far more often than prepaid and Instagram losing money', () => {
    const c = pulseChannels(a);
    expect('rows' in c.payments && c.payments.cod_vs_prepaid_return_ratio).toBeGreaterThan(2);
    expect(c.channels.find((x) => x.channel === 'instagram')!.contribution_inr).toBeLessThan(0);
  });

  it('gives three actions ranked by recoverable rupees, each with a number in its text', () => {
    const actions = pulseOverview(a).actions;
    expect(actions).toHaveLength(3);
    for (let i = 1; i < actions.length; i++) expect(actions[i - 1].recoverable_inr).toBeGreaterThanOrEqual(actions[i].recoverable_inr);
    for (const x of actions) expect(x.detail).toMatch(/₹ [\d,]+/);
  });

  it('finds the discount depth where orders turn negative, and repeat orders earning more', () => {
    const i = pulseInsights(a);
    expect(i.negative_from_discount_band).toBe('30%+');
    expect('repeat_rate_pct' in i.repeat && (i.repeat.contribution_per_order_repeat_inr as number) > (i.repeat.contribution_per_order_first_inr as number)).toBe(true);
  });

  it('says "not in file" when payment type and customers are missing (the C21 fixture)', () => {
    const f = analyze(rows(FIXTURE), { attribution: 'allocate' });
    expect(pulseChannels(f).payments).toEqual({ not_in_file: true });
    expect(pulseInsights(f).repeat).toEqual({ not_in_file: true });
    expect(pulseMonths(f).months).toHaveLength(1);
  });

  it('names no best or weakest month when the file has only one month (nothing to compare)', () => {
    const o = pulseOverview(analyze(rows(FIXTURE), { attribution: 'allocate' }));
    expect([o.best, o.worst, o.deltas]).toEqual([null, null, null]);
    expect(pulseOverview(a).best?.net_sales?.month).not.toBe(pulseOverview(a).worst?.net_sales?.month);
  });

  it('serves every view over the API and rejects an unknown one', async () => {
    const app = createApp();
    const d = await request(app).post('/api/v1/datasets').send({ source: 'demo_12m' });
    expect(d.body.rows_kept).toBe(demo.length);
    const id = (await request(app).post(`/api/v1/datasets/${d.body.dataset_id}/analyses`).send({})).body.analysis_id;
    for (const view of ['overview', 'months', 'products', 'channels', 'leaks', 'insights']) {
      const r = await request(app).get(`/api/v1/analyses/${id}/pulse/${view}`);
      expect(r.status, view).toBe(200);
      expect(r.body.labels.length, view).toBeGreaterThan(0);
    }
    expect((await request(app).get(`/api/v1/analyses/${id}/pulse/overview?month=2025-10`)).body.month).toBe('2025-10');
    expect((await request(app).get(`/api/v1/analyses/${id}/pulse/nope`)).status).toBe(404);
  });

  it('the demo file never changes the public checks', async () => {
    const r = await request(createApp()).get('/api/v1/checks');
    expect(r.body.all_pass).toBe(true);
    expect(r.body.check2.allocate_total).toBe(7053);
  });
});
