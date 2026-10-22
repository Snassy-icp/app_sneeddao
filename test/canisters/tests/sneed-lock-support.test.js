// Sneed Lock support fixes (spec/support_audit.md, P1-9, P1-12 and P1-14 for sneed_lock):
//  - P1-9: the text logs are queries (get_info/error_entries and the id ranges), a principal's log
//    entries and fee payments (get_log_entries_for, get_payment_log_for: that principal or an
//    admin) and a principal's fee-claim history (get_claim_requests_page_for);
//  - P1-12: withdraw_payment_balance returns the caller's unused lock-fee deposit to the caller's
//    own account, refused while a lock creation of the caller runs (ICRC-3 sneedlock_payment_withdraw);
//  - P1-14: create_position_lock checks token0/token1 against the pool's metadata(); both create
//    paths are serialized per caller and re-check after their awaits (no unbacked token lock, no
//    second position lock or fee); every add-liquidity path that leaves a user's tokens in the pool
//    writes a sneedlock_stranded block and a stable record, which admin_withdraw_stranded_to_owner
//    pays to the recorded owner and amount, once;
//  - the upgrade from production (#451, module hash f5919527…, commit c860d472).
// SNEED_LOCK_WASM=sneed_lock_preaudit runs it against production's code: every test of a fix fails.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import {
  createPic, install, actorAs, account, principalToSubaccount, paymentSubaccount, admin, alice, bob, carol, user,
  ICP_LEDGER_ID, T, unwrap, errOf, refusedAtIngress, asUpdates, wasm,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit, poolIdl, poolInit } from '../lib/idl.js';
import { btype, txField } from '../lib/icrc3.js';
import { idlFactory as sneedLockIdl } from '../build/sneed_lock.did.js';

const SNEED_LOCK_WASM = process.env.SNEED_LOCK_WASM || 'sneed_lock';
const ICP_FEE = 10_000n;
const FEE_A = 1_000n;
const FEE_B = 500n;
const E8 = 100_000_000n;
const DAY_NS = 86_400n * 1_000_000_000n;
const dave = user('dave');
const Mode = IDL.Variant({ normal: IDL.Null, err: IDL.Null, trap: IDL.Null });
const poolIdlX = ({ IDL }) => IDL.Service({
  ...Object.fromEntries(poolIdl({ IDL })._fields),
  set_deposit_mode: IDL.Func([Mode], [], []),
  set_withdraw_mode: IDL.Func([Mode], [], []),
});
const lockSvc = sneedLockIdl({ IDL });
const method = (name) => lockSvc._fields.find(([n]) => n === name)[1];

async function setup(lockWasm = SNEED_LOCK_WASM) {
  const { pic, appSubnet } = await createPic();
  const icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  const tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  const tokenBId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_B, symbol: 'BBB', decimals: 8 }], targetSubnetId: appSubnet });
  const poolId = await install(pic, { name: 'MockSwapPool', initTypes: poolInit, initArgs: [{ token0: tokenAId, token1: tokenBId, fee: 3000n }], targetSubnetId: appSubnet });
  const lockId = await install(pic, { name: lockWasm, cycles: 20n * T, targetSubnetId: appSubnet });
  await pic.tick(3);
  const env = {
    pic, icpId, tokenAId, tokenBId, poolId, lockId,
    icp: actorAs(pic, ledgerIdl, icpId, admin),
    tokenA: actorAs(pic, ledgerIdl, tokenAId, admin),
    tokenB: actorAs(pic, ledgerIdl, tokenBId, admin),
    pool: actorAs(pic, poolIdlX, poolId, admin),
    poolAs: (p) => actorAs(pic, poolIdl, poolId, p),
    lockAs: (p) => actorAs(pic, sneedLockIdl, lockId, p),
    wallet: (p) => account(lockId, principalToSubaccount(p)),
    payment: (p) => account(lockId, paymentSubaccount(p)),
    nowNs: async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n,
  };
  env.lock = env.lockAs(admin);
  env.lastBlocks = async (n) => {
    const s = await env.lock.icrc3_log_status();
    const r = await env.lock.icrc3_get_blocks([{ start: s.log_length - BigInt(n), length: BigInt(n) }]);
    return r.blocks.map((b) => b.block);
  };
  env.blocksOfType = async (type) => {
    const s = await env.lock.icrc3_log_status();
    const r = await env.lock.icrc3_get_blocks([{ start: 0n, length: s.log_length }]);
    return r.blocks.map((b) => b.block).filter((b) => btype(b) === type);
  };
  // Two update calls submitted in the same round: the second runs while the first awaits.
  env.race = async ([n1, p1, a1], [n2, p2, a2]) => {
    const submit = (name, sender, args) => pic.submitCall({ canisterId: lockId, method: name, arg: IDL.encode(method(name).argTypes, args), sender });
    const c1 = await submit(n1, p1, a1);
    const c2 = await submit(n2, p2, a2);
    const r1 = IDL.decode(method(n1).retTypes, await pic.awaitCall(c1))[0];
    const r2 = IDL.decode(method(n2).retTypes, await pic.awaitCall(c2))[0];
    return [r1, r2];
  };
  return env;
}

