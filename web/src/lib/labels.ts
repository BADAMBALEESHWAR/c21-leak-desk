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

/** Judge drills: a short tag and its tone for each negative-test sample. */
export const DRILL_TAGS: Record<string, { tag: string; tone: 'primary' | 'warning' | 'danger' | 'teal' }> = {
  duplicate_order: { tag: 'Duplicate', tone: 'primary' },
  late_refund: { tag: 'Late refund', tone: 'warning' },
  null_refund: { tag: 'Unknown', tone: 'warning' },
  missing_fee: { tag: 'Unknown', tone: 'warning' },
  refund_over_gross: { tag: 'Invalid', tone: 'danger' },
  recovery_400: { tag: 'Recovery', tone: 'teal' },
  bad_schema: { tag: 'Schema', tone: 'danger' },
};
