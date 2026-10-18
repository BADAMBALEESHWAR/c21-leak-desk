import express, { Router, type Request } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { dbState } from '../db.js';
import { defaultPeriodEnd, validateRows, type SourceFile } from '../engine/validate.js';
import { templateCsv } from '../export/csv.js';
import { canSee, accountOf } from '../auth.js';
import { audit } from '../audit.js';
import { headersOf, ingestMapped, parseDelimited, readSpec, type MappingSpec } from '../ingest/mapper.js';
import { correctDataset, CorrectionRequestSchema, correctedOrderIds, MAX_REJECTED_ROWS, rejectedRowsOf } from '../corrections.js';
import { ah, HttpError, notFound } from '../errors.js';
import { parseCsv, parseJsonPayload, parseJsonText, type Ingested } from '../ingest.js';
import { analyses, datasets, newId, type DatasetRecord } from '../repo.js';
import { DatasetSourceRequestSchema, IsoDate, SCHEMA_VERSION } from '../schema/orders.js';
import { put, readSample, safeName, SAMPLES } from '../storage.js';

/** Monthly exports can be uploaded together (a year at most); each file up to 5 MB, 10,000 orders in total. */
export const MAX_FILES = 12;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxBodyBytes, files: MAX_FILES } });

export const datasetsRouter = Router();

datasetsRouter.get('/template.csv', (_req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="profyn-orders-template.csv"');
  res.type('text/csv; charset=utf-8').send(templateCsv());
});

datasetsRouter.get('/samples', (_req, res) => {
  res.json(Object.entries(SAMPLES).map(([source, s]) => ({ source, label: s.label, description: s.description, file: `data/${s.file}` })));
});

export interface Incoming {
  source: string;
  ingested: Ingested;
  period_end?: string;
  raw?: Array<{ name: string; body: Buffer | string; type: string }>;
  /** Set when several files were merged into one dataset. */
  files?: SourceFile[];
  /** Set when a column mapping or import profile turned the file into C21 rows. */
  mapped?: { profile: string | null; mapping: boolean };
}

const isCsv = (name: string, mime?: string) => name.toLowerCase().endsWith('.csv') || mime === 'text/csv';
/** With a mapping, marketplace exports are read too: Amazon writes tab-separated .txt, others .tsv. */
const isDelimited = (name: string, mime?: string) => isCsv(name, mime) || /\.(tsv|txt)$/i.test(name) || mime === 'text/tab-separated-values' || mime === 'text/plain';

/** JSON rows to map: {records:{orders}}, {orders}, {rows} or a bare array. */
function jsonRows(body: unknown, name = 'The file'): Record<string, unknown>[] {
  const b = body as { records?: { orders?: unknown }; orders?: unknown; rows?: unknown } | unknown[];
  const rows = Array.isArray(b) ? b : (b?.records?.orders ?? b?.orders ?? b?.rows);
  if (!Array.isArray(rows)) {
    throw new HttpError(422, 'schema_invalid', `${name} does not match the order template: records.orders Required.`, { path: 'records.orders', hint: 'Use {"records":{"orders":[...]}} as in the sample file, or an array of orders.' });
  }
  return rows.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object' && !Array.isArray(r));
}

function readMapped(text: string, name: string, delimited: boolean, spec: MappingSpec): Ingested {
  if (delimited) {
    const { headers, rows } = parseDelimited(text, name);
    return ingestMapped(rows, headers, spec, name);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(422, 'schema_invalid', `${name} is not valid JSON.`, { path: 'file', hint: 'Check the file is UTF-8 JSON.' });
  }
  const rows = jsonRows(body, name);
  return ingestMapped(rows, headersOf(rows), spec, name);
}

function readFile(file: Express.Multer.File, spec?: MappingSpec | null): Ingested {
  const text = file.buffer.toString('utf8');
  const name = file.originalname;
  if (spec) {
    const json = name.toLowerCase().endsWith('.json') || file.mimetype === 'application/json';
    if (!json && !isDelimited(name, file.mimetype)) {
      throw new HttpError(415, 'unsupported_type', `${name} is not JSON or CSV. Use JSON or CSV with the template columns.`, { path: 'file' });
    }
    return readMapped(text, name, !json, spec);
  }
  if (isCsv(name, file.mimetype)) return parseCsv(text, name);
  if (name.toLowerCase().endsWith('.json') || file.mimetype === 'application/json') return parseJsonText(text, name);
  throw new HttpError(415, 'unsupported_type', `${name} is not JSON or CSV. Use JSON or CSV with the template columns.`, { path: 'file' });
}

