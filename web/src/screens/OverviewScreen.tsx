import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { api, isNotFound, language, toErrorInfo, type ErrorInfo } from '../api/client';
import { interventionText } from '../api/proof';
import {
  AUTOPILOT_STAGES,
  type AnalysisResponse,
  type AttributionMode,
  type Autopilot,
  type AutopilotAction,
  type AutopilotStage,
  type DecisionRequest,
  type DecisionSaved,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AiBadge } from '../components/AiBadge';
import { AiBriefing, useDigest } from '../components/AiBriefing';
import { AskBar } from '../components/AskBar';
import { AskAiButton } from '../components/AskAiButton';
import { Pill } from '../components/Badge';
import { EvidenceBadge } from '../components/EvidenceBadge';
import { Button, ButtonLink } from '../components/Button';
import { NeedsAnalysis } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { Money } from '../components/Money';
import { PageHeader } from '../components/Page';
import { Provenance } from '../components/Provenance';
import { Callout, ErrorCallout, Skeleton } from '../components/ui';
import { i18n } from '../i18n';
import { actionQuestion, leakQuestion } from '../lib/ask';
import { apiText } from '../lib/apiText';
import { formatCount, formatInr, formatMarginPct } from '../lib/format';
import { datasetName, handlingEstimateUsed, INTERVENTION_LABELS, LEAK_LABELS } from '../lib/labels';
import { hrefFor, navigate } from '../lib/router';
import { isRunnable, useStore } from '../state/store';
import { sortLeakGroups } from './LeaksScreen';

// ---- Data ------------------------------------------------------------------------------------------------------------

/** One autopilot run per dataset, attribution and language; going back to Overview does not run it again. */
const cache = new Map<string, Autopilot>();

export function clearAutopilotCache(): void {
  cache.clear();
}

/**
 * The same page from the engine's own output, for a server without the autopilot endpoint: headline from the totals,
 * the three largest leaks, and the candidates ranked by expected rupees.
 */
export function autopilotFromAnalysis(a: AnalysisResponse): Autopilot {
  const rec = a.recommendation;
  const top_leaks = sortLeakGroups(a.leaks)
    .slice(0, 3)
    .map((g) => ({ cause: g.cause, label: g.label || i18n.t(`focus.cause.${g.cause}`, LEAK_LABELS[g.cause]), orders: g.count, inr_at_stake: g.lost_inr }));
  const actions: AutopilotAction[] = [...a.candidates]
    .filter((c) => c.delta_inr > 0)
    .sort((x, y) => y.delta_inr - x.delta_inr)
    .slice(0, 3)
    .map((c, i) => {
      const isRec = rec.intervention === c.intervention;
      return {
        rank: i + 1,
        candidate_id: c.intervention,
        intervention: c.intervention,
        // Candidate labels come from the engine in English: worded again from the intervention key.
        label: interventionText(i18n.t, c.intervention, c.label || INTERVENTION_LABELS[c.intervention] || c.intervention),
        overrides: null,
        expected_delta_inr: c.delta_inr,
        confidence: isRec ? rec.confidence : null,
        explanation: { text: isRec ? rec.why : c.rule, source: isRec ? rec.why_source : 'template' },
        decision_draft: isRec ? { intervention: c.intervention, expected_delta_inr: c.delta_inr, test_30d: rec.test_30d_draft, stop_rule: rec.stop_rule_draft } : null,
      };
    });
  return {
    autopilot_id: '',
    dataset_id: a.dataset_id,
    analysis_id: a.analysis_id,
    status: 'done',
    stages: { analysis: 'done', leaks: 'done', scenarios: 'done', margins: a.margins ? 'done' : 'skipped', pulse: 'skipped', explanations: 'done' },
    headline: {
      contribution_inr: a.totals.contribution_inr,
      net_sales_inr: a.totals.net_sales_inr,
      orders: a.totals.orders,
      unknown_orders: a.totals.unknown_count,
      partial: a.totals.partial,
      margins: a.margins ?? null,
    },
    top_leaks,
    actions,
  };
}

