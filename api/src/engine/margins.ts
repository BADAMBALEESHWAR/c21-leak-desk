import type { AttributionMode, Inr, OrderResult } from './types.js';

// Unit economics (CM1–CM3) as a pure aggregation of computed orders. No rule lives here: every rupee is a line
// the engine already computed, so the margin totals end at the same contribution as the reconciliation.

export interface MarginParts {
  /** Revenue − refunds: the engine's net sales (gross − discount − refund). */
  net_revenue_inr: number;
  /** Product cost − recovered product cost (subtracted once). */
  net_product_cost_inr: number;
  shipping_inr: number;
  payment_fee_inr: number;
  /** Return shipping and inspection; counted with shipping in CM2. */
  return_cost_inr: number;
  handling_inr: number;
  /** Allocated ads (allocate mode) or channel spend (channel mode); never both. */
  ads_inr: number;
  contribution_inr: Inr;
}

export interface Margins extends MarginParts {
  cm1_pct: number | null;
  cm2_pct: number | null;
  cm3_pct: number | null;
  /** Orders whose contribution is known; only these are counted. */
  orders_counted: number;
  /** Orders left out because a fact is unknown. */
  unknown_left_out: number;
  /** True when unknown orders (or unknown channel spend) were left out. */
  partial: boolean;
}

export const MARGIN_FORMULAS = {
  net_revenue: 'net revenue = revenue − refunds (gross − discount − refund)',
  net_product_cost: 'net product cost = product cost − recovered product cost (subtracted once)',
  cm1: 'CM1 = (net revenue − net product cost) ÷ net revenue',
  cm2: 'CM2 = (net revenue − net product cost − shipping (incl. return shipping) − payment fees − handling) ÷ net revenue',
  cm3: 'CM3 = contribution ÷ net revenue = (net revenue − net product cost − shipping (incl. return shipping) − payment fees − handling − ads) ÷ net revenue',
  net_margin: 'net margin (estimated) = (contribution − fixed costs) ÷ net revenue; fixed costs are an assumed input, default 0',
} as const;

/** Percentage of net revenue to 2 decimals; null when there is no net revenue to divide by. */
export function pctOf(numerator: number | null, netRevenue: number): number | null {
  if (numerator === null || !(netRevenue > 0)) return null;
  return Math.round((numerator * 10000) / netRevenue) / 100;
}

export function marginsFromParts(parts: MarginParts, ordersCounted: number, unknownLeftOut: number, spendUnknown = false): Margins {
  const net = parts.net_revenue_inr;
  const afterCost = net - parts.net_product_cost_inr;
  const afterFulfilment = afterCost - parts.shipping_inr - parts.return_cost_inr - parts.payment_fee_inr - parts.handling_inr;
  return {
    ...parts,
    cm1_pct: pctOf(afterCost, net),
    cm2_pct: pctOf(afterFulfilment, net),
    cm3_pct: pctOf(parts.contribution_inr, net),
    orders_counted: ordersCounted,
    unknown_left_out: unknownLeftOut,
    partial: unknownLeftOut > 0 || spendUnknown,
  };
}

/** Positive rupees of one deduction line, summed over the given orders. */
const lineTotal = (orders: OrderResult[], key: string) => orders.reduce((s, o) => s - (o.lines.find((l) => l.key === key)?.amount_inr ?? 0), 0);

/**
 * Margins over computed orders. Only orders with a known contribution are counted.
 * Channel mode: ads are the channel spend (pass it; defaults to the ads of the counted orders), so the
 * total still equals the reconciled contribution.
 */
export function computeMargins(orders: OrderResult[], attribution: AttributionMode, channelSpendInr?: Inr): Margins {
  const ok = orders.filter((o) => o.status === 'ok');
  const unknown = orders.length - ok.length;
  const spend: Inr =
    attribution === 'channel'
      ? channelSpendInr === undefined
        ? ok.reduce((s, o) => s + (o.inputs.ads ?? 0), 0)
        : channelSpendInr
      : 0;
  const orderContribution = ok.reduce((s, o) => s + (o.contribution_inr as number), 0);
  const noneKnown = orders.length > 0 && ok.length === 0;
  const parts: MarginParts = {
    net_revenue_inr: ok.reduce((s, o) => s + (o.net_sales_inr as number), 0),
    net_product_cost_inr: lineTotal(ok, 'net_product_cost'),
    shipping_inr: lineTotal(ok, 'shipping'),
    payment_fee_inr: lineTotal(ok, 'payment_fee'),
    return_cost_inr: lineTotal(ok, 'return_cost'),
    handling_inr: lineTotal(ok, 'handling'),
    ads_inr: lineTotal(ok, 'ads') + (spend ?? 0),
    contribution_inr: noneKnown || spend === null ? null : orderContribution - spend,
  };
  return marginsFromParts(parts, ok.length, unknown, spend === null);
}

/** Estimated operational net margin: (contribution − fixed costs) ÷ net revenue. Not statutory net profit. */
export function netMarginPct(m: Pick<Margins, 'contribution_inr' | 'net_revenue_inr'>, fixedCostsInr = 0): number | null {
  return m.contribution_inr === null ? null : pctOf(m.contribution_inr - fixedCostsInr, m.net_revenue_inr);
}
