// The Sneed forum's ICRC-3 activity log (spec/forum_icrc3.md): an empty log with the documented
// catalogue; one block per verified tip (at creation, or later through verify_tip, with the
// ledger block), per tip that verify_tip rejects, per moderation act (admin deletes and undeletes,
// edits of someone else's content, with hashes of the texts instead of the texts), per admin
// list and configuration change, per forum or topic created or changed (also by the SNS setup
// and special topics), per proposals-topic change and per proposal thread; nothing for ordinary
// threads, posts, votes, polls, unverified tips, the author's own edits and deletions, and
// refused calls; the hash chain and certified tip verify (lib/icrc3.js); spills into archives
// co-controlled by SNS root; the ingress guard; an upgrade keeps the log; and an upgrade from
// the production build (src/sneed_sns_forum at b483932c, module hash 89d0f0e7…,
// build/sneed_sns_forum_prod.wasm) with wasm_memory_persistence = keep keeps forums, topics,
// threads, posts, tips and mentions and starts an empty log.
// FORUM_WASM=sneed_sns_forum_prod npx vitest run tests/forum-icrc3.test.js runs it against the production code.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, account, admin, alice, bob, carol, user, ICP_LEDGER_ID, SNEED_SNS_ROOT, T, unwrap, errOf, wasm, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { ser } from '../lib/hub.js';
import { archiveIdl, btype, tx, verifyLog, icrc3Service, sha256 } from '../lib/icrc3.js';
import { idlFactory as forumIdl } from '../build/sneed_sns_forum.did.js';

const FORUM_WASM = process.env.FORUM_WASM || 'sneed_sns_forum';
const BLOCK_TYPES_URL = 'https://app.sneeddao.com/api/sneed_sns_forum#block-types';
const CATALOGUE = [
  'tip', 'tip_verified', 'tip_rejected', 'delete', 'undelete', 'edit', 'forum_create', 'forum_update', 'topic_create', 'topic_update',
  'proposals_topic_set', 'proposals_topic_remove', 'proposal_thread_create', 'admin_add', 'admin_remove', 'config_update',
].map((t) => `sneedforum_${t}`);
const SNS_W = Principal.fromText('qaa6y-5yaaa-aaaaa-aaafa-cai');
const E8S = 100_000_000n;
const KEEP = { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] };
const dave = user('dave');
const root2 = user('forum-icrc3-root2');
const root3 = user('forum-icrc3-root3');
const nid = (n) => new Uint8Array(32).fill(n);

const hex = (b) => Buffer.from(b).toString('hex');
const P = (p) => hex(p.toUint8Array());
const H = (text) => hex(sha256(Buffer.from(text, 'utf8')));
const plain = (v) => {
  if ('Nat' in v) return v.Nat;
  if ('Int' in v) return v.Int;
  if ('Text' in v) return v.Text;
  if ('Blob' in v) return hex(v.Blob);
  if ('Array' in v) return v.Array.map(plain);
  return Object.fromEntries(v.Map.map(([k, x]) => [k, plain(x)]));
};
const mention = (p, name) => `[@${name}](https://app.sneeddao.com/principal?id=${p.toText()})`;

// the forum's interface plus the log's (so the test runs against a build without it, and fails there)
const LogEntry = IDL.Record({ id: IDL.Nat, ts: IDL.Int, level: IDL.Variant({ info: IDL.Null, error: IDL.Null }), cid: IDL.Nat, caller: IDL.Principal, message: IDL.Text });
const fullIdl = ({ IDL: I }) => I.Service({
  ...Object.fromEntries(forumIdl({ IDL: I })._fields),
  ...icrc3Service(I),
  get_log: I.Func([I.Nat, I.Nat], [I.Vec(LogEntry)], ['query']),
});
const directoryIdl = ({ IDL: I }) => I.Service({ set_instances: I.Func([I.Vec(I.Tuple(I.Principal, I.Principal))], [], []) });
const neuronsIdl = ({ IDL: I }) => I.Service({ add_neuron: I.Func([I.Vec(I.Nat8), I.Principal, I.Vec(I.Principal), I.Nat64, I.Nat64], [], []) });
const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const icpIdl = ({ IDL: I }) => I.Service({
  icrc1_transfer: I.Func([I.Record({ from_subaccount: I.Opt(I.Vec(I.Nat8)), to: Account, amount: I.Nat, fee: I.Opt(I.Nat), memo: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64) })], [I.Variant({ Ok: I.Nat, Err: I.Reserved })], []),
});

