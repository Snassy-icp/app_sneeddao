// Sneedex support-audit fixes (spec/support_audit.md P1-9, P1-11, P1-13 for sneedex):
//  - payment logs by principal: getCreationFeePaymentsFor(p) and getCutPaymentsFor(p), public queries
//    (the admin logs had no principal filter);
//  - every swallowed error goes to the support log: the excess-bid refund in confirmBid, wallet
//    registration, notifications, bot botkey snapshots/restores, the sweep;
//  - settleOffer(offerId) and retryRefund(bidId), callable by anyone, pay only the recipients the
//    offer and bid record (the caller gets nothing), and a repeat does nothing;
//  - the expiration worker also sweeps what settlement left undone (Completed / Expired / Cancelled
//    offers, Claimed offers with the seller unpaid, Lost bids still escrowed): the one-shot
//    settlement timers are lost on an upgrade, and nothing retried a failed hand-over;
//  - the worker no longer makes a self-call to complete an offer, catches what its steps throw and
//    clears its running flag (a run that died is restarted by the next timer tick); every sweep test
//    checks the flag is false afterwards;
//  - cancel or expiry returns ICRC-1 tokens and ICRC-7 NFTs that reached the offer's escrow but
//    were never marked escrowed (only EXT was);
//  - withdrawBidEscrow reserves nothing once a bid is Refunded or ClaimedBySeller (residue was stuck).
// SNEEDEX_WASM=sneedex_preaudit npx vitest run tests/sneedex-support-audit.test.js runs it against the
// code before these fixes (production 2cd4eb78, #449): the fail-before run.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, wasm, account, admin, alice, bob, carol, user, T, unwrap, errOf, refusedAtIngress, ICP_LEDGER_ID } from '../lib/pic.js';
import { ledgerIdl, ledgerInit, icrc7Idl, icrc7Init } from '../lib/idl.js';
import { idlFactory as sneedexIdl, init as sneedexInit } from '../build/sneedex.did.js';

const SNEEDEX_WASM = process.env.SNEEDEX_WASM || 'sneedex';
const ICP_FEE = 10_000n;
const FEE_A = 1_000n;
const FEE_B = 2_000n;
const E8 = 100_000_000n;
const DAY = 86_400;
const dave = user('audit-dave');

const faultyIdl = ({ IDL }) => {
  const base = ledgerIdl({ IDL });
  return IDL.Service({ ...Object.fromEntries(base._fields), set_fail_to: IDL.Func([IDL.Vec(IDL.Principal)], [], []) });
};

let pic, appSubnet, icpId, tokenAId, tokenBId, nftId;
let icp, tokenA, tokenB, nftAdmin, nftAny;

const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const inSeconds = async (s) => (await nowNs()) + BigInt(s) * 1_000_000_000n;
const settle = async (seconds = 5, rounds = 10) => { await pic.advanceTime(seconds * 1000); for (let i = 0; i < rounds; i++) await pic.tick(2); };
const balance = (ledger, owner, sub = null) => ledger.icrc1_balance_of(account(owner, sub));
const send = (ledgerId, from, to, amount) => actorAs(pic, ledgerIdl, ledgerId, from).icrc1_transfer({ from_subaccount: [], to, amount, fee: [], memo: [], created_at_time: [] });
const tokenAsset = (ledger, amount) => ({ ICRC1Token: { ledger_canister_id: ledger, amount } });
const nftAsset = (ids) => ({ ICRC7NFT: { collection_canister_id: nftId, token_ids: ids } });

