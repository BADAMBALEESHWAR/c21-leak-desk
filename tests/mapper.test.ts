import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../api/src/app';
import {
  applyMapping,
  detectProfile,
  mapHeaders,
  maskSamples,
  parseDelimited,
  PROFILES,
  type MappingModel,
} from '../api/src/ingest/mapper';

// v2 §1.4: column mapper. Each marketplace profile maps a small export written with that tool's real column names;
// what nobody can map stays null (unknown, never zero); the AI sees column shapes, never values; saved mappings return.

const app = createApp({ auth: { enabled: false, verify: null, publicConfig: { enabled: false, domain: null, client_id: null, region: 'ap-south-1' } } });
const api = '/api/v1';

const SHOPIFY = [
  'Name,Email,Financial Status,Paid at,Fulfillment Status,Currency,Subtotal,Shipping,Taxes,Total,Discount Code,Discount Amount,Created at,Lineitem quantity,Lineitem name,Lineitem price,Lineitem sku,Refunded Amount,Payment Method,Source,Cost,Ship Cost',
  '#1001,asha.rao@example.in,paid,2026-09-02 14:31:05 +0530,fulfilled,INR,1800.00,60.00,0.00,1860.00,DIWALI10,200.00,2026-09-02 14:31:05 +0530,2,Kurta Blue,900.00,KUR-BLU-M,0.00,Razorpay (UPI),web,700,55',
  '#1001,asha.rao@example.in,,,,,,,,,,,,1,Dupatta Red,200.00,DUP-RED,,,,,',
  '#1002,vikram.s@example.in,refunded,2026-09-05 10:02:11 +0530,fulfilled,INR,1299.00,0.00,0.00,1299.00,,0.00,2026-09-05 10:02:11 +0530,1,Saree Silk,1299.00,SAR-SLK-01,1299.00,Cash on Delivery (COD),web,520,60',
].join('\n');

