// sneed_sns_forum paging and rate limits (spec/paging_audit.md S5 and the forum's per-user items):
// - get_feed is bounded inside the canister: at most 500 items, about 1.5 MB (always at least one
//   item), at most 5,000 ids looked at; following next_start_id still yields every item;
// - get_recent_replies_count (polled on every Sneed Hub page) walks a per-user reply inbox from the
//   newest entry back to the last-seen mark instead of scanning the forum twice per post: the same
//   answers as the old full scan (checked against the production code side by side, and across an
//   upgrade with keep that builds the indexes), and it still answers on a forum of 50,000 posts
//   where the old scan runs out of instructions;
// - get_posts_by_user, get_replies_to_user, get_threads_by_user give the same lists as before, and
//   get_*_by_user_page / get_tips_*_by_user_page page them (newest first, `next`);
// - writing is rate limited per caller and action (src/RateLimit.mo): a spammer is refused at
//   ingress and, past ingress, in the method; a person posting at a human pace is not; admins are
//   not limited; admins set the rules (logged as ICRC-3 config_update).
// FORUM_WASM=sneed_sns_forum_prepaging FORUM_SEED_WASM=sneed_sns_forum_prepaging_seed
// npx vitest run tests/forum-paging.test.js runs it against the code before the fixes (production).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, wasm, admin, alice, bob, carol, user, SNEED_SNS_ROOT, unwrap, errOf, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { btype, tx } from '../lib/icrc3.js';
import { idlFactory as forumIdl } from '../build/sneed_sns_forum.did.js';

const FORUM_WASM = process.env.FORUM_WASM || 'sneed_sns_forum';
const FORUM_SEED_WASM = process.env.FORUM_SEED_WASM || 'sneed_sns_forum_seed';
// the production code: src/sneed_sns_forum unchanged since 1d5cd986 (`dfx +0.28.0 build --network ic` of
// it at /home/snassy/app_sneeddao, gzip -n -9, gives the production module hash 538bbaf7…)
const PROD_WASM = process.env.FORUM_PROD_WASM || 'sneed_sns_forum_prepaging';
const KEEP = { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] };
const SNS_W = Principal.fromText('qaa6y-5yaaa-aaaaa-aaafa-cai');
const dave = user('paging-dave');
const eve = user('paging-eve');
const frank = user('paging-frank');
const ledger = user('paging-ledger');

// the forum's interface, plus the new methods and the test seeding method declared here, so the
// suite runs (and fails) against a build without them
const fullIdl = ({ IDL: I }) => {
  const base = Object.fromEntries(forumIdl({ IDL: I })._fields);
  const PostResponse = base.get_posts_by_user.retTypes[0]._type;
  const ThreadResponse = base.get_threads_by_user.retTypes[0]._type;
  const TipResponse = base.get_tips_given_by_user.retTypes[0]._type;
  const Result = base.update_text_limits.retTypes[0];
  const Rule = I.Record({ capacity: I.Nat, per_minute: I.Nat });
  const page = (T) => I.Record({ items: I.Vec(T), next: I.Opt(I.Nat) });
  const pager = (T) => I.Func([I.Principal, I.Opt(I.Nat), I.Nat], [page(T)], ['query']);
  return I.Service({
    ...base,
    get_posts_by_user_page: pager(PostResponse),
    get_replies_to_user_page: pager(PostResponse),
    get_threads_by_user_page: pager(ThreadResponse),
    get_tips_given_by_user_page: pager(TipResponse),
    get_tips_received_by_user_page: pager(TipResponse),
    get_rate_limits: I.Func([], [I.Vec(I.Tuple(I.Text, Rule))], ['query']),
    admin_set_rate_limit: I.Func([I.Text, I.Opt(Rule)], [Result], []),
    get_rate_limit_exempt: I.Func([], [I.Vec(I.Principal)], ['query']),
    admin_set_rate_limit_exempt: I.Func([I.Principal, I.Bool], [Result], []),
    test_seed_posts: I.Func([I.Nat, I.Principal, I.Principal, I.Nat, I.Text, I.Nat], [I.Nat], []),
    icrc3_get_blocks: I.Func([I.Vec(I.Record({ start: I.Nat, length: I.Nat }))], [I.Record({ log_length: I.Nat, blocks: I.Vec(I.Record({ id: I.Nat, block: Value(I) })), archived_blocks: I.Vec(I.Reserved) })], ['query']),
  });
};
const Value = (I) => {
  const V = I.Rec();
  V.fill(I.Variant({ Int: I.Int, Map: I.Vec(I.Tuple(I.Text, V)), Nat: I.Nat, Blob: I.Vec(I.Nat8), Text: I.Text, Array: I.Vec(V) }));
  return V;
};
const directoryIdl = ({ IDL: I }) => I.Service({ set_instances: I.Func([I.Vec(I.Tuple(I.Principal, I.Principal))], [], []) });

