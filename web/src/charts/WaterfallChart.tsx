import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { LineSource, WaterfallLine } from '../api/types';
import { Unknown } from '../components/Badge';
import { Money } from '../components/Money';
import { apiText } from '../lib/apiText';
import { formatInr } from '../lib/format';
import { SOURCE_TAG } from '../lib/labels';

interface Props {
  lines: WaterfallLine[];
  contribution: number | null;
  label?: string;
}

/**
 * Horizontal waterfall: the start bar runs from zero, each deduction floats from the running
 * total, and the result runs from zero again. One scale for every bar; values are labelled.
 */
export function WaterfallChart({ lines, contribution, label: labelProp }: Props) {
  const { t } = useTranslation();
  const label = labelProp ?? t('ledger.contribution', 'Contribution');
  let running = 0;
  const segs = lines.map((line) => {
    if (line.amount_inr === null) return { line, from: null as number | null, to: null as number | null };
    if (line.kind === 'start') {
      running = line.amount_inr;
      return { line, from: 0, to: line.amount_inr };
    }
    const from = running;
    running += line.amount_inr;
    return { line, from, to: running };
  });

  const pts = [0, contribution ?? 0];
  for (const s of segs) if (s.from !== null && s.to !== null) pts.push(s.from, s.to);
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const pct = (v: number) => ((v - min) / span) * 100;
  const zero = pct(0);

  const bar = (from: number, to: number, cls: string) => {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    if (hi - lo < 1e-9) return null;
    return <span className={`wf-bar ${cls}`} style={{ left: `${pct(lo)}%`, width: `${Math.max(pct(hi) - pct(lo), 0.8)}%` }} />;
  };

  const unknown = t('chart.unknown', 'unknown');
  const summary = t('chart.waterfallSummary', '{{label}} waterfall: {{lines}}; {{label}} {{value}}.', {
    label,
    lines: lines.map((l) => `${apiText(l.label)} ${l.amount_inr === null ? unknown : formatInr(l.amount_inr)}`).join(', '),
    value: contribution === null ? unknown : formatInr(contribution),
  });

  return (
    <div className="wf" role="img" aria-label={summary}>
      {segs.map(({ line, from, to }) => (
        <div key={line.key} className={`wf-row${line.amount_inr === 0 ? ' is-zero' : ''}`}>
          <span className="wf-label">{apiText(line.label)}</span>
          <span className="wf-track">
            {min < 0 ? <span className="wf-zero" style={{ left: `${zero}%` }} /> : null}
            {from !== null && to !== null ? bar(from, to, line.kind === 'start' ? 'wf-start' : 'wf-ded') : null}
          </span>
          <span className="wf-value">
            {line.amount_inr === null ? (
              <Unknown />
            ) : line.kind === 'start' ? (
              <span className="num">{formatInr(line.amount_inr)}</span>
            ) : (
              <Money value={line.amount_inr} muteZero />
            )}
          </span>
        </div>
      ))}
      <div className="wf-row wf-total">
        <span className="wf-label">{label}</span>
        <span className="wf-track">
          {min < 0 ? <span className="wf-zero" style={{ left: `${zero}%` }} /> : null}
          {contribution !== null ? bar(0, contribution, contribution < 0 ? 'wf-neg' : 'wf-pos') : null}
        </span>
        <span className="wf-value">
          <Money value={contribution} tone="contribution" />
        </span>
      </div>
    </div>
  );
}

/** A line's source tag in the UI language (SOURCE_TAG keeps the English, which says which sources get a tag). */
function sourceTag(t: TFunction, source: LineSource): string | undefined {
  const en = SOURCE_TAG[source];
  if (!en) return undefined;
  switch (source) {
    case 'derived':
      return t('chart.source.derived', 'derived');
    case 'config_default':
      return t('chart.source.configDefault', 'config default');
    case 'not_supplied':
      return t('chart.source.notSupplied', 'not in source');
    case 'moved_to_channel':
      return t('chart.source.movedToChannel', 'moved to channel');
    case 'not_recognised':
      return t('chart.source.notRecognised', 'not recognised');
    default:
      return en;
  }
}

/** The lines that carry a note or a non-input source, listed under the chart. */
export function WaterfallNotes({ lines }: { lines: WaterfallLine[] }) {
  const { t } = useTranslation();
  const noted = lines.filter((l) => l.note || SOURCE_TAG[l.source]);
  if (noted.length === 0) return null;
  return (
    <ul className="wf-notes">
      {noted.map((l) => {
        const tag = sourceTag(t, l.source);
        return (
          <li key={l.key}>
            <p className="wf-note-head">
              <strong>{apiText(l.label)}</strong>
              {tag ? <span className="pill pill-outline pill-xs">{tag}</span> : null}
            </p>
            {l.note ? <p className="wf-note">{apiText(l.note)}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
