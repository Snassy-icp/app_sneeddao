// Sneedex administration and fees: admin guards on every admin method (non-admins
// refused, controllers and listed admins accepted), the admin list and config
// changes, min-increment settings, the asset type registry (built-ins, adding,
// deactivating), the marketplace cut (rate bounds, rate locked in at creation,
// arithmetic, default recipient and per-ledger override, cut payment log and
// stats), the ICP offer creation fee (payment subaccount, refusal when unpaid,
// recipient, payment log, withdrawal), Sneed Premium rates through a mock
// premium canister, wallet/SMS/lock canister settings, the neuron info cache
// settings, the admin rescue functions, and the expiration timer across upgrades.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, wasm, account, admin, alice, bob, carol, user, ICP_LEDGER_ID, T, unwrap, errOf, paymentSubaccount, refusedAtIngress } from '../lib/pic.js';
import { ledgerIdl, ledgerInit, premiumIdl } from '../lib/idl.js';
import { idlFactory as sneedexIdl, init as sneedexInit } from '../build/sneedex.did.js';

const ICP_FEE = 10_000n;
const FEE_A = 1_000n;
const E8 = 100_000_000n;
const DAY = 86_400;
const dave = user('dave'); // a listed admin who is not a controller
const treasury = user('treasury');
const tokenTreasury = user('token-treasury');

let pic, appSubnet, icpId, tokenAId, premiumId, dexId;
let icp, tokenA, premium, dexAdmin, dexDave, dexAlice, dexBob, dexCarol;

const icpAs = (p) => actorAs(pic, ledgerIdl, icpId, p);
const tokenAAs = (p) => actorAs(pic, ledgerIdl, tokenAId, p);
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const inSeconds = async (s) => (await nowNs()) + BigInt(s) * 1_000_000_000n;
const settle = async (seconds = 5, rounds = 10) => { await pic.advanceTime(seconds * 1000); for (let i = 0; i < rounds; i++) await pic.tick(2); };
const balance = (ledger, owner, sub = null) => ledger.icrc1_balance_of(account(owner, sub));
const transfer = (ledger, to, amount) => ledger.icrc1_transfer({ from_subaccount: [], to, amount, fee: [], memo: [], created_at_time: [] });
const offerReq = (o = {}) => ({ min_bid_price: [E8], buyout_price: [], expiration: [], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: [], note_to_buyer: [], ...o });
const offer = async (id) => (await dexBob.queryOffer(id))[0];
const tokenAsset = (amount) => ({ ICRC1Token: { ledger_canister_id: tokenAId, amount } });
const ids = (ps) => ps.map((p) => p.toText());

/// An active offer by `who` (alice by default) of `amount` AAA, priced in `ledger`.
const listTokens = async (o = {}, actor = dexAlice, who = alice, amount = 1_000n) => {
  const id = unwrap(await actor.createOffer(offerReq({ expiration: [await inSeconds(30 * DAY)], ...o })));
  unwrap(await actor.addAsset({ offer_id: id, asset: tokenAsset(amount) }));
  unwrap(await actor.finalizeAssets(id));
  unwrap(await transfer(tokenAAs(who), account(dexId, await dexBob.getOfferEscrowSubaccount(who, id)), amount));
  unwrap(await actor.escrowICRC1Tokens(id, 0n));
  unwrap(await actor.activateOffer(id));
  return id;
};
const placeBid = async (actor, who, offerId, amount, ledgerOf = icpAs) => {
  const bidId = unwrap(await actor.reserveBid(offerId));
  unwrap(await transfer(ledgerOf(who), account(dexId, await dexBob.getBidEscrowSubaccount(who, bidId)), amount));
  unwrap(await actor.confirmBid(bidId, amount));
  return bidId;
};

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  premiumId = await install(pic, { name: 'MockPremium', targetSubnetId: appSubnet });
  dexId = await install(pic, { name: 'sneedex', initTypes: sneedexInit({ IDL }), initArgs: [[]], cycles: 50n * T, targetSubnetId: appSubnet });
  icp = icpAs(admin); tokenA = tokenAAs(admin);
  premium = actorAs(pic, premiumIdl, premiumId, admin);
  dexAdmin = actorAs(pic, sneedexIdl, dexId, admin); dexDave = actorAs(pic, sneedexIdl, dexId, dave);
  dexAlice = actorAs(pic, sneedexIdl, dexId, alice); dexBob = actorAs(pic, sneedexIdl, dexId, bob); dexCarol = actorAs(pic, sneedexIdl, dexId, carol);
  await tokenA.mint(account(alice), 1_000n * E8);
  await tokenA.mint(account(carol), 1_000n * E8);
  await tokenA.mint(account(bob), 1_000n * E8);
  await icp.mint(account(bob), 1_000n * E8);
  await icp.mint(account(alice), 1_000n * E8);
  await icp.mint(account(carol), 1_000n * E8);
  await pic.tick(2);
}, 180_000);
afterAll(async () => { await pic?.tearDown(); });

