import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../api/src/app';

// Razorpay payment links: off without keys, never for guests, and the keys never appear in a response.
const app = createApp();
const api = '/api/v1';

afterEach(() => vi.unstubAllEnvs());

describe('razorpay payment links', () => {
  it('reports itself as not connected without keys', async () => {
    const r = await request(app).get(`${api}/razorpay/status`);
    expect(r.body).toEqual({ enabled: false, mode: null });
  });
  it('reports the mode when keys are set and never returns them', async () => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_abc123');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'secret-value');
    const r = await request(app).get(`${api}/razorpay/status`);
    expect(r.body).toEqual({ enabled: true, mode: 'test' });
    expect(JSON.stringify(r.body)).not.toContain('secret-value');
  });
  it('guests cannot create links', async () => {
    const r = await request(app).post(`${api}/razorpay/payment-link`).send({ amount_inr: 88, description: 'Return shipping' });
    expect(r.status).toBe(401);
  });
});

describe('guest session check', () => {
  it('/me?quiet=1 answers 200 with no user for a guest (no console error), plain /me stays 401', async () => {
    const quiet = await request(app).get(`${api}/me?quiet=1`);
    expect(quiet.status).toBe(200);
    expect(quiet.body.user).toBeNull();
    expect((await request(app).get(`${api}/me`)).status).toBe(401);
  });
});
