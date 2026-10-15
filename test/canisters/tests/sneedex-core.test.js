// Sneedex core: offer creation and validation, the Draft -> PendingEscrow ->
// Active -> Completed/Claimed | Expired/Cancelled -> Reclaimed state machine,
// ICRC-1 token assets (escrow subaccount, verification, delivery, reclaim),
// canister assets (controller snapshot, sole control, hand-over and release),
// SNS neuron assets through a mock governance (permission snapshot, strip,
// hand-over, restore, governance refusal), bids (reservation, escrow
// subaccount, confirmation rules, excess refund, increments, outbid refunds,
// withdrawals, the per-bid payout lock), buyout (capping, the race between two
// buyers), acceptBid, claims and the auto-delivery timers, expiration
// (processExpiration, the admin-triggered worker, the periodic timer), the
// offer feed and the other queries, notification settings, and an upgrade.
// Fees and admin functions are in sneedex-admin.test.js.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, wasm, account, principalToSubaccount, admin, alice, bob, carol, ICP_LEDGER_ID, T, unwrap, errOf, refusedAtIngress } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { idlFactory as sneedexIdl, init as sneedexInit } from '../build/sneedex.did.js';

const ICP_FEE = 10_000n;
const FEE_A = 1_000n;
const E8 = 100_000_000n;
const DAY = 86_400;
const FULL_OWNER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const N1 = new Uint8Array(32).fill(1);
const N2 = new Uint8Array(32).fill(2);
const N3 = new Uint8Array(32).fill(3);
const N4 = new Uint8Array(32).fill(4);

// mock SNS governance for neurons (test/canisters/canisters/MockSnsNeurons.mo)
const neuronsIdl = ({ IDL }) => IDL.Service({
  create_neuron: IDL.Func([IDL.Vec(IDL.Nat8), IDL.Principal, IDL.Vec(IDL.Int32), IDL.Nat64], [], []),
  set_fail: IDL.Func([IDL.Bool], [], []),
  permissions_of: IDL.Func([IDL.Vec(IDL.Nat8)], [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Vec(IDL.Int32)))], ['query']),
  manage_neuron: IDL.Func([IDL.Record({ subaccount: IDL.Vec(IDL.Nat8), command: IDL.Opt(IDL.Variant({
    AddNeuronPermissions: IDL.Record({ permissions_to_add: IDL.Opt(IDL.Record({ permissions: IDL.Vec(IDL.Int32) })), principal_id: IDL.Opt(IDL.Principal) }),
    RemoveNeuronPermissions: IDL.Record({ permissions_to_remove: IDL.Opt(IDL.Record({ permissions: IDL.Vec(IDL.Int32) })), principal_id: IDL.Opt(IDL.Principal) }),
  })) })], [IDL.Record({ command: IDL.Opt(IDL.Variant({ Error: IDL.Record({ error_message: IDL.Text, error_type: IDL.Int32 }), AddNeuronPermission: IDL.Record({}), RemoveNeuronPermission: IDL.Record({}) })) })], []),
});

let pic, appSubnet, icpId, tokenAId, govId, dexId, canA, canB;
let icp, tokenA, gov, govAlice, dexAdmin, dexAlice, dexBob, dexCarol, dexAny;

const icpAs = (p) => actorAs(pic, ledgerIdl, icpId, p);
const tokenAAs = (p) => actorAs(pic, ledgerIdl, tokenAId, p);
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const inSeconds = async (s) => (await nowNs()) + BigInt(s) * 1_000_000_000n;
/// Let time pass so the canister's timers (refunds, deliveries, reclaims, the expiration worker) run.
const settle = async (seconds = 5, rounds = 10) => { await pic.advanceTime(seconds * 1000); for (let i = 0; i < rounds; i++) await pic.tick(2); };
const balance = (ledger, owner, sub = null) => ledger.icrc1_balance_of(account(owner, sub));
const transfer = (ledger, to, amount, from_subaccount = []) => ledger.icrc1_transfer({ from_subaccount, to, amount, fee: [], memo: [], created_at_time: [] });
const offerReq = (o = {}) => ({ min_bid_price: [E8], buyout_price: [], expiration: [], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: [], note_to_buyer: [], ...o });
const newOffer = async (actor = dexAlice, o = {}) => unwrap(await actor.createOffer(offerReq({ expiration: [await inSeconds(30 * DAY)], ...o })));
const offer = async (id) => (await dexAny.queryOffer(id))[0];
const state = async (id) => Object.keys((await offer(id)).state)[0];
const bid = async (id) => (await dexAny.queryBid(id))[0];
const bidState = async (id) => Object.keys((await bid(id)).state)[0];
const tokenAsset = (amount, ledger = tokenAId) => ({ ICRC1Token: { ledger_canister_id: ledger, amount } });
const canisterAsset = (canister_id, extra = {}) => ({ Canister: { canister_id, canister_kind: [], controllers_snapshot: [], cached_total_stake_e8s: [], title: [], description: [], ...extra } });
const neuronAsset = (id) => ({ SNSNeuron: { governance_canister_id: govId, neuron_id: { id }, hotkeys_snapshot: [], cached_stake_e8s: [] } });
/// Sneedex's escrow subaccounts: the wallet subaccount with a marker at byte 23 and the id big-endian in bytes 24..31.
const idSubaccount = (p, marker, id) => { const out = principalToSubaccount(p); out[23] = marker; let v = BigInt(id); for (let i = 31; i >= 24; i--) { out[i] = Number(v & 0xffn); v >>= 8n; } return out; };
const sortedText = (ps) => ps.map((p) => p.toText()).sort();
const controllersOf = async (canisterId, sender) => sortedText((await pic.canisterStatus({ canisterId, sender })).settings.controllers);
const permsOf = async (id) => (await gov.permissions_of(id)).map(([p, perms]) => [p.toText(), Array.from(perms, Number).sort((a, b) => a - b)]).sort();

/// An active offer of `amount` AAA tokens by alice.
const listTokens = async (amount = 1_000_000n, o = {}) => {
  const id = await newOffer(dexAlice, o);
  unwrap(await dexAlice.addAsset({ offer_id: id, asset: tokenAsset(amount) }));
  unwrap(await dexAlice.finalizeAssets(id));
  unwrap(await transfer(tokenAAs(alice), account(dexId, await dexAny.getOfferEscrowSubaccount(alice, id)), amount));
  unwrap(await dexAlice.escrowICRC1Tokens(id, 0n));
  unwrap(await dexAlice.activateOffer(id));
  return id;
};
/// Reserve a bid and fund its escrow subaccount (without confirming).
const fundBid = async (actor, who, offerId, deposit) => {
  const bidId = unwrap(await actor.reserveBid(offerId));
  unwrap(await transfer(icpAs(who), account(dexId, await dexAny.getBidEscrowSubaccount(who, bidId)), deposit));
  return bidId;
};
const placeBid = async (actor, who, offerId, amount, deposit = amount) => {
  const bidId = await fundBid(actor, who, offerId, deposit);
  unwrap(await actor.confirmBid(bidId, amount));
  return bidId;
};

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  govId = await install(pic, { name: 'MockSnsNeurons', targetSubnetId: appSubnet });
  dexId = await install(pic, { name: 'sneedex', initTypes: sneedexInit({ IDL }), initArgs: [[]], cycles: 50n * T, targetSubnetId: appSubnet });
  // canisters alice will sell: canA is hers alone, canB is shared with carol
  canA = await install(pic, { name: 'MockCmc', controllers: [alice], sender: alice, targetSubnetId: appSubnet });
  canB = await install(pic, { name: 'MockCmc', controllers: [alice, carol], sender: alice, targetSubnetId: appSubnet });
  icp = icpAs(admin); tokenA = tokenAAs(admin);
  gov = actorAs(pic, neuronsIdl, govId, admin); govAlice = actorAs(pic, neuronsIdl, govId, alice);
  dexAdmin = actorAs(pic, sneedexIdl, dexId, admin); dexAlice = actorAs(pic, sneedexIdl, dexId, alice);
  dexBob = actorAs(pic, sneedexIdl, dexId, bob); dexCarol = actorAs(pic, sneedexIdl, dexId, carol); dexAny = dexBob;
  await tokenA.mint(account(alice), 1_000n * E8);
  await icp.mint(account(bob), 1_000n * E8);
  await icp.mint(account(carol), 1_000n * E8);
  await pic.tick(2);
}, 180_000);
afterAll(async () => { await pic?.tearDown(); });

