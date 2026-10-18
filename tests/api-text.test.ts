// Engine sentences the API sends in English are shown in the UI language (web/src/lib/apiText.ts). These checks keep the
// web templates in step with the engine: every engine text below must be recognised, English must come back unchanged,
// and Hindi/Telugu must keep the numbers.
import { afterEach, describe, expect, it } from 'vitest';
import { REGION_NOTE } from '../api/src/ai/guardlog';
import { analyze } from '../api/src/engine/analyze';
import { LEAK_LABELS } from '../api/src/engine/leaks';
import { MARGIN_FORMULAS } from '../api/src/engine/margins';
import { pulseOverview, pulseProducts } from '../api/src/engine/pulse';
import { INTERVENTIONS } from '../api/src/engine/scenario';
import { ATTRIBUTION_LABEL } from '../api/src/engine/types';
import { validateRows } from '../api/src/engine/validate';
import en from '../web/src/i18n/en.json';
import hi from '../web/src/i18n/hi.json';
import te from '../web/src/i18n/te.json';
import { i18n } from '../web/src/i18n';
import { API_TEXTS, apiText } from '../web/src/lib/apiText';
import { EXTENDED, FIXTURE, NEG, rawOrders, rows } from './helpers';

type Dict = { [k: string]: string | Dict };
const get = (d: Dict, key: string) => key.split('.').reduce<string | Dict | undefined>((o, k) => (o && typeof o === 'object' ? o[k] : undefined), d);
const numbers = (s: string) => (s.match(/\d+(?:,\d+)*(?:\.\d+)?/g) ?? []).sort();

afterEach(() => {
  void i18n.changeLanguage('en');
});

/** Every English engine text the UI renders, from the engine itself. */
function engineTexts(): string[] {
  const out = new Set<string>([ATTRIBUTION_LABEL, REGION_NOTE, ...Object.values(LEAK_LABELS), ...Object.values(MARGIN_FORMULAS)]);
  for (const iv of Object.values(INTERVENTIONS)) out.add(iv.label).add(iv.rule);
  for (const file of [FIXTURE, EXTENDED, NEG('null_refund.json'), NEG('late_refund.json'), 'demo_12m.json']) {
    for (const mode of ['allocate', 'channel'] as const) {
      const a = analyze(rows(file), { attribution: mode });
      for (const o of a.orders) for (const l of o.lines ?? []) {
        out.add(l.label);
        if (l.note) out.add(l.note);
      }
      for (const l of a.labels ?? []) out.add(l);
      if (file === 'demo_12m.json') {
        for (const act of pulseOverview(a).actions) out.add(act.title).add(act.detail);
        for (const p of pulseProducts(a).products) out.add(p.note);
      }
    }
  }
  for (const file of [NEG('null_refund.json'), NEG('duplicate_order.json'), NEG('refund_over_gross.json')]) {
    for (const f of validateRows(rawOrders(file)).flags) out.add(f.detail);
  }
  return [...out].filter(Boolean);
}

describe('engine text in the UI language', () => {
  it('every key exists in en, hi and te, with the engine English in en.json', () => {
    for (const [key, text] of API_TEXTS) {
      expect(get(en as Dict, key), key).toBe(text);
      expect(typeof get(hi as Dict, key), key).toBe('string');
      expect(typeof get(te as Dict, key), key).toBe('string');
    }
  });

  it('English comes back exactly as sent', () => {
    for (const s of engineTexts()) expect(apiText(s)).toBe(s);
  });

  it.each(['hi', 'te'] as const)('%s: every engine text is translated and keeps its numbers', async (lng) => {
    await i18n.changeLanguage(lng);
    const untranslated = engineTexts().filter((s) => apiText(s) === s);
    expect(untranslated).toEqual([]);
    for (const s of engineTexts()) expect(numbers(apiText(s))).toEqual(numbers(s));
  });

  it('unknown text and data values pass through unchanged', async () => {
    await i18n.changeLanguage('hi');
    expect(apiText('instagram')).toBe('instagram');
    expect(apiText('Something the engine never says.')).toBe('Something the engine never says.');
    expect(apiText(null)).toBe('');
  });
});
