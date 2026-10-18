import { createHash } from 'node:crypto';
import { SchemaType, type ResponseSchema } from '@google/generative-ai';
import { parse } from 'csv-parse/sync';
import { config } from '../config.js';
import { HttpError } from '../errors.js';
import type { Ingested } from '../ingest.js';
import { logger } from '../logger.js';
import { ColumnMappingModel } from '../models/index.js';
import { SmallStore } from '../platform-store.js';
import { COLUMN_ALIASES, EXTENSION_FIELDS, FIXTURE_FIELDS, MONEY_FIELDS, NULLABLE_FIELDS, REQUIRED_FIELDS } from '../schema/orders.js';
import amazonSettlement from './profiles/amazon_settlement.json';
import flipkartOrders from './profiles/flipkart_orders.json';
import myntraOrders from './profiles/myntra_orders.json';
import razorpayPayments from './profiles/razorpay_payments.json';
import shiprocketShipments from './profiles/shiprocket_shipments.json';
import shopifyOrders from './profiles/shopify_orders.json';

// Column mapper (v2 §1.4): turns a store, marketplace, payment or courier export into C21 order rows before the usual
// validation. Order of evidence for POST /import/map: explicit profile → the account's saved mapping for these
// headers → a profile recognised from the headers → the column-alias table → the AI (headers and masked column
// shapes only, never values). A field nobody can map stays null: unknown, never zero.

export const SCHEMA_FIELDS: string[] = [...FIXTURE_FIELDS, ...EXTENSION_FIELDS].filter((f) => f !== 'synthetic');
const REQUIRED: string[] = [...REQUIRED_FIELDS];
const MONEY = new Set<string>(MONEY_FIELDS);
const DATES = new Set(['date', 'refund_date']);
/** Fields that are null when unknown; the others (channel, product_id, note) are left out instead. */
const NULLABLE_OUT = new Set<string>([...REQUIRED_FIELDS, ...NULLABLE_FIELDS, 'ads_inr', 'handling_inr', 'refund_date', 'net_product_cost_inr', 'payment_type', 'customer_id', 'units']);

export type Mapping = Record<string, string | null>;

export type TransformOp =
  | { op: 'date'; order?: 'DMY' | 'MDY' }
  | { op: 'add' | 'subtract' | 'multiply'; column: string }
  | { op: 'divide'; by: number }
  | { op: 'abs' }
  | { op: 'match'; pattern: string; flags?: string; or_present?: string[] }
  | { op: 'present'; columns?: string[] }
  | { op: 'hash' };

export interface PivotRule {
  field: string;
  when: Record<string, string>;
  abs?: boolean;
  exists?: boolean;
  default?: number | boolean | null;
}

export interface ImportProfile {
  id: string;
  label: string;
  marketplace: string;
  match_headers: string[];
  map: Record<string, string | string[] | null>;
  transforms?: Record<string, TransformOp | TransformOp[]>;
  constants?: Record<string, string | number | boolean>;
  filter?: { column: string; pattern: string };
  group_by?: string;
  sum_columns?: string[];
  pivot?: { key: string; value: string; rules: PivotRule[] };
  notes?: string[];
}

export const PROFILES = new Map<string, ImportProfile>(
  ([shopifyOrders, amazonSettlement, flipkartOrders, myntraOrders, razorpayPayments, shiprocketShipments] as unknown as ImportProfile[]).map((p) => [p.id, p]),
);

// ---- headers -------------------------------------------------------------------------------------------------------

export const normHeader = (h: string) => h.replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ');
const underscored = (h: string) => normHeader(h).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Same set of columns (any order, any case) → same signature. */
export function headerSignature(headers: string[]): string {
  return createHash('sha256').update([...new Set(headers.map(normHeader))].sort().join('\n')).digest('hex').slice(0, 24);
}

/** Finds a header by name, ignoring case and spacing; returns the header as written in the file. */
function lookup(headers: string[]): (name: string) => string | null {
  const byNorm = new Map<string, string>();
  for (const h of headers) if (!byNorm.has(normHeader(h))) byNorm.set(normHeader(h), h);
  return (name) => byNorm.get(normHeader(name)) ?? null;
}

