import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { FunctionCallingMode, GoogleGenerativeAI, SchemaType, type FunctionDeclaration, type ResponseSchema } from '@google/generative-ai';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { SAMPLE_SOURCES } from '../schema/orders.js';
import type { OrderRow } from '../engine/types.js';
import { recordAi, type AiFeature } from './guardlog.js';
import { withFallback } from './models.js';
import { LANGUAGE_NAMES, type Lang } from './templates.js';

// v2 AI features (Autopilot, Fix Advisor, Ask Profyn, Digest) share this: one model adapter, one policy, one guard.
// The engine computes every number; the model may only reword a template that is already correct. Any figure in the
// model's text that is not in the JSON it was given is a rejection, and the template is used instead.

export const PROMPT_VERSION_V2 = 'profyn-v2-2';
export const TIMEOUT_MS = 6000;
const DAILY_CAP = Number(process.env.AI_DAILY_CAP ?? 200);

/** Anything that can phrase JSON-mode text and (optionally) pick a tool; Gemini in production, a stub in tests. */
export interface AiModel {
  model: string;
  generate(system: string, user: string, schema?: ResponseSchema): Promise<string>;
  chooseTool?(system: string, user: string, tools: FunctionDeclaration[]): Promise<{ name: string; args: Record<string, unknown> } | null>;
}

export const geminiConfigured = () => !(config.aiDisabled || !process.env.GEMINI_API_KEY);
export const modelName = () => process.env.GEMINI_MODEL || 'gemini-3.5-flash';

function gemini(): AiModel | null {
  if (!geminiConfigured()) return null;
  const name = modelName();
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
  // Full Flash models think by default; a zero budget keeps answers inside the 6 s timeout. Lite models reject the
  // setting (400), so they get the plain config.
  const configFor = (model: string) =>
    (/lite/i.test(model) ? { temperature: 0, maxOutputTokens: 1024 } : { temperature: 0, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } }) as Record<string, unknown>;
  return {
    model: name,
    // Each call walks the model chain (models.ts) when a model is out of quota or overloaded.
    generate: (system, user, schema) =>
      withFallback(async (model) => {
        const m = genAI.getGenerativeModel({
          model,
          systemInstruction: system,
          generationConfig: { ...configFor(model), responseMimeType: 'application/json', ...(schema ? { responseSchema: schema } : {}) },
        });
        return (await m.generateContent(user)).response.text();
      }),
    chooseTool: (system, user, tools) =>
      withFallback(async (model) => {
        const m = genAI.getGenerativeModel({
          model,
          systemInstruction: system,
          tools: [{ functionDeclarations: tools }],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.ANY } },
          generationConfig: configFor(model),
        });
        const call = (await m.generateContent(user)).response.functionCalls()?.[0];
        return call ? { name: call.name, args: (call.args ?? {}) as Record<string, unknown> } : null;
      }),
  };
}

// Tests install a stub model here; undefined means "use Gemini when configured".
let testModel: AiModel | null | undefined;
export function setModelForTests(m: AiModel | null | undefined) {
  testModel = m;
  cache.clear();
}

/** AI is configured for this process (a key and not AI_DISABLED, or a test stub). */
export const aiConfigured = () => (testModel !== undefined ? testModel !== null : geminiConfigured());
/** The model the v2 features would call. */
export const activeModelName = () => (testModel ? testModel.model : modelName());

export type PolicyReason = 'disabled' | 'switched_off' | 'consent_off' | 'consent_on' | 'demo_data' | 'customer_data';

/** The user's AI consent when the sign-in layer supplies one (req.user.consent.ai); undefined = default policy. */
export const consentOf = (req: Request): boolean | undefined => {
  const c = (req.user as { consent?: { ai?: unknown } } | undefined)?.consent?.ai;
  return typeof c === 'boolean' ? c : undefined;
};

/** Built-in samples and files whose rows are all labelled synthetic are demo data. */
export function isDemoData(dataset: { source: string; rows: Pick<OrderRow, 'synthetic'>[] }): boolean {
  if ((SAMPLE_SOURCES as readonly string[]).includes(dataset.source)) return true;
  return dataset.rows.length > 0 && dataset.rows.every((r) => r.synthetic === true);
}

/**
 * Per-request AI switch (§5.2): header `X-Profyn-AI: off` or consent.ai === false → templates. With no stated consent,
 * AI is on only for demo data; uploaded customer data needs consent.ai === true.
 */
export function aiPolicy(req: Request, dataset?: { source: string; rows: Pick<OrderRow, 'synthetic'>[] } | null): { allowed: boolean; reason: PolicyReason } {
  if (!aiConfigured()) return { allowed: false, reason: 'disabled' };
  if (String(req.headers['x-profyn-ai'] ?? '').trim().toLowerCase() === 'off') return { allowed: false, reason: 'switched_off' };
  const consent = consentOf(req);
  if (consent === false) return { allowed: false, reason: 'consent_off' };
  if (consent === true) return { allowed: true, reason: 'consent_on' };
  if (dataset && isDemoData(dataset)) return { allowed: true, reason: 'demo_data' };
  return { allowed: false, reason: 'customer_data' };
}

/** The model to use for this request, or null for templates. */
export function modelFor(req: Request, dataset: { source: string; rows: Pick<OrderRow, 'synthetic'>[] } | null): AiModel | null {
  if (!aiPolicy(req, dataset).allowed) return null;
  return testModel !== undefined ? testModel : gemini();
}

// ---- the number-grounding guard -------------------------------------------------------------------------------

