// app_sneeddao_backend (the Sneed Hub backend): admin and token side. Admins
// and their guards (deployer, controllers, added admins), the token whitelist
// with the import from ICPSwap's token list (a mock at the hard-coded id), the
// daily maintenance timer and the batched metadata refresh, the token meta
// cache, partners and projects, the jailbreak configs with their ICP fees (a
// mock ledger at the ICP ledger id), admin token and position transfers,
// canister info, and an upgrade.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import {
  createPic, install, actorAs, account, admin, alice, bob, carol, user, ICP_LEDGER_ID, T, unwrap, errOf, wasm, nowNs, principalToSubaccount,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit, poolIdl, poolInit, premiumIdl } from '../lib/idl.js';
import { ICPSWAP_LIST_ID, icpSwapListIdl, ser, sorted, upgradeHub } from '../lib/hub.js';
import { idlFactory as hubIdl } from '../build/app_sneeddao_backend.did.js';

const anon = Principal.anonymous();
const ICP_FEE = 10_000n;
const E8S = 100_000_000n;
const H_NS = 3_600_000_000_000n;
const DAY = 86_400;
const txt = (list) => list.map((p) => p.toText());
const byLedger = (tokens) => Object.fromEntries(tokens.map((t) => [t.ledger_id.toText(), t]));
// "\njailbreak" then the principal's bytes, cut or zero-padded to 32
const jailbreakSub = (p) => { const out = new Uint8Array(32); const b = [0x0a, ...new TextEncoder().encode('jailbreak'), ...p.toUint8Array()]; out.set(b.slice(0, 32)); return out; };

let pic, appSubnet, hubId, listId, icpId, aaaId, bbbId, premiumId, poolId;
let hub, hubAlice, hubBob, hubCarol, hubAnon, list, icp, aaa, premium, pool;
const advance = async (seconds, ticks = 5) => { await pic.advanceTime(seconds * 1000); await pic.tick(ticks); };
const settle = async (rounds = 6) => { for (let i = 0; i < rounds; i++) await advance(1, 3); };

