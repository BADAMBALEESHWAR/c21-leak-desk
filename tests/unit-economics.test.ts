import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../api/src/app';
import { workedOrderMargins } from '../api/src/checks';
import { analyze } from '../api/src/engine/analyze';
import { computeMargins, netMarginPct, type Margins } from '../api/src/engine/margins';
import type { AnalysisResult, AttributionMode } from '../api/src/engine/types';
import { marginsFor } from '../api/src/routes/analyses';
import { EXTENDED, FIXTURE, rows } from './helpers';

// A2: CM1–CM3 are a pure aggregation of computed orders; their totals end at the reconciled contribution.

const sumOfParts = (m: Margins) => m.net_revenue_inr - m.net_product_cost_inr - m.shipping_inr - m.payment_fee_inr - m.return_cost_inr - m.handling_inr - m.ads_inr;
const totalsOf = (a: AnalysisResult) => computeMargins(a.orders, a.attribution, a.attribution === 'channel' ? a.totals.channel_spend_inr : 0);

describe('unit economics on the worked order', () => {
  it('net revenue 800, CM1 50%, CM2 41.25%, CM3 28.75%, net margin at fixed costs 0 = CM3', async () => {
    const { margins: m } = await workedOrderMargins();
    expect(m.net_revenue_inr).toBe(800);
    expect(m.cm1_pct).toBe(50);
    expect(m.cm2_pct).toBe(41.25);
    expect(m.cm3_pct).toBe(28.75);
    expect(netMarginPct(m, 0)).toBe(28.75);
    expect(netMarginPct(m, 0)).toBe(m.cm3_pct);
  });

  it('uses the six worked-order lines: no payment fee, net product cost once, contribution 230', async () => {
    const { margins: m } = await workedOrderMargins();
    expect(m).toMatchObject({ net_product_cost_inr: 400, shipping_inr: 50, payment_fee_inr: 0, return_cost_inr: 0, handling_inr: 20, ads_inr: 100, contribution_inr: 230, orders_counted: 1, partial: false });
    expect(sumOfParts(m)).toBe(230);
  });

  it('fixed costs lower only the estimated net margin', async () => {
    const { margins: m } = await workedOrderMargins();
    expect(netMarginPct(m, 80)).toBe(18.75); // (230 − 80) ÷ 800
    expect(m.cm3_pct).toBe(28.75);
  });
});

describe('unit economics on the C21 fixture', () => {
  const fixture = rows(FIXTURE);

  it.each(['allocate', 'channel'] as AttributionMode[])('%s: net revenue 14,400, CM1 54.2%, CM3 41.7% (6,000 ÷ 14,400)', (mode) => {
    const m = totalsOf(analyze(fixture, { attribution: mode }));
    expect(m.net_revenue_inr).toBe(14400);
    expect(m.net_product_cost_inr).toBe(6600); // 16 × 400 kept + 4 × (400 − 350) returned
    expect(m.cm1_pct).toBe(54.17); // (14,400 − 6,600) ÷ 14,400
    expect(Math.round(m.cm1_pct! * 10) / 10).toBe(54.2);
    expect(m.contribution_inr).toBe(6000);
    expect(m.cm3_pct).toBe(41.67);
    expect(Math.round(m.cm3_pct! * 10) / 10).toBe(41.7);
  });

  it('CM2 counts return shipping with shipping, so CM2 − CM3 is ads only (none in the fixture)', () => {
    const m = totalsOf(analyze(fixture, { attribution: 'allocate' }));
    expect([m.shipping_inr, m.return_cost_inr, m.payment_fee_inr, m.handling_inr, m.ads_inr]).toEqual([1200, 200, 400, 0, 0]);
    expect(m.cm2_pct).toBe(41.67); // (14,400 − 6,600 − 1,200 − 200 − 400 − 0) ÷ 14,400
    expect(m.cm2_pct).toBe(m.cm3_pct);
  });
});

