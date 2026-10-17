import { computeOrder } from './contribution.js';
import { findLeaks, type Describe } from './leaks.js';
import { assertAttribution, channelSpendFor, reconcile } from './reconcile.js';
import {
  ATTRIBUTION_LABEL,
  ENGINE_VERSION,
  type AttributionMode,
  type HeadlineGate,
  type Inr,
  type LeakGroup,
  type Observed,
  type OrderResult,
  type OrderRow,
  type Reconciliation,
  type Totals,
  type WhalePoint,
  type BridgeLine,
  type GroupRow,
} from './types.js';
import { formatInr } from './format.js';
import { defaultPeriodEnd } from './validate.js';

export interface LedgerOptions {
  attribution: AttributionMode;
  period_end?: string;
  /** R4 default. ₹0: the fixture has no handling column and its kept orders must stay at +420. */
  handling_default_inr?: number;
  channel_spend?: Record<string, number>;
}

export const DEFAULT_HANDLING_INR = 0;
const WHALE_MAX_POINTS = 200;

export interface Ledger {
  engine_version: string;
  attribution: AttributionMode;
  period_end: string;
  config: { handling_default_inr: number };
  channel_spend: Record<string, Inr>;
  labels: string[];
  rows: OrderRow[];
  orders: OrderResult[];
  totals: Totals;
  reconciliation: Reconciliation;
  groups: { channel: GroupRow[]; product: GroupRow[]; product_unallocated_spend_inr: Inr; product_label: string };
  leaks: LeakGroup[];
  late_refunds: { period_end: string; orders: OrderResult[]; pending_delta_inr: number; total_if_recognised_inr: Inr };
  observed: Observed;
  headline_gate: HeadlineGate;
  whale: WhalePoint[];
  bridge: BridgeLine[];
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100 : null);
const pct1 = (n: number) => Math.round(n * 1000) / 10;

export function observedFor(rows: OrderRow[], orders: OrderResult[]): Observed {
  const recognisedReturns = rows.filter((r, i) => r.returned && !orders[i].late_refund);
  const withRecovery = recognisedReturns.filter((r) => r.product_cost_inr !== null && r.recovered_product_cost_inr !== null && r.product_cost_inr > 0);
  const pcSum = withRecovery.reduce((s, r) => s + (r.product_cost_inr as number), 0);
  const recSum = withRecovery.reduce((s, r) => s + (r.recovered_product_cost_inr as number), 0);
  return {
    return_rate_pct: rows.length ? pct1(recognisedReturns.length / rows.length) : 0,
    recovery_pct: pcSum > 0 ? pct1(recSum / pcSum) : null,
    avg_product_cost_on_returns_inr: avg(recognisedReturns.filter((r) => r.product_cost_inr !== null).map((r) => r.product_cost_inr as number)),
    avg_return_cost_inr: avg(recognisedReturns.filter((r) => r.return_cost_inr !== null).map((r) => r.return_cost_inr as number)),
    avg_shipping_inr: avg(rows.map((r) => r.shipping_inr)),
    avg_ads_per_order_inr: avg(rows.map((r) => (typeof r.ads_inr === 'number' ? r.ads_inr : 0))),
    returned_orders: recognisedReturns.length,
    refund_unknown_orders: recognisedReturns.filter((r) => r.refund_inr === null).length,
  };
}

function whaleCurve(orders: OrderResult[]): WhalePoint[] {
  const ok = orders.filter((o) => o.status === 'ok').sort((a, b) => (b.contribution_inr as number) - (a.contribution_inr as number) || a.order_id.localeCompare(b.order_id));
  let cum = 0;
  const all = ok.map((o, i) => {
    cum += o.contribution_inr as number;
    return { rank: i + 1, order_id: o.order_id, contribution_inr: o.contribution_inr as number, cumulative_inr: cum };
  });
  if (all.length <= WHALE_MAX_POINTS) return all;
  const step = all.length / WHALE_MAX_POINTS;
  const sampled = Array.from({ length: WHALE_MAX_POINTS }, (_, i) => all[Math.floor(i * step)]);
  sampled[sampled.length - 1] = all[all.length - 1];
  return sampled;
}

/** Period waterfall over computed orders: gross → net sales → contribution (equals Σ orders in the reconciliation). */
function bridgeFor(orders: OrderResult[], channelSpend: Inr, contribution: Inr): BridgeLine[] {
  const ok = orders.filter((o) => o.status === 'ok');
  const sum = (key: string) => ok.reduce((s, o) => s + (o.lines.find((l) => l.key === key)?.amount_inr ?? 0), 0);
  const gross = sum('gross');
  const discount = sum('discount');
  const refund = sum('refund');
  const lines: BridgeLine[] = [
    { key: 'gross', label: 'Gross sales', amount_inr: gross, kind: 'start' },
    { key: 'discount', label: 'Discounts', amount_inr: discount, kind: 'deduction' },
    { key: 'refund', label: 'Refunds', amount_inr: refund, kind: 'deduction' },
    { key: 'net_sales', label: 'Net sales', amount_inr: gross + discount + refund, kind: 'subtotal' },
    { key: 'net_product_cost', label: 'Net product cost', amount_inr: sum('net_product_cost'), kind: 'deduction' },
    { key: 'shipping', label: 'Shipping', amount_inr: sum('shipping'), kind: 'deduction' },
    { key: 'payment_fee', label: 'Payment fees', amount_inr: sum('payment_fee'), kind: 'deduction' },
    { key: 'return_cost', label: 'Return costs', amount_inr: sum('return_cost'), kind: 'deduction' },
    { key: 'handling', label: 'Handling', amount_inr: sum('handling'), kind: 'deduction' },
    { key: 'ads', label: 'Ads on orders', amount_inr: sum('ads'), kind: 'deduction' },
  ];
  if (channelSpend) lines.push({ key: 'channel_spend', label: 'Channel spend', amount_inr: -channelSpend, kind: 'deduction' });
  lines.push({ key: 'contribution', label: 'Contribution', amount_inr: contribution ?? 0, kind: 'total' });
  return lines;
}

