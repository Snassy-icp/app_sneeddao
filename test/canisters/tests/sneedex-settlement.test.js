// Sneedex settlement when a hand-over fails: an offer only becomes Claimed /
// Reclaimed once every asset has reached its recipient. A failed asset leaves
// the offer Completed / Cancelled, the assets already handed over are recorded
// and never sent twice, and the buyer's claimAssets / the seller's
// reclaimAssets retries just the rest (tokens on a ledger that refuses
// transfers, an SNS neuron whose governance refuses). Two claims at once are
// serialised. A seller payout whose seller transfer fails after the cut was
// paid does not pay the cut again on retry. Offers that the previous version
// marked Claimed / Reclaimed although a hand-over failed are recovered after
// an upgrade from that version (build/sneedex_prev.wasm).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, wasm, account, admin, alice, bob, carol, user, ICP_LEDGER_ID, T, unwrap, errOf } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { idlFactory as sneedexIdl, init as sneedexInit } from '../build/sneedex.did.js';

const ICP_FEE = 10_000n;
const FEE_A = 1_000n;
const FEE_B = 2_000n;
const FEE_P = 5_000n;
const E8 = 100_000_000n;
const DAY = 86_400;
const FULL_OWNER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const N1 = new Uint8Array(32).fill(11);
const N2 = new Uint8Array(32).fill(12);
const treasury = user('settlement-treasury');

// MockLedgerFaulty: the mock ledger plus rules that make transfers to given owners fail
const faultyIdl = ({ IDL }) => {
  const base = ledgerIdl({ IDL });
  return IDL.Service({
    ...Object.fromEntries(base._fields),
    set_fail_to: IDL.Func([IDL.Vec(IDL.Principal)], [], []),
  });
};
const neuronsIdl = ({ IDL }) => IDL.Service({
  create_neuron: IDL.Func([IDL.Vec(IDL.Nat8), IDL.Principal, IDL.Vec(IDL.Int32), IDL.Nat64], [], []),
  set_fail: IDL.Func([IDL.Bool], [], []),
  permissions_of: IDL.Func([IDL.Vec(IDL.Nat8)], [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Vec(IDL.Int32)))], ['query']),
  manage_neuron: IDL.Func([IDL.Record({ subaccount: IDL.Vec(IDL.Nat8), command: IDL.Opt(IDL.Variant({
    AddNeuronPermissions: IDL.Record({ permissions_to_add: IDL.Opt(IDL.Record({ permissions: IDL.Vec(IDL.Int32) })), principal_id: IDL.Opt(IDL.Principal) }),
    RemoveNeuronPermissions: IDL.Record({ permissions_to_remove: IDL.Opt(IDL.Record({ permissions: IDL.Vec(IDL.Int32) })), principal_id: IDL.Opt(IDL.Principal) }),
  })) })], [IDL.Record({ command: IDL.Opt(IDL.Variant({ Error: IDL.Record({ error_message: IDL.Text, error_type: IDL.Int32 }), AddNeuronPermission: IDL.Record({}), RemoveNeuronPermission: IDL.Record({}) })) })], []),
});

let pic, appSubnet, icpId, tokenAId, tokenBId, tokenPId, govId, dexId;
let icp, tokenA, tokenB, tokenP, gov, govAlice;

const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const inSeconds = async (s) => (await nowNs()) + BigInt(s) * 1_000_000_000n;
const settle = async (seconds = 5, rounds = 10) => { await pic.advanceTime(seconds * 1000); for (let i = 0; i < rounds; i++) await pic.tick(2); };
const balance = (ledger, owner, sub = null) => ledger.icrc1_balance_of(account(owner, sub));
const transfer = (ledger, to, amount) => ledger.icrc1_transfer({ from_subaccount: [], to, amount, fee: [], memo: [], created_at_time: [] });
const tokenAsset = (ledger, amount) => ({ ICRC1Token: { ledger_canister_id: ledger, amount } });
const neuronAsset = (id) => ({ SNSNeuron: { governance_canister_id: govId, neuron_id: { id }, hotkeys_snapshot: [], cached_stake_e8s: [] } });
const permsOf = async (id) => (await gov.permissions_of(id)).map(([p, perms]) => [p.toText(), Array.from(perms, Number).sort((a, b) => a - b)]).sort();
const addPerms = async (actor, id, p, perms) => { const r = await actor.manage_neuron({ subaccount: id, command: [{ AddNeuronPermissions: { permissions_to_add: [{ permissions: perms }], principal_id: [p] } }] }); expect(r.command[0]).toHaveProperty('AddNeuronPermission'); };

