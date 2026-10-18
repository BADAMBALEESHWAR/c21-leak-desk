import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setModelForTests, type AiModel } from '../api/src/ai/grounded';
import { createApp } from '../api/src/app';
import { scenarioFor } from '../api/src/engine/analyze';
import { EXTENDED, rows } from './helpers';

const app = createApp();
const api = '/api/v1';

interface SseEvent {
  event: string;
  data: any;
}

/** Reads a whole event stream (the server closes it after `done`). */
function sse(path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string>; events: SseEvent[] }> {
  return new Promise((resolve, reject) => {
    const req = request(app).get(path);
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    req
      .buffer(true)
      .parse((res, cb) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (text += c));
        res.on('end', () => cb(null, text));
      })
      .end((err, res) => {
        if (err) return reject(err);
        const events = String(res.body)
          .split('\n\n')
          .map((block) => {
            const event = /^event: (.*)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            return event && data ? { event, data: JSON.parse(data) } : null;
          })
          .filter((e): e is SseEvent => e !== null);
        resolve({ status: res.status, headers: res.headers as Record<string, string>, events });
      });
  });
}

/** A model that returns each field's template unchanged (always grounded). */
const echo = (gate?: Promise<void>): AiModel => ({
  model: 'stub-echo',
  async generate(_system, user) {
    if (gate) await gate;
    const { fields } = JSON.parse(user.slice(user.indexOf('\n') + 1)) as { fields: Record<string, { template: string }> };
    return JSON.stringify(Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, `In short: ${f.template}`])));
  },
});

