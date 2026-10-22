// sneed_premium support fixes (spec/support_audit.md §2.4, §4 P1-9 and P1-12):
//  1. getClaimLogFor(p, offset, limit) and getIcpPaymentLogFor(p, offset, limit): one principal's
//     claims and ICP payments, newest first, paged, for that principal itself or an admin only
//     (the full logs stay admin only), so support can answer "I paid but nothing happened" by
//     principal.
//  2. withdrawDepositToken(ledger): any ICRC-1 token sent by mistake to the caller's own deposit
//     subaccount goes back to the caller's own default account (balance minus that ledger's
//     fee), never anywhere else, logged as premium_deposit_token_withdraw. For the ICP ledger
//     it is withdrawDeposit.
//  3. The ingress guard: the new queries are refused as update calls; the anonymous principal
//     cannot withdraw.
//  4. An upgrade from the production build (#452, a17b23d2…; built from d20ab1bf as
//     sneed_premium_preaudit) keeps the logs and the new queries cover the old entries.
// PREMIUM_WASM=sneed_premium_preaudit runs this file against the code before these fixes (every
// test fails: the methods do not exist there).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import {
  createPic, install, actorAs, account, principalToSubaccount,
  alice, bob, carol, user, ICP_LEDGER_ID, T, unwrap, errOf, wasm, refusedAtIngress, asUpdates, admin,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { btype, txField } from '../lib/icrc3.js';
import { idlFactory as premiumIdl, init as premiumInit } from '../build/sneed_premium.did.js';

const PREMIUM_WASM = process.env.PREMIUM_WASM || 'sneed_premium';
const ICP = 100_000_000n;
const ICP_FEE = 10_000n;
const TOK_FEE = 1_000n;
const DAY = 86_400n * 1_000_000_000n;
const dave = user('dave');

let pic, appSubnet, icpId, tokId, govId, premiumId, icp, tok;
const as = (p) => actorAs(pic, premiumIdl, premiumId, p);
const depositAccount = (p) => account(premiumId, principalToSubaccount(p));
const lastBlock = async () => {
  const s = await as(admin).icrc3_log_status();
  return (await as(admin).icrc3_get_blocks([{ start: s.log_length - 1n, length: 1n }])).blocks[0].block;
};
const buy = async (p) => { await icp.mint(depositAccount(p), ICP); return unwrap(await as(p).purchaseWithIcp()); };

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  tokId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: TOK_FEE, symbol: 'TOK', decimals: 8 }], targetSubnetId: appSubnet });
  govId = await install(pic, { name: 'MockRllGovernance', targetSubnetId: appSubnet });
  premiumId = await install(pic, {
    name: PREMIUM_WASM, initTypes: premiumInit({ IDL }), cycles: 20n * T, targetSubnetId: appSubnet,
    initArgs: [[{ admins: [bob], icpLedgerId: icpId, sneedGovernanceId: govId, paymentRecipient: account(carol), minClaimIntervalNs: DAY }]],
  });
  icp = actorAs(pic, ledgerIdl, icpId, admin);
  tok = actorAs(pic, ledgerIdl, tokId, admin);
  unwrap(await as(bob).addIcpTier({ name: 'Month', amountE8s: ICP, durationNs: 30n * DAY, active: true }));
  // alice buys three times, dave once
  await buy(alice); await buy(dave); await buy(alice); await buy(alice);
}, 120_000);
afterAll(async () => { await pic?.tearDown(); });

