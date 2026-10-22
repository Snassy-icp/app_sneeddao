// The Sneed Monitor activity log (spec/sneed_mon.md §9): an empty log with the documented
// catalogue; one block per deposit credited and per withdrawal (with the ledger block), per auto
// top-up pulled (user, amount, the wallet account it came from, ledger block), per round that
// charged anything (never one per check: the round's checks, total and number of users, and each
// user's total only while at most 20 users were charged), per user paused or resumed, per fee
// forward and fee withdrawal, per admin added or removed and per configuration, tuning, billing,
// tier or special-price value changed. Nothing for watches, neuron registrations, topic lists,
// refused calls or calls that change nothing, and no watched target anywhere in the log. The
// hash chain and the certified tip verify (lib/icrc3.js); blocks spill into archives
// co-controlled by SNS root; the ingress guard; upgrades keep the log (and a round cut short by
// an upgrade is still logged), and an upgrade with keep from the staging build (src/sneed_mon at
// 5f62b7d5, module hash ab310a51…, build/sneed_mon_preicrc3.wasm) keeps balances, watches and
// the accounting and starts an empty log.
// MON_WASM=sneed_mon_preicrc3 npx vitest run tests/sneed-mon-icrc3.test.js runs it against the
// staging code: it fails there (no log).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, unwrap, errOf, wasm, refusedAtIngress, asUpdates, account, principalToSubaccount, SNEED_SNS_ROOT, T } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { archiveIdl, btype, tx, verifyLog, icrc3Service } from '../lib/icrc3.js';
import { idlFactory as monIdl } from '../build/sneed_mon.did.js';
import { idlFactory as notifIdl } from '../build/sneed_notifications.did.js';

const MON_WASM = process.env.MON_WASM || 'sneed_mon';
const BLOCK_TYPES_URL = 'https://app.sneeddao.com/api/sneed_mon#block-types';
const CATALOGUE = [
  'deposit', 'withdraw', 'auto_top_up', 'round_charges', 'user_pause', 'user_resume', 'fee_forward', 'fee_withdraw',
  'admin_add', 'admin_remove', 'config_update',
].map((t) => `sneedmon_${t}`);
const KEEP = { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] };
const MIN = 60_000;
const FEE = 10_000n;
const CHECK = 18_000n; // an hourly check at the default tier table
const ICP = 100_000_000n;
const dave = user('mon-icrc3-dave');

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

const LogEntry = IDL.Record({ id: IDL.Nat, ts: IDL.Int, level: IDL.Variant({ info: IDL.Null, error: IDL.Null }), cid: IDL.Nat, caller: IDL.Principal, message: IDL.Text });
const fullIdl = ({ IDL: I }) => I.Service({
  ...Object.fromEntries(monIdl({ IDL: I })._fields),
  ...icrc3Service(I),
  get_log: I.Func([I.Nat, I.Nat], [I.Vec(LogEntry)], ['query']),
});
const snswIdl = ({ IDL: I }) => I.Service({ set_instances: I.Func([I.Vec(I.Tuple(I.Principal, I.Principal))], [], []) });

let pic, rootKey, appSubnet, monId, notifId, icpId, snsA, snsB, snswId, appId, icp, setupCfg;
const as = (p, id = monId) => actorAs(pic, fullIdl, id, p);
const notifAs = (p) => actorAs(pic, notifIdl, notifId, p);
const archiveActor = (id) => actorAs(pic, archiveIdl, id, admin);
const rawLog = async (id = monId) => (await verifyLog(as(admin, id), id, rootKey, archiveActor)).blocks;
const verifiedLog = async (id = monId) => (await rawLog(id)).map((b, i) => ({ i, t: btype(b).replace(/^sneedmon_/, ''), ...plain(tx(b)) }));
const logLength = async (id = monId) => Number((await as(admin, id).icrc3_log_status()).log_length);
const since = async (mark, id = monId) => (await verifiedLog(id)).slice(mark);
const strip = (blocks) => blocks.map(({ i, ...b }) => b);

