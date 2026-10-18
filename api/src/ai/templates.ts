import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Handlebars from 'handlebars';
import type { Describe } from '../engine/leaks.js';
import type { Ledger } from '../engine/ledger.js';
import type { Narrator } from '../engine/scenario.js';
import { DISCOUNT_CAP_PCT, RECOVERY_TARGET_PCT } from '../engine/scenario.js';
import type { InterventionKey, LeakCause, Observed, OrderRow } from '../engine/types.js';
import { TEMPLATE_FILES } from './templates/bundle.js';

// Deterministic "why" text and 30-day test drafts in English, Hindi and Telugu. The language is chosen first;
// numbers are template variables filled afterwards, so they are the same in every language.
// AI may reword these (labelled "ai"); numbers always come from here.
// Text lives in api/src/ai/templates/{en,hi,te}/*.hbs (same file set in each); bundle.ts is the copy the compiled API reads.

export { formatInr } from '../engine/format.js';
import { formatInr } from '../engine/format.js';

export const LANGS = ['en', 'hi', 'te'] as const;
export type Lang = (typeof LANGS)[number];
export const LANGUAGE_NAMES: Record<Lang, string> = { en: 'English', hi: 'Hindi', te: 'Telugu' };
export const isLang = (s: unknown): s is Lang => typeof s === 'string' && (LANGS as readonly string[]).includes(s);

const TEMPLATE_DIR = path.join(__dirname, 'templates');
const isTemplateFile = (name: string) => name.endsWith('.hbs') || name === 'labels.json';

/** One language's template files: from api/src/ai/templates/<lang>/ when present (dev, tests), else the bundled copy (dist). */
export function templateFiles(lang: Lang): Record<string, string> {
  const dir = path.join(TEMPLATE_DIR, lang);
  if (!existsSync(dir)) return TEMPLATE_FILES[lang];
  const names = readdirSync(dir).filter(isTemplateFile).sort();
  return Object.fromEntries(names.map((n) => [n, readFileSync(path.join(dir, n), 'utf8').replace(/\r\n/g, '\n')]));
}

const hb = Handlebars.create();
hb.registerHelper('inr', (n: number | null) => formatInr(n));
hb.registerHelper('plural', (n: number, one: string, many: string) => (n === 1 ? one : many));
const compile = (s: string) => hb.compile(s.replace(/\n+$/, ''), { noEscape: true, strict: false });

type Tpl = HandlebarsTemplateDelegate;
const LEAK_CAUSES: LeakCause[] = ['full_return_partial_recovery', 'refund_unknown', 'fees_exceed_margin', 'discount_exceeds_margin', 'other_negative'];
export const CANDIDATE_KEYS = ['raise_recovery_via_inspection', 'charge_return_shipping', 'cap_discount', 'add_handling_to_price'] as const;
const INTERVENTION_KEYS: InterventionKey[] = [...CANDIDATE_KEYS, 'none'];
/** The three volume-based rules share one stop rule. */
const STOP_FILE: Record<InterventionKey, string> = {
  raise_recovery_via_inspection: 'stop.raise_recovery_via_inspection',
  charge_return_shipping: 'stop.same_volume',
  cap_discount: 'stop.same_volume',
  add_handling_to_price: 'stop.same_volume',
  none: 'stop.none',
};

interface Pack {
  leak: Record<LeakCause, Tpl>;
  why: Record<InterventionKey, Tpl>;
  test: Record<InterventionKey, Tpl>;
  stop: Record<InterventionKey, Tpl>;
  examples: Tpl;
  recoveryUnknown: Tpl;
  labels: Record<InterventionKey, { label: Tpl; description: Tpl }>;
}

/** Every template file a language must have; the same set in en, hi and te. */
export const TEMPLATE_NAMES: string[] = [
  ...LEAK_CAUSES.map((c) => `leak.${c}`),
  ...INTERVENTION_KEYS.map((k) => `why.${k}`),
  ...INTERVENTION_KEYS.map((k) => `test.${k}`),
  ...[...new Set(Object.values(STOP_FILE))],
  'part.examples',
  'part.recovery_unknown',
].sort();

