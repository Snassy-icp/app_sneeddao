// Sneedex support fixes (spec/support_audit.md, P0 1-3 and P1 9/11 for sneedex):
//  - stake caching after activation looks the stakes up across awaits; a buyout that lands meanwhile
//    used to be reverted to Active when the stale offer was written back. Now only the cached stake
//    fields are merged into the offer as it is after the awaits, and only while it is still Active.
//  - escrowCanister / escrowSNSNeuron / escrowICRC1Tokens wrote back the offer read before their
//    awaits: a concurrent escrow of another asset lost its `escrowed` flag, and a cancel during the
//    escrow was undone. Now they write onto the current offer; an asset escrowed into an offer
//    cancelled meanwhile is recorded as escrowed and handed back.
//  - adminReclaimStuckTokens had no state guard: on an Active or sold offer it returned the escrow
//    to the seller while the buyer's bid paid the seller too. Now only Cancelled / Expired /
//    Reclaimed offers without a winning bid; every call goes to the support log, and
//    adminReclaimStuckTokensWithReason records why.
//  - support lookups: getSupportLog / getSupportLogFor (errors of background work, admin actions),
//    getBidsByBidderAll (reservations included), getSettlement.
//  - upgrades from production (#442-era, build/sneedex_prod442.wasm) and from the code before these
//    fixes (build/sneedex_prefix.wasm) keep every offer and bid.
// SNEEDEX_WASM=sneedex_prefix npx vitest run tests/sneedex-support.test.js runs it against the code
// before the fixes (the fail-before run).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, wasm, account, admin, alice, bob, carol, T, unwrap, errOf, refusedAtIngress, ICP_LEDGER_ID } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { idlFactory as sneedexIdl, init as sneedexInit } from '../build/sneedex.did.js';

const SNEEDEX_WASM = process.env.SNEEDEX_WASM || 'sneedex';
const ICP_FEE = 10_000n;
const FEE_A = 1_000n;
const FEE_B = 2_000n;
const E8 = 100_000_000n;
const DAY = 86_400;
const FULL_OWNER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const neuronIdOf = (n) => new Uint8Array(32).fill(n);

const faultyIdl = ({ IDL }) => {
  const base = ledgerIdl({ IDL });
  return IDL.Service({ ...Object.fromEntries(base._fields), set_fail_to: IDL.Func([IDL.Vec(IDL.Principal)], [], []) });
};
const neuronsIdl = ({ IDL }) => IDL.Service({
  create_neuron: IDL.Func([IDL.Vec(IDL.Nat8), IDL.Principal, IDL.Vec(IDL.Int32), IDL.Nat64], [], []),
  set_hold: IDL.Func([IDL.Bool, IDL.Bool], [], []),
  waiting_calls: IDL.Func([], [IDL.Nat], ['query']),
  permissions_of: IDL.Func([IDL.Vec(IDL.Nat8)], [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Vec(IDL.Int32)))], ['query']),
  manage_neuron: IDL.Func([IDL.Record({ subaccount: IDL.Vec(IDL.Nat8), command: IDL.Opt(IDL.Variant({
    AddNeuronPermissions: IDL.Record({ permissions_to_add: IDL.Opt(IDL.Record({ permissions: IDL.Vec(IDL.Int32) })), principal_id: IDL.Opt(IDL.Principal) }),
    RemoveNeuronPermissions: IDL.Record({ permissions_to_remove: IDL.Opt(IDL.Record({ permissions: IDL.Vec(IDL.Int32) })), principal_id: IDL.Opt(IDL.Principal) }),
  })) })], [IDL.Record({ command: IDL.Opt(IDL.Variant({ Error: IDL.Record({ error_message: IDL.Text, error_type: IDL.Int32 }), AddNeuronPermission: IDL.Record({}), RemoveNeuronPermission: IDL.Record({}) })) })], []),
});