const emptyMapping = (): Mapping => Object.fromEntries(SCHEMA_FIELDS.map((f) => [f, null]));

/** The profile's columns for these headers (first candidate present wins). */
export function resolveProfile(profile: ImportProfile, headers: string[]): Mapping {
  const find = lookup(headers);
  const mapping = emptyMapping();
  for (const [field, source] of Object.entries(profile.map)) {
    if (!(field in mapping) || source === null) continue;
    const candidates = Array.isArray(source) ? source : [source];
    mapping[field] = candidates.map(find).find((c) => c !== null) ?? null;
  }
  return mapping;
}

/** Share of the profile's tell-tale headers present; the best profile at 60 % or more wins. */
export function detectProfile(headers: string[]): { profile: ImportProfile; score: number } | null {
  const find = lookup(headers);
  let best: { profile: ImportProfile; score: number } | null = null;
  for (const profile of PROFILES.values()) {
    const score = profile.match_headers.filter((h) => find(h) !== null).length / profile.match_headers.length;
    if (score >= 0.6 && (!best || score > best.score)) best = { profile, score: Math.round(score * 100) / 100 };
  }
  return best;
}

/** Template names and the alias table (COLUMN_ALIASES): exact name 1, alias 0.9, loose spelling 0.8. */
export function aliasMapping(headers: string[]): { mapping: Mapping; confidence: Record<string, number> } {
  const mapping = emptyMapping();
  const confidence: Record<string, number> = {};
  const fields = new Set(SCHEMA_FIELDS);
  for (const h of headers) {
    const lower = normHeader(h);
    const under = underscored(h);
    const hits: Array<[string | undefined, number]> = [
      [fields.has(lower) ? lower : undefined, 1],
      [COLUMN_ALIASES[lower], 0.9],
      [fields.has(under) ? under : COLUMN_ALIASES[under], 0.8],
      [fields.has(`${under}_inr`) ? `${under}_inr` : undefined, 0.8],
    ];
    const [field, score] = hits.find(([f]) => f && fields.has(f)) ?? [undefined, 0];
    if (field && mapping[field] === null) {
      mapping[field] = h;
      confidence[field] = score;
    }
  }
  return { mapping, confidence };
}

export function unmappedRequired(mapping: Mapping, profile?: ImportProfile | null): string[] {
  const has = (f: string) => mapping[f] != null || profile?.constants?.[f] !== undefined;
  return REQUIRED.filter((f) => !has(f) && !(f === 'product_cost_inr' && has('net_product_cost_inr')));
}

// ---- masking (what the AI may see) ----------------------------------------------------------------------------------

export type SampleRow = Record<string, unknown> | unknown[];

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const BOOLISH = /^(true|false|yes|no|y|n|0|1)$/i;

function sizeWord(n: number): string {
  const a = Math.abs(n);
  if (a < 10) return 'units';
  if (a < 100) return 'tens';
  if (a < 1000) return 'hundreds';
  if (a < 100000) return 'thousands';
  if (a < 10000000) return 'lakhs';
  return 'crores';
}

function dateShape(s: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}.*)?$/.test(s)) return s.length > 10 ? 'YYYY-MM-DD hh:mm' : 'YYYY-MM-DD';
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}( .*)?$/.test(s)) return 'DD/MM/YYYY';
  if (/^\d{1,2}-\d{1,2}-\d{2,4}( .*)?$/.test(s)) return 'DD-MM-YYYY';
  if (/^\d{1,2}\.\d{1,2}\.\d{4}( .*)?$/.test(s)) return 'DD.MM.YYYY';
  if (/^\d{1,2}[- ][A-Za-z]{3,9}[- ,]+\d{2,4}/.test(s)) return 'DD Mon YYYY';
  if (/^[A-Za-z]{3,9}\.? \d{1,2},? \d{4}/.test(s)) return 'Mon DD, YYYY';
  return null;
}

