// Sneed Hub pockets against real canisters on PocketIC (spec/programmable_accounts.md §4.2, §4.7,
// §4.8): the frontend's adapter modules (src/app_sneeddao_frontend/src/utils/pockets/adapters/)
// run with a context whose actors are PocketIC actors, so every call is the real one.
//   - wallet: balances and a transfer from a numbered pocket;
//   - sneed_lock: the Sneed Lock wallet as a pocket (balance, locked, withdrawable = balance -
//     locked - fee, deposit, withdraw);
//   - sneedex: the offer-creation payment and bid escrows with the confirmation rules (all before
//     confirmation, only the excess after, nothing from a won bid), funding a bid from a pocket;
//   - icpswap: a mock pool's unused balance (getUserUnusedBalance / withdraw);
//   - sneed_mon and sneed_notifications balances (deposit, top-up, withdraw);
//   - a failing or slow adapter doesn't fail the model;
//   - the registry and NamingService's account calls (with their localStorage mirror) against
//     sneed_pid_nicknames, and discovery through an index (a stand-in for index-ng's list_subaccounts).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, account, principalToSubaccount, admin, alice, bob, carol, user, ICP_LEDGER_ID, T, unwrap } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { idlFactory as sneedLockIdl } from '../build/sneed_lock.did.js';
import { idlFactory as sneedexIdl, init as sneedexInit } from '../build/sneedex.did.js';
import { idlFactory as monIdl } from '../build/sneed_mon.did.js';
import { idlFactory as notifIdl } from '../build/sneed_notifications.did.js';
import { idlFactory as pidNicknamesIdl } from '../build/sneed_pid_nicknames.did.js';

// localStorage, as in a browser (the NamingService mirror, remembered ICPSwap pools)
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const ICP_FEE = 10_000n;
const FEE_A = 1_000n;
const E8 = 100_000_000n;
const DAY = 86_400;

const PoolError = IDL.Variant({ CommonError: IDL.Null, InternalError: IDL.Text, UnsupportedToken: IDL.Text, InsufficientFunds: IDL.Null });
const dexPoolIdl = ({ IDL }) => IDL.Service({
  metadata: IDL.Func([], [IDL.Variant({ ok: IDL.Record({ token0: IDL.Record({ address: IDL.Text, standard: IDL.Text }), token1: IDL.Record({ address: IDL.Text, standard: IDL.Text }), fee: IDL.Nat }), err: PoolError })], ['query']),
  getUserUnusedBalance: IDL.Func([IDL.Principal], [IDL.Variant({ ok: IDL.Record({ balance0: IDL.Nat, balance1: IDL.Nat }), err: PoolError })], ['query']),
  getUserPositionIdsByPrincipal: IDL.Func([IDL.Principal], [IDL.Variant({ ok: IDL.Vec(IDL.Nat), err: PoolError })], ['query']),
  deposit: IDL.Func([IDL.Record({ token: IDL.Text, amount: IDL.Nat, fee: IDL.Nat })], [IDL.Variant({ ok: IDL.Nat, err: PoolError })], []),
  withdraw: IDL.Func([IDL.Record({ token: IDL.Text, amount: IDL.Nat, fee: IDL.Nat })], [IDL.Variant({ ok: IDL.Nat, err: PoolError })], []),
});
const dexPoolInit = [IDL.Record({ token0: IDL.Principal, token1: IDL.Principal })];

let pic, appSubnet, icpId, tokenAId, lockId, dexId, monId, notifId, poolId, nickId;
let A, M, S, D, R, NS, MODEL;
const P = (t) => (typeof t === 'string' ? Principal.fromText(t) : t);
const icpAs = (p) => actorAs(pic, ledgerIdl, icpId, p);
const tokenAAs = (p) => actorAs(pic, ledgerIdl, tokenAId, p);
const bal = (ledger, owner, sub = null) => actorAs(pic, ledgerIdl, ledger, admin).icrc1_balance_of(account(owner, sub));
const numbered = (n) => S.numberToSubaccount(n);
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const settle = async (seconds = 5, rounds = 10) => { await pic.advanceTime(seconds * 1000); for (let i = 0; i < rounds; i++) await pic.tick(2); };

