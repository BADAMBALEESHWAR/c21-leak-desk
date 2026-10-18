import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ANNUAL_DISCOUNT, PLANS } from './content';
import { inr } from './format';
import { Icon } from './icons';
import { LINKS } from './shared';

/** Annual price per month, rounded to the rupee: ₹999 → ₹799. */
export const annualMonthly = (monthly: number) => Math.round(monthly * (1 - ANNUAL_DISCOUNT));

export function Pricing() {
  const { t } = useTranslation();
  const [annual, setAnnual] = useState(false);
  return (
    <>
      <div className="l-billing-row">
        <div className="l-billing" role="group" aria-label={t('pricing.billingPeriod', 'Billing period')}>
          <button type="button" aria-pressed={!annual} onClick={() => setAnnual(false)}>
            {t('pricing.monthly', 'Monthly')}
          </button>
          <button type="button" aria-pressed={annual} onClick={() => setAnnual(true)}>
            {t('pricing.annual', 'Annual')} <span className="l-save">{t('pricing.save', 'Save {{pct}}%', { pct: Math.round(ANNUAL_DISCOUNT * 100) })}</span>
          </button>
        </div>
      </div>
      <div className="l-plans">
        {PLANS.map((p) => {
          const free = p.monthly === 0;
          const price = annual ? annualMonthly(p.monthly) : p.monthly;
          return (
            <article key={p.name} className={`l-plan${p.popular ? ' is-popular' : ''}${free ? ' is-free' : ''}`} aria-labelledby={`plan-${p.name}`}>
              {p.popular ? <span className="l-plan-badge">{t('pricing.mostPopular', 'Most popular')}</span> : null}
              <h3 id={`plan-${p.name}`} className="l-plan-name">
                {t(p.nameKey, p.name)}
              </h3>
              <p className="l-plan-blurb">{t(p.blurbKey, p.blurb)}</p>
              <p className="l-plan-price">
                <span className="l-plan-amount">{inr(price)}</span>
                <span className="l-plan-per">{free ? t('pricing.forever', 'forever') : t('pricing.perMonth', '/ month')}</span>
              </p>
              <p className="l-plan-billed">
                {free ? (
                  t('pricing.noCard', 'No card needed')
                ) : annual ? (
                  <Trans i18nKey="pricing.billedYearly" defaults="Billed yearly · <1>{{was}}</1> monthly" values={{ was: inr(p.monthly) }} components={{ 1: <s /> }} />
                ) : (
                  t('pricing.billedMonthly', 'Billed monthly')
                )}
              </p>
              <p className="l-plan-orders">{t(p.ordersKey, p.orders)}</p>
              <ul className="l-plan-list">
                {p.features.map((f) => (
                  <li key={f.key}>
                    <Icon name="check" size={16} strokeWidth={2.25} />
                    {t(f.key, f.text)}
                  </li>
                ))}
              </ul>
              <a className={`l-btn l-btn-block ${p.popular ? 'l-btn-primary' : 'l-btn-secondary'}`} href={LINKS.signUp}>
                {t(p.ctaKey, p.cta)}
              </a>
            </article>
          );
        })}
      </div>
      <p className="l-fine">
        {t('pricing.fine', 'Prices in Indian rupees, before GST. Paid plans include every feature and differ by monthly order volume; Scale adds API access.')}
      </p>
    </>
  );
}
