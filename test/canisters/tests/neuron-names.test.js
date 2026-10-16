// sneed_neuron_names (spec/sneed_names.md §5): SNS neuron names unique per SNS regardless of
// capitals, set by anyone with a permission on the neuron of an SNS that SNS-W lists, avatars,
// verification of the exact name by admins, Sneed DAO and the neuron's own SNS governance,
// search and paging per SNS, the changes feed, the import, the ICRC-3 log, the ingress guard and
// an upgrade.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, T, unwrap, errOf, wasm, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { hubSnsIdl } from '../lib/hub.js';
import { verifyLog, archiveIdl, btype } from '../lib/icrc3.js';
import { idlFactory as namesIdl } from '../build/sneed_neuron_names.did.js';

const anon = Principal.anonymous();
const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const HOTKEY = [3, 4];
const perm = (p, types) => ({ principal: [p], permission_type: types });
const nid = (n) => new Uint8Array(32).fill(n);
const N1 = nid(1); const N2 = nid(2); const N3 = nid(3);
const Result = (IDL) => IDL.Variant({ ok: IDL.Text, err: IDL.Text });
const snswIdl = ({ IDL }) => IDL.Service({ set_deployed_snses: IDL.Func([IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Principal))], [], []) });
const govIdl = ({ IDL }) => IDL.Service({
  ...hubSnsIdl({ IDL })._fields.reduce((o, [k, v]) => ({ ...o, [k]: v }), {}),
  call_verify_by_sns: IDL.Func([IDL.Principal, IDL.Principal, IDL.Vec(IDL.Nat8), IDL.Text], [Result(IDL)], []),
  call_unverify_by_sns: IDL.Func([IDL.Principal, IDL.Principal, IDL.Vec(IDL.Nat8)], [Result(IDL)], []),
  call_verify_by_dao: IDL.Func([IDL.Principal, IDL.Principal, IDL.Text], [IDL.Variant({ ok: IDL.Null, err: IDL.Text })], []),
});

let pic, rootKey, appSubnet, namesId, snswId, rootA, govA, rootB, govB, fakeRoot;
let names, as, snsw, gA, gB, gFake;
const archiveActor = (id) => actorAs(pic, archiveIdl, id, admin);
const key = (root, id) => ({ sns_root: root, neuron_id: id });
const nameOf = async (root, id) => (await names.get_names([key(root, id)]))[0][0];

