// Formatting for the public pages: Indian digit grouping, ₹ without a space, U+2212 for minus.
// Numbers, month names and the K / L / Cr units follow the UI language; digits stay Latin in all three.
import { i18n, localeFor } from '../i18n';

const MINUS = '−';

interface Formatters {
  grouped: Intl.NumberFormat;
  oneDecimal: Intl.NumberFormat;
  month: Intl.DateTimeFormat;
  monthYear: Intl.DateTimeFormat;
}

const formatters = new Map<string, Formatters>();

/** Formatters for the current UI language, made once per locale. */
function fmt(): Formatters {
  const tag = `${localeFor(i18n.language)}-u-nu-latn`;
  let f = formatters.get(tag);
  if (!f) {
    f = {
      grouped: new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }),
      oneDecimal: new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }),
      month: new Intl.DateTimeFormat(tag, { month: 'short' }),
      monthYear: new Intl.DateTimeFormat(tag, { month: 'short', year: 'numeric' }),
    };
    formatters.set(tag, f);
  }
  return f;
}

/** ₹2,999 · ₹1,23,456 · −₹180 (whole rupees). */
export function inr(n: number): string {
  const r = Math.round(n);
  const body = `₹${fmt().grouped.format(Math.abs(r))}`;
  return r < 0 ? `${MINUS}${body}` : body;
}

/** +₹2,520 · −₹2,520 · ₹0 */
export function signedInr(n: number): string {
  const r = Math.round(n);
  return r > 0 ? `+${inr(r)}` : inr(r);
}

/** Compact Indian units for chart labels: ₹6.7K · ₹3.85L · ₹1.2Cr (हज़ार / लाख / करोड़ in Hindi, వేలు / లక్షలు / కోట్లు in Telugu). */
export function compactInr(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? MINUS : '';
  if (a >= 1e7) return `${sign}₹${i18n.t('landing.unitCrore', '{{n}}Cr', { n: trim(a / 1e7, 2) })}`;
  if (a >= 1e5) return `${sign}₹${i18n.t('landing.unitLakh', '{{n}}L', { n: trim(a / 1e5, a >= 1e6 ? 1 : 2) })}`;
  if (a >= 1e3) return `${sign}₹${i18n.t('landing.unitThousand', '{{n}}K', { n: trim(a / 1e3, 1) })}`;
  return `${sign}₹${Math.round(a)}`;
}

function trim(v: number, places: number): string {
  return v.toFixed(places).replace(/\.?0+$/, '');
}

export function pct(n: number): string {
  const body = `${fmt().oneDecimal.format(Math.abs(n))}%`;
  return n < 0 ? `${MINUS}${body}` : body;
}

export function count(n: number): string {
  return fmt().grouped.format(n);
}

/** English keeps its three-letter names (en-IN Intl writes "Sept"); Hindi and Telugu use Intl. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2025-10" → "Oct 2025" (short: "Oct"); "अक्टू॰ 2025" in Hindi, "అక్టో 2025" in Telugu. */
export function month(key: string, short = false): string {
  const [y, m] = key.split('-').map(Number);
  if (localeFor(i18n.language) === 'en-IN' || !y || !m) {
    const name = MONTHS[(m || 1) - 1] ?? key;
    return short ? name : `${name} ${y}`;
  }
  const d = new Date(y, m - 1, 1);
  return short ? fmt().month.format(d) : fmt().monthYear.format(d);
}

/** Engine text uses "₹ 1,234" and lower-case channel ids; the public pages write "₹1,234" and "Instagram". */
export function tidy(text: string): string {
  return text.replace(/₹\s/g, '₹').replace(/\b(instagram|marketplace|web)\b/g, (c) => c.charAt(0).toUpperCase() + c.slice(1));
}

export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