let pic, rootKey, appSubnet, forumId, icpId, govId;
const as = (p, id = forumId) => actorAs(pic, fullIdl, id, p);
const archiveActor = (id) => actorAs(pic, archiveIdl, id, admin);
const send = async (from, to, amount) => unwrap(await actorAs(pic, icpIdl, icpId, from).icrc1_transfer({ from_subaccount: [], to: account(to), amount, fee: [], memo: [], created_at_time: [] }));
const advance = async (seconds, ticks = 2) => { await pic.advanceTime(seconds * 1000); await pic.tick(ticks); };

/// The whole log, verified (certificate, tree, phash chain, catalogue), as plain records { i, t, ...tx }.
const rawLog = async (id = forumId) => (await verifyLog(as(admin, id), id, rootKey, archiveActor)).blocks;
const verifiedLog = async (id = forumId) => (await rawLog(id)).map((b, i) => ({ i, t: btype(b).replace(/^sneedforum_/, ''), ...plain(tx(b)) }));
const logLength = async (id = forumId) => Number((await as(admin, id).icrc3_log_status()).log_length);
const since = async (mark, id = forumId) => (await verifiedLog(id)).slice(mark);
const strip = (blocks) => blocks.map(({ i, ...b }) => b);

let F, TOPIC, TH, P_BOB;

beforeAll(async () => {
  ({ pic, rootKey, appSubnet } = await createPic());
  await install(pic, { name: 'MockForumSnsW', targetCanisterId: SNS_W });
  govId = await install(pic, { name: 'MockForumGovernance' });
  icpId = await install(pic, { name: 'MockIcpLedger', targetCanisterId: ICP_LEDGER_ID });
  await actorAs(pic, directoryIdl, SNS_W, admin).set_instances([[SNEED_SNS_ROOT, govId], [root2, govId], [root3, govId]]);
  await actorAs(pic, neuronsIdl, govId, admin).add_neuron(nid(1), alice, [], 1000n, 200n);
  forumId = await install(pic, { name: FORUM_WASM, cycles: 20n * T, targetSubnetId: appSubnet });
}, 120_000);
afterAll(async () => { await pic?.tearDown(); });

describe('fresh install', () => {
  it('has an empty log, the documented catalogue and ICRC-3 among its standards', async () => {
    expect(await as(alice).icrc3_log_status()).toMatchObject({ log_length: 0n, live_blocks: 0n, archives: [], history_imported: false, last_block_hash: [] });
    expect(await as(alice).icrc3_get_tip_certificate()).toEqual([]);
    expect(await as(alice).icrc3_supported_block_types()).toEqual(CATALOGUE.map((block_type) => ({ block_type, url: BLOCK_TYPES_URL })));
    expect((await as(alice).icrc10_supported_standards()).map((s) => s.name)).toEqual(['ICRC-3', 'ICRC-10']);
    expect(await as(alice).icrc3_get_blocks([{ start: 0n, length: 10n }])).toEqual({ log_length: 0n, blocks: [], archived_blocks: [] });
    expect(await as(alice).icrc3_get_archives({ from: [] })).toEqual([]);
  });
});

