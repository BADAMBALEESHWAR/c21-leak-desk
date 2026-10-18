import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { LeakCause, LeakGroup, OrderResult } from '../api/types';
import { BarRows, type BarRow } from '../charts/BarRows';
import { Pill, SourceTag } from '../components/Badge';
import { ButtonLink, LinkButton } from '../components/Button';
import { NeedsAnalysis } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { Money } from '../components/Money';
import { FullReturnChip } from '../components/OrderDrawer';
import { NextStep, PageHeader } from '../components/Page';
import { Table, type Column } from '../components/Table';
import { EmptyPanel, revealElement } from '../components/ui';
import { lower } from '../i18n';
import { formatInr, plural } from '../lib/format';
import { fullReturnPartialRecovery, LEAK_LABELS } from '../lib/labels';
import { hrefFor } from '../lib/router';
import { useStore } from '../state/store';

/** Full return with partial recovery leads; then the largest known loss; unknown amounts last. */
const CAUSE_FIRST: LeakCause = 'full_return_partial_recovery';

export function sortLeakGroups(groups: LeakGroup[]): LeakGroup[] {
  return [...groups].sort((a, b) => {
    if (a.cause === CAUSE_FIRST || b.cause === CAUSE_FIRST) return a.cause === CAUSE_FIRST ? -1 : 1;
    if (a.lost_inr === null || b.lost_inr === null) return a.lost_inr === null ? 1 : -1;
    return b.lost_inr - a.lost_inr;
  });
}

/** Negative contribution first (most negative on top, full returns first on a tie), then unknown orders. */
export function sortLosingOrders(orders: OrderResult[]): OrderResult[] {
  return orders
    .filter((o) => (o.contribution_inr !== null && o.contribution_inr < 0) || (o.leak_cause !== null && o.contribution_inr === null))
    .sort((a, b) => {
      if (a.contribution_inr === null || b.contribution_inr === null) return a.contribution_inr === null ? (b.contribution_inr === null ? 0 : 1) : -1;
      if (a.contribution_inr !== b.contribution_inr) return a.contribution_inr - b.contribution_inr;
      const fa = fullReturnPartialRecovery(a) ? 0 : 1;
      const fb = fullReturnPartialRecovery(b) ? 0 : 1;
      return fa - fb || a.order_id.localeCompare(b.order_id);
    });
}

function LosingOrders({ orders, onOpen }: { orders: OrderResult[]; onOpen: (o: OrderResult) => void }) {
  const { t } = useTranslation();
  const columns: Column<OrderResult>[] = [
    {
      id: 'order',
      header: t('ledger.order'),
      rowHeader: true,
      cell: (o) => (
        <span className="cell-stack">
          <LinkButton onClick={() => onOpen(o)} aria-label={t('leaks.openOrder', 'Open {{id}}', { id: o.order_id })} className="order-link">
            {o.order_id}
          </LinkButton>
          <span className="cell-sub">{o.date}</span>
        </span>
      ),
    },
    {
      id: 'cause',
      header: t('leaks.cause', 'Cause'),
      cell: (o) => (
        <span className="pill-row">
          {fullReturnPartialRecovery(o) ? <FullReturnChip order={o} /> : o.leak_cause ? <span className="leak-cause-text">{LEAK_LABELS[o.leak_cause]}</span> : null}
        </span>
      ),
    },
    { id: 'net', header: t('ledger.netSales'), align: 'right', cell: (o) => <Money value={o.net_sales_inr} tone="plain" /> },
    { id: 'contribution', header: t('ledger.contribution'), align: 'right', className: 'col-strong', cell: (o) => <Money value={o.contribution_inr} tone="contribution" /> },
  ];
  return (
    <section className="card table-card" aria-labelledby="losing-title">
      <div className="table-card-head">
        <div>
          <h2 id="losing-title" className="card-title">
            {t('leaks.losingTitle', 'Orders losing money')}
          </h2>
          <p className="card-sub">{t('leaks.losingSub', 'Most negative first, in red; full returns with partial recovery lead. Unknown amounts come last.')}</p>
        </div>
      </div>
      <Table
        caption={t('leaks.losingCaption', 'Orders with negative operational contribution, most negative first')}
        columns={columns}
        rows={orders}
        rowKey={(o) => o.order_id}
        onRowClick={onOpen}
        rowClassName={(o) => (o.contribution_inr !== null && o.contribution_inr < 0 ? 'row-loss' : undefined)}
        className="losing-table"
      />
    </section>
  );
}

