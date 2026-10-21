// Sneedex special prices (spec/special_prices.md): an admin price (for Sneedex admins who are
// people) and partner prices (per principal, public label, optional expiry) next to the regular
// and premium offer creation fee and auction cut. The lowest applicable price is charged; with
// nothing set Sneedex charges exactly as before. Setters are admin-only and validated, every
// change is a sneedex_config_update block, and the fee and cut blocks carry `price_tier`. An
// upgrade from the production source (build/sneedex_presp.wasm, commit f9d8db0b) keeps the
// offers and fees and starts with no special prices.
// SNEEDEX_WASM=sneedex_presp npx vitest run tests/sneedex-special-prices.test.js runs it against
// the production code (the special-price tests fail there).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, wasm, account, admin, alice, bob, carol, user, ICP_LEDGER_ID, T, unwrap, errOf, paymentSubaccount } from '../lib/pic.js';
import { ledgerIdl, ledgerInit, premiumIdl } from '../lib/idl.js';
import { btype, tx } from '../lib/icrc3.js';
import { idlFactory as sneedexIdl, init as sneedexInit } from '../build/sneedex.did.js';

const SNEEDEX_WASM = process.env.SNEEDEX_WASM || 'sneedex';
const ICP_FEE = 10_000n;
const FEE_A = 1_000n;
const E8 = 100_000_000n;
const DAY = 86_400;
const SEC = 1_000_000_000n;
const dave = user('dave'); // a listed admin who is not a controller
const erin = user('erin'); // nobody special
const treasury = user('sp-treasury');

let pic, appSubnet, icpId, tokenAId, premiumId, dexId;
let icp, tokenA, premium;

const as = (p, id = dexId) => actorAs(pic, sneedexIdl, id, p);
const icpAs = (p) => actorAs(pic, ledgerIdl, icpId, p);
const tokenAAs = (p) => actorAs(pic, ledgerIdl, tokenAId, p);
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const inSeconds = async (s) => (await nowNs()) + BigInt(s) * SEC;
const settle = async (seconds = 5, rounds = 10) => { await pic.advanceTime(seconds * 1000); for (let i = 0; i < rounds; i++) await pic.tick(2); };
const balance = (ledger, owner, sub = null) => ledger.icrc1_balance_of(account(owner, sub));
const transfer = (ledger, to, amount) => ledger.icrc1_transfer({ from_subaccount: [], to, amount, fee: [], memo: [], created_at_time: [] });
const offerReq = (o = {}) => ({ min_bid_price: [E8], buyout_price: [], expiration: [], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: [], note_to_buyer: [], ...o });
const offer = async (id) => (await as(erin).queryOffer(id))[0];
const NONE = { offer_creation_fee_e8s: [], auction_cut_bps: [] };
const prices = (fee, cut) => ({ offer_creation_fee_e8s: fee === null ? [] : [fee], auction_cut_bps: cut === null ? [] : [cut] });
const tierOf = (t) => Object.keys(t)[0];

const hex = (b) => Buffer.from(b).toString('hex');
const plain = (v) => {
  if ('Nat' in v) return v.Nat;
  if ('Int' in v) return v.Int;
  if ('Text' in v) return v.Text;
  if ('Blob' in v) return hex(v.Blob);
  if ('Array' in v) return v.Array.map(plain);
  return Object.fromEntries(v.Map.map(([k, x]) => [k, plain(x)]));
};
const P = (p) => hex(p.toUint8Array());
const blocks = async (id = dexId) => {
  const r = await as(admin, id).icrc3_get_blocks([{ start: 0n, length: 10_000n }]);
  return r.blocks.map((b) => ({ t: btype(b.block), ...plain(tx(b.block)) }));
};

