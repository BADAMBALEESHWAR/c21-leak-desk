import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadCsv } from '../lib/csv';
import './chart.css';

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

export type SeriesTone = 'series-1' | 'series-2' | 'muted' | 'loss' | 'gain' | 'primary' | 'ink' | 'cat-1' | 'cat-2' | 'cat-3' | 'cat-4' | 'cat-5';

export interface LegendItem {
  label: string;
  tone: SeriesTone;
  shape?: 'bar' | 'line' | 'thin';
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

type Cell = string | number | boolean | null | undefined;

/** The chart's numbers as a CSV file: raw values, no formatting. */
export interface ChartCsv {
  filename: string;
  headers: string[];
  rows: Cell[][];
}

interface ChartCardProps {
  title: string;
  subtitle?: ReactNode;
  legend?: LegendItem[];
  table?: ReactNode;
  csv?: ChartCsv;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A compact table for a chart's "Table view": the first column is the row header. */
export function ChartTable({ caption, headers, rows }: { caption: string; headers: ReactNode[]; rows: Array<{ key: string; cells: ReactNode[] }> }) {
  return (
    <div className="table-scroll">
      <table className="table table-compact">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} scope="col" className={i > 0 ? 'r' : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((c, i) =>
                i === 0 ? (
                  <th key={i} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={i} className="r num">
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "CSV": downloads the chart's numbers. */
export function CsvButton({ csv, title }: { csv: ChartCsv; title: string }) {
  const { t } = useTranslation();
  const label = t('chart.csvFor', 'Download CSV: {{title}}', { title });
  return (
    <button type="button" className="chart-csv" onClick={() => downloadCsv(csv.filename, csv.headers, csv.rows)} aria-label={label} title={label}>
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
      {t('chart.csv', 'CSV')}
    </button>
  );
}

/** Card frame for a chart: title, one-line explanation, legend (2+ series), plot, a table view and a CSV export. */
export function ChartCard({ title, subtitle, legend, table, csv, actions, children, className }: ChartCardProps) {
  const { t } = useTranslation();
  const csvButton = csv ? <CsvButton csv={csv} title={title} /> : null;
  return (
    <section className={['card chart-card', className].filter(Boolean).join(' ')} aria-label={title}>
      <header className="chart-head">
        <div>
          <h2 className="card-title">{title}</h2>
          {subtitle ? <p className="card-sub">{subtitle}</p> : null}
        </div>
        {actions || csvButton ? (
          <div className="chart-actions">
            {actions}
            {csvButton}
          </div>
        ) : null}
      </header>
      {legend && legend.length > 1 ? (
        <ul className="legend" aria-label={t('chart.legend', 'Legend')}>
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
          <summary>{t('chart.tableView', 'Table view')}</summary>
          {table}
        </details>
      ) : null}
    </section>
  );
}
