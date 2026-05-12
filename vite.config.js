import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api/chat': { target: 'https://www.itsmira.cloud', changeOrigin: true, secure: true },
      '/api/image': { target: 'https://www.itsmira.cloud', changeOrigin: true, secure: true },
      '/api/scrape': { target: 'http://localhost:3002', changeOrigin: true },
      '/api/search': { target: 'http://localhost:3002', changeOrigin: true },
    },
  },
});