const rawOf = (file: Express.Multer.File) => ({ name: file.originalname, body: file.buffer, type: isDelimited(file.originalname, file.mimetype) ? 'text/csv' : 'application/json' });
const mappedOf = (spec: MappingSpec | null) => (spec ? { profile: spec.profile?.id ?? null, mapping: Boolean(spec.mapping) } : undefined);

async function readIncoming(req: Request): Promise<Incoming> {
  const type = req.headers['content-type'] ?? '';
  const periodParam = typeof req.query.period_end === 'string' ? IsoDate.parse(req.query.period_end) : undefined;

  if (type.startsWith('multipart/form-data')) {
    const uploaded = Array.isArray(req.files) ? req.files : [];
    if (uploaded.length === 0) throw new HttpError(422, 'schema_invalid', 'Attach the file in a form field named "file".', { path: 'file' });
    const period = typeof req.body?.period_end === 'string' && req.body.period_end ? IsoDate.parse(req.body.period_end) : periodParam;
    const spec = readSpec(req.body?.mapping, req.body?.profile);
    const parts = uploaded.map((file) => ({ file, ingested: readFile(file, spec) }));
    if (parts.length === 1) {
      const [{ file, ingested }] = parts;
      return { source: `upload:${file.originalname}`, ingested, period_end: period, raw: [rawOf(file)], mapped: mappedOf(spec) };
    }
    const total = parts.reduce((n, p) => n + p.ingested.orders.length, 0);
    if (total > config.maxRows) {
      throw new HttpError(413, 'file_too_large', `The ${parts.length} files have ${total.toLocaleString('en-IN')} orders together; the limit is ${config.maxRows.toLocaleString('en-IN')}.`, { hint: 'Upload fewer months at a time.' });
    }
    const files: SourceFile[] = [];
    const orders: unknown[] = [];
    for (const p of parts) {
      files.push({ name: p.file.originalname, start: orders.length, path_prefix: `${p.file.originalname} ${p.ingested.path_prefix}`, line_offset: p.ingested.line_offset });
      orders.push(...p.ingested.orders);
    }
    const names = parts.map((p) => p.file.originalname);
    const source = names.join(' + ').length <= 80 ? `upload:${names.join(' + ')}` : `upload:${names[0]} + ${names.length - 1} more files`;
    return { source, ingested: { orders, path_prefix: 'rows', line_offset: 0 }, period_end: period, raw: uploaded.map(rawOf), files, mapped: mappedOf(spec) };
  }

  if (type.startsWith('text/csv')) {
    const text = String(req.body ?? '');
    const spec = readSpec(req.query.mapping, req.query.profile);
    const ingested = spec ? readMapped(text, 'The CSV', true, spec) : parseCsv(text);
    return { source: 'upload:csv', ingested, period_end: periodParam, raw: [{ name: 'orders.csv', body: text, type: 'text/csv' }], mapped: mappedOf(spec) };
  }

  if (type.startsWith('application/json')) {
    const body = req.body as Record<string, unknown> | unknown[];
    if (body && !Array.isArray(body) && 'source' in body && !('records' in body)) {
      const r = DatasetSourceRequestSchema.parse(body);
      const sample = await readSample(r.source);
      const ingested = isCsv(sample.name) ? parseCsv(sample.text) : parseJsonText(sample.text, sample.name);
      return { source: r.source, ingested, period_end: r.period_end ?? periodParam };
    }
    const spec = body && !Array.isArray(body) ? readSpec(body.mapping, body.profile) : null;
    if (spec) {
      const rows = jsonRows(body);
      const period = typeof (body as { period_end?: unknown }).period_end === 'string' ? IsoDate.parse((body as { period_end: string }).period_end) : periodParam;
      return { source: 'upload:json', ingested: ingestMapped(rows, headersOf(rows), spec), period_end: period, mapped: mappedOf(spec) };
    }
    return { source: 'upload:json', ingested: parseJsonPayload(body), period_end: periodParam };
  }

  throw new HttpError(415, 'unsupported_type', 'Use JSON or CSV in the C21 schema (application/json, text/csv or multipart/form-data with a "file" field).');
}

