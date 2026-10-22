// sneedapp support fixes (spec/support_audit.md §2.3, §4 P1-9, P1-12 and P2-17):
//  1. lookupLedgerTx(n): the activity-log blocks that name ICP ledger block n (a mint's payment
//     legs, refunds, withdrawals, top-ups), with the block while it is still in the canister, so
//     support can go from a ledger transaction to what happened. Blocks from before the upgrade
//     that adds the index are indexed on that upgrade.
//  2. withdrawUserToken(ledger): any ICRC-1 token sent by mistake to the caller's own payment
//     subaccount goes back to the caller's own default account (balance minus that ledger's fee),
//     never anywhere else, logged as sneedapp_deposit_token_withdraw. For the ICP ledger it is
//     withdrawUserPayment.
//  3. adminReturnStuckIcp(user, amount, reason): the restricted form of adminWithdrawIcp for ICP a
//     user is owed from aborted mints: only to that user's payment subaccount, at most their open
//     refund credits (the logged stuck_e8s), which shrink by it; with a reason and a
//     sneedapp_admin_stuck_return block. adminWithdrawIcp is kept.
//  4. The ingress guard covers the new methods; 5. an upgrade from the production build (#450,
//     f0121a0f…; built from d20ab1bf as sneedapp_preaudit).
// SNEEDAPP_WASM=sneedapp_preaudit runs this file against the code before these fixes (every test
// fails: the methods do not exist there).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import {
  createPic, install, actorAs, account, admin, alice, bob, carol, user, principalToSubaccount, ICP_LEDGER_ID, T, unwrap, errOf, wasm,
  refusedAtIngress, asUpdates,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { btype, txField } from '../lib/icrc3.js';
import { idlFactory as factoryIdl } from '../build/sneedapp.did.js';

const SNEEDAPP_WASM = process.env.SNEEDAPP_WASM || 'sneedapp';
const CMC_ID = Principal.fromText('rkp4c-7iaaa-aaaaa-aaaca-cai');
const ICP_FEE = 10_000n;
const TOK_FEE = 1_000n;
const ICP = 100_000_000n;
const CYCLES_ICP = 60_000_000n; // 2 T cycles at the mock CMC's 3.5 XDR/ICP plus 5%
const CYCLES_LEG = CYCLES_ICP + ICP_FEE;
const treasury = user('treasury');
const dave = user('dave');
const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const faultIdl = ({ IDL }) => IDL.Service({
  set_fail_from_main: IDL.Func([IDL.Vec(IDL.Principal)], [], []),
  set_reject_to: IDL.Func([IDL.Vec(Account)], [], []),
});
const v100 = { major: 1n, minor: 0n, patch: 0n, wasmHash: '', wasmUrl: [], sourceUrl: [], releaseNotes: '', releaseDate: 0n };
const daoApp = { appId: 'dao-app', name: 'DAO App', description: '', iconUrl: [], mintPriceE8s: ICP, premiumMintPriceE8s: ICP, viewUrl: [], manageUrl: [], mintUrl: [], families: [] };

let pic, appSubnet, factoryId, tokId, icp, tok, fault, f;
const as = (p) => actorAs(pic, factoryIdl, factoryId, p);
const depositAccount = (p) => account(factoryId, principalToSubaccount(p));
const allBlocks = async (g) => {
  const s = await g.icrc3_log_status();
  return (await g.icrc3_get_blocks([{ start: 0n, length: s.log_length }])).blocks;
};
const lastBlock = async () => (await allBlocks(f)).at(-1).block;
const setUpApp = async (g) => {
  await g.setFeeDestination(account(treasury));
  unwrap(await g.addApp(0n, daoApp));
  await g.addAppVersion('dao-app', v100);
  await g.uploadAppVersionWasm('dao-app', 1n, 0n, 0n, wasm('MockPremium'));
  unwrap(await g.setAppEnabled(0n, true));
};

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  const icpId = await install(pic, { name: 'MockLedgerFaulty', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  await install(pic, { name: 'MockCmc', targetCanisterId: CMC_ID });
  tokId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: TOK_FEE, symbol: 'TOK', decimals: 8 }], targetSubnetId: appSubnet });
  factoryId = await install(pic, { name: SNEEDAPP_WASM, cycles: 100n * T, targetSubnetId: appSubnet });
  icp = actorAs(pic, ledgerIdl, icpId, admin);
  tok = actorAs(pic, ledgerIdl, tokId, admin);
  fault = actorAs(pic, faultIdl, icpId, admin);
  f = as(admin);
  await setUpApp(f);
}, 120_000);
afterAll(async () => { await pic?.tearDown(); });

