import { useEffect, useRef, useState } from 'react';
import { SESSION_ENDED, toErrorInfo, type ErrorInfo } from './api/client';
import { isSampleSource, SAMPLE_SOURCES, type AttributionMode } from './api/types';
import { useAuth, WORKSPACE_URL } from './auth/AuthContext';
import { BRAND } from './brand';
import { AskDrawer } from './components/AskDrawer';
import { ButtonLink } from './components/Button';
import { ErrorNote } from './components/ErrorNote';
import { Icon } from './components/Icon';
import { OrderDrawer } from './components/OrderDrawer';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Callout, SkeletonCards } from './components/ui';
import { Toast } from './components/Toast';
import { SAMPLE_NAMES } from './lib/labels';
import { navigate, parseHash, replaceWithBareRoute, useHashLocation, type Location, type Route } from './lib/router';
import { AiScreen } from './screens/AiScreen';
import { ChangelogScreen } from './screens/ChangelogScreen';
import { ChecksScreen } from './screens/ChecksScreen';
import { DecisionScreen } from './screens/DecisionScreen';
import { ImportScreen } from './screens/ImportScreen';
import { LeaksScreen } from './screens/LeaksScreen';
import { LedgerScreen } from './screens/LedgerScreen';
import { OverviewScreen } from './screens/OverviewScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { PulseScreen } from './screens/PulseScreen';
import { ReportScreen } from './screens/ReportScreen';
import { ScenarioScreen } from './screens/ScenarioScreen';
import { TrustScreen } from './screens/TrustScreen';
import { useStore } from './state/store';
import './styles/v2.css';
import './styles/mobile.css';

const SCREENS: Record<Route, () => JSX.Element> = {
  overview: OverviewScreen,
  import: ImportScreen,
  ledger: LedgerScreen,
  leaks: LeaksScreen,
  scenario: ScenarioScreen,
  decision: DecisionScreen,
  pulse: PulseScreen,
  checks: ChecksScreen,
  changelog: ChangelogScreen,
  report: ReportScreen,
  trust: TrustScreen,
  ai: AiScreen,
  profile: ProfileScreen,
};

/** Read at load, before the router fills in a default route: "/app/" with no route opens the workspace's own start page. */
const START_BARE = /^#?\/?$/.test(window.location.hash);
const START_LOAD = parseHash(window.location.hash).params.has('load');

type PendingDrawer = { order: string | null; worked: boolean; checks?: boolean; about?: boolean };

const loadingLabel = (source: string) => (SAMPLE_NAMES[source] ? `the ${SAMPLE_NAMES[source].toLowerCase()}` : `the ${source.replace(/_/g, ' ')} sample`);

/**
 * Deep links for demos and screenshots, on any route:
 *   ?load=<sample>&attribution=channel&period_end=YYYY-MM-DD&order=O05&worked=1&checks=1&about=1
 * Handled once the mode is known, so the sample lands in the right workspace.
 */
function useDeepLink(loc: Location, ready: boolean) {
  const { importDataset, runAnalysis, analysis, openOrder, openWorked, openChecks, openAbout } = useStore();
  const handled = useRef<Location | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // fromImport: the dataset load failed; the import step shows that one under its drop zone.
  const [error, setError] = useState<{ info: ErrorInfo; fromImport: boolean } | null>(null);
  const [pending, setPending] = useState<PendingDrawer | null>(null);

  useEffect(() => {
    if (!ready || handled.current === loc) return;
    handled.current = loc;
    const p = loc.params;
    const load = p.get('load');
    const order = p.get('order');
    const worked = p.get('worked') === '1';
    const checks = p.get('checks') === '1';
    const about = p.get('about') === '1';
    if (!load && !order && !worked && !checks && !about) return;
    replaceWithBareRoute(loc.route);
    setError(null);

    if (!load) {
      setPending({ order, worked, checks, about });
      return;
    }
    if (!isSampleSource(load)) {
      setError({ info: { message: `“${load}” is not a sample.`, hint: `Use one of: ${SAMPLE_SOURCES.join(', ')}.`, issues: [] }, fromImport: false });
      return;
    }
    const attribution: AttributionMode = p.get('attribution') === 'channel' ? 'channel' : 'allocate';
    const periodEnd = p.get('period_end') ?? undefined;
    setBusy(load);
    (async () => {
      let imported = false;
      try {
        const ds = await importDataset({ source: load });
        imported = true;
        await runAnalysis(attribution, periodEnd, ds.dataset_id);
        // A load without a screen of its own (bare /app/?load= or #/import?load=) lands on the overview.
        if (loc.route === 'import') navigate('overview');
        if (order || worked || checks || about) setPending({ order, worked, checks, about });
      } catch (err) {
        setError({ info: toErrorInfo(err), fromImport: !imported });
      } finally {
        setBusy(null);
      }
    })();
  }, [loc, ready, importDataset, runAnalysis]);

  useEffect(() => {
    if (!pending || busy) return;
    if (pending.checks) {
      setPending(null);
      openChecks();
      return;
    }
    if (pending.about) {
      setPending(null);
      openAbout();
      return;
    }
    if (pending.worked) {
      setPending(null);
      openWorked();
      return;
    }
    if (pending.order && analysis) {
      setPending(null);
      openOrder(pending.order);
    }
  }, [pending, busy, analysis, openOrder, openWorked, openChecks, openAbout]);

  return { busy, error };
}

