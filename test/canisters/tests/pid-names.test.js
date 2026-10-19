// sneed_pid_names (spec/sneed_names.md): accounts with one name for all of a person's principals,
// hotkeys and merging, links proven by a neuron's staking subaccount, canister names by
// controllers and SNS governance, verification that belongs to the exact name, case-insensitive
// uniqueness, search as you type, paging, the changes feed, moderation through the backend,
// the one-time import, NFT avatars, the ICRC-3 log, the ingress guard and an upgrade.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, T, unwrap, errOf, wasm, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { hubSnsIdl } from '../lib/hub.js';
import { icrc7Idl, icrc7Init } from '../lib/idl.js';
import { verifyLog, archiveIdl, btype, txField } from '../lib/icrc3.js';
import { idlFactory as namesIdl } from '../build/sneed_pid_names.did.js';

const dave = user('dave');
const aliceTaco = user('alice-on-taco'); // alice's principal on another dapp
const aliceNns = user('alice-on-nns'); // alice's NNS dapp principal (never signs in here)
const anon = Principal.anonymous();
const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const HOTKEY = [3, 4];
const perm = (p, types) => ({ principal: [p], permission_type: types });
const u64be = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
const stakingId = (p, memo) => Uint8Array.from(createHash('sha256').update(Buffer.concat([Buffer.from([0x0c]), Buffer.from('neuron-stake'), Buffer.from(p.toUint8Array()), u64be(memo)])).digest());

const moderatorIdl = ({ IDL }) => IDL.Service({
  set_banned: IDL.Func([IDL.Vec(IDL.Principal)], [], []),
  set_words: IDL.Func([IDL.Vec(IDL.Text)], [], []),
  set_failing: IDL.Func([IDL.Bool], [], []),
  get_calls: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Principal, IDL.Text, IDL.Bool))], ['query']),
});
const snswIdl = ({ IDL }) => IDL.Service({ set_deployed_snses: IDL.Func([IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Principal))], [], []) });
const govIdl = ({ IDL }) => IDL.Service({
  ...hubSnsIdl({ IDL })._fields.reduce((o, [k, v]) => ({ ...o, [k]: v }), {}),
  call_set_canister_name: IDL.Func([IDL.Principal, IDL.Principal, IDL.Text], [IDL.Variant({ ok: IDL.Text, err: IDL.Text })], []),
  call_verify_by_dao: IDL.Func([IDL.Principal, IDL.Principal, IDL.Text], [IDL.Variant({ ok: IDL.Null, err: IDL.Text })], []),
});

let pic, rootKey, appSubnet, namesId, moderatorId, snswId, rootId, govId, fakeRootId, aliceCanId, sharedCanId, rootCanId;
let names, as, moderator, snsw, gov, fakeRoot;
const archiveActor = (id) => actorAs(pic, archiveIdl, id, admin);
const config = async (over = {}) => ({ ...(await names.get_config()), ...over });
const nameOf = async (p) => (await names.get_name(p))[0];