describe('1. lookupLedgerTx: from an ICP ledger block to the activity-log blocks that name it', () => {
  it('finds a mint by each of its payment legs, and a withdrawal by its block; public', async () => {
    await icp.mint(depositAccount(carol), ICP + ICP / 2n);
    const minted = unwrap(await as(carol).mintCanister('dao-app', [], [], [])).canisterId;
    const mint = (await allBlocks(f)).find((b) => btype(b.block) === 'sneedapp_mint');
    expect(txField(mint.block, 'canister_id')).toEqual({ Blob: minted.toUint8Array() });
    for (const field of ['cycles_tx', 'dao_cut_tx']) {
      const n = txField(mint.block, field).Nat;
      const r = await as(bob).lookupLedgerTx(n);
      expect(r.indexedFrom).toBe(0n);
      expect(r.hits.map((h) => [h.block_id, h.btype, h.field])).toEqual([[mint.id, 'sneedapp_mint', field]]);
      expect(r.hits[0].block).toEqual([mint.block]);
    }
    const w = unwrap(await as(carol).withdrawUserPayment());
    const r = await as(Principal.anonymous()).lookupLedgerTx(w);
    expect(r.hits.map((h) => [h.btype, h.field])).toEqual([['sneedapp_deposit_withdraw', 'icp_tx']]);
    expect((await f.lookupLedgerTx(10_000_000n)).hits).toEqual([]);
  }, 120_000);
});

describe('2. withdrawUserToken: a token sent by mistake goes back to its sender only', () => {
  it('returns the caller\'s own balance minus the token\'s fee to the caller, and touches nobody else', async () => {
    await tok.mint(depositAccount(alice), 5n * ICP);
    await tok.mint(depositAccount(dave), 2n * ICP);
    expect(errOf(await as(bob).withdrawUserToken(tokId))).toEqual({ InsufficientFunds: { balance: 0n } });
    expect(await tok.icrc1_balance_of(depositAccount(alice))).toBe(5n * ICP);
    const blockIndex = unwrap(await as(alice).withdrawUserToken(tokId));
    expect(await tok.icrc1_balance_of(depositAccount(alice))).toBe(0n);
    expect(await tok.icrc1_balance_of(account(alice))).toBe(5n * ICP - TOK_FEE);
    expect(await tok.icrc1_balance_of(depositAccount(dave))).toBe(2n * ICP);
    const b = await lastBlock();
    expect(btype(b)).toBe('sneedapp_deposit_token_withdraw');
    expect(txField(b, 'ledger')).toEqual({ Blob: tokId.toUint8Array() });
    expect(txField(b, 'amount')).toEqual({ Nat: 5n * ICP - TOK_FEE });
    expect(txField(b, 'ledger_tx')).toEqual({ Nat: blockIndex });
    expect(errOf(await as(alice).withdrawUserToken(tokId))).toEqual({ InsufficientFunds: { balance: 0n } });
    // a token block number is not an ICP block: not in lookupLedgerTx's index
    expect((await f.lookupLedgerTx(blockIndex)).hits.filter((h) => h.btype === 'sneedapp_deposit_token_withdraw')).toEqual([]);
  });

  it('for the ICP ledger it is withdrawUserPayment', async () => {
    await icp.mint(depositAccount(alice), ICP / 4n);
    const before = await icp.icrc1_balance_of(account(alice));
    unwrap(await as(alice).withdrawUserToken(ICP_LEDGER_ID));
    expect(await icp.icrc1_balance_of(account(alice))).toBe(before + ICP / 4n - ICP_FEE);
    expect(btype(await lastBlock())).toBe('sneedapp_deposit_withdraw');
  });

  it('a canister that is no ledger gives an error, not a trap; the anonymous principal is refused', async () => {
    expect(errOf(await as(alice).withdrawUserToken(CMC_ID)).GenericError.message).toMatch(/Could not reach the ledger/);
    await tok.mint(depositAccount(alice), ICP); // the lock was released
    unwrap(await as(alice).withdrawUserToken(tokId));
    await refusedAtIngress(as(Principal.anonymous()).withdrawUserToken(tokId));
  });
});