let pic, govId;
const as = (id, p) => actorAs(pic, fullIdl, id, p);
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));
const advance = async (seconds) => { await pic.advanceTime(seconds * 1000); await pic.tick(); };
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const plain = (v) => {
  if ('Nat' in v) return v.Nat;
  if ('Int' in v) return v.Int;
  if ('Text' in v) return v.Text;
  if ('Blob' in v) return Buffer.from(v.Blob).toString('hex');
  if ('Array' in v) return v.Array.map(plain);
  return Object.fromEntries(v.Map.map(([k, x]) => [k, plain(x)]));
};
/// Feed items' text bytes, as the canister estimates a page's size
const textBytes = (items) => items.reduce((n, i) => n + Buffer.byteLength(i.body[0] ?? '') + Buffer.byteLength(i.replied_to_post[0]?.body ?? ''), 0);

/// A forum with a forum, a topic and a thread by alice; returns its ids.
async function freshForum(name) {
  const id = await install(pic, { name });
  const F = unwrap(await as(id, admin).create_forum({ title: 'Sneed', description: 'The Sneed DAO forum', sns_root_canister_id: [] }));
  const TOPIC = unwrap(await as(id, admin).create_topic({ forum_id: F, parent_topic_id: [], title: 'General', description: 'Talk' }));
  const TH = unwrap(await as(id, alice).create_thread({ topic_id: TOPIC, title: ['Hello'], body: 'first thread' }));
  return { id, F, TOPIC, TH };
}

/// Every page of a per-user list, `limit` at a time
async function readPages(actor, method, who, limit) {
  const items = [];
  const pages = [];
  let before = [];
  for (let i = 0; i < 1000; i++) {
    const page = await actor[method](who, before, BigInt(limit));
    pages.push(page);
    items.push(...page.items);
    if (!page.next.length) break;
    before = page.next;
  }
  return { items, pages };
}

beforeAll(async () => {
  ({ pic } = await createPic());
  await install(pic, { name: 'MockForumSnsW', targetCanisterId: SNS_W });
  govId = await install(pic, { name: 'MockForumGovernance' });
  await actorAs(pic, directoryIdl, SNS_W, admin).set_instances([[SNEED_SNS_ROOT, govId]]);
}, 120_000);
afterAll(async () => { await pic?.tearDown(); });

