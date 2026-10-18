import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { addDays, interventionText, monthOf, monthStart, readMargins, formatPct2, type Margins } from '../api/proof';
import type { AnalysisResponse, DecisionSummary, PulseLeaks, PulseOverview } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { BRAND } from '../brand';
import { AiBadge } from '../components/AiBadge';
import { useDigest } from '../components/AiBriefing';
import { CONFIDENCE_KEY, Pill } from '../components/Badge';
import { Button, ButtonLink } from '../components/Button';
import { LogoMark } from '../components/LogoMark';
import { Money } from '../components/Money';
import { ShareActions } from '../components/ShareActions';
import { EmptyPanel, SkeletonCards } from '../components/ui';
import { localeFor, lower } from '../i18n';
import { apiText } from '../lib/apiText';
import { formatCount, formatDate, formatInr, formatPct } from '../lib/format';
import { datasetName, handlingEstimateUsed, LEAK_LABELS } from '../lib/labels';
import { hrefFor, useHashLocation } from '../lib/router';
import { appUrl, shareText } from '../lib/share';
import { autopilotFromAnalysis } from './OverviewScreen';
import { useStore } from '../state/store';
import '../styles/proof.css';

const FIXED_COSTS_INR = 0;

function PrinterIcon() {
  return (
    <svg className="report-print-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9V3h12v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M6 14h12v7H6z" />
    </svg>
  );
}

function Assumed({ title }: { title?: string }) {
  const { t } = useTranslation();
  return (
    <span className="report-tag" title={title}>
      {t('report.assumed', 'Assumed')}
    </span>
  );
}

function monthsOf(a: AnalysisResponse): string[] {
  const set = new Set<string>();
  for (const o of a.orders) {
    const m = monthOf(o.date);
    if (m) set.add(m);
  }
  return Array.from(set).sort();
}

interface Extra {
  overview: PulseOverview | null;
  leaks: PulseLeaks | null;
  decisions: DecisionSummary[] | null;
  loading: boolean;
}

