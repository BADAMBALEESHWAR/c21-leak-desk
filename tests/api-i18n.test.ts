import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../api/src/app';
import { guard, narrate, userPrompt, type ModelClient, type NarrationInput } from '../api/src/ai/client';
import { fromAcceptLanguage } from '../api/src/ai/localize';
import { describerFor, LANGS, recommendationText, TEMPLATE_NAMES, type Lang } from '../api/src/ai/templates';
import { TEMPLATE_FILES } from '../api/src/ai/templates/bundle';
import type { InterventionKey, LeakCause, Observed, OrderRow } from '../api/src/engine/types';

// B2 (API): template text per language. The language is chosen first and numbers are filled in afterwards,
// so Hindi and Telugu text carries exactly the numbers of the English text.

const DIR = path.resolve(__dirname, '..', 'api', 'src', 'ai', 'templates');
/** Numbers as the AI guard reads them (grouping commas dropped). */
const numbers = (text: string) => (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '')).sort();
const TELUGU = /[ఀ-౿]/;
const DEVANAGARI = /[ऀ-ॿ]/;

describe('template files', () => {
  it('en, hi and te have the same set of templates, and the bundled copy matches the files', () => {
    for (const lang of LANGS) {
      const names = readdirSync(path.join(DIR, lang)).filter((n) => n.endsWith('.hbs')).map((n) => n.replace(/\.hbs$/, '')).sort();
      expect(names).toEqual(TEMPLATE_NAMES);
      const files = Object.fromEntries(
        readdirSync(path.join(DIR, lang))
          .filter((n) => n.endsWith('.hbs') || n === 'labels.json')
          .map((n) => [n, readFileSync(path.join(DIR, lang, n), 'utf8').replace(/\r\n/g, '\n')]),
      );
      // If this fails, run: node api/src/ai/templates/build-bundle.mjs
      expect(TEMPLATE_FILES[lang]).toEqual(files);
    }
  });

  const observed = (recovery: number | null): Observed => ({
    return_rate_pct: 22.2,
    recovery_pct: recovery,
    avg_product_cost_on_returns_inr: 400,
    avg_return_cost_inr: 56,
    avg_shipping_inr: 60,
    avg_ads_per_order_inr: 18.15,
    returned_orders: 6,
    refund_unknown_orders: 1,
  });
  const row = (id: string): OrderRow => ({ order_id: id, date: '2026-09-06', gross_inr: 1000, discount_inr: 100, refund_inr: 900, net_sales_inr: 0, product_cost_inr: 400, recovered_product_cost_inr: 350, shipping_inr: 60, payment_fee_inr: 20, return_cost_inr: 50, returned: true });

  it('every leak and recommendation template carries the same numbers in all three languages', () => {
    const causes: LeakCause[] = ['full_return_partial_recovery', 'refund_unknown', 'fees_exceed_margin', 'discount_exceeds_margin', 'other_negative'];
    const interventions: InterventionKey[] = ['raise_recovery_via_inspection', 'charge_return_shipping', 'cap_discount', 'add_handling_to_price', 'none'];
    const ids = ['O05', 'O10', 'O15', 'O20', 'S03'];
    const render = (lang: Lang) => [
      ...causes.flatMap((cause) =>
        [1, 5].map((count) => describerFor(lang)({ cause, label: '', count, lost_inr: 1384, order_ids: ids.slice(0, count), example_ids: ids.slice(0, Math.min(3, count)) }, ids.slice(0, count).map(row))),
      ),
      ...interventions.flatMap((k) => [71.4, null].flatMap((rec) => Object.values(recommendationText(lang, { intervention: k, expected_delta_inr: 1390 }, observed(rec), 5)))),
    ];
    const en = render('en');
    for (const lang of ['hi', 'te'] as const) {
      const other = render(lang);
      expect(other).toHaveLength(en.length);
      other.forEach((text, i) => {
        expect(numbers(text), `${lang} #${i}: ${text}`).toEqual(numbers(en[i]));
        expect(text).not.toBe(en[i]);
        expect((lang === 'te' ? TELUGU : DEVANAGARI).test(text)).toBe(true);
      });
    }
  });
});

