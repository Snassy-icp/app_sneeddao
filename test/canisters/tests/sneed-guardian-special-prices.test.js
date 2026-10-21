// sneed_guardian special prices (spec/special_prices.md): an admin price and partner prices for
// the op fee, next to the regular and premium fees. Defaults change nothing; the admin price is for
// admins who are people (never a canister on the admin list); a partner price only for that
// principal and until its expiry; the lowest applicable fee wins; only admins (or the approver
// when it alone is the threshold) set them; every change is a guardian_config_update block and
// staged ops and swept fees carry price_tier; an upgrade from the code before special prices
// (build/sneed_guardian_presp.wasm, commit f9d8db0b) keeps its ops and starts with none.
// GUARDIAN_WASM=sneed_guardian_presp npx vitest run tests/sneed-guardian-special-prices.test.js
// runs it against that code (where the special-price tests fail).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, account, admin, alice, bob, carol, user, T, unwrap, errOf, BUILD, wasm, refusedAtIngress } from '../lib/pic.js';
import { ledgerIdl, ledgerInit, snsWasmIdl, premiumIdl } from '../lib/idl.js';
import { btype, txField } from '../lib/icrc3.js';
import { idlFactory as guardianIdl, init as guardianInit } from '../build/sneed_guardian.did.js';

const GUARDIAN_WASM = process.env.GUARDIAN_WASM || 'sneed_guardian';
const sha256 = (bytes) => Uint8Array.from(createHash('sha256').update(bytes).digest());
const ICP_FEE = 10_000n;
const ICP = 100_000_000n;
const HOUR = 3600;
const NS = 1_000_000_000n;
const dao = user('dao'); // the approver (a governance canister in production)
const dao2 = user('dao2');
const dave = user('dave');
const partnerCanister = Principal.fromUint8Array(Uint8Array.from([0, 0, 0, 0, 0, 0, 0x30, 0x09, 1, 1])); // "a partner game canister"
const adminCanister = Principal.fromUint8Array(Uint8Array.from([0, 0, 0, 0, 0, 0, 0x30, 0x0a, 1, 1])); // a canister on the admin list
const ledgerV1 = readFileSync(resolve(BUILD, 'MockLedger.wasm'));
const V1 = sha256(ledgerV1);

let pic, icpId, snsWasmId, premiumId, guardianId, childId;
let icp, icpAlice;
const as = (p) => actorAs(pic, guardianIdl, guardianId, p);
const opSub = (id) => { const s = new Uint8Array(32); s[0] = 0x6f; s[1] = 1; let n = BigInt(id); for (let i = 31; i >= 24; i--) { s[i] = Number(n % 256n); n /= 256n; } return s; };
const policy = (over = {}) => ({ guardians: [], vetoes_to_block: 0n, oks_required: 0n, window_ns: 0n, auto_upgrade: false, ...over });
const initArg = (over = {}) => ({ name: 'test guardian', approvers: [dao], threshold: 1n, archive_controllers: [admin], admins: [carol], sneed_premium: [], fee_destination: [account(dave)], icp_ledger: [], sns_wasm: [], ...over });
const stage = (p, payer = []) => as(p).stage_op(childId, { set_policy: policy() }, '', payer).then(unwrap);
const opts = (v) => (v === null ? [] : [v]);
const prices = (fee) => ({ op_fee_e8s: opts(fee) });
const entry = (label, fee, expires = null) => ({ label, prices: prices(fee), expires_at: opts(expires) });
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const tierOf = async (id) => { const t = await as(admin).get_op_price_tier(id); return t.length ? Object.keys(t[0])[0] : null; };
const blocks = async () => (await as(admin).icrc3_get_blocks([{ start: 0n, length: 10_000n }])).blocks.map((b) => b.block);

