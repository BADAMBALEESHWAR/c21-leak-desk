import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../api/src/app';
import type { AuthSettings } from '../api/src/auth';
import type { OAuthSettings } from '../api/src/auth-oauth';
import { DEFAULT_ASSUMPTIONS, fetchOrders, mapShopifyOrder, mapShopifyOrders, normalizeShop, shopifyGraphql, verifyShopifyHmac, type ShopifyOrder } from '../api/src/connectors/shopify';
import { connectors, decryptToken } from '../api/src/connectors/store';

// Shopify connector against a fake Shopify (global fetch stubbed): token check, SSRF guard, order mapping, pagination,
// throttling, guest vs signed-in connect (token encrypted, never returned), sync with dedupe and updates, disconnect, OAuth.

const SECRET = 'shopify-test-secret-0123456789abcdef';
const oauth: OAuthSettings = { google: { clientId: 'gc', clientSecret: 'gs' }, github: null, sessionSecret: SECRET, publicUrl: 'https://profyn.example', secureCookies: true };
const noCognito: AuthSettings = { enabled: false, verify: null, publicConfig: { enabled: false, domain: null, client_id: null, region: 'ap-south-1' } };
const app = createApp({ auth: noCognito, oauth });
const api = '/api/v1';

const SHOP = 'demo-store.myshopify.com';
// Built at run time so secret scanners never mistake it for a real token.
const TOKEN = ['shpat', 'test', 'not', 'a', 'real', 'token'].join('_');
const A = { shipping_inr: 70, fee_pct: 2, return_cost_inr: 80, cod_fee_inr: 30 };

const money = (n: number) => ({ shopMoney: { amount: n.toFixed(2) } });
const variant = (id: string, sku: string, cost: number | null) => ({ id: `gid://shopify/ProductVariant/${id}`, sku, product: { id: `gid://shopify/Product/${id}`, handle: sku.toLowerCase() }, inventoryItem: { unitCost: cost === null ? null : { amount: cost.toFixed(2) } } });

// Three realistic orders in the enriched shape the mapper reads.
const kept: ShopifyOrder = {
  id: 'gid://shopify/Order/1',
  name: '#1001',
  createdAt: '2026-09-30T20:00:00Z', // 01:30 on 1 October in India
  sourceName: 'web',
  paymentGatewayNames: ['razorpay'],
  currencyCode: 'INR',
  cancelledAt: null,
  test: false,
  subtotalPriceSet: money(1800),
  totalDiscountsSet: money(200),
  totalRefundedSet: money(0),
  totalShippingPriceSet: money(0),
  lineItems: {
    nodes: [
      { id: 'gid://shopify/LineItem/11', quantity: 1, sku: 'TEE-RED-M', title: 'Tee', variant: variant('1', 'TEE-RED-M', 500) },
      { id: 'gid://shopify/LineItem/12', quantity: 2, sku: 'SOCKS', title: 'Socks', variant: variant('2', 'SOCKS', 250) },
    ],
  },
  refunds: [],
};
const returnedCod: ShopifyOrder = {
  id: 'gid://shopify/Order/2',
  name: '#1002',
  createdAt: '2026-10-02T05:00:00Z',
  sourceName: 'shopify_draft_order',
  paymentGatewayNames: ['Cash on Delivery (COD)'],
  currencyCode: 'INR',
  subtotalPriceSet: money(1200),
  totalDiscountsSet: money(0),
  totalRefundedSet: money(1200),
  totalShippingPriceSet: money(50),
  lineItems: { nodes: [{ id: 'gid://shopify/LineItem/21', quantity: 2, sku: 'TEE-RED-M', variant: variant('1', 'TEE-RED-M', 500) }] },
  refunds: [{ createdAt: '2026-10-05T06:00:00Z', totalRefundedSet: money(1200), refundLineItems: { nodes: [{ quantity: 2, restockType: 'RETURN', lineItem: { id: 'gid://shopify/LineItem/21' } }] } }],
};
const noCost: ShopifyOrder = {
  id: 'gid://shopify/Order/3',
  name: '#1003',
  createdAt: '2026-10-03T10:00:00Z',
  sourceName: 'pos',
  paymentGatewayNames: ['shopify_payments'],
  currencyCode: 'INR',
  subtotalPriceSet: money(999),
  totalDiscountsSet: money(0),
  totalRefundedSet: money(0),
  totalShippingPriceSet: money(0),
  lineItems: {
    nodes: [
      { id: 'gid://shopify/LineItem/31', quantity: 1, sku: 'MUG', variant: variant('3', 'MUG', null) },
      { id: 'gid://shopify/LineItem/32', quantity: 1, sku: 'TEE-RED-M', variant: variant('1', 'TEE-RED-M', 500) },
    ],
  },
  refunds: [],
};