describe('offer creation and validation', () => {
  it('refuses an offer with neither buyout nor expiration', async () => {
    expect(errOf(await dexAlice.createOffer(offerReq()))).toHaveProperty('OfferMustHaveBuyoutOrExpiration');
  });

  it('refuses an expiration closer than the minimum offer duration', async () => {
    expect((await dexAny.getConfig()).min_offer_duration_ns).toBe(3_600_000_000_000n);
    expect(errOf(await dexAlice.createOffer(offerReq({ expiration: [await inSeconds(30 * 60)] })))).toHaveProperty('InvalidExpiration');
    expect(errOf(await dexAlice.createOffer(offerReq({ expiration: [(await nowNs()) - 1n] })))).toHaveProperty('InvalidExpiration');
  });

  it('refuses a zero minimum bid and a minimum above the buyout', async () => {
    expect(errOf(await dexAlice.createOffer(offerReq({ min_bid_price: [0n], buyout_price: [E8] })))).toHaveProperty('InvalidPrice');
    expect(errOf(await dexAlice.createOffer(offerReq({ min_bid_price: [0n], expiration: [await inSeconds(DAY)] })))).toHaveProperty('InvalidPrice');
    expect(errOf(await dexAlice.createOffer(offerReq({ min_bid_price: [2n * E8], buyout_price: [E8] })))).toHaveProperty('InvalidPrice');
  });

  it('refuses notes over 4000 characters (at ingress)', async () => {
    const long = 'x'.repeat(4001);
    expect(await refusedAtIngress(dexAlice.createOffer(offerReq({ buyout_price: [E8], public_note: [long] })))).toBe(true);
    expect(await refusedAtIngress(dexAlice.createOffer(offerReq({ buyout_price: [E8], note_to_buyer: [long] })))).toBe(true);
    expect(await dexAny.getNextOfferId()).toBe(0n); // nothing was created so far
  });

  it('creates drafts with sequential ids, the notes, and the fee rate of the moment', async () => {
    const exp = await inSeconds(30 * DAY);
    const a = unwrap(await dexAlice.createOffer(offerReq({ expiration: [exp], public_note: ['for sale'], note_to_buyer: ['thanks'], min_bid_increment_fee_multiple: [10n] })));
    const b = unwrap(await dexAlice.createOffer(offerReq({ buyout_price: [5n * E8], min_bid_price: [] })));
    expect([a, b]).toEqual([0n, 1n]);
    expect(await dexAny.getNextOfferId()).toBe(2n);
    const o = await offer(a);
    expect(o.creator.toText()).toBe(alice.toText());
    expect(o.state).toEqual({ Draft: null });
    expect(o.assets).toEqual([]);
    expect(o.expiration).toEqual([exp]);
    expect(o.min_bid_price).toEqual([E8]);
    expect(o.buyout_price).toEqual([]);
    expect(o.public_note).toEqual(['for sale']);
    expect(o.note_to_buyer).toEqual([]); // the note to the buyer is only for the creator and the winner
    expect((await dexAlice.queryOffer(a))[0].note_to_buyer).toEqual(['thanks']);
    expect(o.min_bid_increment_fee_multiple).toEqual([10n]);
    expect(o.fee_rate_bps).toBe(0n);
    expect(o.activated_at).toEqual([]);
    expect(o.price_token_ledger.toText()).toBe(icpId.toText());
    const ob = await offer(b);
    expect(ob.expiration).toEqual([]);
    expect(ob.min_bid_price).toEqual([]);
    expect(ob.buyout_price).toEqual([5n * E8]);
    expect((await dexAny.getOffersByCreator(alice)).map((x) => x.id)).toEqual([0n, 1n]);
    expect(await dexAny.getOffersByCreator(bob)).toEqual([]);
    unwrap(await dexAlice.cancelOffer(a));
    unwrap(await dexAlice.cancelOffer(b));
  });

  it('records the approved bidders of a private offer', async () => {
    const id = await newOffer(dexAlice, { approved_bidders: [[bob]] });
    expect((await offer(id)).approved_bidders[0].map((p) => p.toText())).toEqual([bob.toText()]);
    unwrap(await dexAlice.cancelOffer(id));
  });
});

describe('drafts and the state machine', () => {
  it('only the creator adds assets, and only while the offer is a draft', async () => {
    const id = await newOffer();
    expect(errOf(await dexBob.addAsset({ offer_id: id, asset: tokenAsset(1n) }))).toHaveProperty('NotAuthorized');
    expect(errOf(await dexAlice.addAsset({ offer_id: 999n, asset: tokenAsset(1n) }))).toHaveProperty('OfferNotFound');
    unwrap(await dexAlice.addAsset({ offer_id: id, asset: tokenAsset(1n) }));
    expect(errOf(await dexBob.finalizeAssets(id))).toHaveProperty('NotAuthorized');
    unwrap(await dexAlice.finalizeAssets(id));
    expect(await state(id)).toBe('PendingEscrow');
    expect(errOf(await dexAlice.addAsset({ offer_id: id, asset: tokenAsset(1n, icpId) }))).toHaveProperty('InvalidState');
    expect(errOf(await dexAlice.finalizeAssets(id))).toHaveProperty('InvalidState');
    unwrap(await dexAlice.cancelOffer(id));
  });

  it('refuses to finalize an empty draft', async () => {
    const id = await newOffer();
    expect(errOf(await dexAlice.finalizeAssets(id))).toHaveProperty('InvalidAsset');
    unwrap(await dexAlice.cancelOffer(id));
  });

  it('refuses the same ledger twice and caps the number of assets at the configured maximum', async () => {
    const id = await newOffer();
    unwrap(await dexAlice.addAsset({ offer_id: id, asset: tokenAsset(5n) }));
    expect(errOf(await dexAlice.addAsset({ offer_id: id, asset: tokenAsset(7n) }))).toHaveProperty('InvalidAsset');
    const cfg = await dexAny.getConfig();
    unwrap(await dexAdmin.updateConfig({ ...cfg, max_assets_per_offer: 2n }));
    unwrap(await dexAlice.addAsset({ offer_id: id, asset: tokenAsset(5n, icpId) }));
    expect(errOf(await dexAlice.addAsset({ offer_id: id, asset: canisterAsset(canA) }))).toHaveProperty('InvalidAsset');
    unwrap(await dexAdmin.updateConfig(cfg));
    expect((await offer(id)).assets.length).toBe(2);
    unwrap(await dexAlice.cancelOffer(id));
  });

  it('bounds the title and description of a canister asset', async () => {
    const id = await newOffer();
    expect(await refusedAtIngress(dexAlice.addAsset({ offer_id: id, asset: canisterAsset(canA, { title: ['t'.repeat(101)] }) }))).toBe(true);
    expect(await refusedAtIngress(dexAlice.addAsset({ offer_id: id, asset: canisterAsset(canA, { description: ['d'.repeat(4001)] }) }))).toBe(true);
    unwrap(await dexAlice.addAsset({ offer_id: id, asset: canisterAsset(canA, { title: ['My bot'], description: ['d'.repeat(4000)], canister_kind: [0n] }) }));
    const a = (await offer(id)).assets[0].asset.Canister;
    expect(a.title).toEqual(['My bot']);
    expect(a.canister_kind).toEqual([0n]);
    unwrap(await dexAlice.cancelOffer(id));
  });

  it('escrow calls need the creator, PendingEscrow, a valid index and the matching asset kind', async () => {
    const id = await newOffer();
    unwrap(await dexAlice.addAsset({ offer_id: id, asset: tokenAsset(1n) }));
    expect(errOf(await dexAlice.escrowICRC1Tokens(id, 0n))).toHaveProperty('InvalidState'); // still a draft
    unwrap(await dexAlice.finalizeAssets(id));
    expect(errOf(await dexBob.escrowICRC1Tokens(id, 0n))).toHaveProperty('NotAuthorized');
    expect(errOf(await dexAlice.escrowICRC1Tokens(id, 1n))).toHaveProperty('InvalidAsset');
    expect(errOf(await dexAlice.escrowCanister(id, 0n))).toHaveProperty('InvalidAsset');
    expect(errOf(await dexAlice.escrowSNSNeuron(id, 0n))).toHaveProperty('InvalidAsset');
    expect(errOf(await dexAlice.escrowICRC7NFTs(id, 0n))).toHaveProperty('InvalidAsset');
    expect(errOf(await dexAlice.escrowSneedLock(id, 0n))).toHaveProperty('InvalidAsset');
    expect(errOf(await dexAlice.escrowICRC1Tokens(999n, 0n))).toHaveProperty('OfferNotFound');
    unwrap(await dexAlice.cancelOffer(id));
  });

  it('activates only once every asset is escrowed, by the creator, from PendingEscrow', async () => {
    const id = await newOffer();
    unwrap(await dexAlice.addAsset({ offer_id: id, asset: tokenAsset(1n) }));
    expect(errOf(await dexAlice.activateOffer(id))).toHaveProperty('InvalidState'); // draft
    unwrap(await dexAlice.finalizeAssets(id));
    expect(errOf(await dexAlice.activateOffer(id))).toHaveProperty('InvalidState'); // nothing escrowed
    unwrap(await transfer(tokenAAs(alice), account(dexId, await dexAny.getOfferEscrowSubaccount(alice, id)), 1n));
    unwrap(await dexAlice.escrowICRC1Tokens(id, 0n));
    expect(errOf(await dexBob.activateOffer(id))).toHaveProperty('NotAuthorized');
    unwrap(await dexAlice.activateOffer(id));
    const o = await offer(id);
    expect(o.state).toEqual({ Active: null });
    expect(o.activated_at.length).toBe(1);
    expect(errOf(await dexAlice.activateOffer(id))).toHaveProperty('InvalidState');
    expect((await dexAny.getActiveOffers()).map((x) => x.id)).toContain(id);
    unwrap(await dexAlice.cancelOffer(id));
  });

  it('cancels a draft or a pending offer; the other transitions are refused from there', async () => {
    const draft = await newOffer();
    expect(errOf(await dexBob.cancelOffer(draft))).toHaveProperty('NotAuthorized');
    expect(errOf(await dexAlice.claimAssets(draft))).toHaveProperty('InvalidState');
    expect(errOf(await dexAlice.reclaimAssets(draft))).toHaveProperty('InvalidState');
    expect(errOf(await dexAlice.claimWinningBid(draft))).toHaveProperty('InvalidState');
    expect(errOf(await dexAlice.acceptBid(draft))).toHaveProperty('InvalidState');
    expect(errOf(await dexBob.reserveBid(draft))).toHaveProperty('InvalidState');
    unwrap(await dexAlice.cancelOffer(draft));
    expect(await state(draft)).toBe('Cancelled');
    expect(errOf(await dexAlice.cancelOffer(draft))).toHaveProperty('InvalidState');
    expect(errOf(await dexAlice.addAsset({ offer_id: draft, asset: tokenAsset(1n) }))).toHaveProperty('InvalidState');
    // a cancelled offer with nothing escrowed can still be "reclaimed" (nothing moves) and ends Reclaimed
    unwrap(await dexAlice.reclaimAssets(draft));
    expect(await state(draft)).toBe('Reclaimed');
    const pending = await newOffer();
    unwrap(await dexAlice.addAsset({ offer_id: pending, asset: tokenAsset(1n) }));
    unwrap(await dexAlice.finalizeAssets(pending));
    unwrap(await dexAlice.cancelOffer(pending));
    expect(await state(pending)).toBe('Cancelled');
    await settle(3);
    expect(await state(pending)).toBe('Reclaimed');
  });
});