describe('admin guards', () => {
  it('refuses every admin update method to a non-admin and leaves the settings as they were', async () => {
    const cfg = await dexBob.getConfig();
    const calls = [
      () => dexBob.deactivateAssetType(0n), () => dexBob.reactivateAssetType(0n),
      () => dexBob.addAdmin(bob), () => dexBob.removeAdmin(admin), () => dexBob.setMinIncrementSettings(1n, 3n, 2n, 5n),
      () => dexBob.setMarketplaceFeeRate(1n), () => dexBob.setFeeRecipient(account(bob)), () => dexBob.setLedgerFeeRecipient(icpId, account(bob)),
      () => dexBob.removeLedgerFeeRecipient(icpId), () => dexBob.setOfferCreationFee(1n), () => dexBob.setPremiumOfferCreationFee(1n),
      () => dexBob.setPremiumAuctionCutBps(1n), () => dexBob.setSneedPremiumCanisterId([bob]), () => dexBob.setBackendCanisterId([bob]),
      () => dexBob.setNeuronManagerFactoryCanisterId([bob]), () => dexBob.setSneedLockCanisterId(bob), () => dexBob.setSneedSmsCanisterId([bob]),
      () => dexBob.startExpirationTimer(), () => dexBob.stopExpirationTimer(), () => dexBob.setExpirationCheckInterval(120n),
      () => dexBob.triggerExpirationCheck(), () => dexBob.adminReturnMisplacedNft(tokenAId, 1n, account(bob)), () => dexBob.adminReclaimStuckTokens(0n),
      () => dexBob.setNeuronInfoCacheStaleness(1n), () => dexBob.clearNeuronInfoCache(), () => dexBob.clearNeuronInfoCacheFor(bob),
    ];
    for (const call of calls) expect(errOf(await call())).toHaveProperty('NotAuthorized');
    // the admin tools with free-form content are refused at ingress
    for (const call of [() => dexBob.addAssetType('x', 'y'), () => dexBob.updateConfig(cfg)]) expect(await refusedAtIngress(call())).toBe(true);
    expect(await dexBob.getConfig()).toEqual(cfg);
    expect(await dexBob.getMarketplaceFeeRate()).toBe(0n);
    expect((await dexBob.getFeeRecipient()).owner.toText()).toBe('aaaaa-aa'); // the default: transfers to it would fail on a real ledger
    expect(await dexBob.getLedgerFeeRecipients()).toEqual([]);
    expect(await dexBob.getAssetTypes()).toHaveLength(5);
    expect(await dexBob.getSneedPremiumCanisterId()).toEqual([]);
    expect(await dexBob.getBackendCanisterId()).toEqual([]);
    expect(await dexBob.getNeuronManagerFactoryCanisterId()).toEqual([]);
    expect(await dexBob.getSneedSmsCanisterId()).toEqual([]);
    expect((await dexBob.getSneedLockCanisterId()).toText()).toBe('pqsms-lqaaa-aaaal-ajjza-cai');
    expect(await dexBob.isExpirationTimerRunning()).toBe(false);
    expect(await dexBob.getExpirationCheckInterval()).toBe(3600n);
    expect(await dexBob.getNeuronInfoCacheStaleness()).toBe(3600n);
  });

  it('refuses the admin payment-log queries to a non-admin (they trap)', async () => {
    for (const q of ['getCreationFeePaymentLogCount', 'getCutPaymentLogCount']) await expect(dexBob[q]()).rejects.toThrow();
    // the totals are public (the /revenue page); the logs stay admin only
    expect(await dexBob.getPaymentStats()).toHaveProperty('total_cut_payments');
    await expect(dexBob.getCreationFeePaymentLog(0n, 10n)).rejects.toThrow();
    await expect(dexBob.getCutPaymentLog(0n, 10n)).rejects.toThrow();
    expect(await dexAdmin.getCutPaymentLogCount()).toBe(0n);
  });

  it('adds and removes listed admins, who then pass the guards; a controller always does', async () => {
    unwrap(await dexAdmin.addAdmin(dave));
    unwrap(await dexAdmin.addAdmin(dave)); // idempotent
    expect(ids((await dexBob.getConfig()).admins)).toEqual([dave.toText()]);
    unwrap(await dexDave.setNeuronInfoCacheStaleness(120n));
    expect(await dexBob.getNeuronInfoCacheStaleness()).toBe(120n);
    unwrap(await dexDave.clearNeuronInfoCache());
    unwrap(await dexDave.clearNeuronInfoCacheFor(bob));
    expect(await dexDave.getCutPaymentLogCount()).toBe(0n);
    unwrap(await dexDave.removeAdmin(dave)); // an admin may remove itself
    expect((await dexBob.getConfig()).admins).toEqual([]);
    expect(errOf(await dexDave.setNeuronInfoCacheStaleness(3600n))).toHaveProperty('NotAuthorized');
    unwrap(await dexAdmin.setNeuronInfoCacheStaleness(3600n));
  });

  it('takes the admins and limits of the install argument', async () => {
    const custom = { admins: [dave], min_offer_duration_ns: 60_000_000_000n, max_assets_per_offer: 3n, min_increment_usd_range_min: 10n, min_increment_usd_range_max: 20n, min_increment_usd_target: 15n, min_increment_fallback_tokens: 7n };
    const other = await install(pic, { name: 'sneedex', initTypes: sneedexInit({ IDL }), initArgs: [[custom]], targetSubnetId: appSubnet });
    const asDave = actorAs(pic, sneedexIdl, other, dave);
    expect(await asDave.getConfig()).toEqual({ ...custom, admins: [dave] });
    unwrap(await asDave.setMarketplaceFeeRate(10n));
    // a two-minute offer is fine with a one-minute minimum duration
    unwrap(await asDave.createOffer(offerReq({ expiration: [await inSeconds(120)] })));
  });
});

