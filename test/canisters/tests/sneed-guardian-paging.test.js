// sneed_guardian anti-spam and paging (spec/paging_audit.md S12): staging an op is free, so an
// install's upgrade argument is capped (256 KiB), one principal may have only so many open ops,
// stage_op / register / refund_op are rate limited per caller (admin-settable), list_ops and
// list_ops_for are capped (in count and in argument bytes), and list_op_summaries pages ops with
// install arguments as size + SHA-256 only. An upgrade from what staging runs keeps every op.
//
// GUARDIAN_WASM=sneed_guardian_prepaging runs it against the code before the fix (staging's module).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, admin, alice, user, ICP_LEDGER_ID, T, unwrap, errOf, BUILD, wasm, refusedAtIngress } from '../lib/pic.js';
import { ledgerInit, snsWasmIdl } from '../lib/idl.js';
import { idlFactory as guardianIdl, init as guardianInit } from '../build/sneed_guardian.did.js';

const WASM = process.env.GUARDIAN_WASM || 'sneed_guardian';
const sha256 = (bytes) => Uint8Array.from(createHash('sha256').update(bytes).digest());
const ledgerV1 = readFileSync(resolve(BUILD, 'MockLedger.wasm'));
const ledgerV2 = readFileSync(resolve(BUILD, 'MockLedgerV2.wasm'));
const V1 = sha256(ledgerV1); const V2 = sha256(ledgerV2);
const dao = user('pg-dao');
const spammer = user('pg-spammer');
const normal = user('pg-normal');
const many = user('pg-many');
const policy = (over = {}) => ({ guardians: [], vetoes_to_block: 0n, oks_required: 0n, window_ns: 0n, auto_upgrade: false, ...over });
const initArg = (over = {}) => ({ name: 'paging guardian', approvers: [dao], threshold: 1n, archive_controllers: [admin], admins: [], sneed_premium: [], fee_destination: [], icp_ledger: [], sns_wasm: [], ...over });
const bytes = (n, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) % 256);
// a refused call: either the ingress guard refuses it (inspect peeks at the bucket) or the method answers Err
const refused = async (promise) => {
  try { return errOf(await promise); } catch (e) { if (/canister_inspect_message .*refused/.test(String(e?.message || e))) return 'refused at ingress'; throw e; }
};

let pic, icpId, snsWasmId, gid, childId, g, as;

async function setup(name) {
  ({ pic } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 10_000n, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  snsWasmId = await install(pic, { name: 'MockSnsWasm' });
  gid = await install(pic, { name, initTypes: guardianInit({ IDL }), initArgs: [initArg({ icp_ledger: [icpId], sns_wasm: [snsWasmId] })], cycles: 50n * T });
  childId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 1_000n, symbol: 'AAA', decimals: 8 }], controllers: [alice, gid], sender: alice, cycles: 5n * T });
  await actorAs(pic, snsWasmIdl, snsWasmId, admin).set_steps([{ ledger: V1, index: V1, archive: V1 }, { ledger: V2, index: V1, archive: V1 }]);
  g = actorAs(pic, guardianIdl, gid, admin);
  as = (p) => actorAs(pic, guardianIdl, gid, p);
  await pic.tick(3);
  unwrap(await g.refresh_blessed());
  unwrap(await as(alice).register(childId, { ledger: null }, policy(), [], 'AAA ledger'));
}
const install_ = (arg) => ({ install: { hash: V2, arg: arg ? [arg] : [] } });
const setPolicy = { set_policy: policy() };

