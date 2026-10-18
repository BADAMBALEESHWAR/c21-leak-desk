import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setModelForTests, type AiModel } from '../api/src/ai/grounded';
import { FIELDS_SENT } from '../api/src/ai/guardlog';
import { createApp } from '../api/src/app';

const app = createApp();
const api = '/api/v1';

const fieldsOf = (user: string) => JSON.parse(user.slice(user.indexOf('\n') + 1)).fields as Record<string, { data: unknown; template: string }>;

describe('monthly digest (v2 §1.5) and AI status (v2 §5.1)', () => {
  let demo = '';
  let datasetId = '';
  beforeAll(async () => {
    datasetId = (await request(app).post(`${api}/datasets`).send({ source: 'demo_12m' })).body.dataset_id;
    demo = (await request(app).post(`${api}/datasets/${datasetId}/analyses`).send({ attribution: 'allocate' })).body.analysis_id;
  });
  afterEach(() => setModelForTests(undefined));

  it('four template sections from Pulse, leaks and decisions; badge says the numbers are the engine’s', async () => {
    const r = await request(app).get(`${api}/analyses/${demo}/digest`);
    expect(r.status).toBe(200);
    expect(r.body.sections.map((s: any) => s.key)).toEqual(['changed', 'leaked', 'decided', 'check']);
    expect(r.body.source).toBe('template');
    expect(r.body.badge).toMatch(/numbers from the engine$/);
    expect(r.body.sections[0].text).toMatch(/^In 2026-09, /);
    expect(r.body.sections[1].text).toContain('4,68,678');
    expect(r.body.sections[2].text).toMatch(/^No decision saved yet/);

    // After a decision, "decided" and "check" restate it.
    await request(app)
      .post(`${api}/analyses/${demo}/decisions`)
      .send({ intervention: 'cap_discount', expected_delta_inr: 110365, test_30d: 't', stop_rule: 's', owner: 'Ravi' });
    const after = await request(app).get(`${api}/analyses/${demo}/digest`);
    expect(after.body.sections[2].text).toContain('Ravi');
    expect(after.body.sections[3].text).toMatch(/^On \d{4}-\d{2}-\d{2}, check/);
  });

  it('Hindi and Telugu titles and text; AI text replaces sections only when grounded', async () => {
    const hi = await request(app).get(`${api}/analyses/${demo}/digest?lang=hi`);
    expect(hi.body.sections[0].title).toBe('क्या बदला');
    expect(hi.body.sections[1].text).toContain('4,68,678');
    const te = await request(app).get(`${api}/analyses/${demo}/digest?lang=te`);
    expect(te.body.sections[3].title).toMatch(/[ఀ-౿]/);

    let sent: Record<string, { data: unknown; template: string }> = {};
    const model: AiModel = {
      model: 'stub-digest',
      generate: async (_s, user) => {
        sent = fieldsOf(user);
        return JSON.stringify({ changed: sent.changed.template, leaked: 'Returns leaked ₹ 1,23,456.', decided: sent.decided.template, check: sent.check.template });
      },
    };
    setModelForTests(model);
    const ai = await request(app).get(`${api}/analyses/${demo}/digest`);
    expect(ai.body.source).toBe('ai');
    expect(ai.body.badge).toBe('AI summary · numbers from the engine');
    expect(ai.body.sections.map((s: any) => s.source)).toEqual(['ai', 'template', 'ai', 'ai']);
    const flat = (o: any, p = ''): string[] =>
      o && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o).flatMap(([k, v]) => (Array.isArray(v) ? (v as any[]).flatMap((x) => Object.keys(x).map((kk) => `${p}${k}[].${kk}`)) : v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`])) : [];
    for (const f of Object.values(sent)) for (const k of flat(f.data)) expect(FIELDS_SENT.digest).toContain(k);
  });

  it('GET /ai/status lists the model, counters and exactly which fields leave the API', async () => {
    const r = await request(app).get(`${api}/ai/status`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ enabled: false, provider: 'Gemini', model: 'gemini-3.5-flash' });
    expect(Object.keys(r.body.fields_sent)).toEqual(expect.arrayContaining(['narration', 'advisor', 'ask', 'digest']));
    for (const k of ['calls', 'accepted', 'rejected']) expect(typeof r.body[k]).toBe('number');
    expect(r.body.by_feature.ask).toMatchObject({ calls: expect.any(Number), accepted: expect.any(Number), rejected: expect.any(Number) });
    expect(r.body.region_note).toMatch(/ap-south-1/);

    setModelForTests({ model: 'stub-status', generate: async () => '{}' });
    const on = await request(app).get(`${api}/ai/status?dataset_id=${datasetId}`);
    expect(on.body).toMatchObject({ enabled: true, model: 'stub-status', policy: { allowed: true, reason: 'demo_data' } });
    const off = await request(app).get(`${api}/ai/status?dataset_id=${datasetId}`).set('X-Profyn-AI', 'off');
    expect(off.body.policy).toEqual({ allowed: false, reason: 'switched_off' });
  });
});
