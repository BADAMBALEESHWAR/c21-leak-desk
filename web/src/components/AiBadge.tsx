import { useTranslation } from 'react-i18next';
import { hrefFor } from '../lib/router';
import { Icon } from './Icon';

export type AiBadgeSource = 'ai' | 'template' | 'table';

/**
 * Marks every AI surface. "AI" text was worded by the model from engine numbers it cannot change; "Template" is the
 * deterministic wording; "Table" is a lookup straight from the engine. Each links to the page that explains the guard.
 */
export function AiBadge({ source, compact = false, className, text }: { source: AiBadgeSource; compact?: boolean; className?: string; text?: string }) {
  const { t } = useTranslation();
  const label = text
    ? text
    : source === 'ai'
      ? t('aiBadge.ai', 'AI summary · numbers from the engine')
      : source === 'table'
        ? t('aiBadge.table', 'Table · straight from the engine')
        : t('aiBadge.template', 'Template text');
  return (
    <span className={['ai-badge', `ai-badge-${source}`, className].filter(Boolean).join(' ')} data-source={source}>
      <span className="ai-badge-chip">
        {source === 'ai' ? <Icon name="sparkles" size={12} strokeWidth={2} /> : <Icon name={source === 'table' ? 'table' : 'file'} size={12} strokeWidth={2} />}
        {source === 'ai' ? t('aiBadge.short', 'AI') : source === 'table' ? t('aiBadge.tableShort', 'Table') : t('aiBadge.templateShort', 'Template')}
      </span>
      {compact ? null : <span className="ai-badge-text">{label}</span>}
      <a className="ai-badge-link" href={hrefFor('ai')} title={label}>
        {t('aiBadge.why', 'Why this is safe')}
      </a>
    </span>
  );
}