describe('config', () => {
  it('replaces the whole config with updateConfig, and the minimum duration applies at once', async () => {
    const cfg = await dexBob.getConfig();
    unwrap(await dexAdmin.updateConfig({ ...cfg, min_offer_duration_ns: 2n * 86_400n * 1_000_000_000n }));
    expect(errOf(await dexAlice.createOffer(offerReq({ expiration: [await inSeconds(DAY)] })))).toHaveProperty('InvalidExpiration');
    unwrap(await dexAdmin.updateConfig(cfg));
    expect(await dexBob.getConfig()).toEqual(cfg);
  });

  it('validates and stores the min increment settings', async () => {
    expect(await dexBob.getMinIncrementSettings()).toEqual({ usd_range_min: 100n, usd_range_max: 1000n, usd_target: 500n, fallback_tokens: E8 });
    expect(errOf(await dexAdmin.setMinIncrementSettings(300n, 1000n, 200n, 1n))).toHaveProperty('InvalidPrice'); // target below min
    expect(errOf(await dexAdmin.setMinIncrementSettings(100n, 400n, 500n, 1n))).toHaveProperty('InvalidPrice'); // target above max
    unwrap(await dexAdmin.setMinIncrementSettings(50n, 2000n, 50n, 42n));
    expect(await dexBob.getMinIncrementSettings()).toEqual({ usd_range_min: 50n, usd_range_max: 2000n, usd_target: 50n, fallback_tokens: 42n });
    const c = await dexBob.getConfig();
    expect([c.min_increment_usd_range_min, c.min_increment_usd_range_max, c.min_increment_usd_target, c.min_increment_fallback_tokens]).toEqual([50n, 2000n, 50n, 42n]);
    expect(c.max_assets_per_offer).toBe(10n); // the rest is untouched
  });

  it('stores the wallet, SMS, premium and Sneed Lock canister ids', async () => {
    unwrap(await dexAdmin.setBackendCanisterId([carol]));
    unwrap(await dexAdmin.setNeuronManagerFactoryCanisterId([carol]));
    unwrap(await dexAdmin.setSneedSmsCanisterId([carol]));
    unwrap(await dexAdmin.setSneedLockCanisterId(carol));
    expect(ids(await dexBob.getBackendCanisterId())).toEqual([carol.toText()]);
    expect(ids(await dexBob.getNeuronManagerFactoryCanisterId())).toEqual([carol.toText()]);
    expect(ids(await dexBob.getSneedSmsCanisterId())).toEqual([carol.toText()]);
    expect((await dexBob.getSneedLockCanisterId()).toText()).toBe(carol.toText());
    for (const f of ['setBackendCanisterId', 'setNeuronManagerFactoryCanisterId', 'setSneedSmsCanisterId']) unwrap(await dexAdmin[f]([]));
    expect(await dexBob.getBackendCanisterId()).toEqual([]);
    expect(await dexBob.getSneedSmsCanisterId()).toEqual([]);
  });
});

