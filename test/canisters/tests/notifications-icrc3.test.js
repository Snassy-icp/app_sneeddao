// The Sneed Notifications activity log (spec/notifications_icrc3.md): an empty log with the
// documented catalogue; one block per user top-up and app top-up (with the ledger block), per refund
// of a failed paid delivery (the amount and who paid, a user or an app, never which), per fee
// forward to the RLL splitter (amount, destination, ledger block), for the first measurement of
// the fee backlog and for a re-measurement; per app registered, changed, verified or removed; per
// admin added or removed; per configuration value changed (prices, relays, relay public keys, the
// fee destination and threshold, the log's settings). Nothing for notifications, deliveries,
// channels, settings, permissions, refused calls or calls that change nothing, and no title,
// body, channel name, address or user of a delivery anywhere in the log. The hash chain and the
// certified tip verify (lib/icrc3.js); blocks spill into archives co-controlled by SNS root; the
// ingress guard; upgrades keep the log, and an upgrade with keep from the production build
// (src/sneed_notifications at 5f62b7d5, module hash 7dae6ac1…, build/sneed_notifications_preicrc3.wasm)
// keeps apps, balances and the fee books and starts an empty log.
// NOTIF_WASM=sneed_notifications_preicrc3 npx vitest run tests/notifications-icrc3.test.js runs it
// against the production code: it fails there (no log).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, unwrap, errOf, wasm, refusedAtIngress, asUpdates, account, SNEED_SNS_ROOT, T } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { archiveIdl, btype, tx, verifyLog, icrc3Service } from '../lib/icrc3.js';
import { idlFactory as notifIdl } from '../build/sneed_notifications.did.js';

const NOTIF_WASM = process.env.NOTIF_WASM || 'sneed_notifications';
const BLOCK_TYPES_URL = 'https://app.sneeddao.com/api/sneed_notifications#block-types';
const CATALOGUE = [
  'top_up', 'app_top_up', 'refund', 'fee_forward', 'fee_backlog', 'fee_remeasure',
  'app_register', 'app_update', 'app_remove', 'app_verify', 'admin_add', 'admin_remove', 'config_update',
  'admin_credit', 'app_balance_claim', 'withdraw', 'withdraw_restore',
].map((t) => `sneednotif_${t}`);
const KEEP = { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] };
const SPLITTER = Principal.fromText('6jvpj-sqaaa-aaaaj-azwnq-cai');
const SPLITTER_SUB = new Uint8Array([1, 0, 0, 0, 0, 6, ...new Array(26).fill(0)]);
const PRICE = 2_000_000n; // a Discord delivery here: 0.02 ICP
const FEE = 10_000n;
const MIN5 = 5 * 60_000 + 1_000;
const relay = user('notif-icrc3-discord-relay');
const dave = user('notif-icrc3-dave');
const BOOTSTRAP_ADMIN = Principal.fromText('d7zib-qo5mr-qzmpb-dtyof-l7yiu-pu52k-wk7ng-cbm3n-ffmys-crbkz-nae');

const hex = (b) => Buffer.from(b).toString('hex');
const P = (p) => hex(p.toUint8Array());
const plain = (v) => {
  if ('Nat' in v) return v.Nat;
  if ('Int' in v) return v.Int;
  if ('Text' in v) return v.Text;
  if ('Blob' in v) return hex(v.Blob);
  if ('Array' in v) return v.Array.map(plain);
  return Object.fromEntries(v.Map.map(([k, x]) => [k, plain(x)]));
};
const ser = (x) => JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v));

// the canister's interface plus the log's (so the test runs against a build without it, and fails there)
const LogEntry = IDL.Record({ id: IDL.Nat, ts: IDL.Int, level: IDL.Variant({ info: IDL.Null, error: IDL.Null }), cid: IDL.Nat, caller: IDL.Principal, message: IDL.Text });
const fullIdl = ({ IDL: I }) => I.Service({
  ...Object.fromEntries(notifIdl({ IDL: I })._fields),
  ...icrc3Service(I),
  get_log: I.Func([I.Nat, I.Nat], [I.Vec(LogEntry)], ['query']),
});
// stats() as production answers it (before last_tick_at and ticking), for the snapshots taken before an upgrade
const statsV1Idl = ({ IDL: I }) => I.Service({ stats: I.Func([], [I.Record({ apps: I.Nat, users: I.Nat, notifications: I.Nat, pending: I.Nat })], ['query']) });
const senderIdl = ({ IDL: I }) => I.Service({ forward: I.Func([I.Principal, I.Text, I.Vec(I.Nat8)], [I.Vec(I.Nat8)], []) });

