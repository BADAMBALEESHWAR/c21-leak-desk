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

  it('accepts a 10,000-row upload through the API (under the 5 MB limit) and analyses it', async () => {
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
