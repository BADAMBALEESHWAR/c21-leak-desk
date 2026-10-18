// Share a summary on WhatsApp or the clipboard. The text is built only from what the API already returned (headline
// contribution, the top actions with their ₹ change, the digest), formatted like the rest of the app, with the app's link.
// No phone number and no tracking parameter is added.
import type { TFunction } from 'i18next';
import type { Digest } from '../api/types';
import { formatInr, formatSignedInr } from './format';

export const SHARE_MAX = 700;

export interface ShareInput {
  t: TFunction;
  heading: string;
  contribution: number | null | undefined;
  actions: Array<{ label: string; delta: number | null }>;
  digest: Digest | null;
  url: string;
  max?: number;
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1)).trimEnd()}…`);

/** Heading, contribution and the top three actions first; then digest sections while they fit; the link last. */
export function shareText({ t, heading, contribution, actions, digest, url, max = SHARE_MAX }: ShareInput): string {
  const lines = [heading];
  if (typeof contribution === 'number') lines.push(t('share.contribution', 'Operational contribution: {{inr}}', { inr: formatInr(contribution) }));
  const top = actions.slice(0, 3);
  if (top.length > 0) {
    lines.push(t('share.actions', 'Top actions (expected change):'));
    top.forEach((a, i) => lines.push(`${i + 1}. ${a.label}: ${a.delta === null ? t('overview.unknownAmount', 'amount unknown') : formatSignedInr(a.delta)}`));
  }
  const budget = max - url.length - 1;
  let text = clip(lines.join('\n'), budget);
  for (const s of digest?.sections ?? []) {
    if (!s.text) continue;
    const line = s.title ? `${s.title}: ${s.text}` : s.text;
    const room = budget - text.length - 1;
    if (line.length <= room) {
      text += `\n${line}`;
      continue;
    }
    if (room > 60) text += `\n${clip(line, room)}`;
    break;
  }
  return `${text}\n${url}`;
}

/** wa.me with the text only: WhatsApp asks whom to send it to. */
export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** The app's own link: the demo for a demo session, else the app (which asks the reader to sign in). */
export function appUrl(demo: boolean): string {
  return `${window.location.origin}/app/${demo ? '?mode=demo' : ''}`;
}

/** Clipboard API first, then the older copy command; false when the browser allows neither. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Blocked (no focus, insecure origin): try the fallback.
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
