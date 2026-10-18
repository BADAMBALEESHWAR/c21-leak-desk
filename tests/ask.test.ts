import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setModelForTests, type AiModel } from '../api/src/ai/grounded';
import { aiCounts } from '../api/src/ai/guardlog';
import { createApp } from '../api/src/app';

const app = createApp();
const api = '/api/v1';

/** A stub model: picks the given tool and phrases with `answer(result)`. Records the prompts it saw. */
function stub(tool: { name: string; args: Record<string, unknown> } | null, answer: (result: any) => string, seen: string[] = []): AiModel {
  return {
    model: `stub-ask-${Math.random()}`,
    async chooseTool(_s, user) {
      seen.push(user);
      return tool;
    },
    async generate(_s, user) {
      seen.push(user);
      const body = JSON.parse(user.slice(user.indexOf('\n') + 1));
      return JSON.stringify({ answer: answer(body.result) });
    },
  };
}

describe('ask profyn (v2 §1.3)', () => {
  let ext = '';
  let demo = '';
  let demoAnalysis: any;
  beforeAll(async () => {
    const d = (await request(app).post(`${api}/datasets`).send({ source: 'extended' })).body.dataset_id;
    ext = (await request(app).post(`${api}/datasets/${d}/analyses`).send({ attribution: 'allocate' })).body.analysis_id;
    const d12 = (await request(app).post(`${api}/datasets`).send({ source: 'demo_12m' })).body.dataset_id;
    demoAnalysis = (await request(app).post(`${api}/datasets/${d12}/analyses`).send({ attribution: 'allocate' })).body;
    demo = demoAnalysis.analysis_id;
  });
  afterEach(() => setModelForTests(undefined));

  const ask = (id: string, question: string, lang?: string) => request(app).post(`${api}/analyses/${id}/ask`).send({ question, ...(lang ? { lang } : {}) });

  it('without AI, the keyword router picks the tool and a template answers from its result', async () => {
    const p = await ask(demo, 'Which product lost most in September?');
    expect(p.status).toBe(200);
    expect(p.body.tool).toEqual({ name: 'pulse.products', args: { month: '2026-09', order: 'lowest_contribution' } });
    const worst = p.body.result.products[0];
    expect(p.body).toMatchObject({ source: 'template', rejected: false, link: { route: 'ledger', params: { product: worst.product_id, month: '2026-09' } } });
    expect(p.body.answer).toContain(worst.product_id);
    expect(p.body.result.products.every((x: any, i: number, all: any[]) => i === 0 || all[i - 1].contribution_inr <= x.contribution_inr)).toBe(true);

    const c = await ask(ext, 'Why is Instagram negative?');
    expect(c.body.tool).toEqual({ name: 'pulse.channels', args: { channel: 'instagram' } });
    expect(c.body.link).toEqual({ route: 'ledger', params: { channel: 'instagram' } });
    expect(c.body.answer).toMatch(/^instagram: /);

    const s = await ask(ext, 'What if return shipping is charged?');
    expect(s.body.tool).toEqual({ name: 'scenario.run', args: { intervention: 'charge_return_shipping' } });
    expect(s.body.result).toMatchObject({ kind: 'candidate', delta_inr: 280 });
    expect(s.body.link.route).toBe('scenario');
    expect(s.body.answer).toContain('280');

    const o = await ask(ext, 'What if recovery is 50%?');
    expect(o.body.tool).toEqual({ name: 'scenario.run', args: { override: 'recovery_pct', value: 50 } });
    expect(o.body.result).toMatchObject({ kind: 'override', overrides: { recovery_pct: 50 }, baseline_contribution_inr: 7053 });

    const l = await ask(ext, 'Where are we leaking money?');
    expect(l.body.tool.name).toBe('leaks');
    expect(l.body.link).toEqual({ route: 'ledger', params: { cause: 'full_return_partial_recovery' } });
    expect(l.body.answer).toContain('1,384');

    const m = await ask(demo, 'How did each month go?');
    expect(m.body.tool.name).toBe('pulse.months');
    expect(m.body.result.months.length).toBe(12);
    expect(m.body.link.route).toBe('pulse');
  });

  it('with a stubbed model: the model picks the tool and phrases from the tool JSON only', async () => {
    const seen: string[] = [];
    setModelForTests(stub({ name: 'pulse_channels', args: { channel: 'instagram', extra: null } }, (r) => `Instagram brought ${r.focus.orders} orders and ${r.focus.contribution_inr} contribution.`, seen));
    const r = await ask(ext, 'How is instagram doing?');
    expect(r.body.tool).toEqual({ name: 'pulse.channels', args: { channel: 'instagram' } });
    expect(r.body).toMatchObject({ source: 'ai', rejected: false });
    expect(r.body.answer).toContain(String(r.body.result.focus.orders));
    // The model saw the question and tool output, never an order row.
    expect(seen.join('\n')).not.toContain('product_cost_inr');
  });

  it('grounding: a figure that is not in the tool result withholds the answer (source table)', async () => {
    const before = aiCounts().by_feature.ask.rejected;
    setModelForTests(stub({ name: 'leaks', args: {} }, () => 'You lost ₹ 99,999 on returns.'));
    const r = await ask(ext, 'Where did we lose money?');
    expect(r.body).toMatchObject({ answer: null, source: 'table', rejected: true, message: 'AI could not phrase this safely', tool: { name: 'leaks' } });
    expect(r.body.result.leaks[0]).toMatchObject({ cause: 'full_return_partial_recovery', lost_inr: 1384 });
    expect(r.body.link.route).toBe('ledger');
    expect(aiCounts().by_feature.ask.rejected).toBe(before + 1);
  });

  it('an invalid tool choice falls back to the keyword router', async () => {
    setModelForTests(stub({ name: 'drop_tables', args: {} }, (r) => `Top leak lost ${r.leaks[0].lost_inr}.`));
    const r = await ask(ext, 'Why are we losing money?');
    expect(r.body.tool.name).toBe('leaks');
    expect(r.body.source).toBe('ai');
  });

  it('language: Hindi and Telugu templates without AI; the model is told the language', async () => {
    const hi = await ask(ext, 'Where are we leaking money?', 'hi');
    expect(hi.body.answer).toMatch(/[ऀ-ॿ]/);
    expect(hi.body.answer).toContain('1,384');
    expect(hi.body.lang).toBe('hi');
    const te = await ask(ext, 'ఎందుకు నష్టం?', 'te');
    expect(te.body.tool.name).toBe('leaks');
    expect(te.body.answer).toMatch(/[ఀ-౿]/);

    const seen: string[] = [];
    setModelForTests(stub({ name: 'leaks', args: {} }, (r) => `सबसे बड़ा लीक: ${r.leaks[0].lost_inr}`, seen));
    const ai = await ask(ext, 'Where are we leaking money?', 'te');
    expect(seen.some((u) => u.includes('Telugu'))).toBe(true);
    expect(ai.body.source).toBe('ai');
  });

  it('header switch off: templates even with a model; bad body is 422', async () => {
    setModelForTests(stub({ name: 'leaks', args: {} }, () => 'x'));
    const r = await request(app).post(`${api}/analyses/${ext}/ask`).set('X-Profyn-AI', 'off').send({ question: 'Where are we leaking money?' });
    expect(r.body.source).toBe('template');
    expect((await request(app).post(`${api}/analyses/${ext}/ask`).send({})).status).toBe(422);
    expect((await request(app).post(`${api}/analyses/nope/ask`).send({ question: 'hi' })).status).toBe(404);
  });
});
