// sneed_sns_forum "Hot" thread order (get_threads_by_hot): score = (thread votes + first post's votes
// + replies / 2 + 1) / (hours since last activity + 2)^1.5, net voting power counted as
// sign * log10(1 + |net| / 1e8). Ordering, paging and the page cap; the activity order is unchanged
// (forum.test.js and forum-paging.test.js keep testing it).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, SNEED_SNS_ROOT, unwrap } from '../lib/pic.js';
import { idlFactory as forumIdl } from '../build/sneed_sns_forum.did.js';

const SNS_W = Principal.fromText('qaa6y-5yaaa-aaaaa-aaafa-cai');
const HOUR = 3_600_000; // ms
const rateLimitIdl = ({ IDL: I }) => I.Service({ admin_set_rate_limit: I.Func([I.Text, I.Opt(I.Record({ capacity: I.Nat, per_minute: I.Nat }))], [I.Variant({ ok: I.Null, err: I.Reserved })], []) });
const directoryIdl = ({ IDL: I }) => I.Service({ set_instances: I.Func([I.Vec(I.Tuple(I.Principal, I.Principal))], [], []) });
const govIdl = ({ IDL: I }) => I.Service({ add_neurons: I.Func([I.Nat8, I.Nat, I.Principal, I.Nat64, I.Nat64], [], []) });
const nid = (prefix, i) => { const b = new Uint8Array(32); b[0] = prefix; b[1] = i >> 8; b[2] = i & 255; return { id: b }; };
const WHALE = nid(1, 0); // 1,000 tokens: one vote counts log10(1001) ≈ 3
const SMALL = nid(2, 0); // 1 token: ≈ 0.3

let pic, f, fas, F;
const topic = async (title) => unwrap(await f.create_topic({ forum_id: F, parent_topic_id: [], title, description: 'd' }));
const thread = async (top, title) => unwrap(await fas(bob).create_thread({ topic_id: top, title: [title], body: 'b' }));
const hot = async (top, start = [], length = 100n, reverse = true) => fas(bob).get_threads_by_hot(top, start, length, reverse);
const hotTitles = async (top) => (await hot(top)).threads.map((t) => t.title[0]);

describe('sneed_sns_forum hot order', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    await install(pic, { name: 'MockForumSnsW', targetCanisterId: SNS_W });
    const govId = await install(pic, { name: 'MockForumGovernance' });
    await actorAs(pic, directoryIdl, SNS_W, admin).set_instances([[SNEED_SNS_ROOT, govId]]);
    await actorAs(pic, govIdl, govId, admin).add_neurons(1, 1n, alice, 100_000_000_000n, 200n);
    await actorAs(pic, govIdl, govId, admin).add_neurons(2, 1n, bob, 100_000_000n, 200n);
    const id = await install(pic, { name: 'sneed_sns_forum' });
    for (const a of ['thread', 'post', 'edit', 'poll', 'tip', 'vote']) await actorAs(pic, rateLimitIdl, id, admin).admin_set_rate_limit(a, [{ capacity: 0n, per_minute: 0n }]);
    f = actorAs(pic, forumIdl, id, admin);
    fas = (p) => actorAs(pic, forumIdl, id, p);
    F = unwrap(await f.create_forum({ title: 'Sneed', description: 'd', sns_root_canister_id: [SNEED_SNS_ROOT] }));
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('a fresh thread without replies beats an old voted thread', async () => {
    const top = await topic('fresh vs old');
    const old = await thread(top, 'old');
    unwrap(await fas(alice).vote_on_thread_with_neurons(old, { upvote: null }, [WHALE]));
    for (let k = 0; k < 3; k++) unwrap(await fas(alice).create_post(old, [], [], `reply ${k}`));
    await pic.advanceTime(48 * HOUR);
    await thread(top, 'fresh');
    expect(await hotTitles(top)).toEqual(['fresh', 'old']);
  });

  it('votes lift a thread: on the thread, on its first post, and a whale only by the log of its power', async () => {
    const top = await topic('votes');
    const plain = await thread(top, 'plain');
    const voted = await thread(top, 'voted');
    const firstPostVoted = await thread(top, 'first post voted');
    expect(await hotTitles(top)).toEqual(['first post voted', 'voted', 'plain']); // equal scores: newer first
    unwrap(await fas(bob).vote_on_thread_with_neurons(voted, { upvote: null }, [SMALL]));
    const p = unwrap(await fas(bob).create_post(firstPostVoted, [], [], 'first'));
    unwrap(await fas(alice).create_post(plain, [], [], 'a reply'));
    unwrap(await fas(alice).create_post(voted, [], [], 'a reply'));
    unwrap(await fas(alice).vote_on_post_with_neurons(p, { upvote: null }, [WHALE]));
    // first post voted: 3 + 0.5 + 1; voted: 0.3 + 0.5 + 1; plain: 0.5 + 1
    expect(await hotTitles(top)).toEqual(['first post voted', 'voted', 'plain']);
    // a downvote sinks a thread below the unvoted one
    unwrap(await fas(alice).vote_on_thread_with_neurons(voted, { downvote: null }, [WHALE]));
    expect(await hotTitles(top)).toEqual(['first post voted', 'plain', 'voted']);
    void plain;
  });

  it('age decays a thread, and a new reply brings it back', async () => {
    const top = await topic('age');
    const a = await thread(top, 'a');
    unwrap(await fas(alice).create_post(a, [], [], 'r1'));
    unwrap(await fas(alice).create_post(a, [], [], 'r2')); // a: 2 / 2^1.5 now
    await pic.advanceTime(10 * HOUR);
    await thread(top, 'b'); // b: 1 / 2^1.5; a: 2 / 12^1.5
    expect(await hotTitles(top)).toEqual(['b', 'a']);
    unwrap(await fas(alice).create_post(a, [], [], 'r3')); // a's activity is now: 2.5 / 2^1.5
    expect(await hotTitles(top)).toEqual(['a', 'b']);
    expect((await hot(top, [], 100n, false)).threads.map((t) => t.title[0])).toEqual(['b', 'a']); // reverse = false: coldest first
  });

  it('pages through the order with start_from, at most 100 a page; deleted threads only for admins', async () => {
    const top = await topic('paging');
    const ids = [];
    for (let k = 0; k < 105; k++) ids.push(await thread(top, `t${k}`));
    const full = [];
    let start = [];
    for (let n = 0; n < 20; n++) {
      const r = await hot(top, start, 30n);
      full.push(...r.threads.map((t) => t.id));
      if (!r.has_more) { expect(r.next_start_from).toEqual([]); break; }
      start = r.next_start_from;
    }
    expect(full).toEqual([...ids].reverse()); // equal scores: newest first
    const big = await hot(top, [], 1000n);
    expect(big.threads.length).toBe(100);
    expect(big.has_more).toBe(true);
    expect(big.next_start_from).toEqual([100n]);
    unwrap(await f.delete_thread(ids[104]));
    expect((await hot(top, [], 1n)).threads[0].id).toBe(ids[103]);
    expect((await f.get_threads_by_hot(top, [], 1n, true)).threads[0].id).toBe(ids[104]);
    expect((await hot(10n ** 9n)).threads).toEqual([]);
  });

  it('carries the caller\'s unread counts, like get_threads_by_activity_with_unread_counts', async () => {
    const top = await topic('unread');
    const t = await thread(top, 'u');
    unwrap(await fas(alice).create_post(t, [], [], 'new'));
    const [h] = (await hot(top)).threads;
    const [a] = (await fas(bob).get_threads_by_activity_with_unread_counts(top, [], 10n, true)).threads;
    expect(h).toEqual(a);
  });
});
