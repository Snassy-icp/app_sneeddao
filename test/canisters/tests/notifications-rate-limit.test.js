// sneed_notifications rate limits (src/RateLimit.mo, spec/paging_audit.md): per-caller token
// buckets on the calls anyone can make: registering and changing apps (each registration checks
// control of the canisters with calls to the management canister), permission requests and
// notifications from unverified app canisters, user settings, and top-ups (ledger calls).
// Inspect refuses an ingress call whose bucket is empty; the method itself consumes the token, so
// calls from canisters (which skip inspect) are limited too. Admins and the canisters of verified
// apps (Sneed SMS, the forum, Sneed Monitor ...) are never limited. Rules are admin-set
// (get_rate_limits / admin_set_rate_limit) with generous defaults, kept over upgrades.
// The upgrade test installs the build production runs (build/sneed_notifications_prepaging.wasm:
// src at 1788bfee, module hash 7c32ae81…) and upgrades it with keep.
// NOTIF_WASM=sneed_notifications_prepaging npx vitest run tests/notifications-rate-limit.test.js
// runs it against the production code, where nothing is limited (it fails).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, admin, alice, bob, carol, user, unwrap, errOf, wasm, refusedAtIngress } from '../lib/pic.js';
import { idlFactory as notifIdl } from '../build/sneed_notifications.did.js';

const NOTIF_WASM = process.env.NOTIF_WASM || 'sneed_notifications';
const senderIdl = ({ IDL }) => IDL.Service({ forward: IDL.Func([IDL.Principal, IDL.Text, IDL.Vec(IDL.Nat8)], [IDL.Vec(IDL.Nat8)], []) });
const svc = notifIdl({ IDL });
const method = (name) => svc._fields.find(([k]) => k === name)[1];
const topics = [{ id: 'news', title: 'News', description: '', level: { info: null } }];
const appInput = (canisters, name = 'App') => ({ name, logo: [], description: '', canisters, topics });
const MINUTE = 60_000;

let pic, notifId, n, as;
let spamSenderId, spamSender, goodSenderId, goodSender, strangerSenderId, strangerSender;
let spamApp, goodApp, foreignId;

// a sneed_notifications call made by an app canister (through the forwarding mock)
async function viaCanister(sender, name, ...args) {
  const f = method(name);
  const out = await sender.forward(notifId, name, IDL.encode(f.argTypes, args));
  return IDL.decode(f.retTypes, out)[0];
}
const note = (u, over = {}) => ({ user: u, topic: 'news', title: 'Hello', body: '', link: [], dedupe: [], sponsored: false, ...over });