const AMAZON = [
  ['settlement-id', 'settlement-start-date', 'settlement-end-date', 'deposit-date', 'total-amount', 'currency', 'transaction-type', 'order-id', 'merchant-order-id', 'adjustment-id', 'shipment-id', 'marketplace-name', 'amount-type', 'amount-description', 'amount', 'fulfillment-id', 'posted-date', 'order-item-code', 'sku', 'quantity-purchased'],
  ['11223344556', '01.09.2026', '15.09.2026', '17.09.2026', '2450.75', 'INR', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['11223344556', '', '', '', '', '', 'Order', '403-1111111-1111111', '', '', 'S1', 'Amazon.in', 'ItemPrice', 'Principal', '999.00', 'AFN', '03.09.2026', '7001', 'TEE-01', '1'],
  ['11223344556', '', '', '', '', '', 'Order', '403-1111111-1111111', '', '', 'S1', 'Amazon.in', 'ItemPrice', 'Tax', '179.82', 'AFN', '03.09.2026', '7001', 'TEE-01', '1'],
  ['11223344556', '', '', '', '', '', 'Order', '403-1111111-1111111', '', '', 'S1', 'Amazon.in', 'Promotion', 'Principal', '-100.00', 'AFN', '03.09.2026', '7001', 'TEE-01', '1'],
  ['11223344556', '', '', '', '', '', 'Order', '403-1111111-1111111', '', '', 'S1', 'Amazon.in', 'ItemFees', 'Commission', '-89.91', 'AFN', '03.09.2026', '7001', 'TEE-01', '1'],
  ['11223344556', '', '', '', '', '', 'Order', '403-1111111-1111111', '', '', 'S1', 'Amazon.in', 'ItemFees', 'FixedClosingFee', '-25.00', 'AFN', '03.09.2026', '7001', 'TEE-01', '1'],
  ['11223344556', '', '', '', '', '', 'Order', '403-1111111-1111111', '', '', 'S1', 'Amazon.in', 'ItemFees', 'FBAPerUnitFulfillmentFee', '-48.00', 'AFN', '03.09.2026', '7001', 'TEE-01', '1'],
  ['11223344556', '', '', '', '', '', 'Order', '403-2222222-2222222', '', '', 'S2', 'Amazon.in', 'ItemPrice', 'Principal', '1499.00', 'AFN', '05.09.2026', '7002', 'HOOD-02', '1'],
  ['11223344556', '', '', '', '', '', 'Order', '403-2222222-2222222', '', '', 'S2', 'Amazon.in', 'ItemFees', 'Commission', '-134.91', 'AFN', '05.09.2026', '7002', 'HOOD-02', '1'],
  ['11223344556', '', '', '', '', '', 'Order', '403-2222222-2222222', '', '', 'S2', 'Amazon.in', 'ItemFees', 'FBAWeightBasedFee', '-62.00', 'AFN', '05.09.2026', '7002', 'HOOD-02', '1'],
  ['11223344556', '', '', '', '', '', 'Refund', '403-2222222-2222222', '', 'A9', 'S2', 'Amazon.in', 'ItemPrice', 'Principal', '-1499.00', 'AFN', '12.09.2026', '7002', 'HOOD-02', ''],
  ['11223344556', '', '', '', '', '', 'Refund', '403-2222222-2222222', '', 'A9', 'S2', 'Amazon.in', 'ItemFees', 'RefundCommission', '-27.00', 'AFN', '12.09.2026', '7002', 'HOOD-02', ''],
]
  .map((r) => r.join('\t'))
  .join('\n');

const FLIPKART = [
  'Ordered On,Shipment ID,ORDER ITEM ID,Order Id,HSN CODE,Order State,Order Type,FSN,SKU,Product,Invoice No.,Invoice Date (mm/dd/yy),Invoice Amount,Selling Price Per Item,Shipping Charge per item,Quantity,Buyer name,Pincode,State',
  '2026-09-04,SHP001,OI-9001,OD330011223344,6109,DELIVERED,prepaid,TSHFZ123,TEE-WHT-L,Cotton Tee White L,FAAB001,09/04/26,1198.00,599.00,0.00,2,Ravi Kumar,500081,Telangana',
  '2026-09-06,SHP002,OI-9002,OD330011223355,6109,RETURNED,cod,TSHFZ124,TEE-BLK-M,Cotton Tee Black M,FAAB002,09/06/26,699.00,649.00,50.00,1,Meena Pillai,560001,Karnataka',
].join('\n');

const MYNTRA = [
  'seller id,store order id,order release id,order line id,created on,seller sku code,style id,brand,order status,total mrp,discount,coupon discount,shipping charge,final amount,return creation date,rto creation date,city,state',
  '4321,MYN-1001,7700112,99001,2026-09-03 11:20:00,KUR-PNK-S,1234567,Ahaan,C,2499,500,100,0,1899,,,Hyderabad,Telangana',
  '4321,MYN-1002,7700113,99002,2026-09-07 09:10:00,KUR-GRN-M,1234568,Ahaan,RTO,1999,400,0,0,1599,,2026-09-12,Pune,Maharashtra',
  '4321,MYN-1003,7700114,99003,2026-09-08 18:45:00,KUR-YLW-L,1234569,Ahaan,C,1799,300,0,0,1499,2026-09-15,,Chennai,Tamil Nadu',
].join('\n');

const RAZORPAY = [
  'id,amount,currency,status,order_id,invoice_id,international,method,amount_refunded,refund_status,captured,description,card_id,bank,wallet,vpa,email,contact,fee,tax,error_code,error_description,created_at',
  'pay_N1a2b3c4d5e6f7,1499.00,INR,captured,order_N1a2b3c4d5e6f0,,0,upi,0.00,,1,Order #1001,,,,priya@okhdfcbank,priya.m@example.in,+919876543210,35.38,5.40,,,02/09/2026 14:31:05',
  'pay_N2a2b3c4d5e6f7,2299.00,INR,refunded,order_N2a2b3c4d5e6f0,,0,card,2299.00,full,1,Order #1002,card_Ab12,,,,arjun@example.in,+919812345678,54.26,8.28,,,05/09/2026 10:02:11',
  'pay_N3a2b3c4d5e6f7,799.00,INR,failed,order_N3a2b3c4d5e6f0,,0,netbanking,0.00,,0,Order #1003,,HDFC,,,neha@example.in,+919800011122,0.00,0.00,BAD_REQUEST_ERROR,Payment failed,06/09/2026 08:00:00',
].join('\n');

const SHIPROCKET = [
  'Order ID,Shiprocket Created At,Channel,Status,Channel SKU,Product Name,Product Quantity,Customer Email,Payment Method,Order Total,Discount Value,Weight (KG),Courier Company,AWB Code,Freight Total Amount,RTO Initiated Date,RTO Delivered Date',
  'SR-5001,2026-09-02 15:04:00,Shopify,DELIVERED,KUR-BLU-M,Kurta Blue,1,asha.rao@example.in,Prepaid,1800,200,0.5,Delhivery,1234567890123,62.50,,',
  'SR-5002,2026-09-03 12:00:00,Shopify,RTO DELIVERED,SAR-SLK-01,Saree Silk,1,vikram.s@example.in,COD,1299,0,0.8,Xpressbees,9876543210987,74.00,2026-09-08,2026-09-14',
].join('\n');

const map = (text: string, profile: string) => {
  const { headers, rows } = parseDelimited(text);
  return applyMapping(rows, headers, { profile: PROFILES.get(profile)! });
};

describe('import profiles', () => {
  it('lists the six profiles with the fields each maps', async () => {
    const r = await request(app).get(`${api}/import/profiles`);
    expect(r.status).toBe(200);
    expect(r.body.map((p: { id: string }) => p.id).sort()).toEqual(['amazon_settlement', 'flipkart_orders', 'myntra_orders', 'razorpay_payments', 'shiprocket_shipments', 'shopify_orders']);
    for (const p of r.body) {
      expect(p).toMatchObject({ id: expect.any(String), label: expect.any(String), marketplace: expect.any(String) });
      expect(p.fields_mapped).toContain('order_id');
    }
  });

  it.each([
    ['shopify_orders', SHOPIFY],
    ['amazon_settlement', AMAZON],
    ['flipkart_orders', FLIPKART],
    ['myntra_orders', MYNTRA],
    ['razorpay_payments', RAZORPAY],
    ['shiprocket_shipments', SHIPROCKET],
  ])('%s is recognised from its headers by POST /import/map', async (id, text) => {
    const { headers } = parseDelimited(text);
    expect(detectProfile(headers)?.profile.id).toBe(id);
    const r = await request(app).post(`${api}/import/map`).send({ headers });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ profile: id, source: 'profile', saved: false });
    expect(r.body.mapping.order_id).toEqual(expect.any(String));
    // Product cost is in none of these exports: it is reported, not invented.
    expect(r.body.mapping.product_cost_inr).toBeNull();
    expect(r.body.unmapped_required).toContain('product_cost_inr');
    expect(r.body.confidence.order_id).toBeGreaterThan(0.5);
  });

  it('Shopify: line items merge into orders, gross adds the discount back, unknown costs stay null, email is hashed', () => {
    const [a, b] = map(SHOPIFY, 'shopify_orders');
    expect(a).toMatchObject({ order_id: '#1001', date: '2026-09-02', gross_inr: 2000, discount_inr: 200, refund_inr: 0, returned: false, units: 3, product_id: 'KUR-BLU-M', channel: 'web' });
    expect(a.product_cost_inr).toBeNull();
    expect(a.shipping_inr).toBeNull();
    expect(a.payment_fee_inr).toBeNull();
    expect(String(a.customer_id)).toMatch(/^c_[0-9a-f]{16}$/);
    expect(JSON.stringify(a)).not.toContain('asha.rao');
    expect(b).toMatchObject({ order_id: '#1002', gross_inr: 1299, refund_inr: 1299, returned: true, units: 1 });
  });

  it('Amazon settlement: amount rows pivot into one order each; fees, shipping, refunds and returns come from amount types', () => {
    const orders = map(AMAZON, 'amazon_settlement');
    expect(orders).toHaveLength(2);
    const [a, b] = orders;
    expect(a).toMatchObject({ order_id: '403-1111111-1111111', date: '2026-09-03', gross_inr: 999, discount_inr: 100, payment_fee_inr: 114.91, shipping_inr: 48, refund_inr: 0, returned: false, product_id: 'TEE-01', units: 1, channel: 'Amazon.in' });
    expect(a.return_cost_inr).toBeNull();
    expect(a.product_cost_inr).toBeNull();
    expect(b).toMatchObject({ order_id: '403-2222222-2222222', date: '2026-09-05', gross_inr: 1499, discount_inr: 0, payment_fee_inr: 134.91, shipping_inr: 62, refund_inr: 1499, returned: true, return_cost_inr: 27 });
  });

  it('Flipkart: gross is price × quantity; returned from the order state; marketplace fees stay unknown', () => {
    const [a, b] = map(FLIPKART, 'flipkart_orders');
    expect(a).toMatchObject({ order_id: 'OD330011223344', date: '2026-09-04', gross_inr: 1198, returned: false, units: 2, product_id: 'TEE-WHT-L', channel: 'flipkart' });
    expect(a.discount_inr).toBeNull();
    expect(a.shipping_inr).toBeNull();
    expect(b).toMatchObject({ order_id: 'OD330011223355', gross_inr: 649, returned: true });
  });

  it('Myntra: MRP gross, trade + coupon discount, a return or RTO date marks a return', () => {
    const [a, b, c] = map(MYNTRA, 'myntra_orders');
    expect(a).toMatchObject({ order_id: 'MYN-1001', date: '2026-09-03', gross_inr: 2499, discount_inr: 600, returned: false, product_id: 'KUR-PNK-S', channel: 'myntra' });
    expect(b).toMatchObject({ order_id: 'MYN-1002', returned: true });
    expect(c).toMatchObject({ order_id: 'MYN-1003', returned: true });
    expect(a.payment_fee_inr).toBeNull();
  });

  it('Razorpay: failed payments are skipped; fee is the payment fee; refund status marks returns', () => {
    const orders = map(RAZORPAY, 'razorpay_payments');
    expect(orders.map((o) => o.order_id)).toEqual(['order_N1a2b3c4d5e6f0', 'order_N2a2b3c4d5e6f0']);
    expect(orders[0]).toMatchObject({ date: '2026-09-02', gross_inr: 1499, payment_fee_inr: 35.38, refund_inr: 0, returned: false, payment_type: 'upi' });
    expect(orders[1]).toMatchObject({ date: '2026-09-05', gross_inr: 2299, refund_inr: 2299, returned: true, payment_type: 'card' });
    expect(orders[0].discount_inr).toBeNull();
    expect(JSON.stringify(orders)).not.toContain('example.in');
  });

  it('Shiprocket: freight is the shipping cost; RTO marks a return; payment fee stays unknown', () => {
    const [a, b] = map(SHIPROCKET, 'shiprocket_shipments');
    expect(a).toMatchObject({ order_id: 'SR-5001', date: '2026-09-02', gross_inr: 1800, discount_inr: 200, shipping_inr: 62.5, returned: false, payment_type: 'Prepaid', units: 1 });
    expect(b).toMatchObject({ order_id: 'SR-5002', shipping_inr: 74, returned: true, payment_type: 'COD' });
    expect(a.payment_fee_inr).toBeNull();
  });
});

