import type { TFunction } from 'i18next';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnalysisResponse, Candidate, Evidence, Observed, OrderDelta, OverrideKey, Recommendation, ScenarioColumn, ScenarioOverrides, ScenarioResponse } from '../api/types';
import { BarRows, type BarRow } from '../charts/BarRows';
import { ChartCard } from '../charts/ChartCard';
import { ConfidenceBadge, Pill, SourceTag, Unknown } from '../components/Badge';
import { EvidenceBadge } from '../components/EvidenceBadge';
import { recommendationNote, ScenarioImpact } from '../components/ScenarioImpact';
import { Button, ButtonLink } from '../components/Button';
import { NeedsAnalysis } from '../components/EmptyState';
import { ErrorNote } from '../components/ErrorNote';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/Page';
import { Change, Money } from '../components/Money';
import { Provenance, ProvenanceValue } from '../components/Provenance';
import { NumberInput, SliderField } from '../components/SliderField';
import { Table, type Column } from '../components/Table';
import { Callout, Collapsible, InfoTip, revealElement, Skeleton, StatCard } from '../components/ui';
import { lower } from '../i18n';
import { apiText } from '../lib/apiText';
import { formatCount, formatInr, formatPct, formatSignedDecimal, formatSignedInr } from '../lib/format';
import { OVERRIDE_LABELS } from '../lib/labels';
import { hrefFor, navigate } from '../lib/router';
import { isRunnable, OVERRIDE_KEYS, sameOverrides, useStore } from '../state/store';

type MainValue = number | 'full' | 'partial';

/**
 * Exactly one changed variable: keeps the first override that is set (in control order), drops the rest.
 * The unknown-refund assumption may ride along.
 */
export function oneAtATime(o: ScenarioOverrides): ScenarioOverrides {
  const first = OVERRIDE_KEYS.find((k) => o[k] !== undefined);
  const next: ScenarioOverrides = {};
  if (first) (next as Record<string, unknown>)[first] = o[first];
  if (o.assume_unknown_refund) next.assume_unknown_refund = true;
  return next;
}

/** Changing one assumption resets the others to observed; the unknown-refund assumption is kept. */
function withOne(current: ScenarioOverrides, key: OverrideKey, value: MainValue | null): ScenarioOverrides {
  const next: ScenarioOverrides = {};
  if (value !== null) (next as Record<string, MainValue>)[key] = value;
  if (current.assume_unknown_refund) next.assume_unknown_refund = true;
  return next;
}

function sliderMax(avg: number | null): number {
  return Math.max(200, Math.ceil(((avg ?? 0) * 3) / 50) * 50);
}

const CHOICES: Array<{ key: OverrideKey; title: string }> = [
  { key: 'return_rate_pct', title: 'scenario.returnRate' },
  { key: 'recovery_pct', title: 'scenario.recoveryPerReturn' },
  { key: 'shipping_inr', title: 'scenario.shippingCost' },
  { key: 'refund_policy', title: 'scenario.refundPolicy' },
  { key: 'ads_per_order', title: 'scenario.adsPerOrder' },
];

function observedText(t: TFunction, key: OverrideKey, obs: Observed): string {
  const unknown = lower(t('status.unknown'));
  switch (key) {
    case 'return_rate_pct':
      return formatPct(obs.return_rate_pct);
    case 'recovery_pct': {
      if (obs.recovery_pct === null) return unknown;
      const avg = obs.avg_product_cost_on_returns_inr;
      return avg ? `${formatInr(Math.round((obs.recovery_pct / 100) * avg))} · ${formatPct(obs.recovery_pct)}` : formatPct(obs.recovery_pct);
    }
    case 'shipping_inr':
      return obs.avg_shipping_inr === null ? unknown : t('scenario.avg', 'avg {{inr}}', { inr: formatInr(Math.round(obs.avg_shipping_inr)) });
    case 'refund_policy':
      return t('scenario.asRecordedLower', 'as recorded');
    case 'ads_per_order':
      return obs.avg_ads_per_order_inr === null ? unknown : t('scenario.avg', 'avg {{inr}}', { inr: formatInr(Math.round(obs.avg_ads_per_order_inr)) });
  }
}