describe('sneed_pid_names', () => {
  beforeAll(async () => {
    ({ pic, rootKey, appSubnet } = await createPic());
    namesId = await install(pic, { name: 'sneed_pid_names', cycles: 20n * T, targetSubnetId: appSubnet });
    moderatorId = await install(pic, { name: 'MockNamesModerator', targetSubnetId: appSubnet });
    snswId = await install(pic, { name: 'MockSnsWasm', targetSubnetId: appSubnet });
    rootId = await install(pic, { name: 'MockHubSns', targetSubnetId: appSubnet }); // an SNS root (and its governance below)
    govId = await install(pic, { name: 'MockHubSns', targetSubnetId: appSubnet });
    fakeRootId = await install(pic, { name: 'MockHubSns', targetSubnetId: appSubnet }); // not listed by SNS-W
    aliceCanId = await install(pic, { name: 'MockPremium', controllers: [alice], sender: alice, cycles: 2n * T, targetSubnetId: appSubnet });
    sharedCanId = await install(pic, { name: 'MockPremium', controllers: [alice, bob], sender: alice, cycles: 2n * T, targetSubnetId: appSubnet });
    rootCanId = await install(pic, { name: 'MockPremium', cycles: 2n * T, targetSubnetId: appSubnet });
    await pic.updateCanisterSettings({ canisterId: rootCanId, controllers: [rootId], sender: admin }); // the SNS root controls it
    names = actorAs(pic, namesIdl, namesId, admin);
    as = (p) => actorAs(pic, namesIdl, namesId, p);
    moderator = actorAs(pic, moderatorIdl, moderatorId, admin);
    snsw = actorAs(pic, snswIdl, snswId, admin);
    gov = actorAs(pic, govIdl, govId, admin);
    fakeRoot = actorAs(pic, govIdl, fakeRootId, admin);
    await snsw.set_deployed_snses([[rootId, govId]]);
    unwrap(await names.admin_set_config(await config({ sns_wasm: snswId })));
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('sets names with the rules, unique regardless of capitals', async () => {
    expect(await refusedAtIngress(as(anon).set_my_name('anon'))).toBe(true);
    expect(await nameOf(alice)).toBeUndefined();
    unwrap(await as(alice).set_my_name("Alice O'Neil-1_x"));
    const info = await nameOf(alice);
    expect(info.name).toEqual(["Alice O'Neil-1_x"]);
    expect(info.verified).toBe(false);
    expect('account' in info.kind).toBe(true);
    for (const [bad, why] of [['al@ce', /only letters/], [' x', /start or end/], ['x ', /start or end/], ['a  b', /two spaces/], ['--', /letter or digit/], ['ålice', /only letters/]]) {
      expect(errOf(await as(alice).set_my_name(bad))).toMatch(why);
    }
    expect(errOf(await as(alice).set_my_name('a'.repeat(33)))).toMatch(/at most 32/);
    unwrap(await as(alice).set_my_name('Alice'));
    expect(errOf(await as(bob).set_my_name('alice'))).toMatch(/taken/);
    expect(errOf(await as(bob).set_my_name('ALICE'))).toMatch(/taken/);
    unwrap(await as(alice).set_my_name('ALICE')); // the owner may change capitals
    unwrap(await as(alice).set_my_name('Alice'));
    expect(unwrap(await as(alice).set_my_name('Alice'))).toBe('Unchanged');
    unwrap(await as(bob).set_my_name('Bob'));
    // clearing deletes an otherwise empty account and frees the name
    const bobAccount = (await nameOf(bob)).kind.account;
    expect(unwrap(await as(bob).set_my_name(''))).toMatch(/cleared/);
    expect(await nameOf(bob)).toBeUndefined();
    expect(await names.get_account(bobAccount)).toEqual([]);
    unwrap(await as(bob).set_my_name('Bob'));
    expect((await nameOf(bob)).kind.account).not.toBe(bobAccount); // ids are never reused
    // a canister cannot take a personal account
    expect(errOf(await actorAs(pic, namesIdl, namesId, aliceCanId).set_my_name('x'))).toBeDefined();
  });

  it('answers batched lookups, search as you type and pages', async () => {
    unwrap(await as(carol).set_my_name('Sneed Whale'));
    unwrap(await as(dave).set_my_name('Big-Whale'));
    const got = await names.get_names([alice, bob, carol, anon]);
    expect(got.map((x) => x[0]?.name[0])).toEqual(['Alice', 'Bob', 'Sneed Whale', undefined]);
    const hit = (h) => h.name;
    expect((await names.search({ prefix: 'sne', limit: 10n, kind: [] })).map(hit)).toEqual(['Sneed Whale']);
    expect((await names.search({ prefix: 'WHA', limit: 10n, kind: [] })).map(hit)).toEqual(['Big-Whale', 'Sneed Whale']);
    expect((await names.search({ prefix: 'big', limit: 10n, kind: [] })).map(hit)).toEqual(['Big-Whale']);
    expect((await names.search({ prefix: 'a', limit: 10n, kind: [] })).map(hit)).toEqual(['Alice']);
    expect((await names.search({ prefix: '', limit: 10n, kind: [] }))).toEqual([]);
    const [h] = await names.search({ prefix: 'sneed w', limit: 1n, kind: [{ account: null }] });
    expect(h.target.account.members.map((m) => m.principal.toText())).toEqual([carol.toText()]);
    expect(await names.search({ prefix: 'sneed', limit: 10n, kind: [{ canister: null }] })).toEqual([]);
    const p1 = await names.list_names({ start_after: [], limit: 2n });
    expect(p1.items.map(hit)).toEqual(['Alice', 'Big-Whale']);
    const p2 = await names.list_names({ start_after: p1.next, limit: 10n });
    expect(p2.items.map(hit)).toEqual(['Bob', 'Sneed Whale']);
    expect(p2.next).toEqual([]);
    await expect(names.get_names(Array(501).fill(alice))).rejects.toThrow(/500/);
  });

  it('lets a hotkey manage an account and merge it, with nothing to accept', async () => {
    // on TACO, alice's other principal names itself and adds her Sneed Hub principal as a hotkey
    unwrap(await as(aliceTaco).set_my_name('Alice on TACO'));
    const taco = (await nameOf(aliceTaco)).kind.account;
    unwrap(await as(aliceTaco).add_hotkey(alice));
    expect(unwrap(await as(aliceTaco).add_hotkey(alice))).toMatch(/Already/);
    // hotkeys are visible to managers only, and are not the account's principals
    expect((await as(bob).get_account(taco))[0].hotkeys).toEqual([]);
    expect((await as(alice).get_account(taco))[0].hotkeys.map(String)).toEqual([alice.toText()]);
    expect((await as(alice).get_account(taco))[0].members.map((m) => m.principal.toText())).toEqual([aliceTaco.toText()]);
    expect((await as(alice).my_hotkey_accounts()).map((a) => a.id)).toEqual([taco]);
    // from Sneed Hub, alice renames her TACO principal and sets its avatar
    unwrap(await as(alice).set_account_name(taco, 'Alice T'));
    expect((await nameOf(aliceTaco)).name).toEqual(['Alice T']);
    unwrap(await as(alice).set_account_avatar(taco, [{ url: 'https://example.com/a.png' }]));
    expect(errOf(await as(alice).set_account_avatar(taco, [{ url: 'http://example.com/a.png' }]))).toMatch(/https/);
    expect(errOf(await as(bob).set_account_name(taco, 'Hijack'))).toMatch(/do not manage/);
    // hotkeys cannot hand out hotkeys or remove owners
    expect(errOf(await as(alice).remove_member(aliceTaco))).toMatch(/owners can remove owners/);
    expect(errOf(await as(alice).set_member(aliceTaco, { member: null }, []))).toMatch(/owners can change roles/);
    // merge: TACO's principal joins alice's account and shows her name; TACO's name is freed
    unwrap(await as(alice).merge_account(taco));
    expect(await names.get_account(taco)).toEqual([]);
    const mine = (await nameOf(alice)).kind.account;
    expect((await nameOf(aliceTaco)).name).toEqual(['Alice']);
    expect((await nameOf(aliceTaco)).kind.account).toBe(mine);
    expect((await names.get_account(mine))[0].members.map((m) => [m.principal.toText(), Object.keys(m.role)[0], Object.keys(m.via)[0]])).toEqual([
      [alice.toText(), 'owner', 'self'], [aliceTaco.toText(), 'member', 'hotkey'],
    ]);
    expect(await as(alice).my_hotkey_accounts()).toEqual([]);
    unwrap(await as(bob).set_my_name('Alice T')); // freed
    unwrap(await as(bob).set_my_name('Bob'));
    // the member labels itself (dapp ids come from sneed_profiles)
    unwrap(await as(aliceTaco).set_member(aliceTaco, { member: null }, [7n]));
    expect((await nameOf(aliceTaco)).dapp).toEqual([7n]);
    expect(errOf(await as(aliceTaco).set_member(aliceTaco, { owner: null }, []))).toMatch(/owners can change roles/);
    expect(errOf(await as(aliceTaco).set_my_name('Mine'))).toMatch(/owners can rename/);
  });

  it('merging into an unnamed account carries the name and its checkmark', async () => {
    const p1 = user('merge-1'); const p2 = user('merge-2');
    unwrap(await as(p1).set_my_name('Gamma Ray'));
    unwrap(await names.verify(p1, 'Gamma Ray'));
    unwrap(await as(p1).add_hotkey(p2));
    const from = (await nameOf(p1)).kind.account;
    unwrap(await as(p2).merge_account(from)); // p2 has no account yet: one is made
    const info = await nameOf(p1);
    expect(info.name).toEqual(['Gamma Ray']);
    expect(info.verified).toBe(true);
    expect((await nameOf(p2)).name).toEqual(['Gamma Ray']);
    expect((await names.get_account(info.kind.account))[0].members.map((m) => Object.keys(m.role)[0])).toEqual(['owner', 'member']);
  });

  it('keeps an owner, deletes an emptied account and lets members leave', async () => {
    const o1 = user('own-1'); const o2 = user('own-2');
    unwrap(await as(o1).set_my_name('Owners Club'));
    unwrap(await as(o2).add_hotkey(o1)); // o2 has no account: add_hotkey makes one
    const acc2 = (await as(o1).my_hotkey_accounts())[0].id;
    unwrap(await as(o1).merge_account(acc2));
    const acc = (await nameOf(o1)).kind.account;
    expect(errOf(await as(o1).remove_member(o1))).toMatch(/another principal an owner/);
    expect(errOf(await as(o1).set_member(o1, { member: null }, []))).toMatch(/needs an owner/);
    unwrap(await as(o1).set_member(o2, { owner: null }, []));
    unwrap(await as(o1).remove_member(o1)); // now o1 may leave
    expect(await nameOf(o1)).toBeUndefined();
    expect((await nameOf(o2)).name).toEqual(['Owners Club']);
    unwrap(await as(o2).remove_member(o2)); // last principal: the account goes, the name is free
    expect(await names.get_account(acc)).toEqual([]);
    unwrap(await as(o1).set_my_name('Owners Club'));
  });

  it('links a principal by the staking subaccount of a neuron it made', async () => {
    const memo = 7n;
    const nid = stakingId(aliceNns, memo);
    const other = stakingId(dave, 1n); // a neuron dave staked and then gave aliceNns ManagePrincipals on
    await gov.set_neurons([
      { id: nid, permissions: [perm(aliceNns, ALL), perm(alice, HOTKEY)] },
      { id: other, permissions: [perm(dave, ALL), perm(aliceNns, ALL)] },
    ]);
    await fakeRoot.set_neurons([{ id: nid, permissions: [perm(aliceNns, ALL), perm(alice, HOTKEY)] }]);
    await pic.advanceTime(61_000); await pic.tick(2);
    expect(errOf(await as(alice).link_by_neuron(rootId, nid, 8n, aliceNns, []))).toMatch(/not staked by that principal/);
    expect(errOf(await as(alice).link_by_neuron(fakeRootId, nid, memo, aliceNns, []))).toMatch(/Not a deployed SNS/);
    // the old hole: dave owns a neuron, grants aliceNns ManagePrincipals, but the id is not aliceNns's
    expect(errOf(await as(dave).link_by_neuron(rootId, other, 1n, aliceNns, []))).toMatch(/not staked by that principal/);
    expect(errOf(await as(bob).link_by_neuron(rootId, nid, memo, aliceNns, []))).toMatch(/no permission/);
    unwrap(await as(alice).link_by_neuron(rootId, nid, memo, aliceNns, [3n]));
    const info = await nameOf(aliceNns);
    expect(info.name).toEqual(['Alice']);
    expect(info.dapp).toEqual([3n]);
    expect(errOf(await as(bob).link_by_neuron(rootId, nid, memo, aliceNns, []))).toMatch(/already in an account/);
    // the principal manages the neuron no more: no new link
    await gov.set_neurons([{ id: nid, permissions: [perm(alice, ALL)] }]);
    unwrap(await as(alice).remove_member(aliceNns));
    expect(errOf(await as(alice).link_by_neuron(rootId, nid, memo, aliceNns, []))).toMatch(/no longer manages/);
  });

  it('names canisters by their controllers and by SNS governance', async () => {
    expect(errOf(await as(bob).set_canister_name(aliceCanId, 'Bobs Bot'))).toMatch(/not a controller/);
    expect(errOf(await as(alice).set_canister_name(alice, 'Me'))).toMatch(/Not a canister/);
    expect(errOf(await as(alice).set_canister_name(aliceCanId, 'x'))).toMatch(/at least 2/);
    expect(errOf(await as(alice).set_canister_name(aliceCanId, 'alice'))).toMatch(/taken/); // one name space with accounts
    unwrap(await as(alice).set_canister_name(aliceCanId, 'Alice Bot'));
    expect(errOf(await as(alice).set_my_name('alice bot'))).toMatch(/taken/);
    let info = await nameOf(aliceCanId);
    expect(info.name).toEqual(['Alice Bot']);
    expect('canister' in info.kind).toBe(true);
    expect((await names.search({ prefix: 'bot', limit: 5n, kind: [{ canister: null }] })).map((h) => h.target.canister.toText())).toEqual([aliceCanId.toText()]);
    // run by
    const aliceAcc = (await nameOf(alice)).kind.account;
    const bobAcc = (await nameOf(bob)).kind.account;
    expect(errOf(await as(alice).set_canister_run_by(aliceCanId, [bobAcc]))).toMatch(/accounts you own/);
    unwrap(await as(alice).set_canister_run_by(aliceCanId, [aliceAcc]));
    info = await nameOf(aliceCanId);
    expect(info.run_by).toEqual([{ account: aliceAcc, name: ['Alice'] }]);
    // a different controller renaming it ends the run-by claim
    unwrap(await as(alice).set_canister_name(sharedCanId, 'Shared'));
    unwrap(await as(alice).set_canister_run_by(sharedCanId, [aliceAcc]));
    unwrap(await as(bob).set_canister_name(sharedCanId, 'Shared Two'));
    expect((await nameOf(sharedCanId)).run_by).toEqual([]);
    // avatar
    unwrap(await as(alice).set_canister_avatar(aliceCanId, [{ blob: new Uint8Array(32).fill(9) }]));
    expect(errOf(await as(alice).set_canister_avatar(aliceCanId, [{ blob: new Uint8Array(31) }]))).toMatch(/32-byte/);
    // the governance of the SNS whose root controls a canister may name it; a fake SNS may not
    expect(errOf(await fakeRoot.call_set_canister_name(namesId, rootCanId, 'Fake'))).toMatch(/not a controller/);
    unwrap(await gov.call_set_canister_name(namesId, rootCanId, 'SNS Treasury Bot'));
    expect((await nameOf(rootCanId)).name).toEqual(['SNS Treasury Bot']);
    // clearing
    unwrap(await as(bob).set_canister_name(sharedCanId, ''));
    expect(await nameOf(sharedCanId)).toBeUndefined();
  });

  it('verifies the exact name; a rename takes the checkmark away', async () => {
    expect(await refusedAtIngress(as(bob).verify(alice, 'Alice'))).toBe(true);
    expect(errOf(await names.verify(alice, 'alice'))).toMatch(/not alice/);
    unwrap(await names.verify(alice, 'Alice'));
    expect((await nameOf(alice)).verified).toBe(true);
    expect((await nameOf(aliceTaco)).verified).toBe(true); // the account's name, for all its principals
    unwrap(await as(alice).set_my_name('ALICE')); // even a change of capitals
    expect((await nameOf(alice)).verified).toBe(false);
    expect((await names.get_account_of(alice))[0].verification).toEqual([]);
    // canisters too
    unwrap(await names.verify(aliceCanId, 'Alice Bot'));
    unwrap(await as(alice).set_canister_name(aliceCanId, 'Alice Bot 2'));
    expect((await nameOf(aliceCanId)).verified).toBe(false);
    // Sneed DAO proposals: the validator, then the call from governance; only governance may call
    unwrap(await names.admin_set_config(await config({ dao_governance: govId })));
    expect(await names.validate_verify_by_dao(alice, 'Alice')).toEqual({ Err: 'The name is not Alice' });
    expect(await names.validate_verify_by_dao(alice, 'ALICE')).toHaveProperty('Ok');
    expect(await refusedAtIngress(names.verify_by_dao(alice, 'ALICE'))).toBe(true); // governance calls it, never ingress
    expect(errOf(await fakeRoot.call_verify_by_dao(namesId, alice, 'ALICE'))).toMatch(/Only Sneed DAO governance/);
    expect(errOf(await gov.call_verify_by_dao(namesId, alice, 'Alice'))).toMatch(/not Alice/);
    unwrap(await gov.call_verify_by_dao(namesId, alice, 'ALICE'));
    const v = (await names.get_account_of(alice))[0].verification[0];
    expect(v.source).toEqual({ dao: null });
    expect(v.name).toBe('ALICE');
    unwrap(await names.unverify(alice));
    expect(errOf(await names.unverify(alice))).toMatch(/Not verified/);
  });

  it('moderates names through the backend', async () => {
    const mod = user('moderated');
    unwrap(await names.admin_set_config(await config({ moderator: [moderatorId] })));
    await moderator.set_words(['badword']);
    expect(errOf(await as(mod).set_my_name('My Badword'))).toMatch(/inappropriate/);
    expect(errOf(await as(mod).set_my_name('Fine'))).toMatch(/banned/); // the blacklist banned them
    const calls = await moderator.get_calls();
    expect(calls.map(([c, u, t, pub]) => [c.toText(), u.toText(), t, pub])).toContainEqual([namesId.toText(), mod.toText(), 'My Badword', true]);
    expect(await nameOf(mod)).toBeUndefined();
    await moderator.set_failing(true);
    expect(errOf(await as(carol).set_my_name('Carol'))).toMatch(/unavailable/);
    unwrap(await as(carol).set_my_name('')); // clearing needs no check
    await moderator.set_failing(false);
    unwrap(await as(carol).set_my_name('Sneed Whale'));
    unwrap(await names.admin_set_config(await config({ moderator: [] })));
  });

  it('feeds changes in order, each entity once, with deletions', async () => {
    const start = (await names.stats()).last_seq;
    const z = user('feed');
    unwrap(await as(z).set_my_name('Feed One'));
    unwrap(await as(z).set_my_name('Feed Two'));
    let feed = await names.changes_since({ after: start, limit: 100n });
    expect(feed.items.length).toBe(1);
    expect(feed.items[0].state[0].account.name).toEqual(['Feed Two']);
    const acc = feed.items[0].ref.account;
    unwrap(await as(z).set_my_name(''));
    feed = await names.changes_since({ after: start, limit: 100n });
    expect(feed.items.map((c) => [c.ref.account, c.state.length])).toEqual([[acc, 0]]); // deleted
    // a full export, a page at a time
    let after = 0n; let n = 0;
    for (;;) {
      const page = await names.changes_since({ after, limit: 3n });
      if (page.items.length === 0) break;
      n += page.items.length; after = page.items.at(-1).seq;
    }
    const s = await names.stats();
    expect(n).toBeGreaterThanOrEqual(Number(s.accounts + s.canisters));
  });

  it('imports names once, then closes the import', async () => {
    const i1 = user('imp-1'); const i2 = user('imp-2');
    expect(await refusedAtIngress(as(bob).admin_import_names([]))).toBe(true);
    const res = await names.admin_import_names([
      { principal: i1, name: 'Imported', verified: true, avatar: [] },
      { principal: i2, name: 'imported', verified: false, avatar: [] }, // collides by capitals
      { principal: sharedCanId, name: 'Imported Canister', verified: false, avatar: [{ url: 'https://x.y/z.png' }] },
      { principal: i1, name: 'Again', verified: false, avatar: [] },
      { principal: user('imp-3'), name: '', verified: false, avatar: [{ url: 'https://x.y/only.png' }] }, // an avatar, no name
      { principal: user('imp-4'), name: '', verified: false, avatar: [] },
    ]);
    expect(res.map((r) => Object.values(r.result)[0])).toEqual(['imported', 'name taken', 'imported', 'already imported', 'imported', 'Name must be at least 1 character']);
    expect(await nameOf(user('imp-3'))).toMatchObject({ name: [], avatar: [{ url: 'https://x.y/only.png' }] });
    expect((await nameOf(i1)).verified).toBe(true);
    expect((await names.get_account_of(i1))[0].verification[0].source).toEqual({ import: null });
    expect((await names.get_account_of(i1))[0].members[0].via).toEqual({ import: null });
    expect((await nameOf(sharedCanId)).avatar).toEqual([{ url: 'https://x.y/z.png' }]);
    unwrap(await names.admin_finish_import());
    await expect(names.admin_import_names([])).rejects.toThrow(/closed/);
    expect((await names.stats()).import_closed).toBe(true);
  });

  it('shows an ICRC-7 NFT a member owns as the avatar, and stops when it changes hands', async () => {
    const erin = user('nft-erin'), frank = user('nft-frank');
    const acct = (p) => ({ owner: p, subaccount: [] });
    const nftId = await install(pic, { name: 'Icrc7Demo', initTypes: icrc7Init, initArgs: [{ name: 'Avatar Cats', symbol: 'ACAT', description: [], logo: [] }], targetSubnetId: appSubnet });
    const nft = actorAs(pic, icrc7Idl, nftId, admin);
    const [one, two] = [unwrap(await nft.mint(acct(erin), [['name', { Text: 'Cat 1' }]])), unwrap(await nft.mint(acct(frank), [['name', { Text: 'Cat 2' }]]))];
    expect(await refusedAtIngress(as(anon).set_my_nft_avatar([{ collection: nftId, token_id: one }]))).toBe(true);

    // only an NFT a member of the account owns
    expect(errOf(await as(erin).set_my_nft_avatar([{ collection: nftId, token_id: two }]))).toMatch(/do not own/);
    expect(errOf(await as(erin).set_my_nft_avatar([{ collection: nftId, token_id: 999n }]))).toMatch(/does not exist/);
    expect(errOf(await as(erin).set_my_nft_avatar([{ collection: moderatorId, token_id: one }]))).toMatch(/did not answer/);
    expect(await nameOf(erin)).toBeUndefined(); // refused sets create no account
    unwrap(await as(erin).set_my_nft_avatar([{ collection: nftId, token_id: one }]));
    const shown = (await nameOf(erin)).nft_avatar[0];
    expect(shown.collection.toText()).toBe(nftId.toText());
    expect(shown.token_id).toBe(one);
    expect(shown.owner.toText()).toBe(erin.toText());
    const account = (await names.get_account_of(erin))[0];
    expect(account.nft_avatar[0].token_id).toBe(one);
    expect(unwrap(await as(frank).refresh_nft_avatar(account.id))).toBe('Still owned');

    // it changes hands: anyone may have it cleared, and the empty account goes with it
    const sent = await actorAs(pic, icrc7Idl, nftId, erin).icrc7_transfer([{ from_subaccount: [], to: acct(frank), token_id: one, memo: [], created_at_time: [] }]);
    expect('Ok' in sent[0][0]).toBe(true);
    expect(unwrap(await as(frank).refresh_nft_avatar(account.id))).toMatch(/changed hands/);
    expect(await nameOf(erin)).toBeUndefined();

    // a named account keeps its name and other avatar; null stops showing the NFT
    unwrap(await as(frank).set_my_name('Frank Of Cats'));
    unwrap(await as(frank).set_my_avatar([{ url: 'https://example.com/frank.png' }]));
    unwrap(await as(frank).set_my_nft_avatar([{ collection: nftId, token_id: one }]));
    expect((await nameOf(frank)).nft_avatar[0].token_id).toBe(one);
    expect((await names.search({ prefix: 'Frank Of', limit: 5n, kind: [] }))[0].nft_avatar[0].token_id).toBe(one);
    expect(unwrap(await as(frank).set_my_nft_avatar([]))).toBe('NFT avatar cleared');
    const after = await nameOf(frank);
    expect(after.nft_avatar).toEqual([]);
    expect(after.avatar[0].url).toBe('https://example.com/frank.png');
    expect(unwrap(await as(frank).set_my_nft_avatar([]))).toBe('Unchanged');

    // admins clearing an avatar clear the NFT too
    unwrap(await as(frank).set_my_nft_avatar([{ collection: nftId, token_id: two }]));
    unwrap(await names.admin_clear_avatar(frank));
    expect((await nameOf(frank)).nft_avatar).toEqual([]);
  });

  it('keeps an ICRC-3 log of it all that verifies', async () => {
    const { blocks } = await verifyLog(names, namesId, rootKey, archiveActor);
    const types = new Set(blocks.map(btype));
    for (const t of ['account_create', 'account_delete', 'name_set', 'avatar_set', 'member_link', 'member_unlink', 'member_update', 'hotkey_add', 'account_merge', 'verify', 'unverify', 'canister_name_set', 'canister_run_by', 'config_update', 'import', 'nft_avatar_set']) {
      expect(types.has(`sneednames_${t}`), t).toBe(true);
    }
    const merge = blocks.find((b) => btype(b) === 'sneednames_account_merge');
    expect(Buffer.from(txField(merge, 'caller').Blob).equals(Buffer.from(alice.toUint8Array()))).toBe(true);
  });

  it('guards ingress: queries as updates, anonymous and oversized calls', async () => {
    const attacker = actorAs(pic, asUpdates(namesIdl), namesId, bob);
    for (const call of [() => attacker.get_names([alice]), () => attacker.search({ prefix: 'a', limit: 5n, kind: [] }), () => attacker.changes_since({ after: 0n, limit: 5n }), () => attacker.stats()]) {
      expect(await refusedAtIngress(call())).toBe(true);
    }
    expect(await refusedAtIngress(as(anon).set_my_name('x'))).toBe(true);
    expect(await refusedAtIngress(as(bob).set_my_name('x'.repeat(5000)))).toBe(true);
    expect(await refusedAtIngress(as(bob).admin_set_name(bob, 'x'))).toBe(true);
    expect(await refusedAtIngress(as(bob).verify_by_dao(bob, 'x'))).toBe(true);
  });

  it('keeps everything over an upgrade', async () => {
    const before = await names.get_names([alice, aliceTaco, carol, aliceCanId, rootCanId]);
    const stats = await names.stats();
    const search = await names.search({ prefix: 'whale', limit: 10n, kind: [] });
    await pic.upgradeCanister({ sender: admin, canisterId: namesId, wasm: wasm('sneed_pid_names'), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    expect(await names.get_names([alice, aliceTaco, carol, aliceCanId, rootCanId])).toEqual(before);
    expect(await names.stats()).toEqual(stats);
    expect(await names.search({ prefix: 'whale', limit: 10n, kind: [] })).toEqual(search);
    unwrap(await as(user('after-upgrade')).set_my_name('After Upgrade'));
    await verifyLog(names, namesId, rootKey, archiveActor);
  });
});
