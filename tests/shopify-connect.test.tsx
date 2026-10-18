// @vitest-environment jsdom
// The Shopify connector on the Integrations card: Connect Shopify opens the drawer; Test connection shows the store;
// Connect and import stays disabled until the test passes, then posts the assumed costs, makes the new dataset current
// and opens the overview. Errors show inline. A saved connector shows Sync now, Open overview and Disconnect.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../web/src/i18n';

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

import { Integrations } from '../web/src/components/Integrations';
import { monthsAgo, normaliseShop, relativeTime, resetShopifyConnector, skippedCount } from '../web/src/components/ShopifyConnect';

type Call = { url: string; method: string; body: unknown };
type Reply = { status: number; json?: unknown };

const TEST_OK = {
  ok: true,
  shop: { name: 'Brand Store', domain: 'brand-store.myshopify.com', currency: 'INR', plan: 'basic' },
  scopes: ['read_orders', 'read_products', 'read_inventory', 'read_all_orders'],
  orders_estimate: 1300,
};

const IMPORTED = {
  dataset_id: 'ds-shop-1',
  rows_in: 1252,
  rows_kept: 1240,
  rows_rejected: 0,
  flags: [],
  skipped: { test: 4, cancelled: 8 },
  connector: { provider: 'shopify', shop: 'brand-store.myshopify.com', connected_at: '2026-10-18T09:00:00Z', last_sync_at: '2026-10-18T09:00:00Z', orders_imported: 1240, stored: false },
};

function connectorRow(minutesAgo = 5) {
  return {
    provider: 'shopify',
    shop: 'brand-store.myshopify.com',
    shop_name: 'Brand Store',
    currency: 'INR',
    connected_at: '2026-10-01T09:00:00Z',
    last_sync_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    orders_imported: 1240,
    dataset_id: 'ds-saved',
    assumptions: { shipping_inr: 60, fee_pct: 2, return_cost_inr: 0, cod_fee_inr: 0 },
  };
}

/** Routes fetch by "METHOD path"; every call is recorded with its parsed body. */
function mockApi(routes: Record<string, Reply | ((body: unknown) => Reply | Promise<Reply>)>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = String(init.method ?? 'GET');
    const path = String(url).replace(/^\/api\/v1/, '').split('?')[0];
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), method, body });
    const route = routes[`${method} ${path}`];
    const reply = typeof route === 'function' ? await route(body) : route ?? { status: 404, json: { error: { code: 'not_found', message: `No route ${method} ${path}` } } };
    return reply.status === 204
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify(reply.json ?? {}), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function setStore(over: Record<string, unknown> = {}) {
  const store = {
    datasetId: null,
    openSaved: vi.fn(async () => ({})),
    showToast: vi.fn(),
    ...over,
  };
  h.store = store;
  return store as typeof store & { openSaved: ReturnType<typeof vi.fn>; showToast: ReturnType<typeof vi.fn> };
}

async function openDrawer() {
  fireEvent.click(await screen.findByRole('button', { name: 'Connect Shopify' }));
  return screen.getByRole('dialog');
}

function fillCredentials(dialog: HTMLElement, shop = 'brand-store', token = 'shpat_test_123') {
  fireEvent.change(within(dialog).getByLabelText('Store address'), { target: { value: shop } });
  fireEvent.change(within(dialog).getByLabelText('Admin API access token'), { target: { value: token } });
}

