// Locked LP positions as NFTs (spec/sneed_lock_v2.md, sections 2 and 3): ICRC-7 with
// ICRC-37 on sneed_lock. One NFT per position held by Sneed Lock that has been locked at
// least once, owned by the position's claimant, with a label for the subaccount.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, ICP_LEDGER_ID, T, unwrap, errOf, wasm } from '../lib/pic.js';
import { ledgerInit, poolIdl, poolInit } from '../lib/idl.js';
import { btype, txField } from '../lib/icrc3.js';
import { idlFactory as sneedLockIdl } from '../build/sneed_lock.did.js';

const DAY_NS = 86_400n * 1_000_000_000n;
const sub = (n) => new Uint8Array(32).fill(n);
const acc = (owner, s) => ({ owner, subaccount: s ? [s] : [] });
const ownerText = (o) => (o ? `${o.owner.toText()}${o.subaccount.length ? `.${o.subaccount[0][0]}` : ''}` : null);

let pic, appSubnet, poolId, lockId, tokenAId, tokenBId;
let pool, poolAlice, lock, lockAlice, lockBob, lockCarol;
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const lastBlocks = async (actor, n) => {
  const s = await actor.icrc3_log_status();
  const r = await actor.icrc3_get_blocks([{ start: s.log_length - BigInt(n), length: BigInt(n) }]);
  return r.blocks.map((b) => b.block);
};
const owners = async (ids) => (await lock.icrc7_owner_of(ids)).map(([o]) => ownerText(o));
const meta = async (id) => Object.fromEntries((await lock.icrc7_token_metadata([id]))[0][0]);

let nextPos = 100n;
/** A position owned by `who` on the pool, claimed, deposited and locked; answers [position id, lock id]. */
async function lockedPosition(who, actor, days = 1n, delay = []) {
  const pos = nextPos++;
  await pool.mint_position(who, pos, 1_000_000n);
  expect(await actor.claim_position(poolId, pos)).toBe(true);
  unwrap(await actorAs(pic, poolIdl, poolId, who).transferPosition(who, lockId, pos));
  const id = unwrap(await actor.create_position_lock(poolId, 1n, pos, (await nowNs()) + days * DAY_NS, tokenAId, tokenBId, delay));
  return [pos, id];
}

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 10_000n, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 1_000n, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  tokenBId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 500n, symbol: 'BBB', decimals: 8 }], targetSubnetId: appSubnet });
  poolId = await install(pic, { name: 'MockSwapPool', initTypes: poolInit, initArgs: [{ token0: tokenAId, token1: tokenBId, fee: 3000n }], targetSubnetId: appSubnet });
  lockId = await install(pic, { name: 'sneed_lock', cycles: 20n * T, targetSubnetId: appSubnet });
  pool = actorAs(pic, poolIdl, poolId, admin);
  poolAlice = actorAs(pic, poolIdl, poolId, alice);
  lock = actorAs(pic, sneedLockIdl, lockId, admin);
  lockAlice = actorAs(pic, sneedLockIdl, lockId, alice);
  lockBob = actorAs(pic, sneedLockIdl, lockId, bob);
  lockCarol = actorAs(pic, sneedLockIdl, lockId, carol);
  await pic.tick(2);
});
afterAll(async () => { await pic?.tearDown(); });

