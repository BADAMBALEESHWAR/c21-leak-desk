import { describeLeak } from '../ai/templates.js';
import { computeLedger, type LedgerOptions } from '../engine/ledger.js';
import { applyCandidate } from '../engine/scenario.js';
import type { OrderRow } from '../engine/types.js';

// Statistical confidence for a fix. The engine gives the exact rupee change on the orders as they are; this asks
// "how sure are we that it would repeat?" with a bootstrap: resample the orders with replacement 1,000 times, add up
// each fix's per-order gains in every resample, and read the 95% range and the share of resamples that gain money.
// It never changes a number the engine produced; it adds a range and a plain-language level around it.

export type EvidenceLevel = 'high' | 'medium' | 'low';
export type CandidateKey = 'raise_recovery_via_inspection' | 'charge_return_shipping' | 'cap_discount' | 'add_handling_to_price';

export interface Evidence {
  level: EvidenceLevel;
  /** The engine's exact rupee change on these orders. */
  delta_inr: number;
  /** 95% bootstrap range for the same change. */
  ci_low_inr: number;
  ci_high_inr: number;
  /** Share of resamples in which the fix gains money (0–1). */
  p_positive: number;
  orders_checked: number;
  orders_driving: number;
  /** Orders left out because a fact is missing (never counted as zero). */
  orders_left_out: number;
  method: string;
  reason: string;
}

const KEYS: CandidateKey[] = ['raise_recovery_via_inspection', 'charge_return_shipping', 'cap_discount', 'add_handling_to_price'];

/** Small seeded generator so the same data always gives the same range. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 95% range and P(gain) for per-order gains. Only orders with a non-zero gain differ between draws, so each resample counts how often they are drawn. */
export function bootstrap(gains: number[], total: number, resamples: number, seed: number): { low: number; high: number; p: number } {
  const n = gains.length;
  const nz = gains.filter((g) => g !== 0);
  if (n === 0 || nz.length === 0) return { low: 0, high: 0, p: 0 };
  const rand = rng(seed);
  // A draw of n orders hits a given order a Binomial(n, 1/n) number of times; with Poisson(1) this is exact enough and fast.
  const poisson = () => {
    let k = 0;
    let p = 1;
    const L = Math.exp(-1);
    do {
      k++;
      p *= rand();
    } while (p > L);
    return k - 1;
  };
  const sums: number[] = [];
  let positive = 0;
  for (let b = 0; b < resamples; b++) {
    let s = 0;
    for (const g of nz) s += g * poisson();
    sums.push(s);
    if (s > 0) positive++;
  }
  sums.sort((x, y) => x - y);
  const at = (q: number) => sums[Math.min(sums.length - 1, Math.max(0, Math.floor(q * sums.length)))];
  void total;
  return { low: Math.round(at(0.025)), high: Math.round(at(0.975)), p: positive / resamples };
}

const cache = new Map<string, Record<CandidateKey, Evidence>>();

/** Evidence for every candidate fix on this dataset and analysis options. Memoised by `key` (analysis id). */
export function evidenceFor(key: string, rows: OrderRow[], opts: LedgerOptions): Record<CandidateKey, Evidence> {
  const hit = cache.get(key);
  if (hit) return hit;
  const state = computeLedger(rows, opts, describeLeak);
  const before = new Map(state.orders.map((o) => [o.order_id, o.contribution_inr]));
  const unknown = state.orders.filter((o) => o.contribution_inr === null).length;
  const resamples = state.orders.length > 20000 ? 300 : 1000;
  const out = {} as Record<CandidateKey, Evidence>;
  for (const k of KEYS) {
    const after = computeLedger(applyCandidate(k, state.rows, state.config.handling_default_inr, state.period_end), { ...opts, period_end: state.period_end }, describeLeak);
    const gains: number[] = [];
    let driving = 0;
    for (const o of after.orders) {
      const b = before.get(o.order_id);
      if (b === null || b === undefined || o.contribution_inr === null) continue;
      const g = o.contribution_inr - b;
      gains.push(g);
      if (g !== 0) driving++;
    }
    const delta = gains.reduce((s, g) => s + g, 0);
    const bs = bootstrap(gains, delta, resamples, 1000 + KEYS.indexOf(k) * 7919 + gains.length);
    let level: EvidenceLevel;
    let reason: string;
    if (delta <= 0) {
      level = 'low';
      reason = 'This change does not add money on these orders.';
    } else if (bs.p >= 0.95 && bs.low > 0 && driving >= 30) {
      level = 'high';
      reason = `${driving} orders drive it; in 95% of resamples of your orders it still gains money.`;
    } else if (bs.p >= 0.8 && driving >= 10) {
      level = 'medium';
      reason = `${driving} orders drive it; it gains money in ${Math.round(bs.p * 100)}% of resamples, so the size is less certain.`;
    } else {
      level = 'low';
      reason = `Only ${driving} orders drive it, so the result could change with more data.`;
    }
    if (level === 'high' && state.orders.length > 0 && unknown / state.orders.length > 0.1) {
      level = 'medium';
      reason += ` ${unknown} orders have missing facts and are left out.`;
    } else if (unknown > 0) {
      reason += ` ${unknown} order${unknown === 1 ? '' : 's'} with missing facts left out, never counted as zero.`;
    }
    out[k] = {
      level,
      delta_inr: delta,
      ci_low_inr: bs.low,
      ci_high_inr: bs.high,
      p_positive: Math.round(bs.p * 1000) / 1000,
      orders_checked: gains.length,
      orders_driving: driving,
      orders_left_out: unknown,
      method: `bootstrap, ${resamples} resamples, 95% range`,
      reason,
    };
  }
  cache.set(key, out);
  if (cache.size > 100) cache.delete(cache.keys().next().value as string);
  return out;
}
