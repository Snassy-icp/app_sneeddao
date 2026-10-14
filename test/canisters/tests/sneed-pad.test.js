// sneed_pad: launching tokens from the ledger suite with one ICRC-2 payment.
// The ledger and index wasms are the real, NNS-approved ones (fetched by
// build.sh from the SNS wasm canister); the ICP ledger, the CMC, the SNS wasm
// canister and SNS governance are mocks.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import {
  createPic, install, actorAs, account, admin, alice, bob, carol, ICP_LEDGER_ID, SNEED_GOVERNANCE, SNEED_SNS_ROOT, T, unwrap, errOf, BUILD,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit, cmcIdl, snsWasmIdl, premiumIdl, sneedAppIdl, padIdl, mintedLedgerIdl, mintedIndexIdl, governanceIdl } from '../lib/idl.js';
import { fetchBlocks, btype, txField, archiveIdl } from '../lib/icrc3.js';

const ICP_FEE = 10_000n;
const ledgerGz = resolve(BUILD, 'ledger.wasm.gz');
const indexGz = resolve(BUILD, 'index.wasm.gz');
const haveWasms = existsSync(ledgerGz) && existsSync(indexGz);
const sha256 = (bytes) => Uint8Array.from(createHash('sha256').update(bytes).digest());

let pic, icpId, cmcId, snsWasmId, govId, premiumId, sneedAppId, padId;
let icp, cmc, snsWasm, gov, premium, sneedApp, pad, padAlice, padBob;
const hex = (b) => Buffer.from(b).toString('hex');
let ledgerHash, indexHash;
const NEURON = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

const config = (over = {}) => ({
  name: 'Test Token', symbol: 'TST', decimals: 8, transfer_fee: 10_000n, logo: ['data:image/png;base64,iVBORw0KGgo='],
  allocations: [{ account: account(alice), amount: 1_000_000_000_000n }, { account: account(bob), amount: 500_000_000_000n }],
  minting: { nobody: null }, fee_collector: [], control: { keep: null }, with_index: false,
  ...over,
});

