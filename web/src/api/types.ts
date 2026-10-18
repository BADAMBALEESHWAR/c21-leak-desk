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

/**
 * Unit economics over the computed (known) orders. Net revenue = revenue − refunds (net sales);
 * CM1 after net product cost, CM2 after shipping, payment fees and handling, CM3 after ads (operational contribution).
 * Percentages are of net revenue; null when net revenue is 0 or unknown.
 */
export interface Margins {
  net_revenue_inr: Inr;
  net_product_cost_inr: Inr;
  shipping_inr: Inr;
  /** Return shipping; deducted with shipping in CM2. Absent when the API folds it into shipping_inr. */
  return_cost_inr?: Inr;
  payment_fee_inr: Inr;
  handling_inr: Inr;
  ads_inr: Inr;
  contribution_inr: Inr;
  cm1_pct: number | null;
  cm2_pct: number | null;
  cm3_pct: number | null;
  orders_counted: number;
  /** Orders left out because a fact is unknown. */
  unknown_left_out?: number;
  partial: boolean;
}

export interface GroupRow {
  key: string;
  orders: number;
  unknown_count: number;
  net_sales_inr: number;
  contribution_before_spend_inr: number;
  channel_spend_inr: Inr;
  contribution_inr: Inr;
  /** Same shape as AnalysisResult.margins, for this channel or product. */
  margins?: Margins;
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

export type Confidence = 'high' | 'medium' | 'low' | 'unknown';

/** Bootstrap evidence for a fix: level, 95% range and how often it gained money across resamples of the owner's orders. */
export interface Evidence {
  level: 'high' | 'medium' | 'low';
  delta_inr: number;
  ci_low_inr: number;
  ci_high_inr: number;
  p_positive: number;
  orders_checked: number;
  orders_driving: number;
  orders_left_out: number;
  method: string;
  reason: string;
}
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
  /** Bootstrap evidence per candidate fix (keyed by intervention). */
  evidence?: Record<string, Evidence>;
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
  /** Unit economics for the whole period (absent from older analyses). */
  margins?: Margins;
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
  /** The file the row came from, when several files were uploaded together. */
  file?: string;
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
  'bad_values',
  'demo_12m',
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
  /** Present when several files were merged into this dataset, in upload order (after an append: every file so far). */
  files?: Array<{ name: string; rows: number }>;
  /** Absent on GET /datasets/:id. */
  persisted?: boolean;
  /** Adding to saved data (append_to): orders this upload added. flags, rows_in and rows_rejected then describe this upload only. */
  rows_added?: number;
  /** Orders in this upload whose order_id was already saved; ignored, never counted twice. */
  duplicates_ignored?: number;
  /** The saved dataset this upload was added to; dataset_id is the new version (or the saved one when unchanged). */
  appended_to?: string;
  /** 200 with nothing new: the saved dataset stays as it is. */
  unchanged?: boolean;
  /** The API's sentence for an unchanged upload, e.g. "Nothing new: all 2 orders were already saved." */
  message?: string;
  /** Row corrections made on the import report, oldest first (each one is a new dataset version). */
  corrections?: RowCorrection[];
  /** Orders with at least one corrected (user-entered) value. */
  corrected_order_ids?: string[];
  /** Flags still open after the last correction. */
  still_flagged?: number | ValidationFlag[];
  /** Rejected rows as read from the file, so they can be fixed. */
  rejected_rows?: RejectedRow[];
}

export interface RejectedRow {
  line: number;
  file?: string;
  order_id?: string | null;
  raw: Record<string, unknown>;
}

export interface RowCorrection {
  order_id: string | null;
  line: number | null;
  field: string;
  from: unknown;
  to: unknown;
  at: string;
  by?: string | null;
  note?: string | null;
}

