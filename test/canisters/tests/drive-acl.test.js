// sneed_drive, phase 0: access control (spec/sneed_drive_phase0.md §3). Grants (read / write /
// manage) inherit down the tree; without a grant there is no access; a revoked grant takes effect
// at once; manage may share, write may not; anonymous callers have no access and can't write;
// the owner is separate from the controllers (and the controllers own the drive while no owner
// is set).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, actorAs, admin, user, T, unwrap, errOf, wasm, refusedAtIngress } from '../lib/pic.js';
import { idlFactory as driveIdl, init as driveInit } from '../build/sneed_drive.did.js';

const owner = user('acl-owner');
const ann = user('acl-ann'); // gets read, then write
const ben = user('acl-ben'); // gets manage
const cal = user('acl-cal'); // shared by ben
const eve = user('acl-eve'); // never granted
const text = (s) => ({ text: s });
const errKind = (r) => Object.keys(errOf(r))[0];
const READ = { read: null }, WRITE = { write: null }, MANAGE = { manage: null };

let pic, appSubnet, driveId, as, o;
let shared, sub, note, deep, privateNote;

async function installDrive(initArg) {
  const canisterId = await pic.createCanister({ sender: admin, cycles: 50n * T, targetSubnetId: appSubnet, controllers: [admin] });
  await pic.installCode({ sender: admin, canisterId, wasm: wasm('sneed_drive'), arg: IDL.encode(driveInit({ IDL }), [initArg]) });
  return canisterId;
}

