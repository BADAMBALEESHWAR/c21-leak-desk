import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnalysisResponse, GroupRow, LeakCause, LineKey, OrderResult } from '../api/types';
import { ChartCard, ChartTable, type TipRow } from '../charts/ChartCard';
import { DivergingBars, type DivergingRow } from '../charts/DivergingBars';
import { WhaleCurve } from '../charts/WhaleCurve';
import { Pill, Unknown } from '../components/Badge';
import { ButtonLink, LinkButton } from '../components/Button';
import { Pagination } from '../components/Pagination';
import { api, authDownload } from '../api/client';
import { AskAiButton } from '../components/AskAiButton';
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
import { ALLOCATED_EN, ALLOCATED_KEY, ATTRIBUTION_LABEL, fullReturnPartialRecovery, handlingEstimateUsed, LEAK_LABELS } from '../lib/labels';
import { formatMonth } from '../charts/scale';
import { fromHref, hasLedgerFilter, hrefFor, ledgerHref, parseFrom, parseLedgerQuery, useHashParams, type LedgerQuery } from '../lib/router';
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
        ask={<AskAiButton question={tr('askq.gross', 'Explain gross sales')} about={tr('ledger.gross')} />}
      />
      <StatCard
        label={tr('ledger.netSales')}
        value={<Money value={t.net_sales_inr} tone="plain" />}
        icon="table"
        sub="After discounts and refunds"
        onClick={() => openBridge('net_sales')}
        actionLabel={`Net sales ${formatInr(t.net_sales_inr)} — open period waterfall`}
        ask={<AskAiButton question={tr('askq.netSales', 'Explain net sales')} about={tr('ledger.netSales')} />}
      />
      <StatCard
        label={tr('ledger.operationalContribution', 'Operational contribution')}
        large
        tone="primary"
        icon="trending-down"
        value={<Money value={t.contribution_inr} tone="contribution" />}
        onClick={() => openBridge('contribution')}
        ask={<AskAiButton question={tr('askq.contribution', 'Explain operational contribution')} about={tr('ledger.operationalContribution', 'Operational contribution')} />}
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
        ask={<AskAiButton question={tr('askq.orders', 'Which orders are losing money?')} about={tr('ledger.orders')} />}
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

