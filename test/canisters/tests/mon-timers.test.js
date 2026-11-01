// sneed_mon's round timer (2026-11-01). The canister used to run a recurring timer every
// interval_s (600 s) whether or not anyone watched anything, and also while admin-paused (the round
// returned at once): each Motoko timer run costs ~35 M cycles, ~5 B a day for nothing. Now rounds
// run on the same grid (install or upgrade time plus multiples of interval_s) only while they have
// work (a paid-up watch, a paused user whose balance pays again, a notice to send, a top-up or fee
// forward to retry, an open round); with none, or admin-paused, no timer is armed. What an idle
// canister still burns here (~190 M an hour) is the PocketIC floor plus the ICRC-3 library's
// 15-minute spill timer (src/icrc3/Log.mo ensureTimer, changed separately).
//
// The idle-cost tests also run against the build before the change, where they fail:
//   MON_WASM=sneed_mon_preidle npx vitest run tests/mon-timers.test.js -t "idle:"
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, admin, bob, user, unwrap, wasm, refusedAtIngress, account, principalToSubaccount } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { idlFactory as monIdl } from '../build/sneed_mon.did.js';
import { idlFactory as notifIdl } from '../build/sneed_notifications.did.js';

const MON_WASM = process.env.MON_WASM || 'sneed_mon';
const PREV_WASM = 'sneed_mon_preidle'; // main before this change (what staging runs)
const KEEP = { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] };
const FEE = 10_000n;
const CHECK = 18_000n; // an hourly check at the default tier table
const MIN = 60_000; // ms
const INTERVAL_NS = 600_000_000_000n;
const SLACK = 1_000_000_000n; // the test reads PocketIC time in milliseconds
const snswIdl = ({ IDL: I }) => I.Service({ set_instances: I.Func([I.Vec(I.Tuple(I.Principal, I.Principal))], [], []) });
const nowNs = async (pic) => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const M = (c) => `${(Number(c) / 1e6).toFixed(1)} M`;

/// sneed_mon (`name`) with Sneed Notifications, a mock SNS and a mock ICP ledger, registered as
/// the app; the default interval (600 s)
async function world(pic, name) {
  const notifId = await install(pic, { name: 'sneed_notifications' });
  const snswId = await install(pic, { name: 'MockForumSnsW' });
  const snsA = await install(pic, { name: 'MockMonSns' });
  const icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE, symbol: 'ICP', decimals: 8 }] });
  const monId = await install(pic, { name });
  const as = (p, id = monId) => actorAs(pic, monIdl, id, p);
  const mon = as(admin);
  const notifAs = (p) => actorAs(pic, notifIdl, notifId, p);
  const icp = actorAs(pic, ledgerIdl, icpId, admin);
  await actorAs(pic, snswIdl, snswId, admin).set_instances([[snsA, snsA]]);
  const setup = async (m) => {
    const cfg = await m.get_config();
    unwrap(await m.admin_set_config({ ...cfg.core, notifications: [notifId], sns_wasm: snswId }));
    unwrap(await m.admin_set_billing({ ...cfg.billing, icp_ledger: icpId, fee_destination: [] }));
    return unwrap(await m.admin_register_with_notifications());
  };
  const appId = await setup(mon);
  const fund = async (p, e8s, id = monId) => {
    await icp.mint(account(id, principalToSubaccount(p)), e8s);
    return unwrap(await as(p, id).credit_deposit());
  };
  return { notifId, snswId, snsA, icpId, monId, as, mon, notifAs, icp, appId, setup, fund };
}

/// Cycles burned in one hour of 30-second steps.
async function burnOneHour(pic, id) {
  const b0 = BigInt(await pic.getCyclesBalance(id));
  for (let i = 0; i < 120; i++) { await pic.advanceTime(30_000); await pic.tick(2); }
  return b0 - BigInt(await pic.getCyclesBalance(id));
}