const IDLS = () => ({ ledger: ledgerIdl, sneed_lock: sneedLockIdl, sneedex: sneedexIdl, sneed_mon: monIdl, sneed_notifications: notifIdl, icpswap_pool: dexPoolIdl });
/// The adapters' context as `who`, with PocketIC actors. `extra.actor` overrides kinds (fakes).
function ctxFor(who, extra = {}) {
  const idls = IDLS();
  const fees = new Map([[icpId.toText(), { fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], [tokenAId.toText(), { fee: FEE_A, symbol: 'AAA', decimals: 8 }]]);
  return {
    identity: { getPrincipal: () => who },
    me: who,
    actor: (kind, id) => (extra.actors?.[kind] ? extra.actors[kind](id) : actorAs(pic, idls[kind], P(typeof id === 'string' ? id : id.toText()), who)),
    canisterIds: { sneed_lock: lockId, sneedex: dexId, sneed_mon: monId, sneed_notifications: notifId, icp_ledger: icpId },
    ledgerMeta: async (l) => fees.get(l) || null,
    swapCanisters: async () => [poolId],
    flags: {},
    ...extra.ctx,
  };
}

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  lockId = await install(pic, { name: 'sneed_lock', cycles: 20n * T, targetSubnetId: appSubnet });
  dexId = await install(pic, { name: 'sneedex', initTypes: sneedexInit({ IDL }), initArgs: [[]], cycles: 50n * T, targetSubnetId: appSubnet });
  monId = await install(pic, { name: 'sneed_mon', targetSubnetId: appSubnet });
  notifId = await install(pic, { name: 'sneed_notifications', targetSubnetId: appSubnet });
  poolId = await install(pic, { name: 'MockDexPool', initTypes: dexPoolInit, initArgs: [{ token0: tokenAId, token1: icpId }], targetSubnetId: appSubnet });
  nickId = await install(pic, { name: 'sneed_pid_nicknames', cycles: 20n * T, targetSubnetId: appSubnet });
  await pic.tick(2);
  const base = '../../../src/app_sneeddao_frontend/src/utils';
  A = await import(`${base}/pockets/adapters/index.js`);
  M = await import(`${base}/pockets/model.js`);
  S = await import(`${base}/pockets/subaccount.js`);
  D = await import(`${base}/pockets/discovery.js`);
  R = await import(`${base}/pockets/registry.js`);
  NS = await import(`${base}/NamingService.js`);
  MODEL = M;
  NS.setActorsForTest({ pidNicknames: (identity) => actorAs(pic, pidNicknamesIdl, nickId, identity ? identity.getPrincipal() : Principal.anonymous()) });
  for (const p of [alice, bob, carol]) {
    await icpAs(admin).mint(account(p), 100n * E8);
    await tokenAAs(admin).mint(account(p), 1_000n * E8);
  }
}, 240_000);
afterAll(async () => { await pic?.tearDown(); });

describe('wallet adapter', () => {
  it('reads and sends from a numbered pocket (the pocket pays the fee)', async () => {
    const ctx = ctxFor(bob);
    unwrap(await tokenAAs(bob).icrc1_transfer({ from_subaccount: [], to: account(bob, numbered(1)), amount: 50_000n, fee: [], memo: [], created_at_time: [] }));
    const p1 = M.walletPocket(bob, numbered(1));
    expect(await A.walletAdapter.balance(ctx, p1, tokenAId.toText())).toEqual({ total: 50_000n, available: 50_000n });
    expect((await A.walletAdapter.rules(ctx, p1, tokenAId.toText())).withdrawable).toBe(49_000n);
    const block = await A.walletAdapter.send(ctx, p1, tokenAId.toText(), 20_000n, { owner: carol, subaccount: numbered(2) });
    expect(typeof block).toBe('bigint');
    expect(await bal(tokenAId, bob, numbered(1))).toBe(50_000n - 20_000n - FEE_A);
    expect(await bal(tokenAId, carol, numbered(2))).toBe(20_000n);
    await expect(A.walletAdapter.send(ctx, p1, tokenAId.toText(), 1_000_000n, { owner: carol, subaccount: null })).rejects.toThrow(/insufficient funds/);
    // Main is the default account
    expect((await A.walletAdapter.balance(ctx, M.walletPocket(bob), tokenAId.toText())).total).toBe(await bal(tokenAId, bob));
  });
});

