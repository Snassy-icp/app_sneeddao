// Special prices in sneed_mon (spec/special_prices.md): an admin price and partner prices next to
// the regular price (sneed_mon has no premium price). Both override the base daily price; the
// tier multipliers apply on top, and each check is charged the lowest per-check price that
// applies to the watch's owner. The admin price is for people on the admin list (never a
// canister admin); a partner price for that principal only, until its expiry. Defaults: nothing
// set, charges exactly as before. Every check records its price tier (get_my_charges_with_tier).
// An upgrade from the build before special prices (f9d8db0b, build/sneed_mon_presp.wasm) keeps
// everything and starts with no special prices.
// MON_WASM=sneed_mon_presp npx vitest run tests/sneed-mon-special-prices.test.js runs it against
// the old code (the special-price tests fail there).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, unwrap, errOf, wasm, refusedAtIngress, account, principalToSubaccount } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { idlFactory as monIdl } from '../build/sneed_mon.did.js';
import { idlFactory as notifIdl } from '../build/sneed_notifications.did.js';

const MON_WASM = process.env.MON_WASM || 'sneed_mon';
const MIN = 60_000; // ms
const FEE = 10_000n;
const dave = user('mon-sp-dave');

// the generated interface plus the special-price methods (so the file runs against a build
// without them, and fails there)
const Prices = IDL.Record({ base_daily_price_e8s: IDL.Opt(IDL.Nat) });
const Partner = IDL.Record({ label: IDL.Text, prices: Prices, expires_at: IDL.Opt(IDL.Int) });
const SpRes = IDL.Variant({ ok: IDL.Null, err: IDL.Text });
const Target = IDL.Variant({ sns: IDL.Principal, nns: IDL.Null });
const fullIdl = ({ IDL: I }) => {
  const fields = Object.fromEntries(monIdl({ IDL: I })._fields);
  return I.Service({
    ...fields,
    set_admin_prices: I.Func([Prices], [SpRes], []),
    set_partner_prices: I.Func([I.Principal, Partner], [SpRes], []),
    remove_partner_prices: I.Func([I.Principal], [SpRes], []),
    get_special_prices: I.Func([], [I.Record({ admin_prices: Prices, partners: I.Vec(I.Record({ principal: I.Principal, label: I.Text, prices: Prices, expires_at: I.Opt(I.Int) })) })], ['query']),
    get_special_prices_for: I.Func([I.Principal], [I.Record({ admin_prices: I.Opt(Prices), partner: I.Opt(Partner) })], ['query']),
    get_my_charges_with_tier: I.Func([I.Nat, I.Nat], [I.Record({ total: I.Nat, entries: I.Vec(I.Record({ at: I.Int, target: Target, every_min: I.Nat, price_e8s: I.Nat, outcome: I.Text, price_tier: I.Text })) })], ['query']),
  });
};
const snswIdl = ({ IDL: I }) => I.Service({ set_instances: I.Func([I.Vec(I.Tuple(I.Principal, I.Principal))], [], []) });

let pic, monId, notifId, icpId, snsA, snswId, canisterAdmin;
let mon, monAs, icp;

const base = (n) => ({ base_daily_price_e8s: n === null ? [] : [n] });
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const later = async (minutes) => { await pic.advanceTime(minutes * MIN); await pic.tick(2); };
async function drain(m = mon) {
  for (let i = 0; i < 60 && (await m.get_status()).running; i++) { await pic.advanceTime(1_500); await pic.tick(2); }
  expect((await m.get_status()).running).toBe(false);
}
async function round() { await drain(); unwrap(await mon.admin_run_now()); await drain(); }
async function fund(p, e8s, id = monId) {
  await icp.mint(account(id, principalToSubaccount(p)), e8s);
  return unwrap(await actorAs(pic, fullIdl, id, p).credit_deposit());
}
const balanceOf = async (p) => (await monAs(p).get_my_balance()).balance_e8s;
const lastCharge = async (p) => (await monAs(p).get_my_charges_with_tier(0n, 1n)).entries[0];
// the next hourly check of every watcher: an hour on, one round; returns what each paid
async function nextCheck(ps) {
  const before = await Promise.all(ps.map(balanceOf));
  await later(61);
  await round();
  const after = await Promise.all(ps.map(balanceOf));
  return before.map((b, i) => b - after[i]);
}

