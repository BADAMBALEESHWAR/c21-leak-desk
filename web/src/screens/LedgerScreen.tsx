import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnalysisResponse, GroupRow, LineKey, OrderResult } from '../api/types';
import { BarRows, type BarRow } from '../charts/BarRows';
import { ChartCard } from '../charts/ChartCard';
import { WhaleCurve } from '../charts/WhaleCurve';
import { Pill, Unknown } from '../components/Badge';
import { ButtonLink, LinkButton } from '../components/Button';
import { Pagination } from '../components/Pagination';
import { api, authDownload } from '../api/client';
import { Definitions } from '../components/Definitions';
import { NeedsAnalysis } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { Money } from '../components/Money';
import { OrderPills } from '../components/OrderDrawer';
import { NextStep, PageHeader } from '../components/Page';
import { PeriodTotals, ReconciliationLine } from '../components/Reconciliation';
import { Table, type Column } from '../components/Table';
import { panelId, tabId, Tabs } from '../components/Tabs';
import { Callout, InfoTip, revealElement, StatCard } from '../components/ui';
import { groupMarginsOf, marginsOf, rowFixedShare, unitEconomics, UnitEconomics, useFormulas } from '../components/UnitEconomics';
import { lower } from '../i18n';
import { formatCount, formatInr, formatMarginPct, formatPct, plural } from '../lib/format';
import { ALLOCATED_EN, ALLOCATED_KEY, ATTRIBUTION_LABEL, fullReturnPartialRecovery, handlingEstimateUsed } from '../lib/labels';
import { hrefFor } from '../lib/router';
import { useStore, type LedgerFilter } from '../state/store';

type Filter = LedgerFilter;

const PAGE_SIZE = 50;

/** Table-focus requests already handled, kept across visits to this step. */
let lastHandledFocus = 0;

const SHOWN_ELSEWHERE = [ATTRIBUTION_LABEL, 'Operational contribution, not statutory net profit.'];

function Deduction({ order, k, title }: { order: OrderResult; k: LineKey; title?: string }) {
  const line = order.lines.find((l) => l.key === k);
  if (!line || line.amount_inr === null) return <Unknown />;
  if (line.source === 'moved_to_channel') return <span className="cell-muted">to channel</span>;
  if (line.source === 'not_recognised') {
    return (
      <span className="cell-pending" title={line.note}>
        pending
      </span>
    );
  }
  if (title) {
    return (
      <span title={title}>
        <Money value={Math.abs(line.amount_inr)} tone="plain" muteZero />
      </span>
    );
  }
  return <Money value={Math.abs(line.amount_inr)} tone="plain" muteZero />;
}

/** A column heading with a second, smaller line (e.g. "allocated, not caused"). */
function SubHead({ main, sub, title }: { main: ReactNode; sub: string; title?: string }) {
  return (
    <span className="th-stack" title={title ?? sub}>
      <span>{main}</span>
      <span className="th-sub">{sub}</span>
    </span>
  );
}

function KeyCell({ value }: { value: string }) {
  return value === 'unassigned' ? <span className="cell-muted">unassigned</span> : <>{value}</>;
}

