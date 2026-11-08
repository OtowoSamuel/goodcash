
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  define:
    mode === 'test'
      ? { 'import.meta.env.VITE_ENABLE_DEMO': JSON.stringify('false') }
      : {},
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'GoodCash',
        short_name: 'GoodCash',
        theme_color: '#120e20',
        background_color: '#120e20',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // The About, Privacy and Terms pages are real pages, not part of the app shell
        navigateFallbackDenylist: [/^\/(about|privacy|terms)\/?$/, /^\/\.well-known\//],
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) => request.mode === 'navigate' || url.origin === 'https://forno.celo.org',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'goodcash-shell',
              networkTimeoutSeconds: 3,
            },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://forno.celo.org' && url.pathname.includes('/balance'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'goodcash-balance',
              networkTimeoutSeconds: 3,
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  build: {
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          web3: ['viem'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
}));