describe('ICRC-1 token assets', () => {
  it('derives the offer escrow subaccount from the creator and the offer id', async () => {
    const sub = await dexAny.getOfferEscrowSubaccount(alice, 300n);
    expect(Array.from(sub)).toEqual(Array.from(idSubaccount(alice, 0x4f, 300n)));
    expect(Array.from(await dexAny.getOfferEscrowSubaccount(alice, 301n))).not.toEqual(Array.from(sub));
    expect(Array.from(await dexAny.getOfferEscrowSubaccount(bob, 300n))).not.toEqual(Array.from(sub));
  });

  it('marks the tokens escrowed only once the declared amount sits in the escrow subaccount', async () => {
    const id = await newOffer();
    unwrap(await dexAlice.addAsset({ offer_id: id, asset: tokenAsset(500_000n) }));
    unwrap(await dexAlice.finalizeAssets(id));
    const sub = await dexAny.getOfferEscrowSubaccount(alice, id);
    expect(errOf(await dexAlice.escrowICRC1Tokens(id, 0n))).toEqual({ InsufficientFunds: { required: 500_000n, available: 0n } });
    unwrap(await transfer(tokenAAs(alice), account(dexId, sub), 400_000n));
    expect(errOf(await dexAlice.escrowICRC1Tokens(id, 0n))).toEqual({ InsufficientFunds: { required: 500_000n, available: 400_000n } });
    expect((await offer(id)).assets[0].escrowed).toBe(false);
    unwrap(await transfer(tokenAAs(alice), account(dexId, sub), 100_000n));
    unwrap(await dexAlice.escrowICRC1Tokens(id, 0n));
    expect((await offer(id)).assets[0].escrowed).toBe(true);
    expect(errOf(await dexAlice.escrowICRC1Tokens(id, 0n))).toHaveProperty('InvalidAsset'); // already escrowed
    unwrap(await dexAlice.cancelOffer(id));
    await settle(3);
    expect(await state(id)).toBe('Reclaimed');
    expect(await balance(tokenA, dexId, sub)).toBe(0n);
  });

  it('sells the tokens: the winner claims them and the seller claims the bid', async () => {
    const id = await listTokens(1_000_000n);
    const bobA0 = await balance(tokenA, bob); const aliceIcp0 = await balance(icp, alice);
    const bidId = await placeBid(dexBob, bob, id, 2n * E8);
    expect(await bidState(bidId)).toBe('Pending');
    expect(errOf(await dexBob.claimAssets(id))).toHaveProperty('InvalidState'); // still active
    unwrap(await dexAlice.acceptBid(id));
    const o = await offer(id);
    expect(o.state.Completed.winning_bid_id).toBe(bidId);
    expect(await bidState(bidId)).toBe('Won');
    expect(errOf(await dexCarol.claimAssets(id))).toHaveProperty('NotAuthorized');
    unwrap(await dexBob.claimAssets(id));
    expect(await state(id)).toBe('Claimed');
    expect(await balance(tokenA, bob)).toBe(bobA0 + 1_000_000n - FEE_A);
    expect(errOf(await dexBob.claimAssets(id))).toHaveProperty('InvalidState');
    expect(errOf(await dexBob.claimWinningBid(id))).toHaveProperty('NotAuthorized');
    // the seller collects by hand after the buyer has claimed first (the offer is Claimed, the bid Won)
    unwrap(await dexAlice.claimWinningBid(id));
    expect(await bidState(bidId)).toBe('ClaimedBySeller');
    expect(await balance(icp, alice)).toBe(aliceIcp0 + 2n * E8 - ICP_FEE);
    expect(errOf(await dexAlice.claimWinningBid(id))).toHaveProperty('InvalidState'); // paid already
    await settle(4); // the auto-payment timer finds nothing left to do
    expect(await bidState(bidId)).toBe('ClaimedBySeller');
    expect(await balance(icp, alice)).toBe(aliceIcp0 + 2n * E8 - ICP_FEE);
    expect(await balance(icp, dexId, await dexAny.getBidEscrowSubaccount(bob, bidId))).toBe(0n);
  });

  it('pays the seller by hand while the offer is still Completed', async () => {
    const id = await listTokens(10_000n);
    const aliceIcp0 = await balance(icp, alice);
    const bidId = await placeBid(dexBob, bob, id, 3n * E8);
    unwrap(await dexAlice.acceptBid(id));
    unwrap(await dexAlice.claimWinningBid(id));
    expect(await bidState(bidId)).toBe('ClaimedBySeller');
    expect(await balance(icp, alice)).toBe(aliceIcp0 + 3n * E8 - ICP_FEE);
    expect(errOf(await dexAlice.claimWinningBid(id))).toHaveProperty('InvalidState'); // not Won any more
    await settle(4); // the delivery timers find nothing left to do
    expect(await state(id)).toBe('Claimed');
    expect(await bidState(bidId)).toBe('ClaimedBySeller');
  });

  it('delivers the assets and the payment by itself when nobody claims', async () => {
    const id = await listTokens(20_000n);
    const bobA0 = await balance(tokenA, bob); const aliceIcp0 = await balance(icp, alice);
    const bidId = await placeBid(dexBob, bob, id, 2n * E8);
    unwrap(await dexAlice.acceptBid(id));
    await settle(4);
    expect(await state(id)).toBe('Claimed');
    expect(await bidState(bidId)).toBe('ClaimedBySeller');
    expect(await balance(tokenA, bob)).toBe(bobA0 + 20_000n - FEE_A);
    expect(await balance(icp, alice)).toBe(aliceIcp0 + 2n * E8 - ICP_FEE);
    const stats = await dexAny.getMarketStats();
    expect(stats.completed_offers).toBeGreaterThanOrEqual(3n);
  });

  it('returns cancelled tokens to the seller on reclaim, less one ledger fee', async () => {
    const id = await listTokens(30_000n);
    const aliceA0 = await balance(tokenA, alice);
    unwrap(await dexAlice.cancelOffer(id));
    expect(await state(id)).toBe('Cancelled');
    expect(errOf(await dexBob.reclaimAssets(id))).toHaveProperty('NotAuthorized');
    unwrap(await dexAlice.reclaimAssets(id));
    expect(await state(id)).toBe('Reclaimed');
    expect(await balance(tokenA, alice)).toBe(aliceA0 + 30_000n - FEE_A);
    expect(errOf(await dexAlice.reclaimAssets(id))).toHaveProperty('InvalidState');
    await settle(3); // the auto-reclaim timer finds the offer already reclaimed
    expect(await balance(tokenA, alice)).toBe(aliceA0 + 30_000n - FEE_A);
  });

  it('reclaims by itself when the seller does nothing after cancelling', async () => {
    const id = await listTokens(40_000n);
    const aliceA0 = await balance(tokenA, alice);
    unwrap(await dexAlice.cancelOffer(id));
    await settle(3);
    expect(await state(id)).toBe('Reclaimed');
    expect(await balance(tokenA, alice)).toBe(aliceA0 + 40_000n - FEE_A);
  });
});

