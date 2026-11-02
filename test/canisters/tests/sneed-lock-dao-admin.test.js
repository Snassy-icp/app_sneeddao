// Sneed Lock admin actions by DAO proposal (retiring personal admins, step 1): one generic nervous
// system function, target dao_admin, validator validate_dao_admin, as in spec/dao_settings.md.
// SNS governance (canisters/MockProxyGov.mo at the real governance id fi3zi…, calling the validator
// on submission and the target on adoption, as SNS governance does) runs settings, admin-list
// changes, support actions (pool deposit, stranded payment, reconcile) and claim-history clears;
// each has the effect and the ICRC-3 block of its admin method, with caller = governance; the
// validator renders exactly what will happen and refuses what dao_admin would refuse. dao_admin
// refuses every other caller (admin-list members, controllers, anyone; by ingress outright). The
// admin list can be emptied (the last admin removes itself) and governance and controllers stay
// admins. Plus the upgrade from the code before dao_admin (build/sneed_lock_predaoadmin.wasm,
// main at 9bcdf9d0). SNEED_LOCK_WASM=sneed_lock_predaoadmin runs this file against that build.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import {
  createPic, install, actorAs, account, principalToSubaccount, admin, alice, bob, carol, user,
  ICP_LEDGER_ID, SNEED_GOVERNANCE, T, unwrap, errOf, refusedAtIngress, wasm,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit, poolIdl, poolInit } from '../lib/idl.js';
import { btype, tx, txField } from '../lib/icrc3.js';
import { idlFactory as sneedLockIdl } from '../build/sneed_lock.did.js';

const SNEED_LOCK_WASM = process.env.SNEED_LOCK_WASM || 'sneed_lock';
const FN = 6151n; // the proposed GNSF id of Sneed Lock's dao_admin
const ICP_FEE = 10_000n;
const FEE_A = 1_000n;
const FEE_B = 500n;
const DAY_NS = 86_400n * 1_000_000_000n;
const dave = user('dave');
const erin = user('erin');
const frank = user('frank');

const govIdl = ({ IDL }) => {
  const Status = IDL.Variant({ open: IDL.Null, executed: IDL.Text, failed: IDL.Text });
  return IDL.Service({
    add_function: IDL.Func([IDL.Nat, IDL.Record({ target: IDL.Principal, target_method: IDL.Text, validator: IDL.Principal, validator_method: IDL.Text })], [], []),
    submit: IDL.Func([IDL.Nat, IDL.Vec(IDL.Nat8)], [IDL.Variant({ ok: IDL.Tuple(IDL.Nat, IDL.Text), err: IDL.Text })], []),
    pass: IDL.Func([IDL.Nat, IDL.Vec(IDL.Nat8)], [IDL.Variant({ ok: IDL.Tuple(IDL.Nat, Status), err: IDL.Text })], []),
    call_raw: IDL.Func([IDL.Principal, IDL.Text, IDL.Vec(IDL.Nat8)], [IDL.Variant({ ok: IDL.Vec(IDL.Nat8), err: IDL.Text })], []),
  });
};
const Mode = IDL.Variant({ normal: IDL.Null, err: IDL.Null, trap: IDL.Null });
const poolIdlX = ({ IDL }) => IDL.Service({
  ...Object.fromEntries(poolIdl({ IDL })._fields),
  set_deposit_mode: IDL.Func([Mode], [], []),
  set_withdraw_mode: IDL.Func([Mode], [], []),
});
const lockSvc = sneedLockIdl({ IDL });
const method = (name) => lockSvc._fields.find(([n]) => n === name)?.[1];
const payload = (action) => new Uint8Array(IDL.encode(method('dao_admin').argTypes, [action]));
const encodeCall = (name, args) => new Uint8Array(IDL.encode(method(name).argTypes, args));
const decodeReply = (name, bytes) => IDL.decode(method(name).retTypes, new Uint8Array(bytes))[0];
const executed = (r) => unwrap(r)[1].executed;
const failed = (r) => unwrap(r)[1].failed;
const pOf = (v) => Principal.fromUint8Array(new Uint8Array(v.Blob)).toText();
/// A block's tx as plain values, without its correlation id (which differs between any two calls).
const plain = (v) => {
  if ('Nat' in v) return v.Nat;
  if ('Int' in v) return v.Int;
  if ('Text' in v) return v.Text;
  if ('Blob' in v) return Buffer.from(v.Blob).toString('hex');
  if ('Array' in v) return v.Array.map(plain);
  return Object.fromEntries(v.Map.map(([k, x]) => [k, plain(x)]));
};
const body = (b) => { const { cid, ...rest } = plain(tx(b)); return rest; };
const G = SNEED_GOVERNANCE.toText();
const gHex = Buffer.from(SNEED_GOVERNANCE.toUint8Array()).toString('hex');

