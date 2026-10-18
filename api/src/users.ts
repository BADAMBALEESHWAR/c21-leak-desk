import { createHash } from 'node:crypto';
import { LoginModel, UserModel } from './models/index.js';
import { SmallStore } from './platform-store.js';
import { newId } from './repo.js';

// Accounts (Google, GitHub or Cognito email sign-in) and their sign-in history. A user's _id is the account every
// record they own is saved under: a new id for Google/GitHub, the Cognito sub for email sign-in (so data saved before
// this collection existed stays theirs).

export type Provider = 'google' | 'github' | 'email';

export interface Consent {
  /** Uploaded data may be summarised by the AI (aggregates only). Off until the owner turns it on. */
  ai: boolean;
  email_digest: boolean;
}

export const DEFAULT_CONSENT: Consent = { ai: false, email_digest: false };

export interface UserRecord {
  _id: string;
  provider: Provider;
  provider_id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  locale: string | null;
  created_at: Date;
  last_login_at: Date;
  consent: Consent;
}

export interface LoginRecord {
  _id: string;
  user_id: string;
  provider: Provider;
  /** sha256(ip + server secret): lets the owner tell sign-ins apart without the address being stored. */
  ip_hash: string | null;
  user_agent: string | null;
  at: Date;
}

export interface Profile {
  provider: Provider;
  provider_id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  locale: string | null;
}

const userStore = new SmallStore<UserRecord>('users', UserModel);
const loginStore = new SmallStore<LoginRecord>('logins', LoginModel, 20000);

export const users = {
  get: (id: string) => userStore.get(id),

  /** Finds the user by provider + provider id and refreshes the profile, or creates them. */
  async upsert(p: Profile, now = new Date()): Promise<{ user: UserRecord; created: boolean }> {
    const existing = await userStore.findOne({ provider: p.provider, provider_id: p.provider_id });
    if (existing) {
      const user: UserRecord = {
        ...existing,
        email: p.email ?? existing.email,
        name: p.name ?? existing.name,
        avatar_url: p.avatar_url ?? existing.avatar_url,
        locale: p.locale ?? existing.locale,
        last_login_at: now,
        consent: { ...DEFAULT_CONSENT, ...(existing.consent ?? {}) },
      };
      await userStore.put(user);
      return { user, created: false };
    }
    const user: UserRecord = {
      _id: p.provider === 'email' ? p.provider_id : newId(),
      ...p,
      created_at: now,
      last_login_at: now,
      consent: { ...DEFAULT_CONSENT },
    };
    await userStore.put(user);
    return { user, created: true };
  },

  async setConsent(id: string, patch: Partial<Consent>): Promise<UserRecord | null> {
    const user = await userStore.get(id);
    if (!user) return null;
    const next = { ...user, consent: { ...DEFAULT_CONSENT, ...(user.consent ?? {}), ...patch } };
    await userStore.put(next);
    return next;
  },

  /** Re-creates a signed-in user's record from their session when this process has none (memory-only mode after a restart). */
  async restore(u: { _id: string; provider?: string; email: string | null; name: string | null }): Promise<UserRecord> {
    const existing = await userStore.get(u._id);
    if (existing) return existing;
    const provider = (['google', 'github', 'email'].includes(u.provider ?? '') ? u.provider : 'email') as Provider;
    const now = new Date();
    const user: UserRecord = { _id: u._id, provider, provider_id: u._id, email: u.email, name: u.name, avatar_url: null, locale: null, created_at: now, last_login_at: now, consent: { ...DEFAULT_CONSENT } };
    await userStore.put(user);
    return user;
  },

  remove: (id: string) => userStore.remove({ _id: id }),
};

export const ipHash = (ip: string | null, secret: string) => (ip ? createHash('sha256').update(`${ip}|${secret}`).digest('hex') : null);

export const logins = {
  async record(input: { user_id: string; provider: Provider; ip: string | null; user_agent: string | null; secret: string }): Promise<LoginRecord> {
    const row: LoginRecord = {
      _id: newId(),
      user_id: input.user_id,
      provider: input.provider,
      ip_hash: ipHash(input.ip, input.secret),
      user_agent: input.user_agent ? input.user_agent.slice(0, 300) : null,
      at: new Date(),
    };
    await loginStore.put(row);
    return row;
  },
  recent: (userId: string, limit = 20) => loginStore.find({ user_id: userId }, 'at', limit),
  all: (userId: string) => loginStore.find({ user_id: userId }, 'at', 0, true),
  remove: (userId: string) => loginStore.remove({ user_id: userId }),
};
