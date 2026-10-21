// Sneed Lock: token lock transfers with an unknown ledger outcome (spec/support_audit.md, sneed_lock
// critical finding). When the ledger call of transfer_token_lock_ownership throws with a reject
// that does not rule out execution, the lock is kept on both sides (so neither side's tokens are
// ever unlocked) and the move is recorded with its created_at_time and memo. reconcile_token_lock
// (either holder or an admin) resolves it to exactly one side from the ledger: the balances when
// only one wallet covers its locks, else the deduplicated resubmission of the same transfer
// (#Duplicate: it had landed; #Ok: it had not and now has), else (past the dedup window) the
// original owner; for a transfer from before reconciliation with both covered, an admin names the
// side. Meanwhile the lock cannot move again; once reconciled a dissolve-delay lock can dissolve.
// get_uncertain_token_locks lists them publicly. Plus the upgrade from production (f9d8db0b,
// module hash ea866993…), which recorded no move.
// The ledger: MockRejectLedger (#reject_after moves the tokens then rejects, #reject_before
// rejects without moving; set_dedupe makes it deduplicate like an ICRC-1 ledger).
// SNEED_LOCK_WASM=<path without .wasm> runs it against another build (the code before the fix:
// every test here fails).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, account, principalToSubaccount, admin, alice, bob, carol, user, ICP_LEDGER_ID, T, unwrap, errOf, wasm } from '../lib/pic.js';
import { ledgerInit } from '../lib/idl.js';
import { btype, txField } from '../lib/icrc3.js';
import { idlFactory as sneedLockIdl } from '../build/sneed_lock.did.js';

const SNEED_LOCK_WASM = process.env.SNEED_LOCK_WASM || 'sneed_lock';
const FEE = 1_000n;
const L = 1_000_000n;
const HOUR = 3600n * 1_000_000_000n;
const DAY_NS = 24n * HOUR;
const dave = user('dave');
const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const rejLedgerIdl = ({ IDL }) => IDL.Service({
  icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ['query']),
  mint: IDL.Func([Account, IDL.Nat], [], []),
  set_mode: IDL.Func([IDL.Variant({ normal: IDL.Null, reject_before: IDL.Null, reject_after: IDL.Null })], [], []),
  set_dedupe: IDL.Func([IDL.Bool], [], []),
  get_transactions: IDL.Func([], [IDL.Vec(IDL.Record({ from: Account, to: Account, amount: IDL.Nat, memo: IDL.Opt(IDL.Vec(IDL.Nat8)) }))], ['query']),
});
const icpLedgerInit = [IDL.Record({ fee: IDL.Nat, symbol: IDL.Text, decimals: IDL.Nat8 })];

