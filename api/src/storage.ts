import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { logger } from './logger.js';
import type { SampleSource } from './schema/orders.js';

// One interface for files: local data/ in dev, S3 when S3_BUCKET is set (falls back to local if S3 fails).

export const SAMPLES: Record<SampleSource, { file: string; label: string; description: string }> = {
  fixture: { file: 'C21/fixture.json', label: 'Sample orders', description: '20 reference orders from a small D2C store, unchanged.' },
  extended: { file: 'C21_extended.json', label: 'Extended sample', description: 'The 20 sample orders plus S01–S08 (labelled synthetic): channels, products, ads, a duplicate (S05), a late refund (S06) and unknown refund facts (S04).' },
  duplicate_order: { file: 'negative_tests/duplicate_order.json', label: 'Duplicate order', description: 'O07 appears twice. Expect 20 orders and one duplicate flag.' },
  late_refund: { file: 'negative_tests/late_refund.json', label: 'Late refund', description: 'O10 refund dated 2026-10-05. Expect +420 in period, −180 if recognised.' },
  null_refund: { file: 'negative_tests/null_refund.json', label: 'Missing refund', description: 'O05 refund_inr is null. Expect unknown, never zero; ₹6,180 partial.' },
  missing_fee: { file: 'negative_tests/missing_fee.json', label: 'Missing payment fee', description: 'payment_fee_inr removed from every row. Expect partial totals, no crash.' },
  refund_over_gross: { file: 'negative_tests/refund_over_gross.json', label: 'Refund over gross', description: 'O03 refund 1,500. Expect O03 invalid and excluded; ₹5,580.' },
  recovery_400: { file: 'negative_tests/recovery_400.json', label: 'Full recovery', description: 'Recovered cost 400 on returns. Expect returns at −130; ₹6,200.' },
  bad_schema: { file: 'negative_tests/bad_schema.csv', label: 'Bad schema (CSV)', description: 'No product_cost_inr column. Expect 422 with the field path.' },
  bad_values: { file: 'negative_tests/bad_values.csv', label: 'Bad values (CSV)', description: 'A negative cost, a text value and a bad date. Expect each row rejected with its line and reason.' },
  demo_12m: { file: 'demo_12m.json', label: '12-month demo brand (synthetic)', description: '3,020 labelled synthetic orders, Oct 2025 – Sep 2026, with payment type, customer and units, for the Pulse owner analytics. Not used by the engine checks.' },
};

export async function readSample(source: SampleSource): Promise<{ name: string; text: string }> {
  const rel = SAMPLES[source].file;
  try {
    return { name: path.basename(rel), text: await readFile(path.join(config.dataDir, rel), 'utf8') };
  } catch {
    throw new HttpError(404, 'not_found', `Sample "${source}" was not found at data/${rel}.`);
  }
}

export function storageKind(): 'local' | 's3' {
  return config.s3Bucket ? 's3' : 'local';
}

async function putLocal(key: string, body: Buffer | string): Promise<string> {
  const file = path.join(config.dataDir, 'uploads', key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
  return `file://${file}`;
}

/** put(key, bytes): S3 when configured, otherwise data/uploads/. Never throws to the caller's critical path. */
export async function put(key: string, body: Buffer | string, contentType = 'application/octet-stream'): Promise<string> {
  if (config.s3Bucket) {
    try {
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const s3 = new S3Client({});
      await s3.send(new PutObjectCommand({ Bucket: config.s3Bucket, Key: key, Body: body, ContentType: contentType }));
      return `s3://${config.s3Bucket}/${key}`;
    } catch (err) {
      logger.warn({ err: (err as Error).message, key }, 's3 put failed; stored locally');
    }
  }
  return putLocal(key, body);
}

export async function get(key: string): Promise<Buffer | null> {
  if (config.s3Bucket) {
    try {
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const out = await new S3Client({}).send(new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }));
      return Buffer.from(await out.Body!.transformToByteArray());
    } catch (err) {
      logger.warn({ err: (err as Error).message, key }, 's3 get failed; trying local');
    }
  }
  try {
    return await readFile(path.join(config.dataDir, 'uploads', key));
  } catch {
    return null;
  }
}

export const safeName = (name: string) => name.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'upload';
