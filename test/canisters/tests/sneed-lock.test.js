// Integration tests of the sneed_lock canister on PocketIC with a mock ICRC-1
// ledger (also installed at the real ICP ledger id for fees) and a mock
// ICPSwap pool: token locks, withdrawals, liquid locking, fees, position
// claims and locks, fee claims, liquidity additions, admin operations, the
// ICRC-3 activity log and upgrades.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import {
  createPic, install, actorAs, account, principalToSubaccount, paymentSubaccount,
  admin, alice, bob, carol, ICP_LEDGER_ID, SNEED_GOVERNANCE, T, unwrap, errOf, wasm,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit, poolIdl, poolInit, governanceIdl } from '../lib/idl.js';
import { archiveIdl, btype, txField, verifyLog, fetchBlocks } from '../lib/icrc3.js';
import { idlFactory as sneedLockIdl } from '../build/sneed_lock.did.js';

const ICP_FEE = 10_000n;
const FEE_A = 1_000n;
const FEE_B = 500n;
const DAY_NS = 86_400n * 1_000_000_000n;

let pic, rootKey, appSubnet;
let icpId, tokenAId, tokenBId, poolId, lockId;
let icp, tokenA, tokenB, pool, lock, lockAlice, lockBob, lockCarol, poolAlice, poolBob;

const archiveActor = (id) => actorAs(pic, archiveIdl, id, admin);
const sneedWallet = (p) => account(lockId, principalToSubaccount(p));
const payment = (p) => account(lockId, paymentSubaccount(p));
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const expiryIn = async (seconds) => (await nowNs()) + BigInt(seconds) * 1_000_000_000n;
const balance = (ledger, acct) => ledger.icrc1_balance_of(acct);
const lastBlocks = async (n) => {
  const s = await lock.icrc3_log_status();
  const blocks = await fetchBlocks(lock, archiveActor, s.log_length - BigInt(n), s.log_length - 1n);
  return [...blocks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, b]) => b);
};
const lastBlock = async () => (await lastBlocks(1))[0];
const principalOf = (v) => Principal.fromUint8Array(new Uint8Array(v.Blob)).toText();

beforeAll(async () => {
  ({ pic, rootKey, appSubnet } = await createPic());
  // mock ICP ledger at the real ICP ledger id (NNS subnet range)
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  expect(icpId.toText()).toBe(ICP_LEDGER_ID.toText());
  tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  tokenBId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_B, symbol: 'BBB', decimals: 8 }], targetSubnetId: appSubnet });
  poolId = await install(pic, { name: 'MockSwapPool', initTypes: poolInit, initArgs: [{ token0: tokenAId, token1: tokenBId, fee: 3000n }], targetSubnetId: appSubnet });
  lockId = await install(pic, { name: 'sneed_lock', cycles: 20n * T, targetSubnetId: appSubnet });
  icp = actorAs(pic, ledgerIdl, icpId, admin);
  tokenA = actorAs(pic, ledgerIdl, tokenAId, admin);
  tokenB = actorAs(pic, ledgerIdl, tokenBId, admin);
  pool = actorAs(pic, poolIdl, poolId, admin);
  poolAlice = actorAs(pic, poolIdl, poolId, alice);
  poolBob = actorAs(pic, poolIdl, poolId, bob);
  lock = actorAs(pic, sneedLockIdl, lockId, admin);
  lockAlice = actorAs(pic, sneedLockIdl, lockId, alice);
  lockBob = actorAs(pic, sneedLockIdl, lockId, bob);
  lockCarol = actorAs(pic, sneedLockIdl, lockId, carol);
  // the pool holds tokens it can deliver as fees
  await tokenA.mint(account(poolId), 10_000_000n);
  await tokenB.mint(account(poolId), 10_000_000n);
  await pic.tick(2); // let the install-time import timer run
});

afterAll(async () => { await pic?.tearDown(); });

describe('fresh install', () => {
  it('has no locks, zero fees and an ICRC-3 log with just the start block', async () => {
    expect(await lock.get_active_token_locks()).toEqual([]);
    expect(await lock.get_active_position_locks()).toEqual([]);
    const fees = await lock.get_lock_fees_icp();
    expect(fees.token_lock_fee_icp_e8s).toBe(0n);
    const s = await lock.icrc3_log_status();
    expect(s.history_imported).toBe(true);
    expect(s.log_length).toBe(1n);
    const [start] = await lastBlocks(1);
    expect(btype(start)).toBe('sneedlock_log_start');
    expect(txField(start, 'current_lock_id')).toEqual({ Nat: 0n });
    expect(principalOf(txField(start, 'canister'))).toBe(lockId.toText());
    expect(unwrap(await lock.admin_icrc3_import_history())).toBe(0n);
  });

  it('reports the standards and block types', async () => {
    const types = (await lock.icrc3_supported_block_types()).map((t) => t.block_type);
    expect(types).toContain('sneedlock_token_lock_create');
    expect(types).toContain('sneedlock_config_update');
    expect(types.every((t) => t.startsWith('sneedlock_'))).toBe(true);
    expect((await lock.icrc10_supported_standards()).map((s) => s.name)).toEqual(['ICRC-3', 'ICRC-10']);
  });
});

