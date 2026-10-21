// The wallet's approvals module (src/app_sneeddao_frontend/src/utils/approvals.js) against the real
// ICRC ledger and index-ng wasms: the three ways of finding a user's ICRC-2 approvals (ICRC-103,
// the index's approve history checked with icrc2_allowance, known spenders only) agree, expired
// and used-up approvals drop out, subaccounts are kept apart, and Revoke / Change (icrc2_approve
// with expected_allowance) do what the UI promises.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, actorAs, account, admin, alice, bob, carol, user, T, unwrap, BUILD } from '../lib/pic.js';
import {
  discoverApprovals, getLedgerApprovalInfo, listAllowancesIcrc103, approvesFromIndexNg, setApproval,
  approvalRisk, accountKey,
} from '../../../src/app_sneeddao_frontend/src/utils/approvals.js';

const ledgerGz = resolve(BUILD, 'ledger.wasm.gz');
const indexGz = resolve(BUILD, 'index.wasm.gz');
const E8S = 100_000_000n;
const FEE = 10_000n;
const MIN_NS = 60_000_000_000n;
const dave = user('dave');
const sub7 = new Uint8Array(32).fill(7);
const spenders = Array.from({ length: 12 }, (_, i) => user(`spender-${i}`));

const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const MetadataValue = IDL.Variant({ Nat: IDL.Nat, Int: IDL.Int, Text: IDL.Text, Blob: IDL.Vec(IDL.Nat8) });
const LedgerArg = IDL.Variant({
  Init: IDL.Record({
    minting_account: Account, transfer_fee: IDL.Nat, decimals: IDL.Opt(IDL.Nat8), token_symbol: IDL.Text, token_name: IDL.Text,
    metadata: IDL.Vec(IDL.Tuple(IDL.Text, MetadataValue)), initial_balances: IDL.Vec(IDL.Tuple(Account, IDL.Nat)),
    feature_flags: IDL.Opt(IDL.Record({ icrc2: IDL.Bool })),
    archive_options: IDL.Record({ num_blocks_to_archive: IDL.Nat64, trigger_threshold: IDL.Nat64, controller_id: IDL.Principal, cycles_for_archive_creation: IDL.Opt(IDL.Nat64) }),
  }),
  Upgrade: IDL.Opt(IDL.Record({})),
});
const IndexArg = IDL.Variant({
  Init: IDL.Record({ ledger_id: IDL.Principal, retrieve_blocks_from_ledger_interval_seconds: IDL.Opt(IDL.Nat64) }),
  Upgrade: IDL.Record({ ledger_id: IDL.Opt(IDL.Principal), retrieve_blocks_from_ledger_interval_seconds: IDL.Opt(IDL.Nat64) }),
});
const icrcIdl = ({ IDL: I }) => I.Service({
  icrc1_transfer: I.Func([I.Record({ from_subaccount: I.Opt(I.Vec(I.Nat8)), to: Account, amount: I.Nat, fee: I.Opt(I.Nat), memo: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64) })], [I.Variant({ Ok: I.Nat, Err: I.Reserved })], []),
  icrc2_approve: I.Func([I.Record({ from_subaccount: I.Opt(I.Vec(I.Nat8)), spender: Account, amount: I.Nat, expected_allowance: I.Opt(I.Nat), expires_at: I.Opt(I.Nat64), fee: I.Opt(I.Nat), memo: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64) })], [I.Variant({ Ok: I.Nat, Err: I.Reserved })], []),
  icrc2_transfer_from: I.Func([I.Record({ spender_subaccount: I.Opt(I.Vec(I.Nat8)), from: Account, to: Account, amount: I.Nat, fee: I.Opt(I.Nat), memo: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64) })], [I.Variant({ Ok: I.Nat, Err: I.Reserved })], []),
});

const haveWasms = existsSync(ledgerGz) && existsSync(indexGz);
let pic, tokId, indexId, ledgerText, indexText;
// an "agent" for approvals.js: actors made by PocketIC, calling as `who`
const agentAs = (who) => ({ createActor: (idl, id) => actorAs(pic, idl, Principal.fromText(id), who) });
const anonAgent = () => agentAs(Principal.anonymous());
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const approve = async (from, spender, amount, { expiresAt = null, sub = null } = {}) =>
  unwrap(await actorAs(pic, icrcIdl, tokId, from).icrc2_approve({ from_subaccount: sub ? [sub] : [], spender, amount, expected_allowance: [], expires_at: expiresAt == null ? [] : [expiresAt], fee: [], memo: [], created_at_time: [] }));
