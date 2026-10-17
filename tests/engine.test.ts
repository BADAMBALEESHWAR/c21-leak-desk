import { describe, expect, it } from 'vitest';
import { analyze } from '../api/src/engine/analyze';
import { computeOrder, computeWorkedOrder } from '../api/src/engine/contribution';
import { validateRows } from '../api/src/engine/validate';
import { EXPECTED, EXTENDED, FIXTURE, loadJson, NEG, rawOrders, rows } from './helpers';

const copts = { attribution: 'allocate' as const, handling_default_inr: 0, period_end: '2026-09-30' };

describe('engine.worked_order (check 1)', () => {
  it('is 230 exactly with six lines and the net-of-recovery note', () => {
    const w = computeWorkedOrder(loadJson(FIXTURE).records.worked_order);
    expect(w.contribution_inr).toBe(EXPECTED.worked_order);
    expect(w.matches).toBe(true);
    expect(w.lines.map((l) => l.label)).toEqual(['Revenue', 'Refund', 'Net product cost', 'Shipping', 'Ads', 'Handling']);
    expect(w.lines.find((l) => l.key === 'net_product_cost')?.note).toMatch(/after any recovered/);
  });
});

describe('engine.fixture (R1–R5)', () => {
  const a = analyze(rows(FIXTURE), { attribution: 'allocate' });

  it('scores each kept order at 420 and each returned order at −180', () => {
    for (const o of a.orders) expect(o.contribution_inr).toBe(o.returned ? EXPECTED.fixture.returned : EXPECTED.fixture.kept);
    expect(a.orders.filter((o) => o.returned).map((o) => o.order_id)).toEqual(['O05', 'O10', 'O15', 'O20']);
  });

  it('totals ₹6,000 on gross ₹20,000 and net sales ₹14,400', () => {
    expect(a.totals).toMatchObject({ contribution_inr: 6000, gross_inr: 20000, net_sales_inr: 14400, orders: 20, negative_count: 4, partial: false, headline_ready: true });
  });

  it('subtracts net product cost once (R2: 400 − 350 = 50 on returns)', () => {
    const o05 = a.orders.find((o) => o.order_id === 'O05')!;
    expect(o05.derived.net_product_cost).toBe(50);
    expect(o05.lines.find((l) => l.key === 'net_product_cost')?.amount_inr).toBe(-50);
  });

  it('labels handling as an estimate when the row has none (R4)', () => {
    const line = a.orders[0].lines.find((l) => l.key === 'handling')!;
    expect(line.source).toBe('config_default');
    expect(a.orders[0].labels).toContain('handling estimated');
  });
});

describe('engine.extended (Blueprint §8.2)', () => {
  const a = analyze(rows(EXTENDED), { attribution: 'allocate' });
  const byId = Object.fromEntries(a.orders.map((o) => [o.order_id, o]));

  it('matches every synthetic row', () => {
    for (const [id, value] of Object.entries(EXPECTED.extended.rows)) expect(byId[id].contribution_inr).toBe(value);
  });

  it('totals ₹7,053, partial with 1 unknown', () => {
    expect(a.totals.contribution_inr).toBe(EXPECTED.extended.total);
    expect(a.totals.unknown_count).toBe(1);
    expect(a.totals.partial).toBe(true);
    expect(a.totals.headline_ready).toBe(false);
  });

  it('R8: late refund S06 counts as kept in period (+350) and is −250 if recognised', () => {
    expect(byId.S06.contribution_inr).toBe(EXPECTED.extended.late_pending.in_period);
    expect(byId.S06.recognised_contribution_inr).toBe(EXPECTED.extended.late_pending.recognised);
    expect(byId.S06.flags).toContain('late_refund');
    expect(a.totals.late_refund_pending_inr).toBe(EXPECTED.extended.late_pending.delta);
  });

  it('R10: classifies leaks by cause', () => {
    expect(byId.S02.leak_cause).toBe('discount_exceeds_margin');
    expect(byId.S03.leak_cause).toBe('full_return_partial_recovery');
    expect(byId.S04.leak_cause).toBe('refund_unknown');
    expect(byId.S06.leak_cause).toBeNull();
    const frpr = a.leaks.find((l) => l.cause === 'full_return_partial_recovery')!;
    expect([frpr.count, frpr.lost_inr]).toEqual([5, 1384]);
  });
});

describe('engine.unknown (R6, check 3)', () => {
  it('null refund gives status unknown, not a number', () => {
    const o05 = { ...rawOrders(FIXTURE)[4], refund_inr: null, net_sales_inr: null };
    const r = computeOrder(validateRows([o05]).rows[0], copts);
    expect(r.status).toBe('unknown');
    expect(r.contribution_inr).toBeNull();
    expect(r.unknown_fields).toContain('refund_inr');
  });

  it('null_refund drill: ₹6,180 partial (1 unknown)', () => {
    const a = analyze(rows(NEG('null_refund.json')), { attribution: 'allocate' });
    expect(a.totals.contribution_inr).toBe(EXPECTED.drills.null_refund.total);
    expect(a.totals.unknown_count).toBe(1);
  });

  it('missing_fee drill: every order unknown, totals partial, no crash', () => {
    const a = analyze(rows(NEG('missing_fee.json')), { attribution: 'allocate' });
    expect(a.totals.unknown_count).toBe(EXPECTED.drills.missing_fee.unknown);
    expect(a.totals.contribution_inr).toBeNull();
    expect(a.totals.partial).toBe(true);
    expect(a.reconciliation.ok).toBe(true);
  });

  it('recovery_400 drill: returned orders at −130, total ₹6,200', () => {
    const a = analyze(rows(NEG('recovery_400.json')), { attribution: 'allocate' });
    for (const o of a.orders.filter((x) => x.returned)) expect(o.contribution_inr).toBe(EXPECTED.drills.recovery_400.returned);
    expect(a.totals.contribution_inr).toBe(EXPECTED.drills.recovery_400.total);
  });

  it('is deterministic: same input, same output', () => {
    const r = rows(EXTENDED);
    expect(JSON.stringify(analyze(r, { attribution: 'channel' }))).toBe(JSON.stringify(analyze(r, { attribution: 'channel' })));
  });
});