let pic, appSubnet, icpId, tokenAId, tokenBId, govId, dexId;
let icp, tokenA, tokenB, gov, govAlice, dex;

const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const inSeconds = async (s) => (await nowNs()) + BigInt(s) * 1_000_000_000n;
const settle = async (seconds = 5, rounds = 10) => { await pic.advanceTime(seconds * 1000); for (let i = 0; i < rounds; i++) await pic.tick(2); };
const ticks = async (n) => { for (let i = 0; i < n; i++) await pic.tick(); };
const balance = (ledger, owner, sub = null) => ledger.icrc1_balance_of(account(owner, sub));
const transfer = (ledger, to, amount) => ledger.icrc1_transfer({ from_subaccount: [], to, amount, fee: [], memo: [], created_at_time: [] });
const tokenAsset = (ledger, amount) => ({ ICRC1Token: { ledger_canister_id: ledger, amount } });
const neuronAsset = (id) => ({ SNSNeuron: { governance_canister_id: govId, neuron_id: { id }, hotkeys_snapshot: [], cached_stake_e8s: [] } });
const permsOf = async (id) => (await gov.permissions_of(id)).map(([p, perms]) => [p.toText(), Array.from(perms, Number).sort((a, b) => a - b)]).sort();
const addPerms = async (actor, id, p, perms) => { const r = await actor.manage_neuron({ subaccount: id, command: [{ AddNeuronPermissions: { permissions_to_add: [{ permissions: perms }], principal_id: [p] } }] }); expect(r.command[0]).toHaveProperty('AddNeuronPermission'); };
const waitUntilHeld = async (n = 1n) => { for (let i = 0; i < 100 && (await gov.waiting_calls()) < n; i++) await pic.tick(); expect(await gov.waiting_calls()).toBe(n); };

const market = (canisterId) => {
  const as = (p) => actorAs(pic, sneedexIdl, canisterId, p);
  const m = { id: canisterId, alice: as(alice), bob: as(bob), carol: as(carol), admin: as(admin) };
  m.deferred = (p) => { const d = pic.createDeferredActor({ idlFactory: sneedexIdl, canisterId }); d.setPrincipal(p); return d; };
  m.offer = async (id) => (await m.bob.queryOffer(id))[0];
  m.state = async (id) => Object.keys((await m.offer(id)).state)[0];
  m.bidState = async (id) => Object.keys((await m.bob.queryBid(id))[0].state)[0];
  m.escrowSub = (id) => m.bob.getOfferEscrowSubaccount(alice, id);
  /// a PendingEscrow offer by alice of the given assets
  m.draft = async (assets, o = {}) => {
    const id = unwrap(await m.alice.createOffer({ min_bid_price: [E8], buyout_price: [], expiration: [await inSeconds(30 * DAY)], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: [], note_to_buyer: [], ...o }));
    for (const a of assets) unwrap(await m.alice.addAsset({ offer_id: id, asset: a }));
    unwrap(await m.alice.finalizeAssets(id));
    return id;
  };
  m.sendTokens = async (id, a) => unwrap(await transfer(actorAs(pic, ledgerIdl, a.ICRC1Token.ledger_canister_id, alice), account(canisterId, await m.escrowSub(id)), a.ICRC1Token.amount));
  m.escrowAll = async (id, assets) => {
    for (const [i, a] of assets.entries()) {
      if (a.ICRC1Token) { await m.sendTokens(id, a); unwrap(await m.alice.escrowICRC1Tokens(id, BigInt(i))); } else unwrap(await m.alice.escrowSNSNeuron(id, BigInt(i)));
    }
  };
  m.list = async (assets, o = {}) => { const id = await m.draft(assets, o); await m.escrowAll(id, assets); unwrap(await m.alice.activateOffer(id)); return id; };
  m.bid = async (offerId, amount, who = bob) => {
    const a = as(who);
    const bidId = unwrap(await a.reserveBid(offerId));
    unwrap(await transfer(actorAs(pic, ledgerIdl, icpId, who), account(canisterId, await a.getBidEscrowSubaccount(who, bidId)), amount));
    unwrap(await a.confirmBid(bidId, amount));
    return bidId;
  };
  return m;
};

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  tokenBId = await install(pic, { name: 'MockLedgerFaulty', initTypes: ledgerInit, initArgs: [{ fee: FEE_B, symbol: 'BBB', decimals: 8 }], targetSubnetId: appSubnet });
  govId = await install(pic, { name: 'MockSnsNeurons', targetSubnetId: appSubnet });
  dexId = await install(pic, { name: SNEEDEX_WASM, initTypes: sneedexInit({ IDL }), initArgs: [[]], cycles: 50n * T, targetSubnetId: appSubnet });
  icp = actorAs(pic, ledgerIdl, icpId, admin);
  tokenA = actorAs(pic, ledgerIdl, tokenAId, admin);
  tokenB = actorAs(pic, faultyIdl, tokenBId, admin);
  gov = actorAs(pic, neuronsIdl, govId, admin); govAlice = actorAs(pic, neuronsIdl, govId, alice);
  dex = market(dexId);
  await tokenA.mint(account(alice), 1_000n * E8);
  await tokenB.mint(account(alice), 1_000n * E8);
  await icp.mint(account(bob), 1_000n * E8);
  await icp.mint(account(carol), 1_000n * E8);
  await pic.tick(2);
}, 180_000);
afterAll(async () => { await pic?.tearDown(); });