describe('POST /datasets with a profile or a mapping', () => {
  it('a Shopify export with the owner’s cost columns mapped imports through the usual validation', async () => {
    const r = await request(app)
      .post(`${api}/datasets`)
      .field('profile', 'shopify_orders')
      .field('mapping', JSON.stringify({ product_cost_inr: 'Cost', shipping_inr: 'Ship Cost' }))
      .attach('file', Buffer.from(SHOPIFY), 'orders_export.csv');
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ rows_kept: 2, kept_ids: ['#1001', '#1002'], mapped: { profile: 'shopify_orders', mapping: true } });
    // Unknown stays unknown: the refunded order's recovery and return cost are flagged, not zero.
    expect(r.body.flags.some((f: { reason: string; order_id: string }) => f.reason === 'unknown' && f.order_id === '#1002')).toBe(true);
  });

  it('JSON rows with any column names import with a mapping', async () => {
    const rows = [{ 'Order No': 'A1', Placed: '02/09/2026', Amount: '₹1,000', Disc: 0, COGS: 400, Ship: 60, 'Returned?': 'no' }];
    const mapping = { order_id: 'Order No', date: 'Placed', gross_inr: 'Amount', discount_inr: 'Disc', product_cost_inr: 'COGS', shipping_inr: 'Ship', returned: 'Returned?' };
    const r = await request(app).post(`${api}/datasets`).send({ records: { orders: rows }, mapping });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ rows_kept: 1, kept_ids: ['A1'], period_end: '2026-09-30' });
  });

  it('a mapping to a column the file does not have, or to a field outside the schema, is a 422', async () => {
    const bad = await request(app).post(`${api}/datasets`).field('mapping', JSON.stringify({ order_id: 'Nope' })).attach('file', Buffer.from(SHOPIFY), 'orders.csv');
    expect([bad.status, bad.body.error.path]).toEqual([422, 'mapping.order_id']);
    const field = await request(app).post(`${api}/datasets`).send({ records: { orders: [{ a: 1 }] }, mapping: { profit: 'a' } });
    expect([field.status, field.body.error.path]).toEqual([422, 'mapping.profit']);
    const profile = await request(app).post(`${api}/datasets`).send({ records: { orders: [{ a: 1 }] }, profile: 'ebay' });
    expect([profile.status, profile.body.error.path]).toEqual([422, 'profile']);
  });

  it('without mapping or profile, uploads behave exactly as before', async () => {
    const r = await request(app).post(`${api}/datasets`).send({ source: 'fixture' });
    expect(r.status).toBe(201);
    expect(r.body.mapped).toBeUndefined();
  });
});

