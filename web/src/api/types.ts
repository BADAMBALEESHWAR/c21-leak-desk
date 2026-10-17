// Mirror of the API contract (api/src/engine/types.ts, api/src/schema/orders.ts, api/src/errors.ts
// and the route envelopes in api/src/routes). Keep in step with the server.

export type Inr = number | null;
export type AttributionMode = 'allocate' | 'channel';
export type OrderStatus = 'ok' | 'unknown';

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
  /** Refund dated after the period end; counted in the period as a kept order. */
  late_refund: boolean;
  refund_date: string | null;
  /** Contribution with the late refund recognised; equals contribution_inr when not late. */
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
  /** Change if late refunds were recognised (negative = contribution would fall). */
  late_refund_pending_inr: number;
  /** No contribution headline until refund and recovery facts are complete. */
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
export type TextSource = 'template' | 'ai';

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
  /** Unknown and low recommendations are shown but not pre-selected. */
  preselect: boolean;
  why: string;
  why_source: TextSource;
  test_30d_draft: string;
  stop_rule_draft: string;
  draft_source: TextSource;
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

export interface LateRefunds {
  period_end: string;
  orders: OrderResult[];
  pending_delta_inr: number;
  total_if_recognised_inr: Inr;
}

/** Period waterfall over computed orders; start + deductions sum to totals.contribution_inr. */
export interface BridgeLine {
  key: string;
  label: string;
  amount_inr: number;
  kind: 'start' | 'deduction' | 'subtotal' | 'total';
}

export interface AnalysisResult {
  engine_version: string;
  bridge?: BridgeLine[];
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
  late_refunds: LateRefunds;
  observed: Observed;
  headline_gate: HeadlineGate;
  recommendation: Recommendation;
  candidates: Candidate[];
  whale: WhalePoint[];
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

/** One assumption per scenario; assume_unknown_refund may ride along or stand alone. */
export interface ScenarioOverrides {
  return_rate_pct?: number;
  recovery_pct?: number;
  shipping_inr?: number;
  refund_policy?: 'full' | 'partial';
  ads_per_order?: number;
  assume_unknown_refund?: boolean;
}

export type OverrideKey = 'return_rate_pct' | 'recovery_pct' | 'shipping_inr' | 'refund_policy' | 'ads_per_order';

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

// ---- Request / response envelopes -------------------------------------------------

export const SAMPLE_SOURCES = [
  'fixture',
  'extended',
  'duplicate_order',
  'late_refund',
  'null_refund',
  'missing_fee',
  'refund_over_gross',
  'recovery_400',
  'bad_schema',
] as const;

export type SampleSource = (typeof SAMPLE_SOURCES)[number];

export function isSampleSource(s: string): s is SampleSource {
  return (SAMPLE_SOURCES as readonly string[]).includes(s);
}

export interface Sample {
  source: SampleSource;
  label: string;
  description: string;
  file?: string;
}

export interface FixtureFile {
  records: { orders: unknown[]; [key: string]: unknown };
  [key: string]: unknown;
}

export interface DatasetResponse {
  dataset_id: string;
  source: string;
  rows_in: number;
  rows_kept: number;
  rows_rejected: number;
  kept_ids: string[];
  synthetic_rows: number;
  flags: ValidationFlag[];
  warnings: string[];
  period_end: string;
  schema_version?: string;
  persisted: boolean;
}

export interface AnalysisRequest {
  attribution: AttributionMode;
  period_end?: string;
  config?: { handling_default_inr?: number };
}

export type AnalysisResponse = AnalysisResult & {
  analysis_id: string;
  dataset_id: string;
  persisted?: boolean;
};

export type ScenarioResponse = ScenarioResult & {
  scenario_id: string;
  analysis_id: string;
  observed: Observed;
  persisted?: boolean;
};

export interface TestPlan {
  scenario_id: string;
  intervention: InterventionKey;
  test_30d: string;
  stop_rule: string;
  expected_delta_inr: number;
  source: TextSource;
}

export interface Narration {
  ai: string;
  leaks: Array<{ cause: LeakCause; why: string; why_source: TextSource; reason?: string }>;
  recommendation: { why: string; why_source: TextSource; reason?: string };
}

export interface DecisionRequest {
  scenario_id?: string;
  intervention: string;
  expected_delta_inr: number | null;
  test_30d: string;
  stop_rule: string;
  owner: string;
  notes?: string;
}

export interface DecisionSaved {
  decision_id: string;
  saved_at: string;
  assumptions: Record<string, unknown>;
  engine_version: string;
  persisted: boolean;
}

export interface DecisionSummary {
  decision_id: string;
  analysis_id: string;
  intervention: string;
  intervention_label: string;
  expected_delta_inr: number | null;
  confidence: Confidence | 'custom';
  owner: string;
  saved_at: string;
}

export interface Checks {
  check1?: { expected: number; actual: number; six_lines: boolean; pass: boolean };
  check2?: { allocate_total: number; channel_total: number; fixture_total: number; reconciled: boolean; never_both: boolean; pass: boolean };
  check3?: { unknown_labelled: boolean; confidence: Confidence; recommendation_changed: boolean; pass: boolean };
  all_pass?: boolean;
  engine_version?: string;
  [key: string]: unknown;
}

export interface Health {
  status: string;
  db: 'ok' | 'down' | 'memory' | string;
  ai: string;
  storage?: string;
  engine_version: string;
  uptime_s?: number;
}

export type ErrorCode =
  | 'file_too_large'
  | 'unsupported_type'
  | 'schema_invalid'
  | 'no_valid_rows'
  | 'override_invalid'
  | 'not_found'
  | 'attribution_conflict'
  | 'db_unavailable'
  | 'internal';

export interface ApiIssue {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode | string;
    message: string;
    path?: string;
    hint?: string;
    issues?: ApiIssue[];
  };
}