const market = (canisterId) => {
  const as = (p) => actorAs(pic, sneedexIdl, canisterId, p);
  const m = { id: canisterId, alice: as(alice), bob: as(bob), carol: as(carol), dave: as(dave), admin: as(admin), as };
  m.offer = async (id) => (await m.bob.queryOffer(id))[0];
  m.state = async (id) => Object.keys((await m.offer(id)).state)[0];
  m.bid$ = async (id) => (await m.bob.queryBid(id))[0];
  m.bidState = async (id) => Object.keys((await m.bid$(id)).state)[0];
  m.escrowSub = (id) => m.bob.getOfferEscrowSubaccount(alice, id);
  m.bidSub = (who, bidId) => m.bob.getBidEscrowSubaccount(who, bidId);
  m.draft = async (assets, o = {}) => {
    const id = unwrap(await m.alice.createOffer({ min_bid_price: [E8], buyout_price: [], expiration: [await inSeconds(30 * DAY)], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: [], note_to_buyer: [], ...o }));
    for (const a of assets) unwrap(await m.alice.addAsset({ offer_id: id, asset: a }));
    unwrap(await m.alice.finalizeAssets(id));
    return id;
  };
  m.list = async (assets, o = {}) => {
    const id = await m.draft(assets, o);
    for (const [i, a] of assets.entries()) {
      unwrap(await send(a.ICRC1Token.ledger_canister_id, alice, account(canisterId, await m.escrowSub(id)), a.ICRC1Token.amount));
      unwrap(await m.alice.escrowICRC1Tokens(id, BigInt(i)));
    }
    unwrap(await m.alice.activateOffer(id));
    return id;
  };
  /// reserve, deposit `deposit` (default: amount) of the offer's price token, confirm `amount`
  m.bid = async (offerId, amount, who = bob, deposit = amount) => {
    const a = as(who);
    const ledger = (await m.offer(offerId)).price_token_ledger;
    const bidId = unwrap(await a.reserveBid(offerId));
    unwrap(await send(ledger, who, account(canisterId, await m.bidSub(who, bidId)), deposit));
    const r = await a.confirmBid(bidId, amount);
    return [bidId, r];
  };
  m.log = async (p) => m.carol.getSupportLogFor(p);
  return m;
};

let dex;

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  tokenBId = await install(pic, { name: 'MockLedgerFaulty', initTypes: ledgerInit, initArgs: [{ fee: FEE_B, symbol: 'BBB', decimals: 8 }], targetSubnetId: appSubnet });
  nftId = await install(pic, { name: 'Icrc7Demo', initTypes: icrc7Init, initArgs: [{ name: 'Sneed Test Cats', symbol: 'CATS', description: [], logo: [] }], targetSubnetId: appSubnet });
  const dexId = await install(pic, { name: SNEEDEX_WASM, initTypes: sneedexInit({ IDL }), initArgs: [[]], cycles: 50n * T, targetSubnetId: appSubnet });
  icp = actorAs(pic, ledgerIdl, icpId, admin);
  tokenA = actorAs(pic, ledgerIdl, tokenAId, admin);
  tokenB = actorAs(pic, faultyIdl, tokenBId, admin);
  nftAdmin = actorAs(pic, icrc7Idl, nftId, admin); nftAny = actorAs(pic, icrc7Idl, nftId, bob);
  dex = market(dexId);
  for (const p of [alice, bob, carol, dave]) {
    await icp.mint(account(p), 1_000n * E8);
    await tokenA.mint(account(p), 1_000n * E8);
    await tokenB.mint(account(p), 1_000n * E8);
  }
  for (let i = 1; i <= 3; i++) unwrap(await nftAdmin.mint(account(alice), [['name', { Text: `Cat #${i}` }]]));
  await pic.tick(2);
}, 180_000);
afterAll(async () => { await pic?.tearDown(); });

describe('payment logs by principal (P1-9)', () => {
  afterAll(async () => {
    unwrap(await dex.admin.setOfferCreationFee(0n));
    unwrap(await dex.admin.setMarketplaceFeeRate(0n));
  });
  it('getCreationFeePaymentsFor and getCutPaymentsFor answer one principal\'s payments, to anyone, as queries only', async () => {
    unwrap(await dex.admin.setOfferCreationFee(10_000_000n));
    unwrap(await dex.admin.setMarketplaceFeeRate(1000n)); // 10%
    unwrap(await send(icpId, alice, account(dex.id, await dex.bob.getOfferCreationPaymentSubaccount(alice)), 10_000_000n));
    const id = await dex.list([tokenAsset(tokenAId, 10_000n)], { buyout_price: [2n * E8] });
    unwrap(await dex.admin.setOfferCreationFee(0n));
    const [bidId] = await dex.bid(id, 2n * E8);
    await settle(5);
    expect(await dex.state(id)).toBe('Claimed');

    const fees = await dex.dave.getCreationFeePaymentsFor(alice, [], 10n); // before the fix: no such method
    expect(fees.length).toBe(1);
    expect(fees[0]).toMatchObject({ payer: alice, amount_e8s: 10_000_000n, offer_id: id });
    expect(await dex.dave.getCreationFeePaymentsFor(bob, [], 10n)).toEqual([]);
    expect(await dex.dave.getCreationFeePaymentsFor(alice, [fees[0].id], 10n)).toEqual([]); // paged back past it

    const cuts = await dex.dave.getCutPaymentsFor(bob, [], 10n);
    expect(cuts.length).toBe(1);
    expect(cuts[0]).toMatchObject({ offer_id: id, bid_id: bidId, seller: alice, buyer: bob, cut_amount: 2n * E8 / 10n });
    expect(await dex.dave.getCutPaymentsFor(alice, [], 10n)).toEqual(cuts);
    expect(await dex.dave.getCutPaymentsFor(carol, [], 10n)).toEqual([]);

    // queries: refused as update calls at the ingress guard
    const asUpdate = actorAs(pic, ({ IDL }) => {
      const svc = sneedexIdl({ IDL });
      const pick = (n) => { const f = svc._fields.find(([k]) => k === n)[1]; return IDL.Func(f.argTypes, f.retTypes, []); };
      return IDL.Service({ getCutPaymentsFor: pick('getCutPaymentsFor'), getCreationFeePaymentsFor: pick('getCreationFeePaymentsFor') });
    }, dex.id, dave);
    expect(await refusedAtIngress(asUpdate.getCutPaymentsFor(alice, [], 1n))).toBe(true);
    expect(await refusedAtIngress(asUpdate.getCreationFeePaymentsFor(alice, [], 1n))).toBe(true);
  });
});

