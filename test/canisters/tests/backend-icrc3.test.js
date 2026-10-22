// The Sneed Hub backend's ICRC-3 activity log (spec/backend_icrc3.md): an empty log with the
// documented catalogue; one block per jailbreak payment (payer, amount, ledger fee, price tier incl.
// partner and admin prices, recipient account, ICP ledger block), per deposit withdrawal, per admin
// token or position transfer, per verified donation (donor, token, amount, ledger block) and per
// donation hidden or shown, per ban and unban (the reason only as SHA-256), per avatar an admin
// cleared, per admin list change, per partner and project added, changed or removed, and per
// configuration change (old -> new); nothing for refused calls, calls that change nothing and the
// users' own data (settings, nicknames, jailbreak targets, registrations), and no private text in
// any block; the hash chain and certified tip verify (lib/icrc3.js); spills into archives
// co-controlled by SNS root, with a public text log; the ingress guard; an upgrade keeps the log;
// and an upgrade from the production build (src/app_sneeddao_backend at cd8d6d3e, module hash
// 91d76948…, build/app_sneeddao_backend_prod.wasm) with wasm_memory_persistence = keep keeps the
// admins, directories, fees, special prices, payments and donations and starts an empty log.
// BACKEND_WASM=app_sneeddao_backend_prod npx vitest run tests/backend-icrc3.test.js runs it against the production code.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import {
  createPic, install, actorAs, account, admin, alice, bob, carol, user, ICP_LEDGER_ID, SNEED_SNS_ROOT, T, unwrap, errOf, wasm, BUILD,
  principalToSubaccount, refusedAtIngress, asUpdates, nowNs,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit, poolIdl, poolInit } from '../lib/idl.js';
import { ser, upgradeHub } from '../lib/hub.js';
import { archiveIdl, btype, tx, verifyLog, icrc3Service, sha256 } from '../lib/icrc3.js';
import { idlFactory as hubIdl } from '../build/app_sneeddao_backend.did.js';

const BACKEND_WASM = process.env.BACKEND_WASM || 'app_sneeddao_backend';
const BLOCK_TYPES_URL = 'https://app.sneeddao.com/api/app_sneeddao_backend#block-types';
const CATALOGUE = [
  'jailbreak_payment', 'deposit_withdraw', 'send_tokens', 'transfer_position', 'donation', 'donation_hidden', 'ban', 'unban', 'avatar_clear',
  'admin_add', 'admin_remove', 'partner_add', 'partner_update', 'partner_remove', 'project_add', 'project_update', 'project_remove', 'config_update',
].map((t) => `sneedbackend_${t}`);
const ICP_FEE = 10_000n;
const E8S = 100_000_000n;
const dave = user('dave');
const eve = user('eve');
const ledgerGz = resolve(BUILD, 'ledger.wasm.gz');
const haveLedger = existsSync(ledgerGz);

const hex = (b) => Buffer.from(b).toString('hex');
const P = (p) => hex(p.toUint8Array());
const H = (text) => hex(sha256(Buffer.from(text, 'utf8')));
const plain = (v) => {
  if ('Nat' in v) return v.Nat;
  if ('Int' in v) return v.Int;
  if ('Text' in v) return v.Text;
  if ('Blob' in v) return hex(v.Blob);
  if ('Array' in v) return v.Array.map(plain);
  return Object.fromEntries(v.Map.map(([k, x]) => [k, plain(x)]));
};
// "\njailbreak" then the principal's bytes, cut or zero-padded to 32
const jailbreakSub = (p) => { const out = new Uint8Array(32); const b = [0x0a, ...new TextEncoder().encode('jailbreak'), ...p.toUint8Array()]; out.set(b.slice(0, 32)); return out; };

// the backend's interface plus the log's and the special-price methods (so the test runs against a
// build without them, and fails there)
const LogEntry = IDL.Record({ id: IDL.Nat, ts: IDL.Int, level: IDL.Variant({ info: IDL.Null, error: IDL.Null }), cid: IDL.Nat, caller: IDL.Principal, message: IDL.Text });
const fullIdl = ({ IDL: I }) => {
  const Prices = I.Record({ jailbreak_fee_e8s: I.Opt(I.Nat) });
  const Res = I.Variant({ ok: I.Null, err: I.Text });
  return I.Service({
    ...Object.fromEntries(hubIdl({ IDL: I })._fields),
    ...icrc3Service(I),
    get_log: I.Func([I.Nat, I.Nat], [I.Vec(LogEntry)], ['query']),
    set_admin_prices: I.Func([Prices], [Res], []),
    set_partner_prices: I.Func([I.Principal, I.Record({ label: I.Text, prices: Prices, expires_at: I.Opt(I.Int) })], [Res], []),
    remove_partner_prices: I.Func([I.Principal], [Res], []),
  });
};
// the real ICRC ledger, for donations (the backend reads the block through ICRC-3)
const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const MetadataValue = IDL.Variant({ Nat: IDL.Nat, Int: IDL.Int, Text: IDL.Text, Blob: IDL.Vec(IDL.Nat8) });
const LedgerArg = IDL.Variant({
  Init: IDL.Record({
    minting_account: Account, transfer_fee: IDL.Nat, decimals: IDL.Opt(IDL.Nat8), token_symbol: IDL.Text, token_name: IDL.Text,
    metadata: IDL.Vec(IDL.Tuple(IDL.Text, MetadataValue)), initial_balances: IDL.Vec(IDL.Tuple(Account, IDL.Nat)),
    feature_flags: IDL.Opt(IDL.Record({ icrc2: IDL.Bool })),
    archive_options: IDL.Record({ num_blocks_to_archive: IDL.Nat64, trigger_threshold: IDL.Nat64, controller_id: IDL.Principal, cycles_for_archive_creation: IDL.Opt(IDL.Nat64) }),
  }),
  Upgrade: IDL.Opt(IDL.Record({})),
});
const icrcIdl = ({ IDL: I }) => I.Service({
  icrc1_transfer: I.Func([I.Record({ from_subaccount: I.Opt(I.Vec(I.Nat8)), to: Account, amount: I.Nat, fee: I.Opt(I.Nat), memo: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64) })], [I.Variant({ Ok: I.Nat, Err: I.Reserved })], []),
});

