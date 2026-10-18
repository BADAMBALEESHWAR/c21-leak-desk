import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { BRAND } from '../brand';
import { DEMO_MEDIA } from './content';
import { count, inr } from './format';
import { Icon } from './icons';
import { LINKS } from './shared';

/*
 * What the page can show, best first: the recording, its poster frame, or a card that points to the live demo.
 * The browser answers by firing error on the <source> or the <img>; the answer is kept for the whole page,
 * so the section and the modal agree and a missing file is asked for once.
 */
type Stage = 'video' | 'poster' | 'card';
const ORDER: readonly Stage[] = ['video', 'poster', 'card'];
let stage: Stage = 'video';
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function fallBackFrom(from: Stage) {
  const next = ORDER[ORDER.indexOf(from) + 1];
  if (!next || ORDER.indexOf(next) <= ORDER.indexOf(stage)) return;
  stage = next;
  listeners.forEach((fn) => fn());
}

const useStage = () => useSyncExternalStore(subscribe, () => stage);

function ComingSoon() {
  const { t } = useTranslation();
  return (
    <div className="l-soon">
      <span className="l-soon-icon" aria-hidden="true">
        <Icon name="play" size={20} />
      </span>
      <p className="l-soon-title">{t('landing.videoSoon', 'Demo video coming shortly')}</p>
      <p className="l-soon-text">{t('landing.videoSoonText', 'Meanwhile, the live demo walks through the same steps on synthetic data.')}</p>
      <a className="l-btn l-btn-on-dark" href={LINKS.demo}>
        {t('landing.tryLiveDemo', 'Try the live demo')}
        <Icon name="arrow-right" size={16} />
      </a>
    </div>
  );
}

/** The recording at 16:9 with native controls; until the file exists, its poster or a card, never a broken player. */
function DemoPlayer() {
  const { t } = useTranslation();
  const current = useStage();
  const [ready, setReady] = useState(false);

  if (current === 'video') {
    return (
      <div className={`l-player${ready ? ' is-ready' : ''}`}>
        <video
          className="l-player-video"
          controls
          preload="metadata"
          playsInline
          poster={DEMO_MEDIA.poster}
          aria-label={t('landing.videoTitle', '{{brand}} in two minutes', { brand: BRAND.name })}
          onLoadedMetadata={() => setReady(true)}
        >
          <source src={DEMO_MEDIA.video} type="video/mp4" onError={() => fallBackFrom('video')} />
          {DEMO_MEDIA.hasCaptions ? <track kind="captions" src={DEMO_MEDIA.captions} srcLang="en" label={t('lang.en')} /> : null}
        </video>
      </div>
    );
  }
  return (
    <div className="l-player is-soon">
      {current === 'poster' ? <img className="l-player-poster" src={DEMO_MEDIA.poster} alt="" onError={() => fallBackFrom('poster')} /> : null}
      <ComingSoon />
    </div>
  );
}

/** "See it in action": the player is created only once its frame scrolls into view. */
export function SeeItInAction() {
  const { t } = useTranslation();
  const slot = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = slot.current;
    if (!el || inView) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);

  const proof = [
    { value: inr(230), label: t('landing.proofWorked', 'worked order reproduced') },
    { value: inr(7053), label: t('landing.proofReconciled', 'reconciled both ways') },
    { value: '160+', label: t('landing.proofTests', 'tests') },
    { value: count(10000), label: t('landing.proofScale', 'orders in under 1 s') },
  ];

  return (
    <section id="see-it" className="l-watch" aria-labelledby="see-it-title">
      <div className="l-wrap">
        <div className="l-watch-inner">
          <h2 id="see-it-title" className="l-watch-title">
            {t('landing.seeItTitle', 'See it in action')}
          </h2>
          <figure className="l-watch-figure">
            <div ref={slot}>{inView ? <DemoPlayer /> : <div className="l-player" aria-hidden="true" />}</div>
            <figcaption className="l-watch-foot">
              <span className="l-watch-caption">{t('landing.seeItCaption', 'Import → Ledger → Leaks → Scenario → Decision in two minutes')}</span>
              <a className="l-watch-link" href={LINKS.demo}>
                {t('landing.openDemoInApp', 'Open the demo in the app')}
                <Icon name="arrow-right" size={16} />
              </a>
            </figcaption>
          </figure>
          <ul className="l-proof" aria-label={t('landing.proofLabel', 'Checked by the test suite')}>
            {proof.map((p) => (
              <li key={p.value}>
                <strong className="l-proof-value num">{p.value}</strong>
                <span className="l-proof-label">{p.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';

/** Centred player. Escape or a backdrop click closes it; Tab stays inside; focus goes back to the button that opened it. */
export function WatchModal({ onClose, returnFocus }: { onClose: () => void; returnFocus: RefObject<HTMLElement> }) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const downOnBackdrop = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const root = document.getElementById('root');
    const trigger = returnFocus.current;
    const overflow = document.body.style.overflow;
    root?.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';
    document.querySelectorAll('video').forEach((v) => {
      if (!panel.current?.contains(v)) v.pause();
    });
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      root?.removeAttribute('inert');
      document.body.style.overflow = overflow;
      trigger?.focus();
    };
  }, [returnFocus]);

  /** Guards at both ends wrap Tab around, leaving the video's own controls in their native order. */
  const focusEdge = (last: boolean) => {
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    for (const el of last ? items.reverse() : items) {
      el.focus();
      if (document.activeElement === el) return;
    }
  };

  return createPortal(
    <div
      className="l-modal"
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) close.current();
      }}
    >
      <span className="l-guard" tabIndex={0} onFocus={() => focusEdge(true)} />
      <div ref={panel} className="l-modal-panel" role="dialog" aria-modal="true" aria-labelledby="watch-title">
        <div className="l-modal-head">
          <h2 id="watch-title" className="l-modal-title">
            {t('landing.videoTitle', '{{brand}} in two minutes', { brand: BRAND.name })}
          </h2>
          <button ref={closeBtn} type="button" className="l-modal-close" aria-label={t('landing.close', 'Close')} onClick={() => close.current()}>
            <Icon name="x" size={20} />
          </button>
        </div>
        <DemoPlayer />
        <p className="l-modal-note">{t('landing.demoDisclaimer', 'Demo uses synthetic data. Not a live production system.')}</p>
      </div>
      <span className="l-guard" tabIndex={0} onFocus={() => focusEdge(false)} />
    </div>,
    document.body,
  );
}
