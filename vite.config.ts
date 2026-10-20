import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { bundledLicenses } from './scripts/bundled-licenses';

export default defineConfig({
  base: './',
  plugins: [vue(), bundledLicenses('THIRD_PARTY_LICENSES.txt')],
  build: { outDir: 'dist' },
  server: {
    strictPort: true,
    proxy: { '/socket.io': { target: 'http://127.0.0.1:4300', ws: true } },
  },
});
