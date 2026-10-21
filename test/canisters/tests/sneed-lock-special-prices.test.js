// Special prices in sneed_lock (spec/special_prices.md): next to the regular and premium ICP lock
// fees, an admin price (admins who are people) and partner prices (per principal, public label,
// optional expiry). The lowest applicable price is charged; each payment records its price tier
// (`price_tier` in the sneedlock_fee_pay block, admin_get_payment_price_tiers); every change is a
// sneedlock_config_update block. With nothing set, fees are exactly as before. An upgrade from the
// production source (f9d8db0b, build/sneed_lock_presp.wasm) keeps fees and payments and starts
// with no special prices.
// SNEED_LOCK_WASM=sneed_lock_presp npx vitest run tests/sneed-lock-special-prices.test.js runs it
// against the production code (the special-price tests fail there).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import {
  createPic, install, actorAs, account, principalToSubaccount, paymentSubaccount,
  admin, alice, bob, carol, user, ICP_LEDGER_ID, SNEED_GOVERNANCE, T, unwrap, errOf, wasm,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit, premiumIdl } from '../lib/idl.js';
import { archiveIdl, btype, txField, fetchBlocks } from '../lib/icrc3.js';
import { idlFactory as sneedLockIdl } from '../build/sneed_lock.did.js';

const LOCK_WASM = process.env.SNEED_LOCK_WASM || 'sneed_lock';
const ICP_FEE = 10_000n;
const M = 1_000_000n; // 0.01 ICP
const REG_TOKEN = 50n * M, REG_POS = 100n * M, PREM_TOKEN = 20n * M, PREM_POS = 40n * M;
const dave = user('dave'); // on the admin list, a person
const eve = user('eve'); // partner with an expiry
const HOUR_NS = 3_600_000_000_000n;

let pic, appSubnet, icpId, tokenId, premiumId, lockId;
let icp, token, lock;
const as = (p) => actorAs(pic, sneedLockIdl, lockId, p);
const archiveActor = (id) => actorAs(pic, archiveIdl, id, admin);
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const lastBlocks = async (n) => {
  const s = await lock.icrc3_log_status();
  const blocks = await fetchBlocks(lock, archiveActor, s.log_length - BigInt(n), s.log_length - 1n);
  return [...blocks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, b]) => b);
};
const lastBlock = async () => (await lastBlocks(1))[0];
const noPrices = { token_lock_fee_icp_e8s: [], position_lock_fee_icp_e8s: [] };
const prices = (tok, pos) => ({ token_lock_fee_icp_e8s: tok === null ? [] : [tok], position_lock_fee_icp_e8s: pos === null ? [] : [pos] });

/// Creates a token lock as `p` with plenty of ICP in its payment subaccount; answers what the fee
/// took from it and the price tier of the fee block (null when no fee was charged).
async function lockAndPay(p) {
  await token.mint(account(lockId, principalToSubaccount(p)), 1_000n);
  await icp.mint(account(lockId, paymentSubaccount(p)), 200n * M);
  const before = await icp.icrc1_balance_of(account(lockId, paymentSubaccount(p)));
  const expiry = (await nowNs()) + HOUR_NS;
  const before_len = (await lock.icrc3_log_status()).log_length;
  unwrap(await as(p).create_lock(1_000n, tokenId, expiry, []));
  const paid = before - (await icp.icrc1_balance_of(account(lockId, paymentSubaccount(p))));
  const after_len = (await lock.icrc3_log_status()).log_length;
  const blocks = await lastBlocks(Number(after_len - before_len));
  const pay = blocks.find((b) => btype(b) === 'sneedlock_fee_pay');
  return { paid, tier: pay ? txField(pay, 'price_tier')?.Text ?? '(none)' : null, pay };
}

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  tokenId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 10n, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  premiumId = await install(pic, { name: 'MockPremium', targetSubnetId: appSubnet });
  lockId = await install(pic, { name: LOCK_WASM, cycles: 20n * T, targetSubnetId: appSubnet });
  icp = actorAs(pic, ledgerIdl, icpId, admin);
  token = actorAs(pic, ledgerIdl, tokenId, admin);
  lock = as(admin);
  await pic.tick(2);
  unwrap(await lock.admin_set_sneed_premium_canister_id([premiumId]));
  unwrap(await lock.admin_set_lock_fees_icp([REG_TOKEN], [REG_POS], [PREM_TOKEN], [PREM_POS]));
  unwrap(await lock.admin_add_admin(dave));
  const premium = actorAs(pic, premiumIdl, premiumId, admin);
  await premium.set_member(bob, (await nowNs()) + 1000n * 86_400n * 1_000_000_000n);
});

afterAll(async () => { await pic?.tearDown(); });

