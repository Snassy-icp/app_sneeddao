// sneed_nft (spec/diamond_club_icrc7.md, spec/nft_launchpad.md §2.1): the Sneed Diamond Club's
// ICRC-7 collection canister, against a mock EXT collection (canisters/MockExt.mo), the real ICRC
// ledger wasm, a mock ICRC-3 ledger with failure modes (canisters/MockProofLedger.mo) and the mock
// ICP ledger (query_blocks, legacy transfer).
//
// - the load: collection metadata, the image manifest (once), batch mint, chunked image upload with
//   the SHA-256 checked against the manifest, freeze_metadata and lock_minting (one-way)
// - HTTP: every response certified (response verification v2), checked here independently (the
//   certificate against the subnet key, the witness against certified_data, the response hash
//   recomputed in JavaScript, absence proofs for the 404), streaming of a large original, and
//   end to end through PocketIC's HTTP gateway, which verifies responses as icp0.io does
// - ICRC-7 / ICRC-37: transfers, deduplication, approvals, transfer_from, revocation
// - the swap by send: happy path, double claims, someone else's cards, racing claims, an
//   unreadable registry, pause, rate limit
// - proof by payment: ICRC-3 (real ledger and mock), ICP (account identifiers), reused blocks,
//   ledgers off the list, wrong destination, approvals, refund failure + retry, unknown outcome
//   (no double refund), a fee change needing an admin
// - the ICRC-3 log (verified chain and certified tip), an upgrade with keep, the ingress guard,
//   an idle canister's cycle burn, and a full 1,000-card collection (mint, a 476-card claim)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { Certificate, Cbor, reconstruct, lookupResultToBuffer } from '@icp-sdk/core/agent';
import { createRequire } from 'node:module';
import { createPic, install, actorAs, account, admin, alice, bob, carol, user, T, unwrap, errOf, BUILD, wasm, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { extIdl, extAccountId } from '../lib/idl.js';
import { archiveIdl, verifyLog, hashValue, sha256, btype, txField } from '../lib/icrc3.js';
import { idlFactory as nftIdl } from '../build/sneed_nft.did.js';

const E8S = 100_000_000n;
const ledgerGz = resolve(BUILD, 'ledger.wasm.gz');
const haveLedger = existsSync(ledgerGz);
const minter = user('minter');
const dave = user('dave');
const erin = user('erin');
const frank = user('frank');
const gina = user('gina');
const hank = user('hank');
const ivy = user('ivy');
const judy = user('judy');

const hex = (b) => Buffer.from(b).toString('hex');
const swapSub = (p) => sha256(Buffer.concat([Buffer.from('sdc-swap'), Buffer.from(p.toUint8Array())]));
const proofSub = (p) => sha256(Buffer.concat([Buffer.from('sdc-proof'), Buffer.from(p.toUint8Array())]));
const card = (token_id, size = 'orig') => ({ card: { token_id: BigInt(token_id), size: { [size]: null } } });
const image = (n) => { const b = randomBytes(n); b[0] = 0xff; b[1] = 0xd8; return b; }; // JPEG magic, random rest
const ok = (r) => unwrap(r);
const js = (x) => JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v));

// ---- mock ledgers ----
const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const TransferArg = IDL.Record({ from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)), to: Account, amount: IDL.Nat, fee: IDL.Opt(IDL.Nat), memo: IDL.Opt(IDL.Vec(IDL.Nat8)), created_at_time: IDL.Opt(IDL.Nat64) });
const proofLedgerIdl = ({ IDL: I }) => I.Service({
  test_transfer: I.Func([Account, Account, I.Nat], [I.Nat], []),
  test_transfer_legacy: I.Func([Account, Account, I.Nat], [I.Nat], []),
  test_transfer_from: I.Func([Account, Account, Account, I.Nat], [I.Nat], []),
  test_approve: I.Func([Account, Account], [I.Nat], []),
  set_mode: I.Func([I.Variant({ ok: I.Null, error: I.Null, trap: I.Null, trap_after: I.Null })], [], []),
  set_fee: I.Func([I.Nat], [], []),
  set_archived_upto: I.Func([I.Nat], [], []),
  balance_of: I.Func([Account], [I.Nat], ['query']),
  get_refunds: I.Func([], [I.Vec(I.Tuple(I.Principal, TransferArg, I.Nat))], ['query']),
});
const LedgerArg = IDL.Variant({
  Init: IDL.Record({
    minting_account: Account, transfer_fee: IDL.Nat, decimals: IDL.Opt(IDL.Nat8), token_symbol: IDL.Text, token_name: IDL.Text,
    metadata: IDL.Vec(IDL.Tuple(IDL.Text, IDL.Variant({ Nat: IDL.Nat, Int: IDL.Int, Text: IDL.Text, Blob: IDL.Vec(IDL.Nat8) }))),
    initial_balances: IDL.Vec(IDL.Tuple(Account, IDL.Nat)), feature_flags: IDL.Opt(IDL.Record({ icrc2: IDL.Bool })),
    archive_options: IDL.Record({ num_blocks_to_archive: IDL.Nat64, trigger_threshold: IDL.Nat64, controller_id: IDL.Principal, cycles_for_archive_creation: IDL.Opt(IDL.Nat64) }),
  }),
  Upgrade: IDL.Opt(IDL.Record({})),
});
const icrcIdl = ({ IDL: I }) => I.Service({
  icrc1_transfer: I.Func([TransferArg], [I.Variant({ Ok: I.Nat, Err: I.Reserved })], []),
  icrc1_balance_of: I.Func([Account], [I.Nat], ['query']),
  icrc2_approve: I.Func([I.Record({ from_subaccount: I.Opt(I.Vec(I.Nat8)), spender: Account, amount: I.Nat, expected_allowance: I.Opt(I.Nat), expires_at: I.Opt(I.Nat64), fee: I.Opt(I.Nat), memo: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64) })], [I.Variant({ Ok: I.Nat, Err: I.Reserved })], []),
  icrc2_transfer_from: I.Func([I.Record({ spender_subaccount: I.Opt(I.Vec(I.Nat8)), from: Account, to: Account, amount: I.Nat, fee: I.Opt(I.Nat), memo: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64) })], [I.Variant({ Ok: I.Nat, Err: I.Reserved })], []),
});
const Tokens = IDL.Record({ e8s: IDL.Nat64 });
const icpIdl = ({ IDL: I }) => I.Service({
  icrc1_transfer: I.Func([TransferArg], [I.Variant({ Ok: I.Nat, Err: I.Reserved })], []),
  test_transfer_from: I.Func([Account, Account, Account, I.Nat], [I.Nat], []),
  set_transfer_failing: I.Func([I.Bool], [], []),
  get_legacy_transfers: I.Func([], [I.Vec(I.Tuple(I.Principal, I.Record({ memo: I.Nat64, amount: Tokens, fee: Tokens, from_subaccount: I.Opt(I.Vec(I.Nat8)), to: I.Vec(I.Nat8), created_at_time: I.Opt(I.Record({ timestamp_nanos: I.Nat64 })) }), I.Nat))], ['query']),
});
const extMore = ({ IDL: I }) => I.Service({
  mint_many: I.Func([I.Text, I.Nat], [], []),
  set_registry_failing: I.Func([I.Bool], [], []),
  set_bearer: I.Func([I.Nat32, I.Text], [], []),
  getRegistry: I.Func([], [I.Vec(I.Tuple(I.Nat32, I.Text))], ['query']),
});

// ---- HTTP: an independent check of a certified response ----
function headerMap(resp) { const m = {}; for (const [k, v] of resp.headers) m[k.toLowerCase()] = v; return m; }
function parseCertificateHeader(h) {
  const get = (k) => { const m = h.match(new RegExp(`${k}=:([^:]*):`)); return m ? Buffer.from(m[1], 'base64') : null; };
  return { certificate: get('certificate'), tree: get('tree'), exprPath: get('expr_path'), version: /version=(\d+)/.exec(h)?.[1] };
}
// IC hash tree lookup with byte-wise label order (the agent's lookup_path compares labels of
// different lengths wrongly, e.g. finds nothing after an empty label): Found / Absent / Unknown.
const cmpLabel = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
function findLabel(l, t) {
  switch (t[0]) {
    case 2: { const c = cmpLabel(l, t[1]); return c === 0 ? { s: 'Found', v: t[2] } : { s: c < 0 ? 'Less' : 'Greater' }; }
    case 1: {
      const a = findLabel(l, t[1]);
      if (a.s === 'Greater') { const b = findLabel(l, t[2]); return b.s === 'Less' ? { s: 'Absent' } : b; }
      if (a.s === 'Unknown') { const b = findLabel(l, t[2]); return b.s === 'Less' ? { s: 'Unknown' } : b; }
      return a;
    }
    case 4: return { s: 'Unknown' };
    default: return { s: 'Absent' };
  }
}
function lookup(path, t) {
  if (path.length === 0) return t[0] === 4 ? 'Unknown' : t[0] === 0 ? 'Absent' : 'Found';
  const r = findLabel(typeof path[0] === 'string' ? Buffer.from(path[0]) : path[0], t);
  if (r.s === 'Found') return lookup(path.slice(1), r.v);
  return r.s === 'Unknown' ? 'Unknown' : 'Absent';
}
// the official verifier (the Rust code HTTP gateways run, as wasm), when it is installed
let official = null;
try { official = createRequire(import.meta.url)('@dfinity/response-verification'); } catch { /* not installed: the checks below and the gateway test */ }

