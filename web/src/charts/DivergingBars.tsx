import { useRef, useState, type FocusEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPct } from '../lib/format';
import { ChartTip, type TipRow, type TipState } from './ChartCard';
import { compactInr, niceTicks } from './scale';

export interface DivergingRow {
  key: string;
  label: string;
  /** The signed value the bar shows; null = unknown (no bar, a note at the axis). */
  value: number | null;
  /** Share of orders, 0–1, drawn as a thin bar under the main one. */
  share?: number | null;
  /** Small second line under the label, e.g. "120 orders". */
  sub?: string;
  /** Extra tooltip rows after the value and the share. */
  tip?: TipRow[];
  /** Where a click goes: a filtered ledger link. */
  href?: string;
}

interface Props {
  rows: DivergingRow[];
  /** Name of the measure, e.g. "Contribution" (axis caption and tooltip). */
  measure: string;
  ariaLabel: string;
  format: (n: number) => string;
  labelWidth?: number;
  /** Called instead of following href (same-page filters). */
  onSelect?: (key: string) => void;
}

/** Largest first: positives on top, then negatives (most negative last), unknowns at the end. */
export function sortDiverging(rows: DivergingRow[]): DivergingRow[] {
  return [...rows].sort((a, b) => {
    if (a.value === null || b.value === null) return a.value === null ? (b.value === null ? a.label.localeCompare(b.label) : 1) : -1;
    return b.value - a.value || a.label.localeCompare(b.label);
  });
}

/** The value domain with room for the labels at the bar ends; ₹0 always inside. */
export function divergingDomain(values: number[], room = 0.3): { lo: number; hi: number; ticks: number[] } {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const ticks = niceTicks(min, max === 0 && min === 0 ? 1 : max, 6).filter((t) => t >= min - 1e-9 && t <= Math.max(max, 1) + 1e-9);
  const span = max - min || 1;
  const lo = min < 0 ? min - span * room : 0;
  const hi = max > 0 ? max + span * room : min < 0 ? span * 0.08 : 1;
  return { lo, hi, ticks: ticks.length ? ticks : [0] };
}

/**
 * Horizontal bars around a visible ₹0 axis: positives right in the gain colour, negatives left in the
 * loss colour, the value at each bar end, sorted by value; a thin bar under each shows its share of orders.
 * Each row is a link (or a button with onSelect) to the matching orders in the ledger.
 */
export function DivergingBars({ rows, measure, ariaLabel, format, labelWidth = 132, onSelect }: Props) {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const sorted = sortDiverging(rows);
  const known = sorted.map((r) => r.value).filter((v): v is number => v !== null);
  const { lo, hi, ticks } = divergingDomain(known);
  const span = hi - lo || 1;
  const pct = (v: number) => ((v - lo) / span) * 100;
  const zero = pct(0);
  const hasShare = sorted.some((r) => typeof r.share === 'number');

  const tipRows = (r: DivergingRow): TipRow[] => [
    { label: measure, value: r.value === null ? t('status.unknown') : format(r.value), tone: r.value !== null && r.value < 0 ? 'loss' : 'gain' },
    ...(typeof r.share === 'number' ? [{ label: t('chart.shareOfOrders', 'share of orders'), value: formatPct(r.share * 100), tone: 'muted' as const }] : []),
    ...(r.tip ?? []),
  ];
  const show = (r: DivergingRow, x: number, y: number) => setTip({ x, y, title: r.label, rows: tipRows(r) });
  const onMove = (r: DivergingRow) => (e: PointerEvent<HTMLElement>) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    show(r, Math.min(e.clientX - box.left + 14, box.width - 200), e.clientY - box.top + 14);
  };
  const onFocus = (r: DivergingRow) => (e: FocusEvent<HTMLElement>) => {
    const box = wrapRef.current?.getBoundingClientRect();
    const el = e.currentTarget.getBoundingClientRect();
    if (!box) return;
    show(r, Math.max(0, Math.min(el.left - box.left + labelWidth, box.width - 200)), el.bottom - box.top + 4);
  };

  return (
    <div className="dv" ref={wrapRef} style={{ ['--dv-label-w' as string]: `${labelWidth}px` }}>
      <div className="dv-axis" aria-hidden="true">
        <span className="dv-axis-unit">{t('chart.axisInr', '₹, {{measure}}', { measure: measure.toLowerCase() })}</span>
        <span className="dv-axis-track">
          {ticks.map((v) => (
            <span key={v} className={`dv-tick${v === 0 ? ' is-zero' : ''}`} style={{ left: `${pct(v)}%` }}>
              {compactInr(v)}
            </span>
          ))}
        </span>
      </div>
      <ul className="dv-rows" aria-label={ariaLabel}>
        {sorted.map((r) => {
          const neg = r.value !== null && r.value < 0;
          const a = r.value === null ? zero : pct(Math.min(0, r.value));
          const b = r.value === null ? zero : pct(Math.max(0, r.value));
          const valueText = r.value === null ? t('status.unknown') : format(r.value);
          const shareText = typeof r.share === 'number' ? t('chart.shareText', '{{pct}} of orders', { pct: formatPct(r.share * 100) }) : '';
          const label = [`${r.label}: ${measure} ${valueText}`, shareText, r.href || onSelect ? t('chart.openInLedger', 'open these orders in the ledger') : '']
            .filter(Boolean)
            .join(', ');
          const inner = (
            <>
              <span className="dv-label">
                <span className="dv-label-text">{r.label}</span>
                {r.sub ? <span className="dv-label-sub">{r.sub}</span> : null}
              </span>
              <span className="dv-track">
                {ticks.map((v) => (
                  <span key={v} className={`dv-grid${v === 0 ? ' is-zero' : ''}`} style={{ left: `${pct(v)}%` }} />
                ))}
                {r.value === null ? (
                  <span className="dv-value is-unknown" style={{ left: `${zero}%` }}>
                    {valueText}
                  </span>
                ) : (
                  <>
                    <span
                      className={`dv-bar ${neg ? 'is-neg' : 'is-pos'}`}
                      data-value={r.value}
                      style={{ left: `${a}%`, width: `${Math.max(b - a, r.value === 0 ? 0 : 0.5)}%` }}
                    />
                    <span className={`dv-value${neg ? ' is-neg' : ''}`} style={neg ? { right: `${100 - a}%` } : { left: `${b}%` }}>
                      {valueText}
                    </span>
                  </>
                )}
                {hasShare ? (
                  <span className="dv-share" aria-hidden="true">
                    <span className="dv-share-fill" style={{ width: `${Math.max(0, Math.min(1, r.share ?? 0)) * 100}%` }} />
                    {typeof r.share === 'number' ? (
                      <span className="dv-share-text" style={{ left: `${Math.max(0, Math.min(1, r.share)) * 100}%` }}>
                        {formatPct(r.share * 100)}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </span>
            </>
          );
          const common = {
            className: 'dv-row',
            'aria-label': label,
            onPointerMove: onMove(r),
            onPointerLeave: () => setTip(null),
            onFocus: onFocus(r),
            onBlur: () => setTip(null),
          };
          return (
            <li key={r.key} data-key={r.key}>
              {onSelect ? (
                <button type="button" {...common} onClick={() => onSelect(r.key)}>
                  {inner}
                </button>
              ) : r.href ? (
                <a href={r.href} {...common}>
                  {inner}
                </a>
              ) : (
                <div {...common} tabIndex={0}>
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ChartTip tip={tip} />
    </div>
  );
}
