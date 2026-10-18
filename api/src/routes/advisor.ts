import { Router } from 'express';
import { z } from 'zod';
import { modelFor, phraseFields } from '../ai/grounded.js';
import { langOf } from '../ai/localize.js';
import { inr, PHRASES } from '../ai/phrases.js';
import { describerFor, interventionLabels, isLang, recommendationText, type Lang } from '../ai/templates.js';
import { CANDIDATE_OVERRIDES, candidateConfidence } from '../autopilot.js';
import { scenarioFor } from '../engine/analyze.js';
import type { AnalysisResult, Candidate, Confidence, LeakCause, LeakGroup, OrderRow } from '../engine/types.js';
import { ah, notFound } from '../errors.js';
import type { ScenarioOverrides } from '../schema/orders.js';
import { ledgerOptionsOf, loadAnalysis } from './analyses.js';
import { evidenceFor, type CandidateKey, type Evidence } from '../stats/evidence.js';

// Fix Advisor (v2 §1.2): for one leak cause, what is happening, the two or three interventions that address it (each
// with the engine's ₹ delta and confidence), and the 30-day test and stop rule. Template text first; AI may reword it.

export const advisorRouter = Router();

const LEAK_CAUSES = ['full_return_partial_recovery', 'refund_unknown', 'fees_exceed_margin', 'discount_exceeds_margin', 'other_negative'] as const;
const AdvisorRequestSchema = z.object({ cause: z.enum(LEAK_CAUSES), lang: z.string().optional() });

/** Engine candidates that address each cause, most relevant first (refund_unknown is handled by its own options). */
const CAUSE_CANDIDATES: Record<LeakCause, Candidate['intervention'][]> = {
  full_return_partial_recovery: ['raise_recovery_via_inspection', 'charge_return_shipping'],
  discount_exceeds_margin: ['cap_discount'],
  fees_exceed_margin: ['add_handling_to_price'],
  refund_unknown: [],
  other_negative: [],
};
/** "Shipping change" for fees: shipping negotiated 10% below the observed average (a stated assumption). */
export const SHIPPING_CHANGE_SHARE = 0.9;

export interface AdvisorIntervention {
  candidate_id: string;
  intervention: string;
  label: string;
  overrides: ScenarioOverrides | null;
  expected_delta_inr: number | null;
  confidence: Confidence;
  /** Bootstrap range and level for engine candidates; absent for assumption-only scenarios. */
  evidence?: Evidence;
}

const sum = (rows: OrderRow[], f: (r: OrderRow) => number | null) => rows.reduce((s, r) => s + (f(r) ?? 0), 0);

/** The engine's numbers behind one leak group: counts, ₹ at stake and the input totals its template quotes. */
export function leakFacts(leak: Omit<LeakGroup, 'why' | 'why_source'>, rows: OrderRow[]): Record<string, unknown> {
  const base = { orders: leak.count, inr_at_stake: leak.lost_inr, example_ids: leak.example_ids };
  switch (leak.cause) {
    case 'full_return_partial_recovery':
    case 'other_negative':
      return {
        ...base,
        product_cost_inr: sum(rows, (r) => r.product_cost_inr),
        recovered_inr: sum(rows, (r) => r.recovered_product_cost_inr),
        refund_inr: sum(rows, (r) => r.refund_inr),
        return_cost_inr: sum(rows, (r) => r.return_cost_inr),
      };
    case 'discount_exceeds_margin':
      return { ...base, discount_inr: sum(rows, (r) => r.discount_inr), gross_inr: sum(rows, (r) => r.gross_inr) };
    case 'fees_exceed_margin':
      return { ...base, shipping_inr: sum(rows, (r) => r.shipping_inr), payment_fee_inr: sum(rows, (r) => r.payment_fee_inr) };
    case 'refund_unknown':
      return {
        ...base,
        missing_facts: {
          refund_inr: rows.filter((r) => r.refund_inr === null).length,
          recovered_product_cost_inr: rows.filter((r) => r.recovered_product_cost_inr === null).length,
          return_cost_inr: rows.filter((r) => r.return_cost_inr === null).length,
        },
      };
  }
}

