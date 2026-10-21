// The Sneedapp ICRC-3 activity log (spec/sneedapp_icrc3.md): an empty log with the documented
// catalogue; one block per config change, publisher change, app and version change, Wasm upload
// and clear (with the SHA-256 and size), official version and manager Wasm change; every mint
// (mintCanister and the legacy createNeuronManager) with the installed module's SHA-256, the
// price and the ledger block of every transfer; refunds of aborted mints (with what came back and
// what is stuck); deposit, publisher and admin withdrawals and top-ups; transferManager and the
// privileged wallet writes, but not a user's own bookmarks; nothing for refused or failed calls
// or for calls that change nothing; the hash chain and certified tip verify (lib/icrc3.js);
// spills into archives co-controlled by SNS root and registered through a hotkeyed neuron; the
// ingress guard; an upgrade keeps the log; and an upgrade from the production build (src/sneedapp
// at 25b88246, module hash 96f4f055…, build/sneedapp_prod.wasm) keeps apps, versions, Wasms,
// wallets, the mint log and config, and starts an empty log.
// SNEEDAPP_WASM=sneedapp_prod npx vitest run tests/sneedapp-icrc3.test.js runs it against the production code.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { createHash } from 'node:crypto';
import {
  createPic, install, actorAs, account, principalToSubaccount, admin, alice, bob, carol, user, ICP_LEDGER_ID, SNEED_SNS_ROOT, T,
  unwrap, errOf, wasm, refusedAtIngress, asUpdates,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit, cmcIdl, premiumIdl } from '../lib/idl.js';
import { rllGovernanceIdl, hex } from '../lib/idl-rll.js';
import { archiveIdl, btype, tx, verifyLog, icrc3Service } from '../lib/icrc3.js';
import { idlFactory as factoryIdl } from '../build/sneedapp.did.js';

const SNEEDAPP_WASM = process.env.SNEEDAPP_WASM || 'sneedapp';
const BLOCK_TYPES_URL = 'https://app.sneeddao.com/api/sneedapp#block-types';
const CATALOGUE = [
  'sneedapp_app_add', 'sneedapp_app_update', 'sneedapp_app_enable', 'sneedapp_app_disable', 'sneedapp_app_remove',
  'sneedapp_version_add', 'sneedapp_version_update', 'sneedapp_version_remove', 'sneedapp_wasm_upload', 'sneedapp_wasm_clear',
  'sneedapp_official_version_set', 'sneedapp_official_version_remove', 'sneedapp_manager_wasm_set', 'sneedapp_manager_wasm_clear',
  'sneedapp_publisher_create', 'sneedapp_publisher_update', 'sneedapp_publisher_verify', 'sneedapp_publisher_unverify',
  'sneedapp_mint', 'sneedapp_mint_refund', 'sneedapp_orphan_canister', 'sneedapp_orphan_settled', 'sneedapp_top_up_retry',
  'sneedapp_refund_credit_claim', 'sneedapp_refund_credit_closed', 'sneedapp_deposit_withdraw', 'sneedapp_publisher_withdraw',
  'sneedapp_admin_withdraw', 'sneedapp_admin_top_up', 'sneedapp_wallet_transfer', 'sneedapp_wallet_register', 'sneedapp_wallet_deregister',
  'sneedapp_config_update',
];
const CMC_ID = Principal.fromText('rkp4c-7iaaa-aaaaa-aaaca-cai');
const ICP = 100_000_000n;
const ICP_FEE = 10_000n;
const CYCLES_ICP = 60_000_000n; // 2 T cycles at 3.5 XDR/ICP plus 5% (the mock CMC's rate)
const SEC = 1_000_000_000n;
const dave = user('dave');
const eve = user('eve');
const treasury = user('treasury');
const sneedex = user('sneedex'); // an authorised "for" caller
const c1 = Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai');
const c2 = Principal.fromText('r7inp-6aaaa-aaaaa-aaabq-cai');
const c3 = Principal.fromText('renrk-eyaaa-aaaaa-aaada-cai');
const c4 = Principal.fromText('rdmx6-jaaaa-aaaaa-aaadq-cai');
const wasmV1 = wasm('MockPremium');
const wasmV2 = wasm('MockCmc');
const botWasm = wasm('sneed_icp_staking_bot');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const SUB = new Uint8Array(32).fill(7);

const faultIdl = ({ IDL }) => IDL.Service({
  set_fail_to: IDL.Func([IDL.Vec(IDL.Principal)], [], []),
  set_fail_from_main: IDL.Func([IDL.Vec(IDL.Principal)], [], []),
});
// the canister's interface plus the log's (so the test runs against a build without it, and fails there)
const fullIdl = ({ IDL }) => IDL.Service({ ...Object.fromEntries(factoryIdl({ IDL })._fields), ...icrc3Service(IDL) });

let pic, rootKey, appSubnet;
let icpId, govId, premiumId, factoryId;
let icp, fault, gov, premium, f;
let pubSub1; // publisher 1's revenue subaccount
let demoMint; // a canister carol minted from "demo"

const as = (p, id = factoryId) => actorAs(pic, fullIdl, id, p);
const archiveActor = (id) => actorAs(pic, archiveIdl, id, admin);
const P = (p) => hex(p.toUint8Array());
const A = (owner, sub = null) => (sub ? [P(owner), hex(sub)] : [P(owner)]);
const plain = (v) => {
  if ('Nat' in v) return v.Nat;
  if ('Int' in v) return v.Int;
  if ('Text' in v) return v.Text;
  if ('Blob' in v) return hex(v.Blob);
  if ('Array' in v) return v.Array.map(plain);
  return Object.fromEntries(v.Map.map(([k, x]) => [k, plain(x)]));
};
const advance = async (ns, ticks = 2) => { await pic.advanceTime(Number(ns / 1_000_000n)); await pic.tick(ticks); };
const depositAccount = (p, id = factoryId) => account(id, principalToSubaccount(p));
const deposit = (p, amount, id = factoryId) => icp.mint(depositAccount(p, id), amount);
const txCount = async () => (await icp.get_transactions()).length;
const newTxs = async (from) => (await icp.get_transactions()).slice(from);

/// The whole log, verified (certificate, tree, phash chain, catalogue), as plain records { i, t, ...tx }.
const rawLog = async (id = factoryId) => (await verifyLog(as(admin, id), id, rootKey, archiveActor)).blocks;
const verifiedLog = async (id = factoryId) => (await rawLog(id)).map((b, i) => ({ i, t: btype(b), ...plain(tx(b)) }));
const logLength = async (id = factoryId) => Number((await as(admin, id).icrc3_log_status()).log_length);
const since = async (mark, id = factoryId) => (await verifiedLog(id)).slice(mark);
const strip = (blocks) => blocks.map(({ i, ...b }) => b);
const trap = (p) => expect(p).rejects.toThrow();