describe('retryRefund and the refund sweep (P1-13)', () => {
  it('anyone can retry a failed refund; it pays only the bidder, once', async () => {
    const id = await dex.list([tokenAsset(tokenAId, 3_000n)], { price_token_ledger: tokenBId });
    await tokenB.set_fail_to([carol]);
    const [carolBid] = await dex.bid(id, 2n * E8, carol);
    await dex.bid(id, 3n * E8, bob); // carol is outbid; her automatic refund fails
    await settle(3);
    expect(await dex.bidState(carolBid)).toBe('Lost');
    expect((await dex.log(carol)).find((e) => e.op === 'autoRefundBid' && e.bid_id[0] === carolBid)).toBeTruthy();
    await tokenB.set_fail_to([]);

    const carol0 = await balance(tokenB, carol); const dave0 = await balance(tokenB, dave);
    const tx = unwrap(await dex.dave.retryRefund(carolBid)); // before the fix: no such method
    expect(typeof tx).toBe('bigint');
    expect(await balance(tokenB, carol)).toBe(carol0 + 2n * E8 - FEE_B);
    expect(await balance(tokenB, dave)).toBe(dave0);
    expect(await dex.bidState(carolBid)).toBe('Refunded');
    expect(errOf(await dex.dave.retryRefund(carolBid))).toHaveProperty('InvalidState'); // nothing twice
    expect(await balance(tokenB, carol)).toBe(carol0 + 2n * E8 - FEE_B);
    unwrap(await dex.alice.cancelOffer(id));
    await settle(5);
  });

  it('the expiration worker refunds a Lost bid whose refund failed', async () => {
    const id = await dex.list([tokenAsset(tokenAId, 3_100n)], { price_token_ledger: tokenBId });
    await tokenB.set_fail_to([carol]);
    const [carolBid] = await dex.bid(id, 2n * E8, carol);
    await dex.bid(id, 3n * E8, bob);
    await settle(3);
    expect(await dex.bidState(carolBid)).toBe('Lost');
    await tokenB.set_fail_to([]);
    const carol0 = await balance(tokenB, carol);
    unwrap(await dex.admin.triggerExpirationCheck());
    await settle(5, 20);
    expect(await dex.bidState(carolBid)).toBe('Refunded'); // before the fix: still Lost
    expect(await balance(tokenB, carol)).toBe(carol0 + 2n * E8 - FEE_B);
    expect(await dex.bob.isExpirationWorkerRunning()).toBe(false);
    unwrap(await dex.alice.cancelOffer(id));
    await settle(5);
  });
});

