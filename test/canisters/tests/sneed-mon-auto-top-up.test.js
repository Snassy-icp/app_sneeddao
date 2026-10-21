// Auto top-up in sneed_mon (spec/sneed_mon.md §3): a user approves sneed_mon on the ICP ledger
// (ICRC-2) and sets set_auto_top_up({ amount_e8s, when_below_e8s }). At the start of a round, when
// the balance is below the threshold or can't pay one check of each watch (so before any check
// could pause them), sneed_mon pulls amount_e8s from the user's main account into its own main
// account with icrc2_transfer_from and credits it in full (the user's wallet pays the ledger fee).
// At most once per user per round, at most 50 pulls a round; a refusal (allowance used up or
// expired, wallet empty) is recorded, retried after a day, and told once (topic `account`); the
// approval is the hard cap. Pulls show in the charge history as `auto_top_up` entries.
// MON_WASM=sneed_mon_preatu npx vitest run tests/sneed-mon-auto-top-up.test.js runs it against
// the build before auto top-up (6cfabb63); the auto top-up tests fail there.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, user, unwrap, errOf, wasm, refusedAtIngress, account, principalToSubaccount } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { idlFactory as monIdl } from '../build/sneed_mon.did.js';
import { idlFactory as notifIdl } from '../build/sneed_notifications.did.js';

const MON_WASM = process.env.MON_WASM || 'sneed_mon';
const MIN = 60_000; // ms
const FEE = 10_000n;
const CHECK = 18_000n; // an hourly check at the default tier table
const ICP = 100_000_000n;

// the generated interface, with the auto top-up parts written out (opt where an older build lacks
// them, so the file runs against the build before auto top-up, and fails there)
const fullIdl = ({ IDL: I }) => {
  const fields = Object.fromEntries(monIdl({ IDL: I })._fields);
  const Account = I.Record({ owner: I.Principal, subaccount: I.Opt(I.Vec(I.Nat8)) });
  const Settings = I.Record({ amount_e8s: I.Nat, when_below_e8s: I.Nat, from_subaccount: I.Opt(I.Vec(I.Nat8)) });
  const Failure = I.Record({ at: I.Int, reason: I.Text });
  const MyAuto = I.Record({
    settings: I.Opt(Settings), pulls: I.Nat, pulled_e8s: I.Nat, last_pull_at: I.Int, last_failure: I.Opt(Failure), retry_at: I.Int,
    spender: Account, per_pull_allowance_e8s: I.Nat, min_amount_e8s: I.Nat, max_amount_e8s: I.Nat,
  });
  const Target = I.Variant({ sns: I.Principal, nns: I.Null });
  return I.Service({
    ...fields,
    get_my_balance: I.Func([], [I.Record({ balance_e8s: I.Nat, paused: I.Bool, deposited_e8s: I.Nat, auto_top_up: I.Opt(MyAuto) })], ['query']),
    get_accounting: I.Func([], [I.Record({ user_balances_e8s: I.Nat, fees_available_e8s: I.Nat, obligations_e8s: I.Nat, auto_top_ups: I.Opt(I.Nat), auto_top_ups_e8s: I.Opt(I.Nat) })], ['query']),
    get_my_charges_with_tier: I.Func([I.Nat, I.Nat], [I.Record({ total: I.Nat, entries: I.Vec(I.Record({ at: I.Int, target: Target, every_min: I.Nat, price_e8s: I.Nat, outcome: I.Text, price_tier: I.Text, kind: I.Opt(I.Text) })) })], ['query']),
    set_auto_top_up: I.Func([I.Opt(Settings)], [I.Variant({ ok: I.Text, err: I.Text })], []),
  });
};
const snswIdl = ({ IDL: I }) => I.Service({ set_instances: I.Func([I.Vec(I.Tuple(I.Principal, I.Principal))], [], []) });

let pic, monId, notifId, icpId, snsA, snswId, appId;
let mon, monAs, icp, notifAs;

