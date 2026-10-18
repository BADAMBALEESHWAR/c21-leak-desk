import type { MouseEvent } from 'react';
import type {
  AnalysisRequest,
  AnalysisResponse,
  ApiErrorBody,
  ApiIssue,
  Checks,
  DatasetResponse,
  RowCorrectionRequest,
  DecisionExport,
  DecisionRequest,
  DecisionSaved,
  DecisionSummary,
  FixtureFile,
  Health,
  Narration,
  Sample,
  SampleSource,
  ScenarioOverrides,
  ScenarioResponse,
  TestPlan,
  WorkedOrderResult,
  MeResponse,
  PulseOverview,
  PulseMonths,
  PulseProducts,
  PulseChannels,
  PulseLeaks,
  PulseInsights,
  WorkspaceResponse,
  Advisor,
  AiStatus,
  AskAnswer,
  AuditEntry,
  AuthProviders,
  Autopilot,
  AutopilotRequest,
  ColumnMapping,
  Consent,
  Digest,
  ImportMapRequest,
  ImportMapResult,
  ImportProfile,
  MeProfile,
  ConnectorsResponse,
  ShopifyConnectRequest,
  ShopifyImportResult,
  ShopifyTestRequest,
  ShopifyTestResult,
} from './types';

import { getIdToken } from '../auth/auth';
import { i18n } from '../i18n';

export const API_BASE = '/api/v1';

/** What the UI shows for any failure: the message, then the hint, then field issues. */
export interface ErrorInfo {
  message: string;
  hint: string | null;
  issues: ApiIssue[];
}

export class ApiError extends Error implements ErrorInfo {
  readonly status: number;
  readonly code: string | null;
  readonly path: string | null;
  readonly hint: string | null;
  readonly issues: ApiIssue[];

  constructor(status: number, body: unknown, fallback: string) {
    const e = readErrorBody(body);
    super(e?.message || fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = e?.code ?? null;
    this.path = e?.path ?? null;
    this.hint = e?.hint ?? null;
    this.issues = Array.isArray(e?.issues) ? e!.issues! : [];
  }
}

function readErrorBody(body: unknown): ApiErrorBody['error'] | null {
  if (!body || typeof body !== 'object') return null;
  const err = (body as { error?: unknown }).error;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return err as ApiErrorBody['error'];
  }
  return null;
}

/** Shown only after the automatic retries below have run out; developers also get the local hint. In the UI language. */
const unreachable = (): string =>
  import.meta.env.DEV
    ? i18n.t('api.unreachableDev', 'Could not reach the API at /api/v1. Start it with "npm run dev" in the api folder, then try again.')
    : i18n.t('api.unreachable', 'Profyn could not be reached just now. Nothing was lost; please try again in a moment.');

// A deploy restarts the API for a few seconds. Network failures and gateway errors (502/503/504 without our own JSON
// error body) are retried quietly before anything is shown, so a person never sees a blip.
const RETRY_DELAYS_MS = [700, 1500, 3000, 5000];
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const isGatewayError = (res: Response) => res.status === 502 || res.status === 503 || res.status === 504;

// ---- Session ------------------------------------------------------------------------------
// Demo mode sends no token. Workspace mode sends the signed-in owner's id token on every call and never falls back to
// the demo workspace: an expired token is renewed first, and a session the API rejects ends here, once, for the UI to say so.

interface SessionBinding {
  /** Workspace mode: every call carries the session. */
  account: boolean;
  /** Signed in with Google or GitHub: the httpOnly profyn_session cookie is the session, so no Bearer token is sent. */
  cookie?: boolean;
  /** Renews an expired id token with the refresh token; null when that is no longer possible. */
  renew: () => Promise<string | null>;
  /** Called once when the session is gone (a 401, or a token that cannot be renewed). */
  onEnded: () => void;
}

let binding: SessionBinding | null = null;
let ended = false;

/** AuthProvider calls this once the mode is known; until then calls go out without a token. */
export function bindSession(b: SessionBinding | null): void {
  binding = b;
  ended = false;
}

/** The one notice for an ended session, in the UI language. */
export function sessionEndedMessage(): string {
  return i18n.t('api.sessionEnded', 'Your session has ended. Sign in again to keep working with your saved data.');
}

const sessionEndedError = () => {
  const message = sessionEndedMessage();
  const hint = i18n.t('api.sessionSafe', 'Your saved data is safe; it opens again after you sign in.');
  return new ApiError(401, { error: { code: 'unauthorized', message, hint } }, message);
};

/** The session has ended: the app shows one notice for it, so screens need not repeat the error. */
export function isSessionEnded(err: unknown): boolean {
  return ended && err instanceof ApiError && err.status === 401;
}

function endSession(): void {
  if (ended) return;
  ended = true;
  binding?.onEnded();
}