describe('defaults (nothing set)', () => {
  it('charges regular and premium fees exactly as before', async () => {
    expect((await lock.getEffectiveLockFee(alice, false)).fee_e8s).toBe(REG_TOKEN);
    expect((await lock.getEffectiveLockFee(alice, true)).fee_e8s).toBe(REG_POS);
    expect((await lock.getEffectiveLockFee(bob, false)).fee_e8s).toBe(PREM_TOKEN);
    expect((await lock.getEffectiveLockFee(dave, false)).fee_e8s).toBe(REG_TOKEN); // admin, but no admin price set
    expect((await lockAndPay(alice)).paid).toBe(REG_TOKEN);
    expect((await lockAndPay(bob)).paid).toBe(PREM_TOKEN);
    expect((await lockAndPay(dave)).paid).toBe(REG_TOKEN);
  });

  it('has no special prices and records the tier of each payment', async () => {
    const sp = await lock.get_special_prices();
    expect(sp.admin_prices).toEqual(noPrices);
    expect(sp.partners).toEqual([]);
    const forDave = await lock.get_special_prices_for(dave);
    expect(forDave.admin_prices).toEqual([noPrices]); // dave is an admin, nothing set
    expect(forDave.partner).toEqual([]);
    expect((await lock.get_special_prices_for(alice)).admin_prices).toEqual([]);
    const a = await lockAndPay(alice);
    expect(a.tier).toBe('regular');
    expect((await lockAndPay(bob)).tier).toBe('premium');
    const log = await lock.admin_get_payment_log(0n, 2n);
    const tiers = await lock.admin_get_payment_price_tiers(log.payments.map((p) => p.id));
    expect(tiers.map(([, t]) => t[0])).toEqual(['premium', 'regular']); // newest first
  });
});

describe('who may set', () => {
  it('refuses non-admins', async () => {
    expect(errOf(await as(alice).set_admin_prices(prices(1n, 1n)))).toMatch(/Only admins/);
    expect(errOf(await as(alice).set_partner_prices(alice, { label: 'me', prices: prices(1n, 1n), expires_at: [] }))).toMatch(/Only admins/);
    expect(errOf(await as(alice).remove_partner_prices(carol))).toMatch(/Only admins/);
    expect((await lock.get_special_prices()).partners).toEqual([]);
  });

  it('validates partner entries', async () => {
    expect(errOf(await lock.set_partner_prices(Principal.anonymous(), { label: 'x', prices: noPrices, expires_at: [] }))).toMatch(/anonymous/);
    expect(errOf(await lock.set_partner_prices(carol, { label: '  ', prices: noPrices, expires_at: [] }))).toMatch(/label/);
    expect(errOf(await lock.set_partner_prices(carol, { label: 'x'.repeat(101), prices: noPrices, expires_at: [] }))).toMatch(/at most 100/);
    expect(errOf(await lock.set_partner_prices(carol, { label: 'x', prices: noPrices, expires_at: [(await nowNs()) - 1n] }))).toMatch(/past/);
    expect(errOf(await lock.set_admin_prices(prices(1n << 64n, null)))).toMatch(/64 bits/);
    expect(errOf(await lock.remove_partner_prices(carol))).toMatch(/No partner prices/);
  });
});

describe('admin price', () => {
  it('applies to admins who are people, logged as a config change', async () => {
    unwrap(await lock.set_admin_prices(prices(M, null)));
    const b = await lastBlock();
    expect(btype(b)).toBe('sneedlock_config_update');
    expect(txField(b, 'key')).toEqual({ Text: 'admin_prices' });
    expect(txField(b, 'value')).toEqual({ Map: [['token_lock_fee_icp_e8s', { Nat: M }]] });
    expect(txField(b, 'old_value')).toEqual({ Map: [] });
    const d = await lockAndPay(dave);
    expect(d.paid).toBe(M);
    expect(d.tier).toBe('admin');
    expect(txField(d.pay, 'fee_e8s')).toEqual({ Nat: M });
    expect((await lock.getEffectiveLockFee(dave, true)).fee_e8s).toBe(REG_POS); // no admin position price
  });

  it('does not apply to others, nor to canisters on the admin list', async () => {
    expect((await lockAndPay(alice)).paid).toBe(REG_TOKEN);
    expect((await lockAndPay(bob)).paid).toBe(PREM_TOKEN);
    expect((await lock.get_special_prices_for(SNEED_GOVERNANCE)).admin_prices).toEqual([]); // governance is an admin, not a person
    expect((await lock.getEffectiveLockFee(SNEED_GOVERNANCE, false)).fee_e8s).toBe(REG_TOKEN);
    unwrap(await lock.set_admin_prices(noPrices));
    expect((await lockAndPay(dave)).paid).toBe(REG_TOKEN);
  });
});

