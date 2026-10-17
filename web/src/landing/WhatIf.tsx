import { useId, useState, type CSSProperties } from 'react';
import { count, inr, pct, signedInr } from './format';
import { Icon } from './icons';
import preview from './preview.json';
import { LINKS } from './shared';

/** The synthetic demo brand's average month, from the engine's month rows. */
const DEMO_MONTHS = preview.months.length;
const DEMO_ORDERS = Math.round(preview.orders / DEMO_MONTHS);
const DEMO_CONTRIBUTION = Math.round(preview.totals.contribution_inr / DEMO_MONTHS);
const DEMO_SHIPPING = Math.round(preview.totals.avg_shipping_inr);

const PRESETS = [
  { label: `Demo · ${count(DEMO_ORDERS)}`, value: DEMO_ORDERS },
  { label: '500', value: 500 },
  { label: '3,000', value: 3000 },
  { label: '15,000', value: 15000 },
];

/** Shipping change × orders. A plain formula on purpose: the app's Scenario step runs the full engine. */
export function WhatIf() {
  const id = useId();
  const [change, setChange] = useState(10);
  const [orders, setOrders] = useState(DEMO_ORDERS);
  const monthly = -change * orders;
  const yearly = monthly * 12;
  const isDemo = orders === DEMO_ORDERS;
  const tone = monthly < 0 ? 'is-loss' : monthly > 0 ? 'is-gain' : '';

  return (
    <div className="l-calc">
      <div className="l-calc-inputs">
        <div className="l-field">
          <div className="l-field-head">
            <label htmlFor={`${id}-ship`} className="l-label">
              Shipping cost change per order
            </label>
            <output htmlFor={`${id}-ship`} className="l-calc-out">
              {signedInr(change)}
            </output>
          </div>
          <input
            id={`${id}-ship`}
            className="l-range"
            type="range"
            min={-50}
            max={50}
            step={1}
            value={change}
            aria-valuetext={`${signedInr(change)} per order`}
            onChange={(e) => setChange(Number(e.target.value))}
            style={{ '--fill': `${((change + 50) / 100) * 100}%` } as CSSProperties}
          />
          <div className="l-range-scale" aria-hidden="true">
            <span>−₹50</span>
            <span>₹0</span>
            <span>+₹50</span>
          </div>
          <p className="l-hint">A courier rate rise is a positive change; a cheaper contract is negative.</p>
        </div>

        <div className="l-field">
          <label htmlFor={`${id}-orders`} className="l-label">
            Orders a month
          </label>
          <input
            id={`${id}-orders`}
            className="l-input"
            type="number"
            inputMode="numeric"
            min={1}
            max={1000000}
            step={1}
            value={Number.isFinite(orders) ? orders : ''}
            onChange={(e) => {
              const v = Math.round(Number(e.target.value));
              setOrders(Number.isFinite(v) ? Math.min(1000000, Math.max(0, v)) : 0);
            }}
          />
          <div className="l-presets" role="group" aria-label="Order count presets">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className="l-preset" aria-pressed={orders === p.value} onClick={() => setOrders(p.value)}>
                {p.label}
              </button>
            ))}
          </div>
          <p className="l-hint">
            Example: the synthetic demo brand averages {count(DEMO_ORDERS)} orders a month ({count(preview.orders)} over {DEMO_MONTHS} months) at about {inr(DEMO_SHIPPING)} shipping per order.
          </p>
        </div>
      </div>

      <div className="l-calc-result" aria-live="polite">
        <span className="l-calc-kicker">Contribution impact</span>
        <span className={`l-calc-big ${tone}`}>{signedInr(monthly)}</span>
        <span className="l-calc-per">a month · {signedInr(yearly)} a year</span>
        {isDemo && change !== 0 ? (
          <span className="l-calc-context">
            That is {pct(Math.abs(monthly / DEMO_CONTRIBUTION) * 100)} of the demo brand’s average monthly contribution ({inr(DEMO_CONTRIBUTION)}).
          </span>
        ) : null}
        <div className="l-formula">
          <span className="l-formula-label">Formula</span>
          <code>impact = −(shipping change × orders)</code>
          <code>
            −({signedInr(change)} × {count(orders)}) = {signedInr(monthly)}
          </code>
        </div>
        <p className="l-calc-note">
          <Icon name="info" size={16} />
          <span>Assumes nothing else changes: same orders, prices and returns. In the app, Scenario re-runs the engine with a new shipping cost on your own orders.</span>
        </p>
        <a className="l-btn l-btn-on-dark l-btn-block" href={LINKS.demo}>
          Try the demo
          <Icon name="arrow-right" size={16} />
        </a>
      </div>
    </div>
  );
}
