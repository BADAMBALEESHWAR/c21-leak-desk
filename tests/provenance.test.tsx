// @vitest-environment jsdom
// Provenance on the Scenario screen: every override control reads Observed before a change and Assumed after it,
// exactly one variable changes at a time, and the comparison columns say which side is which.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyze, scenarioFor } from '../api/src/engine/analyze';
import type { AnalysisResponse, OverrideKey, ScenarioOverrides, ScenarioResponse } from '../web/src/api/types';
import { setLanguage } from '../web/src/i18n';
import { NEG, rows } from './helpers';

const h = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));

vi.mock('../web/src/auth/AuthContext', () => ({
  useAuth: () => ({ ready: true, mode: 'demo', config: { enabled: false }, user: null, hasSession: false, sessionEnded: false, signOut: () => undefined, loginUrl: '/login/', backToWorkspace: () => undefined }),
}));

vi.mock('../web/src/state/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../web/src/state/store')>();
  return { ...actual, useStore: () => h.store };
});

import { isRunnable, OVERRIDE_KEYS } from '../web/src/state/store';
import { oneAtATime, ScenarioScreen } from '../web/src/screens/ScenarioScreen';

// null_refund: one returned order without its refund, so the assume-unknown-refund switch is live too.
const DATA = NEG('null_refund.json');
const engineRows = rows(DATA);
const analysis = { ...(analyze(engineRows, { attribution: 'allocate' }) as unknown as AnalysisResponse), analysis_id: 'a1', dataset_id: 'd1' };

function scenarioOf(o: ScenarioOverrides): ScenarioResponse {
  const s = scenarioFor(engineRows, { attribution: 'allocate' }, o as never) as unknown as ScenarioResponse;
  return { ...s, scenario_id: 's1', analysis_id: 'a1', observed: analysis.observed };
}

/** A stateful stand-in for the store: overrides and the scenario live here, as in the app. */
function Harness() {
  const [overrides, setOverrides] = useState<ScenarioOverrides>({});
  const [scenario, setScenario] = useState<ScenarioResponse | null>(null);
  const [scenarioOverrides, setScenarioOverrides] = useState<ScenarioOverrides | null>(null);
  h.store = {
    analysis,
    narration: null,
    scenario,
    scenarioOverrides,
    scenarioLoading: false,
    scenarioError: null,
    overrides,
    setOverrides,
    runScenario: async (o: ScenarioOverrides) => {
      if (!isRunnable(o)) {
        setScenario(null);
        setScenarioOverrides(null);
        return;
      }
      setScenario(scenarioOf(o));
      setScenarioOverrides(o);
    },
    restoring: false,
    analysing: false,
    importing: false,
  };
  return <ScenarioScreen />;
}

const KEYS: OverrideKey[] = ['return_rate_pct', 'recovery_pct', 'shipping_inr', 'refund_policy', 'ads_per_order'];
const RADIO: Record<OverrideKey, RegExp> = {
  return_rate_pct: /^Return rate/,
  recovery_pct: /^Recovery per return/,
  shipping_inr: /^Shipping per order/,
  refund_policy: /^Refund policy/,
  ads_per_order: /^Ads per order/,
};

const kindOf = (container: HTMLElement, control: string) =>
  container.querySelector(`[data-control="${control}"] [data-provenance]`)?.getAttribute('data-provenance') ?? null;

const allKinds = (container: HTMLElement) => Object.fromEntries([...KEYS, 'assume_unknown_refund'].map((k) => [k, kindOf(container, k)]));

/** Change the selected control's value the way a person would. */
function change(k: OverrideKey) {
  switch (k) {
    case 'return_rate_pct':
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Return rate, percent' }), { target: { value: '35' } });
      break;
    case 'recovery_pct':
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Recovery as a percent of product cost' }), { target: { value: '60' } });
      break;
    case 'shipping_inr':
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Shipping per order, rupees' }), { target: { value: '80' } });
      break;
    case 'refund_policy':
      fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Refund policy on returns' })).getByRole('radio', { name: 'Full refund' }));
      break;
    case 'ads_per_order':
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Ads per order, rupees' }), { target: { value: '30' } });
      break;
  }
}

