import { EXTENSION_FIELDS, FIXTURE_FIELDS } from '../schema/orders.js';
import type { AnalysisResult } from '../engine/types.js';

// CSV in and out. An empty cell means unknown (null), the same rule the importer applies.

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const row = (values: unknown[]) => values.map(cell).join(',');

export const TEMPLATE_FIELDS = [...FIXTURE_FIELDS, ...EXTENSION_FIELDS.filter((f) => f !== 'net_product_cost_inr' && f !== 'synthetic' && f !== 'note')];

/** A ready-to-fill CSV in the C21 schema: one kept order, one return, one return whose refund is not yet known. */
export function templateCsv(): string {
  const examples: Array<Record<string, unknown>> = [
    { order_id: 'O01', date: '2026-09-02', gross_inr: 1000, discount_inr: 100, refund_inr: 0, net_sales_inr: 900, product_cost_inr: 400, recovered_product_cost_inr: 0, shipping_inr: 60, payment_fee_inr: 20, return_cost_inr: 0, returned: false, channel: 'web', product_id: 'P1', ads_inr: 100, handling_inr: 20 },
    { order_id: 'O05', date: '2026-09-06', gross_inr: 1000, discount_inr: 100, refund_inr: 900, net_sales_inr: 0, product_cost_inr: 400, recovered_product_cost_inr: 350, shipping_inr: 60, payment_fee_inr: 20, return_cost_inr: 50, returned: true, channel: 'marketplace', product_id: 'P2', ads_inr: 50, handling_inr: 20, refund_date: '2026-09-15' },
    { order_id: 'O09', date: '2026-09-10', gross_inr: 1000, discount_inr: 100, refund_inr: null, net_sales_inr: null, product_cost_inr: 400, recovered_product_cost_inr: null, shipping_inr: 60, payment_fee_inr: 20, return_cost_inr: null, returned: true, channel: 'web', product_id: 'P1', ads_inr: 50, handling_inr: 20 },
  ];
  return [row(TEMPLATE_FIELDS), ...examples.map((e) => row(TEMPLATE_FIELDS.map((f) => e[f])))].join('\r\n') + '\r\n';
}

const LEDGER_COLUMNS = [
  'order_id', 'date', 'channel', 'product_id', 'synthetic', 'returned', 'status', 'late_refund',
  'gross_inr', 'discount_inr', 'refund_inr', 'net_sales_inr', 'net_product_cost_inr', 'shipping_inr',
  'payment_fee_inr', 'return_cost_inr', 'handling_inr', 'ads_allocated_inr', 'contribution_inr',
  'recognised_contribution_inr', 'leak_cause', 'unknown_fields',
] as const;

/** Per-order ledger exactly as the engine computed it; totals rows say what was summed. */
export function ledgerCsv(a: AnalysisResult): string {
  const lines = [row([...LEDGER_COLUMNS])];
  for (const o of a.orders) {
    lines.push(
      row([
        o.order_id, o.date, o.channel, o.product_id, o.synthetic, o.returned, o.status, o.late_refund,
        o.inputs.gross, o.inputs.discount, o.late_refund ? 0 : o.inputs.refund, o.derived.net_sales, o.derived.net_product_cost,
        o.inputs.shipping, o.inputs.fee, o.late_refund ? 0 : o.inputs.return_cost, o.inputs.handling, o.derived.ads_allocated,
        o.contribution_inr, o.recognised_contribution_inr, o.leak_cause, o.unknown_fields.join(' '),
      ]),
    );
  }
  const t = a.totals;
  lines.push('');
  lines.push(row(['total_orders', t.orders]));
  lines.push(row(['net_sales_inr', t.net_sales_inr]));
  lines.push(row(['channel_spend_inr', t.channel_spend_inr]));
  lines.push(row(['contribution_inr', t.contribution_inr, t.partial ? `partial (${t.unknown_count} unknown)` : 'complete']));
  lines.push(row(['reconciliation', a.reconciliation.ok ? 'reconciled' : `gap ${a.reconciliation.gap_inr}`, `attribution ${a.attribution}`, `period_end ${a.period_end}`, `engine ${a.engine_version}`]));
  return lines.join('\r\n') + '\r\n';
}
