// Special prices in Sneed Premium (spec/special_prices.md): an admin price and partner prices as
// a share of every ICP tier's price in basis points (`icp_tier_price_bps`, 10_000 = regular).
// A deposit buys the tier whose price for the depositor (special, where one applies) or regular
// price equals it exactly; the price charged is the lowest of regular, admin (admins who are
// persons) and partner (an entry that has not expired). Defaults change nothing; setters are
// admin-only and validated; every change is a premium_config_update block; purchases carry
// price_tier (block field and get_icp_payment_price_tier); an upgrade from the code before special
// prices (build/sneed_premium_presp.wasm, f9d8db0b = production source) keeps everything and
// starts with none.
// PREMIUM_WASM=sneed_premium_presp npx vitest run tests/premium-special-prices.test.js runs it
// against the code before special prices: only the "defaults unchanged" purchase test passes there.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import {
  createPic, install, actorAs, account, principalToSubaccount, admin, alice, bob, carol, user, ICP_LEDGER_ID, T,
  unwrap, errOf, wasm, refusedAtIngress, asUpdates,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { hex } from '../lib/idl-rll.js';
import { archiveIdl, btype, tx, verifyLog } from '../lib/icrc3.js';
import { idlFactory as premiumIdl, init as premiumInit } from '../build/sneed_premium.did.js';

const PREMIUM_WASM = process.env.PREMIUM_WASM || 'sneed_premium';
const ICP = 100_000_000n;
const ICP_FEE = 10_000n;
const SEC = 1_000_000_000n;
const DAY = 86_400n * SEC;
const MONTH = 30n * DAY;
const YEAR = 365n * DAY;
const dave = user('dave'); // a partner
const eve = user('eve');

let pic, rootKey, appSubnet;
let icpId, govId, premiumId;
let icp;

// build/sneed_premium.did.js is the new interface; against the old wasm the new methods reject
const as = (p, id = premiumId) => actorAs(pic, premiumIdl, id, p);
const P = (p) => hex(p.toUint8Array());
const plain = (v) => {
  if ('Nat' in v) return v.Nat;
  if ('Int' in v) return v.Int;
  if ('Text' in v) return v.Text;
  if ('Blob' in v) return hex(v.Blob);
  if ('Array' in v) return v.Array.map(plain);
  return Object.fromEntries(v.Map.map(([k, x]) => [k, plain(x)]));
};
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const advance = async (ns, ticks = 2) => { await pic.advanceTime(Number(ns / 1_000_000n)); await pic.tick(ticks); };
const depositAccount = (p, id = premiumId) => account(id, principalToSubaccount(p));
const initConfig = () => ({ admins: [bob], icpLedgerId: icpId, sneedGovernanceId: govId, paymentRecipient: account(carol), minClaimIntervalNs: DAY });
const icpTier = (name, amount, duration, active = true) => ({ name, amountE8s: amount, durationNs: duration, active });
const verifiedLog = async (id = premiumId) => (await verifyLog(as(admin, id), id, rootKey, (c) => actorAs(pic, archiveIdl, c, admin))).blocks.map((b, i) => ({ i, t: btype(b), ...plain(tx(b)) }));
const logLength = async (id = premiumId) => Number((await as(admin, id).icrc3_log_status()).log_length);
const since = async (mark, id = premiumId) => (await verifiedLog(id)).slice(mark);
const bps = (n) => ({ icp_tier_price_bps: n === null ? [] : [n] });
const partner = (label, n, expires = null) => ({ label, prices: bps(n), expires_at: expires === null ? [] : [expires] });

/// Deposit `amount` for `who` and try to buy; leftover deposits are withdrawn so the next test starts clean.
const buy = async (who, amount, id = premiumId) => {
  await icp.mint(depositAccount(who, id), amount);
  const r = await as(who, id).purchaseWithIcp();
  if ('err' in r) await as(who, id).withdrawDeposit();
  return r;
};
const expiration = async (who, id = premiumId) => (await as(admin, id).getMembershipDetails(who))[0]?.expiration ?? 0n;
const lastPaymentId = async (id = premiumId) => (await as(admin, id).getIcpPaymentLogCount()) - 1n;