let pic, rootKey, appSubnet, notifId, icpId, senderId, sender2Id, icp, appId;
const as = (p, id = notifId) => actorAs(pic, fullIdl, id, p);
const archiveActor = (id) => actorAs(pic, archiveIdl, id, admin);
const rawLog = async (id = notifId) => (await verifyLog(as(admin, id), id, rootKey, archiveActor)).blocks;
const verifiedLog = async (id = notifId) => (await rawLog(id)).map((b, i) => ({ i, t: btype(b).replace(/^sneednotif_/, ''), ...plain(tx(b)) }));
const logLength = async (id = notifId) => Number((await as(admin, id).icrc3_log_status()).log_length);
const since = async (mark, id = notifId) => (await verifiedLog(id)).slice(mark);
const strip = (blocks) => blocks.map(({ i, ...b }) => b);

// calls as an app canister, through the forwarding mock
const svc = notifIdl({ IDL });
const asApp = async (name, id, ...args) => {
  const f = svc._fields.find(([k]) => k === name)[1];
  return IDL.decode(f.retTypes, await actorAs(pic, senderIdl, senderId, alice).forward(id, name, IDL.encode(f.argTypes, args)))[0];
};
let seq = 0;
const notify = (over = {}, id = notifId) => asApp('notify', id, { user: bob, topic: 'alert', title: 'Secret title', body: 'Secret body text', link: [], dedupe: [`d${seq++}`], sponsored: false, ...over });
const deliverAll = async (ok = true, id = notifId) => {
  const jobs = await as(relay, id).relay_pull(100n);
  await as(relay, id).relay_ack(jobs.map((j) => [j.id, ok ? { ok: null } : { err: 'gave up' }]));
  return jobs.length;
};
const settle = async () => { await pic.advanceTime(MIN5); await pic.tick(10); };
const fund = async (who, amount, id = notifId) => {
  await icp.mint(account(who), amount + 2n * FEE);
  unwrap(await actorAs(pic, ledgerIdl, icpId, who).icrc2_approve({ from_subaccount: [], spender: account(id), amount: amount + FEE, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
};
const txAt = async (index) => (await icp.get_transactions()).find((t) => t.index === index);
const TOPICS = [{ id: 'alert', title: 'Alert', description: 'Something to know', level: { urgent: null } }];

/// a user with a verified Discord channel as the only channel, generous caps, no low-balance alert
async function setUser(who, id = notifId, app = appId) {
  unwrap(await as(who, id).allow_app(app, true));
  const [[, p]] = await as(who, id).get_my_apps();
  unwrap(await as(who, id).set_permission(app, { ...p, daily_cap: 10_000n, daily_spend_cap_e8s: 100_000_000_000n }));
  unwrap(await as(who, id).set_low_balance_alert(0n));
  const ch = unwrap(await as(who, id).add_channel({ discord: null }, 'my secret discord', new TextEncoder().encode(`enc-address-of-${who.toText()}`)));
  const [job] = await as(relay, id).relay_pull(10n);
  await as(relay, id).relay_ack([[job.id, { ok: null }]]);
  unwrap(await as(who, id).verify_channel(ch, job.title.match(/(\d{6})/)[1]));
  const mine = await as(who, id).get_my_settings();
  unwrap(await as(who, id).set_settings({ ...mine.settings, always_copy: [], defaults: { urgent: [ch], normal: [], info: [] } }));
}

async function configure(id) {
  const n = as(admin, id);
  const c = await n.get_config();
  unwrap(await n.admin_set_config({ ...c, icp_ledger: icpId, relays: [[relay, { discord: null }]], prices_e8s: c.prices_e8s.map(([k, p]) => ('discord' in k ? [k, PRICE] : [k, p])) }));
  return c;
}

beforeAll(async () => {
  ({ pic, rootKey, appSubnet } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE, symbol: 'ICP', decimals: 8 }] });
  senderId = await install(pic, { name: 'MockNotifySender', controllers: [alice], sender: alice });
  sender2Id = await install(pic, { name: 'MockNotifySender', controllers: [alice], sender: alice });
  icp = actorAs(pic, ledgerIdl, icpId, admin);
  notifId = await install(pic, { name: NOTIF_WASM, cycles: 20n * T, targetSubnetId: appSubnet });
}, 180_000);
afterAll(async () => { await pic?.tearDown(); });