describe('structure, admins and configuration', () => {
  it('forums and topics: created and changed by admins, one block each; refused calls append nothing', async () => {
    expect(errOf(await as(bob).create_forum({ title: 'No', description: 'd', sns_root_canister_id: [] }))).toHaveProperty('Unauthorized');
    expect(errOf(await as(admin).create_forum({ title: '', description: 'd', sns_root_canister_id: [] }))).toHaveProperty('InvalidInput');
    expect(await logLength()).toBe(0);
    F = unwrap(await as(admin).create_forum({ title: 'Sneed', description: 'The Sneed DAO forum', sns_root_canister_id: [] }));
    TOPIC = unwrap(await as(admin).create_topic({ forum_id: F, parent_topic_id: [], title: 'General', description: 'Talk' }));
    const SUB = unwrap(await as(admin).create_topic({ forum_id: F, parent_topic_id: [TOPIC], title: 'Sub', description: 's' }));
    expect(errOf(await as(bob).create_topic({ forum_id: F, parent_topic_id: [], title: 'X', description: 'x' }))).toHaveProperty('Unauthorized');
    expect(errOf(await as(admin).create_topic({ forum_id: 999n, parent_topic_id: [], title: 'X', description: 'x' }))).toHaveProperty('NotFound');
    unwrap(await as(admin).update_forum(F, { title: 'Sneed DAO', description: 'new text', sns_root_canister_id: [] }));
    const OTHER = unwrap(await as(admin).create_topic({ forum_id: F, parent_topic_id: [], title: 'Other', description: 'o' }));
    unwrap(await as(admin).update_topic(SUB, { forum_id: F, parent_topic_id: [OTHER], title: 'Moved', description: 's' }));
    expect(errOf(await as(bob).update_topic(SUB, { forum_id: F, parent_topic_id: [], title: 'No', description: 's' }))).toHaveProperty('Unauthorized');
    expect(strip(await verifiedLog())).toEqual([
      { t: 'forum_create', caller: P(admin), forum_id: F, title: 'Sneed', sns_root: P(SNEED_SNS_ROOT) },
      { t: 'topic_create', caller: P(admin), topic_id: TOPIC, forum_id: F, title: 'General' },
      { t: 'topic_create', caller: P(admin), topic_id: SUB, forum_id: F, title: 'Sub', parent_topic_id: TOPIC },
      { t: 'forum_update', caller: P(admin), forum_id: F, title: 'Sneed DAO', sns_root: P(SNEED_SNS_ROOT) },
      { t: 'topic_create', caller: P(admin), topic_id: OTHER, forum_id: F, title: 'Other' },
      { t: 'topic_update', caller: P(admin), topic_id: SUB, forum_id: F, title: 'Moved', parent_topic_id: OTHER, old_parent_topic_id: TOPIC },
    ]);
  });

  it('admins: additions and removals; refused and repeated calls append nothing', async () => {
    const mark = await logLength();
    expect(errOf(await as(bob).add_admin(bob))).toHaveProperty('Unauthorized');
    unwrap(await as(admin).add_admin(dave));
    expect(errOf(await as(admin).add_admin(dave))).toHaveProperty('AlreadyExists');
    unwrap(await as(dave).add_admin(carol));
    unwrap(await as(admin).remove_admin(carol));
    expect(errOf(await as(admin).remove_admin(carol))).toHaveProperty('NotFound');
    expect(strip(await since(mark))).toEqual([
      { t: 'admin_add', caller: P(admin), principal: P(dave) },
      { t: 'admin_add', caller: P(dave), principal: P(carol) },
      { t: 'admin_remove', caller: P(admin), principal: P(carol) },
    ]);
  });

  it('configuration: one block per setting that changed, with the old value', async () => {
    const mark = await logLength();
    const old = await as(admin).get_text_limits();
    const limits = (over = {}) => ({ post_title_max_length: [], post_body_max_length: [], thread_title_max_length: [], thread_body_max_length: [], topic_title_max_length: [], topic_description_max_length: [], forum_title_max_length: [], forum_description_max_length: [], ...over });
    expect(errOf(await as(bob).update_text_limits(limits({ post_body_max_length: [5n] })))).toHaveProperty('Unauthorized');
    unwrap(await as(admin).update_text_limits(limits({ post_body_max_length: [4000n], thread_title_max_length: [old.thread_title_max_length] })));
    unwrap(await as(admin).update_text_limits(limits())); // nothing changes
    const premiumCanister = user('premium-canister');
    expect(errOf(await as(bob).update_premium_config({ sneed_premium_canister_id: [[premiumCanister]], premium_post_body_max_length: [], premium_thread_body_max_length: [] }))).toHaveProperty('Unauthorized');
    unwrap(await as(admin).update_premium_config({ sneed_premium_canister_id: [[premiumCanister]], premium_post_body_max_length: [12_000n], premium_thread_body_max_length: [] }));
    unwrap(await as(admin).update_premium_config({ sneed_premium_canister_id: [[]], premium_post_body_max_length: [], premium_thread_body_max_length: [] }));
    const notif = user('notifications-canister');
    expect(errOf(await as(bob).admin_set_notifications([notif]))).toHaveProperty('Unauthorized');
    unwrap(await as(admin).admin_set_notifications([notif]));
    unwrap(await as(admin).admin_set_notifications([notif])); // the same again
    unwrap(await as(admin).admin_set_notifications([]));
    expect(strip(await since(mark))).toEqual([
      { t: 'config_update', caller: P(admin), key: 'post_body_max_length', old_value: old.post_body_max_length, value: 4000n },
      { t: 'config_update', caller: P(admin), key: 'sneed_premium_canister_id', old_value: 'none', value: P(premiumCanister) },
      { t: 'config_update', caller: P(admin), key: 'premium_post_body_max_length', old_value: 50_000n, value: 12_000n },
      { t: 'config_update', caller: P(admin), key: 'sneed_premium_canister_id', old_value: P(premiumCanister), value: 'none' },
      { t: 'config_update', caller: P(admin), key: 'notifications_canister', old_value: 'none', value: P(notif) },
      { t: 'config_update', caller: P(admin), key: 'notifications_canister', old_value: P(notif), value: 'none' },
    ]);
  });
});