describe('asset type registry', () => {
  it('starts with the five built-in types, all active', async () => {
    const types = await dexBob.getAssetTypes();
    expect(types.map((t) => [t.id, t.name, t.active])).toEqual([
      [0n, 'Canister', true], [1n, 'SNS Neuron', true], [2n, 'ICRC1 Token', true], [3n, 'ICRC-7 NFT', true], [4n, 'Sneed Lock', true],
    ]);
  });

  it('adds new types with ids from 5 upwards and deactivates them', async () => {
    expect(unwrap(await dexAdmin.addAssetType('Domain', 'A domain name'))).toBe(5n);
    expect(unwrap(await dexAdmin.addAssetType('Ticket', 'An event ticket'))).toBe(6n);
    unwrap(await dexAdmin.deactivateAssetType(5n));
    unwrap(await dexAdmin.deactivateAssetType(99n)); // unknown ids are accepted silently
    const types = await dexBob.getAssetTypes();
    expect(types.find((t) => t.id === 5n)).toEqual({ id: 5n, name: 'Domain', description: 'A domain name', active: false });
    expect(types.find((t) => t.id === 6n).active).toBe(true);
    expect(types).toHaveLength(7);
  });

  it('refuses assets of a deactivated type until an admin reactivates it', async () => {
    unwrap(await dexAdmin.deactivateAssetType(2n));
    expect((await dexBob.getAssetTypes()).find((t) => t.id === 2n).active).toBe(false);
    const id = unwrap(await dexAlice.createOffer(offerReq({ expiration: [await inSeconds(30 * DAY)] })));
    expect(errOf(await dexAlice.addAsset({ offer_id: id, asset: tokenAsset(1n) }))).toEqual({ InvalidAsset: expect.stringMatching(/not currently accepted/) });
    expect((await offer(id)).assets).toEqual([]);
    expect(errOf(await dexAdmin.reactivateAssetType(99n))).toHaveProperty('InvalidAsset'); // unknown type
    unwrap(await dexAdmin.reactivateAssetType(2n));
    expect((await dexBob.getAssetTypes()).find((t) => t.id === 2n).active).toBe(true);
    unwrap(await dexAlice.addAsset({ offer_id: id, asset: tokenAsset(1n) }));
    unwrap(await dexAlice.cancelOffer(id));
  });
});

