// Sneedex with EXT NFT assets (step 3 of proposal #416; spec/sneedex.md): an EXT collection
// (canisters/MockExt.mo, transfer as the EXT reference implementation and the Sneed Diamond
// Club do it) whose cards are listed, escrowed by an EXT transfer to the account id of the
// offer's escrow subaccount (escrowEXTNFTs checks bearer), sold and delivered with an EXT
// transfer out of that account (from = its account id, subaccount = the escrow subaccount),
// checked with bearer before the delivery is recorded. Covers: validation and the holder rule,
// duplicate listings, no activation without escrow, a full sale with its ICRC-3 blocks, a
// cancelled offer handing the card back (also a card sent but never marked escrowed), a failing
// EXT transfer leaving the offer Completed until a retry delivers it once, a mixed offer
// (EXT + ICRC-1), the admin rescues (misplaced EXT token; adminReclaimStuckTokens with NFT
// assets, which trapped on ICRC-7 before), and an upgrade from the production wasm
// (build/sneedex_prod.wasm, commit 0775f9ac) that keeps every offer and then sells an EXT card.
// SNEEDEX_WASM=sneedex_prod runs this file against the production code (the fail-before run).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, wasm, account, admin, alice, bob, carol, user, ICP_LEDGER_ID, T, unwrap, errOf, refusedAtIngress } from '../lib/pic.js';
import { ledgerIdl, ledgerInit, extIdl, extAccountId, extTokenIdentifier, icrc7Idl, icrc7Init } from '../lib/idl.js';
import { archiveIdl, btype, tx, verifyLog } from '../lib/icrc3.js';
import { idlFactory as sneedexIdl, init as sneedexInit } from '../build/sneedex.did.js';

const SNEEDEX_WASM = process.env.SNEEDEX_WASM || 'sneedex';
const ICP_FEE = 10_000n;
const FEE_A = 1_000n;
const E8 = 100_000_000n;
const DAY = 86_400;
const dave = user('ext-dave');

let pic, rootKey, appSubnet, icpId, tokenAId, extId, ext, dexId, dex;

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
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const inSeconds = async (s) => (await nowNs()) + BigInt(s) * 1_000_000_000n;
const settle = async (seconds = 5, rounds = 10) => { await pic.advanceTime(seconds * 1000); for (let i = 0; i < rounds; i++) await pic.tick(2); };
const transfer = (ledgerId, from, to, amount) =>
  actorAs(pic, ledgerIdl, ledgerId, from).icrc1_transfer({ from_subaccount: [], to, amount, fee: [], memo: [], created_at_time: [] });
const balance = (ledgerId, owner) => actorAs(pic, ledgerIdl, ledgerId, admin).icrc1_balance_of(account(owner));
const extAs = (p) => actorAs(pic, extIdl, extId, p);
const holderOf = async (index) => unwrap(await ext.bearer(extTokenIdentifier(extId, index)));
const mintCard = (owner, name) => ext.mint(extAccountId(owner), [Buffer.from(JSON.stringify({ name }))]);
/// `who` sends a card with the collection's own transfer from its default account to an account id.
const sendCard = (who, index, toAid) => extAs(who).transfer({ from: { principal: who }, to: { address: toAid }, token: extTokenIdentifier(extId, index), amount: 1n, memo: [], notify: false, subaccount: [] });
const extAsset = (indices, collection = extId) => ({ EXTNFT: { collection_canister_id: collection, token_indices: indices.map(Number) } });
const tokenAsset = (ledger, amount) => ({ ICRC1Token: { ledger_canister_id: ledger, amount } });
const stateOf = async (m, id) => Object.keys((await m.bob.queryOffer(id))[0].state)[0];