describe('settleOffer (P1-13)', () => {
  it('a buyer whose delivery failed gets the assets when anyone settles; the caller gets nothing', async () => {
    const id = await dex.list([tokenAsset(tokenBId, 40_000n)], { buyout_price: [2n * E8] });
    await tokenB.set_fail_to([bob]);
    const [bidId] = await dex.bid(id, 2n * E8);
    await settle(5); // the asset hand-over fails; the seller is paid
    expect(await dex.state(id)).toBe('Completed');
    expect(await dex.bidState(bidId)).toBe('ClaimedBySeller');
    await tokenB.set_fail_to([]);
    const bob0 = await balance(tokenB, bob); const dave0 = await balance(tokenB, dave);
    const r = unwrap(await dex.dave.settleOffer(id)); // before the fix: no such method
    expect(r).toMatch(/assets handed to the buyer/);
    expect(await dex.state(id)).toBe('Claimed');
    expect(await balance(tokenB, bob)).toBe(bob0 + 40_000n - FEE_B);
    expect(await balance(tokenB, dave)).toBe(dave0);
    expect(errOf(await dex.dave.settleOffer(id))).toHaveProperty('InvalidState'); // nothing left to do
  });

  it('a seller whose payment failed is paid when anyone settles, once', async () => {
    const id = await dex.list([tokenAsset(tokenAId, 4_000n)], { price_token_ledger: tokenBId, buyout_price: [2n * E8] });
    await tokenB.set_fail_to([alice]);
    const [bidId] = await dex.bid(id, 2n * E8);
    await settle(5);
    expect(await dex.state(id)).toBe('Claimed');
    expect(await dex.bidState(bidId)).toBe('Won'); // the payment failed
    await tokenB.set_fail_to([]);
    const alice0 = await balance(tokenB, alice); const dave0 = await balance(tokenB, dave);
    expect(unwrap(await dex.dave.settleOffer(id))).toMatch(/seller paid/);
    expect(await balance(tokenB, alice)).toBe(alice0 + 2n * E8 - FEE_B);
    expect(await balance(tokenB, dave)).toBe(dave0);
    expect(await dex.bidState(bidId)).toBe('ClaimedBySeller');
    expect('err' in (await dex.dave.settleOffer(id))).toBe(true);
    expect(await balance(tokenB, alice)).toBe(alice0 + 2n * E8 - FEE_B);
  });

  it('a cancelled offer whose hand-back failed goes back to the seller when anyone settles', async () => {
    const id = await dex.list([tokenAsset(tokenBId, 50_000n)]);
    await tokenB.set_fail_to([alice]);
    unwrap(await dex.alice.cancelOffer(id));
    await settle(5);
    expect(await dex.state(id)).toBe('Cancelled');
    await tokenB.set_fail_to([]);
    const alice0 = await balance(tokenB, alice);
    unwrap(await dex.dave.settleOffer(id));
    expect(await dex.state(id)).toBe('Reclaimed');
    expect(await balance(tokenB, alice)).toBe(alice0 + 50_000n - FEE_B);
  });

  it('an Active offer has nothing to settle', async () => {
    const id = await dex.list([tokenAsset(tokenAId, 4_100n)]);
    expect(errOf(await dex.dave.settleOffer(id))).toHaveProperty('InvalidState');
    unwrap(await dex.alice.cancelOffer(id));
    await settle(5);
  });
});

describe('the settlement sweep after an upgrade (P1-13)', () => {
  it('an offer sold just before an upgrade is delivered and paid by the next sweep (its timers were lost)', async () => {
    const id = await dex.list([tokenAsset(tokenAId, 60_000n)], { buyout_price: [2n * E8] });
    const bob0 = await balance(tokenA, bob); const alice0 = await balance(icp, alice);
    const [bidId] = await dex.bid(id, 2n * E8);
    expect(await dex.state(id)).toBe('Completed');
    await pic.upgradeCanister({ sender: admin, canisterId: dex.id, wasm: wasm(SNEEDEX_WASM), arg: IDL.encode(sneedexInit({ IDL }), [[]]) });
    await settle(10);
    expect(await dex.state(id)).toBe('Completed'); // the settlement timers did not survive
    unwrap(await dex.admin.startExpirationTimer());
    await settle(3_601, 30); // the hourly tick
    expect(await dex.state(id)).toBe('Claimed'); // before the fix: Completed until the parties claim
    expect(await dex.bidState(bidId)).toBe('ClaimedBySeller');
    expect(await balance(tokenA, bob)).toBe(bob0 + 60_000n - FEE_A);
    expect(await balance(icp, alice)).toBe(alice0 + 2n * E8 - ICP_FEE);
    expect(await dex.bob.isExpirationWorkerRunning()).toBe(false);
    unwrap(await dex.admin.stopExpirationTimer());
  });

  it('a hand-back that keeps failing is logged once, not every run, and does not stop the rest', async () => {
    const stuck = await dex.list([tokenAsset(tokenBId, 70_000n)]);
    await tokenB.set_fail_to([alice]);
    unwrap(await dex.alice.cancelOffer(stuck));
    await settle(5);
    const before = (await dex.log(alice)).filter((e) => e.offer_id[0] === stuck).length;
    for (let run = 0; run < 3; run++) { unwrap(await dex.admin.triggerExpirationCheck()); await settle(5, 20); }
    const sweepEntries = (await dex.log(alice)).filter((e) => e.offer_id[0] === stuck && e.op === 'settlementSweep');
    expect(sweepEntries.length).toBe(1); // before the fix: no sweep at all
    expect((await dex.log(alice)).filter((e) => e.offer_id[0] === stuck).length).toBe(before + 1);
    expect(await dex.bob.isExpirationWorkerRunning()).toBe(false);
    await tokenB.set_fail_to([]);
    unwrap(await dex.admin.triggerExpirationCheck());
    await settle(5, 20);
    expect(await dex.state(stuck)).toBe('Reclaimed');
  });
});

