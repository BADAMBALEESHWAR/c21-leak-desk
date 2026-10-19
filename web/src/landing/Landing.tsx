import { useCallback, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { BRAND } from '../brand';
import { LANGS, setLanguage } from '../i18n';
import { CHANGELOG_URL, DEMO_MEDIA, FAQ, FEATURES, HERO, SOURCES, STEPS, TRUST } from './content';
import { SeeItInAction, WatchModal } from './DemoVideo';
import { HeroDashboard } from './HeroDashboard';
import { Icon } from './icons';
import { Integrations } from './Integrations';
import { Pricing } from './Pricing';
import { LINKS, Wordmark } from './shared';

/** Section links; label is a translation key. */
const NAV = [
  { href: '#features', label: 'landing.product' },
  { href: '#how', label: 'landing.how' },
  { href: '#pricing', label: 'landing.pricing' },
  { href: '#faq', label: 'landing.faq' },
];

/** The tagline as the headline, with its second sentence in the accent colour. */
function Tagline() {
  const { t } = useTranslation();
  const [first, ...rest] = t('tagline').split(/(?<=[.।])\s+/);
  return (
    <h1 id="hero-title" className="l-h1">
      {first} <span className="l-accent">{rest.join(' ')}</span>
    </h1>
  );
}

/** English · हिन्दी · తెలుగు, each in its own script; the current one is pressed. */
function LanguageSwitch({ className }: { className: string }) {
  const { t, i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? i18n.language;
  return (
    <div className={`l-lang ${className}`} role="group" aria-label={t('lang.label')}>
      {LANGS.map((l) => (
        <button key={l} type="button" lang={l} aria-pressed={current === l} onClick={() => setLanguage(l)}>
          {t(`lang.${l}`)}
        </button>
      ))}
    </div>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  const burger = useRef<HTMLButtonElement>(null);
  const { t, i18n } = useTranslation();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // The menu closes once the burger is gone; where that happens depends on the language (landing.css).
    const onResize = () => {
      if (burger.current && getComputedStyle(burger.current).display === 'none') setOpen(false);
    };
    onResize();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open, i18n.language]);

  return (
    <header className={`l-nav${open ? ' is-open' : ''}`}>
      <div className="l-wrap l-nav-inner">
        <Wordmark />
        <nav className="l-nav-links" aria-label={t('landing.navSections', 'Sections')}>
          {NAV.map((n) => (
            <a key={n.href} href={n.href}>
              {t(n.label)}
            </a>
          ))}
        </nav>
        <div className="l-nav-actions">
          <LanguageSwitch className="l-lang-bar" />
          <a className="l-btn l-btn-ghost l-hide-sm" href={LINKS.signIn}>
            {t('actions.signIn')}
          </a>
          <a className="l-btn l-btn-primary l-btn-sm" href={LINKS.demo}>
            {t('actions.tryDemo')}
          </a>
          <button
            ref={burger}
            type="button"
            className="l-burger"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? t('landing.closeMenu', 'Close menu') : t('landing.openMenu', 'Open menu')}
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name={open ? 'x' : 'menu'} size={22} />
          </button>
        </div>
      </div>
      <div id="mobile-menu" className="l-menu" hidden={!open}>
        <nav className="l-wrap" aria-label={t('landing.menu', 'Menu')}>
          <ul className="l-menu-list">
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={n.href} onClick={() => setOpen(false)}>
                  {t(n.label)}
                  <Icon name="arrow-right" size={16} />
                </a>
              </li>
            ))}
          </ul>
          <LanguageSwitch className="l-lang-menu" />
          <div className="l-menu-cta">
            {/* Shown only where the header has no room for its demo button. */}
            <a className="l-btn l-btn-primary l-btn-block l-menu-demo" href={LINKS.demo}>
              {t('actions.tryDemo')}
              <Icon name="arrow-right" size={16} />
            </a>
            <a className="l-btn l-btn-secondary l-btn-block" href={LINKS.signIn}>
              {t('actions.signIn')}
            </a>
            <a className="l-btn l-btn-primary l-btn-block" href={LINKS.signUp}>
              {t('landing.createAccount', 'Create account')}
            </a>
          </div>
        </nav>
      </div>
    </header>
  );
}

