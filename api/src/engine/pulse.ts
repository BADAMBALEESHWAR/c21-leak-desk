import { formatInr } from './format.js';
import type { AnalysisResult, LeakCause, OrderResult } from './types.js';
import type { ScenarioOverrides } from '../schema/orders.js';

// Pulse: owner analytics over the same reconciled orders the ledger shows. Pure functions; read-only.
// Contribution here is always after ads. In channel mode the per-order view adds each order's ads back
// (channel spend is the sum of those ads), so monthly and product totals still equal the reconciled total.

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const r = Math.round;
const month = (o: OrderResult) => o.date.slice(0, 7);

export const COD_FEE_INR = 49;
export const SMALL_ORDER_INR = 600;
export const SMALL_ORDER_SHIPPING_CHARGE_INR = 49;
export const DISCOUNT_CAP_PCT = 15;
export const RECOVERY_TARGET_PCT = 90;

function afterAds(a: AnalysisResult, o: OrderResult): number {
  const c = o.contribution_inr as number;
  return a.attribution === 'channel' ? c - (o.inputs.ads ?? 0) : c;
}
const paid = (o: OrderResult) => o.inputs.gross - o.inputs.discount;

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

function base(a: AnalysisResult) {
  const synthetic = a.orders.filter((o) => o.synthetic).length;
  const labels = [...a.labels];
  if (a.attribution === 'channel') labels.push('Monthly and product views put each order’s ads back on that order; totals still equal the reconciled contribution.');
  return { labels, unknown_count: a.totals.unknown_count, synthetic_rows: synthetic };
}

export interface MonthRow {
  month: string;
  orders: number;
  unknown: number;
  gross_inr: number;
  net_sales_inr: number;
  contribution_inr: number;
  contribution_pct: number;
  return_pct: number;
  discount_depth_pct: number;
  aov_inr: number;
}

function monthRows(a: AnalysisResult): MonthRow[] {
  return [...groupBy(a.orders, month).entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([m, os]) => {
      const ok = os.filter((o) => o.status === 'ok');
      const net = ok.reduce((s, o) => s + (o.net_sales_inr as number), 0);
      const c = ok.reduce((s, o) => s + afterAds(a, o), 0);
      const gross = os.reduce((s, o) => s + o.inputs.gross, 0);
      const disc = os.reduce((s, o) => s + o.inputs.discount, 0);
      return {
        month: m,
        orders: os.length,
        unknown: os.length - ok.length,
        gross_inr: gross,
        net_sales_inr: net,
        contribution_inr: c,
        contribution_pct: pct(c, net),
        return_pct: pct(os.filter((o) => o.returned).length, os.length),
        discount_depth_pct: pct(disc, gross),
        aov_inr: os.length ? r(os.reduce((s, o) => s + paid(o), 0) / os.length) : 0,
      };
    });
}

export function pulseMonths(a: AnalysisResult) {
  return { months: monthRows(a), ...base(a) };
}

export interface ProductRow {
  product_id: string;
  units: number;
  orders: number;
  net_sales_inr: number;
  contribution_inr: number;
  contribution_per_unit_inr: number;
  return_pct: number;
  discount_depth_pct: number;
  shipping_pct: number;
  rank_units: number;
  rank_net_sales: number;
  rank_contribution: number;
  label: 'push' | 'fix' | 'niche' | 'review';
  lever: 'returns' | 'discount' | 'shipping' | 'price' | 'none';
  note: string;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0;
};
const rankOf = <T,>(xs: T[], v: (x: T) => number) => {
  const sorted = [...xs].sort((p, q) => v(q) - v(p));
  return (x: T) => sorted.indexOf(x) + 1;
};