describe('unescrowed tokens and NFTs go back on cancel (P1-13)', () => {
  it('ICRC-1 tokens sent short of the amount are returned when the offer is cancelled', async () => {
    const id = await dex.draft([tokenAsset(tokenAId, 10_000n)]);
    unwrap(await send(tokenAId, alice, account(dex.id, await dex.escrowSub(id)), 5_000n)); // too little
    expect('err' in (await dex.alice.escrowICRC1Tokens(id, 0n))).toBe(true);
    const alice0 = await balance(tokenA, alice);
    unwrap(await dex.alice.cancelOffer(id));
    await settle(5);
    expect(await dex.state(id)).toBe('Reclaimed');
    expect(await balance(tokenA, dex.id, await dex.escrowSub(id))).toBe(0n); // before the fix: 5,000 stuck
    expect(await balance(tokenA, alice)).toBe(alice0 + 5_000n - FEE_A);
  });

  it('ICRC-7 NFTs sent but never escrowed are returned when the offer is cancelled', async () => {
    const id = await dex.draft([nftAsset([1n, 2n])]);
    const sub = await dex.escrowSub(id);
    const r = await actorAs(pic, icrc7Idl, nftId, alice).icrc7_transfer([1n].map((token_id) => ({ from_subaccount: [], to: { owner: dex.id, subaccount: [sub] }, token_id, memo: [], created_at_time: [] })));
    expect(r[0][0]).toHaveProperty('Ok');
    expect('err' in (await dex.alice.escrowICRC7NFTs(id, 0n))).toBe(true); // token 2 never came
    unwrap(await dex.alice.cancelOffer(id));
    await settle(5);
    expect(await dex.state(id)).toBe('Reclaimed');
    expect((await nftAny.icrc7_owner_of([1n]))[0][0].owner.toText()).toBe(alice.toText()); // before the fix: Sneedex's escrow
  });
});

describe('withdrawBidEscrow once a bid is paid out (P1-13)', () => {
  it('a Refunded bid\'s escrow can be emptied by its bidder', async () => {
    const id = await dex.list([tokenAsset(tokenAId, 6_000n)]);
    const [carolBid] = await dex.bid(id, 2n * E8, carol);
    await dex.bid(id, 3n * E8, bob);
    await settle(3);
    expect(await dex.bidState(carolBid)).toBe('Refunded');
    unwrap(await send(icpId, carol, account(dex.id, await dex.bidSub(carol, carolBid)), E8)); // arrives late
    const carol0 = await balance(icp, carol);
    unwrap(await dex.carol.withdrawBidEscrow(carolBid, E8 - ICP_FEE)); // before the fix: refused
    expect(await balance(icp, carol)).toBe(carol0 + E8 - ICP_FEE);
    expect(errOf(await dex.bob.withdrawBidEscrow(carolBid, 1n))).toHaveProperty('NotAuthorized');
    unwrap(await dex.alice.cancelOffer(id));
    await settle(5);
  });

  it('a ClaimedBySeller bid\'s residue can be withdrawn; a Won bid still cannot', async () => {
    const id = await dex.list([tokenAsset(tokenAId, 7_000n)], { buyout_price: [2n * E8] });
    const [bidId] = await dex.bid(id, 2n * E8);
    expect(errOf(await dex.bob.withdrawBidEscrow(bidId, 1n))).toHaveProperty('InvalidState'); // Won
    await settle(5);
    expect(await dex.bidState(bidId)).toBe('ClaimedBySeller');
    unwrap(await send(icpId, bob, account(dex.id, await dex.bidSub(bob, bidId)), E8));
    const bob0 = await balance(icp, bob);
    unwrap(await dex.bob.withdrawBidEscrow(bidId, E8 - ICP_FEE)); // before the fix: reserve of the bid amount, InsufficientFunds
    expect(await balance(icp, bob)).toBe(bob0 + E8 - ICP_FEE);
  });
});