describe('sneed_neuron_names', () => {
  beforeAll(async () => {
    ({ pic, rootKey, appSubnet } = await createPic());
    namesId = await install(pic, { name: 'sneed_neuron_names', cycles: 20n * T, targetSubnetId: appSubnet });
    snswId = await install(pic, { name: 'MockSnsWasm', targetSubnetId: appSubnet });
    rootA = await install(pic, { name: 'MockHubSns', targetSubnetId: appSubnet });
    govA = await install(pic, { name: 'MockHubSns', targetSubnetId: appSubnet });
    rootB = await install(pic, { name: 'MockHubSns', targetSubnetId: appSubnet });
    govB = await install(pic, { name: 'MockHubSns', targetSubnetId: appSubnet });
    fakeRoot = await install(pic, { name: 'MockHubSns', targetSubnetId: appSubnet }); // root and governance of an SNS SNS-W does not list
    names = actorAs(pic, namesIdl, namesId, admin);
    as = (p) => actorAs(pic, namesIdl, namesId, p);
    snsw = actorAs(pic, snswIdl, snswId, admin);
    gA = actorAs(pic, govIdl, govA, admin); gB = actorAs(pic, govIdl, govB, admin); gFake = actorAs(pic, govIdl, fakeRoot, admin);
    await snsw.set_deployed_snses([[rootA, govA], [rootB, govB]]);
    const neurons = [
      { id: N1, permissions: [perm(alice, ALL), perm(carol, HOTKEY)] },
      { id: N2, permissions: [perm(bob, ALL)] },
      { id: N3, permissions: [perm(carol, ALL)] },
    ];
    await gA.set_neurons(neurons); await gB.set_neurons(neurons); await gFake.set_neurons(neurons);
    unwrap(await names.admin_set_config({ ...(await names.get_config()), sns_wasm: snswId }));
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('names neurons of listed SNSes, by their principals, unique per SNS', async () => {
    expect(await refusedAtIngress(as(anon).set_name(key(rootA, N1), 'x'))).toBe(true);
    expect(errOf(await as(alice).set_name(key(fakeRoot, N1), 'Fake'))).toMatch(/Not a deployed SNS/);
    expect(errOf(await as(bob).set_name(key(rootA, N1), 'Mine'))).toMatch(/no permission/);
    expect(errOf(await as(alice).set_name(key(rootA, nid(9)), 'Ghost'))).toMatch(/No such neuron/);
    expect(errOf(await as(alice).set_name(key(rootA, N1), 'b@d'))).toMatch(/only letters/);
    unwrap(await as(alice).set_name(key(rootA, N1), 'Sneed Whale'));
    unwrap(await as(carol).set_name(key(rootA, N1), 'Sneed Whale 2')); // a hotkey may name it too, as today
    unwrap(await as(alice).set_name(key(rootA, N1), 'Sneed Whale'));
    expect(errOf(await as(bob).set_name(key(rootA, N2), 'SNEED WHALE'))).toMatch(/taken in this SNS/);
    unwrap(await as(bob).set_name(key(rootB, N2), 'SNEED WHALE')); // another SNS: fine
    unwrap(await as(bob).set_name(key(rootA, N2), 'Big Whale'));
    unwrap(await as(carol).set_name(key(rootA, N3), 'Minnow'));
    expect(await nameOf(rootA, N1)).toEqual({ name: 'Sneed Whale', verified: false, avatar: [] });
    expect(await names.get_names([key(rootA, N2), key(rootB, N2), key(rootB, N1), key(fakeRoot, N1)])).toEqual([
      [{ name: 'Big Whale', verified: false, avatar: [] }], [{ name: 'SNEED WHALE', verified: false, avatar: [] }], [], [],
    ]);
    expect(unwrap(await as(alice).set_name(key(rootA, N1), 'Sneed Whale'))).toBe('Unchanged');
    // removing frees the name
    unwrap(await as(carol).set_name(key(rootA, N3), ''));
    expect(await nameOf(rootA, N3)).toBeUndefined();
    unwrap(await as(bob).set_name(key(rootA, N2), 'Minnow'));
    unwrap(await as(bob).set_name(key(rootA, N2), 'Big Whale'));
    await expect(names.get_names(Array(501).fill(key(rootA, N1)))).rejects.toThrow(/500/);
  });

  it('searches and pages per SNS', async () => {
    const s = async (root, prefix) => (await names.search({ sns_root: root, prefix, limit: 10n })).map((v) => v.name);
    expect(await s(rootA, 'whale')).toEqual(['Big Whale', 'Sneed Whale']);
    expect(await s(rootA, 'sn')).toEqual(['Sneed Whale']);
    expect(await s(rootB, 'whale')).toEqual(['SNEED WHALE']);
    expect(await s(fakeRoot, 'whale')).toEqual([]);
    const p1 = await names.list_by_sns({ sns_root: rootA, start_after: [], limit: 1n });
    expect(p1.items.map((v) => v.name)).toEqual(['Big Whale']);
    const p2 = await names.list_by_sns({ sns_root: rootA, start_after: p1.next, limit: 5n });
    expect(p2.items.map((v) => v.name)).toEqual(['Sneed Whale']);
    expect(p2.next).toEqual([]);
    const v = (await names.get_name(key(rootA, N1)))[0];
    expect(v.sns_root.toText()).toBe(rootA.toText());
    expect(Array.from(v.neuron_id)).toEqual(Array.from(N1));
    expect(v.set_by.toText()).toBe(alice.toText());
  });

  it('sets avatars of named neurons', async () => {
    expect(errOf(await as(carol).set_avatar(key(rootA, N3), [{ url: 'https://x.y/a.png' }]))).toMatch(/Name the neuron first/);
    expect(errOf(await as(bob).set_avatar(key(rootA, N1), [{ url: 'https://x.y/a.png' }]))).toMatch(/no permission/);
    unwrap(await as(alice).set_avatar(key(rootA, N1), [{ url: 'https://x.y/a.png' }]));
    expect((await nameOf(rootA, N1)).avatar).toEqual([{ url: 'https://x.y/a.png' }]);
    unwrap(await names.admin_clear_avatar(key(rootA, N1)));
    expect((await nameOf(rootA, N1)).avatar).toEqual([]);
  });

  it('verifies the exact name: admins, the neuron\'s own SNS, Sneed DAO', async () => {
    expect(await refusedAtIngress(as(bob).verify(key(rootA, N1), 'Sneed Whale'))).toBe(true);
    expect(errOf(await names.verify(key(rootA, N1), 'sneed whale'))).toMatch(/not sneed whale/);
    unwrap(await names.verify(key(rootA, N1), 'Sneed Whale'));
    expect((await nameOf(rootA, N1)).verified).toBe(true);
    unwrap(await as(alice).set_name(key(rootA, N1), 'Sneed whale')); // a rename (capitals too) clears it
    expect((await nameOf(rootA, N1)).verified).toBe(false);
    // the SNS's own governance, for its own neurons only
    expect(errOf(await gB.call_verify_by_sns(namesId, rootA, N1, 'Sneed whale'))).toMatch(/Only the governance canister of that SNS/);
    expect(errOf(await gFake.call_verify_by_sns(namesId, fakeRoot, N1, 'x'))).toMatch(/Not a deployed SNS/);
    expect(await refusedAtIngress(as(alice).verify_by_sns(key(rootA, N1), 'Sneed whale'))).toBe(true);
    unwrap(await gA.call_verify_by_sns(namesId, rootA, N1, 'Sneed whale'));
    expect((await names.get_name(key(rootA, N1)))[0].verification[0].source).toEqual({ sns_governance: govA });
    unwrap(await gA.call_unverify_by_sns(namesId, rootA, N1));
    expect((await nameOf(rootA, N1)).verified).toBe(false);
    // Sneed DAO
    unwrap(await names.admin_set_config({ ...(await names.get_config()), dao_governance: govB }));
    expect(await names.validate_verify_by_dao(key(rootA, N1), 'Sneed whale')).toHaveProperty('Ok');
    expect(await names.validate_verify_by_dao(key(rootA, N1), 'x')).toHaveProperty('Err');
    expect(await refusedAtIngress(names.verify_by_dao(key(rootA, N1), 'Sneed whale'))).toBe(true); // governance calls it, never ingress
  });

  it('feeds changes and imports once', async () => {
    const start = (await names.stats()).last_seq;
    unwrap(await as(carol).set_name(key(rootB, N3), 'Feed'));
    unwrap(await as(carol).set_name(key(rootB, N3), ''));
    const feed = await names.changes_since({ after: start, limit: 10n });
    expect(feed.items.map((c) => [c.key.sns_root.toText(), c.state.length])).toEqual([[rootB.toText(), 0]]);
    const res = await names.admin_import_names([
      { sns_root: rootA, neuron_id: nid(20), name: 'Imported', verified: true },
      { sns_root: rootA, neuron_id: nid(21), name: 'BIG WHALE', verified: false },
      { sns_root: rootA, neuron_id: nid(20), name: 'Again', verified: false },
      { sns_root: user('never-an-sns'), neuron_id: nid(1), name: 'Imported', verified: false }, // other scope: fine
    ]);
    expect(res.map((r) => Object.values(r.result)[0])).toEqual(['imported', 'name taken', 'already imported', 'imported']);
    expect((await nameOf(rootA, nid(20))).verified).toBe(true);
    unwrap(await names.admin_finish_import());
    await expect(names.admin_import_names([])).rejects.toThrow(/closed/);
  });

  it('logs to ICRC-3 and guards ingress', async () => {
    const { blocks } = await verifyLog(names, namesId, rootKey, archiveActor);
    const types = new Set(blocks.map(btype));
    for (const t of ['name_set', 'avatar_set', 'verify', 'unverify', 'config_update', 'import']) expect(types.has(`sneedneuronnames_${t}`), t).toBe(true);
    const attacker = actorAs(pic, asUpdates(namesIdl), namesId, bob);
    expect(await refusedAtIngress(attacker.get_names([key(rootA, N1)]))).toBe(true);
    expect(await refusedAtIngress(attacker.search({ sns_root: rootA, prefix: 'a', limit: 3n }))).toBe(true);
    expect(await refusedAtIngress(as(bob).set_name(key(rootA, N2), 'x'.repeat(5000)))).toBe(true);
    expect(await refusedAtIngress(as(bob).admin_set_name(key(rootA, N2), 'x'))).toBe(true);
  });

  it('keeps everything over an upgrade', async () => {
    const keys = [key(rootA, N1), key(rootA, N2), key(rootB, N2), key(rootA, nid(20))];
    const before = await names.get_names(keys);
    const stats = await names.stats();
    await pic.upgradeCanister({ sender: admin, canisterId: namesId, wasm: wasm('sneed_neuron_names'), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    expect(await names.get_names(keys)).toEqual(before);
    expect(await names.stats()).toEqual(stats);
    expect((await names.search({ sns_root: rootA, prefix: 'whale', limit: 5n })).length).toBe(2);
    unwrap(await as(carol).set_name(key(rootA, N3), 'After Upgrade'));
    await verifyLog(names, namesId, rootKey, archiveActor);
  });
});
