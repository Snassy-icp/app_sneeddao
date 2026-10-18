// sneed_sns_forum @-mentions (spec/forum_mentions.md): a Markdown link "[@Name](…/principal?id=<p>)"
// in a thread or post records a mention of <p>; the name is only how it reads. Self-mentions,
// repeats, broken principals and plain "@name" text count for nothing; at most 10 per text; an
// edit adds only new mentions; deleted threads and posts drop out; members opt in to an SMS ping.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, wasm, admin, alice, bob, carol, user, SNEED_SNS_ROOT, unwrap, errOf, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { idlFactory as forumIdl } from '../build/sneed_sns_forum.did.js';

const SNS_W = Principal.fromText('qaa6y-5yaaa-aaaaa-aaafa-cai');
const dave = user('dave'); const eve = user('eve');
const anon = Principal.anonymous();
const directoryIdl = ({ IDL }) => IDL.Service({ set_instances: IDL.Func([IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Principal))], [], []) });
const link = (p, name = 'someone') => `[@${name}](https://app.sneeddao.com/principal?id=${p.toText()})`;
const rel = (p, name = 'someone') => `[@${name}](/principal?id=${p.toText()})`;
const ids = (page) => page.items.map((m) => [m.thread_id, m.post_id[0] ?? null]);

let pic, forumId, f, fAlice, fBob, fCarol, fDave, fAnon, TH;