/// Verifies `resp` (status, headers, the whole `body`) the way an HTTP gateway does: the
/// certificate against the root key, the witness against certified_data, the expression path
/// for `path` (exact, or the root wildcard with every more specific candidate provably absent),
/// and the response hash recomputed here. Returns the expression path.
async function verifyHttp(resp, body, canisterId, rootKey, path) {
  const hs = headerMap(resp);
  expect(hs['ic-certificate'], 'IC-Certificate header').toBeTruthy();
  const { certificate, tree: treeBytes, exprPath: exprBytes, version } = parseCertificateHeader(hs['ic-certificate']);
  expect(version).toBe('2');
  const cert = await Certificate.create({ certificate: new Uint8Array(certificate), rootKey, principal: { canisterId }, disableTimeVerification: true });
  const certified = Buffer.from(lookupResultToBuffer(cert.lookup_path(['canister', canisterId.toUint8Array(), 'certified_data'])));
  const tree = Cbor.decode(new Uint8Array(treeBytes));
  expect(Buffer.from(await reconstruct(tree)).equals(certified), 'witness root = certified_data').toBe(true);
  const exprPath = Cbor.decode(new Uint8Array(exprBytes));
  // an exact path for the request path, or the root wildcard with every more specific candidate
  // (the path's and its parents' wildcards, as file and as directory) provably absent
  const segs = path.split('?')[0].replace(/^\//, '').split('/');
  if (exprPath[exprPath.length - 1] === '<$>') {
    expect(exprPath).toEqual(['http_expr', ...segs, '<$>']);
  } else {
    expect(exprPath).toEqual(['http_expr', '<*>']);
    const candidates = [['http_expr', ...segs, '<$>']];
    for (let j = segs.length; j >= 0; j--) candidates.push(['http_expr', ...segs.slice(0, j), '<*>'], ['http_expr', ...segs.slice(0, j), '', '<*>']);
    for (const c of candidates) if (JSON.stringify(c) !== JSON.stringify(exprPath)) expect(lookup(c, tree), `${c.join('/')} absent`).toBe('Absent');
  }
  // the response hash, independently
  const expr = hs['ic-certificateexpression'];
  const names = JSON.parse(/headers:(\[[^\]]*\])/.exec(expr)[1]);
  const entries = names.filter((n) => n in hs).map((n) => [n, { Text: hs[n] }]);
  entries.push(['ic-certificateexpression', { Text: expr }]);
  entries.push([':ic-cert-status', { Nat: BigInt(resp.status_code) }]);
  const respHash = sha256(Buffer.concat([hashValue({ Map: entries }), sha256(Buffer.from(body))]));
  expect(lookup([...exprPath, sha256(Buffer.from(expr)), new Uint8Array(0), respHash], tree), `response leaf in the witness (${path} ${resp.status_code})`).toBe('Found');
  if (official) {
    const now = BigInt(Math.round(await pic.getTime())) * 1_000_000n;
    official.verifyRequestResponsePair({ url: path, method: 'GET', body: new Uint8Array(0), headers: [], certificate_version: [2] },
      { status_code: resp.status_code, headers: resp.headers, body }, canisterId.toUint8Array(), now, 300_000_000_000n, rootKey, 2);
  }
  return exprPath;
}
const get = (nft, url) => nft.http_request({ method: 'GET', url, headers: [], body: new Uint8Array(0), certificate_version: [2] });
/// The whole body: the first response and every streamed chunk.
async function fullBody(nft, resp) {
  const parts = [Buffer.from(resp.body)];
  let token = resp.streaming_strategy[0]?.Callback.token;
  while (token) {
    const r = await nft.http_request_streaming_callback(token);
    parts.push(Buffer.from(r.body));
    token = r.token[0];
  }
  return Buffer.concat(parts);
}

let pic, rootKey, appSubnet, nftId, extId, nft, nftAs, ext, extX;
const cards = new Map(); // token id -> { orig, web, thumb }
const N = 12; // cards in this collection (token 12 has an original over the streaming chunk)

async function upload(actor, target, bytes, { contentType = 'image/jpeg', chunk = 1_000_000 } = {}) {
  const id = ok(await actor.image_upload_begin({ target, size: BigInt(bytes.length), content_type: contentType }));
  for (let off = 0; off < bytes.length; off += chunk) ok(await actor.image_upload_chunk(id, BigInt(off), bytes.subarray(off, off + chunk)));
  return actor.image_upload_finish(id);
}
const meta = (n) => ({ Map: [
  ['name', { Text: `Sneed Diamond Club #${n}` }],
  ['description', { Text: 'A Sneed Diamond Club membership card.' }],
  ['attributes', { Array: [{ Map: [['trait_type', { Text: 'Card Number' }], ['value', { Text: String(n) }]] }] }],
  ['external_url', { Text: 'https://app.sneeddao.com' }],
] });
const mintReq = (id, owner = []) => ({ token_id: BigInt(id), metadata: meta(id), owner, override: false, memo: [], created_at_time: [] });
const metaOf = async (id) => Object.fromEntries((await nft.icrc7_token_metadata([BigInt(id)]))[0][0]);
const ownerOf = async (id) => (await nft.icrc7_owner_of([BigInt(id)]))[0][0];
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;

