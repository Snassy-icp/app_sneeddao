// sneed_mon (spec/sneed_mon.md): users watch SNSes or the NNS ("Sneed Monitor" in Sneed
// Notifications). A target is polled as often as its most frequent active watcher wants; a new
// proposal's ballots are read once and matched against every watcher's cached neurons; each watch
// is checked (and charged per its tier) when due, its waiting proposals sent as one message per
// topic. Users pay from a prepaid ICP balance (deposit subaccount + credit_deposit); collected fees
// are forwarded in one transfer once they reach a threshold. Mock SNSes play root and governance,
// a mock NNS governance plays the NNS, MockLedger plays the ICP ledger.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, unwrap, errOf, wasm, refusedAtIngress, asUpdates, account, principalToSubaccount } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { idlFactory as monIdl } from '../build/sneed_mon.did.js';
import { idlFactory as notifIdl } from '../build/sneed_notifications.did.js';

const anon = Principal.anonymous();
const dave = user('mon-dave'); // eligible, but has not allowed the app
const erin = user('mon-erin'); // voted before the announcement
const grace = user('mon-grace'); // votes after the announcement
const DAY = 86_400n;
const MIN = 60_000; // ms
const FEE = 10_000n;
const PRICE = { 10: 6_000n, 60: 18_000n, 180: 36_000n, 1440: 144_000n }; // per check, default tier table

const permission = ({ IDL }) => IDL.Record({ principal: IDL.Opt(IDL.Principal), permission_type: IDL.Vec(IDL.Int32) });
const snsIdl = ({ IDL }) => IDL.Service({
  set_name: IDL.Func([IDL.Text], [], []),
  set_neurons: IDL.Func([IDL.Vec(IDL.Record({ id: IDL.Vec(IDL.Nat8), permissions: IDL.Vec(permission({ IDL })) }))], [], []),
  add_proposal: IDL.Func([IDL.Nat64, IDL.Text, IDL.Nat64, IDL.Nat64, IDL.Vec(IDL.Vec(IDL.Nat8))], [], []),
  set_vote: IDL.Func([IDL.Nat64, IDL.Vec(IDL.Nat8), IDL.Int32], [], []),
  set_topic: IDL.Func([IDL.Nat64, IDL.Text, IDL.Nat64], [], []),
  set_topics_supported: IDL.Func([IDL.Bool], [], []),
  counters: IDL.Func([], [IDL.Record({ list_proposals: IDL.Nat, get_proposal: IDL.Nat, list_neurons: IDL.Nat })], ['query']),
});
const nnsIdl = ({ IDL }) => IDL.Service({
  add_proposal: IDL.Func([IDL.Nat64, IDL.Text, IDL.Int32, IDL.Nat64, IDL.Nat64], [], []),
  set_neuron: IDL.Func([IDL.Nat64, IDL.Nat64, IDL.Nat64, IDL.Nat64, IDL.Opt(IDL.Int32)], [], []),
  vote: IDL.Func([IDL.Nat64, IDL.Nat64, IDL.Int32], [], []),
  counters: IDL.Func([], [IDL.Record({ list_proposals: IDL.Nat, get_neuron_info: IDL.Nat })], ['query']),
});
const snswIdl = ({ IDL }) => IDL.Service({ set_instances: IDL.Func([IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Principal))], [], []) });
// the 1bbee49a build's API, the parts the upgrade test uses
const OldConfig = IDL.Record({
  notifications: IDL.Opt(IDL.Principal), sns_wasm: IDL.Principal, interval_s: IDL.Nat, paused: IDL.Bool, sponsored: IDL.Bool,
  max_users: IDL.Nat, max_watches_per_user: IDL.Nat, max_snses: IDL.Nat, max_calls_per_tick: IDL.Nat, max_continuations: IDL.Nat,
  reminder_window_s: IDL.Nat, batch_size: IDL.Nat, neuron_pages: IDL.Nat, proposal_pages: IDL.Nat, neuron_cache_s: IDL.Nat,
});
const Res = IDL.Variant({ ok: IDL.Text, err: IDL.Text });
const oldMonIdl = ({ IDL }) => IDL.Service({
  get_config: IDL.Func([], [OldConfig], ['query']),
  admin_set_config: IDL.Func([OldConfig], [Res], []),
  admin_register_with_notifications: IDL.Func([], [IDL.Variant({ ok: IDL.Nat, err: IDL.Text })], []),
  watch_sns: IDL.Func([IDL.Principal], [Res], []),
});

const nid = (...bytes) => new Uint8Array(bytes);
const perm = (p, types) => ({ principal: [p], permission_type: types });
const N = { bob: nid(1, 1), carol: nid(2, 2), dave: nid(4, 4), erin: nid(5, 5), grace: nid(7, 7), stranger: nid(9, 9) };
const sns = (p) => ({ sns: p });
const NNS = { nns: null };
const SPLITTER_SUB = new Uint8Array(32); SPLITTER_SUB.set([1, 0, 0, 0, 0, 6]);

let pic, monId, notifId, icpId, snsA, snsB, snsC, snsD, snsE, nnsId, snswId, appId;
let mon, monAs, notifAs, icp, a, b, c, d, nns;

