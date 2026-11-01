// sneed_notifications' timers (2026-10-30). The canister used to run a recurring 30-second timer
// whether or not there was anything to do; each run is a few messages with a base fee each, so an
// idle canister burned ~4.3 B cycles an hour here (~100 B a day; ~200 B a day on its subnet on
// mainnet). Now one one-shot work timer is armed only for work that is due (Sneed SMS jobs, relay
// leases, fee checks and withdrawal retries while they have work, a full ICRC-3 live store) plus an
// hourly housekeeping run, and admins can pause and resume it.
//
// The idle-cost test also runs against the build before the change, where it fails:
//   NOTIF_WASM=sneed_notifications_preidle npx vitest run tests/notifications-timers.test.js -t "idle:"
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, admin, alice, bob, carol, user, unwrap, errOf, wasm, refusedAtIngress, account } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { icrc3Service, fetchBlocks, archiveIdl, btype, txField } from '../lib/icrc3.js';
import { idlFactory as notifIdl } from '../build/sneed_notifications.did.js';
import { idlFactory as smsIdl } from '../build/sneed_sms.did.js';

const NOTIF_WASM = process.env.NOTIF_WASM || 'sneed_notifications';
const PREV_WASM = 'sneed_notifications_preidle'; // main before this change (what staging and production run)
const KEEP = { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] };
const FEE = 10_000n;
const MIN = 60_000;
const relay = user('notif-timers-discord-relay');
const senderIdl = ({ IDL: I }) => I.Service({ forward: I.Func([I.Principal, I.Text, I.Vec(I.Nat8)], [I.Vec(I.Nat8)], []) });
const fullIdl = ({ IDL: I }) => I.Service({ ...Object.fromEntries(notifIdl({ IDL: I })._fields), ...icrc3Service(I) });
const svc = notifIdl({ IDL });
const ser = (x) => JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
const nowNs = async (pic) => BigInt(Math.round(await pic.getTime())) * 1_000_000n;

/// sneed_notifications (`name`), Sneed SMS, a mock ICP ledger and an app canister; bob allows the app
async function world(pic, name) {
  const notifId = await install(pic, { name });
  const smsId = await install(pic, { name: 'sneed_sms' });
  const icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE, symbol: 'ICP', decimals: 8 }] });
  const senderId = await install(pic, { name: 'MockNotifySender', controllers: [alice], sender: alice });
  const as = (p) => actorAs(pic, fullIdl, notifId, p);
  const n = as(admin);
  const icp = actorAs(pic, ledgerIdl, icpId, admin);
  const asApp = async (method, ...args) => {
    const f = svc._fields.find(([k]) => k === method)[1];
    return IDL.decode(f.retTypes, await actorAs(pic, senderIdl, senderId, alice).forward(notifId, method, IDL.encode(f.argTypes, args)))[0];
  };
  unwrap(await actorAs(pic, smsIdl, smsId, admin).add_authorized_sender(notifId));
  const c = await n.get_config();
  // relay deliveries free here (bob has no balance), so they are queued rather than suppressed
  unwrap(await n.admin_set_config({ ...c, sneed_sms: smsId, icp_ledger: icpId, relays: [[relay, { discord: null }]], prices_e8s: c.prices_e8s.map(([k]) => [k, 0n]) }));
  const appId = unwrap(await as(alice).register_app({ name: 'Timers Test', logo: [], description: '', canisters: [senderId], topics: [{ id: 'alert', title: 'Alert', description: '', level: { urgent: null } }] }));
  unwrap(await as(bob).allow_app(appId, true));
  const [[, p]] = await as(bob).get_my_apps();
  unwrap(await as(bob).set_permission(appId, { ...p, daily_cap: 10_000n }));
  unwrap(await as(bob).set_low_balance_alert(0n));
  let seq = 0;
  const notify = (over = {}) => asApp('notify', { user: bob, topic: 'alert', title: 'Alert', body: 'x', link: [], dedupe: [`d${seq++}`], sponsored: false, ...over });
  const receipt = async (id) => Object.keys((await asApp('get_receipts', [id]))[0][0].state)[0];
  const inbox = () => actorAs(pic, smsIdl, smsId, bob).get_received_messages();
  return { notifId, smsId, icpId, senderId, as, n, icp, asApp, appId, notify, receipt, inbox };
}