describe('sneed_nft', () => {
  beforeAll(async () => {
    ({ pic, appSubnet, rootKey } = await createPic());
    extId = await install(pic, { name: 'MockExt', targetSubnetId: appSubnet });
    nftId = await install(pic, { name: 'sneed_nft', targetSubnetId: appSubnet, cycles: 50n * T });
    nft = actorAs(pic, nftIdl, nftId, admin);
    nftAs = (p) => actorAs(pic, nftIdl, nftId, p);
    ext = actorAs(pic, extIdl, extId, admin);
    extX = actorAs(pic, extMore, extId, admin);
    ok(await nft.admin_set_ext_canister(extId));
    // these tests script many claims from a few callers; one test below checks the limit itself
    ok(await nft.admin_set_rate_limit('claim', [{ capacity: 0n, per_minute: 0n }]));
    for (let n = 1; n <= N; n++) cards.set(n, { orig: image(n === N ? 2_600_000 : 3_000 + n), web: image(900 + n), thumb: image(300 + n) });
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  describe('the load', () => {
    it('sets the collection metadata (admins only, validated)', async () => {
      expect(errOf(await nft.set_collection({ name: [''], symbol: [], description: [], logo: [], supply_cap: [] }))).toMatch(/name/);
      ok(await nft.set_collection({ name: ['Sneed Diamond Club'], symbol: ['SDC'], description: [['1,000 membership cards of the Sneed DAO']], logo: [[`https://${nftId.toText()}.icp0.io/logo.jpg`]], supply_cap: [[1000n]] }));
      expect(errOf(await nft.set_collection({ name: [], symbol: [], description: [], logo: [], supply_cap: [[1001n]] }))).toMatch(/only be lowered/);
      const m = Object.fromEntries(await nft.icrc7_collection_metadata());
      expect(m['icrc7:name']).toEqual({ Text: 'Sneed Diamond Club' });
      expect(m['icrc7:symbol']).toEqual({ Text: 'SDC' });
      expect(m['icrc7:supply_cap']).toEqual({ Nat: 1000n });
      expect(await nft.icrc7_logo()).toEqual([`https://${nftId.toText()}.icp0.io/logo.jpg`]);
      expect((await nft.icrc10_supported_standards()).map((s) => s.name)).toEqual(['ICRC-7', 'ICRC-37', 'ICRC-3', 'ICRC-10']);
    });

    it('takes the image manifest once, and publishes its hash', async () => {
      expect(errOf(await nft.set_image_manifest([[1n, new Uint8Array(31)]]))).toMatch(/32 bytes/);
      expect(errOf(await nft.set_image_manifest([[1n, new Uint8Array(32)], [1n, new Uint8Array(32)]]))).toMatch(/twice/);
      const entries = [...cards.entries()].map(([n, c]) => [BigInt(n), sha256(c.orig)]);
      const digest = ok(await nft.set_image_manifest(entries));
      // SHA-256 over (8-byte big-endian token id ‖ hash) in token order, computed here
      const expected = sha256(Buffer.concat(entries.map(([id, h]) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(id); return Buffer.concat([b, h]); })));
      expect(hex(digest)).toBe(hex(expected));
      expect(hex((await nft.image_manifest_hash())[0])).toBe(hex(expected));
      expect(errOf(await nft.set_image_manifest(entries))).toMatch(/set already/);
      expect((await nft.get_image_manifest([], [5n])).map(([id]) => id)).toEqual([1n, 2n, 3n, 4n, 5n]);
    });

    it('mints in batches to the swap account, with the image URL and hash filled in', async () => {
      const r = await nft.icrcX_mint([...cards.keys()].map((n) => mintReq(n)));
      expect(r.every((x) => 'Ok' in x)).toBe(true);
      expect(await nft.icrc7_total_supply()).toBe(BigInt(N));
      expect(await ownerOf(1)).toEqual({ owner: nftId, subaccount: [] });
      expect(await nft.icrc7_balance_of([account(nftId)])).toEqual([BigInt(N)]);
      const m = await metaOf(3);
      expect(m.image).toEqual({ Text: `https://${nftId.toText()}.icp0.io/card/3.jpg` });
      expect(m.image_sha256).toEqual({ Text: hex(sha256(cards.get(3).orig)) });
      expect(m.name).toEqual({ Text: 'Sneed Diamond Club #3' });
      // tokens outside the manifest (for the ICRC-7 tests), straight to alice
      const r2 = await nft.icrcX_mint([101, 102, 103, 104].map((n) => mintReq(n, [account(alice)])));
      expect(r2.every((x) => 'Ok' in x)).toBe(true);
      expect((await metaOf(101)).image).toBeUndefined();
      // refusals
      expect(await nft.icrcX_mint([mintReq(1)])).toEqual([{ Err: { TokenExists: null } }]);
      expect('Err' in (await nft.icrcX_mint([mintReq(0)]))[0]).toBe(true);
      const big = { ...mintReq(200), metadata: { Map: [['blob', { Blob: new Uint8Array(9_000) }]] } };
      expect(js((await nft.icrcX_mint([big]))[0])).toMatch(/larger than 8192/);
      expect(await nft.icrc7_tokens([], [])).toEqual([...[...cards.keys()].map(BigInt), 101n, 102n, 103n, 104n]);
      expect(await nft.icrc7_tokens([10n], [3n])).toEqual([11n, 12n, 101n]);
      // metadata changes before the freeze (override), logged as 7update_token
      const upd = { ...mintReq(101, [account(alice)]), override: true, metadata: { Map: [['name', { Text: 'renamed' }]] } };
      expect('Ok' in (await nft.icrcX_mint([upd]))[0]).toBe(true);
      expect((await metaOf(101)).name).toEqual({ Text: 'renamed' });
    });

    it('stores images in chunks, checks originals against the manifest, refuses a mismatch', async () => {
      // a wrong original: refused, its bytes released (the region tail is reused)
      const before = await nft.status();
      expect(errOf(await upload(nft, card(1), image(4_000)))).toMatch(/SHA-256 mismatch/);
      expect((await nft.status()).region_bytes).toBe(before.region_bytes);
      expect((await nft.get_image_info([card(1)]))[0]).toEqual([]);
      // chunk order and completeness
      const id = ok(await nft.image_upload_begin({ target: card(1), size: 10n, content_type: 'image/jpeg' }));
      expect(errOf(await nft.image_upload_chunk(id, 5n, new Uint8Array(5)))).toMatch(/offset 0/);
      ok(await nft.image_upload_chunk(id, 0n, new Uint8Array(5)));
      expect(errOf(await nft.image_upload_chunk(id, 5n, new Uint8Array(6)))).toMatch(/past the declared size/);
      expect(errOf(await nft.image_upload_finish(id))).toMatch(/Received 5 of 10/);
      ok(await nft.image_upload_abort(id));
      expect(errOf(await nft.image_upload_begin({ target: card(99), size: 10n, content_type: 'image/jpeg' }))).toMatch(/not in the image manifest/);
      expect(errOf(await nft.image_upload_begin({ target: card(1), size: 10n, content_type: 'image/svg+xml' }))).toMatch(/Content type/);
      expect(errOf(await nft.image_upload_begin({ target: card(1, 'thumb'), size: 600_000n, content_type: 'image/jpeg' }))).toMatch(/1 to 500000/);
      // every card's three sizes; web and thumb hashed here as uploaded
      for (const [n, c] of cards) {
        const info = ok(await upload(nft, card(n), c.orig));
        expect(hex(info.sha256)).toBe(hex(sha256(c.orig)));
        ok(await upload(nft, card(n, 'web'), c.web));
        expect(hex(ok(await upload(nft, card(n, 'thumb'), c.thumb)).sha256)).toBe(hex(sha256(c.thumb)));
      }
      ok(await upload(nft, { logo: null }, cards.get(N).thumb));
      const s = await nft.status();
      expect(s.images).toBe(BigInt(3 * N + 1));
      expect(s.uploads_in_progress).toBe(0n);
    });

    it('serves certified images: the original, ?size=web|thumb, the logo, the index and a certified 404', async () => {
      for (const [url, bytes] of [['/card/2.jpg', cards.get(2).orig], ['/card/2.jpg?size=web', cards.get(2).web], ['/card/2.jpg?size=thumb', cards.get(2).thumb], ['/logo.jpg', cards.get(N).thumb]]) {
        const r = await get(nft, url);
        expect(r.status_code, url).toBe(200);
        expect(Buffer.from(r.body).equals(bytes)).toBe(true);
        expect(headerMap(r)['content-type']).toBe('image/jpeg');
        expect(await verifyHttp(r, r.body, nftId, rootKey, url)).toEqual(['http_expr', ...url.split('?')[0].slice(1).split('/'), '<$>']);
      }
      const idx = await get(nft, '/');
      expect(idx.status_code).toBe(200);
      expect(await verifyHttp(idx, idx.body, nftId, rootKey, '/')).toEqual(['http_expr', '', '<$>']);
      for (const url of ['/card/99.jpg', '/card/02.jpg', '/nothing/here', '/card/', '/card/1.png']) {
        const r = await get(nft, url);
        expect(r.status_code).toBe(404);
        expect(await verifyHttp(r, r.body, nftId, rootKey, url)).toEqual(['http_expr', '<*>']);
      }
      // a tampered body does not match the certified response
      const r = await get(nft, '/card/3.jpg');
      const bad = Buffer.from(r.body); bad[10] ^= 1;
      await expect(verifyHttp(r, bad, nftId, rootKey, '/card/3.jpg')).rejects.toThrow(/response leaf/);
    });

    it('streams an original larger than one response, certified over the whole body', async () => {
      const r = await get(nft, `/card/${N}.jpg`);
      expect(r.status_code).toBe(200);
      expect(r.body.length).toBe(1_500_000);
      expect(r.streaming_strategy.length).toBe(1);
      const body = await fullBody(nft, r);
      expect(body.equals(cards.get(N).orig)).toBe(true);
      await verifyHttp(r, body, nftId, rootKey, `/card/${N}.jpg`);
      await expect(nft.http_request_streaming_callback({ key: `card/${N}/orig`, sha256: new Uint8Array(32), index: 1n })).rejects.toThrow(/replaced/);
    });

    it('replaces an image before the freeze (the old response is no longer certified)', async () => {
      const web2 = image(950);
      const old = await get(nft, '/card/4.jpg?size=web');
      ok(await upload(nft, card(4, 'web'), web2));
      const r = await get(nft, '/card/4.jpg?size=web');
      expect(Buffer.from(r.body).equals(web2)).toBe(true);
      await verifyHttp(r, r.body, nftId, rootKey, '/card/4.jpg?size=web');
      await expect(verifyHttp(r, old.body, nftId, rootKey, '/card/4.jpg?size=web')).rejects.toThrow(/response leaf/);
      cards.get(4).web = web2;
      expect((await nft.status()).wasted_bytes).toBeGreaterThan(0n);
    });

    it('refuses the swap before the load is done', async () => {
      expect(errOf(await nftAs(carol).claim_swap(bob))).toMatch(/opens when/);
    });

    it('freezes the metadata (one-way; every manifest card needs its images) and locks minting', async () => {
      // a manifest card missing an image blocks the freeze: none is missing, so try with an open upload
      const id = ok(await nft.image_upload_begin({ target: card(5, 'thumb'), size: 10n, content_type: 'image/jpeg' }));
      expect(errOf(await nft.freeze_metadata())).toMatch(/uploads are still open/);
      ok(await nft.image_upload_abort(id));
      ok(await nft.freeze_metadata());
      expect(errOf(await nft.freeze_metadata())).toMatch(/frozen already/);
      expect(errOf(await nft.set_collection({ name: ['x'], symbol: [], description: [], logo: [], supply_cap: [] }))).toMatch(/frozen/);
      expect(errOf(await nft.image_upload_begin({ target: card(5, 'thumb'), size: 10n, content_type: 'image/jpeg' }))).toMatch(/frozen/);
      const upd = { ...mintReq(102, [account(alice)]), override: true };
      expect(js((await nft.icrcX_mint([upd]))[0])).toMatch(/frozen/);
      // frozen images are served with immutable cache headers, still certified
      const r = await get(nft, '/card/1.jpg');
      expect(headerMap(r)['cache-control']).toMatch(/immutable/);
      await verifyHttp(r, r.body, nftId, rootKey, '/card/1.jpg');
      // minting can still happen until locked; then never
      ok(await nft.lock_minting());
      expect(errOf(await nft.lock_minting())).toMatch(/locked already/);
      expect(js((await nft.icrcX_mint([mintReq(300)]))[0])).toMatch(/Minting is locked/);
      expect(await nft.icrc7_supply_cap()).toEqual([BigInt(N + 4)]);
      const s = await nft.status();
      expect(s.metadata_frozen).toBe(true);
      expect(s.minting_locked).toBe(true);
    });
  });

  describe('ICRC-7 and ICRC-37', () => {
    it('transfers: owner only, not to itself or the collection canister, memo cap, deduplication', async () => {
      expect(await nftAs(bob).icrc7_transfer([{ from_subaccount: [], to: account(bob), token_id: 101n, memo: [], created_at_time: [] }])).toEqual([[{ Err: { Unauthorized: null } }]]);
      expect(await nftAs(alice).icrc7_transfer([{ from_subaccount: [], to: account(alice), token_id: 101n, memo: [], created_at_time: [] }])).toEqual([[{ Err: { InvalidRecipient: null } }]]);
      expect(await nftAs(alice).icrc7_transfer([{ from_subaccount: [], to: account(nftId), token_id: 101n, memo: [], created_at_time: [] }])).toEqual([[{ Err: { InvalidRecipient: null } }]]);
      expect(await nftAs(alice).icrc7_transfer([{ from_subaccount: [], to: account(bob), token_id: 999n, memo: [], created_at_time: [] }])).toEqual([[{ Err: { NonExistingTokenId: null } }]]);
      expect(js(await nftAs(alice).icrc7_transfer([{ from_subaccount: [], to: account(bob), token_id: 101n, memo: [new Uint8Array(33)], created_at_time: [] }]))).toMatch(/memo/);
      const t = await nowNs();
      const arg = { from_subaccount: [], to: account(bob), token_id: 101n, memo: [new Uint8Array([1, 2])], created_at_time: [t] };
      const [[first]] = await nftAs(alice).icrc7_transfer([arg]);
      expect('Ok' in first).toBe(true);
      expect(await ownerOf(101)).toEqual(account(bob));
      expect(await nftAs(alice).icrc7_transfer([arg])).toEqual([[{ Err: { Duplicate: { duplicate_of: first.Ok } } }]]);
      expect(await nftAs(alice).icrc7_transfer([{ ...arg, created_at_time: [t - 25n * 3600n * 1_000_000_000n] }])).toEqual([[{ Err: { TooOld: null } }]]);
      expect(await nft.icrc7_tokens_of(account(alice), [], [])).toEqual([102n, 103n, 104n]);
      expect(await nft.icrc7_balance_of([account(alice), account(bob)])).toEqual([3n, 1n]);
      const tooMany = Array.from({ length: 21 }, () => ({ ...arg, created_at_time: [] }));
      expect(js(await nft.icrc7_transfer(tooMany).catch((e) => String(e)))).toMatch(/GenericBatchError|refused/);
    });

    it('approvals: token and collection, is_approved, transfer_from, revocation, cleared on transfer', async () => {
      const t = await nowNs();
      const info = (spender) => ({ spender: account(spender), from_subaccount: [], expires_at: [], memo: [], created_at_time: t });
      expect(await nftAs(alice).icrc37_approve_tokens([{ token_id: 102n, approval_info: info(alice) }])).toEqual([[{ Err: { InvalidSpender: null } }]]);
      expect(await nftAs(bob).icrc37_approve_tokens([{ token_id: 102n, approval_info: info(carol) }])).toEqual([[{ Err: { Unauthorized: null } }]]);
      expect('Ok' in (await nftAs(alice).icrc37_approve_tokens([{ token_id: 102n, approval_info: info(carol) }]))[0][0]).toBe(true);
      expect(await nft.icrc37_is_approved([{ spender: account(carol), from_subaccount: [], token_id: 102n }, { spender: account(dave), from_subaccount: [], token_id: 102n }])).toEqual([true, false]);
      expect((await nft.icrc37_get_token_approvals([102n], [], [])).map((a) => a.approval_info.spender.owner.toText())).toEqual([carol.toText()]);
      // carol moves 102 to dave (37xfer); the token approval is gone with the transfer
      const [[x]] = await nftAs(carol).icrc37_transfer_from([{ spender_subaccount: [], from: account(alice), to: account(dave), token_id: 102n, memo: [], created_at_time: [] }]);
      expect('Ok' in x).toBe(true);
      expect(await ownerOf(102)).toEqual(account(dave));
      expect(await nft.icrc37_get_token_approvals([102n], [], [])).toEqual([]);
      expect(await nftAs(carol).icrc37_transfer_from([{ spender_subaccount: [], from: account(dave), to: account(carol), token_id: 102n, memo: [], created_at_time: [] }])).toEqual([[{ Err: { Unauthorized: null } }]]);
      // collection approval: only holders; then any of alice's tokens
      expect(js(await nftAs(judy).icrc37_approve_collection([{ approval_info: info(carol) }]))).toMatch(/holds a token/);
      expect('Ok' in (await nftAs(alice).icrc37_approve_collection([{ approval_info: info(carol) }]))[0][0]).toBe(true);
      expect((await nft.icrc37_get_collection_approvals(account(alice), [], [])).length).toBe(1);
      expect(await nft.icrc37_is_approved([{ spender: account(carol), from_subaccount: [], token_id: 103n }])).toEqual([true]);
      // revocations
      expect('Ok' in (await nftAs(alice).icrc37_revoke_collection_approvals([{ spender: [account(carol)], from_subaccount: [], memo: [], created_at_time: [] }]))[0][0]).toBe(true);
      expect(await nftAs(alice).icrc37_revoke_collection_approvals([{ spender: [], from_subaccount: [], memo: [], created_at_time: [] }])).toEqual([[{ Err: { ApprovalDoesNotExist: null } }]]);
      expect(await nft.icrc37_is_approved([{ spender: account(carol), from_subaccount: [], token_id: 103n }])).toEqual([false]);
      expect('Ok' in (await nftAs(alice).icrc37_approve_tokens([{ token_id: 103n, approval_info: info(carol) }]))[0][0]).toBe(true);
      expect('Ok' in (await nftAs(alice).icrc37_revoke_token_approvals([{ spender: [], from_subaccount: [], token_id: 103n, memo: [], created_at_time: [] }]))[0][0]).toBe(true);
      expect(await nft.icrc37_is_approved([{ spender: account(carol), from_subaccount: [], token_id: 103n }])).toEqual([false]);
      // an expired approval does not count
      expect('Ok' in (await nftAs(alice).icrc37_approve_tokens([{ token_id: 104n, approval_info: { ...info(carol), expires_at: [t - 1n] } }]))[0][0]).toBe(true);
      expect(await nft.icrc37_is_approved([{ spender: account(carol), from_subaccount: [], token_id: 104n }])).toEqual([false]);
    });
  });

  describe('the swap by send', () => {
    const addr = (p) => extAccountId(nftId, swapSub(p));

    it('derives swap addresses as documented', async () => {
      expect(await nft.swap_address(bob)).toBe(addr(bob));
      expect(hex(await nft.swap_subaccount(bob))).toBe(hex(swapSub(bob)));
      const pa = await nft.proof_address(bob);
      expect(pa.account.owner).toEqual(nftId);
      expect(hex(pa.account.subaccount[0])).toBe(hex(proofSub(bob)));
      expect(pa.account_id).toBe(extAccountId(nftId, proofSub(bob)));
    });

    it('delivers the cards held by the swap address, once; anyone may call it', async () => {
      // EXT index n holds card n+1: 0..11 for cards 1..12, all held by a whale at first
      await extX.mint_many(extAccountId(judy), N);
      await extX.set_bearer(0, addr(bob));
      await extX.set_bearer(1, addr(bob));
      const r = ok(await nftAs(carol).claim_swap(bob));
      expect(r.delivered.map((d) => [d.ext_index, d.token_id])).toEqual([[0, 1n], [1, 2n]]);
      expect(await ownerOf(1)).toEqual(account(bob));
      expect(await ownerOf(2)).toEqual(account(bob));
      const again = ok(await nftAs(carol).claim_swap(bob));
      expect(again.delivered).toEqual([]);
      expect([...again.already_swapped]).toEqual([0, 1]);
      const s = (await nft.get_swap(0))[0];
      expect(s.recipient).toEqual(bob);
      expect(s.method).toEqual({ send: null });
      expect(s.bearer).toBe(addr(bob));
      expect((await nft.list_retired([], [])).length).toBe(0);
    });

    it("does not deliver someone else's card", async () => {
      // index 2 is at judy's own account, not at anyone's swap address
      expect(ok(await nftAs(carol).claim_swap(judy)).delivered).toEqual([]);
      expect(ok(await nftAs(carol).claim_swap(alice)).delivered).toEqual([]);
      expect(await ownerOf(3)).toEqual({ owner: nftId, subaccount: [] });
      // a card moved to dave's swap address goes to dave, not to whoever claims
      await extX.set_bearer(2, addr(dave));
      expect(ok(await nftAs(carol).claim_swap(carol)).delivered).toEqual([]);
      expect(ok(await nftAs(carol).claim_swap(dave)).delivered.map((d) => d.token_id)).toEqual([3n]);
    });

    it('racing claims deliver each card once', async () => {
      await extX.set_bearer(3, addr(erin));
      await extX.set_bearer(4, addr(erin));
      const m = nftIdl({ IDL })._fields.find(([n]) => n === 'claim_swap')[1];
      const submit = (sender) => pic.submitCall({ canisterId: nftId, method: 'claim_swap', arg: IDL.encode(m.argTypes, [erin]), sender });
      const c1 = await submit(carol);
      const c2 = await submit(dave);
      const r1 = IDL.decode(m.retTypes, await pic.awaitCall(c1))[0];
      const r2 = IDL.decode(m.retTypes, await pic.awaitCall(c2))[0];
      const delivered = [...r1.ok.delivered, ...r2.ok.delivered].map((d) => d.token_id).sort();
      expect(delivered).toEqual([4n, 5n]);
      expect([...r1.ok.already_swapped, ...r2.ok.already_swapped].sort()).toEqual([3, 4]);
      expect(await nft.icrc7_tokens_of(account(erin), [], [])).toEqual([4n, 5n]);
    });

    it('an unreadable registry changes nothing; a card without its token is reported', async () => {
      await extX.set_bearer(5, addr(frank));
      await extX.set_registry_failing(true);
      expect(errOf(await nftAs(carol).claim_swap(frank))).toMatch(/Could not read the EXT registry/);
      await extX.set_registry_failing(false);
      expect(await ownerOf(6)).toEqual({ owner: nftId, subaccount: [] });
      expect(ok(await nftAs(carol).claim_swap(frank)).delivered.map((d) => d.token_id)).toEqual([6n]);
      // an EXT index past the minted cards: reported, nothing moves
      await extX.mint_many(addr(frank), 1); // index 12 -> token 13 does not exist
      const r = ok(await nftAs(carol).claim_swap(frank));
      expect([...r.unavailable]).toEqual([12]);
      expect(r.delivered).toEqual([]);
    });

    it('pause and rate limit', async () => {
      ok(await nft.admin_set_swaps_paused(true));
      expect(errOf(await nftAs(carol).claim_swap(frank))).toMatch(/paused/);
      ok(await nft.admin_set_swaps_paused(false));
      ok(await nft.admin_set_rate_limit('claim', [{ capacity: 2n, per_minute: 1n }]));
      const caller = user('ratelimited');
      ok(await nftAs(caller).claim_swap(frank));
      ok(await nftAs(caller).claim_swap(frank));
      await refusedAtIngress(nftAs(caller).claim_swap(frank)); // inspect peeks at the empty bucket
      ok(await nft.claim_swap(frank)); // admins are not limited
      ok(await nft.admin_set_rate_limit('claim', [{ capacity: 0n, per_minute: 0n }]));
    });
  });

  describe('proof by payment', () => {
    let tokId, tok, tokAs, mockId, mock, icpId, icp, icpAs;
    const proofTo = (p) => account(nftId, proofSub(p));

    beforeAll(async () => {
      if (haveLedger) {
        tokId = await pic.createCanister({ sender: admin, cycles: 100n * T, targetSubnetId: appSubnet, controllers: [admin] });
        await pic.installCode({ sender: admin, canisterId: tokId, wasm: readFileSync(ledgerGz), arg: IDL.encode([LedgerArg], [{ Init: {
          minting_account: account(minter), transfer_fee: 10_000n, decimals: [8], token_symbol: 'SNEED', token_name: 'Sneed', metadata: [],
          initial_balances: [[account(gina), 100n * E8S], [account(gina, new Uint8Array(32).fill(7)), 100n * E8S], [account(hank), 100n * E8S]], feature_flags: [{ icrc2: true }],
          archive_options: { num_blocks_to_archive: 1000n, trigger_threshold: 2000n, controller_id: admin, cycles_for_archive_creation: [0n] },
        } }]) });
        tok = actorAs(pic, icrcIdl, tokId, admin);
        tokAs = (p) => actorAs(pic, icrcIdl, tokId, p);
      }
      mockId = await install(pic, { name: 'MockProofLedger', targetSubnetId: appSubnet });
      mock = actorAs(pic, proofLedgerIdl, mockId, admin);
      icpId = await install(pic, { name: 'MockIcpLedger', targetSubnetId: appSubnet });
      icp = actorAs(pic, icpIdl, icpId, admin);
      icpAs = (p) => actorAs(pic, icpIdl, icpId, p);
      ok(await nft.admin_set_proof_ledger({ ledger: mockId, kind: { icrc3: null } }));
      ok(await nft.admin_set_proof_ledger({ ledger: icpId, kind: { icp: null } }));
      if (haveLedger) ok(await nft.admin_set_proof_ledger({ ledger: tokId, kind: { icrc3: null } }));
      ok(await nft.admin_set_rate_limit('proof', [{ capacity: 0n, per_minute: 0n }]));
      ok(await nft.admin_set_rate_limit('refund', [{ capacity: 0n, per_minute: 0n }]));
      // the cards not used by the swap tests (EXT indexes 6..11) go to an uninvolved holder
      for (let i = 6; i < N; i++) await extX.set_bearer(i, extAccountId(minter));
    });

    it.skipIf(!haveLedger)('on the real ledger: cards of the sender (default account and the paying subaccount) delivered, retired, payment refunded', async () => {
      const sub = new Uint8Array(32).fill(7);
      await extX.set_bearer(6, extAccountId(gina)); // card 7 at gina's default account
      await extX.set_bearer(7, extAccountId(gina, sub)); // card 8 at the subaccount she pays from
      await extX.set_bearer(8, extAccountId(hank)); // card 9: someone else's
      const before = await tok.icrc1_balance_of(account(gina, sub));
      const i = unwrap(await tokAs(gina).icrc1_transfer({ from_subaccount: [sub], to: proofTo(ivy), amount: 50_000n, fee: [], memo: [], created_at_time: [] }));
      const pr = ok(await nftAs(carol).claim_by_proof(ivy, tokId, i));
      expect(pr.delivered.map((d) => d.token_id)).toEqual([7n, 8n]);
      expect(pr.refund).toEqual({ done: { block: expect.any(BigInt) } });
      expect(pr.refund_amount).toBe(40_000n);
      expect(await ownerOf(7)).toEqual(account(ivy));
      expect(await ownerOf(9)).toEqual({ owner: nftId, subaccount: [] });
      expect(await tok.icrc1_balance_of(account(gina, sub))).toBe(before - 20_000n); // two fees
      expect(await tok.icrc1_balance_of(proofTo(ivy))).toBe(0n);
      expect((await nft.list_retired([], [])).map((s) => s.ext_index)).toEqual([6, 7]);
      expect((await nft.get_swap(6))[0].proof).toEqual([`${tokId.toText()}:${i}`]);
      // reused
      expect(errOf(await nftAs(carol).claim_by_proof(ivy, tokId, i))).toMatch(/used already/);
      // a retired card sent to a swap address later is not swapped again
      await extX.set_bearer(6, addr(judy));
      expect([...ok(await nftAs(carol).claim_swap(judy)).already_swapped]).toEqual([6]);
      // a transfer made with an approval proves nothing about the holder's key
      unwrap(await tokAs(hank).icrc2_approve({ from_subaccount: [], spender: account(carol), amount: E8S, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
      const j = unwrap(await tokAs(carol).icrc2_transfer_from({ spender_subaccount: [], from: account(hank), to: proofTo(carol), amount: 50_000n, fee: [], memo: [], created_at_time: [] }));
      expect(errOf(await nftAs(carol).claim_by_proof(carol, tokId, j))).toMatch(/approval/);
      expect(await ownerOf(9)).toEqual({ owner: nftId, subaccount: [] });
      // a payment to someone else's proof address does not prove anything for ivy
      const k = unwrap(await tokAs(hank).icrc1_transfer({ from_subaccount: [], to: proofTo(judy), amount: 50_000n, fee: [], memo: [], created_at_time: [] }));
      expect(errOf(await nftAs(carol).claim_by_proof(ivy, tokId, k))).toMatch(/not sent to this recipient's proof address/);
      expect(errOf(await nftAs(carol).claim_by_proof(ivy, tokId, 999_999n))).toMatch(/no block/);
    });
    const addr = (p) => extAccountId(nftId, swapSub(p));

    it('ledgers off the list, approvals and non-transfers are refused', async () => {
      const other = await install(pic, { name: 'MockProofLedger', targetSubnetId: appSubnet });
      const i = await actorAs(pic, proofLedgerIdl, other, admin).test_transfer(account(hank), proofTo(ivy), 50_000n);
      expect(errOf(await nftAs(carol).claim_by_proof(ivy, other, i))).toMatch(/not accepted/);
      const a = await mock.test_approve(account(hank), account(carol));
      expect(errOf(await nftAs(carol).claim_by_proof(ivy, mockId, a))).toMatch(/not a transfer/);
      const f = await mock.test_transfer_from(account(hank), proofTo(ivy), account(carol), 50_000n);
      expect(errOf(await nftAs(carol).claim_by_proof(ivy, mockId, f))).toMatch(/approval/);
      expect(errOf(await nftAs(carol).claim_by_proof(ivy, mockId, 4242n))).toMatch(/no block/);
      // a payment from this canister itself
      const s = await mock.test_transfer(account(nftId, swapSub(ivy)), proofTo(ivy), 50_000n);
      expect(errOf(await nftAs(carol).claim_by_proof(ivy, mockId, s))).toMatch(/proves nothing/);
      // a payment a canister made (an exchange, a marketplace, an escrow paying for its users)
      // proves nothing about the cards that canister holds
      await extX.set_bearer(8, extAccountId(extId)); // card 9 held by a canister
      const k = await mock.test_transfer(account(extId), proofTo(ivy), 50_000n);
      expect(errOf(await nftAs(carol).claim_by_proof(ivy, mockId, k))).toMatch(/wallet's own key/);
      expect(await ownerOf(9)).toEqual({ owner: nftId, subaccount: [] });
      await extX.set_bearer(8, extAccountId(minter));
    });

    it('legacy and archived blocks are read; a payment below the fee is not refunded', async () => {
      await extX.set_bearer(9, extAccountId(judy, new Uint8Array(32).fill(3)));
      const i = await mock.test_transfer_legacy(account(judy, new Uint8Array(32).fill(3)), proofTo(judy), 5_000n);
      await mock.set_archived_upto(i + 1n);
      const pr = ok(await nftAs(carol).claim_by_proof(judy, mockId, i));
      expect(pr.delivered.map((d) => d.token_id)).toEqual([10n]);
      expect(pr.refund).toEqual({ none: null });
      await mock.set_archived_upto(0n);
    });

    it('a refund that fails is retried with the same transfer; an unknown outcome is never paid twice', async () => {
      // the ledger answers an error: nothing paid, retryable
      await mock.set_mode({ error: null });
      const i = await mock.test_transfer(account(erin), proofTo(erin), 1_000_000n);
      const pr = ok(await nftAs(carol).claim_by_proof(erin, mockId, i));
      expect(Object.keys(pr.refund)).toEqual(['failed']);
      expect((await nft.pending_refunds()).map((p) => p.key)).toContain(`${mockId.toText()}:${i}`);
      expect((await nft.status()).pending_refunds).toBeGreaterThan(0n);
      await mock.set_mode({ ok: null });
      const done = ok(await nftAs(dave).retry_refund(mockId, i));
      expect(Object.keys(done.refund)).toEqual(['done']);
      expect(errOf(await nftAs(dave).retry_refund(mockId, i))).toMatch(/Nothing to retry/);
      expect(await mock.balance_of(account(erin))).toBe(990_000n);
      // the ledger records the refund but the reply is lost: the retry is deduplicated
      await mock.set_mode({ trap_after: null });
      const j = await mock.test_transfer(account(frank), proofTo(frank), 1_000_000n);
      const pr2 = ok(await nftAs(carol).claim_by_proof(frank, mockId, j));
      expect(pr2.refund.failed).toMatch(/Outcome unknown/);
      await mock.set_mode({ ok: null });
      const done2 = ok(await nftAs(carol).retry_refund(mockId, j));
      const refunds = (await mock.get_refunds()).filter(([, a]) => a.to.owner.toText() === frank.toText());
      expect(refunds.length).toBe(1);
      expect(done2.refund).toEqual({ done: { block: refunds[0][2] } });
      expect(await mock.balance_of(account(frank))).toBe(990_000n);
      // the ledger traps before recording anything: retry pays once
      await mock.set_mode({ trap: null });
      const k = await mock.test_transfer(account(gina), proofTo(gina), 1_000_000n);
      expect(Object.keys(ok(await nftAs(carol).claim_by_proof(gina, mockId, k)).refund)).toEqual(['failed']);
      await mock.set_mode({ ok: null });
      expect(Object.keys(ok(await nftAs(carol).retry_refund(mockId, k)).refund)).toEqual(['done']);
      expect(await mock.balance_of(account(gina))).toBe(990_000n);
    });

    it('a changed ledger fee needs an admin, who resets the refund after checking the ledger', async () => {
      await mock.set_mode({ error: null });
      const i = await mock.test_transfer(account(hank), proofTo(hank), 1_000_000n);
      expect(Object.keys(ok(await nftAs(carol).claim_by_proof(hank, mockId, i)).refund)).toEqual(['failed']);
      await mock.set_mode({ ok: null });
      await mock.set_fee(20_000n);
      expect(ok(await nftAs(carol).retry_refund(mockId, i)).refund.needs_admin).toMatch(/fee changed/);
      expect(errOf(await nftAs(carol).retry_refund(mockId, i))).toMatch(/Nothing to retry/);
      expect(errOf(await nft.admin_reset_refund(mockId, i, false))).toMatch(/Check the ledger/);
      const pr = ok(await nft.admin_reset_refund(mockId, i, true));
      expect(pr.refund_amount).toBe(980_000n);
      expect(Object.keys(pr.refund)).toEqual(['done']);
      expect(await mock.balance_of(account(hank))).toBe(980_000n);
      expect(await mock.balance_of(proofTo(hank))).toBe(0n);
      await mock.set_fee(10_000n);
    });

    it('ICP: the sender is an account identifier; its cards are delivered and the refund goes back to it', async () => {
      const sub = new Uint8Array(32).fill(9);
      await extX.set_bearer(10, extAccountId(hank, sub)); // card 11
      const i = unwrap(await icpAs(hank).icrc1_transfer({ from_subaccount: [sub], to: proofTo(judy), amount: 100_000n, fee: [], memo: [], created_at_time: [] }));
      const pr = ok(await nftAs(carol).claim_by_proof(judy, icpId, i));
      expect(pr.sender).toEqual({ account_id: expect.any(Uint8Array) });
      expect(hex(pr.sender.account_id)).toBe(extAccountId(hank, sub));
      expect(pr.delivered.map((d) => d.token_id)).toEqual([11n]);
      expect(Object.keys(pr.refund)).toEqual(['done']);
      const [[caller, args]] = await icp.get_legacy_transfers();
      expect(caller).toEqual(nftId);
      expect(hex(args.to)).toBe(extAccountId(hank, sub));
      expect(args.amount.e8s).toBe(90_000n);
      expect(hex(args.from_subaccount[0])).toBe(hex(proofSub(judy)));
      // a transfer made by an approved spender is refused
      const j = await icp.test_transfer_from(account(hank), proofTo(judy), account(carol), 100_000n);
      expect(errOf(await nftAs(carol).claim_by_proof(judy, icpId, j))).toMatch(/approval/);
    });

    it('racing proofs with the same payment deliver and refund once', async () => {
      await extX.set_bearer(11, extAccountId(dave)); // card 12
      const i = await mock.test_transfer(account(dave), proofTo(dave), 1_000_000n);
      const m = nftIdl({ IDL })._fields.find(([n]) => n === 'claim_by_proof')[1];
      const submit = (sender) => pic.submitCall({ canisterId: nftId, method: 'claim_by_proof', arg: IDL.encode(m.argTypes, [dave, mockId, i]), sender });
      const c1 = await submit(carol);
      const c2 = await submit(erin);
      const rs = [IDL.decode(m.retTypes, await pic.awaitCall(c1))[0], IDL.decode(m.retTypes, await pic.awaitCall(c2))[0]];
      expect(rs.filter((r) => 'ok' in r).length).toBe(1);
      expect(rs.find((r) => 'err' in r).err).toMatch(/used already/);
      expect(await ownerOf(12)).toEqual(account(dave));
      expect((await mock.get_refunds()).filter(([, a]) => a.to.owner.toText() === dave.toText()).length).toBe(1);
    });
  });

  describe('log, upgrade, ingress guard, cost', () => {
    const makeArchive = (id) => actorAs(pic, archiveIdl, id, admin);

    it('logs every mint, transfer, approval, swap, refund and change in a verified ICRC-3 chain', async () => {
      const { blocks } = await verifyLog(nft, nftId, rootKey, makeArchive);
      const types = blocks.map(btype);
      for (const t of ['7mint', '7xfer', '7update_token', '37approve', '37approve_coll', '37revoke', '37revoke_coll', '37xfer', 'dcswap', 'dcrefund', 'sneednft_image', 'sneednft_config']) expect(types).toContain(t);
      expect(types.filter((t) => t === '7mint').length).toBe(N + 4);
      const swap = blocks.find((b) => btype(b) === 'dcswap' && txField(b, 'method').Text === 'proof');
      expect(txField(swap, 'ledger')).toBeTruthy();
      const mint = blocks.find((b) => btype(b) === '7mint');
      expect(txField(mint, 'meta').Map[0][0]).toBe('icrc7:token_metadata');
    });

    it('keeps everything over an upgrade (keep), still certified', async () => {
      const before = await nft.status();
      const owners = await nft.icrc7_owner_of([1n, 2n, 7n, 101n]);
      await pic.upgradeCanister({ sender: admin, canisterId: nftId, wasm: wasm('sneed_nft'), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
      expect(await nft.status()).toEqual(before);
      expect(await nft.icrc7_owner_of([1n, 2n, 7n, 101n])).toEqual(owners);
      for (const url of ['/card/5.jpg', '/card/5.jpg?size=thumb', '/missing']) {
        const r = await get(nft, url);
        await verifyHttp(r, await fullBody(nft, r), nftId, rootKey, url);
      }
      const r = await get(nft, '/card/6.jpg?size=web');
      expect(Buffer.from(r.body).equals(cards.get(6).web)).toBe(true);
      await verifyLog(nft, nftId, rootKey, makeArchive);
      expect(errOf(await nft.set_image_manifest([[1n, new Uint8Array(32)]]))).toMatch(/set already/);
      expect([...ok(await nftAs(carol).claim_swap(bob)).already_swapped]).toEqual([0, 1]);
    });

    it('guards ingress: queries as updates, admin methods, anonymous callers, oversized arguments', async () => {
      const upd = actorAs(pic, asUpdates(nftIdl), nftId, alice);
      await refusedAtIngress(upd.http_request({ method: 'GET', url: '/', headers: [], body: new Uint8Array(0), certificate_version: [] }));
      await refusedAtIngress(upd.icrc7_tokens([], []));
      await refusedAtIngress(upd.status());
      await refusedAtIngress(upd.icrc3_get_tip_certificate());
      await refusedAtIngress(upd.validate_dao_admin({ set_swaps_paused: true }));
      await refusedAtIngress(nftAs(alice).set_collection({ name: ['x'], symbol: [], description: [], logo: [], supply_cap: [] }));
      await refusedAtIngress(nftAs(alice).image_upload_chunk(1n, 0n, new Uint8Array(10)));
      await refusedAtIngress(nftAs(alice).admin_set_proof_ledger({ ledger: alice, kind: { icrc3: null } }));
      await refusedAtIngress(nftAs(alice).dao_admin({ set_swaps_paused: true }));
      await refusedAtIngress(nftAs(alice).admin_set_governance(alice));
      await refusedAtIngress(nftAs(Principal.anonymous()).claim_swap(bob));
      await refusedAtIngress(nftAs(alice).icrc7_transfer([{ from_subaccount: [], to: account(bob), token_id: 103n, memo: [new Uint8Array(20_000)], created_at_time: [] }]));
      await refusedAtIngress(nft.image_upload_chunk(1n, 0n, new Uint8Array(1_950_000)));
    });

    it('DAO admin: the validator renders, only governance may call', async () => {
      expect(await nft.validate_dao_admin({ set_swaps_paused: true })).toEqual({ Ok: 'Pause the swap' });
      expect(await nft.validate_dao_admin({ remove_proof_ledger: alice })).toEqual({ Err: `${alice.toText()} is not on the list` });
      expect((await nft.get_governance()).toText()).toBe('fi3zi-fyaaa-aaaaq-aachq-cai');
    });

    it('idle: burns only its storage (no heartbeat, no recurring timer)', async () => {
      await pic.tick(3);
      const st = await pic.canisterStatus({ canisterId: nftId, sender: admin });
      const storage = BigInt(st.idleCyclesBurnedPerDay) / 24n; // memory and stable memory, per hour
      const b0 = BigInt(await pic.getCyclesBalance(nftId));
      for (let i = 0; i < 60; i++) { await pic.advanceTime(60_000); await pic.tick(1); }
      const burn = b0 - BigInt(await pic.getCyclesBalance(nftId));
      console.log(`sneed_nft idle: ${(Number(burn) / 1e6).toFixed(2)} M cycles an hour; storage of ${(Number(st.memorySize) / 1e6).toFixed(1)} MB costs ${(Number(storage) / 1e6).toFixed(2)} M an hour`);
      expect(burn).toBeLessThan(storage + 5_000_000n); // storage only: no heartbeat, no timer (a timer firing alone costs millions)
    });
  });

});

// PocketIC's HTTP gateway runs the same response verification as the gateways of icp0.io (a
// response that fails it is a 503 "backend_response_verification"; the raw domain skips it). Its
// own instance: a live instance's clock follows the wall clock, the tests above move it ahead.
describe('sneed_nft through the HTTP gateway (verified as on icp0.io)', () => {
  let pic3, id, port, avatarsId;
  const small = image(5_000), web = image(1_200), big = image(2_600_000);
  const fetchVia = (host, path) => new Promise((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers: { host } }, (r) => {
      const parts = []; r.on('data', (d) => parts.push(d)); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(parts) }));
    });
    req.on('error', rej); req.end();
  });
  beforeAll(async () => {
    let sub;
    ({ pic: pic3, appSubnet: sub } = await createPic());
    id = await install(pic3, { name: 'sneed_nft', targetSubnetId: sub, cycles: 50n * T });
    // a canister that answers HTTP without certification: the control
    avatarsId = await install(pic3, { name: 'sneed_avatars', targetSubnetId: sub, cycles: 20n * T });
    const a = actorAs(pic3, nftIdl, id, admin);
    ok(await a.set_image_manifest([[1n, sha256(small)], [2n, sha256(big)]]));
    ok(await upload(a, card(1), small));
    ok(await upload(a, card(1, 'web'), web));
    ok(await upload(a, card(2), big));
    port = await pic3.makeLive();
  }, 180_000);
  afterAll(async () => { await pic3?.stopLive().catch(() => {}); await pic3?.tearDown(); });

  it('serves verified images (also streamed), the index and a 404; refuses an uncertified canister', async () => {
    const host = `${id.toText()}.localhost:${port}`;
    const r1 = await fetchVia(host, '/card/1.jpg');
    expect(r1.status, r1.body.toString().slice(0, 300)).toBe(200);
    expect(r1.body.equals(small)).toBe(true);
    expect(r1.headers['content-type']).toBe('image/jpeg');
    const r2 = await fetchVia(host, '/card/1.jpg?size=web');
    expect(r2.status).toBe(200);
    expect(r2.body.equals(web)).toBe(true);
    const r3 = await fetchVia(host, '/card/2.jpg');
    expect(r3.status, r3.body.toString().slice(0, 300)).toBe(200);
    expect(r3.body.equals(big)).toBe(true);
    for (const p of ['/card/77.jpg', '/card/', '/a/b/c']) {
      const r = await fetchVia(host, p);
      expect(r.status, `${p}: ${r.body.toString().slice(0, 300)}`).toBe(404);
    }
    expect((await fetchVia(host, '/')).status).toBe(200);
    // the control: an uncertified response fails verification on the normal domain only
    const bad = await fetchVia(`${avatarsId.toText()}.localhost:${port}`, '/nothing');
    expect(bad.status).toBe(503);
    expect(bad.body.toString()).toMatch(/backend_response_verification/);
    expect((await fetchVia(`${avatarsId.toText()}.raw.localhost:${port}`, '/nothing')).status).toBe(404);
  });
});

// The certified tree and the HTTP helpers in the Motoko interpreter (motoko/nft_cert.test.mo).
// MERKLE_UPSTREAM=1 runs them against ic-certification 1.1.0's MerkleTree.mo as published (from
// the mops cache), without the revealMinKey fix: it fails ("prefix keys: reveal [\"a\"]").
describe('sneed_nft: certification units', () => {
  it('MerkleTree witnesses reconstruct the root; HttpCert paths, base64, CBOR', () => {
    const DFX_VERSION = process.env.DFX_VERSION || '0.28.0';
    const root = resolve(BUILD, '..', '..', '..');
    const cache = execFileSync('dfx', [`+${DFX_VERSION}`, 'cache', 'show'], { encoding: 'utf8' }).trim();
    const packages = execFileSync('mops', ['sources'], { cwd: root, encoding: 'utf8' }).trim().split(/\s+/);
    let file = resolve(root, 'test/canisters/motoko/nft_cert.test.mo');
    if (process.env.MERKLE_UPSTREAM) {
      const dir = mkdtempSync(join(tmpdir(), 'nft-cert-'));
      for (const d of ['src/sneed_nft/cert', 'src/icrc3', 'test/canisters/motoko']) mkdirSync(join(dir, d), { recursive: true });
      const up = readFileSync(join(homedir(), '.cache/mops/packages/ic-certification@1.1.0/src/MerkleTree.mo'), 'utf8');
      writeFileSync(join(dir, 'src/sneed_nft/cert/MerkleTree.mo'), up.replaceAll('"mo:base@0/', '"mo:base/').replaceAll('"mo:sha2@0/', '"mo:sha2/'));
      for (const f of ['src/sneed_nft/cert/Dyadic.mo', 'src/sneed_nft/HttpCert.mo', 'src/sneed_nft/Types.mo', 'src/icrc3/Hash.mo', 'src/icrc3/Types.mo', 'test/canisters/motoko/nft_cert.test.mo']) copyFileSync(join(root, f), join(dir, f));
      file = join(dir, 'test/canisters/motoko/nft_cert.test.mo');
    }
    let out;
    try {
      out = execFileSync(resolve(cache, 'moc'), ['-r', ...packages, file], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } finally {
      if (process.env.MERKLE_UPSTREAM) rmSync(resolve(file, '..', '..', '..', '..'), { recursive: true, force: true });
    }
    expect(out).toContain('nft_cert.test.mo: all passed');
  }, 120_000);
});

describe('sneed_nft: a full 1,000-card collection', () => {
  let pic2, id, a, x;
  beforeAll(async () => {
    let sub;
    ({ pic: pic2, appSubnet: sub } = await createPic());
    const extId2 = await install(pic2, { name: 'MockExt', targetSubnetId: sub });
    id = await install(pic2, { name: 'sneed_nft', targetSubnetId: sub, cycles: 50n * T });
    a = actorAs(pic2, nftIdl, id, admin);
    x = actorAs(pic2, extMore, extId2, admin);
    ok(await a.admin_set_ext_canister(extId2));
  }, 180_000);
  afterAll(async () => { await pic2?.tearDown(); });

  it('mints 1,000 cards in batches of 100 and delivers 476 of them in one claim', async () => {
    ok(await a.set_collection({ name: ['Sneed Diamond Club'], symbol: ['SDC'], description: [], logo: [], supply_cap: [[1000n]] }));
    ok(await a.set_image_manifest(Array.from({ length: 1000 }, (_, i) => [BigInt(i + 1), sha256(Buffer.from(String(i + 1)))])));
    for (let b = 0; b < 10; b++) {
      const r = await a.icrcX_mint(Array.from({ length: 100 }, (_, i) => mintReq(b * 100 + i + 1)));
      expect(r.every((v) => 'Ok' in v)).toBe(true);
    }
    expect(await a.icrc7_total_supply()).toBe(1000n);
    expect(js((await a.icrcX_mint([mintReq(1001)]))[0])).toMatch(/supply cap/);
    // 3,000 images (tiny ones: the certified tree has one leaf per image, whatever its size)
    for (let n = 1; n <= 1000; n++) {
      ok(await a.image_upload(card(n), 'image/jpeg', Buffer.from(String(n))));
      ok(await a.image_upload(card(n, 'web'), 'image/jpeg', image(64)));
      ok(await a.image_upload(card(n, 'thumb'), 'image/jpeg', image(32)));
    }
    const M = (c) => `${(Number(c) / 1e9).toFixed(2)} B cycles`;
    const cost = async (f) => { const b = BigInt(await pic2.getCyclesBalance(id)); await f(); return b - BigInt(await pic2.getCyclesBalance(id)); };
    const freeze = await cost(async () => ok(await a.freeze_metadata()));
    const upgrade = await cost(() => pic2.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm('sneed_nft'), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } }));
    let instructions = 0n;
    const rebuild = await cost(async () => { instructions = ok(await a.admin_rebuild_certification()).instructions; });
    console.log(`with 3,000 images: freeze_metadata ${M(freeze)}, upgrade ${M(upgrade)} (the tree is kept), a full rebuild of the certified tree ${M(rebuild)} (${(Number(instructions) / 1e9).toFixed(2)} B instructions)`);
    expect(freeze).toBeLessThan(1_000_000_000n);
    expect(upgrade).toBeLessThan(rebuild); // an upgrade does not rebuild the tree
    expect(instructions).toBeLessThan(20_000_000_000n); // half the update limit (40 B)
    for (const url of ['/card/1000.jpg', '/card/500.jpg?size=thumb', '/card/1001.jpg']) {
      const r = await a.http_request({ method: 'GET', url, headers: [], body: new Uint8Array(0), certificate_version: [2] });
      expect(r.status_code).toBe(url.includes('1001') ? 404 : 200);
    }
    expect(Buffer.from((await a.http_request({ method: 'GET', url: '/card/1000.jpg', headers: [], body: new Uint8Array(0), certificate_version: [2] })).body).toString()).toBe('1000');
    ok(await a.lock_minting());
    const whale = user('whale');
    const whaleAddr = extAccountId(id, swapSub(whale));
    await x.mint_many(whaleAddr, 476);
    await x.mint_many(extAccountId(alice), 524);
    const r = ok(await a.claim_swap(whale));
    expect(r.delivered.length).toBe(476);
    expect(await a.icrc7_balance_of([account(whale), account(id)])).toEqual([476n, 524n]);
    expect((await a.icrc7_tokens_of(account(whale), [470n], [10n]))).toEqual([471n, 472n, 473n, 474n, 475n, 476n]);
    expect(ok(await a.claim_swap(whale)).already_swapped.length).toBe(476);
  });
});
