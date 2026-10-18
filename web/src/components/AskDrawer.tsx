import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, isNotFound, toErrorInfo } from '../api/client';
import type { AskAnswer } from '../api/types';
import { ASK_EVENT, type AskEventDetail } from '../lib/ask';
import { formatCount, formatInr } from '../lib/format';
import { hrefFor, ROUTES, type Route } from '../lib/router';
import { recognitionCtor, speechLang, synthesis, transcriptOf, useVoices, voiceFor, type Recognition } from '../lib/speech';
import { useStore } from '../state/store';
import { AiBadge } from './AiBadge';
import { Button } from './Button';
import { Drawer } from './Drawer';
import { Icon } from './Icon';

interface Turn {
  id: number;
  question: string;
  /** The UI language the question was asked in; the answer comes back in it. */
  lang: string;
  answer: AskAnswer | null;
  error: string | null;
}

const isRoute = (s: string): s is Route => (ROUTES as readonly string[]).includes(s);

/** "Open in Ledger": the answer's route with its filters, or null when the route is not a screen. */
export function linkOf(a: AskAnswer): { href: string; route: Route } | null {
  const l = a.link;
  if (!l || typeof l.route !== 'string') return null;
  const name = l.route.replace(/^#?\/?/, '').split(/[/?]/)[0];
  if (!isRoute(name)) return null;
  const p = l.params ?? {};
  return { route: name, href: hrefFor(name, { cause: p.cause, channel: p.channel, product: p.product, month: p.month }) };
}

/** A tool result as rows and columns: an array of objects, {rows: […]}, or one object as key / value pairs. */
export function tableOf(result: unknown): { columns: string[]; rows: unknown[][] } | null {
  let list: unknown = result;
  if (list && typeof list === 'object' && !Array.isArray(list)) {
    const o = list as Record<string, unknown>;
    const inner = Array.isArray(o.rows) ? o.rows : Array.isArray(o.items) ? o.items : null;
    if (inner) list = inner;
    else {
      const entries = Object.entries(o).filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v));
      return entries.length ? { columns: ['', ''], rows: entries.map(([k, v]) => [k, v]) } : null;
    }
  }
  if (!Array.isArray(list) || list.length === 0) return null;
  const objects = list.filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object' && !Array.isArray(r));
  if (objects.length === 0) return null;
  const columns = Object.keys(objects[0]).slice(0, 6);
  return { columns, rows: objects.slice(0, 10).map((r) => columns.map((c) => r[c])) };
}

function cellText(column: string, v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return /_inr$|inr$/.test(column) ? formatInr(v) : formatCount(v);
  if (typeof v === 'boolean') return v ? '✓' : '—';
  return String(v);
}

