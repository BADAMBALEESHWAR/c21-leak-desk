import { describe, expect, it } from 'vitest';
import { analyze } from '../api/src/engine/analyze';
import { AttributionConflict } from '../api/src/engine/types';
import { EXPECTED, EXTENDED, FIXTURE, rows } from './helpers';

const groups = (a: ReturnType<typeof analyze>, kind: 'channel' | 'product', field: 'contribution_inr' | 'contribution_before_spend_inr' | 'channel_spend_inr') =>
  Object.fromEntries(a.groups[kind].map((g) => [g.key, g[field]]));

describe('engine.reconcile (R11, check 2)', () => {
  for (const mode of ['allocate', 'channel'] as const) {
    it(`fixture: Σ orders = Σ channels = Σ products = 6,000 in ${mode} mode`, () => {
      const r = analyze(rows(FIXTURE), { attribution: mode }).reconciliation;
      expect([r.orders_inr, r.channels_inr, r.products_inr]).toEqual([6000, 6000, 6000]);
      expect(r.ok).toBe(true);
    });

    it(`extended: Σ orders = Σ channels = Σ products = 7,053 in ${mode} mode`, () => {
      const r = analyze(rows(EXTENDED), { attribution: mode }).reconciliation;
      expect([r.orders_inr, r.channels_inr, r.products_inr]).toEqual([7053, 7053, 7053]);
      expect(r.ok).toBe(true);
    });
  }

  it('channel totals match Blueprint §8.3 in both modes', () => {
    expect(groups(analyze(rows(EXTENDED), { attribution: 'allocate' }), 'channel', 'contribution_inr')).toEqual(EXPECTED.extended.channels);
    const c = analyze(rows(EXTENDED), { attribution: 'channel' });
    expect(groups(c, 'channel', 'contribution_inr')).toEqual(EXPECTED.extended.channels);
    expect(groups(c, 'channel', 'contribution_before_spend_inr')).toEqual(EXPECTED.extended.channels_before_spend);
    expect(c.channel_spend).toEqual(EXPECTED.extended.channel_spend);
  });

  it('product totals: after ads in allocate mode, before channel spend in channel mode', () => {
    expect(groups(analyze(rows(EXTENDED), { attribution: 'allocate' }), 'product', 'contribution_inr')).toEqual(EXPECTED.extended.products_allocate);
    const c = analyze(rows(EXTENDED), { attribution: 'channel' });
    expect(groups(c, 'product', 'contribution_inr')).toEqual(EXPECTED.extended.products_channel_before_spend);
    expect(c.groups.product_label).toBe('before channel spend');
    expect(c.groups.product_unallocated_spend_inr).toBe(490);
  });

  it('switching modes moves ads from order lines to the channel line', () => {
    const a = analyze(rows(EXTENDED), { attribution: 'allocate' }).orders.find((o) => o.order_id === 'S01')!;
    const c = analyze(rows(EXTENDED), { attribution: 'channel' }).orders.find((o) => o.order_id === 'S01')!;
    expect(a.derived.ads_allocated).toBe(100);
    expect(c.derived.ads_allocated).toBe(0);
    expect(c.lines.find((l) => l.key === 'ads')?.source).toBe('moved_to_channel');
  });

  it('never both: explicit channel spend with per-order ads in allocate mode throws AttributionConflict', () => {
    expect(() => analyze(rows(EXTENDED), { attribution: 'allocate', channel_spend: { web: 250 } })).toThrow(AttributionConflict);
  });

  it('every attribution output carries the not-causal label', () => {
    expect(analyze(rows(EXTENDED), { attribution: 'channel' }).labels).toContain('Attribution is allocation, not causation.');
  });

  it('unknown ads make the order unknown in both modes, and totals still reconcile (fuzz seed 43)', () => {
    const r = rows(FIXTURE).map((o) => (o.order_id === 'O01' ? { ...o, ads_inr: null } : o));
    for (const mode of ['allocate', 'channel'] as const) {
      const a = analyze(r, { attribution: mode });
      expect(a.orders.find((o) => o.order_id === 'O01')?.status).toBe('unknown');
      expect([a.totals.contribution_inr, a.reconciliation.ok]).toEqual([5580, true]);
    }
  });

  it('period bridge runs gross → net sales → contribution and ends at the reconciled total in both modes', () => {
    for (const mode of ['allocate', 'channel'] as const) {
      const a = analyze(rows(EXTENDED), { attribution: mode });
      const steps = a.bridge.filter((l) => l.kind === 'start' || l.kind === 'deduction').reduce((s, l) => s + l.amount_inr, 0);
      expect(steps).toBe(7053);
      expect(a.bridge.at(-1)).toMatchObject({ key: 'contribution', amount_inr: 7053 });
      expect(a.bridge.find((l) => l.key === 'net_sales')?.amount_inr).toBe(a.totals.net_sales_inr);
      expect(a.bridge.some((l) => l.key === 'channel_spend')).toBe(mode === 'channel');
    }
  });

  it('rows without channel or product go to unassigned', () => {
    const a = analyze(rows(FIXTURE), { attribution: 'allocate' });
    expect(a.groups.channel.map((g) => g.key)).toEqual(['unassigned']);
    expect(a.groups.product.map((g) => g.key)).toEqual(['unassigned']);
  });
});
