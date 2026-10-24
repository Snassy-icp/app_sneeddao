// sneed_sns_forum: emoji reactions on posts and threads, and up/down votes and tips on threads
// themselves (spec/pipeline.md "Forum reactions, thread tips and votes"). All of it is additive: new
// methods and records beside the post ones, which stay as they were (TACO DAO builds on this API).
//   - a member gives a target (a post, or a thread's own opening text) a set of at most 10 emojis,
//     each exactly one grapheme cluster (ZWJ sequences, skin tones, flags, keycaps are one); text,
//     whitespace, two emojis side by side and over-long strings are refused
//   - every target keeps running counts, moved by the difference when a member changes their set;
//     they always equal the sum over members, also under many members and many changes
//   - at most 100 different emojis per target; anonymous callers, deleted and unknown targets refused
//   - "react" is rate limited like the other writes (refused at ingress when the bucket is empty)
//   - thread votes mirror post votes (reachable neurons, voting power, change, retract, by neuron)
//   - thread tips mirror post tips (the transfer is read on the ledger; a block backs one tip of
//     either kind; unreadable blocks are unverified and verify_thread_tip retries)
//   - an upgrade from production (proposal #469) keeps everything and starts with no reactions;
//     an upgrade of this build keeps reactions, thread votes and thread tips
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, wasm, admin, alice, bob, carol, user, account, ICP_LEDGER_ID, SNEED_SNS_ROOT, unwrap, errOf, refusedAtIngress } from '../lib/pic.js';
import { idlFactory as forumIdl } from '../build/sneed_sns_forum.did.js';

const KEEP = { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] };
const SNS_W = Principal.fromText('qaa6y-5yaaa-aaaaa-aaafa-cai');
const anon = Principal.anonymous();
const dave = user('dave');
const E8S = 100_000_000n;
const nid = (n) => new Uint8Array(32).fill(n);
const NEURON = (id) => ({ id });
const N_A = nid(11); const N_A2 = nid(12); const N_B = nid(13);

const rateLimitIdl = ({ IDL: I }) => I.Service({ admin_set_rate_limit: I.Func([I.Text, I.Opt(I.Record({ capacity: I.Nat, per_minute: I.Nat }))], [I.Variant({ ok: I.Null, err: I.Reserved })], []) });
const directoryIdl = ({ IDL: I }) => I.Service({ set_instances: I.Func([I.Vec(I.Tuple(I.Principal, I.Principal))], [], []) });
const neuronsIdl = ({ IDL: I }) => I.Service({
  add_neuron: I.Func([I.Vec(I.Nat8), I.Principal, I.Vec(I.Principal), I.Nat64, I.Nat64], [], []),
  set_stake: I.Func([I.Vec(I.Nat8), I.Nat64], [], []),
});
const TransferArg = (I) => I.Record({ from_subaccount: I.Opt(I.Vec(I.Nat8)), to: I.Record({ owner: I.Principal, subaccount: I.Opt(I.Vec(I.Nat8)) }), amount: I.Nat, fee: I.Opt(I.Nat), memo: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64) });
const icpMockIdl = ({ IDL: I }) => I.Service({
  icrc1_transfer: I.Func([TransferArg(I)], [I.Variant({ Ok: I.Nat, Err: I.Reserved })], []),
  set_archived_upto: I.Func([I.Nat], [], []),
});

const err = (r) => { const e = errOf(r); const k = Object.keys(e)[0]; return `${k}: ${e[k]}`; };
const P = (id) => ({ post: id });
const TH = (id) => ({ thread: id });
const send = async (from, to, amount) => unwrap(await icpAs(from).icrc1_transfer({ from_subaccount: [], to: account(to), amount, fee: [], memo: [], created_at_time: [] }));
const countsOf = (r) => Object.fromEntries(r.counts.map((c) => [c.emoji, Number(c.count)]));

let pic, forumId, govId, f, fas, gov, icpAs;
let F, TOP, TH1, TH2, P1, P2;

