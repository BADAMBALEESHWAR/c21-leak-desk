import Handlebars from 'handlebars';
import type { Describe } from '../engine/leaks.js';
import type { Narrator } from '../engine/scenario.js';
import { DISCOUNT_CAP_PCT, RECOVERY_TARGET_PCT } from '../engine/scenario.js';
import type { InterventionKey, LeakCause, OrderRow } from '../engine/types.js';

// Deterministic "why" text and 30-day test drafts. AI may reword these (labelled "ai"); numbers always come from here.

export { formatInr } from '../engine/format.js';
import { formatInr } from '../engine/format.js';

const hb = Handlebars.create();
hb.registerHelper('inr', (n: number | null) => formatInr(n));
hb.registerHelper('plural', (n: number, one: string, many: string) => (n === 1 ? one : many));
const compile = (s: string) => hb.compile(s, { noEscape: true, strict: false });

const LEAK_TEMPLATES: Record<LeakCause, HandlebarsTemplateDelegate> = {
  full_return_partial_recovery: compile(
    '{{count}} {{plural count "order was" "orders were"}} refunded in full and only {{inr recovered}} of {{inr product_cost}} product cost came back as stock. With shipping, fees and return costs, these orders lost {{inr lost}}. Examples: {{examples}}.',
  ),
  refund_unknown: compile(
    '{{count}} returned {{plural count "order is" "orders are"}} missing a refund, recovery or return-cost fact, so contribution is unknown, not zero. Record the facts before trusting a contribution headline. Orders: {{examples}}.',
  ),
  fees_exceed_margin: compile(
    'On {{count}} kept {{plural count "order" "orders"}}, shipping, payment fee, handling and ads cost more than was left after product cost, losing {{inr lost}}. Examples: {{examples}}.',
  ),
  discount_exceeds_margin: compile(
    'On {{count}} kept {{plural count "order" "orders"}}, the discount ({{inr discount}} in total) is at least as large as the shortfall, so the discount turned the sale negative: {{inr lost}} lost. Examples: {{examples}}.',
  ),
  other_negative: compile(
    '{{count}} returned {{plural count "order" "orders"}} recovered the stock but still lost {{inr lost}} on shipping, fees and return costs. Examples: {{examples}}.',
  ),
};

export const describeLeak: Describe = (g, rows: OrderRow[]) => {
  const sum = (f: (r: OrderRow) => number | null) => rows.reduce((s, r) => s + (f(r) ?? 0), 0);
  return LEAK_TEMPLATES[g.cause]({
    count: g.count,
    lost: g.lost_inr,
    examples: g.example_ids.join(', ') + (g.count > g.example_ids.length ? ` and ${g.count - g.example_ids.length} more` : ''),
    recovered: sum((r) => r.recovered_product_cost_inr),
    product_cost: sum((r) => r.product_cost_inr),
    discount: sum((r) => r.discount_inr),
  });
};

const WHY: Record<InterventionKey, HandlebarsTemplateDelegate> = {
  raise_recovery_via_inspection: compile(
    'Returns currently recover {{recovery}} of product cost. Inspecting returns before restocking so recovery reaches {{target}}% adds about {{inr delta}} across {{driving}} returned {{plural driving "order" "orders"}}.',
  ),
  charge_return_shipping: compile(
    'Return shipping averages {{inr return_cost}} per returned order and the brand pays it. Charging it to the customer adds about {{inr delta}} across {{driving}} {{plural driving "return" "returns"}}.',
  ),
  cap_discount: compile(
    'Capping discounts at {{cap}}% of gross adds about {{inr delta}} across {{driving}} {{plural driving "order" "orders"}}, assuming the same orders still happen.',
  ),
  add_handling_to_price: compile(
    'Handling is paid on every order but not priced in. Adding it to the price adds about {{inr delta}} across {{driving}} {{plural driving "order" "orders"}}, assuming the same orders still happen.',
  ),
  none: compile('Under these assumptions none of the four rules improves contribution. Keep the current policy and re-run when the facts change.'),
};

const SAME_VOLUME_STOP = 'Stop if weekly orders fall below the prior four-week average for two weeks in a row.';
const TEST: Record<InterventionKey, { test: HandlebarsTemplateDelegate; stop: HandlebarsTemplateDelegate }> = {
  raise_recovery_via_inspection: {
    test: compile('For 30 days, inspect every return before restocking and record the recovered stock value per return. Compare average recovery with the current {{recovery}}.'),
    stop: compile('Stop if average recovery after 10 inspected returns is not above {{recovery}}, or inspection costs more per return than the recovery it adds.'),
  },
  charge_return_shipping: {
    test: compile('For 30 days, charge {{inr return_cost}} return shipping on every return and track the return rate and contribution per order against the {{rate}}% baseline.'),
    stop: compile(SAME_VOLUME_STOP),
  },
  cap_discount: {
    test: compile('For 30 days, cap discounts at {{cap}}% of gross and track orders per week and contribution per order.'),
    stop: compile(SAME_VOLUME_STOP),
  },
  add_handling_to_price: {
    test: compile('For 30 days, add handling to the listed price and track conversion and contribution per order.'),
    stop: compile(SAME_VOLUME_STOP),
  },
  none: {
    test: compile('No test needed this month. Re-run the analysis after the next month-end close.'),
    stop: compile('Not applicable.'),
  },
};

function vars(ledger: Parameters<Narrator['why']>[1], delta: number, driving: number) {
  const o = ledger.observed;
  return {
    delta,
    driving,
    recovery: o.recovery_pct === null ? 'an unknown share' : `${o.recovery_pct}%`,
    target: RECOVERY_TARGET_PCT,
    cap: DISCOUNT_CAP_PCT,
    rate: o.return_rate_pct,
    return_cost: o.avg_return_cost_inr,
  };
}

export const templateNarrator: Narrator = {
  // confidence_reason is returned separately and shown beside the badge, so it is not repeated here.
  why: (rec, ledger) => WHY[rec.intervention](vars(ledger, rec.expected_delta_inr, rec.driving_orders)),
  test30d(intervention, ledger) {
    const v = vars(ledger, 0, 0);
    return { test: TEST[intervention].test(v), stop: TEST[intervention].stop(v) };
  },
};
