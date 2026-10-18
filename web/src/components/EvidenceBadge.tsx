import { useTranslation } from 'react-i18next';
import type { Confidence, Evidence } from '../api/types';
import { apiText } from '../lib/apiText';
import { formatInr } from '../lib/format';
import { ConfidenceBadge, Pill } from './Badge';

/**
 * Statistical confidence for a fix: a level (high / medium / low) from a bootstrap over the owner's own orders, the
 * 95% range for the rupee change, and how often the fix gained money across the resamples. Falls back to the engine's
 * own confidence when the API sent no evidence; "unknown" is never shown as a bare word.
 */
export function EvidenceBadge({ evidence, confidence }: { evidence?: Evidence | null; confidence?: Confidence | null }) {
  const { t } = useTranslation();
  if (!evidence) {
    return confidence && confidence !== 'unknown' ? <ConfidenceBadge confidence={confidence} prefix={t('overview.confidence', 'Confidence')} /> : null;
  }
  const word =
    evidence.level === 'high' ? t('evidence.high', 'High confidence') : evidence.level === 'medium' ? t('evidence.medium', 'Medium confidence') : t('evidence.low', 'Low confidence');
  const tone = evidence.level === 'high' ? 'success' : evidence.level === 'medium' ? 'primary' : 'warning';
  const pct = Math.round(evidence.p_positive * 100);
  const tip = t(
    'evidence.tip',
    'Your orders were resampled many times. The fix gained money in {{pct}}% of them, and the change stayed between {{low}} and {{high}} 95% of the time. {{reason}}',
    { pct, low: formatInr(evidence.ci_low_inr), high: formatInr(evidence.ci_high_inr), reason: apiText(evidence.reason) },
  );
  return (
    <span className="evidence" title={tip}>
      <Pill tone={tone} icon="trending-up">
        {word}
      </Pill>
      <span className="evidence-range">
        {t('evidence.range', '95% range {{low}} to {{high}}', { low: formatInr(evidence.ci_low_inr), high: formatInr(evidence.ci_high_inr) })}
        {' · '}
        {t('evidence.pGain', 'gains in {{pct}}% of resamples', { pct })}
      </span>
    </span>
  );
}
