// @vitest-environment jsdom
// Voice and sharing: the mic button appears only where the browser has speech recognition, listens in the UI language,
// shows what it hears and sends the final transcript; "Read answer aloud" needs a voice for the language; a profyn:ask
// event opens Ask Profyn and sends the question; the share text carries the engine's numbers, stays within 700
// characters and goes to wa.me encoded; the Overview shows the AI briefing and copies the summary with a toast.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyze } from '../api/src/engine/analyze';
import type { AnalysisResponse, Autopilot, Digest } from '../web/src/api/types';
import { i18n, setLanguage } from '../web/src/i18n';
import { FIXTURE, rows } from './helpers';

const h = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));

vi.mock('../web/src/auth/AuthContext', () => ({
  useAuth: () => ({ ready: true, mode: 'demo', config: { enabled: false }, user: null, hasSession: false, sessionEnded: false, signOut: () => undefined, loginUrl: '/login/', backToWorkspace: () => undefined }),
}));

vi.mock('../web/src/state/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../web/src/state/store')>();
  return { ...actual, useStore: () => h.store };
});

import { AskDrawer } from '../web/src/components/AskDrawer';
import { askProfyn } from '../web/src/lib/ask';
import { formatInr, formatSignedInr } from '../web/src/lib/format';
import { appUrl, SHARE_MAX, shareText, whatsappUrl } from '../web/src/lib/share';
import { FALLBACK_SAMPLES } from '../web/src/state/store';
import { clearAutopilotCache, OverviewScreen } from '../web/src/screens/OverviewScreen';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Call = { url: string; method: string; body: Record<string, unknown> | undefined };

function stubFetch(handler: (url: string, method: string, body: Record<string, unknown> | undefined) => Response): Call[] {
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

const answer = (text: string) => json({ answer: text, source: 'template', tool: { name: 'leaks' }, result: null, link: null, rejected: null });

// ---- Browser speech stubs ----------------------------------------------------------------------------------------------

class StubRecognition {
  static last: StubRecognition | null = null;
  lang = '';
  interimResults = false;
  continuous = true;
  maxAlternatives = 0;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  constructor() {
    StubRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
}

/** One recognition result, as the browser sends it: results[i][0].transcript and results[i].isFinal. */
const heard = (text: string, isFinal: boolean) => ({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] });

type W = Window & Record<string, unknown>;
const win = () => window as unknown as W;

function stubVoices(langs: string[]) {
  const speak = vi.fn();
  win().speechSynthesis = {
    getVoices: () => langs.map((lang) => ({ lang, name: `Voice ${lang}` })),
    speak,
    cancel: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  win().SpeechSynthesisUtterance = class {
    lang = '';
    voice: unknown = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  };
  return speak;
}

const dialog = () => screen.getByRole('dialog', { name: 'Ask Profyn' });
const openAsk = () => fireEvent.click(screen.getByRole('button', { name: 'Ask Profyn' }));

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '#/overview';
  StubRecognition.last = null;
  h.store = { analysis: { analysis_id: 'a1' } };
  clearAutopilotCache();
  act(() => setLanguage('en'));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const k of ['SpeechRecognition', 'webkitSpeechRecognition', 'speechSynthesis', 'SpeechSynthesisUtterance']) delete win()[k];
});

