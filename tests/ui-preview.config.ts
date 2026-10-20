import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

// Separate, loopback-only UI review. Never used by production builds.
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: [{ find: './core/session', replacement: fileURLToPath(new URL('./ui-preview-session.ts', import.meta.url)) }] },
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
});
