import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toErrorInfo, type ErrorInfo } from '../api/client';
import type { Checks } from '../api/types';
import { formatInr, formatPct } from '../lib/format';
import { INTERVENTION_LABELS } from '../lib/labels';
import { navigate, type Route } from '../lib/router';
import { useStore } from '../state/store';
import { Pill } from './Badge';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Callout, ErrorCallout, revealElement, Skeleton } from './ui';

type CheckId = 'check1' | 'check2' | 'check3';

const CHECKS: Array<{ id: CheckId; n: number; points: number; text: string; proof: string }> = [
  {
    id: 'check1',
    n: 1,
    points: 10,
    text: 'Reference order revenue 1,000 less refund 200, net product cost 400, shipping 50, ads 100 and handling 20 equals ₹ 230 contribution.',
    proof: 'Opens the worked order waterfall.',
  },
  {
    id: 'check2',
    n: 2,
    points: 10,
    text: 'Detail and group totals reconcile; ad allocations and channel spend are never both deducted.',
    proof: 'Loads the extended sample in channel-spend mode, on the By channel tab.',
  },
  {
    id: 'check3',
    n: 3,
    points: 5,
    text: 'Missing refund facts yield unknown or labelled scenario, and changing return assumptions updates the recommendation.',
    proof: 'Loads the missing-refund sample and runs recovery at ₹ 200 per return.',
  },
];

const tick = (ok: boolean | undefined) => (ok ? '✓' : '✗');
const label = (k: string | undefined) => (k ? INTERVENTION_LABELS[k] ?? k.replace(/_/g, ' ') : 'unknown');

function Evidence({ id, c }: { id: CheckId; c: Checks }) {
  if (id === 'check1' && c.check1) {
    return (
      <dl className="kv">
        <div>
          <dt>Expected</dt>
          <dd className="num">{formatInr(c.check1.expected)}</dd>
        </div>
        <div>
          <dt>Actual</dt>
          <dd className="num">{formatInr(c.check1.actual)}</dd>
        </div>
        <div>
          <dt>Six waterfall lines</dt>
          <dd className={c.check1.six_lines ? 't-gain' : 't-loss'}>{tick(c.check1.six_lines)}</dd>
        </div>
      </dl>
    );
  }
  if (id === 'check2' && c.check2) {
    const k = c.check2;
    const spend = k.channel_spend ? Object.entries(k.channel_spend) : [];
    return (
      <dl className="kv">
        <div>
          <dt>Totals</dt>
          <dd className="num">
            {formatInr(k.allocate_total)} allocate = {formatInr(k.channel_total)} channel
          </dd>
        </div>
        <div>
          <dt>Fixture</dt>
          <dd className="num">{formatInr(k.fixture_total)}</dd>
        </div>
        <div>
          <dt>Reconciled</dt>
          <dd className={k.reconciled ? 't-gain' : 't-loss'}>{tick(k.reconciled)} orders = channels = products</dd>
        </div>
        <div>
          <dt>Never both</dt>
          <dd className={k.never_both ? 't-gain' : 't-loss'}>{tick(k.never_both)} ads and channel spend not both deducted</dd>
        </div>
        {spend.length > 0 ? (
          <div>
            <dt>Channel spend</dt>
            <dd className="num">{spend.map(([ch, v]) => `${ch} ${formatInr(v)}`).join(' · ')}</dd>
          </div>
        ) : null}
      </dl>
    );
  }
  if (id === 'check3' && c.check3) {
    const k = c.check3;
    return (
      <dl className="kv">
        <div>
          <dt>Before</dt>
          <dd className="num">
            {label(k.before?.intervention)} {k.before ? formatInr(k.before.expected_delta_inr) : ''}
          </dd>
        </div>
        <div>
          <dt>After recovery {formatPct(50)}</dt>
          <dd className="num">
            {label(k.after_recovery_50?.intervention)} {k.after_recovery_50 ? formatInr(k.after_recovery_50.expected_delta_inr) : ''}
          </dd>
        </div>
        <div>
          <dt>Recommendation changed</dt>
          <dd className={k.recommendation_changed ? 't-gain' : 't-loss'}>{tick(k.recommendation_changed)}</dd>
        </div>
        <div>
          <dt>Unknown labelled</dt>
          <dd className={k.unknown_labelled ? 't-gain' : 't-loss'}>
            {tick(k.unknown_labelled)} confidence {k.confidence}
          </dd>
        </div>
      </dl>
    );
  }
  return <p className="muted small">No result for this check.</p>;
}

