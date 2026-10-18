import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from './Button';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Pills or a short line under the title. */
  meta?: ReactNode;
  children: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Right-hand drawer, 440px. Slides in over 200 ms (none under prefers-reduced-motion).
 * Escape closes; focus moves in on open, is kept inside, and returns on close.
 */
export function Drawer({ open, onClose, title, meta, children }: DrawerProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      const active = document.activeElement;
      returnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
      const frame = window.requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
      return () => window.cancelAnimationFrame(frame);
    }
    const el = returnFocus.current;
    returnFocus.current = null;
    if (el && document.contains(el)) el.focus({ preventScroll: true });
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <div className={`scrim${open ? ' is-open' : ''}`} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="drawer"
        data-open={open ? 'true' : 'false'}
        onKeyDown={onKeyDown}
      >
        <div className="drawer-head">
          <div className="drawer-head-text">
            <h2 id={titleId} className="drawer-title">
              {title}
            </h2>
            {meta ? <div className="drawer-meta">{meta}</div> : null}
          </div>
          <IconButton icon="x" label={t('drawer.close', 'Close')} onClick={onClose} />
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </>
  );
}
