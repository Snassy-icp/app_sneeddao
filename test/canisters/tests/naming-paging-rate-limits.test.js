// spec/paging_audit.md S14 and per-caller rate limits in the naming service:
// - sneed_pid_names: hotkeys need no consent (spec/sneed_names.md §4), so anyone can add any
//   principal as a hotkey of their own account. A stranger adding a victim from 1000 accounts
//   must not break the victim's list (AccountPanel): my_hotkey_accounts is capped at 100,
//   my_hotkey_accounts_page pages them with a total, and the victim removes itself from one
//   (remove_hotkey) or all of them (leave_hotkey_accounts). add_hotkey then merge_account still
//   works in one go.
// - name, nickname, avatar, hotkey, dapp writes in the six naming canisters are rate limited per
//   caller (src/RateLimit.mo, admin-settable rules): a spammer is refused, a normal user is not.
// - upgrades with keep from production's build (#441, 2a989d5d, module 6653ee81…) and HEAD's keep
//   the existing hotkeys and data.
// Fails on the builds before the fix: NAMING_WASM_SUFFIX=_prepaging npx vitest run tests/naming-paging-rate-limits.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, user, T, unwrap, errOf, wasm, refusedAtIngress } from '../lib/pic.js';
import { idlFactory as pidNamesIdl } from '../build/sneed_pid_names.did.js';
import { idlFactory as neuronNamesIdl } from '../build/sneed_neuron_names.did.js';
import { idlFactory as pidNicksIdl } from '../build/sneed_pid_nicknames.did.js';
import { idlFactory as neuronNicksIdl } from '../build/sneed_neuron_nicknames.did.js';
import { idlFactory as avatarsIdl } from '../build/sneed_avatars.did.js';
import { idlFactory as profilesIdl } from '../build/sneed_profiles.did.js';

const SUFFIX = process.env.NAMING_WASM_SUFFIX || '';
const W = (name) => `${name}${SUFFIX}`;
const KEEP = { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] };
const INGRESS_REFUSED = /canister_inspect_message .*refused/;

/// Calls fn n times; counts the calls refused by a rate limit (an answer saying so, or the
/// ingress guard) and the others.
async function spam(n, fn) {
  let passed = 0, refused = 0;
  for (let i = 0; i < n; i++) {
    try {
      const r = await fn(i);
      if (r && typeof r === 'object' && 'err' in r && /Rate limited/.test(r.err)) refused++;
      else passed++;
    } catch (e) {
      if (INGRESS_REFUSED.test(String(e?.message || e))) refused++;
      else passed++; // reached the method and failed for another reason

    }
  }
  return { passed, refused };
}

const png = (n = 500) => Uint8Array.from(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(n)]));

let pic, appSubnet;
afterAll(async () => { await pic?.tearDown(); });
beforeAll(async () => { ({ pic, appSubnet } = await createPic()); }, 180_000);

