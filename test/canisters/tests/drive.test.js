// sneed_drive, phase 0 (spec/sneed_drive_phase0.md): folders and notes, versions on every save,
// the trash, tags, search, limits, the owner-only write log, the ingress guard, and an upgrade
// (enhanced orthogonal persistence: wasm_memory_persistence = keep) that keeps everything.
// Access control is in drive-acl.test.js.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, actorAs, admin, user, T, unwrap, errOf, wasm, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { idlFactory as driveIdl, init as driveInit } from '../build/sneed_drive.did.js';

const owner = user('drive-owner');
const stranger = user('drive-stranger');
const enc = (s) => new TextEncoder().encode(s);
const text = (s) => ({ text: s });
const errKind = (r) => Object.keys(errOf(r))[0];

let pic, appSubnet, driveId, drive, as;

async function installDrive(initArg) {
  const canisterId = await pic.createCanister({ sender: admin, cycles: 50n * T, targetSubnetId: appSubnet, controllers: [admin] });
  await pic.installCode({ sender: admin, canisterId, wasm: wasm('sneed_drive'), arg: IDL.encode(driveInit({ IDL }), [initArg]) });
  return canisterId;
}

const file = (parent, name, content, tags = [], mime = []) => drive.create_file({ parent, name, content: text(content), mime, tags });
const folder = (parent, name, tags = []) => drive.create_folder({ parent, name, tags });
const content = async (node, version = []) => unwrap(await drive.get_content({ node, version }));
const names = (page) => page.items.map((n) => n.name);

