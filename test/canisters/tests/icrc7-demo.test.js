// The ICRC-7 demo collection: the standard's queries and transfer semantics,
// as a wallet would use them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPic, install, actorAs, admin, alice, bob, carol, account, unwrap } from '../lib/pic.js';
import { icrc7Idl, icrc7Init } from '../lib/idl.js';

let pic, id, asAdmin, asAlice, asBob, asCarol;

describe('icrc7_demo', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    id = await install(pic, { name: 'Icrc7Demo', initTypes: icrc7Init, initArgs: [{ name: 'Sneed Test Cats', symbol: 'CATS', description: ['Test collection'], logo: ['data:image/png;base64,iVBORw0KGgo='] }] });
    asAdmin = actorAs(pic, icrc7Idl, id, admin); asAlice = actorAs(pic, icrc7Idl, id, alice); asBob = actorAs(pic, icrc7Idl, id, bob); asCarol = actorAs(pic, icrc7Idl, id, carol);
  }, 60_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('describes itself the ICRC-7 way', async () => {
    expect(await asAdmin.icrc7_name()).toBe('Sneed Test Cats');
    expect(await asAdmin.icrc7_symbol()).toBe('CATS');
    expect((await asAdmin.icrc10_supported_standards()).map((s) => s.name)).toContain('ICRC-7');
    const md = Object.fromEntries(await asAdmin.icrc7_collection_metadata());
    expect(md['icrc7:name'].Text).toBe('Sneed Test Cats');
    expect(md['icrc7:total_supply'].Nat).toBe(0n);
    expect((await asAdmin.icrc7_max_take_value())[0]).toBe(200n);
  });

  it('mints to an account (admins only) with per-token metadata', async () => {
    for (let i = 1; i <= 5; i++) {
      unwrap(await asAdmin.mint(account(alice), [['name', { Text: `Cat #${i}` }], ['image', { Text: `https://example.com/cat${i}.png` }], ['icrc97:metadata', { Map: [['assets', { Array: [{ Map: [['url', { Text: `https://example.com/cat${i}-hd.png` }], ['mime', { Text: 'image/png' }]] }] }]] }]]));
    }
    expect('Err' in await asAlice.mint(account(alice), [])).toBe(true);
    expect(await asAdmin.icrc7_total_supply()).toBe(5n);
    expect(await asAdmin.icrc7_balance_of([account(alice), account(bob)])).toEqual([5n, 0n]);
    const md = await asAdmin.icrc7_token_metadata([1n, 99n]);
    expect(md[1]).toEqual([]);
    expect(Object.fromEntries(md[0][0])['name'].Text).toBe('Cat #1');
    expect((await asAdmin.icrc7_owner_of([3n]))[0][0].owner.toText()).toBe(alice.toText());
  });

  it('pages tokens_of by the last id seen', async () => {
    const first = await asAdmin.icrc7_tokens_of(account(alice), [], [2n]);
    expect(first).toEqual([1n, 2n]);
    const second = await asAdmin.icrc7_tokens_of(account(alice), [2n], [2n]);
    expect(second).toEqual([3n, 4n]);
    const third = await asAdmin.icrc7_tokens_of(account(alice), [4n], [2n]);
    expect(third).toEqual([5n]);
    expect(await asAdmin.icrc7_tokens([], [3n])).toEqual([1n, 2n, 3n]);
  });

  it('transfers only for the owner, never to the same account or to anonymous', async () => {
    const arg = (token_id, to) => ({ from_subaccount: [], to, token_id, memo: [], created_at_time: [] });
    expect((await asCarol.icrc7_transfer([arg(1n, account(bob))]))[0][0]).toEqual({ Err: { Unauthorized: null } });
    expect((await asAlice.icrc7_transfer([arg(1n, account(alice))]))[0][0]).toEqual({ Err: { InvalidRecipient: null } });
    expect((await asAlice.icrc7_transfer([arg(77n, account(bob))]))[0][0]).toEqual({ Err: { NonExistingTokenId: null } });
    const ok = await asAlice.icrc7_transfer([arg(1n, account(bob)), arg(2n, account(bob))]);
    expect(ok.map((r) => 'Ok' in r[0])).toEqual([true, true]);
    expect(await asAdmin.icrc7_balance_of([account(alice), account(bob)])).toEqual([3n, 2n]);
    expect(await asAdmin.icrc7_tokens_of(account(bob), [], [])).toEqual([1n, 2n]);
  });

  it('ICRC-37: an owner approves a spender for one token, the spender moves it, the approval is spent', async () => {
    const now = BigInt(Math.round(await pic.getTime())) * 1_000_000n;
    const info = (spender, extra = {}) => ({ spender, from_subaccount: [], expires_at: [], memo: [], created_at_time: now, ...extra });
    expect((await asAdmin.icrc10_supported_standards()).map((s) => s.name)).toContain('ICRC-37');
    // only the owner may approve; a spender cannot be the owner itself
    expect((await asBob.icrc37_approve_tokens([{ token_id: 3n, approval_info: info(account(carol)) }]))[0][0]).toEqual({ Err: { Unauthorized: null } });
    expect((await asAlice.icrc37_approve_tokens([{ token_id: 3n, approval_info: info(account(alice)) }]))[0][0]).toEqual({ Err: { InvalidSpender: null } });
    expect('Ok' in (await asAlice.icrc37_approve_tokens([{ token_id: 3n, approval_info: info(account(carol)) }]))[0][0]).toBe(true);
    expect(await asAdmin.icrc37_is_approved([{ spender: account(carol), from_subaccount: [], token_id: 3n }, { spender: account(bob), from_subaccount: [], token_id: 3n }])).toEqual([true, false]);
    const listed = await asAdmin.icrc37_get_token_approvals([3n, 4n], [], []);
    expect(listed.map((a) => [a.token_id, a.approval_info.spender.owner.toText()])).toEqual([[3n, carol.toText()]]);
    // not approved -> Unauthorized; wrong `from` -> Unauthorized
    const tf = (token_id, from, to) => ({ spender_subaccount: [], from, to, token_id, memo: [], created_at_time: [] });
    expect((await asBob.icrc37_transfer_from([tf(3n, account(alice), account(bob))]))[0][0]).toEqual({ Err: { Unauthorized: null } });
    expect((await asCarol.icrc37_transfer_from([tf(3n, account(bob), account(carol))]))[0][0]).toEqual({ Err: { Unauthorized: null } });
    expect('Ok' in (await asCarol.icrc37_transfer_from([tf(3n, account(alice), account(carol))]))[0][0]).toBe(true);
    expect((await asAdmin.icrc7_owner_of([3n]))[0][0].owner.toText()).toBe(carol.toText());
    // the transfer cleared the token's approvals
    expect(await asAdmin.icrc37_get_token_approvals([3n], [], [])).toEqual([]);
    expect(await asAdmin.icrc37_is_approved([{ spender: account(carol), from_subaccount: [], token_id: 3n }])).toEqual([false]);
  });

  it('ICRC-37: collection approvals cover every token of the account until revoked or expired', async () => {
    const now = BigInt(Math.round(await pic.getTime())) * 1_000_000n;
    const info = (spender, extra = {}) => ({ spender, from_subaccount: [], expires_at: [], memo: [], created_at_time: now, ...extra });
    expect('Ok' in (await asAlice.icrc37_approve_collection([{ approval_info: info(account(bob), { expires_at: [now + 3_600n * 1_000_000_000n] }) }]))[0][0]).toBe(true);
    expect((await asAdmin.icrc37_get_collection_approvals(account(alice), [], [])).map((a) => a.spender.owner.toText())).toEqual([bob.toText()]);
    expect(await asAdmin.icrc37_is_approved([{ spender: account(bob), from_subaccount: [], token_id: 4n }])).toEqual([true]);
    const tf = (token_id, from, to) => ({ spender_subaccount: [], from, to, token_id, memo: [], created_at_time: [] });
    expect('Ok' in (await asBob.icrc37_transfer_from([tf(4n, account(alice), account(bob))]))[0][0]).toBe(true);
    expect((await asAdmin.icrc7_owner_of([4n]))[0][0].owner.toText()).toBe(bob.toText());
    // expiry: after two hours the approval is gone
    await pic.advanceTime(2 * 3_600 * 1000); await pic.tick(2);
    expect(await asAdmin.icrc37_is_approved([{ spender: account(bob), from_subaccount: [], token_id: 5n }])).toEqual([false]);
    expect((await asBob.icrc37_transfer_from([tf(5n, account(alice), account(bob))]))[0][0]).toEqual({ Err: { Unauthorized: null } });
    // revoke: an approval that is not there says so
    expect((await asAlice.icrc37_revoke_collection_approvals([{ spender: [account(bob)], from_subaccount: [], memo: [], created_at_time: [] }]))[0][0]).toEqual({ Err: { ApprovalDoesNotExist: null } });
    expect('Ok' in (await asAlice.icrc37_approve_collection([{ approval_info: info(account(carol)) }]))[0][0]).toBe(true);
    expect('Ok' in (await asAlice.icrc37_revoke_collection_approvals([{ spender: [], from_subaccount: [], memo: [], created_at_time: [] }]))[0][0]).toBe(true);
    expect(await asAdmin.icrc37_get_collection_approvals(account(alice), [], [])).toEqual([]);
  });
});