describe('bids', () => {
  it('derives the bid escrow subaccount from the bidder and the bid id', async () => {
    const sub = await dexAny.getBidEscrowSubaccount(bob, 77n);
    expect(Array.from(sub)).toEqual(Array.from(idSubaccount(bob, 0x42, 77n)));
    expect(Array.from(await dexAny.getOfferEscrowSubaccount(bob, 77n))).not.toEqual(Array.from(sub)); // the marker differs
  });

  it('reserves bids only on active offers that exist', async () => {
    expect(errOf(await dexBob.reserveBid(999n))).toHaveProperty('OfferNotFound');
    const id = await listTokens(1_000n);
    const bidId = unwrap(await dexBob.reserveBid(id));
    const b = await bid(bidId);
    expect(b.amount).toBe(0n);
    expect(b.tokens_escrowed).toBe(false);
    expect(b.offer_id).toBe(id);
    expect(b.bidder.toText()).toBe(bob.toText());
    expect(await dexAny.getNextBidId()).toBe(bidId + 1n);
    // unconfirmed reservations are invisible in the views
    expect((await dexAny.getOfferView(id))[0].bids).toEqual([]);
    expect((await dexAny.getBidsByBidder(bob)).some((x) => x.id === bidId)).toBe(false);
    unwrap(await dexAlice.cancelOffer(id));
  });

  it('confirms only by the bidder, with a positive amount at or above the minimum, backed by the escrow', async () => {
    const id = await listTokens(1_000n);
    const bidId = unwrap(await dexBob.reserveBid(id));
    expect(errOf(await dexCarol.confirmBid(bidId, E8))).toHaveProperty('NotAuthorized');
    expect(errOf(await dexBob.confirmBid(999n, E8))).toHaveProperty('BidNotFound');
    expect(errOf(await dexBob.confirmBid(bidId, 0n))).toHaveProperty('InvalidPrice');
    expect(errOf(await dexBob.confirmBid(bidId, E8 - 1n))).toEqual({ BidTooLow: { minimum: E8 } });
    expect(errOf(await dexBob.confirmBid(bidId, E8))).toEqual({ InsufficientFunds: { required: E8, available: 0n } });
    unwrap(await transfer(icpAs(bob), account(dexId, await dexAny.getBidEscrowSubaccount(bob, bidId)), E8));
    unwrap(await dexBob.confirmBid(bidId, E8));
    const b = await bid(bidId);
    expect(b.amount).toBe(E8);
    expect(b.tokens_escrowed).toBe(true);
    expect(errOf(await dexBob.confirmBid(bidId, E8))).toHaveProperty('InvalidState'); // already confirmed
    const view = (await dexAny.getOfferView(id))[0];
    expect(view.bids.map((x) => x.id)).toEqual([bidId]);
    expect(view.highest_bid[0].id).toBe(bidId);
    expect((await dexAny.getBidsByBidder(bob)).some((x) => x.id === bidId)).toBe(true);
    expect(unwrap(await dexAny.getBidEscrowBalance(bidId))).toBe(E8);
    unwrap(await dexAlice.cancelOffer(id));
    await settle(3);
  });

  it('refunds the escrow above the confirmed amount at once', async () => {
    const id = await listTokens(1_000n);
    const bob0 = await balance(icp, bob);
    const bidId = await placeBid(dexBob, bob, id, 2n * E8, 3n * E8);
    expect(await balance(icp, dexId, await dexAny.getBidEscrowSubaccount(bob, bidId))).toBe(2n * E8);
    expect(await balance(icp, bob)).toBe(bob0 - 3n * E8 - ICP_FEE + E8 - ICP_FEE);
    unwrap(await dexAlice.cancelOffer(id));
    await settle(3);
  });

  it('requires each new bid to beat the highest by the fee multiple', async () => {
    const id = await listTokens(1_000n, { min_bid_increment_fee_multiple: [100n] }); // 100 * 10_000 = 1 ICP... of fee units: 1_000_000 e8s
    await placeBid(dexBob, bob, id, 2n * E8);
    const low = await fundBid(dexCarol, carol, id, 3n * E8);
    expect(errOf(await dexCarol.confirmBid(low, 2n * E8))).toEqual({ BidIncrementTooSmall: { current_highest: 2n * E8, minimum_next: 2n * E8 + 1_000_000n, required_increment: 1_000_000n } });
    expect(errOf(await dexCarol.confirmBid(low, 2n * E8 + 999_999n))).toHaveProperty('BidIncrementTooSmall');
    unwrap(await dexCarol.confirmBid(low, 2n * E8 + 1_000_000n));
    expect((await dexAny.getOfferView(id))[0].highest_bid[0].id).toBe(low);
    unwrap(await dexAlice.cancelOffer(id));
    await settle(3);
  });

  it('without a multiple, any higher amount outbids; an equal one does not', async () => {
    const id = await listTokens(1_000n);
    await placeBid(dexBob, bob, id, 2n * E8);
    const c = await fundBid(dexCarol, carol, id, 3n * E8);
    expect(errOf(await dexCarol.confirmBid(c, 2n * E8))).toEqual({ BidIncrementTooSmall: { current_highest: 2n * E8, minimum_next: 2n * E8 + 1n, required_increment: 1n } });
    unwrap(await dexCarol.confirmBid(c, 2n * E8 + 1n));
    unwrap(await dexAlice.cancelOffer(id));
    await settle(3);
  });

  it('marks an outbid bid lost and refunds it by itself', async () => {
    const id = await listTokens(1_000n);
    const bob0 = await balance(icp, bob);
    const b = await placeBid(dexBob, bob, id, 2n * E8);
    const c = await placeBid(dexCarol, carol, id, 3n * E8);
    expect(await bidState(b)).toBe('Lost');
    expect(await bidState(c)).toBe('Pending');
    expect(errOf(await dexBob.withdrawBidEscrow(b, 1n))).not.toHaveProperty('NotAuthorized'); // lost bids may be withdrawn from, but the reserve holds
    await settle(2);
    expect(await bidState(b)).toBe('Refunded');
    expect(await balance(icp, bob)).toBe(bob0 - 2n * E8 - ICP_FEE + 2n * E8 - ICP_FEE);
    expect(errOf(await dexBob.refundBid(b))).toHaveProperty('InvalidState'); // already refunded
    unwrap(await dexAlice.cancelOffer(id));
    await settle(3);
  });

  it('lets an outbid bidder refund by hand before the timer runs', async () => {
    const id = await listTokens(1_000n);
    const b = await placeBid(dexBob, bob, id, 2n * E8);
    expect(errOf(await dexBob.refundBid(b))).toHaveProperty('InvalidState'); // not lost yet
    await placeBid(dexCarol, carol, id, 3n * E8);
    const bob0 = await balance(icp, bob);
    expect(errOf(await dexCarol.refundBid(b))).toHaveProperty('NotAuthorized');
    unwrap(await dexBob.refundBid(b));
    expect(await bidState(b)).toBe('Refunded');
    expect(await balance(icp, bob)).toBe(bob0 + 2n * E8 - ICP_FEE);
    await settle(2); // the auto-refund finds nothing to do
    expect(await balance(icp, bob)).toBe(bob0 + 2n * E8 - ICP_FEE);
    unwrap(await dexAlice.cancelOffer(id));
    await settle(3);
  });

  it('withdraws everything from an unconfirmed reservation and only the excess after confirmation', async () => {
    const id = await listTokens(1_000n);
    const b = await fundBid(dexBob, bob, id, E8);
    const sub = await dexAny.getBidEscrowSubaccount(bob, b);
    expect(errOf(await dexCarol.withdrawBidEscrow(b, 1n))).toHaveProperty('NotAuthorized');
    expect(errOf(await dexBob.withdrawBidEscrow(b, E8 + 1n))).toEqual({ InsufficientFunds: { available: E8, required: E8 + 1n } });
    unwrap(await dexBob.withdrawBidEscrow(b, E8 / 2n));
    expect(await balance(icp, dexId, sub)).toBe(E8 / 2n - ICP_FEE);
    unwrap(await dexBob.withdrawBidEscrow(b, E8 / 2n - 2n * ICP_FEE));
    expect(await balance(icp, dexId, sub)).toBe(0n);
    expect(errOf(await dexBob.confirmBid(b, E8))).toHaveProperty('InsufficientFunds');
    // confirmed: the bid amount plus one fee stays reserved
    const c = await placeBid(dexCarol, carol, id, 2n * E8);
    const subC = await dexAny.getBidEscrowSubaccount(carol, c);
    expect(errOf(await dexCarol.withdrawBidEscrow(c, 1n))).toEqual({ InsufficientFunds: { available: 0n, required: 1n } });
    unwrap(await transfer(icpAs(carol), account(dexId, subC), E8));
    expect(errOf(await dexCarol.withdrawBidEscrow(c, E8))).toEqual({ InsufficientFunds: { available: E8 - ICP_FEE, required: E8 } });
    unwrap(await dexCarol.withdrawBidEscrow(c, E8 - ICP_FEE));
    expect(await balance(icp, dexId, subC)).toBe(2n * E8);
    unwrap(await dexAlice.cancelOffer(id));
    await settle(3);
  });

  it('serialises payouts per bid: a second withdrawal in flight is refused', async () => {
    const id = await listTokens(1_000n);
    const b = await fundBid(dexBob, bob, id, E8);
    const deferred = pic.createDeferredActor({ idlFactory: sneedexIdl, canisterId: dexId });
    deferred.setPrincipal(bob);
    // both pass the balance check before either transfer settles unless the lock stops the second
    const first = await deferred.withdrawBidEscrow(b, 60_000_000n);
    const second = await deferred.withdrawBidEscrow(b, 60_000_000n);
    const [r1, r2] = [await first(), await second()];
    const oks = [r1, r2].filter((r) => 'ok' in r);
    const errs = [r1, r2].filter((r) => 'err' in r).map((r) => r.err);
    expect(oks.length).toBe(1);
    expect(errs.length).toBe(1);
    expect(errs[0]).toEqual({ InvalidState: expect.stringMatching(/already in progress/) });
    expect(await balance(icp, dexId, await dexAny.getBidEscrowSubaccount(bob, b))).toBe(E8 - 60_000_000n - ICP_FEE);
    unwrap(await dexAlice.cancelOffer(id));
    await settle(3);
  });

  it('refuses bidders outside the approved list of a private offer', async () => {
    const id = await listTokens(1_000n, { approved_bidders: [[bob]] });
    expect(errOf(await dexCarol.reserveBid(id))).toHaveProperty('NotAuthorized');
    const b = await placeBid(dexBob, bob, id, E8);
    expect(await bidState(b)).toBe('Pending');
    expect((await dexAny.getPublicOffers()).some((o) => o.id === id)).toBe(false);
    expect((await dexAny.getPrivateOffersFor(bob)).some((o) => o.id === id)).toBe(true);
    expect((await dexAny.getPrivateOffersFor(carol)).some((o) => o.id === id)).toBe(false);
    expect((await dexAny.getPrivateOffersFor(alice)).some((o) => o.id === id)).toBe(true);
    unwrap(await dexAlice.cancelOffer(id));
    await settle(3);
  });

  it('cancelling an offer with bids marks them lost and refunds them', async () => {
    const id = await listTokens(1_000n);
    const bob0 = await balance(icp, bob); const carol0 = await balance(icp, carol);
    const b = await placeBid(dexBob, bob, id, E8);
    const c = await placeBid(dexCarol, carol, id, 2n * E8);
    const unconfirmed = unwrap(await dexBob.reserveBid(id));
    unwrap(await dexAlice.cancelOffer(id));
    expect(await state(id)).toBe('Cancelled');
    expect(await bidState(b)).toBe('Lost');
    expect(await bidState(c)).toBe('Lost');
    expect(await bidState(unconfirmed)).toBe('Pending'); // nothing escrowed, nothing to refund
    expect(errOf(await dexBob.confirmBid(unconfirmed, E8))).toHaveProperty('InvalidState');
    await settle(3);
    expect(await bidState(b)).toBe('Refunded');
    expect(await bidState(c)).toBe('Refunded');
    expect(await balance(icp, bob)).toBe(bob0 - 2n * ICP_FEE);
    expect(await balance(icp, carol)).toBe(carol0 - 2n * ICP_FEE);
    expect(await state(id)).toBe('Reclaimed');
  });
});

