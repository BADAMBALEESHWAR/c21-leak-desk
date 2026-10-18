import { Router } from 'express';
import { langOf, localizeScenario } from '../ai/localize.js';
import type { Lang } from '../ai/templates.js';
import { scenarioFor } from '../engine/analyze.js';
import { marginsFromParts, type Margins } from '../engine/margins.js';
import type { ScenarioColumn, ScenarioResult } from '../engine/types.js';
import { ah, notFound } from '../errors.js';
import { canSee, type AuthUser } from '../auth.js';
import { analyses, newId, scenarios, type ScenarioRecord } from '../repo.js';
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

const columnMargins = (c: ScenarioColumn): Margins =>
  marginsFromParts(
    {
      net_revenue_inr: c.net_sales_inr,
      net_product_cost_inr: c.net_product_cost_inr,
      shipping_inr: c.shipping_inr,
      payment_fee_inr: c.payment_fee_inr,
      return_cost_inr: c.return_cost_inr,
      handling_inr: c.handling_inr,
      ads_inr: c.ads_inr,
      contribution_inr: c.contribution_inr,
    },
    c.computed,
    c.unknown,
  );

/** CM1–CM3 for the observed baseline and the assumed scenario columns. */
export const scenarioMargins = (r: ScenarioResult) => ({ baseline: columnMargins(r.baseline), scenario: columnMargins(r.scenario) });

/**
 * The scenario's recommendation text in the requested language. English is stored; another language re-runs the same
 * scenario. If its analysis is no longer available, the stored English text is returned with lang "en".
 */
async function localized(s: ScenarioRecord, lang: Lang, viewer?: AuthUser): Promise<{ recommendation: ScenarioResult['recommendation']; lang: Lang }> {
  if (lang === 'en') return { recommendation: s.result.recommendation, lang };
  const loaded = await loadAnalysis(s.analysis_id, viewer).catch(() => null);
  if (!loaded) return { recommendation: s.result.recommendation, lang: 'en' };
  return { ...localizeScenario(s.result, loaded.dataset.rows, ledgerOptionsOf(loaded.analysis), lang), lang };
}

scenariosRouter.post(
  '/analyses/:id/scenarios',
  ah(async (req, res) => {
    const lang = langOf(req, res);
    const body = ScenarioRequestSchema.parse(req.body ?? {});
    const { analysis, dataset } = await loadAnalysis(req.params.id, req.user);
    const started = Date.now();
    const opts = ledgerOptionsOf(analysis);
    const result = scenarioFor(dataset.rows, opts, body.overrides);
    const id = newId();
    const persisted = await scenarios.save({ _id: id, analysis_id: analysis._id, overrides: body.overrides, result, created_at: new Date() });
    req.log.info({ analysis_id: analysis._id, scenario_id: id, compute_ms: Date.now() - started, intervention: result.recommendation.intervention }, 'scenario computed');
    res.status(201).json({
      scenario_id: id,
      analysis_id: analysis._id,
      persisted,
      observed: analysis.result.observed,
      ...result,
      margins: scenarioMargins(result),
      ...localizeScenario(result, dataset.rows, opts, lang),
      lang,
    });
  }),
);

scenariosRouter.get(
  '/scenarios/:id',
  ah(async (req, res) => {
    const lang = langOf(req, res);
    const s = await loadScenario(req.params.id, req.user);
    res.json({ scenario_id: s._id, analysis_id: s.analysis_id, ...s.result, margins: scenarioMargins(s.result), ...(await localized(s, lang, req.user)) });
  }),
);

/** 30-day test generator: a draft test and stop rule for the scenario's recommendation (template; AI optional). */
scenariosRouter.post(
  '/scenarios/:id/test-plan',
  ah(async (req, res) => {
    const lang = langOf(req, res);
    const s = await loadScenario(req.params.id, req.user);
    const text = await localized(s, lang, req.user);
    const r = text.recommendation;
    res.json({
      scenario_id: s._id,
      intervention: r.intervention,
      test_30d: r.test_30d_draft,
      stop_rule: r.stop_rule_draft,
      expected_delta_inr: r.expected_delta_inr,
      source: r.draft_source,
      lang: text.lang,
    });
  }),
);

