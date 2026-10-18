// Engine text the API sends in English (line names, notes, validation flags, scenario notes, Pulse actions, check
// formulas), shown in the UI language. Each entry is a translation key and the engine's exact English sentence with
// {{placeholders}} for the parts that vary; a sentence that matches is rebuilt from the translation with the same values.
// English, and any text no entry matches, is shown exactly as sent.
import { i18n } from '../i18n';

/** [translation key, the engine's English text]. The English must stay identical to api/src/engine. */
export const API_TEXTS: ReadonlyArray<readonly [string, string]> = [
  // Waterfall line names (api/src/engine/contribution.ts).
  ['apiText.line.gross', 'Gross sales'],
  ['apiText.line.discount', 'Discount'],
  ['checks.line.refund', 'Refund'],
  ['checks.line.netProductCost', 'Net product cost'],
  ['checks.line.shipping', 'Shipping'],
  ['apiText.line.paymentFee', 'Payment fee'],
  ['apiText.line.returnCost', 'Return cost'],
  ['checks.line.handling', 'Handling'],
  ['checks.line.ads', 'Ads'],
  ['checks.line.revenue', 'Revenue'],
  // Line notes.
  ['apiText.note.netCost', 'Net product cost after recovery; not double-counted.'],
  ['apiText.note.netCostDetail', 'Net product cost after recovery; not double-counted. Product cost {{cost}} less recovered {{recovered}}.'],
  ['apiText.note.recoveryLate', 'Recovery not yet recognised in this period.'],
  ['apiText.note.returnCostLate', 'Return cost not yet recognised in this period.'],
  ['apiText.note.handlingDefault', 'Not in the source row; config default (estimate).'],
  ['apiText.note.adsChannel', 'Ads are deducted at the channel line in this mode.'],
  ['apiText.note.adsCounted', '{{amount}} counted once in channel spend for {{channel}}.'],
  ['apiText.note.lateRefund', 'Refund dated {{date}} is after the period end {{end}}; not recognised in this period.'],
  ['apiText.note.workedLine', 'Net product cost is after any recovered stock cost; recovery is not subtracted a second time.'],
  ['apiText.note.worked', 'Net product cost is after any recovered stock cost. Do not subtract both twice.'],
  // Leak causes (api/src/engine/leaks.ts).
  ['focus.cause.refund_unknown', 'Refund without recovery fact (unknown)'],
  ['focus.cause.full_return_partial_recovery', 'Full return, partial recovery'],
  ['focus.cause.discount_exceeds_margin', 'Discount deeper than margin'],
  ['focus.cause.fees_exceed_margin', 'Shipping and fees exceed margin'],
  ['focus.cause.other_negative', 'Returned, costs not recovered'],
  // Interventions and their rules (api/src/engine/scenario.ts).
  ['common.iv.raiseRecovery', 'Raise recovery via inspection'],
  ['common.iv.chargeReturnShipping', 'Charge return shipping'],
  ['common.iv.capDiscount', 'Cap discount'],
  ['common.iv.addHandling', 'Add handling to price'],
  ['common.iv.none', 'No change'],
  ['apiText.rule.inspect', 'Inspect returns before restocking so recovered stock reaches {{pct}}% of product cost.'],
  ['apiText.rule.returnShipping', 'Charge the customer the return shipping cost on returned orders.'],
  ['apiText.rule.capDiscount', 'Cap discounts at {{pct}}% of gross.'],
  ['apiText.rule.handling', 'Add the per-order handling cost to the product price.'],
  ['apiText.rule.none', 'No rule in the set improves contribution under these assumptions.'],
  ['apiText.scenario.missingOne', '{{n}} order has missing facts, so this is a labelled scenario, not a measured result.'],
  ['apiText.scenario.missingOther', '{{n}} orders have missing facts, so this is a labelled scenario, not a measured result.'],
  // Scenario assumption notes.
  ['apiText.scenario.assumeOne', 'Assumption: {{n}} returned order with missing facts treated as refund = gross − discount, recovered = 0, return cost = observed average {{inr}}.'],
  ['apiText.scenario.assumeOther', 'Assumption: {{n}} returned orders with missing facts treated as refund = gross − discount, recovered = 0, return cost = observed average {{inr}}.'],
  ['apiText.scenario.recovery', 'Recovered stock set to {{pct}}% of product cost on every returned order.'],
  ['apiText.scenario.shipping', 'Shipping set to {{inr}} on every order.'],
  ['apiText.scenario.refundFull', 'Returned orders refunded in full (gross − discount).'],
  ['apiText.scenario.refundPartial', 'Returned orders refunded {{pct}}% of gross − discount.'],
  ['apiText.scenario.adsChannel', 'Ads set to {{inr}} per order (channel spend = orders × value).'],
  ['apiText.scenario.ads', 'Ads set to {{inr}} per order.'],
  ['apiText.scenario.rateUpOne', 'Return rate {{pct}}%: {{n}} lowest-contribution kept order ({{ids}}) returned at {{rec}}% recovery and {{inr}} return cost.'],
  ['apiText.scenario.rateUpOther', 'Return rate {{pct}}%: {{n}} lowest-contribution kept orders ({{ids}}) returned at {{rec}}% recovery and {{inr}} return cost.'],
  ['apiText.scenario.rateDownOne', 'Return rate {{pct}}%: {{n}} returned order ({{ids}}) treated as kept.'],
  ['apiText.scenario.rateDownOther', 'Return rate {{pct}}%: {{n}} returned orders ({{ids}}) treated as kept.'],
  ['apiText.scenario.rateSame', 'Return rate {{pct}}% equals the observed rate; no orders change.'],
  // Ledger labels (api/src/engine/ledger.ts, types.ts).
  ['attribution.label', 'Attribution is allocation, not causation.'],
  ['apiText.ledger.operational', 'Operational contribution, not statutory net profit.'],
  ['ledger.note.synthetic', 'Includes labelled synthetic rows (synthetic: true); they are not observed data.'],
  ['ledger.note.handling', 'Handling {{inr}} per order where the row has none (estimate).'],
  ['ledger.note.outside_one', '{{n}} order is dated after the period end ({{end}}) and outside this period.'],
  ['ledger.note.outside_other', '{{n}} orders are dated after the period end ({{end}}) and outside this period.'],
  // Validation flags (api/src/engine/validate.ts). {{at}} is "line 5" or "aug.csv line 5".
  ['apiText.where.line', 'line {{n}}'],
  ['apiText.where.fileLine', '{{file}} line {{n}}'],
  ['apiText.flag.unknownNull', '{{field}} is null on {{id}} — status unknown, never zero.'],
  ['apiText.flag.unknownMissing', '{{field}} is missing on {{id}} — status unknown, never zero.'],
  ['apiText.flag.notOrder', 'Line {{n}} is not an order — row excluded.'],
  ['apiText.flag.notOrderAt', '{{at}} is not an order — row excluded.'],
  ['apiText.flag.missing', '{{field}} is missing on {{id}} — row excluded.'],
  ['apiText.flag.alreadySaved', '{{id}} on {{at}} is already saved — ignored.'],
  ['apiText.flag.duplicate', '{{id}} appears again on {{at}} (first on {{first}}) — second occurrence dropped.'],
  ['apiText.flag.mismatch', 'net_sales_inr {{value}} on {{id}} differs from gross − discount − refund ({{expected}}) by more than ₹1 — engine value used.'],
  ['apiText.flag.lateRefund', 'Refund on {{id}} is dated {{date}}, after the period end {{end}} — counted as kept in this period and shown as pending.'],
  ['apiText.flag.discountOverGross', 'discount_inr is greater than gross_inr on {{id}} — row excluded.'],
  ['apiText.flag.refundOverNet', 'refund_inr is greater than gross_inr − discount_inr on {{id}} — row excluded.'],
  ['apiText.flag.recoveredOverCost', 'recovered_product_cost_inr is greater than product_cost_inr on {{id}} — row excluded.'],
  // Pulse actions and product notes (api/src/engine/pulse.ts).
  ['apiText.pulse.halveTitle', 'Halve {{channel}} ad spend per order'],
  ['apiText.pulse.halveDetail', '{{channel}} brings {{n}} orders at {{inr}} contribution; its ads are {{pct}}% of its net sales. Halving ad spend per order there saves about {{save}} if the same orders still come.'],
  ['apiText.pulse.codTitle', 'Add a ₹{{fee}} COD fee'],
  ['apiText.pulse.codDetail', 'COD orders return {{x}}× as often as prepaid. A ₹{{fee}} fee on {{n}} COD orders recovers about {{inr}}, before any shift to prepaid.'],
  ['apiText.pulse.inspectTitle', 'Inspect {{product}} returns before restocking'],
  ['apiText.pulse.inspectDetail', '{{product}} is rank {{units}} on units but {{rank}} on contribution; {{pct}}% of its orders come back. Recovering {{target}}% of product cost on its returns adds about {{inr}}.'],
  ['apiText.pulse.capTitle', 'Cap discounts at {{pct}}%'],
  ['apiText.pulse.capDetail', 'Kept orders discounted above {{pct}}% of gross gave away {{inr}} more than a {{cap}}% cap allows, assuming the same orders still happen.'],
  ['apiText.pulse.smallTitle', 'Charge ₹{{charge}} shipping under ₹{{limit}}'],
  ['apiText.pulse.smallDetail', '{{n}} kept orders were under ₹{{limit}}, where shipping takes the most of each rupee. A ₹{{charge}} charge recovers about {{inr}}.'],
  ['apiText.pulse.pushNote', '{{product}} sells and earns: rank {{units}} on units, {{rank}} on contribution. Give it more stock and visibility.'],
  ['apiText.pulse.rankNote', '{{product}} ranks {{units}} on units but {{rank}} on contribution; {{why}}.'],
  ['apiText.pulse.whyReturns', 'returns are {{pct}}% of its orders'],
  ['apiText.pulse.whyDiscount', 'discounts average {{pct}}% of gross'],
  ['apiText.pulse.whyShipping', 'shipping is {{pct}}% of its order value'],
  ['apiText.pulse.whyPrice', 'its price leaves little after costs'],
  // Margin formulas (api/src/engine/margins.ts).
  ['apiText.formula.netRevenue', 'net revenue = revenue − refunds (gross − discount − refund)'],
  ['apiText.formula.netProductCost', 'net product cost = product cost − recovered product cost (subtracted once)'],
  ['apiText.formula.cm1', 'CM1 = (net revenue − net product cost) ÷ net revenue'],
  ['apiText.formula.cm2', 'CM2 = (net revenue − net product cost − shipping (incl. return shipping) − payment fees − handling) ÷ net revenue'],
  ['apiText.formula.cm3', 'CM3 = contribution ÷ net revenue = (net revenue − net product cost − shipping (incl. return shipping) − payment fees − handling − ads) ÷ net revenue'],
  ['apiText.formula.netMargin', 'net margin (estimated) = (contribution − fixed costs) ÷ net revenue; fixed costs are an assumed input, default 0'],
  // Reconciliation statements (api/src/engine/reconcile.ts).
  ['apiText.recon.ok', 'Σ orders = Σ channels = Σ products'],
  ['apiText.recon.unknown', 'Channel spend is unknown for at least one channel — totals cannot be reconciled until it is supplied.'],
  ['apiText.recon.gap', 'Totals differ by {{inr}} — check channel and product assignments.'],
  // Evidence for a fix (api/src/stats/evidence.ts): a reason, sometimes followed by a note on missing facts.
  ['apiText.evidence.noGain', 'This change does not add money on these orders.'],
  ['apiText.evidence.high', '{{n}} orders drive it; in 95% of resamples of your orders it still gains money.'],
  ['apiText.evidence.medium', '{{n}} orders drive it; it gains money in {{pct}}% of resamples, so the size is less certain.'],
  ['apiText.evidence.low', 'Only {{n}} orders drive it, so the result could change with more data.'],
  ['apiText.evidence.missingMany', '{{base}} {{n}} orders have missing facts and are left out.'],
  ['apiText.evidence.missingOne', '{{base}} {{n}} order with missing facts left out, never counted as zero.'],
  ['apiText.evidence.missingOther', '{{base}} {{n}} orders with missing facts left out, never counted as zero.'],
  // AI privacy note (api/src/ai/guardlog.ts) and storage region.
  ['apiText.ai.regionNote', 'Orders, analyses and decisions are stored in AWS ap-south-1 (Mumbai). Only the aggregate fields listed in fields_sent go to the Gemini API (Google); raw order rows never leave the API. With AI off, every text is the deterministic template.'],
  ['apiText.region.local', 'local'],
];