describe('replies, posts and threads by user: the same answers as the production code', () => {
  const people = [alice, bob, carol, dave];
  let oldId; let newId;

  /// The same sequence of writes on a forum; returns the ids it made.
  async function script(id, T) {
    const o = (p) => as(id, p);
    const post = async (p, thread, replyTo, body) => unwrap(await o(p).create_post(thread, replyTo == null ? [] : [replyTo], [], body));
    const TB = unwrap(await o(bob).create_thread({ topic_id: T.TOPIC, title: ['Bob'], body: 'bob thread' }));
    const pB1 = await post(bob, T.TH, null, 'bob in alice thread'); // a reply to alice's thread
    const pA1 = await post(alice, T.TH, null, 'alice in her own thread'); // not a reply to her
    await post(carol, T.TH, pA1, 'carol answers alice'); // a reply to alice
    await post(alice, T.TH, pA1, 'alice answers herself'); // counts for alice (as it always did)
    await post(alice, T.TH, pB1, 'alice answers bob'); // a reply to bob
    await post(dave, TB, null, 'dave in bob thread'); // a reply to bob's thread
    await advance(5);
    await o(alice).mark_replies_seen_up_to(await nowNs());
    await advance(5);
    const pC2 = await post(carol, T.TH, null, 'carol in alice thread, later');
    await post(bob, T.TH, pA1, 'bob answers alice, later');
    const pD2 = await post(dave, TB, null, 'dave again');
    await post(carol, TB, pD2, 'carol answers dave');
    unwrap(await o(admin).delete_post(pC2)); // deleted replies do not count
    unwrap(await o(dave).delete_post(pD2)); // a deleted parent takes its replies out
    unwrap(await o(admin).delete_thread(TB)); // a deleted thread takes its top-level posts out
    await advance(5);
    await o(bob).mark_replies_seen_up_to((await nowNs()) - 7_000_000_000n);
    unwrap(await o(admin).undelete_thread(TB));
    return { TB, pA1, pB1 };
  }

  const snapshot = async (id) => json(await Promise.all(people.map(async (p) => {
    const o = as(id, p);
    return [await o.get_recent_replies_count(p), await o.get_replies_to_user(p), await o.get_posts_by_user(p), await o.get_threads_by_user(p)];
  })));

  beforeAll(async () => {
    const a = await freshForum(PROD_WASM);
    const b = await freshForum(FORUM_WASM);
    oldId = a.id; newId = b.id;
    // the same script, interleaved, so both forums see the same times
    await script(oldId, a);
    await script(newId, b);
  }, 180_000);

  it('counts, replies, posts and threads equal the production code for everyone', async () => {
    const counts = await Promise.all(people.map((p) => as(newId, p).get_recent_replies_count(p)));
    expect(counts).toEqual([1n, 0n, 0n, 0n]); // alice: bob's late answer (carol's late post is deleted); bob: dave's late post is deleted
    // the two forums ran the script one after the other: compare everything but the times
    const untimed = (s) => s.replace(/"(created_at|updated_at)":"\d+"/g, '"$1":"t"');
    expect(untimed(await snapshot(newId))).toBe(untimed(await snapshot(oldId)));
  });

  it('an upgrade of the production code with keep builds the indexes: the same answers after, also for new posts', async () => {
    const before = await snapshot(oldId);
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(FORUM_WASM), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    await pic.tick(2);
    expect(await snapshot(oldId)).toBe(before);
    // new posts after the upgrade go into the indexes
    const T = (await as(oldId, alice).get_threads_by_user(alice))[0].id;
    unwrap(await as(oldId, eve).create_post(T, [], [], 'eve in alice thread'));
    const p = (await as(oldId, alice).get_posts_by_user(alice))[0].id;
    unwrap(await as(oldId, eve).create_post(T, [p], [], 'eve answers alice'));
    expect(await as(oldId, alice).get_recent_replies_count(alice)).toBe(3n);
    expect((await as(oldId, alice).get_replies_to_user(alice)).slice(0, 2).map((x) => x.body)).toEqual(['eve answers alice', 'eve in alice thread']);
    // a second upgrade does not index anything twice
    const again = await snapshot(oldId);
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(FORUM_WASM), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    await pic.tick(2);
    expect(await snapshot(oldId)).toBe(again);
  }, 120_000);

  it('pages: newest first, `next` until the end, together exactly the full lists', async () => {
    for (const p of people) {
      const o = as(newId, p);
      for (const [method, full] of [['get_posts_by_user_page', 'get_posts_by_user'], ['get_replies_to_user_page', 'get_replies_to_user'], ['get_threads_by_user_page', 'get_threads_by_user']]) {
        const { items, pages } = await readPages(o, method, p, 1);
        expect(json(items), `${method} ${p.toText()}`).toBe(json(await o[full](p)));
        expect(pages.slice(0, -1).every((pg) => pg.items.length === 1)).toBe(true);
      }
    }
    const empty = await as(newId, alice).get_posts_by_user_page(user('never-seen'), [], 10n);
    expect(empty).toEqual({ items: [], next: [] });
    // limit 0 or above 100: 100
    expect((await as(newId, alice).get_posts_by_user_page(alice, [], 0n)).items.length).toBe((await as(newId, alice).get_posts_by_user(alice)).length);
  });

  it('tips given and received page the same way', async () => {
    const o = (p) => as(newId, p);
    const posts = await o(bob).get_posts_by_user(bob);
    for (const [i, post] of posts.entries()) unwrap(await o(alice).create_tip(bob, post.id, ledger, BigInt(100 + i), [])); // unverified (no block): still listed
    const given = await readPages(o(alice), 'get_tips_given_by_user_page', alice, 1);
    expect(json(given.items)).toBe(json([...(await o(alice).get_tips_given_by_user(alice))].reverse()));
    expect(given.items.length).toBe(posts.length);
    const received = await readPages(o(bob), 'get_tips_received_by_user_page', bob, 2);
    expect(json(received.items)).toBe(json([...(await o(bob).get_tips_received_by_user(bob))].reverse()));
  });
});

