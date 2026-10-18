// @vitest-environment jsdom
// Visible edge cases, rendered from engine output with a mocked store: full return with partial recovery, a duplicate
// order id, a late refund as a prior-period adjustment, "allocated, not caused", bad input, unit economics, the
// header disclaimer and the integrations roadmap.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyze } from '../api/src/engine/analyze';
import { computeMargins } from '../api/src/engine/margins';
import type { AnalysisResponse, DatasetResponse, Margins, OrderResult } from '../web/src/api/types';
import { setLanguage } from '../web/src/i18n';
import { EXTENDED, FIXTURE, NEG, rows } from './helpers';

const h = vi.hoisted(() => ({ store: {} as Record<string, unknown>, mode: 'demo' as 'demo' | 'account' }));

vi.mock('../web/src/auth/AuthContext', () => ({
  useAuth: () => ({
    ready: true,
    mode: h.mode,
    config: { enabled: false },
    user: null,
    hasSession: false,
    sessionEnded: false,
    signOut: () => undefined,
    loginUrl: '/login/',
    backToWorkspace: () => undefined,
  }),
}));

vi.mock('../web/src/state/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../web/src/state/store')>();
  return { ...actual, useStore: () => h.store };
});

import { Integrations, readNotifyRequests } from '../web/src/components/Integrations';
import { OrderDrawer } from '../web/src/components/OrderDrawer';
import { TopBar } from '../web/src/components/TopBar';
import { marginsOf, unitEconomics } from '../web/src/components/UnitEconomics';
import { FALLBACK_SAMPLES } from '../web/src/state/store';
import { ImportScreen } from '../web/src/screens/ImportScreen';
import { LeaksScreen } from '../web/src/screens/LeaksScreen';
import { LedgerScreen } from '../web/src/screens/LedgerScreen';

const noop = () => undefined;
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ');

function analysisOf(rel: string, attribution: 'allocate' | 'channel' = 'allocate'): AnalysisResponse {
  const a = analyze(rows(rel), { attribution }) as unknown as AnalysisResponse;
  return { ...a, analysis_id: `a-${rel}`, dataset_id: `d-${rel}` };
}

function datasetOf(a: AnalysisResponse, over: Partial<DatasetResponse> = {}): DatasetResponse {
  return {
    dataset_id: a.dataset_id,
    source: 'fixture',
    rows_in: a.orders.length,
    rows_kept: a.orders.length,
    rows_rejected: 0,
    kept_ids: a.orders.map((o) => o.order_id),
    synthetic_rows: a.orders.filter((o) => o.synthetic).length,
    flags: [],
    warnings: [],
    period_end: a.period_end,
    ...over,
  };
}

function setStore(over: Record<string, unknown>) {
  h.store = {
    apiStatus: 'up',
    samples: FALLBACK_SAMPLES,
    dataset: null,
    datasetId: null,
    analysis: null,
    analysing: false,
    importing: false,
    restoring: false,
    narration: null,
    importError: null,
    setImportError: noop,
    workspace: null,
    workspaceStatus: 'idle',
    workspaceError: null,
    refreshWorkspace: noop,
    openSaved: noop,
    openingId: null,
    importDataset: vi.fn(),
    runAnalysis: vi.fn(),
    drawer: null,
    drawerOpen: false,
    openOrder: noop,
    openOrderResult: noop,
    openWorked: noop,
    openBridge: noop,
    openMargin: noop,
    closeDrawer: noop,
    ledgerTab: 'orders',
    setLedgerTab: noop,
    ledgerFilter: 'all',
    setLedgerFilter: noop,
    tableFocus: 0,
    focusLedgerTable: noop,
    showToast: noop,
    dbStatus: 'memory',
    fixedCosts: 0,
    setFixedCosts: noop,
    ...over,
  };
}

const order = (a: AnalysisResponse, id: string): OrderResult => {
  const o = a.orders.find((x) => x.order_id === id) ?? a.late_refunds.orders.find((x) => x.order_id === id);
  if (!o) throw new Error(`no ${id}`);
  return o;
};

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '';
  h.mode = 'demo';
  act(() => setLanguage('en'));
});

afterEach(cleanup);

