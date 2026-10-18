import { afterEach, describe, expect, it } from 'vitest';
import { modelChain, resetModelRest, withFallback } from '../api/src/ai/models';
import { analyze } from '../api/src/engine/analyze';
import { validateRows } from '../api/src/engine/validate';
import { dataOutline, fitMonth, matchQuestion } from '../api/src/ai/tools';
import { readFileSync } from 'node:fs';

// Gemini's free tier refuses calls past a few a minute per model; the chain moves to the next model and never
// changes a number. Ask's month and keyword handling keeps answers on the data that exists.
const demo = JSON.parse(readFileSync(new URL('../data/demo_12m.json', import.meta.url), 'utf8'));
const a = analyze(validateRows(demo.records?.orders ?? demo.orders ?? demo).rows, { attribution: 'allocate' });

describe('AI model chain', () => {
  afterEach(() => {
    resetModelRest();
    delete process.env.GEMINI_MODELS;
  });
  it('moves to the next model on quota or load errors and rests the refused one', async () => {
    process.env.GEMINI_MODELS = 'm1,m2,m3';
    const tried: string[] = [];
    const out = await withFallback(async (m) => {
      tried.push(m);
      if (m === 'm1') throw new Error('[429 Too Many Requests] quota');
      if (m === 'm2') throw new Error('[503 Service Unavailable] high demand');
      return `ok:${m}`;
    });
    expect(out).toBe('ok:m3');
    expect(tried).toEqual(['m1', 'm2', 'm3']);
    const again: string[] = [];
    await withFallback(async (m) => (again.push(m), 'ok'));
    expect(again).toEqual(['m3']);
  });
  it('throws other errors at once', async () => {
    process.env.GEMINI_MODELS = 'm1,m2';
    const tried: string[] = [];
    await expect(withFallback(async (m) => (tried.push(m), Promise.reject(new Error('[401 Unauthorized] API key not valid'))))).rejects.toThrow('API key not valid');
    expect(tried).toEqual(['m1']);
  });
  it('defaults to the configured model followed by fast fallbacks, without duplicates', () => {
    expect(modelChain()[0]).toBe(process.env.GEMINI_MODEL || 'gemini-3.5-flash');
    expect(new Set(modelChain()).size).toBe(modelChain().length);
  });
});

describe('ask: months and keywords', () => {
  it('a model month outside the data moves to the latest month with the same number', () => {
    const fitted = fitMonth({ name: 'pulse.products', args: { month: '2024-09', order: 'lowest_contribution' } }, a);
    expect(fitted.args).toMatchObject({ month: '2026-09' });
    expect(fitMonth({ name: 'pulse.months', args: { month: '2026-08' } }, a).args).toEqual({ month: '2026-08' });
  });
  it('the outline lists the real months, channels and products', () => {
    const o = dataOutline(a);
    expect(o).toContain('2026-09');
    expect(o).toContain('instagram');
  });
  it('Telugu and Hindi channel words route to channels; an unmatched question returns null', () => {
    expect(matchQuestion('ఏ చానెల్ నష్టంలో ఉంది?', a)?.name).toBe('pulse.channels');
    expect(matchQuestion('कौन सा चैनल घाटे में है?', a)?.name).toBe('pulse.channels');
    expect(matchQuestion('Which product lost most in September?', a)).toMatchObject({ name: 'pulse.products', args: { month: '2026-09' } });
    expect(matchQuestion('hello there', a)).toBeNull();
  });
});

describe('ask: tidy money', async () => {
  const { sloppyMoney } = await import('../api/src/routes/ask');
  it('flags INR and bare amounts, accepts ₹ with Indian grouping and months', () => {
    expect(sloppyMoney('Instagram had -148425 INR contribution.')).toBe(true);
    expect(sloppyMoney('Best month 2026-08 with 56418.')).toBe(true);
    expect(sloppyMoney('Instagram: −₹ 1,48,425 contribution on 779 orders in 2026-09.')).toBe(false);
    expect(sloppyMoney('P2 lost −₹ 435 on 64 orders.')).toBe(false);
  });
});
