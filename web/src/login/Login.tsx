import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthConfig } from '../api/types';
import {
  AuthError,
  LOGIN_PATH,
  SIGN_IN_NOT_READY,
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
  signOut,
  signUp,
} from '../auth/auth';
import { APP_PATH, BRAND, DEMO_URL } from '../brand';
import { Icon } from '../landing/icons';
import { Spinner, Wordmark } from '../landing/shared';
import { ProviderButtons } from '../auth/ProviderButtons';


type View = 'loading' | 'signedIn' | 'notReady' | 'signin' | 'signup' | 'confirm' | 'forgot' | 'reset' | 'newPassword';

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

const POLICY: Array<{ label: string; test: (p: string) => boolean }> = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'An upper-case letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'A lower-case letter', test: (p) => /[a-z]/.test(p) },
  { label: 'A number', test: (p) => /\d/.test(p) },
];

const meetsPolicy = (p: string) => POLICY.every((r) => r.test(p));
const looksLikeEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

function messageOf(err: unknown): string {
  if (err instanceof AuthError) return err.message;
  return 'Something went wrong. Try again.';
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
        <button type="button" className="lg-eye" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} aria-controls={id} onClick={() => setShow((s) => !s)}>
          <Icon name={show ? 'eye-off' : 'eye'} size={20} />
        </button>
      </div>
    </div>
  );
}

