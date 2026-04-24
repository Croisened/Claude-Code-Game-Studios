import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    preact(),
    viteStaticCopy({
      targets: [{ src: 'assets', dest: '' }],
    }),
  ],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  test: {
    globals: true,
    environment: 'node',
    exclude: ['archive/**', 'node_modules/**', 'dist/**', 'prototypes/**'],
    passWithNoTests: true,
  },
});