describe('mapping', () => {
  it('maps a kept prepaid order: gross adds discounts back, IST date, assumed shipping and fee', () => {
    expect(mapShopifyOrder(kept, A)).toEqual({
      order_id: 'SH1001',
      date: '2026-10-01',
      gross_inr: 2000,
      discount_inr: 200,
      refund_inr: 0,
      net_sales_inr: null,
      product_cost_inr: 1000,
      recovered_product_cost_inr: 0,
      shipping_inr: 70,
      payment_fee_inr: 36,
      return_cost_inr: 0,
      returned: false,
      channel: 'web',
      product_id: 'TEE-RED-M',
      payment_type: 'prepaid',
      units: 3,
      refund_date: null,
      note: 'shopify; shipping/fee assumed',
    });
  });

  it('maps a returned COD order: restocked units recover their cost, COD fee and return cost added', () => {
    const row = mapShopifyOrder(returnedCod, A);
    expect(row).toMatchObject({
      order_id: 'SH1002',
      gross_inr: 1200,
      refund_inr: 1200,
      returned: true,
      product_cost_inr: 1000,
      recovered_product_cost_inr: 1000,
      return_cost_inr: 80,
      payment_type: 'cod',
      payment_fee_inr: 25 + 30,
      refund_date: '2026-10-05',
      channel: 'draft',
    });
  });

  it('a line without "Cost per item" makes product cost unknown (null), never zero', () => {
    const row = mapShopifyOrder(noCost, A);
    expect(row.product_cost_inr).toBeNull();
    expect(row).toMatchObject({ channel: 'pos', payment_type: 'prepaid', returned: false, recovered_product_cost_inr: 0 });
  });

  it('a refunded line not restocked is a return without recovery; refunds over item value are capped', () => {
    const o: ShopifyOrder = {
      ...returnedCod,
      totalRefundedSet: money(1250),
      refunds: [{ createdAt: '2026-10-05T06:00:00Z', refundLineItems: { nodes: [{ quantity: 2, restockType: 'NO_RESTOCK', lineItem: { id: 'gid://shopify/LineItem/21' } }] } }],
    };
    const row = mapShopifyOrder(o, A);
    expect([row.returned, row.recovered_product_cost_inr, row.refund_inr]).toEqual([true, 0, 1200]);
  });

  it('skips test and cancelled orders and counts them', () => {
    const { rows, skipped } = mapShopifyOrders([kept, { ...kept, name: '#9', test: true }, { ...kept, name: '#10', cancelledAt: '2026-10-01T00:00:00Z' }], DEFAULT_ASSUMPTIONS);
    expect(rows.map((r) => r.order_id)).toEqual(['SH1001']);
    expect(skipped).toEqual({ cancelled: 1, test: 1 });
  });
});

describe('shop address (SSRF guard)', () => {
  it('accepts only <name>.myshopify.com, or a bare name', () => {
    expect(normalizeShop('demo-store')).toBe(SHOP);
    expect(normalizeShop(' Demo-Store.myshopify.com ')).toBe(SHOP);
    for (const bad of ['evil.com', 'x.myshopify.com.evil.com', 'http://x.myshopify.com', 'x.myshopify.com/admin', 'x.myshopify.com:443', '-x.myshopify.com', 'a@x.myshopify.com', '', 'x.myshopify.com.', '127.0.0.1']) {
      expect(normalizeShop(bad)).toBeNull();
    }
    // A bare name can only ever become a myshopify.com host.
    expect(normalizeShop('localhost')).toBe('localhost.myshopify.com');
    expect(normalizeShop('demo-store', { allowBare: false })).toBeNull();
  });
});