/// A position `pos` of `who`, claimed, moved to Sneed Lock and locked for a day.
async function lockedPosition(env, who, pos) {
  await env.pool.mint_position(who, pos, 1_000_000n);
  expect(await env.lockAs(who).claim_position(env.poolId, pos)).toBe(true);
  unwrap(await env.poolAs(who).transferPosition(who, env.lockId, pos));
  return unwrap(await env.lockAs(who).create_position_lock(env.poolId, 1n, pos, (await env.nowNs()) + DAY_NS, env.tokenAId, env.tokenBId, []));
}

describe('P1-9: support reads', () => {
  let env;
  beforeAll(async () => { env = await setup(); }, 120_000);
  afterAll(async () => { await env?.pic.tearDown(); });

  it('a log range that starts below the oldest id, or is empty, answers [] instead of trapping (CircularBuffer underflow)', async () => {
    errOf(await env.lockAs(carol).create_lock(1n, env.tokenAId, (await env.nowNs()) + DAY_NS, [])); // entries exist, oldest id 1
    // ids [0, 1): before the oldest entry, nothing (old code: length - (oldest - start) = 0, then Iter.range(0, 0 - 1) trapped)
    // As a query call; production's code has these as update methods, so there (fail-before run) the
    // same call goes as an update call and shows the trap rather than a missing query.
    const asUpdate = actorAs(env.pic, asUpdates(sneedLockIdl), env.lockId, alice);
    const call = async (n, ...a) => {
      try { return await env.lock[n](...a); } catch (e) {
        if (/canister_inspect_message|query/i.test(String(e?.message)) && !/underflow/.test(String(e?.message))) return asUpdate[n](...a);
        throw e;
      }
    };
    expect(await call('get_info_entries', 0n, 1n)).toEqual([]);
    expect(await call('get_error_entries', 0n, 0n)).toEqual([]);
    expect(await call('get_error_entries', 1n, 0n)).toEqual([]);
    // a range reaching past the oldest id still starts there
    const [first] = await call('get_error_entries', 0n, 2n);
    expect(first[0].id).toBe(1n);
  });

  it('the text logs answer as queries (an intentional change from update), and the ingress guard refuses them as update calls', async () => {
    // a failing call writes to both logs
    errOf(await env.lockAs(alice).create_lock(10n, env.tokenAId, (await env.nowNs()) + DAY_NS, []));
    for (const n of ['get_error_entries', 'get_info_entries', 'get_error_id_range', 'get_info_id_range']) {
      expect(method(n).annotations).toEqual(['query']);
    }
    const range = await env.lock.get_error_id_range(); // a query call
    expect(range.length).toBe(1);
    const entries = await env.lock.get_error_entries(range[0][0], 10n);
    expect(entries.some((e) => e[0]?.content.includes('Insufficient balance to lock'))).toBe(true);
    expect((await env.lock.get_info_id_range()).length).toBe(1);
    expect((await env.lock.get_info_entries(1n, 5n)).length).toBeGreaterThan(0);
    const asUpdate = actorAs(env.pic, asUpdates(sneedLockIdl), env.lockId, alice);
    await refusedAtIngress(asUpdate.get_error_entries(0n, 1n));
    await refusedAtIngress(asUpdate.get_info_id_range());
    // every query, the new ones included, is in the guard's list
    const queries = lockSvc._fields.filter(([, f]) => f.annotations.includes('query')).map(([n]) => n);
    for (const n of ['get_log_entries_for', 'get_payment_log_for', 'get_claim_requests_page_for', 'get_stranded', 'get_error_entries', 'get_info_entries', 'get_error_id_range', 'get_info_id_range']) {
      expect(queries).toContain(n);
    }
    const anyOf = (t) => ({ NatClass: 0n, BoolClass: false, PrincipalClass: alice, OptClass: [] })[t.constructor.name]
      ?? (t.constructor.name === 'RecordClass' ? Object.fromEntries(t._fields.map(([k, ft]) => [k, anyOf(ft)])) : undefined);
    for (const n of ['get_log_entries_for', 'get_payment_log_for', 'get_claim_requests_page_for', 'get_stranded']) {
      await refusedAtIngress(asUpdate[n](...method(n).argTypes.map(anyOf)));
    }
  });

  it("get_log_entries_for: a principal's own entries, newest first, paged; for that principal or an admin", async () => {
    errOf(await env.lockAs(bob).create_lock(20n, env.tokenAId, (await env.nowNs()) + DAY_NS, []));
    errOf(await env.lockAs(alice).create_lock(30n, env.tokenAId, (await env.nowNs()) + DAY_NS, []));
    const mine = unwrap(await env.lockAs(alice).get_log_entries_for(alice, { errors: true, before: [], take: [] }));
    expect(mine.length).toBe(2);
    expect(mine.every((e) => e.caller.toText() === alice.toText())).toBe(true);
    expect(mine[0].id > mine[1].id).toBe(true); // newest first
    expect(mine[0].content).toMatch(/Required: 30/);
    const older = unwrap(await env.lockAs(alice).get_log_entries_for(alice, { errors: true, before: [mine[0].id], take: [1n] }));
    expect(older.map((e) => e.id)).toEqual([mine[1].id]);
    expect(unwrap(await env.lockAs(admin).get_log_entries_for(bob, { errors: true, before: [], take: [] })).length).toBe(1);
    expect(unwrap(await env.lockAs(alice).get_log_entries_for(alice, { errors: false, before: [], take: [] })).length).toBeGreaterThan(0);
    expect(errOf(await env.lockAs(bob).get_log_entries_for(alice, { errors: true, before: [], take: [] }))).toMatch(/or an admin/);
  });

  it('get_payment_log_for: one payer\'s fee payments, newest first; for that payer or an admin', async () => {
    unwrap(await env.lock.admin_set_lock_fees_icp([E8], [], [], []));
    for (const [who, n] of [[alice, 2], [bob, 1]]) {
      await env.icp.mint(env.payment(who), BigInt(n) * E8);
      await env.tokenA.mint(env.wallet(who), BigInt(n) * 1_000n);
      for (let i = 0; i < n; i++) unwrap(await env.lockAs(who).create_lock(1_000n, env.tokenAId, (await env.nowNs()) + DAY_NS, []));
    }
    const a = unwrap(await env.lockAs(alice).get_payment_log_for(alice, 0n, 10n));
    expect(a.total_count).toBe(2n);
    expect(a.has_more).toBe(false);
    expect(a.payments.map((p) => p.payer.toText())).toEqual([alice.toText(), alice.toText()]);
    expect(a.payments[0].id > a.payments[1].id).toBe(true);
    const page = unwrap(await env.lockAs(alice).get_payment_log_for(alice, 1n, 1n));
    expect(page.payments.map((p) => p.id)).toEqual([a.payments[1].id]);
    expect(unwrap(await env.lock.get_payment_log_for(bob, 0n, 10n)).total_count).toBe(1n);
    expect(errOf(await env.lockAs(carol).get_payment_log_for(alice, 0n, 10n))).toMatch(/or an admin/);
    unwrap(await env.lock.admin_set_lock_fees_icp([0n], [], [], []));
  });

  it("get_claim_requests_page_for: one owner's fee-claim history", async () => {
    await lockedPosition(env, alice, 3n);
    await lockedPosition(env, bob, 4n);
    await env.tokenA.mint(account(env.poolId), 1_000_000n); // what the pool delivers claimed fees from
    await env.tokenB.mint(account(env.poolId), 1_000_000n);
    for (const [who, pos] of [[alice, 3n], [bob, 4n], [alice, 3n]]) {
      await env.pool.set_tokens_owed(pos, 10_000n, 10_000n);
      unwrap(await env.lockAs(who).claim_position_fees(env.poolId, pos));
    }
    const q = { failed: false, prev: [], take: [] };
    const a = await env.lock.get_claim_requests_page_for(alice, q);
    expect(a.map((r) => r.caller.toText())).toEqual([alice.toText(), alice.toText()]);
    expect(a[0].request_id < a[1].request_id).toBe(true);
    expect((await env.lock.get_claim_requests_page_for(alice, { ...q, prev: [a[0].request_id] })).map((r) => r.request_id)).toEqual([a[1].request_id]);
    expect((await env.lock.get_claim_requests_page_for(bob, q)).length).toBe(1);
    expect(await env.lock.get_claim_requests_page_for(carol, q)).toEqual([]);
    expect((await env.lock.get_claim_requests_page(q)).length).toBe(3); // unchanged
  });
});

