import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toErrorInfo, type ErrorInfo } from '../api/client';
import { interventionText } from '../api/proof';
import type { Checks } from '../api/types';
import { lower } from '../i18n';
import { formatInr, formatPct } from '../lib/format';
import { INTERVENTION_LABELS } from '../lib/labels';
import { navigate, type Route } from '../lib/router';
import { useStore } from '../state/store';
import { CONFIDENCE_KEY, Pill } from './Badge';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Callout, ErrorCallout, revealElement, Skeleton } from './ui';

type CheckId = 'check1' | 'check2' | 'check3';

/** Each check's sentence and what "Show me" does, as keys with their English (translated at render). */
const CHECKS: Array<{ id: CheckId; n: number; points: number; textKey: string; text: string; proofKey: string; proof: string }> = [
  {
    id: 'check1',
    n: 1,
    points: 10,
    textKey: 'info.c1.text',
    text: 'Reference order revenue 1,000 less refund 200, net product cost 400, shipping 50, ads 100 and handling 20 equals ₹ 230 contribution.',
    proofKey: 'info.c1.proof',
    proof: 'Opens the worked order waterfall.',
  },
  {
    id: 'check2',
    n: 2,
    points: 10,
    textKey: 'info.c2.text',
    text: 'Detail and group totals reconcile; ad allocations and channel spend are never both deducted.',
    proofKey: 'info.c2.proof',
    proof: 'Loads the extended sample in channel-spend mode, on the By channel tab.',
  },
  {
    id: 'check3',
    n: 3,
    points: 5,
    textKey: 'info.c3.text',
    text: 'Missing refund facts yield unknown or labelled scenario, and changing return assumptions updates the recommendation.',
    proofKey: 'info.c3.proof',
    proof: 'Loads the missing-refund sample and runs recovery at ₹ 200 per return.',
  },
];

const tick = (ok: boolean | undefined) => (ok ? '✓' : '✗');

