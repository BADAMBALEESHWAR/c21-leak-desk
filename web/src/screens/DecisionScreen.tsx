import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, authDownload, downloadFile, toErrorInfo, type ErrorInfo } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { AnalysisResponse, Candidate, CheckIn, DecisionRequest, DecisionSaved, DecisionSummary, OverrideKey, Recommendation, ScenarioResponse, TextSource } from '../api/types';
import { CONFIDENCE_KEY, ConfidenceBadge, Pill, SourceTag } from '../components/Badge';
import { Button, ButtonLink } from '../components/Button';
import { NeedsAnalysis } from '../components/EmptyState';
import { ErrorNote } from '../components/ErrorNote';
import { Icon } from '../components/Icon';
import { Money } from '../components/Money';
import { PageHeader } from '../components/Page';
import { Provenance, ProvenanceValue } from '../components/Provenance';
import { Table, type Column } from '../components/Table';
import { Callout } from '../components/ui';
import { lower } from '../i18n';
import { addDays, capitalise, formatDate, formatDateTime, formatInr, formatPct, formatSignedInr } from '../lib/format';
import { handlingEstimateUsed, OVERRIDE_LABELS } from '../lib/labels';
import { hrefFor, navigate } from '../lib/router';
import { OVERRIDE_KEYS, useStore } from '../state/store';

interface AssumedInput {
  input: string;
  label: string;
  value: unknown;
  why: string;
}

/** Every assumed input behind a decision; sent with the save so the export carries them all. */
export function assumedInputs(
  a: AnalysisResponse,
  s: ScenarioResponse | null,
  fixedCosts: number,
  expected: { value: number | null; engine: number | null },
): AssumedInput[] {
  const out: AssumedInput[] = [];
  if (s) {
    for (const k of OVERRIDE_KEYS) {
      if (s.overrides[k] !== undefined) out.push({ input: `scenario.${k}`, label: OVERRIDE_LABELS[k], value: s.overrides[k], why: 'scenario override' });
    }
    if (s.overrides.assume_unknown_refund) {
      out.push({ input: 'scenario.assume_unknown_refund', label: OVERRIDE_LABELS.assume_unknown_refund, value: true, why: 'missing refund facts filled with a stated assumption' });
    }
  }
  if (handlingEstimateUsed(a)) {
    out.push({ input: 'handling_default_inr', label: 'Handling per order (estimate)', value: a.config.handling_default_inr, why: 'default for rows without handling_inr' });
  }
  if (fixedCosts > 0) out.push({ input: 'fixed_costs_inr', label: 'Fixed costs per period', value: fixedCosts, why: 'entered on the ledger for the estimated net margin' });
  if (expected.value !== null && expected.value !== expected.engine) {
    out.push({ input: 'expected_delta_inr', label: 'Expected ₹ impact per period', value: expected.value, why: `entered by the owner; the engine figure was ${expected.engine ?? 'none'}` });
  }
  return out;
}

const CUSTOM = '__custom__';
type Field = 'intervention' | 'expected_delta_inr' | 'test_30d' | 'stop_rule' | 'owner' | 'notes';
const FIELDS: Field[] = ['intervention', 'expected_delta_inr', 'test_30d', 'stop_rule', 'owner', 'notes'];

function fieldOf(path: string): Field | null {
  const last = path.split('.').pop() ?? '';
  return (FIELDS as string[]).includes(last) ? (last as Field) : null;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="field-error">
      <Icon name="alert-triangle" size={14} /> {message}
    </p>
  );
}