describe('P1-12: withdraw_payment_balance', () => {
  let env;
  beforeAll(async () => { env = await setup(); }, 120_000);
  afterAll(async () => { await env?.pic.tearDown(); });

  it("returns the caller's unused deposit to the caller's own account, logged; then nothing is left", async () => {
    await env.icp.mint(env.payment(alice), 3n * E8);
    const r = unwrap(await env.lockAs(alice).withdraw_payment_balance());
    expect(r.amount).toBe(3n * E8 - ICP_FEE);
    expect(await env.icp.icrc1_balance_of(account(alice))).toBe(3n * E8 - ICP_FEE);
    expect(await env.lock.getPaymentBalance(alice)).toBe(0n);
    const [b] = await env.lastBlocks(1);
    expect(btype(b)).toBe('sneedlock_payment_withdraw');
    expect(txField(b, 'amount')).toEqual({ Nat: 3n * E8 - ICP_FEE });
    expect(txField(b, 'icp_tx')).toEqual({ Nat: r.icp_tx });
    expect(txField(b, 'to')).toEqual({ Array: [{ Blob: alice.toUint8Array() }] });
    expect(errOf(await env.lockAs(alice).withdraw_payment_balance())).toMatch(/Nothing to withdraw/);
    // only ever the caller's own subaccount: bob's deposit is untouched by alice
    await env.icp.mint(env.payment(bob), E8);
    errOf(await env.lockAs(alice).withdraw_payment_balance());
    expect(await env.lock.getPaymentBalance(bob)).toBe(E8);
  });

  it('is refused while a lock creation of the caller runs, which then charges its fee', async () => {
    unwrap(await env.lock.admin_set_lock_fees_icp([E8], [], [], []));
    await env.icp.mint(env.payment(carol), 2n * E8);
    await env.tokenA.mint(env.wallet(carol), 5_000n);
    const before = await env.icp.icrc1_balance_of(account(carol));
    // whichever of the two runs first, the other is refused while it awaits the ledgers
    const [created, withdrawn] = await env.race(
      ['create_lock', carol, [5_000n, env.tokenAId, (await env.nowNs()) + DAY_NS, []]],
      ['withdraw_payment_balance', carol, []],
    );
    expect(['Ok' in created, 'Ok' in withdrawn].filter(Boolean).length).toBe(1);
    if ('Ok' in created) {
      expect(errOf(withdrawn)).toMatch(/in progress/);
      expect(await env.lock.getPaymentBalance(carol)).toBe(E8); // exactly one fee taken, the rest still there
      expect(await env.icp.icrc1_balance_of(account(carol))).toBe(before);
    } else {
      expect(errOf(created).message).toMatch(/in progress/);
      expect(unwrap(withdrawn).amount).toBe(2n * E8 - ICP_FEE);
      expect(await env.lock.getPaymentBalance(carol)).toBe(0n);
      await env.icp.mint(env.payment(carol), E8);
    }
    // and the other order
    const [w, c] = await env.race(
      ['withdraw_payment_balance', carol, []],
      ['create_lock', carol, [1_000n, env.tokenAId, (await env.nowNs()) + DAY_NS, []]],
    );
    expect(['Ok' in w, 'Ok' in c].filter(Boolean).length).toBe(1);
    if ('Ok' in w) {
      expect(unwrap(w).amount).toBe(E8 - ICP_FEE);
      expect(errOf(c).message).toMatch(/in progress/);
    } else {
      expect(errOf(w)).toMatch(/in progress/);
      expect(await env.lock.getPaymentBalance(carol)).toBe(0n);
    }
    unwrap(await env.lock.admin_set_lock_fees_icp([0n], [], [], []));
  });
});

