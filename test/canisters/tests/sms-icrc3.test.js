// Sneed SMS's ICRC-3 activity log (spec/sms_icrc3.md): admin and configuration acts only. An
// empty log with the documented catalogue; one block per admin added or removed (also by
// import_admins), per authorised system sender added or removed, per setting that changed (plain
// and premium limits, premium canister, system sender, notifications canister, the log's own
// settings) and per message import (a count, never the messages); nothing for messages sent,
// read, left or imported one by one, for system notifications, per-user settings and refused or
// no-op calls, and no subject, text, sender or recipient of a message in any block. The hash chain
// and certified tip verify (lib/icrc3.js); spills into archives co-controlled by SNS root; the
// ingress guard; an upgrade keeps the log; and an upgrade from the production build (src/sneed_sms
// at e832eeac, module hash de51e8a5…, build/sneed_sms_prod.wasm) with wasm_memory_persistence =
// keep keeps every message and setting and starts an empty log.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, admin, alice, bob, carol, user, SNEED_SNS_ROOT, SNEED_GOVERNANCE, T, unwrap, errOf, wasm, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { ser } from '../lib/hub.js';
import { archiveIdl, btype, tx, verifyLog, icrc3Service } from '../lib/icrc3.js';
import { idlFactory as smsIdl } from '../build/sneed_sms.did.js';

const SMS_WASM = process.env.SMS_WASM || 'sneed_sms';
const BLOCK_TYPES_URL = 'https://app.sneeddao.com/api/sneed_sms#block-types';
const CATALOGUE = ['admin_add', 'admin_remove', 'authorized_sender_add', 'authorized_sender_remove', 'config_update', 'messages_import'].map((t) => `sneedsms_${t}`);
const KEEP = { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] };
const dave = user('dave');
const notif = user('sms-icrc3-notifications');
const premiumCanister = user('sms-icrc3-premium');
const sysSender = user('sms-icrc3-system');

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

// the canister's interface plus the log's (so the test runs against a build without it, and fails there)
const LogEntry = IDL.Record({ id: IDL.Nat, ts: IDL.Int, level: IDL.Variant({ info: IDL.Null, error: IDL.Null }), cid: IDL.Nat, caller: IDL.Principal, message: IDL.Text });
const fullIdl = ({ IDL: I }) => I.Service({
  ...Object.fromEntries(smsIdl({ IDL: I })._fields),
  ...icrc3Service(I),
  get_log: I.Func([I.Nat, I.Nat], [I.Vec(LogEntry)], ['query']),
});

let pic, rootKey, appSubnet, smsId;
const as = (p, id = smsId) => actorAs(pic, fullIdl, id, p);
const archiveActor = (id) => actorAs(pic, archiveIdl, id, admin);
const advance = async (seconds, ticks = 2) => { await pic.advanceTime(seconds * 1000); await pic.tick(ticks); };
const msg = (recipients, subject, body, reply_to = []) => ({ recipients, subject, body, reply_to: reply_to.length ? [reply_to] : [] });

const rawLog = async (id = smsId) => (await verifyLog(as(admin, id), id, rootKey, archiveActor)).blocks;
const verifiedLog = async (id = smsId) => (await rawLog(id)).map((b, i) => ({ i, t: btype(b).replace(/^sneedsms_/, ''), ...plain(tx(b)) }));
const logLength = async (id = smsId) => Number((await as(admin, id).icrc3_log_status()).log_length);
const since = async (mark, id = smsId) => (await verifiedLog(id)).slice(mark).map(({ i, ...b }) => b);
const cfg = (key, old_value, value, caller = admin) => ({ t: 'config_update', caller: P(caller), key, old_value, value });

beforeAll(async () => {
  ({ pic, rootKey, appSubnet } = await createPic());
  smsId = await install(pic, { name: SMS_WASM, cycles: 20n * T, targetSubnetId: appSubnet });
}, 120_000);
afterAll(async () => { await pic?.tearDown(); });

describe('fresh install', () => {
  it('has an empty log, the documented catalogue and ICRC-3 among its standards', async () => {
    expect(await as(alice).icrc3_log_status()).toMatchObject({ log_length: 0n, live_blocks: 0n, archives: [], history_imported: false, last_block_hash: [] });
    expect(await as(alice).icrc3_get_tip_certificate()).toEqual([]);
    expect(await as(alice).icrc3_supported_block_types()).toEqual(CATALOGUE.map((block_type) => ({ block_type, url: BLOCK_TYPES_URL })));
    expect((await as(alice).icrc10_supported_standards()).map((s) => s.name)).toEqual(['ICRC-3', 'ICRC-10']);
    expect(await as(alice).icrc3_get_blocks([{ start: 0n, length: 10n }])).toEqual({ log_length: 0n, blocks: [], archived_blocks: [] });
    expect(await as(alice).icrc3_get_archives({ from: [] })).toEqual([]);
  });
});