export function ChecksDetail() {
  const { t } = useTranslation();
  const { checksRaw, checksLoading, refreshChecks, openWorked, closeDrawer, importDataset, runAnalysis, setLedgerTab, setOverrides } = useStore();
  const [busy, setBusy] = useState<CheckId | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);

  const showMe = async (id: CheckId) => {
    setError(null);
    if (id === 'check1') {
      openWorked();
      return;
    }
    setBusy(id);
    try {
      if (id === 'check2') {
        const ds = await importDataset({ source: 'extended' });
        await runAnalysis('channel', undefined, ds.dataset_id);
        setLedgerTab('channel');
        closeDrawer();
        navigate('ledger');
        // The By channel table is the proof: bring it into view once the ledger has rendered.
        window.setTimeout(() => revealElement(document.querySelector<HTMLElement>('.table-target')), 250);
      } else {
        const ds = await importDataset({ source: 'null_refund' });
        const a = await runAnalysis('allocate', undefined, ds.dataset_id);
        const avg = a.observed.avg_product_cost_on_returns_inr;
        // ₹ 200 per return, expressed the way the scenario control does.
        setOverrides({ recovery_pct: avg ? (200 / avg) * 100 : 50 });
        closeDrawer();
        navigate('scenario');
      }
    } catch (err) {
      setError(toErrorInfo(err));
    } finally {
      setBusy(null);
    }
  };

  if (!checksRaw) {
    return checksLoading ? (
      <div className="drawer-stack" role="status" aria-label="Running the checks">
        <Skeleton width="50%" height={28} />
        <Skeleton width="100%" height={140} />
        <Skeleton width="100%" height={140} />
      </div>
    ) : (
      <Callout tone="danger" title="The checks could not be loaded.">
        <Button variant="secondary" size="sm" icon="refresh" onClick={() => void refreshChecks()}>
          Re-run checks
        </Button>
      </Callout>
    );
  }

  const results = CHECKS.map((c) => ({ ...c, pass: (checksRaw[c.id] as { pass?: boolean } | undefined)?.pass === true }));
  const earned = results.reduce((s, r) => s + (r.pass ? r.points : 0), 0);
  const total = results.reduce((s, r) => s + r.points, 0);

  return (
    <div className={`drawer-stack${checksLoading ? ' is-refreshing' : ''}`}>
      <div className="drawer-hero">
        <span className="drawer-hero-label">Public checks</span>
        <span className="drawer-hero-value">
          {earned} of {total} points
        </span>
        <span className="drawer-hero-sub">
          {checksRaw.engine_version ? `Engine ${checksRaw.engine_version}` : 'Engine'}
          {typeof checksRaw.ms === 'number' ? ` · computed in ${checksRaw.ms} ms` : ''} · each check re-runs the engine on the reference data
        </span>
        <span className="drawer-hero-actions">
          {checksRaw.all_pass ? (
            <Pill tone="success" icon="check">
              All checks pass
            </Pill>
          ) : (
            <Pill tone="danger" icon="x">
              {results.filter((r) => !r.pass).length} failing
            </Pill>
          )}
          <Button variant="secondary" size="sm" icon="refresh" onClick={() => void refreshChecks()} disabled={checksLoading}>
            {checksLoading ? 'Running…' : 'Re-run checks'}
          </Button>
        </span>
      </div>

      <ErrorCallout error={error} />

      <SeeIt
        onClick={() => {
          closeDrawer();
          navigate('checks');
        }}
      >
        {t('checks.openPage', 'Open the checks page, with the working for every check')}
      </SeeIt>

      {results.map((r) => (
        <section key={r.id} className={`check-card${r.pass ? '' : ' is-failing'}`} aria-labelledby={`${r.id}-title`}>
          <div className="check-head">
            <h3 id={`${r.id}-title`} className="check-title">
              Check {r.n}
            </h3>
            <Pill tone="neutral">{r.points} points</Pill>
            <span className="check-status">
              {r.pass ? (
                <Pill tone="success" icon="check">
                  PASS
                </Pill>
              ) : (
                <Pill tone="danger" icon="x">
                  FAIL
                </Pill>
              )}
            </span>
          </div>
          <p className="check-text">{r.text}</p>
          <Evidence id={r.id} c={checksRaw} />
          <div className="check-foot">
            <span className="field-hint">{r.proof}</span>
            <Button variant="secondary" size="sm" iconRight="arrow-right" onClick={() => void showMe(r.id)} disabled={busy !== null}>
              {busy === r.id ? 'Loading…' : 'Show me'}
            </Button>
          </div>
        </section>
      ))}
    </div>
  );
}

interface Usp {
  key: string;
  icon: IconName;
  title: string;
  text: string;
  see: string;
  go: () => void;
}

function SeeIt({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="see-it" onClick={onClick}>
      {children}
      <Icon name="arrow-right" size={14} />
    </button>
  );
}