describe('P1-14: lock creation checks', () => {
  let env;
  beforeAll(async () => { env = await setup(); }, 120_000);
  afterAll(async () => { await env?.pic.tearDown(); });

  it("create_position_lock refuses tokens that are not the pool's token0/token1 in its order", async () => {
    await env.pool.mint_position(alice, 1n, 1_000_000n);
    expect(await env.lockAs(alice).claim_position(env.poolId, 1n)).toBe(true);
    unwrap(await env.poolAs(alice).transferPosition(alice, env.lockId, 1n));
    const expiry = (await env.nowNs()) + DAY_NS;
    expect(errOf(await env.lockAs(alice).create_position_lock(env.poolId, 1n, 1n, expiry, env.tokenBId, env.tokenAId, [])).message)
      .toMatch(/must be the pool's own, in its order: token0 = .*, token1 = /);
    expect(errOf(await env.lockAs(alice).create_position_lock(env.poolId, 1n, 1n, expiry, env.tokenAId, env.icpId, [])).message).toMatch(/must be the pool's own/);
    expect(await env.lock.get_claimed_positions_for_principal(alice)).toEqual([expect.objectContaining({ position_lock: [] })]);
    unwrap(await env.lockAs(alice).create_position_lock(env.poolId, 1n, 1n, expiry, env.tokenAId, env.tokenBId, []));
  });

  it('create_lock and a concurrent transfer_tokens of the same caller never leave a lock unbacked', async () => {
    const L = 100_000n;
    await env.tokenA.mint(env.wallet(bob), L + FEE_A);
    const [created, sent] = await env.race(
      ['create_lock', bob, [L, env.tokenAId, (await env.nowNs()) + DAY_NS, []]],
      ['transfer_tokens', bob, [bob, [], env.tokenAId, L]],
    );
    const okCreate = 'Ok' in created;
    const okSend = 'Ok' in sent;
    expect(okCreate && okSend).toBe(false); // not both
    expect(okCreate || okSend).toBe(true);
    if (okCreate) expect(errOf(sent)).toEqual({ GenericError: expect.objectContaining({ error_code: 2n }) });
    const locked = (await env.lockAs(bob).get_summed_locks()).find(([t]) => t.toText() === env.tokenAId.toText())?.[1] ?? 0n;
    expect(await env.tokenA.icrc1_balance_of(env.wallet(bob))).toBeGreaterThanOrEqual(locked);
  });

  it('two concurrent create_position_lock calls make one lock and charge one fee', async () => {
    unwrap(await env.lock.admin_set_lock_fees_icp([], [E8], [], []));
    await env.icp.mint(env.payment(carol), 3n * E8);
    await env.pool.mint_position(carol, 2n, 1_000_000n);
    expect(await env.lockAs(carol).claim_position(env.poolId, 2n)).toBe(true);
    unwrap(await env.poolAs(carol).transferPosition(carol, env.lockId, 2n));
    const args = [env.poolId, 1n, 2n, (await env.nowNs()) + DAY_NS, env.tokenAId, env.tokenBId, []];
    const [r1, r2] = await env.race(['create_position_lock', carol, args], ['create_position_lock', carol, args]);
    expect([r1, r2].filter((r) => 'Ok' in r).length).toBe(1);
    expect(errOf('Err' in r1 ? r1 : r2).message).toMatch(/in progress/);
    expect(await env.lock.getPaymentBalance(carol)).toBe(2n * E8);
    const page = await env.lock.get_lock_states_page({ owner: [carol], ledger: [], swap_canister_id: [], token: [], kind: [{ PositionLock: null }], status: [], include_archived: false, prev: [], take: [] });
    expect(page.length).toBe(1);
    expect(unwrap(await env.lock.get_payment_log_for(carol, 0n, 10n)).total_count).toBe(1n);
    unwrap(await env.lock.admin_set_lock_fees_icp([], [0n], [], []));
  });
});

describe('P1-14: stranded add-liquidity tokens', () => {
  let env;
  const POS = 9n;
  beforeAll(async () => {
    env = await setup();
    await lockedPosition(env, bob, POS);
    await env.tokenA.mint(env.wallet(bob), 100_000n);
    await env.tokenB.mint(env.wallet(bob), 100_000n);
  }, 120_000);
  afterAll(async () => { await env?.pic.tearDown(); });
  const strandedOf = (p) => env.lock.get_stranded({ owner: [p], unpaid_only: false, prev: [], take: [] });

  let leftId, leftAmount;
  it('a leftover the pool will not return is recorded (stable record + sneedlock_stranded block)', async () => {
    await env.pool.set_use_percent(50n);
    await env.pool.set_withdraw_mode({ err: null });
    const msg = errOf(await env.lockAs(bob).add_liquidity_to_locked_position(env.poolId, POS, 10_000n, 0n));
    await env.pool.set_withdraw_mode({ normal: null });
    await env.pool.set_use_percent(100n);
    expect(msg).toMatch(/returning the unused remainder failed: .*stranded record (\d+)/);
    const credited = 10_000n - FEE_A;
    leftAmount = credited - credited / 2n;
    const [rec] = await strandedOf(bob);
    expect(rec).toMatchObject({ owner: bob, pool: env.poolId, ledger: env.tokenAId, amount: leftAmount, held_in: { pool_account: null }, status: { Open: null } });
    leftId = rec.id;
    expect(msg).toContain(`stranded record ${leftId}`);
    const [b] = await env.blocksOfType('sneedlock_stranded');
    expect(txField(b, 'stranded_id')).toEqual({ Nat: leftId });
    expect(txField(b, 'amount')).toEqual({ Nat: leftAmount });
    expect(txField(b, 'held_in')).toEqual({ Text: 'pool_account' });
    expect(txField(b, 'outcome')).toEqual({ Text: 'known' });
    expect(unwrap(await env.pool.getUserUnusedBalance(env.lockId)).balance0).toBe(leftAmount);
  });

  it('admin_withdraw_stranded_to_owner pays the recorded owner the recorded amount, once', async () => {
    expect(errOf(await env.lockAs(bob).admin_withdraw_stranded_to_owner(leftId, [], false))).toMatch(/Only admins/);
    expect(errOf(await env.lock.admin_withdraw_stranded_to_owner(leftId, [leftAmount + 1n], false))).toMatch(/At most the recorded amount/);
    const before = await env.tokenA.icrc1_balance_of(env.wallet(bob));
    const paid = unwrap(await env.lock.admin_withdraw_stranded_to_owner(leftId, [], false));
    expect(paid.status.Paid).toMatchObject({ by: admin, amount: leftAmount, accepted: leftAmount - FEE_A });
    expect(await env.tokenA.icrc1_balance_of(env.wallet(bob))).toBe(before + leftAmount - FEE_A);
    expect(unwrap(await env.pool.getUserUnusedBalance(env.lockId)).balance0).toBe(0n);
    const [b] = await env.lastBlocks(1);
    expect(btype(b)).toBe('sneedlock_stranded_settle');
    expect(txField(b, 'stranded_id')).toEqual({ Nat: leftId });
    // idempotent: a second call pays nothing
    expect(errOf(await env.lock.admin_withdraw_stranded_to_owner(leftId, [], false))).toMatch(/already paid/);
    expect(await env.tokenA.icrc1_balance_of(env.wallet(bob))).toBe(before + leftAmount - FEE_A);
    expect(await env.lock.get_stranded({ owner: [], unpaid_only: true, prev: [], take: [] })).toEqual([]);
    // the old method is still there
    expect(errOf(await env.lock.admin_withdraw_pool_balance_to_user(env.poolId, env.tokenAId, 5_000n, bob))).toMatch(/InsufficientFunds/);
  });

  it('a failed pool deposit is recorded in the deposit subaccount; paying it deposits first, then withdraws', async () => {
    await env.pool.set_deposit_mode({ err: null });
    const msg = errOf(await env.lockAs(bob).add_liquidity_to_locked_position(env.poolId, POS, 0n, 8_000n));
    await env.pool.set_deposit_mode({ normal: null });
    expect(msg).toMatch(/Pool deposit failed: .*stranded record/);
    const rec = (await strandedOf(bob)).at(-1);
    expect(rec).toMatchObject({ ledger: env.tokenBId, amount: 8_000n, held_in: { deposit_subaccount: null }, status: { Open: null } });
    const before = await env.tokenB.icrc1_balance_of(env.wallet(bob));
    const paid = unwrap(await env.lock.admin_withdraw_stranded_to_owner(rec.id, [], false));
    expect(paid.held_in).toEqual({ pool_account: null });
    expect(paid.amount).toBe(8_000n - FEE_B);
    expect(await env.tokenB.icrc1_balance_of(env.wallet(bob))).toBe(before + 8_000n - 2n * FEE_B);
    expect(errOf(await env.lock.admin_withdraw_stranded_to_owner(rec.id, [], true))).toMatch(/already paid/);
  });

  it('an unknown outcome is recorded as uncertain and paid only once an admin says the pool was checked', async () => {
    await env.pool.set_use_percent(0n);
    await env.pool.set_withdraw_mode({ trap: null });
    const msg = errOf(await env.lockAs(bob).add_liquidity_to_locked_position(env.poolId, POS, 6_000n, 0n));
    await env.pool.set_withdraw_mode({ normal: null });
    await env.pool.set_use_percent(100n);
    expect(msg).toMatch(/unknown outcome[\s\S]*stranded record/);
    const rec = (await strandedOf(bob)).at(-1);
    expect(rec).toMatchObject({ amount: 6_000n - FEE_A, status: { Uncertain: null }, held_in: { pool_account: null } });
    const b = (await env.blocksOfType('sneedlock_stranded')).at(-1);
    expect(txField(b, 'outcome')).toEqual({ Text: 'uncertain' });
    expect(errOf(await env.lock.admin_withdraw_stranded_to_owner(rec.id, [], false))).toMatch(/uncertain/);
    unwrap(await env.lock.admin_withdraw_stranded_to_owner(rec.id, [], true));
    expect(errOf(await env.lock.admin_withdraw_stranded_to_owner(rec.id, [], true))).toMatch(/already paid/);
  });
});

describe('upgrade from production (#451, c860d472)', () => {
  let env;
  beforeAll(async () => { env = await setup('sneed_lock_preaudit'); }, 120_000);
  afterAll(async () => { await env?.pic.tearDown(); });

  it('keeps locks, payments and the log; the new methods work after it', async () => {
    unwrap(await env.lock.admin_set_lock_fees_icp([E8], [], [], []));
    await env.icp.mint(env.payment(alice), 3n * E8);
    await env.tokenA.mint(env.wallet(alice), 50_000n);
    const id = unwrap(await env.lockAs(alice).create_lock(50_000n, env.tokenAId, (await env.nowNs()) + DAY_NS, []));
    await lockedPosition(env, dave, 5n);
    const stateBefore = await env.lock.get_lock_state(id);
    const logBefore = await env.lock.icrc3_log_status();
    const payBefore = await env.lock.admin_get_payment_log(0n, 10n);

    await env.pic.upgradeCanister({ sender: admin, canisterId: env.lockId, wasm: wasm('sneed_lock') });

    expect(await env.lock.get_lock_state(id)).toEqual(stateBefore);
    expect((await env.lock.get_claimed_positions_for_principal(dave))[0].position_lock.length).toBe(1);
    expect(await env.lock.admin_get_payment_log(0n, 10n)).toEqual(payBefore);
    expect((await env.lock.icrc3_log_status()).log_length).toBe(logBefore.log_length);
    expect(await env.lock.get_stranded({ owner: [], unpaid_only: false, prev: [], take: [] })).toEqual([]);
    expect(unwrap(await env.lockAs(alice).get_payment_log_for(alice, 0n, 10n)).total_count).toBe(1n);
    expect((await env.lock.get_info_id_range()).length).toBe(1); // the text logs survived, now as queries
    expect(unwrap(await env.lockAs(alice).withdraw_payment_balance()).amount).toBe(2n * E8 - ICP_FEE);
    expect((await env.lock.icrc3_supported_block_types()).map((t) => t.block_type)).toEqual(expect.arrayContaining(['sneedlock_payment_withdraw', 'sneedlock_stranded', 'sneedlock_stranded_settle']));
  });
});
