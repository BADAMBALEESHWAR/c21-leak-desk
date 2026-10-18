import { OVERRIDE_KEYS, type ScenarioOverrides } from '../schema/orders.js';
import { handlingFor } from './contribution.js';
import type { Describe } from './leaks.js';
import { computeLedger, type Ledger, type LedgerOptions } from './ledger.js';
import {
  ENGINE_VERSION,
  OverrideInvalid,
  type Candidate,
  type Confidence,
  type InterventionKey,
  type OrderDelta,
  type OrderRow,
  type Recommendation,
  type ScenarioColumn,
  type ScenarioResult,
} from './types.js';
import { formatInr } from './format.js';
import { isLateRefund } from './validate.js';

export const RECOVERY_TARGET_PCT = 90;
export const DISCOUNT_CAP_PCT = 15;
export const PARTIAL_REFUND_SHARE = 0.8;
const LOW_CONFIDENCE_BELOW = 5;

export const INTERVENTIONS: Record<InterventionKey, { label: string; rule: string }> = {
  raise_recovery_via_inspection: { label: 'Raise recovery via inspection', rule: `Inspect returns before restocking so recovered stock reaches ${RECOVERY_TARGET_PCT}% of product cost.` },
  charge_return_shipping: { label: 'Charge return shipping', rule: 'Charge the customer the return shipping cost on returned orders.' },
  cap_discount: { label: 'Cap discount', rule: `Cap discounts at ${DISCOUNT_CAP_PCT}% of gross.` },
  add_handling_to_price: { label: 'Add handling to price', rule: 'Add the per-order handling cost to the product price.' },
  none: { label: 'No change', rule: 'No rule in the set improves contribution under these assumptions.' },
};
const CANDIDATE_KEYS = ['raise_recovery_via_inspection', 'charge_return_shipping', 'cap_discount', 'add_handling_to_price'] as const;

const copy = (rows: OrderRow[]) => rows.map((r) => ({ ...r }));
const isFullRefund = (r: OrderRow) => r.returned && r.refund_inr !== null && r.refund_inr === r.gross_inr - r.discount_inr;

/** Exactly one override, optionally combined with assume_unknown_refund (Blueprint §10). */
export function checkOverrides(o: ScenarioOverrides): string {
  const set = OVERRIDE_KEYS.filter((k) => o[k] !== undefined);
  if (set.length > 1) throw new OverrideInvalid(`A controlled scenario changes one assumption; ${set.join(' and ')} were both set.`);
  if (set.length === 0 && !o.assume_unknown_refund) throw new OverrideInvalid('Set one override: return_rate_pct, recovery_pct, shipping_inr, refund_policy or ads_per_order.');
  return set[0] ?? 'assume_unknown_refund';
}

