import { SchemaType, type FunctionDeclaration } from '@google/generative-ai';
import { z } from 'zod';
import { scenarioFor } from '../engine/analyze.js';
import { formatInr } from '../engine/format.js';
import type { LedgerOptions } from '../engine/ledger.js';
import { pulseChannels, pulseLeaks, pulseMonths, pulseOverview, pulseProducts } from '../engine/pulse.js';
import type { AnalysisResult, LeakCause, OrderRow } from '../engine/types.js';
import { OVERRIDE_KEYS, OverridesSchema, type ScenarioOverrides } from '../schema/orders.js';
import { inr, PHRASES } from './phrases.js';
import { CANDIDATE_KEYS, interventionLabels, type Lang } from './templates.js';

// Ask Profyn tools (v2 §1.3): five read-only tools over the engine's own output. The model may pick a tool and phrase
// its JSON; it never sees raw order rows and never computes a figure. Without AI a keyword router picks the tool.

export const TOOL_NAMES = ['leaks', 'pulse.months', 'pulse.products', 'pulse.channels', 'scenario.run'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export interface ToolCall {
  name: ToolName;
  args: Record<string, unknown>;
}
export interface ToolContext {
  a: AnalysisResult;
  rows: OrderRow[];
  opts: LedgerOptions;
}
export interface AskLink {
  route: 'ledger' | 'leaks' | 'pulse' | 'scenario';
  params: { cause?: string; channel?: string; product?: string; month?: string };
}

const LEAK_CAUSES = ['full_return_partial_recovery', 'refund_unknown', 'fees_exceed_margin', 'discount_exceeds_margin', 'other_negative'] as const;
const SCENARIO_KEYS = [...OVERRIDE_KEYS, 'assume_unknown_refund'] as const;
const Month = z.string().regex(/^\d{4}-\d{2}$/, 'use YYYY-MM');
const PRODUCT_ORDERS = ['lowest_contribution', 'highest_contribution', 'net_sales'] as const;

export const TOOL_ARGS = {
  leaks: z.object({ cause: z.enum(LEAK_CAUSES).optional(), month: Month.optional() }),
  'pulse.months': z.object({ month: Month.optional() }),
  'pulse.products': z.object({ month: Month.optional(), product: z.string().min(1).optional(), order: z.enum(PRODUCT_ORDERS).optional() }),
  'pulse.channels': z.object({ channel: z.string().min(1).optional() }),
  'scenario.run': z
    .object({
      override: z.enum(SCENARIO_KEYS).optional(),
      value: z.union([z.number(), z.string(), z.boolean()]).optional(),
      policy: z.enum(['full', 'partial']).optional(),
      intervention: z.enum(CANDIDATE_KEYS).optional(),
    })
    .refine((x) => (x.override ? 1 : 0) + (x.intervention ? 1 : 0) === 1, 'set exactly one override or one intervention'),
} as const;

/** Gemini function names cannot contain dots. */
const GEMINI_NAME: Record<ToolName, string> = {
  leaks: 'leaks',
  'pulse.months': 'pulse_months',
  'pulse.products': 'pulse_products',
  'pulse.channels': 'pulse_channels',
  'scenario.run': 'scenario_run',
};
const FROM_GEMINI = Object.fromEntries(Object.entries(GEMINI_NAME).map(([k, v]) => [v, k])) as Record<string, ToolName>;

const str = (description: string, values?: readonly string[]) => ({ type: SchemaType.STRING, description, ...(values ? { enum: [...values] } : {}) });

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'leaks',
    description: 'Leak groups: orders with negative or unknown contribution, grouped by cause, with rupees lost. Use for "why", "where did we lose money", causes.',
    parameters: { type: SchemaType.OBJECT, properties: { cause: str('One leak cause', LEAK_CAUSES), month: str('A month as YYYY-MM') } },
  },
  {
    name: 'pulse_months',
    description: 'Month by month orders, net sales, contribution, return % and discount depth; best and weakest month.',
    parameters: { type: SchemaType.OBJECT, properties: { month: str('A month as YYYY-MM') } },
  },
  {
    name: 'pulse_products',
    description: 'Products ranked by contribution or net sales, optionally within one month; units, orders, return %, discount depth.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: { month: str('A month as YYYY-MM'), product: str('A product id'), order: str('Sort order', PRODUCT_ORDERS) },
    },
  },
  {
    name: 'pulse_channels',
    description: 'Channels with orders, net sales, contribution after ads, ad spend and return %; payment-type split.',
    parameters: { type: SchemaType.OBJECT, properties: { channel: str('A channel name') } },
  },
  {
    name: 'scenario_run',
    description:
      'A what-if: either one assumption override (return_rate_pct, recovery_pct, shipping_inr, refund_policy, ads_per_order, assume_unknown_refund) with its value, or one engine intervention (raise_recovery_via_inspection, charge_return_shipping, cap_discount, add_handling_to_price).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        override: str('The one assumption to change', SCENARIO_KEYS),
        value: { type: SchemaType.NUMBER, description: 'New value for a numeric override' },
        policy: str('Refund policy when override is refund_policy', ['full', 'partial']),
        intervention: str('An engine intervention', CANDIDATE_KEYS),
      },
    },
  },
];

