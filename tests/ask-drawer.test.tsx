// @vitest-environment jsdom
// Ask Profyn: the floating button opens the chat drawer with suggested questions; a question is posted with the current
// language; the answer shows its badge (AI / template / table), the tool used, a compact table for table answers and an
// "Open in <screen>" link built from the answer's route and filters.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskAnswer } from '../web/src/api/types';
import { setLanguage } from '../web/src/i18n';

const h = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));

vi.mock('../web/src/state/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../web/src/state/store')>();
  return { ...actual, useStore: () => h.store };
});

import { AskDrawer, linkOf, tableOf } from '../web/src/components/AskDrawer';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const tableAnswer: AskAnswer = {
  answer: 'P3 lost the most in September 2026.',
  source: 'table',
  tool: { name: 'top_products', args: { month: '2026-09', sort: 'contribution' } },
  result: [
    { product_id: 'P3', orders: 4, contribution_inr: -820 },
    { product_id: 'P1', orders: 6, contribution_inr: -150 },
  ],
  link: { route: 'ledger', params: { product: 'P3', month: '2026-09' } },
  rejected: null,
};

type Call = { url: string; method: string; body: Record<string, unknown> | undefined; headers: Record<string, string> };

function stubFetch(answer: (q: string) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method: String(init.method ?? 'GET'), body, headers: (init.headers ?? {}) as Record<string, string> });
      return answer(String(body?.question ?? ''));
    }),
  );
  return calls;
}

const dialog = () => screen.getByRole('dialog', { name: 'Ask Profyn' });

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '#/overview';
  h.store = { analysis: { analysis_id: 'a1' } };
  act(() => setLanguage('en'));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Ask Profyn', () => {
  it('asks a suggested question in the current language and shows the table answer with its tool and link', async () => {
    const calls = stubFetch(() => json(tableAnswer));
    render(<AskDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask Profyn' }));
    const d = dialog();
    for (const q of ['Which product lost most in September?', 'What if return shipping is charged?', 'Why is Instagram negative?']) {
      expect(within(d).getByRole('button', { name: q })).toBeTruthy();
    }
    fireEvent.click(within(d).getByRole('button', { name: 'Which product lost most in September?' }));

    await within(d).findByText('P3 lost the most in September 2026.');
    expect(calls[0]).toMatchObject({ url: '/api/v1/analyses/a1/ask', method: 'POST', body: { question: 'Which product lost most in September?', lang: 'en' } });
    expect(within(d).getByText('Table')).toBeTruthy();
    expect(within(d).getByText('top_products')).toBeTruthy();
    const table = within(d).getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(table.textContent).toContain('P3');
    expect(table.textContent).toContain('820');
    const open = within(d).getByRole('link', { name: /Open in Ledger/ });
    expect(open.getAttribute('href')).toBe('#/ledger?product=P3&month=2026-09');
    expect(within(d).getByRole('link', { name: 'Why this is safe' }).getAttribute('href')).toBe('#/ai');
  });

  it('sends the language the UI is in, and marks AI wording as AI', async () => {
    act(() => setLanguage('te'));
    const calls = stubFetch(() => json({ answer: 'Instagram ప్రకటనల ఖర్చు ఆర్డర్ కంట్రిబ్యూషన్ కంటే ఎక్కువ.', source: 'ai', tool: { name: 'channel_breakdown' }, result: null, link: { route: 'pulse', params: { channel: 'instagram' } } }));
    render(<AskDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Profynను అడగండి' }));
    const input = screen.getByLabelText('మీ ప్రశ్న');
    fireEvent.change(input, { target: { value: 'Instagram నెగటివ్‌గా ఎందుకు ఉంది?' } });
    fireEvent.click(screen.getByRole('button', { name: 'అడగండి' }));
    await screen.findByText('Instagram ప్రకటనల ఖర్చు ఆర్డర్ కంట్రిబ్యూషన్ కంటే ఎక్కువ.');
    expect(calls[0].body).toEqual({ question: 'Instagram నెగటివ్‌గా ఎందుకు ఉంది?', lang: 'te' });
    expect(calls[0].headers['Accept-Language']).toBe('te');
    expect(screen.getByText('AI')).toBeTruthy();
    expect(document.querySelector('.ask-link')?.getAttribute('href')).toBe('#/pulse?channel=instagram');
  });

  it('says so plainly when the server has no Ask endpoint', async () => {
    stubFetch(() => json({ error: { code: 'not_found', message: 'No route for POST /api/v1/analyses/a1/ask.' } }, 404));
    render(<AskDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask Profyn' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Why is Instagram negative?' }));
    await waitFor(() => expect(within(dialog()).getByRole('alert').textContent).toContain('not available on this server yet'));
  });

  it('asks for data first when nothing is loaded', () => {
    h.store = { analysis: null };
    render(<AskDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask Profyn' }));
    expect(within(dialog()).getByRole('link', { name: 'Go to Import' }).getAttribute('href')).toBe('#/import');
    expect((within(dialog()).getByLabelText('Your question') as HTMLInputElement).disabled).toBe(true);
  });

  it('builds links only to real screens and tables from rows, {rows} or one object', () => {
    expect(linkOf({ answer: '', source: 'template', link: { route: 'nowhere' } })).toBeNull();
    expect(linkOf({ answer: '', source: 'template', link: { route: '#/leaks', params: { cause: 'refund_unknown' } } })?.href).toBe('#/leaks?cause=refund_unknown');
    expect(tableOf({ rows: [{ a: 1 }] })?.columns).toEqual(['a']);
    expect(tableOf({ contribution_inr: 10, orders: 2 })?.rows).toEqual([
      ['contribution_inr', 10],
      ['orders', 2],
    ]);
    expect(tableOf(null)).toBeNull();
  });
});
