import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', server: 'src/server.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'es2020',
  platform: 'neutral',
  // The shared core is imported by relative path, so it is bundled (code and types). viem is never imported.
  noExternal: [],
  external: ['node:crypto'],
  treeshake: true,
  minify: false,
  sourcemap: false,
});