describe('sneed_guardian special prices', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }] });
    snsWasmId = await install(pic, { name: 'MockSnsWasm' });
    premiumId = await install(pic, { name: 'MockPremium' });
    guardianId = await install(pic, { name: GUARDIAN_WASM, initTypes: guardianInit({ IDL }), initArgs: [initArg({ icp_ledger: [icpId], sns_wasm: [snsWasmId], sneed_premium: [premiumId] })], cycles: 50n * T });
    childId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 1_000n, symbol: 'AAA', decimals: 8 }], controllers: [alice, guardianId], sender: alice, cycles: 5n * T });
    icp = actorAs(pic, ledgerIdl, icpId, admin); icpAlice = actorAs(pic, ledgerIdl, icpId, alice);
    await actorAs(pic, snsWasmIdl, snsWasmId, admin).set_steps([{ ledger: V1, index: V1, archive: V1 }]);
    await actorAs(pic, premiumIdl, premiumId, admin).set_member(bob, (await nowNs()) + 365n * 86_400n * NS);
    await icp.mint(account(alice), 20n * ICP);
    unwrap(await as(admin).refresh_blessed());
    unwrap(await as(alice).register(childId, { ledger: null }, policy(), [], 'AAA ledger'));
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('charges exactly as before by default: regular, premium for members, nothing special for admins', async () => {
    expect((await stage(alice)).fee_e8s).toBe(ICP);
    expect((await stage(bob)).fee_e8s).toBe(ICP / 2n);
    expect((await stage(carol)).fee_e8s).toBe(ICP); // an admin, but no admin price is set
    const sp = await as(alice).get_special_prices();
    expect(sp.admin_prices.op_fee_e8s).toEqual([]);
    expect(sp.partners).toEqual([]);
    const forCarol = await as(alice).get_special_prices_for(carol);
    expect(forCarol.partner).toEqual([]);
    const a = await stage(alice); const b = await stage(bob);
    expect(await tierOf(a.id)).toBe('regular');
    expect(await tierOf(b.id)).toBe('premium');
  });

  it('lets only admins (and the approver that alone is the threshold) set special prices', async () => {
    expect(errOf(await as(alice).set_admin_prices(prices(1_000n)))).toMatch(/admins only/);
    expect(errOf(await as(dao2).set_partner_prices(partnerCanister, entry('a partner game canister', 1n)))).toMatch(/admins only/);
    expect(errOf(await as(bob).remove_partner_prices(partnerCanister))).toMatch(/admins only/);
    // the approver (threshold 1) may: its approval alone already changes the op fee
    unwrap(await as(dao).set_admin_prices(prices(null)));
    expect((await as(alice).get_special_prices()).admin_prices.op_fee_e8s).toEqual([]);
  });

  it('gives the admin price to admins who are people, and only when they pay for themselves', async () => {
    unwrap(await as(carol).set_admin_prices(prices(1_000n)));
    const op = await stage(carol);
    expect(op.fee_e8s).toBe(1_000n);
    expect(await tierOf(op.id)).toBe('admin');
    expect((await stage(alice)).fee_e8s).toBe(ICP);
    expect((await stage(bob)).fee_e8s).toBe(ICP / 2n);
    // carol staging with alice as payer: alice's fee; alice naming carol as payer: carol's admin price is not lent
    expect((await stage(carol, [alice])).fee_e8s).toBe(ICP);
    expect((await stage(alice, [carol])).fee_e8s).toBe(ICP);
    expect((await as(alice).get_special_prices_for(carol)).admin_prices[0].op_fee_e8s).toEqual([1_000n]);
    expect((await as(alice).get_special_prices_for(alice)).admin_prices).toEqual([]);
    // a canister on the admin list never gets it
    unwrap(await as(carol).admin_add_admin(adminCanister));
    expect((await stage(adminCanister)).fee_e8s).toBe(ICP);
    expect((await as(alice).get_special_prices_for(adminCanister)).admin_prices).toEqual([]);
    unwrap(await as(carol).admin_remove_admin(adminCanister));
  });

  it('gives a partner price to that principal only, until it expires', async () => {
    const expires = (await nowNs()) + BigInt(HOUR) * NS;
    unwrap(await as(carol).set_partner_prices(partnerCanister, entry('a partner game canister', 2_000n, expires)));
    const op = await stage(partnerCanister);
    expect(op.fee_e8s).toBe(2_000n);
    expect(await tierOf(op.id)).toBe('partner');
    expect((await stage(alice)).fee_e8s).toBe(ICP);
    const listed = (await as(alice).get_special_prices()).partners;
    expect(listed.length).toBe(1);
    expect(listed[0].principal.toText()).toBe(partnerCanister.toText());
    expect(listed[0].label).toBe('a partner game canister');
    expect(listed[0].prices.op_fee_e8s).toEqual([2_000n]);
    expect(listed[0].expires_at).toEqual([expires]);
    expect((await as(alice).get_special_prices_for(partnerCanister)).partner[0].label).toBe('a partner game canister');
    await pic.advanceTime(2 * HOUR * 1000); await pic.tick(2);
    const later = await stage(partnerCanister);
    expect(later.fee_e8s).toBe(ICP);
    expect(await tierOf(later.id)).toBe('regular');
    expect((await as(alice).get_special_prices_for(partnerCanister)).partner).toEqual([]);
    expect((await as(alice).get_special_prices()).partners.length).toBe(1); // still listed, with its expiry
    unwrap(await as(carol).remove_partner_prices(partnerCanister));
    expect((await as(alice).get_special_prices()).partners).toEqual([]);
  });

  it('charges the lowest applicable fee', async () => {
    // a member with a partner price above the premium fee pays the premium fee
    unwrap(await as(carol).set_partner_prices(bob, entry('partner above premium', 60_000_000n)));
    let op = await stage(bob);
    expect(op.fee_e8s).toBe(ICP / 2n); expect(await tierOf(op.id)).toBe('premium');
    unwrap(await as(carol).set_partner_prices(bob, entry('partner below premium', 40_000_000n)));
    op = await stage(bob);
    expect(op.fee_e8s).toBe(40_000_000n); expect(await tierOf(op.id)).toBe('partner');
    // an admin with a partner entry: the lower of the two
    unwrap(await as(carol).set_partner_prices(carol, entry('admin and partner', 500n)));
    op = await stage(carol);
    expect(op.fee_e8s).toBe(500n); expect(await tierOf(op.id)).toBe('partner');
    unwrap(await as(carol).set_partner_prices(carol, entry('admin and partner', 2_000n)));
    op = await stage(carol);
    expect(op.fee_e8s).toBe(1_000n); expect(await tierOf(op.id)).toBe('admin');
    // a partner entry without an op fee override changes nothing
    unwrap(await as(carol).set_partner_prices(alice, entry('no override', null)));
    op = await stage(alice);
    expect(op.fee_e8s).toBe(ICP); expect(await tierOf(op.id)).toBe('regular');
    for (const p of [bob, carol, alice]) unwrap(await as(carol).remove_partner_prices(p));
  });

  it('validates partner entries', async () => {
    expect(errOf(await as(carol).set_partner_prices(partnerCanister, entry('   ', 1n)))).toMatch(/label/);
    expect(errOf(await as(carol).set_partner_prices(partnerCanister, entry('old', 1n, (await nowNs()) - NS)))).toMatch(/past/);
    expect(errOf(await as(carol).set_partner_prices(Principal.anonymous(), entry('anon', 1n)))).toMatch(/anonymous/);
    expect(await refusedAtIngress(as(carol).set_partner_prices(partnerCanister, entry('x'.repeat(101), 1n)))).toBe(true);
    expect(errOf(await as(carol).remove_partner_prices(partnerCanister))).toMatch(/no partner/);
  });

  it('logs every change as a guardian_config_update block, and price_tier on staged ops and swept fees', async () => {
    unwrap(await as(carol).set_admin_prices(prices(3_000n)));
    unwrap(await as(carol).set_partner_prices(partnerCanister, entry('a partner game canister', 2_500n)));
    unwrap(await as(carol).remove_partner_prices(partnerCanister));
    const op = await stage(carol);
    expect(op.fee_e8s).toBe(3_000n);
    unwrap(await icpAlice.icrc1_transfer({ from_subaccount: [], to: account(guardianId, opSub(op.id)), amount: op.fee_e8s + ICP_FEE, fee: [], memo: [], created_at_time: [] }));
    unwrap(await as(dao).approve_op(op.id));
    const before = await icp.icrc1_balance_of(account(dave));
    unwrap(await as(alice).execute_op(op.id));
    expect((await icp.icrc1_balance_of(account(dave))) - before).toBe(3_000n);
    const all = await blocks();
    const cfg = all.filter((b) => btype(b) === 'guardian_config_update');
    const adminBlock = cfg.filter((b) => txField(b, 'key').Text === 'admin_prices').pop();
    expect(adminBlock.Map.length).toBeGreaterThan(0);
    expect(txField(adminBlock, 'value').Map).toEqual([['op_fee_e8s', { Nat: 3_000n }]]);
    expect(txField(adminBlock, 'old_value').Map).toEqual([['op_fee_e8s', { Nat: 1_000n }]]);
    expect(txField(adminBlock, 'caller').Blob).toBeDefined();
    const partnerBlocks = cfg.filter((b) => txField(b, 'key').Text === 'partner_prices' && Buffer.from(txField(b, 'partner').Blob).equals(Buffer.from(partnerCanister.toUint8Array())));
    const set = partnerBlocks[partnerBlocks.length - 2]; const removed = partnerBlocks[partnerBlocks.length - 1];
    const setValue = Object.fromEntries(txField(set, 'value').Map);
    expect(setValue.label.Text).toBe('a partner game canister');
    expect(setValue.prices.Map).toEqual([['op_fee_e8s', { Nat: 2_500n }]]);
    expect(txField(removed, 'value').Text).toBe('removed');
    const stageBlock = all.filter((b) => btype(b) === 'guardian_op_stage' && txField(b, 'op').Nat === op.id).pop();
    expect(txField(stageBlock, 'price_tier').Text).toBe('admin');
    const feeBlock = all.filter((b) => btype(b) === 'guardian_op_fee' && txField(b, 'op').Nat === op.id).pop();
    expect(txField(feeBlock, 'price_tier').Text).toBe('admin');
    expect(txField(feeBlock, 'amount_e8s').Nat).toBe(3_000n);
    unwrap(await as(carol).set_admin_prices(prices(null)));
  });

  it('upgrades from the code before special prices, keeping ops and starting with none', async () => {
    const init = initArg({ icp_ledger: [icpId], sns_wasm: [snsWasmId], sneed_premium: [premiumId] });
    const oldId = await install(pic, { name: 'sneed_guardian_presp', initTypes: guardianInit({ IDL }), initArgs: [init], cycles: 20n * T });
    const old = actorAs(pic, guardianIdl, oldId, carol);
    const staged = unwrap(await old.stage_op(oldId, { set_config: { op_fee_e8s: [7n], premium_op_fee_e8s: [], fee_destination: [], op_ttl_ns: [], self_window_ns: [], status_interval_s: [], low_cycles_threshold: [], cycle_reserve: [], paused: [], approve_function_id: [] } }, 'before', []));
    unwrap(await old.admin_add_admin(alice));
    const cfgBefore = await old.get_config();
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(GUARDIAN_WASM), arg: IDL.encode(guardianInit({ IDL }), [init]) });
    const neu = actorAs(pic, guardianIdl, oldId, carol);
    const op = (await neu.get_op(staged.id))[0];
    expect(op.memo).toBe('before');
    const cfg = await neu.get_config();
    expect(cfg.admins.map(String)).toEqual(cfgBefore.admins.map(String));
    expect(cfg.op_fee_e8s).toBe(cfgBefore.op_fee_e8s);
    expect(cfg.ops).toBe(cfgBefore.ops);
    const sp = await neu.get_special_prices();
    expect(sp.admin_prices.op_fee_e8s).toEqual([]);
    expect(sp.partners).toEqual([]);
    expect(await neu.get_op_price_tier(staged.id)).toEqual([]); // ops from before have no recorded tier
  });
});
