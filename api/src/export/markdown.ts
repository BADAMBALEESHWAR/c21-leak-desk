import { formatInr } from '../ai/templates.js';
import type { DecisionRecord } from '../repo.js';

type Evidence = {
  dataset_source: string;
  totals: { orders: number; gross_inr: number; net_sales_inr: number; contribution_inr: number | null; negative_count: number; unknown_count: number; late_refund_count: number; partial: boolean };
  reconciliation: { orders_inr: number | null; channels_inr: number | null; products_inr: number | null; ok: boolean; statement: string };
  leaks: Array<{ label: string; count: number; lost_inr: number | null; example_ids: string[] }>;
  observed: Record<string, unknown>;
  checks: {
    check1: { value: number; expected: number | null; pass: boolean };
    check2: { orders_inr: number | null; channels_inr: number | null; products_inr: number | null; ok: boolean; attribution: string };
    check3: { unknown_orders: number; confidence: string };
  };
};

const cell = (v: unknown) => String(v ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function decisionMarkdown(d: DecisionRecord): string {
  const ev = d.evidence as unknown as Evidence;
  const a = d.assumptions;
  const t = ev.totals;
  const r = ev.reconciliation;
  const c = ev.checks;
  const lines: string[] = [];
  lines.push(`# Decision: ${d.intervention_label}`, '');
  lines.push(`Saved ${new Date(d.saved_at).toISOString()} by ${d.owner} · ${d.engine_version} · decision ${d._id}`, '');
  lines.push('Operational contribution, not statutory net profit. Built on the C21 teaching fixture and labelled synthetic rows; no claim of live revenue or production readiness.', '');

  lines.push('## Decision', '');
  lines.push(`- Intervention: ${d.intervention_label} (\`${d.intervention}\`)`);
  lines.push(`- Expected impact: ${formatInr(d.expected_delta_inr)} per period, confidence ${d.confidence}`);
  lines.push(`- 30-day test: ${d.test_30d}`);
  lines.push(`- Stop rule: ${d.stop_rule}`);
  lines.push(`- Owner: ${d.owner}`);
  const ci = d.check_in_30_days;
  if (ci) {
    const fmt = (v: number | null) => (v === null ? '—' : ci.unit === 'inr' ? formatInr(v) : `${v}%`);
    lines.push(`- 30-day check-in (${ci.date}): ${ci.metric_label} ${ci.direction === 'at_most' ? 'at most' : 'at least'} ${fmt(ci.target_value)} (now ${fmt(ci.baseline_value)})`);
  }
  lines.push('');

  lines.push('## Assumptions (scenario inputs, not observed facts)', '', '| Assumption | Value |', '|---|---|');
  for (const [k, v] of Object.entries(a)) {
    if (v !== null && typeof v === 'object') continue;
    lines.push(`| ${cell(k)} | ${cell(v)} |`);
  }
  lines.push('');

  lines.push('## Observed evidence', '', `Dataset: ${ev.dataset_source}`, '', '| Measure | Value |', '|---|---|');
  lines.push(`| Orders in period | ${t.orders} |`);
  lines.push(`| Gross sales | ${formatInr(t.gross_inr)} |`);
  lines.push(`| Net sales | ${formatInr(t.net_sales_inr)} |`);
  lines.push(`| Contribution | ${formatInr(t.contribution_inr)}${t.partial ? ` (partial, ${t.unknown_count} unknown)` : ''} |`);
  lines.push(`| Negative-contribution orders | ${t.negative_count} |`);
  lines.push(`| Late refunds excluded | ${t.late_refund_count} |`);
  for (const [k, v] of Object.entries(ev.observed)) {
    if (typeof v === 'number') lines.push(`| Observed ${cell(k)} | ${cell(v)} |`);
  }
  lines.push('', `Reconciliation: Σ orders ${formatInr(r.orders_inr)} = Σ channels ${formatInr(r.channels_inr)} = Σ products ${formatInr(r.products_inr)} ${r.ok ? '✓' : `✗ ${r.statement}`}`, '');

  if (ev.leaks.length) {
    lines.push('### Leaks', '', '| Cause | Orders | Lost | Examples |', '|---|---|---|---|');
    for (const l of ev.leaks) lines.push(`| ${cell(l.label)} | ${l.count} | ${formatInr(l.lost_inr)} | ${l.example_ids.join(', ')} |`);
    lines.push('');
  }

  lines.push('## Public checks', '');
  lines.push(`1. Worked order contribution: ${formatInr(c.check1.value)} (expected ${formatInr(c.check1.expected)}) — ${c.check1.pass ? 'pass' : 'fail'}`);
  lines.push(`2. Σ orders = Σ channels = Σ products: ${formatInr(c.check2.orders_inr)} = ${formatInr(c.check2.channels_inr)} = ${formatInr(c.check2.products_inr)} — ${c.check2.ok ? 'reconciled' : 'not reconciled'}; attribution mode ${c.check2.attribution}, ads and channel spend never both deducted`);
  lines.push(`3. Missing refund facts: ${c.check3.unknown_orders} order(s) unknown; recommendation confidence ${c.check3.confidence}`);
  lines.push('');
  return lines.join('\n');
}