const ver = (major, minor, patch = 0n) => ({ major, minor, patch });
const vin = (major, minor, extra = {}) => ({ major, minor, patch: 0n, wasmHash: '', wasmUrl: [], sourceUrl: [], releaseNotes: '', releaseDate: 0n, ...extra });
const appInput = (appId, extra = {}) => ({ appId, name: appId, description: '', iconUrl: [], mintPriceE8s: ICP, premiumMintPriceE8s: 80_000_000n, viewUrl: [], manageUrl: [], mintUrl: [], families: [], ...extra });
const updInput = ({ appId, ...rest }) => rest;
const pubInput = (name, extra = {}) => ({ name, description: '', websiteUrl: [], logoUrl: [], links: [], defaultPaymentAccount: account(alice), ...extra });
const official = (minor, hash, extra = {}) => ({ major: 0n, minor, patch: 0n, wasmHash: hash, wasmUrl: 'https://w/' + minor, sourceUrl: 'https://s/' + minor, ...extra });
const officialV = (o) => ({ major: o.major, minor: o.minor, patch: o.patch, wasm_hash: o.wasmHash, wasm_url: o.wasmUrl, source_url: o.sourceUrl });

beforeAll(async () => {
  ({ pic, appSubnet, rootKey } = await createPic());
  icpId = await install(pic, { name: 'MockLedgerFaulty', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  await install(pic, { name: 'MockCmc', targetCanisterId: CMC_ID });
  premiumId = await install(pic, { name: 'MockPremium' });
  govId = await install(pic, { name: 'MockRllGovernance', targetSubnetId: appSubnet });
  factoryId = await install(pic, { name: SNEEDAPP_WASM, cycles: 100n * T, targetSubnetId: appSubnet });
  icp = actorAs(pic, ledgerIdl, icpId, admin);
  fault = actorAs(pic, faultIdl, icpId, admin);
  gov = actorAs(pic, rllGovernanceIdl, govId, admin);
  premium = actorAs(pic, premiumIdl, premiumId, admin);
  f = as(admin);
}, 120_000);

afterAll(async () => { await pic?.tearDown(); });

describe('fresh install', () => {
  it('has an empty log, the documented catalogue and ICRC-3 among its standards', async () => {
    expect(await as(alice).icrc3_log_status()).toMatchObject({ log_length: 0n, live_blocks: 0n, archives: [], history_imported: false, last_block_hash: [] });
    expect(await as(alice).icrc3_get_tip_certificate()).toEqual([]);
    expect(await as(alice).icrc3_supported_block_types()).toEqual(CATALOGUE.map((block_type) => ({ block_type, url: BLOCK_TYPES_URL })));
    expect((await as(alice).icrc10_supported_standards()).map((s) => s.name)).toEqual(['ICRC-3', 'ICRC-10']);
    expect(await as(alice).icrc3_get_blocks([{ start: 0n, length: 10n }])).toEqual({ log_length: 0n, blocks: [], archived_blocks: [] });
    expect(await as(alice).icrc3_get_archives({ from: [] })).toEqual([]);
  });
});

describe('configuration', () => {
  it('logs nothing for refused calls', async () => {
    const mark = await logLength();
    await trap(as(alice).setCreationFee(1n));
    await trap(as(alice).addAdmin(alice));
    await trap(as(alice).setFeeDestination(account(alice)));
    await trap(as(alice).addAuthorizedForCaller(alice));
    await trap(as(alice).setManagerWasm(wasmV1));
    await trap(as(alice).addOfficialVersion(official(9n, 'aa')));
    const none = { max_live_blocks: [5n], spill_batch_size: [], archive_max_blocks: [], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] };
    expect(errOf(await as(alice).admin_set_icrc3_settings(none))).toMatch(/admins/);
    expect(errOf(await as(alice).admin_icrc3_spill_now())).toMatch(/admins/);
    expect(errOf(await as(alice).admin_set_icrc3_proposal_neuron([]))).toMatch(/admins/);
    expect(errOf(await as(alice).admin_icrc3_register_archives_now())).toMatch(/admins/);
    expect(errOf(await as(alice).admin_icrc3_reset_archive_registration(alice))).toMatch(/admins/);
    await trap(as(alice).admin_icrc3_repair_archive_controllers());
    expect(await logLength()).toBe(mark);
  });

  it('logs each changed setting with its old value, and nothing for a setting set to itself', async () => {
    const mark = await logLength();
    await f.setFeeDestination(account(treasury));
    await f.setFeeDestination(account(treasury)); // unchanged
    await f.setSneedPremiumCanisterId([premiumId]);
    await f.setPaymentConfig({ creationFeeE8s: 2n * ICP, targetCyclesAmount: 2n * T, feeDestination: account(treasury), paymentRequired: false });
    await f.setPaymentRequired(true);
    await f.setCreationFee(ICP);
    await f.setCreationFee(ICP); // unchanged
    await f.setPremiumCreationFee(40_000_000n);
    await f.setTargetCycles(3n * T);
    await f.setTargetCycles(2n * T);
    await f.setCanisterCreationCycles(1n * T); // unchanged (the default)
    await f.setCurrentVersion(ver(0n, 9n, 5n));
    await f.addAdmin(dave);
    await f.addAdmin(dave); // already an admin
    await f.removeAdmin(dave);
    await f.addAuthorizedForCaller(sneedex);
    await f.addAuthorizedForCaller(sneedex); // already
    await f.addAuthorizedForCaller(eve);
    await f.removeAuthorizedForCaller(eve);
    await f.setSneedGovernance([govId]);
    const blocks = await since(mark);
    expect(blocks.every((b) => b.t === 'sneedapp_config_update' && b.caller === P(admin))).toBe(true);
    expect(blocks.map((b) => [b.key, b.value, b.old_value])).toEqual([
      ['fee_destination', A(treasury), A(admin)],
      ['sneed_premium_canister_id', P(premiumId), 'none'],
      ['creation_fee_e8s', 2n * ICP, ICP],
      ['payment_required', 0n, 1n],
      ['payment_required', 1n, 0n],
      ['creation_fee_e8s', ICP, 2n * ICP],
      ['premium_creation_fee_e8s', 40_000_000n, 50_000_000n],
      ['target_cycles', 3n * T, 2n * T],
      ['target_cycles', 2n * T, 3n * T],
      ['current_version', { major: 0n, minor: 9n, patch: 5n }, { major: 0n, minor: 0n, patch: 0n }],
      ['admin_added', P(dave), undefined],
      ['admin_removed', P(dave), undefined],
      ['authorized_caller_added', P(sneedex), undefined],
      ['authorized_caller_added', P(eve), undefined],
      ['authorized_caller_removed', P(eve), undefined],
      ['sneed_governance', P(govId), 'none'],
    ]);
  });
});

describe('publishers', () => {
  it('logs creation, every change of a logged field, and verification, and nothing for refusals or no-ops', async () => {
    const mark = await logLength();
    expect(unwrap(await as(alice).createPublisher(pubInput('Alice Labs')))).toBe(1n);
    unwrap(await as(alice).updatePublisher(1n, pubInput('Alice Labs', { description: 'only the description' }))); // not a logged field
    unwrap(await as(alice).updatePublisher(1n, pubInput('Alice Studio', { websiteUrl: ['https://alice.example'] })));
    unwrap(await as(alice).addPublisherOwner(1n, bob));
    expect(errOf(await as(alice).addPublisherOwner(1n, bob))).toMatch(/Already/);
    unwrap(await as(bob).removePublisherOwner(1n, bob));
    await trap(as(bob).updatePublisher(1n, pubInput('Bob took it'))); // refused at ingress
    unwrap(await as(alice).addPublisherFamily(1n, 'bots'));
    await f.setPublisherDaoCut(1n, 2500n);
    await f.verifyPublisher(1n);
    await f.verifyPublisher(1n); // already
    await f.unverifyPublisher(1n);
    await f.verifyPublisher(1n);
    await trap(as(carol).verifyPublisher(1n));
    await trap(as(Principal.anonymous()).createPublisher(pubInput('anon'))); // refused at ingress
    const blocks = await since(mark);
    const pub = { publisher_id: 1n, name: 'Alice Labs', owners: [P(alice)], verified: 0n, families: [], default_payment_account: A(alice), dao_cut_bps: 1000n };
    const studio = { ...pub, name: 'Alice Studio', website_url: 'https://alice.example' };
    expect(strip(blocks)).toEqual([
      { t: 'sneedapp_publisher_create', caller: P(alice), publisher: pub },
      { t: 'sneedapp_publisher_update', caller: P(alice), method: 'updatePublisher', publisher: studio, old_publisher: pub },
      { t: 'sneedapp_publisher_update', caller: P(alice), method: 'addPublisherOwner', publisher: { ...studio, owners: [P(alice), P(bob)] }, old_publisher: studio },
      { t: 'sneedapp_publisher_update', caller: P(bob), method: 'removePublisherOwner', publisher: studio, old_publisher: { ...studio, owners: [P(alice), P(bob)] } },
      { t: 'sneedapp_publisher_update', caller: P(alice), method: 'addPublisherFamily', publisher: { ...studio, families: ['bots'] }, old_publisher: studio },
      { t: 'sneedapp_publisher_update', caller: P(admin), method: 'setPublisherDaoCut', publisher: { ...studio, families: ['bots'], dao_cut_bps: 2500n }, old_publisher: { ...studio, families: ['bots'] } },
      { t: 'sneedapp_publisher_verify', caller: P(admin), publisher_id: 1n },
      { t: 'sneedapp_publisher_unverify', caller: P(admin), publisher_id: 1n },
      { t: 'sneedapp_publisher_verify', caller: P(admin), publisher_id: 1n },
    ]);
    pubSub1 = await f.getPublisherRevenueSubaccount(1n);
  });
});

describe('apps, versions and Wasms (the supply chain)', () => {
  const demoApp = { app_id: 'demo', numeric_app_id: 0n, publisher_id: 1n, name: 'demo', mint_price_e8s: ICP, premium_mint_price_e8s: 80_000_000n, families: ['bots'], enabled: 0n };

  it('logs apps added, changed, enabled and disabled, and nothing for refusals or unchanged values', async () => {
    const mark = await logLength();
    expect(unwrap(await as(alice).addApp(1n, appInput('demo', { families: ['bots'] })))).toBe(0n);
    expect(errOf(await as(alice).addApp(1n, appInput('demo')))).toMatch(/already exists/);
    expect(errOf(await as(alice).addApp(1n, appInput('other', { families: ['nope'] })))).toMatch(/not in publisher's families/);
    await trap(as(bob).addApp(1n, appInput('bobs'))); // refused at ingress
    unwrap(await as(alice).updateApp(0n, updInput(appInput('demo', { families: ['bots'], description: 'longer text' })))); // not a logged field
    unwrap(await as(alice).setAppPricing(0n, ICP, 80_000_000n)); // unchanged
    unwrap(await as(alice).setAppPricing(0n, 2n * ICP, 80_000_000n));
    unwrap(await as(alice).updateApp(0n, updInput(appInput('demo', { families: ['bots'], viewUrl: ['/demo/CANISTER_ID'] }))));
    unwrap(await as(alice).setAppEnabled(0n, true));
    unwrap(await as(alice).setAppEnabled(0n, true)); // already
    unwrap(await as(alice).setAppEnabled(0n, false));
    unwrap(await as(alice).setAppEnabled(0n, true));
    unwrap(await as(alice).setAppPaymentAccount(0n, [account(alice, SUB)]));
    await f.setAppDaoCut(0n, [3000n]);
    await f.setAppDaoCut(0n, []);
    await trap(as(alice).setAppDaoCut(0n, [0n]));
    const blocks = await since(mark);
    const priced = { ...demoApp, mint_price_e8s: 2n * ICP };
    const viewed = { ...demoApp, view_url: '/demo/CANISTER_ID' };
    const on = { ...viewed, enabled: 1n };
    const paid = { ...on, payment_account: A(alice, SUB) };
    const ids = { app_id: 'demo', numeric_app_id: 0n, publisher_id: 1n };
    expect(strip(blocks)).toEqual([
      { t: 'sneedapp_app_add', caller: P(alice), app: demoApp },
      { t: 'sneedapp_app_update', caller: P(alice), method: 'setAppPricing', app: priced, old_app: demoApp },
      { t: 'sneedapp_app_update', caller: P(alice), method: 'updateApp', app: viewed, old_app: priced },
      { t: 'sneedapp_app_enable', caller: P(alice), ...ids },
      { t: 'sneedapp_app_disable', caller: P(alice), ...ids },
      { t: 'sneedapp_app_enable', caller: P(alice), ...ids },
      { t: 'sneedapp_app_update', caller: P(alice), method: 'setAppPaymentAccount', app: paid, old_app: on },
      { t: 'sneedapp_app_update', caller: P(admin), method: 'setAppDaoCut', app: { ...paid, dao_cut_bps: 3000n }, old_app: paid },
      { t: 'sneedapp_app_update', caller: P(admin), method: 'setAppDaoCut', app: paid, old_app: { ...paid, dao_cut_bps: 3000n } },
    ]);
    unwrap(await as(alice).setAppPaymentAccount(0n, [])); // back to the publisher account
  });

  it('logs versions and Wasm uploads with the SHA-256 and size, and nothing when an upload is refused', async () => {
    const mark = await logLength();
    await as(alice).addAppVersion('demo', vin(1n, 0n, { wasmUrl: ['https://w/1.0'], releaseNotes: 'first', releaseDate: 5n }));
    await trap(as(alice).addAppVersion('demo', vin(1n, 0n))); // a duplicate
    await trap(as(bob).addAppVersion('demo', vin(9n, 0n)));
    await as(alice).uploadAppVersionWasm('demo', 1n, 0n, 0n, wasmV1);
    await as(alice).addAppVersion('demo', vin(1n, 1n, { wasmHash: 'ab'.repeat(32) }));
    await trap(as(alice).uploadAppVersionWasm('demo', 1n, 1n, 0n, wasmV2)); // not the declared hash
    await trap(as(alice).uploadAppVersionWasm('demo', 1n, 1n, 0n, Uint8Array.from([1, 2, 3, 4]))); // not a wasm
    await as(alice).updateAppVersion('demo', 1n, 1n, 0n, vin(1n, 1n, { sourceUrl: ['https://s/1.1'] }));
    await as(alice).updateAppVersion('demo', 1n, 1n, 0n, vin(1n, 1n, { sourceUrl: ['https://s/1.1'], releaseNotes: 'notes only' })); // no logged field changed
    await as(alice).updateAppVersion('demo', 7n, 7n, 7n, vin(7n, 7n)); // no such version
    await as(alice).uploadAppVersionWasm('demo', 1n, 1n, 0n, wasmV2);
    await as(alice).addAppVersion('demo', vin(2n, 0n));
    await as(alice).clearAppVersionWasm('demo', 2n, 0n, 0n); // nothing to clear
    await as(alice).uploadAppVersionWasm('demo', 2n, 0n, 0n, wasmV1);
    await as(alice).clearAppVersionWasm('demo', 2n, 0n, 0n);
    await as(alice).removeAppVersion('demo', 2n, 0n, 0n);
    await as(alice).removeAppVersion('demo', 2n, 0n, 0n); // gone already
    const blocks = await since(mark);
    const v10 = { major: 1n, minor: 0n, patch: 0n, wasm_size: 0n, release_date: 5n, wasm_url: 'https://w/1.0' };
    const v10w = { ...v10, wasm_hash: sha(wasmV1), wasm_size: BigInt(wasmV1.length) };
    const v11 = { major: 1n, minor: 1n, patch: 0n, wasm_hash: 'ab'.repeat(32), wasm_size: 0n, release_date: 0n };
    const v11b = { major: 1n, minor: 1n, patch: 0n, wasm_size: 0n, release_date: 0n, source_url: 'https://s/1.1' };
    const v11w = { ...v11b, wasm_hash: sha(wasmV2), wasm_size: BigInt(wasmV2.length) };
    const v20 = { major: 2n, minor: 0n, patch: 0n, wasm_size: 0n, release_date: 0n };
    const v20w = { ...v20, wasm_hash: sha(wasmV1), wasm_size: BigInt(wasmV1.length) };
    expect(strip(blocks)).toEqual([
      { t: 'sneedapp_version_add', caller: P(alice), app_id: 'demo', version: v10 },
      { t: 'sneedapp_wasm_upload', caller: P(alice), app_id: 'demo', version: v10w, wasm_sha256: sha(wasmV1) },
      { t: 'sneedapp_version_add', caller: P(alice), app_id: 'demo', version: v11 },
      { t: 'sneedapp_version_update', caller: P(alice), app_id: 'demo', version: v11b, old_version: v11 },
      { t: 'sneedapp_wasm_upload', caller: P(alice), app_id: 'demo', version: v11w, wasm_sha256: sha(wasmV2) },
      { t: 'sneedapp_version_add', caller: P(alice), app_id: 'demo', version: v20 },
      { t: 'sneedapp_wasm_upload', caller: P(alice), app_id: 'demo', version: v20w, wasm_sha256: sha(wasmV1) },
      { t: 'sneedapp_wasm_clear', caller: P(alice), app_id: 'demo', version: v20w, wasm_size: BigInt(wasmV1.length) },
      { t: 'sneedapp_version_remove', caller: P(alice), app_id: 'demo', old_version: { ...v20w, wasm_size: 0n }, had_wasm: 0n },
    ]);
  });

  it('logs a removed app with the versions that went with it; a family removed from a publisher updates its apps', async () => {
    unwrap(await f.addApp(0n, appInput('dao-app', { mintPriceE8s: ICP, premiumMintPriceE8s: ICP / 2n, families: ['sneed-bots'] })));
    await f.addAppVersion('dao-app', vin(1n, 0n));
    await f.uploadAppVersionWasm('dao-app', 1n, 0n, 0n, wasmV1);
    unwrap(await f.setAppEnabled(1n, true));
    const mark = await logLength();
    unwrap(await as(alice).addApp(1n, appInput('gone')));
    await as(alice).addAppVersion('gone', vin(1n, 0n));
    await as(alice).uploadAppVersionWasm('gone', 1n, 0n, 0n, wasmV1);
    expect(errOf(await f.removeApp(9n))).toMatch(/not found/);
    unwrap(await f.removeApp(2n));
    unwrap(await as(alice).removePublisherFamily(1n, 'bots'));
    unwrap(await as(alice).addPublisherFamily(1n, 'bots'));
    unwrap(await as(alice).setAppFamilies(0n, ['bots']));
    unwrap(await as(alice).setAppFamilies(0n, ['bots'])); // unchanged
    const blocks = await since(mark);
    expect(blocks.map((b) => [b.t, b.method])).toEqual([
      ['sneedapp_app_add', undefined], ['sneedapp_version_add', undefined], ['sneedapp_wasm_upload', undefined], ['sneedapp_app_remove', undefined],
      ['sneedapp_publisher_update', 'removePublisherFamily'], ['sneedapp_app_update', 'removePublisherFamily'],
      ['sneedapp_publisher_update', 'addPublisherFamily'], ['sneedapp_app_update', 'setAppFamilies'],
    ]);
    expect(blocks[3]).toMatchObject({
      caller: P(admin), app: { app_id: 'gone', numeric_app_id: 2n, publisher_id: 1n },
      versions: [{ major: 1n, minor: 0n, patch: 0n, wasm_hash: sha(wasmV1), wasm_size: BigInt(wasmV1.length), release_date: 0n }],
    });
    expect(blocks[5]).toMatchObject({ app: { app_id: 'demo', families: [] }, old_app: { app_id: 'demo', families: ['bots'] } });
    expect(blocks[7]).toMatchObject({ app: { families: ['bots'] }, old_app: { families: [] } });
  });

  it('logs official versions added, replaced and removed (one block per entry that changed)', async () => {
    const h1 = '11'.repeat(32), h2 = '22'.repeat(32), h3 = '33'.repeat(32);
    const o1 = official(9n, h1), o1b = official(9n, h1, { wasmUrl: 'https://mirror/9' }), o2 = official(10n, h2), o3 = official(11n, h3);
    const mark = await logLength();
    await f.addOfficialVersion(o1);
    await f.addOfficialVersion(o1); // the same entry
    await f.addOfficialVersion(o1b); // replaces it
    expect(await f.updateOfficialVersion(h1.toUpperCase(), o2)).toBe(true); // a new hash: the old entry goes
    expect(await f.updateOfficialVersion('ff', o3)).toBe(false);
    expect(await f.removeOfficialVersion(h2)).toBe(true);
    expect(await f.removeOfficialVersion(h2)).toBe(false);
    await f.setOfficialVersions([o1, o3]);
    await f.setOfficialVersions([o1, o3]); // unchanged
    expect(strip(await since(mark))).toEqual([
      { t: 'sneedapp_official_version_set', caller: P(admin), method: 'addOfficialVersion', official: officialV(o1) },
      { t: 'sneedapp_official_version_set', caller: P(admin), method: 'addOfficialVersion', official: officialV(o1b), old_official: officialV(o1) },
      { t: 'sneedapp_official_version_remove', caller: P(admin), method: 'updateOfficialVersion', old_official: officialV(o1b) },
      { t: 'sneedapp_official_version_set', caller: P(admin), method: 'updateOfficialVersion', official: officialV(o2) },
      { t: 'sneedapp_official_version_remove', caller: P(admin), method: 'removeOfficialVersion', old_official: officialV(o2) },
      { t: 'sneedapp_official_version_set', caller: P(admin), method: 'setOfficialVersions', official: officialV(o1) },
      { t: 'sneedapp_official_version_set', caller: P(admin), method: 'setOfficialVersions', official: officialV(o3) },
    ]);
  });

  it('logs the legacy manager Wasm set (with its SHA-256) and cleared', async () => {
    const mark = await logLength();
    await f.setManagerWasm(wasmV1);
    await f.clearManagerWasm();
    await f.clearManagerWasm(); // nothing to clear
    await f.setManagerWasm(botWasm);
    expect(strip(await since(mark))).toEqual([
      { t: 'sneedapp_manager_wasm_set', caller: P(admin), wasm_sha256: sha(wasmV1), wasm_size: BigInt(wasmV1.length) },
      { t: 'sneedapp_manager_wasm_clear', caller: P(admin) },
      { t: 'sneedapp_manager_wasm_set', caller: P(admin), wasm_sha256: sha(botWasm), wasm_size: BigInt(botWasm.length) },
    ]);
  });
});

describe('mints', () => {
  const profit = ICP - CYCLES_ICP - 4n * ICP_FEE;
  const daoCut = (profit * 2500n) / 10_000n;
  const share = profit - daoCut;

  it('logs nothing for refused mints', async () => {
    const mark = await logLength();
    expect(errOf(await as(carol).mintCanister('nothing', [], [], []))).toEqual({ AppNotFound: null });
    expect(errOf(await as(carol).mintCanister('demo', [9n], [0n], [0n]))).toEqual({ VersionNotFound: null });
    await deposit(carol, ICP / 2n);
    expect(errOf(await as(carol).mintCanister('demo', [], [], []))).toEqual({ InsufficientPayment: { required: ICP, provided: ICP / 2n } });
    await f.unverifyPublisher(1n);
    expect(errOf(await as(carol).mintCanister('demo', [], [], []))).toEqual({ PublisherNotVerified: null });
    await f.verifyPublisher(1n);
    await deposit(carol, ICP / 2n);
    await fault.set_fail_to([factoryId]); // the first leg (ICP for cycles) fails: nothing has moved
    try {
      expect(errOf(await as(carol).mintCanister('demo', [], [], [])).TransferFailed).toMatch(/Failed to transfer ICP for cycles/);
    } finally { await fault.set_fail_to([]); }
    expect(errOf(await as(alice).createNeuronManager())).toHaveProperty('InsufficientPayment');
    expect((await since(mark)).map((b) => b.t)).toEqual(['sneedapp_publisher_unverify', 'sneedapp_publisher_verify']);
  });

  it('logs a publisher app mint: the installed module, the price and every ledger block of the split', async () => {
    const mark = await logLength();
    const from = await txCount();
    const res = unwrap(await as(carol).mintCanister('demo', [], [], []));
    demoMint = res.canisterId;
    const txs = await newTxs(from);
    expect(txs.map((t) => t.amount)).toEqual([CYCLES_ICP + ICP_FEE, share, daoCut, CYCLES_ICP]);
    expect(strip(await since(mark))).toEqual([{
      t: 'sneedapp_mint', caller: P(carol), canister_id: P(demoMint), app_id: 'demo', numeric_app_id: 0n, publisher_id: 1n,
      ver: { major: 1n, minor: 1n, patch: 0n }, wasm_sha256: sha(wasmV2), wasm_size: BigInt(wasmV2.length), price_e8s: ICP, premium: 0n, price_tier: 'regular',
      cycles_icp_e8s: CYCLES_ICP, cycles_tx: txs[0].index,
      publisher_share_e8s: share, publisher_share_to: A(factoryId, pubSub1), publisher_share_tx: txs[1].index,
      dao_cut_e8s: daoCut, dao_cut_to: A(treasury), dao_cut_tx: txs[2].index,
      fees_e8s: 4n * ICP_FEE, cycles_received: 1n * T,
    }]);
    // the mint log agrees
    expect((await f.lookupMintedCanister(demoMint))[0]).toMatchObject({ icpPaidE8s: ICP, daoCutE8s: daoCut, publisherRevenueE8s: share });
  }, 120_000);

  it('logs the member price for Sneed Premium members, a specific version, and Sneed DAO apps without a publisher share', async () => {
    const now = BigInt(Math.round(await pic.getTime())) * 1_000_000n;
    await premium.set_member(bob, now + 3_600n * SEC);
    await deposit(bob, 80_000_000n);
    await deposit(dave, ICP);
    const mark = await logLength();
    const from = await txCount();
    const bobs = unwrap(await as(bob).mintCanister('demo', [1n], [0n], [0n])).canisterId;
    const daves = unwrap(await as(dave).mintCanister('dao-app', [], [], [])).canisterId;
    const txs = await newTxs(from);
    const [b1, b2] = await since(mark);
    const p1 = 80_000_000n - CYCLES_ICP - 4n * ICP_FEE;
    expect(b1).toMatchObject({
      t: 'sneedapp_mint', caller: P(bob), canister_id: P(bobs), ver: { major: 1n, minor: 0n, patch: 0n }, wasm_sha256: sha(wasmV1),
      price_e8s: 80_000_000n, premium: 1n, price_tier: 'premium', dao_cut_e8s: (p1 * 2500n) / 10_000n, publisher_share_e8s: p1 - (p1 * 2500n) / 10_000n,
      cycles_tx: txs[0].index, publisher_share_tx: txs[1].index, dao_cut_tx: txs[2].index,
    });
    const p2 = ICP - CYCLES_ICP - 3n * ICP_FEE;
    expect(strip([b2])[0]).toEqual({
      t: 'sneedapp_mint', caller: P(dave), canister_id: P(daves), app_id: 'dao-app', numeric_app_id: 1n, publisher_id: 0n,
      ver: { major: 1n, minor: 0n, patch: 0n }, wasm_sha256: sha(wasmV1), wasm_size: BigInt(wasmV1.length), price_e8s: ICP, premium: 0n, price_tier: 'regular',
      cycles_icp_e8s: CYCLES_ICP, cycles_tx: txs[4].index, publisher_share_e8s: 0n,
      dao_cut_e8s: p2, dao_cut_to: A(treasury), dao_cut_tx: txs[5].index, fees_e8s: 3n * ICP_FEE, cycles_received: 1n * T,
    });
  }, 120_000);

  it('logs a mint without payment (turned off by an admin) without payment fields', async () => {
    await f.setPaymentRequired(false);
    const mark = await logLength();
    const id = unwrap(await as(eve).mintCanister('dao-app', [], [], [])).canisterId;
    await f.setPaymentRequired(true);
    const [b] = strip(await since(mark));
    expect(b).toEqual({
      t: 'sneedapp_mint', caller: P(eve), canister_id: P(id), app_id: 'dao-app', numeric_app_id: 1n, publisher_id: 0n,
      ver: { major: 1n, minor: 0n, patch: 0n }, wasm_sha256: sha(wasmV1), wasm_size: BigInt(wasmV1.length), price_e8s: 0n, premium: 0n, price_tier: 'regular',
    });
  }, 120_000);

  it('logs the legacy createNeuronManager mint with the staking bot module and the current version', async () => {
    await deposit(alice, ICP);
    const mark = await logLength();
    const from = await txCount();
    const id = unwrap(await as(alice).createNeuronManager()).canisterId;
    const txs = await newTxs(from);
    const p = ICP - CYCLES_ICP - 3n * ICP_FEE;
    expect(strip(await since(mark))).toEqual([{
      t: 'sneedapp_mint', caller: P(alice), canister_id: P(id), app_id: 'sneed-icp-staking-bot', numeric_app_id: 0n, publisher_id: 0n,
      ver: { major: 0n, minor: 9n, patch: 5n }, wasm_sha256: sha(botWasm), wasm_size: BigInt(botWasm.length), price_e8s: ICP, premium: 0n, price_tier: 'regular',
      cycles_icp_e8s: CYCLES_ICP, cycles_tx: txs[0].index, publisher_share_e8s: 0n, dao_cut_e8s: p, dao_cut_to: A(treasury), dao_cut_tx: txs[1].index,
      fees_e8s: 3n * ICP_FEE, cycles_received: 1n * T, method: 'createNeuronManager',
    }]);
  }, 180_000);
});

describe('refunds of aborted mints', () => {
  it('logs the payment going back when the DAO cut transfer fails (with the deleted canister)', async () => {
    await deposit(carol, ICP);
    const mark = await logLength();
    const from = await txCount();
    await fault.set_fail_to([treasury]);
    try {
      expect(errOf(await as(carol).mintCanister('demo', [], [], [])).TransferFailed).toMatch(/Failed to transfer DAO cut/);
    } finally { await fault.set_fail_to([]); }
    const txs = await newTxs(from);
    const profit = ICP - CYCLES_ICP - 4n * ICP_FEE;
    const share = profit - (profit * 2500n) / 10_000n;
    expect(txs.map((t) => t.amount)).toEqual([CYCLES_ICP + ICP_FEE, share, share - ICP_FEE, CYCLES_ICP]);
    const blocks = strip(await since(mark));
    expect(blocks).toHaveLength(1);
    const { canister_id, ...rest } = blocks[0];
    expect(rest).toEqual({
      t: 'sneedapp_mint_refund', caller: P(carol), app_id: 'demo', ver: { major: 1n, minor: 1n, patch: 0n }, price_e8s: ICP, price_tier: 'regular',
      reason: 'Failed to transfer DAO cut', payment_txs: [txs[0].index, txs[1].index], moved_e8s: CYCLES_ICP + ICP_FEE + share,
      returned_e8s: CYCLES_ICP + share - ICP_FEE, stuck_e8s: 0n, refund_txs: [txs[2].index, txs[3].index],
    });
    expect(canister_id).toMatch(/^[0-9a-f]+$/); // created, then stopped and deleted
    expect(await f.getMintLogCount()).toBe(5n);
    unwrap(await as(carol).withdrawUserPayment());
  }, 120_000);

  it('says in the log what is stuck when the refund fails too, and logs the admin returning it', async () => {
    await deposit(carol, ICP);
    const mark = await logLength();
    const from = await txCount();
    await fault.set_fail_to([treasury]);
    await fault.set_fail_from_main([factoryId]);
    try {
      expect(errOf(await as(carol).mintCanister('demo', [], [], [])).TransferFailed).toMatch(/held inside the factory/);
    } finally {
      await fault.set_fail_to([]);
      await fault.set_fail_from_main([]);
    }
    const txs = await newTxs(from);
    const [r] = await since(mark);
    expect(r).toMatchObject({ t: 'sneedapp_mint_refund', stuck_e8s: CYCLES_ICP + ICP_FEE, refund_txs: [txs[2].index] });
    expect(r.returned_e8s).toBe(txs[2].amount);
    unwrap(await f.adminWithdrawIcp(CYCLES_ICP, depositAccount(carol)));
    const w = (await newTxs(from)).at(-1);
    expect((await since(mark)).slice(1)).toEqual([
      { i: mark + 1, t: 'sneedapp_admin_withdraw', caller: P(admin), amount_e8s: CYCLES_ICP, fee_e8s: ICP_FEE, to: A(factoryId, principalToSubaccount(carol)), icp_tx: w.index },
    ]);
    unwrap(await as(carol).withdrawUserPayment());
  }, 120_000);

  it('logs the refund of a version whose Wasm cannot be installed', async () => {
    await as(alice).addAppVersion('demo', vin(3n, 0n));
    await as(alice).uploadAppVersionWasm('demo', 3n, 0n, 0n, Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 255]));
    await deposit(carol, ICP);
    const mark = await logLength();
    expect(errOf(await as(carol).mintCanister('demo', [3n], [0n], [0n])).CanisterCreationFailed).toMatch(/Installing the wasm failed/);
    const [r] = await since(mark);
    expect(r).toMatchObject({ t: 'sneedapp_mint_refund', caller: P(carol), app_id: 'demo', ver: { major: 3n, minor: 0n, patch: 0n }, stuck_e8s: 0n });
    expect(r.reason).toMatch(/Installing the wasm failed/);
    expect(r.refund_txs).toHaveLength(2);
    expect(r.canister_id).toBeUndefined();
    await as(alice).removeAppVersion('demo', 3n, 0n, 0n);
    unwrap(await as(carol).withdrawUserPayment());
  }, 120_000);

  it('logs the refund of a legacy createNeuronManager whose fee transfer failed', async () => {
    await deposit(alice, ICP);
    const mark = await logLength();
    await fault.set_fail_to([treasury]);
    try {
      expect(errOf(await as(alice).createNeuronManager()).TransferFailed).toMatch(/Failed to transfer creation fee/);
    } finally { await fault.set_fail_to([]); }
    const [r] = await since(mark);
    expect(r).toMatchObject({ t: 'sneedapp_mint_refund', app_id: 'sneed-icp-staking-bot', method: 'createNeuronManager', reason: 'Failed to transfer creation fee', moved_e8s: CYCLES_ICP + ICP_FEE, returned_e8s: CYCLES_ICP, stuck_e8s: 0n });
    expect(r.canister_id).toBeDefined();
    unwrap(await as(alice).withdrawUserPayment());
  }, 180_000);
});

