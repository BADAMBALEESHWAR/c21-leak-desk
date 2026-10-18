// Proof endpoints: the public checks with their working shown, and the check-3 mini scenario.
// Both are public (no session), so these use plain fetch. Every new field is optional: the screens say
// "not available yet" for anything an older API does not send, and never crash on it.
import type { AttributionMode, Confidence, InterventionKey, WaterfallLine } from './types';

const BASE = '/api/v1';

export class ProofError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ProofError';
    this.status = status;
  }
}

async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ProofError(0, 'The API could not be reached.');
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg = (body as { error?: { message?: unknown } } | null)?.error?.message;
    throw new ProofError(res.status, typeof msg === 'string' ? msg : `The request failed with status ${res.status}.`);
  }
  return body as T;
}

// ---- GET /checks ------------------------------------------------------------------------

export interface CheckLine {
  key: string;
  label: string;
  amount_inr: number;
  running_total_inr: number;
}

export interface CheckOutcome {
  intervention: InterventionKey | string;
  label?: string;
  expected_delta_inr: number | null;
}

export interface Check1 {
  expected: number;
  actual: number;
  six_lines: boolean;
  lines?: CheckLine[];
  pass: boolean;
}

export interface Check2 {
  allocate_total: number;
  channel_total: number;
  expected_total?: number | null;
  fixture_total: number;
  reconciled: boolean;
  never_both: boolean;
  /** [Σ orders, Σ channels, Σ products] per sample and mode. */
  sums?: Record<string, Array<number | null>>;
  /** Documented in docs/API.md; read through check2Rows(). */
  rows?: unknown;
  conflict?: { expected_status: number; actual_status: number | null; pass: boolean; code?: string; message?: string };
  channel_spend?: Record<string, number>;
  pass: boolean;
}

export interface Check3 {
  unknown_labelled: boolean;
  confidence: Confidence;
  before?: CheckOutcome;
  after_recovery_50?: CheckOutcome;
  recommendation_changed: boolean;
  assumption_control?: unknown;
  pass: boolean;
}

export interface Check4 {
  net_revenue_inr: number;
  cm1_pct: number;
  cm2_pct: number;
  cm3_pct: number;
  formulas?: unknown;
  pass: boolean;
}

export interface ProofChecks {
  check1?: Check1;
  check2?: Check2;
  check3?: Check3;
  check4?: Check4;
  all_pass?: boolean;
  engine_version?: string;
  ms?: number;
  [key: string]: unknown;
}

export const fetchChecks = () => getJson<ProofChecks>('/checks');

export interface WorkedOrder {
  contribution_inr: number;
  expected_contribution_inr: number | null;
  matches: boolean;
  lines: WaterfallLine[];
  note: string;
}

export const fetchWorkedOrder = () => getJson<WorkedOrder>('/worked-order');

// ---- GET /checks/missing-refund ---------------------------------------------------------

export interface MissingRefund {
  unknown_order: string;
  status: string;
  total_label: string;
  before: CheckOutcome;
  after: CheckOutcome;
  label: string;
  changed: boolean;
  return_rate_pct?: number;
  assumptions?: string[];
}

export const fetchMissingRefund = (returnRatePct: number) =>
  getJson<MissingRefund>(`/checks/missing-refund?return_rate_pct=${encodeURIComponent(String(returnRatePct))}`);

// ---- Readers: tolerate the shapes the contract allows --------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** All checkN entries the API sent, in order, with their pass flag. */
export function checkResults(c: ProofChecks | null): Array<{ id: string; pass: boolean }> {
  if (!c) return [];
  return Object.keys(c)
    .filter((k) => /^check\d+$/.test(k) && isObj(c[k]) && typeof (c[k] as { pass?: unknown }).pass === 'boolean')
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
    .map((k) => ({ id: k, pass: (c[k] as { pass: boolean }).pass }));
}

export type LinesSource = 'checks' | 'worked-order';

/** Check 1's six lines with a running total: from /checks when it sends them, else from /worked-order. */
export function check1Lines(c: ProofChecks | null, worked: WorkedOrder | null): { lines: CheckLine[]; source: LinesSource } | null {
  const sent = c?.check1?.lines;
  if (Array.isArray(sent) && sent.length > 0 && sent.every((l) => isObj(l) && num(l.amount_inr) !== null)) {
    let running = 0;
    const lines = sent.map((l) => {
      running += l.amount_inr;
      return { ...l, running_total_inr: num(l.running_total_inr) ?? running };
    });
    return { lines, source: 'checks' };
  }
  if (worked && Array.isArray(worked.lines) && worked.lines.length > 0) {
    let running = 0;
    const lines: CheckLine[] = [];
    for (const l of worked.lines) {
      if (l.amount_inr === null) return null;
      running += l.amount_inr;
      lines.push({ key: l.key, label: l.label, amount_inr: l.amount_inr, running_total_inr: running });
    }
    return { lines, source: 'worked-order' };
  }
  return null;
}

