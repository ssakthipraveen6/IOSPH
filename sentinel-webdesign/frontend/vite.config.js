/**
 * Vite build configuration for the front end (React plugin, dev proxy to the backend).
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // @sentinel/shared-constants is a CommonJS workspace package reached through a
  // symlink. Vite skips pre-bundling for linked packages, so in dev it is served
  // as raw ESM and `import { SEVERITY }` fails with "does not provide an export
  // named 'SEVERITY'" -- blanking the app. Forcing it through optimizeDeps makes
  // esbuild convert it to ESM with real named exports. The production build was
  // never affected because Rollup handles the CJS interop itself.
  optimizeDeps: {
    include: ['@sentinel/shared-constants'],
  },
  build: {
    emptyOutDir: true,
    commonjsOptions: {
      include: [/shared/, /node_modules/],
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/v1': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'http://127.0.0.1:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
