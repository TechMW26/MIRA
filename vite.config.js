import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: [
        'favicon.svg',
        'mira-logo.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-512-maskable.png',
        'icons/apple-touch-icon.png',
      ],
      manifest: false,
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
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
