import { useEffect, useState } from 'react';
import { BRAND } from '../brand';
import { AUDIENCES, FAQ, FEATURES, HERO, PROBLEMS, ROADMAP, SOURCES, STEPS, TRUST, type RoadmapStatus } from './content';
import { DemoPanel } from './DemoPanel';
import { HeroDashboard } from './HeroDashboard';
import { Icon } from './icons';
import { Pricing } from './Pricing';
import { LINKS, Wordmark } from './shared';
import { WhatIf } from './WhatIf';

const NAV = [
  { href: '#how', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

const STATUS_CLASS: Record<RoadmapStatus, string> = {
  Live: 'is-live',
  'Coming next': 'is-next',
  'Future direction': 'is-future',
};

/** The tagline as the headline, with its second sentence in the accent colour. */
function Tagline() {
  const [first, ...rest] = BRAND.tagline.split(/(?<=\.)\s+/);
  return (
    <h1 id="hero-title" className="l-h1">
      {first} <span className="l-accent">{rest.join(' ')}</span>
    </h1>
  );
}

function Header() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth > 900) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  return (
    <header className={`l-nav${open ? ' is-open' : ''}`}>
      <div className="l-wrap l-nav-inner">
        <Wordmark />
        <nav className="l-nav-links" aria-label="Sections">
          {NAV.map((n) => (
            <a key={n.href} href={n.href}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="l-nav-actions">
          <a className="l-btn l-btn-ghost l-hide-sm" href={LINKS.signIn}>
            Sign in
          </a>
          <a className="l-btn l-btn-primary l-btn-sm" href={LINKS.demo}>
            Try the demo
          </a>
          <button
            type="button"
            className="l-burger"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name={open ? 'x' : 'menu'} size={22} />
          </button>
        </div>
      </div>
      <div id="mobile-menu" className="l-menu" hidden={!open}>
        <nav className="l-wrap" aria-label="Menu">
          <ul className="l-menu-list">
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={n.href} onClick={() => setOpen(false)}>
                  {n.label}
                  <Icon name="arrow-right" size={16} />
                </a>
              </li>
            ))}
          </ul>
          <div className="l-menu-cta">
            <a className="l-btn l-btn-secondary l-btn-block" href={LINKS.signIn}>
              Sign in
            </a>
            <a className="l-btn l-btn-primary l-btn-block" href={LINKS.signUp}>
              Create account
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
  return (
    <>
      <a className="l-skip" href="#main">
        Skip to content
      </a>
      <div className="l-strip">
        <div className="l-wrap">
          <p>
            <span className="l-strip-tag">Early access</span>
            <span className="l-strip-dot" aria-hidden="true">
              ·
            </span>
            Turn business exports into sharper decisions.<span className="l-strip-more"> Start with CSV or JSON.</span>
          </p>
        </div>
      </div>
      <Header />

      <main id="main" tabIndex={-1}>
        {/* Hero */}
        <section className="l-hero" aria-labelledby="hero-title">
          <div className="l-wrap l-hero-grid">
            <div className="l-hero-text">
              <p className="l-pill">
                <span className="l-pill-dot" aria-hidden="true" />
                {HERO.eyebrow}
              </p>
              <Tagline />
              <p className="l-hero-lead">
                {HERO.lead.split(/(?<=\.)\s+/).map((line) => (
                  <span key={line}>{line} </span>
                ))}
              </p>
              <p className="l-hero-body">{HERO.body}</p>
              <div className="l-cta">
                <a className="l-btn l-btn-primary l-btn-lg" href={LINKS.demo}>
                  Try the demo
                  <Icon name="arrow-right" size={18} />
                </a>
                <a className="l-btn l-btn-secondary l-btn-lg" href={LINKS.signUp}>
                  Start free trial
                </a>
              </div>
              <ul className="l-ticks" aria-label="At a glance">
                {HERO.ticks.map((t) => (
                  <li key={t}>
                    <Icon name="check" size={16} strokeWidth={2.25} />
                    {t}
                  </li>
                ))}
              </ul>
              <p className="l-hero-note">The demo opens on a labelled synthetic brand. No account needed.</p>
            </div>
            <HeroDashboard />
          </div>
        </section>

        {/* Sources */}
        <section className="l-sources" aria-labelledby="sources-title">
          <div className="l-wrap">
            <h2 id="sources-title" className="l-sources-title">
              Bring the exports you already have
            </h2>
            <ul className="l-source-list">
              {SOURCES.map((s) => (
                <li key={s.label} className="l-source">
                  <Icon name={s.icon} size={16} />
                  {s.label}
                </li>
              ))}
            </ul>
            <p className="l-sources-note">These are export sources, not live integrations. You bring them as CSV or JSON in the order template; common column names are mapped for you.</p>
          </div>
        </section>

        {/* Problem */}
        <section className="l-section" aria-labelledby="problem-title">
          <div className="l-wrap">
            <SectionHead
              kicker="The blind spot"
              id="problem-title"
              title="Revenue is visible. Profit takes work."
              lead="Most brands can tell you last month’s sales in seconds. What each order actually kept takes a week of spreadsheets, if it happens at all."
            />
            <ol className="l-problems">
              {PROBLEMS.map((p, i) => (
                <li key={p.title} className="l-problem">
                  <span className="l-problem-num">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="l-card-title">{p.title}</h3>
                  <p className="l-problem-lead">{p.lead}</p>
                  <p className="l-card-text">{p.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="l-section l-section-alt" aria-labelledby="how-title">
          <div className="l-wrap">
            <SectionHead kicker="How it works" id="how-title" title="From an order file to a decision, in five steps." />
            <ol className="l-steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className="l-step">
                  <a href={s.href} className="l-step-link">
                    <span className="l-step-top">
                      <span className="l-step-icon" aria-hidden="true">
                        <Icon name={s.icon} size={20} />
                      </span>
                      <span className="l-step-num">Step {i + 1}</span>
                    </span>
                    <span className="l-step-title">{s.title}</span>
                    <span className="l-step-text">{s.text}</span>
                  </a>
                </li>
              ))}
            </ol>
            <div className="l-control">
              <span className="l-control-icon" aria-hidden="true">
                <Icon name="shield" size={20} />
              </span>
              <p>
                <strong>You stay in control.</strong> {BRAND.name} reads your files and shows its working. Nothing changes in your store, nothing is filled in silently, and every
                decision is yours to make and to stop.
              </p>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="l-section" aria-labelledby="features-title">
          <div className="l-wrap">
            <SectionHead
              kicker="Features"
              id="features-title"
              title="Everything you need to see what each order kept."
              lead="Six parts of one engine. Every number on every screen can be opened down to the order it came from."
            />
            <ul className="l-features">
              {FEATURES.map((f) => (
                <li key={f.title} className="l-feature">
                  <div className="l-feature-top">
                    <span className="l-feature-icon" aria-hidden="true">
                      <Icon name={f.icon} size={20} />
                    </span>
                    <span className="l-feature-tag">{f.tag}</span>
                  </div>
                  <h3 className="l-card-title">{f.title}</h3>
                  <p className="l-card-text">{f.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Interactive demo */}
        <section id="demo" className="l-section l-section-alt" aria-labelledby="demo-title">
          <div className="l-wrap">
            <SectionHead
              kicker="See it on sample data"
              id="demo-title"
              title="The numbers behind the numbers."
              lead="Real engine output on labelled sample and synthetic data. Switch views, pick an order, and see exactly where the money went."
            />
            <DemoPanel />
          </div>
        </section>

        {/* What-if */}
        <section id="what-if" className="l-section" aria-labelledby="whatif-title">
          <div className="l-wrap">
            <SectionHead
              kicker="What-if"
              id="whatif-title"
              title="What does ₹10 more per shipment cost you?"
              lead="Small per-order changes add up faster than they look. Move the slider to see the monthly effect on contribution."
            />
            <WhatIf />
          </div>
        </section>

        {/* Roadmap */}
        <section id="roadmap" className="l-section l-section-alt" aria-labelledby="roadmap-title">
          <div className="l-wrap">
            <SectionHead
              kicker="Roadmap"
              id="roadmap-title"
              title="Start with a file. Automate when you’re ready."
              lead="What is live today, and where we are heading. Anything not live is labelled, and is not part of any plan yet."
            />
            <ul className="l-roadmap">
              {ROADMAP.map((r) => (
                <li key={r.title} className={`l-road ${STATUS_CLASS[r.status]}`}>
                  <div className="l-feature-top">
                    <span className="l-feature-icon" aria-hidden="true">
                      <Icon name={r.icon} size={20} />
                    </span>
                    <span className={`l-status ${STATUS_CLASS[r.status]}`}>{r.status}</span>
                  </div>
                  <h3 className="l-card-title">{r.title}</h3>
                  <p className="l-card-text">{r.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Who it's for */}
        <section id="who" className="l-section" aria-labelledby="who-title">
          <div className="l-wrap">
            <SectionHead kicker="Who it’s for" id="who-title" title="Built for people who see sales, but not what sales kept." />
            <ul className="l-audiences">
              {AUDIENCES.map((a) => (
                <li key={a.title} className="l-audience">
                  <span className="l-audience-icon" aria-hidden="true">
                    <Icon name={a.icon} size={22} />
                  </span>
                  <h3 className="l-card-title">{a.title}</h3>
                  <p className="l-card-text">{a.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Trust */}
        <section id="trust" className="l-section l-trust" aria-labelledby="trust-title">
          <div className="l-wrap">
            <div className="l-head is-dark">
              <p className="l-kicker">Trust</p>
              <h2 id="trust-title" className="l-h2">
                No black-box numbers.
              </h2>
              <p className="l-lead">If you cannot check a number, you should not act on it. So every number can be checked.</p>
            </div>
            <ul className="l-trust-list">
              {TRUST.map((t) => (
                <li key={t.title} className="l-trust-item">
                  <span className="l-trust-icon" aria-hidden="true">
                    <Icon name={t.icon} size={20} />
                  </span>
                  <h3 className="l-card-title">{t.title}</h3>
                  <p className="l-card-text">{t.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="l-section l-section-alt" aria-labelledby="pricing-title">
          <div className="l-wrap">
            <SectionHead
              kicker="Launch pricing"
              id="pricing-title"
              title="Simple plans by order volume."
              lead="Start with a 14-day free trial on your own CSV. Annual billing saves 20%."
              center
            />
            <Pricing />
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="l-section" aria-labelledby="faq-title">
          <div className="l-wrap l-faq-grid">
            <div className="l-head">
              <p className="l-kicker">FAQ</p>
              <h2 id="faq-title" className="l-h2">
                Straight answers.
              </h2>
              <p className="l-lead">
                Something else on your mind? <a href={LINKS.demo}>Try the demo</a> first; it answers most questions in a few minutes.
              </p>
            </div>
            <div className="l-faq">
              {FAQ.map((f) => (
                <details key={f.q} className="l-faq-item">
                  <summary>
                    <span>{f.q}</span>
                    <Icon name="chevron-down" size={18} />
                  </summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="l-cta-section" aria-labelledby="cta-title">
          <div className="l-wrap">
            <div className="l-cta-panel">
              <div>
                <h2 id="cta-title" className="l-cta-title">
                  Stop digging through spreadsheets. <span>Start seeing the story.</span>
                </h2>
                <p className="l-cta-text">Open the demo in one click, or create an account and run your own orders. {BRAND.tagline}</p>
              </div>
              <div className="l-cta-actions">
                <a className="l-btn l-btn-on-dark l-btn-lg" href={LINKS.demo}>
                  Try the demo
                  <Icon name="arrow-right" size={18} />
                </a>
                <a className="l-btn l-btn-outline-dark l-btn-lg" href={LINKS.signUp}>
                  Create account
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
              <p className="l-foot-tag">{BRAND.tagline}</p>
              <p>Contribution and profit-leak analytics for Indian D2C brands: what every order kept, where money leaks, and one measurable next step.</p>
            </div>
            <nav aria-labelledby="foot-explore">
              <h2 id="foot-explore" className="l-foot-h">
                Explore
              </h2>
              <ul className="l-foot-links">
                {NAV.map((n) => (
                  <li key={n.href}>
                    <a href={n.href}>{n.label}</a>
                  </li>
                ))}
              </ul>
            </nav>
            <nav aria-labelledby="foot-start">
              <h2 id="foot-start" className="l-foot-h">
                Get started
              </h2>
              <ul className="l-foot-links">
                <li>
                  <a href={LINKS.demo}>Try the demo</a>
                </li>
                <li>
                  <a href={LINKS.signUp}>Create account</a>
                </li>
                <li>
                  <a href={LINKS.signIn}>Sign in</a>
                </li>
              </ul>
            </nav>
          </div>
          <div className="l-foot-bottom">
            <p>© 2026 {BRAND.name}</p>
            <p>
              Sample and demo numbers on this page are illustrative: computed by the engine on labelled sample and synthetic data, not on a customer’s business. Features marked
              Coming next or Future direction are not live. Contribution is operational, not statutory net profit.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