describe('marketplace cut', () => {
  it('bounds the rate at 50% and reports the fee config', async () => {
    expect(errOf(await dexAdmin.setMarketplaceFeeRate(5001n))).toHaveProperty('InvalidAsset');
    expect(errOf(await dexAdmin.setPremiumAuctionCutBps(5001n))).toHaveProperty('InvalidAsset');
    unwrap(await dexAdmin.setMarketplaceFeeRate(250n));
    expect(await dexBob.getMarketplaceFeeRate()).toBe(250n);
    expect(await dexBob.getFeeConfig()).toEqual({ regularCreationFeeE8s: 0n, premiumCreationFeeE8s: 0n, regularAuctionCutBps: 250n, premiumAuctionCutBps: 0n });
  });

  it('locks the rate in at creation and splits the winning bid between the recipient and the seller', async () => {
    unwrap(await dexAdmin.setFeeRecipient(account(treasury)));
    expect((await dexBob.getFeeRecipient()).owner.toText()).toBe(treasury.toText());
    const id = await listTokens(); // created at 2.5%
    expect((await offer(id)).fee_rate_bps).toBe(250n);
    unwrap(await dexAdmin.setMarketplaceFeeRate(1000n)); // later changes do not touch this offer
    const alice0 = await balance(icp, alice);
    const bidId = await placeBid(dexBob, bob, id, 10n * E8);
    unwrap(await dexAlice.acceptBid(id));
    unwrap(await dexAlice.claimWinningBid(id));
    const cut = 10n * E8 * 250n / 10_000n; // 25_000_000
    expect(await balance(icp, treasury)).toBe(cut - ICP_FEE);
    expect(await balance(icp, alice)).toBe(alice0 + 10n * E8 - cut - ICP_FEE);
    expect(await balance(icp, dexId, await dexBob.getBidEscrowSubaccount(bob, bidId))).toBe(0n);
    const log = await dexAdmin.getCutPaymentLog(0n, 10n);
    expect(log.total_count).toBe(1n);
    expect(log.has_more).toBe(false);
    const e = log.payments[0];
    expect([e.id, e.offer_id, e.bid_id, e.cut_amount, e.bid_amount, e.fee_rate_bps]).toEqual([0n, id, bidId, cut, 10n * E8, 250n]);
    expect([e.seller.toText(), e.buyer.toText(), e.ledger.toText()]).toEqual([alice.toText(), bob.toText(), icpId.toText()]);
    const stats = await dexAdmin.getPaymentStats();
    expect(stats.total_cut_payments).toBe(1n);
    expect(stats.cuts_by_ledger.map(([l, n]) => [l.toText(), n])).toEqual([[icpId.toText(), cut]]);
    await settle(4);
  });

  it('sends the cut of a ledger with an override to that account, and the auto-payment does too', async () => {
    unwrap(await dexAdmin.setMarketplaceFeeRate(500n));
    unwrap(await dexAdmin.setLedgerFeeRecipient(tokenAId, account(tokenTreasury)));
    unwrap(await dexAdmin.setLedgerFeeRecipient(tokenAId, account(tokenTreasury, new Uint8Array(32).fill(7)))); // replaces, not appends
    expect((await dexBob.getLedgerFeeRecipients()).length).toBe(1);
    unwrap(await dexAdmin.setLedgerFeeRecipient(tokenAId, account(tokenTreasury)));
    // carol prices her offer in AAA (the asset is AAA too; any ICRC-1 ledger can be the price token)
    const id = await listTokens({ price_token_ledger: tokenAId, min_bid_price: [1_000_000n] }, dexCarol, carol);
    const carol0 = await balance(tokenA, carol); const treasury0 = await balance(icp, treasury);
    await placeBid(dexBob, bob, id, 2_000_000n, tokenAAs);
    unwrap(await dexCarol.acceptBid(id));
    await settle(4); // auto-delivery of assets and payment
    expect(await state(id)).toBe('Claimed');
    const cut = 2_000_000n * 500n / 10_000n; // 100_000
    expect(await balance(tokenA, tokenTreasury)).toBe(cut - FEE_A);
    expect(await balance(tokenA, carol)).toBe(carol0 + 2_000_000n - cut - FEE_A);
    expect(await balance(icp, treasury)).toBe(treasury0); // the default recipient got nothing
    const stats = await dexAdmin.getPaymentStats();
    expect(stats.cuts_by_ledger.find(([l]) => l.toText() === tokenAId.toText())[1]).toBe(cut);
    expect(await dexAdmin.getCutPaymentLogCount()).toBe(2n);
    // newest first
    expect((await dexAdmin.getCutPaymentLog(0n, 1n)).payments[0].ledger.toText()).toBe(tokenAId.toText());
    expect((await dexAdmin.getCutPaymentLog(0n, 1n)).has_more).toBe(true);
    expect((await dexAdmin.getCutPaymentLog(1n, 1n)).payments[0].ledger.toText()).toBe(icpId.toText());
    expect((await dexAdmin.getCutPaymentLog(5n, 1n)).payments).toEqual([]);
    unwrap(await dexAdmin.removeLedgerFeeRecipient(tokenAId));
    expect(await dexBob.getLedgerFeeRecipients()).toEqual([]);
  });

  it('the seller claiming by hand after the buyer has claimed pays the cut to the ledger override too', async () => {
    unwrap(await dexAdmin.setMarketplaceFeeRate(500n));
    unwrap(await dexAdmin.setLedgerFeeRecipient(icpId, account(tokenTreasury)));
    const id = await listTokens();
    const alice0 = await balance(icp, alice); const treasury0 = await balance(icp, treasury); const override0 = await balance(icp, tokenTreasury);
    const bidId = await placeBid(dexBob, bob, id, 4n * E8);
    unwrap(await dexAlice.acceptBid(id));
    unwrap(await dexBob.claimAssets(id)); // the buyer first: the offer is Claimed, the bid still Won
    expect(await state(id)).toBe('Claimed');
    unwrap(await dexAlice.claimWinningBid(id));
    const cut = 4n * E8 * 500n / 10_000n;
    expect(await balance(icp, tokenTreasury)).toBe(override0 + cut - ICP_FEE);
    expect(await balance(icp, treasury)).toBe(treasury0); // not the default recipient
    expect(await balance(icp, alice)).toBe(alice0 + 4n * E8 - cut - ICP_FEE);
    expect(await balance(icp, dexId, await dexBob.getBidEscrowSubaccount(bob, bidId))).toBe(0n);
    expect(await dexAdmin.getCutPaymentLogCount()).toBe(3n);
    unwrap(await dexAdmin.removeLedgerFeeRecipient(icpId));
    await settle(4);
  });

  it('takes no cut when the cut is no bigger than a ledger fee', async () => {
    unwrap(await dexAdmin.setMarketplaceFeeRate(1n)); // 0.01%: on 1 ICP the cut is 10_000, exactly one fee
    const id = await listTokens();
    const alice0 = await balance(icp, alice); const treasury0 = await balance(icp, treasury);
    const bidId = await placeBid(dexBob, bob, id, E8);
    unwrap(await dexAlice.acceptBid(id));
    unwrap(await dexAlice.claimWinningBid(id));
    expect(await balance(icp, treasury)).toBe(treasury0);
    // the cut is not taken: the seller gets the whole bid less one ledger fee and the escrow is empty
    expect(await balance(icp, alice)).toBe(alice0 + E8 - ICP_FEE);
    expect(await balance(icp, dexId, await dexBob.getBidEscrowSubaccount(bob, bidId))).toBe(0n);
    expect(await dexAdmin.getCutPaymentLogCount()).toBe(3n); // nothing logged
    unwrap(await dexAdmin.setMarketplaceFeeRate(0n));
    await settle(4);
  });
});

