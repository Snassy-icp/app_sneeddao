// sneed_sns_forum bug pass (with the reactions work, spec/pipeline.md): each case failed on the
// production code (proposal #469) and passes on the fix.
//   FORUM_WASM=sneed_sns_forum_p469 npx vitest run tests/forum-bugpass.test.js   runs it against production.
//   1. get_threads_by_topic_with_unread_counts listed deleted threads (title and body) to everyone
//   2. threads could be created in a deleted topic (and showed in the feed)
//   3. authors could edit their deleted posts and threads (and every edit sent mention notices)
//   4. votes on deleted posts, and on posts of deleted threads, were counted
//   5. a poll's vp_power could be NaN or huge, so that every vote on it trapped (inf to Int)
//   6. set_last_read_post stored marks for the anonymous principal and for threads that do not exist
//   7. replies to deleted posts were accepted (and notified the deleted post's author)
//   8. tips could be recorded on deleted posts
//   9. get_feed listed the posts of a deleted thread, with the deleted thread's title
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, SNEED_SNS_ROOT, ICP_LEDGER_ID, unwrap, errOf, nowNs } from '../lib/pic.js';
import { idlFactory as forumIdl } from '../build/sneed_sns_forum.did.js';

const FORUM_WASM = process.env.FORUM_WASM || 'sneed_sns_forum';
const SNS_W = Principal.fromText('qaa6y-5yaaa-aaaaa-aaafa-cai');
const anon = Principal.anonymous();
const eve = user('eve');
const rateLimitIdl = ({ IDL: I }) => I.Service({ admin_set_rate_limit: I.Func([I.Text, I.Opt(I.Record({ capacity: I.Nat, per_minute: I.Nat }))], [I.Variant({ ok: I.Null, err: I.Reserved })], []) });
const directoryIdl = ({ IDL: I }) => I.Service({ set_instances: I.Func([I.Vec(I.Tuple(I.Principal, I.Principal))], [], []) });
const neuronsIdl = ({ IDL: I }) => I.Service({ add_neuron: I.Func([I.Vec(I.Nat8), I.Principal, I.Vec(I.Principal), I.Nat64, I.Nat64], [], []) });
const isErr = (r) => 'err' in r;

let pic, f, fas, F, TOP;
const thread = async (who, title = 't') => unwrap(await fas(who).create_thread({ topic_id: TOP, title: [title], body: 'body' }));

