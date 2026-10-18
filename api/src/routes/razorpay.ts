import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { ah, HttpError } from '../errors.js';
import { logger } from '../logger.js';

// Razorpay payment links: the "Fix this" action for return shipping. The owner creates a link for the amount a customer
// owes (for example the return shipping charge), shares it on WhatsApp, and Razorpay collects it. Keys come from
// RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET (test or live); without them the feature reports itself as not connected.

export const razorpayRouter = Router();

const keys = () => {
  const id = process.env.RAZORPAY_KEY_ID?.trim();
  const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
  return id && secret ? { id, secret, mode: id.startsWith('rzp_live') ? 'live' : 'test' } : null;
};

razorpayRouter.get('/razorpay/status', (_req, res) => {
  const k = keys();
  res.json({ enabled: Boolean(k), mode: k?.mode ?? null });
});

const LinkRequest = z.object({
  amount_inr: z.number({ invalid_type_error: 'must be a number' }).int('must be a whole number of rupees').min(1, 'must be at least ₹1').max(100000, 'must be at most ₹1,00,000'),
  description: z.string().trim().min(1, 'add a short note for the customer').max(120),
  reference_id: z.string().trim().max(40).optional(),
  customer_name: z.string().trim().max(80).optional(),
  customer_contact: z.string().trim().regex(/^\+?\d{10,13}$/, 'use a phone number with 10 to 13 digits').optional(),
});

razorpayRouter.post(
  '/razorpay/payment-link',
  ah(async (req, res) => {
    if (!req.user) throw new HttpError(401, 'unauthorized', 'Sign in to create payment links.');
    const k = keys();
    if (!k) throw new HttpError(503, 'not_connected', 'Razorpay is not connected yet.', { hint: 'Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the server settings.' });
    const body = LinkRequest.parse(req.body ?? {});
    const payload = {
      amount: body.amount_inr * 100,
      currency: 'INR',
      description: body.description,
      ...(body.reference_id ? { reference_id: body.reference_id } : {}),
      customer: { ...(body.customer_name ? { name: body.customer_name } : {}), ...(body.customer_contact ? { contact: body.customer_contact } : {}) },
      notify: { sms: false, email: false },
      reminder_enable: false,
    };
    let response: Response;
    try {
      response = await fetch('https://api.razorpay.com/v1/payment_links', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${k.id}:${k.secret}`).toString('base64')}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'razorpay unreachable');
      throw new HttpError(502, 'shopify_unavailable', 'Razorpay could not be reached. Try again in a moment.');
    }
    const json = (await response.json().catch(() => ({}))) as { id?: string; short_url?: string; status?: string; error?: { description?: string } };
    if (!response.ok || !json.short_url) {
      throw new HttpError(response.status === 401 ? 502 : 422, 'schema_invalid', json.error?.description ?? 'Razorpay did not create the link.', {
        hint: response.status === 401 ? 'The Razorpay keys on the server were rejected.' : undefined,
      });
    }
    void audit.record(req, { kind: 'export', detail: { what: 'razorpay_payment_link', amount_inr: body.amount_inr, link_id: json.id } });
    res.status(201).json({ id: json.id, short_url: json.short_url, status: json.status ?? 'created', amount_inr: body.amount_inr, mode: k.mode });
  }),
);
