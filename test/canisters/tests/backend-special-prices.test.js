// Special prices on app_sneeddao_backend (spec/special_prices.md): the jailbreak fee gets an admin
// price (admins who are people) and partner prices (per principal, public label, optional expiry)
// next to its regular and premium prices; the lowest applicable one is charged and each payment
// records its price tier (get_jailbreak_payment_price_tiers). With nothing set the canister charges
// exactly as before. An upgrade (with wasm_memory_persistence = keep, as the SNS proposal sets it)
// from the production source (f9d8db0b, build/app_sneeddao_backend_presp.wasm) keeps the fees and
// payment logs and starts with no special prices.
// BACKEND_WASM=app_sneeddao_backend_presp npx vitest run tests/backend-special-prices.test.js runs it
// against the production code (the special-price tests fail there).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, account, admin, alice, bob, carol, user, ICP_LEDGER_ID, T, unwrap, errOf, nowNs, wasm, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { ledgerIdl, ledgerInit, premiumIdl } from '../lib/idl.js';
import { upgradeHub } from '../lib/hub.js';
import { idlFactory as hubIdl } from '../build/app_sneeddao_backend.did.js';

const BACKEND_WASM = process.env.BACKEND_WASM || 'app_sneeddao_backend';
const ICP_FEE = 10_000n;
const E8S = 100_000_000n;
const H_NS = 3_600_000_000_000n;
const dave = user('dave');
const eve = user('eve');
const SNS = () => Principal.fromText('fp274-iaaaa-aaaaq-aacha-cai');
const jailbreakSub = (p) => { const out = new Uint8Array(32); const b = [0x0a, ...new TextEncoder().encode('jailbreak'), ...p.toUint8Array()]; out.set(b.slice(0, 32)); return out; };

// the generated interface plus the special-price methods, so the file runs against a build without them
const fullIdl = ({ IDL }) => {
  const fields = Object.fromEntries(hubIdl({ IDL })._fields);
  const Prices = IDL.Record({ jailbreak_fee_e8s: IDL.Opt(IDL.Nat) });
  const Partner = IDL.Record({ label: IDL.Text, prices: Prices, expires_at: IDL.Opt(IDL.Int) });
  const Res = IDL.Variant({ ok: IDL.Null, err: IDL.Text });
  const Tier = IDL.Variant({ regular: IDL.Null, premium: IDL.Null, admin: IDL.Null, partner: IDL.Null });
  return IDL.Service({
    ...fields,
    set_admin_prices: IDL.Func([Prices], [Res], []),
    set_partner_prices: IDL.Func([IDL.Principal, Partner], [Res], []),
    remove_partner_prices: IDL.Func([IDL.Principal], [Res], []),
    get_special_prices: IDL.Func([], [IDL.Record({
      admin_prices: Prices,
      partners: IDL.Vec(IDL.Record({ principal: IDL.Principal, label: IDL.Text, prices: Prices, expires_at: IDL.Opt(IDL.Int) })),
    })], ['query']),
    get_special_prices_for: IDL.Func([IDL.Principal], [IDL.Record({ admin_prices: IDL.Opt(Prices), partner: IDL.Opt(Partner) })], ['query']),
    get_my_jailbreak_price: IDL.Func([], [IDL.Record({ amount_e8s: IDL.Nat, price_tier: Tier })], []),
    get_jailbreak_payment_price_tiers: IDL.Func([IDL.Vec(IDL.Nat)], [IDL.Variant({ ok: IDL.Vec(IDL.Tuple(IDL.Nat, Tier)), err: IDL.Text })], ['query']),
  });
};

const prices = (fee) => ({ jailbreak_fee_e8s: fee === null ? [] : [fee] });
const tierOf = (t) => Object.keys(t)[0];

let pic, appSubnet, hubId, icpId, premiumId;
let icp, premium;
const as = (p, id = hubId) => actorAs(pic, fullIdl, id, p);

// pay the jailbreak fee as `p` with exactly `amount` + ledger fee deposited; returns the hub's ICP received
async function pay(p, hex, amount) {
  await icp.mint(account(hubId, jailbreakSub(p)), amount + ICP_FEE);
  const before = await icp.icrc1_balance_of(account(hubId));
  unwrap(await as(p).save_jailbreak_config(SNS(), hex, p));
  expect(await as(p).get_jailbreak_payment_balance()).toBe(0n);
  return (await icp.icrc1_balance_of(account(hubId))) - before;
}

