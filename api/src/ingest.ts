import { parse } from 'csv-parse/sync';
import { config } from './config.js';
import { HttpError, zodIssues } from './errors.js';
import { COLUMN_ALIASES, FixtureFileSchema, MONEY_FIELDS, REQUIRED_FIELDS } from './schema/orders.js';

export interface Ingested {
  orders: unknown[];
  path_prefix: string;
  line_offset: number;
}

const MONEY = new Set<string>(MONEY_FIELDS);
const BOOL = new Set(['returned', 'synthetic']);

function coerceCsvValue(key: string, raw: string): unknown {
  const v = raw.trim();
  if (v === '' || v.toLowerCase() === 'null') return null;
  if (MONEY.has(key)) {
    const n = Number(v.replace(/[₹,\s]/g, ''));
    return Number.isFinite(n) ? n : v;
  }
  if (BOOL.has(key)) {
    if (/^(true|1|yes)$/i.test(v)) return true;
    if (/^(false|0|no)$/i.test(v)) return false;
    return v;
  }
  return v;
}

const canonical = (h: string) => COLUMN_ALIASES[h.trim().toLowerCase()] ?? h.trim();

export function parseCsv(text: string): Ingested {
  if (text.includes('�')) {
    throw new HttpError(422, 'schema_invalid', 'The file is not UTF-8 text.', { path: 'file', hint: 'Save the CSV as UTF-8 and upload again.' });
  }
  // Header names become object keys: refuse prototype keys outright (defence in depth beyond csv-parse).
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const bad = firstLine.split(',').map((h) => h.trim().replace(/^"|"$/g, '')).find((h) => /^(__proto__|constructor|prototype)$/i.test(h));
  if (bad) {
    throw new HttpError(422, 'schema_invalid', `"${bad}" is not an allowed column name.`, { path: bad, hint: 'Use the C21 column names.' });
  }
  let records: Record<string, string>[];
  try {
    records = parse(text, { columns: (h: string[]) => h.map(canonical), skip_empty_lines: true, bom: true });
  } catch (err) {
    throw new HttpError(422, 'schema_invalid', `The CSV could not be read: ${(err as Error).message}`, { path: 'file', hint: 'Check the delimiter is a comma and every row has the same columns.' });
  }
  if (records.length === 0) throw new HttpError(422, 'no_valid_rows', 'The CSV has a header but no orders.', { path: 'rows' });
  // V1 at file level: a required column absent from the header rejects the file with its name.
  const header = Object.keys(records[0]);
  const missing = REQUIRED_FIELDS.filter((f) => !header.includes(f));
  if (missing.length) {
    throw new HttpError(422, 'schema_invalid', `${missing[0]} is missing from the CSV header.`, {
      path: missing[0],
      hint: `Add the column${missing.length > 1 ? 's' : ''} ${missing.join(', ')} in the C21 schema.`,
      issues: missing.map((m) => ({ path: m, message: 'column is missing' })),
    });
  }
  const orders = records.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, coerceCsvValue(k, v)])));
  return checkSize({ orders, path_prefix: 'rows', line_offset: 1 });
}

/** Accepts the fixture file shape ({records:{orders}}) or a bare array of orders. */
export function parseJsonPayload(body: unknown): Ingested {
  if (Array.isArray(body)) return checkSize({ orders: body, path_prefix: 'orders', line_offset: 0 });
  const parsed = FixtureFileSchema.safeParse(body);
  if (!parsed.success) {
    const issues = zodIssues(parsed.error);
    throw new HttpError(422, 'schema_invalid', `The file does not match the C21 schema: ${issues[0].path} ${issues[0].message}.`, {
      path: issues[0].path,
      issues,
      hint: 'Use {"records":{"orders":[...]}} as in data/C21/fixture.json, or an array of orders.',
    });
  }
  return checkSize({ orders: parsed.data.records.orders, path_prefix: 'records.orders', line_offset: 0 });
}

export function parseJsonText(text: string, name = 'The file'): Ingested {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(422, 'schema_invalid', `${name} is not valid JSON.`, { path: 'file', hint: 'Check the file is UTF-8 JSON.' });
  }
  return parseJsonPayload(body);
}

function checkSize(i: Ingested): Ingested {
  if (i.orders.length > config.maxRows) {
    throw new HttpError(413, 'file_too_large', `The file has ${i.orders.length.toLocaleString('en-IN')} rows; the limit is 10,000.`, { hint: 'Export a shorter period.' });
  }
  if (i.orders.length === 0) throw new HttpError(422, 'no_valid_rows', 'The file has no orders.', { path: i.path_prefix });
  return i;
}
