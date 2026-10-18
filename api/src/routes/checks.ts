import { Router } from 'express';
import { labelChangingReturnRates, missingRefund, MissingRefundQuerySchema, runChecks, workedOrder } from '../checks.js';
import { ah } from '../errors.js';

export const checksRouter = Router();

checksRouter.get(
  '/checks',
  ah(async (_req, res) => {
    res.json(await runChecks());
  }),
);

/**
 * Check 3 control, read-only: the missing-refund drill (O05 refund unknown) with one assumption, return_rate_pct = X.
 * Without X, the first rate that changes the recommendation label is used.
 */
checksRouter.get(
  '/checks/missing-refund',
  ah(async (req, res) => {
    const q = MissingRefundQuerySchema.parse(req.query);
    const changing = await labelChangingReturnRates();
    const x = q.return_rate_pct ?? changing[0] ?? 20;
    res.json({ ...(await missingRefund(x)), label_changing_values_pct: changing });
  }),
);

checksRouter.get(
  '/worked-order',
  ah(async (_req, res) => {
    res.json(await workedOrder());
  }),
);