/// Pay the creation fee into `who`'s payment subaccount and create an offer; returns [offerId, fee paid].
const createPaid = async (who, o = {}) => {
  const fee = await as(erin).getEffectiveOfferCreationFee(who);
  if (fee > 0n) unwrap(await transfer(icpAs(who), account(dexId, paymentSubaccount(who)), fee));
  const before = await balance(icp, treasury);
  const id = unwrap(await as(who).createOffer(offerReq({ buyout_price: [E8], ...o })));
  const charged = (await balance(icp, treasury)) - before;
  return [id, fee, charged];
};

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  premiumId = await install(pic, { name: 'MockPremium', targetSubnetId: appSubnet });
  dexId = await install(pic, { name: SNEEDEX_WASM, initTypes: sneedexInit({ IDL }), initArgs: [[]], cycles: 50n * T, targetSubnetId: appSubnet });
  icp = icpAs(admin); tokenA = tokenAAs(admin);
  premium = actorAs(pic, premiumIdl, premiumId, admin);
  for (const p of [alice, bob, carol, admin, dave, erin]) {
    await icp.mint(account(p), 1_000n * E8);
    await tokenA.mint(account(p), 1_000n * E8);
  }
  const a = as(admin);
  unwrap(await a.addAdmin(dave));
  unwrap(await a.setSneedPremiumCanisterId([premiumId]));
  unwrap(await a.setLedgerFeeRecipient(icpId, account(treasury)));
  unwrap(await a.setOfferCreationFee(50_000_000n));
  unwrap(await a.setPremiumOfferCreationFee(20_000_000n));
  unwrap(await a.setMarketplaceFeeRate(300n));
  unwrap(await a.setPremiumAuctionCutBps(100n));
  await premium.set_member(bob, (await nowNs()) + 365n * 86_400n * SEC);
  await pic.tick(2);
}, 180_000);
afterAll(async () => { await pic?.tearDown(); });

describe('defaults', () => {
  it('has no special prices and charges regular and premium exactly as before', async () => {
    expect(await as(erin).get_special_prices()).toEqual({ admin_prices: NONE, partners: [] });
    expect(await as(erin).get_special_prices_for(admin)).toEqual({ admin_prices: [NONE], partner: [] });
    expect(await as(erin).get_special_prices_for(alice)).toEqual({ admin_prices: [], partner: [] });
    // an admin with no admin prices set pays the regular price
    for (const [who, fee, cut, tier] of [[alice, 50_000_000n, 300n, 'regular'], [admin, 50_000_000n, 300n, 'regular'], [bob, 20_000_000n, 100n, 'premium']]) {
      const [id, quoted, charged] = await createPaid(who);
      expect(quoted).toBe(fee);
      expect(charged).toBe(fee - ICP_FEE);
      expect((await offer(id)).fee_rate_bps).toBe(cut);
      const tiers = (await as(erin).get_offer_price_tiers(id))[0];
      expect([tierOf(tiers.creation_fee[0]), tierOf(tiers.cut)]).toEqual([tier, tier]);
      unwrap(await as(who).cancelOffer(id));
    }
    const log = await blocks();
    expect(log.filter((b) => b.t === 'sneedex_creation_fee_pay').map((b) => b.price_tier)).toEqual(['regular', 'regular', 'premium']);
    expect(log.filter((b) => b.t === 'sneedex_offer_create').map((b) => [b.cut_price_tier, b.price_tier])).toEqual([['regular', 'regular'], ['regular', 'regular'], ['premium', 'premium']]);
  });
});

describe('setters', () => {
  it('refuses non-admins and leaves the prices as they were', async () => {
    expect(await as(bob).set_admin_prices(prices(1n, 1n))).toHaveProperty('err');
    expect(await as(bob).set_partner_prices(bob, { label: 'x', prices: prices(0n, 0n), expires_at: [] })).toHaveProperty('err');
    unwrap(await as(admin).set_partner_prices(carol, { label: 'a partner game canister', prices: prices(null, 10n), expires_at: [] }));
    expect(await as(bob).remove_partner_prices(carol)).toHaveProperty('err');
    expect(await as(erin).get_special_prices()).toEqual({ admin_prices: NONE, partners: [{ principal: carol, label: 'a partner game canister', prices: prices(null, 10n), expires_at: [] }] });
    unwrap(await as(admin).remove_partner_prices(carol));
  });

  it('validates overrides like the regular fees, and partner entries', async () => {
    const a = as(admin);
    expect((await a.set_admin_prices(prices(null, 5001n))).err).toMatch(/5000/);
    expect((await a.set_partner_prices(carol, { label: 'p', prices: prices(null, 6000n), expires_at: [] })).err).toMatch(/5000/);
    expect((await a.set_partner_prices(Principal.anonymous(), { label: 'p', prices: NONE, expires_at: [] })).err).toMatch(/anonymous/);
    expect((await a.set_partner_prices(carol, { label: '  ', prices: NONE, expires_at: [] })).err).toMatch(/label/);
    expect((await a.set_partner_prices(carol, { label: 'x'.repeat(101), prices: NONE, expires_at: [] })).err).toMatch(/100/);
    expect((await a.set_partner_prices(carol, { label: 'p', prices: NONE, expires_at: [(await nowNs()) - SEC] })).err).toMatch(/past/);
    expect((await a.remove_partner_prices(carol)).err).toMatch(/no partner/);
    expect(await as(erin).get_special_prices()).toEqual({ admin_prices: NONE, partners: [] });
    // the dave (a listed admin) can set them too; 0 is a valid price
    unwrap(await as(dave).set_admin_prices(prices(0n, 0n)));
    unwrap(await as(dave).set_admin_prices(NONE));
  });
});