// ---- fake Shopify ----

interface FakeOrder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sourceName: string;
  gateways: string[];
  subtotal: number;
  discount: number;
  refunded: number;
  lines: Array<{ id: string; variant: string; quantity: number }>;
  refunds?: Array<{ createdAt: string; lines: Array<{ line: string; quantity: number; restockType: string }> }>;
  test?: boolean;
  cancelledAt?: string | null;
}
const VARIANTS: Record<string, { sku: string; cost: number | null }> = { V1: { sku: 'TEE-RED-M', cost: 500 }, V2: { sku: 'SOCKS', cost: 250 }, V3: { sku: 'MUG', cost: null } };

let fake: { token: string; scopes: string[]; currency: string; orders: FakeOrder[]; throttle: number; maxCost: number | null };
const calls: Array<{ url: string; op: string; variables: Record<string, any>; token: string | null }> = [];

const at = (iso: string) => iso;
function baseOrders(): FakeOrder[] {
  return [
    { id: 'gid://shopify/Order/1', name: '#1001', createdAt: at('2026-09-30T20:00:00Z'), updatedAt: '2026-10-01T00:00:00Z', sourceName: 'web', gateways: ['razorpay'], subtotal: 1800, discount: 200, refunded: 0, lines: [{ id: 'L11', variant: 'V1', quantity: 1 }, { id: 'L12', variant: 'V2', quantity: 2 }] },
    {
      id: 'gid://shopify/Order/2', name: '#1002', createdAt: '2026-10-02T05:00:00Z', updatedAt: '2026-10-05T06:00:00Z', sourceName: 'web', gateways: ['Cash on Delivery (COD)'], subtotal: 1200, discount: 0, refunded: 1200,
      lines: [{ id: 'L21', variant: 'V1', quantity: 2 }], refunds: [{ createdAt: '2026-10-05T06:00:00Z', lines: [{ line: 'L21', quantity: 2, restockType: 'RETURN' }] }],
    },
    { id: 'gid://shopify/Order/3', name: '#1003', createdAt: '2026-10-03T10:00:00Z', updatedAt: '2026-10-03T10:00:00Z', sourceName: 'pos', gateways: ['shopify_payments'], subtotal: 999, discount: 0, refunded: 0, lines: [{ id: 'L31', variant: 'V3', quantity: 1 }] },
    { id: 'gid://shopify/Order/4', name: '#1004', createdAt: '2026-10-04T10:00:00Z', updatedAt: '2026-10-04T10:00:00Z', sourceName: 'web', gateways: ['bogus'], subtotal: 500, discount: 0, refunded: 0, lines: [{ id: 'L41', variant: 'V2', quantity: 2 }], test: true },
    { id: 'gid://shopify/Order/5', name: '#1005', createdAt: '2026-10-04T11:00:00Z', updatedAt: '2026-10-04T12:00:00Z', sourceName: 'web', gateways: ['razorpay'], subtotal: 500, discount: 0, refunded: 500, lines: [{ id: 'L51', variant: 'V2', quantity: 2 }], cancelledAt: '2026-10-04T12:00:00Z' },
  ];
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const cost = { requestedQueryCost: 50, throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 1900, restoreRate: 100 } };

