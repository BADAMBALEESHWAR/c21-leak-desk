import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../errors.js';
import { paymentType } from '../schema/orders.js';

// Shopify connector: a GraphQL Admin API client (global fetch, no SDK) and the order → C21 row mapping.
// Only order, product and inventory fields are read; no customer fields (protected customer data).

export const SHOPIFY_SCOPES = ['read_orders', 'read_products', 'read_inventory'] as const;
/** At most this many orders per import. */
export const MAX_ORDERS = 20000;
export const apiVersion = () => process.env.SHOPIFY_API_VERSION || '2026-07';
/** Stop paginating after this long and import what was read; the next sync carries on from there. */
export const importBudgetMs = () => Number(process.env.SHOPIFY_IMPORT_BUDGET_MS) || 25000;

// ---- shop address (SSRF guard: requests only ever go to <name>.myshopify.com) ----

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** "your-store" or "your-store.myshopify.com" → "your-store.myshopify.com"; anything else (other hosts, URLs, paths) → null. */
export function normalizeShop(input: unknown, opts: { allowBare?: boolean } = {}): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (s.length === 0 || s.length > 100) return null;
  if ((opts.allowBare ?? true) && /^[a-z0-9][a-z0-9-]*$/.test(s)) s = `${s}.myshopify.com`;
  return SHOP_RE.test(s) ? s : null;
}

const badShop = () =>
  new HttpError(400, 'invalid_shop', 'Enter the store address as your-store.myshopify.com.', { path: 'shop', hint: 'Shopify admin → Settings → Domains shows the myshopify.com address.' });

export function requireShop(input: unknown): string {
  const shop = normalizeShop(input);
  if (!shop) throw badShop();
  return shop;
}

// ---- assumptions (costs Shopify does not know) ----

export interface Assumptions {
  /** Average courier cost per order. */
  shipping_inr: number;
  /** Payment gateway fee, % of order value. */
  fee_pct: number;
  /** Reverse shipping per returned order. */
  return_cost_inr: number;
  /** Extra cost per cash-on-delivery order. */
  cod_fee_inr: number;
}

export const DEFAULT_ASSUMPTIONS: Assumptions = { shipping_inr: 60, fee_pct: 2, return_cost_inr: 0, cod_fee_inr: 0 };

// ---- order shape (the GraphQL fields read, after enrichment) ----

export interface Money {
  shopMoney?: { amount?: string | number | null } | null;
}
export interface ShopifyVariant {
  id?: string;
  sku?: string | null;
  product?: { id?: string; handle?: string | null } | null;
  inventoryItem?: { unitCost?: { amount?: string | number | null } | null } | null;
}
export interface ShopifyLineItem {
  id?: string;
  quantity: number;
  sku?: string | null;
  title?: string | null;
  product?: { id?: string; handle?: string | null } | null;
  variant?: ShopifyVariant | null;
}
export interface ShopifyRefundLine {
  quantity: number;
  restockType?: string | null;
  lineItem?: { id?: string; variant?: ShopifyVariant | null } | null;
}
export interface ShopifyRefund {
  id?: string;
  createdAt: string;
  totalRefundedSet?: Money | null;
  refundLineItems?: { nodes: ShopifyRefundLine[]; pageInfo?: { hasNextPage?: boolean } } | null;
}
export interface ShopifyOrder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
  sourceName?: string | null;
  paymentGatewayNames?: string[] | null;
  currencyCode?: string | null;
  cancelledAt?: string | null;
  test?: boolean | null;
  subtotalPriceSet?: Money | null;
  totalDiscountsSet?: Money | null;
  totalRefundedSet?: Money | null;
  totalShippingPriceSet?: Money | null;
  lineItems?: { nodes: ShopifyLineItem[]; pageInfo?: { hasNextPage?: boolean } } | null;
  refunds?: ShopifyRefund[] | null;
}

