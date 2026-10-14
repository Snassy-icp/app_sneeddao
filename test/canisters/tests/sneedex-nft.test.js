// Sneedex with an ICRC-7 asset: listing, escrow by transfer and by ICRC-37
// approval, a sale delivered to the winner, and a cancelled offer reclaimed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, account, unwrap, errOf, ICP_LEDGER_ID } from '../lib/pic.js';
import { ledgerIdl, ledgerInit, icrc7Idl, icrc7Init } from '../lib/idl.js';
import { idlFactory as sneedexIdl, init as sneedexInit } from '../build/sneedex.did.js';
import { IDL } from '@icp-sdk/core/candid';

const ICP_FEE = 10_000n;
let pic, icpId, nftId, dexId, icp, nftAdmin, nftAlice, dexAlice, dexBob, nftAny;

describe('sneedex: ICRC-7 NFT assets', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
    nftId = await install(pic, { name: 'Icrc7Demo', initTypes: icrc7Init, initArgs: [{ name: 'Sneed Test Cats', symbol: 'CATS', description: [], logo: [] }] });
    dexId = await install(pic, { name: 'sneedex', initTypes: sneedexInit({ IDL }), initArgs: [[]] });
    icp = actorAs(pic, ledgerIdl, icpId, admin);
    nftAdmin = actorAs(pic, icrc7Idl, nftId, admin); nftAlice = actorAs(pic, icrc7Idl, nftId, alice); nftAny = actorAs(pic, icrc7Idl, nftId, bob);
    dexAlice = actorAs(pic, sneedexIdl, dexId, alice); dexBob = actorAs(pic, sneedexIdl, dexId, bob);
    for (let i = 1; i <= 4; i++) unwrap(await nftAdmin.mint(account(alice), [['name', { Text: `Cat #${i}` }]]));
    await icp.mint(account(bob), 50n * 100_000_000n);
  }, 120_000);
  afterAll(async () => { await pic?.tearDown(); });

  const owner = async (id) => (await nftAny.icrc7_owner_of([id]))[0][0]?.owner?.toText();
  const offerOf = async (id) => (await dexAlice.getOffersByCreator(alice)).find((o) => o.id === id);
  const nftAsset = (ids) => ({ ICRC7NFT: { collection_canister_id: nftId, token_ids: ids } });
  const newOffer = async (buyout) => { const now = BigInt(Math.round(await pic.getTime())) * 1_000_000n; return unwrap(await dexAlice.createOffer({ min_bid_price: [1n * 100_000_000n], buyout_price: buyout ? [buyout] : [], expiration: [now + 2n * 86_400n * 1_000_000_000n], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: [], note_to_buyer: [] })); };

  it('lists the NFT type among the asset types', async () => {
    const types = await dexAlice.getAssetTypes();
    expect(types.some((t) => t.id === 3n && t.name === 'ICRC-7 NFT' && t.active)).toBe(true);
  });

  it('validates the NFT asset and refuses duplicates', async () => {
    const offerId = await newOffer();
    expect(errOf(await dexAlice.addAsset({ offer_id: offerId, asset: nftAsset([]) }))).toHaveProperty('InvalidAsset');
    expect(errOf(await dexAlice.addAsset({ offer_id: offerId, asset: nftAsset([1n, 1n]) }))).toHaveProperty('InvalidAsset');
    unwrap(await dexAlice.addAsset({ offer_id: offerId, asset: nftAsset([1n, 2n]) }));
    expect(errOf(await dexAlice.addAsset({ offer_id: offerId, asset: nftAsset([2n, 3n]) }))).toHaveProperty('InvalidAsset'); // #2 twice in one offer
    unwrap(await dexAlice.cancelOffer(offerId));
  });

  it('escrows by transfer, sells, and delivers the tokens to the winner', async () => {
    const offerId = await newOffer();
    unwrap(await dexAlice.addAsset({ offer_id: offerId, asset: nftAsset([1n, 2n]) }));
    unwrap(await dexAlice.finalizeAssets(offerId));
    // not there yet
    expect(errOf(await dexAlice.escrowICRC7NFTs(offerId, 0n))).toHaveProperty('InvalidAsset');
    const sub = await dexAlice.getOfferEscrowSubaccount(alice, offerId);
    const r = await nftAlice.icrc7_transfer([1n, 2n].map((token_id) => ({ from_subaccount: [], to: { owner: dexId, subaccount: [sub] }, token_id, memo: [], created_at_time: [] })));
    expect(r.every((x) => 'Ok' in x[0])).toBe(true);
    unwrap(await dexAlice.escrowICRC7NFTs(offerId, 0n));
    expect((await offerOf(offerId)).assets[0].escrowed).toBe(true);
    unwrap(await dexAlice.activateOffer(offerId));
    // bob bids 2 ICP
    const bidId = unwrap(await dexBob.reserveBid(offerId));
    const bidSub = await dexBob.getBidEscrowSubaccount(bob, bidId);
    const icpBob = actorAs(pic, ledgerIdl, icpId, bob);
    unwrap(await icpBob.icrc1_transfer({ from_subaccount: [], to: { owner: dexId, subaccount: [bidSub] }, amount: 2n * 100_000_000n, fee: [], memo: [], created_at_time: [] }));
    unwrap(await dexBob.confirmBid(bidId, 2n * 100_000_000n));
    unwrap(await dexAlice.acceptBid(offerId));
    // the winner collects: Sneedex moves the tokens out of escrow to the buyer
    unwrap(await dexBob.claimAssets(offerId));
    for (let i = 0; i < 5; i++) await pic.tick(2);
    expect(await owner(1n)).toBe(bob.toText());
    expect(await owner(2n)).toBe(bob.toText());
  }, 180_000);

  it('escrows by ICRC-37 approval, then a cancelled offer hands the token back', async () => {
    const offerId = await newOffer();
    unwrap(await dexAlice.addAsset({ offer_id: offerId, asset: nftAsset([3n]) }));
    unwrap(await dexAlice.finalizeAssets(offerId));
    // without an approval the pull fails and nothing moves
    expect(errOf(await dexAlice.escrowICRC7NFTsByApproval(offerId, 0n))).toHaveProperty('TransferFailed');
    expect(await owner(3n)).toBe(alice.toText());
    const now = BigInt(Math.round(await pic.getTime())) * 1_000_000n;
    const ap = await nftAlice.icrc37_approve_tokens([{ token_id: 3n, approval_info: { spender: account(dexId), from_subaccount: [], expires_at: [], memo: [], created_at_time: now } }]);
    expect('Ok' in ap[0][0]).toBe(true);
    unwrap(await dexAlice.escrowICRC7NFTsByApproval(offerId, 0n));
    expect(await owner(3n)).toBe(dexId.toText());
    unwrap(await dexAlice.activateOffer(offerId));
    unwrap(await dexAlice.cancelOffer(offerId));
    for (let i = 0; i < 10; i++) { await pic.advanceTime(1000); await pic.tick(2); }
    const st = (await offerOf(offerId)).state;
    if (await owner(3n) !== alice.toText()) unwrap(await dexAlice.reclaimAssets(offerId));
    expect(await owner(3n)).toBe(alice.toText());
    expect(Object.keys(st)[0]).toMatch(/Cancelled|Reclaimed/);
  }, 180_000);
});
