import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { analyze, scenarioFor } from './engine/analyze.js';
import { computeWorkedOrder } from './engine/contribution.js';
import { AttributionConflict, ENGINE_VERSION } from './engine/types.js';
import { validateRows } from './engine/validate.js';
import { parseJsonText } from './ingest.js';
import { FixtureFileSchema, type SampleSource } from './schema/orders.js';
import { readSample } from './storage.js';

// The three public checks, computed live from data/ and compared with data/expected.json (Blueprint §18).

async function rowsOf(source: SampleSource) {
  const s = await readSample(source);
  return validateRows(parseJsonText(s.text, s.name).orders).rows;
}

export async function workedOrder() {
  const fx = FixtureFileSchema.parse(JSON.parse((await readSample('fixture')).text));
  if (!fx.records.worked_order) throw new Error('worked_order missing from data/C21/fixture.json');
  return computeWorkedOrder(fx.records.worked_order);
}

async function expected(): Promise<any> {
  try {
    return JSON.parse(await readFile(path.join(config.dataDir, 'expected.json'), 'utf8'));
  } catch {
    return null;
  }
}

export async function runChecks() {
  const started = Date.now();
  const exp = await expected();
  const w = await workedOrder();
  const check1 = { expected: exp?.worked_order ?? 230, actual: w.contribution_inr, six_lines: w.lines.length === 6, pass: false };
  check1.pass = check1.actual === check1.expected && check1.six_lines;

  const fixture = await rowsOf('fixture');
  const extended = await rowsOf('extended');
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
  };
  check2.pass =
    check2.reconciled &&
    neverBoth &&
    channelsMatch &&
    check2.fixture_total === (exp?.fixture.total ?? 6000) &&
    check2.allocate_total === check2.channel_total &&
    (exp ? check2.allocate_total === exp.extended.total : true);

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
  };
  check3.pass =
    check3.unknown_labelled &&
    check3.confidence === 'unknown' &&
    check3.recommendation_changed &&
    (exp ? check3.before.intervention === exp.check3.before && check3.after_recovery_50.intervention === exp.check3.after_recovery_50 : true);

  return { check1, check2, check3, all_pass: check1.pass && check2.pass && check3.pass, engine_version: ENGINE_VERSION, ms: Date.now() - started };
}
