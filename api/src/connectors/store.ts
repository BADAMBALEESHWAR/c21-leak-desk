import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ConnectorModel } from '../models/index.js';
import { SmallStore } from '../platform-store.js';
import type { Assumptions } from './shopify.js';

// Saved store connections, one per account and provider. The access token is kept only AES-256-GCM encrypted with a
// key derived from SESSION_SECRET; it is never returned by the API or written to a log.

export interface ConnectorRecord {
  /** `<account>:<provider>` */
  _id: string;
  account: string;
  provider: 'shopify';
  shop: string;
  shop_name: string;
  currency: string;
  scopes: string[];
  /** v1.<iv>.<tag>.<ciphertext>, base64url. */
  token_enc: string;
  /** How the token was obtained: pasted Admin API token, or the app install (OAuth). */
  via: 'token' | 'oauth';
  connected_at: Date;
  last_sync_at: Date | null;
  orders_imported: number;
  dataset_id: string | null;
  assumptions: Assumptions;
  /** Orders created on or after this date are imported. */
  since: string;
  /** The next sync reads orders updated at or after this time. */
  watermark: string | null;
}

const store = new SmallStore<ConnectorRecord>('connectors', ConnectorModel);
export const connectorId = (account: string, provider = 'shopify') => `${account}:${provider}`;

export const connectors = {
  get: (account: string, provider = 'shopify') => store.get(connectorId(account, provider)),
  list: (account: string) => store.find({ account }, 'connected_at'),
  put: (c: ConnectorRecord) => store.put(c),
  remove: (account: string, provider = 'shopify') => store.remove({ _id: connectorId(account, provider) }),
  removeAll: (account: string) => store.remove({ account }),
};

/** What the API shows: everything but the token. */
export const publicView = (c: ConnectorRecord) => ({
  provider: c.provider,
  shop: c.shop,
  shop_name: c.shop_name,
  currency: c.currency,
  connected_at: c.connected_at,
  last_sync_at: c.last_sync_at,
  orders_imported: c.orders_imported,
  dataset_id: c.dataset_id,
  assumptions: c.assumptions,
});

const keyOf = (secret: string) => createHash('sha256').update(`${secret}shopify`).digest();

export function encryptToken(token: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const ct = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

/** The token, or null when it cannot be decrypted (another secret, tampered). */
export function decryptToken(enc: string, secret: string): string | null {
  const [v, iv, tag, ct] = String(enc ?? '').split('.');
  if (v !== 'v1' || !iv || !tag || !ct) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
