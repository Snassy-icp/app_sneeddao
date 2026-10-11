// Rewrites generated canister declarations (src/declarations/*) so they import
// from @dfinity/* instead of @icp-sdk/core/*.
//
// dfx 0.31 and later emit declarations that import the @icp-sdk/core agent.
// This app, and the Internet Identity identities it signs with, use
// @dfinity/agent 2.x. Bundling both means signed calls made through the
// generated createActor hand a 2.x identity to a 5.x agent and fail, while
// anonymous calls still work. Apart from the import paths (and extra doc
// comments), the generated code is identical across dfx versions, so this
// rewrite is exact and makes the build independent of which dfx runs it.
//
// Runs as part of the frontend "prebuild" script, right after "dfx generate".

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const declarationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'declarations');

const importMap = {
    '@icp-sdk/core/agent': '@dfinity/agent',
    '@icp-sdk/core/candid': '@dfinity/candid',
    '@icp-sdk/core/principal': '@dfinity/principal',
};

let rewritten = 0;
for (const entry of readdirSync(declarationsDir)) {
    const dir = join(declarationsDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
        if (!/\.(js|ts)$/.test(file)) continue;
        const path = join(dir, file);
        const original = readFileSync(path, 'utf8');
        let updated = original;
        for (const [from, to] of Object.entries(importMap)) {
            updated = updated.split(from).join(to);
        }
        if (updated !== original) {
            writeFileSync(path, updated);
            rewritten++;
        }
    }
}

console.log(`fix-declaration-imports: rewrote ${rewritten} file(s) to @dfinity/* imports`);
