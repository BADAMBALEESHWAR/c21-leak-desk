import express, { Router, type Request } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { validateRows } from '../engine/validate.js';
import { templateCsv } from '../export/csv.js';
import { ah, HttpError, notFound } from '../errors.js';
import { parseCsv, parseJsonPayload, parseJsonText, type Ingested } from '../ingest.js';
import { datasets, newId, type DatasetRecord } from '../repo.js';
import { DatasetSourceRequestSchema, IsoDate, SCHEMA_VERSION } from '../schema/orders.js';
import { put, readSample, safeName, SAMPLES } from '../storage.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxBodyBytes, files: 1 } });

export const datasetsRouter = Router();

datasetsRouter.get('/template.csv', (_req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="c21-orders-template.csv"');
  res.type('text/csv; charset=utf-8').send(templateCsv());
});

datasetsRouter.get('/samples', (_req, res) => {
  res.json(Object.entries(SAMPLES).map(([source, s]) => ({ source, label: s.label, description: s.description, file: `data/${s.file}` })));
});

interface Incoming {
  source: string;
  ingested: Ingested;
  period_end?: string;
  raw?: { name: string; body: Buffer | string; type: string };
}

const isCsv = (name: string, mime?: string) => name.toLowerCase().endsWith('.csv') || mime === 'text/csv';

async function readIncoming(req: Request): Promise<Incoming> {
  const type = req.headers['content-type'] ?? '';
  const periodParam = typeof req.query.period_end === 'string' ? IsoDate.parse(req.query.period_end) : undefined;

  if (type.startsWith('multipart/form-data')) {
    const file = req.file;
    if (!file) throw new HttpError(422, 'schema_invalid', 'Attach the file in a form field named "file".', { path: 'file' });
    const period = typeof req.body?.period_end === 'string' && req.body.period_end ? IsoDate.parse(req.body.period_end) : periodParam;
    const text = file.buffer.toString('utf8');
    const name = file.originalname;
    if (isCsv(name, file.mimetype)) return { source: `upload:${name}`, ingested: parseCsv(text), period_end: period, raw: { name, body: file.buffer, type: 'text/csv' } };
    if (name.toLowerCase().endsWith('.json') || file.mimetype === 'application/json') {
      return { source: `upload:${name}`, ingested: parseJsonText(text, name), period_end: period, raw: { name, body: file.buffer, type: 'application/json' } };
    }
    throw new HttpError(415, 'unsupported_type', `${name} is not JSON or CSV. Use JSON or CSV in the C21 schema.`, { path: 'file' });
  }

  if (type.startsWith('text/csv')) {
    const text = String(req.body ?? '');
    return { source: 'upload:csv', ingested: parseCsv(text), period_end: periodParam, raw: { name: 'orders.csv', body: text, type: 'text/csv' } };
  }

  if (type.startsWith('application/json')) {
    const body = req.body as Record<string, unknown> | unknown[];
    if (body && !Array.isArray(body) && 'source' in body && !('records' in body)) {
      const r = DatasetSourceRequestSchema.parse(body);
      const sample = await readSample(r.source);
      const ingested = isCsv(sample.name) ? parseCsv(sample.text) : parseJsonText(sample.text, sample.name);
      return { source: r.source, ingested, period_end: r.period_end ?? periodParam };
    }
    return { source: 'upload:json', ingested: parseJsonPayload(body), period_end: periodParam };
  }

  throw new HttpError(415, 'unsupported_type', 'Use JSON or CSV in the C21 schema (application/json, text/csv or multipart/form-data with a "file" field).');
}

const summary = (d: DatasetRecord) => ({
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
});

datasetsRouter.post(
  '/datasets',
  upload.single('file'),
  express.text({ type: 'text/csv', limit: config.maxBodyBytes }),
  ah(async (req, res) => {
    const started = Date.now();
    const incoming = await readIncoming(req);
    const v = validateRows(incoming.ingested.orders, {
      period_end: incoming.period_end,
      path_prefix: incoming.ingested.path_prefix,
      line_offset: incoming.ingested.line_offset,
    });
    if (v.rows_kept === 0) {
      const issues = v.flags.filter((f) => f.action !== 'kept').map((f) => ({ path: f.path ?? `line ${f.line}`, message: f.detail }));
      throw new HttpError(422, 'no_valid_rows', `Every row was rejected. First problem: ${issues[0]?.message ?? 'no orders.'}`, {
        path: issues[0]?.path,
        issues,
        hint: 'Fix the named fields and upload again.',
      });
    }
    const id = newId();
    if (incoming.raw) await put(`uploads/${id}-${safeName(incoming.raw.name)}`, incoming.raw.body, incoming.raw.type).catch(() => undefined);
    const record: DatasetRecord = {
      _id: id,
      source: incoming.source,
      rows: v.rows,
      flags: v.flags,
      warnings: v.warnings,
      schema_version: SCHEMA_VERSION,
      period_end: v.period_end,
      rows_in: v.rows_in,
      rows_rejected: v.rows_rejected,
      created_at: new Date(),
    };
    const persisted = await datasets.save(record);
    req.log.info({ dataset_id: id, rows_kept: v.rows_kept, flags: v.flags.length, parse_ms: Date.now() - started }, 'dataset imported');
    res.status(201).json({ ...summary(record), persisted });
  }),
);

datasetsRouter.get(
  '/datasets/:id',
  ah(async (req, res) => {
    const d = await datasets.get(req.params.id);
    if (!d) throw notFound('Dataset', req.params.id);
    res.json(summary(d));
  }),
);