describe('admin and configuration acts', () => {
  it('admins: additions and removals by whoever made them; refused and repeated calls append nothing', async () => {
    const mark = await logLength();
    unwrap(await as(admin).add_admin(alice));
    unwrap(await as(alice).add_admin(bob)); // a listed admin appoints another
    expect(errOf(await as(carol).add_admin(carol))).toHaveProperty('Unauthorized');
    expect(errOf(await as(admin).add_admin(alice))).toHaveProperty('AlreadyExists');
    expect(errOf(await as(admin).remove_admin(carol))).toHaveProperty('NotFound');
    unwrap(await as(SNEED_GOVERNANCE).remove_admin(bob)); // governance is an admin
    expect(await since(mark)).toEqual([
      { t: 'admin_add', caller: P(admin), principal: P(alice) },
      { t: 'admin_add', caller: P(alice), principal: P(bob) },
      { t: 'admin_remove', caller: P(SNEED_GOVERNANCE), principal: P(bob) },
    ]);
  });

  it('authorised system senders, the system sender and the notifications canister', async () => {
    const mark = await logLength();
    unwrap(await as(admin).add_authorized_sender(notif));
    unwrap(await as(alice).add_authorized_sender(admin));
    expect(errOf(await as(admin).add_authorized_sender(notif))).toHaveProperty('AlreadyExists');
    expect(errOf(await as(bob).add_authorized_sender(bob))).toHaveProperty('Unauthorized');
    unwrap(await as(admin).remove_authorized_sender(admin));
    expect(errOf(await as(admin).remove_authorized_sender(admin))).toHaveProperty('NotFound');
    unwrap(await as(admin).set_system_sender_principal([sysSender]));
    unwrap(await as(admin).set_system_sender_principal([sysSender])); // unchanged: nothing
    unwrap(await as(admin).admin_set_notifications([notif]));
    unwrap(await as(admin).admin_set_notifications([notif]));
    expect(errOf(await as(bob).admin_set_notifications([]))).toHaveProperty('Unauthorized');
    expect(errOf(await as(bob).set_system_sender_principal([]))).toHaveProperty('Unauthorized');
    expect(await since(mark)).toEqual([
      { t: 'authorized_sender_add', caller: P(admin), principal: P(notif) },
      { t: 'authorized_sender_add', caller: P(alice), principal: P(admin) },
      { t: 'authorized_sender_remove', caller: P(admin), principal: P(admin) },
      cfg('system_sender_principal', 'none', P(sysSender)),
      cfg('notifications_canister', 'none', P(notif)),
    ]);
  });

  it('limits and premium settings: one block per setting that changed, with the old value', async () => {
    const mark = await logLength();
    unwrap(await as(admin).update_config([0n], [200n], [6000n], [])); // subject length unchanged
    unwrap(await as(admin).update_config([], [], [], [])); // nothing
    expect(errOf(await as(bob).update_config([5n], [], [], []))).toHaveProperty('Unauthorized');
    unwrap(await as(alice).update_premium_config([[premiumCanister]], [500n], [25000n], [], [60n]));
    unwrap(await as(admin).update_premium_config([[]], [], [], [], [])); // clear the canister
    expect(errOf(await as(bob).update_premium_config([], [1n], [], [], []))).toHaveProperty('Unauthorized');
    expect(await since(mark)).toEqual([
      cfg('rate_limit_minutes', 10n, 0n),
      cfg('max_body_length', 5000n, 6000n),
      cfg('sneed_premium_canister_id', 'none', P(premiumCanister), alice),
      cfg('premium_max_body_length', 20000n, 25000n, alice),
      cfg('premium_max_recipients', 50n, 60n, alice),
      cfg('sneed_premium_canister_id', P(premiumCanister), 'none'),
    ]);
  });

  it('imports by controllers: each admin added, and only a count of messages', async () => {
    const mark = await logLength();
    const at = 1_700_000_000_000_000_000n;
    expect(await refusedAtIngress(as(alice).import_admins([{ principal: carol, added_by: 0, added_at: at }]))).toBe(true); // controllers only
    expect(unwrap(await as(admin).import_admins([{ principal: carol, added_by: 0, added_at: at }, { principal: alice, added_by: 0, added_at: at }]))).toBe(1n);
    const imported = { id: 500n, sender: dave, recipients: [carol], subject: 'imported subject', body: 'imported text', reply_to: [], created_at: at, updated_at: at, can_remove_self: true };
    expect(unwrap(await as(admin).import_messages([imported, { ...imported, id: 501n }]))).toBe(2n);
    expect(unwrap(await as(admin).import_messages([imported]))).toBe(0n); // already there: nothing
    expect(await since(mark)).toEqual([
      { t: 'admin_add', caller: P(admin), principal: P(carol), source: 'import_admins' },
      { t: 'messages_import', caller: P(admin), count: 2n, next_id: 502n },
    ]);
    unwrap(await as(admin).remove_admin(carol));
  });
});

