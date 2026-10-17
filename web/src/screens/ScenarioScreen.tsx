import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnalysisResponse, Candidate, Observed, OrderDelta, OverrideKey, Recommendation, ScenarioColumn, ScenarioOverrides, ScenarioResponse } from '../api/types';
import { BarRows, type BarRow } from '../charts/BarRows';
import { ChartCard } from '../charts/ChartCard';
import { ConfidenceBadge, Pill, SourceTag, Unknown } from '../components/Badge';
import { Button, ButtonLink } from '../components/Button';
import { NeedsAnalysis } from '../components/EmptyState';
import { ErrorNote } from '../components/ErrorNote';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/Page';
import { Change, Money } from '../components/Money';
import { NumberInput, SliderField } from '../components/SliderField';
import { Table, type Column } from '../components/Table';
import { Callout, Collapsible, InfoTip, revealElement, Skeleton, StatCard } from '../components/ui';
import { lower } from '../i18n';
import { formatCount, formatInr, formatPct, formatSignedDecimal, formatSignedInr, plural } from '../lib/format';
import { OVERRIDE_LABELS } from '../lib/labels';
import { hrefFor, navigate } from '../lib/router';
import { isRunnable, OVERRIDE_KEYS, sameOverrides, useStore } from '../state/store';

type MainValue = number | 'full' | 'partial';

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

function observedText(key: OverrideKey, obs: Observed): string {
  switch (key) {
    case 'return_rate_pct':
      return `observed ${formatPct(obs.return_rate_pct)}`;
    case 'recovery_pct': {
      if (obs.recovery_pct === null) return 'observed unknown';
      const avg = obs.avg_product_cost_on_returns_inr;
      return avg ? `observed ${formatInr(Math.round((obs.recovery_pct / 100) * avg))} · ${formatPct(obs.recovery_pct)}` : `observed ${formatPct(obs.recovery_pct)}`;
    }
    case 'shipping_inr':
      return obs.avg_shipping_inr === null ? 'observed unknown' : `observed avg ${formatInr(Math.round(obs.avg_shipping_inr))}`;
    case 'refund_policy':
      return 'observed as recorded';
    case 'ads_per_order':
      return obs.avg_ads_per_order_inr === null ? 'observed unknown' : `observed avg ${formatInr(Math.round(obs.avg_ads_per_order_inr))}`;
  }
}