describe('sneed_drive phase 0', () => {
  beforeAll(async () => {
    ({ pic, appSubnet } = await createPic());
    driveId = await installDrive([{ owner: [owner], settings: [] }]);
    drive = actorAs(pic, driveIdl, driveId, owner);
    as = (p) => actorAs(pic, driveIdl, driveId, p);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('starts with an empty root folder that the owner owns', async () => {
    const root = unwrap(await drive.get_node(0n));
    expect(root.kind).toEqual({ folder: null });
    expect(root.my_access).toEqual({ owner: null });
    expect(root.children).toBe(0n);
    const info = await drive.get_drive_info();
    expect(info.owner).toEqual([owner]);
    expect(info.nodes).toBe(1n);
    expect(info.limits.max_inline_bytes).toBe(65_536n);
    expect(await drive.get_api_doc()).toMatch(/Sneed Drive/);
  });

  it('creates, lists, reads, renames and moves folders and notes', async () => {
    const notes = unwrap(await folder(0n, 'Notes'));
    expect(notes.parent).toEqual([0n]);
    const plan = unwrap(await file(notes.id, 'plan.md', '# Plan\n\nShip phase 0.'));
    expect(plan.mime).toBe('text/markdown');
    expect(plan.versions).toBe(1n);
    expect(plan.size).toBe(BigInt(enc('# Plan\n\nShip phase 0.').length));
    const c = await content(plan.id);
    expect(c.text).toEqual(['# Plan\n\nShip phase 0.']);
    expect(c.mime).toBe('text/markdown');

    // names are unique per folder regardless of capitals
    expect(errOf(await file(notes.id, 'PLAN.md', 'x'))).toEqual({ name_taken: plan.id });
    expect(errKind(await folder(0n, 'a/b'))).toBe('invalid');
    expect(errKind(await folder(0n, ' x'))).toBe('invalid');
    expect(errKind(await folder(0n, '..'))).toBe('invalid');
    expect(errKind(await file(plan.id, 'inside.md', 'x'))).toBe('invalid'); // a file is no folder

    unwrap(await file(notes.id, 'b.md', 'b'));
    unwrap(await file(notes.id, 'a.md', 'a'));
    const page = unwrap(await drive.list_children({ folder: notes.id, after: [], limit: 2n }));
    expect(names(page)).toEqual(['a.md', 'b.md']); // sorted by name
    expect(page.next).toEqual(['b.md']);
    const page2 = unwrap(await drive.list_children({ folder: notes.id, after: page.next, limit: 2n }));
    expect(names(page2)).toEqual(['plan.md']);
    expect(page2.next).toEqual([]);

    const renamed = unwrap(await drive.rename(plan.id, 'Roadmap.md'));
    expect(renamed.name).toBe('Roadmap.md');
    expect(unwrap(await drive.resolve_path('/notes/roadmap.md')).id).toBe(plan.id);
    expect(errKind(await drive.resolve_path('/Notes/plan.md'))).toBe('not_found');

    const archive = unwrap(await folder(0n, 'Archive'));
    const sub = unwrap(await folder(archive.id, 'Sub'));
    const moved = unwrap(await drive.move_node(plan.id, archive.id));
    expect(moved.parent).toEqual([archive.id]);
    expect(unwrap(await drive.get_node(archive.id)).children).toBe(2n);
    expect(errKind(await drive.move_node(archive.id, sub.id))).toBe('invalid'); // into its own subfolder
    expect(errKind(await drive.move_node(archive.id, archive.id))).toBe('invalid');
    const path = unwrap(await drive.get_path(plan.id));
    expect(path.map((p) => p.name)).toEqual(['', 'Archive', 'Roadmap.md']);
  });

  it('makes a version on every save that changes the bytes, and reads old ones', async () => {
    const n = unwrap(await file(0n, 'log.md', 'v1'));
    const v1 = n.head[0];
    const s2 = unwrap(await drive.save_file({ node: n.id, content: text('v2'), mime: [], expected_head: [v1] }));
    const v2 = s2.head[0];
    expect(v2).not.toBe(v1);
    // the same bytes again: no new version
    const same = unwrap(await drive.save_file({ node: n.id, content: text('v2'), mime: [], expected_head: [] }));
    expect(same.versions).toBe(2n);
    // a stale expected_head is a conflict that names the head
    expect(errOf(await drive.save_file({ node: n.id, content: text('v3?'), mime: [], expected_head: [v1] }))).toEqual({ conflict: { head: [v2] } });
    const s3 = unwrap(await drive.save_file({ node: n.id, content: { bytes: enc('v3') }, mime: [], expected_head: [v2] }));
    expect(s3.versions).toBe(3n);
    expect(s3.mime).toBe('text/markdown'); // kept from the previous version

    const vs = unwrap(await drive.list_versions({ node: n.id, before: [], limit: 2n }));
    expect(vs.items.map((v) => v.is_head)).toEqual([true, false]);
    expect(vs.items[1].id).toBe(v2);
    expect(vs.next).toEqual([v2]);
    const older = unwrap(await drive.list_versions({ node: n.id, before: vs.next, limit: 2n }));
    expect(older.items.map((v) => v.id)).toEqual([v1]);
    expect((await content(n.id, [v1])).text).toEqual(['v1']);
    expect((await content(n.id)).text).toEqual(['v3']);

    // restoring an old version copies it as a new head
    const r = unwrap(await drive.restore_version(n.id, v1));
    expect(r.versions).toBe(4n);
    expect((await content(n.id)).text).toEqual(['v1']);
    // a version of another file is not found here
    const other = unwrap(await file(0n, 'other.md', 'o'));
    expect(errKind(await drive.get_content({ node: n.id, version: other.head }))).toBe('not_found');

    // the owner purges old versions; the head stays
    const p = unwrap(await drive.purge_versions(n.id, 1n));
    expect(p.purged).toBe(3n);
    const left = unwrap(await drive.list_versions({ node: n.id, before: [], limit: 10n }));
    expect(left.items.length).toBe(1);
    expect((await content(n.id)).text).toEqual(['v1']);
  });

  it('trashes, restores and purges', async () => {
    const box = unwrap(await folder(0n, 'Box'));
    const inner = unwrap(await file(box.id, 'inner.md', 'inside'));
    unwrap(await drive.trash(box.id));
    const innerNow = unwrap(await drive.get_node(inner.id));
    expect(innerNow.in_trash).toBe(true);
    expect(innerNow.trashed).toEqual([]); // trashed through its folder
    expect(names(unwrap(await drive.list_children({ folder: 0n, after: [], limit: 0n })))).not.toContain('Box');
    expect(errKind(await drive.save_file({ node: inner.id, content: text('no'), mime: [], expected_head: [] }))).toBe('in_trash');
    expect(errKind(await drive.restore(inner.id))).toBe('not_in_trash'); // only trash roots restore
    expect(unwrap(await drive.list_trash({ after: [], limit: 0n })).items.map((n) => n.id)).toContain(box.id);

    // the name is free again while Box is in the trash; restoring renames it
    const box2 = unwrap(await folder(0n, 'Box'));
    const back = unwrap(await drive.restore(box.id));
    expect(back.name).toBe('Box (restored)');
    expect(back.in_trash).toBe(false);
    expect(unwrap(await drive.get_node(inner.id)).in_trash).toBe(false);
    expect((await content(inner.id)).text).toEqual(['inside']);

    // a file inside a trashed folder, trashed on its own first, restores to the root
    const f = unwrap(await file(box2.id, 'keep.md', 'k'));
    unwrap(await drive.trash(f.id));
    unwrap(await drive.trash(box2.id));
    const fr = unwrap(await drive.restore(f.id));
    expect(fr.parent).toEqual([0n]);

    // purge: owner only, trash roots only, removes the subtree and its versions
    expect(errKind(await drive.purge(back.id))).toBe('not_in_trash');
    const before = await drive.get_drive_info();
    unwrap(await drive.trash(back.id));
    const pr = unwrap(await drive.purge(back.id));
    expect(pr).toEqual({ purged: 2n, done: true });
    expect(errKind(await drive.get_node(inner.id))).toBe('not_found');
    const after = await drive.get_drive_info();
    expect(after.nodes).toBe(before.nodes - 2n);
    expect(after.versions).toBe(before.versions - 1n);
    expect(after.total_bytes).toBe(before.total_bytes - BigInt(enc('inside').length));

    // empty_trash takes the rest
    const e = unwrap(await drive.empty_trash());
    expect(e.done).toBe(true);
    expect(e.purged).toBe(1n); // box2 (keep.md was restored out of it)
    expect((await drive.get_drive_info()).trash_roots).toBe(0n);
  });

  it('tags any node, lists tag counts and filters by tag', async () => {
    const t = unwrap(await folder(0n, 'Tagged', [' Work ', 'work', 'IDEAS']));
    expect(t.tags).toEqual(['work', 'ideas']);
    const n = unwrap(await file(t.id, 'idea.md', 'An idea about cats', ['ideas']));
    unwrap(await drive.set_tags(n.id, ['ideas', 'cats']));
    const tags = unwrap(await drive.list_tags({ after: [] }));
    expect(tags.next).toEqual([]);
    const count = (tag) => tags.tags.find((x) => x.tag === tag)?.count;
    expect(count('ideas')).toBe(2n);
    expect(count('cats')).toBe(1n);
    expect(count('work')).toBe(1n);
    const hits = unwrap(await drive.search({ query: '', tags: ['cats'], under: [], kind: [], in_content: false, include_trash: false, after: [], limit: 0n }));
    expect(hits.hits.map((h) => h.node.id)).toEqual([n.id]);
    expect(errKind(await drive.set_tags(n.id, Array.from({ length: 21 }, (_, i) => `t${i}`)))).toBe('limit');
    expect(errKind(await drive.set_tags(n.id, ['a,b']))).toBe('invalid');
    expect(errKind(await drive.set_tags(n.id, ['x'.repeat(41)]))).toBe('invalid');
  });

  it('searches names, tags and the text of notes, inside a folder, outside the trash, page by page', async () => {
    const s = unwrap(await folder(0n, 'Search'));
    const a = unwrap(await file(s.id, 'Zebra notes.md', 'Nothing here'));
    const b = unwrap(await file(s.id, 'b.md', 'The quick brown fox jumps over the lazy zebra.'));
    const c = unwrap(await file(s.id, 'c.md', 'plain', ['zebra-tag']));
    const out = unwrap(await file(0n, 'zebra outside.md', 'x'));
    const q = (extra = {}) => drive.search({ query: 'ZEBRA', tags: [], under: [s.id], kind: [], in_content: true, include_trash: false, after: [], limit: 0n, ...extra });

    const r = unwrap(await q());
    expect(r.hits.map((h) => [h.node.id, Object.keys(h.matched)[0]])).toEqual([[a.id, 'name'], [b.id, 'content'], [c.id, 'tag']]);
    expect(r.hits[1].snippet[0]).toMatch(/lazy zebra/);
    expect(r.next).toEqual([]);
    // without content: the note that says it only in its text is not found
    expect(unwrap(await q({ in_content: false })).hits.map((h) => h.node.id)).toEqual([a.id, c.id]);
    // anywhere in the drive
    expect(unwrap(await q({ under: [] })).hits.map((h) => h.node.id)).toContain(out.id);
    // kind filter
    expect(unwrap(await q({ kind: [{ folder: null }] })).hits).toEqual([]);
    // paging: one hit at a time, next = the last node scanned
    const p1 = unwrap(await q({ limit: 1n }));
    expect(p1.hits.map((h) => h.node.id)).toEqual([a.id]);
    const p2 = unwrap(await q({ limit: 1n, after: p1.next }));
    expect(p2.hits.map((h) => h.node.id)).toEqual([b.id]);
    // trashed notes are out unless asked for
    unwrap(await drive.trash(b.id));
    expect(unwrap(await q()).hits.map((h) => h.node.id)).toEqual([a.id, c.id]);
    expect(unwrap(await q({ include_trash: true })).hits.map((h) => h.node.id)).toEqual([a.id, b.id, c.id]);
  });

  it('enforces the limits', async () => {
    const lim = unwrap(await folder(0n, 'Limits'));
    // 64 KiB inline at most
    expect(errKind(await drive.create_file({ parent: lim.id, name: 'big.bin', content: { bytes: new Uint8Array(65_537) }, mime: [], tags: [] }))).toBe('limit');
    unwrap(await drive.create_file({ parent: lim.id, name: 'max.bin', content: { bytes: new Uint8Array(65_536) }, mime: [], tags: [] }));
    // far over the cap: refused at ingress, before it costs the canister anything
    await refusedAtIngress(drive.create_file({ parent: lim.id, name: 'huge.bin', content: { bytes: new Uint8Array(200_000) }, mime: [], tags: [] }));
    // names
    expect(errKind(await folder(lim.id, 'x'.repeat(256)))).toBe('invalid');
    // versions per file (owner setting)
    unwrap(await drive.set_settings({ max_versions_per_node: [3n], max_nodes: [], max_total_bytes: [], retention: [] }));
    const n = unwrap(await file(lim.id, 'v.md', '1'));
    unwrap(await drive.save_file({ node: n.id, content: text('2'), mime: [], expected_head: [] }));
    unwrap(await drive.save_file({ node: n.id, content: text('3'), mime: [], expected_head: [] }));
    expect(errKind(await drive.save_file({ node: n.id, content: text('4'), mime: [], expected_head: [] }))).toBe('limit');
    // retention keep_versions: the owner's choice drops the oldest instead
    unwrap(await drive.set_settings({ max_versions_per_node: [], max_nodes: [], max_total_bytes: [], retention: [{ keep_versions: 2n, trash_days: 0n }] }));
    const k = unwrap(await drive.save_file({ node: n.id, content: text('4'), mime: [], expected_head: [] }));
    expect(k.versions).toBe(2n);
    unwrap(await drive.set_settings({ max_versions_per_node: [200n], max_nodes: [], max_total_bytes: [], retention: [{ keep_versions: 0n, trash_days: 0n }] }));
    // nodes
    const info = await drive.get_drive_info();
    unwrap(await drive.set_settings({ max_nodes: [info.nodes], max_versions_per_node: [], max_total_bytes: [], retention: [] }));
    expect(errKind(await folder(lim.id, 'one too many'))).toBe('limit');
    // total bytes
    unwrap(await drive.set_settings({ max_nodes: [50_000n], max_versions_per_node: [], max_total_bytes: [info.total_bytes + 10n], retention: [] }));
    expect(errKind(await file(lim.id, 'eleven.txt', '12345678901'))).toBe('limit');
    unwrap(await file(lim.id, 'ten.txt', '1234567890'));
    // hard caps clamp settings
    const s = unwrap(await drive.set_settings({ max_nodes: [10_000_000n], max_versions_per_node: [5_000n], max_total_bytes: [1n << 40n], retention: [] }));
    expect(s.max_nodes).toBe(200_000n);
    expect(s.max_versions_per_node).toBe(1_000n);
    expect(s.max_total_bytes).toBe(3n * 1024n ** 3n);
    // page sizes are capped
    const page = unwrap(await drive.list_children({ folder: 0n, after: [], limit: 1_000_000n }));
    expect(page.items.length).toBeLessThanOrEqual(200);
  });

  it('keeps an owner-only ICRC-3 log of the writes', async () => {
    const st = await drive.icrc3_log_status();
    expect(st.log_length).toBeGreaterThan(20n);
    const res = await drive.icrc3_get_blocks([{ start: 0n, length: 5n }]);
    const first = res.blocks[0].block.Map;
    expect(first.find(([k]) => k === 'btype')[1]).toEqual({ Text: 'sneeddrive_create' });
    await expect(as(stranger).icrc3_get_blocks([{ start: 0n, length: 5n }])).rejects.toThrow(/Owner only/);
    await expect(as(stranger).get_log(0n, 10n)).rejects.toThrow(/Owner only/);
    expect((await drive.icrc3_supported_block_types()).length).toBeGreaterThan(5);
  });

  it('refuses every query sent as an update call, and anonymous or non-owner calls at ingress', async () => {
    const svc = driveIdl({ IDL });
    const queries = svc._fields.filter(([, f]) => f.annotations.includes('query')).map(([n]) => n);
    expect(queries.length).toBeGreaterThan(15);
    const upd = actorAs(pic, asUpdates(driveIdl), driveId, owner);
    const argsFor = {
      get_node: [0n], resolve_path: ['/'], get_path: [0n], list_children: [{ folder: 0n, after: [], limit: 1n }],
      get_content: [{ node: 0n, version: [] }], list_versions: [{ node: 0n, before: [], limit: 1n }], list_trash: [{ after: [], limit: 1n }],
      search: [{ query: '', tags: [], under: [], kind: [], in_content: false, include_trash: false, after: [], limit: 1n }],
      list_tags: [{ after: [] }], list_shared_with_me: [{ after: [], limit: 1n }], get_grants: [0n], get_drive_info: [], get_log: [0n, 1n],
      get_api_doc: [], icrc3_get_blocks: [[]], icrc3_get_archives: [{ from: [] }], icrc3_get_tip_certificate: [], icrc3_supported_block_types: [],
      icrc10_supported_standards: [], icrc3_log_status: [],
    };
    for (const q of queries) {
      expect(argsFor[q], `test args for ${q}`).toBeDefined();
      await refusedAtIngress(upd[q](...argsFor[q]));
    }
    const anon = as(Principal.anonymous());
    await refusedAtIngress(anon.create_folder({ parent: 0n, name: 'anon', tags: [] }));
    await refusedAtIngress(anon.create_file({ parent: 0n, name: 'anon.md', content: text('x'), mime: [], tags: [] }));
    await refusedAtIngress(anon.trash(1n));
    await refusedAtIngress(as(stranger).empty_trash());
    await refusedAtIngress(as(stranger).purge(1n));
    await refusedAtIngress(as(stranger).set_settings({ max_nodes: [], max_versions_per_node: [], max_total_bytes: [], retention: [] }));
    await refusedAtIngress(as(stranger).set_owner(stranger));
  });

  it('keeps every node, version, tag, grant and the log over an upgrade', async () => {
    const g = unwrap(await folder(0n, 'Shared'));
    unwrap(await drive.grant({ node: g.id, principal: stranger, role: { read: null } }));
    const n = unwrap(await file(g.id, 'kept.md', 'kept text', ['kept']));
    unwrap(await drive.save_file({ node: n.id, content: text('kept text v2'), mime: [], expected_head: [] }));
    const before = await drive.get_drive_info();
    const logBefore = (await drive.icrc3_log_status()).log_length;
    const tagsBefore = unwrap(await drive.list_tags({ after: [] }));

    await pic.upgradeCanister({ sender: admin, canisterId: driveId, wasm: wasm('sneed_drive'), arg: IDL.encode(driveInit({ IDL }), [[]]), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });

    const after = await drive.get_drive_info();
    expect({ ...after, cycles: 0n }).toEqual({ ...before, cycles: 0n });
    expect(after.owner).toEqual([owner]); // the upgrade argument does not reset the owner
    expect((await drive.icrc3_log_status()).log_length).toBe(logBefore);
    expect(unwrap(await drive.list_tags({ after: [] }))).toEqual(tagsBefore);
    expect((await content(n.id)).text).toEqual(['kept text v2']);
    expect(unwrap(await drive.list_versions({ node: n.id, before: [], limit: 10n })).items.length).toBe(2);
    expect(unwrap(await as(stranger).get_content({ node: n.id, version: [] })).text).toEqual(['kept text v2']);
    // and it keeps working
    unwrap(await file(g.id, 'after.md', 'after'));
    expect((await drive.get_drive_info()).nodes).toBe(before.nodes + 1n);
    expect((await drive.icrc3_log_status()).log_length).toBe(logBefore + 1n);
  });
});