async function setup(lockWasm = SNEED_LOCK_WASM) {
  const { pic, appSubnet } = await createPic();
  const icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  const tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  const tokenBId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_B, symbol: 'BBB', decimals: 6 }], targetSubnetId: appSubnet });
  const poolId = await install(pic, { name: 'MockSwapPool', initTypes: poolInit, initArgs: [{ token0: tokenAId, token1: tokenBId, fee: 3000n }], targetSubnetId: appSubnet });
  const lockId = await install(pic, { name: lockWasm, cycles: 20n * T, targetSubnetId: appSubnet });
  const govId = await install(pic, { name: 'MockProxyGov', targetCanisterId: SNEED_GOVERNANCE });
  const impostorId = await install(pic, { name: 'MockProxyGov', targetSubnetId: appSubnet });
  await pic.tick(3);
  const fn = { target: lockId, target_method: 'dao_admin', validator: lockId, validator_method: 'validate_dao_admin' };
  const gov = actorAs(pic, govIdl, govId, admin);
  const impostor = actorAs(pic, govIdl, impostorId, admin);
  await gov.add_function(FN, fn);
  await impostor.add_function(FN, fn);
  const env = {
    pic, icpId, tokenAId, tokenBId, poolId, lockId, govId, impostorId, gov, impostor,
    tokenA: actorAs(pic, ledgerIdl, tokenAId, admin),
    tokenB: actorAs(pic, ledgerIdl, tokenBId, admin),
    pool: actorAs(pic, poolIdlX, poolId, admin),
    poolAs: (p) => actorAs(pic, poolIdl, poolId, p),
    lockAs: (p) => actorAs(pic, sneedLockIdl, lockId, p),
    wallet: (p) => account(lockId, principalToSubaccount(p)),
    nowNs: async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n,
    propose: (action) => gov.pass(FN, payload(action)),
  };
  env.lock = env.lockAs(admin);
  env.validate = (action) => env.lockAs(carol).validate_dao_admin(action);
  env.lastBlock = async () => {
    const s = await env.lock.icrc3_log_status();
    return (await env.lock.icrc3_get_blocks([{ start: s.log_length - 1n, length: 1n }])).blocks[0].block;
  };
  env.blocksOfType = async (type) => {
    const s = await env.lock.icrc3_log_status();
    const r = await env.lock.icrc3_get_blocks([{ start: 0n, length: s.log_length }]);
    return r.blocks.map((b) => b.block).filter((b) => btype(b) === type);
  };
  /// Governance calling any Sneed Lock method directly (governance is an admin of the old methods).
  env.govCall = async (name, ...args) => decodeReply(name, unwrap(await gov.call_raw(lockId, name, encodeCall(name, args))));
  return env;
}

/// A position `pos` of `who`, claimed, moved to Sneed Lock and locked for a day.
async function lockedPosition(env, who, pos) {
  await env.pool.mint_position(who, pos, 1_000_000n);
  expect(await env.lockAs(who).claim_position(env.poolId, pos)).toBe(true);
  unwrap(await env.poolAs(who).transferPosition(who, env.lockId, pos));
  return unwrap(await env.lockAs(who).create_position_lock(env.poolId, 1n, pos, (await env.nowNs()) + DAY_NS, env.tokenAId, env.tokenBId, []));
}

