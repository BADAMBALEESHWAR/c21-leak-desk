import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { aiLocalOff, api, isNotFound, setAiLocalOff, toErrorInfo, type ErrorInfo } from '../api/client';
import type { AiFeatureCount, AiStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Pill } from '../components/Badge';
import { Icon, type IconName } from '../components/Icon';
import { PageHeader } from '../components/Page';
import { Callout, ErrorCallout, Skeleton } from '../components/ui';
import { formatCount } from '../lib/format';
import { hrefFor } from '../lib/router';
import { useStore } from '../state/store';

/** Automated tests in the repository (npm test), the engine's guard against regressions. */
export const ENGINE_TESTS = 350;
/** The largest real export run end to end so far. */
export const LARGEST_FILE_ORDERS = 58958;

/** GET /ai/status; null with notFound when the server has no guard log yet. */
export function useAiStatus(): { status: AiStatus | null; loading: boolean; error: ErrorInfo | null; notFound: boolean } {
  const [state, setState] = useState<{ status: AiStatus | null; loading: boolean; error: ErrorInfo | null; notFound: boolean }>({
    status: null,
    loading: true,
    error: null,
    notFound: false,
  });
  useEffect(() => {
    let cancelled = false;
    api
      .aiStatus()
      .then((status) => !cancelled && setState({ status, loading: false, error: null, notFound: false }))
      .catch((err) => !cancelled && setState({ status: null, loading: false, error: isNotFound(err) ? null : toErrorInfo(err), notFound: isNotFound(err) }));
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/** fields_sent as one flat, de-duplicated list (it may come per feature). */
export function fieldsOf(f: AiStatus['fields_sent'] | undefined): string[] {
  if (!f) return [];
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(f);
  return [...out];
}

function featureRows(s: AiStatus): Array<{ name: string; calls: number | null; accepted: number | null; rejected: number | null }> {
  return Object.entries(s.by_feature ?? {}).map(([name, v]) => {
    if (typeof v === 'number') return { name, calls: v, accepted: null, rejected: null };
    const c = v as AiFeatureCount;
    return { name, calls: c.calls ?? null, accepted: c.accepted ?? null, rejected: c.rejected ?? null };
  });
}

/**
 * The AI switch. Signed in: the account's consent (PATCH /me/consent). Guest: this browser only, sent as X-Profyn-AI: off.
 * Numbers never depend on it; only the wording around them does.
 */
export function AiSwitch() {
  const { t } = useTranslation();
  const auth = useAuth();
  const { showToast } = useStore();
  const id = useId();
  const account = auth.mode === 'account';
  const [on, setOn] = useState<boolean>(() => !aiLocalOff());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);

  useEffect(() => {
    if (!account) return undefined;
    let cancelled = false;
    api
      .profile()
      .then((p) => {
        const ai = p?.consent?.ai ?? p?.user?.consent?.ai;
        if (!cancelled && typeof ai === 'boolean') setOn(ai);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [account]);

  const change = async (next: boolean) => {
    setError(null);
    if (!account) {
      setAiLocalOff(!next);
      setOn(next);
      showToast(next ? t('ai.switchedOn', 'AI wording is on.') : t('ai.switchedOff', 'AI wording is off. Template text only.'), 'info');
      return;
    }
    setBusy(true);
    try {
      await api.setConsent({ ai: next });
      setOn(next);
      showToast(next ? t('ai.switchedOn', 'AI wording is on.') : t('ai.switchedOff', 'AI wording is off. Template text only.'), 'info');
    } catch (err) {
      setError(toErrorInfo(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`switch-row ai-switch${on ? '' : ' is-off'}`}>
      <label className="switch" htmlFor={`${id}-ai`}>
        <input id={`${id}-ai`} type="checkbox" role="switch" checked={on} onChange={(e) => void change(e.target.checked)} disabled={busy} aria-describedby={`${id}-ai-note`} />
        <span className="switch-track" aria-hidden="true">
          <span className="switch-thumb" />
        </span>
        <span className="switch-label">{t('ai.switchLabel', 'AI wording')}</span>
        <Pill tone={on ? 'primary' : 'neutral'}>{on ? t('ai.on', 'On') : t('ai.off', 'Off')}</Pill>
      </label>
      <p id={`${id}-ai-note`} className="small muted ai-switch-note">
        {account
          ? t('ai.switchAccount', 'Saved to your account. Off means every explanation uses the template text; the numbers stay the same.')
          : t('ai.switchGuest', 'Kept in this browser. Off means every explanation uses the template text; the numbers stay the same.')}
      </p>
      <ErrorCallout error={error} />
    </div>
  );
}

function GuardLog() {
  const { t } = useTranslation();
  const { status, loading, error, notFound } = useAiStatus();
  if (loading) {
    return (
      <div aria-busy="true">
        <Skeleton width="50%" height={14} />
        <Skeleton width="80%" height={14} className="skeleton-gap" />
      </div>
    );
  }
  if (notFound) return <p className="muted">{t('ai.logUnavailable', 'The guard log is not available on this server yet.')}</p>;
  if (error || !status) return <ErrorCallout error={error} />;
  const rows = featureRows(status);
  const fields = fieldsOf(status.fields_sent);
  const byFeature: Array<[string, string[]]> =
    status.fields_sent && !Array.isArray(status.fields_sent)
      ? Object.entries(status.fields_sent).map(([k, v]): [string, string[]] => [k, fieldsOf(v as AiStatus['fields_sent'])]).filter(([, v]) => v.length > 0)
      : [];
  return (
    <div className="ai-log">
      <p className="ai-log-model">
        <Pill tone={status.enabled ? 'success' : 'neutral'} dot>
          {status.enabled ? t('ai.enabled', 'AI enabled on this server') : t('ai.disabled', 'AI switched off on this server')}
        </Pill>
        {status.provider || status.model ? (
          <span className="muted small">
            {[status.provider, status.model].filter(Boolean).join(' · ')}
          </span>
        ) : null}
      </p>
      <dl className="ai-log-counts">
        <div>
          <dt>{t('ai.calls', 'Calls')}</dt>
          <dd className="num">{formatCount(status.calls ?? 0)}</dd>
        </div>
        <div>
          <dt>{t('ai.accepted', 'Accepted')}</dt>
          <dd className="num t-gain">{formatCount(status.accepted ?? 0)}</dd>
        </div>
        <div>
          <dt>{t('ai.rejected', 'Rejected by the guard')}</dt>
          <dd className="num">{formatCount(status.rejected ?? 0)}</dd>
        </div>
      </dl>
      {rows.length > 0 ? (
        <div className="table-scroll">
          <table className="table ai-log-table">
            <caption className="visually-hidden">{t('ai.byFeature', 'Calls by feature')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('ai.feature', 'Feature')}</th>
                <th scope="col" className="r">
                  {t('ai.calls', 'Calls')}
                </th>
                <th scope="col" className="r">
                  {t('ai.accepted', 'Accepted')}
                </th>
                <th scope="col" className="r">
                  {t('ai.rejected', 'Rejected by the guard')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <th scope="row">{r.name.replace(/_/g, ' ')}</th>
                  <td className="r num">{r.calls === null ? '—' : formatCount(r.calls)}</td>
                  <td className="r num">{r.accepted === null ? '—' : formatCount(r.accepted)}</td>
                  <td className="r num">{r.rejected === null ? '—' : formatCount(r.rejected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {byFeature.length > 0 ? (
        <details className="ai-fields-details">
          <summary>
            {t('ai.fieldsSent', 'Fields the AI may see')} · {formatCount(fields.length)}
          </summary>
          <dl className="ai-fields-by">
          {byFeature.map(([feature, list]) => (
            <div key={feature}>
              <dt>{feature.replace(/_/g, ' ')}</dt>
              <dd>
                <ul className="ai-fields">
                  {list.map((f) => (
                    <li key={f}>
                      <code>{f}</code>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ))}
          </dl>
        </details>
      ) : (
        <>
          <h3 className="mini-title">{t('ai.fieldsSent', 'Fields the AI may see')}</h3>
          {fields.length > 0 ? (
            <ul className="ai-fields">
              {fields.map((f) => (
                <li key={f}>
                  <code>{f}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{t('ai.noFields', 'None reported.')}</p>
          )}
        </>
      )}
      {status.region_note ? <p className="small muted">{status.region_note}</p> : null}
      <p className="small muted">{t('ai.logNote', 'Counts since the server started. A rejected reply is replaced by the template text, so the page never shows an unchecked number.')}</p>
    </div>
  );
}

export function AiScreen() {
  const { t } = useTranslation();
  const { checks } = useStore();
  const points: Array<{ icon: IconName; title: string; text: string }> = [
    {
      icon: 'check-circle',
      title: t('ai.p1Title', 'A deterministic, reconciled engine'),
      text: t('ai.p1Text', 'Every rupee comes from the same engine on every run, and orders, channels and products add up to the same total. More than {{n}} automated tests guard it, and the public checks run on the reference orders.', {
        n: formatCount(ENGINE_TESTS),
      }),
    },
    {
      icon: 'database',
      title: t('ai.p2Title', 'Scale'),
      text: t('ai.p2Text', 'A {{n}}-order Shopify export was processed end to end, the whole file and not a sample of it.', { n: formatCount(LARGEST_FILE_ORDERS) }),
    },
    {
      icon: 'file',
      title: t('ai.p3Title', 'Memory and audit'),
      text: t('ai.p3Text', 'Decisions, assumptions, corrections and their 30-day checks are saved with a date and an owner, so next month starts from what you decided.'),
    },
    {
      icon: 'sliders',
      title: t('ai.p4Title', 'The semantics are fixed'),
      text: t('ai.p4Text', 'A refund and its recovery are netted once. Unknown stays unknown, never zero. Refunds dated after the period end are prior-period adjustments, not silent restatements.'),
    },
    {
      icon: 'activity',
      title: t('ai.p5Title', 'Your language, your workflow'),
      text: t('ai.p5Text', 'English, Hindi and Telugu, from import to ledger, leaks, scenario and decision in one place, with a monthly report to share.'),
    },
    {
      icon: 'lock',
      title: t('ai.p6Title', 'Privacy'),
      text: t('ai.p6Text', 'The AI sees aggregates only: totals, counts and labels. Never order rows, customer names, emails or phone numbers. You can switch it off.'),
    },
  ];

  return (
    <div className="page ai-page">
      <PageHeader title={t('ai.title', 'Why Profyn, not a chat window')} subtitle={t('ai.sub', 'Where AI helps, where it is not allowed to, and the live log that proves it.')} />

      <blockquote className="card ai-quote">
        <Icon name="sparkles" size={20} />
        <p>{t('ai.quote', 'ChatGPT gives you a story once; Profyn gives you a ledger every month.')}</p>
      </blockquote>

      <ul className="ai-points">
        {points.map((p) => (
          <li key={p.title} className="card ai-point">
            <span className="icon-chip" aria-hidden="true">
              <Icon name={p.icon} size={18} />
            </span>
            <h2 className="ai-point-title">{p.title}</h2>
            <p>{p.text}</p>
          </li>
        ))}
      </ul>
      {checks ? (
        <p className="small muted">
          {t('ai.checksLine', 'Public checks right now: {{passed}} of {{total}} pass.', { passed: checks.passed, total: checks.total })}{' '}
          <a href={hrefFor('checks')}>{t('ai.seeChecks', 'See the checks')}</a>
        </p>
      ) : null}

      <div className="ai-grid">
        <section className="card" aria-labelledby="ai-log-title">
          <h2 id="ai-log-title" className="card-title">
            {t('ai.logTitle', 'Live guard log')}
          </h2>
          <p className="card-sub">{t('ai.logSub', 'Every AI reply is checked against the engine before it is shown: a number the engine did not produce is rejected.')}</p>
          <GuardLog />
        </section>
        <section className="card" aria-labelledby="ai-switch-title">
          <h2 id="ai-switch-title" className="card-title">
            {t('ai.switchTitle', 'Switch AI off')}
          </h2>
          <p className="card-sub">{t('ai.switchSub', 'Profyn works the same without AI: the explanations use fixed templates instead.')}</p>
          <AiSwitch />
          <Callout tone="info" title={t('ai.defaultsTitle', 'Defaults')}>
            <p className="callout-hint">{t('ai.defaults', 'AI wording is off by default for data you upload and on for the synthetic demo.')}</p>
          </Callout>
          <p className="small">
            <a href={hrefFor('trust')}>{t('ai.trustLink', 'Read the data promise')}</a>
          </p>
        </section>
      </div>
    </div>
  );
}
