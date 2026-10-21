// sneed_notifications revenue forwarding (spec/sneed_notifications.md, "Revenue"): prices deducted
// from user and app balances are counted (fees_earned, minus refunds) and forwarded to the RLL ICP
// splitter once 0.1 ICP has accumulated, in one transfer, never touching what the canister owes
// (balances, paid deliveries that may still be refunded). The fees spent before forwarding existed
// are measured once from the ledger (the backlog), on an upgrade from the production module.
//
// NOTIF_WASM=sneed_notifications_prod runs the first suite against production's code: it fails
// there (no forwarding, the spent ICP stays in the canister), and passes on the new code.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, unwrap, errOf, wasm, refusedAtIngress, asUpdates, account } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { idlFactory as notifIdl } from '../build/sneed_notifications.did.js';

const NOTIF_WASM = process.env.NOTIF_WASM || 'sneed_notifications';
const senderIdl = ({ IDL }) => IDL.Service({ forward: IDL.Func([IDL.Principal, IDL.Text, IDL.Vec(IDL.Nat8)], [IDL.Vec(IDL.Nat8)], []) });
const relay = user('fees-discord-relay');
const SPLITTER = '6jvpj-sqaaa-aaaaj-azwnq-cai';
const SPLITTER_SUB = [1, 0, 0, 0, 0, 6, ...new Array(26).fill(0)];
const PRICE = 2_000_000n; // a Discord delivery here: 0.02 ICP
const FEE = 10_000n; // the mock ledger's fee
const MIN5 = 5 * 60_000 + 1_000;
const keep = { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] };

