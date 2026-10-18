import { useTranslation } from 'react-i18next';
import type { AnalysisResponse, Reconciliation } from '../api/types';
import { apiText } from '../lib/apiText';
import { formatDate, formatInr } from '../lib/format';
import { Icon } from './Icon';
import { Money } from './Money';
import { Provenance } from './Provenance';

/**
 * Late refunds as a prior-period adjustment: the period total as reported, the adjustment, the restated total.
 * The reported figure is never overwritten.
 */
export function PeriodTotals({ a }: { a: AnalysisResponse }) {
  const { t } = useTranslation();
  const late = a.late_refunds;
  if (!late || late.orders.length === 0) return null;
  const reported = a.totals.contribution_inr;
  const adjustment = late.pending_delta_inr;
  const restated = late.total_if_recognised_inr;
  const ids = late.orders.map((o) => o.order_id);
  const dates = [...new Set(late.orders.map((o) => o.refund_date).filter((d): d is string => Boolean(d)))];
  const which =
    ids.length <= 3
      ? ids.length === 1
        ? t('late.on', 'late refund on {{ids}}', { ids: ids[0] })
        : t('late.onSeveral', 'late refunds on {{ids}}', { ids: ids.join(', ') })
      : t('late.onMany', 'late refunds on {{n}} orders', { n: ids.length });
  const dated = dates.length === 1 ? t('late.dated', 'dated {{date}}', { date: formatDate(dates[0]) }) : dates.length > 1 ? t('late.datedAfter', 'dated after {{date}}', { date: formatDate(late.period_end) }) : '';
  return (
    <section className="card period-totals" aria-label={t('late.totalsLabel', 'Period total and restatement')}>
      <dl className="pt-lines">
        <div className="pt-line">
          <dt>
            {t('late.reported', 'Period total (as reported)')} <Provenance kind="observed" />
          </dt>
          <dd>
            <Money value={reported} tone="contribution" />
          </dd>
        </div>
        <div className="pt-line pt-adjust">
          <dt>
            {t('late.adjustment', 'Prior-period adjustment')}{' '}
            <span className="pt-why">
              ({which}
              {dated ? `, ${dated}` : ''})
            </span>
          </dt>
          <dd>
            <Money value={adjustment} />
          </dd>
        </div>
        <div className="pt-line pt-restated">
          <dt>{t('late.restated', 'Restated total')}</dt>
          <dd>
            <Money value={restated} tone="contribution" />
          </dd>
        </div>
      </dl>
      <p className="pt-note">
        {t('late.note', 'Refunds dated after the period end ({{end}}) stay out of the period total; the restated total shows them recognised.', {
          end: formatDate(late.period_end),
        })}
      </p>
    </section>
  );
}

/** Banner card: Σ orders = Σ channels = Σ products, or the gap. */
export function ReconciliationLine({ rec }: { rec: Reconciliation }) {
  const { t } = useTranslation();
  const { orders_inr: o, channels_inr: c, products_inr: p } = rec;
  if (o === null || c === null || p === null) {
    return (
      <div className="banner banner-warning" role="status">
        <Icon name="alert-triangle" size={20} />
        <p>
          <strong>{t('recon.notReconciled', 'Not reconciled.')}</strong> {apiText(rec.statement)}
        </p>
      </div>
    );
  }
  if (rec.ok) {
    return (
      <div className="banner banner-success recon" role="status" title={t('recon.within', 'Reconciled within ±{{inr}}', { inr: formatInr(rec.tolerance_inr) })}>
        <Icon name="check-circle" size={20} />
        <p>
          <strong>{t('ledger.reconciledShort')}</strong>
          <span className="banner-sep" aria-hidden="true">
            —
          </span>
          <span className="num">
            {t('recon.sums', 'Σ orders {{orders}} = Σ channels {{channels}} = Σ products {{products}} ✓', { orders: formatInr(o), channels: formatInr(c), products: formatInr(p) })}
          </span>
        </p>
      </div>
    );
  }
  return (
    <div className="banner banner-danger recon" role="alert">
      <Icon name="alert-triangle" size={20} />
      <p>
        <strong>{t('recon.differ', 'Totals differ by {{inr}}', { inr: formatInr(rec.gap_inr) })}</strong>
        <span className="banner-sep" aria-hidden="true">
          —
        </span>
        <span className="num">
          {t('recon.sumsGap', 'Σ orders {{orders}} · Σ channels {{channels}} · Σ products {{products}}', { orders: formatInr(o), channels: formatInr(c), products: formatInr(p) })}
        </span>
      </p>
    </div>
  );
}