describe.skipIf(!haveWasms)('sneed_pad', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
    cmcId = await install(pic, { name: 'MockCmc' });
    snsWasmId = await install(pic, { name: 'MockSnsWasm' });
    govId = await install(pic, { name: 'MockSnsGovernance', targetCanisterId: SNEED_GOVERNANCE });
    premiumId = await install(pic, { name: 'MockPremium' });
    sneedAppId = await install(pic, { name: 'MockSneedApp' });
    padId = await install(pic, { name: 'sneed_pad', cycles: 200n * T });
    icp = actorAs(pic, ledgerIdl, icpId, admin);
    cmc = actorAs(pic, cmcIdl, cmcId, admin);
    snsWasm = actorAs(pic, snsWasmIdl, snsWasmId, admin);
    gov = actorAs(pic, governanceIdl, govId, admin);
    premium = actorAs(pic, premiumIdl, premiumId, admin);
    sneedApp = actorAs(pic, sneedAppIdl, sneedAppId, admin);
    pad = actorAs(pic, padIdl, padId, admin);
    padAlice = actorAs(pic, padIdl, padId, alice);
    padBob = actorAs(pic, padIdl, padId, bob);
    const ledgerBytes = readFileSync(ledgerGz); const indexBytes = readFileSync(indexGz);
    ledgerHash = sha256(ledgerBytes); indexHash = sha256(indexBytes);
    await snsWasm.set_wasm(ledgerHash, Uint8Array.from(ledgerBytes));
    await snsWasm.set_wasm(indexHash, Uint8Array.from(indexBytes));
    await snsWasm.set_latest([['Root', '00'], ['Ledger', hex(ledgerHash)], ['Ledger Index', hex(indexHash)]]);
    unwrap(await pad.admin_set_canisters({ icp_ledger: [icpId], cmc: [cmcId], sns_wasm: [snsWasmId], governance: [govId], root: [SNEED_SNS_ROOT], blackhole: [carol], sneed_premium: [[premiumId]], sneedapp: [[sneedAppId]] }));
    await sneedApp.set_authorized([padId]);
    unwrap(await pad.admin_set_config({ guardians: [], creation_fee_e8s: [500_000_000n], premium_creation_fee_e8s: [250_000_000n], sneed_dao_control_fee_e8s: [100_000_000n], ledger_cycles: [3n * T], index_cycles: [2n * T], fee_destination: [account(bob)], cycle_reserve: [2n * T], paused: [], follow_nns: [] }));
    await icp.mint(account(alice), 100n * 100_000_000n);
  }, 120_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('takes the ledger suite from the latest NNS version on its own, nobody has to set anything', async () => {
    // the install-time timer already tried (before the mocks were wired, so it failed and said so)
    expect(errOf(await padAlice.create_token(config()))).toMatch(/no ledger wasm/);
    const fetched = unwrap(await padAlice.refresh_wasms()); // anyone may ask
    expect(fetched.changed).toBe(true);
    expect(Number(fetched.ledger_bytes)).toBeGreaterThan(100_000);
    expect(Number(fetched.index_bytes)).toBeGreaterThan(100_000);
    const cfg = await pad.get_config();
    expect(cfg.follow_nns).toBe(true);
    expect(Array.from(cfg.ledger_wasm_hash[0])).toEqual(Array.from(ledgerHash));
    expect(Array.from(cfg.index_wasm_hash[0])).toEqual(Array.from(indexHash));
    expect(cfg.wasm_last_error).toEqual([]);
    expect(cfg.wasm_last_refresh > 0n).toBe(true);
    expect(errOf(await padAlice.refresh_wasms())).toMatch(/recently/); // rate limited for non-admins
    expect(unwrap(await pad.refresh_wasms()).changed).toBe(false); // admins may; nothing new
  });

  it('keeps the working version until a newer one is fetched and verified', async () => {
    const bogus = Uint8Array.from({ length: 32 }, () => 7);
    await snsWasm.set_wasm(bogus, Uint8Array.from([0, 97, 115, 109]));
    await snsWasm.set_latest([['Ledger', hex(ledgerHash)], ['Ledger Index', hex(bogus)]]);
    expect(errOf(await pad.refresh_wasms())).toMatch(/hash/);
    let cfg = await pad.get_config();
    expect(Array.from(cfg.index_wasm_hash[0])).toEqual(Array.from(indexHash)); // untouched
    expect(cfg.wasm_last_error[0]).toMatch(/hash/);
    // a version the NNS serves properly is adopted by the daily timer
    await snsWasm.set_latest([['Ledger', hex(ledgerHash)], ['Ledger Index', hex(ledgerHash)]]); // "new index" = the ledger bytes, which the mock serves
    await pic.advanceTime(86_400 * 1000 + 1000); await pic.tick(10);
    cfg = await pad.get_config();
    expect(Array.from(cfg.index_wasm_hash[0])).toEqual(Array.from(ledgerHash));
    expect(cfg.wasm_last_error).toEqual([]);
    const log = await pad.get_text_log(5n);
    expect(log.some((l) => /wasms refreshed/.test(l))).toBe(true);
    // back to the real index for the launches below
    await snsWasm.set_latest([['Ledger', hex(ledgerHash)], ['Ledger Index', hex(indexHash)]]);
    unwrap(await pad.refresh_wasms());
  });

  it('lets the DAO pin hashes instead of following the NNS', async () => {
    expect(errOf(await pad.admin_set_wasm_hashes([new Uint8Array(5)], []))).toMatch(/32 bytes/);
    expect(errOf(await padAlice.admin_set_wasm_hashes([ledgerHash], []))).toMatch(/admin/);
    unwrap(await pad.admin_set_wasm_hashes([ledgerHash], [indexHash]));
    let cfg = await pad.get_config();
    expect(cfg.follow_nns).toBe(false);
    unwrap(await pad.admin_fetch_wasms());
    cfg = await pad.get_config();
    expect(Number(cfg.ledger_wasm_bytes)).toBeGreaterThan(100_000);
    unwrap(await pad.admin_set_config({ guardians: [], creation_fee_e8s: [], premium_creation_fee_e8s: [], sneed_dao_control_fee_e8s: [], ledger_cycles: [], index_cycles: [], fee_destination: [], cycle_reserve: [], paused: [], follow_nns: [true] }));
    expect((await pad.get_config()).follow_nns).toBe(true);
  });

  it('validates the configuration and quotes the price', async () => {
    expect(errOf(await padAlice.get_quote(config({ symbol: '' })))).toMatch(/symbol/);
    expect(errOf(await padAlice.get_quote(config({ decimals: 19 })))).toMatch(/decimals/);
    expect(errOf(await padAlice.get_quote(config({ allocations: [] })))).toMatch(/allocation/);
    expect(errOf(await padAlice.get_quote(config({ logo: ['https://x/y.png'] })))).toMatch(/data:image/);
    const q = unwrap(await padAlice.get_quote(config()));
    // 3 T cycles at 3.5 XDR/ICP with 5% headroom: 0.9 ICP
    expect(q.icp_for_cycles_e8s).toBe(90_000_000n);
    expect(q.creation_fee_e8s).toBe(500_000_000n);
    expect(q.total_e8s).toBe(500_000_000n + 90_000_000n + 3n * ICP_FEE);
    const qi = unwrap(await padAlice.get_quote(config({ with_index: true })));
    expect(qi.icp_for_cycles_e8s).toBe(150_000_000n);
    expect(q.premium).toBe(false);
    expect(q.control_fee_e8s).toBe(0n);
  });

  it('charges Sneed Premium members the member rate, until the membership runs out', async () => {
    const now = BigInt(Math.round(await pic.getTime())) * 1_000_000n;
    await premium.set_member(bob, now + 3_600n * 1_000_000_000n);
    const q = unwrap(await padBob.get_quote(config()));
    expect(q.premium).toBe(true);
    expect(q.creation_fee_e8s).toBe(250_000_000n);
    expect(q.total_e8s).toBe(250_000_000n + 90_000_000n + 3n * ICP_FEE);
    await pic.advanceTime(2 * 3_600 * 1000); await pic.tick(2);
    const later = unwrap(await padBob.get_quote(config()));
    expect(later.premium).toBe(false);
    expect(later.creation_fee_e8s).toBe(500_000_000n);
  });

  it('does nothing without an ICRC-2 allowance', async () => {
    expect(errOf(await padAlice.create_token(config()))).toMatch(/approve/);
    expect((await pad.list_launches(0n, 10n)).total).toBe(0n);
  });

  it('launches a token the creator keeps control of, paying once', async () => {
    const q = unwrap(await padAlice.get_quote(config()));
    const icpAlice = actorAs(pic, ledgerIdl, icpId, alice);
    unwrap(await icpAlice.icrc2_approve({ from_subaccount: [], spender: account(padId), amount: q.total_e8s + ICP_FEE, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
    const before = await icp.icrc1_balance_of(account(alice));
    const launch = unwrap(await padAlice.create_token(config()));
    expect(launch.status).toEqual({ created: null });
    expect(launch.ledger.length).toBe(1);
    expect(launch.index.length).toBe(0);
    expect(launch.controllers.map((p) => p.toText())).toEqual([alice.toText()]);
    expect(launch.steps.map(([s]) => s)).toEqual(['paid', 'cycles', 'fee', 'ledger_created', 'ledger_installed', 'controllers_set', 'wallet_registered']);
    // the creator's SneedApp wallet lists the ledger, as a SneedApp mint would
    expect((await sneedApp.get_entries()).map(([u, c, a]) => [u.toText(), c.toText(), a])).toContainEqual([alice.toText(), launch.ledger[0].toText(), 'icrc-ledger']);
    // the ledger is real and configured as asked
    const ledgerId = launch.ledger[0];
    const l = actorAs(pic, mintedLedgerIdl, ledgerId, alice);
    expect(await l.icrc1_name()).toBe('Test Token');
    expect(await l.icrc1_symbol()).toBe('TST');
    expect(await l.icrc1_decimals()).toBe(8);
    expect(await l.icrc1_fee()).toBe(10_000n);
    expect(await l.icrc1_total_supply()).toBe(1_500_000_000_000n);
    expect(await l.icrc1_balance_of(account(alice))).toBe(1_000_000_000_000n);
    expect(await l.icrc1_balance_of(account(bob))).toBe(500_000_000_000n);
    expect((await l.icrc1_minting_account())[0].owner.toText()).toBe(ledgerId.toText()); // nobody can mint
    expect((await l.icrc1_metadata()).find(([k]) => k === 'icrc1:logo')[1]).toEqual({ Text: 'data:image/png;base64,iVBORw0KGgo=' });
    expect((await l.icrc1_supported_standards()).map((s) => s.name)).toContain('ICRC-3');
    const controllers = (await pic.canisterStatus({ canisterId: ledgerId, sender: alice })).settings.controllers;
    expect(controllers.map((p) => p.toText())).toEqual([alice.toText()]);
    // the money: creator paid the total plus the approval fee, the fee reached its destination, the CMC was notified
    const after = await icp.icrc1_balance_of(account(alice));
    expect(before - after).toBe(q.total_e8s + ICP_FEE);
    expect(await icp.icrc1_balance_of(account(bob))).toBe(500_000_000n - ICP_FEE);
    expect(await icp.icrc1_balance_of(account(padId))).toBe(2n * ICP_FEE);
    const notes = await cmc.get_notifications();
    expect(notes.length).toBe(1);
    expect(notes[0][1].toText()).toBe(padId.toText());
    // bookkeeping
    expect((await pad.get_launch_by_ledger(ledgerId))[0].id).toBe(launch.id);
    expect((await pad.get_launches_by_creator(alice)).length).toBe(1);
    // the activity log
    const st = await pad.icrc3_log_status();
    const blocks = [...(await fetchBlocks(pad, (id) => actorAs(pic, archiveIdl, id, admin), 0n, st.log_length - 1n)).values()];
    const create = blocks.find((b) => btype(b) === 'sneedpad_token_create');
    expect(create).toBeTruthy();
    expect(txField(create, 'symbol')).toEqual({ Text: 'TST' });
    expect(txField(create, 'supply')).toEqual({ Nat: 1_500_000_000_000n });
    expect(blocks.some((b) => btype(b) === 'sneedpad_control_set')).toBe(true);
  }, 120_000);

  it('launches a token with an index, blackholed', async () => {
    const q = unwrap(await padAlice.get_quote(config({ with_index: true, control: { blackhole: null }, symbol: 'BLK' })));
    const icpAlice = actorAs(pic, ledgerIdl, icpId, alice);
    unwrap(await icpAlice.icrc2_approve({ from_subaccount: [], spender: account(padId), amount: q.total_e8s + ICP_FEE, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
    const launch = unwrap(await padAlice.create_token(config({ with_index: true, control: { blackhole: null }, symbol: 'BLK' })));
    expect(launch.index.length).toBe(1);
    expect(launch.controllers.map((p) => p.toText())).toEqual([carol.toText()]); // the configured "blackhole"
    const idx = actorAs(pic, mintedIndexIdl, launch.index[0], alice);
    expect((await idx.ledger_id()).toText()).toBe(launch.ledger[0].toText());
    // the ledger announces its index (ICRC-106), which is how the studio and wallets find it
    const led = actorAs(pic, mintedLedgerIdl, launch.ledger[0], alice);
    expect(unwrap(await led.icrc106_get_index_principal()).toText()).toBe(launch.index[0].toText());
    expect(launch.steps.map(([s]) => s)).toContain('index_created');
    expect((await pic.canisterStatus({ canisterId: launch.ledger[0], sender: carol })).settings.controllers.map((p) => p.toText())).toEqual([carol.toText()]);
    expect((await pic.canisterStatus({ canisterId: launch.index[0], sender: carol })).settings.controllers.map((p) => p.toText())).toEqual([carol.toText()]);
    // the index syncs the genesis blocks once its timer runs
    for (let i = 0; i < 20; i++) { await pic.advanceTime(10_000); await pic.tick(2); }
    const st = await idx.status();
    expect(Number(st.num_blocks_synced)).toBeGreaterThanOrEqual(2);
  }, 180_000);

  it('hands a token to Sneed DAO: root becomes the controller, the creator files the proposal, the pad files nothing', async () => {
    const q = unwrap(await padAlice.get_quote(config({ control: { sneed_dao: null }, minting: { sneed_dao: null }, symbol: 'DAO' })));
    expect(q.control_fee_e8s).toBe(100_000_000n);
    expect(q.total_e8s).toBe(500_000_000n + 100_000_000n + 90_000_000n + 3n * ICP_FEE);
    const icpAlice = actorAs(pic, ledgerIdl, icpId, alice);
    unwrap(await icpAlice.icrc2_approve({ from_subaccount: [], spender: account(padId), amount: q.total_e8s + ICP_FEE, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
    const feeBefore = await icp.icrc1_balance_of(account(bob));
    const launch = unwrap(await padAlice.create_token(config({ control: { sneed_dao: null }, minting: { sneed_dao: null }, symbol: 'DAO' })));
    expect(launch.controllers.map((p) => p.toText())).toEqual([SNEED_SNS_ROOT.toText()]);
    expect(launch.registration_proposal.length).toBe(0);
    expect((await icp.icrc1_balance_of(account(bob))) - feeBefore).toBe(600_000_000n - ICP_FEE); // launch fee plus handover fee, one transfer
    const l = actorAs(pic, mintedLedgerIdl, launch.ledger[0], alice);
    expect((await l.icrc1_minting_account())[0].owner.toText()).toBe(govId.toText());
    const proposals = await gov.list_proposals();
    expect(proposals.some((p) => p.canister_ids.some((c) => c.toText() === launch.ledger[0].toText()))).toBe(false);
  }, 120_000);

  it('hands a token to any deployed SNS, and keeps extra controllers next to the creator', async () => {
    unwrap(await padAlice.get_quote(config({ control: { sns: carol } }))); // quotes do not ask the NNS
    const icpAlice = actorAs(pic, ledgerIdl, icpId, alice);
    await icp.mint(account(alice), 50n * 100_000_000n);
    unwrap(await icpAlice.icrc2_approve({ from_subaccount: [], spender: account(padId), amount: 20n * 100_000_000n, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
    expect(errOf(await padAlice.create_token(config({ control: { sns: carol }, symbol: 'NOPE' })))).toMatch(/not the root canister of a deployed SNS/);
    await snsWasm.set_deployed([carol]);
    const q = unwrap(await padAlice.get_quote(config({ control: { sns: carol } })));
    expect(q.control_fee_e8s).toBe(0n); // only Sneed DAO charges a handover fee
    const handed = unwrap(await padAlice.create_token(config({ control: { sns: carol }, symbol: 'OTH' })));
    expect(handed.controllers.map((p) => p.toText())).toEqual([carol.toText()]);
    const kept = unwrap(await padAlice.create_token(config({ control: { keep_with: [bob, alice] }, symbol: 'MULTI' })));
    expect(kept.controllers.map((p) => p.toText())).toEqual([alice.toText(), bob.toText()]);
    expect(errOf(await padAlice.get_quote(config({ control: { keep_with: Array(11).fill(bob) } })))).toMatch(/at most 10/);
  }, 180_000);

  it('still launches when the CMC refuses the top-up, and says so in its log', async () => {
    await cmc.set_mode({ refund: null });
    const q = unwrap(await padAlice.get_quote(config({ symbol: 'CMC' })));
    const icpAlice = actorAs(pic, ledgerIdl, icpId, alice);
    unwrap(await icpAlice.icrc2_approve({ from_subaccount: [], spender: account(padId), amount: q.total_e8s + ICP_FEE, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
    const launch = unwrap(await padAlice.create_token(config({ symbol: 'CMC' })));
    expect(launch.status).toEqual({ created: null });
    expect(launch.steps.map(([s]) => s)).not.toContain('cycles');
    const log = await pad.get_text_log(20n);
    expect(log.some((line) => /CMC notify failed/.test(line))).toBe(true);
    await cmc.set_mode({ ok: null });
  }, 120_000);

  it('refuses while paused and for anonymous callers', async () => {
    unwrap(await pad.admin_set_config({ guardians: [], creation_fee_e8s: [], ledger_cycles: [], index_cycles: [], fee_destination: [], cycle_reserve: [], paused: [true], premium_creation_fee_e8s: [], sneed_dao_control_fee_e8s: [], follow_nns: [] }));
    expect(errOf(await padAlice.create_token(config()))).toMatch(/paused/);
    unwrap(await pad.admin_set_config({ guardians: [], creation_fee_e8s: [], ledger_cycles: [], index_cycles: [], fee_destination: [], cycle_reserve: [], paused: [false], premium_creation_fee_e8s: [], sneed_dao_control_fee_e8s: [], follow_nns: [] }));
    expect(errOf(await pad.admin_set_config({ guardians: [], creation_fee_e8s: [], premium_creation_fee_e8s: [], sneed_dao_control_fee_e8s: [], ledger_cycles: [800_000_000_000n], index_cycles: [], fee_destination: [], cycle_reserve: [], paused: [], follow_nns: [] }))).toMatch(/at least 1 T/);
    expect(errOf(await padBob.admin_set_canister_controllers(padId, [bob]))).toMatch(/admin/);
    expect(errOf(await pad.admin_set_canister_controllers(icpId, [bob]))).toMatch(/update_settings failed/); // not the pad's canister
    expect(errOf(await padBob.admin_set_config({ guardians: [], creation_fee_e8s: [1n], premium_creation_fee_e8s: [], sneed_dao_control_fee_e8s: [], ledger_cycles: [], index_cycles: [], fee_destination: [], cycle_reserve: [], paused: [], follow_nns: [] }))).toMatch(/admin only/);
  });

  it('hands a launch to a custody canister and registers it there', async () => {
    const { idlFactory: guardianIdl, init: guardianInit } = await import('../build/sneed_guardian.did.js');
    const guardianId = await install(pic, { name: 'sneed_guardian', initTypes: guardianInit({ IDL }), initArgs: [{ name: 'guardian', approvers: [alice], threshold: 1n, archive_controllers: [], admins: [], sneed_premium: [], fee_destination: [], icp_ledger: [icpId], sns_wasm: [snsWasmId] }], cycles: 50n * T });
    const guardian = actorAs(pic, guardianIdl, guardianId, admin);
    // the custody canister takes only blessed code: tell the SNS wasm mock the path
    await snsWasm.set_steps([{ ledger: ledgerHash, index: indexHash, archive: ledgerHash }]);
    unwrap(await guardian.refresh_blessed());
    // not an allowed custody canister until the DAO lists it
    const policy = { guardians: [bob], vetoes_to_block: 1n, oks_required: 0n, window_ns: 3_600_000_000_000n, auto_upgrade: true };
    expect(errOf(await padAlice.get_quote(config({ control: { guardian: { canister: guardianId, policy } } })))).toMatch(/custody/);
    unwrap(await pad.admin_set_config({ guardians: [[guardianId]], creation_fee_e8s: [], premium_creation_fee_e8s: [], sneed_dao_control_fee_e8s: [], ledger_cycles: [], index_cycles: [], fee_destination: [], cycle_reserve: [], paused: [], follow_nns: [] }));
    const q = unwrap(await padAlice.get_quote(config({ control: { guardian: { canister: guardianId, policy } }, with_index: true, symbol: 'GRD' })));
    expect(q.control_fee_e8s).toBe(100_000_000n); // the DAO-control fee applies
    const icpAlice = actorAs(pic, ledgerIdl, icpId, alice);
    unwrap(await icpAlice.icrc2_approve({ from_subaccount: [], spender: account(padId), amount: q.total_e8s + ICP_FEE, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
    const launch = unwrap(await padAlice.create_token(config({ control: { guardian: { canister: guardianId, policy } }, with_index: true, symbol: 'GRD' })));
    expect(launch.status).toEqual({ created: null });
    expect(launch.steps.map(([s]) => s)).toContain('guardian_registered');
    expect(launch.controllers.map((p) => p.toText())).toEqual([guardianId.toText()]);
    const ledger = (await guardian.get_child(launch.ledger[0]))[0];
    expect(ledger.title).toBe('Test Token (GRD) ledger');
    expect(ledger.policy.auto_upgrade).toBe(true);
    expect(ledger.policy.guardians.map((p) => p.toText())).toEqual([bob.toText()]);
    const index = (await guardian.get_child(launch.index[0]))[0];
    expect(Object.keys(index.kind)[0]).toBe('index');
    expect(index.suite[0].toText()).toBe(launch.ledger[0].toText());
    expect((await pic.getControllers(launch.ledger[0])).map((p) => p.toText())).toEqual([guardianId.toText()]);
    expect((await guardian.get_cycles_report([])).some((r) => r.canister_id.toText() === launch.ledger[0].toText() && r.cycles > 0n)).toBe(true);
  }, 180_000);

  it('keeps every launch across an upgrade', async () => {
    const before = await pad.list_launches(0n, 100n);
    expect(Number(before.total)).toBeGreaterThanOrEqual(4);
    await pic.upgradeCanister({ sender: admin, canisterId: padId, wasm: readFileSync(resolve(BUILD, 'sneed_pad.wasm')) });
    const after = await pad.list_launches(0n, 100n);
    expect(after.total).toBe(before.total);
    expect(after.launches.map((l) => l.id)).toEqual(before.launches.map((l) => l.id));
    const cfg = await pad.get_config();
    expect(Number(cfg.ledger_wasm_bytes)).toBeGreaterThan(100_000);
  }, 120_000);
});