/// Talks to one Sneedex canister (the current build, or one installed from the previous version).
const market = (canisterId) => {
  const as = (p) => actorAs(pic, sneedexIdl, canisterId, p);
  const m = { id: canisterId, alice: as(alice), bob: as(bob), carol: as(carol), admin: as(admin) };
  m.offer = async (id) => (await m.bob.queryOffer(id))[0];
  m.state = async (id) => Object.keys((await m.offer(id)).state)[0];
  m.bidState = async (id) => Object.keys((await m.bob.queryBid(id))[0].state)[0];
  m.escrowSub = (id) => m.bob.getOfferEscrowSubaccount(alice, id);
  /// An active offer by alice of the given assets; tokens are sent to the escrow, neurons need Sneedex as owner already.
  m.list = async (assets, o = {}) => {
    const id = unwrap(await m.alice.createOffer({ min_bid_price: [E8], buyout_price: [], expiration: [await inSeconds(30 * DAY)], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: [], note_to_buyer: [], ...o }));
    for (const a of assets) unwrap(await m.alice.addAsset({ offer_id: id, asset: a }));
    unwrap(await m.alice.finalizeAssets(id));
    const sub = await m.escrowSub(id);
    for (const [i, a] of assets.entries()) {
      if (a.ICRC1Token) {
        unwrap(await transfer(actorAs(pic, ledgerIdl, a.ICRC1Token.ledger_canister_id, alice), account(canisterId, sub), a.ICRC1Token.amount));
        unwrap(await m.alice.escrowICRC1Tokens(id, BigInt(i)));
      } else {
        unwrap(await m.alice.escrowSNSNeuron(id, BigInt(i)));
      }
    }
    unwrap(await m.alice.activateOffer(id));
    return id;
  };
  /// Bob bids `amount` of the offer's price token (ICP unless `ledger` says otherwise).
  m.bid = async (offerId, amount, ledgerId = icpId) => {
    const bidId = unwrap(await m.bob.reserveBid(offerId));
    unwrap(await transfer(actorAs(pic, ledgerIdl, ledgerId, bob), account(canisterId, await m.bob.getBidEscrowSubaccount(bob, bidId)), amount));
    unwrap(await m.bob.confirmBid(bidId, amount));
    return bidId;
  };
  return m;
};
let dex;

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  tokenBId = await install(pic, { name: 'MockLedgerFaulty', initTypes: ledgerInit, initArgs: [{ fee: FEE_B, symbol: 'BBB', decimals: 8 }], targetSubnetId: appSubnet });
  tokenPId = await install(pic, { name: 'MockLedgerFaulty', initTypes: ledgerInit, initArgs: [{ fee: FEE_P, symbol: 'PPP', decimals: 8 }], targetSubnetId: appSubnet });
  govId = await install(pic, { name: 'MockSnsNeurons', targetSubnetId: appSubnet });
  dexId = await install(pic, { name: 'sneedex', initTypes: sneedexInit({ IDL }), initArgs: [[]], cycles: 50n * T, targetSubnetId: appSubnet });
  icp = actorAs(pic, ledgerIdl, icpId, admin);
  tokenA = actorAs(pic, ledgerIdl, tokenAId, admin);
  tokenB = actorAs(pic, faultyIdl, tokenBId, admin);
  tokenP = actorAs(pic, faultyIdl, tokenPId, admin);
  gov = actorAs(pic, neuronsIdl, govId, admin); govAlice = actorAs(pic, neuronsIdl, govId, alice);
  dex = market(dexId);
  await tokenA.mint(account(alice), 1_000n * E8);
  await tokenB.mint(account(alice), 1_000n * E8);
  await icp.mint(account(bob), 1_000n * E8);
  await tokenP.mint(account(bob), 1_000n * E8);
  await pic.tick(2);
}, 180_000);
afterAll(async () => { await pic?.tearDown(); });