describe('proposals', () => {
  it('proposals topic, SNS setup, special topics and proposal threads', async () => {
    let mark = await logLength();
    expect(errOf(await as(bob).set_proposals_topic({ forum_id: F, topic_id: TOPIC }))).toHaveProperty('Unauthorized');
    unwrap(await as(admin).set_proposals_topic({ forum_id: F, topic_id: TOPIC }));
    unwrap(await as(admin).set_proposals_topic({ forum_id: F, topic_id: TOPIC })); // unchanged
    const t1 = unwrap(await as(alice).create_proposal_thread({ sns_root_canister_id: SNEED_SNS_ROOT, proposal_id: 7n }));
    expect(errOf(await as(alice).create_proposal_thread({ sns_root_canister_id: SNEED_SNS_ROOT, proposal_id: 7n }))).toHaveProperty('AlreadyExists');
    expect(errOf(await as(bob).remove_proposals_topic(F))).toHaveProperty('Unauthorized');
    unwrap(await as(admin).remove_proposals_topic(F));
    expect(errOf(await as(admin).remove_proposals_topic(F))).toHaveProperty('NotFound');
    expect(strip(await since(mark))).toEqual([
      { t: 'proposals_topic_set', caller: P(admin), forum_id: F, topic_id: TOPIC },
      { t: 'proposal_thread_create', caller: P(alice), thread_id: t1, sns_root: P(SNEED_SNS_ROOT), proposal_id: 7n, topic_id: TOPIC },
      { t: 'proposals_topic_remove', caller: P(admin), forum_id: F, old_topic_id: TOPIC },
    ]);

    // anyone signed in: the SNS setup creates the forum of an SNS, its Governance and Proposals topics
    mark = await logLength();
    const proposals2 = unwrap(await as(bob).create_sns_forum_setup(root2));
    expect(unwrap(await as(bob).create_sns_forum_setup(root2))).toBe(proposals2); // idempotent: nothing new
    const f2 = (await as(bob).get_forum_by_sns_root(root2))[0].id;
    const gov2 = proposals2 - 1n;
    const special = unwrap(await as(carol).create_special_topic({ sns_root_canister_id: root2, special_topic_type: { General: null } }));
    // a proposal thread for an SNS without a forum sets everything up
    const t3 = unwrap(await as(alice).create_proposal_thread_with_auto_setup({ sns_root_canister_id: root3, proposal_id: 1n }));
    const f3 = (await as(bob).get_forum_by_sns_root(root3))[0];
    const blocks = strip(await since(mark));
    expect(blocks.map((b) => [b.t, b.caller])).toEqual([
      ['forum_create', P(bob)], ['topic_create', P(bob)], ['topic_create', P(bob)], ['proposals_topic_set', P(bob)],
      ['topic_create', P(carol)],
      ['forum_create', P(alice)], ['topic_create', P(alice)], ['topic_create', P(alice)], ['proposals_topic_set', P(alice)], ['proposal_thread_create', P(alice)],
    ]);
    expect(blocks[0]).toMatchObject({ forum_id: f2, sns_root: P(root2) });
    expect(blocks[1]).toMatchObject({ topic_id: gov2, forum_id: f2, title: 'Governance' });
    expect(blocks[2]).toMatchObject({ topic_id: proposals2, forum_id: f2, title: 'Proposals', parent_topic_id: gov2 });
    expect(blocks[3]).toEqual({ t: 'proposals_topic_set', caller: P(bob), forum_id: f2, topic_id: proposals2 });
    expect(blocks[4]).toMatchObject({ topic_id: special, forum_id: f2, title: 'General' });
    expect(blocks[5]).toMatchObject({ forum_id: f3.id, sns_root: P(root3), title: f3.title });
    expect(blocks[9]).toEqual({ t: 'proposal_thread_create', caller: P(alice), thread_id: t3, sns_root: P(root3), proposal_id: 1n, topic_id: blocks[7].topic_id });
  });
});