describe('sneed_drive phase 0: access', () => {
  beforeAll(async () => {
    ({ pic, appSubnet } = await createPic());
    driveId = await installDrive([{ owner: [owner], settings: [] }]);
    as = (p) => actorAs(pic, driveIdl, driveId, p);
    o = as(owner);
    shared = unwrap(await o.create_folder({ parent: 0n, name: 'Shared', tags: [] }));
    sub = unwrap(await o.create_folder({ parent: shared.id, name: 'Sub', tags: ['sub'] }));
    note = unwrap(await o.create_file({ parent: shared.id, name: 'note.md', content: text('shared words'), mime: [], tags: ['team'] }));
    deep = unwrap(await o.create_file({ parent: sub.id, name: 'deep.md', content: text('deep words'), mime: [], tags: [] }));
    privateNote = unwrap(await o.create_file({ parent: 0n, name: 'private.md', content: text('secret words'), mime: [], tags: ['secret'] }));
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  const search = (p, q) => as(p).search({ query: q, tags: [], under: [], kind: [], in_content: true, include_trash: false, after: [], limit: 0n });

  it('gives no access without a grant', async () => {
    const e = as(eve);
    expect(errKind(await e.get_node(note.id))).toBe('forbidden');
    expect(errKind(await e.get_content({ node: note.id, version: [] }))).toBe('forbidden');
    expect(errKind(await e.list_children({ folder: 0n, after: [], limit: 0n }))).toBe('forbidden');
    expect(errKind(await e.list_versions({ node: note.id, before: [], limit: 0n }))).toBe('forbidden');
    expect(errKind(await e.resolve_path('/Shared/note.md'))).toBe('not_found'); // no name probing
    expect(unwrap(await search(eve, 'words')).hits).toEqual([]);
    expect(unwrap(await e.list_tags({ after: [] })).tags).toEqual([]);
    expect(unwrap(await e.list_shared_with_me({ after: [], limit: 0n })).items).toEqual([]);
    expect(errKind(await e.create_file({ parent: shared.id, name: 'x.md', content: text('x'), mime: [], tags: [] }))).toBe('forbidden');
    expect(errKind(await e.save_file({ node: note.id, content: text('x'), mime: [], expected_head: [] }))).toBe('forbidden');
    expect(errKind(await e.trash(note.id))).toBe('forbidden');
    expect(errKind(await e.grant({ node: note.id, principal: eve, role: READ }))).toBe('forbidden');
    // the controller is not the owner once an owner is set
    expect(errKind(await as(admin).get_node(note.id))).toBe('forbidden');
  });

  it('refuses anonymous callers: no access on reads, writes refused at ingress', async () => {
    const anon = as(Principal.anonymous());
    expect(errKind(await anon.get_node(0n))).toBe('forbidden');
    await refusedAtIngress(anon.create_file({ parent: 0n, name: 'a.md', content: text('a'), mime: [], tags: [] }));
    await refusedAtIngress(anon.save_file({ node: note.id, content: text('a'), mime: [], expected_head: [] }));
    await refusedAtIngress(anon.grant({ node: note.id, principal: ann, role: READ }));
    expect(errOf(await o.grant({ node: shared.id, principal: Principal.anonymous(), role: READ }))).toHaveProperty('invalid');
    expect(errOf(await o.grant({ node: shared.id, principal: owner, role: READ }))).toHaveProperty('invalid');
  });

  it('inherits a read grant down the tree, and read is not write', async () => {
    unwrap(await o.grant({ node: shared.id, principal: ann, role: READ }));
    const a = as(ann);
    expect(unwrap(await a.get_node(shared.id)).my_access).toEqual(READ);
    expect(unwrap(await a.get_content({ node: deep.id, version: [] })).text).toEqual(['deep words']);
    expect(unwrap(await a.list_children({ folder: shared.id, after: [], limit: 0n })).items.map((n) => n.name)).toEqual(['note.md', 'Sub']);
    expect(unwrap(await a.resolve_path('/shared/sub/deep.md')).id).toBe(deep.id);
    // breadcrumbs start where the grant starts
    expect(unwrap(await a.get_path(deep.id)).map((p) => p.name)).toEqual(['Shared', 'Sub', 'deep.md']);
    // search and tags see only what ann can read
    expect(unwrap(await search(ann, 'words')).hits.map((h) => h.node.id)).toEqual([note.id, deep.id]);
    const tags = unwrap(await a.list_tags({ after: [] })).tags.map((t) => t.tag);
    expect(tags).toEqual(['sub', 'team']);
    expect(errKind(await a.get_node(privateNote.id))).toBe('forbidden');
    expect(errKind(await a.list_children({ folder: 0n, after: [], limit: 0n }))).toBe('forbidden');
    // the entry point
    const mine = unwrap(await a.list_shared_with_me({ after: [], limit: 0n })).items;
    expect(mine.map((s) => [s.node.id, s.role])).toEqual([[shared.id, READ]]);
    // read is not write
    expect(errKind(await a.save_file({ node: note.id, content: text('ann was here'), mime: [], expected_head: [] }))).toBe('forbidden');
    expect(errKind(await a.create_folder({ parent: sub.id, name: 'Ann', tags: [] }))).toBe('forbidden');
    expect(errKind(await a.set_tags(note.id, ['x']))).toBe('forbidden');
    expect(errKind(await a.get_grants(shared.id))).toBe('forbidden');
  });

  it('inherits a write grant: save, create, move within, trash and restore; no sharing, no purge', async () => {
    unwrap(await o.grant({ node: shared.id, principal: ann, role: WRITE })); // replaces read
    const a = as(ann);
    const s = unwrap(await a.save_file({ node: deep.id, content: text('deep words, edited by ann'), mime: [], expected_head: [] }));
    expect(s.modified_by.toText()).toBe(ann.toText());
    const mine = unwrap(await a.create_file({ parent: sub.id, name: 'ann.md', content: text('by ann'), mime: [], tags: [] }));
    expect(mine.created_by.toText()).toBe(ann.toText());
    expect(unwrap(await a.move_node(mine.id, shared.id)).parent).toEqual([shared.id]);
    // not out of the shared folder into a folder ann can't write
    expect(errKind(await a.move_node(mine.id, 0n))).toBe('forbidden');
    unwrap(await a.trash(mine.id));
    unwrap(await a.restore(mine.id));
    expect(errKind(await a.grant({ node: shared.id, principal: eve, role: READ }))).toBe('forbidden');
    await refusedAtIngress(a.purge(mine.id));
    await refusedAtIngress(a.purge_versions(deep.id, 1n));
    await refusedAtIngress(a.empty_trash());
    // the owner sees who changed what
    const vs = unwrap(await o.list_versions({ node: deep.id, before: [], limit: 0n })).items;
    expect(vs[0].created_by.toText()).toBe(ann.toText());
  });

  it('manage may share and revoke inside its folder, write may not; get_grants shows direct and inherited', async () => {
    unwrap(await o.grant({ node: shared.id, principal: ben, role: MANAGE }));
    const b = as(ben);
    unwrap(await b.grant({ node: sub.id, principal: cal, role: READ }));
    expect(unwrap(await as(cal).get_content({ node: deep.id, version: [] })).text[0]).toMatch(/deep words/);
    expect(errKind(await as(cal).get_node(note.id))).toBe('forbidden'); // only Sub was shared with cal
    const g = unwrap(await b.get_grants(sub.id));
    expect(g.direct.map((x) => [x.principal.toText(), x.role])).toEqual([[cal.toText(), READ]]);
    expect(g.inherited.map((x) => [x.node, x.principal.toText()])).toEqual([[shared.id, ann.toText()], [shared.id, ben.toText()]]);
    // not outside the managed folder
    expect(errKind(await b.grant({ node: privateNote.id, principal: cal, role: READ }))).toBe('forbidden');
    unwrap(await b.revoke({ node: sub.id, principal: cal }));
    expect(errKind(await as(cal).get_node(deep.id))).toBe('forbidden');
    // write can't see grants
    expect(errKind(await as(ann).get_grants(shared.id))).toBe('forbidden');
  });

  it('a revoked grant takes effect at once', async () => {
    unwrap(await o.revoke({ node: shared.id, principal: ann }));
    const a = as(ann);
    expect(errKind(await a.get_node(note.id))).toBe('forbidden');
    expect(errKind(await a.get_content({ node: deep.id, version: [] }))).toBe('forbidden');
    expect(errKind(await a.save_file({ node: deep.id, content: text('again'), mime: [], expected_head: [] }))).toBe('forbidden');
    expect(unwrap(await search(ann, 'words')).hits).toEqual([]);
    expect(unwrap(await a.list_shared_with_me({ after: [], limit: 0n })).items).toEqual([]);
    expect(errKind(await o.revoke({ node: shared.id, principal: ann }))).toBe('not_found');
  });

  it('grants in the trash: still inherited for reading, but no writes until restored', async () => {
    unwrap(await o.grant({ node: sub.id, principal: ann, role: WRITE }));
    unwrap(await o.trash(sub.id));
    const a = as(ann);
    expect(unwrap(await a.get_node(deep.id)).in_trash).toBe(true);
    expect(errKind(await a.save_file({ node: deep.id, content: text('x'), mime: [], expected_head: [] }))).toBe('in_trash');
    expect(unwrap(await a.list_trash({ after: [], limit: 0n })).items.map((n) => n.id)).toEqual([sub.id]);
    expect(unwrap(await as(eve).list_trash({ after: [], limit: 0n })).items).toEqual([]);
    unwrap(await a.restore(sub.id));
    unwrap(await a.save_file({ node: deep.id, content: text('restored and edited'), mime: [], expected_head: [] }));
  });

  it('the owner hands the drive on; controllers own it while no owner is set', async () => {
    // a drive installed without an owner (as sneedapp mints today): its controllers own it
    const id2 = await installDrive([]);
    const ctl = actorAs(pic, driveIdl, id2, admin);
    expect((await ctl.get_drive_info()).owner).toEqual([]);
    expect(unwrap(await ctl.get_node(0n)).my_access).toEqual({ owner: null });
    unwrap(await ctl.create_folder({ parent: 0n, name: 'Mine', tags: [] }));
    expect(errKind(await actorAs(pic, driveIdl, id2, eve).get_node(0n))).toBe('forbidden');
    // the controller sets an owner; from then on the controller has no access
    expect(unwrap(await ctl.set_owner(eve))).toEqual([eve]);
    expect(unwrap(await actorAs(pic, driveIdl, id2, eve).get_node(0n)).my_access).toEqual({ owner: null });
    expect(errKind(await ctl.get_node(0n))).toBe('forbidden');

    // on the first drive the owner hands over to ben, whose own grants go
    unwrap(await o.set_owner(ben));
    expect(unwrap(await as(ben).get_node(privateNote.id)).my_access).toEqual({ owner: null });
    expect(errKind(await o.get_node(privateNote.id))).toBe('forbidden');
    expect(unwrap(await as(ben).list_shared_with_me({ after: [], limit: 0n })).items).toEqual([]);
    expect((await as(ben).get_drive_info()).owner).toEqual([ben]);
  });
});
