import { useCallback, useEffect, useId, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, language, toErrorInfo, type ErrorInfo } from '../api/client';
import type { ConnectorSummary, ShopifyAssumptions, ShopifyImportResult, ShopifySkipped, ShopifyTestResult, WorkspaceDataset } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatCount, formatDate } from '../lib/format';
import { navigate } from '../lib/router';
import { useStore } from '../state/store';
import { Pill } from './Badge';
import { Button } from './Button';
import { Drawer } from './Drawer';
import { Icon } from './Icon';
import { Provenance } from './Provenance';
import { Callout, ErrorCallout } from './ui';
import '../styles/connectors.css';

/**
 * Shopify Admin API connector: the connect drawer, the connected status with Sync now / Open overview / Disconnect, and
 * the card on the import screen. The connector state is shared by every place that shows it (one GET /connectors).
 * Profyn only reads the store. Costs Shopify does not know are entered here and labelled Assumed.
 */

// ---- Shared connector state --------------------------------------------------------------------------------------------

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface ShopifyState {
  status: LoadStatus;
  /** The saved Shopify connector, or null when none is stored (always null in the demo). */
  connector: ConnectorSummary | null;
  /** The server can install Profyn from Shopify (OAuth). */
  oauth: boolean;
  /** The auth mode the state was loaded for; a new mode loads again. */
  key: string | null;
  /** The connect drawer is open. */
  open: boolean;
}

const INITIAL: ShopifyState = { status: 'idle', connector: null, oauth: false, key: null, open: false };
let state: ShopifyState = INITIAL;
const listeners = new Set<() => void>();

