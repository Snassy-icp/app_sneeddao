// Special prices in sneedapp (spec/special_prices.md): an admin price and partner prices for the
// mint fee of Sneed DAO apps (publisher 0, and the legacy createNeuronManager). Covered: with
// nothing set the regular and premium prices are charged exactly as before; the admin price
// applies to people on the admin list only (not to other callers, not to a canister on the admin
// list); a partner price applies to that principal only and stops at its expiry; the lowest
// applicable price wins (a member's premium price beats a higher partner price); third-party
// publishers' apps are never overridden; an override too low to cover the cycles is refused at
// mint time like a regular price; only admins can set them; validation; config-change blocks in
// the ICRC-3 log and `price_tier` on every mint block; get_special_prices / _for; an upgrade from
// the production build (src/sneedapp at f9d8db0b, build/sneedapp_presp.wasm) keeps its state and
// starts with no special prices, and an upgrade keeps the special prices.
// SNEEDAPP_WASM=sneedapp_presp npx vitest run tests/sneedapp-special-prices.test.js runs it against
// the production code (the special-price tests fail there).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import {
  createPic, install, actorAs, account, principalToSubaccount, admin, alice, bob, carol, user, ICP_LEDGER_ID, T, unwrap, errOf, wasm,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit, premiumIdl } from '../lib/idl.js';
import { hex } from '../lib/idl-rll.js';
import { archiveIdl, btype, tx, verifyLog, icrc3Service } from '../lib/icrc3.js';
import { idlFactory as factoryIdl } from '../build/sneedapp.did.js';

const SNEEDAPP_WASM = process.env.SNEEDAPP_WASM || 'sneedapp';
const CMC_ID = Principal.fromText('rkp4c-7iaaa-aaaaa-aaaca-cai');
const ICP = 100_000_000n;
const ICP_FEE = 10_000n;
const SEC = 1_000_000_000n;
const HOUR = 3_600n * SEC;
const dave = user('dave');
const eve = user('eve');
const frank = user('frank');
const ops = user('ops'); // a second (human) admin
const treasury = user('treasury');
const adminCanister = Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai'); // a canister on the admin list
const wasmV1 = wasm('MockPremium');

// The special-price interface, added to the generated one so the file runs against a build without it.
const Prices = IDL.Record({ mint_fee_e8s: IDL.Opt(IDL.Nat) });
const PartnerPrices = IDL.Record({ label: IDL.Text, prices: Prices, expires_at: IDL.Opt(IDL.Int) });
const Res = IDL.Variant({ ok: IDL.Null, err: IDL.Text });
const specialIdl = {
  set_admin_prices: IDL.Func([Prices], [Res], []),
  set_partner_prices: IDL.Func([IDL.Principal, PartnerPrices], [Res], []),
  remove_partner_prices: IDL.Func([IDL.Principal], [Res], []),
  get_special_prices: IDL.Func([], [IDL.Record({
    admin_prices: Prices,
    partners: IDL.Vec(IDL.Record({ principal: IDL.Principal, label: IDL.Text, prices: Prices, expires_at: IDL.Opt(IDL.Int) })),
  })], ['query']),
  get_special_prices_for: IDL.Func([IDL.Principal], [IDL.Record({ admin_prices: IDL.Opt(Prices), partner: IDL.Opt(PartnerPrices) })], ['query']),
};
const fullIdl = ({ IDL }) => IDL.Service({ ...Object.fromEntries(factoryIdl({ IDL })._fields), ...icrc3Service(IDL), ...specialIdl });