// ---- mapping (pure) ----

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const amt = (m: Money | null | undefined) => round2(Math.max(0, num(m?.shopMoney?.amount) ?? 0));
/** The calendar date in India (IST, UTC+5:30) of an ISO timestamp. */
export const istDate = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);
const unitCost = (v: ShopifyVariant | null | undefined) => num(v?.inventoryItem?.unitCost?.amount);
const RESTOCKED = new Set(['RETURN', 'LEGACY_RESTOCK']);
const CHANNELS: Record<string, string> = { web: 'web', pos: 'pos', shopify_draft_order: 'draft' };
const PREPAID_GATEWAYS = /^(shopify_payments|shop_pay|gift_card|paypal|stripe|razorpay|payu|cashfree|phonepe|paytm|ccavenue)/;

/** "#1001" → "SH1001" (other characters a store adds to its order names are dropped). */
export function orderIdOf(name: string, gid?: string): string {
  const clean = String(name ?? '')
    .replace(/^#/, '')
    .replace(/[^A-Za-z0-9_-]/g, '');
  return `SH${clean || String(gid ?? '').split('/').pop() || 'unknown'}`;
}

/** COD when any gateway is cash on delivery; prepaid when any is a card/UPI/wallet gateway; otherwise unknown. */
export function paymentOf(names: string[] | null | undefined): 'cod' | 'prepaid' | null {
  const types = (names ?? []).map((n) => {
    const s = String(n).trim().toLowerCase();
    if (PREPAID_GATEWAYS.test(s.replace(/\s+/g, '_'))) return 'prepaid';
    return paymentType(s.replace(/_/g, ' '));
  });
  if (types.includes('cod')) return 'cod';
  if (types.includes('prepaid')) return 'prepaid';
  return null;
}

export const channelOf = (sourceName: string | null | undefined) => {
  const s = String(sourceName ?? '').trim().toLowerCase();
  return s ? (CHANNELS[s] ?? s) : undefined;
};

/**
 * One Shopify order as a raw C21 row. Shopify knows sales, discounts, refunds, returns and (with "Cost per item" set)
 * product cost; courier, gateway and reverse-shipping costs come from the owner's assumptions. Unknown is null, never zero.
 */
export function mapShopifyOrder(order: ShopifyOrder, a: Assumptions): Record<string, unknown> {
  const subtotal = amt(order.subtotalPriceSet);
  const discount = amt(order.totalDiscountsSet);
  const shippingCharged = amt(order.totalShippingPriceSet);
  const refunded = amt(order.totalRefundedSet);
  // subtotal is after discounts, so gross (before discounts) adds them back.
  const gross = round2(subtotal + discount);
  const cap = gross - discount;
  const refund = refunded > cap ? cap : refunded;

  const lines = order.lineItems?.nodes ?? [];
  const linesComplete = !order.lineItems?.pageInfo?.hasNextPage;
  let productCost: number | null = linesComplete && lines.length > 0 ? 0 : null;
  for (const li of lines) {
    if (productCost === null) break;
    const c = unitCost(li.variant);
    productCost = c === null ? null : productCost + (Number(li.quantity) || 0) * c;
  }
  if (productCost !== null) productCost = round2(productCost);

  const lineCost = new Map(lines.filter((li) => li.id).map((li) => [li.id as string, unitCost(li.variant)]));
  const refunds = [...(order.refunds ?? [])].sort((x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt));
  const refundLines = refunds.flatMap((r) => r.refundLineItems?.nodes ?? []);
  const restocked = refundLines.filter((rl) => RESTOCKED.has(String(rl.restockType ?? '').toUpperCase()));
  const fullRefund = refunded > 0 && refunded >= subtotal - 0.5;
  const returned = restocked.length > 0 || (fullRefund && refundLines.length > 0);

  let recovered: number | null = 0;
  if (returned) {
    for (const rl of restocked) {
      const own = unitCost(rl.lineItem?.variant);
      const c = own ?? (rl.lineItem?.id ? (lineCost.get(rl.lineItem.id) ?? null) : null);
      if (c === null) {
        recovered = null;
        break;
      }
      recovered += (Number(rl.quantity) || 0) * c;
    }
    if (recovered !== null) recovered = round2(productCost !== null ? Math.min(recovered, productCost) : recovered);
  }

  const pay = paymentOf(order.paymentGatewayNames);
  const fee = Math.round(((subtotal + shippingCharged) * a.fee_pct) / 100) + (pay === 'cod' ? a.cod_fee_inr : 0);
  const units = lines.reduce((n, li) => n + (Number(li.quantity) || 0), 0);
  const first = lines[0];
  const productId = String(first?.sku || first?.variant?.sku || first?.product?.handle || first?.variant?.product?.handle || '').trim();
  const channel = channelOf(order.sourceName);
  const notes = ['shopify; shipping/fee assumed'];
  if (refunded > cap) notes.push(`refund ${refunded} capped at item value`);
  if (!linesComplete) notes.push('over 100 line items: product cost unknown');

  return {
    order_id: orderIdOf(order.name, order.id),
    date: istDate(order.createdAt),
    gross_inr: gross,
    discount_inr: discount,
    refund_inr: refund,
    net_sales_inr: null,
    product_cost_inr: productCost,
    recovered_product_cost_inr: recovered,
    shipping_inr: a.shipping_inr,
    payment_fee_inr: fee,
    return_cost_inr: returned ? a.return_cost_inr : 0,
    returned,
    ...(channel ? { channel } : {}),
    ...(productId ? { product_id: productId } : {}),
    payment_type: pay,
    ...(Number.isInteger(units) && units >= 1 ? { units } : {}),
    refund_date: refunds.length ? istDate(refunds[0].createdAt) : null,
    note: notes.join('; '),
  };
}

export interface Skipped {
  cancelled: number;
  test: number;
}

/** Test and cancelled orders are not sales: they are counted, not imported. */
export function mapShopifyOrders(orders: ShopifyOrder[], a: Assumptions): { rows: Record<string, unknown>[]; skipped: Skipped } {
  const skipped: Skipped = { cancelled: 0, test: 0 };
  const rows: Record<string, unknown>[] = [];
  for (const o of orders) {
    if (o.test) skipped.test++;
    else if (o.cancelledAt) skipped.cancelled++;
    else rows.push(mapShopifyOrder(o, a));
  }
  return { rows, skipped };
}

// ---- GraphQL client ----

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const MAX_RETRIES = 3;

interface Cost {
  requestedQueryCost?: number;
  throttleStatus?: { maximumAvailable?: number; currentlyAvailable?: number; restoreRate?: number };
}

/** A query whose requested cost is over Shopify's single-query limit; the caller asks for fewer nodes. */
class CostTooHigh extends Error {
  constructor(
    readonly cost: number,
    readonly max: number,
  ) {
    super(`query cost ${cost} over ${max}`);
  }
}

const unauthorized = () =>
  new HttpError(401, 'shopify_unauthorized', 'Shopify rejected the access token', { path: 'token', hint: 'Copy the Admin API access token (shpat_…) again from the app in your Shopify admin.' });
const shopNotFound = () => new HttpError(400, 'shop_not_found', 'Store not found — use your-store.myshopify.com', { path: 'shop', hint: 'Shopify admin → Settings → Domains shows the myshopify.com address.' });
const busy = () => new HttpError(502, 'shopify_unavailable', 'Shopify is busy or rate-limiting this store. Try again in a minute.');
const missingScope = (scopes: string[]) =>
  new HttpError(422, 'missing_scope', `Missing scope ${scopes.join(', ')}`, { path: 'token', hint: `Give the app the Admin API scopes ${SHOPIFY_SCOPES.join(', ')}, reinstall it, and copy the new token.` });

function throttleWait(cost: Cost | undefined, attempt: number): number {
  const ts = cost?.throttleStatus;
  if (ts && typeof ts.restoreRate === 'number' && ts.restoreRate > 0) {
    const need = (cost?.requestedQueryCost ?? 100) - (ts.currentlyAvailable ?? 0);
    return Math.min(10_000, Math.max(50, Math.ceil((need / ts.restoreRate) * 1000)));
  }
  return 1000 * 2 ** attempt;
}

const retryAfter = (res: Response, attempt: number) => {
  const s = Number(res.headers.get('retry-after'));
  return Number.isFinite(s) && s >= 0 ? Math.min(10_000, Math.max(50, s * 1000)) : 1000 * 2 ** attempt;
};

/** One GraphQL Admin API call: retries throttling and server errors up to 3 times; never logs or returns the token. */
export async function shopifyGraphql<T = any>(shop: string, token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (!SHOP_RE.test(shop)) throw badShop();
  const url = `https://${shop}/admin/api/${apiVersion()}/graphql.json`;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      if (attempt < MAX_RETRIES) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new HttpError(502, 'shopify_unavailable', `Could not reach ${shop}. Check the store address and try again.`);
    }
    if (res.status === 401) throw unauthorized();
    if (res.status === 403) throw missingScope([...SHOPIFY_SCOPES]);
    if (res.status === 404 || (res.status >= 300 && res.status < 400)) throw shopNotFound();
    if (res.status === 402 || res.status === 423) throw new HttpError(422, 'shopify_unavailable', `${shop} is paused, frozen or locked, so Shopify will not share its orders.`);
    if (res.status === 429 || res.status >= 500) {
      if (attempt < MAX_RETRIES) {
        await sleep(retryAfter(res, attempt));
        continue;
      }
      throw busy();
    }
    if (!res.ok) throw new HttpError(502, 'shopify_unavailable', `Shopify answered ${res.status}.`);
    let body: { data?: T; errors?: unknown; extensions?: { cost?: Cost } };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new HttpError(502, 'shopify_unavailable', 'Shopify sent a reply that is not JSON.');
    }
    if (body.errors) {
      if (typeof body.errors === 'string') {
        if (/access token|api key|unrecognized login|wrong password/i.test(body.errors)) throw unauthorized();
        throw new HttpError(502, 'shopify_unavailable', `Shopify returned an error: ${body.errors.slice(0, 200)}`);
      }
      const list = (Array.isArray(body.errors) ? body.errors : [body.errors]) as Array<{ message?: string; extensions?: { code?: string; cost?: number; maxCost?: number } }>;
      const code = (c: string) => list.find((e) => e?.extensions?.code === c);
      if (code('THROTTLED')) {
        if (attempt < MAX_RETRIES) {
          await sleep(throttleWait(body.extensions?.cost, attempt));
          continue;
        }
        throw busy();
      }
      const max = code('MAX_COST_EXCEEDED');
      if (max) throw new CostTooHigh(Number(max.extensions?.cost) || 2000, Number(max.extensions?.maxCost) || 1000);
      const denied = code('ACCESS_DENIED');
      if (denied) {
        const named = SHOPIFY_SCOPES.filter((s) => String(denied.message ?? '').includes(s));
        throw missingScope(named.length ? [...named] : [...SHOPIFY_SCOPES]);
      }
      throw new HttpError(502, 'shopify_unavailable', `Shopify returned an error: ${String(list[0]?.message ?? 'unknown').slice(0, 200)}`);
    }
    // Pace the next call: when the bucket is nearly empty, wait for it to refill instead of being throttled.
    const ts = body.extensions?.cost?.throttleStatus;
    const need = body.extensions?.cost?.requestedQueryCost ?? 0;
    if (ts && typeof ts.currentlyAvailable === 'number' && ts.currentlyAvailable < need && (ts.restoreRate ?? 0) > 0) {
      await sleep(Math.min(10_000, Math.ceil(((need - ts.currentlyAvailable) / (ts.restoreRate as number)) * 1000)));
    }
    return body.data as T;
  }
}