/** R1–R11 over one dataset. Pure. */
export function computeLedger(allRows: OrderRow[], opts: LedgerOptions, describe: Describe): Ledger {
  const periodEnd = opts.period_end ?? defaultPeriodEnd(allRows);
  const handling = opts.handling_default_inr ?? DEFAULT_HANDLING_INR;
  // Period membership is by order date (§6.2).
  const rows = allRows.filter((r) => r.date <= periodEnd);

  assertAttribution(rows, opts.attribution, opts.channel_spend);
  const copts = { attribution: opts.attribution, handling_default_inr: handling, period_end: periodEnd };
  const orders = rows.map((r) => computeOrder(r, copts));
  // An unknown order keeps its ads out of channel spend too, so totals match across modes.
  const spend = channelSpendFor(rows.filter((_, i) => orders[i].status === 'ok'), opts.attribution, opts.channel_spend);
  const grouped = reconcile(orders, opts.attribution, spend);
  const leaks = findLeaks(rows, orders, describe);

  const ok = orders.filter((o) => o.status === 'ok');
  const unknownCount = orders.length - ok.length;
  const netSales = ok.reduce((s, o) => s + (o.net_sales_inr as number), 0);
  const contribution = ok.length === 0 ? null : grouped.reconciliation.orders_inr;
  const late = orders.filter((o) => o.late_refund);
  const lateKnown = late.filter((o) => o.status === 'ok' && o.recognised_contribution_inr !== null);
  const pending = lateKnown.reduce((s, o) => s + (o.recognised_contribution_inr as number) - (o.contribution_inr as number), 0);
  const refundGaps = rows.filter((r, i) => r.returned && !orders[i].late_refund && (r.refund_inr === null || r.recovered_product_cost_inr === null)).length;
  const headlineReady = unknownCount === 0 && refundGaps === 0;

  const totals: Totals = {
    orders: orders.length,
    gross_inr: orders.reduce((s, o) => s + o.gross_inr, 0),
    net_sales_inr: netSales,
    contribution_inr: contribution,
    contribution_pct: contribution !== null && netSales > 0 ? Math.round((contribution / netSales) * 1000) / 10 : null,
    negative_count: ok.filter((o) => (o.contribution_inr as number) < 0).length,
    unknown_count: unknownCount,
    partial: unknownCount > 0 || grouped.reconciliation.partial,
    channel_spend_inr: opts.attribution === 'channel' ? spend.total_inr : 0,
    late_refund_count: late.length,
    late_refund_pending_inr: pending,
    headline_ready: headlineReady,
  };

  const labels = [ATTRIBUTION_LABEL, 'Operational contribution, not statutory net profit.'];
  if (rows.some((r) => r.synthetic)) labels.push('Includes labelled synthetic rows (synthetic: true); they are not observed data.');
  if (rows.some((r) => r.handling_inr === undefined)) labels.push(`Handling ${formatInr(handling)} per order where the row has none (estimate).`);
  const outside = allRows.length - rows.length;
  if (outside > 0) labels.push(`${outside} order${outside === 1 ? " is" : "s are"} dated after the period end (${periodEnd}) and outside this period.`);

  return {
    engine_version: ENGINE_VERSION,
    attribution: opts.attribution,
    period_end: periodEnd,
    config: { handling_default_inr: handling },
    channel_spend: Object.fromEntries(spend.by_channel),
    labels,
    rows,
    orders,
    totals,
    reconciliation: grouped.reconciliation,
    groups: {
      channel: grouped.channel,
      product: grouped.product,
      product_unallocated_spend_inr: grouped.product_unallocated_spend_inr,
      product_label: opts.attribution === 'channel' ? 'before channel spend' : 'after allocated ads',
    },
    leaks,
    late_refunds: {
      period_end: periodEnd,
      orders: late,
      pending_delta_inr: pending,
      total_if_recognised_inr: contribution === null ? null : contribution + pending,
    },
    observed: observedFor(rows, orders),
    headline_gate: headlineReady
      ? { open: true, reason: 'Refund and recovery facts are complete for every order in the period.' }
      : { open: false, reason: `Contribution % is hidden until refund and recovery facts are complete (${unknownCount} order${unknownCount === 1 ? '' : 's'} unknown).` },
    whale: whaleCurve(orders),
    bridge: bridgeFor(orders, opts.attribution === 'channel' ? spend.total_inr : 0, contribution),
  };
}