export const summary = (d: DatasetRecord) => ({
  dataset_id: d._id,
  source: d.source,
  rows_in: d.rows_in,
  rows_kept: d.rows.length,
  rows_rejected: d.rows_rejected,
  kept_ids: d.rows.map((r) => r.order_id),
  synthetic_rows: d.rows.filter((r) => r.synthetic === true).length,
  flags: d.flags,
  warnings: d.warnings,
  period_end: d.period_end,
  schema_version: d.schema_version,
  ...(d.files ? { files: d.files } : {}),
  ...(d.supersedes ? { supersedes: d.supersedes } : {}),
  rejected_rows: d.rejected_rows ?? [],
  corrections: d.corrections ?? [],
  corrected_order_ids: correctedOrderIds(d.corrections),
});

/** Adding to saved data: the later of two ISO dates. */
const later = (a: string, b: string) => (a > b ? a : b);
/** An upload aimed at an older version (a second tab, a quick double upload) goes onto the newest one instead. */
async function newestVersion(start: DatasetRecord, account: string): Promise<DatasetRecord> {
  const versions = await datasets.summaries(account, 'created_at', '_id supersedes created_at');
  let current = start;
  for (let hop = 0; hop < 50; hop++) {
    const next = versions.find((v) => v.supersedes === current._id);
    const record = next ? await datasets.get(next._id) : null;
    if (!record) break;
    current = record;
  }
  return current;
}

/** End of the month of the latest dated order in an upload, or null when none is dated. */
const newPeriodEnd = (orders: unknown[]) => {
  const dated = orders.filter((o): o is { date: string } => typeof (o as { date?: unknown })?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test((o as { date: string }).date));
  return dated.length ? defaultPeriodEnd(dated) : null;
};
const labelOf = (names: string[]) => (names.join(' + ').length <= 80 ? `upload:${names.join(' + ')}` : `upload:${names[0]} + ${names.length - 1} more files`);

/** The dataset an import is added to: the newest version of `appendTo` (404 when the caller cannot see it); null without one. */
export async function appendBase(req: Request, appendTo: string): Promise<DatasetRecord | null> {
  if (!appendTo) return null;
  const first = await datasets.get(appendTo);
  if (!first || !canSee(first.account, req.user)) throw notFound('Dataset', appendTo);
  return newestVersion(first, accountOf(req.user));
}

export interface CommitOptions {
  /** When the import started (for the log line). */
  started?: number;
  /** Saved rows with these order ids give way to the incoming rows (a connector sync: an order refunded since the last import). */
  replace_ids?: ReadonlySet<string>;
  /** Source label kept when adding to saved data (connectors), instead of the list of uploaded files. */
  source_label?: string;
  /** This batch's name in `files` when adding to saved data. */
  batch_name?: string;
  /** Extra fields for the import audit event. */
  audit?: Record<string, unknown>;
}

/**
 * Validates incoming rows and saves them as a dataset (or a new version of `base`): the one ingestion path for uploads
 * and connectors. Returns the status and body POST /datasets answers with.
 */
