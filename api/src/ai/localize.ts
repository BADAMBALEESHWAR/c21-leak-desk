import type { Request, Response } from 'express';
import type { LedgerOptions } from '../engine/ledger.js';
import { runScenario } from '../engine/scenario.js';
import type { AnalysisResult, OrderRow, ScenarioResult } from '../engine/types.js';
import { describeLeak, describerFor, isLang, narratorFor, recommendationText, type Lang } from './templates.js';

// The engine stores English template text. A response in Hindi or Telugu re-renders the same templates in that
// language from the same inputs, so every number is identical; only the words change.

/** Highest-weighted supported language in an Accept-Language header; English when none matches. */
export function fromAcceptLanguage(header: string | undefined): Lang {
  if (!header) return 'en';
  const ranked = header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const q = qParam ? Number(qParam.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split('-')[0], q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  const hit = ranked.find((r) => isLang(r.lang));
  return hit ? (hit.lang as Lang) : 'en';
}

/** `?lang=` (en | hi | te) first, then Accept-Language; default en. Marks the response as varying by language. */
export function langOf(req: Request, res?: Response): Lang {
  res?.vary('Accept-Language');
  const q = typeof req.query.lang === 'string' ? req.query.lang.trim().toLowerCase().split('-')[0] : '';
  return isLang(q) ? q : fromAcceptLanguage(req.headers['accept-language']);
}

/** Leak and recommendation text of a stored analysis in `lang` (unchanged for English). */
export function localizeAnalysis(result: AnalysisResult, rows: OrderRow[], lang: Lang): Pick<AnalysisResult, 'leaks' | 'recommendation'> {
  if (lang === 'en') return { leaks: result.leaks, recommendation: result.recommendation };
  const describe = describerFor(lang);
  const byId = new Map(rows.map((r) => [r.order_id, r]));
  const leaks = result.leaks.map((l) =>
    l.why_source === 'template' ? { ...l, why: describe(l, l.order_ids.map((id) => byId.get(id)).filter((r): r is OrderRow => r !== undefined)) } : l,
  );
  const rec = result.recommendation;
  const driving = result.candidates.find((c) => c.intervention === rec.intervention)?.driving_orders ?? 0;
  const text = rec.why_source === 'template' ? recommendationText(lang, rec, result.observed, driving) : {};
  return { leaks, recommendation: { ...rec, ...text } };
}

/**
 * Recommendation text of a stored scenario in `lang`. The scenario's own observed values are not stored, so the
 * same scenario is re-run (pure and deterministic) with the language's templates.
 */
export function localizeScenario(result: ScenarioResult, rows: OrderRow[], opts: LedgerOptions, lang: Lang): Pick<ScenarioResult, 'recommendation'> {
  if (lang === 'en') return { recommendation: result.recommendation };
  const again = runScenario(rows, opts, result.overrides, describeLeak, narratorFor(lang));
  const r = again.recommendation;
  return { recommendation: { ...result.recommendation, why: r.why, test_30d_draft: r.test_30d_draft, stop_rule_draft: r.stop_rule_draft } };
}