// Found along the way: a regular creation fee between 1 and 9_999 e8s made every createOffer trap
// (it forwards fee - ledger fee). A fee below the ledger fee was meant as "no fee", so it now is one.
describe('a creation fee below the ledger fee', () => {
  it('means no fee: createOffer works and charges nothing', async () => {
    const a = as(admin);
    unwrap(await a.setOfferCreationFee(5_000n));
    unwrap(await a.setPremiumOfferCreationFee(9_999n));
    let res;
    try {
      const quoted = await as(erin).getEffectiveOfferCreationFee(alice);
      const [id, , charged] = await createPaid(alice);
      res = { quoted, charged };
      unwrap(await as(alice).cancelOffer(id));
    } catch (e) {
      res = { error: String(e).slice(0, 120) };
    } finally {
      // restore before asserting, so a failure here does not break the tests that follow
      unwrap(await a.setOfferCreationFee(50_000_000n));
      unwrap(await a.setPremiumOfferCreationFee(20_000_000n));
    }
    expect(res).toEqual({ quoted: 0n, charged: 0n });
  });
});

describe('admin price', () => {
  it('applies to admins who are people, and to nobody else', async () => {
    unwrap(await as(admin).set_admin_prices(prices(20_000n, 10n)));
    const canisterAdmin = premiumId; // a canister on the admin list (like governance or a proxy) never gets it
    unwrap(await as(admin).addAdmin(canisterAdmin));
    expect(await as(erin).get_special_prices_for(dave)).toEqual({ admin_prices: [prices(20_000n, 10n)], partner: [] });
    expect(await as(erin).get_special_prices_for(canisterAdmin)).toEqual({ admin_prices: [], partner: [] });
    expect(await as(erin).getEffectiveOfferCreationFee(canisterAdmin)).toBe(50_000_000n);
    expect(await as(erin).getEffectiveOfferCreationFee(alice)).toBe(50_000_000n);
    for (const who of [admin, dave]) {
      const [id, quoted, charged] = await createPaid(who);
      expect([quoted, charged]).toEqual([20_000n, 20_000n - ICP_FEE]);
      expect((await offer(id)).fee_rate_bps).toBe(10n);
      const tiers = (await as(erin).get_offer_price_tiers(id))[0];
      expect([tierOf(tiers.creation_fee[0]), tierOf(tiers.cut)]).toEqual(['admin', 'admin']);
      unwrap(await as(who).cancelOffer(id));
    }
    const [id] = await createPaid(alice);
    expect((await offer(id)).fee_rate_bps).toBe(300n);
    unwrap(await as(alice).cancelOffer(id));
    unwrap(await as(admin).removeAdmin(canisterAdmin));
    unwrap(await as(admin).set_admin_prices(NONE));
    expect(await as(erin).getEffectiveOfferCreationFee(dave)).toBe(50_000_000n);
  });
});