/** PATCH /datasets/:id/rows: fix one flagged or rejected row; the API saves a new dataset version. */
export interface RowCorrectionRequest {
  order_id?: string;
  line?: number;
  changes: Record<string, string | number | boolean | null>;
  note?: string;
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
  /** Bootstrap evidence per fix under this scenario. */
  evidence?: Record<string, Evidence>;
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
  /** Fixed costs per period (salaries, rent, tools), an assumption entered on the ledger. */
  fixed_costs_inr?: number;
  /** Every assumed input behind the decision, kept with it and written into the export. */
  assumptions?: Record<string, unknown>;
}

export interface DecisionSaved {
  decision_id: string;
  saved_at: string;
  assumptions: Record<string, unknown>;
  engine_version: string;
  persisted: boolean;
  /** 'demo' for decisions saved in the shared demo database. */
  workspace?: WorkspaceKind;
  /** Present when the API returns the 30-day check-in with the save. */
  check_in_30_days?: CheckIn;
}

/** The 30-day check-in written into every decision export. */
export interface CheckIn {
  metric: string;
  /** Plain-language name of the metric. */
  metric_label?: string;
  unit?: 'pct' | 'inr' | string;
  direction?: 'at_least' | 'at_most' | string;
  baseline_value?: number | null;
  baseline_source?: string;
  target_value: number | string | null;
  date: string;
  /** Operational contribution expected by the check-in, and what it is based on. */
  contribution_target_inr?: number | null;
  contribution_target_basis?: string;
}