/// One Sneedex canister as each test user, with the steps of a listing.
const market = (canisterId) => {
  const m = { id: canisterId };
  for (const [name, p] of Object.entries({ alice, bob, carol, admin, dave })) m[name] = actorAs(pic, sneedexIdl, canisterId, p);
  m.as = (p) => actorAs(pic, sneedexIdl, canisterId, p);
  m.create = async (o = {}, who = alice) => unwrap(await m.as(who).createOffer({ min_bid_price: [E8], buyout_price: [], expiration: [await inSeconds(30 * DAY)], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: [], note_to_buyer: [], ...o }));
  m.escrowAid = (id, creator = alice) => m.bob.getOfferEscrowAccountId(creator, id);
  /// alice's offer of `assets`, escrowed and active (EXT cards are sent to the escrow account id).
  m.list = async (assets, o = {}) => {
    const id = await m.create(o);
    for (const a of assets) unwrap(await m.alice.addAsset({ offer_id: id, asset: a }));
    unwrap(await m.alice.finalizeAssets(id));
    const sub = await m.bob.getOfferEscrowSubaccount(alice, id);
    for (const [i, a] of assets.entries()) {
      if (a.EXTNFT) {
        const aid = await m.escrowAid(id);
        for (const index of a.EXTNFT.token_indices) unwrap(await sendCard(alice, index, aid));
        unwrap(await m.alice.escrowEXTNFTs(id, BigInt(i)));
      } else {
        unwrap(await transfer(a.ICRC1Token.ledger_canister_id, alice, account(canisterId, sub), a.ICRC1Token.amount));
        unwrap(await m.alice.escrowICRC1Tokens(id, BigInt(i)));
      }
    }
    unwrap(await m.alice.activateOffer(id));
    return id;
  };
  /// `who` bids `amount` ICP (a buyout when it reaches the buyout price).
  m.bid = async (who, offerId, amount) => {
    const d = m.as(who);
    const bidId = unwrap(await d.reserveBid(offerId));
    unwrap(await transfer(icpId, who, account(canisterId, await d.getBidEscrowSubaccount(who, bidId)), amount));
    unwrap(await d.confirmBid(bidId, amount));
    return bidId;
  };
  m.log = async () => {
    const { blocks } = await verifyLog(actorAs(pic, sneedexIdl, canisterId, admin), canisterId, rootKey, (cid) => actorAs(pic, archiveIdl, cid, admin));
    return blocks.map((b, i) => ({ i, t: btype(b), ...plain(tx(b)) }));
  };
  m.logLength = async () => Number((await m.admin.icrc3_log_status()).log_length);
  m.since = async (mark) => (await m.log()).slice(mark);
  return m;
};
const only = (blocks, t, pred = () => true) => blocks.filter((b) => b.t === t && pred(b));
const one = (blocks, t, pred) => { const found = only(blocks, t, pred); expect(found, `${t}`).toHaveLength(1); return found[0]; };
const extV = (indices) => ({ type: 'ext', collection: P(extId), token_indices: indices.map(BigInt), token_identifiers: indices.map((i) => extTokenIdentifier(extId, i)) });