function Evidence({ id, c }: { id: CheckId; c: Checks }) {
  const { t } = useTranslation();
  const label = (k: string | undefined) =>
    k ? interventionText(t, k, INTERVENTION_LABELS[k] ?? k.replace(/_/g, ' ')) : lower(t('status.unknown', 'Unknown'));
  if (id === 'check1' && c.check1) {
    return (
      <dl className="kv">
        <div>
          <dt>{t('info.ev.expected', 'Expected')}</dt>
          <dd className="num">{formatInr(c.check1.expected)}</dd>
        </div>
        <div>
          <dt>{t('info.ev.actual', 'Actual')}</dt>
          <dd className="num">{formatInr(c.check1.actual)}</dd>
        </div>
        <div>
          <dt>{t('info.ev.sixLines', 'Six waterfall lines')}</dt>
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
          <dt>{t('info.ev.totals', 'Totals')}</dt>
          <dd className="num">
            {t('info.ev.totalsValue', '{{allocate}} allocate = {{channel}} channel', {
              allocate: formatInr(k.allocate_total),
              channel: formatInr(k.channel_total),
            })}
          </dd>
        </div>
        <div>
          <dt>{t('info.ev.fixture', 'Fixture')}</dt>
          <dd className="num">{formatInr(k.fixture_total)}</dd>
        </div>
        <div>
          <dt>{t('info.ev.reconciled', 'Reconciled')}</dt>
          <dd className={k.reconciled ? 't-gain' : 't-loss'}>
            {tick(k.reconciled)} {t('info.ev.reconciledText', 'orders = channels = products')}
          </dd>
        </div>
        <div>
          <dt>{t('info.ev.neverBoth', 'Never both')}</dt>
          <dd className={k.never_both ? 't-gain' : 't-loss'}>
            {tick(k.never_both)} {t('info.ev.neverBothText', 'ads and channel spend not both deducted')}
          </dd>
        </div>
        {spend.length > 0 ? (
          <div>
            <dt>{t('info.ev.channelSpend', 'Channel spend')}</dt>
            <dd className="num">{spend.map(([ch, v]) => `${ch} ${formatInr(v)}`).join(' · ')}</dd>
          </div>
        ) : null}
      </dl>
    );
  }
  if (id === 'check3' && c.check3) {
    const k = c.check3;
    const confidence = CONFIDENCE_KEY[k.confidence] ? lower(t(CONFIDENCE_KEY[k.confidence])) : k.confidence;
    return (
      <dl className="kv">
        <div>
          <dt>{t('info.ev.before', 'Before')}</dt>
          <dd className="num">
            {label(k.before?.intervention)} {k.before ? formatInr(k.before.expected_delta_inr) : ''}
          </dd>
        </div>
        <div>
          <dt>{t('info.ev.afterRecovery', 'After recovery {{pct}}', { pct: formatPct(50) })}</dt>
          <dd className="num">
            {label(k.after_recovery_50?.intervention)} {k.after_recovery_50 ? formatInr(k.after_recovery_50.expected_delta_inr) : ''}
          </dd>
        </div>
        <div>
          <dt>{t('info.ev.changed', 'Recommendation changed')}</dt>
          <dd className={k.recommendation_changed ? 't-gain' : 't-loss'}>{tick(k.recommendation_changed)}</dd>
        </div>
        <div>
          <dt>{t('info.ev.unknownLabelled', 'Unknown labelled')}</dt>
          <dd className={k.unknown_labelled ? 't-gain' : 't-loss'}>
            {tick(k.unknown_labelled)} {t('info.ev.confidence', 'confidence {{value}}', { value: confidence })}
          </dd>
        </div>
      </dl>
    );
  }
  return <p className="muted small">{t('info.ev.none', 'No result for this check.')}</p>;
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
      <div className="drawer-stack" role="status" aria-label={t('checks.loading', 'Running the checks')}>
        <Skeleton width="50%" height={28} />
        <Skeleton width="100%" height={140} />
        <Skeleton width="100%" height={140} />
      </div>
    ) : (
      <Callout tone="danger" title={t('info.loadError', 'The checks could not be loaded.')}>
        <Button variant="secondary" size="sm" icon="refresh" onClick={() => void refreshChecks()}>
          {t('info.rerun', 'Re-run checks')}
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
        <span className="drawer-hero-label">{t('info.publicChecks', 'Public checks')}</span>
        <span className="drawer-hero-value">{t('info.pointsOf', '{{earned}} of {{total}} points', { earned, total })}</span>
        <span className="drawer-hero-sub">
          {checksRaw.engine_version ? t('checks.engine', 'Engine {{version}}', { version: checksRaw.engine_version }) : t('info.engine', 'Engine')}
          {typeof checksRaw.ms === 'number' ? ` · ${t('checks.computed', 'computed in {{ms}} ms', { ms: checksRaw.ms })}` : ''}
          {' · '}
          {t('info.eachCheck', 'each check re-runs the engine on the reference data')}
        </span>
        <span className="drawer-hero-actions">
          {checksRaw.all_pass ? (
            <Pill tone="success" icon="check">
              {t('info.allPass', 'All checks pass')}
            </Pill>
          ) : (
            <Pill tone="danger" icon="x">
              {t('info.failing', '{{n}} failing', { n: results.filter((r) => !r.pass).length })}
            </Pill>
          )}
          <Button variant="secondary" size="sm" icon="refresh" onClick={() => void refreshChecks()} disabled={checksLoading}>
            {checksLoading ? t('checks.running', 'Running…') : t('info.rerun', 'Re-run checks')}
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
              {t('checks.checkN', 'Check {{n}}', { n: r.n })}
            </h3>
            <Pill tone="neutral">{t('info.points', '{{n}} points', { n: r.points })}</Pill>
            <span className="check-status">
              {r.pass ? (
                <Pill tone="success" icon="check">
                  {t('checks.pass', 'PASS')}
                </Pill>
              ) : (
                <Pill tone="danger" icon="x">
                  {t('checks.fail', 'FAIL')}
                </Pill>
              )}
            </span>
          </div>
          <p className="check-text">{t(r.textKey, r.text)}</p>
          <Evidence id={r.id} c={checksRaw} />
          <div className="check-foot">
            <span className="field-hint">{t(r.proofKey, r.proof)}</span>
            <Button variant="secondary" size="sm" iconRight="arrow-right" onClick={() => void showMe(r.id)} disabled={busy !== null}>
              {busy === r.id ? t('actions.loading', 'Loading…') : t('info.showMe', 'Show me')}
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
      title: t('info.usp.gateTitle', 'Refund and recovery facts before any profit headline'),
      text: t('info.usp.gateText', 'The headline gate hides the margin while any returned order is missing its refund or recovery facts.'),
      see: t('info.usp.gateSee', 'Margin card on the ledger'),
      go: () => {
        navigate('ledger');
        if (analysis) openMargin();
        else closeDrawer();
      },
    },
    {
      key: 'audit',
      icon: 'sparkles',
      title: t('info.usp.auditTitle', 'Every rupee is deterministic and auditable — AI only words it'),
      text: t('info.usp.auditText', 'The engine computes every number; narrative text is tagged template or AI and never changes a figure.'),
      see: t('info.usp.auditSee', 'Template and AI tags on leaks'),
      go: () => goto('leaks'),
    },
    {
      key: 'attribution',
      icon: 'refresh',
      title: t('info.usp.attrTitle', 'Ads are never deducted twice'),
      text: t('info.usp.attrText', 'Switch between ads allocated per order and channel spend; the reconciliation stays green either way.'),
      see: t('info.usp.attrSee', 'Attribution switch with live reconciliation'),
      go: () => goto('ledger', () => revealElement(document.querySelector<HTMLElement>('.topbar-attr'), false)),
    },
    {
      key: 'unknown',
      icon: 'alert-triangle',
      title: t('info.usp.unknownTitle', 'Unknown is a value, never zero'),
      text: t('info.usp.unknownText', 'Missing facts show as unknown chips and partial totals instead of silently becoming ₹ 0.'),
      see: t('info.usp.unknownSee', 'Unknown filter on the ledger'),
      go: () => {
        if (analysis) focusLedgerTable('unknown');
        goto('ledger');
      },
    },
    {
      key: 'decision',
      icon: 'sliders',
      title: t('info.usp.decisionTitle', 'One controlled change, one measurable decision'),
      text: t('info.usp.decisionText', 'Change one assumption, see the recommendation move, and save it with a 30-day test and a stop rule.'),
      see: t('info.usp.decisionSee', 'Scenario, then decision'),
      go: () => goto('scenario'),
    },
    {
      key: 'csv',
      icon: 'upload-cloud',
      title: t('info.usp.csvTitle', 'Works from a CSV today, store connectors next'),
      text: t('info.usp.csvText', 'The same order contract takes a CSV upload now and can be fed by order APIs later.'),
      see: t('info.usp.csvSee', 'Import and the CSV template'),
      go: () => goto('import', () => revealElement(document.querySelector<HTMLElement>('.dropzone'), false)),
    },
  ];

  const steps: Array<[string, string]> = [
    [t('nav.import', 'Import'), t('info.step.import', 'Load the sample or your own CSV files; every row is validated and flagged.')],
    [t('nav.ledger', 'Ledger'), t('info.step.ledger', 'Contribution per order, reconciled to channels and products.')],
    [t('nav.leaks', 'Leaks'), t('info.step.leaks', 'Losing orders grouped by cause, with the rupees lost.')],
    [t('nav.scenario', 'Scenario'), t('info.step.scenario', 'Change one assumption and watch the recommendation move.')],
    [t('nav.decision', 'Decision'), t('info.step.decision', 'Record the intervention, a 30-day test, a stop rule and an owner.')],
  ];

  return (
    <div className="drawer-stack about">
      <section className="drawer-section" aria-labelledby="about-problem">
        <h3 id="about-problem" className="section-label">
          {t('info.problemTitle', 'The problem')}
        </h3>
        <p className="about-text">
          {t(
            'info.problemText',
            'A small D2C founder sees net sales on the dashboard, not contribution. Refunds, returns that never come back to stock, shipping, gateway fees and ads quietly turn some orders negative, and a profit headline built before refund facts are in can be wrong in either direction.',
          )}
        </p>
      </section>

      <section className="drawer-section" aria-labelledby="about-mvp">
        <h3 id="about-mvp" className="section-label">
          {t('info.mvpTitle', 'MVP — the five-step journey')}
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
          {t('info.uspTitle', 'What makes it different')}
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
                <SeeIt onClick={u.go}>{t('info.seeIt', 'See it: {{what}}', { what: u.see })}</SeeIt>
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

      <p className="about-foot">{t('info.footNote', 'Operational contribution, not statutory net profit.')}</p>
    </div>
  );
}
