import { useTranslation } from 'react-i18next';
import type { AnalysisResponse, OrderResult, WorkedOrderResult } from '../api/types';
import { BridgeChart } from '../charts/BridgeChart';
import { WaterfallChart, WaterfallNotes } from '../charts/WaterfallChart';
import { BRAND } from '../brand';
import { formatInr, formatPct, plural } from '../lib/format';
import { handlingEstimateUsed, LEAK_LABELS } from '../lib/labels';
import { useStore, type BridgeFocus } from '../state/store';
import { Pill } from './Badge';
import { Button } from './Button';
import { Icon } from './Icon';
import { ReconciliationLine } from './Reconciliation';
import { Drawer } from './Drawer';
import { AboutDetail, ChecksDetail } from './InfoDrawers';
import { Money } from './Money';
import { Callout, Skeleton } from './ui';

export function OrderPills({ order }: { order: OrderResult }) {
  const { t } = useTranslation();
  return (
    <>
      {order.status === 'unknown' ? (
        <Pill tone="unknown" dot>
          {t('status.unknown')}
        </Pill>
      ) : order.returned ? (
        <Pill tone="neutral" dot>
          {t('status.returned')}
        </Pill>
      ) : (
        <Pill tone="success" dot>
          {t('status.kept')}
        </Pill>
      )}
      {order.late_refund ? (
        <Pill tone="warning" dot>
          {t('status.lateRefund')}
        </Pill>
      ) : null}
      {order.synthetic ? (
        <Pill tone="teal" dot>
          {t('status.syntheticTag')}
        </Pill>
      ) : null}
    </>
  );
}

