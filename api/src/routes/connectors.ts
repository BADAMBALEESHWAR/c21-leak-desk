import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { accountOf } from '../auth.js';
import { cookieOf, oauthFromEnv, safeReturn, signJwt, verifyJwt, type OAuthSettings } from '../auth-oauth.js';
import { correctedOrderIds } from '../corrections.js';
import { dbState } from '../db.js';
import { ah, HttpError } from '../errors.js';
import type { DatasetRecord } from '../repo.js';
import { IsoDate } from '../schema/orders.js';
import {
  DEFAULT_ASSUMPTIONS,
  exchangeCode,
  fetchOrders,
  istDate,
  mapShopifyOrders,
  normalizeShop,
  requireShop,
  SHOPIFY_SCOPES,
  shopifyAppFromEnv,
  testConnection,
  verifyShopifyHmac,
  type Assumptions,
  type ShopInfo,
} from '../connectors/shopify.js';
import { connectorId, connectors, decryptToken, encryptToken, publicView, type ConnectorRecord } from '../connectors/store.js';
import { appendBase, commitImport, summary, type Incoming } from './datasets.js';

// Store connectors (v2): Shopify by pasted Admin API token, or by app install (OAuth) when SHOPIFY_CLIENT_ID/SECRET are
// set. Orders become a dataset through the same validation as uploads; a sync adds a new version of that dataset.

const Money = z.number({ invalid_type_error: 'must be a number' }).finite().min(0, 'must not be negative').max(1_000_000, 'is too large');
const AssumptionsSchema = z
  .object({
    shipping_inr: Money.default(DEFAULT_ASSUMPTIONS.shipping_inr),
    fee_pct: z.number({ invalid_type_error: 'must be a number' }).finite().min(0, 'must be between 0 and 100').max(100, 'must be between 0 and 100').default(DEFAULT_ASSUMPTIONS.fee_pct),
    return_cost_inr: Money.default(DEFAULT_ASSUMPTIONS.return_cost_inr),
    cod_fee_inr: Money.default(DEFAULT_ASSUMPTIONS.cod_fee_inr),
  })
  .default({});
const Credentials = {
  shop: z.string({ required_error: 'is missing', invalid_type_error: 'must be text' }).max(200, 'is too long'),
  token: z
    .string({ required_error: 'is missing', invalid_type_error: 'must be text' })
    .trim()
    .min(1, 'is missing')
    .max(500, 'is too long')
    .regex(/^[!-~]+$/, 'must be the Admin API access token (shpat_…)'),
};
const TestBody = z.object(Credentials);
const ConnectBody = z.object({ ...Credentials, since: IsoDate.optional(), assumptions: AssumptionsSchema });

const STATE_COOKIE = 'profyn_shopify';
const STATE_PATH = '/api/v1/connectors/shopify';
const STATE_MINUTES = 10;

const today = () => istDate(new Date().toISOString());
const defaultSince = () => istDate(new Date(Date.now() - 365 * 86_400_000).toISOString());
const notConnected = () => new HttpError(404, 'not_connected', 'No Shopify store is connected. Connect a store first.', { hint: 'Signed-in accounts keep the connection; the demo workspace imports once.' });

function requireScopes(info: ShopInfo) {
  if (info.missing_scopes.length) {
    throw new HttpError(422, 'missing_scope', `Missing scope ${info.missing_scopes.join(', ')}`, {
      path: 'token',
      hint: `Give the app the Admin API scopes ${SHOPIFY_SCOPES.join(', ')} (and read_all_orders for orders older than 60 days), reinstall it, and copy the new token.`,
    });
  }
}

/** Fields whose change in Shopify (a refund, a return, a cost filled in) replaces the saved row on a sync. */
const SYNCED = ['gross_inr', 'discount_inr', 'refund_inr', 'product_cost_inr', 'recovered_product_cost_inr', 'returned', 'return_cost_inr', 'payment_fee_inr', 'refund_date', 'units'] as const;
const changed = (saved: Record<string, unknown>, fresh: Record<string, unknown>) => SYNCED.some((k) => (saved[k] ?? null) !== (fresh[k] ?? null));

interface ImportParams {
  shop: string;
  token: string;
  since: string;
  watermark: string | null;
  assumptions: Assumptions;
  base: DatasetRecord | null;
  currency: string;
}

