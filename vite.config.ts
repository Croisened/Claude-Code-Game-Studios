import { defineConfig } from 'vite';

export default defineConfig({
  // Exclude WASM-based packages from Vite's pre-bundling so their
  // async WASM init is not broken by the optimizer.
  optimizeDeps: {
    exclude: ['enable3d', '@dimforge/rapier3d-compat'],
  },

  test: {
    globals: true,
    environment: 'node',
  },
});
