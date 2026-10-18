// @vitest-environment jsdom
// UI language: the sidebar shows the en/hi/te labels, and the switcher's choice survives a reload.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../web/src/components/Sidebar';
import { i18n, setLanguage } from '../web/src/i18n';
import en from '../web/src/i18n/en.json';
import hi from '../web/src/i18n/hi.json';
import te from '../web/src/i18n/te.json';

// The sidebar reads progress and the checks from the store; none of it changes the labels.
vi.mock('../web/src/state/store', () => ({
  useStore: () => ({
    datasetId: null,
    analysis: null,
    scenario: null,
    decisionSavedFor: null,
    engineVersion: null,
    checks: null,
    openChecks: () => undefined,
    openAbout: () => undefined,
  }),
}));

const DICT = { en, hi, te };
const NAV = ['overview', 'import', 'ledger', 'leaks', 'scenario', 'decision', 'pulse'] as const;

const navLabels = (root: HTMLElement) => Array.from(root.querySelectorAll('.nav-label')).map((el) => el.textContent);

beforeEach(() => {
  window.localStorage.clear();
  act(() => setLanguage('en'));
});

afterEach(cleanup);

describe('i18n: sidebar labels', () => {
  it.each(['en', 'hi', 'te'] as const)('renders the nav labels from %s.json', (lng) => {
    act(() => setLanguage(lng));
    const { container } = render(<Sidebar route="ledger" />);
    expect(navLabels(container)).toEqual(NAV.map((k) => DICT[lng].nav[k]));
    expect(screen.getByText(DICT[lng].tagline)).toBeTruthy();
    expect(document.documentElement.lang).toBe(lng);
  });

  it('keeps the English accessible names', () => {
    render(<Sidebar route="ledger" />);
    expect(screen.getByRole('link', { name: 'Step 2: Ledger' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Pulse: owner analytics' })).toBeTruthy();
    const group = screen.getByRole('group', { name: 'Language' });
    expect(within(group).getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('i18n: language switcher', () => {
  it('persists తెలుగు across a reload', async () => {
    const { container } = render(<Sidebar route="ledger" />);
    const button = within(screen.getByRole('group', { name: 'Language' })).getByRole('button', { name: 'తెలుగు' });
    expect(button.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(button);
    expect(window.localStorage.getItem('lang')).toBe('te');
    expect(document.documentElement.lang).toBe('te');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(navLabels(container)).toEqual(NAV.map((k) => te.nav[k]));

    // A reload: a fresh module, so a fresh i18next instance that reads localStorage again.
    vi.resetModules();
    const fresh = await import('../web/src/i18n');
    expect(fresh.i18n).not.toBe(i18n);
    expect(fresh.i18n.language).toBe('te');
  });
});