describe('withdrawBidEscrow reserves exactly what the payout takes', () => {
  it('a deposit after confirmation comes back less one fee, and the bid still refunds and pays out in full', async () => {
    const id = await dex.list([tokenAsset(tokenAId, 9_000n)], { buyout_price: [5n * E8] });
    const [carolBid] = await dex.bid(id, 2n * E8, carol); // the escrow holds exactly the bid
    unwrap(await send(icpId, carol, account(dex.id, await dex.bidSub(carol, carolBid)), E8));
    const carol0 = await balance(icp, carol);
    unwrap(await dex.carol.withdrawBidEscrow(carolBid, E8 - ICP_FEE)); // before the fix: InsufficientFunds (available E8 - 2 fees)
    expect(await balance(icp, carol)).toBe(carol0 + E8 - ICP_FEE);
    expect(await balance(icp, dex.id, await dex.bidSub(carol, carolBid))).toBe(2n * E8);
    // outbid: the refund (bid - fee, plus its fee) empties the escrow exactly
    const [bobBid] = await dex.bid(id, 5n * E8, bob, 5n * E8 + E8);
    await settle(5);
    expect(await dex.bidState(carolBid)).toBe('Refunded');
    expect(await balance(icp, dex.id, await dex.bidSub(carol, carolBid))).toBe(0n);
    // the winning bid, also exactly the bid, pays the seller in full
    expect(await dex.bidState(bobBid)).toBe('ClaimedBySeller');
    expect(await balance(icp, dex.id, await dex.bidSub(bob, bobBid))).toBe(0n);
  });
});

describe('SNS neuron escrow that fails part-way', () => {
  const FULL_OWNER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const neuronsIdl = ({ IDL }) => IDL.Service({
    create_neuron: IDL.Func([IDL.Vec(IDL.Nat8), IDL.Principal, IDL.Vec(IDL.Int32), IDL.Nat64], [], []),
    set_fail_remove_of: IDL.Func([IDL.Opt(IDL.Principal)], [], []),
    permissions_of: IDL.Func([IDL.Vec(IDL.Nat8)], [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Vec(IDL.Int32)))], ['query']),
    manage_neuron: IDL.Func([IDL.Record({ subaccount: IDL.Vec(IDL.Nat8), command: IDL.Opt(IDL.Variant({
      AddNeuronPermissions: IDL.Record({ permissions_to_add: IDL.Opt(IDL.Record({ permissions: IDL.Vec(IDL.Int32) })), principal_id: IDL.Opt(IDL.Principal) }),
      RemoveNeuronPermissions: IDL.Record({ permissions_to_remove: IDL.Opt(IDL.Record({ permissions: IDL.Vec(IDL.Int32) })), principal_id: IDL.Opt(IDL.Principal) }),
    })) })], [IDL.Record({ command: IDL.Opt(IDL.Variant({ Error: IDL.Record({ error_message: IDL.Text, error_type: IDL.Int32 }), AddNeuronPermission: IDL.Record({}), RemoveNeuronPermission: IDL.Record({}) })) })], []),
  });
  it('puts back the permissions it already removed and writes the failure to the support log', async () => {
    const govId = await install(pic, { name: 'MockSnsNeurons', targetSubnetId: appSubnet });
    const gov = actorAs(pic, neuronsIdl, govId, admin);
    const govAlice = actorAs(pic, neuronsIdl, govId, alice);
    const N = new Uint8Array(32).fill(77);
    await gov.create_neuron(N, alice, FULL_OWNER, 5n * E8);
    const add = async (p, perms) => { const r = await govAlice.manage_neuron({ subaccount: N, command: [{ AddNeuronPermissions: { permissions_to_add: [{ permissions: perms }], principal_id: [p] } }] }); expect(r.command[0]).toHaveProperty('AddNeuronPermission'); };
    await add(dex.id, FULL_OWNER);
    await add(carol, [3, 4]); // a hotkey; removing it will fail
    const permsOf = async () => (await gov.permissions_of(N)).map(([p, x]) => [p.toText(), Array.from(x, Number).sort((a, b) => a - b)]).sort();
    const before = await permsOf();
    const id = await dex.draft([{ SNSNeuron: { governance_canister_id: govId, neuron_id: { id: N }, hotkeys_snapshot: [], cached_stake_e8s: [] } }]);
    await gov.set_fail_remove_of([carol]);
    const r = await dex.alice.escrowSNSNeuron(id, 0n);
    expect(errOf(r)).toHaveProperty('GovernanceError');
    expect(await permsOf()).toEqual(before); // before the fix: alice's permissions were gone for good
    const entry = (await dex.log(alice)).find((e) => e.op === 'snsNeuron' && e.offer_id[0] === id);
    expect(entry).toBeTruthy(); // before the fix: nothing logged
    expect(entry.text).toMatch(/removing .* failed/);
    expect(entry.text).toMatch(/all put back/);
    await gov.set_fail_remove_of([]);
    unwrap(await dex.alice.escrowSNSNeuron(id, 0n)); // and it can be escrowed once governance works
    expect(await permsOf()).toEqual([[dex.id.toText(), FULL_OWNER]]);
    unwrap(await dex.alice.cancelOffer(id));
    await settle(5);
    expect(await permsOf()).toEqual(before.filter(([p]) => p !== dex.id.toText())); // back to the owners; Sneedex leaves
  });
});