describe('a hand-over to the winner that fails', () => {
  it('leaves the offer Completed; the retry delivers only the missing asset, and nothing twice', async () => {
    const id = await dex.list([tokenAsset(tokenAId, 100_000n), tokenAsset(tokenBId, 200_000n)]);
    const bobA0 = await balance(tokenA, bob); const bobB0 = await balance(tokenB, bob); const aliceIcp0 = await balance(icp, alice);
    await tokenB.set_fail_to([bob]);
    const bidId = await dex.bid(id, 2n * E8);
    unwrap(await dex.alice.acceptBid(id));
    await settle(5); // the auto-delivery and auto-payment timers run
    expect(await dex.state(id)).toBe('Completed'); // not Claimed: BBB is still in escrow
    expect(await balance(tokenA, bob)).toBe(bobA0 + 100_000n - FEE_A);
    expect(await balance(tokenB, bob)).toBe(bobB0);
    expect(await balance(tokenB, dexId, await dex.escrowSub(id))).toBe(200_000n);
    expect(await dex.bidState(bidId)).toBe('ClaimedBySeller'); // the seller's payment is separate and went through
    expect(await balance(icp, alice)).toBe(aliceIcp0 + 2n * E8 - ICP_FEE);

    // the buyer retries while the ledger still refuses: an error, still Completed, AAA not sent again
    expect(errOf(await dex.bob.claimAssets(id))).toEqual({ TransferFailed: expect.stringMatching(/asset 1: .*refused/) });
    expect(errOf(await dex.carol.claimAssets(id))).toHaveProperty('NotAuthorized');
    expect(await dex.state(id)).toBe('Completed');
    expect(await balance(tokenA, bob)).toBe(bobA0 + 100_000n - FEE_A);

    await tokenB.set_fail_to([]);
    unwrap(await dex.bob.claimAssets(id));
    expect(await dex.state(id)).toBe('Claimed');
    expect(await balance(tokenB, bob)).toBe(bobB0 + 200_000n - FEE_B);
    expect(await balance(tokenB, dexId, await dex.escrowSub(id))).toBe(0n);
    expect(await balance(tokenA, bob)).toBe(bobA0 + 100_000n - FEE_A);
    expect(errOf(await dex.bob.claimAssets(id))).toEqual({ InvalidState: 'Assets already claimed' });
    await settle(3);
    expect(await balance(tokenA, bob)).toBe(bobA0 + 100_000n - FEE_A);
    expect(await balance(tokenB, bob)).toBe(bobB0 + 200_000n - FEE_B);
  });

  it('an SNS neuron whose governance refuses stays in escrow until the retry hands it over', async () => {
    await gov.create_neuron(N1, alice, FULL_OWNER, 5n * E8);
    await addPerms(govAlice, N1, dexId, FULL_OWNER);
    const id = await dex.list([neuronAsset(N1), tokenAsset(tokenAId, 50_000n)]);
    expect(await permsOf(N1)).toEqual([[dexId.toText(), FULL_OWNER]]);
    const bobA0 = await balance(tokenA, bob);
    await gov.set_fail(true);
    await dex.bid(id, E8);
    unwrap(await dex.alice.acceptBid(id));
    await settle(5);
    expect(await dex.state(id)).toBe('Completed');
    expect(await permsOf(N1)).toEqual([[dexId.toText(), FULL_OWNER]]);
    expect(await balance(tokenA, bob)).toBe(bobA0 + 50_000n - FEE_A);
    expect(errOf(await dex.bob.claimAssets(id))).toEqual({ TransferFailed: expect.stringMatching(/asset 0: .*governance refuses/) });
    expect(await dex.state(id)).toBe('Completed');
    await gov.set_fail(false);
    unwrap(await dex.bob.claimAssets(id));
    expect(await dex.state(id)).toBe('Claimed');
    expect(await permsOf(N1)).toEqual([[bob.toText(), FULL_OWNER]]);
    expect(await balance(tokenA, bob)).toBe(bobA0 + 50_000n - FEE_A);
  });

  it('two claims at once: one hands over, the other is refused while it runs', async () => {
    const id = await dex.list([tokenAsset(tokenAId, 70_000n)]);
    const bobA0 = await balance(tokenA, bob);
    await dex.bid(id, E8);
    unwrap(await dex.alice.acceptBid(id));
    const deferred = pic.createDeferredActor({ idlFactory: sneedexIdl, canisterId: dexId });
    deferred.setPrincipal(bob);
    const first = await deferred.claimAssets(id);
    const second = await deferred.claimAssets(id);
    const [r1, r2] = [await first(), await second()];
    expect([r1, r2].filter((r) => 'ok' in r).length).toBe(1);
    expect([r1, r2].find((r) => 'err' in r).err).toEqual({ InvalidState: expect.stringMatching(/already in progress/) });
    expect(await dex.state(id)).toBe('Claimed');
    await settle(4);
    expect(await balance(tokenA, bob)).toBe(bobA0 + 70_000n - FEE_A);
  });
});