describe('offer creation fee', () => {
  it('charges nothing by default and reports the payment subaccount', async () => {
    expect(await dexBob.getOfferCreationFee()).toBe(0n);
    expect(await dexBob.getEffectiveOfferCreationFee(alice)).toBe(0n);
    expect(Array.from(await dexBob.getOfferCreationPaymentSubaccount(alice))).toEqual(Array.from(paymentSubaccount(alice)));
  });

  it('refuses an offer until the fee is in the payment subaccount, then pays the ICP recipient and logs it', async () => {
    unwrap(await dexAdmin.setOfferCreationFee(50_000_000n));
    unwrap(await dexAdmin.setLedgerFeeRecipient(icpId, account(carol)));
    const next = await dexBob.getNextOfferId();
    expect(errOf(await dexAlice.createOffer(offerReq({ buyout_price: [E8] })))).toEqual({ InsufficientFunds: { required: 50_000_000n, available: 0n } });
    expect(await dexBob.getNextOfferId()).toBe(next);
    unwrap(await transfer(icpAs(alice), account(dexId, paymentSubaccount(alice)), 60_000_000n));
    expect(await dexBob.getUserOfferCreationBalance(alice)).toBe(60_000_000n);
    const carol0 = await balance(icp, carol);
    const id = unwrap(await dexAlice.createOffer(offerReq({ buyout_price: [E8] })));
    expect(id).toBe(next);
    expect(await balance(icp, carol)).toBe(carol0 + 50_000_000n - ICP_FEE);
    expect(await dexBob.getUserOfferCreationBalance(alice)).toBe(10_000_000n);
    const log = await dexAdmin.getCreationFeePaymentLog(0n, 10n);
    expect(log.total_count).toBe(1n);
    expect([log.payments[0].offer_id, log.payments[0].amount_e8s, log.payments[0].payer.toText()]).toEqual([id, 50_000_000n, alice.toText()]);
    expect(await dexAdmin.getCreationFeePaymentLogCount()).toBe(1n);
    expect((await dexAdmin.getPaymentStats()).total_creation_fees_collected_e8s).toBe(50_000_000n);
    // the leftover is not enough for a second offer
    expect(errOf(await dexAlice.createOffer(offerReq({ buyout_price: [E8] })))).toHaveProperty('InsufficientFunds');
    unwrap(await dexAlice.cancelOffer(id));
  });

  it('withdraws what is left in the payment subaccount, less one fee', async () => {
    const alice0 = await balance(icp, alice);
    expect(unwrap(await dexAlice.withdrawOfferCreationPayment())).toBe(10_000_000n - ICP_FEE);
    expect(await balance(icp, alice)).toBe(alice0 + 10_000_000n - ICP_FEE);
    expect(errOf(await dexAlice.withdrawOfferCreationPayment())).toEqual({ InsufficientFunds: { required: ICP_FEE + 1n, available: 0n } });
  });

  it('charges premium members the premium fee and gives them the premium cut', async () => {
    unwrap(await dexAdmin.setSneedPremiumCanisterId([premiumId]));
    unwrap(await dexAdmin.setPremiumOfferCreationFee(0n));
    unwrap(await dexAdmin.setMarketplaceFeeRate(300n));
    unwrap(await dexAdmin.setPremiumAuctionCutBps(100n));
    await premium.set_member(bob, (await nowNs()) + 365n * 86_400n * 1_000_000_000n);
    expect(await dexBob.getEffectiveOfferCreationFee(bob)).toBe(0n);
    expect(await dexBob.getEffectiveOfferCreationFee(alice)).toBe(50_000_000n);
    expect(await dexBob.getFeeConfig()).toEqual({ regularCreationFeeE8s: 50_000_000n, premiumCreationFeeE8s: 0n, regularAuctionCutBps: 300n, premiumAuctionCutBps: 100n });
    const premiumOffer = unwrap(await dexBob.createOffer(offerReq({ buyout_price: [E8] })));
    expect((await offer(premiumOffer)).fee_rate_bps).toBe(100n);
    unwrap(await transfer(icpAs(alice), account(dexId, paymentSubaccount(alice)), 50_000_000n));
    const regular = unwrap(await dexAlice.createOffer(offerReq({ buyout_price: [E8] })));
    expect((await offer(regular)).fee_rate_bps).toBe(300n);
    unwrap(await dexBob.cancelOffer(premiumOffer));
    unwrap(await dexAlice.cancelOffer(regular));
    unwrap(await dexAdmin.setOfferCreationFee(0n));
    unwrap(await dexAdmin.setMarketplaceFeeRate(0n));
    unwrap(await dexAdmin.setPremiumAuctionCutBps(0n));
    unwrap(await dexAdmin.removeLedgerFeeRecipient(icpId));
    await settle(3);
  });
});

