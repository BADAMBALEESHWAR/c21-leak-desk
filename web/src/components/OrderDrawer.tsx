import { useTranslation } from 'react-i18next';
import type { AnalysisResponse, LineKey, OrderResult, WaterfallLine, WorkedOrderResult } from '../api/types';
import { BridgeChart } from '../charts/BridgeChart';
import { WaterfallChart, WaterfallNotes } from '../charts/WaterfallChart';
import { BRAND } from '../brand';
import { lower } from '../i18n';
import { apiText } from '../lib/apiText';
import { formatCount, formatDate, formatDecimal, formatInr, formatPct } from '../lib/format';
import { ALLOCATED_EN, ALLOCATED_KEY, ATTRIBUTION_LABEL, fullReturnPartialRecovery, handlingEstimateUsed, LEAK_LABELS } from '../lib/labels';
import { ledgerHref } from '../lib/router';
import { useStore, type BridgeFocus } from '../state/store';
import { Pill } from './Badge';
import { Button } from './Button';
import { Icon } from './Icon';
import { ReconciliationLine } from './Reconciliation';
import { Drawer } from './Drawer';
import { AboutDetail, ChecksDetail } from './InfoDrawers';
import { Money } from './Money';
import { Provenance } from './Provenance';
import { Callout, Skeleton } from './ui';
import '../charts/chart.css';

const plainNumber = (n: number) => (Number.isInteger(n) ? formatCount(n) : formatDecimal(n));

/** "Full return · recovery 350 of 400" for a fully refunded return where only part of the stock cost came back. */
export function FullReturnChip({ order }: { order: OrderResult }) {
  const { t } = useTranslation();
  const fr = fullReturnPartialRecovery(order);
  if (!fr) return null;
  return (
    <Pill
      tone="danger"
      icon="alert-triangle"
      className="pill-full-return"
      title={t('status.fullReturnTip', 'Refunded in full; {{recovered}} of the {{cost}} product cost came back to stock.', {
        recovered: formatInr(fr.recovered),
        cost: formatInr(fr.cost),
      })}
    >
      {t('status.fullReturn', 'Full return · recovery {{recovered}} of {{cost}}', { recovered: plainNumber(fr.recovered), cost: plainNumber(fr.cost) })}
    </Pill>
  );
}

export function OrderPills({ order, corrected = false }: { order: OrderResult; corrected?: boolean }) {
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
      <FullReturnChip order={order} />
      {corrected ? <Provenance kind="corrected" title={t('status.correctedTip', 'A value on this order was corrected on the import report; the original is kept.')} /> : null}
    </>
  );
}

/** Product cost − recovered = net product cost, for a returned order whose recovery is known. */
function RecoveryLine({ order }: { order: OrderResult }) {
  const { t } = useTranslation();
  const { product_cost: cost, recovered } = order.inputs;
  if (!order.returned || cost === null || recovered === null) return null;
  const partial = recovered < cost;
  return (
    <section className={`recovery-card${partial && !order.late_refund ? ' is-partial' : ''}`} aria-label={t('drawer.recovery', 'Recovery')}>
      <h3 className="section-label">{t('drawer.recovery', 'Recovery')}</h3>
      <div className="formula-card formula-card-3">
        <div>
          <span className="compare-label">{t('drawer.productCost', 'Product cost')}</span>
          <span className="compare-value">
            <Money value={cost} tone="plain" />
          </span>
        </div>
        <span className="formula-op" aria-hidden="true">
          −
        </span>
        <div>
          <span className="compare-label">{t('drawer.recovered', 'Recovered to stock')}</span>
          <span className="compare-value">
            <Money value={recovered} tone="plain" />
          </span>
        </div>
        <span className="formula-op" aria-hidden="true">
          =
        </span>
        <div>
          <span className="compare-label">{t('drawer.netProductCost', 'Net product cost')}</span>
          <span className="compare-value">
            <Money value={cost - recovered} tone="plain" />
          </span>
        </div>
      </div>
      <p className="compare-note">
        {order.late_refund
          ? t('drawer.recoveryPending', 'Not yet recognised in this period: the refund is dated after the period end.')
          : partial
            ? t('drawer.recoveryPartial', 'Recovery {{recovered}} of {{cost}}: {{lost}} of stock cost did not come back.', {
                recovered: formatInr(recovered),
                cost: formatInr(cost),
                lost: formatInr(cost - recovered),
              })
            : t('drawer.recoveryFull', 'All of the product cost came back to stock.')}
      </p>
    </section>
  );
}