const dropNulls = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ''));

/** A tool call from the model, validated; null when the name or arguments are not acceptable. */
export function parseModelCall(call: { name: string; args: Record<string, unknown> } | null): ToolCall | null {
  if (!call) return null;
  const name: ToolName | null = FROM_GEMINI[call.name] ?? ((TOOL_NAMES as readonly string[]).includes(call.name) ? (call.name as ToolName) : null);
  if (!name) return null;
  const parsed = TOOL_ARGS[name].safeParse(dropNulls(call.args));
  return parsed.success ? { name, args: dropNulls(parsed.data as Record<string, unknown>) } : null;
}

// ---- execution ---------------------------------------------------------------------------------------------------

const productView = (p: ReturnType<typeof pulseProducts>['products'][number]) => ({
  product_id: p.product_id,
  units: p.units,
  orders: p.orders,
  net_sales_inr: p.net_sales_inr,
  contribution_inr: p.contribution_inr,
  contribution_per_unit_inr: p.contribution_per_unit_inr,
  return_pct: p.return_pct,
  discount_depth_pct: p.discount_depth_pct,
  label: p.label,
  lever: p.lever,
});

/** Runs one tool on the analysis. Throws (ZodError / OverrideInvalid) on bad arguments. */
export function runTool(call: ToolCall, ctx: ToolContext): Record<string, unknown> {
  const { a } = ctx;
  switch (call.name) {
    case 'leaks': {
      const args = TOOL_ARGS.leaks.parse(call.args);
      const leaks = a.leaks.map((l) => ({ cause: l.cause, label: l.label, count: l.count, lost_inr: l.lost_inr, example_ids: l.example_ids }));
      const month = args.month ? (pulseLeaks(a).months.find((m) => m.month === args.month) ?? null) : null;
      return { leaks, focus: args.cause ? (leaks.find((l) => l.cause === args.cause) ?? null) : null, month: args.month ?? null, month_row: month };
    }
    case 'pulse.months': {
      const args = TOOL_ARGS['pulse.months'].parse(call.args);
      const months = pulseMonths(a).months;
      const o = pulseOverview(a, args.month);
      return {
        months,
        month: args.month ?? null,
        focus: args.month ? (months.find((m) => m.month === args.month) ?? null) : null,
        best: o.best?.contribution ?? null,
        worst: o.worst?.contribution ?? null,
      };
    }
    case 'pulse.products': {
      const args = TOOL_ARGS['pulse.products'].parse(call.args);
      const scoped = args.month ? { ...a, orders: a.orders.filter((o) => o.date.startsWith(args.month as string)) } : a;
      const rows = pulseProducts(scoped).products;
      const order = args.order ?? 'lowest_contribution';
      const sorted = [...rows].sort((p, q) =>
        order === 'lowest_contribution' ? p.contribution_inr - q.contribution_inr : order === 'highest_contribution' ? q.contribution_inr - p.contribution_inr : q.net_sales_inr - p.net_sales_inr,
      );
      const focus = args.product ? rows.find((r) => r.product_id.toLowerCase() === (args.product as string).toLowerCase()) : undefined;
      return { month: args.month ?? null, order, products: sorted.slice(0, 5).map(productView), focus: focus ? productView(focus) : null, total_products: rows.length };
    }
    case 'pulse.channels': {
      const args = TOOL_ARGS['pulse.channels'].parse(call.args);
      const p = pulseChannels(a);
      const focus = args.channel ? (p.channels.find((c) => c.channel.toLowerCase() === (args.channel as string).toLowerCase()) ?? null) : null;
      return { attribution: p.attribution, channels: p.channels, focus, payments: p.payments };
    }
    case 'scenario.run': {
      const args = TOOL_ARGS['scenario.run'].parse(call.args);
      if (args.intervention) {
        const c = a.candidates.find((x) => x.intervention === args.intervention);
        return {
          kind: 'candidate',
          intervention: args.intervention,
          label: c?.label ?? args.intervention,
          rule: c?.rule ?? null,
          delta_inr: c?.delta_inr ?? null,
          driving_orders: c?.driving_orders ?? 0,
          baseline_contribution_inr: a.totals.contribution_inr,
        };
      }
      const key = args.override as (typeof SCENARIO_KEYS)[number];
      const value = key === 'assume_unknown_refund' ? true : key === 'refund_policy' ? (args.policy ?? args.value) : typeof args.value === 'string' ? Number(args.value) : args.value;
      const overrides = OverridesSchema.parse({ [key]: value }) as ScenarioOverrides;
      const s = scenarioFor(ctx.rows, ctx.opts, overrides);
      return {
        kind: 'override',
        overrides,
        changed: s.changed,
        baseline_contribution_inr: s.baseline.contribution_inr,
        scenario_contribution_inr: s.scenario.contribution_inr,
        delta_contribution_inr: s.delta.contribution_inr,
        assumptions: s.assumptions,
        recommendation: { intervention: s.recommendation.intervention, label: s.recommendation.label, expected_delta_inr: s.recommendation.expected_delta_inr, confidence: s.recommendation.confidence },
      };
    }
  }
}

