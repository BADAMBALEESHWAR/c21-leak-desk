import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ChartTip, useWidth, type SeriesTone, type TipState } from './ChartCard';
import { compactInr, niceTicks } from './scale';

export interface StackKey {
  id: string;
  label: string;
  /** Categorical slot 1–5, assigned in a fixed order by the caller (never by rank). */
  slot: number;
}

interface Props {
  categories: Array<{ key: string; label: string; full: string }>;
  keys: StackKey[];
  /** values[categoryIndex][keyId] */
  values: Array<Record<string, number>>;
  totals: number[];
  ariaLabel: string;
  format: (n: number) => string;
  extraTip?: (i: number) => { label: string; value: string } | null;
  height?: number;
}

const PAD = { top: 24, right: 8, bottom: 26, left: 52 };

/** Stacked columns (positive amounts), 2px surface gap between segments, total labelled on the largest column. */
export function StackedColumnChart({ categories, keys, values, totals, ariaLabel, format, extraTip, height = 240 }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(560);
  const [active, setActive] = useState<number | null>(null);
  const n = categories.length;
  if (n === 0) return null;

  const W = Math.max(280, width);
  const H = height;
  const ticks = niceTicks(0, Math.max(1, ...totals));
  const hi = Math.max(ticks[ticks.length - 1] ?? 1, ...totals);
  const y = (v: number) => PAD.top + (1 - v / (hi || 1)) * (H - PAD.top - PAD.bottom);
  const band = (W - PAD.left - PAD.right) / n;
  const barW = Math.min(24, band * 0.62);
  const gap = 2;
  const maxIdx = totals.indexOf(Math.max(...totals));
  const every = band < 30 ? 3 : band < 44 ? 2 : 1;

  const tipFor = (i: number): TipState => {
    const rows = keys
      .filter((k) => (values[i]?.[k.id] ?? 0) > 0)
      .map((k) => ({ label: k.label, value: format(values[i][k.id]), tone: `cat-${k.slot}` as SeriesTone }));
    const extra = extraTip?.(i);
    return {
      x: Math.min(PAD.left + i * band + band / 2 + 12, W - 230),
      y: 4,
      title: `${categories[i].full} · ${format(totals[i])} lost`,
      rows: extra ? [...rows, extra] : rows,
    };
  };

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect();
    setActive(Math.max(0, Math.min(n - 1, Math.floor((e.clientX - box.left - PAD.left) / band))));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    setActive((c) => (e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : Math.max(0, Math.min(n - 1, (c ?? 0) + (e.key === 'ArrowRight' ? 1 : -1)))));
  };

  return (
    <div className="chart-plot" ref={ref}>
      <svg
        className="column-svg"
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${ariaLabel}. Use the arrow keys to read each month.`}
        tabIndex={0}
        onKeyDown={onKey}
        onFocus={() => setActive((c) => c ?? 0)}
        onBlur={() => setActive(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="axis-text" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
              {compactInr(t)}
            </text>
          </g>
        ))}
        {active !== null ? <rect className="column-hover" x={PAD.left + active * band} y={PAD.top - 8} width={band} height={H - PAD.top - PAD.bottom + 8} /> : null}
        {categories.map((c, i) => {
          let base = 0;
          const x = PAD.left + i * band + (band - barW) / 2;
          const segs = keys.map((k) => {
            const v = values[i]?.[k.id] ?? 0;
            if (v <= 0) return null;
            const yTop = y(base + v);
            const yBottom = y(base);
            base += v;
            // The surface gap separates segments; the top one keeps its full height.
            const h = Math.max(0, yBottom - yTop - gap);
            return <rect key={k.id} className={`stack-seg tone-cat-${k.slot}`} x={x} y={yTop} width={barW} height={h} rx={1} />;
          });
          return (
            <g key={c.key}>
              {segs}
              {i === maxIdx && totals[i] > 0 ? (
                <text className="chart-callout" x={x + barW / 2} y={y(totals[i]) - 6} textAnchor="middle">
                  {format(totals[i])}
                </text>
              ) : null}
              {i % every === 0 ? (
                <text className="axis-text" x={PAD.left + i * band + band / 2} y={H - 8} textAnchor="middle">
                  {c.label}
                </text>
              ) : null}
            </g>
          );
        })}
        <line className="axis-line" x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} />
        <rect className="hit-area" x={PAD.left} y={0} width={W - PAD.left - PAD.right} height={H} onPointerMove={onMove} onPointerLeave={() => setActive(null)} />
      </svg>
      <ChartTip tip={active !== null ? tipFor(active) : null} />
    </div>
  );
}
