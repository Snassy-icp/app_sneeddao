// sneedapp recovery (spec/support_audit.md, sneedapp critical findings): every paid mint whose
// funds moved ends either recorded or refunded, never stuck without a way out.
//  1. A failed hand-over leaves an orphan the minter receives later: retry_handover (the
//     recorded minter or an admin), adminSettleOrphan (admins, with a reason; #Delete refused
//     while the minter is owed the canister), get_orphans_for (public). Idempotent, logged
//     (sneedapp_orphan_settled), the mint recorded then; the canister only ever goes to the minter.
//  2. A cycles purchase that fails after the hand-over no longer turns a paid, handed-over mint
//     into an error: the mint is recorded, the failure is kept with the ICP block
//     (get_pending_top_ups) and retry_top_up (payer or admin) notifies the CMC again.
//  3. A ledger call that throws while the payment is split (publisher share, DAO cut) is a
//     failed step like a returned error: the canister is deleted and the payment returned. ICP
//     whose return fails becomes a refund credit the payer claims (claim_refund_credit).
//  Plus an upgrade from the production build (f9d8db0b, module hash dac5cd66…).
// The faults: MockLedgerFaulty (set_reject_to throws, set_hold_to holds a transfer so the test
// can take the factory's control of the new canister away before its hand-over), MockCmc set_fail.
// SNEEDAPP_WASM=<path without .wasm> runs the file against another build (e.g. the code before
// these fixes, to see every test here fail).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import {
  createPic, install, actorAs, account, admin, alice, bob, carol, user, principalToSubaccount, ICP_LEDGER_ID, T, unwrap, errOf, wasm,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit, cmcIdl } from '../lib/idl.js';
import { btype, txField } from '../lib/icrc3.js';
import { idlFactory as factoryIdl } from '../build/sneedapp.did.js';

const SNEEDAPP_WASM = process.env.SNEEDAPP_WASM || 'sneedapp';
const CMC_ID = Principal.fromText('rkp4c-7iaaa-aaaaa-aaaca-cai');
const ICP_FEE = 10_000n;
const ICP = 100_000_000n;
const CYCLES_ICP = 60_000_000n; // 2 T cycles at the mock CMC's 3.5 XDR/ICP plus 5%
const CYCLES_LEG = CYCLES_ICP + ICP_FEE; // to the main account: the cycles ICP and the CMC transfer's fee
const treasury = user('treasury');
const blocker = user('blocker'); // takes the factory's control away for a while
const dave = user('dave');
const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const faultIdl = ({ IDL }) => IDL.Service({
  set_fail_to: IDL.Func([IDL.Vec(IDL.Principal)], [], []),
  set_fail_from_main: IDL.Func([IDL.Vec(IDL.Principal)], [], []),
  set_reject_to: IDL.Func([IDL.Vec(Account)], [], []),
  set_hold_to: IDL.Func([IDL.Vec(IDL.Principal)], [], []),
});
const cmcFaultIdl = ({ IDL }) => IDL.Service({
  set_fail: IDL.Func([IDL.Variant({ none: IDL.Null, reject: IDL.Null, processing: IDL.Null })], [], []),
});
const texts = (ps) => ps.map((p) => p.toText()).sort();
const v100 = { major: 1n, minor: 0n, patch: 0n, wasmHash: '', wasmUrl: [], sourceUrl: [], releaseNotes: '', releaseDate: 0n };

let pic, appSubnet, factoryId, icp, fault, cmc, cmcFault, f;
const as = (p) => actorAs(pic, factoryIdl, factoryId, p);
const depositAccount = (p) => account(factoryId, principalToSubaccount(p));
const deposit = (p, amount) => icp.mint(depositAccount(p), amount);
const bal = (acc) => icp.icrc1_balance_of(acc);
const lastBlocks = async (n) => {
  const s = await f.icrc3_log_status();
  return (await f.icrc3_get_blocks([{ start: s.log_length - BigInt(n), length: BigInt(n) }])).blocks.map((b) => b.block);
};
/// The canister id PocketIC allocates after `id` on the same subnet (8-byte big-endian index, then 0x01 0x01).
function nextCanisterId(id) {
  const b = id.toUint8Array();
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(b[i]);
  n += 1n;
  const out = new Uint8Array(10);
  for (let i = 7; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n; }
  out[8] = 1; out[9] = 1;
  return Principal.fromUint8Array(out);
}