function setState(patch: Partial<ShopifyState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;

let loadSeq = 0;

/** GET /connectors. A server without the endpoint (or a failure) counts as not connected; Connect still works. */
export async function refreshShopifyConnector(key: string | null = state.key): Promise<void> {
  const seq = ++loadSeq;
  setState({ status: state.status === 'ready' && state.key === key ? 'ready' : 'loading', key });
  try {
    const res = await api.connectors();
    if (seq !== loadSeq) return;
    const list = Array.isArray(res?.connectors) ? res.connectors : [];
    setState({ status: 'ready', connector: list.find((c) => c.provider === 'shopify') ?? null, oauth: res?.shopify_oauth === true });
  } catch {
    if (seq !== loadSeq) return;
    setState({ status: 'error', connector: null });
  }
}

export function openShopifyConnect(): void {
  setState({ open: true });
}

export function closeShopifyConnect(): void {
  setState({ open: false });
}

/** Tests start from a clean slate. */
export function resetShopifyConnector(): void {
  loadSeq++;
  state = INITIAL;
  listeners.forEach((l) => l());
}

/** The shared Shopify connector state, loaded once per auth mode. */
export function useShopifyConnector(load = true): ShopifyState {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  const auth = useAuth();
  const key = auth.ready ? auth.mode : null;
  useEffect(() => {
    if (!load || !key) return;
    if (state.key !== key || state.status === 'idle') void refreshShopifyConnector(key);
  }, [load, key]);
  return s;
}

// ---- Helpers ----------------------------------------------------------------------------------------------------------

/** "your-store", "your-store.myshopify.com", a store URL or an admin.shopify.com/store/… link → your-store.myshopify.com. */
export function normaliseShop(input: string): string | null {
  let v = input.trim().toLowerCase();
  if (!v) return null;
  const admin = /^(?:https?:\/\/)?admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/.exec(v);
  if (admin) v = admin[1];
  v = v.replace(/^https?:\/\//, '').split(/[/?#]/)[0];
  if (/^[a-z0-9][a-z0-9-]*$/.test(v)) v = `${v}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(v) ? v : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD, n months before today (local calendar). */
export function monthsAgo(n: number, from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth() - n, from.getDate());
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DAY_MS = 86_400_000;

/** "5 minutes ago", "yesterday", in the UI language; a date after a month. */
export function relativeTime(iso: string | null | undefined, lang = language(), now = Date.now()): string {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  const s = Math.round((at - now) / 1000);
  const abs = Math.abs(s);
  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  } catch {
    rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  }
  const sign = s < 0 ? -1 : 1;
  const r = (unit: number) => sign * Math.max(1, Math.round(abs / unit));
  if (abs < 45) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(r(60), 'minute');
  if (abs < DAY_MS / 1000) return rtf.format(r(3600), 'hour');
  if (abs < 30 * (DAY_MS / 1000)) return rtf.format(r(DAY_MS / 1000), 'day');
  return formatDate(iso);
}

/** Orders left out on purpose (test, cancelled), as one number. */
export function skippedCount(s: ShopifySkipped | null | undefined): number {
  if (typeof s === 'number') return Number.isFinite(s) ? s : 0;
  if (!s || typeof s !== 'object') return 0;
  return Object.values(s).reduce<number>((sum, v) => sum + (typeof v === 'number' && Number.isFinite(v) ? v : 0), 0);
}

/** The imported dataset as the saved-data list describes one, for the store's openSaved. */
function asSaved(r: ShopifyImportResult): WorkspaceDataset {
  return {
    dataset_id: r.dataset_id,
    source: `shopify:${r.connector?.shop ?? ''}`,
    period_end: '',
    rows_kept: r.rows_kept,
    files: null,
    created_at: r.connector?.last_sync_at ?? new Date().toISOString(),
    latest_analysis: null,
  };
}

const READ_SCOPES = ['read_orders', 'read_products', 'read_inventory', 'read_all_orders'];

/** The status bag: a plain shopping-bag mark (not a vendor logo). */
function BagMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 8h14l-1.2 11.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9L5 8Z" />
      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
    </svg>
  );
}

// ---- Making an import current -----------------------------------------------------------------------------------------

/** After connect or sync: the new dataset becomes the current one (as an upload does), then the analysis runs. */
function useAdoptImport() {
  const { openSaved } = useStore();
  return useCallback(async (r: ShopifyImportResult) => {
    await openSaved(asSaved(r));
  }, [openSaved]);
}

// ---- The connected status: Sync now, Open overview, Disconnect --------------------------------------------------------

/** "Connected · Brand · 1,240 orders · last sync 5 minutes ago". */
export function ShopifyStatusLine({ connector }: { connector: ConnectorSummary }) {
  const { t, i18n } = useTranslation();
  const when = connector.last_sync_at ? relativeTime(connector.last_sync_at, i18n.resolvedLanguage || i18n.language) : t('shopify.never', 'never');
  return (
    <span className="shop-status-line">
      {t('shopify.connectedLine', 'Connected · {{shop}} · {{orders}} · last sync {{when}}', {
        shop: connector.shop_name || connector.shop,
        orders: t('shopify.orderCount', { count: connector.orders_imported, n: formatCount(connector.orders_imported) }),
        when,
      })}
    </span>
  );
}

/** Sync now, Open overview and Disconnect (with a confirm step), for a stored connector. */
export function ShopifyActions({ connector, showDisconnect = true }: { connector: ConnectorSummary; showDisconnect?: boolean }) {
  const { t } = useTranslation();
  const { datasetId, openSaved, showToast } = useStore();
  const adopt = useAdoptImport();
  const [busy, setBusy] = useState<'sync' | 'open' | 'disconnect' | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [confirming, setConfirming] = useState(false);
  const shop = connector.shop_name || connector.shop;

  const sync = async () => {
    setBusy('sync');
    setError(null);
    try {
      const r = await api.shopifySync();
      await adopt(r);
      showToast(t('shopify.toastSynced', 'Synced {{shop}}: {{n}} orders in the data now', { shop, n: formatCount(r.rows_kept) }));
      void refreshShopifyConnector();
    } catch (err) {
      setError(toErrorInfo(err));
    } finally {
      setBusy(null);
    }
  };

  const openOverview = async () => {
    setError(null);
    if (connector.dataset_id && connector.dataset_id !== datasetId) {
      setBusy('open');
      try {
        await openSaved({
          dataset_id: connector.dataset_id,
          source: `shopify:${connector.shop}`,
          period_end: '',
          rows_kept: connector.orders_imported,
          files: null,
          created_at: connector.last_sync_at ?? connector.connected_at,
          latest_analysis: null,
        });
      } catch (err) {
        setError(toErrorInfo(err));
        setBusy(null);
        return;
      }
      setBusy(null);
    }
    navigate('overview');
  };

  const disconnect = async () => {
    setBusy('disconnect');
    setError(null);
    try {
      await api.shopifyDisconnect();
      setConfirming(false);
      showToast(t('shopify.toastDisconnected', '{{shop}} is disconnected. The token is deleted; imported orders stay.', { shop }), 'info');
      setState({ connector: null });
      void refreshShopifyConnector();
    } catch (err) {
      setError(toErrorInfo(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="shop-actions-wrap">
      {confirming ? (
        <div className="shop-confirm" role="group" aria-label={t('shopify.confirmLabel', 'Confirm disconnect')}>
          <p className="shop-confirm-text">{t('shopify.confirmText', 'Disconnect {{shop}}? The saved token is deleted. Orders already imported stay in your data.', { shop })}</p>
          <div className="shop-actions">
            <Button variant="secondary" size="sm" className="shop-danger" onClick={() => void disconnect()} disabled={busy !== null}>
              {busy === 'disconnect' ? t('shopify.disconnecting', 'Disconnecting…') : t('shopify.confirmYes', 'Yes, disconnect')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy !== null}>
              {t('shopify.cancel', 'Cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="shop-actions">
          <Button variant="secondary" size="sm" icon="refresh" onClick={() => void sync()} disabled={busy !== null} aria-busy={busy === 'sync' || undefined}>
            {busy === 'sync' ? t('shopify.syncing', 'Syncing…') : t('shopify.syncNow', 'Sync now')}
          </Button>
          <Button variant="ghost" size="sm" iconRight="arrow-right" onClick={() => void openOverview()} disabled={busy !== null}>
            {busy === 'open' ? t('actions.opening') : t('shopify.openOverview', 'Open overview')}
          </Button>
          {showDisconnect ? (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} disabled={busy !== null}>
              {t('shopify.disconnect', 'Disconnect')}
            </Button>
          ) : null}
        </div>
      )}
      {busy === 'sync' ? (
        <p className="shop-progress-inline" role="status">
          <span className="spinner" aria-hidden="true" /> {t('shopify.syncProgress', 'Importing new orders from Shopify… this can take up to a minute.')}
        </p>
      ) : null}
      <ErrorCallout error={error} className="shop-error" />
    </div>
  );
}

// ---- The connect form -------------------------------------------------------------------------------------------------

interface CostField {
  key: keyof ShopifyAssumptions;
  labelKey: string;
  label: string;
  hintKey: string;
  hint: string;
  unit: '₹' | '%';
  initial: string;
}

const COSTS: CostField[] = [
  {
    key: 'shipping_inr',
    labelKey: 'shopify.costShipping',
    label: 'Average courier cost per order',
    hintKey: 'shopify.costShippingHint',
    hint: 'What you pay the courier per shipment, on average. Shopify only knows what the customer paid for shipping.',
    unit: '₹',
    initial: '60',
  },
  {
    key: 'fee_pct',
    labelKey: 'shopify.costFee',
    label: 'Payment gateway fee',
    hintKey: 'shopify.costFeeHint',
    hint: 'Percent of each prepaid order kept by your gateway (for example Razorpay at about 2%).',
    unit: '%',
    initial: '2',
  },
  {
    key: 'return_cost_inr',
    labelKey: 'shopify.costReturn',
    label: 'Reverse shipping per return',
    hintKey: 'shopify.costReturnHint',
    hint: 'Courier cost to bring a returned order back. Leave 0 if you do not know it yet.',
    unit: '₹',
    initial: '0',
  },
  {
    key: 'cod_fee_inr',
    labelKey: 'shopify.costCod',
    label: 'Extra COD charge per COD order',
    hintKey: 'shopify.costCodHint',
    hint: 'What the courier charges on top for cash on delivery. Leave 0 if none.',
    unit: '₹',
    initial: '0',
  },
];

type Phase = 'form' | 'importing' | 'done';

/** The drawer's content: one-click install (when set up), the token method, the assumed costs, Test and Connect. */
export function ShopifyConnectForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const account = auth.mode === 'account';
  const { showToast } = useStore();
  const adopt = useAdoptImport();
  const shared = useSyncExternalStore(subscribe, snapshot, snapshot);
  const id = useId();

  const [shopInput, setShopInput] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [since, setSince] = useState(() => monthsAgo(12));
  const [costs, setCosts] = useState<Record<string, string>>(() => Object.fromEntries(COSTS.map((c) => [c.key, c.initial])));
  const [shopError, setShopError] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ key: string; result: ShopifyTestResult } | null>(null);
  const [testError, setTestError] = useState<ErrorInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('form');
  const [connectError, setConnectError] = useState<ErrorInfo | null>(null);
  const [done, setDone] = useState<ShopifyImportResult | null>(null);
  const [installShop, setInstallShop] = useState('');
  const [installError, setInstallError] = useState<string | null>(null);

  const shop = normaliseShop(shopInput);
  const testKey = `${shop ?? ''}|${token.trim()}`;
  const tested = test && test.key === testKey ? test.result : null;
  const scopes = tested?.scopes ?? [];
  const missingOrders = tested ? !scopes.includes('read_orders') : false;
  const olderThan60 = Date.parse(since) < Date.now() - 60 * DAY_MS;
  const missingAllOrders = tested ? olderThan60 && !scopes.includes('read_all_orders') : false;

  const costErrors: Record<string, string> = {};
  for (const c of COSTS) {
    const raw = (costs[c.key] ?? '').trim();
    const n = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(n) || n < 0) costErrors[c.key] = t('shopify.costInvalid', 'Enter 0 or more.');
    else if (c.unit === '%' && n > 100) costErrors[c.key] = t('shopify.feeInvalid', 'Enter a percent from 0 to 100.');
  }
  const sinceValid = /^\d{4}-\d{2}-\d{2}$/.test(since) && !Number.isNaN(Date.parse(since));
  const canConnect = Boolean(tested) && !missingOrders && Object.keys(costErrors).length === 0 && sinceValid && phase === 'form';

  const checkInputs = (): boolean => {
    const okShop = Boolean(shop);
    const okToken = token.trim() !== '';
    setShopError(okShop ? null : t('shopify.shopInvalid', 'Enter your store address, for example your-store.myshopify.com, or just your-store.'));
    setTokenError(okToken ? null : t('shopify.tokenMissing', 'Paste the Admin API access token from your Shopify admin.'));
    return okShop && okToken;
  };

  const runTest = async () => {
    setTestError(null);
    setConnectError(null);
    if (!checkInputs() || !shop) return;
    setTesting(true);
    try {
      const result = await api.shopifyTest({ shop, token: token.trim() });
      setTest({ key: testKey, result });
    } catch (err) {
      setTest(null);
      setTestError(toErrorInfo(err));
    } finally {
      setTesting(false);
    }
  };

  const connect = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canConnect || !shop) return;
    const assumptions: ShopifyAssumptions = {
      shipping_inr: Number(costs.shipping_inr || 0),
      fee_pct: Number(costs.fee_pct || 0),
      return_cost_inr: Number(costs.return_cost_inr || 0),
      cod_fee_inr: Number(costs.cod_fee_inr || 0),
    };
    setConnectError(null);
    setPhase('importing');
    let result: ShopifyImportResult;
    try {
      result = await api.shopifyConnect({ shop, token: token.trim(), since, assumptions });
    } catch (err) {
      setConnectError(toErrorInfo(err));
      setPhase('form');
      return;
    }
    const name = tested?.shop.name || result.connector?.shop || shop;
    try {
      await adopt(result);
    } catch (err) {
      const info = toErrorInfo(err);
      setConnectError({ ...info, message: t('shopify.adoptFailed', 'The orders were imported, but opening them failed: {{message}}', { message: info.message }) });
      setPhase('form');
      return;
    }
    // The token is not kept in the page once it has been used.
    setToken('');
    void refreshShopifyConnector();
    const skipped = skippedCount(result.skipped);
    const text = t('shopify.toastImported', 'Imported {{n}} orders from {{shop}}', { n: formatCount(result.rows_kept), shop: name });
    showToast(skipped > 0 ? `${text} · ${t('shopify.skippedShort', '{{n}} test or cancelled orders left out', { n: formatCount(skipped) })}` : text);
    if (result.currency_warning) {
      // A currency to look at first: stay here and say so; the data is already open.
      setDone(result);
      setPhase('done');
      return;
    }
    onClose();
    navigate('overview');
  };

  const install = () => {
    const s = normaliseShop(installShop);
    if (!s) {
      setInstallError(t('shopify.shopInvalid', 'Enter your store address, for example your-store.myshopify.com, or just your-store.'));
      return;
    }
    setInstallError(null);
    window.location.assign(api.shopifyInstallUrl(s, '/app/'));
  };

  if (phase === 'importing') {
    return (
      <div className="shop-progress" role="status" aria-live="polite">
        <span className="spinner spinner-lg" aria-hidden="true" />
        <p className="shop-progress-title">{t('shopify.importing', 'Importing orders from Shopify…')}</p>
        <p className="shop-progress-sub">{t('shopify.importingSub', 'This can take 10–60 seconds on a large store. Every order is validated before anything is counted.')}</p>
      </div>
    );
  }

  if (phase === 'done' && done) {
    const skipped = skippedCount(done.skipped);
    return (
      <div className="shop-form">
        <Callout tone="success" title={t('shopify.toastImported', 'Imported {{n}} orders from {{shop}}', { n: formatCount(done.rows_kept), shop: tested?.shop.name || done.connector?.shop || shop || '' })} role="status">
          {skipped > 0 ? <p>{t('shopify.skipped', '{{n}} test or cancelled orders were left out.', { n: formatCount(skipped) })}</p> : null}
        </Callout>
        {done.currency_warning ? (
          <Callout tone="warning" title={t('shopify.currencyTitle', 'Check the currency')}>
            <p>{done.currency_warning}</p>
          </Callout>
        ) : null}
        <div className="shop-buttons">
          <Button
            variant="primary"
            iconRight="arrow-right"
            onClick={() => {
              onClose();
              navigate('overview');
            }}
          >
            {t('shopify.openOverview', 'Open overview')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form className="shop-form" onSubmit={(e) => void connect(e)} noValidate>
      <p className="shop-lead">
        <Icon name="lock" size={14} /> {t('shopify.readOnly', 'Profyn reads only; it never changes your store.')}
      </p>

      {shared.oauth ? (
        <section className="shop-section" aria-labelledby={`${id}-install`}>
          <h3 id={`${id}-install`} className="shop-section-title">
            {t('shopify.installTitle', 'Install Profyn from Shopify')}
          </h3>
          <p className="field-hint">{t('shopify.installHint', 'One click: Shopify asks you to approve read-only access, then brings you back here.')}</p>
          <div className="shop-inline">
            <label className="visually-hidden" htmlFor={`${id}-install-shop`}>
              {t('shopify.storeAddress', 'Store address')}
            </label>
            <input
              id={`${id}-install-shop`}
              className="input"
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="your-store.myshopify.com"
              value={installShop}
              onChange={(e) => setInstallShop(e.target.value)}
              aria-invalid={installError ? true : undefined}
            />
            <Button variant="secondary" iconRight="arrow-up-right" onClick={install}>
              {t('shopify.install', 'Install from Shopify')}
            </Button>
          </div>
          {installError ? (
            <p className="field-error" role="alert">
              <Icon name="alert-triangle" size={14} /> {installError}
            </p>
          ) : null}
          <p className="shop-or">
            <span>{t('shopify.orToken', 'or connect with an Admin API token')}</span>
          </p>
        </section>
      ) : null}

      <div className="field">
        <label className="field-label" htmlFor={`${id}-shop`}>
          {t('shopify.storeAddress', 'Store address')}
        </label>
        <input
          id={`${id}-shop`}
          className="input"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="your-store.myshopify.com"
          value={shopInput}
          onChange={(e) => {
            setShopInput(e.target.value);
            setShopError(null);
          }}
          onBlur={() => {
            const s = normaliseShop(shopInput);
            if (s && s !== shopInput.trim()) setShopInput(s);
          }}
          aria-invalid={shopError ? true : undefined}
          aria-describedby={`${id}-shop-hint`}
        />
        {shopError ? (
          <p id={`${id}-shop-hint`} className="field-error" role="alert">
            <Icon name="alert-triangle" size={14} /> {shopError}
          </p>
        ) : (
          <p id={`${id}-shop-hint`} className="field-hint">
            {t('shopify.storeHint', 'The address that ends in .myshopify.com; just the store name works too.')}
          </p>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-token`}>
          {t('shopify.token', 'Admin API access token')}
        </label>
        <span className="shop-token">
          <input
            id={`${id}-token`}
            className="input"
            type={showToken ? 'text' : 'password'}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="shpat_…"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setTokenError(null);
            }}
            aria-invalid={tokenError ? true : undefined}
            aria-describedby={`${id}-token-hint`}
          />
          <button type="button" className="shop-token-toggle" onClick={() => setShowToken((v) => !v)} aria-pressed={showToken} aria-controls={`${id}-token`}>
            {showToken ? t('shopify.hideToken', 'Hide') : t('shopify.showToken', 'Show')}
          </button>
        </span>
        {tokenError ? (
          <p id={`${id}-token-hint`} className="field-error" role="alert">
            <Icon name="alert-triangle" size={14} /> {tokenError}
          </p>
        ) : (
          <p id={`${id}-token-hint`} className="field-hint">
            {account
              ? t('shopify.storedNote', 'The token is stored encrypted and never shown again.')
              : t('shopify.demoNote', 'In the demo the token is used once and not saved. Sign in to keep the store connected and sync monthly.')}
          </p>
        )}
      </div>

      <details className="shop-howto">
        <summary>
          <Icon name="info" size={15} /> {t('shopify.howTitle', 'How to get the token')}
          <Icon name="chevron-down" size={16} className="shop-howto-chevron" />
        </summary>
        <ol className="shop-steps">
          <li>{t('shopify.step1', 'In your Shopify admin, open Settings → Apps and sales channels → Develop apps. Newer stores: Build apps in Dev Dashboard.')}</li>
          <li>{t('shopify.step2', 'Create an app and name it Profyn.')}</li>
          <li>
            {t('shopify.step3', 'Configure these Admin API scopes (all read only):')}
            <span className="shop-chips">
              <code>read_orders</code>
              <code>read_products</code>
              <code>read_inventory</code>
            </span>
            <span className="shop-step-note">{t('shopify.step3b', 'Add read_all_orders as well to import orders older than 60 days.')}</span>
          </li>
          <li>{t('shopify.step4', 'Install the app.')}</li>
          <li>{t('shopify.step5', 'Reveal and copy the Admin API access token (it starts with shpat_) and paste it above.')}</li>
        </ol>
        <p className="field-hint">{t('shopify.readOnly', 'Profyn reads only; it never changes your store.')}</p>
      </details>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-since`}>
          {t('shopify.since', 'Import orders since')}
        </label>
        <input id={`${id}-since`} className="input input-date shop-since" type="date" value={since} max={monthsAgo(0)} onChange={(e) => setSince(e.target.value)} />
        <p className="field-hint">{t('shopify.sinceHint', 'Default: the last 12 months. Orders older than 60 days need the read_all_orders scope.')}</p>
      </div>

      <section className="shop-section" aria-labelledby={`${id}-costs`}>
        <h3 id={`${id}-costs`} className="shop-section-title">
          {t('shopify.costsTitle', 'Costs Shopify does not know')}
        </h3>
        <p className="field-hint">{t('shopify.costsSub', 'Applied to every imported order and labelled Assumed, never shown as observed.')}</p>
        <div className="shop-costs">
          {COSTS.map((c) => {
            const inputId = `${id}-${c.key}`;
            const err = costErrors[c.key];
            return (
              <div className="field shop-cost" key={c.key}>
                <label className="field-label" htmlFor={inputId}>
                  <span>{t(c.labelKey, c.label)}</span>
                  <Provenance kind="assumed" />
                </label>
                <span className={`num-field shop-num${c.unit === '%' ? ' shop-num-pct' : ''}`}>
                  {c.unit === '₹' ? (
                    <span className="num-affix" aria-hidden="true">
                      ₹
                    </span>
                  ) : null}
                  <input
                    id={inputId}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={c.unit === '%' ? 100 : undefined}
                    step="any"
                    value={costs[c.key] ?? ''}
                    onChange={(e) => setCosts((v) => ({ ...v, [c.key]: e.target.value }))}
                    aria-invalid={err ? true : undefined}
                    aria-describedby={`${inputId}-hint`}
                  />
                  {c.unit === '%' ? (
                    <span className="num-affix" aria-hidden="true">
                      %
                    </span>
                  ) : null}
                </span>
                {err ? (
                  <p id={`${inputId}-hint`} className="field-error" role="alert">
                    <Icon name="alert-triangle" size={14} /> {err}
                  </p>
                ) : (
                  <p id={`${inputId}-hint`} className="field-hint">
                    {t(c.hintKey, c.hint)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div aria-live="polite" className="shop-test-out">
        {tested ? (
          <div className="shop-tested" data-testid="shopify-test-result">
            <p className="shop-tested-title">
              <Icon name="check-circle" size={18} /> {t('shopify.testOk', 'Connection works: {{name}}', { name: tested.shop.name })}
            </p>
            <dl className="shop-tested-kv">
              <div>
                <dt>{t('shopify.storeAddress', 'Store address')}</dt>
                <dd>{tested.shop.domain}</dd>
              </div>
              <div>
                <dt>{t('shopify.currency', 'Currency')}</dt>
                <dd>{tested.shop.currency}</dd>
              </div>
              {typeof tested.orders_estimate === 'number' ? (
                <div>
                  <dt>{t('shopify.ordersEstimate', 'Orders to import')}</dt>
                  <dd>{t('shopify.about', 'about {{n}}', { n: formatCount(tested.orders_estimate) })}</dd>
                </div>
              ) : null}
            </dl>
            <ul className="shop-scopes" aria-label={t('shopify.scopes', 'Access granted')}>
              {READ_SCOPES.filter((s) => s !== 'read_all_orders' || scopes.includes(s) || olderThan60).map((s) => {
                const ok = scopes.includes(s);
                return (
                  <li key={s} className={ok ? 'is-ok' : 'is-missing'}>
                    <Icon name={ok ? 'check' : 'x'} size={13} strokeWidth={2.4} />
                    <code>{s}</code>
                    <span className="visually-hidden">{ok ? t('shopify.granted', 'granted') : t('shopify.notGranted', 'not granted')}</span>
                  </li>
                );
              })}
            </ul>
            {tested.shop.currency && tested.shop.currency.toUpperCase() !== 'INR' ? (
              <p className="shop-warn">
                <Icon name="alert-triangle" size={14} /> {t('shopify.currencyNote', 'This store sells in {{currency}}. Profyn shows every figure in ₹; check the totals after the import.', { currency: tested.shop.currency })}
              </p>
            ) : null}
            {missingOrders ? (
              <p className="shop-warn" role="alert">
                <Icon name="alert-triangle" size={14} /> {t('shopify.needOrders', 'The token cannot read orders. Add the read_orders scope to the app, install it again and paste the new token.')}
              </p>
            ) : null}
            {missingAllOrders ? (
              <p className="shop-warn">
                <Icon name="alert-triangle" size={14} /> {t('shopify.needAllOrders', 'Without read_all_orders, Shopify returns only the last 60 days of orders.')}
              </p>
            ) : null}
          </div>
        ) : null}
        <ErrorCallout error={testError} className="shop-error" />
        <ErrorCallout error={connectError} className="shop-error" />
      </div>

      <div className="shop-buttons">
        <Button variant="secondary" icon="check-circle" onClick={() => void runTest()} disabled={testing}>
          {testing ? t('shopify.testing', 'Testing…') : t('shopify.test', 'Test connection')}
        </Button>
        <Button variant="primary" type="submit" iconRight="arrow-right" disabled={!canConnect}>
          {t('shopify.connectImport', 'Connect and import')}
        </Button>
        {!tested ? <p className="field-hint shop-buttons-hint">{t('shopify.testFirst', 'Test the connection first; Connect and import opens once it works.')}</p> : null}
      </div>
    </form>
  );
}

/** The right-hand drawer with the connect form. Rendered once per page, opened from any "Connect Shopify" button. */
export function ShopifyConnectDrawer() {
  const { t } = useTranslation();
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  return (
    <Drawer
      open={s.open}
      onClose={closeShopifyConnect}
      title={t('shopify.drawerTitle', 'Connect Shopify')}
      meta={
        <>
          <Pill tone="success" dot>
            {t('shopify.live', 'Live')}
          </Pill>
          <span className="drawer-date">{t('shopify.drawerMeta', 'Admin API · read only')}</span>
        </>
      }
    >
      {s.open ? <ShopifyConnectForm onClose={closeShopifyConnect} /> : null}
    </Drawer>
  );
}

/** Import screen: the Shopify entry next to the file importers. */
export function ShopifyCard() {
  const { t } = useTranslation();
  const s = useShopifyConnector();
  const headId = useId();
  const connector = s.connector;
  return (
    <section className="card shop-card" aria-labelledby={headId}>
      <div className="shop-card-head">
        <span className="shop-mark" aria-hidden="true">
          <BagMark size={18} />
        </span>
        <div className="shop-card-text">
          <h2 id={headId} className="card-title">
            {t('shopify.cardTitle', 'Shopify store')}
          </h2>
          <p className="card-sub">
            {connector ? <ShopifyStatusLine connector={connector} /> : t('shopify.cardSub', 'Import orders straight from your store with an Admin API token. No export needed; read only.')}
          </p>
        </div>
        <Pill tone="success" dot>
          {connector ? t('shopify.connected', 'Connected') : t('shopify.live', 'Live')}
        </Pill>
      </div>
      {connector ? (
        <ShopifyActions connector={connector} showDisconnect={false} />
      ) : (
        <div className="shop-actions">
          <Button variant="secondary" onClick={openShopifyConnect} className="shop-connect-btn">
            <BagMark size={16} />
            {t('shopify.connect', 'Connect Shopify')}
          </Button>
        </div>
      )}
    </section>
  );
}

export { BagMark };