describe('what is never logged', () => {
  it('messages, system notifications, leaving, read marks and per-user settings append nothing, and no block names a message\'s content or parties', async () => {
    unwrap(await as(admin).add_authorized_sender(admin));
    const mark = await logLength();
    const m1 = unwrap(await as(bob).send_message(msg([carol, dave], 'secret subject', 'secret body text')));
    unwrap(await as(carol).send_message(msg([bob], 'Re: secret subject', 'secret reply', [m1])));
    unwrap(await as(admin).send_system_notification({ recipients: [dave], subject: 'system subject', body: 'system body' }));
    unwrap(await as(dave).remove_self_from_message(m1));
    await as(carol).mark_messages_seen_up_to(1n);
    unwrap(await as(carol).set_notification_preview(false));
    unwrap(await as(carol).set_notification_preview(true));
    expect(await logLength()).toBe(mark + 0);
    // nothing anywhere in the log holds a subject, a text, or a private message's sender or recipient
    const all = ser(await verifiedLog());
    for (const s of ['secret', 'imported', 'system subject', 'system body', P(dave)]) expect(all).not.toContain(s);
    unwrap(await as(admin).remove_authorized_sender(admin));
  });
});

describe('ingress', () => {
  it('refuses the log queries as update calls and the log\'s admin methods from non-admins at ingress', async () => {
    const u = actorAs(pic, asUpdates(fullIdl), smsId, bob);
    expect((await as(bob).icrc3_log_status()).log_length).toEqual(expect.any(BigInt)); // answered as a query
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
    // the existing behaviour stays: other admin methods answer non-admins with Unauthorized
    expect(errOf(await as(bob).add_admin(bob))).toHaveProperty('Unauthorized');
  });
});

describe('archives', () => {
  it('spill past the live limit into archives co-controlled by SNS root, and still verify', async () => {
    const before = await logLength();
    unwrap(await as(admin).admin_set_icrc3_settings({ max_live_blocks: [5n], spill_batch_size: [4n], archive_max_blocks: [10n], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }));
    await advance(15 * 60 + 5, 100); // the 15-minute spill check
    const s = await as(admin).icrc3_log_status();
    expect(Number(s.log_length)).toBe(before + 3); // three settings changed
    expect(s.live_blocks).toBeLessThan(5n);
    expect(s.archives.length).toBeGreaterThanOrEqual(2);
    const archives = await as(bob).icrc3_get_archives({ from: [] });
    expect(archives.map((a) => a.canister_id.toText())).toEqual(s.archives.map((a) => a.canister_id.toText()));
    for (const a of archives) {
      expect((await pic.getControllers(a.canister_id)).map((p) => p.toText()).sort()).toEqual([smsId.toText(), SNEED_SNS_ROOT.toText()].sort());
      expect((await archiveActor(a.canister_id).archive_status()).parent.toText()).toBe(smsId.toText());
    }
    const blocks = await verifiedLog(); // follows the callbacks into every archive
    expect(blocks).toHaveLength(Number(s.log_length));
    expect(blocks.slice(-3).map((b) => [b.t, b.key, b.caller])).toEqual([
      ['config_update', 'icrc3_max_live_blocks', P(admin)], ['config_update', 'icrc3_spill_batch_size', P(admin)], ['config_update', 'icrc3_archive_max_blocks', P(admin)],
    ]);
    expect((await as(admin).get_log(0n, 100n)).some((e) => /created archive/.test(e.message))).toBe(true);
    unwrap(await as(admin).admin_icrc3_spill_now());
    expect((await as(admin).icrc3_log_status()).live_blocks).toBe(0n);
    expect(await verifiedLog()).toHaveLength(Number(s.log_length));
    expect((await as(admin).admin_icrc3_repair_archive_controllers()).every(([, x]) => 'Ok' in x)).toBe(true);
    unwrap(await as(admin).admin_set_icrc3_settings({ max_live_blocks: [2000n], spill_batch_size: [500n], archive_max_blocks: [1_000_000n], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }));
  }, 120_000);
});

