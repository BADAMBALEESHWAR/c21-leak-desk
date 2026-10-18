import { useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { ChartTip, type SeriesTone, type TipState } from './ChartCard';
import { apiText } from '../lib/apiText';

export interface BarValue {
  series: string;
  value: number | null;
  tone: SeriesTone;
  /** Formatted value shown at the bar tip and in the tooltip. */
  text: string;
}

export interface BarRow {
  key: string;
  label: string;
  sub?: string;
  values: BarValue[];
  emphasis?: boolean;
}

interface Props {
  rows: BarRow[];
  ariaLabel: string;
  /** Room for value labels beyond the longest bar, as a share of the track. */
  labelRoom?: number;
  labelWidth?: number;
  onSelect?: (key: string) => void;
}

/**
 * Horizontal bars from one zero baseline. Thin marks, 4px rounded data-end, square at the
 * baseline; value at the tip; the whole row is the hover/focus target and its tooltip lists
 * every series in that row.
 */
export function BarRows({ rows, ariaLabel, labelRoom = 0.22, labelWidth = 150, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState | null>(null);

  const all = rows.flatMap((r) => r.values.map((v) => v.value).filter((v): v is number => v !== null));
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  // Leave room for the value text on whichever side bars extend.
  const lo = min < 0 ? min * (1 + labelRoom * 1.6) : 0;
  const hi = max > 0 ? max * (1 + labelRoom) : min < 0 ? -min * 0.15 : 1;
  const span = hi - lo || 1;
  const pct = (v: number) => ((v - lo) / span) * 100;
  const zero = pct(0);

  const show = (row: BarRow, x: number, y: number) =>
    setTip({ x, y, title: row.label, rows: row.values.map((v) => ({ label: v.series, value: v.text, tone: v.tone })) });

  const onMove = (row: BarRow) => (e: PointerEvent<HTMLDivElement>) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    show(row, e.clientX - box.left + 14, e.clientY - box.top + 12);
  };
  const onFocus = (row: BarRow) => (e: FocusEvent<HTMLDivElement>) => {
    const box = wrapRef.current?.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    if (!box) return;
    show(row, r.right - box.left - 180, r.bottom - box.top + 4);
  };
  const onKey = (row: BarRow) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onSelect(row.key);
    }
  };

  return (
    <div className="bars" ref={wrapRef} role="list" aria-label={ariaLabel} style={{ ['--bar-label-w' as string]: `${labelWidth}px` }}>
      {rows.map((row) => {
        const summary = `${apiText(row.label)}: ${row.values.map((v) => `${v.series} ${v.text}`).join(', ')}`;
        return (
          <div
            key={row.key}
            role="listitem"
            tabIndex={0}
            aria-label={summary}
            className={`bar-row${row.emphasis ? ' is-emphasis' : ''}${onSelect ? ' is-clickable' : ''}`}
            onPointerMove={onMove(row)}
            onPointerLeave={() => setTip(null)}
            onFocus={onFocus(row)}
            onBlur={() => setTip(null)}
            onClick={onSelect ? () => onSelect(row.key) : undefined}
            onKeyDown={onKey(row)}
          >
            <div className="bar-label">
              <span className="bar-label-text">{apiText(row.label)}</span>
              {row.sub ? (
                <span className="bar-label-sub" title={row.sub}>
                  {row.sub}
                </span>
              ) : null}
            </div>
            <div className={`bar-track${row.values.length > 1 ? ' is-grouped' : ''}`}>
              {min < 0 ? <span className="bar-zero" style={{ left: `${zero}%` }} /> : null}
              {row.values.map((v) => {
                if (v.value === null) {
                  return (
                    <span key={v.series} className="bar-slot">
                      <span className="bar-unknown" style={{ left: `${zero}%` }}>
                        {v.text}
                      </span>
                    </span>
                  );
                }
                const a = pct(Math.min(0, v.value));
                const b = pct(Math.max(0, v.value));
                const neg = v.value < 0;
                return (
                  <span key={v.series} className="bar-slot">
                    <span
                      className={`bar bar-${v.tone}${neg ? ' is-neg' : ''}`}
                      style={{ left: `${a}%`, width: `${Math.max(b - a, v.value === 0 ? 0 : 0.6)}%` }}
                    />
                    <span
                      className={`bar-value${neg ? ' is-neg' : ''}`}
                      style={neg ? { right: `${100 - a}%` } : { left: `${b}%` }}
                    >
                      {v.text}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
      <ChartTip tip={tip} />
    </div>
  );
}
