import { Router } from 'express';
import { z } from 'zod';
import { langOf } from '../ai/localize.js';
import { isLang } from '../ai/templates.js';
import { canSee, type AuthUser } from '../auth.js';
import { autopilots, autopilotView, markAccepted, runAutopilot, subscribe, type AutopilotEvent } from '../autopilot.js';
import { ah, HttpError, notFound } from '../errors.js';
import { datasets } from '../repo.js';
import { createDecision } from './decisions.js';

export const autopilotRouter = Router();

async function loadAutopilot(id: string, viewer?: AuthUser) {
  const doc = await autopilots.get(id);
  if (!doc || !canSee(doc.account, viewer)) throw notFound('Autopilot', id);
  return doc;
}

/** Validate → analyse → leaks → candidate scenarios → margins → Pulse in one job; explanations follow. */
autopilotRouter.post(
  '/datasets/:id/autopilot',
  ah(async (req, res) => {
    const dataset = await datasets.get(req.params.id);
    if (!dataset || !canSee(dataset.account, req.user)) throw notFound('Dataset', req.params.id);
    const raw = (req.body ?? {}) as { lang?: unknown };
    const lang = isLang(raw.lang) ? raw.lang : langOf(req, res);
    const started = Date.now();
    const doc = await runAutopilot(req, dataset, req.body ?? {}, lang);
    req.log.info({ dataset_id: dataset._id, autopilot_id: doc._id, analysis_id: doc.analysis_id, status: doc.status, compute_ms: Date.now() - started }, 'autopilot ran');
    res.status(201).json(autopilotView(doc));
  }),
);

autopilotRouter.get(
  '/autopilot/:id',
  ah(async (req, res) => {
    res.json(autopilotView(await loadAutopilot(req.params.id, req.user)));
  }),
);

/** Server-sent events: `stage` {stage,status} as stages finish, then `done` with the full document. */
autopilotRouter.get(
  '/autopilot/:id/events',
  ah(async (req, res) => {
    const first = await loadAutopilot(req.params.id, req.user);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    // no-transform keeps the compression middleware (and proxies) from buffering the stream.
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      (res as unknown as { flush?: () => void }).flush?.();
    };
    if (first.status !== 'running') {
      send('done', autopilotView(first));
      return void res.end();
    }

    let closed = false;
    const timers: NodeJS.Timeout[] = [];
    let unsubscribe = () => undefined as void;
    const close = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      timers.forEach(clearInterval);
      res.end();
    };
    unsubscribe = subscribe(first._id, (e: AutopilotEvent) => {
      if (closed) return;
      if (e.type === 'stage') send('stage', { stage: e.stage, status: e.status });
      else {
        send('done', e.doc);
        close();
      }
    });
    req.on('close', close);
    for (const [stage, status] of Object.entries(first.stages)) send('stage', { stage, status });
    // The job may have finished between the first read and the subscription, or on another instance.
    const check = async () => {
      const doc = await autopilots.get(first._id);
      if (!closed && doc && doc.status !== 'running') {
        send('done', autopilotView(doc));
        close();
      }
    };
    timers.push(setInterval(() => void check(), 2000));
    timers.push(setInterval(() => !closed && res.write(': keep-alive\n\n'), 15000));
    await check();
  }),
);

const AcceptSchema = z.object({
  rank: z.number().int().min(1).max(3),
  owner: z.string().trim().min(1).optional(),
});

/** One click: the chosen action becomes a saved decision through the same code path as POST /decisions. */
autopilotRouter.post(
  '/autopilot/:id/accept',
  ah(async (req, res) => {
    const body = AcceptSchema.parse(req.body ?? {});
    const doc = await loadAutopilot(req.params.id, req.user);
    const action = doc.actions.find((a) => a.rank === body.rank);
    if (!action) throw new HttpError(422, 'schema_invalid', `This autopilot has no action ranked ${body.rank}.`, { path: 'rank' });
    const draft = action.decision_draft;
    const decision = await createDecision(
      req,
      doc.analysis_id,
      {
        intervention: draft.intervention,
        expected_delta_inr: draft.expected_delta_inr,
        test_30d: draft.test_30d,
        stop_rule: draft.stop_rule,
        owner: body.owner ?? 'Owner',
        notes: `Accepted from Autopilot (action ${action.rank} of ${doc.actions.length}).`,
        assumptions: { source: 'autopilot', autopilot_id: doc._id, rank: action.rank, candidate_id: action.candidate_id, explanation_source: action.explanation.source },
      },
      { confidence: action.confidence },
    );
    await markAccepted(doc, action.rank, decision.decision_id);
    res.status(201).json(decision);
  }),
);
