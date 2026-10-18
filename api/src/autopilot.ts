import type { Request } from 'express';
import { accountOf } from './auth.js';
import { modelFor, phraseFields, type AiModel, type FieldInput } from './ai/grounded.js';
import { inr, PHRASES } from './ai/phrases.js';
import { interventionLabels, recommendationText, type Lang } from './ai/templates.js';
import { dbState } from './db.js';
import { pulseOverview } from './engine/pulse.js';
import { DISCOUNT_CAP_PCT, INTERVENTIONS, RECOVERY_TARGET_PCT } from './engine/scenario.js';
import type { AnalysisResult, Candidate, Confidence, InterventionKey } from './engine/types.js';
import type { Margins } from './engine/margins.js';
import { logger } from './logger.js';
import { AutopilotModel } from './models/index.js';
import { analyses, newId, type AnalysisRecord, type DatasetRecord } from './repo.js';
import { marginsFor, runAnalysisRequest } from './routes/analyses.js';
import type { ScenarioOverrides } from './schema/orders.js';
import { evidenceFor, type Evidence } from './stats/evidence.js';

// Autopilot (v2 §1.1): on import, one job runs analyse → leaks → the four candidate scenarios → margins → Pulse and
// stores an autopilot document. Numbers are filled first (synchronously, from the engine); explanations follow and
// never block: template text is there from the start, AI text replaces it only if the grounding guard accepts it.

export const STAGES = ['analysis', 'leaks', 'scenarios', 'margins', 'pulse', 'explanations'] as const;
export type StageKey = (typeof STAGES)[number];
export type StageStatus = 'pending' | 'done' | 'error';
export type CandidateKey = Exclude<InterventionKey, 'none'>;

export interface AutopilotAction {
  rank: number;
  candidate_id: string;
  intervention: CandidateKey;
  label: string;
  /** The single scenario override that expresses this change, for "Adjust in Scenario"; null when none does. */
  overrides: ScenarioOverrides | null;
  expected_delta_inr: number;
  confidence: Confidence;
  /** Statistical confidence: bootstrap range and level (high / medium / low) around the engine's exact delta. */
  evidence?: Evidence;
  driving_orders: number;
  explanation: { text: string; source: 'ai' | 'template' };
  decision_draft: { intervention: CandidateKey; expected_delta_inr: number; test_30d: string; stop_rule: string };
}

export interface AutopilotRecord {
  _id: string;
  account?: string;
  dataset_id: string;
  analysis_id: string;
  lang: Lang;
  status: 'running' | 'done' | 'error';
  stages: Record<StageKey, StageStatus>;
  headline: {
    contribution_inr: number | null;
    net_sales_inr: number;
    orders: number;
    unknown_orders: number;
    partial: boolean;
    margins: Margins | null;
  } | null;
  top_leaks: Array<{ cause: string; label: string; orders: number; inr_at_stake: number | null }>;
  actions: AutopilotAction[];
  pulse: { month: string | null; headline: unknown; deltas: unknown; months_compared: number } | null;
  accepted: Array<{ rank: number; decision_id: string }>;
  error?: string;
  created_at: Date;
  updated_at: Date;
}

// ---- store: memory always, Mongo upsert when connected -----------------------------------------------------------

const MEMORY_LIMIT = 200;
const mem = new Map<string, AutopilotRecord>();

export const autopilots = {
  async save(doc: AutopilotRecord): Promise<boolean> {
    doc.updated_at = new Date();
    mem.delete(doc._id);
    mem.set(doc._id, doc);
    if (mem.size > MEMORY_LIMIT) mem.delete(mem.keys().next().value as string);
    if (dbState() !== 'connected') return false;
    try {
      await AutopilotModel.replaceOne({ _id: doc._id }, doc, { upsert: true });
      return true;
    } catch (err) {
      logger.warn({ err: (err as Error).message, autopilot_id: doc._id }, 'autopilot write failed; kept in memory');
      return false;
    }
  },
  async get(id: string): Promise<AutopilotRecord | null> {
    const hit = mem.get(id);
    if (hit) return hit;
    if (dbState() !== 'connected') return null;
    return ((await AutopilotModel.findById(id).lean().catch(() => null)) as AutopilotRecord | null) ?? null;
  },
};

// ---- progress events (SSE) ---------------------------------------------------------------------------------------

export type AutopilotEvent = { type: 'stage'; stage: StageKey; status: StageStatus } | { type: 'done'; doc: ReturnType<typeof autopilotView> };
const listeners = new Map<string, Set<(e: AutopilotEvent) => void>>();