describe('1. one principal\'s claims and payments (caller or admin)', () => {
  it('getIcpPaymentLogFor: the principal\'s own payments only, newest first, paged', async () => {
    const all = await as(alice).getIcpPaymentLogFor(alice, 0n, 10n);
    expect(all.total_count).toBe(3n);
    expect(all.has_more).toBe(false);
    expect(all.payments.map((p) => p.payer.toText())).toEqual([alice.toText(), alice.toText(), alice.toText()]);
    const ids = all.payments.map((p) => p.id);
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? 1 : -1))); // newest first
    expect(all.payments[0].icpTransactionId).toBeTypeOf('bigint');
    const page = await as(alice).getIcpPaymentLogFor(alice, 1n, 1n);
    expect(page).toMatchObject({ total_count: 3n, has_more: true });
    expect(page.payments.map((p) => p.id)).toEqual([ids[1]]);
    expect((await as(alice).getIcpPaymentLogFor(alice, 2n, 5n)).has_more).toBe(false);
    expect((await as(alice).getIcpPaymentLogFor(alice, 3n, 5n)).payments).toEqual([]);
    const d = await as(dave).getIcpPaymentLogFor(dave, 0n, 10n);
    expect(d.payments.map((p) => p.payer.toText())).toEqual([dave.toText()]);
  });

  it('getClaimLogFor: the principal\'s own claims only, newest first, paged', async () => {
    const all = await as(alice).getClaimLogFor(alice, 0n, 10n);
    expect(all.total_count).toBe(3n);
    expect(all.claims.every((c) => c.claimant.toText() === alice.toText() && 'IcpPayment' in c.claimType)).toBe(true);
    expect(all.claims[0].newExpiration).toBeGreaterThan(all.claims[2].newExpiration);
    const page = await as(alice).getClaimLogFor(alice, 0n, 2n);
    expect(page).toMatchObject({ total_count: 3n, has_more: true });
    expect(page.claims.map((c) => c.id)).toEqual(all.claims.slice(0, 2).map((c) => c.id));
    expect((await as(dave).getClaimLogFor(dave, 0n, 10n)).total_count).toBe(1n);
  });

  it('an admin reads anyone\'s; anyone else (and the anonymous principal) is refused', async () => {
    expect((await as(bob).getIcpPaymentLogFor(alice, 0n, 10n)).total_count).toBe(3n);
    expect((await as(bob).getClaimLogFor(dave, 0n, 10n)).total_count).toBe(1n);
    await expect(as(carol).getIcpPaymentLogFor(alice, 0n, 10n)).rejects.toThrow(/Only the principal itself or an admin/);
    await expect(as(dave).getClaimLogFor(alice, 0n, 10n)).rejects.toThrow(/Only the principal itself or an admin/);
    await expect(as(Principal.anonymous()).getClaimLogFor(Principal.anonymous(), 0n, 10n)).rejects.toThrow();
  });
});

describe('2. withdrawDepositToken: a token sent by mistake goes back to its sender only', () => {
  it('returns the caller\'s own balance minus the token\'s fee to the caller, and touches nobody else', async () => {
    await tok.mint(depositAccount(alice), 5n * ICP);
    await tok.mint(depositAccount(dave), 2n * ICP);
    // carol's own deposit subaccount is empty: she gets nothing, and alice's stays
    expect(errOf(await as(carol).withdrawDepositToken(tokId))).toEqual({ NothingToWithdraw: { balance: 0n, fee: TOK_FEE } });
    expect(await tok.icrc1_balance_of(depositAccount(alice))).toBe(5n * ICP);
    const w = unwrap(await as(alice).withdrawDepositToken(tokId));
    expect(w.amountE8s).toBe(5n * ICP - TOK_FEE);
    expect(w.to).toEqual(account(alice));
    expect(await tok.icrc1_balance_of(depositAccount(alice))).toBe(0n);
    expect(await tok.icrc1_balance_of(account(alice))).toBe(5n * ICP - TOK_FEE);
    expect(await tok.icrc1_balance_of(depositAccount(dave))).toBe(2n * ICP);
    const b = await lastBlock();
    expect(btype(b)).toBe('premium_deposit_token_withdraw');
    expect(txField(b, 'ledger')).toEqual({ Blob: tokId.toUint8Array() });
    expect(txField(b, 'amount')).toEqual({ Nat: 5n * ICP - TOK_FEE });
    expect(txField(b, 'ledger_tx')).toEqual({ Nat: w.blockIndex });
    expect(errOf(await as(alice).withdrawDepositToken(tokId))).toEqual({ NothingToWithdraw: { balance: 0n, fee: TOK_FEE } });
    unwrap(await as(dave).withdrawDepositToken(tokId));
    expect(await tok.icrc1_balance_of(account(dave))).toBe(2n * ICP - TOK_FEE);
  });

  it('for the ICP ledger it is withdrawDeposit (same lock, same block)', async () => {
    await icp.mint(depositAccount(carol), ICP / 3n);
    const before = await icp.icrc1_balance_of(account(carol));
    const w = unwrap(await as(carol).withdrawDepositToken(icpId));
    expect(w.amountE8s).toBe(ICP / 3n - ICP_FEE);
    expect(await icp.icrc1_balance_of(account(carol))).toBe(before + ICP / 3n - ICP_FEE);
    expect(await icp.icrc1_balance_of(depositAccount(carol))).toBe(0n);
    expect(btype(await lastBlock())).toBe('premium_deposit_withdraw');
  });

  it('a canister that is no ledger gives an error, not a trap; the anonymous principal is refused', async () => {
    expect(errOf(await as(alice).withdrawDepositToken(govId)).TransferFailed).toMatch(/Could not reach the ledger/);
    // the lock is released: a real withdrawal works right after
    await tok.mint(depositAccount(alice), ICP);
    unwrap(await as(alice).withdrawDepositToken(tokId));
    await refusedAtIngress(as(Principal.anonymous()).withdrawDepositToken(tokId));
  });
});

