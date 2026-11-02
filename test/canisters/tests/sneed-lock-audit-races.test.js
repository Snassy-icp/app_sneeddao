// Sneed Lock audit (2026-11-02): races between a caller's own operation and an operation that
// changes that caller's locks meanwhile.
//  1. transfer_tokens read the caller's locked sum BEFORE its ledger awaits. A token lock moved to
//     the caller (transfer_token_lock_ownership by its owner) during those awaits lands its tokens
//     before the balance is read, so the check saw the new tokens but not their lock: the
//     recipient could withdraw locked tokens at once. Fix: the locked sum is read after the
//     balance.
//  2. transfer_position checked for a lock before its first await (the pool's ownership answer)
//     and marked the position in flight only after it, so a create_position_lock of the same
//     position finishing in that window made a lock and the withdrawal then took the position out
//     anyway: an "active" lock on a position Sneed Lock no longer holds. Fix: the position is
//     marked in flight before the first await (create_position_lock already re-checks that).
// Each race is tried with the second call submitted 0..N rounds after the first, so some offset
// hits the window. SNEED_LOCK_WASM=sneed_lock_prefix runs it against the code before the fixes
// (main at 52bea976): each test fails there.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, account, principalToSubaccount, admin, user, ICP_LEDGER_ID, T, unwrap } from '../lib/pic.js';
import { ledgerIdl, ledgerInit, poolIdl, poolInit } from '../lib/idl.js';
import { idlFactory as sneedLockIdl } from '../build/sneed_lock.did.js';

const SNEED_LOCK_WASM = process.env.SNEED_LOCK_WASM || 'sneed_lock';
const ICP_FEE = 10_000n;
const FEE_A = 1_000n;
const FEE_B = 500n;
const DAY_NS = 86_400n * 1_000_000_000n;
const OFFSETS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const lockSvc = sneedLockIdl({ IDL });
const method = (name) => lockSvc._fields.find(([n]) => n === name)[1];

async function setup() {
  const { pic, appSubnet } = await createPic();
  // The ledgers and the pool on another subnet than Sneed Lock: each call between them then takes
  // its own rounds, as on mainnet, so a second call can start while the first awaits.
  const other = (await pic.getSnsSubnet()).id;
  await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  const tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: other });
  const tokenBId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_B, symbol: 'BBB', decimals: 8 }], targetSubnetId: other });
  const poolId = await install(pic, { name: 'MockSwapPool', initTypes: poolInit, initArgs: [{ token0: tokenAId, token1: tokenBId, fee: 3000n }], targetSubnetId: other });
  const lockId = await install(pic, { name: SNEED_LOCK_WASM, cycles: 20n * T, targetSubnetId: appSubnet });
  await pic.tick(3);
  const env = {
    pic, tokenAId, tokenBId, poolId, lockId,
    tokenA: actorAs(pic, ledgerIdl, tokenAId, admin),
    tokenB: actorAs(pic, ledgerIdl, tokenBId, admin),
    pool: actorAs(pic, poolIdl, poolId, admin),
    poolAs: (p) => actorAs(pic, poolIdl, poolId, p),
    lockAs: (p) => actorAs(pic, sneedLockIdl, lockId, p),
    wallet: (p) => account(lockId, principalToSubaccount(p)),
    nowNs: async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n,
  };
  // Submit the first call, let `rounds` rounds run, submit the second, then await both.
  env.raceAt = async (rounds, [n1, p1, a1], [n2, p2, a2]) => {
    const submit = (name, sender, args) => pic.submitCall({ canisterId: lockId, method: name, arg: IDL.encode(method(name).argTypes, args), sender });
    const c1 = await submit(n1, p1, a1);
    if (rounds > 0) await pic.tick(rounds);
    const c2 = await submit(n2, p2, a2);
    const r1 = IDL.decode(method(n1).retTypes, await pic.awaitCall(c1))[0];
    const r2 = IDL.decode(method(n2).retTypes, await pic.awaitCall(c2))[0];
    return [r1, r2];
  };
  env.lockedOf = async (p, ledger) =>
    (await env.lockAs(p).get_summed_locks()).find(([t]) => t.toText() === ledger.toText())?.[1] ?? 0n;
  return env;
}

describe('Sneed Lock audit: no withdrawal of tokens that are locked, no lock on a position that left', () => {
  let env;
  beforeAll(async () => { env = await setup(); }, 180_000);
  afterAll(async () => { await env?.pic.tearDown(); });

  it('transfer_tokens racing an incoming token lock transfer never pays out the incoming locked tokens', async () => {
    const L = 1_000_000n;
    const broken = [];
    for (const k of OFFSETS) {
      const owner = user(`race1-owner-${k}`);
      const to = user(`race1-to-${k}`);
      await env.tokenA.mint(env.wallet(owner), L + FEE_A);
      const lockId = unwrap(await env.lockAs(owner).create_lock(L, env.tokenAId, (await env.nowNs()) + DAY_NS, []));
      const [moved, sent] = await env.raceAt(k,
        ['transfer_token_lock_ownership', owner, [to, env.tokenAId, lockId]],
        ['transfer_tokens', to, [to, [], env.tokenAId, L - FEE_A]],
      );
      const bal = await env.tokenA.icrc1_balance_of(env.wallet(to));
      const locked = await env.lockedOf(to, env.tokenAId);
      if (bal < locked) broken.push({ k, moved: Object.keys(moved)[0], sent: Object.keys(sent)[0], bal, locked });
    }
    console.log('transfer_tokens race: offsets where a lock was left unbacked:', JSON.stringify(broken, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    expect(broken).toEqual([]);
  });

  it('transfer_position racing create_position_lock of the same position never leaves an active lock on a position that left', async () => {
    const broken = [];
    let pos = 200n;
    for (const k of OFFSETS) {
      const who = user(`race3-${k}`);
      pos += 1n;
      await env.pool.mint_position(who, pos, 1_000_000n);
      expect(await env.lockAs(who).claim_position(env.poolId, pos)).toBe(true);
      unwrap(await env.poolAs(who).transferPosition(who, env.lockId, pos));
      const [created, withdrawn] = await env.raceAt(k,
        ['create_position_lock', who, [env.poolId, 1n, pos, (await env.nowNs()) + DAY_NS, env.tokenAId, env.tokenBId, []]],
        ['transfer_position', who, [who, env.poolId, pos]],
      );
      const holder = (await env.pool.position_owner(pos))[0];
      const active = await env.lockAs(who).get_lock_states_page({ owner: [who], ledger: [], swap_canister_id: [env.poolId], token: [], kind: [{ PositionLock: null }], status: [{ Active: null }], include_archived: false, prev: [], take: [] });
      if (active.length > 0 && holder.toText() !== env.lockId.toText()) {
        broken.push({ k, created: Object.keys(created)[0], withdrawn: Object.keys(withdrawn)[0], holder: holder.toText(), lock: active[0].lock_id });
      }
    }
    console.log('transfer_position race: offsets with an active lock on a position Sneed Lock no longer holds:', JSON.stringify(broken, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    expect(broken).toEqual([]);
  });
});