let pic, rootKey, appSubnet, hubId, icpId, tokId, aaaId, poolId;
let icp, aaa, pool;
const as = (p, id = hubId) => actorAs(pic, fullIdl, id, p);
const archiveActor = (id) => actorAs(pic, archiveIdl, id, admin);
const advance = async (seconds, ticks = 2) => { await pic.advanceTime(seconds * 1000); await pic.tick(ticks); };

/// The whole log, verified (certificate, tree, phash chain, catalogue), as plain records { i, t, ...tx }.
const rawLog = async (id = hubId) => (await verifyLog(as(admin, id), id, rootKey, archiveActor)).blocks;
const verifiedLog = async (id = hubId) => (await rawLog(id)).map((b, i) => ({ i, t: btype(b).replace(/^sneedbackend_/, ''), ...plain(tx(b)) }));
const logLength = async (id = hubId) => Number((await as(admin, id).icrc3_log_status()).log_length);
const since = async (mark, id = hubId) => (await verifiedLog(id)).slice(mark);
const strip = (blocks) => blocks.map(({ i, ...b }) => b);
const lastIcpTx = async () => (await icp.get_transactions()).at(-1).index;

const SECRET = {
  description: 'Partner description, long and public but logged only as a hash',
  reason: 'Spam in the forum, reported privately by a user',
  word: 'zorkblat',
  nickname: 'my private nickname',
  neuron: 'abcdef0123456789',
  message: 'A thank-you note on the wall',
  denomination: 'my-own-denomination-token',
};

beforeAll(async () => {
  ({ pic, rootKey, appSubnet } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  hubId = await install(pic, { name: BACKEND_WASM, cycles: 20n * T, targetSubnetId: appSubnet });
  aaaId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 1_000n, symbol: 'AAA', decimals: 6 }], targetSubnetId: appSubnet });
  poolId = await install(pic, { name: 'MockSwapPool', initTypes: poolInit, initArgs: [{ token0: aaaId, token1: icpId, fee: 3000n }], targetSubnetId: appSubnet });
  icp = actorAs(pic, ledgerIdl, icpId, admin); aaa = actorAs(pic, ledgerIdl, aaaId, admin); pool = actorAs(pic, poolIdl, poolId, admin);
  if (haveLedger) {
    tokId = await pic.createCanister({ sender: admin, cycles: 100n * T, targetSubnetId: appSubnet, controllers: [admin] });
    await pic.installCode({ sender: admin, canisterId: tokId, wasm: readFileSync(ledgerGz), arg: IDL.encode([LedgerArg], [{ Init: {
      minting_account: account(carol), transfer_fee: 1_000n, decimals: [8], token_symbol: 'TOK', token_name: 'Token', metadata: [],
      initial_balances: [[account(alice), 1_000n * E8S], [account(bob), 1_000n * E8S]], feature_flags: [{ icrc2: true }],
      archive_options: { num_blocks_to_archive: 1000n, trigger_threshold: 2000n, controller_id: admin, cycles_for_archive_creation: [10n * T] },
    } }]) });
  }
}, 180_000);
afterAll(async () => { await pic?.tearDown(); });

describe('fresh install', () => {
  it('has an empty log, the documented catalogue and ICRC-3 among its standards', async () => {
    expect(await as(alice).icrc3_log_status()).toMatchObject({ log_length: 0n, live_blocks: 0n, archives: [], history_imported: false, last_block_hash: [] });
    expect(await as(alice).icrc3_get_tip_certificate()).toEqual([]);
    expect(await as(alice).icrc3_supported_block_types()).toEqual(CATALOGUE.map((block_type) => ({ block_type, url: BLOCK_TYPES_URL })));
    expect((await as(alice).icrc10_supported_standards()).map((s) => s.name)).toEqual(['ICRC-3', 'ICRC-10']);
    expect(await as(alice).icrc3_get_blocks([{ start: 0n, length: 10n }])).toEqual({ log_length: 0n, blocks: [], archived_blocks: [] });
    expect(await as(alice).icrc3_get_archives({ from: [] })).toEqual([]);
    expect(await as(alice).get_log(0n, 10n)).toEqual([]);
  });
});