describe('stake caching after activation', () => {
  it('a buyout that lands while the stakes are looked up stays sold (was reverted to Active)', async () => {
    const N = neuronIdOf(31);
    await gov.create_neuron(N, alice, FULL_OWNER, 7n * E8);
    await addPerms(govAlice, N, dexId, FULL_OWNER);
    const assets = [neuronAsset(N)];
    const id = await dex.draft(assets, { buyout_price: [2n * E8] });
    await dex.escrowAll(id, assets);
    await gov.set_hold(true, false); // get_neuron now waits until released
    unwrap(await dex.alice.activateOffer(id));
    await pic.advanceTime(1_500); // the caching timer (1 s) fires and sits in get_neuron
    await waitUntilHeld(1n);

    const bidId = await dex.bid(id, 2n * E8); // the buyout completes the offer meanwhile
    expect(await dex.state(id)).toBe('Completed');
    expect(await dex.bidState(bidId)).toBe('Won');

    await gov.set_hold(false, false);
    await ticks(20); // the caching finishes (no time passes, so no settlement timer runs yet)
    expect(await gov.waiting_calls()).toBe(0n);
    expect(await dex.state(id)).toBe('Completed'); // before the fix: 'Active'
    expect((await dex.offer(id)).assets[0].escrowed).toBe(true);

    await settle(5); // auto delivery and payment
    expect(await dex.state(id)).toBe('Claimed');
    expect(await dex.bidState(bidId)).toBe('ClaimedBySeller');
    expect(await permsOf(N)).toEqual([[bob.toText(), FULL_OWNER]]);
  });

  it('on an offer still Active, the cached stake is filled in and nothing else changes', async () => {
    const N = neuronIdOf(32);
    await gov.create_neuron(N, alice, FULL_OWNER, 9n * E8);
    await addPerms(govAlice, N, dexId, FULL_OWNER);
    const id = await dex.list([neuronAsset(N), tokenAsset(tokenAId, 10_000n)]);
    await settle(2);
    const offer = await dex.offer(id);
    expect(Object.keys(offer.state)[0]).toBe('Active');
    expect(offer.assets[0].asset.SNSNeuron.cached_stake_e8s).toEqual([9n * E8]);
    expect(offer.assets[0].escrowed).toBe(true);
    expect(offer.assets[1]).toEqual({ asset: tokenAsset(tokenAId, 10_000n), escrowed: true });
    unwrap(await dex.alice.cancelOffer(id));
    await settle(3);
    expect(await dex.state(id)).toBe('Reclaimed');
  });
});

