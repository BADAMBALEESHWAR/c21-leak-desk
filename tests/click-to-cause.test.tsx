// @vitest-environment jsdom
// Click-to-cause: ledger links carry their filters through the router, and the ledger opened on a leak cause
// shows the problem strip (sentence, fix link, breadcrumb) and only that cause's orders.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyze } from '../api/src/engine/analyze';
import type { AnalysisResponse, OrderResult } from '../web/src/api/types';
import { setLanguage } from '../web/src/i18n';
import { formatInr } from '../web/src/lib/format';
import { fromHref, hasLedgerFilter, ledgerHref, parseFrom, parseHash, parseLedgerQuery, replaceWithBareRoute } from '../web/src/lib/router';
import { EXTENDED, rows } from './helpers';

const h = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));

vi.mock('../web/src/auth/AuthContext', () => ({
  useAuth: () => ({ ready: true, mode: 'demo', config: { enabled: false }, user: null, hasSession: false, sessionEnded: false, signOut: () => undefined, loginUrl: '/login/', backToWorkspace: () => undefined }),
}));

vi.mock('../web/src/state/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../web/src/state/store')>();
  return { ...actual, useStore: () => h.store };
});

import { focusFigures, LedgerScreen, matchesLedgerQuery } from '../web/src/screens/LedgerScreen';
import { largestDeductions } from '../web/src/components/OrderDrawer';

const noop = () => undefined;
const analysis = { ...(analyze(rows(EXTENDED), { attribution: 'allocate' }) as unknown as AnalysisResponse), analysis_id: 'a-ext', dataset_id: 'd-ext' };

function setStore() {
  h.store = {
    analysis,
    dataset: null,
    drawer: null,
    drawerOpen: false,
    openOrderResult: noop,
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
    fixedCosts: 0,
    setFixedCosts: noop,
    correctedOrderIds: [],
  };
}

describe('router: ledger filters', () => {
  it('builds and parses the same filter (round trip)', () => {
    const q = { cause: 'full_return_partial_recovery', channel: 'Myntra', product: 'P 01&x', month: '2025-10', payment: 'cod', from: 'pulse.months' };
    const href = ledgerHref(q);
    expect(href.startsWith('#/ledger?cause=full_return_partial_recovery')).toBe(true);
    const loc = parseHash(href);
    expect(loc.route).toBe('ledger');
    expect(parseLedgerQuery(loc.params)).toEqual(q);
    expect(hasLedgerFilter(parseLedgerQuery(loc.params))).toBe(true);
  });

  it('leaves out empty values and drops a malformed month', () => {
    expect(ledgerHref({ cause: 'x', channel: undefined, product: '' })).toBe('#/ledger?cause=x');
    expect(parseLedgerQuery(new URLSearchParams('month=2025-13&channel=+A+'))).toEqual({ channel: 'A' });
    expect(hasLedgerFilter({ from: 'leaks' })).toBe(false);
  });

  it('reads where the click came from for the breadcrumb', () => {
    expect(parseFrom('leaks')).toEqual({ route: 'leaks', tab: null });
    expect(parseFrom('pulse.months')).toEqual({ route: 'pulse', tab: 'months' });
    expect(parseFrom('nowhere')).toBeNull();
    expect(fromHref('pulse.leaks')).toBe('#/pulse?tab=leaks');
  });

  it('strips only the one-shot deep-link parameters, keeping the filters', () => {
    window.history.replaceState(null, '', '/app/#/ledger?load=demo_12m&order=O1&cause=fees_exceed_margin&from=leaks&period_end=2025-09-30');
    replaceWithBareRoute('ledger');
    expect(window.location.hash).toBe('#/ledger?cause=fees_exceed_margin&from=leaks');
    window.history.replaceState(null, '', '/app/#/pulse?load=demo_12m&tab=months');
    replaceWithBareRoute('pulse');
    expect(window.location.hash).toBe('#/pulse?tab=months');
  });
});

