// sneed_avatars (spec/sneed_names.md §7): images checked by their bytes, stored once by SHA-256 in
// stable memory, held by their uploaders within limits (more with premium), freed when nobody
// holds them (and their slots reused), removed and blocked by admins, served over HTTP and by
// query, the ingress guard and an upgrade.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, T, unwrap, errOf, wasm, nowNs, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { premiumIdl } from '../lib/idl.js';
import { idlFactory as avatarsIdl } from '../build/sneed_avatars.did.js';

const anon = Principal.anonymous();
const dave = user('dave');
const png = (n = 1000) => Uint8Array.from(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(n)]));
const jpeg = (n = 1000) => Uint8Array.from(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(n)]));
const webp = () => Uint8Array.from(Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), randomBytes(100)]));
const sha = (b) => Uint8Array.from(createHash('sha256').update(b).digest());
const hex = (b) => Buffer.from(b).toString('hex');

let pic, appSubnet, avId, premiumId, av, premium;
const A = (p) => actorAs(pic, avatarsIdl, avId, p);
const get = (path, method = 'GET') => av.http_request({ method, url: path, headers: [], body: new Uint8Array() });

describe('sneed_avatars', () => {
  beforeAll(async () => {
    ({ pic, appSubnet } = await createPic());
    avId = await install(pic, { name: 'sneed_avatars', cycles: 20n * T, targetSubnetId: appSubnet });
    premiumId = await install(pic, { name: 'MockPremium', targetSubnetId: appSubnet });
    av = A(admin);
    premium = actorAs(pic, premiumIdl, premiumId, admin);
    unwrap(await av.admin_set_config({ max_held: 2n, max_held_premium: 3n, premium: [premiumId] }));
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('stores images once by their hash, checking what they are', async () => {
    expect(await refusedAtIngress(A(anon).upload(png()))).toBe(true);
    expect(errOf(await A(alice).upload(Uint8Array.from(Buffer.from('<svg></svg>'))))).toMatch(/Only PNG/);
    expect(errOf(await A(alice).upload(png(49_152)))).toMatch(/48 KiB/);
    const img = png(5000);
    const h = unwrap(await A(alice).upload(img));
    expect(hex(h)).toBe(hex(sha(img)));
    expect(hex(unwrap(await A(alice).upload(img)))).toBe(hex(h)); // again: nothing changes
    expect(hex(unwrap(await A(bob).upload(img)))).toBe(hex(h)); // someone else: held twice, stored once
    const [info] = await av.get_info([h]);
    expect(info[0]).toMatchObject({ content_type: 'image/png', size: BigInt(img.length), holders: 2n });
    expect((await av.stats()).images).toBe(1n);
    const [got] = await av.get_images([h]);
    expect(Buffer.from(got[0].bytes).equals(Buffer.from(img))).toBe(true);
    expect((await A(alice).my_images()).map((i) => hex(i.hash))).toEqual([hex(h)]);
    expect(unwrap(await A(carol).upload(webp())).length).toBe(32);
  });

  it('serves images over HTTP, cached for good', async () => {
    const img = jpeg(3000);
    const h = unwrap(await A(alice).upload(img));
    const r = await get(`/${hex(h)}`);
    expect(r.status_code).toBe(200);
    expect(Buffer.from(r.body).equals(Buffer.from(img))).toBe(true);
    expect(Object.fromEntries(r.headers)).toMatchObject({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' });
    expect((await get(`/${hex(h).toUpperCase()}?v=1`)).status_code).toBe(200);
    expect((await get(`/${hex(h)}`, 'HEAD')).body.length).toBe(0);
    expect((await get('/nope')).status_code).toBe(404);
    expect((await get(`/${'0'.repeat(64)}`)).status_code).toBe(404);
    expect((await get(`/${hex(h)}`, 'POST')).status_code).toBe(405);
  });

  it('limits what one holds, more with premium, and frees what nobody holds', async () => {
    expect(errOf(await A(alice).upload(png()))).toMatch(/hold 2 images already.*Premium/);
    await premium.set_member(alice, (await nowNs(pic)) + 86_400_000_000_000n);
    const third = unwrap(await A(alice).upload(png(2000)));
    expect(errOf(await A(alice).upload(png()))).toMatch(/hold 3 images already; release one first$/);
    const before = await av.stats();
    unwrap(await A(alice).release(third));
    expect(errOf(await A(alice).release(third))).toMatch(/do not hold/);
    const after = await av.stats();
    expect(after.images).toBe(before.images - 1n);
    expect(await av.get_images([third])).toEqual([[]]);
    // a freed slot is reused: the region does not grow
    unwrap(await A(alice).upload(png(2500)));
    expect((await av.stats()).region_bytes).toBe(after.region_bytes);
  });

  it('lets admins remove an image for good', async () => {
    const img = png(800);
    const h = unwrap(await A(carol).upload(img));
    expect(await refusedAtIngress(A(bob).admin_remove(h))).toBe(true);
    unwrap(await av.admin_remove(h));
    expect((await get(`/${hex(h)}`)).status_code).toBe(404);
    expect((await A(carol).my_images()).map((i) => hex(i.hash))).not.toContain(hex(h));
    expect(errOf(await A(carol).upload(img))).toMatch(/removed/);
    expect(errOf(await A(dave).upload(img))).toMatch(/removed/);
    // admins upload for a principal (migrating inline avatars)
    const mine = png(700);
    const hm = unwrap(await av.admin_upload_for(dave, mine));
    expect((await A(dave).my_images()).map((i) => hex(i.hash))).toEqual([hex(hm)]);
  });

  it('guards ingress and keeps the images over an upgrade', async () => {
    const attacker = actorAs(pic, asUpdates(avatarsIdl), avId, bob);
    expect(await refusedAtIngress(attacker.get_images([]))).toBe(true);
    expect(await refusedAtIngress(attacker.http_request({ method: 'GET', url: '/', headers: [], body: new Uint8Array() }))).toBe(true);
    expect(await refusedAtIngress(A(bob).upload(new Uint8Array(70_000)))).toBe(true);
    const mine = await A(alice).my_images();
    const imgs = await av.get_images(mine.map((i) => i.hash));
    const stats = await av.stats();
    await pic.upgradeCanister({ sender: admin, canisterId: avId, wasm: wasm('sneed_avatars'), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    expect(await av.get_images(mine.map((i) => i.hash))).toEqual(imgs);
    expect(await av.stats()).toEqual(stats);
    unwrap(await A(user('after')).upload(png(100)));
  });
});