describe('autopilot (v2 §1.1)', () => {
  let datasetId = '';
  beforeAll(async () => {
    datasetId = (await request(app).post(`${api}/datasets`).send({ source: 'extended' })).body.dataset_id;
  });
  afterEach(() => setModelForTests(undefined));

  it('runs the pipeline; the three actions are the top three candidates by delta from scenarioFor', async () => {
    const r = await request(app).post(`${api}/datasets/${datasetId}/autopilot`).send({ attribution: 'allocate' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('done');
    expect(r.body.stages).toEqual({ analysis: 'done', leaks: 'done', scenarios: 'done', margins: 'done', pulse: 'done', explanations: 'done' });

    const a = (await request(app).get(`${api}/analyses/${r.body.analysis_id}`)).body;
    expect(a.analysis_id).toBe(r.body.analysis_id);
    const opts = { attribution: 'allocate' as const, period_end: a.period_end, handling_default_inr: a.config.handling_default_inr };
    // The observed return rate changes no order, so the scenario's candidates are the baseline candidates.
    const s = scenarioFor(rows(EXTENDED), opts, { return_rate_pct: a.observed.return_rate_pct });
    expect(s.delta.contribution_inr).toBe(0);
    const top = [...s.candidates].sort((x, y) => y.delta_inr - x.delta_inr).slice(0, 3);
    expect(r.body.actions).toHaveLength(3);
    expect(r.body.actions.map((x: any) => [x.rank, x.intervention, x.expected_delta_inr])).toEqual(top.map((c, i) => [i + 1, c.intervention, c.delta_inr]));
    expect(top.map((c) => c.intervention)).toEqual(['raise_recovery_via_inspection', 'charge_return_shipping', 'cap_discount']);

    expect(r.body.headline).toMatchObject({ contribution_inr: 7053, net_sales_inr: a.totals.net_sales_inr, orders: 27, unknown_orders: 1, partial: true });
    expect(r.body.headline.margins).toEqual(a.margins);
    expect(r.body.top_leaks[0]).toEqual({ cause: 'full_return_partial_recovery', label: 'Full return, partial recovery', orders: 5, inr_at_stake: 1384 });
    expect(r.body.top_leaks.length).toBeLessThanOrEqual(3);
    expect(r.body.actions[0]).toMatchObject({
      candidate_id: 'raise_recovery_via_inspection',
      overrides: { recovery_pct: 90 },
      confidence: a.recommendation.confidence,
      explanation: { source: 'template' },
      decision_draft: { intervention: 'raise_recovery_via_inspection', expected_delta_inr: 390, test_30d: a.recommendation.test_30d_draft, stop_rule: a.recommendation.stop_rule_draft },
    });
    expect(r.body.actions[0].explanation.text).toBe(a.recommendation.why);

    const g = await request(app).get(`${api}/autopilot/${r.body.autopilot_id}`);
    expect(g.status).toBe(200);
    expect(g.body).toEqual(r.body);
  });

  it('accept creates a decision through the decisions code path, retrievable via GET', async () => {
    const run = (await request(app).post(`${api}/datasets/${datasetId}/autopilot`).send({})).body;
    const acc = await request(app).post(`${api}/autopilot/${run.autopilot_id}/accept`).send({ rank: 2 });
    expect(acc.status).toBe(201);
    expect(acc.body).toMatchObject({ engine_version: '1.0.0', workspace: 'shared' });
    expect(acc.body.check_in_30_days.metric).toBe('return_cost_paid_per_return_inr');
    expect(acc.body.export_url).toBe(`/api/v1/decisions/${acc.body.decision_id}/export?format=json`);

    const d = await request(app).get(`${api}/decisions/${acc.body.decision_id}`);
    expect(d.status).toBe(200);
    const action = run.actions[1];
    expect(d.body).toMatchObject({
      analysis_id: run.analysis_id,
      intervention: 'charge_return_shipping',
      expected_delta_inr: 280,
      owner: 'Owner',
      confidence: action.confidence,
      test_30d: action.decision_draft.test_30d,
      stop_rule: action.decision_draft.stop_rule,
    });
    expect(d.body.starting_state.totals.contribution_inr).toBe(7053);
    expect(d.body.check_in_30_days.contribution_target_inr).toBe(7053 + 280);

    const named = await request(app).post(`${api}/autopilot/${run.autopilot_id}/accept`).send({ rank: 1, owner: 'Asha' });
    expect((await request(app).get(`${api}/decisions/${named.body.decision_id}`)).body.owner).toBe('Asha');
    const after = (await request(app).get(`${api}/autopilot/${run.autopilot_id}`)).body;
    expect(after.accepted).toEqual([
      { rank: 2, decision_id: acc.body.decision_id },
      { rank: 1, decision_id: named.body.decision_id },
    ]);

    expect((await request(app).post(`${api}/autopilot/${run.autopilot_id}/accept`).send({ rank: 4 })).status).toBe(422);
    expect((await request(app).post(`${api}/autopilot/nope/accept`).send({ rank: 1 })).status).toBe(404);
  });

  it('SSE: a finished run emits done immediately and closes; headers do not buffer', async () => {
    const run = (await request(app).post(`${api}/datasets/${datasetId}/autopilot`).send({})).body;
    const s = await sse(`${api}/autopilot/${run.autopilot_id}/events`);
    expect(s.status).toBe(200);
    expect(s.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(s.headers['cache-control']).toMatch(/no-cache/);
    expect(s.headers['x-accel-buffering']).toBe('no');
    expect(s.headers['content-encoding']).toBeUndefined();
    expect(s.events.map((e) => e.event)).toEqual(['done']);
    expect(s.events[0].data).toMatchObject({ autopilot_id: run.autopilot_id, status: 'done' });
  });

  it('SSE streams stage events and a final done while AI explanations run; numbers come first', async () => {
    let release = () => undefined as void;
    const gate = new Promise<void>((r) => (release = r));
    setModelForTests(echo(gate));
    const r = await request(app).post(`${api}/datasets/${datasetId}/autopilot`).send({ lang: 'en' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('running');
    expect(r.body.stages.explanations).toBe('pending');
    expect(r.body.actions.map((x: any) => x.expected_delta_inr)).toEqual([390, 280, 180]);
    expect(r.body.actions.every((x: any) => x.explanation.source === 'template')).toBe(true);

    const pending = sse(`${api}/autopilot/${r.body.autopilot_id}/events`);
    setTimeout(release, 50);
    const s = await pending;
    const names = s.events.map((e) => e.event);
    expect(names[names.length - 1]).toBe('done');
    expect(s.events).toContainEqual({ event: 'stage', data: { stage: 'explanations', status: 'done' } });
    const done = s.events[s.events.length - 1].data;
    expect(done.status).toBe('done');
    expect(done.actions.map((x: any) => x.explanation.source)).toEqual(['ai', 'ai', 'ai']);
    expect(done.actions[0].explanation.text).toBe(`In short: ${r.body.actions[0].explanation.text}`);
  });

  it('AI off gives template explanations: no model, header switch, customer data, ungrounded output', async () => {
    const off = (await request(app).post(`${api}/datasets/${datasetId}/autopilot`).send({})).body;
    expect(off.actions.map((x: any) => x.explanation.source)).toEqual(['template', 'template', 'template']);

    setModelForTests(echo());
    const header = (await request(app).post(`${api}/datasets/${datasetId}/autopilot`).set('X-Profyn-AI', 'off').send({})).body;
    expect(header.status).toBe('done');
    expect(header.actions.map((x: any) => x.explanation)).toEqual(off.actions.map((x: any) => x.explanation));

    // An uploaded file that is not labelled synthetic is customer data: templates unless the user consented.
    const csv =
      'order_id,date,gross_inr,discount_inr,refund_inr,net_sales_inr,product_cost_inr,recovered_product_cost_inr,shipping_inr,payment_fee_inr,return_cost_inr,returned\n' +
      'U1,2026-09-02,1000,100,900,0,400,200,60,20,50,true\nU2,2026-09-03,1200,0,0,1200,500,0,60,20,0,false\n';
    const up = (await request(app).post(`${api}/datasets`).attach('file', Buffer.from(csv), 'orders.csv')).body.dataset_id;
    const customer = (await request(app).post(`${api}/datasets/${up}/autopilot`).send({})).body;
    expect(customer.status).toBe('done');
    expect(customer.actions.every((x: any) => x.explanation.source === 'template')).toBe(true);

    setModelForTests({ model: 'stub-liar', generate: async () => JSON.stringify({ action_1: 'This adds ₹ 99,999.', action_2: 'Fine.', action_3: 'Also ₹ 5.' }) });
    const liar = await request(app).post(`${api}/datasets/${datasetId}/autopilot`).send({});
    let doc = liar.body;
    for (let i = 0; i < 20 && doc.status === 'running'; i++) doc = (await request(app).get(`${api}/autopilot/${doc.autopilot_id}`)).body;
    expect(doc.status).toBe('done');
    expect(doc.actions.map((x: any) => x.explanation.source)).toEqual(['template', 'ai', 'template']);
    expect(doc.actions[0].explanation.text).toBe(off.actions[0].explanation.text);
  });

  it('Hindi run keeps every number; unknown dataset is 404; attribution conflict is refused like /analyses', async () => {
    const hi = (await request(app).post(`${api}/datasets/${datasetId}/autopilot`).send({ lang: 'hi' })).body;
    expect(hi.lang).toBe('hi');
    expect(hi.actions.map((x: any) => x.expected_delta_inr)).toEqual([390, 280, 180]);
    expect(hi.actions[0].explanation.text).toMatch(/[ऀ-ॿ]/);
    expect(hi.actions[0].explanation.text).toContain('390');
    expect((await request(app).post(`${api}/datasets/nope/autopilot`).send({})).status).toBe(404);
    const bad = await request(app).post(`${api}/datasets/${datasetId}/autopilot`).send({ attribution: 'allocate', channel_spend: { web: 100 } });
    expect([409, 422]).toContain(bad.status);
  });
});