describe('dao_admin: settings', () => {
  let env;
  beforeAll(async () => { env = await setup(); }, 120_000);
  afterAll(async () => { await env?.pic.tearDown(); });

  it('the maximum lock length: rendered, bounded, executed with the admin method\'s block (caller = governance)', async () => {
    const act = { set_max_lock_length_days: 30n };
    const text = 'Sneed Lock: maximum lock length 7 d → 30 d [max_lock_length_ns: 604800000000000 → 2592000000000000]. Existing locks keep their expiry.';
    expect(await env.validate(act)).toEqual({ Ok: text });
    expect((await env.validate({ set_max_lock_length_days: 0n })).Err).toBe('the maximum lock length must be 1 to 36500 days');
    expect((await env.validate({ set_max_lock_length_days: 36_501n })).Err).toBe('the maximum lock length must be 1 to 36500 days');
    expect((await env.validate({ set_max_lock_length_days: 7n })).Err).toBe('the maximum lock length is already 7 days');
    expect(executed(await env.propose(act))).toBe(text + '\nResult: done');
    expect((await env.lock.get_lock_limits()).max_lock_length_ns).toBe(30n * DAY_NS);
    const b = await env.lastBlock();
    expect(btype(b)).toBe('sneedlock_config_update');
    expect(body(b)).toEqual({ caller: gHex, key: 'max_lock_length_ns', value: 30n * DAY_NS, old_value: 7n * DAY_NS });
    // the same block as the admin method writes, but for the caller
    await env.lock.set_max_lock_length_days(31n);
    expect(body(await env.lastBlock())).toEqual({ caller: Buffer.from(admin.toUint8Array()).toString('hex'), key: 'max_lock_length_ns', value: 31n * DAY_NS, old_value: 30n * DAY_NS });
  });

  it('lock fees: in ICP, old → new, only the fees given; 0 or at least one ledger fee, at most 10 ICP', async () => {
    const act = { set_lock_fees_icp: { token_lock_fee: [50_000_000n], position_lock_fee: [], premium_token_lock_fee: [], premium_position_lock_fee: [20_000_000n] } };
    const text = 'Sneed Lock: token lock fee 0 → 0.5 ICP [token_lock_fee_icp_e8s: 0 → 50000000]\n' +
      'Sneed Lock: premium position lock fee 0 → 0.2 ICP [premium_position_lock_fee_icp_e8s: 0 → 20000000]';
    expect(await env.validate(act)).toEqual({ Ok: text });
    const fees = (f) => ({ set_lock_fees_icp: { token_lock_fee: [], position_lock_fee: [], premium_token_lock_fee: [], premium_position_lock_fee: [], ...f } });
    expect((await env.validate(fees({}))).Err).toBe('no fee to set');
    expect((await env.validate(fees({ position_lock_fee: [9_999n] }))).Err).toBe('position_lock_fee_icp_e8s: 0 (free) or at least 0.0001 ICP');
    expect((await env.validate(fees({ token_lock_fee: [1_000_000_001n] }))).Err).toBe('token_lock_fee_icp_e8s: at most 10 ICP');
    expect((await env.validate(fees({ token_lock_fee: [0n] }))).Err).toBe('every fee already holds its new value');
    expect(executed(await env.propose(act))).toBe(text + '\nResult: Lock fees updated successfully');
    const f = await env.lock.get_lock_fees_icp();
    expect([f.token_lock_fee_icp_e8s, f.position_lock_fee_icp_e8s, f.premium_token_lock_fee_icp_e8s, f.premium_position_lock_fee_icp_e8s]).toEqual([50_000_000n, 0n, 0n, 20_000_000n]);
    const blocks = (await env.blocksOfType('sneedlock_config_update')).slice(-2).map(body);
    expect(blocks).toEqual([
      { caller: gHex, key: 'token_lock_fee_icp_e8s', value: 50_000_000n, old_value: 0n },
      { caller: gHex, key: 'premium_position_lock_fee_icp_e8s', value: 20_000_000n, old_value: 0n },
    ]);
  });

  it('the fee recipient, the premium canister, admin and partner prices and a rate limit: rendered and executed', async () => {
    const sub = new Uint8Array(32).fill(1);
    const rec = { set_icp_fee_recipient: { recipient_principal: [carol], recipient_subaccount: [sub] } };
    const recText = `Sneed Lock: ICP lock-fee recipient Sneed Lock itself: ${env.lockId.toText()} (default account) → ${carol.toText()} subaccount ${'01'.repeat(32)}. Every lock fee paid from then on goes to the new account.`;
    expect(await env.validate(rec)).toEqual({ Ok: recText });
    expect((await env.validate({ set_icp_fee_recipient: { recipient_principal: [carol], recipient_subaccount: [new Uint8Array(31)] } })).Err).toBe('a subaccount is 32 bytes');
    expect((await env.validate({ set_icp_fee_recipient: { recipient_principal: [Principal.anonymous()], recipient_subaccount: [] } })).Err).toMatch(/anonymous/);
    expect((await env.validate({ set_icp_fee_recipient: { recipient_principal: [], recipient_subaccount: [] } })).Err).toBe('the fee recipient is already that account');
    expect(executed(await env.propose(rec))).toMatch(/Result: Fee recipient set to/);
    const f = await env.lock.get_lock_fees_icp();
    expect(f.fee_recipient_principal[0].toText()).toBe(carol.toText());
    expect(txField(await env.lastBlock(), 'key')).toEqual({ Text: 'icp_fee_recipient' });

    const prem = { set_sneed_premium_canister_id: [bob] };
    expect(await env.validate(prem)).toEqual({ Ok: `Sneed Lock: Sneed Premium canister none → ${bob.toText()}. Premium lock fees go to the members it reports.` });
    expect((await env.validate({ set_sneed_premium_canister_id: [] })).Err).toBe('the Sneed Premium canister is already none');

    const ap = { set_admin_prices: { token_lock_fee_icp_e8s: [100_000n], position_lock_fee_icp_e8s: [] } };
    expect(await env.validate(ap)).toEqual({ Ok: 'Sneed Lock: admin prices (for admins who are people): token lock fee none, position lock fee none → token lock fee 0.001 ICP, position lock fee none' });
    expect((await env.validate({ set_admin_prices: { token_lock_fee_icp_e8s: [5n], position_lock_fee_icp_e8s: [] } })).Err).toBe('token_lock_fee_icp_e8s: 0 (free) or at least 0.0001 ICP');
    expect(executed(await env.propose(ap))).toMatch(/Result: done$/);
    expect((await env.lock.get_special_prices()).admin_prices.token_lock_fee_icp_e8s).toEqual([100_000n]);
    expect(txField(await env.lastBlock(), 'key')).toEqual({ Text: 'admin_prices' });

    const entry = { label: 'Partner game', prices: { token_lock_fee_icp_e8s: [0n], position_lock_fee_icp_e8s: [] }, expires_at: [] };
    const pp = { set_partner_prices: { partner: dave, entry } };
    expect(await env.validate(pp)).toEqual({ Ok: `Sneed Lock: partner prices of ${dave.toText()}: none → "Partner game": token lock fee 0 ICP, position lock fee none, no expiry` });
    expect((await env.validate({ set_partner_prices: { partner: dave, entry: { ...entry, label: ' ' } } })).Err).toBe('a partner needs a label');
    expect((await env.validate({ remove_partner_prices: dave })).Err).toBe(`No partner prices for ${dave.toText()}`);
    executed(await env.propose(pp));
    expect(await env.validate({ remove_partner_prices: dave })).toEqual({ Ok: `Sneed Lock: remove the partner prices of ${dave.toText()} ("Partner game": token lock fee 0 ICP, position lock fee none, no expiry)` });
    executed(await env.propose({ remove_partner_prices: dave }));
    expect((await env.lock.get_special_prices()).partners).toEqual([]);

    const rl = { set_rate_limit: { action: 'create_lock', rule: [{ capacity: 5n, per_minute: 2n }] } };
    expect(await env.validate(rl)).toEqual({ Ok: 'Sneed Lock: rate limit of create_lock: burst 30, 10 a minute → burst 5, 2 a minute' });
    expect((await env.validate({ set_rate_limit: { action: 'nope', rule: [] } })).Err).toMatch(/^Unknown action; the limited actions are create_lock, create_position_lock, claim$/);
    expect((await env.validate({ set_rate_limit: { action: 'claim', rule: [{ capacity: 5n, per_minute: 0n }] } })).Err).toMatch(/per_minute must be/);
    expect((await env.validate({ set_rate_limit: { action: 'claim', rule: [] } })).Err).toBe('the rate limit of claim already is burst 30, 10 a minute');
    executed(await env.propose(rl));
    expect((await env.lock.get_rate_limits()).find(([a]) => a === 'create_lock')[1]).toEqual({ capacity: 5n, per_minute: 2n });
    // the admin method writes the same block (back to the default, so old/new swap)
    unwrap(await env.lock.admin_set_rate_limit('create_lock', []));
    const [viaDao, viaAdmin] = (await env.blocksOfType('sneedlock_config_update')).slice(-2).map(body);
    expect(viaDao).toEqual({ caller: gHex, key: 'rate_limit.create_lock', value: { capacity: 5n, per_minute: 2n }, old_value: { capacity: 30n, per_minute: 10n } });
    expect(viaAdmin).toEqual({ ...viaDao, caller: Buffer.from(admin.toUint8Array()).toString('hex'), value: viaDao.old_value, old_value: viaDao.value });
  });

  it('the ICRC-3 log arms: settings rendered from the library\'s own checks; maintenance refused when there is nothing to do', async () => {
    const st = { set_icrc3_settings: { max_live_blocks: [], spill_batch_size: [50n], archive_max_blocks: [], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] } };
    const cur = (await env.lock.icrc3_log_status()).settings;
    expect(await env.validate(st)).toEqual({ Ok: `Sneed Lock: ICRC-3 setting icrc3_spill_batch_size ${cur.spill_batch_size} → 50` });
    expect((await env.validate({ set_icrc3_settings: { ...st.set_icrc3_settings, spill_batch_size: [0n] } })).Err).toBe('spill_batch_size must be between 1 and 1000');
    executed(await env.propose(st));
    expect((await env.lock.icrc3_log_status()).settings.spill_batch_size).toBe(50n);
    expect(body(await env.lastBlock())).toEqual({ caller: gHex, key: 'icrc3_spill_batch_size', value: 50n, old_value: cur.spill_batch_size });
    expect((await env.validate({ icrc3_import_history: null })).Err).toBe('the history is already imported');
    expect((await env.validate({ icrc3_repair_archive_controllers: null })).Err).toBe('there are no archives');
    expect((await env.validate({ icrc3_reset_archive_registration: bob })).Err).toBe(`${bob.toText()} is not an archive with a registration`);
    expect((await env.validate({ set_icrc3_proposal_neuron: [new Uint8Array(3)] })).Err).toBe('an SNS neuron id is a 32-byte subaccount, got 3 bytes');
    const neuron = { set_icrc3_proposal_neuron: [new Uint8Array(32).fill(0xab)] };
    expect(await env.validate(neuron)).toEqual({ Ok: `Sneed Lock: neuron that proposes archive registrations none (no registration proposals) → ${'ab'.repeat(32)}` });
    executed(await env.propose(neuron));
    expect((await env.lock.icrc3_registration_status()).neuron[0]).toEqual(new Uint8Array(32).fill(0xab));
    expect(await env.validate({ icrc3_spill_now: null })).toEqual({ Ok: expect.stringMatching(/^Sneed Lock: move every live ICRC-3 block \(\d+ now\) to the archive canisters/) });
    expect(executed(await env.propose({ icrc3_register_archives_now: null }))).toMatch(/Result: 0 proposals submitted$/);
  });
});

