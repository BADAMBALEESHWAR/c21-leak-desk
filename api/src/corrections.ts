import { z } from 'zod';
import type { ValidationFlag } from './engine/types.js';
import { validateRows, type SourceFile } from './engine/validate.js';
import { HttpError } from './errors.js';
import { newId, type Correction, type DatasetRecord, type RejectedRow } from './repo.js';
import { EXTENSION_FIELDS, FIXTURE_FIELDS, OrderRowSchema, SCHEMA_VERSION } from './schema/orders.js';

// Fixing a flagged row: apply the owner's change, re-run the same validation (validateRows, no new rules) over every
// kept and rejected row, and save the result as a new dataset version. The old version is never modified.

export const MAX_REJECTED_ROWS = 1000;

/** The raw rows a validation rejected, located by line (and file when several were merged); at most 1,000. */
export function rejectedRowsOf(flags: ValidationFlag[], orders: unknown[], opts: { line_offset: number; files?: SourceFile[] }): RejectedRow[] {
  const out: RejectedRow[] = [];
  for (const f of flags) {
    if (f.action !== 'rejected' || out.length >= MAX_REJECTED_ROWS) continue;
    const file = f.file ? opts.files?.find((x) => x.name === f.file) : undefined;
    const index = file ? file.start + f.line - 1 - file.line_offset : f.line - 1 - opts.line_offset;
    if (index < 0 || index >= orders.length) continue;
    out.push({ line: f.line, ...(f.file ? { file: f.file } : {}), order_id: f.order_id, raw: orders[index] });
  }
  return out;
}

const EDITABLE = new Set<string>([...FIXTURE_FIELDS, ...EXTENSION_FIELDS].filter((f) => f !== 'order_id'));

export const CorrectionRequestSchema = z
  .object({
    order_id: z.string().trim().min(1).optional(),
    line: z.number().int().positive().optional(),
    file: z.string().min(1).optional(),
    changes: z.record(z.string(), z.unknown()).refine((c) => Object.keys(c).length > 0, 'name at least one field to change'),
    note: z.string().max(500).optional(),
  })
  .refine((b) => b.order_id !== undefined || b.line !== undefined, { message: 'give order_id, or line for a rejected row without one', path: ['order_id'] });

export type CorrectionRequest = z.infer<typeof CorrectionRequestSchema>;

interface Entry {
  raw: Record<string, unknown>;
  line: number | null;
  file?: string;
}

const shape = OrderRowSchema.shape as Record<string, z.ZodTypeAny>;

/** Each changed field on its own: a known, editable field with a value the schema accepts. Throws 422 otherwise. */
function checkChanges(changes: Record<string, unknown>) {
  for (const [field, value] of Object.entries(changes)) {
    if (field === 'order_id') throw new HttpError(422, 'schema_invalid', 'order_id cannot be changed; correct the other fields.', { path: 'changes.order_id' });
    if (!EDITABLE.has(field)) throw new HttpError(422, 'schema_invalid', `${field} is not a field of the C21 schema.`, { path: `changes.${field}` });
    const r = shape[field].safeParse(value);
    if (!r.success) {
      const msg = r.error.issues[0]?.message ?? 'is not valid';
      throw new HttpError(422, 'schema_invalid', `${field} ${msg}.`, { path: `changes.${field}`, hint: 'Nothing was saved. Send a valid value.' });
    }
  }
}

export interface CorrectionResult {
  record: DatasetRecord;
  added: Correction[];
  still_flagged: ValidationFlag[];
}

