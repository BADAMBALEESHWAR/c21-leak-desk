import { Router } from 'express';
import { scenarioFor } from '../engine/analyze.js';
import { ah, notFound } from '../errors.js';
import { canSee, type AuthUser } from '../auth.js';
import { analyses, newId, scenarios } from '../repo.js';
import { ScenarioRequestSchema } from '../schema/orders.js';
import { ledgerOptionsOf, loadAnalysis } from './analyses.js';

export const scenariosRouter = Router();

/** A scenario is visible to whoever can see its analysis (signed-in accounts never see each other's). */
async function loadScenario(id: string, viewer?: AuthUser) {
  const s = await scenarios.get(id);
  const analysis = s ? await analyses.get(s.analysis_id) : null;
  if (!s || (analysis && !canSee(analysis.account, viewer))) throw notFound('Scenario', id);
  return s;
}

scenariosRouter.post(
  '/analyses/:id/scenarios',
  ah(async (req, res) => {
    const body = ScenarioRequestSchema.parse(req.body ?? {});
    const { analysis, dataset } = await loadAnalysis(req.params.id, req.user);
    const started = Date.now();
    const result = scenarioFor(dataset.rows, ledgerOptionsOf(analysis), body.overrides);
    const id = newId();
    const persisted = await scenarios.save({ _id: id, analysis_id: analysis._id, overrides: body.overrides, result, created_at: new Date() });
    req.log.info({ analysis_id: analysis._id, scenario_id: id, compute_ms: Date.now() - started, intervention: result.recommendation.intervention }, 'scenario computed');
    res.status(201).json({ scenario_id: id, analysis_id: analysis._id, persisted, observed: analysis.result.observed, ...result });
  }),
);

scenariosRouter.get(
  '/scenarios/:id',
  ah(async (req, res) => {
    const s = await loadScenario(req.params.id, req.user);
    res.json({ scenario_id: s._id, analysis_id: s.analysis_id, ...s.result });
  }),
);

/** 30-day test generator: a draft test and stop rule for the scenario's recommendation (template; AI optional). */
scenariosRouter.post(
  '/scenarios/:id/test-plan',
  ah(async (req, res) => {
    const s = await loadScenario(req.params.id, req.user);
    const r = s.result.recommendation;
    res.json({
      scenario_id: s._id,
      intervention: r.intervention,
      test_30d: r.test_30d_draft,
      stop_rule: r.stop_rule_draft,
      expected_delta_inr: r.expected_delta_inr,
      source: r.draft_source,
    });
  }),
);
