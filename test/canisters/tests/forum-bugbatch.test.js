// sneed_sns_forum bug batch 2: each case failed on the code before the fix (commit f5620213,
// build/sneed_sns_forum_prebatch.wasm) and passes on the fix.
//   FORUM_WASM=sneed_sns_forum_prebatch npx vitest run tests/forum-bugbatch.test.js   runs it against the old code.
//   1. a poll vote with several neurons, one of which had already voted on a poll without vote
//      changes, failed (after writing the votes of the neurons before it); now the others vote and the
//      call succeeds. A poll that ended while governance answered still took the vote (the end time was
//      checked before the awaits only)
//   2. concurrent create_sns_forum_setup / create_proposal_thread_with_auto_setup calls made duplicate
//      forums and proposal threads (the existence checks ran before the awaits)
//   3. votes and retractions rewrote the post's updated_at (clients showed unedited posts as edited)
//   4. every upgrade recounted all poll votes in postupgrade (now once, behind a flag)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, wasm, admin, alice, bob, carol, user, SNEED_SNS_ROOT, unwrap, errOf, nowNs } from '../lib/pic.js';
import { idlFactory as forumIdl } from '../build/sneed_sns_forum.did.js';

const FORUM_WASM = process.env.FORUM_WASM || 'sneed_sns_forum';
const SNS_W = Principal.fromText('qaa6y-5yaaa-aaaaa-aaafa-cai');
const rateLimitIdl = ({ IDL: I }) => I.Service({ admin_set_rate_limit: I.Func([I.Text, I.Opt(I.Record({ capacity: I.Nat, per_minute: I.Nat }))], [I.Variant({ ok: I.Null, err: I.Reserved })], []) });
const directoryIdl = ({ IDL: I }) => I.Service({ set_instances: I.Func([I.Vec(I.Tuple(I.Principal, I.Principal))], [], []) });
const govIdl = ({ IDL: I }) => I.Service({
  add_neurons: I.Func([I.Nat8, I.Nat, I.Principal, I.Nat64, I.Nat64], [], []),
  set_trap: I.Func([I.Bool], [], []),
});
const nid = (prefix, i) => { const b = new Uint8Array(32); b[0] = prefix; b[1] = i >> 8; b[2] = i & 255; return { id: b }; };
const rootA = user('batch-root-a'), rootB = user('batch-root-b'), rootC = user('batch-root-c'), rootD = user('batch-root-d'), rootE = user('batch-root-e');
const upgradeKeep = { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] };
const show = (x) => JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
const outcome = (r) => ('ok' in r ? `ok ${r.ok}` : `err ${show(r.err)}`);

let pic, appSubnet, forumId, govId, gov, f, fas, F, TOP, TOP_FAR;
const thread = async (who) => unwrap(await fas(who).create_thread({ topic_id: TOP, title: ['t'], body: 'body' }));
const poll = async (allowChanges, endInSeconds = 3600, topic = TOP) => {
  const t = unwrap(await fas(alice).create_thread({ topic_id: topic, title: ['t'], body: 'body' }));
  return unwrap(await fas(alice).create_poll({ thread_id: t, post_id: [], title: 'Q', body: 'b', options: [{ title: 'A', body: [] }, { title: 'B', body: [] }],
    vp_power: [], end_timestamp: (await nowNs(pic)) + BigInt(endInSeconds) * 1_000_000_000n, allow_vote_changes: [allowChanges] }));
};
const deferred = (who) => { const d = pic.createDeferredActor({ idlFactory: forumIdl, canisterId: forumId }); d.setPrincipal(who); return d; };
const forumsOf = async (root) => (await f.get_forums_admin()).filter((x) => x.sns_root_canister_id[0]?.toText() === root.toText());

async function newForum(name = FORUM_WASM) {
  const id = await install(pic, { name, targetSubnetId: appSubnet });
  for (const a of ['thread', 'post', 'edit', 'poll', 'tip', 'vote']) await actorAs(pic, rateLimitIdl, id, admin).admin_set_rate_limit(a, [{ capacity: 0n, per_minute: 0n }]);
  return id;
}

