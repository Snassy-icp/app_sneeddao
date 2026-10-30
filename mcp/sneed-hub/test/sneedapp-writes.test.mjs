// sneedapp_mint and sneedapp_upgrade_bot against Candid-faithful fakes: the mint pays only the
// shortfall, and an upgrade walks every published version and installs only wasm that hashes to
// the published hash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { primeTokenInfo } from '../src/format.js';
import { configureIc } from '../src/ic.js';
import { sneedappWrites, upgradeSteps, upgradeRun, fetchVerifiedWasm } from '../src/tools/w_sneedapp.js';
import { idlFactory as sneedappIdl } from '../src/idl/sneedapp.did.js';
import { idlFactory as icrc1Idl } from '../src/idl/icrc1_ledger.did.js';
import { fake, useFakes, previewConfirm, ledgerImpl, def, retType, P, sub, tool } from './candid-fake.mjs';
import { setContextFactory } from '../src/writes.js';

const ICP = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const APP = '34e6r-ayaaa-aaaad-adkoa-cai';
const BOT = 'utrgg-zqaaa-aaaad-aduma-cai';
const ME = 'zcwrc-qhmeq-amaxy-5vluk-urvu5-bfuwr-l6t2t-63udo-vllgu-fdlsm-2ae';
const E8 = 100_000_000n;
configureIc({ host: 'http://127.0.0.1:9', canisters: { sneedapp: APP } });
primeTokenInfo({ ledger: ICP, name: 'Internet Computer', symbol: 'ICP', decimals: 8, fee: '10000' });

const VER_T = retType(sneedappIdl, 'getAppVersions', { unwrap: 1 });
const wasmOf = (v) => new TextEncoder().encode(`wasm ${v}`);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const ver = (s, extra = {}) => {
  const [major, minor, patch] = s.split('.').map(BigInt);
  return { ...def(VER_T), major, minor, patch, hasWasm: true, wasmHash: sha(wasmOf(s)), wasmUrl: [`https://example.org/${s}.wasm`], ...extra };
};
const VERSIONS = [ver('0.9.5'), ver('0.9.4'), ver('0.9.3'), ver('0.9.2'), ver('0.9.1'), ver('0.9.0')];

test('upgradeSteps walks every published version, oldest first, ending on the target', () => {
  const steps = upgradeSteps(ver('0.9.1'), ver('0.9.5'), VERSIONS);
  assert.deepEqual(steps.map((v) => `${v.major}.${v.minor}.${v.patch}`), ['0.9.2', '0.9.3', '0.9.4', '0.9.5']);
  assert.equal(upgradeSteps(null, ver('0.9.5'), VERSIONS).length, 1);
});

test('fetchVerifiedWasm refuses bytes that do not hash to the published hash', async () => {
  const ok = { ok: true, arrayBuffer: async () => wasmOf('0.9.5').buffer.slice(0) };
  assert.deepEqual(await fetchVerifiedWasm('u', sha(wasmOf('0.9.5')), async () => ok), wasmOf('0.9.5'));
  await assert.rejects(fetchVerifiedWasm('u', sha(wasmOf('0.9.4')), async () => ok), /not the published/);
});

const appFake = (extra = {}) => fake(sneedappIdl, {
  getApp: () => [{ ...def(retType(sneedappIdl, 'getApp', { unwrap: 1 })), appId: 'sneed-icp-staking-bot', name: 'ICP Staking Bot', enabled: true }],
  getAppVersions: () => VERSIONS,
  getPaymentSubaccount: () => sub(7),
  getAppMintPrice: () => ({ premium: 80_000_000n, isPremium: false, regular: E8, applicable: E8 }),
  getUserPaymentBalance: () => 30_000_000n,
  mintCanister: () => ({ Ok: { canisterId: P(BOT), accountId: new Uint8Array(32) } }),
  getMyWallet: () => [{ appId: 'sneed-icp-staking-bot', canisterId: P(BOT) }],
  ...extra,
});

test('sneedapp_mint pays only what the deposit lacks, then mintCanister with the version', async () => {
  const sa = appFake();
  const icp = fake(icrc1Idl, ledgerImpl({ [`${ME}/`]: E8 }));
  useFakes(ME, { [APP]: sa, [ICP]: icp }, { caps: { [ICP]: '1' } });
  const r = await previewConfirm(tool(sneedappWrites, 'sneedapp_mint'), { app_id: 'sneed-icp-staking-bot' });
  assert.match(r.preview, /Mint ICP Staking Bot 0\.9\.5 for 1 ICP/);
  assert.match(r.preview, /0\.7001 ICP on ryjl3/);
  assert.ok(!r.isError, r.done);
  assert.equal(icp.__calls.find((c) => c.method === 'icrc1_transfer').args[0].amount, 70_000_000n);
  assert.deepEqual(sa.__calls.find((c) => c.method === 'mintCanister').args, ['sneed-icp-staking-bot', [0n], [9n], [5n]]);
  assert.match(r.done, new RegExp(`minted ${BOT}`));
});

const ctxWith = (sa, { controllers = [ME], moduleHash = sha(wasmOf('0.9.2')), installs = [] } = {}) => setContextFactory(() => ({
  who: { mode: 'own', label: `as ${ME}` },
  principal: ME,
  anon: async (idl, id) => { if (String(id) === APP) return sa; throw new Error(`no fake for ${id}`); },
  signed: async (idl, id) => { if (String(id) === APP) return sa; throw new Error(`no fake for ${id}`); },
  canisterInfo: async () => ({ controllers, moduleHash }),
  management: async () => ({ install_code: async (a) => { installs.push(a); } }),
}));

test('sneedapp_upgrade_bot: from the running version (by module hash) through every later one; not a controller is blocked', async () => {
  const sa = appFake();
  useFakes(ME, {}, {});
  const installs = [];
  ctxWith(sa, { installs });
  const spec = tool(sneedappWrites, 'sneedapp_upgrade_bot');
  const { handleWrite } = await import('../src/writes.js');
  const p = (await handleWrite(spec, { canister_id: BOT })).content[0].text;
  assert.match(p, /from 0\.9\.2 to 0\.9\.5 in 3 steps/);
  assert.equal((p.match(/install_code/g) || []).length, 3);
  // run with a fake download: the 0.9.4 bytes are tampered with, so the run stops there
  const plan = { _steps: ['0.9.3', '0.9.4', '0.9.5'].map((v) => ({ v, url: `https://example.org/${v}.wasm`, hash: sha(wasmOf(v)) })) };
  const fetcher = async (url) => ({ ok: true, arrayBuffer: async () => (url.includes('0.9.4') ? new TextEncoder().encode('evil') : wasmOf(url.match(/(\d+\.\d+\.\d+)/)[1])).buffer.slice(0) });
  const ctx = { management: async () => ({ install_code: async (a) => { installs.push(a); } }) };
  const out = await upgradeRun({ canister_id: BOT }, ctx, plan, fetcher);
  assert.equal(out.ok, false);
  assert.match(out.error, /now on v0\.9\.3; v0\.9\.4 failed: the downloaded wasm hashes to/);
  assert.equal(installs.length, 1);
  assert.deepEqual(installs[0].mode, { upgrade: [] });
  ctxWith(sa, { controllers: ['aaaaa-aa'] });
  assert.match((await handleWrite(spec, { canister_id: BOT })).content[0].text, /BLOCKED[\s\S]*is not a controller/);
  ctxWith(sa, { moduleHash: sha(wasmOf('0.9.5')) });
  assert.match((await handleWrite(spec, { canister_id: BOT })).content[0].text, /BLOCKED[\s\S]*runs 0\.9\.5 already/);
});