describe('content and moderation', () => {
  it('ordinary threads, posts, votes, polls and the author\'s own edits and deletions append nothing', async () => {
    const mark = await logLength();
    TH = unwrap(await as(alice).create_thread({ topic_id: TOPIC, title: ['Hello'], body: `First thread ${mention(bob, 'Bob')}` }));
    P_BOB = unwrap(await as(bob).create_post(TH, [], [], 'bob writes'));
    const P_ALICE = unwrap(await as(alice).create_post(TH, [P_BOB], ['re'], 'alice answers'));
    unwrap(await as(alice).vote_on_post(P_BOB, { upvote: null }));
    unwrap(await as(alice).retract_vote(P_BOB));
    unwrap(await as(alice).create_poll({ thread_id: TH, post_id: [], title: 'Which?', body: 'Pick', options: [{ title: 'A', body: [] }, { title: 'B', body: [] }], vp_power: [], end_timestamp: BigInt(Math.round(await pic.getTime())) * 1_000_000n + 86_400_000_000_000n, allow_vote_changes: [] }));
    unwrap(await as(alice).update_post(P_ALICE, ['re'], 'alice answers, edited'));
    unwrap(await as(alice).update_thread(TH, ['Hello'], `First thread, edited ${mention(bob, 'Bob')}`));
    unwrap(await as(alice).delete_post(P_ALICE)); // her own post
    expect(errOf(await as(bob).delete_post(P_ALICE))).toHaveProperty('Unauthorized');
    expect(errOf(await as(bob).update_thread(TH, [], 'not mine'))).toHaveProperty('Unauthorized');
    expect(errOf(await as(bob).delete_thread(TH))).toHaveProperty('Unauthorized');
    expect(errOf(await as(bob).undelete_post(P_ALICE))).toHaveProperty('Unauthorized');
    await as(alice).mark_mentions_seen_up_to(1n);
    expect(await logLength()).toBe(mark);
  });

  it('moderation: edits of someone else\'s content, deletes and undeletes by admins, with hashes of the texts and never the texts', async () => {
    const mark = await logLength();
    unwrap(await as(dave).update_post(P_BOB, ['moderated'], 'edited by a moderator')); // dave is an admin
    unwrap(await as(dave).delete_post(P_BOB));
    unwrap(await as(dave).delete_post(P_BOB)); // already deleted: nothing changes
    unwrap(await as(admin).undelete_post(P_BOB));
    unwrap(await as(admin).delete_thread(TH));
    unwrap(await as(admin).undelete_thread(TH));
    const doomed = unwrap(await as(admin).create_topic({ forum_id: F, parent_topic_id: [], title: 'Doomed', description: 'd' }));
    unwrap(await as(admin).delete_topic(doomed));
    unwrap(await as(admin).undelete_topic(doomed));
    unwrap(await as(admin).delete_forum(F));
    unwrap(await as(admin).undelete_forum(F));
    unwrap(await as(admin).undelete_forum(F)); // not deleted: nothing changes
    expect(errOf(await as(bob).delete_topic(doomed))).toHaveProperty('Unauthorized');
    expect(errOf(await as(admin).delete_post(999_999n))).toHaveProperty('NotFound');
    const thread = (await as(admin).get_thread(TH))[0];
    expect(strip(await since(mark))).toEqual([
      { t: 'edit', caller: P(dave), kind: 'post', id: P_BOB, author: P(bob), old_body_sha256: H('bob writes'), body_sha256: H('edited by a moderator'), title_sha256: H('moderated') },
      { t: 'delete', caller: P(dave), kind: 'post', id: P_BOB, author: P(bob), body_sha256: H('edited by a moderator'), title_sha256: H('moderated') },
      { t: 'undelete', caller: P(admin), kind: 'post', id: P_BOB, author: P(bob), body_sha256: H('edited by a moderator'), title_sha256: H('moderated') },
      { t: 'delete', caller: P(admin), kind: 'thread', id: TH, author: P(alice), body_sha256: H(thread.body), title_sha256: H('Hello') },
      { t: 'undelete', caller: P(admin), kind: 'thread', id: TH, author: P(alice), body_sha256: H(thread.body), title_sha256: H('Hello') },
      { t: 'topic_create', caller: P(admin), topic_id: doomed, forum_id: F, title: 'Doomed' },
      { t: 'delete', caller: P(admin), kind: 'topic', id: doomed },
      { t: 'undelete', caller: P(admin), kind: 'topic', id: doomed },
      { t: 'delete', caller: P(admin), kind: 'forum', id: F },
      { t: 'undelete', caller: P(admin), kind: 'forum', id: F },
    ]);
    // no post or thread text anywhere in the log
    const all = JSON.stringify((await verifiedLog()).map(ser));
    for (const body of ['bob writes', 'edited by a moderator', 'alice answers', 'First thread']) expect(all).not.toContain(body);
  });
});