describe(`sneed_sns_forum bug batch 2 (${FORUM_WASM})`, () => {
  beforeAll(async () => {
    ({ pic, appSubnet } = await createPic());
    await install(pic, { name: 'MockForumSnsW', targetCanisterId: SNS_W });
    govId = await install(pic, { name: 'MockForumGovernance', targetSubnetId: appSubnet });
    gov = actorAs(pic, govIdl, govId, admin);
    // a governance on another subnet: its answers take rounds, so the clock can move during a call
    const farGovId = await install(pic, { name: 'MockForumGovernance', targetSubnetId: (await pic.getSnsSubnet()).id });
    await actorAs(pic, govIdl, farGovId, admin).add_neurons(2, 1n, carol, 1000n, 200n);
    await actorAs(pic, directoryIdl, SNS_W, admin).set_instances([...[SNEED_SNS_ROOT, rootA, rootB, rootC, rootD].map((r) => [r, govId]), [rootE, farGovId]]);
    await gov.add_neurons(1, 6n, alice, 1000n, 200n); // alice: neurons (1, 0..5), voting power 1000 each
    await gov.add_neurons(2, 1n, carol, 1000n, 200n); // carol: neuron (2, 0)
    forumId = await newForum();
    f = actorAs(pic, forumIdl, forumId, admin);
    fas = (p) => actorAs(pic, forumIdl, forumId, p);
    F = unwrap(await f.create_forum({ title: 'Sneed', description: 'd', sns_root_canister_id: [SNEED_SNS_ROOT] }));
    TOP = unwrap(await f.create_topic({ forum_id: F, parent_topic_id: [], title: 'General', description: 'g' }));
    const far = unwrap(await f.create_forum({ title: 'Far', description: 'd', sns_root_canister_id: [rootE] }));
    TOP_FAR = unwrap(await f.create_topic({ forum_id: far, parent_topic_id: [], title: 'General', description: 'g' }));
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  describe('1. poll votes with several neurons', () => {
    it('on a poll without vote changes, a neuron that already voted is skipped and the others vote', async () => {
      const p = await poll(false);
      unwrap(await fas(alice).vote_on_poll_with_neurons(p, 0n, [nid(1, 3)])); // B votes first
      // A (new) and B (already voted) together: A votes once, B's vote stays as it was
      unwrap(await fas(alice).vote_on_poll_with_neurons(p, 1n, [nid(1, 0), nid(1, 3)]));
      const votes = await f.get_poll_votes(p);
      expect(votes.length).toBe(2);
      const of = (i) => votes.find((v) => v.neuron_id.id[0] === 1 && v.neuron_id.id[2] === i);
      expect(of(3).option_id).toBe(0n);
      expect(of(0).option_id).toBe(1n);
      expect((await f.get_poll(p))[0].options.map((o) => [o.vote_count, o.total_voting_power])).toEqual([[1n, 1_000n], [1n, 1_000n]]);
      // only neurons that already voted: the existing error, and nothing changes
      expect(errOf(await fas(alice).vote_on_poll_with_neurons(p, 0n, [nid(1, 0), nid(1, 3)]))).toEqual({ InvalidInput: 'Vote changes are not allowed for this poll' });
      expect((await f.get_poll(p))[0].options.map((o) => o.vote_count)).toEqual([1n, 1n]);
    });

    it('a poll that ends while governance answers takes no vote', async () => {
      const p = await poll(true, 30, TOP_FAR);
      const call = await deferred(carol).vote_on_poll_with_neurons(p, 0n, [nid(2, 0)]);
      await pic.tick(1); // the call starts and passes the first end check
      await pic.advanceTime(60_000); // then the poll ends, while the forum waits for governance
      const r = await call();
      expect(errOf(r)).toEqual({ InvalidInput: 'Poll has ended' });
      expect(await f.get_poll_votes(p)).toEqual([]);
      expect((await f.get_poll(p))[0].options.map((o) => o.vote_count)).toEqual([0n, 0n]);
    });

    it('the success path is unchanged: every neuron votes, counts and voting power add up, changes move them', async () => {
      const p = await poll(true);
      unwrap(await fas(alice).vote_on_poll_with_neurons(p, 0n, [nid(1, 0), nid(1, 1), nid(1, 2)]));
      let opts = (await f.get_poll(p))[0].options;
      expect(opts.map((o) => [o.vote_count, o.total_voting_power])).toEqual([[3n, 3_000n], [0n, 0n]]);
      unwrap(await fas(alice).vote_on_poll_with_neurons(p, 1n, [nid(1, 1), nid(1, 4)]));
      opts = (await f.get_poll(p))[0].options;
      expect(opts.map((o) => [o.vote_count, o.total_voting_power])).toEqual([[2n, 2_000n], [2n, 2_000n]]);
      expect((await f.get_poll_votes(p)).length).toBe(4);
      const q = await poll(false);
      unwrap(await fas(alice).vote_on_poll_with_neurons(q, 1n, [nid(1, 0), nid(1, 5)]));
      expect((await f.get_poll(q))[0].options.map((o) => o.vote_count)).toEqual([0n, 2n]);
    });
  });

  describe('2. concurrent auto setups make one forum and one thread per proposal', () => {
    it('two create_sns_forum_setup calls at once: one forum', async () => {
      const c1 = await deferred(alice).create_sns_forum_setup(rootA);
      const c2 = await deferred(bob).create_sns_forum_setup(rootA);
      const rs = [await c1(), await c2()];
      const forums = await forumsOf(rootA);
      expect(forums.length, `results: ${rs.map(outcome).join(', ')}`).toBe(1);
      const topic = (await f.get_proposals_topic(forums[0].id))[0].proposals_topic_id;
      for (const r of rs) {
        if ('ok' in r) expect(r.ok).toBe(topic);
        else expect(errOf(r)).toEqual({ AlreadyExists: 'The forum of this SNS is being set up by another call' });
      }
      expect(rs.some((r) => 'ok' in r)).toBe(true);
      // the reservation is released: a later call returns the existing setup
      expect(unwrap(await fas(carol).create_sns_forum_setup(rootA))).toBe(topic);
      expect((await forumsOf(rootA)).length).toBe(1);
    });

    it('two create_proposal_thread_with_auto_setup calls for one proposal at once: one forum, one thread', async () => {
      const input = { proposal_id: 7n, sns_root_canister_id: rootB };
      const c1 = await deferred(alice).create_proposal_thread_with_auto_setup(input);
      const c2 = await deferred(bob).create_proposal_thread_with_auto_setup(input);
      const rs = [await c1(), await c2()];
      const forums = await forumsOf(rootB);
      expect(forums.length, `results: ${rs.map(outcome).join(', ')}`).toBe(1);
      const topic = (await f.get_proposals_topic(forums[0].id))[0].proposals_topic_id;
      expect((await f.get_threads_by_topic_admin(topic)).length).toBe(1);
      expect(rs.filter((r) => 'ok' in r).length).toBe(1);
      expect(Object.keys(errOf(rs.find((r) => 'err' in r)))).toEqual(['AlreadyExists']);
      expect((await f.get_proposal_thread(rootB, 7n))[0].thread_id).toBe(rs.find((r) => 'ok' in r).ok);
      // released: the same proposal again is the ordinary AlreadyExists, another proposal works
      expect(errOf(await fas(carol).create_proposal_thread_with_auto_setup(input))).toEqual({ AlreadyExists: 'Thread for this proposal already exists' });
      unwrap(await fas(carol).create_proposal_thread_with_auto_setup({ proposal_id: 8n, sns_root_canister_id: rootB }));
    });

    it('a setup and two proposal threads of one new SNS at once (different reservations): the re-check after the awaits keeps one forum', async () => {
      const c1 = await deferred(alice).create_sns_forum_setup(rootC);
      const c2 = await deferred(bob).create_proposal_thread_with_auto_setup({ proposal_id: 1n, sns_root_canister_id: rootC });
      const c3 = await deferred(carol).create_proposal_thread_with_auto_setup({ proposal_id: 2n, sns_root_canister_id: rootC });
      const rs = [await c1(), await c2(), await c3()];
      for (const r of rs) unwrap(r);
      const forums = await forumsOf(rootC);
      expect(forums.length, `results: ${rs.map(outcome).join(', ')}`).toBe(1);
      const topics = await f.get_topics_by_forum_admin(forums[0].id);
      expect(topics.map((t) => t.title).sort()).toEqual(['Governance', 'Proposals']);
      const topic = (await f.get_proposals_topic(forums[0].id))[0].proposals_topic_id;
      expect(rs[0].ok).toBe(topic);
      expect((await f.get_threads_by_topic_admin(topic)).map((t) => t.id).sort()).toEqual([rs[1].ok, rs[2].ok].sort());
    });

    it('a setup that fails (governance traps) releases its reservation', async () => {
      await gov.set_trap(true);
      await expect(fas(alice).create_sns_forum_setup(rootD)).rejects.toThrow();
      await gov.set_trap(false);
      const topic = unwrap(await fas(alice).create_sns_forum_setup(rootD));
      expect((await forumsOf(rootD)).length).toBe(1);
      expect(unwrap(await fas(bob).create_sns_forum_setup(rootD))).toBe(topic);
    });
  });

  it('3. votes and retractions leave a post\'s updated_at alone', async () => {
    const t = await thread(bob);
    const p = unwrap(await fas(bob).create_post(t, [], [], 'not edited'));
    const made = (await f.get_post(p))[0];
    expect(made.updated_at).toBe(made.created_at);
    await pic.advanceTime(5_000);
    unwrap(await fas(alice).vote_on_post_with_neurons(p, { upvote: null }, [nid(1, 0)]));
    let now = (await f.get_post(p))[0];
    expect(now.upvote_score).toBe(1000n);
    expect(now.updated_at).toBe(made.created_at);
    await pic.advanceTime(5_000);
    unwrap(await fas(alice).vote_on_post_with_neurons(p, { downvote: null }, [nid(1, 0)]));
    now = (await f.get_post(p))[0];
    expect([now.upvote_score, now.downvote_score]).toEqual([0n, 1000n]);
    expect(now.updated_at).toBe(made.created_at);
    await pic.advanceTime(5_000);
    unwrap(await fas(carol).vote_on_post(p, { upvote: null }));
    unwrap(await fas(alice).retract_vote_with_neurons(p, [nid(1, 0)]));
    unwrap(await fas(carol).retract_vote(p));
    now = (await f.get_post(p))[0];
    expect([now.upvote_score, now.downvote_score]).toEqual([0n, 0n]);
    expect(now.updated_at).toBe(made.created_at);
    // an edit still sets it
    await pic.advanceTime(5_000);
    unwrap(await fas(bob).update_post(p, [], 'edited'));
    expect((await f.get_post(p))[0].updated_at > made.created_at).toBe(true);
  });

  it('4. an upgrade recounts the poll votes once, not on every upgrade', async () => {
    // a forum with 20,000 poll votes (20 polls, 1,000 neurons each) and an empty one, same build
    const N = 1000, POLLS = 20;
    await gov.add_neurons(9, BigInt(N), user('many'), 1000n, 200n);
    const big = await newForum();
    const empty = await newForum();
    const g = actorAs(pic, forumIdl, big, admin);
    const gm = actorAs(pic, forumIdl, big, user('many'));
    const forum = unwrap(await g.create_forum({ title: 'Big', description: 'd', sns_root_canister_id: [SNEED_SNS_ROOT] }));
    const top = unwrap(await g.create_topic({ forum_id: forum, parent_topic_id: [], title: 'General', description: 'g' }));
    const neurons = Array.from({ length: N }, (_, i) => nid(9, i));
    const end = (await nowNs(pic)) + 30n * 86_400_000_000_000n;
    const polls = [];
    for (let k = 0; k < POLLS; k++) {
      const th = unwrap(await g.create_thread({ topic_id: top, title: ['t'], body: 'b' }));
      const p = unwrap(await g.create_poll({ thread_id: th, post_id: [], title: 'Q', body: 'b', options: [{ title: 'A', body: [] }, { title: 'B', body: [] }],
        vp_power: [], end_timestamp: end, allow_vote_changes: [true] }));
      unwrap(await gm.vote_on_poll_with_neurons(p, BigInt(k % 2), neurons));
      polls.push(p);
    }
    const counts = async () => Promise.all(polls.map(async (p) => (await g.get_poll(p))[0].options.map((o) => [o.vote_count, o.total_voting_power])));
    const before = await counts();
    expect(before[0]).toEqual([[BigInt(N), BigInt(N) * 1000n], [0n, 0n]]);
    const upgradeCost = async (id) => {
      const b = await pic.getCyclesBalance(id);
      await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(FORUM_WASM), arg: IDL.encode([], []), upgradeModeOptions: upgradeKeep });
      return b - (await pic.getCyclesBalance(id));
    };
    const first = [await upgradeCost(big), await upgradeCost(empty)];
    const second = [await upgradeCost(big), await upgradeCost(empty)];
    const third = [await upgradeCost(big), await upgradeCost(empty)];
    console.log(`upgrade cycles (20k poll votes / empty forum): first ${first.join(' / ')}, second ${second.join(' / ')}, third ${third.join(' / ')}`);
    expect(await counts()).toEqual(before); // the recount changed nothing
    // after the first upgrade, an upgrade of the forum with 20,000 poll votes costs what the empty one's does
    expect(second[0] - second[1]).toBeLessThan((first[0] - first[1]) / 10);
    expect(third[0] - third[1]).toBeLessThan((first[0] - first[1]) / 10);
  }, 300_000);
});