describe('a forum of 50,000 posts', () => {
  let id; let T;
  beforeAll(async () => {
    T = await freshForum(FORUM_SEED_WASM);
    id = T.id;
    // 25,000 top-level posts by alice in her thread, each answered by bob
    for (let i = 0; i < 5; i++) expect(await as(id, admin).test_seed_posts(T.TH, alice, bob, 5_000n, 'seed', 1n)).toBe(10_000n);
  }, 300_000);

  it('get_recent_replies_count answers (the production scan runs out of instructions here)', async () => {
    expect(await as(id, alice).get_recent_replies_count(alice)).toBe(25_000n);
    expect(await as(id, bob).get_recent_replies_count(bob)).toBe(0n);
    await advance(1);
    await as(id, alice).mark_replies_seen_up_to(await nowNs());
    expect(await as(id, alice).get_recent_replies_count(alice)).toBe(0n);
    await advance(1);
    unwrap(await as(id, carol).create_post(T.TH, [], [], 'one more'));
    expect(await as(id, alice).get_recent_replies_count(alice)).toBe(1n);
  }, 120_000);

  it('get_feed with a huge length returns one bounded page (production returns the whole forum, too big to send)', async () => {
    const page = await as(id, alice).get_feed({ start_id: [], length: 1_000_000n, filter: [] });
    expect(page.items.length).toBe(500);
    expect(page.has_more).toBe(true);
    expect(page.next_start_id[0]).toBe(page.items.at(-1).id - 1n);
    const next = await as(id, alice).get_feed({ start_id: page.next_start_id, length: 1_000_000n, filter: [] });
    expect(next.items[0].id).toBe(page.next_start_id[0]);
    // a search that matches nothing stops at the check budget and says where to go on
    const search = await as(id, alice).get_feed({ start_id: [], length: 1_000_000n, filter: [{ search_text: ['no such words'], sns_root_canister_ids: [], topic_ids: [], creator_principals: [] }] });
    expect(search.items).toEqual([]);
    expect(search.has_more).toBe(true);
    expect(search.next_start_id[0] < page.items[0].id).toBe(true);
  }, 120_000);

  it('the per-user pages answer where the full lists cannot', async () => {
    const replies = await as(id, alice).get_replies_to_user_page(alice, [], 100n);
    expect(replies.items.length).toBe(100);
    expect(replies.items[0].body).toBe('one more');
    expect(replies.next.length).toBe(1);
    const more = await as(id, alice).get_replies_to_user_page(alice, replies.next, 100n);
    expect(more.items.length).toBe(100);
    expect(more.items[0].id < replies.items.at(-1).id).toBe(true);
    const posts = await as(id, alice).get_posts_by_user_page(alice, [], 1000n);
    expect(posts.items.length).toBe(100);
    expect(posts.items.every((p) => p.created_by.toText() === alice.toText())).toBe(true);
  }, 120_000);
});