describe('tips', () => {
  it('a tip verified on the ledger: one block with the ledger block; refused and unverified tips append nothing', async () => {
    const mark = await logLength();
    const b = await send(alice, bob, E8S);
    const tip = unwrap(await as(alice).create_tip(bob, P_BOB, ICP_LEDGER_ID, E8S, [b]));
    expect(errOf(await as(alice).create_tip(bob, P_BOB, ICP_LEDGER_ID, E8S, [b]))).toHaveProperty('AlreadyExists'); // block used
    expect(errOf(await as(carol).create_tip(bob, P_BOB, ICP_LEDGER_ID, 2n * E8S, [await send(carol, bob, E8S)]))).toHaveProperty('InvalidInput'); // wrong amount
    expect(errOf(await as(alice).create_tip(carol, P_BOB, ICP_LEDGER_ID, E8S, [b]))).toHaveProperty('InvalidInput'); // not the author
    const unverified = unwrap(await as(alice).create_tip(bob, P_BOB, ICP_LEDGER_ID, E8S, [])); // no block index
    expect(unwrap(await as(carol).verify_tip(unverified))).toBe(false); // still no block: unchecked, not logged
    expect(unwrap(await as(carol).verify_tip(tip))).toBe(true); // already verified: nothing new
    expect(strip(await since(mark))).toEqual([
      { t: 'tip', caller: P(alice), tip_id: tip, from: P(alice), to: P(bob), post_id: P_BOB, thread_id: TH, ledger: P(ICP_LEDGER_ID), amount: E8S, ledger_block: b },
    ]);
  });

  it('verify_tip: a tip the ledger could not confirm at first is logged when verified, or when rejected', async () => {
    const good = await send(carol, bob, 3n * E8S);
    const bad = await send(carol, bob, E8S);
    await pic.stopCanister({ canisterId: icpId, sender: admin }); // the ledger does not answer
    const t1 = unwrap(await as(carol).create_tip(bob, P_BOB, ICP_LEDGER_ID, 3n * E8S, [good]));
    const t2 = unwrap(await as(carol).create_tip(bob, P_BOB, ICP_LEDGER_ID, 5n * E8S, [bad])); // claims more than was sent
    expect((await as(carol).get_tip(t1))[0].verified).toEqual([false]);
    const mark = await logLength();
    expect(mark).toBeGreaterThan(0);
    expect(unwrap(await as(dave).verify_tip(t1))).toBe(false); // still down: unchecked again, nothing logged
    expect(await logLength()).toBe(mark);
    await pic.startCanister({ canisterId: icpId, sender: admin });
    expect(unwrap(await as(dave).verify_tip(t1))).toBe(true);
    expect(unwrap(await as(dave).verify_tip(t2))).toBe(false);
    expect(unwrap(await as(dave).verify_tip(t2))).toBe(false); // rejected is final: nothing new
    const blocks = strip(await since(mark));
    const base = { caller: P(dave), from: P(carol), to: P(bob), post_id: P_BOB, thread_id: TH, ledger: P(ICP_LEDGER_ID) };
    expect(blocks).toEqual([
      { t: 'tip_verified', ...base, tip_id: t1, amount: 3n * E8S, ledger_block: good },
      { t: 'tip_rejected', ...base, tip_id: t2, amount: 5n * E8S, ledger_block: bad, reason: (await as(dave).get_tip(t2))[0].verification_note[0] },
    ]);
  });
});