describe('fresh install', () => {
  it('has an empty log, the documented catalogue and ICRC-3 among its standards', async () => {
    expect(await as(alice).icrc3_log_status()).toMatchObject({ log_length: 0n, live_blocks: 0n, archives: [], history_imported: false, last_block_hash: [] });
    expect(await as(alice).icrc3_get_tip_certificate()).toEqual([]);
    expect(await as(alice).icrc3_supported_block_types()).toEqual(CATALOGUE.map((block_type) => ({ block_type, url: BLOCK_TYPES_URL })));
    expect((await as(alice).icrc10_supported_standards()).map((s) => s.name)).toEqual(['ICRC-3', 'ICRC-10']);
    expect(await as(alice).icrc3_get_blocks([{ start: 0n, length: 10n }])).toEqual({ log_length: 0n, blocks: [], archived_blocks: [] });
  });
});

describe('configuration and admins', () => {
  it('admin_set_config: one block per value that changed, with the old value; the same config again or a refused call appends nothing', async () => {
    const old = await configure(notifId);
    const c = await as(admin).get_config();
    unwrap(await as(admin).admin_set_config(c)); // nothing changes
    expect(await refusedAtIngress(as(bob).admin_set_config({ ...c, notify_price_e8s: 5n }))).toBe(true);
    const prices = (cfg) => Object.fromEntries(cfg.prices_e8s.map(([k, p]) => [Object.keys(k)[0], p]));
    expect(strip(await verifiedLog())).toEqual([
      { t: 'config_update', caller: P(admin), key: 'icp_ledger', old_value: P(old.icp_ledger), value: P(icpId) },
      { t: 'config_update', caller: P(admin), key: 'prices_e8s', old_value: prices(old), value: { ...prices(old), discord: PRICE } },
      { t: 'config_update', caller: P(admin), key: 'relays', old_value: [], value: [[P(relay), 'discord']] },
    ]);
  });

  it('relay public keys, the fee destination and threshold, the log settings; repeats and refusals append nothing', async () => {
    const mark = await logLength();
    unwrap(await as(admin).admin_set_relay_key({ discord: null }, 'PUBLIC-KEY-1'));
    unwrap(await as(admin).admin_set_relay_key({ discord: null }, 'PUBLIC-KEY-1')); // the same
    unwrap(await as(admin).admin_set_relay_key({ discord: null }, 'PUBLIC-KEY-2'));
    unwrap(await as(admin).admin_set_relay_key({ discord: null }, ''));
    expect(await refusedAtIngress(as(bob).admin_set_relay_key({ push: null }, 'X'))).toBe(true);
    unwrap(await as(admin).admin_set_fee_destination([{ owner: carol, subaccount: [] }]));
    unwrap(await as(admin).admin_set_fee_destination([{ owner: carol, subaccount: [] }]));
    expect(errOf(await as(admin).admin_set_fee_destination([{ owner: carol, subaccount: [new Uint8Array(3)] }]))).toMatch(/32 bytes/);
    unwrap(await as(admin).admin_set_fee_destination([{ owner: SPLITTER, subaccount: [SPLITTER_SUB] }]));
    unwrap(await as(admin).admin_set_fee_sweep_threshold(10_000_000n)); // the default: unchanged
    unwrap(await as(admin).admin_set_fee_sweep_threshold(20_000_000n));
    unwrap(await as(admin).admin_set_fee_sweep_threshold(10_000_000n));
    expect(await refusedAtIngress(as(bob).admin_set_fee_sweep_threshold(1n))).toBe(true);
    const none = { max_live_blocks: [], spill_batch_size: [], archive_max_blocks: [], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] };
    unwrap(await as(admin).admin_set_icrc3_settings({ ...none, max_live_blocks: [2000n] })); // the default
    unwrap(await as(admin).admin_set_icrc3_settings({ ...none, archive_top_up_amount: [600_000_000_000n] }));
    expect(errOf(await as(admin).admin_set_icrc3_settings({ ...none, max_live_blocks: [0n] }))).toMatch(/at least 1/);
    expect(await refusedAtIngress(as(bob).admin_set_icrc3_settings(none))).toBe(true);
    const splitter = [P(SPLITTER), hex(SPLITTER_SUB)];
    expect(strip(await since(mark))).toEqual([
      { t: 'config_update', caller: P(admin), key: 'relay_key', kind: 'discord', old_value: 'none', value: 'PUBLIC-KEY-1' },
      { t: 'config_update', caller: P(admin), key: 'relay_key', kind: 'discord', old_value: 'PUBLIC-KEY-1', value: 'PUBLIC-KEY-2' },
      { t: 'config_update', caller: P(admin), key: 'relay_key', kind: 'discord', old_value: 'PUBLIC-KEY-2', value: 'none' },
      { t: 'config_update', caller: P(admin), key: 'fee_destination', old_value: splitter, value: [P(carol)] },
      { t: 'config_update', caller: P(admin), key: 'fee_destination', old_value: [P(carol)], value: splitter },
      { t: 'config_update', caller: P(admin), key: 'fee_sweep_threshold_e8s', old_value: 10_000_000n, value: 20_000_000n },
      { t: 'config_update', caller: P(admin), key: 'fee_sweep_threshold_e8s', old_value: 20_000_000n, value: 10_000_000n },
      { t: 'config_update', caller: P(admin), key: 'icrc3_archive_top_up_amount', old_value: 500_000_000_000n, value: 600_000_000_000n },
    ]);
  });

  it('admins: additions and removals; repeats and refusals append nothing', async () => {
    const mark = await logLength();
    expect(await refusedAtIngress(as(bob).admin_add_admin(bob))).toBe(true);
    unwrap(await as(admin).admin_add_admin(dave));
    unwrap(await as(admin).admin_add_admin(dave));
    unwrap(await as(dave).admin_add_admin(carol));
    unwrap(await as(admin).admin_remove_admin(carol));
    unwrap(await as(admin).admin_remove_admin(carol)); // not on the list
    expect(await refusedAtIngress(as(carol).admin_remove_admin(dave))).toBe(true);
    expect(strip(await since(mark))).toEqual([
      { t: 'admin_add', caller: P(admin), principal: P(dave) },
      { t: 'admin_add', caller: P(dave), principal: P(carol) },
      { t: 'admin_remove', caller: P(admin), principal: P(carol) },
    ]);
  });
});