describe('sneed_lock adapter', () => {
  it('the Sneed Lock wallet: balance, locked, withdrawable = balance - locked - fee, deposit and withdraw', async () => {
    const ctx = ctxFor(alice);
    const [item] = await A.sneedLockAdapter.listMyAccounts(ctx);
    expect(item.hostKey).toBe('wallet');
    expect(S.toBytes(item.account.subaccount)).toEqual(principalToSubaccount(alice));
    const pocket = M.adapterPocket(A.sneedLockAdapter, item);
    expect(pocket.caps).toMatchObject({ receive: true, deposit: true, withdraw: true });
    // deposit from Main, then lock part of it
    await A.sneedLockAdapter.deposit(ctx, pocket, tokenAId.toText(), 100_000n, null);
    expect(await bal(tokenAId, lockId, principalToSubaccount(alice))).toBe(100_000n);
    const expiry = (await nowNs()) + 3_600n * 1_000_000_000n;
    unwrap(await actorAs(pic, sneedLockIdl, lockId, alice).create_lock(60_000n, tokenAId, expiry, []));
    const ctx2 = ctxFor(alice); // a fresh read (summed locks are read once per context)
    const b = await A.sneedLockAdapter.balance(ctx2, pocket, tokenAId.toText());
    expect(b).toMatchObject({ total: 100_000n, available: 40_000n, locked: 60_000n });
    const rules = await A.sneedLockAdapter.rules(ctx2, pocket, tokenAId.toText());
    expect(rules.withdrawable).toBe(100_000n - 60_000n - FEE_A);
    expect(rules.why).toMatch(/locked/);
    // withdraw to a numbered wallet pocket; more than allowed is refused by sneed_lock
    await expect(A.sneedLockAdapter.withdraw(ctx2, pocket, tokenAId.toText(), rules.withdrawable + 1n, { owner: alice, subaccount: numbered(4) })).rejects.toThrow(/Sneed Lock refused/);
    await A.sneedLockAdapter.withdraw(ctx2, pocket, tokenAId.toText(), rules.withdrawable, { owner: alice, subaccount: numbered(4) });
    expect(await bal(tokenAId, alice, numbered(4))).toBe(rules.withdrawable);
    expect(await bal(tokenAId, lockId, principalToSubaccount(alice))).toBe(60_000n);
    expect((await A.sneedLockAdapter.rules(ctxFor(alice), pocket, tokenAId.toText())).withdrawable).toBe(0n);
  });
});