export interface MaskedColumn {
  header: string;
  type: 'empty' | 'boolean' | 'number' | 'date' | 'text';
  size?: string;
  integer?: boolean;
  negative?: boolean;
  format?: string;
  length?: 'short' | 'medium' | 'long';
  shape?: 'email' | 'code' | 'words' | 'mixed';
  distinct?: 'few' | 'many';
}

/**
 * Each column described by type and range only: no value from the file is ever included. Numbers become an order of
 * magnitude (hundreds, thousands, lakhs…), dates a format, text a length band and a shape.
 */
export function maskSamples(headers: string[], rows: SampleRow[] = []): MaskedColumn[] {
  return headers.map((header, i) => {
    const values = rows
      .slice(0, 20)
      .map((r) => (Array.isArray(r) ? r[i] : (r as Record<string, unknown>)?.[header]))
      .filter((v) => !isEmpty(v))
      .map((v) => (typeof v === 'string' ? v.trim() : v));
    if (values.length === 0) return { header, type: 'empty' };
    if (values.every((v) => typeof v === 'boolean' || (typeof v === 'string' && BOOLISH.test(v)))) return { header, type: 'boolean' };
    const nums = values.map((v) => money(v));
    if (nums.every((n) => typeof n === 'number')) {
      const sorted = (nums as number[]).map(Math.abs).sort((a, b) => a - b);
      return {
        header,
        type: 'number',
        size: sizeWord(sorted[Math.floor(sorted.length / 2)]),
        integer: (nums as number[]).every(Number.isInteger),
        negative: (nums as number[]).some((n) => n < 0),
      };
    }
    const strings = values.map(String);
    const formats = strings.map(dateShape);
    if (formats.every((f) => f !== null)) return { header, type: 'date', format: formats[0]! };
    const lengths = strings.map((s) => s.length).sort((a, b) => a - b);
    const median = lengths[Math.floor(lengths.length / 2)];
    const shape = strings.every((s) => /^[^\s@]+@[^\s@]+$/.test(s))
      ? 'email'
      : strings.every((s) => /^[#A-Za-z0-9_\-/.]+$/.test(s) && /\d/.test(s))
        ? 'code'
        : strings.every((s) => /^[\p{L}\s.&'-]+$/u.test(s))
          ? 'words'
          : 'mixed';
    return {
      header,
      type: 'text',
      length: median <= 8 ? 'short' : median <= 32 ? 'medium' : 'long',
      shape,
      distinct: new Set(strings.map((s) => s.toLowerCase())).size <= Math.max(3, Math.ceil(strings.length / 4)) ? 'few' : 'many',
    };
  });
}

// ---- AI (optional) ----------------------------------------------------------------------------------------------------

/** Any model that answers JSON for (system, user, schema): Gemini via ai/grounded.ts, or a stub in tests. */
export interface MappingModel {
  model: string;
  generate(system: string, user: string, schema?: ResponseSchema): Promise<string>;
}

const FIELD_MEANING: Record<string, string> = {
  order_id: 'order number or id',
  date: 'order date',
  gross_inr: 'order value before discounts, INR',
  discount_inr: 'discount given, INR',
  refund_inr: 'amount refunded to the customer, INR',
  net_sales_inr: 'gross minus discount minus refund, INR',
  product_cost_inr: 'cost of the goods sold in the order, INR',
  recovered_product_cost_inr: 'stock value recovered from a return, INR',
  shipping_inr: 'forward shipping cost paid by the brand, INR',
  payment_fee_inr: 'payment gateway or marketplace fee, INR',
  return_cost_inr: 'reverse shipping or return handling cost, INR',
  returned: 'whether the order was returned (flag or status)',
  channel: 'sales channel',
  product_id: 'SKU or product id',
  ads_inr: 'advertising cost for the order, INR',
  handling_inr: 'packing or handling cost, INR',
  refund_date: 'date of the refund',
  net_product_cost_inr: 'product cost after recovery, INR',
  payment_type: 'payment method (COD or prepaid)',
  customer_id: 'customer identifier',
  units: 'quantity of items',
  note: 'free-text note',
};

const MAP_SYSTEM = `You match the columns of a spreadsheet export to a fixed order schema for a small Indian D2C brand.
You see only column headers and the type and size of each column, never the values.
Return {"pairs":[{"field":"<schema field>","column":"<header exactly as given>"}]} with at most one column per field.
Leave a field out unless a column clearly holds it. Never guess costs: a price the customer paid is not a cost to the brand.`;

const MAP_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    pairs: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.OBJECT, properties: { field: { type: SchemaType.STRING }, column: { type: SchemaType.STRING } }, required: ['field', 'column'] },
    },
  },
  required: ['pairs'],
};

