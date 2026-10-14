// sneed_sns_forum: the SNS forum (also used by TACO DAO, so this doubles as a
// contract test of the public API). Forums belong to an SNS root; topics nest;
// anyone signed in writes threads and posts; posts need the forum's SNS to be
// known to SNS-W (a mock at the real SNS-W id); votes and poll votes come from
// the caller's reachable neurons on that SNS's governance (mocks); premium
// members (MockPremium) get longer bodies; admins are the controllers, Sneed
// governance and a list; deletion is soft; one id counter for everything; an
// upgrade keeps it all. There is no ban feature in this canister.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, wasm, admin, alice, bob, carol, user, SNEED_GOVERNANCE, SNEED_SNS_ROOT, unwrap, errOf, nowNs } from '../lib/pic.js';
import { premiumIdl } from '../lib/idl.js';
import { idlFactory as forumIdl } from '../build/sneed_sns_forum.did.js';

const SNS_W = Principal.fromText('qaa6y-5yaaa-aaaaa-aaafa-cai');
const dave = user('dave'); const eve = user('eve');
const anon = Principal.anonymous();
const root2 = user('root2'); const root3 = user('root3'); const root4 = user('root4'); const rootX = user('rootX');
const ledger1 = user('ledger1'); const ledger2 = user('ledger2');
const HOUR_NS = 3_600_000_000_000n;
const nid = (n) => new Uint8Array(32).fill(n);
const N_A = nid(1); const N_A2 = nid(2); const N_B = nid(3); const N_C0 = nid(4); const N_A_BETA = nid(5);
const NEURON = (id) => ({ id });
const same = (a, b) => Array.from(a).join() === Array.from(b).join();

const directoryIdl = ({ IDL }) => IDL.Service({ set_instances: IDL.Func([IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Principal))], [], []) });
const neuronsIdl = ({ IDL }) => IDL.Service({
  add_neuron: IDL.Func([IDL.Vec(IDL.Nat8), IDL.Principal, IDL.Vec(IDL.Principal), IDL.Nat64, IDL.Nat64], [], []),
  set_stake: IDL.Func([IDL.Vec(IDL.Nat8), IDL.Nat64], [], []),
  set_name: IDL.Func([IDL.Opt(IDL.Text)], [], []),
  set_trap: IDL.Func([IDL.Bool], [], []),
});

const err = (r) => { const e = errOf(r); const k = Object.keys(e)[0]; return `${k}: ${e[k]}`; };
const text = (p) => p.toText();
const idsOf = (xs) => xs.map((x) => x.id);
const limits = (over = {}) => ({ post_title_max_length: [], post_body_max_length: [], thread_title_max_length: [], thread_body_max_length: [], topic_title_max_length: [], topic_description_max_length: [], forum_title_max_length: [], forum_description_max_length: [], ...over });
const pollInput = (over = {}) => ({ thread_id: 0n, post_id: [], title: 'Which?', body: 'Pick one', options: [{ title: 'A', body: [] }, { title: 'B', body: ['bee'] }, { title: 'C', body: [] }], vp_power: [], end_timestamp: 0n, allow_vote_changes: [], ...over });
const feedAll = async (actor, filter = [], length = 4n) => {
  const items = []; let start = [];
  for (let page = 0; page < 1000; page++) {
    const r = await actor.get_feed({ start_id: start, length, filter });
    items.push(...r.items);
    if (!r.has_more) break;
    start = r.next_start_id;
  }
  return items;
};

let pic, forumId, premiumId, gov1Id, gov2Id, gov3Id;
let f, fAlice, fBob, fCarol, fDave, fEve, fAnon, fGov, premium, gov1, gov2, gov3;
// ids created along the way
let F1, F2, F3, T1, T1a, T2, TH1, TH2, THb, P1, P2, P3, Pb;

