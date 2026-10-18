import { useTranslation } from 'react-i18next';
import { useOptionalAuth } from '../auth/AuthContext';
import { BRAND } from '../brand';
import { LANGS, setLanguage, type Lang } from '../i18n';
import { hrefFor, navigate, type Route } from '../lib/router';
import { useStore } from '../state/store';
import { Icon, type IconName } from './Icon';
import { LogoMark } from './LogoMark';

export const STEPS: Array<{ route: Route; label: string; icon: IconName; hint: string }> = [
  { route: 'import', label: 'Import', icon: 'upload-cloud', hint: 'Load orders' },
  { route: 'ledger', label: 'Ledger', icon: 'table', hint: 'Per-order contribution' },
  { route: 'leaks', label: 'Leaks', icon: 'alert-triangle', hint: 'Where money is lost' },
  { route: 'scenario', label: 'Scenario', icon: 'sliders', hint: 'Change one thing' },
  { route: 'decision', label: 'Decision', icon: 'check-circle', hint: 'Record what to do' },
];

/** Proof and reporting pages, below the checks card. */
const FOOT_LINKS: Array<{ route: Route; key: string; label: string; icon: IconName; account?: boolean }> = [
  { route: 'checks', key: 'nav.checks', label: 'Checks', icon: 'check-circle' },
  { route: 'report', key: 'nav.report', label: 'Monthly report', icon: 'file' },
  { route: 'ai', key: 'nav.ai', label: 'Why Profyn AI', icon: 'sparkles' },
  { route: 'trust', key: 'nav.trust', label: 'Trust and privacy', icon: 'lock' },
  { route: 'profile', key: 'nav.profile', label: 'Your profile', icon: 'user', account: true },
];

/** Shown in the collapsed sidebar, where the full names do not fit; the full name stays the accessible name. */
const LANG_SHORT: Record<Lang, string> = { en: 'EN', hi: 'हि', te: 'తె' };

/** English, हिन्दी, తెలుగు: each name in its own script. */
function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? i18n.language;
  return (
    <div className="lang-switch" role="group" aria-label={t('lang.label')}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          className={`lang-btn${current === l ? ' is-current' : ''}`}
          aria-pressed={current === l}
          onClick={() => setLanguage(l)}
        >
          <span className="lang-long">{t(`lang.${l}`)}</span>
          <span className="lang-short" aria-hidden="true">
            {LANG_SHORT[l]}
          </span>
        </button>
      ))}
    </div>
  );
}