describe('withdrawals and top-ups', () => {
  it('log deposit, publisher and app withdrawals and admin top-ups with their ledger blocks, and nothing when they fail', async () => {
    const mark = await logLength();
    expect(errOf(await as(dave).withdrawUserPayment())).toHaveProperty('InsufficientFunds');
    expect(errOf(await as(bob).withdrawPublisherFunds(1n))).toMatch(/Not authorized/);
    expect(errOf(await as(alice).withdrawAppFunds(1n, 0n))).toMatch(/no payment account/);
    await trap(as(alice).adminWithdrawIcp(1n, account(alice)));
    expect(errOf(await f.adminWithdrawIcp(1000n * ICP, account(admin)))).toHaveProperty('InsufficientFunds');
    expect(await logLength()).toBe(mark);

    await deposit(dave, ICP / 4n);
    const d = unwrap(await as(dave).withdrawUserPayment());
    const pubBal = await f.getPublisherRevenueBalance(1n);
    const pw = unwrap(await as(alice).withdrawPublisherFunds(1n));
    const pwTx = (await icp.get_transactions()).at(-1);
    // an app with its own payment account collects in its own subaccount
    unwrap(await as(alice).setAppPaymentAccount(0n, [account(alice, SUB)]));
    await deposit(carol, ICP);
    unwrap(await as(carol).mintCanister('demo', [], [], []));
    const aw = unwrap(await as(alice).withdrawAppFunds(1n, 0n));
    const awTx = (await icp.get_transactions()).at(-1);
    unwrap(await as(alice).setAppPaymentAccount(0n, []));
    await icp.mint(account(factoryId), ICP);
    unwrap(await f.adminTopUpCycles(ICP / 2n));
    const blocks = (await since(mark)).filter((b) => !['sneedapp_mint', 'sneedapp_app_update'].includes(b.t));
    expect(strip(blocks)).toEqual([
      { t: 'sneedapp_deposit_withdraw', caller: P(dave), amount_e8s: ICP / 4n - ICP_FEE, fee_e8s: ICP_FEE, to: A(dave), icp_tx: d },
      { t: 'sneedapp_publisher_withdraw', caller: P(alice), publisher_id: 1n, amount_e8s: pw, fee_e8s: ICP_FEE, to: A(alice), icp_tx: pwTx.index },
      { t: 'sneedapp_publisher_withdraw', caller: P(alice), publisher_id: 1n, numeric_app_id: 0n, amount_e8s: aw, fee_e8s: ICP_FEE, to: A(alice, SUB), icp_tx: awTx.index },
      { t: 'sneedapp_admin_top_up', caller: P(admin), amount_e8s: ICP / 2n, cycles: 1n * T },
    ]);
    expect(pw).toBe(pubBal - ICP_FEE);
  }, 120_000);
});

