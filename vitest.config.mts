import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// UI tests render web/src components: one React (the web app's 18.3) for the components, react-i18next and Testing Library.
const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url)).replace(/\\/g, '/');
const webModules = dir('./web/node_modules/');

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      { find: /^react-dom(\/.*)?$/, replacement: `${webModules}react-dom$1` },
      { find: /^react(\/.*)?$/, replacement: `${webModules}react$1` },
      // The ESM build, so its react imports go through the aliases above.
      { find: /^@testing-library\/react$/, replacement: dir('./node_modules/@testing-library/react/dist/@testing-library/react.esm.js') },
    ],
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 30000, // heavy API tests (12-month demo) can pass 5 s when the machine is busy
    environment: 'node',
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', MONGO_URL: '', AI_DISABLED: '1' },
    server: { deps: { inline: ['@testing-library/react', 'react-i18next'] } },
  },
});
