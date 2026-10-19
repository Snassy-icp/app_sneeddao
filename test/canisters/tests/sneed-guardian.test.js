// sneed_guardian: custody of ledger-suite canisters on behalf of DAOs.
// Registration needs the guardian as controller plus proof of ownership and a
// blessed hash; ops go through approvers, guardian vetoes/oks and a window;
// auto-upgrade walks the blessed path one step at a time; the status timer
// reports cycles and discovers archives; a blackholed deployment has no admin.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, account, admin, alice, bob, carol, user, ICP_LEDGER_ID, T, unwrap, errOf, BUILD } from '../lib/pic.js';
import { ledgerIdl, ledgerInit, snsWasmIdl } from '../lib/idl.js';
import { idlFactory as guardianIdl, init as guardianInit } from '../build/sneed_guardian.did.js';

const sha256 = (bytes) => Uint8Array.from(createHash('sha256').update(bytes).digest());
const ICP_FEE = 10_000n;
const HOUR = 3600;
const dao = user('dao'); // stands in for a governance canister
const dao2 = user('dao2');

const ledgerV1 = readFileSync(resolve(BUILD, 'MockLedger.wasm'));
const ledgerV2 = readFileSync(resolve(BUILD, 'MockLedgerV2.wasm'));
const V1 = sha256(ledgerV1); const V2 = sha256(ledgerV2);
const sameHash = (a, b) => Array.from(a).join() === Array.from(b || []).join();

const snsWasmMockIdl = snsWasmIdl;

let pic, icpId, snsWasmId, guardianId, childId, archiveId, holeId;
let icp, icpAlice, snsWasm, g, gAlice, gBob, gCarol, gDao, gDao2;

const opSub = (id) => { const s = new Uint8Array(32); s[0] = 0x6f; s[1] = 1; let n = BigInt(id); for (let i = 31; i >= 24; i--) { s[i] = Number(n % 256n); n /= 256n; } return s; };
const payFee = async (gid, op) => { if (op.fee_e8s > 0n) unwrap(await icpAlice.icrc1_transfer({ from_subaccount: [], to: account(gid, opSub(op.id)), amount: op.fee_e8s + ICP_FEE, fee: [], memo: [], created_at_time: [] })); };
const policy = (over = {}) => ({ guardians: [bob, carol], vetoes_to_block: 1n, oks_required: 0n, window_ns: BigInt(HOUR) * 1_000_000_000n, auto_upgrade: false, ...over });
const initArg = (over = {}) => ({ name: 'test guardian', approvers: [dao], threshold: 1n, archive_controllers: [admin], admins: [carol], sneed_premium: [], fee_destination: [account(carol)], icp_ledger: [], sns_wasm: [], ...over });
const advance = async (seconds) => { await pic.advanceTime(seconds * 1000); await pic.tick(3); };

