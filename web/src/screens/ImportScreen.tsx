import type { TFunction } from 'i18next';
import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { api, ApiError, toErrorInfo, type DatasetInput, type DatasetOptions, type ErrorInfo } from '../api/client';
import type { AttributionMode, ColumnMapping, DatasetResponse, ImportMapResult, ImportProfile, OrderResult, RowCorrection, ValidationFlag, WorkspaceDataset } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AiBadge } from '../components/AiBadge';
import { Pill } from '../components/Badge';
import { Button, ButtonLink } from '../components/Button';
import { Drawer } from '../components/Drawer';
import { Icon } from '../components/Icon';
import { Integrations, REPORT_IMPORTERS } from '../components/Integrations';
import { Money } from '../components/Money';
import { Provenance } from '../components/Provenance';
import { ShopifyCard } from '../components/ShopifyConnect';
import { AttributionSegmented, Callout, Collapsible, ErrorCallout, InfoTip, revealElement, Skeleton, StatCard } from '../components/ui';
import { apiText } from '../lib/apiText';
import { compressIds, formatCount, formatDate, formatInr } from '../lib/format';
import { ATTRIBUTION_TIP_EN, ATTRIBUTION_TIP_KEY, datasetName, DRILL_TAGS, HEADER_ALIASES } from '../lib/labels';
import { navigate } from '../lib/router';
import { localiseSample, useStore } from '../state/store';

/** Files merged in one upload (the API's limit: a year of monthly exports). */
const MAX_FILES = 12;

/** A schema field and what it holds (translated where it is shown). */
interface SchemaField {
  field: string;
  descKey: string;
  desc: string;
}

/** Must be present and non-null on every row. */
const REQUIRED_FIELDS: SchemaField[] = [
  { field: 'order_id', descKey: 'import.fd.orderId', desc: 'Text, unique per period' },
  { field: 'date', descKey: 'import.fd.date', desc: 'YYYY-MM-DD' },
  { field: 'gross_inr', descKey: 'import.fd.gross', desc: '₹ before discount' },
  { field: 'discount_inr', descKey: 'import.fd.discount', desc: '₹ discount given' },
  { field: 'product_cost_inr', descKey: 'import.fd.productCost', desc: '₹ landed product cost' },
  { field: 'shipping_inr', descKey: 'import.fd.shipping', desc: '₹ outbound shipping' },
  { field: 'returned', descKey: 'import.fd.returned', desc: 'true or false' },
];

/** May be null or missing, which means unknown. */
const NULLABLE_FIELDS: SchemaField[] = [
  { field: 'refund_inr', descKey: 'import.fd.refund', desc: '₹ refunded to the customer' },
  { field: 'net_sales_inr', descKey: 'import.fd.netSales', desc: '₹ cross-checked: gross − discount − refund' },
  { field: 'recovered_product_cost_inr', descKey: 'import.fd.recovered', desc: '₹ back in stock after a return' },
  { field: 'payment_fee_inr', descKey: 'import.fd.fee', desc: '₹ payment gateway fee' },
  { field: 'return_cost_inr', descKey: 'import.fd.returnCost', desc: '₹ return shipping' },
];

const OPTIONAL_FIELDS: SchemaField[] = [
  { field: 'channel', descKey: 'import.fd.channel', desc: 'Text, sales channel' },
  { field: 'product_id', descKey: 'import.fd.productId', desc: 'Text, product or SKU' },
  { field: 'ads_inr', descKey: 'import.fd.ads', desc: '₹ per order, allocate mode' },
  { field: 'handling_inr', descKey: 'import.fd.handling', desc: '₹ per order; else config default' },
  { field: 'refund_date', descKey: 'import.fd.refundDate', desc: 'YYYY-MM-DD; after period end is pending' },
];

// ---- Column mapping -------------------------------------------------------------------------------------------------

/** Header variants the API accepts without a mapping (api/src/schema/orders.ts COLUMN_ALIASES). */
const COLUMN_ALIASES: Record<string, string> = {
  orderid: 'order_id',
  'order id': 'order_id',
  order_date: 'date',
  'order date': 'date',
  gross: 'gross_inr',
  discount: 'discount_inr',
  refund: 'refund_inr',
  refund_amount: 'refund_inr',
  net_sales: 'net_sales_inr',
  'net sales': 'net_sales_inr',
  product_cost: 'product_cost_inr',
  cogs: 'product_cost_inr',
  recovered_product_cost: 'recovered_product_cost_inr',
  recovered_cost: 'recovered_product_cost_inr',
  shipping: 'shipping_inr',
  shipping_cost: 'shipping_inr',
  payment_fee: 'payment_fee_inr',
  gateway_fee: 'payment_fee_inr',
  return_cost: 'return_cost_inr',
  is_returned: 'returned',
  sku: 'product_id',
  product: 'product_id',
  ads: 'ads_inr',
  ad_spend: 'ads_inr',
  handling: 'handling_inr',
};

/** The schema field a header stands for, or null. */
export function canonicalField(header: string, schema: Set<string>): string | null {
  const n = header.replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ');
  const u = n.replace(/[\s-]+/g, '_');
  if (schema.has(n)) return n;
  if (schema.has(u)) return u;
  return COLUMN_ALIASES[n] ?? COLUMN_ALIASES[u] ?? null;
}