describe('sneedex adapter', () => {
  const dexAs = (p) => actorAs(pic, sneedexIdl, dexId, p);
  /// An active offer of 1,000 AAA by alice, priced in ICP.
  async function listTokens(o = {}) {
    const d = dexAs(alice);
    const id = unwrap(await d.createOffer({ min_bid_price: [E8], buyout_price: [], expiration: [(await nowNs()) + BigInt(30 * DAY) * 1_000_000_000n], price_token_ledger: icpId, approved_bidders: [], min_bid_increment_fee_multiple: [], public_note: [], note_to_buyer: [], ...o }));
    unwrap(await d.addAsset({ offer_id: id, asset: { ICRC1Token: { ledger_canister_id: tokenAId, amount: 1_000n } } }));
    unwrap(await d.finalizeAssets(id));
    unwrap(await tokenAAs(alice).icrc1_transfer({ from_subaccount: [], to: account(dexId, await d.getOfferEscrowSubaccount(alice, id)), amount: 1_000n, fee: [], memo: [], created_at_time: [] }));
    unwrap(await d.escrowICRC1Tokens(id, 0n));
    unwrap(await d.activateOffer(id));
    return id;
  }

  it('the offer-creation payment: everything less one fee comes back to Main', async () => {
    const ctx = ctxFor(carol);
    const items = await A.sneedexAdapter.listMyAccounts(ctx);
    const pay = items.find((i) => i.hostKey === 'payment');
    const pocket = M.adapterPocket(A.sneedexAdapter, pay);
    expect(pocket.caps.withdrawTo).toBe('main');
    await A.sneedexAdapter.deposit(ctx, pocket, icpId.toText(), 50_000n, null);
    expect(await A.sneedexAdapter.balance(ctx, pocket, icpId.toText())).toEqual({ total: 50_000n, available: 50_000n });
    const rules = await A.sneedexAdapter.rules(ctx, pocket, icpId.toText());
    expect(rules).toMatchObject({ withdrawable: 40_000n, allOnly: true });
    const before = await bal(icpId, carol);
    expect(await A.sneedexAdapter.withdraw(ctx, pocket, icpId.toText(), 40_000n)).toBe(40_000n);
    expect(await bal(icpId, carol)).toBe(before + 40_000n);
  });

  it('bid escrows: all before confirmation, only the excess after, funded from a pocket', async () => {
    const offerId = await listTokens();
    const d = dexAs(bob);
    const bidId = unwrap(await d.reserveBid(offerId));
    // fund the escrow from pocket #3 through the adapter
    unwrap(await icpAs(bob).icrc1_transfer({ from_subaccount: [], to: account(bob, numbered(3)), amount: 5n * E8, fee: [], memo: [], created_at_time: [] }));
    let ctx = ctxFor(bob);
    let items = await A.sneedexAdapter.listMyAccounts(ctx);
    const item = items.find((i) => i.hostKey === `bid:${bidId}`);
    expect(item.label).toBe(`Sneedex bid ${bidId}`);
    expect(item.ledgers).toEqual([icpId.toText()]);
    let pocket = M.adapterPocket(A.sneedexAdapter, item);
    await A.sneedexAdapter.deposit(ctx, pocket, icpId.toText(), 3n * E8, numbered(3));
    expect(await bal(icpId, bob, numbered(3))).toBe(5n * E8 - 3n * E8 - ICP_FEE);
    // unconfirmed: everything but the withdrawal's fee
    expect((await A.sneedexAdapter.rules(ctx, pocket, icpId.toText())).withdrawable).toBe(3n * E8 - ICP_FEE);
    unwrap(await d.confirmBid(bidId, 2n * E8));
    // confirming refunds what is above the bid: nothing left to withdraw
    ctx = ctxFor(bob);
    pocket = M.adapterPocket(A.sneedexAdapter, (await A.sneedexAdapter.listMyAccounts(ctx)).find((i) => i.hostKey === `bid:${bidId}`));
    expect(await bal(icpId, dexId, S.toBytes(pocket.account.subaccount))).toBe(2n * E8);
    expect((await A.sneedexAdapter.rules(ctx, pocket, icpId.toText())).withdrawable).toBe(0n);
    // money sent in after confirmation: only that excess can leave
    await A.sneedexAdapter.deposit(ctx, pocket, icpId.toText(), E8, numbered(3));
    const rules = await A.sneedexAdapter.rules(ctx, pocket, icpId.toText());
    // balance 3 ICP; the bid (2 ICP) stays; the withdrawal pays one fee
    expect(rules.withdrawable).toBe(3n * E8 - 2n * E8 - ICP_FEE);
    expect(rules.why).toMatch(/stays in escrow/);
    // more than the excess is refused by Sneedex itself (the adapter's rule is the canister's)
    await expect(A.sneedexAdapter.withdraw(ctx, pocket, icpId.toText(), rules.withdrawable + 1n)).rejects.toThrow(/Sneedex refused/);
    const before = await bal(icpId, bob);
    await A.sneedexAdapter.withdraw(ctx, pocket, icpId.toText(), rules.withdrawable);
    expect(await bal(icpId, bob)).toBe(before + rules.withdrawable);
    expect((await A.sneedexAdapter.rules(ctxFor(bob), pocket, icpId.toText())).withdrawable).toBe(0n);
  });

  it('a won bid: nothing can leave', async () => {
    const offerId = await listTokens({ buyout_price: [2n * E8] });
    const d = dexAs(bob);
    const bidId = unwrap(await d.reserveBid(offerId));
    unwrap(await icpAs(bob).icrc1_transfer({ from_subaccount: [], to: account(dexId, await d.getBidEscrowSubaccount(bob, bidId)), amount: 3n * E8, fee: [], memo: [], created_at_time: [] }));
    unwrap(await d.confirmBid(bidId, 2n * E8));
    const ctx = ctxFor(bob);
    const item = (await A.sneedexAdapter.listMyAccounts(ctx)).find((i) => i.hostKey === `bid:${bidId}`);
    expect(Object.keys(item.meta.bid.state)[0]).toBe('Won');
    const pocket = M.adapterPocket(A.sneedexAdapter, item);
    const rules = await A.sneedexAdapter.rules(ctx, pocket, icpId.toText());
    expect(rules.withdrawable).toBe(0n);
    expect(rules.why).toMatch(/won bid/);
    await settle(4);
  });
});

describe('icpswap adapter', () => {
  it('a pool\'s unused balance as a pocket: listed, read, withdrawn to Main', async () => {
    const pool = actorAs(pic, dexPoolIdl, poolId, alice);
    unwrap(await tokenAAs(alice).icrc1_transfer({ from_subaccount: [], to: account(poolId, principalToSubaccount(alice)), amount: 200_000n, fee: [], memo: [], created_at_time: [] }));
    expect(unwrap(await pool.deposit({ token: tokenAId.toText(), amount: 200_000n, fee: FEE_A }))).toBe(199_000n);
    const ctx = ctxFor(alice);
    const items = await A.icpswapAdapter.listMyAccounts(ctx);
    expect(items.map((i) => [i.hostKey, i.label, i.ledgers])).toEqual([[poolId.toText(), 'ICPSwap AAA/ICP', [tokenAId.toText(), icpId.toText()]]]);
    const pocket = M.adapterPocket(A.icpswapAdapter, items[0]);
    expect(pocket.account).toBe(null);
    expect(pocket.caps).toMatchObject({ receive: false, deposit: false, withdraw: true, withdrawTo: 'main' });
    expect(await A.icpswapAdapter.balance(ctx, pocket, tokenAId.toText())).toEqual({ total: 199_000n, available: 199_000n });
    expect((await A.icpswapAdapter.balance(ctx, pocket, icpId.toText())).total).toBe(0n);
    const rules = await A.icpswapAdapter.rules(ctx, pocket, tokenAId.toText());
    expect(rules.withdrawable).toBe(198_000n);
    const before = await bal(tokenAId, alice);
    expect(await A.icpswapAdapter.withdraw(ctx, pocket, tokenAId.toText(), rules.withdrawable)).toBe(198_000n);
    expect(await bal(tokenAId, alice)).toBe(before + 198_000n);
    // nothing left: the pool no longer lists as a pocket
    expect(await A.icpswapAdapter.listMyAccounts(ctxFor(alice))).toEqual([]);
    // the swap UI's pools are remembered
    const { rememberPool, rememberedPools } = await import('../../../src/app_sneeddao_frontend/src/utils/pockets/adapters/icpswap.js');
    rememberPool(poolId);
    rememberPool(poolId.toText());
    expect(rememberedPools()).toEqual([poolId.toText()]);
  });
});

