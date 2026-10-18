import { Router } from 'express';
import { modelFor, phraseFields, type FieldInput } from '../ai/grounded.js';
import { langOf } from '../ai/localize.js';
import { inr, PHRASES } from '../ai/phrases.js';
import { interventionLabels, recommendationText } from '../ai/templates.js';
import { accountOf } from '../auth.js';
import { formatInr } from '../engine/format.js';
import { pulseOverview } from '../engine/pulse.js';
import { ah } from '../errors.js';
import { decisions } from '../repo.js';
import { loadAnalysis } from './analyses.js';

// Monthly digest (v2 §1.5): what changed, where money leaked, what was decided and what to check in 30 days, built
// from the Pulse, leak and decision JSON. Template text in the language; AI may reword it under the number guard.

export const digestRouter = Router();

const SECTION_KEYS = ['changed', 'leaked', 'decided', 'check'] as const;
export const BADGE_AI = 'AI summary · numbers from the engine';
export const BADGE_TEMPLATE = 'Summary · numbers from the engine';

const signed = (n: number | null) => (n === null ? null : n > 0 ? `+${formatInr(n)}` : formatInr(n));

digestRouter.get(
  '/analyses/:id/digest',
  ah(async (req, res) => {
    const lang = langOf(req, res);
    const p = PHRASES[lang];
    const money = (n: number | null | undefined) => inr(lang, n);
    const { analysis, dataset } = await loadAnalysis(req.params.id, req.user);
    const a = analysis.result;
    const labelOf = (key: string, fallback: string) => interventionLabels(lang).find((l) => l.intervention === key)?.label ?? fallback;

    // What changed: the latest month against the one before (Pulse overview).
    const o = pulseOverview(a);
    const h = o.headline;
    const prevMonth = o.month ? (o.months[o.months.indexOf(o.month) - 1] ?? null) : null;
    const changed: FieldInput = {
      data: {
        month: o.month,
        previous_month: prevMonth,
        orders: h?.orders ?? null,
        net_sales_inr: h?.net_sales_inr ?? null,
        contribution_inr: h?.contribution_inr ?? null,
        previous_contribution_inr: o.previous?.contribution_inr ?? null,
        contribution_change_pct: o.deltas?.contribution_pct ?? null,
      },
      template: !h || !o.month
        ? p.changedNone
        : o.previous && prevMonth
          ? p.changedPrev(o.month, p.orders(h.orders), money(h.net_sales_inr), money(h.contribution_inr), prevMonth, money(o.previous.contribution_inr))
          : p.changedOne(o.month, p.orders(h.orders), money(h.net_sales_inr), money(h.contribution_inr)),
    };

    // Where money leaked: the two largest leak groups.
    const top = a.leaks.slice(0, 2);
    const leaked: FieldInput = {
      data: { leaks: top.map((l) => ({ label: p.leakLabel(l.cause), count: l.count, lost_inr: l.lost_inr })) },
      template: top.length
        ? p.leaked(p.leakLabel(top[0].cause), p.orders(top[0].count), money(top[0].lost_inr)) + (top[1] ? p.leakedMore(p.leakLabel(top[1].cause), money(top[1].lost_inr)) : '')
        : p.leakedNone,
    };

    // What was decided: decisions saved on this analysis, newest first.
    const saved = (await decisions.list(accountOf(req.user))).filter((d) => d.analysis_id === analysis._id);
    const latest = saved[0];
    const rec = a.recommendation;
    const recLabel = labelOf(rec.intervention, rec.label);
    const decided: FieldInput = latest
      ? {
          data: { decisions: saved.slice(0, 3).map((d) => ({ label: labelOf(d.intervention, d.intervention_label), owner: d.owner, expected_delta_inr: d.expected_delta_inr })), decision_count: saved.length },
          template: p.decidedSome(saved.length, labelOf(latest.intervention, latest.intervention_label), latest.owner, signed(latest.expected_delta_inr) ?? p.unknown),
        }
      : { data: { decisions: [], recommendation: { label: recLabel, expected_delta_inr: rec.expected_delta_inr } }, template: p.decidedNone(recLabel, money(rec.expected_delta_inr)) };

    // What to check in 30 days: the latest decision's check-in, else the recommendation's 30-day test.
    const checkIn = latest?.check_in_30_days;
    const driving = a.candidates.find((c) => c.intervention === rec.intervention)?.driving_orders ?? 0;
    const check: FieldInput = checkIn
      ? {
          data: { check: { date: checkIn.date, label: labelOf(latest.intervention, latest.intervention_label), target_inr: checkIn.contribution_target_inr } },
          template: p.checkDecision(checkIn.date, labelOf(latest.intervention, latest.intervention_label), money(checkIn.contribution_target_inr)),
        }
      : {
          data: {
            recommendation: { label: recLabel, expected_delta_inr: rec.expected_delta_inr },
            observed: { return_rate_pct: a.observed.return_rate_pct, recovery_pct: a.observed.recovery_pct, avg_return_cost_inr: a.observed.avg_return_cost_inr },
          },
          template: recommendationText(lang, rec, a.observed, driving).test_30d_draft,
        };

    const out = await phraseFields('digest', modelFor(req, dataset), { changed, leaked, decided, check }, lang);
    const anyAi = SECTION_KEYS.some((k) => out[k].source === 'ai');
    res.json({
      analysis_id: analysis._id,
      sections: SECTION_KEYS.map((key) => ({ key, title: p.titles[key], text: out[key].text, source: out[key].source })),
      source: anyAi ? 'ai' : 'template',
      badge: anyAi ? BADGE_AI : BADGE_TEMPLATE,
      lang,
    });
  }),
);
