// Splits an orders file (fixture-format JSON or a bare array) into one CSV per month, ready to upload together on Import.
//   node scripts/split-months.mjs data/demo_12m.json out/demo-months
// Writes <out>/<YYYY-MM>.csv with every column found in the file; empty cells stay unknown (never zero).
import fs from 'node:fs';
import path from 'node:path';

const [input, outDir] = process.argv.slice(2);
if (!input || !outDir) {
  console.error('Usage: node scripts/split-months.mjs <orders.json> <out-dir>');
  process.exit(1);
}
const body = JSON.parse(fs.readFileSync(input, 'utf8'));
const orders = Array.isArray(body) ? body : body?.records?.orders;
if (!Array.isArray(orders)) {
  console.error(`${input} has no orders (expected {"records":{"orders":[...]}} or an array).`);
  process.exit(1);
}

const columns = [...new Set(orders.flatMap((o) => Object.keys(o)))];
const cell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const byMonth = new Map();
for (const o of orders) {
  const month = typeof o.date === 'string' ? o.date.slice(0, 7) : 'no-date';
  if (!byMonth.has(month)) byMonth.set(month, []);
  byMonth.get(month).push(o);
}

fs.mkdirSync(outDir, { recursive: true });
for (const [month, rows] of [...byMonth].sort(([a], [b]) => a.localeCompare(b))) {
  const csv = [columns.join(','), ...rows.map((o) => columns.map((c) => cell(o[c])).join(','))].join('\n') + '\n';
  const file = path.join(outDir, `${month}.csv`);
  fs.writeFileSync(file, csv);
  console.log(`${file}  ${rows.length} orders`);
}
console.log(`${byMonth.size} files, ${orders.length} orders. Upload them together on Import (up to 12 files, 10,000 orders in total).`);