describe('apps', () => {
  it('registered, changed, verified and removed: one block each with id, name, owner, canisters and topics; refusals and no-op updates append nothing', async () => {
    const mark = await logLength();
    const input = { name: 'Icrc3 Test', logo: [], description: 'tests the log', canisters: [senderId], topics: TOPICS };
    expect(errOf(await as(bob).register_app(input))).toMatch(/not a controller/);
    appId = unwrap(await as(alice).register_app(input));
    expect(errOf(await as(carol).register_app(input))).toMatch(/already belongs/);
    const dao = unwrap(await as(admin).admin_register_app(SNEED_SNS_ROOT, { ...input, name: 'DAO App', canisters: [sender2Id] }));
    expect(await refusedAtIngress(as(bob).admin_register_app(bob, { ...input, canisters: [bob] }))).toBe(true);
    unwrap(await as(alice).update_app(appId, input)); // nothing changes
    expect(errOf(await as(bob).update_app(appId, { ...input, name: 'Hijacked' }))).toMatch(/owner/);
    const topics2 = [...TOPICS, { id: 'news', title: 'News', description: '', level: { info: null } }];
    unwrap(await as(alice).update_app(appId, { ...input, name: 'Icrc3 App', topics: topics2 }));
    unwrap(await as(alice).update_app(appId, { ...input, name: 'Icrc3 App', topics: topics2, description: 'a longer description that is not logged' }));
    unwrap(await as(admin).admin_set_app_verified(appId, true));
    unwrap(await as(admin).admin_set_app_verified(appId, true)); // already
    expect(await refusedAtIngress(as(bob).admin_set_app_verified(appId, false))).toBe(true);
    unwrap(await as(admin).admin_set_app_verified(appId, false));
    unwrap(await as(admin).admin_set_app_verified(appId, true));
    unwrap(await as(admin).admin_remove_app(dao));
    expect(errOf(await as(admin).admin_remove_app(dao))).toMatch(/No such app/);
    const tv = (ts) => ts.map((t) => ({ id: t.id, title: t.title, level: Object.keys(t.level)[0] }));
    const app = { app_id: appId, owner: P(alice), canisters: [P(senderId)] };
    expect(strip(await since(mark))).toEqual([
      { t: 'app_register', caller: P(alice), ...app, name: 'Icrc3 Test', topics: tv(TOPICS), verified: 0n },
      { t: 'app_register', caller: P(admin), app_id: dao, name: 'DAO App', owner: P(SNEED_SNS_ROOT), canisters: [P(sender2Id)], topics: tv(TOPICS), verified: 1n },
      { t: 'app_update', caller: P(alice), ...app, name: 'Icrc3 App', topics: tv(topics2), changed: ['name', 'topics'], old_name: 'Icrc3 Test', old_topics: tv(TOPICS) },
      { t: 'app_update', caller: P(alice), ...app, name: 'Icrc3 App', topics: tv(topics2), changed: ['description'] },
      { t: 'app_verify', caller: P(admin), app_id: appId, name: 'Icrc3 App', verified: 1n },
      { t: 'app_verify', caller: P(admin), app_id: appId, name: 'Icrc3 App', verified: 0n },
      { t: 'app_verify', caller: P(admin), app_id: appId, name: 'Icrc3 App', verified: 1n },
      { t: 'app_remove', caller: P(admin), app_id: dao, name: 'DAO App', owner: P(SNEED_SNS_ROOT), canisters: [P(sender2Id)], app_balance_e8s: 0n },
    ]);
    expect(ser(await verifiedLog())).not.toContain('longer description');
  });
});

