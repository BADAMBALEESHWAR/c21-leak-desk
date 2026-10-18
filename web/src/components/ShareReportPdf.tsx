import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadFileBlob, reportPdf, sharePdf } from '../lib/pdf';
import { whatsappUrl } from '../lib/share';
import { useStore } from '../state/store';
import { Button } from './Button';

/**
 * "Send {month} report on WhatsApp": the report sheet becomes a PDF. On a phone the share sheet opens with the PDF attached;
 * on a computer the PDF is saved and WhatsApp opens with a one-line note so it can be attached. No long English text.
 */
export function ShareReportPdf({ sheetId, monthLabel, monthKey }: { sheetId: string; monthLabel: string; monthKey: string }) {
  const { t } = useTranslation();
  const { showToast } = useStore();
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const el = document.getElementById(sheetId);
    if (!el || busy) return;
    setBusy(true);
    try {
      const file = await reportPdf(el, `Profyn-report-${monthKey}.pdf`);
      const note = t('share.pdfNote', 'Profyn report for {{month}}', { month: monthLabel });
      if (await sharePdf(file, note, note)) return;
      downloadFileBlob(file);
      showToast(t('share.pdfSaved', 'PDF saved. Attach it in WhatsApp.'), 'success');
      window.open(whatsappUrl(note), '_blank', 'noopener');
    } catch {
      showToast(t('share.pdfFailed', 'Could not make the PDF. Use Print / Save as PDF.'), 'info');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="primary" icon="message" onClick={() => void send()} disabled={busy} aria-busy={busy || undefined}>
      {busy ? t('share.pdfMaking', 'Making PDF…') : t('share.pdfButton', 'Send {{month}} report on WhatsApp', { month: monthLabel })}
    </Button>
  );
}