describe('token locks', () => {
  it('rejects locks that are too short, too long or unfunded', async () => {
    const tooShort = await lockAlice.create_lock(1_000n, tokenAId, await expiryIn(1), []);
    expect(errOf(tooShort).message).toBe('Minimum lock time not fulfilled.');
    const tooLong = await lockAlice.create_lock(1_000n, tokenAId, await expiryIn(8 * 86_400), []);
    expect(errOf(tooLong).message).toBe('Maximum lock time exceeded.');
    const unfunded = await lockAlice.create_lock(1_000n, tokenAId, await expiryIn(3600), []);
    expect(errOf(unfunded).message).toMatch(/Insufficient balance to lock/);
  });

  it('locks part of the Sneed wallet balance and records it', async () => {
    await tokenA.mint(sneedWallet(alice), 100_000n);
    const expiry = await expiryIn(3600);
    const lockIdNum = unwrap(await lockAlice.create_lock(60_000n, tokenAId, expiry, []));
    expect(lockIdNum).toBe(1n);
    const active = await lock.get_active_token_locks();
    expect(active).toHaveLength(1);
    const [owner, ledger, l] = active[0];
    expect(owner.toText()).toBe(alice.toText());
    expect(ledger.toText()).toBe(tokenAId.toText());
    expect(l).toEqual({ lock_id: 1n, amount: 60_000n, expiry });
    expect(await lock.get_lock_by_id(1n)).toEqual([{ TokenLock: [alice, tokenAId, l] }]);
    expect(await lock.get_lock_type(1n)).toEqual([{ TokenLock: null }]);
    const summed = await lockAlice.get_summed_locks();
    expect(summed).toEqual([[tokenAId, 60_000n]]);
    const block = await lastBlock();
    expect(btype(block)).toBe('sneedlock_token_lock_create');
    expect(txField(block, 'lock_id')).toEqual({ Nat: 1n });
    expect(txField(block, 'amount')).toEqual({ Nat: 60_000n });
    expect(txField(block, 'expiry')).toEqual({ Nat: expiry });
    expect(principalOf(txField(block, 'owner'))).toBe(alice.toText());
    expect(principalOf(txField(block, 'ledger'))).toBe(tokenAId.toText());
    expect(txField(block, 'cid').Nat).toBeGreaterThan(0n);
  });

  it('refuses to lock more than the unlocked balance', async () => {
    const r = await lockAlice.create_lock(50_000n, tokenAId, await expiryIn(3600), []);
    expect(errOf(r).message).toMatch(/Insufficient unlocked balance to lock/);
  });

  it('only releases the unlocked part of the wallet', async () => {
    // 100_000 in the wallet, 60_000 locked, fee 1_000: at most 39_000 can leave
    const tooMuch = await lockAlice.transfer_tokens(alice, [], tokenAId, 39_001n);
    expect(errOf(tooMuch)).toEqual({ GenericError: { error_code: 1n, message: expect.stringMatching(/Insufficient balance to transfer/) } });
    const ok = await lockAlice.transfer_tokens(alice, [], tokenAId, 39_000n);
    expect(unwrap(ok)).toBeTypeOf('bigint');
    expect(await balance(tokenA, account(alice))).toBe(39_000n);
    expect(await balance(tokenA, sneedWallet(alice))).toBe(60_000n);
    const block = await lastBlock();
    expect(btype(block)).toBe('sneedlock_token_withdraw');
    expect(txField(block, 'amount')).toEqual({ Nat: 39_000n });
    expect(txField(block, 'to')).toEqual({ Array: [{ Blob: alice.toUint8Array() }] });
    expect(txField(block, 'ledger_tx').Nat).toBe(unwrap(ok));
    const nothingLeft = await lockAlice.transfer_tokens(alice, [], tokenAId, 1n);
    expect(errOf(nothingLeft)).toHaveProperty('GenericError');
  });

  it('serialises token operations per caller', async () => {
    const deferred = pic.createDeferredActor({ idlFactory: sneedLockIdl, canisterId: lockId });
    deferred.setPrincipal(alice);
    // both calls pass the balance check before either ledger transfer settles
    const first = await deferred.transfer_tokens(alice, [], tokenAId, 1n);
    const second = await deferred.transfer_tokens(alice, [], tokenAId, 1n);
    const [r1, r2] = [await first(), await second()];
    const errs = [r1, r2].map((r) => ('Err' in r ? r.Err : null));
    expect(errs.some((e) => e && 'GenericError' in e && e.GenericError.error_code === 2n)).toBe(true);
  });

  it('archives expired locks and frees the tokens', async () => {
    expect(await lockAlice.has_expired_locks()).toBe(false);
    await pic.advanceTime(3601 * 1000);
    await pic.tick();
    expect(await lockAlice.has_expired_locks()).toBe(true);
    expect(await lock.get_active_token_locks()).toEqual([]); // filtered by expiry
    await lockAlice.clear_expired_locks();
    expect(await lockAlice.has_expired_locks()).toBe(false);
    const expired = await lock.get_expired_token_locks();
    expect(expired.map(([, , l]) => l.lock_id)).toEqual([1n]);
    expect((await lock.get_ledger_token_locks(tokenAId)).map(([, , l]) => l.lock_id)).toEqual([1n]);
    expect(await lock.get_lock_by_id(1n)).toHaveLength(1); // still resolvable from the archive
    const ok = await lockAlice.transfer_tokens(alice, [], tokenAId, 59_000n);
    unwrap(ok);
    expect(await balance(tokenA, sneedWallet(alice))).toBe(0n);
  });
});

describe('liquid locking of token locks', () => {
  let expiry;
  beforeAll(async () => {
    await tokenA.mint(sneedWallet(alice), 50_000n);
    expiry = await expiryIn(2 * 86_400);
    unwrap(await lockAlice.create_lock(50_000n, tokenAId, expiry, [])); // lock id 2, nothing free
  });

  it('needs the lock to exist and one free ledger fee', async () => {
    expect(errOf(await lockAlice.transfer_token_lock_ownership(bob, tokenAId, 999n)).message).toMatch(/not found/);
    expect(errOf(await lockAlice.transfer_token_lock_ownership(bob, tokenAId, 1n)).message).toMatch(/not found/); // archived
    expect(errOf(await lockAlice.transfer_token_lock_ownership(bob, tokenAId, 2n)).message).toMatch(/Insufficient unlocked balance to cover transfer fee/);
    expect(await lock.get_active_token_locks()).toHaveLength(1);
  });

  it('moves the lock and the tokens to the recipient', async () => {
    await tokenA.mint(sneedWallet(alice), FEE_A);
    unwrap(await lockAlice.transfer_token_lock_ownership(bob, tokenAId, 2n));
    const active = await lock.get_active_token_locks();
    expect(active).toHaveLength(1);
    expect(active[0][0].toText()).toBe(bob.toText());
    expect(active[0][2]).toEqual({ lock_id: 2n, amount: 50_000n, expiry });
    expect(await balance(tokenA, sneedWallet(alice))).toBe(0n);
    expect(await balance(tokenA, sneedWallet(bob))).toBe(50_000n);
    expect(await lockBob.get_summed_locks()).toEqual([[tokenAId, 50_000n]]);
    // bob cannot withdraw the locked tokens
    expect(errOf(await lockBob.transfer_tokens(bob, [], tokenAId, 1n))).toHaveProperty('GenericError');
    const block = await lastBlock();
    expect(btype(block)).toBe('sneedlock_token_lock_transfer');
    expect(principalOf(txField(block, 'from'))).toBe(alice.toText());
    expect(principalOf(txField(block, 'to'))).toBe(bob.toText());
    expect(txField(block, 'outcome')).toEqual({ Text: 'ok' });
    expect(txField(block, 'ledger_tx').Nat).toBeTypeOf('bigint');
  });

  it('rolls the lock back when the ledger refuses the transfer', async () => {
    await tokenA.mint(sneedWallet(bob), FEE_A);
    await tokenA.set_paused(true);
    const r = await lockBob.transfer_token_lock_ownership(carol, tokenAId, 2n);
    expect(errOf(r).message).toMatch(/Failed to transfer tokens/);
    expect(errOf(r).transfer_error).toEqual([{ TemporarilyUnavailable: null }]);
    await tokenA.set_paused(false);
    const active = await lock.get_active_token_locks();
    expect(active[0][0].toText()).toBe(bob.toText());
    expect((await lockCarol.get_summed_locks()).every(([, n]) => n === 0n)).toBe(true);
  });
});

