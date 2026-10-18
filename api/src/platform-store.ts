import type { Model } from 'mongoose';
import { dbState } from './db.js';
import { logger } from './logger.js';

// Small documents for the platform (users, logins, audit events, saved mappings): memory always, Mongo when connected.
// Unlike repo.ts these are updated in place (replaceOne with upsert), and every lookup can filter on plain fields.

type Filter<T> = Partial<Record<keyof T & string, unknown>>;

const matches = <T>(doc: T, filter: Filter<T>) => Object.entries(filter).every(([k, v]) => (doc as Record<string, unknown>)[k] === v);
const time = (v: unknown) => (v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) || 0 : Number(v) || 0);

export class SmallStore<T extends { _id: string }> {
  private mem = new Map<string, T>();
  constructor(
    private readonly name: string,
    private readonly model: Model<any>,
    private readonly cap = 5000,
  ) {}

  private remember(doc: T) {
    this.mem.delete(doc._id);
    this.mem.set(doc._id, doc);
    while (this.mem.size > this.cap) this.mem.delete(this.mem.keys().next().value as string);
  }

  /** Insert or replace by _id. Returns true when Mongo has it too. */
  async put(doc: T): Promise<boolean> {
    this.remember(doc);
    if (dbState() !== 'connected') return false;
    try {
      await this.model.replaceOne({ _id: doc._id }, doc, { upsert: true });
      return true;
    } catch (err) {
      logger.warn({ err: (err as Error).message, collection: this.name }, 'mongo write failed; kept in memory');
      return false;
    }
  }

  async get(id: string): Promise<T | null> {
    const hit = this.mem.get(id);
    if (hit) return hit;
    if (dbState() !== 'connected') return null;
    try {
      const doc = (await this.model.findById(id).lean()) as T | null;
      if (doc) this.remember(doc);
      return doc;
    } catch {
      return null;
    }
  }

  async findOne(filter: Filter<T>): Promise<T | null> {
    for (const d of this.mem.values()) if (matches(d, filter)) return d;
    if (dbState() !== 'connected') return null;
    try {
      const doc = (await this.model.findOne(filter).lean()) as T | null;
      if (doc) this.remember(doc);
      return doc;
    } catch {
      return null;
    }
  }

  /** Matching documents, newest first by `sortField`; `limit` 0 means all. `strict` (export) fails rather than return memory only. */
  async find(filter: Filter<T>, sortField: keyof T & string, limit = 0, strict = false): Promise<T[]> {
    const memory = [...this.mem.values()].filter((d) => matches(d, filter));
    let docs: T[] = [];
    if (dbState() === 'connected') {
      try {
        const q = this.model.find(filter).sort({ [sortField]: -1 });
        if (limit) q.limit(limit);
        docs = (await q.lean()) as T[];
      } catch (err) {
        if (strict) throw err;
        logger.warn({ err: (err as Error).message, collection: this.name }, 'mongo read failed; memory only');
      }
    }
    const seen = new Set(docs.map((d) => d._id));
    const all = [...docs, ...memory.filter((d) => !seen.has(d._id))].sort((a, b) => time(b[sortField]) - time(a[sortField]));
    return limit ? all.slice(0, limit) : all;
  }

  /** Deletes every matching document from memory and Mongo; returns how many were removed. */
  async remove(filter: Filter<T>): Promise<number> {
    let n = 0;
    for (const [id, d] of [...this.mem]) {
      if (matches(d, filter)) {
        this.mem.delete(id);
        n++;
      }
    }
    if (dbState() === 'connected') {
      const r = await this.model.deleteMany(filter);
      n = Math.max(n, r.deletedCount ?? 0);
    }
    return n;
  }
}
