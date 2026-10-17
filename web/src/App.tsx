import { useEffect, useRef, useState } from 'react';
import { toErrorInfo, type ErrorInfo } from './api/client';
import { isSampleSource, SAMPLE_SOURCES, type AttributionMode } from './api/types';
import { ErrorNote } from './components/ErrorNote';
import { OrderDrawer } from './components/OrderDrawer';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Callout } from './components/ui';
import { Toast } from './components/Toast';
import { replaceWithBareRoute, useHashLocation, type Location, type Route } from './lib/router';
import { DecisionScreen } from './screens/DecisionScreen';
import { ImportScreen } from './screens/ImportScreen';
import { LeaksScreen } from './screens/LeaksScreen';
import { LedgerScreen } from './screens/LedgerScreen';
import { ScenarioScreen } from './screens/ScenarioScreen';
import { useStore } from './state/store';

const SCREENS: Record<Route, () => JSX.Element> = {
  import: ImportScreen,
  ledger: LedgerScreen,
  leaks: LeaksScreen,
  scenario: ScenarioScreen,
  decision: DecisionScreen,
};

type PendingDrawer = { order: string | null; worked: boolean };

/**
 * Deep links for demos and screenshots, on any route:
 *   ?load=<sample>&attribution=channel&period_end=YYYY-MM-DD&order=O05&worked=1
 */
function useDeepLink(loc: Location) {
  const { importDataset, runAnalysis, analysis, openOrder, openWorked } = useStore();
  const handled = useRef<Location | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // fromImport: the dataset load failed; the import step shows that one under its drop zone.
  const [error, setError] = useState<{ info: ErrorInfo; fromImport: boolean } | null>(null);
  const [pending, setPending] = useState<PendingDrawer | null>(null);

  useEffect(() => {
    if (handled.current === loc) return;
    handled.current = loc;
    const p = loc.params;
    const load = p.get('load');
    const order = p.get('order');
    const worked = p.get('worked') === '1';
    if (!load && !order && !worked) return;
    replaceWithBareRoute(loc.route);
    setError(null);

    if (!load) {
      setPending({ order, worked });
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
        if (order || worked) setPending({ order, worked });
      } catch (err) {
        setError({ info: toErrorInfo(err), fromImport: !imported });
      } finally {
        setBusy(null);
      }
    })();
  }, [loc, importDataset, runAnalysis]);

  useEffect(() => {
    if (!pending || busy) return;
    if (pending.worked) {
      setPending(null);
      openWorked();
      return;
    }
    if (pending.order && analysis) {
      setPending(null);
      openOrder(pending.order);
    }
  }, [pending, busy, analysis, openOrder, openWorked]);

  return { busy, error };
}

export function App() {
  const loc = useHashLocation();
  const { apiStatus, restoreError } = useStore();
  const deepLink = useDeepLink(loc);
  const mainRef = useRef<HTMLElement>(null);
  const firstRoute = useRef(true);
  const [topError, setTopError] = useState<ErrorInfo | null>(null);

  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    window.scrollTo(0, 0);
  }, [loc.route]);

  const Screen = SCREENS[loc.route];

  return (
    <>
      <button type="button" className="skip-link" onClick={() => mainRef.current?.focus()}>
        Skip to content
      </button>
      <div className="shell">
        <Sidebar route={loc.route} />
        <div className="shell-main">
          <TopBar route={loc.route} onError={setTopError} />
          <main id="main" ref={mainRef} className="content" tabIndex={-1}>
            <div className="notices">
              {apiStatus === 'down' ? (
                <Callout tone="danger" title="The API is not reachable at /api/v1." role="alert">
                  <p className="callout-hint">Start it with &ldquo;npm run dev&rdquo; in the api folder; this page checks again every few seconds.</p>
                </Callout>
              ) : null}
              {restoreError ? <Callout tone="danger" title={restoreError} /> : null}
              {deepLink.busy ? (
                <p className="loading-line" role="status">
                  <span className="spinner" aria-hidden="true" /> Loading the {deepLink.busy.replace(/_/g, ' ')} sample…
                </p>
              ) : null}
              {deepLink.error && !(deepLink.error.fromImport && loc.route === 'import') ? <ErrorNote error={deepLink.error.info} /> : null}
              <ErrorNote error={topError} />
            </div>
            <Screen />
          </main>
        </div>
      </div>
      <OrderDrawer />
      <Toast />
    </>
  );
}