describe('service balances', () => {
  it('sneed_mon: deposit from a pocket (credited less one fee), balance, withdraw to a pocket', async () => {
    unwrap(await icpAs(carol).icrc1_transfer({ from_subaccount: [], to: account(carol, numbered(1)), amount: E8, fee: [], memo: [], created_at_time: [] }));
    const ctx = ctxFor(carol);
    const [item] = await A.sneedMonAdapter.listMyAccounts(ctx);
    const pocket = M.adapterPocket(A.sneedMonAdapter, item);
    expect(pocket.kind).toBe('service');
    expect(pocket.id).toBe('s:sneed_mon:balance');
    await A.sneedMonAdapter.deposit(ctx, pocket, icpId.toText(), 50_000_000n, numbered(1));
    const b = await A.sneedMonAdapter.balance(ctx, pocket, icpId.toText());
    expect(b.total).toBe(50_000_000n - ICP_FEE);
    expect((await A.sneedMonAdapter.balance(ctx, pocket, tokenAId.toText())).total).toBe(0n);
    const rules = await A.sneedMonAdapter.rules(ctx, pocket, icpId.toText());
    expect(rules.withdrawable).toBe(b.total - ICP_FEE);
    await A.sneedMonAdapter.withdraw(ctx, pocket, icpId.toText(), 1_000_000n, { owner: carol, subaccount: numbered(2) });
    expect(await bal(icpId, carol, numbered(2))).toBe(1_000_000n);
    expect((await A.sneedMonAdapter.balance(ctx, pocket, icpId.toText())).total).toBe(b.total - 1_000_000n - ICP_FEE);
  });

  it('sneed_notifications: top-up from Main by approval, no withdraw', async () => {
    const ctx = ctxFor(carol);
    const [item] = await A.sneedNotificationsAdapter.listMyAccounts(ctx);
    const pocket = M.adapterPocket(A.sneedNotificationsAdapter, item);
    expect(pocket.caps).toMatchObject({ deposit: true, withdraw: false, readOnly: true });
    expect((await A.sneedNotificationsAdapter.balance(ctx, pocket, icpId.toText())).total).toBe(0n);
    await expect(A.sneedNotificationsAdapter.deposit(ctx, pocket, icpId.toText(), 500_000n, numbered(1))).rejects.toThrow(/from Main only/);
    await A.sneedNotificationsAdapter.deposit(ctx, pocket, icpId.toText(), 500_000n, null);
    const b = await A.sneedNotificationsAdapter.balance(ctx, pocket, icpId.toText());
    expect(b.total).toBe(500_000n);
    expect(b.note).toMatch(/cannot be withdrawn/);
    expect((await A.sneedNotificationsAdapter.rules(ctx, pocket, icpId.toText())).withdrawable).toBe(0n);
  });
});

