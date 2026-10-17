import { describe, expect, it, vi } from 'vitest';
import { guard, narrate, type ModelClient, type NarrationInput } from '../api/src/ai/client';

const input: NarrationInput = {
  kind: 'leak',
  data: { cause: 'full_return_partial_recovery', count: 5, lost_inr: 1384, order_ids: ['O05', 'O10', 'O15', 'O20', 'S03'] },
  template: '5 orders were refunded in full; these orders lost ₹ 1,384.',
};

const good = {
  headline: '5 returned orders lost ₹1,384 after partial stock recovery',
  what_is_happening: 'Each order was fully refunded and only part of the product cost came back as stock.',
  why_it_costs_contribution: 'The unrecovered cost, return handling and shipping stay with the brand.',
  recommended_change: 'See the recommendation card.',
  expected_effect: 'Not estimated here.',
  confidence: 'high',
};

const stub = (reply: string | (() => Promise<string>)): ModelClient => ({
  model: 'stub',
  generate: typeof reply === 'string' ? async () => reply : reply,
});

describe('ai guard (Blueprint §13.6)', () => {
  it('accepts output that only uses input numbers', () => {
    expect(guard(JSON.stringify(good), input).ok).toBe(true);
  });

  it('rejects malformed JSON', () => {
    expect(guard('not json', input)).toEqual({ ok: false, reason: 'malformed_json' });
  });

  it('rejects output that fails the schema', () => {
    expect(guard(JSON.stringify({ ...good, extra: 'x' }), input)).toEqual({ ok: false, reason: 'schema_mismatch' });
  });

  it('rejects a number that is not in the input', () => {
    const r = guard(JSON.stringify({ ...good, expected_effect: 'About ₹2,000 more.' }), input);
    expect(r).toEqual({ ok: false, reason: 'foreign_number:2000' });
  });

  it('rejects banned words', () => {
    expect(guard(JSON.stringify({ ...good, why_it_costs_contribution: 'This hurts profit.' }), input)).toEqual({ ok: false, reason: 'banned_word' });
  });

  it('treats insufficient_data as a fallback', () => {
    expect(guard('{"error":"insufficient_data"}', input)).toEqual({ ok: false, reason: 'insufficient_data' });
  });

  it('kill switch: no client → template text', async () => {
    expect(await narrate(input, null)).toMatchObject({ text: input.template, source: 'template', reason: 'disabled' });
  });

  it('good stub → ai text; foreign number stub → template', async () => {
    expect((await narrate(input, stub(JSON.stringify(good)))).source).toBe('ai');
    const bad = await narrate({ ...input, template: input.template + ' ' }, stub(JSON.stringify({ ...good, headline: '9 orders lost ₹9,999' })));
    expect(bad).toMatchObject({ source: 'template', reason: 'foreign_number:9' });
  });

  it('a non-quota error → template, never throws, no retry', async () => {
    const r = await narrate({ ...input, template: 'x 5' }, stub(async () => Promise.reject(new Error('500 upstream'))));
    expect(r).toMatchObject({ source: 'template', reason: 'error' });
  });

  it('429 → template now, background retry 20 s later fills the cache for the next call', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const flaky = stub(async () => (++calls === 1 ? Promise.reject(new Error('429 Too Many Requests')) : JSON.stringify(good)));
      const req = { ...input, template: input.template + ' (retry case)' };
      expect(await narrate(req, flaky)).toMatchObject({ source: 'template', reason: 'quota' });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(calls).toBe(2);
      expect(await narrate(req, flaky)).toMatchObject({ source: 'ai', reason: 'cache' });
    } finally {
      vi.useRealTimers();
    }
  });
});