export type SumKey = 'orders' | 'channels' | 'products';
export const SUM_KEYS: SumKey[] = ['orders', 'channels', 'products'];
export type SampleKey = 'fixture' | 'extended';

export interface SumRow {
  key: SumKey;
  /** The API's own label, untranslated, when it sends one. */
  label: string | null;
  fixture: number | null;
  extended: number | null;
  /** Largest gap from the expected total across both samples; 0 when they reconcile. */
  difference: number | null;
}

function sumKeyOf(r: Record<string, unknown>): SumKey | null {
  const raw = [r.key, r.sum, r.level, r.group, r.label].find((v) => typeof v === 'string') as string | undefined;
  if (!raw) return null;
  if (/order/i.test(raw)) return 'orders';
  if (/channel/i.test(raw)) return 'channels';
  if (/product/i.test(raw)) return 'products';
  return null;
}

function sampleOf(r: Record<string, unknown>): SampleKey | null {
  const raw = [r.sample, r.dataset, r.source, r.data].find((v) => typeof v === 'string') as string | undefined;
  if (!raw) return null;
  if (/ext/i.test(raw)) return 'extended';
  if (/fix|sample/i.test(raw)) return 'fixture';
  return null;
}

function modeOf(r: Record<string, unknown>): AttributionMode | null {
  const raw = [r.attribution, r.mode].find((v) => typeof v === 'string') as string | undefined;
  return raw === 'allocate' || raw === 'channel' ? raw : null;
}

function amountOf(r: Record<string, unknown>): number | null {
  for (const k of ['amount_inr', 'total_inr', 'value_inr', 'sum_inr', 'contribution_inr', 'actual_inr']) {
    const v = num(r[k]);
    if (v !== null) return v;
  }
  return null;
}

/** Reads check2.rows in any of the documented layouts. */
function rowsFromApi(rows: unknown, mode: AttributionMode): SumRow[] | null {
  let list: unknown = rows;
  if (isObj(rows) && Array.isArray(rows[mode])) list = rows[mode];
  if (!Array.isArray(list)) return null;
  const items = list.filter(isObj).filter((r) => {
    const m = modeOf(r);
    return m === null || m === mode;
  });
  if (items.length === 0) return null;
  const out = new Map<SumKey, SumRow>();
  for (const r of items) {
    const key = sumKeyOf(r);
    if (!key) continue;
    const row = out.get(key) ?? { key, label: null, fixture: null, extended: null, difference: null };
    if (typeof r.label === 'string' && !row.label) row.label = r.label;
    const fx = num(r.fixture_inr) ?? num(r.fixture);
    const ex = num(r.extended_inr) ?? num(r.extended);
    if (fx !== null) row.fixture = fx;
    if (ex !== null) row.extended = ex;
    const sample = sampleOf(r);
    const amount = amountOf(r);
    if (sample && amount !== null) row[sample] = amount;
    const diff = num(r.difference_inr) ?? num(r.difference);
    if (diff !== null) row.difference = row.difference === null ? diff : Math.max(Math.abs(row.difference), Math.abs(diff));
    out.set(key, row);
  }
  const result = SUM_KEYS.map((k) => out.get(k)).filter((r): r is SumRow => Boolean(r));
  return result.length ? result : null;
}

/** Check 2 for one mode: the API's rows when present, else the older `sums` arrays. */
export function check2Rows(c2: Check2 | undefined, mode: AttributionMode): SumRow[] | null {
  if (!c2) return null;
  const fromApi = c2.rows !== undefined ? rowsFromApi(c2.rows, mode) : null;
  if (fromApi) return fromApi;
  const sums = c2.sums;
  if (!isObj(sums)) return null;
  const fx = sums[`fixture_${mode}`];
  const ex = sums[`extended_${mode}`];
  if (!Array.isArray(fx) && !Array.isArray(ex)) return null;
  const expFx = num(c2.fixture_total);
  const expEx = num(c2.expected_total) ?? num(mode === 'channel' ? c2.channel_total : c2.allocate_total);
  return SUM_KEYS.map((key, i) => {
    const f = Array.isArray(fx) ? num(fx[i]) : null;
    const e = Array.isArray(ex) ? num(ex[i]) : null;
    const gaps = [f !== null && expFx !== null ? Math.abs(f - expFx) : null, e !== null && expEx !== null ? Math.abs(e - expEx) : null].filter(
      (g): g is number => g !== null,
    );
    return { key, label: null, fixture: f, extended: e, difference: gaps.length ? Math.max(...gaps) : null };
  });
}

