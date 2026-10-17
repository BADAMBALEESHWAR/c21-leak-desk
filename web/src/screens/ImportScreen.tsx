import { useEffect, useRef, useState, type DragEvent } from 'react';
import { api, toErrorInfo, type DatasetInput, type ErrorInfo } from '../api/client';
import type { AttributionMode, DatasetResponse, ValidationFlag } from '../api/types';
import { Pill } from '../components/Badge';
import { Button, ButtonLink } from '../components/Button';
import { Icon } from '../components/Icon';
import { AttributionSegmented, Callout, Collapsible, ErrorCallout, InfoTip, revealElement, Skeleton, StatCard } from '../components/ui';
import { compressIds, plural } from '../lib/format';
import { ATTRIBUTION_LABEL, DRILL_TAGS, HEADER_ALIASES } from '../lib/labels';
import { navigate } from '../lib/router';
import { useStore } from '../state/store';

/** Must be present and non-null on every row. */
const REQUIRED_FIELDS: Array<[string, string]> = [
  ['order_id', 'Text, unique per period'],
  ['date', 'YYYY-MM-DD'],
  ['gross_inr', '₹ before discount'],
  ['discount_inr', '₹ discount given'],
  ['product_cost_inr', '₹ landed product cost'],
  ['shipping_inr', '₹ outbound shipping'],
  ['returned', 'true or false'],
];

/** Part of the fixture; may be null or missing, which means unknown. */
const NULLABLE_FIELDS: Array<[string, string]> = [
  ['refund_inr', '₹ refunded to the customer'],
  ['net_sales_inr', '₹ cross-checked: gross − discount − refund'],
  ['recovered_product_cost_inr', '₹ back in stock after a return'],
  ['payment_fee_inr', '₹ payment gateway fee'],
  ['return_cost_inr', '₹ return shipping'],
];

const OPTIONAL_FIELDS: Array<[string, string]> = [
  ['channel', 'Text, sales channel'],
  ['product_id', 'Text, product or SKU'],
  ['ads_inr', '₹ per order, allocate mode'],
  ['handling_inr', '₹ per order; else config default'],
  ['refund_date', 'YYYY-MM-DD; after period end is pending'],
];

const REASON_TAG: Record<ValidationFlag['reason'], string> = {
  duplicate: 'Duplicate',
  late_refund: 'Late refund',
  mismatch: 'Mismatch',
  unknown: 'Unknown',
  invalid: 'Invalid',
  schema: 'Schema',
  rounded: 'Rounded',
};

const REASON_TONE: Record<ValidationFlag['reason'], 'primary' | 'warning' | 'danger' | 'neutral'> = {
  duplicate: 'primary',
  late_refund: 'warning',
  mismatch: 'neutral',
  unknown: 'warning',
  invalid: 'danger',
  schema: 'danger',
  rounded: 'neutral',
};

