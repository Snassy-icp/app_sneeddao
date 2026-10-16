// sneed_profiles (spec/sneed_names.md §7a), phase 1: the dapp registry the dapp labels of
// sneed_pid_names point at. Registration by a controller of one of the dapp's canisters, unique
// names regardless of capitals, updates that lose the checkmark on a rename, verification by
// admins and Sneed DAO, hiding, paging, search, the ICRC-3 log, the ingress guard and an upgrade.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, user, T, unwrap, errOf, wasm, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { verifyLog, archiveIdl, btype } from '../lib/icrc3.js';
import { idlFactory as profilesIdl } from '../build/sneed_profiles.did.js';

const anon = Principal.anonymous();
let pic, rootKey, appSubnet, profId, tacoCan, tacoCan2, prof;
const P = (p) => actorAs(pic, profilesIdl, profId, p);
const archiveActor = (id) => actorAs(pic, archiveIdl, id, admin);
const dapp = (name, canisters, over = {}) => ({ name, url: 'https://taco.example', logo: [], canisters, ...over });

describe('sneed_profiles: dapp registry', () => {
  beforeAll(async () => {
    ({ pic, rootKey, appSubnet } = await createPic());
    profId = await install(pic, { name: 'sneed_profiles', cycles: 20n * T, targetSubnetId: appSubnet });
    tacoCan = await install(pic, { name: 'MockPremium', controllers: [alice], sender: alice, cycles: 2n * T, targetSubnetId: appSubnet });
    tacoCan2 = await install(pic, { name: 'MockPremium', controllers: [bob], sender: bob, cycles: 2n * T, targetSubnetId: appSubnet });
    prof = P(admin);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('registers dapps by a controller of one of their canisters, names unique', async () => {
    expect(await refusedAtIngress(P(anon).register_dapp(dapp('TACO', [tacoCan])))).toBe(true);
    expect(errOf(await P(bob).register_dapp(dapp('TACO', [tacoCan])))).toMatch(/control at least one/);
    expect(errOf(await P(alice).register_dapp(dapp('TACO', [alice])))).toMatch(/canister ids/);
    expect(errOf(await P(alice).register_dapp(dapp('TACO', [])))).toMatch(/List 1 to 10/);
    expect(errOf(await P(alice).register_dapp(dapp('TACO', [tacoCan], { url: 'http://taco' })))).toMatch(/https/);
    const id = unwrap(await P(alice).register_dapp(dapp('TACO DAO', [tacoCan, tacoCan2])));
    expect(id).toBe(1n);
    expect(errOf(await P(bob).register_dapp(dapp('taco dao', [tacoCan2])))).toMatch(/registered/);
    unwrap(await P(bob).register_dapp(dapp('Bob Swap', [tacoCan2])));
    const [d] = (await prof.get_dapps([1n]))[0];
    expect(d).toMatchObject({ name: 'TACO DAO', verified: false, hidden: false });
    expect(d.registered_by.toText()).toBe(alice.toText());
  });

  it('updates, verifies, hides, pages and searches', async () => {
    unwrap(await prof.verify_dapp(1n, true));
    expect((await prof.get_dapps([1n]))[0][0].verified).toBe(true);
    unwrap(await P(bob).update_dapp(1n, dapp('TACO DAO', [tacoCan2], { url: 'https://taco.new' }))); // bob controls one of them
    expect((await prof.get_dapps([1n]))[0][0].verified).toBe(true); // same name: keeps the checkmark
    unwrap(await P(bob).update_dapp(1n, dapp('TACO Swap', [tacoCan2])));
    expect((await prof.get_dapps([1n]))[0][0].verified).toBe(false); // a new name loses it
    expect(errOf(await P(alice).update_dapp(1n, dapp('Mine', [tacoCan2])))).toMatch(/control at least one/);
    expect(errOf(await P(bob).update_dapp(1n, dapp('bob swap', [tacoCan2])))).toMatch(/registered/);
    expect(await prof.validate_verify_dapp_by_dao(1n, true)).toEqual({ Ok: 'Verify the dapp "TACO Swap" (https://taco.example)' });
    expect(await refusedAtIngress(prof.verify_dapp_by_dao(1n, true))).toBe(true);
    expect((await prof.search_dapps('swap', 10n)).map((d) => d.name)).toEqual(['Bob Swap', 'TACO Swap']);
    unwrap(await prof.admin_hide_dapp(2n, true));
    expect((await prof.search_dapps('swap', 10n)).map((d) => d.name)).toEqual(['TACO Swap']);
    expect((await prof.list_dapps({ start_after: [], limit: 10n })).items.map((d) => d.id)).toEqual([1n]);
    expect((await prof.get_dapps([2n]))[0][0].hidden).toBe(true);
    unwrap(await prof.admin_hide_dapp(2n, false));
    const p1 = await prof.list_dapps({ start_after: [], limit: 1n });
    expect(p1.items.map((d) => d.id)).toEqual([1n]);
    const p2 = await prof.list_dapps({ start_after: p1.next, limit: 1n });
    expect(p2.items.map((d) => d.id)).toEqual([2n]);
    expect(p2.next).toEqual([]);
  });

  it('logs, guards ingress and keeps everything over an upgrade', async () => {
    const { blocks } = await verifyLog(prof, profId, rootKey, archiveActor);
    expect(new Set(blocks.map(btype))).toEqual(new Set(['sneedprofiles_dapp_register', 'sneedprofiles_dapp_update', 'sneedprofiles_dapp_verify']));
    const attacker = actorAs(pic, asUpdates(profilesIdl), profId, bob);
    expect(await refusedAtIngress(attacker.list_dapps({ start_after: [], limit: 1n }))).toBe(true);
    expect(await refusedAtIngress(P(bob).verify_dapp(1n, true))).toBe(true);
    expect(await refusedAtIngress(P(bob).register_dapp(dapp('x'.repeat(10_000), [tacoCan2])))).toBe(true);
    const before = await prof.get_dapps([1n, 2n]);
    await pic.upgradeCanister({ sender: admin, canisterId: profId, wasm: wasm('sneed_profiles'), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    expect(await prof.get_dapps([1n, 2n])).toEqual(before);
    expect((await prof.search_dapps('taco', 5n)).length).toBe(1);
    expect(unwrap(await P(alice).register_dapp(dapp('After', [tacoCan])))).toBe(3n);
  });
});
