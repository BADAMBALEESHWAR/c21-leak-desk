import { describe, expect, it } from 'vitest';
import { analyze, scenarioFor } from '../api/src/engine/analyze';
import { OverrideInvalid } from '../api/src/engine/types';
import { EXPECTED, EXTENDED, FIXTURE, NEG, rows } from './helpers';

const opts = { attribution: 'allocate' as const };

describe('scenario (R12) and recommendation (R13)', () => {
  const fixture = rows(FIXTURE);

  it('baseline recommendation on the fixture: charge return shipping ₹200, low confidence', () => {
    expect(analyze(fixture, opts).recommendation).toMatchObject(EXPECTED.fixture.recommendation);
  });

  it('recovery 350 → 200 (50%) flips the recommendation to raise recovery via inspection', () => {
    const s = scenarioFor(fixture, opts, { recovery_pct: 50 });
    expect(s.baseline.contribution_inr).toBe(6000);
    expect(s.scenario.contribution_inr).toBe(EXPECTED.fixture.scenarios.recovery_50.total);
    expect(s.baseline_recommendation.intervention).toBe(EXPECTED.check3.before);
    expect(s.recommendation.intervention).toBe(EXPECTED.check3.after_recovery_50);
    expect(s.recommendation.expected_delta_inr).toBe(EXPECTED.fixture.scenarios.recovery_50.expected_delta_inr);
    expect(s.delta.by_order.map((d) => d.delta_inr)).toEqual([-150, -150, -150, -150]);
  });

  it('return rate 20 → 30%: two lowest-contribution kept orders return; ₹4,800', () => {
    const s = scenarioFor(fixture, opts, { return_rate_pct: 30 });
    expect(s.scenario.contribution_inr).toBe(EXPECTED.fixture.scenarios.return_rate_30.total);
    expect(s.delta.by_order.map((d) => d.order_id)).toEqual(['O01', 'O02']);
    expect(s.recommendation).toMatchObject({ intervention: 'charge_return_shipping', expected_delta_inr: 300, confidence: 'high', preselect: true });
  });

  it('check 3 on null_refund: unknown confidence, recommendation changes with recovery', () => {
    const r = rows(NEG('null_refund.json'));
    const base = analyze(r, opts).recommendation;
    expect([base.intervention, base.expected_delta_inr, base.confidence]).toEqual([EXPECTED.check3.before, EXPECTED.check3.before_delta, 'unknown']);
    expect(base.preselect).toBe(false);
    const s = scenarioFor(r, opts, { recovery_pct: 50 });
    expect([s.recommendation.intervention, s.recommendation.expected_delta_inr, s.scenario.contribution_inr]).toEqual([
      EXPECTED.check3.after_recovery_50,
      EXPECTED.check3.after_delta,
      EXPECTED.check3.scenario_total,
    ]);
  });

  it('assume_unknown_refund resolves the unknown with a labelled assumption; confidence stays low', () => {
    const s = scenarioFor(rows(NEG('null_refund.json')), opts, { assume_unknown_refund: true });
    expect(s.scenario.unknown).toBe(0);
    expect(s.scenario.contribution_inr).toBe(6000);
    expect(s.recommendation.confidence).toBe('low');
    expect(s.assumptions[0]).toMatch(/^Assumption:/);
  });

  it('refund policy partial refunds 80% of the amount paid', () => {
    expect(scenarioFor(fixture, opts, { refund_policy: 'partial' }).scenario.contribution_inr).toBe(6000 + 4 * 180);
  });

  it('shipping and ads overrides apply to every order', () => {
    expect(scenarioFor(fixture, opts, { shipping_inr: 80 }).scenario.contribution_inr).toBe(5600);
    expect(scenarioFor(fixture, opts, { ads_per_order: 10 }).scenario.contribution_inr).toBe(5800);
  });

  it('a controlled scenario changes exactly one assumption', () => {
    expect(() => scenarioFor(fixture, opts, {})).toThrow(OverrideInvalid);
    expect(() => scenarioFor(fixture, opts, { recovery_pct: 50, shipping_inr: 80 })).toThrow(OverrideInvalid);
    expect(() => scenarioFor(fixture, opts, { recovery_pct: 50, assume_unknown_refund: true })).not.toThrow();
  });

  it('every candidate is listed with its delta and driving orders', () => {
    const s = scenarioFor(rows(EXTENDED), opts, { recovery_pct: 50 });
    expect(s.candidates.map((c) => c.intervention)).toEqual(['raise_recovery_via_inspection', 'charge_return_shipping', 'cap_discount', 'add_handling_to_price']);
    expect(s.candidates.find((c) => c.intervention === 'cap_discount')).toMatchObject({ delta_inr: 180, driving_orders: 1 });
    expect(s.recommendation.why_source).toBe('template');
    expect(s.recommendation.test_30d_draft.length).toBeGreaterThan(0);
  });
});
