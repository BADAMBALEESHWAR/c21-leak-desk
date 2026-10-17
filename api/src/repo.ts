import mongoose, { type Model } from 'mongoose';
import { dbState } from './db.js';
import type { AnalysisResult, OrderRow, ScenarioResult, ValidationFlag } from './engine/types.js';
import { HttpError } from './errors.js';
import { logger } from './logger.js';
import { AnalysisModel, DatasetModel, DecisionModel, ScenarioModel } from './models/index.js';
import type { ScenarioOverrides } from './schema/orders.js';

export interface DatasetRecord {
  _id: string;
  source: string;
  rows: OrderRow[];
  flags: ValidationFlag[];
  warnings: string[];
  schema_version: string;
  period_end: string;
  rows_in: number;
  rows_rejected: number;
  created_at: Date;
}

export interface AnalysisRecord {
  _id: string;
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

export const newId = () => new mongoose.Types.ObjectId().toHexString();

/** Write-through: memory always, Mongo when connected. persisted tells the caller which happened. */
class Collection<T extends { _id: string }> {
  private mem = new Map<string, T>();
  constructor(
    private readonly name: string,
    private readonly model: Model<any>,
  ) {}

  remember(doc: T) {
    this.mem.set(doc._id, doc);
    if (this.mem.size > MEMORY_LIMIT) this.mem.delete(this.mem.keys().next().value as string);
  }

  async save(doc: T): Promise<boolean> {
    this.remember(doc);
    if (dbState() !== 'connected') return false;
    try {
      await this.model.create(doc);
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
      return ((await this.model.findById(id).lean()) as T | null) ?? null;
    } catch {
      return null;
    }
  }

  async list(sortField: keyof T): Promise<T[]> {
    if (dbState() === 'connected') {
      const docs = (await this.model.find().sort({ [sortField as string]: -1 }).limit(100).lean()) as unknown as T[];
      return docs;
    }
    return [...this.mem.values()].sort((a, b) => (a[sortField] < b[sortField] ? 1 : -1));
  }
}

export const datasets = new Collection<DatasetRecord>('datasets', DatasetModel);
export const analyses = new Collection<AnalysisRecord>('analyses', AnalysisModel);
export const scenarios = new Collection<ScenarioRecord>('scenarios', ScenarioModel);
const decisionStore = new Collection<DecisionRecord>('decisions', DecisionModel);

/** Decisions are the saved result: they need the database when one is configured. */
export const decisions = {
  async save(doc: DecisionRecord): Promise<boolean> {
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
  list: () => decisionStore.list('saved_at'),
};
