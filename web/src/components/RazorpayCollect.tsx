import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, toErrorInfo, type ErrorInfo } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { copyText, whatsappUrl } from '../lib/share';
import { formatInr } from '../lib/format';
import { useStore } from '../state/store';
import { Button, ButtonLink } from './Button';
import { ErrorCallout } from './ui';

/**
 * "Fix this" for return shipping: create a Razorpay payment link for the amount a customer owes and send it on WhatsApp.
 * Shown only to signed-in owners and only when the server has Razorpay keys.
 */
export function RazorpayCollect({ defaultAmount }: { defaultAmount: number | null }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const { showToast } = useStore();
  const [enabled, setEnabled] = useState<{ enabled: boolean; mode: string | null } | null>(null);
  const [amount, setAmount] = useState(String(Math.max(1, Math.round(defaultAmount ?? 100))));
  const [note, setNote] = useState(() => t('razorpay.defaultNote', 'Return shipping charge'));
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api.razorpayStatus().then((s) => alive && setEnabled(s)).catch(() => alive && setEnabled({ enabled: false, mode: null }));
    return () => {
      alive = false;
    };
  }, []);

  if (!auth.user || !enabled?.enabled) return null;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.razorpayLink({ amount_inr: Math.round(Number(amount)), description: note, ...(phone.trim() ? { customer_contact: phone.trim() } : {}) });
      setLink(r.short_url);
    } catch (err) {
      setError(toErrorInfo(err));
    } finally {
      setBusy(false);
    }
  };
  const message = link ? `${note}: ${formatInr(Number(amount))}\n${link}` : '';

  return (
    <section className="fix-razorpay" aria-label={t('razorpay.title', 'Collect with Razorpay')}>
      <h3 className="mini-title">{t('razorpay.title', 'Collect with Razorpay')}</h3>
      <p className="muted small">{t('razorpay.hint', 'Make a payment link for the customer and send it on WhatsApp.')}{enabled.mode === 'test' ? ` (${t('razorpay.testMode', 'test mode')})` : ''}</p>
      <div className="fix-razorpay-fields">
        <label>
          <span>{t('razorpay.amount', 'Amount (₹)')}</span>
          <input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} />
        </label>
        <label>
          <span>{t('razorpay.note', 'Note for the customer')}</span>
          <input className="input" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label>
          <span>{t('razorpay.phone', 'Customer phone (optional)')}</span>
          <input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
      </div>
      <ErrorCallout error={error} />
      {link ? (
        <div className="fix-razorpay-done" role="status">
          <a href={link} target="_blank" rel="noopener noreferrer">{link}</a>
          <Button variant="secondary" size="sm" icon="copy" onClick={() => void copyText(link).then((ok) => showToast(ok ? t('razorpay.copied', 'Link copied') : t('share.copyFailed', 'This browser blocked copying. Use Share on WhatsApp instead.'), ok ? 'success' : 'info'))}>
            {t('razorpay.copy', 'Copy link')}
          </Button>
          <ButtonLink variant="primary" size="sm" icon="message" href={whatsappUrl(message)} target="_blank" rel="noopener noreferrer">
            {t('razorpay.whatsapp', 'Send on WhatsApp')}
          </ButtonLink>
        </div>
      ) : (
        <Button variant="primary" onClick={() => void create()} disabled={busy || !Number(amount) || !note.trim()} aria-busy={busy || undefined}>
          {busy ? t('razorpay.creating', 'Creating link…') : t('razorpay.create', 'Create Razorpay payment link')}
        </Button>
      )}
    </section>
  );
}
