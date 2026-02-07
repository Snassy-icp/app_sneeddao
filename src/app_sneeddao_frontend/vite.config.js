import { fileURLToPath, URL } from 'url';
import { writeFileSync } from 'fs';
import { join } from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import environment from 'vite-plugin-environment';
import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });

// Plugin to write version.json with unique build ID for frontend update detection.
// Asset canisters don't change module_hash when assets are updated, so we use this instead.
function versionJsonPlugin() {
  return {
    name: 'version-json',
    writeBundle(_options, bundle) {
      const buildId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const outDir = join(__dirname, 'dist');
      writeFileSync(
        join(outDir, 'version.json'),
        JSON.stringify({ buildId }),
        'utf-8'
      );
    },
  };
}

export default defineConfig({
  build: {
    minify: false,
    emptyOutDir: true,
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4943",
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    environment("all", { prefix: "CANISTER_" }),
    environment("all", { prefix: "DFX_" }),
    versionJsonPlugin(),
  ],
  resolve: {
    alias: [
      {
        find: "declarations",
        replacement: fileURLToPath(
          new URL("../declarations", import.meta.url)
        ),
      },
      {
        find: "external",
        replacement: fileURLToPath(
          new URL("../external", import.meta.url)
        ),
      },
    ],
  },
});