const later = async (minutes) => { await pic.advanceTime(minutes * MIN); await pic.tick(2); };
async function drain(id = monId) {
  for (let i = 0; i < 60 && (await as(admin, id).get_status()).running; i++) { await pic.advanceTime(1_500); await pic.tick(2); }
}
async function round(id = monId) { await drain(id); unwrap(await as(admin, id).admin_run_now()); await drain(id); }
const txAt = async (index) => (await icp.get_transactions()).find((t) => t.index === index);
/// ICP into the user's deposit subaccount, credited
async function fund(p, e8s, id = monId) {
  await icp.mint(account(id, principalToSubaccount(p)), e8s);
  return unwrap(await as(p, id).credit_deposit());
}
/// a user with `checks` hourly checks of snsA paid, Sneed Monitor allowed
async function watcher(name, checks = 1n, id = monId) {
  const p = user(`mon-icrc3-${name}`);
  unwrap(await notifAs(p).allow_app(appId, true));
  await fund(p, FEE + checks * CHECK, id);
  unwrap(await as(p, id).watch({ sns: snsA }));
  return p;
}

async function setup(id) {
  const m = as(admin, id);
  const cfg = await m.get_config();
  // rounds only when a test runs one (the timer's interval is a week)
  unwrap(await m.admin_set_config({ ...cfg.core, notifications: [notifId], sns_wasm: snswId, interval_s: 604_800n }));
  unwrap(await m.admin_set_billing({ ...cfg.billing, icp_ledger: icpId, fee_destination: [] }));
  return cfg;
}

beforeAll(async () => {
  ({ pic, rootKey, appSubnet } = await createPic());
  notifId = await install(pic, { name: 'sneed_notifications' });
  snswId = await install(pic, { name: 'MockForumSnsW' });
  snsA = await install(pic, { name: 'MockMonSns' });
  snsB = await install(pic, { name: 'MockMonSns' });
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE, symbol: 'ICP', decimals: 8 }] });
  icp = actorAs(pic, ledgerIdl, icpId, admin);
  await actorAs(pic, snswIdl, snswId, admin).set_instances([[snsA, snsA], [snsB, snsB]]);
  const n = actorAs(pic, notifIdl, notifId, admin);
  unwrap(await n.admin_set_config({ ...(await n.get_config()), default_daily_cap: 1_000n }));
  monId = await install(pic, { name: MON_WASM, cycles: 20n * T, targetSubnetId: appSubnet });
}, 180_000);
afterAll(async () => { await pic?.tearDown(); });

describe('fresh install', () => {
  it('has an empty log, the documented catalogue and ICRC-3 among its standards', async () => {
    expect(await as(alice).icrc3_log_status()).toMatchObject({ log_length: 0n, live_blocks: 0n, archives: [], history_imported: false, last_block_hash: [] });
    expect(await as(alice).icrc3_get_tip_certificate()).toEqual([]);
    expect(await as(alice).icrc3_supported_block_types()).toEqual(CATALOGUE.map((block_type) => ({ block_type, url: BLOCK_TYPES_URL })));
    expect((await as(alice).icrc10_supported_standards()).map((s) => s.name)).toEqual(['ICRC-3', 'ICRC-10']);
  });
});