function LeakCard({
  g,
  why,
  source,
  onOpen,
  contributionOf,
}: {
  g: LeakGroup;
  why: string;
  source: 'template' | 'ai';
  onOpen: (id: string) => void;
  contributionOf: (id: string) => number | null;
}) {
  const { t } = useTranslation();
  const unknown = g.lost_inr === null;
  const more = g.order_ids.length - Math.min(g.order_ids.length, 6);
  // Negative orders first, most negative on top.
  const ids = [...g.order_ids].sort((a, b) => (contributionOf(a) ?? Infinity) - (contributionOf(b) ?? Infinity));
  return (
    <article className={`card leak-card${unknown ? ' is-unknown' : ''}`} aria-labelledby={`leak-${g.cause}`}>
      <div className="leak-top">
        <span className={`icon-chip ${unknown ? 'icon-chip-warning' : 'icon-chip-danger'}`} aria-hidden="true">
          <Icon name={unknown ? 'alert-triangle' : 'trending-down'} size={20} />
        </span>
        <Pill tone="neutral">{t('leaks.orderCount', { count: g.count })}</Pill>
      </div>
      <h2 id={`leak-${g.cause}`} className="leak-title">
        {g.label || LEAK_LABELS[g.cause]}
      </h2>
      <p className="leak-amount">
        {unknown ? (
          <>
            <span className="leak-amount-unknown">{t('status.unknown')}</span>
            <span className="leak-amount-sub">amount not computable</span>
          </>
        ) : (
          <>
            <span className="t-loss">{formatInr(g.lost_inr as number)}</span>
            <span className="leak-amount-sub">{lower(t('leaks.lost'))}</span>
          </>
        )}
      </p>
      <div className="order-chips" aria-label="Orders in this group">
        {ids.slice(0, 6).map((id) => {
          const c = contributionOf(id);
          return (
            <button
              key={id}
              type="button"
              className={`order-chip${c !== null && c < 0 ? ' is-loss' : ''}`}
              onClick={() => onOpen(id)}
              aria-label={`Open the waterfall for ${id}`}
              title={c === null ? undefined : formatInr(c)}
            >
              {id}
            </button>
          );
        })}
        {more > 0 ? <span className="muted small">+{more} more</span> : null}
      </div>
      <p className="leak-why">
        {why} <SourceTag source={source} />
      </p>
      <ButtonLink variant="ghost" href={hrefFor('scenario')} iconRight="arrow-right" className="leak-link">
        {t('actions.simulateFix')}
      </ButtonLink>
    </article>
  );
}

export function LeaksScreen() {
  const { analysis, narration, openOrder, openOrderResult } = useStore();
  const { t } = useTranslation();
  const gridRef = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map((analysis?.orders ?? []).map((o) => [o.order_id, o])), [analysis]);
  const losing = useMemo(() => sortLosingOrders(analysis?.orders ?? []), [analysis]);
  const contributionOf = (id: string) => byId.get(id)?.contribution_inr ?? null;

  if (!analysis) {
    return (
      <div className="page">
        <PageHeader title={t('leaks.pageTitle')} subtitle="Losing orders grouped by their primary cause, largest loss first." />
        <NeedsAnalysis sentence="No analysis yet. Load the sample orders to see which orders lose money and why." icon="alert-triangle" />
      </div>
    );
  }

  const leaks = sortLeakGroups(analysis.leaks);
  const knownLoss = leaks.reduce((s, g) => s + (g.lost_inr ?? 0), 0);
  const orderCount = leaks.reduce((s, g) => s + g.count, 0);
  const anyUnknown = leaks.some((g) => g.lost_inr === null);

  const rows: BarRow[] = leaks.map((g) => ({
    key: g.cause,
    label: g.label || LEAK_LABELS[g.cause],
    sub: t('leaks.orderCount', { count: g.count }),
    values: [{ series: 'Lost', value: g.lost_inr, tone: 'loss', text: g.lost_inr === null ? 'unknown' : formatInr(g.lost_inr) }],
  }));

  return (
    <div className="page">
      <PageHeader title={t('leaks.pageTitle')} subtitle="Losing orders grouped by their primary cause, largest loss first." />

      {leaks.length === 0 ? (
        <EmptyPanel icon="check-circle" title="No negative-contribution orders in this period." />
      ) : (
        <>
          <section className="card summary-card" aria-label="Loss summary">
            <button
              type="button"
              className="summary-figure summary-figure-btn card-action"
              onClick={() => revealElement(gridRef.current)}
              aria-label={"Contribution lost " + formatInr(knownLoss) + " across " + orderCount + " orders — show the causes"}
            >
              <span className="summary-label">{t('leaks.contributionLost')}</span>
              <span className="summary-value t-loss">{formatInr(knownLoss)}</span>
              <span className="summary-sub">
                across {orderCount} {plural(orderCount, 'order', 'orders')} in {leaks.length} {plural(leaks.length, 'cause', 'causes')}
              </span>
              {anyUnknown ? (
                <Pill tone="warning" dot>
                  Plus orders whose loss is unknown
                </Pill>
              ) : null}
              <span className="kpi-go" aria-hidden="true">
                <Icon name="arrow-right" size={16} />
              </span>
            </button>
            <div className="summary-chart">
              <h2 className="card-title">₹ lost by cause</h2>
              <BarRows rows={rows} ariaLabel="Rupees lost by cause" labelWidth={210} />
            </div>
          </section>

          <div className="leak-grid reveal-target" ref={gridRef} tabIndex={-1} aria-label="Causes">
            {leaks.map((g) => {
              const ai = narration?.leaks[g.cause];
              const useAi = ai !== undefined && ai.why_source === 'ai';
              return <LeakCard key={g.cause} g={g} why={useAi ? ai.why : g.why} source={useAi ? 'ai' : g.why_source} onOpen={openOrder} contributionOf={contributionOf} />;
            })}
          </div>

          {losing.length > 0 ? <LosingOrders orders={losing} onOpen={openOrderResult} /> : null}
        </>
      )}

      <NextStep route="scenario" label={t('scenario.pageTitle')}>
        Change one assumption — recovery, return rate, shipping — and see which fix pays most.
      </NextStep>
    </div>
  );
}
