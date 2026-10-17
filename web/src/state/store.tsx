import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, isSessionEnded, toErrorInfo, type DatasetInput, type DatasetOptions, type ErrorInfo } from '../api/client';
import type {
  AnalysisResponse,
  AttributionMode,
  Checks,
  DatasetResponse,
  LeakCause,
  OrderResult,
  OverrideKey,
  Sample,
  ScenarioOverrides,
  ScenarioResponse,
  TextSource,
  WorkedOrderResult,
  WorkspaceDataset,
  WorkspaceResponse,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { parseHash } from '../lib/router';
import { storage } from '../lib/storage';

/** Read before the app trims the hash: a deep link that loads a sample replaces whatever would be restored. */
const START_LOAD = parseHash(window.location.hash).params.has('load');

export type WorkspaceStatus = 'idle' | 'loading' | 'ready' | 'error';

export type BridgeFocus = 'gross' | 'net_sales' | 'contribution';
export type LedgerTab = 'orders' | 'channel' | 'product';
export type LedgerFilter = 'all' | 'losing' | 'unknown' | 'late' | 'synthetic';

export type DrawerContent =
  | { kind: 'order'; order: OrderResult }
  | { kind: 'bridge'; focus: BridgeFocus }
  | { kind: 'margin' }
  | { kind: 'checks' }
  | { kind: 'about' }
  | { kind: 'worked'; data: WorkedOrderResult | null; error: string | null }
  | { kind: 'missing'; orderId: string };

export type ApiStatus = 'checking' | 'up' | 'down';

/** Used when GET /samples is not reachable, so the import screen still lists every drill. */
export const FALLBACK_SAMPLES: Sample[] = [
  { source: 'fixture', label: 'Sample orders', description: '20 reference orders from a small D2C store, unchanged.' },
  { source: 'extended', label: 'Extended sample', description: 'The 20 sample orders plus S01–S08 (labelled synthetic) with channels, products and ads.' },
  { source: 'duplicate_order', label: 'Duplicate order', description: 'O07 appears twice. Expect 20 orders and one duplicate flag.' },
  { source: 'late_refund', label: 'Late refund', description: 'O10 refund dated after the period end. Expect it pending.' },
  { source: 'null_refund', label: 'Missing refund', description: 'O05 refund_inr is null. Expect unknown, never zero.' },
  { source: 'missing_fee', label: 'Missing payment fee', description: 'payment_fee_inr removed. Expect partial totals, no crash.' },
  { source: 'refund_over_gross', label: 'Refund over gross', description: 'O03 refund above gross. Expect O03 invalid and excluded.' },
  { source: 'recovery_400', label: 'Full recovery', description: 'Recovered cost 400 on returns. Expect returns at −130.' },
  { source: 'bad_schema', label: 'Bad schema (CSV)', description: 'No product_cost_inr column. Expect 422 with the field path.' },
  { source: 'demo_12m', label: '12-month demo brand (synthetic)', description: '3,000 labelled synthetic orders over twelve months, for the Pulse owner analytics.' },
];

export const OVERRIDE_KEYS: OverrideKey[] = ['return_rate_pct', 'recovery_pct', 'shipping_inr', 'refund_policy', 'ads_per_order'];

/** A controlled scenario changes one assumption; assume_unknown_refund may ride along or stand alone. */
export function isRunnable(o: ScenarioOverrides): boolean {
  const set = OVERRIDE_KEYS.filter((k) => o[k] !== undefined).length;
  return set === 1 || (set === 0 && o.assume_unknown_refund === true);
}

export function sameOverrides(a: ScenarioOverrides, b: ScenarioOverrides): boolean {
  return [...OVERRIDE_KEYS, 'assume_unknown_refund' as const].every((k) => a[k] === b[k]);
}

export interface PackChecks {
  passed: number;
  total: number;
}

function summariseChecks(raw: Checks | null): PackChecks | null {
  if (!raw || typeof raw !== 'object') return null;
  const results = Object.entries(raw)
    .filter(([k, v]) => /^check\d+$/.test(k) && v !== null && typeof v === 'object' && typeof (v as { pass?: unknown }).pass === 'boolean')
    .map(([, v]) => (v as { pass: boolean }).pass);
  return results.length ? { passed: results.filter(Boolean).length, total: results.length } : null;
}

export interface NarrationState {
  analysis_id: string;
  leaks: Partial<Record<LeakCause, { why: string; why_source: TextSource }>>;
  recommendation: { why: string; why_source: TextSource } | null;
}

interface StoreValue {
  apiStatus: ApiStatus;
  engineVersion: string | null;
  dbStatus: string | null;
  checks: PackChecks | null;
  checksRaw: Checks | null;
  checksLoading: boolean;
  refreshChecks: () => Promise<void>;
  samples: Sample[];

  dataset: DatasetResponse | null;
  datasetId: string | null;
  analysis: AnalysisResponse | null;
  analysing: boolean;
  importing: boolean;
  restoring: boolean;
  restoreError: string | null;
  narration: NarrationState | null;
  /** Last failed dataset load, shown under the drop zone on the import step. */
  importError: ErrorInfo | null;
  setImportError: (e: ErrorInfo | null) => void;

  scenario: ScenarioResponse | null;
  scenarioOverrides: ScenarioOverrides | null;
  scenarioLoading: boolean;
  scenarioError: ErrorInfo | null;
  overrides: ScenarioOverrides;
  setOverrides: (o: ScenarioOverrides) => void;

  /** Workspace mode: the owner's saved data (GET /workspace). Null in demo mode. */
  workspace: WorkspaceResponse | null;
  workspaceStatus: WorkspaceStatus;
  workspaceError: ErrorInfo | null;
  refreshWorkspace: () => Promise<void>;
  /** True until the start state is known: in workspace mode, the saved data and its latest analysis are loaded. */
  starting: boolean;
  /** Opens a saved dataset: its latest analysis, or a new one when it has none. */
  openSaved: (d: WorkspaceDataset) => Promise<AnalysisResponse>;
  /** The dataset being opened from the saved list. */
  openingId: string | null;

  /** appendTo: add the upload to that saved dataset; orders already saved are skipped. */
  importDataset: (input: DatasetInput, options?: DatasetOptions) => Promise<DatasetResponse>;
  /** handling: ₹ per order for rows without handling_inr (config.handling_default_inr). */
  runAnalysis: (attribution: AttributionMode, periodEnd?: string, datasetId?: string, handling?: number) => Promise<AnalysisResponse>;
  runScenario: (overrides: ScenarioOverrides) => Promise<void>;

  drawer: DrawerContent | null;
  drawerOpen: boolean;
  openOrder: (orderId: string) => void;
  openOrderResult: (order: OrderResult) => void;
  openWorked: () => void;
  openBridge: (focus: BridgeFocus) => void;
  openMargin: () => void;
  openChecks: () => void;
  openAbout: () => void;
  closeDrawer: () => void;

  /** Ledger table view, shared so cards and drawers can filter it. */
  ledgerTab: LedgerTab;
  setLedgerTab: (t: LedgerTab) => void;
  ledgerFilter: LedgerFilter;
  setLedgerFilter: (f: LedgerFilter) => void;
  /** Increments each time something asks the ledger to bring its table into view. */
  tableFocus: number;
  focusLedgerTable: (filter?: LedgerFilter) => void;

  toast: { id: number; text: string; tone: 'success' | 'info' } | null;
  showToast: (text: string, tone?: 'success' | 'info') => void;

  decisionSavedFor: string | null;
  markDecisionSaved: (analysisId: string) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const v = useContext(StoreContext);
  if (!v) throw new Error('useStore must be used inside <StoreProvider>.');
  return v;
}

/** GET /datasets/:id has no file list; the saved list does. */
function withFiles(ds: DatasetResponse, item: WorkspaceDataset | undefined): DatasetResponse {
  return item?.files && !ds.files ? { ...ds, files: item.files } : ds;
}

export function findOrder(analysis: AnalysisResponse | null, orderId: string): OrderResult | null {
  if (!analysis) return null;
  return (
    analysis.orders.find((o) => o.order_id === orderId) ??
    analysis.late_refunds.orders.find((o) => o.order_id === orderId) ??
    null
  );
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const account = auth.ready && auth.mode === 'account';
  const accountRef = useRef(account);
  accountRef.current = account;
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus>('idle');
  const [workspaceError, setWorkspaceError] = useState<ErrorInfo | null>(null);
  const [starting, setStarting] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [engineVersion, setEngineVersion] = useState<string | null>(null);
  const [dbStatus, setDbStatus] = useState<string | null>(null);
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [checks, setChecks] = useState<PackChecks | null>(null);
  const [checksRaw, setChecksRaw] = useState<Checks | null>(null);
  const [checksLoading, setChecksLoading] = useState(false);

  const [dataset, setDataset] = useState<DatasetResponse | null>(null);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [narration, setNarration] = useState<NarrationState | null>(null);
  const [importError, setImportError] = useState<ErrorInfo | null>(null);

  const [scenario, setScenario] = useState<ScenarioResponse | null>(null);
  const [scenarioOverrides, setScenarioOverrides] = useState<ScenarioOverrides | null>(null);
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [scenarioError, setScenarioError] = useState<ErrorInfo | null>(null);
  const [overrides, setOverrides] = useState<ScenarioOverrides>({});

  const [drawer, setDrawer] = useState<DrawerContent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string; tone: 'success' | 'info' } | null>(null);
  const [decisionSavedFor, setDecisionSavedFor] = useState<string | null>(null);
  // Deep links may name a tab (?tab=channel); read before App cleans the hash.
  const [ledgerTab, setLedgerTab] = useState<LedgerTab>(() => {
    const t = parseHash(window.location.hash).params.get('tab');
    return t === 'channel' || t === 'product' ? t : 'orders';
  });
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>('all');
  const [tableFocus, setTableFocus] = useState(0);

  const analysisRef = useRef<AnalysisResponse | null>(null);
  analysisRef.current = analysis;
  const datasetIdRef = useRef<string | null>(null);
  datasetIdRef.current = datasetId;
  const scenarioSeq = useRef(0);
  const analysisSeq = useRef(0);

  // API health, retried quietly until the API answers.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const check = async () => {
      try {
        const h = await api.health();
        if (cancelled) return;
        setApiStatus('up');
        setEngineVersion(h.engine_version ?? null);
        setDbStatus(h.db ?? null);
      } catch {
        if (cancelled) return;
        setApiStatus('down');
        timer = window.setTimeout(check, 5000);
      }
    };
    void check();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (apiStatus !== 'up') return;
    let cancelled = false;
    api
      .samples()
      .then((list) => {
        if (!cancelled && Array.isArray(list) && list.length > 0) setSamples(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiStatus]);

  const refreshChecks = useCallback(async () => {
    setChecksLoading(true);
    try {
      const raw = await api.checks();
      setChecksRaw(raw);
      setChecks(summariseChecks(raw));
    } catch {
      // The sidebar card simply stays hidden; the drawer shows its own state.
    } finally {
      setChecksLoading(false);
    }
  }, []);

  useEffect(() => {
    if (apiStatus === 'up') void refreshChecks();
  }, [apiStatus, refreshChecks]);

  const refreshWorkspace = useCallback(async () => {
    if (!accountRef.current) return;
    try {
      const ws = await api.workspace();
      setWorkspace(ws);
      setWorkspaceStatus('ready');
      setWorkspaceError(null);
    } catch (err) {
      if (!isSessionEnded(err)) setWorkspaceError(toErrorInfo(err));
      setWorkspaceStatus((s) => (s === 'ready' ? s : 'error'));
    }
  }, []);

  /** A saved dataset and one of its analyses, shown as if just run. */
  const showSaved = useCallback((ds: DatasetResponse | null, a: AnalysisResponse | null) => {
    analysisSeq.current++;
    scenarioSeq.current++;
    setDataset(ds);
    setDatasetId(ds?.dataset_id ?? a?.dataset_id ?? null);
    setAnalysis(a);
    setAnalysing(false);
    setNarration(null);
    setScenario(null);
    setScenarioOverrides(null);
    setScenarioError(null);
    setScenarioLoading(false);
    setOverrides({});
    setLedgerFilter('all');
    setDrawerOpen(false);
    setRestoreError(null);
  }, []);

  // Start. Workspace mode: the owner's saved data, opening the latest analysis. Demo mode: the last analysis in this
  // browser. Either way a deep link that loads a sample wins.
  useEffect(() => {
    if (!auth.ready) return;
    let cancelled = false;

    if (auth.mode === 'account') {
      setStarting(true);
      setRestoring(true);
      setWorkspaceStatus('loading');
      (async () => {
        try {
          const ws = await api.workspace();
          if (cancelled) return;
          setWorkspace(ws);
          setWorkspaceStatus('ready');
          setWorkspaceError(null);
          const latest = ws.latest;
          if (latest && !START_LOAD) {
            const item = ws.datasets.find((d) => d.dataset_id === latest.dataset_id);
            const [ds, a] = await Promise.all([
              api.getDataset(latest.dataset_id).catch(() => null),
              latest.analysis_id ? api.getAnalysis(latest.analysis_id) : api.createAnalysis(latest.dataset_id, { attribution: 'allocate' }),
            ]);
            if (cancelled || analysisRef.current) return;
            showSaved(ds ? withFiles(ds, item) : null, a);
          }
        } catch (err) {
          if (cancelled) return;
          setWorkspaceStatus((s) => (s === 'ready' ? s : 'error'));
          // An ended session has its own notice with "Sign in again".
          if (!isSessionEnded(err)) {
            setWorkspaceError(toErrorInfo(err));
            setRestoreError(`Your saved data could not be opened. ${toErrorInfo(err).message}`);
          }
        } finally {
          if (!cancelled) {
            setRestoring(false);
            setStarting(false);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    setStarting(false);
    if (START_LOAD) return;
    const analysisId = storage.analysisId();
    if (!analysisId) return;
    setRestoring(true);
    (async () => {
      try {
        const a = await api.getAnalysis(analysisId);
        const ds = await api.getDataset(a.dataset_id ?? storage.datasetId() ?? '').catch(() => null);
        if (cancelled || analysisRef.current) return;
        setAnalysis(a);
        setDatasetId(a.dataset_id ?? storage.datasetId());
        if (ds) setDataset(ds);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) storage.clear();
        else setRestoreError(`The last analysis could not be restored. ${toErrorInfo(err).message}`);
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.ready, auth.mode, showSaved]);

  // Demo mode remembers the ids in this browser; workspace mode starts from the saved data instead.
  useEffect(() => {
    if (!auth.ready || auth.mode === 'account') return;
    if (datasetId || analysis) storage.save(datasetId, analysis?.analysis_id ?? null);
  }, [auth.ready, auth.mode, datasetId, analysis]);

  // Optional AI wording, fetched after the analysis renders; template text stays until "ai" text arrives.
  const analysisId = analysis?.analysis_id ?? null;
  useEffect(() => {
    if (!analysisId) return;
    let cancelled = false;
    api
      .narrate(analysisId)
      .then((n) => {
        if (cancelled || !n) return;
        const leaks: NarrationState['leaks'] = {};
        for (const l of n.leaks ?? []) leaks[l.cause] = { why: l.why, why_source: l.why_source };
        setNarration({ analysis_id: analysisId, leaks, recommendation: n.recommendation ?? null });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  const resetScenario = () => {
    scenarioSeq.current++;
    setScenario(null);
    setScenarioOverrides(null);
    setScenarioError(null);
    setScenarioLoading(false);
    setOverrides({});
  };

  const focusLedgerTable = useCallback((filter?: LedgerFilter) => {
    setLedgerTab('orders');
    if (filter) setLedgerFilter(filter);
    setTableFocus((n) => n + 1);
  }, []);

  const importDataset = useCallback(async (input: DatasetInput, options?: DatasetOptions) => {
    setImportError(null);
    setImporting(true);
    let ds: DatasetResponse;
    try {
      ds = await api.createDataset(input, options);
    } catch (err) {
      setImportError(toErrorInfo(err));
      throw err;
    } finally {
      setImporting(false);
    }
    if (accountRef.current) void refreshWorkspace();
    if (ds.unchanged && ds.dataset_id === datasetIdRef.current) {
      // Nothing new: the loaded data and its analysis stay as they are; the report shows this upload's flags.
      setDataset((prev) => ({ ...ds, files: ds.files ?? prev?.files }));
      setRestoreError(null);
      return ds;
    }
    setDataset(ds);
    setDatasetId(ds.dataset_id);
    setAnalysis(null);
    setNarration(null);
    resetScenario();
    setLedgerFilter('all');
    setDrawerOpen(false);
    setRestoreError(null);
    return ds;
  }, [refreshWorkspace]);

  const runAnalysis = useCallback(async (attribution: AttributionMode, periodEnd?: string, dsId?: string, handling?: number) => {
    const id = dsId ?? datasetIdRef.current;
    if (!id) throw new Error('Load a dataset first.');
    const seq = ++analysisSeq.current;
    setAnalysing(true);
    try {
      const a = await api.createAnalysis(id, {
        attribution,
        ...(periodEnd ? { period_end: periodEnd } : {}),
        ...(handling !== undefined && handling > 0 ? { config: { handling_default_inr: handling } } : {}),
      });
      if (seq === analysisSeq.current) {
        setAnalysis(a);
        setDatasetId(a.dataset_id ?? id);
        resetScenario();
        setRestoreError(null);
      }
      // The saved list shows each dataset's latest contribution.
      if (accountRef.current) void refreshWorkspace();
      return a;
    } finally {
      if (seq === analysisSeq.current) setAnalysing(false);
    }
  }, [refreshWorkspace]);

  const openSaved = useCallback(
    async (d: WorkspaceDataset) => {
      setOpeningId(d.dataset_id);
      try {
        if (d.latest_analysis) {
          const [ds, a] = await Promise.all([api.getDataset(d.dataset_id).catch(() => null), api.getAnalysis(d.latest_analysis.analysis_id)]);
          showSaved(ds ? withFiles(ds, d) : null, a);
          return a;
        }
        const ds = await api.getDataset(d.dataset_id);
        showSaved(withFiles(ds, d), null);
        return await runAnalysis('allocate', undefined, d.dataset_id);
      } finally {
        setOpeningId(null);
      }
    },
    [showSaved, runAnalysis],
  );

  const runScenario = useCallback(async (o: ScenarioOverrides) => {
    const a = analysisRef.current;
    if (!a) return;
    const seq = ++scenarioSeq.current;
    if (!isRunnable(o)) {
      // Nothing changed: the baseline is the analysis itself, so there is nothing to post.
      setScenario(null);
      setScenarioOverrides(null);
      setScenarioError(null);
      setScenarioLoading(false);
      return;
    }
    setScenarioLoading(true);
    setScenarioError(null);
    try {
      const s = await api.createScenario(a.analysis_id, o);
      if (seq !== scenarioSeq.current || analysisRef.current?.analysis_id !== a.analysis_id) return;
      setScenario(s);
      setScenarioOverrides(o);
    } catch (err) {
      if (seq === scenarioSeq.current) {
        setScenarioError(toErrorInfo(err));
        setScenarioOverrides(o);
      }
    } finally {
      if (seq === scenarioSeq.current) setScenarioLoading(false);
    }
  }, []);

  const openOrderResult = useCallback((order: OrderResult) => {
    setDrawer({ kind: 'order', order });
    setDrawerOpen(true);
  }, []);

  const openOrder = useCallback((orderId: string) => {
    const o = findOrder(analysisRef.current, orderId);
    setDrawer(o ? { kind: 'order', order: o } : { kind: 'missing', orderId });
    setDrawerOpen(true);
  }, []);

  const openWorked = useCallback(() => {
    setDrawer({ kind: 'worked', data: null, error: null });
    setDrawerOpen(true);
    api
      .workedOrder()
      .then((data) => setDrawer((d) => (d && d.kind === 'worked' ? { kind: 'worked', data, error: null } : d)))
      .catch((err) =>
        setDrawer((d) => (d && d.kind === 'worked' ? { kind: 'worked', data: null, error: toErrorInfo(err).message } : d)),
      );
  }, []);

  const openBridge = useCallback((focus: BridgeFocus) => {
    setDrawer({ kind: 'bridge', focus });
    setDrawerOpen(true);
  }, []);

  const openMargin = useCallback(() => {
    setDrawer({ kind: 'margin' });
    setDrawerOpen(true);
  }, []);

  const openChecks = useCallback(() => {
    setDrawer({ kind: 'checks' });
    setDrawerOpen(true);
  }, []);

  const openAbout = useCallback(() => {
    setDrawer({ kind: 'about' });
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const showToast = useCallback((text: string, tone: 'success' | 'info' = 'success') => setToast({ id: Date.now(), text, tone }), []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const markDecisionSaved = useCallback((id: string) => setDecisionSavedFor(id), []);

  const value = useMemo<StoreValue>(
    () => ({
      apiStatus,
      engineVersion,
      dbStatus,
      checks,
      checksRaw,
      checksLoading,
      refreshChecks,
      samples: samples ?? FALLBACK_SAMPLES,
      dataset,
      datasetId,
      analysis,
      analysing,
      importing,
      restoring,
      restoreError,
      narration: narration && narration.analysis_id === analysis?.analysis_id ? narration : null,
      importError,
      setImportError,
      workspace,
      workspaceStatus,
      workspaceError,
      refreshWorkspace,
      starting,
      openSaved,
      openingId,
      scenario,
      scenarioOverrides,
      scenarioLoading,
      scenarioError,
      overrides,
      setOverrides,
      importDataset,
      runAnalysis,
      runScenario,
      drawer,
      drawerOpen,
      openOrder,
      openOrderResult,
      openWorked,
      openBridge,
      openMargin,
      openChecks,
      openAbout,
      closeDrawer,
      ledgerTab,
      setLedgerTab,
      ledgerFilter,
      setLedgerFilter,
      tableFocus,
      focusLedgerTable,
      toast,
      showToast,
      decisionSavedFor,
      markDecisionSaved,
    }),
    [
      apiStatus,
      engineVersion,
      dbStatus,
      checks,
      checksRaw,
      checksLoading,
      refreshChecks,
      samples,
      dataset,
      datasetId,
      analysis,
      analysing,
      importing,
      restoring,
      restoreError,
      narration,
      importError,
      workspace,
      workspaceStatus,
      workspaceError,
      refreshWorkspace,
      starting,
      openSaved,
      openingId,
      scenario,
      scenarioOverrides,
      scenarioLoading,
      scenarioError,
      overrides,
      importDataset,
      runAnalysis,
      runScenario,
      drawer,
      drawerOpen,
      openOrder,
      openOrderResult,
      openWorked,
      openBridge,
      openMargin,
      openChecks,
      openAbout,
      closeDrawer,
      ledgerTab,
      ledgerFilter,
      tableFocus,
      focusLedgerTable,
      toast,
      showToast,
      decisionSavedFor,
      markDecisionSaved,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
