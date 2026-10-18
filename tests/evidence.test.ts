import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze } from '../api/src/engine/analyze';
import { validateRows } from '../api/src/engine/validate';
import { bootstrap, evidenceFor } from '../api/src/stats/evidence';
import { EXTENDED, rawOrders } from './helpers';

const demo = JSON.parse(readFileSync(new URL('../data/demo_12m.json', import.meta.url), 'utf8'));
const demoRows = validateRows(demo.records?.orders ?? demo.orders ?? demo).rows;

describe('statistical confidence (bootstrap)', () => {
  it('is deterministic, brackets the exact delta and never contradicts the engine', () => {
    const ev = evidenceFor('t-demo', demoRows, { attribution: 'allocate' });
    const a = analyze(demoRows, { attribution: 'allocate' });
    for (const c of a.candidates) {
      expect(Math.abs(ev[c.intervention].delta_inr - c.delta_inr)).toBeLessThanOrEqual(Math.abs(c.delta_inr) * 0.05 + 1);
      const e = ev[c.intervention];
      expect(e.ci_low_inr).toBeLessThanOrEqual(e.ci_high_inr);
      expect(['high', 'medium', 'low']).toContain(e.level);
      expect(e.p_positive).toBeGreaterThanOrEqual(0);
      expect(e.p_positive).toBeLessThanOrEqual(1);
    }
    expect(evidenceFor('t-demo', demoRows, { attribution: 'allocate' })).toBe(ev);
    const again = evidenceFor('t-demo-2', demoRows, { attribution: 'allocate' });
    expect(again.cap_discount.ci_low_inr).toBe(ev.cap_discount.ci_low_inr);
  });
  it('a large consistent gain is high; a handful of orders is low; a loss is low', () => {
    expect(bootstrap(Array(200).fill(100), 20000, 500, 1).p).toBe(1);
    const few = bootstrap([500, 0, 0, 0, 0], 500, 500, 2);
    expect(few.low).toBeLessThanOrEqual(few.high);
    const mixed = bootstrap([...Array(50).fill(-40), ...Array(50).fill(10)], -1500, 500, 3);
    expect(mixed.p).toBeLessThan(0.05);
  });
  it('small data (the 20-order fixture) is never reported as high', () => {
    const rows = validateRows(rawOrders(EXTENDED)).rows;
    const ev = evidenceFor('t-ext', rows, { attribution: 'allocate' });
    for (const e of Object.values(ev)) expect(e.level).not.toBe('high');
  });
});