function DecisionsList({ version }: { version: number }) {
  const { showToast } = useStore();
  const { t } = useTranslation();
  const onDownloadError = (e: ErrorInfo) => showToast(e.message, 'info');
  const [rows, setRows] = useState<DecisionSummary[] | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listDecisions();
      const sorted = [...(Array.isArray(list) ? list : [])].sort((a, b) => (a.saved_at < b.saved_at ? 1 : -1));
      setRows(sorted);
      setError(null);
    } catch (err) {
      setError(toErrorInfo(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, version]);

  const columns: Column<DecisionSummary>[] = [
    { id: 'saved', header: t('common.saved'), rowHeader: true, className: 'col-nowrap', cell: (d) => <span className="num">{formatDateTime(d.saved_at)}</span> },
    { id: 'intervention', header: t('decision.intervention'), cell: (d) => d.intervention_label || d.intervention },
    { id: 'expected', header: t('decision.expectedInr'), align: 'right', cell: (d) => <Money value={d.expected_delta_inr} tone="contribution" /> },
    {
      id: 'confidence',
      header: t('scenario.confidence'),
      cell: (d) => (d.confidence === 'custom' ? <Pill tone="neutral">custom</Pill> : <ConfidenceBadge confidence={d.confidence} />),
    },
    { id: 'owner', header: t('decision.owner'), cell: (d) => d.owner },
    {
      id: 'export',
      header: t('actions.export'),
      className: 'col-nowrap',
      cell: (d) => (
        <span className="export-links">
          <ButtonLink variant="secondary" size="sm" icon="download" href={api.exportUrl(d.decision_id, 'md')} download onClick={authDownload(api.exportUrl(d.decision_id, 'md'), `decision-${d.decision_id}.md`, onDownloadError)}>
            {t('actions.exportMd')}
          </ButtonLink>
          <ButtonLink variant="secondary" size="sm" icon="download" href={api.exportUrl(d.decision_id, 'json')} download onClick={authDownload(api.exportUrl(d.decision_id, 'json'), `decision-${d.decision_id}.json`, onDownloadError)}>
            {t('actions.exportJson')}
          </ButtonLink>
        </span>
      ),
    },
  ];

  return (
    <section className="card table-card" aria-labelledby="decisions-title">
      <div className="table-card-head">
        <h2 id="decisions-title" className="card-title">
          {t('decision.savedList')}
        </h2>
        {rows ? <span className="muted small">{rows.length} saved</span> : null}
      </div>
      {error ? (
        <ErrorNote error={error} />
      ) : rows === null ? (
        <p className="muted pad">Loading saved decisions…</p>
      ) : (
        <Table caption="Saved decisions, newest first" columns={columns} rows={rows} rowKey={(d) => d.decision_id} emptyText="No decisions saved yet." />
      )}
    </section>
  );
}

function overrideText(o: Record<string, unknown> | undefined | null): string {
  if (!o) return 'none';
  const parts = Object.entries(o).map(([k, v]) => {
    const label = OVERRIDE_LABELS[k as OverrideKey] ?? k;
    if (k === 'assume_unknown_refund') return v ? 'unknown refunds assumed' : '';
    if (k.endsWith('_pct') && typeof v === 'number') return `${label} ${formatPct(v)}`;
    if ((k.endsWith('_inr') || k === 'ads_per_order') && typeof v === 'number') return `${label} ${formatInr(v)}`;
    if (k === 'refund_policy') return `${label}: ${v === 'partial' ? 'partial, 80%' : String(v)}`;
    return `${label} ${String(v)}`;
  });
  return parts.filter(Boolean).join('; ') || 'none';
}