function Report({ dataset, reveal }: { dataset: DatasetResponse; reveal: boolean }) {
  const dropped = Math.max(0, dataset.rows_in - dataset.rows_kept - dataset.rows_rejected);
  const ref = useRef<HTMLElement>(null);
  const flagsRef = useRef<HTMLDivElement>(null);
  const keptRef = useRef<HTMLDivElement>(null);
  const [flagView, setFlagView] = useState<'all' | 'removed' | 'kept'>('all');
  const [showKept, setShowKept] = useState(false);
  const removedFlags = dataset.flags.filter((f) => f.action !== 'kept');
  const keptFlags = dataset.flags.filter((f) => f.action === 'kept');
  const shownFlags = flagView === 'removed' ? removedFlags : flagView === 'kept' ? keptFlags : dataset.flags;

  const toFlags = (view: 'all' | 'removed') => {
    setFlagView(view);
    window.setTimeout(() => revealElement(flagsRef.current), 0);
  };
  const toKept = () => {
    setShowKept(true);
    window.setTimeout(() => revealElement(keptRef.current), 0);
  };

  // After a load started on this screen, a report that lands below the fold is brought into view (no animated scroll).
  useEffect(() => {
    const el = ref.current;
    if (!el || !reveal) return;
    if (el.getBoundingClientRect().top > window.innerHeight - 160) el.scrollIntoView({ block: 'start' });
  }, [dataset.dataset_id, reveal]);

  return (
    <section ref={ref} className="stack report" aria-labelledby="report-title">
      <div className="section-head">
        <h2 id="report-title" className="section-title">
          Validation report
        </h2>
        <span className="section-meta">
          {dataset.source} · period end {dataset.period_end}
          {dataset.schema_version ? ` · schema ${dataset.schema_version}` : ''}
        </span>
      </div>
      <div className="kpi-grid kpi-grid-4">
        <StatCard
          label="Rows in"
          value={dataset.rows_in}
          icon="file"
          sub="Every row read from the file"
          actionIcon="arrow-right"
          onClick={() => (dataset.flags.length > 0 ? toFlags('all') : toKept())}
          actionLabel={`Rows in ${dataset.rows_in} — ${dataset.flags.length > 0 ? 'show the flagged rows' : 'show the kept order ids'}`}
        />
        <StatCard
          label="Kept"
          value={dataset.rows_kept}
          icon="check-circle"
          tone="success"
          sub={dataset.kept_ids.length > 60 ? `${compressIds(dataset.kept_ids.slice(0, 60))} …` : compressIds(dataset.kept_ids)}
          actionIcon="arrow-right"
          onClick={toKept}
          actionLabel={`Kept ${dataset.rows_kept} rows — show the kept order ids`}
        />
        <StatCard
          label="Dropped / rejected"
          value={`${dropped} / ${dataset.rows_rejected}`}
          icon="x"
          tone={dropped + dataset.rows_rejected > 0 ? 'danger' : 'default'}
          sub={dropped + dataset.rows_rejected > 0 ? 'Not in the analysis' : 'Every row was usable'}
          actionIcon="arrow-right"
          onClick={() => (removedFlags.length > 0 ? toFlags('removed') : toKept())}
          actionLabel={`Dropped ${dropped}, rejected ${dataset.rows_rejected} — ${removedFlags.length > 0 ? 'filter the flagged rows to dropped and rejected' : 'show the kept order ids'}`}
        />
        <StatCard
          label="Flags"
          value={dataset.flags.length}
          icon="alert-triangle"
          tone={dataset.flags.length > 0 ? 'warning' : 'default'}
          sub={dataset.synthetic_rows > 0 ? `${dataset.synthetic_rows} labelled synthetic ${plural(dataset.synthetic_rows, 'row', 'rows')}` : 'Observed rows only'}
          actionIcon="arrow-right"
          onClick={() => (dataset.flags.length > 0 ? toFlags('all') : toKept())}
          actionLabel={`Flags ${dataset.flags.length} — show the flagged rows`}
        />
      </div>

      {showKept ? (
        <div className="card kept-card reveal-target" ref={keptRef} tabIndex={-1} aria-labelledby="kept-title">
          <div className="table-card-head kept-head">
            <h3 id="kept-title" className="card-title">
              Kept order ids
            </h3>
            <span className="muted small">{dataset.kept_ids.length} rows go into the analysis</span>
          </div>
          <div className="id-chips">
            {dataset.kept_ids.slice(0, 300).map((id) => (
              <span key={id} className="pill pill-outline">
                {id}
              </span>
            ))}
            {dataset.kept_ids.length > 300 ? <span className="muted small">and {dataset.kept_ids.length - 300} more</span> : null}
          </div>
        </div>
      ) : null}

      {dataset.flags.length > 0 ? (
        <div className="card table-card reveal-target" ref={flagsRef} tabIndex={-1}>
          <div className="table-card-head">
            <h3 className="card-title">Flagged rows</h3>
            <div className="chips" role="group" aria-label="Filter flagged rows">
              {(
                [
                  ['all', 'All flags', dataset.flags.length],
                  ['removed', 'Dropped or rejected', removedFlags.length],
                  ['kept', 'Kept with a flag', keptFlags.length],
                ] as Array<['all' | 'removed' | 'kept', string, number]>
              ).map(([id, label, n]) => (
                <button key={id} type="button" className={`chip-filter${flagView === id ? ' is-on' : ''}`} aria-pressed={flagView === id} onClick={() => setFlagView(id)}>
                  {label}
                  <span className="chip-count">{n}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="table-scroll">
            <table className="table">
              <caption className="visually-hidden">Validation flags with line, detail, reason and action</caption>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Detail</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {shownFlags.slice(0, 100).map((f, i) => (
                  <tr key={`${f.line}-${f.reason}-${f.field ?? ''}-${i}`}>
                    <th scope="row" className="cell-stack">
                      <span>{f.order_id ?? '—'}</span>
                      <span className="cell-sub">line {f.line}</span>
                    </th>
                    <td className="cell-wrap">{f.detail}</td>
                    <td>
                      <Pill tone={REASON_TONE[f.reason] ?? 'neutral'} dot>
                        {REASON_TAG[f.reason] ?? f.reason}
                      </Pill>
                    </td>
                    <td>
                      <Pill tone={f.action === 'kept' ? 'warning' : 'danger'}>{f.action}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shownFlags.length > 100 ? <p className="table-foot">Showing the first 100 of {shownFlags.length} flags.</p> : null}
        </div>
      ) : (
        <Callout tone="success" title="No rows flagged." />
      )}

      {dataset.warnings.length > 0 ? (
        <Callout tone="info" title="Warnings">
          <ul className="plain-list">
            {dataset.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
    </section>
  );
}

function SchemaList({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div>
      <h3 className="mini-title">{title}</h3>
      <dl className="kv kv-schema">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>
              <code>{k}</code>
            </dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ImportScreen() {
  const { samples, dataset, datasetId, analysis, importDataset, runAnalysis, analysing, importError, setImportError } = useStore();
  const [validating, setValidating] = useState<string | null>(null);
  // Shared with deep links, so a failed load always lands under the drop zone.
  const loadError = importError;
  const setLoadError = setImportError;
  const [attribution, setAttribution] = useState<AttributionMode>(analysis?.attribution ?? 'allocate');
  const [periodEnd, setPeriodEnd] = useState<string>(dataset?.period_end ?? analysis?.period_end ?? '');
  const [continueError, setContinueError] = useState<ErrorInfo | null>(null);
  const [handling, setHandling] = useState<string>(analysis && analysis.config.handling_default_inr > 0 ? String(analysis.config.handling_default_inr) : '0');
  const [dragOver, setDragOver] = useState(false);
  const [loadedHere, setLoadedHere] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dataset) setPeriodEnd(dataset.period_end);
  }, [dataset]);

  useEffect(() => {
    if (!dataset && analysis) {
      setPeriodEnd(analysis.period_end);
      setAttribution(analysis.attribution);
      setHandling(String(analysis.config.handling_default_inr ?? 0));
    }
  }, [dataset, analysis]);

  const load = async (input: DatasetInput, what: string) => {
    setValidating(what);
    setLoadError(null);
    setContinueError(null);
    try {
      await importDataset(input);
      setLoadedHere(true);
    } catch {
      // importDataset has already recorded the error for the drop zone.
    } finally {
      setValidating(null);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!/\.(json|csv)$/i.test(file.name)) {
      setLoadError({
        message: `${file.name} is not JSON or CSV.`,
        hint: 'Export the orders as fixture-format JSON or as CSV with the same column names.',
        issues: [],
      });
      return;
    }
    void load(file, file.name);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    onFile(e.dataTransfer.files?.[0]);
  };

  const onContinue = async () => {
    const id = dataset?.dataset_id ?? datasetId;
    if (!id) return;
    setContinueError(null);
    const h = handling.trim() === '' ? 0 : Number(handling);
    if (!Number.isFinite(h) || h < 0) {
      setContinueError({ message: 'Handling per order must be a rupee amount of 0 or more.', hint: 'Leave it at 0 when rows carry their own handling_inr.', issues: [] });
      return;
    }
    try {
      await runAnalysis(attribution, periodEnd || undefined, id, h);
      navigate('ledger');
    } catch (err) {
      setContinueError(toErrorInfo(err));
    }
  };

  const drills = samples.filter((s) => s.source !== 'fixture' && s.source !== 'extended');
  const busy = validating !== null;
  const canContinue = (dataset ? dataset.rows_kept > 0 : datasetId !== null) && !busy && !analysing;

  return (
    <div className="page">
      <section className="hero card" aria-labelledby="import-title">
        <div className="hero-text">
          <span className="pill pill-outline hero-kicker">
            <Icon name="upload-cloud" size={14} /> Step 1 of 5
          </span>
          <h1 id="import-title" className="hero-title">
            Import order economics
          </h1>
          <p className="hero-sub">Load the C21 fixture or drop a file in the same schema. Every row is validated before anything is counted.</p>
          <div className="hero-actions">
            <Button variant="primary" size="lg" onClick={() => void load({ source: 'fixture' }, 'fixture')} disabled={busy}>
              {validating === 'fixture' ? 'Loading…' : 'Load C21 fixture'}
            </Button>
            <Button variant="secondary" size="lg" onClick={() => void load({ source: 'extended' }, 'extended')} disabled={busy}>
              {validating === 'extended' ? 'Loading…' : 'Load fixture + synthetic rows'}
            </Button>
          </div>
        </div>
        <dl className="hero-stats">
          <div>
            <dt>reference orders</dt>
            <dd>20</dd>
          </div>
          <div>
            <dt>fixture fields</dt>
            <dd>12</dd>
          </div>
          <div>
            <dt>judge drills</dt>
            <dd>{drills.length}</dd>
          </div>
        </dl>
      </section>

      <div className="grid-import">
        <div className="stack">
          <div
            className={`card dropzone${dragOver ? ' is-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <span className="dropzone-icon" aria-hidden="true">
              <Icon name="upload-cloud" size={24} />
            </span>
            <p className="dropzone-title">Drag and drop a JSON or CSV file</p>
            <p className="dropzone-sub">Fixture-format JSON or CSV with the C21 column names · up to 5 MB</p>
            <span className="dropzone-actions">
              <Button variant="secondary" icon="file" onClick={() => fileRef.current?.click()} disabled={busy}>
                Browse files
              </Button>
              <ButtonLink variant="ghost" icon="download" href={api.templateUrl()} download="c21-template.csv">
                Download CSV template
              </ButtonLink>
            </span>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.csv,application/json,text/csv"
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          <p className="alias-note" title={HEADER_ALIASES.map(([a, b]) => `${a} → ${b}`).join(', ')}>
            Header aliases accepted: {HEADER_ALIASES.map(([a]) => a).join(', ')} …
          </p>
          <ErrorCallout error={loadError} className="error-under-drop" />
        </div>

        <section className="card options-card" aria-labelledby="options-title">
          <h2 id="options-title" className="card-title">
            Analysis options
          </h2>
          <div className="field">
            <span className="field-label" id="attr-label">
              Attribution <InfoTip text={ATTRIBUTION_LABEL} label="About attribution" />
            </span>
            <AttributionSegmented value={attribution} onChange={setAttribution} compact />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="period-end">
              Period as-of date{' '}
              <InfoTip text="Refunds dated after this day stay in the period as kept orders and are shown as pending." label="About the period date" />
            </label>
            <input id="period-end" type="date" className="input input-date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="handling-default">
              Handling per order (estimate){' '}
              <InfoTip text="Used only for rows without handling_inr. Labelled as an estimate everywhere." label="About handling per order" />
            </label>
            <span className="num-field num-field-wide">
              <span className="num-affix" aria-hidden="true">
                ₹
              </span>
              <input id="handling-default" type="number" inputMode="decimal" min={0} step={1} value={handling} onChange={(e) => setHandling(e.target.value)} />
            </span>
          </div>
          <Button variant="primary" size="lg" className="btn-block" iconRight="arrow-right" onClick={() => void onContinue()} disabled={!canContinue}>
            {analysing ? 'Analysing…' : 'Continue to ledger'}
          </Button>
          {!dataset && !datasetId ? <p className="muted small">Load a sample or a file first.</p> : null}
          <ErrorCallout error={continueError} />
        </section>
      </div>

      <div aria-live="polite">
        {validating ? (
          <div className="stack" role="status" aria-label="Validating">
            <p className="loading-line">
              <span className="spinner" aria-hidden="true" /> Validating…
            </p>
            <div className="kpi-grid kpi-grid-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="card kpi">
                  <Skeleton width="50%" height={12} />
                  <Skeleton width="40%" height={28} className="skeleton-gap" />
                </div>
              ))}
            </div>
          </div>
        ) : loadError ? (
          dataset ? <p className="muted small">Nothing was imported. The previous dataset ({dataset.source}) is still loaded.</p> : null
        ) : dataset ? (
          <Report dataset={dataset} reveal={loadedHere} />
        ) : datasetId ? (
          <Callout tone="info" title={`Dataset ${datasetId} is loaded from the last session.`}>
            <p>Load a sample or a file to see its validation report.</p>
          </Callout>
        ) : null}
      </div>

      <section className="stack" aria-labelledby="drills-title">
        <div className="section-head">
          <h2 id="drills-title" className="section-title">
            Judge drills
          </h2>
          <span className="section-meta">Negative tests; each one loads a sample and shows how the desk reacts.</span>
        </div>
        <div className="drill-grid">
          {drills.map((s) => {
            const tag = DRILL_TAGS[s.source] ?? { tag: 'Drill', tone: 'primary' as const };
            return (
              <button key={s.source} type="button" className="card drill" onClick={() => void load({ source: s.source }, s.source)} disabled={busy}>
                <span className="drill-top">
                  <Pill tone={tag.tone} dot>
                    {tag.tag}
                  </Pill>
                  <Icon name="arrow-up-right" size={18} className="drill-arrow" />
                </span>
                <span className="drill-title">{validating === s.source ? 'Loading…' : s.label}</span>
                <span className="drill-text">{s.description}</span>
              </button>
            );
          })}
        </div>
      </section>

      <Collapsible title="View the C21 schema" meta="7 required · 5 nullable · 5 optional">
        <div className="schema-grid">
          <SchemaList title="Required" rows={REQUIRED_FIELDS} />
          <SchemaList title="May be null (unknown)" rows={NULLABLE_FIELDS} />
          <div>
            <SchemaList title="Optional synthetic fields" rows={OPTIONAL_FIELDS} />
            <h3 className="mini-title">Suffix rules</h3>
            <p className="small muted">
              <code>_inr</code> rupees · <code>_pct</code> 0–100 · <code>_units</code> counts · <code>_days</code> calendar days. Null means
              unknown, never zero. Rows added for the demo carry <code>synthetic: true</code>; header variants such as cogs, sku and gateway_fee
              are mapped.
            </p>
          </div>
        </div>
      </Collapsible>
    </div>
  );
}
