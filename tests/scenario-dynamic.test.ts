import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../api/src/app';

// Every scenario control recalculates from the dataset: delta = scenario − baseline, the baseline never moves,
// repeated moves are deterministic, and dependent figures (cost lines, margins, candidate gains) change with the control.
const app = createApp();
const api = '/api/v1';
let analysisId = '';
let baseline: any;

const run = async (overrides: Record<string, unknown>) => (await request(app).post(`${api}/analyses/${analysisId}/scenarios`).send({ overrides })).body;

beforeAll(async () => {
  const d = (await request(app).post(`${api}/datasets`).send({ source: 'demo_12m' })).body.dataset_id;
  baseline = (await request(app).post(`${api}/datasets/${d}/analyses`).send({ attribution: 'allocate' })).body;
  analysisId = baseline.analysis_id;
});

const CONTROLS: Array<[string, Record<string, unknown>, string]> = [
  ['recovery', { recovery_pct: 80 }, 'net_product_cost_inr'],
  ['return rate', { return_rate_pct: 10 }, 'return_cost_inr'],
  ['shipping', { shipping_inr: 60 }, 'shipping_inr'],
  ['refund policy', { refund_policy: 'partial' }, 'net_sales_inr'],
  ['ads', { ads_per_order: 20 }, 'ads_inr'],
];

describe('scenario recalculation', () => {
  it.each(CONTROLS)('%s: delta equals scenario minus baseline and the dependent line moves', async (_n, o, line) => {
    const s = await run(o);
    expect(s.delta.contribution_inr).toBe(s.scenario.contribution_inr - s.baseline.contribution_inr);
    expect(s.baseline.contribution_inr).toBe(baseline.totals.contribution_inr);
    expect(s.delta[line]).not.toBe(0);
    expect(s.margins.baseline.cm3_pct).not.toBe(s.margins.scenario.cm3_pct);
    expect(s.margins.baseline.contribution_inr).toBe(baseline.margins.contribution_inr);
  });

  it('moving a control back and forth gives identical results and never accumulates', async () => {
    const first = await run({ recovery_pct: 80 });
    await run({ recovery_pct: 90 });
    await run({ recovery_pct: 30 });
    const again = await run({ recovery_pct: 80 });
    expect(again.scenario.contribution_inr).toBe(first.scenario.contribution_inr);
    expect(again.delta.contribution_inr).toBe(first.delta.contribution_inr);
    expect(again.candidates).toEqual(first.candidates);
    // The stored baseline is untouched.
    const fresh = (await request(app).get(`${api}/analyses/${analysisId}`)).body;
    expect(fresh.totals.contribution_inr).toBe(baseline.totals.contribution_inr);
  });

  it('candidate gains follow the scenario: recovery at 90% leaves nothing for the inspection fix, other fixes keep theirs', async () => {
    const s = await run({ recovery_pct: 90 });
    const gain = (k: string, from: any[]) => from.find((c) => c.intervention === k).delta_inr;
    expect(gain('raise_recovery_via_inspection', s.candidates)).toBe(0);
    expect(gain('raise_recovery_via_inspection', baseline.candidates)).toBeGreaterThan(0);
    expect(gain('cap_discount', s.candidates)).toBe(gain('cap_discount', baseline.candidates));
  });

  it('missing refund facts stay flagged and out of the totals under a scenario', async () => {
    const s = await run({ recovery_pct: 80 });
    expect(s.scenario.unknown).toBe(baseline.totals.unknown_count);
    expect(s.assumptions.join(' ')).toMatch(/still unknown/);
  });
});