/// Cycles burned in one hour of 30-second steps (each step: time moves on, a few rounds run).
async function burnOneHour(pic, id) {
  const b0 = BigInt(await pic.getCyclesBalance(id));
  for (let i = 0; i < 120; i++) { await pic.advanceTime(30_000); await pic.tick(2); }
  return b0 - BigInt(await pic.getCyclesBalance(id));
}
const M = (c) => `${(Number(c) / 1e6).toFixed(1)} M`;

describe('an idle canister', () => {
  let pic, w;
  beforeAll(async () => {
    ({ pic } = await createPic());
    w = await world(pic, NOTIF_WASM);
    // a few delivered notifications, as on staging (15) and production (81), then nothing to do
    for (let i = 0; i < 3; i++) expect((await w.notify()).ok.deliveries).toBe(1n);
    for (let i = 0; i < 12; i++) { await pic.advanceTime(30_000); await pic.tick(3); } // deliveries, the first fee check
    expect((await w.n.stats()).pending).toBe(0n);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('idle: burns under 400 M cycles an hour (the old 30-second timer: ~4.3 B)', async () => {
    const hour1 = await burnOneHour(pic, w.notifId);
    const hour2 = await burnOneHour(pic, w.notifId);
    const s = await pic.canisterStatus({ canisterId: w.notifId, sender: admin });
    console.log(`${NOTIF_WASM} idle: ${M(hour1)} and ${M(hour2)} cycles an hour (${M(hour2 / 120n)} per 30 s, ${(Number(hour2) * 24 / 1e9).toFixed(1)} B a day at this subnet's prices); wasm memory ${s.memoryMetrics.wasmMemorySize} bytes`);
    expect(hour2).toBeLessThan(400_000_000n);
  }, 600_000);
});

describe('the work timer', () => {
  let pic, w;
  beforeAll(async () => {
    ({ pic } = await createPic());
    w = await world(pic, NOTIF_WASM);
    for (let i = 0; i < 2; i++) { await pic.advanceTime(31_000); await pic.tick(3); } // the first run after the install: the fee books
    await pic.advanceTime(5 * MIN + 1_000); await pic.tick(3);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  const timer = () => w.n.get_timer_status();
  /// idle: no work run armed, only the hourly housekeeping
  const expectIdle = async () => {
    const t = await timer();
    expect(t.paused).toBe(false);
    expect(t.next_run_at).toEqual([]);
    const now = await nowNs(pic);
    expect(t.next_housekeeping_at[0]).toBeGreaterThan(now);
    expect(t.next_housekeeping_at[0] - now).toBeLessThanOrEqual(3_600_001_000_000n);
  };

  it('is idle with nothing to do: only the hourly housekeeping is armed, a public query', async () => {
    await expectIdle();
    // the housekeeping runs every hour and leaves nothing armed
    const t0 = await timer();
    await pic.advanceTime(Number((t0.next_housekeeping_at[0] - (await nowNs(pic))) / 1_000_000n) + 1_000); await pic.tick(3);
    const t1 = await timer();
    expect(t1.last_housekeeping_at).toBeGreaterThanOrEqual(t0.next_housekeeping_at[0]);
    expect(t1.last_tick_at).toBe(t0.last_tick_at); // no work run
    await expectIdle();
    expect(await refusedAtIngress(actorAs(pic, ({ IDL: I }) => I.Service({ get_timer_status: I.Func([], [I.Reserved], []) }), w.notifId, bob).get_timer_status())).toBe(true);
  });

  it('delivers to Sneed SMS right after notify, without waiting for time to pass', async () => {
    const r = await w.notify({ title: 'Immediate' });
    await pic.tick(5);
    expect(await w.receipt(r.ok.id)).toBe('delivered');
    expect((await w.inbox()).some((m) => m.subject === '[Timers Test] Immediate')).toBe(true);
    await expectIdle();
  });

  it('retries a failed Sneed SMS delivery when it is due (60 s later), then goes idle', async () => {
    const c = await w.n.get_config();
    unwrap(await w.n.admin_set_config({ ...c, sneed_sms: w.icpId })); // a canister without send_system_notification
    const r = await w.notify({ title: 'Retried' });
    await pic.tick(5);
    expect(await w.receipt(r.ok.id)).toBe('pending');
    const t = await timer();
    const due = t.next_run_at[0] - (await nowNs(pic));
    expect(due).toBeGreaterThan(50_000_000_000n); // the retry, not a busy loop
    expect(due).toBeLessThanOrEqual(60_001_000_000n);
    unwrap(await w.n.admin_set_config(c));
    await pic.advanceTime(30_000); await pic.tick(3);
    expect(await w.receipt(r.ok.id)).toBe('pending'); // not due yet
    await pic.advanceTime(31_000); await pic.tick(5);
    expect(await w.receipt(r.ok.id)).toBe('delivered');
    await expectIdle();
  });

  it('puts a job back when its relay lease lapses, then goes idle', async () => {
    // bob's Discord channel, verified through the relay, as his only channel for urgent messages
    const ch = unwrap(await w.as(bob).add_channel({ discord: null }, 'discord', new TextEncoder().encode('enc:bob')));
    const [code] = await w.as(relay).relay_pull(10n);
    await w.as(relay).relay_ack([[code.id, { ok: null }]]);
    unwrap(await w.as(bob).verify_channel(ch, code.title.match(/(\d{6})/)[1]));
    const mine = await w.as(bob).get_my_settings();
    unwrap(await w.as(bob).set_settings({ ...mine.settings, always_copy: [], defaults: { urgent: [ch], normal: [], info: [] } }));
    await pic.tick(3);
    await expectIdle(); // jobs for relays need no timer while queued

    const r = await w.notify({ title: 'Leased' });
    await pic.tick(3); // the run notify kicked: nothing for it to deliver
    const [job] = await w.as(relay).relay_pull(10n);
    expect(job.title).toBe('Leased');
    const lease = (await w.n.get_config()).relay_lease_ns;
    const t = await timer();
    expect(t.next_run_at[0] - (await nowNs(pic))).toBeGreaterThan(lease - 5_000_000_000n); // the lease's end
    expect(t.next_run_at[0] - (await nowNs(pic))).toBeLessThanOrEqual(lease + 1_000_000n);
    expect(await w.as(relay).relay_pull(10n)).toEqual([]); // leased
    await pic.advanceTime(Number(lease / 1_000_000n) + 2_000); await pic.tick(5);
    await pic.advanceTime(61_000); await pic.tick(3); // the retry's not_before
    const [again] = await w.as(relay).relay_pull(10n);
    expect(again.id).toBe(job.id);
    await w.as(relay).relay_ack([[again.id, { ok: null }]]);
    expect(await w.receipt(r.ok.id)).toBe('delivered');
    await pic.tick(3);
    // the lapse timer armed for the second lease fires once and finds nothing: idle after it
    await pic.advanceTime(Number(lease / 1_000_000n) + 2_000); await pic.tick(5);
    await expectIdle();
  });

  it('still checks the fees: a forward at the threshold goes out at the next check, then idle', async () => {
    // the app pays a per-call price; 0.002 ICP forwarded once 0.001 ICP is unforwarded
    const amount = 10_000_000n;
    await w.icp.mint(account(alice), amount + 2n * FEE);
    unwrap(await actorAs(pic, ledgerIdl, w.icpId, alice).icrc2_approve({ from_subaccount: [], spender: account(w.notifId), amount: amount + FEE, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
    unwrap(await w.as(alice).top_up_app(w.appId, amount));
    const c = await w.n.get_config();
    unwrap(await w.n.admin_set_config({ ...c, notify_price_e8s: 100_000n }));
    unwrap(await w.n.admin_set_fee_sweep_threshold(150_000n));
    const f0 = await w.n.get_fee_forwarding();
    expect(f0.backlog_e8s).toEqual([0n]); // the first check after the install measured the books
    await w.notify({ sponsored: true });
    await pic.tick(5);
    await expectIdle(); // below the threshold: no check armed
    await w.notify({ sponsored: true });
    await pic.tick(5);
    const t = await timer();
    expect(t.next_run_at.length).toBe(1); // the fee check is armed
    await pic.advanceTime(5 * MIN + 1_000); await pic.tick(10);
    const f1 = await w.n.get_fee_forwarding();
    expect(f1.forwards).toBe(f0.forwards + 1n);
    expect(f1.last_forward[0].amount_e8s).toBe(200_000n - FEE);
    // the run after the forward finds nothing left to do
    await pic.advanceTime(5 * MIN + 1_000); await pic.tick(10);
    await expectIdle();
    unwrap(await w.n.admin_set_config(c));
    unwrap(await w.n.admin_set_fee_sweep_threshold(10_000_000n));
  });

  it('admins pause and resume the timers: notify records and queues meanwhile, delivered on resume; logged, kept over an upgrade', async () => {
    expect(await refusedAtIngress(w.as(bob).admin_pause_timers())).toBe(true);
    expect(await refusedAtIngress(w.as(bob).admin_resume_timers())).toBe(true);
    const log0 = (await w.n.icrc3_log_status()).log_length;
    expect(unwrap(await w.n.admin_pause_timers())).toBe('Paused');
    expect(unwrap(await w.n.admin_pause_timers())).toBe('Already paused');
    let t = await timer();
    expect(t.paused).toBe(true);
    expect(t.paused_at[0]).toBeGreaterThan(0n);
    expect(t.next_run_at).toEqual([]);
    expect(t.next_housekeeping_at).toEqual([]);

    // Sneed SMS only again, so the message is the timer's to deliver
    const mine = await w.as(bob).get_my_settings();
    const sms = mine.channels.find((x) => 'sneed_sms' in x.kind).id;
    unwrap(await w.as(bob).set_settings({ ...mine.settings, always_copy: [sms], defaults: { urgent: [], normal: [], info: [] } }));
    const r = await w.notify({ title: 'While paused' });
    expect(r.ok.deliveries).toBe(1n);
    for (let i = 0; i < 4; i++) { await pic.advanceTime(30_000); await pic.tick(3); }
    expect(await w.receipt(r.ok.id)).toBe('pending');
    const last = (await timer()).last_tick_at;

    // paused survives an upgrade: nothing is armed after it either
    await pic.upgradeCanister({ sender: admin, canisterId: w.notifId, wasm: wasm(NOTIF_WASM), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    for (let i = 0; i < 4; i++) { await pic.advanceTime(30_000); await pic.tick(3); }
    t = await timer();
    expect(t.paused).toBe(true);
    expect(t.next_run_at).toEqual([]);
    expect(t.next_housekeeping_at).toEqual([]);
    expect(t.last_tick_at).toBe(last);
    expect(await w.receipt(r.ok.id)).toBe('pending');

    expect(unwrap(await w.n.admin_resume_timers())).toBe('Resumed');
    expect(unwrap(await w.n.admin_resume_timers())).toBe('Not paused');
    await pic.tick(5);
    expect(await w.receipt(r.ok.id)).toBe('delivered');
    t = await timer();
    expect(t.paused).toBe(false);
    expect(t.paused_at).toEqual([]);
    await expectIdle();

    // two config_update blocks: timers_paused 0 -> 1 and 1 -> 0, by the admin
    const fetched = await fetchBlocks(w.n, (id) => actorAs(pic, archiveIdl, id, admin), log0, (await w.n.icrc3_log_status()).log_length - 1n);
    const blocks = [...fetched.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, b]) => b);
    const paused = blocks.filter((b) => btype(b) === 'sneednotif_config_update' && txField(b, 'key')?.Text === 'timers_paused');
    expect(paused.map((b) => [txField(b, 'old_value').Nat, txField(b, 'value').Nat])).toEqual([[0n, 1n], [1n, 0n]]);
    expect(Buffer.from(txField(paused[0], 'caller').Blob).equals(Buffer.from(admin.toUint8Array()))).toBe(true);
  });

  it('re-arms after an upgrade with keep: the housekeeping, and the work timer for what is due', async () => {
    await pic.upgradeCanister({ sender: admin, canisterId: w.notifId, wasm: wasm(NOTIF_WASM), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    await expectIdle(); // nothing due: only the housekeeping
    const r = await w.notify({ title: 'After the upgrade' });
    await pic.tick(5);
    expect(await w.receipt(r.ok.id)).toBe('delivered');
    // a delivery waiting for its retry at the upgrade gets its run after it
    const c = await w.n.get_config();
    unwrap(await w.n.admin_set_config({ ...c, sneed_sms: w.icpId }));
    const r2 = await w.notify({ title: 'Retried after the upgrade' });
    await pic.tick(5);
    unwrap(await w.n.admin_set_config(c));
    await pic.upgradeCanister({ sender: admin, canisterId: w.notifId, wasm: wasm(NOTIF_WASM), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    const t = await timer();
    const due = t.next_run_at[0] - (await nowNs(pic));
    expect(due).toBeGreaterThan(50_000_000_000n);
    expect(due).toBeLessThanOrEqual(60_001_000_000n);
    await pic.advanceTime(61_000); await pic.tick(5);
    expect(await w.receipt(r2.ok.id)).toBe('delivered');
    await expectIdle();
  });
});

describe('upgrading the previous build (keep)', () => {
  let pic, w;
  beforeAll(async () => {
    ({ pic } = await createPic());
    w = await world(pic, PREV_WASM);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('keeps everything, picks up the work waiting at the upgrade, then idles cheaply', async () => {
    const delivered = await w.notify({ title: 'Before' });
    await pic.advanceTime(31_000); await pic.tick(5);
    expect(await w.receipt(delivered.ok.id)).toBe('delivered');
    await pic.advanceTime(10 * MIN); await pic.tick(2); // install_code rate limit
    // a Sneed SMS delivery that failed and waits for its retry when the upgrade comes
    const c = await w.n.get_config();
    unwrap(await w.n.admin_set_config({ ...c, sneed_sms: w.icpId }));
    const waiting = await w.notify({ title: 'Waiting' });
    await pic.tick(5);
    expect(await w.receipt(waiting.ok.id)).toBe('pending');
    unwrap(await w.n.admin_set_config(c));
    const before = await w.n.stats();
    const fees = ser({ ...(await w.n.get_fee_forwarding()), events: [] });

    await pic.upgradeCanister({ sender: admin, canisterId: w.notifId, wasm: wasm(NOTIF_WASM), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    const after = await w.n.stats();
    expect({ ...after, last_tick_at: 0n }).toEqual({ ...before, last_tick_at: 0n });
    expect(ser({ ...(await w.n.get_fee_forwarding()), events: [] })).toBe(fees);
    const t = await w.n.get_timer_status();
    expect(t.paused).toBe(false);
    expect(t.next_run_at.length).toBe(1); // armed

    await pic.advanceTime(31_000); await pic.tick(5); // the first run after the upgrade: the retry is not due yet
    expect(await w.receipt(waiting.ok.id)).toBe('pending');
    await pic.advanceTime(31_000); await pic.tick(5); // 60 s after the failed attempt
    expect(await w.receipt(waiting.ok.id)).toBe('delivered');
    expect((await w.inbox()).map((m) => m.subject)).toEqual(expect.arrayContaining(['[Timers Test] Before', '[Timers Test] Waiting']));
    const s = await w.n.get_timer_status();
    expect(s.next_run_at).toEqual([]); // idle
    expect(s.next_housekeeping_at.length).toBe(1);
    const hour = await burnOneHour(pic, w.notifId);
    console.log(`after the upgrade from ${PREV_WASM}: idle ${M(hour)} cycles an hour`);
    expect(hour).toBeLessThan(400_000_000n);
  }, 600_000);
});
