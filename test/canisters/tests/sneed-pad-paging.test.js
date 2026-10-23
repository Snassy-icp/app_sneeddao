// sneed_pad paging and rate limits (spec/paging_audit.md S13): every launch carries its logo (up to
// 200 KB) and allocation list, so list_launch_summaries pages launches without them (newest first,
// all or one creator's through a creator index), get_launch_logo returns a logo by id, the old
// list_launches / get_launches_by_creator stop at about 1.5 MB, and create_token, create_index and the
// quotes are rate limited per caller (admin-settable). An upgrade from what staging runs keeps every
// launch and builds the creator index.
//
// PAD_WASM=sneed_pad_prepaging runs it against the code before the fix (staging's module).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  createPic, install, actorAs, account, admin, alice, bob, carol, user, ICP_LEDGER_ID, SNEED_GOVERNANCE, SNEED_SNS_ROOT, T, unwrap, errOf, BUILD, wasm,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit, snsWasmIdl, premiumIdl, sneedAppIdl } from '../lib/idl.js';
import { idlFactory as padIdl } from '../build/sneed_pad.did.js';

const WASM = process.env.PAD_WASM || 'sneed_pad';
const ICP_FEE = 10_000n;
const ledgerGz = resolve(BUILD, 'ledger.wasm.gz');
const indexGz = resolve(BUILD, 'index.wasm.gz');
const haveWasms = existsSync(ledgerGz) && existsSync(indexGz);
const sha256 = (bytes) => Uint8Array.from(createHash('sha256').update(bytes).digest());
const hex = (b) => Buffer.from(b).toString('hex');
const logo = (n, c = 'A') => `data:image/png;base64,${c.repeat(n)}`;
const config = (over = {}) => ({
  name: 'Paged Token', symbol: 'PGT', decimals: 8, transfer_fee: 10_000n, logo: [logo(1000)],
  allocations: [{ account: account(alice), amount: 1_000_000_000_000n }, { account: account(bob), amount: 500_000_000_000n }],
  minting: { nobody: null }, fee_collector: [], control: { keep: null }, with_index: false,
  ...over,
});
const refused = async (promise) => {
  try { return errOf(await promise); } catch (e) { if (/canister_inspect_message .*refused/.test(String(e?.message || e))) return 'refused at ingress'; throw e; }
};

let pic, icpId, padId, icp, pad, as;

