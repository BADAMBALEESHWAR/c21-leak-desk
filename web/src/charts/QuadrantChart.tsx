import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChartTip, useWidth, type TipState } from './ChartCard';
import { compactInr, niceTicks } from './scale';

/** The engine's product call (push | fix | niche | review) in the UI language; any other value is shown as sent. */
export function productCall(t: TFunction, label: string): string {
  switch (label) {
    case 'push':
      return t('quadrant.call.push', 'push');
    case 'fix':
      return t('quadrant.call.fix', 'fix');
    case 'niche':
      return t('quadrant.call.niche', 'niche');
    case 'review':
      return t('quadrant.call.review', 'review');
    default:
      return label;
  }
}

export interface QuadrantPoint {
  id: string;
  x: number;
  y: number;
  /** push | fix | niche | review — from the engine, not computed here. */
  label: string;
  tip: Array<{ label: string; value: string }>;
}

interface Props {
  points: QuadrantPoint[];
  xLabel: string;
  yLabel: string;
  ariaLabel: string;
}

const PAD = { top: 26, right: 16, bottom: 34, left: 56 };
const H = 300;

const HIGH_X = ['push', 'fix'];
const HIGH_Y = ['push', 'niche'];

/** Split line between the two groups the engine already separated, so guides agree with its labels. */
function splitAt(values: Array<{ v: number; high: boolean }>): number | null {
  const lows = values.filter((p) => !p.high).map((p) => p.v);
  const highs = values.filter((p) => p.high).map((p) => p.v);
  if (lows.length === 0 || highs.length === 0) return null;
  const a = Math.max(...lows);
  const b = Math.min(...highs);
  return a <= b ? (a + b) / 2 : null;
}

/**
 * One series: contribution per unit (y) against units sold (x). Quadrant guides sit between the
 * engine's own groups; the corner names and point labels carry the push / fix / niche / review reading.
 */
export function QuadrantChart({ points, xLabel, yLabel, ariaLabel }: Props) {
  const { t } = useTranslation();
  const [ref, width] = useWidth<HTMLDivElement>(560);
  const [active, setActive] = useState<string | null>(null);
  if (points.length === 0) return null;

  const W = Math.max(300, width);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  // Pad the domain so no point sits on an edge, under an axis label or under a corner name.
  const xHi = Math.max(1, ...xs) * 1.1;
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(0, ...ys);
  const ySpan = yMax - yMin || 1;
  const yLo = yMin - ySpan * 0.18;
  const yHi = yMax + ySpan * 0.15;
  const xTicks = niceTicks(0, xHi, 4);
  const yTicks = niceTicks(yLo, yHi, 4);
  const x = (v: number) => PAD.left + (v / (xHi || 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - yLo) / (yHi - yLo || 1)) * (H - PAD.top - PAD.bottom);

  const xSplit = splitAt(points.map((p) => ({ v: p.x, high: HIGH_X.includes(p.label) })));
  const ySplit = splitAt(points.map((p) => ({ v: p.y, high: HIGH_Y.includes(p.label) })));

  const current = points.find((p) => p.id === active) ?? null;
  const tip: TipState | null = current
    ? {
        x: Math.min(x(current.x) + 14, W - 210),
        y: Math.max(4, y(current.y) - 70),
        title: `${current.id} · ${productCall(t, current.label)}`,
        rows: current.tip.map((r) => ({ label: r.label, value: r.value })),
      }
    : null;

  const left = PAD.left + 8;
  const right = W - PAD.right - 8;
  const top = PAD.top + 12;
  const bottom = H - PAD.bottom - 8;

  return (
    <div className="chart-plot" ref={ref}>
      <svg className="quadrant-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line className="grid-line" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
            <text className="axis-text" x={PAD.left - 8} y={y(v) + 4} textAnchor="end">
              {compactInr(v)}
            </text>
          </g>
        ))}
        {xTicks.map((v) => (
          <text key={`x${v}`} className="axis-text" x={x(v)} y={H - PAD.bottom + 16} textAnchor="middle">
            {v.toLocaleString('en-IN')}
          </text>
        ))}
        <text className="axis-title" x={W - PAD.right} y={H - 4} textAnchor="end">
          {xLabel} →
        </text>
        <text className="axis-title" x={PAD.left} y={12}>
          ↑ {yLabel}
        </text>
        {xSplit !== null ? <line className="quad-guide" x1={x(xSplit)} x2={x(xSplit)} y1={PAD.top} y2={H - PAD.bottom} /> : null}
        {ySplit !== null ? <line className="quad-guide" x1={PAD.left} x2={W - PAD.right} y1={y(ySplit)} y2={y(ySplit)} /> : null}
        {yLo < 0 ? <line className="axis-line" x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} /> : null}
        <text className="quad-name" x={right} y={top} textAnchor="end">
          {t('quadrant.push', 'Push')}
        </text>
        <text className="quad-name" x={left} y={top}>
          {t('quadrant.niche', 'Niche')}
        </text>
        <text className="quad-name" x={right} y={bottom} textAnchor="end">
          {t('quadrant.fix', 'Fix')}
        </text>
        <text className="quad-name" x={left} y={bottom}>
          {t('quadrant.review', 'Review')}
        </text>
        {points.map((p) => (
          <g
            key={p.id}
            className={`quad-point${active === p.id ? ' is-active' : ''}`}
            tabIndex={0}
            role="img"
            aria-label={`${p.id}, ${productCall(t, p.label)}: ${p.tip.map((r) => `${r.label} ${r.value}`).join(', ')}`}
            onPointerEnter={() => setActive(p.id)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(p.id)}
            onBlur={() => setActive(null)}
          >
            <circle className="quad-hit" cx={x(p.x)} cy={y(p.y)} r={12} />
            <circle className="quad-dot" cx={x(p.x)} cy={y(p.y)} r={5} />
            <text className="quad-label" x={x(p.x) + 9} y={y(p.y) + 4}>
              {p.id}
            </text>
          </g>
        ))}
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}