describe('buyout and acceptance', () => {
  it('a bid at or above the buyout is capped at the buyout and completes the offer at once', async () => {
    const id = await listTokens(1_000n, { buyout_price: [5n * E8] });
    const bob0 = await balance(icp, bob);
    const b = await placeBid(dexBob, bob, id, 6n * E8, 6n * E8);
    const x = await bid(b);
    expect(x.amount).toBe(5n * E8);
    expect(x.state).toEqual({ Won: null });
    expect((await offer(id)).state.Completed.winning_bid_id).toBe(b);
    expect(await balance(icp, dexId, await dexAny.getBidEscrowSubaccount(bob, b))).toBe(5n * E8);
    expect(await balance(icp, bob)).toBe(bob0 - 6n * E8 - ICP_FEE + E8 - ICP_FEE);
    expect(errOf(await dexCarol.reserveBid(id))).toHaveProperty('InvalidState');
    await settle(4);
    expect(await state(id)).toBe('Claimed');
  });

  it('a buyout-only offer takes the buyout as its minimum bid', async () => {
    const id = await listTokens(1_000n, { min_bid_price: [], buyout_price: [3n * E8], expiration: [] });
    const b = await fundBid(dexBob, bob, id, 3n * E8);
    expect(errOf(await dexBob.confirmBid(b, 2n * E8))).toEqual({ BidTooLow: { minimum: 3n * E8 } });
    unwrap(await dexBob.confirmBid(b, 3n * E8));
    expect(await bidState(b)).toBe('Won');
    expect(errOf(await dexAny.processExpiration(id))).toHaveProperty('InvalidState');
    await settle(4);
    expect(await state(id)).toBe('Claimed');
  });

  it('acceptBid needs the creator, an active offer and at least one confirmed bid', async () => {
    const id = await listTokens(1_000n);
    expect(errOf(await dexBob.acceptBid(id))).toHaveProperty('NotAuthorized');
    expect(errOf(await dexAlice.acceptBid(id))).toHaveProperty('InvalidState'); // no bids
    unwrap(await dexBob.reserveBid(id)); // a reservation is not a bid
    expect(errOf(await dexAlice.acceptBid(id))).toHaveProperty('InvalidState');
    expect(errOf(await dexAlice.acceptBid(999n))).toHaveProperty('OfferNotFound');
    const b = await placeBid(dexBob, bob, id, E8);
    const c = await placeBid(dexCarol, carol, id, 2n * E8);
    unwrap(await dexAlice.acceptBid(id));
    expect((await offer(id)).state.Completed.winning_bid_id).toBe(c);
    expect(await bidState(b)).toBe('Lost');
    expect(errOf(await dexAlice.acceptBid(id))).toHaveProperty('InvalidState');
    expect(errOf(await dexAlice.cancelOffer(id))).toHaveProperty('InvalidState');
    await settle(4);
    expect(await state(id)).toBe('Claimed');
  });

  it('two buyers racing for the buyout: one wins, the other is marked lost and refunded', async () => {
    const id = await listTokens(1_000n, { buyout_price: [5n * E8] });
    const b = await fundBid(dexBob, bob, id, 5n * E8);
    const c = await fundBid(dexCarol, carol, id, 5n * E8);
    const bob0 = await balance(icp, bob); const carol0 = await balance(icp, carol);
    const dBob = pic.createDeferredActor({ idlFactory: sneedexIdl, canisterId: dexId }); dBob.setPrincipal(bob);
    const dCarol = pic.createDeferredActor({ idlFactory: sneedexIdl, canisterId: dexId }); dCarol.setPrincipal(carol);
    const first = await dBob.confirmBid(b, 5n * E8);
    const second = await dCarol.confirmBid(c, 5n * E8);
    const [r1, r2] = [await first(), await second()];
    const results = [[b, r1], [c, r2]];
    const winners = results.filter(([, r]) => 'ok' in r).map(([x]) => x);
    const losers = results.filter(([, r]) => 'err' in r);
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
    expect(losers[0][1].err).toHaveProperty('InvalidState');
    expect((await offer(id)).state.Completed.winning_bid_id).toBe(winners[0]);
    expect(await bidState(winners[0])).toBe('Won');
    expect(await bidState(losers[0][0])).toBe('Lost');
    await settle(4);
    expect(await bidState(losers[0][0])).toBe('Refunded');
    const refunded = losers[0][0] === b ? [bob, bob0] : [carol, carol0];
    expect(await balance(icp, refunded[0])).toBe(refunded[1] + 5n * E8 - ICP_FEE);
    expect(await state(id)).toBe('Claimed');
  });
});