describe('partner price', () => {
  it('applies to that principal only, until it expires', async () => {
    const expires = await inSeconds(2 * DAY);
    unwrap(await as(admin).set_partner_prices(carol, { label: 'a partner game canister', prices: prices(1_000_000n, 50n), expires_at: [expires] }));
    expect(await as(erin).get_special_prices_for(carol)).toEqual({ admin_prices: [], partner: [{ label: 'a partner game canister', prices: prices(1_000_000n, 50n), expires_at: [expires] }] });
    expect(await as(erin).getEffectiveOfferCreationFee(alice)).toBe(50_000_000n);
    const [id, quoted, charged] = await createPaid(carol);
    expect([quoted, charged]).toEqual([1_000_000n, 1_000_000n - ICP_FEE]);
    expect((await offer(id)).fee_rate_bps).toBe(50n);
    const tiers = (await as(erin).get_offer_price_tiers(id))[0];
    expect([tierOf(tiers.creation_fee[0]), tierOf(tiers.cut)]).toEqual(['partner', 'partner']);
    unwrap(await as(carol).cancelOffer(id));
    await pic.advanceTime(3 * DAY * 1000);
    await pic.tick(2);
    expect(await as(erin).get_special_prices_for(carol)).toEqual({ admin_prices: [], partner: [] });
    expect((await as(erin).get_special_prices()).partners.map((p) => p.principal.toText())).toEqual([carol.toText()]); // still listed, with its expiry
    const [id2, quoted2] = await createPaid(carol);
    expect(quoted2).toBe(50_000_000n);
    expect((await offer(id2)).fee_rate_bps).toBe(300n);
    unwrap(await as(carol).cancelOffer(id2));
    unwrap(await as(admin).remove_partner_prices(carol));
  });

  it('charges the lowest of premium and partner, per fee', async () => {
    // bob is a premium member: fee 0.2 ICP, cut 100 bps; his partner entry has a higher fee and a lower cut
    unwrap(await as(admin).set_partner_prices(bob, { label: 'a partner wallet', prices: prices(30_000_000n, 40n), expires_at: [] }));
    const [id, quoted] = await createPaid(bob);
    expect(quoted).toBe(20_000_000n);
    expect((await offer(id)).fee_rate_bps).toBe(40n);
    const tiers = (await as(erin).get_offer_price_tiers(id))[0];
    expect([tierOf(tiers.creation_fee[0]), tierOf(tiers.cut)]).toEqual(['premium', 'partner']);
    unwrap(await as(bob).cancelOffer(id));
    // a partner price equal to the premium one keeps the premium tier
    unwrap(await as(admin).set_partner_prices(bob, { label: 'a partner wallet', prices: prices(20_000_000n, 100n), expires_at: [] }));
    const [id2] = await createPaid(bob);
    const t2 = (await as(erin).get_offer_price_tiers(id2))[0];
    expect([tierOf(t2.creation_fee[0]), tierOf(t2.cut)]).toEqual(['premium', 'premium']);
    unwrap(await as(bob).cancelOffer(id2));
    unwrap(await as(admin).remove_partner_prices(bob));
  });
});