function graphql(op: string, v: Record<string, any>) {
  const node = (o: FakeOrder) => ({
    id: o.id, name: o.name, createdAt: o.createdAt, updatedAt: o.updatedAt, sourceName: o.sourceName, paymentGatewayNames: o.gateways, currencyCode: fake.currency, cancelledAt: o.cancelledAt ?? null, test: Boolean(o.test),
    subtotalPriceSet: money(o.subtotal), totalDiscountsSet: money(o.discount), totalRefundedSet: money(o.refunded), totalShippingPriceSet: money(0),
    lineItems: { pageInfo: { hasNextPage: false }, nodes: o.lines.map((l) => ({ id: l.id, quantity: l.quantity, sku: VARIANTS[l.variant].sku, title: 'x', variant: { id: l.variant, sku: VARIANTS[l.variant].sku } })) },
    refunds: (o.refunds ?? []).map((r, i) => ({ id: `R${i}`, createdAt: r.createdAt })),
  });
  switch (op) {
    case 'ProfynShop':
      return { shop: { name: 'Demo Store', myshopifyDomain: SHOP, currencyCode: fake.currency }, currentAppInstallation: { accessScopes: fake.scopes.map((handle) => ({ handle })) } };
    case 'ProfynPlan':
      return { shop: { plan: { publicDisplayName: 'Basic' } } };
    case 'ProfynCount':
      return { ordersCount: { count: fake.orders.length, precision: 'EXACT' } };
    case 'ProfynOrders': {
      const since = /created_at:>=(\d{4}-\d{2}-\d{2})/.exec(v.query)?.[1] ?? '0000';
      const updated = /updated_at:>='([^']+)'/.exec(v.query)?.[1];
      const list = fake.orders.filter((o) => o.createdAt.slice(0, 10) >= since && (!updated || o.updatedAt >= updated)).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      const start = v.after ? Number(v.after) : 0;
      const page = list.slice(start, start + v.first);
      const end = start + page.length;
      return { orders: { pageInfo: { hasNextPage: end < list.length, endCursor: String(end) }, nodes: page.map(node) } };
    }
    case 'ProfynVariants':
      return { nodes: v.ids.map((id: string) => (VARIANTS[id] ? { id, sku: VARIANTS[id].sku, product: { id: `P${id}`, handle: VARIANTS[id].sku.toLowerCase() }, inventoryItem: { unitCost: VARIANTS[id].cost === null ? null : { amount: String(VARIANTS[id].cost) } } } : null)) };
    case 'ProfynRefunds':
      return {
        nodes: v.ids.map((id: string) => {
          const o = fake.orders.find((x) => x.id === id)!;
          return { id, refunds: (o.refunds ?? []).map((r) => ({ createdAt: r.createdAt, totalRefundedSet: money(o.refunded), refundLineItems: { nodes: r.lines.map((l) => ({ quantity: l.quantity, restockType: l.restockType, lineItem: { id: l.line } })) } })) };
        }),
      };
    default:
      throw new Error(`unexpected ${op}`);
  }
}

beforeEach(() => {
  calls.length = 0;
  fake = { token: TOKEN, scopes: ['read_orders', 'read_products', 'read_inventory'], currency: 'INR', orders: baseOrders(), throttle: 0, maxCost: null };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = (init?.headers ?? {}) as Record<string, string>;
      // Google sign-in (for the signed-in owner).
      if (url.host === 'oauth2.googleapis.com') return json({ access_token: 'g' });
      if (url.host === 'openidconnect.googleapis.com') return json({ sub: who.sub, email: who.email, email_verified: true, name: 'Owner' });
      if (url.host !== SHOP) return json({ errors: 'Not Found' }, 404);
      if (url.pathname === '/admin/oauth/access_token') {
        const b = JSON.parse(String(init?.body));
        return b.code === 'good-code' && b.client_secret === 'app-secret' ? json({ access_token: fake.token, scope: fake.scopes.join(',') }) : json({ error: 'invalid' }, 400);
      }
      if (url.pathname !== '/admin/api/2026-07/graphql.json') return json({ errors: 'Not Found' }, 404);
      const body = JSON.parse(String(init?.body));
      const op = /query (\w+)/.exec(body.query)?.[1] ?? '';
      calls.push({ url: url.toString(), op, variables: body.variables, token: headers['X-Shopify-Access-Token'] ?? null });
      if (headers['X-Shopify-Access-Token'] !== fake.token) return json({ errors: '[API] Invalid API key or access token (unrecognized login or wrong password)' }, 401);
      if (fake.throttle > 0) {
        fake.throttle--;
        return json({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }], extensions: { cost: { requestedQueryCost: 10, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 0, restoreRate: 1000 } } } });
      }
      if (op === 'ProfynOrders' && fake.maxCost !== null && body.variables.first > fake.maxCost) {
        return json({ errors: [{ message: 'Query cost is too high', extensions: { code: 'MAX_COST_EXCEEDED', cost: body.variables.first * 40, maxCost: fake.maxCost * 40 } }] });
      }
      return json({ data: graphql(op, body.variables), extensions: { cost } });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

