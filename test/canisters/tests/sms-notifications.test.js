// sneed_sms → sneed_notifications: a message a person sends (send_message) gives each recipient
// one heads-up ("New message from …", the subject, a link; never the text) on their own channels,
// for those who allowed Sneed Hub. No loop, guarded twice: system messages
// (send_system_notification, which is how Sneed Notifications copies notifications into inboxes)
// never notify, and Sneed Notifications never delivers what the SMS canister sends to #sneed_sms
// channels. Forum notifications still reach Sneed SMS as before; with the setting unset SMS
// sends nothing. The preview stops at the last space before 100 characters and never leaves half
// a link. SMS_WASM=sneed_sms_prod npx vitest run tests/sms-notifications.test.js runs it against
// the production code (src/sneed_sms at e832eeac), where the preview test fails.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, SNEED_SNS_ROOT, SNEED_GOVERNANCE, unwrap, errOf, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { idlFactory as smsIdl } from '../build/sneed_sms.did.js';
import { idlFactory as notifIdl } from '../build/sneed_notifications.did.js';
import { idlFactory as forumIdl } from '../build/sneed_sns_forum.did.js';

const SNS_W = Principal.fromText('qaa6y-5yaaa-aaaaa-aaafa-cai');
const directoryIdl = ({ IDL }) => IDL.Service({ set_instances: IDL.Func([IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Principal))], [], []) });
const relay = user('discord-relay');
const dave = user('dave'); // never allows Sneed Hub
const short = (p) => { const t = p.toText(); return `${t.slice(0, 5)}…${t.slice(-3)}`; };

let pic, smsId, notifId, forumId, sms, n, smsAs, nas, fas, appId, TH, hubAfter;
const discord = {}; // user text -> channel id
const settle = async () => { for (let i = 0; i < 3; i++) { await pic.advanceTime(31_000); await pic.tick(4); } };
// Sneed Hub's notifications only (not the channel verification code)
const history = async (p) => (await nas(p).get_my_history(50n)).filter((h) => h.app === appId);
const inbox = (p) => smsAs(p).get_received_messages();
const distinct = async (p) => new Set((await inbox(p)).map((m) => m.id)).size;
// what the Discord relay is handed (acknowledged, so it is not handed again)
async function relayed() {
  const jobs = await nas(relay).relay_pull(50n);
  if (jobs.length) await nas(relay).relay_ack(jobs.map((j) => [j.id, { ok: null }]));
  return jobs;
}
const SMS_WASM = process.env.SMS_WASM || 'sneed_sms';
const send = (from, to, subject, body) => smsAs(from).send_message({ recipients: to, subject, body, reply_to: [] });

