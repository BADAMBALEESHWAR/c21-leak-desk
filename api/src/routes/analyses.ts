import { Router } from 'express';
import { aiStatus, MAX_CALLS_PER_ANALYSIS, narrate } from '../ai/client.js';
import { analyze } from '../engine/analyze.js';
import { ah, notFound } from '../errors.js';
import { analyses, datasets, newId, type AnalysisRecord, type DatasetRecord } from '../repo.js';
import { AnalysisRequestSchema } from '../schema/orders.js';

export const analysesRouter = Router();

export async function loadAnalysis(id: string): Promise<{ analysis: AnalysisRecord; dataset: DatasetRecord }> {
  const analysis = await analyses.get(id);
  if (!analysis) throw notFound('Analysis', id);
  const dataset = await datasets.get(analysis.dataset_id);
  if (!dataset) throw notFound('Dataset', analysis.dataset_id);
  return { analysis, dataset };
}

/** The options an analysis was computed with, so scenarios and decisions re-run it exactly. */
export const ledgerOptionsOf = (a: AnalysisRecord) => ({
  attribution: a.result.attribution,
  period_end: a.period_end,
  handling_default_inr: a.config.handling_default_inr,
  ...(a.channel_spend ? { channel_spend: a.channel_spend } : {}),
});

const view = (a: AnalysisRecord, persisted?: boolean) => ({
  analysis_id: a._id,
  dataset_id: a.dataset_id,
  ...(persisted === undefined ? {} : { persisted }),
  ...a.result,
});

analysesRouter.post(
  '/datasets/:id/analyses',
  ah(async (req, res) => {
    const body = AnalysisRequestSchema.parse(req.body ?? {});
    const dataset = await datasets.get(req.params.id);
    if (!dataset) throw notFound('Dataset', req.params.id);
    const started = Date.now();
    const result = analyze(dataset.rows, {
      attribution: body.attribution,
      period_end: body.period_end ?? dataset.period_end,
      handling_default_inr: body.config.handling_default_inr ?? body.config.handling_inr,
      channel_spend: body.channel_spend,
    });
    const record: AnalysisRecord = {
      _id: newId(),
      dataset_id: dataset._id,
      engine_version: result.engine_version,
      attribution: result.attribution,
      period_end: result.period_end,
      config: result.config,
      ...(body.channel_spend ? { channel_spend: body.channel_spend } : {}),
      result,
      created_at: new Date(),
    };
    const persisted = await analyses.save(record);
    req.log.info({ dataset_id: dataset._id, analysis_id: record._id, compute_ms: Date.now() - started, reconciled: result.reconciliation.ok }, 'analysis computed');
    res.status(201).json(view(record, persisted));
  }),
);

analysesRouter.get(
  '/analyses/:id',
  ah(async (req, res) => {
    const { analysis } = await loadAnalysis(req.params.id);
    res.json(view(analysis));
  }),
);

/** One order: the raw row, the computed order and its labelled waterfall. */
analysesRouter.get(
  '/analyses/:id/orders/:order_id',
  ah(async (req, res) => {
    const { analysis, dataset } = await loadAnalysis(req.params.id);
    const computed = analysis.result.orders.find((o) => o.order_id === req.params.order_id);
    if (!computed) throw notFound('Order', req.params.order_id);
    res.json({
      row: dataset.rows.find((r) => r.order_id === req.params.order_id) ?? null,
      computed,
      waterfall: computed.lines.map((l) => ({ label: l.label, inr: l.amount_inr, ...(l.note ? { note: l.note } : {}) })),
      status: computed.status,
      flags: dataset.flags.filter((f) => f.order_id === req.params.order_id),
    });
  }),
);

/** Optional AI rewording, off the critical path: the UI shows template text first and swaps in "ai" text if it arrives. */
analysesRouter.post(
  '/analyses/:id/narrate',
  ah(async (req, res) => {
    const { analysis } = await loadAnalysis(req.params.id);
    const a = analysis.result;
    const leaks = await Promise.all(
      a.leaks.slice(0, MAX_CALLS_PER_ANALYSIS - 1).map(async (l) => {
        const n = await narrate({ kind: 'leak', data: { cause: l.cause, count: l.count, lost_inr: l.lost_inr, order_ids: l.order_ids }, template: l.why });
        return { cause: l.cause, why: n.text, why_source: n.source, reason: n.reason };
      }),
    );
    const r = a.recommendation;
    const rec = await narrate({
      kind: 'recommendation',
      data: { intervention: r.intervention, rule: r.rule, expected_delta_inr: r.expected_delta_inr, confidence: r.confidence },
      template: r.why,
    });
    res.json({ ai: aiStatus(), leaks, recommendation: { why: rec.text, why_source: rec.source, reason: rec.reason } });
  }),
);