const later = async (minutes) => { await pic.advanceTime(minutes * MIN); await pic.tick(2); };
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
async function drain(m = mon) {
  for (let i = 0; i < 60 && (await m.get_status()).running; i++) { await pic.advanceTime(1_500); await pic.tick(2); }
  expect((await m.get_status()).running).toBe(false);
}
async function round(m = mon) { await drain(m); unwrap(await m.admin_run_now()); await drain(m); }
const ledgerAs = (p) => actorAs(pic, ledgerIdl, icpId, p);
const wallet = (p) => icp.icrc1_balance_of(account(p));
async function approve(p, amount, expiresAt = null, spender = monId, sub = null) {
  return unwrap(await ledgerAs(p).icrc2_approve({ from_subaccount: sub ? [sub] : [], spender: account(spender), amount, expected_allowance: [], expires_at: expiresAt === null ? [] : [expiresAt], fee: [], memo: [], created_at_time: [] }));
}
const allowance = async (p, spender = monId) => (await icp.icrc2_allowance({ account: account(p), spender: account(spender) })).allowance;
async function fund(p, e8s, id = monId) {
  await icp.mint(account(id, principalToSubaccount(p)), e8s);
  return unwrap(await actorAs(pic, fullIdl, id, p).credit_deposit());
}
// a user who watches snsA hourly with exactly one check paid, a wallet of 1 ICP, Sneed Monitor allowed
async function newWatcher(name) {
  const p = user(`mon-atu-${name}`);
  unwrap(await notifAs(p).allow_app(appId, true));
  await icp.mint(account(p), ICP);
  await fund(p, FEE + CHECK);
  unwrap(await monAs(p).watch({ sns: snsA }));
  return p;
}
const bal = async (p) => (await monAs(p).get_my_balance());
const auto = async (p) => (await bal(p)).auto_top_up[0];
const set = async (p, amount, below, sub = null) => monAs(p).set_auto_top_up([{ amount_e8s: amount, when_below_e8s: below, from_subaccount: sub ? [sub] : [] }]);
const accountNotes = async (p) => (await notifAs(p).get_my_history(200n)).filter((h) => h.app_name === 'Sneed Monitor' && h.topic === 'account').map((h) => h.title);
const txsFrom = async (p) => (await icp.get_transactions()).filter((t) => t.from.owner.toText() === p.toText() && t.to.owner.toText() === monId.toText());
// sneed_mon's main account holds exactly what it owes (user balances + fees not forwarded)
async function expectSolvent() {
  const acc = await mon.get_accounting();
  expect(acc.obligations_e8s).toBe(acc.user_balances_e8s + acc.fees_available_e8s);
  expect(await icp.icrc1_balance_of(account(monId))).toBe(acc.obligations_e8s);
}