/// Mints `appId` for `who` while the DAO cut transfer is held at the ledger; meanwhile the new
/// canister's controllers become [blocker], so the factory's hand-over fails. Answers the result
/// and the canister id.
async function mintWithFailedHandOver(who, appId) {
  const probe = await pic.createCanister({ sender: admin, targetSubnetId: appSubnet });
  const next = nextCanisterId(probe);
  await fault.set_hold_to([treasury]);
  const deferred = pic.createDeferredActor({ idlFactory: factoryIdl, canisterId: factoryId });
  deferred.setPrincipal(who);
  const call = await deferred.mintCanister(appId, [], [], []);
  let installed = false;
  for (let i = 0; i < 60 && !installed; i++) {
    await pic.tick();
    try { installed = texts(await pic.getControllers(next)).join() === factoryId.toText(); } catch { /* not created yet */ }
  }
  expect(installed, 'the new canister exists, controlled by the factory').toBe(true);
  await pic.tick(5); // installed before the DAO cut transfer, which is held
  await pic.updateCanisterSettings({ canisterId: next, sender: factoryId, controllers: [blocker] });
  await fault.set_hold_to([]);
  return { result: await call(), canisterId: next };
}

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  const icpId = await install(pic, { name: 'MockLedgerFaulty', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  await install(pic, { name: 'MockCmc', targetCanisterId: CMC_ID });
  factoryId = await install(pic, { name: SNEEDAPP_WASM, cycles: 100n * T, targetSubnetId: appSubnet });
  icp = actorAs(pic, ledgerIdl, icpId, admin);
  fault = actorAs(pic, faultIdl, icpId, admin);
  cmc = actorAs(pic, cmcIdl, CMC_ID, admin);
  cmcFault = actorAs(pic, cmcFaultIdl, CMC_ID, admin);
  f = as(admin);
  await f.setFeeDestination(account(treasury));
  // a Sneed DAO app (publisher 0, the whole profit to the fee destination) and a verified
  // publisher's app (a share to the publisher's revenue subaccount, a DAO cut)
  unwrap(await f.addApp(0n, { appId: 'dao-app', name: 'DAO App', description: '', iconUrl: [], mintPriceE8s: ICP, premiumMintPriceE8s: ICP, viewUrl: [], manageUrl: [], mintUrl: [], families: [] }));
  await f.addAppVersion('dao-app', v100);
  await f.uploadAppVersionWasm('dao-app', 1n, 0n, 0n, wasm('MockPremium'));
  unwrap(await f.setAppEnabled(0n, true));
  unwrap(await as(alice).createPublisher({ name: 'Alice Labs', description: '', websiteUrl: [], logoUrl: [], links: [], defaultPaymentAccount: account(alice) }));
  await f.verifyPublisher(1n);
  unwrap(await as(alice).addApp(1n, { appId: 'demo', name: 'Demo', description: '', iconUrl: [], mintPriceE8s: ICP, premiumMintPriceE8s: ICP, viewUrl: [], manageUrl: [], mintUrl: [], families: [] }));
  await as(alice).addAppVersion('demo', v100);
  await as(alice).uploadAppVersionWasm('demo', 1n, 0n, 0n, wasm('MockPremium'));
  unwrap(await as(alice).setAppEnabled(1n, true));
}, 120_000);
afterAll(async () => { await pic?.tearDown(); });