describe('ingress', () => {
  it('refuses the log queries as update calls and the log\'s admin methods from non-admins at ingress', async () => {
    const u = actorAs(pic, asUpdates(fullIdl), forumId, bob);
    expect((await as(bob).icrc3_log_status()).log_length).toEqual(expect.any(BigInt)); // answered as a query
    expect(await refusedAtIngress(u.icrc3_get_blocks([{ start: 0n, length: 1n }]))).toBe(true);
    expect(await refusedAtIngress(u.icrc3_get_archives({ from: [] }))).toBe(true);
    expect(await refusedAtIngress(u.icrc3_get_tip_certificate())).toBe(true);
    expect(await refusedAtIngress(u.icrc3_supported_block_types())).toBe(true);
    expect(await refusedAtIngress(u.icrc10_supported_standards())).toBe(true);
    expect(await refusedAtIngress(u.icrc3_log_status())).toBe(true);
    expect(await refusedAtIngress(u.get_log(0n, 10n))).toBe(true);
    const settings = { max_live_blocks: [5n], spill_batch_size: [], archive_max_blocks: [], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] };
    expect(await refusedAtIngress(as(bob).admin_set_icrc3_settings(settings))).toBe(true);
    expect(await refusedAtIngress(as(bob).admin_icrc3_spill_now())).toBe(true);
    expect(await refusedAtIngress(as(bob).admin_icrc3_repair_archive_controllers())).toBe(true);
    await expect(as(bob).get_log(0n, 10n)).rejects.toThrow(/Admins only/);
    // the existing behaviour stays: other methods are not checked by caller at ingress
    expect(errOf(await as(bob).add_admin(bob))).toHaveProperty('Unauthorized');
  });
});

describe('archives', () => {
  it('spill past the live limit into archives co-controlled by SNS root, and still verify', async () => {
    const before = await logLength();
    unwrap(await as(admin).admin_set_icrc3_settings({ max_live_blocks: [5n], spill_batch_size: [10n], archive_max_blocks: [20n], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }));
    await advance(15 * 60 + 5, 100); // the 15-minute spill check
    const s = await as(admin).icrc3_log_status();
    expect(Number(s.log_length)).toBe(before + 3); // three settings changed
    expect(s.live_blocks).toBeLessThan(5n);
    expect(s.archives.length).toBeGreaterThanOrEqual(2);
    const archives = await as(bob).icrc3_get_archives({ from: [] });
    expect(archives.map((a) => a.canister_id.toText())).toEqual(s.archives.map((a) => a.canister_id.toText()));
    for (const a of archives) {
      expect((await pic.getControllers(a.canister_id)).map((p) => p.toText()).sort()).toEqual([forumId.toText(), SNEED_SNS_ROOT.toText()].sort());
      expect((await archiveActor(a.canister_id).archive_status()).parent.toText()).toBe(forumId.toText());
    }
    const r = await as(bob).icrc3_get_blocks([{ start: 0n, length: 3n }]);
    expect(r.blocks).toEqual([]);
    expect(r.archived_blocks).toHaveLength(1);
    const blocks = await verifiedLog(); // follows the callbacks into every archive
    expect(blocks).toHaveLength(Number(s.log_length));
    expect(blocks.slice(-3).map((b) => [b.t, b.key, b.caller])).toEqual([
      ['config_update', 'icrc3_max_live_blocks', P(admin)], ['config_update', 'icrc3_spill_batch_size', P(admin)], ['config_update', 'icrc3_archive_max_blocks', P(admin)],
    ]);
    expect((await as(admin).get_log(0n, 100n)).some((e) => /created archive/.test(e.message))).toBe(true);
    unwrap(await as(admin).admin_icrc3_spill_now());
    expect((await as(admin).icrc3_log_status()).live_blocks).toBe(0n);
    expect(await verifiedLog()).toHaveLength(Number(s.log_length));
    expect((await as(admin).admin_icrc3_repair_archive_controllers()).every(([, x]) => 'Ok' in x)).toBe(true);
    unwrap(await as(admin).admin_set_icrc3_settings({ max_live_blocks: [2000n], spill_batch_size: [500n], archive_max_blocks: [1_000_000n], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }));
  }, 120_000);
});

