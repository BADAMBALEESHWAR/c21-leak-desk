import { Router } from 'express';
import { runChecks, workedOrder } from '../checks.js';
import { ah } from '../errors.js';

export const checksRouter = Router();

checksRouter.get(
  '/checks',
  ah(async (_req, res) => {
    res.json(await runChecks());
  }),
);

checksRouter.get(
  '/worked-order',
  ah(async (_req, res) => {
    res.json(await workedOrder());
  }),
);