describe('admin rescue', () => {
  it('adminReclaimStuckTokens returns what is left in an offer escrow to the seller', async () => {
    expect(errOf(await dexAdmin.adminReclaimStuckTokens(999n))).toHaveProperty('OfferNotFound');
    const id = await listTokens({}, dexAlice, alice, 5_000n);
    unwrap(await dexAlice.cancelOffer(id));
    await settle(3);
    expect(await state(id)).toBe('Reclaimed');
    // someone sends more tokens to the old escrow subaccount afterwards
    unwrap(await transfer(tokenAAs(bob), account(dexId, await dexBob.getOfferEscrowSubaccount(alice, id)), 7_000n));
    const alice0 = await balance(tokenA, alice);
    expect(unwrap(await dexAdmin.adminReclaimStuckTokens(id))).toMatch(/Token transfer succeeded/);
    expect(await balance(tokenA, alice)).toBe(alice0 + 7_000n - FEE_A);
    expect(unwrap(await dexAdmin.adminReclaimStuckTokens(id))).toMatch(/Results for offer/); // nothing left: a zero transfer is reported
  });

  it('adminReturnMisplacedNft refuses a token that is not in the default account', async () => {
    // tokenA is no ICRC-7 collection: the owner check fails and the call says so
    expect(errOf(await dexAdmin.adminReturnMisplacedNft(tokenAId, 1n, account(alice)))).toHaveProperty('InvalidAsset');
  });
});

