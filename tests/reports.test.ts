import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../api/src/app';

// Monthly report links for WhatsApp: a stored PDF opens from an unguessable link; anything else is refused.
const app = createApp();
const api = '/api/v1';
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200, 32), Buffer.from('\n%%EOF')]);

describe('report links', () => {
  it('stores a PDF and serves it back from the returned link', async () => {
    const up = await request(app).post(`${api}/reports`).set('Content-Type', 'application/pdf').send(pdf);
    expect(up.status).toBe(201);
    expect(up.body.path).toMatch(/^\/api\/v1\/reports\/\d{10}-[a-f0-9]{32}\.pdf$/);
    const got = await request(app).get(up.body.path).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toMatch(/application\/pdf/);
    expect((got.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('refuses files that are not PDFs, and unknown or expired links', async () => {
    expect((await request(app).post(`${api}/reports`).set('Content-Type', 'application/pdf').send(Buffer.from('hello'))).status).toBe(422);
    expect((await request(app).get(`${api}/reports/../../etc.pdf`)).status).toBe(404);
    expect((await request(app).get(`${api}/reports/1000000000-${'a'.repeat(32)}.pdf`)).status).toBe(404);
  });
});
