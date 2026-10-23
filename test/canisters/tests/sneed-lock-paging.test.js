// Sneed Lock paging and rate limits (spec/paging_audit.md S15; src/RateLimit.mo):
//  - icrc7_balance_of / icrc7_tokens_of read an owner index (lock id -> record lists, position ->
//    claimants, kept by the helpers that change the lock state) instead of checking every NFT against
//    every lock: the same answers as the brute force over icrc7_tokens + icrc7_owner_of, but a
//    100-account balance_of over 1,200 locks no longer runs out of instructions;
//  - create_lock, create_position_lock and the fee claims (claim_position_fees,
//    request_claim_and_withdraw: one "claim" bucket) are rate limited per caller, refused at ingress
//    once the bucket is empty; the rules are admin-settable (admin_set_rate_limit, logged as a
//    sneedlock_config_update block) and readable (get_rate_limits);
//  - upgrades from production (sneed_lock_preaudit, f5919527) and from HEAD before these fixes
//    (sneed_lock_prepaging, what #461 installs) rebuild the index.
// SNEED_LOCK_WASM=sneed_lock_prepaging npx vitest run tests/sneed-lock-paging.test.js runs it against
// the code before these fixes: the fail-before run.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, account, principalToSubaccount, admin, alice, bob, carol, user, ICP_LEDGER_ID, T, unwrap, errOf, wasm, refusedAtIngress } from '../lib/pic.js';
import { ledgerIdl, ledgerInit, poolIdl, poolInit } from '../lib/idl.js';
import { btype, txField } from '../lib/icrc3.js';
import { idlFactory as sneedLockIdl } from '../build/sneed_lock.did.js';

const LOCK_WASM = process.env.SNEED_LOCK_WASM || 'sneed_lock';
const FEE = 1_000n;
const DAY_NS = 86_400n * 1_000_000_000n;
const dave = user('paging-dave');
const erin = user('paging-erin');
const sub = (n) => new Uint8Array(32).fill(n);
const acc = (owner, s) => ({ owner, subaccount: s ? [s] : [] });
const accKey = (a) => `${a.owner.toText()}.${a.subaccount.length ? a.subaccount[0][0] : 0}`;

let pic, appSubnet, poolId, tokenAId, tokenBId, lockId;
let token, pool;
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const lockAs = (cid, p) => actorAs(pic, sneedLockIdl, cid, p);
const wallet = (cid, p) => account(cid, principalToSubaccount(p));

/** Every NFT and its owner, the brute-force way (icrc7_tokens + icrc7_owner_of). */
async function bruteForce(cid) {
  const a = lockAs(cid, admin);
  const ids = [];
  for (;;) {
    const page = await a.icrc7_tokens(ids.length ? [ids.at(-1)] : [], [500n]);
    ids.push(...page);
    if (page.length < 500) break;
  }
  const owners = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    (await a.icrc7_owner_of(batch)).forEach(([o], j) => { if (o) owners.set(batch[j], accKey(o)); });
  }
  return { ids, owners };
}

/** balance_of and tokens_of of every account equal the brute force. */
async function expectIndexMatches(cid, accounts) {
  const a = lockAs(cid, admin);
  const { owners } = await bruteForce(cid);
  const expected = accounts.map((x) => [...owners].filter(([, k]) => k === accKey(x)).map(([id]) => id).sort((p, q) => (p < q ? -1 : 1)));
  expect(await a.icrc7_balance_of(accounts)).toEqual(expected.map((e) => BigInt(e.length)));
  for (const [i, x] of accounts.entries()) {
    expect(await a.icrc7_tokens_of(x, [], [])).toEqual(expected[i]);
    if (expected[i].length > 1) expect(await a.icrc7_tokens_of(x, [expected[i][0]], [1n])).toEqual([expected[i][1]]); // paged
  }
  return expected;
}

