// Number and date formatting. Indian digit grouping, U+2212 minus, no-break space after ₹.

export const MINUS = '−';
export const NBSP = ' ';

const moneyFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const countFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const oneDecimalFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });

function isZero(n: number, places: number): boolean {
  return Math.round(Math.abs(n) * 10 ** places) === 0;
}

/** ₹ 1,84,000 · −₹ 180 · ₹ 0 */
export function formatInr(n: number): string {
  const body = `₹${NBSP}${moneyFmt.format(Math.abs(n))}`;
  return n < 0 && !isZero(n, 2) ? `${MINUS}${body}` : body;
}

/** +₹ 50 · −₹ 50 · ₹ 0 */
export function formatSignedInr(n: number): string {
  if (n > 0 && !isZero(n, 2)) return `+${formatInr(n)}`;
  return formatInr(n);
}

/** Percent with one decimal at most: 20% · 87.5% · −3.2% */
export function formatPct(n: number): string {
  const body = `${oneDecimalFmt.format(Math.abs(n))}%`;
  return n < 0 && !isZero(n, 1) ? `${MINUS}${body}` : body;
}

export function formatSignedPct(n: number): string {
  if (n > 0 && !isZero(n, 1)) return `+${formatPct(n)}`;
  return formatPct(n);
}

export function formatCount(n: number): string {
  const body = countFmt.format(Math.abs(n));
  return n < 0 ? `${MINUS}${body}` : body;
}

/** Up to one decimal, signed with U+2212 when negative. */
export function formatDecimal(n: number): string {
  const body = oneDecimalFmt.format(Math.abs(n));
  return n < 0 && !isZero(n, 1) ? `${MINUS}${body}` : body;
}

export function formatSignedDecimal(n: number): string {
  if (n > 0 && !isZero(n, 1)) return `+${formatDecimal(n)}`;
  return formatDecimal(n);
}

/** Local date and time with seconds, e.g. 17 Oct 2026, 14:05:09 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** A calendar day, e.g. 30 Sep 2026. Plain YYYY-MM-DD dates are read as that day, not shifted by the time zone. */
export function formatDate(iso: string): string {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(day ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** O01, O02, O03, O05 -> "O01–O03, O05". Ids that do not end in digits are listed as-is. */
export function compressIds(ids: string[]): string {
  const parts: string[] = [];
  let runStart: string | null = null;
  let runEnd: string | null = null;
  let prev: { prefix: string; num: number; width: number } | null = null;

  const flush = () => {
    if (runStart === null) return;
    parts.push(runStart === runEnd ? runStart : `${runStart}–${runEnd}`);
    runStart = null;
    runEnd = null;
  };

  for (const id of ids) {
    const m = /^(.*?)(\d+)$/.exec(id);
    if (!m) {
      flush();
      prev = null;
      parts.push(id);
      continue;
    }
    const cur = { prefix: m[1], num: Number(m[2]), width: m[2].length };
    if (prev && runStart !== null && cur.prefix === prev.prefix && cur.width === prev.width && cur.num === prev.num + 1) {
      runEnd = id;
    } else {
      flush();
      runStart = id;
      runEnd = id;
    }
    prev = cur;
  }
  flush();
  return parts.join(', ');
}

export function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "Duplicate order" -> "duplicate order", but "C21 fixture" stays as it is. */
export function lowerFirst(s: string): string {
  if (s.length < 2 || /^[A-Z0-9]{2}/.test(s)) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}