describe('sneed_guardian', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
    snsWasmId = await install(pic, { name: 'MockSnsWasm' });
    guardianId = await install(pic, { name: 'sneed_guardian', initTypes: guardianInit({ IDL }), initArgs: [initArg({ icp_ledger: [icpId], sns_wasm: [snsWasmId] })], cycles: 50n * T });
    // a "ledger" the guardian will hold: alice's, with the guardian added as a controller
    childId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 1_000n, symbol: 'AAA', decimals: 8 }], controllers: [alice, guardianId], sender: alice, cycles: 5n * T });
    icp = actorAs(pic, ledgerIdl, icpId, admin); icpAlice = actorAs(pic, ledgerIdl, icpId, alice);
    snsWasm = actorAs(pic, snsWasmMockIdl, snsWasmId, admin);
    g = actorAs(pic, guardianIdl, guardianId, admin);
    gAlice = actorAs(pic, guardianIdl, guardianId, alice); gBob = actorAs(pic, guardianIdl, guardianId, bob); gCarol = actorAs(pic, guardianIdl, guardianId, carol);
    gDao = actorAs(pic, guardianIdl, guardianId, dao); gDao2 = actorAs(pic, guardianIdl, guardianId, dao2);
    // the blessed path: V1 then V2 for ledgers; indexes and archives are "V1" too
    await snsWasm.set_steps([{ ledger: V1, index: V1, archive: V1 }, { ledger: V2, index: V1, archive: V1 }]);
    await snsWasm.set_wasm(V2, Uint8Array.from(ledgerV2));
    await icp.mint(account(alice), 20n * 100_000_000n);
    await pic.tick(3);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('reads the blessed versions from the SNS wasm canister', async () => {
    unwrap(await g.refresh_blessed());
    const cfg = await g.get_config();
    expect(cfg.blessed.ledger.length).toBe(2);
    expect(sameHash(cfg.blessed.ledger[0], V1) && sameHash(cfg.blessed.ledger[1], V2)).toBe(true);
    expect(cfg.blessed.index.length).toBe(1);
    expect(cfg.approvers.map((p) => p.toText())).toEqual([dao.toText()]);
    expect(errOf(await gAlice.refresh_blessed())).toMatch(/recently/);
  });

  it('registers only what it controls, only for a controller, only with blessed code', async () => {
    // not a controller of the child: bob
    expect(errOf(await gBob.register(childId, { ledger: null }, policy(), [], 'AAA ledger'))).toMatch(/current controller/);
    // the guardian does not control the ICP mock
    expect(errOf(await g.register(icpId, { ledger: null }, policy(), [], 'icp'))).toMatch(/add the guardian/);
    // wrong kind for the code: the child's hash is blessed as a ledger, say it is an index -> still blessed (index list = V1); say it is an archive -> blessed too; use a bogus policy instead
    expect(errOf(await gAlice.register(childId, { ledger: null }, policy({ vetoes_to_block: 5n }), [], 'AAA ledger'))).toMatch(/vetoes_to_block/);
    const c = unwrap(await gAlice.register(childId, { ledger: null }, policy(), [], 'AAA ledger'));
    expect(c.title).toBe('AAA ledger');
    expect(sameHash(c.status[0].module_hash[0], V1)).toBe(true);
    expect(c.status[0].controllers.map((p) => p.toText()).sort()).toEqual([alice.toText(), guardianId.toText()].sort());
    expect(errOf(await gAlice.register(childId, { ledger: null }, policy(), [], 'again'))).toMatch(/already/);
    // code the NNS never blessed: the SNS wasm mock itself has the guardian as... no, install one more canister with unblessed code
    const other = await install(pic, { name: 'MockCmc', controllers: [alice, guardianId], sender: alice, cycles: 2n * T });
    expect(errOf(await gAlice.register(other, { ledger: null }, policy(), [], 'cmc'))).toMatch(/not a version the NNS blessed/);
  });

  it('stages for free, wants the fee in the op\'s payment account before the vote, and lets a guardian veto', async () => {
    const cfg = await g.get_config();
    expect(cfg.op_fee_e8s).toBe(100_000_000n);
    const op = unwrap(await gAlice.stage_op(childId, { set_policy: policy({ auto_upgrade: true }) }, 'turn on auto-upgrade', []));
    expect(op.fee_e8s).toBe(100_000_000n); expect(op.fee_paid_e8s).toBe(0n); expect(op.payer.toText()).toBe(alice.toText());
    expect(Object.keys(op.state)[0]).toBe('pending');
    // unpaid: the validator refuses, so the approval proposal cannot even be filed
    expect(errOf(await g.validate_approve_op(op.id))).toMatch(/fee is not paid/);
    const pay = unwrap(await g.get_op_payment(op.id));
    expect(pay.amount_to_send_e8s).toBe(100_010_000n);
    expect(Array.from(pay.account.subaccount[0])).toEqual(Array.from(opSub(op.id)));
    await payFee(guardianId, op);
    expect(unwrap(await g.get_op_payment(op.id)).paid_e8s).toBe(100_010_000n);
    const text = unwrap(await g.validate_approve_op(op.id));
    expect(text).toMatch(/AAA ledger/); expect(text).toMatch(/auto-upgrade true/); expect(text).toMatch(/1 of 1 approvers/); expect(text).toMatch(/Fee: 100000000 e8s/);
    expect(errOf(await gAlice.execute_op(op.id))).toMatch(/not approved/);
    expect(errOf(await gAlice.approve_op(op.id))).toMatch(/only an approver/);
    expect(errOf(await gDao2.approve_op(op.id))).toMatch(/only an approver/);
    const approved = unwrap(await gDao.approve_op(op.id));
    expect(Object.keys(approved.state)[0]).toBe('approved');
    expect(errOf(await gDao.approve_op(op.id))).toMatch(/already/);
    expect(errOf(await gAlice.execute_op(op.id))).toMatch(/window is open/);
    // a guardian vetoes within the window; one veto blocks under this policy
    expect(errOf(await gAlice.veto_op(op.id))).toMatch(/only a guardian/);
    const vetoed = unwrap(await gBob.veto_op(op.id));
    expect(Object.keys(vetoed.state)[0]).toBe('vetoed');
    await advance(HOUR + 60);
    expect(errOf(await gAlice.execute_op(op.id))).toMatch(/vetoed/);
    // the fee of a dead op goes back to the payer, minus the ledger fee
    const before = await icp.icrc1_balance_of(account(alice));
    expect(unwrap(await gBob.refund_op(op.id))).toBe(100_000_000n);
    expect((await icp.icrc1_balance_of(account(alice))) - before).toBe(100_000_000n);
    expect(errOf(await gBob.refund_op(op.id))).toMatch(/nothing to refund/);
  });

  it('executes an approved op after the window, honouring required go-aheads', async () => {
    // tighten: two oks needed, no vetoes
    const op = unwrap(await gAlice.stage_op(childId, { set_policy: policy({ vetoes_to_block: 0n, oks_required: 2n, window_ns: 0n, auto_upgrade: true }) }, '', []));
    unwrap(await gDao.approve_op(op.id));
    await advance(HOUR + 60);
    expect(errOf(await gAlice.execute_op(op.id))).toMatch(/fee is not paid/); // approved, but unpaid: nothing runs
    await payFee(guardianId, op);
    const feeBefore = await icp.icrc1_balance_of(account(carol));
    const done = unwrap(await gAlice.execute_op(op.id));
    expect(Object.keys(done.state)[0]).toBe('executed');
    expect(done.fee_paid_e8s).toBe(100_000_000n);
    expect((await icp.icrc1_balance_of(account(carol))) - feeBefore).toBe(100_000_000n); // the fee reached the destination
    let child = (await g.get_child(childId))[0];
    expect(child.policy.auto_upgrade).toBe(true);
    expect(child.policy.oks_required).toBe(2n);
    // the new rules apply to the next op: approved, but not executable until two guardians ok
    const op2 = unwrap(await gAlice.stage_op(childId, { set_policy: policy({ vetoes_to_block: 0n, oks_required: 0n, window_ns: 0n, auto_upgrade: true }) }, 'loosen', []));
    await payFee(guardianId, op2);
    unwrap(await gDao.approve_op(op2.id));
    expect(errOf(await gAlice.execute_op(op2.id))).toMatch(/go-aheads/);
    unwrap(await gBob.ok_op(op2.id));
    expect(errOf(await gBob.ok_op(op2.id))).toMatch(/already/);
    expect(errOf(await gAlice.execute_op(op2.id))).toMatch(/go-aheads/);
    unwrap(await gCarol.ok_op(op2.id));
    unwrap(await gAlice.execute_op(op2.id));
    child = (await g.get_child(childId))[0];
    expect(child.policy.oks_required).toBe(0n);
    const open = await g.list_ops(true, 0n);
    expect(open.length).toBe(0);
  });

  it('auto-upgrades one step along the blessed path and reports the new hash', async () => {
    const before = (await g.get_child(childId))[0];
    expect(sameHash(before.status[0].module_hash[0], V1)).toBe(true);
    expect((await g.list_upgradable()).some((u) => u.canister_id.toText() === childId.toText() && sameHash(u.next, V2))).toBe(true);
    expect(unwrap(await g.admin_run_auto_upgrade())).toBe(1n);
    const after = (await g.get_child(childId))[0];
    expect(sameHash(after.status[0].module_hash[0], V2)).toBe(true);
    expect(after.last_upgrade[0].by).toBe('auto');
    const v2 = actorAs(pic, ({ IDL }) => IDL.Service({ version: IDL.Func([], [IDL.Nat], ['query']) }), childId, alice);
    expect(await v2.version()).toBe(2n);
    // nothing further to do: V2 is the last blessed version
    expect(unwrap(await g.admin_run_auto_upgrade())).toBe(0n);
    expect((await g.list_upgradable()).length).toBe(0);
    // the daily timer would do the same; an explicit install op to a non-next hash is refused at execution
    const op = unwrap(await gAlice.stage_op(childId, { install: { hash: V1, arg: [] } }, 'downgrade?', []));
    await payFee(guardianId, op);
    unwrap(await gDao.approve_op(op.id));
    expect(errOf(await gAlice.execute_op(op.id))).toMatch(/not on the blessed list, or is already its last version|one step at a time|already on/);
    // the same hash with an explicit argument is a reconfiguration (how a ledger gets pointed at an index)
    const re = unwrap(await gAlice.stage_op(childId, { install: { hash: V2, arg: [new Uint8Array(IDL.encode([IDL.Opt(IDL.Record({}))], [[]]))] } }, 'reconfigure', []));
    await payFee(guardianId, re);
    unwrap(await gDao.approve_op(re.id));
    unwrap(await gAlice.execute_op(re.id));
    expect((await g.get_child(childId))[0].last_upgrade[0].by).toMatch(/op/);
    const same = unwrap(await gAlice.stage_op(childId, { install: { hash: V2, arg: [] } }, 'same again', []));
    await payFee(guardianId, same);
    unwrap(await gDao.approve_op(same.id));
    expect(errOf(await gAlice.execute_op(same.id))).toMatch(/already on/);
    const bogus = Uint8Array.from({ length: 32 }, () => 9);
    expect(errOf(await gAlice.stage_op(childId, { install: { hash: bogus, arg: [] } }, '', []))).toMatch(/not a hash the NNS blessed/);
  });

  it('reports cycles for every child and discovers the archives a ledger spawned', async () => {
    const rows = await g.get_cycles_report([]);
    expect(rows[0].canister_id.toText()).toBe(guardianId.toText());
    const row = rows.find((r) => r.canister_id.toText() === childId.toText());
    expect(row.cycles > 0n).toBe(true);
    expect(row.low).toBe(false);
    const strict = await g.get_cycles_report([1_000_000n * T]);
    expect(strict.every((r) => r.low)).toBe(true);
    // an archive: controlled by the guardian, blessed as an archive (V1), listed by the ledger
    archiveId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 1n, symbol: 'ARC', decimals: 8 }], controllers: [guardianId, admin], cycles: 2n * T });
    const v2 = actorAs(pic, ({ IDL }) => IDL.Service({ set_archives: IDL.Func([IDL.Vec(IDL.Principal)], [], []) }), childId, alice);
    await v2.set_archives([archiveId]);
    unwrap(await g.admin_run_status());
    const arc = (await g.get_child(archiveId))[0];
    expect(Object.keys(arc.kind)[0]).toBe('archive');
    expect(arc.suite[0].toText()).toBe(childId.toText());
    expect(arc.title).toBe('AAA ledger archive');
    expect((await g.get_suite(childId)).length).toBe(2);
    // the status timer runs on its own
    const t0 = (await g.get_config()).status_last_run;
    await advance(6 * HOUR + 60);
    expect((await g.get_config()).status_last_run > t0).toBe(true);
    // anyone may force one reading, rate limited
    unwrap(await gBob.refresh_status(childId));
    expect(errOf(await gBob.refresh_status(childId))).toMatch(/recently/);
  });

  it('changes its own configuration and approvers only through ops', async () => {
    const op = unwrap(await gAlice.stage_op(guardianId, { set_config: { op_fee_e8s: [50_000_000n], premium_op_fee_e8s: [], fee_destination: [], op_ttl_ns: [], self_window_ns: [], status_interval_s: [], low_cycles_threshold: [], cycle_reserve: [], paused: [], approve_function_id: [] } }, 'cheaper', []));
    expect(op.fee_e8s).toBe(0n); // ops on the guardian itself are free
    unwrap(await gDao.approve_op(op.id));
    unwrap(await gAlice.execute_op(op.id));
    expect((await g.get_config()).op_fee_e8s).toBe(50_000_000n);
    const op2 = unwrap(await gAlice.stage_op(guardianId, { set_approvers: { approvers: [dao, dao2], threshold: 2n } }, 'two DAOs', []));
    unwrap(await gDao.approve_op(op2.id));
    unwrap(await gAlice.execute_op(op2.id));
    expect((await g.get_config()).threshold).toBe(2n);
    // now both must approve
    const op3 = unwrap(await gAlice.stage_op(childId, { set_policy: policy({ vetoes_to_block: 0n, window_ns: 0n }) }, '', []));
    await payFee(guardianId, op3);
    expect(Object.keys(unwrap(await gDao.approve_op(op3.id)).state)[0]).toBe('pending');
    expect(Object.keys(unwrap(await gDao2.approve_op(op3.id)).state)[0]).toBe('approved');
    unwrap(await gAlice.execute_op(op3.id));
    // the stager can cancel a pending op; an expired op cannot be approved
    const op4 = unwrap(await gAlice.stage_op(childId, { set_policy: policy() }, '', []));
    unwrap(await gAlice.cancel_op(op4.id));
    expect(errOf(await gDao.approve_op(op4.id))).toMatch(/cancelled/);
    const op5 = unwrap(await gAlice.stage_op(childId, { set_policy: policy() }, '', []));
    await advance(31 * 24 * HOUR);
    expect(errOf(await gDao.approve_op(op5.id))).toMatch(/expired/);
  });

  it('lets a listed admin approve alone during the trial period, until the list is emptied', async () => {
    expect((await g.get_admins()).map((p) => p.toText())).toEqual([carol.toText()]);
    const op = unwrap(await gAlice.stage_op(childId, { set_policy: policy({ vetoes_to_block: 0n, window_ns: 0n }) }, 'admin test', []));
    await payFee(guardianId, op);
    const approved = unwrap(await gCarol.approve_op(op.id)); // carol is a guardian of the child too, but here she acts as admin: one approval, threshold 2
    expect(Object.keys(approved.state)[0]).toBe('approved');
    unwrap(await gAlice.execute_op(op.id));
    expect(errOf(await gBob.admin_add_admin(bob))).toMatch(/admins only/);
    unwrap(await gCarol.admin_add_admin(bob));
    unwrap(await gBob.admin_remove_admin(carol));
    unwrap(await gBob.admin_remove_admin(bob));
    expect(await g.get_admins()).toEqual([]);
    expect(errOf(await gCarol.admin_add_admin(carol))).toMatch(/admins only/); // nobody can refill the list (admin here is still a controller, so use carol)
    const op2 = unwrap(await gAlice.stage_op(childId, { set_policy: policy() }, '', []));
    expect(Object.keys(unwrap(await gDao.approve_op(op2.id)).state)[0]).toBe('pending'); // back to the real threshold
    unwrap(await gAlice.cancel_op(op2.id));
  });

  it('releases a child when the controllers op leaves the guardian out', async () => {
    const op = unwrap(await gAlice.stage_op(childId, { set_controllers: [alice] }, 'take it back', []));
    await payFee(guardianId, op);
    unwrap(await gDao.approve_op(op.id)); unwrap(await gDao2.approve_op(op.id));
    unwrap(await gAlice.execute_op(op.id));
    expect((await g.get_child(childId)).length).toBe(0);
    expect((await pic.getControllers(childId)).map((p) => p.toText())).toEqual([alice.toText()]);
    expect(errOf(await gAlice.register(childId, { ledger: null }, policy(), [], 'AAA ledger'))).toMatch(/add the guardian/);
  });

  it('runs exactly the same without any controller (sneed_guardian_blackhole)', async () => {
    holeId = await install(pic, { name: 'sneed_guardian', initTypes: guardianInit({ IDL }), initArgs: [initArg({ name: 'hole', icp_ledger: [icpId], sns_wasm: [snsWasmId], archive_controllers: [], admins: [] })], cycles: 50n * T });
    await pic.updateCanisterSettings({ canisterId: holeId, sender: admin, controllers: [] });
    expect(await pic.getControllers(holeId)).toEqual([]);
    const hole = actorAs(pic, guardianIdl, holeId, admin);
    expect(errOf(await hole.admin_run_status())).toMatch(/admins only/);
    expect(errOf(await hole.admin_set_canisters({ icp_ledger: [], sns_wasm: [], sneed_premium: [] }))).toMatch(/admins only/);
    await advance(5); // the install-time timer read the blessed list
    expect((await hole.get_config()).blessed.ledger.length).toBe(2);
    // alice gives the hole her ledger and registers it
    await pic.updateCanisterSettings({ canisterId: childId, sender: alice, controllers: [alice, holeId] });
    const holeAlice = actorAs(pic, guardianIdl, holeId, alice);
    const c = unwrap(await holeAlice.register(childId, { ledger: null }, policy({ vetoes_to_block: 0n, window_ns: 0n }), [], 'AAA under the hole'));
    expect(sameHash(c.status[0].module_hash[0], V2)).toBe(true);
    const holeDao = actorAs(pic, guardianIdl, holeId, dao);
    const op = unwrap(await holeAlice.stage_op(childId, { set_policy: policy({ auto_upgrade: true, vetoes_to_block: 0n, window_ns: 0n }) }, '', []));
    await payFee(holeId, op);
    unwrap(await holeDao.approve_op(op.id));
    unwrap(await holeAlice.execute_op(op.id));
    expect((await hole.get_child(childId))[0].policy.auto_upgrade).toBe(true);
  }, 120_000);
});