describe('admins and directories', () => {
  it('admins: additions and removals; refused and repeated calls append nothing', async () => {
    await expect(as(alice).add_admin(alice)).rejects.toThrow(/assertion failed/);
    await as(admin).add_admin(dave);
    await as(admin).add_admin(dave); // already one
    await as(dave).add_admin(carol);
    await as(admin).remove_admin(carol);
    await as(admin).remove_admin(carol); // not one any more
    await expect(as(dave).remove_admin(admin)).rejects.toThrow(/assertion failed/); // the deployer stays
    expect(strip(await verifiedLog())).toEqual([
      { t: 'admin_add', caller: P(admin), principal: P(dave) },
      { t: 'admin_add', caller: P(dave), principal: P(carol) },
      { t: 'admin_remove', caller: P(admin), principal: P(carol) },
    ]);
  });

  it('partners and projects: added, changed and removed, with hashes of the long texts; unchanged updates and refused calls append nothing', async () => {
    const mark = await logLength();
    expect(errOf(await as(admin).add_partner('', 'https://logo', 'd', [], []))).toMatch(/empty/);
    const links = [{ title: 'Site', url: 'https://partner.example' }];
    const pid = unwrap(await as(admin).add_partner('Partner One', 'https://logo.example/p.png', SECRET.description, links, []));
    unwrap(await as(admin).update_partner(pid, 'Partner One', 'https://logo.example/p.png', SECRET.description, links, [])); // unchanged
    unwrap(await as(dave).update_partner(pid, 'Partner 1', 'https://logo.example/p.png', SECRET.description, links, [3n]));
    expect(errOf(await as(admin).update_partner(99n, 'X', 'l', 'd', [], []))).toMatch(/not found/);
    expect(errOf(await as(alice).remove_partner(pid))).toMatch(/Not authorized/);
    unwrap(await as(admin).remove_partner(pid));
    expect(errOf(await as(admin).remove_partner(pid))).toMatch(/not found/);
    const prj = unwrap(await as(admin).add_project('Sneed Hub', [], 'The hub', { product: null }, [], []));
    unwrap(await as(admin).update_project(prj, 'Sneed Hub', [], 'The hub', { product: null }, [], [])); // unchanged
    unwrap(await as(admin).update_project(prj, 'Sneed Hub', ['https://logo.example/h.png'], 'The hub', { fork: null }, [], [1n]));
    unwrap(await as(admin).remove_project(prj));
    const p0 = { name: 'Partner One', logo_url_sha256: H('https://logo.example/p.png'), description_sha256: H(SECRET.description), links: [{ title: 'Site', url: 'https://partner.example' }] };
    const p1 = { ...p0, name: 'Partner 1', index: 3n };
    const j0 = { name: 'Sneed Hub', project_type: 'product', description_sha256: H('The hub'), links: [] };
    const j1 = { ...j0, project_type: 'fork', logo_url_sha256: H('https://logo.example/h.png'), index: 1n };
    expect(strip(await since(mark))).toEqual([
      { t: 'partner_add', caller: P(admin), id: pid, value: p0 },
      { t: 'partner_update', caller: P(dave), id: pid, value: p1, old_value: p0 },
      { t: 'partner_remove', caller: P(admin), id: pid, old_value: p1 },
      { t: 'project_add', caller: P(admin), id: prj, value: j0 },
      { t: 'project_update', caller: P(admin), id: prj, value: j1, old_value: j0 },
      { t: 'project_remove', caller: P(admin), id: prj, old_value: j1 },
    ]);
  });
});