describe('a hand-back to the seller that fails', () => {
  it('leaves the offer Cancelled; the retry returns only what is missing', async () => {
    const id = await dex.list([tokenAsset(tokenAId, 30_000n), tokenAsset(tokenBId, 40_000n)]);
    const aliceA0 = await balance(tokenA, alice); const aliceB0 = await balance(tokenB, alice);
    await tokenB.set_fail_to([alice]);
    unwrap(await dex.alice.cancelOffer(id));
    await settle(4); // the auto-reclaim timer runs
    expect(await dex.state(id)).toBe('Cancelled');
    expect(await balance(tokenA, alice)).toBe(aliceA0 + 30_000n - FEE_A);
    expect(await balance(tokenB, alice)).toBe(aliceB0);
    expect(errOf(await dex.alice.reclaimAssets(id))).toEqual({ TransferFailed: expect.stringMatching(/asset 1:/) });
    expect(errOf(await dex.bob.reclaimAssets(id))).toHaveProperty('NotAuthorized');
    expect(await dex.state(id)).toBe('Cancelled');
    await tokenB.set_fail_to([]);
    unwrap(await dex.alice.reclaimAssets(id));
    expect(await dex.state(id)).toBe('Reclaimed');
    expect(await balance(tokenA, alice)).toBe(aliceA0 + 30_000n - FEE_A);
    expect(await balance(tokenB, alice)).toBe(aliceB0 + 40_000n - FEE_B);
    expect(errOf(await dex.alice.reclaimAssets(id))).toEqual({ InvalidState: expect.stringMatching(/Can only reclaim/) });
  });
});

describe('a seller payout that fails after the cut was paid', () => {
  it('does not pay the cut again on retry, and the buyer can still claim meanwhile', async () => {
    unwrap(await dex.admin.setFeeRecipient(account(treasury)));
    unwrap(await dex.admin.setMarketplaceFeeRate(1000n)); // 10%, locked in at creation
    const id = await dex.list([tokenAsset(tokenAId, 60_000n)], { price_token_ledger: tokenPId });
    unwrap(await dex.admin.setMarketplaceFeeRate(0n));
    const bobA0 = await balance(tokenA, bob); const aliceP0 = await balance(tokenP, alice);
    await tokenP.set_fail_to([alice]);
    const bidId = await dex.bid(id, 10n * E8, tokenPId);
    const bidSub = await dex.bob.getBidEscrowSubaccount(bob, bidId);
    unwrap(await dex.alice.acceptBid(id));
    await settle(5);
    const cut = E8; // 10% of 10
    expect(await balance(tokenP, treasury)).toBe(cut - FEE_P);
    expect(await balance(tokenP, alice)).toBe(aliceP0);
    expect(await dex.bidState(bidId)).toBe('Won');
    expect(await balance(tokenP, dexId, bidSub)).toBe(10n * E8 - cut);
    // the assets went to the buyer: the escrow still holds what the seller is due (the bid less the paid cut)
    expect(await dex.state(id)).toBe('Claimed');
    expect(await balance(tokenA, bob)).toBe(bobA0 + 60_000n - FEE_A);
    // retries while the seller transfer keeps failing: the cut is not paid again
    expect(errOf(await dex.alice.claimWinningBid(id))).toHaveProperty('TransferFailed');
    expect(errOf(await dex.alice.claimWinningBid(id))).toHaveProperty('TransferFailed');
    expect(await balance(tokenP, treasury)).toBe(cut - FEE_P);
    expect(await balance(tokenP, dexId, bidSub)).toBe(10n * E8 - cut);
    await tokenP.set_fail_to([]);
    unwrap(await dex.alice.claimWinningBid(id));
    expect(await dex.bidState(bidId)).toBe('ClaimedBySeller');
    expect(await balance(tokenP, alice)).toBe(aliceP0 + 10n * E8 - cut - FEE_P);
    expect(await balance(tokenP, treasury)).toBe(cut - FEE_P);
    expect(await balance(tokenP, dexId, bidSub)).toBe(0n);
    const log = await dex.admin.getCutPaymentLog(0n, 100n);
    expect(log.payments.filter((e) => e.bid_id === bidId).length).toBe(1);
  });
});

