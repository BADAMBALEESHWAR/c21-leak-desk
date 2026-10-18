import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChartTip, useWidth, type SeriesTone, type TipState } from './ChartCard';
import { barPath, compactInr, niceTicks } from './scale';

export interface ColumnSeries {
  id: string;
  label: string;
  tone: SeriesTone;
  values: Array<number | null>;
}

interface Props {
  categories: Array<{ key: string; label: string; full: string }>;
  series: ColumnSeries[];
  ariaLabel: string;
  format: (n: number) => string;
  height?: number;
  /** Optional callout text drawn above one category (e.g. the best month). */
  callout?: { index: number; text: string } | null;
  /** Label the highest and lowest value of this series (selective labels, not every bar). */
  labelExtremes?: string;
}

const PAD = { top: 22, right: 8, bottom: 26, left: 52 };

/**
 * Vertical columns, one group per category; bars at most 24px, 4px rounded data end,
 * a 2px gap between neighbours. Hover or arrow keys read every series for a category.
 */
export function ColumnChart({ categories, series, ariaLabel, format, height = 220, callout, labelExtremes }: Props) {
  const { t } = useTranslation();
  const [ref, width] = useWidth<HTMLDivElement>(560);
  const [active, setActive] = useState<number | null>(null);
  const n = categories.length;
  if (n === 0) return null;

  const W = Math.max(280, width);
  const H = height;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const lo = Math.min(0, ticks[0] ?? 0, ...all);
  const hi = Math.max(0, ticks[ticks.length - 1] ?? 0, ...all);
  // A labelled negative extreme needs room under the zero line, clear of the category labels.
  const extremeSeries = labelExtremes ? series.find((s) => s.id === labelExtremes) : undefined;
  const negLabel = !!extremeSeries && extremeSeries.values.some((v) => v !== null && v < 0);
  const bottom = PAD.bottom + (negLabel ? 16 : 0);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.top - bottom);
  const band = (W - PAD.left - PAD.right) / n;
  const gap = 2;
  const barW = Math.min(24, (band * 0.72 - gap * (series.length - 1)) / series.length);
  const groupW = barW * series.length + gap * (series.length - 1);
  const x0 = (i: number) => PAD.left + i * band + (band - groupW) / 2;
  const zero = y(0);

  const tipFor = (i: number): TipState => ({
    x: Math.min(PAD.left + i * band + band / 2 + 12, W - 200),
    y: 4,
    title: categories[i].full,
    rows: series.map((s) => ({ label: s.label, value: s.values[i] === null ? t('chart.unknown', 'unknown') : format(s.values[i] as number), tone: s.tone })),
  });

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect();
    const i = Math.floor((e.clientX - box.left - PAD.left) / band);
    setActive(Math.max(0, Math.min(n - 1, i)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    setActive((c) => {
      if (e.key === 'Home') return 0;
      if (e.key === 'End') return n - 1;
      const cur = c ?? 0;
      return Math.max(0, Math.min(n - 1, cur + (e.key === 'ArrowRight' ? 1 : -1)));
    });
  };

  const marked = new Map<number, number>();
  const ls = labelExtremes ? series.findIndex((s) => s.id === labelExtremes) : -1;
  if (ls >= 0) {
    const vals = series[ls].values;
    let hiI = -1;
    let loI = -1;
    vals.forEach((v, i) => {
      if (v === null) return;
      if (hiI < 0 || v > (vals[hiI] as number)) hiI = i;
      if (loI < 0 || v < (vals[loI] as number)) loI = i;
    });
    if (hiI >= 0) marked.set(hiI, vals[hiI] as number);
    if (loI >= 0 && loI !== hiI) marked.set(loI, vals[loI] as number);
  }

  // Thin out x labels when the bands get narrow.
  const every = band < 30 ? 3 : band < 44 ? 2 : 1;

  return (
    <div className="chart-plot" ref={ref}>
      <svg
        className="column-svg"
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t('chart.arrowColumns', '{{label}}. Use the arrow keys to read each column.', { label: ariaLabel })}
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
        {active !== null ? <rect className="column-hover" x={PAD.left + active * band} y={PAD.top - 6} width={band} height={H - PAD.top - bottom + 6} /> : null}
        {categories.map((c, i) => (
          <g key={c.key}>
            {series.map((s, j) => {
              const v = s.values[i];
              if (v === null || v === 0) return null;
              return <path key={s.id} className={`col-bar tone-${s.tone}`} d={barPath(x0(i) + j * (barW + gap), barW, zero, y(v))} />;
            })}
            {i % every === 0 ? (
              <text className="axis-text" x={PAD.left + i * band + band / 2} y={H - 8} textAnchor="middle">
                {c.label}
              </text>
            ) : null}
          </g>
        ))}
        <line className="axis-line" x1={PAD.left} x2={W - PAD.right} y1={zero} y2={zero} />
        {[...marked].map(([i, v]) => (
          <text key={`m${i}`} className="col-label" x={x0(i) + ls * (barW + gap) + barW / 2} y={v < 0 ? y(v) + 13 : y(v) - 5} textAnchor="middle">
            {compactInr(v)}
          </text>
        ))}
        {callout && callout.index >= 0 && callout.index < n ? (
          <text className="chart-callout" x={Math.min(Math.max(PAD.left + callout.index * band + band / 2, PAD.left + 40), W - 60)} y={12} textAnchor="middle">
            {callout.text}
          </text>
        ) : null}
        <rect className="hit-area" x={PAD.left} y={0} width={W - PAD.left - PAD.right} height={H} onPointerMove={onMove} onPointerLeave={() => setActive(null)} />
      </svg>
      <ChartTip tip={active !== null ? tipFor(active) : null} />
    </div>
  );
}
