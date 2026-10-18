// @vitest-environment jsdom
// The analytical charts: diverging bars sit around a visible ₹0 (negatives left, sorted by value), treemap
// tiles have areas proportional to their size, every chart card exports its numbers as CSV, and the
// unit-economics bridge walks from net revenue down to the net figure.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartCard } from '../web/src/charts/ChartCard';
import { DivergingBars, divergingDomain, sortDiverging, type DivergingRow } from '../web/src/charts/DivergingBars';
import { monthExtremes, type MonthDatum } from '../web/src/charts/MonthColumns';
import { squarify, divergingStep, Treemap } from '../web/src/charts/Treemap';
import { marginBridgeSteps, unitEconomics } from '../web/src/components/UnitEconomics';
import { setLanguage } from '../web/src/i18n';
import { formatInr } from '../web/src/lib/format';
import type { Margins } from '../web/src/api/types';

const pctOf = (style: string, prop: 'left' | 'width') => Number(new RegExp(`${prop}:\\s*([-\\d.]+)%`).exec(style)?.[1] ?? NaN);

beforeEach(() => setLanguage('en'));
afterEach(() => cleanup());

describe('DivergingBars', () => {
  const rows: DivergingRow[] = [
    { key: 'A', label: 'Amazon', value: 1200, share: 0.2 },
    { key: 'B', label: 'Myntra', value: -450, share: 0.3 },
    { key: 'C', label: 'Website', value: 5300, share: 0.4 },
    { key: 'D', label: 'Flipkart', value: -2100, share: 0.1 },
    { key: 'E', label: 'Unknown', value: null, share: 0 },
  ];

  it('sorts by value, largest first, unknown last', () => {
    expect(sortDiverging(rows).map((r) => r.key)).toEqual(['C', 'A', 'B', 'D', 'E']);
  });

  it('draws negatives left of the ₹0 axis and positives right of it', () => {
    const { container } = render(<DivergingBars rows={rows} measure="Contribution" ariaLabel="Contribution by channel" format={formatInr} />);
    const keys = [...container.querySelectorAll('li[data-key]')].map((li) => li.getAttribute('data-key'));
    expect(keys).toEqual(['C', 'A', 'B', 'D', 'E']);
    const zero = pctOf((container.querySelector('.dv-grid.is-zero') as HTMLElement).getAttribute('style') ?? '', 'left');
    expect(zero).toBeGreaterThan(0);
    expect(zero).toBeLessThan(100);
    for (const bar of container.querySelectorAll<HTMLElement>('.dv-bar')) {
      const style = bar.getAttribute('style') ?? '';
      const left = pctOf(style, 'left');
      const right = left + pctOf(style, 'width');
      const v = Number(bar.dataset.value);
      if (v < 0) {
        expect(bar.className).toContain('is-neg');
        expect(right).toBeCloseTo(zero, 6);
        expect(left).toBeLessThan(zero);
      } else {
        expect(bar.className).toContain('is-pos');
        expect(left).toBeCloseTo(zero, 6);
        expect(right).toBeGreaterThan(zero);
      }
    }
    // Longer bar for the bigger loss.
    const width = (key: string) => pctOf(container.querySelector(`li[data-key="${key}"] .dv-bar`)?.getAttribute('style') ?? '', 'width');
    expect(width('D')).toBeGreaterThan(width('B'));
    // Values at the bar ends, and the zero tick on the axis.
    expect(container.querySelector('li[data-key="D"] .dv-value')?.textContent).toBe(formatInr(-2100));
    expect(container.querySelector('.dv-tick.is-zero')?.textContent).toBe('₹0');
    // Without a link each row is still a keyboard stop.
    expect(container.querySelectorAll('.dv-row[tabindex="0"]').length).toBe(rows.length);
  });

  it('makes each row a link to the filtered ledger when given one', () => {
    render(<DivergingBars rows={rows.map((r) => ({ ...r, href: `#/ledger?channel=${r.key}` }))} measure="Contribution" ariaLabel="By channel" format={formatInr} />);
    const link = screen.getByRole('link', { name: /^Myntra: Contribution −₹\s?450, 30% of orders/ });
    expect(link.getAttribute('href')).toBe('#/ledger?channel=B');
  });

  it('keeps ₹0 inside the domain when every value is positive', () => {
    const d = divergingDomain([100, 300]);
    expect(d.lo).toBe(0);
    expect(d.hi).toBeGreaterThan(300);
  });
});