describe('upgrades', () => {
  it('keep the log, the archives and the certified tip (wasm_memory_persistence = keep)', async () => {
    const before = await as(admin).icrc3_log_status();
    const blocksBefore = await verifiedLog();
    await advance(600);
    await pic.upgradeCanister({ sender: admin, canisterId: forumId, wasm: wasm(FORUM_WASM), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    await pic.tick(2);
    expect(await as(admin).icrc3_log_status()).toEqual(before);
    expect(await verifiedLog()).toEqual(blocksBefore); // the tip certificate is republished
    unwrap(await as(admin).add_admin(carol));
    const blocks = await verifiedLog();
    expect(blocks).toHaveLength(blocksBefore.length + 1);
    expect(blocks.at(-1)).toMatchObject({ t: 'admin_add', principal: P(carol) });
  }, 120_000);

  it('from the production build with keep: forums, topics, threads, posts, tips and mentions stay, and the log starts empty', async () => {
    const oldId = await install(pic, { name: 'sneed_sns_forum_prod', cycles: 20n * T, targetSubnetId: appSubnet });
    const o = (p) => as(p, oldId);
    await expect(o(alice).icrc3_log_status()).rejects.toThrow(); // the production code has no log
    const f = unwrap(await o(admin).create_forum({ title: 'Sneed', description: 'd', sns_root_canister_id: [] }));
    const topic = unwrap(await o(admin).create_topic({ forum_id: f, parent_topic_id: [], title: 'General', description: 'g' }));
    const th = unwrap(await o(alice).create_thread({ topic_id: topic, title: ['Hi'], body: `hello ${mention(carol, 'Carol')}` }));
    const pb = unwrap(await o(bob).create_post(th, [], [], `bob ${mention(alice, 'Alice')}`));
    unwrap(await o(alice).vote_on_post(pb, { upvote: null }));
    const block = await send(alice, bob, E8S);
    const tip = unwrap(await o(alice).create_tip(bob, pb, ICP_LEDGER_ID, E8S, [block]));
    unwrap(await o(admin).add_admin(dave));
    unwrap(await o(admin).delete_post(unwrap(await o(carol).create_post(th, [], [], 'gone'))));
    const snapshot = async () => ser({
      stats: await o(admin).get_stats(), forums: await o(admin).get_forums_admin(), topics: await o(admin).get_topics_by_forum(f),
      thread: await o(admin).get_thread(th), posts: await o(admin).get_posts_by_thread_admin(th), votes: await o(admin).get_post_votes(pb),
      tips: await o(admin).get_tips_by_post(pb), tipStats: await o(admin).get_tip_stats(), admins: await o(admin).get_admins(),
      mentions: [await o(admin).get_mentions_of_user(carol, [], 10n), await o(admin).get_mentions_of_user(alice, [], 10n)],
      limits: await o(admin).get_text_limits(), counter: await o(admin).get_current_counter(),
    });
    const before = await snapshot();
    expect(JSON.parse(before).tips[0].verified).toEqual([true]);

    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(FORUM_WASM), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    await pic.tick(2);
    expect(await snapshot()).toBe(before);
    expect(await o(alice).icrc3_log_status()).toMatchObject({ log_length: 0n, live_blocks: 0n, archives: [], last_block_hash: [], history_imported: false });
    expect(await o(alice).icrc3_get_tip_certificate()).toEqual([]);
    // the block used before the upgrade stays used
    expect(errOf(await o(carol).create_tip(bob, pb, ICP_LEDGER_ID, E8S, [block]))).toHaveProperty('AlreadyExists');

    // the first logged act after the upgrade is block 0, without phash; the log verifies
    unwrap(await o(dave).delete_post(pb));
    expect(unwrap(await o(carol).create_tip(bob, pb, ICP_LEDGER_ID, 1n, []))).toBeGreaterThan(tip); // unverified: not logged
    const blocks = await verifiedLog(oldId);
    expect(strip(blocks)).toEqual([{ t: 'delete', caller: P(dave), kind: 'post', id: pb, author: P(bob), body_sha256: H(`bob ${mention(alice, 'Alice')}`) }]);
    expect((await rawLog(oldId))[0].Map.some(([k]) => k === 'phash')).toBe(false);
  }, 180_000);
});
