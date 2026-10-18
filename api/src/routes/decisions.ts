import { Router, type Request } from 'express';
import { workedOrder } from '../checks.js';
import { INTERVENTIONS } from '../engine/scenario.js';
import { ENGINE_VERSION, type InterventionKey } from '../engine/types.js';
import { canSee, accountOf, type AuthSettings } from '../auth.js';
import { ah, HttpError, notFound } from '../errors.js';
import { assumedInputsFor, checkInFor, decisionExport, startingStateFor } from '../export/decision.js';
import { decisionMarkdown } from '../export/markdown.js';
import { decisions, newId, scenarios, type DecisionRecord } from '../repo.js';
import { DecisionRequestSchema } from '../schema/orders.js';
import { put } from '../storage.js';
import { ledgerOptionsOf, loadAnalysis, marginsFor } from './analyses.js';
import { evidenceFor } from '../stats/evidence.js';

export const decisionsRouter = Router();

/**
 * What POST /analyses/:id/decisions saves and returns; Autopilot's accept reuses it. `opts.confidence` (internal only,
 * never from a request body) records the confidence the caller showed for a candidate that is not the recommendation.
 */
export async function createDecision(req: Request, analysisId: string, rawBody: unknown, opts: { confidence?: string } = {}) {
  const body = DecisionRequestSchema.parse(rawBody ?? {});
  const { analysis, dataset } = await loadAnalysis(analysisId, req.user);
  const scenario = body.scenario_id ? await scenarios.get(body.scenario_id) : null;
  if (body.scenario_id && !scenario) throw notFound('Scenario', body.scenario_id);
  if (scenario && scenario.analysis_id !== analysis._id) {
    throw new HttpError(422, 'schema_invalid', 'scenario_id belongs to a different analysis.', { path: 'scenario_id' });
  }
  const a = analysis.result;
  const rec = scenario?.result.recommendation ?? a.recommendation;
  const known = body.intervention in INTERVENTIONS;
  // At the observed baseline a saved fix carries its statistical confidence (bootstrap over the owner's orders), not the engine's "unknown".
  const evidence = !scenario && known && body.intervention !== 'none' ? evidenceFor(analysis._id, dataset.rows, ledgerOptionsOf(analysis))[body.intervention as keyof ReturnType<typeof evidenceFor>] : undefined;

  // The server owns the snapshot so a decision can be re-run exactly (R13 note, §7).
  const assumptions: Record<string, unknown> = {
    dataset_id: dataset._id,
    dataset_source: dataset.source,
    attribution: a.attribution,
    period_end: a.period_end,
    handling_default_inr: a.config.handling_default_inr,
    scenario_id: scenario?._id ?? null,
    changed: scenario?.result.changed ?? 'none (baseline)',
    overrides: scenario?.overrides ?? {},
    observed_return_rate_pct: a.observed.return_rate_pct,
    observed_recovery_pct: a.observed.recovery_pct,
    engine_version: ENGINE_VERSION,
    ...(scenario ? { scenario_notes: scenario.result.assumptions } : {}),
    ...(body.fixed_costs_inr !== undefined ? { fixed_costs_inr: body.fixed_costs_inr } : {}),
    ...(body.assumptions ? { client_notes: body.assumptions } : {}),
  };
  const savedAt = new Date();

  const w = await workedOrder();
  const record: DecisionRecord = {
    _id: newId(),
    account: accountOf(req.user),
    analysis_id: analysis._id,
    ...(scenario ? { scenario_id: scenario._id } : {}),
    intervention: body.intervention,
    intervention_label: known ? INTERVENTIONS[body.intervention as InterventionKey].label : body.intervention,
    ...(body.notes ? { notes: body.notes } : {}),
    assumptions,
    expected_delta_inr: body.expected_delta_inr,
    confidence: evidence?.level ?? opts.confidence ?? (rec.intervention === body.intervention ? rec.confidence : known ? 'low' : 'custom'),
    test_30d: body.test_30d,
    stop_rule: body.stop_rule,
    owner: body.owner,
    engine_version: ENGINE_VERSION,
    evidence: {
      dataset_source: dataset.source,
      totals: a.totals,
      reconciliation: a.reconciliation,
      leaks: a.leaks.map((l) => ({ cause: l.cause, label: l.label, count: l.count, lost_inr: l.lost_inr, example_ids: l.example_ids })),
      observed: a.observed,
      scenario: scenario
        ? { changed: scenario.result.changed, baseline_inr: scenario.result.baseline.contribution_inr, scenario_inr: scenario.result.scenario.contribution_inr, delta_inr: scenario.result.delta.contribution_inr }
        : null,
      checks: {
        check1: { value: w.contribution_inr, expected: w.expected_contribution_inr, pass: w.matches },
        check2: { orders_inr: a.reconciliation.orders_inr, channels_inr: a.reconciliation.channels_inr, products_inr: a.reconciliation.products_inr, ok: a.reconciliation.ok, attribution: a.attribution },
        check3: { unknown_orders: a.totals.unknown_count, confidence: rec.confidence },
      },
    },
    ...(body.fixed_costs_inr !== undefined ? { fixed_costs_inr: body.fixed_costs_inr } : {}),
    starting_state: startingStateFor(a, dataset.source, marginsFor(a).margins, body.fixed_costs_inr),
    check_in_30_days: checkInFor(body.intervention, a, body.expected_delta_inr, savedAt, scenario ? scenario.result.scenario.contribution_inr : undefined),
    assumed_inputs: assumedInputsFor(a, scenario?.overrides ?? null, body.fixed_costs_inr),
    saved_at: savedAt,
  };
  // With sign-in on, a guest's decision is in the demo workspace; it is saved like any other, under account "guest".
  const demoWorkspace = (req.app.locals.auth as AuthSettings).enabled && !req.user;
  const persisted = await decisions.save(record);
  await put(`exports/decision-${record._id}.md`, decisionMarkdown(record), 'text/markdown').catch(() => undefined);
  req.log.info({ analysis_id: analysis._id, decision_id: record._id, persisted }, 'decision saved');
  return {
    decision_id: record._id,
    saved_at: record.saved_at,
    assumptions,
    engine_version: ENGINE_VERSION,
    persisted,
    workspace: demoWorkspace ? 'demo' : req.user ? 'account' : 'shared',
    check_in_30_days: record.check_in_30_days,
    assumed_inputs: record.assumed_inputs,
    export_url: `/api/v1/decisions/${record._id}/export?format=json`,
  };
}