describe('wallet', () => {
  it("does not log a user's own bookmarks", async () => {
    const mark = await logLength();
    unwrap(await as(carol).registerCanister(c1, 'demo'));
    unwrap(await as(carol).registerManager(c2));
    unwrap(await as(carol).deregisterCanister(c1));
    unwrap(await as(carol).deregisterManager(c2));
    expect(await logLength()).toBe(mark);
  });

  it('logs transferManager and the privileged writes to other wallets, only when they change something', async () => {
    const mark = await logLength();
    expect(errOf(await as(carol).transferManager(c4, dave))).toMatch(/not in your registered list/);
    expect(errOf(await as(alice).registerCanisterFor(eve, c1, 'demo'))).toMatch(/Not authorized/);
    unwrap(await as(carol).transferManager(demoMint, dave));
    unwrap(await as(sneedex).registerCanisterFor(eve, c1, 'demo'));
    unwrap(await as(sneedex).registerCanisterFor(eve, c1, 'demo')); // already there
    unwrap(await as(sneedex).deregisterCanisterFor(eve, c1));
    unwrap(await as(sneedex).deregisterCanisterFor(eve, c1)); // gone already
    unwrap(await as(sneedex).registerManagerFor(eve, c2));
    unwrap(await as(sneedex).deregisterManagerFor(eve, c2));
    await f.adminRegisterCanister(eve, c3, '');
    expect(await f.adminBulkRegisterCanisters([[eve, c3, ''], [eve, c4, 'demo']])).toBe(2n);
    expect(strip(await since(mark))).toEqual([
      { t: 'sneedapp_wallet_transfer', caller: P(carol), canister_id: P(demoMint), app_id: 'demo', new_owner: P(dave) },
      { t: 'sneedapp_wallet_register', caller: P(sneedex), user: P(eve), canister_id: P(c1), app_id: 'demo' },
      { t: 'sneedapp_wallet_deregister', caller: P(sneedex), user: P(eve), canister_id: P(c1) },
      { t: 'sneedapp_wallet_register', caller: P(sneedex), user: P(eve), canister_id: P(c2) },
      { t: 'sneedapp_wallet_deregister', caller: P(sneedex), user: P(eve), canister_id: P(c2) },
      { t: 'sneedapp_wallet_register', caller: P(admin), user: P(eve), canister_id: P(c3) },
      { t: 'sneedapp_wallet_register', caller: P(admin), user: P(eve), canister_id: P(c4), app_id: 'demo' },
    ]);
    expect((await as(dave).getMyWallet()).map((e) => e.canisterId.toText())).toContain(demoMint.toText());
  });
});