describe('dao_admin: the admin list, and who may call dao_admin', () => {
  let env;
  beforeAll(async () => { env = await setup(); }, 120_000);
  afterAll(async () => { await env?.pic.tearDown(); });

  it('adds and removes admins with the admin methods\' blocks', async () => {
    expect(await env.validate({ add_admin: dave })).toEqual({ Ok: `Sneed Lock: add ${dave.toText()} to the admin list (0 → 1 admins). An admin can run every admin method without a proposal.` });
    expect((await env.validate({ add_admin: Principal.anonymous() })).Err).toBe('the anonymous principal cannot be an admin');
    expect((await env.validate({ remove_admin: dave })).Err).toBe('Principal is not in the admin list');
    expect(executed(await env.propose({ add_admin: dave }))).toMatch(/\nResult: Admin added successfully$/);
    expect((await env.lock.get_admin_list()).map(String)).toEqual([dave.toText()]);
    const b = await env.lastBlock();
    expect(body(b)).toEqual({ caller: gHex, key: 'admin_added', value: dave.toText() });
    expect((await env.validate({ add_admin: dave })).Err).toBe('Principal is already an admin');
    unwrap(await env.lock.admin_add_admin(erin)); // the admin method, unchanged
    expect(await env.validate({ remove_admin: dave })).toEqual({ Ok: `Sneed Lock: remove ${dave.toText()} from the admin list (2 → 1 admins; left: ${erin.toText()}). SNS governance and the controllers (SNS root) stay admins.` });
    expect(executed(await env.propose({ remove_admin: dave }))).toMatch(/Result: Admin removed successfully$/);
    expect(body(await env.lastBlock())).toEqual({ caller: gHex, key: 'admin_removed', value: dave.toText() });
    expect((await env.lock.get_admin_list()).map(String)).toEqual([erin.toText()]);
  });

  it('is refused by ingress for everyone: an admin-list member, a controller, a user, anonymous', async () => {
    for (const who of [erin, admin, alice, Principal.anonymous(), SNEED_GOVERNANCE]) {
      expect(await refusedAtIngress(env.lockAs(who).dao_admin({ add_admin: frank })), who.toText()).toBe(true);
    }
    // the validator is a query: refused as an update call, answered as a query
    const asUpdate = actorAs(env.pic, ({ IDL }) => IDL.Service({ validate_dao_admin: IDL.Func(method('validate_dao_admin').argTypes, method('validate_dao_admin').retTypes, []) }), env.lockId, alice);
    expect(await refusedAtIngress(asUpdate.validate_dao_admin({ add_admin: frank }))).toBe(true);
    expect(method('validate_dao_admin').annotations).toEqual(['query']);
  });

  it('refuses any canister but Sneed governance, even an admin-list member or a controller', async () => {
    const r = await env.impostor.pass(FN, payload({ add_admin: frank }));
    expect(failed(r)).toMatch(/Only Sneed DAO governance can call dao_admin/);
    unwrap(await env.lock.admin_add_admin(env.impostorId));
    // an admin: the old admin methods accept it ...
    const ok = decodeReply('admin_set_rate_limit', unwrap(await env.impostor.call_raw(env.lockId, 'admin_set_rate_limit', encodeCall('admin_set_rate_limit', ['claim', []]))));
    expect(ok).toEqual({ Ok: null });
    // ... dao_admin does not
    expect(failed(await env.impostor.pass(FN, payload({ add_admin: frank })))).toMatch(/Only Sneed DAO governance/);
    await env.pic.updateCanisterSettings({ canisterId: env.lockId, controllers: [admin, env.impostorId], sender: admin });
    expect(failed(await env.impostor.pass(FN, payload({ add_admin: frank })))).toMatch(/Only Sneed DAO governance/);
    await env.pic.updateCanisterSettings({ canisterId: env.lockId, controllers: [admin], sender: admin });
    unwrap(await env.lock.admin_remove_admin(env.impostorId));
    expect((await env.lock.get_admin_list()).map(String)).not.toContain(frank.toText());
  });

  it('a failing action rejects (the proposal fails with the reason); a re-check at execution refuses what changed meanwhile', async () => {
    const id = unwrap(await env.gov.submit(FN, payload({ add_admin: frank })))[0];
    unwrap(await env.lock.admin_add_admin(frank)); // an admin does it while the proposal is open
    const adopt = actorAs(env.pic, ({ IDL }) => IDL.Service({ adopt: IDL.Func([IDL.Nat], [IDL.Variant({ open: IDL.Null, executed: IDL.Text, failed: IDL.Text })], []) }), env.govId, admin);
    expect((await adopt.adopt(id)).failed).toMatch(/Sneed Lock: Principal is already an admin/);
    // the refusal is in the support log, under governance
    const entries = unwrap(await env.lock.get_log_entries_for(SNEED_GOVERNANCE, { errors: true, before: [], take: [] }));
    expect(entries.some((e) => e.content.includes('dao_admin refused: Principal is already an admin'))).toBe(true);
    unwrap(await env.lock.admin_remove_admin(frank));
  });
});