describe('ICP lock fees', () => {
  it('is free by default', async () => {
    const fee = await lock.getEffectiveLockFee(alice, false);
    expect(fee.fee_e8s).toBe(0n);
    expect(fee.is_premium).toBe(false);
  });

  it('only admins change fees and the recipient', async () => {
    expect(errOf(await lockAlice.admin_set_lock_fees_icp([1n], [], [], []))).toMatch(/Only admins/);
    expect(errOf(await lockAlice.admin_set_icp_fee_recipient([carol], []))).toMatch(/Only admins/);
  });

  it('charges the configured fee from the payment subaccount after the lock is created', async () => {
    unwrap(await lock.admin_set_lock_fees_icp([50_000_000n], [100_000_000n], [20_000_000n], [40_000_000n]));
    const blocks = await lastBlocks(4);
    expect(blocks.map((b) => btype(b))).toEqual(Array(4).fill('sneedlock_config_update'));
    expect(blocks.map((b) => txField(b, 'key').Text).sort()).toEqual(['position_lock_fee_icp_e8s', 'premium_position_lock_fee_icp_e8s', 'premium_token_lock_fee_icp_e8s', 'token_lock_fee_icp_e8s']);
    const fees = await lock.get_lock_fees_icp();
    expect(fees.token_lock_fee_icp_e8s).toBe(50_000_000n);
    expect((await lock.getEffectiveLockFee(alice, false)).fee_e8s).toBe(50_000_000n);
    expect((await lock.getEffectiveLockFee(alice, true)).fee_e8s).toBe(100_000_000n);

    await tokenA.mint(sneedWallet(alice), 10_000n);
    const unpaid = await lockAlice.create_lock(10_000n, tokenAId, await expiryIn(3600), []);
    expect(errOf(unpaid).message).toMatch(/ICP payment verification failed: Insufficient ICP payment/);
    expect(await lock.get_active_token_locks()).toHaveLength(1); // bob's only

    const subaccount = await lock.getPaymentSubaccount(alice);
    expect(Buffer.from(subaccount)).toEqual(Buffer.from(paymentSubaccount(alice)));
    await icp.mint(payment(alice), 60_000_000n);
    expect(await lock.getPaymentBalance(alice)).toBe(60_000_000n);

    const lockIdNum = unwrap(await lockAlice.create_lock(10_000n, tokenAId, await expiryIn(3600), []));
    expect(lockIdNum).toBe(3n);
    expect(await lock.getPaymentBalance(alice)).toBe(10_000_000n); // exactly fee_e8s left the subaccount
    expect(await balance(icp, account(lockId))).toBe(50_000_000n - ICP_FEE); // default recipient: this canister
    const stats = await lock.get_lock_fee_stats();
    expect(stats.total_token_lock_fees_collected_e8s).toBe(50_000_000n);
    const log = await lock.admin_get_payment_log(0n, 10n);
    expect(log.total_count).toBe(1n);
    expect(log.has_more).toBe(false);
    expect(log.payments[0].payer.toText()).toBe(alice.toText());
    expect(log.payments[0].amount_e8s).toBe(50_000_000n);
    const [create, pay] = await lastBlocks(2);
    expect(btype(create)).toBe('sneedlock_token_lock_create');
    expect(btype(pay)).toBe('sneedlock_fee_pay');
    expect(txField(pay, 'fee_e8s')).toEqual({ Nat: 50_000_000n });
    expect(txField(pay, 'amount_e8s')).toEqual({ Nat: 50_000_000n - ICP_FEE });
    expect(txField(pay, 'lock_type')).toEqual({ Text: 'token' });
    expect(txField(pay, 'to')).toEqual({ Array: [{ Blob: lockId.toUint8Array() }] });
    expect(txField(pay, 'icp_tx').Nat).toBe(log.payments[0].icp_transaction_id);
  });

  it('sends later fees to a configured recipient', async () => {
    unwrap(await lock.admin_set_icp_fee_recipient([carol], []));
    expect(txField(await lastBlock(), 'key')).toEqual({ Text: 'icp_fee_recipient' });
    await icp.mint(payment(alice), 50_000_000n);
    await tokenA.mint(sneedWallet(alice), 5_000n);
    unwrap(await lockAlice.create_lock(5_000n, tokenAId, await expiryIn(3600), []));
    expect(await balance(icp, account(carol))).toBe(50_000_000n - ICP_FEE);
    unwrap(await lock.admin_set_icp_fee_recipient([], []));
    unwrap(await lock.admin_set_lock_fees_icp([0n], [0n], [0n], [0n]));
  });
});

