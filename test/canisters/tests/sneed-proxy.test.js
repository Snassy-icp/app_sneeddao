// sneed_proxy (spec/sneed_proxy.md): every admin setting by SNS proposal. A mock SNS governance
// (canisters/MockProxyGov.mo) calls the validators when a proposal is made and the execute methods
// when it is adopted, exactly as real governance does with generic nervous system functions, and
// also answers list_sns_canisters as SNS root. A mock target (canisters/MockProxyTarget.mo) replies
// (), #ok, #err with text or a variant, traps, rejects, sleeps past the 300 s timeout and checks
// admins. The pilot runs end to end on the real sneed_lock wasm (Sneed Lock fees).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, T, wasm, refusedAtIngress, asUpdates, unwrap } from '../lib/pic.js';
import { verifyLog, archiveIdl, btype, txField, hashValue, sha256 } from '../lib/icrc3.js';
import { idlFactory as proxyIdl, init as proxyInit } from '../build/sneed_proxy.did.js';
import { idlFactory as lockIdl } from '../build/sneed_lock.did.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const DFX_VERSION = process.env.DFX_VERSION || '0.28.0';

// ---- IDLs of the mocks ----
const Status = IDL.Variant({ open: IDL.Null, executed: IDL.Text, failed: IDL.Text });
const SnsCanisters = IDL.Record({
  root: IDL.Opt(IDL.Principal), swap: IDL.Opt(IDL.Principal), ledger: IDL.Opt(IDL.Principal), index: IDL.Opt(IDL.Principal),
  governance: IDL.Opt(IDL.Principal), dapps: IDL.Vec(IDL.Principal), archives: IDL.Vec(IDL.Principal),
});
const govIdl = ({ IDL }) => IDL.Service({
  add_function: IDL.Func([IDL.Nat, IDL.Record({ target: IDL.Principal, target_method: IDL.Text, validator: IDL.Principal, validator_method: IDL.Text })], [], []),
  submit: IDL.Func([IDL.Nat, IDL.Vec(IDL.Nat8)], [IDL.Variant({ ok: IDL.Tuple(IDL.Nat, IDL.Text), err: IDL.Text })], []),
  adopt: IDL.Func([IDL.Nat], [Status], []),
  pass: IDL.Func([IDL.Nat, IDL.Vec(IDL.Nat8)], [IDL.Variant({ ok: IDL.Tuple(IDL.Nat, Status), err: IDL.Text })], []),
  call_raw: IDL.Func([IDL.Principal, IDL.Text, IDL.Vec(IDL.Nat8)], [IDL.Variant({ ok: IDL.Vec(IDL.Nat8), err: IDL.Text })], []),
  set_sns_canisters: IDL.Func([SnsCanisters], [], []),
});
const targetIdl = ({ IDL }) => IDL.Service({
  add_admin: IDL.Func([IDL.Principal], [], []),
  wake: IDL.Func([], [], []),
  get: IDL.Func([], [IDL.Record({ value: IDL.Nat, calls: IDL.Nat, last_caller: IDL.Opt(IDL.Principal), sleeping: IDL.Nat })], ['query']),
});

// ---- the proxy's own types, from its generated interface ----
const proxySvc = proxyIdl({ IDL });
const argTypes = (m) => proxySvc._fields.find(([n]) => n === m)[1].argTypes;
const ProxyCallT = argTypes('execute_business');
const UpdateT = argTypes('set_allowlist');
const SettingsUpdateT = argTypes('self_set_icrc3_settings');

const FN = { business: 6000n, dapp: 6001n, community: 6002n, critical: 6003n, treasury: 6004n, allowlist: 6010n };
const METHOD = { 6000: 'business', 6001: 'dapp', 6002: 'community', 6003: 'critical', 6004: 'treasury' };

let pic, rootKey, appSubnet;
let govId, impostorId, proxyId, targetId, target2Id, lockId;
let gov, impostor, proxy, target, lock;
const fakeLedger = Principal.fromText('mxzaz-hqaaa-aaaar-qaada-cai');
const fakeArchive = Principal.fromText('mqygn-kiaaa-aaaar-qaadq-cai');

const nat = (n) => IDL.encode([IDL.Nat], [BigInt(n)]);
const text = (t) => IDL.encode([IDL.Text], [t]);
const unit = () => IDL.encode([], []);
const call = (canister, method, arg, over = {}) => ({ canister, method, arg: new Uint8Array(arg), note: [], expires_at: [], ...over });
const payload = (c) => new Uint8Array(IDL.encode(ProxyCallT, [c]));
const entry = (canister, method, cls, label, over = {}) => ({
  canister, method, class: { [cls]: null }, label, max_arg_bytes: 4096n, reply: { result: null }, enabled: true, ...over,
});
const update = (u) => ({ upsert: [], remove: [], names: [], remove_names: [], ...u });
const updatePayload = (u) => new Uint8Array(IDL.encode(UpdateT, [update(u)]));
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;