function productRows(a: AnalysisResult): ProductRow[] {
  const rows = [...groupBy(a.orders.filter((o) => o.status === 'ok'), (o) => o.product_id).entries()].map(([id, os]) => {
    const units = os.reduce((s, o) => s + o.units, 0);
    const net = os.reduce((s, o) => s + (o.net_sales_inr as number), 0);
    const c = os.reduce((s, o) => s + afterAds(a, o), 0);
    const gross = os.reduce((s, o) => s + o.inputs.gross, 0);
    const value = os.reduce((s, o) => s + paid(o), 0);
    return {
      product_id: id,
      units,
      orders: os.length,
      net_sales_inr: net,
      contribution_inr: c,
      contribution_per_unit_inr: units ? r(c / units) : 0,
      return_pct: pct(os.filter((o) => o.returned).length, os.length),
      discount_depth_pct: pct(os.reduce((s, o) => s + o.inputs.discount, 0), gross),
      shipping_pct: pct(os.reduce((s, o) => s + o.inputs.shipping, 0), value),
    };
  });
  const midUnits = median(rows.map((x) => x.units));
  const midCpu = median(rows.map((x) => x.contribution_per_unit_inr));
  const byUnits = rankOf(rows, (x) => x.units);
  const byNet = rankOf(rows, (x) => x.net_sales_inr);
  const byC = rankOf(rows, (x) => x.contribution_inr);
  return rows
    .map((x) => {
      const highVol = x.units >= midUnits;
      const highCpu = x.contribution_per_unit_inr >= midCpu && x.contribution_per_unit_inr > 0;
      const label: ProductRow['label'] = highVol ? (highCpu ? 'push' : 'fix') : highCpu ? 'niche' : 'review';
      const lever: ProductRow['lever'] =
        label === 'push' ? 'none' : x.return_pct >= 25 ? 'returns' : x.discount_depth_pct >= 25 ? 'discount' : x.shipping_pct >= 12 ? 'shipping' : 'price';
      const why = { returns: `returns are ${x.return_pct}% of its orders`, discount: `discounts average ${x.discount_depth_pct}% of gross`, shipping: `shipping is ${x.shipping_pct}% of its order value`, price: 'its price leaves little after costs', none: 'it sells and earns' }[lever];
      const note =
        label === 'push'
          ? `${x.product_id} sells and earns: rank ${byUnits(x)} on units, ${byC(x)} on contribution. Give it more stock and visibility.`
          : `${x.product_id} ranks ${byUnits(x)} on units but ${byC(x)} on contribution; ${why}.`;
      return { ...x, rank_units: byUnits(x), rank_net_sales: byNet(x), rank_contribution: byC(x), label, lever, note };
    })
    .sort((p, q) => q.net_sales_inr - p.net_sales_inr);
}

export function pulseProducts(a: AnalysisResult) {
  return { products: productRows(a), ...base(a) };
}

export function pulseChannels(a: AnalysisResult) {
  const ok = a.orders.filter((o) => o.status === 'ok');
  const channels = a.groups.channel.map((g) => {
    const os = a.orders.filter((o) => o.channel === g.key);
    const ads = ok.filter((o) => o.channel === g.key).reduce((s, o) => s + (o.inputs.ads ?? 0), 0);
    return {
      channel: g.key,
      orders: g.orders,
      net_sales_inr: g.net_sales_inr,
      contribution_inr: g.contribution_inr,
      return_pct: pct(os.filter((o) => o.returned).length, os.length),
      ads_inr: ads,
      ads_share_pct: pct(ads, g.net_sales_inr),
    };
  });
  const typed = a.orders.filter((o) => o.payment_type);
  let payments: { not_in_file: true } | { rows: unknown[]; cod_vs_prepaid_return_ratio: number | null };
  if (typed.length === 0) payments = { not_in_file: true };
  else {
    const rows = [...groupBy(typed, (o) => o.payment_type as string).entries()].sort().map(([t, os]) => {
      const okOs = os.filter((o) => o.status === 'ok');
      return {
        payment_type: t,
        orders: os.length,
        share_pct: pct(os.length, typed.length),
        return_pct: pct(os.filter((o) => o.returned).length, os.length),
        payment_fee_per_order_inr: r(os.reduce((s, o) => s + (o.inputs.fee ?? 0), 0) / os.length),
        return_cost_per_order_inr: r(os.reduce((s, o) => s + (o.inputs.return_cost ?? 0), 0) / os.length),
        contribution_per_order_inr: okOs.length ? r(okOs.reduce((s, o) => s + afterAds(a, o), 0) / okOs.length) : 0,
      };
    });
    const cod = rows.find((x) => x.payment_type === 'cod');
    const pre = rows.find((x) => x.payment_type === 'prepaid');
    payments = { rows, cod_vs_prepaid_return_ratio: cod && pre && pre.return_pct ? Math.round((cod.return_pct / pre.return_pct) * 10) / 10 : null };
  }
  return { attribution: a.attribution, channels, payments, ...base(a) };
}

