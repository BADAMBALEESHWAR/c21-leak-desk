import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { AuthConfig } from '../api/types';
import {
  AuthError,
  LOGIN_PATH,
  completeNewPassword,
  confirmForgotPassword,
  confirmSignUp,
  currentUser,
  ensureIdToken,
  fetchAuthConfig,
  fetchCookieUser,
  fetchProviders,
  forgotPassword,
  resendCode,
  signIn,
  signInNotReady,
  signOut,
  signUp,
} from '../auth/auth';
import { APP_PATH, BRAND, DEMO_URL } from '../brand';
import { LANGS, setLanguage } from '../i18n';
import { Icon } from '../landing/icons';
import { Spinner, Wordmark } from '../landing/shared';
import { ProviderButtons } from '../auth/ProviderButtons';


type View = 'loading' | 'signedIn' | 'notReady' | 'signin' | 'signup' | 'confirm' | 'forgot' | 'reset' | 'newPassword';

/** A message on the card, read again in the current language on every render (so a language switch updates it). */
type Say = (t: TFunction) => string;

const RESEND_COOLDOWN_S = 30;

/** `next` must be a same-origin path; anything else (or the login page itself) falls back to the workspace. */
export function safeNext(search: string = window.location.search): string {
  const raw = new URLSearchParams(search).get('next');
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return APP_PATH;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return APP_PATH;
    if (url.pathname === '/login' || url.pathname.startsWith(LOGIN_PATH)) return APP_PATH;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return APP_PATH;
  }
}

/** Password rules; `label` is the English default of the translation key. */
const POLICY: Array<{ key: string; label: string; test: (p: string) => boolean }> = [
  { key: 'login.policyLength', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { key: 'login.policyUpper', label: 'An upper-case letter', test: (p) => /[A-Z]/.test(p) },
  { key: 'login.policyLower', label: 'A lower-case letter', test: (p) => /[a-z]/.test(p) },
  { key: 'login.policyNumber', label: 'A number', test: (p) => /\d/.test(p) },
];

const meetsPolicy = (p: string) => POLICY.every((r) => r.test(p));
const looksLikeEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

function messageOf(err: unknown): Say {
  if (err instanceof AuthError) {
    const { i18nKey, message } = err;
    return (t) => (i18nKey ? t(i18nKey, message) : message);
  }
  return (t) => t('login.somethingWrong', 'Something went wrong. Try again.');
}

/** English · हिन्दी · తెలుగు, each in its own script; the current one is pressed. Kept in localStorage like the landing page. */
function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? i18n.language;
  return (
    <div className="lg-lang" role="group" aria-label={t('lang.label')}>
      {LANGS.map((l) => (
        <button key={l} type="button" lang={l} aria-pressed={current === l} onClick={() => setLanguage(l)}>
          {t(`lang.${l}`)}
        </button>
      ))}
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  invalid,
  describedBy,
  extra,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  invalid?: boolean;
  describedBy?: string;
  extra?: ReactNode;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  return (
    <div className="l-field">
      <div className="lg-label-row">
        <label htmlFor={id} className="l-label">
          {label}
        </label>
        {extra}
      </div>
      <div className="lg-pw">
        <input
          id={id}
          className="l-input"
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          data-autofocus={autoFocus ? '' : undefined}
          spellCheck={false}
          autoCapitalize="none"
          required
        />
        <button
          type="button"
          className="lg-eye"
          aria-label={show ? t('login.hidePassword', 'Hide password') : t('login.showPassword', 'Show password')}
          aria-pressed={show}
          aria-controls={id}
          onClick={() => setShow((s) => !s)}
        >
          <Icon name={show ? 'eye-off' : 'eye'} size={20} />
        </button>
      </div>
    </div>
  );
}

function EmailField({ id, value, onChange, autoFocus, invalid }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; invalid?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="l-field">
      <label htmlFor={id} className="l-label">
        {t('login.email', 'Email')}
      </label>
      <input
        id={id}
        className="l-input"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="you@yourbrand.in"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        data-autofocus={autoFocus ? '' : undefined}
        required
      />
    </div>
  );
}

