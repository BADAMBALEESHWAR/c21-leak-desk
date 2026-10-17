import type { WorkedOrder } from '../schema/orders.js';
import type {
  AttributionMode,
  Inr,
  OrderResult,
  OrderRow,
  WaterfallLine,
  WorkedOrderResult,
} from './types.js';
import { ATTRIBUTION_LABEL } from './types.js';
import { isLateRefund } from './validate.js';

export interface ContributionOptions {
  attribution: AttributionMode;
  /** R4: used only when a row has no handling_inr (labelled estimate). */
  handling_default_inr: number;
  period_end: string;
}

export const UNASSIGNED = 'unassigned';
const NET_COST_NOTE = 'Net product cost after recovery; not double-counted.';

const neg = (v: Inr): Inr => (v === null ? null : v === 0 ? 0 : -v);
const sum = (xs: Inr[]): Inr => (xs.some((x) => x === null) ? null : (xs as number[]).reduce((s, x) => s + x, 0));

/** R2: product cost − recovered (or a supplied net figure). Never both. */
export function netProductCost(row: Pick<OrderRow, 'product_cost_inr' | 'recovered_product_cost_inr' | 'net_product_cost_inr'>, recognise = true): Inr {
  if (row.product_cost_inr === null) return row.net_product_cost_inr ?? null;
  if (!recognise) return row.product_cost_inr;
  return row.recovered_product_cost_inr === null ? null : row.product_cost_inr - row.recovered_product_cost_inr;
}

export function handlingFor(row: OrderRow, defaultInr: number): { value: Inr; source: 'input' | 'config_default' } {
  if (row.handling_inr !== undefined) return { value: row.handling_inr, source: 'input' };
  return { value: defaultInr, source: 'config_default' };
}