describe('the admin list can be emptied; governance and controllers stay admins', () => {
  let env;
  beforeAll(async () => { env = await setup(); }, 120_000);
  afterAll(async () => { await env?.pic.tearDown(); });

  it('three listed admins: A removes B, A removes C, then A (the last) removes itself', async () => {
    for (const p of [dave, erin, frank]) unwrap(await env.lock.admin_add_admin(p));
    const A = env.lockAs(dave);
    expect(unwrap(await A.admin_remove_admin(erin))).toBe('Admin removed successfully');
    expect(unwrap(await A.admin_remove_admin(frank))).toBe('Admin removed successfully');
    expect((await env.lock.get_admin_list()).map(String)).toEqual([dave.toText()]);
    expect(unwrap(await A.admin_remove_admin(dave))).toBe('Admin removed successfully');
    expect(await env.lock.get_admin_list()).toEqual([]);
    const blocks = (await env.blocksOfType('sneedlock_config_update')).filter((b) => txField(b, 'key').Text === 'admin_removed').map(body);
    expect(blocks.map((b) => [pOf({ Blob: Buffer.from(b.caller, 'hex') }), b.value])).toEqual([[dave.toText(), erin.toText()], [dave.toText(), frank.toText()], [dave.toText(), dave.toText()]]);
  });

  it('the removed principals are refused', async () => {
    for (const p of [dave, erin, frank]) {
      expect(errOf(await env.lockAs(p).admin_add_admin(p))).toMatch(/Only admins/);
      expect(errOf(await env.lockAs(p).admin_set_rate_limit('claim', []))).toMatch(/Only admins/);
    }
  });

  it('governance is still an admin: dao_admin, and the old admin methods called directly', async () => {
    expect(executed(await env.propose({ set_rate_limit: { action: 'claim', rule: [{ capacity: 7n, per_minute: 7n }] } }))).toMatch(/Result: done$/);
    expect(await env.govCall('admin_set_rate_limit', 'claim', [])).toEqual({ Ok: null });
    expect(await env.govCall('admin_add_admin', dave)).toEqual({ Ok: 'Admin added successfully' });
    expect(await env.govCall('admin_remove_admin', dave)).toEqual({ Ok: 'Admin removed successfully' });
    expect(await env.lock.get_admin_list()).toEqual([]);
  });

  it('a controller is still an admin', async () => {
    unwrap(await env.lock.admin_set_lock_fees_icp([20_000n], [], [], []));
    expect((await env.lock.get_lock_fees_icp()).token_lock_fee_icp_e8s).toBe(20_000n);
    expect(await env.lock.admin_clear_failed_claim_requests()).toBe(0n);
  });
});