function Snapshot({ a, s }: { a: AnalysisResponse; s: ScenarioResponse | null }) {
  const { focusLedgerTable, fixedCosts } = useStore();
  const { t } = useTranslation();
  const contributionText = a.totals.contribution_inr === null ? 'unknown' : formatInr(a.totals.contribution_inr);
  return (
    <section className="card snapshot-card" aria-labelledby="snapshot-title">
      <h2 id="snapshot-title" className="card-title">
        {t('decision.snapshot')}
      </h2>
      <div className="mini-kpis">
        <button type="button" className="card-action" onClick={() => navigate('ledger')} aria-label={`Contribution ${contributionText} — open the ledger`}>
          <span>{t('ledger.operationalContribution', 'Operational contribution')}</span>
          <strong>
            <Money value={a.totals.contribution_inr} tone="contribution" />
          </strong>
          <span className="kpi-go" aria-hidden="true">
            <Icon name="arrow-up-right" size={13} />
          </span>
        </button>
        <button
          type="button"
          className="card-action"
          onClick={() => {
            if (a.totals.unknown_count > 0) focusLedgerTable('unknown');
            navigate('ledger');
          }}
          aria-label={`Unknown orders ${a.totals.unknown_count} — ${a.totals.unknown_count > 0 ? 'show them in the ledger' : 'open the ledger'}`}
        >
          <span>Unknown orders</span>
          <strong className={a.totals.unknown_count > 0 ? 't-unknown' : undefined}>{a.totals.unknown_count}</strong>
          <span className="kpi-go" aria-hidden="true">
            <Icon name="arrow-up-right" size={13} />
          </span>
        </button>
        <button type="button" className="card-action" onClick={() => navigate('ledger')} aria-label={`Reconciled ${a.reconciliation.ok ? 'yes' : 'no'} — open the ledger`}>
          <span>Reconciled</span>
          <strong className={a.reconciliation.ok ? 't-gain' : 't-loss'}>{a.reconciliation.ok ? 'Yes ✓' : 'No'}</strong>
          <span className="kpi-go" aria-hidden="true">
            <Icon name="arrow-up-right" size={13} />
          </span>
        </button>
      </div>
      <dl className="kv">
        <div>
          <dt>Attribution</dt>
          <dd>{a.attribution === 'channel' ? 'Channel spend' : 'Ads allocated per order'}</dd>
        </div>
        <div>
          <dt>Period end</dt>
          <dd>{a.period_end}</dd>
        </div>
        <div>
          <dt>Changed</dt>
          <dd>
            <ProvenanceValue kind={s ? 'assumed' : 'observed'} value={s ? overrideText(s.overrides as Record<string, unknown>) : 'nothing (observed baseline)'} />
          </dd>
        </div>
        <div>
          <dt>Return rate</dt>
          <dd>
            <ProvenanceValue kind="observed" value={formatPct(a.observed.return_rate_pct)} />
          </dd>
        </div>
        <div>
          <dt>Recovery</dt>
          <dd>
            <ProvenanceValue kind="observed" value={a.observed.recovery_pct === null ? 'unknown' : formatPct(a.observed.recovery_pct)} />
          </dd>
        </div>
        <div>
          <dt>Handling</dt>
          <dd>
            <ProvenanceValue kind={handlingEstimateUsed(a) ? 'assumed' : 'observed'} value={handlingEstimateUsed(a) ? `${formatInr(a.config.handling_default_inr)} per order, estimate` : 'from the rows'} />
          </dd>
        </div>
        <div>
          <dt>Fixed costs</dt>
          <dd>
            <ProvenanceValue kind="assumed" value={fixedCosts > 0 ? `${formatInr(fixedCosts)} per period` : `${formatInr(0)} (not set)`} />
          </dd>
        </div>
        <div>
          <dt>Engine</dt>
          <dd>{a.engine_version}</dd>
        </div>
      </dl>
    </section>
  );
}

const SNAPSHOT_KEYS: Record<string, string> = {
  dataset_source: 'Dataset',
  attribution: 'Attribution',
  period_end: 'Period end',
  handling_default_inr: 'Handling default',
  changed: 'Changed',
  overrides: 'Overrides',
  observed_return_rate_pct: 'Observed return rate',
  observed_recovery_pct: 'Observed recovery',
  engine_version: 'Engine',
  scenario_notes: 'Scenario notes',
};