/** The prompt the model receives: field meanings, headers and masked shapes. Exported so tests can prove no value leaks. */
export function mappingPrompt(headers: string[], masked: MaskedColumn[], fields: string[]): string {
  return JSON.stringify({ schema_fields: fields.map((f) => ({ field: f, meaning: FIELD_MEANING[f] ?? f })), columns: masked });
}

async function aiFill(model: MappingModel, headers: string[], masked: MaskedColumn[], mapping: Mapping): Promise<string[]> {
  const open = SCHEMA_FIELDS.filter((f) => mapping[f] === null);
  if (open.length === 0) return [];
  const used = new Set(Object.values(mapping).filter(Boolean));
  const raw = await Promise.race([
    model.generate(MAP_SYSTEM, mappingPrompt(headers, masked, open), MAP_SCHEMA),
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000).unref()),
  ]);
  const parsed = JSON.parse(raw) as { pairs?: Array<{ field?: unknown; column?: unknown }> };
  const find = lookup(headers);
  const added: string[] = [];
  for (const p of parsed.pairs ?? []) {
    if (typeof p.field !== 'string' || typeof p.column !== 'string' || !open.includes(p.field) || mapping[p.field] !== null) continue;
    const col = find(p.column);
    if (!col || used.has(col)) continue;
    mapping[p.field] = col;
    used.add(col);
    added.push(p.field);
  }
  return added;
}

// ---- saved mappings ------------------------------------------------------------------------------------------------

export interface SavedMapping {
  _id: string;
  account: string;
  header_signature: string;
  headers: string[];
  mapping: Mapping;
  profile: string | null;
  created_at: Date;
  updated_at: Date;
}

const savedStore = new SmallStore<SavedMapping>('column_mappings', ColumnMappingModel);

export const savedMappings = {
  get: (account: string, signature: string) => savedStore.get(`${account}:${signature}`),
  async save(account: string, signature: string, headers: string[], mapping: Mapping, profile: string | null): Promise<SavedMapping> {
    const id = `${account}:${signature}`;
    const prev = await savedStore.get(id);
    const now = new Date();
    const doc: SavedMapping = { _id: id, account, header_signature: signature, headers, mapping, profile, created_at: prev?.created_at ?? now, updated_at: now };
    await savedStore.put(doc);
    return doc;
  },
  all: (account: string) => savedStore.find({ account }, 'updated_at', 0, true),
  remove: (account: string) => savedStore.remove({ account }),
};

// ---- POST /import/map ------------------------------------------------------------------------------------------------

export type MapSource = 'profile' | 'alias' | 'ai' | 'saved';

export interface MapResult {
  profile: string | null;
  source: MapSource;
  mapping: Mapping;
  confidence: Record<string, number>;
  unmapped_required: string[];
  saved: boolean;
  header_signature: string;
  notes: string[];
}

export interface MapContext {
  account: string;
  /** Present only when AI may be used for this caller (configured, switched on, consent given). */
  model?: MappingModel | null;
  /** Called once per AI attempt, for the audit log. */
  onAi?: (info: { model: string; fields_sent: string[]; accepted: boolean; reason?: string; fields_mapped: string[] }) => void;
}

const knownProfile = (id: string) => {
  const p = PROFILES.get(id);
  if (!p) throw new HttpError(422, 'schema_invalid', `Unknown import profile "${id}".`, { path: 'profile', hint: `Use one of: ${[...PROFILES.keys()].join(', ')}.` });
  return p;
};