describe('the collection', () => {
  it('advertises ICRC-7 and ICRC-37, and starts empty', async () => {
    const names = (await lock.icrc10_supported_standards()).map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['ICRC-3', 'ICRC-7', 'ICRC-10', 'ICRC-37']));
    expect(await lock.icrc7_name()).toBe('Sneed Lock');
    expect(await lock.icrc7_symbol()).toBe('SLOCK');
    expect(await lock.icrc7_total_supply()).toBe(0n);
    expect(await lock.icrc7_tokens([], [])).toEqual([]);
    const types = (await lock.icrc3_supported_block_types()).map((t) => t.block_type);
    expect(types).toEqual(expect.arrayContaining(['7mint', '7burn', '7xfer', '37approve', '37approve_coll', '37revoke', '37revoke_coll', '37xfer']));
  });

  it('a claimed position that was never locked has no NFT', async () => {
    const pos = nextPos++;
    await pool.mint_position(alice, pos, 1n);
    expect(await lockAlice.claim_position(poolId, pos)).toBe(true);
    expect(await lock.get_position_nft(poolId, pos)).toEqual([]);
    expect(await lock.icrc7_total_supply()).toBe(0n);
  });
});

describe('minting, metadata and transfers', () => {
  let pos, tid;

  it('locking a position mints its NFT, with the lock id as token id, to the owner', async () => {
    [pos, tid] = await lockedPosition(alice, lockAlice);
    expect(await lock.get_position_nft(poolId, pos)).toEqual([tid]);
    expect(await owners([tid])).toEqual([alice.toText()]);
    expect(await lock.icrc7_balance_of([acc(alice)])).toEqual([1n]);
    expect(await lock.icrc7_tokens_of(acc(alice), [], [])).toEqual([tid]);
    const [create, mint] = await lastBlocks(lock, 2);
    expect(btype(create)).toBe('sneedlock_position_lock_create');
    expect(btype(mint)).toBe('7mint');
    expect(txField(mint, 'tid')).toEqual({ Nat: tid });
  });

  it('describes the position: pair symbols, a card, the lock fields', async () => {
    await pic.tick(3); // the symbol fetch runs on a timer
    const m = await meta(tid);
    expect(m['icrc7:name']).toEqual({ Text: 'AAA/BBB LP lock' });
    expect(m['icrc7:image'].Text).toMatch(/^data:image\/svg\+xml;utf8,/);
    expect(decodeURIComponent(m['icrc7:image'].Text)).toContain('AAA/BBB');
    expect(m['sneedlock:position_id']).toEqual({ Nat: pos });
    expect(m['sneedlock:swap']).toEqual({ Text: poolId.toText() });
    expect(m['sneedlock:lock_id']).toEqual({ Nat: tid });
    expect(m['sneedlock:locked']).toEqual({ Text: 'true' });
    expect((await lock.icrc7_token_metadata([999_999n]))[0]).toEqual([]);
  });

  it('only the holding account may transfer; recipients are checked', async () => {
    const t = (actor, arg) => actor.icrc7_transfer([{ from_subaccount: [], to: acc(bob), token_id: tid, memo: [], created_at_time: [], ...arg }]);
    expect((await t(lockBob, {}))[0][0]).toEqual({ Err: { Unauthorized: null } });
    expect((await t(lockAlice, { from_subaccount: [sub(1)] }))[0][0]).toEqual({ Err: { Unauthorized: null } });
    expect((await t(lockAlice, { to: acc(alice) }))[0][0]).toEqual({ Err: { InvalidRecipient: null } });
    expect((await t(lockAlice, { to: acc(alice, new Uint8Array(32)) }))[0][0]).toEqual({ Err: { InvalidRecipient: null } }); // zero subaccount = default
    expect((await t(lockAlice, { to: acc(Principal.anonymous()) }))[0][0]).toEqual({ Err: { InvalidRecipient: null } });
    expect((await t(lockAlice, { token_id: 999_999n }))[0][0]).toEqual({ Err: { NonExistingTokenId: null } });
    expect((await t(lockAlice, { memo: [new Uint8Array(33)] }))[0][0].Err).toHaveProperty('GenericError');
    expect((await lockAlice.icrc7_transfer(Array(11).fill({ from_subaccount: [], to: acc(bob), token_id: tid, memo: [], created_at_time: [] })))[0][0].Err).toHaveProperty('GenericBatchError');
  });

  it('a transfer moves the position, its lock and the label; the old owner can do nothing more', async () => {
    const r = await lockAlice.icrc7_transfer([{ from_subaccount: [], to: acc(bob, sub(7)), token_id: tid, memo: [new Uint8Array([1, 2])], created_at_time: [] }]);
    const block = r[0][0].Ok;
    expect(await owners([tid])).toEqual([`${bob.toText()}.7`]);
    const st = (await lock.get_lock_state(tid))[0];
    expect(st.owner.toText()).toBe(bob.toText());
    expect(st.owner_subaccount).toEqual([sub(7)]);
    expect((await lock.get_claimed_positions_for_principal(bob)).map((c) => c.position_id)).toContain(pos);
    expect((await lock.get_claimed_positions_for_principal(alice)).map((c) => c.position_id)).not.toContain(pos);
    const [legacy, xfer] = await lastBlocks(lock, 2);
    expect(btype(legacy)).toBe('sneedlock_position_transfer');
    expect(btype(xfer)).toBe('7xfer');
    expect((await lock.icrc3_log_status()).log_length - 1n).toBe(block);
    expect(txField(xfer, 'memo')).toEqual({ Blob: new Uint8Array([1, 2]) });
    // alice: no transfer, no withdrawal
    expect(errOf(await lockAlice.transfer_position_ownership(carol, poolId, pos)).message).toMatch(/not the owner/);
    // bob from the wrong account of his
    expect((await lockBob.icrc7_transfer([{ from_subaccount: [], to: acc(carol), token_id: tid, memo: [], created_at_time: [] }]))[0][0]).toEqual({ Err: { Unauthorized: null } });
    // bob's tokens are per account
    expect(await lock.icrc7_balance_of([acc(bob), acc(bob, sub(7))])).toEqual([0n, 1n]);
  });

  it('moving between accounts of one principal changes only the label', async () => {
    unwrap((await lockBob.icrc7_transfer([{ from_subaccount: [sub(7)], to: acc(bob), token_id: tid, memo: [], created_at_time: [] }]))[0][0]);
    expect(await owners([tid])).toEqual([bob.toText()]);
    expect(btype((await lastBlocks(lock, 1))[0])).toBe('7xfer');
    expect((await lock.get_lock_state(tid))[0].owner_subaccount).toEqual([]);
  });

  it('created_at_time: duplicates, too old and from the future are refused', async () => {
    const now = await nowNs();
    const arg = { from_subaccount: [], to: acc(carol), token_id: tid, memo: [], created_at_time: [now] };
    const first = (await lockBob.icrc7_transfer([arg]))[0][0];
    expect(first).toHaveProperty('Ok');
    // carol sends it back; bob's identical request again is a duplicate
    unwrap((await lockCarol.icrc7_transfer([{ from_subaccount: [], to: acc(bob), token_id: tid, memo: [], created_at_time: [] }]))[0][0]);
    expect((await lockBob.icrc7_transfer([arg]))[0][0]).toEqual({ Err: { Duplicate: { duplicate_of: first.Ok } } });
    expect((await lockBob.icrc7_transfer([{ ...arg, created_at_time: [now - 2n * DAY_NS] }]))[0][0]).toEqual({ Err: { TooOld: null } });
    expect((await lockBob.icrc7_transfer([{ ...arg, created_at_time: [now + DAY_NS] }]))[0][0].Err).toHaveProperty('CreatedInFuture');
    expect(await owners([tid])).toEqual([bob.toText()]);
  });

  it('the new owner runs the lock: extending, dissolve changes', async () => {
    const st = (await lock.get_lock_state(tid))[0];
    expect(unwrap(await lockBob.update_position_lock(poolId, pos, st.expiry + DAY_NS))).toBe(tid);
    expect((await lockAlice.extend_lock(tid, st.expiry + 2n * DAY_NS)).Err).toEqual({ NotOwner: null });
  });

  it('transfer_position_ownership takes the NFT along, to the default account', async () => {
    unwrap((await lockBob.icrc7_transfer([{ from_subaccount: [], to: acc(bob, sub(3)), token_id: tid, memo: [], created_at_time: [] }]))[0][0]);
    unwrap(await lockBob.transfer_position_ownership(carol, poolId, pos));
    expect(await owners([tid])).toEqual([carol.toText()]);
    const xfer = (await lastBlocks(lock, 1))[0];
    expect(btype(xfer)).toBe('7xfer');
    expect(txField(xfer, 'from')).toEqual({ Array: [{ Blob: bob.toUint8Array() }, { Blob: sub(3) }] });
  });
});

