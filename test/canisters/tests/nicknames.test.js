// sneed_pid_nicknames and sneed_neuron_nicknames (spec/sneed_names.md §6): each user's private
// labels, returned only to their owner; paging, lookups and search over the owner's own range,
// the free and premium limits, the word blacklist without bans, avatars, the import, the
// ingress guard and an upgrade.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, T, unwrap, errOf, wasm, nowNs, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { premiumIdl } from '../lib/idl.js';
import { idlFactory as pidIdl } from '../build/sneed_pid_nicknames.did.js';
import { idlFactory as neuronIdl } from '../build/sneed_neuron_nicknames.did.js';

const anon = Principal.anonymous();
const dave = user('dave');
const moderatorIdl = ({ IDL }) => IDL.Service({
  set_banned: IDL.Func([IDL.Vec(IDL.Principal)], [], []),
  set_words: IDL.Func([IDL.Vec(IDL.Text)], [], []),
  get_calls: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Principal, IDL.Text, IDL.Bool))], ['query']),
});
const targets = (n, tag = 't') => Array.from({ length: n }, (_, i) => user(`${tag}-${i}`));
const nk = (root, n) => ({ sns_root: root, neuron_id: new Uint8Array(32).fill(n) });

let pic, appSubnet, pidId, neuronId, premiumId, moderatorId, pid, neuron, premium, moderator;
const P = (p) => actorAs(pic, pidIdl, pidId, p);
const N = (p) => actorAs(pic, neuronIdl, neuronId, p);