describe('swallowed errors reach the support log (P1-11)', () => {
  it('a failed excess-bid refund, a failed notification and a failed wallet registration are logged', async () => {
    unwrap(await dex.admin.setSneedSmsCanisterId([tokenAId])); // not an SMS canister: the call fails
    unwrap(await dex.admin.setBackendCanisterId([tokenAId])); // not the backend either
    const id = await dex.list([tokenAsset(tokenAId, 8_000n)], { price_token_ledger: tokenBId, buyout_price: [2n * E8] });
    await tokenB.set_fail_to([bob]);
    const [bidId] = await dex.bid(id, 2n * E8, bob, 3n * E8); // 1 too many: its refund fails
    await tokenB.set_fail_to([]);
    await settle(5);
    expect(await dex.state(id)).toBe('Claimed');
    const bobLog = await dex.log(bob);
    expect(bobLog.find((e) => e.op === 'confirmBidExcessRefund' && e.bid_id[0] === bidId)).toBeTruthy(); // before the fix: nothing
    expect(bobLog.find((e) => e.op === 'registerTokenToWallet')).toBeTruthy();
    expect((await dex.log(alice)).find((e) => e.op === 'sendNotification')).toBeTruthy();
    // the excess is the bidder's: withdrawable once the seller is paid
    const bob0 = await balance(tokenB, bob);
    unwrap(await dex.bob.withdrawBidEscrow(bidId, E8 - FEE_B));
    expect(await balance(tokenB, bob)).toBe(bob0 + E8 - FEE_B);
    unwrap(await dex.admin.setSneedSmsCanisterId([]));
    unwrap(await dex.admin.setBackendCanisterId([]));
  });
});

describe('upgrade from production (2cd4eb78, #449)', () => {
  it('keeps every offer and bid, and the sweep then settles what production left undone', async () => {
    const oldId = await install(pic, { name: 'sneedex_preaudit', initTypes: sneedexInit({ IDL }), initArgs: [[]], cycles: 50n * T, targetSubnetId: appSubnet });
    const old = market(oldId);
    const active = await old.list([tokenAsset(tokenAId, 5_000n)]);
    const lostOn = await old.list([tokenAsset(tokenAId, 5_100n)], { price_token_ledger: tokenBId });
    await tokenB.set_fail_to([carol]);
    const [lost] = await old.bid(lostOn, 2n * E8, carol);
    await old.bid(lostOn, 3n * E8, bob);
    await settle(3);
    await tokenB.set_fail_to([]);
    const sold = await old.list([tokenAsset(tokenAId, 6_000n)], { buyout_price: [2n * E8] });
    const [soldBid] = await old.bid(sold, 2n * E8); // completed; the upgrade comes before its timers
    const offersBefore = await old.bob.debugGetAllOffers();
    const bidsBefore = await Promise.all([lost, soldBid].map((b) => old.bob.queryBid(b)));
    const logBefore = await old.bob.getSupportLog([], 100n);

    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(SNEEDEX_WASM), arg: IDL.encode(sneedexInit({ IDL }), [[]]) });
    expect(await old.bob.debugGetAllOffers()).toEqual(offersBefore);
    expect(await Promise.all([lost, soldBid].map((b) => old.bob.queryBid(b)))).toEqual(bidsBefore);
    expect(await old.bob.getSupportLog([], 100n)).toEqual(logBefore);
    expect(await old.state(sold)).toBe('Completed');
    expect(await old.bidState(lost)).toBe('Lost');

    const carol0 = await balance(tokenB, carol);
    unwrap(await old.admin.triggerExpirationCheck());
    await settle(5, 30);
    expect(await old.state(sold)).toBe('Claimed');
    expect(await old.bidState(soldBid)).toBe('ClaimedBySeller');
    expect(await old.bidState(lost)).toBe('Refunded');
    expect(await balance(tokenB, carol)).toBe(carol0 + 2n * E8 - FEE_B);
    expect(await old.state(active)).toBe('Active');
    // the market still works
    unwrap(await old.alice.cancelOffer(active));
    await settle(5);
    expect(await old.state(active)).toBe('Reclaimed');
  });
});