let who = { sub: 'g-shop-1', email: 'owner@brand.in' };
async function signIn(sub: string): Promise<string> {
  who = { sub, email: `${sub}@brand.in` };
  const start = await request(app).get(`${api}/auth/google`);
  const state = new URL(start.headers.location).searchParams.get('state')!;
  const stateCookie = ([] as string[]).concat(start.headers['set-cookie']).find((c) => c.startsWith('profyn_oauth='))!.split(';')[0];
  const cb = await request(app).get(`${api}/auth/google/callback`).query({ code: 'c', state }).set('Cookie', stateCookie);
  return ([] as string[]).concat(cb.headers['set-cookie']).find((c) => c.startsWith('profyn_session='))!.split(';')[0];
}
const accountOf = async (cookie: string) => (await request(app).get(`${api}/me`).set('Cookie', cookie)).body.user._id as string;

describe('client', () => {
  it('reads every page and fills in unit costs and refund lines', async () => {
    const r = await fetchOrders(SHOP, TOKEN, { since: '2026-01-01', pageSize: 2 });
    expect(r.orders.map((o) => o.name)).toEqual(['#1001', '#1003', '#1004', '#1005', '#1002']);
    const pages = calls.filter((c) => c.op === 'ProfynOrders');
    expect(pages.map((c) => c.variables.after)).toEqual([null, '2', '4']);
    expect(r.truncated).toBe(false);
    const rows = mapShopifyOrders(r.orders, A).rows;
    expect(rows.find((x) => x.order_id === 'SH1002')).toMatchObject({ returned: true, recovered_product_cost_inr: 1000, product_cost_inr: 1000 });
    expect(rows.find((x) => x.order_id === 'SH1001')).toMatchObject({ product_cost_inr: 1000, product_id: 'TEE-RED-M' });
    expect(calls.every((c) => c.url === `https://${SHOP}/admin/api/2026-07/graphql.json` && c.token === TOKEN)).toBe(true);
  });

  it('stops at the order cap and reports where to continue', async () => {
    const r = await fetchOrders(SHOP, TOKEN, { since: '2026-01-01', pageSize: 2, maxOrders: 3 });
    expect(r.orders).toHaveLength(3);
    expect(r.truncated).toBe(true);
    expect(r.watermark).toBe(r.orders[2].updatedAt);
  });

  it('waits and retries when Shopify throttles', async () => {
    fake.throttle = 2;
    const d = await shopifyGraphql(SHOP, TOKEN, 'query ProfynShop { shop { name } }');
    expect(d.shop.name).toBe('Demo Store');
    expect(calls).toHaveLength(3);
    fake.throttle = 5;
    await expect(shopifyGraphql(SHOP, TOKEN, 'query ProfynShop { shop { name } }')).rejects.toMatchObject({ status: 502, code: 'shopify_unavailable' });
  });

  it('asks for smaller pages when a query would cost too much', async () => {
    fake.maxCost = 10;
    const r = await fetchOrders(SHOP, TOKEN, { since: '2026-01-01', pageSize: 25 });
    expect(r.orders).toHaveLength(5);
    expect(calls.filter((c) => c.op === 'ProfynOrders').at(-1)!.variables.first).toBeLessThanOrEqual(10);
  });
});