describe('nickname canisters', () => {
  beforeAll(async () => {
    ({ pic, appSubnet } = await createPic());
    pidId = await install(pic, { name: 'sneed_pid_nicknames', cycles: 20n * T, targetSubnetId: appSubnet });
    neuronId = await install(pic, { name: 'sneed_neuron_nicknames', cycles: 20n * T, targetSubnetId: appSubnet });
    premiumId = await install(pic, { name: 'MockPremium', targetSubnetId: appSubnet });
    moderatorId = await install(pic, { name: 'MockNamesModerator', targetSubnetId: appSubnet });
    pid = P(admin); neuron = N(admin);
    premium = actorAs(pic, premiumIdl, premiumId, admin);
    moderator = actorAs(pic, moderatorIdl, moderatorId, admin);
    const cfg = { max_free: 3n, max_premium: 5n, moderator: [moderatorId], premium: [premiumId] };
    unwrap(await pid.admin_set_config(cfg));
    unwrap(await neuron.admin_set_config(cfg));
    await moderator.set_words(['badword']);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('keeps each user\'s nicknames to themselves', async () => {
    expect(await refusedAtIngress(P(anon).set_nickname(bob, 'x'))).toBe(true);
    unwrap(await P(alice).set_nickname(bob, 'Bobby Tables'));
    unwrap(await P(carol).set_nickname(bob, 'Robert'));
    expect((await P(alice).get_my_nicknames_for([bob, carol])).map((x) => x[0]?.nickname)).toEqual(['Bobby Tables', undefined]);
    expect((await P(carol).get_my_nicknames_for([bob]))[0][0].nickname).toBe('Robert');
    expect(await P(bob).get_my_nicknames_for([bob])).toEqual([[]]);
    expect((await P(alice).get_my_nicknames({ start_after: [], limit: 500n })).items.map((n) => [n.target.toText(), n.nickname])).toEqual([[bob.toText(), 'Bobby Tables']]);
    expect(errOf(await P(alice).set_nickname(carol, 'b@d'))).toMatch(/only letters/);
    // replace and remove
    unwrap(await P(alice).set_nickname(bob, 'Bob T'));
    expect((await P(alice).get_my_nicknames_for([bob]))[0][0].nickname).toBe('Bob T');
    expect(unwrap(await P(alice).set_nickname(bob, ''))).toMatch(/removed/);
    expect(unwrap(await P(alice).set_nickname(bob, ''))).toBe('Unchanged');
    expect((await P(alice).my_nickname_count()).count).toBe(0n);
  });

  it('applies the free and premium limits', async () => {
    const ts = targets(6);
    for (const t of ts.slice(0, 3)) unwrap(await P(alice).set_nickname(t, `Friend ${t.toText().slice(0, 5)}`));
    expect(errOf(await P(alice).set_nickname(ts[3], 'Fourth'))).toMatch(/maximum number of nicknames \(3\)\. Get Sneed Premium/);
    unwrap(await P(alice).set_nickname(ts[0], 'Renamed')); // changing one is not adding one
    await premium.set_member(alice, (await nowNs(pic)) + 86_400_000_000_000n);
    unwrap(await P(alice).set_nickname(ts[3], 'Fourth'));
    unwrap(await P(alice).set_nickname(ts[4], 'Fifth'));
    expect(errOf(await P(alice).set_nickname(ts[5], 'Sixth'))).toMatch(/maximum number of nicknames \(5\)$/);
    expect(await P(alice).my_nickname_count()).toEqual({ count: 5n, max_free: 3n, max_premium: 5n });
  });

  it('pages and searches the owner\'s own nicknames', async () => {
    const p1 = await P(alice).get_my_nicknames({ start_after: [], limit: 2n });
    expect(p1.items.length).toBe(2);
    const p2 = await P(alice).get_my_nicknames({ start_after: p1.next, limit: 2n });
    const p3 = await P(alice).get_my_nicknames({ start_after: p2.next, limit: 2n });
    expect(p3.next).toEqual([]);
    expect([...p1.items, ...p2.items, ...p3.items].length).toBe(5);
    expect((await P(alice).search_my_nicknames('fi', 10n)).map((n) => n.nickname)).toEqual(['Fifth']);
    expect((await P(alice).search_my_nicknames('FRIEND', 10n)).length).toBe(2);
    expect((await P(alice).search_my_nicknames('ren', 10n)).map((n) => n.nickname)).toEqual(['Renamed']);
    expect(await P(carol).search_my_nicknames('fi', 10n)).toEqual([]); // only one's own
  });

  it('checks the word blacklist without banning, and sets avatars', async () => {
    expect(errOf(await P(carol).set_nickname(alice, 'Total Badword'))).toMatch(/inappropriate/);
    const calls = await moderator.get_calls();
    expect(calls.at(-1)[3]).toBe(false); // not public: the moderator does not ban
    unwrap(await P(carol).set_nickname(alice, 'Ally'));
    expect(errOf(await P(carol).set_nickname_avatar(dave, [{ url: 'https://x.y/a.png' }]))).toMatch(/nickname first/);
    unwrap(await P(carol).set_nickname_avatar(alice, [{ url: 'https://x.y/a.png' }]));
    unwrap(await P(carol).set_nickname(alice, 'Ally B')); // the avatar stays
    expect((await P(carol).get_my_nicknames_for([alice]))[0][0].avatar).toEqual([{ url: 'https://x.y/a.png' }]);
    expect(errOf(await P(carol).set_nickname_avatar(alice, [{ url: 'ftp://x' }]))).toMatch(/https/);
  });

  it('nicknames neurons the same way', async () => {
    const root = user('root'); // nicknames need no SNS check: they are only seen by their owner
    unwrap(await N(alice).set_nickname(nk(root, 1), 'Whale One'));
    unwrap(await N(alice).set_nickname(nk(root, 2), 'Whale Two'));
    unwrap(await N(bob).set_nickname(nk(root, 1), 'Other'));
    const mine = (await N(alice).get_my_nicknames({ start_after: [], limit: 10n })).items;
    expect(mine.map((n) => [n.target.sns_root.toText(), n.target.neuron_id[0], n.nickname])).toEqual([[root.toText(), 1, 'Whale One'], [root.toText(), 2, 'Whale Two']]);
    expect((await N(alice).get_my_nicknames_for([nk(root, 2), nk(root, 3)])).map((x) => x[0]?.nickname)).toEqual(['Whale Two', undefined]);
    expect((await N(alice).search_my_nicknames('two', 5n)).map((n) => n.nickname)).toEqual(['Whale Two']);
    expect(errOf(await N(alice).set_nickname({ sns_root: root, neuron_id: new Uint8Array(0) }, 'x'))).toMatch(/neuron id/);
    const p = await N(alice).get_my_nicknames({ start_after: [], limit: 1n });
    expect((await N(alice).get_my_nicknames({ start_after: p.next, limit: 1n })).items[0].nickname).toBe('Whale Two');
  });

  it('imports once', async () => {
    const res = await pid.admin_import_nicknames([
      { owner: user('imp'), target: alice, nickname: 'Imported' },
      { owner: user('imp'), target: alice, nickname: 'Twice' },
      { owner: user('imp'), target: bob, nickname: ' bad ' },
    ]);
    expect(res.map((r) => Object.values(r)[0])).toEqual(['imported', 'already imported', 'Names may not start or end with a space']);
    unwrap(await pid.admin_finish_import());
    await expect(pid.admin_import_nicknames([])).rejects.toThrow(/closed/);
    expect((await pid.stats()).import_closed).toBe(true);
  });

  it('guards ingress and keeps everything over an upgrade', async () => {
    const attacker = actorAs(pic, asUpdates(pidIdl), pidId, bob);
    expect(await refusedAtIngress(attacker.get_my_nicknames({ start_after: [], limit: 5n }))).toBe(true);
    expect(await refusedAtIngress(attacker.search_my_nicknames('a', 5n))).toBe(true);
    expect(await refusedAtIngress(P(bob).set_nickname(alice, 'x'.repeat(5000)))).toBe(true);
    expect(await refusedAtIngress(P(bob).admin_set_config({ max_free: 1n, max_premium: 1n, moderator: [], premium: [] }))).toBe(true);
    const before = await P(alice).get_my_nicknames({ start_after: [], limit: 500n });
    const nBefore = await N(alice).get_my_nicknames({ start_after: [], limit: 500n });
    const stats = await pid.stats();
    for (const [id, name] of [[pidId, 'sneed_pid_nicknames'], [neuronId, 'sneed_neuron_nicknames']]) {
      await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(name), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    }
    expect(await P(alice).get_my_nicknames({ start_after: [], limit: 500n })).toEqual(before);
    expect(await N(alice).get_my_nicknames({ start_after: [], limit: 500n })).toEqual(nBefore);
    expect(await pid.stats()).toEqual(stats);
    expect(errOf(await P(alice).set_nickname(user('t-5'), 'Sixth'))).toMatch(/\(5\)/); // counts survive
  });
});

// ---------------------------------------------------------------------------------------------
// Account nicknames and pockets in sneed_pid_nicknames (spec/programmable_accounts.md §4.6, §4.7):
// a user's private names for ICRC-1 accounts and the pocket registry of Sneed Hub's wallet, in the
// same row. Apart from the principal nicknames (own tables, own limits); the canonical account key
// makes `null` and 32 zero bytes the same account. And the upgrade from the production build.
// ---------------------------------------------------------------------------------------------
const acct = (owner, sub = null) => ({ owner, subaccount: sub ? [sub] : [] });
const numbered = (n) => { const s = new Uint8Array(32); let v = BigInt(n); for (let i = 31; i >= 0 && v > 0n; i--) { s[i] = Number(v & 0xffn); v >>= 8n; } return s; };
const ZERO = new Uint8Array(32);
const meta = (o = {}) => ({ host: [], ledgers: [], hidden: false, created_at: 0n, ...o });
const LEDGER_A = Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai');
const LEDGER_B = Principal.fromText('hvgxa-wqaaa-aaaaq-aacia-cai');
const page = { start_after: [], limit: 500n };
const resultText = (r) => Object.values(r)[0];

describe('account nicknames and pockets', () => {
  let pic2, id, modId, premId, A, mod, prem;
  beforeAll(async () => {
    let subnet;
    ({ pic: pic2, appSubnet: subnet } = await createPic());
    id = await install(pic2, { name: 'sneed_pid_nicknames', cycles: 20n * T, targetSubnetId: subnet });
    premId = await install(pic2, { name: 'MockPremium', targetSubnetId: subnet });
    modId = await install(pic2, { name: 'MockNamesModerator', targetSubnetId: subnet });
    A = (p) => actorAs(pic2, pidIdl, id, p);
    mod = actorAs(pic2, moderatorIdl, modId, admin);
    prem = actorAs(pic2, premiumIdl, premId, admin);
    unwrap(await A(admin).admin_set_config({ max_free: 3n, max_premium: 5n, moderator: [modId], premium: [premId] }));
    await mod.set_words(['badword']);
  }, 180_000);
  afterAll(async () => { await pic2?.tearDown(); });

  it('defaults to 100 free and 1,000 with Premium, counted apart from principal nicknames', async () => {
    expect(await A(alice).get_account_limits()).toEqual({ account_max_free: 100n, account_max_premium: 1000n });
    expect(await A(alice).my_account_nickname_count()).toEqual({ count: 0n, max_free: 100n, max_premium: 1000n });
    expect(await A(alice).account_stats()).toEqual({ entries: 0n, owners: 0n, accounts: 0n });
  });

  it('keeps each owner\'s entries to themselves; null and 32 zero bytes are one account', async () => {
    unwrap(await A(alice).set_account_nickname(acct(bob), 'Bob main'));
    unwrap(await A(carol).set_account_nickname(acct(bob, ZERO), 'Robert'));
    // the zero subaccount reads back the null entry, and is listed as null (canonical)
    const [z, n] = await A(alice).get_my_account_nicknames_for([acct(bob, ZERO), acct(bob)]);
    expect(z[0].nickname).toBe('Bob main');
    expect(n[0].nickname).toBe('Bob main');
    expect(z[0].account.subaccount).toEqual([]);
    expect((await A(carol).get_my_account_nicknames_for([acct(bob)]))[0][0].nickname).toBe('Robert');
    expect(await A(bob).get_my_account_nicknames_for([acct(bob)])).toEqual([[]]);
    expect((await A(bob).get_my_account_nicknames(page)).items).toEqual([]);
    // the same name through the zero subaccount replaces, never adds
    unwrap(await A(alice).set_account_nickname(acct(bob, ZERO), 'Bob M'));
    expect((await A(alice).my_account_nickname_count()).count).toBe(1n);
    // a numbered subaccount is another account
    unwrap(await A(alice).set_account_nickname(acct(bob, numbered(1)), 'Bob one'));
    const mine = (await A(alice).get_my_account_nicknames(page)).items.map((e) => [e.account.owner.toText(), e.account.subaccount.length ? e.account.subaccount[0][31] : null, e.nickname]);
    expect(mine).toEqual([[bob.toText(), null, 'Bob M'], [bob.toText(), 1, 'Bob one']]);
    // malformed subaccounts are refused, and read as nothing
    expect(errOf(await A(alice).set_account_nickname(acct(bob, new Uint8Array(31)), 'Short'))).toMatch(/exactly 32 bytes/);
    expect(errOf(await A(alice).set_pocket(acct(bob, new Uint8Array(33)), [meta()]))).toMatch(/exactly 32 bytes/);
    expect(await A(alice).get_my_account_nicknames_for([acct(bob, new Uint8Array(31))])).toEqual([[]]);
    // names follow the naming rules
    expect(errOf(await A(alice).set_account_nickname(acct(carol), 'b@d'))).toMatch(/only letters/);
    // principal nicknames are untouched
    expect((await A(alice).my_nickname_count()).count).toBe(0n);
    expect((await A(alice).get_my_nicknames(page)).items).toEqual([]);
  });

  it('sets and clears names and pocket meta independently; an entry lives while it has either', async () => {
    const me = user('pockets-dan');
    const p3 = acct(me, numbered(3));
    unwrap(await A(me).set_pocket(p3, [meta({ ledgers: [LEDGER_A, LEDGER_B, LEDGER_A], created_at: 123n })]));
    let [e] = await A(me).get_my_account_nicknames_for([p3]);
    expect(e[0].nickname).toBe('');
    expect(e[0].pocket[0].ledgers.map((l) => l.toText())).toEqual([LEDGER_A.toText(), LEDGER_B.toText()]); // deduplicated
    expect(e[0].pocket[0].created_at).toBe(123n);
    expect(e[0].pocket[0].host).toEqual([]);
    unwrap(await A(me).set_account_nickname(p3, 'Savings'));
    // updating the meta keeps the name and the first created_at
    expect(unwrap(await A(me).set_pocket(p3, [meta({ hidden: true, created_at: 999n })]))).toBe('Pocket updated');
    [e] = await A(me).get_my_account_nicknames_for([p3]);
    expect([e[0].nickname, e[0].pocket[0].hidden, e[0].pocket[0].created_at]).toEqual(['Savings', true, 123n]);
    // clearing the name keeps the pocket
    expect(unwrap(await A(me).set_account_nickname(p3, ''))).toBe('Name removed');
    expect(unwrap(await A(me).set_account_nickname(p3, ''))).toBe('Unchanged');
    [e] = await A(me).get_my_account_nicknames_for([p3]);
    expect([e[0].nickname, e[0].pocket.length]).toEqual(['', 1]);
    // forgetting the pocket with no name deletes the entry
    expect(unwrap(await A(me).set_pocket(p3, []))).toBe('Pocket forgotten');
    expect(await A(me).get_my_account_nicknames_for([p3])).toEqual([[]]);
    expect((await A(me).my_account_nickname_count()).count).toBe(0n);
    expect(unwrap(await A(me).set_pocket(p3, []))).toBe('Unchanged');
    // forgetting a named pocket keeps the name; created_at 0 means now
    unwrap(await A(me).set_pocket(p3, [meta({ host: ['sneed_lock'] })]));
    [e] = await A(me).get_my_account_nicknames_for([p3]);
    expect(e[0].pocket[0].created_at).toBeGreaterThan(0n);
    expect(e[0].pocket[0].host).toEqual(['sneed_lock']);
    unwrap(await A(me).set_account_nickname(p3, 'Bots'));
    unwrap(await A(me).set_pocket(p3, []));
    [e] = await A(me).get_my_account_nicknames_for([p3]);
    expect([e[0].nickname, e[0].pocket]).toEqual(['Bots', []]);
    // meta validation: host is an adapter id, at most 20 ledgers
    expect(errOf(await A(me).set_pocket(p3, [meta({ host: ['Sneed Lock'] })]))).toMatch(/adapter id/);
    expect(errOf(await A(me).set_pocket(p3, [meta({ host: [''] })]))).toMatch(/1-32/);
    const many = Array.from({ length: 21 }, (_, i) => user(`ledger-${i}`));
    expect(errOf(await A(me).set_pocket(p3, [meta({ ledgers: many })]))).toMatch(/At most 20 ledgers/);
    unwrap(await A(me).set_pocket(p3, [meta({ ledgers: many.slice(0, 20) })]));
  });

  it('pages through the owner\'s own range', async () => {
    const me = user('pockets-pager');
    for (let n = 1; n <= 5; n++) unwrap(await A(me).set_pocket(acct(me, numbered(n)), [meta()]));
    const p1 = await A(me).get_my_account_nicknames({ start_after: [], limit: 2n });
    const p2 = await A(me).get_my_account_nicknames({ start_after: p1.next, limit: 2n });
    const p3 = await A(me).get_my_account_nicknames({ start_after: p2.next, limit: 2n });
    expect(p3.next).toEqual([]);
    expect([...p1.items, ...p2.items, ...p3.items].map((e) => e.account.subaccount[0][31])).toEqual([1, 2, 3, 4, 5]);
    await expect(A(me).get_my_account_nicknames_for(Array.from({ length: 101 }, () => acct(me)))).rejects.toThrow(/At most 100/);
  });

  it('applies its own free and premium limits, admin-settable', async () => {
    expect(await refusedAtIngress(A(alice).admin_set_account_limits({ account_max_free: 1n, account_max_premium: 1n }))).toBe(true);
    expect(errOf(await A(admin).admin_set_account_limits({ account_max_free: 5n, account_max_premium: 4n }))).toMatch(/<=/);
    expect(errOf(await A(admin).admin_set_account_limits({ account_max_free: 5n, account_max_premium: 10_001n }))).toMatch(/<=/);
    unwrap(await A(admin).admin_set_account_limits({ account_max_free: 2n, account_max_premium: 4n }));
    const me = user('pockets-limited');
    unwrap(await A(me).set_account_nickname(acct(alice), 'One'));
    unwrap(await A(me).set_pocket(acct(me, numbered(1)), [meta()]));
    expect(errOf(await A(me).set_account_nickname(acct(bob), 'Three'))).toMatch(/maximum number of account names and pockets \(2\)\. Get Sneed Premium/);
    expect(errOf(await A(me).set_pocket(acct(me, numbered(2)), [meta()]))).toMatch(/\(2\)\. Get Sneed Premium/);
    unwrap(await A(me).set_account_nickname(acct(alice), 'Renamed')); // changing one is not adding one
    unwrap(await A(me).set_account_nickname(acct(me, numbered(1)), 'Named')); // naming a pocket is not adding one
    await prem.set_member(me, (await nowNs(pic2)) + 86_400_000_000_000n);
    unwrap(await A(me).set_account_nickname(acct(bob), 'Three'));
    unwrap(await A(me).set_pocket(acct(me, numbered(2)), [meta()]));
    expect(errOf(await A(me).set_pocket(acct(me, numbered(3)), [meta()]))).toMatch(/\(4\)$/);
    expect(await A(me).my_account_nickname_count()).toEqual({ count: 4n, max_free: 2n, max_premium: 4n });
    expect((await A(me).my_nickname_count()).count).toBe(0n); // principal nicknames counted apart
    unwrap(await A(admin).admin_set_account_limits({ account_max_free: 100n, account_max_premium: 1000n }));
  });

  it('writes pockets in batches of up to 50', async () => {
    const me = user('pockets-batch');
    const res = await A(me).set_pockets([
      [acct(me, numbered(1)), [meta({ ledgers: [LEDGER_A] })]],
      [acct(me, new Uint8Array(5)), [meta()]],
      [acct(me, numbered(2)), [meta({ host: ['Bad Host'] })]],
      [acct(me, numbered(3)), [meta({ hidden: true })]],
      [acct(me, numbered(9)), []],
    ]);
    expect(res.map(resultText)).toEqual(['Pocket remembered', 'A subaccount is exactly 32 bytes', "A pocket host is an adapter id: a-z, 0-9, '_' and '-'", 'Pocket remembered', 'Unchanged']);
    expect(res.map((r) => Object.keys(r)[0])).toEqual(['ok', 'err', 'err', 'ok', 'ok']);
    const items = (await A(me).get_my_account_nicknames(page)).items;
    expect(items.map((e) => [e.account.subaccount[0][31], e.pocket[0].hidden])).toEqual([[1, false], [3, true]]);
    // forget and update in one batch
    const res2 = await A(me).set_pockets([[acct(me, numbered(1)), []], [acct(me, numbered(3)), [meta({ hidden: false })]]]);
    expect(res2.map(resultText)).toEqual(['Pocket forgotten', 'Pocket updated']);
    expect((await A(me).my_account_nickname_count()).count).toBe(1n);
    // a batch that would pass the limit is refused whole (nothing half-written)
    unwrap(await A(admin).admin_set_account_limits({ account_max_free: 2n, account_max_premium: 2n }));
    const res3 = await A(me).set_pockets([[acct(me, numbered(4)), [meta()]], [acct(me, numbered(5)), [meta()]]]);
    expect(res3.map((r) => Object.keys(r)[0])).toEqual(['err', 'err']);
    expect((await A(me).my_account_nickname_count()).count).toBe(1n);
    unwrap(await A(admin).admin_set_account_limits({ account_max_free: 100n, account_max_premium: 1000n }));
    const fifty = Array.from({ length: 50 }, (_, i) => [acct(me, numbered(100 + i)), [meta()]]);
    expect((await A(me).set_pockets(fifty)).every((r) => 'ok' in r)).toBe(true);
    await expect(A(me).set_pockets([...fifty, [acct(me, numbered(999)), [meta()]]])).rejects.toThrow(/At most 50/);
  });

  it('checks the blacklist and bans: banned users cannot write, only forget', async () => {
    const me = user('pockets-banned');
    unwrap(await A(me).set_pocket(acct(me, numbered(1)), [meta()]));
    expect(errOf(await A(me).set_account_nickname(acct(me, numbered(1)), 'Total Badword'))).toMatch(/inappropriate/);
    expect((await mod.get_calls()).at(-1)[3]).toBe(false); // not public: no auto-ban
    await mod.set_banned([me]);
    expect(errOf(await A(me).set_account_nickname(acct(me, numbered(1)), 'Fine name'))).toMatch(/banned/);
    expect(errOf(await A(me).set_pocket(acct(me, numbered(2)), [meta()]))).toMatch(/banned/);
    expect(errOf(await A(me).set_pocket(acct(me, numbered(1)), [meta({ hidden: true })]))).toMatch(/banned/);
    expect((await A(me).set_pockets([[acct(me, numbered(3)), [meta()]]])).map(resultText)).toEqual(['You are banned']);
    expect(unwrap(await A(me).set_pocket(acct(me, numbered(1)), []))).toBe('Pocket forgotten'); // removing one's own data is allowed
    expect((await A(me).my_account_nickname_count()).count).toBe(0n);
    await mod.set_banned([]);
  });

  it('guards ingress: queries refused as updates, anonymous writes refused, arguments capped', async () => {
    const attacker = actorAs(pic2, asUpdates(pidIdl), id, bob);
    expect(await refusedAtIngress(attacker.get_my_account_nicknames(page))).toBe(true);
    expect(await refusedAtIngress(attacker.get_my_account_nicknames_for([acct(bob)]))).toBe(true);
    expect(await refusedAtIngress(attacker.my_account_nickname_count())).toBe(true);
    expect(await refusedAtIngress(attacker.get_account_limits())).toBe(true);
    expect(await refusedAtIngress(attacker.account_stats())).toBe(true);
    expect(await refusedAtIngress(A(anon).set_account_nickname(acct(bob), 'x'))).toBe(true);
    expect(await refusedAtIngress(A(anon).set_pocket(acct(bob), [meta()]))).toBe(true);
    expect(await refusedAtIngress(A(anon).set_pockets([]))).toBe(true);
    expect(await refusedAtIngress(A(bob).set_account_nickname(acct(bob), 'x'.repeat(5000)))).toBe(true);
    expect(await refusedAtIngress(A(bob).set_pocket(acct(bob), [meta({ host: ['x'.repeat(5000)] })]))).toBe(true);
    const big = Array.from({ length: 50 }, (_, i) => [acct(bob, numbered(i + 1)), [meta({ host: ['h'.repeat(2000)] })]]);
    expect(await refusedAtIngress(A(bob).set_pockets(big))).toBe(true);
    expect(await refusedAtIngress(A(bob).admin_set_account_limits({ account_max_free: 1n, account_max_premium: 1n }))).toBe(true);
    // a full batch of real pockets fits (20 ledgers each)
    const full = Array.from({ length: 50 }, (_, i) => [acct(bob, numbered(i + 1)), [meta({ host: ['sneed_notifications'], ledgers: Array.from({ length: 20 }, (_, j) => user(`l${j}`)) })]]);
    expect((await A(bob).set_pockets(full)).every((r) => 'ok' in r)).toBe(true);
  });

  it('keeps every entry over an upgrade', async () => {
    const before = await A(alice).get_my_account_nicknames(page);
    const stats = await A(alice).account_stats();
    const limits = await A(alice).get_account_limits();
    await pic2.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm('sneed_pid_nicknames'), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    expect(await A(alice).get_my_account_nicknames(page)).toEqual(before);
    expect(await A(alice).account_stats()).toEqual(stats);
    expect(await A(alice).get_account_limits()).toEqual(limits);
  });
});

describe('sneed_pid_nicknames: upgrade from the production build', () => {
  let pic3, id, modId, A;
  const owners = ['up-a', 'up-b', 'up-c'].map((n) => user(n));
  const snapshot = async () => {
    const out = {};
    for (const o of owners) out[o.toText()] = { list: await A(o).get_my_nicknames(page), count: await A(o).my_nickname_count(), search: await A(o).search_my_nicknames('fr', 50n) };
    return { out, stats: await A(admin).stats(), config: await A(admin).get_config(), admins: (await A(admin).get_admins()).map((p) => p.toText()) };
  };
  beforeAll(async () => {
    let subnet;
    ({ pic: pic3, appSubnet: subnet } = await createPic());
    modId = await install(pic3, { name: 'MockNamesModerator', targetSubnetId: subnet });
    // sneed_pid_nicknames as production runs it (module hash 1d48a9e5…, commit 25b88246)
    id = await install(pic3, { name: 'sneed_pid_nicknames_prod', cycles: 20n * T, targetSubnetId: subnet });
    A = (p) => actorAs(pic3, pidIdl, id, p);
    unwrap(await A(admin).admin_set_config({ max_free: 10n, max_premium: 100n, moderator: [modId], premium: [] }));
    unwrap(await A(admin).admin_add_admin(carol));
    for (const [i, o] of owners.entries()) {
      for (let j = 0; j < 4 + i; j++) unwrap(await A(o).set_nickname(user(`up-target-${j}`), `Friend ${i} ${j}`));
    }
    unwrap(await A(owners[0]).set_nickname_avatar(user('up-target-0'), [{ url: 'https://x.y/a.png' }]));
    const imported = await A(admin).admin_import_nicknames([{ owner: user('up-imp'), target: alice, nickname: 'Imported' }]);
    expect(imported.map(resultText)).toEqual(['imported']);
  }, 180_000);
  afterAll(async () => { await pic3?.tearDown(); });

  it('refuses an upgrade without keep and loses nothing (fail-safe)', async () => {
    const before = await snapshot();
    await expect(pic3.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm('sneed_pid_nicknames'), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [] } })).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    // still the old module: the new methods are not there yet
    await expect(A(alice).account_stats()).rejects.toThrow();
  });

  it('upgrades with keep: every principal nickname, avatar, count, config and admin survives', async () => {
    const before = await snapshot();
    expect(before.stats.nicknames).toBe(4n + 5n + 6n + 1n);
    await pic3.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm('sneed_pid_nicknames'), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    expect(await snapshot()).toEqual(before);
    expect((await A(owners[0]).get_my_nicknames_for([user('up-target-0')]))[0][0].avatar).toEqual([{ url: 'https://x.y/a.png' }]);
    expect((await A(user('up-imp')).get_my_nicknames(page)).items.map((n) => n.nickname)).toEqual(['Imported']);
    // the old methods work as before, the new ones start empty with their defaults
    unwrap(await A(owners[0]).set_nickname(user('up-target-9'), 'Friend new'));
    expect((await A(owners[0]).my_nickname_count()).count).toBe(5n);
    expect(await A(alice).account_stats()).toEqual({ entries: 0n, owners: 0n, accounts: 0n });
    expect(await A(alice).get_account_limits()).toEqual({ account_max_free: 100n, account_max_premium: 1000n });
    unwrap(await A(owners[0]).set_pocket(acct(owners[0], numbered(1)), [meta()]));
    unwrap(await A(owners[0]).set_account_nickname(acct(owners[0], numbered(1)), 'Savings'));
    expect((await A(owners[0]).get_my_account_nicknames(page)).items.map((e) => e.nickname)).toEqual(['Savings']);
    expect((await A(owners[0]).my_nickname_count()).count).toBe(5n); // apart from the account entries
  });
});
