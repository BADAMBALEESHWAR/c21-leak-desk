import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { api, ApiError, authDownload, toErrorInfo, type ErrorInfo } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { AnalysisResponse, Candidate, DecisionRequest, DecisionSaved, DecisionSummary, OverrideKey, Recommendation, ScenarioResponse, TextSource } from '../api/types';
import { ConfidenceBadge, Pill, SourceTag } from '../components/Badge';
import { Button, ButtonLink } from '../components/Button';
import { NeedsAnalysis } from '../components/EmptyState';
import { ErrorNote } from '../components/ErrorNote';
import { Icon } from '../components/Icon';
import { Money } from '../components/Money';
import { PageHeader } from '../components/Page';
import { Table, type Column } from '../components/Table';
import { Callout } from '../components/ui';
import { capitalise, formatDateTime, formatInr, formatPct, formatSignedInr } from '../lib/format';
import { OVERRIDE_LABELS } from '../lib/labels';
import { hrefFor, navigate } from '../lib/router';
import { useStore } from '../state/store';

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
    { id: 'saved', header: 'Saved', rowHeader: true, className: 'col-nowrap', cell: (d) => <span className="num">{formatDateTime(d.saved_at)}</span> },
    { id: 'intervention', header: 'Intervention', cell: (d) => d.intervention_label || d.intervention },
    { id: 'expected', header: 'Expected ₹', align: 'right', cell: (d) => <Money value={d.expected_delta_inr} tone="contribution" /> },
    {
      id: 'confidence',
      header: 'Confidence',
      cell: (d) => (d.confidence === 'custom' ? <Pill tone="neutral">custom</Pill> : <ConfidenceBadge confidence={d.confidence} />),
    },
    { id: 'owner', header: 'Owner', cell: (d) => d.owner },
    {
      id: 'export',
      header: 'Export',
      className: 'col-nowrap',
      cell: (d) => (
        <span className="export-links">
          <ButtonLink variant="secondary" size="sm" icon="download" href={api.exportUrl(d.decision_id, 'md')} download onClick={authDownload(api.exportUrl(d.decision_id, 'md'), `decision-${d.decision_id}.md`, onDownloadError)}>
            Export Markdown
          </ButtonLink>
          <ButtonLink variant="secondary" size="sm" icon="download" href={api.exportUrl(d.decision_id, 'json')} download onClick={authDownload(api.exportUrl(d.decision_id, 'json'), `decision-${d.decision_id}.json`, onDownloadError)}>
            Export JSON
          </ButtonLink>
        </span>
      ),
    },
  ];

  return (
    <section className="card table-card" aria-labelledby="decisions-title">
      <div className="table-card-head">
        <h2 id="decisions-title" className="card-title">
          Saved decisions
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
  const { focusLedgerTable } = useStore();
  const contributionText = a.totals.contribution_inr === null ? 'unknown' : formatInr(a.totals.contribution_inr);
  return (
    <section className="card snapshot-card" aria-labelledby="snapshot-title">
      <h2 id="snapshot-title" className="card-title">
        Assumptions snapshot
      </h2>
      <div className="mini-kpis">
        <button type="button" className="card-action" onClick={() => navigate('ledger')} aria-label={`Contribution ${contributionText} — open the ledger`}>
          <span>Contribution</span>
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
          <dd>{s ? overrideText(s.overrides as Record<string, unknown>) : 'nothing (observed baseline)'}</dd>
        </div>
        <div>
          <dt>Return rate</dt>
          <dd>{formatPct(a.observed.return_rate_pct)} observed</dd>
        </div>
        <div>
          <dt>Recovery</dt>
          <dd>{a.observed.recovery_pct === null ? 'unknown' : `${formatPct(a.observed.recovery_pct)} observed`}</dd>
        </div>
        <div>
          <dt>Handling</dt>
          <dd>{formatInr(a.config.handling_default_inr)} default</dd>
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

function SavedSnapshot({ saved }: { saved: DecisionSaved }) {
  const account = useAuth().mode === 'account';
  const entries = Object.entries({ ...saved.assumptions, engine_version: saved.engine_version }).filter(([k]) => k in SNAPSHOT_KEYS);
  return (
    <section className="card saved-card" aria-labelledby="saved-title">
      <div className="card-head">
        <span className="icon-chip icon-chip-success" aria-hidden="true">
          <Icon name="check-circle" size={18} />
        </span>
        <div>
          <h2 id="saved-title" className="card-title">
            Decision saved
          </h2>
          <p className="card-sub">
            {formatDateTime(saved.saved_at)} · {saved.persisted === false ? (account ? 'not saved: the database is unavailable' : 'demo workspace, not kept') : account ? 'saved to your account' : 'saved'}
          </p>
        </div>
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
  onSaved: (d: DecisionSaved) => void;
}

function DecisionForm({ a, s, rec, candidates, onSaved }: FormProps) {
  const { showToast, markDecisionSaved } = useStore();
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
    setErrors({});
    setFormError(null);
    const intervention = choice === CUSTOM ? custom.trim() : choice;
    const exp = expected.trim();
    const expectedNum = exp === '' ? null : Number(exp);
    if (expectedNum !== null && !Number.isFinite(expectedNum)) {
      setErrors({ expected_delta_inr: 'Enter the expected change in rupees, for example 480, or leave it blank.' });
      return;
    }
    const body: DecisionRequest = {
      ...(s ? { scenario_id: s.scenario_id } : {}),
      intervention,
      expected_delta_inr: expectedNum,
      test_30d: test,
      stop_rule: stop,
      owner,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    setSaving(true);
    try {
      const saved = await api.createDecision(a.analysis_id, body);
      showToast('Decision saved');
      markDecisionSaved(a.analysis_id);
      onSaved(saved);
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
  const draftedFor = options.find((o) => o.key === rec.intervention)?.label ?? rec.label;

  return (
    <form className="card form-card" onSubmit={onSubmit} noValidate>
      <fieldset className="field choice-list" aria-describedby={describedBy('intervention', 'd-intervention-hint')}>
        <legend className="field-label">Intervention</legend>
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
                      {rec.preselect ? 'Recommended' : `Recommended · confidence ${rec.confidence}`}
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
        <label htmlFor="d-expected" className="field-label">
          Expected ₹ impact per period
        </label>
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

      <div className="draft-row">
        <Button variant="ai" icon="sparkles" onClick={() => void draft()} disabled={drafting}>
          {drafting ? 'Drafting…' : 'Draft 30-day test'}
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
          30-day test {draftSource ? <SourceTag source={draftSource} /> : null}
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
          Stop rule {draftSource ? <SourceTag source={draftSource} /> : null}
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
            Owner
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
        <Button variant="primary" size="lg" type="submit" icon="check" disabled={saving}>
          {saving ? 'Saving…' : 'Save decision'}
        </Button>
      </div>
    </form>
  );
}

export function DecisionScreen() {
  const { analysis, scenario } = useStore();
  const [version, setVersion] = useState(0);
  const [saved, setSaved] = useState<DecisionSaved | null>(null);
  const current = analysis && scenario && scenario.analysis_id === analysis.analysis_id ? scenario : null;

  const rec = current?.recommendation ?? analysis?.recommendation ?? null;
  const candidates = current?.candidates ?? analysis?.candidates ?? [];
  const formKey = current?.scenario_id ?? analysis?.analysis_id ?? 'none';

  return (
    <div className="page">
      <PageHeader title="Save the decision" subtitle="Record what to try, who owns it, and when to stop — with the numbers it was based on." />

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
              onSaved={(d) => {
                setSaved(d);
                setVersion((v) => v + 1);
              }}
            />
            <div className="stack sticky-col">
              {saved ? <SavedSnapshot saved={saved} /> : null}
              <Snapshot a={analysis} s={current} />
            </div>
          </div>
        </>
      )}

      <DecisionsList version={version} />
    </div>
  );
}