describe('configuration', () => {
  it('fees and their recipient, special prices: one block per setting that changed, old -> new', async () => {
    const mark = await logLength();
    const sub = new Uint8Array(32).fill(9);
    expect(errOf(await as(alice).set_jailbreak_fee_settings([1n], [], [], []))).toMatch(/Not authorized/);
    unwrap(await as(admin).set_jailbreak_fee_settings([E8S / 2n], [E8S], [[carol]], [[sub]]));
    unwrap(await as(admin).set_jailbreak_fee_settings([E8S / 2n], [E8S], [[carol]], [[sub]])); // the same again
    unwrap(await as(admin).set_jailbreak_fee_settings([], [], [], [[]])); // the subaccount cleared
    unwrap(await as(admin).set_jailbreak_fee_settings([], [], [], [[sub]]));
    unwrap(await as(admin).set_admin_prices({ jailbreak_fee_e8s: [0n] }));
    unwrap(await as(admin).set_admin_prices({ jailbreak_fee_e8s: [0n] })); // unchanged
    expect(errOf(await as(alice).set_admin_prices({ jailbreak_fee_e8s: [] }))).toMatch(/Not authorized/);
    const exp = (await nowNs(pic)) + 1000n * 3_600_000_000_000n;
    const entry = { label: 'Friends of Sneed', prices: { jailbreak_fee_e8s: [E8S / 4n] }, expires_at: [] };
    unwrap(await as(admin).set_partner_prices(alice, entry));
    unwrap(await as(admin).set_partner_prices(alice, entry)); // unchanged
    unwrap(await as(admin).set_partner_prices(eve, { label: 'Eve', prices: { jailbreak_fee_e8s: [1n] }, expires_at: [exp] }));
    unwrap(await as(admin).set_partner_prices(eve, { label: 'Eve', prices: { jailbreak_fee_e8s: [2n] }, expires_at: [] }));
    unwrap(await as(admin).remove_partner_prices(eve));
    expect(errOf(await as(admin).remove_partner_prices(eve))).toMatch(/no partner prices/);
    const cfg = (key, old_value, value, extra = {}) => ({ t: 'config_update', caller: P(admin), key, ...extra, old_value, value });
    const to = [P(carol), hex(sub)];
    expect(strip(await since(mark))).toEqual([
      cfg('jailbreak_fee_premium_e8s', 0n, E8S / 2n),
      cfg('jailbreak_fee_regular_e8s', 0n, E8S),
      cfg('jailbreak_fee_recipient', 'none', to),
      cfg('jailbreak_fee_recipient', to, [P(carol)]),
      cfg('jailbreak_fee_recipient', [P(carol)], to),
      cfg('admin_prices', {}, { jailbreak_fee_e8s: 0n }),
      { t: 'config_update', caller: P(admin), key: 'partner_prices', partner: P(alice), value: { label: 'Friends of Sneed', prices: { jailbreak_fee_e8s: E8S / 4n } } },
      { t: 'config_update', caller: P(admin), key: 'partner_prices', partner: P(eve), value: { label: 'Eve', prices: { jailbreak_fee_e8s: 1n }, expires_at: exp } },
      cfg('partner_prices', { label: 'Eve', prices: { jailbreak_fee_e8s: 1n }, expires_at: exp }, { label: 'Eve', prices: { jailbreak_fee_e8s: 2n } }, { partner: P(eve) }),
      cfg('partner_prices', { label: 'Eve', prices: { jailbreak_fee_e8s: 2n } }, 'removed', { partner: P(eve) }),
    ]);
  });

  it('feedback, donation account, naming, nickname and folder limits, whitelist, "for" callers, blacklist and the log\'s own settings', async () => {
    const mark = await logLength();
    unwrap(await as(admin).admin_set_feedback_config({ recipients: [alice, bob], bug_topic: [5n], idea_topic: [] }));
    unwrap(await as(admin).admin_set_feedback_config({ recipients: [alice, bob], bug_topic: [5n], idea_topic: [] })); // unchanged
    expect(errOf(await as(alice).admin_set_feedback_config({ recipients: [], bug_topic: [], idea_topic: [] }))).toMatch(/Only admins/);
    unwrap(await as(admin).admin_set_donation_account([account(admin)]));
    unwrap(await as(admin).admin_set_donation_account([account(admin)])); // unchanged
    unwrap(await as(admin).admin_set_names_canisters([carol]));
    unwrap(await as(admin).admin_set_names_frozen(true));
    unwrap(await as(admin).admin_set_names_frozen(true)); // unchanged
    unwrap(await as(admin).admin_set_names_frozen(false));
    unwrap(await as(admin).set_nickname_premium_canister([eve]));
    unwrap(await as(admin).set_nickname_premium_canister([]));
    unwrap(await as(admin).update_nickname_limits([20n], [], [], [100n])); // the last is the value it has
    unwrap(await as(admin).update_canister_groups_limits([], [30n], [], [], [], []));
    const token = { ledger_id: aaaId, decimals: 6, fee: 1_000n, name: 'AAA token', symbol: 'AAA', standard: 'ICRC1' };
    await as(admin).add_whitelisted_token(token);
    await as(admin).add_whitelisted_token(token); // unchanged
    await as(admin).add_whitelisted_token({ ...token, fee: 2_000n });
    await as(admin).remove_whitelisted_token(aaaId);
    await as(admin).remove_whitelisted_token(aaaId); // gone already
    await as(admin).add_authorized_for_caller(eve);
    await as(admin).add_authorized_for_caller(eve); // already
    await as(admin).remove_authorized_for_caller(eve);
    await as(admin).remove_authorized_for_caller(eve); // gone already
    unwrap(await as(admin).add_blacklisted_word(SECRET.word));
    expect(errOf(await as(admin).add_blacklisted_word(SECRET.word.toUpperCase()))).toMatch(/already/);
    unwrap(await as(admin).remove_blacklisted_word(SECRET.word));
    expect(errOf(await as(admin).remove_blacklisted_word(SECRET.word))).toMatch(/not found/);
    const settings = { max_live_blocks: [3000n], spill_batch_size: [], archive_max_blocks: [], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] };
    unwrap(await as(admin).admin_set_icrc3_settings(settings));
    unwrap(await as(admin).admin_set_icrc3_settings(settings)); // unchanged
    expect(errOf(await as(admin).admin_set_icrc3_settings({ ...settings, spill_batch_size: [0n] }))).toMatch(/spill_batch_size/);
    const cfg = (key, old_value, value) => ({ t: 'config_update', caller: P(admin), key, old_value, value });
    const tv = (t) => ({ symbol: t.symbol, name: t.name, decimals: BigInt(t.decimals), fee: t.fee, standard: t.standard });
    expect(strip(await since(mark))).toEqual([
      cfg('feedback_recipients', [], [P(alice), P(bob)]),
      cfg('feedback_bug_topic', 'none', 5n),
      cfg('donation_account', 'none', [P(admin)]),
      cfg('names_canisters', [], [P(carol)]),
      cfg('names_frozen', 0n, 1n),
      cfg('names_frozen', 1n, 0n),
      cfg('sneed_premium_canister_id', 'none', P(eve)),
      cfg('sneed_premium_canister_id', P(eve), 'none'),
      cfg('max_neuron_nicknames', 10n, 20n),
      cfg('max_canisters_per_group', 20n, 30n),
      { t: 'config_update', caller: P(admin), key: 'whitelisted_token', ledger: P(aaaId), value: tv(token) },
      { t: 'config_update', caller: P(admin), key: 'whitelisted_token', ledger: P(aaaId), value: tv({ ...token, fee: 2_000n }), old_value: tv(token) },
      { t: 'config_update', caller: P(admin), key: 'whitelisted_token', ledger: P(aaaId), value: 'removed', old_value: tv({ ...token, fee: 2_000n }) },
      { t: 'config_update', caller: P(admin), key: 'authorized_for_caller_added', value: P(eve) },
      { t: 'config_update', caller: P(admin), key: 'authorized_for_caller_removed', value: P(eve) },
      cfg('blacklisted_words', 0n, 1n),
      cfg('blacklisted_words', 1n, 0n),
      cfg('icrc3_max_live_blocks', 2000n, 3000n),
    ]);
    unwrap(await as(admin).admin_set_icrc3_settings({ ...settings, max_live_blocks: [2000n] }));
  });
});