/** Runs `run(n)`, asking for fewer nodes whenever Shopify says the query would cost more than its limit. */
async function sized<T>(n: number, run: (n: number) => Promise<T>): Promise<{ data: T; size: number }> {
  let size = n;
  for (;;) {
    try {
      return { data: await run(size), size };
    } catch (err) {
      if (!(err instanceof CostTooHigh)) throw err;
      if (size <= 1) throw new HttpError(502, 'shopify_unavailable', 'Shopify refused the query as too expensive.');
      size = Math.max(1, Math.min(size - 1, Math.floor(((size * err.max) / Math.max(err.cost, 1)) * 0.9)));
    }
  }
}

// ---- queries ----
// Nested connections multiply a query's cost (limit 1,000 per query), so orders are read lean and the costly parts —
// unit costs per variant and refund lines per refunded order — in separate batched queries.

const SHOP_QUERY = `query ProfynShop { shop { name myshopifyDomain currencyCode } currentAppInstallation { accessScopes { handle } } }`;
const PLAN_QUERY = `query ProfynPlan { shop { plan { publicDisplayName } } }`;
const COUNT_QUERY = `query ProfynCount($query: String!) { ordersCount(query: $query) { count precision } }`;
const MONEY = 'shopMoney { amount }';
const ORDERS_QUERY = `query ProfynOrders($first: Int!, $after: String, $query: String!) {
  orders(first: $first, after: $after, sortKey: UPDATED_AT, query: $query) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt updatedAt sourceName paymentGatewayNames currencyCode cancelledAt test
      subtotalPriceSet { ${MONEY} } totalDiscountsSet { ${MONEY} } totalRefundedSet { ${MONEY} } totalShippingPriceSet { ${MONEY} }
      lineItems(first: 10) { pageInfo { hasNextPage } nodes { id quantity sku title variant { id sku } } }
      refunds(first: 5) { id createdAt }
    }
  }
}`;
const LINES_QUERY = `query ProfynLines($id: ID!) { order(id: $id) { lineItems(first: 100) { pageInfo { hasNextPage } nodes { id quantity sku title variant { id sku } } } } }`;
const VARIANTS_QUERY = `query ProfynVariants($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id sku product { id handle } inventoryItem { unitCost { amount } } } } }`;
const REFUNDS_QUERY = `query ProfynRefunds($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Order { id refunds(first: 5) { id createdAt totalRefundedSet { ${MONEY} } refundLineItems(first: 20) { nodes { quantity restockType lineItem { id } } } } }
  }
}`;

