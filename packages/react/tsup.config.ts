import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'es2020',
  external: ['react', 'react-dom', '@goodcash/sdk'],
  banner: { js: "'use client';" },
});
