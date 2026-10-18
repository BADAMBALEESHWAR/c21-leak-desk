import { createHash } from 'node:crypto';
import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai';
import { z } from 'zod';
import { config } from '../config.js';
import { dbState } from '../db.js';
import { logger } from '../logger.js';
import { AiCacheModel } from '../models/index.js';
import { LANGUAGE_NAMES, type Lang } from './templates.js';
import { recordAi } from './guardlog.js';

// Optional narration (Blueprint §13). The engine decides; the model may only reword a template sentence.

export const PROMPT_VERSION = 'c21-narrate-2';
export const TIMEOUT_MS = 6000;
export const MAX_CALLS_PER_ANALYSIS = 4;
const DAILY_CAP = Number(process.env.AI_DAILY_CAP ?? 200);

export const SYSTEM_PROMPT = `You write short, plain-language explanations of order contribution leaks for the operator of a small Indian D2C brand.
You receive ONE leak group or ONE recommendation as JSON computed by a deterministic engine, together with a
template sentence that is already correct. Your only job is to make that sentence clearer and more natural.
Rules:
1. Use ONLY the numbers in the input. Never compute, round, convert or add figures. Copy rupee amounts exactly.
2. Never invent order IDs, products, channels, customers or causes not present in the input.
3. Do not say that advertising caused sales. Attribution is allocation, not causation.
4. Do not use the words profit, net profit or margin; say contribution.
5. If any required field is missing, return {"error":"insufficient_data"} and nothing else.
6. Output valid JSON matching the schema. No markdown, no preamble. Max 45 words per field.
7. Reply in the language the request names. Keep every number in Latin digits (0-9), exactly as given.`;

export const NarrationSchema = z
  .object({
    headline: z.string().min(1).max(80),
    what_is_happening: z.string().min(1),
    why_it_costs_contribution: z.string().min(1),
    recommended_change: z.string().min(1),
    expected_effect: z.string().min(1),
    confidence: z.enum(['high', 'low', 'unknown']),
  })
  .strict();
export type NarrationOutput = z.infer<typeof NarrationSchema>;

const RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    headline: { type: SchemaType.STRING },
    what_is_happening: { type: SchemaType.STRING },
    why_it_costs_contribution: { type: SchemaType.STRING },
    recommended_change: { type: SchemaType.STRING },
    expected_effect: { type: SchemaType.STRING },
    confidence: { type: SchemaType.STRING, enum: ['high', 'low', 'unknown'] },
  },
  required: ['headline', 'what_is_happening', 'why_it_costs_contribution', 'recommended_change', 'expected_effect', 'confidence'],
};

export interface NarrationInput {
  kind: 'leak' | 'recommendation';
  data: Record<string, unknown>;
  /** The template sentence, already in the requested language. */
  template: string;
  /** Reply language; English when absent. */
  lang?: Lang;
}

/** The user message: "Reply in {language}." and the engine's JSON. */
export function userPrompt(input: NarrationInput): string {
  return `Reply in ${LANGUAGE_NAMES[input.lang ?? 'en']}.\n${JSON.stringify({ input: input.data, template: input.template })}`;
}

export interface Narration {
  text: string;
  source: 'template' | 'ai';
  reason?: string;
}

/** Anything that turns (system, user) into raw model text; stubbed in tests. */
export interface ModelClient {
  model: string;
  generate(system: string, user: string): Promise<string>;
}

const BANNED = /\b(net profit|profit|margin|caused|drove sales)\b/i;
/** The same banned ideas in Hindi and Telugu (no \b: word boundaries are ASCII-only in JS). */
const BANNED_INDIC = /(लाभ|मुनाफ़ा|मुनाफा|मार्जिन|లాభం|మార్జిన్)/;
/** Devanagari and Telugu digits: numbers must stay in the Latin digits the engine produced. */
const NATIVE_DIGITS = /[०-९౦-౯]/;
const URL = /\bhttps?:\/\/\S+/gi;

function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ''));
}

/** Guardrails in code (§13.6). Returns the narration or the reason it was discarded. */
export function guard(raw: string, input: NarrationInput): { ok: true; value: NarrationOutput } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'malformed_json' };
  }
  if (parsed && typeof parsed === 'object' && 'error' in parsed) return { ok: false, reason: 'insufficient_data' };
  const result = NarrationSchema.safeParse(parsed);
  if (!result.success) return { ok: false, reason: 'schema_mismatch' };
  const value = Object.fromEntries(Object.entries(result.data).map(([k, v]) => [k, typeof v === 'string' ? v.replace(URL, '').trim() : v])) as NarrationOutput;
  const allowed = new Set(numbersIn(JSON.stringify(input.data) + ' ' + input.template));
  const text = Object.values(value).join(' ');
  if (NATIVE_DIGITS.test(text)) return { ok: false, reason: 'native_digits' };
  for (const n of numbersIn(text)) if (!allowed.has(n)) return { ok: false, reason: `foreign_number:${n}` };
  if (BANNED.test(text) || BANNED_INDIC.test(text)) return { ok: false, reason: 'banned_word' };
  return { ok: true, value };
}

