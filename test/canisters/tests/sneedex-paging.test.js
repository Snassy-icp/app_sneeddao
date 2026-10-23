// Sneedex paging and rate limits (spec/paging_audit.md S6, S7; src/RateLimit.mo):
//  - getOfferFeed gives at most 100 offers a page whatever `length` asks (a huge length trapped on
//    preallocation; 1000, as SneedexOffers.jsx asked, returned everything), stops early before its
//    reply passes about 1.5 MB (a few hundred offers with 4,000-character notes made the reply too
//    big to send), and walks the id-ordered offers backwards instead of sorting them all;
//  - getActiveOffers / getPublicOffers / getPrivateOffersFor / getOffersByCreator give the newest 500
//    within the same reply budget, still in ascending id order;
//  - offers and bids are found by binary search, bids per offer through an index rebuilt on upgrade
//    (has_bids, getOfferView);
//  - createOffer, reserveBid, confirmBid and cancelOffer are rate limited per caller, refused at
//    ingress once the bucket is empty; the rules are admin-settable (setRateLimit, logged as a
//    sneedex_config_update block) and readable (getRateLimits);
//  - upgrades from production (sneedex_preaudit, 2cd4eb78) and from HEAD before these fixes
//    (sneedex_prepaging, what #462 installs) keep every offer, bid and view.
// SNEEDEX_WASM=sneedex_prepaging npx vitest run tests/sneedex-paging.test.js runs it against the code
// before these fixes: the fail-before run.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, wasm, account, admin, alice, bob, carol, user, T, unwrap, errOf, refusedAtIngress, ICP_LEDGER_ID } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { btype, txField } from '../lib/icrc3.js';
import { idlFactory as sneedexIdl, init as sneedexInit } from '../build/sneedex.did.js';

const SNEEDEX_WASM = process.env.SNEEDEX_WASM || 'sneedex';
const ICP_FEE = 10_000n;
const FEE_A = 1_000n;
const E8 = 100_000_000n;
const DAY = 86_400;
const BIG_NOTE = '😀'.repeat(4000); // 4,000 characters, 16,000 bytes

let pic, appSubnet, icpId, tokenAId, icp, tokenA;
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const inSeconds = async (s) => (await nowNs()) + BigInt(s) * 1_000_000_000n;
const send = (ledgerId, from, to, amount) => actorAs(pic, ledgerIdl, ledgerId, from).icrc1_transfer({ from_subaccount: [], to, amount, fee: [], memo: [], created_at_time: [] });
const initArg = () => IDL.encode(sneedexInit({ IDL }), [[]]);
const installDex = (name) => install(pic, { name, initTypes: sneedexInit({ IDL }), initArgs: [[]], cycles: 50n * T, targetSubnetId: appSubnet });

const market = (cid) => {
  const as = (p) => actorAs(pic, sneedexIdl, cid, p);
  const m = { id: cid, as };
  m.create = async (who, o = {}) => unwrap(await as(who).createOffer({ min_bid_price: [E8], buyout_price: [], expiration: [await inSeconds(30 * DAY)], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: [], note_to_buyer: [], ...o }));
  /// an active offer of 1 AAA by `who`
  m.list = async (who, o = {}) => {
    const id = await m.create(who, o);
    unwrap(await as(who).addAsset({ offer_id: id, asset: { ICRC1Token: { ledger_canister_id: tokenAId, amount: E8 } } }));
    unwrap(await as(who).finalizeAssets(id));
    unwrap(await send(tokenAId, who, account(cid, await as(who).getOfferEscrowSubaccount(who, id)), E8 + FEE_A));
    unwrap(await as(who).escrowICRC1Tokens(id, 0n));
    unwrap(await as(who).activateOffer(id));
    return id;
  };
  /// every page of the feed, as [ids per page]
  m.pages = async (who, length, filter = []) => {
    const out = [];
    let start = [];
    for (;;) {
      const r = await as(who).getOfferFeed({ start_id: start, length, filter });
      out.push(r.offers.map((o) => o.id));
      if (!r.has_more) break;
      start = r.next_start_id;
    }
    return out;
  };
  return m;
};

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  icp = actorAs(pic, ledgerIdl, icpId, admin);
  tokenA = actorAs(pic, ledgerIdl, tokenAId, admin);
  for (const p of [alice, bob, carol]) { await icp.mint(account(p), 1_000n * E8); await tokenA.mint(account(p), 1_000n * E8); }
}, 120_000);
afterAll(async () => { await pic?.tearDown(); });

