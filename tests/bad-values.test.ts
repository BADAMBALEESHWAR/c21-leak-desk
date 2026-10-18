import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../api/src/app';
import { readText } from './helpers';

// A5: data/negative_tests/bad_values.csv — a negative cost, a text value and a bad date among valid rows.
// The import answers 201 with each bad row rejected and named by line, field and reason; it never fails the file.

const app = createApp();
const api = '/api/v1';
const EXPECTED_FLAGS = [
  { order_id: 'O03', line: 4, field: 'product_cost_inr', reason: 'schema', action: 'rejected', detail: 'product_cost_inr must not be negative on O03 — row excluded.' },
  { order_id: 'O06', line: 7, field: 'gross_inr', reason: 'schema', action: 'rejected', detail: 'gross_inr must be a number in INR on O06 — row excluded.' },
  { order_id: 'O08', line: 9, field: 'date', reason: 'schema', action: 'rejected', detail: 'date must be an ISO date YYYY-MM-DD on O08 — row excluded.' },
];

describe('bad_values.csv drill', () => {
  it('is listed as a sample', async () => {
    const samples = (await request(app).get(`${api}/samples`)).body as Array<{ source: string; label: string; description: string; file: string }>;
    expect(samples.find((s) => s.source === 'bad_values')).toEqual({
      source: 'bad_values',
      label: 'Bad values (CSV)',
      description: 'A negative cost, a text value and a bad date. Expect each row rejected with its line and reason.',
      file: 'data/negative_tests/bad_values.csv',
    });
  });

  it('loaded as a sample: 201, three rows rejected with line, field and reason, seven kept', async () => {
    const r = await request(app).post(`${api}/datasets`).send({ source: 'bad_values' });
    expect(r.status).toBe(201);
    expect([r.body.rows_in, r.body.rows_kept, r.body.rows_rejected]).toEqual([10, 7, 3]);
    expect(r.body.flags).toMatchObject(EXPECTED_FLAGS);
    expect(r.body.kept_ids).toEqual(['O01', 'O02', 'O04', 'O05', 'O07', 'O09', 'O10']);
    const a = await request(app).post(`${api}/datasets/${r.body.dataset_id}/analyses`).send({});
    expect(a.status).toBe(201);
    expect(a.body.totals.contribution_inr).toBe(5 * 420 - 2 * 180);
  });

  it('uploaded as CSV text or a file: the same report, never a 500', async () => {
    const csv = readText('negative_tests/bad_values.csv');
    const asText = await request(app).post(`${api}/datasets`).set('Content-Type', 'text/csv').send(csv);
    expect(asText.status).toBe(201);
    expect(asText.body.flags).toMatchObject(EXPECTED_FLAGS);
    const asFile = await request(app).post(`${api}/datasets`).attach('file', Buffer.from(csv), 'bad_values.csv');
    expect(asFile.status).toBe(201);
    expect(asFile.body.flags).toMatchObject(EXPECTED_FLAGS);
  });
});
