// Sneedex with locks listed as NFTs of Sneed Lock's own collection (ICRC-7): the rules of the
// Sneed Lock asset type still hold. A lock must outlive the offer (checked when listed and again
// at escrow, by the lock's current id for a position), and a token lock must be able to pay its
// delivery fee (gas in its tank, or a free fee in Sneedex's Sneed Lock wallet).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, account, principalToSubaccount, admin, alice, bob, ICP_LEDGER_ID, T, unwrap, errOf } from '../lib/pic.js';
import { ledgerIdl, ledgerInit, poolIdl, poolInit } from '../lib/idl.js';
import { idlFactory as sneedLockIdl } from '../build/sneed_lock.did.js';
import { idlFactory as sneedexIdl, init as sneedexInit } from '../build/sneedex.did.js';

const ICP_FEE = 10_000n;
const FEE_A = 1_000n;
const DAY_NS = 86_400n * 1_000_000_000n;
let pic, appSubnet, icpId, tokenAId, tokenBId, poolId, lockId, dexId;
let icp, tokenA, pool, lock, lockAlice, dexAlice, dexBob;

const sneedWallet = (p) => account(lockId, principalToSubaccount(p));
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const nftAsset = (ids) => ({ ICRC7NFT: { collection_canister_id: lockId, token_ids: ids } });
const newOffer = async (days = 1n) => unwrap(await dexAlice.createOffer({ min_bid_price: [100_000_000n], buyout_price: [], expiration: [(await nowNs()) + days * DAY_NS], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: [], note_to_buyer: [] }));
const ownerOf = async (id) => { const [o] = (await lock.icrc7_owner_of([id]))[0]; return o ? o.owner.toText() : null; };