describe('getOfferFeed pages', () => {
  let dex;
  const creators = Array.from({ length: 5 }, (_, i) => user(`paging-creator-${i}`));
  beforeAll(async () => {
    dex = market(await installDex(SNEEDEX_WASM));
    await Promise.all(creators.map(async (c) => { for (let i = 0; i < 26; i++) await dex.create(c); }));
  }, 300_000);

  it('at most 100 offers a page whatever length asks, newest first; next_start_id continues', async () => {
    const n = await dex.as(alice).getNextOfferId();
    expect(n).toBe(130n);
    const first = await dex.as(alice).getOfferFeed({ start_id: [], length: 1000n, filter: [] });
    expect(first.offers.length).toBe(100); // before: all 130
    expect(first.has_more).toBe(true);
    expect(first.offers.map((o) => o.id)).toEqual(Array.from({ length: 100 }, (_, i) => 129n - BigInt(i)));
    expect(first.next_start_id).toEqual([30n]);
    const second = await dex.as(alice).getOfferFeed({ start_id: first.next_start_id, length: 1000n, filter: [] });
    expect(second.offers.map((o) => o.id)).toEqual(Array.from({ length: 30 }, (_, i) => 29n - BigInt(i)));
    expect(second.has_more).toBe(false);
    // filters still apply across the walk (one creator's 26 offers: one page)
    const mine = await dex.as(alice).getOfferFeed({ start_id: [], length: 1000n, filter: [{ states: [], asset_types: [], creator: [creators[2]], has_bids: [], public_only: [], viewer: [] }] });
    expect(mine.offers.length).toBe(26);
    expect(mine.offers.every((o) => o.creator.toText() === creators[2].toText())).toBe(true);
    // a start id past the end, and a start id in the middle
    expect((await dex.as(alice).getOfferFeed({ start_id: [10_000n], length: 3n, filter: [] })).offers.map((o) => o.id)).toEqual([129n, 128n, 127n]);
    expect((await dex.as(alice).getOfferFeed({ start_id: [2n], length: 3n, filter: [] }))).toEqual({ offers: [await dex.as(alice).queryOffer(1n).then((x) => x[0]), await dex.as(alice).queryOffer(0n).then((x) => x[0])], has_more: false, next_start_id: [0n] });
  });

  it('a huge length does not trap (before: the reply buffer was preallocated)', async () => {
    const r = await dex.as(alice).getOfferFeed({ start_id: [], length: 1_000_000_000n, filter: [] });
    expect(r.offers.length).toBe(100);
  });

  it('a page ends before its reply gets too big: 210 offers with 16 KB notes page through (before: the reply could not be sent)', async () => {
    const heavy = Array.from({ length: 7 }, (_, i) => user(`paging-heavy-${i}`));
    await Promise.all(heavy.map(async (c) => { for (let i = 0; i < 30; i++) await dex.create(c, { public_note: [BIG_NOTE] }); }));
    const pages = await dex.pages(alice, 1000n);
    const ids = pages.flat();
    expect(ids.length).toBe(340);
    expect(ids).toEqual(Array.from({ length: 340 }, (_, i) => 339n - BigInt(i)));
    expect(pages[0].length).toBeLessThan(100); // cut by size, not count
    expect(pages[0].length).toBeGreaterThan(50);
  }, 300_000);
});

describe('the offer lists', () => {
  it('stay in ascending id order and keep their filters (newest 500 at most)', async () => {
    const dex = market(await installDex(SNEEDEX_WASM));
    const a = await dex.list(alice);
    const b = await dex.list(bob, { approved_bidders: [[carol]] });
    const c = await dex.create(alice);
    const d = await dex.list(alice);
    const ids = (xs) => xs.map((o) => o.id);
    expect(ids(await dex.as(carol).getActiveOffers())).toEqual([a, b, d]);
    expect(ids(await dex.as(carol).getPublicOffers())).toEqual([a, d]);
    expect(ids(await dex.as(carol).getPrivateOffersFor(carol))).toEqual([b]);
    expect(ids(await dex.as(carol).getOffersByCreator(alice))).toEqual([a, c, d]);
  });
});

describe('bids per offer', () => {
  it('has_bids and the offer views follow reservations and confirmed bids', async () => {
    const dex = market(await installDex(SNEEDEX_WASM));
    const x = await dex.list(alice);
    const y = await dex.list(alice);
    const r = unwrap(await dex.as(bob).reserveBid(x)); // a reservation counts for has_bids
    const f = (has) => [{ states: [], asset_types: [], creator: [], has_bids: [has], public_only: [], viewer: [] }];
    expect((await dex.as(carol).getOfferFeed({ start_id: [], length: 10n, filter: f(true) })).offers.map((o) => o.id)).toEqual([x]);
    expect((await dex.as(carol).getOfferFeed({ start_id: [], length: 10n, filter: f(false) })).offers.map((o) => o.id)).toEqual([y]);
    unwrap(await send(icpId, bob, account(dex.id, await dex.as(bob).getBidEscrowSubaccount(bob, r)), 2n * E8));
    unwrap(await dex.as(bob).confirmBid(r, 2n * E8));
    const v = (await dex.as(carol).getOfferView(x))[0];
    expect(v.bids.map((b) => b.id)).toEqual([r]);
    expect(v.highest_bid[0].amount).toBe(2n * E8);
    expect((await dex.as(carol).getOfferView(y))[0].bids).toEqual([]);
  });
});

