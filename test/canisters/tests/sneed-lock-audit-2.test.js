// Sneed Lock audit (2026-11-02), the findings after the races of sneed-lock-audit-races.test.js:
//  H2  pools were never checked against ICPSwap: create_position_lock trusted the pool's own
//      metadata, so any canister answering like a pool and naming real tokens got "locked
//      liquidity" of real tokens. Now the ICPSwap SwapFactory must confirm the pool (getPool for its
//      token pair and fee answers this canister id); verified pools are kept (get_verified_pool).
//      Liquidity additions need a verified pool too.
//  M1  every call to a caller-named ledger or pool waited without bound: a canister that never
//      answers kept a call open, and Sneed Lock could then not be stopped, so not upgraded. Now those
//      calls are bounded-wait (300 s) and each unknown outcome is handled safely.
//  M2  for ~1/256 of principals the ICP payment subaccount is the Sneed wallet (byte 23 already
//      0x50): the lock fee was taken from ICP they had locked there. Now only unlocked ICP pays.
//  LOW anonymous owners and recipients are refused, a token lock is not transferred to its own owner,
//      getPaymentBalance and getEffectiveLockFee are rate-limited.
// SNEED_LOCK_WASM=sneed_lock_pr33 runs it against the code before these fixes (the build of
// claude/lock-audit-fixes, PR #33): each finding's tests fail there.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import {
  createPic, install, actorAs, account, principalToSubaccount, paymentSubaccount, admin, user, ICP_LEDGER_ID, ICPSWAP_FACTORY_ID,
  T, unwrap, errOf, wasm, refusedAtIngress,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit, poolIdl, poolInit } from '../lib/idl.js';
import { idlFactory as sneedLockIdl } from '../build/sneed_lock.did.js';

const SNEED_LOCK_WASM = process.env.SNEED_LOCK_WASM || 'sneed_lock';
const ICP_FEE = 10_000n;
const FEE_A = 1_000n;
const FEE_B = 500n;
const DAY_NS = 86_400n * 1_000_000_000n;
const TIMEOUT_MS = 301_000; // just past Sneed Lock's bounded-wait timeout (300 s)
const lockSvc = sneedLockIdl({ IDL });
const method = (name) => lockSvc._fields.find(([n]) => n === name)[1];
const MGMT = Principal.fromText('aaaaa-aa');

// test-only methods of the mocks
const hangIdl = ({ IDL }) => IDL.Service({
  release: IDL.Func([], [], []),
  hang: IDL.Func([], [], []),
  stats: IDL.Func([], [IDL.Record({ calls: IDL.Nat, spins: IDL.Nat, hanging: IDL.Bool })], ['query']),
});
const ledgerHangIdl = ({ IDL }) => IDL.Service({ set_hang_transfers: IDL.Func([IDL.Bool], [], []) });
const poolHangIdl = ({ IDL }) => IDL.Service({ set_hang_transfer_position: IDL.Func([IDL.Bool], [], []) });
const factoryIdl = ({ IDL }) => IDL.Service({
  register_pool: IDL.Func([IDL.Principal, IDL.Principal, IDL.Principal, IDL.Nat], [], []),
  clear_pools: IDL.Func([], [], []),
});

let env;

