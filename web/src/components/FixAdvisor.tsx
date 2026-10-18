import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, isNotFound, toErrorInfo, type ErrorInfo } from '../api/client';
import type { Advisor, AdvisorIntervention, AnalysisResponse, DecisionSaved, ScenarioResponse } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatCount, formatInr } from '../lib/format';
import { LEAK_LABELS } from '../lib/labels';
import { hrefFor } from '../lib/router';
import { isRunnable, useStore, type NarrationState } from '../state/store';
import { AiBadge } from './AiBadge';
import { ConfidenceBadge, Pill } from './Badge';
import { Button, ButtonLink } from './Button';
import { Drawer } from './Drawer';
import { Icon } from './Icon';
import { Money } from './Money';
import { Provenance } from './Provenance';
import { ErrorCallout, Skeleton } from './ui';

/** Which engine candidates answer which leak cause, for servers without the advisor endpoint. */
const CAUSE_FIXES: Record<string, string[]> = {
  full_return_partial_recovery: ['raise_recovery_via_inspection', 'charge_return_shipping'],
  discount_exceeds_margin: ['cap_discount'],
  fees_exceed_margin: ['add_handling_to_price'],
  refund_unknown: [],
  other_negative: [],
};

/** The advisor from the analysis alone: the leak's own explanation, the matching candidates and the drafted test. */
export function advisorFromAnalysis(a: AnalysisResponse, cause: string, narration: NarrationState | null, assumeLabel: string): Advisor | null {
  const g = a.leaks.find((l) => l.cause === cause);
  if (!g) return null;
  const ai = narration?.leaks[g.cause];
  const rec = a.recommendation;
  const related = CAUSE_FIXES[cause] ?? [];
  let cands = a.candidates.filter((c) => related.includes(c.intervention));
  if (cands.length === 0 && cause !== 'refund_unknown') cands = [...a.candidates].sort((x, y) => y.delta_inr - x.delta_inr);
  const interventions: AdvisorIntervention[] = cands.slice(0, 3).map((c) => ({
    candidate_id: c.intervention,
    intervention: c.intervention,
    label: c.label,
    overrides: null,
    expected_delta_inr: c.delta_inr,
    confidence: c.intervention === rec.intervention ? rec.confidence : null,
  }));
  if (cause === 'refund_unknown') {
    interventions.push({
      candidate_id: 'assume_unknown_refund',
      intervention: 'assume_unknown_refund',
      label: assumeLabel,
      overrides: { assume_unknown_refund: true },
      expected_delta_inr: null,
      confidence: 'unknown',
    });
  }
  const recMatches = interventions.some((i) => i.intervention === rec.intervention);
  return {
    cause,
    label: g.label || LEAK_LABELS[g.cause],
    summary: ai && ai.why_source === 'ai' ? { text: ai.why, source: 'ai' } : { text: g.why, source: g.why_source },
    facts: [],
    interventions,
    test_30d: recMatches && rec.test_30d_draft ? { text: rec.test_30d_draft, source: rec.draft_source } : null,
    stop_rule: recMatches && rec.stop_rule_draft ? { text: rec.stop_rule_draft, source: rec.draft_source } : null,
  };
}

/** Facts arrive as sentences, label/value pairs or a plain object; each becomes one line. */
export function factLines(f: unknown): Array<[string | null, string]> {
  if (Array.isArray(f)) {
    return f.map((x): [string | null, string] => {
      if (typeof x === 'string') return [null, x];
      if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>;
        return [o.label != null ? String(o.label) : o.key != null ? String(o.key) : null, String(o.value ?? o.text ?? '')];
      }
      return [null, String(x)];
    });
  }
  if (f && typeof f === 'object') {
    return Object.entries(f as Record<string, unknown>).map(([k, v]): [string, string] => [
      k.replace(/_/g, ' '),
      typeof v === 'number' ? (k.endsWith('_inr') ? formatInr(v) : formatCount(v)) : v === null ? '—' : String(v),
    ]);
  }
  return [];
}

type Loaded = { advisor: Advisor; fallback: boolean } | null;

