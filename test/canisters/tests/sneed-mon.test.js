// sneed_mon (spec/sneed_mon.md): users watch SNSes; each round sneed_mon lists open proposals,
// fetches their ballots, finds watchers whose vote-permission neurons have not voted, and sends
// one "you can vote" message and one "closes soon" reminder per user and proposal through the
// real Sneed Notifications canister (app "Sneed Hub", topic `proposals`). Mock SNSes play root
// and governance (list_proposals returns only the caller's ballots, as the real one does).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, unwrap, errOf, wasm, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { idlFactory as monIdl } from '../build/sneed_mon.did.js';
import { idlFactory as notifIdl } from '../build/sneed_notifications.did.js';

const anon = Principal.anonymous();
const dave = user('mon-dave'); // eligible, but has not allowed the app
const erin = user('mon-erin'); // voted before the announcement
const grace = user('mon-grace'); // votes after the announcement
const DAY = 86_400n;

const permission = ({ IDL }) => IDL.Record({ principal: IDL.Opt(IDL.Principal), permission_type: IDL.Vec(IDL.Int32) });
const snsIdl = ({ IDL }) => IDL.Service({
  set_name: IDL.Func([IDL.Text], [], []),
  set_neurons: IDL.Func([IDL.Vec(IDL.Record({ id: IDL.Vec(IDL.Nat8), permissions: IDL.Vec(permission({ IDL })) }))], [], []),
  add_proposal: IDL.Func([IDL.Nat64, IDL.Text, IDL.Nat64, IDL.Nat64, IDL.Vec(IDL.Vec(IDL.Nat8))], [], []),
  set_vote: IDL.Func([IDL.Nat64, IDL.Vec(IDL.Nat8), IDL.Int32], [], []),
  counters: IDL.Func([], [IDL.Record({ list_proposals: IDL.Nat, get_proposal: IDL.Nat, list_neurons: IDL.Nat })], ['query']),
});
const snswIdl = ({ IDL }) => IDL.Service({ set_instances: IDL.Func([IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Principal))], [], []) });

const nid = (...bytes) => new Uint8Array(bytes);
const perm = (p, types) => ({ principal: [p], permission_type: types });
const N = { bob: nid(1, 1), carol: nid(2, 2), dave: nid(4, 4), erin: nid(5, 5), grace: nid(7, 7), stranger: nid(9, 9) };

let pic, monId, notifId, snsA, snsB, snswId, appId;
let mon, monAs, notifAs, a, b;

const nowS = async () => BigInt(Math.floor((await pic.getTime()) / 1000));
const proposalsOf = async (p) => (await notifAs(p).get_my_history(200n)).filter((h) => h.app_name === 'Sneed Hub' && h.topic === 'proposals');
const settle = async () => { await pic.tick(3); };
// one round, run to its end (follow-up ticks included)
async function round() {
  await drain(); // a round the timer started finishes first
  unwrap(await mon.admin_run_now());
  await drain();
}
async function drain() {
  for (let i = 0; i < 40 && (await mon.get_status()).running; i++) { await pic.advanceTime(1_500); await pic.tick(2); }
  expect((await mon.get_status()).running).toBe(false);
}

