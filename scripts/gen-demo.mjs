// Generates data/demo_12m.json: a labelled synthetic 12-month brand for the Pulse owner analytics.
// Fixed seed, so every run writes byte-identical data. Never used by /checks.
//   node scripts/gen-demo.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let seed = 20261017;
const rnd = () => {
  // mulberry32
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (items) => {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = rnd() * total;
  for (const [v, w] of items) if ((x -= w) <= 0) return v;
  return items[items.length - 1][0];
};
const round10 = (n) => Math.round(n / 10) * 10;

// Products: price, unit cost, base return probability. P2 is the volume hero with high returns.
const PRODUCTS = {
  'P1 Classic tee': { price: 799, cost: 300, ret: 0.10, weight: 22 },
  'P2 Denim jacket': { price: 2499, cost: 1350, ret: 0.36, weight: 30 },
  'P3 Linen shirt': { price: 1499, cost: 620, ret: 0.14, weight: 16 },
  'P4 Sneakers': { price: 3299, cost: 1700, ret: 0.18, weight: 12 },
  'P5 Socks pack': { price: 399, cost: 140, ret: 0.04, weight: 14 },
  'P6 Tote bag': { price: 599, cost: 210, ret: 0.06, weight: 10 },
};
const CHANNELS = [['web', 45], ['marketplace', 30], ['instagram', 25]];
// Month weights: festive peak in October 2025 (Diwali) and a smaller one in November.
const MONTHS = [
  ['2025-10', 420, 0.28], ['2025-11', 300, 0.18], ['2025-12', 240, 0.12], ['2026-01', 200, 0.10],
  ['2026-02', 190, 0.10], ['2026-03', 220, 0.12], ['2026-04', 230, 0.10], ['2026-05', 240, 0.12],
  ['2026-06', 230, 0.10], ['2026-07', 250, 0.15], ['2026-08', 260, 0.12], ['2026-09', 240, 0.10],
]; // [month, orders, average discount depth]
const days = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();

const customers = [];
const orders = [];
let n = 0;
for (const [month, count, depth] of MONTHS) {
  for (let i = 0; i < count; i++) {
    n++;
    const product = pick(Object.entries(PRODUCTS).map(([k, v]) => [k, v.weight]));
    const p = PRODUCTS[product];
    const channel = pick(CHANNELS);
    const cod = rnd() < (channel === 'marketplace' ? 0.35 : 0.5);
    const units = rnd() < 0.85 ? 1 : 2;
    const gross = p.price * units;
    const disc = Math.min(0.6, Math.max(0, depth + (rnd() - 0.5) * 0.16));
    const discount = round10(gross * disc);
    const paid = gross - discount;
    // Repeat customers: 30% of orders come from an existing customer and need no paid acquisition.
    let customer;
    const repeat = customers.length > 50 && rnd() < 0.3;
    if (repeat) customer = customers[Math.floor(rnd() * customers.length)];
    else {
      customer = `C${String(customers.length + 1).padStart(5, '0')}`;
      customers.push(customer);
    }
    const shipping = paid < 600 ? 85 : paid < 1500 ? 70 : 90;
    const fee = cod ? 45 : Math.round(paid * 0.02);
    const handling = 20;
    const adsBase = channel === 'instagram' ? 0.4 : channel === 'web' ? 0.1 : 0.06;
    const ads = repeat ? 0 : round10(paid * adsBase);
    // COD orders return about 3× as often as prepaid ones.
    const retP = Math.min(0.75, p.ret * (cod ? 1.55 : 0.52) * (channel === 'instagram' ? 1.3 : 1));
    const returned = rnd() < retP;
    const day = 1 + Math.floor(rnd() * days(month));
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const cost = p.cost * units;
    const row = {
      order_id: `D${String(n).padStart(5, '0')}`,
      date,
      gross_inr: gross,
      discount_inr: discount,
      refund_inr: 0,
      net_sales_inr: paid,
      product_cost_inr: cost,
      recovered_product_cost_inr: 0,
      shipping_inr: shipping,
      payment_fee_inr: fee,
      return_cost_inr: 0,
      returned,
      channel,
      product_id: product.split(' ')[0],
      ads_inr: ads,
      handling_inr: handling,
      units,
      payment_type: cod ? 'cod' : 'prepaid',
      customer_id: customer,
      synthetic: true,
    };
    if (returned) {
      const recovered = round10(cost * (0.55 + rnd() * 0.4));
      row.refund_inr = paid;
      row.net_sales_inr = 0;
      row.recovered_product_cost_inr = recovered;
      row.return_cost_inr = cod ? 95 : 70;
      // A few returns in the last month have no refund amount yet: unknown, never zero.
      if (month === '2026-09' && rnd() < 0.12) {
        row.refund_inr = null;
        row.net_sales_inr = null;
        row.recovered_product_cost_inr = null;
      }
    }
    orders.push(row);
  }
}

const file = {
  case_id: 'C21',
  synthetic: true,
  data_version: 'v3.2',
  currency: 'INR unless explicitly stated',
  missing_values: 'null means unknown, never zero',
  description:
    'Labelled synthetic 12-month demo brand for the Profyn Pulse owner analytics (Oct 2025 – Sep 2026, fixed seed). ' +
    'Built-in patterns: festive October peak with deeper discounts; P2 high volume with high returns; Instagram volume at negative contribution; ' +
    'COD returns about 3x prepaid; small orders lose on shipping; some September refunds not yet known. Not observed data; never used by the public checks.',
  records: { orders },
};
writeFileSync(path.join(root, 'data', 'demo_12m.json'), JSON.stringify(file, null, 1) + '\n');
console.log(`wrote data/demo_12m.json: ${orders.length} orders, ${customers.length} customers`);
