import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { Digest } from '../api/types';
import { AiBadge } from './AiBadge';
import { Icon, type IconName } from './Icon';
import { Skeleton } from './ui';

export interface DigestState {
  digest: Digest | null;
  loading: boolean;
}

/**
 * GET /analyses/:id/digest in the UI language. A new analysis or language starts empty; `refresh` (e.g. after a decision
 * is saved) fetches again and keeps the current text until the new one arrives. A failure or a server without the
 * endpoint leaves it null.
 */
export function useDigest(analysisId: string | null, lang: string, refresh = 0): DigestState {
  const key = analysisId ? `${analysisId}|${lang}` : '';
  const [inner, setInner] = useState<DigestState & { key: string }>({ key: '', digest: null, loading: false });
  useEffect(() => {
    if (!analysisId) return undefined;
    let cancelled = false;
    setInner((s) => (s.key === key ? { ...s, loading: s.digest === null } : { key, digest: null, loading: true }));
    api
      .digest(analysisId, lang)
      .then((d) => {
        if (!cancelled) setInner({ key, digest: d && Array.isArray(d.sections) && d.sections.length > 0 ? d : null, loading: false });
      })
      .catch(() => {
        if (!cancelled) setInner((s) => ({ key, digest: s.key === key ? s.digest : null, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [analysisId, lang, refresh, key]);
  if (!analysisId) return { digest: null, loading: false };
  // A new analysis or language counts as loading from its first render, so the card never blinks out in between.
  if (inner.key !== key) return { digest: null, loading: true };
  return { digest: inner.digest, loading: inner.loading };
}

const SECTION_ICON: Record<string, IconName> = {
  changed: 'activity',
  leaked: 'trending-down',
  decided: 'check-circle',
  check: 'refresh',
};

/** The API's badge line in the UI language when it is one of the known lines; otherwise as the API wrote it. */
function useBadgeText(digest: Digest | null): string | undefined {
  const { t } = useTranslation();
  const badge = digest?.badge;
  if (!badge) return undefined;
  if (badge === 'Summary · numbers from the engine') return t('aiBadge.summary', 'Summary · numbers from the engine');
  if (badge === 'AI summary · numbers from the engine') return t('aiBadge.ai', 'AI summary · numbers from the engine');
  return badge;
}

/**
 * "AI briefing": the digest's four sections (what changed, where money leaked, what was decided, what to check in 30
 * days) in one compact card. A skeleton while it loads; nothing at all when the digest is not available.
 */
export function AiBriefing({ state, pending = false }: { state: DigestState; pending?: boolean }) {
  const { t } = useTranslation();
  const badge = useBadgeText(state.digest);
  const loading = !state.digest && (state.loading || pending);
  if (!state.digest && !loading) return null;
  const sections = state.digest?.sections.slice(0, 4) ?? [];
  return (
    <section className="card ov-brief" aria-labelledby="ov-brief-title" aria-busy={loading || undefined}>
      <div className="ov-brief-head">
        <span className="ov-brief-mark" aria-hidden="true">
          <Icon name="sparkles" size={16} strokeWidth={2} />
        </span>
        <h2 id="ov-brief-title" className="ov-brief-title">
          {t('briefing.title', 'AI briefing')}
        </h2>
        {state.digest ? <AiBadge source={state.digest.source} text={badge} className="ov-brief-badge" /> : null}
      </div>
      {loading ? (
        <div className="ov-brief-grid" role="status" aria-label={t('briefing.loading', 'Writing the briefing…')}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="ov-brief-item">
              <Skeleton width="55%" height={11} />
              <Skeleton width="95%" height={12} className="skeleton-gap" />
              <Skeleton width="75%" height={12} className="skeleton-gap" />
            </div>
          ))}
        </div>
      ) : (
        <dl className="ov-brief-grid">
          {sections.map((s) => (
            <div key={s.key} className={`ov-brief-item is-${s.key}`}>
              <dt>
                <Icon name={SECTION_ICON[s.key] ?? 'info'} size={14} />
                {s.title}
              </dt>
              <dd>{s.text}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