describe('escrow across awaits', () => {
  it('two ICRC-1 assets escrowed at once both stay escrowed (one flag was lost)', async () => {
    const assets = [tokenAsset(tokenAId, 11_000n), tokenAsset(tokenBId, 12_000n)];
    const id = await dex.draft(assets);
    for (const a of assets) await dex.sendTokens(id, a);
    const d = dex.deferred(alice);
    const first = await d.escrowICRC1Tokens(id, 0n);
    const second = await d.escrowICRC1Tokens(id, 1n);
    const [r0, r1] = [await first(), await second()];
    unwrap(r0); unwrap(r1);
    const offer = await dex.offer(id);
    expect(offer.assets.map((e) => e.escrowed)).toEqual([true, true]); // before the fix: one false
    unwrap(await dex.alice.activateOffer(id));
    expect(await dex.state(id)).toBe('Active');
    unwrap(await dex.alice.cancelOffer(id));
    await settle(3);
    expect(await dex.state(id)).toBe('Reclaimed');
  });

  it('a cancel during a neuron escrow stays cancelled and the neuron goes back (the cancel was undone)', async () => {
    const N = neuronIdOf(33);
    await gov.create_neuron(N, alice, FULL_OWNER, 3n * E8);
    await addPerms(govAlice, N, dexId, FULL_OWNER);
    const id = await dex.draft([neuronAsset(N)]);
    await gov.set_hold(false, true); // manage_neuron waits: the escrow sits between its awaits
    const pending = await dex.deferred(alice).escrowSNSNeuron(id, 0n);
    await waitUntilHeld(1n);
    unwrap(await dex.alice.cancelOffer(id));
    expect(await dex.state(id)).toBe('Cancelled');
    await gov.set_hold(false, false);
    const r = await pending();
    expect(await dex.state(id)).not.toBe('PendingEscrow'); // before the fix: back to PendingEscrow
    expect('err' in r).toBe(true);
    expect((await dex.offer(id)).assets[0].escrowed).toBe(true); // recorded, so it can be handed back
    await settle(5);
    expect(await dex.state(id)).toBe('Reclaimed');
    expect(await permsOf(N)).toEqual([[alice.toText(), FULL_OWNER]]);
  });
});

