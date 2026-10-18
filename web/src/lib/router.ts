import { useEffect, useState } from 'react';

export const ROUTES = ['import', 'ledger', 'leaks', 'scenario', 'decision', 'pulse', 'checks', 'changelog', 'report', 'overview', 'trust', 'ai', 'profile'] as const;
export type Route = (typeof ROUTES)[number];

export interface Location {
  route: Route;
  params: URLSearchParams;
  /** The raw hash, used to tell deep links apart. */
  raw: string;
}

function isRoute(s: string): s is Route {
  return (ROUTES as readonly string[]).includes(s);
}

export function parseHash(hash: string): Location {
  const raw = hash.replace(/^#/, '');
  const [pathPart, query = ''] = raw.split('?');
  const name = pathPart.replace(/^\/+/, '').split('/')[0] ?? '';
  return {
    route: isRoute(name) ? name : 'import',
    params: new URLSearchParams(query),
    raw,
  };
}

/** Empty, null and undefined values are left out, so a filter object can be passed as it is. */
export function hrefFor(route: Route, params?: Record<string, string | null | undefined>): string {
  const sp = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') sp.set(k, v);
    }
  }
  const query = sp.toString();
  return query ? `#/${route}?${query}` : `#/${route}`;
}

export function navigate(route: Route, params?: Record<string, string | null | undefined>): void {
  const target = hrefFor(route, params);
  if (window.location.hash !== target) window.location.hash = target;
}

/**
 * One-shot deep-link parameters: they load a sample or open a panel once, and App's handler drops them afterwards.
 * Every other parameter (ledger filters, a Pulse tab, a fix to open) stays in the address so a reload keeps the view.
 */
export const DEEP_LINK_PARAMS = ['load', 'order', 'worked', 'checks', 'about', 'attribution', 'period_end'] as const;

/** The query that remains once the deep-link parameters are taken out. */
export function keptQuery(params: URLSearchParams): string {
  const kept = new URLSearchParams();
  params.forEach((v, k) => {
    if (!(DEEP_LINK_PARAMS as readonly string[]).includes(k)) kept.append(k, v);
  });
  return kept.toString();
}

/**
 * Drop the deep-link parameters from the hash without adding a history entry or firing hashchange.
 * Filter parameters on the same route survive: `#/ledger?load=demo_12m&cause=x` becomes `#/ledger?cause=x`.
 */
export function replaceWithBareRoute(route: Route): void {
  try {
    const current = parseHash(window.location.hash);
    const query = current.route === route ? keptQuery(current.params) : '';
    const hash = `#/${route}${query ? `?${query}` : ''}`;
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${hash}`);
  } catch {
    // Ignore: some embedded browsers block replaceState.
  }
}

export function useHashLocation(): Location {
  const [loc, setLoc] = useState<Location>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setLoc(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    if (!window.location.hash) {
      replaceWithBareRoute('import');
    }
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return loc;
}

// ---- Ledger filters (click-to-cause) ---------------------------------------------------------------

/**
 * Filters a chart, a Pulse row or a leak card can hand to the ledger:
 *   #/ledger?cause=<leak cause>&channel=<c>&product=<p>&month=<YYYY-MM by order date>&payment=<cod|prepaid>&from=<route[.tab]>
 */
export const LEDGER_FILTER_KEYS = ['cause', 'channel', 'product', 'month', 'payment'] as const;
export type LedgerFilterKey = (typeof LEDGER_FILTER_KEYS)[number];

export type LedgerQuery = Partial<Record<LedgerFilterKey | 'from', string>>;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function parseLedgerQuery(params: URLSearchParams): LedgerQuery {
  const q: LedgerQuery = {};
  for (const k of [...LEDGER_FILTER_KEYS, 'from'] as const) {
    const v = params.get(k)?.trim();
    if (v) q[k] = v;
  }
  if (q.month && !MONTH_RE.test(q.month)) delete q.month;
  return q;
}

/** True when the query narrows the orders (the `from` breadcrumb alone does not). */
export function hasLedgerFilter(q: LedgerQuery): boolean {
  return LEDGER_FILTER_KEYS.some((k) => !!q[k]);
}

/** `ledgerHref({ cause: 'full_return_partial_recovery', from: 'leaks' })` → `#/ledger?cause=full_return_partial_recovery&from=leaks` */
export function ledgerHref(q: LedgerQuery): string {
  const ordered: Record<string, string | undefined> = {};
  for (const k of [...LEDGER_FILTER_KEYS, 'from'] as const) ordered[k] = q[k];
  return hrefFor('ledger', ordered);
}

/** `from` is a route, optionally with a Pulse tab after a dot or colon: "leaks", "pulse.months". */
export function parseFrom(from: string | undefined): { route: Route; tab: string | null } | null {
  if (!from) return null;
  const [name, tab] = from.split(/[.:]/);
  if (!isRoute(name)) return null;
  return { route: name, tab: tab || null };
}

/** Where the breadcrumb's back link goes: the route, with its tab when it has one. */
export function fromHref(from: string | undefined): string | null {
  const f = parseFrom(from);
  if (!f) return null;
  return hrefFor(f.route, f.tab ? { tab: f.tab } : undefined);
}

/** The current hash's query, kept in step with hashchange. */
export function useHashParams(): URLSearchParams {
  const [params, setParams] = useState<URLSearchParams>(() => parseHash(window.location.hash).params);
  useEffect(() => {
    const onChange = () => setParams(parseHash(window.location.hash).params);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return params;
}
