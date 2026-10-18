// @vitest-environment jsdom
// Overview (autopilot): the three ranked actions render from a mocked autopilot, numbers first and the explanation filled
// in later; "Accept and save decision" posts to the autopilot's accept endpoint; "Adjust in Scenario" prefills the
// scenario; a server without the autopilot shows the engine's own ranking.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyze } from '../api/src/engine/analyze';
import type { AnalysisResponse, Autopilot } from '../web/src/api/types';
import { setLanguage } from '../web/src/i18n';
import { FIXTURE, rows } from './helpers';

const h = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));

vi.mock('../web/src/auth/AuthContext', () => ({
  useAuth: () => ({ ready: true, mode: 'demo', config: { enabled: false }, user: null, hasSession: false, sessionEnded: false, signOut: () => undefined, loginUrl: '/login/', backToWorkspace: () => undefined }),
}));

vi.mock('../web/src/state/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../web/src/state/store')>();
  return { ...actual, useStore: () => h.store };
});

import { FALLBACK_SAMPLES } from '../web/src/state/store';
import { clearAutopilotCache, OverviewScreen } from '../web/src/screens/OverviewScreen';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function doc(over: Partial<Autopilot> = {}): Autopilot {
  return {
    autopilot_id: 'ap1',
    dataset_id: 'd1',
    analysis_id: 'a1',
    status: 'done',
    stages: { analysis: 'done', leaks: 'done', scenarios: 'done', margins: 'done', pulse: 'done', explanations: 'done' },
    headline: { contribution_inr: 6000, net_sales_inr: 25000, orders: 20, unknown_orders: 0, partial: false, margins: null },
    top_leaks: [
      { cause: 'full_return_partial_recovery', label: 'Full return, partial recovery', orders: 3, inr_at_stake: 450 },
      { cause: 'discount_exceeds_margin', label: 'Discount exceeds margin', orders: 2, inr_at_stake: 120 },
    ],
    actions: [
      {
        rank: 1,
        candidate_id: 'c1',
        intervention: 'raise_recovery_via_inspection',
        label: 'Raise recovery via inspection',
        overrides: { recovery_pct: 50 },
        expected_delta_inr: 480,
        confidence: 'high',
        explanation: { text: 'Returned stock is written off at a loss; inspection brings half of it back.', source: 'ai' },
        decision_draft: { intervention: 'raise_recovery_via_inspection', expected_delta_inr: 480, test_30d: 'Inspect every return for 30 days.', stop_rule: 'Stop if recovery stays under 40%.' },
      },
      {
        rank: 2,
        candidate_id: 'c2',
        intervention: 'charge_return_shipping',
        label: 'Charge return shipping',
        overrides: { shipping_inr: 80 },
        expected_delta_inr: 150,
        confidence: 'low',
        explanation: { text: 'Return shipping is paid by the brand today.', source: 'template' },
        decision_draft: null,
      },
      {
        rank: 3,
        candidate_id: 'c3',
        intervention: 'cap_discount',
        label: 'Cap discount',
        overrides: null,
        expected_delta_inr: 90,
        confidence: 'unknown',
        explanation: null,
        decision_draft: null,
      },
    ],
    ...over,
  };
}

type Call = { url: string; method: string; body: unknown };

function stubFetch(handler: (url: string, method: string, body: unknown) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = String(init.method ?? 'GET');
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      return handler(url, method, body);
    }),
  );
  return calls;
}