beforeEach(() => {
  resetShopifyConnector();
  window.location.hash = '#/import';
  h.mode = 'demo';
  act(() => setLanguage('en'));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Shopify connect drawer', () => {
  it('tests the connection, shows the shop name and keeps Connect and import disabled until then', async () => {
    const calls = mockApi({ 'GET /connectors': { status: 200, json: { connectors: [], shopify_oauth: false } }, 'POST /connectors/shopify/test': { status: 200, json: TEST_OK } });
    setStore();
    render(<Integrations />);
    const dialog = await openDrawer();

    const connect = within(dialog).getByRole('button', { name: 'Connect and import' }) as HTMLButtonElement;
    expect(connect.disabled).toBe(true);
    // The token is a password field, not remembered by the browser.
    const tokenInput = within(dialog).getByLabelText('Admin API access token') as HTMLInputElement;
    expect(tokenInput.type).toBe('password');
    expect(tokenInput.getAttribute('autocomplete')).toBe('off');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show' }));
    expect(tokenInput.type).toBe('text');
    // The demo says the token is not kept.
    expect(dialog.textContent).toContain('In the demo the token is used once and not saved.');

    fillCredentials(dialog);
    expect(connect.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Test connection' }));

    expect(await within(dialog).findByText(/Connection works: Brand Store/)).toBeTruthy();
    const result = within(dialog).getByTestId('shopify-test-result');
    expect(result.textContent).toContain('INR');
    expect(result.textContent).toContain('read_orders');
    expect(result.textContent).toContain('about 1,300');
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: '/api/v1/connectors/shopify/test', body: { shop: 'brand-store.myshopify.com', token: 'shpat_test_123' } });
    expect(connect.disabled).toBe(false);

    // Changing the token after the test asks for a new test.
    fireEvent.change(tokenInput, { target: { value: 'shpat_other' } });
    expect(connect.disabled).toBe(true);
  });

  it('connects with the assumed costs, makes the new dataset current, says how many orders and opens the overview', async () => {
    let finish: (r: { status: number; json: unknown }) => void = () => undefined;
    const calls = mockApi({
      'GET /connectors': { status: 200, json: { connectors: [], shopify_oauth: false } },
      'POST /connectors/shopify/test': { status: 200, json: TEST_OK },
      'POST /connectors/shopify/connect': () => new Promise((resolve) => (finish = resolve)),
    });
    const store = setStore();
    render(<Integrations />);
    const dialog = await openDrawer();
    fillCredentials(dialog);

    // Every assumed cost carries the Assumed badge.
    for (const label of ['Average courier cost per order', 'Payment gateway fee', 'Reverse shipping per return', 'Extra COD charge per COD order']) {
      const input = within(dialog).getByLabelText(new RegExp(label));
      expect(input.closest('.field')?.querySelector('[data-provenance="assumed"]')).toBeTruthy();
    }
    fireEvent.change(within(dialog).getByLabelText(/Average courier cost per order/), { target: { value: '75' } });
    fireEvent.change(within(dialog).getByLabelText(/Extra COD charge/), { target: { value: '30' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Test connection' }));
    await within(dialog).findByText(/Connection works: Brand Store/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect and import' }));

    // Progress while Shopify is read.
    expect(await within(dialog).findByText('Importing orders from Shopify…')).toBeTruthy();
    const post = calls.find((c) => c.url.endsWith('/connectors/shopify/connect'));
    expect(post?.method).toBe('POST');
    expect(post?.body).toEqual({
      shop: 'brand-store.myshopify.com',
      token: 'shpat_test_123',
      since: monthsAgo(12),
      assumptions: { shipping_inr: 75, fee_pct: 2, return_cost_inr: 0, cod_fee_inr: 30 },
    });

    await act(async () => finish({ status: 201, json: IMPORTED }));
    await waitFor(() => expect(window.location.hash).toBe('#/overview'));
    expect(store.openSaved).toHaveBeenCalledTimes(1);
    expect(store.openSaved.mock.calls[0][0]).toMatchObject({ dataset_id: 'ds-shop-1', rows_kept: 1240 });
    expect(store.showToast).toHaveBeenCalledWith('Imported 1,240 orders from Brand Store · 12 test or cancelled orders left out');
  });

  it('shows the API error inline and keeps Connect and import disabled', async () => {
    mockApi({
      'GET /connectors': { status: 200, json: { connectors: [], shopify_oauth: false } },
      'POST /connectors/shopify/test': { status: 401, json: { error: { code: 'shopify_unauthorized', message: 'Shopify refused this token.', hint: 'Copy the Admin API access token again; it starts with shpat_.' } } },
    });
    setStore();
    render(<Integrations />);
    const dialog = await openDrawer();
    fillCredentials(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Test connection' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Shopify refused this token.');
    expect(alert.textContent).toContain('it starts with shpat_');
    expect((within(dialog).getByRole('button', { name: 'Connect and import' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('checks the store address and token before calling the API', async () => {
    const calls = mockApi({ 'GET /connectors': { status: 200, json: { connectors: [], shopify_oauth: false } } });
    setStore();
    render(<Integrations />);
    const dialog = await openDrawer();
    fireEvent.change(within(dialog).getByLabelText('Store address'), { target: { value: 'not a store!' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Test connection' }));
    expect(within(dialog).getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/your-store\.myshopify\.com.*Paste the Admin API access token/);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('offers the one-click install when the server has it, and says the token is stored when signed in', async () => {
    h.mode = 'account';
    mockApi({ 'GET /connectors': { status: 200, json: { connectors: [], shopify_oauth: true } } });
    setStore();
    render(<Integrations />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect Shopify' })).toBeTruthy());
    // Wait for GET /connectors before opening.
    await act(async () => undefined);
    const dialog = await openDrawer();
    expect(within(dialog).getByRole('heading', { name: 'Install Profyn from Shopify' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Install from Shopify' })).toBeTruthy();
    expect(dialog.textContent).toContain('The token is stored encrypted and never shown again.');
  });
});

describe('Shopify connected state', () => {
  it('shows the store, its orders and the last sync, with Sync now, Open overview and Disconnect', async () => {
    const calls = mockApi({
      'GET /connectors': { status: 200, json: { connectors: [connectorRow(5)], shopify_oauth: false } },
      'POST /connectors/shopify/sync': { status: 201, json: { ...IMPORTED, dataset_id: 'ds-shop-2', skipped: 0 } },
      'DELETE /connectors/shopify': { status: 204 },
    });
    const store = setStore();
    const { container } = render(<Integrations />);
    const row = container.querySelector('.intg-item.is-connector') as HTMLElement;
    await waitFor(() => expect(row.textContent).toContain('Connected · Brand Store · 1,240 orders · last sync 5 minutes ago'));
    expect(within(row).queryByRole('button', { name: 'Connect Shopify' })).toBeNull();
    expect(within(row).getByRole('button', { name: 'Open overview' })).toBeTruthy();

    fireEvent.click(within(row).getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(store.openSaved).toHaveBeenCalledTimes(1));
    expect(store.openSaved.mock.calls[0][0]).toMatchObject({ dataset_id: 'ds-shop-2' });
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/connectors/shopify/sync'))).toBe(true);
    await waitFor(() => expect(store.showToast).toHaveBeenCalledWith('Synced Brand Store: 1,240 orders in the data now'));

    // Disconnect asks first.
    fireEvent.click(within(row).getByRole('button', { name: 'Disconnect' }));
    expect(row.textContent).toContain('Disconnect Brand Store? The saved token is deleted.');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(within(row).getByRole('button', { name: 'Yes, disconnect' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/connectors/shopify'))).toBe(true));
  });

  it('opens the connected dataset from Open overview', async () => {
    mockApi({ 'GET /connectors': { status: 200, json: { connectors: [connectorRow(90)], shopify_oauth: false } } });
    const store = setStore({ datasetId: 'something-else' });
    const { container } = render(<Integrations />);
    const row = container.querySelector('.intg-item.is-connector') as HTMLElement;
    await waitFor(() => expect(row.textContent).toContain('last sync 2 hours ago'));
    fireEvent.click(within(row).getByRole('button', { name: 'Open overview' }));
    await waitFor(() => expect(window.location.hash).toBe('#/overview'));
    expect(store.openSaved.mock.calls[0][0]).toMatchObject({ dataset_id: 'ds-saved' });
  });
});

describe('Shopify helpers', () => {
  it('accepts a bare store name, a full address or an admin link', () => {
    expect(normaliseShop('brand-store')).toBe('brand-store.myshopify.com');
    expect(normaliseShop(' Brand-Store.myshopify.com ')).toBe('brand-store.myshopify.com');
    expect(normaliseShop('https://brand-store.myshopify.com/admin/orders')).toBe('brand-store.myshopify.com');
    expect(normaliseShop('https://admin.shopify.com/store/brand-store/orders')).toBe('brand-store.myshopify.com');
    expect(normaliseShop('brand.in')).toBeNull();
    expect(normaliseShop('')).toBeNull();
  });

  it('defaults to twelve months back and counts skipped orders in either shape', () => {
    expect(monthsAgo(12, new Date(2026, 9, 18))).toBe('2025-10-18');
    expect(skippedCount(7)).toBe(7);
    expect(skippedCount({ test: 2, cancelled: 3 })).toBe(5);
    expect(skippedCount(undefined)).toBe(0);
  });

  it('says when the last sync was, in words', () => {
    const now = Date.parse('2026-10-18T12:00:00Z');
    expect(relativeTime('2026-10-18T11:55:00Z', 'en', now)).toBe('5 minutes ago');
    expect(relativeTime('2026-10-17T12:00:00Z', 'en', now)).toBe('yesterday');
    expect(relativeTime(null, 'en', now)).toBe('');
  });
});