describe('get_feed: about 1.5 MB per page, at most 500 items, nothing skipped', () => {
  it('long posts spread over several pages; following next_start_id yields every item once, newest first', async () => {
    const T = await freshForum(FORUM_SEED_WASM);
    // 100 posts of 9,000 characters, each answered (a reply's feed item carries its parent's text too)
    expect(await as(T.id, admin).test_seed_posts(T.TH, alice, bob, 100n, 'x'.repeat(900), 10n)).toBe(200n);
    const items = [];
    const pages = [];
    let start = [];
    for (let i = 0; i < 100; i++) {
      const page = await as(T.id, carol).get_feed({ start_id: start, length: 500n, filter: [] });
      pages.push(page);
      items.push(...page.items);
      if (!page.has_more) break;
      start = page.next_start_id;
    }
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) expect(textBytes(p.items)).toBeLessThanOrEqual(1_500_000);
    expect(items.length).toBe(203); // 200 posts, the thread, the topic, the forum
    const ids = items.map((i) => i.id);
    expect(new Set(ids.map(String)).size).toBe(ids.length);
    expect(ids.every((x, i) => i === 0 || x < ids[i - 1])).toBe(true);
  }, 120_000);

  it('length is clamped to 500', async () => {
    const T = await freshForum(FORUM_SEED_WASM);
    expect(await as(T.id, admin).test_seed_posts(T.TH, alice, bob, 400n, 'short', 1n)).toBe(800n);
    const page = await as(T.id, carol).get_feed({ start_id: [], length: 1000n, filter: [] });
    expect(page.items.length).toBe(500);
    expect(page.has_more).toBe(true);
    const small = await as(T.id, carol).get_feed({ start_id: [], length: 20n, filter: [] }); // what Sneed Hub asks for
    expect(small.items.length).toBe(20);
    expect(small.items).toEqual(page.items.slice(0, 20));
  }, 120_000);
});