export async function commitImport(
  req: Request,
  incoming: Incoming,
  base: DatasetRecord | null,
  opts: CommitOptions = {},
): Promise<{ status: 200 | 201; body: Record<string, unknown>; record: DatasetRecord }> {
  const started = opts.started ?? Date.now();
  const replace = opts.replace_ids?.size ? opts.replace_ids : undefined;
  const baseRows = base ? (replace ? base.rows.filter((r) => !replace.has(r.order_id)) : base.rows) : [];
  const existing = base ? new Set(baseRows.map((r) => r.order_id)) : undefined;
  const v = validateRows(incoming.ingested.orders, {
    period_end: incoming.period_end ?? (base ? later(base.period_end, newPeriodEnd(incoming.ingested.orders) ?? base.period_end) : undefined),
    path_prefix: incoming.ingested.path_prefix,
    line_offset: incoming.ingested.line_offset,
    files: incoming.files,
    existing_ids: existing,
  });
  const ignored = existing ? v.flags.filter((fl) => fl.reason === 'duplicate' && fl.order_id !== null && existing.has(fl.order_id)).length : 0;
  if (v.rows_kept === 0 && base && ignored > 0) {
    // Nothing new: the saved dataset stays as it is.
    return {
      status: 200,
      record: base,
      body: {
        ...summary(base),
        flags: v.flags,
        rows_in: v.rows_in,
        rows_rejected: v.rows_rejected,
        rows_added: 0,
        duplicates_ignored: ignored,
        appended_to: base._id,
        unchanged: true,
        message: `Nothing new: all ${ignored.toLocaleString('en-IN')} orders were already saved.`,
        persisted: dbState() === 'connected',
      },
    };
  }
  if (v.rows_kept === 0) {
    const issues = v.flags.filter((f) => f.action !== 'kept').map((f) => ({ path: f.path ?? `line ${f.line}`, message: f.detail }));
    throw new HttpError(422, 'no_valid_rows', `Every row was rejected. First problem: ${issues[0]?.message ?? 'no orders.'}`, {
      path: issues[0]?.path,
      issues,
      hint: 'Fix the named fields and upload again.',
    });
  }
  const id = newId();
  const thisUpload = incoming.files?.map((f, i, all) => ({ name: f.name, rows: (all[i + 1]?.start ?? v.rows_in) - f.start })) ?? [
    { name: opts.batch_name ?? (incoming.source.replace(/^upload:/, '') || 'upload'), rows: v.rows_in },
  ];
  const rows = base ? [...baseRows, ...v.rows] : v.rows;
  if (rows.length > config.maxRows) {
    throw new HttpError(413, 'file_too_large', `Saved orders plus this upload come to ${rows.length.toLocaleString('en-IN')}; the limit is ${config.maxRows.toLocaleString('en-IN')}.`, { hint: 'Start a new dataset for a later period.' });
  }
  const replaced = replace ? v.rows.filter((r) => replace.has(r.order_id)).length : 0;
  const rejectedHere = rejectedRowsOf(v.flags, incoming.ingested.orders, { line_offset: incoming.ingested.line_offset, files: incoming.files });
  const rejectedRows = [...(base?.rejected_rows ?? []), ...rejectedHere].slice(0, MAX_REJECTED_ROWS);
  const files = base ? [...(base.files ?? [{ name: base.source.replace(/^upload:/, ''), rows: base.rows.length }]), ...thisUpload] : incoming.files ? thisUpload : undefined;
  for (const raw of incoming.raw ?? []) await put(`uploads/${id}-${safeName(raw.name)}`, raw.body, raw.type).catch(() => undefined);
  const baseFlags = base ? (replace ? base.flags.filter((f) => f.order_id === null || !replace.has(f.order_id)) : base.flags) : [];
  const record: DatasetRecord = {
    _id: id,
    account: accountOf(req.user),
    source: base ? (opts.source_label ?? labelOf(files!.map((x) => x.name))) : incoming.source,
    rows,
    flags: base ? [...baseFlags, ...v.flags] : v.flags,
    warnings: base ? [...new Set([...base.warnings, ...v.warnings])] : v.warnings,
    schema_version: SCHEMA_VERSION,
    period_end: base ? later(base.period_end, v.period_end) : v.period_end,
    rows_in: (base?.rows_in ?? 0) + v.rows_in,
    rows_rejected: (base?.rows_rejected ?? 0) + v.rows_rejected,
    rows_kept: rows.length,
    ...(files ? { files } : {}),
    ...(base ? { supersedes: base._id } : {}),
    rejected_rows: rejectedRows,
    ...(base?.corrections ? { corrections: base.corrections } : {}),
    created_at: new Date(),
  };
  const persisted = await datasets.save(record);
  req.log?.info({ dataset_id: id, rows_kept: rows.length, added: v.rows_kept, replaced, ignored, flags: v.flags.length, parse_ms: Date.now() - started }, 'dataset imported');
  void audit.record(req, {
    kind: 'import',
    dataset_id: id,
    source: record.source,
    rows_added: v.rows_kept - replaced,
    rows_rejected: v.rows_rejected,
    profile: incoming.mapped?.profile ?? null,
    mapped: Boolean(incoming.mapped),
    ...(opts.audit ?? {}),
  });
  return {
    status: 201,
    record,
    body: {
      ...summary(record),
      // The report describes this upload; the record keeps everything saved so far.
      flags: v.flags,
      rows_in: v.rows_in,
      rows_rejected: v.rows_rejected,
      rows_added: v.rows_kept - replaced,
      duplicates_ignored: ignored,
      ...(opts.replace_ids ? { rows_updated: replaced } : {}),
      ...(base ? { appended_to: base._id } : {}),
      ...(files ? { files } : {}),
      ...(incoming.mapped ? { mapped: incoming.mapped } : {}),
      persisted,
    },
  };
}