const Kpis = memo(function Kpis({ a }: { a: AnalysisResponse }) {
  const { openBridge, openMargin, focusLedgerTable } = useStore();
  const { t: tr } = useTranslation();
  const t = a.totals;
  const gateOpen = a.headline_gate.open && t.headline_ready !== false && t.contribution_pct !== null;
  const lateText = t.late_refund_count > 0 ? formatInr(t.late_refund_pending_inr) : 'none';
  return (
    <div className="kpi-grid kpi-grid-6">
      <StatCard
        label={tr('ledger.gross')}
        value={<Money value={t.gross_inr} tone="plain" />}
        icon="file"
        sub="Before discounts"
        onClick={() => openBridge('gross')}
        actionLabel={`Gross sales ${formatInr(t.gross_inr)} — open period waterfall`}
      />
      <StatCard
        label={tr('ledger.netSales')}
        value={<Money value={t.net_sales_inr} tone="plain" />}
        icon="table"
        sub="After discounts and refunds"
        onClick={() => openBridge('net_sales')}
        actionLabel={`Net sales ${formatInr(t.net_sales_inr)} — open period waterfall`}
      />
      <StatCard
        label={tr('ledger.operationalContribution', 'Operational contribution')}
        large
        tone="primary"
        icon="trending-down"
        value={<Money value={t.contribution_inr} tone="contribution" />}
        onClick={() => openBridge('contribution')}
        actionLabel={`Operational contribution ${t.contribution_inr === null ? 'unknown' : formatInr(t.contribution_inr)}${t.partial ? `, partial, ${formatCount(t.unknown_count)} unknown` : ''} — open period waterfall`}
        sub={
          <>
            {t.partial ? (
              <Pill tone="warning" dot>
                {tr('status.partial')} · {formatCount(t.unknown_count)} {lower(tr('status.unknown'))}
              </Pill>
            ) : (
              <Pill tone="success" dot>
                {tr('status.complete')}
              </Pill>
            )}
            {a.attribution === 'channel' && t.channel_spend_inr ? (
              <span className="kpi-note">
                {tr('ledger.afterSpend', 'after {{inr}} channel spend', { inr: formatInr(t.channel_spend_inr) })} · {tr(ALLOCATED_KEY, ALLOCATED_EN)}
              </span>
            ) : null}
            {handlingEstimateUsed(a) ? <span className="kpi-note">incl. estimated handling {formatInr(a.config.handling_default_inr)}/order</span> : null}
          </>
        }
      />
      {gateOpen ? (
        <StatCard
          label={tr('ledger.margin')}
          value={<span className="num">{formatPct(t.contribution_pct as number)}</span>}
          icon="check-circle"
          tone="success"
          sub="Of net sales"
          onClick={openMargin}
          actionLabel={`Margin ${formatPct(t.contribution_pct as number)} of net sales — show how it is computed`}
        />
      ) : (
        <StatCard
          label={tr('ledger.margin')}
          icon="lock"
          tone="warning"
          value={
            <span className="kpi-locked">
              <Icon name="lock" size={20} /> Hidden
            </span>
          }
          sub="Until refund facts are complete"
          onClick={openMargin}
          actionLabel="Margin hidden until refund facts are complete — see why and the unknown orders"
        />
      )}
      <StatCard
        label={tr('ledger.orders')}
        value={formatCount(t.orders)}
        icon="table"
        actionIcon="arrow-right"
        onClick={() => focusLedgerTable('losing')}
        actionLabel={`Orders ${formatCount(t.orders)}, ${formatCount(t.negative_count)} losing money — filter the table to losing orders`}
        sub={t.negative_count > 0 ? <span className="t-loss">{formatCount(t.negative_count)} losing money</span> : 'None losing money'}
      />
      <StatCard
        label={tr('ledger.lateRefunds')}
        icon="alert-triangle"
        actionIcon="arrow-right"
        tone={t.late_refund_count > 0 ? 'warning' : 'default'}
        value={t.late_refund_count > 0 ? <Money value={t.late_refund_pending_inr} /> : <span className="kpi-none">None</span>}
        sub={t.late_refund_count > 0 ? `Pending if recognised · ${formatCount(t.late_refund_count)} ${plural(t.late_refund_count, 'order', 'orders')}` : 'All refunds fall in the period'}
        onClick={() => focusLedgerTable('late')}
        actionLabel={`Late refunds ${lateText} pending if recognised — filter the table to late refunds`}
      />
    </div>
  );
});