describe('ICRC-3', () => {
  it('logs every change as a config update and the tier on the fee, offer and cut blocks', async () => {
    const mark = (await blocks()).length;
    unwrap(await as(admin).set_admin_prices(prices(30_000n, null)));
    const expires = await inSeconds(10 * DAY);
    unwrap(await as(admin).set_partner_prices(carol, { label: 'a partner game canister', prices: prices(2_000_000n, 20n), expires_at: [expires] }));
    unwrap(await as(admin).set_partner_prices(carol, { label: 'a partner game canister', prices: prices(null, 20n), expires_at: [] }));
    // carol lists AAA tokens with the partner cut, alice buys them out: the cut block says partner
    const [id] = await createPaid(carol, { buyout_price: [10n * E8] });
    unwrap(await as(carol).addAsset({ offer_id: id, asset: { ICRC1Token: { ledger_canister_id: tokenAId, amount: 1_000n } } }));
    unwrap(await as(carol).finalizeAssets(id));
    unwrap(await transfer(tokenAAs(carol), account(dexId, await as(erin).getOfferEscrowSubaccount(carol, id)), 1_000n));
    unwrap(await as(carol).escrowICRC1Tokens(id, 0n));
    unwrap(await as(carol).activateOffer(id));
    const bidId = unwrap(await as(alice).reserveBid(id));
    unwrap(await transfer(icpAs(alice), account(dexId, await as(erin).getBidEscrowSubaccount(alice, bidId)), 10n * E8));
    unwrap(await as(alice).confirmBid(bidId, 10n * E8));
    await settle(5, 20);
    unwrap(await as(admin).remove_partner_prices(carol));
    unwrap(await as(admin).set_admin_prices(NONE));
    const log = (await blocks()).slice(mark);
    const cfg = log.filter((b) => b.t === 'sneedex_config_update');
    expect(cfg).toEqual([
      { t: 'sneedex_config_update', caller: P(admin), key: 'admin_prices', value: { offer_creation_fee_e8s: 30_000n }, old_value: {} },
      { t: 'sneedex_config_update', caller: P(admin), key: 'partner_prices', partner: P(carol), value: { label: 'a partner game canister', prices: { offer_creation_fee_e8s: 2_000_000n, auction_cut_bps: 20n }, expires_at: expires } },
      { t: 'sneedex_config_update', caller: P(admin), key: 'partner_prices', partner: P(carol), value: { label: 'a partner game canister', prices: { auction_cut_bps: 20n } }, old_value: { label: 'a partner game canister', prices: { offer_creation_fee_e8s: 2_000_000n, auction_cut_bps: 20n }, expires_at: expires } },
      { t: 'sneedex_config_update', caller: P(admin), key: 'partner_prices', partner: P(carol), value: 'removed', old_value: { label: 'a partner game canister', prices: { auction_cut_bps: 20n } } },
      { t: 'sneedex_config_update', caller: P(admin), key: 'admin_prices', value: {}, old_value: { offer_creation_fee_e8s: 30_000n } },
    ]);
    expect(log.find((b) => b.t === 'sneedex_creation_fee_pay').price_tier).toBe('regular'); // the partner entry left the fee alone
    expect(log.find((b) => b.t === 'sneedex_offer_create')).toMatchObject({ offer_id: id, fee_rate_bps: 20n, cut_price_tier: 'partner', price_tier: 'regular' });
    expect(log.find((b) => b.t === 'sneedex_cut_pay')).toMatchObject({ offer_id: id, fee_rate_bps: 20n, cut: 10n * E8 * 20n / 10_000n, price_tier: 'partner' });
  });
});

describe('upgrade from the production source', () => {
  it('keeps offers and fees and starts with no special prices', async () => {
    const oldId = await install(pic, { name: 'sneedex_presp', initTypes: sneedexInit({ IDL }), initArgs: [[]], cycles: 50n * T, targetSubnetId: appSubnet });
    const old = as(admin, oldId);
    unwrap(await old.setOfferCreationFee(0n));
    unwrap(await old.setMarketplaceFeeRate(250n));
    unwrap(await old.setPremiumAuctionCutBps(120n));
    const offerId = unwrap(await as(alice, oldId).createOffer(offerReq({ buyout_price: [E8] })));
    const snapshot = async () => ({ fees: await as(erin, oldId).getFeeConfig(), offer: (await as(erin, oldId).queryOffer(offerId))[0], next: await as(erin, oldId).getNextOfferId(), config: await as(erin, oldId).getConfig() });
    const before = await snapshot();
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(SNEEDEX_WASM), arg: IDL.encode(sneedexInit({ IDL }), [[]]) });
    expect(await snapshot()).toEqual(before);
    expect(await as(erin, oldId).get_special_prices()).toEqual({ admin_prices: NONE, partners: [] });
    expect(await as(erin, oldId).get_offer_price_tiers(offerId)).toEqual([]);
    // and the special prices survive a further upgrade
    unwrap(await as(admin, oldId).set_admin_prices(prices(null, 5n)));
    unwrap(await as(admin, oldId).set_partner_prices(carol, { label: 'a partner game canister', prices: prices(0n, 0n), expires_at: [] }));
    const sp = await as(erin, oldId).get_special_prices();
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(SNEEDEX_WASM), arg: IDL.encode(sneedexInit({ IDL }), [[]]) });
    expect(await as(erin, oldId).get_special_prices()).toEqual(sp);
    const id2 = unwrap(await as(admin, oldId).createOffer(offerReq({ buyout_price: [E8] })));
    expect((await as(erin, oldId).queryOffer(id2))[0].fee_rate_bps).toBe(5n);
  });
});