describe('3. ingress guard', () => {
  it('refuses the new queries sent as update calls (and answers them as queries)', async () => {
    expect((await as(alice).getClaimLogFor(alice, 0n, 1n)).total_count).toBe(3n);
    const u = actorAs(pic, asUpdates(premiumIdl), premiumId, alice);
    await refusedAtIngress(u.getClaimLogFor(alice, 0n, 1n));
    await refusedAtIngress(u.getIcpPaymentLogFor(alice, 0n, 1n));
  });
});

describe('4. upgrade from production (#452, a17b23d2…)', () => {
  it('keeps the logs; the new queries and withdrawDepositToken work on them', async () => {
    const { pic: p2, appSubnet: sub2 } = await createPic();
    try {
      const icp2 = await install(p2, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
      const tok2 = await install(p2, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: TOK_FEE, symbol: 'TOK', decimals: 8 }], targetSubnetId: sub2 });
      const gov2 = await install(p2, { name: 'MockRllGovernance', targetSubnetId: sub2 });
      const id = await install(p2, {
        name: 'sneed_premium_preaudit', initTypes: premiumInit({ IDL }), cycles: 20n * T, targetSubnetId: sub2,
        initArgs: [[{ admins: [bob], icpLedgerId: icp2, sneedGovernanceId: gov2, paymentRecipient: account(carol), minClaimIntervalNs: DAY }]],
      });
      const g = (p) => actorAs(p2, premiumIdl, id, p);
      const l = actorAs(p2, ledgerIdl, icp2, admin);
      const t2 = actorAs(p2, ledgerIdl, tok2, admin);
      unwrap(await g(bob).addIcpTier({ name: 'Month', amountE8s: ICP, durationNs: 30n * DAY, active: true }));
      await l.mint(account(id, principalToSubaccount(alice)), ICP);
      unwrap(await g(alice).purchaseWithIcp());
      await t2.mint(account(id, principalToSubaccount(alice)), ICP); // stranded before the upgrade
      await p2.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(PREMIUM_WASM), arg: IDL.encode(premiumInit({ IDL }), [[]]) });
      expect((await g(alice).getIcpPaymentLogFor(alice, 0n, 10n)).total_count).toBe(1n);
      expect((await g(alice).getClaimLogFor(alice, 0n, 10n)).total_count).toBe(1n);
      expect('Active' in (await g(alice).checkMembership(alice))).toBe(true);
      expect(unwrap(await g(alice).withdrawDepositToken(tok2)).amountE8s).toBe(ICP - TOK_FEE);
    } finally {
      await p2.tearDown();
    }
  }, 300_000);
});
