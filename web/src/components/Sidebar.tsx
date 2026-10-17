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
  const { datasetId, analysis, scenario, decisionSavedFor, engineVersion, checks } = useStore();

  const done: Record<Route, boolean> = {
    import: datasetId !== null,
    ledger: analysis !== null,
    leaks: analysis !== null,
    scenario: analysis !== null && scenario !== null && scenario.analysis_id === analysis.analysis_id,
    decision: analysis !== null && decisionSavedFor === analysis.analysis_id,
  };
  const allPass = checks !== null && checks.passed === checks.total;

  return (
    <nav className="sidebar" aria-label="Steps">
      <a className="brand" href={hrefFor('import')} aria-label="Leak Desk, profit leak desk for C21">
        <span className="brand-mark" aria-hidden="true">
          <Icon name="drop" size={18} strokeWidth={2} />
        </span>
        <span className="brand-text">
          <span className="brand-name">Leak Desk</span>
          <span className="brand-sub">Profit leak desk · C21</span>
        </span>
      </a>

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

      <div className="sidebar-foot">
        {checks ? (
          <div className={`checks-card${allPass ? '' : ' is-failing'}`} title="Worked order, reconciliation in both attribution modes, scenario sensitivity">
            <span className="checks-icon" aria-hidden="true">
              <Icon name={allPass ? 'check-circle' : 'alert-triangle'} size={18} />
            </span>
            <span className="checks-text">
              <strong>
                Pack checks {checks.passed} of {checks.total} pass
              </strong>
              {engineVersion ? <span>Engine {engineVersion}</span> : null}
            </span>
          </div>
        ) : null}
        <p className="foot-note">Operational contribution, not statutory profit.</p>
      </div>
    </nav>
  );
}