/** The Bearer token for this call, or null in demo mode. */
async function bearer(): Promise<string | null> {
  if (!binding?.account) return null;
  if (ended) throw sessionEndedError();
  if (binding.cookie) return null;
  const token = getIdToken();
  if (token) return token;
  const renewed = await binding.renew();
  if (renewed) return renewed;
  endSession();
  throw sessionEndedError();
}

/** The UI language, so explanation text from the API comes back in it (English when the API has no translation). */
export function language(): string {
  return i18n.resolvedLanguage || i18n.language || 'en';
}

// ---- AI switch for guests ----------------------------------------------------------------------
// Signed in, the switch is the account's consent (PATCH /me/consent). A guest's choice stays in this browser and every API
// call says so with X-Profyn-AI: off, so the API answers with template text only.

const AI_PREF_KEY = 'profyn.ai';

export function aiLocalOff(): boolean {
  try {
    return window.localStorage.getItem(AI_PREF_KEY) === 'off';
  } catch {
    return false;
  }
}

export function setAiLocalOff(off: boolean): void {
  try {
    if (off) window.localStorage.setItem(AI_PREF_KEY, 'off');
    else window.localStorage.removeItem(AI_PREF_KEY);
  } catch {
    // Blocked storage: the choice lasts for this page only.
  }
}

/** True while the signed-in session is the httpOnly cookie (Google or GitHub sign-in). */
export function cookieSession(): boolean {
  return Boolean(binding?.account && binding.cookie);
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function send(method: Method, path: string, body?: unknown, auth = true): Promise<{ res: Response; parsed: unknown }> {
  const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': language() };
  if (aiLocalOff()) headers['X-Profyn-AI'] = 'off';
  const init: RequestInit = { method, headers };
  const token = auth ? await bearer() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(`${API_BASE}${path}`, init);
    } catch {
      res = null;
    }
    const retryable = res === null || isGatewayError(res);
    let parsed: unknown = null;
    if (res) {
      const text = await res.text();
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }
    }
    // Our API answers with a JSON error body; only a missing answer or a gateway page is a blip worth retrying.
    if (retryable && !readErrorBody(parsed) && attempt < RETRY_DELAYS_MS.length) {
      await wait(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    if (!res) throw new ApiError(0, null, unreachable());
    if (res.status === 401 && (token || (auth && cookieSession()))) endSession();
    return { res, parsed };
  }
}

async function request<T>(method: Method, path: string, body?: unknown, auth = true): Promise<T> {
  const { res, parsed } = await send(method, path, body, auth);
  if (!res.ok) {
    if (res.status === 401 && binding?.account) throw sessionEndedError();
    // A proxy or gateway page without a JSON error body means the API process is down.
    if (!readErrorBody(parsed) && res.status >= 500) throw new ApiError(res.status, null, unreachable());
    throw new ApiError(res.status, parsed, i18n.t('api.requestFailed', 'The request failed with status {{status}}.', { status: res.status }));
  }
  return parsed as T;
}

/** A File[] is merged by the API into one dataset (monthly exports, up to 12 files). */
export type DatasetInput = { source: SampleSource; period_end?: string } | FixtureFile | File | File[];

export interface DatasetOptions {
  /** Add the upload to this saved dataset; orders already saved there are skipped, never counted twice. */
  appendTo?: string;
  /** Confirmed column mapping (schema field → column) for a file whose headers are not the template's. */
  mapping?: ColumnMapping;
  /** Import profile, e.g. a marketplace report layout. */
  profile?: string;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Fetches a file with the session and saves it. A plain download link cannot send the Authorization header. */
export async function downloadFile(url: string, filename: string): Promise<void> {
  const token = await bearer();
  const headers: Record<string, string> = { 'Accept-Language': language() };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (aiLocalOff()) headers['X-Profyn-AI'] = 'off';
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch {
    throw new ApiError(0, null, unreachable());
  }
  if (res.status === 401 && (token || cookieSession())) {
    endSession();
    throw sessionEndedError();
  }
  if (!res.ok) {
    const parsed = await res.json().catch(() => null);
    throw new ApiError(res.status, parsed, i18n.t('api.downloadFailed', 'The download failed with status {{status}}.', { status: res.status }));
  }
  saveBlob(await res.blob(), filename);
}

/**
 * onClick for an export link. Demo mode keeps the plain link; workspace mode fetches the file with the session, since
 * the API only shows an owner's records to that owner.
 */
export function authDownload(url: string, filename: string, onError?: (e: ErrorInfo) => void) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (!binding?.account) return;
    e.preventDefault();
    downloadFile(url, filename).catch((err) => onError?.(toErrorInfo(err)));
  };
}

