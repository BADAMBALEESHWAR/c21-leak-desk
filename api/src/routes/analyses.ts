import { Router } from 'express';
import { aiStatus, MAX_CALLS_PER_ANALYSIS, narrate } from '../ai/client.js';
import { aiPolicy } from '../ai/grounded.js';
import { evidenceFor } from '../stats/evidence.js';
import { langOf, localizeAnalysis } from '../ai/localize.js';
import type { Lang } from '../ai/templates.js';
import { analyze } from '../engine/analyze.js';
import { computeMargins, type Margins } from '../engine/margins.js';
import type { AnalysisResult, GroupRow, OrderResult, OrderRow } from '../engine/types.js';
import { canSee, accountOf, type AuthUser } from '../auth.js';
import { ah, notFound } from '../errors.js';
import { ledgerCsv } from '../export/csv.js';
import { analyses, datasets, newId, type AnalysisRecord, type DatasetRecord } from '../repo.js';
import { AnalysisRequestSchema } from '../schema/orders.js';

export const analysesRouter = Router();

export async function loadAnalysis(id: string, viewer?: AuthUser): Promise<{ analysis: AnalysisRecord; dataset: DatasetRecord }> {
  const analysis = await analyses.get(id);
  if (!analysis || !canSee(analysis.account, viewer)) throw notFound('Analysis', id);
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

/**
 * What POST /datasets/:id/analyses runs for a request body: parse it, then analyse the rows.
 * Throws exactly what the route turns into an error response (422 schema_invalid, 409 attribution_conflict).
 * /checks calls it directly to prove the conflict is refused.
 */
export function runAnalysisRequest(rows: OrderRow[], datasetPeriodEnd: string, rawBody: unknown) {
  const body = AnalysisRequestSchema.parse(rawBody ?? {});
  const result = analyze(rows, {
    attribution: body.attribution,
    period_end: body.period_end ?? datasetPeriodEnd,
    handling_default_inr: body.config.handling_default_inr ?? body.config.handling_inr,
    channel_spend: body.channel_spend,
  });
  return { body, result };
}

function byKey(orders: OrderResult[], keyOf: (o: OrderResult) => string): Map<string, OrderResult[]> {
  const m = new Map<string, OrderResult[]>();
  for (const o of orders) {
    const k = keyOf(o);
    const list = m.get(k);
    if (list) list.push(o);
    else m.set(k, [o]);
  }
  return m;
}

/**
 * Unit economics for the whole analysis and for each channel and product row, computed on the fly from the stored
 * orders (the stored engine result keeps its shape). Channel rows use their channel spend in channel mode; product
 * rows are before channel spend in channel mode, as the product table is.
 */
export function marginsFor(result: AnalysisResult): {
  margins: Margins;
  groups: AnalysisResult['groups'] & { channel: Array<GroupRow & { margins: Margins }>; product: Array<GroupRow & { margins: Margins }> };
} {
  const mode = result.attribution;
  const channels = byKey(result.orders, (o) => o.channel);
  const products = byKey(result.orders, (o) => o.product_id);
  return {
    margins: computeMargins(result.orders, mode, mode === 'channel' ? result.totals.channel_spend_inr : 0),
    groups: {
      ...result.groups,
      channel: result.groups.channel.map((g) => ({ ...g, margins: computeMargins(channels.get(g.key) ?? [], mode, mode === 'channel' ? g.channel_spend_inr : 0) })),
      product: result.groups.product.map((g) => ({ ...g, margins: computeMargins(products.get(g.key) ?? [], mode, 0) })),
    },
  };
}

/** Bootstrap evidence per candidate fix; never allowed to break an analysis response. */
const evidenceOf = (a: AnalysisRecord, rows: OrderRow[]) => {
  try {
    return evidenceFor(a._id, rows, ledgerOptionsOf(a));
  } catch {
    return undefined;
  }
};

const view = (a: AnalysisRecord, rows: OrderRow[], lang: Lang, persisted?: boolean) => ({
  analysis_id: a._id,
  dataset_id: a.dataset_id,
  ...(persisted === undefined ? {} : { persisted }),
  ...a.result,
  ...marginsFor(a.result),
  evidence: evidenceOf(a, rows),
  ...localizeAnalysis(a.result, rows, lang),
  lang,
});

analysesRouter.post(
  '/datasets/:id/analyses',
  ah(async (req, res) => {
    const lang = langOf(req, res);
    const dataset = await datasets.get(req.params.id);
    if (!dataset || !canSee(dataset.account, req.user)) throw notFound('Dataset', req.params.id);
    const started = Date.now();
    const { body, result } = runAnalysisRequest(dataset.rows, dataset.period_end, req.body);
    const record: AnalysisRecord = {
      _id: newId(),
      account: accountOf(req.user),
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
    res.status(201).json(view(record, dataset.rows, lang, persisted));
  }),
);

analysesRouter.get(
  '/analyses/:id',
  ah(async (req, res) => {
    const lang = langOf(req, res);
    const { analysis, dataset } = await loadAnalysis(req.params.id, req.user);
    res.json(view(analysis, dataset.rows, lang));
  }),
);

/** Per-order ledger as a file: CSV for spreadsheets, JSON for tools. */
analysesRouter.get(
  '/analyses/:id/export',
  ah(async (req, res) => {
    const lang = langOf(req, res);
    const { analysis, dataset } = await loadAnalysis(req.params.id, req.user);
    const format = req.query.format === 'json' ? 'json' : 'csv';
    res.setHeader('Content-Disposition', `attachment; filename="ledger-${analysis._id}.${format}"`);
    if (format === 'json') res.type('application/json').send(JSON.stringify(view(analysis, dataset.rows, lang), null, 2));
    else res.type('text/csv; charset=utf-8').send(ledgerCsv(analysis.result));
  }),
);

/** One order: the raw row, the computed order and its labelled waterfall. */
analysesRouter.get(
  '/analyses/:id/orders/:order_id',
  ah(async (req, res) => {
    const { analysis, dataset } = await loadAnalysis(req.params.id, req.user);
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
    const lang = langOf(req, res);
    const { analysis, dataset } = await loadAnalysis(req.params.id, req.user);
    const a = analysis.result;
    const text = localizeAnalysis(a, dataset.rows, lang);
    // Per-request AI switch (X-Profyn-AI: off, consent, demo-data default): null = template text only.
    const client = aiPolicy(req, dataset).allowed ? undefined : null;
    const leaks = await Promise.all(
      text.leaks.slice(0, MAX_CALLS_PER_ANALYSIS - 1).map(async (l) => {
        const n = await narrate({ kind: 'leak', data: { cause: l.cause, count: l.count, lost_inr: l.lost_inr, order_ids: l.order_ids }, template: l.why, lang }, client);
        return { cause: l.cause, why: n.text, why_source: n.source, reason: n.reason };
      }),
    );
    const r = text.recommendation;
    const rec = await narrate({
      kind: 'recommendation',
      data: { intervention: r.intervention, rule: r.rule, expected_delta_inr: r.expected_delta_inr, confidence: r.confidence },
      template: r.why,
      lang,
    }, client);
    res.json({ ai: aiStatus(), lang, leaks, recommendation: { why: rec.text, why_source: rec.source, reason: rec.reason } });
  }),
);
