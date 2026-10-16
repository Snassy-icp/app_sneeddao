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