describe('money', () => {
  it('jailbreak payments: payer, amount, ledger fee, price tier, recipient and ICP block; free, repeated and refused saves append nothing', async () => {
    const mark = await logLength();
    const sub = new Uint8Array(32).fill(9);
    // not enough deposited: refused
    expect(errOf(await as(bob).save_jailbreak_config(SNEED_SNS_ROOT, SECRET.neuron, bob))).toMatch(/Insufficient payment balance/);
    // bob pays the regular price, alice her partner price, dave (an admin who is a person) the admin price: 0, free
    await icp.mint(account(hubId, jailbreakSub(bob)), E8S + ICP_FEE);
    const c1 = unwrap(await as(bob).save_jailbreak_config(SNEED_SNS_ROOT, SECRET.neuron, bob));
    const tx1 = await lastIcpTx();
    expect(unwrap(await as(bob).save_jailbreak_config(SNEED_SNS_ROOT, SECRET.neuron, bob))).toBe(c1); // the same config: no charge
    await icp.mint(account(hubId, jailbreakSub(alice)), E8S / 4n + ICP_FEE);
    const c2 = unwrap(await as(alice).save_jailbreak_config(SNEED_SNS_ROOT, SECRET.neuron, carol));
    const tx2 = await lastIcpTx();
    unwrap(await as(dave).save_jailbreak_config(SNEED_SNS_ROOT, SECRET.neuron, dave)); // admin price 0: nothing charged
    expect(await icp.icrc1_balance_of(account(carol, sub))).toBe(E8S + E8S / 4n);
    const logs = unwrap(await as(admin).get_jailbreak_payment_logs(0n, 10n)).logs;
    const to = [P(carol), hex(sub)];
    expect(strip(await since(mark))).toEqual([
      { t: 'jailbreak_payment', caller: P(bob), payment_id: 1n, config_id: c1, amount_e8s: E8S, fee_e8s: ICP_FEE, price_tier: 'regular', to, icp_tx: tx1 },
      { t: 'jailbreak_payment', caller: P(alice), payment_id: 2n, config_id: c2, amount_e8s: E8S / 4n, fee_e8s: ICP_FEE, price_tier: 'partner', to, icp_tx: tx2 },
    ]);
    expect(logs.map((l) => [l.id, l.config_id])).toEqual([[2n, c2], [1n, c1]]);
  });

  it('deposit withdrawals: amount, ledger fee, the caller\'s account and the ICP block; refused ones append nothing', async () => {
    const mark = await logLength();
    await icp.mint(account(hubId, jailbreakSub(eve)), 3n * E8S);
    expect(errOf(await as(eve).withdraw_jailbreak_payment(3n * E8S))).toMatch(/Insufficient balance/);
    const i = unwrap(await as(eve).withdraw_jailbreak_payment(E8S));
    await icp.set_paused(true);
    expect(errOf(await as(eve).withdraw_jailbreak_payment(1n))).toMatch(/Transfer failed/);
    await icp.set_paused(false);
    expect(strip(await since(mark))).toEqual([
      { t: 'deposit_withdraw', caller: P(eve), amount_e8s: E8S, fee_e8s: ICP_FEE, to: [P(eve)], icp_tx: i },
    ]);
  });

  it('admin transfers of tokens and ICPSwap positions: only those the ledger or pool accepted', async () => {
    const mark = await logLength();
    await aaa.mint(account(hubId, principalToSubaccount(alice)), 50_000n);
    const r = unwrap(await as(admin).send_tokens(aaaId, 20_000n, alice));
    expect(errOf(await as(admin).send_tokens(aaaId, 1_000_000n, alice))).toHaveProperty('InsufficientFunds');
    await pool.mint_position(hubId, 7n, 100n);
    unwrap(await as(dave).transfer_position(poolId, alice, 7n));
    expect(errOf(await as(admin).transfer_position(poolId, bob, 7n))).toEqual({ InternalError: 'caller does not own the position' });
    expect(strip(await since(mark))).toEqual([
      { t: 'send_tokens', caller: P(admin), ledger: P(aaaId), from_subaccount: hex(principalToSubaccount(alice)), to: [P(alice)], amount: 20_000n, ledger_tx: r },
      { t: 'transfer_position', caller: P(dave), swap_canister: P(poolId), to: P(alice), position_id: 7n },
    ]);
  });

  it.skipIf(!haveLedger)('donations: donor, token, amount, ledger block and accounts (no message); hiding and showing; refused registrations append nothing', async () => {
    const mark = await logLength();
    await as(admin).add_whitelisted_token({ ledger_id: tokId, decimals: 8, fee: 1_000n, name: 'Token', symbol: 'TOK', standard: 'ICRC1' });
    const sub = new Uint8Array(32).fill(3);
    const tok = actorAs(pic, icrcIdl, tokId, alice);
    const elsewhere = unwrap(await tok.icrc1_transfer({ from_subaccount: [], to: account(bob), amount: E8S, fee: [], memo: [], created_at_time: [] }));
    expect(errOf(await as(alice).register_donation({ ledger: tokId, block_index: elsewhere, from_subaccount: [], message: [] }))).toMatch(/not sent to the donation account/);
    await tok.icrc1_transfer({ from_subaccount: [], to: account(alice, sub), amount: 5n * E8S, fee: [], memo: [], created_at_time: [] });
    const block = unwrap(await tok.icrc1_transfer({ from_subaccount: [sub], to: account(admin), amount: 2n * E8S, fee: [], memo: [], created_at_time: [] }));
    const d = unwrap(await as(alice).register_donation({ ledger: tokId, block_index: block, from_subaccount: [sub], message: [SECRET.message] }));
    expect(errOf(await as(alice).register_donation({ ledger: tokId, block_index: block, from_subaccount: [sub], message: [] }))).toMatch(/already on the wall/);
    unwrap(await as(admin).admin_set_donation_hidden(d.id, true));
    unwrap(await as(admin).admin_set_donation_hidden(d.id, true)); // unchanged
    unwrap(await as(admin).admin_set_donation_hidden(d.id, false));
    expect(errOf(await as(admin).admin_set_donation_hidden(99n, true))).toMatch(/No donation/);
    expect(strip(await since(mark))).toEqual([
      { t: 'config_update', caller: P(admin), key: 'whitelisted_token', ledger: P(tokId), value: { symbol: 'TOK', name: 'Token', decimals: 8n, fee: 1_000n, standard: 'ICRC1' } },
      { t: 'donation', caller: P(alice), donation_id: d.id, ledger: P(tokId), amount: 2n * E8S, ledger_block: block, from: [P(alice), hex(sub)], to: [P(admin)] },
      { t: 'donation_hidden', caller: P(admin), donation_id: d.id, hidden: 1n },
      { t: 'donation_hidden', caller: P(admin), donation_id: d.id, hidden: 0n },
    ]);
  });
});