describe('positions', () => {
  const POS = 7n;
  let expiry;

  it('claims only positions the caller owns on the pool', async () => {
    expect(await lockAlice.claim_position(poolId, POS)).toBe(false);
    await pool.mint_position(alice, POS, 1_000_000n);
    expect(await lockAlice.claim_position(poolId, POS)).toBe(true);
    expect(await lockAlice.claim_position(poolId, POS)).toBe(true); // idempotent
    const claimed = await lock.get_claimed_positions_for_principal(alice);
    expect(claimed).toEqual([{ owner: alice, swap_canister_id: poolId, position_id: POS, position_lock: [] }]);
    expect(await lockAlice.get_position_ownerships()).toEqual([[poolId, POS]]);
    const block = await lastBlock();
    expect(btype(block)).toBe('sneedlock_position_claim');
    expect(txField(block, 'position_id')).toEqual({ Nat: POS });
  });

  it('locks a position only once it is held by the canister, with a supported dex', async () => {
    expiry = await expiryIn(86_400);
    expect(errOf(await lockAlice.create_position_lock(poolId, 1n, POS, expiry, tokenAId, tokenBId, [])).message).toBe('Position is not transferred to this canister.');
    unwrap(await poolAlice.transferPosition(alice, lockId, POS));
    expect((await pool.position_owner(POS))[0].toText()).toBe(lockId.toText());
    expect(errOf(await lockAlice.create_position_lock(poolId, 2n, POS, expiry, tokenAId, tokenBId, [])).message).toBe('Dex not supported.');
    expect(errOf(await lockAlice.create_position_lock(poolId, 1n, POS, await expiryIn(1), tokenAId, tokenBId, [])).message).toBe('Minimum lock time not fulfilled.');
    expect(errOf(await lockBob.create_position_lock(poolId, 1n, POS, expiry, tokenAId, tokenBId, [])).message).toBe('Position not claimed by caller.');
    const id = unwrap(await lockAlice.create_position_lock(poolId, 1n, POS, expiry, tokenAId, tokenBId, []));
    expect(id).toBe(5n);
    const active = await lock.get_active_position_locks();
    expect(active).toHaveLength(1);
    expect(active[0][0].toText()).toBe(alice.toText());
    expect(active[0][2]).toEqual({ dex: 1n, lock_id: 5n, position_id: POS, expiry, token0: tokenAId, token1: tokenBId });
    expect(await lock.get_lock_by_id(5n)).toEqual([{ PositionLock: [alice, poolId, active[0][2]] }]);
    expect((await lock.get_swap_position_locks(poolId))).toHaveLength(1);
    expect((await lock.get_token_position_locks(tokenBId))).toHaveLength(1);
    const block = await lastBlock();
    expect(btype(block)).toBe('sneedlock_position_lock_create');
    expect(txField(block, 'lock_id')).toEqual({ Nat: 5n });
    expect(principalOf(txField(block, 'token0'))).toBe(tokenAId.toText());
    expect(txField(block, 'dex')).toEqual({ Nat: 1n });
  });

  it('cannot be withdrawn while the lock is active', async () => {
    const r = await lockAlice.transfer_position(alice, poolId, POS);
    expect(errOf(r)).toEqual({ InternalError: expect.stringMatching(/is locked until .* cannot be withdrawn/) });
    expect((await pool.position_owner(POS))[0].toText()).toBe(lockId.toText());
    expect(await lock.get_claimed_positions_for_principal(alice)).toHaveLength(1);
  });

  it('can only be extended, never shortened', async () => {
    expect(errOf(await lockAlice.update_position_lock(poolId, POS, expiry - 1n)).message).toBe('New expiry is before current expiry.');
    const later = expiry + DAY_NS;
    expect(unwrap(await lockAlice.update_position_lock(poolId, POS, later))).toBe(5n);
    expect((await lock.get_active_position_locks())[0][2].expiry).toBe(later);
    const block = await lastBlock();
    expect(btype(block)).toBe('sneedlock_position_lock_extend');
    expect(txField(block, 'old_expiry')).toEqual({ Nat: expiry });
    expect(txField(block, 'expiry')).toEqual({ Nat: later });
    expiry = later;
  });

  it('transfers ownership together with the lock (liquid locking)', async () => {
    expect(errOf(await lockBob.transfer_position_ownership(carol, poolId, POS)).message).toMatch(/not the owner/);
    unwrap(await lockAlice.transfer_position_ownership(bob, poolId, POS));
    expect(await lock.get_claimed_positions_for_principal(alice)).toEqual([]);
    const claimed = await lock.get_claimed_positions_for_principal(bob);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].position_lock[0].lock_id).toBe(5n);
    expect((await lock.get_active_position_locks())[0][0].toText()).toBe(bob.toText());
    const block = await lastBlock();
    expect(btype(block)).toBe('sneedlock_position_transfer');
    expect(principalOf(txField(block, 'from'))).toBe(alice.toText());
    expect(principalOf(txField(block, 'to'))).toBe(bob.toText());
    expect(txField(block, 'lock_id')).toEqual({ Nat: 5n });
  });

  it('claims accrued fees to the owner wallet, keeping undeliverable dust in the pool', async () => {
    expect(errOf(await lockBob.claim_position_fees(poolId, POS))).toMatch(/Insufficient rewards to claim/);
    expect(errOf(await lockAlice.claim_position_fees(poolId, POS))).toMatch(/does not own position/);
    await pool.set_tokens_owed(POS, 50_000n, 300n); // side B is at or below its fee: dust
    const walletA = await balance(tokenA, sneedWallet(bob));
    const r = unwrap(await lockBob.claim_position_fees(poolId, POS));
    expect(r.amount0).toBe(50_000n);
    expect(r.amount1).toBe(300n);
    expect(r.token0.toText()).toBe(tokenAId.toText());
    expect((await balance(tokenA, sneedWallet(bob))) - walletA).toBe(50_000n - FEE_A); // delivered net of the ledger fee
    expect(await balance(tokenB, sneedWallet(bob))).toBe(0n);
    expect(unwrap(await pool.getUserUnusedBalance(lockId))).toEqual({ balance0: 0n, balance1: 300n });
    const completed = await lock.get_all_completed_claim_requests();
    expect(completed).toHaveLength(1);
    expect(completed[0].request_id).toBe(r.request_id);
    const block = await lastBlock();
    expect(btype(block)).toBe('sneedlock_fees_claim');
    expect(txField(block, 'amount0')).toEqual({ Nat: 50_000n });
    expect(txField(block, 'delivered0')).toEqual({ Nat: 50_000n - FEE_A });
    expect(txField(block, 'delivered1')).toEqual({ Nat: 0n });
    expect(txField(block, 'request_id')).toEqual({ Nat: r.request_id });
    // the compatibility entry point reports the same history
    expect(await lock.get_claim_request_status(r.request_id)).toEqual([{ Completed: completed[0] }]);
  });

  describe('adding liquidity', () => {
    it('validates ownership, lock state and amounts', async () => {
      expect(errOf(await lockAlice.add_liquidity_to_locked_position(poolId, POS, 1n, 1n))).toMatch(/does not own position/);
      await pool.mint_position(alice, 8n, 1n);
      expect(await lockAlice.claim_position(poolId, 8n)).toBe(true);
      expect(errOf(await lockAlice.add_liquidity_to_locked_position(poolId, 8n, 1n, 1n))).toMatch(/is not locked/);
      expect(errOf(await lockBob.add_liquidity_to_locked_position(poolId, POS, 0n, 0n))).toBe('Nothing to add');
      expect(errOf(await lockBob.add_liquidity_to_locked_position(poolId, POS, 2n * FEE_A, 0n))).toMatch(/amount0 must exceed twice the ledger fee/);
      // bob's wallet holds 50_000 locked plus the claimed fees: more than the free part is refused
      const free = (await balance(tokenA, sneedWallet(bob))) - 50_000n;
      expect(errOf(await lockBob.add_liquidity_to_locked_position(poolId, POS, free, 0n))).toMatch(/Insufficient unlocked balance in backend wallet/);
    });

    it('moves tokens into the pool, adds what the pool takes and returns the rest', async () => {
      await tokenA.mint(sneedWallet(bob), 20_000n);
      await tokenB.mint(sneedWallet(bob), 10_000n);
      const walletA = await balance(tokenA, sneedWallet(bob));
      const walletB = await balance(tokenB, sneedWallet(bob));
      const liquidityBefore = (await pool.position_liquidity(POS))[0];
      const r = unwrap(await lockBob.add_liquidity_to_locked_position(poolId, POS, 10_000n, 4_000n));
      expect(r).toEqual({ position_id: POS, credited0: 10_000n - FEE_A, credited1: 4_000n - FEE_B, used0: 10_000n - FEE_A, used1: 4_000n - FEE_B, returned0: 0n, returned1: 0n, increase_error: [] });
      expect((await pool.position_liquidity(POS))[0] - liquidityBefore).toBe(r.used0 + r.used1);
      const block = await lastBlock();
      expect(btype(block)).toBe('sneedlock_liquidity_add');
      expect(txField(block, 'used0')).toEqual({ Nat: r.used0 });
      expect(txField(block, 'increase_error')).toBeUndefined();
      expect(walletA - (await balance(tokenA, sneedWallet(bob)))).toBe(10_000n + FEE_A);
      expect(walletB - (await balance(tokenB, sneedWallet(bob)))).toBe(4_000n + FEE_B);
    });

    it('returns leftovers the pool did not use', async () => {
      await pool.set_use_percent(50n);
      const walletA = await balance(tokenA, sneedWallet(bob));
      const r = unwrap(await lockBob.add_liquidity_to_locked_position(poolId, POS, 5_000n, 0n));
      const credited = 5_000n - FEE_A;
      expect(r.credited0).toBe(credited);
      expect(r.used0).toBe(credited / 2n);
      expect(r.returned0).toBe(credited - credited / 2n);
      expect(await balance(tokenA, sneedWallet(bob))).toBe(walletA - 5_000n - FEE_A + r.returned0 - FEE_A);
      await pool.set_use_percent(100n);
    });

    it('reports a pool refusal and returns everything', async () => {
      await pool.set_fail_increase(true);
      const r = unwrap(await lockBob.add_liquidity_to_locked_position(poolId, POS, 3_000n, 0n));
      expect(r.used0).toBe(0n);
      expect(r.returned0).toBe(3_000n - FEE_A);
      expect(r.increase_error[0]).toMatch(/Pool refused to add liquidity/);
      await pool.set_fail_increase(false);
      expect(txField(await lastBlock(), 'increase_error').Text).toMatch(/Pool refused/);
    });
  });

  it('can be withdrawn to ICPSwap once the lock has expired', async () => {
    await pic.advanceTime(Number((expiry - (await nowNs())) / 1_000_000n) + 1000);
    await pic.tick();
    expect(await lockBob.has_expired_position_locks()).toBe(true);
    expect(await lock.get_active_position_locks()).toEqual([]);
    unwrap(await lockBob.transfer_position(bob, poolId, POS));
    expect((await pool.position_owner(POS))[0].toText()).toBe(bob.toText());
    expect(await lock.get_claimed_positions_for_principal(bob)).toEqual([]);
    expect((await lock.get_expired_position_locks()).map(([, , l]) => l.lock_id)).toEqual([5n]);
    const block = await lastBlock();
    expect(btype(block)).toBe('sneedlock_position_withdraw');
    expect(principalOf(txField(block, 'to'))).toBe(bob.toText());
  });
});