describe('money', () => {
  it('users, channels, permissions and settings append nothing', async () => {
    const mark = await logLength();
    expect(await asApp('request_permission', notifId, bob)).toEqual({ ok: 'Asked' });
    await setUser(bob);
    await setUser(carol);
    expect(await logLength()).toBe(mark);
  });

  it('top-ups: one block with the amount and the ledger block; a refused top-up appends nothing', async () => {
    await settle(); // the first fee check (fee_backlog) is the subject of a later test
    const mark = await logLength();
    expect(errOf(await as(bob).top_up(50_000_000n))).toMatch(/Approve/); // no approval
    expect(await refusedAtIngress(as(Principal.anonymous()).top_up(1n))).toBe(true);
    await fund(bob, 50_000_000n);
    unwrap(await as(bob).top_up(50_000_000n));
    await fund(alice, 20_000_000n);
    expect(unwrap(await as(alice).top_up_app(appId, 20_000_000n))).toBe(20_000_000n);
    expect(errOf(await as(alice).top_up_app(999n, 1n))).toMatch(/No such app/);
    const blocks = strip(await since(mark));
    expect(blocks).toEqual([
      { t: 'top_up', caller: P(bob), amount_e8s: 50_000_000n, ledger_block: expect.any(BigInt) },
      { t: 'app_top_up', caller: P(alice), app_id: appId, amount_e8s: 20_000_000n, ledger_block: expect.any(BigInt), app_balance_e8s: 20_000_000n },
    ]);
    for (const [b, who] of [[blocks[0], bob], [blocks[1], alice]]) {
      const t = await txAt(b.ledger_block);
      expect([t.from.owner.toText(), t.to.owner.toText(), t.amount]).toEqual([who.toText(), notifId.toText(), b.amount_e8s]);
    }
  });

  it('notifications and deliveries append nothing; a finally failed paid delivery: one refund block with the amount and who paid, never which user, app or delivery', async () => {
    const mark = await logLength();
    expect((await notify()).ok.deliveries).toBe(1n);
    expect((await notify({ sponsored: true })).ok.deliveries).toBe(1n);
    expect((await notify({ user: carol })).ok.deliveries).toBe(0n); // no balance: suppressed, nothing to refund
    expect(await deliverAll()).toBe(2);
    expect(await logLength()).toBe(mark);
    const c = await as(admin).get_config();
    unwrap(await as(admin).admin_set_config({ ...c, max_attempts: 1n }));
    await notify();
    await notify({ sponsored: true });
    expect(await deliverAll(false)).toBe(2);
    unwrap(await as(admin).admin_set_config({ ...c, max_attempts: 5n }));
    const refunded = (await as(admin).get_fee_forwarding()).refunded_e8s;
    expect(strip(await since(mark))).toEqual([
      { t: 'config_update', caller: P(admin), key: 'max_attempts', old_value: 5n, value: 1n },
      { t: 'refund', caller: P(relay), amount_e8s: PRICE, paid_by: 'user', refunded_e8s: refunded - PRICE },
      { t: 'refund', caller: P(relay), amount_e8s: PRICE, paid_by: 'app', refunded_e8s: refunded },
      { t: 'config_update', caller: P(admin), key: 'max_attempts', old_value: 1n, value: 5n },
    ]);
  });

  it('never logs what was sent to whom: no titles, bodies, channel names or addresses; the recipient appears only in their own top-up', async () => {
    const log = await verifiedLog();
    const all = ser(log);
    for (const secret of ['Secret title', 'Secret body', 'my secret discord', 'enc-address-of', 'Sneed Notifications code', hex(new TextEncoder().encode('enc-address-of'))]) {
      expect(all).not.toContain(secret);
    }
    expect(log.filter((b) => ser(b).includes(P(bob))).map((b) => b.t)).toEqual(['top_up']);
    expect(log.filter((b) => ser(b).includes(P(carol))).map((b) => b.t)).toEqual(['config_update', 'config_update', 'admin_add', 'admin_remove']); // carol as fee destination and as admin, never as a recipient
    for (const b of log.filter((x) => x.t === 'refund')) expect(Object.keys(b).sort()).toEqual(['amount_e8s', 'caller', 'i', 'paid_by', 'refunded_e8s', 't']);
  });
});

