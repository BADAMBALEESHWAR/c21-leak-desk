import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';
import { Button } from './Button';
import { BagMark, openShopifyConnect, ShopifyActions, ShopifyConnectDrawer, ShopifyStatusLine, useShopifyConnector } from './ShopifyConnect';

/**
 * The data sources. Files work today: the CSV / JSON template and the marketplace and payment report importers.
 * Shopify connects directly with an Admin API token (read only). The other API connectors are planned, each with what
 * it needs before it can be built; none of them links to a vendor, shows a connected state or asks for a token.
 */

export type PlannedId = 'amazon' | 'flipkart' | 'myntra' | 'meta_ads' | 'google_ads';

interface Planned {
  id: PlannedId;
  name: string;
  nameKey: string;
  data: string;
  dataKey: string;
  /** What has to exist before the connector can be built; ends with "Not connected." */
  note: string;
  noteKey: string;
}

export const PLANNED: Planned[] = [
  {
    id: 'amazon',
    name: 'Amazon SP-API',
    nameKey: 'integrations.amazonApi',
    data: 'orders, fees, settlements',
    dataKey: 'integrations.amazonData',
    note: 'Needs SP-API developer registration and your seller authorisation. Not connected.',
    noteKey: 'integrations.amazonPrereq',
  },
  {
    id: 'flipkart',
    name: 'Flipkart Seller API',
    nameKey: 'integrations.flipkartApi',
    data: 'orders, returns, commissions',
    dataKey: 'integrations.flipkartData',
    note: 'Needs a Flipkart Seller API key. Not connected.',
    noteKey: 'integrations.flipkartPrereq',
  },
  {
    id: 'myntra',
    name: 'Myntra partner API',
    nameKey: 'integrations.myntraApi',
    data: 'orders, returns',
    dataKey: 'integrations.myntraData',
    note: 'Needs a partner invitation from Myntra. Not connected.',
    noteKey: 'integrations.myntraPrereq',
  },
  {
    id: 'meta_ads',
    name: 'Meta Ads',
    nameKey: 'integrations.metaAds',
    data: 'ad spend by campaign',
    dataKey: 'integrations.metaAdsData',
    note: 'Would read ad spend by campaign, allocated to orders. Not connected.',
    noteKey: 'integrations.metaAdsPrereq',
  },
  {
    id: 'google_ads',
    name: 'Google Ads',
    nameKey: 'integrations.googleAds',
    data: 'ad spend',
    dataKey: 'integrations.googleAdsData',
    note: 'Would read ad spend by campaign. Not connected.',
    noteKey: 'integrations.googleAdsPrereq',
  },
];

/** Report files the importer maps today (Import → the marketplace buttons). */
export const REPORT_IMPORTERS: Array<{ id: string; name: string; nameKey: string }> = [
  { id: 'amazon_settlement', name: 'Amazon settlement report', nameKey: 'integrations.rAmazon' },
  { id: 'flipkart_orders', name: 'Flipkart orders report', nameKey: 'integrations.rFlipkart' },
  { id: 'myntra_orders', name: 'Myntra orders report', nameKey: 'integrations.rMyntra' },
  { id: 'shopify_orders', name: 'Shopify orders export', nameKey: 'integrations.rShopify' },
  { id: 'razorpay_payments', name: 'Razorpay payments', nameKey: 'integrations.rRazorpay' },
  { id: 'shiprocket_shipments', name: 'Shiprocket shipments', nameKey: 'integrations.rShiprocket' },
];

const NOTIFY_KEY = 'profyn.notifyMe';

export interface NotifyRequest {
  email: string;
  integration: PlannedId;
  date: string;
}