describe('sneed_pid_names: hotkey paging, leaving and rate limits', () => {
  let namesId, names, as;
  beforeAll(async () => {
    namesId = await install(pic, { name: W('sneed_pid_names'), cycles: 20n * T, targetSubnetId: appSubnet });
    names = actorAs(pic, pidNamesIdl, namesId, admin);
    as = (p) => actorAs(pic, pidNamesIdl, namesId, p);
  }, 180_000);

  it('a stranger adding a victim as hotkey from 1000 accounts does not break its list; it removes itself', async () => {
    const victim = user('hk-victim');
    const strangers = Array.from({ length: 1000 }, (_, i) => user(`hk-stranger-${i}`));
    for (let i = 0; i < strangers.length; i += 50) {
      const rs = await Promise.all(strangers.slice(i, i + 50).map((s) => as(s).add_hotkey(victim)));
      for (const r of rs) unwrap(r); // each makes a one-principal account
    }
    // the old reply is capped; before the fix it carried all 1000 accounts
    expect((await as(victim).my_hotkey_accounts()).length).toBe(100);
    // AccountPanel pages them
    const p1 = await as(victim).my_hotkey_accounts_page({ start_after: [], limit: 50n });
    expect(p1.items.length).toBe(50);
    expect(p1.total).toBe(1000n);
    const p2 = await as(victim).my_hotkey_accounts_page({ start_after: p1.next, limit: 500n }); // limit capped at 50
    expect(p2.items.length).toBe(50);
    expect(p2.items[0].id > p1.items[49].id).toBe(true);
    // the victim removes itself from one account, then from all (500 a call)
    const one = p1.items[0].id;
    unwrap(await as(victim).remove_hotkey(one, victim));
    expect(await names.get_account(one)).toEqual([]); // nothing left to show: collected
    expect(unwrap(await as(victim).leave_hotkey_accounts())).toBe('Left 500 accounts; 499 left, call again');
    expect(unwrap(await as(victim).leave_hotkey_accounts())).toBe('Left 499 accounts');
    expect(await as(victim).my_hotkey_accounts()).toEqual([]);
    expect((await as(victim).my_hotkey_accounts_page({ start_after: [], limit: 50n })).total).toBe(0n);
    expect(unwrap(await as(victim).leave_hotkey_accounts())).toBe('Left 0 accounts');
  }, 600_000);

  it('add_hotkey then merge_account works in one go, as before (nothing to accept)', async () => {
    const main = user('hk-main'), taco = user('hk-main-on-taco');
    unwrap(await as(taco).set_my_name('Main on TACO'));
    expect(unwrap(await as(taco).add_hotkey(main))).toBe('Hotkey added');
    const acc = (await names.get_account_of(taco))[0].id;
    expect((await as(main).my_hotkey_accounts_page({ start_after: [], limit: 10n })).items.map((a) => a.id)).toEqual([acc]);
    unwrap(await as(main).set_account_name(acc, 'Main T')); // manages it at once
    unwrap(await as(main).merge_account(acc));
    expect((await names.get_name(taco))[0].name).toEqual(['Main T']); // main had no name: it takes this one
    expect((await as(main).my_hotkey_accounts_page({ start_after: [], limit: 10n })).total).toBe(0n);
    // max_hotkeys per account as before
    const o = user('hk-owner');
    for (let i = 0; i < 10; i++) unwrap(await as(o).add_hotkey(user(`hk-o-${i}`)));
    expect(errOf(await as(o).add_hotkey(user('hk-o-10')))).toMatch(/At most 10 hotkeys/);
  });

  it('rate limits writes per caller: a spammer is refused, a normal user is not', async () => {
    const rules = Object.fromEntries(await names.get_rate_limits());
    expect(Object.keys(rules).sort()).toEqual(['account', 'avatar', 'hotkey', 'name']);
    for (const r of Object.values(rules)) expect(r.capacity).toBeGreaterThanOrEqual(20n); // generous
    const spammer = user('rl-spammer');
    const { passed, refused } = await spam(40, (i) => as(spammer).set_my_name(`Spam ${i}`));
    expect(passed).toBeLessThanOrEqual(Number(rules.name.capacity) + 1);
    expect(refused).toBeGreaterThan(0);
    expect(await refusedAtIngress(as(spammer).set_my_name('Spam again'))).toBe(true);
    // others are not affected, nor are other actions of the spammer
    const normal = user('rl-normal');
    for (const n of ['Norma', 'Norma J', 'Norma Jean']) unwrap(await as(normal).set_my_name(n));
    unwrap(await as(spammer).set_my_avatar([{ url: 'https://example.com/s.png' }]));
    // admins set the rules (capacity 0 lifts a limit) and are not limited themselves
    expect(await refusedAtIngress(as(bob).admin_set_rate_limit('name', [{ capacity: 0n, per_minute: 0n }]))).toBe(true);
    expect(errOf(await names.admin_set_rate_limit('nope', []))).toMatch(/Unknown action/);
    unwrap(await names.admin_set_rate_limit('name', [{ capacity: 0n, per_minute: 0n }]));
    unwrap(await as(spammer).set_my_name('Spam lifted'));
    unwrap(await names.admin_set_rate_limit('name', []));
    expect(Object.fromEntries(await names.get_rate_limits()).name).toEqual(rules.name);
    expect((await spam(40, (i) => names.set_my_name(`Admin ${i}`))).refused).toBe(0);
  });

  it('upgrades with keep from production (#441) and from HEAD, keeping hotkeys', async () => {
    for (const base of ['sneed_pid_names_441', 'sneed_pid_names_prepaging']) {
      const id = await install(pic, { name: base, cycles: 20n * T, targetSubnetId: appSubnet });
      const c = (p) => actorAs(pic, pidNamesIdl, id, p);
      const owner = user(`upg-owner-${base}`), hk = user(`upg-hk-${base}`);
      unwrap(await c(owner).set_my_name(`Upg ${base.length}`));
      unwrap(await c(owner).add_hotkey(hk));
      const acc = (await c(owner).get_account_of(owner))[0].id;
      await pic.advanceTime(10 * 60_000); await pic.tick(2); // past the install_code instruction limit
      await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(W('sneed_pid_names')), upgradeModeOptions: KEEP });
      expect((await c(hk).my_hotkey_accounts()).map((a) => a.id)).toEqual([acc]);
      const page = await c(hk).my_hotkey_accounts_page({ start_after: [], limit: 10n });
      expect(page.total).toBe(1n);
      unwrap(await c(hk).set_account_name(acc, `Renamed ${base.length}`));
      expect((await c(owner).get_name(owner))[0].name).toEqual([`Renamed ${base.length}`]);
      expect((await c(owner).get_rate_limits()).length).toBe(4);
      unwrap(await c(hk).leave_hotkey_accounts());
      expect(await c(hk).my_hotkey_accounts()).toEqual([]);
    }
  });
});

