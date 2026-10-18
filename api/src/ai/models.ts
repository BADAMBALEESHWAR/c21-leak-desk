import { logger } from '../logger.js';

// Gemini's free tier allows a few requests a minute per model, and a busy model answers 503. Each model has its own
// quota, so a call that is refused for quota or load moves to the next model in the chain, and the refused model rests
// for a while. The numbers never depend on which model answered: the engine computes them and the guard checks them.

const FALLBACKS = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.7-flash'];
// 400 "invalid argument" too: models differ in the settings they accept, and the next one may take the request.
const RETRYABLE = /\b(429|500|502|503|504|404)\b|quota|rate limit|overloaded|high demand|unavailable|no longer available|not found|invalid argument/i;
const resting = new Map<string, number>();

/** The models to try, in order: GEMINI_MODELS (comma-separated) or GEMINI_MODEL followed by the fast fallbacks. */
export function modelChain(): string[] {
  const list = process.env.GEMINI_MODELS
    ? process.env.GEMINI_MODELS.split(',')
    : [process.env.GEMINI_MODEL || 'gemini-3.5-flash', ...FALLBACKS];
  return [...new Set(list.map((m) => m.trim()).filter(Boolean))];
}

/** Runs `call` on the first model that accepts it; quota and load errors move on, other errors are thrown at once. */
export async function withFallback<T>(call: (model: string) => Promise<T>): Promise<T> {
  const chain = modelChain();
  const now = Date.now();
  const awake = chain.filter((m) => (resting.get(m) ?? 0) <= now);
  let last: unknown = new Error('no model available');
  for (const model of awake.length ? awake : chain) {
    try {
      return await call(model);
    } catch (err) {
      last = err;
      const msg = String((err as Error)?.message ?? err);
      if (!RETRYABLE.test(msg)) throw err;
      resting.set(model, Date.now() + (/429|quota|rate limit/i.test(msg) ? 60_000 : 20_000));
      logger.warn({ model, err: msg.slice(0, 160) }, 'ai model unavailable; trying the next');
    }
  }
  throw last;
}

/** Test hook: forget which models are resting. */
export function resetModelRest() {
  resting.clear();
}
