// The Sneedex ICRC-3 activity log (spec/sneedex_icrc3.md): an empty log with the documented
// catalogue; the blocks of every flow (offer creation with its fee, assets, escrow, activation,
// bids, outbidding, excess refunds, escrow withdrawals, buyouts, accepted bids, expiry by anyone
// and by the worker, cancellation, refunds, each asset handed over, settlement, the marketplace
// cut and the seller payment, admin rescues and config changes); a failed transfer appends
// nothing and its retry appends the block; the hash chain and certified tip verify (lib/icrc3.js);
// spills into archive canisters co-controlled by SNS root, registered through a hotkeyed neuron;
// an upgrade keeps the log and certificate; and an upgrade from the production wasm
// (build/sneedex_preicrc3.wasm, commit b483932c) keeps every offer and bid and starts an empty log.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import {
  createPic, install, actorAs, wasm, account, admin, alice, bob, carol, user, ICP_LEDGER_ID,
  SNEED_SNS_ROOT, SNEED_GOVERNANCE, T, unwrap, errOf, paymentSubaccount, refusedAtIngress,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit, governanceIdl, icrc7Idl, icrc7Init } from '../lib/idl.js';
import { archiveIdl, btype, tx, verifyLog } from '../lib/icrc3.js';
import { idlFactory as sneedexIdl, init as sneedexInit } from '../build/sneedex.did.js';

const ICP_FEE = 10_000n;
const FEE_A = 1_000n;
const FEE_B = 2_000n;
const E8 = 100_000_000n;
const DAY = 86_400;
const BLOCK_TYPES_URL = 'https://app.sneeddao.com/api/sneedex#block-types';
const CATALOGUE = [
  'sneedex_offer_create', 'sneedex_asset_add', 'sneedex_offer_finalize', 'sneedex_asset_escrow', 'sneedex_offer_activate',
  'sneedex_offer_cancel', 'sneedex_offer_expire', 'sneedex_offer_complete', 'sneedex_asset_deliver', 'sneedex_offer_settle',
  'sneedex_bid_reserve', 'sneedex_bid_excess_refund', 'sneedex_bid_confirm', 'sneedex_bid_lost', 'sneedex_bid_refund',
  'sneedex_bid_escrow_withdraw', 'sneedex_cut_pay', 'sneedex_seller_pay', 'sneedex_creation_fee_pay',
  'sneedex_creation_payment_withdraw', 'sneedex_admin_asset_return', 'sneedex_admin_nft_return', 'sneedex_admin_ext_return', 'sneedex_config_update',
];
const treasury = user('icrc3-treasury');

// MockLedgerFaulty: the mock ledger plus rules that make transfers to given owners fail
const faultyIdl = ({ IDL }) => IDL.Service({ ...Object.fromEntries(ledgerIdl({ IDL })._fields), set_fail_to: IDL.Func([IDL.Vec(IDL.Principal)], [], []) });

let pic, rootKey, appSubnet, icpId, tokenAId, tokenBId, nftId, dexId;
let icp, tokenA, tokenB, nft, dex;

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
const archiveActor = (id) => actorAs(pic, archiveIdl, id, admin);
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const inSeconds = async (s) => (await nowNs()) + BigInt(s) * 1_000_000_000n;
const settle = async (seconds = 5, rounds = 10) => { await pic.advanceTime(seconds * 1000); for (let i = 0; i < rounds; i++) await pic.tick(2); };
const balance = (ledger, owner, sub = null) => ledger.icrc1_balance_of(account(owner, sub));
const transfer = (ledgerId, from, to, amount) =>
  actorAs(pic, ledgerIdl, ledgerId, from).icrc1_transfer({ from_subaccount: [], to, amount, fee: [], memo: [], created_at_time: [] });
const tokenAsset = (ledger, amount) => ({ ICRC1Token: { ledger_canister_id: ledger, amount } });

/// The whole log of a Sneedex canister, verified (certificate, tree, phash chain, catalogue),
/// as plain records { i, t (btype), ...tx fields }.
const verifiedLog = async (id = dexId) => {
  const { blocks } = await verifyLog(actorAs(pic, sneedexIdl, id, admin), id, rootKey, archiveActor);
  return blocks.map((b, i) => ({ i, t: btype(b), ...plain(tx(b)) }));
};
const logLength = async (id = dexId) => Number((await actorAs(pic, sneedexIdl, id, admin).icrc3_log_status()).log_length);
const since = async (mark, id = dexId) => (await verifiedLog(id)).slice(mark);
const types = (blocks) => blocks.map((b) => b.t);
const only = (blocks, t, pred = () => true) => blocks.filter((b) => b.t === t && pred(b));
const one = (blocks, t, pred) => { const found = only(blocks, t, pred); expect(found, `${t}`).toHaveLength(1); return found[0]; };