/** GET /decisions/:id/export?format=json */
export interface DecisionExport {
  decision_id?: string;
  starting_state?: Record<string, unknown>;
  scenario?: Record<string, unknown> | null;
  expected_impact_inr?: number | null;
  date?: string;
  check_in_30_days?: CheckIn;
  assumptions?: Array<string | Record<string, unknown>>;
  owner?: string;
  [key: string]: unknown;
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

export interface CheckIntervention {
  intervention: InterventionKey;
  expected_delta_inr: number;
}

export interface Checks {
  check1?: { expected: number; actual: number; six_lines: boolean; pass: boolean };
  check2?: {
    allocate_total: number;
    channel_total: number;
    expected_total?: number;
    fixture_total: number;
    reconciled: boolean;
    never_both: boolean;
    channel_spend?: Record<string, number>;
    pass: boolean;
  };
  check3?: {
    unknown_labelled: boolean;
    confidence: Confidence;
    before?: CheckIntervention;
    after_recovery_50?: CheckIntervention;
    recommendation_changed: boolean;
    pass: boolean;
  };
  all_pass?: boolean;
  engine_version?: string;
  ms?: number;
  [key: string]: unknown;
}

export interface Health {
  status: string;
  db: 'ok' | 'down' | 'memory' | string;
  ai: string;
  storage?: string;
  engine_version: string;
  uptime_s?: number;
  /** Where the data is stored, e.g. ap-south-1. Absent on servers that do not report it. */
  region?: string;
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

// ---- Accounts (Cognito, optional) ------------------------------------------------------

export interface AuthConfig {
  enabled: boolean;
  domain?: string;
  client_id?: string;
  region?: string;
}

export interface MeResponse {
  user: { sub: string; email: string | null } | null;
  auth_enabled: boolean;
  workspace?: WorkspaceKind;
}

export type WorkspaceKind = 'account' | 'demo';

/** One saved dataset in GET /workspace. Data that was added to is listed once, as its newest version. */
export interface WorkspaceDataset {
  dataset_id: string;
  source: string;
  period_end: string;
  rows_kept: number;
  files: Array<{ name: string; rows: number }> | null;
  created_at: string;
  latest_analysis: {
    analysis_id: string;
    attribution: AttributionMode;
    created_at: string;
    contribution_inr: number | null;
  } | null;
}

/** GET /workspace: the signed-in owner's saved data, newest first. Without a token: the demo workspace, which lists nothing. */
export interface WorkspaceResponse {
  workspace: WorkspaceKind;
  user: { sub: string; email: string | null } | null;
  datasets: WorkspaceDataset[];
  /** The newest saved data; analysis_id is null when it has not been analysed yet. */
  latest: { dataset_id: string; analysis_id: string | null } | null;
}

// ---- Pulse (owner analytics) ------------------------------------------------------------

export interface PulseCommon {
  labels: string[];
  unknown_count: number;
  synthetic_rows?: number;
}

export interface PulseHeadline {
  orders: number;
  gross_inr: number;
  net_sales_inr: number;
  contribution_inr: Inr;
  contribution_pct: number | null;
  return_pct: number | null;
  aov_inr: number | null;
}

export interface PulseExtreme {
  month: string;
  value_inr: number | null;
}

export interface PulseAction {
  title: string;
  detail: string;
  recoverable_inr: number | null;
  lever: string;
  /** Present only when the Scenario step can model the action. */
  overrides?: ScenarioOverrides;
}

export interface PulseOverview extends PulseCommon {
  month: string;
  months: string[];
  headline: PulseHeadline;
  previous: PulseHeadline | null;
  /** null for the first month (no previous month to compare). */
  deltas: { orders_pct: number | null; net_sales_pct: number | null; contribution_pct: number | null; return_pct_pts: number | null } | null;
  /** null when the file has fewer than two months to compare; a metric is null when every month ties. */
  best: { net_sales: PulseExtreme | null; contribution: PulseExtreme | null; contribution_per_order: PulseExtreme | null } | null;
  worst: { net_sales: PulseExtreme | null; contribution: PulseExtreme | null; contribution_per_order: PulseExtreme | null } | null;
  months_compared?: number;
  actions: PulseAction[];
}

export interface PulseMonth {
  month: string;
  orders: number;
  gross_inr: number;
  net_sales_inr: number;
  contribution_inr: Inr;
  contribution_pct: number | null;
  return_pct: number | null;
  discount_depth_pct: number | null;
  aov_inr: number | null;
  unknown: number;
}

export interface PulseMonths extends PulseCommon {
  months: PulseMonth[];
}

export type ProductLabel = 'push' | 'fix' | 'niche' | 'review';

export interface PulseProduct {
  product_id: string;
  units: number;
  orders: number;
  net_sales_inr: number;
  contribution_inr: Inr;
  contribution_per_unit_inr: number | null;
  return_pct: number | null;
  discount_depth_pct: number | null;
  rank_units: number;
  rank_net_sales: number;
  rank_contribution: number;
  label: ProductLabel;
  lever: string;
  note: string;
}

export interface PulseProducts extends PulseCommon {
  products: PulseProduct[];
}

export interface PulseChannel {
  channel: string;
  orders: number;
  net_sales_inr: number;
  contribution_inr: Inr;
  return_pct: number | null;
  ads_inr: number | null;
  ads_share_pct: number | null;
}

export interface PulsePaymentRow {
  payment_type: string;
  orders: number;
  share_pct: number | null;
  return_pct: number | null;
  payment_fee_per_order_inr: number | null;
  return_cost_per_order_inr: number | null;
  contribution_per_order_inr: number | null;
}

export interface PulseChannels extends PulseCommon {
  attribution: AttributionMode;
  channels: PulseChannel[];
  payments: { not_in_file: true } | { rows: PulsePaymentRow[]; cod_vs_prepaid_return_ratio: number | null };
}

export interface PulseLeakMonth {
  month: string;
  by_cause: Record<string, number>;
  total_lost_inr: number;
  unknown_orders: number;
}

export interface PulseLeaks extends PulseCommon {
  causes: string[];
  months: PulseLeakMonth[];
}

export interface PulseInsights {
  discount_bands: Array<{ band: string; orders: number; contribution_per_order_inr: number | null }>;
  /** Discount band where contribution per order turns negative (current API). */
  negative_from_discount_band?: string | null;
  /** Earlier contract name; read when present. */
  negative_from_discount_pct?: number | null;
  order_value_bands: Array<{ band: string; orders: number; shipping_pct_of_net_sales: number | null; contribution_per_order_inr: number | null }>;
  repeat:
    | { not_in_file: true }
    | { customers: number; repeat_customers: number; repeat_rate_pct: number | null; contribution_per_order_first_inr: number | null; contribution_per_order_repeat_inr: number | null };
  labels: string[];
  unknown_count?: number;
}

// ---- Profyn v2: autopilot, fix advisor, Ask Profyn, digest, AI guard, import mapping, accounts -----------------------

/** Where a piece of wording came from: AI (numbers still from the engine) or the deterministic template. */
export type AiTextSource = 'ai' | 'template';

export interface AiText {
  text: string;
  source: AiTextSource;
}

export const AUTOPILOT_STAGES = ['analysis', 'leaks', 'scenarios', 'margins', 'pulse', 'explanations'] as const;
export type AutopilotStage = (typeof AUTOPILOT_STAGES)[number];
/** pending | running | done | failed | skipped. */
export type StageStatus = string;

export interface AutopilotHeadline {
  contribution_inr: Inr;
  net_sales_inr: Inr;
  orders: number;
  unknown_orders: number;
  partial: boolean;
  margins?: Margins | null;
}

export interface AutopilotLeak {
  cause: string;
  label: string;
  orders: number;
  inr_at_stake: Inr;
}

export interface DecisionDraft {
  intervention: string;
  expected_delta_inr: number | null;
  test_30d: string;
  stop_rule: string;
}

export interface AutopilotAction {
  rank: number;
  candidate_id: string;
  intervention: string;
  label: string;
  overrides?: ScenarioOverrides | null;
  expected_delta_inr: number | null;
  confidence: Confidence | null;
  evidence?: Evidence | null;
  explanation?: AiText | null;
  decision_draft?: DecisionDraft | null;
}

/** POST /datasets/:id/autopilot and GET /autopilot/:id. */
export interface Autopilot {
  autopilot_id: string;
  dataset_id: string;
  analysis_id: string | null;
  status: 'running' | 'done' | 'failed' | string;
  stages: Partial<Record<AutopilotStage, StageStatus>>;
  headline: AutopilotHeadline | null;
  top_leaks: AutopilotLeak[];
  actions: AutopilotAction[];
}

export interface AutopilotRequest {
  attribution?: AttributionMode;
  lang?: string;
}

export interface AdvisorIntervention {
  candidate_id: string;
  intervention: string;
  label: string;
  overrides?: ScenarioOverrides | null;
  expected_delta_inr: number | null;
  confidence: Confidence | null;
  evidence?: Evidence | null;
}

/** POST /analyses/:id/advisor: one leak cause explained, with 2–3 fixes and a drafted test. */
export interface Advisor {
  cause: string;
  label: string;
  summary: AiText;
  /** Engine facts behind the summary: a list of sentences, label/value pairs or a plain object. */
  facts?: unknown;
  interventions: AdvisorIntervention[];
  test_30d: AiText | null;
  stop_rule: AiText | null;
}

export type AskSource = 'ai' | 'template' | 'table';

export interface AskLink {
  route: string;
  params?: { cause?: string; channel?: string; product?: string; month?: string };
}

/** POST /analyses/:id/ask. */
export interface AskAnswer {
  answer: string;
  source: AskSource;
  tool?: { name: string; args?: Record<string, unknown> } | null;
  result?: unknown;
  link?: AskLink | null;
  /** Set when the guard refused the AI wording or the question. */
  rejected?: boolean | string | null;
}

/** GET /analyses/:id/digest. */
export interface Digest {
  sections: Array<{ key: string; title: string; text: string }>;
  source: AiTextSource;
  badge?: string;
}

export interface AiFeatureCount {
  calls?: number;
  accepted?: number;
  rejected?: number;
}

/** GET /ai/status: the AI guard's live log. */
export interface AiStatus {
  enabled: boolean;
  model: string | null;
  provider: string | null;
  calls: number;
  accepted: number;
  rejected: number;
  by_feature: Record<string, AiFeatureCount | number>;
  /** The aggregate fields each AI feature may send, e.g. { narrate: ['totals.contribution_inr', …] }. */
  fields_sent: Record<string, unknown> | string[];
  /** Calls that failed (timeout, provider error) and fell back to the template. */
  failed?: number;
  /** One sentence on where data is stored and what leaves the API. */
  region_note?: string;
}

export interface ImportProfile {
  id: string;
  label: string;
  marketplace: string;
  fields_mapped: number | string[];
}

/** Schema field → column in the uploaded file (null: not in the file). */
export type ColumnMapping = Record<string, string | null>;

export interface ImportMapRequest {
  headers: string[];
  sample_rows?: string[][];
  profile?: string;
}

/** POST /import/map. */
export interface ImportMapResult {
  profile: string | null;
  source: 'profile' | 'alias' | 'ai' | 'saved';
  mapping: ColumnMapping;
  /** Overall (0–1) or per schema field. */
  confidence: number | Record<string, number> | null;
  unmapped_required: string[];
  saved: boolean;
}

export interface AuthProviders {
  google: boolean;
  github: boolean;
  email: boolean;
}

export interface Consent {
  ai?: boolean;
  email_digest?: boolean;
}

export interface ProfileUser {
  _id: string;
  provider: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  consent?: Consent;
}

export interface LoginEntry {
  at?: string;
  provider?: string;
  ip?: string;
  user_agent?: string;
  [key: string]: unknown;
}

/** GET /me with a cookie session (401 for a guest). */
export interface MeProfile {
  user: ProfileUser;
  logins?: LoginEntry[];
  consent?: Consent;
}

export interface AuditEntry {
  at?: string;
  action?: string;
  detail?: string;
  [key: string]: unknown;
}

// ---- Connectors: Shopify Admin API ------------------------------------------------------------------------------------

/** Costs Shopify does not know, applied to every imported order and labelled Assumed. */
export interface ShopifyAssumptions {
  /** ₹ average courier cost per order. */
  shipping_inr: number;
  /** Payment gateway fee, % of the order value (0–100). */
  fee_pct: number;
  /** ₹ reverse shipping per returned order. */
  return_cost_inr: number;
  /** ₹ extra charge per cash-on-delivery order. */
  cod_fee_inr?: number;
}

/** POST /connectors/shopify/test */
export interface ShopifyTestRequest {
  shop: string;
  token: string;
}

export interface ShopifyTestResult {
  ok: boolean;
  shop: { name: string; domain: string; currency: string; plan?: string | null };
  scopes: string[];
  orders_estimate?: number | null;
}

/** POST /connectors/shopify/connect */
export interface ShopifyConnectRequest extends ShopifyTestRequest {
  /** YYYY-MM-DD: orders created on or after this day. */
  since?: string;
  assumptions: ShopifyAssumptions;
}

export interface ShopifyConnectorInfo {
  provider: 'shopify';
  shop: string;
  connected_at: string;
  last_sync_at: string | null;
  orders_imported: number;
  /** False in the demo: the token was used once and not saved. */
  stored: boolean;
}

/** Orders left out on purpose: test orders, cancelled orders. A number, or counts by reason. */
export type ShopifySkipped = number | Record<string, number | undefined>;

/** POST /connectors/shopify/connect and /sync (201): the new dataset, as an upload reports it. */
export interface ShopifyImportResult {
  dataset_id: string;
  rows_in: number;
  rows_kept: number;
  rows_rejected: number;
  flags: ValidationFlag[];
  skipped?: ShopifySkipped | null;
  currency_warning?: string | null;
  connector: ShopifyConnectorInfo;
}

/** One saved connector (GET /connectors). */
export interface ConnectorSummary {
  provider: 'shopify';
  shop: string;
  shop_name: string | null;
  currency: string | null;
  connected_at: string;
  last_sync_at: string | null;
  orders_imported: number;
  dataset_id: string | null;
  assumptions: ShopifyAssumptions | null;
}

export interface ConnectorsResponse {
  connectors: ConnectorSummary[];
  /** True when the server has a Shopify app for the one-click install. */
  shopify_oauth: boolean;
}