describe('3. adminReturnStuckIcp: only to the owed user, at most what is owed, with a reason', () => {
  let credit;
  it('refuses non-admins, a user who is owed nothing, more than is owed, no reason, dust', async () => {
    // a refund credit: a mint whose return failed
    await icp.mint(depositAccount(dave), ICP);
    await fault.set_reject_to([account(treasury)]);
    await fault.set_fail_from_main([factoryId]);
    try { errOf(await as(dave).mintCanister('dao-app', [], [], [])); } finally { await fault.set_reject_to([]); await fault.set_fail_from_main([]); }
    [credit] = await f.get_refund_credits_for(dave);
    expect(credit.legs).toEqual([{ fromSubaccount: [], amountE8s: CYCLES_LEG }]);
    // refuses non-admins, a user who is owed nothing, more than is owed, no reason
    await expect(as(dave).adminReturnStuckIcp(dave, ICP_FEE * 2n, 'x')).rejects.toThrow();
    expect(errOf(await f.adminReturnStuckIcp(bob, ICP_FEE * 2n, 'not owed'))).toMatch(/At most the user's open refund credits: 0 e8s/);
    expect(errOf(await f.adminReturnStuckIcp(dave, CYCLES_LEG + 1n, 'too much'))).toMatch(new RegExp(`At most .*: ${CYCLES_LEG} e8s`));
    expect(errOf(await f.adminReturnStuckIcp(dave, ICP_FEE * 2n, ''))).toMatch(/reason is required/);
    expect(errOf(await f.adminReturnStuckIcp(dave, ICP_FEE, 'dust'))).toMatch(/more than the ledger fee/);
    expect(await f.get_refund_credits_for(dave)).toEqual([credit]);
  }, 120_000);

  it('pays the user\'s payment subaccount from the main account, shrinks the credit, logs it; then closes it', async () => {
    const sub0 = await icp.icrc1_balance_of(depositAccount(dave));
    const half = CYCLES_LEG / 2n;
    const r1 = unwrap(await f.adminReturnStuckIcp(dave, half, 'leg source emptied; returned by hand'));
    expect(r1).toMatchObject({ returnedE8s: half - ICP_FEE, remainingE8s: CYCLES_LEG - half, creditsClosed: [] });
    expect(await icp.icrc1_balance_of(depositAccount(dave))).toBe(sub0 + half - ICP_FEE);
    expect((await f.get_refund_credits_for(dave))[0].legs).toEqual([{ fromSubaccount: [], amountE8s: CYCLES_LEG - half }]);
    const b = await lastBlock();
    expect(btype(b)).toBe('sneedapp_admin_stuck_return');
    expect(txField(b, 'user')).toEqual({ Blob: dave.toUint8Array() });
    expect(txField(b, 'reason')).toEqual({ Text: 'leg source emptied; returned by hand' });
    expect(txField(b, 'icp_tx')).toEqual({ Nat: r1.blockIndex });
    expect(txField(b, 'to')).toEqual({ Array: [{ Blob: factoryId.toUint8Array() }, { Blob: principalToSubaccount(dave) }] });
    const r2 = unwrap(await f.adminReturnStuckIcp(dave, CYCLES_LEG - half, 'the rest'));
    expect(r2).toMatchObject({ remainingE8s: 0n, creditsClosed: [credit.id] });
    expect(await f.get_refund_credits_for(dave)).toEqual([]);
    expect(errOf(await f.adminReturnStuckIcp(dave, ICP_FEE * 2n, 'again'))).toMatch(/: 0 e8s/);
    expect((await f.lookupLedgerTx(r2.blockIndex)).hits.map((h) => h.btype)).toEqual(['sneedapp_admin_stuck_return']);
    // the old method is still there
    expect(typeof f.adminWithdrawIcp).toBe('function');
  });
});

describe('4. ingress guard', () => {
  it('refuses lookupLedgerTx as an update (answers it as a query) and adminReturnStuckIcp from non-admins', async () => {
    expect((await as(bob).lookupLedgerTx(0n)).indexedFrom).toBe(0n);
    await refusedAtIngress(actorAs(pic, asUpdates(factoryIdl), factoryId, bob).lookupLedgerTx(0n));
    await refusedAtIngress(as(bob).adminReturnStuckIcp(dave, ICP, 'x'));
  });
});

describe('5. upgrade from production (#450, f0121a0f…)', () => {
  it('indexes the blocks from before the upgrade; withdrawUserToken returns a token stranded before it', async () => {
    const { pic: p2, appSubnet: sub2 } = await createPic();
    try {
      const icpId = await install(p2, { name: 'MockLedgerFaulty', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
      await install(p2, { name: 'MockCmc', targetCanisterId: CMC_ID });
      const tok2 = await install(p2, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: TOK_FEE, symbol: 'TOK', decimals: 8 }], targetSubnetId: sub2 });
      const id = await install(p2, { name: 'sneedapp_preaudit', cycles: 100n * T, targetSubnetId: sub2 });
      const g = actorAs(p2, factoryIdl, id, admin);
      const gCarol = actorAs(p2, factoryIdl, id, carol);
      const l = actorAs(p2, ledgerIdl, icpId, admin);
      await setUpApp(g);
      await l.mint(account(id, principalToSubaccount(carol)), ICP);
      const minted = unwrap(await gCarol.mintCanister('dao-app', [], [], [])).canisterId;
      await actorAs(p2, ledgerIdl, tok2, admin).mint(account(id, principalToSubaccount(carol)), ICP);
      await p2.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(SNEEDAPP_WASM), arg: IDL.encode([], []) });
      const mint = (await allBlocks(g)).find((b) => btype(b.block) === 'sneedapp_mint');
      const r = await g.lookupLedgerTx(txField(mint.block, 'cycles_tx').Nat);
      expect(r.indexedFrom).toBe(0n);
      expect(r.hits.map((h) => [h.block_id, h.btype])).toEqual([[mint.id, 'sneedapp_mint']]);
      expect((await g.lookupMintedCanister(minted))[0].minter.toText()).toBe(carol.toText());
      unwrap(await gCarol.withdrawUserToken(tok2));
      expect(await actorAs(p2, ledgerIdl, tok2, admin).icrc1_balance_of(account(carol))).toBe(ICP - TOK_FEE);
      // blocks appended after the upgrade are indexed too
      await l.mint(account(id, principalToSubaccount(carol)), ICP / 2n);
      const w = unwrap(await gCarol.withdrawUserPayment());
      expect((await g.lookupLedgerTx(w)).hits.map((h) => h.btype)).toEqual(['sneedapp_deposit_withdraw']);
    } finally {
      await p2.tearDown();
    }
  }, 300_000);
});