/** Interventions for a cause: engine candidates filtered by cause, override scenarios where the cause calls for one. */
export function interventionsFor(cause: LeakCause, a: AnalysisResult, rows: OrderRow[], opts: ReturnType<typeof ledgerOptionsOf>, lang: Lang, evidence?: Record<CandidateKey, Evidence>): AdvisorIntervention[] {
  const p = PHRASES[lang];
  const labels = new Map(interventionLabels(lang).map((l) => [l.intervention, l.label]));
  const fromCandidate = (c: Candidate): AdvisorIntervention => ({
    candidate_id: c.intervention,
    intervention: c.intervention,
    label: labels.get(c.intervention) ?? c.label,
    overrides: CANDIDATE_OVERRIDES[c.intervention],
    expected_delta_inr: c.delta_inr,
    confidence: candidateConfidence(a, c),
    ...(evidence ? { evidence: evidence[c.intervention] } : {}),
  });
  const scenario = (candidate_id: string, label: string, overrides: ScenarioOverrides): AdvisorIntervention => {
    const s = scenarioFor(rows, opts, overrides);
    return { candidate_id, intervention: candidate_id, label, overrides, expected_delta_inr: s.delta.contribution_inr, confidence: s.scenario.unknown > 0 ? 'unknown' : 'low' };
  };

  const out: AdvisorIntervention[] = [];
  for (const key of CAUSE_CANDIDATES[cause]) {
    const c = a.candidates.find((x) => x.intervention === key);
    if (c) out.push(fromCandidate(c));
  }
  if (cause === 'fees_exceed_margin' && a.observed.avg_shipping_inr) {
    const rate = Math.round(a.observed.avg_shipping_inr * SHIPPING_CHANGE_SHARE);
    out.push(scenario('shipping_change', p.shippingChange(inr(lang, rate)), { shipping_inr: rate }));
  }
  if (cause === 'refund_unknown') {
    out.push({ candidate_id: 'record_facts', intervention: 'record_facts', label: p.recordFacts, overrides: null, expected_delta_inr: null, confidence: 'unknown' });
    out.push(scenario('assume_unknown_refund', p.assumeUnknown, { assume_unknown_refund: true }));
  }
  // Two at least, three at most: fill with the best remaining candidates overall.
  const target = out.length >= 2 ? out.length : cause === 'other_negative' ? 3 : 2;
  for (const c of [...a.candidates].sort((x, y) => y.delta_inr - x.delta_inr)) {
    if (out.length >= Math.min(3, target)) break;
    if (!out.some((o) => o.candidate_id === c.intervention)) out.push(fromCandidate(c));
  }
  return out.slice(0, 3);
}

advisorRouter.post(
  '/analyses/:id/advisor',
  ah(async (req, res) => {
    const body = AdvisorRequestSchema.parse(req.body ?? {});
    const lang = isLang(body.lang) ? body.lang : langOf(req, res);
    const { analysis, dataset } = await loadAnalysis(req.params.id, req.user);
    const a = analysis.result;
    const leak = a.leaks.find((l) => l.cause === body.cause);
    if (!leak) throw notFound('Leak cause', body.cause);
    const byId = new Map(dataset.rows.map((r) => [r.order_id, r]));
    const rows = leak.order_ids.map((id) => byId.get(id)).filter((r): r is OrderRow => r !== undefined);
    const { why: _why, why_source: _ws, ...group } = leak;
    const facts = leakFacts(group, rows);
    const label = PHRASES[lang].leakLabel(leak.cause);
    const interventions = interventionsFor(leak.cause, a, dataset.rows, ledgerOptionsOf(analysis), lang, evidenceFor(analysis._id, dataset.rows, ledgerOptionsOf(analysis)));

    // The 30-day test and stop rule for the first intervention.
    const first = interventions[0];
    const candidate = a.candidates.find((c) => c.intervention === first?.intervention);
    let test: string;
    let stop: string;
    if (candidate) {
      const t = recommendationText(lang, { intervention: candidate.intervention, expected_delta_inr: candidate.delta_inr }, a.observed, candidate.driving_orders);
      test = t.test_30d_draft;
      stop = t.stop_rule_draft;
    } else if (first?.candidate_id === 'record_facts') {
      test = PHRASES[lang].testRecordFacts(PHRASES[lang].orders(leak.count));
      stop = PHRASES[lang].stopRecordFacts;
    } else {
      const t = recommendationText(lang, { intervention: 'none', expected_delta_inr: 0 }, a.observed, 0);
      test = t.test_30d_draft;
      stop = t.stop_rule_draft;
    }

    // Model input: exactly the fields listed in FIELDS_SENT.advisor.
    const observed = { return_rate_pct: a.observed.return_rate_pct, recovery_pct: a.observed.recovery_pct, avg_return_cost_inr: a.observed.avg_return_cost_inr };
    const ivData = interventions.map((i) => ({ label: i.label, expected_delta_inr: i.expected_delta_inr, confidence: i.confidence }));
    const model = modelFor(req, dataset);
    const text = await phraseFields(
      'advisor',
      model,
      {
        summary: { data: { cause: leak.cause, label, ...facts }, template: describerFor(lang)(group, rows) },
        test_30d: { data: { interventions: ivData.slice(0, 1), observed }, template: test },
        stop_rule: { data: { interventions: ivData.slice(0, 1), observed }, template: stop },
      },
      lang,
    );
    const src = (p: { text: string; source: 'ai' | 'template' }) => ({ text: p.text, source: p.source });
    res.json({
      analysis_id: analysis._id,
      cause: leak.cause,
      label,
      summary: src(text.summary),
      facts,
      interventions,
      test_30d: src(text.test_30d),
      stop_rule: src(text.stop_rule),
      lang,
    });
  }),
);
