// app_sneeddao_backend donations: an admin sets the donation account; a donor sends a transfer
// from their own wallet and registers it; the backend reads the block from the ledger and lists
// it on the thank-you wall only when it is a plain transfer from the caller to the donation
// account. ICP is read with query_blocks (account identifiers; a mock with the real ledger's
// types, at the real ICP ledger id), other tokens with ICRC-3 (the real ICRC ledger wasm),
// including blocks that only an archive still serves.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { bigEndianCrc32 } from '@dfinity/utils';
import { createPic, install, actorAs, account, admin, alice, bob, carol, user, ICP_LEDGER_ID, T, unwrap, errOf, BUILD, wasm, refusedAtIngress } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { upgradeHub } from '../lib/hub.js';
import { idlFactory as hubIdl } from '../build/app_sneeddao_backend.did.js';

const anon = Principal.anonymous();
const dave = user('dave');
const E8S = 100_000_000n;
const ledgerGz = resolve(BUILD, 'ledger.wasm.gz');

// the ICP ledger's account identifier, computed here independently of the canisters
const accountIdentifier = (owner, sub = null) => {
  const h = createHash('sha224').update(Buffer.from([0x0a, ...Buffer.from('account-id'), ...owner.toUint8Array(), ...(sub || new Uint8Array(32))])).digest();
  return new Uint8Array([...bigEndianCrc32(h), ...h]);
};

const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const icpMockIdl = ({ IDL: I }) => I.Service({
  account_identifier: I.Func([Account], [I.Vec(I.Nat8)], ['query']),
  icrc1_transfer: I.Func([I.Record({ from_subaccount: I.Opt(I.Vec(I.Nat8)), to: Account, amount: I.Nat, fee: I.Opt(I.Nat), memo: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64) })], [I.Variant({ Ok: I.Nat, Err: I.Variant({ GenericError: I.Record({ error_code: I.Nat, message: I.Text }) }) })], []),
  test_transfer_from: I.Func([Account, Account, Account, I.Nat], [I.Nat], []),
  test_mint: I.Func([Account, I.Nat], [I.Nat], []),
  test_approve: I.Func([Account, Account], [I.Nat], []),
  set_archived_upto: I.Func([I.Nat], [], []),
});
// the real ICRC ledger: init, transfers, approvals
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
const TransferErr = IDL.Variant({ GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }), InsufficientFunds: IDL.Record({ balance: IDL.Nat }), BadFee: IDL.Record({ expected_fee: IDL.Nat }), TemporarilyUnavailable: IDL.Null, Duplicate: IDL.Record({ duplicate_of: IDL.Nat }), TooOld: IDL.Null, CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }), BadBurn: IDL.Record({ min_burn_amount: IDL.Nat }) });
const icrcIdl = ({ IDL: I }) => I.Service({
  icrc1_transfer: I.Func([I.Record({ from_subaccount: I.Opt(I.Vec(I.Nat8)), to: Account, amount: I.Nat, fee: I.Opt(I.Nat), memo: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64) })], [I.Variant({ Ok: I.Nat, Err: TransferErr })], []),
  icrc2_approve: I.Func([I.Record({ from_subaccount: I.Opt(I.Vec(I.Nat8)), spender: Account, amount: I.Nat, expected_allowance: I.Opt(I.Nat), expires_at: I.Opt(I.Nat64), fee: I.Opt(I.Nat), memo: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64) })], [I.Variant({ Ok: I.Nat, Err: I.Reserved })], []),
  icrc2_transfer_from: I.Func([I.Record({ spender_subaccount: I.Opt(I.Vec(I.Nat8)), from: Account, to: Account, amount: I.Nat, fee: I.Opt(I.Nat), memo: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64) })], [I.Variant({ Ok: I.Nat, Err: I.Reserved })], []),
  icrc3_get_archives: I.Func([I.Record({ from: I.Opt(I.Principal) })], [I.Vec(I.Record({ canister_id: I.Principal, start: I.Nat, end: I.Nat }))], ['query']),
});