describe('ICRC-37 approvals', () => {
  let pos, tid;
  const market = carol; // a marketplace pulling the NFT into an escrow subaccount of its own
  const info = async (spender, extra = {}) => ({ spender, from_subaccount: [], expires_at: [], memo: [], created_at_time: await nowNs(), ...extra });

  it('the owner approves a token; the spender pulls it into its own subaccount', async () => {
    [pos, tid] = await lockedPosition(alice, lockAlice);
    expect((await lockBob.icrc37_approve_tokens([{ token_id: tid, approval_info: await info(acc(market)) }]))[0][0]).toEqual({ Err: { Unauthorized: null } });
    expect((await lockAlice.icrc37_approve_tokens([{ token_id: tid, approval_info: await info(acc(alice)) }]))[0][0]).toEqual({ Err: { InvalidSpender: null } });
    unwrap((await lockAlice.icrc37_approve_tokens([{ token_id: tid, approval_info: await info(acc(market)) }]))[0][0]);
    expect(btype((await lastBlocks(lock, 1))[0])).toBe('37approve');
    expect(await lock.icrc37_is_approved([{ spender: acc(market), from_subaccount: [], token_id: tid }, { spender: acc(bob), from_subaccount: [], token_id: tid }])).toEqual([true, false]);
    expect((await lock.icrc37_get_token_approvals([tid], [], [])).map((a) => a.approval_info.spender.owner.toText())).toEqual([market.toText()]);
    // someone else cannot pull it, and the market cannot pull it from the wrong account
    expect((await lockBob.icrc37_transfer_from([{ spender_subaccount: [], from: acc(alice), to: acc(bob), token_id: tid, memo: [], created_at_time: [] }]))[0][0]).toEqual({ Err: { Unauthorized: null } });
    expect((await lockCarol.icrc37_transfer_from([{ spender_subaccount: [], from: acc(alice, sub(1)), to: acc(market, sub(9)), token_id: tid, memo: [], created_at_time: [] }]))[0][0]).toEqual({ Err: { Unauthorized: null } });
    unwrap((await lockCarol.icrc37_transfer_from([{ spender_subaccount: [], from: acc(alice), to: acc(market, sub(9)), token_id: tid, memo: [], created_at_time: [] }]))[0][0]);
    expect(await owners([tid])).toEqual([`${market.toText()}.9`]);
    const x = (await lastBlocks(lock, 1))[0];
    expect(btype(x)).toBe('37xfer');
    expect(txField(x, 'spender')).toEqual({ Array: [{ Blob: market.toUint8Array() }] });
    // token approvals are gone with the transfer
    expect(await lock.icrc37_get_token_approvals([tid], [], [])).toEqual([]);
  });

  it('collection approvals cover every token of the approving account, and can be revoked', async () => {
    const [, tid2] = await lockedPosition(bob, lockBob);
    unwrap((await lockBob.icrc37_approve_collection([{ approval_info: await info(acc(alice, sub(2))) }]))[0][0]);
    expect(btype((await lastBlocks(lock, 1))[0])).toBe('37approve_coll');
    expect((await lock.icrc37_get_collection_approvals(acc(bob), [], [])).map((a) => a.spender.owner.toText())).toEqual([alice.toText()]);
    expect(await lock.icrc37_is_approved([{ spender: acc(alice, sub(2)), from_subaccount: [], token_id: tid2 }])).toEqual([true]);
    expect(await lock.icrc37_is_approved([{ spender: acc(alice), from_subaccount: [], token_id: tid2 }])).toEqual([false]); // another account of alice
    unwrap((await lockBob.icrc37_revoke_collection_approvals([{ spender: [acc(alice, sub(2))], from_subaccount: [], memo: [], created_at_time: [] }]))[0][0]);
    expect(btype((await lastBlocks(lock, 1))[0])).toBe('37revoke_coll');
    expect((await lockBob.icrc37_revoke_collection_approvals([{ spender: [], from_subaccount: [], memo: [], created_at_time: [] }]))[0][0]).toEqual({ Err: { ApprovalDoesNotExist: null } });
    expect((await lockAlice.icrc37_transfer_from([{ spender_subaccount: [sub(2)], from: acc(bob), to: acc(alice), token_id: tid2, memo: [], created_at_time: [] }]))[0][0]).toEqual({ Err: { Unauthorized: null } });
  });

  it('expired approvals do nothing; token approvals are revocable', async () => {
    const [, tid3] = await lockedPosition(alice, lockAlice);
    const soon = (await nowNs()) + 60n * 1_000_000_000n;
    unwrap((await lockAlice.icrc37_approve_tokens([{ token_id: tid3, approval_info: await info(acc(bob), { expires_at: [soon] }) }]))[0][0]);
    unwrap((await lockAlice.icrc37_approve_tokens([{ token_id: tid3, approval_info: await info(acc(carol)) }]))[0][0]);
    await pic.advanceTime(120_000); await pic.tick();
    expect(await lock.icrc37_is_approved([{ spender: acc(bob), from_subaccount: [], token_id: tid3 }])).toEqual([false]);
    expect((await lockBob.icrc37_transfer_from([{ spender_subaccount: [], from: acc(alice), to: acc(bob), token_id: tid3, memo: [], created_at_time: [] }]))[0][0]).toEqual({ Err: { Unauthorized: null } });
    unwrap((await lockAlice.icrc37_revoke_token_approvals([{ token_id: tid3, spender: [acc(carol)], from_subaccount: [], memo: [], created_at_time: [] }]))[0][0]);
    expect(btype((await lastBlocks(lock, 1))[0])).toBe('37revoke');
    expect(await lock.icrc37_is_approved([{ spender: acc(carol), from_subaccount: [], token_id: tid3 }])).toEqual([false]);
    expect((await lockAlice.icrc37_approve_tokens([{ token_id: tid3, approval_info: await info(acc(carol), { expires_at: [1n] }) }]))[0][0].Err).toHaveProperty('GenericError');
  });
});

