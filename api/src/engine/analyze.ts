import { describeLeak, templateNarrator } from '../ai/templates.js';
import { computeLedger, type LedgerOptions } from './ledger.js';
import { recommend, runScenario } from './scenario.js';
import type { AnalysisResult, OrderRow, ScenarioOverrides, ScenarioResult } from './types.js';

export type AnalyzeOptions = LedgerOptions;
export { DEFAULT_HANDLING_INR } from './ledger.js';

/** The full analysis the API returns: ledger, leaks, reconciliation and the baseline recommendation. */
export function analyze(rows: OrderRow[], opts: AnalyzeOptions): AnalysisResult {
  const ledger = computeLedger(rows, opts, describeLeak);
  const { recommendation, candidates } = recommend(ledger, opts, describeLeak, templateNarrator);
  const { rows: _rows, ...rest } = ledger;
  return { ...rest, recommendation, candidates };
}

export function scenarioFor(rows: OrderRow[], opts: AnalyzeOptions, overrides: ScenarioOverrides): ScenarioResult {
  return runScenario(rows, opts, overrides, describeLeak, templateNarrator);
}