/** Keeps only schema fields whose column is in `headers` (as written there). */
function onlyPresent(mapping: Mapping, headers: string[]): Mapping {
  const find = lookup(headers);
  const out = emptyMapping();
  for (const f of SCHEMA_FIELDS) out[f] = typeof mapping[f] === 'string' ? find(mapping[f]!) : null;
  return out;
}

const scored = (mapping: Mapping, score: number) => Object.fromEntries(SCHEMA_FIELDS.map((f) => [f, mapping[f] !== null ? score : 0]));

export async function mapHeaders(input: { headers: string[]; sample_rows?: SampleRow[]; profile?: string | null }, ctx: MapContext): Promise<MapResult> {
  const headers = input.headers.map((h) => h.replace(/^﻿/, '').trim()).filter(Boolean);
  const header_signature = headerSignature(headers);
  const saved = await savedMappings.get(ctx.account, header_signature);
  const out = (source: MapSource, profile: ImportProfile | null, mapping: Mapping, confidence: Record<string, number>): MapResult => ({
    profile: profile?.id ?? null,
    source,
    mapping,
    confidence,
    unmapped_required: unmappedRequired(mapping, profile),
    saved: saved !== null,
    header_signature,
    notes: profile?.notes ?? [],
  });

  if (input.profile) {
    const p = knownProfile(input.profile);
    const mapping = resolveProfile(p, headers);
    return out('profile', p, mapping, scored(mapping, 1));
  }
  if (saved) {
    const p = saved.profile ? PROFILES.get(saved.profile) ?? null : null;
    const mapping = onlyPresent(saved.mapping, headers);
    return out('saved', p, mapping, scored(mapping, 1));
  }
  const detected = detectProfile(headers);
  if (detected) {
    const mapping = resolveProfile(detected.profile, headers);
    return out('profile', detected.profile, mapping, scored(mapping, detected.score));
  }
  const alias = aliasMapping(headers);
  const confidence = { ...scored(alias.mapping, 0), ...alias.confidence };
  if (ctx.model && unmappedRequired(alias.mapping).length > 0) {
    const fields_sent = ['headers', 'column_types'];
    try {
      const added = await aiFill(ctx.model, headers, maskSamples(headers, input.sample_rows), alias.mapping);
      ctx.onAi?.({ model: ctx.model.model, fields_sent, accepted: added.length > 0, fields_mapped: added });
      for (const f of added) confidence[f] = 0.6;
      if (added.length) return out('ai', null, alias.mapping, confidence);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'ai column mapping failed; aliases used');
      ctx.onAi?.({ model: ctx.model.model, fields_sent, accepted: false, reason: (err as Error).message === 'timeout' ? 'timeout' : 'error', fields_mapped: [] });
    }
  }
  return out('alias', null, alias.mapping, confidence);
}

// ---- applying a mapping to rows (POST /datasets with mapping or profile) ------------------------------------------

export interface MappingSpec {
  mapping?: Mapping;
  profile?: ImportProfile;
}

/** Reads `mapping` (object or JSON text) and `profile` from a request; null when neither was sent. */
export function readSpec(mappingRaw: unknown, profileRaw: unknown): MappingSpec | null {
  let mapping: Mapping | undefined;
  if (typeof mappingRaw === 'string' && mappingRaw.trim()) {
    try {
      mappingRaw = JSON.parse(mappingRaw);
    } catch {
      throw new HttpError(422, 'schema_invalid', 'mapping must be a JSON object of schema field to column name.', { path: 'mapping' });
    }
  }
  if (mappingRaw !== undefined && mappingRaw !== null && mappingRaw !== '') {
    if (typeof mappingRaw !== 'object' || Array.isArray(mappingRaw)) {
      throw new HttpError(422, 'schema_invalid', 'mapping must be a JSON object of schema field to column name.', { path: 'mapping' });
    }
    mapping = {};
    for (const [field, column] of Object.entries(mappingRaw as Record<string, unknown>)) {
      if (!SCHEMA_FIELDS.includes(field)) throw new HttpError(422, 'schema_invalid', `${field} is not a field of the C21 schema; map only schema fields.`, { path: `mapping.${field}` });
      if (column !== null && typeof column !== 'string') throw new HttpError(422, 'schema_invalid', 'mapping must be a JSON object of schema field to column name.', { path: `mapping.${field}` });
      mapping[field] = column === '' ? null : (column as string | null);
    }
  }
  const profile = typeof profileRaw === 'string' && profileRaw.trim() ? knownProfile(profileRaw.trim()) : undefined;
  return mapping || profile ? { mapping, profile } : null;
}