describe('fee forwarding', () => {
  it('the first measurement of the backlog is one block, from the timer', async () => {
    const b = (await verifiedLog()).filter((x) => x.t === 'fee_backlog');
    expect(b).toHaveLength(1);
    expect(b[0]).toEqual({ i: b[0].i, t: 'fee_backlog', via: 'timer', balance_e8s: 0n, liabilities_e8s: 0n, free_e8s: 0n, backlog_e8s: 0n });
  });

  it('a forward: one block with the amount, the ledger fee, the RLL splitter account and the ledger block; a check that sends nothing appends nothing', async () => {
    let mark = await logLength();
    for (let i = 0; i < 5; i++) await notify(); // 5 × 0.02 = 0.1 ICP, the threshold
    await deliverAll();
    await settle();
    let blocks = strip(await since(mark));
    const fwd = await as(admin).get_fee_forwarding();
    expect(blocks).toEqual([{ t: 'fee_forward', via: 'timer', amount_e8s: fwd.last_forward[0].amount_e8s, fee_e8s: FEE, to: [P(SPLITTER), hex(SPLITTER_SUB)], ledger_block: fwd.last_forward[0].block, forwards: 1n, forwarded_e8s: fwd.forwarded_e8s }]);
    const t = await txAt(blocks[0].ledger_block);
    expect([t.from.owner.toText(), t.to.owner.toText(), hex(t.to.subaccount[0]), t.amount]).toEqual([notifId.toText(), SPLITTER.toText(), hex(SPLITTER_SUB), blocks[0].amount_e8s]);
    await settle(); // nothing left to send
    expect(await logLength()).toBe(mark + 1);
    // forced by an admin: the caller is named; with nothing above the fee, nothing is logged
    mark = await logLength();
    unwrap(await as(admin).admin_forward_fees_now());
    expect(await logLength()).toBe(mark);
    await notify();
    await deliverAll();
    unwrap(await as(dave).admin_forward_fees_now());
    blocks = strip(await since(mark));
    expect(blocks).toEqual([expect.objectContaining({ t: 'fee_forward', caller: P(dave), amount_e8s: PRICE - FEE, forwards: 2n })]);
  });

  it('a re-measurement when the ledger shows less than the books', async () => {
    for (let i = 0; i < 3; i++) await notify();
    await deliverAll();
    const sneak = actorAs(pic, ledgerIdl, icpId, notifId); // ICP leaves behind the books' back
    unwrap(await sneak.icrc1_transfer({ from_subaccount: [], to: account(carol), amount: 2n * PRICE, fee: [], memo: [], created_at_time: [] }));
    const mark = await logLength();
    unwrap(await as(admin).admin_forward_fees_now());
    const blocks = strip(await since(mark));
    expect(blocks.map((b) => b.t)).toEqual(['fee_remeasure', 'fee_forward']);
    expect(blocks[0]).toMatchObject({ caller: P(admin), books_e8s: 3n * PRICE });
    expect(blocks[0].free_e8s).toBe(blocks[0].balance_e8s - blocks[0].liabilities_e8s);
    expect(blocks[0].free_e8s).toBe(PRICE - FEE); // 3 earned, 2 and the sneak's ledger fee gone
    expect(blocks[1]).toMatchObject({ caller: P(admin), amount_e8s: PRICE - 2n * FEE });
  });
});

