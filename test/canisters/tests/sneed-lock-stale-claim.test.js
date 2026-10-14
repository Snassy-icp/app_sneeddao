// A claim is a record that a principal owned a position on the pool. If the position then
// moves to someone else at the pool, the old claim must not let its holder take the position
// once someone else has deposited and locked it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, account, admin, alice, bob, carol, ICP_LEDGER_ID, T, unwrap, errOf } from '../lib/pic.js';
import { ledgerIdl, ledgerInit, poolIdl, poolInit } from '../lib/idl.js';
import { idlFactory as sneedLockIdl } from '../build/sneed_lock.did.js';

let pic, appSubnet, poolId, lockId, tokenAId, tokenBId;
let pool, poolAlice, poolBob, lockAlice, lockBob, lock;
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 10_000n, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 1_000n, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  tokenBId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 500n, symbol: 'BBB', decimals: 8 }], targetSubnetId: appSubnet });
  poolId = await install(pic, { name: 'MockSwapPool', initTypes: poolInit, initArgs: [{ token0: tokenAId, token1: tokenBId, fee: 3000n }], targetSubnetId: appSubnet });
  lockId = await install(pic, { name: 'sneed_lock', cycles: 20n * T, targetSubnetId: appSubnet });
  pool = actorAs(pic, poolIdl, poolId, admin);
  poolAlice = actorAs(pic, poolIdl, poolId, alice);
  poolBob = actorAs(pic, poolIdl, poolId, bob);
  lock = actorAs(pic, sneedLockIdl, lockId, admin);
  lockAlice = actorAs(pic, sneedLockIdl, lockId, alice);
  lockBob = actorAs(pic, sneedLockIdl, lockId, bob);
  await pic.tick(2);
});
afterAll(async () => { await pic?.tearDown(); });

describe('stale position claims', () => {
  const POS = 9n;
  it('a claim left behind by a previous owner cannot withdraw or move a position someone else deposited and locked', async () => {
    await pool.mint_position(alice, POS, 1_000_000n);
    expect(await lockAlice.claim_position(poolId, POS)).toBe(true);
    // alice gives the position to bob at the pool instead of depositing it
    unwrap(await poolAlice.transferPosition(alice, bob, POS));
    expect(await lockBob.claim_position(poolId, POS)).toBe(true);
    unwrap(await poolBob.transferPosition(bob, lockId, POS));
    unwrap(await lockBob.create_position_lock(poolId, 1n, POS, (await nowNs()) + 86_400n * 1_000_000_000n, tokenAId, tokenBId, []));
    // alice's old claim must not take it
    const w = await lockAlice.transfer_position(alice, poolId, POS);
    expect(w).toHaveProperty('err');
    expect((await pool.position_owner(POS))[0].toText()).toBe(lockId.toText());
    const t = await lockAlice.transfer_position_ownership(carol, poolId, POS);
    expect(t).toHaveProperty('Err');
    expect((await lock.get_claimed_positions_for_principal(carol))).toEqual([]);
    // bob's claim removed alice's, and says so in the log
    expect(await lock.get_claimed_positions_for_principal(alice)).toEqual([]);
    expect(await lockAlice.claim_position(poolId, POS)).toBe(false); // the pool says she does not own it
    const s = await lock.icrc3_log_status();
    const blocks = (await lock.icrc3_get_blocks([{ start: 0n, length: s.log_length }])).blocks.map((b) => b.block);
    const claimBlock = blocks.filter((b) => b.Map.find(([k]) => k === 'btype')[1].Text === 'sneedlock_position_claim')[1];
    const tx = claimBlock.Map.find(([k]) => k === 'tx')[1].Map;
    expect(tx.find(([k]) => k === 'removed_claims')[1].Array.map((v) => Principal.fromUint8Array(new Uint8Array(v.Blob)).toText())).toEqual([alice.toText()]);
  });

  it('the rightful owner keeps every right: moving it, and withdrawing once the lock ends', async () => {
    unwrap(await lockBob.transfer_position_ownership(carol, poolId, POS));
    const lockCarol = actorAs(pic, sneedLockIdl, lockId, carol);
    expect(await lockCarol.transfer_position(carol, poolId, POS)).toHaveProperty('err'); // still locked
    await pic.advanceTime(2 * 86_400 * 1000); await pic.tick();
    expect(await lockCarol.transfer_position(carol, poolId, POS)).toHaveProperty('ok');
    expect((await pool.position_owner(POS))[0].toText()).toBe(carol.toText());
  });
});
