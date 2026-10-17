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
} from './types';

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

const UNREACHABLE =
  'Could not reach the API at /api/v1. Start it with "npm run dev" in the api folder, then try again.';

async function send(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ res: Response; parsed: unknown }> {
  const init: RequestInit = { method, headers: { Accept: 'application/json' } };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(0, null, UNREACHABLE);
  }
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  return { res, parsed };
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const { res, parsed } = await send(method, path, body);
  if (!res.ok) {
    // A proxy or gateway page without a JSON error body means the API process is down.
    if (!readErrorBody(parsed) && res.status >= 500) throw new ApiError(res.status, null, UNREACHABLE);
    throw new ApiError(res.status, parsed, `The request failed with status ${res.status}.`);
  }
  return parsed as T;
}

export type DatasetInput = { source: SampleSource; period_end?: string } | FixtureFile | File;

export const api = {
  /** 503 with a body means the API is up but the database is down; that still counts as up. */
  health: async (): Promise<Health> => {
    const { res, parsed } = await send('GET', '/health');
    if (parsed && typeof parsed === 'object' && 'engine_version' in parsed) return parsed as Health;
    throw new ApiError(res.status, parsed, UNREACHABLE);
  },
  samples: () => request<Sample[]>('GET', '/samples'),
  checks: () => request<Checks>('GET', '/checks'),
  workedOrder: () => request<WorkedOrderResult>('GET', '/worked-order'),

  createDataset: (input: DatasetInput) => {
    if (input instanceof File) {
      const form = new FormData();
      form.append('file', input, input.name);
      return request<DatasetResponse>('POST', '/datasets', form);
    }
    return request<DatasetResponse>('POST', '/datasets', input);
  },

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
