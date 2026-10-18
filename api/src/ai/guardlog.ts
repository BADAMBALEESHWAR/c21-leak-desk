import { dbState } from '../db.js';
import { logger } from '../logger.js';
import { AiCounterModel } from '../models/index.js';

// AI transparency (v2 §5.1): how many model calls were made, how many AI texts the number-grounding guard accepted
// and how many it rejected, per feature. In memory always; a single Mongo counter document ($inc) when connected.

export const AI_FEATURES = ['narration', 'autopilot', 'advisor', 'ask', 'digest'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];
export type AiEvent = 'call' | 'accepted' | 'rejected' | 'error';

interface Counts {
  calls: number;
  accepted: number;
  rejected: number;
  failed: number;
}
const zero = (): Counts => ({ calls: 0, accepted: 0, rejected: 0, failed: 0 });
const FIELD: Record<AiEvent, keyof Counts> = { call: 'calls', accepted: 'accepted', rejected: 'rejected', error: 'failed' };

const totals = zero();
const byFeature = Object.fromEntries(AI_FEATURES.map((f) => [f, zero()])) as Record<AiFeature, Counts>;
export const COUNTER_ID = 'global';

/** Counts one event (or n accepted/rejected texts). Never throws; the Mongo write is fire-and-forget. */
export function recordAi(feature: AiFeature, event: AiEvent, n = 1) {
  if (n <= 0) return;
  const field = FIELD[event];
  totals[field] += n;
  byFeature[feature][field] += n;
  if (dbState() === 'connected') {
    AiCounterModel.updateOne(
      { _id: COUNTER_ID },
      { $inc: { [field]: n, [`by_feature.${feature}.${field}`]: n }, $set: { updated_at: new Date() } },
      { upsert: true },
    ).catch((err: Error) => logger.warn({ err: err.message }, 'ai counter write failed'));
  }
}

export function aiCounts(): Counts & { by_feature: Record<AiFeature, Counts> } {
  return { ...totals, by_feature: Object.fromEntries(AI_FEATURES.map((f) => [f, { ...byFeature[f] }])) as Record<AiFeature, Counts> };
}

/** All-time counters from Mongo, or null without a database. */
export async function persistedCounts(): Promise<(Counts & { by_feature: Record<string, Partial<Counts>> }) | null> {
  if (dbState() !== 'connected') return null;
  const doc = (await AiCounterModel.findById(COUNTER_ID).lean().catch(() => null)) as (Partial<Counts> & { by_feature?: Record<string, Partial<Counts>> }) | null;
  if (!doc) return { ...zero(), by_feature: {} };
  return { calls: doc.calls ?? 0, accepted: doc.accepted ?? 0, rejected: doc.rejected ?? 0, failed: doc.failed ?? 0, by_feature: doc.by_feature ?? {} };
}

/** Test helper: start the in-memory counters from zero. */
export function resetAiCounts() {
  Object.assign(totals, zero());
  for (const f of AI_FEATURES) byFeature[f] = zero();
}

/**
 * Exactly which fields leave the API for each feature. Aggregates only: counts, rupee totals, labels, order and
 * product IDs; never a raw order row, a customer ID or a file. Each feature builds its model input from these keys.
 */
export const FIELDS_SENT: Record<AiFeature, string[]> = {
  narration: ['cause', 'count', 'lost_inr', 'order_ids', 'intervention', 'rule', 'expected_delta_inr', 'confidence', 'template'],
  autopilot: [
    'intervention',
    'label',
    'rule',
    'expected_delta_inr',
    'driving_orders',
    'confidence',
    'observed.return_rate_pct',
    'observed.recovery_pct',
    'observed.avg_return_cost_inr',
    'recovery_target_pct',
    'discount_cap_pct',
    'template',
  ],
  advisor: [
    'cause',
    'label',
    'orders',
    'inr_at_stake',
    'example_ids',
    'product_cost_inr',
    'recovered_inr',
    'refund_inr',
    'return_cost_inr',
    'discount_inr',
    'gross_inr',
    'shipping_inr',
    'payment_fee_inr',
    'missing_facts',
    'interventions[].label',
    'interventions[].expected_delta_inr',
    'interventions[].confidence',
    'observed.return_rate_pct',
    'observed.recovery_pct',
    'observed.avg_return_cost_inr',
    'template',
  ],
  ask: [
    'question',
    'tool.name',
    'tool.args',
    'tool result: leak groups (cause, label, count, lost_inr, example_ids)',
    'tool result: month rows (orders, net_sales_inr, contribution_inr, percentages)',
    'tool result: product rows (product_id, units, orders, net_sales_inr, contribution_inr, percentages, ranks)',
    'tool result: channel rows (channel, orders, net_sales_inr, contribution_inr, ads_inr, percentages)',
    'tool result: scenario totals (baseline, scenario and delta contribution, assumptions)',
    'template',
  ],
  digest: [
    'month',
    'previous_month',
    'orders',
    'net_sales_inr',
    'contribution_inr',
    'previous_contribution_inr',
    'contribution_change_pct',
    'leaks[].label',
    'leaks[].count',
    'leaks[].lost_inr',
    'decisions[].label',
    'decisions[].owner',
    'decisions[].expected_delta_inr',
    'decision_count',
    'recommendation.label',
    'recommendation.expected_delta_inr',
    'check.date',
    'check.label',
    'check.target_inr',
    'observed.return_rate_pct',
    'observed.recovery_pct',
    'observed.avg_return_cost_inr',
    'template',
  ],
};

export const REGION_NOTE =
  'Orders, analyses and decisions are stored in AWS ap-south-1 (Mumbai). Only the aggregate fields listed in fields_sent go to the Gemini API (Google); raw order rows never leave the API. With AI off, every text is the deterministic template.';
