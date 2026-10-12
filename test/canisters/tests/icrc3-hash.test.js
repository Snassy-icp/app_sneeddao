// Runs the Motoko hash vectors (motoko/hash.test.mo) in the Motoko
// interpreter of the release compiler, and cross-checks the same vectors with
// the JavaScript implementation used by the integration tests.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashValue, leb128, sleb128 } from '../lib/icrc3.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const DFX_VERSION = process.env.DFX_VERSION || '0.28.0';

describe('ICRC-3 hashing', () => {
  it('Motoko implementation matches the published vectors', () => {
    const cache = execFileSync('dfx', [`+${DFX_VERSION}`, 'cache', 'show'], { encoding: 'utf8' }).trim();
    const packages = execFileSync('mops', ['sources'], { cwd: root, encoding: 'utf8' }).trim().split(/\s+/);
    const out = execFileSync(resolve(cache, 'moc'), ['-r', ...packages, resolve(here, '..', 'motoko', 'hash.test.mo')], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(out).toContain('HASH VECTORS OK');
  });

  it('JavaScript implementation matches the same vectors', () => {
    const request = { Map: [
      ['request_type', { Text: 'call' }],
      ['sender', { Blob: new Uint8Array([4]) }],
      ['ingress_expiry', { Nat: 1685570400000000000n }],
      ['canister_id', { Blob: new Uint8Array([0, 0, 0, 0, 0, 0, 4, 0xd2]) }],
      ['method_name', { Text: 'hello' }],
      ['arg', { Blob: new Uint8Array([0x44, 0x49, 0x44, 0x4c, 0, 0xfd, 0x2a]) }],
    ] };
    expect(hashValue(request).toString('hex')).toBe('1d1091364d6bb8a6c16b203ee75467d59ead468f523eb058880ae8ec80e2b101');
    const nested = { Map: [['i', { Int: -123456n }], ['j', { Int: 64n }], ['a', { Array: [{ Nat: 1n }, { Text: 'x' }, { Map: [['k', { Blob: new Uint8Array([1, 2, 3]) }]] }] }]] };
    expect(hashValue(nested).toString('hex')).toBe('8265f3405c882aeacfde787f2e7af31b4350ff29275c02a553936d457c3eab93');
    expect([...leb128(624485)]).toEqual([0xe5, 0x8e, 0x26]);
    expect([...sleb128(-123456)]).toEqual([0xc0, 0xbb, 0x78]);
    expect([...sleb128(-65)]).toEqual([0xbf, 0x7f]);
  });
});
