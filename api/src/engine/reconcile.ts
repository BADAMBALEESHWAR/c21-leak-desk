import { formatInr } from './format.js';
import { UNASSIGNED } from './contribution.js';
import {
  AttributionConflict,
  type AttributionMode,
  type GroupRow,
  type Inr,
  type OrderResult,
  type OrderRow,
  type Reconciliation,
} from './types.js';

export const RECONCILE_TOLERANCE_INR = 1;

export interface ChannelSpend {
  by_channel: Map<string, Inr>;
  total_inr: Inr;
  source: 'none' | 'derived_from_ads' | 'config';
}

/**
 * Rule 3: channel spend exists only in channel mode. By default it is the sum of
 * ads_inr of the orders in that channel, so switching modes moves the same rupees
 * from order lines to the channel line. Explicit channel spend plus per-order ads
 * in allocate mode would deduct both — that throws.
 */
export function assertAttribution(rows: OrderRow[], mode: AttributionMode, explicit?: Record<string, number>): void {
  const hasOrderAds = rows.some((r) => typeof r.ads_inr === 'number' && r.ads_inr > 0);
  const hasExplicit = explicit !== undefined && Object.values(explicit).some((v) => v > 0);
  if (mode === 'allocate' && hasExplicit && hasOrderAds) {
    throw new AttributionConflict('Per-order ads_inr and config.channel_spend_inr were both supplied in allocate mode.');
  }
}

/**
 * Pass only rows whose order is known: an unknown order leaves the totals with its ads,
 * in both modes, so switching modes never changes the total.
 */
export function channelSpendFor(
  rows: OrderRow[],
  mode: AttributionMode,
  explicit?: Record<string, number>,
): ChannelSpend {
  assertAttribution(rows, mode, explicit);
  const hasExplicit = explicit !== undefined && Object.values(explicit).some((v) => v > 0);
  if (mode === 'allocate') return { by_channel: new Map(), total_inr: 0, source: 'none' };

  const byChannel = new Map<string, Inr>();
  if (hasExplicit) {
    for (const [k, v] of Object.entries(explicit!)) byChannel.set(k, v);
  } else {
    for (const r of rows) {
      if (r.ads_inr === undefined) continue;
      const key = r.channel ?? UNASSIGNED;
      const prev = byChannel.has(key) ? byChannel.get(key)! : 0;
      byChannel.set(key, prev === null || r.ads_inr === null ? null : prev + r.ads_inr);
    }
  }
  let total: Inr = 0;
  for (const v of byChannel.values()) total = total === null || v === null ? null : total + v;
  return { by_channel: byChannel, total_inr: total, source: hasExplicit ? 'config' : 'derived_from_ads' };
}

function groupBy(orders: OrderResult[], keyOf: (o: OrderResult) => string): Map<string, OrderResult[]> {
  const m = new Map<string, OrderResult[]>();
  for (const o of orders) {
    const k = keyOf(o);
    const list = m.get(k);
    if (list) list.push(o);
    else m.set(k, [o]);
  }
  return m;
}

function summarise(key: string, list: OrderResult[], spend: Inr): GroupRow {
  const ok = list.filter((o) => o.status === 'ok');
  const before = ok.reduce((s, o) => s + (o.contribution_inr as number), 0);
  return {
    key,
    orders: list.length,
    unknown_count: list.length - ok.length,
    net_sales_inr: ok.reduce((s, o) => s + (o.net_sales_inr as number), 0),
    contribution_before_spend_inr: before,
    channel_spend_inr: spend,
    contribution_inr: spend === null ? null : before - spend,
  };
}

const byKey = (a: GroupRow, b: GroupRow) =>
  a.key === UNASSIGNED ? 1 : b.key === UNASSIGNED ? -1 : a.key.localeCompare(b.key);

export interface Grouped {
  channel: GroupRow[];
  product: GroupRow[];
  product_unallocated_spend_inr: Inr;
  reconciliation: Reconciliation;
}

/** Rule 7: Σ orders = Σ channels = Σ products (±₹1), with channel spend counted exactly once. */
export function reconcile(orders: OrderResult[], mode: AttributionMode, spend: ChannelSpend): Grouped {
  // Invariant: an order never carries ads while its channel also deducts spend.
  if (mode === 'channel') {
    const adsOnOrders = orders.some((o) => o.lines.some((l) => l.key === 'ads' && (l.amount_inr ?? 0) !== 0));
    if (adsOnOrders) throw new AttributionConflict('Ads were deducted on orders while channel spend is active.');
  } else if ((spend.total_inr ?? 0) !== 0) {
    throw new AttributionConflict('Channel spend was deducted while ads are allocated to orders.');
  }

  const channelGroups = groupBy(orders, (o) => o.channel);
  for (const k of spend.by_channel.keys()) if (!channelGroups.has(k)) channelGroups.set(k, []);
  const channel = [...channelGroups.entries()]
    .map(([k, list]) => summarise(k, list, mode === 'channel' ? (spend.by_channel.get(k) ?? 0) : 0))
    .sort(byKey);
  const product = [...groupBy(orders, (o) => o.product_id).entries()].map(([k, list]) => summarise(k, list, 0)).sort(byKey);

  const okOrders = orders.filter((o) => o.status === 'ok');
  const orderSum = okOrders.reduce((s, o) => s + (o.contribution_inr as number), 0);
  const unallocated = mode === 'channel' ? spend.total_inr : 0;

  const ordersInr: Inr = unallocated === null ? null : orderSum - unallocated;
  const channelsInr: Inr = channel.some((g) => g.contribution_inr === null)
    ? null
    : channel.reduce((s, g) => s + (g.contribution_inr as number), 0);
  const productsInr: Inr =
    unallocated === null ? null : product.reduce((s, g) => s + (g.contribution_inr as number), 0) - unallocated;

  const values = [ordersInr, channelsInr, productsInr];
  const known = values.every((v) => v !== null);
  const gap = known ? Math.max(...(values as number[])) - Math.min(...(values as number[])) : 0;
  const ok = known && gap <= RECONCILE_TOLERANCE_INR;
  const partial = okOrders.length < orders.length || !known;

  let statement: string;
  if (!known) statement = 'Channel spend is unknown for at least one channel — totals cannot be reconciled until it is supplied.';
  else if (ok) statement = 'Σ orders = Σ channels = Σ products';
  else statement = `Totals differ by ${formatInr(gap)} — check channel and product assignments.`;

  return {
    channel,
    product,
    product_unallocated_spend_inr: unallocated,
    reconciliation: {
      orders_inr: ordersInr,
      channels_inr: channelsInr,
      products_inr: productsInr,
      gap_inr: gap,
      tolerance_inr: RECONCILE_TOLERANCE_INR,
      ok,
      partial,
      statement,
    },
  };
}
