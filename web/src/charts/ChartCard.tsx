import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

/** Width of an element in CSS pixels, so SVG units equal pixels and text stays crisp. */
export function useWidth<T extends HTMLElement>(fallback = 560): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.clientWidth || fallback);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, width];
}

export type SeriesTone = 'series-1' | 'series-2' | 'muted' | 'loss' | 'gain' | 'primary' | 'cat-1' | 'cat-2' | 'cat-3' | 'cat-4' | 'cat-5';

export interface LegendItem {
  label: string;
  tone: SeriesTone;
  shape?: 'bar' | 'line';
}

export interface TipRow {
  label: string;
  value: string;
  tone?: SeriesTone;
}

export interface TipState {
  x: number;
  y: number;
  title: string;
  rows: TipRow[];
}

/** One tooltip, values first. Positioned inside the chart's relative container. */
export function ChartTip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} aria-hidden="true">
      <p className="chart-tip-title">{tip.title}</p>
      {tip.rows.map((r) => (
        <p key={r.label} className="chart-tip-row">
          {r.tone ? <span className={`tip-key tip-key-${r.tone}`} /> : null}
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </p>
      ))}
    </div>
  );
}

interface ChartCardProps {
  title: string;
  subtitle?: ReactNode;
  legend?: LegendItem[];
  table?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Card frame for a chart: title, one-line explanation, legend (2+ series), plot and a table view. */
export function ChartCard({ title, subtitle, legend, table, actions, children, className }: ChartCardProps) {
  return (
    <section className={['card chart-card', className].filter(Boolean).join(' ')} aria-label={title}>
      <header className="chart-head">
        <div>
          <h2 className="card-title">{title}</h2>
          {subtitle ? <p className="card-sub">{subtitle}</p> : null}
        </div>
        {actions ? <div className="chart-actions">{actions}</div> : null}
      </header>
      {legend && legend.length > 1 ? (
        <ul className="legend" aria-label="Legend">
          {legend.map((l) => (
            <li key={l.label}>
              <span className={`legend-key legend-${l.shape ?? 'bar'} tip-key-${l.tone}`} aria-hidden="true" />
              {l.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="chart-body">{children}</div>
      {table ? (
        <details className="chart-table">
          <summary>Table view</summary>
          {table}
        </details>
      ) : null}
    </section>
  );
}