/** Requests stay in this browser only; nothing is sent anywhere. */
export function readNotifyRequests(): NotifyRequest[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(NOTIFY_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function recordNotify(r: NotifyRequest): boolean {
  try {
    window.localStorage.setItem(NOTIFY_KEY, JSON.stringify([...readNotifyRequests(), r]));
    return true;
  } catch {
    return false;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function NotifyMe() {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [integration, setIntegration] = useState<PlannedId>('amazon');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = email.trim();
    if (!EMAIL.test(v)) {
      setError(t('integrations.emailInvalid', 'Enter an email address, for example owner@brand.in.'));
      return;
    }
    recordNotify({ email: v, integration, date: new Date().toISOString() });
    setError(null);
    setDone(true);
    setOpen(false);
    setEmail('');
  };

  if (done && !open) {
    return (
      <p className="intg-done" role="status">
        <Icon name="check-circle" size={16} /> {t('integrations.recorded', 'Recorded. Nothing is connected yet.')}
      </p>
    );
  }
  if (!open) {
    return (
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
        <span>{t('integrations.notifyMe', 'Notify me')}</span>
      </button>
    );
  }
  return (
    <form className="intg-notify" onSubmit={submit} noValidate>
      <label className="visually-hidden" htmlFor={`${id}-email`}>
        {t('integrations.email', 'Email')}
      </label>
      <input
        id={`${id}-email`}
        className="input"
        type="email"
        autoComplete="email"
        placeholder={t('integrations.emailPlaceholder', 'you@brand.in')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-note${error ? ` ${id}-error` : ''}`}
        autoFocus
      />
      <label className="visually-hidden" htmlFor={`${id}-which`}>
        {t('integrations.which', 'Integration')}
      </label>
      <select id={`${id}-which`} className="input" value={integration} onChange={(e) => setIntegration(e.target.value as PlannedId)}>
        {PLANNED.map((p) => (
          <option key={p.id} value={p.id}>
            {t(p.nameKey, p.name)}
          </option>
        ))}
      </select>
      <button type="submit" className="btn btn-primary btn-sm">
        <span>{t('integrations.save', 'Notify me')}</span>
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
        <span>{t('integrations.cancel', 'Cancel')}</span>
      </button>
      <span id={`${id}-note`} className="intg-notify-note">
        {t('integrations.notifyNote', 'Kept in this browser only; nothing is sent or connected.')}
      </span>
      {error ? (
        <span id={`${id}-error`} className="field-error">
          {error}
        </span>
      ) : null}
    </form>
  );
}

function Timeline() {
  const { t } = useTranslation();
  const steps: Array<[string, string, string]> = [
    ['now', t('integrations.now', 'Now'), t('integrations.nowWhatV3', 'CSV / JSON, report files, Shopify API')],
    ['next', t('integrations.nextV2', 'Next'), t('integrations.nextWhatV3', 'Meta Ads, Razorpay')],
    ['later', t('integrations.laterV2', 'Later'), t('integrations.laterWhatV2', 'Amazon, Flipkart and Myntra APIs, Google Ads')],
  ];
  return (
    <ol className="intg-timeline" aria-label={t('integrations.timeline', 'Integration timeline')}>
      {steps.map(([k, when, what]) => (
        <li key={k} className={`intg-step intg-step-${k}`}>
          <span className="intg-step-dot" aria-hidden="true" />
          <span className="intg-step-when">{when}</span>
          <span className="intg-step-what">{what}</span>
        </li>
      ))}
    </ol>
  );
}

/** The live Shopify connector: Connect Shopify, or its connected state with Sync now, Open overview and Disconnect. */
function ShopifyRow({ compact }: { compact: boolean }) {
  const { t } = useTranslation();
  const s = useShopifyConnector(!compact);
  const connector = compact ? null : s.connector;
  return (
    <li className={`intg-item is-connector${connector ? ' is-connected' : ''}`} data-connector="shopify">
      <span className="intg-mark intg-mark-live" aria-hidden="true">
        <BagMark size={16} />
      </span>
      <span className="intg-text">
        <span className="intg-name">{t('integrations.shopifyApi', 'Shopify API')}</span>
        <span className="intg-data">{t('integrations.shopifyDataLive', 'orders, refunds, discounts, products · read only')}</span>
        {compact ? null : connector ? (
          <span className="intg-prereq intg-connected">
            <ShopifyStatusLine connector={connector} />
          </span>
        ) : (
          <span className="intg-prereq">{t('integrations.shopifyHow', 'Connect with an Admin API access token from your Shopify admin. Not connected.')}</span>
        )}
      </span>
      <span className="intg-pills">
        <span className="pill pill-success">
          <span className="pill-dot" aria-hidden="true" />
          {connector ? t('shopify.connected', 'Connected') : t('shopify.live', 'Live')}
        </span>
      </span>
      {compact ? null : (
        <span className="intg-connector-actions">
          {connector ? (
            <ShopifyActions connector={connector} />
          ) : (
            <Button variant="primary" size="sm" onClick={openShopifyConnect}>
              {t('shopify.connect', 'Connect Shopify')}
            </Button>
          )}
        </span>
      )}
    </li>
  );
}

/** Import screen (full) and a compact list: what works now, the live Shopify connector, and what is planned. */
export function Integrations({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const headId = useId();
  const available = t('integrations.availableNow', 'Available now');
  return (
    <section className={`card intg${compact ? ' intg-compact' : ''}`} aria-labelledby={headId}>
      <div className="intg-head">
        <div>
          <h2 id={headId} className="card-title">
            {t('integrations.title', 'Data sources')}
          </h2>
          {compact ? null : (
            <p className="card-sub">
              {t('integrations.subV3', 'Files work today: the template and the marketplace and payment reports. Shopify connects directly with an Admin API token and only reads. The other API connectors are planned and not connected.')}
            </p>
          )}
        </div>
        {compact ? null : <NotifyMe />}
      </div>

      <h3 className="intg-group">{available}</h3>
      <ul className="intg-list">
        <li className="intg-item is-live">
          <span className="intg-mark intg-mark-live" aria-hidden="true">
            <Icon name="check" size={16} strokeWidth={2.4} />
          </span>
          <span className="intg-text">
            <span className="intg-name">{t('integrations.csv', 'CSV / JSON upload')}</span>
            <span className="intg-data">{t('integrations.csvData', 'every column in the template')}</span>
          </span>
          <span className="pill pill-success">
            <span className="pill-dot" aria-hidden="true" />
            {t('integrations.working', 'working')}
          </span>
        </li>
        {REPORT_IMPORTERS.map((r) => (
          <li key={r.id} className="intg-item is-live is-report" data-importer={r.id}>
            <span className="intg-mark intg-mark-live" aria-hidden="true">
              <Icon name="file" size={15} />
            </span>
            <span className="intg-text">
              <span className="intg-name">{t(r.nameKey, r.name)}</span>
              <span className="intg-data">{t('integrations.reportData', 'report file, columns mapped on import')}</span>
            </span>
            <span className="pill pill-success">
              <span className="pill-dot" aria-hidden="true" />
              {available}
            </span>
          </li>
        ))}
      </ul>

      <h3 className="intg-group">{t('integrations.liveApis', 'API connectors')}</h3>
      <ul className="intg-list intg-list-connectors">
        <ShopifyRow compact={compact} />
      </ul>

      <h3 className="intg-group">{t('integrations.plannedApis', 'Planned API connectors')}</h3>
      <ul className="intg-list">
        {PLANNED.map((p) => (
          <li key={p.id} className="intg-item is-planned" aria-disabled="true" tabIndex={compact ? undefined : 0} aria-describedby={compact ? undefined : `${headId}-${p.id}`}>
            <span className="intg-mark" aria-hidden="true">
              <Icon name="database" size={15} />
            </span>
            <span className="intg-text">
              <span className="intg-name">{t(p.nameKey, p.name)}</span>
              <span className="intg-data">{t(p.dataKey, p.data)}</span>
              {compact ? null : (
                <span id={`${headId}-${p.id}`} className="intg-prereq">
                  {t(p.noteKey, p.note)}
                </span>
              )}
            </span>
            <span className="intg-pills">
              <span className="pill pill-neutral intg-soon">{t('integrations.planned', 'Planned')}</span>
            </span>
          </li>
        ))}
      </ul>
      <Timeline />
      {compact ? null : <ShopifyConnectDrawer />}
    </section>
  );
}