beforeAll(async () => {
  ({ pic, appSubnet, rootKey } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  extId = await install(pic, { name: 'MockExt', targetSubnetId: appSubnet });
  dexId = await install(pic, { name: SNEEDEX_WASM, initTypes: sneedexInit({ IDL }), initArgs: [[]], cycles: 60n * T, targetSubnetId: appSubnet });
  ext = extAs(admin);
  dex = market(dexId);
  const icp = actorAs(pic, ledgerIdl, icpId, admin);
  const tokenA = actorAs(pic, ledgerIdl, tokenAId, admin);
  for (const p of [alice, bob, carol, dave]) { await icp.mint(account(p), 1_000n * E8); await tokenA.mint(account(p), 1_000n * E8); }
  await pic.tick(2);
}, 180_000);
afterAll(async () => { await pic?.tearDown(); });

describe('the EXT asset type', () => {
  it('is listed as asset type 5, and the escrow account id is the EXT account id of the escrow subaccount', async () => {
    const types = await dex.bob.getAssetTypes();
    expect(types.some((t) => t.id === 5n && t.name === 'EXT NFT' && t.active)).toBe(true);
    expect((await dex.bob.icrc3_supported_block_types()).map((t) => t.block_type)).toContain('sneedex_admin_ext_return');
    const id = await dex.create();
    const sub = await dex.bob.getOfferEscrowSubaccount(alice, id);
    // computed independently (node sha224 + crc32)
    expect(await dex.escrowAid(id)).toBe(extAccountId(dexId, Uint8Array.from(sub)));
    unwrap(await dex.alice.cancelOffer(id));
  });
});

describe('listing an EXT card', () => {
  it('validates the token list, needs the holder, and refuses duplicates', async () => {
    const mine = Number(await mintCard(alice, 'Card A'));
    const mine2 = Number(await mintCard(alice, 'Card B'));
    const bobs = Number(await mintCard(bob, 'Card C'));
    const id = await dex.create();
    expect(errOf(await dex.alice.addAsset({ offer_id: id, asset: extAsset([]) }))).toHaveProperty('InvalidAsset');
    expect(errOf(await dex.alice.addAsset({ offer_id: id, asset: extAsset([mine, mine]) }))).toHaveProperty('InvalidAsset');
    expect(await refusedAtIngress(dex.alice.addAsset({ offer_id: id, asset: extAsset(Array.from({ length: 51 }, (_, i) => i)) }))).toBe(true);
    // not the seller's card, and not the seller's offer
    expect(errOf(await dex.alice.addAsset({ offer_id: id, asset: extAsset([bobs]) })).InvalidAsset).toMatch(/is not yours/);
    expect(errOf(await dex.bob.addAsset({ offer_id: id, asset: extAsset([bobs]) }))).toHaveProperty('NotAuthorized');
    // a token that does not exist, and a canister that is no EXT collection
    expect(errOf(await dex.alice.addAsset({ offer_id: id, asset: extAsset([9999]) })).InvalidAsset).toMatch(/does not exist/);
    expect(errOf(await dex.alice.addAsset({ offer_id: id, asset: extAsset([0], icpId) }))).toHaveProperty('TransferFailed');
    unwrap(await dex.alice.addAsset({ offer_id: id, asset: extAsset([mine, mine2]) }));
    // the same card twice in one offer, or in another open offer of the same seller
    expect(errOf(await dex.alice.addAsset({ offer_id: id, asset: extAsset([mine2]) }))).toHaveProperty('InvalidAsset');
    const other = await dex.create();
    expect(errOf(await dex.alice.addAsset({ offer_id: other, asset: extAsset([mine]) })).InvalidAsset).toMatch(new RegExp(`already listed in offer ${id}`));
    // a stale draft of a former holder does not block the new holder
    unwrap(await sendCard(alice, mine, extAccountId(dave)));
    const daves = await dex.create({}, dave);
    unwrap(await dex.dave.addAsset({ offer_id: daves, asset: extAsset([mine]) }));
    for (const o of [id, other]) unwrap(await dex.alice.cancelOffer(o));
    unwrap(await dex.dave.cancelOffer(daves));
    await settle(5);
    expect(await holderOf(mine)).toBe(extAccountId(dave)); // nothing was in escrow, nothing moved
    expect(await holderOf(mine2)).toBe(extAccountId(alice));
  });

  it('cannot activate before the card is in the escrow account', async () => {
    const card = Number(await mintCard(alice, 'Card D'));
    const id = await dex.create();
    unwrap(await dex.alice.addAsset({ offer_id: id, asset: extAsset([card]) }));
    unwrap(await dex.alice.finalizeAssets(id));
    expect(errOf(await dex.alice.escrowEXTNFTs(id, 0n)).InvalidAsset).toMatch(/is not in the escrow account/);
    expect(errOf(await dex.alice.activateOffer(id))).toHaveProperty('InvalidState');
    // sent to Sneedex's principal (its default account) instead of the escrow account: still not escrowed
    unwrap(await sendCard(alice, card, extAccountId(dexId)));
    expect(errOf(await dex.alice.escrowEXTNFTs(id, 0n))).toHaveProperty('InvalidAsset');
    expect(errOf(await dex.alice.activateOffer(id))).toHaveProperty('InvalidState');
    expect(errOf(await dex.bob.escrowEXTNFTs(id, 0n))).toHaveProperty('NotAuthorized');
    unwrap(await dex.alice.cancelOffer(id));
    await settle(5);
    expect(await holderOf(card)).toBe(extAccountId(dexId)); // misplaced: the admin rescue (below) returns it
  });
});

describe('a sale', () => {
  it('escrows, sells and delivers the card to the buyer, every step logged', async () => {
    const card = Number(await mintCard(alice, 'Diamond #1'));
    const mark = await dex.logLength();
    const id = await dex.list([extAsset([card])], { buyout_price: [3n * E8] });
    expect(await holderOf(card)).toBe(await dex.escrowAid(id));
    const entry = (await dex.bob.queryOffer(id))[0].assets[0];
    expect(entry.escrowed).toBe(true);
    expect(Array.from(entry.asset.EXTNFT.token_indices)).toEqual([card]); // vec nat32 decodes as a Uint32Array
    const bidId = await dex.bid(bob, id, 3n * E8); // the buyout
    await settle(5); await settle(5);
    expect(await holderOf(card)).toBe(extAccountId(bob));
    expect(await stateOf(dex, id)).toBe('Claimed');
    const blocks = await dex.since(mark);
    const asset = extV([card]);
    expect(one(blocks, 'sneedex_asset_add')).toMatchObject({ offer_id: id, caller: P(alice), asset });
    expect(one(blocks, 'sneedex_asset_escrow')).toMatchObject({ offer_id: id, asset_index: 0n, asset, account_id: await dex.escrowAid(id) });
    expect(one(blocks, 'sneedex_offer_complete')).toMatchObject({ offer_id: id, bid_id: bidId, reason: 'buyout' });
    expect(one(blocks, 'sneedex_asset_deliver')).toMatchObject({ offer_id: id, asset, moved: 1n, to: P(bob), side: 'buyer', via: 'timer' });
    expect(one(blocks, 'sneedex_offer_settle')).toMatchObject({ offer_id: id, outcome: 'claimed', to: P(bob) });
    // the card is the buyer's now: a claim again moves nothing
    expect(errOf(await dex.bob.claimAssets(id)).InvalidState).toMatch(/already claimed/);
    expect(await holderOf(card)).toBe(extAccountId(bob));
  }, 120_000);

  it('a mixed offer (EXT card + ICRC-1 tokens) hands both to the buyer', async () => {
    const card = Number(await mintCard(alice, 'Diamond #2'));
    const bobA0 = await balance(tokenAId, bob);
    const id = await dex.list([extAsset([card]), tokenAsset(tokenAId, 50_000n)], { buyout_price: [2n * E8] });
    await dex.bid(bob, id, 2n * E8);
    await settle(5); await settle(5);
    expect(await holderOf(card)).toBe(extAccountId(bob));
    expect(await balance(tokenAId, bob)).toBe(bobA0 + 50_000n - FEE_A);
    expect(await stateOf(dex, id)).toBe('Claimed');
  }, 120_000);
});

describe('a cancelled offer', () => {
  it('hands the escrowed card back to the seller', async () => {
    const card = Number(await mintCard(alice, 'Diamond #3'));
    const mark = await dex.logLength();
    const id = await dex.list([extAsset([card])]);
    unwrap(await dex.alice.cancelOffer(id));
    await settle(5); await settle(5);
    expect(await holderOf(card)).toBe(extAccountId(alice));
    expect(await stateOf(dex, id)).toBe('Reclaimed');
    const blocks = await dex.since(mark);
    expect(one(blocks, 'sneedex_asset_deliver')).toMatchObject({ offer_id: id, asset: extV([card]), moved: 1n, to: P(alice), side: 'seller' });
    expect(one(blocks, 'sneedex_offer_settle')).toMatchObject({ offer_id: id, outcome: 'reclaimed' });
  }, 120_000);

  it('also hands back a card that was sent to the escrow account but never marked escrowed', async () => {
    const card = Number(await mintCard(alice, 'Diamond #4'));
    const id = await dex.create();
    unwrap(await dex.alice.addAsset({ offer_id: id, asset: extAsset([card]) }));
    unwrap(await dex.alice.finalizeAssets(id));
    unwrap(await sendCard(alice, card, await dex.escrowAid(id)));
    const mark = await dex.logLength();
    unwrap(await dex.alice.cancelOffer(id)); // before escrowEXTNFTs
    await settle(5); await settle(5);
    expect(await holderOf(card)).toBe(extAccountId(alice));
    expect(await stateOf(dex, id)).toBe('Reclaimed');
    expect(one(await dex.since(mark), 'sneedex_asset_deliver')).toMatchObject({ offer_id: id, moved: 1n, escrowed: 0n, side: 'seller' });
  }, 120_000);
});

describe('a failing EXT transfer', () => {
  it('leaves the offer Completed; the retry delivers the card once', async () => {
    const card = Number(await mintCard(alice, 'Diamond #5'));
    const id = await dex.list([extAsset([card])], { buyout_price: [2n * E8] });
    const mark = await dex.logLength();
    await ext.set_transfer_failing(true);
    await dex.bid(bob, id, 2n * E8);
    await settle(5); await settle(5);
    expect(await stateOf(dex, id)).toBe('Completed');
    expect(await holderOf(card)).toBe(await dex.escrowAid(id));
    expect(errOf(await dex.bob.claimAssets(id)).TransferFailed).toMatch(/Transfers are paused/);
    expect(only(await dex.since(mark), 'sneedex_asset_deliver')).toHaveLength(0);
    await ext.set_transfer_failing(false);
    const moves0 = await ext.transfer_count();
    unwrap(await dex.bob.claimAssets(id));
    expect(await holderOf(card)).toBe(extAccountId(bob));
    expect(await stateOf(dex, id)).toBe('Claimed');
    expect(await ext.transfer_count()).toBe(moves0 + 1n);
    // again: nothing more moves
    expect(errOf(await dex.bob.claimAssets(id)).InvalidState).toMatch(/already claimed/);
    await settle(5);
    expect(await ext.transfer_count()).toBe(moves0 + 1n);
    const blocks = await dex.since(mark);
    expect(one(blocks, 'sneedex_asset_deliver')).toMatchObject({ offer_id: id, moved: 1n, to: P(bob), caller: P(bob) });
    expect(one(blocks, 'sneedex_offer_settle')).toMatchObject({ offer_id: id, outcome: 'claimed' });
  }, 120_000);
});

describe('admin rescues', () => {
  it('return a misplaced EXT card, never an escrowed one', async () => {
    // the card sent to Sneedex's default account by the test above ("cannot activate…")
    const misplaced = (await ext.getRegistry()).find(([, a]) => a === extAccountId(dexId))[0];
    expect(errOf(await dex.bob.adminReturnMisplacedExtNft(extId, misplaced, [], alice))).toHaveProperty('NotAuthorized');
    const mark = await dex.logLength();
    unwrap(await dex.admin.adminReturnMisplacedExtNft(extId, misplaced, [], alice));
    expect(await holderOf(misplaced)).toBe(extAccountId(alice));
    // not there (any more)
    expect(errOf(await dex.admin.adminReturnMisplacedExtNft(extId, misplaced, [], alice))).toHaveProperty('InvalidAsset');
    // an escrowed card of an active offer is never moved
    const card = Number(await mintCard(alice, 'Diamond #6'));
    const id = await dex.list([extAsset([card])]);
    expect(errOf(await dex.admin.adminReturnMisplacedExtNft(extId, card, [id], carol)).InvalidState).toMatch(/escrowed for offer/);
    expect(await holderOf(card)).toBe(await dex.escrowAid(id));
    // a card someone sent to the escrow account of an offer that does not list it
    const stray = Number(await mintCard(carol, 'Stray'));
    unwrap(await sendCard(carol, stray, await dex.escrowAid(id)));
    unwrap(await dex.admin.adminReturnMisplacedExtNft(extId, stray, [id], carol));
    expect(await holderOf(stray)).toBe(extAccountId(carol));
    const blocks = await dex.since(mark);
    expect(only(blocks, 'sneedex_admin_ext_return')).toHaveLength(2);
    expect(only(blocks, 'sneedex_admin_ext_return')[0]).toMatchObject({ caller: P(admin), collection: P(extId), token_index: BigInt(misplaced), token_identifier: extTokenIdentifier(extId, misplaced), from_account_id: extAccountId(dexId), to: P(alice) });
    expect(only(blocks, 'sneedex_admin_ext_return')[1]).toMatchObject({ token_index: BigInt(stray), from_offer_id: id, from_account_id: await dex.escrowAid(id), to: P(carol) });
    unwrap(await dex.alice.cancelOffer(id));
    await settle(5); await settle(5);
    expect(await holderOf(card)).toBe(extAccountId(alice));
  }, 120_000);

  it('adminReclaimStuckTokens hands an escrowed ICRC-7 NFT back (it trapped before: the switch did not cover ICRC-7)', async () => {
    const nftId = await install(pic, { name: 'Icrc7Demo', initTypes: icrc7Init, initArgs: [{ name: 'Cats', symbol: 'CAT', description: [], logo: [] }], targetSubnetId: appSubnet });
    const nft = actorAs(pic, icrc7Idl, nftId, admin);
    const cat = unwrap(await nft.mint(account(alice), [['name', { Text: 'Cat' }]]));
    const id = await dex.create();
    unwrap(await dex.alice.addAsset({ offer_id: id, asset: { ICRC7NFT: { collection_canister_id: nftId, token_ids: [cat] } } }));
    unwrap(await dex.alice.finalizeAssets(id));
    const sub = await dex.bob.getOfferEscrowSubaccount(alice, id);
    const sent = await actorAs(pic, icrc7Idl, nftId, alice).icrc7_transfer([{ from_subaccount: [], to: account(dexId, sub), token_id: cat, memo: [], created_at_time: [] }]);
    expect(sent[0][0]).toHaveProperty('Ok');
    unwrap(await dex.alice.escrowICRC7NFTs(id, 0n));
    const mark = await dex.logLength();
    expect(unwrap(await dex.admin.adminReclaimStuckTokens(id))).toMatch(/NFTs returned to the seller: 1/);
    expect((await nft.icrc7_owner_of([cat]))[0][0].owner.toText()).toBe(alice.toText());
    expect(only(await dex.since(mark), 'sneedex_admin_asset_return').map((b) => [b.asset_index, b.moved])).toEqual([[0n, 1n]]);
    unwrap(await dex.alice.cancelOffer(id));
  }, 120_000);

  it('adminReclaimStuckTokens hands an escrowed EXT card back', async () => {
    const card = Number(await mintCard(alice, 'Diamond #7'));
    const id = await dex.create();
    unwrap(await dex.alice.addAsset({ offer_id: id, asset: extAsset([card]) }));
    unwrap(await dex.alice.finalizeAssets(id));
    unwrap(await sendCard(alice, card, await dex.escrowAid(id)));
    unwrap(await dex.alice.escrowEXTNFTs(id, 0n));
    const mark = await dex.logLength();
    expect(unwrap(await dex.admin.adminReclaimStuckTokens(id))).toMatch(/EXT tokens returned to the seller: 1/);
    expect(await holderOf(card)).toBe(extAccountId(alice));
    expect(only(await dex.since(mark), 'sneedex_admin_asset_return').map((b) => [b.asset_index, b.moved, b.asset.type])).toEqual([[0n, 1n, 'ext']]);
    // run again: nothing left in escrow, nothing moves or is logged
    expect(unwrap(await dex.admin.adminReclaimStuckTokens(id))).toMatch(/EXT tokens returned to the seller: 0/);
    expect(only(await dex.since(mark), 'sneedex_admin_asset_return')).toHaveLength(1);
    unwrap(await dex.alice.cancelOffer(id));
  }, 120_000);
});

describe('upgrade from the production wasm', () => {
  it('keeps every offer and bid, adds the EXT type, and then sells an EXT card', async () => {
    const oldId = await install(pic, { name: 'sneedex_prod', initTypes: sneedexInit({ IDL }), initArgs: [[]], cycles: 20n * T, targetSubnetId: appSubnet });
    const old = market(oldId);
    const sold = await old.list([tokenAsset(tokenAId, 13_000n)]);
    const open = await old.list([tokenAsset(tokenAId, 14_000n)]);
    const draft = await old.create({ public_note: ['hi'], note_to_buyer: ['psst'] });
    await old.bid(bob, sold, E8);
    unwrap(await old.alice.acceptBid(sold));
    await old.bid(carol, open, 2n * E8);
    await settle(5);
    const snapshot = async () => ({
      offers: await old.alice.getOffersByCreator(alice),
      bids: [...(await old.bob.getBidsByBidder(bob)), ...(await old.bob.getBidsByBidder(carol))],
      views: await Promise.all([sold, open, draft].map((id) => old.alice.getOfferView(id))),
      next: [await old.bob.getNextOfferId(), await old.bob.getNextBidId()],
      stats: await old.bob.getPaymentStats(),
      log: await old.log(),
    });
    const before = await snapshot();
    expect(before.offers).toHaveLength(3);
    expect((await old.bob.getAssetTypes()).map((t) => t.id)).toEqual([0n, 1n, 2n, 3n, 4n]);

    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm('sneedex'), arg: IDL.encode(sneedexInit({ IDL }), [[]]) });
    expect(await snapshot()).toEqual(before);
    const types = await old.bob.getAssetTypes();
    expect(types.map((t) => t.id)).toEqual([0n, 1n, 2n, 3n, 4n, 5n]);
    expect(types[5]).toMatchObject({ name: 'EXT NFT', active: true });

    const card = Number(await mintCard(alice, 'Diamond after upgrade'));
    const id = await old.list([extAsset([card])], { buyout_price: [2n * E8] });
    await old.bid(bob, id, 2n * E8);
    await settle(5); await settle(5);
    expect(await holderOf(card)).toBe(extAccountId(bob));
    expect(await stateOf(old, id)).toBe('Claimed');
    // the open offer of before the upgrade still settles
    unwrap(await old.alice.cancelOffer(open));
    await settle(5); await settle(5);
    expect(await stateOf(old, open)).toBe('Reclaimed');
    // a second upgrade keeps the EXT offer
    const offers = await old.alice.getOffersByCreator(alice);
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm('sneedex'), arg: IDL.encode(sneedexInit({ IDL }), [[]]) });
    expect(await old.alice.getOffersByCreator(alice)).toEqual(offers);
  }, 240_000);
});