describe('configuration and admins', () => {
  it('admin_set_config, admin_set_billing and the app registration: one block per value that changed, with the old value', async () => {
    setupCfg = await setup(monId);
    appId = unwrap(await as(admin).admin_register_with_notifications());
    const c = setupCfg;
    expect(strip(await verifiedLog())).toEqual([
      { t: 'config_update', caller: P(admin), key: 'notifications', old_value: P(c.core.notifications[0]), value: P(notifId) },
      { t: 'config_update', caller: P(admin), key: 'sns_wasm', old_value: P(c.core.sns_wasm), value: P(snswId) },
      { t: 'config_update', caller: P(admin), key: 'interval_s', old_value: 600n, value: 604_800n },
      { t: 'config_update', caller: P(admin), key: 'icp_ledger', old_value: P(c.billing.icp_ledger), value: P(icpId) },
      { t: 'config_update', caller: P(admin), key: 'fee_destination', old_value: [P(c.billing.fee_destination[0].owner), hex(c.billing.fee_destination[0].subaccount[0])], value: 'none' },
      { t: 'config_update', caller: P(admin), key: 'app_id', old_value: 'none', value: appId },
    ]);
  });

  it('tuning, tiers, special prices, pause, interval, fee settings, the log settings; repeats and refusals append nothing', async () => {
    const mark = await logLength();
    const cfg = await as(admin).get_config();
    unwrap(await as(admin).admin_set_config(cfg.core)); // unchanged
    unwrap(await as(admin).admin_set_billing(cfg.billing));
    unwrap(await as(admin).admin_set_tuning(cfg.tuning));
    unwrap(await as(admin).admin_set_tiers(cfg.tiers));
    expect(await refusedAtIngress(as(bob).admin_set_config({ ...cfg.core, paused: true }))).toBe(true);
    expect(await refusedAtIngress(as(bob).set_admin_prices({ base_daily_price_e8s: [1n] }))).toBe(true);
    unwrap(await as(admin).admin_set_tuning({ ...cfg.tuning, parallel_calls: 10n, defaults: { ...cfg.tuning.defaults, reminders: false } }));
    expect(errOf(await as(admin).admin_set_tuning({ ...cfg.tuning, parallel_calls: 0n }))).toMatch(/parallel_calls/);
    unwrap(await as(admin).admin_set_tuning(cfg.tuning));
    unwrap(await as(admin).admin_set_tiers({ ...cfg.tiers, base_daily_price_e8s: 288_000n }));
    unwrap(await as(admin).admin_set_tiers(cfg.tiers));
    unwrap(await as(admin).set_admin_prices({ base_daily_price_e8s: [1_000n] }));
    unwrap(await as(admin).set_admin_prices({ base_daily_price_e8s: [1_000n] }));
    unwrap(await as(admin).set_admin_prices({ base_daily_price_e8s: [] }));
    const partner = { label: 'Partner DAO', prices: { base_daily_price_e8s: [72_000n] }, expires_at: [] };
    unwrap(await as(admin).set_partner_prices(dave, partner));
    unwrap(await as(admin).set_partner_prices(dave, partner)); // the same
    unwrap(await as(admin).set_partner_prices(dave, { ...partner, expires_at: [5_000_000_000_000_000_000n] }));
    unwrap(await as(admin).remove_partner_prices(dave));
    expect(errOf(await as(admin).remove_partner_prices(dave))).toMatch(/No partner/);
    unwrap(await as(admin).admin_pause());
    unwrap(await as(admin).admin_pause());
    unwrap(await as(admin).admin_resume());
    unwrap(await as(admin).admin_set_interval(604_800n)); // unchanged
    expect(errOf(await as(admin).admin_set_interval(5n))).toMatch(/at least 60/);
    unwrap(await as(admin).admin_set_fee_sweep_threshold(cfg.billing.fee_sweep_threshold_e8s));
    unwrap(await as(admin).admin_set_fee_destination([]));
    unwrap(await as(admin).admin_set_app_id([appId]));
    const none = { max_live_blocks: [], spill_batch_size: [], archive_max_blocks: [], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] };
    unwrap(await as(admin).admin_set_icrc3_settings({ ...none, spill_batch_size: [500n] })); // the default
    unwrap(await as(admin).admin_set_icrc3_settings({ ...none, spill_batch_size: [400n] }));
    unwrap(await as(admin).admin_set_icrc3_settings({ ...none, spill_batch_size: [500n] }));
    const defaults = (d) => ({ every_min: d.every_min, topics: 'all', new_proposals: d.new_proposals ? 1n : 0n, reminders: d.reminders ? 1n : 0n, reminder_window_s: d.reminder_window_s });
    const d0 = defaults(cfg.tuning.defaults);
    const d1 = { ...d0, reminders: 0n };
    const tiers = cfg.tiers.tiers.map((t) => ({ every_min: t.every_min, daily_multiplier: t.daily_multiplier }));
    const pv = (e) => ({ label: 'Partner DAO', prices: { base_daily_price_e8s: 72_000n }, ...e });
    expect(tiers).toHaveLength(4);
    expect(strip(await since(mark))).toEqual([
      { t: 'config_update', caller: P(admin), key: 'defaults', old_value: d0, value: d1 },
      { t: 'config_update', caller: P(admin), key: 'parallel_calls', old_value: cfg.tuning.parallel_calls, value: 10n },
      { t: 'config_update', caller: P(admin), key: 'defaults', old_value: d1, value: d0 },
      { t: 'config_update', caller: P(admin), key: 'parallel_calls', old_value: 10n, value: cfg.tuning.parallel_calls },
      { t: 'config_update', caller: P(admin), key: 'base_daily_price_e8s', old_value: 144_000n, value: 288_000n },
      { t: 'config_update', caller: P(admin), key: 'base_daily_price_e8s', old_value: 288_000n, value: 144_000n },
      { t: 'config_update', caller: P(admin), key: 'admin_prices', old_value: {}, value: { base_daily_price_e8s: 1_000n } },
      { t: 'config_update', caller: P(admin), key: 'admin_prices', old_value: { base_daily_price_e8s: 1_000n }, value: {} },
      { t: 'config_update', caller: P(admin), key: 'partner_prices', partner: P(dave), value: pv({}) },
      { t: 'config_update', caller: P(admin), key: 'partner_prices', partner: P(dave), value: pv({ expires_at: 5_000_000_000_000_000_000n }), old_value: pv({}) },
      { t: 'config_update', caller: P(admin), key: 'partner_prices', partner: P(dave), old_value: pv({ expires_at: 5_000_000_000_000_000_000n }), value: 'removed' },
      { t: 'config_update', caller: P(admin), key: 'paused', old_value: 0n, value: 1n },
      { t: 'config_update', caller: P(admin), key: 'paused', old_value: 1n, value: 0n },
      { t: 'config_update', caller: P(admin), key: 'icrc3_spill_batch_size', old_value: 500n, value: 400n },
      { t: 'config_update', caller: P(admin), key: 'icrc3_spill_batch_size', old_value: 400n, value: 500n },
    ]);
  });

  it('admins: additions and removals; repeats and refusals append nothing', async () => {
    const mark = await logLength();
    expect(await refusedAtIngress(as(bob).admin_add_admin(bob))).toBe(true);
    unwrap(await as(admin).admin_add_admin(dave));
    unwrap(await as(admin).admin_add_admin(dave));
    unwrap(await as(dave).admin_add_admin(carol));
    unwrap(await as(admin).admin_remove_admin(carol));
    unwrap(await as(admin).admin_remove_admin(carol));
    expect(strip(await since(mark))).toEqual([
      { t: 'admin_add', caller: P(admin), principal: P(dave) },
      { t: 'admin_add', caller: P(dave), principal: P(carol) },
      { t: 'admin_remove', caller: P(admin), principal: P(carol) },
    ]);
  });
});