const nowS = async () => BigInt(Math.floor((await pic.getTime()) / 1000));
const hist = async (p) => (await notifAs(p).get_my_history(200n)).filter((h) => h.app_name === 'Sneed Monitor');
const propsOf = async (p) => (await hist(p)).filter((h) => h.topic === 'proposals');
const later = async (minutes) => { await pic.advanceTime(minutes * MIN); await pic.tick(2); };
async function drain() {
  for (let i = 0; i < 60 && (await mon.get_status()).running; i++) { await pic.advanceTime(1_500); await pic.tick(2); }
  expect((await mon.get_status()).running).toBe(false);
}
// one round, run to its end (follow-up ticks included)
async function round() {
  await drain(); // a round the timer started finishes first
  unwrap(await mon.admin_run_now());
  await drain();
}
async function fund(p, e8s) {
  await icp.mint(account(monId, principalToSubaccount(p)), e8s);
  return unwrap(await monAs(p).credit_deposit());
}
const balanceOf = async (p) => (await monAs(p).get_my_balance()).balance_e8s;
// sneed_mon's main account holds exactly what it owes (user balances + fees not forwarded)
async function expectSolvent() {
  const acc = await mon.get_accounting();
  const main = await icp.icrc1_balance_of(account(monId));
  expect(acc.obligations_e8s).toBe(acc.user_balances_e8s + acc.fees_available_e8s);
  expect(main).toBe(acc.obligations_e8s);
}

