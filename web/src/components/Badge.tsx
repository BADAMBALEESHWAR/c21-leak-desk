import type { ReactNode } from 'react';
import type { Confidence } from '../api/types';
import { Icon, type IconName } from './Icon';

export type PillTone = 'gain' | 'loss' | 'unknown' | 'success' | 'danger' | 'warning' | 'primary' | 'neutral' | 'teal' | 'outline';

const TONE_ALIAS: Record<PillTone, string> = {
  gain: 'success',
  loss: 'danger',
  unknown: 'warning',
  success: 'success',
  danger: 'danger',
  warning: 'warning',
  primary: 'primary',
  neutral: 'neutral',
  teal: 'teal',
  outline: 'outline',
};

interface PillProps {
  tone: PillTone;
  children: ReactNode;
  title?: string;
  icon?: IconName;
  dot?: boolean;
  className?: string;
}

/** Small rounded label. Colour always comes with a word, never alone. */
export function Pill({ tone, children, title, icon, dot, className }: PillProps) {
  return (
    <span className={['pill', `pill-${TONE_ALIAS[tone]}`, className].filter(Boolean).join(' ')} title={title}>
      {dot ? <span className="pill-dot" aria-hidden="true" /> : null}
      {icon ? <Icon name={icon} size={13} strokeWidth={2} /> : null}
      {children}
    </span>
  );
}

/** Kept for existing callers: gain / loss / unknown pills. */
export function Badge({ variant, children, title }: { variant: 'gain' | 'loss' | 'unknown'; children: ReactNode; title?: string }) {
  return (
    <Pill tone={variant} title={title}>
      {children}
    </Pill>
  );
}

/** Shown wherever a value is null. Never rendered as 0. */
export function Unknown({ title }: { title?: string }) {
  return (
    <Pill tone="unknown" title={title ?? 'Not in the source data'}>
      unknown
    </Pill>
  );
}

export function ConfidenceBadge({ confidence, prefix }: { confidence: Confidence; prefix?: string }) {
  const text = prefix ? `${prefix} ${confidence}` : confidence;
  if (confidence === 'high') return <Pill tone="success">{text}</Pill>;
  if (confidence === 'low') return <Pill tone="warning">{text}</Pill>;
  return (
    <Pill tone="unknown" title="Confidence is unknown while facts are missing">
      {text}
    </Pill>
  );
}

/** Where narrative text came from: the deterministic template or AI wording. */
export function SourceTag({ source }: { source: 'template' | 'ai' }) {
  if (source === 'ai') {
    return (
      <span className="pill pill-ai">
        <Icon name="sparkles" size={12} strokeWidth={2} />
        AI
      </span>
    );
  }
  return <span className="pill pill-outline pill-xs">template</span>;
}
