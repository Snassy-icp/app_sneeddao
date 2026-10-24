// sneed_notifications withdrawals (spec/micropayments.md §3.3, §11, §15a "common withdraw API"):
// a user takes unused balance out with `withdraw({ amount_e8s; to; created_at_time })`; `to`
// receives the amount less one ledger fee. The balance is debited before the ledger call and put
// back only when the transfer definitely did not happen. A call whose outcome is unknown leaves
// the withdrawal pending (owed, counted as a liability) and it is retried with the same arguments,
// which the ledger deduplicates. One withdrawal per user at a time; before each transfer the
// ledger must hold everything the canister owes, so a withdrawal is never paid out of anyone
// else's balance. Rate limited, refused at ingress for the anonymous principal, logged to ICRC-3
// (sneednotif_withdraw) and to the support log.
//
// The ledger is MockLedgerFaulty: set_fail_to (the ledger answers an error), set_reject_to (the
// call throws: unknown outcome), set_hold_to (the transfer waits), burn (books above the ledger).
// The upgrade test installs the build production runs (build/sneed_notifications_prepaging.wasm:
// src at 1788bfee, the #460 code, module hash 7c32ae81…) and upgrades it with keep.
// NOTIF_WASM=sneed_notifications_prepaging npx vitest run tests/notifications-withdraw.test.js
// runs the first suite against production's code, which has no withdraw (it fails).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, unwrap, errOf, wasm, refusedAtIngress, asUpdates, account, nowNs } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { btype, txField } from '../lib/icrc3.js';
import { idlFactory as notifIdl } from '../build/sneed_notifications.did.js';

const NOTIF_WASM = process.env.NOTIF_WASM || 'sneed_notifications';
const FEE = 10_000n;
const ICP = 100_000_000n;
const MIN5 = 5 * 60_000 + 1_000;
const keep = { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] };
const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const faultIdl = ({ IDL }) => IDL.Service({
  set_fail_to: IDL.Func([IDL.Vec(IDL.Principal)], [], []),
  set_reject_to: IDL.Func([IDL.Vec(Account)], [], []),
  set_hold_to: IDL.Func([IDL.Vec(IDL.Principal)], [], []),
  burn: IDL.Func([Account, IDL.Nat], [], []),
});
const sub = (n) => new Uint8Array(32).fill(n);

