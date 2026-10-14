// sneed_sms: private messages between principals (also used by TACO DAO, so
// this doubles as a contract test of the public API). Sending is rate limited
// per user with admins exempt; a message is readable by its sender and its
// recipients only; anyone may remove themselves from a message; authorised
// canisters send system notifications under a configurable sender; admins are
// the controllers, the Sneed governance canister and a list; imports are for
// controllers only; an upgrade keeps everything.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, wasm, admin, alice, bob, carol, user, SNEED_GOVERNANCE, unwrap, errOf, nowNs } from '../lib/pic.js';
import { premiumIdl } from '../lib/idl.js';
import { idlFactory as smsIdl } from '../build/sneed_sms.did.js';

const dave = user('dave'); const bot = user('bot'); const system = user('system');
const anon = Principal.anonymous();
const MIN = 60; // seconds
/// "Kind: message" of an err result, for one readable assertion.
const err = (r) => { const e = errOf(r); const k = Object.keys(e)[0]; return `${k}: ${e[k]}`; };
const ids = (msgs) => msgs.map((m) => m.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const text = (p) => p.toText();
const msg = (recipients, subject = 'hi', body = 'hello', reply_to = []) => ({ recipients, subject, body, reply_to });
const advance = async (seconds) => { await pic.advanceTime(seconds * 1000); await pic.tick(2); };

let pic, smsId, premiumId;
let s, sAlice, sBob, sCarol, sDave, sAnon, sGov, sBot, premium;

describe('sneed_sms', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    premiumId = await install(pic, { name: 'MockPremium' });
    smsId = await install(pic, { name: 'sneed_sms' });
    premium = actorAs(pic, premiumIdl, premiumId, admin);
    s = actorAs(pic, smsIdl, smsId, admin);
    sAlice = actorAs(pic, smsIdl, smsId, alice); sBob = actorAs(pic, smsIdl, smsId, bob); sCarol = actorAs(pic, smsIdl, smsId, carol);
    sDave = actorAs(pic, smsIdl, smsId, dave); sAnon = actorAs(pic, smsIdl, smsId, anon);
    sGov = actorAs(pic, smsIdl, smsId, SNEED_GOVERNANCE); sBot = actorAs(pic, smsIdl, smsId, bot);
  }, 120_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('starts with the default limits, no admins, and the controller and Sneed governance as implicit admins', async () => {
    expect(await s.get_config()).toEqual({ rate_limit_minutes: 10n, max_subject_length: 200n, max_body_length: 5000n, max_recipients: 20n });
    expect(await s.get_premium_config()).toEqual({ sneed_premium_canister_id: [], premium_max_subject_length: 500n, premium_max_body_length: 20000n, premium_rate_limit_minutes: 1n, premium_max_recipients: 50n });
    expect(await s.get_admins()).toEqual([]);
    expect(await s.is_admin_query(admin)).toBe(true); // controller
    expect(await s.is_admin_query(SNEED_GOVERNANCE)).toBe(true); // hard-coded
    expect(await s.is_admin_query(alice)).toBe(false);
    expect(await s.get_stats()).toEqual({ total_messages: 0n, total_users: 0n });
    expect(await s.get_system_sender_principal()).toEqual([]);
  });

  let m1;
  it('delivers a message to its recipients and shows it in the sender\'s and recipients\' boxes only', async () => {
    m1 = unwrap(await sAlice.send_message(msg([bob, carol], 'first', 'hello both')));
    expect(m1).toBe(1n);
    const seen = (await sAlice.get_message(m1))[0];
    expect(seen.sender.toText()).toBe(text(alice));
    expect(seen.recipients.map(text)).toEqual([text(bob), text(carol)]);
    expect(seen.subject).toBe('first'); expect(seen.body).toBe('hello both'); expect(seen.reply_to).toEqual([]);
    expect(seen.can_remove_self).toBe(true);
    expect(seen.created_at).toBe(seen.updated_at);
    expect((await sBob.get_message(m1))[0].can_remove_self).toBe(true);
    expect(await sDave.get_message(m1)).toEqual([]); // not a participant
    expect(await sDave.get_message(999n)).toEqual([]);
    expect(ids(await sAlice.get_sent_messages())).toEqual([m1]);
    expect(await sAlice.get_received_messages()).toEqual([]);
    expect(ids(await sBob.get_received_messages())).toEqual([m1]);
    expect(await sBob.get_sent_messages()).toEqual([]);
    expect(ids(await sCarol.get_all_messages())).toEqual([m1]);
    expect(await sDave.get_all_messages()).toEqual([]);
    expect(await s.get_stats()).toEqual({ total_messages: 1n, total_users: 3n }); // alice, bob, carol are known principals now
  });

  let m2;
  it('refuses anonymous senders, validates subject, body, recipients and reply targets', async () => {
    expect(err(await sAnon.send_message(msg([bob])))).toMatch(/Unauthorized: Anonymous/);
    expect(err(await sBob.send_message(msg([alice], '')))).toMatch(/InvalidInput: Subject cannot be empty/);
    expect(err(await sBob.send_message(msg([alice], 'x'.repeat(201))))).toMatch(/InvalidInput: Subject exceeds maximum length of 200/);
    expect(err(await sBob.send_message(msg([alice], 'ok', '')))).toMatch(/InvalidInput: Body cannot be empty/);
    expect(err(await sBob.send_message(msg([alice], 'ok', 'x'.repeat(5001))))).toMatch(/InvalidInput: Body exceeds maximum length of 5000/);
    expect(err(await sBob.send_message(msg([])))).toMatch(/InvalidInput: At least one recipient/);
    expect(err(await sBob.send_message(msg(Array.from({ length: 21 }, (_, i) => user(`r${i}`)))))).toMatch(/InvalidInput: Too many recipients. Maximum is 20/);
    expect(err(await sBob.send_message(msg([alice], 'ok', 'ok', [[999n]])))).toMatch(/NotFound: Reply message 999 not found/);
    expect(err(await sDave.send_message(msg([alice], 're', 'me too', [[m1]])))).toMatch(/Unauthorized: Cannot reply to message 1 - access denied/);
    // the refusals above did not count as sends: bob's first real message goes through, as a reply to m1
    m2 = unwrap(await sBob.send_message(msg([alice], 're: first', 'hello back', [[m1]])));
    expect((await sAlice.get_message(m2))[0].reply_to).toEqual([[m1]]);
    expect(ids(await sAlice.get_all_messages())).toEqual([m1, m2]); // sent and received, no duplicates
  });

  it('rate limits each user to one message per window, except admins and the Sneed governance canister', async () => {
    expect(err(await sAlice.send_message(msg([bob])))).toMatch(/RateLimited: Must wait 10 more minutes/);
    await advance(4 * MIN);
    expect(err(await sAlice.send_message(msg([bob])))).toMatch(/RateLimited: Must wait 6 more minutes/);
    await advance(6 * MIN + 1);
    unwrap(await sAlice.send_message(msg([bob], 'later', 'after the window')));
    // the window restarts
    expect(err(await sAlice.send_message(msg([bob])))).toMatch(/RateLimited/);
    unwrap(await s.send_message(msg([alice], 'admin 1', 'x'))); unwrap(await s.send_message(msg([alice], 'admin 2', 'x')));
    unwrap(await sGov.send_message(msg([alice], 'dao 1', 'x'))); unwrap(await sGov.send_message(msg([alice], 'dao 2', 'x')));
    expect(ids(await sAlice.get_received_messages()).length).toBe(5);
  });

  it('lets admins change the limits, which apply to the next message; premium members get the premium limits', async () => {
    expect(err(await sAlice.update_config([0n], [], [], []))).toMatch(/Unauthorized: Only admins/);
    unwrap(await s.update_config([0n], [10n], [20n], [2n]));
    expect(await s.get_config()).toEqual({ rate_limit_minutes: 0n, max_subject_length: 10n, max_body_length: 20n, max_recipients: 2n });
    expect(err(await sAlice.send_message(msg([bob], 'x'.repeat(11))))).toMatch(/Subject exceeds maximum length of 10/);
    expect(err(await sAlice.send_message(msg([bob], 'short', 'x'.repeat(21))))).toMatch(/Body exceeds maximum length of 20/);
    expect(err(await sAlice.send_message(msg([bob, carol, dave], 'short', 'ok')))).toMatch(/Too many recipients. Maximum is 2/);
    unwrap(await sAlice.send_message(msg([bob, carol], 'short', 'ok')));
    unwrap(await sAlice.send_message(msg([bob], 'short', 'ok'))); // rate limit 0: back to back is fine
    unwrap(await s.update_config([], [200n], [5000n], [20n]));
    // premium configuration: members of the premium canister get the premium limits
    expect(err(await sAlice.update_premium_config([[premiumId]], [], [], [], []))).toMatch(/Unauthorized: Only admins/);
    unwrap(await s.update_premium_config([[premiumId]], [600n], [30000n], [0n], [60n]));
    expect(await s.get_premium_config()).toEqual({ sneed_premium_canister_id: [premiumId], premium_max_subject_length: 600n, premium_max_body_length: 30000n, premium_rate_limit_minutes: 0n, premium_max_recipients: 60n });
    await premium.set_member(alice, (await nowNs(pic)) + 30n * 86_400n * 1_000_000_000n);
    unwrap(await s.update_config([10n], [], [], [])); // a plain rate limit again
    unwrap(await sAlice.send_message(msg(Array.from({ length: 21 }, (_, i) => user(`p${i}`)), 'x'.repeat(300), 'x'.repeat(5001))));
    unwrap(await sAlice.send_message(msg([bob], 'member', 'again at once'))); // premium rate limit 0
    expect(err(await sAlice.send_message(msg([bob], 'x'.repeat(601))))).toMatch(/Subject exceeds maximum length of 600/);
    expect(err(await sAlice.send_message(msg([bob], 'ok', 'x'.repeat(30001))))).toMatch(/Body exceeds maximum length of 30000/);
    expect(err(await sAlice.send_message(msg(Array.from({ length: 61 }, (_, i) => user(`p${i}`)))))).toMatch(/Too many recipients. Maximum is 60/);
    // a non-member keeps the plain limits
    expect(err(await sBob.send_message(msg([alice], 'ok', 'x'.repeat(5001))))).toMatch(/Body exceeds maximum length of 5000/);
    unwrap(await sBob.send_message(msg([alice], 'plain', 'ok')));
    expect(err(await sBob.send_message(msg([alice], 'plain', 'again')))).toMatch(/RateLimited: Must wait 10 more minutes/);
    unwrap(await s.update_config([0n], [], [], []));
    unwrap(await s.update_premium_config([[]], [], [], [], [])); // ?null clears
    expect(err(await sAlice.send_message(msg([bob], 'member', 'x'.repeat(5001))))).toMatch(/Body exceeds maximum length of 5000/); // no premium canister: plain limits
    expect((await s.get_premium_config()).sneed_premium_canister_id).toEqual([]);
    unwrap(await s.update_premium_config([], [500n], [20000n], [1n], [50n]));
  });

  it('admin list: anyone may add the first admin, after that only admins manage the list and the last one stays', async () => {
    // bootstrap: with an empty list any caller may appoint an admin (the controllers are admins regardless)
    unwrap(await sAlice.add_admin(alice));
    expect(await s.is_admin_query(alice)).toBe(true);
    expect(err(await sBob.add_admin(bob))).toMatch(/Unauthorized: Only admins can add new admins/);
    expect(err(await s.add_admin(alice))).toMatch(/AlreadyExists: Principal is already an admin/);
    expect(err(await s.add_admin(admin))).toMatch(/AlreadyExists/); // controllers count as admins
    expect(err(await sAlice.remove_admin(alice))).toMatch(/InvalidInput: Cannot remove the last admin/);
    expect(err(await sBob.remove_admin(alice))).toMatch(/Unauthorized: Only admins can remove admins/);
    expect(err(await s.remove_admin(bob))).toMatch(/NotFound: Admin not found/);
    unwrap(await s.remove_admin(alice)); // a controller may remove the last listed admin
    expect(await s.is_admin_query(alice)).toBe(false);
    unwrap(await sGov.add_admin(carol));
    const admins = await s.get_admins();
    expect(admins.length).toBe(1);
    expect(admins[0].principal.toText()).toBe(text(carol));
    expect(await sCarol.is_admin_query(carol)).toBe(true);
    unwrap(await sCarol.update_config([0n], [], [], [])); // a listed admin has admin powers
  });

  it('system notifications: authorised senders only, premium-sized, no rate limit, under the system sender principal', async () => {
    expect(err(await sAlice.get_authorized_senders())).toMatch(/Unauthorized: Only admins can view/);
    expect(unwrap(await s.get_authorized_senders())).toEqual([]);
    expect(err(await sAlice.add_authorized_sender(bot))).toMatch(/Unauthorized: Only admins can add/);
    unwrap(await s.add_authorized_sender(bot));
    expect(err(await s.add_authorized_sender(bot))).toMatch(/AlreadyExists: Sender is already authorized/);
    expect(err(await s.remove_authorized_sender(dave))).toMatch(/NotFound: Sender is not in authorized list/);
    expect(unwrap(await s.get_authorized_senders()).map(text)).toEqual([text(bot)]);
    expect(err(await sAlice.send_system_notification({ recipients: [bob], subject: 'x', body: 'y' }))).toMatch(/Unauthorized: Caller is not authorized/);
    expect(err(await s.send_system_notification({ recipients: [bob], subject: 'x', body: 'y' }))).toMatch(/Unauthorized/); // admins are not senders
    expect(err(await sBot.send_system_notification({ recipients: [], subject: 'x', body: 'y' }))).toMatch(/InvalidInput: At least one recipient/);
    expect(err(await sBot.send_system_notification({ recipients: Array.from({ length: 51 }, (_, i) => user(`n${i}`)), subject: 'x', body: 'y' }))).toMatch(/InvalidInput: Too many recipients. Maximum is 50/);
    expect(err(await sBot.send_system_notification({ recipients: [bob], subject: 'x'.repeat(501), body: 'y' }))).toMatch(/InvalidInput: Subject too long. Maximum is 500/);
    expect(err(await sBot.send_system_notification({ recipients: [bob], subject: 'x', body: 'y'.repeat(20001) }))).toMatch(/InvalidInput: Body too long. Maximum is 20000/);
    // 30 recipients and a long body: more than a user may send
    const n1 = unwrap(await sBot.send_system_notification({ recipients: [bob, ...Array.from({ length: 29 }, (_, i) => user(`n${i}`))], subject: 'x'.repeat(300), body: 'y'.repeat(10000) }));
    const n2 = unwrap(await sBot.send_system_notification({ recipients: [bob], subject: 'again', body: 'no rate limit' }));
    expect(n2).toBe(n1 + 1n);
    let seen = (await sBob.get_message(n1))[0];
    expect(seen.sender.toText()).toBe(text(bot)); // no system sender configured: the caller
    expect(seen.recipients.length).toBe(30); expect(seen.reply_to).toEqual([]);
    expect(ids(await sBot.get_sent_messages())).toEqual([n1, n2]);
    // current behaviour: an empty subject and body pass (only the maximum is checked for notifications)
    const n3 = unwrap(await sBot.send_system_notification({ recipients: [bob], subject: '', body: '' }));
    expect((await sBob.get_message(n3))[0].subject).toBe('');
    expect(err(await sAlice.set_system_sender_principal([system]))).toMatch(/Unauthorized: Only admins can set/);
    unwrap(await s.set_system_sender_principal([system]));
    expect((await s.get_system_sender_principal())[0].toText()).toBe(text(system));
    const n4 = unwrap(await sBot.send_system_notification({ recipients: [bob], subject: 'from the system', body: 'z' }));
    seen = (await sBob.get_message(n4))[0];
    expect(seen.sender.toText()).toBe(text(system));
    expect(await sBot.get_message(n4)).toEqual([]); // the bot is not a participant of what it sent as the system
    expect((await actorAs(pic, smsIdl, smsId, system).get_message(n4))[0].can_remove_self).toBe(true);
    expect(err(await sAlice.remove_authorized_sender(bot))).toMatch(/Unauthorized: Only admins can remove/);
    unwrap(await s.remove_authorized_sender(bot));
    expect(err(await sBot.send_system_notification({ recipients: [bob], subject: 'x', body: 'y' }))).toMatch(/Unauthorized/);
    expect(unwrap(await s.get_authorized_senders())).toEqual([]);
  });

  it('counts unread messages since the last seen timestamp', async () => {
    expect(await s.get_recent_messages_count(user('nobody'))).toBe(0n);
    expect(await s.get_last_seen_messages_timestamp(user('nobody'))).toEqual([]);
    await actorAs(pic, smsIdl, smsId, user('nobody')).mark_messages_seen_up_to(5n); // unknown principal: a no-op
    expect(await s.get_last_seen_messages_timestamp(user('nobody'))).toEqual([]);
    const received = await sBob.get_received_messages();
    expect(await s.get_recent_messages_count(bob)).toBe(BigInt(received.length)); // never marked: everything counts
    // PocketIC advances 1 ns per round, so the newest message can sit after getTime()'s millisecond: mark up to it
    const now = received.reduce((m, r) => (r.created_at > m ? r.created_at : m), 0n);
    await sBob.mark_messages_seen_up_to(now);
    expect(await s.get_last_seen_messages_timestamp(bob)).toEqual([now]);
    expect(await s.get_recent_messages_count(bob)).toBe(0n);
    await pic.tick(1);
    unwrap(await sAlice.send_message(msg([bob], 'new', 'unread')));
    expect(await s.get_recent_messages_count(bob)).toBe(1n);
    await sBob.mark_messages_seen_up_to(now - 1n); // marking backwards re-opens what came after
    expect(await s.get_recent_messages_count(bob)).toBe(2n);
    expect(await s.get_recent_messages_count(alice)).toBeGreaterThan(0n); // alice never marked anything
  });

  it('removing yourself: recipients drop out, the sender steps back, the last one out deletes the message', async () => {
    const m = unwrap(await sCarol.send_message(msg([alice, bob], 'group', 'three of us')));
    expect(err(await sDave.remove_self_from_message(m))).toMatch(/Unauthorized: Cannot access this message/);
    expect(err(await sDave.remove_self_from_message(999n))).toMatch(/NotFound: Message not found/);
    unwrap(await sBob.remove_self_from_message(m));
    expect(await sBob.get_message(m)).toEqual([]);
    expect(ids(await sBob.get_received_messages())).not.toContain(m);
    let seen = (await sAlice.get_message(m))[0];
    expect(seen.recipients.map(text)).toEqual([text(alice)]);
    expect(seen.updated_at > seen.created_at).toBe(true);
    expect(err(await sBob.remove_self_from_message(m))).toMatch(/Unauthorized/); // gone for bob
    unwrap(await sAlice.remove_self_from_message(m));
    seen = (await sCarol.get_message(m))[0];
    expect(seen.recipients).toEqual([]); // the sender still holds it
    expect(ids(await sCarol.get_sent_messages())).toContain(m);
    unwrap(await sCarol.remove_self_from_message(m)); // nobody left: deleted
    expect(await sCarol.get_message(m)).toEqual([]);
    expect(ids(await sCarol.get_sent_messages())).not.toContain(m);
    expect(ids(await s.get_all_messages_admin())).not.toContain(m);
    // a note to self, removed by its only participant, is deleted outright
    const note = unwrap(await sBob.send_message(msg([bob], 'note', 'to self')));
    expect(ids(await sBob.get_all_messages()).filter((id) => id === note).length).toBe(1);
    unwrap(await sBob.remove_self_from_message(note));
    expect(await sBob.get_message(note)).toEqual([]);
  });

  it('a sender who steps back is shown as removed (the anonymous principal) and nobody else gains access', async () => {
    // alice was the first principal the canister ever saw (dedup index 0, see the first send above): she must gain nothing
    const ANON = Principal.anonymous().toText();
    const m = unwrap(await sCarol.send_message(msg([bob], 'carol to bob', 'private')));
    expect(await sAlice.get_message(m)).toEqual([]);
    unwrap(await sCarol.remove_self_from_message(m));
    expect(await sCarol.get_message(m)).toEqual([]);
    expect(ids(await sCarol.get_sent_messages())).not.toContain(m);
    expect(err(await sCarol.remove_self_from_message(m))).toMatch(/Unauthorized: Cannot access this message/); // gone for carol
    const seen = (await sBob.get_message(m))[0];
    expect(seen.sender.toText()).toBe(ANON);
    expect(seen.recipients.map(text)).toEqual([text(bob)]);
    expect(seen.can_remove_self).toBe(true);
    expect(await sAlice.get_message(m)).toEqual([]); // the third party at index 0 gains nothing
    expect(ids(await sAlice.get_all_messages())).not.toContain(m);
    expect(err(await sAlice.remove_self_from_message(m))).toMatch(/Unauthorized: Cannot access this message/);
    expect(err(await sAlice.send_message(msg([bob], 're', 'x', [[m]])))).toMatch(/Unauthorized: Cannot reply to message/);
    expect(ids(await sBob.get_received_messages())).toContain(m);
    // the last recipient out deletes it
    unwrap(await sBob.remove_self_from_message(m));
    expect(await sBob.get_message(m)).toEqual([]);
    expect(ids(await s.get_all_messages_admin())).not.toContain(m);
    // a sender who is also a recipient leaves both roles at once
    const both = unwrap(await sBob.send_message(msg([bob, carol], 'to us', 'both')));
    unwrap(await sBob.remove_self_from_message(both));
    expect(await sBob.get_message(both)).toEqual([]);
    expect(ids(await sBob.get_all_messages())).not.toContain(both);
    const left = (await sCarol.get_message(both))[0];
    expect(left.sender.toText()).toBe(ANON); expect(left.recipients.map(text)).toEqual([text(carol)]);
    unwrap(await sCarol.remove_self_from_message(both));
    expect(ids(await s.get_all_messages_admin())).not.toContain(both);
  });

  it('a recipient leaving removes only their own copy: the real sender keeps it in their sent box', async () => {
    // the sender here is alice, dedup index 0, the case the old code got wrong
    const m = unwrap(await sAlice.send_message(msg([bob, carol], 'alice to two', 'x')));
    expect(ids(await sAlice.get_sent_messages())).toContain(m);
    unwrap(await sBob.remove_self_from_message(m));
    expect((await sAlice.get_message(m))[0].sender.toText()).toBe(text(alice));
    expect(ids(await sAlice.get_sent_messages())).toContain(m);
    expect(ids(await sBob.get_received_messages())).not.toContain(m);
    expect(ids(await sCarol.get_received_messages())).toContain(m);
    // and a recipient leaving a message someone else sent leaves alice's sent box alone too
    const other = unwrap(await sCarol.send_message(msg([bob, dave], 'carol to two', 'y')));
    const aliceSentBefore = ids(await sAlice.get_sent_messages());
    unwrap(await sDave.remove_self_from_message(other));
    expect(ids(await sAlice.get_sent_messages())).toEqual(aliceSentBefore);
    expect(ids(await sCarol.get_sent_messages())).toContain(other);
  });

  it('admin view of all messages, and imports for controllers only', async () => {
    expect(await sAlice.get_all_messages_admin()).toEqual([]);
    const all = await s.get_all_messages_admin();
    expect(all.length).toBe(Number((await s.get_stats()).total_messages));
    expect(ids(await sCarol.get_all_messages_admin()).length).toBe(all.length); // listed admin
    expect(err(await sAlice.import_admins([]))).toMatch(/Unauthorized: Only controllers can import/);
    expect(err(await sGov.import_admins([]))).toMatch(/Unauthorized: Only controllers/); // governance is admin but not a controller
    expect(err(await sCarol.import_messages([]))).toMatch(/Unauthorized: Only controllers/);
    expect(unwrap(await s.import_admins([{ principal: dave, added_by: 0, added_at: 1n }, { principal: carol, added_by: 0, added_at: 1n }]))).toBe(1n); // carol already is one
    expect(await s.is_admin_query(dave)).toBe(true);
    unwrap(await s.remove_admin(dave));
    const imported = { id: 500n, sender: dave, recipients: [alice], subject: 'restored', body: 'from a backup', reply_to: [[1n]], created_at: 123n, updated_at: 456n, can_remove_self: false };
    expect(unwrap(await s.import_messages([imported]))).toBe(1n);
    expect(unwrap(await s.import_messages([imported]))).toBe(0n); // same id: skipped
    const seen = (await sAlice.get_message(500n))[0];
    expect(seen.sender.toText()).toBe(text(dave)); expect(seen.created_at).toBe(123n); expect(seen.reply_to).toEqual([[1n]]); expect(seen.can_remove_self).toBe(true);
    expect(ids(await sDave.get_sent_messages())).toEqual([500n]);
    expect(unwrap(await sDave.send_message(msg([alice], 'next', 'id after the import')))).toBe(501n); // the counter moved past the import
  });

  it('keeps messages, admins, configuration, senders and seen markers across an upgrade', async () => {
    unwrap(await s.update_config([3n], [150n], [4000n], [15n]));
    unwrap(await s.update_premium_config([[premiumId]], [], [], [], []));
    unwrap(await s.add_authorized_sender(bot));
    const before = {
      all: await s.get_all_messages_admin(), admins: await s.get_admins(), config: await s.get_config(), premium: await s.get_premium_config(),
      senders: unwrap(await s.get_authorized_senders()), system: await s.get_system_sender_principal(), stats: await s.get_stats(),
      bobSeen: await s.get_last_seen_messages_timestamp(bob), bobReceived: await sBob.get_received_messages(), aliceSent: await sAlice.get_sent_messages(),
    };
    await pic.upgradeCanister({ sender: admin, canisterId: smsId, wasm: wasm('sneed_sms'), arg: IDL.encode([], []), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    const after = {
      all: await s.get_all_messages_admin(), admins: await s.get_admins(), config: await s.get_config(), premium: await s.get_premium_config(),
      senders: unwrap(await s.get_authorized_senders()), system: await s.get_system_sender_principal(), stats: await s.get_stats(),
      bobSeen: await s.get_last_seen_messages_timestamp(bob), bobReceived: await sBob.get_received_messages(), aliceSent: await sAlice.get_sent_messages(),
    };
    expect(after).toEqual(before);
    expect(after.config).toEqual({ rate_limit_minutes: 3n, max_subject_length: 150n, max_body_length: 4000n, max_recipients: 15n });
    const sEve = actorAs(pic, smsIdl, smsId, user('eve'));
    expect(unwrap(await sEve.send_message(msg([alice], 'after', 'the upgrade')))).toBe(502n); // the id counter survived
    expect(err(await sEve.send_message(msg([alice], 'again', 'x')))).toMatch(/RateLimited: Must wait 3 more minutes/); // the restored limit applies
  });
});
