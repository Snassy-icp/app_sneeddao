// app_sneeddao_backend (the Sneed Hub backend): the public naming layer.
// Principal names (own, by admins, by neuron owners through an SNS root),
// canister names by controllers, private nicknames and their premium limits,
// neuron names with per-SNS uniqueness and verification by admins or the SNS
// governance canister, the word blacklist with its escalating automatic bans,
// manual bans, avatars, and an upgrade that keeps all of it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, SNEED_SNS_ROOT, T, unwrap, errOf, wasm, nowNs } from '../lib/pic.js';
import { premiumIdl } from '../lib/idl.js';
import { hubSnsIdl, ser, sorted, upgradeHub } from '../lib/hub.js';
import { idlFactory as hubIdl } from '../build/app_sneeddao_backend.did.js';

const dave = user('dave'); // the one who gets banned
const anon = Principal.anonymous();
const nid = (n) => ({ id: new Uint8Array(32).fill(n) });
const N1 = nid(1); const N2 = nid(2); const N3 = nid(3);
const HOUR = 3600;
const H_NS = 3_600_000_000_000n;
const ALL = [1, 2, 3, 4]; const HOTKEY = [3, 4];
const perm = (p, types) => ({ principal: [p], permission_type: types });
// N1: alice's, carol a hotkey; N2: bob's; N3: carol's
const neurons = () => [
  { id: N1.id, permissions: [perm(alice, ALL), perm(carol, HOTKEY)] },
  { id: N2.id, permissions: [perm(bob, ALL)] },
  { id: N3.id, permissions: [perm(carol, ALL)] },
];
const isOk = (r) => 'ok' in r;

let pic, appSubnet, hubId, snsId, sns2Id, sneedSnsId, premiumId, aliceCanId;
let hub, hubAlice, hubBob, hubCarol, hubDave, hubAnon, sns, sns2, sneedSns, premium;
const advance = async (seconds) => { await pic.advanceTime(seconds * 1000); await pic.tick(2); };