/** Reads the orders, maps them and saves them through the upload path. Returns POST /datasets' status and body plus connector extras. */
async function importOrders(req: Request, p: ImportParams) {
  const started = Date.now();
  const fetched = await fetchOrders(p.shop, p.token, { since: p.since, updatedSince: p.watermark });
  const { rows, skipped } = mapShopifyOrders(fetched.orders, p.assumptions);
  const noCost = rows.filter((r) => r.product_cost_inr === null).length;
  const extras: Record<string, unknown> = {
    orders_fetched: fetched.orders.length,
    skipped: skipped.cancelled + skipped.test,
    skipped_detail: skipped,
    assumptions: p.assumptions,
    ...(fetched.truncated ? { truncated: true, more: true, more_message: 'Shopify has more orders than one import reads; sync again to continue.' } : {}),
    ...(p.currency !== 'INR' ? { currency_warning: `${p.shop} sells in ${p.currency}. Amounts were imported as they are and shown as ₹; convert before comparing with INR data.` } : {}),
    ...(noCost ? { cost_hint: `${noCost} order${noCost === 1 ? ' has' : 's have'} a product without "Cost per item" in Shopify, so ${noCost === 1 ? 'it was' : 'they were'} rejected (unknown, never zero). Add the cost in Shopify (Products → product → Cost per item) and sync, or correct the rows here.` } : {}),
  };
  if (rows.length === 0) {
    if (p.base) {
      return {
        status: 200 as const,
        record: p.base,
        watermark: fetched.watermark,
        body: { ...summary(p.base), flags: [], rows_in: 0, rows_rejected: 0, rows_added: 0, rows_updated: 0, duplicates_ignored: 0, appended_to: p.base._id, unchanged: true, message: 'Nothing new in Shopify since the last sync.', persisted: dbState() === 'connected', ...extras },
      };
    }
    const n = skipped.cancelled + skipped.test;
    throw new HttpError(422, 'no_orders', `No orders in ${p.shop} since ${p.since}${n ? ` (${n} test or cancelled orders skipped)` : ''}.`, { path: 'since', hint: 'Choose an earlier start date. Orders older than 60 days need the read_all_orders scope.' });
  }
  let replace: Set<string> | undefined;
  if (p.base) {
    const corrected = new Set(correctedOrderIds(p.base.corrections));
    const saved = new Map(p.base.rows.map((r) => [r.order_id, r as unknown as Record<string, unknown>]));
    replace = new Set(
      rows
        .filter((r) => {
          const old = saved.get(String(r.order_id));
          // An owner's correction wins over Shopify's (still unknown) value.
          return old && !corrected.has(String(r.order_id)) && changed(old, r);
        })
        .map((r) => String(r.order_id)),
    );
  }
  const label = `shopify:${p.shop}`;
  const incoming: Incoming = { source: label, ingested: { orders: rows, path_prefix: 'shopify', line_offset: 0 } };
  try {
    const out = await commitImport(req, incoming, p.base, {
      started,
      replace_ids: replace,
      source_label: label,
      batch_name: p.base ? `${label} sync ${today()}` : undefined,
      audit: { connector: 'shopify' },
    });
    return { ...out, watermark: fetched.watermark, body: { ...out.body, ...extras } };
  } catch (err) {
    if (err instanceof HttpError && err.code === 'no_valid_rows' && noCost === rows.length) {
      throw new HttpError(422, 'no_valid_rows', `None of the ${rows.length} orders could be imported: their products have no "Cost per item" in Shopify, and product cost is never assumed.`, {
        path: 'product_cost_inr',
        hint: 'In Shopify open Products → each product → Pricing → Cost per item, save, then connect again.',
      });
    }
    throw err;
  }
}

