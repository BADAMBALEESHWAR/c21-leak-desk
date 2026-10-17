/** Section C2 money format: "₹ 1,84,000" (Indian grouping, non-breaking space, minus sign U+2212). */
export function formatInr(n: number | null): string {
  if (n === null) return 'unknown';
  const abs = Math.abs(Math.round(n)).toLocaleString('en-IN');
  return `${n < 0 ? '−' : ''}₹\u00A0${abs}`;
}
