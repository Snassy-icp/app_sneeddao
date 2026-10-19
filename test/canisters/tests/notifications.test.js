// sneed_notifications (spec/sneed_notifications.md): apps register with the canisters they
// control and declare topics; users allow apps, choose channels and rules; apps notify from
// their canisters; Sneed SMS is delivered by the canister itself, other channels by relays that
// pull jobs and acknowledge them; users pay per paid delivery (an app may sponsor a message);
// caps, dedupe, quiet hours, receipts, history, the ingress guard and an upgrade.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, unwrap, errOf, wasm, refusedAtIngress, asUpdates, account } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { idlFactory as notifIdl } from '../build/sneed_notifications.did.js';
import { idlFactory as smsIdl } from '../build/sneed_sms.did.js';

const senderIdl = ({ IDL }) => IDL.Service({ forward: IDL.Func([IDL.Principal, IDL.Text, IDL.Vec(IDL.Nat8)], [IDL.Vec(IDL.Nat8)], []) });
const relay = user('discord-relay');
const anon = Principal.anonymous();

let pic, notifId, smsId, icpId, senderId, otherSenderId;
let n, as, sms, icp, sender;
let appId, discordCh;

// call a sneed_notifications method as the app's canister (through the forwarding mock)
const svc = notifIdl({ IDL });
const method = (name) => svc._fields.find(([k]) => k === name)[1];
async function asApp(name, ...args) {
  const f = method(name);
  const out = await sender.forward(notifId, name, IDL.encode(f.argTypes, args));
  return IDL.decode(f.retTypes, out)[0];
}
const notify = (over = {}) => asApp('notify', { user: bob, topic: 'low_cycles', title: 'Cycles low', body: 'Your canister has 0.5 T cycles left', link: [], dedupe: [], sponsored: false, ...over });
const settle = async () => { for (let i = 0; i < 3; i++) { await pic.advanceTime(31_000); await pic.tick(4); } };

