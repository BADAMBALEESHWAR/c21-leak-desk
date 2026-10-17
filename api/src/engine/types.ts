import type { OrderRow, ScenarioOverrides } from '../schema/orders.js';

/** Bump on any rule change, with an ADR and an updated data/expected.json. */
export const ENGINE_VERSION = '1.0.0';

export type Inr = number | null;
export type AttributionMode = 'allocate' | 'channel';
export type OrderStatus = 'ok' | 'unknown';

export const ATTRIBUTION_RULE =
  'Ad allocations and channel spend are never both deducted. Use "allocate" to deduct ads on each order, or "channel" to deduct channel spend once at the channel line.';
export const ATTRIBUTION_LABEL = 'Attribution is allocation, not causation.';

export class AttributionConflict extends Error {
  readonly rule = ATTRIBUTION_RULE;
  constructor(detail: string) {
    super(`${detail} ${ATTRIBUTION_RULE}`);
    this.name = 'AttributionConflict';
  }
}

export class OverrideInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverrideInvalid';
  }
}

export type LineKey =
  | 'gross'
  | 'revenue'
  | 'discount'
  | 'refund'
  | 'net_product_cost'
  | 'shipping'
  | 'payment_fee'
  | 'return_cost'
  | 'handling'
  | 'ads';

export type LineSource = 'input' | 'derived' | 'config_default' | 'not_supplied' | 'moved_to_channel' | 'not_recognised';

export interface WaterfallLine {
  key: LineKey;
  label: string;
  /** Signed: positive for the starting revenue line, negative for deductions. null = unknown. */
  amount_inr: Inr;
  kind: 'start' | 'deduction';
  source: LineSource;
  note?: string;
}

export type LeakCause =
  | 'refund_unknown'
  | 'full_return_partial_recovery'
  | 'discount_exceeds_margin'
  | 'fees_exceed_margin'
  | 'other_negative';

export interface OrderResult {
  order_id: string;
  date: string;
  channel: string;
  product_id: string;
  synthetic: boolean;
  returned: boolean;
  status: OrderStatus;
  gross_inr: number;
  net_sales_inr: Inr;
  contribution_inr: Inr;
  unknown_fields: string[];
  lines: WaterfallLine[];
  inputs: {
    gross: number;
    discount: number;
    refund: Inr;
    product_cost: Inr;
    recovered: Inr;
    shipping: number;
    fee: Inr;
    return_cost: Inr;
    handling: Inr;
    ads: Inr;
  };
  derived: { net_sales: Inr; net_product_cost: Inr; ads_allocated: Inr; contribution: Inr };
  flags: string[];
  leak_cause: LeakCause | null;
  labels: string[];
  /** R8: refund dated after the period end. In-period view treats it as a kept order. */
  late_refund: boolean;
  refund_date: string | null;
  /** R8: contribution with the late refund recognised; equals contribution_inr when not late. */
  recognised_contribution_inr: Inr;
}

export interface WorkedOrderResult {
  contribution_inr: number;
  expected_contribution_inr: number | null;
  matches: boolean;
  lines: WaterfallLine[];
  note: string;
}

export interface GroupRow {
  key: string;
  orders: number;
  unknown_count: number;
  net_sales_inr: number;
  contribution_before_spend_inr: number;
  channel_spend_inr: Inr;
  contribution_inr: Inr;
}

export interface Reconciliation {
  orders_inr: Inr;
  channels_inr: Inr;
  products_inr: Inr;
  gap_inr: number;
  tolerance_inr: number;
  ok: boolean;
  partial: boolean;
  statement: string;
}

export interface Totals {
  orders: number;
  gross_inr: number;
  net_sales_inr: number;
  contribution_inr: Inr;
  contribution_pct: number | null;
  negative_count: number;
  unknown_count: number;
  partial: boolean;
  channel_spend_inr: Inr;
  late_refund_count: number;
  /** R8: change if late refunds were recognised (negative = contribution would fall). */
  late_refund_pending_inr: number;
  /** Product change: no contribution headline until refund and recovery facts are complete. */
  headline_ready: boolean;
}

export interface LeakGroup {
  cause: LeakCause;
  label: string;
  count: number;
  /** Positive rupees lost across the group; null when the amount is unknown. */
  lost_inr: Inr;
  order_ids: string[];
  example_ids: string[];
  why: string;
  why_source: 'template' | 'ai';
}

