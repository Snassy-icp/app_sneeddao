// The Sneed proposal verifier's pure parts (tools/verifier/lib.mjs): reading what a proposal claims (Verify block,
// or the summaries we wrote before it), judging a rebuild, the forum post, and the state file. No canister needed.
import { describe, it, expect } from 'vitest';
import {
  parseVerifyBlock, formatVerifyBlock, parseSummaryFallback, wasmHashFromRendering, planVerification, judge,
  formatResult, loadState, emptyState, selectWork, recordOutcome, advance, MAX_ATTEMPTS, FORUM_POST_MAX,
} from '../../../tools/verifier/lib.mjs';

const H472 = '724db9c3d9e5b7d262fbd7a02b1c7d22647a856c1b7380d9489fee5008ecbf37';
const E473 = '429f8764d407064e96c4dddfd292359a9fda734051d40423c3779f7768871a47';
const FORUM = 'mcigm-4aaaa-aaaad-qhlkq-cai';
const NAMES = { [FORUM]: 'sneed_sns_forum', 'pxtkg-giaaa-aaaal-ajjzq-cai': 'app_sneeddao_frontend' };

// excerpts of the real summaries of #472 and #473
const S472 = `# Upgrade sneed_sns_forum: bug fixes, "Hot" thread order

Upgrades the Sneed DAO forum (mcigm-4aaaa-aaaad-qhlkq-cai) to commit e8ac353c (PR #8).

## Verify
Build with dfx 0.28.0 at /home/snassy/app_sneeddao, then gzip:
\`dfx build --network ic sneed_sns_forum && gzip -n -9\`

Wasm sha256 (gzipped): ${H472}
`;
const S473 = `Commits batch **557**, prepared on the Sneed Hub frontend asset canister (pxtkg-giaaa-aaaal-ajjzq-cai) from commit **44382a91** of https://github.com/Snassy-icp/app_sneeddao. This is the first frontend release by proposal, using function 7000 added by #455.

## Verify
1. Check out commit 44382a91.
2. With dfx 0.31.0, from the repo root: \`dfx deploy --network ic app_sneeddao_frontend --by-proposal --compute-evidence\`
3. Compare the evidence with this proposal's. Expected: \`${E473}\``;
const R472 = 'Embedded module with 570476 bytes and SHA256 `' + H472 + '`.';

const p472 = { id: '472', actionId: 3n, title: 'Upgrade sneed_sns_forum', summary: S472, url: 'https://github.com/Snassy-icp/app_sneeddao',
  rendering: R472, upgrade: { canisterId: FORUM, wasmSha256: H472 }, gnsf: null };
const p473 = { id: '473', actionId: 7000n, title: 'Sneed Hub frontend release', summary: S473, url: 'https://github.com/Snassy-icp/app_sneeddao',
  rendering: '', upgrade: null, gnsf: { functionId: 7000n, batchId: '557', evidence: E473 } };

describe('Verify block', () => {
  it('round-trips and is found anywhere in the summary, also in backticks', () => {
    const line = formatVerifyBlock({ commit: 'e8ac353c0000', canister: 'sneed_sns_forum', dfx: '0.28.0', build: 'dfx-build' });
    expect(line).toBe('Verify: repo=https://github.com/Snassy-icp/app_sneeddao commit=e8ac353c0000 canister=sneed_sns_forum dfx=0.28.0 build=dfx-build');
    expect(parseVerifyBlock(`# Title\n\ntext\n\n\`${line}\`\n`)).toEqual({
      repo: 'https://github.com/Snassy-icp/app_sneeddao', commit: 'e8ac353c0000', canister: 'sneed_sns_forum', dfx: '0.28.0', build: 'dfx-build' });
  });
  it('is null when absent', () => {
    expect(parseVerifyBlock(S472)).toBeNull();
    expect(parseVerifyBlock('Verify the hash yourself')).toBeNull();
  });
  it('wins over the summary text', () => {
    const plan = planVerification({ ...p472, summary: S472 + '\nVerify: repo=https://github.com/Snassy-icp/app_sneeddao commit=abcdef12 canister=sneed_sns_forum dfx=0.28.0 build=dfx-build' }, NAMES);
    expect(plan).toMatchObject({ kind: 'motoko', commit: 'abcdef12', source: 'verify-block' });
  });
});

describe('existing summaries (fallback)', () => {
  it('reads #472: commit, dfx, the hash', () => {
    expect(parseSummaryFallback(S472)).toMatchObject({ commit: 'e8ac353c', dfx: '0.28.0', hashes: [H472] });
    expect(wasmHashFromRendering(R472)).toBe(H472);
  });
  it('reads #473: bold commit and repo URL', () => {
    expect(parseSummaryFallback(S473)).toMatchObject({ commit: '44382a91', dfx: '0.31.0', repo: 'https://github.com/Snassy-icp/app_sneeddao' });
  });
  it('plans #472 as the forum build and #473 as the frontend batch', () => {
    expect(planVerification(p472, NAMES)).toMatchObject({ kind: 'motoko', canister: 'sneed_sns_forum', commit: 'e8ac353c', dfx: '0.28.0', expected: H472, source: 'summary' });
    expect(planVerification(p473, NAMES)).toMatchObject({ kind: 'frontend', canister: 'app_sneeddao_frontend', commit: '44382a91', batchId: '557', expected: E473 });
  });
});