describe('dao_admin: support actions', () => {
  let env;
  const POS = 9n;
  beforeAll(async () => {
    env = await setup();
    await lockedPosition(env, bob, POS);
    await env.tokenA.mint(env.wallet(bob), 100_000n);
    await env.tokenB.mint(env.wallet(bob), 100_000n);
    await env.pic.tick(5); // the symbol fill of the pool's ledgers
  }, 120_000);
  afterAll(async () => { await env?.pic.tearDown(); });
  const strandedOf = (p) => env.lock.get_stranded({ owner: [p], unpaid_only: false, prev: [], take: [] });

  it('pays a stranded record (deposit, then withdrawal) to its owner\'s Sneed wallet, with the admin method\'s blocks', async () => {
    await env.pool.set_deposit_mode({ err: null });
    errOf(await env.lockAs(bob).add_liquidity_to_locked_position(env.poolId, POS, 0n, 8_000n));
    await env.pool.set_deposit_mode({ normal: null });
    const rec = (await strandedOf(bob)).at(-1);
    expect(rec).toMatchObject({ amount: 8_000n, held_in: { deposit_subaccount: null }, status: { Open: null } });
    const act = { withdraw_stranded_to_owner: { stranded_id: rec.id, amount: [], outcome_checked: false } };
    const wallet = `${env.lockId.toText()} subaccount ${Buffer.from(principalToSubaccount(bob)).toString('hex')}`;
    const v = await env.validate(act);
    expect(v.Ok).toBe(`Sneed Lock: pay stranded record ${rec.id}: 0.008 BBB [8000 base units of ledger ${env.tokenBId.toText()}] (recorded 8000, open) from Sneed Lock's deposit subaccount (deposited first) at pool ${env.poolId.toText()} to its owner, into the Sneed wallet of ${bob.toText()} (${wallet}); the pool takes the ledger fee. Recorded reason: ${rec.reason}`);
    expect((await env.validate({ withdraw_stranded_to_owner: { stranded_id: rec.id, amount: [8_001n], outcome_checked: false } })).Err).toBe('At most the recorded amount 8000');
    expect((await env.validate({ withdraw_stranded_to_owner: { stranded_id: 999n, amount: [], outcome_checked: false } })).Err).toBe('No stranded record 999');
    const before = await env.tokenB.icrc1_balance_of(env.wallet(bob));
    const out = executed(await env.propose(act));
    expect(out.startsWith(v.Ok + '\nResult: paid ')).toBe(true);
    const credited = 8_000n - FEE_B;
    expect(await env.tokenB.icrc1_balance_of(env.wallet(bob))).toBe(before + credited - FEE_B);
    const paid = (await strandedOf(bob)).at(-1);
    expect(paid.status.Paid.by.toText()).toBe(G);
    const [dep] = (await env.blocksOfType('sneedlock_admin_pool_deposit')).slice(-1);
    expect(body(dep)).toMatchObject({ caller: gHex, amount: 8_000n, credited, stranded_id: rec.id });
    const [settle] = (await env.blocksOfType('sneedlock_stranded_settle')).slice(-1);
    expect(body(settle)).toMatchObject({ caller: gHex, stranded_id: rec.id, amount: credited });
    expect((await env.validate(act)).Err).toMatch(/was already paid/);
  });

  it('a payment that fails at execution rejects: the proposal fails with the pool\'s reason, logged for support', async () => {
    await env.pool.set_use_percent(50n);
    await env.pool.set_withdraw_mode({ err: null });
    errOf(await env.lockAs(bob).add_liquidity_to_locked_position(env.poolId, POS, 10_000n, 0n));
    const rec = (await strandedOf(bob)).at(-1);
    expect(rec.held_in).toEqual({ pool_account: null });
    const act = { withdraw_stranded_to_owner: { stranded_id: rec.id, amount: [], outcome_checked: false } };
    expect((await env.validate(act)).Ok).toMatch(/AAA .* from Sneed Lock's unused balance in pool /);
    expect(failed(await env.propose(act))).toMatch(/\nFailed: pool withdrawal failed/);
    const entries = unwrap(await env.lock.get_log_entries_for(SNEED_GOVERNANCE, { errors: true, before: [], take: [] }));
    expect(entries.some((e) => e.content.startsWith('dao_admin failed: pool withdrawal failed'))).toBe(true);
    await env.pool.set_withdraw_mode({ normal: null });
    await env.pool.set_use_percent(100n);
    expect(executed(await env.propose(act))).toMatch(/Result: paid/);
  });

  it('re-runs a pool deposit into Sneed Lock\'s pool account', async () => {
    await env.tokenA.mint(account(env.poolId, principalToSubaccount(env.lockId)), 5_000n);
    const act = { pool_deposit: { swap_canister_id: env.poolId, token_ledger: env.tokenAId, amount: 5_000n } };
    expect((await env.validate(act)).Ok).toBe(`Sneed Lock: re-run the deposit of 0.00005 AAA [5000 base units of ledger ${env.tokenAId.toText()}] at pool ${env.poolId.toText()}: from Sneed Lock's deposit subaccount there into Sneed Lock's unused balance in the pool (the pool takes the ledger fee). Nothing leaves Sneed Lock's accounts; pay it out with a stranded record or an admin withdrawal.`);
    expect((await env.validate({ pool_deposit: { ...act.pool_deposit, amount: 0n } })).Err).toBe('the amount must be above 0');
    const unknown = Principal.fromText('aaaaa-aa');
    expect((await env.validate({ pool_deposit: { ...act.pool_deposit, token_ledger: unknown } })).Ok).toContain('5000 base units of ledger aaaaa-aa (symbol and decimals not known to Sneed Lock)');
    const before = unwrap(await env.pool.getUserUnusedBalance(env.lockId)).balance0;
    expect(executed(await env.propose(act))).toMatch(/Result: 4000 credited$/);
    expect(unwrap(await env.pool.getUserUnusedBalance(env.lockId)).balance0).toBe(before + 4_000n);
    expect(body(await env.lastBlock())).toEqual({ caller: gHex, pool: Buffer.from(env.poolId.toUint8Array()).toString('hex'), ledger: Buffer.from(env.tokenAId.toUint8Array()).toString('hex'), amount: 5_000n, credited: 4_000n });
  });

  it('clears the claim history (completed and failed), with the admin methods\' blocks', async () => {
    await lockedPosition(env, alice, 3n);
    await env.tokenA.mint(account(env.poolId), 1_000_000n);
    await env.tokenB.mint(account(env.poolId), 1_000_000n);
    for (let i = 0; i < 2; i++) {
      await env.pool.set_tokens_owed(3n, 10_000n, 10_000n);
      unwrap(await env.lockAs(alice).claim_position_fees(env.poolId, 3n));
    }
    const q = { failed: false, prev: [], take: [] };
    const n = BigInt((await env.lock.get_claim_requests_page(q)).length);
    expect(n).toBe(2n);
    expect(await env.validate({ clear_completed_claim_requests: null })).toEqual({ Ok: 'Sneed Lock: delete the 2 completed claim requests from the claim history (their ICRC-3 blocks stay)' });
    expect((await env.validate({ clear_failed_claim_requests: null })).Err).toBe('there are no failed claim requests to clear');
    expect(executed(await env.propose({ clear_completed_claim_requests: null }))).toMatch(/Result: 2 cleared$/);
    expect(await env.lock.get_claim_requests_page(q)).toEqual([]);
    expect(body(await env.lastBlock())).toEqual({ caller: gHex, key: 'claim_history_cleared', value: 2n });
    expect((await env.validate({ clear_completed_claim_requests: null })).Err).toBe('there are no completed claim requests to clear');
  });
});

describe('dao_admin: reconcile_token_lock with the admin\'s choice of side', () => {
  let pic, lockId, tokenId, token, gov, lockAs;
  const L = 1_000_000n;
  const rejLedgerIdl = ({ IDL }) => IDL.Service({
    mint: IDL.Func([IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) }), IDL.Nat], [], []),
    set_mode: IDL.Func([IDL.Variant({ normal: IDL.Null, reject_before: IDL.Null, reject_after: IDL.Null })], [], []),
    set_dedupe: IDL.Func([IDL.Bool], [], []),
  });
  beforeAll(async () => {
    let appSubnet;
    ({ pic, appSubnet } = await createPic());
    await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
    tokenId = await install(pic, { name: 'MockRejectLedger', initTypes: ledgerInit, initArgs: [{ fee: 1_000n, symbol: 'REJ', decimals: 8 }], targetSubnetId: appSubnet });
    lockId = await install(pic, { name: SNEED_LOCK_WASM, cycles: 20n * T, targetSubnetId: appSubnet });
    const govId = await install(pic, { name: 'MockProxyGov', targetCanisterId: SNEED_GOVERNANCE });
    await pic.tick(3);
    token = actorAs(pic, rejLedgerIdl, tokenId, admin);
    await token.set_dedupe(true);
    gov = actorAs(pic, govIdl, govId, admin);
    await gov.add_function(FN, { target: lockId, target_method: 'dao_admin', validator: lockId, validator_method: 'validate_dao_admin' });
    lockAs = (p) => actorAs(pic, sneedLockIdl, lockId, p);
  }, 120_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('renders both holders and the side to keep; executes through the same code (the balances decide here)', async () => {
    await token.mint(account(lockId, principalToSubaccount(alice)), L + 1_000n);
    const now = BigInt(Math.round(await pic.getTime())) * 1_000_000n;
    const id = unwrap(await lockAs(alice).create_lock(L, tokenId, now + 3n * DAY_NS, []));
    await token.set_mode({ reject_after: null });
    errOf(await lockAs(alice).transfer_token_lock_ownership(bob, tokenId, id));
    await token.set_mode({ normal: null });
    const validate = (a) => lockAs(carol).validate_dao_admin(a);
    expect((await validate({ reconcile_token_lock: { lock_id: id, keep: carol } })).Err).toMatch(/^The side to keep must be one of the lock's holders: /);
    expect((await validate({ reconcile_token_lock: { lock_id: 999n, keep: bob } })).Err).toBe('No live token lock 999');
    const v = (await validate({ reconcile_token_lock: { lock_id: id, keep: bob } })).Ok;
    expect(v).toMatch(new RegExp(`^Sneed Lock: reconcile token lock ${id} \\(0\\.01 REJ \\[1000000 base units of ledger ${tokenId.toText()}\\]\\), held by both `));
    expect(v).toContain(`keep it with ${bob.toText()} and release it from ${alice.toText()}`);
    const out = executed(await gov.pass(FN, payload({ reconcile_token_lock: { lock_id: id, keep: bob } })));
    expect(out).toMatch(new RegExp(`Result: kept by ${bob.toText()} \\(balances`));
    const s = await lockAs(admin).icrc3_log_status();
    const b = (await lockAs(admin).icrc3_get_blocks([{ start: s.log_length - 1n, length: 1n }])).blocks[0].block;
    expect(btype(b)).toBe('sneedlock_token_lock_reconcile');
    expect(pOf(txField(b, 'caller'))).toBe(G);
    expect((await validate({ reconcile_token_lock: { lock_id: id, keep: bob } })).Err).toBe(`token lock ${id} is held by one party: nothing to reconcile`);
  });
});