describe('canister assets', () => {
  it('escrow needs Sneedex among the controllers, then takes sole control and snapshots the others', async () => {
    const id = await newOffer();
    unwrap(await dexAlice.addAsset({ offer_id: id, asset: canisterAsset(canA) }));
    unwrap(await dexAlice.finalizeAssets(id));
    expect(errOf(await dexAlice.escrowCanister(id, 0n))).toHaveProperty('CanisterError'); // Sneedex cannot even read the status
    expect(await controllersOf(canA, alice)).toEqual(sortedText([alice]));
    await pic.updateCanisterSettings({ canisterId: canA, controllers: [alice, dexId], sender: alice });
    unwrap(await dexAlice.escrowCanister(id, 0n));
    const a = (await offer(id)).assets[0];
    expect(a.escrowed).toBe(true);
    expect(a.asset.Canister.controllers_snapshot[0].map((p) => p.toText())).toEqual([alice.toText()]);
    expect(await controllersOf(canA, dexId)).toEqual([dexId.toText()]);
    const info = unwrap(await dexAny.getCanisterInfo(id, 0n));
    expect(info.controllers.map((p) => p.toText())).toEqual([dexId.toText()]);
    expect(info.canister_id.toText()).toBe(canA.toText());
    expect(errOf(await dexAlice.escrowCanister(id, 0n))).toHaveProperty('InvalidAsset'); // already escrowed
    // the escrowed canister cannot be listed again while this offer holds it
    const other = await newOffer();
    expect(errOf(await dexAlice.addAsset({ offer_id: other, asset: canisterAsset(canA) }))).toHaveProperty('InvalidAsset');
    unwrap(await dexAlice.cancelOffer(other));
    unwrap(await dexAlice.activateOffer(id));
    // sold to bob: he becomes the sole controller
    await placeBid(dexBob, bob, id, E8);
    unwrap(await dexAlice.acceptBid(id));
    unwrap(await dexBob.claimAssets(id));
    expect(await state(id)).toBe('Claimed');
    expect(await controllersOf(canA, bob)).toEqual([bob.toText()]);
    expect(errOf(await dexAny.getCanisterInfo(id, 0n))).toHaveProperty('CanisterError'); // no longer a controller
    await settle(4);
  }, 180_000);

  it('a cancelled offer returns the canister to its previous controllers (Sneedex removed)', async () => {
    const id = await newOffer();
    unwrap(await dexAlice.addAsset({ offer_id: id, asset: canisterAsset(canB, { canister_kind: [0n] }) }));
    unwrap(await dexAlice.finalizeAssets(id));
    await pic.updateCanisterSettings({ canisterId: canB, controllers: [alice, carol, dexId], sender: alice });
    expect(errOf(await dexCarol.escrowCanister(id, 0n))).toHaveProperty('NotAuthorized');
    unwrap(await dexAlice.escrowCanister(id, 0n));
    expect((await offer(id)).assets[0].asset.Canister.controllers_snapshot[0].map((p) => p.toText()).sort()).toEqual(sortedText([alice, carol]));
    expect(await controllersOf(canB, dexId)).toEqual([dexId.toText()]);
    unwrap(await dexAlice.activateOffer(id));
    unwrap(await dexAlice.cancelOffer(id));
    unwrap(await dexAlice.reclaimAssets(id));
    expect(await state(id)).toBe('Reclaimed');
    expect(await controllersOf(canB, alice)).toEqual(sortedText([alice, carol]));
    await settle(3);
  }, 180_000);

  it('a canister that is not Sneedex-controlled cannot be escrowed by someone who is not a controller', async () => {
    // bob lists alice's canister: the status call works for Sneedex (a controller again after bob adds it), but bob is no controller
    const id = await newOffer(dexBob);
    unwrap(await dexBob.addAsset({ offer_id: id, asset: canisterAsset(canB) }));
    unwrap(await dexBob.finalizeAssets(id));
    await pic.updateCanisterSettings({ canisterId: canB, controllers: [alice, carol, dexId], sender: alice });
    expect(errOf(await dexBob.escrowCanister(id, 0n))).toEqual({ CanisterError: expect.stringMatching(/Caller is not a controller/) });
    expect((await offer(id)).assets[0].escrowed).toBe(false);
    unwrap(await dexBob.cancelOffer(id));
    await pic.updateCanisterSettings({ canisterId: canB, controllers: [alice, carol], sender: alice });
    await settle(3);
  });

  it('lists the canister kinds and refuses to verify a canister that is no staking bot', async () => {
    const kinds = await dexAny.getCanisterKinds();
    expect(kinds.map((k) => [k.id, k.name])).toEqual([[0n, 'Unknown'], [1n, 'ICP Staking Bot'], [2n, 'Trading Bot']]);
    expect(await dexAny.verifyICPNeuronManager(canA)).toHaveProperty('Err');
    expect(await dexAny.verifyTradingBot(canA)).toHaveProperty('Err');
    expect(await dexAny.getNeuronManagerInfo(canA)).toEqual({ Err: 'Canister is not in escrow' });
    expect(await dexAny.getCachedNeuronManagerInfoQuery(canA)).toEqual([]);
  });
});

describe('SNS neuron assets', () => {
  beforeAll(async () => {
    await gov.create_neuron(N1, alice, FULL_OWNER, 123_000_000n);
    await gov.create_neuron(N2, bob, FULL_OWNER, 1n);
    await gov.create_neuron(N3, alice, [0, ...FULL_OWNER], 5n);
    await gov.create_neuron(N4, alice, FULL_OWNER, 7n);
  });
  const addPerms = async (actor, id, p, perms) => { const r = await actor.manage_neuron({ subaccount: id, command: [{ AddNeuronPermissions: { permissions_to_add: [{ permissions: perms }], principal_id: [p] } }] }); expect(r.command[0]).toHaveProperty('AddNeuronPermission'); };

  it('escrow needs the seller and Sneedex as full owners of an existing neuron', async () => {
    const id = await newOffer();
    unwrap(await dexAlice.addAsset({ offer_id: id, asset: neuronAsset(N1) }));
    expect(errOf(await dexAlice.addAsset({ offer_id: id, asset: neuronAsset(N1) }))).toHaveProperty('InvalidAsset'); // same neuron twice
    unwrap(await dexAlice.addAsset({ offer_id: id, asset: neuronAsset(N2) }));
    unwrap(await dexAlice.addAsset({ offer_id: id, asset: neuronAsset(new Uint8Array(32).fill(9)) }));
    unwrap(await dexAlice.finalizeAssets(id));
    expect(errOf(await dexAlice.escrowSNSNeuron(id, 0n))).toEqual({ GovernanceError: expect.stringMatching(/Sneedex canister does not have owner permissions/) });
    expect(errOf(await dexAlice.escrowSNSNeuron(id, 1n))).toEqual({ GovernanceError: expect.stringMatching(/Caller does not have owner permissions/) });
    expect(errOf(await dexAlice.escrowSNSNeuron(id, 2n))).toEqual({ GovernanceError: 'Neuron not found' });
    // a vote-only hotkey for Sneedex is not enough
    await addPerms(govAlice, N1, dexId, [4]);
    expect(errOf(await dexAlice.escrowSNSNeuron(id, 0n))).toHaveProperty('GovernanceError');
    expect((await offer(id)).assets.every((a) => !a.escrowed)).toBe(true);
    unwrap(await dexAlice.cancelOffer(id));
    await settle(3);
  });

  it('escrow strips every other principal, snapshots them, and the stake is cached after activation', async () => {
    await addPerms(govAlice, N1, dexId, FULL_OWNER);
    await addPerms(govAlice, N1, carol, [3, 4]); // a hotkey with partial permissions
    const id = await newOffer();
    unwrap(await dexAlice.addAsset({ offer_id: id, asset: neuronAsset(N1) }));
    unwrap(await dexAlice.finalizeAssets(id));
    unwrap(await dexAlice.escrowSNSNeuron(id, 0n));
    const a = (await offer(id)).assets[0];
    expect(a.escrowed).toBe(true);
    expect(a.asset.SNSNeuron.hotkeys_snapshot[0].map((p) => p.toText()).sort()).toEqual(sortedText([alice, carol]));
    expect(a.asset.SNSNeuron.cached_stake_e8s).toEqual([]);
    expect(await permsOf(N1)).toEqual([[dexId.toText(), FULL_OWNER]]);
    expect(errOf(await dexAlice.escrowSNSNeuron(id, 0n))).toHaveProperty('InvalidAsset'); // already escrowed
    unwrap(await dexAlice.activateOffer(id));
    await settle(2);
    expect((await offer(id)).assets[0].asset.SNSNeuron.cached_stake_e8s).toEqual([123_000_000n]);
    // sold: the winner becomes the only principal
    const won = await placeBid(dexBob, bob, id, E8);
    unwrap(await dexAlice.acceptBid(id));
    unwrap(await dexBob.claimAssets(id));
    expect(await permsOf(N1)).toEqual([[bob.toText(), FULL_OWNER]]);
    await settle(4);
    expect(await bidState(won)).toBe('ClaimedBySeller');
  }, 180_000);

  it('a cancelled offer gives each snapshotted principal back exactly its own permissions and removes Sneedex', async () => {
    // N3 carries the "Unspecified" permission 0 as real SNS neurons do; the strip uses the actual list
    await addPerms(govAlice, N3, dexId, FULL_OWNER);
    await addPerms(govAlice, N3, carol, [4]);
    const id = await newOffer();
    unwrap(await dexAlice.addAsset({ offer_id: id, asset: neuronAsset(N3) }));
    unwrap(await dexAlice.finalizeAssets(id));
    unwrap(await dexAlice.escrowSNSNeuron(id, 0n));
    expect(await permsOf(N3)).toEqual([[dexId.toText(), FULL_OWNER]]);
    unwrap(await dexAlice.activateOffer(id));
    unwrap(await dexAlice.cancelOffer(id));
    unwrap(await dexAlice.reclaimAssets(id));
    expect(await state(id)).toBe('Reclaimed');
    // alice gets her owner set back (less the ungrantable 0), carol only her vote-only hotkey
    expect(await permsOf(N3)).toEqual([[alice.toText(), FULL_OWNER], [carol.toText(), [4]]].sort());
    await settle(3);
  }, 180_000);

  it('a governance refusal during escrow leaves the asset unescrowed and the neuron untouched', async () => {
    await addPerms(govAlice, N4, dexId, FULL_OWNER);
    const id = await newOffer();
    unwrap(await dexAlice.addAsset({ offer_id: id, asset: neuronAsset(N4) }));
    unwrap(await dexAlice.finalizeAssets(id));
    await gov.set_fail(true);
    expect(errOf(await dexAlice.escrowSNSNeuron(id, 0n))).toEqual({ GovernanceError: expect.stringMatching(/Failed to remove permissions/) });
    await gov.set_fail(false);
    expect((await offer(id)).assets[0].escrowed).toBe(false);
    expect(await permsOf(N4)).toEqual([[alice.toText(), FULL_OWNER], [dexId.toText(), FULL_OWNER]].sort());
    unwrap(await dexAlice.escrowSNSNeuron(id, 0n));
    expect(await permsOf(N4)).toEqual([[dexId.toText(), FULL_OWNER]]);
    unwrap(await dexAlice.cancelOffer(id));
    await settle(3); // auto-reclaim hands it back
    expect(await state(id)).toBe('Reclaimed');
    expect(await permsOf(N4)).toEqual([[alice.toText(), FULL_OWNER]]);
  }, 180_000);
});

