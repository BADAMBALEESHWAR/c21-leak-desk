import { useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { compactInr, inr, month as monthName } from './format';
import { useWidth } from './shared';

/** A step of 1, 2, 2.5 or 5 × 10^n that gives about `target` intervals. */
function niceStep(range: number, target = 3): number {
  const raw = range / target || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * mag;
}

/**
 * Contribution by month: one series, so no legend; the losing month, the best month and the latest month are
 * labelled, the rest live in the crosshair tooltip and the table.
 */
export function ContributionLine({ months, height = 176 }: { months: Array<{ month: string; contribution_inr: number }>; height?: number }) {
  const { t, i18n } = useTranslation();
  const [ref, width] = useWidth<HTMLDivElement>(520);
  const [active, setActive] = useState<number | null>(null);
  const W = Math.max(260, width);
  const H = height;
  // Hindi and Telugu write the units as words (40 हज़ार, 40 వేలు), so the axis and end labels get more room.
  const wide = i18n.language === 'hi' || i18n.language === 'te';
  const pad = { top: 24, right: wide ? 76 : 48, bottom: 26, left: wide ? 62 : 44 };
  const vals = months.map((m) => m.contribution_inr);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const step = niceStep(hi - lo, 4);
  const yMax = Math.ceil(hi / step) * step || step;
  const yMin = lo < 0 ? lo * 1.6 : 0;
  const n = months.length;
  const x = (i: number) => pad.left + (i * (W - pad.left - pad.right)) / Math.max(1, n - 1);
  const y = (v: number) => pad.top + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - pad.top - pad.bottom);
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const ticks: number[] = [];
  for (let v = 0; v <= yMax + 1e-6; v += step) ticks.push(v);
  const best = vals.indexOf(hi);
  const worst = vals.indexOf(lo);
  const last = n - 1;
  const xLabels = months.map((_, i) => i).filter((i) => i % 3 === 0 || i === last);

  const pick = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left + pad.left;
    const i = Math.round(((px - pad.left) / (W - pad.left - pad.right)) * (n - 1));
    setActive(Math.min(n - 1, Math.max(0, i)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setActive((a) => Math.min(n - 1, Math.max(0, (a ?? last) + (e.key === 'ArrowRight' ? 1 : -1))));
  };

  const said = {
    from: monthName(months[0].month),
    to: monthName(months[last].month),
    best: monthName(months[best].month),
    bestInr: inr(hi),
    worst: monthName(months[worst].month),
    worstInr: inr(Math.abs(lo)),
    latestInr: inr(vals[last]),
  };
  const summary =
    lo < 0
      ? t('hero.lineSummaryLoss', 'Contribution by month, {{from}} to {{to}}. Best {{best}} {{bestInr}}; {{worst}} lost {{worstInr}}; latest {{latestInr}}.', said)
      : t('hero.lineSummary', 'Contribution by month, {{from}} to {{to}}. Best {{best}} {{bestInr}}; latest {{latestInr}}.', said);

  const tip = active === null ? null : months[active];
  const tipLeft = active === null ? 0 : Math.min(Math.max(x(active), 70), W - 70);

  return (
    <div ref={ref} className="l-line" tabIndex={0} role="group" aria-label={`${summary} ${t('hero.lineKeys', 'Use the arrow keys to read each month.')}`} onKeyDown={onKey} onFocus={() => setActive(last)} onBlur={() => setActive(null)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {ticks.map((v) => (
          <g key={v}>
            <line className={v === 0 ? 'l-zero' : 'l-grid'} x1={pad.left} x2={W - pad.right + 8} y1={y(v)} y2={y(v)} />
            <text className="l-axis" x={pad.left - 8} y={y(v) + 4} textAnchor="end">
              {v === 0 ? '0' : compactInr(v).replace('₹', '')}
            </text>
          </g>
        ))}
        <path className="l-area" d={area} />
        <path className="l-stroke" d={line} />
        {xLabels.map((i) => (
          <text key={i} className="l-axis" x={x(i)} y={H - 6} textAnchor="middle">
            {monthName(months[i].month, true)}
          </text>
        ))}
        {active !== null ? <line className="l-cross" x1={x(active)} x2={x(active)} y1={pad.top - 8} y2={H - pad.bottom} /> : null}
        {[worst, best, last]
          .filter((i, k, all) => all.indexOf(i) === k && (i !== worst || lo < 0))
          .map((i) => {
            const v = vals[i];
            const below = v < 0;
            // The end label sits right of its dot; an edge point below zero does too, clear of the month axis.
            const side = i === last || (below && i < 2);
            return (
              <g key={i}>
                <circle className={below ? 'l-dot is-loss' : 'l-dot'} cx={x(i)} cy={y(v)} r={4.5} />
                <text className="l-val" x={side ? x(i) + 9 : x(i)} y={side ? y(v) + 4 : below ? y(v) + 18 : y(v) - 10} textAnchor={side ? 'start' : 'middle'}>
                  {compactInr(v)}
                </text>
              </g>
            );
          })}
        {active !== null ? <circle className={vals[active] < 0 ? 'l-dot is-loss' : 'l-dot'} cx={x(active)} cy={y(vals[active])} r={5} /> : null}
        <rect
          className="l-hit"
          x={pad.left}
          y={0}
          width={W - pad.left - pad.right}
          height={H}
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={() => setActive(null)}
        />
      </svg>
      {tip ? (
        <div className="l-tip" style={{ left: tipLeft }} aria-live="polite">
          <strong className={tip.contribution_inr < 0 ? 'is-loss' : undefined}>{inr(tip.contribution_inr)}</strong>
          <span>{monthName(tip.month)}</span>
        </div>
      ) : null}
    </div>
  );
}

export interface WaterfallRow {
  key: string;
  label: string;
  /** Signed: deductions negative. null = unknown. */
  amount: number | null;
  kind: 'start' | 'deduction' | 'subtotal' | 'total';
  note?: ReactNode;
}

/**
 * A horizontal waterfall: each deduction floats from the running total, so the rows read like a statement.
 * Once a line is unknown the running total is unknown too, and later bars are not placed.
 */
export function Waterfall({ rows, label }: { rows: WaterfallRow[]; label: string }) {
  const { t } = useTranslation();
  let running: number | null = 0;
  const placed = rows.map((r) => {
    if (r.kind === 'start' || r.kind === 'subtotal' || r.kind === 'total') {
      running = r.amount;
      return { r, from: r.amount === null ? null : Math.min(0, r.amount), to: r.amount === null ? null : Math.max(0, r.amount) };
    }
    if (running === null || r.amount === null) {
      running = null;
      return { r, from: null, to: null };
    }
    const before: number = running;
    running = before + r.amount;
    return { r, from: Math.min(before, running), to: Math.max(before, running) };
  });
  const ends = placed.flatMap((p) => (p.from === null || p.to === null ? [] : [p.from, p.to]));
  const lo = Math.min(0, ...ends);
  const hi = Math.max(1, ...ends);
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100;

  return (
    <ol className="l-wf" aria-label={label}>
      {placed.map(({ r, from, to }) => {
        const unknown = r.amount === null;
        const strong = r.kind !== 'deduction';
        const loss = r.kind === 'total' && r.amount !== null && r.amount < 0;
        return (
          <li key={r.key} className={`l-wf-row is-${r.kind}`}>
            <span className="l-wf-label">
              {r.label}
              {r.note ? <span className="l-wf-note">{r.note}</span> : null}
            </span>
            <span className={`l-wf-track${unknown ? ' is-open' : ''}`} aria-hidden="true">
              {lo < 0 ? <span className="l-wf-zero" style={{ left: `${pos(0)}%` }} /> : null}
              {from !== null && to !== null && to - from > 0 ? (
                <span
                  className={`l-wf-bar is-${r.kind}${loss ? ' is-loss' : ''}`}
                  style={{ left: `${pos(from)}%`, width: `${Math.max(0.6, pos(to) - pos(from))}%` }}
                  title={`${r.label}: ${inr(r.amount ?? 0)}`}
                />
              ) : null}
            </span>
            <span className={`l-wf-value${strong ? ' is-strong' : ''}${loss ? ' is-loss' : ''}`}>{unknown ? <span className="l-unknown">{t('hero.unknown', 'unknown')}</span> : inr(r.amount ?? 0)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Horizontal bars around a zero line; every value is labelled, so colour never carries the number alone. */
export function HBars({ rows, format, label }: { rows: Array<{ key: string; label: ReactNode; value: number }>; format: (n: number) => string; label: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  const min = Math.min(0, ...rows.map((r) => r.value));
  const range = max - min || 1;
  const zeroPct = (-min / range) * 100;
  return (
    <ul className="l-hbars" aria-label={label}>
      {rows.map((r) => {
        const w = (Math.abs(r.value) / range) * 100;
        const neg = r.value < 0;
        return (
          <li key={r.key} className="l-hbar">
            <span className="l-hbar-label">{r.label}</span>
            <span className="l-hbar-track" aria-hidden="true">
              {min < 0 ? <span className="l-hbar-zero" style={{ left: `${zeroPct}%` }} /> : null}
              <span className={`l-hbar-fill${neg ? ' is-loss' : ''}`} style={{ left: `${neg ? zeroPct - w : zeroPct}%`, width: `${Math.max(w, 0.8)}%` }} />
            </span>
            <span className={`l-hbar-value${neg ? ' is-loss' : ''}`}>{format(r.value)}</span>
          </li>
        );
      })}
    </ul>
  );
}
