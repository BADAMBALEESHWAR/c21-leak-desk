import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { loginHref } from '../auth/auth';
import { BRAND, DEMO_URL } from '../brand';
import { LogoMark } from '../components/LogoMark';

/** Where the public pages send people. No API calls: these are plain links. */
export const LINKS = {
  demo: DEMO_URL,
  signIn: loginHref(),
  signUp: `${loginHref()}&mode=signup`,
} as const;

export function Wordmark({ onDark = false, label }: { onDark?: boolean; label?: string }) {
  const { t } = useTranslation();
  return (
    <a className={`l-wordmark${onDark ? ' on-dark' : ''}`} href="/" aria-label={label ?? t('landing.homeLabel', '{{brand}} home', { brand: BRAND.name })}>
      <span className="l-mark" aria-hidden="true">
        <LogoMark size={32} onDark={onDark} />
      </span>
      <span>{BRAND.name}</span>
    </a>
  );
}

export function Spinner() {
  return <span className="l-spinner" aria-hidden="true" />;
}

/** Width of an element, for charts that draw at their real size (text never scales with the viewport). */
export function useWidth<T extends HTMLElement>(initial: number): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width) || initial);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [initial]);
  return [ref, width];
}