async function forumWith(name) {
  const id = await install(pic, { name });
  for (const a of ['thread', 'post', 'edit', 'poll', 'tip', 'vote', 'react']) {
    await actorAs(pic, rateLimitIdl, id, admin).admin_set_rate_limit(a, [{ capacity: 0n, per_minute: 0n }]).catch(() => {});
  }
  return id;
}

describe('sneed_sns_forum: reactions, thread votes and thread tips', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    await install(pic, { name: 'MockForumSnsW', targetCanisterId: SNS_W });
    govId = await install(pic, { name: 'MockForumGovernance' });
    await install(pic, { name: 'MockIcpLedger', targetCanisterId: ICP_LEDGER_ID });
    await actorAs(pic, directoryIdl, SNS_W, admin).set_instances([[SNEED_SNS_ROOT, govId]]);
    gov = actorAs(pic, neuronsIdl, govId, admin);
    icpAs = (p) => actorAs(pic, icpMockIdl, ICP_LEDGER_ID, p);
    forumId = await forumWith('sneed_sns_forum');
    f = actorAs(pic, forumIdl, forumId, admin);
    fas = (p) => actorAs(pic, forumIdl, forumId, p);
    F = unwrap(await f.create_forum({ title: 'Sneed', description: 'd', sns_root_canister_id: [] }));
    TOP = unwrap(await f.create_topic({ forum_id: F, parent_topic_id: [], title: 'General', description: 'g' }));
    TH1 = unwrap(await fas(alice).create_thread({ topic_id: TOP, title: ['First'], body: 'opening text' }));
    TH2 = unwrap(await fas(bob).create_thread({ topic_id: TOP, title: ['Second'], body: 'more' }));
    P1 = unwrap(await fas(bob).create_post(TH1, [], [], 'bob replies'));
    P2 = unwrap(await fas(carol).create_post(TH1, [P1], [], 'carol replies'));
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  describe('reactions', () => {
    it('one emoji = one grapheme cluster: ZWJ, skin tones, flags, keycaps pass; text, spaces and pairs do not', async () => {
      const good = ['👍', '👍🏽', '👩‍💻', '👨‍👩‍👧‍👦', '🇲🇹', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '1️⃣', '#️⃣', '❤️', '❤', '🏳️‍🌈', '👩🏽‍❤️‍💋‍👨🏻', '🫠', '⭐', '©️'];
      for (const e of good) expect(unwrap(await fas(dave).set_reactions(P(P1), [e])), e).toEqual([e]);
      const bad = ['', ' ', 'a', 'hi', '1', '#', '👍👍', '👍 ', ' 👍', '🇲', '🇲🇹🇲🇹', '‍', '👍‍', '‍👍', '🏽', '️', 'é', '中', '👍a', '🏴󠁧󠁢', '\n'];
      for (const e of bad) expect(err(await fas(dave).set_reactions(P(P1), [e])), JSON.stringify(e)).toMatch(/InvalidInput: Not a single emoji/);
      // too long for the ingress guard (bytes), refused before it runs
      expect(await refusedAtIngress(fas(dave).set_reactions(P(P1), ['👍'.repeat(20)]))).toBe(true);
      expect(await refusedAtIngress(fas(dave).react(P(P1), 'x'.repeat(65), true))).toBe(true);
      unwrap(await fas(dave).set_reactions(P(P1), []));
      expect((await f.get_reactions([P(P1)]))[0].counts).toEqual([]);
    });

    it('sets: add, remove, replace; repeats dropped; at most 10; counts and "mine" follow', async () => {
      expect(unwrap(await fas(alice).set_reactions(P(P1), ['👍', '🎉', '👍']))).toEqual(['👍', '🎉']);
      expect(unwrap(await fas(bob).react(P(P1), '👍', true))).toEqual(['👍']);
      expect(unwrap(await fas(bob).react(P(P1), '👍', true))).toEqual(['👍']); // already given: no change
      expect(countsOf((await f.get_reactions([P(P1)]))[0])).toEqual({ '👍': 2, '🎉': 1 });
      // replace alice's set: 👍 stays, 🎉 goes, 🚀 comes
      expect(unwrap(await fas(alice).set_reactions(P(P1), ['🚀', '👍']))).toEqual(['🚀', '👍']);
      expect(countsOf((await f.get_reactions([P(P1)]))[0])).toEqual({ '👍': 2, '🚀': 1 });
      // remove one
      expect(unwrap(await fas(bob).react(P(P1), '👍', false))).toEqual([]);
      expect(unwrap(await fas(bob).react(P(P1), '😀', false))).toEqual([]); // not given: no change
      expect(countsOf((await f.get_reactions([P(P1)]))[0])).toEqual({ '👍': 1, '🚀': 1 });
      // counts keep the order emojis were first given
      expect((await f.get_reactions([P(P1)]))[0].counts.map((c) => c.emoji)).toEqual(['👍', '🚀']);
      // mine, for a page of targets (none where none)
      expect(await f.get_reactions_of_user(alice, [P(P1), P(P2), TH(TH1)])).toEqual([
        { target: P(P1), emojis: ['🚀', '👍'] }, { target: P(P2), emojis: [] }, { target: TH(TH1), emojis: [] }]);
      expect(await f.get_reactions_of_user(user('nobody'), [P(P1)])).toEqual([{ target: P(P1), emojis: [] }]);
      // at most 10 per member
      const ten = ['😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆', '😉', '😊'];
      expect(unwrap(await fas(carol).set_reactions(P(P2), ten))).toEqual(ten);
      expect(err(await fas(carol).react(P(P2), '😋', true))).toMatch(/InvalidInput: At most 10 reactions per member/);
      expect(await refusedAtIngress(fas(carol).set_reactions(P(P2), [...ten, '😋']))).toBe(true); // over the cap: refused before it runs
      expect((await f.get_reactions([P(P2)]))[0].counts.length).toBe(10);
      unwrap(await fas(carol).set_reactions(P(P2), []));
      expect((await f.get_reactions([P(P2)]))[0].counts).toEqual([]);
    });

    it('a thread has its own reactions, apart from its posts', async () => {
      unwrap(await fas(bob).react(TH(TH1), '🔥', true));
      expect(countsOf((await f.get_reactions([TH(TH1)]))[0])).toEqual({ '🔥': 1 });
      expect(countsOf((await f.get_reactions([P(P1)]))[0])).toEqual({ '👍': 1, '🚀': 1 });
      expect((await f.get_reactions_of_user(bob, [TH(TH1), P(P1)])).map((r) => r.emojis)).toEqual([['🔥'], []]);
      // a post id is not a thread and a thread id not a post
      expect(err(await fas(bob).react(TH(P1), '🔥', true))).toMatch(/NotFound: Thread not found/);
      expect(err(await fas(bob).react(P(TH1), '🔥', true))).toMatch(/NotFound: Post not found/);
      expect(err(await fas(bob).react(P(999n), '🔥', true))).toMatch(/NotFound/);
    });

    it('anonymous callers, deleted posts and posts of deleted threads are refused; their counts are hidden', async () => {
      expect(err(await fas(anon).react(P(P1), '👍', true))).toMatch(/Unauthorized/);
      const t = unwrap(await fas(alice).create_thread({ topic_id: TOP, title: ['Doomed'], body: 'x' }));
      const p = unwrap(await fas(bob).create_post(t, [], [], 'y'));
      unwrap(await fas(carol).react(P(p), '👍', true));
      unwrap(await fas(carol).react(TH(t), '👍', true));
      unwrap(await f.delete_post(p));
      expect(err(await fas(carol).react(P(p), '🎉', true))).toMatch(/NotFound: Post not found/);
      expect((await f.get_reactions([P(p)]))[0].counts).toEqual([]);
      unwrap(await f.undelete_post(p));
      expect(countsOf((await f.get_reactions([P(p)]))[0])).toEqual({ '👍': 1 }); // kept, shown again
      unwrap(await f.delete_thread(t));
      expect(err(await fas(carol).react(TH(t), '🎉', true))).toMatch(/NotFound: Thread not found/);
      expect(err(await fas(carol).react(P(p), '🎉', true))).toMatch(/NotFound: Post not found/); // its thread is gone
      expect((await f.get_reactions([TH(t), P(p)])).map((r) => r.counts)).toEqual([[], []]);
    });

    it('counts stay equal to the sum of everyone\'s sets under many members and many changes', async () => {
      const pool = ['👍', '👎', '😂', '❤️', '🎉', '🚀', '👀', '🙏', '🔥', '💯', '🤔', '😢', '👩‍💻', '🇲🇹'];
      const members = Array.from({ length: 24 }, (_, i) => user(`reactor-${i}`));
      const t = unwrap(await fas(alice).create_thread({ topic_id: TOP, title: ['Busy'], body: 'react here' }));
      const target = TH(t);
      const sets = new Map();
      let seed = 7;
      const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
      for (let round = 0; round < 4; round++) {
        await Promise.all(members.map(async (m) => {
          let want;
          if (rnd(4) === 0) { // toggle one
            const e = pool[rnd(pool.length)];
            const cur = sets.get(m.toText()) || [];
            const on = !cur.includes(e);
            if (on && cur.length >= 10) return;
            want = unwrap(await fas(m).react(target, e, on));
          } else {
            const k = rnd(6);
            const s = []; for (let j = 0; j < k; j++) s.push(pool[rnd(pool.length)]);
            want = unwrap(await fas(m).set_reactions(target, s));
          }
          sets.set(m.toText(), want);
        }));
      }
      const expected = {};
      for (const s of sets.values()) for (const e of s) expected[e] = (expected[e] || 0) + 1;
      expect(countsOf((await f.get_reactions([target]))[0])).toEqual(expected);
      const mine = await f.get_reactions_of_user(members[3], [target]);
      expect(mine[0].emojis).toEqual(sets.get(members[3].toText()));
    }, 300_000);

    it('at most 100 different emojis on one target; existing ones can still be given', async () => {
      const t = unwrap(await fas(alice).create_thread({ topic_id: TOP, title: ['Many'], body: 'many emojis' }));
      const emojis = Array.from({ length: 101 }, (_, i) => String.fromCodePoint(0x1F400 + i)); // 🐀 … animals and more
      for (let k = 0; k < 10; k++) unwrap(await fas(user(`many-${k}`)).set_reactions(TH(t), emojis.slice(k * 10, k * 10 + 10)));
      expect((await f.get_reactions([TH(t)]))[0].counts.length).toBe(100);
      expect(err(await fas(user('many-x')).react(TH(t), emojis[100], true))).toMatch(/InvalidInput: This already has 100 different reactions/);
      expect(unwrap(await fas(user('many-x')).react(TH(t), emojis[5], true))).toEqual([emojis[5]]);
      // dropping one frees a slot
      unwrap(await fas(user('many-0')).react(TH(t), emojis[0], false));
      expect(unwrap(await fas(user('many-x')).react(TH(t), emojis[100], true))).toEqual([emojis[5], emojis[100]]);
    });

    it('batch reads are bounded (200 targets) and queries only', async () => {
      const targets = Array.from({ length: 250 }, () => P(P1));
      expect((await f.get_reactions(targets)).length).toBe(200);
      expect((await f.get_reactions_of_user(alice, targets)).length).toBe(200);
    });

    it('"react" is rate limited per caller, at ingress', async () => {
      const r = actorAs(pic, rateLimitIdl, forumId, admin);
      unwrap(await r.admin_set_rate_limit('react', [{ capacity: 2n, per_minute: 1n }]));
      expect((await f.get_rate_limits()).find(([a]) => a === 'react')[1]).toEqual({ capacity: 2n, per_minute: 1n });
      const m = user('rate-reactor');
      unwrap(await fas(m).react(P(P1), '👍', true));
      unwrap(await fas(m).set_reactions(P(P1), ['👍', '🎉']));
      expect(await refusedAtIngress(fas(m).react(P(P1), '👀', true))).toBe(true);
      await pic.advanceTime(61_000); await pic.tick(2);
      unwrap(await fas(m).react(P(P1), '👀', true));
      unwrap(await r.admin_set_rate_limit('react', [{ capacity: 0n, per_minute: 0n }]));
    });
  });

  describe('votes on threads', () => {
    it('reachable neurons vote on the thread itself; change, partial, retract keep the scores right', async () => {
      await gov.add_neuron(N_A, alice, [], 1000n, 200n);
      await gov.add_neuron(N_A2, alice, [], 500n, 200n);
      await gov.add_neuron(N_B, bob, [dave], 300n, 200n);
      const score = async (id) => { const s = (await f.get_thread_scores([id]))[0]; return [s.upvote_score, s.downvote_score]; };
      expect(await score(TH1)).toEqual([0n, 0n]);
      expect(err(await fas(carol).vote_on_thread(TH1, { upvote: null }))).toMatch(/Unauthorized: No accessible neurons found/);
      unwrap(await fas(alice).vote_on_thread(TH1, { upvote: null }));
      expect(await score(TH1)).toEqual([1500n, 0n]);
      unwrap(await fas(alice).vote_on_thread(TH1, { downvote: null }));
      expect(await score(TH1)).toEqual([0n, 1500n]);
      unwrap(await fas(dave).vote_on_thread(TH1, { upvote: null })); // the hotkey votes with bob's neuron
      expect(await score(TH1)).toEqual([300n, 1500n]);
      unwrap(await fas(alice).vote_on_thread_with_neurons(TH1, { upvote: null }, [NEURON(N_A)]));
      expect(await score(TH1)).toEqual([1300n, 500n]);
      unwrap(await fas(alice).vote_on_thread_with_neurons(TH1, { downvote: null }, [NEURON(N_B)])); // not hers: ignored
      expect(await score(TH1)).toEqual([1300n, 500n]);
      await gov.set_stake(N_A, 2000n);
      unwrap(await fas(alice).vote_on_thread_with_neurons(TH1, { upvote: null }, [NEURON(N_A)]));
      expect(await score(TH1)).toEqual([2300n, 500n]);
      // the votes, all and by neuron
      const all = await f.get_votes_on_thread(TH1);
      expect(all.length).toBe(3);
      expect(all.find((v) => v.neuron_id.id[0] === 13).voter_principal.toText()).toBe(dave.toText());
      const mine = await f.get_votes_on_thread_for_neurons(TH1, [NEURON(N_A), NEURON(N_A2), NEURON(nid(99))]);
      expect(mine.thread_id).toBe(TH1);
      expect(mine.neuron_votes.map((v) => [v.neuron_id.id[0], Object.keys(v.vote_type)[0], v.voting_power]).sort()).toEqual([[11, 'upvote', 2000n], [12, 'downvote', 500n]]);
      // the thread's posts are untouched, and their votes do not count for the thread
      const p1 = (await f.get_post(P1))[0];
      expect([p1.upvote_score, p1.downvote_score]).toEqual([0n, 0n]);
      unwrap(await fas(alice).vote_on_post(P1, { upvote: null }));
      expect(await score(TH1)).toEqual([2300n, 500n]);
      // retract
      unwrap(await fas(alice).retract_thread_vote_with_neurons(TH1, [NEURON(N_A)]));
      expect(await score(TH1)).toEqual([300n, 500n]);
      expect(err(await fas(alice).retract_thread_vote_with_neurons(TH1, [NEURON(N_A)]))).toMatch(/NotFound: No votes found to retract/);
      unwrap(await fas(alice).retract_thread_vote(TH1));
      expect(await score(TH1)).toEqual([300n, 0n]);
      expect(err(await fas(alice).retract_thread_vote(TH1))).toMatch(/NotFound: No votes found to retract/);
      // batch scores: several threads, unknown ones left out
      expect((await f.get_thread_scores([TH1, TH2, 999n])).map((s) => s.thread_id)).toEqual([TH1, TH2]);
    });

    it('unknown and deleted threads, anonymous callers are refused', async () => {
      expect(err(await fas(alice).vote_on_thread(999n, { upvote: null }))).toMatch(/NotFound: Thread not found/);
      expect(err(await fas(anon).vote_on_thread(TH1, { upvote: null }))).toMatch(/Unauthorized/);
      const t = unwrap(await fas(alice).create_thread({ topic_id: TOP, title: ['Gone'], body: 'x' }));
      unwrap(await f.delete_thread(t));
      expect(err(await fas(alice).vote_on_thread(t, { upvote: null }))).toMatch(/NotFound: Thread not found/);
      expect(await f.get_thread_scores([t])).toEqual([]);
    });
  });

  describe('tips on threads', () => {

    it('a tip on a thread goes to its author, is read on the ledger, and is listed and summed', async () => {
      const i = await send(bob, alice, E8S);
      const id = unwrap(await fas(bob).create_thread_tip(alice, TH1, ICP_LEDGER_ID, E8S, [i]));
      const t = (await f.get_thread_tip(id))[0];
      expect(t).toMatchObject({ id, thread_id: TH1, amount: E8S, transaction_block_index: [i], verified: [true], verification_note: [] });
      expect(t.from_principal.toText()).toBe(bob.toText());
      expect(t.to_principal.toText()).toBe(alice.toText());
      // not a post tip: the post lists are unchanged
      expect(await f.get_tip(id)).toEqual([]);
      expect(await f.get_tips_by_thread(TH1)).toEqual([]);
      expect((await f.get_tips_on_thread_page(TH1, [], 0n)).items.map((x) => x.id)).toEqual([id]);
      expect((await f.get_thread_tips_given_by_user_page(bob, [], 0n)).items.map((x) => x.id)).toEqual([id]);
      expect((await f.get_thread_tips_received_by_user_page(alice, [], 0n)).items.map((x) => x.id)).toEqual([id]);
      expect(await f.get_thread_tip_totals([TH1, TH2])).toEqual([
        { thread_id: TH1, tokens: [{ token_ledger_principal: ICP_LEDGER_ID, total_amount: E8S, tip_count: 1n }] },
        { thread_id: TH2, tokens: [] }]);
      // the block backs this tip only, for posts too
      expect(err(await fas(bob).create_thread_tip(alice, TH1, ICP_LEDGER_ID, E8S, [i]))).toMatch(/AlreadyExists: Block \d+ of this ledger is already the transfer of tip/);
      expect(err(await fas(bob).create_tip(bob, P1, ICP_LEDGER_ID, E8S, [i]))).toMatch(/AlreadyExists/);
      // the ICRC-3 log has it
      const types = (await f.icrc3_supported_block_types()).map((b) => b.block_type);
      expect(types).toEqual(expect.arrayContaining(['sneedforum_thread_tip', 'sneedforum_thread_tip_verified', 'sneedforum_thread_tip_rejected']));
    });

    it('wrong recipient, amount or sender, deleted threads and anonymous callers are refused', async () => {
      const i = await send(bob, alice, E8S);
      expect(err(await fas(bob).create_thread_tip(carol, TH1, ICP_LEDGER_ID, E8S, [i]))).toMatch(/InvalidInput: A tip goes to the thread's author/);
      expect(err(await fas(bob).create_thread_tip(alice, TH1, ICP_LEDGER_ID, 2n * E8S, [i]))).toMatch(/InvalidInput: Tip not recorded: .*moved 100000000, not 200000000/);
      expect(err(await fas(carol).create_thread_tip(alice, TH1, ICP_LEDGER_ID, E8S, [i]))).toMatch(/not sent from the tipper's main account/);
      expect(err(await fas(anon).create_thread_tip(alice, TH1, ICP_LEDGER_ID, E8S, [i]))).toMatch(/Unauthorized/);
      expect(err(await fas(bob).create_thread_tip(alice, 999n, ICP_LEDGER_ID, E8S, [i]))).toMatch(/NotFound: Thread not found/);
      const t = unwrap(await fas(alice).create_thread({ topic_id: TOP, title: ['Closed'], body: 'x' }));
      unwrap(await f.delete_thread(t));
      expect(err(await fas(bob).create_thread_tip(alice, t, ICP_LEDGER_ID, E8S, [i]))).toMatch(/NotFound: Thread not found/);
      // the block is still free for a right tip
      unwrap(await fas(bob).create_thread_tip(alice, TH1, ICP_LEDGER_ID, E8S, [i]));
    });

    it('a tip without a block is unverified and counts nowhere; verify_thread_tip settles it', async () => {
      const id = unwrap(await fas(bob).create_thread_tip(alice, TH1, ICP_LEDGER_ID, 3n * E8S, []));
      expect((await f.get_thread_tip(id))[0]).toMatchObject({ verified: [false], verification_note: ['No block index was given'] });
      expect(unwrap(await fas(bob).verify_thread_tip(id))).toBe(false);
      const totals = (await f.get_thread_tip_totals([TH1]))[0].tokens[0];
      expect(totals.tip_count).toBe(2n); // the two verified ones of the tests above
      expect(err(await fas(bob).verify_thread_tip(999n))).toMatch(/NotFound: Tip not found/);
      const ok = unwrap(await fas(bob).create_thread_tip(alice, TH1, ICP_LEDGER_ID, E8S, [await send(bob, alice, E8S)]));
      expect(unwrap(await fas(carol).verify_thread_tip(ok))).toBe(true); // verified stays verified
    });

    it('thread tips page newest first', async () => {
      const page1 = await f.get_tips_on_thread_page(TH1, [], 2n);
      expect(page1.items.length).toBe(2);
      expect(page1.items[0].id > page1.items[1].id).toBe(true);
      const page2 = await f.get_tips_on_thread_page(TH1, page1.next, 2n);
      expect(page2.items.every((t) => t.id < page1.items[1].id)).toBe(true);
    });
  });

  describe('upgrades', () => {
    it('this build upgrades itself and keeps reactions, thread votes and thread tips', async () => {
      const before = [await f.get_reactions([P(P1), TH(TH1)]), await f.get_thread_scores([TH1]), await f.get_votes_on_thread(TH1), await f.get_tips_on_thread_page(TH1, [], 0n)];
      await pic.upgradeCanister({ sender: admin, canisterId: forumId, wasm: wasm('sneed_sns_forum'), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
      const after = [await f.get_reactions([P(P1), TH(TH1)]), await f.get_thread_scores([TH1]), await f.get_votes_on_thread(TH1), await f.get_tips_on_thread_page(TH1, [], 0n)];
      expect(after).toEqual(before);
      expect(after[0][0].counts.length).toBeGreaterThan(0);
    });

    it('production (#469) upgrades with keep: posts, votes and tips stay; reactions start empty and work', async () => {
      const oldId = await forumWith('sneed_sns_forum_p469');
      const o = actorAs(pic, forumIdl, oldId, admin);
      const oas = (p) => actorAs(pic, forumIdl, oldId, p);
      const of = unwrap(await o.create_forum({ title: 'Old', description: 'd', sns_root_canister_id: [] }));
      const ot = unwrap(await o.create_topic({ forum_id: of, parent_topic_id: [], title: 'T', description: 'd' }));
      const th = unwrap(await oas(alice).create_thread({ topic_id: ot, title: ['Old thread'], body: 'b' }));
      const p = unwrap(await oas(bob).create_post(th, [], [], 'old post'));
      unwrap(await oas(alice).vote_on_post(p, { upvote: null }));
      const tipBlock = await send(alice, bob, E8S);
      const tip = unwrap(await oas(alice).create_tip(bob, p, ICP_LEDGER_ID, E8S, [tipBlock]));
      const snapshot = async () => [await o.get_thread(th), await o.get_posts_by_thread(th), await o.get_post_votes(p), await o.get_tips_by_post(p), await o.get_stats(), await o.get_current_counter()];
      const before = await snapshot();
      await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm('sneed_sns_forum'), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
      expect(await snapshot()).toEqual(before);
      expect((await o.get_reactions([P(p), TH(th)])).map((r) => r.counts)).toEqual([[], []]);
      unwrap(await oas(carol).react(P(p), '👍', true));
      expect(countsOf((await o.get_reactions([P(p)]))[0])).toEqual({ '👍': 1 });
      unwrap(await oas(alice).vote_on_thread(th, { upvote: null }));
      expect((await o.get_thread_scores([th]))[0].upvote_score).toBe(2500n);
      // the old tip's block stays claimed for thread tips too
      expect(err(await oas(alice).create_thread_tip(alice, th, ICP_LEDGER_ID, E8S, [tipBlock]))).toMatch(new RegExp(`AlreadyExists: .*tip ${tip}$`));
    });
  });
});
