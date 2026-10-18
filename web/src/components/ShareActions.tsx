import { useTranslation } from 'react-i18next';
import { copyText, whatsappUrl } from '../lib/share';
import { useStore } from '../state/store';
import { Button, ButtonLink } from './Button';

/** "Share on WhatsApp" (wa.me in a new tab) and "Copy summary"; both disabled until the summary exists. */
export function ShareActions({ text }: { text: string | null }) {
  const { t } = useTranslation();
  const { showToast } = useStore();
  const whatsapp = t('share.whatsapp', 'Share on WhatsApp');
  const copy = async () => {
    if (!text) return;
    const ok = await copyText(text);
    showToast(ok ? t('share.copied', 'Summary copied') : t('share.copyFailed', 'This browser blocked copying. Use Share on WhatsApp instead.'), ok ? 'success' : 'info');
  };
  return (
    <div className="share-actions" role="group" aria-label={t('share.group', 'Share this summary')}>
      {text ? (
        <ButtonLink variant="secondary" size="sm" icon="message" href={whatsappUrl(text)} target="_blank" rel="noopener noreferrer">
          {whatsapp}
        </ButtonLink>
      ) : (
        <Button variant="secondary" size="sm" icon="message" disabled>
          {whatsapp}
        </Button>
      )}
      <Button variant="secondary" size="sm" icon="copy" disabled={!text} onClick={() => void copy()}>
        {t('share.copy', 'Copy summary')}
      </Button>
    </div>
  );
}