describe('rate limits', () => {
  let dex;
  const spammer = user('paging-spammer');
  beforeAll(async () => { dex = market(await installDex(SNEEDEX_WASM)); await icp.mint(account(spammer), 100n * E8); });
  const rules = async () => Object.fromEntries(await dex.as(admin).getRateLimits());

  it('getRateLimits: generous defaults', async () => {
    expect(await rules()).toEqual({
      createOffer: { capacity: 100n, per_minute: 20n },
      createOffer_premium: { capacity: 200n, per_minute: 40n },
      reserveBid: { capacity: 60n, per_minute: 20n },
      confirmBid: { capacity: 60n, per_minute: 20n },
      cancelOffer: { capacity: 100n, per_minute: 20n },
    });
  });

  it('a spammer gets 100 offers, then is refused at ingress; a normal user is not; a minute refills 20', async () => {
    for (let i = 0; i < 100; i++) await dex.create(spammer);
    expect(await refusedAtIngress(dex.create(spammer))).toBe(true);
    await dex.create(bob);
    await pic.advanceTime(60_000); await pic.tick();
    for (let i = 0; i < 20; i++) await dex.create(spammer);
    expect(await refusedAtIngress(dex.create(spammer))).toBe(true);
  });

  it('setRateLimit: admins only, known actions only, logged; reserveBid, confirmBid and cancelOffer are limited too', async () => {
    expect(errOf(await dex.as(spammer).setRateLimit('createOffer', [{ capacity: 1000n, per_minute: 1000n }]))).toHaveProperty('NotAuthorized');
    expect(errOf(await dex.as(admin).setRateLimit('addAsset', [{ capacity: 1n, per_minute: 1n }]))).toHaveProperty('InvalidInput');
    expect(errOf(await dex.as(admin).setRateLimit('reserveBid', [{ capacity: 3n, per_minute: 0n }]))).toHaveProperty('InvalidInput');
    unwrap(await dex.as(admin).setRateLimit('reserveBid', [{ capacity: 3n, per_minute: 1n }]));
    const s = await dex.as(admin).icrc3_log_status();
    const [block] = (await dex.as(admin).icrc3_get_blocks([{ start: s.log_length - 1n, length: 1n }])).blocks.map((b) => b.block);
    expect(btype(block)).toBe('sneedex_config_update');
    expect(txField(block, 'key')).toEqual({ Text: 'rate_limit.reserveBid' });
    expect(txField(block, 'value')).toEqual({ Map: [['capacity', { Nat: 3n }], ['per_minute', { Nat: 1n }]] });
    expect(txField(block, 'old_value')).toEqual({ Map: [['capacity', { Nat: 60n }], ['per_minute', { Nat: 20n }]] });
    const offer = await dex.list(alice);
    for (let i = 0; i < 3; i++) unwrap(await dex.as(spammer).reserveBid(offer));
    expect(await refusedAtIngress(dex.as(spammer).reserveBid(offer))).toBe(true);
    unwrap(await dex.as(bob).reserveBid(offer)); // others are not affected
    unwrap(await dex.as(admin).setRateLimit('confirmBid', [{ capacity: 2n, per_minute: 1n }]));
    expect(errOf(await dex.as(spammer).confirmBid(999_999n, 1n))).toHaveProperty('BidNotFound');
    expect(errOf(await dex.as(spammer).confirmBid(999_999n, 1n))).toHaveProperty('BidNotFound');
    expect(await refusedAtIngress(dex.as(spammer).confirmBid(999_999n, 1n))).toBe(true);
    unwrap(await dex.as(admin).setRateLimit('cancelOffer', [{ capacity: 2n, per_minute: 1n }]));
    await pic.advanceTime(120_000); await pic.tick();
    const drafts = [await dex.create(spammer), await dex.create(spammer), await dex.create(spammer)];
    unwrap(await dex.as(spammer).cancelOffer(drafts[0]));
    unwrap(await dex.as(spammer).cancelOffer(drafts[1]));
    expect(await refusedAtIngress(dex.as(spammer).cancelOffer(drafts[2]))).toBe(true);
    // capacity 0 = no limit; null = back to the default
    unwrap(await dex.as(admin).setRateLimit('cancelOffer', [{ capacity: 0n, per_minute: 0n }]));
    unwrap(await dex.as(spammer).cancelOffer(drafts[2]));
    for (const a of ['reserveBid', 'confirmBid', 'cancelOffer']) unwrap(await dex.as(admin).setRateLimit(a, []));
    expect((await rules()).reserveBid).toEqual({ capacity: 60n, per_minute: 20n });
  });

  it('the rules are kept across an upgrade', async () => {
    unwrap(await dex.as(admin).setRateLimit('createOffer', [{ capacity: 5n, per_minute: 2n }]));
    await pic.upgradeCanister({ sender: admin, canisterId: dex.id, wasm: wasm(SNEEDEX_WASM), arg: initArg() });
    await pic.tick(2);
    expect((await rules()).createOffer).toEqual({ capacity: 5n, per_minute: 2n });
  });
});

