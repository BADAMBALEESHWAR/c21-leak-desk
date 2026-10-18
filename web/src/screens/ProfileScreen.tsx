import { useEffect, useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, downloadFile, isNotFound, toErrorInfo, type ErrorInfo } from '../api/client';
import type { AuditEntry, Consent, LoginEntry, MeProfile } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { signOut as endSession } from '../auth/auth';
import { Pill } from '../components/Badge';
import { Button, ButtonLink } from '../components/Button';
import { EmptyPanel, ErrorCallout, Skeleton } from '../components/ui';
import { PageHeader } from '../components/Page';
import { formatDateTime } from '../lib/format';
import { useStore } from '../state/store';

const PROVIDER_NAMES: Record<string, string> = { google: 'Google', github: 'GitHub', email: 'Email' };

function when(v: unknown): string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? formatDateTime(v) : '—';
}

function ConsentSwitch({ label, note, checked, busy, onChange }: { label: string; note: string; checked: boolean; busy: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="switch-row profile-switch">
      <label className="switch" htmlFor={id}>
        <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={busy} aria-describedby={`${id}-note`} />
        <span className="switch-track" aria-hidden="true">
          <span className="switch-thumb" />
        </span>
        <span className="switch-label">{label}</span>
      </label>
      <p id={`${id}-note`} className="small muted">
        {note}
      </p>
    </div>
  );
}