describe('offers the previous version marked settled although a hand-over failed', () => {
  it('are recovered after the upgrade, by the winner and the seller, without paying anything twice', async () => {
    const oldId = await install(pic, { name: 'sneedex_prev', initTypes: sneedexInit({ IDL }), initArgs: [[]], cycles: 50n * T, targetSubnetId: appSubnet });
    const old = market(oldId);
    await gov.create_neuron(N2, alice, FULL_OWNER, E8);
    await addPerms(govAlice, N2, oldId, FULL_OWNER);
    const sold = await old.list([tokenAsset(tokenAId, 10_000n), tokenAsset(tokenBId, 20_000n), neuronAsset(N2)]);
    const cancelled = await old.list([tokenAsset(tokenBId, 30_000n)]);
    const bobA0 = await balance(tokenA, bob); const bobB0 = await balance(tokenB, bob); const aliceB0 = await balance(tokenB, alice);
    await tokenB.set_fail_to([bob, alice]);
    await gov.set_fail(true);
    await old.bid(sold, E8);
    unwrap(await old.alice.acceptBid(sold));
    unwrap(await old.alice.cancelOffer(cancelled));
    await settle(5);
    // the bug: marked settled with BBB and the neuron still held by Sneedex
    expect(await old.state(sold)).toBe('Claimed');
    expect(await old.state(cancelled)).toBe('Reclaimed');
    expect(await balance(tokenA, bob)).toBe(bobA0 + 10_000n - FEE_A);
    expect(await balance(tokenB, oldId, await old.escrowSub(sold))).toBe(20_000n);
    expect(await balance(tokenB, oldId, await old.escrowSub(cancelled))).toBe(30_000n);
    expect(await permsOf(N2)).toEqual([[oldId.toText(), FULL_OWNER]]);
    expect(errOf(await old.bob.claimAssets(sold))).toEqual({ InvalidState: 'Assets already claimed' });

    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm('sneedex'), arg: IDL.encode(sneedexInit({ IDL }), [[]]) });
    expect(await old.state(sold)).toBe('Claimed');
    expect(await old.state(cancelled)).toBe('Reclaimed');

    // only the winner recovers a Claimed offer; anyone else still hears it is claimed
    expect(errOf(await old.carol.claimAssets(sold))).toEqual({ InvalidState: 'Assets already claimed' });
    expect(errOf(await old.alice.claimAssets(sold))).toEqual({ InvalidState: 'Assets already claimed' });
    await gov.set_fail(false);
    // BBB still refused: the neuron is recovered, BBB reported, the offer stays Claimed
    expect(errOf(await old.bob.claimAssets(sold))).toEqual({ TransferFailed: expect.stringMatching(/asset 1:/) });
    expect(await permsOf(N2)).toEqual([[bob.toText(), FULL_OWNER]]);
    await tokenB.set_fail_to([]);
    unwrap(await old.bob.claimAssets(sold));
    expect(await balance(tokenB, bob)).toBe(bobB0 + 20_000n - FEE_B);
    expect(await balance(tokenA, bob)).toBe(bobA0 + 10_000n - FEE_A); // AAA was delivered before; not again
    expect(await permsOf(N2)).toEqual([[bob.toText(), FULL_OWNER]]);
    expect(errOf(await old.bob.claimAssets(sold))).toEqual({ InvalidState: 'Assets already claimed' }); // nothing left
    expect(await old.state(sold)).toBe('Claimed');

    // the seller recovers the Reclaimed offer; the buyer cannot
    expect(errOf(await old.bob.reclaimAssets(cancelled))).toHaveProperty('NotAuthorized');
    unwrap(await old.alice.reclaimAssets(cancelled));
    expect(await balance(tokenB, alice)).toBe(aliceB0 + 30_000n - FEE_B);
    expect(await balance(tokenB, oldId, await old.escrowSub(cancelled))).toBe(0n);
    expect(errOf(await old.alice.reclaimAssets(cancelled))).toEqual({ InvalidState: expect.stringMatching(/Can only reclaim/) });
    expect(await old.state(cancelled)).toBe('Reclaimed');
    await settle(3);
    expect(await balance(tokenB, bob)).toBe(bobB0 + 20_000n - FEE_B);
    expect(await balance(tokenB, alice)).toBe(aliceB0 + 30_000n - FEE_B);
  }, 180_000);
});