describe('Ask Profyn by voice', () => {
  it('shows no mic button when the browser has no speech recognition', () => {
    stubFetch(() => answer('—'));
    render(<AskDrawer />);
    openAsk();
    expect(within(dialog()).queryByRole('button', { name: 'Ask by voice' })).toBeNull();
    expect(within(dialog()).getByRole('button', { name: 'Ask' })).toBeTruthy();
  });

  it('listens in the UI language, shows what it hears, and sends the final transcript', async () => {
    win().webkitSpeechRecognition = StubRecognition;
    const calls = stubFetch(() => answer('Full returns lost the most.'));
    render(<AskDrawer />);
    openAsk();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Ask by voice' }));

    const rec = StubRecognition.last!;
    expect(rec.started).toBe(true);
    expect(rec.lang).toBe('en-IN');
    expect(rec.interimResults).toBe(true);
    expect(within(dialog()).getByText('Listening…')).toBeTruthy();
    expect(within(dialog()).getByRole('button', { name: 'Stop listening' })).toBeTruthy();

    act(() => rec.onresult?.(heard('Why are we losing', false)));
    expect((within(dialog()).getByLabelText('Your question') as HTMLInputElement).value).toBe('Why are we losing');
    expect(calls).toHaveLength(0);

    act(() => rec.onresult?.(heard('Why are we losing money on full returns', true)));
    await within(dialog()).findByText('Full returns lost the most.');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: '/api/v1/analyses/a1/ask', method: 'POST', body: { question: 'Why are we losing money on full returns', lang: 'en' } });
    // The browser has stopped listening; the mic is ready again.
    expect(within(dialog()).getByRole('button', { name: 'Ask by voice' })).toBeTruthy();
    expect(within(dialog()).queryByText('Listening…')).toBeNull();
  });

  it('uses te-IN in Telugu, stops on a second click, and explains a blocked microphone', () => {
    win().SpeechRecognition = StubRecognition;
    stubFetch(() => answer('—'));
    act(() => setLanguage('te'));
    render(<AskDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Profynను అడగండి' }));
    const d = screen.getByRole('dialog');
    fireEvent.click(within(d).getByRole('button', { name: 'మాట్లాడి అడగండి' }));
    expect(StubRecognition.last!.lang).toBe('te-IN');
    fireEvent.click(within(d).getByRole('button', { name: 'వినడం ఆపండి' }));
    expect(within(d).getByRole('button', { name: 'మాట్లాడి అడగండి' })).toBeTruthy();

    act(() => setLanguage('en'));
    fireEvent.click(within(d).getByRole('button', { name: 'Ask by voice' }));
    const rec = StubRecognition.last!;
    expect(rec.lang).toBe('en-IN');
    act(() => {
      rec.onerror?.({ error: 'not-allowed' });
      rec.onend?.();
    });
    expect(within(d).getByRole('alert').textContent).toContain('Microphone blocked');
  });

  it('offers "Read answer aloud" only with a voice for the language, and speaks the answer', async () => {
    const speak = stubVoices(['en-IN', 'hi-IN']);
    stubFetch(() => answer('Full returns lost the most.'));
    render(<AskDrawer />);
    openAsk();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Why is Instagram negative?' }));
    await within(dialog()).findByText('Full returns lost the most.');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Read answer aloud' }));
    expect(speak).toHaveBeenCalledTimes(1);
    const u = speak.mock.calls[0][0] as { text: string; lang: string };
    expect(u.text).toBe('Full returns lost the most.');
    expect(u.lang).toBe('en-IN');
    expect(within(dialog()).getByRole('button', { name: 'Stop reading' })).toBeTruthy();
  });

  it('hides "Read answer aloud" when no voice speaks the language', async () => {
    stubVoices(['hi-IN']);
    stubFetch(() => answer('Full returns lost the most.'));
    render(<AskDrawer />);
    openAsk();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Why is Instagram negative?' }));
    await within(dialog()).findByText('Full returns lost the most.');
    expect(within(dialog()).queryByRole('button', { name: 'Read answer aloud' })).toBeNull();
  });
});

describe('Ask about this', () => {
  it('a profyn:ask event opens the drawer, fills and sends the question', async () => {
    const calls = stubFetch(() => answer('Discounts deeper than margin lost ₹ 120.'));
    render(<AskDrawer />);
    expect(dialog().getAttribute('data-open')).toBe('false');
    act(() => askProfyn('How do I fix discounts deeper than margin?'));
    expect(dialog().getAttribute('data-open')).toBe('true');
    await within(dialog()).findByText('Discounts deeper than margin lost ₹ 120.');
    expect(within(dialog()).getByText('How do I fix discounts deeper than margin?')).toBeTruthy();
    expect(calls[0].body).toEqual({ question: 'How do I fix discounts deeper than margin?', lang: 'en' });
  });

  it('with send: false only fills the input', () => {
    const calls = stubFetch(() => answer('—'));
    render(<AskDrawer />);
    act(() => window.dispatchEvent(new CustomEvent('profyn:ask', { detail: { question: 'Which channel is losing money?', send: false } })));
    expect(dialog().getAttribute('data-open')).toBe('true');
    expect((within(dialog()).getByLabelText('Your question') as HTMLInputElement).value).toBe('Which channel is losing money?');
    expect(calls).toHaveLength(0);
  });
});