beforeAll(async () => {
  ({ pic, appSubnet, rootKey } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  govId = await install(pic, { name: 'MockRllGovernance', targetSubnetId: appSubnet });
  premiumId = await install(pic, { name: PREMIUM_WASM, initTypes: premiumInit({ IDL }), initArgs: [[initConfig()]], cycles: 50n * T, targetSubnetId: appSubnet });
  icp = actorAs(pic, ledgerIdl, icpId, admin);
  unwrap(await as(admin).addIcpTier(icpTier('1 Month', ICP, MONTH)));
  unwrap(await as(admin).addIcpTier(icpTier('1 Year', 10n * ICP, YEAR)));
}, 120_000);

afterAll(async () => { await pic?.tearDown(); });

describe('defaults', () => {
  it('charge exactly as before: the regular tier amounts, for admins and everyone else', async () => {
    // (no special-price method here: this test passes on the code before special prices too)
    const a0 = await expiration(alice);
    unwrap(await buy(alice, ICP));
    expect(await expiration(alice)).toBeGreaterThan(a0);
    unwrap(await buy(bob, 10n * ICP)); // an admin pays the regular price too
    expect(errOf(await buy(bob, ICP / 100n))).toEqual({ InvalidTier: null });
    expect(errOf(await buy(alice, ICP / 2n))).toEqual({ InvalidTier: null });
    const log = (await as(admin).getIcpPaymentLog(0n, 10n)).payments;
    expect(log.map((p) => [p.payer.toText(), p.amountE8s, p.tierName])).toEqual([[bob.toText(), 10n * ICP, '1 Year'], [alice.toText(), ICP, '1 Month']]);
  });

  it('have no admin price and no partners, and record purchases as regular', async () => {
    expect(await as(alice).get_special_prices()).toEqual({ admin_prices: bps(null), partners: [] });
    expect(await as(alice).get_special_prices_for(alice)).toEqual({ admin_prices: [], partner: [] });
    expect(await as(alice).get_special_prices_for(bob)).toEqual({ admin_prices: [bps(null)], partner: [] });
    const prices = await as(alice).get_icp_tier_prices_for(bob);
    expect(prices.map((p) => [p.tier.name, p.price_e8s, Object.keys(p.price_tier)[0]])).toEqual([['1 Month', ICP, 'regular'], ['1 Year', 10n * ICP, 'regular']]);
    const mark = await logLength();
    unwrap(await buy(alice, ICP));
    const [b] = await since(mark);
    expect(b).toMatchObject({ t: 'premium_icp_purchase', tier: '1 Month', amount_e8s: ICP, price_tier: 'regular' });
    expect(await as(alice).get_icp_payment_price_tier(await lastPaymentId())).toEqual([{ regular: null }]);
    expect(await as(alice).get_icp_payment_price_tier(0n)).toEqual([{ regular: null }]); // before: regular
    expect(await as(alice).get_icp_payment_price_tier(999n)).toEqual([]);
  });
});

describe('setters', () => {
  it('are validated, and log nothing when refused', async () => {
    const mark = await logLength();
    // (non-admins are refused at ingress already: next test; the methods check again)
    expect(errOf(await as(admin).set_admin_prices(bps(0n)))).toMatch(/1 to 10000/);
    expect(errOf(await as(admin).set_admin_prices(bps(10_001n)))).toMatch(/1 to 10000/);
    expect(errOf(await as(admin).set_partner_prices(dave, partner('x', 0n)))).toMatch(/1 to 10000/);
    expect(errOf(await as(admin).set_partner_prices(dave, partner('  ', 5000n)))).toMatch(/label/);
    expect(errOf(await as(admin).set_partner_prices(dave, partner('x'.repeat(101), 5000n)))).toMatch(/100 characters/);
    expect(errOf(await as(admin).set_partner_prices(dave, partner('x', 5000n, (await nowNs()) - SEC)))).toMatch(/past/);
    expect(errOf(await as(admin).set_partner_prices(Principal.anonymous(), partner('x', 5000n)))).toMatch(/anonymous/);
    expect(errOf(await as(admin).remove_partner_prices(dave))).toMatch(/no partner/);
    expect(await logLength()).toBe(mark);
    expect(await as(alice).get_special_prices()).toEqual({ admin_prices: bps(null), partners: [] });
  });

  it('are admin-only (non-admins refused at ingress), and the queries refused as update calls', async () => {
    expect(await refusedAtIngress(as(alice).set_admin_prices(bps(1n)))).toBe(true);
    expect(await refusedAtIngress(as(alice).set_partner_prices(alice, partner('me', 1n)))).toBe(true);
    expect(await refusedAtIngress(as(alice).remove_partner_prices(alice))).toBe(true);
    const u = actorAs(pic, asUpdates(premiumIdl), premiumId, admin);
    expect(await refusedAtIngress(u.get_special_prices())).toBe(true);
    expect(await refusedAtIngress(u.get_special_prices_for(alice))).toBe(true);
    expect(await refusedAtIngress(u.get_icp_tier_prices_for(alice))).toBe(true);
    expect(await refusedAtIngress(u.get_icp_payment_price_tier(0n))).toBe(true);
  });
});

describe('admin price', () => {
  it('is logged as a config change with the old value', async () => {
    const mark = await logLength();
    unwrap(await as(bob).set_admin_prices(bps(100n))); // 1%: a month costs 0.01 ICP
    const [b] = await since(mark);
    expect(b).toMatchObject({ t: 'premium_config_update', caller: P(bob), key: 'admin_prices', value: { icp_tier_price_bps: 100n }, old_value: {} });
    expect((await as(alice).get_special_prices()).admin_prices).toEqual(bps(100n));
  });

  it('applies to admins (people) only, and a regular deposit still buys at the regular price', async () => {
    expect(await as(alice).get_special_prices_for(bob)).toEqual({ admin_prices: [bps(100n)], partner: [] });
    expect((await as(alice).get_icp_tier_prices_for(bob)).map((p) => [p.price_e8s, Object.keys(p.price_tier)[0]])).toEqual([[ICP / 100n, 'admin'], [ICP / 10n, 'admin']]);
    const mark = await logLength();
    const e0 = await expiration(bob);
    unwrap(await buy(bob, ICP / 100n));
    expect(await expiration(bob)).toBe(e0 + MONTH);
    expect(await as(alice).get_icp_payment_price_tier(await lastPaymentId())).toEqual([{ admin: null }]);
    unwrap(await buy(admin, ICP / 10n)); // the controller is an admin too: a year for 0.1 ICP
    unwrap(await buy(bob, ICP)); // the regular amount still buys the month, as regular
    expect(await as(alice).get_icp_payment_price_tier(await lastPaymentId())).toEqual([{ regular: null }]);
    const blocks = await since(mark);
    expect(blocks.map((b) => [b.t, b.caller, b.tier, b.amount_e8s, b.price_tier])).toEqual([
      ['premium_icp_purchase', P(bob), '1 Month', ICP / 100n, 'admin'],
      ['premium_icp_purchase', P(admin), '1 Year', ICP / 10n, 'admin'],
      ['premium_icp_purchase', P(bob), '1 Month', ICP, 'regular'],
    ]);
    // not for anyone else
    expect(await as(alice).get_special_prices_for(alice)).toEqual({ admin_prices: [], partner: [] });
    expect(errOf(await buy(alice, ICP / 100n))).toEqual({ InvalidTier: null });
  });

  it('never applies to a canister on the admin list', async () => {
    unwrap(await as(admin).addAdmin(govId));
    expect(await as(alice).get_special_prices_for(govId)).toEqual({ admin_prices: [], partner: [] });
    expect((await as(alice).get_icp_tier_prices_for(govId))[0].price_e8s).toBe(ICP);
    unwrap(await as(admin).removeAdmin(govId));
  });
});

describe('partner prices', () => {
  let exp;
  it('are set, listed publicly and logged', async () => {
    exp = (await nowNs()) + 2n * DAY;
    const mark = await logLength();
    unwrap(await as(admin).set_partner_prices(dave, partner('a partner game canister', 5000n, exp)));
    unwrap(await as(admin).set_partner_prices(dave, partner('a partner game canister', 2500n, exp))); // replaces
    expect(await as(alice).get_special_prices()).toEqual({
      admin_prices: bps(100n),
      partners: [{ principal: dave, label: 'a partner game canister', prices: bps(2500n), expires_at: [exp] }],
    });
    const blocks = await since(mark);
    expect(blocks.map((b) => [b.t, b.key, b.partner])).toEqual([['premium_config_update', 'partner_prices', P(dave)], ['premium_config_update', 'partner_prices', P(dave)]]);
    expect(blocks[0].value).toEqual({ label: 'a partner game canister', prices: { icp_tier_price_bps: 5000n }, expires_at: exp });
    expect(blocks[0].old_value).toBeUndefined();
    expect(blocks[1].old_value).toEqual(blocks[0].value);
  });

  it('apply to that principal only', async () => {
    expect(await as(alice).get_special_prices_for(dave)).toEqual({ admin_prices: [], partner: [partner('a partner game canister', 2500n, exp)] });
    const mark = await logLength();
    unwrap(await buy(dave, ICP / 4n));
    expect(await as(alice).get_icp_payment_price_tier(await lastPaymentId())).toEqual([{ partner: null }]);
    expect((await since(mark))[0]).toMatchObject({ t: 'premium_icp_purchase', caller: P(dave), tier: '1 Month', amount_e8s: ICP / 4n, price_tier: 'partner' });
    expect(errOf(await buy(eve, ICP / 4n))).toEqual({ InvalidTier: null });
  });

  it('lowest wins: an admin who is also a partner pays the lower of the two, the admin tier on a tie', async () => {
    unwrap(await as(admin).set_partner_prices(bob, partner('team member test', 50n)));
    expect((await as(alice).get_icp_tier_prices_for(bob))[0]).toMatchObject({ price_e8s: ICP / 200n, price_tier: { partner: null } });
    unwrap(await buy(bob, ICP / 200n));
    expect(await as(alice).get_icp_payment_price_tier(await lastPaymentId())).toEqual([{ partner: null }]);
    expect(errOf(await buy(bob, ICP / 100n))).toEqual({ InvalidTier: null }); // the admin price is not the lowest any more
    unwrap(await as(admin).set_partner_prices(bob, partner('team member test', 100n)));
    unwrap(await buy(bob, ICP / 100n));
    expect(await as(alice).get_icp_payment_price_tier(await lastPaymentId())).toEqual([{ admin: null }]);
    unwrap(await as(admin).set_partner_prices(bob, partner('team member test', 9000n)));
    unwrap(await buy(bob, ICP / 100n)); // the admin price is lower
    expect(await as(alice).get_icp_payment_price_tier(await lastPaymentId())).toEqual([{ admin: null }]);
  });

  it('end at their expiry (the entry stays listed), and can be removed (logged)', async () => {
    await advance(3n * DAY);
    expect((await as(alice).get_special_prices_for(dave)).partner).toEqual([]);
    expect((await as(alice).get_icp_tier_prices_for(dave))[0]).toMatchObject({ price_e8s: ICP, price_tier: { regular: null } });
    expect(errOf(await buy(dave, ICP / 4n))).toEqual({ InvalidTier: null });
    expect((await as(alice).get_special_prices()).partners.map((p) => p.principal.toText())).toContain(dave.toText());
    const mark = await logLength();
    unwrap(await as(bob).remove_partner_prices(dave));
    unwrap(await as(bob).remove_partner_prices(bob));
    const blocks = await since(mark);
    expect(blocks[0]).toMatchObject({ t: 'premium_config_update', key: 'partner_prices', partner: P(dave), value: 'removed', old_value: { label: 'a partner game canister', prices: { icp_tier_price_bps: 2500n }, expires_at: exp } });
    expect((await as(alice).get_special_prices()).partners).toEqual([]);
    // unset the admin price: back to the defaults
    unwrap(await as(admin).set_admin_prices(bps(null)));
    expect((await since(mark)).at(-1)).toMatchObject({ key: 'admin_prices', value: {}, old_value: { icp_tier_price_bps: 100n } });
    expect(errOf(await buy(bob, ICP / 100n))).toEqual({ InvalidTier: null });
  });
});

describe('upgrade', () => {
  it('from the code before special prices keeps everything and starts with none', async () => {
    const oldId = await install(pic, { name: 'sneed_premium_presp', initTypes: premiumInit({ IDL }), initArgs: [[initConfig()]], cycles: 20n * T, targetSubnetId: appSubnet });
    const old = as(admin, oldId);
    await expect(old.get_special_prices()).rejects.toThrow(); // the old code has none
    unwrap(await old.addIcpTier(icpTier('1 Month', ICP, MONTH)));
    unwrap(await buy(alice, ICP, oldId));
    const snapshot = async () => ({
      members: await old.getAllMemberships(),
      tiers: await old.getAllIcpTiers(),
      payments: await old.getIcpPaymentLog(0n, 100n),
      stats: await old.getPaymentStats(),
      config: await old.getConfig(),
      log: await old.icrc3_log_status(),
    });
    const before = await snapshot();
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(PREMIUM_WASM), arg: IDL.encode(premiumInit({ IDL }), [[]]) });
    await pic.tick(2);
    expect(await snapshot()).toEqual(before);
    expect(await old.get_special_prices()).toEqual({ admin_prices: bps(null), partners: [] });
    expect(await old.get_icp_payment_price_tier(0n)).toEqual([{ regular: null }]);
    unwrap(await as(bob, oldId).set_admin_prices(bps(10n)));
    unwrap(await buy(bob, ICP / 1000n, oldId));
    expect(await old.get_icp_payment_price_tier(1n)).toEqual([{ admin: null }]);
  }, 120_000);
});