/** The columns to read: the profile's (or the template names/aliases), with the owner's confirmed mapping on top. */
export function planFor(headers: string[], spec: MappingSpec): Mapping {
  const base = spec.profile ? resolveProfile(spec.profile, headers) : aliasMapping(headers).mapping;
  const find = lookup(headers);
  for (const [field, column] of Object.entries(spec.mapping ?? {})) {
    if (column === null) {
      base[field] = null;
      continue;
    }
    const actual = find(column);
    if (!actual) throw new HttpError(422, 'schema_invalid', `${field} is mapped to "${column}", which is not a column in this file.`, { path: `mapping.${field}`, hint: 'Map the missing fields or pick a profile, then upload again.' });
    base[field] = actual;
  }
  return base;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
function ymd(y: string | number, m: string | number, d: string | number): string | null {
  let year = Number(y);
  if (year < 100) year += 2000;
  const month = Number(m);
  const day = Number(d);
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Common export date formats to YYYY-MM-DD (day first unless told otherwise); anything else is left for validation to flag. */
export function isoDate(raw: unknown, order: 'DMY' | 'MDY' = 'DMY'): unknown {
  if (isEmpty(raw)) return null;
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  const s = String(raw).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return ymd(m[1], m[2], m[3]) ?? s;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?!\d)/.exec(s);
  if (m) return (order === 'MDY' ? ymd(m[3], m[1], m[2]) : ymd(m[3], m[2], m[1])) ?? s;
  m = /^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]+(\d{2,4})/.exec(s);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return ymd(m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]) ?? s;
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return ymd(m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], m[2]) ?? s;
  return s;
}

/** "₹1,299.00", "Rs. 60", "(12.50)" → numbers; empty → null; anything else as written (validation flags it). */
export function money(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return raw;
  let s = String(raw).trim();
  if (!s || /^(null|na|n\/a|-)$/i.test(s)) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/₹|rs\.?|inr|,|\s/gi, '');
  const n = Number(s);
  return s !== '' && Number.isFinite(n) ? (negative ? -n : n) : String(raw).trim();
}

function coerce(field: string, value: unknown): unknown {
  if (isEmpty(value)) return NULLABLE_OUT.has(field) ? null : undefined;
  if (MONEY.has(field)) return money(value);
  if (DATES.has(field)) return isoDate(value);
  if (field === 'units') {
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    return Number.isFinite(n) ? n : value;
  }
  if (field === 'returned') {
    if (typeof value === 'boolean') return value;
    const s = String(value).trim();
    if (/^(true|yes|y|1|returned|rto)$/i.test(s)) return true;
    if (/^(false|no|n|0)$/i.test(s)) return false;
    return s;
  }
  return typeof value === 'string' ? value.trim() : value;
}

type Row = Record<string, unknown>;