describe('money', () => {
  it('deposits and withdrawals: one block each with the ledger block; nothing to credit and refused withdrawals append nothing', async () => {
    const mark = await logLength();
    const p = user('mon-icrc3-depositor');
    expect(unwrap(await as(p).credit_deposit()).credited_e8s).toBe(0n); // nothing arrived
    const r = await fund(p, 500_000n);
    expect(r.credited_e8s).toBe(500_000n - FEE);
    expect(errOf(await as(p).withdraw_balance(10n * ICP, account(p)))).toMatch(/Your balance/);
    expect(errOf(await as(p).withdraw_balance(FEE, account(p)))).toMatch(/more than the ledger fee/);
    const block = unwrap(await as(p).withdraw_balance(200_000n, account(carol)));
    const blocks = strip(await since(mark));
    expect(blocks).toEqual([
      { t: 'deposit', caller: P(p), amount_e8s: 500_000n - FEE, fee_e8s: FEE, ledger_block: expect.any(BigInt) },
      { t: 'withdraw', caller: P(p), amount_e8s: 200_000n, fee_e8s: FEE, to: [P(carol)], ledger_block: block },
    ]);
    const d = await txAt(blocks[0].ledger_block);
    expect([d.from.owner.toText(), hex(d.from.subaccount[0]), d.to.owner.toText(), d.to.subaccount, d.amount]).toEqual([monId.toText(), hex(principalToSubaccount(p)), monId.toText(), [], 500_000n - FEE]);
    const w = await txAt(block);
    expect([w.from.owner.toText(), w.to.owner.toText(), w.amount]).toEqual([monId.toText(), carol.toText(), 200_000n - FEE]);
  });

  it('watching appends nothing, and no watched target appears anywhere in the log', async () => {
    const mark = await logLength();
    const p = user('mon-icrc3-watcher');
    await fund(p, FEE + 10n * CHECK);
    unwrap(await as(p).watch({ sns: snsB }));
    unwrap(await as(p).update_watch({ sns: snsB }, { every_min: [180n], topics: [], new_proposals: [], reminders: [], reminder_window_s: [] }));
    unwrap(await as(p).set_nns_neurons([7n, 8n]));
    unwrap(await as(p).watch({ nns: null }));
    unwrap(await as(p).unwatch({ nns: null }));
    unwrap(await as(p).unwatch({ sns: snsB }));
    expect(strip(await since(mark)).map((b) => b.t)).toEqual(['deposit']);
    const all = ser(await verifiedLog());
    expect(all).not.toContain(P(snsB));
    expect(all).not.toContain(P(snsA));
  });

  it('charges: one block per round that charged, with its checks, total and users (each user\'s total while few); rounds that charge nothing append nothing', async () => {
    const p1 = await watcher('r1', 3n);
    const p2 = await watcher('r2', 3n);
    const mark = await logLength();
    await round();
    let blocks = strip(await since(mark));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ t: 'round_charges', via: 'timer', checks: 2n, charged_e8s: 2n * CHECK, users: 2n });
    expect(new Set(blocks[0].per_user.map(([u, c, n]) => `${u}:${c}:${n}`))).toEqual(new Set([`${P(p1)}:${CHECK}:1`, `${P(p2)}:${CHECK}:1`]));
    const m2 = await logLength();
    await later(10);
    await round(); // nothing is due within the hour
    expect(await logLength()).toBe(m2);
    await later(61);
    await round();
    blocks = strip(await since(m2));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].round).toBeGreaterThan(strip(await since(mark))[0].round);
  });

  it('a round that charged more than 20 users names none of them', async () => {
    await later(61);
    await round(); // the earlier watchers' checks out of the way
    const ps = [];
    for (let i = 0; i < 21; i++) ps.push(await watcher(`many${i}`));
    const mark = await logLength();
    await round();
    const [b] = strip(await since(mark));
    expect(b).toEqual({ t: 'round_charges', via: 'timer', round: b.round, checks: 21n, charged_e8s: 21n * CHECK, users: 21n });
    // they are paused at the next round (one check paid): one block each, nothing per check
    const m2 = await logLength();
    await later(61);
    await round();
    const blocks = strip(await since(m2));
    const pauses = blocks.filter((x) => x.t === 'user_pause' && ps.map(P).includes(x.user));
    expect(pauses.map((x) => x.user).sort()).toEqual(ps.map(P).sort());
    expect(pauses[0]).toEqual({ t: 'user_pause', via: 'timer', user: pauses[0].user, balance_e8s: 0n, price_e8s: CHECK });
    // a paused user's resume: after the deposit block, by the user's own call
    const m3 = await logLength();
    await fund(ps[0], FEE + CHECK);
    expect(strip(await since(m3))).toEqual([
      { t: 'deposit', caller: P(ps[0]), amount_e8s: CHECK, fee_e8s: FEE, ledger_block: expect.any(BigInt) },
      { t: 'user_resume', caller: P(ps[0]), user: P(ps[0]), balance_e8s: CHECK },
    ]);
    // the next round charges the resumed user only; the paused ones are not checked
    const m4 = await logLength();
    await later(61);
    await round();
    const charged = strip(await since(m4)).filter((x) => x.t === 'round_charges');
    expect(charged.every((x) => !x.per_user || !x.per_user.some(([u]) => ps.slice(1).map(P).includes(u)))).toBe(true);
  }, 180_000);

  it('auto top-up: one block with the user, amount, the wallet account and the ledger block, from the timer; a refused pull appends nothing', async () => {
    await later(61);
    await round();
    const p = await watcher('atu');
    const q = await watcher('atu-refused');
    await icp.mint(account(p, new Uint8Array(32).fill(7)), ICP);
    unwrap(await actorAs(pic, ledgerIdl, icpId, p).icrc2_approve({ from_subaccount: [new Uint8Array(32).fill(7)], spender: account(monId), amount: ICP, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
    unwrap(await as(p).set_auto_top_up([{ amount_e8s: 200_000n, when_below_e8s: 100_000n, from_subaccount: [new Uint8Array(32).fill(7)] }]));
    unwrap(await as(q).set_auto_top_up([{ amount_e8s: 200_000n, when_below_e8s: 100_000n, from_subaccount: [] }])); // no approval
    const mark = await logLength();
    await round();
    const blocks = strip(await since(mark));
    const atu = blocks.filter((b) => b.t === 'auto_top_up');
    expect(atu).toEqual([{ t: 'auto_top_up', via: 'timer', user: P(p), amount_e8s: 200_000n, fee_e8s: FEE, from: [P(p), hex(new Uint8Array(32).fill(7))], ledger_block: expect.any(BigInt) }]);
    const t = await txAt(atu[0].ledger_block);
    expect([t.from.owner.toText(), hex(t.from.subaccount[0]), t.to.owner.toText(), t.amount]).toEqual([p.toText(), hex(new Uint8Array(32).fill(7)), monId.toText(), 200_000n]);
    expect(blocks.filter((b) => b.t !== 'auto_top_up').map((b) => b.t)).toEqual(['round_charges']);
  });

  it('fee forwarding (from the timer) and fee withdrawals (by an admin): one block each with the destination and the ledger block', async () => {
    const acc = await as(admin).get_accounting();
    expect(acc.fees_available_e8s).toBeGreaterThan(3n * FEE);
    const cfg = await as(admin).get_config();
    const mark = await logLength();
    expect(errOf(await as(admin).admin_withdraw_fees(10n * ICP, account(carol)))).toMatch(/Fees available/);
    const wb = unwrap(await as(dave).admin_withdraw_fees(2n * FEE, account(carol)));
    unwrap(await as(admin).admin_set_billing({ ...cfg.billing, fee_destination: [account(alice)], fee_sweep_threshold_e8s: 2n * FEE }));
    await later(61);
    await round();
    const blocks = strip(await since(mark));
    const after = await as(admin).get_accounting();
    const fwd = blocks.find((b) => b.t === 'fee_forward');
    expect(blocks.filter((b) => b.t.startsWith('fee_') || b.t === 'config_update')).toEqual([
      { t: 'fee_withdraw', caller: P(dave), amount_e8s: 2n * FEE, fee_e8s: FEE, to: [P(carol)], ledger_block: wb },
      { t: 'config_update', caller: P(admin), key: 'fee_destination', old_value: 'none', value: [P(alice)] },
      { t: 'config_update', caller: P(admin), key: 'fee_sweep_threshold_e8s', old_value: cfg.billing.fee_sweep_threshold_e8s, value: 2n * FEE },
      { t: 'fee_forward', via: 'timer', amount_e8s: fwd.amount_e8s, fee_e8s: FEE, to: [P(alice)], ledger_block: fwd.ledger_block, forwards: after.fee_forwards },
    ]);
    expect(fwd.amount_e8s).toBe(after.fees_forwarded_e8s);
    const t = await txAt(fwd.ledger_block);
    expect([t.from.owner.toText(), t.to.owner.toText(), t.amount]).toEqual([monId.toText(), alice.toText(), fwd.amount_e8s - FEE]);
    unwrap(await as(admin).admin_set_billing({ ...cfg.billing, fee_destination: [] }));
  });
});

describe('ingress', () => {
  it('refuses the log queries as update calls and the log\'s admin methods from non-admins at ingress', async () => {
    const u = actorAs(pic, asUpdates(fullIdl), monId, bob);
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
  });
});

describe('archives', () => {
  it('spill past the live limit into archives co-controlled by SNS root, and still verify', async () => {
    const before = await logLength();
    unwrap(await as(admin).admin_set_icrc3_settings({ max_live_blocks: [5n], spill_batch_size: [10n], archive_max_blocks: [20n], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }));
    await pic.advanceTime((15 * 60 + 5) * 1000);
    await pic.tick(100);
    const s = await as(admin).icrc3_log_status();
    expect(Number(s.log_length)).toBe(before + 3);
    expect(s.live_blocks).toBeLessThan(5n);
    expect(s.archives.length).toBeGreaterThanOrEqual(2);
    for (const a of s.archives) {
      expect((await pic.getControllers(a.canister_id)).map((p) => p.toText()).sort()).toEqual([monId.toText(), SNEED_SNS_ROOT.toText()].sort());
      expect((await archiveActor(a.canister_id).archive_status()).parent.toText()).toBe(monId.toText());
    }
    expect(await verifiedLog()).toHaveLength(Number(s.log_length));
    expect((await as(admin).get_log(0n, 100n)).some((e) => /created archive/.test(e.message))).toBe(true);
    unwrap(await as(admin).admin_icrc3_spill_now());
    expect((await as(admin).icrc3_log_status()).live_blocks).toBe(0n);
    expect((await as(admin).admin_icrc3_repair_archive_controllers()).every(([, x]) => 'Ok' in x)).toBe(true);
    unwrap(await as(admin).admin_set_icrc3_settings({ max_live_blocks: [2000n], spill_batch_size: [500n], archive_max_blocks: [1_000_000n], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }));
  }, 120_000);
});

describe('upgrades', () => {
  it('keep the log, the archives and the certified tip (wasm_memory_persistence = keep)', async () => {
    const before = await as(admin).icrc3_log_status();
    const blocksBefore = await verifiedLog();
    await pic.upgradeCanister({ sender: admin, canisterId: monId, wasm: wasm(MON_WASM), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    await pic.tick(2);
    expect(await as(admin).icrc3_log_status()).toEqual(before);
    expect(await verifiedLog()).toEqual(blocksBefore);
    unwrap(await as(admin).admin_add_admin(carol));
    expect((await verifiedLog()).at(-1)).toMatchObject({ t: 'admin_add', principal: P(carol) });
  }, 120_000);

  it('a round cut short by an upgrade is logged once, when the next round starts', async () => {
    const id = await install(pic, { name: MON_WASM, cycles: 20n * T, targetSubnetId: appSubnet });
    const m = as(admin, id);
    await setup(id);
    for (let i = 0; i < 3; i++) await watcher(`cut${i}`, 30n, id);
    await round(id);
    expect(strip(await verifiedLog(id)).filter((b) => b.t === 'round_charges').map((b) => b.checks)).toEqual([3n]);
    // six hours on, the round charges the three checks and then runs out of calls refreshing their
    // neurons (two calls a tick, no follow-up ticks): it stays open, its charges not logged yet
    await later(6 * 60 + 1);
    const cfg = await m.get_config();
    unwrap(await m.admin_set_config({ ...cfg.core, max_calls_per_tick: 2n, max_continuations: 0n }));
    const mark = await logLength(id);
    const f0 = (await m.get_accounting()).fees_collected_e8s;
    unwrap(await m.admin_run_now());
    await drain(id);
    const cut = await m.get_status();
    expect(cut.running).toBe(true); // the round is open
    expect((await m.get_accounting()).fees_collected_e8s - f0).toBe(3n * CHECK);
    expect(await logLength(id)).toBe(mark);
    await pic.advanceTime(600_000); await pic.tick(2);
    await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(MON_WASM), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    await pic.tick(2);
    unwrap(await m.admin_set_config(cfg.core));
    await round(id); // a new round: the cut one is logged first; nothing is due yet
    const blocks = strip(await since(mark, id)).filter((b) => b.t === 'round_charges');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ via: 'timer', checks: 3n, charged_e8s: 3n * CHECK, users: 3n });
    expect(blocks[0].round).toBe(cut.rounds); // the cut round, not the one that logged it
    await later(61);
    await round(id);
    expect(strip(await since(mark, id)).filter((b) => b.t === 'round_charges').map((b) => b.checks)).toEqual([3n, 3n]);
  }, 180_000);

  it('from the staging build with keep: balances, watches and the accounting stay, and the log starts empty', async () => {
    const oldId = await install(pic, { name: 'sneed_mon_preicrc3', cycles: 20n * T, targetSubnetId: appSubnet });
    const o = (p) => as(p, oldId);
    await expect(o(alice).icrc3_log_status()).rejects.toThrow(); // the staging code has no log
    await setup(oldId);
    unwrap(await o(admin).admin_set_app_id([appId])); // messages are not the subject here
    const p = user('mon-icrc3-old');
    await fund(p, FEE + 5n * CHECK, oldId);
    unwrap(await o(p).watch({ sns: snsA }));
    await round(oldId);
    unwrap(await o(admin).admin_add_admin(dave));
    const snapshot = async () => ser({
      balance: await o(p).get_my_balance(), watches: await o(p).get_my_watches(), charges: await o(p).get_my_charges(0n, 10n),
      accounting: await o(admin).get_accounting(), admins: await o(admin).get_admins(), config: await o(admin).get_config(),
    });
    const before = await snapshot();
    await pic.advanceTime(600_000); await pic.tick(2);
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(MON_WASM), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    await pic.tick(2);
    expect(await snapshot()).toBe(before);
    expect(await o(alice).icrc3_log_status()).toMatchObject({ log_length: 0n, live_blocks: 0n, archives: [], last_block_hash: [], history_imported: false });
    await later(61);
    await round(oldId);
    const blocks = strip(await verifiedLog(oldId));
    expect(blocks).toEqual([{ t: 'round_charges', via: 'timer', round: blocks[0].round, checks: 1n, charged_e8s: CHECK, users: 1n, per_user: [[P(p), CHECK, 1n]] }]);
    expect((await rawLog(oldId))[0].Map.some(([k]) => k === 'phash')).toBe(false);
  }, 180_000);
});