/** True when every required field is a header or a known alias: the file uploads without a mapping step. */
export function headersMatchSchema(headers: string[], required: string[], schema: Set<string>): boolean {
  const found = new Set(headers.map((h) => canonicalField(h, schema)).filter(Boolean));
  return required.every((f) => found.has(f));
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** The header row and the first rows of a CSV, read from its first 64 KB. */
async function readCsvHead(file: File): Promise<{ headers: string[]; rows: string[][] }> {
  const text = await file.slice(0, 64 * 1024).text();
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  return { headers: lines.length ? splitCsvLine(lines[0]) : [], rows: lines.slice(1, 6).map(splitCsvLine) };
}

interface PendingMapping {
  files: File[];
  what: string;
  headers: string[];
  result: ImportMapResult;
  chosen: ColumnMapping;
  profile: string | null;
  appendTo?: string;
}

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

/** What happened to a flagged row (kept, dropped, rejected), in the UI language. */
function actionText(action: ValidationFlag['action'], t: TFunction): string {
  if (action === 'kept') return t('import.actionKept', 'kept');
  if (action === 'dropped') return t('import.actionDropped', 'dropped');
  if (action === 'rejected') return t('import.actionRejected', 'rejected');
  return action;
}

/** The result line after an upload that was added to saved data. */
interface UploadNote {
  tone: 'success' | 'info';
  title: string;
  detail: string | null;
}

function noteFor(ds: DatasetResponse, target: string | null, t: TFunction): UploadNote | null {
  if (ds.unchanged) {
    const n = ds.duplicates_ignored ?? ds.rows_in;
    return {
      tone: 'info',
      title: ds.message ?? t('import.noteNothingNew', 'Nothing new: all {{n}} orders were already saved.', { n: formatCount(n) }),
      detail: target ? t('import.noteUnchanged', '{{name}} is unchanged.', { name: target }) : null,
    };
  }
  if (!ds.appended_to) return null;
  const added = ds.rows_added ?? 0;
  const skipped = ds.duplicates_ignored ?? 0;
  const addedText = t('import.noteAdded', 'Added {{n}} new orders', { count: added, n: formatCount(added) });
  const skippedText = skipped > 0 ? t('import.noteSkipped', '{{n}} already saved, skipped', { n: formatCount(skipped) }) : t('import.noteNoneSkipped', 'none were already saved');
  return {
    tone: 'success',
    title: `${addedText} · ${skippedText}`,
    detail: t('import.noteTogether', '{{n}} orders saved together now. Run the analysis to see the new totals.', { count: ds.rows_kept, n: formatCount(ds.rows_kept) }),
  };
}

/** A client-side file error (wrong file type): shown on the file panel in every language, not only when English words match. */
const FILE_ERRORS = new WeakSet<ErrorInfo>();

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
                  <td className="cell-wrap">{apiText(r.reason)}</td>
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
  return FILE_ERRORS.has(error) || error.issues.length > 0 || /template|column|JSON or CSV/i.test(`${error.hint ?? ''} ${error.message}`);
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

const editLabel = (orderId: string | null, line: number, t: TFunction) => orderId ?? t('import.lineN', 'line {{line}}', { line });

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

function shown(kind: FieldKind, v: unknown, t: TFunction): string {
  if (v === null || v === undefined || v === '') return t('import.editUnknown', 'unknown');
  if (kind === 'money' && typeof v === 'number') return formatInr(v);
  return String(v);
}

function RowEditor({ target, onClose }: { target: EditTarget; onClose: () => void }) {
  const { t } = useTranslation();
  const { dataset, analysis, correctRow, showToast } = useStore();
  const id = editLabel(target.orderId, target.line, t);
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
        .map(([f, v]) => `${f}: ${shown(kindOfField(f), initial[f], t)} → ${shown(kindOfField(f), v, t)}`)
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
            <span>{apiText(f.detail)}</span>
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
                <option value="true">{t('import.boolTrue', 'true')}</option>
                <option value="false">{t('import.boolFalse', 'false')}</option>
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
                {t('import.editWas', 'In the data now: {{value}}', { value: shown(kind, initial[f], t) })}
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
                  {c.line ? <span className="cell-sub">{t('import.lineN', 'line {{line}}', { line: c.line })}</span> : null}
                </th>
                <td>
                  <code>{c.field}</code>
                </td>
                <td className="num">
                  {shown(kindOfField(c.field), c.from, t)} → {shown(kindOfField(c.field), c.to, t)}
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
    .map((f, i) => ({ key: `${f.line}-${f.field ?? ''}-${i}`, line: `${f.file ? `${f.file} · ` : ''}${f.line}`, order: f.order_id, field: f.field ?? fieldOfPath(f.path), reason: apiText(f.detail) }));

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
          {t('import.reportMeta', '{{name}} · period end {{date}}', { name, date: formatDate(dataset.period_end) })}
          {dataset.schema_version ? ` · ${t('import.schemaVersion', 'schema {{v}}', { v: dataset.schema_version })}` : ''}
        </span>
      </div>
      {note ? (
        <Callout tone={note.tone} title={note.title} role="status" className="upload-note">
          {note.detail ? <p>{apiText(note.detail)}</p> : null}
        </Callout>
      ) : null}
      {dataset.files && dataset.files.length > 1 ? (
        <p className="muted small" aria-label={appended ? t('import.filesSavedAria', 'Files saved together in this dataset') : t('import.filesMergedAria', 'Files merged into this dataset')}>
          {appended ? t('import.filesSaved', '{{n}} files saved together:', { n: dataset.files.length }) : t('import.filesMerged', '{{n}} files merged:', { n: dataset.files.length })}{' '}
          {dataset.files.map((f) => `${f.name} (${t('import.fileRows', '{{n}} rows', { count: f.rows, n: f.rows.toLocaleString('en-IN') })})`).join(' · ')}
        </p>
      ) : null}
      {appended ? (
        <div className="kpi-grid kpi-grid-4">
          <StatCard label={t('import.statRowsIn', 'Rows in')} value={formatCount(dataset.rows_in)} icon="file" sub={t('import.statFromUpload', 'Read from this upload')} />
          <StatCard
            label={t('import.statAdded', 'Added')}
            value={formatCount(dataset.rows_added ?? 0)}
            icon="check-circle"
            tone="success"
            sub={t('import.statSavedTotal', '{{n}} orders saved in total', { count: dataset.rows_kept, n: formatCount(dataset.rows_kept) })}
            actionIcon="arrow-right"
            onClick={toKept}
            actionLabel={t('import.statAddedAction', 'Added {{n}} orders — show every saved order id', { n: dataset.rows_added ?? 0 })}
          />
          <StatCard
            label={t('import.statAlreadySaved', 'Already saved')}
            value={formatCount(dataset.duplicates_ignored ?? 0)}
            icon="database"
            sub={t('import.statSkipped', 'Skipped, never counted twice')}
            actionIcon="arrow-right"
            onClick={() => (removedFlags.length > 0 ? toFlags('removed') : toKept())}
            actionLabel={t('import.statAlreadyAction', 'Already saved {{n}} — show the skipped rows', { n: dataset.duplicates_ignored ?? 0 })}
          />
          <StatCard
            label={t('import.statFlags', 'Flags')}
            value={formatCount(dataset.flags.length)}
            icon="alert-triangle"
            tone={rejectedHere > 0 ? 'danger' : dataset.flags.length > 0 ? 'warning' : 'default'}
            sub={rejectedHere > 0 ? t('import.statRejected', '{{n}} rows rejected', { count: rejectedHere, n: rejectedHere }) : t('import.statUploadOnly', 'This upload only')}
            actionIcon="arrow-right"
            onClick={() => (dataset.flags.length > 0 ? toFlags('all') : toKept())}
            actionLabel={t('import.statFlagsAction', 'Flags {{n}} — show the flagged rows', { n: dataset.flags.length })}
          />
        </div>
      ) : (
        <div className="kpi-grid kpi-grid-4">
          <StatCard
            label={t('import.statRowsIn', 'Rows in')}
            value={formatCount(dataset.rows_in)}
            icon="file"
            sub={t('import.statEveryRow', 'Every row read from the file')}
            actionIcon="arrow-right"
            onClick={() => (dataset.flags.length > 0 ? toFlags('all') : toKept())}
            actionLabel={t('import.statRowsInAction', 'Rows in {{n}} — {{then}}', {
              n: dataset.rows_in,
              then: dataset.flags.length > 0 ? t('import.showFlagged', 'show the flagged rows') : t('import.showKeptIds', 'show the kept order ids'),
            })}
          />
          <StatCard
            label={t('import.statKept', 'Kept')}
            value={formatCount(dataset.rows_kept)}
            icon="check-circle"
            tone="success"
            sub={dataset.kept_ids.length > 60 ? `${compressIds(dataset.kept_ids.slice(0, 60))} …` : compressIds(dataset.kept_ids)}
            actionIcon="arrow-right"
            onClick={toKept}
            actionLabel={t('import.statKeptAction', 'Kept {{n}} rows — show the kept order ids', { n: dataset.rows_kept })}
          />
          <StatCard
            label={t('import.statDropped', 'Dropped / rejected')}
            value={`${formatCount(dropped)} / ${formatCount(dataset.rows_rejected)}`}
            icon="x"
            tone={dropped + dataset.rows_rejected > 0 ? 'danger' : 'default'}
            sub={dropped + dataset.rows_rejected > 0 ? t('import.statNotInAnalysis', 'Not in the analysis') : t('import.statAllUsable', 'Every row was usable')}
            actionIcon="arrow-right"
            onClick={() => (removedFlags.length > 0 ? toFlags('removed') : toKept())}
            actionLabel={t('import.statDroppedAction', 'Dropped {{dropped}}, rejected {{rejected}} — {{then}}', {
              dropped,
              rejected: dataset.rows_rejected,
              then: removedFlags.length > 0 ? t('import.filterDropped', 'filter the flagged rows to dropped and rejected') : t('import.showKeptIds', 'show the kept order ids'),
            })}
          />
          <StatCard
            label={t('import.statFlags', 'Flags')}
            value={formatCount(dataset.flags.length)}
            icon="alert-triangle"
            tone={dataset.flags.length > 0 ? 'warning' : 'default'}
            sub={
              dataset.synthetic_rows > 0
                ? t('import.statSynthetic', '{{n}} labelled synthetic rows', { count: dataset.synthetic_rows, n: dataset.synthetic_rows })
                : t('import.statObservedOnly', 'Observed rows only')
            }
            actionIcon="arrow-right"
            onClick={() => (dataset.flags.length > 0 ? toFlags('all') : toKept())}
            actionLabel={t('import.statFlagsAction', 'Flags {{n}} — show the flagged rows', { n: dataset.flags.length })}
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
              {appended ? t('import.savedIds', 'Saved order ids') : t('import.keptIds', 'Kept order ids')}
            </h3>
            <span className="muted small">
              {appended
                ? t('import.keptCountSaved', '{{n}} orders saved in total', { n: dataset.kept_ids.length })
                : t('import.keptCountRows', '{{n}} rows go into the analysis', { n: dataset.kept_ids.length })}
            </span>
          </div>
          <div className="id-chips">
            {dataset.kept_ids.slice(0, 300).map((id) => (
              <span key={id} className="pill pill-outline">
                {id}
              </span>
            ))}
            {dataset.kept_ids.length > 300 ? <span className="muted small">{t('import.andMore', 'and {{n}} more', { n: dataset.kept_ids.length - 300 })}</span> : null}
          </div>
        </div>
      ) : null}

      {dataset.flags.length > 0 ? (
        <div className="card table-card reveal-target" ref={flagsRef} tabIndex={-1}>
          <div className="table-card-head">
            <h3 className="card-title">{appended ? t('import.flaggedInUpload', 'Flagged rows in this upload') : t('import.flaggedRows', 'Flagged rows')}</h3>
            <div className="chips" role="group" aria-label={t('import.filterFlags', 'Filter flagged rows')}>
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
              <caption className="visually-hidden">{t('import.flagsCaption', 'Validation flags with line, detail, reason and action')}</caption>
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
                      <span className="cell-sub">
                        {f.file ? `${f.file} · ` : ''}
                        {t('import.lineN', 'line {{line}}', { line: f.line })}
                      </span>
                    </th>
                    <td className="cell-wrap">
                      {f.reason === 'duplicate' && f.order_id ? (
                        <span className="cell-stack">
                          <span className="dup-line">{t('import.duplicateDetail', '{{id}} duplicate — second copy ignored', { id: f.order_id })}</span>
                          <span className="cell-sub">{apiText(f.detail)}</span>
                        </span>
                      ) : (
                        apiText(f.detail)
                      )}
                    </td>
                    <td>
                      <Pill tone={REASON_TONE[f.reason] ?? 'neutral'} dot>
                        {REASON_TAG[f.reason] ? t(REASON_TAG[f.reason]) : f.reason}
                      </Pill>
                    </td>
                    <td>
                      <Pill tone={f.action === 'kept' ? 'warning' : 'danger'}>{actionText(f.action, t)}</Pill>
                    </td>
                    <td className="r">
                      {firstOfGroup ? (
                        <Button variant="secondary" size="sm" onClick={() => setEditing(targetFor(f))} aria-label={t('import.editRow', 'Edit {{id}}', { id: editLabel(f.order_id, f.line, t) })}>
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
          {shownFlags.length > 100 ? <p className="table-foot">{t('import.first100', 'Showing the first 100 of {{n}} flags.', { n: shownFlags.length })}</p> : null}
        </div>
      ) : (
        <Callout tone="success" title={t('import.noFlags', 'No rows flagged.')} />
      )}

      <Corrections list={dataset.corrections ?? []} />

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? t('import.editTitle', 'Edit {{id}}', { id: editLabel(editing.orderId, editing.line, t) }) : ''}
        meta={editing ? <span className="drawer-date">{t('import.editMeta', 'Line {{line}} · saved as a new version', { line: editing.line })}</span> : null}
      >
        {editing ? <RowEditor key={editing.key} target={editing} onClose={() => setEditing(null)} /> : null}
      </Drawer>

      {dataset.warnings.length > 0 ? (
        <Callout tone="info" title={t('import.warnings', 'Warnings')}>
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

function SchemaList({ title, rows }: { title: string; rows: SchemaField[] }) {
  const { t } = useTranslation();
  return (
    <div>
      <h3 className="mini-title">{title}</h3>
      <dl className="kv kv-schema">
        {rows.map((r) => (
          <div key={r.field}>
            <dt>
              <code>{r.field}</code>
            </dt>
            <dd>{t(r.descKey, r.desc)}</dd>
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

const savedKind = (d: WorkspaceDataset, t: TFunction) =>
  d.source.startsWith('upload:')
    ? d.files && d.files.length > 1
      ? t('import.kindFiles', '{{n}} files saved together', { n: d.files.length })
      : t('import.kindUpload', 'Uploaded file')
    : t('import.kindSample', 'Sample data');

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
          {t('import.tryAgain', 'Try again')}
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
          <p className="card-sub">{t('import.savedSub', 'Newest first. Open one to see its ledger and owner dashboard.')}</p>
        </div>
        <span className="muted small">{t('import.datasetCount', '{{n}} datasets', { count: list.length, n: list.length })}</span>
      </div>
      <div className="table-scroll">
        <table className="table saved-table">
          <caption className="visually-hidden">{t('import.savedCaption', 'Your saved datasets, newest first')}</caption>
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
                      <span className="cell-sub">{savedKind(d, t)}</span>
                    </span>
                  </th>
                  <td className="num r">{formatCount(d.rows_kept)}</td>
                  <td className="num">{formatDate(d.period_end)}</td>
                  <td className="num">{formatDate(d.created_at)}</td>
                  <td className="num r">
                    {d.latest_analysis ? <Money value={d.latest_analysis.contribution_inr} tone="contribution" /> : <span className="cell-muted">{t('import.notAnalysed', 'Not analysed yet')}</span>}
                  </td>
                  <td className="saved-action">
                    {current ? (
                      <Pill tone="success" dot>
                        {t('status.openNow')}
                      </Pill>
                    ) : (
                      <Button variant="secondary" size="sm" iconRight="arrow-right" onClick={() => void open(d)} disabled={openingId !== null} aria-label={t('import.openName', 'Open {{name}}', { name })}>
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

type SchemaKind = 'required' | 'nullable' | 'optional';
const SCHEMA_FIELDS: Array<SchemaField & { kind: SchemaKind }> = [
  ...REQUIRED_FIELDS.map((f) => ({ ...f, kind: 'required' as const })),
  ...NULLABLE_FIELDS.map((f) => ({ ...f, kind: 'nullable' as const })),
  ...OPTIONAL_FIELDS.map((f) => ({ ...f, kind: 'optional' as const })),
];
const SCHEMA_SET = new Set(SCHEMA_FIELDS.map((f) => f.field));
const REQUIRED_NAMES = REQUIRED_FIELDS.map((f) => f.field);

function pct(v: number): string {
  return `${Math.round((v <= 1 ? v * 100 : v) as number)}%`;
}

/** Schema field → column, confirmed once. AI suggestions are marked; nothing uploads until "Confirm mapping". */
function MappingPanel({
  pending,
  profileLabel,
  onChange,
  onConfirm,
  onCancel,
}: {
  pending: PendingMapping;
  profileLabel: string | null;
  onChange: (field: string, column: string | null) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { result, chosen, headers } = pending;
  const extra = Object.keys(result.mapping).filter((f) => !SCHEMA_SET.has(f));
  const rows: Array<SchemaField & { kind: SchemaKind }> = [...SCHEMA_FIELDS, ...extra.map((f) => ({ field: f, descKey: '', desc: '', kind: 'optional' as const }))];
  const missing = REQUIRED_NAMES.filter((f) => !chosen[f]);
  const perField = result.confidence && typeof result.confidence === 'object' ? result.confidence : null;
  const overall = typeof result.confidence === 'number' ? result.confidence : null;
  const sourceBadge =
    result.source === 'ai' ? (
      <AiBadge source="ai" />
    ) : (
      <Pill tone={result.source === 'saved' ? 'success' : 'primary'}>
        {result.source === 'profile'
          ? t('mapping.srcProfile', 'Report profile: {{name}}', { name: profileLabel ?? result.profile ?? '' })
          : result.source === 'saved'
            ? t('mapping.srcSaved', 'Your saved mapping')
            : t('mapping.srcAlias', 'Matched by column name')}
      </Pill>
    );
  return (
    <section className="card mapping-card" aria-labelledby="mapping-title">
      <div className="mapping-head">
        <div>
          <h2 id="mapping-title" className="card-title">
            {t('mapping.title', 'Match your columns')}
          </h2>
          <p className="card-sub">
            {t('mapping.sub', '{{file}} does not use the template’s column names. Check each field once; Profyn remembers the mapping for the next file.', { file: pending.what })}
          </p>
        </div>
        <div className="mapping-badges">
          {sourceBadge}
          {overall !== null ? <Pill tone="neutral">{t('mapping.confidence', 'Confidence {{pct}}', { pct: pct(overall) })}</Pill> : null}
        </div>
      </div>
      {missing.length > 0 ? (
        <Callout tone="warning" title={t('mapping.missingTitle', 'Required fields without a column: {{fields}}', { fields: missing.join(', ') })}>
          <p className="callout-hint">{t('mapping.missingHint', 'Pick a column for each, or confirm anyway: rows without them are reported on the validation report, never guessed.')}</p>
        </Callout>
      ) : null}
      <div className="table-scroll">
        <table className="table mapping-table">
          <caption className="visually-hidden">{t('mapping.caption', 'Schema field, the column in your file, and how sure the match is')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('mapping.field', 'Profyn field')}</th>
              <th scope="col">{t('mapping.column', 'Column in your file')}</th>
              <th scope="col" className="r">
                {t('mapping.match', 'Match')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ field, descKey, desc, kind }) => {
              const value = chosen[field] ?? '';
              const conf = perField?.[field];
              const selectId = `map-${field}`;
              return (
                <tr key={field} className={kind === 'required' && !value ? 'is-missing' : undefined}>
                  <th scope="row">
                    <label htmlFor={selectId} className="mapping-field">
                      <code>{field}</code>
                      {kind === 'required' ? <span className="mapping-req">{t('mapping.required', 'required')}</span> : null}
                    </label>
                    {desc ? <span className="cell-sub">{descKey ? t(descKey, desc) : desc}</span> : null}
                  </th>
                  <td>
                    <select id={selectId} className="input mapping-select" value={value} onChange={(e) => onChange(field, e.target.value || null)}>
                      <option value="">{t('mapping.none', '— not in the file —')}</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="r num">{typeof conf === 'number' && value ? pct(conf) : value ? '✓' : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mapping-actions">
        <Button variant="primary" icon="check-circle" onClick={onConfirm}>
          {t('mapping.confirm', 'Confirm mapping')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('mapping.cancel', 'Cancel')}
        </Button>
        <span className="muted small">{t('mapping.note', 'Only the column names were sent to suggest this; nothing is imported until you confirm.')}</span>
      </div>
    </section>
  );
}

export function ImportScreen() {
  const auth = useAuth();
  const account = auth.mode === 'account';
  const { samples: storeSamples, dataset, datasetId, analysis, importDataset, runAnalysis, analysing, importError, setImportError, workspace, workspaceStatus } = useStore();
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
  const [pendingMap, setPendingMap] = useState<PendingMapping | null>(null);
  const [profiles, setProfiles] = useState<ImportProfile[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  /** The report profile picked with a marketplace button, for the file chosen next. */
  const pickProfile = useRef<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapShown = pendingMap !== null;
  // The mapping step opens below the options: bring it into view.
  useEffect(() => {
    if (mapShown) revealElement(mapRef.current);
  }, [mapShown]);
  const { t } = useTranslation();
  // Sample names and descriptions in the UI language.
  const samples = storeSamples.map((s) => localiseSample(s));

  useEffect(() => {
    let cancelled = false;
    api
      .importProfiles()
      .then((list) => !cancelled && Array.isArray(list) && setProfiles(list))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  /** The server's profile id for a marketplace button: exact id, else the first profile naming that marketplace. */
  const profileIdFor = (id: string): string => {
    if (profiles.some((p) => p.id === id)) return id;
    const market = id.split('_')[0];
    return profiles.find((p) => `${p.marketplace} ${p.id}`.toLowerCase().includes(market))?.id ?? id;
  };
  const profileLabel = (id: string | null): string | null => {
    if (!id) return null;
    const p = profiles.find((x) => x.id === id);
    if (p) return p.label;
    const r = REPORT_IMPORTERS.find((x) => x.id === id);
    return r ? t(r.nameKey, r.name) : id;
  };

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
      setUploadNote(noteFor(ds, options?.appendTo ? target?.name ?? null : null, t));
    } catch {
      // importDataset has already recorded the error for the drop zone.
    } finally {
      setValidating(null);
    }
  };

  /**
   * A CSV whose headers are not the template's (or one picked with a marketplace button) goes through the mapping step:
   * POST /import/map suggests a column for each field and the person confirms once. A saved mapping applies directly.
   * A server without the mapping endpoint gets the file as before.
   */
  const prepare = async (files: File[], what: string, profile: string | null, options?: DatasetOptions) => {
    const csv = files[0] && /\.csv$/i.test(files[0].name) ? files[0] : null;
    if (!csv) return void load(files.length === 1 ? files[0] : files, what, options);
    let headers: string[] = [];
    try {
      headers = (await readCsvHead(csv)).headers;
    } catch {
      return void load(files.length === 1 ? files[0] : files, what, options);
    }
    if (!profile && headersMatchSchema(headers, REQUIRED_NAMES, SCHEMA_SET)) return void load(files.length === 1 ? files[0] : files, what, options);
    setValidating('mapping');
    setLoadError(null);
    setUploadNote(null);
    let result: ImportMapResult | null = null;
    try {
      result = await api.importMap({ headers, ...(profile ? { profile } : {}) });
    } catch {
      result = null;
    } finally {
      setValidating(null);
    }
    const withProfile = { ...options, ...(profile ? { profile } : {}) };
    if (!result || !result.mapping) return void load(files.length === 1 ? files[0] : files, what, profile ? withProfile : options);
    const chosen: ColumnMapping = { ...result.mapping };
    const usedProfile = result.profile ?? profile;
    if (result.source === 'saved' && result.unmapped_required.length === 0) {
      return void load(files.length === 1 ? files[0] : files, what, { ...options, mapping: chosen, ...(usedProfile ? { profile: usedProfile } : {}) });
    }
    setPendingMap({ files, what, headers, result, chosen, profile: usedProfile, appendTo: options?.appendTo });
  };

  const confirmMapping = () => {
    const p = pendingMap;
    if (!p) return;
    setPendingMap(null);
    void api.saveMapping({ headers: p.headers, mapping: p.chosen, ...(p.profile ? { profile: p.profile } : {}) }).catch(() => undefined);
    void load(p.files.length === 1 ? p.files[0] : p.files, p.what, {
      ...(p.appendTo ? { appendTo: p.appendTo } : {}),
      mapping: p.chosen,
      ...(p.profile ? { profile: p.profile } : {}),
    });
  };

  /** One file, or several (e.g. one CSV per month) that the API merges into one dataset. */
  const onFiles = (list: FileList | null | undefined, profile: string | null = null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    setPendingMap(null);
    const wrong = files.filter((f) => !/\.(json|csv)$/i.test(f.name));
    if (wrong.length) {
      const error: ErrorInfo = {
        message: t('import.wrongType', '{{names}} are not JSON or CSV.', { count: wrong.length, names: wrong.map((f) => f.name).join(', ') }),
        hint: t('import.wrongTypeHint', 'Export the orders as JSON or as CSV with the template column names.'),
        issues: [],
      };
      FILE_ERRORS.add(error);
      setLoadError(error);
      return;
    }
    if (files.length > MAX_FILES) {
      setLoadError({
        message: t('import.tooMany', '{{n}} files were selected; up to {{max}} can be merged at once.', { n: files.length, max: MAX_FILES }),
        hint: t('import.tooManyHint', 'Upload a year of monthly files at most.'),
        issues: [],
      });
      return;
    }
    void prepare(files, files.length === 1 ? files[0].name : t('import.nFiles', '{{n}} files', { n: files.length }), profile, appendOn && target ? { appendTo: target.id } : undefined);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    onFiles(e.dataTransfer.files);
  };

  /** Runs the analysis, then opens the overview (or the ledger, for "Continue to ledger"). */
  const onContinue = async (to: 'overview' | 'ledger' = 'overview') => {
    const id = dataset?.dataset_id ?? datasetId;
    if (!id) return;
    setContinueError(null);
    const h = handling.trim() === '' ? 0 : Number(handling);
    if (!Number.isFinite(h) || h < 0) {
      setContinueError({
        message: t('import.handlingInvalid', 'Handling per order must be a rupee amount of 0 or more.'),
        hint: t('import.handlingInvalidHint', 'Leave it at 0 when rows carry their own handling_inr.'),
        issues: [],
      });
      return;
    }
    try {
      await runAnalysis(attribution, periodEnd || undefined, id, h);
      navigate(to);
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
  const browse = (profile: string | null = null) => {
    pickProfile.current = profile;
    fileRef.current?.click();
  };

  const demoHero = (
    <section className="hero card" aria-labelledby="import-title">
      <div className="hero-text">
        <span className="pill pill-outline hero-kicker">
          <Icon name="upload-cloud" size={14} /> {t('import.kicker')}
        </span>
        <h1 id="import-title" className="hero-title">
          {t('import.title')}
        </h1>
        <p className="hero-sub">{t('import.demoSub', 'Load demo data or drop your own files. Every row is validated before anything is counted.')}</p>
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
            <span className="demo12-note">{t('import.demo12Note', 'Opens Pulse owner analytics on a year of orders.')}</span>
          </div>
        </div>
      </div>
      <HeroStats
        stats={[
          [t('import.statReference', 'reference orders'), 20],
          [t('import.statFields', 'order fields'), 12],
          [t('import.statDrills', 'data-quality drills'), drills.length],
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
          {t(
            'import.firstSub',
            'Drop a CSV or JSON export of your orders: one file, or up to {{n}} monthly files at once. Every row is validated and saved to your account, then the owner dashboard opens on your own numbers.',
            { n: MAX_FILES },
          )}
        </p>
        <div className="hero-actions">
          <Button variant="primary" size="lg" icon="upload-cloud" onClick={() => browse()} disabled={busy}>
            {t('actions.chooseFiles')}
          </Button>
          <ButtonLink variant="secondary" size="lg" icon="download" href={api.templateUrl()} download="profyn-orders-template.csv">
            {t('actions.csvTemplate')}
          </ButtonLink>
        </div>
      </div>
      <HeroStats
        stats={[
          [t('import.statRequired', 'required columns'), REQUIRED_FIELDS.length],
          [t('import.statFilesAtOnce', 'files at once'), MAX_FILES],
          [t('import.statPerDataset', 'orders per dataset'), '1,00,000'],
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
        <p className="hero-sub">
          {t('import.workspaceSub', 'Add this month’s export or open saved data. Every row is validated before anything is counted, and orders already saved are skipped.')}
        </p>
      </div>
      {saved.length > 0 ? (
        <HeroStats
          stats={[
            [t('import.statSavedDatasets', 'saved datasets', { count: saved.length }), saved.length],
            [t('import.statNewest', 'orders in the newest'), formatCount(saved[0].rows_kept)],
            [t('import.statLatestEnd', 'latest period end'), formatDate(saved[0].period_end)],
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
                <Trans
                  i18nKey="import.appendTo"
                  defaults="Add to <1>{{name}}</1> — orders already saved are skipped"
                  values={{ name: target.name }}
                  components={{ 1: <strong /> }}
                />
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
            <p className="dropzone-title">{target && appendOn ? t('import.dropToAdd', 'Drop new orders to add to {{name}}', { name: target.name }) : t('actions.dropFile')}</p>
            <p className="dropzone-sub">
              {t(
                'import.dropSub',
                'One file, or up to {{n}} at once (e.g. one per month), merged into one dataset · template column names · 50 MB each, 1,00,000 orders in total',
                { n: MAX_FILES },
              )}
            </p>
            <span className="dropzone-actions">
              <Button variant="secondary" icon="file" onClick={() => browse()} disabled={busy}>
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
                onFiles(e.target.files, pickProfile.current);
                pickProfile.current = null;
                e.target.value = '';
              }}
            />
          </div>
          {account ? (
            <p className="storage-note">
              <Icon name="lock" size={14} /> {t('import.accountStorage', 'Uploads are saved to your account.')}
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
            {t('import.aliases', 'Header aliases accepted: {{list}} …', { list: HEADER_ALIASES.map(([a]) => a).join(', ') })}
          </p>
          <section className="card market-card" aria-labelledby="market-title">
            <h2 id="market-title" className="card-title">
              {t('import.marketTitle', 'Marketplace and payment reports')}
            </h2>
            <p className="card-sub">{t('import.marketSub', 'Pick the report, then the file. Its columns are matched for you and you confirm them once.')}</p>
            <div className="market-grid">
              {REPORT_IMPORTERS.map((r) => (
                <Button key={r.id} variant="secondary" size="sm" icon="file" onClick={() => browse(profileIdFor(r.id))} disabled={busy} data-profile={r.id}>
                  {t(`import.mp.${r.id}`, `Import ${r.name}`)}
                </Button>
              ))}
            </div>
          </section>
          <ShopifyCard />
          {loadError ? <LoadErrorPanel error={loadError} /> : null}
        </div>

        <section className="card options-card" aria-labelledby="options-title">
          <h2 id="options-title" className="card-title">
            {t('import.options')}
          </h2>
          <div className="field">
            <span className="field-label" id="attr-label">
              {t('import.attribution', 'Attribution')} <InfoTip text={t(ATTRIBUTION_TIP_KEY, ATTRIBUTION_TIP_EN)} label={t('import.aboutAttribution', 'About attribution')} />
            </span>
            <AttributionSegmented value={attribution} onChange={setAttribution} compact />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="period-end">
              {t('import.periodDate', 'Period as-of date')}{' '}
              <InfoTip
                text={t('import.periodDateTip', 'Refunds dated after this day stay in the period as kept orders and are shown as pending.')}
                label={t('import.aboutPeriodDate', 'About the period date')}
              />
            </label>
            <input id="period-end" type="date" className="input input-date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="handling-default">
              {t('import.handlingLabel', 'Handling per order (estimate)')}{' '}
              <InfoTip
                text={t('import.handlingTip', 'Used only for rows without handling_inr. Labelled as an estimate everywhere.')}
                label={t('import.aboutHandling', 'About handling per order')}
              />
            </label>
            <span className="num-field num-field-wide">
              <span className="num-affix" aria-hidden="true">
                ₹
              </span>
              <input id="handling-default" type="number" inputMode="decimal" min={0} step={1} value={handling} onChange={(e) => setHandling(e.target.value)} />
            </span>
          </div>
          <Button variant="primary" size="lg" className="btn-block" iconRight="arrow-right" onClick={() => void onContinue('overview')} disabled={!canContinue}>
            {analysing ? t('actions.analysing') : t('import.continueOverview', 'Continue to overview')}
          </Button>
          <Button variant="ghost" size="sm" className="btn-block continue-ledger" onClick={() => void onContinue('ledger')} disabled={!canContinue}>
            {t('actions.continueLedger')}
          </Button>
          {!dataset && !datasetId ? (
            <p className="muted small">{account ? t('import.needDataAccount', 'Upload a file or open saved data first.') : t('import.needDataDemo', 'Load a sample or a file first.')}</p>
          ) : null}
          <ErrorCallout error={continueError} />
        </section>
      </div>

      {pendingMap ? (
        <div ref={mapRef} tabIndex={-1} className="reveal-target">
          <MappingPanel
            pending={pendingMap}
            profileLabel={profileLabel(pendingMap.profile)}
            onChange={(field, column) => setPendingMap((p) => (p ? { ...p, chosen: { ...p.chosen, [field]: column } } : p))}
            onConfirm={confirmMapping}
            onCancel={() => setPendingMap(null)}
          />
        </div>
      ) : null}

      <div aria-live="polite">
        {validating ? (
          <div className="stack" role="status" aria-label={t('import.validating', 'Validating')}>
            <p className="loading-line">
              <span className="spinner" aria-hidden="true" /> {t('import.validatingDots', 'Validating…')}
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
          dataset ? (
            <p className="muted small">
              {t('import.previousKept', 'Nothing was imported. The previous data ({{name}}) is still loaded.', {
                name: datasetName(dataset.source, dataset.files, sampleLabel(dataset.source)),
              })}
            </p>
          ) : null
        ) : dataset ? (
          <Report dataset={dataset} reveal={loadedHere} note={uploadNote} name={datasetName(dataset.source, dataset.files, sampleLabel(dataset.source))} />
        ) : datasetId ? (
          <Callout tone="info" title={t('import.lastVisit', 'The data from your last visit is loaded.')}>
            <p>
              {account
                ? t('import.lastVisitAccount', 'Upload a file or open saved data to see a validation report.')
                : t('import.lastVisitDemo', 'Load a sample or a file to see its validation report.')}
            </p>
          </Callout>
        ) : null}
      </div>

      {account ? null : (
        <section className="stack" aria-labelledby="drills-title">
          <div className="section-head">
            <h2 id="drills-title" className="section-title">
              {t('import.drills')}
            </h2>
            <span className="section-meta">{t('import.drillsMeta', 'Negative tests; each one loads a sample and shows how the checks react.')}</span>
          </div>
          <div className="drill-grid">
            {drills.map((s) => {
              const tag = DRILL_TAGS[s.source] ?? { tag: 'Drill', key: 'import.drillTag', tone: 'primary' as const };
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

      <Collapsible
        title={t('import.schemaTitle', 'View the column schema')}
        meta={t('import.schemaMeta', '{{required}} required · {{nullable}} nullable · {{optional}} optional', {
          required: REQUIRED_FIELDS.length,
          nullable: NULLABLE_FIELDS.length,
          optional: OPTIONAL_FIELDS.length,
        })}
      >
        <div className="schema-grid">
          <SchemaList title={t('import.schemaRequired', 'Required')} rows={REQUIRED_FIELDS} />
          <SchemaList title={t('import.schemaNullable', 'May be null (unknown)')} rows={NULLABLE_FIELDS} />
          <div>
            <SchemaList title={t('import.schemaOptional', 'Optional fields')} rows={OPTIONAL_FIELDS} />
            <h3 className="mini-title">{t('import.suffixTitle', 'Suffix rules')}</h3>
            <p className="small muted">
              <Trans
                i18nKey="import.suffixRules"
                defaults="<0>_inr</0> rupees · <1>_pct</1> 0–100 · <2>_units</2> counts · <3>_days</3> calendar days. Null means unknown, never zero. Rows added for the demo carry <4>synthetic: true</4>; header variants such as cogs, sku and gateway_fee are mapped."
                components={[<code key="inr" />, <code key="pct" />, <code key="units" />, <code key="days" />, <code key="synthetic" />]}
              />
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