/// One Sneed Lock and one rejecting token ledger in a fresh PocketIC.
async function setup(lockWasm = SNEED_LOCK_WASM) {
  const { pic, appSubnet } = await createPic();
  await install(pic, { name: 'MockLedger', initTypes: icpLedgerInit, initArgs: [{ fee: 10_000n, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  const tokenId = await install(pic, { name: 'MockRejectLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE, symbol: 'REJ', decimals: 8 }], targetSubnetId: appSubnet });
  const lockId = await install(pic, { name: lockWasm, cycles: 20n * T, targetSubnetId: appSubnet });
  await pic.tick(3);
  const token = actorAs(pic, rejLedgerIdl, tokenId, admin);
  await token.set_dedupe(true);
  const lockAs = (p) => actorAs(pic, sneedLockIdl, lockId, p);
  const wallet = (p) => account(lockId, principalToSubaccount(p));
  const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
  return { pic, tokenId, lockId, token, lockAs, wallet, nowNs, bal: (p) => token.icrc1_balance_of(wallet(p)) };
}

/// A lock of L for `who` (expiring in 3 days, or with a dissolve delay), with `free` left over.
async function newLock(env, who, free, delay = []) {
  await env.token.mint(env.wallet(who), L + free);
  const expiry = delay.length ? 0n : (await env.nowNs()) + 3n * DAY_NS;
  return unwrap(await env.lockAs(who).create_lock(L, env.tokenId, expiry, delay));
}

/// Transfers lock `id` (from alice to bob by default) while the ledger answers with a reject (`mode`).
async function uncertainTransfer(env, id, mode, from = alice, to = bob) {
  await env.token.set_mode({ [mode]: null });
  try {
    return await env.lockAs(from).transfer_token_lock_ownership(to, env.tokenId, id);
  } finally {
    await env.token.set_mode({ normal: null });
  }
}
const holders = async (env, id) => (await env.lockAs(carol).get_uncertain_token_locks()).find((u) => u.lock_id === id)?.holders.map((p) => p.toText()).sort() ?? [];
const lastBlock = async (env) => {
  const lock = env.lockAs(admin);
  const s = await lock.icrc3_log_status();
  return (await lock.icrc3_get_blocks([{ start: s.log_length - 1n, length: 1n }])).blocks[0].block;
};
const sorted = (...ps) => ps.map((p) => p.toText()).sort();

describe('reconciling a lock transfer with an unknown outcome', () => {
  let env;
  beforeAll(async () => { env = await setup(); }, 120_000);
  afterAll(async () => { await env?.pic.tearDown(); });

  let id;
  it('a transfer that landed but answered with a reject: the lock is on both sides, recorded with its dedup key, and cannot move again', async () => {
    id = await newLock(env, alice, FEE);
    const r = await uncertainTransfer(env, id, 'reject_after');
    expect(errOf(r).message).toMatch(/unknown outcome; lock kept on both caller and recipient pending reconciliation/);
    expect(await env.bal(bob)).toBe(L); // it did land
    expect(await holders(env, id)).toEqual(sorted(alice, bob));
    const [u] = (await env.lockAs(carol).get_uncertain_token_locks()).filter((x) => x.lock_id === id);
    expect(u.move[0]).toMatchObject({ from: alice, to: bob, amount: L, ledger: env.tokenId });
    expect(u.move[0].created_at_time > 0n).toBe(true);
    expect(Array.from(u.move[0].memo.slice(0, 4))).toEqual([0x53, 0x4c, 0x4d, 0x56]); // "SLMV"
    // the transfer carried that memo
    const txs = await env.token.get_transactions();
    expect(Array.from(txs[txs.length - 1].memo[0])).toEqual(Array.from(u.move[0].memo));
    // held twice: no other change and no second move
    expect(errOf(await env.lockAs(bob).extend_lock(id, (await env.nowNs()) + 4n * DAY_NS))).toEqual({ InProgress: null });
    expect(errOf(await env.lockAs(alice).transfer_token_lock_ownership(carol, env.tokenId, id)).message).toMatch(/awaits reconciliation/);
  });

  it('only a holder or an admin reconciles; only an admin names a side', async () => {
    expect(errOf(await env.lockAs(carol).reconcile_token_lock(id, []))).toMatch(/Only the lock's holders/);
    expect(errOf(await env.lockAs(alice).reconcile_token_lock(id, [alice]))).toMatch(/Only an admin/);
  });

  it('balances decide when only one wallet covers its locks: the recipient keeps it, with the NFT; logged; a repeat is a no-op', async () => {
    const r = unwrap(await env.lockAs(alice).reconcile_token_lock(id, []));
    expect(r.owner.toText()).toBe(bob.toText());
    expect(r.evidence).toMatch(/balances/);
    expect(await holders(env, id)).toEqual([]);
    expect((await env.lockAs(carol).get_lock_state(id))[0].owner.toText()).toBe(bob.toText());
    expect((await env.lockAs(carol).icrc7_owner_of([id]))[0][0].owner.toText()).toBe(bob.toText());
    const b = await lastBlock(env);
    expect(btype(b)).toBe('sneedlock_token_lock_reconcile');
    expect(txField(b, 'evidence').Text).toMatch(/balances/);
    // bob owns it fully again: it extends; alice holds nothing locked
    unwrap(await env.lockAs(bob).extend_lock(id, (await env.nowNs()) + 4n * DAY_NS));
    expect(await env.lockAs(alice).get_summed_locks()).toEqual([[env.tokenId, 0n]]);
    expect(unwrap(await env.lockAs(alice).reconcile_token_lock(id, [])).owner.toText()).toBe(bob.toText());
  });

  it('a dissolve-delay lock whose transfer did not land: stuck (InProgress) until reconciled, then kept by the sender and it dissolves', async () => {
    const d = await newLock(env, alice, FEE, [HOUR]);
    errOf(await uncertainTransfer(env, d, 'reject_before'));
    expect(await env.bal(alice)).toBe(L + FEE); // nothing moved
    expect(errOf(await env.lockAs(alice).start_dissolving(d))).toEqual({ InProgress: null });
    const r = unwrap(await env.lockAs(bob).reconcile_token_lock(d, []));
    expect(r.owner.toText()).toBe(alice.toText());
    expect(await holders(env, d)).toEqual([]);
    expect((await env.lockAs(carol).get_lock_state(d))[0].owner.toText()).toBe(alice.toText());
    expect((await env.lockAs(bob).get_summed_locks()).find(([t]) => t.toText() === env.tokenId.toText())[1]).toBe(L); // the earlier lock only
    expect(unwrap(await env.lockAs(alice).start_dissolving(d)).dissolving_until.length).toBe(1);
  });

  it('both wallets cover it and the transfer landed: the resubmission is a ledger duplicate, the recipient keeps it, nothing moves twice', async () => {
    await env.token.mint(env.wallet(bob), 2n * L); // bob has free tokens of his own
    const c = await newLock(env, alice, L + 3n * FEE); // alice keeps enough free to cover it twice
    errOf(await uncertainTransfer(env, c, 'reject_after'));
    const [a0, b0, n0] = [await env.bal(alice), await env.bal(bob), (await env.token.get_transactions()).length];
    const r = unwrap(await env.lockAs(bob).reconcile_token_lock(c, []));
    expect(r.owner.toText()).toBe(bob.toText());
    expect(r.evidence).toMatch(/had landed \(duplicate of block/);
    expect([await env.bal(alice), await env.bal(bob), (await env.token.get_transactions()).length]).toEqual([a0, b0, n0]);
    expect(txField(await lastBlock(env), 'ledger_tx')).toEqual({ Nat: BigInt(n0 - 1) });
  });

  it('both cover it and the transfer did not land: the resubmission lands now and the recipient keeps it (the move completes once)', async () => {
    const c = await newLock(env, alice, L + 3n * FEE);
    errOf(await uncertainTransfer(env, c, 'reject_before'));
    const [a0, b0] = [await env.bal(alice), await env.bal(bob)];
    const r = unwrap(await env.lockAs(alice).reconcile_token_lock(c, []));
    expect(r.owner.toText()).toBe(bob.toText());
    expect(r.evidence).toMatch(/had not landed; resubmitted/);
    expect([await env.bal(alice), await env.bal(bob)]).toEqual([a0 - L - FEE, b0 + L]);
    // every lock is still backed
    for (const p of [alice, bob]) {
      const locked = (await env.lockAs(p).get_summed_locks()).find(([t]) => t.toText() === env.tokenId.toText())?.[1] ?? 0n;
      expect(await env.bal(p) >= locked).toBe(true);
    }
  });

  it('past the ledger\'s deduplication window with both covered: the original owner keeps it, nothing moves', async () => {
    const c = await newLock(env, alice, L + 3n * FEE);
    errOf(await uncertainTransfer(env, c, 'reject_before'));
    await env.pic.advanceTime(25 * 3600 * 1000);
    await env.pic.tick();
    const [a0, b0] = [await env.bal(alice), await env.bal(bob)];
    const r = unwrap(await env.lockAs(admin).reconcile_token_lock(c, []));
    expect(r.owner.toText()).toBe(alice.toText());
    expect(r.evidence).toMatch(/deduplication window/);
    expect([await env.bal(alice), await env.bal(bob)]).toEqual([a0, b0]);
  });
});

describe('upgrade from production (f9d8db0b, module hash ea866993…): a lock left on both sides before the upgrade', () => {
  it('is listed (no recorded move) and reconciled from balances; with both covered an admin names the side', async () => {
    const env = await setup('sneed_lock_presp');
    try {
      const landed = await newLock(env, alice, FEE);
      errOf(await uncertainTransfer(env, landed, 'reject_after'));
      // carol to dave, both wallets covering it
      await env.token.mint(env.wallet(dave), 2n * L);
      const both = await newLock(env, carol, L + 3n * FEE);
      errOf(await uncertainTransfer(env, both, 'reject_before', carol, dave));
      await env.pic.upgradeCanister({ sender: admin, canisterId: env.lockId, wasm: wasm(SNEED_LOCK_WASM), arg: IDL.encode([], []) });
      await env.pic.tick(3);
      const listed = await env.lockAs(carol).get_uncertain_token_locks();
      expect(listed.map((u) => [u.lock_id, u.holders.map((p) => p.toText()).sort(), u.move.length]).sort((a, b) => Number(a[0] - b[0]))).toEqual(
        [[landed, sorted(alice, bob), 0], [both, sorted(carol, dave), 0]].sort((a, b) => Number(a[0] - b[0])));
      expect(unwrap(await env.lockAs(bob).reconcile_token_lock(landed, [])).owner.toText()).toBe(bob.toText());
      expect(errOf(await env.lockAs(dave).reconcile_token_lock(both, []))).toMatch(/an admin names the side/);
      expect(errOf(await env.lockAs(admin).reconcile_token_lock(both, [alice]))).toMatch(/one of the lock's holders/);
      expect(unwrap(await env.lockAs(admin).reconcile_token_lock(both, [carol])).owner.toText()).toBe(carol.toText());
      expect(await env.lockAs(carol).get_uncertain_token_locks()).toEqual([]);
    } finally {
      await env.pic.tearDown();
    }
  }, 180_000);
});