describe('rate limits', () => {
  let T;
  const o = (p) => as(T.id, p);
  const post = (p, body = 'hi') => o(p).create_post(T.TH, [], [], body);
  beforeAll(async () => { T = await freshForum(FORUM_WASM); }, 120_000);

  it('defaults: generous for people', async () => {
    expect(await o(alice).get_rate_limits()).toEqual([
      ['thread', { capacity: 10n, per_minute: 2n }], ['post', { capacity: 10n, per_minute: 4n }], ['edit', { capacity: 10n, per_minute: 4n }],
      ['poll', { capacity: 5n, per_minute: 1n }], ['tip', { capacity: 10n, per_minute: 3n }], ['vote', { capacity: 30n, per_minute: 10n }],
    ]);
  });

  it('a spammer is refused at ingress after 10 posts in a row; a minute later 4 more go through', async () => {
    for (let i = 0; i < 10; i++) unwrap(await post(carol, `spam ${i}`));
    expect(await refusedAtIngress(post(carol, 'spam 10'))).toBe(true);
    expect(await refusedAtIngress(post(carol, 'spam 11'))).toBe(true);
    await advance(60);
    for (let i = 0; i < 4; i++) unwrap(await post(carol, `later ${i}`));
    expect(await refusedAtIngress(post(carol, 'too soon'))).toBe(true);
    // other actions have their own budget
    unwrap(await o(carol).create_thread({ topic_id: T.TOPIC, title: [], body: 'a thread' }));
  }, 120_000);

  it('a person posting at a human pace is never limited', async () => {
    for (let i = 0; i < 30; i++) {
      unwrap(await post(dave, `thought ${i}`));
      await advance(20); // three posts a minute
    }
  }, 180_000);

  it('past ingress (calls at once, or from canisters) the method refuses: RateLimited as InvalidInput, nothing written', async () => {
    const createPost = Object.fromEntries(forumIdl({ IDL })._fields).create_post;
    const calls = [];
    for (let i = 0; i < 13; i++) {
      calls.push(await pic.submitCall({ canisterId: T.id, method: 'create_post', sender: eve, arg: IDL.encode(createPost.argTypes, [T.TH, [], [], `burst ${i}`]) }));
    }
    const results = [];
    for (const c of calls) results.push(IDL.decode(createPost.retTypes, await pic.awaitCall(c))[0]);
    expect(results.filter((r) => 'ok' in r)).toHaveLength(10);
    const refused = results.filter((r) => 'err' in r);
    expect(refused).toHaveLength(3);
    for (const r of refused) expect(r.err.InvalidInput).toMatch(/^Rate limited: at most 10 post calls in a row and 4 a minute/);
    expect((await o(eve).get_posts_by_user(eve)).length).toBe(10);
  }, 120_000);

  it('votes, tips and edits are limited too', async () => {
    const P = (await o(alice).get_posts_by_user(dave))[0].id;
    for (let i = 0; i < 30; i++) await o(frank).vote_on_post(P, { upvote: null }); // answered (frank has no neurons), not refused
    expect(await refusedAtIngress(o(frank).vote_on_post(P, { upvote: null }))).toBe(true);
    expect(await refusedAtIngress(o(frank).retract_vote(P))).toBe(true);
    for (let i = 0; i < 10; i++) expect(errOf(await o(frank).create_tip(dave, 999_999n, ledger, 1n, []))).toHaveProperty('NotFound');
    expect(await refusedAtIngress(o(frank).create_tip(dave, 999_999n, ledger, 1n, []))).toBe(true);
    expect(await refusedAtIngress(o(frank).verify_tip(1n))).toBe(true);
    const mine = unwrap(await post(frank, 'mine'));
    for (let i = 0; i < 10; i++) unwrap(await o(frank).update_post(mine, [], `edit ${i}`));
    expect(await refusedAtIngress(o(frank).update_post(mine, [], 'one edit too many'))).toBe(true);
  }, 120_000);

  it('an exempt integrator bursts 50 threads; a principal that is not exempt is limited; each change is logged', async () => {
    const taco = user('paging-taco-bot');
    const other = user('paging-other-bot');
    expect(errOf(await o(alice).admin_set_rate_limit_exempt(taco, true))).toHaveProperty('Unauthorized');
    unwrap(await o(admin).admin_set_rate_limit_exempt(taco, true));
    unwrap(await o(admin).admin_set_rate_limit_exempt(taco, true)); // unchanged: no block
    expect((await o(alice).get_rate_limit_exempt()).map((p) => p.toText())).toEqual([taco.toText()]);
    const len = (await o(admin).icrc3_get_blocks([{ start: 0n, length: 0n }])).log_length;
    const b = (await o(admin).icrc3_get_blocks([{ start: len - 1n, length: 1n }])).blocks[0].block;
    expect({ t: btype(b), ...plain(tx(b)) }).toMatchObject({ t: 'sneedforum_config_update', key: 'rate_limit_exempt', principal: Buffer.from(taco.toUint8Array()).toString('hex'), old_value: 0n, value: 1n });
    for (let i = 0; i < 50; i++) unwrap(await o(taco).create_thread({ topic_id: T.TOPIC, title: [`Proposal ${i}`], body: 'discussion' }));
    for (let i = 0; i < 10; i++) unwrap(await o(other).create_thread({ topic_id: T.TOPIC, title: [`Other ${i}`], body: 'discussion' }));
    expect(await refusedAtIngress(o(other).create_thread({ topic_id: T.TOPIC, title: ['Other 10'], body: 'discussion' }))).toBe(true);
    unwrap(await o(admin).admin_set_rate_limit_exempt(taco, false));
    expect(await o(alice).get_rate_limit_exempt()).toEqual([]);
    // off the list it is limited like anyone (its bucket starts full: exempt calls never drew from it)
    for (let i = 0; i < 10; i++) unwrap(await o(taco).create_thread({ topic_id: T.TOPIC, title: [`after ${i}`], body: 'discussion' }));
    expect(await refusedAtIngress(o(taco).create_thread({ topic_id: T.TOPIC, title: ['after 10'], body: 'discussion' }))).toBe(true);
  }, 180_000);

  it('the SNS root of a forum is not limited', async () => {
    for (let i = 0; i < 15; i++) unwrap(await o(SNEED_SNS_ROOT).create_thread({ topic_id: T.TOPIC, title: [`root ${i}`], body: 'from the DAO' }));
  }, 120_000);

  it('admins are not limited', async () => {
    for (let i = 0; i < 15; i++) unwrap(await post(admin, `announcement ${i}`));
  }, 120_000);

  it('admins set the rules; each change is an ICRC-3 config_update block', async () => {
    const lastBlock = async () => {
      const len = (await o(admin).icrc3_get_blocks([{ start: 0n, length: 0n }])).log_length;
      const b = (await o(admin).icrc3_get_blocks([{ start: len - 1n, length: 1n }])).blocks[0].block;
      return { t: btype(b), ...plain(tx(b)) };
    };
    expect(errOf(await o(alice).admin_set_rate_limit('post', [{ capacity: 1n, per_minute: 1n }]))).toHaveProperty('Unauthorized');
    expect(errOf(await o(admin).admin_set_rate_limit('spam', [{ capacity: 1n, per_minute: 1n }])).InvalidInput).toMatch(/Unknown action/);
    expect(errOf(await o(admin).admin_set_rate_limit('post', [{ capacity: 5n, per_minute: 0n }])).InvalidInput).toMatch(/per_minute/);
    expect(errOf(await o(admin).admin_set_rate_limit('post', [{ capacity: 100_001n, per_minute: 1n }])).InvalidInput).toMatch(/at most 100000/);
    unwrap(await o(admin).admin_set_rate_limit('post', [{ capacity: 2n, per_minute: 1n }]));
    expect((await o(alice).get_rate_limits())[1]).toEqual(['post', { capacity: 2n, per_minute: 1n }]);
    expect(await lastBlock()).toMatchObject({ t: 'sneedforum_config_update', key: 'rate_limit.post', old_value: { capacity: 10n, per_minute: 4n }, value: { capacity: 2n, per_minute: 1n } });
    const g = user('paging-grace');
    unwrap(await post(g)); unwrap(await post(g));
    expect(await refusedAtIngress(post(g))).toBe(true);
    unwrap(await o(admin).admin_set_rate_limit('post', [{ capacity: 0n, per_minute: 0n }])); // off
    for (let i = 0; i < 12; i++) unwrap(await post(g, `free ${i}`));
    unwrap(await o(admin).admin_set_rate_limit('post', [])); // back to the default
    expect(await lastBlock()).toMatchObject({ key: 'rate_limit.post', old_value: { capacity: 0n, per_minute: 0n }, value: { capacity: 10n, per_minute: 4n } });
    expect((await o(alice).get_rate_limits())[1]).toEqual(['post', { capacity: 10n, per_minute: 4n }]);
    // an upgrade keeps the rules
    unwrap(await o(admin).admin_set_rate_limit('vote', [{ capacity: 50n, per_minute: 20n }]));
    await pic.upgradeCanister({ sender: admin, canisterId: T.id, wasm: wasm(FORUM_WASM), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    expect((await o(alice).get_rate_limits())[5]).toEqual(['vote', { capacity: 50n, per_minute: 20n }]);
  }, 120_000);
});

describe('ingress guard', () => {
  it('refuses the new queries as update calls', async () => {
    const { id } = await freshForum(FORUM_WASM);
    const u = actorAs(pic, asUpdates(fullIdl), id, alice);
    for (const m of ['get_posts_by_user_page', 'get_replies_to_user_page', 'get_threads_by_user_page', 'get_tips_given_by_user_page', 'get_tips_received_by_user_page']) {
      expect(await refusedAtIngress(u[m](alice, [], 10n)), m).toBe(true);
    }
    expect(await refusedAtIngress(u.get_rate_limits())).toBe(true);
    expect(await refusedAtIngress(u.get_rate_limit_exempt())).toBe(true);
  });
});
