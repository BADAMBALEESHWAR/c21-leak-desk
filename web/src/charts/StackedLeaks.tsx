import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatInr } from '../lib/format';
import { ChartTip, useWidth, type SeriesTone, type TipRow, type TipState } from './ChartCard';
import { compactInr, niceTicks } from './scale';

export interface LeakKey {
  id: string;
  label: string;
  /** Categorical slot 1–5, fixed by cause (never by rank). */
  slot: number;
}

export interface LeakMonth {
  month: string;
  label: string;
  full: string;
  byCause: Record<string, number>;
  total: number;
  unknownOrders: number;
}

interface Props {
  months: LeakMonth[];
  keys: LeakKey[];
  ariaLabel: string;
  /** Link for a month, or for one cause in a month. */
  hrefFor?: (month: string, cause?: string) => string;
  height?: number;
}

const PAD = { top: 26, right: 10, bottom: 28, left: 52 };

/**
 * ₹ lost per month, stacked by primary cause (2px surface gap between segments), with the monthly total as
 * a line on the same axis. Each segment links to that month's orders with that cause; each month label to the month.
 */
export function StackedLeaks({ months, keys, ariaLabel, hrefFor, height = 260 }: Props) {
  const { t } = useTranslation();
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const [active, setActive] = useState<number | null>(null);
  const n = months.length;
  if (n === 0) return null;

  const W = Math.max(300, width);
  const H = height;
  const totals = months.map((m) => m.total);
  const ticks = niceTicks(0, Math.max(1, ...totals));
  const hi = Math.max(ticks[ticks.length - 1] ?? 1, ...totals);
  const y = (v: number) => PAD.top + (1 - v / (hi || 1)) * (H - PAD.top - PAD.bottom);
  const band = (W - PAD.left - PAD.right) / n;
  const barW = Math.max(4, Math.min(26, band * 0.56));
  const cx = (i: number) => PAD.left + i * band + band / 2;
  const maxIdx = totals.indexOf(Math.max(...totals));
  const every = band < 30 ? 3 : band < 44 ? 2 : 1;
  const line = months.map((m, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${y(m.total).toFixed(1)}`).join(' ');

  const tipFor = (i: number): TipState => {
    const m = months[i];
    const rows: TipRow[] = keys
      .filter((k) => (m.byCause[k.id] ?? 0) > 0)
      .map((k) => ({ label: k.label, value: formatInr(m.byCause[k.id]), tone: `cat-${k.slot}` as SeriesTone }));
    if (m.unknownOrders > 0) rows.push({ label: t('chart.unknownOrders', 'orders with no refund fact (not drawn)'), value: String(m.unknownOrders) });
    return {
      x: Math.max(0, Math.min(cx(i) + 14, W - 250)),
      y: 2,
      title: t('chart.lostIn', '{{month}} · {{inr}} lost', { month: m.full, inr: formatInr(m.total) }),
      rows,
    };
  };

  return (
    <div className="chart-plot" ref={ref}>
      <svg className="column-svg sl-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={ariaLabel}>
        <text className="axis-title" x={PAD.left - 8} y={12} textAnchor="end">
          {t('chart.inrLost', '₹ lost')}
        </text>
        {ticks.map((v) => (
          <g key={v} aria-hidden="true">
            <line className="grid-line" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
            <text className="axis-text" x={PAD.left - 8} y={y(v) + 4} textAnchor="end">
              {compactInr(v)}
            </text>
          </g>
        ))}
        {active !== null ? <rect className="column-hover" x={PAD.left + active * band} y={PAD.top - 8} width={band} height={H - PAD.top - PAD.bottom + 8} /> : null}
        {months.map((m, i) => {
          let base = 0;
          const x = cx(i) - barW / 2;
          const enter = () => setActive(i);
          const leave = () => setActive((c) => (c === i ? null : c));
          return (
            <g key={m.month} data-month={m.month}>
              {keys.map((k) => {
                const v = m.byCause[k.id] ?? 0;
                if (v <= 0) return null;
                const yTop = y(base + v);
                const yBottom = y(base);
                base += v;
                const h = Math.max(1, yBottom - yTop - 2);
                const seg = <rect className={`stack-seg tone-cat-${k.slot}`} x={x} y={yTop} width={barW} height={h} rx={1} />;
                const label = t('chart.segmentLabel', '{{month}}, {{cause}}: {{inr}} lost. Open these orders in the ledger', { month: m.full, cause: k.label, inr: formatInr(v) });
                return hrefFor ? (
                  <a key={k.id} href={hrefFor(m.month, k.id)} className="sl-seg" aria-label={label} data-cause={k.id} onPointerEnter={enter} onPointerLeave={leave} onFocus={enter} onBlur={leave}>
                    {seg}
                  </a>
                ) : (
                  <g key={k.id}>{seg}</g>
                );
              })}
              {i % every === 0 ? (
                hrefFor ? (
                  <a
                    href={hrefFor(m.month)}
                    className="sl-month"
                    aria-label={t('chart.monthLabel', '{{month}}: {{inr}} lost in total. Open this month’s orders in the ledger', { month: m.full, inr: formatInr(m.total) })}
                    onPointerEnter={enter}
                    onPointerLeave={leave}
                    onFocus={enter}
                    onBlur={leave}
                  >
                    <text className="axis-text sl-month-text" x={cx(i)} y={H - 8} textAnchor="middle">
                      {m.label}
                    </text>
                  </a>
                ) : (
                  <text className="axis-text" x={cx(i)} y={H - 8} textAnchor="middle">
                    {m.label}
                  </text>
                )
              ) : null}
            </g>
          );
        })}
        <line className="axis-line" x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} />
        {n > 1 ? <path className="sl-total" d={line} aria-hidden="true" /> : null}
        {months.map((m, i) => (
          <circle key={m.month} className="sl-total-dot" cx={cx(i)} cy={y(m.total)} r={active === i ? 4.5 : 3} aria-hidden="true" />
        ))}
        {totals[maxIdx] > 0 ? (
          <text className="chart-callout" x={Math.min(Math.max(cx(maxIdx), PAD.left + 40), W - 50)} y={y(totals[maxIdx]) - 9} textAnchor="middle">
            {formatInr(totals[maxIdx])}
          </text>
        ) : null}
      </svg>
      <ChartTip tip={active !== null ? tipFor(active) : null} />
    </div>
  );
}
