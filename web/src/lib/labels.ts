import type { LeakCause, LineSource, OrderResult, OverrideKey } from '../api/types';
import { i18n } from '../i18n';

/** A label as its translation key and its English text. */
interface Label {
  key: string;
  label: string;
}

/**
 * A lookup table read in the current UI language: every `TABLE[k]` calls i18n.t at that moment, so a language
 * switch shows on the next render and call sites stay plain lookups. Unknown keys read as undefined.
 */
function translatedTable<K extends string>(entries: Record<K, Label>): Readonly<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const k of Object.keys(entries) as K[]) {
    const { key, label } = entries[k];
    Object.defineProperty(out, k, { enumerable: true, get: () => i18n.t(key, label) });
  }
  return Object.freeze(out);
}

/** Same wording as the engine's leak labels, for places that only have the cause key. */
export const LEAK_LABELS: Readonly<Record<LeakCause, string>> = translatedTable<LeakCause>({
  refund_unknown: { key: 'focus.cause.refund_unknown', label: 'Refund without recovery fact (unknown)' },
  full_return_partial_recovery: { key: 'focus.cause.full_return_partial_recovery', label: 'Full return, partial recovery' },
  discount_exceeds_margin: { key: 'focus.cause.discount_exceeds_margin', label: 'Discount deeper than margin' },
  fees_exceed_margin: { key: 'focus.cause.fees_exceed_margin', label: 'Shipping and fees exceed margin' },
  other_negative: { key: 'focus.cause.other_negative', label: 'Returned, costs not recovered' },
});

type TaggedSource = Extract<LineSource, 'derived' | 'config_default' | 'not_supplied' | 'moved_to_channel' | 'not_recognised'>;
export const SOURCE_TAG: Readonly<Partial<Record<LineSource, string>>> = translatedTable<TaggedSource>({
  derived: { key: 'labels.source.derived', label: 'derived' },
  config_default: { key: 'labels.source.config_default', label: 'config default' },
  not_supplied: { key: 'labels.source.not_supplied', label: 'not in source' },
  moved_to_channel: { key: 'labels.source.moved_to_channel', label: 'moved to channel' },
  not_recognised: { key: 'labels.source.not_recognised', label: 'not recognised' },
});

type OverrideLabelKey = OverrideKey | 'assume_unknown_refund';
const OVERRIDE_ENTRIES: Record<OverrideLabelKey, Label> = {
  return_rate_pct: { key: 'labels.override.return_rate_pct', label: 'Return rate' },
  recovery_pct: { key: 'labels.override.recovery_pct', label: 'Recovery of product cost on returns' },
  shipping_inr: { key: 'labels.override.shipping_inr', label: 'Shipping per order' },
  refund_policy: { key: 'labels.override.refund_policy', label: 'Refund policy' },
  ads_per_order: { key: 'labels.override.ads_per_order', label: 'Ads per order' },
  assume_unknown_refund: { key: 'labels.override.assume_unknown_refund', label: 'Assume unknown refunds' },
};
/** The scenario's assumptions, in the UI language. */
export const OVERRIDE_LABELS: Readonly<Record<OverrideLabelKey, string>> = translatedTable(OVERRIDE_ENTRIES);
/** The same names in English, for what is sent to the API and kept in the decision record. */
export const OVERRIDE_LABELS_EN: Readonly<Record<OverrideLabelKey, string>> = Object.freeze(
  Object.fromEntries((Object.keys(OVERRIDE_ENTRIES) as OverrideLabelKey[]).map((k) => [k, OVERRIDE_ENTRIES[k].label])) as Record<OverrideLabelKey, string>,
);

/** The engine's own wording (it also appears in the analysis labels); shown translated through ATTRIBUTION_LABEL_KEY. */
export const ATTRIBUTION_LABEL = 'Attribution is allocation, not causation.';
export const ATTRIBUTION_LABEL_KEY = 'attribution.label';

/** Shown beside every ads value and channel-spend line (translated at the call site with this key). */
export const ALLOCATED_KEY = 'attribution.allocated';
export const ALLOCATED_EN = 'allocated, not caused';
/** The attribution toggle's tooltip. */
export const ATTRIBUTION_TIP_KEY = 'attribution.tip';
export const ATTRIBUTION_TIP_EN =
  'Attribution is allocation, not causation. Ads and channel spend are allocated, not caused: moving them between orders or channels never changes the total.';

/**
 * A full return (refund equals revenue after discount) where only part of the product cost came back to stock.
 * Same test as the engine's leak cause, read from the order's inputs when the cause is not set.
 */
export function fullReturnPartialRecovery(o: OrderResult): { recovered: number; cost: number } | null {
  const { product_cost: cost, recovered, refund, gross, discount } = o.inputs;
  // A late refund is a kept order in its period; it is shown as pending instead.
  if (!o.returned || o.late_refund || cost === null || recovered === null || refund === null) return null;
  if (o.leak_cause !== 'full_return_partial_recovery' && (refund !== gross - discount || recovered >= cost)) return null;
  return { recovered, cost };
}

/** Sample sources are demo data; uploads start with "upload:". */
export function isUploadSource(source: string | undefined | null): boolean {
  return typeof source === 'string' && source.startsWith('upload:');
}

/**
 * True only when the handling estimate was applied: a default above zero and at least one row without handling_inr.
 * The engine adds "Handling ₹… per order where the row has none (estimate)." to the labels in exactly that case.
 */
export function handlingEstimateUsed(a: { config: { handling_default_inr: number }; labels: string[] }): boolean {
  return a.config.handling_default_inr > 0 && a.labels.some((l) => l.startsWith('Handling') && l.includes('(estimate)'));
}

export const INTERVENTION_LABELS: Readonly<Record<string, string>> = translatedTable({
  raise_recovery_via_inspection: { key: 'labels.intervention.raise_recovery_via_inspection', label: 'Raise recovery via inspection' },
  charge_return_shipping: { key: 'labels.intervention.charge_return_shipping', label: 'Charge return shipping' },
  cap_discount: { key: 'labels.intervention.cap_discount', label: 'Cap discount' },
  add_handling_to_price: { key: 'labels.intervention.add_handling_to_price', label: 'Add handling to price' },
  none: { key: 'labels.intervention.none', label: 'No change' },
});

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
  bad_values: { tag: 'Invalid', key: 'status.invalid', tone: 'danger' },
};

/** Plain names for the built-in samples. */
export const SAMPLE_NAMES: Readonly<Record<string, string>> = translatedTable({
  fixture: { key: 'labels.sample.fixture', label: 'Sample orders' },
  extended: { key: 'labels.sample.extended', label: 'Extended sample' },
  demo_12m: { key: 'labels.sample.demo_12m', label: '12-month demo' },
});

/** What people call a dataset: the sample's name, or the uploaded file names ("aug.csv + sep.csv", "aug.csv + 4 more files"). */
export function datasetName(source: string | undefined, files?: Array<{ name: string }> | null, label?: string): string {
  if (!source) return i18n.t('labels.dataset', 'Dataset');
  if (SAMPLE_NAMES[source]) return SAMPLE_NAMES[source];
  if (files && files.length > 0) {
    const names = files.map((f) => f.name);
    // Three files or more, so always two or more "more files".
    return names.length <= 2 ? names.join(' + ') : i18n.t('labels.moreFiles', '{{first}} + {{n}} more files', { first: names[0], n: names.length - 1 });
  }
  if (source.startsWith('upload:')) return source.slice('upload:'.length) || i18n.t('labels.upload', 'Upload');
  return label ?? source.replace(/_/g, ' ');
}