describe('adminReclaimStuckTokens', () => {
  it('is refused on an Active offer: the escrow stays for the buyer', async () => {
    const id = await dex.list([tokenAsset(tokenAId, 40_000n)], { buyout_price: [3n * E8] });
    const alice0 = await balance(tokenA, alice);
    const r = await dex.admin.adminReclaimStuckTokens(id);
    expect('err' in r).toBe(true); // before the fix: ok, and the tokens went back to the seller
    expect(errOf(r)).toHaveProperty('InvalidState');
    expect(await balance(tokenA, dexId, await dex.escrowSub(id))).toBe(40_000n);
    expect(await balance(tokenA, alice)).toBe(alice0);
    const bob0 = await balance(tokenA, bob);
    await dex.bid(id, 3n * E8);
    await settle(5);
    expect(await dex.state(id)).toBe('Claimed');
    expect(await balance(tokenA, bob)).toBe(bob0 + 40_000n - FEE_A);
  });

  it('is refused on a sold offer: the buyer gets the assets and the seller only the payment', async () => {
    const id = await dex.list([tokenAsset(tokenAId, 50_000n)], { buyout_price: [2n * E8] });
    const aliceA0 = await balance(tokenA, alice); const bobA0 = await balance(tokenA, bob); const aliceIcp0 = await balance(icp, alice);
    await dex.bid(id, 2n * E8);
    expect(await dex.state(id)).toBe('Completed');
    const r = await dex.admin.adminReclaimStuckTokens(id); // before the settlement timers run
    expect('err' in r).toBe(true); // before the fix: ok, the seller got the tokens back and was paid too
    await settle(5);
    expect(await dex.state(id)).toBe('Claimed');
    expect(await balance(tokenA, alice)).toBe(aliceA0);
    expect(await balance(tokenA, bob)).toBe(bobA0 + 50_000n - FEE_A);
    expect(await balance(icp, alice)).toBe(aliceIcp0 + 2n * E8 - ICP_FEE);
    expect('err' in (await dex.admin.adminReclaimStuckTokens(id))).toBe(true); // Claimed: refused too
  });

  it('on an offer still in PendingEscrow returns the tokens and the offer cannot then be activated over an empty escrow', async () => {
    const assets = [tokenAsset(tokenAId, 30_000n)];
    const id = await dex.draft(assets);
    await dex.escrowAll(id, assets);
    const alice0 = await balance(tokenA, alice);
    expect(unwrap(await dex.admin.adminReclaimStuckTokens(id))).toMatch(/Token transfer succeeded/);
    expect(await balance(tokenA, alice)).toBe(alice0 + 30_000n - FEE_A);
    expect((await dex.offer(id)).assets[0].escrowed).toBe(false); // before the fix: still true
    expect('err' in (await dex.alice.activateOffer(id))).toBe(true); // before the fix: Active, nothing in escrow
    expect(await dex.state(id)).toBe('PendingEscrow');
    unwrap(await dex.alice.cancelOffer(id));
    await settle(3);
  });

  it('returns a cancelled offer\'s stuck tokens, once, and only for admins', async () => {
    const id = await dex.list([tokenAsset(tokenBId, 60_000n)]);
    const alice0 = await balance(tokenB, alice);
    await tokenB.set_fail_to([alice]);
    unwrap(await dex.alice.cancelOffer(id));
    await settle(5); // the auto reclaim fails: the ledger refuses
    await tokenB.set_fail_to([]);
    expect(await dex.state(id)).toBe('Cancelled');
    expect(await balance(tokenB, dexId, await dex.escrowSub(id))).toBe(60_000n);
    expect(errOf(await dex.carol.adminReclaimStuckTokens(id))).toHaveProperty('NotAuthorized');
    expect(unwrap(await dex.admin.adminReclaimStuckTokens(id))).toMatch(/Token transfer succeeded/);
    expect(await balance(tokenB, alice)).toBe(alice0 + 60_000n - FEE_B);
    expect(await balance(tokenB, dexId, await dex.escrowSub(id))).toBe(0n);
    unwrap(await dex.admin.adminReclaimStuckTokens(id)); // again: nothing left, nothing moves
    expect(await balance(tokenB, alice)).toBe(alice0 + 60_000n - FEE_B);
  });
});