function PolicyList({ id, password }: { id: string; password: string }) {
  const { t } = useTranslation();
  return (
    <ul id={id} className="lg-policy" aria-label={t('login.policyLabel', 'Password must have')}>
      {POLICY.map((r) => {
        const ok = r.test(password);
        return (
          <li key={r.key} className={ok ? 'is-ok' : undefined}>
            <Icon name={ok ? 'check-circle' : 'info'} size={15} />
            {t(r.key, r.label)}
            <span className="l-sr">
              {' '}
              {ok ? t('login.policyDone', '(done)') : t('login.policyNotYet', '(not yet)')}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Submit({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  return (
    <button type="submit" className="l-btn l-btn-primary l-btn-lg l-btn-block" disabled={busy} aria-busy={busy}>
      {busy ? <Spinner /> : null}
      {busy ? busyLabel : label}
    </button>
  );
}

function ErrorLine({ error, action }: { error: string | null; action?: ReactNode }) {
  return (
    <div className="lg-error" role="alert" aria-live="assertive">
      {error ? (
        <p>
          <Icon name="alert" size={16} />
          <span>
            {error} {action}
          </span>
        </p>
      ) : null}
    </div>
  );
}

export function Login() {
  const uid = useId();
  const { t, i18n } = useTranslation();
  const [providers, setProviders] = useState<{ google: boolean; github: boolean; email: boolean }>({ google: false, github: false, email: false });
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [view, setView] = useState<View>('loading');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [code, setCode] = useState('');
  const [session, setSession] = useState<string | null>(null);
  /** Who is signed in (name or email); null shows "your account". */
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Say | null>(null);
  const [errorAction, setErrorAction] = useState<'signin' | null>(null);
  const [notice, setNotice] = useState<{ text: Say; tone: 'success' | 'info' } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [touched, setTouched] = useState(false);
  /** The password typed at sign-up or sign-in, so a confirmed account can sign in without retyping. */
  const remembered = useRef<string | null>(null);
  /** Set once a redirect has started, so the button stays busy until the next page loads. */
  const leaving = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const next = safeNext();
  const tagline = t('tagline').split(/(?<=[.।])\s+/);

  // The tab title follows the language too (login/index.html holds the English one for the first paint).
  useEffect(() => {
    document.title = t('login.docTitle', 'Sign in · {{brand}} — {{tagline}}', { brand: BRAND.name, tagline: t('tagline') });
  }, [t, i18n.language]);

  // Start: an unexpired session first, then the sign-in configuration. No calls before the page renders.
  useEffect(() => {
    let alive = true;
    const user = currentUser();
    if (user && (user.exp === null || user.exp * 1000 > Date.now())) {
      setSignedInAs(user.email ?? null);
      setView('signedIn');
      return () => {
        alive = false;
      };
    }
    void (async () => {
      // A Google / GitHub session is an httpOnly cookie: only GET /me can tell.
      const [c, p] = await Promise.all([fetchAuthConfig(), fetchProviders()]);
      const cookieUser = p.google || p.github ? await fetchCookieUser() : null;
      if (!alive) return;
      setCfg(c);
      setProviders(p);
      if (cookieUser) {
        setSignedInAs(cookieUser.name ?? cookieUser.email ?? null);
        setView('signedIn');
        return;
      }
      if (!c.enabled) {
        // Email sign-in is not set up; Google or GitHub may still be.
        setView(p.google || p.github ? 'signin' : 'notReady');
        return;
      }
      if (user) {
        const token = await ensureIdToken(c);
        if (!alive) return;
        if (token) {
          setSignedInAs(currentUser()?.email ?? user.email ?? null);
          setView('signedIn');
          return;
        }
      }
      setView(new URLSearchParams(window.location.search).get('mode') === 'signup' ? 'signup' : 'signin');
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Resend cooldown.
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  // Each new step puts focus on its first field (or its heading), so keyboard and screen-reader users land in the right place.
  useEffect(() => {
    if (view === 'loading') return;
    const card = cardRef.current;
    const target = card?.querySelector<HTMLElement>('[data-autofocus]') ?? card?.querySelector<HTMLElement>('h1');
    target?.focus({ preventScroll: true });
  }, [view]);

  const go = (v: View, opts: { notice?: { text: Say; tone: 'success' | 'info' } | null; keepError?: boolean } = {}) => {
    if (!opts.keepError) {
      setError(null);
      setErrorAction(null);
    }
    setNotice(opts.notice ?? null);
    setTouched(false);
    setView(v);
    if (v === 'signin' || v === 'signup') {
      const params = new URLSearchParams(window.location.search);
      if (v === 'signup') params.set('mode', 'signup');
      else params.delete('mode');
      const q = params.toString();
      window.history.replaceState(null, '', `${LOGIN_PATH}${q ? `?${q}` : ''}`);
    }
  };

  const fail = (say: Say, action: 'signin' | null = null) => {
    // A function value must be wrapped, or React would call it as a state updater.
    setError(() => say);
    setErrorAction(action);
  };

  const finish = () => {
    leaving.current = true;
    setNotice({ text: (t) => t('login.signedInNotice', 'Signed in. Opening your workspace…'), tone: 'success' });
    window.location.assign(next);
  };

  const run = async (task: () => Promise<void>) => {
    if (busy || !cfg) return;
    setError(null);
    setErrorAction(null);
    setBusy(true);
    try {
      await task();
    } catch (err) {
      fail(messageOf(err));
    } finally {
      if (!leaving.current) setBusy(false);
    }
  };

  // ---- Handlers ------------------------------------------------------------------------------------

  const enterSignupEmail: Say = (t) => t('login.enterSignupEmail', 'Enter the email address you signed up with.');
  const passwordRule: Say = (t) => t('auth.passwordRule', 'Use at least 8 characters with an upper-case letter, a lower-case letter and a number.');
  const mismatch: Say = (t) => t('login.mismatch', 'The two passwords do not match.');
  const enterCode: Say = (t) => t('login.enterCode', 'Enter the 6-digit code from the email.');
  const newCodeSent = (to: string): Say => (t) => t('login.newCodeSent', 'A new code is on its way to {{email}}.', { email: to });

  const onSignIn = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!looksLikeEmail(email) || !password) {
      fail(!looksLikeEmail(email) ? enterSignupEmail : (t) => t('login.enterPassword', 'Enter your password.'));
      return;
    }
    void run(async () => {
      try {
        await signIn(cfg as AuthConfig, email, password);
        finish();
      } catch (err) {
        if (err instanceof AuthError && err.code === 'confirm') {
          remembered.current = password;
          setCode('');
          go('confirm', {
            notice: { text: (t) => t('login.notConfirmed', 'This email is not confirmed yet. If the code has expired, ask for a new one below.'), tone: 'info' },
          });
          return;
        }
        if (err instanceof AuthError && err.code === 'new_password' && err.session) {
          setSession(err.session);
          setPassword('');
          setPassword2('');
          go('newPassword');
          return;
        }
        throw err;
      }
    });
  };

  const onSignUp = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!looksLikeEmail(email)) return fail((t) => t('login.validEmail', 'Enter a valid email address.'));
    if (!meetsPolicy(password)) return fail(passwordRule);
    if (password !== password2) return fail(mismatch);
    void run(async () => {
      try {
        await signUp(cfg as AuthConfig, email, password);
      } catch (err) {
        if (err instanceof AuthError && err.code === 'exists') {
          fail(messageOf(err), 'signin');
          return;
        }
        throw err;
      }
      remembered.current = password;
      setCode('');
      setCooldown(RESEND_COOLDOWN_S);
      go('confirm', { notice: { text: (t) => t('login.accountCreated', 'Account created. The code can take a minute to arrive.'), tone: 'success' } });
    });
  };

  const onConfirm = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!/^\d{6}$/.test(code)) return fail(enterCode);
    void run(async () => {
      await confirmSignUp(cfg as AuthConfig, email, code);
      const pw = remembered.current;
      if (pw) {
        try {
          await signIn(cfg as AuthConfig, email, pw);
          remembered.current = null;
          finish();
          return;
        } catch {
          // Fall through to the sign-in form with the confirmation done.
        }
      }
      setPassword('');
      go('signin', { notice: { text: (t) => t('login.emailConfirmed', 'Email confirmed. Sign in to continue.'), tone: 'success' } });
    });
  };

  const onResend = () => {
    if (cooldown > 0) return;
    void run(async () => {
      await resendCode(cfg as AuthConfig, email);
      setCooldown(RESEND_COOLDOWN_S);
      setNotice({ text: newCodeSent(email.trim()), tone: 'success' });
    });
  };

  const onForgot = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!looksLikeEmail(email)) return fail(enterSignupEmail);
    void run(async () => {
      try {
        await forgotPassword(cfg as AuthConfig, email);
      } catch (err) {
        // "Email or password is not right" reads oddly here; keep the message neutral.
        if (err instanceof AuthError && err.code === 'bad_credentials') {
          fail((t) => t('login.noCodeSent', 'We could not send a code to that address. Check the email and try again.'));
          return;
        }
        throw err;
      }
      setCode('');
      setPassword('');
      setPassword2('');
      setCooldown(RESEND_COOLDOWN_S);
      go('reset', { notice: { text: (t) => t('login.codeSent', 'Code sent. It can take a minute to arrive.'), tone: 'success' } });
    });
  };

  const onResendReset = () => {
    if (cooldown > 0) return;
    void run(async () => {
      await forgotPassword(cfg as AuthConfig, email);
      setCooldown(RESEND_COOLDOWN_S);
      setNotice({ text: newCodeSent(email.trim()), tone: 'success' });
    });
  };

  const onReset = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!/^\d{6}$/.test(code)) return fail(enterCode);
    if (!meetsPolicy(password)) return fail(passwordRule);
    if (password !== password2) return fail(mismatch);
    void run(async () => {
      await confirmForgotPassword(cfg as AuthConfig, email, code, password);
      setPassword('');
      setPassword2('');
      setCode('');
      go('signin', { notice: { text: (t) => t('login.passwordChanged', 'Password changed. Sign in with your new password.'), tone: 'success' } });
    });
  };

  const onNewPassword = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!meetsPolicy(password)) return fail(passwordRule);
    if (password !== password2) return fail(mismatch);
    if (!session) return fail((t) => t('login.sessionExpired', 'That sign-in has expired. Sign in again.'));
    void run(async () => {
      await completeNewPassword(cfg as AuthConfig, email, session, password);
      finish();
    });
  };

  // ---- Pieces ----------------------------------------------------------------------------------------

  const errorText = error ? error(t) : null;

  const tabs: Array<{ id: 'signin' | 'signup'; label: string }> = [
    { id: 'signin', label: t('actions.signIn', 'Sign in') },
    { id: 'signup', label: t('login.createAccount', 'Create account') },
  ];

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const nextTab = view === 'signin' ? 'signup' : 'signin';
    go(nextTab);
    tabRefs.current[nextTab === 'signin' ? 0 : 1]?.focus();
  };

  const emailReady = cfg?.enabled === true;
  const anyProvider = providers.google || providers.github;
  const providerBlock = anyProvider ? (
    <>
      <ProviderButtons providers={providers} next={next} />
      {emailReady ? (
        <p className="lg-divider">
          <span>{t('auth.orEmail', 'or with email')}</span>
        </p>
      ) : null}
    </>
  ) : null;

  const tabBar =
    emailReady && (view === 'signin' || view === 'signup') ? (
      <div className="lg-tabs" role="tablist" aria-label={t('login.tabsLabel', 'Sign in or create an account')} onKeyDown={onTabKey}>
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            id={`${uid}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={view === tab.id}
            aria-controls={`${uid}-panel`}
            tabIndex={view === tab.id ? 0 : -1}
            className="lg-tab"
            onClick={() => view !== tab.id && go(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    ) : null;

  const noticeLine = notice ? (
    <p className={notice.tone === 'info' ? 'lg-info' : 'lg-notice'} role="status">
      <Icon name={notice.tone === 'info' ? 'info' : 'check-circle'} size={16} />
      <span>{notice.text(t)}</span>
    </p>
  ) : null;

  const back = (label: string, to: View) => (
    <button type="button" className="lg-back" onClick={() => go(to)}>
      <Icon name="arrow-left" size={16} />
      {label}
    </button>
  );

  const signInAction =
    errorAction === 'signin' ? (
      <button type="button" className="lg-inline" onClick={() => go('signin')}>
        {t('login.signInInstead', 'Sign in instead')}
      </button>
    ) : null;

  const ids = {
    email: `${uid}-email`,
    password: `${uid}-password`,
    password2: `${uid}-password2`,
    code: `${uid}-code`,
    policy: `${uid}-policy`,
  };

  const codeField = (
    <div className="l-field">
      <label htmlFor={ids.code} className="l-label">
        {t('login.codeLabel', '6-digit code')}
      </label>
      <input
        id={ids.code}
        className="l-input lg-code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        aria-invalid={(touched && !/^\d{6}$/.test(code)) || undefined}
        data-autofocus=""
        required
      />
    </div>
  );

  const resendLabel = cooldown > 0 ? t('login.resendIn', 'Resend code in {{count}}s', { count: cooldown }) : t('login.resend', 'Resend code');
  const backToSignIn = t('login.backToSignIn', 'Back to sign in');

  let body: ReactNode;
  let title = '';
  let sub: ReactNode = null;

  switch (view) {
    case 'loading':
      title = t('login.loadingTitle', 'Getting things ready');
      body = (
        <div className="lg-loading" role="status">
          <Spinner /> {t('login.checking', 'Checking sign-in…')}
        </div>
      );
      break;

    case 'signedIn':
      title = t('login.signedInTitle', 'You’re signed in');
      sub = (
        <>
          {t('login.signedInAsBefore', 'You’re signed in as ')}
          <strong>{signedInAs ?? t('login.yourAccount', 'your account')}</strong>
          {t('login.signedInAsAfter', '.')}
        </>
      );
      body = (
        <div className="lg-stack">
          <a className="l-btn l-btn-primary l-btn-lg l-btn-block" href={next}>
            {t('login.continueWorkspace', 'Continue to your workspace')}
            <Icon name="arrow-right" size={18} />
          </a>
          <button type="button" className="l-btn l-btn-secondary l-btn-lg l-btn-block" onClick={() => signOut()}>
            <Icon name="log-out" size={18} />
            {t('actions.signOut', 'Sign out')}
          </button>
        </div>
      );
      break;

    case 'notReady':
      title = t('actions.signIn', 'Sign in');
      body = (
        <div className="lg-stack">
          <p className="lg-info" role="status">
            <Icon name="info" size={16} />
            <span>{signInNotReady()}</span>
          </p>
          <p className="lg-sub">{t('login.demoNote', 'The demo has every feature, on a labelled synthetic brand. Nothing is tied to an account.')}</p>
          <a className="l-btn l-btn-primary l-btn-lg l-btn-block" href={DEMO_URL}>
            {t('actions.tryDemo', 'Try the demo')}
            <Icon name="arrow-right" size={18} />
          </a>
        </div>
      );
      break;

    case 'signin':
      title = t('login.welcomeBack', 'Welcome back');
      sub = t('login.signInSub', 'Sign in to your workspace.');
      body = !emailReady ? (
        <div className="lg-stack">
          {providerBlock}
          <p className="lg-sub">{t('auth.emailSoon', 'Email sign-in is being set up.')}</p>
        </div>
      ) : (
        <form className="lg-form" onSubmit={onSignIn} noValidate>
          {providerBlock}
          {noticeLine}
          <EmailField id={ids.email} value={email} onChange={setEmail} autoFocus invalid={touched && !looksLikeEmail(email)} />
          <PasswordField
            id={ids.password}
            label={t('login.password', 'Password')}
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            invalid={touched && !password}
            extra={
              <button type="button" className="lg-inline" onClick={() => go('forgot')}>
                {t('login.forgot', 'Forgot password?')}
              </button>
            }
          />
          <Submit busy={busy} label={t('actions.signIn', 'Sign in')} busyLabel={t('login.signingIn', 'Signing in…')} />
          <ErrorLine error={errorText} />
        </form>
      );
      break;

    case 'signup':
      title = t('login.createTitle', 'Create your account');
      sub = t('login.createSub', 'Start your 14-day free trial on your own CSV.');
      body = (
        <form className="lg-form" onSubmit={onSignUp} noValidate>
          {providerBlock}
          {noticeLine}
          <EmailField id={ids.email} value={email} onChange={setEmail} autoFocus invalid={touched && !looksLikeEmail(email)} />
          <PasswordField
            id={ids.password}
            label={t('login.password', 'Password')}
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            invalid={touched && !meetsPolicy(password)}
            describedBy={ids.policy}
          />
          <PolicyList id={ids.policy} password={password} />
          <PasswordField
            id={ids.password2}
            label={t('login.confirmPassword', 'Confirm password')}
            value={password2}
            onChange={setPassword2}
            autoComplete="new-password"
            invalid={touched && password2 !== password}
          />
          <Submit busy={busy} label={t('login.createAccount', 'Create account')} busyLabel={t('login.creating', 'Creating your account…')} />
          <ErrorLine error={errorText} action={signInAction} />
        </form>
      );
      break;

    case 'confirm':
      title = t('login.checkEmail', 'Check your email');
      sub = (
        <>
          {t('login.confirmSubBefore', 'Enter the code we sent to ')}
          <strong>{email.trim()}</strong>
          {t('login.confirmSubAfter', ' to confirm your account.')}
        </>
      );
      body = (
        <form className="lg-form" onSubmit={onConfirm} noValidate>
          {noticeLine}
          {codeField}
          <Submit busy={busy} label={t('login.confirm', 'Confirm')} busyLabel={t('login.confirming', 'Confirming…')} />
          <ErrorLine error={errorText} />
          <div className="lg-row">
            <button type="button" className="lg-inline" onClick={onResend} disabled={cooldown > 0 || busy}>
              {resendLabel}
            </button>
            <button type="button" className="lg-inline is-quiet" onClick={() => go('signup')}>
              {t('login.differentEmail', 'Use a different email')}
            </button>
          </div>
        </form>
      );
      break;

    case 'forgot':
      title = t('login.resetTitle', 'Reset your password');
      sub = t('login.resetSub', 'Enter your email and we will send you a code to choose a new password.');
      body = (
        <form className="lg-form" onSubmit={onForgot} noValidate>
          {back(backToSignIn, 'signin')}
          <EmailField id={ids.email} value={email} onChange={setEmail} autoFocus invalid={touched && !looksLikeEmail(email)} />
          <Submit busy={busy} label={t('login.sendCode', 'Send code')} busyLabel={t('login.sending', 'Sending…')} />
          <ErrorLine error={errorText} />
        </form>
      );
      break;

    case 'reset':
      title = t('login.chooseTitle', 'Choose a new password');
      sub = (
        <>
          {t('login.resetCodeBefore', 'Enter the code sent to ')}
          <strong>{email.trim()}</strong>
          {t('login.resetCodeAfter', ' and your new password.')}
        </>
      );
      body = (
        <form className="lg-form" onSubmit={onReset} noValidate>
          {noticeLine}
          {codeField}
          <PasswordField
            id={ids.password}
            label={t('login.newPassword', 'New password')}
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            invalid={touched && !meetsPolicy(password)}
            describedBy={ids.policy}
          />
          <PolicyList id={ids.policy} password={password} />
          <PasswordField
            id={ids.password2}
            label={t('login.confirmNewPassword', 'Confirm new password')}
            value={password2}
            onChange={setPassword2}
            autoComplete="new-password"
            invalid={touched && password2 !== password}
          />
          <Submit busy={busy} label={t('login.changePassword', 'Change password')} busyLabel={t('login.changing', 'Changing…')} />
          <ErrorLine error={errorText} />
          <div className="lg-row">
            <button type="button" className="lg-inline" onClick={onResendReset} disabled={cooldown > 0 || busy}>
              {resendLabel}
            </button>
            <button type="button" className="lg-inline is-quiet" onClick={() => go('signin')}>
              {backToSignIn}
            </button>
          </div>
        </form>
      );
      break;

    case 'newPassword':
      title = t('login.chooseTitle', 'Choose a new password');
      sub = t('login.tempSub', 'Your account was set up with a temporary password. Choose your own to finish signing in.');
      body = (
        <form className="lg-form" onSubmit={onNewPassword} noValidate>
          <PasswordField
            id={ids.password}
            label={t('login.newPassword', 'New password')}
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            invalid={touched && !meetsPolicy(password)}
            describedBy={ids.policy}
            autoFocus
          />
          <PolicyList id={ids.policy} password={password} />
          <PasswordField
            id={ids.password2}
            label={t('login.confirmNewPassword', 'Confirm new password')}
            value={password2}
            onChange={setPassword2}
            autoComplete="new-password"
            invalid={touched && password2 !== password}
          />
          <Submit busy={busy} label={t('login.saveSignIn', 'Save and sign in')} busyLabel={t('actions.saving', 'Saving…')} />
          <ErrorLine error={errorText} />
          {back(backToSignIn, 'signin')}
        </form>
      );
      break;
  }

  return (
    <div className="lg-shell">
      <aside className="lg-aside" aria-label={t('login.about', 'About {{brand}}', { brand: BRAND.name })}>
        <Wordmark onDark />
        <div className="lg-aside-body">
          <p className="lg-aside-kicker">{t('login.kicker', 'Profitability intelligence')}</p>
          <p className="lg-aside-title">
            {tagline[0]} <span>{tagline.slice(1).join(' ')}</span>
          </p>
          <ul className="lg-points">
            <li>
              <Icon name="check" size={18} strokeWidth={2.25} />
              {t('login.point1', 'See what every order kept after refunds, shipping, fees and ads.')}
            </li>
            <li>
              <Icon name="check" size={18} strokeWidth={2.25} />
              {t('login.point2', 'Find where profit leaks, grouped by cause and ranked in rupees.')}
            </li>
            <li>
              <Icon name="check" size={18} strokeWidth={2.25} />
              {t('login.point3', 'Test one change and keep the decision, with a 30-day test and a stop rule.')}
            </li>
          </ul>
        </div>
        <p className="lg-aside-foot">{t('login.asideFoot', 'Your uploads and decisions are saved to your account, and other accounts cannot read them.')}</p>
      </aside>

      <div className="lg-main">
        <header className="lg-top">
          <span className="lg-top-brand">
            <Wordmark />
          </span>
          <LanguageSwitch />
          <a className="lg-home" href="/">
            <Icon name="arrow-left" size={16} />
            {t('login.backHome', 'Back to home')}
          </a>
        </header>

        <main className="lg-center">
          <p className="lg-tagline">{t('tagline')}</p>
          <div className="lg-card" ref={cardRef}>
            {tabBar}
            <div id={`${uid}-panel`} role={tabBar ? 'tabpanel' : undefined} aria-labelledby={tabBar ? `${uid}-tab-${view}` : undefined}>
              <h1 className="lg-title" tabIndex={-1}>
                {title}
              </h1>
              {sub ? <p className="lg-sub">{sub}</p> : null}
              {body}
            </div>
          </div>
          <p className="lg-demo">
            {t('login.justLooking', 'Just looking?')}{' '}
            <a href={DEMO_URL}>
              {t('actions.tryDemo', 'Try the demo')} <Icon name="arrow-right" size={15} />
            </a>
          </p>
        </main>

        <footer className="lg-foot">
          © 2026 {BRAND.name} · {t('tagline')}
        </footer>
      </div>
    </div>
  );
}