/** R12 on a deep copy. Returns the new rows and plain-language assumption notes. */
export function applyOverrides(rows: OrderRow[], o: ScenarioOverrides, base: Ledger): { rows: OrderRow[]; notes: string[] } {
  const out = copy(rows);
  const notes: string[] = [];
  const periodEnd = base.period_end;
  const obs = base.observed;
  const avgReturnCost = Math.round(obs.avg_return_cost_inr ?? 0);
  const recoveryShare = (obs.recovery_pct ?? 0) / 100;

  if (o.assume_unknown_refund) {
    let n = 0;
    for (const r of out) {
      if (!r.returned || (r.refund_inr !== null && r.recovered_product_cost_inr !== null && r.return_cost_inr !== null)) continue;
      if (r.refund_inr === null) r.refund_inr = r.gross_inr - r.discount_inr;
      if (r.recovered_product_cost_inr === null) r.recovered_product_cost_inr = 0;
      if (r.return_cost_inr === null) r.return_cost_inr = avgReturnCost;
      r.net_sales_inr = null;
      n++;
    }
    if (n) notes.push(`Assumption: ${n} returned order${n === 1 ? '' : 's'} with missing facts treated as refund = gross − discount, recovered = 0, return cost = observed average ${formatInr(avgReturnCost)}.`);
  }
  if (o.recovery_pct !== undefined) {
    for (const r of out) if (r.returned && r.product_cost_inr !== null) r.recovered_product_cost_inr = Math.round((r.product_cost_inr * o.recovery_pct) / 100);
    notes.push(`Recovered stock set to ${o.recovery_pct}% of product cost on every returned order.`);
  }
  if (o.shipping_inr !== undefined) {
    for (const r of out) r.shipping_inr = o.shipping_inr;
    notes.push(`Shipping set to ${formatInr(o.shipping_inr)} on every order.`);
  }
  if (o.refund_policy !== undefined) {
    for (const r of out) {
      if (!r.returned) continue;
      const paid = r.gross_inr - r.discount_inr;
      r.refund_inr = o.refund_policy === 'full' ? paid : Math.round(paid * PARTIAL_REFUND_SHARE);
      r.net_sales_inr = null;
    }
    notes.push(o.refund_policy === 'full' ? 'Returned orders refunded in full (gross − discount).' : `Returned orders refunded ${PARTIAL_REFUND_SHARE * 100}% of gross − discount.`);
  }
  if (o.ads_per_order !== undefined) {
    for (const r of out) r.ads_inr = o.ads_per_order;
    notes.push(`Ads set to ${formatInr(o.ads_per_order)} per order${base.attribution === 'channel' ? ' (channel spend = orders × value)' : ''}.`);
  }
  if (o.return_rate_pct !== undefined) {
    const n = out.length;
    const target = Math.round((n * o.return_rate_pct) / 100);
    const returned = out.filter((r) => r.returned && !isLateRefund(r, periodEnd));
    if (target > returned.length) {
      const contributionOf = new Map(base.orders.map((x) => [x.order_id, x.contribution_inr]));
      const kept = out
        .filter((r) => !r.returned && contributionOf.get(r.order_id) !== null && contributionOf.get(r.order_id) !== undefined)
        .sort((a, b) => (contributionOf.get(a.order_id) as number) - (contributionOf.get(b.order_id) as number) || a.order_id.localeCompare(b.order_id));
      const flip = kept.slice(0, target - returned.length);
      for (const r of flip) {
        r.returned = true;
        r.refund_inr = r.gross_inr - r.discount_inr;
        r.recovered_product_cost_inr = Math.round(r.product_cost_inr === null ? 0 : r.product_cost_inr * recoveryShare);
        r.return_cost_inr = avgReturnCost;
        r.net_sales_inr = null;
        r.refund_date = undefined;
      }
      notes.push(`Return rate ${o.return_rate_pct}%: ${flip.length} lowest-contribution kept order${flip.length === 1 ? '' : 's'} (${flip.map((r) => r.order_id).join(', ')}) returned at ${obs.recovery_pct ?? 0}% recovery and ${formatInr(avgReturnCost)} return cost.`);
    } else if (target < returned.length) {
      const back = [...returned].sort((a, b) => a.order_id.localeCompare(b.order_id)).slice(0, returned.length - target);
      for (const r of back) {
        r.returned = false;
        r.refund_inr = 0;
        r.recovered_product_cost_inr = 0;
        r.return_cost_inr = 0;
        r.net_sales_inr = null;
      }
      notes.push(`Return rate ${o.return_rate_pct}%: ${back.length} returned order${back.length === 1 ? '' : 's'} (${back.map((r) => r.order_id).join(', ')}) treated as kept.`);
    } else notes.push(`Return rate ${o.return_rate_pct}% equals the observed rate; no orders change.`);
  }
  return { rows: out, notes };
}