describe('POST /connectors/shopify/test', () => {
  it('checks the token and returns the store, scopes and an order estimate', async () => {
    const r = await request(app).post(`${api}/connectors/shopify/test`).send({ shop: 'demo-store', token: TOKEN });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, shop: { name: 'Demo Store', domain: SHOP, currency: 'INR', plan: 'Basic' }, scopes: ['read_orders', 'read_products', 'read_inventory'], orders_estimate: 5 });
    expect(JSON.stringify(r.body)).not.toContain(TOKEN);
  });

  it('401 when Shopify rejects the token', async () => {
    const r = await request(app).post(`${api}/connectors/shopify/test`).send({ shop: SHOP, token: 'shpat_wrong' });
    expect(r.status).toBe(401);
    expect(r.body.error).toMatchObject({ code: 'shopify_unauthorized', message: 'Shopify rejected the access token' });
  });

  it('rejects other hosts without calling them', async () => {
    for (const shop of ['evil.com', 'x.myshopify.com.evil.com', 'http://demo-store.myshopify.com', '169.254.169.254', 'demo-store.myshopify.com/admin']) {
      const r = await request(app).post(`${api}/connectors/shopify/test`).send({ shop, token: TOKEN });
      expect([r.status, r.body.error.code]).toEqual([400, 'invalid_shop']);
    }
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('400 for a store that does not exist, 422 for a missing scope or token', async () => {
    const gone = await request(app).post(`${api}/connectors/shopify/test`).send({ shop: 'no-such-store', token: TOKEN });
    expect([gone.status, gone.body.error.code, gone.body.error.message]).toEqual([400, 'shop_not_found', 'Store not found — use your-store.myshopify.com']);
    fake.scopes = ['read_products', 'read_inventory'];
    const scope = await request(app).post(`${api}/connectors/shopify/test`).send({ shop: SHOP, token: TOKEN });
    expect([scope.status, scope.body.error.code, scope.body.error.message]).toEqual([422, 'missing_scope', 'Missing scope read_orders']);
    const none = await request(app).post(`${api}/connectors/shopify/test`).send({ shop: SHOP });
    expect([none.status, none.body.error.path]).toEqual([422, 'token']);
  });
});