describe('ingress guard', () => {
  it('refuses the log queries as update calls and caps the admin arguments', async () => {
    const u = actorAs(pic, asUpdates(fullIdl), factoryId, alice);
    expect(await refusedAtIngress(u.icrc3_get_blocks([{ start: 0n, length: 1n }]))).toBe(true);
    expect(await refusedAtIngress(u.icrc3_get_archives({ from: [] }))).toBe(true);
    expect(await refusedAtIngress(u.icrc3_get_tip_certificate())).toBe(true);
    expect(await refusedAtIngress(u.icrc3_supported_block_types())).toBe(true);
    expect(await refusedAtIngress(u.icrc10_supported_standards())).toBe(true);
    expect(await refusedAtIngress(u.icrc3_log_status())).toBe(true);
    expect(await refusedAtIngress(u.icrc3_registration_status())).toBe(true);
    expect(await refusedAtIngress(f.admin_set_icrc3_proposal_neuron([new Uint8Array(10_000)]))).toBe(true);
  }, 60_000);
});

describe('the chain', () => {
  it('verifies: certified tip, phash links, only catalogued types, block 0 without phash', async () => {
    const raw = await rawLog();
    expect(raw.length).toBe(await logLength());
    expect(raw[0].Map.some(([k]) => k === 'phash')).toBe(false);
    expect(raw.slice(1).every((b) => b.Map.some(([k]) => k === 'phash'))).toBe(true);
    expect(new Set(raw.map(btype)).size).toBeGreaterThan(20);
  });
});