describe('sneedex: Sneed Lock NFTs', () => {
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
    pool = actorAs(pic, poolIdl, poolId, admin);
    lock = actorAs(pic, sneedLockIdl, lockId, admin); lockAlice = actorAs(pic, sneedLockIdl, lockId, alice);
    const dexAdmin = actorAs(pic, sneedexIdl, dexId, admin);
    dexAlice = actorAs(pic, sneedexIdl, dexId, alice); dexBob = actorAs(pic, sneedexIdl, dexId, bob);
    unwrap(await dexAdmin.setSneedLockCanisterId(lockId));
    await icp.mint(account(bob), 50n * 100_000_000n);
    await pic.tick(3);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('refuses a token lock that unlocks before the offer ends', async () => {
    await tokenA.mint(sneedWallet(alice), 100_000n);
    const short = unwrap(await lockAlice.create_lock(10_000n, tokenAId, (await nowNs()) + DAY_NS, []));
    expect(errOf(await dexAlice.addAsset({ offer_id: await newOffer(2n), asset: nftAsset([short]) })).InvalidAsset).toMatch(/outlive the offer/);
    // the same lock with an offer that ends first is fine
    const twelveHours = unwrap(await dexAlice.createOffer({ min_bid_price: [100_000_000n], buyout_price: [], expiration: [(await nowNs()) + DAY_NS / 2n], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: [], note_to_buyer: [] }));
    unwrap(await dexAlice.addAsset({ offer_id: twelveHours, asset: nftAsset([short]) }));
  });

  it('refuses a delay lock whose dissolving ends before the offer does, also when it starts dissolving after listing', async () => {
    const HOUR = 3600n * 1_000_000_000n;
    const neuron = unwrap(await lockAlice.create_lock(10_000n, tokenAId, 0n, [12n * HOUR]));
    // not dissolving: held until it dissolves, so it outlives any offer
    const offerId = await newOffer(1n);
    unwrap(await dexAlice.addAsset({ offer_id: offerId, asset: nftAsset([neuron]) }));
    unwrap(await dexAlice.finalizeAssets(offerId));
    // the seller starts dissolving before escrow: 12 h < the offer's day
    expect(await lockAlice.start_dissolving(neuron)).toHaveProperty('Ok');
    const sub = await dexAlice.getOfferEscrowSubaccount(alice, offerId);
    unwrap((await lockAlice.icrc7_transfer([{ from_subaccount: [], to: { owner: dexId, subaccount: [sub] }, token_id: neuron, memo: [], created_at_time: [] }]))[0][0]);
    expect(errOf(await dexAlice.escrowICRC7NFTs(offerId, 0n)).InvalidAsset).toMatch(/outlive the offer/);
  });

  it('sells a token lock NFT once it can pay its delivery, and delivers it to the winner', async () => {
    await tokenA.mint(sneedWallet(alice), 60_000n + FEE_A);
    const id = unwrap(await lockAlice.create_lock(60_000n, tokenAId, (await nowNs()) + 3n * DAY_NS, []));
    const offerId = await newOffer(1n);
    unwrap(await dexAlice.addAsset({ offer_id: offerId, asset: nftAsset([id]) }));
    unwrap(await dexAlice.finalizeAssets(offerId));
    const sub = await dexAlice.getOfferEscrowSubaccount(alice, offerId);
    unwrap((await lockAlice.icrc7_transfer([{ from_subaccount: [], to: { owner: dexId, subaccount: [sub] }, token_id: id, memo: [], created_at_time: [] }]))[0][0]);
    // in escrow, but neither its gas tank nor Sneedex's wallet can pay the delivery fee
    expect(errOf(await dexAlice.escrowICRC7NFTs(offerId, 0n)).InvalidAsset).toMatch(/needs gas/);
    const [gas] = await lock.get_lock_gas(id);
    await tokenA.mint(gas.account, 2n * FEE_A);
    unwrap(await dexAlice.escrowICRC7NFTs(offerId, 0n));
    unwrap(await dexAlice.activateOffer(offerId));
    const bidId = unwrap(await dexBob.reserveBid(offerId));
    const bidSub = await dexBob.getBidEscrowSubaccount(bob, bidId);
    unwrap(await actorAs(pic, ledgerIdl, icpId, bob).icrc1_transfer({ from_subaccount: [], to: { owner: dexId, subaccount: [bidSub] }, amount: 2n * 100_000_000n, fee: [], memo: [], created_at_time: [] }));
    unwrap(await dexBob.confirmBid(bidId, 2n * 100_000_000n));
    unwrap(await dexAlice.acceptBid(offerId));
    unwrap(await dexBob.claimAssets(offerId));
    for (let i = 0; i < 5; i++) await pic.tick(2);
    expect(await ownerOf(id)).toBe(bob.toText());
    expect((await lock.get_lock_state(id))[0].amount).toEqual([60_000n]);
    expect(await tokenA.icrc1_balance_of(sneedWallet(bob))).toBe(60_000n);
  }, 240_000);

  it('checks a position by its current lock, not the NFT id of its first lock', async () => {
    const POS = 21n;
    await pool.mint_position(alice, POS, 1_000_000n);
    expect(await lockAlice.claim_position(poolId, POS)).toBe(true);
    unwrap(await actorAs(pic, poolIdl, poolId, alice).transferPosition(alice, lockId, POS));
    const first = unwrap(await lockAlice.create_position_lock(poolId, 1n, POS, (await nowNs()) + DAY_NS, tokenAId, tokenBId, []));
    await pic.advanceTime(2 * 86_400 * 1000); await pic.tick();
    // re-locked for a week: a new lock id, the same NFT
    const relock = unwrap(await lockAlice.create_position_lock(poolId, 1n, POS, (await nowNs()) + 7n * DAY_NS, tokenAId, tokenBId, []));
    expect(relock).not.toBe(first);
    expect(await lock.get_position_nft(poolId, POS)).toEqual([first]);
    unwrap(await dexAlice.addAsset({ offer_id: await newOffer(3n), asset: nftAsset([first]) }));
    expect(errOf(await dexAlice.addAsset({ offer_id: await newOffer(8n), asset: nftAsset([first]) })).InvalidAsset).toMatch(/outlive the offer/);
  });
});