describe('the runner: a failing adapter never fails the model', () => {
  it('lists, reads and merges around a throwing and a slow adapter; taco stays off without its flag', async () => {
    const ctx = ctxFor(alice);
    const broken = { id: 'broken', name: 'Broken host', kind: 'hosted', listMyAccounts: async () => { throw new Error('boom'); } };
    const slow = { id: 'slow', name: 'Slow host', kind: 'hosted', listMyAccounts: () => new Promise(() => {}) };
    expect(A.enabledAdapters(ctx).map((a) => a.id)).toEqual(['sneed_lock', 'sneedex', 'icpswap', 'sneed_mon', 'sneed_notifications']);
    expect(A.enabledAdapters({ ...ctx, flags: { taco: true } }).map((a) => a.id)).toContain('taco');
    const hosted = await A.listHosted(ctx, { adapters: [A.sneedLockAdapter, broken, slow, A.sneedMonAdapter], timeoutMs: 1_000 });
    expect(hosted.map((h) => [h.adapter.id, h.error ? String(h.error.message) : h.items.length])).toEqual([['sneed_lock', 1], ['broken', 'boom'], ['slow', 'Slow host timed out'], ['sneed_mon', 1]]);
    let ps = M.mergePockets({ me: alice, hosted });
    const ledgers = [tokenAId.toText(), icpId.toText()];
    const read = await A.readBalances(ctx, ps, ledgers, { timeoutMs: 5_000 });
    ps = M.mergePockets({ me: alice, hosted, balances: A.okBalances(read) });
    const byId = Object.fromEntries(ps.map((p) => [p.id, p]));
    expect(byId['h:broken:*'].status).toBe('error');
    expect(byId['h:slow:*'].error).toMatch(/timed out/);
    expect(M.totalIn(byId['h:sneed_lock:wallet'], tokenAId.toText())).toBe(60_000n); // the lock from the sneed_lock test
    expect(M.total(ps, tokenAId.toText())).toBe((await bal(tokenAId, alice)) + 60_000n);
    expect(read.has('h:broken:*')).toBe(false);
    // a balance read that fails is an error entry for that ledger only
    const flaky = { ...ctx, actor: (kind, id) => (kind === 'ledger' && id === icpId.toText() ? { icrc1_balance_of: async () => { throw new Error('ledger down'); } } : ctx.actor(kind, id)) };
    const read2 = await A.readBalances(flaky, [M.walletPocket(alice)], ledgers);
    expect(read2.get('w:0').get(icpId.toText())).toEqual({ error: 'ledger down' });
    expect(read2.get('w:0').get(tokenAId.toText()).total).toBe(await bal(tokenAId, alice));
    // the plan behind "Move"
    const lockP = byId['h:sneed_lock:wallet'];
    expect(A.movePlan(M.walletPocket(alice), M.walletPocket(alice, numbered(1))).map((s) => s.step)).toEqual(['send']);
    expect(A.movePlan(M.walletPocket(alice), lockP).map((s) => s.step)).toEqual(['deposit']);
    expect(A.movePlan(lockP, M.walletPocket(alice)).map((s) => s.step)).toEqual(['withdraw']);
    expect(A.movePlan(lockP, byId['s:sneed_mon:balance']).map((s) => [s.step, s.adapter.id])).toEqual([['withdraw', 'sneed_lock'], ['deposit', 'sneed_mon']]);
  });
});