describe('unit economics on the extended sample', () => {
  const extended = rows(EXTENDED);

  it.each(['allocate', 'channel'] as AttributionMode[])('%s: totals end at the reconciled contribution; the unknown order is left out (partial)', (mode) => {
    const a = analyze(extended, { attribution: mode });
    const m = totalsOf(a);
    expect(m.contribution_inr).toBe(a.reconciliation.orders_inr);
    expect(m.contribution_inr).toBe(7053);
    expect(sumOfParts(m)).toBe(7053);
    expect(m.net_revenue_inr).toBe(a.totals.net_sales_inr);
    expect(m.ads_inr).toBe(490); // allocated ads, or the same rupees as channel spend
    expect(m).toMatchObject({ orders_counted: 26, unknown_left_out: 1, partial: true });
  });

  it('both modes give the same margins', () => {
    const allocate = totalsOf(analyze(extended, { attribution: 'allocate' }));
    const channel = totalsOf(analyze(extended, { attribution: 'channel' }));
    expect(channel).toEqual(allocate);
  });

  it.each(['allocate', 'channel'] as AttributionMode[])('%s: group margins sum consistently to the total', (mode) => {
    const a = analyze(extended, { attribution: mode });
    const { margins: total, groups } = marginsFor(a);
    const sum = (list: Array<{ margins: Margins }>, f: (m: Margins) => number | null) => list.reduce((s, g) => s + (f(g.margins) ?? 0), 0);

    for (const g of [...groups.channel, ...groups.product]) {
      expect(g.margins.contribution_inr).toBe(g.contribution_inr);
      expect(sumOfParts(g.margins)).toBe(g.margins.contribution_inr);
    }
    expect(sum(groups.channel, (m) => m.contribution_inr)).toBe(total.contribution_inr);
    expect(sum(groups.channel, (m) => m.net_revenue_inr)).toBe(total.net_revenue_inr);
    expect(sum(groups.channel, (m) => m.ads_inr)).toBe(total.ads_inr);
    // Products are before channel spend in channel mode; the unallocated spend closes the gap.
    expect(sum(groups.product, (m) => m.contribution_inr) - (groups.product_unallocated_spend_inr ?? 0)).toBe(total.contribution_inr);
    expect(sum(groups.product, (m) => m.net_revenue_inr)).toBe(total.net_revenue_inr);
    expect(sum(groups.channel, (m) => m.orders_counted)).toBe(total.orders_counted);
  });

  it('a group with no known order has no margins, never zero', () => {
    const a = analyze(extended, { attribution: 'allocate' });
    const unknown = a.orders.filter((o) => o.status === 'unknown');
    expect(unknown).toHaveLength(1);
    expect(computeMargins(unknown, 'allocate')).toMatchObject({ contribution_inr: null, cm1_pct: null, cm3_pct: null, partial: true, orders_counted: 0 });
  });
});

describe('margins in API responses', () => {
  const app = createApp();
  const api = '/api/v1';

  it('POST /datasets/:id/analyses and GET /analyses/:id carry margins, and every channel and product row has its own', async () => {
    const d = await request(app).post(`${api}/datasets`).send({ source: 'extended' });
    const post = await request(app).post(`${api}/datasets/${d.body.dataset_id}/analyses`).send({ attribution: 'channel' });
    expect(post.status).toBe(201);
    expect(post.body.margins).toMatchObject({ net_revenue_inr: 19900, contribution_inr: 7053, ads_inr: 490, partial: true });
    expect(post.body.groups.channel.every((g: { margins?: Margins }) => g.margins && typeof g.margins.net_revenue_inr === 'number')).toBe(true);
    expect(post.body.groups.product.every((g: { margins?: Margins }) => g.margins !== undefined)).toBe(true);
    const get = await request(app).get(`${api}/analyses/${post.body.analysis_id}`);
    expect(get.body.margins).toEqual(post.body.margins);
    expect(get.body.groups.channel.map((g: { margins: Margins }) => g.margins)).toEqual(post.body.groups.channel.map((g: { margins: Margins }) => g.margins));
  });

  it('a scenario response carries baseline and scenario margins', async () => {
    const d = await request(app).post(`${api}/datasets`).send({ source: 'fixture' });
    const a = await request(app).post(`${api}/datasets/${d.body.dataset_id}/analyses`).send({});
    const s = await request(app).post(`${api}/analyses/${a.body.analysis_id}/scenarios`).send({ overrides: { return_rate_pct: 30 } });
    expect(s.body.margins.baseline).toMatchObject({ net_revenue_inr: 14400, contribution_inr: 6000, cm3_pct: 41.67 });
    expect(s.body.margins.scenario).toMatchObject({ net_revenue_inr: 12600, contribution_inr: 4800, cm3_pct: 38.1 });
  });
});