describe(`sneed_mon special prices (${MON_WASM})`, () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    notifId = await install(pic, { name: 'sneed_notifications' });
    snswId = await install(pic, { name: 'MockForumSnsW' });
    snsA = await install(pic, { name: 'MockMonSns' });
    canisterAdmin = await install(pic, { name: 'MockMonSns' }); // a canister on the admin list
    icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE, symbol: 'ICP', decimals: 8 }] });
    monId = await install(pic, { name: MON_WASM });
    mon = actorAs(pic, fullIdl, monId, admin);
    monAs = (p) => actorAs(pic, fullIdl, monId, p);
    icp = actorAs(pic, ledgerIdl, icpId, admin);
    await actorAs(pic, snswIdl, snswId, admin).set_instances([[snsA, snsA]]);
    const n = actorAs(pic, notifIdl, notifId, admin);
    unwrap(await n.admin_set_config({ ...(await n.get_config()), default_daily_cap: 1_000n }));
    const cfg = await mon.get_config();
    unwrap(await mon.admin_set_config({ ...cfg.core, notifications: [notifId], sns_wasm: snswId }));
    unwrap(await mon.admin_set_billing({ ...cfg.billing, icp_ledger: icpId, fee_destination: [] }));
    unwrap(await mon.admin_register_with_notifications());
    unwrap(await mon.admin_add_admin(dave)); // a person on the admin list
    unwrap(await mon.admin_add_admin(canisterAdmin));
    // everyone watches snsA hourly (18,000 e8s a check at the default table)
    for (const p of [admin, alice, bob, carol, dave, canisterAdmin]) {
      await fund(p, 1_000_000n);
      unwrap(await monAs(p).watch({ sns: snsA }));
    }
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('defaults: no special prices, everyone pays the regular price, recorded as regular', async () => {
    expect(await mon.get_special_prices()).toEqual({ admin_prices: base(null), partners: [] });
    expect(await mon.get_special_prices_for(bob)).toEqual({ admin_prices: [], partner: [] });
    await round(); // the first check of every watch
    for (const p of [admin, alice, bob, carol, dave, canisterAdmin]) {
      expect(await balanceOf(p)).toBe(1_000_000n - FEE - 18_000n);
      const e = await lastCharge(p);
      expect([e.price_e8s, e.price_tier]).toEqual([18_000n, 'regular']);
    }
    // get_my_charges is unchanged
    expect((await monAs(alice).get_my_charges(0n, 10n)).entries.map((e) => e.price_e8s)).toEqual([18_000n]);
  });

  it('only admins set special prices; non-admins are refused at ingress', async () => {
    expect(await refusedAtIngress(monAs(alice).set_admin_prices(base(1n)))).toBe(true);
    expect(await refusedAtIngress(monAs(alice).set_partner_prices(alice, { label: 'me', prices: base(1n), expires_at: [] }))).toBe(true);
    expect(await refusedAtIngress(monAs(alice).remove_partner_prices(bob))).toBe(true);
    expect(await mon.get_special_prices()).toEqual({ admin_prices: base(null), partners: [] });
  });

  it('the admin price applies to people on the admin list only, never to a canister admin', async () => {
    // a tiny price for testing: base 8,000 a day = 1,000 per hourly check
    expect(await mon.set_admin_prices(base(8_000n))).toEqual({ ok: null });
    expect(await mon.get_special_prices()).toEqual({ admin_prices: base(8_000n), partners: [] });
    expect((await mon.get_special_prices_for(dave)).admin_prices).toEqual([base(8_000n)]);
    expect((await mon.get_special_prices_for(alice)).admin_prices).toEqual([]);
    expect((await mon.get_special_prices_for(canisterAdmin)).admin_prices).toEqual([]);
    // the watch listing and balance summary show the price the user pays
    expect((await monAs(dave).get_my_watches())[0].price_per_check_e8s).toBe(1_000n);
    expect((await monAs(dave).get_my_balance()).per_day_e8s).toBe(24_000n);
    expect((await monAs(alice).get_my_watches())[0].price_per_check_e8s).toBe(18_000n);
    const paid = await nextCheck([admin, dave, alice, canisterAdmin]);
    expect(paid).toEqual([1_000n, 1_000n, 18_000n, 18_000n]);
    expect((await lastCharge(dave)).price_tier).toBe('admin');
    expect((await lastCharge(admin)).price_tier).toBe('admin');
    expect((await lastCharge(canisterAdmin)).price_tier).toBe('regular');
    expect((await lastCharge(alice)).price_tier).toBe('regular');
    // the regular price table is untouched
    expect((await mon.get_tiers()).base_daily_price_e8s).toBe(144_000n);
  });

  it('a partner price applies to that principal only, until its expiry', async () => {
    const exp = (await nowNs()) + 90n * 60n * 1_000_000_000n; // in 90 minutes: covers the next check, not the one after
    const entry = { label: 'a partner game canister', prices: base(16_000n), expires_at: [exp] }; // 2,000 a check
    expect(await mon.set_partner_prices(bob, entry)).toEqual({ ok: null });
    expect(await mon.get_special_prices()).toEqual({ admin_prices: base(8_000n), partners: [{ principal: bob, ...entry }] });
    expect(await mon.get_special_prices_for(bob)).toEqual({ admin_prices: [], partner: [entry] });
    expect((await mon.get_special_prices_for(carol)).partner).toEqual([]);
    const paid = await nextCheck([bob, carol]);
    expect(paid).toEqual([2_000n, 18_000n]);
    expect((await lastCharge(bob)).price_tier).toBe('partner');
    expect((await lastCharge(carol)).price_tier).toBe('regular');
    // after the expiry: regular again; the entry is still listed (public), but no longer applies
    const paid2 = await nextCheck([bob]);
    expect(paid2).toEqual([18_000n]);
    expect((await lastCharge(bob)).price_tier).toBe('regular');
    expect((await mon.get_special_prices_for(bob)).partner).toEqual([]);
    expect((await mon.get_special_prices()).partners.map((p) => p.principal.toText())).toEqual([bob.toText()]);
    // removed
    expect(await mon.remove_partner_prices(bob)).toEqual({ ok: null });
    expect((await mon.get_special_prices()).partners).toEqual([]);
    expect(errOf(await mon.remove_partner_prices(bob))).toMatch(/No partner prices/);
  });

  it('the lowest applicable price wins', async () => {
    // dave is an admin (1,000 a check) and becomes a partner at 5,000: admin wins
    unwrap(await mon.set_partner_prices(dave, { label: 'a partner wallet', prices: base(40_000n), expires_at: [] }));
    // carol's partner price is above the regular price: regular wins (and is recorded as regular)
    unwrap(await mon.set_partner_prices(carol, { label: 'an integrator', prices: base(200_000n), expires_at: [] }));
    let paid = await nextCheck([dave, carol]);
    expect(paid).toEqual([1_000n, 18_000n]);
    expect((await lastCharge(dave)).price_tier).toBe('admin');
    expect((await lastCharge(carol)).price_tier).toBe('regular');
    // the admin price goes up past the partner price: partner wins for dave; a partner entry
    // without an override changes nothing
    unwrap(await mon.set_admin_prices(base(80_000n))); // 10,000 a check
    unwrap(await mon.set_partner_prices(carol, { label: 'an integrator', prices: base(null), expires_at: [] }));
    paid = await nextCheck([dave, admin, carol]);
    expect(paid).toEqual([5_000n, 10_000n, 18_000n]);
    expect((await lastCharge(dave)).price_tier).toBe('partner');
    expect((await lastCharge(admin)).price_tier).toBe('admin');
    // the history keeps each check's tier, newest first (every round checks every watcher)
    const h = await monAs(dave).get_my_charges_with_tier(0n, 10n);
    expect(h.entries.map((e) => [e.price_e8s, e.price_tier])).toEqual([[5_000n, 'partner'], [1_000n, 'admin'], [1_000n, 'admin'], [1_000n, 'admin'], [1_000n, 'admin'], [18_000n, 'regular']]);
    expect(h.total).toBe((await monAs(dave).get_my_charges(0n, 10n)).total);
  });

  it('validates partner entries', async () => {
    const now = await nowNs();
    expect(errOf(await mon.set_partner_prices(alice, { label: '  ', prices: base(1n), expires_at: [] }))).toMatch(/label/);
    expect(errOf(await mon.set_partner_prices(alice, { label: 'x'.repeat(101), prices: base(1n), expires_at: [] }))).toMatch(/at most 100/);
    expect(errOf(await mon.set_partner_prices(alice, { label: 'late', prices: base(1n), expires_at: [now - 1n] }))).toMatch(/past/);
    expect(errOf(await mon.set_partner_prices(Principal.anonymous(), { label: 'anon', prices: base(1n), expires_at: [] }))).toMatch(/anonymous/);
    expect((await mon.get_special_prices()).partners.map((p) => p.principal.toText()).sort()).toEqual([carol.toText(), dave.toText()].sort());
  });

  it('upgrades from the build before special prices: everything kept, no special prices', async () => {
    const oldId = await install(pic, { name: 'sneed_mon_presp' });
    const old = actorAs(pic, fullIdl, oldId, admin);
    const cfg = await old.get_config();
    unwrap(await old.admin_set_config({ ...cfg.core, notifications: [notifId], sns_wasm: snswId }));
    unwrap(await old.admin_set_billing({ ...cfg.billing, icp_ledger: icpId, fee_destination: [] }));
    unwrap(await old.admin_set_tiers({ ...cfg.tiers, base_daily_price_e8s: 288_000n }));
    unwrap(await old.admin_add_admin(dave));
    await fund(alice, 500_000n, oldId);
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(MON_WASM), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    const up = actorAs(pic, fullIdl, oldId, admin);
    expect((await up.get_tiers()).base_daily_price_e8s).toBe(288_000n);
    expect((await up.get_admins()).map((p) => p.toText())).toEqual([dave.toText()]);
    expect((await actorAs(pic, fullIdl, oldId, alice).get_my_balance()).balance_e8s).toBe(500_000n - FEE);
    expect(await up.get_special_prices()).toEqual({ admin_prices: base(null), partners: [] });
    expect(await up.get_special_prices_for(dave)).toEqual({ admin_prices: [base(null)], partner: [] });
  });
});
