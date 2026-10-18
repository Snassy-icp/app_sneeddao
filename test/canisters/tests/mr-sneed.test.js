// mr_sneed step 0 (spec/mr_sneed_canister.md): the DAO-governed prompt and Mr Sneed's memories.
// The operator (the deployer) governs until end_operator; governance is a mock that calls the
// GNSF targets inter-canister, as SNS governance does on adoption.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, T, wasm, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { verifyLog, archiveIdl, btype, txField } from '../lib/icrc3.js';
import { idlFactory as mrIdl } from '../build/mr_sneed.did.js';

const anon = Principal.anonymous();
const writer = user('mr-sneed'); // Mr Sneed's principal
const SetPersonalityArgs = IDL.Record({ text: IDL.Text, reason: IDL.Text, expected_version: IDL.Opt(IDL.Nat) });
const Limits = IDL.Record({ writes_per_day: IDL.Nat, max_pinned: IDL.Nat, max_active: IDL.Nat, max_bytes: IDL.Nat });
const unit = IDL.Variant({ ok: IDL.Null, err: IDL.Text });
const govIdl = () => IDL.Service({
  set_personality: IDL.Func([IDL.Principal, SetPersonalityArgs], [IDL.Variant({ ok: IDL.Nat, err: IDL.Text })], []),
  set_writers: IDL.Func([IDL.Principal, IDL.Vec(IDL.Principal)], [unit], []),
  set_limits: IDL.Func([IDL.Principal, Limits], [unit], []),
  remove_memory: IDL.Func([IDL.Principal, IDL.Nat, IDL.Text], [unit], []),
  end_operator: IDL.Func([IDL.Principal], [IDL.Variant({ ok: IDL.Text, err: IDL.Text })], []),
});

let pic, rootKey, id, govId, op, mr, mrAlice, mrBob, mrAnon, gov;
const input = (over = {}) => ({ path: 'notes', kind: { note: null }, title: 'A note', body: 'Some text', tags: [], links: [], pinned: false, ...over });
const ok = (r) => { if ('err' in r) throw new Error(r.err); return r.ok; };
const errOf = (r) => ('err' in r ? r.err : null);
const archiveActor = (a) => actorAs(pic, archiveIdl, a, admin);
const LIMITS = { writes_per_day: 200n, max_pinned: 50n, max_active: 100_000n, max_bytes: 1_000_000_000n };

