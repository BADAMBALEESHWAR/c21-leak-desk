import type { Request } from 'express';
import en from './messages.en.json';
import hi from './messages.hi.json';
import te from './messages.te.json';

// User-facing API error text in English, Hindi or Telugu. English is written at the throw site, unchanged; the error
// handler matches it against messages.en.json (keys with {placeholders}) and renders the same key in the caller's
// language. Anything without a key stays in English, so a missing translation never hides an error.

export type MessageLang = 'en' | 'hi' | 'te';
export const MESSAGE_LANGS: MessageLang[] = ['en', 'hi', 'te'];
type Catalog = Record<string, string>;
const CATALOGS: Record<MessageLang, Catalog> = { en, hi, te };

const isLang = (s: string): s is MessageLang => (MESSAGE_LANGS as string[]).includes(s);

/** `?lang=` first, then the highest-weighted supported Accept-Language tag; English by default. */
export function messageLang(req: Pick<Request, 'query' | 'headers'>): MessageLang {
  const q = typeof req.query?.lang === 'string' ? req.query.lang.trim().toLowerCase().split('-')[0] : '';
  if (isLang(q)) return q;
  const header = req.headers['accept-language'];
  if (typeof header !== 'string' || !header) return 'en';
  const ranked = header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const qp = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = qp ? Number(qp.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split('-')[0], q: Number.isFinite(weight) ? weight : 0, i };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  const hit = ranked.find((r) => isLang(r.lang));
  return hit ? (hit.lang as MessageLang) : 'en';
}

const fill = (template: string, params: Record<string, string>) => template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? params[k] : m));

/** The text of `key` in `lang` (English when the key has no translation), with {placeholders} filled. */
export function t(key: string, lang: MessageLang = 'en', params: Record<string, string | number> = {}): string {
  const template = CATALOGS[lang][key] ?? CATALOGS.en[key] ?? key;
  return fill(template, Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));
}

interface Pattern {
  key: string;
  re: RegExp;
  params: string[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function compile(key: string, template: string): Pattern {
  const params: string[] = [];
  const source = template
    .split(/(\{\w+\})/)
    .map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (!m) return escape(part);
      params.push(m[1]);
      return '([\\s\\S]*?)';
    })
    .join('');
  return { key, re: new RegExp(`^${source}$`), params };
}

const entries = Object.entries(CATALOGS.en);
// Sentences first (catalogue order: specific before generic), then reasons longest first.
const SENTENCES = entries.filter(([k]) => k.startsWith('msg.') || k.startsWith('hint.')).map(([k, v]) => compile(k, v));
const REASONS = entries
  .filter(([k]) => k.startsWith('reason.'))
  .sort((a, b) => b[1].length - a[1].length)
  .map(([k, v]) => compile(k, v));
/** Placeholders whose value is itself catalogue text (a nested reason or row problem). */
const NESTED = new Set(['detail', 'reason']);

function translateReason(text: string, lang: MessageLang): string | null {
  for (const p of REASONS) {
    const m = p.re.exec(text);
    if (m) return t(p.key, lang, Object.fromEntries(p.params.map((name, i) => [name, m[i + 1]])));
  }
  return null;
}

/**
 * `text` in `lang` when it matches a catalogue entry, else unchanged. Handles "<path> <reason>" (validation messages)
 * by translating the reason after the path.
 */
export function translate(text: string, lang: MessageLang, depth = 0): string {
  if (lang === 'en' || !text || depth > 2) return text;
  for (const p of SENTENCES) {
    const m = p.re.exec(text);
    if (!m) continue;
    const params = Object.fromEntries(
      p.params.map((name, i) => {
        const value = m[i + 1];
        if (NESTED.has(name)) return [name, translate(value, lang, depth + 1)];
        if (name === 'what' && CATALOGS.en[`noun.${value}`]) return [name, t(`noun.${value}`, lang)];
        return [name, value];
      }),
    );
    return t(p.key, lang, params);
  }
  const whole = translateReason(text, lang);
  if (whole) return whole;
  // "<path> <reason>": the path is a field name and stays as written.
  for (let i = text.indexOf(' '); i > 0; i = text.indexOf(' ', i + 1)) {
    const reason = translateReason(text.slice(i + 1), lang);
    if (reason) return `${text.slice(0, i)} ${reason}`;
  }
  return text;
}
