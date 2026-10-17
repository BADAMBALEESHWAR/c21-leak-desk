import { useRef, useState, type KeyboardEvent } from 'react';
import fragment from './fragment.json';
import { cap, compactInr, count, inr, pct, tidy } from './format';
import { leakName } from './HeroDashboard';
import { Icon } from './icons';
import { HBars, Waterfall, type WaterfallRow } from './MiniCharts';
import preview from './preview.json';
import { LINKS } from './shared';

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'activity' },
  { id: 'evidence', label: 'Order evidence', icon: 'receipt' },
  { id: 'pulse', label: 'Owner analytics', icon: 'bar-chart' },
  { id: 'actions', label: 'Top 3 actions', icon: 'target' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const SOURCE: Record<string, string> = {
  input: 'from file',
  derived: 'derived',
  config_default: 'default, estimate',
  not_supplied: 'not supplied',
  moved_to_channel: 'at channel level',
  not_recognised: 'not recognised',
};

const LEAK_LABEL: Record<string, string> = Object.fromEntries(preview.leaks.map((l) => [l.cause, leakName(l.label)]));

function Overview() {
  const rec = preview.reconciliation;
  const rows: WaterfallRow[] = preview.bridge.map((b) => ({ key: b.key, label: b.label, amount: b.amount_inr, kind: b.kind as WaterfallRow['kind'] }));
  return (
    <div className="l-tab-grid">
      <div>
        <h3 className="l-tab-title">Twelve months, gross sales to contribution</h3>
        <p className="l-tab-text">
          Every deduction is a named line. The {preview.totals.unknown_count} orders whose refund is unknown are left out of these totals and marked, not counted as zero.
        </p>
        <Waterfall rows={rows} label="Twelve-month bridge from gross sales to contribution on the synthetic demo brand" />
      </div>
      <aside className="l-tab-side">
        <div className="l-stat">
          <span className="l-stat-label">Contribution</span>
          <span className="l-stat-value">{inr(preview.totals.contribution_inr)}</span>
          <span className="l-stat-sub">
            {pct((preview.totals.contribution_inr / preview.totals.net_sales_inr) * 100)} of net sales · partial
          </span>
        </div>
        <div className="l-stat">
          <span className="l-stat-label">Orders that lost money</span>
          <span className="l-stat-value">{count(preview.totals.negative_count)}</span>
          <span className="l-stat-sub">of {count(preview.orders)} orders</span>
        </div>
        {rec.ok ? (
          <p className="l-recon">
            <Icon name="check-circle" size={16} />
            <span>
              <strong>Reconciled.</strong> Σ orders = Σ channels = Σ products = {inr(rec.orders_inr)}
            </span>
          </p>
        ) : null}
      </aside>
    </div>
  );
}

function Evidence() {
  const [id, setId] = useState('S03');
  const order = fragment.rows.find((r) => r.order_id === id) ?? fragment.rows[0];
  const rows: WaterfallRow[] = [
    ...order.lines.map((l) => ({
      key: l.key,
      label: l.label,
      amount: l.amount_inr,
      kind: (l.key === 'gross' ? 'start' : 'deduction') as WaterfallRow['kind'],
      // A value the file left blank is "missing", not "from file"; a derived line that depends on it cannot be worked out.
      note: l.amount_inr === null ? (l.source === 'derived' ? 'needs the missing values' : 'missing in file') : (SOURCE[l.source] ?? l.source),
    })),
    { key: 'contribution', label: 'Contribution', amount: order.contribution_inr, kind: 'total' },
  ];
  const where = [order.channel ? cap(order.channel) : 'Channel not in file', order.product_id ? `Product ${order.product_id}` : null].filter(Boolean).join(' · ');
  const rec = fragment.reconciliation;
  const recCh = fragment.reconciliation_channel_mode;
  return (
    <div className="l-tab-grid">
      <div>
        <div className="l-order-pick" role="radiogroup" aria-label="Choose a sample order">
          {fragment.rows.map((r) => (
            <button
              key={r.order_id}
              type="button"
              role="radio"
              aria-checked={r.order_id === id}
              className="l-order-chip"
              onClick={() => setId(r.order_id)}
            >
              <span className="l-order-id">{r.order_id}</span>
              <span className={`l-order-amt${r.contribution_inr !== null && r.contribution_inr < 0 ? ' is-loss' : ''}`}>
                {r.contribution_inr === null ? 'unknown' : inr(r.contribution_inr)}
              </span>
            </button>
          ))}
        </div>
        <div className="l-order-head">
          <h3 className="l-tab-title">Order {order.order_id}</h3>
          <span className="l-chip">{order.synthetic ? 'synthetic' : 'sample order'}</span>
          {order.returned ? <span className="l-chip l-chip-warn">returned</span> : null}
          <span className="l-order-where">{where}</span>
        </div>
        <Waterfall rows={rows} label={`Waterfall for order ${order.order_id}`} />
      </div>
      <aside className="l-tab-side">
        <div className="l-stat">
          <span className="l-stat-label">Why this order matters</span>
          <span className="l-stat-text">
            {order.leak_cause
              ? order.status === 'unknown'
                ? 'The refund and recovery are missing, so contribution stays unknown instead of being guessed. The order is flagged, not zeroed.'
                : `${LEAK_LABEL[order.leak_cause] ?? 'Leak'}: the order was sold, returned and still cost money to handle.`
              : 'A kept order. Every line is either from the file, derived from it, or a labelled default.'}
          </span>
        </div>
        <p className="l-recon">
          <Icon name="check-circle" size={16} />
          <span>
            <strong>All {fragment.orders} sample orders reconcile</strong> to {inr(rec.orders_inr ?? 0)}
            {recCh.ok && recCh.orders_inr === rec.orders_inr ? ' under both ad-attribution modes' : ''}.
          </span>
        </p>
      </aside>
    </div>
  );
}

function Pulse() {
  const loser = preview.products.find((p) => p.contribution_inr < 0);
  const channels = [...preview.channels].sort((a, b) => b.return_pct - a.return_pct);
  const cod = preview.payments.find((p) => p.payment_type === 'cod');
  const prepaid = preview.payments.find((p) => p.payment_type === 'prepaid');
  const products = [...preview.products].sort((a, b) => b.contribution_inr - a.contribution_inr);
  return (
    <div className="l-tab-two">
      <section className="l-mini" aria-labelledby="pulse-products">
        <h3 id="pulse-products" className="l-tab-title">
          Contribution by product
        </h3>
        <p className="l-tab-text">
          {loser
            ? `${loser.product_id} sells the most units (${count(loser.units)}) yet loses ${inr(Math.abs(loser.contribution_inr))}; ${pct(loser.return_pct)} of its orders come back.`
            : 'Contribution by product.'}
        </p>
        <HBars
          label="Contribution by product"
          format={compactInr}
          rows={products.map((p) => ({
            key: p.product_id,
            label: (
              <>
                {p.product_id} <span className="l-tag">{p.label}</span>
              </>
            ),
            value: p.contribution_inr,
          }))}
        />
      </section>
      <section className="l-mini" aria-labelledby="pulse-channels">
        <h3 id="pulse-channels" className="l-tab-title">
          Returns by channel and payment
        </h3>
        <p className="l-tab-text">
          {cod && prepaid
            ? `${cap(channels[0].channel)} returns ${pct(channels[0].return_pct)} of orders. COD is ${pct(cod.share_pct)} of orders and returns ${pct(cod.return_pct)}, against ${pct(prepaid.return_pct)} for prepaid.`
            : `${cap(channels[0].channel)} returns the most.`}
        </p>
        <p className="l-hbars-sub" aria-hidden="true">
          By channel
        </p>
        <HBars label="Return rate by channel" format={pct} rows={channels.map((c) => ({ key: c.channel, label: cap(c.channel), value: c.return_pct }))} />
        {preview.payments.length ? (
          <>
            <p className="l-hbars-sub" aria-hidden="true">
              By payment
            </p>
            <HBars
              label="Return rate by payment type"
              format={pct}
              rows={preview.payments.map((p) => ({ key: p.payment_type, label: p.payment_type === 'cod' ? 'COD' : 'Prepaid', value: p.return_pct }))}
            />
          </>
        ) : null}
      </section>
    </div>
  );
}

function Actions() {
  return (
    <div>
      <h3 className="l-tab-title">What to do first, ranked in rupees</h3>
      <p className="l-tab-text">Pulse ranks the actions by what they could recover, and says what each estimate assumes.</p>
      <ol className="l-actions">
        {preview.actions.map((a, i) => (
          <li key={a.title} className="l-action">
            <span className="l-action-rank" aria-hidden="true">
              {i + 1}
            </span>
            <div className="l-action-body">
              <h4 className="l-action-title">{tidy(a.title)}</h4>
              <p className="l-action-text">{tidy(a.detail)}</p>
              <div className="l-action-tags">
                <span className="l-chip">{cap(a.lever)}</span>
                {a.modelled ? <span className="l-chip l-chip-ok">can be tested in Scenario</span> : null}
              </div>
            </div>
            <div className="l-action-value">
              <span className="l-action-amt">{a.recoverable_inr === null ? 'unknown' : `≈ ${inr(a.recoverable_inr)}`}</span>
              <span className="l-action-per">on these 12 months</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function DemoPanel() {
  const [tab, setTab] = useState<TabId>('overview');
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div className="l-demo">
      <div className="l-demo-top">
        <div className="l-tabs" role="tablist" aria-label="Sample views" onKeyDown={onKey}>
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className="l-tab"
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon} size={16} />
              {t.label}
            </button>
          ))}
        </div>
        <span className="l-sample">{tab === 'evidence' ? 'Sample orders · S-rows synthetic' : `Synthetic demo brand · ${count(preview.orders)} orders`}</span>
      </div>
      {TABS.map((t) => (
        <div key={t.id} id={`panel-${t.id}`} role="tabpanel" aria-labelledby={`tab-${t.id}`} tabIndex={0} hidden={tab !== t.id} className="l-tabpanel">
          {tab === t.id ? t.id === 'overview' ? <Overview /> : t.id === 'evidence' ? <Evidence /> : t.id === 'pulse' ? <Pulse /> : <Actions /> : null}
        </div>
      ))}
      <div className="l-demo-foot">
        <span>
          <Icon name="info" size={16} /> Computed by the Profyn engine on labelled sample and synthetic data. Not a screenshot, and not a customer’s numbers.
        </span>
        <a className="l-link-arrow" href={LINKS.demo}>
          Open the full demo <Icon name="arrow-right" size={16} />
        </a>
      </div>
    </div>
  );
}