describe('registry, NamingService and discovery against sneed_pid_nicknames', () => {
  const dan = user('pockets-dan-fe');
  const ident = { getPrincipal: () => dan };

  it('names and pockets sync through the canister, the mirror shows them first', async () => {
    store.clear();
    const reg = R.createRegistry(ident);
    expect(reg.entries()).toEqual([]);
    const p3 = { owner: dan, subaccount: numbered(3) };
    await reg.remember([{ account: p3, ledgers: [icpId.toText()] }]);
    await reg.rename(p3, 'Savings');
    // the mirror (a new registry on this "device") has them without a call
    const again = R.createRegistry(ident);
    expect(again.entries().map((e) => [e.nickname, e.pocket.ledgers])).toEqual([['Savings', [icpId.toText()]]]);
    // the canister has them too ("another device": empty mirror)
    store.clear();
    const other = R.createRegistry(ident);
    expect(other.entries()).toEqual([]);
    const fresh = await other.refresh();
    expect(fresh.map((e) => [S.pocketNumber(e.account.subaccount), e.nickname, e.pocket.hidden])).toEqual([[3, 'Savings', false]]);
    // remembering again adds only new ledgers; hide; forget keeps the name
    expect(await other.remember([{ account: p3, ledgers: [icpId.toText()] }])).toEqual([]); // nothing new: no call
    await other.remember([{ account: p3, ledgers: [tokenAId.toText()] }]);
    await other.setHidden(p3, true);
    let [e] = await NS.getMyAccountNicknamesFor(ident, [p3]);
    expect([e.pocket.hidden, e.pocket.ledgers]).toEqual([true, [icpId.toText(), tokenAId.toText()]]);
    await other.forget(p3);
    [e] = await NS.getMyAccountNicknamesFor(ident, [p3]);
    expect([e.nickname, e.pocket]).toEqual(['Savings', null]);
    expect((await NS.myAccountNicknameCount(ident)).count).toBe(1n);
    // the model picks the name up for the account (a name alone is not a pocket)
    const ps = M.mergePockets({ me: dan, registry: other.entries(), discovered: [{ subaccount: numbered(3) }] });
    expect(ps.map((p) => M.displayName(p))).toEqual(['Main', 'Savings · #3']);
  });

  it('a refused write puts the mirror back', async () => {
    store.clear();
    const reg = R.createRegistry(ident);
    await expect(reg.rename({ owner: dan, subaccount: numbered(5) }, 'b@d name')).rejects.toThrow(/only letters/);
    expect(R.createRegistry(ident).entries().some((x) => x.nickname === 'b@d name')).toBe(false);
    const res = await NS.setPockets(ident, [{ account: { owner: dan, subaccount: numbered(6) }, pocket: { host: 'Bad Host', ledgers: [] } }, { account: { owner: dan, subaccount: numbered(7) }, pocket: { host: null, ledgers: [] } }]);
    expect(res.map((r) => Object.keys(r)[0])).toEqual(['err', 'ok']);
    const mirror = NS.loadAccountNicknamesMirror(ident).map((x) => S.pocketNumber(x.account.subaccount));
    expect(mirror).toContain(7);
    expect(mirror).not.toContain(6);
  });

  it('discovery: the index finds subaccounts, those with a balance are remembered in one batch; ICP has no listing', async () => {
    store.clear();
    // dan holds AAA on #1 and #9, and an emptied #2
    for (const n of [1, 2, 9]) unwrap(await tokenAAs(bob).icrc1_transfer({ from_subaccount: [], to: account(dan, numbered(n)), amount: n === 2 ? 0n : 10_000n * BigInt(n), fee: [], memo: [], created_at_time: [] }));
    const indexId = user('fake-index').toText();
    const calls = [];
    const fakeIndex = { list_subaccounts: async ({ owner, start }) => {
      calls.push(start.length ? S.pocketNumber(start[0]) : null);
      expect(owner.toText()).toBe(dan.toText());
      const all = [1, 2, 9].map(numbered);
      const from = start.length ? all.findIndex((s) => S.sameSubaccount(s, start[0])) + 1 : 0;
      return all.slice(from, from + 2); // pages of two
    } };
    const ctx = ctxFor(dan, { actors: {
      index: (id) => { expect(id).toBe(indexId); return fakeIndex; },
      icrc106: (id) => ({ icrc106_get_index_principal: async () => (id === tokenAId.toText() ? { Ok: Principal.fromText(indexId) } : { Err: null }) }),
    } });
    const reg = R.createRegistry(ident);
    await reg.refresh();
    const r = await D.discoverLedger(ctx, tokenAId.toText(), { registry: reg });
    expect(r.via).toBe('index');
    expect(calls).toEqual([null, 2, 9]);
    expect(r.discovered.map((x) => [S.pocketNumber(x.subaccount), x.balance])).toEqual(expect.arrayContaining([[1, 10_000n], [2, 0n], [9, 90_000n]]));
    const remembered = (await reg.refresh()).filter((e) => e.pocket).map((e) => S.pocketNumber(e.account.subaccount));
    expect(remembered).toEqual(expect.arrayContaining([1, 9, 7]));
    expect(remembered).not.toContain(2); // empty: not recorded
    // ICP: no index, remembered pockets only; "check #N" reads balances
    unwrap(await icpAs(bob).icrc1_transfer({ from_subaccount: [], to: account(dan, numbered(4)), amount: 70_000n, fee: [], memo: [], created_at_time: [] }));
    const icp = await D.discoverLedger(ctx, icpId.toText(), { registry: reg });
    expect(icp.via).toBe('icp');
    expect(icp.discovered.some((x) => S.pocketNumber(x.subaccount) === 4)).toBe(false);
    const checked = await D.checkRange(ctx, icpId.toText(), 1, 5);
    expect(checked.filter((c) => c.balance > 0n).map((c) => [c.number, c.balance])).toEqual([[4, 70_000n]]);
    await expect(D.checkRange(ctx, icpId.toText(), 1, 21)).rejects.toThrow(/at most 20/);
    await expect(D.deepScan()).rejects.toThrow(/ledger history cache/);
    // the whole wallet: discovery + adapters merged
    const disc = await D.discoverWallet(ctx, [tokenAId.toText(), icpId.toText()], { registry: reg });
    const ps = M.mergePockets({ me: dan, registry: reg.entries(), discovered: disc.discovered });
    expect(M.total(ps, tokenAId.toText())).toBe(100_000n);
    expect(M.holders(ps, tokenAId.toText()).map((p) => M.displayName(p))).toEqual(['#1', '#9']);
    expect(M.showDisclosure(ps, tokenAId.toText())).toBe(true);
    expect(MODEL.nextFreeNumber(ps)).toBe(3); // #2 was found (empty) by the index
    expect(MODEL.nextFreeNumber(ps, { registry: reg.entries(), me: dan })).toBe(4); // #3 is named 'Savings'
  });
});