describe('admin operations', () => {
  it('reject non-admins', async () => {
    await expect(lockAlice.admin_rescue_stuck_tokens(tokenAId, alice)).rejects.toThrow(/Only admin/);
    await expect(lockAlice.set_max_lock_length_days(1n)).rejects.toThrow(/Only the SNEED governance/);
    expect(errOf(await lockAlice.admin_add_admin(alice))).toMatch(/Only admins/);
  });

  it('rescues tokens stranded on the main account', async () => {
    await tokenA.mint(account(lockId), 7_000n);
    const r = unwrap(await lock.admin_rescue_stuck_tokens(tokenAId, carol));
    expect(r).toMatch(/Successfully rescued 6_000 tokens/);
    expect(await balance(tokenA, account(carol))).toBe(6_000n);
    const block = await lastBlock();
    expect(btype(block)).toBe('sneedlock_admin_token_rescue');
    expect(txField(block, 'amount')).toEqual({ Nat: 6_000n });
    expect(unwrap(await lock.admin_rescue_stuck_tokens(tokenAId, carol))).toMatch(/Nothing to rescue/);
  });

  it('manages admins and limits with a config trail', async () => {
    unwrap(await lock.admin_add_admin(carol));
    expect((await lock.get_admin_list()).map((p) => p.toText())).toEqual([carol.toText()]);
    await lockCarol.set_max_lock_length_days(1n);
    const block = await lastBlock();
    expect(btype(block)).toBe('sneedlock_config_update');
    expect(txField(block, 'key')).toEqual({ Text: 'max_lock_length_ns' });
    expect(txField(block, 'value')).toEqual({ Nat: DAY_NS });
    expect(txField(block, 'old_value')).toEqual({ Nat: 7n * DAY_NS });
    expect(principalOf(txField(block, 'caller'))).toBe(carol.toText());
    await tokenA.mint(sneedWallet(alice), 1_000n);
    expect(errOf(await lockAlice.create_lock(1_000n, tokenAId, await expiryIn(2 * 86_400), [])).message).toBe('Maximum lock time exceeded.');
    unwrap(await lock.admin_remove_admin(carol));
    await expect(lockCarol.set_max_lock_length_days(7n)).rejects.toThrow();
    await lock.set_max_lock_length_days(7n);
  });
});

describe('ICRC-3 log of sneed_lock', () => {
  it('verifies end to end and contains every action in order', async () => {
    const { blocks } = await verifyLog(lock, lockId, rootKey, archiveActor);
    const counts = {};
    for (const b of blocks) counts[btype(b)] = (counts[btype(b)] || 0) + 1;
    expect(counts.sneedlock_log_start).toBe(1);
    expect(counts.sneedlock_token_lock_create).toBe(4);
    expect(counts.sneedlock_token_withdraw).toBe(2);
    expect(counts.sneedlock_token_lock_transfer).toBe(1);
    expect(counts.sneedlock_fee_pay).toBe(2);
    expect(counts.sneedlock_position_claim).toBe(2);
    expect(counts.sneedlock_position_lock_create).toBe(1);
    expect(counts.sneedlock_position_lock_extend).toBe(1);
    expect(counts.sneedlock_position_transfer).toBe(1);
    expect(counts.sneedlock_fees_claim).toBe(1);
    expect(counts.sneedlock_liquidity_add).toBe(3);
    expect(counts.sneedlock_position_withdraw).toBe(1);
    expect(counts.sneedlock_admin_token_rescue).toBe(1);
    expect(blocks.every((b) => btype(b) === 'sneedlock_log_start' || txField(b, 'cid') !== undefined)).toBe(true);
  });

  it('spills into archives and still verifies', async () => {
    unwrap(await lock.admin_set_icrc3_settings({ max_live_blocks: [], spill_batch_size: [5n], archive_max_blocks: [10n], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }));
    const moved = unwrap(await lock.admin_icrc3_spill_now());
    expect(moved).toBeGreaterThan(10n);
    const archives = await lock.icrc3_get_archives({ from: [] });
    expect(archives.length).toBeGreaterThanOrEqual(2);
    const controllers = (await pic.getControllers(archives[0].canister_id)).map((p) => p.toText()).sort();
    expect(controllers).toEqual([lockId.toText(), 'fp274-iaaaa-aaaaq-aacha-cai'].sort());
    const { blocks } = await verifyLog(lock, lockId, rootKey, archiveActor);
    expect(BigInt(blocks.length)).toBe((await lock.icrc3_log_status()).log_length);
  });

  it('registers its archives with the SNS through a hotkeyed neuron, and skips the step without one', async () => {
    const NEURON = new Uint8Array(32).fill(9);
    const archives = await lock.icrc3_get_archives({ from: [] });
    let s = await lock.icrc3_registration_status();
    expect(s.governance.toText()).toBe(SNEED_GOVERNANCE.toText());
    expect(s.neuron).toEqual([]);
    expect(s.registrations.map((r) => r.canister_id.toText())).toEqual(archives.map((a) => a.canister_id.toText()));
    expect(errOf(await lockAlice.admin_icrc3_register_archives_now())).toMatch(/admins/);
    expect(errOf(await lockAlice.admin_set_icrc3_proposal_neuron([NEURON]))).toMatch(/admins/);
    expect(unwrap(await lock.admin_icrc3_register_archives_now())).toBe(0n); // no neuron: skipped
    // a mock SNS governance at the real Sneed governance id (SNS subnet range)
    const govId = await install(pic, { name: 'MockSnsGovernance', targetCanisterId: SNEED_GOVERNANCE });
    const gov = actorAs(pic, governanceIdl, govId, admin);
    unwrap(await lock.admin_set_icrc3_proposal_neuron([NEURON]));
    const { blocks } = await verifyLog(lock, lockId, rootKey, archiveActor);
    const last = blocks[blocks.length - 1];
    expect(btype(last)).toBe('sneedlock_config_update');
    expect(JSON.stringify(txField(last, 'key'))).toContain('icrc3_proposal_neuron');
    expect(unwrap(await lock.admin_icrc3_register_archives_now())).toBe(0n); // neuron not hotkeyed
    s = await lock.icrc3_registration_status();
    expect(s.registrations.every((r) => r.attempts === 1n && /not authorized/.test(r.last_error[0]))).toBe(true);
    await gov.add_hotkey(NEURON, lockId);
    unwrap(await lock.admin_set_icrc3_proposal_neuron([NEURON]));
    expect(unwrap(await lock.admin_icrc3_register_archives_now())).toBe(BigInt(archives.length));
    const proposals = await gov.list_proposals();
    expect(proposals).toHaveLength(archives.length);
    for (const p of proposals) {
      expect(p.proposer.toText()).toBe(lockId.toText());
      expect(p.title).toMatch(/^Register ICRC-3 archive .* of Sneed Lock$/);
      expect(p.url).toBe('https://app.sneeddao.com/api/sneed_lock#activity-log-icrc-3');
    }
    s = await lock.icrc3_registration_status();
    expect(s.registrations.map((r) => r.proposal_id[0])).toEqual(proposals.map((p) => p.id));
    expect(unwrap(await lock.admin_icrc3_register_archives_now())).toBe(0n);
  });

  it('survives an upgrade with locks, archives and certificate intact', async () => {
    const regBefore = await lock.icrc3_registration_status();
    const before = await lock.icrc3_log_status();
    const activeBefore = await lock.get_active_token_locks();
    await pic.upgradeCanister({ sender: admin, canisterId: lockId, wasm: wasm('sneed_lock'), arg: IDL.encode([], []) });
    await pic.tick(2);
    const after = await lock.icrc3_log_status();
    expect(after.log_length).toBe(before.log_length);
    expect(after.archives).toEqual(before.archives);
    expect(after.history_imported).toBe(true);
    expect(await lock.icrc3_registration_status()).toEqual(regBefore);
    expect(await lock.get_active_token_locks()).toEqual(activeBefore);
    expect((await lock.get_expired_position_locks()).map(([, , l]) => l.lock_id)).toEqual([5n]);
    expect(unwrap(await lock.admin_icrc3_import_history())).toBe(0n);
    await verifyLog(lock, lockId, rootKey, archiveActor);
    // still operational after the upgrade
    await tokenA.mint(sneedWallet(alice), 2_000n);
    unwrap(await lockAlice.create_lock(1_000n, tokenAId, await expiryIn(3600), []));
    expect((await lock.icrc3_log_status()).log_length).toBe(before.log_length + 1n);
  });
});