describe('ingress', () => {
  it('refuses the log queries as update calls and the log\'s admin methods from non-admins at ingress', async () => {
    const u = actorAs(pic, asUpdates(fullIdl), notifId, bob);
    expect(await refusedAtIngress(u.icrc3_get_blocks([{ start: 0n, length: 1n }]))).toBe(true);
    expect(await refusedAtIngress(u.icrc3_get_archives({ from: [] }))).toBe(true);
    expect(await refusedAtIngress(u.icrc3_get_tip_certificate())).toBe(true);
    expect(await refusedAtIngress(u.icrc3_supported_block_types())).toBe(true);
    expect(await refusedAtIngress(u.icrc10_supported_standards())).toBe(true);
    expect(await refusedAtIngress(u.icrc3_log_status())).toBe(true);
    expect(await refusedAtIngress(u.get_log(0n, 10n))).toBe(true);
    const settings = { max_live_blocks: [5n], spill_batch_size: [], archive_max_blocks: [], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] };
    expect(await refusedAtIngress(as(bob).admin_set_icrc3_settings(settings))).toBe(true);
    expect(await refusedAtIngress(as(bob).admin_icrc3_spill_now())).toBe(true);
    expect(await refusedAtIngress(as(bob).admin_icrc3_repair_archive_controllers())).toBe(true);
    await expect(as(bob).get_log(0n, 10n)).rejects.toThrow(/Admins only/);
    expect(await as(admin).get_log(0n, 10n)).toEqual(expect.any(Array));
  });
});

describe('archives', () => {
  it('spill past the live limit into archives co-controlled by SNS root, and still verify', async () => {
    const before = await logLength();
    unwrap(await as(admin).admin_set_icrc3_settings({ max_live_blocks: [5n], spill_batch_size: [10n], archive_max_blocks: [20n], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }));
    await pic.advanceTime((15 * 60 + 5) * 1000);
    await pic.tick(100);
    const s = await as(admin).icrc3_log_status();
    expect(Number(s.log_length)).toBeGreaterThanOrEqual(before + 3); // three settings changed
    expect(s.live_blocks).toBeLessThan(5n);
    expect(s.archives.length).toBeGreaterThanOrEqual(2);
    for (const a of s.archives) {
      expect((await pic.getControllers(a.canister_id)).map((p) => p.toText()).sort()).toEqual([notifId.toText(), SNEED_SNS_ROOT.toText()].sort());
      expect((await archiveActor(a.canister_id).archive_status()).parent.toText()).toBe(notifId.toText());
    }
    expect((await as(bob).icrc3_get_blocks([{ start: 0n, length: 3n }])).archived_blocks).toHaveLength(1);
    expect(await verifiedLog()).toHaveLength(Number(s.log_length)); // follows the callbacks into every archive
    expect((await as(admin).get_log(0n, 100n)).some((e) => /created archive/.test(e.message))).toBe(true);
    unwrap(await as(admin).admin_icrc3_spill_now());
    expect((await as(admin).icrc3_log_status()).live_blocks).toBe(0n);
    expect((await as(admin).admin_icrc3_repair_archive_controllers()).every(([, x]) => 'Ok' in x)).toBe(true);
    unwrap(await as(admin).admin_set_icrc3_settings({ max_live_blocks: [2000n], spill_batch_size: [500n], archive_max_blocks: [1_000_000n], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }));
  }, 120_000);
});

