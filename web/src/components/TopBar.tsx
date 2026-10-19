import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toErrorInfo, type ErrorInfo } from '../api/client';
import type { AttributionMode } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { BRAND } from '../brand';
import { lower } from '../i18n';
import { formatCount } from '../lib/format';
import { ATTRIBUTION_TIP_EN, ATTRIBUTION_TIP_KEY, datasetName, isUploadSource } from '../lib/labels';
import { hrefFor, type Route } from '../lib/router';
import { useStore } from '../state/store';
import { Button, ButtonLink } from './Button';
import { Icon } from './Icon';
import { AttributionSegmented, InfoTip } from './ui';

const ATTRIBUTION_ROUTES: Route[] = ['ledger', 'leaks', 'scenario', 'pulse'];

/**
 * The bar above every screen. On phones it keeps one pinned row (menu, page, account) and moves the data chip,
 * attribution switch and worked-order button into a second row that scrolls away with the page.
 */
export function TopBar({
  route,
  onError,
  menuOpen = false,
  onMenu,
}: {
  route: Route;
  onError: (e: ErrorInfo | null) => void;
  menuOpen?: boolean;
  onMenu?: () => void;
}) {
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

  // Your own upload (no synthetic rows) is your data; the demo and every sample carry the demo disclaimer.
  const ownData = isUploadSource(source) && synthetic === 0;
  const sampleLoaded = source !== undefined && !isUploadSource(source);
  const disclaimer = ownData
    ? t('topbar.ownData', 'Your data · operational contribution, not statutory profit')
    : !account || sampleLoaded
      ? t('topbar.demoDisclaimer', 'Demo uses synthetic data. Not a live production system.')
      : null;

  const disclaimerLine = disclaimer ? (
    <p className={`topbar-disclaimer${ownData ? ' is-own' : ''}`} title={disclaimer}>
      {disclaimer}
    </p>
  ) : null;

  const chip =
    orders !== null ? (
      <span className="chip" title={t('topbar.loadedData', 'Loaded data: {{name}}', { name })}>
        <span className="chip-dot" aria-hidden="true" />
        <span className="chip-main">{name}</span>
        <span className="chip-extra">
          {' '}
          · {formatCount(orders)} {lower(t('ledger.orders'))}
          {synthetic > 0 ? ` · ${formatCount(synthetic)} ${lower(t('status.syntheticTag'))}` : ''}
        </span>
      </span>
    ) : null;

  const attribution =
    analysis && ATTRIBUTION_ROUTES.includes(route) ? (
      <span className="topbar-attr">
        <AttributionSegmented value={analysis.attribution} onChange={(m) => void onAttribution(m)} disabled={analysing || switching} compact />
        <InfoTip text={t(ATTRIBUTION_TIP_KEY, ATTRIBUTION_TIP_EN)} label={t('topbar.aboutAttribution', 'About attribution')} />
      </span>
    ) : null;

  const worked = (
    <Button
      variant="secondary"
      size="sm"
      icon="file"
      onClick={openWorked}
      className={account ? 'worked-btn is-compact' : 'worked-btn'}
      title={t('topbar.workedTip', 'Worked order: one order explained line by line')}
    >
      {t('actions.workedOrder')}
    </Button>
  );

  return (
    <>
    <header className="topbar">
      {onMenu ? (
        <button
          type="button"
          className="menu-btn"
          onClick={onMenu}
          aria-expanded={menuOpen}
          aria-controls="app-nav"
          aria-label={menuOpen ? t('nav.closeMenu', 'Close menu') : t('nav.openMenu', 'Open menu')}
        >
          <Icon name="menu" size={22} />
        </button>
      ) : null}
      <div className="topbar-left">
        <nav className="crumbs" aria-label={t('topbar.breadcrumb', 'Breadcrumb')}>
          <ol>
            <li>
              <a href={hrefFor('import')}>{BRAND.name}</a>
            </li>
            <li aria-current="page">{t(`nav.${route}`)}</li>
          </ol>
        </nav>
        {disclaimerLine}
      </div>

      <div className="topbar-actions">
        {chip}
        {attribution}
        {worked}

        {!auth.ready ? null : account ? (
          orders !== null ? (
            <span
              className={`status-pill ${saved ? 'is-saved' : 'is-memory'}`}
              title={
                saved
                  ? t('topbar.savedTip', 'This data is saved to your account.')
                  : t('topbar.memoryTip', 'The database is not available: this data is in memory only and will not be kept.')
              }
            >
              <Icon name={saved ? 'check-circle' : 'database'} size={14} />
              <span className="status-text">{saved ? t('topbar.savedToAccount') : t('topbar.inMemory')}</span>
            </span>
          ) : null
        ) : (
          <span className="status-pill is-demo" title={t('topbar.demoTip', 'Saved to the shared demo database. Sign in to keep your data in your own account.')}>
            <Icon name="info" size={14} />
            <span className="status-text">{t('topbar.demoWorkspace')}</span>
          </span>
        )}

        {!auth.ready ? null : account && auth.user && !auth.sessionEnded ? (
          <span className="user-chip">
            <a className="user-chip-link" href={hrefFor('profile')} title={t('topbar.profile', 'Your profile')}>
              {auth.user.avatarUrl ? (
                <img className="avatar avatar-img" src={auth.user.avatarUrl} alt="" width={28} height={28} referrerPolicy="no-referrer" />
              ) : (
                <span className="avatar" aria-hidden="true">
                  {(auth.user.name ?? email ?? auth.user.sub).charAt(0).toUpperCase()}
                </span>
              )}
              <span className="user-email" title={email ?? undefined}>
                {auth.user.name ?? email ?? t('topbar.signedIn')}
              </span>
            </a>
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
    {/* Phones only (hidden by CSS elsewhere): the same controls, unpinned, below the bar. */}
    <div className="topbar-sub">
      <div className="topbar-sub-row">
        {chip}
        {worked}
        {attribution}
      </div>
      {disclaimerLine}
    </div>
    </>
  );
}