describe('app_sneeddao_backend special prices (jailbreak fee)', () => {
  beforeAll(async () => {
    ({ pic, appSubnet } = await createPic());
    icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
    hubId = await install(pic, { name: BACKEND_WASM, cycles: 20n * T, targetSubnetId: appSubnet });
    premiumId = await install(pic, { name: 'MockPremium', targetSubnetId: appSubnet });
    icp = actorAs(pic, ledgerIdl, icpId, admin);
    premium = actorAs(pic, premiumIdl, premiumId, admin);
    unwrap(await as(admin).set_nickname_premium_canister([premiumId]));
    await premium.set_member(carol, (await nowNs(pic)) + 1000n * H_NS);
    unwrap(await as(admin).set_jailbreak_fee_settings([E8S / 2n], [E8S], [], []));
    await as(admin).add_admin(dave); // a person on the admin list
    await as(admin).add_admin(premiumId); // a canister on the admin list
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('defaults: no special prices; regular and premium charged exactly as before', async () => {
    expect(await as(alice).get_special_prices()).toEqual({ admin_prices: prices(null), partners: [] });
    expect(await as(alice).get_special_prices_for(alice)).toEqual({ admin_prices: [], partner: [] });
    expect(await as(alice).get_my_jailbreak_fee()).toBe(E8S);
    expect(await as(carol).get_my_jailbreak_fee()).toBe(E8S / 2n);
    expect(await as(dave).get_my_jailbreak_fee()).toBe(E8S); // an admin pays the regular price while no admin price is set
    expect(await as(alice).get_my_jailbreak_price()).toEqual({ amount_e8s: E8S, price_tier: { regular: null } });
    expect(await as(carol).get_my_jailbreak_price()).toEqual({ amount_e8s: E8S / 2n, price_tier: { premium: null } });
    expect(await pay(alice, 'a1', E8S)).toBe(E8S);
    expect(await pay(carol, 'c1', E8S / 2n)).toBe(E8S / 2n);
    expect(unwrap(await as(admin).get_jailbreak_payment_price_tiers([1n, 2n, 99n])).map(([id, t]) => [id, tierOf(t)])).toEqual([[1n, 'regular'], [2n, 'premium']]);
  });

  it('setters: admins only; validation', async () => {
    const P = { label: 'a partner game canister', prices: prices(1_000n), expires_at: [] };
    expect(errOf(await as(alice).set_admin_prices(prices(1n)))).toMatch(/Not authorized/);
    expect(errOf(await as(alice).set_partner_prices(eve, P))).toMatch(/Not authorized/);
    expect(errOf(await as(alice).remove_partner_prices(eve))).toMatch(/Not authorized/);
    expect(errOf(await as(admin).set_partner_prices(Principal.anonymous(), P))).toMatch(/anonymous/);
    expect(errOf(await as(admin).set_partner_prices(eve, { ...P, label: '  ' }))).toMatch(/needs a label/);
    expect(errOf(await as(admin).set_partner_prices(eve, { ...P, label: 'x'.repeat(101) }))).toMatch(/at most 100/);
    expect(errOf(await as(admin).set_partner_prices(eve, { ...P, expires_at: [(await nowNs(pic)) - 1n] }))).toMatch(/past/);
    expect(errOf(await as(admin).remove_partner_prices(eve))).toMatch(/no partner prices/);
    expect(await as(alice).get_special_prices()).toEqual({ admin_prices: prices(null), partners: [] });
    // the ingress guard refuses the queries as update calls
    await refusedAtIngress(actorAs(pic, asUpdates(fullIdl), hubId, alice).get_special_prices());
  });

  it('admin price: admins who are people only, never canisters or other users', async () => {
    unwrap(await as(dave).set_admin_prices(prices(1_000n))); // a listed admin may set it
    expect((await as(alice).get_special_prices()).admin_prices).toEqual(prices(1_000n));
    expect(await as(alice).get_special_prices_for(dave)).toEqual({ admin_prices: [prices(1_000n)], partner: [] });
    expect((await as(alice).get_special_prices_for(premiumId)).admin_prices).toEqual([]); // a canister admin
    expect((await as(alice).get_special_prices_for(alice)).admin_prices).toEqual([]);
    expect(await as(dave).get_my_jailbreak_price()).toEqual({ amount_e8s: 1_000n, price_tier: { admin: null } });
    expect(await as(admin).get_my_jailbreak_fee()).toBe(1_000n); // the controller is an admin too
    expect(await as(alice).get_my_jailbreak_fee()).toBe(E8S);
    expect(await as(carol).get_my_jailbreak_fee()).toBe(E8S / 2n);
    expect(await pay(dave, 'd1', 1_000n)).toBe(1_000n);
    const logs = unwrap(await as(admin).get_jailbreak_payment_logs(0n, 1n)).logs;
    expect(logs[0].amount_e8s).toBe(1_000n);
    expect(unwrap(await as(admin).get_jailbreak_payment_price_tiers([logs[0].id])).map(([, t]) => tierOf(t))).toEqual(['admin']);
    // above the regular price it has no effect
    unwrap(await as(admin).set_admin_prices(prices(5n * E8S)));
    expect(await as(dave).get_my_jailbreak_price()).toEqual({ amount_e8s: E8S, price_tier: { regular: null } });
    unwrap(await as(admin).set_admin_prices(prices(null)));
    expect(await as(dave).get_my_jailbreak_fee()).toBe(E8S);
  });

  it('partner price: that principal only, until its expiry; public listing; removal', async () => {
    const exp = (await nowNs(pic)) + 2n * H_NS;
    unwrap(await as(admin).set_partner_prices(eve, { label: 'a partner game canister', prices: prices(E8S / 10n), expires_at: [exp] }));
    expect(await as(alice).get_special_prices()).toEqual({
      admin_prices: prices(null),
      partners: [{ principal: eve, label: 'a partner game canister', prices: prices(E8S / 10n), expires_at: [exp] }],
    });
    expect(await as(alice).get_special_prices_for(eve)).toEqual({ admin_prices: [], partner: [{ label: 'a partner game canister', prices: prices(E8S / 10n), expires_at: [exp] }] });
    expect(await as(eve).get_my_jailbreak_price()).toEqual({ amount_e8s: E8S / 10n, price_tier: { partner: null } });
    expect(await as(alice).get_my_jailbreak_fee()).toBe(E8S);
    expect(await pay(eve, 'e1', E8S / 10n)).toBe(E8S / 10n);
    const id = unwrap(await as(admin).get_jailbreak_payment_logs(0n, 1n)).logs[0].id;
    expect(unwrap(await as(admin).get_jailbreak_payment_price_tiers([id])).map(([, t]) => tierOf(t))).toEqual(['partner']);
    // expired: the regular price again (the entry stays listed with its expiry)
    await pic.advanceTime(3 * 3600 * 1000); await pic.tick(2);
    expect((await as(alice).get_special_prices_for(eve)).partner).toEqual([]);
    expect(await as(eve).get_my_jailbreak_price()).toEqual({ amount_e8s: E8S, price_tier: { regular: null } });
    expect((await as(alice).get_special_prices()).partners.length).toBe(1);
    // replaced without expiry, then removed
    unwrap(await as(admin).set_partner_prices(eve, { label: 'a partner game canister', prices: prices(E8S / 10n), expires_at: [] }));
    expect(await as(eve).get_my_jailbreak_fee()).toBe(E8S / 10n);
    unwrap(await as(admin).remove_partner_prices(eve));
    expect(await as(eve).get_my_jailbreak_fee()).toBe(E8S);
    expect((await as(alice).get_special_prices()).partners).toEqual([]);
  });

  it('lowest wins: premium below partner stays premium; partner below premium wins; ties keep the earlier tier', async () => {
    unwrap(await as(admin).set_partner_prices(carol, { label: 'a partner wallet', prices: prices(E8S * 3n / 4n), expires_at: [] }));
    expect(await as(carol).get_my_jailbreak_price()).toEqual({ amount_e8s: E8S / 2n, price_tier: { premium: null } });
    unwrap(await as(admin).set_partner_prices(carol, { label: 'a partner wallet', prices: prices(E8S / 2n), expires_at: [] }));
    expect(await as(carol).get_my_jailbreak_price()).toEqual({ amount_e8s: E8S / 2n, price_tier: { premium: null } }); // tie
    unwrap(await as(admin).set_partner_prices(carol, { label: 'a partner wallet', prices: prices(E8S / 4n), expires_at: [] }));
    expect(await as(carol).get_my_jailbreak_price()).toEqual({ amount_e8s: E8S / 4n, price_tier: { partner: null } });
    // an admin who is also a partner: the lower of the two
    unwrap(await as(admin).set_admin_prices(prices(2_000n)));
    unwrap(await as(admin).set_partner_prices(dave, { label: 'a partner tool', prices: prices(3_000n), expires_at: [] }));
    expect(await as(dave).get_my_jailbreak_price()).toEqual({ amount_e8s: 2_000n, price_tier: { admin: null } });
    // a partner override of 0: free, no payment needed and no payment log
    unwrap(await as(admin).set_partner_prices(bob, { label: 'a free partner', prices: prices(0n), expires_at: [] }));
    const total = unwrap(await as(admin).get_jailbreak_payment_logs(0n, 1n)).total;
    unwrap(await as(bob).save_jailbreak_config(SNS(), 'b1', bob));
    expect(unwrap(await as(admin).get_jailbreak_payment_logs(0n, 1n)).total).toBe(total);
    // stats keep counting payments as before (premium flag from membership)
    expect(unwrap(await as(alice).get_jailbreak_payment_stats()).total_scripts_created).toBe(total);
    for (const p of [carol, dave, bob]) unwrap(await as(admin).remove_partner_prices(p));
    unwrap(await as(admin).set_admin_prices(prices(null)));
  });

  it('the tier query is admin only', async () => {
    expect(errOf(await as(alice).get_jailbreak_payment_price_tiers([1n]))).toMatch(/Not authorized/);
  });
});

describe('app_sneeddao_backend special prices: upgrade from the production source', () => {
  let id;
  beforeAll(async () => {
    ({ pic, appSubnet } = await createPic());
    icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
    icp = actorAs(pic, ledgerIdl, icpId, admin);
    id = await install(pic, { name: 'app_sneeddao_backend_presp', cycles: 20n * T, targetSubnetId: appSubnet });
    hubId = id;
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('keeps fees, configs and payment logs; starts with no special prices; old payments keep their tier', async () => {
    unwrap(await as(admin).set_jailbreak_fee_settings([E8S / 2n], [E8S], [], []));
    expect(await pay(alice, 'a1', E8S)).toBe(E8S);
    const logsBefore = unwrap(await as(admin).get_jailbreak_payment_logs(0n, 10n));
    const configsBefore = await as(alice).get_my_jailbreak_configs();
    await upgradeHub(pic, id, admin, wasm(BACKEND_WASM));
    expect(await as(admin).get_jailbreak_fee_settings()).toEqual({ fee_premium_e8s: E8S / 2n, fee_regular_e8s: E8S, fee_account_owner: [], fee_account_subaccount: [] });
    expect(unwrap(await as(admin).get_jailbreak_payment_logs(0n, 10n))).toEqual(logsBefore);
    expect(await as(alice).get_my_jailbreak_configs()).toEqual(configsBefore);
    expect(await as(alice).get_special_prices()).toEqual({ admin_prices: prices(null), partners: [] });
    expect(await as(alice).get_my_jailbreak_fee()).toBe(E8S);
    expect(unwrap(await as(admin).get_jailbreak_payment_price_tiers([1n])).map(([i, t]) => [i, tierOf(t)])).toEqual([[1n, 'regular']]);
    // the new methods work after the upgrade, and survive a second one
    unwrap(await as(admin).set_partner_prices(bob, { label: 'a partner game canister', prices: prices(7n), expires_at: [] }));
    await pic.advanceTime(10 * 60 * 1000); await pic.tick(2);
    await upgradeHub(pic, id, admin, wasm(BACKEND_WASM));
    expect((await as(alice).get_special_prices()).partners.map((p) => p.label)).toEqual(['a partner game canister']);
    expect(await as(bob).get_my_jailbreak_fee()).toBe(7n);
  });
});