describe('the AI sees shapes, never values', () => {
  const headers = ['Txn Ref', 'Booked On', 'Value', 'Buyer Mail', 'Qty', 'State Flag'];
  const rows = [
    ['TXN-88213', '2026-09-02', '1499.50', 'meera.k@example.in', '2', 'Delivered'],
    ['TXN-88214', '2026-09-03', '2,350.00', 'rahul.v@example.in', '1', 'Returned'],
    ['TXN-88215', '2026-09-04', '899', 'sana.q@example.in', '3', 'Delivered'],
  ];
  const raw = rows.flat().filter((v) => v.length >= 3);

  it('maskSamples keeps types and sizes only', () => {
    const masked = maskSamples(headers, rows);
    const json = JSON.stringify(masked);
    for (const v of raw) expect(json).not.toContain(v);
    expect(masked.find((m) => m.header === 'Value')).toMatchObject({ type: 'number', size: 'thousands' });
    expect(masked.find((m) => m.header === 'Booked On')).toMatchObject({ type: 'date', format: 'YYYY-MM-DD' });
    expect(masked.find((m) => m.header === 'Buyer Mail')).toMatchObject({ type: 'text', shape: 'email' });
    // Object rows mask the same way.
    const objects = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
    expect(maskSamples(headers, objects)).toEqual(masked);
  });

  it('the AI fills fields the aliases could not; the prompt carries no value; bad answers are ignored', async () => {
    const prompts: string[] = [];
    const model: MappingModel = {
      model: 'stub',
      generate: async (_system, user) => {
        prompts.push(user);
        return JSON.stringify({
          pairs: [
            { field: 'order_id', column: 'Txn Ref' },
            { field: 'date', column: 'booked on' },
            { field: 'gross_inr', column: 'Value' },
            { field: 'profit', column: 'Value' },
            { field: 'shipping_inr', column: 'No Such Column' },
          ],
        });
      },
    };
    const calls: unknown[] = [];
    const r = await mapHeaders({ headers, sample_rows: rows }, { account: 'ai-test', model, onAi: (i) => calls.push(i) });
    expect(prompts).toHaveLength(1);
    for (const v of raw) expect(prompts[0]).not.toContain(v);
    expect(r.source).toBe('ai');
    expect(r.mapping).toMatchObject({ order_id: 'Txn Ref', date: 'Booked On', gross_inr: 'Value', units: 'Qty', shipping_inr: null });
    expect(r.confidence.order_id).toBe(0.6);
    expect(r.confidence.units).toBe(0.9);
    expect(calls).toEqual([expect.objectContaining({ model: 'stub', accepted: true, fields_sent: ['headers', 'column_types'] })]);
  });

  it('with AI unavailable (the default in tests) the API maps by aliases only', async () => {
    const r = await request(app).post(`${api}/import/map`).send({ headers, sample_rows: rows });
    expect(r.body).toMatchObject({ source: 'alias', profile: null });
    expect(r.body.mapping.units).toBe('Qty');
    expect(r.body.mapping.order_id).toBeNull();
    expect(r.body.unmapped_required).toEqual(expect.arrayContaining(['order_id', 'date', 'gross_inr']));
  });
});