export function ProfileScreen() {
  const { t } = useTranslation();
  const auth = useAuth();
  const { showToast } = useStore();
  const account = auth.mode === 'account';
  const [me, setMe] = useState<MeProfile | null>(null);
  const [loading, setLoading] = useState(account);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [consent, setConsent] = useState<Consent>({});
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<ErrorInfo | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [auditUnavailable, setAuditUnavailable] = useState(false);
  const [exportError, setExportError] = useState<ErrorInfo | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<ErrorInfo | null>(null);
  const deleteId = useId();

  useEffect(() => {
    if (!account) return undefined;
    let cancelled = false;
    setLoading(true);
    api
      .profile()
      .then((p) => {
        if (cancelled) return;
        setMe(p);
        setConsent(p.consent ?? p.user?.consent ?? {});
      })
      .catch((err) => !cancelled && setError(toErrorInfo(err)))
      .finally(() => !cancelled && setLoading(false));
    api
      .audit()
      .then((a) => !cancelled && setAudit(Array.isArray(a) ? a : Array.isArray(a?.entries) ? a.entries : []))
      .catch((err) => {
        if (cancelled) return;
        setAudit([]);
        setAuditUnavailable(isNotFound(err));
      });
    return () => {
      cancelled = true;
    };
  }, [account]);

  const title = t('profile.title', 'Your profile');

  if (!account) {
    return (
      <div className="page">
        <PageHeader title={title} />
        <EmptyPanel
          icon="user"
          title={t('profile.signInTitle', 'Sign in to see your profile.')}
          actions={
            <ButtonLink variant="primary" href={auth.loginUrl} icon="user">
              {t('actions.signIn')}
            </ButtonLink>
          }
        >
          <p>{t('profile.signInText', 'Your profile shows your sign-ins, your consent switches and your audit log, and lets you export or delete your data.')}</p>
        </EmptyPanel>
      </div>
    );
  }

  const user = me?.user;
  const name = user?.name || auth.user?.name || null;
  const email = user?.email ?? auth.user?.email ?? null;
  const provider = user?.provider ?? auth.user?.provider ?? null;
  const avatar = user?.avatar_url ?? auth.user?.avatarUrl ?? null;
  const logins: LoginEntry[] = me?.logins ?? [];

  const changeConsent = async (patch: Consent) => {
    setConsentBusy(true);
    setConsentError(null);
    const before = consent;
    setConsent({ ...consent, ...patch });
    try {
      await api.setConsent(patch);
      showToast(t('profile.consentSaved', 'Saved.'), 'info');
    } catch (err) {
      setConsent(before);
      setConsentError(toErrorInfo(err));
    } finally {
      setConsentBusy(false);
    }
  };

  const exportData = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadFile(api.meExportUrl(), 'profyn-my-data.json');
    } catch (err) {
      setExportError(toErrorInfo(err));
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async (e: FormEvent) => {
    e.preventDefault();
    if (confirm !== 'DELETE') return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteMe();
      endSession();
    } catch (err) {
      setDeleteError(toErrorInfo(err));
      setDeleting(false);
    }
  };

  return (
    <div className="page profile-page">
      <PageHeader title={title} subtitle={t('profile.sub', 'Who you are signed in as, what you have agreed to, and your data.')} />
      <ErrorCallout error={error} />

      <section className="card profile-card" aria-label={t('profile.account', 'Account')}>
        {loading ? (
          <Skeleton width="40%" height={20} />
        ) : (
          <div className="profile-id">
            {avatar ? (
              <img className="profile-avatar" src={avatar} alt="" width={56} height={56} referrerPolicy="no-referrer" />
            ) : (
              <span className="profile-avatar is-letter" aria-hidden="true">
                {(name ?? email ?? '?').charAt(0).toUpperCase()}
              </span>
            )}
            <div>
              <p className="profile-name">{name ?? email ?? t('topbar.signedIn')}</p>
              {email && name ? <p className="muted">{email}</p> : null}
              {provider ? (
                <Pill tone="neutral">{t('profile.provider', 'Signed in with {{provider}}', { provider: PROVIDER_NAMES[provider] ?? provider })}</Pill>
              ) : null}
            </div>
            <Button variant="secondary" size="sm" icon="log-out" onClick={auth.signOut} className="profile-signout">
              {t('actions.signOut')}
            </Button>
          </div>
        )}
      </section>

      <div className="profile-grid">
        <section className="card" aria-labelledby="profile-consent">
          <h2 id="profile-consent" className="card-title">
            {t('profile.consentTitle', 'Consent')}
          </h2>
          <ConsentSwitch
            label={t('profile.aiConsent', 'AI wording on my data')}
            note={t('profile.aiConsentNote', 'Off: every explanation uses the template text. The AI only ever sees aggregates.')}
            checked={consent.ai === true}
            busy={consentBusy}
            onChange={(v) => void changeConsent({ ai: v })}
          />
          <ConsentSwitch
            label={t('profile.digestConsent', 'Monthly digest by email')}
            note={t('profile.digestConsentNote', 'A short summary of the month after each import. Nothing else is sent.')}
            checked={consent.email_digest === true}
            busy={consentBusy}
            onChange={(v) => void changeConsent({ email_digest: v })}
          />
          <ErrorCallout error={consentError} />
        </section>

        <section className="card" aria-labelledby="profile-logins">
          <h2 id="profile-logins" className="card-title">
            {t('profile.loginsTitle', 'Recent sign-ins')}
          </h2>
          {logins.length === 0 ? (
            <p className="muted small">{loading ? '…' : t('profile.noLogins', 'No sign-in history yet.')}</p>
          ) : (
            <table className="table profile-table">
              <caption className="visually-hidden">{t('profile.loginsTitle', 'Recent sign-ins')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('profile.when', 'When')}</th>
                  <th scope="col">{t('profile.with', 'With')}</th>
                  <th scope="col">{t('profile.device', 'Device')}</th>
                </tr>
              </thead>
              <tbody>
                {logins.slice(0, 10).map((l, i) => (
                  <tr key={`${String(l.at)}-${i}`}>
                    <td className="num">{when(l.at)}</td>
                    <td>{l.provider ? PROVIDER_NAMES[l.provider] ?? l.provider : '—'}</td>
                    <td className="cell-wrap small">{typeof l.user_agent === 'string' ? l.user_agent.slice(0, 60) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="card" aria-labelledby="profile-audit">
        <h2 id="profile-audit" className="card-title">
          {t('profile.auditTitle', 'Audit log')}
        </h2>
        {audit === null ? (
          <Skeleton width="60%" height={14} />
        ) : audit.length === 0 ? (
          <p className="muted small">{auditUnavailable ? t('profile.auditUnavailable', 'The audit log is not available on this server yet.') : t('profile.auditEmpty', 'Nothing recorded yet.')}</p>
        ) : (
          <div className="table-scroll">
            <table className="table profile-table">
              <caption className="visually-hidden">{t('profile.auditTitle', 'Audit log')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('profile.when', 'When')}</th>
                  <th scope="col">{t('profile.action', 'Action')}</th>
                  <th scope="col">{t('profile.detail', 'Detail')}</th>
                </tr>
              </thead>
              <tbody>
                {audit.slice(0, 50).map((a, i) => (
                  <tr key={`${String(a.at)}-${i}`}>
                    <td className="num">{when(a.at)}</td>
                    <td>{typeof a.action === 'string' ? a.action.replace(/_/g, ' ') : '—'}</td>
                    <td className="cell-wrap small">{typeof a.detail === 'string' ? a.detail : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="profile-grid">
        <section className="card" aria-labelledby="profile-export">
          <h2 id="profile-export" className="card-title">
            {t('profile.exportTitle', 'Export my data')}
          </h2>
          <p className="card-sub">{t('profile.exportSub', 'Your account, uploads, analyses, decisions and audit log in one JSON file.')}</p>
          <Button variant="secondary" icon="download" onClick={() => void exportData()} disabled={exporting}>
            {exporting ? t('actions.loading') : t('profile.export', 'Export my data')}
          </Button>
          <ErrorCallout error={exportError} />
        </section>

        <section className="card profile-danger" aria-labelledby="profile-delete">
          <h2 id="profile-delete" className="card-title">
            {t('profile.deleteTitle', 'Delete my account')}
          </h2>
          <p className="card-sub">{t('profile.deleteSub', 'Deletes your account and every upload, analysis and decision in it. This cannot be undone.')}</p>
          <form onSubmit={deleteAccount} className="profile-delete-form">
            <label className="field-label" htmlFor={deleteId}>
              {t('profile.deleteType', 'Type DELETE to confirm')}
            </label>
            <div className="fix-save-row">
              <input id={deleteId} className="input" type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} />
              <Button type="submit" variant="secondary" className="btn-danger" disabled={confirm !== 'DELETE' || deleting}>
                {deleting ? t('profile.deleting', 'Deleting…') : t('profile.delete', 'Delete my account')}
              </Button>
            </div>
          </form>
          <ErrorCallout error={deleteError} />
        </section>
      </div>
    </div>
  );
}
