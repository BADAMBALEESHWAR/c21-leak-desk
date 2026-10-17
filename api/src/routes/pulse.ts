import { Router } from 'express';
import { pulseChannels, pulseInsights, pulseLeaks, pulseMonths, pulseOverview, pulseProducts } from '../engine/pulse.js';
import { ah, HttpError } from '../errors.js';
import { loadAnalysis } from './analyses.js';

export const pulseRouter = Router();

const VIEWS = {
  months: pulseMonths,
  products: pulseProducts,
  channels: pulseChannels,
  leaks: pulseLeaks,
  insights: pulseInsights,
} as const;

// Read-only owner analytics; cached per analysis (analyses are immutable once computed).
const cache = new Map<string, unknown>();
const CACHE_LIMIT = 200;
const remember = (key: string, value: unknown) => {
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return value;
};

pulseRouter.get(
  '/analyses/:id/pulse/:view',
  ah(async (req, res) => {
    const view = req.params.view;
    const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : undefined;
    if (view !== 'overview' && !(view in VIEWS)) {
      throw new HttpError(404, 'not_found', `No Pulse view "${view}". Use overview, months, products, channels, leaks or insights.`);
    }
    const { analysis } = await loadAnalysis(req.params.id, req.user);
    const key = `${req.params.id}:${view}:${month ?? ''}`;
    if (cache.has(key)) return void res.json(cache.get(key));
    const result = view === 'overview' ? pulseOverview(analysis.result, month) : VIEWS[view as keyof typeof VIEWS](analysis.result);
    res.json(remember(key, { analysis_id: analysis._id, ...result }));
  }),
);
