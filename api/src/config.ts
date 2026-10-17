import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8080),
  mongoUrl: env.MONGO_URL ?? '',
  dataDir: path.resolve(env.DATA_DIR ?? path.join(__dirname, '..', '..', 'data')),
  s3Bucket: env.S3_BUCKET ?? '',
  aiDisabled: env.AI_DISABLED === '1' || !env.GEMINI_API_KEY,
  logLevel: env.LOG_LEVEL ?? (env.NODE_ENV === 'test' ? 'silent' : 'info'),
  maxBodyBytes: 5 * 1024 * 1024,
  maxRows: 10000,
};
