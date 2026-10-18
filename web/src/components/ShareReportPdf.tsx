import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { reportPdf } from '../lib/pdf';
import { copyText, whatsappUrl } from '../lib/share';
import { useStore } from '../state/store';
import { Button } from './Button';

/**
 * "Send {month} report on WhatsApp": the report sheet becomes a PDF, is stored on the server for 7 days, and WhatsApp
 * opens with a message that links to it. A web page cannot attach a file to WhatsApp, so the link is what reaches the
 * other person; tapping it opens the PDF. The WhatsApp tab is opened on the click itself so browsers do not block it.
 */
export function ShareReportPdf({ sheetId, monthLabel, monthKey }: { sheetId: string; monthLabel: string; monthKey: string }) {
  const { t } = useTranslation();
  const { showToast } = useStore();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const send = async () => {
    const el = document.getElementById(sheetId);
    if (!el || busy) return;
    const tab = window.open('about:blank', '_blank');
    setBusy(true);
    try {
      const file = await reportPdf(el, `Profyn-report-${monthKey}.pdf`);
      const res = await fetch('/api/v1/reports', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file, credentials: 'same-origin' });
      if (!res.ok) throw new Error(`upload ${res.status}`);
      const { path } = (await res.json()) as { path: string };
      const url = `${window.location.origin}${path}`;
      setLink(url);
      const text = t('share.pdfMessage', 'Profyn report for {{month}} (PDF): {{url}}', { month: monthLabel, url });
      if (tab) tab.location.href = whatsappUrl(text);
      else window.location.href = whatsappUrl(text);
    } catch {
      tab?.close();
      showToast(t('share.pdfFailed', 'Could not make the PDF. Use Print / Save as PDF.'), 'info');
    } finally {
      setBusy(false);
    }
  };

  const copy = () =>
    link
      ? void copyText(link).then((ok) =>
          showToast(ok ? t('share.linkCopied', 'Report link copied (valid for 7 days)') : t('share.copyFailed', 'This browser blocked copying. Use Share on WhatsApp instead.'), ok ? 'success' : 'info'),
        )
      : undefined;

  return (
    <span className="share-pdf">
      <Button variant="primary" icon="message" onClick={() => void send()} disabled={busy} aria-busy={busy || undefined}>
        {busy ? t('share.pdfMaking', 'Making PDF…') : t('share.pdfButton', 'Send {{month}} report on WhatsApp', { month: monthLabel })}
      </Button>
      {link ? (
        <Button variant="secondary" size="sm" icon="copy" onClick={copy}>
          {t('share.copyLink', 'Copy report link')}
        </Button>
      ) : null}
    </span>
  );
}
