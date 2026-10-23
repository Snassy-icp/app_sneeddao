// Sneedex DAO settings (spec/dao_settings.md, src/DaoSettings.mo): one generic nervous system
// function for the canister. SNS governance (canisters/MockProxyGov.mo installed at the real
// governance id fi3zi…, calling the validator on submission and the target on adoption, as SNS
// governance does) changes settings with dao_set; validate_dao_set renders the exact change and
// refuses what dao_set would refuse; dao_settings lists the table. Others are refused (another
// canister, admins, anyone by ingress); out-of-bounds, unknown, duplicate, mistyped, cross-rule
// and stale changes are refused, all or nothing; each change is a sneedex_config_update block with
// via = "dao"; queries are refused as updates; and an upgrade from the code before dao_set
// (build/sneedex_predaoset.wasm, commit 4066b698) keeps every setting and offer.
// SNEEDEX_WASM=sneedex_predaoset runs this file against that build to see it fail.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import {
  createPic, install, actorAs, wasm, account, admin, alice, bob, user, ICP_LEDGER_ID, SNEED_GOVERNANCE, T, unwrap, errOf,
  refusedAtIngress, asUpdates,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { archiveIdl, btype, tx, verifyLog } from '../lib/icrc3.js';
import { idlFactory as sneedexIdl, init as sneedexInit } from '../build/sneedex.did.js';

const SNEEDEX_WASM = process.env.SNEEDEX_WASM || 'sneedex';
const E8 = 100_000_000n;
const FN = 6100n; // the Sneedex dao_set GNSF (spec/dao_settings.md §5)

const govIdl = ({ IDL }) => {
  const Status = IDL.Variant({ open: IDL.Null, executed: IDL.Text, failed: IDL.Text });
  return IDL.Service({
    add_function: IDL.Func([IDL.Nat, IDL.Record({ target: IDL.Principal, target_method: IDL.Text, validator: IDL.Principal, validator_method: IDL.Text })], [], []),
    submit: IDL.Func([IDL.Nat, IDL.Vec(IDL.Nat8)], [IDL.Variant({ ok: IDL.Tuple(IDL.Nat, IDL.Text), err: IDL.Text })], []),
    adopt: IDL.Func([IDL.Nat], [Status], []),
    pass: IDL.Func([IDL.Nat, IDL.Vec(IDL.Nat8)], [IDL.Variant({ ok: IDL.Tuple(IDL.Nat, Status), err: IDL.Text })], []),
    call_raw: IDL.Func([IDL.Principal, IDL.Text, IDL.Vec(IDL.Nat8)], [IDL.Variant({ ok: IDL.Vec(IDL.Nat8), err: IDL.Text })], []),
  });
};

// dao_set's argument type, from Sneedex's generated interface (what the proposal payload encodes)
const SetArgsT = sneedexIdl({ IDL })._fields.find(([n]) => n === 'dao_set')?.[1].argTypes;
const change = (setting, value, expected) => ({ setting, value, expected: expected === undefined ? [] : [expected] });
const payload = (...changes) => new Uint8Array(IDL.encode(SetArgsT, [{ changes }]));
const N = (n) => ({ Nat: BigInt(n) });
const NONE = { Null: null };

let pic, rootKey, appSubnet, icpId, dexId, govId, impostorId;
let gov, impostor, dexAdmin, dexBob;

const hex = (b) => Buffer.from(b).toString('hex');
const P = (p) => hex(p.toUint8Array());
const plain = (v) => {
  if ('Nat' in v) return v.Nat;
  if ('Int' in v) return v.Int;
  if ('Text' in v) return v.Text;
  if ('Blob' in v) return hex(v.Blob);
  if ('Array' in v) return v.Array.map(plain);
  return Object.fromEntries(v.Map.map(([k, x]) => [k, plain(x)]));
};
const archiveActor = (id) => actorAs(pic, archiveIdl, id, admin);
const verifiedLog = async (id = dexId) => {
  const { blocks } = await verifyLog(actorAs(pic, sneedexIdl, id, admin), id, rootKey, archiveActor);
  return blocks.map((b, i) => ({ i, t: btype(b), ...plain(tx(b)) }));
};
const logLength = async (id = dexId) => Number((await actorAs(pic, sneedexIdl, id, admin).icrc3_log_status()).log_length);
const since = async (mark, id = dexId) => (await verifiedLog(id)).slice(mark);
const setting = async (name, actor = dexBob) => (await actor.dao_settings()).find((s) => s.name === name);