const haveLedger = existsSync(ledgerGz);
let pic, appSubnet, hubId, icpId, tokId, aaaId;
let hub, hubAlice, hubBob, hubAnon, icpAlice, icpBob, icpAdmin, tokAlice, tokBob;
const me = account(admin); // the donation account in these tests
const meSub = new Uint8Array(32).fill(7);
const advance = async (seconds, ticks = 5) => { await pic.advanceTime(seconds * 1000); await pic.tick(ticks); };
const send = async (ledger, to, amount, from_subaccount = []) => unwrap(await ledger.icrc1_transfer({ from_subaccount, to, amount, fee: [], memo: [], created_at_time: [] }));
const reg = (h, ledger, block_index, message = [], from_subaccount = []) => h.register_donation({ ledger, block_index, from_subaccount, message });

describe.skipIf(!haveLedger)('app_sneeddao_backend donations', () => {
  beforeAll(async () => {
    ({ pic, appSubnet } = await createPic());
    icpId = await install(pic, { name: 'MockIcpLedger', targetCanisterId: ICP_LEDGER_ID });
    hubId = await install(pic, { name: 'app_sneeddao_backend', cycles: 20n * T, targetSubnetId: appSubnet });
    // the real ICRC ledger, archiving early so old blocks move to an archive
    tokId = await pic.createCanister({ sender: admin, cycles: 100n * T, targetSubnetId: appSubnet, controllers: [admin] });
    await pic.installCode({ sender: admin, canisterId: tokId, wasm: readFileSync(ledgerGz), arg: IDL.encode([LedgerArg], [{ Init: {
      minting_account: account(carol), transfer_fee: 1_000n, decimals: [8], token_symbol: 'TOK', token_name: 'Token', metadata: [],
      initial_balances: [[account(alice), 1_000n * E8S], [account(bob), 1_000n * E8S]], feature_flags: [{ icrc2: true }],
      archive_options: { num_blocks_to_archive: 4n, trigger_threshold: 8n, controller_id: admin, cycles_for_archive_creation: [10n * T] },
    } }]) });
    aaaId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 1_000n, symbol: 'AAA', decimals: 6 }], targetSubnetId: appSubnet });
    hub = actorAs(pic, hubIdl, hubId, admin); hubAlice = actorAs(pic, hubIdl, hubId, alice); hubBob = actorAs(pic, hubIdl, hubId, bob); hubAnon = actorAs(pic, hubIdl, hubId, anon);
    icpAlice = actorAs(pic, icpMockIdl, icpId, alice); icpBob = actorAs(pic, icpMockIdl, icpId, bob); icpAdmin = actorAs(pic, icpMockIdl, icpId, admin);
    tokAlice = actorAs(pic, icrcIdl, tokId, alice); tokBob = actorAs(pic, icrcIdl, tokId, bob);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('the mock ICP ledger computes account identifiers like the real one', async () => {
    for (const [p, sub] of [[alice, null], [bob, meSub], [hubId, null]]) {
      expect(new Uint8Array(await icpAdmin.account_identifier(account(p, sub)))).toEqual(accountIdentifier(p, sub));
    }
  });

  it('the donation account: admins set and clear it, anyone reads it, others are refused', async () => {
    expect(await hubAnon.get_donation_account()).toEqual([]);
    expect(errOf(await hubAlice.admin_set_donation_account([me]))).toMatch(/Only admins/);
    expect(errOf(await hub.admin_set_donation_account([account(anon)]))).toMatch(/anonymous/);
    expect(errOf(await hub.admin_set_donation_account([account(admin, new Uint8Array(5))]))).toMatch(/32 bytes/);
    // no account: nothing can be registered
    expect(errOf(await reg(hubAlice, icpId, 0n))).toMatch(/No donation account/);
    unwrap(await hub.admin_set_donation_account([me]));
    expect((await hubAnon.get_donation_account())[0].owner.toText()).toBe(admin.toText());
  });

  it('ICP: a transfer from the caller to the donation account is listed, with its message', async () => {
    const i = await send(icpAlice, me, 2n * E8S);
    const d = unwrap(await reg(hubAlice, icpId, i, ['  Thanks for everything!  ']));
    expect(d.donor.toText()).toBe(alice.toText());
    expect(d.amount).toBe(2n * E8S);
    expect(d.ledger.toText()).toBe(ICP_LEDGER_ID.toText());
    expect(d.message).toEqual(['Thanks for everything!']);
    expect(d.created_at > 0n).toBe(true);
    // once only
    expect(errOf(await reg(hubAlice, icpId, i))).toMatch(/already on the wall/);
  });

  it('ICP: refused when the caller did not send it, it went elsewhere, or it is not a plain transfer', async () => {
    const fromBob = await send(icpBob, me, E8S);
    expect(errOf(await reg(hubAlice, icpId, fromBob))).toMatch(/not sent from your account/);
    const elsewhere = await send(icpAlice, account(carol), E8S);
    expect(errOf(await reg(hubAlice, icpId, elsewhere))).toMatch(/not sent to the donation account/);
    // the donation account's other subaccounts are not it
    const otherSub = await send(icpAlice, account(admin, meSub), E8S);
    expect(errOf(await reg(hubAlice, icpId, otherSub))).toMatch(/not sent to the donation account/);
    const spent = await icpAdmin.test_transfer_from(account(alice), me, account(bob), E8S);
    expect(errOf(await reg(hubAlice, icpId, spent))).toMatch(/approval/);
    const minted = await icpAdmin.test_mint(me, E8S);
    expect(errOf(await reg(hubAlice, icpId, minted))).toMatch(/not a transfer/);
    const approved = await icpAdmin.test_approve(account(alice), me);
    expect(errOf(await reg(hubAlice, icpId, approved))).toMatch(/not a transfer/);
    expect(errOf(await reg(hubAlice, icpId, 9_999n))).toMatch(/no block/);
    // bob may register his own
    expect(unwrap(await reg(hubBob, icpId, fromBob)).donor.toText()).toBe(bob.toText());
  });

  it('ICP: a donation from a subaccount counts when the caller names it', async () => {
    const sub = new Uint8Array(32).fill(3);
    const i = await send(icpAlice, me, E8S, [sub]);
    expect(errOf(await reg(hubAlice, icpId, i))).toMatch(/not sent from your account/);
    expect(unwrap(await reg(hubAlice, icpId, i, [], [sub])).amount).toBe(E8S);
  });

  it('ICP: a block the ledger has archived is read through the archive callback', async () => {
    const i = await send(icpAlice, me, 3n * E8S);
    await icpAdmin.set_archived_upto(i + 1n);
    expect(unwrap(await reg(hubAlice, icpId, i)).amount).toBe(3n * E8S);
    await icpAdmin.set_archived_upto(0n);
  });

  it('other tokens: only ICP, SNEED and whitelisted tokens; ICRC-3 blocks are checked the same way', async () => {
    const i = await send(tokAlice, me, 5n * E8S);
    expect(errOf(await reg(hubAlice, tokId, i))).toMatch(/can't be checked/);
    await hub.add_whitelisted_token({ ledger_id: tokId, decimals: 8, fee: 1_000n, name: 'Token', symbol: 'TOK', standard: 'ICRC1' });
    expect(errOf(await reg(hubBob, tokId, i))).toMatch(/not sent from your account/);
    const d = unwrap(await reg(hubAlice, tokId, i, ['gm']));
    expect(d.amount).toBe(5n * E8S);
    expect(d.message).toEqual(['gm']);
    const elsewhere = await send(tokAlice, account(carol), E8S);
    expect(errOf(await reg(hubAlice, tokId, elsewhere))).toMatch(/not a plain transfer|not sent to the donation account/);
    // a transfer_from (spender set) is not a donation by the caller
    unwrap(await tokAlice.icrc2_approve({ from_subaccount: [], spender: account(bob), amount: 10n * E8S, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
    const tf = unwrap(await tokBob.icrc2_transfer_from({ spender_subaccount: [], from: account(alice), to: me, amount: E8S, fee: [], memo: [], created_at_time: [] }));
    expect(errOf(await reg(hubAlice, tokId, tf))).toMatch(/not a plain transfer/);
    // a whitelisted ledger without ICRC-3 can't be read
    await hub.add_whitelisted_token({ ledger_id: aaaId, decimals: 6, fee: 1_000n, name: 'AAA', symbol: 'AAA', standard: 'ICRC1' });
    expect(errOf(await reg(hubAlice, aaaId, 0n))).toMatch(/Could not read the ledger/);
  });

  it('other tokens: a block in an archive is found through the archive callback', async () => {
    let first = null;
    for (let k = 0; k < 10; k++) { const i = await send(tokBob, me, 1_000_000n + BigInt(k)); if (first === null) first = i; }
    for (let k = 0; k < 10; k++) await advance(2);
    const archives = await tokBob.icrc3_get_archives({ from: [] });
    expect(archives.length).toBeGreaterThan(0);
    expect(archives[0].end >= first).toBe(true); // the first of these blocks now lives in the archive
    expect(unwrap(await reg(hubBob, tokId, first)).amount).toBe(1_000_000n);
  });

  it('the anonymous principal cannot register', async () => {
    expect(errOf(await reg(hubAnon, icpId, 0n))).toMatch(/Log in/);
  });

  it('the wall: newest first, paged; totals per token; admins hide entries, which stay counted', async () => {
    const { total, donations } = await hubAnon.get_donations(0n, 3n);
    expect(total).toBe(6n);
    expect(donations.length).toBe(3);
    expect(donations[0].id > donations[1].id && donations[1].id > donations[2].id).toBe(true);
    const all = (await hubAnon.get_donations(0n, 100n)).donations;
    const totals = Object.fromEntries((await hubAnon.get_donation_totals()).map(([l, a, c]) => [l.toText(), [a, c]]));
    expect(totals[ICP_LEDGER_ID.toText()]).toEqual([2n * E8S + E8S + E8S + 3n * E8S, 4n]);
    expect(totals[tokId.toText()]).toEqual([5n * E8S + 1_000_000n, 2n]);
    const gm = all.find((d) => d.message[0] === 'gm');
    expect(errOf(await hubAlice.admin_set_donation_hidden(gm.id, true))).toMatch(/Only admins/);
    unwrap(await hub.admin_set_donation_hidden(gm.id, true));
    expect((await hubAnon.get_donations(0n, 100n)).donations.map((d) => d.id)).not.toContain(gm.id);
    expect((await hubAnon.get_donations(0n, 100n)).total).toBe(5n);
    expect(Object.fromEntries((await hubAnon.get_donation_totals()).map(([l, a, c]) => [l.toText(), c]))[tokId.toText()]).toBe(2n);
    expect(errOf(await hubAlice.admin_get_donations(0n, 10n))).toMatch(/Only admins/);
    expect(unwrap(await hub.admin_get_donations(0n, 100n)).donations.find((d) => d.id === gm.id).hidden).toBe(true);
    unwrap(await hub.admin_set_donation_hidden(gm.id, false));
    expect(errOf(await hub.admin_set_donation_hidden(999n, true))).toMatch(/No donation/);
  });

  it('a donation registered while the account is changed is checked against the account set at the time', async () => {
    unwrap(await hub.admin_set_donation_account([account(dave)]));
    const toOld = await send(icpAlice, me, E8S);
    expect(errOf(await reg(hubAlice, icpId, toOld))).toMatch(/not sent to the donation account/);
    const toNew = await send(icpAlice, account(dave), E8S);
    expect(unwrap(await reg(hubAlice, icpId, toNew)).to.owner.toText()).toBe(dave.toText());
    unwrap(await hub.admin_set_donation_account([me]));
  });

  it('the ingress guard: messages over 200 characters and queries as updates are refused', async () => {
    await refusedAtIngress(reg(hubAlice, icpId, 0n, ['x'.repeat(201)]));
    expect(errOf(await reg(hubAlice, icpId, 0n, ['x'.repeat(200)]))).not.toMatch(/inspect/);
  });

  it('an upgrade keeps the account, the donations and the hidden flags', async () => {
    unwrap(await hub.admin_set_donation_hidden(0n, true));
    const before = unwrap(await hub.admin_get_donations(0n, 100n));
    await upgradeHub(pic, hubId, admin, wasm('app_sneeddao_backend'));
    expect((await hubAnon.get_donation_account())[0].owner.toText()).toBe(admin.toText());
    expect(unwrap(await hub.admin_get_donations(0n, 100n))).toEqual(before);
    const i = await send(icpBob, me, E8S);
    expect(unwrap(await reg(hubBob, icpId, i)).id).toBe(before.total);
  });
});