/** R1–R6 and R8 for one order. The in-period view of a late refund treats refund, recovery and return cost as not yet occurred. */
export function computeOrder(row: OrderRow, opts: ContributionOptions): OrderResult {
  const late = isLateRefund(row, opts.period_end);
  const handling = handlingFor(row, opts.handling_default_inr);
  const adsInput: Inr = row.ads_inr === undefined ? 0 : row.ads_inr;
  const adsAllocated: Inr = opts.attribution === 'allocate' ? adsInput : 0;

  const view = (recognise: boolean) => {
    const refund: Inr = recognise ? row.refund_inr : 0;
    const returnCost: Inr = recognise ? row.return_cost_inr : 0;
    const netSales: Inr = refund === null ? null : row.gross_inr - row.discount_inr - refund; // R1
    const npc = netProductCost(row, recognise); // R2
    const contribution = sum([netSales, neg(npc), -row.shipping_inr, neg(row.payment_fee_inr), neg(returnCost), neg(handling.value), neg(adsAllocated)]); // R5
    return { refund, returnCost, netSales, npc, contribution };
  };
  const period = view(!late);
  const recognised = late ? view(true) : period;

  const unknown: string[] = [];
  if (period.refund === null) unknown.push('refund_inr');
  if (period.npc === null) unknown.push(row.product_cost_inr === null ? 'product_cost_inr' : 'recovered_product_cost_inr');
  if (row.payment_fee_inr === null) unknown.push('payment_fee_inr');
  if (period.returnCost === null) unknown.push('return_cost_inr');
  if (handling.value === null) unknown.push('handling_inr');
  // Unknown ads make the order unknown in both modes, so it leaves orders and channel spend alike (R6, R11).
  if (row.ads_inr === null) unknown.push('ads_inr');
  const status = unknown.length === 0 ? 'ok' : 'unknown'; // R6

  const lateNote = late ? `Refund dated ${row.refund_date} is after the period end ${opts.period_end}; not recognised in this period.` : undefined;
  let adsNote: string | undefined;
  if (opts.attribution === 'channel') {
    adsNote = typeof adsInput === 'number' && adsInput > 0 ? `${adsInput} counted once in channel spend for ${row.channel ?? UNASSIGNED}.` : 'Ads are deducted at the channel line in this mode.';
  }
  const lines: WaterfallLine[] = [
    { key: 'gross', label: 'Gross sales', amount_inr: row.gross_inr, kind: 'start', source: 'input' },
    { key: 'discount', label: 'Discount', amount_inr: neg(row.discount_inr), kind: 'deduction', source: 'input' },
    { key: 'refund', label: 'Refund', amount_inr: neg(period.refund), kind: 'deduction', source: late ? 'not_recognised' : 'input', note: lateNote },
    {
      key: 'net_product_cost',
      label: 'Net product cost',
      amount_inr: neg(period.npc),
      kind: 'deduction',
      source: row.product_cost_inr === null ? 'input' : 'derived',
      note:
        late
          ? 'Recovery not yet recognised in this period.'
          : row.recovered_product_cost_inr
            ? `${NET_COST_NOTE} Product cost ${row.product_cost_inr} less recovered ${row.recovered_product_cost_inr}.`
            : NET_COST_NOTE,
    },
    { key: 'shipping', label: 'Shipping', amount_inr: neg(row.shipping_inr), kind: 'deduction', source: 'input' },
    { key: 'payment_fee', label: 'Payment fee', amount_inr: neg(row.payment_fee_inr), kind: 'deduction', source: 'input' },
    { key: 'return_cost', label: 'Return cost', amount_inr: neg(period.returnCost), kind: 'deduction', source: late ? 'not_recognised' : 'input', note: late ? 'Return cost not yet recognised in this period.' : undefined },
    {
      key: 'handling',
      label: 'Handling',
      amount_inr: neg(handling.value),
      kind: 'deduction',
      source: handling.source,
      note: handling.source === 'config_default' ? 'Not in the source row; config default (estimate).' : undefined,
    },
    {
      key: 'ads',
      label: 'Ads',
      amount_inr: neg(adsAllocated),
      kind: 'deduction',
      source: opts.attribution === 'channel' ? 'moved_to_channel' : row.ads_inr === undefined ? 'not_supplied' : 'input',
      note: adsNote,
    },
  ];

  const labels: string[] = [];
  if (handling.source === 'config_default') labels.push('handling estimated');
  if (row.ads_inr !== undefined) labels.push(ATTRIBUTION_LABEL);
  if (row.synthetic) labels.push('synthetic row');

  return {
    order_id: row.order_id,
    date: row.date,
    channel: row.channel ?? UNASSIGNED,
    product_id: row.product_id ?? UNASSIGNED,
    synthetic: row.synthetic === true,
    returned: row.returned,
    status,
    gross_inr: row.gross_inr,
    net_sales_inr: period.netSales,
    contribution_inr: status === 'ok' ? period.contribution : null,
    unknown_fields: unknown,
    lines,
    inputs: {
      gross: row.gross_inr,
      discount: row.discount_inr,
      refund: row.refund_inr,
      product_cost: row.product_cost_inr,
      recovered: row.recovered_product_cost_inr,
      shipping: row.shipping_inr,
      fee: row.payment_fee_inr,
      return_cost: row.return_cost_inr,
      handling: handling.value,
      ads: adsInput,
    },
    derived: { net_sales: period.netSales, net_product_cost: period.npc, ads_allocated: adsAllocated, contribution: status === 'ok' ? period.contribution : null },
    flags: late ? ['late_refund'] : [],
    leak_cause: null,
    labels,
    late_refund: late,
    refund_date: row.refund_date ?? null,
    recognised_contribution_inr: status === 'ok' ? recognised.contribution : null,
  };
}

/** Check 1: the pack's worked order — exactly six lines. */
export function computeWorkedOrder(w: WorkedOrder): WorkedOrderResult {
  const lines: WaterfallLine[] = [
    { key: 'revenue', label: 'Revenue', amount_inr: w.revenue_inr, kind: 'start', source: 'input' },
    { key: 'refund', label: 'Refund', amount_inr: neg(w.refund_inr), kind: 'deduction', source: 'input' },
    {
      key: 'net_product_cost',
      label: 'Net product cost',
      amount_inr: neg(w.net_product_cost_inr),
      kind: 'deduction',
      source: 'input',
      note: 'Net product cost is after any recovered stock cost; recovery is not subtracted a second time.',
    },
    { key: 'shipping', label: 'Shipping', amount_inr: neg(w.shipping_inr), kind: 'deduction', source: 'input' },
    { key: 'ads', label: 'Ads', amount_inr: neg(w.ads_inr), kind: 'deduction', source: 'input' },
    { key: 'handling', label: 'Handling', amount_inr: neg(w.handling_inr), kind: 'deduction', source: 'input' },
  ];
  const contribution = w.revenue_inr - w.refund_inr - w.net_product_cost_inr - w.shipping_inr - w.ads_inr - w.handling_inr;
  const expected = w.expected_contribution_inr ?? null;
  return {
    contribution_inr: contribution,
    expected_contribution_inr: expected,
    matches: expected === null ? true : contribution === expected,
    lines,
    note: 'Net product cost is after any recovered stock cost. Do not subtract both twice.',
  };
}