describe('upgrade from the code before dao_admin', () => {
  let env;
  beforeAll(async () => { env = await setup('sneed_lock_predaoadmin'); }, 120_000);
  afterAll(async () => { await env?.pic.tearDown(); });

  it('keeps the admin list, fees, prices and locks; dao_admin works after it', async () => {
    await env.tokenA.mint(env.wallet(alice), 1_000_000n);
    const lockIdBefore = unwrap(await env.lockAs(alice).create_lock(500_000n, env.tokenAId, (await env.nowNs()) + DAY_NS, []));
    unwrap(await env.lock.admin_add_admin(dave));
    unwrap(await env.lock.admin_set_lock_fees_icp([30_000n], [40_000n], [], []));
    await env.lock.set_admin_prices({ token_lock_fee_icp_e8s: [15_000n], position_lock_fee_icp_e8s: [] });
    const logBefore = (await env.lock.icrc3_log_status()).log_length;
    expect(method('dao_admin')).toBeDefined();
    await env.pic.upgradeCanister({ sender: admin, canisterId: env.lockId, wasm: wasm('sneed_lock'), arg: IDL.encode([], []) });
    expect((await env.lock.get_admin_list()).map(String)).toEqual([dave.toText()]);
    const f = await env.lock.get_lock_fees_icp();
    expect([f.token_lock_fee_icp_e8s, f.position_lock_fee_icp_e8s]).toEqual([30_000n, 40_000n]);
    expect((await env.lock.get_special_prices()).admin_prices.token_lock_fee_icp_e8s).toEqual([15_000n]);
    expect((await env.lock.get_token_lock_by_id(lockIdBefore)).length).toBe(1);
    expect((await env.lock.icrc3_log_status()).log_length).toBe(logBefore);
    expect(executed(await env.propose({ remove_admin: dave }))).toMatch(/Result: Admin removed successfully$/);
    expect(await env.lock.get_admin_list()).toEqual([]);
  });
});
