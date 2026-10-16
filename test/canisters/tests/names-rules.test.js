// Runs the naming modules' unit tests (motoko/names.test.mo: name rules, the lower-bound seek
// over mo:base/OrderedMap against a plain scan, the name index, search and paging) in the
// Motoko interpreter of the release compiler.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const DFX_VERSION = process.env.DFX_VERSION || '0.28.0';

describe('naming modules (src/sneed_names)', () => {
  it('pass their Motoko unit tests', () => {
    const cache = execFileSync('dfx', [`+${DFX_VERSION}`, 'cache', 'show'], { encoding: 'utf8' }).trim();
    const packages = execFileSync('mops', ['sources'], { cwd: root, encoding: 'utf8' }).trim().split(/\s+/);
    const out = execFileSync(resolve(cache, 'moc'), ['-r', ...packages, resolve(here, '..', 'motoko', 'names.test.mo')], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(out).toContain('names.test.mo: all passed');
  }, 120_000);
});