describe('1. a failed hand-over: the minter receives the canister later', () => {
  let orphan;

  it('the mint answers Err naming retry_handover; the orphan is public by minter and nothing is recorded as minted yet', async () => {
    await deposit(carol, ICP);
    const mints = await f.getMintLogCount();
    const { result, canisterId } = await mintWithFailedHandOver(carol, 'dao-app');
    orphan = canisterId;
    expect(errOf(result).CanisterCreationFailed).toMatch(/handing control to you failed .*retry_handover/s);
    const listed = await as(bob).get_orphans_for(carol);
    expect(listed.map((o) => [o.canisterId.toText(), o.minter.toText(), o.appId, o.handOverPending])).toEqual([[orphan.toText(), carol.toText(), 'dao-app', true]]);
    expect(await as(bob).get_orphans_for(bob)).toEqual([]);
    expect(await f.getMintLogCount()).toBe(mints);
    expect(texts(await pic.getControllers(orphan))).toEqual([blocker.toText()]);
    // paid in full: cycles ICP in the main account, the profit at the fee destination
    expect(await f.getUserPaymentBalance(carol)).toBe(0n);
  }, 180_000);

  it('only the minter or an admin may retry; a retry that fails again changes nothing', async () => {
    expect(errOf(await as(bob).retry_handover(orphan))).toMatch(/Only the minter/);
    expect(errOf(await as(carol).retry_handover(orphan))).toMatch(/failed again/);
    expect((await as(bob).get_orphans_for(carol)).length).toBe(1);
  });

  it('admins cannot delete a canister its minter paid for; others cannot settle at all', async () => {
    expect(errOf(await f.adminSettleOrphan(orphan, { Delete: null }, 'cleanup'))).toMatch(/owed it/);
    await expect(as(bob).adminSettleOrphan(orphan, { HandOver: null }, 'mine')).rejects.toThrow();
  });

  it('retry_handover hands it to the minter alone, buys its cycles, records the mint and logs the settlement; a repeat is a no-op', async () => {
    await pic.updateCanisterSettings({ canisterId: orphan, sender: blocker, controllers: [factoryId] }); // the fault clears
    const notes = (await cmc.get_notifications()).length;
    const mints = await f.getMintLogCount();
    unwrap(await as(carol).retry_handover(orphan));
    expect(texts(await pic.getControllers(orphan))).toEqual([carol.toText()]);
    expect(await f.getMintLogCount()).toBe(mints + 1n);
    expect((await f.lookupMintedCanister(orphan))[0]).toMatchObject({ minter: carol, appId: 'dao-app', icpPaidE8s: ICP });
    expect((await as(carol).getMyWallet()).map((e) => e.canisterId.toText())).toContain(orphan.toText());
    expect((await cmc.get_notifications()).length).toBe(notes + 1); // the cycles were bought
    expect(await as(bob).get_orphans_for(carol)).toEqual([]);
    expect(await f.getOrphanCanisters()).toEqual([]);
    const [settled, minted] = await lastBlocks(2);
    expect(btype(settled)).toBe('sneedapp_orphan_settled');
    expect(txField(settled, 'action')).toEqual({ Text: 'hand_over' });
    expect(txField(settled, 'reason')).toEqual({ Text: 'retried by the minter' });
    expect(txField(settled, 'minter').Blob).toBeDefined();
    expect(btype(minted)).toBe('sneedapp_mint');
    expect(txField(minted, 'price_e8s')).toEqual({ Nat: ICP });
    expect(txField(minted, 'cycles_received')).toEqual({ Nat: 1_000_000_000_000n });
    // idempotent: nothing happens twice
    unwrap(await as(carol).retry_handover(orphan));
    expect(await f.getMintLogCount()).toBe(mints + 1n);
    expect((await cmc.get_notifications()).length).toBe(notes + 1);
  }, 120_000);

  it('adminSettleOrphan(#HandOver) gives it to the recorded minter (never the admin), with the admin\'s reason', async () => {
    await deposit(dave, ICP);
    const { result, canisterId } = await mintWithFailedHandOver(dave, 'demo');
    expect(errOf(result).CanisterCreationFailed).toMatch(/retry_handover/);
    await pic.updateCanisterSettings({ canisterId, sender: blocker, controllers: [factoryId] });
    unwrap(await f.adminSettleOrphan(canisterId, { HandOver: null }, 'support ticket 17'));
    expect(texts(await pic.getControllers(canisterId))).toEqual([dave.toText()]);
    expect((await f.lookupMintedCanister(canisterId))[0].minter.toText()).toBe(dave.toText());
    const settled = (await lastBlocks(4)).find((b) => btype(b) === 'sneedapp_orphan_settled');
    expect(txField(settled, 'reason')).toEqual({ Text: 'support ticket 17' });
    expect(errOf(await f.adminSettleOrphan(canisterId, { Delete: null }, 'x'))).toMatch(/No orphaned canister/);
  }, 180_000);
});