export interface AssumptionControl {
  values: number[];
  initial: number;
  /** Values the API names as the ones that change the recommendation. */
  changing: number[];
  /** The rate observed in the file, when the API sends it. */
  observed: number | null;
  /** The API's own sentence about the control (untranslated). */
  note: string | null;
}

/**
 * check3.assumption_control, read loosely. Current API: {min_pct, max_pct, observed_return_rate_pct,
 * default_return_rate_pct, label_changing_values_pct, note}. Older or other shapes: values/options, min/max/step, default.
 */
export function readAssumptionControl(raw: unknown): AssumptionControl | null {
  if (!isObj(raw)) return null;
  const listOf = (v: unknown) => (Array.isArray(v) ? v.map(num).filter((n): n is number => n !== null) : []);
  const changing = listOf(raw.label_changing_values_pct ?? raw.changes_recommendation ?? raw.changing_values ?? raw.changes_at);
  const observed = num(raw.observed_return_rate_pct) ?? num(raw.observed);
  const min = num(raw.min_pct) ?? num(raw.min) ?? 0;
  const max = num(raw.max_pct) ?? num(raw.max) ?? 100;
  const initial = num(raw.default_return_rate_pct) ?? num(raw.default) ?? num(raw.initial) ?? changing[0] ?? observed ?? min;
  let values = listOf(raw.values ?? raw.options);
  if (values.length === 0) {
    // The rates that flip the label, the observed rate and a few higher ones for contrast.
    values = [...changing, initial, ...(observed !== null ? [observed] : []), 30, 50].filter((v) => v >= min && v <= max);
  }
  values = Array.from(new Set([...values, initial])).sort((a, b) => a - b);
  if (values.length === 0) return null;
  return { values, initial, changing, observed, note: typeof raw.note === 'string' ? raw.note : null };
}

export interface MarginFormula {
  key: 'net_revenue' | 'cm1' | 'cm2' | 'cm3';
  text: string | null;
}

/** check4.formulas as an object keyed by metric, or an array of {key, formula}. */
export function readFormula(raw: unknown, key: MarginFormula['key']): string | null {
  const names = key === 'net_revenue' ? ['net_revenue', 'net_revenue_inr'] : [key, `${key}_pct`];
  if (isObj(raw)) {
    for (const n of names) {
      const v = raw[n];
      if (typeof v === 'string') return v;
      if (isObj(v) && typeof v.formula === 'string') return v.formula;
    }
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (isObj(item) && typeof item.key === 'string' && names.includes(item.key)) {
        const f = item.formula ?? item.text;
        if (typeof f === 'string') return f;
      }
    }
  }
  return null;
}

// ---- Analysis margins (unit economics) ------------------------------------------------------

export interface Margins {
  net_revenue_inr: number | null;
  net_product_cost_inr: number | null;
  shipping_inr: number | null;
  payment_fee_inr: number | null;
  handling_inr: number | null;
  ads_inr: number | null;
  contribution_inr: number | null;
  cm1_pct: number | null;
  cm2_pct: number | null;
  cm3_pct: number | null;
  orders_counted: number | null;
  partial: boolean;
}

/** `margins` from an analysis (or any response that carries one); null when the API does not send it yet. */
export function readMargins(source: unknown): Margins | null {
  if (!isObj(source) || !isObj(source.margins)) return null;
  const m = source.margins;
  return {
    net_revenue_inr: num(m.net_revenue_inr),
    net_product_cost_inr: num(m.net_product_cost_inr),
    shipping_inr: num(m.shipping_inr),
    payment_fee_inr: num(m.payment_fee_inr),
    handling_inr: num(m.handling_inr),
    ads_inr: num(m.ads_inr),
    contribution_inr: num(m.contribution_inr),
    cm1_pct: num(m.cm1_pct),
    cm2_pct: num(m.cm2_pct),
    cm3_pct: num(m.cm3_pct),
    orders_counted: num(m.orders_counted),
    partial: m.partial === true,
  };
}

// ---- Formatting -------------------------------------------------------------------------

/** Percent with up to two decimals (41.25%, 50%), U+2212 for negatives. */
export function formatPct2(n: number): string {
  const body = `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Math.abs(n))}%`;
  return n < 0 && Math.round(Math.abs(n) * 100) !== 0 ? `−${body}` : body;
}

/** "2026-09" → Date for the first of that month (local time). */
export function monthStart(month: string): Date {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1);
}

export function addDays(iso: string, days: number): Date | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d;
}

export function monthOf(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  return m ? `${m[1]}-${m[2]}` : null;
}
