import { Router, type Request } from 'express';
import { z } from 'zod';
import { audit, type AuditEvent } from '../audit.js';
import { accountOf, revokedAccounts } from '../auth.js';
import { clearSession, oauthFromEnv, type OAuthSettings } from '../auth-oauth.js';
import { dbState } from '../db.js';
import { ah, HttpError } from '../errors.js';
import { connectors, publicView } from '../connectors/store.js';
import { savedMappings } from '../ingest/mapper.js';
import { AnalysisModel, AuditEventModel, AutopilotModel, DatasetModel, DecisionModel, LoginModel, ScenarioModel } from '../models/index.js';
import { analyses, datasets, decisions, scenarios } from '../repo.js';
import { removePrefixes, storageKind } from '../storage.js';
import { logins, users } from '../users.js';

// Trust (v2 §5.2): the owner's audit log, a full export of everything saved under their account, and hard delete.

const owner = (req: Request) => {
  if (!req.user) throw new HttpError(401, 'unauthorized', 'Sign in to use your account.');
  return accountOf(req.user);
};

/** Export and delete must see the database: with it configured but down, they stop rather than act on part of the data. */
const needDb = () => {
  if (dbState() === 'down') throw new HttpError(503, 'db_unavailable', 'The database is not reachable, so nothing was exported or deleted. Try again shortly.');
};

/** One readable line per event, so a list can show it as it is; the structured fields stay in `data`. */
export function describe(e: Pick<AuditEvent, 'kind' | 'detail'>): string {
  const d = e.detail as Record<string, any>;
  switch (e.kind) {
    case 'import':
      return `Imported ${d.rows_added ?? '?'} orders from ${String(d.source ?? 'an upload').replace(/^upload:/, '')}${d.profile ? ` (profile ${d.profile})` : d.mapped ? ' (column mapping)' : ''}${d.rows_rejected ? `; ${d.rows_rejected} rows rejected` : ''}.`;
    case 'ai_call':
      return `AI ${d.feature ?? 'call'}${d.model ? ` via ${d.model}` : ''}: sent ${Array.isArray(d.fields_sent) ? d.fields_sent.join(', ') : 'aggregates'}; ${d.accepted ? 'accepted' : `not used${d.reason ? ` (${d.reason})` : ''}`}.`;
    case 'decision':
      return `Saved a decision on analysis ${d.analysis_id ?? ''}.`.replace(' .', '.');
    case 'export':
      return `Exported ${d.what ?? 'data'}${d.format ? ` (${d.format})` : ''}.`;
    case 'login':
      return `Signed in with ${d.provider === 'email' ? 'email' : d.provider === 'github' ? 'GitHub' : d.provider === 'google' ? 'Google' : (d.provider ?? 'a provider')}${d.new_account ? ' (new account)' : ''}.`;
    case 'consent':
      return Object.entries(d)
        .filter(([, v]) => typeof v === 'boolean')
        .map(([k, v]) => `${k === 'ai' ? 'AI on uploaded data' : k === 'email_digest' ? 'Email digest' : k}: ${v ? 'on' : 'off'}`)
        .join('; ')
        .concat('.');
    case 'mapping':
      return `Saved a column mapping${d.profile ? ` (profile ${d.profile})` : ''} for ${d.fields ?? 'some'} fields.`;
    case 'connector_connected':
      return `Connected Shopify store ${d.shop ?? ''}${d.via === 'oauth' ? ' (app install)' : ''}${d.stored === false ? ' (import only)' : ''}.`;
    case 'connector_sync':
      return `Synced Shopify store ${d.shop ?? ''}: ${d.rows_added ?? 0} new, ${d.rows_updated ?? 0} updated orders.`;
    case 'connector_disconnected':
      return `Disconnected Shopify store ${d.shop ?? ''}; its access token was deleted.`;
    default:
      return String(e.kind);
  }
}

const DeleteRequest = z.object({ confirm: z.literal('DELETE') });

/** Autopilot runs (owned by the autopilot module) are read and removed in Mongo by account. */
const autopilotDocs = async (account: string) => (dbState() === 'connected' ? AutopilotModel.find({ account }).lean() : []);
const removeAutopilots = async (account: string) => (dbState() === 'connected' ? (await AutopilotModel.deleteMany({ account })).deletedCount ?? 0 : 0);