datasetsRouter.post(
  '/datasets',
  upload.array('file', MAX_FILES),
  express.text({ type: 'text/csv', limit: config.maxBodyBytes }),
  ah(async (req, res) => {
    const started = Date.now();
    // append_to: add this upload to an existing dataset; orders whose id is already saved are ignored, never counted twice.
    const appendTo = typeof req.query.append_to === 'string' ? req.query.append_to : typeof req.body?.append_to === 'string' ? req.body.append_to : '';
    const base = await appendBase(req, appendTo);
    const incoming = await readIncoming(req);
    const { status, body } = await commitImport(req, incoming, base, { started });
    res.status(status).json(body);
  }),
);


/** The signed-in owner's saved datasets, newest first, each with its latest analysis. A visitor without a token is in the demo workspace, which keeps nothing. */
datasetsRouter.get(
  '/workspace',
  ah(async (req, res) => {
    if (!req.user) return void res.json({ workspace: 'demo', user: null, datasets: [], latest: null });
    const account = accountOf(req.user);
    const [ds, an] = await Promise.all([
      datasets.summaries(account, 'created_at', '_id source period_end rows_in rows_kept rows_rejected files supersedes created_at'),
      analyses.summaries(account, 'created_at', '_id dataset_id attribution created_at result.totals'),
    ]);
    const latestFor = new Map<string, (typeof an)[number]>();
    for (const a of an) if (a.dataset_id && !latestFor.has(a.dataset_id)) latestFor.set(a.dataset_id, a);
    // An upload added to saved data makes a new version; only the newest version of each is listed.
    const superseded = new Set(ds.map((d) => d.supersedes).filter(Boolean));
    const list = ds.filter((d) => !superseded.has(d._id)).map((d) => {
      const a = latestFor.get(d._id);
      return {
        dataset_id: d._id,
        source: d.source,
        period_end: d.period_end,
        rows_kept: d.rows_kept ?? (d.rows ? d.rows.length : (d.rows_in ?? 0) - (d.rows_rejected ?? 0)),
        files: d.files ?? null,
        created_at: d.created_at,
        latest_analysis: a ? { analysis_id: a._id, attribution: a.attribution, created_at: a.created_at, contribution_inr: a.result?.totals?.contribution_inr ?? null } : null,
      };
    });
    // The newest saved data is what the owner last worked on; its analysis may not exist yet (analysis_id null).
    const latest = list[0] ?? null;
    res.json({
      workspace: 'account',
      user: req.user,
      datasets: list,
      latest: latest ? { dataset_id: latest.dataset_id, analysis_id: latest.latest_analysis?.analysis_id ?? null } : null,
    });
  }),
);

/**
 * Correct one row: a kept row (by order_id) or a rejected raw row (by order_id, or line and file). The same validation
 * re-runs over every row and the result is saved as a new version owned by the caller; the old version is unchanged.
 */
datasetsRouter.patch(
  '/datasets/:id/rows',
  ah(async (req, res) => {
    const body = CorrectionRequestSchema.parse(req.body ?? {});
    const d = await datasets.get(req.params.id);
    if (!d || !canSee(d.account, req.user)) throw notFound('Dataset', req.params.id);
    const { record, added, still_flagged } = correctDataset(d, body, accountOf(req.user));
    const persisted = await datasets.save(record);
    req.log.info({ dataset_id: record._id, supersedes: d._id, corrections: added.length, still_flagged: still_flagged.length }, 'dataset corrected');
    res.status(201).json({ ...summary(record), corrections_added: added, still_flagged, persisted });
  }),
);

datasetsRouter.get(
  '/datasets/:id',
  ah(async (req, res) => {
    const d = await datasets.get(req.params.id);
    if (!d || !canSee(d.account, req.user)) throw notFound('Dataset', req.params.id);
    res.json(summary(d));
  }),
);
