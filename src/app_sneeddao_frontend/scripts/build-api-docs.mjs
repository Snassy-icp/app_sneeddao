// Publishes the machine-readable API material next to the human docs:
//
//  - copies the generated Candid file and JS IDL factory of each documented
//    canister into public/api-docs/ so integrators can fetch them from the site
//  - writes public/.well-known/agent-skills/index.json (Agent Skills discovery,
//    schema 0.2.0) with a fresh sha256 digest of every SKILL.md, so the digest
//    can never go stale
//
// Runs as part of the frontend "prebuild" script after "dfx generate".

import { readdirSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODES } from '../src/data/architecture.js';

const frontendDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const declarationsDir = join(frontendDir, '..', 'declarations');
const apiDocsDir = join(frontendDir, 'public', 'api-docs');
const skillsDir = join(frontendDir, 'public', '.well-known', 'agent-skills');

// Canisters that have an API document in public/api-docs/<name>.md
const documented = [
    'sneed_lock', 'sneedex', 'sneed_sns_forum', 'sneed_sms', 'sneed_notifications', 'sneed_premium', 'rll', 'sneedapp',
    'mr_sneed', 'app_sneeddao_backend', 'sneed_pid_names', 'sneed_neuron_names', 'sneed_pid_nicknames',
    'sneed_neuron_nicknames', 'sneed_profiles', 'sneed_avatars', 'sneed_mon',
];
// (sneed_names.did / .did.js, the index of the six naming interfaces, are hand-written and kept in git)

mkdirSync(apiDocsDir, { recursive: true });
for (const name of documented) {
    for (const file of [`${name}.did`, `${name}.did.js`]) {
        const src = join(declarationsDir, name, file);
        if (!existsSync(src)) {
            console.warn(`build-api-docs: ${src} missing (run dfx generate first)`);
            continue;
        }
        copyFileSync(src, join(apiDocsDir, file));
    }
}

// Agent skills index
const schema = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';
const skills = [];
if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir)) {
        const dir = join(skillsDir, entry);
        if (!statSync(dir).isDirectory()) continue;
        const skillPath = join(dir, 'SKILL.md');
        if (!existsSync(skillPath)) continue;
        const bytes = readFileSync(skillPath);
        const text = bytes.toString('utf8');
        const front = text.match(/^---\n([\s\S]*?)\n---/);
        const field = (key) => front?.[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? '';
        const name = field('name') || entry;
        if (name !== entry) {
            throw new Error(`build-api-docs: skill directory "${entry}" must match its frontmatter name "${name}"`);
        }
        skills.push({
            name,
            type: 'skill-md',
            description: field('description'),
            url: `/.well-known/agent-skills/${entry}/SKILL.md`,
            digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        });
    }
}
skills.sort((a, b) => a.name.localeCompare(b.name));
mkdirSync(skillsDir, { recursive: true });
writeFileSync(join(skillsDir, 'index.json'), JSON.stringify({ $schema: schema, skills }, null, 2) + '\n');

// Service discoverability (https://docs.internetcomputer.org/guides/frontends/service-discoverability/),
// per network since canister ids and origins differ:
//  - /.well-known/ii-derivation-origin: the origin Internet Identity derives principals for, so an
//    agent logging a user in gets the same principal as the browser. Sneed Hub derives for the
//    origin people log in on (it sets no derivationOrigin).
//  - /.well-known/ic-architecture: every canister, its role and its docs. Publishing it opts the app
//    into ICP MCP and accepts DFINITY's ICP MCP App Operator Terms on behalf of the operator, so it is
//    only written when SNEED_PUBLISH_IC_ARCHITECTURE=1 (a decision for Sneed DAO, not for a build).
const network = process.env.DFX_NETWORK || 'local';
const wellKnown = join(frontendDir, 'public', '.well-known');
const canisterIds = JSON.parse(readFileSync(join(frontendDir, '..', '..', 'canister_ids.json'), 'utf8'));
const idOn = (name) => canisterIds[name]?.[network];
const origin = network === 'ic' ? 'https://app.sneeddao.com'
    : idOn('app_sneeddao_frontend') ? `https://${idOn('app_sneeddao_frontend')}.icp0.io` : null;
const derivationFile = join(wellKnown, 'ii-derivation-origin');
if (origin) writeFileSync(derivationFile, origin + '\n');
else if (existsSync(derivationFile)) unlinkSync(derivationFile);

const docsUrl = (slug) => `${origin || 'https://app.sneeddao.com'}/api-docs/${slug}.md`;
// Every canister, its role and description come from the architecture map that /architecture shows
// (src/data/architecture.js); it must agree with canister_ids.json, so differences are reported here.
const architecture = NODES.filter((n) => n.kind === 'dao' && n.ids)
    .map((n) => [n.id, n.role, n.api ? `${n.about} ${docsUrl(n.api)}` : n.about]);
for (const [name, ids] of Object.entries(canisterIds)) {
    const node = NODES.find((n) => n.id === name);
    if (!node) { console.warn(`build-api-docs: ${name} is in canister_ids.json but not in src/data/architecture.js`); continue; }
    for (const net of ['ic', 'staging']) {
        if ((node.ids?.[net] || null) !== (ids[net] || null)) console.warn(`build-api-docs: src/data/architecture.js has ${node.ids?.[net] || 'no id'} for ${name} on ${net}, canister_ids.json ${ids[net] || 'none'}`);
    }
}
const archFile = join(wellKnown, 'ic-architecture');
if (process.env.SNEED_PUBLISH_IC_ARCHITECTURE === '1' && origin) {
    const canisters = architecture.filter(([name]) => idOn(name)).map(([name, role, description]) => ({ id: idOn(name), name, role, description }));
    writeFileSync(archFile, JSON.stringify({ version: '1.0.0', canisters }, null, 2) + '\n');
} else if (existsSync(archFile)) unlinkSync(archFile);

console.log(`build-api-docs: copied interfaces for ${documented.join(', ')}; indexed ${skills.length} skill(s); ${network}: ii-derivation-origin ${origin || 'none'}, ic-architecture ${existsSync(archFile) ? 'published' : 'not published'}`);