/// Make and adopt a proposal; returns the final status ({ executed: text } or { failed: text }).
async function pass(fid, bytes) {
  const r = await gov.pass(fid, bytes);
  if ('err' in r) return { refused: r.err };
  return r.ok[1];
}
const setAllowlist = async (u) => {
  const s = await pass(FN.allowlist, updatePayload(u));
  expect(s, JSON.stringify(s)).toHaveProperty('executed');
  return s.executed;
};
const validate = (cls, c) => proxy[`validate_${cls}`](c);
const targetState = () => actorAs(pic, targetIdl, targetId, admin).get();

/// The payload hash as the proxy logs it: the ICRC-3 value hash of the call's fields.
function payloadHash(c) {
  const fields = [['canister', { Blob: c.canister.toUint8Array() }], ['method', { Text: c.method }], ['arg', { Blob: c.arg }]];
  if (c.note.length) fields.push(['note', { Text: c.note[0] }]);
  if (c.expires_at.length) fields.push(['expires_at', { Nat: c.expires_at[0] }]);
  return hashValue({ Map: fields });
}

beforeAll(async () => {
  ({ pic, rootKey, appSubnet } = await createPic());
  const on = { cycles: 20n * T, targetSubnetId: appSubnet };
  govId = await install(pic, { name: 'MockProxyGov', ...on });
  impostorId = await install(pic, { name: 'MockProxyGov', ...on });
  gov = actorAs(pic, govIdl, govId, admin);
  impostor = actorAs(pic, govIdl, impostorId, admin);
  await gov.set_sns_canisters({ root: [govId], governance: [govId], ledger: [fakeLedger], index: [], swap: [], dapps: [], archives: [fakeArchive] });
  proxyId = await install(pic, { name: 'sneed_proxy', initTypes: proxyInit({ IDL }), initArgs: [[{ governance: govId, root: govId }]], ...on });
  targetId = await install(pic, { name: 'MockProxyTarget', ...on });
  target2Id = await install(pic, { name: 'MockProxyTarget', ...on });
  lockId = await install(pic, { name: 'sneed_lock', ...on });
  proxy = actorAs(pic, proxyIdl, proxyId, alice);
  target = actorAs(pic, targetIdl, targetId, admin);
  lock = actorAs(pic, lockIdl, lockId, admin);
  for (const [cls, id] of Object.entries(FN)) {
    const [t, v] = cls === 'allowlist' ? ['set_allowlist', 'validate_set_allowlist'] : [`execute_${cls}`, `validate_${cls}`];
    await gov.add_function(id, { target: proxyId, target_method: t, validator: proxyId, validator_method: v });
  }
  for (let i = 0; i < 5; i++) await pic.tick(); // the install-time read of root's SNS canister list
}, 300_000);
afterAll(async () => { await pic?.tearDown(); });