function SectionHead({ kicker, title, lead, id, center = false }: { kicker: string; title: string; lead?: string; id: string; center?: boolean }) {
  return (
    <div className={`l-head${center ? ' is-center' : ''}`}>
      <p className="l-kicker">{kicker}</p>
      <h2 id={id} className="l-h2">
        {title}
      </h2>
      {lead ? <p className="l-lead">{lead}</p> : null}
    </div>
  );
}

export function Landing() {
  const { t } = useTranslation();
  const [watching, setWatching] = useState(false);
  const watchBtn = useRef<HTMLButtonElement>(null);
  const closeWatch = useCallback(() => setWatching(false), []);
  return (
    <>
      <a className="l-skip" href="#main">
        {t('landing.skip', 'Skip to content')}
      </a>
      <Header />

      <main id="main" tabIndex={-1}>
        {/* Hero */}
        <section className="l-hero" aria-labelledby="hero-title">
          <div className="l-wrap l-hero-grid">
            <div className="l-hero-text">
              <p className="l-pill">
                <span className="l-pill-dot" aria-hidden="true" />
                {t(HERO.eyebrow.key, HERO.eyebrow.text)}
              </p>
              <Tagline />
              <p className="l-hero-lead">
                {t(HERO.lead.key, HERO.lead.text)
                  .split(/(?<=[.।])\s+/)
                  .map((line) => (
                    <span key={line}>{line} </span>
                  ))}
              </p>
              <p className="l-hero-body">{t(HERO.body.key, HERO.body.text, { brand: BRAND.name })}</p>
              <div className="l-cta">
                <a className="l-btn l-btn-primary l-btn-lg" href={LINKS.demo}>
                  {t('landing.tryLiveDemo', 'Try the live demo')}
                  <Icon name="arrow-right" size={18} />
                </a>
                <button ref={watchBtn} type="button" className="l-btn l-btn-secondary l-btn-lg" aria-haspopup="dialog" onClick={() => setWatching(true)}>
                  <span className="l-play" aria-hidden="true">
                    <Icon name="play" size={11} />
                  </span>
                  {t('landing.watchDemo', 'Watch demo')}
                  <span className="l-btn-meta">· {t('landing.watchDemoLength', '2 min')}</span>
                </button>
              </div>
              <p className="l-hero-meta">
                <span>{t('landing.demoDisclaimer', 'Demo uses synthetic data. Not a live production system.')}</span>
                <a href={LINKS.signUp}>{t('landing.startFreeOwn', 'Or start free on your own orders')}</a>
              </p>
              <ul className="l-ticks" aria-label={t('landing.atAGlance', 'At a glance')}>
                {[...HERO.ticks.map((tick) => t(tick.key, tick.text)), LANGS.map((l) => t(`lang.${l}`)).join(' · ')].map((tick) => (
                  <li key={tick}>
                    <Icon name="check" size={16} strokeWidth={2.25} />
                    {tick}
                  </li>
                ))}
              </ul>
            </div>
            <HeroDashboard />
          </div>
        </section>

        {/* Sources */}
        <section className="l-sources" aria-labelledby="sources-title">
          <div className="l-wrap">
            <h2 id="sources-title" className="l-sources-title">
              {t('landing.sourcesTitle', 'Works with the exports you already have')}
            </h2>
            <ul className="l-source-list">
              {SOURCES.map((s) => (
                <li key={s.key} className="l-source">
                  <Icon name={s.icon} size={16} />
                  {t(s.key, s.label)}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* See it in action, with the proof strip */}
        <SeeItInAction />

        {/* Why */}
        <section id="features" className="l-section" aria-labelledby="features-title">
          <div className="l-wrap">
            <SectionHead
              kicker={t('landing.featuresKicker', 'Why brands use it')}
              id="features-title"
              title={t('landing.featuresTitle', 'Sales show what came in. Profyn shows what you kept.')}
              center
            />
            <ul className="l-features">
              {FEATURES.map((f) => (
                <li key={f.titleKey} className="l-feature">
                  <div className="l-feature-top">
                    <span className="l-feature-icon" aria-hidden="true">
                      <Icon name={f.icon} size={20} />
                    </span>
                    <span className="l-feature-tag">{t(f.tagKey, f.tag)}</span>
                  </div>
                  <h3 className="l-card-title">{t(f.titleKey, f.title)}</h3>
                  <p className="l-card-text">{t(f.textKey, f.text)}</p>
                  <a className="l-feature-link" href={f.href}>
                    {t('landing.seeInDemo', 'See it in the demo')}
                    <Icon name="arrow-right" size={16} />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="l-section l-section-alt" aria-labelledby="how-title">
          <div className="l-wrap">
            <SectionHead kicker={t('landing.how', 'How it works')} id="how-title" title={t('landing.howTitle', 'From an order file to a decision in three steps.')} center />
            <ol className="l-steps l-steps-3">
              {STEPS.map((s, i) => (
                <li key={s.titleKey} className="l-step">
                  <a href={s.href} className="l-step-link">
                    <span className="l-step-top">
                      <span className="l-step-icon" aria-hidden="true">
                        <Icon name={s.icon} size={20} />
                      </span>
                      <span className="l-step-num">{t('landing.stepN', 'Step {{n}}', { n: i + 1 })}</span>
                    </span>
                    <span className="l-step-title">{t(s.titleKey, s.title)}</span>
                    <span className="l-step-text">{t(s.textKey, s.text)}</span>
                  </a>
                </li>
              ))}
            </ol>
            <Integrations />
          </div>
        </section>

        {/* Why Profyn, and the data promise */}
        <section id="trust" className="l-section" aria-labelledby="trust-title">
          <div className="l-wrap">
            <SectionHead
              kicker={t('landing.trustKicker', 'Why Profyn')}
              id="trust-title"
              title={t('landing.trustTitle', 'AI that explains. An engine that counts. Your data stays yours.')}
              center
            />
            <div className="l-why">
              <div className="l-why-card">
                <h3 className="l-why-h">
                  <Icon name="lightbulb" size={18} /> {t('landing.trustWhyTitle', 'Why not just ask ChatGPT?')}
                </h3>
                <p className="l-why-quote">{t('landing.trustQuote', 'ChatGPT gives you a story once; Profyn gives you a ledger every month.')}</p>
                <ul className="l-why-list">
                  {TRUST.why.map((w) => (
                    <li key={w.key}>{t(w.key, w.text)}</li>
                  ))}
                </ul>
              </div>
              <div className="l-why-card">
                <h3 className="l-why-h">
                  <Icon name="shield" size={18} /> {t('landing.trustPromiseTitle', 'Your data promise')}
                </h3>
                <ul className="l-why-list">
                  {TRUST.promise.map((p) => (
                    <li key={p.key}>{t(p.key, p.text)}</li>
                  ))}
                </ul>
                <a className="l-why-link" href="/privacy.html">
                  {t('landing.privacyPolicy', 'Read the privacy policy')}
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="l-section" aria-labelledby="pricing-title">
          <div className="l-wrap">
            <SectionHead
              kicker={t('landing.pricing', 'Pricing')}
              id="pricing-title"
              title={t('pricing.title', 'Start free. Pay as your orders grow.')}
              lead={t('pricing.lead', 'Free up to 100 orders a month. Paid plans start with a 14-day trial; annual billing saves 20%.')}
              center
            />
            <Pricing />
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="l-section l-section-alt" aria-labelledby="faq-title">
          <div className="l-wrap l-faq-grid">
            <div className="l-head">
              <p className="l-kicker">{t('landing.faq', 'FAQ')}</p>
              <h2 id="faq-title" className="l-h2">
                {t('landing.faqTitle', 'Straight answers.')}
              </h2>
              <p className="l-lead">
                <Trans
                  i18nKey="landing.faqLead"
                  defaults="Still unsure? <1>Try the demo</1>; it answers most questions in a few minutes."
                  components={{ 1: <a href={LINKS.demo} /> }}
                />
              </p>
              {DEMO_MEDIA.youtubeUrl ? (
                <p className="l-faq-yt">
                  {t('landing.preferYoutube', 'Prefer YouTube?')} <a href={DEMO_MEDIA.youtubeUrl}>{t('landing.watchOnYoutube', 'Watch the demo there')}</a>
                </p>
              ) : null}
            </div>
            <div className="l-faq">
              {FAQ.map((f) => (
                <details key={f.aKey} className="l-faq-item">
                  <summary>
                    <span>{t(f.qKey, f.q)}</span>
                    <Icon name="chevron-down" size={18} />
                  </summary>
                  <p>{t(f.aKey, f.a)}</p>
                </details>
              ))}
              <details className="l-faq-item">
                <summary>
                  <span>{t('landing.faqRefundsQ', 'What changed in how refunds are counted?')}</span>
                  <Icon name="chevron-down" size={18} />
                </summary>
                <p>
                  {t(
                    'landing.faqRefundsA',
                    'A refund used to count as lost revenue, and stock recovered from a return was ignored. Now a refund lowers net sales, recovered cost comes off product cost, the payment fee is its own line, and a refund dated after the period end is shown as a separate adjustment.',
                  )}{' '}
                  <a href={CHANGELOG_URL}>{t('landing.faqRefundsLink', 'See the change log')}</a>
                </p>
              </details>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="l-cta-section" aria-labelledby="cta-title">
          <div className="l-wrap">
            <div className="l-cta-panel">
              <div>
                <h2 id="cta-title" className="l-cta-title">
                  {t('landing.ctaTitle', 'Stop guessing.')} <span>{t('landing.ctaTitleAccent', 'See what every order kept.')}</span>
                </h2>
                <p className="l-cta-text">
                  {t('landing.ctaText', 'Open the demo in one click, or start free on your own orders.')} {t('tagline')}
                </p>
              </div>
              <div className="l-cta-actions">
                <a className="l-btn l-btn-on-dark l-btn-lg" href={LINKS.demo}>
                  {t('actions.tryDemo')}
                  <Icon name="arrow-right" size={18} />
                </a>
                <a className="l-btn l-btn-outline-dark l-btn-lg" href={LINKS.signUp}>
                  {t('landing.startFree', 'Start free')}
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="l-foot">
        <div className="l-wrap">
          <div className="l-foot-grid">
            <div className="l-foot-brand">
              <Wordmark />
              <p className="l-foot-tag">{t('tagline')}</p>
              <p>{t('footer.about', 'Contribution and profit-leak analytics for Indian D2C brands.')}</p>
            </div>
            <nav aria-labelledby="foot-explore">
              <h2 id="foot-explore" className="l-foot-h">
                {t('footer.explore', 'Explore')}
              </h2>
              <ul className="l-foot-links">
                {NAV.map((n) => (
                  <li key={n.href}>
                    <a href={n.href}>{t(n.label)}</a>
                  </li>
                ))}
              </ul>
            </nav>
            <nav aria-labelledby="foot-start">
              <h2 id="foot-start" className="l-foot-h">
                {t('footer.getStarted', 'Get started')}
              </h2>
              <ul className="l-foot-links">
                <li>
                  <a href={LINKS.demo}>{t('actions.tryDemo')}</a>
                </li>
                <li>
                  <a href={LINKS.signUp}>{t('landing.startFree', 'Start free')}</a>
                </li>
                <li>
                  <a href={LINKS.signIn}>{t('actions.signIn')}</a>
                </li>
              </ul>
            </nav>
          </div>
          <div className="l-foot-bottom">
            <p className="l-foot-meta">
              <span>© 2026 {BRAND.name}</span>
              <a href={BRAND.repoUrl}>{t('landing.github', 'GitHub')}</a>
              <a href="#trust">{t('landing.trust', 'Trust and privacy')}</a>
            </p>
            <p>{t('landing.footNote')}</p>
          </div>
        </div>
      </footer>

      {watching ? <WatchModal onClose={closeWatch} returnFocus={watchBtn} /> : null}
    </>
  );
}