/** One candidate intervention applied to a copy of the rows (R13). */
export function applyCandidate(key: (typeof CANDIDATE_KEYS)[number], rows: OrderRow[], handlingDefault: number, periodEnd: string): OrderRow[] {
  const out = copy(rows);
  for (const r of out) {
    switch (key) {
      case 'raise_recovery_via_inspection':
        if (r.returned && !isLateRefund(r, periodEnd) && r.product_cost_inr !== null && r.recovered_product_cost_inr !== null) {
          r.recovered_product_cost_inr = Math.max(r.recovered_product_cost_inr, Math.round((r.product_cost_inr * RECOVERY_TARGET_PCT) / 100));
        }
        break;
      case 'charge_return_shipping':
        if (r.returned && !isLateRefund(r, periodEnd) && r.return_cost_inr !== null) r.return_cost_inr = 0;
        break;
      case 'cap_discount': {
        const cap = Math.round((r.gross_inr * DISCOUNT_CAP_PCT) / 100);
        if (r.discount_inr > cap) {
          const full = isFullRefund(r);
          r.discount_inr = cap;
          if (full) r.refund_inr = r.gross_inr - cap;
          r.net_sales_inr = null;
        }
        break;
      }
      case 'add_handling_to_price': {
        const h = handlingFor(r, handlingDefault).value;
        if (h !== null && h > 0) {
          const full = isFullRefund(r);
          r.gross_inr += h;
          if (full) r.refund_inr = r.gross_inr - r.discount_inr;
          r.net_sales_inr = null;
        }
        break;
      }
    }
  }
  return out;
}

export interface Narrator {
  why(rec: Omit<Recommendation, 'why' | 'why_source' | 'test_30d_draft' | 'stop_rule_draft' | 'draft_source'> & { driving_orders: number }, ledger: Ledger): string;
  test30d(intervention: InterventionKey, ledger: Ledger): { test: string; stop: string };
}

const total = (l: Ledger) => l.totals.contribution_inr ?? 0;

/** R13: candidates evaluated as single-change scenarios on the given state; largest positive delta wins. */
export function recommend(
  state: Ledger,
  opts: LedgerOptions,
  describe: Describe,
  narrator: Narrator,
  assumed = false,
): { recommendation: Recommendation; candidates: Candidate[] } {
  const ledgerOpts = { ...opts, period_end: state.period_end };
  const before = new Map(state.orders.map((o) => [o.order_id, o.contribution_inr]));
  const candidates: Candidate[] = CANDIDATE_KEYS.map((key) => {
    const after = computeLedger(applyCandidate(key, state.rows, state.config.handling_default_inr, state.period_end), ledgerOpts, describe);
    const driving = after.orders.filter((o) => o.contribution_inr !== before.get(o.order_id)).length;
    return { intervention: key, label: INTERVENTIONS[key].label, rule: INTERVENTIONS[key].rule, delta_inr: total(after) - total(state), driving_orders: driving };
  });
  let best: Candidate | null = null;
  for (const c of candidates) if (c.delta_inr > 0 && (!best || c.delta_inr > best.delta_inr)) best = c;

  let confidence: Confidence;
  let reason: string;
  const unknown = state.totals.unknown_count;
  if (unknown > 0) {
    confidence = 'unknown';
    reason = `${unknown} order${unknown === 1 ? ' has' : 's have'} missing facts, so this is a labelled scenario, not a measured result.`;
  } else if (assumed) {
    confidence = 'low';
    reason = 'Missing refund facts were filled by a stated assumption; confidence stays low until the facts are supplied.';
  } else if (!best || best.driving_orders < LOW_CONFIDENCE_BELOW) {
    confidence = 'low';
    reason = `Fewer than ${LOW_CONFIDENCE_BELOW} orders drive this estimate (${best?.driving_orders ?? 0}).`;
  } else {
    confidence = 'high';
    reason = `${best.driving_orders} orders with complete facts drive this estimate.`;
  }

  const key: InterventionKey = best?.intervention ?? 'none';
  const base = {
    intervention: key,
    label: INTERVENTIONS[key].label,
    rule: INTERVENTIONS[key].rule,
    expected_delta_inr: best?.delta_inr ?? 0,
    confidence,
    confidence_reason: reason,
    preselect: confidence === 'high' && key !== 'none',
  };
  const drafts = narrator.test30d(key, state);
  return {
    recommendation: { ...base, why: narrator.why({ ...base, driving_orders: best?.driving_orders ?? 0 }, state), why_source: 'template', test_30d_draft: drafts.test, stop_rule_draft: drafts.stop, draft_source: 'template' },
    candidates,
  };
}