describe('upgrades', () => {
  it('keep the log, the archives and the certified tip (wasm_memory_persistence = keep)', async () => {
    const blocksBefore = await verifiedLog();
    const upgrade = async () => { await pic.upgradeCanister({ sender: admin, canisterId: notifId, wasm: wasm(NOTIF_WASM), arg: IDL.encode([], []), upgradeModeOptions: KEEP }); await pic.tick(2); };
    // the first upgrade of a fresh install puts the bootstrap maintainer on the admin list (production has it already)
    await upgrade();
    const blocks = await verifiedLog();
    expect(blocks.slice(0, blocksBefore.length)).toEqual(blocksBefore);
    expect(strip(blocks.slice(blocksBefore.length))).toEqual([{ t: 'admin_add', via: 'upgrade', principal: P(BOOTSTRAP_ADMIN) }]);
    const before = await as(admin).icrc3_log_status();
    await upgrade();
    expect(await as(admin).icrc3_log_status()).toEqual(before);
    expect(await verifiedLog()).toEqual(blocks); // the tip certificate is republished
    unwrap(await as(admin).admin_add_admin(carol));
    expect((await verifiedLog()).at(-1)).toMatchObject({ t: 'admin_add', principal: P(carol) });
  }, 120_000);

  it('from the production build with keep: apps, balances, admins and the fee books stay, and the log starts empty', async () => {
    const oldId = await install(pic, { name: 'sneed_notifications_preicrc3', cycles: 20n * T, targetSubnetId: appSubnet });
    const o = (p) => as(p, oldId);
    await expect(o(alice).icrc3_log_status()).rejects.toThrow(); // the production code has no log
    // as production: upgraded once with its own code, which put the bootstrap maintainer on the admin list
    await pic.advanceTime(600_000); await pic.tick(2); // install_code rate limit
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm('sneed_notifications_preicrc3'), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    expect((await o(admin).get_admins()).map((p) => p.toText())).toEqual([BOOTSTRAP_ADMIN.toText()]);
    await configure(oldId);
    // the forwarding sender canister belongs to the app on notifId; this app uses a fresh sender
    const sender3 = await install(pic, { name: 'MockNotifySender', controllers: [alice], sender: alice });
    const app = unwrap(await o(alice).register_app({ name: 'Old App', logo: [], description: '', canisters: [sender3], topics: TOPICS }));
    unwrap(await o(admin).admin_add_admin(dave));
    await setUser(bob, oldId, app);
    await fund(bob, 30_000_000n, oldId);
    unwrap(await o(bob).top_up(30_000_000n));
    await fund(alice, 5_000_000n, oldId);
    unwrap(await o(alice).top_up_app(app, 5_000_000n));
    await settle();
    const snapshot = async () => ser({
      app: await o(admin).get_app(app), apps: await o(admin).list_apps(0n, 10n), admins: await o(admin).get_admins(), config: await o(admin).get_config(),
      bob: await o(bob).get_my_settings(), appBalance: await o(admin).get_app_balance(app), stats: await actorAs(pic, statsV1Idl, oldId, admin).stats(),
      fees: { ...(await o(admin).get_fee_forwarding()), last_check: 0n, events: [] },
    });
    const before = await snapshot();

    await pic.advanceTime(600_000); await pic.tick(2);
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(NOTIF_WASM), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    await pic.tick(2);
    expect(await snapshot()).toBe(before);
    expect(await o(alice).icrc3_log_status()).toMatchObject({ log_length: 0n, live_blocks: 0n, archives: [], last_block_hash: [], history_imported: false });
    expect(await o(alice).icrc3_get_tip_certificate()).toEqual([]);

    // the first logged act after the upgrade is block 0, without phash; the log verifies
    await settle(); // the books were measured before the upgrade: no new backlog block
    unwrap(await o(admin).admin_remove_admin(dave));
    expect(strip(await verifiedLog(oldId))).toEqual([{ t: 'admin_remove', caller: P(admin), principal: P(dave) }]);
    expect((await rawLog(oldId))[0].Map.some(([k]) => k === 'phash')).toBe(false);
  }, 180_000);
});
