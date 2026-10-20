// sneed_sns_forum → sneed_notifications: with a notifications canister set, a reply notifies the
// author of the post (or thread) it answers, a mention notifies the person mentioned (once, not
// also as a reply), a tip the ledger confirms notifies the person tipped (an unverified one does not); only members who allowed Sneed Hub get
// anything, and a forum without the setting sends nothing.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, account, admin, alice, bob, carol, user, SNEED_SNS_ROOT, SNEED_GOVERNANCE, unwrap, errOf, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { idlFactory as forumIdl } from '../build/sneed_sns_forum.did.js';
import { idlFactory as notifIdl } from '../build/sneed_notifications.did.js';

const SNS_W = Principal.fromText('qaa6y-5yaaa-aaaaa-aaafa-cai');
const dave = user('dave');
const directoryIdl = ({ IDL }) => IDL.Service({ set_instances: IDL.Func([IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Principal))], [], []) });
const link = (p, name = 'someone') => `[@${name}](https://app.sneeddao.com/principal?id=${p.toText()})`;
const ledger = Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai');

let pic, forumId, notifId, f, n, fas, nas, appId, T, TH;
const history = async (p) => (await nas(p).get_my_history(20n)).map((h) => [h.topic, h.title]);
const settle = async () => { await pic.tick(5); };

describe('sneed_sns_forum: notifications', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    await install(pic, { name: 'MockForumSnsW', targetCanisterId: SNS_W });
    const govId = await install(pic, { name: 'MockForumGovernance' });
    await install(pic, { name: 'MockIcpLedger', targetCanisterId: ledger }); // tips are read on it
    forumId = await install(pic, { name: 'sneed_sns_forum' });
    notifId = await install(pic, { name: 'sneed_notifications' });
    await actorAs(pic, directoryIdl, SNS_W, admin).set_instances([[SNEED_SNS_ROOT, govId]]);
    f = actorAs(pic, forumIdl, forumId, admin);
    n = actorAs(pic, notifIdl, notifId, admin);
    fas = (p) => actorAs(pic, forumIdl, forumId, p);
    nas = (p) => actorAs(pic, notifIdl, notifId, p);
    const F = unwrap(await f.create_forum({ title: 'Sneed', description: 'd', sns_root_canister_id: [] }));
    T = unwrap(await f.create_topic({ forum_id: F, parent_topic_id: [], title: 'General', description: 'g' }));
    appId = unwrap(await n.admin_register_app(SNEED_GOVERNANCE, { name: 'Sneed Hub', logo: [], description: 'replies, mentions, tips', canisters: [forumId], topics: [
      { id: 'reply', title: 'Replies to your posts', description: '', level: { normal: null } },
      { id: 'mention', title: 'Mentions', description: '', level: { normal: null } },
      { id: 'tip', title: 'Tips', description: '', level: { urgent: null } },
    ] }));
    for (const p of [alice, bob, carol]) unwrap(await nas(p).allow_app(appId, true)); // dave doesn't
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('sends nothing until the forum is pointed at the service', async () => {
    TH = unwrap(await fas(alice).create_thread({ topic_id: T, title: ['Hello'], body: 'first' }));
    unwrap(await fas(bob).create_post(TH, [], [], 'a reply before the setting'));
    await settle();
    expect(await history(alice)).toEqual([]);
    expect(await f.get_notifications_canister()).toEqual([]);
    expect(JSON.stringify(errOf(await fas(bob).admin_set_notifications([notifId])))).toMatch(/Admins only/);
    unwrap(await f.admin_set_notifications([notifId]));
    expect((await f.get_notifications_canister())[0].toText()).toBe(notifId.toText());
  });

  it('notifies the author of the thread, or of the post replied to', async () => {
    const P1 = unwrap(await fas(bob).create_post(TH, [], [], 'Bob answers the thread'));
    await settle();
    expect(await history(alice)).toEqual([['reply', 'New reply in “Hello”']]);
    unwrap(await fas(carol).create_post(TH, [P1], [], 'Carol answers Bob'));
    await settle();
    expect((await history(bob))[0]).toEqual(['reply', 'New reply in “Hello”']);
    expect((await nas(bob).get_my_history(1n))[0].link[0]).toMatch(/\/post\?postid=\d+$/);
    // replying to yourself notifies nobody
    unwrap(await fas(alice).create_post(TH, [], [], 'Alice answers her own thread'));
    await settle();
    expect((await history(alice)).length).toBe(1);
  });

  it('notifies people mentioned, once (not also as a reply), and only those who allowed Sneed Hub', async () => {
    unwrap(await fas(carol).create_post(TH, [], [], `${link(alice)} and ${link(dave)}, look`));
    await settle();
    const a = await history(alice);
    expect(a[0]).toEqual(['mention', 'You were mentioned in “Hello”']);
    expect(a.filter(([t]) => t === 'reply').length).toBe(1); // the earlier reply only
    expect(await history(dave)).toEqual([]); // never allowed the app
    // a mention added by an edit notifies; one already there doesn't again
    const P = unwrap(await fas(bob).create_post(TH, [], [], 'no one yet'));
    unwrap(await fas(bob).update_post(P, [], `now ${link(carol)}`));
    unwrap(await fas(bob).update_post(P, [], `now ${link(carol)}, edited again`));
    await settle();
    expect((await history(carol)).filter(([t]) => t === 'mention').length).toBe(1);
  });

  it('notifies the person tipped when the ledger confirms the tip, and not for a tip it cannot confirm', async () => {
    const P = unwrap(await fas(bob).create_post(TH, [], [], 'tip me'));
    const before = (await history(bob)).length;
    // claims without a transfer behind them: recorded as unverified (no block) or refused (no such block); no notification
    unwrap(await fas(carol).create_tip(bob, P, ledger, 100n, []));
    expect(JSON.stringify(errOf(await fas(carol).create_tip(bob, P, ledger, 100n, [424242n])))).toMatch(/no block/);
    await settle();
    expect((await history(bob)).length).toBe(before);
    const icp = actorAs(pic, ({ IDL }) => IDL.Service({ icrc1_transfer: IDL.Func([IDL.Record({ from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)), to: IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) }), amount: IDL.Nat, fee: IDL.Opt(IDL.Nat), memo: IDL.Opt(IDL.Vec(IDL.Nat8)), created_at_time: IDL.Opt(IDL.Nat64) })], [IDL.Variant({ Ok: IDL.Nat, Err: IDL.Reserved })], []) }), ledger, carol);
    const block = unwrap(await icp.icrc1_transfer({ from_subaccount: [], to: account(bob), amount: 100n, fee: [], memo: [], created_at_time: [] }));
    unwrap(await fas(carol).create_tip(bob, P, ledger, 100n, [block]));
    await settle();
    expect((await history(bob))[0]).toEqual(['tip', 'Your post got a tip']);
    expect((await history(bob)).length).toBe(before + 1);
  });

  it('guards the new methods at ingress', async () => {
    const upd = actorAs(pic, asUpdates(forumIdl), forumId, bob);
    expect(await refusedAtIngress(upd.get_notifications_canister())).toBe(true);
    expect(await refusedAtIngress(nas(bob).admin_register_app(bob, { name: 'x', logo: [], description: '', canisters: [forumId], topics: [] }))).toBe(true);
  });
});