/** Contribution by channel or by product as diverging bars around ₹0; each bar opens its orders below. */
const ContributionChart = memo(function ContributionChart({ a }: { a: AnalysisResponse }) {
  const { t } = useTranslation();
  const [dim, setDim] = useState<'channel' | 'product'>('channel');
  const channelMode = a.attribution === 'channel';
  const groups = dim === 'channel' ? a.groups.channel : a.groups.product;
  const totalOrders = groups.reduce((n, g) => n + g.orders, 0) || 1;
  const ordersText = (n: number) => t('chart.ordersN', '{{n}} orders', { n: formatCount(n) });
  const rows: DivergingRow[] = groups.map((g) => {
    const tip: TipRow[] = [
      { label: t('ledger.orders'), value: formatCount(g.orders) },
      { label: t('ledger.netSales'), value: formatInr(g.net_sales_inr) },
    ];
    if (dim === 'channel' && channelMode) {
      tip.push({ label: t('ledger.beforeSpend'), value: formatInr(g.contribution_before_spend_inr) });
      tip.push({ label: `${t('ledger.channelSpend')} (${t(ALLOCATED_KEY, ALLOCATED_EN)})`, value: g.channel_spend_inr === null ? t('status.unknown') : formatInr(g.channel_spend_inr) });
    }
    if (g.unknown_count > 0) tip.push({ label: lower(t('status.unknown')), value: formatCount(g.unknown_count) });
    return {
      key: g.key,
      label: g.key,
      value: g.contribution_inr,
      share: g.orders / totalOrders,
      sub: `${ordersText(g.orders)}${g.unknown_count ? ` · ${formatCount(g.unknown_count)} ${lower(t('status.unknown'))}` : ''}`,
      tip,
      href: ledgerHref(dim === 'channel' ? { channel: g.key } : { product: g.key }),
    };
  });
  const title = dim === 'channel' ? t('chart.byChannelTitle', 'Contribution by channel') : t('chart.byProductTitle', 'Contribution by product');
  const dimLabel = dim === 'channel' ? t('ledger.channel') : t('ledger.product');
  const table = (
    <ChartTable
      caption={title}
      headers={[dimLabel, t('ledger.orders'), t('chart.shareOfOrdersHead', 'Share of orders'), t('ledger.netSales'), t('ledger.contribution'), ...(dim === 'channel' && channelMode ? [t('ledger.channelSpend')] : [])]}
      rows={groups.map((g) => ({
        key: g.key,
        cells: [
          <a key="k" href={ledgerHref(dim === 'channel' ? { channel: g.key } : { product: g.key })}>{g.key}</a>,
          formatCount(g.orders),
          formatPct((g.orders / totalOrders) * 100),
          <Money key="n" value={g.net_sales_inr} tone="plain" />,
          <Money key="c" value={g.contribution_inr} tone="contribution" />,
          ...(dim === 'channel' && channelMode ? [<Money key="s" value={g.channel_spend_inr} tone="plain" />] : []),
        ],
      }))}
    />
  );
  const csv = {
    filename: `contribution-by-${dim}.csv`,
    headers: [dim, 'orders', 'share_of_orders_pct', 'net_sales_inr', 'contribution_before_spend_inr', 'channel_spend_inr', 'contribution_inr', 'unknown_orders'],
    rows: groups.map((g) => [g.key, g.orders, Math.round((g.orders / totalOrders) * 10000) / 100, g.net_sales_inr, g.contribution_before_spend_inr, g.channel_spend_inr, g.contribution_inr, g.unknown_count]),
  };
  return (
    <ChartCard
      title={title}
      subtitle={
        <>
          {channelMode && dim === 'channel'
            ? t('ledger.chartChannel', 'Contribution after spend, next to the channel spend deducted once per channel. Spend is allocated, not caused.')
            : t('ledger.chartAllocate', 'Contribution after ads allocated to each order (allocated, not caused).')}{' '}
          {t('chart.clickBar', 'Select a bar to see its orders.')}
        </>
      }
      legend={[
        { label: t('chart.legendGain', 'Contribution ≥ ₹0'), tone: 'gain' },
        { label: t('chart.legendLoss', 'Contribution < ₹0'), tone: 'loss' },
        { label: t('chart.shareOfOrdersHead', 'Share of orders'), tone: 'muted', shape: 'thin' },
      ]}
      table={table}
      csv={csv}
      actions={
        <>
          <AskAiButton
            question={dim === 'channel' ? t('askq.channel', 'Which channel is losing money?') : t('askq.product', 'Which product is losing money?')}
            about={title}
          />
          <span className="chart-seg" role="group" aria-label={t('chart.groupBy', 'Group by')}>
            <button type="button" aria-pressed={dim === 'channel'} onClick={() => setDim('channel')}>
              {t('ledger.byChannel')}
            </button>
            <button type="button" aria-pressed={dim === 'product'} onClick={() => setDim('product')}>
              {t('ledger.byProduct')}
            </button>
          </span>
        </>
      }
    >
      <DivergingBars rows={rows} measure={t('ledger.contribution')} ariaLabel={title} format={formatInr} labelWidth={dim === 'channel' ? 120 : 104} />
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

function OrdersTable({ orders, handlingEstimate, isMatch }: { orders: OrderResult[]; handlingEstimate: number; isMatch?: (o: OrderResult) => boolean }) {
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
      rowClassName={(o) =>
        [fullReturnPartialRecovery(o) ? 'row-loss' : null, isMatch ? (isMatch(o) ? 'row-match' : 'row-dim') : null].filter(Boolean).join(' ') || undefined
      }
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

// ---- Click-to-cause: a filter from a leak card, a chart bar or a Pulse row ----------------------------

type TFn = ReturnType<typeof useTranslation>['t'];

/** Payment type travels on each order from the API (not in the typed contract). */
const paymentOf = (o: OrderResult): string | null => (o as OrderResult & { payment_type?: string | null }).payment_type ?? null;

export function matchesLedgerQuery(o: OrderResult, q: LedgerQuery): boolean {
  if (q.cause && o.leak_cause !== q.cause) return false;
  if (q.channel && o.channel !== q.channel) return false;
  if (q.product && o.product_id !== q.product) return false;
  if (q.month && o.date.slice(0, 7) !== q.month) return false;
  if (q.payment && (paymentOf(o) ?? '').toLowerCase() !== q.payment.toLowerCase()) return false;
  return true;
}

const lineAmount = (o: OrderResult, k: LineKey): number => Math.abs(o.lines.find((l) => l.key === k)?.amount_inr ?? 0);

export interface FocusFigures {
  orders: number;
  netSales: number;
  /** Over the orders whose contribution is known; `unknown` counts the rest. */
  contribution: number;
  losing: number;
  /** Rupees lost across the losing orders (positive). */
  lost: number;
  unknown: number;
  recovered: number;
  productCost: number;
  discount: number;
  fees: number;
  returnCosts: number;
  /** The cause with the most rupees lost among the matching orders. */
  topCause: LeakCause | null;
}

/** The numbers the strip's sentence quotes, summed from the matching orders. */
export function focusFigures(orders: OrderResult[]): FocusFigures {
  const f: FocusFigures = { orders: orders.length, netSales: 0, contribution: 0, losing: 0, lost: 0, unknown: 0, recovered: 0, productCost: 0, discount: 0, fees: 0, returnCosts: 0, topCause: null };
  const byCause = new Map<LeakCause, number>();
  for (const o of orders) {
    f.netSales += o.net_sales_inr ?? 0;
    if (o.contribution_inr === null) {
      f.unknown += 1;
    } else {
      f.contribution += o.contribution_inr;
      if (o.contribution_inr < 0) {
        f.losing += 1;
        f.lost += -o.contribution_inr;
      }
    }
    f.recovered += o.inputs.recovered ?? 0;
    f.productCost += o.inputs.product_cost ?? 0;
    f.discount += o.inputs.discount ?? 0;
    f.fees += lineAmount(o, 'shipping') + lineAmount(o, 'payment_fee') + lineAmount(o, 'handling');
    f.returnCosts += lineAmount(o, 'return_cost');
    if (o.leak_cause) byCause.set(o.leak_cause, (byCause.get(o.leak_cause) ?? 0) + Math.max(0, -(o.contribution_inr ?? 0)));
  }
  let best = -1;
  for (const [c, v] of byCause) {
    if (v > best) {
      best = v;
      f.topCause = c;
    }
  }
  return f;
}

export function causeLabel(t: TFn, cause: string): string {
  const en = (LEAK_LABELS as Record<string, string>)[cause] ?? cause.replace(/_/g, ' ');
  return t(`focus.cause.${cause}`, en);
}

/** One sentence per leak cause, with the rupees that matter for that cause. */
function causeSentence(t: TFn, cause: string, f: FocusFigures): string {
  const n = formatCount(f.orders);
  const lost = formatInr(f.lost);
  switch (cause) {
    case 'full_return_partial_recovery':
      return t('focus.sentence.fullReturn', '{{n}} orders refunded in full with only {{recovered}} of {{cost}} recovered → {{lost}} lost.', {
        n,
        recovered: formatInr(f.recovered),
        cost: formatInr(f.productCost),
        lost,
      });
    case 'discount_exceeds_margin':
      return t('focus.sentence.discount', '{{n}} orders where the discount ({{discount}} in total) went deeper than the margin → {{lost}} lost.', { n, discount: formatInr(f.discount), lost });
    case 'fees_exceed_margin':
      return t('focus.sentence.fees', '{{n}} kept orders where shipping, fees and handling ({{costs}}) cost more than the margin left → {{lost}} lost.', { n, costs: formatInr(f.fees), lost });
    case 'other_negative':
      return t('focus.sentence.other', '{{n}} returned orders whose return costs ({{costs}}) were not recovered → {{lost}} lost.', { n, costs: formatInr(f.returnCosts), lost });
    case 'refund_unknown':
      return t('focus.sentence.unknown', '{{n}} returned orders have no refund or recovery fact yet, so their loss is unknown, never counted as zero.', { n });
    default:
      return t('focus.sentence.otherCause', '{{n}} orders with this cause → {{lost}} lost.', { n, lost });
  }
}

/** "Channel Amazon · Oct 2025 (by order date)": the non-cause filters in words. */
function scopeText(t: TFn, q: LedgerQuery): string {
  const parts: string[] = [];
  if (q.channel) parts.push(t('focus.scope.channel', 'Channel {{name}}', { name: q.channel }));
  if (q.product) parts.push(t('focus.scope.product', 'Product {{name}}', { name: q.product }));
  if (q.month) parts.push(t('focus.scope.month', '{{month}} (by order date)', { month: formatMonth(q.month) }));
  if (q.payment) parts.push(t('focus.scope.payment', 'Payment {{name}}', { name: q.payment.toLowerCase() === 'cod' ? 'COD' : q.payment }));
  return parts.join(' · ');
}

export function focusSentence(t: TFn, q: LedgerQuery, f: FocusFigures): string {
  const scope = scopeText(t, q);
  if (q.cause) {
    const body = causeSentence(t, q.cause, f);
    return scope ? `${scope}: ${body}` : body;
  }
  const contribution =
    f.unknown > 0
      ? t('focus.withUnknown', '{{inr}} ({{n}} unknown left out)', { inr: formatInr(f.contribution), n: formatCount(f.unknown) })
      : formatInr(f.contribution);
  return t('focus.sentence.scope', '{{scope}}: {{n}} orders, {{net}} net sales, {{contribution}} operational contribution; {{losing}} lose money ({{lost}}).', {
    scope,
    n: formatCount(f.orders),
    net: formatInr(f.netSales),
    contribution,
    losing: formatCount(f.losing),
    lost: formatInr(f.lost),
  });
}

function FocusStrip({
  q,
  figures,
  showAll,
  onShowAll,
  stripRef,
  onShowOrders,
}: {
  q: LedgerQuery;
  figures: FocusFigures;
  showAll: boolean;
  onShowAll: (v: boolean) => void;
  stripRef: RefObject<HTMLElement>;
  onShowOrders: () => void;
}) {
  const { t } = useTranslation();
  const from = parseFrom(q.from);
  const back = fromHref(q.from);
  const fromLabel = from ? `${t(`nav.${from.route}`, from.route)}${from.tab ? ` · ${t(`focus.tab.${from.tab}`, from.tab)}` : ''}` : null;
  const scope = scopeText(t, q);
  const filterLabel = [q.cause ? causeLabel(t, q.cause) : null, scope || null].filter(Boolean).join(' · ');
  const fixCause = q.cause ?? (figures.losing > 0 ? figures.topCause : null);
  const problem = !!q.cause || figures.losing > 0;
  return (
    <section ref={stripRef} className={`focus-strip${problem ? ' is-problem' : ''}`} aria-label={t('focus.region', 'Filtered orders')} tabIndex={-1}>
      <ol className="focus-crumbs" aria-label={t('focus.breadcrumb', 'Breadcrumb')}>
        {from && back ? (
          <li>
            <a href={back}>{fromLabel}</a>
          </li>
        ) : null}
        <li>{filterLabel}</li>
        <li aria-current="page">{t('nav.ledger')}</li>
      </ol>
      <p className="focus-sentence" role="status">
        <strong>{q.cause ? t('focus.problem', 'Problem:') : t('focus.showing', 'Showing:')}</strong> {focusSentence(t, q, figures)}
      </p>
      <div className="focus-actions">
        {fixCause ? (
          <ButtonLink variant="primary" size="sm" href={hrefFor('leaks', { fix: fixCause })} iconRight="arrow-right">
            {q.cause ? t('focus.fixThis', 'Fix this') : t('focus.fixTop', 'Fix the biggest leak here: {{cause}}', { cause: causeLabel(t, fixCause) })}
          </ButtonLink>
        ) : null}
        <ButtonLink variant="secondary" size="sm" href={hrefFor('ledger')}>
          {t('focus.clear', 'Clear filter')}
        </ButtonLink>
        <LinkButton onClick={onShowOrders}>{t('focus.showOrders', 'Go to the {{n}} orders', { n: formatCount(figures.orders) })}</LinkButton>
        <label className="focus-toggle">
          <input type="checkbox" checked={showAll} onChange={(e) => onShowAll(e.target.checked)} />
          {t('focus.showAll', 'Show all orders, matches highlighted')}
        </label>
        {back ? (
          <a href={back} className="focus-back">
            ← {t('focus.back', 'Back to {{where}}', { where: fromLabel })}
          </a>
        ) : null}
      </div>
    </section>
  );
}

export function LedgerScreen() {
  const { analysis, ledgerTab: tab, setLedgerTab: setTab, ledgerFilter: filter, setLedgerFilter: setFilter, tableFocus, openOrderResult, showToast, focusLedgerTable } = useStore();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const tableRef = useRef<HTMLElement>(null);
  const stripRef = useRef<HTMLElement>(null);
  const seenFocus = useRef(lastHandledFocus);
  const hashParams = useHashParams();
  const lq = useMemo(() => parseLedgerQuery(hashParams), [hashParams]);
  const focused = hasLedgerFilter(lq);
  const focusKey = focused ? ledgerHref({ ...lq, from: undefined }) : '';
  const [showAll, setShowAll] = useState(false);
  const lastFocusKey = useRef<string | null>(null);

  // A new filter from a link: orders view, all chips off, page 1, and the problem strip in view.
  useEffect(() => {
    if (!focused || lastFocusKey.current === focusKey) {
      lastFocusKey.current = focusKey;
      return undefined;
    }
    const first = lastFocusKey.current === null;
    lastFocusKey.current = focusKey;
    setTab('orders');
    setFilter('all');
    setShowAll(false);
    setQuery('');
    // On arrival from another step the app scrolls to the top first; the strip is there already.
    if (first) return undefined;
    const timer = window.setTimeout(() => revealElement(stripRef.current), 60);
    return () => window.clearTimeout(timer);
    // setTab and setFilter are stable store setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, focused]);

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
  const matching = useMemo(() => (focused ? orders.filter((o) => matchesLedgerQuery(o, lq)) : orders), [orders, lq, focused]);
  const figures = useMemo(() => focusFigures(matching), [matching]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (focused && !showAll && !matchesLedgerQuery(o, lq)) return false;
      if (q && !o.order_id.toLowerCase().includes(q)) return false;
      if (filter === 'losing') return o.contribution_inr !== null && o.contribution_inr < 0;
      if (filter === 'unknown') return o.status === 'unknown';
      if (filter === 'late') return o.late_refund;
      if (filter === 'synthetic') return o.synthetic;
      return true;
    });
  }, [orders, filter, query, focused, showAll, lq]);

  // Any change to what is shown starts again at page 1.
  const analysisKey = analysis?.analysis_id ?? null;
  useEffect(() => {
    setPage(1);
  }, [filter, query, analysisKey, focusKey, showAll]);

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
  const isMatch = focused && showAll ? (o: OrderResult) => matchesLedgerQuery(o, lq) : focused ? () => true : undefined;

  const tableSection = (
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
      {tab === 'orders' && focused ? (
        <div className="filter-note" role="status">
          <Icon name="info" size={16} />
          <span>
            {showAll
              ? t('focus.noteAll', '{{n}} of {{total}} orders match; they are marked on the left.', { n: formatCount(matching.length), total: formatCount(analysis.orders.length) })
              : t('focus.noteOnly', 'Only the {{n}} matching orders are listed.', { n: formatCount(matching.length) })}
          </span>
          <a href={hrefFor('ledger')}>{t('focus.clear', 'Clear filter')}</a>
        </div>
      ) : null}
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
            <OrdersTable orders={pageRows} handlingEstimate={handlingEstimateUsed(analysis) ? analysis.config.handling_default_inr : 0} isMatch={isMatch} />
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
  );

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

      {focused ? (
        <>
          <FocusStrip q={lq} figures={figures} showAll={showAll} onShowAll={setShowAll} stripRef={stripRef} onShowOrders={() => revealElement(tableRef.current)} />
          {tableSection}
        </>
      ) : null}

      <ReconciliationLine rec={analysis.reconciliation} />
      <Kpis a={analysis} />
      <PeriodTotals a={analysis} />
      <UnitEconomics a={analysis} />

      <div className="grid-2">
        <ContributionChart a={analysis} />
        <WhaleCurve
          points={analysis.whale}
          unknownCount={unknownInCurve}
          channelSpend={analysis.attribution === 'channel' ? analysis.totals.channel_spend_inr : null}
          onShowAfterPeak={() => {
            if (focused) window.location.hash = hrefFor('ledger');
            focusLedgerTable('losing');
          }}
        />
      </div>

      {focused ? null : tableSection}

      <LateRefunds a={analysis} />

      <NextStep route="leaks" label={t('actions.reviewLeaks')}>
        {analysis.totals.negative_count > 0
          ? `${formatCount(analysis.totals.negative_count)} ${plural(analysis.totals.negative_count, 'order loses', 'orders lose')} money. See why, grouped by cause.`
          : 'See whether any order loses money, grouped by cause.'}
      </NextStep>
    </div>
  );
}
