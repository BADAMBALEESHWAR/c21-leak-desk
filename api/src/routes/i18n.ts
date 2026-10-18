import { Router } from 'express';
import { langOf } from '../ai/localize.js';
import { interventionLabels, LANGS } from '../ai/templates.js';

export const i18nRouter = Router();

/** Recommendation candidate names and one-line descriptions in en, hi or te (?lang= or Accept-Language). */
i18nRouter.get('/i18n/labels', (req, res) => {
  const lang = langOf(req, res);
  const all = interventionLabels(lang);
  res.json({
    lang,
    languages: LANGS,
    candidates: all.filter((c) => c.intervention !== 'none'),
    no_change: all.find((c) => c.intervention === 'none'),
  });
});
