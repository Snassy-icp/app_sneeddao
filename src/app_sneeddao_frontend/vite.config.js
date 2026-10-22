import { fileURLToPath, URL } from 'url';
import { writeFileSync, readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import environment from 'vite-plugin-environment';
import dotenv from 'dotenv';
import { Principal } from '@dfinity/principal';

dotenv.config({ path: '../../.env' });

// Reproducible builds (the frontend is released by SNS proposal; voters rebuild and compare the
// asset canister's evidence). dfx gives every canister that has no id on the target network a random
// made-up 8-byte id in CANISTER_ID_*, so two builds of one commit differed. Replace each such id
// with one derived from the variable name: still not a canister id (realCanisterId() and the
// guardian list treat it as missing, as before), but the same on every build.
for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith('CANISTER_ID_') || !value || /^([a-z2-7]{5}-){4}cai$/.test(value)) continue;
  const bytes = createHash('sha256').update(`sneed-hub-missing-canister:${key}`).digest().subarray(0, 8);
  process.env[key] = Principal.fromUint8Array(Uint8Array.from(bytes)).toText();
}

// Plugin to write version.json with a build ID for frontend update detection.
// Asset canisters don't change module_hash when assets are updated, so we use this instead.
// The ID is a hash of everything else in dist/, so it changes exactly when the content does and
// the same commit always builds to the same bytes.
function versionJsonPlugin() {
  return {
    name: 'version-json',
    writeBundle() {
      const outDir = join(__dirname, 'dist');
      const files = [];
      const walk = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) walk(p); else files.push(relative(outDir, p).split('\\').join('/'));
        }
      };
      walk(outDir);
      const h = createHash('sha256');
      for (const f of files.filter((f) => f !== 'version.json').sort()) {
        h.update(f); h.update('\0'); h.update(readFileSync(join(outDir, f))); h.update('\0');
      }
      const buildId = h.digest('hex').slice(0, 16);
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
