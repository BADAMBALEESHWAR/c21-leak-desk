import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';

/**
 * A button that opens a small panel beside it. Closes on Escape, on a click outside, and on a second click.
 * The panel is part of the page (not a modal), so reading it never traps focus.
 */
export function Popover({
  label,
  trigger,
  title,
  children,
  align = 'right',
  triggerClassName,
  className,
}: {
  /** Accessible name of the trigger. */
  label: string;
  /** What the trigger shows; defaults to a round "?". */
  trigger?: ReactNode;
  title?: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  triggerClassName?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // The drawer also closes on Escape; this popover takes the key first.
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <span className={['popover', className].filter(Boolean).join(' ')} ref={ref}>
      <button
        ref={btn}
        type="button"
        className={triggerClassName ?? 'help-btn'}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger ?? <span aria-hidden="true">?</span>}
      </button>
      {open ? (
        <span id={id} role="region" aria-label={label} className={`popover-panel popover-${align}`}>
          {title ? <span className="popover-title">{title}</span> : null}
          {children}
        </span>
      ) : null}
    </span>
  );
}

/** The Ledger's "Definitions" button: the three formulas every figure on the page follows. */
export function Definitions() {
  const { t } = useTranslation();
  return (
    <Popover
      label={t('definitions.button', 'Definitions')}
      title={t('definitions.title', 'How the ledger counts')}
      triggerClassName="btn btn-secondary btn-sm"
      className="popover-wide"
      trigger={
        <>
          <Icon name="info" size={15} />
          <span>{t('definitions.button', 'Definitions')}</span>
        </>
      }
    >
      <dl className="defs">
        <div>
          <dt>{t('definitions.netRevenueTerm', 'Net revenue')}</dt>
          <dd>
            <code className="formula">{t('definitions.netRevenue', 'net revenue = revenue − refund')}</code>
            <span className="defs-note">{t('definitions.netRevenueNote', 'Revenue is gross sales after discount; the same figure as net sales.')}</span>
          </dd>
        </div>
        <div>
          <dt>{t('definitions.npcTerm', 'Net product cost')}</dt>
          <dd>
            <code className="formula">{t('definitions.npc', 'net product cost = product cost − recovered product cost')}</code>
            <span className="defs-note">{t('definitions.npcNote', 'Stock that comes back from a return is subtracted once, never twice.')}</span>
          </dd>
        </div>
        <div>
          <dt>{t('definitions.feeTerm', 'Payment fee')}</dt>
          <dd>
            <span className="defs-note">{t('definitions.fee', 'Deducted separately, on its own line; never folded into shipping or product cost.')}</span>
          </dd>
        </div>
        <div>
          <dt>{t('definitions.lateTerm', 'Late refund')}</dt>
          <dd>
            <span className="defs-note">
              {t(
                'definitions.late',
                'A refund dated after the period end is a prior-period adjustment: the period total stays as reported, and the restated total is shown next to it.',
              )}
            </span>
          </dd>
        </div>
      </dl>
    </Popover>
  );
}
