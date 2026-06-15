import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 3000,
  },
  server: {
    port: 3000,
    proxy: {
      '/api/chat': { target: 'http://localhost:3002', changeOrigin: true },
      '/api/scrape': { target: 'http://localhost:3002', changeOrigin: true },
      '/api/search': { target: 'http://localhost:3002', changeOrigin: true },
      '/api/image': { target: 'http://localhost:3002', changeOrigin: true },
      '/api/generate-image': { target: 'http://localhost:3002', changeOrigin: true },
    },
  },
});
