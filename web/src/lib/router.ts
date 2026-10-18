import { useEffect, useState } from 'react';

export const ROUTES = ['import', 'ledger', 'leaks', 'scenario', 'decision', 'pulse', 'checks', 'changelog', 'report'] as const;
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

export function hrefFor(route: Route, params?: Record<string, string>): string {
  const query = params ? new URLSearchParams(params).toString() : '';
  return query ? `#/${route}?${query}` : `#/${route}`;
}

export function navigate(route: Route): void {
  const target = hrefFor(route);
  if (window.location.hash !== target) window.location.hash = target;
}

/** Drop the query part of the hash without adding a history entry or firing hashchange. */
export function replaceWithBareRoute(route: Route): void {
  try {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#/${route}`);
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