describe('saved mappings', () => {
  const headers = ['Order Ref', 'Placed', 'Amt', 'Disc', 'Cost', 'Freight', 'Back?'];
  const mapping = { order_id: 'Order Ref', date: 'Placed', gross_inr: 'Amt', discount_inr: 'Disc', product_cost_inr: 'Cost', shipping_inr: 'Freight', returned: 'Back?' };

  it('a saved mapping is used next time the same columns arrive (any order, any case)', async () => {
    const first = await request(app).post(`${api}/import/map`).send({ headers });
    expect(first.body.source).toBe('alias');
    const save = await request(app).post(`${api}/import/mappings`).send({ headers, mapping });
    expect(save.status).toBe(201);
    expect(save.body).toMatchObject({ header_signature: first.body.header_signature, saved: true, workspace: 'demo' });
    const again = await request(app)
      .post(`${api}/import/map`)
      .send({ headers: [...headers].reverse().map((h) => h.toUpperCase()) });
    expect(again.body).toMatchObject({ source: 'saved', saved: true, unmapped_required: [] });
    expect(again.body.mapping).toMatchObject({ order_id: 'ORDER REF', shipping_inr: 'FREIGHT', returned: 'BACK?' });
    expect(again.body.mapping.payment_fee_inr).toBeNull();
  });

  it('saved mappings belong to their account', async () => {
    const r = await mapHeaders({ headers }, { account: 'someone-else' });
    expect(r.source).toBe('alias');
    expect(r.saved).toBe(false);
  });

  it('a mapping must name schema fields and columns of the file', async () => {
    expect((await request(app).post(`${api}/import/mappings`).send({ headers, mapping: { order_id: 'Missing' } })).status).toBe(422);
    expect((await request(app).post(`${api}/import/mappings`).send({ headers, mapping: { margin: 'Amt' } })).status).toBe(422);
    expect((await request(app).post(`${api}/import/mappings`).send({ mapping })).status).toBe(422);
  });
});