describe('sneed_mon', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    notifId = await install(pic, { name: 'sneed_notifications' });
    snswId = await install(pic, { name: 'MockForumSnsW' });
    snsA = await install(pic, { name: 'MockMonSns' });
    snsB = await install(pic, { name: 'MockMonSns' });
    monId = await install(pic, { name: 'sneed_mon' });
    mon = actorAs(pic, monIdl, monId, admin);
    monAs = (p) => actorAs(pic, monIdl, monId, p);
    notifAs = (p) => actorAs(pic, notifIdl, notifId, p);
    a = actorAs(pic, snsIdl, snsA, admin);
    b = actorAs(pic, snsIdl, snsB, admin);
    await actorAs(pic, snswIdl, snswId, admin).set_instances([[snsA, snsA], [snsB, snsB]]);
    await a.set_name('Alpha DAO');
    await b.set_name('Beta DAO');
    const c = await mon.get_config();
    unwrap(await mon.admin_set_config({ ...c, notifications: [notifId], sns_wasm: snswId, interval_s: 3_600n }));
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('registers with Sneed Notifications as the app "Sneed Hub" with the proposals topic', async () => {
    expect(await refusedAtIngress(monAs(alice).admin_register_with_notifications())).toBe(true);
    appId = unwrap(await mon.admin_register_with_notifications());
    const app = (await notifAs(alice).get_app(appId))[0];
    expect(app.name).toBe('Sneed Hub');
    expect(app.canisters.map((p) => p.toText())).toEqual([monId.toText()]);
    expect(app.topics.map((t) => [t.id, Object.keys(t.level)[0]])).toEqual([['proposals', 'normal']]);
    expect((await mon.get_status()).app_id).toEqual([appId]);
    for (const p of [bob, carol, erin, grace, alice]) unwrap(await notifAs(p).allow_app(appId, true));
  });

  it('lets signed-in users watch and unwatch SNSes listed by SNS-W, within the caps', async () => {
    expect(await refusedAtIngress(monAs(anon).watch_sns(snsA))).toBe(true);
    expect(errOf(await monAs(bob).watch_sns(Principal.fromText('aaaaa-aa')))).toMatch(/Not the root of an SNS/);
    expect(await monAs(bob).watch_sns(snsA)).toEqual({ ok: 'Watching' });
    expect(await monAs(bob).watch_sns(snsA)).toEqual({ ok: 'Already watching' });
    const mine = await monAs(bob).get_my_watches();
    expect(mine.map((w) => [w.root.toText(), w.governance.toText(), w.name, Object.keys(w.topic)[0]])).toEqual([[snsA.toText(), snsA.toText(), 'Alpha DAO', 'proposals']]);
    // the user is asked (in the notification centre) to allow the app, when they haven't decided yet
    unwrap(await monAs(dave).watch_sns(snsA));
    expect((await notifAs(dave).get_my_requests()).map((x) => x.name)).toEqual(['Sneed Hub']);
    // per-user cap
    const c = await mon.get_config();
    unwrap(await mon.admin_set_config({ ...c, max_watches_per_user: 1n }));
    expect(errOf(await monAs(bob).watch_sns(snsB))).toMatch(/At most 1 SNSes per user/);
    // global cap on users
    unwrap(await mon.admin_set_config({ ...c, max_users: 2n }));
    expect(errOf(await monAs(carol).watch_sns(snsA))).toMatch(/watcher limit/);
    unwrap(await mon.admin_set_config(c));
    unwrap(await monAs(bob).watch_sns(snsB));
    expect((await monAs(bob).get_my_watches()).length).toBe(2);
    expect(await monAs(bob).unwatch_sns(snsB)).toEqual({ ok: 'Stopped watching' });
    expect((await monAs(bob).get_my_watches()).map((w) => w.root.toText())).toEqual([snsA.toText()]);
    // the last watcher leaving drops the SNS
    expect((await mon.get_snses()).map((s) => s.root.toText())).toEqual([snsA.toText()]);
    for (const p of [carol, erin, grace]) unwrap(await monAs(p).watch_sns(snsA));
    const st = await mon.get_status();
    expect([st.users, st.watches, st.snses]).toEqual([5n, 5n, 1n]);
    expect((await mon.get_snses())[0].watchers).toBe(5n);
  });

  it('tells a user once about a new proposal their neuron can vote on, and nobody else', async () => {
    await a.set_neurons([
      { id: N.bob, permissions: [perm(bob, [4, 3])] }, // vote permission
      { id: N.carol, permissions: [perm(carol, [2, 3])] }, // no vote permission
      { id: N.dave, permissions: [perm(dave, [4])] }, // can vote, hasn't allowed the app
      { id: N.erin, permissions: [perm(erin, [4])] }, // votes before we look
      { id: N.grace, permissions: [perm(grace, [4])] },
      { id: N.stranger, permissions: [perm(alice, [4])] }, // alice does not watch
    ]);
    const t = await nowS();
    await a.add_proposal(1n, 'Fund the pond', t - 100n, t + 4n * DAY, [N.bob, N.carol, N.dave, N.erin, N.grace, N.stranger]);
    await a.set_vote(1n, N.erin, 1);
    await round();
    const [m] = await proposalsOf(bob);
    expect((await proposalsOf(bob)).length).toBe(1);
    expect(m.title).toBe('Alpha DAO proposal #1: you can vote');
    expect(m.body).toMatch(/"Fund the pond"[\s\S]*1 of your neurons can vote on it\. Voting closes in about (95|96) hours\./);
    expect(m.link).toEqual([`https://app.sneeddao.com/proposal?proposalid=1&sns=${snsA.toText()}`]);
    expect(m.level).toEqual({ normal: null });
    expect((await proposalsOf(grace)).length).toBe(1);
    expect(await proposalsOf(carol)).toEqual([]); // no vote permission
    expect(await proposalsOf(erin)).toEqual([]); // already voted
    expect(await proposalsOf(dave)).toEqual([]); // not allowed: skipped, no error
    expect(await proposalsOf(alice)).toEqual([]); // not watching
    const st = await mon.get_status();
    expect(st.sent).toBe(2n);
    expect(st.skipped_not_allowed).toBe(1n);
    expect(st.errors).toBe(0n);
  });

  it('does not repeat itself in later rounds, and does not fetch the ballots again', async () => {
    const before = await a.counters();
    await round();
    await round();
    expect((await proposalsOf(bob)).length).toBe(1);
    expect((await proposalsOf(grace)).length).toBe(1);
    const after = await a.counters();
    expect(after.get_proposal).toBe(before.get_proposal);
    expect(after.list_neurons).toBe(before.list_neurons);
    expect(after.list_proposals).toBe(before.list_proposals + 2n); // one listing per round
    const [s] = await mon.get_snses();
    expect(s.open.map((p) => [p.id, p.new_done, p.reminder_done])).toEqual([[1n, true, false]]);
  });

  it('reminds once, about a day before the deadline, those who still have not voted', async () => {
    await a.set_vote(1n, N.grace, 2); // grace votes after the announcement
    await pic.advanceTime(Number(3n * DAY + 3_600n) * 1000); // deadline ~23 h away
    await settle();
    await round();
    await round();
    const bobs = await proposalsOf(bob);
    expect(bobs.length).toBe(2);
    expect(bobs[0].title).toBe('Alpha DAO proposal #1 closes soon'); // newest first
    expect(bobs[0].body).toMatch(/Voting closes in about 2[23] hours and 1 of your neurons hasn't voted yet\./);
    expect((await proposalsOf(grace)).length).toBe(1); // voted: no reminder
    expect(await proposalsOf(dave)).toEqual([]);
    const [s] = await mon.get_snses();
    expect(s.open[0].reminder_done).toBe(true);
  });

  it('sends one message only for a proposal first seen inside the reminder window', async () => {
    const t = await nowS();
    await a.add_proposal(2n, 'Short one', t - 100n, t + 10n * 3_600n, [N.bob]);
    await round();
    await round();
    const p2 = (await proposalsOf(bob)).filter((h) => h.title.includes('#2'));
    expect(p2.map((h) => h.title)).toEqual(['Alpha DAO proposal #2: you can vote']);
    expect(p2[0].body).toMatch(/Voting closes in about (9|10) hours/);
  });

  it('drops proposals once voting has closed', async () => {
    await pic.advanceTime(Number(DAY) * 1000);
    await settle();
    await round();
    expect((await mon.get_snses())[0].open).toEqual([]);
  });

  it('bounds the calls of one tick and resumes in follow-up ticks without repeats', async () => {
    const c = await mon.get_config();
    unwrap(await mon.admin_set_config({ ...c, max_calls_per_tick: 3n, batch_size: 2n, neuron_cache_s: 0n }));
    const many = Array.from({ length: 6 }, (_, i) => user(`mon-many-${i}`));
    const ids = many.map((_, i) => nid(50, i));
    await b.set_neurons(many.map((p, i) => ({ id: ids[i], permissions: [perm(p, [4])] })));
    for (const p of many) { unwrap(await notifAs(p).allow_app(appId, true)); unwrap(await monAs(p).watch_sns(snsB)); }
    const t = await nowS();
    await b.add_proposal(7n, 'Beta budget', t - 10n, t + 5n * DAY, ids);
    const before = (await mon.get_status()).sent;
    unwrap(await mon.admin_run_now());
    // the first tick stopped at its budget: 1 listing + 1 get_proposal + 1 list_neurons (+1 flush)
    expect((await mon.get_status()).calls_last_round <= 4n).toBe(true);
    expect((await mon.get_status()).running).toBe(true);
    await drain();
    for (const p of many) expect((await proposalsOf(p)).length, p.toText()).toBe(1);
    expect((await mon.get_status()).sent - before).toBe(6n);
    expect((await b.counters()).get_proposal).toBe(1n);
    await round();
    for (const p of many) expect((await proposalsOf(p)).length).toBe(1);
    unwrap(await mon.admin_set_config(c));
  });

  it('keeps watches and progress across an upgrade', async () => {
    const watches = await monAs(bob).get_my_watches();
    const snses = await mon.get_snses();
    const st = await mon.get_status();
    await pic.upgradeCanister({ sender: admin, canisterId: monId, wasm: wasm('sneed_mon'), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    expect(await monAs(bob).get_my_watches()).toEqual(watches);
    expect((await mon.get_snses()).map((s) => [s.root.toText(), s.watchers, s.open])).toEqual(snses.map((s) => [s.root.toText(), s.watchers, s.open]));
    const st2 = await mon.get_status();
    expect([st2.users, st2.sent, st2.rounds, st2.app_id]).toEqual([st.users, st.sent, st.rounds, st.app_id]);
    await round();
    expect((await mon.get_status()).sent).toBe(st.sent); // nothing sent twice
    // the timer runs again after the upgrade
    const t = await nowS();
    await a.add_proposal(3n, 'After the upgrade', t - 10n, t + 4n * DAY, [N.bob]);
    await pic.advanceTime(3_601_000);
    await pic.tick(6);
    await drain();
    expect((await proposalsOf(bob)).some((h) => h.title === 'Alpha DAO proposal #3: you can vote')).toBe(true);
  });

  it('pauses and resumes; admin methods are for admins; the interval has a floor', async () => {
    expect(await refusedAtIngress(monAs(alice).admin_pause())).toBe(true);
    unwrap(await mon.admin_pause());
    expect(errOf(await mon.admin_run_now())).toMatch(/Paused/);
    expect((await mon.get_status()).paused).toBe(true);
    unwrap(await mon.admin_resume());
    expect(errOf(await mon.admin_set_interval(10n))).toMatch(/at least 60/);
    unwrap(await mon.admin_set_interval(600n));
    expect((await mon.get_status()).interval_s).toBe(600n);
    unwrap(await mon.admin_add_admin(carol));
    expect((await mon.get_admins()).map((p) => p.toText())).toEqual([carol.toText()]);
    unwrap(await monAs(carol).admin_pause());
    unwrap(await monAs(carol).admin_resume());
    unwrap(await mon.admin_remove_admin(carol));
    expect(await refusedAtIngress(monAs(carol).admin_pause())).toBe(true);
  });

  it('skips gracefully when Sneed Notifications refuses the canister, and recovers', async () => {
    // a notifications canister that does not know sneed_mon (not registered)
    const other = await install(pic, { name: 'sneed_notifications' });
    unwrap(await mon.admin_set_notifications_canister([other]));
    const t = await nowS();
    await a.add_proposal(4n, 'Nobody hears', t - 10n, t + 4n * DAY, [N.bob]);
    await round();
    const st = await mon.get_status();
    expect(st.last_error[0][1]).toMatch(/does not accept our messages/);
    const [s] = (await mon.get_snses()).filter((x) => x.root.toText() === snsA.toText());
    expect(s.open.find((p) => p.id === 4n).new_done).toBe(false); // tried again later
    unwrap(await mon.admin_set_notifications_canister([notifId]));
    unwrap(await mon.admin_set_app_id([appId]));
    await round();
    expect((await proposalsOf(bob)).filter((h) => h.title.includes('#4')).length).toBe(1);
  });

  it('refuses queries sent as updates and non-admin admin calls at ingress', async () => {
    const asUpd = (p) => actorAs(pic, asUpdates(monIdl), monId, p);
    for (const q of ['get_status', 'get_snses', 'get_config', 'get_admins', 'get_topics', 'get_my_watches', 'get_api_doc']) {
      expect(await refusedAtIngress(asUpd(bob)[q]()), q).toBe(true);
    }
    expect(await refusedAtIngress(monAs(bob).admin_run_now())).toBe(true);
    expect(await refusedAtIngress(monAs(bob).admin_add_admin(bob))).toBe(true);
    expect(await refusedAtIngress(monAs(anon).unwatch_sns(snsA))).toBe(true);
    const doc = await monAs(bob).get_api_doc();
    expect(doc).toContain('https://app.sneeddao.com/api-docs/sneed_mon.md');
  });
});
