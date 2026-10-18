import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { config } from './config.js';
import { analyze, scenarioFor } from './engine/analyze.js';
import { computeOrder, computeWorkedOrder } from './engine/contribution.js';
import { computeMargins, MARGIN_FORMULAS, netMarginPct, type Margins } from './engine/margins.js';
import { AttributionConflict, ENGINE_VERSION, type AnalysisResult, type OrderRow, type Recommendation, type Totals } from './engine/types.js';
import { validateRows } from './engine/validate.js';
import { errorResponse } from './errors.js';
import { parseJsonText } from './ingest.js';
import { runAnalysisRequest } from './routes/analyses.js';
import { FixtureFileSchema, type SampleSource, type WorkedOrder } from './schema/orders.js';
import { readSample } from './storage.js';

// The public checks, computed live from data/ and compared with data/expected.json (Blueprint §18).
// Checks 1–3 are the pack's; check 4 is the unit-economics margins on the worked order.

async function sampleOf(source: SampleSource): Promise<{ rows: OrderRow[]; period_end: string }> {
  const s = await readSample(source);
  const v = validateRows(parseJsonText(s.text, s.name).orders);
  return { rows: v.rows, period_end: v.period_end };
}

async function rowsOf(source: SampleSource) {
  return (await sampleOf(source)).rows;
}

async function workedOrderInput(): Promise<WorkedOrder> {
  const fx = FixtureFileSchema.parse(JSON.parse((await readSample('fixture')).text));
  if (!fx.records.worked_order) throw new Error('worked_order missing from data/C21/fixture.json');
  return fx.records.worked_order;
}

export async function workedOrder() {
  return computeWorkedOrder(await workedOrderInput());
}