let nextPos = 1_000n;
/** A state with every kind of change the index must follow, on Sneed Lock `cid`. */
async function buildState(cid) {
  const as = (p) => lockAs(cid, p);
  const send = (p, id, to, from_subaccount = []) => as(p).icrc7_transfer([{ from_subaccount, to, token_id: id, memo: [], created_at_time: [] }]).then((r) => r[0][0]);
  const lockOf = async (p, amount, expiry) => {
    await token.mint(wallet(cid, p), amount + 5n * FEE); // the extra is free balance, for transfer fees
    return unwrap(await as(p).create_lock(amount, tokenAId, expiry ?? (await nowNs()) + DAY_NS, []));
  };
  const position = async (p, lockIt = true) => {
    const pos = nextPos++;
    await pool.mint_position(p, pos, 1_000_000n);
    expect(await as(p).claim_position(poolId, pos)).toBe(true);
    if (!lockIt) return [pos, null];
    unwrap(await actorAs(pic, poolIdl, poolId, p).transferPosition(p, cid, pos));
    return [pos, unwrap(await as(p).create_position_lock(poolId, 1n, pos, (await nowNs()) + DAY_NS, tokenAId, tokenBId, []))];
  };
  const ids = {};
  for (const p of [alice, bob, carol, dave]) ids[p.toText()] = [await lockOf(p, 10_000n), await lockOf(p, 20_000n), await lockOf(p, 30_000n)];
  const [a0, a1, a2] = ids[alice.toText()];
  const [b0] = ids[bob.toText()];
  // NFT moves between principals and to subaccounts, a label-only move, a legacy ownership transfer
  expect(await send(alice, a0, acc(bob, sub(4)))).toHaveProperty('Ok');
  expect(await send(bob, b0, acc(bob, sub(7)))).toHaveProperty('Ok');
  expect(await as(alice).transfer_token_lock_ownership(carol, tokenAId, a1)).toEqual({ Ok: null });
  // an unlocked lock, archived: its NFT is burned
  const short = await lockOf(erin, 5_000n, (await nowNs()) + 30n * 1_000_000_000n);
  await lockOf(erin, 6_000n);
  await pic.advanceTime(60_000); await pic.tick();
  await as(erin).clear_expired_locks();
  // locked positions, one moved as an NFT, one claimed but never locked (no NFT)
  const [, pa] = await position(alice);
  const [, pb] = await position(bob);
  expect(await send(alice, pa, acc(carol, sub(2)))).toHaveProperty('Ok');
  await position(dave, false);
  // a position with a stale claim: alice claims, hands it to bob at the pool, bob deposits and locks
  const pos = nextPos++;
  await pool.mint_position(alice, pos, 1n);
  expect(await as(alice).claim_position(poolId, pos)).toBe(true);
  unwrap(await actorAs(pic, poolIdl, poolId, alice).transferPosition(alice, bob, pos));
  expect(await as(bob).claim_position(poolId, pos)).toBe(true);
  unwrap(await actorAs(pic, poolIdl, poolId, bob).transferPosition(bob, cid, pos));
  unwrap(await as(bob).create_position_lock(poolId, 1n, pos, (await nowNs()) + DAY_NS, tokenAId, tokenBId, []));
  return { a2, short, pa, pb };
}
const ACCOUNTS = () => [
  acc(alice), acc(bob), acc(bob, sub(4)), acc(bob, sub(7)), acc(carol), acc(carol, sub(2)), acc(dave), acc(erin), acc(user('paging-nobody')),
];

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 10_000n, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  tokenBId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 500n, symbol: 'BBB', decimals: 8 }], targetSubnetId: appSubnet });
  poolId = await install(pic, { name: 'MockSwapPool', initTypes: poolInit, initArgs: [{ token0: tokenAId, token1: tokenBId, fee: 3000n }], targetSubnetId: appSubnet });
  lockId = await install(pic, { name: LOCK_WASM, cycles: 50n * T, targetSubnetId: appSubnet });
  token = actorAs(pic, ledgerIdl, tokenAId, admin);
  pool = actorAs(pic, poolIdl, poolId, admin);
  await pic.tick(3); // the history import, then token locks are NFTs
}, 120_000);
afterAll(async () => { await pic?.tearDown(); });