describe('expiration', () => {
  it('processExpiration refuses offers that are not active, have no expiration or have not expired', async () => {
    expect(errOf(await dexAny.processExpiration(999n))).toHaveProperty('OfferNotFound');
    const id = await listTokens(1_000n);
    expect(errOf(await dexAny.processExpiration(id))).toEqual({ InvalidState: expect.stringMatching(/not expired yet/) });
    const noExp = await listTokens(1_000n, { expiration: [], buyout_price: [E8] });
    expect(errOf(await dexAny.processExpiration(noExp))).toEqual({ InvalidState: expect.stringMatching(/no expiration/) });
    unwrap(await dexAlice.cancelOffer(id));
    unwrap(await dexAlice.cancelOffer(noExp));
    await settle(3);
  });

  it('an expired offer without bids becomes Expired and its assets go back to the seller', async () => {
    const id = await listTokens(50_000n, { expiration: [await inSeconds(2 * 3600)] });
    const aliceA0 = await balance(tokenA, alice);
    await settle(3 * 3600, 2);
    expect(errOf(await dexBob.reserveBid(id))).toHaveProperty('OfferExpired');
    unwrap(await dexCarol.processExpiration(id)); // anyone may call it
    expect(await state(id)).toBe('Expired');
    expect(errOf(await dexAny.processExpiration(id))).toHaveProperty('InvalidState');
    expect(errOf(await dexAlice.cancelOffer(id))).toHaveProperty('InvalidState');
    unwrap(await dexAlice.reclaimAssets(id));
    expect(await state(id)).toBe('Reclaimed');
    expect(await balance(tokenA, alice)).toBe(aliceA0 + 50_000n - FEE_A);
    await settle(3);
  });

  it('an expired offer with bids completes with the highest bid and is delivered', async () => {
    const id = await listTokens(60_000n, { expiration: [await inSeconds(2 * 3600)] });
    const b = await placeBid(dexBob, bob, id, E8);
    const c = await placeBid(dexCarol, carol, id, 2n * E8);
    const late = await fundBid(dexBob, bob, id, 3n * E8); // reserved before, confirmed after the expiration
    const carolA0 = await balance(tokenA, carol);
    await settle(3 * 3600, 2);
    expect(errOf(await dexBob.confirmBid(late, 3n * E8))).toHaveProperty('OfferExpired');
    unwrap(await dexAny.processExpiration(id));
    expect((await offer(id)).state.Completed.winning_bid_id).toBe(c);
    expect(await bidState(b)).toBe('Refunded'); // was refunded when outbid earlier
    await settle(4);
    expect(await state(id)).toBe('Claimed');
    expect(await bidState(c)).toBe('ClaimedBySeller');
    expect(await bidState(late)).toBe('Lost'); // never escrowed, so nothing to refund
    expect(await balance(tokenA, carol)).toBe(carolA0 + 60_000n - FEE_A);
    unwrap(await dexBob.withdrawBidEscrow(late, 3n * E8 - ICP_FEE)); // the unconfirmed deposit is withdrawable
  });

  it('a pending offer whose expiration has passed cannot be activated', async () => {
    const id = await newOffer(dexAlice, { expiration: [await inSeconds(2 * 3600)] });
    unwrap(await dexAlice.addAsset({ offer_id: id, asset: tokenAsset(1_000n) }));
    unwrap(await dexAlice.finalizeAssets(id));
    unwrap(await transfer(tokenAAs(alice), account(dexId, await dexAny.getOfferEscrowSubaccount(alice, id)), 1_000n));
    unwrap(await dexAlice.escrowICRC1Tokens(id, 0n));
    await settle(3 * 3600, 2);
    expect(errOf(await dexAlice.activateOffer(id))).toHaveProperty('OfferExpired');
    unwrap(await dexAlice.cancelOffer(id));
    await settle(3);
    expect(await state(id)).toBe('Reclaimed');
  });

  it('the admin-triggered worker processes every expired offer, with and without bids', async () => {
    const withBids = await listTokens(1_000n, { expiration: [await inSeconds(2 * 3600)] });
    const without = await listTokens(2_000n, { expiration: [await inSeconds(2 * 3600)] });
    const later = await listTokens(3_000n); // 30 days: untouched
    const b = await placeBid(dexBob, bob, withBids, E8);
    expect(await dexAny.isExpirationWorkerRunning()).toBe(false);
    expect(errOf(await dexBob.triggerExpirationCheck())).toHaveProperty('NotAuthorized');
    unwrap(await dexAdmin.triggerExpirationCheck()); // nothing expired yet: a no-op
    expect(await dexAny.isExpirationWorkerRunning()).toBe(false);
    await settle(3 * 3600, 2);
    unwrap(await dexAdmin.triggerExpirationCheck());
    await settle(1, 10);
    expect(await dexAny.isExpirationWorkerRunning()).toBe(false);
    expect((await offer(withBids)).state.Completed.winning_bid_id).toBe(b);
    expect(await state(without)).toBe('Expired');
    expect(await state(later)).toBe('Active');
    await settle(4);
    expect(await state(withBids)).toBe('Claimed');
    expect(await state(without)).toBe('Reclaimed');
    unwrap(await dexAlice.cancelOffer(later));
    await settle(3);
  }, 180_000);

  it('the periodic timer picks expired offers up on its interval', async () => {
    expect(await dexAny.isExpirationTimerRunning()).toBe(false);
    expect(errOf(await dexAdmin.setExpirationCheckInterval(30n))).toHaveProperty('InvalidInput');
    unwrap(await dexAdmin.setExpirationCheckInterval(60n));
    expect(await dexAny.getExpirationCheckInterval()).toBe(60n);
    expect(errOf(await dexBob.startExpirationTimer())).toHaveProperty('NotAuthorized');
    unwrap(await dexAdmin.startExpirationTimer());
    expect(await dexAny.isExpirationTimerRunning()).toBe(true);
    const id = await listTokens(4_000n, { expiration: [await inSeconds(2 * 3600)] });
    await settle(3 * 3600, 10);
    expect(await state(id)).toBe('Expired');
    await settle(4);
    expect(await state(id)).toBe('Reclaimed');
    expect(errOf(await dexBob.stopExpirationTimer())).toHaveProperty('NotAuthorized');
    unwrap(await dexAdmin.stopExpirationTimer());
    expect(await dexAny.isExpirationTimerRunning()).toBe(false);
  }, 180_000);
});

