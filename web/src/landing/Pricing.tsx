import { useState } from 'react';
import { ANNUAL_DISCOUNT, PLANS } from './content';
import { inr } from './format';
import { Icon } from './icons';
import { LINKS } from './shared';

/** Annual price per month, rounded to the rupee: ₹999 → ₹799. */
export const annualMonthly = (monthly: number) => Math.round(monthly * (1 - ANNUAL_DISCOUNT));

export function Pricing() {
  const [annual, setAnnual] = useState(false);
  return (
    <>
      <div className="l-billing-row">
        <div className="l-billing" role="group" aria-label="Billing period">
          <button type="button" aria-pressed={!annual} onClick={() => setAnnual(false)}>
            Monthly
          </button>
          <button type="button" aria-pressed={annual} onClick={() => setAnnual(true)}>
            Annual <span className="l-save">Save {Math.round(ANNUAL_DISCOUNT * 100)}%</span>
          </button>
        </div>
      </div>
      <div className="l-plans">
        {PLANS.map((p) => {
          const price = annual ? annualMonthly(p.monthly) : p.monthly;
          return (
            <article key={p.name} className={`l-plan${p.popular ? ' is-popular' : ''}`} aria-labelledby={`plan-${p.name}`}>
              {p.popular ? <span className="l-plan-badge">Most popular</span> : null}
              <h3 id={`plan-${p.name}`} className="l-plan-name">
                {p.name}
              </h3>
              <p className="l-plan-blurb">{p.blurb}</p>
              <p className="l-plan-price">
                <span className="l-plan-amount">{inr(price)}</span>
                <span className="l-plan-per">/ month</span>
              </p>
              <p className="l-plan-billed">
                {annual ? (
                  <>
                    Billed yearly · <s>{inr(p.monthly)}</s> monthly
                  </>
                ) : (
                  'Billed monthly'
                )}
              </p>
              <p className="l-plan-orders">{p.orders}</p>
              <ul className="l-plan-list">
                {p.features.map((f) => (
                  <li key={f}>
                    <Icon name="check" size={16} strokeWidth={2.25} />
                    {f}
                  </li>
                ))}
              </ul>
              <a className={`l-btn l-btn-block ${p.popular ? 'l-btn-primary' : 'l-btn-secondary'}`} href={LINKS.signUp}>
                Start free trial
              </a>
            </article>
          );
        })}
      </div>
      <p className="l-fine">
        14-day free trial on your own CSV. Prices in Indian rupees, before GST. Every plan includes every feature; plans differ by monthly order volume, and Scale adds API access.
      </p>
    </>
  );
}