// ---- keyword router (no AI) ------------------------------------------------------------------------------------

const MONTH_WORDS: string[][] = [
  ['january', 'jan', 'जनवरी', 'జనవరి'],
  ['february', 'feb', 'फ़रवरी', 'फरवरी', 'ఫిబ్రవరి'],
  ['march', 'मार्च', 'మార్చి'],
  ['april', 'apr', 'अप्रैल', 'ఏప్రిల్'],
  ['may', 'मई'],
  ['june', 'jun', 'जून', 'జూన్'],
  ['july', 'jul', 'जुलाई', 'జూలై'],
  ['august', 'aug', 'अगस्त', 'ఆగస్టు', 'ఆగస్ట్'],
  ['september', 'sept', 'sep', 'सितंबर', 'सितम्बर', 'సెప్టెంబర్', 'సెప్టెంబరు'],
  ['october', 'oct', 'अक्टूबर', 'अक्तूबर', 'అక్టోబర్', 'అక్టోబరు'],
  ['november', 'nov', 'नवंबर', 'नवम्बर', 'నవంబర్', 'నవంబరు'],
  ['december', 'dec', 'दिसंबर', 'दिसम्बर', 'డిసెంబర్', 'డిసెంబరు'],
];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-word match for Latin words; plain substring for Devanagari and Telugu (JS \b is ASCII-only). */
const hasWord = (q: string, w: string) => (/^[a-z0-9 _-]+$/i.test(w) ? new RegExp(`(^|[^a-z0-9])${escape(w.toLowerCase())}([^a-z0-9]|$)`).test(q) : q.includes(w));

export function parseMonth(q: string, available: string[]): string | null {
  const iso = q.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  if (iso) return iso[0];
  const idx = MONTH_WORDS.findIndex((words) => words.some((w) => hasWord(q, w)));
  if (idx < 0) return null;
  const mm = String(idx + 1).padStart(2, '0');
  const hit = [...available].reverse().find((m) => m.endsWith(`-${mm}`));
  if (hit) return hit;
  const year = available[available.length - 1]?.slice(0, 4) ?? String(new Date().getFullYear());
  return `${year}-${mm}`;
}

const WHAT_IF = /what if|what happens|suppose|if we|simulate|scenario|क्या होगा|अगर|ఒకవేళ|అయితే/;
const LEAK_WORDS = /leak|why|lost|losing|loss|negative|bleed|लीक|नुकसान|क्यों|घाटा|లీక్|నష్టం|ఎందుకు/;
const PRODUCT_WORDS = /product|sku|item|उत्पाद|प्रोडक्ट|ఉత్పత్తి|ప్రోడక్ట్/;
const CHANNEL_WORDS = /channel|चैनल|ఛానల్|ఛానెల్/;
const MONTH_TREND = /month|trend|महीन|माह|నెల/;
const BEST_WORDS = /best|highest|top|earn(s|ed)? most|सबसे अच्छा|सबसे ज़्यादा योगदान|ఉత్తమ|అత్యధిక/;
const CANDIDATE_PHRASES: Array<[RegExp, (typeof CANDIDATE_KEYS)[number]]> = [
  [/return shipping|charge.*return|रिटर्न शिपिंग|రిటర్న్ షిప్పింగ్/, 'charge_return_shipping'],
  [/cap.*discount|discount cap|छूट.*सीमा|डिस्काउंट.*कैप|డిస్కౌంట్.*పరిమితి/, 'cap_discount'],
  [/inspect|जाँच|जांच|తనిఖీ/, 'raise_recovery_via_inspection'],
  [/handling|हैंडलिंग|హ్యాండ్లింగ్/, 'add_handling_to_price'],
];
const CAUSE_WORDS: Array<[RegExp, LeakCause]> = [
  [/unknown|missing|अज्ञात|गायब|తెలియ/, 'refund_unknown'],
  [/discount|छूट|डिस्काउंट|డిస్కౌంట్/, 'discount_exceeds_margin'],
  [/fee|shipping|शुल्क|शिपिंग|ఫీజు|షిప్పింగ్/, 'fees_exceed_margin'],
  [/return|recover|रिटर्न|रिकवरी|రిటర్న్|రికవరీ/, 'full_return_partial_recovery'],
];

