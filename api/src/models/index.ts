import mongoose, { Schema } from 'mongoose';

// Engine output is stored as-is (Mixed) so a saved record re-reads exactly as returned.
const opts = { versionKey: false, minimize: false } as const;
const Mixed = Schema.Types.Mixed;

const DatasetSchema = new Schema(
  {
    _id: String,
    account: { type: String, index: true },
    source: String,
    rows: [Mixed],
    flags: [Mixed],
    warnings: [String],
    rows_rejected: Number,
    schema_version: String,
    period_end: String,
    rows_in: Number,
    rows_kept: Number,
    files: Mixed,
    supersedes: String,
    // Raw rejected rows (capped at 1,000) and the correction log; large rejected rows go to the blob with the rows.
    rejected_rows: Mixed,
    corrections: Mixed,
    // Large rows live in object storage; this is their key.
    blob: String,
    created_at: Date,
  },
  opts,
);

const AnalysisSchema = new Schema(
  {
    _id: String,
    account: { type: String, index: true },
    dataset_id: { type: String, index: true },
    engine_version: String,
    attribution: String,
    period_end: String,
    config: Mixed,
    result: Mixed,
    // Large results live in object storage; this is their key.
    blob: String,
    created_at: Date,
  },
  opts,
);

const ScenarioSchema = new Schema(
  {
    _id: String,
    account: { type: String, index: true },
    analysis_id: { type: String, index: true },
    overrides: Mixed,
    result: Mixed,
    created_at: Date,
  },
  opts,
);

const DecisionSchema = new Schema(
  {
    _id: String,
    account: { type: String, index: true },
    analysis_id: { type: String, index: true },
    scenario_id: String,
    intervention: String,
    intervention_label: String,
    assumptions: Mixed,
    expected_delta_inr: Mixed,
    confidence: String,
    test_30d: String,
    stop_rule: String,
    owner: String,
    notes: String,
    engine_version: String,
    evidence: Mixed,
    fixed_costs_inr: Number,
    starting_state: Mixed,
    check_in_30_days: Mixed,
    assumed_inputs: Mixed,
    saved_at: Date,
  },
  opts,
);

const AiCacheSchema = new Schema({ _id: String, model: String, prompt_version: String, output: Mixed, created_at: { type: Date, expires: 7 * 24 * 3600 } }, opts);

export const DatasetModel = mongoose.model('Dataset', DatasetSchema, 'datasets');
export const AnalysisModel = mongoose.model('Analysis', AnalysisSchema, 'analyses');
export const ScenarioModel = mongoose.model('Scenario', ScenarioSchema, 'scenarios');
export const DecisionModel = mongoose.model('Decision', DecisionSchema, 'decisions');
export const AiCacheModel = mongoose.model('AiCache', AiCacheSchema, 'ai_cache');

// Autopilot run (v2 §1.1): engine numbers plus explanation texts, scoped by account like analyses.
const AutopilotSchema = new Schema(
  {
    _id: String,
    account: { type: String, index: true },
    dataset_id: { type: String, index: true },
    analysis_id: { type: String, index: true },
    lang: String,
    status: String,
    stages: Mixed,
    headline: Mixed,
    top_leaks: Mixed,
    actions: Mixed,
    pulse: Mixed,
    accepted: Mixed,
    error: String,
    created_at: Date,
    updated_at: Date,
  },
  opts,
);
// AI guard log counters (v2 §5.1): one document, $inc only.
const AiCounterSchema = new Schema({ _id: String, calls: Number, accepted: Number, rejected: Number, failed: Number, by_feature: Mixed, updated_at: Date }, opts);
export const AutopilotModel = mongoose.model('Autopilot', AutopilotSchema, 'autopilots');
export const AiCounterModel = mongoose.model('AiCounter', AiCounterSchema, 'ai_counters');

// Platform (v2): accounts, sign-ins, the per-account audit log and saved column mappings.
const UserSchema = new Schema(
  {
    _id: String,
    provider: String,
    provider_id: String,
    email: String,
    name: String,
    avatar_url: String,
    locale: String,
    created_at: Date,
    last_login_at: Date,
    consent: Mixed,
  },
  opts,
);
UserSchema.index({ provider: 1, provider_id: 1 }, { unique: true });
const LoginSchema = new Schema({ _id: String, user_id: { type: String, index: true }, provider: String, ip_hash: String, user_agent: String, at: Date }, opts);
const AuditEventSchema = new Schema({ _id: String, account: { type: String, index: true }, at: Date, kind: String, detail: Mixed }, opts);
const ColumnMappingSchema = new Schema(
  { _id: String, account: { type: String, index: true }, header_signature: String, headers: [String], mapping: Mixed, profile: String, created_at: Date, updated_at: Date },
  opts,
);
export const UserModel = mongoose.model('User', UserSchema, 'users');
export const LoginModel = mongoose.model('Login', LoginSchema, 'logins');
export const AuditEventModel = mongoose.model('AuditEvent', AuditEventSchema, 'audit');
export const ColumnMappingModel = mongoose.model('ColumnMapping', ColumnMappingSchema, 'column_mappings');