describe('unit economics', () => {
  it('gives the worked-order reference values: 800 / 50% / 41.25% / 28.75% / 28.75%', () => {
    const worked: Margins = {
      net_revenue_inr: 1000 - 200,
      net_product_cost_inr: 400,
      shipping_inr: 50,
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
    const u = unitEconomics(worked, 0);
    expect([u.netRevenue, u.cm1Pct, u.cm2Pct, u.cm3Pct, u.netPct]).toEqual([800, 50, 41.25, 28.75, 28.75]);
    expect(unitEconomics(worked, 80).netPct).toBe(18.75);
  });

  it('sums the period from the orders when the analysis has no margins block, and follows the attribution mode', () => {
    const allocate = analysisOf(EXTENDED);
    const channel = analysisOf(EXTENDED, 'channel');
    delete allocate.margins;
    delete channel.margins;
    for (const a of [allocate, channel]) {
      const m = marginsOf(a);
      // CM3 is the reconciled operational contribution in both modes.
      expect(m.contribution_inr).toBe(a.totals.contribution_inr);
      expect(m.net_revenue_inr).toBe(a.totals.net_sales_inr);
    }
    expect(marginsOf(channel).ads_inr).toBe(channel.totals.channel_spend_inr);
  });

  it('agrees with the API margins block (same lines, same totals)', () => {
    for (const mode of ['allocate', 'channel'] as const) {
      const a = analysisOf(EXTENDED, mode);
      // As the analyses route attaches it.
      const block = computeMargins(a.orders as never, mode, mode === 'channel' ? a.totals.channel_spend_inr : 0) as unknown as Margins;
      const api = unitEconomics(block, 0);
      const derived = unitEconomics(marginsOf({ ...a, margins: undefined }), 0);
      expect(derived.netRevenue).toBe(api.netRevenue);
      expect(derived.cm1Pct).toBeCloseTo(api.cm1Pct as number, 1);
      expect(derived.cm2Pct).toBeCloseTo(api.cm2Pct as number, 1);
      expect(derived.cm3Pct).toBeCloseTo(api.cm3Pct as number, 1);
      // The rupee steps match the API's percentages.
      expect(((api.cm2Inr as number) / (api.netRevenue as number)) * 100).toBeCloseTo(api.cm2Pct as number, 1);
    }
  });

  it('renders five tiles with formulas, provenance and the fixed-costs assumption', () => {
    const a = analysisOf(FIXTURE);
    setStore({ analysis: a, dataset: datasetOf(a), datasetId: a.dataset_id });
    const { container } = render(<LedgerScreen />);
    const panel = container.querySelector('.ue-card') as HTMLElement;
    expect(panel).toBeTruthy();
    const tiles = Array.from(panel.querySelectorAll('.ue-tile'));
    expect(tiles.map((t) => t.getAttribute('data-metric'))).toEqual(['revenue', 'cm1', 'cm2', 'cm3', 'net']);
    // Fixture: net revenue 14,400; contribution 6,000 → CM3 41.67%.
    expect(text(tiles[0])).toMatch(/₹\s?14,400/);
    expect(text(tiles[3])).toContain('41.67%');
    for (const t of tiles) expect(t.getAttribute('title')).toMatch(/÷ net revenue|revenue − refunds/);
    expect(within(panel).getByLabelText('Fixed costs (salaries, rent, tools)')).toBeTruthy();
    expect(tiles[4].querySelector('[data-provenance="assumed"]')).toBeTruthy();
    expect(text(tiles[4])).toContain('Estimated operational, not statutory net profit.');
    // "?" opens the formula with the numbers plugged in.
    fireEvent.click(within(tiles[1] as HTMLElement).getByRole('button', { name: /How Gross margin % \(CM1\) is computed/ }));
    expect(text(tiles[1])).toMatch(/÷ ₹\s?14,400 = /);
  });
});

describe('full return, partial recovery', () => {
  const a = analysisOf(FIXTURE);

  it('marks the ledger row red with the actual recovery numbers', () => {
    setStore({ analysis: a, dataset: datasetOf(a), datasetId: a.dataset_id });
    render(<LedgerScreen />);
    const row = screen.getByRole('button', { name: 'Open the waterfall for O05' }).closest('tr') as HTMLElement;
    expect(row.className).toContain('row-loss');
    expect(text(row)).toContain('Full return · recovery 350 of 400');
    const kept = screen.getByRole('button', { name: 'Open the waterfall for O01' }).closest('tr') as HTMLElement;
    expect(kept.className).not.toContain('row-loss');
  });

  it('comes first on Leaks, negative orders first and in red', () => {
    const ext = analysisOf(EXTENDED);
    setStore({ analysis: ext, dataset: datasetOf(ext), datasetId: ext.dataset_id });
    const { container } = render(<LeaksScreen />);
    const first = container.querySelector('.leak-card .leak-title');
    expect(first?.textContent).toBe('Full return, partial recovery');
    const losing = container.querySelector('.losing-table tbody') as HTMLElement;
    const firstRow = losing.querySelector('tr') as HTMLElement;
    // S03 loses most (−₹ 664) and is a full return with recovery 100 of 500.
    expect(text(firstRow)).toContain('S03');
    expect(text(firstRow)).toContain('Full return · recovery 100 of 500');
    expect(firstRow.className).toContain('row-loss');
    const contributions = Array.from(losing.querySelectorAll('tr')).map((tr) => tr.querySelector('td:last-child')?.textContent ?? '');
    expect(contributions[contributions.length - 1]).toMatch(/unknown/);
    expect(container.querySelector('.order-chip.is-loss')).toBeTruthy();
  });

  it('shows the recovery line in the order drawer', () => {
    setStore({ analysis: a, drawer: { kind: 'order', order: order(a, 'O05') }, drawerOpen: true });
    render(<OrderDrawer />);
    const recovery = screen.getByRole('region', { name: 'Recovery' });
    expect(text(recovery)).toMatch(/Product cost\s?₹\s?400/);
    expect(text(recovery)).toMatch(/Recovered to stock\s?₹\s?350/);
    expect(text(recovery)).toMatch(/Net product cost\s?₹\s?50/);
  });
});

describe('duplicate order id', () => {
  const a = analysisOf(NEG('duplicate_order.json'));
  const dup = datasetOf(a, {
    source: 'duplicate_order',
    rows_in: 21,
    flags: [
      {
        order_id: 'O07',
        line: 21,
        reason: 'duplicate',
        path: 'records.orders[20].order_id',
        detail: 'O07 appears again on line 21 (first on line 7) — second occurrence dropped.',
        action: 'dropped',
      },
    ],
  });

  it('reads "O07 duplicate — second copy ignored" in the import report', () => {
    setStore({ dataset: dup, datasetId: dup.dataset_id });
    render(<ImportScreen />);
    expect(screen.getByText('O07 duplicate — second copy ignored')).toBeTruthy();
  });

  it('puts a warning count in the ledger header and keeps 20 orders', () => {
    setStore({ analysis: a, dataset: dup, datasetId: dup.dataset_id });
    const { container } = render(<LedgerScreen />);
    const badge = container.querySelector('.page-head .warn-badge') as HTMLElement;
    expect(badge).toBeTruthy();
    expect(text(badge)).toContain('1 duplicate ignored');
    expect(a.totals.orders).toBe(20);
    expect(screen.getByRole('button', { name: /^Orders 20,/ })).toBeTruthy();
  });
});

describe('late refund', () => {
  const a = analysisOf(NEG('late_refund.json'));

  it('shows the period total as reported, the prior-period adjustment and the restated total', () => {
    setStore({ analysis: a, dataset: datasetOf(a), datasetId: a.dataset_id });
    render(<LedgerScreen />);
    const totals = screen.getByRole('region', { name: 'Period total and restatement' });
    const lines = Array.from(totals.querySelectorAll('.pt-line')).map(text);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^Period total \(as reported\).*₹\s?6,600$/);
    expect(lines[1]).toMatch(/^Prior-period adjustment \(late refund on O10, dated 05 Oct 2026\)\s?−₹\s?600$/);
    expect(lines[2]).toMatch(/^Restated total\s?₹\s?6,000$/);
    // The headline keeps the reported figure.
    expect(text(screen.getByRole('button', { name: /^Operational contribution ₹\s?6,600/ }))).toMatch(/₹\s?6,600/);
  });

  it('shows both views in the O10 drawer', () => {
    setStore({ analysis: a, drawer: { kind: 'order', order: order(a, 'O10') }, drawerOpen: true });
    const { baseElement } = render(<OrderDrawer />);
    const card = baseElement.querySelector('.compare-card-late') as HTMLElement;
    expect(text(card)).toMatch(/Period view \(as reported\)\s?₹\s?420/);
    expect(text(card)).toMatch(/Restated \(refund recognised\)\s?−₹\s?180/);
    expect(text(card)).toMatch(/Prior-period adjustment\s?−₹\s?600/);
  });
});

