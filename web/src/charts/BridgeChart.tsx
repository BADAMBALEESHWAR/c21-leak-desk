import { useTranslation } from 'react-i18next';
import type { BridgeLine } from '../api/types';
import { Pill } from '../components/Badge';
import { Money } from '../components/Money';
import { apiText } from '../lib/apiText';
import { formatInr } from '../lib/format';

interface Props {
  lines: BridgeLine[];
  /** The line to highlight: gross, net_sales or contribution. */
  focus: string;
  /** Line keys that include an estimate (handling from the config default). */
  estimated?: string[];
}

/**
 * Period waterfall from the engine's bridge. The start and subtotal bars run from zero,
 * deductions float from the running total, the total runs from zero. Every line is labelled.
 */
export function BridgeChart({ lines, focus, estimated = [] }: Props) {
  const { t } = useTranslation();
  // Positions only; every amount shown comes straight from the bridge.
  let running = 0;
  const segs = lines.map((l) => {
    if (l.kind === 'deduction') {
      const from = running;
      running += l.amount_inr;
      return { l, from, to: running };
    }
    running = l.amount_inr;
    return { l, from: 0, to: l.amount_inr };
  });
  const pts = [0, ...segs.flatMap((s) => [s.from, s.to])];
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const pct = (v: number) => ((v - min) / span) * 100;

  const barClass = (l: BridgeLine) => {
    if (l.kind === 'start') return 'wf-start';
    if (l.kind === 'subtotal') return 'wf-sub';
    if (l.kind === 'total') return l.amount_inr < 0 ? 'wf-neg' : 'wf-pos';
    return 'wf-ded';
  };

  const summary = t('chart.periodWaterfall', 'Period waterfall: {{lines}}.', { lines: lines.map((l) => `${apiText(l.label)} ${formatInr(l.amount_inr)}`).join(', ') });

  return (
    <div className="wf bridge" role="img" aria-label={summary}>
      {segs.map(({ l, from, to }) => {
        const lo = Math.min(from, to);
        const hi = Math.max(from, to);
        const isFocus = l.key === focus;
        return (
          <div
            key={l.key}
            className={`wf-row bridge-${l.kind}${isFocus ? ' is-focus' : ''}${l.amount_inr === 0 && l.kind === 'deduction' ? ' is-zero' : ''}`}
            aria-current={isFocus ? 'true' : undefined}
          >
            <span className="wf-label">
              {apiText(l.label)}
              {estimated.includes(l.key) ? (
                <>
                  {' '}
                  <Pill tone="warning">{t('chart.estimated', 'estimated')}</Pill>
                </>
              ) : null}
            </span>
            <span className="wf-track">
              {min < 0 ? <span className="wf-zero" style={{ left: `${pct(0)}%` }} /> : null}
              {hi - lo > 1e-9 ? <span className={`wf-bar ${barClass(l)}`} style={{ left: `${pct(lo)}%`, width: `${Math.max(pct(hi) - pct(lo), 0.8)}%` }} /> : null}
            </span>
            <span className="wf-value">
              {l.kind === 'deduction' ? <Money value={l.amount_inr} muteZero /> : <Money value={l.amount_inr} tone={l.kind === 'total' ? 'contribution' : 'plain'} />}
            </span>
          </div>
        );
      })}
    </div>
  );
}
