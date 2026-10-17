import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', MONGO_URL: '', AI_DISABLED: '1' },
  },
});
