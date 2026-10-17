// Formatting for the public pages: Indian digit grouping, ₹ without a space, U+2212 for minus.

const MINUS = '−';
const grouped = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });

/** ₹2,999 · ₹1,23,456 · −₹180 (whole rupees). */
export function inr(n: number): string {
  const r = Math.round(n);
  const body = `₹${grouped.format(Math.abs(r))}`;
  return r < 0 ? `${MINUS}${body}` : body;
}

/** +₹2,520 · −₹2,520 · ₹0 */
export function signedInr(n: number): string {
  const r = Math.round(n);
  return r > 0 ? `+${inr(r)}` : inr(r);
}

/** Compact Indian units for chart labels: ₹6.7K · ₹3.85L · ₹1.2Cr */
export function compactInr(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? MINUS : '';
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7, 2)}Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5, a >= 1e6 ? 1 : 2)}L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3, 1)}K`;
  return `${sign}₹${Math.round(a)}`;
}

function trim(v: number, places: number): string {
  return v.toFixed(places).replace(/\.?0+$/, '');
}

export function pct(n: number): string {
  const body = `${oneDecimal.format(Math.abs(n))}%`;
  return n < 0 ? `${MINUS}${body}` : body;
}

export function count(n: number): string {
  return grouped.format(n);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2025-10" → "Oct 2025" (short: "Oct"). */
export function month(key: string, short = false): string {
  const [y, m] = key.split('-').map(Number);
  const name = MONTHS[(m || 1) - 1] ?? key;
  return short ? name : `${name} ${y}`;
}

/** Engine text uses "₹ 1,234" and lower-case channel ids; the public pages write "₹1,234" and "Instagram". */
export function tidy(text: string): string {
  return text.replace(/₹\s/g, '₹').replace(/\b(instagram|marketplace|web)\b/g, (c) => c.charAt(0).toUpperCase() + c.slice(1));
}

export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