describe('the NFT lives as long as the position is held', () => {
  it('re-locking after expiry keeps the token id; withdrawing burns it', async () => {
    const [pos, tid] = await lockedPosition(alice, lockAlice);
    await pic.advanceTime(2 * 86_400 * 1000); await pic.tick();
    const relock = unwrap(await lockAlice.create_position_lock(poolId, 1n, pos, (await nowNs()) + DAY_NS, tokenAId, tokenBId, []));
    expect(relock).not.toBe(tid);
    expect(await lock.get_position_nft(poolId, pos)).toEqual([tid]);
    expect((await meta(tid))['sneedlock:lock_id']).toEqual({ Nat: relock });
    // withdrawal is refused while locked, then burns the NFT
    expect(await lockAlice.transfer_position(alice, poolId, pos)).toHaveProperty('err');
    await pic.advanceTime(2 * 86_400 * 1000); await pic.tick();
    const supply = await lock.icrc7_total_supply();
    expect(await lockAlice.transfer_position(alice, poolId, pos)).toHaveProperty('ok');
    expect(await owners([tid])).toEqual([null]);
    expect(await lock.icrc7_total_supply()).toBe(supply - 1n);
    expect(await lock.get_position_nft(poolId, pos)).toEqual([]);
    const burn = (await lastBlocks(lock, 2)).find((b) => btype(b) === '7burn');
    expect(txField(burn, 'tid')).toEqual({ Nat: tid });
    // deposited and locked again later: a new NFT with a new id
    expect(await lockAlice.claim_position(poolId, pos)).toBe(true);
    unwrap(await poolAlice.transferPosition(alice, lockId, pos));
    const again = unwrap(await lockAlice.create_position_lock(poolId, 1n, pos, (await nowNs()) + DAY_NS, tokenAId, tokenBId, []));
    expect(await lock.get_position_nft(poolId, pos)).toEqual([again]);
  });

  it('lists tokens in id order, paged', async () => {
    const all = await lock.icrc7_tokens([], []);
    expect([...all].sort((a, b) => (a < b ? -1 : 1))).toEqual(all);
    expect(BigInt(all.length)).toBe(await lock.icrc7_total_supply());
    expect(await lock.icrc7_tokens([all[0]], [1n])).toEqual([all[1]]);
  });
});