describe('queries', () => {
  it('pages the offer feed newest first with has_more and next_start_id', async () => {
    const all = (await dexAny.getOfferFeed({ start_id: [], length: 1000n, filter: [] })).offers.map((o) => o.id);
    expect(all.length).toBe(Number(await dexAny.getNextOfferId()));
    expect(all).toEqual([...all].sort((a, b) => (a > b ? -1 : 1)));
    const page1 = await dexAny.getOfferFeed({ start_id: [], length: 3n, filter: [] });
    expect(page1.offers.map((o) => o.id)).toEqual(all.slice(0, 3));
    expect(page1.has_more).toBe(true);
    expect(page1.next_start_id).toEqual([all[2]]);
    const page2 = await dexAny.getOfferFeed({ start_id: page1.next_start_id, length: 3n, filter: [] });
    expect(page2.offers.map((o) => o.id)).toEqual(all.slice(3, 6));
    const last = await dexAny.getOfferFeed({ start_id: [all.at(-2)], length: 3n, filter: [] });
    expect(last.offers.map((o) => o.id)).toEqual([all.at(-1)]);
    expect(last.has_more).toBe(false);
    expect(last.next_start_id).toEqual([all.at(-1)]);
    expect(await dexAny.getOfferFeed({ start_id: [0n], length: 3n, filter: [] })).toEqual({ offers: [], has_more: false, next_start_id: [] });
  });

  it('filters the feed by state, creator, asset type, bids and visibility', async () => {
    const filter = (f) => ({ states: [], asset_types: [], creator: [], has_bids: [], public_only: [], viewer: [], ...f });
    const feed = async (f) => (await dexAny.getOfferFeed({ start_id: [], length: 1000n, filter: [filter(f)] })).offers;
    const claimed = await feed({ states: [[{ Claimed: null }]] });
    expect(claimed.length).toBeGreaterThan(0);
    expect(claimed.every((o) => 'Claimed' in o.state)).toBe(true);
    const two = await feed({ states: [[{ Claimed: null }, { Reclaimed: null }]] });
    expect(two.length).toBeGreaterThan(claimed.length);
    expect((await feed({ creator: [bob] })).every((o) => o.creator.toText() === bob.toText())).toBe(true);
    expect((await feed({ creator: [bob] })).length).toBe(1);
    const neurons = await feed({ asset_types: [[1n]] });
    expect(neurons.length).toBe(4); // the validation offer, N1, N3 and N4
    expect(neurons.every((o) => o.assets.some((a) => 'SNSNeuron' in a.asset))).toBe(true);
    const canisters = await feed({ asset_types: [[0n]] });
    expect(canisters.every((o) => o.assets.some((a) => 'Canister' in a.asset))).toBe(true);
    const withBids = await feed({ has_bids: [true] });
    const noBids = await feed({ has_bids: [false] });
    expect(withBids.length + noBids.length).toBe((await feed({})).length);
    const priv = await feed({ public_only: [false], viewer: [bob] });
    expect(priv.length).toBe(2); // the two private offers approved for bob
    expect(priv.every((o) => o.approved_bidders.length === 1)).toBe(true);
    expect(await feed({ public_only: [false] })).toEqual([]); // private offers need a viewer
    expect((await feed({ public_only: [false], viewer: [carol] })).length).toBe(0);
    expect((await feed({ public_only: [false], viewer: [alice] })).length).toBe(2); // the creator sees her own
    expect((await feed({ public_only: [true] })).every((o) => o.approved_bidders.length === 0)).toBe(true);
  });

  it('getOfferView and queryOffer show the note to the buyer to the creator, and to the winner once the offer is won', async () => {
    const id = await listTokens(1_000n, { note_to_buyer: ['the keys are under the mat'], public_note: ['hello'] });
    const b = await placeBid(dexBob, bob, id, E8);
    expect(await dexAny.getOfferView(999n)).toEqual([]);
    const asBob = (await dexBob.getOfferView(id))[0];
    expect(asBob.offer.public_note).toEqual(['hello']);
    expect(asBob.offer.note_to_buyer).toEqual([]);
    expect(asBob.bids.map((x) => x.id)).toEqual([b]);
    expect(asBob.highest_bid[0].id).toBe(b);
    expect((await dexAlice.getOfferView(id))[0].offer.note_to_buyer).toEqual(['the keys are under the mat']);
    expect((await dexAlice.queryOffer(id))[0].note_to_buyer).toEqual(['the keys are under the mat']);
    expect((await dexBob.queryOffer(id))[0].note_to_buyer).toEqual([]); // the highest bidder is no winner yet
    expect((await dexCarol.queryOffer(id))[0].note_to_buyer).toEqual([]);
    const fromFeed = async (actor) => (await actor.getOfferFeed({ start_id: [], length: 1000n, filter: [] })).offers.find((o) => o.id === id).note_to_buyer;
    expect(await fromFeed(dexCarol)).toEqual([]);
    expect(await fromFeed(dexAlice)).toEqual(['the keys are under the mat']);
    unwrap(await dexAlice.acceptBid(id));
    // the winner reads the note once the offer is Completed, and still after it is Claimed
    expect((await dexBob.getOfferView(id))[0].offer.note_to_buyer).toEqual(['the keys are under the mat']);
    expect((await dexBob.queryOffer(id))[0].note_to_buyer).toEqual(['the keys are under the mat']);
    expect(await fromFeed(dexBob)).toEqual(['the keys are under the mat']);
    expect((await dexCarol.getOfferView(id))[0].offer.note_to_buyer).toEqual([]);
    expect((await dexCarol.queryOffer(id))[0].note_to_buyer).toEqual([]);
    expect((await dexBob.getOfferView(id))[0].highest_bid).toEqual([]);
    await settle(4);
    expect(await state(id)).toBe('Claimed');
    expect((await dexBob.getOfferView(id))[0].offer.note_to_buyer).toEqual(['the keys are under the mat']);
    expect((await dexCarol.getOfferView(id))[0].offer.note_to_buyer).toEqual([]);
  });

  it('counts offers, active, completed and bids in the market stats', async () => {
    const s = await dexAny.getMarketStats();
    const all = await dexAny.getOfferFeed({ start_id: [], length: 1000n, filter: [] });
    expect(s.total_offers).toBe(BigInt(all.offers.length));
    expect(s.active_offers).toBe(BigInt(all.offers.filter((o) => 'Active' in o.state).length));
    expect(s.completed_offers).toBe(BigInt(all.offers.filter((o) => 'Completed' in o.state || 'Claimed' in o.state).length));
    expect(s.total_bids).toBe(await dexAny.getNextBidId());
    expect((await dexAny.debugGetAllOffers()).length).toBe(all.offers.length);
  });

  it('notification settings default to all on and are stored per caller', async () => {
    const d = await dexBob.getMyNotificationSettings();
    expect(Object.values(d).every((v) => v === true)).toBe(true);
    unwrap(await dexBob.setMyNotificationSettings({ ...d, notify_on_outbid: false, notify_on_private_invite: false }));
    const s = await dexBob.getMyNotificationSettings();
    expect(s.notify_on_outbid).toBe(false);
    expect(s.notify_on_private_invite).toBe(false);
    expect(s.notify_on_bid).toBe(true);
    expect((await dexCarol.getMyNotificationSettings()).notify_on_outbid).toBe(true);
  });
});

describe('upgrade', () => {
  it('keeps offers, bids, settings and an open auction across an upgrade', async () => {
    const id = await listTokens(70_000n, { note_to_buyer: ['kept'] });
    const b = await placeBid(dexBob, bob, id, E8);
    const before = { offers: await dexAny.getOfferFeed({ start_id: [], length: 1000n, filter: [] }), bid: await bid(b), types: await dexAny.getAssetTypes(), config: await dexAny.getConfig(), interval: await dexAny.getExpirationCheckInterval() };
    await pic.upgradeCanister({ sender: admin, canisterId: dexId, wasm: wasm('sneedex'), arg: IDL.encode(sneedexInit({ IDL }), [[]]) });
    await pic.tick(2);
    expect(await dexAny.getOfferFeed({ start_id: [], length: 1000n, filter: [] })).toEqual(before.offers);
    expect(await bid(b)).toEqual(before.bid);
    expect(await dexAny.getAssetTypes()).toEqual(before.types);
    expect(await dexAny.getConfig()).toEqual(before.config);
    expect(await dexAny.getExpirationCheckInterval()).toBe(before.interval);
    expect(await dexAny.getNextBidId()).toBe(b + 1n);
    // the auction goes on: carol outbids, the seller accepts, delivery runs
    const c = await placeBid(dexCarol, carol, id, 2n * E8);
    expect(await bidState(b)).toBe('Lost');
    unwrap(await dexAlice.acceptBid(id));
    await settle(4);
    expect(await state(id)).toBe('Claimed');
    expect(await bidState(c)).toBe('ClaimedBySeller');
    expect(await bidState(b)).toBe('Refunded');
  }, 180_000);

  it('an upgrade while the expiration worker is scheduled schedules it again, so the flag clears and later triggers work', async () => {
    const id = await listTokens(1_000n, { expiration: [await inSeconds(2 * 3600)] });
    await settle(3 * 3600, 2);
    unwrap(await dexAdmin.triggerExpirationCheck()); // sets the flag and schedules the worker on a 0-second timer
    expect(await dexAny.isExpirationWorkerRunning()).toBe(true);
    await pic.upgradeCanister({ sender: admin, canisterId: dexId, wasm: wasm('sneedex'), arg: IDL.encode(sneedexInit({ IDL }), [[]]) });
    await settle(2, 10);
    // the upgrade dropped the 0-second worker timer; the new code scheduled the worker again and it finished
    expect(await state(id)).toMatch(/^(Expired|Reclaimed)$/); // processed, and maybe already auto-reclaimed
    expect(await dexAny.isExpirationWorkerRunning()).toBe(false);
    // later triggers are not refused
    const id2 = await listTokens(1_000n, { expiration: [await inSeconds(2 * 3600)] });
    await settle(3 * 3600, 2);
    unwrap(await dexAdmin.triggerExpirationCheck());
    await settle(2, 10);
    expect(await state(id2)).toMatch(/^(Expired|Reclaimed)$/);
    expect(await dexAny.isExpirationWorkerRunning()).toBe(false);
  }, 180_000);
});
