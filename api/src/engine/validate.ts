import {
  COLUMN_ALIASES,
  EXTENSION_FIELDS,
  FIXTURE_FIELDS,
  MONEY_FIELDS,
  NULLABLE_FIELDS,
  OrderRowSchema,
  REQUIRED_FIELDS,
} from '../schema/orders.js';
import type { OrderRow, ValidationFlag, ValidationResult } from './types.js';

const KNOWN_KEYS = new Set<string>([...FIXTURE_FIELDS, ...EXTENSION_FIELDS]);
const NET_SALES_TOLERANCE_INR = 1;

export interface ValidateOptions {
  period_end?: string;
  /** Prefix for field paths, e.g. "records.orders". */
  path_prefix?: string;
  /** Added to the 1-based row number to get a file line (1 for CSV headers). */
  line_offset?: number;
  /** Several files merged into one dataset: where each file starts in the rows, so every flag names its file and line. */
  files?: SourceFile[];
  /** Order ids already saved (adding to an existing dataset): those rows are dropped as duplicates, never counted twice. */
  existing_ids?: ReadonlySet<string>;
}

export interface SourceFile {
  name: string;
  /** Index in the merged rows of this file's first order. */
  start: number;
  path_prefix: string;
  line_offset: number;
}

/** Period end: last calendar day of the month of the latest order (2026-09-30 for the fixture). */
export function defaultPeriodEnd(rows: Array<{ date: string | null }>): string {
  const dates = rows.map((r) => r.date).filter((d): d is string => typeof d === 'string').sort();
  const last = dates[dates.length - 1];
  if (!last) return new Date().toISOString().slice(0, 10);
  const [y, m] = last.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** R8: late = returned and refund_date after the period end. */
export function isLateRefund(row: Pick<OrderRow, 'returned' | 'refund_date'>, periodEnd: string): boolean {
  return row.returned === true && !!row.refund_date && row.refund_date > periodEnd;
}

/** Maps aliased keys to schema names; returns the renamed keys for a warning. */
export function applyAliases(obj: Record<string, unknown>): string[] {
  const renamed: string[] = [];
  for (const key of Object.keys(obj)) {
    const canonical = COLUMN_ALIASES[key.trim().toLowerCase()];
    if (canonical && !(canonical in obj)) {
      obj[canonical] = obj[key];
      delete obj[key];
      renamed.push(`${key} → ${canonical}`);
    }
  }
  return renamed;
}

function idOf(raw: unknown): string | null {
  if (raw && typeof raw === 'object' && 'order_id' in raw) {
    const v = (raw as Record<string, unknown>).order_id;
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
}

/** V1–V9 (Blueprint §6.4). Pure: same input, same output. */
export function validateRows(raw: unknown[], opts: ValidateOptions = {}): ValidationResult {
  const prefix = opts.path_prefix ?? 'orders';
  const offset = opts.line_offset ?? 0;
  const flags: ValidationFlag[] = [];
  const warnings = new Map<string, string>();
  const parsed: Array<{ row: OrderRow; index: number }> = [];
  let rejected = 0;
  const lineOf = (index: number) => index + 1 + offset;
  const files = opts.files?.length ? opts.files : null;
  const fileAt = (index: number) => (files ? files.reduce((hit, f) => (f.start <= index ? f : hit), files[0]) : null);
  const localLine = (index: number) => {
    const f = fileAt(index);
    return f ? index - f.start + 1 + f.line_offset : lineOf(index);
  };
  /** "line 7", or "feb.csv line 7" when files are merged. */
  const where = (index: number) => {
    const f = fileAt(index);
    return f ? `${f.name} line ${localLine(index)}` : `line ${lineOf(index)}`;
  };
  const reject = (f: Omit<ValidationFlag, 'action'>) => {
    flags.push({ ...f, action: 'rejected' });
    rejected++;
  };

  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      reject({ order_id: null, line: lineOf(index), reason: 'schema', path: `${prefix}[${index}]`, detail: `${files ? where(index) : `Line ${lineOf(index)}`} is not an order — row excluded.` });
      return;
    }
    const obj: Record<string, unknown> = { ...(item as Record<string, unknown>) };
    for (const r of applyAliases(obj)) if (!warnings.has(r)) warnings.set(r, `Column ${r}.`);
    if (typeof obj.order_id === 'number') obj.order_id = String(obj.order_id);
    const id = idOf(obj);
    const label = id ?? where(index);

    // V8: unknown keys are warned and ignored.
    for (const key of Object.keys(obj)) {
      if (!KNOWN_KEYS.has(key) && !warnings.has(key)) warnings.set(key, `Unknown field "${key}" ignored (first seen on ${label}).`);
    }

    // Integer rupees: decimals are rounded half-up and noted.
    for (const f of MONEY_FIELDS) {
      const v = obj[f];
      if (typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v)) {
        obj[f] = Math.round(v);
        if (!warnings.has(`round:${f}`)) warnings.set(`round:${f}`, `${f} had paise on ${label}; rounded to whole rupees.`);
      }
    }

    // V1: a missing nullable field is unknown; a missing required field rejects the row.
    for (const field of NULLABLE_FIELDS) if (!(field in obj)) obj[field] = null;
    const suppliesNetCost = typeof obj.net_product_cost_inr === 'number';
    if (!('product_cost_inr' in obj) || obj.product_cost_inr === null) {
      if (suppliesNetCost) obj.product_cost_inr = null;
      else {
        reject({ order_id: id, line: lineOf(index), reason: 'schema', field: 'product_cost_inr', path: `${prefix}[${index}].product_cost_inr`, detail: `product_cost_inr is missing on ${label} — row excluded.` });
        return;
      }
    }
    for (const field of REQUIRED_FIELDS) {
      if (field in obj && obj[field] !== null && obj[field] !== undefined) continue;
      if (field === 'product_cost_inr') continue;
      reject({ order_id: id, line: lineOf(index), reason: 'schema', field, path: `${prefix}[${index}].${field}`, detail: `${field} is missing on ${label} — row excluded.` });
      return;
    }

    const result = OrderRowSchema.safeParse(obj);
    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue.path.join('.');
      reject({ order_id: id, line: lineOf(index), reason: 'schema', field, path: `${prefix}[${index}].${field}`, detail: `${field || 'row'} ${issue.message} on ${label} — row excluded.` });
      return;
    }
    const row = result.data;

    // V2, V3: impossible values are invalid and excluded, never a crash.
    const invalid = (field: string, detail: string) =>
      reject({ order_id: row.order_id, line: lineOf(index), reason: 'invalid', field, path: `${prefix}[${index}].${field}`, detail });
    if (row.discount_inr > row.gross_inr) return invalid('discount_inr', `discount_inr is greater than gross_inr on ${row.order_id} — row excluded.`);
    if (row.refund_inr !== null && row.refund_inr > row.gross_inr - row.discount_inr) {
      return invalid('refund_inr', `refund_inr is greater than gross_inr − discount_inr on ${row.order_id} — row excluded.`);
    }
    if (row.product_cost_inr !== null && row.recovered_product_cost_inr !== null && row.recovered_product_cost_inr > row.product_cost_inr) {
      return invalid('recovered_product_cost_inr', `recovered_product_cost_inr is greater than product_cost_inr on ${row.order_id} — row excluded.`);
    }
    parsed.push({ row, index });
  });

  // V5 / R7: keep the first occurrence of an order_id, list later ones.
  const seen = new Map<string, number>();
  const kept: Array<{ row: OrderRow; index: number }> = [];
  for (const p of parsed) {
    if (opts.existing_ids?.has(p.row.order_id)) {
      flags.push({ order_id: p.row.order_id, line: lineOf(p.index), reason: 'duplicate', path: `${prefix}[${p.index}].order_id`, detail: `${p.row.order_id} on ${where(p.index)} is already saved — ignored.`, action: 'dropped' });
      continue;
    }
    const first = seen.get(p.row.order_id);
    if (first !== undefined) {
      flags.push({ order_id: p.row.order_id, line: lineOf(p.index), reason: 'duplicate', path: `${prefix}[${p.index}].order_id`, detail: `${p.row.order_id} appears again on ${where(p.index)} (first on ${where(first)}) — second occurrence dropped.`, action: 'dropped' });
      continue;
    }
    seen.set(p.row.order_id, p.index);
    kept.push(p);
  }

  const periodEnd = opts.period_end ?? defaultPeriodEnd(kept.map((k) => k.row));

  for (const { row, index } of kept) {
    const line = lineOf(index);
    const at = (field: string) => `${prefix}[${index}].${field}`;
    // V4
    const { gross_inr: g, discount_inr: d, refund_inr: r, net_sales_inr: ns } = row;
    if (r !== null && ns !== null && Math.abs(g - d - r - ns) > NET_SALES_TOLERANCE_INR) {
      flags.push({ order_id: row.order_id, line, reason: 'mismatch', field: 'net_sales_inr', path: at('net_sales_inr'), detail: `net_sales_inr ${ns} on ${row.order_id} differs from gross − discount − refund (${g - d - r}) by more than ₹1 — engine value used.`, action: 'kept' });
    }
    // V7
    for (const field of ['refund_inr', 'recovered_product_cost_inr', 'payment_fee_inr', 'return_cost_inr'] as const) {
      if (row[field] !== null) continue;
      if (field === 'recovered_product_cost_inr' && row.product_cost_inr === null && row.net_product_cost_inr != null) continue;
      const missing = !(field in (raw[index] as object)) && !Object.keys(raw[index] as object).some((k) => COLUMN_ALIASES[k.toLowerCase()] === field);
      flags.push({ order_id: row.order_id, line, reason: 'unknown', field, path: at(field), detail: `${field} is ${missing ? 'missing' : 'null'} on ${row.order_id} — status unknown, never zero.`, action: 'kept' });
    }
    // V6 / R8
    if (isLateRefund(row, periodEnd)) {
      flags.push({ order_id: row.order_id, line, reason: 'late_refund', field: 'refund_date', path: at('refund_date'), detail: `Refund on ${row.order_id} is dated ${row.refund_date}, after the period end ${periodEnd} — counted as kept in this period and shown as pending.`, action: 'kept' });
    }
  }

  // Flags are numbered over the merged rows; give each one its own file, line and path back.
  const locate = (list: ValidationFlag[]): ValidationFlag[] =>
    files
      ? list.map((flag) => {
          const index = flag.line - 1 - offset;
          const file = fileAt(index)!;
          const local = index - file.start;
          return { ...flag, file: file.name, line: local + 1 + file.line_offset, path: flag.path?.replace(`${prefix}[${index}]`, `${file.path_prefix}[${local}]`) };
        })
      : list;

  return {
    rows: kept.map((k) => k.row),
    rows_in: raw.length,
    rows_kept: kept.length,
    rows_rejected: rejected,
    flags: locate(flags.sort((a, b) => a.line - b.line)),
    warnings: [...warnings.values()],
    period_end: periodEnd,
  };
}
