// The frontend's naming service module (src/app_sneeddao_frontend/src/utils/NamingService.js) run
// against the real naming canisters: the incremental mirror built from changes_since (renames and
// removals included), the backend-shaped answers the pages rely on, nicknames, avatars uploaded from
// data URLs, and setPrincipalNameFor's routes (self, canister, account by hotkey, refusal, admin).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, T, unwrap } from '../lib/pic.js';
import { idlFactory as pidNamesIdl } from '../build/sneed_pid_names.did.js';
import { idlFactory as neuronNamesIdl } from '../build/sneed_neuron_names.did.js';
import { idlFactory as pidNicknamesIdl } from '../build/sneed_pid_nicknames.did.js';
import { idlFactory as neuronNicknamesIdl } from '../build/sneed_neuron_nicknames.did.js';
import { idlFactory as avatarsIdl } from '../build/sneed_avatars.did.js';

// localStorage for the mirror, as in a browser
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const ident = (p) => ({ getPrincipal: () => p });
const ROOT = user('sns-root');
const N1 = new Uint8Array(32).fill(7);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let pic, appSubnet, ids, NS, aliceCan;

describe('frontend NamingService against the naming canisters', () => {
  beforeAll(async () => {
    ({ pic, appSubnet } = await createPic());
    ids = {};
    for (const n of ['sneed_pid_names', 'sneed_neuron_names', 'sneed_pid_nicknames', 'sneed_neuron_nicknames', 'sneed_avatars']) {
      ids[n] = await install(pic, { name: n, cycles: 20n * T, targetSubnetId: appSubnet });
    }
    aliceCan = await install(pic, { name: 'MockPremium', controllers: [alice], sender: alice, cycles: 2n * T, targetSubnetId: appSubnet });
    process.env.CANISTER_ID_SNEED_PID_NAMES = ids.sneed_pid_names.toText();
    process.env.CANISTER_ID_SNEED_NEURON_NAMES = ids.sneed_neuron_names.toText();
    process.env.CANISTER_ID_SNEED_PID_NICKNAMES = ids.sneed_pid_nicknames.toText();
    process.env.CANISTER_ID_SNEED_NEURON_NICKNAMES = ids.sneed_neuron_nicknames.toText();
    process.env.CANISTER_ID_SNEED_AVATARS = ids.sneed_avatars.toText();
    process.env.DFX_NETWORK = 'ic';
    NS = await import('../../../src/app_sneeddao_frontend/src/utils/NamingService.js');
    const as = (idl, id) => (identity) => actorAs(pic, idl, id, identity ? identity.getPrincipal() : Principal.anonymous());
    NS.setActorsForTest({
      pidNames: as(pidNamesIdl, ids.sneed_pid_names),
      neuronNames: as(neuronNamesIdl, ids.sneed_neuron_names),
      pidNicknames: as(pidNicknamesIdl, ids.sneed_pid_nicknames),
      neuronNicknames: as(neuronNicknamesIdl, ids.sneed_neuron_nicknames),
      avatars: as(avatarsIdl, ids.sneed_avatars),
    });
    // neuron names are imported (setting one needs a real SNS)
    const [imported] = await actorAs(pic, neuronNamesIdl, ids.sneed_neuron_names, admin).admin_import_names([{ sns_root: ROOT, neuron_id: N1, name: 'Big One', verified: true }]);
    unwrap(imported.result);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('is switched on by the canister ids of the build', () => {
    expect(NS.namingServiceEnabled).toBe(true);
    expect(NS.dappRegistryEnabled).toBe(false); // no sneed_profiles id
  });

  it('mirrors names incrementally, in the backend\'s shapes', async () => {
    unwrap(await NS.setPrincipalName(ident(alice), 'Alice'));
    unwrap(await NS.setPrincipalName(ident(bob), 'Bob'));
    let all = await NS.getAllPrincipalNames(null);
    expect(all.map(([p, [n, v]]) => [p.toText(), n, v]).sort()).toEqual([[alice.toText(), 'Alice', false], [bob.toText(), 'Bob', false]].sort());
    const seq = JSON.parse(store.get('sneed_names_mirror_v1')).seq;
    // a hotkey-merged principal shows the account's name; a cleared name disappears
    unwrap(await NS.addHotkey(ident(carol), alice));
    const carolAcc = (await NS.myHotkeyAccounts(ident(alice)))[0].id;
    unwrap(await NS.mergeAccount(ident(alice), carolAcc));
    unwrap(await NS.setPrincipalName(ident(bob), ''));
    all = await NS.getAllPrincipalNames(null);
    expect(all.map(([p, [n]]) => [p.toText(), n]).sort()).toEqual([[alice.toText(), 'Alice'], [carol.toText(), 'Alice']].sort());
    expect(BigInt(JSON.parse(store.get('sneed_names_mirror_v1')).seq)).toBeGreaterThan(BigInt(seq)); // only the changes were fetched
    expect(await NS.getPrincipalName(null, carol)).toEqual([['Alice', false]]);
    expect(await NS.getPrincipalName(null, bob)).toEqual([]);
    const neurons = await NS.getAllNeuronNames(null);
    expect(neurons.length).toBe(1);
    expect(neurons[0][0].sns_root_canister_id.toText()).toBe(ROOT.toText());
    expect(Array.from(neurons[0][0].neuron_id.id)).toEqual(Array.from(N1));
    expect(neurons[0][1]).toEqual(['Big One', true]);
    expect(await NS.getNeuronName(null, ROOT.toText(), Buffer.from(N1).toString('hex'))).toEqual([['Big One', true]]);
  });

  it('keeps nicknames per user', async () => {
    unwrap(await NS.setPrincipalNickname(ident(bob), alice.toText(), 'Ally'));
    unwrap(await NS.setNeuronNickname(ident(bob), ROOT.toText(), Buffer.from(N1).toString('hex'), 'Whale'));
    expect((await NS.getAllPrincipalNicknames(ident(bob))).map(([p, n]) => [p.toText(), n])).toEqual([[alice.toText(), 'Ally']]);
    const nn = await NS.getAllNeuronNicknames(ident(bob));
    expect(nn[0][1]).toBe('Whale');
    expect(nn[0][0].sns_root_canister_id.toText()).toBe(ROOT.toText());
    expect(await NS.getPrincipalNickname(ident(bob), alice)).toEqual(['Ally']);
    expect(await NS.getPrincipalNickname(ident(carol), alice)).toEqual([]);
    expect(await NS.getAllPrincipalNicknames(null)).toBe(null);
  });

  it('uploads a data-URL avatar and serves it by its raw URL', async () => {
    unwrap(await NS.setMyAvatar(ident(alice), PNG));
    const avatars = await NS.getAvatars(null, [alice, carol, bob]);
    const url = avatars.get(alice.toText());
    expect(url).toMatch(new RegExp(`^https://${ids.sneed_avatars.toText()}\\.raw\\.icp0\\.io/[0-9a-f]{64}$`));
    expect(avatars.get(carol.toText())).toBe(url); // the account's avatar, for all its principals
    expect(avatars.has(bob.toText())).toBe(false);
    unwrap(await NS.setMyAvatar(ident(bob), 'https://example.com/b.png'));
    expect((await NS.getAvatars(null, [bob])).get(bob.toText())).toBe('https://example.com/b.png');
    expect('err' in (await NS.setMyAvatar(ident(bob), 'data:image/png;base64,AAAA'))).toBe(true); // not a PNG: refused
  });

  it('routes setPrincipalNameFor: self, canister, hotkey account, refusal, admin', async () => {
    unwrap(await NS.setPrincipalNameFor(ident(bob), bob, 'Bobby'));
    unwrap(await NS.setPrincipalNameFor(ident(alice), aliceCan, 'Alice Bot'));
    expect((await NS.getPrincipalName(null, aliceCan))[0][0]).toBe('Alice Bot');
    // dave gives bob a hotkey: bob may rename dave's account
    const dave = user('dave');
    unwrap(await NS.setPrincipalName(ident(dave), 'Dave'));
    unwrap(await NS.addHotkey(ident(dave), bob));
    unwrap(await NS.setPrincipalNameFor(ident(bob), dave, 'Dave B'));
    expect((await NS.getPrincipalName(null, dave))[0][0]).toBe('Dave B');
    expect((await NS.setPrincipalNameFor(ident(carol), dave, 'Hijack')).err).toMatch(/hotkey/);
    // admins may name anyone; verification takes the current name
    unwrap(await NS.setPrincipalNameFor(ident(admin), user('erin'), 'Erin'));
    unwrap(await NS.verifyPrincipalName(ident(admin), user('erin')));
    expect(await NS.getPrincipalName(null, user('erin'))).toEqual([['Erin', true]]);
    unwrap(await NS.unverifyPrincipalName(ident(admin), user('erin')));
    unwrap(await NS.verifyNeuronName(ident(admin), ROOT.toText(), Buffer.from(N1).toString('hex')));
  });
});