describe('sneed_mon', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    notifId = await install(pic, { name: 'sneed_notifications' });
    snswId = await install(pic, { name: 'MockForumSnsW' });
    [snsA, snsB, snsC, snsD, snsE] = [];
    snsA = await install(pic, { name: 'MockMonSns' });
    snsB = await install(pic, { name: 'MockMonSns' });
    snsC = await install(pic, { name: 'MockMonSns' });
    snsD = await install(pic, { name: 'MockMonSns' });
    snsE = await install(pic, { name: 'MockMonSns' });
    nnsId = await install(pic, { name: 'MockMonNns' });
    icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 10_000n, symbol: 'ICP', decimals: 8 }] });
    monId = await install(pic, { name: 'sneed_mon' });
    mon = actorAs(pic, monIdl, monId, admin);
    monAs = (p) => actorAs(pic, monIdl, monId, p);
    notifAs = (p) => actorAs(pic, notifIdl, notifId, p);
    icp = actorAs(pic, ledgerIdl, icpId, admin);
    a = actorAs(pic, snsIdl, snsA, admin);
    b = actorAs(pic, snsIdl, snsB, admin);
    c = actorAs(pic, snsIdl, snsC, admin);
    d = actorAs(pic, snsIdl, snsD, admin);
    nns = actorAs(pic, nnsIdl, nnsId, admin);
    await actorAs(pic, snswIdl, snswId, admin).set_instances([snsA, snsB, snsC, snsD, snsE].map((x) => [x, x]));
    await a.set_name('Alpha DAO');
    await b.set_name('Beta DAO');
    await c.set_name('Gamma DAO');
    await d.set_name('Delta DAO');
    await actorAs(pic, snsIdl, snsE, admin).set_name('Epsilon DAO');
    // generous daily caps in Sneed Notifications (the tests send many messages)
    const n = actorAs(pic, notifIdl, notifId, admin);
    const nc = await n.get_config();
    unwrap(await n.admin_set_config({ ...nc, default_daily_cap: 1_000n }));
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('defaults: tier prices, hourly checks, all revenue to the RLL splitter', async () => {
    const cfg = await mon.get_config();
    // the account Sneed Premium pays into: the Neutrinite pylon's ICP splitter, node 6
    expect(cfg.billing.fee_destination.length).toBe(1);
    expect(cfg.billing.fee_destination[0].owner.toText()).toBe('6jvpj-sqaaa-aaaaj-azwnq-cai');
    expect([...cfg.billing.fee_destination[0].subaccount[0]]).toEqual([...SPLITTER_SUB]);
    expect(cfg.billing.fee_sweep_threshold_e8s).toBe(10_000_000n);
    expect(cfg.billing.icp_ledger.toText()).toBe('ryjl3-tyaaa-aaaaa-aaaba-cai');
    expect(cfg.tuning.defaults.every_min).toBe(60n);
    expect(cfg.tuning.defaults.topics).toEqual({ all: null });
    expect([cfg.tuning.defaults.new_proposals, cfg.tuning.defaults.reminders]).toEqual([true, true]);
    expect(cfg.tuning.nns_governance.toText()).toBe('rrkah-fqaaa-aaaaa-aaaaq-cai');
    const t = await mon.get_tiers();
    expect(t.base_daily_price_e8s).toBe(144_000n);
    expect(t.tiers.map((x) => [x.every_min, x.daily_multiplier, x.per_check_e8s, x.checks_per_day, x.daily_price_e8s])).toEqual([
      [10n, 6n, 6_000n, 144n, 864_000n], [60n, 3n, 18_000n, 24n, 432_000n], [180n, 2n, 36_000n, 8n, 288_000n], [1440n, 1n, 144_000n, 1n, 144_000n],
    ]);
    // the test setup: the mock ledger and NNS, and fees kept until the fee test
    unwrap(await mon.admin_set_config({ ...cfg.core, notifications: [notifId], sns_wasm: snswId }));
    unwrap(await mon.admin_set_billing({ ...cfg.billing, icp_ledger: icpId, fee_destination: [] }));
    unwrap(await mon.admin_set_tuning({ ...cfg.tuning, nns_governance: nnsId }));
    expect(await refusedAtIngress(monAs(alice).admin_set_fee_destination([]))).toBe(true);
    expect(await refusedAtIngress(monAs(alice).admin_set_tiers(t))).toBe(true);
  });

  it('registers with Sneed Notifications as "Sneed Monitor" with three topics', async () => {
    expect(await refusedAtIngress(monAs(alice).admin_register_with_notifications())).toBe(true);
    appId = unwrap(await mon.admin_register_with_notifications());
    const app = (await notifAs(alice).get_app(appId))[0];
    expect(app.name).toBe('Sneed Monitor');
    expect(app.description).toMatch(/small fee/);
    expect(app.canisters.map((p) => p.toText())).toEqual([monId.toText()]);
    expect(app.topics.map((t) => [t.id, Object.keys(t.level)[0]])).toEqual([['proposals', 'normal'], ['proposal_deadlines', 'urgent'], ['account', 'normal']]);
    for (const p of [bob, carol, erin, grace, alice]) unwrap(await notifAs(p).allow_app(appId, true));
  });

  it('takes deposits: one subaccount per user, credited once, never twice', async () => {
    const dep = await monAs(bob).get_deposit_account();
    expect(dep.owner.toText()).toBe(monId.toText());
    expect([...dep.subaccount[0]]).toEqual([...principalToSubaccount(bob)]);
    const txs0 = (await icp.get_transactions()).length;
    await icp.mint(dep, 2_000_000n);
    // two credits at once: one moves the deposit, the other is refused or finds nothing
    const [r1, r2] = await Promise.all([monAs(bob).credit_deposit(), monAs(bob).credit_deposit()]);
    const oks = [r1, r2].filter((r) => 'ok' in r).map((r) => r.ok.credited_e8s);
    expect(oks.reduce((x, y) => x + y, 0n)).toBe(2_000_000n - FEE);
    expect(await balanceOf(bob)).toBe(1_990_000n);
    // again: nothing new, nothing moved
    expect(unwrap(await monAs(bob).credit_deposit()).credited_e8s).toBe(0n);
    expect(await balanceOf(bob)).toBe(1_990_000n);
    expect((await icp.get_transactions()).length).toBe(txs0 + 2); // the mint and one sweep
    expect(await refusedAtIngress(monAs(anon).credit_deposit())).toBe(true);
    await expectSolvent();
  });

  it('watching is one call with defaults, and needs a balance that pays one check of each watch', async () => {
    expect(await refusedAtIngress(monAs(anon).watch(sns(snsA)))).toBe(true);
    expect(errOf(await monAs(carol).watch(sns(snsA)))).toMatch(/Top up first/);
    expect(errOf(await monAs(bob).watch(sns(Principal.fromText('aaaaa-aa'))))).toMatch(/Not the root of an SNS/);
    for (const p of [carol, dave, erin, grace]) await fund(p, 1_000_000n);
    await a.set_neurons([
      { id: N.bob, permissions: [perm(bob, [4, 3])] }, // vote permission
      { id: N.carol, permissions: [perm(carol, [2, 3])] }, // no vote permission
      { id: N.dave, permissions: [perm(dave, [4])] }, // can vote, hasn't allowed the app
      { id: N.erin, permissions: [perm(erin, [4])] }, // votes before we look
      { id: N.grace, permissions: [perm(grace, [4])] },
      { id: N.stranger, permissions: [perm(alice, [4])] }, // alice does not watch
    ]);
    expect(unwrap(await monAs(bob).watch(sns(snsA)))).toBe('Watching; 1 of your neurons can vote here');
    expect(await monAs(bob).watch(sns(snsA))).toEqual({ ok: 'Already watching' });
    const [w] = await monAs(bob).get_my_watches();
    expect([w.name, w.governance.toText(), w.settings.every_min, w.price_per_check_e8s, w.neurons]).toEqual(['Alpha DAO', snsA.toText(), 60n, 18_000n, [1n]]);
    expect(w.target).toEqual(sns(snsA));
    // the user is asked (in the notification centre) to allow the app, when they haven't decided yet
    unwrap(await monAs(dave).watch(sns(snsA)));
    expect((await notifAs(dave).get_my_requests()).map((x) => x.name)).toEqual(['Sneed Monitor']);
    for (const p of [carol, erin, grace]) unwrap(await monAs(p).watch(sns(snsA)));
    const st = await mon.get_status();
    expect([st.users, st.watches, st.targets]).toEqual([5n, 5n, 1n]);
    const [ti] = await mon.get_targets();
    expect([ti.watchers, ti.active_watchers, ti.poll_every_min]).toEqual([5n, 5n, [60n]]);
  });

  it('tells a user once about a new proposal their neuron can vote on, and nobody else', async () => {
    const t = await nowS();
    await a.add_proposal(1n, 'Fund the pond', t - 100n, t + 4n * DAY, [N.bob, N.carol, N.dave, N.erin, N.grace, N.stranger]);
    await a.set_vote(1n, N.erin, 1);
    const before = await a.counters();
    await round();
    const [m] = await propsOf(bob);
    expect((await propsOf(bob)).length).toBe(1);
    expect(m.title).toBe('Alpha DAO proposal #1: you can vote');
    expect(m.body).toMatch(/"Fund the pond"[\s\S]*1 of your neurons can vote on it\. Voting closes in about (95|96) hours\./);
    expect(m.link).toEqual([`https://app.sneeddao.com/proposal?proposalid=1&sns=${snsA.toText()}`]);
    expect(m.level).toEqual({ normal: null });
    expect((await propsOf(grace)).length).toBe(1);
    expect(await propsOf(carol)).toEqual([]); // no vote permission
    expect(await propsOf(erin)).toEqual([]); // already voted
    expect(await propsOf(dave)).toEqual([]); // not allowed: skipped, no error
    expect(await propsOf(alice)).toEqual([]); // not watching
    const after = await a.counters();
    expect(after.get_proposal - before.get_proposal).toBe(1n); // the ballots read once
    expect(after.list_neurons - before.list_neurons).toBe(0n); // the neurons came from the cache
    const st = await mon.get_status();
    expect(st.skipped_not_allowed).toBe(1n);
    expect(st.errors).toBe(0n);
  });

  it('charges each check at its tier, exactly, and keeps a charge history', async () => {
    // the first round checked bob once (hourly: 18,000 e8s)
    expect(await balanceOf(bob)).toBe(1_990_000n - 18_000n);
    let [e] = (await monAs(bob).get_my_charges(0n, 10n)).entries;
    expect([e.price_e8s, e.every_min, e.outcome]).toEqual([18_000n, 60n, '1 proposal, sent']);
    expect(e.target).toEqual(sns(snsA));
    // not due again within the hour: no charge, no listing
    const c0 = await a.counters();
    await round();
    expect(await balanceOf(bob)).toBe(1_990_000n - 18_000n);
    expect((await a.counters()).list_proposals).toBe(c0.list_proposals);
    // an hour later: polled once, nothing new, charged once more
    await later(60);
    await round();
    expect(await balanceOf(bob)).toBe(1_990_000n - 36_000n);
    expect((await a.counters()).list_proposals).toBe(c0.list_proposals + 1n);
    expect((await a.counters()).get_proposal).toBe(c0.get_proposal); // nothing new to read
    expect((await propsOf(bob)).length).toBe(1);
    const h = await monAs(bob).get_my_charges(0n, 10n);
    expect(h.total).toBe(2n);
    expect(h.entries.map((x) => x.outcome)).toEqual(['nothing new', '1 proposal, sent']); // newest first
    expect((await monAs(bob).get_my_charges(1n, 10n)).entries.map((x) => x.outcome)).toEqual(['1 proposal, sent']);
    const mine = await monAs(bob).get_my_balance();
    expect([mine.charged_e8s, mine.checks, mine.per_round_of_checks_e8s, mine.per_day_e8s]).toEqual([36_000n, 2n, 18_000n, 432_000n]);
    await expectSolvent();
  });

  it('sends several proposals due at one check as one digest per topic', async () => {
    const t = await nowS();
    await a.add_proposal(2n, 'Buy bread', t - 10n, t + 5n * DAY, [N.bob]);
    await a.add_proposal(3n, 'Feed ducks', t - 10n, t + 5n * DAY, [N.bob]);
    await later(60);
    await round();
    const [m] = await propsOf(bob);
    expect((await propsOf(bob)).length).toBe(2);
    expect(m.title).toBe('2 proposals to vote on in Alpha DAO');
    expect(m.body).toMatch(/#2 Buy bread: 1 of your neurons, closes in about 1(19|20) hours\n#3 Feed ducks/);
    expect(m.link).toEqual([`https://app.sneeddao.com/proposals?sns=${snsA.toText()}`]);
    expect((await monAs(bob).get_my_charges(0n, 1n)).entries[0].outcome).toBe('2 proposals, sent');
  });

  it('reminds once, under the topic proposal_deadlines (urgent), those who still have not voted', async () => {
    await a.set_vote(1n, N.grace, 2); // grace votes after the announcement
    for (const id of [2n, 3n]) await a.set_vote(id, N.bob, 1); // bob votes on the others
    await pic.advanceTime(Number(3n * DAY + 3_600n) * 1000); // #1's deadline ~23 h away
    await pic.tick(2);
    await round();
    await later(60);
    await round();
    const rem = (await hist(bob)).filter((h) => h.topic === 'proposal_deadlines');
    expect(rem.map((h) => h.title)).toEqual(['Alpha DAO proposal #1 closes soon']);
    expect(rem[0].level).toEqual({ urgent: null });
    expect(rem[0].body).toMatch(/Voting closes in about (19|2\d) hours and 1 of your neurons hasn't voted yet\./);
    expect((await hist(grace)).filter((h) => h.topic === 'proposal_deadlines')).toEqual([]); // voted
    const [s] = (await mon.get_targets()).filter((x) => x.governance.toText() === snsA.toText());
    expect(s.open.find((p) => p.id === 1n).windows_done).toEqual([86_400n]);
  });

  it('pauses a user whose balance cannot pay a check (one notice), and resumes on credit', async () => {
    const pat = user('mon-pat');
    unwrap(await notifAs(pat).allow_app(appId, true));
    await fund(pat, FEE + 18_000n); // exactly one hourly check
    await a.set_neurons([{ id: N.bob, permissions: [perm(bob, [4, 3])] }, { id: N.grace, permissions: [perm(grace, [4])] }, { id: nid(8, 8), permissions: [perm(pat, [4])] }]);
    unwrap(await monAs(pat).watch(sns(snsA)));
    await round(); // the one paid check
    expect(await balanceOf(pat)).toBe(0n);
    await later(60);
    const t = await nowS();
    await a.add_proposal(5n, 'Unpaid', t - 10n, t + 3n * DAY, [nid(8, 8)]);
    await round(); // can't pay: paused, the check not made
    const mine = await monAs(pat).get_my_balance();
    expect([mine.paused, mine.balance_e8s, mine.checks]).toEqual([true, 0n, 1n]);
    await later(60);
    await round(); // the notice goes out once
    await later(60);
    await round();
    const notes = (await hist(pat)).filter((h) => h.topic === 'account');
    expect(notes.map((h) => h.title)).toEqual(['Monitoring paused: top up']);
    expect(await propsOf(pat)).toEqual([]); // no check, no message
    expect((await monAs(pat).get_my_charges(0n, 10n)).total).toBe(1n);
    expect((await mon.get_status()).paused_users).toBe(1n);
    // a credit that pays a check resumes; the watch is kept
    const r = await fund(pat, FEE + 50_000n);
    expect([r.credited_e8s, r.paused]).toEqual([50_000n, false]);
    expect((await monAs(pat).get_my_watches()).length).toBe(1);
    await round();
    expect(await balanceOf(pat)).toBe(50_000n - 18_000n);
    await expectSolvent();
  });

  it('never charges a user with no watches', async () => {
    const quinn = user('mon-quinn');
    await fund(quinn, 500_000n);
    unwrap(await monAs(quinn).watch(sns(snsA)));
    unwrap(await monAs(quinn).unwatch(sns(snsA)));
    for (let i = 0; i < 3; i++) { await later(60); await round(); }
    const mine = await monAs(quinn).get_my_balance();
    expect([mine.balance_e8s, mine.charged_e8s, mine.watches]).toEqual([490_000n, 0n, 0n]);
  });

  it('withdraws unspent balance, within limits', async () => {
    const before = await balanceOf(carol);
    expect(errOf(await monAs(carol).withdraw_balance(before + 1n, account(carol)))).toMatch(/Your balance is/);
    expect(errOf(await monAs(carol).withdraw_balance(FEE, account(carol)))).toMatch(/more than the ledger fee/);
    expect(await refusedAtIngress(monAs(anon).withdraw_balance(100_000n, account(anon)))).toBe(true);
    const got0 = await icp.icrc1_balance_of(account(carol));
    unwrap(await monAs(carol).withdraw_balance(100_000n, account(carol)));
    expect(await icp.icrc1_balance_of(account(carol))).toBe(got0 + 100_000n - FEE);
    expect(await balanceOf(carol)).toBe(before - 100_000n);
    // a ledger failure puts the balance back
    await icp.set_paused(true);
    expect(errOf(await monAs(carol).withdraw_balance(50_000n, account(carol)))).toMatch(/refused/);
    await icp.set_paused(false);
    expect(await balanceOf(carol)).toBe(before - 100_000n);
    await expectSolvent();
  });

  it('lets admins withdraw collected fees only, never user balances', async () => {
    const acc = await mon.get_accounting();
    expect(acc.fees_available_e8s > FEE).toBe(true);
    expect(errOf(await mon.admin_withdraw_fees(acc.fees_available_e8s + 1n, account(admin)))).toMatch(/Fees available/);
    expect(await refusedAtIngress(monAs(bob).admin_withdraw_fees(1n, account(bob)))).toBe(true);
    unwrap(await mon.admin_withdraw_fees(acc.fees_available_e8s, account(admin)));
    const acc2 = await mon.get_accounting();
    expect(acc2.fees_available_e8s).toBe(0n);
    expect(acc2.user_balances_e8s).toBe(acc.user_balances_e8s);
    expect(errOf(await mon.admin_withdraw_fees(FEE + 1n, account(admin)))).toMatch(/Fees available: 0/);
    await expectSolvent();
  });

  it('forwards collected fees in one transfer once they reach the threshold, and retries a failure', async () => {
    const cfg = (await mon.get_config()).billing;
    const dest = account(user('mon-rll'));
    unwrap(await mon.admin_set_fee_destination([dest]));
    unwrap(await mon.admin_set_fee_sweep_threshold(1_000_000n));
    const txs0 = (await icp.get_transactions()).length;
    // many small charges: no ledger call
    for (let i = 0; i < 3; i++) { await later(60); await round(); }
    expect((await icp.get_transactions()).length).toBe(txs0);
    const avail = (await mon.get_accounting()).fees_available_e8s;
    expect(avail > FEE).toBe(true);
    // the threshold reached; the ledger refuses: the fees stay for the next round
    unwrap(await mon.admin_set_fee_sweep_threshold(avail));
    await icp.set_paused(true);
    await round();
    expect((await mon.get_accounting()).fees_available_e8s).toBe(avail);
    expect((await mon.get_status()).last_error[0][1]).toMatch(/fee forward/);
    await icp.set_paused(false);
    await round();
    const txs = await icp.get_transactions();
    expect(txs.length).toBe(txs0 + 1);
    const acc = await mon.get_accounting();
    expect(txs[txs.length - 1].to.owner.toText()).toBe(dest.owner.toText());
    expect(txs[txs.length - 1].amount).toBe(acc.fees_forwarded_e8s - FEE);
    expect([acc.fees_available_e8s, acc.fee_forwards]).toEqual([0n, 1n]);
    await expectSolvent();
    unwrap(await mon.admin_set_billing({ ...cfg, fee_destination: [] }));
  });

  it('polls a target only as often as its most frequent active watcher, and not at all without one', async () => {
    const dan = user('mon-dan');
    const fay = user('mon-fay');
    await fund(dan, 1_000_000n);
    await fund(fay, 1_000_000n);
    await c.set_neurons([{ id: nid(30, 1), permissions: [perm(dan, [4])] }, { id: nid(30, 2), permissions: [perm(fay, [4])] }]);
    unwrap(await monAs(dan).watch(sns(snsC)));
    unwrap(await monAs(dan).update_watch(sns(snsC), { every_min: [1440n], topics: [], new_proposals: [], reminders: [], reminder_window_s: [] }));
    const n0 = (await c.counters()).list_proposals;
    await round();
    expect((await c.counters()).list_proposals).toBe(n0 + 1n);
    for (let i = 0; i < 3; i++) { await later(360); await round(); } // 18 hours: not due
    expect((await c.counters()).list_proposals).toBe(n0 + 1n);
    await later(360); // a day after the first poll
    await round();
    expect((await c.counters()).list_proposals).toBe(n0 + 2n);
    expect((await monAs(dan).get_my_charges(0n, 10n)).entries.map((e) => e.price_e8s)).toEqual([144_000n, 144_000n]);
    // a 10-minute watcher: polled every round
    unwrap(await monAs(fay).watch(sns(snsC)));
    unwrap(await monAs(fay).update_watch(sns(snsC), { every_min: [10n], topics: [], new_proposals: [], reminders: [], reminder_window_s: [] }));
    const n1 = (await c.counters()).list_proposals;
    for (let i = 0; i < 3; i++) { await later(10); await round(); }
    expect((await c.counters()).list_proposals).toBe(n1 + 3n);
    expect((await monAs(fay).get_watch(sns(snsC)))[0].price_per_check_e8s).toBe(6_000n);
    // nobody watching: no calls at all
    unwrap(await monAs(fay).unwatch(sns(snsC)));
    unwrap(await monAs(dan).unwatch(sns(snsC)));
    const all = await c.counters();
    for (let i = 0; i < 2; i++) { await later(1440); await round(); }
    expect(await c.counters()).toEqual(all);
  });

  it('reads each proposal once whatever the number of watchers (300 on one SNS)', async () => {
    const many = Array.from({ length: 300 }, (_, i) => user(`mon-many-${i}`));
    const ids = many.map((_, i) => nid(50, i >> 8, i & 255));
    await b.set_neurons(many.map((p, i) => ({ id: ids[i], permissions: [perm(p, [4])] })));
    for (let i = 0; i < many.length; i += 25) {
      await Promise.all(many.slice(i, i + 25).map(async (p) => {
        await fund(p, 1_000_000n);
        unwrap(await notifAs(p).allow_app(appId, true));
        unwrap(await monAs(p).watch(sns(snsB)));
      }));
    }
    const before = await b.counters();
    const sent0 = (await mon.get_status()).sent;
    const t = await nowS();
    await b.add_proposal(7n, 'Beta budget', t - 10n, t + 5n * DAY, ids);
    await round();
    const after = await b.counters();
    expect(after.get_proposal - before.get_proposal).toBe(1n);
    expect(after.list_proposals - before.list_proposals).toBe(1n);
    expect(after.list_neurons - before.list_neurons).toBe(0n);
    expect((await mon.get_status()).sent - sent0).toBe(300n);
    for (const p of [many[0], many[150], many[299]]) expect((await propsOf(p)).map((h) => h.title)).toEqual(['Beta DAO proposal #7: you can vote']);
    const st = await mon.get_status();
    expect(st.backlog.pending_messages).toBe(0n);
    expect(st.last_round_duration_ns >= 0n).toBe(true);
    expect(st.economics.last_round_cycles > 0n).toBe(true); // the round's calls cost cycles
  }, 600_000);

  it('filters by proposal topic (SNS topics, or proposal types for an SNS without topics)', async () => {
    const hal = user('mon-hal');
    await fund(hal, 1_000_000n);
    unwrap(await notifAs(hal).allow_app(appId, true));
    await d.set_neurons([{ id: nid(40, 1), permissions: [perm(hal, [4])] }]);
    unwrap(await monAs(hal).watch(sns(snsD)));
    const opts = unwrap(await monAs(hal).list_target_topics(sns(snsD)));
    expect(opts.map((o) => o.key)).toEqual(['Governance', 'TreasuryAssetManagement']);
    expect((await monAs(hal).get_target_topics(sns(snsD)))[0].map((o) => o.name)).toEqual(['Governance', 'Treasury & asset management']);
    // an SNS from before topics offers its proposal types
    await actorAs(pic, snsIdl, snsE, admin).set_topics_supported(false);
    expect(unwrap(await monAs(hal).list_target_topics(sns(snsE))).map((o) => o.key)).toEqual(['fn:1', 'fn:1000']);
    expect(unwrap(await monAs(hal).list_target_topics(NNS)).find((o) => o.key === '4').name).toBe('Governance');
    unwrap(await monAs(hal).update_watch(sns(snsD), { every_min: [], topics: [{ only: ['Governance'] }], new_proposals: [], reminders: [], reminder_window_s: [] }));
    await round(); // the first listing (nothing open yet)
    const t = await nowS();
    await d.add_proposal(1n, 'Spend it all', t - 10n, t + 4n * DAY, [nid(40, 1)]);
    await d.set_topic(1n, 'TreasuryAssetManagement', 13n);
    await d.add_proposal(2n, 'A motion', t - 10n, t + 4n * DAY, [nid(40, 1)]);
    await later(60);
    await round();
    expect((await propsOf(hal)).map((h) => h.title)).toEqual(['Delta DAO proposal #2: you can vote']);
    const [ti] = (await mon.get_targets()).filter((x) => x.governance.toText() === snsD.toText());
    expect(ti.open.map((p) => [p.id, p.topic_key])).toEqual([[1n, 'TreasuryAssetManagement'], [2n, 'Governance']]);
  });

  it('validates watch settings; reminders and new-proposal messages can be turned off', async () => {
    const upd = (input) => monAs(bob).update_watch(sns(snsA), { every_min: [], topics: [], new_proposals: [], reminders: [], reminder_window_s: [], ...input });
    expect(errOf(await upd({ every_min: [20n] }))).toMatch(/every_min is one of 10, 60, 180, 1440/);
    expect(errOf(await upd({ reminder_window_s: [7_200n] }))).toMatch(/reminder_window_s is one of/);
    expect(errOf(await upd({ every_min: [1440n], reminder_window_s: [3_600n] }))).toMatch(/at least the check interval/);
    expect(errOf(await upd({ topics: [{ only: [] }] }))).toMatch(/1 to 50 topics/);
    expect(errOf(await monAs(carol).update_watch(sns(snsB), { every_min: [], topics: [], new_proposals: [], reminders: [], reminder_window_s: [] }))).toMatch(/Not watching/);
    unwrap(await upd({ reminders: [false], reminder_window_s: [3_600n], every_min: [10n] }));
    const s = (await monAs(bob).get_watch(sns(snsA)))[0].settings;
    expect([s.reminders, s.reminder_window_s, s.every_min, s.new_proposals]).toEqual([false, 3_600n, 10n, true]);
    unwrap(await upd({ reminders: [true], reminder_window_s: [86_400n], every_min: [60n] }));
    // the defaults are the admins' to tune
    const cfg = await mon.get_config();
    expect(errOf(await mon.admin_set_tuning({ ...cfg.tuning, defaults: { ...cfg.tuning.defaults, every_min: 7n } }))).toMatch(/defaults/);
    expect(errOf(await mon.admin_set_tiers({ base_daily_price_e8s: 144_000n, tiers: [{ every_min: 10n, daily_multiplier: 6n }] }))).toMatch(/default frequency/);
    expect(errOf(await mon.admin_set_tiers({ base_daily_price_e8s: 1n, tiers: [{ every_min: 7n, daily_multiplier: 1n }] }))).toMatch(/divide 1440/);
  });

  it('watches the NNS through registered neuron ids (never a hotkey)', async () => {
    const ivy = user('mon-ivy');
    await fund(ivy, 1_000_000n);
    unwrap(await notifAs(ivy).allow_app(appId, true));
    expect(unwrap(await monAs(ivy).watch(NNS))).toMatch(/set_nns_neurons/);
    expect(errOf(await monAs(ivy).set_nns_neurons(Array.from({ length: 21 }, (_, i) => BigInt(i))))).toMatch(/At most 20/);
    unwrap(await monAs(ivy).set_nns_neurons([11n, 12n, 13n, 11n]));
    expect(Array.from(await monAs(ivy).get_my_nns_neurons())).toEqual([11n, 12n, 13n]);
    const t = await nowS();
    await nns.set_neuron(11n, t - 400n * DAY, 365n * DAY, 1_000n, []); // can vote
    await nns.set_neuron(12n, t - 400n * DAY, 30n * DAY, 1_000n, []); // dissolve delay under six months
    await nns.set_neuron(13n, t + 10n, 365n * DAY, 1_000n, []); // created after the proposal
    await nns.add_proposal(100n, 'Upgrade the registry', 8, t - 5n, t + 4n * DAY);
    await nns.add_proposal(101n, 'Already decided by me', 4, t - 5n, t + 4n * DAY);
    await nns.vote(11n, 101n, 1);
    const c0 = await nns.counters();
    await later(1);
    await round();
    const m = await propsOf(ivy);
    expect(m.map((h) => h.title)).toEqual(['NNS proposal #100: you can vote']);
    expect(m[0].body).toMatch(/1 of your neurons can vote on it/);
    expect(m[0].link).toEqual(['https://app.sneeddao.com/icp_proposal?proposalid=100']);
    const c1 = await nns.counters();
    expect(c1.list_proposals - c0.list_proposals).toBe(1n);
    expect(c1.get_neuron_info - c0.get_neuron_info).toBe(3n); // the three neurons, once, at the check
    // nothing new at the next check: no neuron reads
    await later(60);
    await round();
    expect((await nns.counters()).get_neuron_info).toBe(c1.get_neuron_info);
    expect((await monAs(ivy).get_my_watches())[0].neurons).toEqual([3n]);
  });

  it('reports economics: revenue, checks and cycles per period', async () => {
    const st = await mon.get_status();
    const acc = await mon.get_accounting();
    expect(st.economics.total.revenue_e8s).toBe(acc.fees_collected_e8s);
    expect(st.economics.total.checks > 300n).toBe(true);
    expect(st.economics.total.cycles_burned > 0n).toBe(true);
    expect(st.economics.last_30d).toEqual(st.economics.total);
    expect(st.economics.last_24h.revenue_e8s <= st.economics.total.revenue_e8s).toBe(true);
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

  it('makes no checks (and charges nothing) while Sneed Notifications refuses it, and recovers', async () => {
    await a.set_neurons([{ id: N.bob, permissions: [perm(bob, [4, 3])] }]);
    const other = await install(pic, { name: 'sneed_notifications' });
    unwrap(await mon.admin_set_notifications_canister([other]));
    const t = await nowS();
    await a.add_proposal(9n, 'Nobody hears', t - 10n, t + 4n * DAY, [N.bob]);
    const bal = await balanceOf(bob);
    await later(60);
    await round();
    expect((await mon.get_status()).last_error[0][1]).toMatch(/does not accept our messages/);
    expect(await balanceOf(bob)).toBe(bal); // refunded: the check could not be made
    unwrap(await mon.admin_set_notifications_canister([notifId]));
    unwrap(await mon.admin_set_app_id([appId]));
    await round();
    expect((await propsOf(bob)).filter((h) => h.title.includes('#9')).length).toBe(1);
    expect(await balanceOf(bob)).toBe(bal - 18_000n);
  });

  it('refuses queries sent as updates and non-admin admin calls at ingress', async () => {
    const asUpd = (p) => actorAs(pic, asUpdates(monIdl), monId, p);
    for (const q of ['get_status', 'get_recent_errors', 'get_targets', 'get_config', 'get_tuning', 'get_tiers', 'get_admins', 'get_topics', 'get_my_watches', 'get_my_nns_neurons', 'get_deposit_account', 'get_my_balance', 'get_accounting', 'get_billing_config', 'get_api_doc']) {
      expect(await refusedAtIngress(asUpd(bob)[q]()), q).toBe(true);
    }
    expect(await refusedAtIngress(asUpd(bob).get_watch(NNS))).toBe(true);
    expect(await refusedAtIngress(asUpd(bob).get_target_topics(NNS))).toBe(true);
    expect(await refusedAtIngress(asUpd(bob).get_my_charges(0n, 1n))).toBe(true);
    for (const m of ['admin_run_now', 'admin_update_notifications_app', 'admin_register_with_notifications']) expect(await refusedAtIngress(monAs(bob)[m]()), m).toBe(true);
    expect(await refusedAtIngress(monAs(bob).admin_add_admin(bob))).toBe(true);
    expect(await refusedAtIngress(monAs(bob).admin_set_fee_sweep_threshold(1n))).toBe(true);
    for (const m of ['unwatch', 'refresh_my_neurons', 'list_target_topics']) expect(await refusedAtIngress(monAs(anon)[m](NNS)), m).toBe(true);
    expect(await refusedAtIngress(monAs(anon).set_nns_neurons([]))).toBe(true);
    expect(await monAs(bob).get_api_doc()).toContain('https://app.sneeddao.com/api-docs/sneed_mon.md');
  });

  it('upgrades the staging build (1bbee49a): watches kept, the app renamed in place', async () => {
    const oldId = await install(pic, { name: 'sneed_mon_1bbee49a' });
    const old = actorAs(pic, oldMonIdl, oldId, admin);
    const oc = await old.get_config();
    unwrap(await old.admin_set_config({ ...oc, notifications: [notifId], sns_wasm: snswId, interval_s: 3_600n }));
    const oldApp = unwrap(await old.admin_register_with_notifications());
    expect((await notifAs(alice).get_app(oldApp))[0].name).toBe('Sneed Hub');
    for (const p of [bob, grace]) unwrap(await actorAs(pic, oldMonIdl, oldId, p).watch_sns(snsA));
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm('sneed_mon'), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    const up = actorAs(pic, monIdl, oldId, admin);
    const ws = await actorAs(pic, monIdl, oldId, bob).get_my_watches();
    expect(ws.map((w) => [w.target, w.name, w.settings.every_min])).toEqual([[sns(snsA), 'Alpha DAO', 60n]]);
    const [ti] = await up.get_targets();
    expect([ti.watchers, ti.name]).toEqual([2n, 'Alpha DAO']);
    const cfg = await up.get_config();
    expect(cfg.core.notifications.map((p) => p.toText())).toEqual([notifId.toText()]);
    expect((await up.get_status()).app_id).toEqual([oldApp]);
    // the app gets the new name and topics, same id
    unwrap(await up.admin_update_notifications_app());
    const app = (await notifAs(alice).get_app(oldApp))[0];
    expect(app.name).toBe('Sneed Monitor');
    expect(app.topics.map((t) => t.id)).toEqual(['proposals', 'proposal_deadlines', 'account']);
    expect(app.canisters.map((p) => p.toText())).toEqual([oldId.toText()]);
    // the watchers have no balance there: their first check pauses them
    unwrap(await up.admin_set_billing({ ...cfg.billing, icp_ledger: icpId, fee_destination: [] }));
    unwrap(await up.admin_run_now());
    for (let i = 0; i < 40 && (await up.get_status()).running; i++) { await pic.advanceTime(1_500); await pic.tick(2); }
    expect((await actorAs(pic, monIdl, oldId, bob).get_my_balance()).paused).toBe(true);
    expect((await actorAs(pic, monIdl, oldId, bob).get_my_watches()).length).toBe(1);
  });
});
