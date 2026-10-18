import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../api/src/app';
import { labelChangingReturnRates } from '../api/src/checks';

// A1: the checks screen's line-by-line proof, served read-only by GET /checks and GET /checks/missing-refund.

const app = createApp();
const api = '/api/v1';
let checks: any;

beforeAll(async () => {
  const r = await request(app).get(`${api}/checks`);
  expect(r.status).toBe(200);
  checks = r.body;
});

describe('checks', () => {
  it('checks.worked_order_lines: six lines, every value and running total', () => {
    expect(checks.check1).toMatchObject({ expected: 230, actual: 230, six_lines: true, pass: true });
    expect(checks.check1.lines.map((l: any) => [l.key, l.amount_inr, l.running_total_inr])).toEqual([
      ['revenue', 1000, 1000],
      ['refund', -200, 800],
      ['net_product_cost', -400, 400],
      ['shipping', -50, 350],
      ['ads', -100, 250],
      ['handling', -20, 230],
    ]);
    expect(checks.check1.lines.at(-1).running_total_inr).toBe(checks.check1.actual);
    expect(checks.check1.lines.some((l: any) => l.key === 'payment_fee')).toBe(false);
  });

  it('check 2: Σ orders, Σ channels and Σ products differ by 0 for the fixture (6,000) and the extended file (7,053) in both modes', () => {
    const rows = checks.check2.rows as Array<{ dataset: string; attribution: string; sum: string; total_inr: number; expected_total_inr: number; difference_inr: number; pass: boolean }>;
    expect(rows).toHaveLength(12);
    for (const dataset of ['fixture', 'extended'])
      for (const attribution of ['allocate', 'channel'])
        expect(rows.filter((r) => r.dataset === dataset && r.attribution === attribution).map((r) => r.sum)).toEqual(['orders', 'channels', 'products']);
    expect(rows.every((r) => r.difference_inr === 0 && r.pass)).toBe(true);
    expect(new Set(rows.filter((r) => r.dataset === 'fixture').map((r) => r.total_inr))).toEqual(new Set([6000]));
    expect(new Set(rows.filter((r) => r.dataset === 'extended').map((r) => r.total_inr))).toEqual(new Set([7053]));
  });

  it('check 2 conflict: ads deducted in both modes is refused with HTTP 409, recorded in-process and matched over HTTP', async () => {
    expect(checks.check2.conflict).toMatchObject({ expected_status: 409, actual_status: 409, code: 'attribution_conflict', pass: true });
    const d = await request(app).post(`${api}/datasets`).send({ source: 'extended' });
    const r = await request(app).post(`${api}/datasets/${d.body.dataset_id}/analyses`).send(checks.check2.conflict.request.body);
    expect(r.status).toBe(checks.check2.conflict.actual_status);
    expect(r.body.error.code).toBe(checks.check2.conflict.code);
    expect(checks.check2.pass).toBe(true);
  });

  it('check 3 keeps the recovery-based check and adds the return-rate control', () => {
    expect(checks.check3).toMatchObject({
      unknown_labelled: true,
      confidence: 'unknown',
      before: { intervention: 'charge_return_shipping' },
      after_recovery_50: { intervention: 'raise_recovery_via_inspection' },
      recommendation_changed: true,
      pass: true,
    });
    const c = checks.check3.assumption_control;
    expect(c).toMatchObject({ parameter: 'return_rate_pct', observed_return_rate_pct: 20, label_changing_values_pct: [0, 1, 2], label_changing_ranges: [{ from_pct: 0, to_pct: 2 }], default_return_rate_pct: 0 });
    expect(c.at_default).toMatchObject({ changed: true, label: 'Scenario: assumes 0% returns' });
  });

  it('check 4: margins on the worked order — net revenue 800, CM1 50%, CM2 41.25%, CM3 28.75%', () => {
    expect(checks.check4).toMatchObject({ net_revenue_inr: 800, cm1_pct: 50, cm2_pct: 41.25, cm3_pct: 28.75, net_margin_pct_at_zero_fixed_costs: 28.75, contribution_inr: 230, pass: true });
    expect(checks.all_pass).toBe(true);
  });

  it('margin assertion: gross margin (CM1) 50% with its formula and working', () => {
    expect(checks.check4.formulas.cm1).toBe('CM1 = (net revenue − net product cost) ÷ net revenue');
    expect(checks.check4.working.cm1).toBe('(800 − 400) ÷ 800 = 50%');
    expect(checks.check4.working.net_revenue).toBe('1,000 − 200 = 800');
  });

  it('margin assertion: contribution margin (CM3) 28.75% is contribution ÷ net revenue', () => {
    expect(checks.check4.formulas.cm3).toMatch(/^CM3 = contribution ÷ net revenue/);
    expect(checks.check4.working.cm3).toBe('230 ÷ 800 = 28.75%');
    expect(checks.check4.working.cm2).toBe('(800 − 400 − 50 − 0 − 20) ÷ 800 = 41.25%');
  });
});

describe('GET /checks/missing-refund', () => {
  it('O05 stays unknown and the total partial; the label changes at the documented rates', async () => {
    const documented = await labelChangingReturnRates();
    expect(documented).toEqual([0, 1, 2]);
    for (const x of documented) {
      const r = await request(app).get(`${api}/checks/missing-refund?return_rate_pct=${x}`);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        unknown_order: 'O05',
        status: 'unknown',
        total_label: 'partial (1 unknown)',
        label: `Scenario: assumes ${x}% returns`,
        before: { intervention: 'charge_return_shipping', label: 'Charge return shipping', expected_delta_inr: 150 },
        after: { intervention: 'none', label: 'No change', expected_delta_inr: 0 },
        changed: true,
      });
    }
  });

  it('at other rates only the number changes, not the label', async () => {
    const r30 = (await request(app).get(`${api}/checks/missing-refund?return_rate_pct=30`)).body;
    expect(r30).toMatchObject({ label: 'Scenario: assumes 30% returns', changed: false, after: { intervention: 'charge_return_shipping', expected_delta_inr: 250 } });
    const r20 = (await request(app).get(`${api}/checks/missing-refund?return_rate_pct=20`)).body;
    expect(r20).toMatchObject({ changed: false, after: { intervention: 'charge_return_shipping', expected_delta_inr: 150 } });
  });

  it('without X it uses the first label-changing rate; a bad X is 422 on return_rate_pct', async () => {
    const r = await request(app).get(`${api}/checks/missing-refund`);
    expect(r.body).toMatchObject({ return_rate_pct: 0, changed: true, label_changing_values_pct: [0, 1, 2] });
    for (const bad of ['abc', '101', '-1']) {
      const e = await request(app).get(`${api}/checks/missing-refund?return_rate_pct=${bad}`);
      expect([e.status, e.body.error.code, e.body.error.path]).toEqual([422, 'schema_invalid', 'return_rate_pct']);
    }
  });
});
