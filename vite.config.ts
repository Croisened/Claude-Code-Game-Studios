import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    preact(),
    viteStaticCopy({
      targets: [{ src: 'assets', dest: '' }],
    }),
  ],

  test: {
    globals: true,
    environment: 'node',
    exclude: ['archive/**', 'node_modules/**', 'dist/**', 'prototypes/**'],
    passWithNoTests: true,
  },
});