export function accountRouter(oauth: OAuthSettings = oauthFromEnv()) {
  const router = Router();

  router.get(
    '/me/audit',
    ah(async (req, res) => {
      const account = owner(req);
      const events = await audit.list(account, 200);
      res.json(events.map((e) => ({ at: e.at, kind: e.kind, action: e.kind, detail: describe(e), data: e.detail })));
    }),
  );

  /** Where the account's data lives and how much of it there is, for the Profile page (counts only, no content). */
  router.get(
    '/me/data',
    ah(async (req, res) => {
      const account = owner(req);
      const connected = dbState() === 'connected';
      const analysisIds = connected ? (await AnalysisModel.find({ account }).select('_id').lean()).map((a) => String(a._id)) : [];
      const count = async (f: () => Promise<number>) => (connected ? f() : 0);
      const [dsN, anN, scN, dcN, lgN, auN] = await Promise.all([
        count(() => DatasetModel.countDocuments({ account })),
        count(() => AnalysisModel.countDocuments({ account })),
        count(() => ScenarioModel.countDocuments({ analysis_id: { $in: analysisIds } })),
        count(() => DecisionModel.countDocuments({ account })),
        count(() => LoginModel.countDocuments({ user_id: account })),
        count(() => AuditEventModel.countDocuments({ account })),
      ]);
      const s3 = storageKind() === 's3';
      res.json({
        database: connected ? 'MongoDB' : 'memory',
        region: s3 ? (process.env.AWS_REGION ?? 'ap-south-1') : 'local',
        file_storage: s3 ? 's3' : 'local',
        backups: s3 && connected ? 'hourly' : 'none',
        counts: { datasets: dsN, analyses: anN, scenarios: scN, decisions: dcN, sign_ins: lgN, audit_events: auN },
      });
    }),
  );

  /** Everything saved under the account, as one JSON file. */
  router.get(
    '/me/export',
    ah(async (req, res) => {
      const account = owner(req);
      needDb();
      await audit.record(req, { kind: 'export', what: 'account' });
      const mine = { account };
      const [ds, an, dc, user, signIns, events, mappings, runs, conns] = await Promise.all([
        datasets.findAll(mine, (d) => d.account === account),
        analyses.findAll(mine, (a) => a.account === account),
        decisions.findAll(mine, (d) => d.account === account),
        users.get(account),
        logins.all(account),
        audit.all(account),
        savedMappings.all(account),
        autopilotDocs(account),
        connectors.list(account),
      ]);
      const analysisIds = an.map((a) => a._id);
      const ids = new Set(analysisIds);
      const sc = await scenarios.findAll({ $or: [{ account }, { analysis_id: { $in: analysisIds } }] }, (s) => ids.has(s.analysis_id) || (s as { account?: string }).account === account);
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Disposition', `attachment; filename="profyn-export-${stamp}.json"`);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        exported_at: new Date().toISOString(),
        account,
        user,
        consent: user?.consent ?? req.user?.consent ?? null,
        logins: signIns,
        datasets: ds,
        analyses: an,
        scenarios: sc,
        decisions: dc,
        column_mappings: mappings,
        autopilots: runs,
        // Store connections without their access tokens.
        connectors: conns.map(publicView),
        audit: events,
      });
    }),
  );

  /** Hard delete: every record owned by the account, its stored files, its sign-ins, log and the user. 204. */
  router.delete(
    '/me',
    ah(async (req, res) => {
      const account = owner(req);
      const body = DeleteRequest.safeParse(req.body ?? {});
      if (!body.success) throw new HttpError(422, 'schema_invalid', 'Send {"confirm":"DELETE"} to delete your account and all its data.', { path: 'confirm' });
      needDb();
      const mine = { account };
      const an = await analyses.removeAll(mine, (a) => a.account === account);
      const ids = new Set(an.ids);
      const sc = await scenarios.removeAll({ $or: [{ account }, { analysis_id: { $in: an.ids } }] }, (s) => ids.has(s.analysis_id) || (s as { account?: string }).account === account);
      const ds = await datasets.removeAll(mine, (d) => d.account === account);
      const dc = await decisions.removeAll(mine, (d) => d.account === account);
      const [mappings, signIns, events, user, runs, conns] = await Promise.all([
        savedMappings.remove(account),
        logins.remove(account),
        audit.remove(account),
        users.remove(account),
        removeAutopilots(account),
        connectors.removeAll(account),
      ]);
      // Raw uploads are stored as uploads/<dataset id>-<file name>; large bodies under blobs/.
      const files = await removePrefixes([...ds.ids.map((id) => `uploads/${id}-`), ...ds.blobs, ...an.blobs]);
      revokedAccounts.add(account);
      clearSession(res, oauth);
      req.log?.info(
        { account, datasets: ds.ids.length, analyses: an.ids.length, scenarios: sc.ids.length, decisions: dc.ids.length, autopilots: runs, mappings, logins: signIns, audit: events, user, files, connectors: conns },
        'account deleted',
      );
      res.status(204).end();
    }),
  );

  return router;
}