/** Builds the corrected new version of `d` (not saved). */
export function correctDataset(d: DatasetRecord, body: CorrectionRequest, by: string): CorrectionResult {
  checkChanges(body.changes);

  // Lines for kept rows come from their earlier flags, when they had any.
  const keptLine = new Map<string, { line: number; file?: string }>();
  for (const f of d.flags) if (f.order_id && !keptLine.has(f.order_id)) keptLine.set(f.order_id, { line: f.line, ...(f.file ? { file: f.file } : {}) });

  const entries: Entry[] = [
    ...d.rows.map((r) => ({ raw: { ...r } as Record<string, unknown>, line: keptLine.get(r.order_id)?.line ?? null, file: keptLine.get(r.order_id)?.file })),
    ...(d.rejected_rows ?? []).map((r) => ({
      raw: (r.raw && typeof r.raw === 'object' && !Array.isArray(r.raw) ? { ...(r.raw as Record<string, unknown>) } : { value: r.raw }) as Record<string, unknown>,
      line: r.line,
      file: r.file,
    })),
  ];

  // Target: a kept row by order_id, else a rejected row by order_id, else a rejected row by line (and file).
  const keptCount = d.rows.length;
  let target = body.order_id ? d.rows.findIndex((r) => r.order_id === body.order_id) : -1;
  if (target < 0 && body.order_id) {
    const i = (d.rejected_rows ?? []).findIndex((r) => r.order_id === body.order_id);
    if (i >= 0) target = keptCount + i;
  }
  if (target < 0 && body.line !== undefined) {
    const i = (d.rejected_rows ?? []).findIndex((r) => r.line === body.line && (body.file === undefined || r.file === body.file));
    if (i >= 0) target = keptCount + i;
  }
  if (target < 0) {
    const what = body.order_id ? `Order ${body.order_id}` : `Rejected row on line ${body.line}${body.file ? ` of ${body.file}` : ''}`;
    throw new HttpError(404, 'not_found', `${what} was not found in dataset ${d._id}.`, { hint: 'Use an order_id from the dataset, or the line of a rejected row.' });
  }

  const entry = entries[target];
  const at = new Date().toISOString();
  const orderId = typeof entry.raw.order_id === 'string' ? entry.raw.order_id : entry.raw.order_id == null ? null : String(entry.raw.order_id);
  const added: Correction[] = Object.entries(body.changes).map(([field, to]) => ({
    order_id: orderId,
    line: entry.line,
    ...(entry.file ? { file: entry.file } : {}),
    field,
    from: entry.raw[field] === undefined ? null : entry.raw[field],
    to,
    at,
    by,
    ...(body.note ? { note: body.note } : {}),
  }));
  Object.assign(entry.raw, body.changes);
  // A corrected figure replaces a stated net sales that was derived from the old one.
  if (('refund_inr' in body.changes || 'gross_inr' in body.changes || 'discount_inr' in body.changes) && !('net_sales_inr' in body.changes)) entry.raw.net_sales_inr = null;

  const v = validateRows(
    entries.map((e) => e.raw),
    { period_end: d.period_end, path_prefix: 'rows', line_offset: 0 },
  );
  const indexOf = (f: ValidationFlag) => f.line - 1;
  const forTarget = v.flags.filter((f) => indexOf(f) === target);
  const badChange = forTarget.find((f) => f.action === 'rejected' && f.field !== undefined && f.field in body.changes);
  if (badChange) throw new HttpError(422, 'schema_invalid', badChange.detail, { path: `changes.${badChange.field}`, hint: 'Nothing was saved. Send a valid value.' });

  // Back to the original file lines.
  const relocate = (f: ValidationFlag): ValidationFlag => {
    const e = entries[indexOf(f)];
    const { file: _file, ...rest } = f;
    return { ...rest, line: e?.line ?? f.line, ...(e?.file ? { file: e.file } : {}) };
  };
  const flags = [...d.flags.filter((f) => f.action === 'dropped'), ...v.flags.map(relocate)].sort((a, b) => a.line - b.line);
  const rejected = v.flags
    .filter((f) => f.action === 'rejected')
    .slice(0, MAX_REJECTED_ROWS)
    .map((f) => {
      const e = entries[indexOf(f)];
      return { line: e.line ?? f.line, ...(e.file ? { file: e.file } : {}), order_id: f.order_id, raw: e.raw };
    });

  const record: DatasetRecord = {
    _id: newId(),
    account: by,
    source: d.source,
    rows: v.rows,
    flags,
    warnings: d.warnings,
    schema_version: SCHEMA_VERSION,
    period_end: d.period_end,
    rows_in: d.rows_in,
    rows_rejected: v.rows_rejected,
    rows_kept: v.rows.length,
    ...(d.files ? { files: d.files } : {}),
    supersedes: d._id,
    rejected_rows: rejected,
    corrections: [...(d.corrections ?? []), ...added],
    created_at: new Date(),
  };
  return { record, added, still_flagged: forTarget.map(relocate) };
}

export const correctedOrderIds = (corrections: Correction[] | undefined) => [...new Set((corrections ?? []).map((c) => c.order_id).filter((x): x is string => x !== null))];
