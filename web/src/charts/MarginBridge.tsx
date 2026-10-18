import { useTranslation } from 'react-i18next';
import { formatInr, formatMarginPct } from '../lib/format';
import { compactInr, niceTicks } from './scale';

export interface BridgeStep {
  key: string;
  label: string;
  /** start: from ₹0 · drop: a deduction from the running figure · subtotal: the running figure from ₹0. */
  kind: 'start' | 'drop' | 'subtotal';
  from: number;
  to: number;
  /** Share of net revenue, for subtotals. */
  pct?: number | null;
  /** A small tag after the label, e.g. "allocated, not caused" or "assumed". */
  note?: string;
}

interface Props {
  steps: BridgeStep[];
  ariaLabel: string;
}

/** The figures as steps: revenue, its deductions and the running margins. */
export function bridgeDomain(steps: BridgeStep[]): { lo: number; hi: number; ticks: number[] } {
  const vals = steps.flatMap((s) => [s.from, s.to]);
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const ticks = niceTicks(min, max || 1, 4).filter((t) => t >= min - 1e-9 && t <= (max || 1) + 1e-9);
  const span = max - min || 1;
  return { lo: min < 0 ? min - span * 0.04 : 0, hi: max + span * 0.24, ticks };
}

/**
 * Horizontal bridge from net revenue down to CM1, CM2, CM3 and the estimated net: each deduction floats where
 * it bites, each margin is a bar from ₹0 with its share of net revenue. Values sit at the bar ends.
 */
export function MarginBridge({ steps, ariaLabel }: Props) {
  const { t } = useTranslation();
  if (steps.length === 0) return null;
  const { lo, hi, ticks } = bridgeDomain(steps);
  const span = hi - lo || 1;
  const pct = (v: number) => ((v - lo) / span) * 100;
  return (
    <div className="mb">
      <div className="mb-axis" aria-hidden="true">
        <span className="mb-axis-unit" />
        <span className="mb-axis-track">
          {ticks.map((v) => (
            <span key={v} className="dv-tick" style={{ left: `${pct(v)}%` }}>
              {compactInr(v)}
            </span>
          ))}
        </span>
      </div>
      <ol className="mb-rows" aria-label={ariaLabel}>
        {steps.map((s) => {
          const a = pct(Math.min(s.from, s.to));
          const b = pct(Math.max(s.from, s.to));
          const amount = s.kind === 'drop' ? s.to - s.from : s.to;
          const neg = s.kind !== 'drop' && s.to < 0;
          const valueText = s.kind === 'drop' ? `${amount <= 0 ? '−' : '+'}${formatInr(Math.abs(amount))}` : formatInr(s.to);
          const pctText = s.kind !== 'drop' && typeof s.pct === 'number' ? t('chart.ofRevenue', '{{pct}} of net revenue', { pct: formatMarginPct(s.pct) }) : '';
          return (
            <li key={s.key} className={`mb-row mb-${s.kind}`} data-key={s.key}>
              <span className="mb-label">
                <span className="mb-label-text">
                  {s.kind === 'drop' ? <span aria-hidden="true">− </span> : s.kind === 'subtotal' ? <span aria-hidden="true">= </span> : null}
                  {s.label}
                </span>
                {s.note ? <span className="mb-note">{s.note}</span> : null}
              </span>
              <span className="mb-track">
                {ticks.map((v) => (
                  <span key={v} className={`dv-grid${v === 0 ? ' is-zero' : ''}`} style={{ left: `${pct(v)}%` }} />
                ))}
                <span
                  className={`mb-bar ${s.kind === 'drop' ? 'is-drop' : s.kind === 'start' ? 'is-start' : neg ? 'is-neg' : 'is-pos'}`}
                  style={{ left: `${a}%`, width: `${Math.max(b - a, 0.4)}%` }}
                />
                <span className={`mb-value${neg || s.kind === 'drop' ? ' is-neg' : ''}`} style={{ left: `calc(${b}% + 6px)` }}>
                  {valueText}
                  {pctText ? <span className="mb-pct"> · {pctText}</span> : null}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
