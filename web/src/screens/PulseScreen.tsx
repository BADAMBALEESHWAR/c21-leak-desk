import { Component, useEffect, useMemo, useState, type ErrorInfo as ReactErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, toErrorInfo, type ErrorInfo } from '../api/client';
import type {
  AnalysisResponse,
  ProductLabel,
  PulseAction,
  PulseChannel,
  PulseChannels,
  PulseExtreme,
  PulseHeadline,
  PulseInsights,
  PulseLeaks,
  PulseMonth,
  PulseMonths,
  PulseOverview,
  PulsePaymentRow,
  PulseProduct,
  PulseProducts,
} from '../api/types';
import { ChartCard, type SeriesTone } from '../charts/ChartCard';
import { ColumnChart } from '../charts/ColumnChart';
import { QuadrantChart } from '../charts/QuadrantChart';
import { formatMonth } from '../charts/scale';
import { StackedColumnChart, type StackKey } from '../charts/StackedColumnChart';
import { Pill, Unknown } from '../components/Badge';
import { useAuth } from '../auth/AuthContext';
import { DEMO_URL } from '../brand';
import { Button, ButtonLink } from '../components/Button';
import { Icon } from '../components/Icon';
import { Money } from '../components/Money';
import { PageHeader } from '../components/Page';
import { Provenance } from '../components/Provenance';
import { Table, type Column } from '../components/Table';
import { panelId, tabId, Tabs } from '../components/Tabs';
import { Callout, EmptyPanel, ErrorCallout, InfoTip, Skeleton, StatCard } from '../components/ui';
import { downloadCsv } from '../lib/csv';
import { formatCount, formatDecimal, formatInr, formatPct, formatSignedDecimal, plural } from '../lib/format';
import { ALLOCATED_EN, ALLOCATED_KEY, ATTRIBUTION_LABEL, handlingEstimateUsed, LEAK_LABELS } from '../lib/labels';
import { hrefFor, navigate, parseHash } from '../lib/router';
import { useStore } from '../state/store';

type PulseTab = 'overview' | 'months' | 'products' | 'channels' | 'leaks';
const TABS: Array<{ id: PulseTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'months', label: 'Months' },
  { id: 'products', label: 'Products' },
  { id: 'channels', label: 'Channels & payments' },
  { id: 'leaks', label: 'Leaks over time' },
];

/** Leak causes take categorical slots in this fixed order, never by rank. */
const CAUSE_ORDER = ['full_return_partial_recovery', 'discount_exceeds_margin', 'fees_exceed_margin', 'other_negative', 'refund_unknown'];

const LABEL_TONE: Record<ProductLabel, 'success' | 'warning' | 'primary' | 'danger'> = {
  push: 'success',
  fix: 'warning',
  niche: 'primary',
  review: 'danger',
};

// ---- Data -------------------------------------------------------------------------------

const cache = new Map<string, unknown>();

interface Loaded<T> {
  data: T | null;
  error: ErrorInfo | null;
  loading: boolean;
}

/** Fetch once per analysis and key; tab switches reuse the answer. */
function usePulse<T>(analysisId: string, key: string, fetcher: () => Promise<T>): Loaded<T> {
  const cacheKey = `${analysisId}:${key}`;
  const [state, setState] = useState<Loaded<T>>(() => ({ data: (cache.get(cacheKey) as T) ?? null, error: null, loading: !cache.has(cacheKey) }));
  useEffect(() => {
    if (cache.has(cacheKey)) {
      setState({ data: cache.get(cacheKey) as T, error: null, loading: false });
      return undefined;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcher()
      .then((d) => {
        if (cancelled) return;
        cache.set(cacheKey, d);
        setState({ data: d, error: null, loading: false });
      })
      .catch((err) => {
        if (!cancelled) setState({ data: null, error: toErrorInfo(err), loading: false });
      });
    return () => {
      cancelled = true;
    };
    // The fetcher is rebuilt every render; the cache key says when the request changes.
  }, [cacheKey]);
  return state;
}

/** One tab that cannot render must not take the whole app down. */
class TabBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: string | null }> {
  state = { failed: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    return { failed: err instanceof Error ? err.message : String(err) };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: null });
  }
  componentDidCatch(_err: unknown, _info: ReactErrorInfo) {
    // Shown in place below; nothing to report.
  }
  render() {
    if (this.state.failed) {
      return (
        <Callout tone="danger" title="This view could not be drawn from the API answer.">
          <p className="callout-hint">{this.state.failed}</p>
        </Callout>
      );
    }
    return this.props.children;
  }
}

// ---- Small pieces --------------------------------------------------------------------------

const pct = (v: number | null | undefined) => (v === null || v === undefined ? <Unknown /> : <span className="num">{formatPct(v)}</span>);

function DeltaPill({ value, unit, goodWhen, vs }: { value: number | null | undefined; unit: 'pct' | 'pts'; goodWhen: 'up' | 'down'; vs: string | null }) {
  if (value === null || value === undefined || vs === null) return <span className="kpi-note">No previous month</span>;
  const flat = Math.abs(value) < 0.05;
  const good = (value > 0) === (goodWhen === 'up');
  const text = unit === 'pct' ? `${formatSignedDecimal(value)}%` : `${formatSignedDecimal(value)} pts`;
  return (
    <>
      <Pill tone={flat ? 'neutral' : good ? 'success' : 'danger'}>{text}</Pill>
      <span className="kpi-note">vs {vs}</span>
    </>
  );
}

