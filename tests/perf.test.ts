import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../api/src/app';
import { analyze, scenarioFor } from '../api/src/engine/analyze';
import { validateRows } from '../api/src/engine/validate';
import { EXTENDED, rawOrders } from './helpers';

// Blueprint §4.4: file drop to ledger in ≤ 2 s for 10,000 rows on a laptop.
const base = rawOrders(EXTENDED);
const tenThousand = Array.from({ length: 10_000 }, (_, i) => ({
  ...base[i % base.length],
  order_id: `X${i}`,
  channel: ['web', 'marketplace', 'instagram'][i % 3],
  product_id: `P${i % 7}`,
}));

describe('performance: 10,000 orders', () => {
  it('validates and analyses in under 2 s, reconciled in both modes', () => {
    const t = performance.now();
    const v = validateRows(tenThousand);
    const allocate = analyze(v.rows, { attribution: 'allocate' });
    const ms = performance.now() - t;
    const channel = analyze(v.rows, { attribution: 'channel' });
    expect(v.rows_kept).toBe(10_000);
    expect(allocate.reconciliation.ok && channel.reconciliation.ok).toBe(true);
    expect(channel.totals.contribution_inr).toBe(allocate.totals.contribution_inr);
    expect(allocate.whale.length).toBeLessThanOrEqual(200);
    expect(ms).toBeLessThan(2000);
  });

  it('runs a scenario with all four candidates in under 2 s', () => {
    const rows = validateRows(tenThousand).rows;
    const t = performance.now();
    const s = scenarioFor(rows, { attribution: 'allocate' }, { recovery_pct: 50 });
    expect(performance.now() - t).toBeLessThan(2000);
    expect(s.candidates).toHaveLength(4);
  });

  it('accepts a 10,000-row upload through the API and analyses it', async () => {
    const app = createApp();
    const body = { records: { orders: tenThousand } };
    expect(JSON.stringify(body).length).toBeLessThan(5 * 1024 * 1024);
    const t = performance.now();
    const d = await request(app).post('/api/v1/datasets').send(body);
    expect(d.status).toBe(201);
    const a = await request(app).post(`/api/v1/datasets/${d.body.dataset_id}/analyses`).send({ attribution: 'channel' });
    expect(a.status).toBe(201);
    expect(a.body.reconciliation.ok).toBe(true);
    expect(performance.now() - t).toBeLessThan(5000);
  }, 20_000);
});

// A real store export: 60,000 orders over 30 months in one 7 MB CSV, payment methods written out in words.
describe('large store export', () => {
  const methods = ['Credit Card', 'PayPal', 'Apple Pay', 'Cash on Delivery', 'UPI', 'Debit Card'];
  const head = 'order_id,date,gross_inr,discount_inr,product_cost_inr,shipping_inr,returned,refund_inr,net_sales_inr,recovered_product_cost_inr,payment_fee_inr,return_cost_inr,channel,product_id,ads_inr,handling_inr,refund_date,payment_type,customer_id,units';
  const lines = [head];
  for (let i = 1; i <= 60_000; i++) {
    const month = String((i % 30) % 12 + 1).padStart(2, '0');
    const year = 2023 + Math.floor((i % 30) / 12);
    const returned = i % 9 === 0;
    lines.push(
      [i, `${year}-${month}-${String((i % 27) + 1).padStart(2, '0')}`, 1200, 120, 500, 60, returned ? 'True' : 'False', returned ? 1080 : 0, returned ? 0 : 1080, returned ? 300 : 0, 20, returned ? 50 : 0,
        ['Paid Ads', 'Email', 'Direct'][i % 3], 1000 + (i % 40), i % 3 === 0 ? 40 : 0, 8, '', methods[i % methods.length], 10_000 + (i % 7000), 1 + (i % 4)].join(','),
    );
  }
  const csv = lines.join('\n') + '\n';

  it('takes a 60,000-order CSV, maps payment methods to COD or prepaid, and reconciles', async () => {
    expect(csv.length).toBeGreaterThan(4 * 1024 * 1024);
    const app = createApp();
    const d = await request(app).post('/api/v1/datasets').attach('file', Buffer.from(csv), 'store-export.csv');
    expect(d.status).toBe(201);
    expect([d.body.rows_kept, d.body.rows_rejected]).toEqual([60_000, 0]);
    const a = await request(app).post(`/api/v1/datasets/${d.body.dataset_id}/analyses`).send({});
    expect(a.status).toBe(201);
    expect(a.body.reconciliation.ok).toBe(true);
    const ch = await request(app).get(`/api/v1/analyses/${a.body.analysis_id}/pulse/channels`);
    const kinds = ch.body.payments.rows.map((r: { payment_type: string }) => r.payment_type).sort();
    expect(kinds).toEqual(['cod', 'prepaid']);
    expect((await request(app).get(`/api/v1/analyses/${a.body.analysis_id}/pulse/months`)).body.months).toHaveLength(30);
  }, 120_000);
});