decisionsRouter.post(
  '/analyses/:id/decisions',
  ah(async (req, res) => {
    res.status(201).json(await createDecision(req, req.params.id, req.body));
  }),
);

const summary = (d: DecisionRecord) => ({
  decision_id: d._id,
  analysis_id: d.analysis_id,
  intervention: d.intervention,
  intervention_label: d.intervention_label,
  expected_delta_inr: d.expected_delta_inr,
  confidence: d.confidence,
  owner: d.owner,
  saved_at: d.saved_at,
});

decisionsRouter.get(
  '/decisions',
  ah(async (req, res) => {
    res.json((await decisions.list(accountOf(req.user))).map(summary));
  }),
);

decisionsRouter.get(
  '/decisions/:id',
  ah(async (req, res) => {
    const d = await decisions.get(req.params.id);
    if (!d || !canSee(d.account, req.user)) throw notFound('Decision', req.params.id);
    const { _id, ...rest } = d;
    res.json({ decision_id: _id, ...rest });
  }),
);

decisionsRouter.get(
  '/decisions/:id/export',
  ah(async (req, res) => {
    const d = await decisions.get(req.params.id);
    if (!d || !canSee(d.account, req.user)) throw notFound('Decision', req.params.id);
    const format = req.query.format === 'json' ? 'json' : 'md';
    res.setHeader('Content-Disposition', `attachment; filename="decision-${d._id}.${format}"`);
    if (format === 'json') {
      res.type('application/json').send(JSON.stringify(decisionExport(d), null, 2));
    } else {
      res.type('text/markdown; charset=utf-8').send(decisionMarkdown(d));
    }
  }),
);
