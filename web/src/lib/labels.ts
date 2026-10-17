import type { LeakCause, LineSource, OverrideKey } from '../api/types';

/** Same wording as the engine's leak labels, for places that only have the cause key. */
export const LEAK_LABELS: Record<LeakCause, string> = {
  refund_unknown: 'Refund without recovery fact (unknown)',
  full_return_partial_recovery: 'Full return, partial recovery',
  discount_exceeds_margin: 'Discount deeper than margin',
  fees_exceed_margin: 'Shipping and fees exceed margin',
  other_negative: 'Returned, costs not recovered',
};

export const SOURCE_TAG: Partial<Record<LineSource, string>> = {
  derived: 'derived',
  config_default: 'config default',
  not_supplied: 'not in source',
  moved_to_channel: 'moved to channel',
  not_recognised: 'not recognised',
};

export const OVERRIDE_LABELS: Record<OverrideKey | 'assume_unknown_refund', string> = {
  return_rate_pct: 'Return rate',
  recovery_pct: 'Recovery of product cost on returns',
  shipping_inr: 'Shipping per order',
  refund_policy: 'Refund policy',
  ads_per_order: 'Ads per order',
  assume_unknown_refund: 'Assume unknown refunds',
};

export const ATTRIBUTION_LABEL = 'Attribution is allocation, not causation.';

/**
 * True only when the handling estimate was applied: a default above zero and at least one row without handling_inr.
 * The engine adds "Handling ₹… per order where the row has none (estimate)." to the labels in exactly that case.
 */
export function handlingEstimateUsed(a: { config: { handling_default_inr: number }; labels: string[] }): boolean {
  return a.config.handling_default_inr > 0 && a.labels.some((l) => l.startsWith('Handling') && l.includes('(estimate)'));
}

export const INTERVENTION_LABELS: Record<string, string> = {
  raise_recovery_via_inspection: 'Raise recovery via inspection',
  charge_return_shipping: 'Charge return shipping',
  cap_discount: 'Cap discount',
  add_handling_to_price: 'Add handling to price',
  none: 'No change',
};

/** Header variants the importer maps to schema names (api/src/schema/orders.ts). */
export const HEADER_ALIASES: Array<[string, string]> = [
  ['cogs', 'product_cost_inr'],
  ['sku', 'product_id'],
  ['refund', 'refund_inr'],
  ['shipping', 'shipping_inr'],
  ['gateway_fee', 'payment_fee_inr'],
  ['order date', 'date'],
  ['net sales', 'net_sales_inr'],
  ['recovered_cost', 'recovered_product_cost_inr'],
  ['is_returned', 'returned'],
  ['ad_spend', 'ads_inr'],
  ['handling', 'handling_inr'],
];

/** Data-quality drills: a short tag (with its translation key) and its tone for each negative-test sample. */
export const DRILL_TAGS: Record<string, { tag: string; key?: string; tone: 'primary' | 'warning' | 'danger' | 'teal' }> = {
  duplicate_order: { tag: 'Duplicate', key: 'status.duplicate', tone: 'primary' },
  late_refund: { tag: 'Late refund', key: 'status.lateRefund', tone: 'warning' },
  null_refund: { tag: 'Unknown', key: 'status.unknown', tone: 'warning' },
  missing_fee: { tag: 'Unknown', key: 'status.unknown', tone: 'warning' },
  refund_over_gross: { tag: 'Invalid', key: 'status.invalid', tone: 'danger' },
  recovery_400: { tag: 'Recovery', key: 'scenario.recovery', tone: 'teal' },
  bad_schema: { tag: 'Schema', key: 'status.schema', tone: 'danger' },
};

/** Plain names for the built-in samples. */
export const SAMPLE_NAMES: Record<string, string> = {
  fixture: 'Sample orders',
  extended: 'Extended sample',
  demo_12m: '12-month demo',
};

/** What people call a dataset: the sample's name, or the uploaded file names ("aug.csv + sep.csv", "aug.csv + 4 more files"). */
export function datasetName(source: string | undefined, files?: Array<{ name: string }> | null, label?: string): string {
  if (!source) return 'Dataset';
  if (SAMPLE_NAMES[source]) return SAMPLE_NAMES[source];
  if (files && files.length > 0) {
    const names = files.map((f) => f.name);
    return names.length <= 2 ? names.join(' + ') : `${names[0]} + ${names.length - 1} more files`;
  }
  if (source.startsWith('upload:')) return source.slice('upload:'.length) || 'Upload';
  return label ?? source.replace(/_/g, ' ');
}
