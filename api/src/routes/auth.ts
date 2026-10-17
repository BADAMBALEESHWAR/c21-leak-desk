import { Router } from 'express';
import type { AuthSettings } from '../auth.js';

/** Public sign-in settings for the web app (no secrets) and who is signed in. */
export function authRouter(settings: AuthSettings) {
  const router = Router();
  router.get('/auth/config', (_req, res) => {
    res.json(settings.publicConfig);
  });
  router.get('/me', (req, res) => {
    res.json({ user: req.user ?? null, auth_enabled: settings.enabled, workspace: req.user ? 'account' : 'demo' });
  });
  return router;
}
