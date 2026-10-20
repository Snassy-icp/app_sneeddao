// sneed_sns_forum tips checked against the ledger: the client sends the tokens to the post's
// author, then records the tip with the transfer's block index; the forum reads that block on the
// token's ledger (ICRC-3 on the real ICRC ledger wasm, archives included; query_blocks on a mock
// with the ICP ledger's types at the real ICP ledger id) and records the tip only when it is a
// plain transfer of that amount from the caller's main account to the author's main account.
// Blocks are used once, also by calls interleaving over the ledger await. Blocks that cannot be
// read are recorded as unverified and count nowhere. Tips recorded before the upgrade keep their
// blocks and can be verified later with verify_tip. Also: get_api_doc.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, account, admin, alice, bob, carol, user, ICP_LEDGER_ID, SNEED_SNS_ROOT, T, unwrap, errOf, BUILD, wasm, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { idlFactory as forumIdl } from '../build/sneed_sns_forum.did.js';

const SNS_W = Principal.fromText('qaa6y-5yaaa-aaaaa-aaafa-cai');
const minter = user('minter');
const E8S = 100_000_000n;
const ledgerGz = resolve(BUILD, 'ledger.wasm.gz');
const haveLedger = existsSync(ledgerGz);

const directoryIdl = ({ IDL: I }) => I.Service({ set_instances: I.Func([I.Vec(I.Tuple(I.Principal, I.Principal))], [], []) });
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
const TransferArg = (I) => I.Record({ from_subaccount: I.Opt(I.Vec(I.Nat8)), to: Account, amount: I.Nat, fee: I.Opt(I.Nat), memo: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64) });
const icrcIdl = ({ IDL: I }) => I.Service({
  icrc1_transfer: I.Func([TransferArg(I)], [I.Variant({ Ok: I.Nat, Err: I.Reserved })], []),
  icrc2_approve: I.Func([I.Record({ from_subaccount: I.Opt(I.Vec(I.Nat8)), spender: Account, amount: I.Nat, expected_allowance: I.Opt(I.Nat), expires_at: I.Opt(I.Nat64), fee: I.Opt(I.Nat), memo: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64) })], [I.Variant({ Ok: I.Nat, Err: I.Reserved })], []),
  icrc2_transfer_from: I.Func([I.Record({ spender_subaccount: I.Opt(I.Vec(I.Nat8)), from: Account, to: Account, amount: I.Nat, fee: I.Opt(I.Nat), memo: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64) })], [I.Variant({ Ok: I.Nat, Err: I.Reserved })], []),
  icrc3_get_archives: I.Func([I.Record({ from: I.Opt(I.Principal) })], [I.Vec(I.Record({ canister_id: I.Principal, start: I.Nat, end: I.Nat }))], ['query']),
});
const icpMockIdl = ({ IDL: I }) => I.Service({
  icrc1_transfer: I.Func([TransferArg(I)], [I.Variant({ Ok: I.Nat, Err: I.Reserved })], []),
  test_transfer_from: I.Func([Account, Account, Account, I.Nat], [I.Nat], []),
  test_mint: I.Func([Account, I.Nat], [I.Nat], []),
  set_archived_upto: I.Func([I.Nat], [], []),
});

const err = (r) => { const e = errOf(r); const k = Object.keys(e)[0]; return `${k}: ${e[k]}`; };
const send = async (ledger, to, amount, from_subaccount = []) => unwrap(await ledger.icrc1_transfer({ from_subaccount, to, amount, fee: [], memo: [], created_at_time: [] }));

let pic, forumId, tokId, icpId, f, fas, tokAs, icp, icpAs, TH, P_BOB, P_CAROL;
const advance = async (seconds, ticks = 5) => { await pic.advanceTime(seconds * 1000); await pic.tick(ticks); };