describe(`sneed_mon auto top-up (${MON_WASM})`, () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    notifId = await install(pic, { name: 'sneed_notifications' });
    snswId = await install(pic, { name: 'MockForumSnsW' });
    snsA = await install(pic, { name: 'MockMonSns' });
    icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE, symbol: 'ICP', decimals: 8 }] });
    monId = await install(pic, { name: MON_WASM });
    mon = actorAs(pic, fullIdl, monId, admin);
    monAs = (p) => actorAs(pic, fullIdl, monId, p);
    notifAs = (p) => actorAs(pic, notifIdl, notifId, p);
    icp = actorAs(pic, ledgerIdl, icpId, admin);
    await actorAs(pic, snswIdl, snswId, admin).set_instances([[snsA, snsA]]);
    const n = actorAs(pic, notifIdl, notifId, admin);
    unwrap(await n.admin_set_config({ ...(await n.get_config()), default_daily_cap: 1_000n }));
    const cfg = await mon.get_config();
    // rounds only when a test runs one (the timer's interval is a week)
    unwrap(await mon.admin_set_config({ ...cfg.core, notifications: [notifId], sns_wasm: snswId, interval_s: 604_800n }));
    unwrap(await mon.admin_set_billing({ ...cfg.billing, icp_ledger: icpId, fee_destination: [] }));
    appId = unwrap(await mon.admin_register_with_notifications());
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('validates the settings; off by default; the anonymous principal is refused', async () => {
    const p = user('mon-atu-val');
    const a = await auto(p);
    expect(a.settings).toEqual([]);
    expect([a.pulls, a.min_amount_e8s, a.max_amount_e8s, a.spender.owner.toText()]).toEqual([0n, 10n * FEE, 100n * ICP, monId.toText()]);
    expect(errOf(await set(p, 10n * FEE - 1n, 0n))).toMatch(/at least 10 ledger fees/);
    expect(errOf(await set(p, 100n * ICP + 1n, 0n))).toMatch(/at most 100/);
    expect(errOf(await set(p, 10n * FEE, 100n * ICP + 1n))).toMatch(/threshold is at most/);
    expect(errOf(await set(p, 10n * FEE, 0n, new Uint8Array(31)))).toMatch(/32 bytes/);
    expect(unwrap(await monAs(p).set_auto_top_up([]))).toMatch(/off/);
    expect(unwrap(await set(p, 10n * FEE, 0n))).toMatch(/Auto top-up on/);
    const b = await auto(p);
    expect(b.settings).toEqual([{ amount_e8s: 10n * FEE, when_below_e8s: 0n, from_subaccount: [] }]);
    expect(b.per_pull_allowance_e8s).toBe(11n * FEE);
    expect(await refusedAtIngress(monAs(Principal.anonymous()).set_auto_top_up([]))).toBe(true);
  });

  it('pulls the top-up when the balance falls below the threshold, credited in full and listed in the history', async () => {
    const p = await newWatcher('below');
    await fund(p, FEE + 92_000n); // 110,000 in all
    await approve(p, 500_000n);
    unwrap(await set(p, 200_000n, 100_000n));
    await round(); // 110,000 is not below 100,000: no pull; one check
    expect((await bal(p)).balance_e8s).toBe(110_000n - CHECK);
    expect((await auto(p)).pulls).toBe(0n);
    const w0 = await wallet(p);
    await later(61);
    await round(); // 92,000 < 100,000: pulled first, then the check
    expect((await bal(p)).balance_e8s).toBe(110_000n - CHECK + 200_000n - CHECK);
    const a = await auto(p);
    expect([a.pulls, a.pulled_e8s, a.last_failure]).toEqual([1n, 200_000n, []]);
    expect(await wallet(p)).toBe(w0 - 200_000n - FEE); // the wallet pays the ledger fee
    expect(await allowance(p)).toBe(500_000n - 210_000n);
    const h = await monAs(p).get_my_charges_with_tier(0n, 10n);
    expect(h.entries.map((e) => [e.kind[0], e.price_e8s])).toEqual([['check', CHECK], ['auto_top_up', 200_000n], ['check', CHECK]]);
    expect(h.entries[1].outcome).toMatch(/^Auto top-up: \+0\.00200000 ICP from your wallet \(ledger block \d+\)$/);
    expect((await bal(p)).deposited_e8s).toBe(110_000n + 200_000n);
    const acc = await mon.get_accounting();
    expect([acc.auto_top_ups, acc.auto_top_ups_e8s]).toEqual([[1n], [200_000n]]);
    await expectSolvent();
  });

  it('pulls before a check would pause the user, so they are never paused', async () => {
    const p = await newWatcher('prepause');
    await approve(p, ICP);
    unwrap(await set(p, 100_000n, 0n));
    await round(); // the one paid check: balance 0
    expect((await bal(p)).balance_e8s).toBe(0n);
    await later(61);
    await round(); // can't pay the next check: pulled first
    const b = await bal(p);
    expect([b.paused, b.balance_e8s]).toEqual([false, 100_000n - CHECK]);
    expect((await auto(p)).pulls).toBe(1n);
    await later(61);
    await round();
    expect(await accountNotes(p)).toEqual([]); // no pause, no notice
    await expectSolvent();
  });

  it('without an approval: one failure notice, retried after a day, then the pause path; fixed by approving', async () => {
    const p = await newWatcher('noapproval');
    unwrap(await set(p, 100_000n, 0n));
    await round(); // the paid check
    await later(61);
    await round(); // the pull is refused; the check can't be paid: paused
    let b = await bal(p);
    expect([b.paused, b.balance_e8s]).toEqual([true, 0n]);
    const f = b.auto_top_up[0].last_failure[0];
    expect(f.reason).toMatch(/no allowance left/);
    expect(b.auto_top_up[0].retry_at).toBe(f.at + 86_400_000_000_000n);
    expect(await accountNotes(p)).toEqual([`Auto top-up failed: ${f.reason}`]);
    await later(61);
    await round(); // no retry within the day; the pause notice goes out
    expect((await auto(p)).last_failure[0].at).toBe(f.at);
    expect(await accountNotes(p)).toEqual(['Monitoring paused: top up', `Auto top-up failed: ${f.reason}`]);
    await later(25 * 60);
    await round(); // a day on: retried, refused again, not told again
    expect((await auto(p)).last_failure[0].at > f.at).toBe(true);
    expect((await accountNotes(p)).length).toBe(2);
    expect(await txsFrom(p)).toEqual([]);
    // the user approves and saves again: the next round pulls and monitoring resumes
    await approve(p, ICP);
    unwrap(await set(p, 100_000n, 0n));
    await round();
    b = await bal(p);
    expect([b.paused, b.balance_e8s, b.auto_top_up[0].pulls, b.auto_top_up[0].last_failure]).toEqual([false, 100_000n - CHECK, 1n, []]);
    await expectSolvent();
  });

  it('stops pulling once the allowance is used up (the approval is the hard cap)', async () => {
    const p = await newWatcher('cap');
    await approve(p, 100_000n + FEE); // exactly one pull
    unwrap(await set(p, 100_000n, ICP)); // always below the threshold
    await round(); // pulled
    expect((await auto(p)).pulls).toBe(1n);
    expect(await allowance(p)).toBe(0n);
    await later(61);
    await round(); // refused: the allowance is used up
    const f = (await auto(p)).last_failure[0];
    expect(f.reason).toMatch(/no allowance left/);
    await later(61);
    await round(); // not tried again within the day
    await later(61);
    await round();
    const a = await auto(p);
    expect([a.pulls, a.pulled_e8s, a.last_failure[0].at]).toEqual([1n, 100_000n, f.at]);
    expect((await txsFrom(p)).map((t) => t.amount)).toEqual([100_000n]);
    expect((await accountNotes(p)).filter((t) => t.startsWith('Auto top-up failed')).length).toBe(1);
    await expectSolvent();
  });

  it('an expired approval stops the pulls', async () => {
    const p = await newWatcher('expired');
    await approve(p, ICP, (await nowNs()) + 30n * 60n * 1_000_000_000n); // expires in 30 minutes
    unwrap(await set(p, 100_000n, 0n));
    await round(); // the paid check
    await later(61);
    await round(); // the approval has expired
    const b = await bal(p);
    expect(b.paused).toBe(true);
    expect(b.auto_top_up[0].last_failure[0].reason).toMatch(/expired/);
    expect(await txsFrom(p)).toEqual([]);
  });

  it('pulls from a subaccount when set: an approval from that subaccount works, one on the main account does not', async () => {
    const sub = new Uint8Array(32); sub[31] = 7; // subaccount index 7
    const subAcct = { owner: null, subaccount: [sub] };
    const p = await newWatcher('subacct');
    await icp.mint({ ...subAcct, owner: p }, 300_000n); // the limited funds
    await approve(p, ICP); // approved on the main account only
    unwrap(await set(p, 100_000n, 0n, sub));
    expect((await auto(p)).settings[0].from_subaccount).toEqual([sub]);
    await round(); // the paid check
    await later(61);
    await round(); // the main-account approval does not cover the subaccount: refused, paused
    let b = await bal(p);
    expect(b.paused).toBe(true);
    expect(b.auto_top_up[0].last_failure[0].reason).toMatch(/no allowance left/);
    expect(await allowance(p)).toBe(ICP); // the main account's approval untouched
    // approve from the subaccount and save again: pulled from there, the main account untouched
    const main0 = await wallet(p);
    await approve(p, 250_000n, null, monId, sub);
    unwrap(await set(p, 100_000n, 0n, sub));
    await round();
    b = await bal(p);
    expect([b.paused, b.balance_e8s, b.auto_top_up[0].pulls]).toEqual([false, 100_000n - CHECK, 1n]);
    expect(await icp.icrc1_balance_of({ owner: p, subaccount: [sub] })).toBe(300_000n - FEE - 100_000n - FEE); // approve fee + pull + fee
    expect(await wallet(p)).toBe(main0);
    expect(await allowance(p)).toBe(ICP);
    await expectSolvent();
  });

  it('pulls at most once per user per round, even while still below the threshold', async () => {
    const p = await newWatcher('perround');
    await approve(p, ICP);
    unwrap(await set(p, 100_000n, 10n * ICP));
    const r0 = (await mon.get_status()).rounds;
    for (let i = 0; i < 3; i++) await round();
    expect((await mon.get_status()).rounds - r0).toBe(3n);
    expect((await auto(p)).pulls).toBe(3n);
    expect(await allowance(p)).toBe(ICP - 3n * (100_000n + FEE));
    await expectSolvent();
  });

  it('turned off (or never on): no pulls, the pause path as before', async () => {
    const p = await newWatcher('off');
    const q = await newWatcher('never');
    await approve(p, ICP);
    await approve(q, ICP);
    unwrap(await set(p, 100_000n, ICP));
    unwrap(await monAs(p).set_auto_top_up([]));
    expect((await auto(p)).settings).toEqual([]);
    await round();
    await later(61);
    await round();
    for (const x of [p, q]) {
      const b = await bal(x);
      expect([b.paused, b.balance_e8s, b.auto_top_up[0].pulls]).toEqual([true, 0n, 0n]);
      expect(await txsFrom(x)).toEqual([]);
      expect(await allowance(x)).toBe(ICP);
    }
    await expectSolvent();
  });

  it('upgrades from the build before auto top-up (state kept), and keeps the settings over an upgrade', async () => {
    const oldId = await install(pic, { name: 'sneed_mon_preatu' });
    const old = actorAs(pic, fullIdl, oldId, admin);
    const cfg = await old.get_config();
    unwrap(await old.admin_set_config({ ...cfg.core, notifications: [notifId], sns_wasm: snswId, interval_s: 604_800n }));
    unwrap(await old.admin_set_billing({ ...cfg.billing, icp_ledger: icpId, fee_destination: [] }));
    const p = user('mon-atu-upgrade');
    await icp.mint(account(p), ICP);
    await fund(p, FEE + 50_000n, oldId);
    unwrap(await actorAs(pic, fullIdl, oldId, p).watch({ sns: snsA }));
    const keep = { upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } };
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(MON_WASM), ...keep });
    const as = actorAs(pic, fullIdl, oldId, p);
    expect((await as.get_my_balance()).balance_e8s).toBe(50_000n);
    expect((await as.get_my_watches()).length).toBe(1);
    expect((await as.get_my_balance()).auto_top_up[0].settings).toEqual([]);
    await approve(p, ICP, null, oldId);
    unwrap(await as.set_auto_top_up([{ amount_e8s: 200_000n, when_below_e8s: 100_000n, from_subaccount: [] }]));
    await round(old); // 50,000 < 100,000: pulled
    expect((await as.get_my_balance()).auto_top_up[0].pulls).toBe(1n);
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(MON_WASM), ...keep });
    const a = (await as.get_my_balance()).auto_top_up[0];
    expect([a.settings, a.pulls, a.pulled_e8s]).toEqual([[{ amount_e8s: 200_000n, when_below_e8s: 100_000n, from_subaccount: [] }], 1n, 200_000n]);
    expect((await old.get_accounting()).auto_top_ups).toEqual([1n]);
  });
});
