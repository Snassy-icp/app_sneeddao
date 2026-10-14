// Sneedex with Sneed Lock assets: a token lock sold and delivered to the
// winner (ownership moved inside Sneed Lock), and a locked LP position whose
// cancelled offer hands it back to the seller.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, account, principalToSubaccount, admin, alice, bob, ICP_LEDGER_ID, T, unwrap, errOf } from '../lib/pic.js';
import { ledgerIdl, ledgerInit, poolIdl, poolInit } from '../lib/idl.js';
import { idlFactory as sneedLockIdl } from '../build/sneed_lock.did.js';
import { idlFactory as sneedexIdl, init as sneedexInit } from '../build/sneedex.did.js';

const ICP_FEE = 10_000n;
const FEE_A = 1_000n;
const POS = 7n;
let pic, appSubnet, icpId, tokenAId, tokenBId, poolId, lockId, dexId;
let icp, tokenA, tokenB, pool, poolAlice, lock, lockAlice, dexAdmin, dexAlice, dexBob;

const sneedWallet = (p) => account(lockId, principalToSubaccount(p));
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const expiryIn = async (seconds) => (await nowNs()) + BigInt(seconds) * 1_000_000_000n;

describe('sneedex: Sneed Lock assets', () => {
  beforeAll(async () => {
    ({ pic, appSubnet } = await createPic());
    icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
    tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
    tokenBId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 500n, symbol: 'BBB', decimals: 8 }], targetSubnetId: appSubnet });
    poolId = await install(pic, { name: 'MockSwapPool', initTypes: poolInit, initArgs: [{ token0: tokenAId, token1: tokenBId, fee: 3000n }], targetSubnetId: appSubnet });
    lockId = await install(pic, { name: 'sneed_lock', cycles: 20n * T, targetSubnetId: appSubnet });
    dexId = await install(pic, { name: 'sneedex', initTypes: sneedexInit({ IDL }), initArgs: [[]], targetSubnetId: appSubnet });
    icp = actorAs(pic, ledgerIdl, icpId, admin);
    tokenA = actorAs(pic, ledgerIdl, tokenAId, admin);
    tokenB = actorAs(pic, ledgerIdl, tokenBId, admin);
    pool = actorAs(pic, poolIdl, poolId, admin); poolAlice = actorAs(pic, poolIdl, poolId, alice);
    lock = actorAs(pic, sneedLockIdl, lockId, admin); lockAlice = actorAs(pic, sneedLockIdl, lockId, alice);
    dexAdmin = actorAs(pic, sneedexIdl, dexId, admin); dexAlice = actorAs(pic, sneedexIdl, dexId, alice); dexBob = actorAs(pic, sneedexIdl, dexId, bob);
    unwrap(await dexAdmin.setSneedLockCanisterId(lockId));
    await tokenA.mint(account(poolId), 10_000_000n);
    await tokenB.mint(account(poolId), 10_000_000n);
    await icp.mint(account(bob), 50n * 100_000_000n);
    await pic.tick(2);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  const offerOf = async (id) => (await dexAlice.getOffersByCreator(alice)).find((o) => o.id === id);
  const newOffer = async (offerSeconds = 86_400) => {
    const now = await nowNs();
    return unwrap(await dexAlice.createOffer({ min_bid_price: [1n * 100_000_000n], buyout_price: [], expiration: [now + BigInt(offerSeconds) * 1_000_000_000n], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: [], note_to_buyer: [] }));
  };
  const lockOwner = async (id) => { const r = await lock.get_lock_by_id(id); const info = r[0]; return info ? (info.TokenLock || info.PositionLock)[0].toText() : null; };

  it('lists the Sneed Lock type among the asset types', async () => {
    const types = await dexAlice.getAssetTypes();
    expect(types.some((t) => t.id === 4n && t.name === 'Sneed Lock' && t.active)).toBe(true);
    expect((await dexAlice.getSneedLockCanisterId()).toText()).toBe(lockId.toText());
  });

  it('sells a token lock: ownership moves to Sneedex for escrow and on to the winner', async () => {
    await tokenA.mint(sneedWallet(alice), 100_000n);
    const expiry = await expiryIn(3 * 86_400);
    const tokenLockId = unwrap(await lockAlice.create_lock(60_000n, tokenAId, expiry));
    expect(await lockOwner(tokenLockId)).toBe(alice.toText());

    const tokenAsset = (amount = 60_000n, ledger = tokenAId) => ({ SneedLock: { lock_id: tokenLockId, lock: { Token: { ledger_canister_id: ledger, amount, expiry } } } });
    // a lock that is not the caller's, or described wrongly, is refused up front
    const dexCarol = actorAs(pic, sneedexIdl, dexId, bob);
    const foreign = unwrap(await dexCarol.createOffer({ min_bid_price: [100_000_000n], buyout_price: [], expiration: [(await nowNs()) + 86_400n * 1_000_000_000n], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: [], note_to_buyer: [] }));
    expect(errOf(await dexCarol.addAsset({ offer_id: foreign, asset: tokenAsset() }))).toHaveProperty('InvalidAsset');
    expect(errOf(await dexAlice.addAsset({ offer_id: await newOffer(), asset: tokenAsset(60_000n, tokenBId) }))).toHaveProperty('InvalidAsset');
    expect(errOf(await dexAlice.addAsset({ offer_id: await newOffer(), asset: { SneedLock: { lock_id: 999n, lock: { Token: { ledger_canister_id: tokenAId, amount: 1n, expiry } } } } }))).toHaveProperty('InvalidAsset');
    // the lock must outlive the offer
    expect(errOf(await dexAlice.addAsset({ offer_id: await newOffer(5 * 86_400), asset: tokenAsset() }))).toHaveProperty('InvalidAsset');

    const offerId = await newOffer();
    unwrap(await dexAlice.addAsset({ offer_id: offerId, asset: tokenAsset() }));
    // listed once: a second open offer cannot list the same lock
    expect(errOf(await dexAlice.addAsset({ offer_id: await newOffer(), asset: tokenAsset() }))).toHaveProperty('InvalidAsset');
    unwrap(await dexAlice.finalizeAssets(offerId));
    // not transferred yet
    expect(errOf(await dexAlice.escrowSneedLock(offerId, 0n))).toHaveProperty('InvalidAsset');
    unwrap(await lockAlice.transfer_token_lock_ownership(dexId, tokenAId, tokenLockId));
    expect(await lockOwner(tokenLockId)).toBe(dexId.toText());
    // transferred, but Sneedex has no free balance to pay the delivery fee
    expect(errOf(await dexAlice.escrowSneedLock(offerId, 0n))).toHaveProperty('InvalidAsset');
    await tokenA.mint(sneedWallet(dexId), 2n * FEE_A);
    unwrap(await dexAlice.escrowSneedLock(offerId, 0n));
    const o = await offerOf(offerId);
    expect(o.assets[0].escrowed).toBe(true);
    expect(o.assets[0].asset.SneedLock.lock.Token.amount).toBe(60_000n);
    unwrap(await dexAlice.activateOffer(offerId));

    // bob bids 2 ICP and wins
    const bidId = unwrap(await dexBob.reserveBid(offerId));
    const bidSub = await dexBob.getBidEscrowSubaccount(bob, bidId);
    const icpBob = actorAs(pic, ledgerIdl, icpId, bob);
    unwrap(await icpBob.icrc1_transfer({ from_subaccount: [], to: { owner: dexId, subaccount: [bidSub] }, amount: 2n * 100_000_000n, fee: [], memo: [], created_at_time: [] }));
    unwrap(await dexBob.confirmBid(bidId, 2n * 100_000_000n));
    unwrap(await dexAlice.acceptBid(offerId));
    unwrap(await dexBob.claimAssets(offerId));
    for (let i = 0; i < 5; i++) await pic.tick(2);
    expect(await lockOwner(tokenLockId)).toBe(bob.toText());
    const bobLocks = await actorAs(pic, sneedLockIdl, lockId, bob).get_token_locks();
    expect(bobLocks.some(([id, ledger, amount]) => id === tokenLockId && ledger.toText() === tokenAId.toText() && amount === 60_000n)).toBe(true);
  }, 240_000);

  it('escrows a locked LP position and hands it back when the offer is cancelled', async () => {
    await pool.mint_position(alice, POS, 1_000_000n);
    expect(await lockAlice.claim_position(poolId, POS)).toBe(true); // claimed while alice still holds it on the pool
    unwrap(await poolAlice.transferPosition(alice, lockId, POS));
    const expiry = await expiryIn(3 * 86_400);
    const posLockId = unwrap(await lockAlice.create_position_lock(poolId, 1n, POS, expiry, tokenAId, tokenBId));
    expect(await lockOwner(posLockId)).toBe(alice.toText());

    const offerId = await newOffer();
    unwrap(await dexAlice.addAsset({ offer_id: offerId, asset: { SneedLock: { lock_id: posLockId, lock: { Position: { swap_canister_id: poolId, position_id: POS, expiry } } } } }));
    unwrap(await dexAlice.finalizeAssets(offerId));
    expect(errOf(await dexAlice.escrowSneedLock(offerId, 0n))).toHaveProperty('InvalidAsset');
    unwrap(await lockAlice.transfer_position_ownership(dexId, poolId, POS));
    expect(await lockOwner(posLockId)).toBe(dexId.toText());
    unwrap(await dexAlice.escrowSneedLock(offerId, 0n));
    unwrap(await dexAlice.activateOffer(offerId));
    unwrap(await dexAlice.cancelOffer(offerId));
    for (let i = 0; i < 10; i++) { await pic.advanceTime(1000); await pic.tick(2); }
    if (await lockOwner(posLockId) !== alice.toText()) unwrap(await dexAlice.reclaimAssets(offerId));
    for (let i = 0; i < 5; i++) await pic.tick(2);
    expect(await lockOwner(posLockId)).toBe(alice.toText());
    const claimed = await lock.get_claimed_positions_for_principal(alice);
    expect(claimed.some((c) => c.position_id === POS && c.position_lock.length === 1)).toBe(true);
  }, 240_000);
});