function stateCookie(res: Response, value: string, maxAge: number, secure: boolean) {
  const parts = [`${STATE_COOKIE}=${encodeURIComponent(value)}`, `Path=${STATE_PATH}`, `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax'];
  if (maxAge === 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export function connectorsRouter(oauth: OAuthSettings = oauthFromEnv()) {
  const router = Router();
  const oauthOn = () => Boolean(shopifyAppFromEnv() && oauth.sessionSecret);

  /** Saves the connection for a signed-in owner (token encrypted); a guest or a server without SESSION_SECRET keeps nothing. */
  async function save(req: Request, c: Omit<ConnectorRecord, '_id' | 'account' | 'token_enc'>, token: string): Promise<boolean> {
    if (!req.user || !oauth.sessionSecret) return false;
    const account = accountOf(req.user);
    await connectors.put({ _id: connectorId(account), account, token_enc: encryptToken(token, oauth.sessionSecret), ...c });
    return true;
  }

  router.get(
    '/connectors',
    ah(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      if (!req.user) return void res.json({ connectors: [], shopify_oauth: oauthOn() });
      const list = await connectors.list(accountOf(req.user));
      res.json({ connectors: list.map(publicView), shopify_oauth: oauthOn() });
    }),
  );

  router.post(
    '/connectors/shopify/test',
    ah(async (req, res) => {
      const body = TestBody.parse(req.body ?? {});
      const shop = requireShop(body.shop);
      const info = await testConnection(shop, body.token, defaultSince());
      if (info.missing_scopes.includes('read_orders')) requireScopes({ ...info, missing_scopes: ['read_orders'] });
      requireScopes(info);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        ok: true,
        shop: info.shop,
        scopes: info.scopes,
        ...(typeof info.orders_estimate === 'number' ? { orders_estimate: info.orders_estimate } : {}),
        ...(info.shop.currency !== 'INR' ? { currency_warning: `${shop} sells in ${info.shop.currency}; amounts are imported as they are and shown as ₹.` } : {}),
      });
    }),
  );

  router.post(
    '/connectors/shopify/connect',
    ah(async (req, res) => {
      const body = ConnectBody.parse(req.body ?? {});
      const shop = requireShop(body.shop);
      const since = body.since ?? defaultSince();
      if (since > today()) throw new HttpError(422, 'schema_invalid', 'since must not be in the future.', { path: 'since' });
      const info = await testConnection(shop, body.token);
      requireScopes(info);
      const out = await importOrders(req, { shop, token: body.token, since, watermark: null, assumptions: body.assumptions, base: null, currency: info.shop.currency });
      const now = new Date();
      const conn = {
        provider: 'shopify' as const,
        shop,
        shop_name: info.shop.name,
        currency: info.shop.currency,
        scopes: info.scopes,
        via: 'token' as const,
        connected_at: now,
        last_sync_at: now,
        orders_imported: out.record.rows.length,
        dataset_id: out.record._id,
        assumptions: body.assumptions,
        since,
        watermark: out.watermark,
      };
      const stored = await save(req, conn, body.token);
      void audit.record(req, { kind: 'connector_connected', provider: 'shopify', shop, via: 'token', dataset_id: out.record._id, rows_added: out.body.rows_added ?? 0, stored });
      req.log?.info({ shop, dataset_id: out.record._id, stored }, 'shopify connected');
      res.status(out.status).json({
        ...out.body,
        connector: { provider: 'shopify', shop, shop_name: conn.shop_name, currency: conn.currency, connected_at: now, last_sync_at: now, orders_imported: conn.orders_imported, stored },
      });
    }),
  );

  router.post(
    '/connectors/shopify/sync',
    ah(async (req, res) => {
      if (!req.user) throw notConnected();
      const c = await connectors.get(accountOf(req.user));
      if (!c) throw notConnected();
      const token = oauth.sessionSecret ? decryptToken(c.token_enc, oauth.sessionSecret) : null;
      if (!token) {
        throw new HttpError(401, 'shopify_unauthorized', 'The saved Shopify connection can no longer be used. Connect the store again.', { hint: 'The server key changed since the store was connected.' });
      }
      // The dataset may have been deleted (or lost from memory): then everything since `since` is imported again.
      const base = c.dataset_id ? await appendBase(req, c.dataset_id).catch(() => null) : null;
      const out = await importOrders(req, { shop: c.shop, token, since: c.since, watermark: base ? c.watermark : null, assumptions: { ...DEFAULT_ASSUMPTIONS, ...c.assumptions }, base, currency: c.currency });
      const now = new Date();
      const next: ConnectorRecord = { ...c, last_sync_at: now, watermark: out.watermark, dataset_id: out.record._id, orders_imported: out.record.rows.length };
      await connectors.put(next);
      void audit.record(req, { kind: 'connector_sync', provider: 'shopify', shop: c.shop, dataset_id: out.record._id, rows_added: out.body.rows_added ?? 0, rows_updated: out.body.rows_updated ?? 0, unchanged: out.status === 200 });
      res.status(out.status).json({
        ...out.body,
        connector: { provider: 'shopify', shop: c.shop, shop_name: c.shop_name, currency: c.currency, connected_at: c.connected_at, last_sync_at: now, orders_imported: next.orders_imported, stored: true },
      });
    }),
  );

  router.delete(
    '/connectors/shopify',
    ah(async (req, res) => {
      if (req.user) {
        const account = accountOf(req.user);
        const c = await connectors.get(account);
        const removed = await connectors.remove(account);
        if (removed) void audit.record(req, { kind: 'connector_disconnected', provider: 'shopify', shop: c?.shop ?? null });
      }
      res.status(204).end();
    }),
  );

  // ---- app install (OAuth) ----

  const app = () => {
    const a = shopifyAppFromEnv();
    if (!a || !oauth.sessionSecret) throw new HttpError(404, 'provider_disabled', 'Shopify app install is not set up on this server.', { hint: 'Connect with an Admin API access token instead.' });
    return a;
  };
  const landing = (back: string, query: string) => `${back.split('#')[0]}#/overview?${query}`;

  router.get('/connectors/shopify/install', (req, res) => {
    const a = app();
    const shop = requireShop(req.query.shop);
    const back = safeReturn(req.query.return);
    res.setHeader('Cache-Control', 'no-store');
    if (!req.user) return void res.redirect(302, '/login/');
    const state = randomBytes(18).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + STATE_MINUTES * 60;
    stateCookie(res, signJwt({ st: state, shop, r: back, sub: req.user.sub, exp }, oauth.sessionSecret!), STATE_MINUTES * 60, oauth.secureCookies);
    const q = new URLSearchParams({ client_id: a.clientId, scope: SHOPIFY_SCOPES.join(','), redirect_uri: `${oauth.publicUrl}/api/v1/connectors/shopify/callback`, state });
    res.redirect(302, `https://${shop}/admin/oauth/authorize?${q}`);
  });

  router.get(
    '/connectors/shopify/callback',
    ah(async (req, res) => {
      const a = app();
      res.setHeader('Cache-Control', 'no-store');
      const cookie = cookieOf(req, STATE_COOKIE);
      stateCookie(res, '', 0, oauth.secureCookies);
      if (!verifyShopifyHmac(req.query as Record<string, unknown>, a.clientSecret)) {
        throw new HttpError(400, 'invalid_state', 'The reply from Shopify could not be verified. Start the connection again.', { hint: 'Open Connectors and choose Install on Shopify again.' });
      }
      const shop = normalizeShop(req.query.shop, { allowBare: false });
      if (!shop) throw new HttpError(400, 'invalid_shop', 'Shopify sent an invalid store address.', { path: 'shop' });
      const given = typeof req.query.state === 'string' ? req.query.state : '';
      const claims = cookie ? verifyJwt<{ st: string; shop: string; r: string; sub: string }>(cookie, oauth.sessionSecret!) : null;
      const sameState = Boolean(claims && given && claims.st.length === given.length && timingSafeEqual(Buffer.from(claims.st), Buffer.from(given)));
      if (!claims || !sameState || claims.shop !== shop) {
        throw new HttpError(400, 'invalid_state', 'The Shopify install link has expired or was not started here. Start the connection again.', { hint: 'Open Connectors and choose Install on Shopify again.' });
      }
      if (!req.user) return void res.redirect(302, '/login/');
      if (claims.sub !== req.user.sub) throw new HttpError(400, 'invalid_state', 'The Shopify install was started by another account. Start the connection again.');
      const back = safeReturn(claims.r);
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      if (!code) return void res.redirect(302, landing(back, 'shopify_error=access_denied'));
      let token: string;
      let info: ShopInfo;
      try {
        token = (await exchangeCode(shop, a, code)).access_token;
        info = await testConnection(shop, token);
      } catch (err) {
        req.log?.warn({ shop, code: (err as HttpError).code ?? 'error' }, 'shopify install failed');
        return void res.redirect(302, landing(back, `shopify_error=${encodeURIComponent((err as HttpError).code ?? 'oauth_failed')}`));
      }
      const now = new Date();
      const since = defaultSince();
      const conn: Omit<ConnectorRecord, '_id' | 'account' | 'token_enc'> = {
        provider: 'shopify',
        shop,
        shop_name: info.shop.name,
        currency: info.shop.currency,
        scopes: info.scopes,
        via: 'oauth',
        connected_at: now,
        last_sync_at: null,
        orders_imported: 0,
        dataset_id: null,
        assumptions: { ...DEFAULT_ASSUMPTIONS },
        since,
        watermark: null,
      };
      await save(req, conn, token);
      void audit.record(req, { kind: 'connector_connected', provider: 'shopify', shop, via: 'oauth', stored: true });
      try {
        requireScopes(info);
        const out = await importOrders(req, { shop, token, since, watermark: null, assumptions: conn.assumptions, base: null, currency: info.shop.currency });
        await save(req, { ...conn, last_sync_at: new Date(), orders_imported: out.record.rows.length, dataset_id: out.record._id, watermark: out.watermark }, token);
      } catch (err) {
        req.log?.warn({ shop, code: (err as HttpError).code ?? 'error' }, 'shopify first import failed');
        return void res.redirect(302, landing(back, `connected=shopify&shopify_error=${encodeURIComponent((err as HttpError).code ?? 'import_failed')}`));
      }
      res.redirect(302, landing(back, 'connected=shopify'));
    }),
  );

  return router;
}