describe('connect, sync, disconnect', () => {
  it('a guest imports once: dataset created, token not stored', async () => {
    const r = await request(app).post(`${api}/connectors/shopify/connect`).send({ shop: SHOP, token: TOKEN, since: '2026-01-01', assumptions: A });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ source: `shopify:${SHOP}`, rows_in: 3, rows_kept: 2, rows_rejected: 1, skipped: 2, skipped_detail: { cancelled: 1, test: 1 } });
    expect(r.body.kept_ids).toEqual(['SH1001', 'SH1002']);
    expect(r.body.flags.some((f: { order_id: string; field: string }) => f.order_id === 'SH1003' && f.field === 'product_cost_inr')).toBe(true);
    expect(r.body.cost_hint).toMatch(/Cost per item/);
    expect(r.body.connector).toMatchObject({ provider: 'shopify', shop: SHOP, orders_imported: 2, stored: false });
    expect(JSON.stringify(r.body)).not.toContain(TOKEN);
    expect(await connectors.get('guest')).toBeNull();
    const list = await request(app).get(`${api}/connectors`);
    expect(list.body).toEqual({ connectors: [], shopify_oauth: false });
    const ds = await request(app).get(`${api}/datasets/${r.body.dataset_id}`);
    expect(ds.body.rows_kept).toBe(2);
    expect((await request(app).post(`${api}/connectors/shopify/sync`)).status).toBe(404);
  });

  it('warns when the store does not sell in INR', async () => {
    fake.currency = 'USD';
    const r = await request(app).post(`${api}/connectors/shopify/connect`).send({ shop: SHOP, token: TOKEN, since: '2026-01-01' });
    expect(r.status).toBe(201);
    expect(r.body.currency_warning).toMatch(/USD/);
  });

  it('a signed-in owner keeps the connection with the token encrypted; sync adds new and updated orders; disconnect deletes it', async () => {
    const cookie = await signIn('g-shop-owner');
    const account = await accountOf(cookie);
    const r = await request(app).post(`${api}/connectors/shopify/connect`).set('Cookie', cookie).send({ shop: SHOP, token: TOKEN, since: '2026-01-01', assumptions: A });
    expect(r.status).toBe(201);
    expect(r.body.connector).toMatchObject({ stored: true, orders_imported: 2 });

    const saved = (await connectors.get(account))!;
    expect(saved.token_enc).not.toBe(TOKEN);
    expect(saved.token_enc).not.toContain(TOKEN);
    expect(saved.token_enc).not.toContain(Buffer.from(TOKEN).toString('base64url'));
    expect(decryptToken(saved.token_enc, SECRET)).toBe(TOKEN);
    expect(decryptToken(saved.token_enc, 'another-secret')).toBeNull();

    const list = await request(app).get(`${api}/connectors`).set('Cookie', cookie);
    expect(list.body.connectors).toEqual([
      expect.objectContaining({ provider: 'shopify', shop: SHOP, shop_name: 'Demo Store', currency: 'INR', orders_imported: 2, dataset_id: r.body.dataset_id, assumptions: A }),
    ]);
    expect(JSON.stringify(list.body)).not.toContain(TOKEN);
    expect(JSON.stringify(list.body)).not.toContain('token_enc');

    // In Shopify: #1001 is refunded and returned, a new order #1006 arrives, #1003 is touched without change.
    const now = new Date(Date.now() + 1000).toISOString();
    const o1 = fake.orders.find((o) => o.name === '#1001')!;
    Object.assign(o1, { updatedAt: now, refunded: 1800, refunds: [{ createdAt: now, lines: [{ line: 'L11', quantity: 1, restockType: 'RETURN' }, { line: 'L12', quantity: 2, restockType: 'RETURN' }] }] });
    fake.orders.find((o) => o.name === '#1002')!.updatedAt = now;
    fake.orders.push({ id: 'gid://shopify/Order/6', name: '#1006', createdAt: now, updatedAt: now, sourceName: 'web', gateways: ['razorpay'], subtotal: 750, discount: 0, refunded: 0, lines: [{ id: 'L61', variant: 'V2', quantity: 3 }] });

    const s = await request(app).post(`${api}/connectors/shopify/sync`).set('Cookie', cookie);
    expect(s.status).toBe(201);
    expect(s.body).toMatchObject({ appended_to: r.body.dataset_id, supersedes: r.body.dataset_id, rows_added: 1, rows_updated: 1, duplicates_ignored: 1, rows_kept: 3, source: `shopify:${SHOP}` });
    expect(s.body.connector).toMatchObject({ orders_imported: 3, stored: true });
    const updatedQuery = calls.filter((c) => c.op === 'ProfynOrders').at(-1)!.variables.query as string;
    expect(updatedQuery).toMatch(/updated_at:>='/);
    const after = (await connectors.get(account))!;
    expect(after.dataset_id).toBe(s.body.dataset_id);

    // The new version has #1001 as returned now.
    const analysis = await request(app).post(`${api}/datasets/${s.body.dataset_id}/analyses`).set('Cookie', cookie).send({});
    expect(analysis.status).toBe(201);
    const ws = await request(app).get(`${api}/workspace`).set('Cookie', cookie);
    expect(ws.body.datasets.map((d: { dataset_id: string }) => d.dataset_id)).toEqual([s.body.dataset_id]);

    // Nothing changed since: 200, unchanged.
    const again = await request(app).post(`${api}/connectors/shopify/sync`).set('Cookie', cookie);
    expect([again.status, again.body.unchanged, again.body.dataset_id]).toEqual([200, true, s.body.dataset_id]);

    const audit = (await request(app).get(`${api}/me/audit`).set('Cookie', cookie)).body.map((e: { kind: string }) => e.kind);
    expect(audit).toEqual(expect.arrayContaining(['connector_connected', 'connector_sync', 'import']));

    expect((await request(app).delete(`${api}/connectors/shopify`).set('Cookie', cookie)).status).toBe(204);
    expect(await connectors.get(account)).toBeNull();
    expect((await request(app).get(`${api}/connectors`).set('Cookie', cookie)).body.connectors).toEqual([]);
    expect((await request(app).post(`${api}/connectors/shopify/sync`).set('Cookie', cookie)).status).toBe(404);
  });

  it('explains when no order has a product cost', async () => {
    for (const o of fake.orders) o.lines = [{ id: `${o.id}-x`, variant: 'V3', quantity: 1 }];
    const r = await request(app).post(`${api}/connectors/shopify/connect`).send({ shop: SHOP, token: TOKEN, since: '2026-01-01' });
    expect([r.status, r.body.error.code]).toEqual([422, 'no_valid_rows']);
    expect(r.body.error.message).toMatch(/Cost per item/);
  });
});

