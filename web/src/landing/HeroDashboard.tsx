import { compactInr, count, inr, month, pct } from './format';
import { Icon } from './icons';
import { ContributionLine } from './MiniCharts';
import preview from './preview.json';

/** The engine's cause label; the "(unknown)" suffix is shown as the unknown pill instead. */
export const leakName = (label: string) => label.replace(/\s*\(unknown\)$/i, '');

/** The month that sold the most, and what it kept. Read from the engine's month rows, not written by hand. */
export function topSellerInsight() {
  const top = preview.months.reduce((b, m) => (m.net_sales_inr > b.net_sales_inr ? m : b), preview.months[0]);
  return {
    title: top.contribution_inr < 0 ? `${month(top.month)} sold the most and still lost ${inr(Math.abs(top.contribution_inr))}.` : `${month(top.month)} sold the most and kept ${inr(top.contribution_inr)}.`,
    detail: `Discounts averaged ${pct(top.discount_depth_pct)} of gross that month.`,
  };
}

/** A window onto Pulse, drawn from the engine's output on the synthetic 12-month demo brand. */
export function HeroDashboard() {
  const t = preview.totals;
  const first = preview.months[0].month;
  const last = preview.months[preview.months.length - 1].month;
  const insight = topSellerInsight();
  const best = preview.months.reduce((b, m) => (m.contribution_inr > b.contribution_inr ? m : b), preview.months[0]);
  const worst = preview.months.reduce((b, m) => (m.contribution_inr < b.contribution_inr ? m : b), preview.months[0]);
  const rec = preview.reconciliation;
  const kpis = [
    { label: 'Orders', value: count(preview.orders), sub: `${month(first, true)} ’${first.slice(2, 4)} – ${month(last, true)} ’${last.slice(2, 4)}` },
    { label: 'Net sales', value: compactInr(t.net_sales_inr), sub: 'after discounts and refunds' },
    { label: 'Contribution', value: compactInr(t.contribution_inr), sub: `partial · ${t.unknown_count} unknown`, flag: true },
    { label: 'Return rate', value: pct(t.return_pct), sub: 'of all orders' },
  ];

  return (
    <div className="l-hero-visual">
      <figure className="l-window" aria-label="Sample dashboard: twelve months of a synthetic demo brand, computed by the Profyn engine">
        <div className="l-window-bar">
          <span className="l-window-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="l-window-title">Pulse · 12 months</span>
          <span className="l-sample">Sample data</span>
        </div>
        <div className="l-window-body">
          <dl className="l-kpis">
            {kpis.map((k) => (
              <div key={k.label} className="l-kpi">
                <dt>{k.label}</dt>
                <dd className="l-kpi-value">{k.value}</dd>
                <dd className={`l-kpi-sub${k.flag ? ' is-flag' : ''}`}>{k.sub}</dd>
              </div>
            ))}
          </dl>
          <div className="l-window-grid">
            <section className="l-panel" aria-labelledby="hero-chart-title">
              <h3 id="hero-chart-title" className="l-panel-title">
                Contribution by month
              </h3>
              <ContributionLine months={preview.months} height={196} />
              <dl className="l-chart-meta">
                <div>
                  <dt>Best month</dt>
                  <dd>
                    {month(best.month)} · {inr(best.contribution_inr)}
                  </dd>
                </div>
                <div>
                  <dt>{worst.contribution_inr < 0 ? 'Losing month' : 'Weakest month'}</dt>
                  <dd className={worst.contribution_inr < 0 ? 'is-loss' : undefined}>
                    {month(worst.month)} · {inr(worst.contribution_inr)}
                  </dd>
                </div>
              </dl>
              <table className="l-sr">
                <caption>Contribution by month on the synthetic demo brand</caption>
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col">Contribution</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.months.map((m) => (
                    <tr key={m.month}>
                      <th scope="row">{month(m.month)}</th>
                      <td>{inr(m.contribution_inr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="l-panel" aria-labelledby="hero-leaks-title">
              <h3 id="hero-leaks-title" className="l-panel-title">
                Worth a closer look
              </h3>
              <ul className="l-leaks">
                {preview.leaks.map((l) => (
                  <li key={l.cause} className="l-leak">
                    <span className={`l-leak-dot${l.lost_inr === null ? ' is-unknown' : ''}`} aria-hidden="true" />
                    <span className="l-leak-text">
                      <span className="l-leak-name">{leakName(l.label)}</span>
                      <span className="l-leak-count">{count(l.count)} orders</span>
                    </span>
                    <span className="l-leak-value">{l.lost_inr === null ? <span className="l-unknown">unknown</span> : `−${compactInr(l.lost_inr)}`}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
        {rec.ok ? (
          <p className="l-window-foot">
            <Icon name="check-circle" size={15} />
            Reconciled: orders = channels = products
          </p>
        ) : null}
      </figure>
      <aside className="l-insight" aria-label="Insight from Pulse on the sample data">
        <span className="l-insight-icon" aria-hidden="true">
          <Icon name="lightbulb" size={18} />
        </span>
        <span className="l-insight-body">
          <span className="l-insight-kicker">Insight · sample data</span>
          <strong>{insight.title}</strong>
          <span>{insight.detail}</span>
        </span>
      </aside>
    </div>
  );
}