interface Pattern {
  key: string;
  en: string;
  re: RegExp;
  names: string[];
}

/** Placeholders that always hold a number, matched as digits so a sentence with a leading clause splits in the right place. */
const NUMERIC = new Set(['n', 'pct', 'units', 'rank', 'target', 'cap', 'rec']);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "Cap discounts at {{pct}}% of gross." → /^Cap discounts at (.+?)% of gross\.$/ with names ['pct']. */
const PATTERNS: Pattern[] = API_TEXTS.map(([key, en]) => {
  const names: string[] = [];
  const source = en
    .split(/(\{\{\w+\}\})/)
    .map((part) => {
      const m = /^\{\{(\w+)\}\}$/.exec(part);
      if (!m) return escapeRe(part);
      names.push(m[1]);
      return NUMERIC.has(m[1]) ? '(\\d[\\d.,]*)' : '(.+?)';
    })
    .join('');
  return { key, en, re: new RegExp(`^${source}$`), names };
});

/** The keys this module can produce, for tests and the coverage scan. */
export const API_TEXT_KEYS: readonly string[] = API_TEXTS.map(([k]) => k);

/**
 * An engine sentence in the UI language. English, and any text no entry knows, comes back exactly as sent.
 * Values inside a sentence ("aug.csv line 5", a product's reason) are translated the same way.
 */
export function apiText(text: string | null | undefined, depth = 0): string {
  if (text === null || text === undefined) return '';
  if (!text || i18n.language === 'en' || depth > 2) return text;
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const values: Record<string, string> = {};
    p.names.forEach((n, i) => {
      values[n] = apiText(m[i + 1], depth + 1);
    });
    return i18n.t(p.key, p.en, values);
  }
  return text;
}

/** Long lists of order ids in a note ("D00002, D00005, …") keep the first five and say how many more. */
export function shortIds(text: string, keep = 5): string {
  return text.replace(/\b[A-Z]{1,3}\d{1,6}(?:, [A-Z]{1,3}\d{1,6}){5,}/g, (list) => {
    const ids = list.split(', ');
    return ids.length <= keep ? list : `${ids.slice(0, keep).join(', ')} … +${ids.length - keep}`;
  });
}
