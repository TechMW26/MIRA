import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: [
        'favicon.svg',
      ],
      manifest: false,
      workbox: {
        cacheId: 'mira-v2',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        importScripts: ['/pwa-cache-reset-v2.js'],
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
      '/api/chat': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        // Streaming hygiene: never buffer, never time out mid-stream, and
        // forward chunks the moment the upstream emits them so model tokens
        // hit the browser with no intermediate hold-up.
        ws: false,
        proxyTimeout: 0,
        timeout: 0,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            try {
              proxyRes.headers['x-accel-buffering'] = 'no';
              proxyRes.headers['cache-control'] = 'no-cache, no-transform';
            } catch { /* ignore */ }
            try { proxyRes.socket?.setNoDelay?.(true); } catch { /* ignore */ }
          });
          proxy.on('proxyReq', (proxyReq) => {
            try { proxyReq.setNoDelay?.(true); } catch { /* ignore */ }
          });
        },
      },
      '/api/health': { target: 'http://localhost:3002', changeOrigin: true },
      '/api/search': { target: 'http://localhost:3002', changeOrigin: true },
      '/api/search-query': { target: 'http://localhost:3002', changeOrigin: true },
      '/api/browser-mcp': { target: 'http://localhost:3002', changeOrigin: true },
      '/api/image': { target: 'http://localhost:3002', changeOrigin: true },
      '/api/generate-image': { target: 'http://localhost:3002', changeOrigin: true },
      '/api/generate-video': { target: 'http://localhost:3002', changeOrigin: true },
    },
  },
});