export function pulseLeaks(a: AnalysisResult) {
  const causes = [...new Set(a.orders.map((o) => o.leak_cause).filter((c): c is LeakCause => !!c))];
  const months = [...groupBy(a.orders, month).entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([m, os]) => {
      const by_cause: Record<string, number> = {};
      let total = 0;
      for (const o of os) {
        if (!o.leak_cause || o.status !== 'ok') continue;
        const lost = -afterAds(a, o);
        if (lost <= 0) continue;
        by_cause[o.leak_cause] = (by_cause[o.leak_cause] ?? 0) + lost;
        total += lost;
      }
      return { month: m, by_cause, total_lost_inr: total, unknown_orders: os.filter((o) => o.leak_cause === 'refund_unknown').length };
    });
  return { causes, months, ...base(a) };
}

const DISCOUNT_BANDS: Array<[string, number, number]> = [['0–10%', 0, 10], ['10–20%', 10, 20], ['20–30%', 20, 30], ['30%+', 30, 101]];
const VALUE_BANDS: Array<[string, number, number]> = [['under ₹600', 0, 600], ['₹600–1,499', 600, 1500], ['₹1,500–2,999', 1500, 3000], ['₹3,000+', 3000, Infinity]];

export function pulseInsights(a: AnalysisResult) {
  const ok = a.orders.filter((o) => o.status === 'ok');
  const discount_bands = DISCOUNT_BANDS.map(([band, lo, hi]) => {
    const os = ok.filter((o) => {
      const d = o.inputs.gross ? (o.inputs.discount / o.inputs.gross) * 100 : 0;
      return d >= lo && d < hi;
    });
    return { band, orders: os.length, contribution_per_order_inr: os.length ? r(os.reduce((s, o) => s + afterAds(a, o), 0) / os.length) : 0 };
  });
  const firstNegative = discount_bands.find((b) => b.orders > 0 && b.contribution_per_order_inr < 0);
  const order_value_bands = VALUE_BANDS.map(([band, lo, hi]) => {
    const os = ok.filter((o) => paid(o) >= lo && paid(o) < hi);
    const value = os.reduce((s, o) => s + paid(o), 0);
    return {
      band,
      orders: os.length,
      shipping_pct_of_net_sales: pct(os.reduce((s, o) => s + o.inputs.shipping, 0), value),
      contribution_per_order_inr: os.length ? r(os.reduce((s, o) => s + afterAds(a, o), 0) / os.length) : 0,
    };
  });
  const withCustomer = ok.filter((o) => o.customer_id);
  let repeat: Record<string, unknown> = { not_in_file: true };
  if (withCustomer.length) {
    const byCustomer = groupBy([...withCustomer].sort((x, y) => x.date.localeCompare(y.date) || x.order_id.localeCompare(y.order_id)), (o) => o.customer_id as string);
    const first: OrderResult[] = [];
    const again: OrderResult[] = [];
    for (const os of byCustomer.values()) os.forEach((o, i) => (i === 0 ? first : again).push(o));
    const per = (os: OrderResult[]) => (os.length ? r(os.reduce((s, o) => s + afterAds(a, o), 0) / os.length) : 0);
    repeat = {
      customers: byCustomer.size,
      repeat_customers: [...byCustomer.values()].filter((os) => os.length > 1).length,
      repeat_rate_pct: pct([...byCustomer.values()].filter((os) => os.length > 1).length, byCustomer.size),
      contribution_per_order_first_inr: per(first),
      contribution_per_order_repeat_inr: per(again),
    };
  }
  return { discount_bands, negative_from_discount_band: firstNegative?.band ?? null, order_value_bands, repeat, ...base(a) };
}