describe('app_sneeddao_backend admin and tokens', () => {
  beforeAll(async () => {
    ({ pic, appSubnet } = await createPic());
    listId = await install(pic, { name: 'MockIcpSwapList', targetCanisterId: ICPSWAP_LIST_ID });
    icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
    hubId = await install(pic, { name: 'app_sneeddao_backend', cycles: 20n * T, targetSubnetId: appSubnet });
    aaaId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 1_000n, symbol: 'AAA', decimals: 6 }], targetSubnetId: appSubnet });
    bbbId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 7n, symbol: 'BBB', decimals: 18 }], targetSubnetId: appSubnet });
    premiumId = await install(pic, { name: 'MockPremium', targetSubnetId: appSubnet });
    poolId = await install(pic, { name: 'MockSwapPool', initTypes: poolInit, initArgs: [{ token0: aaaId, token1: bbbId, fee: 3000n }], targetSubnetId: appSubnet });
    hub = actorAs(pic, hubIdl, hubId, admin);
    hubAlice = actorAs(pic, hubIdl, hubId, alice); hubBob = actorAs(pic, hubIdl, hubId, bob); hubCarol = actorAs(pic, hubIdl, hubId, carol); hubAnon = actorAs(pic, hubIdl, hubId, anon);
    list = actorAs(pic, icpSwapListIdl, listId, admin);
    icp = actorAs(pic, ledgerIdl, icpId, admin); aaa = actorAs(pic, ledgerIdl, aaaId, admin);
    premium = actorAs(pic, premiumIdl, premiumId, admin);
    pool = actorAs(pic, poolIdl, poolId, admin);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('admins: the deployer and controllers always, others when added; guards on every admin method', async () => {
    expect(await hub.caller_is_admin()).toBe(true);
    expect(await hubAlice.caller_is_admin()).toBe(false);
    expect(await hubAnon.caller_is_admin()).toBe(false);
    // the deployer is an admin without being listed (the list starts empty, current behaviour)
    expect(await hub.get_admins()).toEqual([]);
    await expect(hubAlice.add_admin(alice)).rejects.toThrow(/assertion failed/);
    await expect(hubAnon.add_admin(anon)).rejects.toThrow(/assertion failed/);
    await hub.add_admin(carol);
    expect(txt(await hubAnon.get_admins())).toEqual(txt([carol]));
    expect(await hubCarol.caller_is_admin()).toBe(true);
    await hubCarol.add_admin(bob); // added admins add admins
    await hubCarol.remove_admin(bob);
    await expect(hubCarol.remove_admin(admin)).rejects.toThrow(/assertion failed/); // the deployer stays
    await expect(hub.remove_admin(admin)).rejects.toThrow(/assertion failed/);
    await expect(hubAlice.remove_admin(carol)).rejects.toThrow(/assertion failed/);
    // admins cannot be banned
    expect(errOf(await hub.ban_user(carol, 1n, 'x'))).toMatch(/administrators/);
    // a controller is an admin while it is one
    await pic.updateCanisterSettings({ canisterId: hubId, sender: admin, controllers: [admin, bob] });
    expect(await hubBob.caller_is_admin()).toBe(true);
    await pic.updateCanisterSettings({ canisterId: hubId, sender: admin, controllers: [admin] });
    expect(await hubBob.caller_is_admin()).toBe(false);
    // every assert-guarded method traps for a non-admin
    const ok = { ledger_id: aaaId, decimals: 6, fee: 1_000n, name: 'x', symbol: 'x', standard: 'ICRC1' };
    for (const call of [
      () => hubAlice.add_whitelisted_token(ok), () => hubAlice.remove_whitelisted_token(aaaId), () => hubAlice.import_whitelist_from_icpswap(),
      () => hubAlice.import_whitelist_from_swaprunner(), () => hubAlice.refresh_token_metadata(aaaId), () => hubAlice.start_refresh_all_token_metadata(),
      () => hubAlice.stop_refresh_all_token_metadata(), () => hubAlice.run_token_list_maintenance_now(), () => hubAlice.send_tokens(aaaId, 1n, alice),
      () => hubAlice.transfer_position(poolId, alice, 1n), () => hubAlice.add_authorized_for_caller(alice), () => hubAnon.add_whitelisted_token(ok),
    ]) await expect(call()).rejects.toThrow(/assertion failed/);
    // and every Result-guarded one answers "Not authorized"
    for (const r of [
      await hubAlice.add_partner('p', 'https://l', 'd', [], []), await hubAlice.update_partner(1n, 'p', 'https://l', 'd', [], []), await hubAlice.remove_partner(1n),
      await hubAlice.add_project('p', [], 'd', { product: null }, [], []), await hubAlice.update_project(1n, 'p', [], 'd', { product: null }, [], []), await hubAlice.remove_project(1n),
      await hubAlice.set_jailbreak_fee_settings([1n], [], [], []), await hubAlice.get_jailbreak_payment_stats(), await hubAlice.get_jailbreak_payment_logs(0n, 10n),
      await hubAlice.get_all_jailbreak_configs_count(), await hubAlice.admin_clear_avatar(bob), await hubAlice.ban_user(bob, 1n, ''), await hubAlice.unban_user(bob),
      await hubAlice.add_blacklisted_word('w'), await hubAlice.remove_blacklisted_word('w'), await hubAlice.set_nickname_premium_canister([]),
      await hubAlice.update_nickname_limits([], [], [], []), await hubAlice.update_canister_groups_limits([], [], [], [], [], []),
      await hubAlice.get_ban_log(), await hubAlice.get_banned_users(), await hubAlice.get_user_ban_history(bob),
      await hubAlice.verify_principal_name(bob), await hubAlice.unverify_principal_name(bob),
    ]) expect(errOf(r)).toMatch(/not authorized/i);
  });

  it('the whitelist by hand: add, replace, remove, query', async () => {
    expect(await hub.get_whitelisted_tokens()).toEqual([]);
    expect(await hubAnon.is_token_whitelisted(aaaId)).toBe(false);
    await hub.add_whitelisted_token({ ledger_id: aaaId, decimals: 2, fee: 1n, name: 'stale', symbol: 'OLD', standard: 'DIP20' });
    await hubCarol.add_whitelisted_token({ ledger_id: aaaId, decimals: 6, fee: 5n, name: 'still stale', symbol: 'OLD', standard: 'DIP20' }); // an added admin
    expect(await hubAnon.is_token_whitelisted(aaaId)).toBe(true);
    expect(await hub.get_whitelisted_tokens()).toEqual([{ ledger_id: aaaId, decimals: 6, fee: 5n, name: 'still stale', symbol: 'OLD', standard: 'DIP20' }]);
    await hub.add_whitelisted_token({ ledger_id: premiumId, decimals: 8, fee: 1n, name: 'Not A Ledger', symbol: 'NAL', standard: 'ICRC1' });
    await hub.remove_whitelisted_token(premiumId);
    await hub.remove_whitelisted_token(premiumId); // gone already: fine
    expect(await hub.is_token_whitelisted(premiumId)).toBe(false);
    await hub.add_whitelisted_token({ ledger_id: premiumId, decimals: 8, fee: 1n, name: 'Not A Ledger', symbol: 'NAL', standard: 'ICRC1' });
  });

  it('refresh_token_metadata reads icrc1_metadata, keeps the standard, adds unknown ledgers, reports failures', async () => {
    const t = unwrap(await hub.refresh_token_metadata(aaaId));
    expect(t).toEqual({ ledger_id: aaaId, decimals: 6, fee: 1_000n, name: 'AAA mock', symbol: 'AAA', standard: 'DIP20' });
    expect(byLedger(await hub.get_whitelisted_tokens())[aaaId.toText()]).toEqual(t);
    // a ledger not on the whitelist is added as ICRC1 (current behaviour)
    expect(unwrap(await hub.refresh_token_metadata(bbbId)).standard).toBe('ICRC1');
    expect(await hub.is_token_whitelisted(bbbId)).toBe(true);
    await hub.remove_whitelisted_token(bbbId);
    expect(errOf(await hub.refresh_token_metadata(premiumId))).toMatch(/Failed to fetch metadata/);
    expect(errOf(await hub.refresh_token_metadata(user('nowhere')))).toMatch(/Failed to fetch metadata/);
    expect(await hub.is_token_whitelisted(user('nowhere'))).toBe(false);
  });

  it('imports ICPSwap\'s token list: valid entries added or updated, hand-added ones kept, bad ones skipped', async () => {
    await list.set_tokens([
      { canisterId: aaaId.toText(), decimals: 6n, fee: 1_000n, name: 'AAA from ICPSwap', symbol: 'AAA', standard: 'ICRC2' },
      { canisterId: ICP_LEDGER_ID.toText(), decimals: 8n, fee: ICP_FEE, name: 'Internet Computer', symbol: 'ICP', standard: 'ICP' },
      { canisterId: bbbId.toText(), decimals: 18n, fee: 7n, name: 'BBB', symbol: 'BBB', standard: 'ICRC1' },
      { canisterId: 'not-a-canister-id', decimals: 8n, fee: 1n, name: 'bad id', symbol: 'BAD', standard: 'ICRC1' },
      { canisterId: 'aaaaa-aa', decimals: 8n, fee: 1n, name: 'short id', symbol: 'BAD', standard: 'ICRC1' },
      { canisterId: user('big').toText(), decimals: 300n, fee: 1n, name: 'too many decimals', symbol: 'BAD', standard: 'ICRC1' },
      { canisterId: 'ryjl3-tyaaa-aaaaa-aaaba-caI', decimals: 8n, fee: 1n, name: 'upper case', symbol: 'BAD', standard: 'ICRC1' },
    ]);
    expect((await hub.get_token_list_status()).last_import).toBe(0n);
    await hub.import_whitelist_from_icpswap();
    const w = byLedger(await hub.get_whitelisted_tokens());
    expect(Object.keys(w).sort()).toEqual([aaaId, ICP_LEDGER_ID, bbbId, premiumId].map((p) => p.toText()).sort());
    expect(w[aaaId.toText()]).toEqual({ ledger_id: aaaId, decimals: 6, fee: 1_000n, name: 'AAA from ICPSwap', symbol: 'AAA', standard: 'ICRC2' });
    expect(w[ICP_LEDGER_ID.toText()].standard).toBe('ICP');
    expect(w[premiumId.toText()].name).toBe('Not A Ledger'); // added by hand, kept
    const st = await hub.get_token_list_status();
    expect(st.tokens).toBe(4n);
    expect(st.last_import).toBeGreaterThanOrEqual((await nowNs(pic)) - 10n ** 10n);
    // the old name does the same
    await list.set_tokens([{ canisterId: bbbId.toText(), decimals: 18n, fee: 8n, name: 'BBB v2', symbol: 'BBB', standard: 'ICRC1' }]);
    await hub.import_whitelist_from_swaprunner();
    expect(byLedger(await hub.get_whitelisted_tokens())[bbbId.toText()].name).toBe('BBB v2');
    // an error from the list rejects the call and changes nothing
    await list.set_error(['list is down']);
    await expect(hub.import_whitelist_from_icpswap()).rejects.toThrow(/ICPSwap token list: list is down/);
    expect((await hub.get_whitelisted_tokens()).length).toBe(4);
    await list.set_error([]);
  });

  it('the batched metadata refresh: progress, failures, completion, stop, nothing to do', async () => {
    let p = await hub.get_refresh_all_progress();
    expect(p).toEqual({ is_running: false, total: 0n, processed: 0n, success: 0n, failed: 0n, current_token: '', errors: [] });
    // five tokens on the list plus the ghost: six, two batches of up to five
    await hub.add_whitelisted_token({ ledger_id: user('ghost-ledger'), decimals: 8, fee: 1n, name: 'Ghost', symbol: 'GHOST', standard: 'ICRC1' });
    await hub.add_whitelisted_token({ ledger_id: aaaId, decimals: 1, fee: 1n, name: 'wrong', symbol: 'AAA', standard: 'ICRC2' });
    await hub.add_whitelisted_token({ ledger_id: user('ghost-2'), decimals: 8, fee: 1n, name: 'Ghost 2', symbol: 'GHOST2', standard: 'ICRC1' });
    unwrap(await hub.start_refresh_all_token_metadata());
    expect(errOf(await hub.start_refresh_all_token_metadata())).toMatch(/already running/);
    p = await hub.get_refresh_all_progress();
    expect(p.is_running).toBe(true); expect(p.total).toBe(6n);
    expect((await hub.get_token_list_status()).refresh_running).toBe(true);
    await settle();
    p = await hub.get_refresh_all_progress();
    expect(p).toMatchObject({ is_running: false, total: 6n, processed: 6n, success: 3n, failed: 3n, current_token: 'Completed' });
    expect(p.errors.map((e) => e.split(':')[0]).sort()).toEqual(['GHOST', 'GHOST2', 'NAL']);
    const w = byLedger(await hub.get_whitelisted_tokens());
    expect(w[aaaId.toText()]).toEqual({ ledger_id: aaaId, decimals: 6, fee: 1_000n, name: 'AAA mock', symbol: 'AAA', standard: 'ICRC2' }); // fixed, standard kept
    expect(w[user('ghost-ledger').toText()].name).toBe('Ghost'); // failures stay as they were
    const st = await hub.get_token_list_status();
    expect(st.last_refresh_done).toBeGreaterThanOrEqual(st.last_refresh_started);
    expect(st.last_refresh_started).toBeGreaterThan(0n);
    // stopped before the first batch runs
    unwrap(await hub.start_refresh_all_token_metadata());
    await hub.stop_refresh_all_token_metadata();
    await settle(2);
    p = await hub.get_refresh_all_progress();
    expect(p).toMatchObject({ is_running: false, processed: 0n, current_token: 'Stopped by user' });
    await hub.stop_refresh_all_token_metadata(); // nothing running: fine
    // an empty whitelist has nothing to refresh
    const all = await hub.get_whitelisted_tokens();
    for (const t of all) await hub.remove_whitelisted_token(t.ledger_id);
    expect(errOf(await hub.start_refresh_all_token_metadata())).toMatch(/No tokens to refresh/);
    for (const t of all) await hub.add_whitelisted_token(t);
    await hub.remove_whitelisted_token(user('ghost-ledger'));
    await hub.remove_whitelisted_token(user('ghost-2'));
  });

  it('the daily maintenance job: on its timer, on demand, and reporting errors', async () => {
    let st = await hub.get_token_list_status();
    expect(st).toMatchObject({ interval_seconds: 86_400n, timer_scheduled: true, refresh_running: false, last_error: '' });
    await list.set_tokens([{ canisterId: aaaId.toText(), decimals: 6n, fee: 1_000n, name: 'AAA daily', symbol: 'AAA', standard: 'ICRC2' }]);
    const before = st.last_import;
    // the timer: a day later, the import runs, then the refresh starts and finishes
    await advance(DAY + 5);
    await settle();
    st = await hub.get_token_list_status();
    expect(st.last_import).toBeGreaterThan(before);
    expect(st.last_refresh_done).toBeGreaterThan(st.last_import);
    expect(st.last_error).toBe('');
    expect(st.refresh_running).toBe(false);
    // the refresh then overwrote the list's name with the ledger's own metadata
    expect(byLedger(await hub.get_whitelisted_tokens())[aaaId.toText()].name).toBe('AAA mock');
    // on demand, with the list down: the error is recorded and the refresh still runs
    await list.set_error(['maintenance']);
    const lastImport = st.last_import;
    await hub.run_token_list_maintenance_now();
    st = await hub.get_token_list_status();
    expect(st.last_error).toBe('whitelist import: ICPSwap token list: maintenance');
    expect(st.last_import).toBe(lastImport);
    expect(st.refresh_running).toBe(true);
    // while a refresh runs the job does nothing
    await list.set_error([]);
    await hub.run_token_list_maintenance_now();
    expect((await hub.get_token_list_status()).last_import).toBe(lastImport);
    await settle();
    expect((await hub.get_token_list_status()).refresh_running).toBe(false);
    await hub.run_token_list_maintenance_now();
    st = await hub.get_token_list_status();
    expect(st.last_import).toBeGreaterThan(lastImport);
    expect(st.last_error).toBe('');
    await settle();
  });

  it('the token meta cache: signed-in users fill an empty entry, only admins overwrite it, anonymous writes are ignored', async () => {
    const meta = { token0: [['symbol', { Text: 'AAA' }], ['decimals', { Nat: 6n }]], token1: [['fee', { Int: -1n }], ['logo', { Blob: Uint8Array.from([1, 2]) }]] };
    const empty = { token0: [], token1: [] };
    expect(await hub.get_cached_token_meta(poolId)).toEqual([]);
    // anonymous: ignored (no trap, so logged-out browsers still get their metadata)
    await hubAnon.set_cached_token_meta(poolId, meta);
    expect(await hub.get_cached_token_meta(poolId)).toEqual([]);
    // first signed-in writer fills the entry
    await hubAlice.set_cached_token_meta(poolId, meta);
    const got = (await hubAlice.get_cached_token_meta(poolId))[0];
    expect(got.token0[0]).toEqual(['symbol', { Text: 'AAA' }]);
    expect(Array.from(got.token1[1][1].Blob)).toEqual([1, 2]);
    // another user cannot overwrite it with different data (ignored); the same data is a no-op
    await hubBob.set_cached_token_meta(poolId, empty);
    await hubBob.set_cached_token_meta(poolId, meta);
    expect(ser(await hub.get_cached_token_meta(poolId))).toBe(ser([meta]));
    // an admin can
    await hub.set_cached_token_meta(poolId, empty);
    expect(await hub.get_cached_token_meta(poolId)).toEqual([empty]);
    await hub.set_cached_token_meta(poolId, meta);
    expect(ser(await hub.get_cached_token_meta(poolId))).toBe(ser([meta]));
  });

  it('partners: validation, ordering index, update and removal', async () => {
    expect(await hub.get_partners()).toEqual([]);
    expect(errOf(await hub.add_partner('', 'https://l', 'd', [], []))).toMatch(/name cannot be empty/);
    expect(errOf(await hub.add_partner('n', '', 'd', [], []))).toMatch(/Logo URL cannot be empty/);
    expect(errOf(await hub.add_partner('n', 'https://l', '', [], []))).toMatch(/Description cannot be empty/);
    const links = [{ title: 'site', url: 'https://taco.example' }];
    expect(unwrap(await hub.add_partner('TACO', 'https://taco/logo.png', 'TACO DAO', links, [2n]))).toBe(1n);
    expect(unwrap(await hubCarol.add_partner('Two', 'https://two', 'second', [], []))).toBe(2n);
    expect(unwrap(await hub.add_partner('Three', 'https://three', 'third', [], [0n]))).toBe(3n);
    const p1 = (await hubAnon.get_partner(1n))[0];
    expect(p1).toMatchObject({ id: 1n, name: 'TACO', logo_url: 'https://taco/logo.png', description: 'TACO DAO', links, index: [2n] });
    expect(p1.created_at).toBe(p1.updated_at);
    expect(await hub.get_partner(99n)).toEqual([]);
    await advance(10, 1);
    unwrap(await hub.update_partner(1n, 'TACO DAO', 'https://taco/logo2.png', 'updated', [], []));
    const u = (await hub.get_partner(1n))[0];
    expect(u).toMatchObject({ name: 'TACO DAO', logo_url: 'https://taco/logo2.png', links: [], index: [], created_at: p1.created_at });
    expect(u.updated_at).toBeGreaterThan(p1.updated_at);
    expect(errOf(await hub.update_partner(99n, 'x', 'y', 'z', [], []))).toMatch(/not found/);
    expect(errOf(await hub.update_partner(1n, '', 'y', 'z', [], []))).toMatch(/empty/);
    unwrap(await hub.remove_partner(2n));
    expect(errOf(await hub.remove_partner(2n))).toMatch(/not found/);
    expect((await hub.get_partners()).map((p) => p.id)).toEqual([1n, 3n]);
  });

  it('projects: validation, types, optional logo, update and removal', async () => {
    expect(errOf(await hub.add_project('', [], 'd', { product: null }, [], []))).toMatch(/name cannot be empty/);
    expect(errOf(await hub.add_project('n', [], '', { product: null }, [], []))).toMatch(/Description cannot be empty/);
    expect(unwrap(await hub.add_project('Sneed Lock', ['https://lock.png'], 'locks', { product: null }, [{ title: 'app', url: 'https://app' }], [1n]))).toBe(1n);
    expect(unwrap(await hub.add_project('Fork', [], 'a fork', { fork: null }, [], []))).toBe(2n);
    expect(unwrap(await hub.add_project('Proj', [], 'a project', { project: null }, [], []))).toBe(3n);
    expect((await hubAnon.get_project(2n))[0]).toMatchObject({ name: 'Fork', logo_url: [], project_type: { fork: null } });
    expect(await hub.get_project(9n)).toEqual([]);
    unwrap(await hub.update_project(2n, 'Fork 2', ['https://f.png'], 'still a fork', { product: null }, [], [5n]));
    expect((await hub.get_project(2n))[0]).toMatchObject({ name: 'Fork 2', logo_url: ['https://f.png'], project_type: { product: null }, index: [5n] });
    expect(errOf(await hub.update_project(9n, 'x', [], 'y', { product: null }, [], []))).toMatch(/not found/);
    expect(errOf(await hub.update_project(2n, 'x', [], '', { product: null }, [], []))).toMatch(/empty/);
    unwrap(await hub.remove_project(3n));
    expect(errOf(await hub.remove_project(3n))).toMatch(/not found/);
    expect((await hub.get_projects()).map((p) => p.id)).toEqual([1n, 2n]);
  });

  it('jailbreak configs: free by default, dedup, per user, deletion', async () => {
    expect(await hub.get_jailbreak_fee_settings()).toEqual({ fee_premium_e8s: 0n, fee_regular_e8s: 0n, fee_account_owner: [], fee_account_subaccount: [] });
    expect(await hubAlice.get_my_jailbreak_fee()).toBe(0n);
    expect(errOf(await hubAnon.save_jailbreak_config(SNS(), 'aa', alice))).toMatch(/Anonymous/);
    const id1 = unwrap(await hubAlice.save_jailbreak_config(SNS(), 'abcd', bob));
    expect(id1).toBe(1n);
    expect(unwrap(await hubAlice.save_jailbreak_config(SNS(), 'abcd', bob))).toBe(1n); // the same config again: same id
    expect(unwrap(await hubAlice.save_jailbreak_config(SNS(), 'abcd', carol))).toBe(2n);
    expect(unwrap(await hubBob.save_jailbreak_config(SNS(), 'abcd', bob))).toBe(3n); // ids are global
    const mine = await hubAlice.get_my_jailbreak_configs();
    expect(mine.map((c) => [c.id, c.neuron_id_hex, c.target_principal.toText()])).toEqual([[1n, 'abcd', bob.toText()], [2n, 'abcd', carol.toText()]]);
    expect(await hubCarol.get_my_jailbreak_configs()).toEqual([]);
    expect(unwrap(await hub.get_all_jailbreak_configs_count())).toBe(3n);
    expect(unwrap(await hub.get_jailbreak_payment_stats()).total_scripts_created).toBe(0n); // free configs are not payments
    expect(errOf(await hubAnon.delete_jailbreak_config(1n))).toMatch(/Anonymous/);
    expect(errOf(await hubCarol.delete_jailbreak_config(1n))).toMatch(/No configurations/);
    expect(errOf(await hubBob.delete_jailbreak_config(1n))).toMatch(/not found/); // alice's
    unwrap(await hubAlice.delete_jailbreak_config(2n));
    expect((await hubAlice.get_my_jailbreak_configs()).map((c) => c.id)).toEqual([1n]);
    expect(unwrap(await hub.get_all_jailbreak_configs_count())).toBe(2n);
  });

  it('jailbreak fees: paid from the user\'s payment subaccount, premium price, fee account, stats and logs', async () => {
    unwrap(await hub.set_nickname_premium_canister([premiumId]));
    await premium.set_member(carol, (await nowNs(pic)) + 1000n * H_NS);
    unwrap(await hub.set_jailbreak_fee_settings([E8S / 2n], [E8S], [], []));
    expect(await hubAlice.get_my_jailbreak_fee()).toBe(E8S);
    expect(await hubCarol.get_my_jailbreak_fee()).toBe(E8S / 2n);
    // the payment subaccount: "\njailbreak" + the principal bytes, cut to 32
    const subAlice = await hubAlice.get_jailbreak_payment_subaccount();
    expect(Array.from(subAlice)).toEqual(Array.from(jailbreakSub(alice)));
    expect(Array.from(await hubBob.get_jailbreak_payment_subaccount())).not.toEqual(Array.from(subAlice));
    expect(await hubAlice.get_jailbreak_payment_balance()).toBe(0n);
    expect(errOf(await hubAlice.save_jailbreak_config(SNS(), 'ff01', alice))).toMatch(/Insufficient payment balance. Required: 100000000 e8s \+ 10000 fee. Available: 0/);
    // a deposit just short of fee + ledger fee is refused
    await icp.mint(account(hubId, jailbreakSub(alice)), E8S + ICP_FEE - 1n);
    expect(await hubAlice.get_jailbreak_payment_balance()).toBe(E8S + ICP_FEE - 1n);
    expect(errOf(await hubAlice.save_jailbreak_config(SNS(), 'ff01', alice))).toMatch(/Insufficient/);
    await icp.mint(account(hubId, jailbreakSub(alice)), 1n);
    const hubBefore = await icp.icrc1_balance_of(account(hubId));
    const id = unwrap(await hubAlice.save_jailbreak_config(SNS(), 'ff01', alice));
    expect(await hubAlice.get_jailbreak_payment_balance()).toBe(0n);
    expect((await icp.icrc1_balance_of(account(hubId))) - hubBefore).toBe(E8S); // no fee account: the canister keeps it
    expect(unwrap(await hubAlice.save_jailbreak_config(SNS(), 'ff01', alice))).toBe(id); // again: free
    // the premium price, paid to a configured fee account with a subaccount
    const feeSub = new Uint8Array(32).fill(7);
    unwrap(await hub.set_jailbreak_fee_settings([], [], [[bob]], [[feeSub]]));
    const s = await hub.get_jailbreak_fee_settings();
    expect(s.fee_account_owner[0].toText()).toBe(bob.toText());
    expect(Array.from(s.fee_account_subaccount[0])).toEqual(Array.from(feeSub));
    await icp.mint(account(hubId, jailbreakSub(carol)), E8S / 2n + ICP_FEE);
    unwrap(await hubCarol.save_jailbreak_config(SNS(), 'ff02', carol));
    expect(await icp.icrc1_balance_of(account(bob, feeSub))).toBe(E8S / 2n);
    const memoTx = (await icp.get_transactions()).at(-1);
    expect(memoTx.to.owner.toText()).toBe(bob.toText());
    // stats and logs (newest first, paginated)
    expect(unwrap(await hub.get_jailbreak_payment_stats())).toEqual({
      total_scripts_created: 2n, total_revenue_e8s: E8S + E8S / 2n, total_premium_payments: 1n, total_regular_payments: 1n,
      premium_revenue_e8s: E8S / 2n, regular_revenue_e8s: E8S, unique_users: 2n,
    });
    let logs = unwrap(await hub.get_jailbreak_payment_logs(0n, 10n));
    expect(logs.total).toBe(2n);
    expect(logs.logs.map((l) => [l.id, l.user.toText(), l.amount_e8s, l.is_premium, l.neuron_id_hex])).toEqual([
      [2n, carol.toText(), E8S / 2n, true, 'ff02'], [1n, alice.toText(), E8S, false, 'ff01'],
    ]);
    expect(logs.logs[1].config_id).toBe(id);
    logs = unwrap(await hub.get_jailbreak_payment_logs(1n, 10n));
    expect(logs.logs.map((l) => l.id)).toEqual([1n]);
    expect(unwrap(await hub.get_jailbreak_payment_logs(0n, 1n)).logs.map((l) => l.id)).toEqual([2n]);
    expect(unwrap(await hub.get_jailbreak_payment_logs(2n, 10n))).toEqual({ logs: [], total: 2n });
    expect(unwrap(await hub.get_jailbreak_payment_logs(0n, 0n))).toEqual({ logs: [], total: 2n });
    // clearing the fee account sends fees to the canister again
    unwrap(await hub.set_jailbreak_fee_settings([], [], [[]], [[]]));
    expect(await hub.get_jailbreak_fee_settings()).toMatchObject({ fee_account_owner: [], fee_account_subaccount: [] });
  });

  it('withdrawing from the jailbreak payment subaccount', async () => {
    expect(errOf(await hubAnon.withdraw_jailbreak_payment(1n))).toMatch(/Anonymous/);
    await icp.mint(account(hubId, jailbreakSub(bob)), 5n * E8S);
    expect(errOf(await hubBob.withdraw_jailbreak_payment(5n * E8S))).toMatch(/Insufficient balance. Available: 500000000/);
    const before = await icp.icrc1_balance_of(account(bob));
    expect(unwrap(await hubBob.withdraw_jailbreak_payment(2n * E8S))).toBeGreaterThan(0n);
    expect((await icp.icrc1_balance_of(account(bob))) - before).toBe(2n * E8S);
    expect(await hubBob.get_jailbreak_payment_balance()).toBe(3n * E8S - ICP_FEE);
    expect(unwrap(await hubBob.withdraw_jailbreak_payment(3n * E8S - 2n * ICP_FEE))).toBeGreaterThan(0n);
    expect(await hubBob.get_jailbreak_payment_balance()).toBe(0n);
    // the ledger refusing is reported
    await icp.mint(account(hubId, jailbreakSub(bob)), E8S);
    await icp.set_paused(true);
    expect(errOf(await hubBob.withdraw_jailbreak_payment(1n))).toMatch(/Transfer failed: #TemporarilyUnavailable/);
    await icp.set_paused(false);
  });

  it('admin transfers: tokens from a user\'s wallet subaccount, and ICPSwap positions the canister holds', async () => {
    await aaa.mint(account(hubId, principalToSubaccount(alice)), 50_000n);
    const r = await hub.send_tokens(aaaId, 20_000n, alice);
    expect('Ok' in r).toBe(true);
    expect(await aaa.icrc1_balance_of(account(alice))).toBe(20_000n);
    expect(await aaa.icrc1_balance_of(account(hubId, principalToSubaccount(alice)))).toBe(29_000n);
    expect(errOf(await hub.send_tokens(aaaId, 1_000_000n, alice))).toEqual({ InsufficientFunds: { balance: 29_000n } });
    await pool.mint_position(hubId, 7n, 100n);
    expect(await hub.transfer_position(poolId, alice, 7n)).toEqual({ ok: true });
    expect((await pool.position_owner(7n))[0].toText()).toBe(alice.toText());
    expect(errOf(await hub.transfer_position(poolId, bob, 7n))).toEqual({ InternalError: 'caller does not own the position' });
  });

  it('get_canister_info: controllers and module hash of any canister, for any caller', async () => {
    const info = unwrap(await hubAnon.get_canister_info(aaaId));
    expect(txt(info.controllers)).toEqual(txt([admin]));
    expect(info.module_hash[0].length).toBe(32);
    const self = unwrap(await hubAlice.get_canister_info(hubId));
    expect(txt(self.controllers)).toEqual(txt([admin]));
    expect(errOf(await hub.get_canister_info(Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai')))).toMatch(/Failed to get canister info/);
  });

  it('an upgrade keeps admins, whitelist, partners, projects, jailbreak state and the timer; the meta cache is dropped', async () => {
    const snapshot = async () => ({
      admins: sorted(await hub.get_admins()),
      authorized: sorted(await hub.get_authorized_for_callers()),
      whitelist: sorted(await hub.get_whitelisted_tokens()),
      partners: ser(await hub.get_partners()),
      projects: ser(await hub.get_projects()),
      fees: ser(await hub.get_jailbreak_fee_settings()),
      stats: ser(unwrap(await hub.get_jailbreak_payment_stats())),
      logs: ser(unwrap(await hub.get_jailbreak_payment_logs(0n, 100n))),
      count: unwrap(await hub.get_all_jailbreak_configs_count()),
      aliceConfigs: ser(await hubAlice.get_my_jailbreak_configs()),
      tokenStatus: ser({ ...(await hub.get_token_list_status()), refresh_running: null }),
    });
    const before = await snapshot();
    expect(before.admins).toEqual(sorted([carol]));
    expect((await hub.get_cached_token_meta(poolId)).length).toBe(1);
    await upgradeHub(pic, hubId, admin, wasm('app_sneeddao_backend'));
    await pic.tick(2);
    expect(await snapshot()).toEqual(before);
    expect(await hubCarol.caller_is_admin()).toBe(true);
    expect(await hub.caller_is_admin()).toBe(true); // the deployer, still
    // the cache is transient (current behaviour)
    expect(await hub.get_cached_token_meta(poolId)).toEqual([]);
    // ids follow the stored counters (project 3 was removed above and is not handed out again)
    expect(unwrap(await hub.add_project('After', [], 'after the upgrade', { product: null }, [], []))).toBe(4n);
    await icp.mint(account(hubId, jailbreakSub(bob)), ICP_FEE);
    expect(unwrap(await hubBob.save_jailbreak_config(SNS(), 'after', bob))).toBe(6n); // 1-3 free, 4 and 5 paid
    // partner and project id counters are stored: removed ids above the highest survivor are not
    // handed out again after an upgrade, even when no entries are left
    unwrap(await hub.remove_partner(3n));
    await upgradeHub(pic, hubId, admin, wasm('app_sneeddao_backend'));
    expect(unwrap(await hub.add_partner('Fresh', 'https://r', 'gets a new id', [], []))).toBe(4n);
    for (const p of await hub.get_partners()) unwrap(await hub.remove_partner(p.id));
    for (const p of await hub.get_projects()) unwrap(await hub.remove_project(p.id));
    await upgradeHub(pic, hubId, admin, wasm('app_sneeddao_backend'));
    expect(unwrap(await hub.add_partner('Fresh2', 'https://r', 'gets a new id', [], []))).toBe(5n);
    expect(unwrap(await hub.add_project('After2', [], 'after the second upgrade', { product: null }, [], []))).toBe(5n);
    // the daily timer is set up again: a day later the import runs
    const lastImport = (await hub.get_token_list_status()).last_import;
    expect((await hub.get_token_list_status()).timer_scheduled).toBe(true);
    await advance(DAY + 5);
    await settle();
    expect((await hub.get_token_list_status()).last_import).toBeGreaterThan(lastImport);
  });
});

// any principal works as an "SNS root" for jailbreak configs: the backend only stores it
function SNS() { return user('some-sns-root'); }
