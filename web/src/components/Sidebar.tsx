import { BRAND } from '../brand';
import { hrefFor, type Route } from '../lib/router';
import { useStore } from '../state/store';
import { Icon, type IconName } from './Icon';

export const STEPS: Array<{ route: Route; label: string; icon: IconName; hint: string }> = [
  { route: 'import', label: 'Import', icon: 'upload-cloud', hint: 'Load orders' },
  { route: 'ledger', label: 'Ledger', icon: 'table', hint: 'Per-order contribution' },
  { route: 'leaks', label: 'Leaks', icon: 'alert-triangle', hint: 'Where money is lost' },
  { route: 'scenario', label: 'Scenario', icon: 'sliders', hint: 'Change one thing' },
  { route: 'decision', label: 'Decision', icon: 'check-circle', hint: 'Record what to do' },
];

export function Sidebar({ route }: { route: Route }) {
  const { datasetId, analysis, scenario, decisionSavedFor, engineVersion, checks, openChecks, openAbout } = useStore();

  const done: Record<Route, boolean> = {
    import: datasetId !== null,
    ledger: analysis !== null,
    leaks: analysis !== null,
    scenario: analysis !== null && scenario !== null && scenario.analysis_id === analysis.analysis_id,
    decision: analysis !== null && decisionSavedFor === analysis.analysis_id,
    pulse: false,
  };
  const pulseCurrent = route === 'pulse';
  const allPass = checks !== null && checks.passed === checks.total;

  return (
    <nav className="sidebar" aria-label="Steps">
      <button type="button" className="brand" onClick={openAbout} aria-label={`About ${BRAND.name}`} data-tip={`About ${BRAND.name}`}>
        <span className="brand-mark" aria-hidden="true">
          <Icon name="drop" size={18} strokeWidth={2} />
        </span>
        <span className="brand-text">
          <span className="brand-name">{BRAND.name}</span>
          <span className="brand-sub">{BRAND.tagline}</span>
        </span>
      </button>

      <ol className="nav">
        {STEPS.map((s, i) => {
          const current = s.route === route;
          const state = current ? 'is-active' : done[s.route] ? 'is-done' : 'is-future';
          return (
            <li key={s.route}>
              <a
                href={hrefFor(s.route)}
                className={`nav-item ${state}`}
                aria-current={current ? 'step' : undefined}
                aria-label={`Step ${i + 1}: ${s.label}${done[s.route] ? ', done' : ''}`}
                data-tip={s.label}
              >
                <Icon name={s.icon} size={19} />
                <span className="nav-text">
                  <span className="nav-label">{s.label}</span>
                  <span className="nav-hint">{s.hint}</span>
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
          Owner analytics
        </span>
        <a
          href={hrefFor('pulse')}
          className={`nav-item ${pulseCurrent ? 'is-active' : analysis ? 'is-done-quiet' : 'is-future'}`}
          aria-current={pulseCurrent ? 'page' : undefined}
          aria-label="Pulse: owner analytics"
          data-tip="Pulse"
        >
          <Icon name="bar-chart" size={19} />
          <span className="nav-text">
            <span className="nav-label">Pulse</span>
            <span className="nav-hint">Months, products, channels</span>
          </span>
        </a>
      </div>

      <div className="sidebar-foot">
        {checks ? (
          <button
            type="button"
            className={`checks-card${allPass ? '' : ' is-failing'}`}
            onClick={openChecks}
            aria-label={`${checks.passed} of ${checks.total} engine checks pass — open the public checks`}
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
        <p className="foot-note">
          Operational contribution, not statutory profit.{' '}
          <button type="button" className="foot-link" onClick={openAbout}>
            About
          </button>
        </p>
      </div>
    </nav>
  );
}
