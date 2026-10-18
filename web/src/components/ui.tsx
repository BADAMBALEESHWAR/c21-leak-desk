import { useId, type ReactNode } from 'react';
import type { ErrorInfo } from '../api/client';
import type { AttributionMode } from '../api/types';
import { Icon, type IconName } from './Icon';

/** Info icon with a tooltip on hover and keyboard focus. */
export function InfoTip({ text, label = 'More information' }: { text: ReactNode; label?: string }) {
  const id = useId();
  return (
    <span className="infotip">
      <button type="button" className="infotip-btn" aria-label={label} aria-describedby={id}>
        <Icon name="info" size={15} />
      </button>
      <span role="tooltip" id={id} className="infotip-bubble">
        {text}
      </span>
    </span>
  );
}

export function Skeleton({ width, height = 14, className }: { width?: number | string; height?: number; className?: string }) {
  return <span className={['skeleton', className].filter(Boolean).join(' ')} style={{ width, height }} aria-hidden="true" />;
}

/** Placeholder card grid while an analysis loads. */
export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="kpi-grid" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card kpi">
          <Skeleton width="45%" height={12} />
          <Skeleton width="70%" height={28} className="skeleton-gap" />
          <Skeleton width="35%" height={12} className="skeleton-gap" />
        </div>
      ))}
    </div>
  );
}

interface StatProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: IconName;
  tone?: 'default' | 'primary' | 'success' | 'danger' | 'warning';
  large?: boolean;
  /** Only on static cards; an action card explains itself in what it opens. */
  info?: ReactNode;
  /** Makes the whole card one button. */
  onClick?: () => void;
  /** Accessible name for the action, e.g. "Gross sales ₹ 28,400 — open period waterfall". */
  actionLabel?: string;
  actionIcon?: IconName;
  pressed?: boolean;
  /** An "Ask Profyn" button shown beside the card (outside its own button). */
  ask?: ReactNode;
}

/** KPI tile: label, value, optional sub line. With onClick the whole card is a single button. */
export function StatCard({ ask, ...props }: StatProps) {
  const card = <StatTile {...props} />;
  return ask ? (
    <div className="kpi-slot">
      {card}
      {ask}
    </div>
  ) : (
    card
  );
}

function StatTile({ label, value, sub, icon, tone = 'default', large, info, onClick, actionLabel, actionIcon = 'arrow-up-right', pressed }: Omit<StatProps, 'ask'>) {
  const cls = `card kpi kpi-${tone}${large ? ' kpi-large' : ''}`;
  const head = (
    <span className="kpi-head">
      {icon ? (
        <span className={`kpi-icon kpi-icon-${tone}`} aria-hidden="true">
          <Icon name={icon} size={16} />
        </span>
      ) : null}
      <span className="kpi-label">{label}</span>
      {!onClick && info ? <InfoTip text={info} label={`About ${label.toLowerCase()}`} /> : null}
    </span>
  );
  const body = (
    <>
      {head}
      <span className="kpi-value">{value}</span>
      {sub ? <span className="kpi-sub">{sub}</span> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={`${cls} kpi-action`} onClick={onClick} aria-label={actionLabel} aria-pressed={pressed}>
        {body}
        <span className="kpi-go" aria-hidden="true">
          <Icon name={actionIcon} size={16} />
        </span>
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}

const flashTimers = new WeakMap<HTMLElement, number>();

/** Scroll an element into view, smoothly unless the reader asked for reduced motion, then flash it. */
export function revealElement(el: HTMLElement | null, focus = true) {
  if (!el) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  // One timer per element, so a quick second reveal is not cut short by the first.
  const previous = flashTimers.get(el);
  if (previous !== undefined) window.clearTimeout(previous);
  el.classList.remove('is-flash');
  void el.offsetWidth;
  el.classList.add('is-flash');
  flashTimers.set(
    el,
    window.setTimeout(() => {
      el.classList.remove('is-flash');
      flashTimers.delete(el);
    }, 1600),
  );
  if (focus) el.focus({ preventScroll: true });
}

type CalloutTone = 'info' | 'success' | 'warning' | 'danger' | 'primary';
const CALLOUT_ICON: Record<CalloutTone, IconName> = {
  info: 'info',
  success: 'check-circle',
  warning: 'alert-triangle',
  danger: 'alert-triangle',
  primary: 'sparkles',
};

export function Callout({ tone, title, children, className, role }: { tone: CalloutTone; title?: ReactNode; children?: ReactNode; className?: string; role?: string }) {
  return (
    <div className={['callout', `callout-${tone}`, className].filter(Boolean).join(' ')} role={role}>
      <span className="callout-icon" aria-hidden="true">
        <Icon name={CALLOUT_ICON[tone]} size={18} />
      </span>
      <div className="callout-body">
        {title ? <p className="callout-title">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}

/** An API error as stated: what went wrong, how to fix it, and which fields. */
export function ErrorCallout({ error, className }: { error: ErrorInfo | null; className?: string }) {
  if (!error) return null;
  return (
    <Callout tone="danger" title={error.message} className={className} role="alert">
      {error.hint ? <p className="callout-hint">{error.hint}</p> : null}
      {error.issues.length > 0 ? (
        <ul className="issues">
          {error.issues.map((i, n) => (
            <li key={`${i.path}-${n}`}>
              <code className="path">{i.path || 'file'}</code> {i.message}
            </li>
          ))}
        </ul>
      ) : null}
    </Callout>
  );
}

export function EmptyPanel({ icon, title, children, actions }: { icon: IconName; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card empty-panel">
      <span className="empty-icon" aria-hidden="true">
        <Icon name={icon} size={26} />
      </span>
      <p className="empty-title">{title}</p>
      {children ? <div className="empty-text">{children}</div> : null}
      {actions ? <div className="empty-actions">{actions}</div> : null}
    </div>
  );
}

const ATTRIBUTION_OPTIONS: Array<{ value: AttributionMode; label: string; long: string }> = [
  { value: 'allocate', label: 'Allocate ads', long: 'Allocate ads per order' },
  { value: 'channel', label: 'Channel spend', long: 'Deduct channel spend at channel level' },
];

/** Two-way segmented control for the attribution mode (radio semantics). */
export function AttributionSegmented({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: AttributionMode;
  onChange: (v: AttributionMode) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="segmented" disabled={disabled}>
      <legend className="visually-hidden">Attribution</legend>
      {ATTRIBUTION_OPTIONS.map((o) => (
        <label key={o.value} className="segmented-item" title={o.long}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>{compact ? o.label : o.long}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Collapsible card section using native details/summary; optionally controlled. */
export function Collapsible({
  title,
  children,
  defaultOpen,
  meta,
  open,
  onToggle,
  id,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  meta?: ReactNode;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  id?: string;
}) {
  return (
    <details
      id={id}
      tabIndex={-1}
      className="card collapsible"
      open={open ?? defaultOpen}
      onToggle={onToggle ? (e) => onToggle((e.currentTarget as HTMLDetailsElement).open) : undefined}
    >
      <summary>
        <span className="collapsible-title">{title}</span>
        {meta ? <span className="collapsible-meta">{meta}</span> : null}
        <Icon name="chevron-down" size={18} className="collapsible-chevron" />
      </summary>
      <div className="collapsible-body">{children}</div>
    </details>
  );
}