describe(`sneed_guardian anti-spam and paging (${WASM})`, () => {
  beforeAll(async () => { await setup(WASM); }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('caps an install op\'s upgrade argument at 256 KiB (it was 1 MiB, free to stage)', async () => {
    const ok = unwrap(await as(alice).stage_op(childId, install_(bytes(200_000)), 'ok size', []));
    expect(ok.id).toBeGreaterThan(0n);
    // just over the cap: the method refuses it
    expect(errOf(await as(alice).stage_op(childId, install_(bytes(262_145)), 'too big', []))).toMatch(/at most 262144/);
    // far over: the ingress guard refuses it before it costs anything
    expect(await refusedAtIngress(as(alice).stage_op(childId, install_(bytes(600_000)), 'way too big', []))).toBe(true);
    unwrap(await as(alice).cancel_op(ok.id));
  });

  it('limits the open ops one principal may have staged; admins are not limited', async () => {
    const lim = await g.get_op_limits();
    expect(lim.max_open_ops_per_caller).toBe(10n);
    expect(lim.max_install_arg_bytes).toBe(262_144n);
    const mine = [];
    for (let i = 0; i < 10; i++) mine.push(unwrap(await as(many).stage_op(childId, setPolicy, `op ${i}`, [])).id);
    expect(errOf(await as(many).stage_op(childId, setPolicy, 'eleventh', []))).toMatch(/10 open ops/);
    unwrap(await g.stage_op(childId, setPolicy, 'admin is not limited', []));
    // closing one makes room again
    unwrap(await as(many).cancel_op(mine[0]));
    unwrap(await as(many).stage_op(childId, setPolicy, 'room again', []));
    // admin-settable
    expect(errOf(await as(many).admin_set_max_open_ops(50n))).toMatch(/admins only/);
    unwrap(await g.admin_set_max_open_ops(1000n));
    expect((await g.get_op_limits()).max_open_ops_per_caller).toBe(1000n);
  });

  it('rate-limits a spammer, not a normal user', async () => {
    const rules = Object.fromEntries((await g.get_rate_limits()).map(([a, r]) => [a, r]));
    expect(rules.stage_op).toEqual({ capacity: 20n, per_minute: 10n });
    expect(Object.keys(rules).sort()).toEqual(['refund_op', 'register', 'stage_op']);
    for (let i = 0; i < 20; i++) unwrap(await as(spammer).stage_op(childId, setPolicy, `spam ${i}`, []));
    expect(await refused(as(spammer).stage_op(childId, setPolicy, 'spam 21', []))).toMatch(/Rate limited|refused at ingress/);
    // somebody else is not affected
    unwrap(await as(normal).stage_op(childId, setPolicy, 'normal use', []));
    // a minute later the spammer may stage a few again
    await pic.advanceTime(60_000); await pic.tick(1);
    unwrap(await as(spammer).stage_op(childId, setPolicy, 'after a minute', []));
    // admins set the rule (null = back to the default); unknown actions are refused
    expect(errOf(await as(spammer).admin_set_rate_limit('stage_op', [{ capacity: 1000n, per_minute: 1000n }]))).toMatch(/admins only/);
    expect(errOf(await g.admin_set_rate_limit('nope', [{ capacity: 1n, per_minute: 1n }]))).toMatch(/Unknown action/);
    unwrap(await g.admin_set_rate_limit('stage_op', [{ capacity: 2n, per_minute: 1n }]));
    unwrap(await as(user('pg-new')).stage_op(childId, setPolicy, 'one', []));
    unwrap(await as(user('pg-new')).stage_op(childId, setPolicy, 'two', []));
    expect(await refused(as(user('pg-new')).stage_op(childId, setPolicy, 'three', []))).toMatch(/Rate limited|refused at ingress/);
    unwrap(await g.admin_set_rate_limit('stage_op', []));
    expect(Object.fromEntries(await g.get_rate_limits()).stage_op).toEqual({ capacity: 20n, per_minute: 10n });
  });

  it('caps list_ops and list_ops_for, and pages summaries without the argument bytes', async () => {
    const args = [];
    for (let i = 0; i < 7; i++) { const a = bytes(250_000, i + 2); args.push(a); unwrap(await g.stage_op(childId, install_(a), `big ${i}`, [])); }
    const total = (await g.get_config()).ops;
    expect(total).toBeGreaterThan(40n);
    // whole ops: at most 100 (0 = 50), and they stop before 1.5 MB of install arguments
    expect((await g.list_ops(false, 0n)).length).toBeLessThanOrEqual(6);
    expect((await g.list_ops(false, 3n)).length).toBe(3);
    const forChild = await g.list_ops_for(childId);
    expect(forChild.length).toBeLessThanOrEqual(6);
    expect(forChild[0].id).toBe(total); // newest first
    // summaries: every op, 2 at a time when asked, arguments as size + SHA-256
    const page1 = await g.list_op_summaries({ open: false, child: [], before: [], limit: 2n });
    expect(page1.items.map((o) => o.id)).toEqual([total, total - 1n]);
    const inst = page1.items[0].kind.install;
    expect(inst.arg_size).toEqual([250_000n]);
    expect(Array.from(inst.arg_sha256[0])).toEqual(Array.from(sha256(args[6])));
    expect(page1.next).toEqual([total - 1n]);
    const page2 = await g.list_op_summaries({ open: false, child: [childId], before: page1.next, limit: 2n });
    expect(page2.items.map((o) => o.id)).toEqual([total - 2n, total - 3n]);
    // all of them, 100 per page at most
    let seen = 0n; let before = [];
    for (;;) {
      const p = await g.list_op_summaries({ open: false, child: [], before, limit: 1000n });
      expect(p.items.length).toBeLessThanOrEqual(100);
      seen += BigInt(p.items.length);
      if (!p.next.length) break;
      before = p.next;
    }
    expect(seen).toBe(total);
    // open only
    const open = await g.list_op_summaries({ open: true, child: [], before: [], limit: 100n });
    expect(open.items.every((o) => 'pending' in o.state || 'approved' in o.state)).toBe(true);
    // the full bytes come with get_op
    const full = (await g.get_op(total))[0];
    expect(full.kind.install.arg[0].length).toBe(250_000);
  });
});

describe(`sneed_guardian: upgrade from what staging runs (sneed_guardian_prepaging) to ${WASM}`, () => {
  beforeAll(async () => { await setup('sneed_guardian_prepaging'); }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('keeps every op, and the new limits and lists work on them', async () => {
    const big = bytes(300_000, 9); // staging takes it today
    const op1 = unwrap(await as(alice).stage_op(childId, install_(big), 'before the upgrade', []));
    const op2 = unwrap(await as(alice).stage_op(childId, setPolicy, 'policy', []));
    const cfg = await g.get_config();

    await pic.upgradeCanister({ sender: admin, canisterId: gid, wasm: wasm(WASM), arg: IDL.encode([guardianInit({ IDL })[0]], [initArg()]) });

    expect((await g.get_config()).ops).toBe(cfg.ops);
    expect((await g.get_op(op1.id))[0].kind.install.arg[0].length).toBe(300_000);
    expect((await g.get_op(op2.id))[0].memo).toBe('policy');
    const p = await g.list_op_summaries({ open: true, child: [childId], before: [], limit: 10n });
    expect(p.items.map((o) => o.id)).toEqual([op2.id, op1.id]);
    expect(Array.from(p.items[1].kind.install.arg_sha256[0])).toEqual(Array.from(sha256(big))); // computed for an op staged before
    expect((await g.get_op_limits()).max_open_ops_per_caller).toBe(10n);
    expect((await g.get_rate_limits()).length).toBe(3);
    // and staging goes on
    unwrap(await as(alice).stage_op(childId, setPolicy, 'after', []));
    expect((await g.get_config()).ops).toBe(cfg.ops + 1n);
  });
});
