import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';

/**
 * The data-source roadmap. Only CSV / JSON upload works today; every other source is planned and shown greyed out.
 * Nothing here links to a vendor, shows a connected state or asks for a token.
 */

export type PlannedId = 'shopify' | 'meta_ads' | 'google_ads' | 'shiprocket' | 'razorpay';

interface Planned {
  id: PlannedId;
  name: string;
  nameKey: string;
  data: string;
  dataKey: string;
  note: string;
  noteKey: string;
  phase: 1 | 2;
}

export const PLANNED: Planned[] = [
  {
    id: 'shopify',
    name: 'Shopify',
    nameKey: 'integrations.shopify',
    data: 'orders, refunds, product costs',
    dataKey: 'integrations.shopifyData',
    note: 'Phase 1: would read orders, refunds and product costs from your store. Not connected.',
    noteKey: 'integrations.shopifyNote',
    phase: 1,
  },
  {
    id: 'meta_ads',
    name: 'Meta Ads',
    nameKey: 'integrations.metaAds',
    data: 'ad spend by campaign',
    dataKey: 'integrations.metaAdsData',
    note: 'Phase 1: would read ad spend by campaign, allocated to orders. Not connected.',
    noteKey: 'integrations.metaAdsNote',
    phase: 1,
  },
  {
    id: 'google_ads',
    name: 'Google Ads',
    nameKey: 'integrations.googleAds',
    data: 'ad spend',
    dataKey: 'integrations.googleAdsData',
    note: 'Phase 2: would read ad spend by campaign. Not connected.',
    noteKey: 'integrations.googleAdsNote',
    phase: 2,
  },
  {
    id: 'shiprocket',
    name: 'Shiprocket / courier',
    nameKey: 'integrations.shiprocket',
    data: 'shipping, RTO, recovery',
    dataKey: 'integrations.shiprocketData',
    note: 'Phase 2: would read shipping, RTO and recovered stock per order. Not connected.',
    noteKey: 'integrations.shiprocketNote',
    phase: 2,
  },
  {
    id: 'razorpay',
    name: 'Razorpay / payment gateway',
    nameKey: 'integrations.razorpay',
    data: 'payment fees, refunds',
    dataKey: 'integrations.razorpayData',
    note: 'Phase 2: would read payment fees and refunds per order. Not connected.',
    noteKey: 'integrations.razorpayNote',
    phase: 2,
  },
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
  const [integration, setIntegration] = useState<PlannedId>('shopify');
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
    ['now', t('integrations.now', 'Now'), t('integrations.nowWhat', 'CSV / JSON')],
    ['next', t('integrations.next', 'Next (Phase 1)'), t('integrations.nextWhat', 'Shopify + Meta Ads')],
    ['later', t('integrations.later', 'Later (Phase 2)'), t('integrations.laterWhat', 'Shiprocket, Razorpay, Google Ads')],
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

/** Import screen (full) and landing (compact): what works now and what is planned. Visible, never clickable. */
export function Integrations({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const headId = useId();
  return (
    <section className={`card intg${compact ? ' intg-compact' : ''}`} aria-labelledby={headId}>
      <div className="intg-head">
        <div>
          <h2 id={headId} className="card-title">
            {t('integrations.title', 'Data sources')}
          </h2>
          {compact ? null : (
            <p className="card-sub">{t('integrations.sub', 'Upload works today. Direct connections are on the roadmap; none is connected or asks for a key.')}</p>
          )}
        </div>
        {compact ? null : <NotifyMe />}
      </div>
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
        {PLANNED.map((p) => (
          <li key={p.id} className="intg-item is-planned" aria-disabled="true" tabIndex={compact ? undefined : 0} aria-describedby={compact ? undefined : `${headId}-${p.id}`}>
            <span className="intg-mark" aria-hidden="true">
              <Icon name="database" size={15} />
            </span>
            <span className="intg-text">
              <span className="intg-name">{t(p.nameKey, p.name)}</span>
              <span className="intg-data">{t(p.dataKey, p.data)}</span>
            </span>
            <span className="pill pill-neutral intg-soon">{t('integrations.soon', 'Coming soon')}</span>
            {compact ? null : (
              <span id={`${headId}-${p.id}`} role="tooltip" className="intg-note">
                {t(p.noteKey, p.note)}
              </span>
            )}
          </li>
        ))}
      </ul>
      <Timeline />
    </section>
  );
}