describe('Premium members get the higher createOffer limit', () => {
  const member = user('paging-premium-member');
  const lapsed = user('paging-premium-lapsed');
  let dex, premium;
  const premiumIdl = ({ IDL }) => IDL.Service({ set_member: IDL.Func([IDL.Principal, IDL.Int], [], []) });
  beforeAll(async () => {
    dex = market(await installDex(SNEEDEX_WASM));
    const premiumId = await install(pic, { name: 'MockPremium', targetSubnetId: appSubnet });
    premium = actorAs(pic, premiumIdl, premiumId, admin);
    await premium.set_member(member, await inSeconds(DAY));
    await premium.set_member(lapsed, await inSeconds(60)); // runs out in a minute
    unwrap(await dex.as(admin).setSneedPremiumCanisterId([premiumId]));
  });

  it('a member gets 200 offers before ingress refuses; a regular user 100', async () => {
    for (let i = 0; i < 200; i++) await dex.create(member);
    expect(await refusedAtIngress(dex.create(member))).toBe(true);
    for (let i = 0; i < 100; i++) await dex.create(bob);
    expect(await refusedAtIngress(dex.create(bob))).toBe(true);
  });

  it('the cached membership never outlasts the membership: after it ends, the regular rule applies', async () => {
    await dex.create(lapsed); // caches the membership (ends in a minute)
    await pic.advanceTime(120_000); await pic.tick();
    for (let i = 0; i < 100; i++) await dex.create(lapsed); // capped back to the regular 100
    expect(await refusedAtIngress(dex.create(lapsed))).toBe(true);
  });
});

describe('upgrades keep every offer, bid and view', () => {
  for (const from of ['sneedex_preaudit', 'sneedex_prepaging']) {
    it(`from ${from}`, async () => {
      const dex = market(await installDex(from));
      const x = await dex.list(alice);
      const y = await dex.list(bob, { approved_bidders: [[carol]], public_note: ['hello'], note_to_buyer: ['secret'] });
      await dex.create(carol);
      const r1 = unwrap(await dex.as(carol).reserveBid(x));
      unwrap(await send(icpId, carol, account(dex.id, await dex.as(carol).getBidEscrowSubaccount(carol, r1)), 2n * E8));
      unwrap(await dex.as(carol).confirmBid(r1, 2n * E8));
      unwrap(await dex.as(bob).reserveBid(x));
      unwrap(await dex.as(carol).reserveBid(y));
      const snapshot = async () => ({
        feed: await dex.as(bob).getOfferFeed({ start_id: [], length: 100n, filter: [] }),
        views: [await dex.as(bob).getOfferView(x), await dex.as(bob).getOfferView(y), await dex.as(carol).getOfferView(y)],
        bids: [await dex.as(carol).getBidsByBidderAll(carol), await dex.as(bob).getBidsByBidderAll(bob)],
        withBids: await dex.as(bob).getOfferFeed({ start_id: [], length: 100n, filter: [{ states: [], asset_types: [], creator: [], has_bids: [true], public_only: [], viewer: [] }] }),
        active: await dex.as(carol).getActiveOffers(),
        stats: await dex.as(bob).getMarketStats(),
      });
      const before = await snapshot();
      expect(before.withBids.offers.map((o) => o.id)).toEqual([y, x]);
      await pic.upgradeCanister({ sender: admin, canisterId: dex.id, wasm: wasm('sneedex'), arg: initArg() });
      await pic.tick(2);
      expect(await snapshot()).toEqual(before);
      // the bid index goes on from there
      const z = await dex.list(carol);
      unwrap(await dex.as(alice).reserveBid(z));
      expect((await dex.as(bob).getOfferFeed({ start_id: [], length: 100n, filter: [{ states: [], asset_types: [], creator: [], has_bids: [true], public_only: [], viewer: [] }] })).offers.map((o) => o.id)).toEqual([z, y, x]);
      expect((await dex.as(admin).getRateLimits()).length).toBe(5);
    }, 120_000);
  }
});