export function Sidebar({ route }: { route: Route }) {
  const { t } = useTranslation();
  const { datasetId, analysis, scenario, decisionSavedFor, engineVersion, checks, openAbout } = useStore();
  const auth = useOptionalAuth();
  const account = Boolean(auth?.ready && auth.mode === 'account');

  const done: Record<Route, boolean> = {
    import: datasetId !== null,
    ledger: analysis !== null,
    leaks: analysis !== null,
    scenario: analysis !== null && scenario !== null && scenario.analysis_id === analysis.analysis_id,
    decision: analysis !== null && decisionSavedFor === analysis.analysis_id,
    pulse: false,
    checks: false,
    changelog: false,
    report: false,
    overview: false,
    trust: false,
    ai: false,
    profile: false,
  };
  const pulseCurrent = route === 'pulse';
  const overviewCurrent = route === 'overview';
  const allPass = checks !== null && checks.passed === checks.total;
  const footLinks = FOOT_LINKS.filter((l) => !l.account || account);

  return (
    <nav className="sidebar" aria-label="Steps">
      <button type="button" className="brand" onClick={openAbout} aria-label={`About ${BRAND.name}`} data-tip={`About ${BRAND.name}`}>
        <span className="brand-mark" aria-hidden="true">
          <LogoMark size={34} />
        </span>
        <span className="brand-text">
          <span className="brand-name">{BRAND.name}</span>
          <span className="brand-sub">{t('tagline')}</span>
        </span>
      </button>

      <a
        href={hrefFor('overview')}
        className={`nav-item nav-overview ${overviewCurrent ? 'is-active' : datasetId || analysis ? 'is-done-quiet' : 'is-future'}`}
        aria-current={overviewCurrent ? 'page' : undefined}
        data-tip={t('nav.overview', 'Overview')}
      >
        <Icon name="activity" size={19} />
        <span className="nav-text">
          <span className="nav-label">{t('nav.overview', 'Overview')}</span>
          <span className="nav-hint">{t('nav.hint.overview', 'Findings and top 3 actions')}</span>
        </span>
      </a>

      <ol className="nav">
        {STEPS.map((s, i) => {
          const current = s.route === route;
          const state = current ? 'is-active' : done[s.route] ? 'is-done' : 'is-future';
          const label = t(`nav.${s.route}`);
          return (
            <li key={s.route}>
              <a
                href={hrefFor(s.route)}
                className={`nav-item ${state}`}
                aria-current={current ? 'step' : undefined}
                aria-label={`${t('nav.step', { n: i + 1, label })}${done[s.route] ? t('nav.done') : ''}`}
                data-tip={label}
              >
                <Icon name={s.icon} size={19} />
                <span className="nav-text">
                  <span className="nav-label">{label}</span>
                  <span className="nav-hint">{t(`nav.hint.${s.route}`)}</span>
                </span>
                {done[s.route] && !current ? (
                  <span className="nav-check" aria-hidden="true">
                    <Icon name="check" size={12} strokeWidth={2.5} />
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ol>

      <div className="nav-group" role="group" aria-labelledby="nav-group-owner">
        <span id="nav-group-owner" className="nav-group-label">
          {t('nav.ownerAnalytics')}
        </span>
        <a
          href={hrefFor('pulse')}
          className={`nav-item ${pulseCurrent ? 'is-active' : analysis ? 'is-done-quiet' : 'is-future'}`}
          aria-current={pulseCurrent ? 'page' : undefined}
          aria-label={t('nav.pulseAria')}
          data-tip={t('nav.pulse')}
        >
          <Icon name="bar-chart" size={19} />
          <span className="nav-text">
            <span className="nav-label">{t('nav.pulse')}</span>
            <span className="nav-hint">{t('nav.hint.pulse')}</span>
          </span>
        </a>
      </div>

      <div className="sidebar-foot">
        {checks ? (
          <button
            type="button"
            className={`checks-card${allPass ? '' : ' is-failing'}${route === 'checks' ? ' is-current' : ''}`}
            onClick={() => navigate('checks')}
            aria-label={`${checks.passed} of ${checks.total} engine checks pass — open the public checks`}
            aria-current={route === 'checks' ? 'page' : undefined}
            data-tip="Public checks"
          >
            <span className="checks-icon" aria-hidden="true">
              <Icon name={allPass ? 'check-circle' : 'alert-triangle'} size={18} />
            </span>
            <span className="checks-text">
              <strong>
                {allPass ? `All ${checks.total} checks pass` : `${checks.passed} of ${checks.total} checks pass`}
              </strong>
              {engineVersion ? <span>Engine {engineVersion} · view details</span> : null}
            </span>
          </button>
        ) : null}
        <ul className="foot-links" aria-label={t('nav.more', 'More')}>
          {footLinks.map((l) => (
            <li key={l.route}>
              <a
                href={hrefFor(l.route)}
                className={`foot-link-item${route === l.route ? ' is-active' : ''}`}
                aria-current={route === l.route ? 'page' : undefined}
                data-tip={t(l.key, l.label)}
              >
                <Icon name={l.icon} size={15} />
                <span className="foot-link-text">{t(l.key, l.label)}</span>
              </a>
            </li>
          ))}
        </ul>
        <p className="foot-note">
          {t('footer.note')}{' '}
          <button type="button" className="foot-link" onClick={openAbout}>
            {t('actions.about')}
          </button>
        </p>
        <LanguageSwitch />
      </div>
    </nav>
  );
}
