
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * A production build must name the one-tap router (VITE_ROUTER_V2_ADDRESS). Without it the app would quietly fall back to
 * the original router, which a stray token balance can block. So the build stops instead. Development, test and preview
 * builds are not affected.
 */
function requireOneTapRouter(mode: string): Plugin {
  return {
    name: 'goodcash-require-one-tap-router',
    apply: 'build',
    config() {
      if (mode !== 'production') return;
      const address = loadEnv(mode, process.cwd(), 'VITE_').VITE_ROUTER_V2_ADDRESS;
      const ok = typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address) && !/^0x0{40}$/.test(address);
      if (!ok) {
        throw new Error(
          'Production build stopped: VITE_ROUTER_V2_ADDRESS is missing or not a real address. Without it the app would use the original ' +
            'router, which stray balances can block. Set it in apps/web/.env.production (see services/orders/wrangler.toml for the address).'
        );
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  define:
    mode === 'test'
      ? { 'import.meta.env.VITE_ENABLE_DEMO': JSON.stringify('false') }
      : {},
  plugins: [
    requireOneTapRouter(mode),
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
        globIgnores: ['404.html'],
        // The About, Privacy and Terms pages are real pages, not part of the app shell
        navigateFallbackDenylist: [/^\/(about|privacy|terms|stats)\/?$/, /^\/\.well-known\//],
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
        // New file locations: a few old script addresses were cached by the network as the home page, which broke the
        // wallet panel on phones. Fresh addresses have never been cached.
        entryFileNames: 'assets/b/[name]-[hash].js',
        chunkFileNames: 'assets/b/[name]-[hash].js',
        assetFileNames: 'assets/b/[name]-[hash][extname]',
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
    // The full suite is heavy; a busy machine made a different test time out at 5 s on each run (they pass alone).
    testTimeout: 20000,
  },
}));