describe('the other naming canisters: rate limits and upgrades', () => {
  const C = {};
  const root = Principal.fromText('aaaaa-aa');
  const key = (n) => ({ sns_root: root, neuron_id: Uint8Array.from([n]) });
  beforeAll(async () => {
    for (const [name, idl] of [['sneed_neuron_names', neuronNamesIdl], ['sneed_pid_nicknames', pidNicksIdl], ['sneed_neuron_nicknames', neuronNicksIdl], ['sneed_avatars', avatarsIdl], ['sneed_profiles', profilesIdl]]) {
      const id = await install(pic, { name: W(name), cycles: 20n * T, targetSubnetId: appSubnet });
      C[name] = { id, idl, as: (p) => actorAs(pic, idl, id, p) };
    }
  }, 180_000);

  const CASES = [
    ['sneed_neuron_names', ['avatar', 'name'], 'name', (a, i) => a.set_name(key(i % 5), `Neuron ${i}`)],
    ['sneed_pid_nicknames', ['nickname', 'pocket'], 'nickname', (a, i) => a.set_nickname(user(`nick-target-${i % 5}`), `Nick ${i}`)],
    ['sneed_neuron_nicknames', ['nickname'], 'nickname', (a, i) => a.set_nickname(key(i % 5), `Nick ${i}`)],
    ['sneed_avatars', ['release', 'upload'], 'upload', (a) => a.upload(png())],
    ['sneed_profiles', ['dapp'], 'dapp', (a, i) => a.register_dapp({ name: `Spam Dapp ${i}`, url: 'https://spam.example', logo: [], canisters: [alice] })],
  ];

  for (const [name, actions, action, call] of CASES) {
    it(`${name}: a spammer is refused, a normal user is not`, async () => {
      const { as } = C[name];
      const rules = Object.fromEntries(await as(admin).get_rate_limits());
      expect(Object.keys(rules).sort()).toEqual(actions);
      for (const r of Object.values(rules)) expect(r.capacity).toBeGreaterThanOrEqual(20n); // generous
      // a tight rule so the test stays short (the defaults behave the same, only later)
      unwrap(await as(admin).admin_set_rate_limit(action, [{ capacity: 5n, per_minute: 1n }]));
      const spammer = user(`spammer-${name}`), normal = user(`normal-${name}`);
      const s = await spam(9, (i) => call(as(spammer), i));
      expect(s.passed).toBeLessThanOrEqual(6);
      expect(s.refused).toBeGreaterThanOrEqual(3);
      expect((await spam(3, (i) => call(as(normal), i + 100))).refused).toBe(0);
      expect(await refusedAtIngress(as(bob).admin_set_rate_limit(action, []))).toBe(true);
      unwrap(await as(admin).admin_set_rate_limit(action, []));
      expect(Object.fromEntries(await as(admin).get_rate_limits())[action]).toEqual(rules[action]);
    });
  }

  it('upgrades each with keep from HEAD (what production runs), keeping its data', async () => {
    for (const [name, idl] of [['sneed_neuron_names', neuronNamesIdl], ['sneed_pid_nicknames', pidNicksIdl], ['sneed_neuron_nicknames', neuronNicksIdl], ['sneed_avatars', avatarsIdl], ['sneed_profiles', profilesIdl]]) {
      const id = await install(pic, { name: `${name}_prepaging`, cycles: 20n * T, targetSubnetId: appSubnet });
      const c = (p) => actorAs(pic, idl, id, p);
      const before = await c(admin).stats();
      if (name === 'sneed_pid_nicknames') unwrap(await c(alice).set_nickname(bob, 'Bobby'));
      if (name === 'sneed_avatars') unwrap(await c(alice).upload(png()));
      await pic.advanceTime(10 * 60_000); await pic.tick(2); // past the install_code instruction limit
      await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(W(name)), upgradeModeOptions: KEEP });
      if (name === 'sneed_pid_nicknames') expect((await c(alice).get_my_nicknames({ start_after: [], limit: 10n })).items.map((n) => n.nickname)).toEqual(['Bobby']);
      if (name === 'sneed_avatars') expect((await c(alice).my_images()).length).toBe(1);
      if (!['sneed_pid_nicknames', 'sneed_avatars'].includes(name)) expect(await c(admin).stats()).toEqual(before);
      expect((await c(admin).get_rate_limits()).length).toBeGreaterThan(0);
    }
  });
});