function overrideValueText(t: TFunction, key: OverrideKey, o: ScenarioOverrides, obs: Observed): string | null {
  const v = o[key];
  if (v === undefined) return null;
  if (key === 'refund_policy') return v === 'partial' ? t('scenario.partialLower', 'partial, 80%') : t('scenario.fullLower', 'full refund');
  if (key === 'recovery_pct' && typeof v === 'number') {
    const avg = obs.avg_product_cost_on_returns_inr;
    return avg ? `${formatInr(Math.round((v / 100) * avg))} · ${formatPct(v)}` : formatPct(v);
  }
  if (key === 'return_rate_pct' && typeof v === 'number') return formatPct(v);
  return typeof v === 'number' ? formatInr(v) : String(v);
}

function ChoiceBody({ k, obs, overrides, onChange }: { k: OverrideKey; obs: Observed; overrides: ScenarioOverrides; onChange: (o: ScenarioOverrides) => void }) {
  const set = (v: MainValue | null) => onChange(withOne(overrides, k, v));
  const policyName = useId();
  const { t } = useTranslation();

  if (k === 'return_rate_pct') {
    return (
      <SliderField
        compact
        id="sc-return"
        label={t('scenario.returnRatePct', 'Return rate, percent')}
        min={0}
        max={100}
        step={1}
        value={overrides.return_rate_pct ?? null}
        rest={obs.return_rate_pct}
        suffix="%"
        onChange={set}
      />
    );
  }

  if (k === 'recovery_pct') {
    const avgCost = obs.avg_product_cost_on_returns_inr;
    const canInr = avgCost !== null && avgCost > 0;
    const recPct = overrides.recovery_pct ?? obs.recovery_pct ?? 0;
    const recInr = canInr ? (recPct / 100) * avgCost : null;
    return (
      <div className="control control-compact">
        <div className="control-row control-row-3">
          <input
            type="range"
            className="range"
            min={0}
            max={100}
            step={0.5}
            value={recPct}
            aria-label={t('scenario.recoverySliderAria', 'Recovery of product cost on returns, percent')}
            aria-describedby="sc-rec-hint"
            onChange={(e) => set(Number(e.target.value))}
          />
          <NumberInput
            id="sc-rec-inr"
            value={recInr}
            min={0}
            max={avgCost ?? 0}
            prefix="₹"
            ariaLabel={t('scenario.recoveredInrAria', 'Recovered rupees per return')}
            describedBy="sc-rec-hint"
            disabled={!canInr}
            onCommit={(v) => set(v === null || !canInr ? null : (v / avgCost) * 100)}
          />
          <NumberInput
            id="sc-rec-pct"
            value={recPct}
            min={0}
            max={100}
            step={0.1}
            places={1}
            suffix="%"
            ariaLabel={t('scenario.recoveryPctAria', 'Recovery as a percent of product cost')}
            describedBy="sc-rec-hint"
            onCommit={set}
          />
        </div>
        <p id="sc-rec-hint" className="control-hint">
          {canInr
            ? t('scenario.recoveryHint', '₹ per return, out of an average product cost of {{inr}} on returned orders.', { inr: formatInr(avgCost) })
            : t('scenario.recoveryNoCost', 'No returns with a known product cost; set recovery as a percent.')}
        </p>
      </div>
    );
  }

  if (k === 'shipping_inr' || k === 'ads_per_order') {
    const avg = k === 'shipping_inr' ? obs.avg_shipping_inr : obs.avg_ads_per_order_inr;
    return (
      <SliderField
        compact
        id={k === 'shipping_inr' ? 'sc-ship' : 'sc-ads'}
        label={k === 'shipping_inr' ? t('scenario.shippingInrLabel', 'Shipping per order, rupees') : t('scenario.adsInrLabel', 'Ads per order, rupees')}
        min={0}
        max={sliderMax(avg)}
        step={1}
        value={overrides[k] ?? null}
        rest={Math.round(avg ?? 0)}
        blankPlaceholder={t('scenario.own', 'own')}
        prefix="₹"
        hint={k === 'shipping_inr' ? t('scenario.blankShipping', 'Blank uses each order’s own shipping.') : t('scenario.blankAds', 'Blank uses each order’s own ads.')}
        onChange={set}
      />
    );
  }

  // refund_policy
  return (
    <div className="segmented segmented-3" role="radiogroup" aria-label={t('scenario.policyAria', 'Refund policy on returns')}>
      {(
        [
          [null, t('scenario.asRecorded', 'As recorded')],
          ['full', t('scenario.fullRefund', 'Full refund')],
          ['partial', t('scenario.partial80', 'Partial, 80%')],
        ] as Array<[('full' | 'partial') | null, string]>
      ).map(([v, label]) => (
        <label key={v ?? 'recorded'} className="segmented-item">
          <input type="radio" name={policyName} checked={(overrides.refund_policy ?? null) === v} onChange={() => set(v)} />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

function Controls({ obs, overrides, onChange }: { obs: Observed; overrides: ScenarioOverrides; onChange: (o: ScenarioOverrides) => void }) {
  const groupName = useId();
  const { t } = useTranslation();
  const active = OVERRIDE_KEYS.find((k) => overrides[k] !== undefined) ?? null;
  const [selected, setSelected] = useState<OverrideKey | null>(active);

  // Follow the override when it changes from outside (reset, a new analysis).
  useEffect(() => {
    if (active) setSelected(active);
  }, [active]);

  const select = (k: OverrideKey) => {
    setSelected(k);
    if (active && active !== k) onChange(withOne(overrides, k, null));
  };

  return (
    <fieldset className="choice-list">
      <legend className="visually-hidden">{t('scenario.changeOne')}</legend>
      {CHOICES.map((c) => {
        const isSel = selected === c.key;
        const value = overrideValueText(t, c.key, overrides, obs);
        return (
          <div key={c.key} className={`choice${isSel ? ' is-selected' : ''}${value ? ' is-changed' : ''}`}>
            <label className="choice-head">
              <input type="radio" name={groupName} checked={isSel} onChange={() => select(c.key)} />
              <span className="choice-title">{t(c.title)}</span>
              <span className="choice-meta" data-control={c.key}>
                {value ? <ProvenanceValue kind="assumed" value={<strong className="assumed-value">{value}</strong>} /> : <ProvenanceValue kind="observed" value={observedText(t, c.key, obs)} />}
              </span>
            </label>
            {isSel ? (
              <div className="choice-body">
                <ChoiceBody k={c.key} obs={obs} overrides={overrides} onChange={onChange} />
              </div>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}

interface CompareRow {
  id: string;
  /** English text of labelKey. */
  label: string;
  labelKey: string;
  key: keyof Omit<ScenarioColumn, 'by_channel'>;
  goodWhen: 'up' | 'down';
  money: boolean;
  strong?: boolean;
}

const ROWS: CompareRow[] = [
  { id: 'computed', label: 'Orders computed', labelKey: 'scenario.rowComputed', key: 'computed', goodWhen: 'up', money: false },
  { id: 'returns', label: 'Returns', labelKey: 'scenario.rowReturns', key: 'returns', goodWhen: 'down', money: false },
  { id: 'net', label: 'Net sales', labelKey: 'ledger.netSales', key: 'net_sales_inr', goodWhen: 'up', money: true },
  { id: 'npc', label: 'Net product cost', labelKey: 'scenario.rowNpc', key: 'net_product_cost_inr', goodWhen: 'down', money: true },
  { id: 'ship', label: 'Shipping', labelKey: 'ledger.shipping', key: 'shipping_inr', goodWhen: 'down', money: true },
  { id: 'fee', label: 'Payment fee', labelKey: 'scenario.rowFee', key: 'payment_fee_inr', goodWhen: 'down', money: true },
  { id: 'ret', label: 'Return cost', labelKey: 'ledger.returnCost', key: 'return_cost_inr', goodWhen: 'down', money: true },
  { id: 'hand', label: 'Handling', labelKey: 'ledger.handling', key: 'handling_inr', goodWhen: 'down', money: true },
  { id: 'ads', label: 'Ads', labelKey: 'ledger.ads', key: 'ads_inr', goodWhen: 'down', money: true },
  { id: 'contribution', label: 'Operational contribution', labelKey: 'ledger.operationalContribution', key: 'contribution_inr', goodWhen: 'up', money: true, strong: true },
];

function cellValue(col: ScenarioColumn | ScenarioResponse['delta'], r: CompareRow, isDelta: boolean) {
  const v = col[r.key] as number | null;
  if (v === null) return <Unknown />;
  if (isDelta) return r.money ? <Change value={v} goodWhen={r.goodWhen} /> : <Change value={v} goodWhen={r.goodWhen} format={formatSignedDecimal} />;
  if (!r.money) return <span className="num">{formatCount(v)}</span>;
  return <Money value={v} tone={r.strong ? 'contribution' : 'plain'} />;
}

function Comparison({ s }: { s: ScenarioResponse }) {
  const { t } = useTranslation();
  const columns: Column<CompareRow>[] = [
    { id: 'line', header: t('scenario.line'), rowHeader: true, cell: (r) => t(r.labelKey, r.label) },
    { id: 'base', header: t('scenario.observedBaseline', 'Observed baseline'), align: 'right', cell: (r) => cellValue(s.baseline, r, false) },
    { id: 'scenario', header: t('scenario.assumedScenario', 'Assumed scenario'), align: 'right', cell: (r) => cellValue(s.scenario, r, false) },
    { id: 'change', header: t('scenario.delta'), align: 'right', cell: (r) => cellValue(s.delta, r, true) },
  ];
  return (
    <Table
      caption={t('scenario.compareCaption', 'Baseline and scenario, line by line')}
      columns={columns}
      rows={ROWS}
      rowKey={(r) => r.id}
      rowClassName={(r) => (r.strong ? 'row-strong' : !r.money ? 'row-muted' : undefined)}
      className="compare-table"
    />
  );
}

function OrderDeltas({ rows }: { rows: OrderDelta[] }) {
  const { t } = useTranslation();
  const columns: Column<OrderDelta>[] = [
    { id: 'order', header: t('ledger.order'), rowHeader: true, cell: (d) => d.order_id },
    { id: 'base', header: t('scenario.observedBaseline', 'Observed baseline'), align: 'right', cell: (d) => <Money value={d.baseline_inr} tone="contribution" /> },
    { id: 'scenario', header: t('scenario.assumedScenario', 'Assumed scenario'), align: 'right', cell: (d) => <Money value={d.scenario_inr} tone="contribution" /> },
    { id: 'delta', header: t('scenario.delta'), align: 'right', cell: (d) => (d.delta_inr === null ? <Unknown /> : <Change value={d.delta_inr} goodWhen="up" />) },
  ];
  return (
    <Table
      caption={t('scenario.deltasCaption', 'Per-order change, top 10 by size')}
      columns={columns}
      rows={rows.slice(0, 10)}
      rowKey={(d) => d.order_id}
      emptyText={t('scenario.noDeltas', 'No order changes.')}
    />
  );
}

function ContributionCards({
  a,
  s,
  loading,
  onCompare,
  onControls,
}: {
  a: AnalysisResponse;
  s: ScenarioResponse | null;
  loading: boolean;
  onCompare: () => void;
  onControls: () => void;
}) {
  const { t } = useTranslation();
  const base = s ? s.baseline.contribution_inr : a.totals.contribution_inr;
  const scen = s ? s.scenario.contribution_inr : null;
  const delta = s ? s.delta.contribution_inr : null;
  const unknown = lower(t('status.unknown'));
  const baseText = base === null ? unknown : formatInr(base);
  const vsBaseline = (d: number) => t('scenario.vsBaseline', '{{inr}} vs baseline', { inr: formatSignedInr(d) });
  return (
    <div className="kpi-grid kpi-grid-2">
      <StatCard
        label={t('scenario.baselineOperational', 'Baseline operational contribution')}
        large
        value={<Money value={base} tone="contribution" />}
        sub={
          <ProvenanceValue
            kind="observed"
            value={t('scenario.asInLedger', 'as in the ledger')}
            chips={
              a.totals.partial ? (
                <Pill tone="warning" dot>
                  {t('status.partial')} · {a.totals.unknown_count} {lower(t('status.unknown'))}
                </Pill>
              ) : null
            }
          />
        }
        actionIcon={s ? 'chevron-down' : 'arrow-right'}
        onClick={s ? onCompare : () => navigate('ledger')}
        actionLabel={
          s
            ? t('scenario.baseOpenCompare', 'Baseline contribution {{v}} — open the line-item comparison', { v: baseText })
            : t('scenario.baseOpenLedger', 'Baseline contribution {{v}} — open the ledger it comes from', { v: baseText })
        }
      />
      {s ? (
        <StatCard
          label={t('scenario.scenarioOperational', 'Scenario operational contribution')}
          large
          tone="primary"
          value={<Money value={scen} tone="contribution" />}
          sub={
            <>
              <Provenance kind="assumed" />
              {delta === null ? <Unknown /> : <Pill tone={delta > 0 ? 'success' : delta < 0 ? 'danger' : 'neutral'}>{vsBaseline(delta)}</Pill>}
              <span className="kpi-note">{t('scenario.changedMeta', 'Changed: {{what}}', { what: OVERRIDE_LABELS[s.changed as OverrideKey] ?? s.changed })}</span>
            </>
          }
          actionIcon="chevron-down"
          onClick={onCompare}
          actionLabel={t('scenario.scenOpenCompare', 'Scenario contribution {{v}}, {{change}} — open the line-item comparison', {
            v: scen === null ? unknown : formatInr(scen),
            change: delta === null ? t('scenario.changeUnknown', 'change unknown') : vsBaseline(delta),
          })}
        />
      ) : loading ? (
        <div className="card kpi kpi-large kpi-primary" aria-busy="true">
          <span className="kpi-head">
            <span className="kpi-label">{t('scenario.scenarioContribution')}</span>
          </span>
          <Skeleton width="60%" height={30} className="skeleton-gap" />
          <Skeleton width="40%" height={14} className="skeleton-gap" />
        </div>
      ) : (
        <StatCard
          label={t('scenario.scenarioContribution')}
          large
          tone="primary"
          value={<span className="kpi-none">—</span>}
          sub={t('scenario.runHint', 'Change one assumption to see it')}
          actionIcon="arrow-right"
          onClick={onControls}
          actionLabel={t('scenario.notRunAria', 'Scenario contribution not run yet — go to the assumptions')}
        />
      )}
    </div>
  );
}

function RecommendationCard({ rec, scenario, why, whySource, evidence, note }: { rec: Recommendation; scenario: ScenarioResponse | null; why: string; whySource: 'template' | 'ai'; evidence?: Evidence | null; note?: string | null }) {
  const { t } = useTranslation();
  const before = scenario?.baseline_recommendation;
  return (
    <section className="card rec-card" aria-labelledby="rec-title">
      <div className="rec-top">
        <span className="pill pill-ai">
          <Icon name="sparkles" size={12} strokeWidth={2} />
          {t('scenario.recommendation')}
        </span>
        <span className="muted small">{scenario ? t('scenario.underScenario', 'under this scenario') : t('scenario.atBaseline', 'at the observed baseline')}</span>
      </div>
      {before ? (
        <p className="flip">
          <span className="flip-part">
            <span className="flip-label">{t('scenario.before', 'Before:')}</span> {before.label} <span className="num">{formatInr(before.expected_delta_inr)}</span> <Provenance kind="observed" />
          </span>
          <Icon name="arrow-right" size={16} className="flip-arrow" />
          <span className="flip-part flip-now">
            <span className="flip-label">{t('scenario.now', 'Now:')}</span> <strong>{apiText(rec.label)}</strong> <span className="num">{formatInr(rec.expected_delta_inr)}</span> <Provenance kind="assumed" />
          </span>
          {before.intervention === rec.intervention ? <span className="muted small">{t('scenario.sameIntervention', '(same intervention)')}</span> : null}
        </p>
      ) : null}
      <div className="rec-main">
        <div>
          <h2 id="rec-title" className="rec-title">
            {apiText(rec.label)}
          </h2>
          {rec.rule ? <p className="rec-rule">{apiText(rec.rule)}</p> : null}
        </div>
        <div className="rec-figure">
          <span className="rec-figure-label">
            {t('scenario.expectedPerPeriod', 'Expected per period')} <Provenance kind={scenario ? 'assumed' : 'observed'} />
          </span>
          <span className="rec-figure-value">
            <Money value={rec.expected_delta_inr} tone="contribution" signed />
          </span>
        </div>
      </div>
      <p className="rec-confidence">
        {evidence ? (<><EvidenceBadge evidence={evidence} /><span>{apiText(evidence.reason)} {t('evidence.useBoth', 'Use this recommendation to save a decision or to test it in the Scenario.')}</span></>) : (<><ConfidenceBadge confidence={rec.confidence} prefix={lower(t('scenario.confidence'))} /><span>{apiText(rec.confidence_reason)}</span></>)}
      </p>
      {note ? <p className="rec-note">{note}</p> : null}
      <p className="rec-why">
        {why} <SourceTag source={whySource} />
      </p>
      <ButtonLink variant="primary" href={hrefFor('decision')} iconRight="arrow-right">
        {t('actions.useInDecision')}
      </ButtonLink>
    </section>
  );
}

function CandidatesChart({ rec, candidates, baseline }: { rec: Recommendation; candidates: Candidate[]; baseline?: Candidate[] | null }) {
  const was = (key: string) => baseline?.find((c) => c.intervention === key)?.delta_inr ?? null;
  const { t } = useTranslation();
  const rows: BarRow[] = candidates.map((c) => ({
    key: c.intervention,
    label: c.label,
    sub: `${apiText(c.rule)} · ${t('leaks.orderCount', { count: c.driving_orders })}`,
    emphasis: c.intervention === rec.intervention,
    values: [{ series: t('scenario.changeInContribution', 'Change in contribution'), value: c.delta_inr, tone: c.intervention === rec.intervention ? 'series-1' : 'muted', text: baseline && was(c.intervention) !== null && was(c.intervention) !== c.delta_inr ? `${formatSignedInr(c.delta_inr)} (${t('impact.was', 'was {{v}}', { v: formatSignedInr(was(c.intervention) as number) })})` : formatSignedInr(c.delta_inr) }],
  }));
  const table = (
    <table className="table table-compact">
      <caption className="visually-hidden">{t('scenario.candidatesCaption', 'Candidates with rule, change and driving orders')}</caption>
      <thead>
        <tr>
          <th scope="col">{t('decision.intervention')}</th>
          <th scope="col">{t('scenario.rule')}</th>
          {baseline ? (<th scope="col" className="r">{t('impact.atBaseline', 'At baseline')}</th>) : null}
          <th scope="col" className="r">
            {t('scenario.delta')}
          </th>
          <th scope="col" className="r">
            {t('ledger.orders')}
          </th>
        </tr>
      </thead>
      <tbody>
        {candidates.map((c) => (
          <tr key={c.intervention}>
            <th scope="row">{apiText(c.label)}</th>
            <td className="cell-wrap">{apiText(c.rule)}</td>
            {baseline ? (<td className="r num">{was(c.intervention) === null ? '—' : formatSignedInr(was(c.intervention) as number)}</td>) : null}
            <td className="r num">{formatSignedInr(c.delta_inr)}</td>
            <td className="r num">{c.driving_orders}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <ChartCard
      title={t('scenario.allCandidates', 'All candidates')}
      subtitle={t('scenario.allCandidatesSub', 'Change in contribution if each rule were applied; the recommended one is highlighted.')}
      table={table}
    >
      <BarRows rows={rows} ariaLabel={t('scenario.candidatesAria', 'Change in contribution by candidate intervention')} labelWidth={300} />
    </ChartCard>
  );
}

function Results({ children, loading }: { children: ReactNode; loading: boolean }) {
  return <div className={`stack${loading ? ' is-refreshing' : ''}`}>{children}</div>;
}

export function ScenarioScreen() {
  const { analysis, narration, scenario, scenarioOverrides, scenarioLoading, scenarioError, overrides, setOverrides, runScenario } = useStore();
  const analysisId = analysis?.analysis_id ?? null;
  const current = analysis && scenario && scenario.analysis_id === analysis.analysis_id ? scenario : null;
  const [compareOpen, setCompareOpen] = useState(false);
  const controlsRef = useRef<HTMLElement>(null);
  const { t } = useTranslation();

  const openCompare = () => {
    setCompareOpen(true);
    window.setTimeout(() => revealElement(document.getElementById('line-items')), 0);
  };
  const toControls = () => {
    revealElement(controlsRef.current, false);
    controlsRef.current?.querySelector<HTMLInputElement>('.choice-head input')?.focus({ preventScroll: true });
  };

  // Exactly one changed variable: anything that arrives with more is cut back to its first change.
  useEffect(() => {
    if (OVERRIDE_KEYS.filter((k) => overrides[k] !== undefined).length > 1) setOverrides(oneAtATime(overrides));
  }, [overrides, setOverrides]);

  // No post on entry: the baseline is the analysis. A runnable change re-runs 250 ms after the controls settle.
  useEffect(() => {
    if (!analysisId) return undefined;
    if (scenarioOverrides && sameOverrides(overrides, scenarioOverrides)) return undefined;
    if (!isRunnable(overrides)) {
      if (scenarioOverrides) void runScenario(overrides);
      return undefined;
    }
    const t = window.setTimeout(() => void runScenario(overrides), 250);
    return () => window.clearTimeout(t);
  }, [analysisId, overrides, scenarioOverrides, runScenario]);

  if (!analysis) {
    return (
      <div className="page">
        <PageHeader title={t('scenario.pageTitle')} subtitle={t('scenario.emptySub', 'Change one assumption and watch the recommendation move.')} />
        <NeedsAnalysis sentence={t('scenario.empty', 'No analysis yet. Load the sample orders to compare a scenario against the observed baseline.')} icon="sliders" />
      </div>
    );
  }

  const obs = analysis.observed;
  const refundGaps = obs.refund_unknown_orders;
  const unknownOrders = analysis.totals.unknown_count;
  const hasAny = OVERRIDE_KEYS.some((k) => overrides[k] !== undefined) || overrides.assume_unknown_refund === true;
  const changedKey = OVERRIDE_KEYS.find((k) => overrides[k] !== undefined) ?? null;
  const rec = current?.recommendation ?? analysis.recommendation;
  const candidates = current?.candidates ?? analysis.candidates;
  const aiWhy = !current && narration?.recommendation?.why_source === 'ai' ? narration.recommendation.why : null;

  return (
    <div className="page">
      <PageHeader title={t('scenario.pageTitle')} subtitle={t('scenario.subtitle', 'Change one assumption at a time; the baseline is the observed ledger.')} />

      {refundGaps > 0 ? (
        <Callout tone="warning" title={t('scenario.refundGaps', '{{count}} orders have missing refund facts — results below are a labelled scenario.', { count: refundGaps })} />
      ) : unknownOrders > 0 ? (
        <Callout tone="warning" title={t('scenario.unknownGaps', '{{count}} orders have missing facts — results below are a labelled scenario.', { count: unknownOrders })} />
      ) : null}

      <div className="grid-scenario">
        <section className="card controls-card" aria-labelledby="controls-title" ref={controlsRef}>
          <div className="card-head">
            <h2 id="controls-title" className="card-title">
              {t('scenario.changeOne')}
            </h2>
            <InfoTip
              text={t('scenario.oneTip', 'A controlled scenario changes one thing. Picking another assumption resets the previous one to observed.')}
              label={t('scenario.oneTipLabel', 'Why one at a time')}
            />
          </div>
          <p className="card-sub">{t('scenario.oneSub', 'One assumption at a time. Changing one resets the others to observed.')}</p>
          <p className="changed-line" role="status">
            {changedKey ? (
              <>
                <Provenance kind="assumed" /> {t('scenario.changedOne', '1 of 5 changed: {{what}}', { what: t(CHOICES.find((c) => c.key === changedKey)?.title ?? '', OVERRIDE_LABELS[changedKey]) })}
              </>
            ) : (
              <>
                <Provenance kind="observed" /> {t('scenario.nothingChanged', 'Nothing changed: every value is observed.')}
              </>
            )}
          </p>
          <Controls obs={obs} overrides={overrides} onChange={(o) => setOverrides(oneAtATime(o))} />

          <div className={`switch-row${overrides.assume_unknown_refund ? ' is-on' : ''}`}>
            <label className="switch">
              <input
                type="checkbox"
                role="switch"
                checked={overrides.assume_unknown_refund === true}
                disabled={refundGaps === 0}
                aria-describedby="sc-assume-hint"
                onChange={(e) => {
                  const next = { ...overrides };
                  if (e.target.checked) next.assume_unknown_refund = true;
                  else delete next.assume_unknown_refund;
                  setOverrides(next);
                }}
              />
              <span className="switch-track" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
              <span className="switch-label">{t('scenario.assumeRefunds', 'Assume unknown refunds')}</span>
            </label>
            <span className="switch-prov" data-control="assume_unknown_refund">
              <Provenance kind={overrides.assume_unknown_refund ? 'assumed' : 'observed'} />
            </span>
            <p id="sc-assume-hint" className="control-hint">
              {refundGaps === 0
                ? t('scenario.noGaps', 'No returned order is missing its refund in this dataset.')
                : t('scenario.fillGaps', 'Fill {{count}} missing refund facts with a stated assumption; works alone or with one change above.', { count: refundGaps })}
            </p>
          </div>
          {overrides.assume_unknown_refund ? (
            <Callout tone="warning" title={t('scenario.inForce', 'Assumption in force')} className="assumption-banner">
              <p>{t('scenario.inForceBody', 'Returned orders with missing refund facts are filled in, not measured. Treat the scenario as an estimate.')}</p>
            </Callout>
          ) : null}

          <div className="card-actions">
            <Button variant="primary" icon="refresh" onClick={() => void runScenario(overrides)} disabled={!isRunnable(overrides) || scenarioLoading}>
              {t('actions.runScenario')}
            </Button>
            <Button variant="secondary" onClick={() => setOverrides({})} disabled={!hasAny}>
              {t('actions.reset')}
            </Button>
          </div>
          <ErrorNote error={scenarioError} />
        </section>

        <Results loading={scenarioLoading && current !== null}>
          <ContributionCards a={analysis} s={current} loading={scenarioLoading} onCompare={openCompare} onControls={toControls} />
          <RecommendationCard rec={rec} scenario={current} why={aiWhy ?? rec.why} whySource={aiWhy ? 'ai' : rec.why_source} evidence={(current ? current.evidence : analysis.evidence)?.[rec.intervention]} note={current ? recommendationNote(t, analysis.candidates, current.candidates, rec.intervention) : null} />
          {current ? <ScenarioImpact s={current} /> : null}
          <CandidatesChart rec={rec} candidates={candidates} baseline={current ? analysis.candidates : null} />
          {current && current.assumptions.length > 0 ? (
            <Callout tone="info" title={t('scenario.notes', 'Scenario notes')}>
              <ul className="plain-list">
                {current.assumptions.map((l) => (
                  <li key={l}>{apiText(l)}</li>
                ))}
              </ul>
            </Callout>
          ) : null}
          {current ? (
            <>
              <Collapsible
                id="line-items"
                open={compareOpen}
                onToggle={setCompareOpen}
                title={t('scenario.lineItems', 'Line-item comparison')}
                meta={t('scenario.changedMeta', 'Changed: {{what}}', { what: OVERRIDE_LABELS[current.changed as OverrideKey] ?? current.changed })}
              >
                <Comparison s={current} />
              </Collapsible>
              {current.delta.by_order.length > 0 ? (
                <Collapsible title={t('scenario.movers', 'Orders that move most')} meta={t('scenario.topN', 'Top {{n}}', { n: Math.min(10, current.delta.by_order.length) })}>
                  <OrderDeltas rows={current.delta.by_order} />
                </Collapsible>
              ) : null}
            </>
          ) : null}
        </Results>
      </div>
    </div>
  );
}
