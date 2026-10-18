// Small scale helpers shared by the hand-written charts.
import { i18n, localeFor } from '../i18n';

export function niceTicks(lo: number, hi: number, count = 4): number[] {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/** ₹1.2L / ₹45K / ₹900 for axis ticks (Indian lakh and crore above a lakh). */
export function compactInr(v: number): string {
  const a = Math.abs(v);
  let s: string;
  if (a >= 1e7) s = `${trim(a / 1e7)}Cr`;
  else if (a >= 1e5) s = `${trim(a / 1e5)}L`;
  else if (a >= 1e3) s = `${trim(a / 1e3)}K`;
  else s = `${Math.round(a)}`;
  return `${v < 0 ? '−' : ''}₹${s}`;
}

function trim(n: number): string {
  return n >= 10 ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, '');
}

// English keeps its own short names ("Sep", where Intl's en-IN now says "Sept").
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const monthFormats = new Map<string, Intl.DateTimeFormat>();

/** Hindi and Telugu month names from Intl, in the UI language (Latin digits for the year). */
function localMonth(locale: string, year: number, month: number, short: boolean): string {
  const id = `${locale}:${short ? 's' : 'l'}`;
  let f = monthFormats.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, short ? { month: 'short', timeZone: 'UTC' } : { month: 'short', year: 'numeric', timeZone: 'UTC' });
    monthFormats.set(id, f);
  }
  return f.format(new Date(Date.UTC(year, month, 15)));
}

/** "2025-10" → "Oct 2025" (or "Oct" when short); in Hindi "अक्टू॰ 2025", in Telugu "అక్టో 2025". */
export function formatMonth(ym: string, short = false): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  const index = Number(m[2]) - 1;
  const locale = localeFor(i18n.language);
  if (locale !== 'en-IN' && index >= 0 && index < 12) return localMonth(locale, Number(m[1]), index, short);
  const name = MONTHS[index] ?? m[2];
  return short ? name : `${name} ${m[1]}`;
}

/** Path for a bar with 4px rounding at the data end and square at the baseline. */
export function barPath(x: number, w: number, y0: number, y1: number, r = 4): string {
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const h = bottom - top;
  const rr = Math.min(r, w / 2, h);
  if (h <= 0) return '';
  if (y1 <= y0) {
    // Positive value: rounded at the top.
    return `M${x},${bottom} L${x},${top + rr} Q${x},${top} ${x + rr},${top} L${x + w - rr},${top} Q${x + w},${top} ${x + w},${top + rr} L${x + w},${bottom} Z`;
  }
  // Negative value: rounded at the bottom.
  return `M${x},${top} L${x + w},${top} L${x + w},${bottom - rr} Q${x + w},${bottom} ${x + w - rr},${bottom} L${x + rr},${bottom} Q${x},${bottom} ${x},${bottom - rr} Z`;
}
