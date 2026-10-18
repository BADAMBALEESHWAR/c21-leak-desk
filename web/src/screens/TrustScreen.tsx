import { useEffect, useState, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { Health } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Pill } from '../components/Badge';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/Page';
import { apiText } from '../lib/apiText';
import { hrefFor } from '../lib/router';
import { fieldsOf, useAiStatus } from './AiScreen';

/** Readable city names for the AWS regions Profyn may run in, in the UI language. */
function regionName(t: TFunction, region: string): string | null {
  if (region === 'ap-south-1') return t('trust.mumbai', 'Mumbai');
  if (region === 'ap-south-2') return t('trust.hyderabad', 'Hyderabad');
  return null;
}

function useHealth(): Health | null {
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((x) => !cancelled && setH(x))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return h;
}

interface Row {
  key: string;
  promise: string;
  how: ReactNode;
  live: ReactNode;
}

/** The data promise: what Profyn does with your data, each row with what this server reports right now. */
export function TrustScreen() {
  const { t } = useTranslation();
  const auth = useAuth();
  const account = auth.mode === 'account';
  const health = useHealth();
  const ai = useAiStatus();
  const fields = fieldsOf(ai.status?.fields_sent);
  const region = health?.region ?? null;
  const india = region ? /^ap-south-/.test(region) : false;
  const city = region ? regionName(t, region) : null;

  const notReported = <span className="muted">{t('trust.notReported', 'Not reported by this server')}</span>;

  const rows: Row[] = [
    {
      key: 'region',
      promise: t('trust.regionPromise', 'Stored in India'),
      how: t('trust.regionHow', 'Your data is stored in an Indian cloud region.'),
      live: region ? (
        <Pill tone={india ? 'success' : 'warning'} dot>
          {apiText(region)}
          {city ? ` (${city})` : ''}
        </Pill>
      ) : (
        notReported
      ),
    },
    {
      key: 'encryption',
      promise: t('trust.encPromise', 'Encrypted at rest and in transit'),
      how: t('trust.encHow', 'HTTPS between your browser and Profyn; the database and file storage are encrypted at rest.'),
      live:
        health?.db === 'memory' ? (
          <span className="muted">{t('trust.encLocal', 'This server keeps data in memory only (local run).')}</span>
        ) : health ? (
          <Pill tone="neutral">
            {t('trust.dbStatus', 'database: {{db}}', {
              db: health.db === 'ok' ? t('trust.dbOk', 'ok') : health.db === 'down' ? t('trust.dbDown', 'down') : health.db,
            })}
          </Pill>
        ) : (
          notReported
        ),
    },
    {
      key: 'owner',
      promise: t('trust.ownerPromise', 'Only you see your data'),
      how: t('trust.ownerHow', 'Uploads, analyses and decisions belong to your account; other accounts cannot read them. Uploads in the demo go to a shared demo workspace.'),
      live: account ? <Pill tone="success">{t('trust.signedIn', 'Signed in: your own workspace')}</Pill> : <Pill tone="warning">{t('trust.demoMode', 'Demo workspace, shared')}</Pill>,
    },
    {
      key: 'aggregates',
      promise: t('trust.aggPromise', 'The AI sees aggregates only'),
      how: t('trust.aggHow', 'Totals, counts and labels; never order rows, customer names, emails or phone numbers.'),
      live:
        fields.length > 0 ? (
          <details className="trust-fields">
            <summary>{t('trust.fieldsCount', '{{n}} fields', { n: fields.length })}</summary>
            <ul>
              {fields.map((f) => (
                <li key={f}>
                  <code>{f}</code>
                </li>
              ))}
            </ul>
          </details>
        ) : ai.loading ? (
          <span className="muted">…</span>
        ) : (
          notReported
        ),
    },
    {
      key: 'training',
      promise: t('trust.trainPromise', 'Not used for training'),
      how: t('trust.trainHow', 'Profyn does not train models on your data. AI wording is off by default for uploaded data and on for the synthetic demo.'),
      live: ai.status ? (
        <Pill tone={ai.status.enabled ? 'primary' : 'neutral'}>{ai.status.enabled ? t('trust.aiOn', 'AI available on this server') : t('trust.aiOff', 'AI off on this server')}</Pill>
      ) : (
        notReported
      ),
    },
    {
      key: 'export',
      promise: t('trust.exportPromise', 'Export or delete, any time'),
      how: t('trust.exportHow', 'Download everything Profyn holds about you as a file, or delete your account and its data, from your profile.'),
      live: account ? <a href={hrefFor('profile')}>{t('trust.openProfile', 'Open your profile')}</a> : <span className="muted">{t('trust.signInFirst', 'Sign in to use it')}</span>,
    },
    {
      key: 'audit',
      promise: t('trust.auditPromise', 'Audit log'),
      how: t('trust.auditHow', 'Sign-ins, exports, consent changes and deletions are recorded with a date; you can read your own log.'),
      live: account ? <a href={hrefFor('profile')}>{t('trust.readLog', 'Read your log')}</a> : <span className="muted">{t('trust.signInFirst', 'Sign in to use it')}</span>,
    },
    {
      key: 'switch',
      promise: t('trust.switchPromise', 'An AI off switch'),
      how: t('trust.switchHow', 'Turn AI wording off; every number stays the same and the explanations use templates.'),
      live: <a href={hrefFor('ai')}>{t('trust.openSwitch', 'Open the switch')}</a>,
    },
  ];

  return (
    <div className="page trust-page">
      <PageHeader title={t('trust.title', 'Trust and privacy')} subtitle={t('trust.sub', 'The data promise, with what this server reports right now beside each line.')} />

      <section className="card table-card" aria-labelledby="trust-table-title">
        <div className="table-card-head">
          <div>
            <h2 id="trust-table-title" className="card-title">
              <Icon name="lock" size={18} /> {t('trust.tableTitle', 'The data promise')}
            </h2>
          </div>
        </div>
        <div className="table-scroll">
          <table className="table trust-table">
            <caption className="visually-hidden">{t('trust.tableTitle', 'The data promise')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('trust.colPromise', 'Promise')}</th>
                <th scope="col">{t('trust.colHow', 'What it means')}</th>
                <th scope="col">{t('trust.colLive', 'This server')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-row={r.key}>
                  <th scope="row">{r.promise}</th>
                  <td className="cell-wrap">{r.how}</td>
                  <td>{r.live}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="small muted">{t('trust.note', 'Operational contribution, not statutory profit. The demo uses labelled synthetic data.')}</p>
    </div>
  );
}