describe('sneed_sns_forum: mentions', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    await install(pic, { name: 'MockForumSnsW', targetCanisterId: SNS_W });
    const govId = await install(pic, { name: 'MockForumGovernance' });
    forumId = await install(pic, { name: 'sneed_sns_forum' });
    await actorAs(pic, directoryIdl, SNS_W, admin).set_instances([[SNEED_SNS_ROOT, govId]]);
    f = actorAs(pic, forumIdl, forumId, admin);
    [fAlice, fBob, fCarol, fDave, fAnon] = [alice, bob, carol, dave, anon].map((p) => actorAs(pic, forumIdl, forumId, p));
    const F = unwrap(await f.create_forum({ title: 'Sneed', description: 'd', sns_root_canister_id: [] }));
    const T = unwrap(await f.create_topic({ forum_id: F, parent_topic_id: [], title: 'General', description: 'g' }));
    TH = unwrap(await fAlice.create_thread({ topic_id: T, title: ['Hello'], body: `Hi ${link(bob, 'Bob the Builder')} and ${rel(carol)}, and me ${link(alice)}; plain @dave does nothing` }));
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('a thread records the principals its mention links name, not the author, not plain text', async () => {
    const b = await f.get_mentions_of_user(bob, [], 10n);
    expect(ids(b)).toEqual([[TH, null]]);
    expect(b.items[0].by.toText()).toBe(alice.toText());
    expect(b.items[0].thread_title).toEqual(['Hello']);
    expect(b.items[0].excerpt).toMatch(/^Hi \[@Bob the Builder\]/);
    expect(ids(await f.get_mentions_of_user(carol, [], 10n))).toEqual([[TH, null]]); // the relative link form too
    expect((await f.get_mentions_of_user(alice, [], 10n)).items).toEqual([]); // no self-mention
    expect((await f.get_mentions_of_user(dave, [], 10n)).items).toEqual([]); // "@dave" without a link
    expect(await f.get_recent_mentions_count(bob)).toBe(1n);
  });

  it('broken, non-canonical and over-long links are ignored; a post counts each person once, at most 10', async () => {
    const t = dave.toText();
    const swapped = t.slice(0, 6) + (t[6] === 'a' ? 'b' : 'a') + t.slice(7); // checksum no longer matches
    const P0 = unwrap(await fBob.create_post(TH, [], [], [
      `[@x](https://app.sneeddao.com/principal?id=${swapped})`,
      `[@x](https://app.sneeddao.com/principal?id=${t.toUpperCase()})`,
      `[@x](https://evil.example/principal?id=${t})`,
      `[@${'n'.repeat(65)}](/principal?id=${t})`,
    ].join(' ')));
    expect((await f.get_mentions_of_user(dave, [], 10n)).items).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => user(`m${i}`));
    const P1 = unwrap(await fBob.create_post(TH, [], [], `${link(dave)} ${link(dave, 'again')} ${many.map((p) => link(p)).join(' ')}`));
    expect(ids(await f.get_mentions_of_user(dave, [], 10n))).toEqual([[TH, P1]]);
    const counted = await Promise.all(many.map(async (p) => (await f.get_mentions_of_user(p, [], 10n)).items.length));
    expect(counted).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0]); // dave plus nine more: ten per post
    expect(P0).toBeLessThan(P1);
  });

  it('newest first, paged; seen marks the count down; an edit adds only new mentions', async () => {
    const P2 = unwrap(await fCarol.create_post(TH, [], [], `${link(bob)} have a look`));
    const P3 = unwrap(await fDave.create_post(TH, [], ['Re'], `${link(bob)} and again`));
    const all = await f.get_mentions_of_user(bob, [], 10n);
    expect(ids(all)).toEqual([[TH, P3], [TH, P2], [TH, null]]);
    expect(all.items[0].title).toEqual(['Re']);
    const page1 = await f.get_mentions_of_user(bob, [], 2n);
    expect(ids(page1)).toEqual([[TH, P3], [TH, P2]]);
    expect(ids(await f.get_mentions_of_user(bob, page1.next, 2n))).toEqual([[TH, null]]);
    expect(await f.get_recent_mentions_count(bob)).toBe(3n);
    await fBob.mark_mentions_seen_up_to(all.items[0].created_at);
    expect(await f.get_last_seen_mentions_timestamp(bob)).toEqual([all.items[0].created_at]);
    expect(await f.get_recent_mentions_count(bob)).toBe(0n);
    // carol edits her post: bob is already recorded there, eve is new
    unwrap(await fCarol.update_post(P2, [], `${link(bob)} have a look, ${link(eve)} too`));
    unwrap(await fCarol.update_post(P2, [], `${link(bob)} have a look, ${link(eve)} too!`));
    expect(ids(await f.get_mentions_of_user(bob, [], 10n))).toHaveLength(3);
    expect(ids(await f.get_mentions_of_user(eve, [], 10n))).toEqual([[TH, P2]]);
    // alice edits the thread text: dave is new there
    unwrap(await fAlice.update_thread(TH, ['Hello'], `Hi ${link(bob)} and ${link(dave)}`));
    expect(ids(await f.get_mentions_of_user(dave, [], 10n))[0]).toEqual([TH, null]);
    expect(await f.get_recent_mentions_count(bob)).toBe(0n);
  });

  it('a deleted post drops out of the list and the count', async () => {
    const P4 = unwrap(await fCarol.create_post(TH, [], [], `${link(eve)} one more`));
    expect(await f.get_recent_mentions_count(eve)).toBe(2n);
    unwrap(await fCarol.delete_post(P4));
    expect(await f.get_recent_mentions_count(eve)).toBe(1n);
    expect(ids(await f.get_mentions_of_user(eve, [], 10n)).map(([, p]) => p)).not.toContain(P4);
  });

  it('SMS pings are opt-in, per member', async () => {
    expect(Object.keys(errOf(await fAnon.set_mention_sms(true)))[0]).toBe('Unauthorized');
    expect(await f.get_mention_sms(bob)).toBe(false);
    unwrap(await fBob.set_mention_sms(true));
    unwrap(await fDave.set_mention_sms(true));
    expect(await f.get_mention_sms(bob)).toBe(true);
    expect((await f.get_mention_sms_opted_in([alice, bob, carol, dave])).map((p) => p.toText())).toEqual([bob.toText(), dave.toText()]);
    unwrap(await fDave.set_mention_sms(false));
    expect((await f.get_mention_sms_opted_in([bob, dave])).map((p) => p.toText())).toEqual([bob.toText()]);
  });

  it('queries are refused as update calls', async () => {
    const upd = actorAs(pic, asUpdates(forumIdl), forumId, alice);
    for (const call of [() => upd.get_mentions_of_user(bob, [], 1n), () => upd.get_recent_mentions_count(bob), () => upd.get_last_seen_mentions_timestamp(bob), () => upd.get_mention_sms(bob), () => upd.get_mention_sms_opted_in([bob])]) {
      expect(await refusedAtIngress(call())).toBe(true);
    }
  });

  it('an upgrade keeps mentions, seen marks and SMS choices', async () => {
    const before = await f.get_mentions_of_user(bob, [], 10n);
    await pic.upgradeCanister({ sender: admin, canisterId: forumId, wasm: wasm('sneed_sns_forum'), arg: IDL.encode([], []), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    expect(await f.get_mentions_of_user(bob, [], 10n)).toEqual(before);
    expect(await f.get_recent_mentions_count(bob)).toBe(0n);
    expect(await f.get_mention_sms(bob)).toBe(true);
  });
});
