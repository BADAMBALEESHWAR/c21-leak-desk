import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../api/src/app';
import { loadJson } from './helpers';

// A6: GET /decisions/:id/export?format=json downloads decision-<id>.json with the starting state, the one scenario
// override, the expected impact, a 30-day check-in and every assumed input.

const app = createApp();
const api = '/api/v1';
const DAY = 86_400_000;

async function analysis(source = 'extended') {
  const d = await request(app).post(`${api}/datasets`).send({ source });
  return (await request(app).post(`${api}/datasets/${d.body.dataset_id}/analyses`).send({ attribution: 'allocate' })).body;
}

describe('decision export (json)', () => {
  let a: any;
  let s: any;
  let saved: any;
  let file: request.Response;
  let doc: any;

  beforeAll(async () => {
    a = await analysis();
    s = (await request(app).post(`${api}/analyses/${a.analysis_id}/scenarios`).send({ overrides: { recovery_pct: 50, assume_unknown_refund: true } })).body;
    const r = s.recommendation;
    saved = (
      await request(app).post(`${api}/analyses/${a.analysis_id}/decisions`).send({
        scenario_id: s.scenario_id,
        intervention: r.intervention,
        expected_delta_inr: r.expected_delta_inr,
        test_30d: r.test_30d_draft,
        stop_rule: r.stop_rule_draft,
        owner: 'Operations lead',
        fixed_costs_inr: 3000,
      })
    ).body;
    file = await request(app).get(`${api}/decisions/${saved.decision_id}/export?format=json`);
    doc = JSON.parse(file.text);
  });

  it('downloads decision-<id>.json', () => {
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/application\/json/);
    expect(file.headers['content-disposition']).toBe(`attachment; filename="decision-${saved.decision_id}.json"`);
    expect(doc).toMatchObject({ decision_id: saved.decision_id, owner: 'Operations lead', intervention: 'raise_recovery_via_inspection' });
  });

  it('starting_state has the totals, mode, period end and engine version of the analysis', () => {
    expect(doc.starting_state).toMatchObject({ totals: a.totals, mode: 'allocate', period_end: '2026-09-30', engine_version: '1.0.0' });
    expect(doc.starting_state.totals.contribution_inr).toBe(7053);
    expect(doc.starting_state.margins).toMatchObject({ net_revenue_inr: 19900, contribution_inr: 7053, cm3_pct: 35.44 });
    expect(doc.starting_state).toMatchObject({ fixed_costs_inr: 3000, net_margin_pct_estimated: 20.37 }); // (7,053 − 3,000) ÷ 19,900
  });

  it('scenario is the one override (with the unknown-refund toggle), expected impact and date are set', () => {
    expect(doc.scenario).toMatchObject({ scenario_id: s.scenario_id, changed: 'recovery_pct', override: { recovery_pct: 50 }, assume_unknown_refund: true });
    expect(Object.keys(doc.scenario.override)).toHaveLength(1);
    expect(doc.scenario.scenario_contribution_inr).toBe(s.scenario.contribution_inr);
    expect(doc.expected_impact_inr).toBe(s.recommendation.expected_delta_inr);
    expect(doc.date).toBe(new Date(saved.saved_at).toISOString().slice(0, 10));
  });

  it('check_in_30_days names a metric, a target and the saved date + 30 days', () => {
    const due = new Date(new Date(saved.saved_at).getTime() + 30 * DAY).toISOString().slice(0, 10);
    expect(doc.check_in_30_days).toEqual({
      metric: 'recovery_pct',
      metric_label: 'Average recovered stock value on returns, % of product cost',
      unit: 'pct',
      direction: 'at_least',
      baseline_value: 71.4,
      baseline_source: 'observed',
      target_value: 90,
      date: due,
      contribution_target_inr: s.scenario.contribution_inr + s.recommendation.expected_delta_inr,
      contribution_target_basis: 'scenario',
    });
    expect(saved.check_in_30_days).toEqual(doc.check_in_30_days);
  });

  it('assumptions[] lists every assumed input: the override, the toggle, the handling default and the fixed costs', () => {
    expect(doc.assumptions.map((x: any) => [x.key, x.value, x.source])).toEqual([
      ['recovery_pct', 50, 'scenario_override'],
      ['assume_unknown_refund', true, 'scenario_toggle'],
      ['handling_default_inr', 0, 'config_default'],
      ['fixed_costs_inr', 3000, 'user_input'],
    ]);
    expect(doc.assumptions.every((x: any) => typeof x.label === 'string' && x.label.length > 0)).toBe(true);
  });

  it('the Markdown export still works and shows the check-in', async () => {
    const md = await request(app).get(`${api}/decisions/${saved.decision_id}/export?format=md`);
    expect(md.headers['content-disposition']).toBe(`attachment; filename="decision-${saved.decision_id}.md"`);
    expect(md.text).toContain('# Decision: Raise recovery via inspection');
    expect(md.text).toContain(`- 30-day check-in (${doc.check_in_30_days.date}): Average recovered stock value on returns, % of product cost at least 90% (now 71.4%)`);
    expect(md.text).toMatch(/\| fixed_costs_inr \| 3000 \|/);
  });
});

describe('decision export without a scenario', () => {
  it('scenario is null; only the handling default is assumed; the check-in targets contribution for a custom choice', async () => {
    const a = await analysis('fixture');
    const saved = (
      await request(app).post(`${api}/analyses/${a.analysis_id}/decisions`).send({ intervention: 'Renegotiate courier rates', expected_delta_inr: 300, test_30d: 'Try the new courier on half the orders.', stop_rule: 'Stop if delivery time rises.', owner: 'Founder' })
    ).body;
    const doc = JSON.parse((await request(app).get(`${api}/decisions/${saved.decision_id}/export?format=json`)).text);
    expect(doc.scenario).toBeNull();
    expect(doc.assumptions.map((x: any) => x.key)).toEqual(['handling_default_inr']);
    expect(doc.check_in_30_days).toMatchObject({ metric: 'contribution_inr', baseline_value: 6000, target_value: 6300, contribution_target_basis: 'observed' });
    expect(doc.starting_state).toMatchObject({ mode: 'allocate', fixed_costs_inr: null, net_margin_pct_estimated: null });
  });

  it('fixed_costs_inr must not be negative', async () => {
    const a = await analysis('fixture');
    const r = await request(app).post(`${api}/analyses/${a.analysis_id}/decisions`).send({ intervention: 'cap_discount', expected_delta_inr: 0, test_30d: 't', stop_rule: 's', owner: 'o', fixed_costs_inr: -1 });
    expect([r.status, r.body.error.path]).toEqual([422, 'fixed_costs_inr']);
  });
});

describe('docs/sample_decision.json', () => {
  it('is a decision file from the extended sample with every required part', () => {
    const doc = loadJson('../docs/sample_decision.json');
    expect(doc.format).toBe('profyn-decision/1');
    for (const key of ['decision_id', 'owner', 'date', 'starting_state', 'scenario', 'expected_impact_inr', 'check_in_30_days', 'assumptions']) expect(doc).toHaveProperty(key);
    expect(doc.starting_state).toMatchObject({ mode: 'allocate', period_end: '2026-09-30', engine_version: '1.0.0', dataset_source: 'extended', totals: { contribution_inr: 7053 } });
    expect(Object.keys(doc.scenario.override)).toHaveLength(1);
    expect(doc.check_in_30_days.date).toBe(new Date(new Date(doc.saved_at).getTime() + 30 * DAY).toISOString().slice(0, 10));
  });
});