async function setup(name) {
  ({ pic } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  const cmcId = await install(pic, { name: 'MockCmc' });
  const snsWasmId = await install(pic, { name: 'MockSnsWasm' });
  const govId = await install(pic, { name: 'MockSnsGovernance', targetCanisterId: SNEED_GOVERNANCE });
  const premiumId = await install(pic, { name: 'MockPremium' });
  const sneedAppId = await install(pic, { name: 'MockSneedApp' });
  padId = await install(pic, { name, cycles: 400n * T });
  icp = actorAs(pic, ledgerIdl, icpId, admin);
  pad = actorAs(pic, padIdl, padId, admin);
  as = (p) => actorAs(pic, padIdl, padId, p);
  const snsWasm = actorAs(pic, snsWasmIdl, snsWasmId, admin);
  const ledgerBytes = readFileSync(ledgerGz); const indexBytes = readFileSync(indexGz);
  await snsWasm.set_wasm(sha256(ledgerBytes), Uint8Array.from(ledgerBytes));
  await snsWasm.set_wasm(sha256(indexBytes), Uint8Array.from(indexBytes));
  await snsWasm.set_latest([['Ledger', hex(sha256(ledgerBytes))], ['Ledger Index', hex(sha256(indexBytes))]]);
  unwrap(await pad.admin_set_canisters({ icp_ledger: [icpId], cmc: [cmcId], sns_wasm: [snsWasmId], governance: [govId], root: [SNEED_SNS_ROOT], blackhole: [carol], sneed_premium: [[premiumId]], sneedapp: [[sneedAppId]] }));
  await actorAs(pic, sneedAppIdl, sneedAppId, admin).set_authorized([padId]);
  unwrap(await pad.refresh_wasms());
  for (const p of [alice, bob]) await icp.mint(account(p), 1000n * 100_000_000n);
}
async function launch(p, over = {}) {
  const q = unwrap(await as(p).get_quote(config(over)));
  unwrap(await actorAs(pic, ledgerIdl, icpId, p).icrc2_approve({ from_subaccount: [], spender: account(padId), amount: q.total_e8s + ICP_FEE, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
  return unwrap(await as(p).create_token(config(over)));
}

describe.skipIf(!haveWasms)(`sneed_pad paging and rate limits (${WASM})`, () => {
  const made = [];
  beforeAll(async () => {
    await setup(WASM);
    // 8 launches with big logos (195 KB): together over 1.5 MB
    for (let i = 0; i < 8; i++) made.push(await launch(i < 5 ? alice : bob, { symbol: `PG${i}`, logo: [logo(195_000, String.fromCharCode(65 + i))] }));
  }, 600_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('pages launches newest first without logos or allocation lists; the logo comes by id', async () => {
    const p1 = await pad.list_launch_summaries({ creator: [], before: [], limit: 3n });
    expect(p1.total).toBe(8n);
    expect(p1.items.map((l) => l.id)).toEqual([made[7].id, made[6].id, made[5].id]);
    const s = p1.items[0];
    expect(s.symbol).toBe('PG7');
    expect(s.logo_bytes).toBe(BigInt(logo(195_000).length));
    expect(s.allocations).toBe(2n);
    expect(s.allocated).toBe(1_500_000_000_000n);
    expect(s.ledger).toEqual(made[7].ledger);
    expect('logo' in s).toBe(false);
    expect(p1.next).toEqual([made[5].id]);
    const p2 = await pad.list_launch_summaries({ creator: [], before: p1.next, limit: 1000n });
    expect(p2.items.map((l) => l.id)).toEqual(made.slice(0, 5).map((l) => l.id).reverse());
    expect(p2.next).toEqual([]);
    // the default page and the cap
    expect((await pad.list_launch_summaries({ creator: [], before: [], limit: 0n })).items.length).toBe(8);
    // one creator's, through the index
    const mine = await pad.list_launch_summaries({ creator: [alice], before: [], limit: 2n });
    expect(mine.total).toBe(5n);
    expect(mine.items.map((l) => l.id)).toEqual([made[4].id, made[3].id]);
    expect((await pad.list_launch_summaries({ creator: [bob], before: [], limit: 50n })).items.map((l) => l.id)).toEqual([made[7].id, made[6].id, made[5].id]);
    expect((await pad.list_launch_summaries({ creator: [carol], before: [], limit: 50n })).items).toEqual([]);
    // the logo, on its own
    expect(await pad.get_launch_logo(made[2].id)).toEqual([logo(195_000, 'C')]);
    expect(await pad.get_launch_logo(999n)).toEqual([]);
  });

  it('stops the old whole-launch lists at about 1.5 MB', async () => {
    const all = await pad.list_launches(0n, 200n);
    expect(all.total).toBe(8n);
    expect(all.launches.length).toBe(7); // 8 × 197 KB would be 1.58 MB
    expect(all.launches[0].id).toBe(made[0].id);
    const rest = await pad.list_launches(BigInt(all.launches.length), 200n);
    expect(rest.launches.map((l) => l.id)).toEqual([made[7].id]);
    const alices = await pad.get_launches_by_creator(alice);
    expect(alices.map((l) => l.id)).toEqual(made.slice(0, 5).map((l) => l.id)); // under the budget: all, oldest first
  });

  it('rate-limits a spammer, not a normal user', async () => {
    const rules = Object.fromEntries(await pad.get_rate_limits());
    expect(rules.create_token).toEqual({ capacity: 10n, per_minute: 5n });
    expect(Object.keys(rules).sort()).toEqual(['create_index', 'create_token', 'get_index_quote', 'get_quote']);
    const spammer = user('pad-spammer');
    // free attempts (no allowance) cost the pad a CMC and a ledger call each
    for (let i = 0; i < 10; i++) expect(errOf(await as(spammer).create_token(config()))).toMatch(/approve/);
    expect(await refused(as(spammer).create_token(config()))).toMatch(/Rate limited|refused at ingress/);
    // somebody else is not affected
    expect(errOf(await as(user('pad-normal')).create_token(config()))).toMatch(/approve/);
    unwrap(await as(user('pad-normal')).get_quote(config()));
    // a minute later the spammer may try again
    await pic.advanceTime(60_000); await pic.tick(1);
    expect(errOf(await as(spammer).create_token(config()))).toMatch(/approve/);
    // admins set the rules
    expect(errOf(await as(spammer).admin_set_rate_limit('get_quote', [{ capacity: 1000n, per_minute: 1000n }]))).toMatch(/admin/);
    expect(errOf(await pad.admin_set_rate_limit('nope', []))).toMatch(/Unknown action/);
    unwrap(await pad.admin_set_rate_limit('get_quote', [{ capacity: 1n, per_minute: 1n }]));
    const q = user('pad-quoter');
    unwrap(await as(q).get_quote(config()));
    expect(await refused(as(q).get_quote(config()))).toMatch(/Rate limited|refused at ingress/);
    unwrap(await pad.get_quote(config())); // admins are not limited
    unwrap(await pad.admin_set_rate_limit('get_quote', []));
    expect(Object.fromEntries(await pad.get_rate_limits()).get_quote).toEqual({ capacity: 120n, per_minute: 60n });
  });
});

describe.skipIf(!haveWasms)(`sneed_pad: upgrade from what staging runs (sneed_pad_prepaging) to ${WASM}`, () => {
  beforeAll(async () => { await setup('sneed_pad_prepaging'); }, 300_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('keeps every launch and indexes the existing ones by creator', async () => {
    const a = await launch(alice, { symbol: 'OLDA', logo: [logo(5000, 'Q')] });
    const b = await launch(bob, { symbol: 'OLDB' });
    const a2 = await launch(alice, { symbol: 'OLDC' });
    const before = await pad.list_launches(0n, 10n);

    await pic.upgradeCanister({ sender: admin, canisterId: padId, wasm: wasm(WASM) });

    const after = await pad.list_launches(0n, 10n);
    expect(after.total).toBe(3n);
    expect(after.launches.map((l) => l.id)).toEqual(before.launches.map((l) => l.id));
    expect((await pad.list_launch_summaries({ creator: [alice], before: [], limit: 10n })).items.map((l) => l.symbol)).toEqual(['OLDC', 'OLDA']);
    expect((await pad.list_launch_summaries({ creator: [bob], before: [], limit: 10n })).items.map((l) => l.id)).toEqual([b.id]);
    expect(await pad.get_launch_logo(a.id)).toEqual([logo(5000, 'Q')]);
    // new launches join the index
    const c = await launch(bob, { symbol: 'NEWB' });
    expect((await pad.list_launch_summaries({ creator: [bob], before: [], limit: 10n })).items.map((l) => l.id)).toEqual([c.id, b.id]);
    expect((await pad.list_launch_summaries({ creator: [], before: [], limit: 2n })).items.map((l) => l.id)).toEqual([c.id, a2.id]);
  });
});
