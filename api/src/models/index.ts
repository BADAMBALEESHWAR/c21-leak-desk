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