describe('app install (OAuth)', () => {
  const sign = (q: Record<string, string>, secret = 'app-secret') =>
    createHmac('sha256', secret)
      .update(
        Object.keys(q)
          .sort()
          .map((k) => `${k}=${q[k]}`)
          .join('&'),
      )
      .digest('hex');

  it('verifies Shopify HMACs', () => {
    const q = { code: 'abc', shop: SHOP, state: 's', timestamp: '1700000000' };
    expect(verifyShopifyHmac({ ...q, hmac: sign(q) }, 'app-secret')).toBe(true);
    expect(verifyShopifyHmac({ ...q, hmac: sign(q, 'other') }, 'app-secret')).toBe(false);
    expect(verifyShopifyHmac({ ...q, shop: 'evil.myshopify.com', hmac: sign(q) }, 'app-secret')).toBe(false);
    expect(verifyShopifyHmac(q, 'app-secret')).toBe(false);
  });

  it('install redirects to Shopify; the callback rejects a bad HMAC and stores the token on a good one', async () => {
    expect((await request(app).get(`${api}/connectors/shopify/install`).query({ shop: SHOP })).status).toBe(404);
    vi.stubEnv('SHOPIFY_CLIENT_ID', 'app-id');
    vi.stubEnv('SHOPIFY_CLIENT_SECRET', 'app-secret');
    expect((await request(app).get(`${api}/connectors`)).body.shopify_oauth).toBe(true);
    // Guests sign in first.
    const anon = await request(app).get(`${api}/connectors/shopify/install`).query({ shop: SHOP });
    expect([anon.status, anon.headers.location]).toEqual([302, '/login/']);
    expect((await request(app).get(`${api}/connectors/shopify/install`).query({ shop: 'evil.com' })).status).toBe(400);

    const cookie = await signIn('g-shop-oauth');
    const start = await request(app).get(`${api}/connectors/shopify/install`).query({ shop: SHOP, return: '/app/' }).set('Cookie', cookie);
    expect(start.status).toBe(302);
    const to = new URL(start.headers.location);
    expect(to.origin + to.pathname).toBe(`https://${SHOP}/admin/oauth/authorize`);
    expect(Object.fromEntries(to.searchParams)).toMatchObject({ client_id: 'app-id', scope: 'read_orders,read_products,read_inventory', redirect_uri: 'https://profyn.example/api/v1/connectors/shopify/callback' });
    const state = to.searchParams.get('state')!;
    const stateCookie = ([] as string[]).concat(start.headers['set-cookie']).find((c) => c.startsWith('profyn_shopify='))!;
    expect(stateCookie).toMatch(/HttpOnly/);
    const both = `${cookie}; ${stateCookie.split(';')[0]}`;

    const q = { code: 'good-code', shop: SHOP, state, timestamp: String(Math.floor(Date.now() / 1000)) };
    const bad = await request(app).get(`${api}/connectors/shopify/callback`).query({ ...q, hmac: sign(q, 'wrong') }).set('Cookie', both);
    expect([bad.status, bad.body.error.code]).toEqual([400, 'invalid_state']);
    const otherState = await request(app).get(`${api}/connectors/shopify/callback`).query({ ...q, state: 'x', hmac: sign({ ...q, state: 'x' }) }).set('Cookie', both);
    expect(otherState.status).toBe(400);

    const ok = await request(app).get(`${api}/connectors/shopify/callback`).query({ ...q, hmac: sign(q) }).set('Cookie', both);
    expect(ok.status).toBe(302);
    expect(ok.headers.location).toBe('/app/#/overview?connected=shopify');
    const saved = (await connectors.get(await accountOf(cookie)))!;
    expect(saved).toMatchObject({ via: 'oauth', shop: SHOP, orders_imported: 2 });
    expect(decryptToken(saved.token_enc, SECRET)).toBe(TOKEN);
  });
});