/**
 * The deduction lines that explain a loss, largest first. Refund and discount only reduce revenue, so they are left
 * out, except the discount when it is the cause.
 */
export function largestDeductions(lines: WaterfallLine[], n = 2, withDiscount = false): WaterfallLine[] {
  return lines
    .filter((l) => l.kind === 'deduction' && l.key !== 'refund' && (withDiscount || l.key !== 'discount') && l.amount_inr !== null && l.amount_inr !== 0 && l.source !== 'moved_to_channel' && l.source !== 'not_recognised')
    .sort((a, b) => Math.abs(b.amount_inr as number) - Math.abs(a.amount_inr as number))
    .slice(0, n);
}

/** "Why this order leaks": the cause in words and the two largest deductions, with a link to every order of that cause. */
function WhyLeaks({ order }: { order: OrderResult }) {
  const { t } = useTranslation();
  const { closeDrawer } = useStore();
  const negative = order.contribution_inr !== null && order.contribution_inr < 0;
  if (!order.leak_cause && !negative) return null;
  const lineName: Partial<Record<LineKey, string>> = {
    discount: t('drawer.lineDiscount', 'Discount'),
    net_product_cost: t('drawer.netProductCost', 'Net product cost'),
    shipping: t('ledger.shipping'),
    payment_fee: t('ledger.fee'),
    return_cost: t('ledger.returnCost'),
    handling: t('ledger.handling'),
    ads: t('ledger.ads'),
  };
  const cause = order.leak_cause ? t(`focus.cause.${order.leak_cause}`, LEAK_LABELS[order.leak_cause]) : t('drawer.whyNegative', 'Costs are larger than what the order kept');
  const top = largestDeductions(order.lines, 2, order.leak_cause === 'discount_exceeds_margin');
  const name = (l: WaterfallLine) => lineName[l.key] ?? l.label;
  const amount = (l: WaterfallLine) => formatInr(Math.abs(l.amount_inr as number));
  const sentence =
    top.length >= 2
      ? t('drawer.whyTwo', '{{cause}}. The largest deductions are {{a}} ({{aInr}}) and {{b}} ({{bInr}}).', { cause, a: name(top[0]), aInr: amount(top[0]), b: name(top[1]), bInr: amount(top[1]) })
      : top.length === 1
        ? t('drawer.whyOne', '{{cause}}. The largest deduction is {{a}} ({{aInr}}).', { cause, a: name(top[0]), aInr: amount(top[0]) })
        : `${cause}.`;
  return (
    <section className="why-leak" aria-label={t('drawer.whyTitle', 'Why this order leaks')}>
      <h3 className="why-leak-title">{t('drawer.whyTitle', 'Why this order leaks')}</h3>
      <p>{sentence}</p>
      {order.leak_cause ? (
        <p>
          <a href={ledgerHref({ cause: order.leak_cause })} onClick={() => closeDrawer()}>
            {t('drawer.whyAll', 'See every order with this cause')} →
          </a>
        </p>
      ) : null}
    </section>
  );
}

type TFn = ReturnType<typeof useTranslation>['t'];

/** The engine's headline-gate reason (one of two sentences), in the UI language; anything else is shown as sent. */
function gateReasonText(t: TFn, reason: string): string {
  if (reason === 'Refund and recovery facts are complete for every order in the period.') {
    return t('drawer.gate.open', 'Refund and recovery facts are complete for every order in the period.');
  }
  const m = /^Contribution % is hidden until refund and recovery facts are complete \((\d+) orders? unknown\)\.$/.exec(reason);
  if (m) return t('drawer.gate.closed', 'Contribution % is hidden until refund and recovery facts are complete ({{n}} orders unknown).', { count: Number(m[1]), n: m[1] });
  return reason;
}