beforeEach(() => {
  window.localStorage.clear();
  act(() => setLanguage('en'));
});

afterEach(cleanup);

describe('Scenario provenance', () => {
  it('shows Observed on every control before any change', () => {
    const { container } = render(<Harness />);
    expect(allKinds(container)).toEqual({
      return_rate_pct: 'observed',
      recovery_pct: 'observed',
      shipping_inr: 'observed',
      refund_policy: 'observed',
      ads_per_order: 'observed',
      assume_unknown_refund: 'observed',
    });
    // The old "observed ₹ 295 · 50%" text is now a badge plus a value.
    const meta = container.querySelector('[data-control="recovery_pct"]') as HTMLElement;
    expect(meta.textContent).toMatch(/^Observed/);
    expect(meta.textContent).not.toMatch(/observed/);
  });

  it.each(KEYS)('%s reads Observed before a change and Assumed after; the others stay Observed', async (k) => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: RADIO[k] }));
    expect(kindOf(container, k)).toBe('observed');

    change(k);

    expect(kindOf(container, k)).toBe('assumed');
    for (const other of KEYS.filter((x) => x !== k)) expect(kindOf(container, other)).toBe('observed');
    expect(container.querySelector('.changed-line')?.textContent).toMatch(/1 of 5 changed/);

    // The comparison labels its sides once the scenario has run.
    await waitFor(() => expect(container.querySelector('.compare-table')).toBeTruthy(), { timeout: 2000 });
    const heads = Array.from(container.querySelectorAll('.compare-table thead th')).map((th) => th.textContent);
    expect(heads).toEqual(expect.arrayContaining(['Observed baseline', 'Assumed scenario']));

    // Reset: back to Observed everywhere.
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(kindOf(container, k)).toBe('observed');
  });

  it('the assume-unknown-refund switch reads Assumed when on, and may ride along with one change', () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole('switch'));
    expect(kindOf(container, 'assume_unknown_refund')).toBe('assumed');

    fireEvent.click(screen.getByRole('radio', { name: RADIO.recovery_pct }));
    change('recovery_pct');
    expect(kindOf(container, 'recovery_pct')).toBe('assumed');
    expect(kindOf(container, 'assume_unknown_refund')).toBe('assumed');

    // Another variable replaces the first: still exactly one change.
    fireEvent.click(screen.getByRole('radio', { name: RADIO.shipping_inr }));
    change('shipping_inr');
    expect(kindOf(container, 'shipping_inr')).toBe('assumed');
    expect(kindOf(container, 'recovery_pct')).toBe('observed');
  });

  it('the recommendation figures carry Observed at the baseline and Assumed under a scenario', async () => {
    const { container } = render(<Harness />);
    const figure = () => container.querySelector('.rec-figure-label [data-provenance]')?.getAttribute('data-provenance');
    expect(figure()).toBe('observed');
    fireEvent.click(screen.getByRole('radio', { name: RADIO.recovery_pct }));
    change('recovery_pct');
    await waitFor(() => expect(figure()).toBe('assumed'), { timeout: 2000 });
    const flip = container.querySelector('.flip') as HTMLElement;
    expect(flip.querySelectorAll('[data-provenance="observed"]').length).toBe(1);
    expect(flip.querySelectorAll('[data-provenance="assumed"]').length).toBe(1);
  });

  it('cuts anything with more than one change back to exactly one', () => {
    expect(oneAtATime({ shipping_inr: 80, ads_per_order: 30, assume_unknown_refund: true })).toEqual({ shipping_inr: 80, assume_unknown_refund: true });
    expect(OVERRIDE_KEYS.filter((k) => oneAtATime({ return_rate_pct: 10, recovery_pct: 50, refund_policy: 'full' })[k] !== undefined)).toEqual(['return_rate_pct']);
  });
});