async function expected(): Promise<any> {
  try {
    return JSON.parse(await readFile(path.join(config.dataDir, 'expected.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Check 1 working: each of the six lines with the running total after it (1,000 → 800 → 400 → 350 → 250 → 230). */
function linesWithRunningTotal(w: Awaited<ReturnType<typeof workedOrder>>) {
  let running = 0;
  return w.lines.map((l) => {
    running += l.amount_inr ?? 0;
    return { key: l.key, label: l.label, kind: l.kind, amount_inr: l.amount_inr, running_total_inr: running, ...(l.note ? { note: l.note } : {}) };
  });
}

const SUMS = [
  { sum: 'orders', label: 'Σ orders', field: 'orders_inr' },
  { sum: 'channels', label: 'Σ channels', field: 'channels_inr' },
  { sum: 'products', label: 'Σ products', field: 'products_inr' },
] as const;

/** Check 2 working: Σ orders / Σ channels / Σ products for one dataset and mode, each against the expected total. */
function reconciliationRows(dataset: string, a: AnalysisResult, expectedTotal: number) {
  return SUMS.map((s) => {
    const total = a.reconciliation[s.field];
    const difference = total === null ? null : total - expectedTotal;
    return { dataset, attribution: a.attribution, sum: s.sum, label: s.label, total_inr: total, expected_total_inr: expectedTotal, difference_inr: difference, pass: difference === 0 };
  });
}

/** The request that would deduct ads twice: allocated ads on every order plus explicit channel spend. */
const CONFLICT_BODY = { attribution: 'allocate', channel_spend: { web: 250 } } as const;

/** Check 2 conflict row: runs the POST /datasets/:id/analyses handler logic in-process and records the HTTP status it maps to. */
function conflictRow(extended: { rows: OrderRow[]; period_end: string }) {
  let actual = 201;
  let code: string | null = null;
  let message: string | null = null;
  try {
    runAnalysisRequest(extended.rows, extended.period_end, CONFLICT_BODY);
  } catch (err) {
    const r = errorResponse(err);
    actual = r?.status ?? 500;
    code = r?.code ?? 'internal';
    message = r?.message ?? (err as Error).message;
  }
  return {
    label: 'Ads deducted in both modes → AttributionConflict (expected failure)',
    dataset: 'extended',
    request: { method: 'POST', path: '/api/v1/datasets/:id/analyses', body: CONFLICT_BODY },
    expected_status: 409,
    actual_status: actual,
    code,
    message,
    pass: actual === 409 && code === 'attribution_conflict',
  };
}

// ---- Check 3 control: the missing-refund drill with one assumption, "assume returns X%". ----

const MISSING_REFUND_ORDER = 'O05';
const totalLabel = (t: Totals) => (t.unknown_count > 0 ? `partial (${t.unknown_count} unknown)` : 'complete');
const recSummary = (r: Pick<Recommendation, 'intervention' | 'label' | 'expected_delta_inr' | 'confidence'>) => ({
  intervention: r.intervention,
  label: r.label,
  expected_delta_inr: r.expected_delta_inr,
  confidence: r.confidence,
});

/** The null_refund drill with exactly one override, return_rate_pct = x (the scenario machinery, unchanged). */
export async function missingRefund(x: number) {
  const rows = await rowsOf('null_refund');
  const opts = { attribution: 'allocate' as const };
  const base = analyze(rows, opts);
  const unknown = base.orders.find((o) => o.order_id === MISSING_REFUND_ORDER);
  const s = scenarioFor(rows, opts, { return_rate_pct: x });
  const before = recSummary(base.recommendation);
  const after = recSummary(s.recommendation);
  return {
    dataset: 'null_refund',
    unknown_order: MISSING_REFUND_ORDER,
    status: unknown?.status ?? null,
    contribution_inr: unknown?.contribution_inr ?? null,
    total_inr: base.totals.contribution_inr,
    total_label: totalLabel(base.totals),
    observed_return_rate_pct: base.observed.return_rate_pct,
    return_rate_pct: x,
    label: `Scenario: assumes ${x}% returns`,
    before,
    after,
    changed: before.intervention !== after.intervention,
    scenario_total_inr: s.scenario.contribution_inr,
    scenario_unknown: s.scenario.unknown,
    assumptions: s.assumptions,
    engine_version: ENGINE_VERSION,
  };
}

/** Whole-percent return rates (0–100) whose recommendation label differs from the baseline's. Computed once per process. */
let sweep: Promise<number[]> | null = null;
export function labelChangingReturnRates(): Promise<number[]> {
  sweep ??= (async () => {
    const rows = await rowsOf('null_refund');
    const opts = { attribution: 'allocate' as const };
    const before = analyze(rows, opts).recommendation.intervention;
    const out: number[] = [];
    for (let x = 0; x <= 100; x++) if (scenarioFor(rows, opts, { return_rate_pct: x }).recommendation.intervention !== before) out.push(x);
    return out;
  })().catch((err) => {
    sweep = null;
    throw err;
  });
  return sweep;
}

const ranges = (xs: number[]) =>
  xs.reduce<Array<{ from_pct: number; to_pct: number }>>((acc, x) => {
    const last = acc[acc.length - 1];
    if (last && x === last.to_pct + 1) last.to_pct = x;
    else acc.push({ from_pct: x, to_pct: x });
    return acc;
  }, []);

export const MissingRefundQuerySchema = z.object({
  return_rate_pct: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : Number(v)),
    z.number({ invalid_type_error: 'must be a number from 0 to 100' }).finite('must be a number from 0 to 100').min(0, 'must be between 0 and 100').max(100, 'must be between 0 and 100').optional(),
  ),
});

/** What the checks screen needs for its "assume returns X%" control, with the result at the default value. */
export async function assumptionControl() {
  const changing = await labelChangingReturnRates();
  const example = await missingRefund(changing[0] ?? 20);
  return {
    endpoint: '/api/v1/checks/missing-refund?return_rate_pct=X',
    parameter: 'return_rate_pct',
    min_pct: 0,
    max_pct: 100,
    observed_return_rate_pct: example.observed_return_rate_pct,
    default_return_rate_pct: example.return_rate_pct,
    label_changing_values_pct: changing,
    label_changing_ranges: ranges(changing),
    note: changing.length
      ? `The recommendation label changes for return rates ${ranges(changing).map((r) => (r.from_pct === r.to_pct ? `${r.from_pct}%` : `${r.from_pct}–${r.to_pct}%`)).join(', ')}; at other rates only the amount and confidence change.`
      : 'No return rate from 0% to 100% changes the recommendation label; only the amount and confidence change.',
    at_default: example,
  };
}

// ---- Check 4: unit economics on the worked order. ----

/** The work order's reference values for the worked order (A2). */
export const WORKED_ORDER_MARGINS = { net_revenue_inr: 800, cm1_pct: 50, cm2_pct: 41.25, cm3_pct: 28.75 } as const;

/** The worked order as an order row (net product cost supplied, no payment-fee line, so fee 0), computed by the engine. */
function workedOrderRow(w: WorkedOrder): OrderRow {
  return {
    order_id: 'WORKED',
    date: '2026-09-30',
    gross_inr: w.revenue_inr,
    discount_inr: 0,
    refund_inr: w.refund_inr,
    net_sales_inr: null,
    product_cost_inr: null,
    net_product_cost_inr: w.net_product_cost_inr,
    recovered_product_cost_inr: null,
    shipping_inr: w.shipping_inr,
    payment_fee_inr: 0,
    return_cost_inr: 0,
    returned: w.refund_inr > 0,
    handling_inr: w.handling_inr,
    ads_inr: w.ads_inr,
  };
}

const n = (v: number) => v.toLocaleString('en-IN');

export async function workedOrderMargins(): Promise<{ input: WorkedOrder; margins: Margins }> {
  const input = await workedOrderInput();
  const order = computeOrder(workedOrderRow(input), { attribution: 'allocate', handling_default_inr: 0, period_end: '9999-12-31' });
  return { input, margins: computeMargins([order], 'allocate') };
}

async function check4Of(contributionCheck1: number, exp: any) {
  const { input, margins: m } = await workedOrderMargins();
  const want = exp?.worked_order_margins ?? WORKED_ORDER_MARGINS;
  const netMargin = netMarginPct(m, 0);
  const shippingAll = m.shipping_inr + m.return_cost_inr;
  return {
    net_revenue_inr: m.net_revenue_inr,
    cm1_pct: m.cm1_pct,
    cm2_pct: m.cm2_pct,
    cm3_pct: m.cm3_pct,
    net_margin_pct_at_zero_fixed_costs: netMargin,
    contribution_inr: m.contribution_inr,
    expected: want,
    margins: m,
    formulas: MARGIN_FORMULAS,
    working: {
      net_revenue: `${n(input.revenue_inr)} − ${n(input.refund_inr)} = ${n(m.net_revenue_inr)}`,
      cm1: `(${n(m.net_revenue_inr)} − ${n(m.net_product_cost_inr)}) ÷ ${n(m.net_revenue_inr)} = ${m.cm1_pct}%`,
      cm2: `(${n(m.net_revenue_inr)} − ${n(m.net_product_cost_inr)} − ${n(shippingAll)} − ${n(m.payment_fee_inr)} − ${n(m.handling_inr)}) ÷ ${n(m.net_revenue_inr)} = ${m.cm2_pct}%`,
      cm3: `${n(m.contribution_inr ?? 0)} ÷ ${n(m.net_revenue_inr)} = ${m.cm3_pct}%`,
      net_margin: `(${n(m.contribution_inr ?? 0)} − 0) ÷ ${n(m.net_revenue_inr)} = ${netMargin}%`,
    },
    pass:
      m.net_revenue_inr === want.net_revenue_inr &&
      m.cm1_pct === want.cm1_pct &&
      m.cm2_pct === want.cm2_pct &&
      m.cm3_pct === want.cm3_pct &&
      netMargin === m.cm3_pct &&
      m.contribution_inr === contributionCheck1,
  };
}

export async function runChecks() {
  const started = Date.now();
  const exp = await expected();
  const w = await workedOrder();
  const check1 = { expected: exp?.worked_order ?? 230, actual: w.contribution_inr, six_lines: w.lines.length === 6, pass: false, lines: linesWithRunningTotal(w) };
  check1.pass = check1.actual === check1.expected && check1.six_lines;

  const fixture = await rowsOf('fixture');
  const extendedSample = await sampleOf('extended');
  const extended = extendedSample.rows;
  const fa = analyze(fixture, { attribution: 'allocate' });
  const fc = analyze(fixture, { attribution: 'channel' });
  const ea = analyze(extended, { attribution: 'allocate' });
  const ec = analyze(extended, { attribution: 'channel' });
  let neverBoth = false;
  try {
    analyze(extended, { attribution: 'allocate', channel_spend: { web: 250 } });
  } catch (err) {
    neverBoth = err instanceof AttributionConflict;
  }
  const sums = (a: ReturnType<typeof analyze>) => [a.reconciliation.orders_inr, a.reconciliation.channels_inr, a.reconciliation.products_inr];
  const channelsMatch = exp
    ? Object.entries(exp.extended.channels as Record<string, number>).every(([k, v]) => ea.groups.channel.find((g) => g.key === k)?.contribution_inr === v)
    : true;
  const fixtureTotal = exp?.fixture.total ?? 6000;
  const extendedTotal = exp?.extended.total ?? 7053;
  const conflict = conflictRow(extendedSample);
  const check2 = {
    allocate_total: ea.totals.contribution_inr,
    channel_total: ec.totals.contribution_inr,
    expected_total: exp?.extended.total ?? null,
    fixture_total: fa.totals.contribution_inr,
    reconciled: [fa, fc, ea, ec].every((a) => a.reconciliation.ok),
    never_both: neverBoth,
    sums: { fixture_allocate: sums(fa), fixture_channel: sums(fc), extended_allocate: sums(ea), extended_channel: sums(ec) },
    channel_spend: ec.channel_spend,
    pass: false,
    rows: [
      ...reconciliationRows('fixture', fa, fixtureTotal),
      ...reconciliationRows('fixture', fc, fixtureTotal),
      ...reconciliationRows('extended', ea, extendedTotal),
      ...reconciliationRows('extended', ec, extendedTotal),
    ],
    conflict,
  };
  check2.pass =
    check2.reconciled &&
    neverBoth &&
    channelsMatch &&
    check2.fixture_total === fixtureTotal &&
    check2.allocate_total === check2.channel_total &&
    (exp ? check2.allocate_total === exp.extended.total : true) &&
    conflict.pass;

  const nullRows = await rowsOf('null_refund');
  const na = analyze(nullRows, { attribution: 'allocate' });
  const o05 = na.orders.find((o) => o.order_id === 'O05');
  const after = scenarioFor(nullRows, { attribution: 'allocate' }, { recovery_pct: 50 });
  const check3 = {
    unknown_labelled: o05?.status === 'unknown' && o05.contribution_inr === null && na.totals.partial,
    confidence: na.recommendation.confidence,
    before: { intervention: na.recommendation.intervention, expected_delta_inr: na.recommendation.expected_delta_inr },
    after_recovery_50: { intervention: after.recommendation.intervention, expected_delta_inr: after.recommendation.expected_delta_inr },
    recommendation_changed: after.recommendation.intervention !== na.recommendation.intervention,
    pass: false,
    assumption_control: await assumptionControl(),
  };
  check3.pass =
    check3.unknown_labelled &&
    check3.confidence === 'unknown' &&
    check3.recommendation_changed &&
    (exp ? check3.before.intervention === exp.check3.before && check3.after_recovery_50.intervention === exp.check3.after_recovery_50 : true);

  const check4 = await check4Of(w.contribution_inr, exp);

  return {
    check1,
    check2,
    check3,
    check4,
    all_pass: check1.pass && check2.pass && check3.pass && check4.pass,
    engine_version: ENGINE_VERSION,
    ms: Date.now() - started,
  };
}
