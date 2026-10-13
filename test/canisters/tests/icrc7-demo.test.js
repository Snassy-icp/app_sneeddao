// The ICRC-7 demo collection: the standard's queries and transfer semantics,
// as a wallet would use them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPic, install, actorAs, admin, alice, bob, carol, account, unwrap } from '../lib/pic.js';
import { icrc7Idl, icrc7Init } from '../lib/idl.js';

let pic, id, asAdmin, asAlice, asCarol;

describe('icrc7_demo', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    id = await install(pic, { name: 'Icrc7Demo', initTypes: icrc7Init, initArgs: [{ name: 'Sneed Test Cats', symbol: 'CATS', description: ['Test collection'], logo: ['data:image/png;base64,iVBORw0KGgo='] }] });
    asAdmin = actorAs(pic, icrc7Idl, id, admin); asAlice = actorAs(pic, icrc7Idl, id, alice); asCarol = actorAs(pic, icrc7Idl, id, carol);
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
});
