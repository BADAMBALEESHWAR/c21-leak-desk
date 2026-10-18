import { useTranslation } from 'react-i18next';
import { askProfyn } from '../lib/ask';
import { Icon } from './Icon';

/** A small sparkle button that opens Ask Profyn with a plain question about the card it sits on. */
export function AskAiButton({ question, about, className }: { question: string; about: string; className?: string }) {
  const { t } = useTranslation();
  const label = t('askAi.about', 'Ask Profyn about {{thing}}', { thing: about });
  return (
    <button
      type="button"
      className={['ask-ai-btn', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        askProfyn(question);
      }}
    >
      <Icon name="sparkles" size={14} strokeWidth={2} />
    </button>
  );
}