describe('2. the cycles purchase fails after the hand-over: the mint still succeeds and is recorded', () => {
  let pendingId, block;

  it('a CMC that rejects notify_top_up: Ok for the user, the mint recorded, the failure kept with its ICP block', async () => {
    await deposit(carol, ICP);
    await cmcFault.set_fail({ reject: null });
    const mints = await f.getMintLogCount();
    let res;
    try { res = await as(carol).mintCanister('dao-app', [], [], []); } finally { await cmcFault.set_fail({ none: null }); }
    const id = unwrap(res).canisterId;
    expect(texts(await pic.getControllers(id))).toEqual([carol.toText()]);
    expect(await f.getMintLogCount()).toBe(mints + 1n);
    const [p] = (await f.get_pending_top_ups()).filter((x) => x.canisterId.toText() === id.toText());
    expect(p).toMatchObject({ payer: carol, icpE8s: CYCLES_ICP });
    expect(p.block.length).toBe(1);
    expect(p.reason).toMatch(/notify_top_up failed/);
    ({ id: pendingId } = p);
    [block] = p.block;
    const [minted] = await lastBlocks(1);
    expect(btype(minted)).toBe('sneedapp_mint');
    expect(txField(minted, 'top_up_tx')).toEqual({ Nat: block });
    expect(txField(minted, 'top_up_pending_id')).toEqual({ Nat: pendingId });
    expect(txField(minted, 'cycles_received')).toBeUndefined();
    // the ICP waits at the CMC for the factory
    expect(await bal(account(CMC_ID, principalToSubaccount(factoryId)))).toBeGreaterThanOrEqual(CYCLES_ICP);
  }, 120_000);

  it('retry_top_up: the payer or an admin, notifying the CMC with the same block; a still-failing CMC keeps it pending', async () => {
    expect(errOf(await as(bob).retry_top_up(pendingId))).toMatch(/Only the payer/);
    await cmcFault.set_fail({ processing: null });
    try {
      expect(errOf(await as(carol).retry_top_up(pendingId))).toMatch(/still processing/);
    } finally { await cmcFault.set_fail({ none: null }); }
    expect((await f.get_pending_top_ups()).map((x) => x.id)).toContain(pendingId);
    const cyclesBefore = (await f.getFactoryAggregates()).totalCyclesReceivedFromCmc;
    expect(unwrap(await as(carol).retry_top_up(pendingId))).toBe(1_000_000_000_000n);
    const notes = await cmc.get_notifications();
    expect(notes[notes.length - 1][0]).toBe(BigInt(block)); // the recorded block, no second transfer
    expect((await f.get_pending_top_ups()).map((x) => x.id)).not.toContain(pendingId);
    expect((await f.getFactoryAggregates()).totalCyclesReceivedFromCmc).toBe(cyclesBefore + 1_000_000_000_000n);
    const [retried] = await lastBlocks(1);
    expect(btype(retried)).toBe('sneedapp_top_up_retry');
    expect(txField(retried, 'outcome')).toEqual({ Text: 'ok' });
    expect(errOf(await as(carol).retry_top_up(pendingId))).toMatch(/No pending top-up/);
  }, 120_000);

  it('a failed transfer to the CMC: the ICP stays in the main account, pending without a block; the retry transfers and notifies', async () => {
    await deposit(carol, ICP);
    await fault.set_fail_to([CMC_ID]);
    let res;
    try { res = await as(carol).mintCanister('dao-app', [], [], []); } finally { await fault.set_fail_to([]); }
    const id = unwrap(res).canisterId;
    const [p] = (await f.get_pending_top_ups()).filter((x) => x.canisterId.toText() === id.toText());
    expect(p.block).toEqual([]);
    expect(p.reason).toMatch(/transfer to the CMC failed/);
    const notes = (await cmc.get_notifications()).length;
    unwrap(await f.retry_top_up(p.id)); // an admin
    expect((await cmc.get_notifications()).length).toBe(notes + 1);
    expect(await f.get_pending_top_ups()).toEqual([]);
  }, 120_000);
});