describe('ledger opened on a leak cause', () => {
  beforeEach(() => {
    setLanguage('en');
    setStore();
  });
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/app/#/ledger');
  });

  const group = analysis.leaks.find((g) => g.cause === 'full_return_partial_recovery') ?? analysis.leaks[0];

  it('has leaks to test with', () => {
    expect(group).toBeTruthy();
    expect(group.count).toBeGreaterThan(0);
  });

  it('shows the problem strip with the cause sentence, a fix link and the breadcrumb', () => {
    window.history.replaceState(null, '', `/app/${ledgerHref({ cause: group.cause, from: 'leaks' })}`);
    render(<LedgerScreen />);
    const strip = screen.getByRole('region', { name: 'Filtered orders' });
    const sentence = within(strip).getByRole('status').textContent ?? '';
    expect(sentence).toMatch(/^Problem:/);
    expect(sentence).toContain(`${group.count} orders`);
    if (group.lost_inr !== null) expect(sentence).toContain(formatInr(group.lost_inr));
    if (group.cause === 'full_return_partial_recovery') {
      const matching = analysis.orders.filter((o) => o.leak_cause === group.cause);
      const f = focusFigures(matching);
      expect(sentence).toContain(`refunded in full with only ${formatInr(f.recovered)} of ${formatInr(f.productCost)} recovered`);
    }
    const fix = within(strip).getByRole('link', { name: /Fix this/ });
    expect(fix.getAttribute('href')).toBe(`#/leaks?fix=${group.cause}`);
    const crumbs = within(strip).getByRole('list', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Leaks' }).getAttribute('href')).toBe('#/leaks');
    expect(within(strip).getByRole('link', { name: 'Clear filter' }).getAttribute('href')).toBe('#/ledger');
  });

  it('lists only the orders with that cause, each marked as a match', () => {
    window.history.replaceState(null, '', `/app/${ledgerHref({ cause: group.cause })}`);
    const { container } = render(<LedgerScreen />);
    const table = container.querySelector('.orders-table') as HTMLElement;
    const rowsShown = [...table.querySelectorAll('tbody tr')];
    const expected = analysis.orders.filter((o) => o.leak_cause === group.cause).map((o) => o.order_id);
    expect(rowsShown.length).toBe(Math.min(50, expected.length));
    const ids = rowsShown.map((r) => r.querySelector('.order-link')?.textContent);
    for (const id of ids) expect(expected).toContain(id);
    for (const r of rowsShown) expect(r.className).toContain('row-match');
  });

  it('follows a new filter from the address without a reload', () => {
    window.history.replaceState(null, '', '/app/#/ledger');
    const { container } = render(<LedgerScreen />);
    expect(screen.queryByRole('region', { name: 'Filtered orders' })).toBeNull();
    const channel = analysis.groups.channel[0].key;
    act(() => {
      window.location.hash = ledgerHref({ channel });
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    const strip = screen.getByRole('region', { name: 'Filtered orders' });
    expect(within(strip).getByRole('status').textContent).toMatch(new RegExp(`^Showing: Channel ${channel}: `));
    const ids = [...container.querySelectorAll('.orders-table tbody tr .order-link')].map((e) => e.textContent);
    const want = analysis.orders.filter((o) => o.channel === channel);
    expect(ids.length).toBe(Math.min(50, want.length));
    expect(ids.every((id) => want.some((o) => o.order_id === id))).toBe(true);
  });
});

describe('filters and the drawer line', () => {
  const sample = analysis.orders[0];
  it('matches month by order date, and every filter together', () => {
    const month = sample.date.slice(0, 7);
    expect(matchesLedgerQuery(sample, { month })).toBe(true);
    expect(matchesLedgerQuery(sample, { month: '1999-01' })).toBe(false);
    expect(matchesLedgerQuery(sample, { month, channel: sample.channel, product: sample.product_id })).toBe(true);
    expect(matchesLedgerQuery(sample, { channel: `${sample.channel}-other` })).toBe(false);
  });

  it('names the two largest deductions, without the refund', () => {
    const losing = analysis.orders.find((o) => o.contribution_inr !== null && o.contribution_inr < 0) as OrderResult;
    const top = largestDeductions(losing.lines);
    expect(top.length).toBe(2);
    expect(top.every((l) => l.key !== 'refund' && l.kind === 'deduction')).toBe(true);
    expect(Math.abs(top[0].amount_inr as number)).toBeGreaterThanOrEqual(Math.abs(top[1].amount_inr as number));
  });
});