describe('sneed_sns_forum', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    await install(pic, { name: 'MockForumSnsW', targetCanisterId: SNS_W });
    gov1Id = await install(pic, { name: 'MockForumGovernance' }); // Sneed
    gov2Id = await install(pic, { name: 'MockForumGovernance' }); // "Beta", serves root2 and root3
    gov3Id = await install(pic, { name: 'MockForumGovernance' }); // nameless, serves root4
    premiumId = await install(pic, { name: 'MockPremium' });
    forumId = await install(pic, { name: 'sneed_sns_forum' });
    await actorAs(pic, directoryIdl, SNS_W, admin).set_instances([[SNEED_SNS_ROOT, gov1Id], [root2, gov2Id], [root3, gov2Id], [root4, gov3Id]]);
    gov1 = actorAs(pic, neuronsIdl, gov1Id, admin); gov2 = actorAs(pic, neuronsIdl, gov2Id, admin); gov3 = actorAs(pic, neuronsIdl, gov3Id, admin);
    await gov2.set_name(['Beta']); await gov3.set_name([]);
    premium = actorAs(pic, premiumIdl, premiumId, admin);
    f = actorAs(pic, forumIdl, forumId, admin);
    fAlice = actorAs(pic, forumIdl, forumId, alice); fBob = actorAs(pic, forumIdl, forumId, bob); fCarol = actorAs(pic, forumIdl, forumId, carol);
    fDave = actorAs(pic, forumIdl, forumId, dave); fEve = actorAs(pic, forumIdl, forumId, eve); fAnon = actorAs(pic, forumIdl, forumId, anon);
    fGov = actorAs(pic, forumIdl, forumId, SNEED_GOVERNANCE);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('starts empty with the default limits; the controller and Sneed governance are admins', async () => {
    expect(await f.health_check()).toBe(true);
    expect(await f.get_stats()).toEqual({ total_forums: 0n, total_topics: 0n, total_threads: 0n, total_posts: 0n, total_votes: 0n });
    expect(await f.get_current_counter()).toBe(1n);
    expect(await f.get_text_limits()).toEqual({ post_title_max_length: 200n, post_body_max_length: 10000n, thread_title_max_length: 200n, thread_body_max_length: 10000n, topic_title_max_length: 100n, topic_description_max_length: 1000n, forum_title_max_length: 100n, forum_description_max_length: 1000n });
    expect(await f.get_premium_config()).toEqual({ sneed_premium_canister_id: [], premium_post_body_max_length: 50000n, premium_thread_body_max_length: 50000n });
    expect(await f.get_admins()).toEqual([]);
    expect(await f.is_admin(admin)).toBe(true);
    expect(await f.is_admin(SNEED_GOVERNANCE)).toBe(true);
    expect(await f.is_admin(alice)).toBe(false);
    expect(await f.get_feed({ start_id: [], length: 10n, filter: [] })).toEqual({ items: [], has_more: false, next_start_id: [] });
  });

  it('admin list: anyone may appoint the first admin, then only admins manage it and the last one stays', async () => {
    unwrap(await fAlice.add_admin(carol)); // bootstrap: the list was empty
    expect(err(await fAlice.add_admin(alice))).toMatch(/Unauthorized: Only admins can add new admins/);
    expect(err(await f.add_admin(carol))).toMatch(/AlreadyExists/);
    expect(err(await f.add_admin(SNEED_GOVERNANCE))).toMatch(/AlreadyExists/); // implicit admins count
    expect(err(await fCarol.remove_admin(carol))).toMatch(/InvalidInput: Cannot remove the last admin/);
    expect(err(await fAlice.remove_admin(carol))).toMatch(/Unauthorized: Only admins can remove admins/);
    expect(err(await f.remove_admin(dave))).toMatch(/NotFound: Admin not found/);
    unwrap(await fCarol.add_admin(dave));
    unwrap(await fCarol.remove_admin(dave));
    expect((await f.get_admins()).map((a) => text(a.principal))).toEqual([text(carol)]);
    expect(await f.is_admin(carol)).toBe(true);
    expect(await f.is_admin(dave)).toBe(false);
  });

  it('forums: admins create and edit them, one per SNS root, defaulting to the Sneed root', async () => {
    const input = (over = {}) => ({ title: 'Sneed', description: 'The Sneed DAO forum', sns_root_canister_id: [], ...over });
    expect(err(await fAlice.create_forum(input()))).toMatch(/Unauthorized: Admin access required/);
    expect(err(await f.create_forum(input({ title: '' })))).toMatch(/InvalidInput: Title cannot be empty/);
    expect(err(await f.create_forum(input({ title: 'x'.repeat(101) })))).toMatch(/InvalidInput: Title cannot exceed 100 characters/);
    expect(err(await f.create_forum(input({ description: '' })))).toMatch(/Description cannot be empty/);
    expect(err(await f.create_forum(input({ description: 'x'.repeat(1001) })))).toMatch(/Description cannot exceed 1000/);
    F3 = unwrap(await f.create_forum(input({ title: 'x'.repeat(100), description: 'y'.repeat(1000), sns_root_canister_id: [rootX] }))); // limits are inclusive
    expect(F3).toBe(1n);
    F1 = unwrap(await fCarol.create_forum(input()));
    F2 = unwrap(await fGov.create_forum(input({ title: 'Beta', description: 'Beta SNS', sns_root_canister_id: [root2] })));
    expect([F1, F2]).toEqual([2n, 3n]);
    const fr = (await fAlice.get_forum(F1))[0];
    expect(fr.sns_root_canister_id[0].toText()).toBe(text(SNEED_SNS_ROOT)); // no root given: Sneed
    expect(text(fr.created_by)).toBe(text(carol)); expect(fr.deleted).toBe(false);
    expect(idsOf(await fAlice.get_forums())).toEqual([F3, F1, F2]);
    expect((await fAlice.get_forum_by_sns_root(root2))[0].id).toBe(F2);
    expect(await fAlice.get_forum_by_sns_root(root3)).toEqual([]);
    expect(await fAlice.get_forum(99n)).toEqual([]);
    // editing
    expect(err(await fAlice.update_forum(F2, input({ title: 'Hacked', sns_root_canister_id: [root2] })))).toMatch(/Unauthorized/);
    expect(err(await f.update_forum(99n, input()))).toMatch(/NotFound: Forum not found/);
    expect(err(await f.update_forum(F2, input({ title: '' })))).toMatch(/Title cannot be empty/);
    // current behaviour: an edit without a root moves the forum to the Sneed root
    unwrap(await fCarol.update_forum(F2, input({ title: 'Beta DAO', description: 'Beta SNS' })));
    expect((await f.get_forum(F2))[0].sns_root_canister_id[0].toText()).toBe(text(SNEED_SNS_ROOT));
    unwrap(await fCarol.update_forum(F2, input({ title: 'Beta DAO', description: 'Beta SNS', sns_root_canister_id: [root2] })));
    const f2 = (await f.get_forum(F2))[0];
    expect(f2.title).toBe('Beta DAO'); expect(text(f2.sns_root_canister_id[0])).toBe(text(root2));
    expect(text(f2.updated_by)).toBe(text(carol)); expect(text(f2.created_by)).toBe(text(SNEED_GOVERNANCE));
    expect(f2.updated_at > f2.created_at).toBe(true);
  });

  it('topics: admins create nested topics inside one forum, validated', async () => {
    const input = (over = {}) => ({ forum_id: F1, parent_topic_id: [], title: 'General', description: 'Talk', ...over });
    expect(err(await fAlice.create_topic(input()))).toMatch(/Unauthorized: Admin access required/);
    expect(err(await f.create_topic(input({ title: 'x'.repeat(101) })))).toMatch(/Title cannot exceed 100/);
    expect(err(await f.create_topic(input({ description: '' })))).toMatch(/Description cannot be empty/);
    expect(err(await f.create_topic(input({ forum_id: 99n })))).toMatch(/NotFound: Forum not found/);
    expect(err(await f.create_topic(input({ parent_topic_id: [99n] })))).toMatch(/NotFound: Parent topic not found/);
    T1 = unwrap(await f.create_topic(input()));
    T1a = unwrap(await fCarol.create_topic(input({ parent_topic_id: [T1], title: 'Sub', description: 'A subtopic' })));
    T2 = unwrap(await f.create_topic(input({ forum_id: F2, title: 'Beta talk' })));
    expect(err(await f.create_topic(input({ forum_id: F2, parent_topic_id: [T1] })))).toMatch(/InvalidInput: Parent topic must belong to the same forum/);
    const t = (await fAlice.get_topic(T1a))[0];
    expect(t.forum_id).toBe(F1); expect(t.parent_topic_id).toEqual([T1]); expect(text(t.created_by)).toBe(text(carol));
    expect(idsOf(await fAlice.get_topics_by_forum(F1))).toEqual([T1, T1a]); // every topic of the forum, nested or not
    expect(idsOf(await fAlice.get_subtopics(T1))).toEqual([T1a]);
    expect(await fAlice.get_subtopics(T2)).toEqual([]);
    expect(await fAlice.get_topic(99n)).toEqual([]);
    // editing
    expect(err(await fAlice.update_topic(T1, input({ title: 'Mine' })))).toMatch(/Unauthorized/);
    expect(err(await f.update_topic(99n, input()))).toMatch(/NotFound: Topic not found/);
    expect(err(await f.update_topic(T1, input({ parent_topic_id: [T1] })))).toMatch(/InvalidInput: Topic cannot be parent of itself/);
    expect(err(await f.update_topic(T1, input({ parent_topic_id: [T2] })))).toMatch(/Parent topic must belong to the same forum/);
    expect(err(await f.update_topic(T1, input({ parent_topic_id: [99n] })))).toMatch(/Parent topic not found/);
    unwrap(await f.update_topic(T1, input({ title: 'General discussion', description: 'Anything goes' })));
    expect((await f.get_topic(T1))[0].title).toBe('General discussion');
  });

  it('re-parenting a topic keeps the subtopic index in step and refuses cycles', async () => {
    const a = unwrap(await f.create_topic({ forum_id: F1, parent_topic_id: [], title: 'A', description: 'a' }));
    const b = unwrap(await f.create_topic({ forum_id: F1, parent_topic_id: [], title: 'B', description: 'b' }));
    const c = unwrap(await f.create_topic({ forum_id: F1, parent_topic_id: [], title: 'C', description: 'c' }));
    unwrap(await f.update_topic(b, { forum_id: F1, parent_topic_id: [a], title: 'B', description: 'b' }));
    expect((await f.get_topic(b))[0].parent_topic_id).toEqual([a]);
    expect(idsOf(await f.get_subtopics(a))).toEqual([b]);
    unwrap(await f.update_topic(c, { forum_id: F1, parent_topic_id: [b], title: 'C', description: 'c' })); // a -> b -> c
    expect(idsOf(await f.get_subtopics(b))).toEqual([c]);
    // a parent that is the topic's child or deeper descendant would form a cycle
    expect(err(await f.update_topic(a, { forum_id: F1, parent_topic_id: [b], title: 'A', description: 'a' }))).toMatch(/InvalidInput: Parent topic cannot be a subtopic of this topic/);
    expect(err(await f.update_topic(a, { forum_id: F1, parent_topic_id: [c], title: 'A', description: 'a' }))).toMatch(/InvalidInput: Parent topic cannot be a subtopic of this topic/);
    expect((await f.get_topic(a))[0].parent_topic_id).toEqual([]);
    // re-parenting within the tree is fine: c moves up under a, and b no longer lists it
    unwrap(await f.update_topic(c, { forum_id: F1, parent_topic_id: [a], title: 'C', description: 'c' }));
    expect(await f.get_subtopics(b)).toEqual([]);
    expect(idsOf(await f.get_subtopics(a))).toEqual([b, c]);
    // a moved child leaves its old parent and comes back without duplicates
    unwrap(await f.update_topic(T1a, { forum_id: F1, parent_topic_id: [], title: 'Sub', description: 'A subtopic' }));
    expect(await f.get_subtopics(T1)).toEqual([]);
    unwrap(await f.update_topic(T1a, { forum_id: F1, parent_topic_id: [T1], title: 'Sub', description: 'A subtopic' }));
    expect(idsOf(await f.get_subtopics(T1))).toEqual([T1a]);
    unwrap(await f.update_topic(T1a, { forum_id: F1, parent_topic_id: [T1], title: 'Sub', description: 'A subtopic' })); // same parent: unchanged
    expect(idsOf(await f.get_subtopics(T1))).toEqual([T1a]);
    unwrap(await f.delete_topic(a)); unwrap(await f.delete_topic(b)); unwrap(await f.delete_topic(c));
  });

  it('threads: any signed-in user starts one in an existing topic; authors and admins edit it', async () => {
    const input = (over = {}) => ({ topic_id: T1, title: ['Hello'], body: 'First thread', ...over });
    expect(err(await fAnon.create_thread(input()))).toMatch(/Unauthorized: Authentication required to create threads/);
    expect(err(await fAlice.create_thread(input({ title: ['x'.repeat(201)] })))).toMatch(/Title cannot exceed 200/);
    expect(err(await fAlice.create_thread(input({ title: [''] })))).toMatch(/Title cannot be empty/);
    expect(err(await fAlice.create_thread(input({ body: '' })))).toMatch(/Body cannot be empty/);
    expect(err(await fAlice.create_thread(input({ body: 'x'.repeat(10001) })))).toMatch(/Body cannot exceed 10000/);
    expect(err(await fAlice.create_thread(input({ topic_id: 99n })))).toMatch(/NotFound: Topic not found/);
    const before = await f.get_current_counter();
    TH1 = unwrap(await fAlice.create_thread(input({ body: 'x'.repeat(10000) })));
    expect(TH1).toBe(before); // failed attempts did not use ids
    TH2 = unwrap(await fBob.create_thread(input({ title: [], body: 'Untitled thread' })));
    THb = unwrap(await fBob.create_thread(input({ topic_id: T2, title: ['Beta thread'], body: 'On the Beta SNS' })));
    const t = (await fEve.get_thread(TH1))[0];
    expect(t.topic_id).toBe(T1); expect(t.title).toEqual(['Hello']); expect(text(t.created_by)).toBe(text(alice));
    expect(t.unread_posts_count).toEqual([]); expect(t.total_posts_count).toEqual([]);
    expect(idsOf(await fEve.get_threads_by_topic(T1))).toEqual([TH1, TH2]);
    expect(await fEve.get_thread_context(TH1)).toEqual([{ thread_id: TH1, topic_id: T1, forum_id: F1, sns_root_canister_id: [SNEED_SNS_ROOT] }]);
    expect((await fEve.get_thread_context(THb))[0].forum_id).toBe(F2);
    expect(await fEve.get_thread_context(99n)).toEqual([]);
    // editing
    expect(err(await fBob.update_thread(TH1, ['Mine'], 'taken'))).toMatch(/Unauthorized: Only admins or thread owners/);
    expect(err(await fAlice.update_thread(99n, [], 'x'))).toMatch(/NotFound: Thread not found/);
    expect(err(await fAlice.update_thread(TH1, [], ''))).toMatch(/Body cannot be empty/);
    unwrap(await fAlice.update_thread(TH1, ['Hello world'], 'First thread, edited'));
    unwrap(await fCarol.update_thread(TH2, ['Titled by a moderator'], 'Untitled thread'));
    const t2 = (await f.get_thread(TH2))[0];
    expect(t2.title).toEqual(['Titled by a moderator']); expect(text(t2.updated_by)).toBe(text(carol)); expect(text(t2.created_by)).toBe(text(bob));
    unwrap(await fAlice.update_thread(TH1, [], 'Title removed')); // the title is optional
    expect((await f.get_thread(TH1))[0].title).toEqual([]);
    unwrap(await fAlice.update_thread(TH1, ['Hello'], 'First thread'));
  });

  it('posts: any signed-in user replies in a thread whose SNS governance is known; authors and admins edit', async () => {
    expect(err(await fAnon.create_post(TH1, [], [], 'hi'))).toMatch(/Unauthorized: Authentication required to create posts/);
    expect(err(await fAlice.create_post(TH1, [], ['x'.repeat(201)], 'hi'))).toMatch(/Title cannot exceed 200/);
    expect(err(await fAlice.create_post(TH1, [], [], ''))).toMatch(/Body cannot be empty/);
    expect(err(await fAlice.create_post(TH1, [], [], 'x'.repeat(10001)))).toMatch(/Body cannot exceed 10000/);
    // the SNS lookup comes first: an unknown thread reads as "no governance"
    expect(err(await fAlice.create_post(99n, [], [], 'hi'))).toMatch(/InternalError: No SNS governance canister found/);
    expect(err(await fAlice.create_post(TH1, [99n], [], 'hi'))).toMatch(/NotFound: Reply target post not found/);
    P1 = unwrap(await fAlice.create_post(TH1, [], ['Opening'], 'Alice opens'));
    P2 = unwrap(await fBob.create_post(TH1, [P1], [], 'Bob replies to alice'));
    P3 = unwrap(await fCarol.create_post(TH1, [], [], 'Carol posts at the root'));
    Pb = unwrap(await fBob.create_post(THb, [], [], 'Bob on Beta'));
    expect(err(await fAlice.create_post(THb, [P1], [], 'cross-thread'))).toMatch(/InvalidInput: Reply target must be in the same thread/);
    // a forum on a root SNS-W does not list: no posting there
    const th3 = unwrap(await fAlice.create_thread({ topic_id: unwrap(await f.create_topic({ forum_id: F3, parent_topic_id: [], title: 'X', description: 'x' })), title: [], body: 'in F3' }));
    expect(err(await fAlice.create_post(th3, [], [], 'hi'))).toMatch(/InternalError: No SNS governance canister found/);
    const p = (await fEve.get_post(P2))[0];
    expect(p.thread_id).toBe(TH1); expect(p.reply_to_post_id).toEqual([P1]); expect(p.title).toEqual([]);
    expect(p.upvote_score).toBe(0n); expect(p.downvote_score).toBe(0n); expect(text(p.created_by)).toBe(text(bob));
    expect(idsOf(await fEve.get_posts_by_thread(TH1))).toEqual([P1, P2, P3]);
    expect(idsOf(await fEve.get_post_replies(P1))).toEqual([P2]);
    expect(await fEve.get_post_replies(P3)).toEqual([]);
    expect(await fEve.get_post(99n)).toEqual([]);
    // editing
    expect(err(await fAlice.update_post(P2, [], 'not mine'))).toMatch(/Unauthorized: Only admins or post owners/);
    expect(err(await fAlice.update_post(99n, [], 'x'))).toMatch(/NotFound: Post not found/);
    expect(err(await fBob.update_post(P2, [''], 'x'))).toMatch(/Title cannot be empty/);
    unwrap(await fBob.update_post(P2, ['Re: Opening'], 'Bob replies to alice, edited'));
    unwrap(await fGov.update_post(P3, [], 'Carol posts at the root (moderated)'));
    const p3 = (await f.get_post(P3))[0];
    expect(p3.body).toMatch(/moderated/); expect(text(p3.updated_by)).toBe(text(SNEED_GOVERNANCE));
  });

  it('text limits: admins change them and every validator follows', async () => {
    expect(err(await fAlice.update_text_limits(limits({ post_body_max_length: [5n] })))).toMatch(/Unauthorized/);
    unwrap(await f.update_text_limits(limits({ post_body_max_length: [5n], thread_title_max_length: [3n], forum_title_max_length: [4n], topic_description_max_length: [2n] })));
    const l = await f.get_text_limits();
    expect(l.post_body_max_length).toBe(5n); expect(l.thread_title_max_length).toBe(3n); expect(l.post_title_max_length).toBe(200n); // untouched
    expect(err(await fAlice.create_post(TH1, [], [], 'sixsix'))).toMatch(/Body cannot exceed 5 characters/);
    expect(err(await fAlice.create_thread({ topic_id: T1, title: ['four'], body: 'x' }))).toMatch(/Title cannot exceed 3/);
    expect(err(await f.create_forum({ title: 'fives', description: 'x', sns_root_canister_id: [] }))).toMatch(/Title cannot exceed 4/);
    expect(err(await f.create_topic({ forum_id: F1, parent_topic_id: [], title: 'T', description: 'abc' }))).toMatch(/Description cannot exceed 2/);
    expect(err(await fBob.update_post(P2, [], 'sixsix'))).toMatch(/Body cannot exceed 5/); // edits too
    unwrap(await fCarol.update_text_limits(limits({ post_body_max_length: [10000n], thread_title_max_length: [200n], forum_title_max_length: [100n], topic_description_max_length: [1000n] })));
  });

  it('premium: members get the premium body length while their membership lasts, re-checked when the cached expiry passes', async () => {
    const long = 'x'.repeat(15000);
    expect(await f.check_user_premium_status(alice)).toBe(false); // nothing configured
    expect(err(await fAlice.update_premium_config({ sneed_premium_canister_id: [[premiumId]], premium_post_body_max_length: [], premium_thread_body_max_length: [] }))).toMatch(/Unauthorized: Admin access required/);
    unwrap(await f.update_premium_config({ sneed_premium_canister_id: [[premiumId]], premium_post_body_max_length: [20000n], premium_thread_body_max_length: [16000n] }));
    expect(await f.get_premium_config()).toEqual({ sneed_premium_canister_id: [premiumId], premium_post_body_max_length: 20000n, premium_thread_body_max_length: 16000n });
    // not a member
    expect(err(await fAlice.create_post(TH1, [], [], long))).toMatch(/Body cannot exceed 10000/);
    expect(await f.check_user_premium_status(alice)).toBe(false);
    // a member for an hour
    await premium.set_member(alice, (await nowNs(pic)) + HOUR_NS);
    expect(await f.check_user_premium_status(alice)).toBe(true);
    const lp = unwrap(await fAlice.create_post(TH1, [], [], long));
    const lt = unwrap(await fAlice.create_thread({ topic_id: T1, title: ['Long'], body: long }));
    expect(err(await fAlice.create_thread({ topic_id: T1, title: [], body: 'x'.repeat(16001) }))).toMatch(/Body cannot exceed 16000/);
    expect(err(await fAlice.create_post(TH1, [], [], 'x'.repeat(20001)))).toMatch(/Body cannot exceed 20000/);
    unwrap(await fAlice.update_post(lp, [], 'y'.repeat(20000)));
    unwrap(await fAlice.update_thread(lt, ['Long'], 'y'.repeat(16000)));
    expect(err(await fBob.create_post(TH1, [], [], long))).toMatch(/cannot exceed 10000/); // bob is not a member
    // revoked at the premium canister: the forum keeps the cached expiry until it passes (current behaviour)
    await premium.set_member(alice, 1n);
    unwrap(await fAlice.create_post(TH1, [], [], long));
    // the hour passes: the cache is stale, the premium canister says expired
    await pic.advanceTime(2 * 3600 * 1000); await pic.tick(2);
    expect(err(await fAlice.update_post(lp, [], long))).toMatch(/Body cannot exceed 10000/);
    expect(await f.check_user_premium_status(alice)).toBe(false);
    // renewed
    await premium.set_member(alice, (await nowNs(pic)) + 24n * HOUR_NS);
    unwrap(await fAlice.update_post(lp, [], long));
    // switched off: nobody is premium
    unwrap(await f.update_premium_config({ sneed_premium_canister_id: [[]], premium_post_body_max_length: [], premium_thread_body_max_length: [] }));
    expect((await f.get_premium_config()).sneed_premium_canister_id).toEqual([]);
    expect(err(await fAlice.update_post(lp, [], long))).toMatch(/cannot exceed 10000/);
    expect(await f.check_user_premium_status(alice)).toBe(false);
    unwrap(await f.delete_post(lp)); unwrap(await f.delete_thread(lt));
  });

  it('votes: every reachable neuron with voting power votes; changes, partial votes and retraction keep the scores right', async () => {
    await gov1.add_neuron(N_A, alice, [], 1000n, 200n);
    await gov1.add_neuron(N_A2, alice, [], 500n, 200n);
    await gov1.add_neuron(N_B, bob, [dave], 300n, 200n); // dave is a hotkey
    await gov1.add_neuron(N_C0, carol, [], 700n, 0n); // below the minimum dissolve delay: no voting power
    const score = async (id) => { const p = (await f.get_post(id))[0]; return [p.upvote_score, p.downvote_score]; };
    expect(err(await fEve.vote_on_post(P2, { upvote: null }))).toMatch(/Unauthorized: No accessible neurons found/);
    unwrap(await fCarol.vote_on_post(P2, { upvote: null })); // accepted, but her neuron has no power
    expect(await score(P2)).toEqual([0n, 0n]);
    expect(await f.get_post_votes(P2)).toEqual([]);
    unwrap(await fAlice.vote_on_post(P2, { upvote: null }));
    expect(await score(P2)).toEqual([1500n, 0n]);
    const votes = await f.get_post_votes(P2);
    expect(votes.length).toBe(2);
    expect(votes.every((v) => text(v.voter_principal) === text(alice) && 'upvote' in v.vote_type)).toBe(true);
    expect(votes.map((v) => v.voting_power).sort()).toEqual([1000n, 500n].sort());
    unwrap(await fAlice.vote_on_post(P2, { downvote: null })); // changed mind
    expect(await score(P2)).toEqual([0n, 1500n]);
    unwrap(await fDave.vote_on_post(P2, { upvote: null })); // through the hotkey, bob's neuron votes
    expect(await score(P2)).toEqual([300n, 1500n]);
    expect(text((await f.get_post_votes(P2)).find((v) => same(v.neuron_id.id, N_B)).voter_principal)).toBe(text(dave)); // the voter is the hotkey
    unwrap(await fAlice.vote_on_post_with_neurons(P2, { upvote: null }, [NEURON(N_A)])); // one neuron switches back
    expect(await score(P2)).toEqual([1300n, 500n]);
    unwrap(await fAlice.vote_on_post_with_neurons(P2, { downvote: null }, [NEURON(N_B)])); // not alice's neuron: ignored
    expect(await score(P2)).toEqual([1300n, 500n]);
    // the stake grew: a repeated vote updates the power
    await gov1.set_stake(N_A, 2000n);
    unwrap(await fAlice.vote_on_post_with_neurons(P2, { upvote: null }, [NEURON(N_A)]));
    expect(await score(P2)).toEqual([2300n, 500n]);
    // per-neuron queries
    const mine = (await f.get_post_votes_for_neurons(P2, [NEURON(N_A), NEURON(N_A2), NEURON(nid(99))]))[0];
    expect(mine.post_id).toBe(P2);
    expect(mine.neuron_votes.map((v) => [Array.from(v.neuron_id.id)[0], Object.keys(v.vote_type)[0], v.voting_power]).sort()).toEqual([[1, 'upvote', 2000n], [2, 'downvote', 500n]]);
    expect(await f.get_post_votes_for_neurons(99n, [NEURON(N_A)])).toEqual([{ post_id: 99n, neuron_votes: [] }]); // no such post: still an (empty) answer
    const inThread = await f.get_thread_votes_for_neurons(TH1, [NEURON(N_A)]);
    expect(inThread.length).toBe(1); expect(inThread[0].post_id).toBe(P2);
    expect(await f.get_thread_votes_for_neurons(THb, [NEURON(N_A)])).toEqual([]);
    // retracting
    unwrap(await fAlice.retract_vote_with_neurons(P2, [NEURON(N_A)]));
    expect(await score(P2)).toEqual([300n, 500n]);
    expect(err(await fAlice.retract_vote_with_neurons(P2, [NEURON(N_A)]))).toMatch(/NotFound: No votes found to retract/);
    unwrap(await fAlice.retract_vote(P2)); // the rest of hers
    expect(await score(P2)).toEqual([300n, 0n]);
    expect(err(await fAlice.retract_vote(P2))).toMatch(/NotFound: No votes found to retract/);
    expect(err(await fEve.retract_vote(P2))).toMatch(/Unauthorized: No accessible neurons/);
    expect(err(await fEve.retract_vote_with_neurons(P2, [NEURON(N_A)]))).toMatch(/Unauthorized: No accessible neurons/);
    // unknown posts
    expect(err(await fAlice.vote_on_post(99n, { upvote: null }))).toMatch(/InternalError: No SNS governance canister found/);
    expect(err(await fAlice.vote_on_post_with_neurons(99n, { upvote: null }, [NEURON(N_A)]))).toMatch(/NotFound: Post not found/);
    expect(err(await fAlice.retract_vote(99n))).toMatch(/InternalError: No SNS governance canister found/);
    expect(err(await fAlice.retract_vote_with_neurons(99n, []))).toMatch(/NotFound: Post not found/);
    // a governance canister that fails
    await gov1.set_trap(true);
    expect(err(await fAlice.vote_on_post(P2, { upvote: null }))).toMatch(/InternalError: Failed to vote on post with SNS/);
    expect(err(await fAlice.vote_on_post_with_neurons(P2, { upvote: null }, [NEURON(N_A)]))).toMatch(/InternalError: Failed to vote/);
    expect(err(await fAlice.retract_vote(P2))).toMatch(/InternalError: Failed to retract vote with SNS/);
    expect(err(await fAlice.retract_vote_with_neurons(P2, [NEURON(N_A)]))).toMatch(/InternalError: Failed to retract vote/);
    await gov1.set_trap(false);
    expect((await f.get_stats()).total_votes).toBe(1n); // bob's neuron, still up
  });

  it('votes are scoped to the SNS of the post: neurons of another SNS do not count', async () => {
    expect(err(await fAlice.vote_on_post(Pb, { upvote: null }))).toMatch(/No accessible neurons/); // alice has no Beta neurons
    await gov2.add_neuron(N_A_BETA, alice, [], 42n, 200n);
    unwrap(await fAlice.vote_on_post(Pb, { downvote: null }));
    const p = (await f.get_post(Pb))[0];
    expect([p.upvote_score, p.downvote_score]).toEqual([0n, 42n]);
    expect((await f.get_post_votes(Pb)).map((v) => Array.from(v.neuron_id.id)[0])).toEqual([5]);
  });

  let pollT, pollP, pollQ;
  it('polls: the thread or post author opens one per thread/post, validated', async () => {
    const end = (await nowNs(pic)) + 24n * HOUR_NS;
    const ok = (over) => pollInput({ thread_id: TH1, end_timestamp: end, ...over });
    expect(err(await fBob.create_poll(ok()))).toMatch(/Unauthorized: Only the thread creator/);
    expect(err(await fAlice.create_poll(ok({ title: '' })))).toMatch(/Title cannot be empty/);
    expect(err(await fAlice.create_poll(ok({ body: 'x'.repeat(10001) })))).toMatch(/Body cannot exceed 10000/);
    expect(err(await fAlice.create_poll(ok({ options: [{ title: 'only', body: [] }] })))).toMatch(/InvalidInput: Poll must have at least 2 options/);
    expect(err(await fAlice.create_poll(ok({ options: [{ title: 'A', body: [] }, { title: '', body: [] }] })))).toMatch(/Option title cannot be empty/);
    expect(err(await fAlice.create_poll(ok({ options: [{ title: 'A', body: [''] }, { title: 'B', body: [] }] })))).toMatch(/Option body cannot be empty/);
    expect(err(await fAlice.create_poll(ok({ vp_power: [-0.5] })))).toMatch(/VP power cannot be negative/);
    expect(err(await fAlice.create_poll(ok({ end_timestamp: 1n })))).toMatch(/End timestamp must be in the future/);
    expect(err(await fAlice.create_poll(ok({ thread_id: 99n })))).toMatch(/NotFound: Thread not found/);
    expect(err(await fAlice.create_poll(ok({ post_id: [99n] })))).toMatch(/NotFound: Post not found/);
    expect(err(await fAlice.create_poll(ok({ post_id: [Pb] })))).toMatch(/Post does not belong to the specified thread/);
    expect(err(await fAlice.create_poll(ok({ post_id: [P2] })))).toMatch(/Unauthorized: Only the post creator/);
    pollT = unwrap(await fAlice.create_poll(ok()));
    expect(err(await fAlice.create_poll(ok()))).toMatch(/AlreadyExists: A poll already exists for this thread/);
    pollP = unwrap(await fAlice.create_poll(ok({ post_id: [P1], vp_power: [0], allow_vote_changes: [false] })));
    expect(err(await fAlice.create_poll(ok({ post_id: [P1] })))).toMatch(/AlreadyExists: A poll already exists for this post/);
    pollQ = unwrap(await fBob.create_poll(ok({ thread_id: TH2, vp_power: [0.5], end_timestamp: (await nowNs(pic)) + HOUR_NS / 6n })));
    const p = (await fEve.get_poll(pollT))[0];
    expect(p.thread_id).toBe(TH1); expect(p.post_id).toEqual([]); expect(p.vp_power).toBe(1); expect(p.allow_vote_changes).toBe(true);
    expect(p.has_ended).toBe(false); expect(p.end_timestamp).toBe(end); expect(text(p.created_by)).toBe(text(alice));
    expect(p.options.map((o) => [o.id, o.title, o.body, o.vote_count, o.total_voting_power])).toEqual([[0n, 'A', [], 0n, 0n], [1n, 'B', ['bee'], 0n, 0n], [2n, 'C', [], 0n, 0n]]);
    expect(idsOf(await fEve.get_polls_by_thread(TH1))).toEqual([pollT]); // the post poll is listed by post, not by thread
    expect(idsOf(await fEve.get_polls_by_post(P1))).toEqual([pollP]);
    expect(await fEve.get_polls_by_post(P2)).toEqual([]);
    expect(await fEve.get_poll(99n)).toEqual([]);
  });

  it('poll votes: weighted by voting power (or its power, or one per neuron), changeable unless closed, refused after the end; each neuron counts once in vote_count', async () => {
    const opts = async (id) => (await f.get_poll(id))[0].options.map((o) => [o.vote_count, o.total_voting_power]);
    expect(err(await fAlice.vote_on_poll_with_neurons(99n, 0n, [NEURON(N_A)]))).toMatch(/NotFound: Poll not found/);
    expect(err(await fAlice.vote_on_poll_with_neurons(pollT, 7n, [NEURON(N_A)]))).toMatch(/NotFound: Poll option not found/);
    expect(err(await fEve.vote_on_poll_with_neurons(pollT, 0n, [NEURON(N_A)]))).toMatch(/Unauthorized: No accessible neurons/);
    // a first vote counts one per neuron; a changed vote moves its count and power
    unwrap(await fAlice.vote_on_poll_with_neurons(pollT, 0n, [NEURON(N_A), NEURON(N_A2)]));
    expect(await opts(pollT)).toEqual([[2n, 2500n], [0n, 0n], [0n, 0n]]);
    unwrap(await fAlice.vote_on_poll_with_neurons(pollT, 1n, [NEURON(N_A)])); // one neuron moves
    expect(await opts(pollT)).toEqual([[1n, 500n], [1n, 2000n], [0n, 0n]]);
    unwrap(await fAlice.vote_on_poll_with_neurons(pollT, 1n, [NEURON(N_A)])); // same option again: neither count nor power doubles
    expect(await opts(pollT)).toEqual([[1n, 500n], [1n, 2000n], [0n, 0n]]);
    const pv = await f.get_poll_votes(pollT);
    expect(pv.map((v) => [Array.from(v.neuron_id.id)[0], v.option_id, v.voting_power]).sort()).toEqual([[1, 1n, 2000n], [2, 0n, 500n]]);
    expect(pv.every((v) => text(v.voter_principal) === text(alice))).toBe(true);
    // vp_power 0: one per neuron, and no changes
    unwrap(await fAlice.vote_on_poll_with_neurons(pollP, 2n, [NEURON(N_A), NEURON(N_A2)]));
    expect(await opts(pollP)).toEqual([[0n, 0n], [0n, 0n], [2n, 2n]]); // power 1 each, two votes
    expect(err(await fAlice.vote_on_poll_with_neurons(pollP, 0n, [NEURON(N_A)]))).toMatch(/InvalidInput: Vote changes are not allowed/);
    // vp_power 0.5: the square root of 300
    unwrap(await fDave.vote_on_poll_with_neurons(pollQ, 1n, [NEURON(N_B)]));
    expect(await opts(pollQ)).toEqual([[0n, 0n], [1n, 17n], [0n, 0n]]);
    // the end
    await pic.advanceTime(11 * 60 * 1000); await pic.tick(2);
    expect((await f.get_poll(pollQ))[0].has_ended).toBe(true);
    expect(err(await fDave.vote_on_poll_with_neurons(pollQ, 0n, [NEURON(N_B)]))).toMatch(/InvalidInput: Poll has ended/);
  });

  let tipIds;
  it('tips: recorded as claimed (no ledger check), indexed by post, thread, giver and receiver', async () => {
    expect(err(await fAlice.create_tip(bob, 99n, ledger1, 1n, []))).toMatch(/NotFound: Post not found/);
    const t1 = unwrap(await fAlice.create_tip(bob, P2, ledger1, 100n, [5n]));
    const t2 = unwrap(await fCarol.create_tip(bob, P2, ledger1, 50n, []));
    const t3 = unwrap(await fAlice.create_tip(carol, P3, ledger2, 7n, []));
    // anonymous callers are refused; any signed-in caller records any tip to anyone (the recipient need not be the author)
    expect(err(await fAnon.create_tip(eve, P2, ledger2, 1n, []))).toMatch(/Unauthorized: Authentication required to create tips/);
    const t4 = unwrap(await fDave.create_tip(eve, P2, ledger2, 1_000_000n, [123n]));
    tipIds = [t1, t2, t3, t4];
    const t = (await f.get_tip(t1))[0];
    expect([text(t.from_principal), text(t.to_principal), text(t.created_by), t.post_id, t.thread_id, text(t.token_ledger_principal), t.amount, t.transaction_block_index])
      .toEqual([text(alice), text(bob), text(alice), P2, TH1, text(ledger1), 100n, [5n]]);
    expect(await f.get_tip(99n)).toEqual([]);
    expect(idsOf(await f.get_tips_by_post(P2))).toEqual([t1, t2, t4]);
    expect(idsOf(await f.get_tips_by_thread(TH1))).toEqual([t1, t2, t3, t4]);
    expect(await f.get_tips_by_thread(THb)).toEqual([]);
    expect(idsOf(await f.get_tips_given_by_user(alice))).toEqual([t1, t3]);
    expect(idsOf(await f.get_tips_received_by_user(bob))).toEqual([t1, t2]);
    expect(await f.get_tips_given_by_user(user('stranger'))).toEqual([]);
    expect(await f.get_tip_tokens_received_by_user(bob)).toEqual([{ token_ledger_principal: ledger1, total_amount: 150n, tip_count: 2n }]);
    expect(await f.get_tip_tokens_received_by_user(user('stranger'))).toEqual([]);
    const stats = await f.get_tip_stats();
    expect(stats.total_tips).toBe(4n);
    expect(stats.total_tip_amount_by_token.map(([p, a]) => [text(p), a]).sort()).toEqual([[text(ledger1), 150n], [text(ledger2), 1_000_007n]].sort());
  });

  it('tip and reply notifications: counts since the last-seen mark, marks only for known users', async () => {
    expect(idsOf(await f.get_recent_tips_received(bob)).length).toBe(2);
    expect(await f.get_recent_tips_count(bob)).toBe(2n);
    expect(await f.get_last_seen_tip_timestamp(bob)).toEqual([]);
    const latest = (await f.get_tips_received_by_user(bob)).reduce((m, t) => (t.created_at > m ? t.created_at : m), 0n);
    await fBob.mark_tips_seen_up_to(latest);
    expect(await f.get_last_seen_tip_timestamp(bob)).toEqual([latest]);
    expect(await f.get_recent_tips_count(bob)).toBe(0n);
    expect(await f.get_recent_tips_received(bob)).toEqual([]);
    expect(idsOf(await f.get_tips_received_since(bob, 0n)).length).toBe(2);
    expect(await f.get_tips_received_since(bob, latest)).toEqual([]);
    const t5 = unwrap(await fCarol.create_tip(bob, P2, ledger1, 1n, []));
    expect(idsOf(await f.get_recent_tips_received(bob))).toEqual([t5]);
    expect(await f.get_recent_tips_count(user('stranger'))).toBe(0n);
    await actorAs(pic, forumIdl, forumId, user('stranger')).mark_tips_seen_up_to(5n); // unknown principal: no-op
    expect(await f.get_last_seen_tip_timestamp(user('stranger'))).toEqual([]);
    // replies to alice: bob's reply to her post, carol's root post in her thread (not her own posts)
    const replies = idsOf(await f.get_replies_to_user(alice));
    expect(replies).toContain(P2); expect(replies).toContain(P3); expect(replies).not.toContain(P1);
    const all = await f.get_replies_to_user(alice);
    expect(all.every((p, i) => i === 0 || all[i - 1].created_at >= p.created_at)).toBe(true); // newest first
    const n = await f.get_recent_replies_count(alice);
    expect(n).toBe(BigInt(replies.length));
    const newest = all[0].created_at;
    await fAlice.mark_replies_seen_up_to(newest);
    expect(await f.get_last_seen_replies_timestamp(alice)).toEqual([newest]);
    expect(await f.get_recent_replies_count(alice)).toBe(0n);
    const r = unwrap(await fBob.create_post(TH1, [P1], [], 'Another reply'));
    expect(await f.get_recent_replies_count(alice)).toBe(1n);
    expect(await f.get_recent_replies_count(user('stranger'))).toBe(0n);
    expect(await f.get_last_seen_replies_timestamp(user('stranger'))).toEqual([]);
    // by user, newest first
    const bobs = await f.get_posts_by_user(bob);
    expect(idsOf(bobs)[0]).toBe(r);
    expect(idsOf(bobs)).toEqual(expect.arrayContaining([P2, Pb, r]));
    expect(idsOf(await f.get_threads_by_user(bob))).toEqual(expect.arrayContaining([TH2, THb]));
    expect((await f.get_threads_by_user(bob)).every((t) => text(t.created_by) === text(bob))).toBe(true);
    expect(await f.get_posts_by_user(user('stranger'))).toEqual([]);
  });

  it('read tracking: last read post per user and thread, unread counts per thread and topic', async () => {
    const posts = idsOf(await f.get_posts_by_thread(TH1));
    expect(await fEve.get_last_read_post({ thread_id: TH1 })).toEqual({ last_read_post_id: [] });
    let mine = await fEve.get_threads_by_topic_with_unread_counts(T1);
    const th1 = mine.find((t) => t.id === TH1);
    expect(th1.total_posts_count).toEqual([BigInt(posts.length)]); expect(th1.unread_posts_count).toEqual([BigInt(posts.length)]);
    expect(await fEve.set_last_read_post({ thread_id: TH1, last_read_post_id: posts[1] })).toEqual({ success: true, message: 'Last read post updated successfully' });
    expect(await fEve.get_last_read_post({ thread_id: TH1 })).toEqual({ last_read_post_id: [posts[1]] });
    expect(await fDave.get_last_read_post({ thread_id: TH1 })).toEqual({ last_read_post_id: [] }); // per user
    mine = await fEve.get_threads_by_topic_with_unread_counts(T1);
    expect(mine.find((t) => t.id === TH1).unread_posts_count).toEqual([BigInt(posts.length - 2)]);
    const reads = await fEve.get_user_thread_reads_for_topic(T1);
    expect(reads.find(([t]) => t === TH1)).toEqual([TH1, posts[1]]);
    expect(reads.find(([t]) => t === TH2)).toEqual([TH2, 0n]);
    const stats = await fEve.get_topic_statistics(T1);
    const visibleThreads = (await fEve.get_threads_by_topic(T1)).length;
    expect(stats.topic_id).toBe(T1); expect(stats.thread_count).toBe(BigInt(visibleThreads));
    const unreadAll = (await fEve.get_threads_by_topic_with_unread_counts(T1)).filter((t) => !t.deleted).reduce((s, t) => s + t.unread_posts_count[0], 0n);
    expect(stats.total_unread_posts).toBe(unreadAll);
    await fEve.set_last_read_post({ thread_id: TH1, last_read_post_id: posts[posts.length - 1] });
    expect((await fEve.get_threads_by_topic_with_unread_counts(T1)).find((t) => t.id === TH1).unread_posts_count).toEqual([0n]);
    // a deleted post still counts for its author, not for others
    const gone = unwrap(await fBob.create_post(TH1, [], [], 'to be deleted'));
    unwrap(await fBob.delete_post(gone));
    expect((await fBob.get_threads_by_topic_with_unread_counts(T1)).find((t) => t.id === TH1).total_posts_count).toEqual([BigInt(posts.length + 1)]);
    expect((await fEve.get_threads_by_topic_with_unread_counts(T1)).find((t) => t.id === TH1).total_posts_count).toEqual([BigInt(posts.length)]);
  });

  it('soft deletion: admins delete and restore anything, authors delete their posts; non-admins stop seeing deleted items', async () => {
    const th = unwrap(await fBob.create_thread({ topic_id: T1, title: ['Doomed'], body: 'will go' }));
    const p = unwrap(await fBob.create_post(th, [], [], 'doomed post'));
    const reply = unwrap(await fAlice.create_post(th, [p], [], 'reply to doomed'));
    // guards
    for (const [fn, id] of [['delete_forum', F2], ['delete_topic', T2], ['delete_thread', th], ['undelete_forum', F2], ['undelete_topic', T2], ['undelete_thread', th], ['undelete_post', p]]) {
      expect(err(await fBob[fn](id))).toMatch(/Unauthorized/);
    }
    expect(err(await fAlice.delete_post(p))).toMatch(/Unauthorized: Only admins or post owners/);
    expect(err(await fBob.delete_thread(th))).toMatch(/Unauthorized: Admin access required/); // authors may not delete their own thread
    for (const fn of ['delete_forum', 'delete_topic', 'delete_thread', 'delete_post', 'undelete_forum', 'undelete_topic', 'undelete_thread', 'undelete_post']) {
      expect(err(await f[fn](999n))).toMatch(/NotFound/);
    }
    // a post: by its author
    unwrap(await fBob.delete_post(p));
    expect(await fEve.get_post(p)).toEqual([]);
    expect(await f.get_post(p)).toEqual([]); // hidden from admins too in the public getters
    expect((await f.get_post_admin(p))[0].deleted).toBe(true);
    expect(await fEve.get_post_admin(p)).toEqual([]);
    expect(idsOf(await fEve.get_posts_by_thread(th))).toEqual([reply]);
    expect(idsOf(await f.get_posts_by_thread_admin(th))).toEqual([p, reply]);
    expect(await fEve.get_posts_by_thread_admin(th)).toEqual([]);
    expect(idsOf(await fEve.get_post_replies(p))).toEqual([reply]); // replies of a deleted post stay listed
    const feed = await feedAll(f);
    expect(feed.some((i) => i.id === p)).toBe(false);
    expect(feed.find((i) => i.id === reply).replied_to_post).toEqual([]); // the quote of a deleted post is dropped
    unwrap(await fAlice.delete_post(reply));
    expect(await fEve.get_post_replies(p)).toEqual([]);
    expect(idsOf(await f.get_post_replies_admin(p))).toEqual([reply]); // the admin view lists deleted replies
    expect(await fEve.get_post_replies_admin(p)).toEqual([]);
    unwrap(await f.undelete_post(reply));
    unwrap(await f.undelete_post(p));
    expect((await fEve.get_post(p))[0].deleted).toBe(false);
    // a thread
    unwrap(await fCarol.delete_thread(th));
    expect(await fEve.get_thread(th)).toEqual([]);
    expect((await fCarol.get_thread(th))[0].deleted).toBe(true); // admins see deleted items in the normal getters
    expect((await f.get_thread_admin(th))[0].deleted).toBe(true);
    expect(await fEve.get_thread_admin(th)).toEqual([]);
    expect(idsOf(await fEve.get_threads_by_topic(T1))).not.toContain(th);
    expect(idsOf(await f.get_threads_by_topic(T1))).toContain(th);
    expect(idsOf(await f.get_threads_by_topic_admin(T1))).toContain(th);
    expect(await fEve.get_threads_by_topic_admin(T1)).toEqual([]);
    expect(idsOf(await f.get_threads_by_user(bob))).not.toContain(th);
    // the posts of a deleted thread stay readable, but it takes no new posts until undeleted
    expect(idsOf(await fEve.get_posts_by_thread(th))).toContain(p);
    expect(err(await fAlice.create_post(th, [], [], 'posting into a deleted thread'))).toMatch(/InvalidInput: Cannot post in a deleted thread/);
    unwrap(await f.undelete_thread(th));
    unwrap(await fAlice.create_post(th, [], [], 'posting into the restored thread'));
    expect((await fEve.get_thread(th))[0].deleted).toBe(false);
    // a topic
    unwrap(await f.delete_topic(T1a));
    expect(await fEve.get_topic(T1a)).toEqual([]);
    expect(idsOf(await fEve.get_topics_by_forum(F1))).not.toContain(T1a);
    expect(idsOf(await fEve.get_subtopics(T1))).not.toContain(T1a);
    expect(idsOf(await f.get_subtopics(T1))).toContain(T1a);
    expect(idsOf(await f.get_topics_by_forum_admin(F1))).toContain(T1a);
    expect(await fEve.get_topics_by_forum_admin(F1)).toEqual([]);
    expect((await f.get_topic_admin(T1a))[0].deleted).toBe(true);
    expect(await fEve.get_topic_admin(T1a)).toEqual([]);
    unwrap(await f.undelete_topic(T1a));
    // a forum
    unwrap(await fGov.delete_forum(F3));
    expect(await fEve.get_forum(F3)).toEqual([]);
    expect(idsOf(await fEve.get_forums())).toEqual([F1, F2]);
    expect(idsOf(await f.get_forums())).toEqual([F3, F1, F2]);
    expect(idsOf(await f.get_forums_admin())).toEqual([F3, F1, F2]);
    expect(await fEve.get_forums_admin()).toEqual([]);
    expect((await f.get_forum_admin(F3))[0].deleted).toBe(true);
    expect(await fEve.get_forum_admin(F3)).toEqual([]);
    expect(await f.get_forum_by_sns_root(rootX)).toEqual([]); // deleted forums are not found by root
    unwrap(await f.undelete_forum(F3));
    expect((await f.get_forum_by_sns_root(rootX))[0].id).toBe(F3);
    const restored = (await f.get_forum(F3))[0];
    expect(restored.deleted).toBe(false); expect(text(restored.updated_by)).toBe(text(admin));
  });

  let propThread;
  it('proposal threads: admins pick the proposals topic; anyone then opens the one thread per proposal', async () => {
    const proposals = unwrap(await f.create_topic({ forum_id: F1, parent_topic_id: [], title: 'Proposals', description: 'One thread each' }));
    expect(err(await fAlice.set_proposals_topic({ forum_id: F1, topic_id: proposals }))).toMatch(/Unauthorized/);
    expect(err(await f.set_proposals_topic({ forum_id: 99n, topic_id: proposals }))).toMatch(/NotFound: Forum not found/);
    expect(err(await f.set_proposals_topic({ forum_id: F1, topic_id: 99n }))).toMatch(/NotFound: Topic not found/);
    expect(err(await f.set_proposals_topic({ forum_id: F1, topic_id: T2 }))).toMatch(/InvalidInput: Topic must belong to the specified forum/);
    expect(err(await fAlice.create_proposal_thread({ proposal_id: 42n, sns_root_canister_id: SNEED_SNS_ROOT }))).toMatch(/InvalidInput: No proposals topic set/);
    unwrap(await fCarol.set_proposals_topic({ forum_id: F1, topic_id: proposals }));
    const mapping = (await f.get_proposals_topic(F1))[0];
    expect(mapping.forum_id).toBe(F1); expect(mapping.proposals_topic_id).toBe(proposals); expect(text(mapping.set_by)).toBe(text(carol));
    expect(await f.get_proposals_topic_by_sns_root(SNEED_SNS_ROOT)).toEqual([mapping]);
    expect(await f.get_proposals_topic(F2)).toEqual([]);
    expect(await f.get_proposals_topic_by_sns_root(root3)).toEqual([]);
    // anonymous callers are refused; any signed-in caller opens a proposal's thread (the proposal id is not checked)
    expect(err(await fAnon.create_proposal_thread({ proposal_id: 42n, sns_root_canister_id: SNEED_SNS_ROOT }))).toMatch(/Unauthorized: Authentication required to create proposal threads/);
    propThread = unwrap(await fBob.create_proposal_thread({ proposal_id: 42n, sns_root_canister_id: SNEED_SNS_ROOT }));
    const t = (await f.get_thread(propThread))[0];
    expect(t.topic_id).toBe(proposals); expect(t.title).toEqual(['Sneed Proposal #42']); expect(t.body).toBe('Discussion thread for Sneed Proposal #42');
    expect(err(await fAlice.create_proposal_thread({ proposal_id: 42n, sns_root_canister_id: SNEED_SNS_ROOT }))).toMatch(/AlreadyExists: Thread for this proposal already exists/);
    expect(err(await fAlice.create_proposal_thread({ proposal_id: 1n, sns_root_canister_id: root3 }))).toMatch(/NotFound: No forum found for this SNS/);
    const pt = (await f.get_proposal_thread(SNEED_SNS_ROOT, 42n))[0];
    expect(pt.thread_id).toBe(propThread); expect(pt.proposal_id).toBe(42n); expect(text(pt.sns_root_canister_id)).toBe(text(SNEED_SNS_ROOT)); expect(text(pt.created_by)).toBe(text(bob));
    expect(await f.get_proposal_thread(SNEED_SNS_ROOT, 43n)).toEqual([]);
    expect(await f.get_proposal_thread(user('never-seen'), 42n)).toEqual([]);
    const tp = await f.get_thread_proposal_id(propThread);
    expect(tp.length).toBe(1); expect(tp[0][1]).toBe(42n); expect(typeof tp[0][0]).toBe('number');
    expect(await f.get_thread_proposal_id(TH1)).toEqual([]);
    // removal
    expect(err(await fAlice.remove_proposals_topic(F1))).toMatch(/Unauthorized/);
    unwrap(await f.remove_proposals_topic(F1));
    expect(err(await f.remove_proposals_topic(F1))).toMatch(/NotFound: No proposals topic set for this forum/);
    expect(await f.get_proposals_topic(F1)).toEqual([]);
    expect((await f.get_proposal_thread(SNEED_SNS_ROOT, 42n))[0].thread_id).toBe(propThread); // the thread mapping stays
    unwrap(await f.set_proposals_topic({ forum_id: F1, topic_id: proposals }));
  });

  it('SNS setup: a forum, Governance and Proposals topics for any SNS that SNS-W lists, idempotent, named from its metadata', async () => {
    expect(err(await fAlice.create_sns_forum_setup(rootX))).toMatch(/NotFound: SNS governance canister not found/); // F3's root is not on SNS-W
    const before = (await f.get_stats()).total_forums;
    expect(err(await fAnon.create_sns_forum_setup(root3))).toMatch(/Unauthorized: Authentication required/);
    const proposals = unwrap(await fEve.create_sns_forum_setup(root3)); // anyone signed in may trigger it
    expect(unwrap(await fEve.create_sns_forum_setup(root3))).toBe(proposals);
    expect((await f.get_stats()).total_forums).toBe(before + 1n);
    const forum = (await f.get_forum_by_sns_root(root3))[0];
    expect(forum.title).toBe('Beta Forum'); expect(forum.description).toBe('Discussion forum for Beta governance and community topics');
    expect(text(forum.created_by)).toBe(text(eve));
    const topics = await f.get_topics_by_forum(forum.id);
    expect(topics.map((t) => t.title)).toEqual(['Governance', 'Proposals']);
    expect(topics[1].parent_topic_id).toEqual([topics[0].id]); expect(topics[1].id).toBe(proposals);
    expect((await f.get_proposals_topic(forum.id))[0].proposals_topic_id).toBe(proposals);
    // no SNS name: "SNS <root>"
    unwrap(await fEve.create_sns_forum_setup(root4));
    expect((await f.get_forum_by_sns_root(root4))[0].title).toBe(`SNS ${root4.toText()} Forum`);
    // auto setup on the existing Beta forum (root2), then the thread
    const th = unwrap(await fAlice.create_proposal_thread_with_auto_setup({ proposal_id: 7n, sns_root_canister_id: root2 }));
    const t = (await f.get_thread(th))[0];
    expect(t.title).toEqual(['Beta DAO Proposal #7']);
    expect((await f.get_topic(t.topic_id))[0].title).toBe('Proposals');
    expect((await f.get_topic(t.topic_id))[0].forum_id).toBe(F2);
    expect(err(await fAlice.create_proposal_thread_with_auto_setup({ proposal_id: 7n, sns_root_canister_id: root2 }))).toMatch(/AlreadyExists/);
    const th8 = unwrap(await fAlice.create_proposal_thread_with_auto_setup({ proposal_id: 8n, sns_root_canister_id: root2 })); // structure exists: reused
    expect((await f.get_thread(th8))[0].topic_id).toBe(t.topic_id);
    expect(err(await fAlice.create_proposal_thread_with_auto_setup({ proposal_id: 1n, sns_root_canister_id: user('unknown-root') }))).toMatch(/NotFound: SNS governance canister not found/);
    // proposal threads are per SNS: the same id on another SNS is a different thread
    const sneed7 = unwrap(await fAlice.create_proposal_thread_with_auto_setup({ proposal_id: 7n, sns_root_canister_id: SNEED_SNS_ROOT }));
    expect(sneed7).not.toBe(th);
    expect((await f.get_proposal_thread(root2, 7n))[0].thread_id).toBe(th);
  });

  it('special topics: General, Governance and Preproposals once each per SNS forum (current behaviour: no admin check, but signed-in callers only)', async () => {
    expect(err(await fAnon.create_special_topic({ sns_root_canister_id: root2, special_topic_type: { General: null } }))).toMatch(/Unauthorized: Authentication required to create special topics/);
    expect(err(await fAlice.create_special_topic({ sns_root_canister_id: user('unknown-root'), special_topic_type: { General: null } }))).toMatch(/NotFound: Forum not found for this SNS/);
    const general = unwrap(await fAlice.create_special_topic({ sns_root_canister_id: root2, special_topic_type: { General: null } }));
    const g = (await f.get_topic(general))[0];
    expect([g.title, g.description, g.forum_id, g.parent_topic_id]).toEqual(['General', 'General discussion topics for the community', F2, []]);
    expect(err(await fAlice.create_special_topic({ sns_root_canister_id: root2, special_topic_type: { General: null } }))).toMatch(/AlreadyExists: General topic already exists/);
    expect(err(await fAlice.create_special_topic({ sns_root_canister_id: root2, special_topic_type: { Governance: null } }))).toMatch(/AlreadyExists: Governance topic already exists/); // from the auto setup
    const pre = unwrap(await fAlice.create_special_topic({ sns_root_canister_id: root2, special_topic_type: { Preproposals: null } }));
    const gov = (await f.get_topics_by_forum(F2)).find((t) => t.title === 'Governance' && t.parent_topic_id.length === 0);
    expect((await f.get_topic(pre))[0].parent_topic_id).toEqual([gov.id]);
    expect(err(await fAlice.create_special_topic({ sns_root_canister_id: root2, special_topic_type: { Preproposals: null } }))).toMatch(/AlreadyExists: Preproposals/);
    // a forum without Governance: Preproposals creates it first
    const pre4 = unwrap(await f.create_special_topic({ sns_root_canister_id: rootX, special_topic_type: { Preproposals: null } }));
    const parent = (await f.get_topic(pre4))[0].parent_topic_id[0];
    expect((await f.get_topic(parent))[0].title).toBe('Governance');
    unwrap(await f.create_special_topic({ sns_root_canister_id: SNEED_SNS_ROOT, special_topic_type: { Governance: null } }));
  });

  it('feed: newest first across forums, topics, threads and posts, paged without gaps, filtered by SNS, topic, creator and text', async () => {
    unwrap(await fBob.create_post(TH1, [P2], ['Zoo'], 'A ZEBRA appears'));
    const page = await fEve.get_feed({ start_id: [], length: 3n, filter: [] });
    expect(page.items.length).toBe(3); expect(page.has_more).toBe(true);
    expect(page.next_start_id[0]).toBeLessThan(page.items[2].id);
    expect(page.items[0].id).toBe((await f.get_current_counter()) - 1n); // the newest thing
    const all = await feedAll(fEve);
    const ids = idsOf(all);
    expect(ids.every((id, i) => i === 0 || ids[i - 1] > id)).toBe(true); // strictly descending, no repeats across pages
    const s = await f.get_stats();
    // every live forum, topic, thread and post (deleted ones excluded; polls and tips take ids but are not items)
    const kinds = all.reduce((m, i) => ({ ...m, [Object.keys(i.item_type)[0]]: (m[Object.keys(i.item_type)[0]] || 0) + 1 }), {});
    expect(BigInt(kinds.forum)).toBe(s.total_forums);
    expect(BigInt(kinds.topic)).toBe(s.total_topics - 3n); // the three deleted re-parenting topics are left out
    expect(kinds.thread + kinds.post).toBeLessThan(Number(s.total_threads + s.total_posts)); // deleted ones left out
    expect(ids).not.toContain(tipIds[0]); expect(ids).not.toContain(pollT);
    // the post item carries its context
    const zebra = all.find((i) => i.body[0] === 'A ZEBRA appears');
    expect([zebra.thread_id, zebra.topic_id, zebra.forum_id, zebra.thread_title, zebra.forum_title]).toEqual([[TH1], [T1], [F1], ['Hello'], ['Sneed']]);
    expect(zebra.replied_to_post[0].id).toBe(P2);
    expect(text(zebra.sns_root_canister_id[0])).toBe(text(SNEED_SNS_ROOT));
    expect(all.find((i) => i.id === TH1).poll_id).toEqual([pollT]);
    expect(all.find((i) => i.id === P1).poll_id).toEqual([pollP]);
    const forumItem = all.find((i) => i.id === F1);
    expect([forumItem.forum_id, forumItem.topic_id, forumItem.title]).toEqual([[], [], ['Sneed']]);
    // filters
    const filter = (over) => [{ sns_root_canister_ids: [], topic_ids: [], creator_principals: [], search_text: [], ...over }];
    const beta = await feedAll(fEve, filter({ sns_root_canister_ids: [[root2]] }), 1000n);
    expect(beta.length).toBeGreaterThan(0);
    expect(beta.every((i) => text(i.sns_root_canister_id[0]) === text(root2))).toBe(true);
    expect(idsOf(beta)).toEqual(expect.arrayContaining([F2, T2, THb, Pb]));
    const inT1 = await feedAll(fEve, filter({ topic_ids: [[T1]] }), 1000n);
    expect(inT1.every((i) => i.topic_id[0] === T1)).toBe(true);
    expect(idsOf(inT1)).toEqual(expect.arrayContaining([TH1, P1, P2]));
    expect(idsOf(inT1)).not.toContain(T1); // a topic item has no topic_id of its own
    const bobs = await feedAll(fEve, filter({ creator_principals: [[bob]] }), 1000n);
    expect(bobs.every((i) => text(i.created_by) === text(bob))).toBe(true);
    const found = await feedAll(fEve, filter({ search_text: ['zEbRa'] }), 1000n);
    expect(found.map((i) => i.body[0])).toEqual(['A ZEBRA appears']);
    expect(idsOf(await feedAll(fEve, filter({ search_text: ['zoo'] }), 1000n))).toEqual(idsOf(found)); // titles too
    expect(await feedAll(fEve, filter({ search_text: ['no such words anywhere'] }), 1000n)).toEqual([]);
    // an explicit start id is inclusive
    expect((await fEve.get_feed({ start_id: [P2], length: 1n, filter: [] })).items[0].id).toBe(P2);
  });

  it('a filtered feed page that runs out of checks still reports more, continuing where scanning stopped', async () => {
    // get_feed checks at most length * 10 ids per page; if they run out before the page fills it answers
    // has_more = true with the next id to scan, so a client paging small pages finds every older match
    const filter = [{ sns_root_canister_ids: [[root2]], topic_ids: [], creator_principals: [], search_text: [] }];
    const complete = idsOf(await feedAll(fEve, filter, 1000n));
    expect(complete).toContain(F2); // the Beta forum, one of the oldest ids
    const paged = idsOf(await feedAll(fEve, filter, 1n));
    expect(paged).toEqual(complete);
    // the end of the ids reports no more
    const last = await fEve.get_feed({ start_id: [1n], length: 1n, filter: [] });
    expect(last.has_more).toBe(false); expect(last.next_start_id).toEqual([]);
    expect((await fEve.get_feed({ start_id: [], length: 0n, filter })).has_more).toBe(false); // an empty page never loops
  });

  it('threads by activity: ordered by the newest post, paged, deleted threads for admins only, optionally with unread counts', async () => {
    const quiet = unwrap(await fAlice.create_thread({ topic_id: T1, title: ['Quiet'], body: 'no posts here' }));
    const busy = unwrap(await fAlice.create_thread({ topic_id: T1, title: ['Busy'], body: 'posts soon' }));
    const latest = unwrap(await fDave.create_post(busy, [], [], 'newest post anywhere in T1'));
    const newestFirst = await fEve.get_threads_by_activity(T1, [], 100n, true);
    expect(newestFirst.has_more).toBe(false); expect(newestFirst.next_start_from).toEqual([]);
    expect(newestFirst.threads[0].id).toBe(busy);
    expect(newestFirst.threads[newestFirst.threads.length - 1].id).toBe(quiet); // no posts: activity 0, last
    const oldestFirst = await fEve.get_threads_by_activity(T1, [], 100n, false);
    expect(oldestFirst.threads[0].id).not.toBe(busy);
    expect(oldestFirst.threads[oldestFirst.threads.length - 1].id).toBe(busy);
    expect(oldestFirst.threads.map((t) => t.id).sort()).toEqual(newestFirst.threads.map((t) => t.id).sort());
    // paging one at a time walks the same order
    const walked = []; let from = [];
    for (;;) { const r = await fEve.get_threads_by_activity(T1, from, 1n, true); walked.push(...idsOf(r.threads)); if (!r.has_more) break; from = r.next_start_from; }
    expect(walked).toEqual(idsOf(newestFirst.threads));
    expect((await fEve.get_threads_by_activity(T1, [999n], 5n, true)).threads).toEqual([]);
    expect(await fEve.get_threads_by_activity(99n, [], 5n, true)).toEqual({ threads: [], has_more: false, next_start_from: [] });
    // deleted threads
    unwrap(await f.delete_thread(quiet));
    expect(idsOf((await fEve.get_threads_by_activity(T1, [], 100n, true)).threads)).not.toContain(quiet);
    expect(idsOf((await f.get_threads_by_activity(T1, [], 100n, true)).threads)).toContain(quiet);
    // with unread counts
    const counted = await fEve.get_threads_by_activity_with_unread_counts(T1, [], 100n, true);
    expect(idsOf(counted.threads)).toEqual(idsOf((await fEve.get_threads_by_activity(T1, [], 100n, true)).threads));
    expect(counted.threads[0].total_posts_count).toEqual([1n]); expect(counted.threads[0].unread_posts_count).toEqual([1n]);
    await fEve.set_last_read_post({ thread_id: busy, last_read_post_id: latest });
    expect((await fEve.get_threads_by_activity_with_unread_counts(T1, [], 1n, true)).threads[0].unread_posts_count).toEqual([0n]);
    expect(idsOf((await f.get_threads_by_activity_with_unread_counts(T1, [], 100n, true)).threads)).toContain(quiet);
  });

  it('one counter for everything: each creation takes the next id, failures take none, and the stats add up', async () => {
    const c0 = await f.get_current_counter();
    expect(err(await fAlice.create_post(TH1, [], [], ''))).toMatch(/empty/);
    expect(await f.get_current_counter()).toBe(c0);
    const p = unwrap(await fAlice.create_post(TH1, [], [], 'count me'));
    const t = unwrap(await fAlice.create_tip(bob, p, ledger1, 1n, []));
    const th = unwrap(await fAlice.create_thread({ topic_id: T1, title: [], body: 'count me too' }));
    const poll = unwrap(await fAlice.create_poll(pollInput({ thread_id: th, end_timestamp: (await nowNs(pic)) + HOUR_NS })));
    expect([p, t, th, poll]).toEqual([c0, c0 + 1n, c0 + 2n, c0 + 3n]);
    expect(await f.get_current_counter()).toBe(c0 + 4n);
    const s = await f.get_stats();
    expect(s.total_forums).toBe(BigInt((await f.get_forums_admin()).length));
    expect(s.total_votes).toBe(BigInt((await f.get_post_votes(P2)).length + (await f.get_post_votes(Pb)).length));
  });

  it('keeps everything across an upgrade: content, votes, polls, tips, admins, limits, premium settings, reads and the counter', async () => {
    unwrap(await f.update_text_limits(limits({ post_title_max_length: [150n] })));
    unwrap(await f.update_premium_config({ sneed_premium_canister_id: [[premiumId]], premium_post_body_max_length: [30000n], premium_thread_body_max_length: [] }));
    const snapshot = async () => ({
      forums: await f.get_forums_admin(), topics: await f.get_topics_by_forum_admin(F1), threads: await f.get_threads_by_topic_admin(T1),
      posts: await f.get_posts_by_thread_admin(TH1), votes: await f.get_post_votes(P2), poll: await f.get_poll(pollT), pollVotes: await f.get_poll_votes(pollT),
      tips: await f.get_tips_by_thread(TH1), tipStats: await f.get_tip_stats(), admins: await f.get_admins(), limits: await f.get_text_limits(),
      premium: await f.get_premium_config(), stats: await f.get_stats(), counter: await f.get_current_counter(),
      read: await fEve.get_last_read_post({ thread_id: TH1 }), seenTips: await f.get_last_seen_tip_timestamp(bob), seenReplies: await f.get_last_seen_replies_timestamp(alice),
      proposal: await f.get_proposal_thread(SNEED_SNS_ROOT, 42n), proposalsTopic: await f.get_proposals_topic(F1), feed: (await f.get_feed({ start_id: [], length: 20n, filter: [] })).items,
    });
    const before = await snapshot();
    await pic.upgradeCanister({ sender: admin, canisterId: forumId, wasm: wasm('sneed_sns_forum'), arg: IDL.encode([], []), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    const after = await snapshot();
    // poll.has_ended is computed from the clock; everything else must be identical
    expect(after).toEqual(before);
    expect(after.limits.post_title_max_length).toBe(150n);
    expect(after.premium.premium_post_body_max_length).toBe(30000n);
    // the SNS cache is rebuilt after the upgrade: posting and voting still work, the counter continues
    const p = unwrap(await fBob.create_post(TH1, [], [], 'after the upgrade'));
    expect(p).toBe(before.counter);
    unwrap(await fAlice.vote_on_post(p, { upvote: null }));
    expect((await f.get_post(p))[0].upvote_score).toBe(2500n);
    expect(await f.is_admin(carol)).toBe(true);
  });
});