describe('Treemap', () => {
  const items = [6, 6, 4, 3, 2, 2, 1].map((size, i) => ({ key: `P${i}`, label: `P${i}`, size, colorValue: i - 3 }));

  it('gives each tile an area proportional to its size and covers the box', () => {
    const box = { x: 0, y: 0, w: 600, h: 400 };
    const tiles = squarify(items, box);
    const total = items.reduce((s, i) => s + i.size, 0);
    expect(tiles.length).toBe(items.length);
    for (const t of tiles) {
      expect(t.w * t.h).toBeCloseTo((t.item.size / total) * box.w * box.h, 6);
      expect(t.x).toBeGreaterThanOrEqual(-1e-9);
      expect(t.y).toBeGreaterThanOrEqual(-1e-9);
      expect(t.x + t.w).toBeLessThanOrEqual(box.w + 1e-6);
      expect(t.y + t.h).toBeLessThanOrEqual(box.h + 1e-6);
    }
    expect(tiles.reduce((s, t) => s + t.w * t.h, 0)).toBeCloseTo(box.w * box.h, 6);
    // Squarified: no sliver tiles for this input.
    for (const t of tiles) expect(Math.max(t.w / t.h, t.h / t.w)).toBeLessThan(4);
  });

  it('leaves out items without net sales', () => {
    expect(squarify([{ size: 0 }, { size: -5 }, { size: 3 }], { x: 0, y: 0, w: 10, h: 10 })).toHaveLength(1);
  });

  it('colours on a diverging scale with a neutral midpoint', () => {
    expect(divergingStep(0, 100)).toBe(0);
    expect(divergingStep(null, 100)).toBe(0);
    expect(divergingStep(-100, 100)).toBe(-3);
    expect(divergingStep(50, 100)).toBe(2);
    expect(divergingStep(10, 100)).toBe(1);
  });

  it('renders one link per product, areas in proportion', () => {
    const { container } = render(
      <Treemap items={items.map((i) => ({ ...i, href: `#/ledger?product=${i.key}` }))} ariaLabel="Products" formatColor={formatInr} colorLabel="Contribution per unit" sizeLabel="Net sales" />,
    );
    const links = [...container.querySelectorAll<SVGElement>('a.tm-link')];
    expect(links).toHaveLength(items.length);
    const area = (k: string) => Number(container.querySelector(`[data-key="${k}"]`)?.getAttribute('data-area'));
    expect(area('P0') / area('P6')).toBeCloseTo(6, 0);
    expect(links[0].getAttribute('href')).toMatch(/^#\/ledger\?product=P/);
  });
});

describe('CSV export from a chart card', () => {
  it('downloads the chart numbers as CSV', async () => {
    const blobs: Blob[] = [];
    const create = vi.fn((b: Blob) => {
      blobs.push(b);
      return 'blob:chart';
    });
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(
      <ChartCard title="Contribution by channel" csv={{ filename: 'by-channel.csv', headers: ['channel', 'contribution_inr'], rows: [['Amazon', 1200], ['My, "Shop"', -450]] }}>
        <p>chart</p>
      </ChartCard>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV: Contribution by channel' }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(blobs[0]);
    });
    expect(text.replace(/^﻿/, '')).toBe('channel,contribution_inr\nAmazon,1200\n"My, ""Shop""",-450');
    click.mockRestore();
  });

  it('has a table view', () => {
    render(
      <ChartCard title="T" table={<table><tbody><tr><td>x</td></tr></tbody></table>}>
        <p>chart</p>
      </ChartCard>,
    );
    expect(screen.getByText('Table view')).toBeTruthy();
  });
});

describe('Month columns and margin bridge', () => {
  it('names the best and worst month by contribution', () => {
    const m = (month: string, c: number | null): MonthDatum => ({ month, label: month, full: month, netSales: 100, contribution: c, extra: [] });
    expect(monthExtremes([m('a', 5), m('b', -3), m('c', 9), m('d', null)])).toEqual({ best: 2, worst: 1 });
    expect(monthExtremes([m('a', 5)])).toBeNull();
  });

  it('walks net revenue → CM1 → CM2 → CM3 → net after fixed costs', () => {
    const m: Margins = {
      net_revenue_inr: 800,
      net_product_cost_inr: 400,
      shipping_inr: 50,
      return_cost_inr: 0,
      payment_fee_inr: 0,
      handling_inr: 20,
      ads_inr: 100,
      contribution_inr: 230,
      cm1_pct: null,
      cm2_pct: null,
      cm3_pct: null,
      orders_counted: 1,
      partial: false,
    };
    const labels = { revenue: 'Net revenue', npc: 'npc', cm1: 'CM1', costs: 'costs', cm2: 'CM2', ads: 'Ads', cm3: 'CM3', fixed: 'Fixed', net: 'Net' };
    const steps = marginBridgeSteps(unitEconomics(m, 30), labels, { ads: 'allocated', fixed: 'assumed' });
    expect(steps.map((s) => s.key)).toEqual(['revenue', 'npc', 'cm1', 'costs', 'cm2', 'ads', 'cm3', 'fixed', 'net']);
    expect(steps.map((s) => s.to)).toEqual([800, 400, 400, 330, 330, 230, 230, 200, 200]);
    expect(steps.find((s) => s.key === 'cm1')?.pct).toBe(50);
    // Without fixed costs the bridge ends at CM3.
    expect(marginBridgeSteps(unitEconomics(m, 0), labels, { ads: '', fixed: '' }).at(-1)?.key).toBe('cm3');
  });
});
