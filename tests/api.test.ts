import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../api/src/app';
import { EXPECTED, readText } from './helpers';

const app = createApp();
const api = '/api/v1';

describe('api contract (Blueprint §10, §16)', () => {
  let datasetId = '';
  let analysisId = '';
  let scenarioId = '';

  beforeAll(async () => {
    datasetId = (await request(app).post(`${api}/datasets`).send({ source: 'extended' })).body.dataset_id;
    analysisId = (await request(app).post(`${api}/datasets/${datasetId}/analyses`).send({ attribution: 'allocate' })).body.analysis_id;
    scenarioId = (await request(app).post(`${api}/analyses/${analysisId}/scenarios`).send({ overrides: { recovery_pct: 50 } })).body.scenario_id;
  });

  it('GET /health: 200 with db, ai, storage, engine version; headers set', async () => {
    const r = await request(app).get(`${api}/health`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok', db: 'memory', ai: 'disabled', storage: 'local', engine_version: '1.0.0' });
    expect(r.headers['x-engine-version']).toBe('1.0.0');
    expect(r.headers['x-request-id']).toBeTruthy();
  });

  it('GET /checks passes all three public checks', async () => {
    const r = await request(app).get(`${api}/checks`);
    expect(r.body.check1).toMatchObject({ expected: 230, actual: 230, pass: true });
    expect(r.body.check2).toMatchObject({ allocate_total: 7053, channel_total: 7053, fixture_total: 6000, reconciled: true, never_both: true, pass: true });
    expect(r.body.check3).toMatchObject({ unknown_labelled: true, recommendation_changed: true, pass: true });
    expect(r.body.all_pass).toBe(true);
  });

  it('GET /worked-order returns six lines and ₹230', async () => {
    const r = await request(app).get(`${api}/worked-order`);
    expect([r.body.contribution_inr, r.body.lines.length]).toEqual([230, 6]);
  });

  it('POST /datasets lists the duplicate, late refund and unknown from the extended file', async () => {
    const r = await request(app).post(`${api}/datasets`).send({ source: 'extended' });
    expect(r.status).toBe(201);
    expect([r.body.rows_in, r.body.rows_kept, r.body.synthetic_rows]).toEqual([28, 27, 7]);
    expect(r.body.flags.map((f: { reason: string }) => f.reason)).toEqual(expect.arrayContaining(['duplicate', 'late_refund', 'unknown']));
  });

  it('422 schema_invalid with the field path for a bad CSV header', async () => {
    const r = await request(app).post(`${api}/datasets`).set('Content-Type', 'text/csv').send(readText('negative_tests/bad_schema.csv'));
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: 'schema_invalid', path: 'product_cost_inr' });
  });

  it('422 no_valid_rows when every row is rejected, with the row path', async () => {
    const r = await request(app).post(`${api}/datasets`).send({ records: { orders: [{ order_id: 'X1', gross_inr: 'abc' }] } });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('no_valid_rows');
    expect(r.body.error.issues[0].path).toMatch(/^records\.orders\[0\]\./);
  });

  it('CSV via multipart upload keeps empty cells as unknown', async () => {
    const csv =
      'order_id,date,gross_inr,discount_inr,refund_inr,net_sales_inr,product_cost_inr,recovered_product_cost_inr,shipping_inr,payment_fee_inr,return_cost_inr,returned\n' +
      'C1,2026-09-02,1000,100,,0,400,350,60,20,50,true\n';
    const r = await request(app).post(`${api}/datasets`).attach('file', Buffer.from(csv), 'orders.csv');
    expect(r.status).toBe(201);
    expect(r.body.flags[0]).toMatchObject({ reason: 'unknown', field: 'refund_inr', line: 2 });
  });

  it('merges several files (one per month) into one dataset; every flag names its file and line', async () => {
    const head = 'order_id,date,gross_inr,discount_inr,refund_inr,net_sales_inr,product_cost_inr,recovered_product_cost_inr,shipping_inr,payment_fee_inr,return_cost_inr,returned\n';
    const aug = head + 'A1,2026-08-02,1000,100,0,900,400,0,60,20,0,false\n';
    const sep = head + 'S1,2026-09-02,1000,100,,0,400,350,60,20,50,true\nA1,2026-09-03,500,0,0,500,200,0,60,10,0,false\n';
    const r = await request(app).post(`${api}/datasets`).attach('file', Buffer.from(aug), 'aug.csv').attach('file', Buffer.from(sep), 'sep.csv');
    expect(r.status).toBe(201);
    expect(r.body.files).toEqual([{ name: 'aug.csv', rows: 1 }, { name: 'sep.csv', rows: 2 }]);
    expect([r.body.rows_in, r.body.rows_kept, r.body.period_end, r.body.source]).toEqual([3, 2, '2026-09-30', 'upload:aug.csv + sep.csv']);
    expect(r.body.flags).toContainEqual(expect.objectContaining({ reason: 'unknown', field: 'refund_inr', file: 'sep.csv', line: 2 }));
    const dup = r.body.flags.find((f: { reason: string }) => f.reason === 'duplicate');
    expect(dup).toMatchObject({ order_id: 'A1', file: 'sep.csv', line: 3, path: 'sep.csv rows[1].order_id' });
    expect(dup.detail).toContain('sep.csv line 3 (first on aug.csv line 2)');
  });

  it('adds an upload to saved data, ignoring orders already saved; a repeat upload changes nothing', async () => {
    const head = 'order_id,date,gross_inr,discount_inr,refund_inr,net_sales_inr,product_cost_inr,recovered_product_cost_inr,shipping_inr,payment_fee_inr,return_cost_inr,returned\n';
    const aug = head + 'A1,2026-08-02,1000,100,0,900,400,0,60,20,0,false\n';
    const sep = head + 'S1,2026-09-02,1000,100,0,900,400,0,60,20,0,false\nA1,2026-08-02,1000,100,0,900,400,0,60,20,0,false\n';
    const first = await request(app).post(`${api}/datasets`).attach('file', Buffer.from(aug), 'aug.csv');
    const added = await request(app).post(`${api}/datasets`).field('append_to', first.body.dataset_id).attach('file', Buffer.from(sep), 'sep.csv');
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ rows_kept: 2, rows_added: 1, duplicates_ignored: 1, appended_to: first.body.dataset_id, period_end: '2026-09-30' });
    expect(added.body.files).toEqual([{ name: 'aug.csv', rows: 1 }, { name: 'sep.csv', rows: 2 }]);
    expect(added.body.flags.find((f: { order_id: string }) => f.order_id === 'A1').detail).toBe('A1 on line 3 is already saved — ignored.');
    const again = await request(app).post(`${api}/datasets?append_to=${added.body.dataset_id}`).attach('file', Buffer.from(sep), 'sep.csv');
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ unchanged: true, rows_added: 0, duplicates_ignored: 2, dataset_id: added.body.dataset_id, message: 'Nothing new: all 2 orders were already saved.' });
    const a = await request(app).post(`${api}/datasets/${added.body.dataset_id}/analyses`).send({});
    expect(a.body.orders.map((o: { order_id: string }) => o.order_id).sort()).toEqual(['A1', 'S1']);
    expect((await request(app).post(`${api}/datasets?append_to=nope`).attach('file', Buffer.from(sep), 'sep.csv')).status).toBe(404);
  });

  it('a broken file in a multi-file upload is named in the error', async () => {
    const good = 'order_id,date,gross_inr,discount_inr,refund_inr,net_sales_inr,product_cost_inr,recovered_product_cost_inr,shipping_inr,payment_fee_inr,return_cost_inr,returned\nA1,2026-08-02,1000,100,0,900,400,0,60,20,0,false\n';
    const bad = 'date,gross_inr\n2026-09-02,1000\n';
    const r = await request(app).post(`${api}/datasets`).attach('file', Buffer.from(good), 'aug.csv').attach('file', Buffer.from(bad), 'sep.csv');
    expect([r.status, r.body.error.code]).toEqual([422, 'schema_invalid']);
    expect(r.body.error.message).toContain('sep.csv');
  });

  it('a CSV header named __proto__ is refused with 422 (no prototype pollution)', async () => {
    const csv = 'order_id,__proto__,date\nX1,1,2026-09-02\n';
    const r = await request(app).post(`${api}/datasets`).set('Content-Type', 'text/csv').send(csv);
    expect([r.status, r.body.error.code, r.body.error.path]).toEqual([422, 'schema_invalid', '__proto__']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('415 unsupported_type', async () => {
    const r = await request(app).post(`${api}/datasets`).set('Content-Type', 'text/plain').send('x');
    expect([r.status, r.body.error.code]).toEqual([415, 'unsupported_type']);
  });

  it('413 file_too_large over 10,000 rows', async () => {
    const r = await request(app).post(`${api}/datasets`).send(Array.from({ length: 10001 }, (_, i) => ({ order_id: `X${i}` })));
    expect([r.status, r.body.error.code]).toEqual([413, 'file_too_large']);
  });

  it('409 attribution_conflict carries the rule text', async () => {
    const r = await request(app).post(`${api}/datasets/${datasetId}/analyses`).send({ attribution: 'allocate', channel_spend: { web: 250 } });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('attribution_conflict');
    expect(r.body.error.hint).toMatch(/never both deducted/);
  });

  it('404 not_found', async () => {
    const r = await request(app).post(`${api}/datasets/missing/analyses`).send({});
    expect([r.status, r.body.error.code]).toEqual([404, 'not_found']);
  });

  it('GET /analyses/:id/orders/:order_id returns the waterfall', async () => {
    const r = await request(app).get(`${api}/analyses/${analysisId}/orders/S06`);
    expect(r.body.status).toBe('ok');
    expect(r.body.computed.recognised_contribution_inr).toBe(EXPECTED.extended.late_pending.recognised);
    expect(r.body.waterfall).toHaveLength(9);
  });

  it('422 override_invalid for zero or several overrides', async () => {
    const zero = await request(app).post(`${api}/analyses/${analysisId}/scenarios`).send({ overrides: {} });
    const two = await request(app).post(`${api}/analyses/${analysisId}/scenarios`).send({ overrides: { recovery_pct: 50, shipping_inr: 70 } });
    expect([zero.status, zero.body.error.code, two.status, two.body.error.code]).toEqual([422, 'override_invalid', 422, 'override_invalid']);
  });

  it('POST /scenarios/:id/test-plan drafts a test and stop rule', async () => {
    const r = await request(app).post(`${api}/scenarios/${scenarioId}/test-plan`);
    expect(r.body).toMatchObject({ intervention: 'raise_recovery_via_inspection', source: 'template' });
    expect(r.body.test_30d).toMatch(/30 days/);
  });

  it('POST /analyses/:id/narrate falls back to template text with AI disabled', async () => {
    const r = await request(app).post(`${api}/analyses/${analysisId}/narrate`);
    expect(r.body.ai).toBe('disabled');
    expect(r.body.leaks.every((l: { why_source: string }) => l.why_source === 'template')).toBe(true);
  });

  it('decisions: POST then GET returns the same record with the assumptions snapshot; export has the check values', async () => {
    const body = { scenario_id: scenarioId, intervention: 'raise_recovery_via_inspection', expected_delta_inr: 840, test_30d: 'Inspect every return for 30 days.', stop_rule: 'Stop if recovery does not rise.', owner: 'M1' };
    const post = await request(app).post(`${api}/analyses/${analysisId}/decisions`).send(body);
    expect(post.status).toBe(201);
    expect(post.body.engine_version).toBe('1.0.0');
    const get = await request(app).get(`${api}/decisions/${post.body.decision_id}`);
    expect(get.body).toMatchObject({ decision_id: post.body.decision_id, ...body, engine_version: '1.0.0' });
    expect(get.body.assumptions).toMatchObject({ changed: 'recovery_pct', overrides: { recovery_pct: 50 }, attribution: 'allocate', engine_version: '1.0.0' });

    const md = (await request(app).get(`${api}/decisions/${post.body.decision_id}/export?format=md`)).text;
    expect(md).toContain('Worked order contribution: ₹ 230');
    expect(md).toContain('₹ 7,053 = ₹ 7,053 = ₹ 7,053');
    expect(md).toMatch(/Missing refund facts: 1 order\(s\) unknown; recommendation confidence unknown/);
    const json = await request(app).get(`${api}/decisions/${post.body.decision_id}/export?format=json`);
    expect(JSON.parse(json.text).decision_id).toBe(post.body.decision_id);
  });

  it('GET /template.csv downloads a C21 template that imports back cleanly', async () => {
    const tpl = await request(app).get(`${api}/template.csv`);
    expect(tpl.headers['content-disposition']).toMatch(/profyn-orders-template\.csv/);
    const back = await request(app).post(`${api}/datasets`).set('Content-Type', 'text/csv').send(tpl.text);
    expect(back.status).toBe(201);
    expect(back.body.rows_kept).toBe(3);
    expect(back.body.flags.every((f: { order_id: string; reason: string }) => f.order_id === 'O09' && f.reason === 'unknown')).toBe(true);
  });

  it('GET /analyses/:id/export?format=csv has one row per order and the reconciled total', async () => {
    const csv = (await request(app).get(`${api}/analyses/${analysisId}/export?format=csv`)).text;
    const lines = csv.trim().split(/\r\n/);
    expect(lines[0]).toMatch(/^order_id,date,channel/);
    expect(lines.filter((l) => /^[OS]\d\d,/.test(l))).toHaveLength(27);
    expect(csv).toContain('contribution_inr,7053,partial (1 unknown)');
  });

  it('handling default is editable and labelled as an estimate', async () => {
    const r = await request(app).post(`${api}/datasets/${datasetId}/analyses`).send({ config: { handling_default_inr: 15 } });
    expect(r.body.config.handling_default_inr).toBe(15);
    expect(r.body.totals.contribution_inr).toBe(7053 - 20 * 15);
    expect(r.body.labels.join(' ')).toMatch(/Handling ₹ 15 per order where the row has none \(estimate\)/);
  });

  it('decision without an owner is 422 on the owner field', async () => {
    const r = await request(app).post(`${api}/analyses/${analysisId}/decisions`).send({ intervention: 'x', expected_delta_inr: 0, test_30d: 't', stop_rule: 's', owner: '' });
    expect([r.status, r.body.error.path]).toEqual([422, 'owner']);
  });
});