export function subscribe(id: string, fn: (e: AutopilotEvent) => void): () => void {
  const set = listeners.get(id) ?? new Set();
  set.add(fn);
  listeners.set(id, set);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(id);
  };
}

function emit(id: string, e: AutopilotEvent) {
  for (const fn of [...(listeners.get(id) ?? [])]) fn(e);
}

// ---- engine-derived pieces ---------------------------------------------------------------------------------------

/** The top three engine candidates by expected ₹ delta (ties keep the engine's order). */
export const rankCandidates = (candidates: Candidate[]) => [...candidates].sort((x, y) => y.delta_inr - x.delta_inr).slice(0, 3);

/** Which candidates a single scenario override can express (the same mapping Pulse uses for inspection). */
export const CANDIDATE_OVERRIDES: Record<CandidateKey, ScenarioOverrides | null> = {
  raise_recovery_via_inspection: { recovery_pct: RECOVERY_TARGET_PCT },
  charge_return_shipping: null,
  cap_discount: null,
  add_handling_to_price: null,
};

const LOW_CONFIDENCE_BELOW = 5; // the engine's rule in recommend(): fewer driving orders → low

/** The engine's confidence rule applied to one candidate; the recommended candidate keeps the engine's own value. */
export function candidateConfidence(a: AnalysisResult, c: Candidate): Confidence {
  if (c.intervention === a.recommendation.intervention) return a.recommendation.confidence;
  if (a.totals.unknown_count > 0) return 'unknown';
  if (c.delta_inr <= 0 || c.driving_orders < LOW_CONFIDENCE_BELOW) return 'low';
  return 'high';
}

/** One candidate as an action card: label, delta, confidence, template explanation and the decision draft. */
export function actionFor(a: AnalysisResult, c: Candidate, rank: number, lang: Lang, evidence?: Evidence): AutopilotAction & { ai_input: FieldInput } {
  const label = interventionLabels(lang).find((l) => l.intervention === c.intervention)?.label ?? c.label;
  const text = recommendationText(lang, { intervention: c.intervention, expected_delta_inr: c.delta_inr }, a.observed, c.driving_orders);
  const template = c.delta_inr > 0 ? text.why : PHRASES[lang].noGain(label, inr(lang, c.delta_inr));
  const confidence = candidateConfidence(a, c);
  return {
    rank,
    candidate_id: c.intervention,
    intervention: c.intervention,
    label,
    overrides: CANDIDATE_OVERRIDES[c.intervention],
    expected_delta_inr: c.delta_inr,
    confidence,
    ...(evidence ? { evidence } : {}),
    driving_orders: c.driving_orders,
    explanation: { text: template, source: 'template' },
    decision_draft: { intervention: c.intervention, expected_delta_inr: c.delta_inr, test_30d: text.test_30d_draft, stop_rule: text.stop_rule_draft },
    // Exactly the fields listed in FIELDS_SENT.autopilot.
    ai_input: {
      data: {
        intervention: c.intervention,
        label,
        rule: INTERVENTIONS[c.intervention].rule,
        expected_delta_inr: c.delta_inr,
        driving_orders: c.driving_orders,
        confidence,
        observed: { return_rate_pct: a.observed.return_rate_pct, recovery_pct: a.observed.recovery_pct, avg_return_cost_inr: a.observed.avg_return_cost_inr },
        recovery_target_pct: RECOVERY_TARGET_PCT,
        discount_cap_pct: DISCOUNT_CAP_PCT,
      },
      template,
    },
  };
}

export function autopilotView(doc: AutopilotRecord) {
  return {
    autopilot_id: doc._id,
    dataset_id: doc.dataset_id,
    analysis_id: doc.analysis_id,
    status: doc.status,
    stages: doc.stages,
    headline: doc.headline,
    top_leaks: doc.top_leaks,
    actions: doc.actions,
    pulse: doc.pulse,
    accepted: doc.accepted ?? [],
    lang: doc.lang,
    ...(doc.error ? { error: doc.error } : {}),
    created_at: doc.created_at,
  };
}

// ---- the job -----------------------------------------------------------------------------------------------------

/**
 * Runs the pipeline for a dataset. Request problems (bad body, attribution conflict) throw before anything is stored,
 * exactly as POST /analyses does. Returns once the numbers are filled; AI explanations, if allowed, finish later.
 */