function setStore(over: Record<string, unknown> = {}) {
  const store = {
    samples: FALLBACK_SAMPLES,
    dataset: null,
    datasetId: 'd1',
    analysis: null,
    analysing: false,
    restoring: false,
    importing: false,
    workspace: null,
    setOverrides: vi.fn(),
    showToast: vi.fn(),
    markDecisionSaved: vi.fn(),
    runAnalysis: vi.fn(),
    importDataset: vi.fn(),
    ...over,
  };
  h.store = store;
  return store;
}

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '#/overview';
  clearAutopilotCache();
  act(() => setLanguage('en'));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Overview', () => {
  it('renders the headline, the three biggest leaks and the top 3 actions from the autopilot', async () => {
    const calls = stubFetch((url, method) => (method === 'POST' && url === '/api/v1/datasets/d1/autopilot' ? json(doc()) : json({ error: { code: 'not_found', message: 'nope' } }, 404)));
    setStore();
    const { container } = render(<OverviewScreen />);

    await screen.findByRole('heading', { name: 'Raise recovery via inspection' });
    expect(calls[0]).toMatchObject({ url: '/api/v1/datasets/d1/autopilot', method: 'POST', body: { attribution: 'allocate', lang: 'en' } });

    const cards = Array.from(container.querySelectorAll('.ov-action'));
    expect(cards.map((c) => c.querySelector('.ov-action-title')?.textContent)).toEqual(['Raise recovery via inspection', 'Charge return shipping', 'Cap discount']);
    expect(cards[0].textContent).toContain('480');
    expect(within(cards[0] as HTMLElement).getByText('AI summary · numbers from the engine')).toBeTruthy();
    expect(within(cards[1] as HTMLElement).getByText('Template text')).toBeTruthy();
    expect(within(cards[0] as HTMLElement).getByRole('link', { name: 'Why this is safe' }).getAttribute('href')).toBe('#/ai');

    // Headline with provenance, and each leak links to its orders on the ledger.
    expect(container.querySelector('.ov-value')?.textContent).toContain('6,000');
    expect(container.querySelector('.ov-headline [data-provenance="observed"]')).toBeTruthy();
    const seeOrders = screen.getAllByRole('link', { name: /See the orders/ });
    expect(seeOrders[0].getAttribute('href')).toContain('#/ledger?cause=full_return_partial_recovery');
    expect(screen.getAllByRole('link', { name: 'Fix this' })[0].getAttribute('href')).toBe('#/leaks?fix=full_return_partial_recovery');
  });

  it('"Accept and save decision" posts the rank to the accept endpoint and confirms', async () => {
    const calls = stubFetch((url, method) => {
      if (method === 'POST' && url === '/api/v1/datasets/d1/autopilot') return json(doc());
      if (method === 'POST' && url === '/api/v1/autopilot/ap1/accept') return json({ decision_id: 'dec1', saved_at: '2026-10-18T09:00:00Z', assumptions: {}, engine_version: '1.0.0', persisted: true });
      return json({ error: { code: 'not_found', message: 'nope' } }, 404);
    });
    const store = setStore();
    render(<OverviewScreen />);
    const accept = await screen.findAllByRole('button', { name: 'Accept and save decision' });
    fireEvent.click(accept[0]);

    await screen.findByText('Decision saved.');
    const post = calls.find((c) => c.url === '/api/v1/autopilot/ap1/accept');
    expect(post).toMatchObject({ method: 'POST', body: { rank: 1 } });
    expect(store.showToast).toHaveBeenCalledWith('Decision saved: Raise recovery via inspection');
    expect(store.markDecisionSaved).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Open the decision' }).getAttribute('href')).toBe('#/decision');
  });

  it('"Adjust in Scenario" prefills the scenario with the action\'s overrides', async () => {
    stubFetch((url, method) => (method === 'POST' && url.endsWith('/autopilot') ? json(doc()) : json({}, 404)));
    const store = setStore();
    render(<OverviewScreen />);
    const adjust = await screen.findAllByRole('button', { name: 'Adjust in Scenario' });
    fireEvent.click(adjust[1]);
    expect(store.setOverrides).toHaveBeenCalledWith({ shipping_inr: 80 });
    expect(window.location.hash).toBe('#/scenario');
  });

  it('shows the numbers first and fills in the explanation when the run finishes', async () => {
    const running = doc({
      status: 'running',
      stages: { analysis: 'done', leaks: 'done', scenarios: 'done', margins: 'done', pulse: 'done', explanations: 'running' },
      actions: doc().actions.map((a) => ({ ...a, explanation: null })),
    });
    let polls = 0;
    stubFetch((url, method) => {
      if (method === 'POST') return json(running);
      if (url === '/api/v1/autopilot/ap1') {
        polls++;
        return json(doc());
      }
      return json({}, 404);
    });
    setStore();
    render(<OverviewScreen />);
    await screen.findByRole('heading', { name: 'Raise recovery via inspection' });
    expect(screen.getAllByText('Writing the explanation…').length).toBe(3);
    await screen.findByText('Returned stock is written off at a loss; inspection brings half of it back.', undefined, { timeout: 4000 });
    expect(polls).toBeGreaterThan(0);
  });

  it('falls back to the engine ranking when the server has no autopilot, and saves through POST /decisions', async () => {
    const a = { ...(analyze(rows(FIXTURE), { attribution: 'allocate' }) as unknown as AnalysisResponse), analysis_id: 'a-fx', dataset_id: 'd1' };
    const calls = stubFetch((url, method) => {
      if (url.endsWith('/autopilot')) return json({ error: { code: 'not_found', message: 'No route' } }, 404);
      if (method === 'POST' && url === '/api/v1/analyses/a-fx/decisions') return json({ decision_id: 'dec2', saved_at: '2026-10-18T09:00:00Z', assumptions: {}, engine_version: '1.0.0', persisted: false });
      return json({}, 404);
    });
    setStore({ analysis: a });
    const { container } = render(<OverviewScreen />);
    await screen.findByText('Showing the engine’s own ranking.');
    const titles = Array.from(container.querySelectorAll('.ov-action-title')).map((el) => el.textContent);
    const expected = [...a.candidates].filter((c) => c.delta_inr > 0).sort((x, y) => y.delta_inr - x.delta_inr).slice(0, 3).map((c) => c.label);
    expect(titles).toEqual(expected);
    fireEvent.click(screen.getAllByRole('button', { name: 'Accept and save decision' })[0]);
    await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/analyses/a-fx/decisions')).toBe(true));
    const body = calls.find((c) => c.url === '/api/v1/analyses/a-fx/decisions')?.body as Record<string, unknown>;
    expect(body.intervention).toBe(a.candidates.find((c) => c.label === expected[0])?.intervention);
    expect(typeof body.test_30d).toBe('string');
    expect(typeof body.owner).toBe('string');
  });
});