/** The engine's per-order labels (a fixed set), in the UI language; anything else is shown as sent. */
function orderLabelText(t: TFn, label: string): string {
  if (label === 'handling estimated') return t('drawer.tag.handlingEstimated', 'handling estimated');
  if (label === 'synthetic row') return t('drawer.tag.syntheticRow', 'synthetic row');
  if (label === ATTRIBUTION_LABEL) return t('drawer.tag.attribution', 'Attribution is allocation, not causation.');
  return label;
}

function OrderDetail({ order, periodEnd, attribution }: { order: OrderResult; periodEnd: string | null; attribution: AnalysisResponse['attribution'] | null }) {
  const { t } = useTranslation();
  const flags = order.flags.filter((f) => f !== 'late_refund' || !order.late_refund);
  const ads = order.lines.find((l) => l.key === 'ads');
  const adsInr = ads && ads.amount_inr !== null ? Math.abs(ads.amount_inr) : null;
  const adjustment =
    order.late_refund && order.contribution_inr !== null && order.recognised_contribution_inr !== null ? order.recognised_contribution_inr - order.contribution_inr : null;
  return (
    <div className="drawer-stack">
      <dl className="kv kv-2">
        <div>
          <dt>{t('ledger.channel')}</dt>
          <dd>{order.channel === 'unassigned' ? t('ledger.unassigned', 'unassigned') : order.channel}</dd>
        </div>
        <div>
          <dt>{t('ledger.product')}</dt>
          <dd>{order.product_id === 'unassigned' ? t('ledger.unassigned', 'unassigned') : order.product_id}</dd>
        </div>
        <div>
          <dt>{t('status.returned')}</dt>
          <dd>{order.returned ? t('drawer.yes', 'Yes') : t('drawer.no', 'No')}</dd>
        </div>
        {order.refund_date ? (
          <div>
            <dt>{t('drawer.refundDate', 'Refund date')}</dt>
            <dd>{order.refund_date}</dd>
          </div>
        ) : null}
        {flags.length > 0 ? (
          <div>
            <dt>{t('drawer.flags', 'Flags')}</dt>
            <dd>{flags.map((f) => (f === 'late_refund' ? lower(t('status.lateRefund')) : f.replace(/_/g, ' '))).join(', ')}</dd>
          </div>
        ) : null}
      </dl>

      <WhyLeaks order={order} />

      {order.leak_cause ? (
        <div className="drawer-row">
          <span className="drawer-row-label">{t('drawer.leakCause', 'Leak cause')}</span>
          <Pill tone={order.leak_cause === 'refund_unknown' ? 'warning' : 'danger'} icon="alert-triangle">
            {t(`focus.cause.${order.leak_cause}`, LEAK_LABELS[order.leak_cause])}
          </Pill>
        </div>
      ) : null}

      {order.late_refund ? (
        <div className="compare-card compare-card-late">
          <div>
            <span className="compare-label">{t('late.periodView', 'Period view (as reported)')}</span>
            <span className="compare-value">
              <Money value={order.contribution_inr} tone="contribution" />
            </span>
          </div>
          <div>
            <span className="compare-label">{t('late.restatedView', 'Restated (refund recognised)')}</span>
            <span className="compare-value">
              <Money value={order.recognised_contribution_inr} tone="contribution" />
            </span>
          </div>
          {adjustment !== null ? (
            <p className="compare-adjust">
              <span>{t('late.adjustment', 'Prior-period adjustment')}</span> <Money value={adjustment} />
            </p>
          ) : null}
          <p className="compare-note">
            {t('late.drawerNote', 'Refund dated {{date}} falls after the period end{{end}}. The period figure is never overwritten; the restated view sits beside it.', {
              date: order.refund_date ? formatDate(order.refund_date) : '',
              end: periodEnd ? ` (${formatDate(periodEnd)})` : '',
            })}
          </p>
        </div>
      ) : null}

      <RecoveryLine order={order} />

      <section className="drawer-section" aria-label={t('drawer.waterfall', 'Waterfall')}>
        <h3 className="section-label">{t('drawer.waterfall', 'Waterfall')}</h3>
        <WaterfallChart lines={order.lines} contribution={order.contribution_inr} label={order.late_refund ? t('drawer.inPeriod', 'In period') : t('ledger.contribution')} />
        {attribution === 'channel' ? (
          <p className="field-hint attr-note">{t('drawer.adsChannel', 'Ads move to the channel line in this mode; channel spend is {{note}}.', { note: t(ALLOCATED_KEY, ALLOCATED_EN) })}</p>
        ) : adsInr ? (
          <p className="field-hint attr-note">
            {t('drawer.adsLine', 'Ads {{inr}}', { inr: formatInr(adsInr) })} · {t(ALLOCATED_KEY, ALLOCATED_EN)}
          </p>
        ) : null}
      </section>

      {order.unknown_fields.length > 0 ? (
        <Callout tone="warning" title={t('drawer.unknownFields', 'Unknown fields: {{fields}}', { count: order.unknown_fields.length, fields: order.unknown_fields.join(', ') })}>
          <p>{t('drawer.notComputed', 'Contribution is not computed until they are supplied — unknown, never zero.', { count: order.unknown_fields.length })}</p>
        </Callout>
      ) : null}

      <section className="drawer-section" aria-label={t('drawer.lineNotes', 'Line notes')}>
        <h3 className="section-label">{t('drawer.lineNotes', 'Line notes')}</h3>
        <WaterfallNotes lines={order.lines} />
      </section>

      {order.labels.length > 0 ? (
        <div className="drawer-tags">
          {order.labels.map((l) => (
            <span key={l} className="pill pill-outline pill-xs">
              {orderLabelText(t, l)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WorkedDetail({ data }: { data: WorkedOrderResult }) {
  const { t } = useTranslation();
  return (
    <div className="drawer-stack">
      <p className="muted">{t('drawer.workedIntro', 'The reference worked order, six lines, computed by the same engine.')}</p>
      <section className="drawer-section" aria-label={t('drawer.waterfall', 'Waterfall')}>
        <h3 className="section-label">{t('drawer.waterfall', 'Waterfall')}</h3>
        <WaterfallChart lines={data.lines} contribution={data.contribution_inr} label={t('ledger.contribution')} />
      </section>
      <section className="drawer-section" aria-label={t('drawer.lineNotes', 'Line notes')}>
        <h3 className="section-label">{t('drawer.lineNotes', 'Line notes')}</h3>
        <WaterfallNotes lines={data.lines} />
      </section>
      <Callout tone="info">
        <p>{apiText(data.note)}</p>
      </Callout>
    </div>
  );
}

function BridgeDetail({ a, focus }: { a: AnalysisResponse; focus: BridgeFocus }) {
  const { t } = useTranslation();
  const lines = a.bridge ?? [];
  if (lines.length === 0) {
    return (
      <Callout tone="info" title={t('drawer.noBridge', 'This analysis has no period waterfall.')}>
        {t('drawer.noBridgeBody', 'Run the analysis again to get it.')}
      </Callout>
    );
  }
  const focusLabel =
    focus === 'gross' ? t('ledger.gross') : focus === 'net_sales' ? t('ledger.netSales') : t('ledger.operationalContribution', 'Operational contribution');
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
          <span className="drawer-hero-label">{focusLabel}</span>
          <span className="drawer-hero-value">
            <Money value={focusLine.amount_inr} tone={focus === 'contribution' ? 'contribution' : 'plain'} />
          </span>
          <span className="drawer-hero-sub">
            {t('drawer.computedOrders', '{{count}} computed orders · period end {{end}}', { count: a.totals.orders - unknown, end: a.period_end })}
          </span>
        </div>
      ) : null}
      {excludedGross !== 0 ? (
        <Callout tone="warning" title={t('drawer.excludes', 'Excludes {{count}} unknown orders — {{inr}} gross', { count: unknown, inr: formatInr(excludedGross) })}>
          <p>
            {t('drawer.excludesBody', 'The waterfall covers orders whose contribution can be computed, so its gross differs from the {{inr}} headline.', {
              inr: formatInr(a.totals.gross_inr),
            })}
          </p>
        </Callout>
      ) : null}
      <section className="drawer-section" aria-label={t('drawer.periodWaterfall', 'Period waterfall')}>
        <h3 className="section-label">{t('drawer.grossToContribution', 'From gross sales to contribution')}</h3>
        <BridgeChart lines={lines} focus={focus} estimated={handlingEstimated ? ['handling'] : []} />
      </section>
      {handlingEstimated ? (
        <p className="field-hint">
          {t('unit.handlingTip', 'Handling includes {{inr}} per order, estimated for rows without handling_inr.', { inr: formatInr(a.config.handling_default_inr) })}
        </p>
      ) : null}
      {a.attribution === 'channel' ? (
        <p className="field-hint">
          {t('drawer.channelMode', 'Channel mode: ads move off the orders and channel spend is deducted once, at the channel line. Channel spend is allocated, not caused.')}
        </p>
      ) : null}
      <ReconciliationLine rec={a.reconciliation} />
    </div>
  );
}

function MarginDetail({ a }: { a: AnalysisResponse }) {
  const { openOrderResult, closeDrawer, focusLedgerTable } = useStore();
  const { t } = useTranslation();
  const tot = a.totals;
  const open = a.headline_gate.open && tot.headline_ready !== false && tot.contribution_pct !== null;
  if (open) {
    return (
      <div className="drawer-stack">
        <div className="drawer-hero">
          <span className="drawer-hero-label">{t('drawer.marginTitle', 'Contribution margin')}</span>
          <span className="drawer-hero-value num">{formatPct(tot.contribution_pct as number)}</span>
          <span className="drawer-hero-sub">{t('drawer.marginFormula', 'Contribution ÷ net sales')}</span>
        </div>
        <div className="formula-card">
          <div>
            <span className="compare-label">{t('ledger.contribution')}</span>
            <span className="compare-value">
              <Money value={tot.contribution_inr} tone="contribution" />
            </span>
          </div>
          <span className="formula-op" aria-hidden="true">÷</span>
          <div>
            <span className="compare-label">{t('ledger.netSales')}</span>
            <span className="compare-value">
              <Money value={tot.net_sales_inr} tone="plain" />
            </span>
          </div>
        </div>
        <Callout tone="success" title={t('drawer.factsComplete', 'Refund and recovery facts are complete.')}>
          <p>{gateReasonText(t, a.headline_gate.reason)}</p>
        </Callout>
      </div>
    );
  }
  const unknownOrders = a.orders.filter((o) => o.status === 'unknown');
  return (
    <div className="drawer-stack">
      <div className="drawer-hero">
        <span className="drawer-hero-label">{t('drawer.marginTitle', 'Contribution margin')}</span>
        <span className="drawer-hero-value kpi-locked">
          <Icon name="lock" size={22} /> {t('drawer.hidden', 'Hidden')}
        </span>
        <span className="drawer-hero-sub">{t('drawer.noHeadline', 'No margin headline until refund facts are complete.')}</span>
      </div>
      <Callout tone="warning" title={t('drawer.whyHidden', 'Why it is hidden')}>
        <p>{gateReasonText(t, a.headline_gate.reason)}</p>
      </Callout>
      <section className="drawer-section" aria-label={t('drawer.unknownOrders', 'Unknown orders')}>
        <h3 className="section-label">{t('drawer.unknownOrdersHead', 'Unknown orders ({{count}})', { count: unknownOrders.length })}</h3>
        <ul className="unknown-list">
          {unknownOrders.slice(0, 20).map((o) => (
            <li key={o.order_id}>
              <button
                type="button"
                className="unknown-item"
                onClick={() => openOrderResult(o)}
                aria-label={t('drawer.openMissing', 'Open {{id}}: missing {{fields}}', { id: o.order_id, fields: o.unknown_fields.join(', ') })}
              >
                <span className="unknown-id">{o.order_id}</span>
                <span className="unknown-fields">{t('drawer.missing', 'Missing {{fields}}', { fields: o.unknown_fields.join(', ') })}</span>
                <Icon name="arrow-right" size={16} />
              </button>
            </li>
          ))}
        </ul>
        {unknownOrders.length > 20 ? <p className="field-hint">{t('drawer.moreInLedger', 'and {{n}} more in the ledger.', { n: unknownOrders.length - 20 })}</p> : null}
      </section>
      <Button
        variant="primary"
        iconRight="arrow-right"
        onClick={() => {
          closeDrawer();
          focusLedgerTable('unknown');
        }}
      >
        {t('drawer.showUnknown', 'Show unknown orders')}
      </Button>
    </div>
  );
}

export function OrderDrawer() {
  const { drawer, drawerOpen, closeDrawer, analysis, correctedOrderIds } = useStore();
  const { t } = useTranslation();

  let title = '';
  let meta = null;
  let body = null;
  if (drawer?.kind === 'order') {
    const o = drawer.order;
    title = o.order_id;
    meta = (
      <>
        <span className="drawer-date">{o.date}</span>
        <OrderPills order={o} corrected={(correctedOrderIds ?? []).includes(o.order_id)} />
      </>
    );
    body = <OrderDetail order={o} periodEnd={analysis?.period_end ?? null} attribution={analysis?.attribution ?? null} />;
  } else if (drawer?.kind === 'worked') {
    title = t('drawer.workedTitle', 'Worked example order');
    meta = drawer.data ? (
      <>
        <span className="drawer-date">{t('drawer.contributionInr', 'Contribution {{inr}}', { inr: formatInr(drawer.data.contribution_inr) })}</span>
        {drawer.data.expected_contribution_inr !== null ? (
          drawer.data.matches ? (
            <Pill tone="success" icon="check">
              {t('drawer.matchesRef', 'matches the reference {{inr}}', { inr: formatInr(drawer.data.expected_contribution_inr) })}
            </Pill>
          ) : (
            <Pill tone="danger">{t('drawer.noMatch', 'does not match')}</Pill>
          )
        ) : null}
      </>
    ) : null;
    body = drawer.data ? (
      <WorkedDetail data={drawer.data} />
    ) : drawer.error ? (
      <Callout tone="danger" title={drawer.error} role="alert" />
    ) : (
      <div className="drawer-stack" role="status" aria-label={t('drawer.loadingWorked', 'Loading the worked order')}>
        <Skeleton width="60%" />
        <Skeleton width="100%" height={180} />
      </div>
    );
  } else if (drawer?.kind === 'bridge' && analysis) {
    title = t('drawer.periodWaterfall', 'Period waterfall');
    meta = (
      <>
        <Pill tone="neutral">{analysis.attribution === 'channel' ? t('ledger.channelSpend') : t('drawer.allocateAds', 'Allocate ads')}</Pill>
        {analysis.totals.partial ? (
          <Pill tone="warning" dot>
            {t('drawer.partialUnknown', 'Partial · {{n}} unknown', { n: analysis.totals.unknown_count })}
          </Pill>
        ) : null}
      </>
    );
    body = <BridgeDetail a={analysis} focus={drawer.focus} />;
  } else if (drawer?.kind === 'margin' && analysis) {
    title = t('drawer.marginTitle', 'Contribution margin');
    meta = analysis.headline_gate.open ? (
      <Pill tone="success" icon="check">
        {t('drawer.headlineOpen', 'Headline open')}
      </Pill>
    ) : (
      <Pill tone="warning" icon="lock">
        {t('drawer.headlineClosed', 'Headline gate closed')}
      </Pill>
    );
    body = <MarginDetail a={analysis} />;
  } else if (drawer?.kind === 'checks') {
    title = t('drawer.checksTitle', 'Public checks');
    meta = <span className="drawer-date">{t('drawer.checksMeta', 'Engine checks · 25 points')}</span>;
    body = <ChecksDetail />;
  } else if (drawer?.kind === 'about') {
    title = t('drawer.aboutTitle', 'About {{name}}', { name: BRAND.name });
    meta = <span className="drawer-date">{t('tagline', BRAND.tagline)}</span>;
    body = <AboutDetail />;
  } else if (drawer?.kind === 'missing') {
    title = drawer.orderId;
    body = (
      <Callout tone="info" title={t('drawer.missingTitle', 'Order {{id}} is not in the current analysis.', { id: drawer.orderId })}>
        {t('drawer.missingBody', 'Load a dataset that contains it, then open it from the ledger.')}
      </Callout>
    );
  }

  return (
    <Drawer open={drawerOpen && drawer !== null} onClose={closeDrawer} title={title} meta={meta}>
      {body}
    </Drawer>
  );
}