describe('the owner index answers like the brute force', () => {
  it('after mints, moves to subaccounts and principals, legacy transfers, burns, positions and stale claims', async () => {
    const { a2 } = await buildState(lockId);
    const expected = await expectIndexMatches(lockId, ACCOUNTS());
    expect(expected[0]).toContain(a2); // alice still holds her third lock
    expect(expected[2].length).toBe(1); // bob's subaccount 4: alice's first lock
    expect(expected[5].length).toBe(1); // carol's subaccount 2: alice's position
    expect(expected[7].length).toBe(1); // erin: the archived lock is gone
  });

  it('and after further moves back and forth', async () => {
    const lock = (p) => lockAs(lockId, p);
    const [first] = await lock(admin).icrc7_tokens_of(acc(bob, sub(4)), [], []);
    expect((await lock(bob).icrc7_transfer([{ from_subaccount: [sub(4)], to: acc(alice), token_id: first, memo: [], created_at_time: [] }]))[0][0]).toHaveProperty('Ok');
    const [pos] = await lock(admin).icrc7_tokens_of(acc(carol, sub(2)), [], []);
    expect((await lock(carol).icrc7_transfer([{ from_subaccount: [sub(2)], to: acc(dave), token_id: pos, memo: [], created_at_time: [] }]))[0][0]).toHaveProperty('Ok');
    await expectIndexMatches(lockId, ACCOUNTS());
  });
});

describe('scale', () => {
  it('a 100-account icrc7_balance_of over 1,200 token locks answers (before: out of instructions)', async () => {
    const holders = Array.from({ length: 120 }, (_, i) => user(`paging-holder-${i}`));
    await Promise.all(holders.map(async (p) => {
      await token.mint(wallet(lockId, p), 10n * 1_000n);
      const expiry = (await nowNs()) + DAY_NS;
      for (let i = 0; i < 10; i++) unwrap(await lockAs(lockId, p).create_lock(1_000n, tokenAId, expiry, []));
    }));
    const accounts = holders.slice(0, 100).map((p) => acc(p));
    const balances = await lockAs(lockId, admin).icrc7_balance_of(accounts);
    expect(balances).toEqual(accounts.map(() => 10n));
    expect((await lockAs(lockId, admin).icrc7_tokens_of(accounts[42], [], [])).length).toBe(10);
  }, 600_000);
});

describe('rate limits', () => {
  const spammer = user('paging-spammer');
  const rules = async () => Object.fromEntries((await lockAs(lockId, admin).get_rate_limits()).map(([k, r]) => [k, r]));

  it('get_rate_limits: generous defaults', async () => {
    expect(await rules()).toEqual({
      create_lock: { capacity: 30n, per_minute: 10n },
      create_position_lock: { capacity: 30n, per_minute: 10n },
      claim: { capacity: 30n, per_minute: 10n },
    });
  });

  it('a spammer gets 30 locks, then is refused at ingress; a normal user is not; a minute refills 10', async () => {
    const spam = lockAs(lockId, spammer);
    await token.mint(wallet(lockId, spammer), 100n * 1_000n);
    const expiry = (await nowNs()) + DAY_NS;
    for (let i = 0; i < 30; i++) unwrap(await spam.create_lock(1_000n, tokenAId, expiry, []));
    expect(await refusedAtIngress(spam.create_lock(1_000n, tokenAId, expiry, []))).toBe(true);
    // bob is not affected
    await token.mint(wallet(lockId, bob), 3n * 1_000n);
    for (let i = 0; i < 3; i++) unwrap(await lockAs(lockId, bob).create_lock(1_000n, tokenAId, expiry, []));
    await pic.advanceTime(60_000); await pic.tick();
    for (let i = 0; i < 10; i++) unwrap(await spam.create_lock(1_000n, tokenAId, expiry, []));
    expect(await refusedAtIngress(spam.create_lock(1_000n, tokenAId, expiry, []))).toBe(true);
  });

  it('admin_set_rate_limit: admins only, known actions only; logged; the claims share one bucket', async () => {
    expect(errOf(await lockAs(lockId, spammer).admin_set_rate_limit('claim', [{ capacity: 1000n, per_minute: 1000n }]))).toMatch(/admin/);
    expect(errOf(await lockAs(lockId, admin).admin_set_rate_limit('transfer_tokens', [{ capacity: 1n, per_minute: 1n }]))).toMatch(/Unknown action/);
    expect(errOf(await lockAs(lockId, admin).admin_set_rate_limit('claim', [{ capacity: 2n, per_minute: 0n }]))).toMatch(/per_minute/);
    expect(await lockAs(lockId, admin).admin_set_rate_limit('claim', [{ capacity: 2n, per_minute: 1n }])).toEqual({ Ok: null });
    const s = await lockAs(lockId, admin).icrc3_log_status();
    const [block] = (await lockAs(lockId, admin).icrc3_get_blocks([{ start: s.log_length - 1n, length: 1n }])).blocks.map((b) => b.block);
    expect(btype(block)).toBe('sneedlock_config_update');
    expect(txField(block, 'key')).toEqual({ Text: 'rate_limit.claim' });
    expect(txField(block, 'value')).toEqual({ Map: [['capacity', { Nat: 2n }], ['per_minute', { Nat: 1n }]] });
    expect(txField(block, 'old_value')).toEqual({ Map: [['capacity', { Nat: 30n }], ['per_minute', { Nat: 10n }]] });
    expect((await rules()).claim).toEqual({ capacity: 2n, per_minute: 1n });
    const c = lockAs(lockId, carol);
    expect(await c.claim_position_fees(poolId, 999_999n)).toHaveProperty('Err'); // no such position, but a call
    expect(await c.request_claim_and_withdraw(poolId, 999_999n)).toHaveProperty('Err');
    expect(await refusedAtIngress(c.claim_position_fees(poolId, 999_999n))).toBe(true);
    expect(await refusedAtIngress(c.request_claim_and_withdraw(poolId, 999_999n))).toBe(true);
    // position locks have their own bucket
    unwrap(await lockAs(lockId, admin).admin_set_rate_limit('create_position_lock', [{ capacity: 1n, per_minute: 1n }]));
    expect(await c.create_position_lock(poolId, 1n, 999_999n, (await nowNs()) + DAY_NS, tokenAId, tokenBId, [])).toHaveProperty('Err');
    expect(await refusedAtIngress(c.create_position_lock(poolId, 1n, 999_999n, (await nowNs()) + DAY_NS, tokenAId, tokenBId, []))).toBe(true);
    // capacity 0 = no limit; null = back to the default
    unwrap(await lockAs(lockId, admin).admin_set_rate_limit('claim', [{ capacity: 0n, per_minute: 0n }]));
    expect(await c.claim_position_fees(poolId, 999_999n)).toHaveProperty('Err');
    unwrap(await lockAs(lockId, admin).admin_set_rate_limit('claim', []));
    unwrap(await lockAs(lockId, admin).admin_set_rate_limit('create_position_lock', []));
    expect((await rules()).claim).toEqual({ capacity: 30n, per_minute: 10n });
  });

  it('the rules are kept across an upgrade (the buckets start full)', async () => {
    unwrap(await lockAs(lockId, admin).admin_set_rate_limit('create_lock', [{ capacity: 5n, per_minute: 2n }]));
    await pic.upgradeCanister({ sender: admin, canisterId: lockId, wasm: wasm(LOCK_WASM), arg: IDL.encode([], []) });
    await pic.tick(2);
    expect((await rules()).create_lock).toEqual({ capacity: 5n, per_minute: 2n });
    unwrap(await lockAs(lockId, admin).admin_set_rate_limit('create_lock', []));
  });
});