describe('moderation', () => {
  it('bans with the reason as a hash, unbans, avatars cleared by an admin; refused and no-op calls append nothing', async () => {
    const mark = await logLength();
    unwrap(await as(bob).set_my_avatar('https://avatars.example/bob.png'));
    unwrap(await as(dave).admin_clear_avatar(bob));
    unwrap(await as(dave).admin_clear_avatar(bob)); // none left: nothing to log
    expect(errOf(await as(admin).ban_user(dave, 1n, 'x'))).toMatch(/administrators/);
    unwrap(await as(admin).ban_user(bob, 2n, SECRET.reason));
    const until = (await as(admin).get_banned_users()).ok.find(([p]) => p.toText() === bob.toText())[1];
    expect(errOf(await as(admin).unban_user(eve))).toMatch(/not currently banned/);
    unwrap(await as(dave).unban_user(bob));
    expect(errOf(await as(dave).unban_user(bob))).toMatch(/not currently banned/);
    expect(strip(await since(mark))).toEqual([
      { t: 'avatar_clear', caller: P(dave), principal: P(bob), avatar_sha256: H('https://avatars.example/bob.png') },
      { t: 'ban', caller: P(admin), user: P(bob), duration_hours: 2n, expires_at: until, reason_sha256: H(SECRET.reason) },
      { t: 'unban', caller: P(dave), user: P(bob) },
    ]);
  });
});