export function AboutDetail() {
  const { t } = useTranslation();
  const { analysis, closeDrawer, openMargin, focusLedgerTable } = useStore();

  const goto = (route: Route, after?: () => void) => {
    closeDrawer();
    navigate(route);
    if (after) window.setTimeout(after, 250);
  };

  const usps: Usp[] = [
    {
      key: 'gate',
      icon: 'lock',
      title: 'Refund and recovery facts before any profit headline',
      text: 'The headline gate hides the margin while any returned order is missing its refund or recovery facts.',
      see: 'Margin card on the ledger',
      go: () => {
        navigate('ledger');
        if (analysis) openMargin();
        else closeDrawer();
      },
    },
    {
      key: 'audit',
      icon: 'sparkles',
      title: 'Every rupee is deterministic and auditable — AI only words it',
      text: 'The engine computes every number; narrative text is tagged template or AI and never changes a figure.',
      see: 'Template and AI tags on leaks',
      go: () => goto('leaks'),
    },
    {
      key: 'attribution',
      icon: 'refresh',
      title: 'Ads are never deducted twice',
      text: 'Switch between ads allocated per order and channel spend; the reconciliation stays green either way.',
      see: 'Attribution switch with live reconciliation',
      go: () => goto('ledger', () => revealElement(document.querySelector<HTMLElement>('.topbar-attr'), false)),
    },
    {
      key: 'unknown',
      icon: 'alert-triangle',
      title: 'Unknown is a value, never zero',
      text: 'Missing facts show as unknown chips and partial totals instead of silently becoming ₹ 0.',
      see: 'Unknown filter on the ledger',
      go: () => {
        if (analysis) focusLedgerTable('unknown');
        goto('ledger');
      },
    },
    {
      key: 'decision',
      icon: 'sliders',
      title: 'One controlled change, one measurable decision',
      text: 'Change one assumption, see the recommendation move, and save it with a 30-day test and a stop rule.',
      see: 'Scenario, then decision',
      go: () => goto('scenario'),
    },
    {
      key: 'csv',
      icon: 'upload-cloud',
      title: 'Works from a CSV today, store connectors next',
      text: 'The same order contract takes a CSV upload now and can be fed by order APIs later.',
      see: 'Import and the CSV template',
      go: () => goto('import', () => revealElement(document.querySelector<HTMLElement>('.dropzone'), false)),
    },
  ];

  const steps: Array<[string, string]> = [
    ['Import', 'Load the sample or your own CSV files; every row is validated and flagged.'],
    ['Ledger', 'Contribution per order, reconciled to channels and products.'],
    ['Leaks', 'Losing orders grouped by cause, with the rupees lost.'],
    ['Scenario', 'Change one assumption and watch the recommendation move.'],
    ['Decision', 'Record the intervention, a 30-day test, a stop rule and an owner.'],
  ];

  return (
    <div className="drawer-stack about">
      <section className="drawer-section" aria-labelledby="about-problem">
        <h3 id="about-problem" className="section-label">
          The problem
        </h3>
        <p className="about-text">
          A small D2C founder sees net sales on the dashboard, not contribution. Refunds, returns that never come back to stock, shipping,
          gateway fees and ads quietly turn some orders negative, and a profit headline built before refund facts are in can be wrong in
          either direction.
        </p>
      </section>

      <section className="drawer-section" aria-labelledby="about-mvp">
        <h3 id="about-mvp" className="section-label">
          MVP — the five-step journey
        </h3>
        <ol className="about-steps">
          {steps.map(([name, line], i) => (
            <li key={name}>
              <span className="about-step-n">{i + 1}</span>
              <span>
                <strong>{name}</strong> — {line}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="drawer-section" aria-labelledby="about-usp">
        <h3 id="about-usp" className="section-label">
          What makes it different
        </h3>
        <ul className="usp-list">
          {usps.map((u) => (
            <li key={u.key} className="usp">
              <span className="usp-icon" aria-hidden="true">
                <Icon name={u.icon} size={18} />
              </span>
              <span className="usp-body">
                <strong>{u.title}</strong>
                <span className="usp-text">{u.text}</span>
                <SeeIt onClick={u.go}>See it: {u.see}</SeeIt>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="drawer-section" aria-labelledby="about-proof">
        <h3 id="about-proof" className="section-label">
          {t('changelog.aboutTitle', 'Proof and change log')}
        </h3>
        <ul className="usp-list">
          <li className="usp">
            <span className="usp-icon" aria-hidden="true">
              <Icon name="file" size={18} />
            </span>
            <span className="usp-body">
              <strong>{t('changelog.aboutHeading', 'From the brief to the evidence')}</strong>
              <span className="usp-text">
                {t('changelog.aboutText', 'Where the ledger started, the scope we negotiated and what we cut, and the evidence it holds now.')}
              </span>
              <SeeIt onClick={() => goto('changelog')}>{t('changelog.aboutLink', 'Open the change log')}</SeeIt>
            </span>
          </li>
          <li className="usp">
            <span className="usp-icon" aria-hidden="true">
              <Icon name="check-circle" size={18} />
            </span>
            <span className="usp-body">
              <strong>{t('checks.aboutHeading', 'Every check, with its working')}</strong>
              <span className="usp-text">{t('checks.aboutText', 'Worked order, reconciliation, the missing refund and margins, re-run live on the reference data.')}</span>
              <SeeIt onClick={() => goto('checks')}>{t('checks.aboutLink', 'Open the checks')}</SeeIt>
            </span>
          </li>
        </ul>
      </section>

      <p className="about-foot">Operational contribution, not statutory net profit.</p>
    </div>
  );
}