describe('upgrades rebuild the index', () => {
  for (const from of ['sneed_lock_preaudit', 'sneed_lock_prepaging']) {
    it(`from ${from}: the same owners and balances, kept up to date afterwards`, async () => {
      const cid = await install(pic, { name: from, cycles: 20n * T, targetSubnetId: appSubnet });
      await pic.tick(3);
      await buildState(cid);
      const before = await bruteForce(cid);
      const balancesBefore = await lockAs(cid, admin).icrc7_balance_of(ACCOUNTS());
      await pic.upgradeCanister({ sender: admin, canisterId: cid, wasm: wasm('sneed_lock'), arg: IDL.encode([], []) });
      await pic.tick(3);
      const after = await bruteForce(cid);
      expect(after.ids).toEqual(before.ids);
      expect([...after.owners]).toEqual([...before.owners]);
      expect(await lockAs(cid, admin).icrc7_balance_of(ACCOUNTS())).toEqual(balancesBefore);
      await expectIndexMatches(cid, ACCOUNTS());
      // changes after the upgrade keep it right
      await token.mint(wallet(cid, erin), 20_000n);
      const id = unwrap(await lockAs(cid, erin).create_lock(10_000n, tokenAId, (await nowNs()) + DAY_NS, []));
      expect((await lockAs(cid, erin).icrc7_transfer([{ from_subaccount: [], to: acc(alice, sub(3)), token_id: id, memo: [], created_at_time: [] }]))[0][0]).toHaveProperty('Ok');
      await expectIndexMatches(cid, [...ACCOUNTS(), acc(alice, sub(3))]);
      expect((await lockAs(cid, admin).get_rate_limits()).length).toBe(3);
    }, 120_000);
  }
});