export async function runAutopilot(req: Request, dataset: DatasetRecord, rawBody: unknown, lang: Lang): Promise<AutopilotRecord> {
  const { body, result: a } = runAnalysisRequest(dataset.rows, dataset.period_end, rawBody);
  const analysis: AnalysisRecord = {
    _id: newId(),
    account: accountOf(req.user),
    dataset_id: dataset._id,
    engine_version: a.engine_version,
    attribution: a.attribution,
    period_end: a.period_end,
    config: a.config,
    ...(body.channel_spend ? { channel_spend: body.channel_spend } : {}),
    result: a,
    created_at: new Date(),
  };
  await analyses.save(analysis);

  const now = new Date();
  const doc: AutopilotRecord = {
    _id: newId(),
    account: accountOf(req.user),
    dataset_id: dataset._id,
    analysis_id: analysis._id,
    lang,
    status: 'running',
    stages: Object.fromEntries(STAGES.map((s) => [s, 'pending'])) as Record<StageKey, StageStatus>,
    headline: null,
    top_leaks: [],
    actions: [],
    pulse: null,
    accepted: [],
    created_at: now,
    updated_at: now,
  };
  const aiInputs: FieldInput[] = [];
  const stage = (key: StageKey, fn: () => void) => {
    try {
      fn();
      doc.stages[key] = 'done';
    } catch (err) {
      doc.stages[key] = 'error';
      doc.status = 'error';
      doc.error = `${key}: ${(err as Error).message}`;
      logger.error({ err, autopilot_id: doc._id, stage: key }, 'autopilot stage failed');
    }
    emit(doc._id, { type: 'stage', stage: key, status: doc.stages[key] });
  };

  stage('analysis', () => {
    doc.headline = {
      contribution_inr: a.totals.contribution_inr,
      net_sales_inr: a.totals.net_sales_inr,
      orders: a.totals.orders,
      unknown_orders: a.totals.unknown_count,
      partial: a.totals.partial,
      margins: null,
    };
  });
  stage('leaks', () => {
    doc.top_leaks = a.leaks.slice(0, 3).map((l) => ({ cause: l.cause, label: PHRASES[lang].leakLabel(l.cause), orders: l.count, inr_at_stake: l.lost_inr }));
  });
  stage('scenarios', () => {
    const evidence = evidenceFor(analysis._id, dataset.rows, { attribution: a.attribution, period_end: a.period_end, handling_default_inr: a.config.handling_default_inr, ...(body.channel_spend ? { channel_spend: body.channel_spend } : {}) });
    doc.actions = rankCandidates(a.candidates).map((c, i) => {
      const { ai_input, ...action } = actionFor(a, c, i + 1, lang, evidence[c.intervention]);
      aiInputs.push(ai_input);
      return action;
    });
  });
  stage('margins', () => {
    if (doc.headline) doc.headline.margins = marginsFor(a).margins;
  });
  stage('pulse', () => {
    const p = pulseOverview(a);
    doc.pulse = { month: p.month, headline: p.headline, deltas: p.deltas, months_compared: p.months_compared };
  });

  const model = doc.status === 'error' ? null : modelFor(req, dataset);
  if (!model) {
    // Templates are already in place: nothing to wait for.
    stage('explanations', () => undefined);
    finish(doc);
    await autopilots.save(doc);
    return doc;
  }
  await autopilots.save(doc);
  void explain(doc, model, aiInputs);
  return doc;
}

function finish(doc: AutopilotRecord) {
  if (doc.status !== 'error') doc.status = 'done';
}

async function explain(doc: AutopilotRecord, model: AiModel, inputs: FieldInput[]) {
  try {
    const fields = Object.fromEntries(inputs.map((f, i) => [`action_${i + 1}`, f]));
    const out = await phraseFields('autopilot', model, fields, doc.lang);
    doc.actions.forEach((act, i) => {
      const p = out[`action_${i + 1}`];
      if (p) act.explanation = { text: p.text, source: p.source };
    });
    doc.stages.explanations = 'done';
  } catch (err) {
    doc.stages.explanations = 'error';
    logger.warn({ err: (err as Error).message, autopilot_id: doc._id }, 'autopilot explanations failed; templates kept');
  }
  emit(doc._id, { type: 'stage', stage: 'explanations', status: doc.stages.explanations });
  finish(doc);
  await autopilots.save(doc);
  emit(doc._id, { type: 'done', doc: autopilotView(doc) });
}

/** Records an accepted action on the autopilot document. */
export async function markAccepted(doc: AutopilotRecord, rank: number, decisionId: string) {
  doc.accepted = [...(doc.accepted ?? []), { rank, decision_id: decisionId }];
  await autopilots.save(doc);
}