function applyOps(ops: TransformOp[], value: unknown, row: Row, get: (r: Row, col: string) => unknown): unknown {
  let v = value;
  for (const op of ops) {
    switch (op.op) {
      case 'date':
        v = isoDate(v, op.order ?? 'DMY');
        break;
      case 'add':
      case 'subtract':
      case 'multiply': {
        const base = money(v);
        const other = money(get(row, op.column));
        if (typeof base !== 'number' || typeof other !== 'number') {
          v = base;
          break;
        }
        v = op.op === 'add' ? base + other : op.op === 'subtract' ? base - other : base * other;
        break;
      }
      case 'divide': {
        const base = money(v);
        v = typeof base === 'number' && op.by ? base / op.by : base;
        break;
      }
      case 'abs': {
        const base = money(v);
        v = typeof base === 'number' ? Math.abs(base) : base;
        break;
      }
      case 'match':
        v = new RegExp(op.pattern, op.flags ?? 'i').test(isEmpty(v) ? '' : String(v)) || (op.or_present ?? []).some((c) => !isEmpty(get(row, c)));
        break;
      case 'present':
        v = !isEmpty(v) || (op.columns ?? []).some((c) => !isEmpty(get(row, c)));
        break;
      case 'hash':
        v = isEmpty(v) ? null : `c_${createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex').slice(0, 16)}`;
        break;
    }
  }
  return v;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Schema rows from raw rows: filter, merge line items or pivot amount rows, read the mapped columns, transform, coerce. */
export function applyMapping(rows: Row[], headers: string[], spec: MappingSpec): Row[] {
  const plan = planFor(headers, spec);
  const p = spec.profile;
  const find = lookup(headers);
  const get = (r: Row, col: string) => {
    const h = find(col);
    return h ? r[h] : undefined;
  };
  const fromProfile = p ? resolveProfile(p, headers) : null;
  // A field the owner re-mapped to another column keeps no profile transform or pivot rule (it may not fit that column).
  const remapped = (field: string) => Boolean(spec.mapping && field in spec.mapping && fromProfile && fromProfile[field] !== plan[field]);
  const OPS: Record<string, TransformOp[]> = Object.fromEntries(
    SCHEMA_FIELDS.map((field) => {
      const t = remapped(field) ? undefined : p?.transforms?.[field];
      return [field, t ? (Array.isArray(t) ? t : [t]) : []];
    }),
  );

  let input = rows;
  if (p?.filter && find(p.filter.column)) {
    const re = new RegExp(p.filter.pattern, 'i');
    input = input.filter((r) => re.test(String(get(r, p.filter!.column) ?? '').trim()));
  }

  const toOrder = (row: Row, pivoted: Record<string, unknown> = {}): Row => {
    const out: Row = {};
    for (const field of SCHEMA_FIELDS) {
      let value: unknown;
      if (field in pivoted) value = pivoted[field];
      else if (p?.constants && field in p.constants) value = p.constants[field];
      else if (plan[field]) value = applyOps(OPS[field], row[plan[field]!], row, get);
      else value = null;
      const coerced = coerce(field, value);
      if (coerced !== undefined) out[field] = coerced;
    }
    return out;
  };

  if (p?.pivot) {
    const keyCol = find(p.pivot.key);
    if (!keyCol) return [];
    const groups = new Map<string, Row[]>();
    for (const r of input) {
      const key = String(r[keyCol] ?? '').trim();
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    return [...groups.values()].map((group) => {
      const pivoted: Record<string, unknown> = {};
      for (const rule of p.pivot!.rules) {
        if (remapped(rule.field)) continue;
        const hits = group.filter((r) => Object.entries(rule.when).every(([col, pat]) => new RegExp(pat, 'i').test(String(get(r, col) ?? '').trim())));
        if (rule.exists) {
          pivoted[rule.field] = hits.length > 0;
          continue;
        }
        if (hits.length === 0) {
          pivoted[rule.field] = rule.default ?? null;
          continue;
        }
        const valueCol = plan[rule.field] ?? p.pivot!.value;
        const total = hits.reduce((sum, r) => {
          const n = money(r[valueCol]);
          return typeof n === 'number' ? sum + n : sum;
        }, 0);
        pivoted[rule.field] = round2(rule.abs ? Math.abs(total) : total);
      }
      // Other fields: the first non-empty value in the order's rows (the Order line first).
      const merged: Row = {};
      for (const r of group) for (const [k, v] of Object.entries(r)) if (isEmpty(merged[k]) && !isEmpty(v)) merged[k] = v;
      return toOrder(merged, pivoted);
    });
  }

  if (p?.group_by && find(p.group_by)) {
    const groups = new Map<string, Row>();
    const sums = (p.sum_columns ?? []).map(find).filter((c): c is string => c !== null);
    for (const r of input) {
      const key = String(get(r, p.group_by) ?? '').trim();
      if (!key) continue;
      const prev = groups.get(key);
      if (!prev) {
        groups.set(key, { ...r });
        continue;
      }
      for (const [k, v] of Object.entries(r)) {
        if (sums.includes(k)) {
          const a = money(prev[k]);
          const b = money(v);
          if (typeof a === 'number' && typeof b === 'number') prev[k] = a + b;
        } else if (isEmpty(prev[k]) && !isEmpty(v)) prev[k] = v;
      }
    }
    return [...groups.values()].map((r) => toOrder(r));
  }

  return input.map((r) => toOrder(r));
}

/** Reads a delimited export as is (comma, tab or semicolon; headers untouched). */
export function parseDelimited(text: string, name?: string): { headers: string[]; rows: Row[] } {
  const it = name ?? 'The CSV';
  if (text.includes('�')) throw new HttpError(422, 'schema_invalid', `${name ?? 'The file'} is not UTF-8 text.`, { path: 'file', hint: 'Save the CSV as UTF-8 and upload again.' });
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delimiter = count('\t') > count(',') ? '\t' : count(';') > count(',') ? ';' : ',';
  const bad = firstLine.split(delimiter).map((h) => h.trim().replace(/^"|"$/g, '')).find((h) => /^(__proto__|constructor|prototype)$/i.test(h));
  if (bad) throw new HttpError(422, 'schema_invalid', `${name ? `${name}: ` : ''}"${bad}" is not an allowed column name.`, { path: bad, hint: 'Use the template column names.' });
  let headers: string[] = [];
  let rows: Row[];
  try {
    rows = parse(text, {
      columns: (h: string[]) => (headers = h.map((x) => x.replace(/^﻿/, '').trim())),
      skip_empty_lines: true,
      bom: true,
      delimiter,
      relax_column_count: true,
      relax_quotes: delimiter === '\t',
    });
  } catch (err) {
    throw new HttpError(422, 'schema_invalid', `${it} could not be read: ${(err as Error).message}`, { path: 'file', hint: 'Check the delimiter is a comma and every row has the same columns.' });
  }
  if (rows.length === 0) throw new HttpError(422, 'no_valid_rows', `${it} has a header but no orders.`, { path: 'rows' });
  return { headers, rows };
}

/** Raw rows (any shape) to an Ingested batch of schema rows, ready for validateRows. */
export function ingestMapped(rows: Row[], headers: string[], spec: MappingSpec, name = 'The file'): Ingested {
  const orders = applyMapping(rows, headers, spec);
  if (orders.length > config.maxRows) {
    throw new HttpError(413, 'file_too_large', `${name} has ${orders.length.toLocaleString('en-IN')} rows; the limit is ${config.maxRows.toLocaleString('en-IN')}.`, { hint: 'Export a shorter period.' });
  }
  if (orders.length === 0) throw new HttpError(422, 'no_valid_rows', `${name} has no orders.`, { path: 'rows', hint: 'Map the missing fields or pick a profile, then upload again.' });
  // Grouped or pivoted rows no longer match file lines one to one; line numbers then count orders.
  const regrouped = Boolean(spec.profile?.pivot || spec.profile?.group_by);
  return { orders, path_prefix: 'rows', line_offset: regrouped ? 0 : 1 };
}

/** Headers of JSON rows: every key, in first-seen order. */
export function headersOf(rows: Row[]): string[] {
  const seen = new Set<string>();
  for (const r of rows.slice(0, 1000)) if (r && typeof r === 'object' && !Array.isArray(r)) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

export const profileSummaries = () =>
  [...PROFILES.values()].map((p) => ({
    id: p.id,
    label: p.label,
    marketplace: p.marketplace,
    fields_mapped: [...Object.entries(p.map).filter(([, v]) => v !== null).map(([k]) => k), ...Object.keys(p.constants ?? {})],
    notes: p.notes ?? [],
  }));