async function setup() {
  const { pic, appSubnet } = await createPic();
  const other = (await pic.getSnsSubnet()).id;
  const icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  const tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: other });
  const tokenBId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_B, symbol: 'BBB', decimals: 8 }], targetSubnetId: other });
  // the genuine pool of the A/B pair, registered with the (mock) ICPSwap factory at its mainnet id
  const poolId = await install(pic, { name: 'MockSwapPool', initTypes: poolInit, initArgs: [{ token0: tokenAId, token1: tokenBId, fee: 3000n }], targetSubnetId: other });
  // impostors: same tokens and fee (the factory's pool for the pair is another canister), and a
  // pair the factory has no pool for
  const fakeId = await install(pic, { name: 'MockSwapPool', initTypes: poolInit, initArgs: [{ token0: tokenAId, token1: tokenBId, fee: 3000n }], targetSubnetId: other, registerPool: false });
  const fake2Id = await install(pic, { name: 'MockSwapPool', initTypes: poolInit, initArgs: [{ token0: tokenAId, token1: tokenBId, fee: 500n }], targetSubnetId: other, registerPool: false });
  const hangId = await install(pic, { name: 'MockHang', targetSubnetId: other });
  const lockId = await install(pic, { name: SNEED_LOCK_WASM, cycles: 50n * T, targetSubnetId: appSubnet });
  await pic.tick(3);
  const e = {
    pic, appSubnet, icpId, tokenAId, tokenBId, poolId, fakeId, fake2Id, hangId, lockId,
    icp: actorAs(pic, ledgerIdl, icpId, admin),
    tokenA: actorAs(pic, ledgerIdl, tokenAId, admin),
    tokenB: actorAs(pic, ledgerIdl, tokenBId, admin),
    tokenAHang: actorAs(pic, ledgerHangIdl, tokenAId, admin),
    poolAs: (id, p) => actorAs(pic, poolIdl, id, p),
    poolHang: actorAs(pic, poolHangIdl, poolId, admin),
    hang: actorAs(pic, hangIdl, hangId, admin),
    factory: actorAs(pic, factoryIdl, ICPSWAP_FACTORY_ID, admin),
    lockAs: (p, id = lockId) => actorAs(pic, sneedLockIdl, id, p),
    wallet: (p, id = lockId) => account(id, principalToSubaccount(p)),
    nowNs: async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n,
  };
  e.submit = (name, sender, args) => pic.submitCall({ canisterId: lockId, method: name, arg: IDL.encode(method(name).argTypes, args), sender });
  e.decode = async (name, call) => IDL.decode(method(name).retTypes, await pic.awaitCall(call))[0];
  // an ingress call has finished (replied, or rejected: pic-js throws the reject) - without waiting for it
  e.done = async (call) => { try { return (await pic.ingressStatus(call)) !== null; } catch { return true; } };
  e.status = async () => Object.keys((await pic.canisterStatus({ canisterId: lockId, sender: admin })).status)[0];
  // a position of `who` in pool `pid`, claimed and deposited into Sneed Lock (not locked yet)
  let nextPos = 1000n;
  e.depositPosition = async (who, pid = poolId) => {
    const pos = (nextPos += 1n);
    await e.poolAs(pid, admin).mint_position(who, pos, 1_000_000n);
    expect(await e.lockAs(who).claim_position(pid, pos)).toBe(true);
    unwrap(await e.poolAs(pid, who).transferPosition(who, lockId, pos));
    return pos;
  };
  e.lockedOf = async (p, ledger) => (await e.lockAs(p).get_summed_locks()).find(([t]) => t.toText() === ledger.toText())?.[1] ?? 0n;
  return e;
}

beforeAll(async () => { env = await setup(); }, 180_000);
afterAll(async () => { await env?.pic.tearDown(); });

