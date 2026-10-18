import { useTranslation } from 'react-i18next';

/** Where data comes from, now and later. Plain text only: no logos, no links, no connected state. */
export function Integrations() {
  const { t } = useTranslation();
  const soon = t('landing.comingSoon', 'Coming soon');
  const phases = [
    { id: 'now', phase: t('landing.intNow', 'Now'), items: t('landing.intNowItems', 'CSV / JSON, report files, Shopify API'), status: t('landing.intWorking', 'Working'), live: true },
    { id: 'next', phase: t('landing.intNext', 'Next'), items: t('landing.intNextItems', 'Meta Ads, Razorpay'), status: soon, live: false },
    { id: 'later', phase: t('landing.intLater', 'Later'), items: t('landing.intLaterItems', 'Amazon, Flipkart, Myntra, Shiprocket, Google Ads'), status: soon, live: false },
  ];
  return (
    <div className="l-int">
      <div className="l-int-head">
        <h3 id="int-title" className="l-int-title">
          {t('landing.integrations', 'Integrations')}
        </h3>
        <p className="l-int-lead">{t('landing.integrationsLead', 'Upload files or connect your Shopify store today. Marketplace and payment connectors follow; nothing else is shown as connected until it is.')}</p>
      </div>
      <ol className="l-int-line" aria-labelledby="int-title">
        {phases.map((p) => (
          <li key={p.id} className={`l-int-step ${p.live ? 'is-live' : 'is-soon'}`}>
            <span className="l-int-dot" aria-hidden="true" />
            <span className="l-int-phase">{p.phase}</span>
            <span className="l-int-items">{p.items}</span>
            <span className={`l-status ${p.live ? 'is-live' : 'is-future'}`}>{p.status}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