/// A world: sneed_notifications, a mock ICP ledger, an app canister, a Discord relay.
async function world(pic, notifWasm) {
  const notifId = await install(pic, { name: notifWasm });
  const icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE, symbol: 'ICP', decimals: 8 }] });
  const senderId = await install(pic, { name: 'MockNotifySender', controllers: [alice], sender: alice });
  const as = (p) => actorAs(pic, notifIdl, notifId, p);
  const n = as(admin);
  const icp = actorAs(pic, ledgerIdl, icpId, admin);
  const sender = actorAs(pic, senderIdl, senderId, alice);
  const svc = notifIdl({ IDL });
  const asApp = async (name, ...args) => {
    const f = svc._fields.find(([k]) => k === name)[1];
    return IDL.decode(f.retTypes, await sender.forward(notifId, name, IDL.encode(f.argTypes, args)))[0];
  };
  const c = await n.get_config();
  unwrap(await n.admin_set_config({ ...c, icp_ledger: icpId, relays: [[relay, { discord: null }]], prices_e8s: c.prices_e8s.map(([k, p]) => ('discord' in k ? [k, PRICE] : [k, p])) }));
  const appId = unwrap(await as(alice).register_app({ name: 'Fees Test', logo: [], description: '', canisters: [senderId], topics: [{ id: 'alert', title: 'Alert', description: '', level: { urgent: null } }] }));
  // a user with a verified Discord channel as their only channel, generous caps, no low-balance alert
  const setUser = async (who) => {
    unwrap(await as(who).allow_app(appId, true));
    const [[, p]] = await as(who).get_my_apps();
    unwrap(await as(who).set_permission(appId, { ...p, daily_cap: 10_000n, daily_spend_cap_e8s: 100_000_000_000n }));
    unwrap(await as(who).set_low_balance_alert(0n));
    const ch = unwrap(await as(who).add_channel({ discord: null }, 'discord', new TextEncoder().encode(`enc:${who.toText()}`)));
    const [job] = await as(relay).relay_pull(10n);
    await as(relay).relay_ack([[job.id, { ok: null }]]);
    unwrap(await as(who).verify_channel(ch, job.title.match(/(\d{6})/)[1]));
    const mine = await as(who).get_my_settings();
    unwrap(await as(who).set_settings({ ...mine.settings, always_copy: [], defaults: { urgent: [ch], normal: [], info: [] } }));
  };
  const fund = async (who, amount) => {
    await icp.mint(account(who), amount + 2n * FEE);
    unwrap(await actorAs(pic, ledgerIdl, icpId, who).icrc2_approve({ from_subaccount: [], spender: account(notifId), amount: amount + FEE, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
  };
  const topUp = async (who, amount) => { await fund(who, amount); return unwrap(await as(who).top_up(amount)); };
  const topUpApp = async (who, amount) => { await fund(who, amount); return unwrap(await as(who).top_up_app(appId, amount)); };
  let seq = 0;
  const notify = (over = {}) => asApp('notify', { user: bob, topic: 'alert', title: 'Alert', body: 'x', link: [], dedupe: [`d${seq++}`], sponsored: false, ...over });
  const deliverAll = async (ok = true) => {
    const jobs = await as(relay).relay_pull(100n);
    await as(relay).relay_ack(jobs.map((j) => [j.id, ok ? { ok: null } : { err: 'gave up' }]));
    return jobs.length;
  };
  // let the timer's fee check run (at most every 5 minutes) and its ledger calls finish
  const settle = async () => { await pic.advanceTime(MIN5); await pic.tick(10); };
  const toSplitter = async () => (await icp.get_transactions()).filter((t) => t.to.owner.toText() === SPLITTER && t.to.subaccount.length === 1 && [...t.to.subaccount[0]].join() === SPLITTER_SUB.join());
  const ledgerBalance = () => icp.icrc1_balance_of(account(notifId));
  const status = () => n.get_fee_forwarding();
  return { notifId, icpId, n, as, icp, appId, setUser, topUp, topUpApp, notify, deliverAll, settle, toSplitter, ledgerBalance, status };
}

describe('sneed_notifications: revenue forwarding', () => {
  let pic, w;
  beforeAll(async () => {
    ({ pic } = await createPic());
    w = await world(pic, NOTIF_WASM);
    await w.setUser(bob);
    await w.setUser(carol);
    await w.settle(); // the first check after the install: nothing earned, no backlog
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('defaults to the RLL ICP splitter and 0.1 ICP, public to read', async () => {
    const s = await w.as(Principal.anonymous()).get_fee_forwarding();
    expect(s.destination[0].owner.toText()).toBe(SPLITTER);
    expect([...s.destination[0].subaccount[0]]).toEqual(SPLITTER_SUB);
    expect(s.threshold_e8s).toBe(10_000_000n);
    expect(s.backlog_e8s).toEqual([0n]); // measured at the first check: a new canister spent nothing before
    expect(s.earned_e8s).toBe(0n);
  });

  it('counts the prices it deducts: user-paid, app-paid and the per-notify price; refunds come off', async () => {
    await w.topUp(bob, 50_000_000n);
    await w.topUpApp(alice, 20_000_000n);
    const c = await w.n.get_config();
    unwrap(await w.n.admin_set_config({ ...c, notify_price_e8s: 1_000n }));
    expect((await w.notify()).ok.deliveries).toBe(1n); // bob pays 1_000 + PRICE
    expect((await w.notify({ sponsored: true })).ok.deliveries).toBe(1n); // the app pays 1_000 + PRICE
    expect((await w.notify({ user: carol })).ok.deliveries).toBe(0n); // carol has no balance: suppressed, nothing deducted
    let s = await w.status();
    expect(s.earned_e8s).toBe(2n * (PRICE + 1_000n));
    expect(s.reserved_e8s).toBe(2n * PRICE); // not delivered yet: may still be refunded
    expect((await w.as(bob).get_my_settings()).balance_e8s).toBe(50_000_000n - PRICE - 1_000n);
    expect(await w.n.get_app_balance(w.appId)).toBe(20_000_000n - PRICE - 1_000n);
    // the relay gives up on both: refunded, and counted as refunded
    unwrap(await w.n.admin_set_config({ ...c, notify_price_e8s: 1_000n, max_attempts: 1n }));
    expect(await w.deliverAll(false)).toBe(2);
    s = await w.status();
    expect(s.refunded_e8s).toBe(2n * PRICE);
    expect(s.reserved_e8s).toBe(0n);
    expect(s.unforwarded_e8s).toEqual([2_000n]); // only the per-notify prices stay earned
    unwrap(await w.n.admin_set_config({ ...c, notify_price_e8s: 0n, max_attempts: 5n }));
    expect((await w.as(bob).get_my_settings()).balance_e8s).toBe(50_000_000n - 1_000n);
  });

  it('forwards nothing below the threshold, nor while deliveries may still be refunded', async () => {
    for (let i = 0; i < 4; i++) await w.notify(); // 4 × 0.02 = 0.08 ICP
    await w.deliverAll();
    await w.settle();
    expect(await w.toSplitter()).toEqual([]);
    expect((await w.status()).unforwarded_e8s).toEqual([4n * PRICE + 2_000n]);
    await w.notify(); // 0.10 ICP earned, but this one is still queued at the relay
    await w.settle();
    expect(await w.toSplitter()).toEqual([]);
    expect((await w.status()).reserved_e8s).toBe(PRICE);
  });

  it('forwards exactly once at the threshold, to exactly the RLL splitter account, minus the ledger fee', async () => {
    await w.deliverAll(); // now 0.10002 ICP is the DAO's
    await w.settle();
    const sent = await w.toSplitter();
    expect(sent).toHaveLength(1);
    expect(sent[0].amount).toBe(5n * PRICE + 2_000n - FEE);
    expect(sent[0].from.owner.toText()).toBe(w.notifId.toText());
    const s = await w.status();
    expect(s.forwarded_e8s).toBe(5n * PRICE + 2_000n - FEE);
    expect(s.ledger_fees_paid_e8s).toBe(FEE);
    expect(s.forwards).toBe(1n);
    expect(s.unforwarded_e8s).toEqual([0n]);
    expect(s.last_forward[0].amount_e8s).toBe(sent[0].amount);
    await w.settle();
    await w.settle();
    expect(await w.toSplitter()).toHaveLength(1); // nothing more to send
  });

  it('never touches balances: after forwarding the ledger still holds every balance and refundable delivery', async () => {
    await w.notify(); // pending: reserved, refundable
    await w.notify({ sponsored: true });
    unwrap(await w.n.admin_forward_fees_now()); // nothing above the fee: a no-op
    const s = await w.status();
    const owed = (await w.as(bob).get_my_settings()).balance_e8s + (await w.n.get_app_balance(w.appId)) + s.reserved_e8s;
    expect(s.liabilities_e8s).toBe(owed);
    expect(await w.ledgerBalance()).toBeGreaterThanOrEqual(owed);
    // the relay gives up on them: refunded in full, still backed by the ledger
    const c = await w.n.get_config();
    unwrap(await w.n.admin_set_config({ ...c, max_attempts: 1n }));
    await w.deliverAll(false);
    unwrap(await w.n.admin_set_config({ ...c, max_attempts: 5n }));
    const bobBal = (await w.as(bob).get_my_settings()).balance_e8s;
    const appBal = await w.n.get_app_balance(w.appId);
    expect(bobBal).toBe(50_000_000n - 1_000n - 5n * PRICE);
    expect(appBal).toBe(20_000_000n - 1_000n);
    expect(await w.ledgerBalance()).toBeGreaterThanOrEqual(bobBal + appBal);
    // a forced forward of everything free leaves the ledger holding exactly what is owed
    for (let i = 0; i < 3; i++) await w.notify();
    await w.deliverAll();
    const r = unwrap(await w.n.admin_forward_fees_now());
    expect(r).toMatch(/Forwarded/);
    const after = await w.status();
    expect(after.unforwarded_e8s).toEqual([0n]);
    expect(await w.ledgerBalance()).toBe(after.liabilities_e8s);
    expect(after.liabilities_e8s).toBe((await w.as(bob).get_my_settings()).balance_e8s + (await w.n.get_app_balance(w.appId)));
  });

  it('leaves everything for a retry when the ledger fails, and never sends twice', async () => {
    const before = await w.toSplitter();
    const s0 = await w.status();
    for (let i = 0; i < 5; i++) await w.notify();
    await w.deliverAll();
    await w.icp.set_paused(true); // transfers answer TemporarilyUnavailable
    await w.settle();
    let s = await w.status();
    expect(await w.toSplitter()).toHaveLength(before.length);
    expect(s.forwarded_e8s).toBe(s0.forwarded_e8s);
    expect(s.unforwarded_e8s).toEqual([5n * PRICE]);
    expect(s.last_error[0]).toMatch(/TemporarilyUnavailable/);
    expect(errOf(await w.n.admin_forward_fees_now())).toMatch(/refused/);
    await w.icp.set_paused(false);
    await w.settle();
    const sent = await w.toSplitter();
    expect(sent).toHaveLength(before.length + 1);
    expect(sent.at(-1).amount).toBe(5n * PRICE - FEE);
    s = await w.status();
    expect(s.last_error).toEqual([]);
    expect(s.forwarded_e8s).toBe(s0.forwarded_e8s + 5n * PRICE - FEE);
    await w.settle();
    expect(await w.toSplitter()).toHaveLength(before.length + 1);
    expect(await w.ledgerBalance()).toBe(s.liabilities_e8s);
  });

  it('measures the free balance again when the ledger shows less than the books', async () => {
    for (let i = 0; i < 5; i++) await w.notify();
    await w.deliverAll();
    // some ICP left the canister behind the books' back (as if a forward's answer had been lost)
    const sneak = actorAs(pic, ledgerIdl, w.icpId, w.notifId);
    unwrap(await sneak.icrc1_transfer({ from_subaccount: [], to: account(carol), amount: 3n * PRICE, fee: [], memo: [], created_at_time: [] }));
    const n0 = (await w.toSplitter()).length;
    unwrap(await w.n.admin_forward_fees_now());
    const sent = await w.toSplitter();
    expect(sent).toHaveLength(n0 + 1);
    expect(sent.at(-1).amount).toBe(2n * PRICE - 2n * FEE); // only what is really free
    const s = await w.status();
    expect(s.events.some(([, e]) => /re-measured/.test(e))).toBe(true);
    expect(await w.ledgerBalance()).toBe(s.liabilities_e8s);
  });

  it('admin: a null destination keeps the fees; setters and the forward are admins only; the ingress guard knows them', async () => {
    unwrap(await w.n.admin_set_fee_destination([]));
    for (let i = 0; i < 6; i++) await w.notify();
    await w.deliverAll();
    const n0 = (await w.toSplitter()).length;
    expect(unwrap(await w.n.admin_forward_fees_now())).toMatch(/stay in the canister/);
    await w.settle();
    expect(await w.toSplitter()).toHaveLength(n0);
    expect((await w.status()).destination).toEqual([]);
    expect(errOf(await w.n.admin_set_fee_destination([{ owner: carol, subaccount: [new Uint8Array(5)] }]))).toMatch(/32 bytes/);
    unwrap(await w.n.admin_set_fee_destination([{ owner: carol, subaccount: [] }]));
    unwrap(await w.n.admin_set_fee_sweep_threshold(200_000_000n)); // 2 ICP: 0.12 ICP is below it
    await w.settle();
    expect((await w.icp.get_transactions()).filter((t) => t.to.owner.toText() === carol.toText() && t.from.owner.toText() === w.notifId.toText())).toHaveLength(1); // only the sneak transfer above
    unwrap(await w.n.admin_set_fee_sweep_threshold(10_000_000n));
    await w.settle();
    const toCarol = (await w.icp.get_transactions()).filter((t) => t.to.owner.toText() === carol.toText() && t.from.owner.toText() === w.notifId.toText());
    expect(toCarol.at(-1).amount).toBe(6n * PRICE - FEE);
    // ingress guard
    expect(await refusedAtIngress(w.as(bob).admin_set_fee_destination([]))).toBe(true);
    expect(await refusedAtIngress(w.as(bob).admin_set_fee_sweep_threshold(1n))).toBe(true);
    expect(await refusedAtIngress(w.as(bob).admin_forward_fees_now())).toBe(true);
    expect(await refusedAtIngress(actorAs(pic, asUpdates(notifIdl), w.notifId, bob).get_fee_forwarding())).toBe(true);
    // back to the default
    unwrap(await w.n.admin_set_fee_destination([{ owner: Principal.fromText(SPLITTER), subaccount: [new Uint8Array(SPLITTER_SUB)] }]));
  });

  it('keeps the counters over an upgrade', async () => {
    const before = await w.status();
    await pic.upgradeCanister({ sender: admin, canisterId: w.notifId, wasm: wasm(NOTIF_WASM), upgradeModeOptions: keep });
    const after = await w.status();
    expect({ ...after, liabilities_e8s: 0n, events: [] }).toEqual({ ...before, liabilities_e8s: 0n, events: [] });
  });
});

describe('sneed_notifications: upgrading production measures the fee backlog once', () => {
  let pic, w;
  beforeAll(async () => {
    ({ pic } = await createPic());
    w = await world(pic, 'sneed_notifications_prod');
    await w.setUser(bob);
    await w.setUser(carol);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('forwards what production spent before, never what it owes', async () => {
    // production's history: top-ups, paid deliveries (spent ICP that never left), refunds, a pending one
    await w.topUp(bob, 100_000_000n);
    await w.topUp(carol, 10_000_000n);
    await w.topUpApp(alice, 30_000_000n);
    for (let i = 0; i < 6; i++) await w.notify();
    for (let i = 0; i < 2; i++) await w.notify({ sponsored: true });
    await w.notify({ user: carol });
    expect(await w.deliverAll()).toBe(9); // 9 × 0.02 = 0.18 ICP spent
    await w.notify({ user: carol }); // a paid delivery still queued at the upgrade: owed back if it fails
    await w.settle();
    const owedBefore = { bob: (await w.as(bob).get_my_settings()).balance_e8s, carol: (await w.as(carol).get_my_settings()).balance_e8s, app: await w.n.get_app_balance(w.appId) };
    expect(owedBefore).toEqual({ bob: 100_000_000n - 6n * PRICE, carol: 10_000_000n - 2n * PRICE, app: 30_000_000n - 2n * PRICE });
    const ledgerBefore = await w.ledgerBalance();
    expect(ledgerBefore).toBe(140_000_000n); // everything ever topped up is still there

    await pic.upgradeCanister({ sender: admin, canisterId: w.notifId, wasm: wasm(NOTIF_WASM), upgradeModeOptions: keep });
    // balances preserved, nothing measured until the first check
    expect((await w.as(bob).get_my_settings()).balance_e8s).toBe(owedBefore.bob);
    expect((await w.as(carol).get_my_settings()).balance_e8s).toBe(owedBefore.carol);
    expect(await w.n.get_app_balance(w.appId)).toBe(owedBefore.app);
    let s = await w.status();
    expect(s.backlog_e8s).toEqual([]);
    expect(s.earned_e8s).toBe(0n);
    expect(s.reserved_e8s).toBe(PRICE);

    await w.settle(); // the first check after the upgrade
    s = await w.status();
    expect(s.backlog_e8s).toEqual([9n * PRICE]); // the queued one is owed, not earned
    const sent = await w.toSplitter();
    expect(sent).toHaveLength(1);
    expect(sent[0].amount).toBe(9n * PRICE - FEE);
    expect(await w.ledgerBalance()).toBe(ledgerBefore - 9n * PRICE);
    expect(await w.ledgerBalance()).toBe(s.liabilities_e8s);

    // the queued delivery fails: carol gets it back in full, still backed by the ledger
    const c = await w.n.get_config();
    unwrap(await w.n.admin_set_config({ ...c, max_attempts: 1n }));
    await w.deliverAll(false);
    expect((await w.as(carol).get_my_settings()).balance_e8s).toBe(owedBefore.carol + PRICE);
    s = await w.status();
    expect(s.unforwarded_e8s).toEqual([0n]);
    expect(await w.ledgerBalance()).toBe(s.liabilities_e8s);
    await w.settle();
    expect(await w.toSplitter()).toHaveLength(1);
    // measured once: later checks do not add a backlog again
    expect((await w.status()).backlog_e8s).toEqual([9n * PRICE]);
  });
});
