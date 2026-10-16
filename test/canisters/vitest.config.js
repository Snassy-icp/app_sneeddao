import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (dir) => fileURLToPath(new URL(`../../src/${dir}`, import.meta.url));

export default defineConfig({
  // the frontend's Vite aliases, for tests that run frontend modules against PocketIC
  resolve: { alias: { declarations: src('declarations'), external: src('external') } },
  test: {
    include: ['tests/**/*.test.js'],
    globalSetup: './lib/global-setup.js',
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Each file gets its own PocketIC instance; keep files sequential so the
    // server is not overloaded and logs stay readable.
    fileParallelism: false,
    reporters: ['verbose'],
  },
});