function loadPack(lang: Lang): Pack {
  const files = templateFiles(lang);
  const tpl = (name: string) => {
    const text = files[`${name}.hbs`];
    if (text === undefined) throw new Error(`Template ${lang}/${name}.hbs is missing.`);
    return compile(text);
  };
  const by = <K extends string>(keys: readonly K[], name: (k: K) => string) => Object.fromEntries(keys.map((k) => [k, tpl(name(k))])) as Record<K, Tpl>;
  const rawLabels = JSON.parse(files['labels.json'] ?? '{}') as Record<string, { label: string; description: string }>;
  const labels = Object.fromEntries(
    INTERVENTION_KEYS.map((k) => {
      const l = rawLabels[k];
      if (!l) throw new Error(`labels.json for ${lang} has no entry for ${k}.`);
      return [k, { label: compile(l.label), description: compile(l.description) }];
    }),
  ) as Pack['labels'];
  return {
    leak: by(LEAK_CAUSES, (c) => `leak.${c}`),
    why: by(INTERVENTION_KEYS, (k) => `why.${k}`),
    test: by(INTERVENTION_KEYS, (k) => `test.${k}`),
    stop: by(INTERVENTION_KEYS, (k) => STOP_FILE[k]),
    examples: tpl('part.examples'),
    recoveryUnknown: tpl('part.recovery_unknown'),
    labels,
  };
}

const packs = new Map<Lang, Pack>();
function pack(lang: Lang): Pack {
  let p = packs.get(lang);
  if (!p) {
    p = loadPack(lang);
    packs.set(lang, p);
  }
  return p;
}

/** Leak "why" text in one language. */
export function describerFor(lang: Lang): Describe {
  return (g, rows: OrderRow[]) => {
    const p = pack(lang);
    const sum = (f: (r: OrderRow) => number | null) => rows.reduce((s, r) => s + (f(r) ?? 0), 0);
    const more = g.count > g.example_ids.length ? g.count - g.example_ids.length : 0;
    return p.leak[g.cause]({
      count: g.count,
      lost: g.lost_inr,
      examples: p.examples({ ids: g.example_ids.join(', '), more }),
      recovered: sum((r) => r.recovered_product_cost_inr),
      product_cost: sum((r) => r.product_cost_inr),
      discount: sum((r) => r.discount_inr),
    });
  };
}

function vars(lang: Lang, observed: Observed, delta: number, driving: number) {
  return {
    delta,
    driving,
    recovery: observed.recovery_pct === null ? pack(lang).recoveryUnknown({}) : `${observed.recovery_pct}%`,
    target: RECOVERY_TARGET_PCT,
    cap: DISCOUNT_CAP_PCT,
    rate: observed.return_rate_pct,
    return_cost: observed.avg_return_cost_inr,
  };
}

/** Recommendation "why" text and the 30-day test and stop drafts in one language. */
export function narratorFor(lang: Lang): Narrator {
  return {
    // confidence_reason is returned separately and shown beside the badge, so it is not repeated here.
    why: (rec, ledger) => pack(lang).why[rec.intervention](vars(lang, ledger.observed, rec.expected_delta_inr, rec.driving_orders)),
    test30d(intervention, ledger) {
      const v = vars(lang, ledger.observed, 0, 0);
      return { test: pack(lang).test[intervention](v), stop: pack(lang).stop[intervention](v) };
    },
  };
}

/** The English texts the engine stores with every analysis and scenario. */
export const describeLeak: Describe = describerFor('en');
export const templateNarrator: Narrator = narratorFor('en');

/**
 * Re-renders a stored recommendation's template text in another language from the same inputs:
 * the observed values of the state it was computed on and its driving orders.
 */
export function recommendationText(
  lang: Lang,
  rec: { intervention: InterventionKey; expected_delta_inr: number },
  observed: Observed,
  drivingOrders: number,
): { why: string; test_30d_draft: string; stop_rule_draft: string } {
  const state = { observed } as Ledger;
  const n = narratorFor(lang);
  const drafts = n.test30d(rec.intervention, state);
  return { why: n.why({ ...rec, driving_orders: drivingOrders } as Parameters<Narrator['why']>[0], state), test_30d_draft: drafts.test, stop_rule_draft: drafts.stop };
}

/** Candidate names and one-line descriptions in one language (numbers filled after the language is chosen). */
export function interventionLabels(lang: Lang): Array<{ intervention: InterventionKey; label: string; description: string }> {
  const v = { target: RECOVERY_TARGET_PCT, cap: DISCOUNT_CAP_PCT };
  return INTERVENTION_KEYS.map((k) => ({ intervention: k, label: pack(lang).labels[k].label(v), description: pack(lang).labels[k].description(v) }));
}
