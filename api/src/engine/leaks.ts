import type { LeakCause, LeakGroup, OrderResult, OrderRow } from './types.js';

export const LEAK_LABELS: Record<LeakCause, string> = {
  refund_unknown: 'Refund without recovery fact (unknown)',
  full_return_partial_recovery: 'Full return, partial recovery',
  discount_exceeds_margin: 'Discount deeper than margin',
  fees_exceed_margin: 'Shipping and fees exceed margin',
  other_negative: 'Returned, costs not recovered',
};

/** R10: first match wins. A leak is a negative order, or an unknown returned order. */
export function classifyLeak(row: OrderRow, o: OrderResult): LeakCause | null {
  if (o.late_refund) return null; // in-period view is a kept order; shown as pending instead
  if (row.returned && (row.refund_inr === null || row.recovered_product_cost_inr === null || row.return_cost_inr === null)) {
    return 'refund_unknown';
  }
  if (o.status !== 'ok' || (o.contribution_inr as number) >= 0) return null;
  const c = o.contribution_inr as number;
  if (
    row.returned &&
    row.refund_inr === row.gross_inr - row.discount_inr &&
    row.product_cost_inr !== null &&
    row.recovered_product_cost_inr !== null &&
    row.recovered_product_cost_inr < row.product_cost_inr
  ) {
    return 'full_return_partial_recovery';
  }
  if (!row.returned) {
    // Shortfall = costs after product cost − what net sales left; the discount explains it if it is at least as large.
    if (row.discount_inr > 0 && row.discount_inr >= -c) return 'discount_exceeds_margin';
    return 'fees_exceed_margin';
  }
  return 'other_negative';
}

export type Describe = (g: Omit<LeakGroup, 'why' | 'why_source'>, rows: OrderRow[]) => string;

export function findLeaks(rows: OrderRow[], results: OrderResult[], describe: Describe): LeakGroup[] {
  const buckets = new Map<LeakCause, { ids: string[]; rows: OrderRow[]; lost: number; unknown: boolean }>();
  results.forEach((res, i) => {
    const cause = classifyLeak(rows[i], res);
    res.leak_cause = cause;
    if (!cause) return;
    const b = buckets.get(cause) ?? { ids: [], rows: [], lost: 0, unknown: false };
    b.ids.push(res.order_id);
    b.rows.push(rows[i]);
    if (res.contribution_inr === null) b.unknown = true;
    else b.lost += -res.contribution_inr;
    buckets.set(cause, b);
  });

  const groups = [...buckets.entries()].map(([cause, b]) => {
    const base = {
      cause,
      label: LEAK_LABELS[cause],
      count: b.ids.length,
      lost_inr: b.unknown ? null : b.lost,
      order_ids: b.ids,
      example_ids: b.ids.slice(0, 3),
    };
    return { ...base, why: describe(base, b.rows), why_source: 'template' as const };
  });

  // Largest known loss first, unknown amounts last. The engine ranks; AI never does.
  return groups.sort((a, b) => {
    if (a.lost_inr === null) return 1;
    if (b.lost_inr === null) return -1;
    return b.lost_inr - a.lost_inr;
  });
}
