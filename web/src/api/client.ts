import type { MouseEvent } from 'react';
import type {
  AnalysisRequest,
  AnalysisResponse,
  ApiErrorBody,
  ApiIssue,
  Checks,
  DatasetResponse,
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
} from './types';

import { getIdToken } from '../auth/auth';

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

/** Shown only after the automatic retries below have run out; developers also get the local hint. */
const UNREACHABLE = import.meta.env.DEV
  ? 'Could not reach the API at /api/v1. Start it with "npm run dev" in the api folder, then try again.'
  : 'Profyn could not be reached just now. Nothing was lost; please try again in a moment.';

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

export const SESSION_ENDED = 'Your session has ended. Sign in again to keep working with your saved data.';

const sessionEndedError = () =>
  new ApiError(401, { error: { code: 'unauthorized', message: SESSION_ENDED, hint: 'Your saved data is safe; it opens again after you sign in.' } }, SESSION_ENDED);

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
  const token = getIdToken();
  if (token) return token;
  const renewed = await binding.renew();
  if (renewed) return renewed;
  endSession();
  throw sessionEndedError();
}

async function send(method: 'GET' | 'POST', path: string, body?: unknown, auth = true): Promise<{ res: Response; parsed: unknown }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
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
    if (!res) throw new ApiError(0, null, UNREACHABLE);
    if (res.status === 401 && token) endSession();
    return { res, parsed };
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, auth = true): Promise<T> {
  const { res, parsed } = await send(method, path, body, auth);
  if (!res.ok) {
    if (res.status === 401 && binding?.account) throw sessionEndedError();
    // A proxy or gateway page without a JSON error body means the API process is down.
    if (!readErrorBody(parsed) && res.status >= 500) throw new ApiError(res.status, null, UNREACHABLE);
    throw new ApiError(res.status, parsed, `The request failed with status ${res.status}.`);
  }
  return parsed as T;
}

/** A File[] is merged by the API into one dataset (monthly exports, up to 12 files). */
export type DatasetInput = { source: SampleSource; period_end?: string } | FixtureFile | File | File[];

export interface DatasetOptions {
  /** Add the upload to this saved dataset; orders already saved there are skipped, never counted twice. */
  appendTo?: string;
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
  let res: Response;
  try {
    res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  } catch {
    throw new ApiError(0, null, UNREACHABLE);
  }
  if (res.status === 401 && token) {
    endSession();
    throw sessionEndedError();
  }
  if (!res.ok) {
    const parsed = await res.json().catch(() => null);
    throw new ApiError(res.status, parsed, `The download failed with status ${res.status}.`);
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
    throw new ApiError(res.status, parsed, UNREACHABLE);
  },
  samples: () => request<Sample[]>('GET', '/samples', undefined, false),
  checks: () => request<Checks>('GET', '/checks', undefined, false),
  workedOrder: () => request<WorkedOrderResult>('GET', '/worked-order', undefined, false),

  createDataset: (input: DatasetInput, options: DatasetOptions = {}) => {
    const { appendTo } = options;
    if (input instanceof File || Array.isArray(input)) {
      const form = new FormData();
      if (appendTo) form.append('append_to', appendTo);
      for (const file of input instanceof File ? [input] : input) form.append('file', file, file.name);
      return request<DatasetResponse>('POST', '/datasets', form);
    }
    return request<DatasetResponse>('POST', appendTo ? `/datasets?append_to=${encodeURIComponent(appendTo)}` : '/datasets', input);
  },

  getDataset: (datasetId: string) => request<DatasetResponse>('GET', `/datasets/${encodeURIComponent(datasetId)}`),

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
};

export function toErrorInfo(err: unknown): ErrorInfo {
  if (err instanceof ApiError) return { message: err.message, hint: err.hint, issues: err.issues };
  if (err instanceof Error) return { message: err.message, hint: null, issues: [] };
  return { message: 'Something went wrong. Try again.', hint: null, issues: [] };
}

export function errorMessage(err: unknown): string {
  return toErrorInfo(err).message;
}
