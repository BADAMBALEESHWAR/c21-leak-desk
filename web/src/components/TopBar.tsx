import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toErrorInfo, type ErrorInfo } from '../api/client';
import type { AttributionMode } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { BRAND } from '../brand';
import { lower } from '../i18n';
import { formatCount } from '../lib/format';
import { ATTRIBUTION_LABEL, datasetName } from '../lib/labels';
import { hrefFor, type Route } from '../lib/router';
import { useStore } from '../state/store';
import { Button, ButtonLink } from './Button';
import { Icon } from './Icon';
import { AttributionSegmented, InfoTip } from './ui';

const ATTRIBUTION_ROUTES: Route[] = ['ledger', 'leaks', 'scenario', 'pulse'];

export const DEMO_PILL_TIP = 'Demo workspace: uploads are stored, but not tied to an account.';

export function TopBar({ route, onError }: { route: Route; onError: (e: ErrorInfo | null) => void }) {
  const { dataset, analysis, samples, analysing, runAnalysis, openWorked, dbStatus } = useStore();
  const auth = useAuth();
  const account = auth.mode === 'account';
  const [switching, setSwitching] = useState(false);
  const { t } = useTranslation();

  const source = dataset?.source;
  const name = datasetName(source, dataset?.files, samples.find((s) => s.source === source)?.label);
  const orders = analysis ? analysis.totals.orders : dataset?.rows_kept ?? null;
  const synthetic = analysis ? analysis.orders.filter((o) => o.synthetic).length : dataset?.synthetic_rows ?? 0;

  // What the API said when it was written; data opened from the saved list follows the database status.
  const persisted = analysis?.persisted ?? dataset?.persisted;
  const saved = persisted ?? (dbStatus ? dbStatus === 'ok' : true);

  const onAttribution = async (mode: AttributionMode) => {
    if (!analysis || mode === analysis.attribution) return;
    onError(null);
    setSwitching(true);
    try {
      await runAnalysis(mode, analysis.period_end, analysis.dataset_id, analysis.config.handling_default_inr);
    } catch (err) {
      onError(toErrorInfo(err));
    } finally {
      setSwitching(false);
    }
  };

  const email = auth.user?.email ?? null;

  return (
    <header className="topbar">
      <nav className="crumbs" aria-label="Breadcrumb">
        <ol>
          <li>
            <a href={hrefFor('import')}>{BRAND.name}</a>
          </li>
          <li aria-current="page">{t(`nav.${route}`)}</li>
        </ol>
      </nav>

      <div className="topbar-actions">
        {orders !== null ? (
          <span className="chip" title={`Loaded data: ${name}`}>
            <span className="chip-dot" aria-hidden="true" />
            <span className="chip-main">{name}</span>
            <span className="chip-extra">
              {' '}
              · {formatCount(orders)} {lower(t('ledger.orders'))}
              {synthetic > 0 ? ` · ${formatCount(synthetic)} ${lower(t('status.syntheticTag'))}` : ''}
            </span>
          </span>
        ) : null}

        {analysis && ATTRIBUTION_ROUTES.includes(route) ? (
          <span className="topbar-attr">
            <AttributionSegmented value={analysis.attribution} onChange={(m) => void onAttribution(m)} disabled={analysing || switching} compact />
            <InfoTip text={ATTRIBUTION_LABEL} label="About attribution" />
          </span>
        ) : null}

        <Button
          variant="secondary"
          size="sm"
          icon="file"
          onClick={openWorked}
          className={account ? 'worked-btn is-compact' : 'worked-btn'}
          title="Worked order: one order explained line by line"
        >
          {t('actions.workedOrder')}
        </Button>

        {!auth.ready ? null : account ? (
          orders !== null ? (
            <span
              className={`status-pill ${saved ? 'is-saved' : 'is-memory'}`}
              title={saved ? 'This data is saved to your account.' : 'The database is not available: this data is in memory only and will not be kept.'}
            >
              <Icon name={saved ? 'check-circle' : 'database'} size={14} />
              <span className="status-text">{saved ? t('topbar.savedToAccount') : t('topbar.inMemory')}</span>
            </span>
          ) : null
        ) : (
          <span className="status-pill is-demo" title={DEMO_PILL_TIP}>
            <Icon name="info" size={14} />
            <span className="status-text">{t('topbar.demoWorkspace')}</span>
          </span>
        )}

        {!auth.ready ? null : account && auth.user && !auth.sessionEnded ? (
          <span className="user-chip">
            <span className="avatar" aria-hidden="true">
              {(email ?? auth.user.sub).charAt(0).toUpperCase()}
            </span>
            <span className="user-email" title={email ?? undefined}>
              {email ?? t('topbar.signedIn')}
            </span>
            <Button variant="ghost" size="sm" icon="log-out" className="signout-btn" onClick={auth.signOut}>
              {t('actions.signOut')}
            </Button>
          </span>
        ) : auth.hasSession ? null : (
          <ButtonLink variant="secondary" size="sm" icon="user" className="signin-btn" href={auth.loginUrl}>
            {t('actions.signIn')}
          </ButtonLink>
        )}
      </div>
    </header>
  );
}