describe('sneed_notifications: rate limits', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    notifId = await install(pic, { name: NOTIF_WASM });
    n = actorAs(pic, notifIdl, notifId, admin);
    as = (p) => actorAs(pic, notifIdl, notifId, p);
    spamSenderId = await install(pic, { name: 'MockNotifySender', controllers: [alice], sender: alice });
    goodSenderId = await install(pic, { name: 'MockNotifySender', controllers: [carol], sender: carol });
    strangerSenderId = await install(pic, { name: 'MockNotifySender', controllers: [bob], sender: bob });
    foreignId = await install(pic, { name: 'MockNotifySender', controllers: [carol], sender: carol }); // no app yet
    spamSender = actorAs(pic, senderIdl, spamSenderId, alice);
    goodSender = actorAs(pic, senderIdl, goodSenderId, carol);
    strangerSender = actorAs(pic, senderIdl, strangerSenderId, bob);
    spamApp = unwrap(await as(alice).register_app(appInput([spamSenderId], 'Spam')));
    goodApp = unwrap(await n.admin_register_app(carol, appInput([goodSenderId], 'Sneed Forum'))); // verified
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('lists generous default rules, and only admins change them', async () => {
    const rules = Object.fromEntries(await as(bob).get_rate_limits());
    expect(Object.keys(rules).sort()).toEqual(['notify', 'notify_batch', 'register_app', 'request_permission', 'settings', 'top_up', 'update_app']);
    expect(rules.notify).toEqual({ capacity: 1000n, per_minute: 600n });
    expect(rules.register_app).toEqual({ capacity: 5n, per_minute: 1n });
    expect(await refusedAtIngress(as(bob).admin_set_rate_limit('notify', [{ capacity: 1n, per_minute: 1n }]))).toBe(true);
    expect(errOf(await viaCanister(strangerSender, 'admin_set_rate_limit', 'notify', [{ capacity: 1n, per_minute: 1n }]))).toMatch(/Admins only/);
    expect(errOf(await n.admin_set_rate_limit('nope', [{ capacity: 1n, per_minute: 1n }]))).toMatch(/Unknown action/);
    expect(errOf(await n.admin_set_rate_limit('notify', [{ capacity: 5n, per_minute: 0n }]))).toMatch(/per_minute/);
  });

  it('refuses a caller who keeps trying to register apps for canisters it does not control', async () => {
    // each try asks the management canister: 5 at once, then one a minute
    for (let i = 0; i < 5; i++) expect(errOf(await as(bob).register_app(appInput([foreignId], `Grab ${i}`)))).toMatch(/not a controller/);
    expect(await refusedAtIngress(as(bob).register_app(appInput([foreignId], 'Grab 5')))).toBe(true);
    // a canister caller skips inspect: the method refuses it
    for (let i = 0; i < 5; i++) expect(errOf(await viaCanister(strangerSender, 'register_app', appInput([foreignId], `C ${i}`)))).toMatch(/not a controller/);
    expect(errOf(await viaCanister(strangerSender, 'register_app', appInput([foreignId], 'C 5')))).toMatch(/Rate limited/);
    // others are not affected, and the bucket refills
    expect(unwrap(await as(carol).register_app(appInput([carol], 'Carol app')))).toBeGreaterThan(0n);
    await pic.advanceTime(MINUTE);
    await pic.tick();
    expect(errOf(await as(bob).register_app(appInput([foreignId], 'Grab 6')))).toMatch(/not a controller/);
  });

  it('limits permission requests and notifications from an unverified app, not from a verified one', async () => {
    unwrap(await n.admin_set_rate_limit('request_permission', [{ capacity: 3n, per_minute: 1n }]));
    unwrap(await n.admin_set_rate_limit('notify', [{ capacity: 3n, per_minute: 1n }]));
    for (let i = 0; i < 3; i++) expect(await viaCanister(spamSender, 'request_permission', user(`victim-${i}`))).toEqual({ ok: 'Asked' });
    expect(errOf(await viaCanister(spamSender, 'request_permission', user('victim-3')))).toMatch(/Rate limited/);
    expect(await as(user('victim-3')).get_my_requests()).toEqual([]);
    // the verified app (a DAO canister) is never limited
    for (let i = 0; i < 6; i++) expect(await viaCanister(goodSender, 'request_permission', user(`member-${i}`))).toEqual({ ok: 'Asked' });

    unwrap(await as(bob).allow_app(spamApp, true));
    unwrap(await as(bob).allow_app(goodApp, true));
    for (let i = 0; i < 3; i++) expect(Object.keys(await viaCanister(spamSender, 'notify', note(bob, { title: `Spam ${i}` })))).toEqual(['ok']);
    expect(await viaCanister(spamSender, 'notify', note(bob, { title: 'Spam 3' }))).toEqual({ err: { rate_limited: null } });
    for (let i = 0; i < 6; i++) expect(Object.keys(await viaCanister(goodSender, 'notify', note(bob, { title: `Reply ${i}` })))).toEqual(['ok']);
    unwrap(await n.admin_set_rate_limit('request_permission', []));
    unwrap(await n.admin_set_rate_limit('notify', []));
    expect(Object.fromEntries(await n.get_rate_limits()).notify).toEqual({ capacity: 1000n, per_minute: 600n });
  });

  it('a normal sender is not limited at the defaults', async () => {
    // 50 notifications in a burst from an unverified app: far below the default bucket
    await pic.advanceTime(2 * MINUTE); // the app's bucket refills from the test above
    await pic.tick();
    const u = user('busy-user');
    unwrap(await as(u).allow_app(spamApp, true));
    const [[, p]] = await as(u).get_my_apps();
    unwrap(await as(u).set_permission(spamApp, { ...p, daily_cap: 1_000n }));
    for (let i = 0; i < 50; i++) expect(Object.keys(await viaCanister(spamSender, 'notify', note(u, { title: `n ${i}` })))).toEqual(['ok']);
  });

  it('limits a user hammering their settings, not one who changes a few', async () => {
    unwrap(await n.admin_set_rate_limit('settings', [{ capacity: 4n, per_minute: 2n }]));
    const spammer = user('settings-spammer');
    for (let i = 0; i < 4; i++) unwrap(await as(spammer).allow_app(goodApp, i % 2 === 0));
    expect(await refusedAtIngress(as(spammer).allow_app(goodApp, true))).toBe(true);
    expect(await refusedAtIngress(as(spammer).set_low_balance_alert(5n))).toBe(true);
    // a canister caller skips inspect: the method refuses it
    for (let i = 0; i < 4; i++) unwrap(await viaCanister(strangerSender, 'allow_app', goodApp, true));
    expect(errOf(await viaCanister(strangerSender, 'allow_app', goodApp, true))).toMatch(/Rate limited/);
    const normal = user('settings-normal');
    unwrap(await as(normal).allow_app(goodApp, true));
    unwrap(await as(normal).set_low_balance_alert(5n));
    // admins are never limited
    for (let i = 0; i < 6; i++) unwrap(await n.allow_app(goodApp, true));
    await pic.advanceTime(MINUTE);
    await pic.tick();
    unwrap(await as(spammer).allow_app(goodApp, true)); // refilled
    unwrap(await n.admin_set_rate_limit('settings', []));
  });
});

describe('sneed_notifications: upgrade from production', () => {
  it('keeps apps over the upgrade (keep) and keeps rule overrides over later upgrades', async () => {
    const { pic: p2 } = await createPic();
    try {
      const id = await install(p2, { name: 'sneed_notifications_prepaging' });
      const admin2 = actorAs(p2, notifIdl, id, admin);
      const app = unwrap(await admin2.admin_register_app(carol, appInput([carol], 'Kept')));
      unwrap(await actorAs(p2, notifIdl, id, bob).allow_app(app, true));
      const upgrade = () => p2.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(NOTIF_WASM), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
      await upgrade();
      expect((await admin2.get_app(app))[0].name).toBe('Kept');
      expect((await actorAs(p2, notifIdl, id, bob).get_my_apps()).map(([a, perm]) => [a.name, perm.allowed])).toEqual([['Kept', true]]);
      unwrap(await admin2.admin_set_rate_limit('settings', [{ capacity: 7n, per_minute: 3n }]));
      await upgrade();
      expect(Object.fromEntries(await admin2.get_rate_limits()).settings).toEqual({ capacity: 7n, per_minute: 3n });
    } finally {
      await p2.tearDown();
    }
  });
});