let pic, rootKey, appSubnet, icpId, premiumId, factoryId;
let icp, premium, f;
const as = (p, id = factoryId) => actorAs(pic, fullIdl, id, p);
const archiveActor = (id) => actorAs(pic, archiveIdl, id, admin);
const P = (p) => hex(p.toUint8Array());
const plain = (v) => {
  if ('Nat' in v) return v.Nat;
  if ('Int' in v) return v.Int;
  if ('Text' in v) return v.Text;
  if ('Blob' in v) return hex(v.Blob);
  if ('Array' in v) return v.Array.map(plain);
  return Object.fromEntries(v.Map.map(([k, x]) => [k, plain(x)]));
};
const verifiedLog = async () => (await verifyLog(as(admin), factoryId, rootKey, archiveActor)).blocks.map((b, i) => ({ i, t: btype(b), ...plain(tx(b)) }));
const lastOf = async (t) => (await verifiedLog()).filter((b) => b.t === t).at(-1);
const deposit = (p, amount) => icp.mint(account(factoryId, principalToSubaccount(p)), amount);
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const opt = (v) => (v === null || v === undefined ? [] : [v]);
const prices = (fee) => ({ mint_fee_e8s: opt(fee) });
/// Mints `appId` as `p` with exactly `amount` deposited; returns what was charged and the mint block.
async function mintPaying(p, appId, amount) {
  await deposit(p, amount);
  const before = await f.getUserPaymentBalance(p);
  const id = unwrap(await as(p).mintCanister(appId, [], [], [])).canisterId;
  const charged = before - (await f.getUserPaymentBalance(p));
  const block = await lastOf('sneedapp_mint');
  expect(block.canister_id).toBe(P(id));
  return { id, charged, block };
}

