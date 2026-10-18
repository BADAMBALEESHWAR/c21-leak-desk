// @vitest-environment jsdom
// Editing a flagged row on the import report: Edit opens the row, 200 is entered for an unknown refund, and Save sends
// PATCH /datasets/:id/rows with the right body. A 422 keeps the editor open with the reason under the field.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatasetResponse, RowCorrectionRequest } from '../web/src/api/types';
import { setLanguage } from '../web/src/i18n';

const h = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));

vi.mock('../web/src/auth/AuthContext', () => ({
  useAuth: () => ({ ready: true, mode: 'demo', config: { enabled: false }, user: null, hasSession: false, sessionEnded: false, signOut: () => undefined, loginUrl: '/login/', backToWorkspace: () => undefined }),
}));

vi.mock('../web/src/state/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../web/src/state/store')>();
  return { ...actual, useStore: () => h.store };
});

import { api } from '../web/src/api/client';
import { FALLBACK_SAMPLES } from '../web/src/state/store';
import { ImportScreen } from '../web/src/screens/ImportScreen';

const noop = () => undefined;

const dataset: DatasetResponse = {
  dataset_id: 'd1',
  source: 'null_refund',
  rows_in: 20,
  rows_kept: 20,
  rows_rejected: 0,
  kept_ids: ['O05'],
  synthetic_rows: 0,
  flags: [
    { order_id: 'O05', line: 6, reason: 'unknown', field: 'refund_inr', path: 'records.orders[4].refund_inr', detail: 'refund_inr is null on O05 — status unknown, never zero.', action: 'kept' },
    { order_id: 'O05', line: 6, reason: 'unknown', field: 'recovered_product_cost_inr', path: 'records.orders[4].recovered_product_cost_inr', detail: 'recovered_product_cost_inr is null on O05.', action: 'kept' },
  ],
  warnings: [],
  period_end: '2026-09-30',
};

function setup(respond: (body: RowCorrectionRequest) => { status: number; json: unknown }) {
  const calls: Array<{ url: string; method: string; body: RowCorrectionRequest }> = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as RowCorrectionRequest;
    calls.push({ url, method: String(init.method), body });
    const r = respond(body);
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  const showToast = vi.fn();
  h.store = {
    samples: FALLBACK_SAMPLES,
    dataset,
    datasetId: 'd1',
    analysis: null,
    analysing: false,
    importing: false,
    importError: null,
    setImportError: noop,
    workspace: null,
    workspaceStatus: 'idle',
    importDataset: vi.fn(),
    runAnalysis: vi.fn(),
    correctRow: (body: RowCorrectionRequest) => api.correctRow('d1', body),
    correctedOrderIds: [],
    showToast,
  };
  render(<ImportScreen />);
  return { calls, showToast };
}

beforeEach(() => {
  window.localStorage.clear();
  act(() => setLanguage('en'));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Edit a flagged row', () => {
  it('groups an order with several flags behind one Edit button', () => {
    setup(() => ({ status: 201, json: dataset }));
    expect(screen.getAllByRole('button', { name: 'Edit O05' })).toHaveLength(1);
  });

  it('sends PATCH /datasets/d1/rows with the order, the line and the one changed field', async () => {
    const { calls, showToast } = setup(() => ({ status: 201, json: { ...dataset, dataset_id: 'd2', corrected_order_ids: ['O05'], corrections: [] } }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit O05' }));
    const refund = screen.getByLabelText('refund_inr') as HTMLInputElement;
    // Unknown shows as empty with an "unknown" placeholder.
    expect(refund.value).toBe('');
    expect(refund.placeholder).toBe('unknown');
    fireEvent.change(refund, { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toBe('/api/v1/datasets/d1/rows');
    expect(calls[0].body).toEqual({ order_id: 'O05', line: 6, changes: { refund_inr: 200 } });
    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast.mock.calls[0][0]).toMatch(/^Corrected O05 · refund_inr: unknown → ₹\s?200\. Saved as a new version; the original is kept\.$/);
  });

  it('keeps the editor open on 422 and shows the reason under the field', async () => {
    const { calls } = setup(() => ({
      status: 422,
      json: { error: { code: 'schema_invalid', message: 'refund_inr must not be negative.', path: 'changes.refund_inr', issues: [{ path: 'changes.refund_inr', message: 'must not be negative' }] } },
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit O05' }));
    fireEvent.change(screen.getByLabelText('refund_inr'), { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('must not be negative');
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeTruthy();
    expect((screen.getByLabelText('refund_inr') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
  });

  it('marks corrected orders in the flagged rows table', () => {
    setup(() => ({ status: 201, json: dataset }));
    cleanup();
    h.store = { ...h.store, dataset: { ...dataset, corrected_order_ids: ['O05'] } };
    render(<ImportScreen />);
    const table = screen.getByRole('table', { name: /Validation flags/ });
    expect(within(table).getAllByText('Corrected').length).toBeGreaterThan(0);
  });
});