const keys = (r) => r.approvals.map((a) => accountKey(a.spender.owner.toText(), a.spender.subaccount)).sort();
const find = (r, p, sub = null) => r.approvals.find((a) => accountKey(a.spender.owner.toText(), a.spender.subaccount) === accountKey(p.toText(), sub));
const syncIndex = async () => { for (let i = 0; i < 6; i++) { await pic.advanceTime(2_000); await pic.tick(3); } };
// expiries judged by the ledger's clock (PocketIC runs ahead of the wall clock here)
const discover = async (o = {}) => discoverApprovals({ agent: anonAgent(), ledgerId: ledgerText, owner: alice.toText(), now: await nowNs(), ...o });

describe.skipIf(!haveWasms)('wallet approvals discovery (real ledger + index)', () => {
  beforeAll(async () => {
    let appSubnet;
    ({ pic, appSubnet } = await createPic());
    tokId = await pic.createCanister({ sender: admin, cycles: 100n * T, targetSubnetId: appSubnet, controllers: [admin] });
    await pic.installCode({ sender: admin, canisterId: tokId, wasm: readFileSync(ledgerGz), arg: IDL.encode([LedgerArg], [{ Init: {
      minting_account: account(carol), transfer_fee: FEE, decimals: [8], token_symbol: 'TOK', token_name: 'Token', metadata: [],
      initial_balances: [[account(alice), 1_000n * E8S], [account(alice, sub7), 10n * E8S], [account(bob), 10n * E8S]], feature_flags: [{ icrc2: true }],
      archive_options: { num_blocks_to_archive: 1000n, trigger_threshold: 2000n, controller_id: admin, cycles_for_archive_creation: [10n * T] },
    } }]) });
    indexId = await pic.createCanister({ sender: admin, cycles: 100n * T, targetSubnetId: appSubnet, controllers: [admin] });
    await pic.installCode({ sender: admin, canisterId: indexId, wasm: readFileSync(indexGz), arg: IDL.encode([IDL.Opt(IndexArg)], [[{ Init: { ledger_id: tokId, retrieve_blocks_from_ledger_interval_seconds: [1n] } }]]) });
    ledgerText = tokId.toText();
    indexText = indexId.toText();

    const now = await nowNs();
    await approve(alice, account(bob), 2n ** 127n - 1n);                                   // unlimited, never expires
    await approve(alice, account(carol), 5n * E8S, { expiresAt: now + 24n * 60n * MIN_NS });  // 5 TOK for a day
    await approve(alice, account(dave), 1n * E8S, { expiresAt: now + 2n * MIN_NS });          // expires in 2 minutes
    await approve(alice, account(bob, sub7), 3n * E8S);                                      // a spender subaccount
    await approve(alice, account(carol), 7n * E8S, { expiresAt: now + 24n * 60n * MIN_NS }, ); // replaces carol's 5
    await approve(alice, account(dave), 2n * E8S, { sub: sub7 });                            // from alice's subaccount 7
    for (const s of spenders) await approve(alice, account(s), 1n * E8S, { expiresAt: now + 24n * 60n * MIN_NS });
    await approve(alice, account(spenders[0]), 0n);                                          // revoked again
    // bob uses 1 TOK of his unlimited approval
    unwrap(await actorAs(pic, icrcIdl, tokId, bob).icrc2_transfer_from({ spender_subaccount: [], from: account(alice), to: account(bob), amount: E8S, fee: [], memo: [], created_at_time: [] }));
    await syncIndex();
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('reads the ledger: ICRC-2 and ICRC-103 supported, no index named without ICRC-106 (the hint is used)', async () => {
    const info = await getLedgerApprovalInfo(anonAgent(), ledgerText);
    expect(info.icrc2).toBe(true);
    expect(info.icrc103).toBe(true);
    const hinted = await getLedgerApprovalInfo(anonAgent(), ledgerText, { indexHint: indexText });
    expect(hinted.indexId === indexText || hinted.indexId === info.indexId).toBe(true);
  });

  it('ICRC-103 lists every live approval of the main account, paging by spender', async () => {
    const r = await discover({ icrc103PageSize: 5 }); // 15 approvals over 3+ pages
    expect(r.method).toBe('icrc103');
    expect(r.complete).toBe(true);
    // bob, bob.sub7, carol, dave (not yet expired), spenders 1..11; not spenders[0] (revoked), not alice's subaccount's
    expect(r.approvals).toHaveLength(15);
    expect(find(r, spenders[0])).toBeUndefined();
    expect(find(r, carol).allowance).toBe(7n * E8S);                   // the latest approve counts
    expect(find(r, bob).allowance).toBe(2n ** 64n - 1n - E8S - FEE);    // capped at u64 (SNS ledger); transfer_from used amount + fee
    expect(find(r, bob, sub7).allowance).toBe(3n * E8S);
    const all = await listAllowancesIcrc103(anonAgent(), ledgerText, alice.toText());
    expect(all.length).toBe(15);
  });

  it('judges risk: unlimited and no-expiry are warned about, a dated small one is not', async () => {
    const r = await discover();
    expect(approvalRisk(find(r, bob), { decimals: 8 })).toMatchObject({ unlimited: true, noExpiry: true, level: 'warn' });
    expect(approvalRisk(find(r, carol), { decimals: 8 })).toMatchObject({ unlimited: false, noExpiry: false, level: 'ok' });
    expect(approvalRisk(find(r, carol), { decimals: 8, balance: E8S })).toMatchObject({ aboveBalance: true });
  });

  it('the index path finds the same approvals as ICRC-103', async () => {
    const via103 = await discover();
    const viaIndex = await discover({ useIcrc103: false, indexHint: indexText });
    expect(viaIndex.method).toBe('index');
    expect(viaIndex.complete).toBe(true);
    expect(keys(viaIndex)).toEqual(keys(via103));
    for (const a of via103.approvals) {
      const b = find(viaIndex, a.spender.owner, a.spender.subaccount);
      expect(b.allowance).toBe(a.allowance);
      expect(b.expiresAt).toBe(a.expiresAt);
    }
    const hist = await approvesFromIndexNg(anonAgent(), indexText, alice.toText(), null, { pageSize: 4 }); // paging through the history
    expect(hist.complete).toBe(true);
    expect(hist.spenders.length).toBe(16); // every spender ever approved by the main account, revoked one included
  });

  it('known spenders only: finds what it is asked about and says it is partial', async () => {
    const r = await discover({ useIcrc103: false, candidates: [{ owner: carol.toText() }, { owner: user('nobody').toText() }] });
    expect(r.method).toBe('known');
    expect(r.complete).toBe(false);
    expect(keys(r)).toEqual([carol.toText()]);
  });

  it('subaccounts are separate accounts', async () => {
    const r = await discover({ subaccount: sub7 });
    expect(keys(r)).toEqual([dave.toText()]);
    expect(r.approvals[0].from.subaccount[0]).toEqual(sub7);
    const viaIndex = await discover({ subaccount: sub7, useIcrc103: false, indexHint: indexText });
    expect(keys(viaIndex)).toEqual([dave.toText()]);
  });

  it('expired approvals drop out', async () => {
    await pic.advanceTime(3 * 60_000);
    await pic.tick(2);
    const r = await discover();
    expect(find(r, dave)).toBeUndefined();
    expect(r.approvals).toHaveLength(14);
    await syncIndex();
    expect(keys(await discover({ useIcrc103: false, indexHint: indexText }))).toEqual(keys(r));
  });

  it('Change and Revoke go through with the shown allowance and are refused when it moved', async () => {
    const before = find(await discover(), carol);
    const until = (await nowNs()) + 60n * MIN_NS;
    await setApproval({ agent: agentAs(alice), ledgerId: ledgerText, spender: { owner: carol.toText() }, amount: 2n * E8S, expectedAllowance: before.allowance, expiresAt: until });
    const changed = find(await discover(), carol);
    expect(changed.allowance).toBe(2n * E8S);
    expect(changed.expiresAt).toBe(until);
    // the UI still shows 7 TOK: the ledger refuses, with a readable reason
    await expect(setApproval({ agent: agentAs(alice), ledgerId: ledgerText, spender: { owner: carol.toText() }, amount: 0n, expectedAllowance: before.allowance }))
      .rejects.toThrow(/allowance changed/i);
    expect(find(await discover(), carol).allowance).toBe(2n * E8S);
    await setApproval({ agent: agentAs(alice), ledgerId: ledgerText, spender: { owner: carol.toText() }, amount: 0n, expectedAllowance: 2n * E8S });
    expect(find(await discover(), carol)).toBeUndefined();
    // revoking from a subaccount and to a spender subaccount
    await setApproval({ agent: agentAs(alice), ledgerId: ledgerText, fromSubaccount: sub7, spender: { owner: dave.toText() }, amount: 0n, expectedAllowance: 2n * E8S });
    expect((await discover({ subaccount: sub7 })).approvals).toHaveLength(0);
    await setApproval({ agent: agentAs(alice), ledgerId: ledgerText, spender: { owner: bob.toText(), subaccount: sub7 }, amount: 0n, expectedAllowance: 3n * E8S });
    expect(find(await discover(), bob, sub7)).toBeUndefined();
    expect(find(await discover(), bob)).toBeDefined();
  });
});