export function compose(kind: NarrationInput['kind'], n: NarrationOutput): string {
  return kind === 'leak' ? `${n.headline}. ${n.what_is_happening} ${n.why_it_costs_contribution}` : `${n.headline}. ${n.what_is_happening} ${n.expected_effect}`;
}

function geminiClient(): ModelClient | null {
  if (config.aiDisabled || !process.env.GEMINI_API_KEY) return null;
  const name = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: name,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, maxOutputTokens: 500 },
  });
  return { model: name, generate: async (_system, user) => (await model.generateContent(user)).response.text() };
}

// Cache and quota: memory always, Mongo ai_cache (TTL 7 days) when connected.
const memoryCache = new Map<string, NarrationOutput>();
let day = new Date().toISOString().slice(0, 10);
let callsToday = 0;
let lastFailureAt = 0;

export function aiStatus(): 'ok' | 'disabled' | 'degraded' {
  if (config.aiDisabled || !process.env.GEMINI_API_KEY) return 'disabled';
  return Date.now() - lastFailureAt < 5 * 60_000 ? 'degraded' : 'ok';
}

async function cacheGet(key: string): Promise<NarrationOutput | null> {
  const hit = memoryCache.get(key);
  if (hit) return hit;
  if (dbState() !== 'connected') return null;
  const doc = (await AiCacheModel.findById(key).lean().catch(() => null)) as { output?: NarrationOutput } | null;
  return doc?.output ?? null;
}

async function cacheSet(key: string, model: string, output: NarrationOutput) {
  memoryCache.set(key, output);
  if (dbState() === 'connected') {
    await AiCacheModel.updateOne({ _id: key }, { model, prompt_version: PROMPT_VERSION, output, created_at: new Date() }, { upsert: true }).catch(() => undefined);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref())]);
}

/** Never throws: any failure returns the template text with source "template". */
export async function narrate(input: NarrationInput, client: ModelClient | null = geminiClient()): Promise<Narration> {
  const template = { text: input.template, source: 'template' as const };
  if (!client) return { ...template, reason: 'disabled' };
  const key = createHash('sha256').update(JSON.stringify(input) + client.model + PROMPT_VERSION).digest('hex');
  const cached = await cacheGet(key);
  if (cached) return { text: compose(input.kind, cached), source: 'ai', reason: 'cache' };

  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    callsToday = 0;
  }
  if (callsToday >= DAILY_CAP) return { ...template, reason: 'quota' };
  callsToday++;

  const started = Date.now();
  try {
    const raw = await withTimeout(client.generate(SYSTEM_PROMPT, userPrompt(input)), TIMEOUT_MS);
    const checked = guard(raw, input);
    recordAi('narration', 'call');
    recordAi('narration', checked.ok ? 'accepted' : 'rejected');
    logger.info({ model: client.model, ai_ms: Date.now() - started, guard: checked.ok ? 'pass' : checked.reason }, 'ai narration');
    if (!checked.ok) return { ...template, reason: checked.reason };
    await cacheSet(key, client.model, checked.value);
    return { text: compose(input.kind, checked.value), source: 'ai' };
  } catch (err) {
    lastFailureAt = Date.now();
    recordAi('narration', 'call');
    recordAi('narration', 'error');
    const reason = (err as Error).message === 'timeout' ? 'timeout' : /429|quota|rate/i.test((err as Error).message) ? 'quota' : 'error';
    logger.warn({ model: client.model, ai_ms: Date.now() - started, err: (err as Error).message }, 'ai narration failed; template used');
    if (reason !== 'error') scheduleRetry(key, input, client);
    return { ...template, reason };
  }
}

/** §13.2: one background retry after a timeout or 429, 20 s later; a good answer fills the cache for next time. */
export const RETRY_DELAY_MS = 20_000;
const pendingRetries = new Set<string>();

function scheduleRetry(key: string, input: NarrationInput, client: ModelClient) {
  if (pendingRetries.has(key)) return;
  pendingRetries.add(key);
  setTimeout(async () => {
    try {
      const raw = await withTimeout(client.generate(SYSTEM_PROMPT, userPrompt(input)), TIMEOUT_MS);
      const checked = guard(raw, input);
      if (checked.ok) await cacheSet(key, client.model, checked.value);
      logger.info({ model: client.model, guard: checked.ok ? 'pass' : checked.reason }, 'ai background retry');
    } catch (err) {
      logger.warn({ model: client.model, err: (err as Error).message }, 'ai background retry failed; template stays');
    } finally {
      pendingRetries.delete(key);
    }
  }, RETRY_DELAY_MS).unref();
}
