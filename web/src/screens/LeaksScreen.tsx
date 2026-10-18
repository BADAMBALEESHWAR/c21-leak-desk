import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LeakCause, LeakGroup, OrderResult } from '../api/types';
import { BarRows, type BarRow } from '../charts/BarRows';
import { AiBadge } from '../components/AiBadge';
import { AskAiButton } from '../components/AskAiButton';
import { Pill } from '../components/Badge';
import { Button, LinkButton } from '../components/Button';
import { NeedsAnalysis } from '../components/EmptyState';
import { FixAdvisor } from '../components/FixAdvisor';
import { Icon } from '../components/Icon';
import { Money } from '../components/Money';
import { FullReturnChip } from '../components/OrderDrawer';
import { NextStep, PageHeader } from '../components/Page';
import { Table, type Column } from '../components/Table';
import { EmptyPanel, revealElement } from '../components/ui';
import { lower } from '../i18n';
import { leakQuestion } from '../lib/ask';
import { apiText } from '../lib/apiText';
import { formatInr } from '../lib/format';
import { fullReturnPartialRecovery, LEAK_LABELS } from '../lib/labels';
import { hrefFor, ledgerHref, useHashLocation } from '../lib/router';
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
  onFix,
  contributionOf,
}: {
  g: LeakGroup;
  why: string;
  source: 'template' | 'ai';
  onOpen: (id: string) => void;
  onFix: (cause: LeakCause) => void;
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
        <span className="leak-top-end">
          <Pill tone="neutral">{t('leaks.orderCount', { count: g.count })}</Pill>
          <AskAiButton question={leakQuestion(t, g.cause, apiText(g.label) || LEAK_LABELS[g.cause])} about={apiText(g.label) || LEAK_LABELS[g.cause]} />
        </span>
      </div>
      <h2 id={`leak-${g.cause}`} className="leak-title">
        {apiText(g.label) || LEAK_LABELS[g.cause]}
      </h2>
      <p className="leak-amount">
        {unknown ? (
          <>
            <span className="leak-amount-unknown">{t('status.unknown')}</span>
            <span className="leak-amount-sub">{t('leaks.notComputable', 'amount not computable')}</span>
          </>
        ) : (
          <>
            <span className="t-loss">{formatInr(g.lost_inr as number)}</span>
            <span className="leak-amount-sub">{lower(t('leaks.lost'))}</span>
          </>
        )}
      </p>
      <div className="order-chips" aria-label={t('leaks.groupOrders', 'Orders in this group')}>
        {ids.slice(0, 6).map((id) => {
          const c = contributionOf(id);
          return (
            <button
              key={id}
              type="button"
              className={`order-chip${c !== null && c < 0 ? ' is-loss' : ''}`}
              onClick={() => onOpen(id)}
              aria-label={t('leaks.openWaterfall', 'Open the waterfall for {{id}}', { id })}
              title={c === null ? undefined : formatInr(c)}
            >
              {id}
            </button>
          );
        })}
        {more > 0 ? <span className="muted small">{t('leaks.more', '+{{n}} more', { n: more })}</span> : null}
      </div>
      <p className="leak-why">{why}</p>
      <AiBadge source={source} compact />
      <div className="leak-actions">
        <Button variant="secondary" size="sm" icon="sparkles" className="leak-fix" onClick={() => onFix(g.cause)} aria-haspopup="dialog">
          {t('leaks.fixThis', 'Fix this')}
        </Button>
        <a className="leak-link leak-orders-link" href={ledgerHref({ cause: g.cause, from: 'leaks' })}>
          {t('leaks.seeOrders', 'See the orders')} <Icon name="arrow-right" size={14} />
        </a>
      </div>
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

  // The Fix Advisor: "Fix this" on a card, or a link to #/leaks?fix=<cause> from the overview or a chart.
  const loc = useHashLocation();
  const fixParam = loc.route === 'leaks' ? loc.params.get('fix') : null;
  const [fixCause, setFixCause] = useState<string | null>(null);
  const [fixOpen, setFixOpen] = useState(false);
  useEffect(() => {
    if (!fixParam || !analysis) return;
    setFixCause(fixParam);
    setFixOpen(true);
  }, [fixParam, analysis]);
  const openFix = useCallback((cause: string) => {
    setFixCause(cause);
    setFixOpen(true);
  }, []);
  const closeFix = useCallback(() => {
    setFixOpen(false);
    // Drop ?fix= so a reload does not open the panel again; the next link to it fires hashchange as usual.
    if (/[?&]fix=/.test(window.location.hash)) {
      try {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${hrefFor('leaks')}`);
      } catch {
        // Some embedded browsers block replaceState.
      }
    }
  }, []);

  if (!analysis) {
    return (
      <div className="page">
        <PageHeader title={t('leaks.pageTitle')} subtitle={t('leaks.subtitle', 'Losing orders grouped by their primary cause, largest loss first.')} />
        <NeedsAnalysis sentence={t('leaks.empty', 'No analysis yet. Load the sample orders to see which orders lose money and why.')} icon="alert-triangle" />
      </div>
    );
  }

  const leaks = sortLeakGroups(analysis.leaks);
  const knownLoss = leaks.reduce((s, g) => s + (g.lost_inr ?? 0), 0);
  const orderCount = leaks.reduce((s, g) => s + g.count, 0);
  const anyUnknown = leaks.some((g) => g.lost_inr === null);

  const rows: BarRow[] = leaks.map((g) => ({
    key: g.cause,
    label: apiText(g.label) || LEAK_LABELS[g.cause],
    sub: t('leaks.orderCount', { count: g.count }),
    values: [{ series: t('leaks.lost'), value: g.lost_inr, tone: 'loss', text: g.lost_inr === null ? lower(t('status.unknown')) : formatInr(g.lost_inr) }],
  }));

  return (
    <div className="page">
      <PageHeader title={t('leaks.pageTitle')} subtitle={t('leaks.subtitle', 'Losing orders grouped by their primary cause, largest loss first.')} />

      {leaks.length === 0 ? (
        <EmptyPanel icon="check-circle" title={t('leaks.none', 'No negative-contribution orders in this period.')} />
      ) : (
        <>
          <section className="card summary-card" aria-label={t('leaks.summaryLabel', 'Loss summary')}>
            <button
              type="button"
              className="summary-figure summary-figure-btn card-action"
              onClick={() => revealElement(gridRef.current)}
              aria-label={t('leaks.summaryAria', 'Contribution lost {{inr}} across {{count}} orders — show the causes', { inr: formatInr(knownLoss), count: orderCount })}
            >
              <span className="summary-label">{t('leaks.contributionLost')}</span>
              <span className="summary-value t-loss">{formatInr(knownLoss)}</span>
              <span className="summary-sub">
                {t('leaks.summarySub', 'across {{orders}} in {{causes}}', { orders: t('leaks.orderCount', { count: orderCount }), causes: t('leaks.inCauses', { count: leaks.length }) })}
              </span>
              {anyUnknown ? (
                <Pill tone="warning" dot>
                  {t('leaks.plusUnknown', 'Plus orders whose loss is unknown')}
                </Pill>
              ) : null}
              <span className="kpi-go" aria-hidden="true">
                <Icon name="arrow-right" size={16} />
              </span>
            </button>
            <div className="summary-chart">
              <h2 className="card-title">{t('leaks.byCause', '₹ lost by cause')}</h2>
              <BarRows rows={rows} ariaLabel={t('leaks.byCauseAria', 'Rupees lost by cause')} labelWidth={210} />
            </div>
          </section>

          <div className="leak-grid reveal-target" ref={gridRef} tabIndex={-1} aria-label={t('leaks.causes', 'Causes')}>
            {leaks.map((g) => {
              const ai = narration?.leaks[g.cause];
              const useAi = ai !== undefined && ai.why_source === 'ai';
              return (
                <LeakCard key={g.cause} g={g} why={useAi ? ai.why : g.why} source={useAi ? 'ai' : g.why_source} onOpen={openOrder} onFix={openFix} contributionOf={contributionOf} />
              );
            })}
          </div>

          {losing.length > 0 ? <LosingOrders orders={losing} onOpen={openOrderResult} /> : null}
        </>
      )}

      <NextStep route="scenario" label={t('scenario.pageTitle')}>
        {t('leaks.next', 'Change one assumption — recovery, return rate, shipping — and see which fix pays most.')}
      </NextStep>

      <FixAdvisor cause={fixCause} open={fixOpen && fixCause !== null} onClose={closeFix} />
    </div>
  );
}
