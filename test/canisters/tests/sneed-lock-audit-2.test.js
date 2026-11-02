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
