import { memo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { WhalePoint } from '../api/types';
import { formatCount, formatInr, formatSignedInr, plural } from '../lib/format';
import { ChartCard, ChartTip, useWidth, type TipState } from './ChartCard';

const H = 200;
const PAD = { top: 26, right: 16, bottom: 26, left: 48 };

function niceTicks(lo: number, hi: number, count = 4): number[] {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v));
  return out;
}

/** Axis labels the Indian way: ₹50K, ₹15L, ₹1.5Cr. */
function compactInr(v: number): string {
  const a = Math.abs(v);
  const short = (n: number, unit: string) => `${Number.isInteger(n) ? n : n.toFixed(1).replace(/\.0$/, '')}${unit}`;
  const s = a >= 1e7 ? short(a / 1e7, 'Cr') : a >= 1e5 ? short(a / 1e5, 'L') : a >= 1000 ? short(a / 1000, 'K') : `${a}`;
  return `${v < 0 ? '−' : ''}₹${s}`;
}

interface Props {
  points: WhalePoint[];
  unknownCount: number;
  channelSpend: number | null;
}

/**
 * Cumulative contribution over orders ranked from most to least profitable. One line with a
 * light wash, hairline axes, the fall after the peak marked in the loss tint, peak and final
 * labelled; a crosshair snaps to the nearest order (pointer or arrow keys).
 */
export const WhaleCurve = memo(function WhaleCurve({ points, unknownCount, channelSpend }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(520);
  const [active, setActive] = useState<number | null>(null);
  const n = points.length;
  if (n < 2) return null;

  const W = Math.max(280, width);
  const values = points.map((p) => p.cumulative_inr);
  const yMax = Math.max(0, ...values);
  const yMin = Math.min(0, ...values);
  const ticks = niceTicks(yMin, yMax);
  const top = Math.max(yMax, ticks[ticks.length - 1] ?? yMax);
  const bottom = Math.min(yMin, ticks[0] ?? yMin);
  const x = (i: number) => PAD.left + (i / (n - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - bottom) / (top - bottom || 1)) * (H - PAD.top - PAD.bottom);

  let peakIdx = 0;
  values.forEach((v, i) => {
    if (v > values[peakIdx]) peakIdx = i;
  });
  const peak = points[peakIdx];
  const last = points[n - 1];
  const fall = peak.cumulative_inr - last.cumulative_inr;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.cumulative_inr).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const fallArea =
    fall > 0
      ? `M${x(peakIdx).toFixed(1)},${y(peak.cumulative_inr).toFixed(1)} ` +
        points
          .slice(peakIdx)
          .map((p, j) => `L${x(peakIdx + j).toFixed(1)},${y(p.cumulative_inr).toFixed(1)}`)
          .join(' ') +
        ` L${x(n - 1).toFixed(1)},${y(peak.cumulative_inr).toFixed(1)} Z`
      : null;

  const peakX = x(peakIdx);
  const peakAnchor = peakX > W * 0.62 ? 'end' : peakX < W * 0.3 ? 'start' : 'middle';
  const lastY = y(last.cumulative_inr);
  const lastLabelY = lastY + 18 > H - PAD.bottom + 10 ? lastY - 10 : lastY + 18;

  const tipFor = (i: number): TipState => {
    const p = points[i];
    return {
      x: Math.min(x(i) + 12, W - 190),
      y: Math.max(8, y(p.cumulative_inr) - 64),
      title: `#${p.rank} · ${p.order_id}`,
      rows: [
        { label: 'running total', value: formatInr(p.cumulative_inr), tone: 'series-1' },
        { label: 'this order', value: formatSignedInr(p.contribution_inr) },
      ],
    };
  };

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect();
    const px = e.clientX - box.left;
    const i = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * (n - 1));
    setActive(Math.max(0, Math.min(n - 1, i)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    setActive((cur) => {
      const c = cur ?? peakIdx;
      if (e.key === 'Home') return 0;
      if (e.key === 'End') return n - 1;
      return Math.max(0, Math.min(n - 1, c + (e.key === 'ArrowRight' ? 1 : -1)));
    });
  };

  const summary =
    `Running total peaks at ${formatInr(peak.cumulative_inr)} after ${formatCount(peak.rank)} ${plural(peak.rank, 'order', 'orders')} ` +
    `and ends at ${formatInr(last.cumulative_inr)} after ${formatCount(last.rank)} orders. Use the arrow keys to read each order.`;

  const subtitle = (
    <>
      Orders ranked from most to least profitable; the line is the running total.
      {channelSpend ? ` Values are before ${formatInr(channelSpend)} channel spend.` : ''}
      {unknownCount > 0 ? ` ${formatCount(unknownCount)} unknown ${plural(unknownCount, 'order is', 'orders are')} left out.` : ''}
    </>
  );

  const table = (
    <div className="table-scroll">
      <table className="table table-compact">
        <caption className="visually-hidden">Cumulative contribution by order rank</caption>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Order</th>
            <th scope="col" className="r">
              Contribution
            </th>
            <th scope="col" className="r">
              Running total
            </th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.order_id}>
              <td className="num">{p.rank}</td>
              <th scope="row">{p.order_id}</th>
              <td className="r num">{formatSignedInr(p.contribution_inr)}</td>
              <td className="r num">{formatInr(p.cumulative_inr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <ChartCard title="Whale curve" subtitle={subtitle} table={table}>
      <div className="chart-plot" ref={ref}>
        <svg
          className="whale-svg"
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={summary}
          tabIndex={0}
          onKeyDown={onKey}
          onFocus={() => setActive((c) => c ?? peakIdx)}
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
          <text className="axis-text" x={PAD.left} y={H - 6}>
            Highest
          </text>
          <text className="axis-text" x={W - PAD.right} y={H - 6} textAnchor="end">
            Lowest ({formatCount(last.rank)})
          </text>
          <path className="whale-area" d={area} />
          {fallArea ? <path className="whale-fall" d={fallArea} /> : null}
          <path className="whale-line" d={line} />
          {active !== null ? (
            <line className="crosshair" x1={x(active)} x2={x(active)} y1={PAD.top - 6} y2={H - PAD.bottom} />
          ) : null}
          <circle className="whale-dot" cx={peakX} cy={y(peak.cumulative_inr)} r={4.5} />
          <text className="whale-label" x={peakX} y={y(peak.cumulative_inr) - 10} textAnchor={peakAnchor}>
            Peak {formatInr(peak.cumulative_inr)} · top {formatCount(peak.rank)} {plural(peak.rank, 'order', 'orders')}
          </text>
          {peakIdx !== n - 1 ? (
            <>
              <circle className={`whale-dot${fall > 0 ? ' whale-dot-loss' : ''}`} cx={x(n - 1)} cy={lastY} r={4.5} />
              <text className="whale-label" x={x(n - 1)} y={lastLabelY} textAnchor="end">
                {formatInr(last.cumulative_inr)} final{fall > 0 ? ` (${formatSignedInr(-fall)})` : ''}
              </text>
            </>
          ) : null}
          {active !== null ? <circle className="whale-dot whale-dot-active" cx={x(active)} cy={y(points[active].cumulative_inr)} r={4.5} /> : null}
          <rect
            className="hit-area"
            x={PAD.left}
            y={0}
            width={W - PAD.left - PAD.right}
            height={H}
            onPointerMove={onMove}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
        <ChartTip tip={active !== null ? tipFor(active) : null} />
      </div>
    </ChartCard>
  );
});