describe('3. a ledger call that throws while the payment is split is rolled back; what cannot be returned is claimable', () => {
  it('step 4 (the DAO profit) throws: the canister is deleted and the deposit comes back less two fees', async () => {
    await deposit(carol, ICP - (await f.getUserPaymentBalance(carol)));
    const mints = await f.getMintLogCount();
    const main = await f.getIcpBalance();
    await fault.set_reject_to([account(treasury)]);
    let res;
    try { res = await as(carol).mintCanister('dao-app', [], [], []); } finally { await fault.set_reject_to([]); }
    expect(errOf(res).TransferFailed).toMatch(/Failed to transfer DAO profit; your deposit \(less ledger fees\) remains/);
    expect(await f.getUserPaymentBalance(carol)).toBe(ICP - 2n * ICP_FEE); // the cycles transfer and its undo
    expect(await f.getIcpBalance()).toBe(main);
    expect(await f.getMintLogCount()).toBe(mints);
    expect(await f.getOrphanCanisters()).toEqual([]); // deleted, not left with the factory
    const refund = (await lastBlocks(2)).find((b) => btype(b) === 'sneedapp_mint_refund');
    expect(txField(refund, 'stuck_e8s')).toEqual({ Nat: 0n });
    unwrap(await as(carol).withdrawUserPayment());
  }, 120_000);

  it('step 2 (the publisher share) throws: the cycles ICP comes back, nothing reaches the publisher', async () => {
    await deposit(carol, ICP);
    const revSub = await f.getPublisherRevenueSubaccount(1n);
    const pub = await f.getPublisherRevenueBalance(1n);
    await fault.set_reject_to([account(factoryId, revSub)]);
    let res;
    try { res = await as(carol).mintCanister('demo', [], [], []); } finally { await fault.set_reject_to([]); }
    expect(errOf(res).TransferFailed).toMatch(/Failed to transfer publisher share; your deposit \(less ledger fees\) remains/);
    expect(await f.getUserPaymentBalance(carol)).toBe(ICP - 2n * ICP_FEE);
    expect(await f.getPublisherRevenueBalance(1n)).toBe(pub);
    unwrap(await as(carol).withdrawUserPayment());
  }, 120_000);

  let credit;
  it('when returning the moved ICP fails too, it becomes a refund credit of the payer, public and named in the error', async () => {
    await deposit(carol, ICP);
    await fault.set_reject_to([account(treasury)]);
    await fault.set_fail_from_main([factoryId]);
    let res;
    try { res = await as(carol).mintCanister('dao-app', [], [], []); } finally { await fault.set_reject_to([]); }
    const msg = errOf(res).TransferFailed;
    expect(msg).toMatch(new RegExp(`returning ${CYCLES_LEG} e8s .* claim it back with claim_refund_credit\\(\\d+\\)`));
    const [c] = await as(bob).get_refund_credits_for(carol);
    expect(c).toMatchObject({ payer: carol, appId: 'dao-app' });
    expect(c.legs).toEqual([{ fromSubaccount: [], amountE8s: CYCLES_LEG }]);
    credit = c.id;
    expect(msg).toContain(`claim_refund_credit(${credit})`);
    expect(await f.getUserPaymentBalance(carol)).toBe(ICP - CYCLES_LEG - ICP_FEE);
    const refund = (await lastBlocks(2)).find((b) => btype(b) === 'sneedapp_mint_refund');
    expect(txField(refund, 'credit_id')).toEqual({ Nat: credit });
  }, 120_000);

  it('claim_refund_credit pays the payer only (to their payment subaccount); a failing claim keeps the credit; it pays once', async () => {
    expect(errOf(await as(bob).claim_refund_credit(credit))).toMatch(/Only the payer/);
    expect(errOf(await as(carol).claim_refund_credit(credit))).toMatch(/failed again/); // the main account still refuses
    expect((await f.get_refund_credits_for(carol)).length).toBe(1);
    await fault.set_fail_from_main([]);
    const before = await f.getUserPaymentBalance(carol);
    expect(unwrap(await as(carol).claim_refund_credit(credit))).toEqual({ returnedE8s: CYCLES_LEG - ICP_FEE, remainingE8s: 0n });
    expect(await f.getUserPaymentBalance(carol)).toBe(before + CYCLES_LEG - ICP_FEE);
    expect(await f.get_refund_credits_for(carol)).toEqual([]);
    expect(errOf(await as(carol).claim_refund_credit(credit))).toMatch(/No refund credit/);
    const [claim] = await lastBlocks(1);
    expect(btype(claim)).toBe('sneedapp_refund_credit_claim');
    expect(txField(claim, 'returned_e8s')).toEqual({ Nat: CYCLES_LEG - ICP_FEE });
    unwrap(await as(carol).withdrawUserPayment());
  }, 120_000);

  it('an admin can close a credit settled by hand, so it is never paid twice', async () => {
    await deposit(dave, ICP);
    await fault.set_reject_to([account(treasury)]);
    await fault.set_fail_from_main([factoryId]);
    try { errOf(await as(dave).mintCanister('dao-app', [], [], [])); } finally { await fault.set_reject_to([]); await fault.set_fail_from_main([]); }
    const [c] = await f.get_refund_credits_for(dave);
    unwrap(await f.adminWithdrawIcp(CYCLES_LEG - ICP_FEE, depositAccount(dave))); // returned by hand
    await expect(as(dave).adminCloseRefundCredit(c.id, 'returned by hand')).rejects.toThrow();
    unwrap(await f.adminCloseRefundCredit(c.id, 'returned by hand with adminWithdrawIcp'));
    expect(errOf(await as(dave).claim_refund_credit(c.id))).toMatch(/No refund credit/);
    expect(btype((await lastBlocks(1))[0])).toBe('sneedapp_refund_credit_closed');
  }, 120_000);
});