export function FixAdvisor({ cause, open, onClose }: { cause: string | null; open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const auth = useAuth();
  const { analysis, narration, showToast, markDecisionSaved } = useStore();
  const lang = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const uid = useId();
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [choice, setChoice] = useState(0);
  const [applied, setApplied] = useState<ScenarioResponse | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<ErrorInfo | null>(null);
  const [owner, setOwner] = useState(() => auth.user?.name || auth.user?.email || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<DecisionSaved | null>(null);
  const [saveError, setSaveError] = useState<ErrorInfo | null>(null);

  const analysisId = analysis?.analysis_id ?? null;

  useEffect(() => {
    if (!open || !cause || !analysis) return undefined;
    let cancelled = false;
    setLoaded(null);
    setError(null);
    setChoice(0);
    setApplied(null);
    setApplyError(null);
    setSaved(null);
    setSaveError(null);
    setLoading(true);
    const assume = t('advisor.assumeRefund', 'Count unknown refunds as full refunds');
    api
      .advisor(analysis.analysis_id, { cause, lang })
      .then((adv) => {
        if (!cancelled) setLoaded({ advisor: adv, fallback: false });
      })
      .catch((err) => {
        if (cancelled) return;
        const local = isNotFound(err) ? advisorFromAnalysis(analysis, cause, narration, assume) : null;
        if (local) setLoaded({ advisor: local, fallback: true });
        else setError(toErrorInfo(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // narration only fills the fallback; a new wording should not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cause, analysisId, lang]);

  const adv = loaded?.advisor ?? null;
  const group = analysis?.leaks.find((l) => l.cause === cause) ?? null;
  const picked = adv?.interventions[choice] ?? null;
  const canApply = Boolean(picked?.overrides && isRunnable(picked.overrides));
  const title = adv?.label || (cause ? LEAK_LABELS[cause as keyof typeof LEAK_LABELS] ?? cause : '');

  const apply = async () => {
    if (!analysis || !picked?.overrides) return;
    setApplying(true);
    setApplyError(null);
    try {
      setApplied(await api.createScenario(analysis.analysis_id, picked.overrides));
    } catch (err) {
      setApplyError(toErrorInfo(err));
    } finally {
      setApplying(false);
    }
  };

  const save = async () => {
    if (!analysis || !picked) return;
    const who = owner.trim();
    if (!who) {
      setSaveError({ message: t('advisor.ownerNeeded', 'Name an owner for the decision.'), hint: null, issues: [] });
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const applies = applied && applied.analysis_id === analysis.analysis_id;
      const d = await api.createDecision(analysis.analysis_id, {
        ...(applies ? { scenario_id: applied.scenario_id } : {}),
        intervention: picked.intervention,
        expected_delta_inr: applies ? applied.delta.contribution_inr : picked.expected_delta_inr,
        test_30d: adv?.test_30d?.text || t('overview.draftTest', 'Run this change for 30 days and compare contribution per order with the month before.'),
        stop_rule: adv?.stop_rule?.text || t('overview.draftStop', 'Stop if contribution per order is below the starting month after 30 days.'),
        owner: who,
      });
      setSaved(d);
      markDecisionSaved(analysis.analysis_id);
      showToast(t('overview.toast', 'Decision saved: {{label}}', { label: picked.label }));
    } catch (err) {
      setSaveError(toErrorInfo(err));
    } finally {
      setSaving(false);
    }
  };

  const meta = group ? (
    <>
      <Pill tone="neutral">{t('leaks.orderCount', { count: group.count })}</Pill>
      {group.lost_inr === null ? <Pill tone="unknown">{t('overview.unknownAmount', 'amount unknown')}</Pill> : <Pill tone="danger">{formatInr(group.lost_inr)}</Pill>}
    </>
  ) : null;

  return (
    <Drawer open={open} onClose={onClose} title={title ? t('advisor.title', 'Fix: {{label}}', { label: title }) : t('advisor.titlePlain', 'Fix this')} meta={meta}>
      <div className="drawer-stack fix-advisor" data-cause={cause ?? ''}>
        {loading ? (
          <div className="stack" aria-busy="true" role="status" aria-label={t('advisor.loading', 'Reading the leak…')}>
            <Skeleton width="90%" height={12} />
            <Skeleton width="75%" height={12} className="skeleton-gap" />
            <Skeleton width="60%" height={40} className="skeleton-gap" />
          </div>
        ) : null}
        <ErrorCallout error={error} />
        {!loading && !adv && !error && open && !group ? <p className="muted">{t('advisor.notFound', 'This leak is not in the current analysis.')}</p> : null}

        {adv ? (
          <>
            <section aria-labelledby={`${uid}-what`}>
              <h3 id={`${uid}-what`} className="mini-title">
                {t('advisor.what', 'What is happening')}
              </h3>
              <p className="fix-summary">{adv.summary.text}</p>
              <AiBadge source={adv.summary.source} />
              {factLines(adv.facts).length > 0 ? (
                <ul className="fix-facts">
                  {factLines(adv.facts).map(([k, v], i) => (
                    <li key={`${k ?? ''}-${i}`}>
                      {k ? <span className="fix-fact-k">{k}</span> : null}
                      <span className="fix-fact-v">{v}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="fix-orders-link">
                <a href={hrefFor('ledger', { cause: adv.cause || (cause ?? '') })}>
                  {t('advisor.seeOrders', 'See the orders')} <Icon name="arrow-right" size={14} />
                </a>
              </p>
            </section>

            <section aria-labelledby={`${uid}-fixes`}>
              <h3 id={`${uid}-fixes`} className="mini-title">
                {t('advisor.fixes', 'Fixes, ranked by expected rupees')}
              </h3>
              {adv.interventions.length === 0 ? (
                <p className="muted">{t('advisor.noFixes', 'No modelled fix pays for this leak yet.')}</p>
              ) : (
                <div className="fix-options" role="radiogroup" aria-labelledby={`${uid}-fixes`}>
                  {adv.interventions.slice(0, 3).map((iv, i) => (
                    <label key={iv.candidate_id || iv.intervention} className={`fix-option${choice === i ? ' is-picked' : ''}`}>
                      <input
                        type="radio"
                        name={`${uid}-fix`}
                        checked={choice === i}
                        onChange={() => {
                          setChoice(i);
                          setApplied(null);
                          setApplyError(null);
                        }}
                      />
                      <span className="fix-option-body">
                        <span className="fix-option-label">{iv.label}</span>
                        <span className="fix-option-figures">
                          <Money value={iv.expected_delta_inr} tone="contribution" signed />
                          {iv.confidence ? <ConfidenceBadge confidence={iv.confidence} prefix={t('overview.confidence', 'Confidence')} /> : null}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>

            {adv.test_30d || adv.stop_rule ? (
              <section aria-labelledby={`${uid}-test`} className="fix-test">
                <h3 id={`${uid}-test`} className="mini-title">
                  {t('advisor.test', 'Drafted 30-day test')}
                </h3>
                {adv.test_30d ? (
                  <p>
                    {adv.test_30d.text} <AiBadge source={adv.test_30d.source} compact />
                  </p>
                ) : null}
                {adv.stop_rule ? (
                  <>
                    <h4 className="fix-sub">{t('advisor.stopRule', 'Stop rule')}</h4>
                    <p>
                      {adv.stop_rule.text} <AiBadge source={adv.stop_rule.source} compact />
                    </p>
                  </>
                ) : null}
              </section>
            ) : null}

            {applied ? (
              <section className="fix-result" aria-label={t('advisor.resultAria', 'Scenario result')}>
                <div>
                  <span className="fix-result-k">{t('advisor.before', 'Before')}</span>
                  <Money value={applied.baseline.contribution_inr} tone="contribution" />
                  <Provenance kind="observed" />
                </div>
                <Icon name="arrow-right" size={16} />
                <div>
                  <span className="fix-result-k">{t('advisor.after', 'After')}</span>
                  <Money value={applied.scenario.contribution_inr} tone="contribution" />
                  <Provenance kind="assumed" />
                </div>
                <div className="fix-result-delta">
                  <span className="fix-result-k">{t('advisor.change', 'Change')}</span>
                  <Money value={applied.delta.contribution_inr} tone="contribution" signed />
                </div>
              </section>
            ) : null}
            <ErrorCallout error={applyError} />

            {picked ? (
              <div className="fix-actions">
                <Button variant="secondary" icon="sliders" onClick={() => void apply()} disabled={!canApply || applying} title={canApply ? undefined : t('advisor.noOverrides', 'This fix has no single assumption to change; model it on the Scenario step.')}>
                  {applying ? t('advisor.applying', 'Running…') : t('advisor.apply', 'Apply this scenario')}
                </Button>
                {!canApply ? (
                  <ButtonLink variant="ghost" size="sm" href={hrefFor('scenario')} iconRight="arrow-right">
                    {t('advisor.openScenario', 'Open the Scenario step')}
                  </ButtonLink>
                ) : null}
              </div>
            ) : null}

            {picked ? (
              saved ? (
                <p className="ov-saved" role="status">
                  <Icon name="check-circle" size={16} />
                  {t('overview.savedLine', 'Decision saved.')} <a href={hrefFor('decision')}>{t('overview.openDecision', 'Open the decision')}</a>
                </p>
              ) : (
                <div className="fix-save">
                  <label className="field-label" htmlFor={`${uid}-owner`}>
                    {t('advisor.owner', 'Owner')}
                  </label>
                  <div className="fix-save-row">
                    <input id={`${uid}-owner`} className="input" type="text" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder={t('advisor.ownerPlaceholder', 'Who runs the test')} />
                    <Button variant="primary" icon="check-circle" onClick={() => void save()} disabled={saving}>
                      {saving ? t('overview.saving', 'Saving…') : t('advisor.save', 'Save as decision')}
                    </Button>
                  </div>
                  <ErrorCallout error={saveError} />
                </div>
              )
            ) : null}

            {loaded?.fallback ? <p className="muted small">{t('advisor.fallback', 'The advisor is not available on this server yet; this is the engine’s own explanation and ranking.')}</p> : null}
          </>
        ) : null}
      </div>
    </Drawer>
  );
}