// ---- v2: dissolve delays (spec/sneed_lock_v2.md, section 1) ----------------
describe('dissolve delays', () => {
  const NEVER = 18_446_744_073_709_551_615n;
  const HOUR = 3600n * 1_000_000_000n;
  const advance = async (ns) => { await pic.advanceTime(Number(ns / 1_000_000n) + 1000); await pic.tick(); };
  const ok = (r) => { expect(r).toHaveProperty('Ok'); return r.Ok; };
  const err = (r) => { expect(r).toHaveProperty('Err'); return r.Err; };
  const state = async (id) => (await lock.get_lock_state(id))[0];
  let neuronId, vestId, plainId;

  it('exposes the limits, which apply to lock period + delay', async () => {
    expect(await lock.get_lock_limits()).toEqual({ min_lock_length_ns: 5_000_000_000n, max_lock_length_ns: 7n * DAY_NS });
    await tokenA.mint(sneedWallet(alice), 100_000n);
    const now = await nowNs();
    expect(errOf(await lockAlice.create_lock(1_000n, tokenAId, now + 6n * DAY_NS, [2n * DAY_NS])).message).toBe('Maximum lock time exceeded.');
    expect(errOf(await lockAlice.create_lock(1_000n, tokenAId, 0n, [1_000_000_000n])).message).toBe('Minimum lock time not fulfilled.');
  });

  it('a lock with only a delay is held until it has dissolved, like a neuron', async () => {
    const now = await nowNs();
    // no lock period: a lock end of 0 (or any moment already past) means "dissolving may start at once"
    neuronId = unwrap(await lockAlice.create_lock(40_000n, tokenAId, 0n, [DAY_NS]));
    const s = await state(neuronId);
    expect(s).toMatchObject({ kind: { TokenLock: null }, amount: [40_000n], dissolve_delay: DAY_NS, dissolving_until: [], expiry: NEVER, locked: true, archived: false });
    expect(s.lock_end).toBeGreaterThanOrEqual(now); // clamped to the moment the call ran
    expect((await lock.get_lock_by_id(neuronId))[0].TokenLock[2].expiry).toBe(NEVER); // old readers see it locked
    const block = await lastBlock();
    expect(btype(block)).toBe('sneedlock_token_lock_create');
    expect(txField(block, 'dissolve_delay')).toEqual({ Nat: DAY_NS });
    // two days later it is still held: it has not started dissolving
    await advance(2n * DAY_NS);
    expect((await state(neuronId)).locked).toBe(true);
    const free = (await balance(tokenA, sneedWallet(alice))) - (await lockAlice.get_summed_locks()).find(([l]) => l.toText() === tokenAId.toText())[1];
    expect(errOf(await lockAlice.transfer_tokens(alice, [], tokenAId, free + 1n))).toHaveProperty('GenericError');
  });

  it('only the owner starts and stops dissolving; stopping keeps the time left as the delay', async () => {
    expect(err(await lockBob.start_dissolving(neuronId))).toEqual({ NotOwner: null });
    expect(err(await lockAlice.start_dissolving(999_999n))).toEqual({ NotFound: null });
    expect(err(await lockAlice.stop_dissolving(neuronId))).toEqual({ Invalid: 'The lock is not dissolving.' });
    const t0 = await nowNs();
    const s = ok(await lockAlice.start_dissolving(neuronId));
    expect(s.dissolving_until[0]).toBeGreaterThanOrEqual(t0 + DAY_NS);
    expect(s.expiry).toBe(s.dissolving_until[0]);
    expect(btype(await lastBlock())).toBe('sneedlock_dissolve_start');
    expect(err(await lockAlice.start_dissolving(neuronId))).toEqual({ Invalid: 'The lock is already dissolving.' });
    await advance(6n * HOUR);
    const stopped = ok(await lockAlice.stop_dissolving(neuronId));
    expect(stopped.dissolving_until).toEqual([]);
    expect(stopped.expiry).toBe(NEVER);
    expect(stopped.dissolve_delay).toBeLessThan(DAY_NS - 5n * HOUR);
    expect(stopped.dissolve_delay).toBeGreaterThan(DAY_NS - 7n * HOUR);
    expect(btype(await lastBlock())).toBe('sneedlock_dissolve_stop');
  });

  it('the delay only grows, within the limit, also while dissolving', async () => {
    const before = (await state(neuronId)).dissolve_delay;
    expect(err(await lockAlice.increase_dissolve_delay(neuronId, 0n))).toHaveProperty('Invalid');
    expect(err(await lockAlice.increase_dissolve_delay(neuronId, 7n * DAY_NS))).toEqual({ Invalid: 'Maximum lock time exceeded.' });
    expect(ok(await lockAlice.increase_dissolve_delay(neuronId, HOUR)).dissolve_delay).toBe(before + HOUR);
    expect(btype(await lastBlock())).toBe('sneedlock_dissolve_delay_increase');
    const started = ok(await lockAlice.start_dissolving(neuronId));
    const moved = ok(await lockAlice.increase_dissolve_delay(neuronId, HOUR));
    expect(moved.dissolving_until[0]).toBe(started.dissolving_until[0] + HOUR);
    expect(moved.expiry).toBe(moved.dissolving_until[0]);
    expect(err(await lockAlice.extend_lock(neuronId, moved.dissolving_until[0] + DAY_NS))).toHaveProperty('Invalid'); // not while dissolving
  });

  it('once dissolved the tokens are free and the lock cannot be changed', async () => {
    const s = await state(neuronId);
    await advance(s.dissolving_until[0] - (await nowNs()));
    expect((await state(neuronId)).locked).toBe(false);
    expect(err(await lockAlice.increase_dissolve_delay(neuronId, HOUR))).toEqual({ Invalid: 'The lock is no longer locked.' });
    expect(err(await lockAlice.start_dissolving(neuronId))).toHaveProperty('Invalid');
    await lockAlice.clear_expired_locks();
    const archived = await state(neuronId);
    expect(archived).toMatchObject({ archived: true, locked: false, dissolve_delay: expect.any(BigInt) });
    expect(archived.dissolving_until).toHaveLength(1);
    unwrap(await lockAlice.transfer_tokens(alice, [], tokenAId, 39_000n)); // the 40_000 are free again
  });

  it('a vesting lock: dissolving can start only after the lock period, which can be extended', async () => {
    const now = await nowNs();
    vestId = unwrap(await lockAlice.create_lock(10_000n, tokenAId, now + HOUR, [HOUR]));
    expect(err(await lockAlice.start_dissolving(vestId))).toEqual({ Invalid: 'Dissolving can start when the lock period ends.' });
    expect(err(await lockAlice.extend_lock(vestId, now + HOUR - 1n))).toHaveProperty('Invalid');
    const ext = ok(await lockAlice.extend_lock(vestId, now + 2n * HOUR));
    expect(ext).toMatchObject({ lock_end: now + 2n * HOUR, expiry: NEVER });
    const block = await lastBlock();
    expect(btype(block)).toBe('sneedlock_token_lock_extend');
    expect(txField(block, 'lock_end')).toEqual({ Nat: now + 2n * HOUR });
    await advance(2n * HOUR);
    expect((await state(vestId)).locked).toBe(true); // the period is over, the delay is not
    ok(await lockAlice.start_dissolving(vestId));
    await advance(HOUR);
    expect((await state(vestId)).locked).toBe(false);
  });

  it('a plain lock can be extended, and given a delay', async () => {
    const end = await expiryIn(3600);
    plainId = unwrap(await lockAlice.create_lock(5_000n, tokenAId, end, []));
    expect(err(await lockAlice.extend_lock(plainId, end - 1n))).toHaveProperty('Invalid');
    const ext = ok(await lockAlice.extend_lock(plainId, end + HOUR));
    expect(ext).toMatchObject({ lock_end: end + HOUR, expiry: end + HOUR, dissolve_delay: 0n });
    expect((await lock.get_lock_by_id(plainId))[0].TokenLock[2].expiry).toBe(end + HOUR);
    const delayed = ok(await lockAlice.increase_dissolve_delay(plainId, HOUR));
    expect(delayed).toMatchObject({ lock_end: end + HOUR, dissolve_delay: HOUR, expiry: NEVER, locked: true });
  });

  it('the lock and its dissolve state travel with an ownership transfer', async () => {
    await tokenA.mint(sneedWallet(alice), FEE_A);
    unwrap(await lockAlice.transfer_token_lock_ownership(bob, tokenAId, plainId));
    const s = await state(plainId);
    expect(s.owner.toText()).toBe(bob.toText());
    expect(s).toMatchObject({ dissolve_delay: HOUR, expiry: NEVER, amount: [5_000n] });
    expect(err(await lockAlice.increase_dissolve_delay(plainId, HOUR))).toEqual({ NotOwner: null });
    ok(await lockBob.increase_dissolve_delay(plainId, HOUR));
  });

  it('nobody changes a lock while its transfer waits on the ledger', async () => {
    // ICP's ledger is on another subnet, so the transfer's ledger call takes several rounds:
    // one round runs the transfer up to that call, and bob's call lands while it waits.
    await icp.mint(sneedWallet(alice), 1_000_000n);
    const id = unwrap(await lockAlice.create_lock(500_000n, ICP_LEDGER_ID, 0n, [DAY_NS]));
    const asAlice = pic.createDeferredActor({ idlFactory: sneedLockIdl, canisterId: lockId });
    asAlice.setPrincipal(alice);
    const asBob = pic.createDeferredActor({ idlFactory: sneedLockIdl, canisterId: lockId });
    asBob.setPrincipal(bob);
    const pending = await asAlice.transfer_token_lock_ownership(bob, ICP_LEDGER_ID, id);
    await pic.tick();
    const duringCall = await asBob.start_dissolving(id);
    const during = await duringCall();
    unwrap(await pending());
    expect(err(during)).toEqual({ InProgress: null });
    const s = await state(id);
    expect(s.owner.toText()).toBe(bob.toText());
    expect(s).toMatchObject({ dissolve_delay: DAY_NS, dissolving_until: [], expiry: NEVER });
    ok(await lockBob.start_dissolving(id)); // and once the transfer is done, the new owner can
  });

  it('position locks: created with a delay, extended by the dissolve rules, withdrawn once dissolved', async () => {
    const POS2 = 9n;
    await pool.mint_position(carol, POS2, 500_000n);
    expect(await lockCarol.claim_position(poolId, POS2)).toBe(true);
    unwrap(await actorAs(pic, poolIdl, poolId, carol).transferPosition(carol, lockId, POS2));
    const now = await nowNs();
    const id = unwrap(await lockCarol.create_position_lock(poolId, 1n, POS2, now + HOUR, tokenAId, tokenBId, [HOUR]));
    expect(await state(id)).toMatchObject({ kind: { PositionLock: null }, position_id: [POS2], lock_end: now + HOUR, dissolve_delay: HOUR, expiry: NEVER, locked: true });
    expect(btype(await lastBlock())).toBe('sneedlock_position_lock_create');
    // the old update path extends the lock period, not the effective expiry
    expect(unwrap(await lockCarol.update_position_lock(poolId, POS2, now + 2n * HOUR))).toBe(id);
    expect(await state(id)).toMatchObject({ lock_end: now + 2n * HOUR, expiry: NEVER });
    expect(btype(await lastBlock())).toBe('sneedlock_position_lock_extend');
    expect(errOf(await lockCarol.create_position_lock(poolId, 1n, POS2, now + 3n * HOUR, tokenAId, tokenBId, [HOUR])).message).toMatch(/already locked/);
    await advance(3n * HOUR);
    expect(errOf(await lockCarol.transfer_position(carol, poolId, POS2))).toHaveProperty('InternalError'); // period over, not dissolved
    ok(await lockCarol.start_dissolving(id));
    await advance(HOUR);
    unwrap(await lockCarol.transfer_position(carol, poolId, POS2));
    expect((await pool.position_owner(POS2))[0].toText()).toBe(carol.toText());
  });

  it('pages lock states in id order, by owner, ledger and kind', async () => {
    const mine = await lock.get_lock_states_page({ owner: [alice], ledger: [], swap_canister_id: [], kind: [{ TokenLock: null }], include_archived: true, prev: [], take: [] });
    const ids = mine.map((s) => s.lock_id);
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : 1)));
    expect(ids).toContain(neuronId); // archived, asked for
    expect(mine.every((s) => s.owner.toText() === alice.toText() && 'TokenLock' in s.kind)).toBe(true);
    const page1 = await lock.get_lock_states_page({ owner: [alice], ledger: [tokenAId], swap_canister_id: [], kind: [], include_archived: true, prev: [], take: [2n] });
    const page2 = await lock.get_lock_states_page({ owner: [alice], ledger: [tokenAId], swap_canister_id: [], kind: [], include_archived: true, prev: [page1[1].lock_id], take: [2n] });
    expect(page1).toHaveLength(2);
    expect(page2[0].lock_id).toBeGreaterThan(page1[1].lock_id);
    const activeOnly = await lock.get_lock_states_page({ owner: [], ledger: [], swap_canister_id: [], kind: [], include_archived: false, prev: [], take: [] });
    expect(activeOnly.every((s) => !s.archived)).toBe(true);
    expect((await lock.get_lock_states([neuronId, 999_999n])).map((x) => x.length)).toEqual([1, 0]);
  });

  it('keeps every dissolve state across an upgrade, and the log still verifies', async () => {
    // earliest_unlock of a delay lock that is not dissolving counts from now, which moves
    const kept = async () => (await lock.get_lock_states([neuronId, vestId, plainId])).map(([x]) => { const { earliest_unlock, ...rest } = x; return rest; });
    const before = await kept();
    await pic.upgradeCanister({ sender: admin, canisterId: lockId, wasm: wasm('sneed_lock'), arg: IDL.encode([], []) });
    await pic.tick(2);
    expect(await kept()).toEqual(before);
    const types = (await lock.icrc3_supported_block_types()).map((t) => t.block_type);
    for (const t of ['sneedlock_dissolve_start', 'sneedlock_dissolve_stop', 'sneedlock_dissolve_delay_increase', 'sneedlock_token_lock_extend']) expect(types).toContain(t);
    await verifyLog(lock, lockId, rootKey, archiveActor);
  });
});

