import { netMarginPct, type Margins } from '../engine/margins.js';
import { DISCOUNT_CAP_PCT, RECOVERY_TARGET_PCT } from '../engine/scenario.js';
import { ATTRIBUTION_LABEL, type AnalysisResult, type Totals } from '../engine/types.js';
import type { DecisionRecord } from '../repo.js';
import { OVERRIDE_KEYS, type ScenarioOverrides } from '../schema/orders.js';
import { formatInr } from '../engine/format.js';

// The decision file (GET /decisions/:id/export?format=json): starting state, the one scenario override, the expected
// impact, a 30-day check-in and every assumed input, so the decision can be re-checked a month later.

export const DECISION_FORMAT = 'profyn-decision/1';
const DAY_MS = 86_400_000;

export interface StartingState {
  totals: Totals;
  mode: AnalysisResult['attribution'];
  period_end: string;
  engine_version: string;
  dataset_source: string;
  margins: Margins | null;
  fixed_costs_inr: number | null;
  /** (contribution − fixed costs) ÷ net revenue; only when fixed costs were entered. Not statutory net profit. */
  net_margin_pct_estimated: number | null;
}

export interface CheckIn {
  metric: string;
  metric_label: string;
  unit: 'pct' | 'inr';
  /** at_least: the metric should reach the target; at_most: it should fall to the target. */
  direction: 'at_least' | 'at_most';
  /** The metric today, from the observed data (not the scenario). */
  baseline_value: number | null;
  baseline_source: 'observed';
  target_value: number | null;
  /** Saved date + 30 days (YYYY-MM-DD). */
  date: string;
  /**
   * Contribution the decision expects: the contribution of the state the impact was computed on (the scenario's when a
   * scenario was used, else the observed one) + expected impact. null when that contribution is unknown.
   */
  contribution_target_inr: number | null;
  contribution_target_basis: 'observed' | 'scenario';
}