describe('app_sneeddao_backend names', () => {
  beforeAll(async () => {
    ({ pic, appSubnet } = await createPic());
    hubId = await install(pic, { name: 'app_sneeddao_backend', cycles: 20n * T, targetSubnetId: appSubnet });
    snsId = await install(pic, { name: 'MockHubSns', targetSubnetId: appSubnet });
    sns2Id = await install(pic, { name: 'MockHubSns', targetSubnetId: appSubnet });
    sneedSnsId = await install(pic, { name: 'MockHubSns', targetCanisterId: SNEED_SNS_ROOT }); // get_user_neurons has the Sneed root hard-coded
    premiumId = await install(pic, { name: 'MockPremium', targetSubnetId: appSubnet });
    aliceCanId = await install(pic, { name: 'MockPremium', controllers: [alice], sender: alice, cycles: 2n * T, targetSubnetId: appSubnet });
    hub = actorAs(pic, hubIdl, hubId, admin);
    hubAlice = actorAs(pic, hubIdl, hubId, alice); hubBob = actorAs(pic, hubIdl, hubId, bob); hubCarol = actorAs(pic, hubIdl, hubId, carol);
    hubDave = actorAs(pic, hubIdl, hubId, dave); hubAnon = actorAs(pic, hubIdl, hubId, anon);
    sns = actorAs(pic, hubSnsIdl, snsId, admin); sns2 = actorAs(pic, hubSnsIdl, sns2Id, admin); sneedSns = actorAs(pic, hubSnsIdl, sneedSnsId, admin);
    premium = actorAs(pic, premiumIdl, premiumId, admin);
    await sns.set_neurons(neurons()); await sns2.set_neurons(neurons());
    await pic.tick(2);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('sets, validates, lists and removes principal names', async () => {
    expect(errOf(await hubAnon.set_principal_name('anon'))).toMatch(/Anonymous/);
    expect(await hub.get_principal_name(alice)).toEqual([]);
    expect(unwrap(await hubAlice.set_principal_name("Alice W. O'Neil-1_x"))).toMatch(/set principal name/);
    expect(await hub.get_principal_name(alice)).toEqual([["Alice W. O'Neil-1_x", false]]);
    expect(errOf(await hubAlice.set_principal_name('a'.repeat(33)))).toMatch(/1-32 characters/);
    unwrap(await hubAlice.set_principal_name('a'.repeat(32)));
    for (const bad of ['al@ce', 'al/ce', 'ålice', 'al,ce', 'al#ce', 'a\tb']) expect(errOf(await hubAlice.set_principal_name(bad))).toMatch(/1-32 characters/);
    // one name per principal, one principal per name
    unwrap(await hubAlice.set_principal_name('alice'));
    expect(errOf(await hubBob.set_principal_name('alice'))).toMatch(/already taken/);
    unwrap(await hubAlice.set_principal_name('alice')); // one's own name again is fine
    unwrap(await hubBob.set_principal_name('Alice')); // uniqueness is case-sensitive (current behaviour)
    unwrap(await hubBob.set_principal_name('bob'));
    const all = await hub.get_all_principal_names();
    expect(Object.fromEntries(all.map(([p, [n]]) => [p.toText(), n]))).toEqual({ [alice.toText()]: 'alice', [bob.toText()]: 'bob' });
    // the empty name removes
    expect(unwrap(await hubBob.set_principal_name(''))).toMatch(/removed/);
    expect(await hub.get_principal_name(bob)).toEqual([]);
    expect(unwrap(await hubBob.set_principal_name(''))).toMatch(/removed/); // idempotent
    unwrap(await hubBob.set_principal_name('bob'));
    expect(await hubAnon.get_principal_name(bob)).toEqual([['bob', false]]); // public query
  });

  it('verifies names (admins only) and keeps the flag through a rename', async () => {
    expect(errOf(await hubBob.verify_principal_name(alice))).toMatch(/not authorized/);
    expect(errOf(await hub.verify_principal_name(carol))).toMatch(/No name found/);
    unwrap(await hub.verify_principal_name(alice));
    expect(await hub.get_principal_name(alice)).toEqual([['alice', true]]);
    unwrap(await hubAlice.set_principal_name('alice2'));
    expect(await hub.get_principal_name(alice)).toEqual([['alice2', true]]);
    expect(errOf(await hubBob.unverify_principal_name(alice))).toMatch(/not authorized/);
    unwrap(await hub.unverify_principal_name(alice));
    expect(await hub.get_principal_name(alice)).toEqual([['alice2', false]]);
    expect(errOf(await hub.unverify_principal_name(carol))).toMatch(/No name found/);
    unwrap(await hubAlice.set_principal_name('alice'));
    unwrap(await hub.verify_principal_name(alice));
  });

  it('set_principal_name_for: oneself, admins, and the hotkeys of a neuron the principal owns', async () => {
    expect(errOf(await hubAnon.set_principal_name_for(alice, 'x', []))).toMatch(/Anonymous/);
    unwrap(await hubAlice.set_principal_name_for(alice, 'alice', []));
    expect(errOf(await hubBob.set_principal_name_for(alice, 'mallory', []))).toMatch(/not authorized/);
    expect(errOf(await hubBob.set_principal_name_for(alice, 'mallory', [snsId]))).toMatch(/not authorized/); // bob's neuron is his own
    expect(errOf(await hubCarol.set_principal_name_for(alice, 'x', [bob]))).toMatch(/not authorized/); // not an SNS root at all
    // carol is a hotkey of N1, whose owner (most permissions) is alice
    unwrap(await hubCarol.set_principal_name_for(alice, 'alice by carol', [snsId]));
    expect(await hub.get_principal_name(alice)).toEqual([['alice by carol', true]]);
    expect(errOf(await hubCarol.set_principal_name_for(bob, 'x', [snsId]))).toMatch(/not authorized/);
    // the ownership check comes first: a non-owner's bad name is refused, not validated
    expect(errOf(await hubBob.set_principal_name_for(alice, 'a'.repeat(40), [snsId]))).toMatch(/not authorized/);
    expect(errOf(await hubCarol.set_principal_name_for(alice, 'a'.repeat(40), [snsId]))).toMatch(/1-32/);
    // admins name anyone
    unwrap(await hub.set_principal_name_for(bob, 'bob by admin', []));
    expect(await hub.get_principal_name(bob)).toEqual([['bob by admin', false]]);
    unwrap(await hubAlice.set_principal_name('alice'));
    unwrap(await hubBob.set_principal_name('bob'));
  });

  it('canister names: set by a controller, validated, in the same namespace as principal names', async () => {
    expect(errOf(await hubAnon.set_canister_name(aliceCanId, 'xx'))).toMatch(/Anonymous/);
    expect(errOf(await hubBob.set_canister_name(aliceCanId, 'my canister'))).toMatch(/not a controller/);
    expect(errOf(await hubAlice.set_canister_name(aliceCanId, 'a'))).toMatch(/at least 2/);
    expect(errOf(await hubAlice.set_canister_name(aliceCanId, 'a'.repeat(33)))).toMatch(/at most 32/);
    expect(errOf(await hubAlice.set_canister_name(aliceCanId, '-- --'))).toMatch(/alphanumeric/);
    expect(errOf(await hubAlice.set_canister_name(aliceCanId, 'alice'))).toMatch(/already taken/);
    unwrap(await hubAlice.set_canister_name(aliceCanId, 'Alice Canister'));
    expect(await hub.get_principal_name(aliceCanId)).toEqual([['Alice Canister', false]]);
    expect(errOf(await hubBob.set_principal_name('Alice Canister'))).toMatch(/already taken/);
    unwrap(await hubAlice.set_canister_name(aliceCanId, 'Alice Canister')); // same name again
    // canister names allow what principal names do not (only the length and one alphanumeric are checked)
    unwrap(await hubAlice.set_canister_name(aliceCanId, 'Alice/Canister #1 (prod)'));
    expect(errOf(await hubAlice.set_canister_name(Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai'), 'ghost'))).toMatch(/Failed to verify canister controllers/);
    // admins verify canister names like any other
    unwrap(await hub.verify_principal_name(aliceCanId));
    expect(await hub.get_principal_name(aliceCanId)).toEqual([['Alice/Canister #1 (prod)', true]]);
    expect(unwrap(await hubAlice.set_canister_name(aliceCanId, ''))).toMatch(/removed/);
    expect(await hub.get_principal_name(aliceCanId)).toEqual([]);
    unwrap(await hubAlice.set_canister_name(aliceCanId, 'Alice Canister'));
  });

  it('principal nicknames are private to their author and capped at ten', async () => {
    expect(errOf(await hubAnon.set_principal_nickname(bob, 'x'))).toMatch(/Anonymous/);
    unwrap(await hubAlice.set_principal_nickname(bob, 'Bobby'));
    expect(await hubAlice.get_principal_nickname(bob)).toEqual(['Bobby']);
    expect(await hubBob.get_principal_nickname(bob)).toEqual([]);
    expect(await hubCarol.get_all_principal_nicknames()).toEqual([]);
    expect((await hubAlice.get_all_principal_nicknames()).map(([p, n]) => [p.toText(), n])).toEqual([[bob.toText(), 'Bobby']]);
    expect(await hub.get_principal_name(bob)).toEqual([['bob', false]]); // the public name is untouched
    expect(errOf(await hubAlice.set_principal_nickname(bob, 'Bob!'))).toMatch(/1-32 characters/);
    expect(errOf(await hubAlice.set_principal_nickname(bob, 'b'.repeat(33)))).toMatch(/1-32 characters/);
    for (let i = 0; i < 9; i++) unwrap(await hubAlice.set_principal_nickname(user(`nick${i}`), `n${i}`));
    expect(errOf(await hubAlice.set_principal_nickname(user('nick9'), 'n9'))).toMatch(/maximum number of principal nicknames \(10\)/);
    unwrap(await hubAlice.set_principal_nickname(bob, 'Bobby2')); // changing one at the limit is fine
    expect(unwrap(await hubAlice.set_principal_nickname(user('nick0'), ''))).toMatch(/removed/);
    expect(await hubAlice.get_principal_nickname(user('nick0'))).toEqual([]);
    unwrap(await hubAlice.set_principal_nickname(user('nick9'), 'n9'));
    expect(await hubAlice.get_my_nickname_usage()).toEqual({ principal_nickname_count: 10n, principal_nickname_limit: 10n, neuron_nickname_count: 0n, neuron_nickname_limit: 10n, is_premium: false });
  });

  it('premium members get the premium nickname limits', async () => {
    expect(errOf(await hubAlice.set_nickname_premium_canister([premiumId]))).toMatch(/Not authorized/);
    expect(errOf(await hubAlice.update_nickname_limits([], [], [], []))).toMatch(/Not authorized/);
    expect(await hub.get_nickname_limits_config()).toEqual({ sneed_premium_canister_id: [], max_neuron_nicknames: 10n, max_principal_nicknames: 10n, premium_max_neuron_nicknames: 100n, premium_max_principal_nicknames: 100n });
    unwrap(await hub.set_nickname_premium_canister([premiumId]));
    unwrap(await hub.update_nickname_limits([], [], [], [12n]));
    const cfg = await hub.get_nickname_limits_config();
    expect(cfg.sneed_premium_canister_id[0].toText()).toBe(premiumId.toText());
    expect(cfg.premium_max_principal_nicknames).toBe(12n);
    expect(errOf(await hubAlice.set_principal_nickname(user('nick10'), 'n10'))).toMatch(/\(10\)/);
    await premium.set_member(alice, (await nowNs(pic)) + 365n * 24n * H_NS);
    expect(await hubAlice.get_my_nickname_usage()).toMatchObject({ is_premium: true, principal_nickname_limit: 12n, neuron_nickname_limit: 100n });
    unwrap(await hubAlice.set_principal_nickname(user('nick10'), 'n10'));
    unwrap(await hubAlice.set_principal_nickname(user('nick11'), 'n11'));
    expect(errOf(await hubAlice.set_principal_nickname(user('nick12'), 'n12'))).toMatch(/\(12\)/);
    expect((await hubBob.get_my_nickname_usage()).is_premium).toBe(false);
  });

  it('neuron names: owners only, unique per SNS, verified by admins or that SNS\'s governance canister', async () => {
    expect(errOf(await hubAnon.set_neuron_name(snsId, N1, 'xx'))).toMatch(/Anonymous/);
    expect(errOf(await hubBob.set_neuron_name(snsId, N1, 'Alice Neuron'))).toMatch(/not authorized to name/);
    expect(errOf(await hubAlice.set_neuron_name(snsId, N1, 'bad!name'))).toMatch(/1-32 characters/);
    expect(errOf(await hubAlice.set_neuron_name(user('not-a-root'), N1, 'Alice Neuron'))).toMatch(/Failed to verify neuron ownership/);
    unwrap(await hubAlice.set_neuron_name(snsId, N1, 'Alice Neuron'));
    expect(await hub.get_neuron_name(snsId, N1)).toEqual([['Alice Neuron', false]]);
    expect(await hub.get_neuron_name(sns2Id, N1)).toEqual([]);
    expect(errOf(await hubBob.set_neuron_name(snsId, N2, 'Alice Neuron'))).toMatch(/already taken by another neuron/);
    unwrap(await hubBob.set_neuron_name(sns2Id, N2, 'Alice Neuron')); // another SNS is another namespace
    unwrap(await hubBob.set_neuron_name(snsId, N2, 'Bob Neuron'));
    unwrap(await hubAlice.set_neuron_name(snsId, N1, 'Alice Neuron')); // same name on the same neuron
    unwrap(await hub.set_neuron_name(snsId, N3, 'Carol Neuron by admin')); // admins may name any neuron
    // any principal the governance lists the neuron for may name it: a hotkey too
    unwrap(await hubCarol.set_neuron_name(snsId, N1, 'Hotkey'));
    expect(await hub.get_neuron_name(snsId, N1)).toEqual([['Hotkey', false]]);
    unwrap(await hubAlice.set_neuron_name(snsId, N1, 'Alice Neuron'));
    expect(sorted((await hub.get_all_neuron_names()).map(([k, [n, v]]) => [k.sns_root_canister_id.toText(), k.neuron_id.id[0], n, v]))).toEqual(sorted([
      [snsId.toText(), 1, 'Alice Neuron', false], [snsId.toText(), 2, 'Bob Neuron', false], [snsId.toText(), 3, 'Carol Neuron by admin', false], [sns2Id.toText(), 2, 'Alice Neuron', false],
    ]));
    // verification
    expect(errOf(await hubBob.verify_neuron_name(snsId, N1))).toMatch(/not authorized to verify/);
    expect(errOf(await hubBob.verify_neuron_name(user('not-a-root'), N1))).toMatch(/Failed to verify name/);
    expect(errOf(await hub.verify_neuron_name(snsId, nid(9)))).toMatch(/No name found/);
    unwrap(await hub.verify_neuron_name(snsId, N1));
    expect(await hub.get_neuron_name(snsId, N1)).toEqual([['Alice Neuron', true]]);
    unwrap(await hubAlice.set_neuron_name(snsId, N1, 'Alice Neuron 2')); // keeps the flag
    expect(await hub.get_neuron_name(snsId, N1)).toEqual([['Alice Neuron 2', true]]);
    // the governance canister of that root (the mock calls the backend itself)
    expect(unwrap(await sns.call_unverify_neuron_name(hubId, snsId, N1))).toMatch(/unverified/);
    expect(await hub.get_neuron_name(snsId, N1)).toEqual([['Alice Neuron 2', false]]);
    expect(unwrap(await sns.call_verify_neuron_name(hubId, snsId, N1))).toMatch(/verified/);
    expect(errOf(await sns2.call_verify_neuron_name(hubId, snsId, N1))).toMatch(/not authorized/); // another SNS's governance
    await sns.set_governance([bob]); // the root now names bob as its governance
    expect(errOf(await sns.call_verify_neuron_name(hubId, snsId, N1))).toMatch(/not authorized/);
    expect(errOf(await hubBob.unverify_neuron_name(snsId, nid(9)))).toMatch(/No name found/);
    unwrap(await hubBob.unverify_neuron_name(snsId, N1));
    await sns.set_governance([]);
    expect(await hub.get_neuron_name(snsId, N1)).toEqual([['Alice Neuron 2', false]]);
    unwrap(await hub.verify_neuron_name(snsId, N1));
    // the empty name removes
    expect(unwrap(await hubBob.set_neuron_name(sns2Id, N2, ''))).toMatch(/removed/);
    expect(await hub.get_neuron_name(sns2Id, N2)).toEqual([]);
  });

  it('neuron nicknames are private per user and capped', async () => {
    expect(errOf(await hubAnon.set_neuron_nickname(snsId, N1, 'x'))).toMatch(/Anonymous/);
    unwrap(await hubBob.set_neuron_nickname(snsId, N1, 'the big one'));
    expect(await hubBob.get_neuron_nickname(snsId, N1)).toEqual(['the big one']);
    expect(await hubAlice.get_neuron_nickname(snsId, N1)).toEqual([]);
    expect(await hubBob.get_neuron_nickname(sns2Id, N1)).toEqual([]);
    const all = await hubBob.get_all_neuron_nicknames();
    expect(all).toHaveLength(1);
    expect(all[0][0].sns_root_canister_id.toText()).toBe(snsId.toText());
    expect(Array.from(all[0][0].neuron_id.id)).toEqual(Array.from(N1.id));
    expect(all[0][1]).toBe('the big one');
    expect(errOf(await hubBob.set_neuron_nickname(snsId, N1, 'bad!'))).toMatch(/1-32/);
    for (let i = 1; i <= 9; i++) unwrap(await hubBob.set_neuron_nickname(snsId, nid(10 + i), `n${i}`));
    expect(errOf(await hubBob.set_neuron_nickname(snsId, nid(30), 'one more'))).toMatch(/maximum number of neuron nicknames \(10\)/);
    unwrap(await hubBob.set_neuron_nickname(snsId, N1, 'renamed at the limit'));
    expect(unwrap(await hubBob.set_neuron_nickname(snsId, nid(19), ''))).toMatch(/removed/);
    expect((await hubBob.get_my_nickname_usage()).neuron_nickname_count).toBe(9n);
    unwrap(await hubBob.set_neuron_nickname(snsId, nid(30), 'one more'));
  });

  it('the word blacklist: nicknames pass, a public name gets the user banned, longer each time', async () => {
    expect(errOf(await hubAlice.add_blacklisted_word('rude'))).toMatch(/Not authorized/);
    unwrap(await hub.add_blacklisted_word('Rude'));
    expect(errOf(await hub.add_blacklisted_word('RUDE'))).toMatch(/already/);
    expect(await hubAlice.get_blacklisted_words()).toEqual([]); // only admins see the list
    expect(await hub.get_blacklisted_words()).toEqual(['rude']);
    // nicknames only their author sees: no ban, and the nickname is stored as given (current behaviour)
    unwrap(await hubCarol.set_principal_nickname(alice, 'RUDE alice'));
    expect(await hubCarol.get_principal_nickname(alice)).toEqual(['RUDE alice']);
    unwrap(await hubCarol.set_neuron_nickname(snsId, nid(40), 'rude neuron'));
    expect(isOk(await hub.check_ban_status(carol))).toBe(true);
    // a public name: banned for an hour the first time, by the canister itself
    expect(await hub.test_calculate_ban_duration(dave)).toBe(1n);
    expect(errOf(await hubDave.set_principal_name('so Rude'))).toMatch(/inappropriate content. You have been banned/);
    expect(errOf(await hub.check_ban_status(dave))).toMatch(/You are banned/);
    expect(await hub.get_principal_name(dave)).toEqual([]);
    const log = unwrap(await hub.get_user_ban_history(dave));
    expect(log).toHaveLength(1);
    expect(log[0].admin.toText()).toBe(hubId.toText());
    expect(log[0].user.toText()).toBe(dave.toText());
    expect(log[0].reason).toMatch(/principal name containing blacklisted word 'rude'.*'so Rude'/);
    expect(log[0].expiry_timestamp - log[0].ban_timestamp).toBe(H_NS);
    expect(await hub.test_calculate_ban_duration(dave)).toBe(24n);
    expect(errOf(await hubDave.set_principal_name('dave'))).toMatch(/You are banned/);
    // the ban expires on its own
    await advance(HOUR + 60);
    expect(isOk(await hub.check_ban_status(dave))).toBe(true);
    unwrap(await hubDave.set_principal_name('dave'));
    // second offence (through a neuron name, before ownership is even checked): a day
    expect(errOf(await hubDave.set_neuron_name(snsId, N1, 'rude neuron'))).toMatch(/You have been banned/);
    const log2 = unwrap(await hub.get_user_ban_history(dave));
    expect(log2).toHaveLength(2);
    expect(log2[1].reason).toMatch(/neuron name containing blacklisted word/);
    expect(log2[1].expiry_timestamp - log2[1].ban_timestamp).toBe(24n * H_NS);
    expect(await hub.test_calculate_ban_duration(dave)).toBe(168n);
    unwrap(await hub.remove_blacklisted_word('RUDE'));
    expect(errOf(await hub.remove_blacklisted_word('rude'))).toMatch(/not found/);
    expect(errOf(await hubAlice.remove_blacklisted_word('rude'))).toMatch(/Not authorized/);
  });

  it('manual bans: admins only, never shortened by a later ban, and the banned are shut out of writes', async () => {
    expect(errOf(await hubAlice.ban_user(bob, 1n, 'x'))).toMatch(/Not authorized/);
    expect(errOf(await hub.ban_user(anon, 1n, 'x'))).toMatch(/anonymous/);
    expect(errOf(await hub.ban_user(admin, 1n, 'x'))).toMatch(/administrators/);
    expect(errOf(await hubAlice.get_ban_log())).toMatch(/Not authorized/);
    expect(errOf(await hubAlice.get_banned_users())).toMatch(/Not authorized/);
    expect(errOf(await hubAlice.get_user_ban_history(dave))).toMatch(/Not authorized/);
    let banned = unwrap(await hub.get_banned_users());
    expect(banned.map(([p]) => p.toText())).toEqual([dave.toText()]);
    const expiry = banned[0][1];
    unwrap(await hub.ban_user(dave, 1n, 'shorter')); // logged, but the longer ban stands
    expect(unwrap(await hub.get_banned_users())[0][1]).toBe(expiry);
    unwrap(await hub.ban_user(dave, 48n, 'longer'));
    banned = unwrap(await hub.get_banned_users());
    expect(banned[0][1]).toBeGreaterThan(expiry);
    const log = unwrap(await hub.get_ban_log());
    expect(log).toHaveLength(4);
    expect(log[3].admin.toText()).toBe(admin.toText());
    expect(log[3].reason).toBe('longer');
    expect(errOf(await hub.check_ban_status(dave))).toMatch(/Ban expires in 1 day and 23 hours|Ban expires in 2 days/);
    // what a banned user cannot do
    expect(errOf(await hubDave.set_principal_name('dave'))).toMatch(/banned/);
    expect(errOf(await hubDave.set_principal_name_for(dave, 'dave', []))).toMatch(/banned/);
    expect(errOf(await hubDave.set_principal_nickname(alice, 'x'))).toMatch(/banned/);
    expect(errOf(await hubDave.set_neuron_name(snsId, N1, 'x'))).toMatch(/banned/);
    expect(errOf(await hubDave.set_neuron_nickname(snsId, N1, 'x'))).toMatch(/banned/);
    expect(errOf(await hubDave.set_canister_name(aliceCanId, 'xx'))).toMatch(/banned/);
    expect(errOf(await hubDave.set_my_avatar('https://x.y/z.png'))).toMatch(/banned/);
    expect(errOf(await hubDave.get_user_neurons())).toMatch(/banned/);
    // what is not moderated: clearing an avatar, reading, and the name already set stays
    unwrap(await hubDave.clear_my_avatar());
    expect(await hub.get_principal_name(dave)).toEqual([['dave', false]]);
    expect(await hubDave.get_all_principal_nicknames()).toEqual([]);
    // unban
    expect(errOf(await hubAlice.unban_user(dave))).toMatch(/Not authorized/);
    expect(errOf(await hub.unban_user(alice))).toMatch(/not currently banned/);
    expect(errOf(await hub.unban_user(admin))).toMatch(/Administrators/);
    expect(errOf(await hub.unban_user(anon))).toMatch(/anonymous/);
    unwrap(await hub.unban_user(dave));
    expect(unwrap(await hub.get_banned_users())).toEqual([]);
    expect(isOk(await hub.check_ban_status(dave))).toBe(true);
    const history = unwrap(await hub.get_user_ban_history(dave));
    expect(history).toHaveLength(5);
    expect(history[4].ban_timestamp).toBe(history[4].expiry_timestamp);
    expect(history[4].reason).toMatch(/Manual unban/);
    expect(await hub.test_calculate_ban_duration(dave)).toBe(720n); // 4 bans, 1 unban: the fourth tier
    // a zero-hour ban is over at once, and counts as an unban in the history (current behaviour)
    unwrap(await hub.ban_user(dave, 0n, 'zero'));
    expect(isOk(await hub.check_ban_status(dave))).toBe(true);
    expect(await hub.test_calculate_ban_duration(dave)).toBe(168n);
    unwrap(await hubDave.set_principal_name('dave again'));
  });

  it('avatars: https links or small inline images, batch lookups, admin removal', async () => {
    expect(errOf(await hubAnon.set_my_avatar('https://a/b.png'))).toMatch(/Anonymous/);
    expect(errOf(await hubAnon.clear_my_avatar())).toMatch(/Anonymous/);
    expect(await hub.get_avatar(alice)).toEqual([]);
    expect(await hub.get_avatar_count()).toBe(0n);
    unwrap(await hubAlice.set_my_avatar('https://example.com/alice.png?size=64'));
    expect(await hub.get_avatar(alice)).toEqual(['https://example.com/alice.png?size=64']);
    expect(errOf(await hubAlice.set_my_avatar('http://example.com/alice.png'))).toMatch(/must be an https/);
    expect(errOf(await hubAlice.set_my_avatar('javascript:alert(1)'))).toMatch(/must be an https/);
    for (const c of [' ', '"', "'", '<', '>', '\n', '\r', '\t']) expect(errOf(await hubAlice.set_my_avatar(`https://example.com/a${c}b.png`))).toMatch(/invalid character/);
    expect(errOf(await hubAlice.set_my_avatar('https://example.com/' + 'a'.repeat(493)))).toMatch(/too long \(max 512/);
    unwrap(await hubAlice.set_my_avatar('https://example.com/' + 'a'.repeat(492))); // exactly 512
    unwrap(await hubBob.set_my_avatar('data:image/png;base64,' + 'A'.repeat(100)));
    for (const t of ['jpeg', 'jpg', 'webp', 'gif']) unwrap(await hubBob.set_my_avatar(`data:image/${t};base64,QUJD+/=`));
    expect(errOf(await hubBob.set_my_avatar('data:image/svg+xml;base64,QUJD'))).toMatch(/must be an https/);
    expect(errOf(await hubBob.set_my_avatar('data:image/png,QUJD'))).toMatch(/must be an https/);
    expect(errOf(await hubBob.set_my_avatar('data:image/png;base64,QU JD'))).toMatch(/not valid base64/);
    expect(errOf(await hubBob.set_my_avatar('data:image/png;base64,QUJD<script>'))).toMatch(/not valid base64/);
    expect(errOf(await hubBob.set_my_avatar('data:image/png;base64,' + 'A'.repeat(32_768 - 21)))).toMatch(/too large \(max 32768/);
    unwrap(await hubBob.set_my_avatar('data:image/png;base64,' + 'A'.repeat(32_768 - 22))); // exactly 32768
    expect((await hub.get_avatar(bob))[0].length).toBe(32_768);
    expect(await hub.get_avatar_count()).toBe(2n);
    // batches: those without an avatar are left out; only the first 50 are looked at
    const many = Array.from({ length: 60 }, (_, i) => user(`av${i}`));
    unwrap(await actorAs(pic, hubIdl, hubId, many[55]).set_my_avatar('https://x.y/z.png'));
    const batch = await hubAnon.get_avatars([alice, carol, bob]);
    expect(batch.map(([p, u]) => [p.toText(), u.slice(0, 22)])).toEqual([[alice.toText(), 'https://example.com/aa'], [bob.toText(), 'data:image/png;base64,']]);
    expect(await hub.get_avatars(many)).toEqual([]);
    expect((await hub.get_avatars([many[55], ...many])).map(([p]) => p.toText())).toEqual([many[55].toText()]);
    expect(await hub.get_avatars([])).toEqual([]);
    // clearing: the empty string, clear_my_avatar, or an admin
    expect(unwrap(await hubAlice.set_my_avatar(''))).toMatch(/cleared/);
    expect(await hub.get_avatar(alice)).toEqual([]);
    unwrap(await hubAlice.set_my_avatar('https://example.com/alice.png'));
    unwrap(await hubAlice.clear_my_avatar());
    expect(await hub.get_avatar(alice)).toEqual([]);
    expect(errOf(await hubAlice.admin_clear_avatar(bob))).toMatch(/Not authorized/);
    unwrap(await hub.admin_clear_avatar(bob));
    expect(await hub.get_avatar(bob)).toEqual([]);
    unwrap(await hub.admin_clear_avatar(bob)); // nothing to clear is fine
    expect(await hub.get_avatar_count()).toBe(1n);
    unwrap(await hubAlice.set_my_avatar('https://example.com/alice.png'));
    unwrap(await hubBob.set_my_avatar('data:image/png;base64,QUJD'));
  });

  it('get_user_neurons asks the Sneed SNS governance for the caller\'s neurons', async () => {
    expect(errOf(await hubAnon.get_user_neurons())).toMatch(/Anonymous/);
    await sneedSns.set_neurons([{ id: N1.id, permissions: [perm(alice, ALL)] }]);
    expect(unwrap(await hubBob.get_user_neurons())).toEqual([]); // bob has none
    // SNS governance replies with permission records { principal : ?Principal; permission_type };
    // the backend decodes those and answers in its public (principal, permission types) shape,
    // leaving out entries without a principal
    await sneedSns.set_neurons([{ id: N1.id, permissions: [perm(alice, ALL), { principal: [], permission_type: [1] }, perm(bob, [3, 4])] }]);
    const mine = unwrap(await hubAlice.get_user_neurons());
    expect(mine.length).toBe(1);
    expect(Array.from(mine[0].id[0].id)).toEqual(Array.from(N1.id));
    expect(mine[0].permissions.map(([p, t]) => [p.toText(), Array.from(t)])).toEqual([[alice.toText(), Array.from(ALL)], [bob.toText(), [3, 4]]]);
    expect(unwrap(await hubBob.get_user_neurons()).length).toBe(1); // bob is a hotkey now
  });

  it('an upgrade keeps names, nicknames, neuron names, avatars, bans and the blacklist', async () => {
    unwrap(await hub.ban_user(dave, 100n, 'until after the upgrade'));
    unwrap(await hub.add_blacklisted_word('vile'));
    const snapshot = async () => ({
      names: sorted(await hub.get_all_principal_names()),
      neurons: sorted(await hub.get_all_neuron_names()),
      nicks: sorted(await hubAlice.get_all_principal_nicknames()),
      nnicks: sorted(await hubBob.get_all_neuron_nicknames()),
      avatars: sorted(await hub.get_avatars([alice, bob, user('av55')])),
      count: await hub.get_avatar_count(),
      banned: sorted(unwrap(await hub.get_banned_users())),
      log: ser(unwrap(await hub.get_ban_log())),
      words: sorted(await hub.get_blacklisted_words()),
      limits: ser(await hub.get_nickname_limits_config()),
    });
    const before = await snapshot();
    expect(before.names.length).toBe(4); // alice, bob, dave, alice's canister
    expect(before.banned.length).toBe(1);
    await upgradeHub(pic, hubId, admin, wasm('app_sneeddao_backend'));
    await pic.tick(2);
    expect(await snapshot()).toEqual(before);
    expect(errOf(await hub.check_ban_status(dave))).toMatch(/banned/);
    expect(errOf(await hubDave.set_principal_name('dave'))).toMatch(/banned/);
    expect(await hub.get_principal_name(alice)).toEqual([['alice', true]]);
    expect(await hubAlice.get_principal_nickname(bob)).toEqual(['Bobby2']);
    expect(errOf(await hubBob.set_principal_name('alice'))).toMatch(/already taken/);
    expect(errOf(await hubCarol.set_principal_name('something vile'))).toMatch(/banned/);
    expect(await hubAlice.get_my_nickname_usage()).toMatchObject({ is_premium: true, principal_nickname_limit: 12n }); // premium canister id and limits kept
    expect((await hub.get_token_list_status()).timer_scheduled).toBe(true);
  });
});