describe('partner prices', () => {
  it('apply to that principal only, logged with the partner', async () => {
    unwrap(await lock.set_partner_prices(carol, { label: 'a partner game canister', prices: prices(5n * M, null), expires_at: [] }));
    const b = await lastBlock();
    expect(txField(b, 'key')).toEqual({ Text: 'partner_prices' });
    expect(txField(b, 'partner')).toEqual({ Blob: carol.toUint8Array() });
    expect(txField(b, 'value')).toEqual({ Map: [['label', { Text: 'a partner game canister' }], ['prices', { Map: [['token_lock_fee_icp_e8s', { Nat: 5n * M }]] }]] });
    const c = await lockAndPay(carol);
    expect(c.paid).toBe(5n * M);
    expect(c.tier).toBe('partner');
    expect((await lock.getEffectiveLockFee(carol, true)).fee_e8s).toBe(REG_POS); // position fee not overridden
    expect((await lockAndPay(alice)).paid).toBe(REG_TOKEN);
    const sp = await lock.get_special_prices();
    expect(sp.partners.map((p) => [p.principal.toText(), p.label])).toEqual([[carol.toText(), 'a partner game canister']]);
    expect((await lock.get_special_prices_for(carol)).partner[0].label).toBe('a partner game canister');
  });

  it('the lowest price wins', async () => {
    unwrap(await lock.set_partner_prices(bob, { label: 'premium partner', prices: prices(30n * M, null), expires_at: [] }));
    const b1 = await lockAndPay(bob);
    expect([b1.paid, b1.tier]).toEqual([PREM_TOKEN, 'premium']); // premium 20 < partner 30
    unwrap(await lock.set_partner_prices(bob, { label: 'premium partner', prices: prices(10n * M, null), expires_at: [] }));
    expect(txField(await lastBlock(), 'old_value').Map[1][1]).toEqual({ Map: [['token_lock_fee_icp_e8s', { Nat: 30n * M }]] });
    const b2 = await lockAndPay(bob);
    expect([b2.paid, b2.tier]).toEqual([10n * M, 'partner']);
    // an admin who is also a partner: the lower of the two
    unwrap(await lock.set_admin_prices(prices(3n * M, null)));
    unwrap(await lock.set_partner_prices(dave, { label: 'admin partner', prices: prices(4n * M, null), expires_at: [] }));
    const d = await lockAndPay(dave);
    expect([d.paid, d.tier]).toEqual([3n * M, 'admin']);
    unwrap(await lock.set_admin_prices(noPrices));
    unwrap(await lock.remove_partner_prices(dave));
    unwrap(await lock.remove_partner_prices(bob));
  });

  it('respect the expiry', async () => {
    const until = (await nowNs()) + HOUR_NS;
    unwrap(await lock.set_partner_prices(eve, { label: 'trial', prices: prices(2n * M, 2n * M), expires_at: [until] }));
    expect(txField(await lastBlock(), 'value').Map[2]).toEqual(['expires_at', { Int: until }]);
    expect((await lockAndPay(eve)).paid).toBe(2n * M);
    await pic.advanceTime(2 * 3600 * 1000);
    await pic.tick();
    expect((await lockAndPay(eve)).paid).toBe(REG_TOKEN);
    expect((await lock.get_special_prices_for(eve)).partner).toEqual([]);
    const listed = (await lock.get_special_prices()).partners.find((p) => p.principal.toText() === eve.toText());
    expect(listed.expires_at).toEqual([until]); // still listed, with its expiry
  });

  it('can be removed', async () => {
    unwrap(await lock.remove_partner_prices(carol));
    const b = await lastBlock();
    expect(txField(b, 'key')).toEqual({ Text: 'partner_prices' });
    expect(txField(b, 'value')).toEqual({ Text: 'removed' });
    expect((await lockAndPay(carol)).paid).toBe(REG_TOKEN);
  });
});

describe('upgrade from the production code', () => {
  it('keeps fees and payments and starts with no special prices', async () => {
    const id = await install(pic, { name: 'sneed_lock_presp', cycles: 20n * T, targetSubnetId: appSubnet });
    const old = actorAs(pic, sneedLockIdl, id, admin);
    await pic.tick(2);
    unwrap(await old.admin_set_sneed_premium_canister_id([premiumId]));
    unwrap(await old.admin_set_lock_fees_icp([REG_TOKEN], [REG_POS], [PREM_TOKEN], [PREM_POS]));
    await token.mint(account(id, principalToSubaccount(alice)), 1_000n);
    await icp.mint(account(id, paymentSubaccount(alice)), 100n * M);
    unwrap(await actorAs(pic, sneedLockIdl, id, alice).create_lock(1_000n, tokenId, (await nowNs()) + HOUR_NS, []));
    const fees = await old.get_lock_fees_icp();
    const log = await old.admin_get_payment_log(0n, 10n);
    const status = await old.icrc3_log_status();
    await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(LOCK_WASM), arg: IDL.encode([], []) });
    await pic.tick(2);
    expect(await old.get_lock_fees_icp()).toEqual(fees);
    expect(await old.admin_get_payment_log(0n, 10n)).toEqual(log);
    expect((await old.icrc3_log_status()).log_length).toBe(status.log_length);
    const sp = await old.get_special_prices();
    expect(sp).toEqual({ admin_prices: noPrices, partners: [] });
    expect(await old.admin_get_payment_price_tiers([log.payments[0].id])).toEqual([[log.payments[0].id, []]]); // paid before: unknown
    expect((await old.getEffectiveLockFee(alice, false)).fee_e8s).toBe(REG_TOKEN);
    expect((await old.getEffectiveLockFee(bob, false)).fee_e8s).toBe(PREM_TOKEN);
  });
});