describe('archives', () => {
  it('spill past the live limit into archives co-controlled by SNS root, and still verify', async () => {
    const before = await logLength();
    unwrap(await f.admin_set_icrc3_settings({ max_live_blocks: [5n], spill_batch_size: [10n], archive_max_blocks: [40n], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }));
    await advance(BigInt(15 * 60 + 5) * SEC, 100); // the 15-minute spill check
    const s = await f.icrc3_log_status();
    expect(Number(s.log_length)).toBe(before + 3); // three settings changed
    expect(s.live_blocks).toBeLessThan(5n);
    expect(s.archives.length).toBeGreaterThanOrEqual(2);
    const archives = await as(bob).icrc3_get_archives({ from: [] });
    expect(archives.map((a) => a.canister_id.toText())).toEqual(s.archives.map((a) => a.canister_id.toText()));
    for (const a of archives) {
      expect((await pic.getControllers(a.canister_id)).map((p) => p.toText()).sort()).toEqual([factoryId.toText(), SNEED_SNS_ROOT.toText()].sort());
      expect((await archiveActor(a.canister_id).archive_status()).parent.toText()).toBe(factoryId.toText());
    }
    const blocks = await verifiedLog(); // follows the callbacks into every archive
    expect(blocks).toHaveLength(Number(s.log_length));
    expect(blocks.slice(-3).map((b) => [b.t, b.key])).toEqual([
      ['sneedapp_config_update', 'icrc3_max_live_blocks'], ['sneedapp_config_update', 'icrc3_spill_batch_size'], ['sneedapp_config_update', 'icrc3_archive_max_blocks'],
    ]);
    unwrap(await f.admin_icrc3_spill_now());
    expect((await f.icrc3_log_status()).live_blocks).toBe(0n);
    expect(await verifiedLog()).toHaveLength(Number(s.log_length));
  }, 180_000);

  it('registers its archives with the SNS through a hotkeyed neuron, and skips the step without one', async () => {
    const NEURON = new Uint8Array(32).fill(9);
    const archives = await as(bob).icrc3_get_archives({ from: [] });
    let s = await as(bob).icrc3_registration_status();
    expect(s.governance.toText()).toBe(govId.toText()); // the configured governance
    expect(s.neuron).toEqual([]);
    expect(unwrap(await f.admin_icrc3_register_archives_now())).toBe(0n);
    expect(errOf(await f.admin_set_icrc3_proposal_neuron([new Uint8Array(5)]))).toMatch(/32-byte/);
    await gov.add_hotkey(NEURON, factoryId);
    unwrap(await f.admin_set_icrc3_proposal_neuron([NEURON]));
    unwrap(await f.admin_set_icrc3_proposal_neuron([NEURON])); // unchanged: no block
    const tail = (await verifiedLog()).slice(-2);
    expect(tail[1]).toMatchObject({ t: 'sneedapp_config_update', caller: P(admin), key: 'icrc3_proposal_neuron', value: hex(NEURON), old_value: 'none' });
    expect(tail[0].key).not.toBe('icrc3_proposal_neuron');
    expect(unwrap(await f.admin_icrc3_register_archives_now())).toBe(BigInt(archives.length));
    const proposals = await gov.list_proposals();
    expect(proposals.map((p) => p.canister_ids[0].toText())).toEqual(archives.map((a) => a.canister_id.toText()));
    for (const p of proposals) {
      expect(p.proposer.toText()).toBe(factoryId.toText());
      expect(p.title).toMatch(/^Register ICRC-3 archive .* of Sneedapp$/);
      expect(p.url).toBe('https://app.sneeddao.com/api/sneedapp#activity-log-icrc-3');
    }
    s = await as(bob).icrc3_registration_status();
    expect(s.registrations.map((x) => x.proposal_id[0])).toEqual(proposals.map((p) => p.id));
    expect(unwrap(await f.admin_icrc3_register_archives_now())).toBe(0n);
    expect(unwrap(await f.admin_icrc3_reset_archive_registration(archives[0].canister_id))).toBe(true);
    expect((await f.admin_icrc3_repair_archive_controllers()).every(([, r]) => 'Ok' in r)).toBe(true);
    // without a configured governance, Sneed's own
    await f.setSneedGovernance([]);
    expect((await as(bob).icrc3_registration_status()).governance.toText()).toBe('fi3zi-fyaaa-aaaaq-aachq-cai');
    await f.setSneedGovernance([govId]);
    unwrap(await f.admin_set_icrc3_settings({ max_live_blocks: [2000n], spill_batch_size: [500n], archive_max_blocks: [1_000_000n], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }));
  }, 120_000);
});

