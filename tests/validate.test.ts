import { describe, expect, it } from 'vitest';
import { analyze } from '../api/src/engine/analyze';
import { validateRows } from '../api/src/engine/validate';
import { parseCsv } from '../api/src/ingest';
import { EXPECTED, EXTENDED, FIXTURE, NEG, rawOrders, readText } from './helpers';

const fx = () => rawOrders(FIXTURE);

describe('validate (V1–V9)', () => {
  it('reference rows are clean', () => {
    const v = validateRows(fx());
    expect([v.rows_kept, v.rows_rejected, v.flags.length, v.period_end]).toEqual([20, 0, 0, '2026-09-30']);
  });

  it('V1: a missing required field rejects the row with the field path', () => {
    const { product_cost_inr: _, ...row } = fx()[0];
    const v = validateRows([row], { path_prefix: 'records.orders' });
    expect(v.rows_kept).toBe(0);
    expect(v.flags[0]).toMatchObject({ reason: 'schema', field: 'product_cost_inr', path: 'records.orders[0].product_cost_inr', action: 'rejected' });
  });

  it('V1: bad_schema.csv (no product_cost_inr column) is a 422 naming the column', () => {
    expect(() => parseCsv(readText(NEG('bad_schema.csv')))).toThrowError(/product_cost_inr is missing/);
    try {
      parseCsv(readText(NEG('bad_schema.csv')));
    } catch (e: any) {
      expect([e.status, e.code, e.extra.path]).toEqual([422, 'schema_invalid', 'product_cost_inr']);
    }
  });

  it('V2: refund over gross − discount is invalid and excluded (refund_over_gross drill)', () => {
    const v = validateRows(rawOrders(NEG('refund_over_gross.json')));
    expect(v.rows_kept).toBe(EXPECTED.drills.refund_over_gross.orders);
    expect(v.flags[0]).toMatchObject({ order_id: 'O03', reason: 'invalid', field: 'refund_inr', line: 3 });
    expect(analyze(v.rows, { attribution: 'allocate' }).totals.contribution_inr).toBe(EXPECTED.drills.refund_over_gross.total);
  });

  it('V2: discount over gross is invalid', () => {
    const v = validateRows([{ ...fx()[0], discount_inr: 1200 }]);
    expect(v.flags[0].reason).toBe('invalid');
  });

  it('V3: recovered above product cost is rejected with the exact message', () => {
    const v = validateRows([fx()[0], { ...fx()[16], recovered_product_cost_inr: 500 }]);
    expect(v.rows_kept).toBe(1);
    expect(v.flags[0].detail).toBe('recovered_product_cost_inr is greater than product_cost_inr on O17 — row excluded.');
  });

  it('V1: a negative amount is rejected with its path', () => {
    const v = validateRows([{ ...fx()[0], shipping_inr: -10 }], { path_prefix: 'records.orders' });
    expect(v.flags[0]).toMatchObject({ reason: 'schema', path: 'records.orders[0].shipping_inr' });
  });

  it('V4: net_sales mismatch over ₹1 is kept and flagged', () => {
    const v = validateRows([{ ...fx()[0], net_sales_inr: 850 }, { ...fx()[1], net_sales_inr: 901 }]);
    expect(v.flags.filter((f) => f.reason === 'mismatch').map((f) => f.order_id)).toEqual(['O01']);
    expect(v.rows_kept).toBe(2);
  });

  it('V5/R7: duplicate O07 → 20 orders, one flag, totals unchanged', () => {
    const v = validateRows(rawOrders(NEG('duplicate_order.json')));
    expect(v.rows_kept).toBe(20);
    expect(v.flags.filter((f) => f.reason === 'duplicate')).toEqual([expect.objectContaining({ order_id: 'O07', action: 'dropped', line: 21 })]);
    expect(analyze(v.rows, { attribution: 'allocate' }).totals.contribution_inr).toBe(6000);
  });

  it('V6/R8: late refund O10 → +420 in period, −180 recognised, total ₹6,600', () => {
    const v = validateRows(rawOrders(NEG('late_refund.json')));
    expect(v.flags.find((f) => f.reason === 'late_refund')?.order_id).toBe('O10');
    const a = analyze(v.rows, { attribution: 'allocate' });
    const o10 = a.orders.find((o) => o.order_id === 'O10')!;
    expect([o10.contribution_inr, o10.recognised_contribution_inr]).toEqual([420, -180]);
    expect([a.totals.contribution_inr, a.totals.late_refund_pending_inr]).toEqual([6600, -600]);
  });

  it('V6: moving the period end past the refund date recognises it', () => {
    const v = validateRows(rawOrders(NEG('late_refund.json')), { period_end: '2026-10-31' });
    expect(v.flags.some((f) => f.reason === 'late_refund')).toBe(false);
    expect(analyze(v.rows, { attribution: 'allocate', period_end: '2026-10-31' }).totals.contribution_inr).toBe(6000);
  });

  it('orders dated after a chosen period end are outside the period and labelled, not silently dropped', () => {
    const a = analyze(validateRows(rawOrders(FIXTURE)).rows, { attribution: 'allocate', period_end: '2026-09-15' });
    expect(a.totals.orders).toBe(14);
    expect(a.labels.join(' ')).toMatch(/6 orders are dated after the period end \(2026-09-15\)/);
  });

  it('V7: a missing nullable field is unknown, never zero', () => {
    const v = validateRows(rawOrders(NEG('missing_fee.json')));
    expect(v.rows_kept).toBe(20);
    expect(v.flags.filter((f) => f.reason === 'unknown' && f.field === 'payment_fee_inr')).toHaveLength(20);
    expect(v.flags[0].detail).toMatch(/payment_fee_inr is missing on O01/);
  });

  it('V8: unknown keys are warned, not rejected; aliases are mapped', () => {
    const { refund_inr, ...rest } = fx()[0];
    const v = validateRows([{ ...rest, refund: refund_inr, coupon_code: 'X' }]);
    expect(v.rows_kept).toBe(1);
    expect(v.rows[0].refund_inr).toBe(0);
    expect(v.warnings.join(' ')).toMatch(/coupon_code/);
    expect(v.warnings.join(' ')).toMatch(/refund → refund_inr/);
  });

  it('extended file: duplicate S01 (row S05) dropped, S04 unknown, S06 late', () => {
    const v = validateRows(rawOrders(EXTENDED));
    expect([v.rows_in, v.rows_kept]).toEqual([EXPECTED.extended.orders_in_file, EXPECTED.extended.orders_kept]);
    const reasons = v.flags.map((f) => `${f.reason}:${f.order_id}`);
    expect(reasons).toEqual(expect.arrayContaining(['duplicate:S01', 'late_refund:S06', 'unknown:S04']));
  });
});

describe('payment methods as stores write them', () => {
  it('maps cash on delivery to cod, paid-before-dispatch methods to prepaid, and anything else to unknown', async () => {
    const { paymentType } = await import('../api/src/schema/orders');
    const cases: Array<[string, string | null]> = [
      ['Cash on Delivery', 'cod'], ['COD', 'cod'], ['cod', 'cod'], ['Pay on Delivery', 'cod'],
      ['Credit Card', 'prepaid'], ['Debit Card', 'prepaid'], ['UPI', 'prepaid'], ['PayPal', 'prepaid'], ['Apple Pay', 'prepaid'],
      ['Net Banking', 'prepaid'], ['Wallet', 'prepaid'], ['prepaid', 'prepaid'], ['Gift voucher', null], ['', null],
    ];
    for (const [input, want] of cases) expect([input, paymentType(input)]).toEqual([input, want]);
  });
});