export interface ShopInfo {
  shop: { name: string; domain: string; currency: string; plan?: string };
  scopes: string[];
  missing_scopes: string[];
  orders_estimate?: number;
}

/** Granted scopes cover a required one when they include it or its write_ form. */
export const missingScopes = (granted: string[]) => SHOPIFY_SCOPES.filter((s) => !granted.includes(s) && !granted.includes(s.replace(/^read_/, 'write_')));

/** Checks the token against the store: name, currency, granted scopes, and (best effort) plan and order count. */
export async function testConnection(shop: string, token: string, since?: string): Promise<ShopInfo> {
  const d = await shopifyGraphql<{ shop: { name: string; myshopifyDomain: string; currencyCode: string }; currentAppInstallation?: { accessScopes?: Array<{ handle: string }> } }>(shop, token, SHOP_QUERY);
  const scopes = (d?.currentAppInstallation?.accessScopes ?? []).map((s) => s.handle).filter(Boolean);
  const info: ShopInfo = {
    shop: { name: d?.shop?.name ?? shop, domain: d?.shop?.myshopifyDomain ?? shop, currency: d?.shop?.currencyCode ?? 'INR' },
    scopes,
    missing_scopes: missingScopes(scopes),
  };
  try {
    const p = await shopifyGraphql<{ shop?: { plan?: { publicDisplayName?: string } } }>(shop, token, PLAN_QUERY);
    if (p?.shop?.plan?.publicDisplayName) info.shop.plan = p.shop.plan.publicDisplayName;
  } catch {
    /* plan is optional */
  }
  if (since && !info.missing_scopes.includes('read_orders')) {
    try {
      const c = await shopifyGraphql<{ ordersCount?: { count?: number } }>(shop, token, COUNT_QUERY, { query: `created_at:>=${since}` });
      if (typeof c?.ordersCount?.count === 'number') info.orders_estimate = c.ordersCount.count;
    } catch {
      /* the estimate is optional */
    }
  }
  return info;
}

