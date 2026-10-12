import { defineConfig } from 'vitest/config';

export default defineConfig({
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
