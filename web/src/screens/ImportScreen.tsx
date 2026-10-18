import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, toErrorInfo, type DatasetInput, type DatasetOptions, type ErrorInfo } from '../api/client';
import type { AttributionMode, DatasetResponse, OrderResult, RowCorrection, ValidationFlag, WorkspaceDataset } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Pill } from '../components/Badge';
import { Button, ButtonLink } from '../components/Button';
import { Drawer } from '../components/Drawer';
import { Icon } from '../components/Icon';
import { Integrations } from '../components/Integrations';
import { Money } from '../components/Money';
import { Provenance } from '../components/Provenance';
import { AttributionSegmented, Callout, Collapsible, ErrorCallout, InfoTip, revealElement, Skeleton, StatCard } from '../components/ui';
import { compressIds, formatCount, formatDate, formatInr, plural } from '../lib/format';
import { ATTRIBUTION_TIP_EN, ATTRIBUTION_TIP_KEY, datasetName, DRILL_TAGS, HEADER_ALIASES } from '../lib/labels';
import { navigate } from '../lib/router';
import { useStore } from '../state/store';

/** Files merged in one upload (the API's limit: a year of monthly exports). */
const MAX_FILES = 12;

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

/** May be null or missing, which means unknown. */
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

/** Translation keys for the reason pills. */
const REASON_TAG: Record<ValidationFlag['reason'], string> = {
  duplicate: 'status.duplicate',
  late_refund: 'status.lateRefund',
  mismatch: 'status.mismatch',
  unknown: 'status.unknown',
  invalid: 'status.invalid',
  schema: 'status.schema',
  rounded: 'status.rounded',
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

/** The result line after an upload that was added to saved data. */
interface UploadNote {
  tone: 'success' | 'info';
  title: string;
  detail: string | null;
}

function noteFor(ds: DatasetResponse, target: string | null): UploadNote | null {
  if (ds.unchanged) {
    const n = ds.duplicates_ignored ?? ds.rows_in;
    return {
      tone: 'info',
      title: ds.message ?? `Nothing new: all ${formatCount(n)} orders were already saved.`,
      detail: target ? `${target} is unchanged.` : null,
    };
  }
  if (!ds.appended_to) return null;
  const added = ds.rows_added ?? 0;
  const skipped = ds.duplicates_ignored ?? 0;
  return {
    tone: 'success',
    title: `Added ${formatCount(added)} new ${plural(added, 'order', 'orders')} · ${skipped > 0 ? `${formatCount(skipped)} already saved, skipped` : 'none were already saved'}`,
    detail: `${formatCount(ds.rows_kept)} ${plural(ds.rows_kept, 'order', 'orders')} saved together now. Run the analysis to see the new totals.`,
  };
}

/** The paid sample audit opens only when a payment link is configured at build time. */
const AUDIT_LINK = (import.meta.env.VITE_RAZORPAY_LINK ?? '').trim();

interface FailedRow {
  key: string;
  line: string;
  order: string | null;
  field: string;
  reason: string;
}

/** "records.orders[3].gross_inr" -> gross_inr; "product_cost_inr" -> product_cost_inr. */
function fieldOfPath(path: string | undefined | null): string {
  if (!path) return '';
  const parts = path.split(/[.[\]]+/).filter((x) => x && !/^\d+$/.test(x));
  const last = parts[parts.length - 1] ?? '';
  return last === 'orders' || last === 'records' ? '' : last;
}

/** A line number from an issue path or message ("line 4", "row 4"); a JSON index counts the header-less record. */
function lineOfIssue(path: string, message: string): string {
  const m = /\b(?:line|row)\s*(\d+)/i.exec(`${path} ${message}`);
  if (m) return m[1];
  const idx = /\[(\d+)\]/.exec(path);
  return idx ? String(Number(idx[1]) + 1) : '';
}

/** Every failed row: line, field and reason, with the CSV template one click away. The page never goes blank. */
function ValidationPanel({ title, sub, rows, tone = 'danger' }: { title: string; sub?: ReactNode; rows: FailedRow[]; tone?: 'danger' | 'warning' }) {
  const { t } = useTranslation();
  return (
    <section className={`card vpanel vpanel-${tone}`} aria-labelledby="vpanel-title" role="region">
      <div className="vpanel-head">
        <div className="card-head">
          <span className={`icon-chip icon-chip-${tone}`} aria-hidden="true">
            <Icon name="alert-triangle" size={18} />
          </span>
          <div>
            <h3 id="vpanel-title" className="card-title">
              {title}
            </h3>
            {sub ? <p className="card-sub">{sub}</p> : null}
          </div>
        </div>
        <ButtonLink variant="secondary" size="sm" icon="download" href={api.templateUrl()} download="profyn-orders-template.csv">
          {t('actions.downloadTemplate')}
        </ButtonLink>
      </div>
      {rows.length > 0 ? (
        <div className="table-scroll">
          <table className="table">
            <caption className="visually-hidden">{t('import.failedCaption', 'Failed rows with line number, field and reason')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('import.line', 'Line')}</th>
                <th scope="col">{t('ledger.order')}</th>
                <th scope="col">{t('import.field', 'Field')}</th>
                <th scope="col">{t('import.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((r) => (
                <tr key={r.key}>
                  <th scope="row" className="num">
                    {r.line || '—'}
                  </th>
                  <td>{r.order ?? '—'}</td>
                  <td className="vpanel-field">{r.field ? <code>{r.field}</code> : <span className="cell-muted">{t('import.wholeRow', 'whole row')}</span>}</td>
                  <td className="cell-wrap">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {rows.length > 200 ? <p className="table-foot">{t('import.first200', 'Showing the first 200 of {{n}}.', { n: formatCount(rows.length) })}</p> : null}
    </section>
  );
}

/** A file problem (the API's field issues, or a hint that points at the template), not a network or server failure. */
function isFileProblem(error: ErrorInfo): boolean {
  return error.issues.length > 0 || /template|column|JSON or CSV/i.test(`${error.hint ?? ''} ${error.message}`);
}

/** A load the API refused (bad schema, wrong type, nothing valid): the same panel, from the error's issues. */
function LoadErrorPanel({ error }: { error: ErrorInfo }) {
  const { t } = useTranslation();
  // The API could not be reached, or failed: say so plainly; there are no rows to fix.
  if (!isFileProblem(error)) return <ErrorCallout error={error} className="error-under-drop" />;
  const rows: FailedRow[] = error.issues.map((i, n) => ({
    key: `${i.path}-${n}`,
    line: lineOfIssue(i.path, i.message) || (/column|header/i.test(i.message) ? t('import.header', 'header') : ''),
    order: null,
    field: fieldOfPath(i.path),
    reason: i.message,
  }));
  return (
    <ValidationPanel
      title={error.message}
      sub={
        <>
          {error.hint ? `${error.hint} ` : ''}
          {rows.length > 0
            ? t('import.nothingImported', 'Nothing from this file was imported; fix the rows below or start from the CSV template.')
            : t('import.nothingImportedNoRows', 'Nothing from this file was imported; start from the CSV template.')}
        </>
      }
      rows={rows}
    />
  );
}

// ---- Editing a flagged row ----------------------------------------------------------------

/** One Edit target: an order (all its flags together) or, without an order id, one line. */
interface EditTarget {
  key: string;
  orderId: string | null;
  line: number;
  flags: ValidationFlag[];
}

const editLabel = (orderId: string | null, line: number) => orderId ?? `line ${line}`;

/** The field a flag is about; a duplicate is about its order id. */
function flagField(f: ValidationFlag): string {
  return f.field ?? (fieldOfPath(f.path) || (f.reason === 'duplicate' ? 'order_id' : ''));
}

type FieldKind = 'money' | 'date' | 'bool' | 'text';
const kindOfField = (field: string): FieldKind =>
  field.endsWith('_inr') ? 'money' : field === 'date' || field.endsWith('_date') ? 'date' : field === 'returned' || field === 'synthetic' ? 'bool' : 'text';

/** Where the analysis keeps each field of the order, for the current value of a kept row. */
const INPUT_OF: Record<string, keyof OrderResult['inputs']> = {
  gross_inr: 'gross',
  discount_inr: 'discount',
  refund_inr: 'refund',
  product_cost_inr: 'product_cost',
  recovered_product_cost_inr: 'recovered',
  shipping_inr: 'shipping',
  payment_fee_inr: 'fee',
  return_cost_inr: 'return_cost',
  handling_inr: 'handling',
  ads_inr: 'ads',
};

function currentValue(field: string, target: EditTarget, raw: Record<string, unknown> | null, order: OrderResult | null): unknown {
  if (raw && field in raw) return raw[field];
  if (!order) return null;
  if (INPUT_OF[field]) return order.inputs[INPUT_OF[field]];
  if (field === 'refund_date') return order.refund_date;
  if (field === 'date') return order.date;
  if (field === 'returned') return order.returned;
  if (field === 'channel' || field === 'product_id' || field === 'order_id') return (order as unknown as Record<string, unknown>)[field] ?? target.orderId;
  return null;
}

const asText = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

function parseField(kind: FieldKind, s: string): { value: string | number | boolean | null; ok: boolean } {
  const v = s.trim();
  if (v === '') return { value: null, ok: true };
  if (kind === 'money') {
    const n = Number(v);
    return Number.isFinite(n) ? { value: n, ok: true } : { value: null, ok: false };
  }
  if (kind === 'bool') return { value: v === 'true', ok: v === 'true' || v === 'false' };
  return { value: v, ok: true };
}

function shown(kind: FieldKind, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'unknown';
  if (kind === 'money' && typeof v === 'number') return formatInr(v);
  return String(v);
}

function RowEditor({ target, onClose }: { target: EditTarget; onClose: () => void }) {
  const { t } = useTranslation();
  const { dataset, analysis, correctRow, showToast } = useStore();
  const id = editLabel(target.orderId, target.line);
  const raw =
    dataset?.rejected_rows?.find((r) => r.line === target.line && (!target.orderId || !r.order_id || r.order_id === target.orderId))?.raw ??
    (target.orderId ? dataset?.rejected_rows?.find((r) => r.order_id === target.orderId)?.raw : undefined) ??
    null;
  const order =
    analysis && dataset && analysis.dataset_id === dataset.dataset_id && target.orderId
      ? analysis.orders.find((o) => o.order_id === target.orderId) ?? analysis.late_refunds.orders.find((o) => o.order_id === target.orderId) ?? null
      : null;
  const flagged = [...new Set(target.flags.map(flagField).filter(Boolean))];
  const fields = flagged.length > 0 ? flagged : raw ? Object.keys(raw) : [];
  const initial = Object.fromEntries(fields.map((f) => [f, currentValue(f, target, raw, order)]));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f, asText(initial[f])])));
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<ErrorInfo | null>(null);
  const [saving, setSaving] = useState(false);

  const changes: Record<string, string | number | boolean | null> = {};
  const invalid: Record<string, string> = {};
  for (const f of fields) {
    const kind = kindOfField(f);
    const parsed = parseField(kind, values[f] ?? '');
    if (!parsed.ok) {
      invalid[f] = kind === 'money' ? t('import.editMoneyInvalid', 'Enter a rupee amount, for example 200, or leave it empty for unknown.') : t('import.editInvalid', 'Enter a valid value.');
      continue;
    }
    const before = initial[f] === undefined || initial[f] === '' ? null : initial[f];
    if (parsed.value !== before && String(parsed.value) !== String(before)) changes[f] = parsed.value;
  }
  const canSave = Object.keys(changes).length > 0 && Object.keys(invalid).length === 0 && !saving;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      await correctRow({
        ...(target.orderId ? { order_id: target.orderId } : {}),
        line: target.line,
        changes,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      const what = Object.entries(changes)
        .map(([f, v]) => `${f}: ${shown(kindOfField(f), initial[f])} → ${shown(kindOfField(f), v)}`)
        .join('; ');
      showToast(t('import.editToast', 'Corrected {{id}} · {{changes}}. Saved as a new version; the original is kept.', { id, changes: what }));
      onClose();
    } catch (err) {
      const info = toErrorInfo(err);
      const next: Record<string, string> = {};
      const paths = [...info.issues.map((i) => ({ path: i.path, message: i.message })), ...(err instanceof ApiError && err.path ? [{ path: err.path, message: info.message }] : [])];
      for (const p of paths) {
        const f = fields.find((x) => p.path === x || p.path.endsWith(`.${x}`) || fieldOfPath(p.path) === x);
        if (f && !next[f]) next[f] = p.message;
      }
      if (Object.keys(next).length === 0 && fields.length === 1 && err instanceof ApiError && err.status === 422) next[fields[0]] = info.message;
      setErrors(next);
      if (Object.keys(next).length === 0) setFormError(info);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="row-editor" onSubmit={save} noValidate>
      <div className="row-editor-reasons">
        {target.flags.map((f, i) => (
          <p key={`${f.line}-${f.reason}-${i}`} className="row-editor-reason">
            <Pill tone={REASON_TONE[f.reason] ?? 'neutral'} dot>
              {REASON_TAG[f.reason] ? t(REASON_TAG[f.reason]) : f.reason}
            </Pill>
            <span>{f.detail}</span>
          </p>
        ))}
      </div>
      {raw ? (
        <div className="row-editor-raw">
          <h3 className="section-label">{t('import.editRaw', 'Row as read from the file (line {{line}})', { line: target.line })}</h3>
          <dl className="kv">
            {Object.entries(raw).map(([k, v]) => (
              <div key={k}>
                <dt>
                  <code>{k}</code>
                </dt>
                <dd>{asText(v) || <span className="cell-muted">{t('import.editEmpty', 'empty')}</span>}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {fields.length === 0 ? <p className="muted small">{t('import.editNoField', 'This flag names no single field; fix the row in the file and upload it again.')}</p> : null}
      {fields.map((f) => {
        const kind = kindOfField(f);
        const inputId = `edit-${f}`;
        const err = errors[f] ?? invalid[f];
        return (
          <div className="field" key={f}>
            <label className="field-label" htmlFor={inputId}>
              <code>{f}</code>
            </label>
            {kind === 'money' ? (
              <span className="num-field num-field-wide">
                <span className="num-affix" aria-hidden="true">
                  ₹
                </span>
                <input
                  id={inputId}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  placeholder={t('import.editUnknown', 'unknown')}
                  value={values[f] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={err ? `${inputId}-error` : undefined}
                />
              </span>
            ) : kind === 'bool' ? (
              <select id={inputId} className="input" value={values[f] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))} aria-invalid={err ? true : undefined} aria-describedby={err ? `${inputId}-error` : undefined}>
                <option value="">{t('import.editUnknown', 'unknown')}</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                id={inputId}
                className={`input${kind === 'date' ? ' input-date' : ''}`}
                type={kind === 'date' ? 'date' : 'text'}
                placeholder={t('import.editUnknown', 'unknown')}
                value={values[f] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
                aria-invalid={err ? true : undefined}
                aria-describedby={err ? `${inputId}-error` : undefined}
              />
            )}
            {err ? (
              <p id={`${inputId}-error`} className="field-error" role="alert">
                <Icon name="alert-triangle" size={14} /> {err}
              </p>
            ) : (
              <p className="field-hint">
                {t('import.editWas', 'In the data now: {{value}}', { value: shown(kind, initial[f]) })}
              </p>
            )}
          </div>
        );
      })}
      <div className="field">
        <label className="field-label" htmlFor="edit-note">
          {t('import.editNote', 'Note')} <span className="field-optional">{t('import.editOptional', 'optional')}</span>
        </label>
        <input id="edit-note" className="input" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('import.editNotePlaceholder', 'Why the value changed, e.g. checked against the courier report')} />
      </div>
      <p className="field-hint">
        <Provenance kind="corrected" /> {t('import.editProvenance', 'Saved values count as entered by you, not observed. A new version is saved; the original stays as it was.')}
      </p>
      <ErrorCallout error={formError} />
      <div className="card-actions">
        <Button variant="primary" type="submit" icon="check" disabled={!canSave}>
          {saving ? t('actions.saving') : t('import.editSave', 'Save correction')}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {t('import.editCancel', 'Cancel')}
        </Button>
      </div>
    </form>
  );
}

/** The corrections made so far on this dataset, newest last. */
function Corrections({ list }: { list: RowCorrection[] }) {
  const { t } = useTranslation();
  if (list.length === 0) return null;
  return (
    <section className="card table-card" aria-labelledby="corrections-title">
      <div className="table-card-head">
        <div>
          <h3 id="corrections-title" className="card-title">
            {t('import.correctionsTitle', 'Corrected rows')}
          </h3>
          <p className="card-sub">{t('import.correctionsSub', 'Each correction saved a new version; the original values are kept.')}</p>
        </div>
      </div>
      <div className="table-scroll">
        <table className="table">
          <caption className="visually-hidden">{t('import.correctionsCaption', 'Corrections with field, old and new value')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('ledger.order')}</th>
              <th scope="col">{t('import.field', 'Field')}</th>
              <th scope="col">{t('import.editChange', 'Change')}</th>
              <th scope="col">{t('import.editNote', 'Note')}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c, i) => (
              <tr key={`${c.order_id}-${c.field}-${c.at}-${i}`}>
                <th scope="row" className="cell-stack">
                  <span>
                    {c.order_id ?? '—'} <Provenance kind="corrected" />
                  </span>
                  {c.line ? <span className="cell-sub">line {c.line}</span> : null}
                </th>
                <td>
                  <code>{c.field}</code>
                </td>
                <td className="num">
                  {shown(kindOfField(c.field), c.from)} → {shown(kindOfField(c.field), c.to)}
                </td>
                <td className="cell-wrap">{c.note || <span className="cell-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Report({ dataset, reveal, name, note }: { dataset: DatasetResponse; reveal: boolean; name: string; note: UploadNote | null }) {
  const { t } = useTranslation();
  const appended = Boolean(dataset.appended_to);
  const dropped = Math.max(0, dataset.rows_in - dataset.rows_kept - dataset.rows_rejected);
  const ref = useRef<HTMLElement>(null);
  const flagsRef = useRef<HTMLDivElement>(null);
  const keptRef = useRef<HTMLDivElement>(null);
  const [flagView, setFlagView] = useState<'all' | 'removed' | 'kept'>('all');
  const [showKept, setShowKept] = useState(false);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const corrected = new Set(dataset.corrected_order_ids ?? []);
  // An order with several flags is edited once, with all its flagged fields; rows without an order id by line.
  const groupKey = (f: ValidationFlag) => (f.order_id ? `o:${f.order_id}` : `l:${f.file ?? ''}:${f.line}`);
  const targetFor = (f: ValidationFlag): EditTarget => {
    const flags = dataset.flags.filter((x) => groupKey(x) === groupKey(f));
    return { key: groupKey(f), orderId: f.order_id, line: f.line, flags };
  };
  const removedFlags = dataset.flags.filter((f) => f.action !== 'kept');
  const keptFlags = dataset.flags.filter((f) => f.action === 'kept');
  const shownFlags = flagView === 'removed' ? removedFlags : flagView === 'kept' ? keptFlags : dataset.flags;
  const rejectedHere = dataset.flags.filter((f) => f.action === 'rejected').length;
  // Rows that failed validation (not duplicates, which are set aside on purpose): line, field and reason.
  const failed: FailedRow[] = dataset.flags
    .filter((f) => f.action !== 'kept' && f.reason !== 'duplicate')
    .map((f, i) => ({ key: `${f.line}-${f.field ?? ''}-${i}`, line: `${f.file ? `${f.file} · ` : ''}${f.line}`, order: f.order_id, field: f.field ?? fieldOfPath(f.path), reason: f.detail }));

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
  }, [dataset.dataset_id, dataset.flags, reveal]);

  return (
    <section ref={ref} className="stack report" aria-labelledby="report-title">
      <div className="section-head">
        <h2 id="report-title" className="section-title">
          {t('import.report')}
        </h2>
        <span className="section-meta">
          {name} · period end {formatDate(dataset.period_end)}
          {dataset.schema_version ? ` · schema ${dataset.schema_version}` : ''}
        </span>
      </div>
      {note ? (
        <Callout tone={note.tone} title={note.title} role="status" className="upload-note">
          {note.detail ? <p>{note.detail}</p> : null}
        </Callout>
      ) : null}
      {dataset.files && dataset.files.length > 1 ? (
        <p className="muted small" aria-label={appended ? 'Files saved together in this dataset' : 'Files merged into this dataset'}>
          {dataset.files.length} files {appended ? 'saved together' : 'merged'}:{' '}
          {dataset.files.map((f) => `${f.name} (${f.rows.toLocaleString('en-IN')} ${plural(f.rows, 'row', 'rows')})`).join(' · ')}
        </p>
      ) : null}
      {appended ? (
        <div className="kpi-grid kpi-grid-4">
          <StatCard label="Rows in" value={formatCount(dataset.rows_in)} icon="file" sub="Read from this upload" />
          <StatCard
            label="Added"
            value={formatCount(dataset.rows_added ?? 0)}
            icon="check-circle"
            tone="success"
            sub={`${formatCount(dataset.rows_kept)} ${plural(dataset.rows_kept, 'order', 'orders')} saved in total`}
            actionIcon="arrow-right"
            onClick={toKept}
            actionLabel={`Added ${dataset.rows_added ?? 0} orders — show every saved order id`}
          />
          <StatCard
            label="Already saved"
            value={formatCount(dataset.duplicates_ignored ?? 0)}
            icon="database"
            sub="Skipped, never counted twice"
            actionIcon="arrow-right"
            onClick={() => (removedFlags.length > 0 ? toFlags('removed') : toKept())}
            actionLabel={`Already saved ${dataset.duplicates_ignored ?? 0} — show the skipped rows`}
          />
          <StatCard
            label="Flags"
            value={formatCount(dataset.flags.length)}
            icon="alert-triangle"
            tone={rejectedHere > 0 ? 'danger' : dataset.flags.length > 0 ? 'warning' : 'default'}
            sub={rejectedHere > 0 ? `${rejectedHere} ${plural(rejectedHere, 'row', 'rows')} rejected` : 'This upload only'}
            actionIcon="arrow-right"
            onClick={() => (dataset.flags.length > 0 ? toFlags('all') : toKept())}
            actionLabel={`Flags ${dataset.flags.length} — show the flagged rows`}
          />
        </div>
      ) : (
        <div className="kpi-grid kpi-grid-4">
          <StatCard
            label="Rows in"
            value={formatCount(dataset.rows_in)}
            icon="file"
            sub="Every row read from the file"
            actionIcon="arrow-right"
            onClick={() => (dataset.flags.length > 0 ? toFlags('all') : toKept())}
            actionLabel={`Rows in ${dataset.rows_in} — ${dataset.flags.length > 0 ? 'show the flagged rows' : 'show the kept order ids'}`}
          />
          <StatCard
            label="Kept"
            value={formatCount(dataset.rows_kept)}
            icon="check-circle"
            tone="success"
            sub={dataset.kept_ids.length > 60 ? `${compressIds(dataset.kept_ids.slice(0, 60))} …` : compressIds(dataset.kept_ids)}
            actionIcon="arrow-right"
            onClick={toKept}
            actionLabel={`Kept ${dataset.rows_kept} rows — show the kept order ids`}
          />
          <StatCard
            label="Dropped / rejected"
            value={`${formatCount(dropped)} / ${formatCount(dataset.rows_rejected)}`}
            icon="x"
            tone={dropped + dataset.rows_rejected > 0 ? 'danger' : 'default'}
            sub={dropped + dataset.rows_rejected > 0 ? 'Not in the analysis' : 'Every row was usable'}
            actionIcon="arrow-right"
            onClick={() => (removedFlags.length > 0 ? toFlags('removed') : toKept())}
            actionLabel={`Dropped ${dropped}, rejected ${dataset.rows_rejected} — ${removedFlags.length > 0 ? 'filter the flagged rows to dropped and rejected' : 'show the kept order ids'}`}
          />
          <StatCard
            label="Flags"
            value={formatCount(dataset.flags.length)}
            icon="alert-triangle"
            tone={dataset.flags.length > 0 ? 'warning' : 'default'}
            sub={dataset.synthetic_rows > 0 ? `${dataset.synthetic_rows} labelled synthetic ${plural(dataset.synthetic_rows, 'row', 'rows')}` : 'Observed rows only'}
            actionIcon="arrow-right"
            onClick={() => (dataset.flags.length > 0 ? toFlags('all') : toKept())}
            actionLabel={`Flags ${dataset.flags.length} — show the flagged rows`}
          />
        </div>
      )}

      {failed.length > 0 ? (
        <ValidationPanel
          title={t('import.failedTitle', '{{n}} rows failed validation', { n: formatCount(failed.length) })}
          sub={t('import.failedSub', 'Rejected rows are left out of every total; the other rows were imported. Fix these lines in the file and upload it again.')}
          rows={failed}
        />
      ) : null}

      {showKept ? (
        <div className="card kept-card reveal-target" ref={keptRef} tabIndex={-1} aria-labelledby="kept-title">
          <div className="table-card-head kept-head">
            <h3 id="kept-title" className="card-title">
              {appended ? 'Saved order ids' : 'Kept order ids'}
            </h3>
            <span className="muted small">
              {dataset.kept_ids.length} {appended ? 'orders saved in total' : 'rows go into the analysis'}
            </span>
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
            <h3 className="card-title">{appended ? 'Flagged rows in this upload' : 'Flagged rows'}</h3>
            <div className="chips" role="group" aria-label="Filter flagged rows">
              {(
                [
                  ['all', t('import.allFlags'), dataset.flags.length],
                  ['removed', t('import.removedFlags'), removedFlags.length],
                  ['kept', t('import.keptFlags'), keptFlags.length],
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
                  <th scope="col">{t('ledger.order')}</th>
                  <th scope="col">{t('import.detail')}</th>
                  <th scope="col">{t('import.reason')}</th>
                  <th scope="col">{t('import.action')}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t('import.editColumn', 'Edit')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shownFlags.slice(0, 100).map((f, i, all) => {
                  const firstOfGroup = all.findIndex((x) => groupKey(x) === groupKey(f)) === i;
                  return (
                  <tr key={`${f.line}-${f.reason}-${f.field ?? ''}-${i}`} className={firstOfGroup ? undefined : 'row-grouped'}>
                    <th scope="row" className="cell-stack">
                      <span>
                        {f.order_id ?? '—'} {f.order_id && corrected.has(f.order_id) ? <Provenance kind="corrected" /> : null}
                      </span>
                      <span className="cell-sub">{f.file ? `${f.file} · ` : ''}line {f.line}</span>
                    </th>
                    <td className="cell-wrap">
                      {f.reason === 'duplicate' && f.order_id ? (
                        <span className="cell-stack">
                          <span className="dup-line">{t('import.duplicateDetail', '{{id}} duplicate — second copy ignored', { id: f.order_id })}</span>
                          <span className="cell-sub">{f.detail}</span>
                        </span>
                      ) : (
                        f.detail
                      )}
                    </td>
                    <td>
                      <Pill tone={REASON_TONE[f.reason] ?? 'neutral'} dot>
                        {REASON_TAG[f.reason] ? t(REASON_TAG[f.reason]) : f.reason}
                      </Pill>
                    </td>
                    <td>
                      <Pill tone={f.action === 'kept' ? 'warning' : 'danger'}>{f.action}</Pill>
                    </td>
                    <td className="r">
                      {firstOfGroup ? (
                        <Button variant="secondary" size="sm" onClick={() => setEditing(targetFor(f))} aria-label={t('import.editRow', 'Edit {{id}}', { id: editLabel(f.order_id, f.line) })}>
                          {t('import.editColumn', 'Edit')}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {shownFlags.length > 100 ? <p className="table-foot">Showing the first 100 of {shownFlags.length} flags.</p> : null}
        </div>
      ) : (
        <Callout tone="success" title="No rows flagged." />
      )}

      <Corrections list={dataset.corrections ?? []} />

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? t('import.editTitle', 'Edit {{id}}', { id: editLabel(editing.orderId, editing.line) }) : ''}
        meta={editing ? <span className="drawer-date">{t('import.editMeta', 'Line {{line}} · saved as a new version', { line: editing.line })}</span> : null}
      >
        {editing ? <RowEditor key={editing.key} target={editing} onClose={() => setEditing(null)} /> : null}
      </Drawer>

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

function HeroStats({ stats }: { stats: Array<[string, ReactNode]> }) {
  return (
    <dl className="hero-stats">
      {stats.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const savedKind = (d: WorkspaceDataset) =>
  d.source.startsWith('upload:') ? (d.files && d.files.length > 1 ? `${d.files.length} files saved together` : 'Uploaded file') : 'Sample data';

/** Workspace mode: the owner's saved datasets, newest first. Opening one shows its latest analysis (or runs one). */
function SavedData({ onOpened }: { onOpened: () => void }) {
  const { workspace, workspaceStatus, workspaceError, refreshWorkspace, openSaved, openingId, datasetId } = useStore();
  const [error, setError] = useState<ErrorInfo | null>(null);
  const { t } = useTranslation();
  const list = workspace?.datasets ?? [];

  const open = async (d: WorkspaceDataset) => {
    setError(null);
    try {
      await openSaved(d);
      onOpened();
    } catch (err) {
      setError(toErrorInfo(err));
    }
  };

  if (workspaceStatus === 'error' && workspaceError && list.length === 0) {
    return (
      <section className="card saved-data saved-data-error" aria-labelledby="saved-data-title">
        <h2 id="saved-data-title" className="card-title">
          {t('import.savedData')}
        </h2>
        <ErrorCallout error={workspaceError} />
        <Button variant="secondary" size="sm" icon="refresh" onClick={() => void refreshWorkspace()}>
          Try again
        </Button>
      </section>
    );
  }
  if (list.length === 0) return null;

  return (
    <section className="card table-card saved-data" aria-labelledby="saved-data-title">
      <div className="table-card-head">
        <div>
          <h2 id="saved-data-title" className="card-title">
            {t('import.savedData')}
          </h2>
          <p className="card-sub">Newest first. Open one to see its ledger and owner dashboard.</p>
        </div>
        <span className="muted small">
          {list.length} {plural(list.length, 'dataset', 'datasets')}
        </span>
      </div>
      <div className="table-scroll">
        <table className="table saved-table">
          <caption className="visually-hidden">Your saved datasets, newest first</caption>
          <thead>
            <tr>
              <th scope="col">{t('import.data')}</th>
              <th scope="col" className="r">
                {t('ledger.orders')}
              </th>
              <th scope="col">{t('common.periodEnd')}</th>
              <th scope="col">{t('common.saved')}</th>
              <th scope="col" className="r">
                {t('ledger.contribution')}
              </th>
              <th scope="col">
                <span className="visually-hidden">{t('actions.open')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((d) => {
              const name = datasetName(d.source, d.files);
              const current = d.dataset_id === datasetId;
              const busy = openingId === d.dataset_id;
              return (
                <tr key={d.dataset_id} className={current ? 'is-current' : undefined}>
                  <th scope="row" className="saved-name-cell">
                    <span className="cell-stack">
                      <span className="saved-name" title={d.files ? d.files.map((f) => f.name).join(', ') : name}>
                        {name}
                      </span>
                      <span className="cell-sub">{savedKind(d)}</span>
                    </span>
                  </th>
                  <td className="num r">{formatCount(d.rows_kept)}</td>
                  <td className="num">{formatDate(d.period_end)}</td>
                  <td className="num">{formatDate(d.created_at)}</td>
                  <td className="num r">
                    {d.latest_analysis ? <Money value={d.latest_analysis.contribution_inr} tone="contribution" /> : <span className="cell-muted">Not analysed yet</span>}
                  </td>
                  <td className="saved-action">
                    {current ? (
                      <Pill tone="success" dot>
                        {t('status.openNow')}
                      </Pill>
                    ) : (
                      <Button variant="secondary" size="sm" iconRight="arrow-right" onClick={() => void open(d)} disabled={openingId !== null} aria-label={`Open ${name}`}>
                        {busy ? t('actions.opening') : t('actions.open')}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error ? (
        <div className="saved-data-foot">
          <ErrorCallout error={error} />
        </div>
      ) : null}
    </section>
  );
}

export function ImportScreen() {
  const auth = useAuth();
  const account = auth.mode === 'account';
  const { samples, dataset, datasetId, analysis, importDataset, runAnalysis, analysing, importError, setImportError, workspace, workspaceStatus } = useStore();
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
  const [appendOn, setAppendOn] = useState(true);
  const [uploadNote, setUploadNote] = useState<UploadNote | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();

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

  const saved = account ? workspace?.datasets ?? [] : [];
  const sampleLabel = (source: string | undefined) => samples.find((s) => s.source === source)?.label;
  // Uploads can be added to the loaded data when it came from an upload or the saved list; in the workspace, the newest
  // saved dataset otherwise.
  const loadedCanGrow = dataset !== null && (dataset.source.startsWith('upload:') || saved.some((d) => d.dataset_id === dataset.dataset_id));
  const target =
    loadedCanGrow && dataset
      ? { id: dataset.dataset_id, name: datasetName(dataset.source, dataset.files, sampleLabel(dataset.source)) }
      : saved[0]
        ? { id: saved[0].dataset_id, name: datasetName(saved[0].source, saved[0].files) }
        : null;

  const load = async (input: DatasetInput, what: string, options?: DatasetOptions) => {
    setValidating(what);
    setLoadError(null);
    setContinueError(null);
    setUploadNote(null);
    try {
      const ds = await importDataset(input, options);
      setLoadedHere(true);
      setUploadNote(noteFor(ds, options?.appendTo ? target?.name ?? null : null));
    } catch {
      // importDataset has already recorded the error for the drop zone.
    } finally {
      setValidating(null);
    }
  };

  /** One file, or several (e.g. one CSV per month) that the API merges into one dataset. */
  const onFiles = (list: FileList | null | undefined) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const wrong = files.filter((f) => !/\.(json|csv)$/i.test(f.name));
    if (wrong.length) {
      setLoadError({
        message: `${wrong.map((f) => f.name).join(', ')} ${wrong.length === 1 ? 'is' : 'are'} not JSON or CSV.`,
        hint: 'Export the orders as JSON or as CSV with the template column names.',
        issues: [],
      });
      return;
    }
    if (files.length > MAX_FILES) {
      setLoadError({ message: `${files.length} files were selected; up to ${MAX_FILES} can be merged at once.`, hint: 'Upload a year of monthly files at most.', issues: [] });
      return;
    }
    void load(files.length === 1 ? files[0] : files, files.length === 1 ? files[0].name : `${files.length} files`, appendOn && target ? { appendTo: target.id } : undefined);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    onFiles(e.dataTransfer.files);
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

  const loadDemo12m = async () => {
    setValidating('demo_12m');
    setLoadError(null);
    setContinueError(null);
    setUploadNote(null);
    let imported = false;
    try {
      const ds = await importDataset({ source: 'demo_12m' });
      imported = true;
      setLoadedHere(true);
      await runAnalysis('allocate', undefined, ds.dataset_id);
      navigate('pulse');
    } catch (err) {
      // A failed import is already recorded for the drop zone; an analysis failure shows under Continue.
      if (imported) setContinueError(toErrorInfo(err));
    } finally {
      setValidating(null);
    }
  };

  const drills = samples.filter((s) => s.source !== 'fixture' && s.source !== 'extended' && s.source !== 'demo_12m');
  const busy = validating !== null;
  const canContinue = (dataset ? dataset.rows_kept > 0 : datasetId !== null) && !busy && !analysing;
  const firstUpload = account && workspaceStatus === 'ready' && saved.length === 0 && !dataset;
  const browse = () => fileRef.current?.click();

  const demoHero = (
    <section className="hero card" aria-labelledby="import-title">
      <div className="hero-text">
        <span className="pill pill-outline hero-kicker">
          <Icon name="upload-cloud" size={14} /> {t('import.kicker')}
        </span>
        <h1 id="import-title" className="hero-title">
          {t('import.title')}
        </h1>
        <p className="hero-sub">Load demo data or drop your own files. Every row is validated before anything is counted.</p>
        <div className="demo-data" role="group" aria-labelledby="demo-data-title">
          <h2 id="demo-data-title" className="demo-data-title">
            {t('status.synthetic')}
          </h2>
          <div className="hero-actions">
            <Button variant="primary" size="lg" onClick={() => void load({ source: 'fixture' }, 'fixture')} disabled={busy}>
              {validating === 'fixture' ? t('actions.loading') : t('actions.loadFixture')}
            </Button>
            <Button variant="secondary" size="lg" onClick={() => void load({ source: 'extended' }, 'extended')} disabled={busy}>
              {validating === 'extended' ? t('actions.loading') : t('actions.loadExtended')}
            </Button>
          </div>
          <div className="demo12-row">
            <Button variant="ghost" icon="bar-chart" onClick={() => void loadDemo12m()} disabled={busy} className="demo12-btn">
              {validating === 'demo_12m' ? t('actions.loadingDemo12m') : t('actions.loadDemo12m')}
            </Button>
            <Pill tone="neutral">{t('status.syntheticLabelled')}</Pill>
            <span className="demo12-note">Opens Pulse owner analytics on a year of orders.</span>
          </div>
        </div>
      </div>
      <HeroStats
        stats={[
          ['reference orders', 20],
          ['order fields', 12],
          ['data-quality drills', drills.length],
        ]}
      />
    </section>
  );

  const workspaceHero = firstUpload ? (
    <section className="hero card hero-first" aria-labelledby="import-title">
      <div className="hero-text">
        <span className="pill pill-outline hero-kicker">
          <Icon name="database" size={14} /> {t('import.yourWorkspace')}
        </span>
        <h1 id="import-title" className="hero-title">
          {t('import.titleFirst')}
        </h1>
        <p className="hero-sub">
          Drop a CSV or JSON export of your orders: one file, or up to {MAX_FILES} monthly files at once. Every row is validated and saved to your
          account, then the owner dashboard opens on your own numbers.
        </p>
        <div className="hero-actions">
          <Button variant="primary" size="lg" icon="upload-cloud" onClick={browse} disabled={busy}>
            {t('actions.chooseFiles')}
          </Button>
          <ButtonLink variant="secondary" size="lg" icon="download" href={api.templateUrl()} download="profyn-orders-template.csv">
            {t('actions.csvTemplate')}
          </ButtonLink>
        </div>
      </div>
      <HeroStats
        stats={[
          ['required columns', REQUIRED_FIELDS.length],
          ['files at once', MAX_FILES],
          ['orders per dataset', '1,00,000'],
        ]}
      />
    </section>
  ) : (
    <section className="hero card" aria-labelledby="import-title">
      <div className="hero-text">
        <span className="pill pill-outline hero-kicker">
          <Icon name="database" size={14} /> {t('import.yourWorkspace')}
        </span>
        <h1 id="import-title" className="hero-title">
          {t('import.titleWorkspace')}
        </h1>
        <p className="hero-sub">Add this month&rsquo;s export or open saved data. Every row is validated before anything is counted, and orders already saved are skipped.</p>
      </div>
      {saved.length > 0 ? (
        <HeroStats
          stats={[
            [plural(saved.length, 'saved dataset', 'saved datasets'), saved.length],
            ['orders in the newest', formatCount(saved[0].rows_kept)],
            ['latest period end', formatDate(saved[0].period_end)],
          ]}
        />
      ) : null}
    </section>
  );

  return (
    <div className="page">
      {account ? workspaceHero : demoHero}

      {account ? <SavedData onOpened={() => navigate('pulse')} /> : null}

      <div className="grid-import">
        <div className="stack">
          {target ? (
            <label className="append-toggle">
              <input type="checkbox" checked={appendOn} onChange={(e) => setAppendOn(e.target.checked)} disabled={busy} />
              <span>
                Add to <strong>{target.name}</strong> — orders already saved are skipped
              </span>
            </label>
          ) : null}
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
            <p className="dropzone-title">{target && appendOn ? `Drop new orders to add to ${target.name}` : t('actions.dropFile')}</p>
            <p className="dropzone-sub">One file, or up to {MAX_FILES} at once (e.g. one per month), merged into one dataset · template column names · 50 MB each, 1,00,000 orders in total</p>
            <span className="dropzone-actions">
              <Button variant="secondary" icon="file" onClick={browse} disabled={busy}>
                {t('actions.browseFiles')}
              </Button>
              <ButtonLink variant="ghost" icon="download" href={api.templateUrl()} download="profyn-orders-template.csv">
                {t('actions.downloadTemplate')}
              </ButtonLink>
            </span>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.csv,application/json,text/csv"
              multiple
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                onFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          {account ? (
            <p className="storage-note">
              <Icon name="lock" size={14} /> Uploads are saved to your account.
            </p>
          ) : (
            <p className="storage-note">
              <Icon name="info" size={14} /> {t('import.demoStorage', 'Uploads are saved to the demo database.')}{' '}
              {auth.hasSession ? (
                <>
                  <a
                    href="/app/?mode=account"
                    onClick={(e) => {
                      e.preventDefault();
                      auth.backToWorkspace();
                    }}
                  >
                    {t('import.backToWorkspace', 'Go back to your workspace')}
                  </a>{' '}
                  {t('import.keepInAccount', 'to keep them in your own account.')}
                </>
              ) : (
                <>
                  <a href={auth.loginUrl}>{t('actions.signIn')}</a> {t('import.keepInAccount', 'to keep them in your own account.')}
                </>
              )}
            </p>
          )}
          <p className="alias-note" title={HEADER_ALIASES.map(([a, b]) => `${a} → ${b}`).join(', ')}>
            Header aliases accepted: {HEADER_ALIASES.map(([a]) => a).join(', ')} …
          </p>
          {loadError ? <LoadErrorPanel error={loadError} /> : null}
        </div>

        <section className="card options-card" aria-labelledby="options-title">
          <h2 id="options-title" className="card-title">
            {t('import.options')}
          </h2>
          <div className="field">
            <span className="field-label" id="attr-label">
              Attribution <InfoTip text={t(ATTRIBUTION_TIP_KEY, ATTRIBUTION_TIP_EN)} label="About attribution" />
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
            {analysing ? t('actions.analysing') : t('actions.continueLedger')}
          </Button>
          {!dataset && !datasetId ? <p className="muted small">{account ? 'Upload a file or open saved data first.' : 'Load a sample or a file first.'}</p> : null}
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
          dataset ? <p className="muted small">Nothing was imported. The previous data ({datasetName(dataset.source, dataset.files, sampleLabel(dataset.source))}) is still loaded.</p> : null
        ) : dataset ? (
          <Report dataset={dataset} reveal={loadedHere} note={uploadNote} name={datasetName(dataset.source, dataset.files, sampleLabel(dataset.source))} />
        ) : datasetId ? (
          <Callout tone="info" title="The data from your last visit is loaded.">
            <p>{account ? 'Upload a file or open saved data to see a validation report.' : 'Load a sample or a file to see its validation report.'}</p>
          </Callout>
        ) : null}
      </div>

      {account ? null : (
        <section className="stack" aria-labelledby="drills-title">
          <div className="section-head">
            <h2 id="drills-title" className="section-title">
              {t('import.drills')}
            </h2>
            <span className="section-meta">Negative tests; each one loads a sample and shows how the checks react.</span>
          </div>
          <div className="drill-grid">
            {drills.map((s) => {
              const tag = DRILL_TAGS[s.source] ?? { tag: 'Drill', key: undefined, tone: 'primary' as const };
              return (
                <button key={s.source} type="button" className="card drill" onClick={() => void load({ source: s.source }, s.source)} disabled={busy}>
                  <span className="drill-top">
                    <Pill tone={tag.tone} dot>
                      {tag.key ? t(tag.key) : tag.tag}
                    </Pill>
                    <Icon name="arrow-up-right" size={18} className="drill-arrow" />
                  </span>
                  <span className="drill-title">{validating === s.source ? t('actions.loading') : s.label}</span>
                  <span className="drill-text">{s.description}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <Collapsible title="View the column schema" meta="7 required · 5 nullable · 5 optional">
        <div className="schema-grid">
          <SchemaList title="Required" rows={REQUIRED_FIELDS} />
          <SchemaList title="May be null (unknown)" rows={NULLABLE_FIELDS} />
          <div>
            <SchemaList title="Optional fields" rows={OPTIONAL_FIELDS} />
            <h3 className="mini-title">Suffix rules</h3>
            <p className="small muted">
              <code>_inr</code> rupees · <code>_pct</code> 0–100 · <code>_units</code> counts · <code>_days</code> calendar days. Null means
              unknown, never zero. Rows added for the demo carry <code>synthetic: true</code>; header variants such as cogs, sku and gateway_fee
              are mapped.
            </p>
          </div>
        </div>
      </Collapsible>

      {AUDIT_LINK ? (
        <div className="audit-row">
          <ButtonLink variant="secondary" icon="arrow-up-right" href={AUDIT_LINK} target="_blank" rel="noopener noreferrer">
            {t('import.paidAudit', 'Paid sample audit — ₹199')}
          </ButtonLink>
          <span className="muted small">{t('import.paidAuditNote', 'Opens the payment page in a new tab.')}</span>
        </div>
      ) : null}

      <Integrations />
    </div>
  );
}