describe('what is not logged', () => {
  it('users\' own data and ordinary calls append nothing, and no block carries a private text', async () => {
    const mark = await logLength();
    unwrap(await as(alice).set_my_settings({ ...Object.fromEntries(Object.keys(await as(alice).get_my_settings()).map((k) => [k, []])), denomination_token: [SECRET.denomination] }));
    unwrap(await as(alice).set_principal_nickname(bob, SECRET.nickname));
    await as(alice).register_user_token(aaaId);
    await as(alice).register_tracked_canister(poolId);
    await as(alice).mark_logs_seen(poolId, 5n);
    const c = (await as(alice).get_my_jailbreak_configs())[0].id;
    unwrap(await as(alice).delete_jailbreak_config(c));
    await as(alice).set_cached_token_meta(poolId, { token0: [['symbol', { Text: 'X' }]], token1: [] });
    expect(await logLength()).toBe(mark);
    const all = JSON.stringify(await verifiedLog(), (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    for (const s of Object.values(SECRET)) expect(all).not.toContain(s);
    for (const s of Object.values(SECRET)) expect(all).not.toContain(Buffer.from(s, 'utf8').toString('hex'));
    // the hashed texts are there as hashes
    expect(all).toContain(H(SECRET.reason));
    expect(all).toContain(H(SECRET.description));
  });
});

describe('ingress', () => {
  it('refuses the log queries as update calls and the log\'s admin methods from non-admins at ingress', async () => {
    const u = actorAs(pic, asUpdates(fullIdl), hubId, bob);
    expect((await as(bob).icrc3_log_status()).log_length).toEqual(expect.any(BigInt)); // answered as a query
    expect(await refusedAtIngress(u.icrc3_get_blocks([{ start: 0n, length: 1n }]))).toBe(true);
    expect(await refusedAtIngress(u.icrc3_get_archives({ from: [] }))).toBe(true);
    expect(await refusedAtIngress(u.icrc3_get_tip_certificate())).toBe(true);
    expect(await refusedAtIngress(u.icrc3_supported_block_types())).toBe(true);
    expect(await refusedAtIngress(u.icrc10_supported_standards())).toBe(true);
    expect(await refusedAtIngress(u.icrc3_log_status())).toBe(true);
    expect(await refusedAtIngress(u.get_log(0n, 10n))).toBe(true);
    const settings = { max_live_blocks: [5n], spill_batch_size: [], archive_max_blocks: [], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] };
    expect(await refusedAtIngress(as(bob).admin_set_icrc3_settings(settings))).toBe(true);
    expect(await refusedAtIngress(as(bob).admin_icrc3_spill_now())).toBe(true);
    expect(await refusedAtIngress(as(bob).admin_icrc3_repair_archive_controllers())).toBe(true);
    // an admin's call with an oversized argument is refused too
    expect(await refusedAtIngress(as(admin).admin_set_icrc3_settings({ ...settings, max_live_blocks: [10n ** 20000n] }))).toBe(true);
  });
});

describe('archives', () => {
  it('spill past the live limit into archives co-controlled by SNS root, logged in the public text log, and still verify', async () => {
    const before = await logLength();
    unwrap(await as(admin).admin_set_icrc3_settings({ max_live_blocks: [5n], spill_batch_size: [10n], archive_max_blocks: [20n], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }));
    await advance(15 * 60 + 5, 100); // the 15-minute spill check
    const s = await as(admin).icrc3_log_status();
    expect(Number(s.log_length)).toBe(before + 3); // three settings changed
    expect(s.live_blocks).toBeLessThan(5n);
    expect(s.archives.length).toBeGreaterThanOrEqual(2);
    const archives = await as(bob).icrc3_get_archives({ from: [] });
    expect(archives.map((a) => a.canister_id.toText())).toEqual(s.archives.map((a) => a.canister_id.toText()));
    for (const a of archives) {
      expect((await pic.getControllers(a.canister_id)).map((p) => p.toText()).sort()).toEqual([hubId.toText(), SNEED_SNS_ROOT.toText()].sort());
      expect((await archiveActor(a.canister_id).archive_status()).parent.toText()).toBe(hubId.toText());
    }
    const r = await as(bob).icrc3_get_blocks([{ start: 0n, length: 3n }]);
    expect(r.blocks).toEqual([]);
    expect(r.archived_blocks).toHaveLength(1);
    const blocks = await verifiedLog(); // follows the callbacks into every archive
    expect(blocks).toHaveLength(Number(s.log_length));
    expect(blocks.slice(-3).map((b) => [b.t, b.key, b.caller])).toEqual([
      ['config_update', 'icrc3_max_live_blocks', P(admin)], ['config_update', 'icrc3_spill_batch_size', P(admin)], ['config_update', 'icrc3_archive_max_blocks', P(admin)],
    ]);
    // the text log is public: anyone reads the spill and archive messages
    expect((await as(bob).get_log(0n, 100n)).some((e) => /created archive/.test(e.message))).toBe(true);
  }, 180_000);

  it('spill on demand and repair the archive controllers (admins)', async () => {
    const n = await logLength();
    unwrap(await as(dave).admin_icrc3_spill_now());
    expect((await as(admin).icrc3_log_status()).live_blocks).toBe(0n);
    expect(await verifiedLog()).toHaveLength(n);
    expect((await as(admin).admin_icrc3_repair_archive_controllers()).every(([, x]) => 'Ok' in x)).toBe(true);
    unwrap(await as(admin).admin_set_icrc3_settings({ max_live_blocks: [2000n], spill_batch_size: [500n], archive_max_blocks: [1_000_000n], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }));
  }, 120_000);
});

describe('upgrades', () => {
  it('keep the log, the archives and the certified tip (wasm_memory_persistence = keep)', async () => {
    const before = await as(admin).icrc3_log_status();
    const blocksBefore = await verifiedLog();
    await advance(600);
    await upgradeHub(pic, hubId, admin, wasm(BACKEND_WASM));
    await pic.tick(2);
    expect(await as(admin).icrc3_log_status()).toEqual(before);
    expect(await verifiedLog()).toEqual(blocksBefore); // the tip certificate is republished
    await as(admin).add_admin(eve);
    const blocks = await verifiedLog();
    expect(blocks).toHaveLength(blocksBefore.length + 1);
    expect(blocks.at(-1)).toMatchObject({ t: 'admin_add', principal: P(eve) });
  }, 180_000);

  it('from the production build with keep: admins, directories, fees, special prices, payments and donations stay, and the log starts empty', async () => {
    const oldId = await install(pic, { name: 'app_sneeddao_backend_prod', cycles: 20n * T, targetSubnetId: appSubnet });
    const o = (p) => as(p, oldId);
    await expect(o(alice).icrc3_log_status()).rejects.toThrow(); // the production code has no log
    await o(admin).add_admin(dave);
    unwrap(await o(admin).add_partner('P', 'https://l', 'd', [], []));
    unwrap(await o(admin).add_project('J', [], 'd', { project: null }, [], []));
    unwrap(await o(admin).set_jailbreak_fee_settings([E8S / 2n], [E8S], [[carol]], []));
    unwrap(await o(admin).set_partner_prices(alice, { label: 'A', prices: { jailbreak_fee_e8s: [E8S / 4n] }, expires_at: [] }));
    unwrap(await o(admin).admin_set_feedback_config({ recipients: [alice], bug_topic: [1n], idea_topic: [2n] }));
    unwrap(await o(admin).admin_set_donation_account([account(admin)]));
    await icp.mint(account(oldId, jailbreakSub(bob)), E8S + ICP_FEE);
    unwrap(await o(bob).save_jailbreak_config(SNEED_SNS_ROOT, 'beef', bob));
    unwrap(await o(admin).ban_user(eve, 5n, 'r'));
    unwrap(await o(alice).set_principal_nickname(bob, 'nick'));
    const snapshot = async () => ser({
      admins: await o(admin).get_admins(), partners: await o(admin).get_partners(), projects: await o(admin).get_projects(),
      fees: await o(admin).get_jailbreak_fee_settings(), special: await o(admin).get_special_prices(),
      feedback: await o(admin).get_feedback_config(), donation: await o(admin).get_donation_account(),
      payments: await o(admin).get_jailbreak_payment_logs(0n, 10n), stats: await o(admin).get_jailbreak_payment_stats(),
      configs: await o(bob).get_my_jailbreak_configs(), bans: await o(admin).get_ban_log(), nick: await o(alice).get_principal_nickname(bob),
    });
    const before = await snapshot();
    expect(JSON.parse(before).payments.ok.total).toBe('1');

    await upgradeHub(pic, oldId, admin, wasm(BACKEND_WASM));
    await pic.tick(2);
    expect(await snapshot()).toBe(before);
    expect(await o(alice).icrc3_log_status()).toMatchObject({ log_length: 0n, live_blocks: 0n, archives: [], last_block_hash: [], history_imported: false });
    expect(await o(alice).icrc3_get_tip_certificate()).toEqual([]);

    // the first logged act after the upgrade is block 0, without phash; the log verifies
    await o(dave).remove_admin(dave);
    const blocks = await verifiedLog(oldId);
    expect(strip(blocks)).toEqual([{ t: 'admin_remove', caller: P(dave), principal: P(dave) }]);
    expect((await rawLog(oldId))[0].Map.some(([k]) => k === 'phash')).toBe(false);
  }, 240_000);
});