describe('reservation spam cannot block completion', () => {
  // SNEEDEX_SPAM=30000 is the run that shows the old code's completion trapping (about 11 minutes);
  // by default fewer, which still shows the block per reservation the old code wrote.
  const SPAM = Number(process.env.SNEEDEX_SPAM ?? 3000);
  const SPAM_SMALL = Number(process.env.SNEEDEX_SPAM_SMALL ?? 2000);
  /// `count` reservations on `offerId`, each from its own principal (one principal is capped at 10)
  const spam = async (m, offerId, tag, SPAM) => {
    const arg = IDL.encode([IDL.Nat], [offerId]);
    let last = [];
    for (let i = 0; i < SPAM; i++) {
      const sender = Principal.selfAuthenticating(new TextEncoder().encode(`spam-${tag}-${i}`));
      last.push(await pic.submitCall({ canisterId: m.id, method: 'reserveBid', arg, sender }));
      if (last.length === 500 || i === SPAM - 1) { for (const c of last) await pic.awaitCall(c); last = []; }
    }
  };
  it('a buyout, an accepted bid and an expiry each complete an offer with thousands of reservations', async () => {
    const id = await install(pic, { name: SNEEDEX_WASM, initTypes: sneedexInit({ IDL }), initArgs: [[]], cycles: 200n * T, targetSubnetId: appSubnet });
    const m = market(id);
    unwrap(await m.admin.updateConfig({ ...(await m.bob.getConfig()), min_offer_duration_ns: 0n }));
    const bought = await m.list([tokenAsset(tokenAId, 1_000n)], { buyout_price: [2n * E8] });
    const accepted = await m.list([tokenAsset(tokenAId, 1_100n)]);
    const expiring = await m.list([tokenAsset(tokenAId, 1_200n)], { expiration: [await inSeconds(600)] });
    await spam(m, bought, 0, SPAM);
    await spam(m, accepted, 1, SPAM_SMALL);
    await spam(m, expiring, 2, SPAM_SMALL);
    const t0 = Date.now();
    const [acceptedBid] = await m.bid(accepted, 2n * E8, carol);
    const [expiringBid] = await m.bid(expiring, 2n * E8, dave);
    const len0 = (await m.bob.icrc3_log_status()).log_length;
    let buyout;
    try { buyout = await m.bid(bought, 2n * E8); } catch (e) { buyout = [null, { thrown: String(e).slice(0, 200) }]; }
    if ('thrown' in (buyout[1] ?? {})) console.log('buyout rejected:', buyout[1].thrown);
    expect(await m.state(bought)).toBe('Completed'); // before the fix: the completion trapped (out of instructions or heap), the offer stays Active
    // the buyout's own blocks only, not one per voided reservation (before the fix: SPAM more)
    expect((await m.bob.icrc3_log_status()).log_length - len0).toBeLessThan(20n);
    let accept;
    try { accept = await m.alice.acceptBid(accepted); } catch (e) { accept = { thrown: String(e).slice(0, 200) }; }
    expect(accept).toEqual({ ok: null });
    await pic.advanceTime(700_000);
    unwrap(await m.admin.triggerExpirationCheck());
    await settle(1, 10);
    expect(await m.state(expiring)).not.toBe('Active');
    await settle(5, 20);
    for (const o of [bought, accepted, expiring]) expect(await m.state(o)).toBe('Claimed');
    expect(await m.bidState(acceptedBid)).toBe('ClaimedBySeller');
    expect(await m.bidState(expiringBid)).toBe('ClaimedBySeller');
    expect(await m.bob.isExpirationWorkerRunning()).toBe(false);
    // the reservations of the closed offers are Lost, with no block each
    const spammer = Principal.selfAuthenticating(new TextEncoder().encode('spam-0-0'));
    expect(Object.keys((await m.bob.getBidsByBidderAll(spammer))[0].state)[0]).toBe('Lost');
    console.log(`spam ${SPAM} x3: completion took ${Date.now() - t0} ms`);
  }, 1_800_000);

  it('one principal may hold at most 10 unconfirmed reservations per offer', async () => {
    const id = await dex.list([tokenAsset(tokenAId, 1_300n)]);
    for (let i = 0; i < 10; i++) unwrap(await dex.dave.reserveBid(id));
    expect(errOf(await dex.dave.reserveBid(id))).toHaveProperty('InvalidState'); // before the fix: unlimited
    await dex.bid(id, 2n * E8, carol); // others are unaffected
    unwrap(await dex.alice.cancelOffer(id));
    await settle(5);
  });
});