function scenarioCall(q: string, a: AnalysisResult): ToolCall {
  const n = q.replace(/(\d),(?=\d)/g, '$1').match(/(\d+(?:\.\d+)?)/);
  const value = n ? Number(n[1]) : undefined;
  for (const [re, key] of CANDIDATE_PHRASES) if (re.test(q)) return { name: 'scenario.run', args: { intervention: key } };
  if (/partial refund|आंशिक रिफ़ंड|పాక్షిక రీఫండ్/.test(q)) return { name: 'scenario.run', args: { override: 'refund_policy', policy: 'partial' } };
  if (/full refund|पूरा रिफ़ंड|పూర్తి రీఫండ్/.test(q)) return { name: 'scenario.run', args: { override: 'refund_policy', policy: 'full' } };
  if (value !== undefined) {
    if (/return rate|रिटर्न दर|రిటర్న్ రేటు/.test(q)) return { name: 'scenario.run', args: { override: 'return_rate_pct', value } };
    if (/recover|रिकवरी|రికవరీ/.test(q)) return { name: 'scenario.run', args: { override: 'recovery_pct', value } };
    if (/shipping|शिपिंग|షిప్పింగ్/.test(q)) return { name: 'scenario.run', args: { override: 'shipping_inr', value } };
    if (/\bads?\b|advert|विज्ञापन|ప్రకటన/.test(q)) return { name: 'scenario.run', args: { override: 'ads_per_order', value } };
  }
  if (/assume|unknown|missing|अज्ञात|गायब|తెలియ/.test(q)) return { name: 'scenario.run', args: { override: 'assume_unknown_refund' } };
  const best = a.recommendation.intervention !== 'none' ? a.recommendation.intervention : [...a.candidates].sort((x, y) => y.delta_inr - x.delta_inr)[0]?.intervention;
  return { name: 'scenario.run', args: { intervention: best ?? 'raise_recovery_via_inspection' } };
}

/** Deterministic tool choice from keywords (English, Hindi, Telugu). */
export function routeQuestion(question: string, a: AnalysisResult): ToolCall {
  const q = question.toLowerCase();
  const months = pulseMonths(a).months.map((m) => m.month);
  const month = parseMonth(q, months);
  const channel = a.groups.channel.map((g) => g.key).find((k) => k && hasWord(q, k.toLowerCase()));
  const product = a.groups.product.map((g) => g.key).find((k) => k && hasWord(q, k.toLowerCase()));
  const withMonth = month ? { month } : {};

  if (WHAT_IF.test(q) || CANDIDATE_PHRASES.some(([re]) => re.test(q))) return scenarioCall(q, a);
  if (channel || CHANNEL_WORDS.test(q)) return { name: 'pulse.channels', args: channel ? { channel } : {} };
  if (product || PRODUCT_WORDS.test(q)) {
    return { name: 'pulse.products', args: { ...withMonth, ...(product ? { product } : {}), order: BEST_WORDS.test(q) ? 'highest_contribution' : 'lowest_contribution' } };
  }
  if (LEAK_WORDS.test(q)) {
    const cause = CAUSE_WORDS.find(([re, c]) => re.test(q) && a.leaks.some((l) => l.cause === c))?.[1];
    return { name: 'leaks', args: { ...(cause ? { cause } : {}), ...withMonth } };
  }
  if (month || MONTH_TREND.test(q)) return { name: 'pulse.months', args: withMonth };
  return { name: 'leaks', args: {} };
}

// ---- template answers and links ----------------------------------------------------------------------------------

const signed = (n: number | null) => (n === null ? null : n > 0 ? `+${formatInr(n)}` : formatInr(n));

type Rec = Record<string, any>;