describe('expiration timer across an upgrade', () => {
  it('restarts a running periodic timer after an upgrade, so expired offers are still processed', async () => {
    unwrap(await dexAdmin.setExpirationCheckInterval(60n));
    unwrap(await dexAdmin.startExpirationTimer());
    await pic.upgradeCanister({ sender: admin, canisterId: dexId, wasm: wasm('sneedex'), arg: IDL.encode(sneedexInit({ IDL }), [[]]) });
    await pic.tick(2);
    expect(await dexBob.isExpirationTimerRunning()).toBe(true);
    expect(await dexBob.getExpirationCheckInterval()).toBe(60n);
    const id = await listTokens({ expiration: [await inSeconds(2 * 3600)] });
    await settle(3 * 3600, 10);
    expect(await state(id)).toBe('Expired');
    // a second upgrade restarts it again, with no admin call in between
    await pic.upgradeCanister({ sender: admin, canisterId: dexId, wasm: wasm('sneedex'), arg: IDL.encode(sneedexInit({ IDL }), [[]]) });
    const id2 = await listTokens({ expiration: [await inSeconds(2 * 3600)] });
    await settle(3 * 3600, 10);
    expect(await state(id2)).toBe('Expired');
    unwrap(await dexAdmin.stopExpirationTimer());
    expect(await dexBob.isExpirationTimerRunning()).toBe(false);
  }, 180_000);

  it('does not start a stopped periodic timer on upgrade', async () => {
    await pic.upgradeCanister({ sender: admin, canisterId: dexId, wasm: wasm('sneedex'), arg: IDL.encode(sneedexInit({ IDL }), [[]]) });
    await pic.tick(2);
    expect(await dexBob.isExpirationTimerRunning()).toBe(false);
    const id = await listTokens({ expiration: [await inSeconds(2 * 3600)] });
    await settle(3 * 3600, 10);
    expect(await state(id)).toBe('Active'); // nothing processes it while the timer is off
    unwrap(await dexAdmin.triggerExpirationCheck());
    await settle(2, 10);
    expect(await state(id)).toBe('Expired');
  }, 180_000);
});

const state = async (id) => Object.keys((await offer(id)).state)[0];