describe(`sneed_sns_forum bug pass (${FORUM_WASM})`, () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    await install(pic, { name: 'MockForumSnsW', targetCanisterId: SNS_W });
    const govId = await install(pic, { name: 'MockForumGovernance' });
    await install(pic, { name: 'MockIcpLedger', targetCanisterId: ICP_LEDGER_ID });
    await actorAs(pic, directoryIdl, SNS_W, admin).set_instances([[SNEED_SNS_ROOT, govId]]);
    await actorAs(pic, neuronsIdl, govId, admin).add_neuron(new Uint8Array(32).fill(1), alice, [], 1000n, 200n);
    const id = await install(pic, { name: FORUM_WASM });
    for (const a of ['thread', 'post', 'edit', 'poll', 'tip', 'vote']) await actorAs(pic, rateLimitIdl, id, admin).admin_set_rate_limit(a, [{ capacity: 0n, per_minute: 0n }]);
    f = actorAs(pic, forumIdl, id, admin);
    fas = (p) => actorAs(pic, forumIdl, id, p);
    F = unwrap(await f.create_forum({ title: 'Sneed', description: 'd', sns_root_canister_id: [] }));
    TOP = unwrap(await f.create_topic({ forum_id: F, parent_topic_id: [], title: 'General', description: 'g' }));
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('1. deleted threads are not listed with unread counts to non-admins (admins still see them)', async () => {
    const t = await thread(alice, 'spam');
    unwrap(await f.delete_thread(t));
    expect((await fas(eve).get_threads_by_topic_with_unread_counts(TOP)).map((x) => x.id)).not.toContain(t);
    expect((await f.get_threads_by_topic_with_unread_counts(TOP)).map((x) => x.id)).toContain(t);
  });

  it('2. no new threads in a deleted topic', async () => {
    const closed = unwrap(await f.create_topic({ forum_id: F, parent_topic_id: [], title: 'Closed', description: 'c' }));
    unwrap(await f.delete_topic(closed));
    const r = await fas(bob).create_thread({ topic_id: closed, title: ['sneaky'], body: 'b' });
    expect(isErr(r)).toBe(true);
  });

  it('3. authors cannot edit their deleted posts or threads; admins can', async () => {
    const t = await thread(bob);
    const p = unwrap(await fas(bob).create_post(t, [], [], 'spam'));
    unwrap(await f.delete_post(p));
    expect(isErr(await fas(bob).update_post(p, [], 'edited spam'))).toBe(true);
    unwrap(await f.update_post(p, [], 'moderated'));
    unwrap(await f.delete_thread(t));
    expect(isErr(await fas(bob).update_thread(t, ['x'], 'edited'))).toBe(true);
  });

  it('4. votes on deleted posts and on posts of deleted threads are refused', async () => {
    const t = await thread(bob);
    const p = unwrap(await fas(bob).create_post(t, [], [], 'p'));
    const q = unwrap(await fas(bob).create_post(t, [], [], 'q'));
    unwrap(await f.delete_post(p));
    expect(isErr(await fas(alice).vote_on_post(p, { upvote: null }))).toBe(true);
    expect((await f.get_post_admin(p))[0].upvote_score).toBe(0n);
    unwrap(await f.delete_thread(t));
    expect(isErr(await fas(alice).vote_on_post(q, { upvote: null }))).toBe(true);
    expect((await f.get_post_admin(q))[0].upvote_score).toBe(0n);
  });

  it('5. a poll vp_power that would make votes trap (NaN, huge) is refused', async () => {
    const t = await thread(alice);
    const end = (await nowNs(pic)) + 3_600_000_000_000n;
    const make = (vp) => fas(alice).create_poll({ thread_id: t, post_id: [], title: 'Q', body: 'b', options: [{ title: 'A', body: [] }, { title: 'B', body: [] }],
      vp_power: [vp], end_timestamp: end, allow_vote_changes: [] });
    expect(errOf(await make(50))).toHaveProperty('InvalidInput');
    expect(errOf(await make(NaN))).toHaveProperty('InvalidInput');
    const ok = unwrap(await make(2));
    unwrap(await fas(alice).vote_on_poll_with_neurons(ok, 0n, [{ id: new Uint8Array(32).fill(1) }]));
    expect((await f.get_poll(ok))[0].options[0].total_voting_power).toBe(1_000_000n);
  });

  it('6. read marks only for signed-in members and existing threads', async () => {
    expect((await fas(anon).set_last_read_post({ thread_id: 10n ** 12n, last_read_post_id: 1n })).success).toBe(false);
    expect((await fas(alice).set_last_read_post({ thread_id: 10n ** 12n, last_read_post_id: 1n })).success).toBe(false);
    const t = await thread(alice);
    expect((await fas(anon).set_last_read_post({ thread_id: t, last_read_post_id: 1n })).success).toBe(false);
    expect((await fas(alice).set_last_read_post({ thread_id: t, last_read_post_id: 1n })).success).toBe(true);
  });

  it('7. no replies to deleted posts', async () => {
    const t = await thread(alice);
    const p = unwrap(await fas(bob).create_post(t, [], [], 'p'));
    unwrap(await f.delete_post(p));
    expect(isErr(await fas(carol).create_post(t, [p], [], 'reply to the void'))).toBe(true);
  });

  it('8. no tips on deleted posts', async () => {
    const t = await thread(alice);
    const p = unwrap(await fas(bob).create_post(t, [], [], 'p'));
    unwrap(await f.delete_post(p));
    expect(isErr(await fas(alice).create_tip(bob, p, ICP_LEDGER_ID, 1n, []))).toBe(true);
  });

  it('9. the feed leaves out the posts of a deleted thread', async () => {
    const t = await thread(alice, 'secret title');
    const p = unwrap(await fas(bob).create_post(t, [], [], 'p'));
    unwrap(await f.delete_thread(t));
    const items = [];
    let start = [];
    for (let k = 0; k < 50; k++) {
      const r = await f.get_feed({ start_id: start, length: 50n, filter: [] });
      items.push(...r.items);
      if (!r.has_more) break;
      start = r.next_start_id;
    }
    expect(items.map((i) => i.id)).not.toContain(p);
    expect(items.some((i) => i.thread_title?.[0] === 'secret title')).toBe(false);
  });
});
