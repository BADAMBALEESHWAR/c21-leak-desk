import { Router } from 'express';
import { z } from 'zod';
import { modelFor } from '../ai/grounded.js';
import { audit } from '../audit.js';
import { accountOf } from '../auth.js';
import { ah, HttpError } from '../errors.js';
import { headerSignature, mapHeaders, profileSummaries, SCHEMA_FIELDS, savedMappings, type Mapping } from '../ingest/mapper.js';

// Column mapping for exports that are not in the C21 template (v2 §1.4). Saved mappings belong to the account
// (guests share the demo workspace), so the same report next month maps with no clicks.

export const importRouter = Router();

const Headers = z.array(z.string().max(200)).min(1, 'add at least one column header').max(500);
const MapRequest = z.object({
  headers: Headers,
  sample_rows: z.array(z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())])).max(50).optional(),
  profile: z.string().trim().min(1).optional(),
});
const MappingBody = z.record(z.string(), z.string().nullable());
const SaveRequest = z
  .object({
    header_signature: z.string().regex(/^[0-9a-f]{24}$/, 'must be the header_signature from /import/map').optional(),
    headers: Headers.optional(),
    mapping: MappingBody,
    profile: z.string().trim().min(1).nullable().optional(),
  })
  .refine((b) => b.header_signature || b.headers, { message: 'send headers or header_signature', path: ['headers'] });

importRouter.get('/import/profiles', (_req, res) => {
  res.json(profileSummaries());
});

importRouter.post(
  '/import/map',
  ah(async (req, res) => {
    const body = MapRequest.parse(req.body ?? {});
    // AI only when this caller may use it: configured, not switched off, and consent for uploaded data.
    const model = modelFor(req, null);
    const result = await mapHeaders(body, {
      account: accountOf(req.user),
      model,
      onAi: (info) => void audit.record(req, { kind: 'ai_call', feature: 'import_map', model: info.model, fields_sent: info.fields_sent, accepted: info.accepted, reason: info.reason, fields_mapped: info.fields_mapped }),
    });
    res.json(result);
  }),
);

importRouter.post(
  '/import/mappings',
  ah(async (req, res) => {
    const body = SaveRequest.parse(req.body ?? {});
    const bad = Object.keys(body.mapping).find((f) => !SCHEMA_FIELDS.includes(f));
    if (bad) throw new HttpError(422, 'schema_invalid', `${bad} is not a field of the C21 schema; map only schema fields.`, { path: `mapping.${bad}` });
    if (body.headers) {
      const present = new Set(body.headers.map((h) => h.trim().toLowerCase()));
      const missing = Object.entries(body.mapping).find(([, col]) => col !== null && !present.has(col.trim().toLowerCase()));
      if (missing) throw new HttpError(422, 'schema_invalid', `${missing[0]} is mapped to "${missing[1]}", which is not a column in this file.`, { path: `mapping.${missing[0]}` });
    }
    const signature = body.headers ? headerSignature(body.headers) : body.header_signature!;
    const mapping: Mapping = Object.fromEntries(SCHEMA_FIELDS.map((f) => [f, body.mapping[f] ?? null]));
    const saved = await savedMappings.save(accountOf(req.user), signature, body.headers ?? [], mapping, body.profile ?? null);
    void audit.record(req, { kind: 'mapping', header_signature: signature, profile: saved.profile, fields: Object.values(mapping).filter(Boolean).length });
    res.status(201).json({ header_signature: signature, mapping: saved.mapping, profile: saved.profile, saved: true, workspace: req.user ? 'account' : 'demo' });
  }),
);