describe('sneed_proxy', () => {
  it('runs the reply reader unit tests (motoko/proxy_reply.test.mo)', () => {
    const cache = execFileSync('dfx', [`+${DFX_VERSION}`, 'cache', 'show'], { encoding: 'utf8' }).trim();
    const packages = execFileSync('mops', ['sources'], { cwd: root, encoding: 'utf8' }).trim().split(/\s+/);
    const out = execFileSync(resolve(cache, 'moc'), ['-r', ...packages, resolve(here, '..', 'motoko', 'proxy_reply.test.mo')], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(out).toContain('PROXY REPLY READER OK');
  });

  it('starts with governance and root from the install argument, the SNS canisters from root, and only the built-in entries', async () => {
    const c = await proxy.get_config();
    expect(c.governance.toText()).toBe(govId.toText());
    expect(c.root.toText()).toBe(govId.toText());
    expect(c.sns_canisters.map((p) => p.toText()).sort()).toEqual([govId, govId, fakeLedger, fakeArchive].map((p) => p.toText()).sort());
    expect(c.sns_canisters_refreshed_at).toHaveLength(1);
    expect(c.max_in_flight).toBe(20n);
    expect(c.forward_timeout_seconds).toBe(300n);
    expect(c.functions.map((f) => [f.id, f.target_method, f.critical])).toEqual([
      [6000n, 'execute_business', false], [6001n, 'execute_dapp', false], [6002n, 'execute_community', true],
      [6003n, 'execute_critical', true], [6004n, 'execute_treasury', true], [6010n, 'set_allowlist', true],
    ]);
    const list = await proxy.get_allowlist();
    expect(list.map((e) => e.method)).toEqual(['self_set_icrc3_settings', 'self_icrc3_spill_now', 'self_icrc3_repair_archive_controllers', 'self_set_max_in_flight']);
    expect(list.every((e) => e.builtin && 'dapp' in e.class && e.canister.toText() === proxyId.toText())).toBe(true);
    expect(await proxy.get_canister_names()).toEqual([{ canister: proxyId, name: 'Sneed proxy' }]);
  });

  it('refuses every ingress update and every query sent as an update', async () => {
    const c = call(targetId, 'set_unit', nat(1));
    for (const who of [alice, admin]) {
      const p = actorAs(pic, proxyIdl, proxyId, who);
      for (const m of ['execute_business', 'execute_dapp', 'execute_community', 'execute_critical', 'execute_treasury']) {
        expect(await refusedAtIngress(p[m](c)), m).toBe(true);
      }
      expect(await refusedAtIngress(p.set_allowlist(update({ names: [{ canister: targetId, name: 'x' }] })))).toBe(true);
      expect(await refusedAtIngress(p.self_set_max_in_flight(5n))).toBe(true);
      expect(await refusedAtIngress(p.self_icrc3_spill_now())).toBe(true);
      expect(await refusedAtIngress(p.self_icrc3_repair_archive_controllers())).toBe(true);
      expect(await refusedAtIngress(p.self_set_icrc3_settings({ max_live_blocks: [], spill_batch_size: [], archive_max_blocks: [], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }))).toBe(true);
      const u = actorAs(pic, asUpdates(proxyIdl), proxyId, who);
      for (const [m, args] of [['validate_business', [c]], ['validate_set_allowlist', [update({})]], ['get_allowlist', []], ['get_config', []], ['get_stats', []],
        ['get_recent', [5n]], ['get_log', [0n, 5n]], ['get_canister_names', []], ['get_api_doc', []], ['icrc3_log_status', []], ['icrc3_get_blocks', [[]]]]) {
        expect(await refusedAtIngress(u[m](...args)), `${m} as update`).toBe(true);
      }
    }
    // as queries they work
    expect('Err' in (await proxy.validate_business(c))).toBe(true);
    expect((await proxy.get_api_doc()).startsWith('# ')).toBe(true);
  });

  it('changes the allowlist only through set_allowlist from governance, with the full diff as validator text', async () => {
    const u = {
      names: [{ canister: targetId, name: 'Mock target' }, { canister: lockId, name: 'Sneed Lock' }],
      upsert: [
        entry(targetId, 'set_unit', 'business', 'Set the value (unit reply)', { reply: { any: null } }),
        entry(targetId, 'set_ok', 'business', 'Set the value (#ok)'),
        entry(targetId, 'set_Ok', 'business', 'Set the value (#Ok)'),
        entry(targetId, 'fail_text', 'business', 'Fail with text'),
        entry(targetId, 'fail_Text', 'business', 'Fail with Text'),
        entry(targetId, 'fail_variant', 'business', 'Fail with a variant'),
        entry(targetId, 'trap_now', 'business', 'Trap', { reply: { any: null } }),
        entry(targetId, 'reject_now', 'business', 'Reject', { reply: { any: null } }),
        entry(targetId, 'sleep', 'business', 'Sleep', { reply: { any: null } }),
        entry(targetId, 'big_reply', 'business', 'Big reply', { reply: { any: null } }),
        entry(targetId, 'admin_set', 'critical', 'Set the value as admin'),
        entry(lockId, 'admin_set_lock_fees_icp', 'business', 'Set Sneed Lock fees'),
      ],
    };
    const v = await proxy.validate_set_allowlist(update(u));
    expect(v).toHaveProperty('Ok');
    expect(v.Ok).toContain('Sneed proxy · allowlist change (GNSF 6010');
    expect(v.Ok).toContain(`Name: ${targetId.toText()} → "Mock target"`);
    expect(v.Ok).toContain(`Add: Mock target (${targetId.toText()}) set_ok · class business · "Set the value (#ok)" · max 4096 bytes · reply result · enabled`);
    expect(v.Ok).toContain(`Add: Sneed Lock (${lockId.toText()}) admin_set_lock_fees_icp · class business`);

    // anyone but governance is refused by the method itself (the impostor is another canister)
    const r = await impostor.call_raw(proxyId, 'set_allowlist', updatePayload(u));
    expect(r.err).toMatch(/Only Sneed SNS governance may change the proxy allowlist/);
    expect((await proxy.get_allowlist()).length).toBe(4);

    const diff = await setAllowlist(u);
    expect(diff).toBe(v.Ok);
    const list = await proxy.get_allowlist();
    expect(list.filter((e) => !e.builtin).length).toBe(12);
    expect((await proxy.get_canister_names()).map((n) => n.name).sort()).toEqual(['Mock target', 'Sneed Lock', 'Sneed proxy']);

    // a change shows old → new
    const change = await proxy.validate_set_allowlist(update({ upsert: [entry(targetId, 'set_ok', 'dapp', 'Set it', { max_arg_bytes: 100n, enabled: false })] }));
    expect(change.Ok).toContain('Change: Mock target');
    expect(change.Ok).toContain('class business → dapp; label "Set the value (#ok)" → "Set it"; max 4096 → 100 bytes; disabled');
  });

  it('refuses SNS canisters, the management canister, itself and malformed updates (validator and set_allowlist alike)', async () => {
    const named = (c) => [{ canister: c, name: 'X' }];
    const cases = [
      [update({ names: named(fakeLedger), upsert: [entry(fakeLedger, 'icrc1_transfer', 'treasury', 'Ledger')] }), /SNS canisters are never proxy targets/],
      [update({ names: named(fakeArchive), upsert: [entry(fakeArchive, 'x', 'business', 'Archive')] }), /SNS canisters/],
      [update({ names: named(govId), upsert: [entry(govId, 'manage_neuron', 'critical', 'Governance')] }), /SNS canisters/],
      [update({ upsert: [entry(Principal.fromText('aaaaa-aa'), 'install_code', 'critical', 'IC')] }), /management canister/],
      [update({ upsert: [entry(proxyId, 'set_allowlist', 'critical', 'Self')] }), /The proxy itself/],
      [update({ upsert: [entry(proxyId, 'self_set_max_in_flight', 'business', 'Self')] }), /built in and cannot be changed/],
      [update({ upsert: [entry(target2Id, 'set_ok', 'business', 'Unnamed')] }), /Give .* a name/],
      [update({ upsert: [entry(targetId, 'set_ok', 'business', 'Too big', { max_arg_bytes: 65_537n })] }), /max_arg_bytes must be 1-65536/],
      [update({ remove: [[targetId, 'nope']] }), /not in the allowlist/],
      [update({ remove_names: [targetId] }), /still used by allowlist entries/],
      [update({ upsert: [entry(targetId, 'set_ok', 'business', 'a'), entry(targetId, 'set_ok', 'business', 'b')] }), /twice/],
      [update({ names: [{ canister: alice, name: 'Alice' }] }), /not a canister id/],
      [update({}), /changes nothing/],
    ];
    for (const [u, re] of cases) {
      const v = await proxy.validate_set_allowlist(u);
      expect(v.Err, JSON.stringify(Object.keys(u))).toMatch(re);
      const s = await pass(FN.allowlist, updatePayload(u));
      expect(s.refused).toMatch(re);
    }
    // the validator passing is not enough: set_allowlist checks again at execution (a call that
    // skipped the validator, as if the SNS list changed in between, still traps)
    const r = await gov.call_raw(proxyId, 'set_allowlist', updatePayload(update({ upsert: [entry(fakeLedger, 'x', 'business', 'x')], names: [{ canister: fakeLedger, name: 'L' }] })));
    expect(r.err).toMatch(/SNS canisters/);
  });

  it('forwards only governance calls, through the right class, and #result turns #err into a failed proposal', async () => {
    // the impostor (not governance) cannot execute
    const c = call(targetId, 'set_ok', nat(7));
    expect((await impostor.call_raw(proxyId, 'execute_business', payload(c))).err).toMatch(/Only Sneed SNS governance/);
    expect((await targetState()).calls).toBe(0n);

    // validator text
    const v = await validate('business', c);
    expect(v.Ok.split('\n')).toEqual([
      'Sneed proxy · Application Business Logic (GNSF 6000)',
      'Action: Set the value (#ok)',
      `Target: Mock target (${targetId.toText()})`,
      'Method: set_ok',
      `Argument: ${nat(7).byteLength} bytes, SHA-256 ${sha256(Buffer.from(nat(7))).toString('hex')}`,
      `Argument (hex): ${Buffer.from(nat(7)).toString('hex')}`,
      'Reply: an err reply fails the proposal',
      'Expires: never',
      `Payload hash: ${payloadHash(c).toString('hex')}`,
      `Read the argument decoded: https://app.sneeddao.com/proxy/verify?c=${targetId.toText()}&m=set_ok&a=${Buffer.from(nat(7)).toString('hex')}`,
    ]);

    // wrong class: refused by the validator and at execution
    for (const cls of ['dapp', 'community', 'critical', 'treasury']) {
      expect((await validate(cls, c)).Err).toMatch(/is a business action: propose it with GNSF 6000 \(execute_business\)/);
    }
    expect((await gov.submit(FN.dapp, payload(c))).err).toMatch(/business action/);
    expect((await gov.call_raw(proxyId, 'execute_dapp', payload(c))).err).toMatch(/business action/);

    // #result: ok, Ok
    let s = await pass(FN.business, payload(c));
    expect(s.executed).toMatch(/^ok: Set the value \(#ok\) · reply \d+ bytes, SHA-256 [0-9a-f]{64} · block \d+$/);
    let st = await targetState();
    expect(st.value).toBe(7n);
    expect(st.last_caller[0].toText()).toBe(proxyId.toText());
    s = await pass(FN.business, payload(call(targetId, 'set_Ok', nat(8))));
    expect(s.executed).toMatch(/^ok: /);
    s = await pass(FN.business, payload(call(targetId, 'set_unit', nat(9))));
    expect(s.executed).toMatch(/^ok: Set the value \(unit reply\)/);
    expect((await targetState()).value).toBe(9n);

    // #result: err with text, Err with text, err with a variant
    s = await pass(FN.business, payload(call(targetId, 'fail_text', text('Admins only'))));
    expect(s.failed).toMatch(/^Admins only · block \d+$/);
    s = await pass(FN.business, payload(call(targetId, 'fail_Text', text('Fee too high'))));
    expect(s.failed).toMatch(/^Fee too high · block/);
    s = await pass(FN.business, payload(call(targetId, 'fail_variant', unit())));
    expect(s.failed).toMatch(/^target replied err \(\d+ bytes\) · block/);

    // a reply too big to keep in the block is still hashed
    s = await pass(FN.business, payload(call(targetId, 'big_reply', nat(2000))));
    expect(s.executed).toMatch(/reply 20\d\d bytes/);
  });

  it('reports a trap or a reject as a failed proposal, and the target keeps nothing', async () => {
    let s = await pass(FN.business, payload(call(targetId, 'trap_now', text('boom'))));
    // a trap reaches the caller as a reject carrying the trap message (IC0503)
    expect(s.failed).toMatch(/^target rejected \(canister_(error|reject)\): .*boom/);
    expect((await targetState()).value).toBe(9n); // the trap rolled back its 999
    s = await pass(FN.business, payload(call(targetId, 'reject_now', text('no thanks'))));
    expect(s.failed).toMatch(/^target rejected \(canister_reject\): no thanks · block/);
  });

  it('refuses disabled entries, oversized arguments and entries that changed between submission and execution', async () => {
    // over the size cap
    await setAllowlist({ upsert: [entry(targetId, 'set_ok', 'business', 'Set the value (#ok)', { max_arg_bytes: 8n })] });
    const big = call(targetId, 'set_ok', IDL.encode([IDL.Nat], [10n ** 40n]));
    expect((await validate('business', big)).Err).toMatch(/allows at most 8/);
    // moved to another class after submission
    const c = call(targetId, 'set_ok', nat(11));
    const [id] = (await gov.submit(FN.business, payload(c))).ok;
    await setAllowlist({ upsert: [entry(targetId, 'set_ok', 'dapp', 'Set the value (#ok)')] });
    expect((await gov.adopt(id)).failed).toMatch(/is a dapp action: propose it with GNSF 6001/);
    // disabled after submission
    await setAllowlist({ upsert: [entry(targetId, 'set_ok', 'business', 'Set the value (#ok)')] });
    const [id2] = (await gov.submit(FN.business, payload(c))).ok;
    await setAllowlist({ upsert: [entry(targetId, 'set_ok', 'business', 'Set the value (#ok)', { enabled: false })] });
    expect((await validate('business', c)).Err).toMatch(/disabled/);
    expect((await gov.adopt(id2)).failed).toMatch(/disabled/);
    // removed after submission
    await setAllowlist({ upsert: [entry(targetId, 'set_ok', 'business', 'Set the value (#ok)')] });
    const [id3] = (await gov.submit(FN.business, payload(c))).ok;
    await setAllowlist({ remove: [[targetId, 'set_ok']] });
    expect((await gov.adopt(id3)).failed).toMatch(/is not in the proxy allowlist/);
    expect((await validate('business', c)).Err).toMatch(/is not in the proxy allowlist/);
    expect((await targetState()).value).toBe(9n);
    await setAllowlist({ upsert: [entry(targetId, 'set_ok', 'business', 'Set the value (#ok)')] });
  });

  it('refuses expired proposals in the validator and at execution', async () => {
    const now = await nowNs();
    const past = call(targetId, 'set_ok', nat(12), { expires_at: [now - 1_000_000_000n] });
    expect((await validate('business', past)).Err).toMatch(/This proposal expired at \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC/);
    const soon = call(targetId, 'set_ok', nat(12), { expires_at: [now + 3_600_000_000_000n], note: ['Only this hour'] });
    const v = await validate('business', soon);
    expect(v.Ok).toMatch(/Expires: \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC \(\d+ ns\)/);
    expect(v.Ok).toContain('Note: Only this hour');
    const [id] = (await gov.submit(FN.business, payload(soon))).ok;
    await pic.advanceTime(2 * 3600 * 1000);
    await pic.tick();
    expect((await gov.adopt(id)).failed).toMatch(/expired/);
    expect((await targetState()).value).toBe(9n);
    // a note longer than 500 characters is refused
    expect((await validate('business', call(targetId, 'set_ok', nat(1), { note: ['x'.repeat(501)] }))).Err).toMatch(/note/);
  });

  it('re-checks the SNS canister list at execution (refreshed daily from root)', async () => {
    await setAllowlist({ names: [{ canister: target2Id, name: 'Second target' }], upsert: [entry(target2Id, 'set_ok', 'business', 'Set the second value')] });
    const c = call(target2Id, 'set_ok', nat(5));
    const [id] = (await gov.submit(FN.business, payload(c))).ok;
    // target2 becomes an SNS archive (as if registered with the SNS): refused from the next refresh
    await gov.set_sns_canisters({ root: [govId], governance: [govId], ledger: [fakeLedger], index: [], swap: [], dapps: [], archives: [fakeArchive, target2Id] });
    await pic.advanceTime(25 * 3600 * 1000);
    for (let i = 0; i < 5; i++) await pic.tick();
    expect((await proxy.get_config()).sns_canisters.map((p) => p.toText())).toContain(target2Id.toText());
    expect((await gov.adopt(id)).failed).toMatch(/SNS canisters are never proxy targets/);
    expect((await validate('business', c)).Err).toMatch(/SNS canisters/);
    await gov.set_sns_canisters({ root: [govId], governance: [govId], ledger: [fakeLedger], index: [], swap: [], dapps: [], archives: [fakeArchive] });
  });

  it('reaches its own settings only through execute_dapp, and caps the calls in flight', async () => {
    const self = (m, arg) => call(proxyId, m, arg);
    // through the wrong class
    expect((await validate('business', self('self_set_max_in_flight', nat(1)))).Err).toMatch(/is a dapp action/);
    // only the proxy itself may call the self_* methods
    expect((await gov.call_raw(proxyId, 'self_set_max_in_flight', nat(1))).err).toMatch(/Only the proxy itself/);
    // a self method that is not built in
    expect((await validate('dapp', self('set_allowlist', updatePayload({})))).Err).toMatch(/The proxy itself/);
    let s = await pass(FN.dapp, payload(self('self_set_max_in_flight', nat(0))));
    expect(s.failed).toMatch(/max_in_flight must be 1-100/);
    s = await pass(FN.dapp, payload(self('self_set_max_in_flight', nat(1))));
    expect(s.executed).toMatch(/^ok: Set how many proposals the proxy forwards at once/);
    expect((await proxy.get_config()).max_in_flight).toBe(1n);

    // one call sleeping in the target: the next proposal is refused as busy, nothing is called
    const [sleepId] = (await gov.submit(FN.business, payload(call(targetId, 'sleep', nat(21))))).ok;
    const deferred = pic.createDeferredActor({ idlFactory: govIdl, canisterId: govId });
    deferred.setPrincipal(admin);
    const sleeping = await deferred.adopt(sleepId);
    for (let i = 0; i < 5; i++) await pic.tick();
    expect((await targetState()).sleeping).toBe(1n);
    expect((await proxy.get_config()).in_flight).toBe(1n);
    const callsBefore = (await targetState()).calls;
    s = await pass(FN.business, payload(call(targetId, 'set_ok', nat(22))));
    expect(s.failed).toMatch(/The proxy is busy \(1 calls in flight\); nothing was called/);
    expect((await targetState()).calls).toBe(callsBefore);
    await target.wake();
    expect((await sleeping()).executed).toMatch(/^ok: Sleep/);
    expect((await targetState()).value).toBe(21n);
    expect((await proxy.get_config()).in_flight).toBe(0n);
    s = await pass(FN.dapp, payload(self('self_set_max_in_flight', nat(20))));
    expect(s.executed).toMatch(/^ok: /);
  });

  it('reports a call that outlives the 300 s timeout as unknown, logs it and commits the block', async () => {
    const before = (await proxy.icrc3_log_status()).log_length;
    const [id] = (await gov.submit(FN.business, payload(call(targetId, 'sleep', nat(31))))).ok;
    const deferred = pic.createDeferredActor({ idlFactory: govIdl, canisterId: govId });
    deferred.setPrincipal(admin);
    const pending = await deferred.adopt(id);
    for (let i = 0; i < 5; i++) await pic.tick();
    expect((await targetState()).sleeping).toBe(1n);
    await pic.advanceTime(301 * 1000);
    for (let i = 0; i < 5; i++) await pic.tick();
    const s = await pending();
    expect(s.failed).toMatch(new RegExp(`^outcome unknown after 300 s: check ${targetId.toText()} state before re-proposing`));
    expect((await proxy.icrc3_log_status()).log_length).toBe(before + 1n);
    const [last] = await proxy.get_recent(1n);
    expect(last.method).toBe('sleep');
    expect('unknown' in last.outcome).toBe(true);
    expect(last.reply_size).toEqual([]);
    expect((await proxy.get_config()).in_flight).toBe(0n);
    // it may still happen: the target finishes when woken
    await target.wake();
    for (let i = 0; i < 5; i++) await pic.tick();
    expect((await targetState()).value).toBe(31n);
  });

  it('runs the pilot end to end on the real sneed_lock: refused until the proxy is an admin, then the fee changes', async () => {
    const args = IDL.encode([IDL.Opt(IDL.Nat64), IDL.Opt(IDL.Nat64), IDL.Opt(IDL.Nat64), IDL.Opt(IDL.Nat64)], [[50_000_000n], [], [], []]);
    const c = call(lockId, 'admin_set_lock_fees_icp', args, { note: ['Halve the token lock fee'] });
    const v = await validate('business', c);
    expect(v.Ok).toContain(`Target: Sneed Lock (${lockId.toText()})`);
    let s = await pass(FN.business, payload(c));
    expect(s.failed).toMatch(/^Only admins can set lock fees · block/);
    unwrap(await lock.admin_add_admin(proxyId));
    s = await pass(FN.business, payload(c));
    expect(s.executed).toMatch(/^ok: Set Sneed Lock fees/);
    expect((await lock.get_lock_fees_icp()).token_lock_fee_icp_e8s).toBe(50_000_000n);
  });

  it('logs every forwarded call, with the payload and argument hashes, in a certified ICRC-3 chain', async () => {
    const archiveActor = (id) => actorAs(pic, archiveIdl, id, admin);
    const { blocks } = await verifyLog(proxy, proxyId, rootKey, archiveActor);
    const types = (await proxy.icrc3_supported_block_types()).map((t) => t.block_type);
    expect(types).toEqual(['sneedproxy_forwarded', 'sneedproxy_allowlist_set', 'sneedproxy_allowlist_removed', 'sneedproxy_canister_named', 'sneedproxy_config']);
    expect(new Set(blocks.map(btype))).toEqual(new Set(types));
    const forwarded = blocks.filter((b) => btype(b) === 'sneedproxy_forwarded');
    const stats = await proxy.get_stats();
    const total = stats.reduce((a, s) => a + s.forwarded, 0n);
    expect(BigInt(forwarded.length)).toBe(total);
    expect(stats.find((s) => 'business' in s.class)).toMatchObject({ unknown: 1n });
    for (const b of forwarded) {
      expect(Buffer.from(txField(b, 'caller').Blob)).toEqual(Buffer.from(govId.toUint8Array()));
      expect(['ok', 'err', 'unknown']).toContain(txField(b, 'outcome').Text);
      expect(Number(txField(b, 'function_id').Nat)).toBeGreaterThanOrEqual(6000);
    }
    // the pilot block: hashes recomputed from the payload
    const pilot = forwarded.filter((b) => txField(b, 'method').Text === 'admin_set_lock_fees_icp').at(-1);
    const args = IDL.encode([IDL.Opt(IDL.Nat64), IDL.Opt(IDL.Nat64), IDL.Opt(IDL.Nat64), IDL.Opt(IDL.Nat64)], [[50_000_000n], [], [], []]);
    const c = call(lockId, 'admin_set_lock_fees_icp', args, { note: ['Halve the token lock fee'] });
    expect(Buffer.from(txField(pilot, 'payload_hash').Blob)).toEqual(payloadHash(c));
    expect(Buffer.from(txField(pilot, 'arg_hash').Blob)).toEqual(sha256(Buffer.from(args)));
    expect(txField(pilot, 'function_id').Nat).toBe(6000n);
    expect(txField(pilot, 'label').Text).toBe('Set Sneed Lock fees');
    expect(txField(pilot, 'note').Text).toBe('Halve the token lock fee');
    expect(txField(pilot, 'outcome').Text).toBe('ok');
    expect(txField(pilot, 'reply')).toBeDefined(); // small replies are kept for decoding
    const failed = forwarded.find((b) => txField(b, 'method').Text === 'fail_text');
    expect(txField(failed, 'error').Text).toBe('Admins only');
    const big = forwarded.find((b) => txField(b, 'method').Text === 'big_reply');
    expect(txField(big, 'reply')).toBeUndefined();
    expect(txField(big, 'reply_hash')).toBeDefined();
    const cfg = blocks.filter((b) => btype(b) === 'sneedproxy_config').map((b) => [txField(b, 'key').Text, txField(b, 'new').Nat]);
    expect(cfg).toEqual([['max_in_flight', 1n], ['max_in_flight', 20n]]);
    // get_recent mirrors the newest blocks
    const recent = await proxy.get_recent(3n);
    expect(recent.length).toBe(3);
    expect(recent[0].block).toBeGreaterThan(recent[1].block);
  });

  it('spills its log to an archive controlled by the proxy and SNS root, through execute_dapp proposals', async () => {
    const settings = { max_live_blocks: [], spill_batch_size: [5n], archive_max_blocks: [], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] };
    let s = await pass(FN.dapp, payload(call(proxyId, 'self_set_icrc3_settings', IDL.encode(SettingsUpdateT, [settings]))));
    expect(s.executed).toMatch(/^ok: /);
    s = await pass(FN.dapp, payload(call(proxyId, 'self_icrc3_spill_now', unit())));
    expect(s.executed).toMatch(/^ok: /);
    const status = await proxy.icrc3_log_status();
    expect(status.archives.length).toBe(1);
    const controllers = (await pic.getControllers(status.archives[0].canister_id)).map((p) => p.toText()).sort();
    expect(controllers).toEqual([proxyId.toText(), govId.toText()].sort());
    s = await pass(FN.dapp, payload(call(proxyId, 'self_icrc3_repair_archive_controllers', unit())));
    expect(s.executed).toMatch(/^ok: /);
    const { blocks } = await verifyLog(proxy, proxyId, rootKey, (id) => actorAs(pic, archiveIdl, id, admin));
    expect(blocks.length).toBe(Number(status.log_length) + 1);
    expect((await proxy.get_log(0n, 50n)).some((e) => /created archive/.test(e.message))).toBe(true);
  });

  it('keeps the allowlist, names, stats, settings and log over an upgrade', async () => {
    const before = {
      allowlist: await proxy.get_allowlist(), names: await proxy.get_canister_names(), stats: await proxy.get_stats(),
      log: (await proxy.icrc3_log_status()).log_length, recent: await proxy.get_recent(5n),
    };
    const cfg = await proxy.get_config();
    // installed again with no argument: governance and root stay as they were
    await pic.upgradeCanister({ sender: admin, canisterId: proxyId, wasm: wasm('sneed_proxy'), arg: IDL.encode(proxyInit({ IDL }), [[]]), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    for (let i = 0; i < 3; i++) await pic.tick();
    expect(await proxy.get_allowlist()).toEqual(before.allowlist);
    expect(await proxy.get_canister_names()).toEqual(before.names);
    expect(await proxy.get_stats()).toEqual(before.stats);
    expect(await proxy.get_recent(5n)).toEqual(before.recent);
    const after = await proxy.get_config();
    expect(after.governance.toText()).toBe(cfg.governance.toText());
    expect(after.max_in_flight).toBe(20n);
    expect((await proxy.icrc3_log_status()).log_length).toBe(before.log);
    await verifyLog(proxy, proxyId, rootKey, (id) => actorAs(pic, archiveIdl, id, admin));
    // and still works
    const s = await pass(FN.business, payload(call(targetId, 'set_ok', nat(41))));
    expect(s.executed).toMatch(/^ok: /);
    expect((await targetState()).value).toBe(41n);
  });
});