describe('activation on upgrade', () => {
  it('mints an NFT for every held position that was locked, with its first lock id, and the log stays in order', async () => {
    const oldId = await install(pic, { name: 'sneed_lock_v2a', cycles: 20n * T, targetSubnetId: appSubnet });
    await pic.tick(2);
    const o = (p) => actorAs(pic, sneedLockIdl, oldId, p);
    const mk = async (who, pos, days) => {
      await pool.mint_position(who, pos, 1n);
      expect(await o(who).claim_position(poolId, pos)).toBe(true);
      unwrap(await actorAs(pic, poolIdl, poolId, who).transferPosition(who, oldId, pos));
      return unwrap(await o(who).create_position_lock(poolId, 1n, pos, (await nowNs()) + days * DAY_NS, tokenAId, tokenBId, []));
    };
    const a = await mk(alice, 900n, 3n);
    const b = await mk(bob, 901n, 1n);
    // b expires and is archived but bob still holds the position; then re-locked with a new id
    await pic.advanceTime(2 * 86_400 * 1000); await pic.tick();
    await o(bob).clear_expired_position_locks();
    const b2 = unwrap(await o(bob).create_position_lock(poolId, 1n, 901n, (await nowNs()) + DAY_NS, tokenAId, tokenBId, []));
    // a claimed position never locked: no NFT
    await pool.mint_position(carol, 902n, 1n);
    expect(await o(carol).claim_position(poolId, 902n)).toBe(true);

    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm('sneed_lock'), arg: IDL.encode([], []) });
    await pic.tick(3);
    const up = o(admin);
    expect(await up.get_position_nft(poolId, 900n)).toEqual([a]);
    expect(await up.get_position_nft(poolId, 901n)).toEqual([b]); // the first lock's id, not b2's
    expect(b2).not.toBe(b);
    expect(await up.get_position_nft(poolId, 902n)).toEqual([]);
    expect((await up.icrc7_owner_of([a, b])).map(([x]) => x.owner.toText())).toEqual([alice.toText(), bob.toText()]);
    const s = await up.icrc3_log_status();
    const mints = (await up.icrc3_get_blocks([{ start: 0n, length: s.log_length }])).blocks.map((x) => x.block).filter((x) => btype(x) === '7mint');
    expect(mints.map((m) => txField(m, 'tid').Nat).sort()).toEqual([a, b].sort());
    expect(txField(mints[0], 'meta').Map.find(([k]) => k === 'sneedlock:minted_by')[1]).toEqual({ Text: 'activation' });
    // a second upgrade mints nothing more
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm('sneed_lock'), arg: IDL.encode([], []) });
    await pic.tick(3);
    expect(await up.icrc7_total_supply()).toBe(2n);
  });
});