/** The month's pulse figures, the leak months and the saved decisions; each may be missing without breaking the page. */
function useReportData(analysis: AnalysisResponse | null, month: string | null): Extra {
  const [extra, setExtra] = useState<Extra>({ overview: null, leaks: null, decisions: null, loading: false });
  const id = analysis?.analysis_id ?? null;
  useEffect(() => {
    if (!id || !month) return undefined;
    let cancelled = false;
    setExtra((e) => ({ ...e, loading: true }));
    Promise.all([
      api.pulseOverview(id, month).catch(() => null),
      api.pulseLeaks(id).catch(() => null),
      api.listDecisions().catch(() => null),
    ]).then(([overview, leaks, decisions]) => {
      if (!cancelled) setExtra({ overview, leaks, decisions, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [id, month]);
  return extra;
}

function Section({ n, title, meta, children }: { n: number; title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="report-section" aria-labelledby={`report-s${n}`}>
      <header className="report-section-head">
        <h2 id={`report-s${n}`} className="report-section-title">
          <span className="report-section-n" aria-hidden="true">
            {n}
          </span>
          {title}
        </h2>
        {meta ? <span className="report-section-meta">{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

function Metric({ label, value, sub, tag, strong }: { label: string; value: ReactNode; sub?: ReactNode; tag?: ReactNode; strong?: boolean }) {
  return (
    <div className={`report-metric${strong ? ' is-strong' : ''}`}>
      <span className="report-metric-label">
        {label}
        {tag}
      </span>
      <span className="report-metric-value num">{value}</span>
      {sub ? <span className="report-metric-sub">{sub}</span> : null}
    </div>
  );
}

const pct = (v: number | null | undefined) => (typeof v === 'number' ? formatPct2(v) : null);

function UnitEconomics({ margins, wholePeriod, handlingAssumed }: { margins: Margins | null; wholePeriod: string | null; handlingAssumed: boolean }) {
  const { t } = useTranslation();
  const na = <span className="report-na">{t('report.notAvailable', 'not available yet')}</span>;
  if (!margins) {
    return (
      <p className="report-note">
        {t('report.noMargins', 'Margins are not available from this API yet; they appear here once the analysis carries them.')}
      </p>
    );
  }
  const netMargin =
    margins.contribution_inr !== null && margins.net_revenue_inr ? ((margins.contribution_inr - FIXED_COSTS_INR) / margins.net_revenue_inr) * 100 : null;
  const partial = margins.partial ? <Pill tone="unknown" className="report-pill">{t('report.partial', 'partial')}</Pill> : null;
  const lines: Array<{ label: string; value: number | null; kind: 'start' | 'cost' | 'sub'; pct?: number | null; tag?: ReactNode }> = [
    { label: t('report.ue.netRevenue', 'Net revenue (revenue − refund)'), value: margins.net_revenue_inr, kind: 'start' },
    { label: t('report.ue.npc', 'Net product cost (after recovery)'), value: margins.net_product_cost_inr, kind: 'cost' },
    { label: t('report.ue.cm1', 'Gross margin (CM1)'), value: null, kind: 'sub', pct: margins.cm1_pct },
    { label: t('report.ue.shipping', 'Shipping'), value: margins.shipping_inr, kind: 'cost' },
    { label: t('report.ue.fee', 'Payment fee'), value: margins.payment_fee_inr, kind: 'cost' },
    { label: t('report.ue.handling', 'Handling'), value: margins.handling_inr, kind: 'cost', tag: handlingAssumed ? <Assumed title={t('report.handlingAssumed', 'Default handling per order where the file has none')} /> : undefined },
    { label: t('report.ue.cm2', 'CM2, after fulfilment'), value: null, kind: 'sub', pct: margins.cm2_pct },
    { label: t('report.ue.ads', 'Ads'), value: margins.ads_inr, kind: 'cost' },
    { label: t('report.ue.cm3', 'Contribution (CM3)'), value: margins.contribution_inr, kind: 'sub', pct: margins.cm3_pct },
  ];
  return (
    <>
      <div className="report-metrics">
        <Metric label={t('report.m.netRevenue', 'Net revenue')} value={margins.net_revenue_inr !== null ? formatInr(margins.net_revenue_inr) : na} sub={partial} />
        <Metric label={t('report.m.cm1', 'Gross margin (CM1)')} value={pct(margins.cm1_pct) ?? na} />
        <Metric label={t('report.m.cm2', 'CM2')} value={pct(margins.cm2_pct) ?? na} />
        <Metric label={t('report.m.cm3', 'Contribution margin (CM3)')} value={pct(margins.cm3_pct) ?? na} />
        <Metric label={t('report.m.contribution', 'Contribution')} value={margins.contribution_inr !== null ? formatInr(margins.contribution_inr) : na} />
        <Metric
          strong
          label={t('report.m.netMargin', 'Net margin')}
          value={netMargin !== null ? formatPct2(Math.round(netMargin * 100) / 100) : na}
          sub={t('report.m.netMarginSub', 'estimated operational, not statutory net profit')}
        />
      </div>
      <div className="report-two">
        <table className="report-table">
          <caption className="visually-hidden">{t('report.ue.caption', 'How the margin builds')}</caption>
          <tbody>
            {lines.map((l) => (
              <tr key={l.label} className={`is-${l.kind}`}>
                <th scope="row">
                  {l.kind === 'cost' ? <span className="report-minus">−</span> : null}
                  {apiText(l.label)}
                  {l.tag}
                </th>
                <td className="r num">{l.value !== null ? formatInr(Math.abs(l.value)) : l.kind === 'sub' ? '' : na}</td>
                <td className="r num report-pct">{l.kind === 'sub' && typeof l.pct === 'number' ? formatPct2(l.pct) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="report-formula">
          <p className="report-formula-title">{t('report.netMarginTitle', 'Net margin, estimated')}</p>
          <p className="report-formula-line">
            <code>{t('report.netMarginFormula', '(contribution − fixed costs) ÷ net revenue')}</code>
          </p>
          <dl className="report-kv">
            <div>
              <dt>{t('report.contribution', 'Contribution')}</dt>
              <dd className="num">{margins.contribution_inr !== null ? formatInr(margins.contribution_inr) : na}</dd>
            </div>
            <div>
              <dt>
                {t('report.fixedCosts', 'Fixed costs')}
                <Assumed title={t('report.fixedAssumed', 'Rent, salaries and software are not in the order file')} />
              </dt>
              <dd className="num">{formatInr(FIXED_COSTS_INR)}</dd>
            </div>
            <div>
              <dt>{t('report.netRevenue', 'Net revenue')}</dt>
              <dd className="num">{margins.net_revenue_inr !== null ? formatInr(margins.net_revenue_inr) : na}</dd>
            </div>
          </dl>
          <p className="report-note">{t('report.netMarginNote', 'Estimated operational, not statutory net profit. Add fixed costs to see what is left after running the business.')}</p>
        </div>
      </div>
      {wholePeriod ? <p className="report-note">{wholePeriod}</p> : null}
    </>
  );
}

export function ReportScreen() {
  const { t, i18n } = useTranslation();
  const loc = useHashLocation();
  const { analysis, dataset, samples, restoring, analysing, importing, engineVersion, workspace } = useStore();
  const auth = useAuth();
  const months = useMemo(() => (analysis ? monthsOf(analysis) : []), [analysis]);
  const asked = loc.route === 'report' ? loc.params.get('month') : null;
  const month = asked && months.includes(asked) ? asked : months[months.length - 1] ?? null;
  const extra = useReportData(analysis, month);
  const locale = localeFor(i18n.language);
  const { digest } = useDigest(analysis?.analysis_id ?? null, i18n.resolvedLanguage ?? i18n.language);

  if (!analysis) {
    if (restoring || analysing || importing) {
      return (
        <div className="page" role="status" aria-label={t('report.loading', 'Loading the analysis')}>
          <SkeletonCards count={4} />
          <div className="card skeleton-block" aria-hidden="true" />
        </div>
      );
    }
    const hasSaved = (workspace?.datasets.length ?? 0) > 0;
    return (
      <div className="page">
        <EmptyPanel
          icon="file"
          title={t('report.emptyTitle', 'No analysis to report on yet')}
          actions={
            <ButtonLink variant="primary" href={hrefFor('import')} icon="upload-cloud">
              {auth.mode === 'account' && hasSaved ? t('report.openSaved', 'Open saved data') : t('report.goImport', 'Go to Import')}
            </ButtonLink>
          }
        >
          {t('report.emptyText', 'The monthly report is built from the analysis you have open. Load the sample or your own orders on the Import step, then come back here.')}
        </EmptyPanel>
      </div>
    );
  }

  const monthLabel = (m: string) => monthStart(m).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const setMonth = (m: string) => window.location.replace(hrefFor('report', { month: m }));

  // Margins: the month's own when the API sends them per month, else the analysis's, labelled when it spans more months.
  const monthMargins = readMargins(extra.overview);
  const margins = monthMargins ?? readMargins(analysis);
  const wholePeriod =
    !monthMargins && margins && months.length > 1
      ? t('report.wholePeriod', 'Margins cover the whole analysis, {{from}} to {{to}}, not only {{month}}.', {
          from: monthLabel(months[0]),
          to: monthLabel(months[months.length - 1]),
          month: monthLabel(month ?? months[months.length - 1]),
        })
      : null;

  const name = datasetName(dataset?.source, dataset?.files, samples.find((s) => s.source === dataset?.source)?.label);
  const synthetic = analysis.orders.some((o) => o.synthetic);
  const headline = extra.overview && extra.overview.month === month ? extra.overview.headline : null;

  // Ledger totals: as reported, the late-refund adjustment, restated.
  const late = analysis.late_refunds;
  const observed = analysis.totals.contribution_inr;

  // Top leaks for the month: Pulse's leak months when available, else the analysis's leak groups.
  const leakMonth = extra.leaks?.months.find((m) => m.month === month) ?? null;
  const leakRows: Array<{ cause: string; label: string; lost: number | null; count: number | null }> = leakMonth
    ? Object.entries(leakMonth.by_cause)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([cause, lost]) => ({ cause, label: t(`focus.cause.${cause}`, LEAK_LABELS[cause as keyof typeof LEAK_LABELS] ?? cause.replace(/_/g, ' ')), lost, count: null }))
    : [...analysis.leaks]
        .sort((a, b) => (b.lost_inr ?? -1) - (a.lost_inr ?? -1))
        .slice(0, 5)
        .map((l) => ({ cause: l.cause, label: l.label, lost: l.lost_inr, count: l.count }));
  const leakTotal = leakRows.reduce((s, r) => s + (r.lost ?? 0), 0);
  const leaksFromAnalysis = !leakMonth;

  // Decisions: saved on this analysis, or saved during the month.
  const decisions = (extra.decisions ?? [])
    .filter((d) => d.analysis_id === analysis.analysis_id || monthOf(d.saved_at) === month)
    .sort((a, b) => b.saved_at.localeCompare(a.saved_at));

  const generated = new Date().toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
  const attribution = analysis.attribution === 'channel' ? t('report.attrChannel', 'channel spend') : t('report.attrAllocate', 'ads allocated per order');

  // Share: the month's contribution as shown (else the analysis total), the engine's top three fixes and the brief.
  const share = shareText({
    t,
    heading: t('share.reportHeading', 'Profyn monthly report · {{month}}', { month: month ? monthLabel(month) : '' }),
    contribution: headline ? headline.contribution_inr : analysis.totals.contribution_inr,
    actions: autopilotFromAnalysis(analysis).actions.map((a) => ({ label: a.label, delta: a.expected_delta_inr })),
    digest,
    url: appUrl(auth.mode !== 'account'),
  });

  return (
    <div className="page report-page">
      <div className="report-toolbar">
        <div className="report-toolbar-text">
          <h1 className="page-title">{t('report.title', 'Monthly report')}</h1>
          <p className="page-sub">{t('report.subtitle', 'An A4 summary of the open analysis, ready to print or save as PDF.')}</p>
        </div>
        <div className="report-toolbar-actions">
          <label className="field-label" htmlFor="report-month">
            {t('report.month', 'Month')}
          </label>
          <select id="report-month" className="input input-month" value={month ?? ''} onChange={(e) => setMonth(e.target.value)}>
            {[...months].reverse().map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <Button variant="primary" onClick={() => window.print()}>
            <PrinterIcon />
            {t('report.print', 'Print / Save as PDF')}
          </Button>
          <ShareActions text={share} />
        </div>
      </div>

      <article className={`report-sheet${extra.loading ? ' is-refreshing' : ''}`} aria-label={t('report.sheetAria', 'Monthly report for {{month}}', { month: month ? monthLabel(month) : '' })}>
        <header className="report-head">
          <div className="report-brand">
            <LogoMark size={36} />
            <span>
              <strong>{BRAND.name}</strong>
              <span className="report-brand-sub">{t('tagline', BRAND.tagline)}</span>
            </span>
          </div>
          <div className="report-title-block">
            <span className="report-kicker">{t('report.title', 'Monthly report')}</span>
            <span className="report-month">{month ? monthLabel(month) : '—'}</span>
          </div>
        </header>
        <dl className="report-meta">
          <div>
            <dt>{t('report.meta.data', 'Data')}</dt>
            <dd>
              {name}
              {synthetic ? (
                <span className="report-tag is-synthetic" title={t('report.syntheticTip', 'Rows marked synthetic in the file')}>
                  {t('report.synthetic', 'Synthetic')}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>{t('report.meta.orders', 'Orders')}</dt>
            <dd className="num">
              {formatCount(analysis.totals.orders)}
              {analysis.totals.unknown_count > 0 ? ` · ${t('report.meta.unknown', '{{n}} unknown', { n: analysis.totals.unknown_count })}` : ''}
            </dd>
          </div>
          <div>
            <dt>{t('report.meta.attribution', 'Attribution')}</dt>
            <dd>{attribution}</dd>
          </div>
          <div>
            <dt>{t('report.meta.periodEnd', 'Period end')}</dt>
            <dd>{formatDate(analysis.period_end)}</dd>
          </div>
          <div>
            <dt>{t('report.meta.engine', 'Engine')}</dt>
            <dd>{analysis.engine_version ?? engineVersion ?? '—'}</dd>
          </div>
          <div>
            <dt>{t('report.meta.generated', 'Generated')}</dt>
            <dd>{generated}</dd>
          </div>
        </dl>

        {headline ? (
          <div className="report-month-strip" aria-label={t('report.monthStripAria', 'This month at a glance')}>
            <Metric label={t('report.h.orders', 'Orders this month')} value={formatCount(headline.orders)} />
            <Metric label={t('report.h.netSales', 'Net sales')} value={formatInr(headline.net_sales_inr)} />
            <Metric label={t('report.h.contribution', 'Contribution')} value={<Money value={headline.contribution_inr} tone="contribution" />} />
            <Metric label={t('report.h.returns', 'Return rate')} value={headline.return_pct !== null ? formatPct(headline.return_pct) : '—'} />
          </div>
        ) : null}

        {digest && digest.sections.length > 0 ? (
          <section className="report-section report-digest" aria-labelledby="report-digest-title">
            <header className="report-section-head">
              <h2 id="report-digest-title" className="report-section-title">
                {t('report.digestTitle', 'The month in brief')}
              </h2>
              <span className="report-section-meta">
                <AiBadge source={digest.source} />
              </span>
            </header>
            <div className="report-digest-body">
              {digest.sections.map((s) => (
                <div key={s.key} className="report-digest-item">
                  <h3 className="report-digest-h">{s.title}</h3>
                  <p>{s.text}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <Section n={1} title={t('report.s1', 'Unit economics')} meta={margins?.orders_counted != null ? t('report.ordersCounted', '{{n}} orders counted', { n: formatCount(margins.orders_counted) }) : undefined}>
          <UnitEconomics margins={margins} wholePeriod={wholePeriod} handlingAssumed={handlingEstimateUsed(analysis)} />
        </Section>

        <Section n={2} title={t('report.s2', 'Ledger totals')} meta={t('report.periodTo', 'Period to {{date}}', { date: formatDate(late.period_end || analysis.period_end) })}>
          <table className="report-table report-ledger">
            <caption className="visually-hidden">{t('report.s2', 'Ledger totals')}</caption>
            <tbody>
              <tr>
                <th scope="row">
                  {t('report.l.observed', 'Contribution as reported')}
                  <span className="report-row-sub">{t('report.l.observedSub', 'Observed in the period; late refunds not yet recognised')}</span>
                </th>
                <td className="r num">
                  <Money value={observed} tone="contribution" />
                  {analysis.totals.partial ? <Pill tone="unknown" className="report-pill">{t('report.partial', 'partial')}</Pill> : null}
                </td>
              </tr>
              <tr>
                <th scope="row">
                  {t('report.l.adjustment', 'Late-refund prior-period adjustment')}
                  <span className="report-row-sub">
                    {late.orders.length > 0
                      ? t('report.l.adjustmentSub', '{{n}} refund(s) dated after the period end: {{ids}}', {
                          n: late.orders.length,
                          ids: late.orders.map((o) => (o.refund_date ? `${o.order_id} (${formatDate(o.refund_date)})` : o.order_id)).join(', '),
                        })
                      : t('report.l.noLate', 'No refund dated after the period end')}
                  </span>
                </th>
                <td className="r num">
                  <Money value={late.pending_delta_inr} signed />
                </td>
              </tr>
              <tr className="is-total">
                <th scope="row">
                  {t('report.l.restated', 'Restated total')}
                  <span className="report-row-sub">{t('report.l.restatedSub', 'With the late refunds recognised')}</span>
                </th>
                <td className="r num">
                  <Money value={late.total_if_recognised_inr} tone="contribution" />
                </td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Section
          n={3}
          title={t('report.s3', 'Top leaks')}
          meta={leaksFromAnalysis ? t('report.leaksWhole', 'Whole analysis') : month ? monthLabel(month) : undefined}
        >
          {leakRows.length === 0 ? (
            <p className="report-note">{t('report.noLeaks', 'No losing orders in this month.')}</p>
          ) : (
            <table className="report-table report-leaks">
              <thead>
                <tr>
                  <th scope="col">{t('report.col.cause', 'Cause')}</th>
                  {leaksFromAnalysis ? (
                    <th scope="col" className="r">
                      {t('report.col.orders', 'Orders')}
                    </th>
                  ) : null}
                  <th scope="col" className="r">
                    {t('report.col.lost', '₹ lost')}
                  </th>
                  <th scope="col" className="report-col-share">
                    {t('report.col.share', 'Share')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {leakRows.map((r) => {
                  const share = r.lost !== null && leakTotal > 0 ? (r.lost / leakTotal) * 100 : null;
                  return (
                    <tr key={r.cause}>
                      <th scope="row">{r.label}</th>
                      {leaksFromAnalysis ? <td className="r num">{r.count !== null ? formatCount(r.count) : '—'}</td> : null}
                      <td className="r num">{r.lost !== null ? formatInr(r.lost) : <Pill tone="unknown">{t('report.unknown', 'unknown')}</Pill>}</td>
                      <td className="report-col-share">
                        {share !== null ? (
                          <span className="report-share">
                            <span className="report-share-track" aria-hidden="true">
                              <span className="report-share-fill" style={{ width: `${Math.max(2, share)}%` }} />
                            </span>
                            <span className="num">{formatPct(share)}</span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Section>

        <Section n={4} title={t('report.s4', 'Decisions and their 30-day checks')}>
          {extra.decisions === null && !extra.loading ? (
            <p className="report-note">{t('report.noDecisionList', 'Saved decisions could not be loaded.')}</p>
          ) : decisions.length === 0 ? (
            <p className="report-note">
              {t('report.noDecisions', 'No decision saved on this analysis or during this month yet.')}{' '}
              <a className="report-screen-only" href={hrefFor('decision')}>
                {t('report.recordDecision', 'Record one on the Decision step')}
              </a>
            </p>
          ) : (
            <table className="report-table">
              <thead>
                <tr>
                  <th scope="col">{t('report.col.decision', 'Decision')}</th>
                  <th scope="col" className="r">
                    {t('report.col.expected', 'Expected / month')}
                  </th>
                  <th scope="col">{t('report.col.owner', 'Owner')}</th>
                  <th scope="col">{t('report.col.saved', 'Saved')}</th>
                  <th scope="col">{t('report.col.check', '30-day check')}</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d) => {
                  const due = addDays(d.saved_at, 30);
                  return (
                    <tr key={d.decision_id}>
                      <th scope="row">
                        {interventionText(t, d.intervention, d.intervention_label)}
                        {d.confidence === 'unknown' || d.confidence === 'low' ? (
                          <span className="report-row-sub">{t('report.confidence', 'confidence {{value}}', { value: lower(t(CONFIDENCE_KEY[d.confidence])) })}</span>
                        ) : null}
                      </th>
                      <td className="r num">{d.expected_delta_inr !== null ? formatInr(d.expected_delta_inr) : '—'}</td>
                      <td>{d.owner}</td>
                      <td className="num">{formatDate(d.saved_at)}</td>
                      <td className="num report-due">{due ? formatDate(due.toISOString()) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Section>

        <footer className="report-foot">
          <p>{t('report.disclaimer', 'Operational contribution, not statutory profit. Demo uses synthetic data where labelled.')}</p>
          <p className="report-foot-meta">
            {BRAND.name} · {t('report.title', 'Monthly report')} · {month ? monthLabel(month) : ''} · <Assumed /> {t('report.assumedLegend', 'marks a value that is assumed, not read from the file')}
          </p>
        </footer>
      </article>
    </div>
  );
}