describe('H2: only pools the ICPSwap factory confirms', () => {
  it('refuses a position lock on a pool the factory does not know, even naming the real tokens', async () => {
    const who = user('h2-fake');
    for (const [pid, why] of [[env.fakeId, /Not a genuine ICPSwap pool: the ICPSwap factory's pool for .* is /], [env.fake2Id, /Not a genuine ICPSwap pool: the ICPSwap factory has no pool for /]]) {
      const pos = await env.depositPosition(who, pid);
      const r = await env.lockAs(who).create_position_lock(pid, 1n, pos, (await env.nowNs()) + DAY_NS, env.tokenAId, env.tokenBId, []);
      console.log('position lock on an impostor pool:', JSON.stringify(r, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
      expect(errOf(r).message).toMatch(why);
      expect(await env.lockAs(who).get_lock_states_page({ owner: [who], ledger: [], swap_canister_id: [pid], token: [], kind: [], status: [], include_archived: true, prev: [], take: [] })).toEqual([]);
    }
  });

  it('locks a position on the genuine pool, keeps the pool as verified and needs the factory only once', async () => {
    const who = user('h2-genuine');
    const pos = await env.depositPosition(who);
    unwrap(await env.lockAs(who).create_position_lock(env.poolId, 1n, pos, (await env.nowNs()) + DAY_NS, env.tokenAId, env.tokenBId, []));
    const v = await env.lockAs(who).get_verified_pool(env.poolId);
    expect(v).toHaveLength(1);
    expect([v[0].token0.toText(), v[0].token1.toText(), v[0].fee]).toEqual([env.tokenAId.toText(), env.tokenBId.toText(), 3000n]);
    expect(await env.lockAs(who).get_verified_pool(env.fakeId)).toEqual([]);
    // the factory forgets every pool: the verified pool still takes locks (no second factory call)
    await env.factory.clear_pools();
    try {
      const pos2 = await env.depositPosition(who);
      unwrap(await env.lockAs(who).create_position_lock(env.poolId, 1n, pos2, (await env.nowNs()) + DAY_NS, env.tokenAId, env.tokenBId, []));
      // the tokens must still be the pool's own, in its order
      const pos3 = await env.depositPosition(who);
      expect(errOf(await env.lockAs(who).create_position_lock(env.poolId, 1n, pos3, (await env.nowNs()) + DAY_NS, env.tokenBId, env.tokenAId, [])).message).toMatch(/token0\/token1 must be the pool's own/);
    } finally {
      await env.factory.register_pool(env.poolId, env.tokenAId, env.tokenBId, 3000n);
    }
  });

  it('after an upgrade from the PR #33 build, a lock made then on an impostor pool takes no liquidity', async () => {
    const { pic } = env;
    const old = await install(pic, { name: 'sneed_lock_pr33', cycles: 20n * T, targetSubnetId: env.appSubnet });
    await pic.tick(3);
    const who = user('h2-upgrade');
    const pos = 7_001n;
    await env.poolAs(env.fakeId, admin).mint_position(who, pos, 1_000_000n);
    expect(await env.lockAs(who, old).claim_position(env.fakeId, pos)).toBe(true);
    unwrap(await env.poolAs(env.fakeId, who).transferPosition(who, old, pos));
    unwrap(await env.lockAs(who, old).create_position_lock(env.fakeId, 1n, pos, (await env.nowNs()) + DAY_NS, env.tokenAId, env.tokenBId, []));
    await pic.tick(5);
    await pic.stopCanister({ canisterId: old, sender: admin });
    await pic.upgradeCanister({ canisterId: old, wasm: wasm(SNEED_LOCK_WASM), sender: admin });
    await pic.startCanister({ canisterId: old, sender: admin });
    await pic.tick(3);
    // the lock is still there (an upgrade keeps every lock) ...
    const locks = await env.lockAs(who, old).get_lock_states_page({ owner: [who], ledger: [], swap_canister_id: [env.fakeId], token: [], kind: [], status: [{ Active: null }], include_archived: false, prev: [], take: [] });
    expect(locks).toHaveLength(1);
    // ... but no tokens go into that pool
    await env.tokenA.mint(env.wallet(who, old), 1_000_000n);
    await env.tokenB.mint(env.wallet(who, old), 1_000_000n);
    const r = await env.lockAs(who, old).add_liquidity_to_locked_position(env.fakeId, pos, 100_000n, 100_000n);
    console.log('add liquidity to a lock on an impostor pool after the upgrade:', JSON.stringify(r, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
    expect(errOf(r)).toMatch(/Not a genuine ICPSwap pool/);
    expect(await env.tokenA.icrc1_balance_of(env.wallet(who, old))).toBe(1_000_000n);
  }, 120_000);
});

describe('M1: a canister that never answers cannot keep Sneed Lock from stopping', () => {
  // Calls the canister under test may still have open at the end of a test run against the old code
  const settle = async () => {
    await env.hang.release();
    await env.tokenAHang.set_hang_transfers(false);
    await env.poolHang.set_hang_transfer_position(false);
    await env.pic.tick(20);
    if ((await env.status()) !== 'running') await env.pic.startCanister({ canisterId: env.lockId, sender: admin });
  };

  it('claim_position on a pool that never answers: the call ends after the timeout, the stop completes, the upgrade runs', async () => {
    const { pic } = env;
    const who = user('m1-claim');
    await env.hang.hang();
    try {
      const claim = await env.submit('claim_position', who, [env.hangId, 1n]);
      await pic.tick(5);
      expect((await env.hang.stats()).calls).toBeGreaterThan(0n);
      // the stop request comes 200 s into the claim (a stop request itself gives up after 5 minutes)
      await pic.advanceTime(200_000);
      await pic.tick(3);
      expect(await env.done(claim)).toBe(false);
      const stop = await pic.submitCall({ canisterId: MGMT, method: 'stop_canister', arg: IDL.encode([IDL.Record({ canister_id: IDL.Principal })], [{ canister_id: env.lockId }]), sender: admin, targetSubnetId: env.appSubnet });
      await pic.tick(5);
      expect(await env.status()).toBe('stopping');
      await pic.advanceTime(TIMEOUT_MS - 200_000);
      await pic.tick(10);
      const st = await env.status();
      console.log('Sneed Lock status 301 s after a stop request, with a claim on a pool that never answers:', st, '; the claim call done:', await env.done(claim));
      expect(st).toBe('stopped');
      expect(await env.done(claim)).toBe(true);
      expect(await env.decode('claim_position', claim)).toBe(false);
      await pic.awaitCall(stop);
      await pic.upgradeCanister({ canisterId: env.lockId, wasm: wasm(SNEED_LOCK_WASM), sender: admin });
      await pic.startCanister({ canisterId: env.lockId, sender: admin });
      expect(await env.status()).toBe('running');
      // state kept: the position locks of the H2 tests are all there
      expect((await env.lockAs(admin).get_lock_states_page({ owner: [], ledger: [], swap_canister_id: [env.poolId], token: [], kind: [], status: [{ Active: null }], include_archived: false, prev: [], take: [] })).length).toBeGreaterThanOrEqual(2);
    } finally { await settle(); }
  }, 120_000);

  it('transfer_tokens on a ledger that never answers ends after the timeout and releases the caller', async () => {
    const { pic } = env;
    const who = user('m1-ledger');
    await env.hang.hang();
    try {
      const t = await env.submit('transfer_tokens', who, [who, [], env.hangId, 5n]);
      await pic.tick(5);
      await pic.advanceTime(TIMEOUT_MS);
      await pic.tick(10);
      const done = await env.done(t);
      console.log('transfer_tokens on a ledger that never answers, done 301 s later:', done);
      expect(done).toBe(true);
      await expect(env.decode('transfer_tokens', t)).rejects.toThrow(); // the fee read timed out: a reject, nothing moved
      // the caller's token operations are not blocked afterwards
      await env.tokenA.mint(env.wallet(who), 100_000n);
      unwrap(await env.lockAs(who).create_lock(10_000n, env.tokenAId, (await env.nowNs()) + DAY_NS, []));
    } finally { await settle(); }
  }, 120_000);

  it('a token lock transfer whose ledger reply never comes: the lock is held by both until reconciled, the tokens stay covered', async () => {
    const { pic } = env;
    const from = user('m1-from');
    const to = user('m1-to');
    const L = 1_000_000n;
    await env.tokenA.mint(env.wallet(from), L + FEE_A);
    const lid = unwrap(await env.lockAs(from).create_lock(L, env.tokenAId, (await env.nowNs()) + DAY_NS, []));
    await env.tokenAHang.set_hang_transfers(true); // the transfer is booked, its reply held back
    try {
      const mv = await env.submit('transfer_token_lock_ownership', from, [to, env.tokenAId, lid]);
      await pic.tick(5);
      await pic.advanceTime(TIMEOUT_MS);
      await pic.tick(10);
      const done = await env.done(mv);
      console.log('token lock transfer with a lost ledger reply, done 301 s later:', done);
      expect(done).toBe(true);
      expect(errOf(await env.decode('transfer_token_lock_ownership', mv)).message).toMatch(/unknown outcome; lock kept on both/);
      await env.tokenAHang.set_hang_transfers(false);
      await pic.tick(5);
      // the tokens landed with `to`, who holds the lock too: nothing of it can be withdrawn
      expect(await env.tokenA.icrc1_balance_of(env.wallet(to))).toBe(L);
      expect(await env.lockedOf(to, env.tokenAId)).toBe(L);
      const w = await env.lockAs(to).transfer_tokens(to, [], env.tokenAId, L - FEE_A);
      expect(w).toHaveProperty('Err');
      const u = (await env.lockAs(to).get_uncertain_token_locks()).find((x) => x.lock_id === lid);
      expect(u.holders.map((p) => p.toText()).sort()).toEqual([from.toText(), to.toText()].sort());
      // reconciliation gives it to the side whose wallet holds the tokens
      expect(unwrap(await env.lockAs(from).reconcile_token_lock(lid, [])).owner.toText()).toBe(to.toText());
      expect(await env.lockedOf(from, env.tokenAId)).toBe(0n);
      expect(await env.lockedOf(to, env.tokenAId)).toBe(L);
    } finally { await settle(); }
  }, 120_000);

  it('a position withdrawal whose pool reply never comes: the pool is asked again, the position left, the claim is cleared', async () => {
    const { pic } = env;
    const who = user('m1-pos');
    const pos = await env.depositPosition(who);
    await env.poolHang.set_hang_transfer_position(true);
    try {
      const w = await env.submit('transfer_position', who, [who, env.poolId, pos]);
      await pic.tick(5);
      await pic.advanceTime(TIMEOUT_MS);
      await pic.tick(10);
      const done = await env.done(w);
      console.log('position withdrawal with a lost pool reply, done 301 s later:', done);
      expect(done).toBe(true);
      expect(await env.decode('transfer_position', w)).toEqual({ ok: true });
      expect((await env.poolAs(env.poolId, admin).position_owner(pos))[0].toText()).toBe(who.toText());
      const claims = await env.lockAs(who).get_claimed_positions_for_principal(who);
      expect(claims.filter((c) => c.position_id === pos)).toEqual([]);
    } finally { await settle(); }
  }, 120_000);
});

describe('M2: the lock fee never comes from locked ICP', () => {
  // a principal whose Sneed wallet subaccount already has 0x50 at byte 23: its payment subaccount is its wallet
  let who;
  const F = 100_000_000n; // 1 ICP per lock
  beforeAll(async () => {
    for (let i = 0; ; i++) { const p = user(`m2-${i}`); if (principalToSubaccount(p)[23] === 0x50) { who = p; break; } }
    expect(Buffer.from(paymentSubaccount(who)).equals(Buffer.from(principalToSubaccount(who)))).toBe(true);
    unwrap(await env.lockAs(admin).admin_set_lock_fees_icp([F], [F], [F], [F]));
  });
  afterAll(async () => { unwrap(await env.lockAs(admin).admin_set_lock_fees_icp([0n], [0n], [0n], [0n])); });

  const covered = async () => {
    const bal = await env.icp.icrc1_balance_of(env.wallet(who));
    const locked = await env.lockedOf(who, env.icpId);
    return { bal, locked, ok: bal >= locked };
  };

  it('an ICP lock is paid from the free part; a token lock, a position lock and an ICP lock that would need locked ICP are refused', async () => {
    await env.icp.mint(env.wallet(who), 350_000_000n);
    unwrap(await env.lockAs(who).create_lock(200_000_000n, env.icpId, (await env.nowNs()) + DAY_NS, []));
    expect(await covered()).toEqual({ bal: 250_000_000n, locked: 200_000_000n, ok: true });

    await env.tokenA.mint(env.wallet(who), 10_000n);
    const tokenLock = await env.lockAs(who).create_lock(5_000n, env.tokenAId, (await env.nowNs()) + DAY_NS, []);
    const after1 = await covered();
    console.log('token lock with 0.5 ICP free and 2 ICP locked in the same account:', JSON.stringify(tokenLock, (_, v) => (typeof v === 'bigint' ? v.toString() : v)), JSON.stringify(after1, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
    expect(after1.ok).toBe(true);
    expect(errOf(tokenLock).message).toMatch(/Insufficient ICP payment.*of which 200000000 e8s are locked/);

    const pos = await env.depositPosition(who);
    const posLock = await env.lockAs(who).create_position_lock(env.poolId, 1n, pos, (await env.nowNs()) + DAY_NS, env.tokenAId, env.tokenBId, []);
    expect((await covered()).ok).toBe(true);
    expect(errOf(posLock).message).toMatch(/Insufficient ICP payment/);

    // locking 0.4 more ICP would leave 0.1 free, less than the fee
    const icpLock = await env.lockAs(who).create_lock(40_000_000n, env.icpId, (await env.nowNs()) + DAY_NS, []);
    expect((await covered()).ok).toBe(true);
    expect(errOf(icpLock).message).toMatch(/Insufficient ICP payment/);
  }, 120_000);

  it('while its position lock is being created, the same caller\'s token operations wait', async () => {
    const { pic } = env;
    await env.icp.mint(env.wallet(who), 2n * F);
    const pos = await env.depositPosition(who);
    const create = await env.submit('create_position_lock', who, [env.poolId, 1n, pos, (await env.nowNs()) + DAY_NS, env.tokenAId, env.tokenBId, []]);
    await pic.tick(1);
    const withdraw = await env.lockAs(who).transfer_tokens(who, [], env.icpId, 50_000_000n);
    console.log('transfer_tokens during the same caller\'s position lock creation:', JSON.stringify(withdraw, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
    expect(errOf(withdraw).GenericError.message).toMatch(/already in progress/);
    unwrap(await env.decode('create_position_lock', create));
    expect((await covered()).ok).toBe(true);
  }, 120_000);
});
