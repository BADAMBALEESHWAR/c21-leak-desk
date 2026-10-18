import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { BRAND } from './src/brand';

const apiProxy = {
  '/api': {
    target: 'http://localhost:8080',
    changeOrigin: true,
  },
};

/** The HTML pages take the brand from src/brand.ts, so the name changes in one place. */
function brandHtml(): Plugin {
  const values: Record<string, string> = {
    __BRAND_NAME__: BRAND.name,
    __BRAND_TAGLINE__: BRAND.tagline,
    __BRAND_DESCRIPTION__: BRAND.description,
  };
  return {
    name: 'brand-html',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace(/__BRAND_[A-Z]+__/g, (token) => values[token] ?? token),
    },
  };
}

export default defineConfig({
  plugins: [brandHtml(), react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
    // The Change log page imports ../docs/*.md as raw text; the dev server may read the repo root for that.
    fs: { allow: ['..'] },
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: apiProxy,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      // Landing page at /, the app at /app/ (its hash router is unchanged), sign-in at /login/.
      // (/login without the slash is redirected by nginx and the CloudFront function.)
      input: {
        landing: 'index.html',
        app: 'app/index.html',
        login: 'login/index.html',
      },
      output: {
        // React is shared by both pages; keep it in one cacheable chunk with a plain name.
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
  },
});