// ---- Share ------------------------------------------------------------------------------------------------------------

const digest: Digest = {
  sections: [
    { key: 'changed', title: 'What changed', text: 'In 2026-09, 20 orders brought ₹ 14,400 net sales and ₹ 6,000 contribution.' },
    { key: 'leaked', title: 'Where money leaked', text: 'Most money leaked through Full return, partial recovery: 4 orders, ₹ 720.' },
    { key: 'decided', title: 'What was decided', text: "No decision saved yet. The engine's top fix is Charge return shipping (₹ 200)." },
    { key: 'check', title: 'What to check in 30 days', text: 'For 30 days, charge ₹ 50 return shipping on every return and track the return rate. '.repeat(6) },
  ],
  source: 'template',
  badge: 'Summary · numbers from the engine',
};

const actions = [
  { label: 'Charge return shipping', delta: 200 },
  { label: 'Raise recovery via inspection', delta: 40 },
  { label: 'Cap discount', delta: 0 },
];

describe('Share summary', () => {
  it('carries the engine numbers, fits in 700 characters, ends with the app link, and encodes the wa.me URL', () => {
    const url = appUrl(true);
    expect(url).toBe(`${window.location.origin}/app/?mode=demo`);
    expect(appUrl(false)).toBe(`${window.location.origin}/app/`);
    const text = shareText({ t: i18n.t, heading: 'Profyn summary', contribution: 6000, actions, digest, url });
    expect(text.length).toBeLessThanOrEqual(SHARE_MAX);
    expect(text).toContain(`Operational contribution: ${formatInr(6000)}`);
    expect(text).toContain(`1. Charge return shipping: ${formatSignedInr(200)}`);
    expect(text).toContain(`2. Raise recovery via inspection: ${formatSignedInr(40)}`);
    expect(text).toContain('What changed: In 2026-09');
    expect(text.endsWith(`\n${url}`)).toBe(true);
    expect(text).not.toMatch(/\+91|\butm_/);

    const wa = whatsappUrl(text);
    expect(wa.startsWith('https://wa.me/?text=')).toBe(true);
    expect(wa).not.toMatch(/[\s₹]/);
    expect(decodeURIComponent(wa.slice('https://wa.me/?text='.length))).toBe(text);
  });

  it('is written in the UI language', () => {
    act(() => setLanguage('hi'));
    const text = shareText({ t: i18n.t, heading: i18n.t('share.heading'), contribution: 6000, actions, digest: null, url: appUrl(true) });
    expect(text).toContain(`ऑपरेशनल कंट्रिब्यूशन: ${formatInr(6000)}`);
    expect(text.startsWith('Profyn सारांश')).toBe(true);
  });
});

// ---- Overview: AI briefing, share buttons, Ask about this ------------------------------------------------------------

function doc(): Autopilot {
  return {
    autopilot_id: 'ap1',
    dataset_id: 'd1',
    analysis_id: 'a1',
    status: 'done',
    stages: { analysis: 'done', leaks: 'done', scenarios: 'done', margins: 'done', pulse: 'done', explanations: 'done' },
    headline: { contribution_inr: 6000, net_sales_inr: 14400, orders: 20, unknown_orders: 0, partial: false, margins: null },
    top_leaks: [{ cause: 'full_return_partial_recovery', label: 'Full return, partial recovery', orders: 4, inr_at_stake: 720 }],
    actions: [
      { rank: 1, candidate_id: 'c1', intervention: 'charge_return_shipping', label: 'Charge return shipping', overrides: null, expected_delta_inr: 200, confidence: 'high', explanation: { text: 'Returns ship free today.', source: 'template' }, decision_draft: null },
      { rank: 2, candidate_id: 'c2', intervention: 'raise_recovery_via_inspection', label: 'Raise recovery via inspection', overrides: null, expected_delta_inr: 40, confidence: 'low', explanation: null, decision_draft: null },
    ],
  };
}

