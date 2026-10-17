import { useTranslation } from 'react-i18next';
import type { Reconciliation } from '../api/types';
import { formatInr } from '../lib/format';
import { Icon } from './Icon';

/** Banner card: Σ orders = Σ channels = Σ products, or the gap. */
export function ReconciliationLine({ rec }: { rec: Reconciliation }) {
  const { t } = useTranslation();
  const { orders_inr: o, channels_inr: c, products_inr: p } = rec;
  if (o === null || c === null || p === null) {
    return (
      <div className="banner banner-warning" role="status">
        <Icon name="alert-triangle" size={20} />
        <p>
          <strong>Not reconciled.</strong> {rec.statement}
        </p>
      </div>
    );
  }
  if (rec.ok) {
    return (
      <div className="banner banner-success recon" role="status" title={`Reconciled within ±${formatInr(rec.tolerance_inr)}`}>
        <Icon name="check-circle" size={20} />
        <p>
          <strong>{t('ledger.reconciledShort')}</strong>
          <span className="banner-sep" aria-hidden="true">
            —
          </span>
          <span className="num">
            Σ orders {formatInr(o)} = Σ channels {formatInr(c)} = Σ products {formatInr(p)} ✓
          </span>
        </p>
      </div>
    );
  }
  return (
    <div className="banner banner-danger recon" role="alert">
      <Icon name="alert-triangle" size={20} />
      <p>
        <strong>Totals differ by {formatInr(rec.gap_inr)}</strong>
        <span className="banner-sep" aria-hidden="true">
          —
        </span>
        <span className="num">
          Σ orders {formatInr(o)} · Σ channels {formatInr(c)} · Σ products {formatInr(p)}
        </span>
      </p>
    </div>
  );
}