const ChannelChart = memo(function ChannelChart({ a }: { a: AnalysisResponse }) {
  const { t } = useTranslation();
  const channelMode = a.attribution === 'channel';
  const rows: BarRow[] = a.groups.channel.map((g) => ({
    key: g.key,
    label: g.key,
    sub: `${formatCount(g.orders)} ${plural(g.orders, 'order', 'orders')}${g.unknown_count ? ` · ${formatCount(g.unknown_count)} unknown` : ''}`,
    values: [
      { series: 'Contribution', value: g.contribution_inr, tone: 'series-1', text: g.contribution_inr === null ? 'unknown' : formatInr(g.contribution_inr) },
      ...(channelMode
        ? [{ series: 'Channel spend', value: g.channel_spend_inr, tone: 'series-2' as const, text: g.channel_spend_inr === null ? 'unknown' : formatInr(g.channel_spend_inr) }]
        : []),
    ],
  }));
  const table = (
    <table className="table table-compact">
      <caption className="visually-hidden">Contribution by channel</caption>
      <thead>
        <tr>
          <th scope="col">{t('ledger.channel')}</th>
          <th scope="col" className="r">
            {t('ledger.contribution')}
          </th>
          {channelMode ? (
            <th scope="col" className="r">
              {t('ledger.channelSpend')}
            </th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {a.groups.channel.map((g) => (
          <tr key={g.key}>
            <th scope="row">{g.key}</th>
            <td className="r">
              <Money value={g.contribution_inr} tone="contribution" />
            </td>
            {channelMode ? (
              <td className="r">
                <Money value={g.channel_spend_inr} tone="plain" />
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <ChartCard
      title="Contribution by channel"
      subtitle={
        channelMode
          ? t('ledger.chartChannel', 'Contribution after spend, next to the channel spend deducted once per channel. Spend is allocated, not caused.')
          : t('ledger.chartAllocate', 'Contribution after ads allocated to each order (allocated, not caused).')
      }
      legend={
        channelMode
          ? [
              { label: 'Contribution', tone: 'series-1' },
              { label: 'Channel spend', tone: 'series-2' },
            ]
          : undefined
      }
      table={table}
    >
      <BarRows rows={rows} ariaLabel="Contribution by channel" labelWidth={118} />
    </ChartCard>
  );
});

function sumInr(rows: GroupRow[], pick: (r: GroupRow) => number | null): number | null {
  let s = 0;
  for (const r of rows) {
    const v = pick(r);
    if (v === null) return null;
    s += v;
  }
  return s;
}

function OrdersTable({ orders, handlingEstimate }: { orders: OrderResult[]; handlingEstimate: number }) {
  const { openOrderResult, correctedOrderIds } = useStore();
  const corrected = new Set(correctedOrderIds ?? []);
  const { t } = useTranslation();
  const allocated = t(ALLOCATED_KEY, ALLOCATED_EN);
  const columns: Column<OrderResult>[] = [
    {
      id: 'order',
      header: t('ledger.order'),
      rowHeader: true,
      className: 'col-order',
      cell: (o) => (
        <span className="cell-stack">
          <LinkButton onClick={() => openOrderResult(o)} aria-label={`Open the waterfall for ${o.order_id}`} className="order-link">
            {o.order_id}
          </LinkButton>
          <span className="cell-sub">{o.date}</span>
        </span>
      ),
    },
    {
      id: 'channel',
      header: t('ledger.channelProduct'),
      cell: (o) => (
        <span className="cell-stack">
          <span>
            <KeyCell value={o.channel} />
          </span>
          <span className="cell-sub">
            <KeyCell value={o.product_id} />
          </span>
        </span>
      ),
    },
    {
      id: 'status',
      header: t('ledger.status'),
      className: 'col-status',
      cell: (o) => (
        <span className="pill-row">
          <OrderPills order={o} corrected={corrected.has(o.order_id)} />
        </span>
      ),
    },
    { id: 'net', header: t('ledger.netSales'), align: 'right', cell: (o) => <Money value={o.net_sales_inr} /> },
    { id: 'npc', header: t('ledger.productCost'), align: 'right', cell: (o) => <Deduction order={o} k="net_product_cost" /> },
    { id: 'ship', header: t('ledger.shipping'), align: 'right', cell: (o) => <Deduction order={o} k="shipping" /> },
    { id: 'fee', header: t('ledger.fee'), align: 'right', cell: (o) => <Deduction order={o} k="payment_fee" /> },
    { id: 'ret', header: t('ledger.return'), align: 'right', cell: (o) => <Deduction order={o} k="return_cost" /> },
    {
      id: 'hand',
      header:
        handlingEstimate > 0 ? (
          <span className="th-pill" title={`Rows without handling_inr use ${formatInr(handlingEstimate)} per order (estimate).`}>
            {t('ledger.handling')} <Pill tone="warning">{lower(t('status.estimated'))}</Pill>
          </span>
        ) : (
          t('ledger.handling')
        ),
      align: 'right',
      cell: (o) => <Deduction order={o} k="handling" />,
    },
    { id: 'ads', header: <SubHead main={t('ledger.ads')} sub={allocated} />, align: 'right', cell: (o) => <Deduction order={o} k="ads" title={`${t('ledger.ads')}: ${allocated}`} /> },
    {
      id: 'contribution',
      header: t('ledger.contribution'),
      align: 'right',
      className: 'col-strong',
      cell: (o) => <Money value={o.contribution_inr} tone="contribution" />,
    },
  ];
  return (
    <Table
      caption="Orders with their contribution. Select an order to open its waterfall."
      columns={columns}
      rows={orders}
      rowKey={(o) => o.order_id}
      onRowClick={openOrderResult}
      rowClassName={(o) => (fullReturnPartialRecovery(o) ? 'row-loss' : undefined)}
      sheet
      className="orders-table"
      emptyText="No orders match this filter."
    />
  );
}

/** The unit-economics percentages as columns, from each row's margins; fixed costs are shared by net revenue. */
function useMarginColumns(a: AnalysisResponse, kind: 'channel' | 'product', rows: GroupRow[]): Column<GroupRow>[] {
  const { fixedCosts } = useStore();
  const { t } = useTranslation();
  const f = useFormulas();
  const { byKey, total } = useMemo(() => {
    const period = marginsOf(a);
    const map = new Map(
      rows.map((r) => {
        const m = groupMarginsOf(a, r, kind);
        return [r.key, unitEconomics(m, rowFixedShare(fixedCosts, m.net_revenue_inr, period.net_revenue_inr))] as const;
      }),
    );
    return { byKey: map, total: unitEconomics(period, fixedCosts) };
  }, [a, kind, rows, fixedCosts]);
  const pct = (v: number | null | undefined) =>
    v === null || v === undefined ? <span className="cell-muted">—</span> : <span className={`num${v < 0 ? ' t-loss' : ''}`}>{formatMarginPct(v)}</span>;
  const head = (main: string, formula: string) => (
    <span className="th-formula" title={formula}>
      {main}
    </span>
  );
  return [
    { id: 'cm1', header: head(f.cm1.short, f.cm1.formula), align: 'right', className: 'col-pct', cell: (r) => pct(byKey.get(r.key)?.cm1Pct), footer: pct(total.cm1Pct) },
    { id: 'cm2', header: head(f.cm2.short, f.cm2.formula), align: 'right', className: 'col-pct', cell: (r) => pct(byKey.get(r.key)?.cm2Pct), footer: pct(total.cm2Pct) },
    { id: 'cm3', header: head(f.cm3.short, f.cm3.formula), align: 'right', className: 'col-pct', cell: (r) => pct(byKey.get(r.key)?.cm3Pct), footer: pct(total.cm3Pct) },
    {
      id: 'netm',
      header: (
        <SubHead
          main={f.net.short}
          sub={t('unit.fixedShared', 'fixed costs assumed')}
          title={`${f.net.formula}. ${t('unit.fixedSharedTip', 'Each row carries a share of the fixed costs in proportion to its net revenue (assumed).')}`}
        />
      ),
      align: 'right',
      className: 'col-pct',
      cell: (r) => pct(byKey.get(r.key)?.netPct),
      footer: pct(total.netPct),
    },
  ];
}

function ChannelTable({ a }: { a: AnalysisResponse }) {
  const rows = a.groups.channel;
  const { t } = useTranslation();
  const marginCols = useMarginColumns(a, 'channel', rows);
  const allocated = t(ALLOCATED_KEY, ALLOCATED_EN);
  const columns: Column<GroupRow>[] = [
    { id: 'key', header: t('ledger.channel'), rowHeader: true, cell: (r) => <KeyCell value={r.key} />, footer: t('common.total') },
    { id: 'orders', header: t('ledger.orders'), align: 'right', cell: (r) => <span className="num">{formatCount(r.orders)}</span>, footer: <span className="num">{formatCount(rows.reduce((s, r) => s + r.orders, 0))}</span> },
    {
      id: 'unknown',
      header: t('status.unknown'),
      align: 'right',
      cell: (r) => (r.unknown_count > 0 ? <Pill tone="warning">{formatCount(r.unknown_count)}</Pill> : <span className="cell-muted">0</span>),
      footer: <span className="num">{formatCount(rows.reduce((s, r) => s + r.unknown_count, 0))}</span>,
    },
    {
      id: 'net',
      header: <span title={t('unit.netRevenueFormula', 'Net revenue = revenue − refunds (revenue is gross sales after discount)')}>{t('unit.netRevenue', 'Net revenue')}</span>,
      align: 'right',
      cell: (r) => <Money value={r.net_sales_inr} />,
      footer: <Money value={sumInr(rows, (r) => r.net_sales_inr)} />,
    },
    {
      id: 'before',
      header: t('ledger.beforeSpend'),
      align: 'right',
      cell: (r) => <Money value={r.contribution_before_spend_inr} />,
      footer: <Money value={sumInr(rows, (r) => r.contribution_before_spend_inr)} />,
    },
    {
      id: 'spend',
      header: <SubHead main={t('ledger.channelSpend')} sub={allocated} />,
      align: 'right',
      cell: (r) => <Money value={r.channel_spend_inr} tone="plain" muteZero />,
      footer: <Money value={sumInr(rows, (r) => r.channel_spend_inr)} tone="plain" muteZero />,
    },
    {
      id: 'contribution',
      header: t('ledger.contribution'),
      align: 'right',
      className: 'col-strong',
      cell: (r) => <Money value={r.contribution_inr} tone="contribution" />,
      footer: <Money value={a.reconciliation.channels_inr} tone="contribution" />,
    },
    ...marginCols,
  ];
  return <Table caption="Contribution by channel, with unit economics" columns={columns} rows={rows} rowKey={(r) => r.key} className="group-table" />;
}

function ProductTable({ a }: { a: AnalysisResponse }) {
  const rows = a.groups.product;
  const unallocated = a.groups.product_unallocated_spend_inr;
  const channelMode = a.attribution === 'channel';
  const label = a.groups.product_label;
  const { t } = useTranslation();
  const marginCols = useMarginColumns(a, 'product', rows);
  const columns: Column<GroupRow>[] = [
    { id: 'key', header: t('ledger.product'), rowHeader: true, cell: (r) => <KeyCell value={r.key} />, footer: t('common.total') },
    { id: 'orders', header: t('ledger.orders'), align: 'right', cell: (r) => <span className="num">{formatCount(r.orders)}</span>, footer: <span className="num">{formatCount(rows.reduce((s, r) => s + r.orders, 0))}</span> },
    {
      id: 'unknown',
      header: t('status.unknown'),
      align: 'right',
      cell: (r) => (r.unknown_count > 0 ? <Pill tone="warning">{formatCount(r.unknown_count)}</Pill> : <span className="cell-muted">0</span>),
      footer: <span className="num">{formatCount(rows.reduce((s, r) => s + r.unknown_count, 0))}</span>,
    },
    {
      id: 'net',
      header: <span title={t('unit.netRevenueFormula', 'Net revenue = revenue − refunds (revenue is gross sales after discount)')}>{t('unit.netRevenue', 'Net revenue')}</span>,
      align: 'right',
      cell: (r) => <Money value={r.net_sales_inr} />,
      footer: <Money value={sumInr(rows, (r) => r.net_sales_inr)} />,
    },
    {
      id: 'contribution',
      header: label ? <SubHead main={t('ledger.contribution')} sub={label} /> : t('ledger.contribution'),
      align: 'right',
      className: 'col-strong',
      cell: (r) => <Money value={r.contribution_inr} tone="contribution" />,
      footer: <Money value={a.reconciliation.products_inr} tone="contribution" />,
    },
    ...marginCols,
  ];
  const extra = channelMode ? (
    <tr className="spend-row">
      <th scope="row" colSpan={4}>
        {t('ledger.spendRow', 'Channel spend (not allocated to products)')} <span className="th-sub">{t(ALLOCATED_KEY, ALLOCATED_EN)}</span>
      </th>
      <td className="r col-strong">
        <Money value={unallocated === null ? null : -unallocated} />
      </td>
      <td colSpan={marginCols.length} />
    </tr>
  ) : null;
  return (
    <Table
      caption={`Contribution by product, ${label || 'per order'}, with unit economics`}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      extraRows={extra}
      className="group-table"
    />
  );
}

function LateRefunds({ a }: { a: AnalysisResponse }) {
  const { openOrderResult } = useStore();
  const late = a.late_refunds;
  if (late.orders.length === 0) return null;
  const n = late.orders.length;
  return (
    <Callout tone="warning" title={`${formatCount(n)} ${plural(n, 'refund', 'refunds')} dated after the period end (${late.period_end}) ${plural(n, 'is', 'are')} pending`}>
      <p>Counted in this period as kept. If recognised, operational contribution changes by {formatInr(late.pending_delta_inr)} (a prior-period adjustment).</p>
      <ul className="late-list">
        {late.orders.slice(0, 5).map((o) => (
          <li key={o.order_id}>
            <LinkButton onClick={() => openOrderResult(o)}>{o.order_id}</LinkButton>
            <span className="cell-sub"> refund {o.refund_date}</span>
            <span className="late-pair">
              in period <Money value={o.contribution_inr} tone="contribution" />
              <Icon name="arrow-right" size={14} />
              if recognised <Money value={o.recognised_contribution_inr} tone="contribution" />
            </span>
          </li>
        ))}
      </ul>
      {n > 5 ? <p className="muted small">and {formatCount(n - 5)} more — use the Late refund filter to see them all.</p> : null}
      <p>
        Total if recognised <Money value={late.total_if_recognised_inr} tone="contribution" />
      </p>
    </Callout>
  );
}

/** Rows the import set aside (duplicates first): a count beside the ledger title, linking to the report. */
function ImportWarnings() {
  const { dataset, analysis } = useStore();
  const { t } = useTranslation();
  if (!dataset || !analysis || dataset.dataset_id !== analysis.dataset_id) return null;
  const duplicates = dataset.flags.filter((f) => f.reason === 'duplicate').length;
  const others = dataset.flags.filter((f) => f.reason !== 'duplicate' && f.action !== 'kept').length;
  if (duplicates + others === 0) return null;
  const parts = [
    duplicates > 0
      ? duplicates === 1
        ? t('ledger.duplicateIgnored', '1 duplicate ignored')
        : t('ledger.duplicatesIgnored', '{{n}} duplicates ignored', { n: duplicates })
      : null,
    others > 0 ? (others === 1 ? t('ledger.rowSetAside', '1 row set aside') : t('ledger.rowsSetAside', '{{n}} rows set aside', { n: others })) : null,
  ].filter(Boolean);
  const ids = dataset.flags.filter((f) => f.reason === 'duplicate').map((f) => f.order_id ?? `line ${f.line}`);
  return (
    <a
      className="warn-badge"
      href={hrefFor('import')}
      title={
        duplicates > 0
          ? t('ledger.duplicateTip', 'Duplicate order ids ({{ids}}): the second copy was ignored, so the order count is unchanged. Open the import report.', { ids: ids.join(', ') })
          : t('ledger.warningsTip', 'Open the import report for the rows set aside.')
      }
    >
      <Icon name="alert-triangle" size={14} />
      <span className="warn-badge-count">{formatCount(duplicates + others)}</span>
      <span>{parts.join(' · ')}</span>
    </a>
  );
}

export function LedgerScreen() {
  const { analysis, ledgerTab: tab, setLedgerTab: setTab, ledgerFilter: filter, setLedgerFilter: setFilter, tableFocus, openOrderResult, showToast } = useStore();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const tableRef = useRef<HTMLElement>(null);
  const seenFocus = useRef(lastHandledFocus);

  // A card, drawer or another step asked for the table: bring it into view, highlight it, focus it.
  useEffect(() => {
    if (tableFocus === seenFocus.current) return undefined;
    // Deferred so a closing drawer has handed focus back first.
    const t = window.setTimeout(() => {
      if (seenFocus.current === tableFocus) return;
      seenFocus.current = tableFocus;
      lastHandledFocus = tableFocus;
      setQuery('');
      revealElement(tableRef.current);
    }, 60);
    return () => window.clearTimeout(t);
  }, [tableFocus]);

  const orders = analysis?.orders ?? [];
  const counts = useMemo(
    () => ({
      all: orders.length,
      losing: orders.filter((o) => o.contribution_inr !== null && o.contribution_inr < 0).length,
      unknown: orders.filter((o) => o.status === 'unknown').length,
      late: orders.filter((o) => o.late_refund).length,
      synthetic: orders.filter((o) => o.synthetic).length,
    }),
    [orders],
  );
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (q && !o.order_id.toLowerCase().includes(q)) return false;
      if (filter === 'losing') return o.contribution_inr !== null && o.contribution_inr < 0;
      if (filter === 'unknown') return o.status === 'unknown';
      if (filter === 'late') return o.late_refund;
      if (filter === 'synthetic') return o.synthetic;
      return true;
    });
  }, [orders, filter, query]);

  // Any change to what is shown starts again at page 1.
  const analysisKey = analysis?.analysis_id ?? null;
  useEffect(() => {
    setPage(1);
  }, [filter, query, analysisKey]);

  if (!analysis) {
    return (
      <div className="page">
        <PageHeader title={t('ledger.title')} subtitle="Per-order contribution after every cost, reconciled to channels and products." />
        <NeedsAnalysis sentence="No ledger yet. Load the sample orders to see contribution per order." icon="table" />
      </div>
    );
  }

  const tabs = [
    { id: 'orders' as const, label: t('ledger.orders'), count: analysis.orders.length },
    { id: 'channel' as const, label: t('ledger.byChannel'), count: analysis.groups.channel.length },
    { id: 'product' as const, label: t('ledger.byProduct'), count: analysis.groups.product.length },
  ];
  // noun: the English word in the filter note sentence, which stays English.
  const filters: Array<{ id: Filter; label: string; noun: string }> = [
    { id: 'all', label: t('common.all'), noun: 'all' },
    { id: 'losing', label: t('ledger.losing'), noun: 'losing' },
    { id: 'unknown', label: t('status.unknown'), noun: 'unknown' },
    { id: 'late', label: t('status.lateRefund'), noun: 'late refund' },
    { id: 'synthetic', label: t('status.syntheticTag'), noun: 'synthetic' },
  ];
  const notes = analysis.labels.filter((l) => !SHOWN_ELSEWHERE.includes(l));
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const first = (current - 1) * PAGE_SIZE;
  const pageRows = visible.slice(first, first + PAGE_SIZE);
  const goPage = (p: number) => {
    setPage(Math.max(1, Math.min(pageCount, p)));
    tableRef.current?.querySelector('.table-sheet')?.scrollTo({ top: 0 });
  };
  const unknownInCurve = analysis.orders.filter((o) => o.contribution_inr === null).length;

  return (
    <div className="page">
      <PageHeader
        title={t('ledger.title')}
        subtitle={
          <>
            Per-order contribution after every cost, reconciled to channels and products.
            {notes.length > 0 ? <InfoTip label="About this data" text={notes.join(' ')} /> : null}
          </>
        }
        actions={
          <>
            <ImportWarnings />
            <Definitions />
          </>
        }
      />

      <ReconciliationLine rec={analysis.reconciliation} />
      <Kpis a={analysis} />
      <PeriodTotals a={analysis} />
      <UnitEconomics a={analysis} />

      <div className="grid-2">
        <ChannelChart a={analysis} />
        <WhaleCurve
          points={analysis.whale}
          unknownCount={unknownInCurve}
          channelSpend={analysis.attribution === 'channel' ? analysis.totals.channel_spend_inr : null}
        />
      </div>

      <section className="card table-card table-target" aria-label="Ledger tables" ref={tableRef} tabIndex={-1}>
        <div className="table-toolbar">
          <Tabs label="Ledger views" idPrefix="ledger" tabs={tabs} value={tab} onChange={setTab} />
          {tab === 'orders' ? (
            <div className="toolbar-tools">
              <div className="chips" role="group" aria-label="Filter orders">
                {filters.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`chip-filter${filter === f.id ? ' is-on' : ''}`}
                    aria-pressed={filter === f.id}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                    <span className="chip-count">{formatCount(counts[f.id])}</span>
                  </button>
                ))}
              </div>
              <label className="search">
                <Icon name="search" size={16} />
                <span className="visually-hidden">Search order id</span>
                <input type="search" placeholder="Search order id" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
            </div>
          ) : null}
          <ButtonLink
            variant="secondary"
            size="sm"
            icon="download"
            href={api.ledgerExportUrl(analysis.analysis_id, 'csv')}
            download
            onClick={authDownload(api.ledgerExportUrl(analysis.analysis_id, 'csv'), `ledger-${analysis.analysis_id}.csv`, (e) => showToast(e.message, 'info'))}
            className="toolbar-export"
          >
            {t('actions.exportCsv')}
          </ButtonLink>
        </div>
        {tab === 'orders' && filter !== 'all' ? (
          <div className="filter-note" role="status">
            <Icon name="info" size={16} />
            <span>
              Showing {formatCount(visible.length)} {filters.find((f) => f.id === filter)?.noun} {visible.length === 1 ? 'order' : 'orders'}.
            </span>
            {visible.length === 1 && (filter === 'late' || filter === 'unknown') ? (
              <LinkButton onClick={() => openOrderResult(visible[0])}>Open {visible[0].order_id}</LinkButton>
            ) : null}
            <LinkButton onClick={() => setFilter('all')}>Clear filter</LinkButton>
          </div>
        ) : null}
        <div role="tabpanel" id={panelId('ledger', tab)} aria-labelledby={tabId('ledger', tab)} className="tabpanel">
          {tab === 'orders' ? (
            <>
              <OrdersTable orders={pageRows} handlingEstimate={handlingEstimateUsed(analysis) ? analysis.config.handling_default_inr : 0} />
              <div className="table-foot table-foot-pager">
                <span>
                  {visible.length === 0
                    ? 'No orders to show'
                    : `Showing ${formatCount(first + 1)}–${formatCount(first + pageRows.length)} of ${formatCount(visible.length)}`}
                  {visible.length !== analysis.orders.length ? ` (filtered from ${formatCount(analysis.orders.length)})` : ''} · select a row for its waterfall
                </span>
                <Pagination page={current} pageCount={pageCount} onPage={goPage} label="Orders pages" />
              </div>
            </>
          ) : tab === 'channel' ? (
            <ChannelTable a={analysis} />
          ) : (
            <ProductTable a={analysis} />
          )}
        </div>
      </section>

      <LateRefunds a={analysis} />

      <NextStep route="leaks" label={t('actions.reviewLeaks')}>
        {analysis.totals.negative_count > 0
          ? `${formatCount(analysis.totals.negative_count)} ${plural(analysis.totals.negative_count, 'order loses', 'orders lose')} money. See why, grouped by cause.`
          : 'See whether any order loses money, grouped by cause.'}
      </NextStep>
    </div>
  );
}