function overrideValueText(key: OverrideKey, o: ScenarioOverrides, obs: Observed): string | null {
  const v = o[key];
  if (v === undefined) return null;
  if (key === 'refund_policy') return v === 'partial' ? 'partial, 80%' : 'full refund';
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

  if (k === 'return_rate_pct') {
    return (
      <SliderField
        compact
        id="sc-return"
        label="Return rate, percent"
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
            aria-label="Recovery of product cost on returns, percent"
            aria-describedby="sc-rec-hint"
            onChange={(e) => set(Number(e.target.value))}
          />
          <NumberInput
            id="sc-rec-inr"
            value={recInr}
            min={0}
            max={avgCost ?? 0}
            prefix="₹"
            ariaLabel="Recovered rupees per return"
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
            ariaLabel="Recovery as a percent of product cost"
            describedBy="sc-rec-hint"
            onCommit={set}
          />
        </div>
        <p id="sc-rec-hint" className="control-hint">
          {canInr ? `₹ per return, out of an average product cost of ${formatInr(avgCost)} on returned orders.` : 'No returns with a known product cost; set recovery as a percent.'}
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
        label={k === 'shipping_inr' ? 'Shipping per order, rupees' : 'Ads per order, rupees'}
        min={0}
        max={sliderMax(avg)}
        step={1}
        value={overrides[k] ?? null}
        rest={Math.round(avg ?? 0)}
        blankPlaceholder="own"
        prefix="₹"
        hint={`Blank uses each order’s own ${k === 'shipping_inr' ? 'shipping' : 'ads'}.`}
        onChange={set}
      />
    );
  }

  // refund_policy
  return (
    <div className="segmented segmented-3" role="radiogroup" aria-label="Refund policy on returns">
      {(
        [
          [null, 'As recorded'],
          ['full', 'Full refund'],
          ['partial', 'Partial, 80%'],
        ] as Array<[('full' | 'partial') | null, string]>
      ).map(([v, label]) => (
        <label key={label} className="segmented-item">
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
        const value = overrideValueText(c.key, overrides, obs);
        return (
          <div key={c.key} className={`choice${isSel ? ' is-selected' : ''}${value ? ' is-changed' : ''}`}>
            <label className="choice-head">
              <input type="radio" name={groupName} checked={isSel} onChange={() => select(c.key)} />
              <span className="choice-title">{t(c.title)}</span>
              <span className="choice-meta">{value ? <Pill tone="primary">{value}</Pill> : observedText(c.key, obs)}</span>
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
  label: string;
  /** Translation key, where the line has one; otherwise the English label shows. */
  labelKey?: string;
  key: keyof Omit<ScenarioColumn, 'by_channel'>;
  goodWhen: 'up' | 'down';
  money: boolean;
  strong?: boolean;
}

const ROWS: CompareRow[] = [
  { id: 'computed', label: 'Orders computed', key: 'computed', goodWhen: 'up', money: false },
  { id: 'returns', label: 'Returns', key: 'returns', goodWhen: 'down', money: false },
  { id: 'net', label: 'Net sales', labelKey: 'ledger.netSales', key: 'net_sales_inr', goodWhen: 'up', money: true },
  { id: 'npc', label: 'Net product cost', key: 'net_product_cost_inr', goodWhen: 'down', money: true },
  { id: 'ship', label: 'Shipping', labelKey: 'ledger.shipping', key: 'shipping_inr', goodWhen: 'down', money: true },
  { id: 'fee', label: 'Payment fee', key: 'payment_fee_inr', goodWhen: 'down', money: true },
  { id: 'ret', label: 'Return cost', labelKey: 'ledger.returnCost', key: 'return_cost_inr', goodWhen: 'down', money: true },
  { id: 'hand', label: 'Handling', labelKey: 'ledger.handling', key: 'handling_inr', goodWhen: 'down', money: true },
  { id: 'ads', label: 'Ads', labelKey: 'ledger.ads', key: 'ads_inr', goodWhen: 'down', money: true },
  { id: 'contribution', label: 'Contribution', labelKey: 'ledger.contribution', key: 'contribution_inr', goodWhen: 'up', money: true, strong: true },
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
    { id: 'line', header: t('scenario.line'), rowHeader: true, cell: (r) => (r.labelKey ? t(r.labelKey) : r.label) },
    { id: 'base', header: t('scenario.baseline'), align: 'right', cell: (r) => cellValue(s.baseline, r, false) },
    { id: 'scenario', header: t('scenario.scenario'), align: 'right', cell: (r) => cellValue(s.scenario, r, false) },
    { id: 'change', header: t('scenario.delta'), align: 'right', cell: (r) => cellValue(s.delta, r, true) },
  ];
  return (
    <Table
      caption="Baseline and scenario, line by line"
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
    { id: 'base', header: t('scenario.baseline'), align: 'right', cell: (d) => <Money value={d.baseline_inr} tone="contribution" /> },
    { id: 'scenario', header: t('scenario.scenario'), align: 'right', cell: (d) => <Money value={d.scenario_inr} tone="contribution" /> },
    { id: 'delta', header: t('scenario.delta'), align: 'right', cell: (d) => (d.delta_inr === null ? <Unknown /> : <Change value={d.delta_inr} goodWhen="up" />) },
  ];
  return <Table caption="Per-order change, top 10 by size" columns={columns} rows={rows.slice(0, 10)} rowKey={(d) => d.order_id} emptyText="No order changes." />;
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
  const baseText = base === null ? 'unknown' : formatInr(base);
  return (
    <div className="kpi-grid kpi-grid-2">
      <StatCard
        label={t('scenario.baselineContribution')}
        large
        value={<Money value={base} tone="contribution" />}
        sub={
          a.totals.partial ? (
            <Pill tone="warning" dot>
              {t('status.partial')} · {a.totals.unknown_count} {lower(t('status.unknown'))}
            </Pill>
          ) : (
            'Observed, as in the ledger'
          )
        }
        actionIcon={s ? 'chevron-down' : 'arrow-right'}
        onClick={s ? onCompare : () => navigate('ledger')}
        actionLabel={s ? `Baseline contribution ${baseText} — open the line-item comparison` : `Baseline contribution ${baseText} — open the ledger it comes from`}
      />
      {s ? (
        <StatCard
          label={t('scenario.scenarioContribution')}
          large
          tone="primary"
          value={<Money value={scen} tone="contribution" />}
          sub={
            <>
              {delta === null ? <Unknown /> : <Pill tone={delta > 0 ? 'success' : delta < 0 ? 'danger' : 'neutral'}>{formatSignedInr(delta)} vs baseline</Pill>}
              <span className="kpi-note">Changed: {OVERRIDE_LABELS[s.changed as OverrideKey] ?? s.changed}</span>
            </>
          }
          actionIcon="chevron-down"
          onClick={onCompare}
          actionLabel={`Scenario contribution ${scen === null ? 'unknown' : formatInr(scen)}, ${delta === null ? 'change unknown' : `${formatSignedInr(delta)} vs baseline`} — open the line-item comparison`}
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
          sub="Change one assumption to see it"
          actionIcon="arrow-right"
          onClick={onControls}
          actionLabel="Scenario contribution not run yet — go to the assumptions"
        />
      )}
    </div>
  );
}

function RecommendationCard({ rec, scenario, why, whySource }: { rec: Recommendation; scenario: ScenarioResponse | null; why: string; whySource: 'template' | 'ai' }) {
  const { t } = useTranslation();
  const before = scenario?.baseline_recommendation;
  return (
    <section className="card rec-card" aria-labelledby="rec-title">
      <div className="rec-top">
        <span className="pill pill-ai">
          <Icon name="sparkles" size={12} strokeWidth={2} />
          {t('scenario.recommendation')}
        </span>
        <span className="muted small">{scenario ? 'under this scenario' : 'at the observed baseline'}</span>
      </div>
      {before ? (
        <p className="flip">
          <span className="flip-part">
            <span className="flip-label">Before:</span> {before.label} <span className="num">{formatInr(before.expected_delta_inr)}</span>
          </span>
          <Icon name="arrow-right" size={16} className="flip-arrow" />
          <span className="flip-part flip-now">
            <span className="flip-label">Now:</span> <strong>{rec.label}</strong> <span className="num">{formatInr(rec.expected_delta_inr)}</span>
          </span>
          {before.intervention === rec.intervention ? <span className="muted small">(same intervention)</span> : null}
        </p>
      ) : null}
      <div className="rec-main">
        <div>
          <h2 id="rec-title" className="rec-title">
            {rec.label}
          </h2>
          {rec.rule ? <p className="rec-rule">{rec.rule}</p> : null}
        </div>
        <div className="rec-figure">
          <span className="rec-figure-label">Expected per period</span>
          <span className="rec-figure-value">
            <Money value={rec.expected_delta_inr} tone="contribution" signed />
          </span>
        </div>
      </div>
      <p className="rec-confidence">
        <ConfidenceBadge confidence={rec.confidence} prefix={lower(t('scenario.confidence'))} />
        <span>{rec.confidence_reason}</span>
      </p>
      <p className="rec-why">
        {why} <SourceTag source={whySource} />
      </p>
      <ButtonLink variant="primary" href={hrefFor('decision')} iconRight="arrow-right">
        {t('actions.useInDecision')}
      </ButtonLink>
    </section>
  );
}

function CandidatesChart({ rec, candidates }: { rec: Recommendation; candidates: Candidate[] }) {
  const { t } = useTranslation();
  const rows: BarRow[] = candidates.map((c) => ({
    key: c.intervention,
    label: c.label,
    sub: `${c.rule} · ${c.driving_orders} ${plural(c.driving_orders, 'order', 'orders')}`,
    emphasis: c.intervention === rec.intervention,
    values: [{ series: 'Change in contribution', value: c.delta_inr, tone: c.intervention === rec.intervention ? 'series-1' : 'muted', text: formatSignedInr(c.delta_inr) }],
  }));
  const table = (
    <table className="table table-compact">
      <caption className="visually-hidden">Candidates with rule, change and driving orders</caption>
      <thead>
        <tr>
          <th scope="col">{t('decision.intervention')}</th>
          <th scope="col">{t('scenario.rule')}</th>
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
            <th scope="row">{c.label}</th>
            <td className="cell-wrap">{c.rule}</td>
            <td className="r num">{formatSignedInr(c.delta_inr)}</td>
            <td className="r num">{c.driving_orders}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <ChartCard title="All candidates" subtitle="Change in contribution if each rule were applied; the recommended one is highlighted." table={table}>
      <BarRows rows={rows} ariaLabel="Change in contribution by candidate intervention" labelWidth={300} />
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
        <PageHeader title={t('scenario.pageTitle')} subtitle="Change one assumption and watch the recommendation move." />
        <NeedsAnalysis sentence="No analysis yet. Load the sample orders to compare a scenario against the observed baseline." icon="sliders" />
      </div>
    );
  }

  const obs = analysis.observed;
  const refundGaps = obs.refund_unknown_orders;
  const unknownOrders = analysis.totals.unknown_count;
  const hasAny = OVERRIDE_KEYS.some((k) => overrides[k] !== undefined) || overrides.assume_unknown_refund === true;
  const rec = current?.recommendation ?? analysis.recommendation;
  const candidates = current?.candidates ?? analysis.candidates;
  const aiWhy = !current && narration?.recommendation?.why_source === 'ai' ? narration.recommendation.why : null;

  return (
    <div className="page">
      <PageHeader title={t('scenario.pageTitle')} subtitle="Change one assumption at a time; the baseline is the observed ledger." />

      {refundGaps > 0 ? (
        <Callout tone="warning" title={`${refundGaps} ${plural(refundGaps, 'order has', 'orders have')} missing refund facts — results below are a labelled scenario.`} />
      ) : unknownOrders > 0 ? (
        <Callout tone="warning" title={`${unknownOrders} ${plural(unknownOrders, 'order has', 'orders have')} missing facts — results below are a labelled scenario.`} />
      ) : null}

      <div className="grid-scenario">
        <section className="card controls-card" aria-labelledby="controls-title" ref={controlsRef}>
          <div className="card-head">
            <h2 id="controls-title" className="card-title">
              {t('scenario.changeOne')}
            </h2>
            <InfoTip text="A controlled scenario changes one thing. Picking another assumption resets the previous one to observed." label="Why one at a time" />
          </div>
          <p className="card-sub">One assumption at a time. Changing one resets the others to observed.</p>
          <Controls obs={obs} overrides={overrides} onChange={setOverrides} />

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
              <span className="switch-label">Assume unknown refunds</span>
            </label>
            <p id="sc-assume-hint" className="control-hint">
              {refundGaps === 0
                ? 'No returned order is missing its refund in this dataset.'
                : `Fill ${refundGaps} missing refund ${plural(refundGaps, 'fact', 'facts')} with a stated assumption; works alone or with one change above.`}
            </p>
          </div>
          {overrides.assume_unknown_refund ? (
            <Callout tone="warning" title="Assumption in force" className="assumption-banner">
              <p>Returned orders with missing refund facts are filled in, not measured. Treat the scenario as an estimate.</p>
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
          <RecommendationCard rec={rec} scenario={current} why={aiWhy ?? rec.why} whySource={aiWhy ? 'ai' : rec.why_source} />
          <CandidatesChart rec={rec} candidates={candidates} />
          {current && current.assumptions.length > 0 ? (
            <Callout tone="info" title="Scenario notes">
              <ul className="plain-list">
                {current.assumptions.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </Callout>
          ) : null}
          {current ? (
            <>
              <Collapsible id="line-items" open={compareOpen} onToggle={setCompareOpen} title="Line-item comparison" meta={`Changed: ${OVERRIDE_LABELS[current.changed as OverrideKey] ?? current.changed}`}>
                <Comparison s={current} />
              </Collapsible>
              {current.delta.by_order.length > 0 ? (
                <Collapsible title="Orders that move most" meta={`Top ${Math.min(10, current.delta.by_order.length)}`}>
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