describe('cannot verify', () => {
  it('no commit', () => expect(planVerification({ ...p472, summary: 'Upgrade the forum.' }, NAMES)).toMatchObject({ kind: 'cannot', reason: expect.stringMatching(/no commit/) }));
  it('unknown canister', () => expect(planVerification({ ...p472, upgrade: { canisterId: 'aaaaa-aa', wasmSha256: H472 } }, NAMES)).toMatchObject({ kind: 'cannot', reason: expect.stringMatching(/canister_ids/) }));
  it('another dfx', () => expect(planVerification({ ...p472, summary: S472.replace('0.28.0', '0.25.0') }, NAMES)).toMatchObject({ kind: 'cannot', reason: expect.stringMatching(/0\.25\.0/) }));
  it('a Verify block naming another canister than the one upgraded', () => {
    const s = 'Verify: repo=https://github.com/Snassy-icp/app_sneeddao commit=abcdef12 canister=sneed_lock dfx=0.28.0 build=dfx-build';
    expect(planVerification({ ...p472, summary: s }, NAMES)).toMatchObject({ kind: 'cannot', reason: expect.stringMatching(/sneed_lock/) });
  });
  it('no hash rendered', () => expect(planVerification({ ...p472, upgrade: { canisterId: FORUM, wasmSha256: null } }, NAMES)).toMatchObject({ kind: 'cannot' }));
  it('other proposals are skipped', () => expect(planVerification({ ...p472, actionId: 1n, upgrade: null }, NAMES).kind).toBe('skip'));
});

describe('judge and post', () => {
  const plan = planVerification(p472, NAMES);
  it('matches the gzipped hash', () => {
    const v = judge(plan, { mode: 'motoko', gz_sha256: H472, raw_sha256: 'ab'.repeat(32) });
    expect(v).toMatchObject({ status: 'ok', matched: 'gzip -n -9' });
    const body = formatResult(plan, v, { fullCommit: 'e8ac353c' + '0'.repeat(32) });
    expect(body).toMatch(/Reproduced ✅/);
    expect(body).toMatch(H472);
    expect(body).toMatch(/no AI/);
  });
  it('matches the raw hash too', () => expect(judge(plan, { mode: 'motoko', gz_sha256: 'cd'.repeat(32), raw_sha256: H472 })).toMatchObject({ status: 'ok', matched: 'raw' }));
  it('reports a mismatch with both hashes', () => {
    const v = judge(plan, { mode: 'motoko', gz_sha256: 'cd'.repeat(32), raw_sha256: 'ab'.repeat(32) });
    expect(v.status).toBe('mismatch');
    const body = formatResult(plan, v);
    expect(body).toMatch(/Mismatch ❌/);
    expect(body).toMatch('cd'.repeat(32));
    expect(body).toMatch('ab'.repeat(32));
  });
  it('frontend evidence and served-assets checks', () => {
    const fp = planVerification(p473, NAMES);
    expect(judge(fp, { mode: 'frontend', evidence: E473 }).status).toBe('ok');
    expect(judge(fp, { mode: 'frontend', evidence: '00'.repeat(32) }).status).toBe('mismatch');
    const served = judge(fp, { mode: 'frontend-served', served_match: true, files: 120 });
    expect(served).toMatchObject({ status: 'ok', served: true });
    expect(formatResult(fp, served)).toMatch(/already executed/);
  });
  it('cannot-verify posts carry the reason and stay under the forum limit', () => {
    const body = formatResult({ id: '9', kind: 'unknown' }, { status: 'cannot', reason: 'x'.repeat(10_000) });
    expect(body).toMatch(/Cannot verify ⚠️/);
    expect(body.length).toBeLessThanOrEqual(FORUM_POST_MAX);
  });
});

describe('state', () => {
  it('loads junk as empty', () => {
    expect(loadState(null)).toEqual(emptyState());
    expect(loadState({ last_seen: 'x', done: 3 })).toEqual(emptyState());
    expect(loadState({ last_seen: 472, done: { 472: { status: 'ok' } } }).last_seen).toBe('472');
  });
  it('first run starts after the newest, without backfilling', () => {
    const { work, newest } = selectWork(emptyState(), ['471', '473', '472']);
    expect(work).toEqual([]);
    expect(advance(emptyState(), newest).last_seen).toBe('473');
  });
  it('picks up new ids and retries, never ones already done', () => {
    let s = { ...emptyState(), last_seen: '471', done: { 473: { status: 'ok' } }, retry: { 470: { attempts: 1 } } };
    expect(selectWork(s, ['471', '472', '473', '474']).work).toEqual(['470', '472', '474']);
    s = advance(s, 474n);
    expect(s.last_seen).toBe('474');
    expect(advance(s, 400n).last_seen).toBe('474');
  });
  it('retries transient failures up to MAX_ATTEMPTS, then records them', () => {
    let s = { ...emptyState(), last_seen: '1' };
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      s = recordOutcome(s, 5, { status: 'cannot', transient: true, reason: 'network' }, 't');
      expect(s.retry['5'].attempts).toBe(i);
      expect(s.done['5']).toBeUndefined();
    }
    s = recordOutcome(s, 5, { status: 'cannot', transient: true, reason: 'network', posted: true }, 't');
    expect(s.retry['5']).toBeUndefined();
    expect(s.done['5']).toEqual({ status: 'cannot', posted: true, at: 't' });
  });
  it('final outcomes clear the retry', () => {
    const s = recordOutcome({ ...emptyState(), retry: { 7: { attempts: 1 } } }, '7', { status: 'ok', posted: true }, 't');
    expect(s).toMatchObject({ retry: {}, done: { 7: { status: 'ok', posted: true } } });
  });
});