function OrderDetail({ order, periodEnd }: { order: OrderResult; periodEnd: string | null }) {
  const flags = order.flags.filter((f) => f !== 'late_refund' || !order.late_refund);
  return (
    <div className="drawer-stack">
      <dl className="kv kv-2">
        <div>
          <dt>Channel</dt>
          <dd>{order.channel}</dd>
        </div>
        <div>
          <dt>Product</dt>
          <dd>{order.product_id}</dd>
        </div>
        <div>
          <dt>Returned</dt>
          <dd>{order.returned ? 'Yes' : 'No'}</dd>
        </div>
        {order.refund_date ? (
          <div>
            <dt>Refund date</dt>
            <dd>{order.refund_date}</dd>
          </div>
        ) : null}
        {flags.length > 0 ? (
          <div>
            <dt>Flags</dt>
            <dd>{flags.map((f) => f.replace(/_/g, ' ')).join(', ')}</dd>
          </div>
        ) : null}
      </dl>

      {order.leak_cause ? (
        <div className="drawer-row">
          <span className="drawer-row-label">Leak cause</span>
          <Pill tone={order.leak_cause === 'refund_unknown' ? 'warning' : 'danger'} icon="alert-triangle">
            {LEAK_LABELS[order.leak_cause]}
          </Pill>
        </div>
      ) : null}

      {order.late_refund ? (
        <div className="compare-card">
          <div>
            <span className="compare-label">In period</span>
            <span className="compare-value">
              <Money value={order.contribution_inr} tone="contribution" />
            </span>
          </div>
          <div>
            <span className="compare-label">If recognised</span>
            <span className="compare-value">
              <Money value={order.recognised_contribution_inr} tone="contribution" />
            </span>
          </div>
          <p className="compare-note">
            Refund dated {order.refund_date} falls after the period end{periodEnd ? ` (${periodEnd})` : ''}, so it is pending.
          </p>
        </div>
      ) : null}

      <section className="drawer-section" aria-label="Waterfall">
        <h3 className="section-label">Waterfall</h3>
        <WaterfallChart lines={order.lines} contribution={order.contribution_inr} label={order.late_refund ? 'In period' : 'Contribution'} />
      </section>

      {order.unknown_fields.length > 0 ? (
        <Callout tone="warning" title={`Unknown ${order.unknown_fields.length === 1 ? 'field' : 'fields'}: ${order.unknown_fields.join(', ')}`}>
          <p>Contribution is not computed until {order.unknown_fields.length === 1 ? 'it is' : 'they are'} supplied — unknown, never zero.</p>
        </Callout>
      ) : null}

      <section className="drawer-section" aria-label="Line notes">
        <h3 className="section-label">Line notes</h3>
        <WaterfallNotes lines={order.lines} />
      </section>

      {order.labels.length > 0 ? (
        <div className="drawer-tags">
          {order.labels.map((l) => (
            <span key={l} className="pill pill-outline pill-xs">
              {l}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WorkedDetail({ data }: { data: WorkedOrderResult }) {
  return (
    <div className="drawer-stack">
      <p className="muted">The reference worked order, six lines, computed by the same engine.</p>
      <section className="drawer-section" aria-label="Waterfall">
        <h3 className="section-label">Waterfall</h3>
        <WaterfallChart lines={data.lines} contribution={data.contribution_inr} />
      </section>
      <section className="drawer-section" aria-label="Line notes">
        <h3 className="section-label">Line notes</h3>
        <WaterfallNotes lines={data.lines} />
      </section>
      <Callout tone="info">
        <p>{data.note}</p>
      </Callout>
    </div>
  );
}

const FOCUS_LABEL: Record<BridgeFocus, string> = { gross: 'Gross sales', net_sales: 'Net sales', contribution: 'Contribution' };

function BridgeDetail({ a, focus }: { a: AnalysisResponse; focus: BridgeFocus }) {
  const lines = a.bridge ?? [];
  if (lines.length === 0) {
    return <Callout tone="info" title="This analysis has no period waterfall.">Run the analysis again to get it.</Callout>;
  }
  const focusLine = lines.find((l) => l.key === focus);
  const bridgeGross = lines.find((l) => l.key === 'gross')?.amount_inr ?? null;
  // The one subtraction the page does: gross that sits in unknown orders, outside the bridge.
  const excludedGross = bridgeGross === null ? 0 : a.totals.gross_inr - bridgeGross;
  const unknown = a.totals.unknown_count;
  const handlingEstimated = handlingEstimateUsed(a);
  return (
    <div className="drawer-stack">
      {focusLine ? (
        <div className="drawer-hero">
          <span className="drawer-hero-label">{FOCUS_LABEL[focus]}</span>
          <span className="drawer-hero-value">
            <Money value={focusLine.amount_inr} tone={focus === 'contribution' ? 'contribution' : 'plain'} />
          </span>
          <span className="drawer-hero-sub">
            {a.totals.orders - unknown} computed {plural(a.totals.orders - unknown, 'order', 'orders')} · period end {a.period_end}
          </span>
        </div>
      ) : null}
      {excludedGross !== 0 ? (
        <Callout tone="warning" title={`Excludes ${unknown} unknown ${plural(unknown, 'order', 'orders')} — ${formatInr(excludedGross)} gross`}>
          <p>The waterfall covers orders whose contribution can be computed, so its gross differs from the {formatInr(a.totals.gross_inr)} headline.</p>
        </Callout>
      ) : null}
      <section className="drawer-section" aria-label="Period waterfall">
        <h3 className="section-label">From gross sales to contribution</h3>
        <BridgeChart lines={lines} focus={focus} estimated={handlingEstimated ? ['handling'] : []} />
      </section>
      {handlingEstimated ? (
        <p className="field-hint">
          Handling includes {formatInr(a.config.handling_default_inr)} per order, estimated for rows without handling_inr.
        </p>
      ) : null}
      {a.attribution === 'channel' ? (
        <p className="field-hint">Channel mode: ads move off the orders and channel spend is deducted once, at the channel line.</p>
      ) : null}
      <ReconciliationLine rec={a.reconciliation} />
    </div>
  );
}

function MarginDetail({ a }: { a: AnalysisResponse }) {
  const { openOrderResult, closeDrawer, focusLedgerTable } = useStore();
  const t = a.totals;
  const open = a.headline_gate.open && t.headline_ready !== false && t.contribution_pct !== null;
  if (open) {
    return (
      <div className="drawer-stack">
        <div className="drawer-hero">
          <span className="drawer-hero-label">Contribution margin</span>
          <span className="drawer-hero-value num">{formatPct(t.contribution_pct as number)}</span>
          <span className="drawer-hero-sub">Contribution ÷ net sales</span>
        </div>
        <div className="formula-card">
          <div>
            <span className="compare-label">Contribution</span>
            <span className="compare-value">
              <Money value={t.contribution_inr} tone="contribution" />
            </span>
          </div>
          <span className="formula-op" aria-hidden="true">÷</span>
          <div>
            <span className="compare-label">Net sales</span>
            <span className="compare-value">
              <Money value={t.net_sales_inr} tone="plain" />
            </span>
          </div>
        </div>
        <Callout tone="success" title="Refund and recovery facts are complete.">
          <p>{a.headline_gate.reason}</p>
        </Callout>
      </div>
    );
  }
  const unknownOrders = a.orders.filter((o) => o.status === 'unknown');
  return (
    <div className="drawer-stack">
      <div className="drawer-hero">
        <span className="drawer-hero-label">Contribution margin</span>
        <span className="drawer-hero-value kpi-locked">
          <Icon name="lock" size={22} /> Hidden
        </span>
        <span className="drawer-hero-sub">No margin headline until refund facts are complete.</span>
      </div>
      <Callout tone="warning" title="Why it is hidden">
        <p>{a.headline_gate.reason}</p>
      </Callout>
      <section className="drawer-section" aria-label="Unknown orders">
        <h3 className="section-label">
          Unknown {plural(unknownOrders.length, 'order', 'orders')} ({unknownOrders.length})
        </h3>
        <ul className="unknown-list">
          {unknownOrders.slice(0, 20).map((o) => (
            <li key={o.order_id}>
              <button type="button" className="unknown-item" onClick={() => openOrderResult(o)} aria-label={`Open ${o.order_id}: missing ${o.unknown_fields.join(', ')}`}>
                <span className="unknown-id">{o.order_id}</span>
                <span className="unknown-fields">Missing {o.unknown_fields.join(', ')}</span>
                <Icon name="arrow-right" size={16} />
              </button>
            </li>
          ))}
        </ul>
        {unknownOrders.length > 20 ? <p className="field-hint">and {unknownOrders.length - 20} more in the ledger.</p> : null}
      </section>
      <Button
        variant="primary"
        iconRight="arrow-right"
        onClick={() => {
          closeDrawer();
          focusLedgerTable('unknown');
        }}
      >
        Show unknown orders
      </Button>
    </div>
  );
}

export function OrderDrawer() {
  const { drawer, drawerOpen, closeDrawer, analysis } = useStore();

  let title = '';
  let meta = null;
  let body = null;
  if (drawer?.kind === 'order') {
    const o = drawer.order;
    title = o.order_id;
    meta = (
      <>
        <span className="drawer-date">{o.date}</span>
        <OrderPills order={o} />
      </>
    );
    body = <OrderDetail order={o} periodEnd={analysis?.period_end ?? null} />;
  } else if (drawer?.kind === 'worked') {
    title = 'Worked example order';
    meta = drawer.data ? (
      <>
        <span className="drawer-date">Contribution {formatInr(drawer.data.contribution_inr)}</span>
        {drawer.data.expected_contribution_inr !== null ? (
          drawer.data.matches ? (
            <Pill tone="success" icon="check">
              matches the reference {formatInr(drawer.data.expected_contribution_inr)}
            </Pill>
          ) : (
            <Pill tone="danger">does not match</Pill>
          )
        ) : null}
      </>
    ) : null;
    body = drawer.data ? (
      <WorkedDetail data={drawer.data} />
    ) : drawer.error ? (
      <Callout tone="danger" title={drawer.error} role="alert" />
    ) : (
      <div className="drawer-stack" role="status" aria-label="Loading the worked order">
        <Skeleton width="60%" />
        <Skeleton width="100%" height={180} />
      </div>
    );
  } else if (drawer?.kind === 'bridge' && analysis) {
    title = 'Period waterfall';
    meta = (
      <>
        <Pill tone="neutral">{analysis.attribution === 'channel' ? 'Channel spend' : 'Allocate ads'}</Pill>
        {analysis.totals.partial ? (
          <Pill tone="warning" dot>
            Partial · {analysis.totals.unknown_count} unknown
          </Pill>
        ) : null}
      </>
    );
    body = <BridgeDetail a={analysis} focus={drawer.focus} />;
  } else if (drawer?.kind === 'margin' && analysis) {
    title = 'Contribution margin';
    meta = analysis.headline_gate.open ? (
      <Pill tone="success" icon="check">
        Headline open
      </Pill>
    ) : (
      <Pill tone="warning" icon="lock">
        Headline gate closed
      </Pill>
    );
    body = <MarginDetail a={analysis} />;
  } else if (drawer?.kind === 'checks') {
    title = 'Public checks';
    meta = <span className="drawer-date">Engine checks · 25 points</span>;
    body = <ChecksDetail />;
  } else if (drawer?.kind === 'about') {
    title = `About ${BRAND.name}`;
    meta = <span className="drawer-date">{BRAND.tagline}</span>;
    body = <AboutDetail />;
  } else if (drawer?.kind === 'missing') {
    title = drawer.orderId;
    body = <Callout tone="info" title={`Order ${drawer.orderId} is not in the current analysis.`}>Load a dataset that contains it, then open it from the ledger.</Callout>;
  }

  return (
    <Drawer open={drawerOpen && drawer !== null} onClose={closeDrawer} title={title} meta={meta}>
      {body}
    </Drawer>
  );
}
