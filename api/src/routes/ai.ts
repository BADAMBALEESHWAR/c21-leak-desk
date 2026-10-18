import { Router } from 'express';
import { activeModelName, aiConfigured, aiPolicy, consentOf } from '../ai/grounded.js';
import { aiCounts, FIELDS_SENT, persistedCounts, REGION_NOTE } from '../ai/guardlog.js';
import { canSee } from '../auth.js';
import { ah } from '../errors.js';
import { datasets } from '../repo.js';

// AI transparency (v2 §5.1): what the model is, how often it was called, how many AI texts the number guard accepted
// or rejected, and exactly which fields leave the API for each feature.

export const aiRouter = Router();

export const DEFAULT_POLICY = 'AI is on only for demo data (built-in samples or files whose rows are all labelled synthetic) unless you consent; uploaded customer data uses templates.';

aiRouter.get(
  '/ai/status',
  ah(async (req, res) => {
    const c = aiCounts();
    const header = String(req.headers['x-profyn-ai'] ?? '').trim().toLowerCase();
    const consent = consentOf(req);
    let policy: ReturnType<typeof aiPolicy> | undefined;
    if (typeof req.query.dataset_id === 'string') {
      const d = await datasets.get(req.query.dataset_id);
      if (d && canSee(d.account, req.user)) policy = aiPolicy(req, d);
    }
    res.json({
      enabled: aiConfigured(),
      model: activeModelName(),
      provider: 'Gemini',
      region_note: REGION_NOTE,
      calls: c.calls,
      accepted: c.accepted,
      rejected: c.rejected,
      failed: c.failed,
      by_feature: c.by_feature,
      fields_sent: FIELDS_SENT,
      all_time: await persistedCounts(),
      switch: { header: header === 'off' ? 'off' : null, consent: consent ?? null, default_policy: DEFAULT_POLICY },
      ...(policy ? { policy } : {}),
    });
  }),
);