describe('language selection', () => {
  it('Accept-Language picks the highest-weighted supported language, else English', () => {
    expect(fromAcceptLanguage(undefined)).toBe('en');
    expect(fromAcceptLanguage('te-IN,te;q=0.9,en;q=0.8')).toBe('te');
    expect(fromAcceptLanguage('en-US,en;q=0.9,hi;q=0.8')).toBe('en');
    expect(fromAcceptLanguage('fr-FR,hi;q=0.5')).toBe('hi');
    expect(fromAcceptLanguage('fr-FR,de;q=0.5')).toBe('en');
  });
});

describe('?lang= on the API', () => {
  const app = createApp();
  const api = '/api/v1';
  let analysisId = '';

  beforeAll(async () => {
    const d = await request(app).post(`${api}/datasets`).send({ source: 'extended' });
    analysisId = (await request(app).post(`${api}/datasets/${d.body.dataset_id}/analyses`).send({ attribution: 'allocate' })).body.analysis_id;
  });

  it('?lang=te returns Telugu text whose numbers equal the English version’s numbers', async () => {
    const en = (await request(app).get(`${api}/analyses/${analysisId}`)).body;
    const te = (await request(app).get(`${api}/analyses/${analysisId}?lang=te`)).body;
    expect([en.lang, te.lang]).toEqual(['en', 'te']);
    const texts = (a: any) => [...a.leaks.map((l: any) => l.why), a.recommendation.why, a.recommendation.test_30d_draft, a.recommendation.stop_rule_draft];
    expect(texts(te)).toHaveLength(texts(en).length);
    texts(te).forEach((t: string, i: number) => {
      expect(TELUGU.test(t)).toBe(true);
      expect(numbers(t)).toEqual(numbers(texts(en)[i]));
    });
    // Everything else is the same analysis.
    expect(te.totals).toEqual(en.totals);
    expect(te.recommendation.expected_delta_inr).toBe(en.recommendation.expected_delta_inr);
    expect(te.leaks.map((l: any) => l.lost_inr)).toEqual(en.leaks.map((l: any) => l.lost_inr));
  });

  it('Accept-Language: hi gives Hindi; ?lang= wins over the header', async () => {
    const hi = (await request(app).get(`${api}/analyses/${analysisId}`).set('Accept-Language', 'hi-IN,hi;q=0.9')).body;
    expect(hi.lang).toBe('hi');
    expect(DEVANAGARI.test(hi.recommendation.why)).toBe(true);
    const en = (await request(app).get(`${api}/analyses/${analysisId}?lang=en`).set('Accept-Language', 'hi-IN')).body;
    expect(en.lang).toBe('en');
    expect(en.recommendation.why).toMatch(/^Returns currently recover/);
  });

  it('scenario text and the 30-day test plan follow ?lang=, with the same numbers', async () => {
    const en = (await request(app).post(`${api}/analyses/${analysisId}/scenarios`).send({ overrides: { recovery_pct: 50 } })).body;
    const te = (await request(app).post(`${api}/analyses/${analysisId}/scenarios?lang=te`).send({ overrides: { recovery_pct: 50 } })).body;
    expect(te.recommendation.intervention).toBe(en.recommendation.intervention);
    expect(TELUGU.test(te.recommendation.why)).toBe(true);
    expect(numbers(te.recommendation.why)).toEqual(numbers(en.recommendation.why));
    const stored = (await request(app).get(`${api}/scenarios/${en.scenario_id}?lang=te`)).body;
    expect(stored.recommendation.why).toBe(te.recommendation.why);
    const plan = (await request(app).post(`${api}/scenarios/${en.scenario_id}/test-plan?lang=hi`)).body;
    expect(plan.lang).toBe('hi');
    expect(DEVANAGARI.test(plan.test_30d)).toBe(true);
    expect(numbers(plan.test_30d)).toEqual(numbers(en.recommendation.test_30d_draft));
  });

  it('narrate falls back to the template text in the requested language', async () => {
    const r = (await request(app).post(`${api}/analyses/${analysisId}/narrate?lang=te`)).body;
    expect(r.lang).toBe('te');
    expect(r.leaks.every((l: any) => l.why_source === 'template' && TELUGU.test(l.why))).toBe(true);
  });

  it('GET /i18n/labels returns the four candidates and "no change" per language, numbers unchanged', async () => {
    const en = (await request(app).get(`${api}/i18n/labels?lang=en`)).body;
    const te = (await request(app).get(`${api}/i18n/labels?lang=te`)).body;
    const hi = (await request(app).get(`${api}/i18n/labels`).set('Accept-Language', 'hi')).body;
    expect(en.candidates.map((c: any) => c.intervention)).toEqual(['raise_recovery_via_inspection', 'charge_return_shipping', 'cap_discount', 'add_handling_to_price']);
    expect(en.candidates[0]).toEqual({ intervention: 'raise_recovery_via_inspection', label: 'Raise recovery via inspection', description: 'Inspect returns before restocking so recovered stock reaches 90% of product cost.' });
    expect(en.no_change).toMatchObject({ intervention: 'none', label: 'No change' });
    for (const other of [te, hi]) {
      expect(other.candidates.map((c: any) => c.intervention)).toEqual(en.candidates.map((c: any) => c.intervention));
      other.candidates.forEach((c: any, i: number) => {
        expect(c.label).not.toBe(en.candidates[i].label);
        expect(numbers(c.description)).toEqual(numbers(en.candidates[i].description));
      });
    }
    expect(te.candidates[0].label).toBe('తనిఖీతో రికవరీ పెంచండి');
    expect(hi.lang).toBe('hi');
  });
});