type RunState = { doc: Autopilot | null; error: ErrorInfo | null; fallback: boolean };

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** POST the autopilot, then follow its stages: server-sent events first, polling GET /autopilot/:id when they fail. */
function useAutopilot(datasetId: string | null, attribution: AttributionMode, lang: string): RunState {
  const key = datasetId ? `${datasetId}|${attribution}|${lang}` : '';
  const [state, setState] = useState<RunState>(() => ({ doc: cache.get(key) ?? null, error: null, fallback: false }));

  useEffect(() => {
    if (!datasetId) return undefined;
    const hit = cache.get(key);
    if (hit && hit.status !== 'running') {
      setState({ doc: hit, error: null, fallback: false });
      return undefined;
    }
    let cancelled = false;
    let source: EventSource | null = null;
    let timer: number | undefined;
    setState({ doc: null, error: null, fallback: false });

    const show = (d: Autopilot) => {
      if (d.status !== 'running') cache.set(key, d);
      if (!cancelled) setState({ doc: d, error: null, fallback: false });
    };
    const refresh = async (id: string): Promise<boolean> => {
      try {
        const d = await api.getAutopilot(id);
        show(d);
        return d.status !== 'running';
      } catch {
        return false;
      }
    };
    const poll = (id: string, n = 0) => {
      timer = window.setTimeout(async () => {
        const finished = await refresh(id);
        if (!finished && !cancelled && n < 100) poll(id, n + 1);
      }, 1200);
    };

    (async () => {
      try {
        const d = await api.autopilot(datasetId, { attribution, lang });
        if (cancelled) return;
        show(d);
        if (d.status !== 'running') return;
        if (typeof window.EventSource !== 'function') {
          poll(d.autopilot_id);
          return;
        }
        const es = new window.EventSource(api.autopilotEventsUrl(d.autopilot_id), { withCredentials: true });
        source = es;
        es.addEventListener('stage', (ev) => {
          const p = parseJson<{ stage: AutopilotStage; status: string }>((ev as MessageEvent<string>).data);
          if (!p || cancelled) return;
          setState((s) => (s.doc ? { ...s, doc: { ...s.doc, stages: { ...s.doc.stages, [p.stage]: p.status } } } : s));
          // Numbers first: each finished stage brings its figures in; explanations follow.
          if (p.status === 'done') void refresh(d.autopilot_id);
        });
        es.addEventListener('done', (ev) => {
          const full = parseJson<Autopilot>((ev as MessageEvent<string>).data);
          es.close();
          source = null;
          if (full && full.autopilot_id) show(full);
          else void refresh(d.autopilot_id);
        });
        es.onerror = () => {
          es.close();
          source = null;
          if (!cancelled) poll(d.autopilot_id);
        };
      } catch (err) {
        if (cancelled) return;
        if (isNotFound(err)) setState({ doc: null, error: null, fallback: true });
        else setState({ doc: null, error: toErrorInfo(err), fallback: false });
      }
    })();

    return () => {
      cancelled = true;
      source?.close();
      window.clearTimeout(timer);
    };
  }, [datasetId, attribution, lang, key]);

  return state;
}

// ---- Pieces ----------------------------------------------------------------------------------------------------------

const STAGE_KEYS: Record<AutopilotStage, [string, string]> = {
  analysis: ['overview.stage.analysis', 'Contribution per order'],
  leaks: ['overview.stage.leaks', 'Leaks by cause'],
  scenarios: ['overview.stage.scenarios', 'Fixes simulated'],
  margins: ['overview.stage.margins', 'Unit economics'],
  pulse: ['overview.stage.pulse', 'Months and products'],
  explanations: ['overview.stage.explanations', 'Explanations'],
};