export interface HeadlineGate {
  open: boolean;
  reason: string;
}

/** Period waterfall: Σ of every order line over computed orders, ending at the reconciled contribution. */
export interface BridgeLine {
  key: LineKey | "net_sales" | "channel_spend" | "contribution";
  label: string;
  amount_inr: number;
  kind: "start" | "deduction" | "subtotal" | "total";
}

export interface WhalePoint {
  rank: number;
  order_id: string;
  contribution_inr: number;
  cumulative_inr: number;
}

export type InterventionKey =
  | 'raise_recovery_via_inspection'
  | 'charge_return_shipping'
  | 'cap_discount'
  | 'add_handling_to_price'
  | 'none';

export type Confidence = 'high' | 'low' | 'unknown';

export interface Candidate {
  intervention: Exclude<InterventionKey, 'none'>;
  label: string;
  rule: string;
  delta_inr: number;
  driving_orders: number;
}

export interface Recommendation {
  intervention: InterventionKey;
  label: string;
  rule: string;
  expected_delta_inr: number;
  confidence: Confidence;
  confidence_reason: string;
  /** Unknown and low recommendations are shown but not pre-selected (Blueprint §12). */
  preselect: boolean;
  why: string;
  why_source: 'template' | 'ai';
  test_30d_draft: string;
  stop_rule_draft: string;
  draft_source: 'template' | 'ai';
}

export interface Observed {
  return_rate_pct: number;
  recovery_pct: number | null;
  avg_product_cost_on_returns_inr: number | null;
  avg_return_cost_inr: number | null;
  avg_shipping_inr: number | null;
  avg_ads_per_order_inr: number | null;
  returned_orders: number;
  refund_unknown_orders: number;
}

export interface AnalysisResult {
  engine_version: string;
  attribution: AttributionMode;
  period_end: string;
  config: { handling_default_inr: number };
  channel_spend: Record<string, Inr>;
  labels: string[];
  totals: Totals;
  reconciliation: Reconciliation;
  orders: OrderResult[];
  groups: {
    channel: GroupRow[];
    product: GroupRow[];
    /** Channel spend that cannot be assigned to products (channel mode only). */
    product_unallocated_spend_inr: Inr;
    product_label: string;
  };
  leaks: LeakGroup[];
  late_refunds: { period_end: string; orders: OrderResult[]; pending_delta_inr: number; total_if_recognised_inr: Inr };
  observed: Observed;
  headline_gate: HeadlineGate;
  recommendation: Recommendation;
  candidates: Candidate[];
  whale: WhalePoint[];
  bridge: BridgeLine[];
}

export interface ScenarioColumn {
  orders: number;
  computed: number;
  unknown: number;
  returns: number;
  net_sales_inr: number;
  net_product_cost_inr: number;
  shipping_inr: number;
  payment_fee_inr: number;
  return_cost_inr: number;
  handling_inr: number;
  ads_inr: number;
  contribution_inr: Inr;
  by_channel: Array<{ key: string; contribution_inr: Inr }>;
}

export interface OrderDelta {
  order_id: string;
  baseline_inr: Inr;
  scenario_inr: Inr;
  delta_inr: Inr;
}

export interface ScenarioResult {
  engine_version: string;
  overrides: ScenarioOverrides;
  changed: string;
  baseline: ScenarioColumn;
  scenario: ScenarioColumn;
  delta: Omit<ScenarioColumn, 'by_channel' | 'contribution_inr'> & { contribution_inr: Inr; by_order: OrderDelta[] };
  recommendation: Recommendation;
  baseline_recommendation: Pick<Recommendation, 'intervention' | 'label' | 'expected_delta_inr' | 'confidence'>;
  candidates: Candidate[];
  assumptions: string[];
}

export type FlagReason = 'duplicate' | 'late_refund' | 'mismatch' | 'unknown' | 'invalid' | 'schema' | 'rounded';

export interface ValidationFlag {
  order_id: string | null;
  /** 1-based line in the file (CSV counts the header). */
  line: number;
  reason: FlagReason;
  detail: string;
  field?: string;
  path?: string;
  action: 'kept' | 'dropped' | 'rejected';
}

export interface ValidationResult {
  rows: OrderRow[];
  rows_in: number;
  rows_kept: number;
  rows_rejected: number;
  flags: ValidationFlag[];
  warnings: string[];
  period_end: string;
}

export type { OrderRow, ScenarioOverrides };