describe('upgrades', () => {
  it('keep the log, the archives and the certified tip (wasm_memory_persistence = keep)', async () => {
    const before = await as(admin).icrc3_log_status();
    const blocksBefore = await verifiedLog();
    await advance(600);
    await pic.upgradeCanister({ sender: admin, canisterId: smsId, wasm: wasm(SMS_WASM), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    await pic.tick(2);
    expect(await as(admin).icrc3_log_status()).toEqual(before);
    expect(await verifiedLog()).toEqual(blocksBefore); // the tip certificate is republished
    unwrap(await as(admin).add_admin(carol));
    const blocks = await verifiedLog();
    expect(blocks).toHaveLength(blocksBefore.length + 1);
    expect(blocks.at(-1)).toMatchObject({ t: 'admin_add', principal: P(carol) });
  }, 120_000);

  it('from the production build with keep: every message and setting stays, and the log starts empty', async () => {
    const oldId = await install(pic, { name: 'sneed_sms_prod', cycles: 20n * T, targetSubnetId: appSubnet });
    const o = (p) => as(p, oldId);
    await expect(o(alice).icrc3_log_status()).rejects.toThrow(); // the production code has no log
    unwrap(await o(admin).update_config([0n], [150n], [4000n], [10n]));
    unwrap(await o(admin).update_premium_config([[premiumCanister]], [400n], [15000n], [2n], [30n]));
    unwrap(await o(admin).add_admin(alice));
    unwrap(await o(admin).add_authorized_sender(notif));
    unwrap(await o(admin).add_authorized_sender(admin));
    unwrap(await o(admin).set_system_sender_principal([sysSender]));
    unwrap(await o(admin).admin_set_notifications([notif]));
    const m1 = unwrap(await o(bob).send_message(msg([carol, dave], 'kept', 'kept text')));
    const m2 = unwrap(await o(carol).send_message(msg([bob], 'Re: kept', 'reply', [m1])));
    unwrap(await o(bob).send_message(msg([dave], 'left', 'bob leaves this one')));
    unwrap(await o(admin).send_system_notification({ recipients: [dave], subject: 'system', body: 'from a canister' }));
    unwrap(await o(dave).remove_self_from_message(m1));
    unwrap(await o(bob).remove_self_from_message(m2 + 1n)); // the sender leaves: shown as removed
    await o(carol).mark_messages_seen_up_to(123n);
    unwrap(await o(dave).set_notification_preview(false));
    const people = [admin, alice, bob, carol, dave];
    const snapshot = async () => ser({
      config: await o(admin).get_config(), premium: await o(admin).get_premium_config(), admins: await o(admin).get_admins(),
      senders: await o(admin).get_authorized_senders(), system: await o(admin).get_system_sender_principal(),
      notifications: await o(admin).get_notifications_canister(), stats: await o(admin).get_stats(),
      all: await o(admin).get_all_messages_admin(),
      boxes: await Promise.all(people.map(async (p) => [await o(p).get_all_messages(), await o(p).get_sent_messages(), await o(p).get_received_messages()])),
      previews: await Promise.all(people.map((p) => o(p).get_notification_preview())),
      seen: await Promise.all(people.map((p) => o(admin).get_last_seen_messages_timestamp(p))),
      unread: await Promise.all(people.map((p) => o(admin).get_recent_messages_count(p))),
      isAdmin: await Promise.all(people.map((p) => o(admin).is_admin_query(p))),
    });
    const before = await snapshot();
    expect(JSON.parse(before).all).toHaveLength(4);

    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(SMS_WASM), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    await pic.tick(2);
    expect(await snapshot()).toBe(before);
    expect(await o(alice).icrc3_log_status()).toMatchObject({ log_length: 0n, live_blocks: 0n, archives: [], last_block_hash: [], history_imported: false });
    expect(await o(alice).icrc3_get_tip_certificate()).toEqual([]);
    // sending goes on with the next id, and logs nothing
    expect(unwrap(await o(carol).send_message(msg([bob], 'after', 'the upgrade')))).toBe(m2 + 3n);
    expect(await logLength(oldId)).toBe(0);

    // the first logged act after the upgrade is block 0, without phash; the log verifies
    unwrap(await o(alice).remove_authorized_sender(admin));
    expect((await verifiedLog(oldId)).map(({ i, ...b }) => b)).toEqual([{ t: 'authorized_sender_remove', caller: P(alice), principal: P(admin) }]);
    expect((await rawLog(oldId))[0].Map.some(([k]) => k === 'phash')).toBe(false);
  }, 180_000);
});