/// One Sneedex canister as each test user.
const market = (canisterId) => {
  const m = { id: canisterId };
  for (const [name, p] of Object.entries({ alice, bob, carol, admin })) m[name] = actorAs(pic, sneedexIdl, canisterId, p);
  m.as = (p) => actorAs(pic, sneedexIdl, canisterId, p);
  m.offerState = async (id) => Object.keys((await m.bob.queryOffer(id))[0].state)[0];
  /// An active offer by alice of ICRC-1 token assets.
  m.list = async (assets, o = {}) => {
    const id = unwrap(await m.alice.createOffer({ min_bid_price: [E8], buyout_price: [], expiration: [await inSeconds(30 * DAY)], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: [], note_to_buyer: [], ...o }));
    for (const a of assets) unwrap(await m.alice.addAsset({ offer_id: id, asset: a }));
    unwrap(await m.alice.finalizeAssets(id));
    const sub = await m.bob.getOfferEscrowSubaccount(alice, id);
    for (const [i, a] of assets.entries()) {
      unwrap(await transfer(a.ICRC1Token.ledger_canister_id, alice, account(canisterId, sub), a.ICRC1Token.amount));
      unwrap(await m.alice.escrowICRC1Tokens(id, BigInt(i)));
    }
    unwrap(await m.alice.activateOffer(id));
    return id;
  };
  /// `who` deposits `deposit` (default: amount) into a new bid's escrow and confirms `amount`.
  m.bid = async (who, offerId, amount, { ledger = icpId, deposit = amount } = {}) => {
    const d = m.as(who);
    const bidId = unwrap(await d.reserveBid(offerId));
    unwrap(await transfer(ledger, who, account(canisterId, await d.getBidEscrowSubaccount(who, bidId)), deposit));
    unwrap(await d.confirmBid(bidId, amount));
    return bidId;
  };
  return m;
};