describe('upgrades', () => {
  it('keep the log, the archives and the certified tip', async () => {
    const before = await f.icrc3_log_status();
    const blocksBefore = await verifiedLog();
    await pic.upgradeCanister({ sender: admin, canisterId: factoryId, wasm: wasm(SNEEDAPP_WASM), arg: IDL.encode([], []) });
    await pic.tick(2);
    expect(await f.icrc3_log_status()).toEqual(before);
    expect(await verifiedLog()).toEqual(blocksBefore); // the tip certificate is republished
    await f.addAdmin(carol);
    const blocks = await verifiedLog();
    expect(blocks).toHaveLength(blocksBefore.length + 1);
    expect(blocks.at(-1)).toMatchObject({ t: 'sneedapp_config_update', key: 'admin_added', value: P(carol) });
    await f.removeAdmin(carol);
  }, 120_000);

  it('from the production build keep apps, versions, Wasms, wallets, the mint log and config, and start an empty log', async () => {
    const oldId = await install(pic, { name: 'sneedapp_prod', cycles: 50n * T, targetSubnetId: appSubnet });
    const old = as(admin, oldId);
    await expect(old.icrc3_log_status()).rejects.toThrow(); // the production code has no log
    await old.setFeeDestination(account(treasury));
    await old.setManagerWasm(botWasm);
    await old.setCurrentVersion(ver(0n, 9n, 5n));
    await old.addOfficialVersion(official(9n, '44'.repeat(32)));
    await old.addAuthorizedForCaller(sneedex);
    unwrap(await old.addApp(0n, appInput('sneed-icp-staking-bot', { families: ['sneed-bots'] })));
    await old.addAppVersion('sneed-icp-staking-bot', vin(0n, 9n, { releaseNotes: 'bot' }));
    await old.uploadAppVersionWasm('sneed-icp-staking-bot', 0n, 9n, 0n, wasmV1);
    unwrap(await old.setAppEnabled(0n, true));
    unwrap(await as(alice, oldId).createPublisher(pubInput('Alice Labs')));
    await deposit(carol, ICP, oldId);
    const minted = unwrap(await as(carol, oldId).mintCanister('sneed-icp-staking-bot', [], [], [])).canisterId;
    unwrap(await as(carol, oldId).registerCanister(c1, 'icrc-ledger'));
    unwrap(await as(sneedex, oldId).registerCanisterFor(eve, c2, ''));
    await deposit(bob, ICP / 4n, oldId); // a deposit waiting
    const snapshot = async () => ({
      apps: await old.getApps(),
      versions: await old.getAppVersions('sneed-icp-staking-bot'),
      publishers: (await old.getPublishers()).sort((a, b) => Number(a.publisherId - b.publisherId)),
      mintLog: await old.getMintLog({ startIndex: [], limit: [], appIdFilter: [], minterFilter: [], fromTime: [], toTime: [] }),
      wallets: (await old.getAllWallets()).map(([u, e]) => [u.toText(), e]).sort(),
      official: await old.getOfficialVersions(),
      payment: await old.getPaymentConfig(),
      version: await old.getCurrentVersion(),
      managerWasm: await old.getManagerWasmSize(),
      authorized: await old.getAuthorizedForCallers(),
      aggregates: await old.getFactoryAggregates(),
      dao: await old.getDaoRevenueStats(),
      deposit: await old.getUserPaymentBalance(bob),
    });
    const before = await snapshot();
    expect(before.mintLog.entries).toHaveLength(1);

    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(SNEEDAPP_WASM), arg: IDL.encode([], []) });
    await pic.tick(2);
    expect(await snapshot()).toEqual(before);
    expect(await as(alice, oldId).icrc3_log_status()).toMatchObject({ log_length: 0n, live_blocks: 0n, archives: [], last_block_hash: [], history_imported: false });
    expect(await as(alice, oldId).icrc3_get_tip_certificate()).toEqual([]);
    expect(await old.hasAppVersionWasm('sneed-icp-staking-bot', 0n, 9n, 0n)).toBe(true);

    // the first changes after the upgrade start the chain at block 0, and the log verifies
    unwrap(await as(carol, oldId).transferManager(minted, dave));
    await deposit(carol, ICP, oldId);
    const m2 = unwrap(await as(carol, oldId).mintCanister('sneed-icp-staking-bot', [], [], [])).canisterId;
    const w = unwrap(await as(bob, oldId).withdrawUserPayment());
    const blocks = await verifiedLog(oldId);
    expect(blocks.map((b) => b.t)).toEqual(['sneedapp_wallet_transfer', 'sneedapp_mint', 'sneedapp_deposit_withdraw']);
    expect(blocks[1]).toMatchObject({ i: 1, caller: P(carol), canister_id: P(m2), wasm_sha256: sha(wasmV1), dao_cut_to: A(treasury) });
    expect(blocks[2]).toMatchObject({ caller: P(bob), icp_tx: w });
    expect((await rawLog(oldId))[0].Map.some(([k]) => k === 'phash')).toBe(false);
  }, 180_000);
});