describe('support lookups', () => {
  it('the support log records swallowed errors and every admin reclaim, with its reason', async () => {
    const id = await dex.list([tokenAsset(tokenBId, 70_000n)]);
    await tokenB.set_fail_to([alice]);
    unwrap(await dex.alice.cancelOffer(id));
    await settle(5);
    await tokenB.set_fail_to([]);
    const forAlice = await dex.carol.getSupportLogFor(alice);
    expect(forAlice.find((e) => e.op === 'autoReclaimAssets' && e.offer_id[0] === id && e.kind === 'error')).toBeTruthy();

    const active = await dex.list([tokenAsset(tokenAId, 1_000n)]);
    expect('err' in (await dex.admin.adminReclaimStuckTokensWithReason(active, 'user asked'))).toBe(true);
    expect(await refusedAtIngress(dex.carol.adminReclaimStuckTokensWithReason(id, 'x'))).toBe(true); // admins only, at the ingress guard
    expect(errOf(await dex.admin.adminReclaimStuckTokensWithReason(id, 'x'.repeat(501)))).toHaveProperty('InvalidState');
    unwrap(await dex.admin.adminReclaimStuckTokensWithReason(id, 'ticket 7: ledger refused the auto reclaim'));
    const log = await dex.carol.getSupportLog([], 10n);
    expect(log[0]).toMatchObject({ kind: 'admin', op: 'adminReclaimStuckTokens', offer_id: [id], principal: [admin] });
    expect(log[0].text).toMatch(/^reason: ticket 7/);
    expect(log[1]).toMatchObject({ kind: 'admin', offer_id: [active] });
    expect(log[1].text).toMatch(/^refused: .*Active.*reason: user asked/);
    expect(log[0].id).toBeGreaterThan(log[1].id);
    expect((await dex.carol.getSupportLog([log[0].id], 1n))[0].id).toBe(log[1].id);
    unwrap(await dex.alice.cancelOffer(active));
    await settle(3);
  });

  it('getBidsByBidderAll includes unconfirmed reservations; getSettlement tells where an offer stands', async () => {
    const id = await dex.list([tokenAsset(tokenAId, 2_000n)], { buyout_price: [2n * E8] });
    const reserved = unwrap(await dex.carol.reserveBid(id));
    expect((await dex.bob.getBidsByBidder(carol)).find((b) => b.id === reserved)).toBeUndefined();
    expect((await dex.bob.getBidsByBidderAll(carol)).find((b) => b.id === reserved)).toMatchObject({ offer_id: id, amount: 0n });
    expect((await dex.bob.getSettlement(id))[0]).toMatchObject({ state: { Active: null }, winning_bid: [], delivered_asset_indices: [], settlement_in_progress: false });
    const bidId = await dex.bid(id, 2n * E8);
    const s = (await dex.bob.getSettlement(id))[0];
    expect(Object.keys(s.state)[0]).toBe('Completed');
    expect(s.winning_bid[0].id).toBe(bidId);
    await settle(5);
    expect(Object.keys((await dex.bob.getSettlement(id))[0].state)[0]).toBe('Claimed');
    expect(await dex.bob.getSettlement(999_999n)).toEqual([]);
  });
});

describe('upgrades keep every offer and bid', () => {
  for (const from of ['sneedex_prod442', 'sneedex_prefix']) {
    it(`from ${from}`, async () => {
      const oldId = await install(pic, { name: from, initTypes: sneedexInit({ IDL }), initArgs: [[]], cycles: 50n * T, targetSubnetId: appSubnet });
      const old = market(oldId);
      const active = await old.list([tokenAsset(tokenAId, 5_000n)]);
      const sold = await old.list([tokenAsset(tokenAId, 6_000n)], { buyout_price: [2n * E8] });
      const bid = await old.bid(active, 2n * E8, carol);
      const soldBid = await old.bid(sold, 2n * E8);
      await settle(5);
      const offersBefore = await old.bob.debugGetAllOffers();
      const bidsBefore = [await old.bob.queryBid(bid), await old.bob.queryBid(soldBid)];
      const activeBefore = await old.offer(active);

      await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(SNEEDEX_WASM), arg: IDL.encode(sneedexInit({ IDL }), [[]]) });
      expect(await old.bob.debugGetAllOffers()).toEqual(offersBefore);
      expect([await old.bob.queryBid(bid), await old.bob.queryBid(soldBid)]).toEqual(bidsBefore);
      expect(await old.offer(active)).toEqual(activeBefore);
      expect(await old.state(sold)).toBe('Claimed');
      expect(await old.bidState(soldBid)).toBe('ClaimedBySeller');
      if (SNEEDEX_WASM === 'sneedex') expect(await old.bob.getSupportLog([], 10n)).toEqual([]);
      // the market still works after the upgrade
      unwrap(await old.alice.acceptBid(active));
      await settle(5);
      expect(await old.state(active)).toBe('Claimed');
      expect(await old.bidState(bid)).toBe('ClaimedBySeller');
    });
  }
});
