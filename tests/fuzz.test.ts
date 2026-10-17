import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../api/src/app';
import { analyze } from '../api/src/engine/analyze';
import { validateRows } from '../api/src/engine/validate';
import { FIXTURE, rawOrders } from './helpers';

// Roadmap Track 4: fuzz the import with 50 random edits. Any judge edit must give a flag, a 4xx or a
// changed number — never a 5xx, and totals must still reconcile.

const app = createApp();

/** Small deterministic PRNG so a failure can be replayed from its seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const FIELDS = [
  'order_id', 'date', 'gross_inr', 'discount_inr', 'refund_inr', 'net_sales_inr', 'product_cost_inr',
  'recovered_product_cost_inr', 'shipping_inr', 'payment_fee_inr', 'return_cost_inr', 'returned',
  'channel', 'product_id', 'ads_inr', 'handling_inr', 'refund_date',
];
const VALUES: unknown[] = [null, undefined, 0, -1, -500, 1.5, 999999999, 'abc', '', true, false, [], {}, '2026-13-45', '2026-10-05', 'O07', 1500, 400, NaN];

function mutate(seed: number) {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const orders: any[] = rawOrders(FIXTURE).map((o) => ({ ...o }));
  const edits = 1 + Math.floor(r() * 4);
  const log: string[] = [];
  for (let i = 0; i < edits; i++) {
    const row = orders[Math.floor(r() * orders.length)];
    const op = r();
    if (op < 0.15) {
      orders.push({ ...row }); // duplicate
      log.push(`dup ${row.order_id}`);
    } else if (op < 0.3) {
      const f = pick(FIELDS);
      delete row[f];
      log.push(`del ${row.order_id}.${f}`);
    } else {
      const f = pick(FIELDS);
      const v = pick(VALUES);
      row[f] = v;
      log.push(`set ${row.order_id}.${f}=${JSON.stringify(v)}`);
    }
  }
  return { orders, log };
}

describe('fuzz: 50 random edits to the fixture', () => {
  for (let seed = 1; seed <= 50; seed++) {
    it(`seed ${seed} never returns 5xx and stays reconciled`, async () => {
      const { orders, log } = mutate(seed);
      const res = await request(app).post('/api/v1/datasets').send({ records: { orders } });
      expect(res.status, `${log.join('; ')} → ${JSON.stringify(res.body).slice(0, 200)}`).toBeLessThan(500);
      if (res.status === 201) {
        expect(res.body.rows_kept).toBeGreaterThan(0);
        for (const mode of ['allocate', 'channel'] as const) {
          const a = await request(app).post(`/api/v1/datasets/${res.body.dataset_id}/analyses`).send({ attribution: mode });
          expect(a.status, log.join('; ')).toBe(201);
          expect(a.body.reconciliation.ok, log.join('; ')).toBe(true);
        }
      } else {
        expect(res.body.error.code).toMatch(/schema_invalid|no_valid_rows|file_too_large/);
      }
      // The engine itself never throws on validated rows.
      expect(() => analyze(validateRows(orders).rows, { attribution: 'allocate' })).not.toThrow();
    });
  }
});