function Stages({ doc }: { doc: Autopilot | null }) {
  const { t } = useTranslation();
  const statusOf = (s: AutopilotStage) => doc?.stages?.[s] ?? 'pending';
  const done = AUTOPILOT_STAGES.filter((s) => ['done', 'skipped'].includes(statusOf(s))).length;
  const running = !doc || doc.status === 'running';
  return (
    <section className={`card ov-stages${running ? ' is-running' : ' is-done'}`} aria-label={t('overview.stagesAria', 'Autopilot progress')}>
      <p className="ov-stages-head" role="status" aria-live="polite">
        {running ? <span className="spinner" aria-hidden="true" /> : <Icon name="check-circle" size={16} />}
        <strong>{running ? t('overview.running', 'Profyn is working through your orders…') : t('overview.ready', 'Ready')}</strong>
        <span className="muted">{t('overview.stagesDone', '{{done}} of {{total}} steps', { done, total: AUTOPILOT_STAGES.length })}</span>
      </p>
      <ol className="ov-stage-list">
        {AUTOPILOT_STAGES.map((s) => {
          const st = statusOf(s);
          const [k, en] = STAGE_KEYS[s];
          return (
            <li key={s} className={`ov-stage is-${st}`} data-stage={s}>
              <span className="ov-stage-dot" aria-hidden="true">
                {st === 'done' ? <Icon name="check" size={11} strokeWidth={3} /> : st === 'failed' ? <Icon name="x" size={11} strokeWidth={3} /> : null}
              </span>
              <span className="ov-stage-name">{t(k, en)}</span>
              <span className="visually-hidden">
                {' '}
                ·{' '}
                {st === 'done'
                  ? t('overview.st.done', 'done')
                  : st === 'running'
                    ? t('overview.st.running', 'working')
                    : st === 'failed'
                      ? t('overview.st.failed', 'failed')
                      : st === 'skipped'
                        ? t('overview.st.skipped', 'skipped')
                        : t('overview.st.pending', 'waiting')}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Headline({ doc, analysis }: { doc: Autopilot; analysis: AnalysisResponse | null }) {
  const { t } = useTranslation();
  const h = doc.headline;
  if (!h) {
    return (
      <section className="card ov-headline" aria-busy="true">
        <Skeleton width="30%" height={12} />
        <Skeleton width="45%" height={40} className="skeleton-gap" />
      </section>
    );
  }
  const m = h.margins ?? null;
  const handlingAssumed = analysis ? handlingEstimateUsed(analysis) : false;
  const recon = analysis && (analysis.analysis_id === doc.analysis_id || analysis.dataset_id === doc.dataset_id) ? analysis.reconciliation : null;
  return (
    <section className="card ov-headline" aria-labelledby="ov-headline-label">
      <div className="ov-headline-main">
        <span className="ov-label-row">
          <span id="ov-headline-label" className="ov-label">
            {t('overview.contribution', 'Operational contribution')}
          </span>
          <AskAiButton question={t('askq.contribution', 'Explain operational contribution')} about={t('overview.contribution', 'Operational contribution')} />
        </span>
        <span className="ov-value">
          <Money value={h.contribution_inr} tone="contribution" />
        </span>
        <span className="ov-prov">
          <Provenance kind="observed" />
          {handlingAssumed ? (
            <Provenance kind="assumed" title={t('overview.handlingAssumed', 'Handling per order is an estimate you entered, not read from the file.')} />
          ) : null}
          {h.partial ? (
            <Pill tone="unknown" title={t('overview.partialTip', 'Orders with an unknown fact are left out of the total, never counted as zero.')}>
              {t('overview.partial', 'partial')}
            </Pill>
          ) : null}
          {recon?.ok ? (
            <Pill tone="success" icon="check" title={apiText(recon.statement)}>
              {t('overview.reconciled', 'Reconciled')}
            </Pill>
          ) : null}
        </span>
        <span className="ov-note">{t('overview.notStatutory', 'Operational contribution, not statutory profit.')}</span>
      </div>
      <dl className="ov-facts">
        <div>
          <dt>{t('overview.netSales', 'Net sales')}</dt>
          <dd>
            <Money value={h.net_sales_inr} tone="plain" />
          </dd>
        </div>
        <div>
          <dt>{t('overview.orders', 'Orders')}</dt>
          <dd className="num">{formatCount(h.orders)}</dd>
        </div>
        <div>
          <dt>{t('overview.unknownOrders', 'Unknown')}</dt>
          <dd className="num">{formatCount(h.unknown_orders)}</dd>
        </div>
        {m && m.cm3_pct !== null ? (
          <div>
            <dt>{t('overview.cm3', 'CM3 margin')}</dt>
            <dd className="num">{formatMarginPct(m.cm3_pct)}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

const leakLabel = (t: TFunction, l: { cause: string; label: string }) =>
  l.label || t(`focus.cause.${l.cause}`, LEAK_LABELS[l.cause as keyof typeof LEAK_LABELS] || l.cause);

function Leaks({ doc }: { doc: Autopilot }) {
  const { t } = useTranslation();
  if (doc.top_leaks.length === 0) {
    const leaksDone = doc.stages.leaks === 'done' || doc.status !== 'running';
    return leaksDone ? (
      <p className="muted">{t('overview.noLeaks', 'No order lost money in this period.')}</p>
    ) : (
      <div className="ov-leak-grid" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card ov-leak">
            <Skeleton width="60%" height={14} />
            <Skeleton width="40%" height={24} className="skeleton-gap" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <ol className="ov-leak-grid">
      {doc.top_leaks.slice(0, 3).map((l) => (
        <li key={l.cause} className="card ov-leak">
          <span className="ov-card-head">
            <span className="ov-leak-label">{leakLabel(t, l)}</span>
            <AskAiButton question={leakQuestion(t, l.cause, leakLabel(t, l))} about={leakLabel(t, l)} />
          </span>
          <span className="ov-leak-amount">
            {l.inr_at_stake === null ? (
              <Pill tone="unknown">{t('overview.unknownAmount', 'amount unknown')}</Pill>
            ) : (
              <span className="t-loss num">{formatInr(l.inr_at_stake)}</span>
            )}
            <span className="ov-leak-sub">{t('overview.atStake', 'at stake · {{n}} orders', { n: formatCount(l.orders) })}</span>
          </span>
          <span className="ov-leak-links">
            <a href={hrefFor('ledger', { cause: l.cause })}>
              {t('overview.seeOrders', 'See the orders')} <Icon name="arrow-right" size={14} />
            </a>
            <a href={hrefFor('leaks', { fix: l.cause })}>{t('overview.fixThis', 'Fix this')}</a>
          </span>
        </li>
      ))}
    </ol>
  );
}

function ActionCard({
  action,
  explaining,
  saved,
  busy,
  error,
  onAccept,
  onAdjust,
}: {
  action: AutopilotAction;
  explaining: boolean;
  saved: DecisionSaved | null;
  busy: boolean;
  error: ErrorInfo | null;
  onAccept: () => void;
  onAdjust: () => void;
}) {
  const { t } = useTranslation();
  const label = action.label || interventionText(t, action.intervention, INTERVENTION_LABELS[action.intervention] || action.intervention);
  const ex = action.explanation;
  return (
    <article className="card ov-action" aria-labelledby={`ov-action-${action.rank}`}>
      <div className="ov-action-top">
        <span className="ov-rank" aria-hidden="true">
          {action.rank}
        </span>
        <h3 id={`ov-action-${action.rank}`} className="ov-action-title">
          {label}
        </h3>
        <AskAiButton question={actionQuestion(t, action.intervention, label)} about={label} className="ov-action-ask" />
      </div>
      <div className="ov-action-figures">
        <span className="ov-delta">
          <Money value={action.expected_delta_inr} tone="contribution" signed />
          <span className="ov-delta-sub">{t('overview.expected', 'expected change in contribution')}</span>
        </span>
        <EvidenceBadge evidence={action.evidence} confidence={action.confidence} />
        <Provenance kind="assumed" title={t('overview.deltaAssumed', 'A simulated change: it assumes the fix works as modelled.')} />
      </div>
      {ex && ex.text ? (
        <div className="ov-explain">
          <p>{apiText(ex.text)}</p>
          <AiBadge source={ex.source} />
        </div>
      ) : explaining ? (
        <div className="ov-explain is-loading" aria-busy="true">
          <Skeleton width="95%" height={12} />
          <Skeleton width="80%" height={12} className="skeleton-gap" />
          <span className="muted small">{t('overview.explaining', 'Writing the explanation…')}</span>
        </div>
      ) : null}
      {saved ? (
        <p className="ov-saved" role="status">
          <Icon name="check-circle" size={16} />
          {t('overview.savedLine', 'Decision saved.')}{' '}
          <a href={hrefFor('decision')}>{t('overview.openDecision', 'Open the decision')}</a>
        </p>
      ) : (
        <div className="ov-action-buttons">
          <Button variant={action.rank === 1 ? 'primary' : 'secondary'} size="sm" icon="check-circle" onClick={onAccept} disabled={busy}>
            {busy ? t('overview.saving', 'Saving…') : t('overview.accept', 'Accept and save decision')}
          </Button>
          <Button variant="ghost" size="sm" icon="sliders" onClick={onAdjust}>
            {t('overview.adjust', 'Adjust in Scenario')}
          </Button>
        </div>
      )}
      <ErrorCallout error={error} />
    </article>
  );
}

// ---- Screen ----------------------------------------------------------------------------------------------------------

export function OverviewScreen() {
  const { t, i18n } = useTranslation();
  const auth = useAuth();
  const { dataset, datasetId, analysis, samples, setOverrides, showToast, markDecisionSaved, runAnalysis, analysing } = useStore();
  const lang = i18n.resolvedLanguage ?? i18n.language ?? language();
  const attribution: AttributionMode = analysis?.attribution ?? 'allocate';
  const id = datasetId ?? analysis?.dataset_id ?? null;
  const run = useAutopilot(id, attribution, lang);
  const [saved, setSaved] = useState<Record<number, DecisionSaved>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, ErrorInfo>>({});
  const [analyseError, setAnalyseError] = useState<ErrorInfo | null>(null);
  // The AI briefing follows the autopilot's analysis (the engine's own when the server has no autopilot) and is fetched
  // again after a decision is saved, so "What was decided" catches up.
  const [digestRefresh, setDigestRefresh] = useState(0);
  const digestId = run.doc?.analysis_id || (run.fallback || run.error ? analysis?.analysis_id ?? null : null);
  const digest = useDigest(id ? digestId : null, lang, digestRefresh);

  useEffect(() => {
    setSaved({});
    setErrors({});
  }, [id]);

  const title = t('overview.title', 'Overview');
  const name = dataset ? datasetName(dataset.source, dataset.files, samples.find((s) => s.source === dataset.source)?.label) : null;
  const subtitle = name
    ? t('overview.subNamed', 'What Profyn found in {{name}}, and the three things to do next.', { name })
    : t('overview.sub', 'What Profyn found in your orders, and the three things to do next.');

  if (!id) {
    return (
      <div className="page">
        <PageHeader title={title} subtitle={subtitle} />
        <NeedsAnalysis sentence={t('overview.empty', 'No data yet. Load the sample orders or import your file, and the overview fills itself in.')} icon="activity" />
      </div>
    );
  }

  // Numbers first: the analysis already in the app fills the page while the autopilot runs; a server without the
  // autopilot shows the engine's own ranking.
  const fallbackDoc = analysis && (run.fallback || !run.doc) ? autopilotFromAnalysis(analysis) : null;
  const doc: Autopilot | null = run.doc ?? (run.fallback ? fallbackDoc : null);
  const preview = !run.doc && !run.fallback && fallbackDoc ? { ...fallbackDoc, status: 'running', actions: [] } : null;
  const shown = doc ?? preview;
  const explaining = doc ? doc.status === 'running' && doc.stages.explanations !== 'done' && doc.stages.explanations !== 'failed' : true;

  const owner = auth.user?.name || auth.user?.email || null;

  const draftOf =(a: AutopilotAction): DecisionRequest => ({
    intervention: a.decision_draft?.intervention ?? a.intervention,
    expected_delta_inr: a.decision_draft?.expected_delta_inr ?? a.expected_delta_inr,
    test_30d: a.decision_draft?.test_30d || t('overview.draftTest', 'Run this change for 30 days and compare contribution per order with the month before.'),
    stop_rule: a.decision_draft?.stop_rule || t('overview.draftStop', 'Stop if contribution per order is below the starting month after 30 days.'),
    owner: owner ?? t('overview.ownerDefault', 'Owner'),
  });

  const accept = async (a: AutopilotAction) => {
    if (!doc) return;
    setBusy(a.rank);
    setErrors((e) => {
      const next = { ...e };
      delete next[a.rank];
      return next;
    });
    try {
      let result: DecisionSaved;
      if (doc.autopilot_id && !run.fallback) {
        try {
          result = await api.acceptAutopilot(doc.autopilot_id, { rank: a.rank, ...(owner ? { owner } : {}) });
        } catch (err) {
          if (!isNotFound(err) || !doc.analysis_id) throw err;
          result = await api.createDecision(doc.analysis_id, draftOf(a));
        }
      } else {
        if (!doc.analysis_id) throw new Error(t('overview.noAnalysis', 'Run the analysis first.'));
        result = await api.createDecision(doc.analysis_id, draftOf(a));
      }
      setSaved((s) => ({ ...s, [a.rank]: result }));
      setDigestRefresh((n) => n + 1);
      markDecisionSaved(analysis?.analysis_id ?? doc.analysis_id ?? '');
      showToast(t('overview.toast', 'Decision saved: {{label}}', { label: a.label }));
    } catch (err) {
      setErrors((e) => ({ ...e, [a.rank]: toErrorInfo(err) }));
    } finally {
      setBusy(null);
    }
  };

  const adjust = (a: AutopilotAction) => {
    if (a.overrides && isRunnable(a.overrides)) setOverrides(a.overrides);
    navigate('scenario');
  };

  const analyseNow = async () => {
    setAnalyseError(null);
    try {
      await runAnalysis('allocate', undefined, id);
    } catch (err) {
      setAnalyseError(toErrorInfo(err));
    }
  };

  return (
    <div className="page ov-page">
      <PageHeader title={title} subtitle={subtitle} actions={<ButtonLink variant="secondary" size="sm" icon="message" href={hrefFor('report')}>{t('share.openReport', 'Monthly report · send as PDF')}</ButtonLink>} />

      <AskBar />

      <Stages doc={doc} />

      <AiBriefing state={digest} pending={!digestId && !run.error && !run.fallback} />

      {run.error ? <ErrorCallout error={run.error} /> : null}
      {run.fallback ? (
        <Callout tone="info" title={t('overview.fallbackTitle', 'Showing the engine’s own ranking.')}>
          <p className="callout-hint">{t('overview.fallbackHint', 'The autopilot is not available on this server yet; every figure below comes straight from the analysis.')}</p>
        </Callout>
      ) : null}
      {run.fallback && !analysis ? (
        <Callout tone="info" title={t('overview.needRun', 'Run the analysis to fill in the overview.')}>
          <Button variant="primary" size="sm" icon="refresh" onClick={() => void analyseNow()} disabled={analysing}>
            {analysing ? t('actions.analysing') : t('overview.runAnalysis', 'Run the analysis')}
          </Button>
          <ErrorCallout error={analyseError} />
        </Callout>
      ) : null}

      {shown ? (
        <Headline doc={shown} analysis={analysis} />
      ) : !run.error ? (
        <section className="card ov-headline" aria-busy="true" aria-label={t('overview.loading', 'Loading the overview')}>
          <Skeleton width="30%" height={12} />
          <Skeleton width="45%" height={40} className="skeleton-gap" />
          <Skeleton width="60%" height={12} className="skeleton-gap" />
        </section>
      ) : null}

      {shown ? (
        <section className="ov-section" aria-labelledby="ov-leaks-title">
          <div className="section-head">
            <h2 id="ov-leaks-title" className="section-title">
              {t('overview.leaksTitle', 'The three biggest leaks')}
            </h2>
            <a className="section-meta" href={hrefFor('leaks')}>
              {t('overview.allLeaks', 'All leaks')}
            </a>
          </div>
          <Leaks doc={shown} />
        </section>
      ) : null}

      {shown ? (
        <section className="ov-section" aria-labelledby="ov-actions-title">
          <div className="section-head">
            <h2 id="ov-actions-title" className="section-title">
              {t('overview.actionsTitle', 'Top 3 actions')}
            </h2>
            <span className="section-meta">{t('overview.actionsMeta', 'Ranked by expected rupees; each one becomes a decision with a 30-day test.')}</span>
          </div>
          {doc && doc.actions.length > 0 ? (
            <div className="ov-action-grid">
              {doc.actions.slice(0, 3).map((a) => (
                <ActionCard
                  key={a.rank}
                  action={a}
                  explaining={explaining}
                  saved={saved[a.rank] ?? null}
                  busy={busy === a.rank}
                  error={errors[a.rank] ?? null}
                  onAccept={() => void accept(a)}
                  onAdjust={() => adjust(a)}
                />
              ))}
            </div>
          ) : doc && doc.status !== 'running' ? (
            <p className="muted">{t('overview.noActions', 'No change pays more than it costs right now. Check again after next month’s import.')}</p>
          ) : (
            <div className="ov-action-grid" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="card ov-action">
                  <Skeleton width="70%" height={16} />
                  <Skeleton width="40%" height={24} className="skeleton-gap" />
                  <Skeleton width="90%" height={12} className="skeleton-gap" />
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