export interface FetchOptions {
  /** Orders created on or after this date (YYYY-MM-DD). */
  since: string;
  /** Only orders updated at or after this ISO time (a sync). */
  updatedSince?: string | null;
  maxOrders?: number;
  budgetMs?: number;
  pageSize?: number;
}

export interface FetchResult {
  orders: ShopifyOrder[];
  /** Stopped early (order cap or time budget); the next sync continues from `watermark`. */
  truncated: boolean;
  /** Where the next sync starts: the last order's updatedAt when truncated, else when this import started. */
  watermark: string;
  pages: number;
}

async function inBatches<T>(ids: string[], start: number, run: (ids: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  let size = start;
  let i = 0;
  while (i < ids.length) {
    const r = await sized(size, (n) => run(ids.slice(i, i + n)));
    out.push(...r.data);
    i += r.size;
    size = r.size;
  }
  return out;
}

/** Reads orders (oldest update first), then fills in line items past 10, unit costs per variant and refund lines. */
export async function fetchOrders(shop: string, token: string, opts: FetchOptions): Promise<FetchResult> {
  const startedIso = new Date().toISOString();
  const deadline = Date.now() + (opts.budgetMs ?? importBudgetMs());
  const max = opts.maxOrders ?? MAX_ORDERS;
  const filter = `created_at:>=${opts.since}${opts.updatedSince ? ` updated_at:>='${opts.updatedSince}'` : ''}`;
  const orders: ShopifyOrder[] = [];
  let after: string | null = null;
  let size = opts.pageSize ?? 25;
  let truncated = false;
  let pages = 0;
  for (;;) {
    type Page = { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyOrder[] } };
    const cursor: string | null = after;
    const r: { data: Page; size: number } = await sized(size, (n) => shopifyGraphql<Page>(shop, token, ORDERS_QUERY, { first: n, after: cursor, query: filter }));
    size = r.size;
    pages++;
    const conn = r.data?.orders;
    orders.push(...(conn?.nodes ?? []));
    if (orders.length >= max) {
      truncated = orders.length > max || Boolean(conn?.pageInfo?.hasNextPage);
      orders.length = Math.min(orders.length, max);
      break;
    }
    if (!conn?.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break;
    if (Date.now() > deadline) {
      truncated = true;
      break;
    }
    after = conn.pageInfo.endCursor;
  }

  const kept = orders.filter((o) => !o.test && !o.cancelledAt);
  // Orders with more than 10 line items: read up to 100.
  for (const o of kept.filter((x) => x.lineItems?.pageInfo?.hasNextPage)) {
    const d = await shopifyGraphql<{ order?: { lineItems?: ShopifyOrder['lineItems'] } }>(shop, token, LINES_QUERY, { id: o.id });
    if (d?.order?.lineItems) o.lineItems = d.order.lineItems;
  }
  // Unit cost ("Cost per item") and product handle, once per variant.
  const variantIds = [...new Set(kept.flatMap((o) => (o.lineItems?.nodes ?? []).map((li) => li.variant?.id).filter((x): x is string => Boolean(x))))];
  const variants = new Map<string, ShopifyVariant>();
  const found = await inBatches(variantIds, 100, async (ids) => (await shopifyGraphql<{ nodes: Array<ShopifyVariant | null> }>(shop, token, VARIANTS_QUERY, { ids }))?.nodes ?? []);
  for (const v of found) if (v?.id) variants.set(v.id, v);
  for (const o of kept) {
    for (const li of o.lineItems?.nodes ?? []) {
      const v = li.variant?.id ? variants.get(li.variant.id) : undefined;
      if (v) {
        li.variant = { ...li.variant, ...v };
        if (!li.product && v.product) li.product = v.product;
      }
    }
  }
  // Refund lines (what was restocked) for orders with refunds.
  const refundedIds = kept.filter((o) => (o.refunds ?? []).length > 0).map((o) => o.id);
  const detailed = await inBatches(refundedIds, 10, async (ids) => (await shopifyGraphql<{ nodes: Array<{ id: string; refunds?: ShopifyRefund[] } | null> }>(shop, token, REFUNDS_QUERY, { ids }))?.nodes ?? []);
  const refundsOf = new Map(detailed.filter((d): d is { id: string; refunds?: ShopifyRefund[] } => Boolean(d?.id)).map((d) => [d.id, d.refunds ?? []]));
  for (const o of kept) {
    const refunds = refundsOf.get(o.id);
    if (!refunds) continue;
    const byLine = new Map((o.lineItems?.nodes ?? []).filter((li) => li.id).map((li) => [li.id as string, li]));
    for (const r of refunds) {
      for (const rl of r.refundLineItems?.nodes ?? []) {
        const li = rl.lineItem?.id ? byLine.get(rl.lineItem.id) : undefined;
        if (li) rl.lineItem = { id: li.id, variant: li.variant ?? null };
      }
    }
    o.refunds = refunds;
  }
  const last = orders[orders.length - 1];
  return { orders, truncated, watermark: truncated && last?.updatedAt ? last.updatedAt : startedIso, pages };
}

// ---- OAuth (Shopify app install) ----

export interface ShopifyApp {
  clientId: string;
  clientSecret: string;
}

/** SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (an app from the Shopify Dev Dashboard), or null. */
export const shopifyAppFromEnv = (env = process.env): ShopifyApp | null =>
  env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET ? { clientId: env.SHOPIFY_CLIENT_ID, clientSecret: env.SHOPIFY_CLIENT_SECRET } : null;

/** Shopify signs its redirects: HMAC-SHA256 (hex) of the other query parameters, sorted, as k=v joined by &. */
export function verifyShopifyHmac(query: Record<string, unknown>, secret: string): boolean {
  const given = typeof query.hmac === 'string' ? query.hmac : '';
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;
  const message = Object.keys(query)
    .filter((k) => k !== 'hmac' && k !== 'signature')
    .sort()
    .map((k) => {
      const v = query[k];
      return `${k}=${Array.isArray(v) ? `[${v.map((x) => `"${String(x)}"`).join(', ')}]` : String(v ?? '')}`;
    })
    .join('&');
  const expected = createHmac('sha256', secret).update(message).digest();
  const got = Buffer.from(given, 'hex');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Exchanges the install code for an offline Admin API access token. */
export async function exchangeCode(shop: string, app: ShopifyApp, code: string): Promise<{ access_token: string; scope: string }> {
  if (!SHOP_RE.test(shop)) throw badShop();
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: app.clientId, client_secret: app.clientSecret, code }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new HttpError(502, 'shopify_unavailable', `Shopify did not issue a token (${res.status}).`);
  const body = (await res.json().catch(() => null)) as { access_token?: string; scope?: string } | null;
  if (!body?.access_token) throw new HttpError(502, 'shopify_unavailable', 'Shopify did not issue a token.');
  return { access_token: body.access_token, scope: body.scope ?? '' };
}