beforeAll(async () => {
  ({ pic, appSubnet, rootKey } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  tokenBId = await install(pic, { name: 'MockLedgerFaulty', initTypes: ledgerInit, initArgs: [{ fee: FEE_B, symbol: 'BBB', decimals: 8 }], targetSubnetId: appSubnet });
  nftId = await install(pic, { name: 'Icrc7Demo', initTypes: icrc7Init, initArgs: [{ name: 'Log Cats', symbol: 'LCAT', description: [], logo: [] }], targetSubnetId: appSubnet });
  dexId = await install(pic, { name: 'sneedex', initTypes: sneedexInit({ IDL }), initArgs: [[]], cycles: 60n * T, targetSubnetId: appSubnet });
  icp = actorAs(pic, ledgerIdl, icpId, admin);
  tokenA = actorAs(pic, ledgerIdl, tokenAId, admin);
  tokenB = actorAs(pic, faultyIdl, tokenBId, admin);
  nft = actorAs(pic, icrc7Idl, nftId, admin);
  dex = market(dexId);
  for (const p of [alice, bob, carol]) {
    await icp.mint(account(p), 1_000n * E8);
    await tokenA.mint(account(p), 1_000n * E8);
    await tokenB.mint(account(p), 1_000n * E8);
  }
  await pic.tick(2);
}, 180_000);
afterAll(async () => { await pic?.tearDown(); });

describe('the log of a fresh Sneedex', () => {
  it('is empty, publishes the catalogue and the standards', async () => {
    const s = await dex.bob.icrc3_log_status();
    expect(s).toMatchObject({ log_length: 0n, live_blocks: 0n, archives: [], history_imported: false, last_block_hash: [] });
    expect(await dex.bob.icrc3_get_tip_certificate()).toEqual([]);
    const supported = await dex.bob.icrc3_supported_block_types();
    expect(supported.map((t) => t.block_type).sort()).toEqual([...CATALOGUE].sort());
    expect(new Set(supported.map((t) => t.url))).toEqual(new Set([BLOCK_TYPES_URL]));
    expect((await dex.bob.icrc10_supported_standards()).map((s) => s.name)).toEqual(['ICRC-3', 'ICRC-10']);
    expect((await dex.bob.icrc3_get_blocks([{ start: 0n, length: 10n }])).blocks).toEqual([]);
  });
});

describe('a buyout with a creation fee and a marketplace cut', () => {
  afterAll(async () => {
    unwrap(await dex.admin.setOfferCreationFee(0n));
    unwrap(await dex.admin.setMarketplaceFeeRate(0n));
  });
  it('logs every step, with amounts and ledger blocks that match the ledgers', async () => {
    unwrap(await dex.admin.setOfferCreationFee(10_000_000n));
    unwrap(await dex.admin.setFeeRecipient(account(treasury)));
    unwrap(await dex.admin.setMarketplaceFeeRate(1000n)); // 10%
    const cfg = await since(0);
    expect(cfg.map((b) => [b.t, b.key, b.value, b.old_value])).toEqual([
      ['sneedex_config_update', 'offer_creation_fee_e8s', 10_000_000n, 0n],
      ['sneedex_config_update', 'fee_recipient', [P(treasury)], [P(Principal.fromText('aaaaa-aa'))]],
      ['sneedex_config_update', 'marketplace_fee_rate_bps', 1000n, 0n],
    ]);
    expect(cfg.every((b) => b.caller === P(admin))).toBe(true);

    const mark = await logLength();
    const aliceIcp0 = await balance(icp, alice); const bobA0 = await balance(tokenA, bob);
    unwrap(await transfer(icpId, alice, account(dexId, paymentSubaccount(alice)), 10_000_000n));
    const id = unwrap(await dex.alice.createOffer({ min_bid_price: [], buyout_price: [2n * E8], expiration: [], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: ['for the log'], note_to_buyer: ['a secret for the buyer'] }));
    unwrap(await dex.alice.addAsset({ offer_id: id, asset: tokenAsset(tokenAId, 100_000n) }));
    unwrap(await dex.alice.finalizeAssets(id));
    unwrap(await transfer(tokenAId, alice, account(dexId, await dex.bob.getOfferEscrowSubaccount(alice, id)), 100_000n));
    unwrap(await dex.alice.escrowICRC1Tokens(id, 0n));
    unwrap(await dex.alice.activateOffer(id));
    const bidId = await dex.bid(bob, id, 3n * E8); // capped at the buyout: 1 ICP comes back at once
    expect(await dex.offerState(id)).toBe('Completed');
    await settle(5); // auto-delivery to the buyer, auto-payment of the seller

    const blocks = await since(mark);
    expect(types(blocks).slice(0, 10)).toEqual([
      'sneedex_creation_fee_pay', 'sneedex_offer_create', 'sneedex_asset_add', 'sneedex_offer_finalize', 'sneedex_asset_escrow',
      'sneedex_offer_activate', 'sneedex_bid_reserve', 'sneedex_bid_excess_refund', 'sneedex_bid_confirm', 'sneedex_offer_complete',
    ]);
    expect(types(blocks).slice(10).sort()).toEqual(['sneedex_asset_deliver', 'sneedex_cut_pay', 'sneedex_offer_settle', 'sneedex_seller_pay']);

    const fee = one(blocks, 'sneedex_creation_fee_pay');
    expect(fee).toMatchObject({ caller: P(alice), payer: P(alice), fee_e8s: 10_000_000n, amount_e8s: 10_000_000n - ICP_FEE, to: [P(treasury)] });
    const created = one(blocks, 'sneedex_offer_create');
    expect(created).toEqual({
      i: created.i, t: 'sneedex_offer_create', caller: P(alice), offer_id: id, price_ledger: P(icpId), fee_rate_bps: 1000n, buyout: 2n * E8,
      creation_fee_e8s: 10_000_000n, creation_fee_icp_tx: fee.icp_tx,
      cut_price_tier: 'regular', price_tier: 'regular', // special prices (spec/special_prices.md)
    });
    expect(fee.price_tier).toBe('regular');
    // nothing private (note_to_buyer) and no notes at all
    expect(JSON.stringify(blocks, (_, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toMatch(/secret|for the log/);
    const asset = { type: 'icrc1', ledger: P(tokenAId), amount: 100_000n };
    expect(one(blocks, 'sneedex_asset_add')).toMatchObject({ caller: P(alice), offer_id: id, asset_index: 0n, asset });
    expect(one(blocks, 'sneedex_offer_finalize')).toMatchObject({ caller: P(alice), offer_id: id, asset_count: 1n });
    expect(one(blocks, 'sneedex_asset_escrow')).toMatchObject({ caller: P(alice), offer_id: id, asset_index: 0n, asset });
    expect(one(blocks, 'sneedex_offer_activate')).toMatchObject({ caller: P(alice), offer_id: id });
    expect(one(blocks, 'sneedex_bid_reserve')).toMatchObject({ caller: P(bob), bid_id: bidId, offer_id: id });
    expect(one(blocks, 'sneedex_bid_excess_refund')).toMatchObject({ caller: P(bob), bid_id: bidId, ledger: P(icpId), amount: E8 - ICP_FEE, to: [P(bob)], ledger_tx: expect.any(BigInt) });
    expect(one(blocks, 'sneedex_bid_confirm')).toMatchObject({ caller: P(bob), bid_id: bidId, offer_id: id, ledger: P(icpId), amount: 2n * E8 });
    expect(one(blocks, 'sneedex_offer_complete')).toMatchObject({ offer_id: id, bid_id: bidId, buyer: P(bob), price_ledger: P(icpId), amount: 2n * E8, reason: 'buyout', caller: P(bob) });
    const delivered = one(blocks, 'sneedex_asset_deliver');
    expect(delivered).toMatchObject({ offer_id: id, asset_index: 0n, asset, to: P(bob), side: 'buyer', amount: 100_000n - FEE_A, ledger_tx: expect.any(BigInt), via: 'timer' });
    expect(delivered.recovered).toBeUndefined();
    expect(delivered.caller).toBeUndefined();
    const settled = one(blocks, 'sneedex_offer_settle');
    expect(settled).toMatchObject({ offer_id: id, outcome: 'claimed', to: P(bob), via: 'timer' });
    expect(settled.i).toBeGreaterThan(delivered.i);
    const cut = one(blocks, 'sneedex_cut_pay');
    expect(cut).toMatchObject({ offer_id: id, bid_id: bidId, ledger: P(icpId), cut: 2n * E8 / 10n, amount: 2n * E8 / 10n - ICP_FEE, fee_rate_bps: 1000n, to: [P(treasury)], via: 'timer' });
    const paid = one(blocks, 'sneedex_seller_pay');
    expect(paid).toMatchObject({ offer_id: id, bid_id: bidId, seller: P(alice), ledger: P(icpId), bid_amount: 2n * E8, cut: 2n * E8 / 10n, amount: 2n * E8 - 2n * E8 / 10n - ICP_FEE, to: [P(alice)], via: 'timer' });
    expect(paid.i).toBeGreaterThan(cut.i);
    // the logged amounts are what the ledgers moved
    expect(await balance(tokenA, bob)).toBe(bobA0 + delivered.amount);
    expect(await balance(icp, alice)).toBe(aliceIcp0 - 10_000_000n - ICP_FEE + paid.amount); // her deposit of the fee cost one ledger fee
    expect(await balance(icp, treasury)).toBe(fee.amount_e8s + cut.amount);
    expect(new Set([fee.icp_tx, cut.ledger_tx, paid.ledger_tx]).size).toBe(3);
  });
});

describe('an auction', () => {
  it('logs outbid, refunded, withdrawn, abandoned and accepted bids', async () => {
    const id = await dex.list([tokenAsset(tokenAId, 50_000n)]);
    const mark = await logLength();
    const b1 = await dex.bid(bob, id, E8);
    const b2 = await dex.bid(carol, id, 2n * E8);
    // carol tops up her escrow and takes the extra back (the bid stays reserved)
    unwrap(await transfer(icpId, carol, account(dexId, await dex.carol.getBidEscrowSubaccount(carol, b2)), 50_000n));
    expect(unwrap(await dex.carol.withdrawBidEscrow(b2, 30_000n))).toEqual(expect.any(BigInt));
    const r = unwrap(await dex.bob.reserveBid(id)); // reserved, never confirmed
    await settle(3); // bob's outbid bid is refunded by the timer
    unwrap(await dex.alice.acceptBid(id));
    await settle(5);
    const blocks = await since(mark);
    expect(only(blocks, 'sneedex_bid_reserve').map((b) => b.bid_id)).toEqual([b1, b2, r]);
    expect(only(blocks, 'sneedex_bid_confirm').map((b) => [b.bid_id, b.amount])).toEqual([[b1, E8], [b2, 2n * E8]]);
    expect(one(blocks, 'sneedex_bid_lost', (b) => b.bid_id === b1)).toMatchObject({ offer_id: id, bidder: P(bob), amount: E8, escrowed: 1n, reason: 'outbid' });
    // the unconfirmed reservation becomes Lost with the offer, without a block of its own
    // (support audit 2026-10-22: one block per free reservation let spam stall completion)
    expect(only(blocks, 'sneedex_bid_lost').filter((b) => b.bid_id === r)).toEqual([]);
    expect(Object.keys((await dex.bob.queryBid(r))[0].state)[0]).toBe('Lost');
    expect(one(blocks, 'sneedex_bid_refund')).toMatchObject({ bid_id: b1, offer_id: id, bidder: P(bob), ledger: P(icpId), amount: E8 - ICP_FEE, to: [P(bob)], via: 'timer' });
    expect(one(blocks, 'sneedex_bid_escrow_withdraw')).toMatchObject({ caller: P(carol), bid_id: b2, offer_id: id, ledger: P(icpId), amount: 30_000n, to: [P(carol)] });
    expect(one(blocks, 'sneedex_offer_complete')).toMatchObject({ offer_id: id, bid_id: b2, buyer: P(carol), amount: 2n * E8, reason: 'accept', caller: P(alice) });
    expect(one(blocks, 'sneedex_asset_deliver')).toMatchObject({ offer_id: id, to: P(carol), side: 'buyer', amount: 50_000n - FEE_A });
    expect(one(blocks, 'sneedex_offer_settle')).toMatchObject({ offer_id: id, outcome: 'claimed', to: P(carol) });
    expect(one(blocks, 'sneedex_seller_pay')).toMatchObject({ bid_id: b2, cut: 0n, amount: 2n * E8 - ICP_FEE });
    expect(only(blocks, 'sneedex_cut_pay')).toEqual([]); // no cut at 0%
    expect((await dex.bob.queryBid(b1))[0].state).toEqual({ Refunded: null });
  });
});

describe('failed transfers', () => {
  it('append nothing; the retry appends the block (cancelled offer, refund and hand-back)', async () => {
    // priced in BBB, whose ledger refuses transfers to alice and bob for now
    const id = await dex.list([tokenAsset(tokenAId, 30_000n), tokenAsset(tokenBId, 40_000n)], { price_token_ledger: tokenBId });
    const bidId = await dex.bid(bob, id, 2n * E8, { ledger: tokenBId });
    await tokenB.set_fail_to([alice, bob]);
    const mark = await logLength();
    unwrap(await dex.alice.cancelOffer(id));
    await settle(5); // auto-refund and auto-reclaim run; the BBB legs fail
    let blocks = await since(mark);
    expect(one(blocks, 'sneedex_offer_cancel')).toMatchObject({ caller: P(alice), offer_id: id, from_state: 'active' });
    expect(one(blocks, 'sneedex_bid_lost')).toMatchObject({ bid_id: bidId, reason: 'offer_cancelled', escrowed: 1n, amount: 2n * E8 });
    expect(only(blocks, 'sneedex_bid_refund')).toEqual([]);
    const first = one(blocks, 'sneedex_asset_deliver');
    expect(first).toMatchObject({ offer_id: id, asset_index: 0n, side: 'seller', to: P(alice), amount: 30_000n - FEE_A, via: 'timer' });
    expect(only(blocks, 'sneedex_offer_settle')).toEqual([]);
    expect(await dex.offerState(id)).toBe('Cancelled');
    // retries while still refused: errors, no blocks
    expect(errOf(await dex.alice.reclaimAssets(id))).toHaveProperty('TransferFailed');
    expect(errOf(await dex.bob.refundBid(bidId))).toHaveProperty('TransferFailed');
    expect(await logLength()).toBe(mark + blocks.length);

    await tokenB.set_fail_to([]);
    unwrap(await dex.bob.refundBid(bidId));
    unwrap(await dex.alice.reclaimAssets(id));
    blocks = await since(mark + blocks.length);
    expect(types(blocks)).toEqual(['sneedex_bid_refund', 'sneedex_asset_deliver', 'sneedex_offer_settle']);
    expect(blocks[0]).toMatchObject({ bid_id: bidId, ledger: P(tokenBId), amount: 2n * E8 - FEE_B, to: [P(bob)], caller: P(bob) });
    expect(blocks[1]).toMatchObject({ asset_index: 1n, asset: { type: 'icrc1', ledger: P(tokenBId), amount: 40_000n }, side: 'seller', amount: 40_000n - FEE_B, caller: P(alice) });
    expect(blocks[2]).toMatchObject({ offer_id: id, outcome: 'reclaimed', to: P(alice), caller: P(alice) });
    expect(await dex.offerState(id)).toBe('Reclaimed');
  });

  it('a hand-over to the buyer that fails: only the asset that arrived is logged until the retry', async () => {
    const id = await dex.list([tokenAsset(tokenAId, 11_000n), tokenAsset(tokenBId, 12_000n)]);
    await tokenB.set_fail_to([carol]);
    const mark = await logLength();
    await dex.bid(carol, id, E8);
    unwrap(await dex.alice.acceptBid(id));
    await settle(5);
    let blocks = await since(mark);
    expect(only(blocks, 'sneedex_asset_deliver').map((b) => b.asset_index)).toEqual([0n]);
    expect(only(blocks, 'sneedex_offer_settle')).toEqual([]);
    await tokenB.set_fail_to([]);
    unwrap(await dex.carol.claimAssets(id));
    blocks = await since(mark);
    expect(only(blocks, 'sneedex_asset_deliver').map((b) => [b.asset_index, b.caller ?? b.via])).toEqual([[0n, 'timer'], [1n, P(carol)]]);
    expect(one(blocks, 'sneedex_offer_settle')).toMatchObject({ outcome: 'claimed', caller: P(carol) });
  });
});

describe('expiry', () => {
  it('by anyone (processExpiration) and by the expiration worker', async () => {
    const lonely = await dex.list([tokenAsset(tokenAId, 21_000n)], { expiration: [await inSeconds(2 * 3600)] });
    const wanted = await dex.list([tokenAsset(tokenAId, 22_000n)], { expiration: [await inSeconds(2 * 3600)] });
    const bidId = await dex.bid(bob, wanted, E8);
    const mark = await logLength();
    await settle(3 * 3600, 4);
    unwrap(await dex.carol.processExpiration(lonely));
    unwrap(await dex.admin.triggerExpirationCheck());
    await settle(5, 14); // the worker completes the offer and schedules its hand-over and payment
    await settle(5, 14); // which run now
    const blocks = await since(mark);
    expect(one(blocks, 'sneedex_offer_expire')).toMatchObject({ offer_id: lonely, caller: P(carol) });
    expect(one(blocks, 'sneedex_asset_deliver', (b) => b.offer_id === lonely)).toMatchObject({ side: 'seller', to: P(alice), via: 'timer' });
    expect(one(blocks, 'sneedex_offer_settle', (b) => b.offer_id === lonely)).toMatchObject({ outcome: 'reclaimed', via: 'timer' });
    expect(one(blocks, 'sneedex_offer_complete')).toMatchObject({ offer_id: wanted, bid_id: bidId, reason: 'expiry', via: 'timer' });
    expect(one(blocks, 'sneedex_offer_settle', (b) => b.offer_id === wanted)).toMatchObject({ outcome: 'claimed', to: P(bob) });
    expect(one(blocks, 'sneedex_seller_pay')).toMatchObject({ offer_id: wanted, via: 'timer' });
  });
});

describe('NFTs', () => {
  it('logs the NFT asset, its escrow and delivery, and the admin return of a misplaced token', async () => {
    const tid = unwrap(await nft.mint(account(alice), [['name', { Text: 'Cat' }]]));
    const id = unwrap(await dex.alice.createOffer({ min_bid_price: [], buyout_price: [E8], expiration: [], price_token_ledger: icpId, approved_bidders: [[carol]], min_bid_increment_fee_multiple: [], public_note: [], note_to_buyer: [] }));
    unwrap(await dex.alice.addAsset({ offer_id: id, asset: { ICRC7NFT: { collection_canister_id: nftId, token_ids: [tid] } } }));
    unwrap(await dex.alice.finalizeAssets(id));
    const sub = await dex.bob.getOfferEscrowSubaccount(alice, id);
    const sent = await actorAs(pic, icrc7Idl, nftId, alice).icrc7_transfer([{ from_subaccount: [], to: account(dexId, sub), token_id: tid, memo: [], created_at_time: [] }]);
    expect(sent[0][0]).toHaveProperty('Ok');
    const mark = await logLength();
    unwrap(await dex.alice.escrowICRC7NFTs(id, 0n));
    unwrap(await dex.alice.activateOffer(id));
    await dex.bid(carol, id, E8);
    await settle(5);
    // a token minted straight into Sneedex's default account belongs to no offer
    const stray = unwrap(await nft.mint(account(dexId), [['name', { Text: 'Stray' }]]));
    expect(errOf(await dex.bob.adminReturnMisplacedNft(nftId, stray, account(bob)))).toHaveProperty('NotAuthorized');
    unwrap(await dex.admin.adminReturnMisplacedNft(nftId, stray, account(bob)));
    const blocks = await since(mark);
    const asset = { type: 'icrc7', collection: P(nftId), token_ids: [tid] };
    expect(one(blocks, 'sneedex_asset_escrow')).toMatchObject({ asset, pulled: 0n });
    expect(one(blocks, 'sneedex_asset_deliver')).toMatchObject({ offer_id: id, asset, moved: 1n, to: P(carol) });
    expect(one(blocks, 'sneedex_admin_nft_return')).toMatchObject({ caller: P(admin), collection: P(nftId), token_id: stray, to: [P(bob)] });
    const created = (await verifiedLog()).find((b) => b.t === 'sneedex_offer_create' && b.offer_id === id);
    expect(created.approved_bidders).toEqual([P(carol)]); // a private offer's bidders are public anyway
  });
});

describe('admin actions and settings', () => {
  it('log config changes with old values, rescues with amounts, and nothing for refused calls', async () => {
    const mark = await logLength();
    const cfg = await dex.admin.getConfig();
    expect(await refusedAtIngress(dex.bob.updateConfig(cfg))).toBe(true); // admin tools with free-form content: refused at ingress
    expect(errOf(await dex.bob.admin_set_icrc3_settings({ max_live_blocks: [5n], spill_batch_size: [], archive_max_blocks: [], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }))).toMatch(/admins/);
    expect(errOf(await dex.bob.admin_icrc3_spill_now())).toMatch(/admins/);
    expect(errOf(await dex.bob.admin_set_icrc3_proposal_neuron([]))).toMatch(/admins/);
    expect(await logLength()).toBe(mark);

    unwrap(await dex.admin.updateConfig({ ...cfg, max_assets_per_offer: 12n }));
    unwrap(await dex.admin.updateConfig({ ...cfg, max_assets_per_offer: 12n })); // no change, no block
    unwrap(await dex.admin.addAdmin(carol));
    unwrap(await dex.admin.addAdmin(carol)); // already one
    unwrap(await dex.admin.removeAdmin(carol));
    unwrap(await dex.admin.setLedgerFeeRecipient(tokenAId, account(treasury)));
    unwrap(await dex.admin.removeLedgerFeeRecipient(tokenAId));
    unwrap(await dex.admin.removeLedgerFeeRecipient(tokenAId)); // nothing to remove
    unwrap(await dex.admin.setSneedSmsCanisterId([carol]));
    unwrap(await dex.admin.setSneedSmsCanisterId([]));
    unwrap(await dex.admin.setPremiumAuctionCutBps(50n));
    unwrap(await dex.admin.setPremiumAuctionCutBps(0n));
    unwrap(await dex.admin.setMinIncrementSettings(100n, 2000n, 500n, E8));
    unwrap(await dex.admin.setExpirationCheckInterval(600n));
    unwrap(await dex.admin.startExpirationTimer());
    unwrap(await dex.admin.stopExpirationTimer());
    unwrap(await dex.admin.stopExpirationTimer()); // not running
    const typeId = unwrap(await dex.admin.addAssetType('Test', 'a test type'));
    unwrap(await dex.admin.deactivateAssetType(typeId));
    unwrap(await dex.admin.reactivateAssetType(typeId));
    unwrap(await dex.admin.setNeuronInfoCacheStaleness(60n));
    unwrap(await dex.admin.updateConfig({ ...cfg, max_assets_per_offer: cfg.max_assets_per_offer }));
    const blocks = await since(mark);
    expect(blocks.every((b) => b.t === 'sneedex_config_update' && b.caller === P(admin))).toBe(true);
    expect(blocks.map((b) => [b.key, b.value, b.old_value])).toEqual([
      ['max_assets_per_offer', 12n, cfg.max_assets_per_offer],
      ['admin_added', P(carol), undefined],
      ['admin_removed', P(carol), undefined],
      ['ledger_fee_recipient', { ledger: P(tokenAId), account: [P(treasury)] }, undefined],
      ['ledger_fee_recipient_removed', P(tokenAId), undefined],
      ['sneed_sms_canister_id', P(carol), 'none'],
      ['sneed_sms_canister_id', 'none', P(carol)],
      ['premium_auction_cut_bps', 50n, 0n],
      ['premium_auction_cut_bps', 0n, 50n],
      ['min_increment_usd_range_max', 2000n, cfg.min_increment_usd_range_max],
      ['expiration_check_interval_seconds', 600n, 3600n],
      ['expiration_timer', 'on', undefined],
      ['expiration_timer', 'off', undefined],
      ['asset_type_added', { id: typeId, name: 'Test' }, undefined],
      ['asset_type_deactivated', typeId, undefined],
      ['asset_type_reactivated', typeId, undefined],
      ['neuron_info_cache_staleness_seconds', 60n, 3600n],
      ['max_assets_per_offer', cfg.max_assets_per_offer, 12n], // updateConfig back to the old record:
      ['min_increment_usd_range_max', cfg.min_increment_usd_range_max, 2000n], // one block per field it changes
    ]);
  });

  it('logs creation-payment withdrawals and the admin hand-back of escrowed tokens', async () => {
    const mark = await logLength();
    unwrap(await transfer(icpId, alice, account(dexId, paymentSubaccount(alice)), 7_000_000n));
    expect(unwrap(await dex.alice.withdrawOfferCreationPayment())).toBe(7_000_000n - ICP_FEE);
    const id = unwrap(await dex.alice.createOffer({ min_bid_price: [E8], buyout_price: [], expiration: [await inSeconds(30 * DAY)], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: [], note_to_buyer: [] }));
    unwrap(await dex.alice.addAsset({ offer_id: id, asset: tokenAsset(tokenAId, 40_000n) }));
    unwrap(await dex.alice.finalizeAssets(id));
    unwrap(await transfer(tokenAId, alice, account(dexId, await dex.bob.getOfferEscrowSubaccount(alice, id)), 40_000n));
    unwrap(await dex.alice.escrowICRC1Tokens(id, 0n));
    const aliceA0 = await balance(tokenA, alice);
    expect(unwrap(await dex.admin.adminReclaimStuckTokens(id))).toMatch(/Token transfer succeeded/);
    expect(await balance(tokenA, alice)).toBe(aliceA0 + 40_000n - FEE_A);
    // the escrow is empty now: a second run moves nothing and logs nothing
    unwrap(await dex.admin.adminReclaimStuckTokens(id));
    const blocks = await since(mark);
    expect(types(blocks)).toEqual(['sneedex_creation_payment_withdraw', 'sneedex_offer_create', 'sneedex_asset_add', 'sneedex_offer_finalize', 'sneedex_asset_escrow', 'sneedex_admin_asset_return']);
    expect(blocks[0]).toMatchObject({ caller: P(alice), amount_e8s: 7_000_000n - ICP_FEE, to: [P(alice)], icp_tx: expect.any(BigInt) });
    expect(blocks[5]).toMatchObject({ caller: P(admin), offer_id: id, asset_index: 0n, to: P(alice), amount: 40_000n - FEE_A, ledger_tx: expect.any(BigInt) });
  });

  it('refuses the log queries as update calls and oversized admin arguments at ingress', async () => {
    const asUpdate = ({ IDL }) => {
      const svc = sneedexIdl({ IDL });
      return IDL.Service(Object.fromEntries(svc._fields.filter(([n]) => n.startsWith('icrc3_') || n.startsWith('icrc10_')).map(([n, f]) => [n, IDL.Func(f.argTypes, f.retTypes, [])])));
    };
    const a = actorAs(pic, asUpdate, dexId, bob);
    expect((await dex.bob.icrc3_log_status()).log_length).toEqual(expect.any(BigInt)); // answered as a query
    expect(await refusedAtIngress(a.icrc3_get_blocks([{ start: 0n, length: 1n }]))).toBe(true);
    expect(await refusedAtIngress(a.icrc3_log_status())).toBe(true);
    expect(await refusedAtIngress(a.icrc3_get_tip_certificate())).toBe(true);
    expect(await refusedAtIngress(a.icrc3_registration_status())).toBe(true);
    expect(await refusedAtIngress(dex.admin.admin_set_icrc3_proposal_neuron([new Uint8Array(10_000)]))).toBe(true);
  });
});

describe('archives', () => {
  it('spill when the live store exceeds its limit, with SNS root as co-controller, and still verify', async () => {
    const before = await logLength();
    unwrap(await dex.admin.admin_set_icrc3_settings({ max_live_blocks: [5n], spill_batch_size: [10n], archive_max_blocks: [40n], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }));
    await settle(15 * 60 + 5, 100); // the 15-minute spill check
    const s = await dex.admin.icrc3_log_status();
    expect(Number(s.log_length)).toBe(before + 3); // three settings changed
    expect(s.live_blocks).toBeLessThan(5n);
    expect(s.archives.length).toBeGreaterThanOrEqual(2);
    const archives = await dex.bob.icrc3_get_archives({ from: [] });
    expect(archives.map((a) => a.canister_id.toText())).toEqual(s.archives.map((a) => a.canister_id.toText()));
    for (const a of archives) {
      const controllers = (await pic.getControllers(a.canister_id)).map((p) => p.toText()).sort();
      expect(controllers).toEqual([dexId.toText(), SNEED_SNS_ROOT.toText()].sort());
      expect((await archiveActor(a.canister_id).archive_status()).parent.toText()).toBe(dexId.toText());
    }
    const r = await dex.bob.icrc3_get_blocks([{ start: 0n, length: 3n }]);
    expect(r.blocks).toEqual([]);
    expect(r.archived_blocks).toHaveLength(1);
    expect(r.log_length).toBe(s.log_length);
    const blocks = await verifiedLog(); // follows the callbacks into every archive
    expect(blocks).toHaveLength(Number(s.log_length));
    expect(blocks.slice(-3).map((b) => b.key)).toEqual(['icrc3_max_live_blocks', 'icrc3_spill_batch_size', 'icrc3_archive_max_blocks']);
    // a forced spill moves the rest
    unwrap(await dex.admin.admin_icrc3_spill_now());
    expect((await dex.admin.icrc3_log_status()).live_blocks).toBe(0n);
    expect(await verifiedLog()).toHaveLength(Number(s.log_length));
  });

  it('registers its archives with the SNS through a hotkeyed neuron, and skips the step without one', async () => {
    const NEURON = new Uint8Array(32).fill(7);
    const archives = await dex.bob.icrc3_get_archives({ from: [] });
    let s = await dex.bob.icrc3_registration_status();
    expect(s.governance.toText()).toBe(SNEED_GOVERNANCE.toText());
    expect(s.neuron).toEqual([]);
    expect(unwrap(await dex.admin.admin_icrc3_register_archives_now())).toBe(0n); // no neuron: skipped
    const govId = await install(pic, { name: 'MockSnsGovernance', targetCanisterId: SNEED_GOVERNANCE });
    const gov = actorAs(pic, governanceIdl, govId, admin);
    await gov.add_hotkey(NEURON, dexId);
    unwrap(await dex.admin.admin_set_icrc3_proposal_neuron([NEURON]));
    const last = (await verifiedLog()).at(-1);
    expect(last).toMatchObject({ t: 'sneedex_config_update', key: 'icrc3_proposal_neuron', value: hex(NEURON), old_value: 'none' });
    expect(unwrap(await dex.admin.admin_icrc3_register_archives_now())).toBe(BigInt(archives.length));
    const proposals = await gov.list_proposals();
    expect(proposals).toHaveLength(archives.length);
    for (const p of proposals) {
      expect(p.proposer.toText()).toBe(dexId.toText());
      expect(p.title).toMatch(/^Register ICRC-3 archive .* of Sneedex$/);
      expect(p.url).toBe('https://app.sneeddao.com/api/sneedex#activity-log-icrc-3');
    }
    s = await dex.bob.icrc3_registration_status();
    expect(s.registrations.map((x) => x.proposal_id[0])).toEqual(proposals.map((p) => p.id));
    expect(unwrap(await dex.admin.admin_icrc3_register_archives_now())).toBe(0n);
    expect((await dex.admin.admin_icrc3_repair_archive_controllers()).every(([, r]) => 'Ok' in r)).toBe(true);
    unwrap(await dex.admin.admin_set_icrc3_settings({ max_live_blocks: [2000n], spill_batch_size: [500n], archive_max_blocks: [1_000_000n], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }));
  });
});

describe('upgrades', () => {
  it('keep the log, the archives and the certified tip', async () => {
    const before = await dex.admin.icrc3_log_status();
    const blocksBefore = await verifiedLog();
    await pic.upgradeCanister({ sender: admin, canisterId: dexId, wasm: wasm('sneedex'), arg: IDL.encode(sneedexInit({ IDL }), [[]]) });
    const after = await dex.admin.icrc3_log_status();
    expect(after).toEqual(before);
    expect(await verifiedLog()).toEqual(blocksBefore); // the tip certificate is republished
    const id = await dex.list([tokenAsset(tokenAId, 9_000n)]);
    const blocks = await verifiedLog();
    expect(blocks.length).toBe(blocksBefore.length + 5);
    expect(blocks.at(-1)).toMatchObject({ t: 'sneedex_offer_activate', offer_id: id });
  });

  it('from the wasm before the log keep every offer and bid and start an empty log', async () => {
    const oldId = await install(pic, { name: 'sneedex_preicrc3', initTypes: sneedexInit({ IDL }), initArgs: [[]], cycles: 20n * T, targetSubnetId: appSubnet });
    const old = market(oldId);
    // the code before the log has no log
    await expect(old.bob.icrc3_log_status()).rejects.toThrow();
    const sold = await old.list([tokenAsset(tokenAId, 13_000n)]);
    const open = await old.list([tokenAsset(tokenAId, 14_000n)]);
    const draft = unwrap(await old.alice.createOffer({ min_bid_price: [E8], buyout_price: [], expiration: [await inSeconds(30 * DAY)], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: ['hi'], note_to_buyer: ['psst'] }));
    await old.bid(bob, sold, E8);
    unwrap(await old.alice.acceptBid(sold));
    const openBid = await old.bid(carol, open, 2n * E8);
    await settle(5);
    const snapshot = async () => ({
      offers: await old.alice.getOffersByCreator(alice),
      bids: [...(await old.bob.getBidsByBidder(bob)), ...(await old.bob.getBidsByBidder(carol))],
      views: await Promise.all([sold, open, draft].map((id) => old.alice.getOfferView(id))),
      next: [await old.bob.getNextOfferId(), await old.bob.getNextBidId()],
      stats: await old.bob.getPaymentStats(),
    });
    const before = await snapshot();
    expect(before.offers).toHaveLength(3);

    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm('sneedex'), arg: IDL.encode(sneedexInit({ IDL }), [[]]) });
    expect(await snapshot()).toEqual(before);
    expect(await old.bob.icrc3_log_status()).toMatchObject({ log_length: 0n, live_blocks: 0n, archives: [], last_block_hash: [] });
    expect(await old.bob.icrc3_get_tip_certificate()).toEqual([]);

    // the first action after the upgrade is block 0, without phash; the log verifies
    unwrap(await old.alice.cancelOffer(open));
    await settle(5);
    const blocks = await verifiedLog(oldId);
    expect(blocks[0]).toMatchObject({ i: 0, t: 'sneedex_offer_cancel', offer_id: open, caller: P(alice) });
    expect(one(blocks, 'sneedex_bid_lost')).toMatchObject({ bid_id: openBid, reason: 'offer_cancelled' });
    expect(one(blocks, 'sneedex_bid_refund')).toMatchObject({ bid_id: openBid, via: 'timer' });
    expect(one(blocks, 'sneedex_offer_settle')).toMatchObject({ offer_id: open, outcome: 'reclaimed' });
  });
});