describe('Move and send between pockets (utils/pockets/move.js) against the canisters', () => {
  const mover = user('pockets-mover');
  let MV;
  beforeAll(async () => {
    MV = await import('../../../src/app_sneeddao_frontend/src/utils/pockets/move.js');
    await icpAs(admin).mint(account(mover), 5n * E8);
    await tokenAAs(admin).mint(account(mover), 1_000_000n);
  });

  it('wallet → wallet, wallet → Sneed Lock, Sneed Lock → service (two steps through Main), Sneedex payment → a numbered pocket', async () => {
    const ctx = ctxFor(mover);
    const main = M.walletPocket(mover);
    const one = M.walletPocket(mover, numbered(1));
    const two = M.walletPocket(mover, numbered(2));
    const lock = M.adapterPocket(A.sneedLockAdapter, (await A.sneedLockAdapter.listMyAccounts(ctx))[0]);
    const mon = M.adapterPocket(A.sneedMonAdapter, (await A.sneedMonAdapter.listMyAccounts(ctx))[0]);
    const A_ = tokenAId.toText(); const I_ = icpId.toText();
    // Main → #1: one transfer, Main pays the fee
    await MV.executeTransfer(ctx, main, one, A_, 10_000n);
    expect(await bal(tokenAId, mover, numbered(1))).toBe(10_000n);
    expect(await bal(tokenAId, mover)).toBe(1_000_000n - 10_000n - FEE_A);
    // #1 → Sneed Lock wallet: the host's deposit from that pocket
    await MV.executeTransfer(ctx, one, lock, A_, 5_000n);
    expect(await bal(tokenAId, lockId, principalToSubaccount(mover))).toBe(5_000n);
    expect(await bal(tokenAId, mover, numbered(1))).toBe(10_000n - 5_000n - FEE_A);
    // Sneed Lock → an outside account (sneed_lock pays anywhere): one step
    await MV.executeTransfer(ctx, lock, { owner: carol, subaccount: numbered(7) }, A_, 2_000n);
    expect(await bal(tokenAId, carol, numbered(7))).toBe(2_000n);
    expect(await bal(tokenAId, lockId, principalToSubaccount(mover))).toBe(5_000n - 2_000n - FEE_A);
    // ICP: Main → Sneed Lock, then Sneed Lock → Sneed Monitor: withdraw to Main (amount + fee), deposit from Main
    await MV.executeTransfer(ctx, main, lock, I_, E8);
    const mainBefore = await bal(icpId, mover);
    await MV.executeTransfer(ctx, lock, mon, I_, 50_000_000n);
    expect(await bal(icpId, lockId, principalToSubaccount(mover))).toBe(E8 - (50_000_000n + ICP_FEE) - ICP_FEE);
    expect(await bal(icpId, mover)).toBe(mainBefore); // Main only passed it on (its fee came from the withdrawal)
    expect((await A.sneedMonAdapter.balance(ctxFor(mover), mon, I_)).total).toBe(50_000_000n - ICP_FEE); // credit_deposit keeps one fee
    // Sneedex creation payment (pays Main only) → #2: withdraw everything to Main, then send on
    const pay = M.adapterPocket(A.sneedexAdapter, (await A.sneedexAdapter.listMyAccounts(ctx)).find((i) => i.hostKey === 'payment'));
    await MV.executeTransfer(ctx, main, pay, I_, 100_000n);
    const rules = await A.sneedexAdapter.rules(ctxFor(mover), pay, I_);
    expect(rules.withdrawable).toBe(100_000n - ICP_FEE);
    const mainBefore2 = await bal(icpId, mover);
    await MV.executeTransfer(ctxFor(mover), pay, two, I_, rules.withdrawable - ICP_FEE);
    expect(await bal(icpId, mover, numbered(2))).toBe(rules.withdrawable - ICP_FEE);
    expect(await bal(icpId, mover)).toBe(mainBefore2);
  });

  it('Sneed Notifications takes top-ups from Main only; refusals come before anything moves', async () => {
    const ctx = ctxFor(mover);
    const notif = M.adapterPocket(A.sneedNotificationsAdapter, (await A.sneedNotificationsAdapter.listMyAccounts(ctx))[0]);
    const one = M.walletPocket(mover, numbered(1));
    const before = await bal(icpId, mover, numbered(1));
    await expect(MV.executeTransfer(ctx, one, notif, icpId.toText(), 100_000n)).rejects.toThrow(/from Main only/);
    expect(await bal(icpId, mover, numbered(1))).toBe(before);
    await MV.executeTransfer(ctx, M.walletPocket(mover), notif, icpId.toText(), 100_000n);
    expect((await A.sneedNotificationsAdapter.balance(ctx, notif, icpId.toText())).total).toBe(100_000n);
    await expect(MV.executeTransfer(ctx, one, one, icpId.toText(), 1n)).rejects.toThrow(/same pocket/);
  });
});
