import { gunzipSync, gzipSync } from 'node:zlib';
import mongoose, { type Model } from 'mongoose';
import { dbState } from './db.js';
import type { AnalysisResult, OrderRow, ScenarioResult, ValidationFlag } from './engine/types.js';
import { HttpError } from './errors.js';
import { logger } from './logger.js';
import { AnalysisModel, DatasetModel, DecisionModel, ScenarioModel } from './models/index.js';
import type { ScenarioOverrides } from './schema/orders.js';
import { get as getObject, put as putObject } from './storage.js';

export interface DatasetRecord {
  _id: string;
  account?: string;
  source: string;
  rows: OrderRow[];
  flags: ValidationFlag[];
  warnings: string[];
  schema_version: string;
  period_end: string;
  rows_in: number;
  rows_rejected: number;
  /** Kept rows, stored so a workspace list never has to load the rows themselves. */
  rows_kept?: number;
  /** Files merged into this dataset, in upload order. */
  files?: Array<{ name: string; rows: number }>;
  /** The dataset this one extends (an upload added to saved data). */
  supersedes?: string;
  created_at: Date;
}

export interface AnalysisRecord {
  _id: string;
  account?: string;
  dataset_id: string;
  engine_version: string;
  attribution: string;
  period_end: string;
  config: AnalysisResult['config'];
  channel_spend?: Record<string, number>;
  result: AnalysisResult;
  created_at: Date;
}

export interface ScenarioRecord {
  _id: string;
  analysis_id: string;
  overrides: ScenarioOverrides;
  result: ScenarioResult;
  created_at: Date;
}

export interface DecisionRecord {
  _id: string;
  account?: string;
  analysis_id: string;
  scenario_id?: string;
  intervention: string;
  intervention_label: string;
  notes?: string;
  assumptions: Record<string, unknown>;
  expected_delta_inr: number | null;
  confidence: string;
  test_30d: string;
  stop_rule: string;
  owner: string;
  engine_version: string;
  evidence: Record<string, unknown>;
  saved_at: Date;
}

const MEMORY_LIMIT = 200;
/** In-memory copies are capped by size as well as count: a 60,000-order analysis is about 100 MB as JSON. */
const MEMORY_BYTES = 300 * 1024 * 1024;
/**
 * A Mongo document is capped at 16 MB. Above this size the heavy field (a dataset's rows, an analysis result) is stored
 * gzipped in object storage (S3, or data/uploads locally) and the document keeps only a pointer to it.
 */
const BLOB_BYTES = 4 * 1024 * 1024;

export const newId = () => new mongoose.Types.ObjectId().toHexString();

interface Heavy<T> {
  field: keyof T & string;
  /** Rough JSON size of the field, without serialising it. */
  bytes: (doc: T) => number;
}

/** Write-through: memory always, Mongo when connected. persisted tells the caller which happened. */
class Collection<T extends { _id: string }> {
  private mem = new Map<string, { doc: T; bytes: number }>();
  private memBytes = 0;
  constructor(
    private readonly name: string,
    private readonly model: Model<any>,
    private readonly heavy?: Heavy<T>,
  ) {}

  private sizeOf(doc: T): number {
    return this.heavy ? this.heavy.bytes(doc) : 0;
  }

  remember(doc: T, bytes = this.sizeOf(doc)) {
    const prev = this.mem.get(doc._id);
    if (prev) {
      this.mem.delete(doc._id);
      this.memBytes -= prev.bytes;
    }
    // Very large records are read back from storage when needed, unless memory is all there is.
    if (bytes > MEMORY_BYTES / 2 && dbState() === 'connected') return;
    this.mem.set(doc._id, { doc, bytes });
    this.memBytes += bytes;
    while ((this.mem.size > MEMORY_LIMIT || this.memBytes > MEMORY_BYTES) && this.mem.size > 1) {
      const [oldest, entry] = this.mem.entries().next().value as [string, { doc: T; bytes: number }];
      this.mem.delete(oldest);
      this.memBytes -= entry.bytes;
    }
  }

  async save(doc: T): Promise<boolean> {
    const bytes = this.sizeOf(doc);
    this.remember(doc, bytes);
    if (dbState() !== 'connected') return false;
    try {
      let stored: T | (Omit<T, keyof T & string> & Record<string, unknown>) = doc;
      if (this.heavy && bytes > BLOB_BYTES) {
        const key = `blobs/${this.name}/${doc._id}.json.gz`;
        await putObject(key, gzipSync(JSON.stringify(doc[this.heavy.field])), 'application/gzip');
        stored = { ...doc, [this.heavy.field]: null, blob: key };
      }
      await this.model.create(stored);
      return true;
    } catch (err) {
      logger.warn({ err: (err as Error).message, collection: this.name }, 'mongo write failed; kept in memory');
      return false;
    }
  }

