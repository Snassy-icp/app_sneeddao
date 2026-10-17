// Rehearses the upgrades production actually takes: app_sneeddao_backend, sneed_sms and
// sneed_sns_forum as they ran from April to October 2026 (92eefd18, "persistent actors",
// enhanced orthogonal persistence; build.sh builds them as *_april.wasm) straight to today's
// build, with wasm_memory_persistence = keep as the SNS proposal sets it. Each canister is
// filled through the old code, upgraded, and must read back the same, with the migrations for
// data the old code got wrong applied: SMS senders who left a message (handed to user index 0)
// and forum poll counts (first votes uncounted).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, wasm, admin, alice, bob, carol, user, T, unwrap, nowNs, SNEED_SNS_ROOT } from '../lib/pic.js';
import { ser, settingsUpdate } from '../lib/hub.js';
import { idlFactory as smsIdl } from '../build/sneed_sms.did.js';
import { idlFactory as forumIdl } from '../build/sneed_sns_forum.did.js';
import { idlFactory as hubIdl } from '../build/app_sneeddao_backend.did.js';

const KEEP = { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] };
const upgrade = (pic, canisterId, name) => pic.upgradeCanister({ sender: admin, canisterId, wasm: wasm(name), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
const text = (p) => p.toText();
const anonText = Principal.anonymous().toText();
const advance = async (pic, seconds) => { await pic.advanceTime(seconds * 1000); await pic.tick(2); };

describe('sneed_sms: April build to today', () => {
  let pic, id, sCarol, sAlice, sBob, sDave, s;
  const dave = user('dave');
  beforeAll(async () => {
    ({ pic } = await createPic());
    id = await install(pic, { name: 'sneed_sms_april' });
    s = actorAs(pic, smsIdl, id, admin);
    sCarol = actorAs(pic, smsIdl, id, carol); sAlice = actorAs(pic, smsIdl, id, alice);
    sBob = actorAs(pic, smsIdl, id, bob); sDave = actorAs(pic, smsIdl, id, dave);
  }, 120_000);
  afterAll(async () => { await pic?.tearDown(); });

  const msg = (recipients, subject) => ({ recipients, subject, body: `${subject} body`, reply_to: [] });
  let mCarol, mAlice, mCarolLeft, mCarolKept, mDave, before;
  const box = async (a, f) => (await a[f]()).map((m) => m.id).sort();

  it('the April build hands a message whose sender left to user index 0', async () => {
    mCarol = unwrap(await sCarol.send_message(msg([bob, dave], 'carol to bob and dave'))); // carol is the first user: index 0
    mAlice = unwrap(await sAlice.send_message(msg([bob, dave], 'alice to bob and dave')));
    mDave = unwrap(await sDave.send_message(msg([carol], 'dave to carol')));
    await advance(pic, 11 * 60);
    mCarolLeft = unwrap(await sCarol.send_message(msg([dave], 'carol to dave, then leaves')));
    await advance(pic, 11 * 60);
    mCarolKept = unwrap(await sCarol.send_message(msg([dave], 'carol to dave, nobody leaves')));
    unwrap(await sAlice.remove_self_from_message(mAlice)); // old code: sender := 0
    unwrap(await sCarol.remove_self_from_message(mCarolLeft)); // the index-0 user leaving her own message
    unwrap(await sBob.remove_self_from_message(mCarol)); // a recipient leaving: old code drops it from index 0's sent list too
    // the hole: carol (index 0) reads alice's message as its sender
    const leaked = (await sCarol.get_message(mAlice))[0];
    expect(leaked && text(leaked.sender)).toBe(text(carol));
    before = ser({ stats: await s.get_stats(), bob: await box(sBob, 'get_received_messages'), dave: await box(sDave, 'get_received_messages') });
  });

  it('upgrades with keep: messages stay, and the migration takes those messages back from index 0', async () => {
    await upgrade(pic, id, 'sneed_sms');
    expect(ser({ stats: await s.get_stats(), bob: await box(sBob, 'get_received_messages'), dave: await box(sDave, 'get_received_messages') })).toBe(before);
    // the leak is closed: alice's message is no longer carol's, and shows a sender who left
    expect(await sCarol.get_message(mAlice)).toEqual([]);
    expect(text((await sBob.get_message(mAlice))[0].sender)).toBe(anonText);
    expect(await sCarol.get_message(mCarolLeft)).toEqual([]); // she left it
    expect(text((await sDave.get_message(mCarolLeft))[0].sender)).toBe(anonText);
    // the case the data cannot tell from a leak: carol's own message that bob left goes the same way
    expect(await sCarol.get_message(mCarol)).toEqual([]);
    expect(text((await sDave.get_message(mCarol))[0].sender)).toBe(anonText);
    // what carol sent and nobody left stays hers, and so does what she received
    expect(text((await sCarol.get_message(mCarolKept))[0].sender)).toBe(text(carol));
    expect(await box(sCarol, 'get_sent_messages')).toEqual([mCarolKept]);
    expect(text((await sCarol.get_message(mDave))[0].sender)).toBe(text(dave));
    // a second upgrade changes nothing (after the install rate limit has passed)
    await advance(pic, 600);
    await upgrade(pic, id, 'sneed_sms');
    expect(await sCarol.get_message(mAlice)).toEqual([]);
    expect(text((await sCarol.get_message(mCarolKept))[0].sender)).toBe(text(carol));
  });
});

describe('sneed_sns_forum: April build to today', () => {
  const SNS_W = Principal.fromText('qaa6y-5yaaa-aaaaa-aaafa-cai');
  const directoryIdl = ({ IDL }) => IDL.Service({ set_instances: IDL.Func([IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Principal))], [], []) });
  const neuronsIdl = ({ IDL }) => IDL.Service({ add_neuron: IDL.Func([IDL.Vec(IDL.Nat8), IDL.Principal, IDL.Vec(IDL.Principal), IDL.Nat64, IDL.Nat64], [], []) });
  const nid = (n) => new Uint8Array(32).fill(n);
  let pic, id, f, fAlice, fBob, poll, thread, before;
  beforeAll(async () => {
    ({ pic } = await createPic());
    await install(pic, { name: 'MockForumSnsW', targetCanisterId: SNS_W });
    const govId = await install(pic, { name: 'MockForumGovernance' });
    await actorAs(pic, directoryIdl, SNS_W, admin).set_instances([[SNEED_SNS_ROOT, govId]]);
    const gov = actorAs(pic, neuronsIdl, govId, admin);
    await gov.add_neuron(nid(1), alice, [], 1000n, 200n);
    await gov.add_neuron(nid(2), alice, [], 500n, 200n);
    await gov.add_neuron(nid(3), bob, [], 300n, 200n);
    id = await install(pic, { name: 'sneed_sns_forum_april' });
    f = actorAs(pic, forumIdl, id, admin); fAlice = actorAs(pic, forumIdl, id, alice); fBob = actorAs(pic, forumIdl, id, bob);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  const opts = async () => (await f.get_poll(poll))[0].options.map((o) => [o.vote_count, o.total_voting_power]);

  it('the April build does not count first votes', async () => {
    const forum = unwrap(await f.create_forum({ title: 'Sneed', description: 'The Sneed DAO forum', sns_root_canister_id: [] }));
    const topic = unwrap(await f.create_topic({ forum_id: forum, parent_topic_id: [], title: 'General', description: 'Talk' }));
    thread = unwrap(await fAlice.create_thread({ topic_id: topic, title: ['Hello'], body: 'First thread' }));
    unwrap(await fBob.create_post(thread, [], [], 'a reply'));
    poll = unwrap(await fAlice.create_poll({ thread_id: thread, post_id: [], title: 'Which?', body: 'Pick one', options: [{ title: 'A', body: [] }, { title: 'B', body: [] }], vp_power: [], end_timestamp: (await nowNs(pic)) + 86_400_000_000_000n, allow_vote_changes: [] }));
    unwrap(await fAlice.vote_on_poll_with_neurons(poll, 0n, [{ id: nid(1) }, { id: nid(2) }]));
    unwrap(await fBob.vote_on_poll_with_neurons(poll, 1n, [{ id: nid(3) }]));
    unwrap(await fAlice.vote_on_poll_with_neurons(poll, 1n, [{ id: nid(1) }])); // one of alice's neurons moves to B
    expect(await opts()).toEqual([[0n, 500n], [1n, 1300n]]); // really 1 and 2 votes: the old counts are A 1-1 = 0, B 0+1
    before = ser({ stats: await f.get_stats(), thread: await f.get_thread(thread), posts: await f.get_posts_by_thread(thread), votes: (await f.get_poll_votes(poll)).map(ser).sort() });
  });

  it('upgrades with keep: everything stays, and the poll counts are recounted from the votes', async () => {
    await upgrade(pic, id, 'sneed_sns_forum');
    expect(ser({ stats: await f.get_stats(), thread: await f.get_thread(thread), posts: await f.get_posts_by_thread(thread), votes: (await f.get_poll_votes(poll)).map(ser).sort() })).toBe(before);
    expect(await opts()).toEqual([[1n, 500n], [2n, 1300n]]);
    // a second upgrade changes nothing (after the install rate limit has passed)
    await advance(pic, 600);
    await upgrade(pic, id, 'sneed_sns_forum');
    expect(await opts()).toEqual([[1n, 500n], [2n, 1300n]]);
  });
});

describe('app_sneeddao_backend: April build to today', () => {
  let pic, appSubnet, id, hub, hubAlice, hubBob, before;
  const c = (i) => user(`canister-${i}`);
  const sneedex = user('sneedex');
  beforeAll(async () => {
    ({ pic, appSubnet } = await createPic());
    id = await install(pic, { name: 'app_sneeddao_backend_april', cycles: 20n * T, targetSubnetId: appSubnet });
    hub = actorAs(pic, hubIdl, id, admin); hubAlice = actorAs(pic, hubIdl, id, alice); hubBob = actorAs(pic, hubIdl, id, bob);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  const snapshot = async () => {
    const out = {};
    for (const [name, a] of [['alice', hubAlice], ['bob', hubBob]]) {
      out[name] = ser({
        settings: await a.get_my_settings(), seen: (await a.get_all_last_seen_log_ids()).map(ser).sort(),
        swaps: await a.get_swap_canister_ids(), ledgers: await a.get_ledger_canister_ids(), tracked: await a.get_tracked_canisters(),
        tokens: await a.get_user_tokens(), groups: await a.get_canister_groups(), layout: await a.get_wallet_layout(),
      });
    }
    out.admins = ser(await hub.get_admins());
    out.authorized = ser(await hub.get_authorized_for_callers());
    out.whitelist = ser((await hub.get_whitelisted_tokens()).map(ser).sort());
    out.partners = ser(await hub.get_partners());
    out.projects = ser(await hub.get_projects());
    out.blacklist = ser(await hub.get_blacklisted_words());
    out.banned = ser(await hub.get_banned_users());
    out.names = ser((await hub.get_all_principal_names()).map(ser).sort());
    out.nicknames = ser((await hubAlice.get_all_principal_nicknames()).map(ser).sort());
    out.jailbreak = ser(await hub.get_jailbreak_payment_stats());
    return out;
  };

  it('fills the April build', async () => {
    await hub.add_admin(carol);
    await hub.add_authorized_for_caller(sneedex);
    unwrap(await hub.add_blacklisted_word('rude'));
    unwrap(await hub.ban_user(user('eve'), 24n, 'spam'));
    await hub.add_whitelisted_token({ ledger_id: c(90), decimals: 8, fee: 10_000n, name: 'Token', symbol: 'TOK', standard: 'ICRC1' });
    expect(unwrap(await hub.add_partner('TACO', 'https://taco/logo.png', 'TACO DAO', [], []))).toBe(1n);
    expect(unwrap(await hub.add_partner('Two', 'https://two', 'second', [], []))).toBe(2n);
    unwrap(await hub.add_project('Proj', [], 'a project', { product: null }, [], []));
    unwrap(await hubAlice.set_principal_name('alice'));
    unwrap(await hubAlice.set_principal_nickname(bob, 'Bobby'));
    unwrap(await hubBob.set_my_settings(settingsUpdate({ show_vp_bar: false, swap_slippage_tolerance: 0.005 })));
    await hubAlice.mark_logs_seen(c(1), 10n);
    await hubAlice.register_swap_canister_id(c(2)); await hubAlice.register_ledger_canister_id(c(3));
    await hubAlice.register_tracked_canister(c(4)); await hubAlice.register_user_token(c(5));
    await hubAlice.set_wallet_layout({ tokens: [c(5)], positions: [c(2)], apps: [], sneedapp: [] });
    unwrap(await hubAlice.set_canister_groups({ groups: [{ id: 'g', name: 'group g', canisters: [c(4)], subgroups: [] }], ungrouped: [] }));
    before = await snapshot();
    expect(before.names).toContain('alice');
  });

  it('upgrades with keep: everything reads back the same, and the new parts work', async () => {
    await upgrade(pic, id, 'app_sneeddao_backend');
    await pic.tick(2);
    expect(await snapshot()).toEqual(before);
    // partner ids carry on from the old ones (the counter falls back to max id + 1)
    unwrap(await hub.remove_partner(2n));
    expect(unwrap(await hub.add_partner('Three', 'https://three', 'third', [], []))).toBe(3n);
    // what the old build did not have: the token list job, avatars, public payment totals
    expect((await hub.get_token_list_status()).timer_scheduled).toBe(true);
    unwrap(await hubAlice.set_my_avatar('https://example.com/a.png'));
    expect(await hub.get_avatar(alice)).toEqual(['https://example.com/a.png']);
    expect('ok' in (await hubBob.get_jailbreak_payment_stats())).toBe(true);
  });
});