describe('lock age and earliest unlock', () => {
  const HOUR = 3600n * 1_000_000_000n;
  const state = async (actor, id) => (await actor.get_lock_state(id))[0];

  it('records when a lock was created; a plain lock unlocks at its expiry', async () => {
    await tokenA.mint(sneedWallet(alice), 10_000n);
    const before = await nowNs();
    const id = unwrap(await lockAlice.create_lock(2_000n, tokenAId, await expiryIn(3600), []));
    const s = await state(lock, id);
    expect(s.created_at).toHaveLength(1);
    expect(s.created_at[0]).toBeGreaterThanOrEqual(before);
    expect(s.created_at[0]).toBeLessThanOrEqual((await nowNs()) + 1_000_000n); // nowNs is in whole ms
    expect(s.earliest_unlock).toBe(s.expiry);
  });

  it('a delay lock shows the soonest it can be free: lock period + delay, then delay from now, then the dissolve end', async () => {
    await tokenA.mint(sneedWallet(alice), 10_000n);
    const id = unwrap(await lockAlice.create_lock(2_000n, tokenAId, await expiryIn(3600), [HOUR]));
    let s = await state(lock, id);
    expect(s.expiry).toBe(18_446_744_073_709_551_615n); // held until it dissolves
    expect(s.earliest_unlock).toBe(s.lock_end + HOUR); // 1h lock period + 1h delay
    // two hours on, not dissolving: still at least the delay away, counted from now
    await pic.advanceTime(2 * 3600 * 1000); await pic.tick();
    s = await state(lock, id);
    const now = await nowNs();
    expect(s.earliest_unlock).toBeGreaterThanOrEqual(now + HOUR);
    expect(s.earliest_unlock).toBeLessThan(now + HOUR + 60n * 1_000_000_000n);
    // dissolving: the end of the dissolve
    const d = (await lockAlice.start_dissolving(id)).Ok;
    expect(d.earliest_unlock).toBe(d.dissolving_until[0]);
    expect(d.earliest_unlock).toBe(d.expiry);
  });

  it('an upgrade fills in creation times of earlier locks from their ICRC-3 create blocks', async () => {
    const oldId = await install(pic, { name: 'sneed_lock_v2a', cycles: 20n * T, targetSubnetId: appSubnet });
    await pic.tick(2);
    const oldAlice = actorAs(pic, sneedLockIdl, oldId, alice);
    const oldAdmin = actorAs(pic, sneedLockIdl, oldId, admin);
    await tokenA.mint(account(oldId, principalToSubaccount(alice)), 50_000n);
    const plain = unwrap(await oldAlice.create_lock(5_000n, tokenAId, await expiryIn(3600), []));
    const withDelay = unwrap(await oldAlice.create_lock(5_000n, tokenAId, 0n, [HOUR]));
    const s = await oldAdmin.icrc3_log_status();
    const blocks = await fetchBlocks(oldAdmin, archiveActor, 0n, s.log_length - 1n);
    const createdTs = new Map();
    for (const b of blocks.values()) if (btype(b) === 'sneedlock_token_lock_create') createdTs.set(txField(b, 'lock_id').Nat, b.Map.find(([k]) => k === 'ts')[1].Nat);
    expect(createdTs.size).toBe(2);
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm('sneed_lock'), arg: IDL.encode([], []) });
    await pic.tick(2);
    for (const id of [plain, withDelay]) expect((await state(oldAdmin, id)).created_at).toEqual([createdTs.get(id)]);
    // the delay lock kept its dissolve state through the upgrade
    expect(await state(oldAdmin, withDelay)).toMatchObject({ dissolve_delay: HOUR, dissolving_until: [], locked: true });
    // and a second upgrade changes nothing
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm('sneed_lock'), arg: IDL.encode([], []) });
    expect((await state(oldAdmin, plain)).created_at).toEqual([createdTs.get(plain)]);
  });
});
