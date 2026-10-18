import { randomBytes } from 'node:crypto';
import express, { Router } from 'express';
import { ah, HttpError } from '../errors.js';
import { get, put } from '../storage.js';

// Monthly report links for WhatsApp. A web page cannot attach a file to WhatsApp, so the report PDF is stored and the
// message carries a link that opens it. The link name holds its expiry and a random part nobody can guess; after 7 days
// it stops working. Only PDF files up to 5 MB are accepted.

export const reportsRouter = Router();

const TTL_DAYS = 7;
const MAX_BYTES = 5 * 1024 * 1024;
const NAME = /^(\d{10})-([a-f0-9]{32})\.pdf$/;

reportsRouter.post(
  '/reports',
  express.raw({ type: 'application/pdf', limit: MAX_BYTES }),
  ah(async (req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length < 8 || body.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new HttpError(422, 'schema_invalid', 'Send the report as a PDF file.');
    }
    const expires = Math.floor(Date.now() / 1000) + TTL_DAYS * 86400;
    const name = `${expires}-${randomBytes(16).toString('hex')}.pdf`;
    await put(`reports/${name}`, body, 'application/pdf');
    res.status(201).json({ path: `/api/v1/reports/${name}`, expires_at: new Date(expires * 1000).toISOString() });
  }),
);

reportsRouter.get(
  '/reports/:name',
  ah(async (req, res) => {
    const m = NAME.exec(req.params.name);
    if (!m) throw new HttpError(404, 'not_found', 'This report link is not valid.');
    if (Number(m[1]) * 1000 < Date.now()) throw new HttpError(404, 'not_found', 'This report link has expired. Ask for a new one.');
    const pdf = await get(`reports/${req.params.name}`);
    if (!pdf) throw new HttpError(404, 'not_found', 'This report was not found.');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="Profyn-report.pdf"');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(pdf);
  }),
);
