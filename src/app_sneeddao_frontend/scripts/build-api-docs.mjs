// Publishes the machine-readable API material next to the human docs:
//
//  - copies the generated Candid file and JS IDL factory of each documented
//    canister into public/api-docs/ so integrators can fetch them from the site
//  - writes public/.well-known/agent-skills/index.json (Agent Skills discovery,
//    schema 0.2.0) with a fresh sha256 digest of every SKILL.md, so the digest
//    can never go stale
//
// Runs as part of the frontend "prebuild" script after "dfx generate".

import { readdirSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const declarationsDir = join(frontendDir, '..', 'declarations');
const apiDocsDir = join(frontendDir, 'public', 'api-docs');
const skillsDir = join(frontendDir, 'public', '.well-known', 'agent-skills');

// Canisters that have an API document in public/api-docs/<name>.md
const documented = ['sneed_lock'];

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

console.log(`build-api-docs: copied interfaces for ${documented.join(', ')}; indexed ${skills.length} skill(s)`);