describe('AI narration in other languages keeps the number guard', () => {
  const input: NarrationInput = {
    kind: 'leak',
    lang: 'te',
    data: { cause: 'full_return_partial_recovery', count: 5, lost_inr: 1384, order_ids: ['O05', 'O10', 'O15', 'O20', 'S03'] },
    template: '5 ఆర్డర్‌లకు పూర్తి రీఫండ్ ఇచ్చారు; ఈ ఆర్డర్‌లపై ₹ 1,384 నష్టం వచ్చింది.',
  };
  const good = {
    headline: '5 రిటర్న్ ఆర్డర్‌లపై ₹1,384 నష్టం',
    what_is_happening: 'పూర్తి రీఫండ్ ఇచ్చారు, ఉత్పత్తి ఖర్చులో కొంత మాత్రమే రికవరీ అయింది.',
    why_it_costs_contribution: 'రిటర్న్ ఖర్చు, షిప్పింగ్ బ్రాండ్‌పైనే పడుతున్నాయి.',
    recommended_change: 'సిఫార్సు కార్డు చూడండి.',
    expected_effect: 'ఇక్కడ అంచనా వేయలేదు.',
    confidence: 'high',
  };

  it('the prompt says "Reply in Telugu."', async () => {
    expect(userPrompt(input).startsWith('Reply in Telugu.\n')).toBe(true);
    expect(userPrompt({ ...input, lang: undefined }).startsWith('Reply in English.\n')).toBe(true);
    let seen = '';
    const client: ModelClient = { model: 'stub', generate: async (_s, user) => ((seen = user), JSON.stringify(good)) };
    expect((await narrate(input, client)).source).toBe('ai');
    expect(seen).toContain('Reply in Telugu.');
  });

  it('a foreign number, native-script digits or a banned word in Telugu fall back to the template', () => {
    expect(guard(JSON.stringify(good), input).ok).toBe(true);
    expect(guard(JSON.stringify({ ...good, expected_effect: 'సుమారు ₹2,000 అదనం.' }), input)).toEqual({ ok: false, reason: 'foreign_number:2000' });
    expect(guard(JSON.stringify({ ...good, headline: '౫ ఆర్డర్‌లపై నష్టం' }), input)).toEqual({ ok: false, reason: 'native_digits' });
    expect(guard(JSON.stringify({ ...good, why_it_costs_contribution: 'ఇది లాభం తగ్గిస్తుంది.' }), input)).toEqual({ ok: false, reason: 'banned_word' });
  });
});
