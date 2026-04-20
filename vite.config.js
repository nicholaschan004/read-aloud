import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      // Keep CDN imports as-is — don't try to bundle them
      external: (id) => id.startsWith('https://'),
    },
  },
});
