import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { compactInr, count, inr, month, pct } from './format';
import { Icon } from './icons';
import { ContributionLine } from './MiniCharts';
import preview from './preview.json';

/** The engine's cause label; the "(unknown)" suffix is shown as the unknown pill instead. */
export const leakName = (label: string) => label.replace(/\s*\(unknown\)$/i, '');

/** The cause names in the UI language, by the engine's stable cause id; any other cause keeps the engine's English label. */
function leakLabel(t: TFunction, cause: string, label: string): string {
  switch (cause) {
    case 'full_return_partial_recovery':
      return t('hero.leakFullReturn', 'Full return, partial recovery');
    case 'discount_exceeds_margin':
      return t('hero.leakDiscount', 'Discount deeper than margin');
    case 'fees_exceed_margin':
      return t('hero.leakFees', 'Shipping and fees exceed margin');
    case 'refund_unknown':
      return t('hero.leakRefundUnknown', 'Refund without recovery fact');
    default:
      return leakName(label);
  }
}

/** A window onto Pulse, drawn from the engine's output on the synthetic 12-month demo brand. */
export function HeroDashboard() {
  const { t } = useTranslation();
  const tot = preview.totals;
  const first = preview.months[0].month;
  const last = preview.months[preview.months.length - 1].month;
  const best = preview.months.reduce((b, m) => (m.contribution_inr > b.contribution_inr ? m : b), preview.months[0]);
  const worst = preview.months.reduce((b, m) => (m.contribution_inr < b.contribution_inr ? m : b), preview.months[0]);
  const rec = preview.reconciliation;
  const kpis = [
    { id: 'orders', label: t('hero.orders', 'Orders'), value: count(preview.orders), sub: `${month(first, true)} ’${first.slice(2, 4)} – ${month(last, true)} ’${last.slice(2, 4)}` },
    { id: 'net', label: t('hero.netSales', 'Net sales'), value: compactInr(tot.net_sales_inr), sub: t('hero.netSalesSub', 'after discounts and refunds') },
    {
      id: 'contribution',
      label: t('hero.contribution', 'Contribution'),
      value: compactInr(tot.contribution_inr),
      sub: t('hero.partialUnknown', 'partial · {{n}} unknown', { count: tot.unknown_count, n: count(tot.unknown_count) }),
      flag: true,
    },
    { id: 'returns', label: t('hero.returnRate', 'Return rate'), value: pct(tot.return_pct), sub: t('hero.returnRateSub', 'of all orders') },
  ];

  return (
    <div className="l-hero-visual">
      <figure className="l-window" aria-label={t('hero.figureLabel', 'Sample dashboard: twelve months of a synthetic demo brand, computed by the Profyn engine')}>
        <div className="l-window-bar">
          <span className="l-window-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="l-window-title">{t('hero.windowTitle', 'Pulse · 12 months')}</span>
          <span className="l-sample">{t('hero.sampleData', 'Sample data')}</span>
        </div>
        <div className="l-window-body">
          <dl className="l-kpis">
            {kpis.map((k) => (
              <div key={k.id} className="l-kpi">
                <dt>{k.label}</dt>
                <dd className="l-kpi-value">{k.value}</dd>
                <dd className={`l-kpi-sub${k.flag ? ' is-flag' : ''}`}>{k.sub}</dd>
              </div>
            ))}
          </dl>
          <div className="l-window-grid">
            <section className="l-panel" aria-labelledby="hero-chart-title">
              <h3 id="hero-chart-title" className="l-panel-title">
                {t('hero.chartTitle', 'Contribution by month')}
              </h3>
              <ContributionLine months={preview.months} height={196} />
              <dl className="l-chart-meta">
                <div>
                  <dt>{t('hero.bestMonth', 'Best month')}</dt>
                  <dd>
                    {month(best.month)} · {inr(best.contribution_inr)}
                  </dd>
                </div>
                <div>
                  <dt>{worst.contribution_inr < 0 ? t('hero.losingMonth', 'Losing month') : t('hero.weakestMonth', 'Weakest month')}</dt>
                  <dd className={worst.contribution_inr < 0 ? 'is-loss' : undefined}>
                    {month(worst.month)} · {inr(worst.contribution_inr)}
                  </dd>
                </div>
              </dl>
              <table className="l-sr">
                <caption>{t('hero.tableCaption', 'Contribution by month on the synthetic demo brand')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('hero.month', 'Month')}</th>
                    <th scope="col">{t('hero.contribution', 'Contribution')}</th>
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
                {t('hero.leaksTitle', 'Worth a closer look')}
              </h3>
              <ul className="l-leaks">
                {preview.leaks.map((l) => (
                  <li key={l.cause} className="l-leak">
                    <span className={`l-leak-dot${l.lost_inr === null ? ' is-unknown' : ''}`} aria-hidden="true" />
                    <span className="l-leak-text">
                      <span className="l-leak-name">{leakLabel(t, l.cause, l.label)}</span>
                      <span className="l-leak-count">{t('hero.leakOrders', '{{n}} orders', { count: l.count, n: count(l.count) })}</span>
                    </span>
                    <span className="l-leak-value">{l.lost_inr === null ? <span className="l-unknown">{t('hero.unknown', 'unknown')}</span> : `−${compactInr(l.lost_inr)}`}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
        {rec.ok ? (
          <p className="l-window-foot">
            <Icon name="check-circle" size={15} />
            {t('hero.reconciled', 'Reconciled: orders = channels = products')}
          </p>
        ) : null}
      </figure>
    </div>
  );
}
