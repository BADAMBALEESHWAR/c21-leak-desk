import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setModelForTests, type AiModel } from '../api/src/ai/grounded';
import { FIELDS_SENT } from '../api/src/ai/guardlog';
import { createApp } from '../api/src/app';
import { scenarioFor } from '../api/src/engine/analyze';
import { EXTENDED, rows } from './helpers';

const app = createApp();
const api = '/api/v1';

const reply = (f: (fields: Record<string, { data: unknown; template: string }>) => Record<string, string>): AiModel => ({
  model: 'stub-advisor',
  generate: async (_s, user) => JSON.stringify(f(JSON.parse(user.slice(user.indexOf('\n') + 1)).fields)),
});

describe('fix advisor (v2 §1.2)', () => {
  let ext = '';
  let extAnalysis: any;
  let demo = '';
  beforeAll(async () => {
    const d = (await request(app).post(`${api}/datasets`).send({ source: 'extended' })).body.dataset_id;
    extAnalysis = (await request(app).post(`${api}/datasets/${d}/analyses`).send({ attribution: 'allocate' })).body;
    ext = extAnalysis.analysis_id;
    const d12 = (await request(app).post(`${api}/datasets`).send({ source: 'demo_12m' })).body.dataset_id;
    demo = (await request(app).post(`${api}/datasets/${d12}/analyses`).send({ attribution: 'allocate' })).body.analysis_id;
  });
  afterEach(() => setModelForTests(undefined));

  it('full return: inspection and return-shipping candidates with engine deltas, the leak card text, a 30-day test', async () => {
    const r = await request(app).post(`${api}/analyses/${ext}/advisor`).send({ cause: 'full_return_partial_recovery' });
    expect(r.status).toBe(200);
    const leak = extAnalysis.leaks.find((l: any) => l.cause === 'full_return_partial_recovery');
    expect(r.body).toMatchObject({ cause: 'full_return_partial_recovery', label: 'Full return, partial recovery', summary: { text: leak.why, source: 'template' } });
    expect(r.body.facts).toMatchObject({ orders: 5, inr_at_stake: 1384, example_ids: leak.example_ids });
    expect(r.body.interventions).toEqual([
      { candidate_id: 'raise_recovery_via_inspection', intervention: 'raise_recovery_via_inspection', label: 'Raise recovery via inspection', overrides: { recovery_pct: 90 }, expected_delta_inr: 390, confidence: 'unknown' },
      { candidate_id: 'charge_return_shipping', intervention: 'charge_return_shipping', label: 'Charge return shipping', overrides: null, expected_delta_inr: 280, confidence: 'unknown' },
    ]);
    expect(r.body.test_30d).toEqual({ text: extAnalysis.recommendation.test_30d_draft, source: 'template' });
    expect(r.body.stop_rule).toEqual({ text: extAnalysis.recommendation.stop_rule_draft, source: 'template' });
  });

  it('discount: cap discount first, filled to two with the best other candidate', async () => {
    const r = await request(app).post(`${api}/analyses/${ext}/advisor`).send({ cause: 'discount_exceeds_margin' });
    expect(r.body.interventions.map((i: any) => [i.candidate_id, i.expected_delta_inr])).toEqual([
      ['cap_discount', 180],
      ['raise_recovery_via_inspection', 390],
    ]);
    expect(r.body.facts).toMatchObject({ orders: 1, inr_at_stake: 96 });
    expect(typeof r.body.facts.discount_inr).toBe('number');
  });

  it('refund unknown: record the facts, plus the assume-unknown scenario priced by the engine', async () => {
    const r = await request(app).post(`${api}/analyses/${ext}/advisor`).send({ cause: 'refund_unknown' });
    const opts = { attribution: 'allocate' as const, period_end: extAnalysis.period_end, handling_default_inr: extAnalysis.config.handling_default_inr };
    const s = scenarioFor(rows(EXTENDED), opts, { assume_unknown_refund: true });
    expect(r.body.interventions).toEqual([
      { candidate_id: 'record_facts', intervention: 'record_facts', label: 'Record the missing refund facts', overrides: null, expected_delta_inr: null, confidence: 'unknown' },
      expect.objectContaining({ candidate_id: 'assume_unknown_refund', overrides: { assume_unknown_refund: true }, expected_delta_inr: s.delta.contribution_inr, confidence: 'low' }),
    ]);
    expect(r.body.facts).toMatchObject({ orders: 1, inr_at_stake: null });
    expect(r.body.facts.missing_facts.refund_inr + r.body.facts.missing_facts.recovered_product_cost_inr + r.body.facts.missing_facts.return_cost_inr).toBeGreaterThan(0);
    expect(r.body.test_30d.text).toMatch(/record the refund amount/);
  });

  it('fees: add handling to price plus a shipping change scenario', async () => {
    const r = await request(app).post(`${api}/analyses/${demo}/advisor`).send({ cause: 'fees_exceed_margin' });
    expect(r.status).toBe(200);
    const [first, second] = r.body.interventions;
    expect(first.candidate_id).toBe('add_handling_to_price');
    expect(second.candidate_id).toBe('shipping_change');
    expect(typeof second.overrides.shipping_inr).toBe('number');
    expect(r.body.interventions.length).toBeGreaterThanOrEqual(2);
    expect(r.body.interventions.length).toBeLessThanOrEqual(3);
  });

  it('404 for a cause this analysis does not have; 422 for an unknown cause', async () => {
    expect((await request(app).post(`${api}/analyses/${ext}/advisor`).send({ cause: 'fees_exceed_margin' })).status).toBe(404);
    const bad = await request(app).post(`${api}/analyses/${ext}/advisor`).send({ cause: 'vibes' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.path).toBe('cause');
  });

  it('Hindi and Telugu: words change, numbers do not', async () => {
    for (const lang of ['hi', 'te']) {
      const r = await request(app).post(`${api}/analyses/${ext}/advisor`).send({ cause: 'full_return_partial_recovery', lang });
      expect(r.body.summary.text).toMatch(lang === 'hi' ? /[ऀ-ॿ]/ : /[ఀ-౿]/);
      expect(r.body.summary.text).toContain('1,384');
      expect(r.body.interventions.map((i: any) => i.expected_delta_inr)).toEqual([390, 280]);
    }
  });

  it('AI rewording is used when grounded and rejected field by field when it is not', async () => {
    setModelForTests(reply((f) => ({ summary: `Five orders: ${f.summary.template}`, test_30d: 'Run it for 45 days.', stop_rule: 'Stop when it stops helping.' })));
    const r = await request(app).post(`${api}/analyses/${ext}/advisor`).send({ cause: 'full_return_partial_recovery' });
    expect(r.body.summary.source).toBe('ai');
    expect(r.body.test_30d).toEqual({ text: extAnalysis.recommendation.test_30d_draft, source: 'template' });
    expect(r.body.stop_rule).toEqual({ text: 'Stop when it stops helping.', source: 'ai' });
    // With the switch off the same request is templates only.
    const off = await request(app).post(`${api}/analyses/${ext}/advisor`).set('X-Profyn-AI', 'off').send({ cause: 'full_return_partial_recovery' });
    expect([off.body.summary.source, off.body.test_30d.source, off.body.stop_rule.source]).toEqual(['template', 'template', 'template']);
  });

  it('sends only the fields it lists in /ai/status', async () => {
    let sent: any = null;
    setModelForTests({ model: 'stub-spy', generate: async (_s, user) => ((sent = JSON.parse(user.slice(user.indexOf('\n') + 1)).fields), '{}') });
    await request(app).post(`${api}/analyses/${ext}/advisor`).send({ cause: 'full_return_partial_recovery' });
    const keys = (o: any, prefix = ''): string[] =>
      Object.entries(o ?? {}).flatMap(([k, v]) => (k === 'interventions' ? (v as any[]).flatMap((x) => Object.keys(x).map((kk) => `interventions[].${kk}`)) : k === 'observed' ? Object.keys(v as object).map((kk) => `observed.${kk}`) : [prefix + k]));
    const used = new Set(Object.values(sent).flatMap((f: any) => [...keys(f.data), 'template']));
    for (const k of used) expect(FIELDS_SENT.advisor).toContain(k);
  });
});