describe.skipIf(!haveLedger)('sneed_sns_forum: tips verified on the ledger', () => {
  beforeAll(async () => {
    let appSubnet;
    ({ pic, appSubnet } = await createPic());
    await install(pic, { name: 'MockForumSnsW', targetCanisterId: SNS_W });
    const govId = await install(pic, { name: 'MockForumGovernance' });
    icpId = await install(pic, { name: 'MockIcpLedger', targetCanisterId: ICP_LEDGER_ID });
    forumId = await install(pic, { name: 'sneed_sns_forum', targetSubnetId: appSubnet });
    // the real ICRC ledger, archiving early so old blocks move to an archive
    tokId = await pic.createCanister({ sender: admin, cycles: 100n * T, targetSubnetId: appSubnet, controllers: [admin] });
    await pic.installCode({ sender: admin, canisterId: tokId, wasm: readFileSync(ledgerGz), arg: IDL.encode([LedgerArg], [{ Init: {
      minting_account: account(minter), transfer_fee: 1_000n, decimals: [8], token_symbol: 'TOK', token_name: 'Token', metadata: [],
      initial_balances: [[account(alice), 1_000n * E8S], [account(bob), 1_000n * E8S], [account(carol), 1_000n * E8S]], feature_flags: [{ icrc2: true }],
      archive_options: { num_blocks_to_archive: 4n, trigger_threshold: 8n, controller_id: admin, cycles_for_archive_creation: [10n * T] },
    } }]) });
    await actorAs(pic, directoryIdl, SNS_W, admin).set_instances([[SNEED_SNS_ROOT, govId]]);
    f = actorAs(pic, forumIdl, forumId, admin);
    fas = (p) => actorAs(pic, forumIdl, forumId, p);
    tokAs = (p) => actorAs(pic, icrcIdl, tokId, p);
    icp = actorAs(pic, icpMockIdl, icpId, admin);
    icpAs = (p) => actorAs(pic, icpMockIdl, icpId, p);
    const F = unwrap(await f.create_forum({ title: 'Sneed', description: 'd', sns_root_canister_id: [] }));
    const T1 = unwrap(await f.create_topic({ forum_id: F, parent_topic_id: [], title: 'General', description: 'g' }));
    TH = unwrap(await fas(alice).create_thread({ topic_id: T1, title: ['Tips'], body: 'tip us' }));
    P_BOB = unwrap(await fas(bob).create_post(TH, [], [], 'bob writes'));
    P_CAROL = unwrap(await fas(carol).create_post(TH, [], [], 'carol writes'));
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('a real tip is verified: counted in stats and totals, shown as verified', async () => {
    const i = await send(tokAs(alice), account(bob), 5n * E8S);
    const id = unwrap(await fas(alice).create_tip(bob, P_BOB, tokId, 5n * E8S, [i]));
    const t = (await f.get_tip(id))[0];
    expect(t.verified).toEqual([true]);
    expect(t.verification_note).toEqual([]);
    expect(t.transaction_block_index).toEqual([i]);
    expect((await f.get_tip_stats()).total_tips).toBe(1n);
    expect(await f.get_tip_tokens_received_by_user(bob)).toEqual([{ token_ledger_principal: tokId, total_amount: 5n * E8S, tip_count: 1n }]);
    expect(await f.get_recent_tips_count(bob)).toBe(1n);
  });

  it('a block index that does not exist is refused and nothing is recorded', async () => {
    const before = (await f.get_tips_by_post(P_BOB)).length;
    expect(err(await fas(alice).create_tip(bob, P_BOB, tokId, E8S, [999_999n]))).toMatch(/InvalidInput: Tip not recorded: The ledger has no block 999999/);
    expect((await f.get_tips_by_post(P_BOB)).length).toBe(before);
  });

  it('a wrong amount is refused', async () => {
    const i = await send(tokAs(alice), account(bob), 2n * E8S);
    expect(err(await fas(alice).create_tip(bob, P_BOB, tokId, 20n * E8S, [i]))).toMatch(/InvalidInput: Tip not recorded: Block \d+ moved 200000000, not 2000000000/);
  });

  it('a transfer to someone else is refused, and so is a recipient who is not the post author', async () => {
    const i = await send(tokAs(alice), account(carol), E8S);
    expect(err(await fas(alice).create_tip(bob, P_BOB, tokId, E8S, [i]))).toMatch(/not sent to the post author's main account/);
    // the author's other subaccounts are not the author's main account
    const sub = await send(tokAs(alice), account(bob, new Uint8Array(32).fill(1)), E8S);
    expect(err(await fas(alice).create_tip(bob, P_BOB, tokId, E8S, [sub]))).toMatch(/not sent to the post author's main account/);
    // carol really got the tokens, but carol did not write P_BOB
    expect(err(await fas(alice).create_tip(carol, P_BOB, tokId, E8S, [i]))).toMatch(/InvalidInput: A tip goes to the post's author/);
  });

  it("someone else's transfer is refused", async () => {
    const i = await send(tokAs(carol), account(bob), E8S);
    expect(err(await fas(alice).create_tip(bob, P_BOB, tokId, E8S, [i]))).toMatch(/not sent from the tipper's main account/);
    // from a subaccount of the tipper: not the main account either
    const sub2 = new Uint8Array(32).fill(2);
    await send(tokAs(alice), account(alice, sub2), 2n * E8S);
    const s = await send(tokAs(alice), account(bob), E8S, [sub2]);
    expect(err(await fas(alice).create_tip(bob, P_BOB, tokId, E8S, [s]))).toMatch(/not sent from the tipper's main account/);
  });

  it('a block is used by one tip only', async () => {
    const i = await send(tokAs(alice), account(bob), 3n * E8S);
    const id = unwrap(await fas(alice).create_tip(bob, P_BOB, tokId, 3n * E8S, [i]));
    expect(err(await fas(alice).create_tip(bob, P_BOB, tokId, 3n * E8S, [i]))).toBe(`AlreadyExists: Block ${i} of this ledger is already the transfer of tip ${id}`);
  });

  it('mints and transfers made with an approval are not tips', async () => {
    const m = await send(tokAs(minter), account(bob), E8S); // from the minting account: a mint
    expect(err(await fas(alice).create_tip(bob, P_BOB, tokId, E8S, [m]))).toMatch(/Block \d+ is a mint, not a plain transfer/);
    unwrap(await tokAs(alice).icrc2_approve({ from_subaccount: [], spender: account(carol), amount: 10n * E8S, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
    const tf = unwrap(await tokAs(carol).icrc2_transfer_from({ spender_subaccount: [], from: account(alice), to: account(bob), amount: E8S, fee: [], memo: [], created_at_time: [] }));
    expect(err(await fas(alice).create_tip(bob, P_BOB, tokId, E8S, [tf]))).toMatch(/is a transfer made with an approval/);
  });

  it('two calls racing for one block: one records it, the other is refused', async () => {
    const i = await send(tokAs(alice), account(bob), 4n * E8S);
    const d1 = pic.createDeferredActor({ idlFactory: forumIdl, canisterId: forumId }); d1.setPrincipal(alice);
    const d2 = pic.createDeferredActor({ idlFactory: forumIdl, canisterId: forumId }); d2.setPrincipal(alice);
    const c1 = await d1.create_tip(bob, P_BOB, tokId, 4n * E8S, [i]);
    const c2 = await d2.create_tip(bob, P_BOB, tokId, 4n * E8S, [i]);
    const rs = [await c1(), await c2()];
    expect(rs.filter((r) => 'ok' in r).length).toBe(1);
    expect(err(rs.find((r) => 'err' in r))).toMatch(/AlreadyExists: Block \d+ of this ledger is (being registered by another call|already the transfer of tip)/);
    expect((await f.get_tips_by_post(P_BOB)).filter((t) => t.transaction_block_index[0] === i).length).toBe(1);
  });

  it('a block the ledger has archived is read through the archive', async () => {
    const i = await send(tokAs(alice), account(carol), 7n * E8S);
    for (let k = 0; k < 10; k++) await send(tokAs(bob), account(alice), 1_000n + BigInt(k));
    for (let k = 0; k < 10; k++) await advance(2);
    const archives = await tokAs(alice).icrc3_get_archives({ from: [] });
    expect(archives.some((a) => a.start <= i && i <= a.end)).toBe(true);
    const id = unwrap(await fas(alice).create_tip(carol, P_CAROL, tokId, 7n * E8S, [i]));
    expect((await f.get_tip(id))[0].verified).toEqual([true]);
  });

  it('ICP: read with query_blocks and account identifiers, archives included', async () => {
    const i = await send(icpAs(alice), account(bob), E8S);
    expect((await f.get_tip(unwrap(await fas(alice).create_tip(bob, P_BOB, ICP_LEDGER_ID, E8S, [i]))))[0].verified).toEqual([true]);
    const other = await send(icpAs(alice), account(carol), E8S);
    expect(err(await fas(alice).create_tip(bob, P_BOB, ICP_LEDGER_ID, E8S, [other]))).toMatch(/not sent to the post author's main account/);
    const minted = await icp.test_mint(account(bob), E8S);
    expect(err(await fas(alice).create_tip(bob, P_BOB, ICP_LEDGER_ID, E8S, [minted]))).toMatch(/is a mint/);
    const spent = await icp.test_transfer_from(account(alice), account(bob), account(carol), E8S);
    expect(err(await fas(alice).create_tip(bob, P_BOB, ICP_LEDGER_ID, E8S, [spent]))).toMatch(/made with an approval/);
    expect(err(await fas(alice).create_tip(bob, P_BOB, ICP_LEDGER_ID, 2n * E8S, [await send(icpAs(alice), account(bob), E8S)]))).toMatch(/moved 100000000, not 200000000/);
    const old = await send(icpAs(carol), account(bob), 2n * E8S);
    await icp.set_archived_upto(old + 1n);
    expect((await f.get_tip(unwrap(await fas(carol).create_tip(bob, P_BOB, ICP_LEDGER_ID, 2n * E8S, [old]))))[0].verified).toEqual([true]);
    await icp.set_archived_upto(0n);
  });

  it('a tip that cannot be checked is recorded as unverified and counts nowhere; verify_tip retries it', async () => {
    const stats = await f.get_tip_stats();
    const recent = await f.get_recent_tips_count(carol);
    const totals = await f.get_tip_tokens_received_by_user(carol);
    // no block index
    const a = unwrap(await fas(bob).create_tip(carol, P_CAROL, tokId, 50n * E8S, []));
    // a "ledger" that is no canister at all
    const b = unwrap(await fas(bob).create_tip(carol, P_CAROL, user('not-a-ledger'), 1n, [1n]));
    for (const id of [a, b]) expect((await f.get_tip(id))[0].verified).toEqual([false]);
    expect((await f.get_tip(a))[0].verification_note).toEqual(['No block index was given']);
    expect((await f.get_tip(b))[0].verification_note[0]).toMatch(/Could not read the ledger/);
    expect(await f.get_tip_stats()).toEqual(stats);
    expect(await f.get_recent_tips_count(carol)).toBe(recent);
    expect(await f.get_tip_tokens_received_by_user(carol)).toEqual(totals);
    expect((await f.get_recent_tips_received(carol)).map((t) => t.id)).not.toContain(a);
    // listed, flagged
    expect((await f.get_tips_by_post(P_CAROL)).map((t) => t.id)).toEqual(expect.arrayContaining([a, b]));
    expect(unwrap(await fas(alice).verify_tip(a))).toBe(false);
    expect(errOf(await fas(Principal.anonymous()).verify_tip(a))).toEqual({ Unauthorized: 'Authentication required' });
    expect(err(await fas(alice).verify_tip(999_999n))).toBe('NotFound: Tip not found');
  });

  it('get_api_doc: a Markdown guide for agents that links the full reference; a query only', async () => {
    const doc = await f.get_api_doc();
    expect(doc).toMatch(/^# Sneed Forum/);
    expect(doc).toContain('https://app.sneeddao.com/api-docs/sneed_sns_forum.md');
    expect(doc).toContain('https://app.sneeddao.com/llms.txt');
    expect(doc).toMatch(/Tips move real tokens/);
    expect(doc.length).toBeLessThan(12_000);
    const upd = actorAs(pic, asUpdates(forumIdl), forumId, bob);
    expect(await refusedAtIngress(upd.get_api_doc())).toBe(true);
  });
});

describe.skipIf(!haveLedger)('sneed_sns_forum: tips recorded before the forum checked them', () => {
  let pic2, fId, tok, fa, legacyReal, legacyFake, legacyBlock, PB;
  beforeAll(async () => {
    let appSubnet;
    ({ pic: pic2, appSubnet } = await createPic());
    await install(pic2, { name: 'MockForumSnsW', targetCanisterId: SNS_W });
    const govId = await install(pic2, { name: 'MockForumGovernance' });
    fId = await install(pic2, { name: 'sneed_sns_forum_april', targetSubnetId: appSubnet });
    tok = await pic2.createCanister({ sender: admin, cycles: 100n * T, targetSubnetId: appSubnet, controllers: [admin] });
    await pic2.installCode({ sender: admin, canisterId: tok, wasm: readFileSync(ledgerGz), arg: IDL.encode([LedgerArg], [{ Init: {
      minting_account: account(minter), transfer_fee: 1_000n, decimals: [8], token_symbol: 'TOK', token_name: 'Token', metadata: [],
      initial_balances: [[account(alice), 1_000n * E8S]], feature_flags: [], archive_options: { num_blocks_to_archive: 1000n, trigger_threshold: 2000n, controller_id: admin, cycles_for_archive_creation: [] },
    } }]) });
    await actorAs(pic2, directoryIdl, SNS_W, admin).set_instances([[SNEED_SNS_ROOT, govId]]);
    fa = (p) => actorAs(pic2, forumIdl, fId, p);
    const F = unwrap(await fa(admin).create_forum({ title: 'Sneed', description: 'd', sns_root_canister_id: [] }));
    const T1 = unwrap(await fa(admin).create_topic({ forum_id: F, parent_topic_id: [], title: 'General', description: 'g' }));
    const th = unwrap(await fa(alice).create_thread({ topic_id: T1, title: [], body: 'x' }));
    PB = unwrap(await fa(bob).create_post(th, [], [], 'bob'));
    const t = actorAs(pic2, icrcIdl, tok, alice);
    legacyBlock = await send(t, account(bob), 5n * E8S);
    // the old forum records whatever it is told
    legacyReal = unwrap(await fa(alice).create_tip(bob, PB, tok, 5n * E8S, [legacyBlock]));
    legacyFake = unwrap(await fa(carol).create_tip(bob, PB, tok, 1_000n * E8S, [legacyBlock]));
    await pic2.upgradeCanister({ sender: admin, canisterId: fId, wasm: wasm('sneed_sns_forum'), arg: IDL.encode([], []), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  }, 180_000);
  afterAll(async () => { await pic2?.tearDown(); });

  it('old tips are kept but count nowhere until verified, and their blocks cannot be reused', async () => {
    const tips = await fa(admin).get_tips_by_post(PB);
    expect(tips.map((t) => [t.id, t.verified])).toEqual([[legacyReal, []], [legacyFake, []]]);
    expect((await fa(admin).get_tip_stats()).total_tips).toBe(0n);
    expect(await fa(admin).get_recent_tips_count(bob)).toBe(0n);
    expect(err(await fa(alice).create_tip(bob, PB, tok, 5n * E8S, [legacyBlock]))).toBe(`AlreadyExists: Block ${legacyBlock} of this ledger is already the transfer of tip ${legacyReal}`);
  });

  it('verify_tip confirms the real one and rejects the one that claimed its block', async () => {
    expect(unwrap(await fa(carol).verify_tip(legacyReal))).toBe(true);
    expect(unwrap(await fa(carol).verify_tip(legacyFake))).toBe(false);
    const [r, x] = [(await fa(admin).get_tip(legacyReal))[0], (await fa(admin).get_tip(legacyFake))[0]];
    expect(r.verified).toEqual([true]);
    expect(x.verified).toEqual([false]);
    expect(x.verification_note[0]).toMatch(/is the transfer of tip/);
    expect(await fa(admin).get_tip_stats()).toEqual({ total_tips: 1n, total_tip_amount_by_token: [[tok, 5n * E8S]] });
    // final either way
    expect(unwrap(await fa(carol).verify_tip(legacyFake))).toBe(false);
  });
});