export interface AssumedInput {
  key: string;
  value: unknown;
  source: 'scenario_override' | 'scenario_toggle' | 'config_default' | 'user_input';
  label: string;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const round1 = (x: number) => Math.round(x * 10) / 10;

export function startingStateFor(a: AnalysisResult, datasetSource: string, margins: Margins | null, fixedCosts?: number): StartingState {
  return {
    totals: a.totals,
    mode: a.attribution,
    period_end: a.period_end,
    engine_version: a.engine_version,
    dataset_source: datasetSource,
    margins,
    fixed_costs_inr: fixedCosts ?? null,
    net_margin_pct_estimated: margins && fixedCosts !== undefined ? netMarginPct(margins, fixedCosts) : null,
  };
}

/**
 * The 30-day check-in for a chosen intervention: the operational metric that rule moves, measured against today's
 * observed value. `scenarioContribution` is the scenario's contribution when the decision was made on a scenario.
 */
export function checkInFor(intervention: string, a: AnalysisResult, expectedDelta: number | null, savedAt: Date, scenarioContribution?: number | null): CheckIn {
  const date = isoDate(new Date(savedAt.getTime() + 30 * DAY_MS));
  const basis: CheckIn['contribution_target_basis'] = scenarioContribution === undefined ? 'observed' : 'scenario';
  const start = scenarioContribution === undefined ? a.totals.contribution_inr : scenarioContribution;
  const contributionTarget = start === null ? null : start + (expectedDelta ?? 0);
  const ok = a.orders.filter((o) => o.status === 'ok');
  const base = { date, baseline_source: 'observed' as const, contribution_target_inr: contributionTarget, contribution_target_basis: basis };
  switch (intervention) {
    case 'raise_recovery_via_inspection':
      return { metric: 'recovery_pct', metric_label: 'Average recovered stock value on returns, % of product cost', unit: 'pct', direction: 'at_least', baseline_value: a.observed.recovery_pct, target_value: RECOVERY_TARGET_PCT, ...base };
    case 'charge_return_shipping':
      return { metric: 'return_cost_paid_per_return_inr', metric_label: 'Return shipping paid by the brand per returned order', unit: 'inr', direction: 'at_most', baseline_value: a.observed.avg_return_cost_inr, target_value: 0, ...base };
    case 'cap_discount': {
      const depths = a.orders.filter((o) => o.inputs.gross > 0).map((o) => (o.inputs.discount / o.inputs.gross) * 100);
      return { metric: 'max_discount_pct_of_gross', metric_label: 'Largest discount on an order, % of gross', unit: 'pct', direction: 'at_most', baseline_value: depths.length ? round1(Math.max(...depths)) : null, target_value: DISCOUNT_CAP_PCT, ...base };
    }
    case 'add_handling_to_price': {
      const handling = ok.map((o) => -(o.lines.find((l) => l.key === 'handling')?.amount_inr ?? 0));
      const avg = handling.length ? Math.round((handling.reduce((s, x) => s + x, 0) / handling.length) * 100) / 100 : null;
      return { metric: 'handling_not_in_price_per_order_inr', metric_label: 'Handling cost per order not recovered in the price', unit: 'inr', direction: 'at_most', baseline_value: avg, target_value: 0, ...base };
    }
    default:
      return { metric: 'contribution_inr', metric_label: 'Operational contribution for the period', unit: 'inr', direction: 'at_least', baseline_value: a.totals.contribution_inr, target_value: contributionTarget, ...base };
  }
}

const OVERRIDE_LABEL: Record<(typeof OVERRIDE_KEYS)[number], (v: unknown) => string> = {
  return_rate_pct: (v) => `Return rate set to ${v}% (scenario)`,
  recovery_pct: (v) => `Recovered stock set to ${v}% of product cost on returned orders (scenario)`,
  shipping_inr: (v) => `Shipping set to ${formatInr(v as number)} per order (scenario)`,
  refund_policy: (v) => `Refund policy set to ${v} (scenario)`,
  ads_per_order: (v) => `Ads set to ${formatInr(v as number)} per order (scenario)`,
};

/** Every assumed (not observed) input behind the decision. */
export function assumedInputsFor(a: AnalysisResult, overrides: ScenarioOverrides | null, fixedCosts?: number): AssumedInput[] {
  const out: AssumedInput[] = [];
  if (overrides) {
    for (const k of OVERRIDE_KEYS) {
      if (overrides[k] !== undefined) out.push({ key: k, value: overrides[k], source: 'scenario_override', label: OVERRIDE_LABEL[k](overrides[k]) });
    }
    if (overrides.assume_unknown_refund) {
      out.push({
        key: 'assume_unknown_refund',
        value: true,
        source: 'scenario_toggle',
        label: 'Returned orders with missing facts treated as refund = gross − discount, recovered = 0, return cost = observed average (scenario)',
      });
    }
  }
  const estimated = a.orders.filter((o) => o.lines.some((l) => l.key === 'handling' && l.source === 'config_default')).length;
  if (estimated > 0) {
    out.push({
      key: 'handling_default_inr',
      value: a.config.handling_default_inr,
      source: 'config_default',
      label: `Handling ${formatInr(a.config.handling_default_inr)} per order on ${estimated} order${estimated === 1 ? '' : 's'} whose row has none (estimate)`,
    });
  }
  if (fixedCosts !== undefined) {
    out.push({ key: 'fixed_costs_inr', value: fixedCosts, source: 'user_input', label: 'Fixed costs per period (salaries, rent, tools), entered by the owner; used only for the estimated net margin' });
  }
  return out;
}

/** The JSON decision file. Records saved before the export existed fall back to their snapshot and evidence. */
export function decisionExport(d: DecisionRecord) {
  const snap = d.assumptions as Record<string, any>;
  const ev = d.evidence as Record<string, any>;
  const savedAt = new Date(d.saved_at);
  const overrides = (snap.overrides ?? {}) as ScenarioOverrides;
  const hasScenario = Boolean(d.scenario_id ?? snap.scenario_id);
  const changed = OVERRIDE_KEYS.find((k) => overrides[k] !== undefined);
  const evScenario = ev.scenario as { changed: string; baseline_inr: number | null; scenario_inr: number | null; delta_inr: number | null } | null;
  return {
    format: DECISION_FORMAT,
    decision_id: d._id,
    analysis_id: d.analysis_id,
    owner: d.owner,
    date: isoDate(savedAt),
    saved_at: savedAt.toISOString(),
    intervention: d.intervention,
    intervention_label: d.intervention_label,
    confidence: d.confidence,
    expected_impact_inr: d.expected_delta_inr,
    starting_state: d.starting_state ?? {
      totals: ev.totals,
      mode: snap.attribution,
      period_end: snap.period_end,
      engine_version: d.engine_version,
      dataset_source: ev.dataset_source,
      margins: null,
      fixed_costs_inr: d.fixed_costs_inr ?? null,
      net_margin_pct_estimated: null,
    },
    scenario: hasScenario
      ? {
          scenario_id: d.scenario_id ?? snap.scenario_id,
          changed: snap.changed ?? changed ?? null,
          override: changed ? { [changed]: overrides[changed] } : null,
          assume_unknown_refund: overrides.assume_unknown_refund === true,
          baseline_contribution_inr: evScenario?.baseline_inr ?? null,
          scenario_contribution_inr: evScenario?.scenario_inr ?? null,
          delta_inr: evScenario?.delta_inr ?? null,
          notes: (snap.scenario_notes as string[] | undefined) ?? [],
        }
      : null,
    check_in_30_days: d.check_in_30_days ?? {
      metric: 'contribution_inr',
      metric_label: 'Operational contribution for the period',
      unit: 'inr',
      direction: 'at_least',
      baseline_value: ev.totals?.contribution_inr ?? null,
      baseline_source: 'observed',
      target_value: null,
      date: isoDate(new Date(savedAt.getTime() + 30 * DAY_MS)),
      contribution_target_inr: null,
      contribution_target_basis: hasScenario ? 'scenario' : 'observed',
    },
    assumptions: d.assumed_inputs ?? [],
    test_30d: d.test_30d,
    stop_rule: d.stop_rule,
    ...(d.notes ? { notes: d.notes } : {}),
    labels: ['Operational contribution, not statutory net profit.', ATTRIBUTION_LABEL],
    snapshot: d.assumptions,
    evidence: d.evidence,
  };
}