describe('sneed_sms: notifications for direct messages', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    await install(pic, { name: 'MockForumSnsW', targetCanisterId: SNS_W });
    const govId = await install(pic, { name: 'MockForumGovernance' });
    smsId = await install(pic, { name: SMS_WASM });
    notifId = await install(pic, { name: 'sneed_notifications' });
    forumId = await install(pic, { name: 'sneed_sns_forum' });
    await actorAs(pic, directoryIdl, SNS_W, admin).set_instances([[SNEED_SNS_ROOT, govId]]);
    sms = actorAs(pic, smsIdl, smsId, admin);
    n = actorAs(pic, notifIdl, notifId, admin);
    smsAs = (p) => actorAs(pic, smsIdl, smsId, p);
    nas = (p) => actorAs(pic, notifIdl, notifId, p);
    fas = (p) => actorAs(pic, forumIdl, forumId, p);
    unwrap(await sms.update_config([0n], [], [], [])); // no rate limit between test messages
    unwrap(await sms.add_authorized_sender(notifId));
    unwrap(await sms.add_authorized_sender(admin)); // to send a system message by hand
    const c = await n.get_config();
    // free Discord deliveries: the test is about routing, not payment
    unwrap(await n.admin_set_config({ ...c, sneed_sms: smsId, relays: [[relay, { discord: null }]],
      prices_e8s: c.prices_e8s.map(([k, p]) => ('discord' in k ? [k, 0n] : [k, p])) }));
    // Sneed Hub as production runs it today (the forum), then Sneed SMS added as after the release
    const hub = { name: 'Sneed Hub', logo: [], description: 'forum and messages', canisters: [forumId], topics: [
      { id: 'reply', title: 'Replies to your posts', description: '', level: { normal: null } },
    ] };
    appId = unwrap(await n.admin_register_app(SNEED_GOVERNANCE, hub));
    hubAfter = { ...hub, canisters: [forumId, smsId], topics: [...hub.topics, { id: 'direct_message', title: 'New direct messages', description: '', level: { normal: null } }] };
    unwrap(await n.update_app(appId, hubAfter));
    for (const p of [alice, bob, carol]) unwrap(await nas(p).allow_app(appId, true));
    // alice: Discord, and (to show the rule) her Sneed SMS channel chosen for "normal" too
    discord[alice.toText()] = unwrap(await nas(alice).add_channel({ discord: null }, 'Discord', new TextEncoder().encode('enc:alice')));
    const [job] = await relayed();
    unwrap(await nas(alice).verify_channel(discord[alice.toText()], job.title.match(/(\d{6})/)[1]));
    const mine = await nas(alice).get_my_settings();
    const smsCh = mine.channels.find((ch) => 'sneed_sms' in ch.kind).id;
    unwrap(await nas(alice).set_settings({ ...mine.settings, defaults: { urgent: [], normal: [discord[alice.toText()], smsCh], info: [] } }));
    // the forum: a thread by alice, notifications on
    const F = unwrap(await fas(admin).create_forum({ title: 'Sneed', description: 'd', sns_root_canister_id: [] }));
    const T = unwrap(await fas(admin).create_topic({ forum_id: F, parent_topic_id: [], title: 'General', description: 'g' }));
    TH = unwrap(await fas(alice).create_thread({ topic_id: T, title: ['Hello'], body: 'first' }));
    unwrap(await fas(admin).admin_set_notifications([notifId]));
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('with no notifications canister set, messages send as before and notify nobody', async () => {
    expect(await sms.get_notifications_canister()).toEqual([]);
    unwrap(await send(bob, [alice], 'before', 'sent before the setting'));
    await settle();
    expect(await history(alice)).toEqual([]);
    expect(await relayed()).toEqual([]);
    expect((await inbox(alice)).map((m) => m.subject)).toEqual(['before']);
    expect(errOf(await smsAs(bob).admin_set_notifications([notifId]))).toEqual({ Unauthorized: 'Admins only' });
    unwrap(await sms.admin_set_notifications([notifId]));
    expect((await sms.get_notifications_canister())[0].toText()).toBe(notifId.toText());
  });

  it('notifies each recipient once, on their own channels and never Sneed SMS, with a 100-character preview', async () => {
    const before = new Set((await inbox(alice)).map((m) => m.id)).size;
    // alice twice, the sender himself, and dave, who never allowed Sneed Hub
    const id = unwrap(await send(bob, [alice, carol, alice, dave, bob], 'Lunch?', 'the private text'));
    await settle();
    const [h, ...rest] = await history(alice);
    expect(rest).toEqual([]);
    expect([h.topic, h.title, h.body, h.link]).toEqual(['direct_message', `New message from ${short(bob)}`, 'Lunch?\nthe private text', [`https://app.sneeddao.com/msg/${id}`]]);
    expect(h.deliveries.map((d) => Object.keys(d.kind)[0])).toEqual(['discord']); // not her chosen nor her copy Sneed SMS channel
    const jobs = await relayed();
    expect(jobs.map((j) => [j.title, j.body])).toEqual([[`New message from ${short(bob)}`, 'Lunch?\nthe private text']]);
    const c = await history(carol); // allowed, no channel of her own but Sneed SMS: recorded, delivered nowhere
    expect(c.map((x) => [x.topic, x.deliveries.length])).toEqual([['direct_message', 0]]);
    expect(await history(dave)).toEqual([]);
    expect(await history(bob)).toEqual([]);
    // the message itself, and no copy of the notice
    const box = await inbox(alice); // (listed twice, the message shows twice: SMS keeps duplicates)
    expect(box.filter((m) => m.subject.startsWith('[Sneed Hub]'))).toEqual([]);
    expect(new Set(box.map((m) => m.id)).size).toBe(before + 1);
    expect((await inbox(carol)).map((m) => m.subject)).toEqual(['Lunch?']);
  });

  it('a system message notifies nobody; the next message from a person does', async () => {
    unwrap(await sms.send_system_notification({ recipients: [alice, carol], subject: 'System', body: 'from a system sender' }));
    await settle();
    expect((await history(alice)).length).toBe(1);
    expect((await history(carol)).length).toBe(1);
    expect(await relayed()).toEqual([]);
    unwrap(await send(carol, [alice], 'Hi', 'from carol'));
    await settle();
    expect((await history(alice)).map((x) => x.title)).toEqual([`New message from ${short(carol)}`, `New message from ${short(bob)}`]);
    expect((await relayed()).length).toBe(1);
  });

  it('runs the loop with both canisters: a forum reply reaches Sneed SMS as before, and that copy notifies nobody', async () => {
    const hBefore = (await history(alice)).length;
    const iBefore = await distinct(alice);
    unwrap(await fas(bob).create_post(TH, [], [], 'Bob answers'));
    await settle();
    const h = await history(alice);
    expect(h.length).toBe(hBefore + 1); // the reply only: its copy into Sneed SMS (a system message) did not notify
    expect(h[0].topic).toBe('reply');
    expect(h[0].deliveries.map((d) => Object.keys(d.kind)[0]).sort()).toEqual(['discord', 'sneed_sms']); // forum: to Sneed SMS as before
    const box = await inbox(alice);
    expect(await distinct(alice)).toBe(iBefore + 1);
    expect(box.some((m) => m.subject === '[Sneed Hub] New reply in “Hello”')).toBe(true);
    expect((await relayed()).map((j) => j.title)).toEqual(['New reply in “Hello”']);
    // and a direct message round trip: one notice, no copy in the inbox, nothing further
    unwrap(await send(bob, [alice], 'Again', 'text'));
    await settle();
    await settle();
    expect((await history(alice)).length).toBe(hBefore + 2);
    expect(await distinct(alice)).toBe(iBefore + 2); // bob's message, no "[Sneed Hub] New message …" copy
    expect((await relayed()).length).toBe(1);
  });

  it('keeps direct-message notices off #sneed_sms channels, but not forum notifications', async () => {
    const notes = (await history(alice)).filter((x) => x.topic === 'direct_message');
    expect(notes.length).toBeGreaterThan(0);
    for (const x of notes) expect(x.deliveries.some((d) => 'sneed_sms' in d.kind)).toBe(false);
    const replies = (await history(alice)).filter((x) => x.topic === 'reply');
    for (const x of replies) expect(x.deliveries.some((d) => 'sneed_sms' in d.kind)).toBe(true);
  });

  it('lets an admin who does not control a canister add it to an app (as admin_register_app may)', async () => {
    const helper = user('notif-admin'); // an admin of sneed_notifications, no controller of sneed_sms
    unwrap(await n.admin_add_admin(helper));
    unwrap(await nas(helper).update_app(appId, { ...hubAfter, canisters: [forumId] }));
    unwrap(await nas(helper).update_app(appId, hubAfter));
    expect((await n.get_app_of(smsId))[0].id).toBe(appId);
    // the owner check stays for everyone else
    expect(errOf(await nas(bob).update_app(appId, hubAfter))).toMatch(/owner/);
  });

  it('guards the new methods at ingress', async () => {
    const upd = actorAs(pic, asUpdates(smsIdl), smsId, bob);
    expect(await refusedAtIngress(upd.get_notifications_canister())).toBe(true);
  });
  it('cuts the preview at 100 characters, and leaves it out for someone who turned previews off', async () => {
    const long = 'x'.repeat(150);
    expect(await smsAs(alice).get_notification_preview()).toBe(true); // on by default
    unwrap(await send(bob, [alice], 'Long one', long));
    await settle();
    expect((await history(alice))[0].body).toBe('Long one\n' + 'x'.repeat(100) + '…');
    await relayed();
    unwrap(await smsAs(alice).set_notification_preview(false));
    expect(await smsAs(alice).get_notification_preview()).toBe(false);
    unwrap(await send(bob, [alice], 'Quiet', 'secret words'));
    await settle();
    expect((await history(alice))[0].body).toBe('Quiet');
    expect((await relayed()).map((j) => j.body).join()).not.toMatch(/secret words/);
    unwrap(await smsAs(alice).set_notification_preview(true));
  });

  // Seen live: "…https://app.sneeddao.com/post?…", a link cut in half that opened a broken page.
  it('cuts the preview at the last space before 100 characters and never leaves half a link', async () => {
    const preview = async (subject, text) => {
      unwrap(await send(bob, [alice], subject, text));
      await settle();
      await relayed();
      const [h] = await history(alice);
      expect(h.title).toBe(`New message from ${short(bob)}`);
      return h.body.slice(subject.length + 1); // after "subject\n"; '' when there is no preview
    };
    // a link that the 100-character limit cuts: dropped whole, the words before it kept
    const intro = 'Hi Alice, the release notes for this week are posted, have a look when you have a moment:';
    const link = 'https://app.sneeddao.com/post?postid=4242&threadid=899';
    expect(intro.length).toBeLessThan(100);
    expect(intro.length + 1 + link.length).toBeGreaterThan(100);
    const p1 = await preview('Notes', `${intro} ${link} thanks!`);
    expect(p1).toBe(`${intro}…`);
    expect(p1).not.toMatch(/https?:/);
    // the same inside a Markdown mention, and a link only starting at the limit ("http")
    const mention = `[@Alice](https://app.sneeddao.com/principal?id=${alice.toText()})`;
    const lead = 'x '.repeat(30);
    const p2 = await preview('Mention', `${lead}cc ${mention} more`);
    expect(p2).toBe(`${lead}cc…`);
    const p3 = await preview('Edge', `${'w '.repeat(48)}https://a.b/c`); // 96 chars, then the link
    expect(p3).toBe(`${'w '.repeat(48).trimEnd()}…`);
    // a whole text that is one long link: no preview at all, only the subject
    expect(await preview('Only a link', `https://app.sneeddao.com/${'a'.repeat(120)}`)).toBe('');
    expect((await history(alice))[0].body).toBe('Only a link');
    // words: cut between words, not inside one
    expect(await preview('Words', 'word '.repeat(30))).toBe(`${'word '.repeat(20).trimEnd()}…`);
    expect(await preview('Words2', `${'abcdefg '.repeat(12)}abcdefghij`)).toBe(`${'abcdefg '.repeat(12).trimEnd()}…`);
    // one long word without spaces: still cut at 100 characters
    expect(await preview('Long word', 'y'.repeat(130))).toBe(`${'y'.repeat(100)}…`);
    // a short message, links and all, is unchanged and gets no "…"
    expect(await preview('Short', 'see https://app.sneeddao.com/post?postid=1 ok')).toBe('see https://app.sneeddao.com/post?postid=1 ok');
    expect(await preview('Exactly', 'z'.repeat(100))).toBe('z'.repeat(100));
  });

});
