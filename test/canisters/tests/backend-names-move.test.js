// The backend's part in moving names to the naming service (spec/sneed_names.md §8, §10): it
// moderates the naming canisters' writes (bans, the word blacklist, banning for public names),
// exports every user's nicknames and avatars to admins, and freezes its own naming writes while
// reads keep answering. Runs the real backend as the moderator of the real sneed_pid_names.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, T, unwrap, errOf, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { idlFactory as hubIdl } from '../build/app_sneeddao_backend.did.js';
import { idlFactory as namesIdl } from '../build/sneed_pid_names.did.js';

const dave = user('dave');
let pic, appSubnet, hubId, namesId, hub, names;
const H = (p) => actorAs(pic, hubIdl, hubId, p);
const N = (p) => actorAs(pic, namesIdl, namesId, p);
const nid = (n) => ({ id: new Uint8Array(32).fill(n) });

describe('backend: moving names to the naming service', () => {
  beforeAll(async () => {
    ({ pic, appSubnet } = await createPic());
    hubId = await install(pic, { name: 'app_sneeddao_backend', cycles: 20n * T, targetSubnetId: appSubnet });
    namesId = await install(pic, { name: 'sneed_pid_names', cycles: 20n * T, targetSubnetId: appSubnet });
    hub = H(admin); names = N(admin);
    unwrap(await names.admin_set_config({ ...(await names.get_config()), moderator: [hubId] }));
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('moderates only for the naming canisters it was told about', async () => {
    expect(await refusedAtIngress(H(alice).names_moderate({ user: alice, text: 'x', is_public: true }))).toBe(true);
    expect(errOf(await N(alice).set_my_name('Alice'))).toMatch(/unavailable.*naming service/);
    expect(await refusedAtIngress(H(alice).admin_set_names_canisters([namesId]))).toBe(true);
    unwrap(await hub.admin_set_names_canisters([namesId]));
    expect((await hub.get_names_canisters()).map(String)).toEqual([namesId.toText()]);
    unwrap(await N(alice).set_my_name('Alice'));
  });

  it('bans for a blacklisted public name, as the backend does for its own names', async () => {
    unwrap(await hub.add_blacklisted_word('badword'));
    expect(errOf(await N(dave).set_my_name('My Badword'))).toMatch(/inappropriate content. You have been banned/);
    expect(errOf(await hub.check_ban_status(dave))).toMatch(/You are banned/);
    expect(errOf(await N(dave).set_my_name('Innocent'))).toMatch(/You are banned. Ban expires in/);
    expect((await names.get_name(dave))).toEqual([]);
  });

  it('exports every user\'s nicknames and avatars to admins', async () => {
    unwrap(await H(alice).set_principal_nickname(bob, 'Bobby'));
    unwrap(await H(alice).set_principal_nickname(carol, 'Caro'));
    unwrap(await H(bob).set_principal_nickname(alice, 'Ally'));
    unwrap(await H(carol).set_my_avatar('https://example.com/c.png'));
    const all = await hub.admin_export_principal_nicknames(0n, 1000n);
    expect(all.total).toBe(3n);
    expect(all.items.map(([o, t, n]) => `${o.toText()}>${t.toText()}=${n}`).sort()).toEqual([
      `${alice.toText()}>${bob.toText()}=Bobby`, `${alice.toText()}>${carol.toText()}=Caro`, `${bob.toText()}>${alice.toText()}=Ally`,
    ].sort());
    const p1 = await hub.admin_export_principal_nicknames(0n, 2n);
    const p2 = await hub.admin_export_principal_nicknames(2n, 2n);
    expect(p1.items.length + p2.items.length).toBe(3);
    expect((await hub.admin_export_neuron_nicknames(0n, 10n)).total).toBe(0n);
    expect((await hub.admin_export_avatars(0n, 10n)).items).toEqual([[carol, 'https://example.com/c.png']]);
    await expect(H(alice).admin_export_principal_nicknames(0n, 10n)).rejects.toThrow(/Not authorized/);
    const attacker = actorAs(pic, asUpdates(hubIdl), hubId, admin);
    expect(await refusedAtIngress(attacker.admin_export_avatars(0n, 10n))).toBe(true);
  });

  it('freezes its naming writes while reads keep answering', async () => {
    unwrap(await H(alice).set_principal_name('alice'));
    expect(await refusedAtIngress(H(bob).admin_set_names_frozen(true))).toBe(true);
    unwrap(await hub.admin_set_names_frozen(true));
    expect(await hub.get_names_frozen()).toBe(true);
    const moving = /moving to the new naming service/;
    expect(errOf(await H(alice).set_principal_name('alice2'))).toMatch(moving);
    expect(errOf(await H(alice).set_principal_nickname(bob, 'B'))).toMatch(moving);
    expect(errOf(await H(alice).set_neuron_nickname(alice, nid(1), 'N'))).toMatch(moving);
    expect(errOf(await H(alice).set_neuron_name(alice, nid(1), 'N'))).toMatch(moving);
    expect(errOf(await H(alice).set_canister_name(hubId, 'Hub'))).toMatch(moving);
    expect(errOf(await H(carol).set_my_avatar('https://example.com/d.png'))).toMatch(moving);
    expect(errOf(await H(carol).clear_my_avatar())).toMatch(moving);
    expect(errOf(await hub.verify_principal_name(alice))).toMatch(moving);
    expect(errOf(await hub.admin_clear_avatar(carol))).toMatch(moving);
    expect(await hub.get_principal_name(alice)).toEqual([['alice', false]]);
    expect((await H(alice).get_all_principal_nicknames()).length).toBe(2);
    unwrap(await hub.admin_set_names_frozen(false));
    unwrap(await H(alice).set_principal_name('alice2'));
  });
});