function ResultTable({ result, caption }: { result: unknown; caption: string }) {
  const tbl = tableOf(result);
  if (!tbl) return null;
  const keyValue = tbl.columns.length === 2 && tbl.columns[0] === '';
  return (
    <div className="table-scroll ask-table-wrap">
      <table className="table ask-table">
        <caption className="visually-hidden">{caption}</caption>
        {keyValue ? null : (
          <thead>
            <tr>
              {tbl.columns.map((c) => (
                <th key={c} scope="col" className={/inr|count|orders|pct/.test(c) ? 'r' : undefined}>
                  {c.replace(/_/g, ' ')}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {tbl.rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => {
                const col = keyValue ? String(r[0]) : tbl.columns[j];
                const text = keyValue && j === 0 ? String(v).replace(/_/g, ' ') : cellText(col, v);
                return j === 0 ? (
                  <th key={j} scope="row">
                    {text}
                  </th>
                ) : (
                  <td key={j} className={typeof v === 'number' ? 'r num' : undefined}>
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Ask Profyn": a floating button on every app screen and a chat drawer. Answers come from engine tools; AI only words them. */
export function AskDrawer() {
  const { t, i18n } = useTranslation();
  const { analysis } = useStore();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const lang = i18n.resolvedLanguage ?? i18n.language ?? 'en';

  // Voice: the browser's speech recognition for questions, speech synthesis for answers.
  const SpeechApi = useMemo(() => recognitionCtor(), []);
  const recRef = useRef<Recognition | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voices = useVoices();
  const [speaking, setSpeaking] = useState<number | null>(null);

  const suggestions = [
    t('ask.q1', 'Which product lost most in September?'),
    t('ask.q2', 'What if return shipping is charged?'),
    t('ask.q3', 'Why is Instagram negative?'),
  ];

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns]);

  // A new dataset starts a new conversation.
  const analysisId = analysis?.analysis_id ?? null;
  useEffect(() => {
    setTurns([]);
  }, [analysisId]);

  /** Sends the question; false when it cannot go now (empty, busy, or no data), so the caller can keep it in the input. */
  const ask = (q: string): boolean => {
    const text = q.trim();
    if (!text || busy || !analysisId) return false;
    const id = ++seq.current;
    setTurns((ts) => [...ts, { id, question: text, lang, answer: null, error: null }]);
    setQuestion('');
    setBusy(true);
    void (async () => {
      try {
        const answer = await api.ask(analysisId, { question: text, lang });
        setTurns((ts) => ts.map((x) => (x.id === id ? { ...x, answer } : x)));
      } catch (err) {
        const message = isNotFound(err)
          ? t('ask.unavailable', 'Ask Profyn is not available on this server yet. Every figure is still on the Ledger, Leaks and Pulse screens.')
          : toErrorInfo(err).message;
        setTurns((ts) => ts.map((x) => (x.id === id ? { ...x, error: message } : x)));
      } finally {
        setBusy(false);
      }
    })();
    return true;
  };
  // Speech and window events call the latest ask (current analysis, busy flag and language).
  const askRef = useRef(ask);
  askRef.current = ask;

  // "Ask about this": any screen dispatches profyn:ask; the drawer opens, fills the question and sends it.
  useEffect(() => {
    const onAsk = (e: Event) => {
      const detail = (e as CustomEvent<AskEventDetail>).detail;
      if (!detail || typeof detail.question !== 'string' || !detail.question.trim()) return;
      setOpen(true);
      if (detail.send !== false && askRef.current(detail.question)) return;
      setQuestion(detail.question);
    };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, []);

  const voiceMessage = (code: string): string | null => {
    switch (code) {
      case 'aborted':
        return null;
      case 'not-allowed':
      case 'service-not-allowed':
        return t('ask.voice.blocked', 'Microphone blocked. Allow it in the browser’s site settings, or type your question.');
      case 'no-speech':
        return t('ask.voice.noSpeech', 'Didn’t catch that. Try again, a little closer to the microphone.');
      case 'audio-capture':
        return t('ask.voice.noMic', 'No microphone found.');
      case 'network':
        return t('ask.voice.network', 'Voice input needs an internet connection.');
      case 'language-not-supported':
        return t('ask.voice.language', 'Voice input is not available in this language in this browser.');
      default:
        return t('ask.voice.failed', 'Voice input stopped. Type your question instead.');
    }
  };

  const stopListening = () => {
    const rec = recRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      rec.abort();
    }
  };

  const startListening = () => {
    if (!SpeechApi || recRef.current) return;
    setVoiceError(null);
    let rec: Recognition;
    try {
      rec = new SpeechApi();
    } catch {
      setVoiceError(t('ask.voice.failed', 'Voice input stopped. Type your question instead.'));
      return;
    }
    rec.lang = speechLang(lang);
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let sent = false;
    rec.onresult = (e) => {
      const { text, final } = transcriptOf(e);
      if (sent) return;
      setQuestion(text);
      if (final && text) {
        sent = true;
        askRef.current(text);
        stopListening();
      }
    };
    rec.onerror = (e) => setVoiceError(voiceMessage(e.error));
    rec.onend = () => {
      if (recRef.current === rec) recRef.current = null;
      setListening(false);
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      setVoiceError(t('ask.voice.failed', 'Voice input stopped. Type your question instead.'));
    }
  };

  const speak = (turn: Turn, text: string) => {
    const s = synthesis();
    if (!s) return;
    s.cancel();
    if (speaking === turn.id) {
      setSpeaking(null);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = speechLang(turn.lang);
    const voice = voiceFor(turn.lang, voices);
    if (voice) u.voice = voice;
    const done = () => setSpeaking((id) => (id === turn.id ? null : id));
    u.onend = done;
    u.onerror = done;
    setSpeaking(turn.id);
    s.speak(u);
  };

  // Closing the drawer (or leaving the app) stops the microphone and the voice.
  useEffect(() => {
    if (open) return undefined;
    recRef.current?.abort();
    recRef.current = null;
    setListening(false);
    setVoiceError(null);
    if (speaking !== null) {
      synthesis()?.cancel();
      setSpeaking(null);
    }
    return undefined;
  }, [open]);
  useEffect(
    () => () => {
      recRef.current?.abort();
      synthesis()?.cancel();
    },
    [],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (listening) stopListening();
    ask(question);
  };

  return (
    <>
      <button type="button" className={`ask-fab${open ? ' is-open' : ''}`} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
        <Icon name="sparkles" size={18} strokeWidth={2} />
        <span>{t('ask.open', 'Ask Profyn')}</span>
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={t('ask.title', 'Ask Profyn')}
        meta={<span className="muted small">{t('ask.meta', 'Answers come from the engine’s tables; AI only puts them into words.')}</span>}
      >
        <div className="ask">
          {!analysisId ? (
            <p className="ask-empty">
              {t('ask.needData', 'Load data first: questions are answered from your analysis.')}{' '}
              <a href={hrefFor('import')} onClick={() => setOpen(false)}>
                {t('ask.goImport', 'Go to Import')}
              </a>
            </p>
          ) : null}

          {turns.length === 0 && analysisId ? (
            <div className="ask-suggest" role="group" aria-label={t('ask.suggested', 'Suggested questions')}>
              <p className="mini-title">{t('ask.suggested', 'Suggested questions')}</p>
              {suggestions.map((s) => (
                <button key={s} type="button" className="ask-chip" onClick={() => ask(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          ) : null}

          <ol className="ask-log" aria-live="polite">
            {turns.map((turn) => {
              const a = turn.answer;
              const link = a ? linkOf(a) : null;
              const canSpeak = Boolean(a?.answer) && synthesis() !== null && voiceFor(turn.lang, voices) !== null;
              return (
                <li key={turn.id} className="ask-turn">
                  <p className="ask-q">{turn.question}</p>
                  {turn.error ? (
                    <p className="ask-a ask-error" role="alert">
                      {turn.error}
                    </p>
                  ) : !a ? (
                    <p className="ask-a ask-thinking" role="status">
                      <span className="spinner" aria-hidden="true" /> {t('ask.thinking', 'Looking it up…')}
                    </p>
                  ) : (
                    <div className={`ask-a${a.rejected ? ' is-rejected' : ''}`}>
                      <p>{a.answer}</p>
                      {a.source === 'table' && a.result !== undefined ? <ResultTable result={a.result} caption={turn.question} /> : null}
                      <div className="ask-meta">
                        <AiBadge source={a.source} compact />
                        {a.tool?.name ? (
                          <span className="ask-tool" title={a.tool.args ? JSON.stringify(a.tool.args) : undefined}>
                            {t('ask.tool', 'Tool')}: <code>{a.tool.name}</code>
                          </span>
                        ) : null}
                        {link ? (
                          <a className="ask-link" href={link.href} onClick={() => setOpen(false)}>
                            {t('ask.openIn', 'Open in {{screen}}', { screen: t(`nav.${link.route}`) })} <Icon name="arrow-right" size={14} />
                          </a>
                        ) : null}
                        {canSpeak ? (
                          <button
                            type="button"
                            className={`ask-speak${speaking === turn.id ? ' is-speaking' : ''}`}
                            onClick={() => speak(turn, a.answer)}
                            aria-label={speaking === turn.id ? t('ask.stopReading', 'Stop reading') : t('ask.readAloud', 'Read answer aloud')}
                            title={speaking === turn.id ? t('ask.stopReading', 'Stop reading') : t('ask.readAloud', 'Read answer aloud')}
                          >
                            <Icon name={speaking === turn.id ? 'stop' : 'volume'} size={15} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <div ref={endRef} />

          <form className="ask-form" onSubmit={submit}>
            {listening ? (
              <p className="ask-voice-status" role="status">
                <span className="ask-voice-dot" aria-hidden="true" />
                {t('ask.voice.listening', 'Listening…')}
              </p>
            ) : voiceError ? (
              <p className="ask-voice-status is-error" role="alert">
                <Icon name="alert-triangle" size={14} />
                {voiceError}
              </p>
            ) : null}
            <label className="visually-hidden" htmlFor={inputId}>
              {t('ask.label', 'Your question')}
            </label>
            <input
              id={inputId}
              className="input"
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={listening ? t('ask.voice.listening', 'Listening…') : t('ask.placeholder', 'Ask about orders, products, channels or months')}
              disabled={!analysisId}
              autoComplete="off"
            />
            {SpeechApi ? (
              <button
                type="button"
                className={`ask-mic${listening ? ' is-listening' : ''}`}
                onClick={listening ? stopListening : startListening}
                disabled={!analysisId || (busy && !listening)}
                aria-label={listening ? t('ask.voice.stop', 'Stop listening') : t('ask.voice.start', 'Ask by voice')}
                title={listening ? t('ask.voice.stop', 'Stop listening') : t('ask.voice.start', 'Ask by voice')}
              >
                <Icon name={listening ? 'stop' : 'mic'} size={18} />
              </button>
            ) : null}
            <Button type="submit" variant="primary" iconRight="arrow-right" disabled={!analysisId || busy || !question.trim()}>
              {t('ask.send', 'Ask')}
            </Button>
          </form>
        </div>
      </Drawer>
    </>
  );
}