/** The deterministic answer for a tool result, in the language. Every figure comes from `result`. */
export function templateAnswer(call: ToolCall, result: Rec, lang: Lang): string {
  const p = PHRASES[lang];
  const money = (n: number | null | undefined) => inr(lang, n);
  switch (call.name) {
    case 'leaks': {
      const leaks = result.leaks as Rec[];
      const label = (l: Rec) => p.leakLabel(l.cause as LeakCause);
      let text: string;
      if (result.focus) text = p.leakCause(label(result.focus), p.orders(result.focus.count), money(result.focus.lost_inr), (result.focus.example_ids as string[]).join(', '));
      else if (!leaks.length) text = p.leaksNone;
      else text = p.leaksTop(label(leaks[0]), p.orders(leaks[0].count), money(leaks[0].lost_inr)) + (leaks[1] ? p.leaksNext(label(leaks[1]), money(leaks[1].lost_inr)) : '');
      if (result.month_row) text += p.leaksMonth(result.month_row.month, money(result.month_row.total_lost_inr));
      return text;
    }
    case 'pulse.months': {
      const row = (result.focus ?? null) as Rec | null;
      const one = (m: Rec) => p.monthOne(m.month, p.orders(m.orders), money(m.net_sales_inr), money(m.contribution_inr), m.contribution_pct);
      if (row) return one(row);
      if (result.best && result.worst) return p.monthBestWorst(result.best.month, money(result.best.value_inr), result.worst.month, money(result.worst.value_inr));
      const months = result.months as Rec[];
      return months.length ? one(months[months.length - 1]) : p.noData;
    }
    case 'pulse.products': {
      const f = result.focus as Rec | null;
      if (f) return p.productOne(f.product_id, p.orders(f.orders), money(f.net_sales_inr), money(f.contribution_inr));
      const top = (result.products as Rec[])[0];
      if (!top) return p.noData;
      const args = [result.month as string | null, top.product_id as string, money(top.contribution_inr), p.orders(top.orders)] as const;
      if (result.order === 'lowest_contribution') return top.contribution_inr < 0 ? p.productWorst(...args) : p.productLeast(...args);
      if (result.order === 'highest_contribution') return p.productBest(...args);
      return p.productOne(top.product_id, p.orders(top.orders), money(top.net_sales_inr), money(top.contribution_inr));
    }
    case 'pulse.channels': {
      const f = result.focus as Rec | null;
      if (f) return p.channelOne(f.channel, p.orders(f.orders), money(f.net_sales_inr), money(f.contribution_inr), money(f.ads_inr), f.ads_share_pct);
      const worst = [...(result.channels as Rec[])].filter((c) => c.contribution_inr !== null).sort((x, y) => x.contribution_inr - y.contribution_inr)[0];
      return worst ? p.channelWorst(worst.channel, money(worst.contribution_inr), p.orders(worst.orders)) : p.noData;
    }
    case 'scenario.run': {
      if (result.kind === 'candidate') {
        const label = interventionLabels(lang).find((l) => l.intervention === result.intervention)?.label ?? result.label;
        return p.scenarioCandidate(label, signed(result.delta_inr) ?? p.unknown, p.orders(result.driving_orders));
      }
      const [key, value] = Object.entries(result.overrides as Rec)[0] ?? ['assume_unknown_refund', true];
      return p.scenarioOverride(p.override(key as (typeof SCENARIO_KEYS)[number], value), money(result.baseline_contribution_inr), money(result.scenario_contribution_inr), signed(result.delta_contribution_inr) ?? p.unknown);
    }
  }
}

/** Where the answer's numbers live in the app (click-to-cause). */
export function linkFor(call: ToolCall, result: Rec): AskLink {
  const month = typeof call.args.month === 'string' ? call.args.month : undefined;
  const withMonth = month ? { month } : {};
  switch (call.name) {
    case 'leaks': {
      const cause = (result.focus?.cause ?? (result.leaks as Rec[])[0]?.cause) as string | undefined;
      return cause ? { route: 'ledger', params: { cause, ...withMonth } } : { route: 'leaks', params: {} };
    }
    case 'pulse.months':
      return { route: 'pulse', params: withMonth };
    case 'pulse.products': {
      const product = (result.focus?.product_id ?? (result.products as Rec[])[0]?.product_id) as string | undefined;
      return product ? { route: 'ledger', params: { product, ...withMonth } } : { route: 'pulse', params: withMonth };
    }
    case 'pulse.channels': {
      const worst = [...(result.channels as Rec[])].filter((c) => c.contribution_inr !== null).sort((x, y) => x.contribution_inr - y.contribution_inr)[0];
      const channel = (result.focus?.channel ?? worst?.channel) as string | undefined;
      return channel ? { route: 'ledger', params: { channel } } : { route: 'pulse', params: {} };
    }
    case 'scenario.run':
      return { route: 'scenario', params: {} };
  }
}