/// sneed_notifications on a MockLedgerFaulty as its ICP ledger.
async function world(pic, notifWasm) {
  const notifId = await install(pic, { name: notifWasm });
  const icpId = await install(pic, { name: 'MockLedgerFaulty', initTypes: ledgerInit, initArgs: [{ fee: FEE, symbol: 'ICP', decimals: 8 }] });
  const as = (p) => actorAs(pic, notifIdl, notifId, p);
  const n = as(admin);
  const icp = actorAs(pic, ledgerIdl, icpId, admin);
  const fault = actorAs(pic, faultIdl, icpId, admin);
  unwrap(await n.admin_set_config({ ...(await n.get_config()), icp_ledger: icpId }));
  const topUp = async (who, amount) => {
    await icp.mint(account(who), amount + 2n * FEE);
    unwrap(await actorAs(pic, ledgerIdl, icpId, who).icrc2_approve({ from_subaccount: [], spender: account(notifId), amount: amount + FEE, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
    return unwrap(await as(who).top_up(amount));
  };
  const balance = async (who) => (await as(who).get_my_settings()).balance_e8s;
  const ledgerBalance = (acc) => icp.icrc1_balance_of(acc);
  const held = () => icp.icrc1_balance_of(account(notifId));
  const args = (amount, to, over = {}) => ({ amount_e8s: amount, to, created_at_time: [], ...over });
  const lastBlock = async () => {
    const s = await n.icrc3_log_status();
    return (await n.icrc3_get_blocks([{ start: s.log_length - 1n, length: 1n }])).blocks[0].block;
  };
  return { notifId, icpId, n, as, icp, fault, topUp, balance, ledgerBalance, held, args, lastBlock };
}

describe('sneed_notifications: withdraw', () => {
  let pic, w;
  beforeAll(async () => {
    ({ pic } = await createPic());
    w = await world(pic, NOTIF_WASM);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('top-up, then a partial withdrawal: the balance and the ledger agree, logged on ICRC-3', async () => {
    expect(await w.topUp(bob, ICP)).toBe(ICP);
    const held0 = await w.held();
    const bob0 = await w.ledgerBalance(account(bob));
    const r = unwrap(await w.as(bob).withdraw(w.args(30_000_000n, account(bob))));
    expect(r).toMatchObject({ amount_e8s: 30_000_000n, fee_e8s: FEE, sent_e8s: 30_000_000n - FEE, balance_e8s: 70_000_000n });
    expect(await w.balance(bob)).toBe(70_000_000n);
    expect(await w.ledgerBalance(account(bob))).toBe(bob0 + 30_000_000n - FEE); // the amount less the ledger fee arrived
    expect(await w.held()).toBe(held0 - 30_000_000n); // out of the canister: the amount, ledger fee included
    const tx = (await w.icp.get_transactions()).find((t) => t.index === r.ledger_block);
    expect(tx).toMatchObject({ amount: 30_000_000n - FEE, fee: FEE });
    expect(tx.to.owner.toText()).toBe(bob.toText());
    const b = await w.lastBlock();
    expect(btype(b)).toBe('sneednotif_withdraw');
    expect(txField(b, 'amount_e8s')).toEqual({ Nat: 30_000_000n });
    expect(txField(b, 'fee_e8s')).toEqual({ Nat: FEE });
    expect(txField(b, 'ledger_block')).toEqual({ Nat: r.ledger_block });
    expect(txField(b, 'balance_e8s')).toEqual({ Nat: 70_000_000n });
    const mine = await w.as(bob).get_my_prepaid();
    expect(mine).toMatchObject({ balance_e8s: 70_000_000n, reserved_e8s: 0n, ledger_fee_e8s: FEE, min_withdraw_e8s: FEE + 1n, withdrawn_e8s: 30_000_000n, withdraw_pending: [] });
    expect(mine.withdrawals.map((x) => x.ledger_block)).toEqual([r.ledger_block]);
    expect(mine.top_ups.map((x) => x.amount_e8s)).toEqual([ICP]);
    // support sees it too
    const view = unwrap(await w.n.admin_get_user(bob, 0n));
    expect(view.withdrawals.map((x) => x.amount_e8s)).toEqual([30_000_000n]);
    expect((await w.n.get_log(0n, 100n)).some((e) => /withdraw: sent 0\.2999/.test(e.message))).toBe(true);
    expect((await w.n.icrc3_supported_block_types()).map((t) => t.block_type)).toContain('sneednotif_withdraw');
  });

  it('withdraws everything, to any account (a subaccount)', async () => {
    const to = account(carol, sub(7));
    const r = unwrap(await w.as(bob).withdraw(w.args(70_000_000n, to)));
    expect(r.balance_e8s).toBe(0n);
    expect(await w.balance(bob)).toBe(0n);
    expect(await w.ledgerBalance(to)).toBe(70_000_000n - FEE);
    expect((await w.as(bob).get_my_prepaid()).withdrawn_e8s).toBe(ICP);
  });

  it('refuses more than the balance, and an amount at or below the ledger fee', async () => {
    await w.topUp(alice, 50_000n);
    expect(errOf(await w.as(alice).withdraw(w.args(50_001n, account(alice))))).toEqual({ insufficient_balance: { balance_e8s: 50_000n } });
    expect(errOf(await w.as(alice).withdraw(w.args(FEE, account(alice))))).toEqual({ amount_too_small: { min_e8s: FEE + 1n } });
    expect(errOf(await w.as(alice).withdraw(w.args(1n, account(alice))))).toEqual({ amount_too_small: { min_e8s: FEE + 1n } });
    expect(errOf(await w.as(user('nobody')).withdraw(w.args(20_000n, account(alice))))).toEqual({ insufficient_balance: { balance_e8s: 0n } });
    expect(errOf(await w.as(alice).withdraw(w.args(20_000n, { owner: alice, subaccount: [new Uint8Array(5)] })))).toEqual({ invalid: 'A subaccount is 32 bytes' });
    expect(errOf(await w.as(alice).withdraw(w.args(20_000n, account(w.notifId))))).toMatchObject({ invalid: expect.any(String) });
    expect(await w.balance(alice)).toBe(50_000n);
    // one more than the fee goes: 1 e8s arrives
    const r = unwrap(await w.as(alice).withdraw(w.args(FEE + 1n, account(alice, sub(1)))));
    expect(r.sent_e8s).toBe(1n);
    expect(await w.balance(alice)).toBe(50_000n - FEE - 1n);
  });

  it('the anonymous principal is refused at ingress; get_my_prepaid is a query only', async () => {
    expect(await refusedAtIngress(w.as(Principal.anonymous()).withdraw(w.args(20_000n, account(alice))))).toBe(true);
    const asUpd = actorAs(pic, asUpdates(notifIdl), w.notifId, alice);
    expect(await refusedAtIngress(asUpd.get_my_prepaid())).toBe(true);
    expect(await refusedAtIngress(w.as(alice).admin_resolve_withdraw(alice, []))).toBe(true);
    expect(errOf(await w.n.admin_resolve_withdraw(alice, []))).toBe('No pending withdrawal');
  });

  it('a retry of the same request (same created_at_time) answers the first result and withdraws once', async () => {
    const u = user('retry-user');
    await w.topUp(u, 1_000_000n);
    const t = await nowNs(pic);
    const req = w.args(400_000n, account(u, sub(2)), { created_at_time: [t] });
    const first = unwrap(await w.as(u).withdraw(req));
    const again = unwrap(await w.as(u).withdraw(req));
    expect(again.ledger_block).toBe(first.ledger_block);
    expect(await w.balance(u)).toBe(600_000n);
    expect(await w.ledgerBalance(account(u, sub(2)))).toBe(400_000n - FEE);
    // a different amount with the same time is a new withdrawal
    expect(unwrap(await w.as(u).withdraw({ ...req, amount_e8s: 100_000n })).ledger_block).not.toBe(first.ledger_block);
    expect(await w.balance(u)).toBe(500_000n);
  });

  it('concurrent withdrawals cannot overdraw: the second waits for the first (busy)', async () => {
    const u = user('concurrent-user');
    const dest = user('concurrent-dest');
    await w.topUp(u, 1_000_000n);
    await w.fault.set_hold_to([dest]);
    const deferred = pic.createDeferredActor({ idlFactory: notifIdl, canisterId: w.notifId });
    deferred.setPrincipal(u);
    const call = await deferred.withdraw(w.args(800_000n, account(dest)));
    await pic.tick(5); // the first is at the ledger, held
    expect(await w.balance(u)).toBe(200_000n); // debited before the ledger call
    expect(errOf(await w.as(u).withdraw(w.args(800_000n, account(dest))))).toEqual({ busy: null });
    // the held one is recorded as sending
    expect((await w.as(u).get_my_prepaid()).withdraw_pending[0]).toMatchObject({ amount_e8s: 800_000n, state: { sending: null } });
    // while in flight it is owed: the fee books count it
    expect((await w.n.get_fee_forwarding()).liabilities_e8s).toBeGreaterThanOrEqual(800_000n + 200_000n);
    await w.fault.set_hold_to([]);
    expect(unwrap(await call()).sent_e8s).toBe(800_000n - FEE);
    expect(errOf(await w.as(u).withdraw(w.args(800_000n, account(dest))))).toEqual({ insufficient_balance: { balance_e8s: 200_000n } });
    expect(await w.ledgerBalance(account(dest))).toBe(800_000n - FEE);
  });

  it('a ledger refusal puts the balance back and moves nothing', async () => {
    const u = user('refused-user');
    const dest = user('refused-dest');
    await w.topUp(u, 500_000n);
    const held0 = await w.held();
    await w.fault.set_fail_to([dest]);
    const e = errOf(await w.as(u).withdraw(w.args(300_000n, account(dest))));
    expect(e.refused).toMatch(/nothing moved/);
    await w.fault.set_fail_to([]);
    expect(await w.balance(u)).toBe(500_000n);
    expect(await w.held()).toBe(held0);
    expect(await w.ledgerBalance(account(dest))).toBe(0n);
    const mine = await w.as(u).get_my_prepaid();
    expect(mine.withdraw_pending).toEqual([]);
    expect(mine.withdrawn_e8s).toBe(0n);
    expect(btype(await w.lastBlock())).not.toBe('sneednotif_withdraw');
    expect((await w.n.get_log(0n, 200n)).some((e) => /withdraw: nothing moved/.test(e.message))).toBe(true);
    // and it works once the ledger takes it
    expect(unwrap(await w.as(u).withdraw(w.args(300_000n, account(dest)))).balance_e8s).toBe(200_000n);
  });

  it('an unknown outcome stays pending (debited, owed) and is retried with the same arguments, once', async () => {
    const u = user('unknown-user');
    const dest = account(user('unknown-dest'));
    await w.topUp(u, 600_000n);
    await w.fault.set_reject_to([dest]);
    const e = errOf(await w.as(u).withdraw(w.args(250_000n, dest)));
    expect(e.pending).toMatchObject({ amount_e8s: 250_000n, attempts: 1n, state: { unknown: expect.stringMatching(/did not answer/) } });
    expect(await w.balance(u)).toBe(350_000n); // not put back blindly
    const before = await w.n.get_fee_forwarding();
    expect(before.liabilities_e8s).toBeGreaterThanOrEqual(600_000n); // still owed: balance + the pending withdrawal
    // the user's next withdraw retries it first; still no answer: it stays pending, nothing new debited
    expect(errOf(await w.as(u).withdraw(w.args(100_000n, dest))).pending).toMatchObject({ attempts: 2n });
    expect(await w.balance(u)).toBe(350_000n);
    expect(errOf(await w.n.admin_resolve_withdraw(u, []))).toMatch(/Retry first/);
    // the ledger answers again: the timer's retry sends it, once
    await w.fault.set_reject_to([]);
    await pic.advanceTime(MIN5);
    await pic.tick(10);
    const mine = await w.as(u).get_my_prepaid();
    expect(mine.withdraw_pending).toEqual([]);
    expect(mine.withdrawals.map((x) => x.amount_e8s)).toEqual([250_000n]);
    expect(mine.balance_e8s).toBe(350_000n);
    expect(await w.ledgerBalance(dest)).toBe(250_000n - FEE);
    const b = await w.lastBlock();
    expect(btype(b)).toBe('sneednotif_withdraw');
    expect(txField(b, 'via')).toEqual({ Text: 'timer' });
    expect(txField(b, 'principal')).toEqual({ Blob: u.toUint8Array() });
  });

  it('never pays out of other users\' money: the ledger must hold everything owed', async () => {
    const u = user('books-user');
    await w.topUp(u, 400_000n);
    // the books now say more than the ledger holds (a bug, a lost transfer ...)
    const held = await w.held();
    const owed = (await w.n.get_fee_forwarding()).liabilities_e8s;
    await w.fault.burn(account(w.notifId), held - owed + 1n);
    const e = errOf(await w.as(u).withdraw(w.args(400_000n, account(u))));
    expect(e.refused).toMatch(/does not cover/);
    expect(await w.balance(u)).toBe(400_000n);
    expect((await w.n.get_log(0n, 300n)).some((x) => /less than the .* owed/.test(x.message))).toBe(true);
    await w.icp.mint(account(w.notifId), 1n); // books and ledger agree again
    expect(unwrap(await w.as(u).withdraw(w.args(400_000n, account(u)))).balance_e8s).toBe(0n);
  });

  it('is rate limited per caller, and the rule is listed', async () => {
    expect(Object.fromEntries(await w.n.get_rate_limits()).withdraw).toEqual({ capacity: 10n, per_minute: 5n });
    unwrap(await w.n.admin_set_rate_limit('withdraw', [{ capacity: 2n, per_minute: 1n }]));
    const u = user('hammer');
    for (let i = 0; i < 2; i++) expect(errOf(await w.as(u).withdraw(w.args(20_000n, account(u))))).toEqual({ insufficient_balance: { balance_e8s: 0n } });
    expect(await refusedAtIngress(w.as(u).withdraw(w.args(20_000n, account(u))))).toBe(true);
    unwrap(await w.n.admin_set_rate_limit('withdraw', []));
  });
});

describe('sneed_notifications: withdraw after the upgrade from production', () => {
  it('keeps balances over the upgrade (keep), and they can be withdrawn', async () => {
    const { pic } = await createPic();
    try {
      const w = await world(pic, 'sneed_notifications_prepaging');
      await w.topUp(bob, 3_000_000n);
      await w.topUp(carol, 1_000_000n);
      await pic.upgradeCanister({ sender: admin, canisterId: w.notifId, wasm: wasm(NOTIF_WASM), upgradeModeOptions: keep });
      expect(await w.balance(bob)).toBe(3_000_000n);
      expect(await w.balance(carol)).toBe(1_000_000n);
      const mine = await w.as(bob).get_my_prepaid();
      expect(mine).toMatchObject({ balance_e8s: 3_000_000n, withdrawn_e8s: 0n, withdraw_pending: [], withdrawals: [] });
      expect(mine.top_ups.map((t) => t.amount_e8s)).toEqual([3_000_000n]);
      expect(unwrap(await w.as(bob).withdraw(w.args(3_000_000n, account(bob, sub(9))))).balance_e8s).toBe(0n);
      expect(await w.ledgerBalance(account(bob, sub(9)))).toBe(3_000_000n - FEE);
      expect(await w.balance(carol)).toBe(1_000_000n);
      // withdrawals are kept over a later upgrade
      await pic.upgradeCanister({ sender: admin, canisterId: w.notifId, wasm: wasm(NOTIF_WASM), upgradeModeOptions: keep });
      expect((await w.as(bob).get_my_prepaid()).withdrawn_e8s).toBe(3_000_000n);
    } finally {
      await pic.tearDown();
    }
  }, 180_000);
});
