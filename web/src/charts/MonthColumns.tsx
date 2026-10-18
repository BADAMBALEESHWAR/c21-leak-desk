import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDecimal, formatInr } from '../lib/format';
import { ChartTip, useWidth, type TipRow, type TipState } from './ChartCard';
import { barPath, niceTicks } from './scale';

export interface MonthDatum {
  month: string;
  label: string;
  full: string;
  netSales: number;
  contribution: number | null;
  /** Every other figure the tooltip lists: contribution %, return %, AOV… (already formatted). */
  extra: TipRow[];
  href?: string;
}

interface Props {
  months: MonthDatum[];
  ariaLabel: string;
  height?: number;
}

const PAD = { top: 34, right: 10, bottom: 28, left: 46 };
const LAKH = 1e5;

/** Ticks in ₹ lakh: 0, 2.5, 5… */
const lakh = (v: number) => formatDecimal(v / LAKH);

/** Best and worst month by contribution (null when there is nothing to compare). */
export function monthExtremes(months: MonthDatum[]): { best: number; worst: number } | null {
  const idx = months.map((m, i) => (m.contribution === null ? -1 : i)).filter((i) => i >= 0);
  if (idx.length < 2) return null;
  let best = idx[0];
  let worst = idx[0];
  for (const i of idx) {
    if ((months[i].contribution as number) > (months[best].contribution as number)) best = i;
    if ((months[i].contribution as number) < (months[worst].contribution as number)) worst = i;
  }
  return best === worst ? null : { best, worst };
}

/**
 * Net sales and operational contribution side by side for each month, one ₹-lakh axis. Contribution is
 * coloured by its sign; the best and worst months are named. Each month is a link to its orders in the ledger.
 */
export function MonthColumns({ months, ariaLabel, height = 260 }: Props) {
  const { t } = useTranslation();
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const [active, setActive] = useState<number | null>(null);
  const n = months.length;
  if (n === 0) return null;

  const W = Math.max(300, width);
  const H = height;
  const all = months.flatMap((m) => [m.netSales, m.contribution].filter((v): v is number => v !== null));
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 5);
  const lo = Math.min(0, ticks[0] ?? 0, ...all);
  const hi = Math.max(0, ticks[ticks.length - 1] ?? 0, ...all);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.top - PAD.bottom);
  const band = (W - PAD.left - PAD.right) / n;
  const gap = 2;
  const barW = Math.max(3, Math.min(22, (band * 0.7 - gap) / 2));
  const groupW = barW * 2 + gap;
  const x0 = (i: number) => PAD.left + i * band + (band - groupW) / 2;
  const zero = y(0);
  const ext = monthExtremes(months);
  const every = band < 30 ? 3 : band < 44 ? 2 : 1;

  const tipFor = (i: number): TipState => {
    const m = months[i];
    const c = m.contribution;
    return {
      x: Math.max(0, Math.min(PAD.left + i * band + band / 2 + 12, W - 220)),
      y: 2,
      title: m.full,
      rows: [
        { label: t('ledger.netSales'), value: formatInr(m.netSales), tone: 'series-1' },
        { label: t('ledger.operationalContribution', 'Operational contribution'), value: c === null ? t('status.unknown') : formatInr(c), tone: c !== null && c < 0 ? 'loss' : 'gain' },
        ...m.extra,
      ],
    };
  };

  const annotate = (i: number, text: string, kind: 'best' | 'worst') => {
    const m = months[i];
    const c = m.contribution as number;
    const cx = x0(i) + barW + gap + barW / 2;
    const top = Math.min(y(Math.max(c, 0)), y(Math.max(m.netSales, 0)));
    const ty = Math.max(PAD.top - 12, top - 8);
    const anchor = cx < PAD.left + 60 ? 'start' : cx > W - 70 ? 'end' : 'middle';
    return (
      <text key={kind} className={`mc-note mc-note-${kind}`} x={cx} y={ty} textAnchor={anchor}>
        {text}
      </text>
    );
  };

  return (
    <div className="chart-plot" ref={ref}>
      <svg className="column-svg mc-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={ariaLabel}>
        <text className="axis-title" x={PAD.left - 8} y={12} textAnchor="end">
          {t('chart.lakhAxis', '₹ lakh')}
        </text>
        {ticks.map((v) => (
          <g key={v} aria-hidden="true">
            <line className="grid-line" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
            <text className="axis-text" x={PAD.left - 8} y={y(v) + 4} textAnchor="end">
              {lakh(v)}
            </text>
          </g>
        ))}
        {active !== null ? <rect className="column-hover" x={PAD.left + active * band} y={PAD.top - 8} width={band} height={H - PAD.top - PAD.bottom + 8} /> : null}
        {months.map((m, i) => {
          const c = m.contribution;
          const label = `${m.full}: ${t('ledger.netSales')} ${formatInr(m.netSales)}, ${t('ledger.contribution')} ${c === null ? t('status.unknown') : formatInr(c)}. ${t('chart.openMonth', 'Open this month’s orders in the ledger')}`;
          const body = (
            <>
              <rect className="mc-hit" x={PAD.left + i * band} y={PAD.top - 8} width={band} height={H - PAD.top + 8} />
              {m.netSales !== 0 ? <path className="col-bar tone-series-1" d={barPath(x0(i), barW, zero, y(m.netSales))} /> : null}
              {c !== null && c !== 0 ? <path className={`col-bar ${c < 0 ? 'tone-loss' : 'tone-gain'}`} d={barPath(x0(i) + barW + gap, barW, zero, y(c))} /> : null}
              {i % every === 0 ? (
                <text className="axis-text" x={PAD.left + i * band + band / 2} y={H - 8} textAnchor="middle">
                  {m.label}
                </text>
              ) : null}
            </>
          );
          const events = {
            onPointerEnter: () => setActive(i),
            onPointerLeave: () => setActive((cur) => (cur === i ? null : cur)),
            onFocus: () => setActive(i),
            onBlur: () => setActive((cur) => (cur === i ? null : cur)),
          };
          return m.href ? (
            <a key={m.month} href={m.href} className="mc-month" aria-label={label} data-month={m.month} {...events}>
              {body}
            </a>
          ) : (
            <g key={m.month} className="mc-month" tabIndex={0} aria-label={label} data-month={m.month} {...events}>
              {body}
            </g>
          );
        })}
        <line className="axis-line" x1={PAD.left} x2={W - PAD.right} y1={zero} y2={zero} />
        {ext
          ? [
              annotate(ext.best, t('chart.bestMonth', 'Best: {{month}} {{inr}}', { month: months[ext.best].label, inr: formatInr(months[ext.best].contribution as number) }), 'best'),
              annotate(ext.worst, t('chart.worstMonth', 'Worst: {{month}} {{inr}}', { month: months[ext.worst].label, inr: formatInr(months[ext.worst].contribution as number) }), 'worst'),
            ]
          : null}
      </svg>
      <ChartTip tip={active !== null ? tipFor(active) : null} />
    </div>
  );
}