function snapshotValue(k: string, v: unknown): string {
  if (v === null || v === undefined) return 'none';
  if (k === 'overrides') return overrideText(v as Record<string, unknown>);
  if (k === 'changed') return OVERRIDE_LABELS[v as OverrideKey] ?? String(v);
  if (Array.isArray(v)) return v.map(String).join(' ');
  if (typeof v === 'number') return k.endsWith('_pct') ? formatPct(v) : k.endsWith('_inr') ? formatInr(v) : String(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** The 30-day check-in: from the save or the export when the API sends it, else 30 days on, against operational contribution. */
function useCheckIn(saved: DecisionSaved, fallback: CheckIn): { check: CheckIn; fromApi: boolean } {
  const [fromExport, setFromExport] = useState<CheckIn | null>(null);
  useEffect(() => {
    if (saved.check_in_30_days) return undefined;
    let cancelled = false;
    api
      .decisionExport(saved.decision_id)
      .then((x) => {
        if (!cancelled && x && x.check_in_30_days && x.check_in_30_days.date) setFromExport(x.check_in_30_days);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [saved.decision_id, saved.check_in_30_days]);
  const api30 = saved.check_in_30_days ?? fromExport;
  return { check: api30 ?? fallback, fromApi: api30 !== null && api30 !== undefined };
}

function valueText(v: CheckIn['target_value'] | undefined, c: CheckIn): string {
  if (v === null || v === undefined || v === '') return 'not set';
  if (typeof v !== 'number') return String(v);
  const pct = c.unit ? c.unit === 'pct' : /pct|%|percent|rate/i.test(c.metric);
  return pct ? formatPct(v) : formatInr(v);
}

const METRIC_NAMES: Record<string, string> = {
  contribution_inr: 'Operational contribution per period',
  operational_contribution_inr: 'Operational contribution per period',
  recovery_pct: 'Recovery of product cost on returns',
  return_rate_pct: 'Return rate',
};

function SavedSnapshot({ saved, a, expected }: { saved: DecisionSaved; a: AnalysisResponse; expected: number | null }) {
  const account = useAuth().mode === 'account';
  const { showToast } = useStore();
  const { t } = useTranslation();
  const [downloading, setDownloading] = useState(false);
  const entries = Object.entries({ ...saved.assumptions, engine_version: saved.engine_version }).filter(([k]) => k in SNAPSHOT_KEYS);
  const base = a.totals.contribution_inr;
  const { check } = useCheckIn(saved, {
    metric: 'Operational contribution per period',
    target_value: base === null ? null : base + (expected ?? 0),
    date: addDays(saved.saved_at, 30),
  });
  const exportJson = async () => {
    setDownloading(true);
    try {
      await downloadFile(api.exportUrl(saved.decision_id, 'json'), `decision-${saved.decision_id}.json`);
    } catch (err) {
      showToast(toErrorInfo(err).message, 'info');
    } finally {
      setDownloading(false);
    }
  };
  return (
    <section className="card saved-card" aria-labelledby="saved-title">
      <div className="card-head">
        <span className="icon-chip icon-chip-success" aria-hidden="true">
          <Icon name="check-circle" size={18} />
        </span>
        <div>
          <h2 id="saved-title" className="card-title">
            {t('decision.saved')}
          </h2>
          <p className="card-sub">
            {formatDateTime(saved.saved_at)} ·{' '}
            {saved.persisted === false
              ? t('topbar.inMemory')
              : account && saved.workspace !== 'demo'
                ? t('decision.savedToAccount', 'saved to your account')
                : t('decision.savedDemo', 'demo workspace')}
          </p>
        </div>
      </div>
      <div className="saved-export">
        <Button variant="secondary" size="sm" icon="download" onClick={() => void exportJson()} disabled={downloading}>
          {t('actions.exportJson')}
        </Button>
        <span className="muted small">{t('decision.exportNote', 'decision-{{id}}.json, with every assumed input', { id: saved.decision_id })}</span>
      </div>
      <div className="checkin" aria-label={t('decision.checkInLabel', '30-day check-in')}>
        <span className="checkin-date">
          {t('decision.checkIn', 'Check in on {{date}}', { date: formatDate(check.date) })}
        </span>
        <dl className="checkin-kv">
          <div>
            <dt>{t('decision.metric', 'Metric')}</dt>
            <dd>{check.metric_label ?? METRIC_NAMES[check.metric] ?? check.metric}</dd>
          </div>
          <div>
            <dt>{t('decision.target', 'Target')}</dt>
            <dd className="num">
              {check.direction === 'at_most' ? t('decision.atMost', 'at most') : check.direction === 'at_least' ? t('decision.atLeast', 'at least') : ''}{' '}
              {valueText(check.target_value, check)}
              {check.baseline_value !== undefined && check.baseline_value !== null ? (
                <span className="checkin-from">
                  {' '}
                  {t('decision.fromBaseline', 'from {{v}}', { v: valueText(check.baseline_value, check) })}{' '}
                  <Provenance kind={check.baseline_source === 'observed' || check.baseline_source === undefined ? 'observed' : 'assumed'} />
                </span>
              ) : null}
            </dd>
          </div>
          {typeof check.contribution_target_inr === 'number' ? (
            <div>
              <dt>{t('decision.contributionTarget', 'Contribution target')}</dt>
              <dd className="num">{formatInr(check.contribution_target_inr)}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      <dl className="kv">
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt>{SNAPSHOT_KEYS[k]}</dt>
            <dd>{snapshotValue(k, v)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface FormProps {
  a: AnalysisResponse;
  s: ScenarioResponse | null;
  rec: Recommendation;
  candidates: Candidate[];
  onSaved: (d: DecisionSaved, expected: number | null) => void;
}

function DecisionForm({ a, s, rec, candidates, onSaved }: FormProps) {
  const { showToast, markDecisionSaved, fixedCosts } = useStore();
  const { t } = useTranslation();
  const groupName = useId();
  const [choice, setChoice] = useState<string>(rec.preselect ? rec.intervention : '');
  const [custom, setCustom] = useState('');
  const [expected, setExpected] = useState<string>(rec.preselect ? String(rec.expected_delta_inr) : '');
  const [test, setTest] = useState('');
  const [stop, setStop] = useState('');
  const [draftSource, setDraftSource] = useState<TextSource | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<ErrorInfo | null>(null);
  const [owner, setOwner] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<ErrorInfo | null>(null);
  const [saving, setSaving] = useState(false);

  const options: Array<{ key: string; label: string; delta: number; rule: string }> = candidates.map((c) => ({ key: c.intervention, label: c.label, delta: c.delta_inr, rule: c.rule }));
  if (!options.some((o) => o.key === rec.intervention)) options.unshift({ key: rec.intervention, label: rec.label, delta: rec.expected_delta_inr, rule: rec.rule });

  const onChoice = (v: string) => {
    setChoice(v);
    const opt = options.find((o) => o.key === v);
    if (opt) setExpected(String(opt.delta));
  };

  const draft = async () => {
    setDrafting(true);
    setDraftError(null);
    try {
      if (s) {
        const plan = await api.testPlan(s.scenario_id);
        setTest(plan.test_30d);
        setStop(plan.stop_rule);
        setDraftSource(plan.source);
      } else {
        setTest(rec.test_30d_draft);
        setStop(rec.stop_rule_draft);
        setDraftSource(rec.draft_source);
      }
    } catch (err) {
      setDraftError(toErrorInfo(err));
    } finally {
      setDrafting(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (drafting) return; // the draft is still loading; Save is disabled until it lands
    setErrors({});
    setFormError(null);
    const intervention = choice === CUSTOM ? custom.trim() : choice;
    const exp = expected.trim();
    const expectedNum = exp === '' ? null : Number(exp);
    if (expectedNum !== null && !Number.isFinite(expectedNum)) {
      setErrors({ expected_delta_inr: 'Enter the expected change in rupees, for example 480, or leave it blank.' });
      return;
    }
    const engineExpected = options.find((o) => o.key === choice)?.delta ?? null;
    const assumed = assumedInputs(a, s, fixedCosts, { value: expectedNum, engine: engineExpected });
    const body: DecisionRequest = {
      ...(s ? { scenario_id: s.scenario_id } : {}),
      intervention,
      expected_delta_inr: expectedNum,
      test_30d: test,
      stop_rule: stop,
      owner,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(fixedCosts > 0 ? { fixed_costs_inr: fixedCosts } : {}),
      ...(assumed.length > 0 ? { assumptions: { provenance: 'assumed', assumed_inputs: assumed } } : {}),
    };
    setSaving(true);
    try {
      const saved = await api.createDecision(a.analysis_id, body);
      showToast(t('decision.saved'));
      markDecisionSaved(a.analysis_id);
      onSaved(saved, expectedNum);
    } catch (err) {
      if (err instanceof ApiError && err.issues.length > 0 && err.status === 422) {
        const next: Partial<Record<Field, string>> = {};
        const rest: ErrorInfo['issues'] = [];
        for (const i of err.issues) {
          const f = fieldOf(i.path);
          if (f && !next[f]) next[f] = capitalise(i.message);
          else if (!f) rest.push(i);
        }
        setErrors(next);
        if (rest.length) setFormError({ message: err.message, hint: err.hint, issues: rest });
      } else {
        setFormError(toErrorInfo(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const describedBy = (f: Field, hint?: string) => [hint, errors[f] ? `${f}-error` : undefined].filter(Boolean).join(' ') || undefined;
  // Observed: the engine's figure for the chosen candidate at the observed baseline. Assumed: a scenario, a custom
  // intervention, or a figure typed by the owner.
  const chosenDelta = options.find((o) => o.key === choice)?.delta;
  const expectedNumNow = expected.trim() === '' ? null : Number(expected);
  const expectedKind = !s && choice !== CUSTOM && chosenDelta !== undefined && expectedNumNow === chosenDelta ? 'observed' : 'assumed';
  const interventionKind = s || choice === CUSTOM ? 'assumed' : 'observed';
  const draftedFor = options.find((o) => o.key === rec.intervention)?.label ?? rec.label;
  const confidenceWord = CONFIDENCE_KEY[rec.confidence] ? lower(t(CONFIDENCE_KEY[rec.confidence])) : rec.confidence;

  return (
    <form className="card form-card" onSubmit={onSubmit} noValidate>
      <fieldset className="field choice-list" aria-describedby={describedBy('intervention', 'd-intervention-hint')}>
        <legend className="field-label">
          {t('decision.intervention')} {choice ? <Provenance kind={interventionKind} /> : null}
        </legend>
        <p id="d-intervention-hint" className="field-hint">
          {rec.preselect ? 'Pre-selected: the recommendation has high confidence.' : `Not pre-selected: confidence is ${rec.confidence}. ${rec.confidence_reason}`}
        </p>
        {options.map((o) => {
          const isRec = o.key === rec.intervention;
          return (
            <label key={o.key} className={`choice choice-option${choice === o.key ? ' is-selected' : ''}`}>
              <span className="choice-head">
                <input type="radio" name={groupName} value={o.key} checked={choice === o.key} onChange={() => onChoice(o.key)} />
                <span className="choice-title">
                  {o.label}
                  {isRec ? (
                    <Pill tone={rec.preselect ? 'success' : 'primary'} className="choice-rec">
                      {rec.preselect ? t('decision.recommended') : `${t('decision.recommended')} · ${lower(t('scenario.confidence'))} ${confidenceWord}`}
                    </Pill>
                  ) : null}
                </span>
                <span className="choice-meta">
                  <span className={`num ${o.delta > 0 ? 't-gain' : o.delta < 0 ? 't-loss' : 'muted'}`}>{formatSignedInr(o.delta)}</span>
                </span>
              </span>
              <span className="choice-rule">{o.rule}</span>
            </label>
          );
        })}
        <label className={`choice choice-option${choice === CUSTOM ? ' is-selected' : ''}`}>
          <span className="choice-head">
            <input type="radio" name={groupName} value={CUSTOM} checked={choice === CUSTOM} onChange={() => setChoice(CUSTOM)} />
            <span className="choice-title">Custom…</span>
          </span>
        </label>
        {choice === CUSTOM ? (
          <div className="field field-inset">
            <label htmlFor="d-custom" className="field-label">
              Describe the intervention
            </label>
            <input
              id="d-custom"
              className="input"
              type="text"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              aria-invalid={errors.intervention ? true : undefined}
              aria-describedby={describedBy('intervention')}
            />
          </div>
        ) : null}
        <FieldError id="intervention-error" message={errors.intervention} />
      </fieldset>

      <div className="field">
        <span className="field-label-row">
          <label htmlFor="d-expected" className="field-label">
            Expected ₹ impact per period
          </label>
          {expected.trim() !== '' ? <Provenance kind={expectedKind} /> : null}
        </span>
        <span className="num-field num-field-wide">
          <span className="num-affix" aria-hidden="true">
            ₹
          </span>
          <input
            id="d-expected"
            type="number"
            inputMode="decimal"
            step={1}
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            aria-invalid={errors.expected_delta_inr ? true : undefined}
            aria-describedby={describedBy('expected_delta_inr', 'd-expected-hint')}
          />
        </span>
        <p id="d-expected-hint" className="field-hint">
          Filled from the candidate you choose; change it if you expect a different effect.
        </p>
        <FieldError id="expected_delta_inr-error" message={errors.expected_delta_inr} />
      </div>

      <div className="field">
        <span className="field-label-row">
          <span className="field-label" id="d-fixed-label">
            {t('unit.fixedCosts', 'Fixed costs (salaries, rent, tools)')}
          </span>
          <Provenance kind="assumed" />
        </span>
        <p className="field-static" aria-labelledby="d-fixed-label">
          <span className="num">{fixedCosts > 0 ? `${formatInr(fixedCosts)} per period` : `${formatInr(0)} — not set`}</span>{' '}
          <a href={hrefFor('ledger')}>{t('decision.changeOnLedger', 'Change on the ledger')}</a>
          <span className="field-hint"> {t('decision.fixedSaved', 'Saved with the decision when set.')}</span>
        </p>
      </div>

      <div className="draft-row">
        <Button variant="ai" icon="sparkles" onClick={() => void draft()} disabled={drafting}>
          {drafting ? t('actions.drafting') : t('actions.draftTest')}
        </Button>
        <span className="field-hint">
          {draftSource ? (
            <>
              Drafted for {draftedFor} <SourceTag source={draftSource} />
            </>
          ) : (
            'Fills the test and stop rule for the recommended intervention.'
          )}
        </span>
      </div>
      <ErrorNote error={draftError} />

      <div className="field">
        <label htmlFor="d-test" className="field-label">
          {t('decision.test30')} {draftSource ? <SourceTag source={draftSource} /> : null}
        </label>
        <textarea
          id="d-test"
          className="input textarea"
          rows={3}
          value={test}
          onChange={(e) => setTest(e.target.value)}
          aria-invalid={errors.test_30d ? true : undefined}
          aria-describedby={describedBy('test_30d')}
        />
        <FieldError id="test_30d-error" message={errors.test_30d} />
      </div>

      <div className="field">
        <label htmlFor="d-stop" className="field-label">
          {t('decision.stopRule')} {draftSource ? <SourceTag source={draftSource} /> : null}
        </label>
        <textarea
          id="d-stop"
          className="input textarea"
          rows={2}
          value={stop}
          onChange={(e) => setStop(e.target.value)}
          aria-invalid={errors.stop_rule ? true : undefined}
          aria-describedby={describedBy('stop_rule')}
        />
        <FieldError id="stop_rule-error" message={errors.stop_rule} />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="d-owner" className="field-label">
            {t('decision.owner')}
          </label>
          <input
            id="d-owner"
            className="input"
            type="text"
            autoComplete="name"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            aria-invalid={errors.owner ? true : undefined}
            aria-describedby={describedBy('owner')}
          />
          <FieldError id="owner-error" message={errors.owner} />
        </div>
        <div className="field">
          <label htmlFor="d-notes" className="field-label">
            Notes <span className="field-optional">optional</span>
          </label>
          <input
            id="d-notes"
            className="input"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-invalid={errors.notes ? true : undefined}
            aria-describedby={describedBy('notes')}
          />
          <FieldError id="notes-error" message={errors.notes} />
        </div>
      </div>

      <ErrorNote error={formError} />

      <div className="card-actions">
        <Button variant="primary" size="lg" type="submit" icon="check" disabled={saving || drafting} title={drafting ? t('actions.drafting') : undefined}>
          {saving ? t('actions.saving') : t('actions.saveDecision')}
        </Button>
      </div>
    </form>
  );
}

export function DecisionScreen() {
  const { analysis, scenario } = useStore();
  const [version, setVersion] = useState(0);
  const { t } = useTranslation();
  const [saved, setSaved] = useState<{ d: DecisionSaved; expected: number | null } | null>(null);
  const current = analysis && scenario && scenario.analysis_id === analysis.analysis_id ? scenario : null;

  const rec = current?.recommendation ?? analysis?.recommendation ?? null;
  const candidates = current?.candidates ?? analysis?.candidates ?? [];
  const formKey = current?.scenario_id ?? analysis?.analysis_id ?? 'none';

  return (
    <div className="page">
      <PageHeader title={t('decision.pageTitle')} subtitle="Record what to try, who owns it, and when to stop — with the numbers it was based on." />

      {!analysis || !rec ? (
        <NeedsAnalysis sentence="No analysis yet. Load the sample orders, compare a scenario, then save the decision here." icon="check-circle" />
      ) : (
        <>
          <Callout tone="info" title={current ? 'Recorded against the scenario you last ran.' : 'Recorded against the observed baseline; no scenario has been run.'}>
            <p>
              <a href={hrefFor('scenario')}>Change the scenario</a> to update the recommendation and drafts.
            </p>
          </Callout>
          <div className="grid-decision">
            <DecisionForm
              key={formKey}
              a={analysis}
              s={current}
              rec={rec}
              candidates={candidates}
              onSaved={(d, expected) => {
                setSaved({ d, expected });
                setVersion((v) => v + 1);
              }}
            />
            <div className="stack sticky-col">
              {saved ? <SavedSnapshot saved={saved.d} a={analysis} expected={saved.expected} /> : null}
              <Snapshot a={analysis} s={current} />
            </div>
          </div>
        </>
      )}

      <DecisionsList version={version} />
    </div>
  );
}