const BANNED = /\b(net profit|profit|margin|caused|drove sales)\b/gi;
const BANNED_INDIC = /(लाभ|मुनाफ़ा|मुनाफा|मार्जिन|లాభం|మార్జిన్)/g;
const NATIVE_DIGITS = /[०-९౦-౯]/;
const URL = /\bhttps?:\/\/\S+/gi;

export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '').replace(/^0+(?=\d)/, ''));
}

/**
 * Every figure in `text` must appear in `sources` (the engine JSON and the template it was given). Banned words are
 * allowed only when the sources already use them (a leak label, for example). Returns null when safe, else the reason.
 */
export function ungrounded(text: string, sources: string): string | null {
  if (NATIVE_DIGITS.test(text)) return 'native_digits';
  const allowed = new Set(numbersIn(sources));
  for (const n of numbersIn(text)) if (!allowed.has(n)) return `foreign_number:${n}`;
  const lower = sources.toLowerCase();
  for (const m of [...(text.match(BANNED) ?? []), ...(text.match(BANNED_INDIC) ?? [])]) if (!lower.includes(m.toLowerCase())) return 'banned_word';
  return null;
}

// ---- grounded rewording of template fields --------------------------------------------------------------------

export const SYSTEM_PROMPT_V2 = `You rewrite short texts for the owner of a small Indian D2C brand.
Each field comes with JSON computed by a deterministic engine and a template text that is already correct.
Rewrite each template so it is clearer and more natural. Rules:
1. Use ONLY the numbers in that field's data or template. Never compute, round, convert or add figures. Copy rupee amounts exactly as the template writes them (₹ sign, Indian digit grouping such as ₹ 1,48,425), never as INR.
   Copy names and labels exactly, without underscores.
2. Never invent order IDs, products, channels, customers, months or causes that are not in the input.
3. Do not say that advertising caused sales. Attribution is allocation, not causation.
4. Do not use the words profit, net profit or margin; say contribution.
5. Keep every number in Latin digits (0-9), exactly as given. No markdown, no links.
6. Reply in the language the request names. Return JSON with exactly the same keys as the input fields, at most 70 words each.`;

export interface Phrased {
  text: string;
  source: 'ai' | 'template';
  reason?: string;
}

export type FieldInput = { data: unknown; template: string };

const cache = new Map<string, Record<string, string>>();
const CACHE_LIMIT = 500;
let day = new Date().toISOString().slice(0, 10);
let callsToday = 0;

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref())]);
}

/** Counts a model call against the daily cap; false when the cap is reached. */
export function takeQuota(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    callsToday = 0;
  }
  if (callsToday >= DAILY_CAP) return false;
  callsToday++;
  return true;
}

export const cacheKey = (...parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

export function remember<T>(map: Map<string, T>, key: string, value: T) {
  map.set(key, value);
  if (map.size > CACHE_LIMIT) map.delete(map.keys().next().value as string);
}

/**
 * Rewords several template fields in one model call. Each field is guarded on its own (against its own data and
 * template); a field that fails falls back to its template. Never throws.
 */
export async function phraseFields<K extends string>(feature: AiFeature, model: AiModel | null, fields: Record<K, FieldInput>, lang: Lang): Promise<Record<K, Phrased>> {
  const keys = Object.keys(fields) as K[];
  const templates = (reason: string) => Object.fromEntries(keys.map((k) => [k, { text: fields[k].template, source: 'template' as const, reason }])) as Record<K, Phrased>;
  if (!model || keys.length === 0) return templates('disabled');

  const key = cacheKey(feature, fields, lang, model.model, PROMPT_VERSION_V2);
  let raw: Record<string, unknown> | null = cache.get(key) ?? null;
  const cached = raw !== null;
  if (!raw) {
    if (!takeQuota()) return templates('quota');
    const schema: ResponseSchema = {
      type: SchemaType.OBJECT,
      properties: Object.fromEntries(keys.map((k) => [k, { type: SchemaType.STRING }])),
      required: keys,
    };
    const user = `Reply in ${LANGUAGE_NAMES[lang]}.\n${JSON.stringify({ fields })}`;
    const started = Date.now();
    try {
      const text = await withTimeout(model.generate(SYSTEM_PROMPT_V2, user, schema), TIMEOUT_MS);
      recordAi(feature, 'call');
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('malformed_json');
      raw = parsed as Record<string, unknown>;
      logger.info({ feature, model: model.model, ai_ms: Date.now() - started }, 'ai phrase');
    } catch (err) {
      const msg = (err as Error).message;
      const reason = msg === 'timeout' ? 'timeout' : /429|quota|rate/i.test(msg) ? 'quota' : err instanceof SyntaxError || msg === 'malformed_json' ? 'malformed_json' : 'error';
      if (reason === 'malformed_json') {
        recordAi(feature, 'rejected', keys.length);
      } else {
        recordAi(feature, 'call');
        recordAi(feature, 'error');
      }
      logger.warn({ feature, model: model.model, err: msg }, 'ai phrase failed; template used');
      return templates(reason);
    }
  }

  const out = {} as Record<K, Phrased>;
  let good = 0;
  for (const k of keys) {
    const v = raw[k];
    const f = fields[k];
    if (typeof v !== 'string' || !v.trim() || v.length > 1200) {
      out[k] = { text: f.template, source: 'template', reason: 'schema_mismatch' };
      continue;
    }
    const text = v.replace(URL, '').trim();
    const bad = ungrounded(text, JSON.stringify(f.data) + ' ' + f.template);
    if (bad) out[k] = { text: f.template, source: 'template', reason: bad };
    else {
      out[k] = { text, source: 'ai' };
      good++;
    }
  }
  if (!cached) {
    recordAi(feature, 'accepted', good);
    recordAi(feature, 'rejected', keys.length - good);
    remember(cache, key, raw as Record<string, string>);
  }
  return out;
}