  async get(id: string): Promise<T | null> {
    const hit = this.mem.get(id);
    if (hit) {
      // Most recently used stays longest.
      this.mem.delete(id);
      this.mem.set(id, hit);
      return hit.doc;
    }
    if (dbState() !== 'connected') return null;
    try {
      const doc = (await this.model.findById(id).lean()) as (T & { blob?: string }) | null;
      if (!doc) return null;
      if (this.heavy && doc.blob) {
        const buf = await getObject(doc.blob);
        if (!buf) {
          logger.warn({ collection: this.name, id, blob: doc.blob }, 'stored record body is missing');
          return null;
        }
        (doc as Record<string, unknown>)[this.heavy.field] = JSON.parse(gunzipSync(buf).toString('utf8'));
        delete doc.blob;
        this.remember(doc);
      }
      return doc;
    } catch {
      return null;
    }
  }

  /** One account's records only (never guest or shared ones), newest first, with just the named fields from Mongo. */
  async summaries(account: string, sortField: keyof T & string, fields: string): Promise<Array<Partial<T> & { _id: string }>> {
    const memory = [...this.mem.values()].map((e) => e.doc).filter((d) => (d as { account?: string }).account === account);
    if (dbState() !== 'connected') return memory.sort((a, b) => (a[sortField] < b[sortField] ? 1 : -1));
    const docs = (await this.model.find({ account }).select(fields).sort({ [sortField]: -1 }).limit(50).lean()) as unknown as Array<Partial<T> & { _id: string }>;
    const seen = new Set(docs.map((d) => d._id));
    const key = (d: Partial<T>) => String(d[sortField] instanceof Date ? (d[sortField] as Date).toISOString() : d[sortField]);
    return [...docs, ...memory.filter((d) => !seen.has(d._id))].sort((a, b) => (key(a) < key(b) ? 1 : -1));
  }

  async list(sortField: keyof T, account?: string): Promise<T[]> {
    const mine = (d: T) => account === undefined || (d as { account?: string }).account === account || (account === 'guest' && !(d as { account?: string }).account);
    const memory = [...this.mem.values()].map((e) => e.doc).filter(mine);
    if (dbState() === 'connected') {
      const query = account === undefined ? {} : account === 'guest' ? { $or: [{ account: 'guest' }, { account: { $exists: false } }] } : { account };
      const docs = (await this.model.find(query).sort({ [sortField as string]: -1 }).limit(100).lean()) as unknown as T[];
      const seen = new Set(docs.map((d) => d._id));
      return [...docs, ...memory.filter((d) => !seen.has(d._id))].sort((a, b) => (a[sortField] < b[sortField] ? 1 : -1));
    }
    return memory.sort((a, b) => (a[sortField] < b[sortField] ? 1 : -1));
  }
}

export const datasets = new Collection<DatasetRecord>('datasets', DatasetModel, { field: 'rows', bytes: (d) => (d.rows?.length ?? 0) * 450 });
export const analyses = new Collection<AnalysisRecord>('analyses', AnalysisModel, { field: 'result', bytes: (a) => (a.result?.orders?.length ?? 0) * 1700 });
export const scenarios = new Collection<ScenarioRecord>('scenarios', ScenarioModel);
const decisionStore = new Collection<DecisionRecord>('decisions', DecisionModel);

/** Decisions are the saved result: they need the database when one is configured. */
export const decisions = {
  async save(doc: DecisionRecord, opts: { memoryOnly?: boolean } = {}): Promise<boolean> {
    if (opts.memoryOnly) {
      decisionStore.remember(doc);
      return false;
    }
    const state = dbState();
    if (state === 'down') {
      throw new HttpError(503, 'db_unavailable', 'The database is not reachable, so the decision was not saved. Check that Mongo is running, then save again.');
    }
    const persisted = await decisionStore.save(doc);
    if (state === 'connected' && !persisted) {
      throw new HttpError(503, 'db_unavailable', 'The database rejected the write, so the decision was not saved. Try again.');
    }
    return persisted;
  },
  get: (id: string) => decisionStore.get(id),
  list: (account?: string) => decisionStore.list('saved_at', account),
};