beforeAll(async () => {
  ({ pic, appSubnet, rootKey } = await createPic());
  icpId = await install(pic, { name: 'MockLedgerFaulty', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  await install(pic, { name: 'MockCmc', targetCanisterId: CMC_ID });
  premiumId = await install(pic, { name: 'MockPremium' });
  factoryId = await install(pic, { name: SNEEDAPP_WASM, cycles: 200n * T, targetSubnetId: appSubnet });
  icp = actorAs(pic, ledgerIdl, icpId, admin);
  premium = actorAs(pic, premiumIdl, premiumId, admin);
  f = as(admin);
  await f.setFeeDestination(account(treasury));
  await f.setSneedPremiumCanisterId([premiumId]);
  await f.addAdmin(ops);
  await f.addAdmin(adminCanister);
  const v = { major: 1n, minor: 0n, patch: 0n, wasmHash: '', wasmUrl: [], sourceUrl: [], releaseNotes: '', releaseDate: 0n };
  // a Sneed DAO app (publisher 0): 1 ICP, 0.75 ICP for members (prices here stay above 0.63 ICP, so
  // the whole price is spent: below that the cycles are capped and one unused ledger fee stays behind)
  const daoApp = unwrap(await f.addApp(0n, { appId: 'dao-app', name: 'DAO App', description: '', iconUrl: [], mintPriceE8s: ICP, premiumMintPriceE8s: 75_000_000n, viewUrl: [], manageUrl: [], mintUrl: [], families: [] }));
  await f.addAppVersion('dao-app', v);
  await f.uploadAppVersionWasm('dao-app', 1n, 0n, 0n, wasmV1);
  unwrap(await f.setAppEnabled(daoApp, true));
  // a third-party app (verified publisher 1): 1 ICP, 0.8 ICP for members
  unwrap(await as(alice).createPublisher({ name: 'Alice Labs', description: '', websiteUrl: [], logoUrl: [], links: [], defaultPaymentAccount: account(alice) }));
  await f.verifyPublisher(1n);
  const pubApp = unwrap(await as(alice).addApp(1n, { appId: 'pub-app', name: 'Pub App', description: '', iconUrl: [], mintPriceE8s: ICP, premiumMintPriceE8s: 80_000_000n, viewUrl: [], manageUrl: [], mintUrl: [], families: [] }));
  await as(alice).addAppVersion('pub-app', v);
  await as(alice).uploadAppVersionWasm('pub-app', 1n, 0n, 0n, wasmV1);
  unwrap(await as(alice).setAppEnabled(pubApp, true));
  await f.setManagerWasm(wasm('sneed_icp_staking_bot'));
}, 180_000);

afterAll(async () => { await pic?.tearDown(); });

describe('defaults', () => {
  it('starts with no special prices: public and empty', async () => {
    expect(await f.get_special_prices()).toEqual({ admin_prices: prices(null), partners: [] });
    expect(await f.get_special_prices_for(admin)).toEqual({ admin_prices: [prices(null)], partner: [] });
    expect(await f.get_special_prices_for(carol)).toEqual({ admin_prices: [], partner: [] });
  });

  it('charges the regular and premium prices exactly as before, with price_tier on the mint block', async () => {
    expect(await f.getAppMintPrice('dao-app', carol)).toEqual({ regular: ICP, premium: 75_000_000n, applicable: ICP, isPremium: false });
    const r = await mintPaying(carol, 'dao-app', ICP);
    expect(r.charged).toBe(ICP);
    expect(r.block).toMatchObject({ price_e8s: ICP, premium: 0n, price_tier: 'regular' });
    await premium.set_member(dave, (await nowNs()) + 1000n * HOUR);
    const m = await mintPaying(dave, 'dao-app', 75_000_000n);
    expect(m.charged).toBe(75_000_000n);
    expect(m.block).toMatchObject({ price_e8s: 75_000_000n, premium: 1n, price_tier: 'premium' });
    // the admin pays the regular price while no admin price is set
    const a = await mintPaying(admin, 'dao-app', ICP);
    expect(a.charged).toBe(ICP);
    expect(a.block.price_tier).toBe('regular');
  }, 180_000);
});

describe('setting special prices', () => {
  it('only admins can set them', async () => {
    await expect(as(carol).set_admin_prices(prices(1n))).rejects.toThrow();
    await expect(as(carol).set_partner_prices(carol, { label: 'me', prices: prices(1n), expires_at: [] })).rejects.toThrow();
    await expect(as(carol).remove_partner_prices(carol)).rejects.toThrow();
    expect(await f.get_special_prices()).toEqual({ admin_prices: prices(null), partners: [] });
  });

  it('validates partner entries', async () => {
    const now = await nowNs();
    expect(errOf(await f.set_partner_prices(bob, { label: '  ', prices: prices(1n), expires_at: [] }))).toMatch(/label/);
    expect(errOf(await f.set_partner_prices(bob, { label: 'x'.repeat(101), prices: prices(1n), expires_at: [] }))).toMatch(/at most 100/);
    expect(errOf(await f.set_partner_prices(bob, { label: 'a partner game canister', prices: prices(1n), expires_at: [now - SEC] }))).toMatch(/past/);
    expect(errOf(await f.set_partner_prices(Principal.anonymous(), { label: 'nobody', prices: prices(1n), expires_at: [] }))).toMatch(/anonymous/);
    expect(errOf(await f.set_partner_prices(bob, { label: 'huge', prices: prices(1n << 64n), expires_at: [] }))).toMatch(/nat64/);
    expect(errOf(await f.set_admin_prices(prices(1n << 64n)))).toMatch(/nat64/);
    expect(errOf(await f.remove_partner_prices(bob))).toMatch(/No partner/);
    expect((await f.get_special_prices()).partners).toEqual([]);
  });
});

describe('admin price', () => {
  it('applies to people on the admin list only, for Sneed DAO apps, and is logged', async () => {
    unwrap(await f.set_admin_prices(prices(65_000_000n)));
    const cfg = await lastOf('sneedapp_config_update');
    expect(cfg).toMatchObject({ caller: P(admin), key: 'admin_prices', value: { mint_fee_e8s: 65_000_000n }, old_value: {} });
    expect(await f.get_special_prices_for(ops)).toEqual({ admin_prices: [prices(65_000_000n)], partner: [] });
    expect(await f.get_special_prices_for(carol)).toEqual({ admin_prices: [], partner: [] });
    expect(await f.get_special_prices_for(adminCanister)).toEqual({ admin_prices: [], partner: [] }); // canisters never get it
    expect((await f.getAppMintPrice('dao-app', ops)).applicable).toBe(65_000_000n);
    expect((await f.getAppMintPrice('dao-app', carol)).applicable).toBe(ICP);
    const a = await mintPaying(ops, 'dao-app', 65_000_000n);
    expect(a.charged).toBe(65_000_000n);
    expect(a.block).toMatchObject({ price_e8s: 65_000_000n, price_tier: 'admin' });
    const c = await mintPaying(carol, 'dao-app', ICP);
    expect(c.charged).toBe(ICP);
    expect(c.block.price_tier).toBe('regular');
  }, 180_000);

  it('never overrides a third-party publisher\'s price', async () => {
    expect((await f.getAppMintPrice('pub-app', ops)).applicable).toBe(ICP);
    const r = await mintPaying(ops, 'pub-app', ICP);
    expect(r.charged).toBe(ICP);
    expect(r.block.price_tier).toBe('regular');
  }, 180_000);

  it('applies to the legacy createNeuronManager', async () => {
    await deposit(ops, 65_000_000n);
    const before = await f.getUserPaymentBalance(ops);
    unwrap(await as(ops).createNeuronManager());
    expect(before - (await f.getUserPaymentBalance(ops))).toBe(65_000_000n);
    expect(await lastOf('sneedapp_mint')).toMatchObject({ method: 'createNeuronManager', price_e8s: 65_000_000n, price_tier: 'admin' });
  }, 180_000);

  it('an admin price too low to cover the cycles is refused at mint time, like a regular price, and nothing is charged', async () => {
    unwrap(await f.set_admin_prices(prices(10_000_000n)));
    await deposit(ops, 10_000_000n);
    const before = await f.getUserPaymentBalance(ops);
    expect(errOf(await as(ops).mintCanister('dao-app', [], [], [])).CanisterCreationFailed).toMatch(/too low/);
    expect(await f.getUserPaymentBalance(ops)).toBe(before);
    unwrap(await as(ops).withdrawUserPayment());
    unwrap(await f.set_admin_prices(prices(null)));
    expect((await f.getAppMintPrice('dao-app', ops)).applicable).toBe(ICP);
    expect(await lastOf('sneedapp_config_update')).toMatchObject({ key: 'admin_prices', value: {}, old_value: { mint_fee_e8s: 10_000_000n } });
  }, 180_000);
});

describe('partner prices', () => {
  it('apply to that principal only, until the expiry, and are public and logged', async () => {
    const expires = (await nowNs()) + HOUR;
    const entry = { label: 'a partner game canister', prices: prices(80_000_000n), expires_at: [expires] };
    unwrap(await f.set_partner_prices(bob, entry));
    expect(await lastOf('sneedapp_config_update')).toMatchObject({
      caller: P(admin), key: 'partner_prices', partner: P(bob),
      value: { label: 'a partner game canister', prices: { mint_fee_e8s: 80_000_000n }, expires_at: expires },
    });
    expect(await f.get_special_prices()).toEqual({ admin_prices: prices(null), partners: [{ principal: bob, ...entry }] });
    expect(await f.get_special_prices_for(bob)).toEqual({ admin_prices: [], partner: [entry] });
    expect(await f.get_special_prices_for(carol)).toEqual({ admin_prices: [], partner: [] });
    const b = await mintPaying(bob, 'dao-app', 80_000_000n);
    expect(b.charged).toBe(80_000_000n);
    expect(b.block.price_tier).toBe('partner');
    const c = await mintPaying(carol, 'dao-app', ICP);
    expect(c.charged).toBe(ICP);
    // after the expiry: regular again, still listed with its expiry
    await pic.advanceTime(Number((2n * HOUR) / 1_000_000n)); await pic.tick(2);
    expect(await f.get_special_prices_for(bob)).toEqual({ admin_prices: [], partner: [] });
    expect((await f.get_special_prices()).partners.length).toBe(1);
    const late = await mintPaying(bob, 'dao-app', ICP);
    expect(late.charged).toBe(ICP);
    expect(late.block.price_tier).toBe('regular');
  }, 180_000);

  it('the lowest applicable price wins: a member\'s premium price beats a higher partner price, a lower one beats it', async () => {
    await premium.set_member(eve, (await nowNs()) + 1000n * HOUR);
    unwrap(await f.set_partner_prices(eve, { label: 'a partner wallet', prices: prices(80_000_000n), expires_at: [] }));
    const p = await mintPaying(eve, 'dao-app', 75_000_000n);
    expect(p.charged).toBe(75_000_000n);
    expect(p.block.price_tier).toBe('premium');
    unwrap(await f.set_partner_prices(eve, { label: 'a partner wallet', prices: prices(70_000_000n), expires_at: [] }));
    expect(await lastOf('sneedapp_config_update')).toMatchObject({ key: 'partner_prices', partner: P(eve), value: { prices: { mint_fee_e8s: 70_000_000n } }, old_value: { prices: { mint_fee_e8s: 80_000_000n } } });
    const q = await mintPaying(eve, 'dao-app', 70_000_000n);
    expect(q.charged).toBe(70_000_000n);
    expect(q.block.price_tier).toBe('partner');
    // a partner entry without an override for the fee changes nothing
    unwrap(await f.set_partner_prices(frank, { label: 'a partner with no mint price', prices: prices(null), expires_at: [] }));
    expect((await f.getAppMintPrice('dao-app', frank)).applicable).toBe(ICP);
  }, 180_000);

  it('remove_partner_prices removes the entry and logs it', async () => {
    unwrap(await f.remove_partner_prices(frank));
    expect(await lastOf('sneedapp_config_update')).toMatchObject({ key: 'partner_prices', partner: P(frank), value: 'removed', old_value: { label: 'a partner with no mint price', prices: {} } });
    expect((await f.get_special_prices()).partners.map((x) => x.principal.toText()).sort()).toEqual([bob.toText(), eve.toText()].sort());
  });

  it('an upgrade keeps the special prices', async () => {
    unwrap(await f.set_admin_prices(prices(65_000_000n)));
    const before = await f.get_special_prices();
    await pic.upgradeCanister({ sender: admin, canisterId: factoryId, wasm: wasm(SNEEDAPP_WASM), arg: IDL.encode([], []) });
    expect(await f.get_special_prices()).toEqual(before);
  }, 120_000);
});

describe('upgrade from production', () => {
  it('keeps apps, prices and config, and starts with no special prices', async () => {
    const id = await install(pic, { name: 'sneedapp_presp', cycles: 50n * T, targetSubnetId: appSubnet });
    const old = as(admin, id);
    await old.setFeeDestination(account(treasury));
    await old.setCreationFee(123_000_000n);
    await old.setPremiumCreationFee(61_000_000n);
    unwrap(await old.addApp(0n, { appId: 'kept', name: 'Kept', description: '', iconUrl: [], mintPriceE8s: 2n * ICP, premiumMintPriceE8s: ICP, viewUrl: [], manageUrl: [], mintUrl: [], families: [] }));
    const cfg = await old.getPaymentConfig();
    const apps = await old.getApps();
    await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm('sneedapp'), arg: IDL.encode([], []) });
    expect(await old.getPaymentConfig()).toEqual(cfg);
    expect(await old.getPremiumCreationFee()).toBe(61_000_000n);
    expect(await old.getApps()).toEqual(apps);
    expect(await old.get_special_prices()).toEqual({ admin_prices: prices(null), partners: [] });
    expect((await old.getAppMintPrice('kept', admin)).applicable).toBe(2n * ICP);
  }, 120_000);
});