describe('attribution: allocated, not caused', () => {
  it('labels the ads column, the channel-spend column and the toggle tooltip', () => {
    const a = analysisOf(EXTENDED, 'channel');
    setStore({ analysis: a, dataset: datasetOf(a), datasetId: a.dataset_id, ledgerTab: 'channel' });
    const { container } = render(
      <>
        <TopBar route="ledger" onError={noop} />
        <LedgerScreen />
      </>,
    );
    const spendHead = Array.from(container.querySelectorAll('.group-table thead th')).find((th) => /Channel spend/.test(th.textContent ?? ''));
    expect(text(spendHead ?? null)).toContain('allocated, not caused');
    const tip = container.querySelector('.topbar-attr [role="tooltip"]');
    expect(text(tip)).toContain('allocated, not caused');
    cleanup();

    const b = analysisOf(EXTENDED);
    setStore({ analysis: b, dataset: datasetOf(b), datasetId: b.dataset_id });
    const view = render(<LedgerScreen />);
    const adsHead = Array.from(view.container.querySelectorAll('.orders-table thead th')).find((th) => /^Ads/.test(th.textContent ?? ''));
    expect(text(adsHead ?? null)).toContain('allocated, not caused');
  });
});

describe('bad input', () => {
  it('lists each rejected row with its line, field and reason, with the CSV template link', () => {
    const a = analysisOf(FIXTURE);
    const bad = datasetOf(a, {
      source: 'bad_values',
      rows_in: 10,
      rows_kept: 7,
      rows_rejected: 3,
      flags: [
        { order_id: 'O03', line: 4, reason: 'schema', field: 'product_cost_inr', detail: 'product_cost_inr must not be negative on O03 — row excluded.', action: 'rejected' },
        { order_id: 'O06', line: 7, reason: 'schema', field: 'gross_inr', detail: 'gross_inr must be a number in INR on O06 — row excluded.', action: 'rejected' },
        { order_id: 'O08', line: 9, reason: 'schema', field: 'date', detail: 'date must be an ISO date YYYY-MM-DD on O08 — row excluded.', action: 'rejected' },
      ],
    });
    setStore({ dataset: bad, datasetId: bad.dataset_id });
    const { container } = render(<ImportScreen />);
    const panel = container.querySelector('.vpanel') as HTMLElement;
    expect(within(panel).getByText('3 rows failed validation')).toBeTruthy();
    const cells = Array.from(panel.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.children).map((c) => text(c)));
    expect(cells.map((c) => [c[0], c[2]])).toEqual([
      ['4', 'product_cost_inr'],
      ['7', 'gross_inr'],
      ['9', 'date'],
    ]);
    expect(cells[0][3]).toContain('must not be negative');
    expect(within(panel).getByRole('link', { name: 'Download CSV template' })).toBeTruthy();
  });

  it('still shows the panel for a 422 bad-schema file; the page never goes blank', () => {
    setStore({
      importError: {
        message: 'product_cost_inr is missing from the CSV header.',
        hint: 'Add the column product_cost_inr (see the CSV template).',
        issues: [{ path: 'product_cost_inr', message: 'column is missing' }],
      },
    });
    const { container } = render(<ImportScreen />);
    const panel = container.querySelector('.vpanel') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(text(panel)).toContain('product_cost_inr is missing from the CSV header.');
    expect(text(panel.querySelector('tbody tr'))).toMatch(/header.*product_cost_inr.*column is missing/);
    expect(within(panel).getByRole('link', { name: 'Download CSV template' })).toBeTruthy();
    // The rest of the screen is still there.
    expect(screen.getByRole('button', { name: 'Load sample orders' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Data-quality drills' })).toBeTruthy();
  });

  it('offers the bad_values drill beside the existing ones', () => {
    setStore({});
    render(<ImportScreen />);
    const drills = screen.getByRole('heading', { name: 'Data-quality drills' }).closest('section') as HTMLElement;
    const names = within(drills)
      .getAllByRole('button')
      .map((b) => text(b));
    expect(names.some((n) => n.includes('Bad values (CSV)'))).toBe(true);
    expect(names.some((n) => n.includes('Duplicate order'))).toBe(true);
    expect(names.some((n) => n.includes('Bad schema (CSV)'))).toBe(true);
  });
});

describe('header disclaimer', () => {
  it('says demo for samples and the demo workspace, and "Your data" for an upload', () => {
    const a = analysisOf(FIXTURE);
    setStore({ analysis: a, dataset: datasetOf(a), datasetId: a.dataset_id });
    const first = render(<TopBar route="ledger" onError={noop} />);
    expect(text(first.container.querySelector('.topbar-disclaimer'))).toBe('Demo uses synthetic data. Not a live production system.');
    cleanup();

    h.mode = 'account';
    setStore({ analysis: a, dataset: datasetOf(a, { source: 'upload:orders.csv' }), datasetId: a.dataset_id });
    const second = render(<TopBar route="ledger" onError={noop} />);
    expect(text(second.container.querySelector('.topbar-disclaimer'))).toBe('Your data · operational contribution, not statutory profit');
  });
});

describe('integrations roadmap', () => {
  it('shows CSV / JSON and the report importers as available, the API connectors as planned, with no links, tokens or connected state', () => {
    const { container } = render(<Integrations />);
    const live = container.querySelector('.intg-item.is-live') as HTMLElement;
    expect(text(live)).toContain('CSV / JSON upload');
    expect(text(live)).toContain('working');
    const reports = Array.from(container.querySelectorAll('.intg-item.is-report'));
    expect(reports.map((p) => text(p.querySelector('.intg-name')))).toEqual([
      'Amazon settlement report',
      'Flipkart orders report',
      'Myntra orders report',
      'Shopify orders export',
      'Razorpay payments',
      'Shiprocket shipments',
    ]);
    for (const r of reports) expect(text(r)).toContain('Available now');
    const planned = Array.from(container.querySelectorAll('.intg-item.is-planned'));
    expect(planned.map((p) => text(p.querySelector('.intg-name')))).toEqual(['Shopify API', 'Amazon SP-API', 'Flipkart Seller API', 'Myntra partner API', 'Meta Ads', 'Google Ads']);
    for (const p of planned) {
      expect(p.getAttribute('aria-disabled')).toBe('true');
      expect(text(p)).toContain('Planned');
      expect(text(p.querySelector('.intg-prereq'))).toMatch(/Not connected\.$/);
    }
    expect(text(planned[0])).toContain('Build first');
    expect(text(planned[0].querySelector('.intg-prereq'))).toContain('custom app token');
    expect(text(planned[1].querySelector('.intg-prereq'))).toContain('SP-API developer registration and your seller authorisation');
    expect(text(planned[2].querySelector('.intg-prereq'))).toContain('Seller API key');
    expect(text(planned[3].querySelector('.intg-prereq'))).toContain('partner invitation');
    expect(container.querySelectorAll('a').length).toBe(0);
    expect(container.querySelector('input[type="password"]')).toBeNull();
    // No connected state anywhere: only "Not connected." in the planned notes.
    expect(text(container)).not.toMatch(/\bConnected\b/);
    expect(text(container.querySelector('.intg-timeline'))).toBe('NowCSV / JSON and report filesNextShopify API, then Meta AdsLaterAmazon, Flipkart and Myntra APIs, Google Ads');
  });

  it('records "Notify me" in this browser only', () => {
    render(<Integrations />);
    fireEvent.click(screen.getByRole('button', { name: 'Notify me' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@brand.in' } });
    fireEvent.change(screen.getByLabelText('Integration'), { target: { value: 'meta_ads' } });
    fireEvent.click(screen.getByRole('button', { name: 'Notify me' }));
    expect(screen.getByRole('status').textContent).toContain('Recorded. Nothing is connected yet.');
    const saved = readNotifyRequests();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ email: 'owner@brand.in', integration: 'meta_ads' });
    expect(Number.isNaN(Date.parse(saved[0].date))).toBe(false);
  });

  it('has a compact variant for the landing page', () => {
    const { container } = render(<Integrations compact />);
    expect(container.querySelector('.intg-compact')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Notify me' })).toBeNull();
    // CSV / JSON, six report importers and six planned connectors.
    expect(container.querySelectorAll('.intg-item').length).toBe(13);
  });
});