function overviewStore(analysis: AnalysisResponse | null = null) {
  const store = {
    samples: FALLBACK_SAMPLES,
    dataset: null,
    datasetId: 'd1',
    analysis,
    analysing: false,
    setOverrides: vi.fn(),
    showToast: vi.fn(),
    markDecisionSaved: vi.fn(),
    runAnalysis: vi.fn(),
  };
  h.store = store;
  return store;
}

describe('Overview: AI briefing and share', () => {
  it('shows the briefing above the headline, actions before leaks, and shares and copies the summary', async () => {
    const calls = stubFetch((url, method) => {
      if (method === 'POST' && url === '/api/v1/datasets/d1/autopilot') return json(doc());
      if (url === '/api/v1/analyses/a1/digest?lang=en') return json(digest);
      return json({ error: { code: 'not_found', message: 'nope' } }, 404);
    });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const store = overviewStore();
    const { container } = render(<OverviewScreen />);

    const brief = await screen.findByRole('region', { name: 'AI briefing' });
    await within(brief).findByText('What changed');
    expect(within(brief).getByText('Summary · numbers from the engine')).toBeTruthy();
    expect(calls.some((c) => c.url === '/api/v1/analyses/a1/digest?lang=en')).toBe(true);

    // Order: briefing → headline → top 3 actions → top leaks.
    const order = ['.ov-brief', '.ov-headline', '#ov-actions-title', '#ov-leaks-title'].map((sel) => container.querySelector(sel)!);
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const wa = await screen.findByRole('link', { name: 'Share on WhatsApp' });
    const href = wa.getAttribute('href') ?? '';
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    expect(wa.getAttribute('target')).toBe('_blank');
    const text = decodeURIComponent(href.slice('https://wa.me/?text='.length));
    expect(text).toContain(formatInr(6000));
    expect(text).toContain(formatSignedInr(200));
    expect(text.length).toBeLessThanOrEqual(700);

    fireEvent.click(screen.getByRole('button', { name: 'Copy summary' }));
    await waitFor(() => expect(store.showToast).toHaveBeenCalledWith('Summary copied', 'success'));
    expect(writeText).toHaveBeenCalledWith(text);
  });

  it('hides the briefing when the server has no digest', async () => {
    stubFetch((url, method) => (method === 'POST' && url.endsWith('/autopilot') ? json(doc()) : json({}, 404)));
    overviewStore();
    render(<OverviewScreen />);
    await screen.findByRole('heading', { name: 'Charge return shipping' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'AI briefing' })).toBeNull());
  });

  it('"Ask AI" on a card asks Profyn a plain question without figures', async () => {
    const calls = stubFetch((url, method) => {
      if (method === 'POST' && url.endsWith('/autopilot')) return json(doc());
      if (url.endsWith('/ask')) return answer('Contribution is net sales minus costs.');
      return json({}, 404);
    });
    overviewStore({ ...(analyze(rows(FIXTURE), { attribution: 'allocate' }) as unknown as AnalysisResponse), analysis_id: 'a1', dataset_id: 'd1' });
    render(
      <>
        <OverviewScreen />
        <AskDrawer />
      </>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Ask Profyn about Full return, partial recovery' }));
    await screen.findByText('Contribution is net sales minus costs.');
    expect(calls.find((c) => c.url.endsWith('/ask'))?.body).toEqual({ question: 'Why are we losing money on full returns?', lang: 'en' });

    fireEvent.click(screen.getByRole('button', { name: 'Ask Profyn about Operational contribution' }));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/ask'))).toHaveLength(2));
    const q = calls.filter((c) => c.url.endsWith('/ask'))[1].body?.question as string;
    expect(q).toBe('Explain operational contribution');
    expect(q).not.toMatch(/\d/);
  });
});