describe('upgrade from production (f9d8db0b, module hash dac5cd66…)', () => {
  it('keeps mints, wallets and config; the recovery queries start empty and recovery works afterwards', async () => {
    const { pic: p2, appSubnet: sub2 } = await createPic();
    try {
      const icpId = await install(p2, { name: 'MockLedgerFaulty', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
      await install(p2, { name: 'MockCmc', targetCanisterId: CMC_ID });
      const id = await install(p2, { name: 'sneedapp_presp', cycles: 100n * T, targetSubnetId: sub2 });
      const g = actorAs(p2, factoryIdl, id, admin);
      const gCarol = actorAs(p2, factoryIdl, id, carol);
      const ledger = actorAs(p2, ledgerIdl, icpId, admin);
      await g.setFeeDestination(account(treasury));
      unwrap(await g.addApp(0n, { appId: 'dao-app', name: 'DAO App', description: '', iconUrl: [], mintPriceE8s: ICP, premiumMintPriceE8s: ICP, viewUrl: [], manageUrl: [], mintUrl: [], families: [] }));
      await g.addAppVersion('dao-app', v100);
      await g.uploadAppVersionWasm('dao-app', 1n, 0n, 0n, wasm('MockPremium'));
      unwrap(await g.setAppEnabled(0n, true));
      await ledger.mint(account(id, principalToSubaccount(carol)), ICP);
      const first = unwrap(await gCarol.mintCanister('dao-app', [], [], [])).canisterId;
      await p2.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(SNEEDAPP_WASM), arg: IDL.encode([], []) });
      expect((await g.lookupMintedCanister(first))[0].minter.toText()).toBe(carol.toText());
      expect((await gCarol.getMyWallet()).map((e) => e.canisterId.toText())).toEqual([first.toText()]);
      expect((await g.getPaymentConfig()).feeDestination.owner.toText()).toBe(treasury.toText());
      expect(await g.get_orphans_for(carol)).toEqual([]);
      expect(await g.get_pending_top_ups()).toEqual([]);
      expect(await g.get_refund_credits_for(carol)).toEqual([]);
      // a mint whose cycles purchase fails is now recorded and retried
      await ledger.mint(account(id, principalToSubaccount(carol)), ICP);
      await actorAs(p2, cmcFaultIdl, CMC_ID, admin).set_fail({ reject: null });
      const second = unwrap(await gCarol.mintCanister('dao-app', [], [], [])).canisterId;
      await actorAs(p2, cmcFaultIdl, CMC_ID, admin).set_fail({ none: null });
      expect(await g.getMintLogCount()).toBe(2n);
      const [p] = await g.get_pending_top_ups();
      expect(p.canisterId.toText()).toBe(second.toText());
      unwrap(await gCarol.retry_top_up(p.id));
    } finally {
      await p2.tearDown();
    }
  }, 300_000);
});