export interface PulseAction {
  title: string;
  detail: string;
  recoverable_inr: number;
  lever: string;
  overrides?: ScenarioOverrides;
}

/** Ranked by recoverable ₹. Each action is a stated assumption, not a forecast. */
export function pulseActions(a: AnalysisResult): PulseAction[] {
  const ok = a.orders.filter((o) => o.status === 'ok');
  const actions: PulseAction[] = [];
  const fmt = formatInr;

  for (const ch of pulseChannels(a).channels) {
    if ((ch.contribution_inr ?? 0) >= 0 || ch.ads_inr <= 0) continue;
    const save = Math.round(ch.ads_inr / 2);
    actions.push({
      title: `Halve ${ch.channel} ad spend per order`,
      detail: `${ch.channel} brings ${ch.orders.toLocaleString('en-IN')} orders at ${fmt(ch.contribution_inr ?? 0)} contribution; its ads are ${ch.ads_share_pct}% of its net sales. Halving ad spend per order there saves about ${fmt(save)} if the same orders still come.`,
      recoverable_inr: save,
      lever: 'ads',
    });
  }
  const cod = ok.filter((o) => o.payment_type === 'cod');
  const pay = pulseChannels(a).payments;
  if (cod.length && 'rows' in pay && (pay.cod_vs_prepaid_return_ratio ?? 0) > 1.5) {
    actions.push({
      title: `Add a ₹${COD_FEE_INR} COD fee`,
      detail: `COD orders return ${pay.cod_vs_prepaid_return_ratio}× as often as prepaid. A ₹${COD_FEE_INR} fee on ${cod.length.toLocaleString('en-IN')} COD orders recovers about ${fmt(COD_FEE_INR * cod.length)}, before any shift to prepaid.`,
      recoverable_inr: COD_FEE_INR * cod.length,
      lever: 'payments',
    });
  }
  const fixes = productRows(a).filter((p) => p.label === 'fix' || p.contribution_inr < 0).sort((p, q) => p.contribution_inr - q.contribution_inr);
  for (const p of fixes.slice(0, 1)) {
    const returns = ok.filter((o) => o.product_id === p.product_id && o.returned && !o.late_refund);
    const gain = returns.reduce((s, o) => s + Math.max(0, Math.round(((o.inputs.product_cost ?? 0) * RECOVERY_TARGET_PCT) / 100) - (o.inputs.recovered ?? 0)), 0);
    if (p.lever === 'returns' && gain > 0) {
      actions.push({
        title: `Inspect ${p.product_id} returns before restocking`,
        detail: `${p.product_id} is rank ${p.rank_units} on units but ${p.rank_contribution} on contribution; ${p.return_pct}% of its orders come back. Recovering ${RECOVERY_TARGET_PCT}% of product cost on its returns adds about ${fmt(gain)}.`,
        recoverable_inr: gain,
        lever: 'returns',
        overrides: { recovery_pct: RECOVERY_TARGET_PCT },
      });
    }
  }
  const capGain = ok
    .filter((o) => !o.returned)
    .reduce((s, o) => s + Math.max(0, o.inputs.discount - Math.round((o.inputs.gross * DISCOUNT_CAP_PCT) / 100)), 0);
  if (capGain > 0) {
    actions.push({
      title: `Cap discounts at ${DISCOUNT_CAP_PCT}%`,
      detail: `Kept orders discounted above ${DISCOUNT_CAP_PCT}% of gross gave away ${fmt(capGain)} more than a ${DISCOUNT_CAP_PCT}% cap allows, assuming the same orders still happen.`,
      recoverable_inr: capGain,
      lever: 'discount',
    });
  }
  const small = ok.filter((o) => paid(o) < SMALL_ORDER_INR && !o.returned);
  if (small.length) {
    actions.push({
      title: `Charge ₹${SMALL_ORDER_SHIPPING_CHARGE_INR} shipping under ₹${SMALL_ORDER_INR}`,
      detail: `${small.length.toLocaleString('en-IN')} kept orders were under ₹${SMALL_ORDER_INR}, where shipping takes the most of each rupee. A ₹${SMALL_ORDER_SHIPPING_CHARGE_INR} charge recovers about ${fmt(SMALL_ORDER_SHIPPING_CHARGE_INR * small.length)}.`,
      recoverable_inr: SMALL_ORDER_SHIPPING_CHARGE_INR * small.length,
      lever: 'shipping',
    });
  }
  return actions.sort((p, q) => q.recoverable_inr - p.recoverable_inr).slice(0, 3);
}