describe(`an idle sneed_mon (${MON_WASM})`, () => {
  let pic, w;
  beforeAll(async () => {
    ({ pic } = await createPic());
    w = await world(pic, MON_WASM);
    // someone watched and left, as on staging: nothing to watch now
    const p = user('mon-idle-left');
    unwrap(await w.notifAs(p).allow_app(w.appId, true));
    await w.fund(p, FEE + 2n * CHECK);
    unwrap(await w.as(p).watch({ sns: w.snsA }));
    unwrap(await w.mon.admin_run_now());
    for (let i = 0; i < 10; i++) { await pic.advanceTime(1_500); await pic.tick(2); }
    unwrap(await w.as(p).unwatch({ sns: w.snsA }));
    await pic.advanceTime(10 * MIN); await pic.tick(3);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('idle: with no watches it burns under 250 M cycles an hour (the old 10-minute round timer: ~470 M)', async () => {
    const hour1 = await burnOneHour(pic, w.monId);
    const hour2 = await burnOneHour(pic, w.monId);
    const rounds = (await w.mon.get_status()).rounds;
    console.log(`${MON_WASM} idle: ${M(hour1)} and ${M(hour2)} cycles an hour (${(Number(hour2) * 24 / 1e9).toFixed(2)} B a day at this subnet's prices), ${rounds} rounds so far`);
    expect(hour2).toBeLessThan(250_000_000n);
  }, 600_000);

  it('idle: admin-paused with a watch it burns under 250 M cycles an hour (the old timer ran on while paused: ~370 M)', async () => {
    const p = user('mon-idle-paused');
    unwrap(await w.notifAs(p).allow_app(w.appId, true));
    await w.fund(p, FEE + 100n * CHECK);
    unwrap(await w.as(p).watch({ sns: w.snsA }));
    unwrap(await w.mon.admin_pause());
    await pic.advanceTime(10 * MIN); await pic.tick(3);
    const r0 = (await w.mon.get_status()).rounds;
    const hour = await burnOneHour(pic, w.monId);
    console.log(`${MON_WASM} admin-paused: ${M(hour)} cycles an hour`);
    expect((await w.mon.get_status()).rounds).toBe(r0);
    expect(hour).toBeLessThan(250_000_000n);
    unwrap(await w.mon.admin_resume());
  }, 600_000);
});

describe('the round timer', () => {
  let pic, w, mon;
  const timer = () => mon.get_timer_status();
  const rounds = async () => (await mon.get_status()).rounds;
  const balance = async (p) => (await w.as(p).get_my_balance()).balance_e8s;
  /// time moves to the armed round time (and the round runs to its end)
  async function toNextRun() {
    const t = await timer();
    expect(t.next_run_at).toHaveLength(1);
    const ms = Number((t.next_run_at[0] - (await nowNs(pic))) / 1_000_000n) + 1_000;
    await pic.advanceTime(Math.max(ms, 0)); await pic.tick(3);
    for (let i = 0; i < 40 && (await mon.get_status()).running; i++) { await pic.advanceTime(1_500); await pic.tick(2); }
  }
  async function expectIdle(minutes = 60) {
    expect((await timer()).next_run_at).toEqual([]);
    const r = await rounds();
    for (let i = 0; i < minutes / 10; i++) { await pic.advanceTime(10 * MIN); await pic.tick(2); }
    expect(await rounds()).toBe(r);
  }
  async function watcher(name, e8s) {
    const p = user(`mon-timers-${name}`);
    unwrap(await w.notifAs(p).allow_app(w.appId, true));
    await w.fund(p, e8s);
    unwrap(await w.as(p).watch({ sns: w.snsA }));
    return p;
  }

  beforeAll(async () => {
    ({ pic } = await createPic());
    w = await world(pic, 'sneed_mon');
    mon = w.mon;
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('arms nothing with nothing to watch; get_timer_status is a public query', async () => {
    const t = await timer();
    expect(t).toMatchObject({ paused: false, next_run_at: [], recurring: false, interval_s: 600n, round_open: false, running: false });
    await expectIdle();
    expect(await refusedAtIngress(actorAs(pic, ({ IDL: I }) => I.Service({ get_timer_status: I.Func([], [I.Reserved], []) }), w.monId, bob).get_timer_status())).toBe(true);
  });

  let p;
  it('a new watch starts rounds at the next interval of the grid, then every interval; checks charged as before', async () => {
    const r0 = await rounds();
    p = await watcher('first', FEE + 3n * CHECK);
    const t = await timer();
    const due = t.next_run_at[0] - (await nowNs(pic));
    expect(due).toBeGreaterThan(0n);
    expect(due).toBeLessThanOrEqual(INTERVAL_NS + SLACK);
    expect(t.recurring).toBe(false);
    await toNextRun();
    expect(await rounds()).toBe(r0 + 1n);
    expect(await balance(p)).toBe(2n * CHECK); // the first check, charged in the first round
    const t2 = await timer();
    expect(t2.recurring).toBe(true);
    expect(t2.next_run_at[0] - t.next_run_at[0]).toBeGreaterThanOrEqual(INTERVAL_NS);
    expect(t2.next_run_at[0] - t.next_run_at[0]).toBeLessThan(INTERVAL_NS + 60_000_000_000n);
    // an hour of rounds every 10 minutes: one more hourly check
    for (let i = 0; i < 6; i++) await toNextRun();
    expect(await rounds()).toBe(r0 + 7n);
    expect(await balance(p)).toBe(CHECK);
  }, 120_000);

  it('admin_pause stops the timer entirely, admin_resume starts it again', async () => {
    unwrap(await mon.admin_pause());
    expect(await timer()).toMatchObject({ paused: true, next_run_at: [] });
    await expectIdle();
    unwrap(await mon.admin_resume());
    const t = await timer();
    expect(t.paused).toBe(false);
    expect(t.next_run_at[0] - (await nowNs(pic))).toBeLessThanOrEqual(INTERVAL_NS + SLACK);
    const r = await rounds();
    await toNextRun();
    expect(await rounds()).toBe(r + 1n);
  }, 120_000);

  it('a user paused for balance: the notice goes out, then the timer stops; a deposit starts it again', async () => {
    // the next hourly check takes the last CHECK; the one after can't be paid: paused
    for (let i = 0; i < 14 && !(await w.as(p).get_my_balance()).paused; i++) await toNextRun();
    expect((await w.as(p).get_my_balance()).paused).toBe(true);
    expect(await balance(p)).toBe(0n);
    await toNextRun(); // the round that sends the "monitoring paused" notice
    const notes = (await w.notifAs(p).get_my_history(200n)).filter((h) => h.app_name === 'Sneed Monitor' && h.topic === 'account');
    expect(notes.map((h) => h.title)).toEqual(['Monitoring paused: top up']);
    await expectIdle();
    await w.fund(p, FEE + 2n * CHECK); // credit_deposit resumes the user
    expect((await w.as(p).get_my_balance()).paused).toBe(false);
    const r = await rounds();
    await toNextRun();
    expect(await rounds()).toBe(r + 1n);
    expect(await balance(p)).toBe(CHECK);
  }, 240_000);

  it('the last watch removed: the timer stops at once', async () => {
    unwrap(await w.as(p).unwatch({ sns: w.snsA }));
    await expectIdle();
  }, 120_000);

  it('an interval change restarts the grid from now (only armed when there is work)', async () => {
    unwrap(await mon.admin_set_interval(3_600n));
    expect((await timer()).next_run_at).toEqual([]);
    const q = await watcher('hourly', FEE + 2n * CHECK);
    const due = (await timer()).next_run_at[0] - (await nowNs(pic));
    expect(due).toBeGreaterThan(0n);
    expect(due).toBeLessThanOrEqual(3_600_000_000_000n + SLACK);
    const r = await rounds();
    await toNextRun();
    expect(await rounds()).toBe(r + 1n);
    unwrap(await w.as(q).unwatch({ sns: w.snsA }));
    unwrap(await mon.admin_set_interval(600n));
    await expectIdle(30);
  }, 120_000);

  it('an upgrade with keep arms the timer again when there are watches, and not without', async () => {
    await pic.upgradeCanister({ sender: admin, canisterId: w.monId, wasm: wasm('sneed_mon'), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    await pic.tick(2);
    expect((await timer()).next_run_at).toEqual([]);
    const q = await watcher('upgrade', FEE + 3n * CHECK);
    await pic.upgradeCanister({ sender: admin, canisterId: w.monId, wasm: wasm('sneed_mon'), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    await pic.tick(2);
    const t = await timer();
    expect(t.next_run_at[0] - (await nowNs(pic))).toBeLessThanOrEqual(INTERVAL_NS + SLACK);
    const r = await rounds();
    const b = await balance(q);
    await toNextRun();
    expect(await rounds()).toBe(r + 1n);
    expect(await balance(q)).toBe(b - CHECK);
    // paused across an upgrade: still nothing armed
    unwrap(await mon.admin_pause());
    await pic.upgradeCanister({ sender: admin, canisterId: w.monId, wasm: wasm('sneed_mon'), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    await pic.tick(2);
    expect(await timer()).toMatchObject({ paused: true, next_run_at: [] });
    unwrap(await mon.admin_resume());
    unwrap(await w.as(q).unwatch({ sns: w.snsA }));
  }, 180_000);
});

describe(`the upgrade with keep from ${PREV_WASM}`, () => {
  let pic;
  beforeAll(async () => { ({ pic } = await createPic()); });
  afterAll(async () => { await pic?.tearDown(); });

  it('a watcher keeps their balance and watch, and rounds go on at the interval', async () => {
    const w = await world(pic, PREV_WASM);
    const p = user('mon-timers-old');
    unwrap(await w.notifAs(p).allow_app(w.appId, true));
    await w.fund(p, FEE + 3n * CHECK);
    unwrap(await w.as(p).watch({ sns: w.snsA }));
    await pic.advanceTime(10 * MIN + 1_000); await pic.tick(3);
    for (let i = 0; i < 20 && (await w.mon.get_status()).running; i++) { await pic.advanceTime(1_500); await pic.tick(2); }
    expect((await w.as(p).get_my_balance()).balance_e8s).toBe(2n * CHECK);
    const before = JSON.stringify(await w.as(p).get_my_watches(), (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    await pic.upgradeCanister({ sender: admin, canisterId: w.monId, wasm: wasm('sneed_mon'), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    await pic.tick(2);
    expect(JSON.stringify(await w.as(p).get_my_watches(), (_, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(before);
    const t = await w.mon.get_timer_status();
    expect(t.next_run_at[0] - (await nowNs(pic))).toBeLessThanOrEqual(INTERVAL_NS + SLACK);
    // an hour later the next hourly check is charged by the timer's rounds
    for (let i = 0; i < 6; i++) { await pic.advanceTime(10 * MIN + 1_000); await pic.tick(3); }
    for (let i = 0; i < 20 && (await w.mon.get_status()).running; i++) { await pic.advanceTime(1_500); await pic.tick(2); }
    expect((await w.as(p).get_my_balance()).balance_e8s).toBe(CHECK);
  }, 240_000);
});