/// Submit (validator) and adopt (target) a dao_set proposal; { ok: [id, status] } or { err: validator text }.
const propose = (...changes) => gov.pass(FN, payload(...changes));
const executed = (r) => unwrap(r)[1].executed;
const failed = (r) => unwrap(r)[1].failed;

beforeAll(async () => {
  ({ pic, rootKey, appSubnet } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 10_000n, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  dexId = await install(pic, { name: SNEEDEX_WASM, initTypes: sneedexInit({ IDL }), initArgs: [[]], cycles: 50n * T, targetSubnetId: appSubnet });
  govId = await install(pic, { name: 'MockProxyGov', targetCanisterId: SNEED_GOVERNANCE });
  impostorId = await install(pic, { name: 'MockProxyGov', targetSubnetId: appSubnet });
  gov = actorAs(pic, govIdl, govId, admin);
  impostor = actorAs(pic, govIdl, impostorId, admin);
  const fn = { target: dexId, target_method: 'dao_set', validator: dexId, validator_method: 'validate_dao_set' };
  await gov.add_function(FN, fn);
  await impostor.add_function(FN, fn);
  dexAdmin = actorAs(pic, sneedexIdl, dexId, admin);
  dexBob = actorAs(pic, sneedexIdl, dexId, bob);
}, 180_000);
afterAll(async () => { await pic?.tearDown(); });

describe('dao_settings', () => {
  it('lists every DAO-settable setting with its kind, unit, bounds and current value', async () => {
    const all = await dexBob.dao_settings();
    expect(all.map((s) => s.name)).toEqual([
      'offer_creation_fee_e8s', 'premium_offer_creation_fee_e8s', 'marketplace_fee_rate_bps', 'premium_auction_cut_bps',
      'admin_prices.offer_creation_fee_e8s', 'admin_prices.auction_cut_bps', 'min_offer_duration_ns', 'max_assets_per_offer',
      'min_increment_usd_range_min', 'min_increment_usd_range_max', 'min_increment_usd_target', 'min_increment_fallback_tokens',
      'expiration_check_interval_seconds', 'neuron_info_cache_staleness_seconds',
      ...['createOffer', 'createOffer_premium', 'reserveBid', 'confirmBid', 'cancelOffer'].flatMap((a) => [`rate_limit.${a}.capacity`, `rate_limit.${a}.per_minute`]),
    ]);
    const fee = all[1];
    expect(fee).toEqual({
      name: 'premium_offer_creation_fee_e8s', label: 'premium offer creation fee',
      description: 'ICP charged to Sneed Premium members for creating an offer (0 = free).',
      kind: { Nat: null }, unit: { Token: { symbol: 'ICP', decimals: 8 } }, min: [0n], max: [1_000_000_000n], value: N(0), rendered: '0 ICP',
    });
    expect(await setting('admin_prices.auction_cut_bps')).toMatchObject({ kind: { OptNat: null }, unit: { Bps: null }, value: NONE, rendered: 'none' });
    expect(await setting('min_offer_duration_ns')).toMatchObject({ value: N(3_600_000_000_000), rendered: '1 h' });
    expect(await setting('min_increment_usd_target')).toMatchObject({ value: N(500), rendered: '$5.00' });
    expect(await setting('rate_limit.createOffer.capacity')).toMatchObject({ value: N(100), rendered: '100', min: [0n] });
    expect(await dexBob.get_dao_settings_access()).toEqual({ governance: SNEED_GOVERNANCE, admins_too: false });
  });
});

describe('validate_dao_set', () => {
  it('renders the exact change, with units and old → new, one line per setting', async () => {
    const r = await dexBob.validate_dao_set({ changes: [change('premium_offer_creation_fee_e8s', N(200_000)), change('marketplace_fee_rate_bps', N(250))] });
    expect(r).toEqual({ Ok:
      'Sneedex: premium offer creation fee 0 → 0.002 ICP [premium_offer_creation_fee_e8s: 0 → 200000]\n' +
      'Sneedex: marketplace cut 0% → 2.5% [marketplace_fee_rate_bps: 0 → 250]' });
    expect(await dexBob.validate_dao_set({ changes: [change('expiration_check_interval_seconds', N(7200)), change('admin_prices.auction_cut_bps', N(100)),
      change('min_increment_usd_target', N(750)), change('min_increment_fallback_tokens', N(5 * 10 ** 7))] })).toEqual({ Ok:
      'Sneedex: expiration sweep interval 1 h → 2 h [expiration_check_interval_seconds: 3600 → 7200]\n' +
      'Sneedex: admin price: marketplace cut none → 1% [admin_prices.auction_cut_bps: none → 100]\n' +
      'Sneedex: bid increment: suggested $5.00 → $7.50 [min_increment_usd_target: 500 → 750]\n' +
      'Sneedex: bid increment: fallback without a USD price 100000000 → 50000000 base units [min_increment_fallback_tokens: 100000000 → 50000000]' });
  });

  it('refuses what dao_set would refuse, with the reason', async () => {
    const v = async (...c) => (await dexBob.validate_dao_set({ changes: c })).Err;
    expect(await v()).toBe('no changes');
    expect(await v(change('marketplace_fee_rate_bps', N(5001)))).toBe('marketplace_fee_rate_bps: 50.01% is above the maximum 50%');
    expect(await v(change('offer_creation_fee_e8s', N(1_000_000_001)))).toBe('offer_creation_fee_e8s: 10.00000001 ICP is above the maximum 10 ICP');
    expect(await v(change('offer_creation_fee_e8s', N(9_999)))).toBe('offer_creation_fee_e8s: 0 (free) or at least 0.0001 ICP');
    expect(await v(change('expiration_check_interval_seconds', N(59)))).toBe('expiration_check_interval_seconds: 59 s is below the minimum 1 min');
    expect(await v(change('rate_limit.reserveBid.per_minute', N(0)))).toBe('rate_limit.reserveBid.per_minute: 0 is below the minimum 1');
    expect(await v(change('fee_recipient', { Account: account(bob) }))).toBe('unknown setting fee_recipient (see dao_settings())');
    expect(await v(change('marketplace_fee_rate_bps', { Bool: true }))).toBe('marketplace_fee_rate_bps: expected nat, got true');
    expect(await v(change('marketplace_fee_rate_bps', NONE))).toBe('marketplace_fee_rate_bps: expected nat, got none');
    expect(await v(change('marketplace_fee_rate_bps', N(1)), change('marketplace_fee_rate_bps', N(2)))).toBe('marketplace_fee_rate_bps appears twice');
    expect(await v(change('marketplace_fee_rate_bps', N(0)))).toBe('marketplace_fee_rate_bps is already 0');
    expect(await v(change('marketplace_fee_rate_bps', N(10), N(5)))).toBe('marketplace_fee_rate_bps is now 0, the proposal expected 5 (changed since it was made)');
    expect(await v(change('min_increment_usd_target', N(1001)))).toBe('bid increment: the suggested value must lie between the low and high warnings');
    expect(await v(...Array.from({ length: 33 }, (_, i) => change(`x${i}`, N(i))))).toBe('at most 32 changes per proposal');
    // the cross rule holds on the state after the batch: moving the range and the target together is fine
    expect((await dexBob.validate_dao_set({ changes: [change('min_increment_usd_target', N(1500)), change('min_increment_usd_range_max', N(2000))] })).Ok).toBeDefined();
  });
});

describe('dao_set by governance', () => {
  it('applies an adopted proposal, replies with the rendering, and logs one block per change with via = "dao"', async () => {
    const mark = await logLength();
    const r = await propose(change('premium_offer_creation_fee_e8s', N(200_000), N(0)), change('offer_creation_fee_e8s', N(500_000)),
      change('marketplace_fee_rate_bps', N(250)), change('admin_prices.auction_cut_bps', N(100)));
    expect(executed(r)).toBe(
      'Sneedex: premium offer creation fee 0 → 0.002 ICP [premium_offer_creation_fee_e8s: 0 → 200000]\n' +
      'Sneedex: offer creation fee 0 → 0.005 ICP [offer_creation_fee_e8s: 0 → 500000]\n' +
      'Sneedex: marketplace cut 0% → 2.5% [marketplace_fee_rate_bps: 0 → 250]\n' +
      'Sneedex: admin price: marketplace cut none → 1% [admin_prices.auction_cut_bps: none → 100]');
    expect(await dexBob.getFeeConfig()).toEqual({ regularCreationFeeE8s: 500_000n, premiumCreationFeeE8s: 200_000n, regularAuctionCutBps: 250n, premiumAuctionCutBps: 0n });
    expect((await dexBob.get_special_prices()).admin_prices).toEqual({ offer_creation_fee_e8s: [], auction_cut_bps: [100n] });
    const blocks = await since(mark);
    expect(blocks.map((b) => [b.t, b.caller, b.via, b.key, b.value, b.old_value])).toEqual([
      ['sneedex_config_update', P(SNEED_GOVERNANCE), 'dao', 'premium_offer_creation_fee_e8s', 200_000n, 0n],
      ['sneedex_config_update', P(SNEED_GOVERNANCE), 'dao', 'offer_creation_fee_e8s', 500_000n, 0n],
      ['sneedex_config_update', P(SNEED_GOVERNANCE), 'dao', 'marketplace_fee_rate_bps', 250n, 0n],
      ['sneedex_config_update', P(SNEED_GOVERNANCE), 'dao', 'admin_prices.auction_cut_bps', 100n, 'none'],
    ]);
  });

  it('sets config fields, rate limits and the sweep interval (restarting a running timer)', async () => {
    unwrap(await dexAdmin.startExpirationTimer());
    const r = await propose(change('max_assets_per_offer', N(20)), change('min_offer_duration_ns', N(2 * 3_600_000_000_000)),
      change('rate_limit.createOffer.capacity', N(5)), change('rate_limit.createOffer.per_minute', N(2)),
      change('expiration_check_interval_seconds', N(600)), change('admin_prices.auction_cut_bps', NONE));
    expect(executed(r)).toContain('Sneedex: minimum offer duration 1 h → 2 h');
    const cfg = await dexBob.getConfig();
    expect([cfg.max_assets_per_offer, cfg.min_offer_duration_ns]).toEqual([20n, 7_200_000_000_000n]);
    expect(new Map(await dexBob.getRateLimits()).get('createOffer')).toEqual({ capacity: 5n, per_minute: 2n });
    expect(new Map(await dexBob.getRateLimits()).get('reserveBid')).toEqual({ capacity: 60n, per_minute: 20n }); // untouched
    expect(await dexBob.getExpirationCheckInterval()).toBe(600n);
    expect(await dexBob.isExpirationTimerRunning()).toBe(true);
    expect((await dexBob.get_special_prices()).admin_prices.auction_cut_bps).toEqual([]);
    // the new rate limit is in force: a sixth offer in a burst is refused
    const dexAlice = actorAs(pic, sneedexIdl, dexId, alice);
    unwrap(await dexAdmin.setOfferCreationFee(0n)); // admins keep their own setters
    const req = { min_bid_price: [E8], buyout_price: [2n * E8], expiration: [], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: [], note_to_buyer: [] };
    for (let i = 0; i < 5; i++) unwrap(await dexAlice.createOffer(req));
    expect(await refusedAtIngress(dexAlice.createOffer(req))).toBe(true);
    unwrap(await dexAdmin.stopExpirationTimer());
  });

  it('is all or nothing: one bad change fails the whole proposal and changes nothing', async () => {
    const before = await dexBob.dao_settings();
    // the validator would refuse it; governance only executes what passed, so call the target directly as governance
    const r = unwrap(await gov.submit(FN, payload(change('marketplace_fee_rate_bps', N(300))))); // a valid proposal, adopted later
    const bad = await gov.call_raw(dexId, 'dao_set', payload(change('marketplace_fee_rate_bps', N(400)), change('max_assets_per_offer', N(51))));
    expect(bad.err).toMatch(/max_assets_per_offer: 51 is above the maximum 50/);
    expect(await dexBob.dao_settings()).toEqual(before);
    expect((await gov.adopt(r[0])).executed).toBe('Sneedex: marketplace cut 2.5% → 3% [marketplace_fee_rate_bps: 250 → 300]');
  });

  it('fails a stale proposal: the value changed between submission and adoption', async () => {
    const [id, text] = unwrap(await gov.submit(FN, payload(change('premium_auction_cut_bps', N(150), N(0)))));
    expect(text).toBe('Sneedex: premium marketplace cut 0% → 1.5% [premium_auction_cut_bps: 0 → 150]');
    unwrap(await dexAdmin.setPremiumAuctionCutBps(100n)); // an admin changes it while the vote runs
    const s = await gov.adopt(id);
    expect(s.failed).toMatch(/premium_auction_cut_bps is now 100, the proposal expected 0 \(changed since it was made\)/);
    expect(await dexBob.getPremiumAuctionCutBps()).toBe(100n);
    // without `expected`, a value already reached is skipped at execution (no block)
    const [id2] = unwrap(await gov.submit(FN, payload(change('premium_auction_cut_bps', N(120)))));
    unwrap(await dexAdmin.setPremiumAuctionCutBps(120n));
    const mark = await logLength();
    expect((await gov.adopt(id2)).executed).toBe('Sneedex: nothing to change (every setting already held its new value)');
    expect(await logLength()).toBe(mark);
  });
});

describe('who may call dao_set', () => {
  it('refuses another canister, and refuses everyone by ingress (admins and controllers included)', async () => {
    const before = await dexBob.dao_settings();
    expect((await impostor.call_raw(dexId, 'dao_set', payload(change('marketplace_fee_rate_bps', N(1))))).err).toMatch(/Only Sneed DAO governance can call dao_set/);
    for (const p of [bob, admin]) {
      expect(await refusedAtIngress(actorAs(pic, sneedexIdl, dexId, p).dao_set({ changes: [change('marketplace_fee_rate_bps', N(1))] }))).toBe(true);
    }
    expect(await dexBob.dao_settings()).toEqual(before);
  });

  it('lets a controller repoint governance and admit admins (staging); nobody else may', async () => {
    expect(await refusedAtIngress(dexBob.set_dao_settings_access(bob, true))).toBe(true);
    const dave = user('dave');
    unwrap(await dexAdmin.addAdmin(dave)); // a listed admin who is not a controller
    const dexDave = actorAs(pic, sneedexIdl, dexId, dave);
    expect(await refusedAtIngress(dexDave.set_dao_settings_access(dave, true))).toBe(true);
    const mark = await logLength();
    unwrap(await dexAdmin.set_dao_settings_access(impostorId, true));
    expect(await dexBob.get_dao_settings_access()).toEqual({ governance: impostorId, admins_too: true });
    expect(await dexDave.dao_set({ changes: [change('max_assets_per_offer', N(21))] })).toBe('Sneedex: maximum assets per offer 20 → 21 [max_assets_per_offer: 20 → 21]');
    expect(executed(await impostor.pass(FN, payload(change('max_assets_per_offer', N(22)))))).toContain('21 → 22');
    expect(failed(await gov.pass(FN, payload(change('max_assets_per_offer', N(23)))))).toMatch(/Only Sneed DAO governance/);
    expect(await refusedAtIngress(dexBob.dao_set({ changes: [change('max_assets_per_offer', N(24))] }))).toBe(true); // not an admin
    const blocks = await since(mark);
    expect(blocks.map((b) => [b.key, b.caller, b.via])).toEqual([
      ['dao_settings_access', P(admin), undefined], ['max_assets_per_offer', P(dave), 'dao'], ['max_assets_per_offer', P(impostorId), 'dao'],
    ]);
    unwrap(await dexAdmin.set_dao_settings_access(SNEED_GOVERNANCE, false));
    expect(await refusedAtIngress(dexDave.dao_set({ changes: [change('max_assets_per_offer', N(25))] }))).toBe(true);
  });

  it('refuses its queries as update calls', async () => {
    const asUpd = actorAs(pic, asUpdates(sneedexIdl), dexId, bob);
    for (const call of [() => asUpd.dao_settings(), () => asUpd.get_dao_settings_access(), () => asUpd.validate_dao_set({ changes: [change('max_assets_per_offer', N(5))] })]) {
      expect(await refusedAtIngress(call())).toBe(true);
    }
  });
});

describe('upgrade', () => {
  it('from the code before dao_set keeps every setting and offer, and dao_set works after it', async () => {
    const oldId = await install(pic, { name: 'sneedex_predaoset', initTypes: sneedexInit({ IDL }), initArgs: [[]], cycles: 50n * T, targetSubnetId: appSubnet });
    const old = actorAs(pic, sneedexIdl, oldId, admin);
    unwrap(await old.setOfferCreationFee(300_000n));
    unwrap(await old.setPremiumOfferCreationFee(100_000n));
    unwrap(await old.setMarketplaceFeeRate(200n));
    unwrap(await old.setRateLimit('reserveBid', [{ capacity: 7n, per_minute: 3n }]));
    unwrap(await old.set_admin_prices({ offer_creation_fee_e8s: [0n], auction_cut_bps: [] }));
    unwrap(await old.setMinIncrementSettings(200n, 3000n, 600n, 2n * E8));
    unwrap(await old.setFeeRecipient(account(user('treasury'))));
    const offerReq = { min_bid_price: [E8], buyout_price: [2n * E8], expiration: [], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: [], note_to_buyer: [] };
    unwrap(await old.setOfferCreationFee(0n)); unwrap(await old.createOffer(offerReq)); unwrap(await old.setOfferCreationFee(300_000n));
    const logBefore = await logLength(oldId);
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(SNEEDEX_WASM), arg: IDL.encode(sneedexInit({ IDL }), [[]]) });
    const now = actorAs(pic, sneedexIdl, oldId, bob);
    expect(await now.getFeeConfig()).toEqual({ regularCreationFeeE8s: 300_000n, premiumCreationFeeE8s: 100_000n, regularAuctionCutBps: 200n, premiumAuctionCutBps: 0n });
    expect(new Map(await now.getRateLimits()).get('reserveBid')).toEqual({ capacity: 7n, per_minute: 3n });
    expect((await now.getFeeRecipient()).owner.toText()).toBe(user('treasury').toText());
    expect(await now.getMinIncrementSettings()).toEqual({ usd_range_min: 200n, usd_range_max: 3000n, usd_target: 600n, fallback_tokens: 2n * E8 });
    expect(await now.getNextOfferId()).toBe(1n);
    expect(await logLength(oldId)).toBe(logBefore);
    const byName = Object.fromEntries((await now.dao_settings()).map((s) => [s.name, s.rendered]));
    expect(byName).toMatchObject({ offer_creation_fee_e8s: '0.003 ICP', 'admin_prices.offer_creation_fee_e8s': '0 ICP', 'rate_limit.reserveBid.capacity': '7', min_increment_usd_target: '$6.00' });
    expect(await now.get_dao_settings_access()).toEqual({ governance: SNEED_GOVERNANCE, admins_too: false });
    await gov.add_function(FN + 1n, { target: oldId, target_method: 'dao_set', validator: oldId, validator_method: 'validate_dao_set' });
    expect(executed(await gov.pass(FN + 1n, payload(change('offer_creation_fee_e8s', N(400_000), N(300_000)))))).toBe(
      'Sneedex: offer creation fee 0.003 → 0.004 ICP [offer_creation_fee_e8s: 300000 → 400000]');
    // and a second upgrade keeps the DAO access settings
    unwrap(await actorAs(pic, sneedexIdl, oldId, admin).set_dao_settings_access(impostorId, false));
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(SNEEDEX_WASM), arg: IDL.encode(sneedexInit({ IDL }), [[]]) });
    expect(await now.get_dao_settings_access()).toEqual({ governance: impostorId, admins_too: false });
    expect(await now.getOfferCreationFee()).toBe(400_000n);
  });
});