export function pulseOverview(a: AnalysisResult, requested?: string) {
  const months = monthRows(a);
  const keys = months.map((m) => m.month);
  const current = months.find((m) => m.month === requested) ?? months[months.length - 1];
  const i = months.indexOf(current);
  const previous = i > 0 ? months[i - 1] : null;
  const head = (m: MonthRow) => ({
    orders: m.orders,
    gross_inr: m.gross_inr,
    net_sales_inr: m.net_sales_inr,
    contribution_inr: m.contribution_inr,
    contribution_pct: m.contribution_pct,
    return_pct: m.return_pct,
    aov_inr: m.aov_inr,
  });
  const change = (x: number, y: number) => (y ? Math.round(((x - y) / Math.abs(y)) * 1000) / 10 : null);
  const counted = months.filter((m) => m.orders - m.unknown > 0);
  const extreme = (dir: 1 | -1, f: (m: MonthRow) => number) => {
    const m = [...counted].sort((p, q) => dir * (f(q) - f(p)))[0];
    return m ? { month: m.month, value_inr: f(m) } : null;
  };
  const perOrder = (m: MonthRow) => Math.round(m.contribution_inr / Math.max(1, m.orders - m.unknown));
  // Best and weakest need two months to compare; a metric where one month is both (a tie) names neither.
  const pair = (f: (m: MonthRow) => number) => {
    const hi = extreme(1, f);
    const lo = extreme(-1, f);
    return hi && lo && hi.month !== lo.month && f(counted.find((m) => m.month === hi.month)!) !== f(counted.find((m) => m.month === lo.month)!) ? { hi, lo } : null;
  };
  const metrics = counted.length >= 2 ? { net_sales: pair((m) => m.net_sales_inr), contribution: pair((m) => m.contribution_inr), contribution_per_order: pair(perOrder) } : null;
  return {
    month: current?.month ?? null,
    months: keys,
    headline: current ? head(current) : null,
    previous: previous ? head(previous) : null,
    deltas:
      current && previous
        ? {
            orders_pct: change(current.orders, previous.orders),
            net_sales_pct: change(current.net_sales_inr, previous.net_sales_inr),
            contribution_pct: change(current.contribution_inr, previous.contribution_inr),
            return_pct_pts: Math.round((current.return_pct - previous.return_pct) * 10) / 10,
          }
        : null,
    /** null when fewer than two months have counted orders: nothing to compare yet. */
    best: metrics ? { net_sales: metrics.net_sales?.hi ?? null, contribution: metrics.contribution?.hi ?? null, contribution_per_order: metrics.contribution_per_order?.hi ?? null } : null,
    worst: metrics ? { net_sales: metrics.net_sales?.lo ?? null, contribution: metrics.contribution?.lo ?? null, contribution_per_order: metrics.contribution_per_order?.lo ?? null } : null,
    months_compared: counted.length,
    actions: pulseActions(a),
    ...base(a),
  };
}