function TabMeta({ unknown, labels, extra }: { unknown: number; labels: string[]; extra?: ReactNode }) {
  if (unknown === 0 && labels.length === 0 && !extra) return null;
  return (
    <div className="pulse-meta">
      {extra}
      {unknown > 0 ? (
        <Pill tone="warning" dot>
          Partial · {formatCount(unknown)} unknown {plural(unknown, 'order', 'orders')} left out
        </Pill>
      ) : null}
      {labels.length > 0 ? (
        <span className="pulse-labels">
          <Icon name="info" size={14} />
          {labels.join(' ')}
        </span>
      ) : null}
    </div>
  );
}

function TableCard({ title, sub, onExport, children, id }: { title: string; sub?: ReactNode; onExport?: () => void; children: ReactNode; id?: string }) {
  return (
    <section className="card table-card" aria-label={title} id={id}>
      <div className="table-card-head">
        <div>
          <h2 className="card-title">{title}</h2>
          {sub ? <p className="card-sub">{sub}</p> : null}
        </div>
        {onExport ? (
          <Button variant="secondary" size="sm" icon="download" onClick={onExport}>
            Export CSV
          </Button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Loading() {
  return (
    <div className="stack" role="status" aria-label="Loading">
      <div className="kpi-grid kpi-grid-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card kpi">
            <Skeleton width="50%" height={12} />
            <Skeleton width="70%" height={26} className="skeleton-gap" />
          </div>
        ))}
      </div>
      <div className="card skeleton-block" aria-hidden="true" />
    </div>
  );
}

function Failed({ error }: { error: ErrorInfo }) {
  return <ErrorCallout error={error} />;
}

// ---- Overview ------------------------------------------------------------------------------

function ExtremeCard({ title, tone, lines }: { title: string; tone: 'success' | 'warning'; lines: string[] }) {
  return (
    <section className="card extreme-card" aria-label={title}>
      <div className="card-head">
        <span className={`icon-chip icon-chip-${tone}`} aria-hidden="true">
          <Icon name={tone === 'success' ? 'check-circle' : 'trending-down'} size={18} />
        </span>
        <h2 className="card-title">{title}</h2>
      </div>
      <ul className="plain-list extreme-list">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </section>
  );
}

function ActionCard({ action, rank }: { action: PulseAction; rank: number }) {
  const { setOverrides } = useStore();
  const modellable = action.overrides !== undefined && Object.keys(action.overrides).length > 0;
  return (
    <article className="card action-card" aria-labelledby={`action-${rank}`}>
      <div className="action-top">
        <span className="action-rank" aria-hidden="true">
          {rank}
        </span>
        <Pill tone="primary">{action.lever}</Pill>
      </div>
      <h3 id={`action-${rank}`} className="action-title">
        {action.title}
      </h3>
      <p className="action-detail">{action.detail}</p>
      <p className="action-value">
        {action.recoverable_inr === null ? <Unknown /> : <span className="t-gain">{formatInr(action.recoverable_inr)}</span>}
        <span className="action-value-sub">recoverable</span>
      </p>
      {modellable ? (
        <Button
          variant="secondary"
          size="sm"
          iconRight="arrow-right"
          onClick={() => {
            setOverrides(action.overrides ?? {});
            navigate('scenario');
          }}
          aria-label={`Simulate: ${action.title}`}
        >
          Simulate
        </Button>
      ) : (
        <p className="action-note">
          Scenario has no {action.lever} lever for this yet; the figure comes straight from the ledger.{' '}
          <a href={hrefFor('scenario')}>Open Scenario</a>
        </p>
      )}
    </article>
  );
}

function Insights({ a }: { a: AnalysisResponse }) {
  const ins = usePulse<PulseInsights>(a.analysis_id, 'insights', () => api.pulseInsights(a.analysis_id));
  if (ins.loading) return <Skeleton width="100%" height={140} />;
  if (ins.error || !ins.data) return ins.error ? <Failed error={ins.error} /> : null;
  const d = ins.data;
  const repeat = d.repeat;
  return (
    <section className="stack" aria-labelledby="insights-title">
      <div className="section-head">
        <h2 id="insights-title" className="section-title">
          Are discounts, shipping and repeat customers working?
        </h2>
      </div>
      <div className="grid-3">
        <section className="card insight-card" aria-label="Discount depth">
          <h3 className="card-title">Discount depth</h3>
          <p className="card-sub">{discountSentence(d)}</p>
          <table className="table table-compact">
            <caption className="visually-hidden">Contribution per order by discount band</caption>
            <thead>
              <tr>
                <th scope="col">Band</th>
                <th scope="col" className="r">
                  Orders
                </th>
                <th scope="col" className="r">
                  Per order
                </th>
              </tr>
            </thead>
            <tbody>
              {d.discount_bands.map((b) => (
                <tr key={b.band}>
                  <th scope="row">{b.band}</th>
                  <td className="r num">{formatCount(b.orders)}</td>
                  <td className="r">
                    <Money value={b.contribution_per_order_inr} tone="contribution" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card insight-card" aria-label="Order value and shipping">
          <h3 className="card-title">Order value and shipping</h3>
          <p className="card-sub">Shipping as a share of net sales, by order value.</p>
          <table className="table table-compact">
            <caption className="visually-hidden">Shipping share and contribution per order by order value band</caption>
            <thead>
              <tr>
                <th scope="col">Band</th>
                <th scope="col" className="r">
                  Shipping
                </th>
                <th scope="col" className="r">
                  Per order
                </th>
              </tr>
            </thead>
            <tbody>
              {d.order_value_bands.map((b) => (
                <tr key={b.band}>
                  <th scope="row">{b.band}</th>
                  <td className="r">{pct(b.shipping_pct_of_net_sales)}</td>
                  <td className="r">
                    <Money value={b.contribution_per_order_inr} tone="contribution" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card insight-card" aria-label="Repeat customers">
          <h3 className="card-title">Repeat customers</h3>
          {'not_in_file' in repeat ? (
            <Callout tone="info" title="Not in this file">
              <p>Add a customer_id column to see repeat rate and repeat-order contribution.</p>
            </Callout>
          ) : (
            <dl className="kv">
              <div>
                <dt>Customers</dt>
                <dd className="num">{formatCount(repeat.customers)}</dd>
              </div>
              <div>
                <dt>Came back</dt>
                <dd className="num">
                  {formatCount(repeat.repeat_customers)} ({repeat.repeat_rate_pct === null ? 'unknown' : formatPct(repeat.repeat_rate_pct)})
                </dd>
              </div>
              <div>
                <dt>Per first order</dt>
                <dd>
                  <Money value={repeat.contribution_per_order_first_inr} tone="contribution" />
                </dd>
              </div>
              <div>
                <dt>Per repeat order</dt>
                <dd>
                  <Money value={repeat.contribution_per_order_repeat_inr} tone="contribution" />
                </dd>
              </div>
            </dl>
          )}
        </section>
      </div>
    </section>
  );
}

function discountSentence(d: PulseInsights): string {
  const band = d.negative_from_discount_band ? d.discount_bands.find((b) => b.band === d.negative_from_discount_band) : undefined;
  if (band && band.contribution_per_order_inr !== null) {
    return `Orders discounted ${band.band} lose ${formatInr(Math.abs(band.contribution_per_order_inr))} each on average.`;
  }
  if (typeof d.negative_from_discount_pct === 'number') {
    return `${formatPct(d.negative_from_discount_pct)} of losing orders lose money because of the discount.`;
  }
  return 'Contribution per order by discount band.';
}

/** Observed first, then the chips that qualify it: synthetic, estimated handling, unknown orders left out. */
function TileProvenance({ a, synthetic, unknown, money, children }: { a: AnalysisResponse; synthetic: boolean; unknown: number; money?: boolean; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <span className="tile-prov">
        <Provenance kind="observed" />
        {synthetic ? <Pill tone="teal">{t('status.syntheticTag').toLowerCase()}</Pill> : null}
        {money && handlingEstimateUsed(a) ? <Pill tone="warning">{t('status.estimated').toLowerCase()}</Pill> : null}
        {money && unknown > 0 ? (
          <Pill tone="warning" title={`Partial: ${formatCount(unknown)} unknown ${plural(unknown, 'order', 'orders')} left out`}>
            {formatCount(unknown)} {t('status.unknown').toLowerCase()}
          </Pill>
        ) : null}
      </span>
      {children}
    </>
  );
}

function OverviewTab({ a, toMonths }: { a: AnalysisResponse; toMonths: (month: string) => void }) {
  const account = useAuth().mode === 'account';
  const { t } = useTranslation();
  const synthetic = useMemo(() => a.orders.some((o) => o.synthetic), [a]);
  const [month, setMonth] = useState<string>('');
  const ov = usePulse<PulseOverview>(a.analysis_id, `overview:${month}`, () => api.pulseOverview(a.analysis_id, month || undefined));
  if (ov.loading && !ov.data) return <Loading />;
  if (ov.error || !ov.data) return ov.error ? <Failed error={ov.error} /> : null;
  const d = ov.data;
  const h: PulseHeadline = d.headline;
  const vs = d.previous ? formatMonth(prevMonth(d.month, d.months) ?? '') || 'previous month' : null;
  const open = () => toMonths(d.month);

  const line = (e: PulseExtreme | null | undefined, text: (m: string, v: string) => string) => (e ? [text(formatMonth(e.month), fmt(e.value_inr))] : []);
  const best = d.best
    ? [
        ...line(d.best.net_sales, (m, v) => `${m} sold the most: ${v} net sales.`),
        ...line(d.best.contribution, (m, v) => `${m} earned the most: ${v} contribution.`),
        ...line(d.best.contribution_per_order, (m, v) => `${m} earned the most per order: ${v}.`),
      ]
    : [];
  const worst = d.worst
    ? [
        ...line(d.worst.net_sales, (m, v) => `${m} sold the least: ${v} net sales.`),
        ...line(d.worst.contribution, (m, v) => `${m} earned the least: ${v} contribution.`),
        ...line(d.worst.contribution_per_order, (m, v) => `${m} earned the least per order: ${v}.`),
      ]
    : [];

  return (
    <div className="stack">
      <div className="pulse-toolbar">
        <label className="field-label" htmlFor="pulse-month">
          Month
        </label>
        <select id="pulse-month" className="input input-month" value={month || d.month} onChange={(e) => setMonth(e.target.value)}>
          {d.months.map((m) => (
            <option key={m} value={m}>
              {formatMonth(m)}
            </option>
          ))}
        </select>
        {ov.loading ? <span className="spinner" aria-hidden="true" /> : null}
        <TabMeta unknown={d.unknown_count} labels={d.labels} />
      </div>

      <div className={`kpi-grid kpi-grid-6 pulse-kpis${ov.loading ? ' is-refreshing' : ''}`}>
        <StatCard label="Orders" value={formatCount(h.orders)} sub={<TileProvenance a={a} synthetic={synthetic} unknown={d.unknown_count}><DeltaPill value={d.deltas?.orders_pct} unit="pct" goodWhen="up" vs={vs} /></TileProvenance>} onClick={open} actionLabel={`Orders ${h.orders} in ${formatMonth(d.month)} — open the month table`} actionIcon="arrow-right" />
        <StatCard label="Net sales" value={<Money value={h.net_sales_inr} tone="plain" />} sub={<TileProvenance a={a} synthetic={synthetic} unknown={d.unknown_count}><DeltaPill value={d.deltas?.net_sales_pct} unit="pct" goodWhen="up" vs={vs} /></TileProvenance>} onClick={open} actionLabel={`Net sales ${formatInr(h.net_sales_inr)} — open the month table`} actionIcon="arrow-right" />
        <StatCard label={t('ledger.operationalContribution', 'Operational contribution')} tone="primary" value={<Money value={h.contribution_inr} tone="contribution" />} sub={<TileProvenance a={a} synthetic={synthetic} unknown={d.unknown_count} money><DeltaPill value={d.deltas?.contribution_pct} unit="pct" goodWhen="up" vs={vs} /></TileProvenance>} onClick={open} actionLabel={`Operational contribution ${fmt(h.contribution_inr)} — open the month table`} actionIcon="arrow-right" />
        <StatCard label="Contribution %" value={h.contribution_pct === null ? <Unknown /> : <span className="num">{formatPct(h.contribution_pct)}</span>} sub={<TileProvenance a={a} synthetic={synthetic} unknown={0} money><span className="kpi-note">Of net sales</span></TileProvenance>} onClick={open} actionLabel="Contribution percent — open the month table" actionIcon="arrow-right" />
        <StatCard label="Return rate" tone="warning" value={h.return_pct === null ? <Unknown /> : <span className="num">{formatPct(h.return_pct)}</span>} sub={<TileProvenance a={a} synthetic={synthetic} unknown={d.unknown_count}><DeltaPill value={d.deltas?.return_pct_pts} unit="pts" goodWhen="down" vs={vs} /></TileProvenance>} onClick={open} actionLabel="Return rate — open the month table" actionIcon="arrow-right" />
        <StatCard label="Average order" value={<Money value={h.aov_inr} tone="plain" />} sub={<TileProvenance a={a} synthetic={synthetic} unknown={d.unknown_count}><span className="kpi-note">Gross {formatInr(h.gross_inr)}</span></TileProvenance>} onClick={open} actionLabel="Average order value — open the month table" actionIcon="arrow-right" />
      </div>

      {best.length && worst.length ? (
        <div className="grid-2">
          <ExtremeCard title="Best months" tone="success" lines={best} />
          <ExtremeCard title="Weakest months" tone="warning" lines={worst} />
        </div>
      ) : (
        <Callout tone="info" title="Best and weakest months need at least two months">
          <p>
            {d.months.length <= 1
              ? `This file only has ${formatMonth(d.month)}, so there is nothing to compare it with yet.`
              : `Only ${d.months_compared ?? 1} month in this file has known orders, so there is nothing to compare yet.`}{' '}
            {account
              ? 'Upload more months on Import: they are added to this data, and orders already saved are skipped.'
              : 'Upload more months on Import (select or drop several CSV files at once; they are merged into one dataset), or load the 12-month demo.'}
          </p>
        </Callout>
      )}

      {d.actions.length > 0 ? (
        <section className="stack" aria-labelledby="actions-title">
          <div className="section-head">
            <h2 id="actions-title" className="section-title">
              Top {Math.min(3, d.actions.length)} actions
            </h2>
            <span className="section-meta">Ranked by recoverable contribution; each opens a pre-filled scenario.</span>
          </div>
          <div className="grid-3">
            {d.actions.slice(0, 3).map((act, i) => (
              <ActionCard key={act.title} action={act} rank={i + 1} />
            ))}
          </div>
        </section>
      ) : null}

      <Insights a={a} />
    </div>
  );
}

function fmt(v: number | null): string {
  return v === null ? 'unknown' : formatInr(v);
}

function prevMonth(m: string, months: string[]): string | null {
  const i = months.indexOf(m);
  return i > 0 ? months[i - 1] : null;
}

// ---- Months ---------------------------------------------------------------------------------

function MonthsTab({ a, focusMonth }: { a: AnalysisResponse; focusMonth: string | null }) {
  const res = usePulse<PulseMonths>(a.analysis_id, 'months', () => api.pulseMonths(a.analysis_id));
  if (res.loading && !res.data) return <Loading />;
  if (res.error || !res.data) return res.error ? <Failed error={res.error} /> : null;
  const rows = res.data.months;
  const cats = rows.map((m) => ({ key: m.month, label: formatMonth(m.month, true), full: formatMonth(m.month) }));
  const best = rows.reduce((bi, m, i) => (m.net_sales_inr > rows[bi].net_sales_inr ? i : bi), 0);

  const columns: Column<PulseMonth>[] = [
    { id: 'month', header: 'Month', rowHeader: true, cell: (m) => formatMonth(m.month) },
    { id: 'orders', header: 'Orders', align: 'right', cell: (m) => <span className="num">{formatCount(m.orders)}</span> },
    { id: 'aov', header: 'AOV', align: 'right', cell: (m) => <Money value={m.aov_inr} tone="plain" /> },
    { id: 'gross', header: 'Gross', align: 'right', cell: (m) => <Money value={m.gross_inr} tone="plain" /> },
    { id: 'net', header: 'Net sales', align: 'right', cell: (m) => <Money value={m.net_sales_inr} tone="plain" /> },
    { id: 'contribution', header: 'Contribution', align: 'right', className: 'col-strong', cell: (m) => <Money value={m.contribution_inr} tone="contribution" /> },
    { id: 'cpct', header: 'Contribution %', align: 'right', cell: (m) => pct(m.contribution_pct) },
    { id: 'ret', header: 'Return %', align: 'right', cell: (m) => pct(m.return_pct) },
    { id: 'disc', header: 'Discount depth', align: 'right', cell: (m) => pct(m.discount_depth_pct) },
    { id: 'unknown', header: 'Unknown', align: 'right', cell: (m) => (m.unknown > 0 ? <Pill tone="warning">{m.unknown}</Pill> : <span className="cell-muted">0</span>) },
  ];
  const exportCsv = () =>
    downloadCsv(
      'pulse-months.csv',
      ['month', 'orders', 'aov_inr', 'gross_inr', 'net_sales_inr', 'contribution_inr', 'contribution_pct', 'return_pct', 'discount_depth_pct', 'unknown'],
      rows.map((m) => [m.month, m.orders, m.aov_inr, m.gross_inr, m.net_sales_inr, m.contribution_inr, m.contribution_pct, m.return_pct, m.discount_depth_pct, m.unknown]),
    );

  return (
    <div className="stack">
      <TabMeta unknown={res.data.unknown_count} labels={res.data.labels} />
      <ChartCard
        title="Net sales and contribution by month"
        subtitle={`${rows.length} months. Hover or use the arrow keys for each month's numbers.`}
        legend={[
          { label: 'Net sales', tone: 'series-1' },
          { label: 'Contribution', tone: 'series-2' },
        ]}
      >
        <ColumnChart
          categories={cats}
          series={[
            { id: 'net', label: 'Net sales', tone: 'series-1', values: rows.map((m) => m.net_sales_inr) },
            { id: 'contribution', label: 'Contribution', tone: 'series-2', values: rows.map((m) => m.contribution_inr) },
          ]}
          ariaLabel={`Net sales and contribution for ${rows.length} months; best net sales ${formatMonth(rows[best]?.month ?? '')}`}
          format={formatInr}
          callout={rows.length > 1 ? { index: best, text: `Best: ${formatMonth(rows[best].month, true)} ${formatInr(rows[best].net_sales_inr)}` } : null}
          labelExtremes="contribution"
        />
      </ChartCard>
      <TableCard title="Month by month" sub="Orders, order value, returns and discount depth per month." onExport={exportCsv}>
        <Table caption="Month by month" columns={columns} rows={rows} rowKey={(m) => m.month} rowClassName={(m) => (m.month === focusMonth ? 'row-strong' : undefined)} />
      </TableCard>
    </div>
  );
}

// ---- Products -------------------------------------------------------------------------------

function ProductsTab({ a }: { a: AnalysisResponse }) {
  const res = usePulse<PulseProducts>(a.analysis_id, 'products', () => api.pulseProducts(a.analysis_id));
  if (res.loading && !res.data) return <Loading />;
  if (res.error || !res.data) return res.error ? <Failed error={res.error} /> : null;
  const rows = res.data.products;
  const points = rows
    .filter((p) => p.contribution_per_unit_inr !== null)
    .map((p) => ({
      id: p.product_id,
      x: p.units,
      y: p.contribution_per_unit_inr as number,
      label: p.label,
      tip: [
        { label: 'units', value: formatCount(p.units) },
        { label: 'per unit', value: formatInr(p.contribution_per_unit_inr as number) },
        { label: 'contribution', value: fmt(p.contribution_inr) },
      ],
    }));

  const columns: Column<PulseProduct>[] = [
    { id: 'product', header: 'Product', rowHeader: true, cell: (p) => p.product_id },
    {
      id: 'label',
      header: 'Call',
      cell: (p) => (
        <Pill tone={LABEL_TONE[p.label] ?? 'neutral'} dot>
          {p.label}
        </Pill>
      ),
    },
    { id: 'units', header: 'Units (rank)', align: 'right', cell: (p) => <span className="num">{formatCount(p.units)} <span className="cell-muted">#{p.rank_units}</span></span> },
    { id: 'net', header: 'Net sales (rank)', align: 'right', cell: (p) => <span className="num"><Money value={p.net_sales_inr} tone="plain" /> <span className="cell-muted">#{p.rank_net_sales}</span></span> },
    { id: 'contribution', header: 'Contribution (rank)', align: 'right', className: 'col-strong', cell: (p) => <span className="num"><Money value={p.contribution_inr} tone="contribution" /> <span className="cell-muted">#{p.rank_contribution}</span></span> },
    { id: 'cpu', header: 'Per unit', align: 'right', cell: (p) => <Money value={p.contribution_per_unit_inr} tone="contribution" /> },
    { id: 'ret', header: 'Return %', align: 'right', cell: (p) => pct(p.return_pct) },
    { id: 'disc', header: 'Discount depth', align: 'right', cell: (p) => pct(p.discount_depth_pct) },
    { id: 'lever', header: 'Lever', className: 'col-wrap', cell: (p) => <span>{p.lever && p.lever !== 'none' ? <strong>{p.lever} </strong> : null}<span className="cell-muted">{p.note}</span></span> },
  ];
  const exportCsv = () =>
    downloadCsv(
      'pulse-products.csv',
      ['product_id', 'label', 'units', 'orders', 'net_sales_inr', 'contribution_inr', 'contribution_per_unit_inr', 'return_pct', 'discount_depth_pct', 'rank_units', 'rank_net_sales', 'rank_contribution', 'lever', 'note'],
      rows.map((p) => [p.product_id, p.label, p.units, p.orders, p.net_sales_inr, p.contribution_inr, p.contribution_per_unit_inr, p.return_pct, p.discount_depth_pct, p.rank_units, p.rank_net_sales, p.rank_contribution, p.lever, p.note]),
    );

  return (
    <div className="stack">
      <TabMeta unknown={res.data.unknown_count} labels={res.data.labels} />
      <ChartCard title="Volume against contribution per unit" subtitle="Push the top right, fix the bottom right; the engine's labels decide each product's corner.">
        <QuadrantChart points={points} xLabel="Units sold" yLabel="Contribution per unit" ariaLabel={`Quadrant of ${points.length} products by units and contribution per unit`} />
      </ChartCard>
      <TableCard title="Product ranking" sub="Ranks by units, net sales and contribution; the gap between them is the story." onExport={exportCsv}>
        <Table caption="Product ranking" columns={columns} rows={rows} rowKey={(p) => p.product_id} />
      </TableCard>
    </div>
  );
}

// ---- Channels & payments ------------------------------------------------------------------------

function ChannelsTab({ a }: { a: AnalysisResponse }) {
  const { t } = useTranslation();
  const allocated = t(ALLOCATED_KEY, ALLOCATED_EN);
  const res = usePulse<PulseChannels>(a.analysis_id, `channels:${a.attribution}`, () => api.pulseChannels(a.analysis_id));
  if (res.loading && !res.data) return <Loading />;
  if (res.error || !res.data) return res.error ? <Failed error={res.error} /> : null;
  const d = res.data;
  const channelCols: Column<PulseChannel>[] = [
    { id: 'channel', header: 'Channel', rowHeader: true, cell: (c) => c.channel },
    { id: 'orders', header: 'Orders', align: 'right', cell: (c) => <span className="num">{formatCount(c.orders)}</span> },
    { id: 'net', header: 'Net sales', align: 'right', cell: (c) => <Money value={c.net_sales_inr} tone="plain" /> },
    { id: 'contribution', header: 'Operational contribution', align: 'right', className: 'col-strong', cell: (c) => <Money value={c.contribution_inr} tone="contribution" /> },
    { id: 'ret', header: 'Return %', align: 'right', cell: (c) => pct(c.return_pct) },
    {
      id: 'ads',
      header: (
        <span className="th-stack" title={allocated}>
          <span>Ads</span>
          <span className="th-sub">{allocated}</span>
        </span>
      ),
      align: 'right',
      cell: (c) => (
        <span title={`Ads: ${allocated}`}>
          <Money value={c.ads_inr} tone="plain" />
        </span>
      ),
    },
    { id: 'share', header: 'Ads share', align: 'right', cell: (c) => pct(c.ads_share_pct) },
  ];
  const payCols: Column<PulsePaymentRow>[] = [
    { id: 'type', header: 'Payment', rowHeader: true, cell: (r) => (r.payment_type.toLowerCase() === 'cod' ? 'COD' : r.payment_type.charAt(0).toUpperCase() + r.payment_type.slice(1)) },
    { id: 'orders', header: 'Orders', align: 'right', cell: (r) => <span className="num">{formatCount(r.orders)}</span> },
    { id: 'share', header: 'Share', align: 'right', cell: (r) => pct(r.share_pct) },
    { id: 'ret', header: 'Return %', align: 'right', cell: (r) => pct(r.return_pct) },
    { id: 'fee', header: 'Fee / order', align: 'right', cell: (r) => <Money value={r.payment_fee_per_order_inr} tone="plain" /> },
    { id: 'rc', header: 'Return cost / order', align: 'right', cell: (r) => <Money value={r.return_cost_per_order_inr} tone="plain" /> },
    { id: 'cpo', header: 'Contribution / order', align: 'right', className: 'col-strong', cell: (r) => <Money value={r.contribution_per_order_inr} tone="contribution" /> },
  ];
  const exportChannels = () =>
    downloadCsv(
      'pulse-channels.csv',
      ['channel', 'orders', 'net_sales_inr', 'contribution_inr', 'return_pct', 'ads_inr', 'ads_share_pct', 'attribution'],
      d.channels.map((c) => [c.channel, c.orders, c.net_sales_inr, c.contribution_inr, c.return_pct, c.ads_inr, c.ads_share_pct, d.attribution]),
    );
  const payments = d.payments;

  return (
    <div className="stack">
      <TabMeta
        unknown={d.unknown_count}
        labels={d.labels}
        extra={
          <Pill tone="neutral">
            {d.attribution === 'channel' ? `Channel spend at channel level · ${allocated}` : `Ads allocated per order · ${allocated}`}
          </Pill>
        }
      />
      <TableCard title="Channels" sub={<>Attribution mode as set in the top bar. {ATTRIBUTION_LABEL}</>} onExport={exportChannels}>
        <Table caption="Contribution by channel" columns={channelCols} rows={d.channels} rowKey={(c) => c.channel} />
      </TableCard>
      {'not_in_file' in payments ? (
        <Callout tone="info" title="COD vs prepaid: payment type is not in this file">
          <p>Add a payment_type column (cod or prepaid) to compare return rate, fees and contribution per order.</p>
        </Callout>
      ) : (
        <TableCard
          title="COD vs prepaid"
          sub={
            payments.cod_vs_prepaid_return_ratio === null
              ? 'Return rate, fees and contribution per order by payment type.'
              : `COD orders return ${formatDecimal(payments.cod_vs_prepaid_return_ratio)}× as often as prepaid orders.`
          }
          onExport={() =>
            downloadCsv(
              'pulse-payments.csv',
              ['payment_type', 'orders', 'share_pct', 'return_pct', 'payment_fee_per_order_inr', 'return_cost_per_order_inr', 'contribution_per_order_inr'],
              payments.rows.map((r) => [r.payment_type, r.orders, r.share_pct, r.return_pct, r.payment_fee_per_order_inr, r.return_cost_per_order_inr, r.contribution_per_order_inr]),
            )
          }
        >
          <Table caption="Payment types" columns={payCols} rows={payments.rows} rowKey={(r) => r.payment_type} />
        </TableCard>
      )}
    </div>
  );
}

// ---- Leaks over time -------------------------------------------------------------------------------

function LeaksTab({ a }: { a: AnalysisResponse }) {
  const res = usePulse<PulseLeaks>(a.analysis_id, 'leaks', () => api.pulseLeaks(a.analysis_id));
  if (res.loading && !res.data) return <Loading />;
  if (res.error || !res.data) return res.error ? <Failed error={res.error} /> : null;
  const d = res.data;
  // Only causes with rupees can be drawn; a refund without a recovery fact has no amount, only a count.
  const drawn = [...d.causes].filter((c) => d.months.some((m) => (m.by_cause[c] ?? 0) > 0)).sort((x, y) => idx(x) - idx(y));
  const keys: StackKey[] = drawn.slice(0, 5).map((c) => ({ id: c, label: causeLabel(c), slot: Math.min(5, idx(c) + 1) }));
  const unknownOrders = d.months.reduce((n, m) => n + m.unknown_orders, 0);
  const cats = d.months.map((m) => ({ key: m.month, label: formatMonth(m.month, true), full: formatMonth(m.month) }));
  const first = d.months[0]?.total_lost_inr ?? 0;
  const last = d.months[d.months.length - 1]?.total_lost_inr ?? 0;

  const columns: Column<PulseLeaksRow>[] = [
    { id: 'month', header: 'Month', rowHeader: true, cell: (m) => formatMonth(m.month) },
    ...keys.map((k) => ({
      id: k.id,
      header: (
        <span className="th-key">
          <span className={`legend-key tip-key-cat-${k.slot}`} aria-hidden="true" />
          {k.label}
        </span>
      ),
      align: 'right' as const,
      cell: (m: PulseLeaksRow) => <LostCell value={m.by_cause[k.id] ?? 0} />,
    })),
    { id: 'total', header: 'Total lost', align: 'right', className: 'col-strong', cell: (m) => <LostCell value={m.total_lost_inr} /> },
    { id: 'unknown', header: 'Refund unknown (orders)', align: 'right', cell: (m) => (m.unknown_orders > 0 ? <Pill tone="warning">{m.unknown_orders}</Pill> : <span className="cell-muted">0</span>) },
  ];
  const exportCsv = () =>
    downloadCsv(
      'pulse-leaks.csv',
      ['month', ...keys.map((k) => k.id), 'total_lost_inr', 'unknown_orders'],
      d.months.map((m) => [m.month, ...keys.map((k) => m.by_cause[k.id] ?? 0), m.total_lost_inr, m.unknown_orders]),
    );

  return (
    <div className="stack">
      <TabMeta unknown={d.unknown_count} labels={d.labels} />
      <ChartCard
        title="₹ lost by cause, month by month"
        subtitle={
          d.months.length > 1
            ? `Losses went from ${formatInr(first)} in ${formatMonth(d.months[0].month)} to ${formatInr(last)} in ${formatMonth(d.months[d.months.length - 1].month)}.${
                unknownOrders > 0 ? ` ${formatCount(unknownOrders)} ${plural(unknownOrders, 'order has', 'orders have')} no refund fact yet: counted in the table, not drawn.` : ''
              }`
            : 'Losses by primary cause.'
        }
        legend={keys.map((k) => ({ label: k.label, tone: `cat-${k.slot}` as SeriesTone }))}
      >
        <StackedColumnChart
          categories={cats}
          keys={keys}
          values={d.months.map((m) => m.by_cause)}
          totals={d.months.map((m) => m.total_lost_inr)}
          ariaLabel={`Rupees lost by cause for ${d.months.length} months`}
          format={formatInr}
          extraTip={(i) => (d.months[i].unknown_orders > 0 ? { label: 'unknown orders', value: String(d.months[i].unknown_orders) } : null)}
        />
      </ChartCard>
      <TableCard title="Leaks by month" sub="Rupees lost by primary cause; unknown amounts are counted, not guessed." onExport={exportCsv} id="pulse-leaks-table">
        <Table caption="Leaks by month" columns={columns} rows={d.months} rowKey={(m) => m.month} />
      </TableCard>
    </div>
  );
}

type PulseLeaksRow = PulseLeaks['months'][number];

/** Rupees lost are shown as positive amounts in the loss colour, as on the Leaks step. */
function LostCell({ value }: { value: number }) {
  if (value === 0) return <span className="cell-muted num">{formatInr(0)}</span>;
  return <span className="t-loss num">{formatInr(value)}</span>;
}

function idx(cause: string): number {
  const i = CAUSE_ORDER.indexOf(cause);
  return i < 0 ? CAUSE_ORDER.length : i;
}

function causeLabel(cause: string): string {
  return (LEAK_LABELS as Record<string, string>)[cause] ?? cause.replace(/_/g, ' ');
}

// ---- Screen ------------------------------------------------------------------------------------

export function PulseScreen() {
  const { analysis, importDataset, runAnalysis, importing, analysing, restoring, dataset } = useStore();
  // Workspace mode never loads the demo into the owner's account; it opens in its own tab instead.
  const account = useAuth().mode === 'account';
  const [tab, setTab] = useState<PulseTab>(() => {
    const t = parseHash(window.location.hash).params.get('tab');
    return TABS.some((x) => x.id === t) ? (t as PulseTab) : 'overview';
  });
  const [focusMonth, setFocusMonth] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<ErrorInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const synthetic = useMemo(() => (analysis ? analysis.orders.reduce((n, o) => n + (o.synthetic ? 1 : 0), 0) : 0), [analysis]);
  // A deep link to another tab while Pulse is already open (same document, hash change only).
  useEffect(() => {
    const onHash = (e: HashChangeEvent) => {
      // newURL, not location: the deep-link handler may already have trimmed the query from the hash.
      let hash = window.location.hash;
      try {
        hash = new URL(e.newURL).hash;
      } catch {
        // Keep location.hash.
      }
      const t = parseHash(hash).params.get('tab');
      if (TABS.some((x) => x.id === t)) setTab(t as PulseTab);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const monthCount = useMemo(() => (analysis ? new Set(analysis.orders.map((o) => o.date.slice(0, 7))).size : 0), [analysis]);

  const changeTab = (t: PulseTab) => {
    setTab(t);
    try {
      const q = t === 'overview' ? '' : `?tab=${t}`;
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#/pulse${q}`);
    } catch {
      // Some embedded browsers block replaceState; the tab still changes.
    }
  };

  const loadDemo = async () => {
    setBusy(true);
    setLoadError(null);
    try {
      const ds = await importDataset({ source: 'demo_12m' });
      await runAnalysis('allocate', undefined, ds.dataset_id);
    } catch (err) {
      setLoadError(toErrorInfo(err));
    } finally {
      setBusy(false);
    }
  };

  const header = <PageHeader title="Pulse" subtitle="Owner analytics: how the business sold, month by month, and what to do first." />;

  if (!analysis) {
    if (importing || analysing || restoring) {
      return (
        <div className="page">
          {header}
          <Loading />
        </div>
      );
    }
    if (account) {
      return (
        <div className="page">
          {header}
          <EmptyPanel
            icon="activity"
            title="Pulse needs an analysis of your orders."
            actions={
              <>
                <Button variant="primary" icon="upload-cloud" onClick={() => navigate('import')}>
                  Go to import
                </Button>
                <ButtonLink variant="secondary" icon="arrow-up-right" href={DEMO_URL} target="_blank" rel="noopener">
                  See the 12-month demo
                </ButtonLink>
              </>
            }
          >
            Upload your orders, or open saved data, on the Import step. The demo opens in a new tab and stays out of your account.
          </EmptyPanel>
        </div>
      );
    }
    return (
      <div className="page">
        {header}
        <EmptyPanel
          icon="activity"
          title="Pulse needs an analysis. The 12-month demo shows it best."
          actions={
            <>
              <Button variant="primary" onClick={() => void loadDemo()} disabled={busy}>
                {busy ? 'Loading…' : 'Load 12-month demo'}
              </Button>
              <Button variant="secondary" icon="upload-cloud" onClick={() => navigate('import')}>
                Go to import
              </Button>
            </>
          }
        >
          Synthetic, labelled: 12 months of orders with a festive peak, a high-return product and a COD story.
        </EmptyPanel>
        <ErrorCallout error={loadError} />
      </div>
    );
  }

  const singleMonth = monthCount < 3 && dataset?.source !== 'demo_12m';

  return (
    <div className="page">
      {header}
      {synthetic > 0 ? (
        <Callout tone="info" title="Synthetic demo data">
          <p>
            {formatCount(synthetic)} of {formatCount(analysis.orders.length)} orders are labelled synthetic: true. The numbers show the method, not a real brand.
          </p>
        </Callout>
      ) : null}
      {singleMonth ? (
        <Callout tone="info" title="This dataset covers a short period">
          {account ? (
            <p>
              Month-on-month views work best on a longer file. <a href={hrefFor('import')}>Upload more months</a>: orders already saved are
              skipped, never counted twice.
            </p>
          ) : (
            <p>
              Month-on-month views work best on a longer file.{' '}
              <a href={hrefFor('pulse')} onClick={(e) => { e.preventDefault(); void loadDemo(); }}>
                Load the 12-month demo
              </a>{' '}
              to see every tab with something to say.
            </p>
          )}
        </Callout>
      ) : null}

      <div className="pulse-tabs">
        <Tabs label="Pulse views" idPrefix="pulse" tabs={TABS} value={tab} onChange={changeTab} />
        <span className="pulse-hint">
          {formatCount(analysis.orders.length)} orders · {monthCount} {plural(monthCount, 'month', 'months')}
          <InfoTip text="Every number comes from the same reconciled per-order ledger; unknown orders are counted and left out of averages." label="About Pulse numbers" />
        </span>
      </div>
      <div role="tabpanel" id={panelId('pulse', tab)} aria-labelledby={tabId('pulse', tab)} className="tabpanel pulse-panel">
        <TabBoundary resetKey={`${analysis.analysis_id}:${tab}`}>
        {tab === 'overview' ? (
          <OverviewTab
            a={analysis}
            toMonths={(m) => {
              setFocusMonth(m);
              changeTab('months');
            }}
          />
        ) : tab === 'months' ? (
          <MonthsTab a={analysis} focusMonth={focusMonth} />
        ) : tab === 'products' ? (
          <ProductsTab a={analysis} />
        ) : tab === 'channels' ? (
          <ChannelsTab a={analysis} />
        ) : (
          <LeaksTab a={analysis} />
        )}
        </TabBoundary>
      </div>
      <ErrorCallout error={loadError} />
    </div>
  );
}
