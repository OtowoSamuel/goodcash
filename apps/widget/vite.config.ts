import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The widget is built from the same source as the published packages (one source of truth).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@goodcash/sdk': src('../../packages/sdk/src/index.ts'),
      '@goodcash/react': src('../../packages/react/src/index.ts'),
    },
  },
  build: { target: 'es2020', sourcemap: false },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
});