export const api = {
  /** 503 with a body means the API is up but the database is down; that still counts as up. */
  health: async (): Promise<Health> => {
    const { res, parsed } = await send('GET', '/health', undefined, false);
    if (parsed && typeof parsed === 'object' && 'engine_version' in parsed) return parsed as Health;
    throw new ApiError(res.status, parsed, unreachable());
  },
  samples: () => request<Sample[]>('GET', '/samples', undefined, false),
  checks: () => request<Checks>('GET', '/checks', undefined, false),
  workedOrder: () => request<WorkedOrderResult>('GET', '/worked-order', undefined, false),

  createDataset: (input: DatasetInput, options: DatasetOptions = {}) => {
    const { appendTo, mapping, profile } = options;
    if (input instanceof File || Array.isArray(input)) {
      const form = new FormData();
      if (appendTo) form.append('append_to', appendTo);
      if (mapping) form.append('mapping', JSON.stringify(mapping));
      if (profile) form.append('profile', profile);
      for (const file of input instanceof File ? [input] : input) form.append('file', file, file.name);
      return request<DatasetResponse>('POST', '/datasets', form);
    }
    return request<DatasetResponse>('POST', appendTo ? `/datasets?append_to=${encodeURIComponent(appendTo)}` : '/datasets', input);
  },

  getDataset: (datasetId: string) => request<DatasetResponse>('GET', `/datasets/${encodeURIComponent(datasetId)}`),

  /** Fix one flagged or rejected row; answers with the new dataset version (the original is kept). */
  correctRow: (datasetId: string, body: RowCorrectionRequest) =>
    request<DatasetResponse>('PATCH', `/datasets/${encodeURIComponent(datasetId)}/rows`, body),

  /** The signed-in owner's saved datasets, newest first, each with its latest analysis. */
  workspace: () => request<WorkspaceResponse>('GET', '/workspace'),

  createAnalysis: (datasetId: string, body: AnalysisRequest) =>
    request<AnalysisResponse>('POST', `/datasets/${encodeURIComponent(datasetId)}/analyses`, body),

  getAnalysis: (analysisId: string) => request<AnalysisResponse>('GET', `/analyses/${encodeURIComponent(analysisId)}`),

  narrate: (analysisId: string) => request<Narration>('POST', `/analyses/${encodeURIComponent(analysisId)}/narrate`, {}),

  createScenario: (analysisId: string, overrides: ScenarioOverrides) =>
    request<ScenarioResponse>('POST', `/analyses/${encodeURIComponent(analysisId)}/scenarios`, { overrides }),

  testPlan: (scenarioId: string) => request<TestPlan>('POST', `/scenarios/${encodeURIComponent(scenarioId)}/test-plan`, {}),

  createDecision: (analysisId: string, body: DecisionRequest) =>
    request<DecisionSaved>('POST', `/analyses/${encodeURIComponent(analysisId)}/decisions`, body),

  listDecisions: () => request<DecisionSummary[]>('GET', '/decisions'),

  /** The decision record as exported (check-in, assumptions, starting state). */
  decisionExport: (decisionId: string) => request<DecisionExport>('GET', `/decisions/${encodeURIComponent(decisionId)}/export?format=json`),

  me: () => request<MeResponse>('GET', '/me'),

  pulseOverview: (analysisId: string, month?: string) =>
    request<PulseOverview>('GET', `/analyses/${encodeURIComponent(analysisId)}/pulse/overview${month ? `?month=${encodeURIComponent(month)}` : ''}`),
  pulseMonths: (analysisId: string) => request<PulseMonths>('GET', `/analyses/${encodeURIComponent(analysisId)}/pulse/months`),
  pulseProducts: (analysisId: string) => request<PulseProducts>('GET', `/analyses/${encodeURIComponent(analysisId)}/pulse/products`),
  pulseChannels: (analysisId: string) => request<PulseChannels>('GET', `/analyses/${encodeURIComponent(analysisId)}/pulse/channels`),
  pulseLeaks: (analysisId: string) => request<PulseLeaks>('GET', `/analyses/${encodeURIComponent(analysisId)}/pulse/leaks`),
  pulseInsights: (analysisId: string) => request<PulseInsights>('GET', `/analyses/${encodeURIComponent(analysisId)}/pulse/insights`),

  templateUrl: () => `${API_BASE}/template.csv`,

  ledgerExportUrl: (analysisId: string, format: 'csv' | 'json' = 'csv') =>
    `${API_BASE}/analyses/${encodeURIComponent(analysisId)}/export?format=${format}`,

  exportUrl: (decisionId: string, format: 'md' | 'json') =>
    `${API_BASE}/decisions/${encodeURIComponent(decisionId)}/export?format=${format}`,

  // ---- v2: autopilot, fix advisor, Ask Profyn, digest, AI guard -----------------------------------------------------

  /** Runs every step for a dataset (analysis, leaks, scenarios, margins, pulse, explanations) and ranks three actions. */
  autopilot: (datasetId: string, body: AutopilotRequest) =>
    request<Autopilot>('POST', `/datasets/${encodeURIComponent(datasetId)}/autopilot`, body),
  getAutopilot: (autopilotId: string) => request<Autopilot>('GET', `/autopilot/${encodeURIComponent(autopilotId)}`),
  /** Server-sent events: stage {stage, status} and done (the full document). */
  autopilotEventsUrl: (autopilotId: string) => `${API_BASE}/autopilot/${encodeURIComponent(autopilotId)}/events`,
  acceptAutopilot: (autopilotId: string, body: { rank: number; owner?: string }) =>
    request<DecisionSaved>('POST', `/autopilot/${encodeURIComponent(autopilotId)}/accept`, body),

  advisor: (analysisId: string, body: { cause: string; lang: string }) =>
    request<Advisor>('POST', `/analyses/${encodeURIComponent(analysisId)}/advisor`, body),
  ask: (analysisId: string, body: { question: string; lang: string }) =>
    request<AskAnswer>('POST', `/analyses/${encodeURIComponent(analysisId)}/ask`, body),
  digest: (analysisId: string, lang: string) =>
    request<Digest>('GET', `/analyses/${encodeURIComponent(analysisId)}/digest?lang=${encodeURIComponent(lang)}`),
  aiStatus: () => request<AiStatus>('GET', '/ai/status'),

  // ---- v2: import mapping ---------------------------------------------------------------------------------------------

  importProfiles: () => request<ImportProfile[]>('GET', '/import/profiles'),
  importMap: (body: ImportMapRequest) => request<ImportMapResult>('POST', '/import/map', body),
  saveMapping: (body: { headers: string[]; mapping: ColumnMapping; profile?: string }) => request<unknown>('POST', '/import/mappings', body),

  // ---- v2: accounts (Google / GitHub cookie session) ------------------------------------------------------------------

  authProviders: () => request<AuthProviders>('GET', '/auth/providers', undefined, false),
  logout: () => request<unknown>('POST', '/auth/logout', {}, false),
  profile: () => request<MeProfile>('GET', '/me'),
  setConsent: (body: Consent) => request<unknown>('PATCH', '/me/consent', body),
  dataSummary: () => request<{ database: string; region: string; file_storage: string; backups: string; counts: { datasets: number; analyses: number; scenarios: number; decisions: number; sign_ins: number; audit_events: number } }>('GET', '/me/data'),
  audit: () => request<AuditEntry[] | { entries: AuditEntry[] }>('GET', '/me/audit'),
  meExportUrl: () => `${API_BASE}/me/export`,
  deleteMe: () => request<unknown>('DELETE', '/me', { confirm: 'DELETE' }),

  // ---- Connectors: Shopify Admin API ----------------------------------------------------------------------------------

  /** Saved connectors for this workspace, and whether the one-click Shopify install is set up. */
  razorpayStatus: () => request<{ enabled: boolean; mode: string | null }>('GET', '/razorpay/status'),
  razorpayLink: (body: { amount_inr: number; description: string; customer_contact?: string }) => request<{ id: string; short_url: string; status: string; amount_inr: number; mode: string }>('POST', '/razorpay/payment-link', body),
  connectors: () => request<ConnectorsResponse>('GET', '/connectors'),
  /** Checks the store address and token without importing anything. */
  shopifyTest: (body: ShopifyTestRequest) => request<ShopifyTestResult>('POST', '/connectors/shopify/test', body),
  /** Imports the store's orders as a new dataset (201). Can take a minute on a large store. */
  shopifyConnect: (body: ShopifyConnectRequest) => request<ShopifyImportResult>('POST', '/connectors/shopify/connect', body),
  /** Imports again with the saved token (404 when not connected). */
  shopifySync: () => request<ShopifyImportResult>('POST', '/connectors/shopify/sync', {}),
  /** Deletes the saved token (204); imported orders stay. */
  shopifyDisconnect: () => request<unknown>('DELETE', '/connectors/shopify'),
  /** Full-page navigation to Shopify's install screen (only when shopify_oauth is true). */
  shopifyInstallUrl: (shop: string, returnTo: string) =>
    `${API_BASE}/connectors/shopify/install?shop=${encodeURIComponent(shop)}&return=${encodeURIComponent(returnTo)}`,
};

/** An endpoint this server does not have yet: callers fall back to the engine's own output. */
export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 405 || err.status === 501);
}

export function toErrorInfo(err: unknown): ErrorInfo {
  if (err instanceof ApiError) return { message: err.message, hint: err.hint, issues: err.issues };
  if (err instanceof Error) return { message: err.message, hint: null, issues: [] };
  return { message: i18n.t('api.somethingWrong', 'Something went wrong. Try again.'), hint: null, issues: [] };
}

export function errorMessage(err: unknown): string {
  return toErrorInfo(err).message;
}