describe('mr_sneed: prompt and memories', () => {
  beforeAll(async () => {
    ({ pic, rootKey } = await createPic());
    id = await install(pic, { name: 'mr_sneed', cycles: 10n * T, sender: admin });
    govId = await install(pic, { name: 'MockMrSneedGov', cycles: 10n * T });
    op = actorAs(pic, mrIdl, id, admin); mr = actorAs(pic, mrIdl, id, writer);
    mrAlice = actorAs(pic, mrIdl, id, alice); mrBob = actorAs(pic, mrIdl, id, bob); mrAnon = actorAs(pic, mrIdl, id, anon);
    gov = actorAs(pic, govIdl, govId, carol);
  }, 120_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('starts with the deployer as operator, Sneed governance, no writers, the frame and no personality', async () => {
    const c = await mrAnon.get_config();
    expect(c.operator[0].toText()).toBe(admin.toText());
    expect(c.governance.toText()).toBe('fi3zi-fyaaa-aaaaq-aachq-cai');
    expect(c.writers).toEqual([]);
    const p = await mrAnon.get_prompt();
    expect(p.frame).toMatch(/^You are Mr Sneed/);
    expect(p.frame).toMatch(/7\. Never talk about price\./);
    expect(p.frame_hash.length).toBe(32);
    expect(p.personality).toEqual([]);
  });

  it('the operator points it at the (mock) governance and sets the writers', async () => {
    expect(await refusedAtIngress(mrAlice.operator_set_config(govId, []))).toBe(true);
    ok(await op.operator_set_config(govId, []));
    await op.set_writers([writer]);
    expect((await mrAnon.get_config()).writers.map((p) => p.toText())).toEqual([writer.toText()]);
  });

  it('personality: the operator or governance sets it, versions are kept, expected_version guards races', async () => {
    expect(await op.set_personality({ text: 'Fierce and kind.', reason: 'v1', expected_version: [0n] })).toBe(1n);
    expect(ok(await gov.set_personality(id, { text: 'Fierce, kind, a pirate.', reason: 'members asked', expected_version: [1n] }))).toBe(2n);
    expect(errOf(await gov.set_personality(id, { text: 'stale', reason: '', expected_version: [1n] }))).toMatch(/at version 2, not 1/);
    expect(errOf(await gov.set_personality(id, { text: 'x'.repeat(8193), reason: '', expected_version: [] }))).toMatch(/at most 8192 bytes/);
    expect(errOf(await gov.set_personality(id, { text: '', reason: '', expected_version: [] }))).toMatch(/cannot be empty/);
    const cur = (await mrAnon.get_personality([]))[0];
    expect(cur.version).toBe(2n); expect(cur.text).toBe('Fierce, kind, a pirate.');
    expect((await mrAnon.get_personality([1n]))[0].text).toBe('Fierce and kind.');
    expect((await mrAnon.list_personalities(0n, 10n)).map((p) => p.version)).toEqual([1n, 2n]);
    const v = await mrAnon.validate_set_personality({ text: 'New', reason: 'why', expected_version: [2n] });
    expect(v.Ok).toMatch(/version 2 → 3/); expect(v.Ok).toMatch(/New$/);
    expect((await mrAnon.validate_set_personality({ text: 'New', reason: '', expected_version: [1n] })).Err).toMatch(/at version 2/);
  });

  it('others cannot set the personality, the writers, the limits or remove memories', async () => {
    // by ingress, only the operator gets past the guard
    expect(await refusedAtIngress(mrAlice.set_personality({ text: 'x', reason: '', expected_version: [] }))).toBe(true);
    expect(await refusedAtIngress(mrAlice.set_writers([alice]))).toBe(true);
    expect(await refusedAtIngress(mr.set_limits(LIMITS))).toBe(true);
    expect(await refusedAtIngress(mr.remove_memory(0n, 'x'))).toBe(true);
  });

  it('writers remember, revise and forget; others cannot', async () => {
    expect(errOf(await mrAlice.remember(input()).catch(() => ({ err: 'refused' })))).toBeTruthy();
    const a = ok(await mr.remember(input({ title: 'Release process', body: 'Push, then one proposal per canister', tags: ['release', 'dao'], pinned: true })));
    const b = ok(await mr.remember(input({ kind: { lesson: null }, title: 'EOP needs Keep', body: 'Upgrade with wasm_memory_persistence = Keep' })));
    expect((await mrAnon.get_memory(a))[0].pinned).toBe(true);
    // revise: a new memory, the old one superseded and unpinned
    const a2 = ok(await mr.revise(a, input({ title: 'Release process', body: 'Push; staging first; one proposal per canister', tags: ['release'], pinned: true })));
    const old = (await mrAnon.get_memory(a))[0];
    expect(old.status).toEqual({ superseded: a2 }); expect(old.pinned).toBe(false);
    expect(errOf(await mr.revise(a, input()))).toMatch(/Only an active memory/);
    // forget: tombstone, text gone, reason kept
    expect(errOf(await mr.forget(b, ''))).toMatch(/Give a reason/);
    ok(await mr.forget(b, 'wrong'));
    const t = (await mrAnon.get_memory(b))[0];
    expect(t.body).toBe(''); expect(t.status.removed.reason).toBe('wrong'); expect(t.title).toBe('EOP needs Keep');
    const s = await mrAnon.get_stats();
    expect(s.active).toBe(1n); expect(s.total).toBe(3n); expect(s.pinned).toBe(1n);
  });

  it('input limits are refused, never truncated', async () => {
    expect(errOf(await mr.remember(input({ title: '' })))).toMatch(/needs a title/);
    expect(errOf(await mr.remember(input({ title: 'x'.repeat(121) })))).toMatch(/at most 120/);
    expect(errOf(await mr.remember(input({ body: 'é'.repeat(2049) })))).toMatch(/at most 4096 bytes/); // 4098 bytes
    expect(errOf(await mr.remember(input({ tags: ['UPPER'] })))).toMatch(/lowercase/);
    expect(errOf(await mr.remember(input({ tags: Array.from({ length: 9 }, (_, i) => `t${i}`) })))).toMatch(/At most 8 tags/);
    expect(errOf(await mr.remember(input({ kind: { member: anon } })))).toMatch(/anonymous/);
  });

  it('members list what Mr Sneed remembers about them and remove it; nobody else can', async () => {
    const m1 = ok(await mr.remember(input({ kind: { member: alice }, title: 'Alice builds the bridge', tags: ['member'] })));
    const m2 = ok(await mr.remember(input({ kind: { member: alice }, title: 'Alice likes Motoko' })));
    ok(await mr.remember(input({ kind: { member: bob }, title: 'Bob runs a node' })));
    const about = await mrAnon.memories_about(alice, [], 10n);
    expect(about.items.map((m) => m.id)).toEqual([m1, m2]);
    expect(errOf(await mrBob.forget_about_me(m1, ''))).toMatch(/not about you/);
    expect(await refusedAtIngress(mrAnon.forget_about_me(m1, ''))).toBe(true);
    ok(await mrAlice.forget_about_me(m1, ''));
    const gone = (await mrAnon.get_memory(m1))[0];
    expect(gone.body).toBe(''); expect(gone.status.removed.by.toText()).toBe(alice.toText());
    expect(errOf(await mrAlice.forget_about_me(m1, ''))).toMatch(/Already removed/);
    // paging
    const p1 = await mrAnon.memories_about(alice, [], 1n);
    expect(p1.items.length).toBe(1); expect(p1.next).toEqual([m1]);
    expect((await mrAnon.memories_about(alice, p1.next, 1n)).items[0].id).toBe(m2);
  });

  it('lists by kind, tag and status, newest first, and searches titles and tags by word prefix', async () => {
    const lessons = await mrAnon.list_memories({ path: [], kind: ['lesson'], tag: [], status: [], after: [], limit: 10n });
    expect(lessons.items.every((m) => 'lesson' in m.kind)).toBe(true);
    const release = await mrAnon.list_memories({ path: [], kind: [], tag: ['release'], status: ['active'], after: [], limit: 10n });
    expect(release.items.map((m) => m.title)).toEqual(['Release process']);
    const all = await mrAnon.list_memories({ path: [], kind: [], tag: [], status: [], after: [], limit: 100n });
    const ids = all.items.map((m) => m.id);
    expect([...ids].sort((x, y) => Number(y - x))).toEqual(ids);
    expect((await mrAnon.search_memories('relea', 10n)).map((m) => m.title)).toEqual(['Release process']);
    expect((await mrAnon.search_memories('ALICE moto', 10n)).map((m) => m.title)).toEqual(['Alice likes Motoko']);
    expect(await mrAnon.search_memories('Alice bridge', 10n)).toEqual([]); // that one was removed
  });

  it('folders: paths are validated, counted, listed and searched', async () => {
    expect(errOf(await mr.remember(input({ path: 'Bad/Path' })))).toMatch(/A path is/);
    expect(errOf(await mr.remember(input({ path: 'a//b' })))).toMatch(/A path is/);
    expect(errOf(await mr.remember(input({ path: 'a/b/c/d/e/f/g/h/i' })))).toMatch(/A path is/);
    const g = ok(await mr.remember(input({ path: 'dao/governance', title: 'Proposals need a reject fee' })));
    ok(await mr.remember(input({ path: 'dao/governance/gnsf', title: 'GNSF targets trap on refusal' })));
    ok(await mr.remember(input({ path: 'oslo/events', title: 'ICP meetup at the harbour' })));
    ok(await mr.remember(input({ path: '', title: 'At the top' })));
    const folders = Object.fromEntries((await mrAnon.list_folders()).map((f) => [f.path, [f.active, f.total]]));
    expect(folders['dao/governance']).toEqual([1n, 1n]);
    expect(folders['oslo/events']).toEqual([1n, 1n]);
    expect(folders['']).toEqual([1n, 1n]);
    const dao = await mrAnon.list_memories({ path: ['dao'], kind: [], tag: [], status: [], after: [], limit: 10n });
    expect(dao.items.map((m) => m.path).sort()).toEqual(['dao/governance', 'dao/governance/gnsf']);
    const exact = await mrAnon.list_memories({ path: ['dao/governance/gnsf'], kind: [], tag: [], status: [], after: [], limit: 10n });
    expect(exact.items.length).toBe(1);
    expect((await mrAnon.search_memories('oslo', 10n)).map((m) => m.title)).toEqual(['ICP meetup at the harbour']);
    // moving a memory to another folder by revising it moves the count
    ok(await mr.revise(g, input({ path: 'dao/fees', title: 'Proposals need a reject fee' })));
    const after = Object.fromEntries((await mrAnon.list_folders()).map((f) => [f.path, [f.active, f.total]]));
    expect(after['dao/governance']).toEqual([0n, 1n]);
    expect(after['dao/fees']).toEqual([1n, 1n]);
  });

  it('pins, within the limit', async () => {
    const n = ok(await mr.remember(input({ title: 'Pin me' })));
    ok(await mr.set_pinned(n, true));
    expect((await mrAnon.get_stats()).pinned).toBe(2n);
    await op.set_limits({ ...LIMITS, max_pinned: 2n });
    expect(errOf(await mr.remember(input({ title: 'Third pin', pinned: true })))).toMatch(/At most 2 pinned/);
    ok(await mr.set_pinned(n, false));
    await op.set_limits(LIMITS);
  });

  it('a writer has a daily budget', async () => {
    await op.set_limits({ ...LIMITS, writes_per_day: 1n });
    expect(errOf(await mr.remember(input()))).toMatch(/At most 1 writes a day/);
    await pic.advanceTime(24 * 3600 * 1000); await pic.tick();
    ok(await mr.remember(input({ title: 'Next day' })));
    await op.set_limits(LIMITS);
  });

  it('session_brief: the prompt, the pinned memories and the recent ones', async () => {
    const b = await mrAnon.session_brief(3n);
    expect(b.frame).toMatch(/^You are Mr Sneed/);
    expect(b.personality[0].version).toBe(2n);
    expect(b.pinned.map((m) => m.title)).toEqual(['Release process']);
    expect(b.recent.length).toBe(3);
    expect(b.recent.every((m) => 'active' in m.status && !m.pinned)).toBe(true);
    expect(b.stats.active).toBe((await mrAnon.get_stats()).active);
  });

  it('the DAO removes a memory; validators render', async () => {
    const x = ok(await mr.remember(input({ title: 'Should not be here' })));
    expect((await mrAnon.validate_remove_memory(x, 'spam')).Ok).toMatch(/Should not be here/);
    ok(await gov.remove_memory(id, x, 'spam'));
    expect((await mrAnon.get_memory(x))[0].status.removed.reason).toBe('spam');
    expect((await mrAnon.validate_remove_memory(x, 'again')).Err).toMatch(/Already removed/);
    expect((await mrAnon.validate_set_writers([writer, bob])).Ok).toMatch(/become/);
    expect((await mrAnon.validate_set_limits({ ...LIMITS, max_active: 0n })).Err).toMatch(/above zero/);
  });

  it('queries are refused as update calls', async () => {
    const upd = actorAs(pic, asUpdates(mrIdl), id, alice);
    for (const call of [() => upd.get_prompt(), () => upd.session_brief(5n), () => upd.list_memories({ path: [], kind: [], tag: [], status: [], after: [], limit: 1n }), () => upd.search_memories('x', 1n), () => upd.validate_set_writers([])]) {
      expect(await refusedAtIngress(call())).toBe(true);
    }
  });

  it('the ICRC-3 log records every action and verifies', async () => {
    const { blocks } = await verifyLog(mrAnon, id, rootKey, archiveActor);
    const types = blocks.map(btype);
    expect(types[0]).toBe('mrs_init');
    for (const t of ['mrs_personality', 'mrs_memory', 'mrs_forget', 'mrs_pin', 'mrs_config']) expect(types).toContain(t);
    const revised = blocks.find((b) => btype(b) === 'mrs_memory' && txField(b, 'supersedes'));
    expect(revised).toBeTruthy();
  });

  it('survives an upgrade', async () => {
    const before = await mrAnon.get_stats();
    await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm('mr_sneed'), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    expect(await mrAnon.get_stats()).toEqual(before);
    expect((await mrAnon.get_personality([]))[0].version).toBe(2n);
    expect((await mrAnon.get_config()).writers.map((p) => p.toText())).toEqual([writer.toText()]);
    await verifyLog(mrAnon, id, rootKey, archiveActor);
  });

  it('end_operator: the operator gives up its powers for good; governance keeps them', async () => {
    ok(await op.end_operator());
    expect((await mrAnon.get_config()).operator).toEqual([]);
    expect(await refusedAtIngress(op.set_writers([alice]))).toBe(true);
    expect(errOf(await op.operator_set_config(alice, []).catch(() => ({ err: 'refused' })))).toBeTruthy();
    ok(await gov.set_writers(id, [writer, bob]));
    expect((await mrAnon.get_config()).writers.length).toBe(2);
  });
});