/** Before the mode is known: no screen at all, so neither the demo nor an empty workspace flashes. */
function Opening() {
  return (
    <div className="app-opening" role="status" aria-live="polite">
      <span className="app-opening-mark" aria-hidden="true">
        <Icon name="drop" size={22} strokeWidth={2} />
      </span>
      <p className="loading-line">
        <span className="spinner" aria-hidden="true" /> Opening {BRAND.name}…
      </p>
    </div>
  );
}

export function App() {
  const loc = useHashLocation();
  const auth = useAuth();
  const { apiStatus, restoreError, starting, analysis } = useStore();
  const deepLink = useDeepLink(loc, auth.ready);
  const mainRef = useRef<HTMLElement>(null);
  const firstRoute = useRef(true);
  const startRouted = useRef(false);
  const [topError, setTopError] = useState<ErrorInfo | null>(null);
  const account = auth.ready && auth.mode === 'account';
  const opening = account && starting;

  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    window.scrollTo(0, 0);
  }, [loc.route]);

  // Workspace start: "/app/" opens the overview on the latest saved analysis, or Import when nothing is saved yet.
  useEffect(() => {
    if (startRouted.current || !auth.ready || (auth.mode === 'account' && starting)) return;
    startRouted.current = true;
    if (auth.mode !== 'account' || !START_BARE || START_LOAD) return;
    navigate(analysis ? 'overview' : 'import');
  }, [auth.ready, auth.mode, starting, analysis]);

  if (!auth.ready) return <Opening />;

  const Screen = SCREENS[loc.route];

  return (
    <>
      <button type="button" className="skip-link" onClick={() => mainRef.current?.focus()}>
        Skip to content
      </button>
      <div className="shell">
        <Sidebar route={loc.route} />
        <div className="shell-main">
          {auth.mode === 'demo' && auth.hasSession ? (
            <div className="mode-banner">
              <Icon name="info" size={16} />
              <span>You&rsquo;re viewing the demo.</span>
              <a
                href={WORKSPACE_URL}
                onClick={(e) => {
                  e.preventDefault();
                  auth.backToWorkspace();
                }}
              >
                Back to your workspace
              </a>
            </div>
          ) : null}
          <TopBar route={loc.route} onError={setTopError} />
          <main id="main" ref={mainRef} className="content" tabIndex={-1}>
            <div className="notices">
              {auth.sessionEnded ? (
                <Callout tone="warning" title={SESSION_ENDED} role="alert" className="session-callout">
                  <p className="callout-hint">Anything already saved stays in your account.</p>
                  <ButtonLink variant="primary" size="sm" href={auth.loginUrl} icon="user">
                    Sign in again
                  </ButtonLink>
                </Callout>
              ) : null}
              {apiStatus === 'down' ? (
                import.meta.env.DEV ? (
                  <Callout tone="danger" title="The API is not reachable at /api/v1." role="alert">
                    <p className="callout-hint">Start it with &ldquo;npm run dev&rdquo; in the api folder; this page checks again every few seconds.</p>
                  </Callout>
                ) : (
                  <Callout tone="info" title="Reconnecting to Profyn…" role="status">
                    <p className="callout-hint">This page checks again every few seconds. Nothing you saved is lost.</p>
                  </Callout>
                )
              ) : null}
              {restoreError ? <Callout tone="danger" title={restoreError} /> : null}
              {deepLink.busy ? (
                <p className="loading-line" role="status">
                  <span className="spinner" aria-hidden="true" /> Loading {loadingLabel(deepLink.busy)}…
                </p>
              ) : null}
              {deepLink.error && !(deepLink.error.fromImport && loc.route === 'import') ? <ErrorNote error={deepLink.error.info} /> : null}
              <ErrorNote error={topError} />
            </div>
            {opening ? (
              <div className="page" role="status" aria-label="Opening your workspace">
                <p className="loading-line">
                  <span className="spinner" aria-hidden="true" /> Opening your workspace…
                </p>
                <SkeletonCards count={4} />
                <div className="card skeleton-block" aria-hidden="true" />
              </div>
            ) : (
              <Screen />
            )}
          </main>
        </div>
      </div>
      <OrderDrawer />
      <AskDrawer />
      <Toast />
    </>
  );
}