function EmailField({ id, value, onChange, autoFocus, invalid }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; invalid?: boolean }) {
  return (
    <div className="l-field">
      <label htmlFor={id} className="l-label">
        Email
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
  return (
    <ul id={id} className="lg-policy" aria-label="Password must have">
      {POLICY.map((r) => {
        const ok = r.test(password);
        return (
          <li key={r.label} className={ok ? 'is-ok' : undefined}>
            <Icon name={ok ? 'check-circle' : 'info'} size={15} />
            {r.label}
            <span className="l-sr">{ok ? ' (done)' : ' (not yet)'}</span>
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
  const { t } = useTranslation();
  const [providers, setProviders] = useState<{ google: boolean; github: boolean; email: boolean }>({ google: false, github: false, email: false });
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [view, setView] = useState<View>('loading');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [code, setCode] = useState('');
  const [session, setSession] = useState<string | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorAction, setErrorAction] = useState<'signin' | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'info' } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [touched, setTouched] = useState(false);
  /** The password typed at sign-up or sign-in, so a confirmed account can sign in without retyping. */
  const remembered = useRef<string | null>(null);
  /** Set once a redirect has started, so the button stays busy until the next page loads. */
  const leaving = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const next = safeNext();
  const tagline = BRAND.tagline.split(/(?<=\.)\s+/);

  // Start: an unexpired session first, then the sign-in configuration. No calls before the page renders.
  useEffect(() => {
    let alive = true;
    const user = currentUser();
    if (user && (user.exp === null || user.exp * 1000 > Date.now())) {
      setSignedInAs(user.email ?? 'your account');
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
        setSignedInAs(cookieUser.name ?? cookieUser.email ?? 'your account');
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
          setSignedInAs(currentUser()?.email ?? user.email ?? 'your account');
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
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  // Each new step puts focus on its first field (or its heading), so keyboard and screen-reader users land in the right place.
  useEffect(() => {
    if (view === 'loading') return;
    const card = cardRef.current;
    const target = card?.querySelector<HTMLElement>('[data-autofocus]') ?? card?.querySelector<HTMLElement>('h1');
    target?.focus({ preventScroll: true });
  }, [view]);

  const go = (v: View, opts: { notice?: { text: string; tone: 'success' | 'info' } | null; keepError?: boolean } = {}) => {
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

  const fail = (message: string, action: 'signin' | null = null) => {
    setError(message);
    setErrorAction(action);
  };

  const finish = () => {
    leaving.current = true;
    setNotice({ text: 'Signed in. Opening your workspace…', tone: 'success' });
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

  const onSignIn = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!looksLikeEmail(email) || !password) {
      fail(!looksLikeEmail(email) ? 'Enter the email address you signed up with.' : 'Enter your password.');
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
          go('confirm', { notice: { text: 'This email is not confirmed yet. If the code has expired, ask for a new one below.', tone: 'info' } });
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
    if (!looksLikeEmail(email)) return fail('Enter a valid email address.');
    if (!meetsPolicy(password)) return fail('Use at least 8 characters with an upper-case letter, a lower-case letter and a number.');
    if (password !== password2) return fail('The two passwords do not match.');
    void run(async () => {
      try {
        await signUp(cfg as AuthConfig, email, password);
      } catch (err) {
        if (err instanceof AuthError && err.code === 'exists') {
          fail(err.message, 'signin');
          return;
        }
        throw err;
      }
      remembered.current = password;
      setCode('');
      setCooldown(RESEND_COOLDOWN_S);
      go('confirm', { notice: { text: 'Account created. The code can take a minute to arrive.', tone: 'success' } });
    });
  };

  const onConfirm = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!/^\d{6}$/.test(code)) return fail('Enter the 6-digit code from the email.');
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
      go('signin', { notice: { text: 'Email confirmed. Sign in to continue.', tone: 'success' } });
    });
  };

  const onResend = () => {
    if (cooldown > 0) return;
    void run(async () => {
      await resendCode(cfg as AuthConfig, email);
      setCooldown(RESEND_COOLDOWN_S);
      setNotice({ text: `A new code is on its way to ${email.trim()}.`, tone: 'success' });
    });
  };

  const onForgot = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!looksLikeEmail(email)) return fail('Enter the email address you signed up with.');
    void run(async () => {
      try {
        await forgotPassword(cfg as AuthConfig, email);
      } catch (err) {
        // "Email or password is not right" reads oddly here; keep the message neutral.
        if (err instanceof AuthError && err.code === 'bad_credentials') throw new AuthError('other', 'We could not send a code to that address. Check the email and try again.');
        throw err;
      }
      setCode('');
      setPassword('');
      setPassword2('');
      setCooldown(RESEND_COOLDOWN_S);
      go('reset', { notice: { text: 'Code sent. It can take a minute to arrive.', tone: 'success' } });
    });
  };

  const onResendReset = () => {
    if (cooldown > 0) return;
    void run(async () => {
      await forgotPassword(cfg as AuthConfig, email);
      setCooldown(RESEND_COOLDOWN_S);
      setNotice({ text: `A new code is on its way to ${email.trim()}.`, tone: 'success' });
    });
  };

  const onReset = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!/^\d{6}$/.test(code)) return fail('Enter the 6-digit code from the email.');
    if (!meetsPolicy(password)) return fail('Use at least 8 characters with an upper-case letter, a lower-case letter and a number.');
    if (password !== password2) return fail('The two passwords do not match.');
    void run(async () => {
      await confirmForgotPassword(cfg as AuthConfig, email, code, password);
      setPassword('');
      setPassword2('');
      setCode('');
      go('signin', { notice: { text: 'Password changed. Sign in with your new password.', tone: 'success' } });
    });
  };

  const onNewPassword = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!meetsPolicy(password)) return fail('Use at least 8 characters with an upper-case letter, a lower-case letter and a number.');
    if (password !== password2) return fail('The two passwords do not match.');
    if (!session) return fail('That sign-in has expired. Sign in again.');
    void run(async () => {
      await completeNewPassword(cfg as AuthConfig, email, session, password);
      finish();
    });
  };

  // ---- Pieces ----------------------------------------------------------------------------------------

  const tabs: Array<{ id: 'signin' | 'signup'; label: string }> = [
    { id: 'signin', label: 'Sign in' },
    { id: 'signup', label: 'Create account' },
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
      <div className="lg-tabs" role="tablist" aria-label="Sign in or create an account" onKeyDown={onTabKey}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            id={`${uid}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={view === t.id}
            aria-controls={`${uid}-panel`}
            tabIndex={view === t.id ? 0 : -1}
            className="lg-tab"
            onClick={() => view !== t.id && go(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
    ) : null;

  const noticeLine = notice ? (
    <p className={notice.tone === 'info' ? 'lg-info' : 'lg-notice'} role="status">
      <Icon name={notice.tone === 'info' ? 'info' : 'check-circle'} size={16} />
      <span>{notice.text}</span>
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
        Sign in instead
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
        6-digit code
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

  let body: ReactNode;
  let title = '';
  let sub: ReactNode = null;

  switch (view) {
    case 'loading':
      title = 'Getting things ready';
      body = (
        <div className="lg-loading" role="status">
          <Spinner /> Checking sign-in…
        </div>
      );
      break;

    case 'signedIn':
      title = 'You’re signed in';
      sub = (
        <>
          You’re signed in as <strong>{signedInAs}</strong>.
        </>
      );
      body = (
        <div className="lg-stack">
          <a className="l-btn l-btn-primary l-btn-lg l-btn-block" href={next}>
            Continue to your workspace
            <Icon name="arrow-right" size={18} />
          </a>
          <button type="button" className="l-btn l-btn-secondary l-btn-lg l-btn-block" onClick={() => signOut()}>
            <Icon name="log-out" size={18} />
            Sign out
          </button>
        </div>
      );
      break;

    case 'notReady':
      title = 'Sign in';
      body = (
        <div className="lg-stack">
          <p className="lg-info" role="status">
            <Icon name="info" size={16} />
            <span>{SIGN_IN_NOT_READY}</span>
          </p>
          <p className="lg-sub">The demo has every feature, on a labelled synthetic brand. Nothing is tied to an account.</p>
          <a className="l-btn l-btn-primary l-btn-lg l-btn-block" href={DEMO_URL}>
            Try the demo
            <Icon name="arrow-right" size={18} />
          </a>
        </div>
      );
      break;

    case 'signin':
      title = 'Welcome back';
      sub = 'Sign in to your workspace.';
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
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            invalid={touched && !password}
            extra={
              <button type="button" className="lg-inline" onClick={() => go('forgot')}>
                Forgot password?
              </button>
            }
          />
          <Submit busy={busy} label="Sign in" busyLabel="Signing in…" />
          <ErrorLine error={error} />
        </form>
      );
      break;

    case 'signup':
      title = 'Create your account';
      sub = 'Start your 14-day free trial on your own CSV.';
      body = (
        <form className="lg-form" onSubmit={onSignUp} noValidate>
          {providerBlock}
          {noticeLine}
          <EmailField id={ids.email} value={email} onChange={setEmail} autoFocus invalid={touched && !looksLikeEmail(email)} />
          <PasswordField
            id={ids.password}
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            invalid={touched && !meetsPolicy(password)}
            describedBy={ids.policy}
          />
          <PolicyList id={ids.policy} password={password} />
          <PasswordField
            id={ids.password2}
            label="Confirm password"
            value={password2}
            onChange={setPassword2}
            autoComplete="new-password"
            invalid={touched && password2 !== password}
          />
          <Submit busy={busy} label="Create account" busyLabel="Creating your account…" />
          <ErrorLine error={error} action={signInAction} />
        </form>
      );
      break;

    case 'confirm':
      title = 'Check your email';
      sub = (
        <>
          Enter the code we sent to <strong>{email.trim()}</strong> to confirm your account.
        </>
      );
      body = (
        <form className="lg-form" onSubmit={onConfirm} noValidate>
          {noticeLine}
          {codeField}
          <Submit busy={busy} label="Confirm" busyLabel="Confirming…" />
          <ErrorLine error={error} />
          <div className="lg-row">
            <button type="button" className="lg-inline" onClick={onResend} disabled={cooldown > 0 || busy}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
            <button type="button" className="lg-inline is-quiet" onClick={() => go('signup')}>
              Use a different email
            </button>
          </div>
        </form>
      );
      break;

    case 'forgot':
      title = 'Reset your password';
      sub = 'Enter your email and we will send you a code to choose a new password.';
      body = (
        <form className="lg-form" onSubmit={onForgot} noValidate>
          {back('Back to sign in', 'signin')}
          <EmailField id={ids.email} value={email} onChange={setEmail} autoFocus invalid={touched && !looksLikeEmail(email)} />
          <Submit busy={busy} label="Send code" busyLabel="Sending…" />
          <ErrorLine error={error} />
        </form>
      );
      break;

    case 'reset':
      title = 'Choose a new password';
      sub = (
        <>
          Enter the code sent to <strong>{email.trim()}</strong> and your new password.
        </>
      );
      body = (
        <form className="lg-form" onSubmit={onReset} noValidate>
          {noticeLine}
          {codeField}
          <PasswordField
            id={ids.password}
            label="New password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            invalid={touched && !meetsPolicy(password)}
            describedBy={ids.policy}
          />
          <PolicyList id={ids.policy} password={password} />
          <PasswordField
            id={ids.password2}
            label="Confirm new password"
            value={password2}
            onChange={setPassword2}
            autoComplete="new-password"
            invalid={touched && password2 !== password}
          />
          <Submit busy={busy} label="Change password" busyLabel="Changing…" />
          <ErrorLine error={error} />
          <div className="lg-row">
            <button type="button" className="lg-inline" onClick={onResendReset} disabled={cooldown > 0 || busy}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
            <button type="button" className="lg-inline is-quiet" onClick={() => go('signin')}>
              Back to sign in
            </button>
          </div>
        </form>
      );
      break;

    case 'newPassword':
      title = 'Choose a new password';
      sub = 'Your account was set up with a temporary password. Choose your own to finish signing in.';
      body = (
        <form className="lg-form" onSubmit={onNewPassword} noValidate>
          <PasswordField
            id={ids.password}
            label="New password"
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
            label="Confirm new password"
            value={password2}
            onChange={setPassword2}
            autoComplete="new-password"
            invalid={touched && password2 !== password}
          />
          <Submit busy={busy} label="Save and sign in" busyLabel="Saving…" />
          <ErrorLine error={error} />
          {back('Back to sign in', 'signin')}
        </form>
      );
      break;
  }

  return (
    <div className="lg-shell">
      <aside className="lg-aside" aria-label={`About ${BRAND.name}`}>
        <Wordmark onDark />
        <div className="lg-aside-body">
          <p className="lg-aside-kicker">Profitability intelligence</p>
          <p className="lg-aside-title">
            {tagline[0]} <span>{tagline.slice(1).join(' ')}</span>
          </p>
          <ul className="lg-points">
            <li>
              <Icon name="check" size={18} strokeWidth={2.25} />
              See what every order kept after refunds, shipping, fees and ads.
            </li>
            <li>
              <Icon name="check" size={18} strokeWidth={2.25} />
              Find where profit leaks, grouped by cause and ranked in rupees.
            </li>
            <li>
              <Icon name="check" size={18} strokeWidth={2.25} />
              Test one change and keep the decision, with a 30-day test and a stop rule.
            </li>
          </ul>
        </div>
        <p className="lg-aside-foot">Your uploads and decisions are saved to your account, and other accounts cannot read them.</p>
      </aside>

      <div className="lg-main">
        <header className="lg-top">
          <span className="lg-top-brand">
            <Wordmark />
          </span>
          <a className="lg-home" href="/">
            <Icon name="arrow-left" size={16} />
            Back to home
          </a>
        </header>

        <main className="lg-center">
          <p className="lg-tagline">{BRAND.tagline}</p>
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
            Just looking?{' '}
            <a href={DEMO_URL}>
              Try the demo <Icon name="arrow-right" size={15} />
            </a>
          </p>
        </main>

        <footer className="lg-foot">
          © 2026 {BRAND.name} · {BRAND.tagline}
        </footer>
      </div>
    </div>
  );
}