function column(l: Ledger): ScenarioColumn {
  const ok = l.orders.filter((o) => o.status === 'ok');
  const line = (k: string) => ok.reduce((s, o) => s - (o.lines.find((x) => x.key === k)?.amount_inr ?? 0), 0);
  return {
    orders: l.orders.length,
    computed: ok.length,
    unknown: l.totals.unknown_count,
    returns: l.orders.filter((o) => o.returned && !o.late_refund).length,
    net_sales_inr: l.totals.net_sales_inr,
    net_product_cost_inr: line('net_product_cost'),
    shipping_inr: line('shipping'),
    payment_fee_inr: line('payment_fee'),
    return_cost_inr: line('return_cost'),
    handling_inr: line('handling'),
    ads_inr: line('ads') + (l.totals.channel_spend_inr ?? 0),
    contribution_inr: l.totals.contribution_inr,
    by_channel: l.groups.channel.map((g) => ({ key: g.key, contribution_inr: g.contribution_inr })),
  };
}

export function runScenario(rows: OrderRow[], opts: LedgerOptions, overrides: ScenarioOverrides, describe: Describe, narrator: Narrator): ScenarioResult {
  const changed = checkOverrides(overrides);
  const baseLedger = computeLedger(rows, opts, describe);
  const applied = applyOverrides(baseLedger.rows, overrides, baseLedger);
  const scenLedger = computeLedger(applied.rows, { ...opts, period_end: baseLedger.period_end }, describe);
  const baseRec = recommend(baseLedger, opts, describe, narrator);
  const scen = recommend(scenLedger, opts, describe, narrator, overrides.assume_unknown_refund === true);

  const b = column(baseLedger);
  const s = column(scenLedger);
  const sub = (x: number, y: number) => x - y;
  const scenById = new Map(scenLedger.orders.map((o) => [o.order_id, o.contribution_inr]));
  const byOrder: OrderDelta[] = baseLedger.orders
    .map((o) => {
      const after = scenById.get(o.order_id) ?? null;
      const d = o.contribution_inr === null || after === null ? null : after - o.contribution_inr;
      return { order_id: o.order_id, baseline_inr: o.contribution_inr, scenario_inr: after, delta_inr: d };
    })
    .filter((x) => x.delta_inr !== 0)
    .sort((x, y) => Math.abs(y.delta_inr ?? Infinity) - Math.abs(x.delta_inr ?? Infinity) || x.order_id.localeCompare(y.order_id))
    .slice(0, 10);

  return {
    engine_version: ENGINE_VERSION,
    overrides,
    changed,
    baseline: b,
    scenario: s,
    delta: {
      orders: sub(s.orders, b.orders),
      computed: sub(s.computed, b.computed),
      unknown: sub(s.unknown, b.unknown),
      returns: sub(s.returns, b.returns),
      net_sales_inr: sub(s.net_sales_inr, b.net_sales_inr),
      net_product_cost_inr: sub(s.net_product_cost_inr, b.net_product_cost_inr),
      shipping_inr: sub(s.shipping_inr, b.shipping_inr),
      payment_fee_inr: sub(s.payment_fee_inr, b.payment_fee_inr),
      return_cost_inr: sub(s.return_cost_inr, b.return_cost_inr),
      handling_inr: sub(s.handling_inr, b.handling_inr),
      ads_inr: sub(s.ads_inr, b.ads_inr),
      contribution_inr: s.contribution_inr === null || b.contribution_inr === null ? null : s.contribution_inr - b.contribution_inr,
      by_order: byOrder,
    },
    recommendation: scen.recommendation,
    baseline_recommendation: {
      intervention: baseRec.recommendation.intervention,
      label: baseRec.recommendation.label,
      expected_delta_inr: baseRec.recommendation.expected_delta_inr,
      confidence: baseRec.recommendation.confidence,
    },
    candidates: scen.candidates,
    assumptions: [...applied.notes, ...(scenLedger.totals.unknown_count ? [`${scenLedger.totals.unknown_count} order(s) still unknown and excluded from totals (partial).`] : [])],
  };
}
