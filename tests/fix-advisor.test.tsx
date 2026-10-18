// @vitest-environment jsdom
// Fix Advisor: "Fix this" on a leak card (or #/leaks?fix=<cause>) opens the panel with what is happening, the ranked
// fixes, the drafted 30-day test and stop rule; "Apply this scenario" runs the scenario and shows before / after;
// "Save as decision" posts it. A server without the advisor endpoint gets the engine's own explanation.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyze } from '../api/src/engine/analyze';
import type { Advisor, AnalysisResponse } from '../web/src/api/types';
import { setLanguage } from '../web/src/i18n';
import { EXTENDED, rows } from './helpers';

const h = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));

vi.mock('../web/src/auth/AuthContext', () => ({
  useAuth: () => ({ ready: true, mode: 'demo', config: { enabled: false }, user: null, hasSession: false, sessionEnded: false, signOut: () => undefined, loginUrl: '/login/', backToWorkspace: () => undefined }),
}));

vi.mock('../web/src/state/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../web/src/state/store')>();
  return { ...actual, useStore: () => h.store };
});

import { LeaksScreen } from '../web/src/screens/LeaksScreen';

const CAUSE = 'full_return_partial_recovery';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const analysis: AnalysisResponse = { ...(analyze(rows(EXTENDED), { attribution: 'allocate' }) as unknown as AnalysisResponse), analysis_id: 'a-ext', dataset_id: 'd-ext' };

const advisor: Advisor = {
  cause: CAUSE,
  label: 'Full return, partial recovery',
  summary: { text: 'Three returned orders came back with only part of the stock recovered.', source: 'ai' },
  facts: [
    { label: 'Orders', value: '3' },
    { label: 'Recovered', value: '62%' },
  ],
  interventions: [
    { candidate_id: 'c1', intervention: 'raise_recovery_via_inspection', label: 'Raise recovery via inspection', overrides: { recovery_pct: 50 }, expected_delta_inr: 480, confidence: 'high' },
    { candidate_id: 'c2', intervention: 'charge_return_shipping', label: 'Charge return shipping', overrides: null, expected_delta_inr: 150, confidence: 'low' },
  ],
  test_30d: { text: 'Inspect every return for 30 days and log what goes back to stock.', source: 'template' },
  stop_rule: { text: 'Stop if recovery stays under 40% after 30 days.', source: 'template' },
};

type Call = { url: string; method: string; body: Record<string, unknown> | undefined };

function stubFetch(handler: (url: string, method: string) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = String(init.method ?? 'GET');
      calls.push({ url, method, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
      return handler(url, method);
    }),
  );
  return calls;
}

function setStore() {
  const store = {
    analysis,
    narration: null,
    openOrder: vi.fn(),
    openOrderResult: vi.fn(),
    showToast: vi.fn(),
    markDecisionSaved: vi.fn(),
    restoring: false,
    analysing: false,
    importing: false,
    workspace: null,
  };
  h.store = store;
  return store;
}

const panel = () => screen.getByRole('dialog', { name: /Fix:/ });

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '#/leaks';
  act(() => setLanguage('en'));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Fix Advisor', () => {
  it('opens from "Fix this", explains the leak and runs the chosen fix as a scenario with before / after', async () => {
    const calls = stubFetch((url, method) => {
      if (method === 'POST' && url === '/api/v1/analyses/a-ext/advisor') return json(advisor);
      if (method === 'POST' && url === '/api/v1/analyses/a-ext/scenarios')
        return json({
          scenario_id: 's1',
          analysis_id: 'a-ext',
          baseline: { contribution_inr: 6000 },
          scenario: { contribution_inr: 6480 },
          delta: { contribution_inr: 480, by_order: [] },
        });
      if (method === 'POST' && url === '/api/v1/analyses/a-ext/decisions') return json({ decision_id: 'dec1', saved_at: '2026-10-18T09:00:00Z', assumptions: {}, engine_version: '1.0.0', persisted: true });
      return json({ error: { code: 'not_found', message: 'nope' } }, 404);
    });
    const store = setStore();
    const { container } = render(<LeaksScreen />);

    // The old "Simulate a fix" link is now "Fix this"; each card also links to its orders on the ledger.
    expect(screen.queryByText('Simulate a fix')).toBeNull();
    const card = container.querySelector(`#leak-${CAUSE}`)?.closest('article') as HTMLElement;
    expect(within(card).getByRole('link', { name: /See the orders/ }).getAttribute('href')).toBe(`#/ledger?cause=${CAUSE}&from=leaks`);
    fireEvent.click(within(card).getByRole('button', { name: 'Fix this' }));

    await within(panel()).findByText('Three returned orders came back with only part of the stock recovered.');
    expect(calls.find((c) => c.url.endsWith('/advisor'))?.body).toEqual({ cause: CAUSE, lang: 'en' });
    expect(within(panel()).getByText('AI summary · numbers from the engine')).toBeTruthy();
    expect(within(panel()).getByText('Raise recovery via inspection')).toBeTruthy();
    expect(within(panel()).getByText('Charge return shipping')).toBeTruthy();
    expect(within(panel()).getByText('Inspect every return for 30 days and log what goes back to stock.')).toBeTruthy();
    expect(within(panel()).getByText('Stop if recovery stays under 40% after 30 days.')).toBeTruthy();

    fireEvent.click(within(panel()).getByRole('button', { name: 'Apply this scenario' }));
    const result = await within(panel()).findByLabelText('Scenario result');
    expect(calls.find((c) => c.url.endsWith('/scenarios'))?.body).toEqual({ overrides: { recovery_pct: 50 } });
    expect(result.textContent).toContain('Before');
    expect(result.textContent).toContain('6,000');
    expect(result.textContent).toContain('6,480');
    expect(result.textContent).toContain('480');

    fireEvent.change(within(panel()).getByLabelText('Owner'), { target: { value: 'Asha' } });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Save as decision' }));
    await within(panel()).findByText('Decision saved.');
    expect(calls.find((c) => c.url.endsWith('/decisions'))?.body).toMatchObject({
      scenario_id: 's1',
      intervention: 'raise_recovery_via_inspection',
      expected_delta_inr: 480,
      test_30d: 'Inspect every return for 30 days and log what goes back to stock.',
      stop_rule: 'Stop if recovery stays under 40% after 30 days.',
      owner: 'Asha',
    });
    expect(store.markDecisionSaved).toHaveBeenCalledWith('a-ext');
  });

  it('opens from #/leaks?fix=<cause> and falls back to the engine explanation without the advisor endpoint', async () => {
    window.location.hash = `#/leaks?fix=${CAUSE}`;
    stubFetch(() => json({ error: { code: 'not_found', message: 'No route' } }, 404));
    setStore();
    render(<LeaksScreen />);
    const group = analysis.leaks.find((l) => l.cause === CAUSE);
    expect(group).toBeTruthy();
    await within(panel()).findByText(/engine’s own explanation and ranking/);
    expect(panel().querySelector('.fix-summary')?.textContent).toBe(group!.why);
    // A fix without one assumption to change cannot be applied here; the Scenario step is offered instead.
    const apply = within(panel()).getByRole('button', { name: 'Apply this scenario' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(within(panel()).getByRole('link', { name: 'Open the Scenario step' }).getAttribute('href')).toBe('#/scenario');
    // Closing drops ?fix= so a reload does not reopen it.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(window.location.hash).toBe('#/leaks'));
  });
});