describe('sneed_notifications', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    notifId = await install(pic, { name: 'sneed_notifications' });
    smsId = await install(pic, { name: 'sneed_sms' });
    icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 10_000n, symbol: 'ICP', decimals: 8 }] });
    senderId = await install(pic, { name: 'MockNotifySender', controllers: [alice], sender: alice });
    otherSenderId = await install(pic, { name: 'MockNotifySender', controllers: [carol], sender: carol });
    n = actorAs(pic, notifIdl, notifId, admin);
    as = (p) => actorAs(pic, notifIdl, notifId, p);
    sms = actorAs(pic, smsIdl, smsId, admin);
    icp = actorAs(pic, ledgerIdl, icpId, admin);
    sender = actorAs(pic, senderIdl, senderId, alice);
    unwrap(await sms.add_authorized_sender(notifId));
    const c = await n.get_config();
    unwrap(await n.admin_set_config({ ...c, sneed_sms: smsId, icp_ledger: icpId, relays: [[relay, { discord: null }]] }));
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('registers an app for canisters its owner controls', async () => {
    const input = { name: 'Unicycle Test', logo: [], description: 'cycles alerts', canisters: [senderId], topics: [
      { id: 'low_cycles', title: 'Cycles running low', description: '', level: { urgent: null } },
      { id: 'news', title: 'News', description: '', level: { info: null } },
    ] };
    expect(errOf(await as(bob).register_app(input))).toMatch(/not a controller/);
    appId = unwrap(await as(alice).register_app(input));
    expect(errOf(await as(carol).register_app({ ...input, canisters: [senderId] }))).toMatch(/already belongs/);
    expect(errOf(await as(alice).register_app({ ...input, canisters: [otherSenderId] }))).toMatch(/not a controller/);
    expect((await n.get_app_of(senderId))[0].name).toBe('Unicycle Test');
    expect(errOf(await as(alice).register_app({ ...input, topics: [input.topics[0], input.topics[0]] }))).toMatch(/twice/);
  });

  it('reaches only users who allowed the app, after a request', async () => {
    expect(await notify()).toEqual({ err: { not_allowed: null } });
    expect(await refusedAtIngress(as(alice).notify({ user: bob, topic: 'low_cycles', title: 'x', body: '', link: [], dedupe: [], sponsored: false }))).toBe(true);
    expect(await asApp('request_permission', bob)).toEqual({ ok: 'Asked' });
    expect((await as(bob).get_my_requests()).map((a) => a.name)).toEqual(['Unicycle Test']);
    unwrap(await as(bob).allow_app(appId, true));
    expect(await as(bob).get_my_requests()).toEqual([]);
    const [[, p]] = await as(bob).get_my_apps();
    expect(p.daily_cap).toBe(20n); // the default
    unwrap(await as(bob).set_permission(appId, { ...p, daily_cap: 1_000n }));
    expect(await notify({ topic: 'nope' })).toEqual({ err: { unknown_topic: null } });
  });

  it('delivers to Sneed SMS, the default copy channel, from the canister itself', async () => {
    const r = await notify();
    expect(r.ok.deliveries).toBe(1n);
    await settle();
    const inbox = await actorAs(pic, smsIdl, smsId, bob).get_received_messages();
    const m = inbox.find((x) => x.subject === '[Unicycle Test] Cycles low');
    expect(m).toBeTruthy();
    expect(m.body).toMatch(/0\.5 T cycles left[\s\S]*via Sneed Notifications/);
    expect((await asApp('get_receipts', [r.ok.id]))[0][0].state).toEqual({ delivered: null });
    // receipts are the app's own: another canister (or user) sees nothing
    expect((await as(carol).get_receipts([r.ok.id]))[0]).toEqual([]);
    const h = await as(bob).get_my_history(10n);
    expect(h[0].app_name).toBe('Unicycle Test');
    expect('delivered' in h[0].deliveries[0].state).toBe(true);
  });

  it('folds repeats with the same dedupe key and keeps to the daily cap', async () => {
    const a = await notify({ dedupe: ['canister-x'] });
    const b = await notify({ dedupe: ['canister-x'] });
    expect(a.ok.deduplicated).toBe(false);
    expect(b.ok.deduplicated).toBe(true);
    const [app] = (await as(bob).get_my_apps()).map(([, p]) => p);
    unwrap(await as(bob).set_permission(appId, { ...app, daily_cap: 2n }));
    expect(await notify()).toEqual({ err: { rate_limited: null } }); // 2 already today (the folded one doesn't count)
    unwrap(await as(bob).set_permission(appId, { ...app, daily_cap: 1_000n }));
  });

  it('verifies a relay channel with a code the relay delivers', async () => {
    discordCh = unwrap(await as(bob).add_channel({ discord: null }, 'my Discord', new TextEncoder().encode('enc:discord-id')));
    expect(await refusedAtIngress(as(alice).relay_pull(10n))).toBe(true);
    const [job] = await as(relay).relay_pull(10n);
    expect(new TextDecoder().decode(job.address)).toBe('enc:discord-id');
    const code = job.title.match(/(\d{6})/)[1];
    await as(relay).relay_ack([[job.id, { ok: null }]]);
    expect(errOf(await as(bob).verify_channel(discordCh, '000000' === code ? '111111' : '000000'))).toMatch(/Wrong code/);
    expect(errOf(await as(carol).verify_channel(discordCh, code))).toMatch(/Not your channel/);
    unwrap(await as(bob).verify_channel(discordCh, code));
    const mine = await as(bob).get_my_settings();
    expect(mine.channels.find((c) => c.id === discordCh).state).toEqual({ verified: null });
  });

  it('charges paid channels to the user, and skips them without balance', async () => {
    const mine = await as(bob).get_my_settings();
    unwrap(await as(bob).set_settings({ ...mine.settings, defaults: { urgent: [discordCh], normal: [], info: [] } }));
    const r1 = await notify({ dedupe: ['a'] });
    expect(r1.ok.deliveries).toBe(1n); // Sneed SMS only: no balance for Discord
    const h = await as(bob).get_my_history(1n);
    expect(h[0].deliveries.some((d) => 'suppressed' in d.state && d.state.suppressed.reason === 'not enough balance')).toBe(true);
    // top up 0.01 ICP by ICRC-2 approval
    await icp.mint(account(bob), 1_000_000n);
    unwrap(await actorAs(pic, ledgerIdl, icpId, bob).icrc2_approve({ from_subaccount: [], spender: account(notifId), amount: 1_000_000n, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
    expect(unwrap(await as(bob).top_up(900_000n))).toBe(900_000n);
    const r2 = await notify({ dedupe: ['b'] });
    expect(r2.ok.deliveries).toBe(2n);
    expect((await as(bob).get_my_settings()).balance_e8s).toBe(900_000n - 100n);
    const jobs = await as(relay).relay_pull(10n);
    expect(jobs.length).toBe(1);
    expect(jobs[0].title).toBe('Cycles low');
    expect(jobs[0].app).toBe('Unicycle Test');
    await as(relay).relay_ack([[jobs[0].id, { ok: null }]]);
    // info level goes nowhere but the copy channel
    const r3 = await notify({ topic: 'news', title: 'News', dedupe: ['c'] });
    expect(r3.ok.deliveries).toBe(1n);
  });

  it('refunds a delivery the relay gives up on', async () => {
    const before = (await as(bob).get_my_settings()).balance_e8s;
    await notify({ dedupe: ['d'] });
    expect((await as(bob).get_my_settings()).balance_e8s).toBe(before - 100n);
    const c = await n.get_config();
    unwrap(await n.admin_set_config({ ...c, max_attempts: 1n }));
    const [job] = await as(relay).relay_pull(10n);
    await as(relay).relay_ack([[job.id, { err: 'Discord said no' }]]);
    expect((await as(bob).get_my_settings()).balance_e8s).toBe(before);
    unwrap(await n.admin_set_config({ ...c, max_attempts: 5n }));
  });

  it('lets an app sponsor a message from its own balance', async () => {
    expect(await notify({ sponsored: true, dedupe: ['e'] })).toEqual({ err: { no_funds: null } });
    await icp.mint(account(alice), 1_000_000n);
    unwrap(await actorAs(pic, ledgerIdl, icpId, alice).icrc2_approve({ from_subaccount: [], spender: account(notifId), amount: 1_000_000n, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
    unwrap(await as(alice).top_up_app(appId, 500_000n));
    const userBefore = (await as(bob).get_my_settings()).balance_e8s;
    const r = await notify({ sponsored: true, dedupe: ['f'] });
    expect(r.ok.deliveries).toBe(2n);
    expect(await n.get_app_balance(appId)).toBe(500_000n - 100n);
    expect((await as(bob).get_my_settings()).balance_e8s).toBe(userBefore);
    const jobs = await as(relay).relay_pull(10n);
    await as(relay).relay_ack(jobs.map((j) => [j.id, { ok: null }]));
  });

  it('holds relay messages during quiet hours, unless urgent may pass', async () => {
    const mine = await as(bob).get_my_settings();
    const now = new Date(await pic.getTime());
    const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
    const quiet = { start_min: BigInt((minute + 1440 - 30) % 1440), end_min: BigInt((minute + 60) % 1440), utc_offset_min: 0n, urgent_passes: false };
    unwrap(await as(bob).set_settings({ ...mine.settings, quiet: [quiet] }));
    await notify({ dedupe: ['g'] });
    expect(await as(relay).relay_pull(10n)).toEqual([]); // waits for the morning
    unwrap(await as(bob).set_settings({ ...mine.settings, quiet: [{ ...quiet, urgent_passes: true }] }));
    await notify({ dedupe: ['h'] });
    const jobs = await as(relay).relay_pull(10n);
    expect(jobs.length).toBe(1);
    await as(relay).relay_ack(jobs.map((j) => [j.id, { ok: null }]));
    unwrap(await as(bob).set_settings({ ...mine.settings, quiet: [] }));
  });

  it('obeys mute, demote and copy-only per app and topic', async () => {
    const [[, p]] = await as(bob).get_my_apps();
    unwrap(await as(bob).set_permission(appId, { ...p, topics: [['low_cycles', { mute: null }]] }));
    expect((await notify({ dedupe: ['i'] })).ok.deliveries).toBe(0n);
    unwrap(await as(bob).set_permission(appId, { ...p, demote: true }));
    expect((await notify({ dedupe: ['j'] })).ok.deliveries).toBe(1n); // urgent -> normal: no Discord
    unwrap(await as(bob).set_permission(appId, { ...p, copy_only: true }));
    expect((await notify({ dedupe: ['k'] })).ok.deliveries).toBe(1n);
    unwrap(await as(bob).set_permission(appId, { ...p, topics: [['news', { channels: [discordCh] }]] }));
    expect((await notify({ topic: 'news', title: 'News', dedupe: ['l'] })).ok.deliveries).toBe(2n);
    expect(errOf(await as(bob).set_permission(appId, { ...p, topics: [['news', { channels: [999n] }]] }))).toMatch(/Unknown channel/);
    unwrap(await as(bob).set_permission(appId, p));
    const jobs = await as(relay).relay_pull(10n);
    await as(relay).relay_ack(jobs.map((j) => [j.id, { ok: null }]));
    // blocking the app stops everything
    unwrap(await as(bob).allow_app(appId, false));
    expect(await notify({ dedupe: ['m'] })).toEqual({ err: { not_allowed: null } });
    unwrap(await as(bob).allow_app(appId, true));
  });

  it('guards ingress: queries as updates, anonymous and oversized calls', async () => {
    const upd = (p) => actorAs(pic, asUpdates(notifIdl), notifId, p);
    expect(await refusedAtIngress(upd(bob).get_my_settings())).toBe(true);
    expect(await refusedAtIngress(upd(bob).stats())).toBe(true);
    expect(await refusedAtIngress(as(anon).allow_app(appId, true))).toBe(true);
    expect(await refusedAtIngress(as(bob).admin_remove_app(appId))).toBe(true);
    expect(await refusedAtIngress(as(bob).add_channel({ email: null }, 'x', new Uint8Array(20_000)))).toBe(true);
  });

  it('keeps everything over an upgrade', async () => {
    const before = await n.stats();
    await pic.upgradeCanister({ sender: admin, canisterId: notifId, wasm: wasm('sneed_notifications'), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    expect(await n.stats()).toEqual(before);
    expect((await as(bob).get_my_settings()).channels.length).toBe(2);
    const r = await notify({ dedupe: ['after-upgrade'] });
    expect(r.ok.deliveries > 0n).toBe(true);
    await settle(); // the timer runs again after the upgrade
    const h = await as(bob).get_my_history(1n);
    expect(h[0].deliveries.some((d) => 'delivered' in d.state)).toBe(true);
  });
});
