// sneed_attestations (spec/proposal_attestations.md v3): the proposal attestation registry.
// Builders attest what they rebuilt per proposal step (or release); the registry reads the proposal
// through its adapters, checks the live module with canister_info after a real install in PocketIC,
// and computes the asset tree hash of frontend steps.
//
// Mocks: canisters/MockAttSnsGov.mo (SNS governance: get_proposal, list_nervous_system_functions,
// installs into canisters it controls; a second instance plays SNS root), canisters/MockAttOhShii.mo
// (ONS/SONS with OhShii's planned get_proposal_upgrade_steps, snapshot restores),
// canisters/MockAttAssets.mo (an asset canister's list, paged or not), canisters/MockSnsWasm.mo
// (SNS-W's list_deployed_snses, for the SNS root), canisters/MockAttTarget*.mo (modules to install).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { gzipSync } from 'node:zlib';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, T, wasm, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { verifyLog, archiveIdl, btype, txField, sha256 } from '../lib/icrc3.js';
import { idlFactory as attIdl } from '../build/sneed_attestations.did.js';

// ---- IDLs of the mocks ----
const InstallMode = IDL.Variant({ install: IDL.Null, reinstall: IDL.Null, upgrade: IDL.Null });
const snsIdl = ({ IDL }) => IDL.Service({
  put_upgrade: IDL.Func([IDL.Nat64, IDL.Principal, IDL.Vec(IDL.Nat8), IDL.Opt(IDL.Vec(IDL.Nat8)), IDL.Bool], [], []),
  put_gnsf: IDL.Func([IDL.Nat64, IDL.Nat64, IDL.Vec(IDL.Nat8)], [], []),
  put_motion: IDL.Func([IDL.Nat64], [], []),
  add_function: IDL.Func([IDL.Nat64, IDL.Principal, IDL.Text], [], []),
  set_state: IDL.Func([IDL.Nat64, IDL.Nat64, IDL.Nat64, IDL.Nat64, IDL.Opt(IDL.Text)], [], []),
  set_deadline: IDL.Func([IDL.Nat64, IDL.Nat64], [], []),
  install: IDL.Func([IDL.Principal, IDL.Vec(IDL.Nat8), InstallMode], [IDL.Opt(IDL.Text)], []),
  execute_upgrade: IDL.Func([IDL.Nat64, IDL.Vec(IDL.Nat8)], [IDL.Opt(IDL.Text)], []),
  call_raw: IDL.Func([IDL.Principal, IDL.Text, IDL.Vec(IDL.Nat8)], [IDL.Variant({ ok: IDL.Vec(IDL.Nat8), err: IDL.Text })], []),
  calls: IDL.Func([], [IDL.Record({ proposals: IDL.Nat, functions: IDL.Nat })], ['query']),
});
const OhArtifact = IDL.Variant({
  wasm: IDL.Record({ module_hash: IDL.Vec(IDL.Nat8), size_bytes: IDL.Nat64, chunked: IDL.Bool, upgrade_arg_sha256: IDL.Opt(IDL.Vec(IDL.Nat8)) }),
  asset_batch: IDL.Record({ batch_id: IDL.Nat, evidence: IDL.Vec(IDL.Nat8) }),
  snapshot_restore: IDL.Record({ snapshot_id: IDL.Vec(IDL.Nat8) }),
});
const OhExecution = IDL.Variant({
  pending: IDL.Null, not_executed: IDL.Null, in_progress: IDL.Null, executed: IDL.Nat64, skipped: IDL.Nat64,
  failed: IDL.Record({ at: IDL.Nat64, error: IDL.Text }),
});
const OhStep = IDL.Record({
  index: IDL.Nat32, target: IDL.Principal, is_self: IDL.Bool, role: IDL.Opt(IDL.Text), artifact: OhArtifact,
  source: IDL.Record({ git_repo_url: IDL.Text, git_commit_hash: IDL.Text, build_instructions: IDL.Text, truncated: IDL.Bool }),
  execution: OhExecution, staged_at: IDL.Nat64,
});
const OhSteps = IDL.Record({ proposal_id: IDL.Nat64, kind: IDL.Text, status: IDL.Text, executed_at: IDL.Opt(IDL.Nat64), steps: IDL.Vec(OhStep) });
const ohIdl = ({ IDL }) => IDL.Service({
  set_steps: IDL.Func([IDL.Nat64, IDL.Opt(OhSteps)], [], []),
  set_missing_method: IDL.Func([IDL.Bool], [], []),
  install: IDL.Func([IDL.Principal, IDL.Vec(IDL.Nat8), InstallMode], [IDL.Opt(IDL.Text)], []),
  snapshot_cycle: IDL.Func([IDL.Principal, IDL.Vec(IDL.Nat8)], [IDL.Variant({ ok: IDL.Vec(IDL.Nat8), err: IDL.Text })], []),
  calls: IDL.Func([], [IDL.Nat], ['query']),
});
const AssetEnc = IDL.Record({ content_encoding: IDL.Text, sha256: IDL.Opt(IDL.Vec(IDL.Nat8)), length: IDL.Nat, modified: IDL.Int });
const Asset = IDL.Record({ key: IDL.Text, content_type: IDL.Text, encodings: IDL.Vec(AssetEnc) });
const assetsIdl = ({ IDL }) => IDL.Service({
  set_assets: IDL.Func([IDL.Vec(Asset), IDL.Nat, IDL.Bool], [], []),
  calls: IDL.Func([], [IDL.Nat], ['query']),
});
const snswIdl = ({ IDL }) => IDL.Service({ set_deployed_snses: IDL.Func([IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Principal))], [], []) });

// ---- the registry's own types ----
const attSvc = attIdl({ IDL });
const argTypes = (m) => attSvc._fields.find(([n]) => n === m)[1].argTypes;
const KnownArgsT = argTypes('set_known_builders');

let pic, rootKey, appSubnet;
let attId, att, attAlice, attBob, attCarol, attAnon;
let snsId, sns, rootId, root, ohId, oh, assetsId, assets, snswId;
const V1 = wasm('MockAttTarget');
const V2 = wasm('MockAttTargetV2');
const V1gz = gzipSync(V1, { level: 9 });
const h = (b) => new Uint8Array(sha256(b));
const hex = (b) => Buffer.from(b).toString('hex');
const H = { v1: h(V1), v2: h(V2), v1gz: h(V1gz) };
const fake = (n) => new Uint8Array(32).fill(n);
const nowS = async () => BigInt(Math.floor((await pic.getTime()) / 1000));

const cfg = (over = {}) => {
  const keys = ['paused', 'tick_s', 'max_in_flight', 'max_calls_per_tick', 'calls_per_hour_per_dao', 'max_backoff_s', 'poll_open_s', 'poll_executing_s',
    'max_watch_s', 'max_read_failures', 'max_subjects', 'max_attestations', 'max_builders_per_subject', 'max_versions_per_builder', 'max_steps', 'max_asset_entries',
    'max_asset_pages', 'max_known_builders', 'max_known_lists', 'min_cycles', 'sns_wasm', 'archive_controllers'];
  return Object.fromEntries(keys.map((k) => [k, k in over ? [over[k]] : []]));
};
const src = (over = {}) => ({ repo: 'https://github.com/Snassy-icp/app_sneeddao', commit: 'ab'.repeat(20), recipe: 'tools/release-build.sh --commit abab sneed_x', environment: [], ...over });
const pSubject = (governance, id, step = 0) => ({ proposal: { governance, proposal_id: BigInt(id), step: BigInt(step) } });
const wasmArt = (target, proposed, raw, gz = null, over = {}) => ({ wasm: { target, proposed_sha256: proposed, built_raw_sha256: raw, built_gz_sha256: gz ? [gz] : [], embedded: [], upgrade_arg_sha256: [], ...over } });
const attestInput = (subject, artifact, verdict = { match: null }, over = {}) => ({ subject, artifact, source: src(), verdict, log_url: [], ...over });
const ok = (r) => { if ('ok' in r) return r.ok; throw new Error(`expected ok, got ${JSON.stringify(r, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`); };
const status = async (gov, id) => (await att.get_proposal_status(gov, BigInt(id)))[0];

/// A value of any Candid type (the smallest one), to call a method with (as in ingress-guard.test.js).
function defaultOf(t) {
  switch (t.constructor.name) {
    case 'NatClass': case 'IntClass': return 0n;
    case 'FixedNatClass': case 'FixedIntClass': return t._bits > 32 ? 0n : 0;
    case 'TextClass': return '';
    case 'BoolClass': return false;
    case 'NullClass': case 'ReservedClass': return null;
    case 'PrincipalClass': case 'ServiceClass': return Principal.anonymous();
    case 'OptClass': return [];
    case 'VecClass': return t._type.constructor.name === 'FixedNatClass' && t._type._bits === 8 ? new Uint8Array() : [];
    case 'TupleClass': return t._components.map(defaultOf);
    case 'RecordClass': return Object.fromEntries(t._fields.map(([k, ft]) => [k, defaultOf(ft)]));
    case 'VariantClass': { const [k, ft] = t._fields[0]; return { [k]: defaultOf(ft) }; }
    case 'RecClass': return defaultOf(t._type);
    default: throw new Error(`no default for ${t.constructor.name}`);
  }
}

/// Let timers fire and calls settle: advance the clock, then run enough rounds for a few
/// sequential batches of inter-canister calls.
async function settle(seconds = 11, rounds = 30) {
  await pic.advanceTime(seconds * 1000);
  await pic.tick(rounds);
}

/// A canister controlled by `controllers`, running `code` installed by the test (admin).
async function target(controllers, code = V1) {
  const id = await pic.createCanister({ sender: admin, cycles: 2n * T, controllers: [...controllers, admin], targetSubnetId: appSubnet });
  await pic.installCode({ sender: admin, canisterId: id, wasm: code, arg: IDL.encode([], []) });
  return id;
}

/// The asset tree hash, computed independently (spec: sorted lines key \t encoding \t sha256hex).
function treeHash(list, identityOnly = false) {
  const lines = [];
  for (const a of list) for (const e of a.encodings) {
    if (identityOnly && e.content_encoding !== 'identity') continue;
    lines.push(`${a.key}\t${e.content_encoding}\t${e.sha256.length ? hex(e.sha256[0]) : '-'}`);
  }
  lines.sort();
  return h(Buffer.from(lines.join('\n'), 'utf8'));
}

beforeAll(async () => {
  ({ pic, rootKey, appSubnet } = await createPic());
  const on = { targetSubnetId: appSubnet, cycles: 20n * T };
  attId = await install(pic, { name: 'sneed_attestations', ...on });
  snsId = await install(pic, { name: 'MockAttSnsGov', ...on });
  rootId = await install(pic, { name: 'MockAttSnsGov', ...on });
  ohId = await install(pic, { name: 'MockAttOhShii', ...on });
  assetsId = await install(pic, { name: 'MockAttAssets', ...on });
  snswId = await install(pic, { name: 'MockSnsWasm', ...on });
  att = actorAs(pic, attIdl, attId, admin);
  attAlice = actorAs(pic, attIdl, attId, alice);
  attBob = actorAs(pic, attIdl, attId, bob);
  attCarol = actorAs(pic, attIdl, attId, carol);
  attAnon = actorAs(pic, attIdl, attId, Principal.anonymous());
  sns = actorAs(pic, snsIdl, snsId, admin);
  root = actorAs(pic, snsIdl, rootId, admin);
  oh = actorAs(pic, ohIdl, ohId, admin);
  assets = actorAs(pic, assetsIdl, assetsId, admin);
  await actorAs(pic, snswIdl, snswId, admin).set_deployed_snses([[rootId, snsId]]);
  ok(await att.admin_set_config(cfg({ tick_s: 10n, poll_open_s: 60n, poll_executing_s: 30n, sns_wasm: snswId })));
  await relaxRateLimits();
}, 300_000);

// the tests attest far faster than a builder would; the rate-limit test sets them back
async function relaxRateLimits() {
  ok(await att.admin_set_rate_limit('attest', [{ capacity: 1000n, per_minute: 1000n }]));
  ok(await att.admin_set_rate_limit('new_subject', [{ capacity: 1000n, per_minute: 1000n }]));
}
afterAll(async () => { await pic?.tearDown(); });

describe('attest', () => {
  it('records attestations per builder; re-attesting replaces the newest and keeps the history', async () => {
    const s = pSubject(snsId, 900);
    const a1 = ok(await attAlice.attest(attestInput(s, wasmArt(snsId, fake(1), fake(2)))));
    expect(a1.id).toBe(0n);
    const a2 = ok(await attAlice.attest(attestInput(s, wasmArt(snsId, fake(1), fake(2)), { match: null }, { source: src({ recipe: 'fixed recipe' }) })));
    ok(await attBob.attest(attestInput(s, wasmArt(snsId, fake(1), fake(3)), { mismatch: null })));
    ok(await attCarol.attest(attestInput(s, wasmArt(snsId, fake(1), fake(3)), { cannot_verify: 'no build env' })));
    const views = await att.get_attestations(s);
    expect(views).toHaveLength(3);
    const mine = views.find((v) => v.attestation.builder.toText() === alice.toText());
    expect(mine.versions).toBe(2n);
    expect(mine.attestation.source.recipe).toBe('fixed recipe');
    expect(mine.attestation.id).toBe(a2.id);
    expect(mine.known_builder).toBe(false);
    const hist = await att.get_attestation_history(s, alice);
    expect(hist.map((x) => x.source.recipe)).toEqual(['tools/release-build.sh --commit abab sneed_x', 'fixed recipe']);
    // the proposal is watched from the first attestation on
    const st = await status(snsId, 900);
    expect(st.watch).toEqual({ watching: null });
    expect(st.steps[0].builders_match).toBe(1n);
    expect(st.steps[0].builders_mismatch).toBe(1n);
    expect(st.steps[0].builders_cannot).toBe(1n);
    expect(st.steps[0].proposed_disagree).toBe(false);
  });

  it('refuses bad input: anonymous callers, wrong hash sizes, long texts, inconsistent releases', async () => {
    const s = pSubject(snsId, 901);
    expect(await refusedAtIngress(attAnon.attest(attestInput(s, wasmArt(snsId, fake(1), fake(2)))))).toBe(true);
    expect((await attAlice.attest(attestInput(s, wasmArt(snsId, new Uint8Array(31), fake(2))))).err).toMatch(/32 bytes/);
    expect((await attAlice.attest({ ...attestInput(s, wasmArt(snsId, fake(1), fake(2))), source: src({ recipe: 'x'.repeat(2001) }) })).err).toMatch(/recipe/);
    expect((await attAlice.attest(attestInput(pSubject(snsId, 901, 50), wasmArt(snsId, fake(1), fake(2))))).err).toMatch(/step must be below 50/);
    const rel = { release: { target: snsId, module_hash: fake(9) } };
    expect((await attAlice.attest(attestInput(rel, wasmArt(snsId, fake(8), fake(2))))).err).toMatch(/release's module_hash/);
    expect((await attAlice.attest(attestInput(rel, wasmArt(rootId, fake(9), fake(2))))).err).toMatch(/release's target/);
    // an oversized argument never reaches the method
    expect(await refusedAtIngress(attAlice.attest({ ...attestInput(s, wasmArt(snsId, fake(1), fake(2))), log_url: ['x'.repeat(40_000)] }))).toBe(true);
    expect(await att.get_attestations(s)).toHaveLength(0);
  });
});

describe('SNS governance adapter and live checks after real installs', () => {
  let t1, t2, t3, t4;
  beforeAll(async () => {
    t1 = await target([snsId]);
    t2 = await target([rootId]);
    t3 = await target([snsId]);
    t4 = await target([snsId]);
  });

  it('reads an upgrade proposal, then after execution checks the live module: match, installed by governance', async () => {
    await sns.put_upgrade(1n, t1, H.v1gz, [new Uint8Array([1, 2, 3])], false);
    ok(await attAlice.attest(attestInput(pSubject(snsId, 1), wasmArt(t1, H.v1gz, H.v1, H.v1gz))));
    ok(await attBob.attest(attestInput(pSubject(snsId, 1), wasmArt(t1, H.v1gz, fake(5), fake(6)), { mismatch: null })));
    await settle();
    let st = await status(snsId, 1);
    expect(st.kind).toEqual([{ sns: null }]); // probed: no get_proposal_upgrade_steps, then get_proposal answered
    expect(st.read[0].status).toBe('open');
    const p = st.steps[0].proposed[0];
    expect(p.target[0].toText()).toBe(t1.toText());
    expect(hex(p.artifact.wasm.module_hash[0])).toBe(hex(H.v1gz)); // from payload_text_rendering
    expect(hex(p.artifact.wasm.upgrade_arg_sha256[0])).toBe(hex(h(new Uint8Array([1, 2, 3]))));
    expect(st.steps[0].live_check).toEqual([]);
    const views = await att.get_attestations(pSubject(snsId, 1));
    expect(views.every((v) => v.proposal_agrees[0] === true && v.target_agrees[0] === true)).toBe(true);

    // governance installs the gzipped module, then the registry sees it executed and checks promptly
    expect(await sns.execute_upgrade(1n, V1gz)).toEqual([]);
    await settle(61);
    st = await status(snsId, 1);
    expect(st.read[0].status).toBe('executed');
    const s0 = st.steps[0];
    expect(s0.live).toEqual([{ live_match: null }]);
    const c = s0.live_check[0];
    expect(hex(c.module_hash[0])).toBe(hex(H.v1gz));
    expect(c.installed_by[0].principal.toText()).toBe(snsId.toText());
    expect(c.installed_by[0].role).toEqual({ governance: null });
    expect(s0.installed_by[0].toText()).toBe(snsId.toText());
    expect(s0.builders_live_agree).toBe(1n); // alice's gz hash is live
    expect(s0.builders_live_disagree).toBe(1n); // bob's isn't
    expect(st.watch).toEqual({ done: null });
    const v = await att.get_attestations(pSubject(snsId, 1));
    expect(v.find((x) => x.attestation.builder.toText() === alice.toText()).live_agrees).toEqual([true]);
    expect(v.find((x) => x.attestation.builder.toText() === bob.toText()).live_agrees).toEqual([false]);
    // done: no more reads
    const before = (await sns.calls()).proposals;
    await settle(120);
    expect((await sns.calls()).proposals).toBe(before);
  });

  it('shows an install by the SNS root as such (root learned from SNS-W), and one by a user', async () => {
    // root installs the module (as for every SNS dapp canister); governance marks the proposal executed
    await sns.put_upgrade(2n, t2, H.v2, [], true); // chunked: the hash comes from wasm_module_hash
    ok(await attAlice.attest(attestInput(pSubject(snsId, 2), wasmArt(t2, H.v2, H.v2))));
    await settle();
    expect(await root.install(t2, V2, { upgrade: null })).toEqual([]);
    await sns.set_state(2n, await nowS(), await nowS(), 0n, []);
    await settle(61);
    let c = (await status(snsId, 2)).steps[0].live_check[0];
    expect(c.result).toEqual({ live_match: null });
    expect(c.installed_by[0].principal.toText()).toBe(rootId.toText());
    expect(c.installed_by[0].role).toEqual({ dao_root: null });
    expect((await att.get_call_budget()).daos.find((d) => d.governance.toText() === snsId.toText()).sns_root[0].toText()).toBe(rootId.toText());

    // someone installs it directly (from a user principal): the right module, but not by the DAO
    await sns.put_upgrade(3n, t3, H.v2, [], false);
    ok(await attAlice.attest(attestInput(pSubject(snsId, 3), wasmArt(t3, H.v2, H.v2))));
    await settle();
    await pic.upgradeCanister({ sender: admin, canisterId: t3, wasm: V2, arg: IDL.encode([], []) });
    await sns.set_state(3n, await nowS(), await nowS(), 0n, []);
    await settle(61);
    c = (await status(snsId, 3)).steps[0].live_check[0];
    expect(c.result).toEqual({ live_match: null });
    expect(c.installed_by[0].principal.toText()).toBe(admin.toText());
    expect(c.installed_by[0].role).toEqual({ user: null });
  });

  it('live mismatch: the proposed module was installed, then replaced', async () => {
    await sns.put_upgrade(4n, t4, H.v2, [], false);
    ok(await attAlice.attest(attestInput(pSubject(snsId, 4), wasmArt(t4, H.v2, H.v2))));
    await settle();
    expect(await sns.execute_upgrade(4n, V2)).toEqual([]);
    await pic.upgradeCanister({ sender: admin, canisterId: t4, wasm: V1, arg: IDL.encode([], []) });
    await settle(61);
    const s0 = (await status(snsId, 4)).steps[0];
    expect(s0.live[0].live_mismatch).toMatch(/was installed, then replaced: the live module is .*last changed by user/);
    expect(s0.live_check[0].installed_by[0].role).toEqual({ governance: null }); // who installed the proposed one
    expect(s0.builders_live_disagree).toBe(1n);
  });

  it('a failed proposal: no live check, the governance error is shown', async () => {
    await sns.put_upgrade(5n, t4, H.v1, [], false);
    ok(await attAlice.attest(attestInput(pSubject(snsId, 5), wasmArt(t4, H.v1, H.v1))));
    await settle();
    await sns.set_state(5n, await nowS(), 0n, await nowS(), ['Canister upgrade failed: trapped in post_upgrade']);
    await settle(61);
    const st = await status(snsId, 5);
    expect(st.read[0].status).toBe('failed');
    expect(st.steps[0].proposed[0].execution.failed.error).toMatch(/trapped/);
    expect(st.steps[0].live_check[0].result.not_checked).toMatch(/the step failed: Canister upgrade failed/);
    expect(st.watch).toEqual({ done: null });
  });

  it('a motion is not an upgrade proposal: recorded, then no longer watched', async () => {
    await sns.put_motion(8n);
    ok(await attAlice.attest(attestInput(pSubject(snsId, 8), wasmArt(t4, H.v1, H.v1))));
    await settle();
    const st = await status(snsId, 8);
    expect(st.watch.stopped).toMatch(/not an upgrade proposal \(action 1\)/);
    expect(st.read[0].steps).toHaveLength(0);
    // a proposal governance doesn't have: a definitive answer, not retried
    ok(await attAlice.attest(attestInput(pSubject(snsId, 99), wasmArt(t4, H.v1, H.v1))));
    await settle();
    const st99 = await status(snsId, 99);
    expect(st99.watch.stopped).toMatch(/governance answered: No proposal for given ProposalId/);
    expect(st99.read_error[0]).toMatch(/^cannot read proposal: get_proposal: No proposal/);
  });

  it('frontend step (GNSF commit_proposed_batch): batch and evidence from the payload, tree hash from list after execution', async () => {
    await sns.add_function(7000n, assetsId, 'commit_proposed_batch');
    const evidence = fake(7);
    await sns.put_gnsf(6n, 7000n, new Uint8Array(IDL.encode([IDL.Record({ batch_id: IDL.Nat, evidence: IDL.Vec(IDL.Nat8) })], [{ batch_id: 5n, evidence }])));
    const list = [
      { key: '/index.html', content_type: 'text/html', encodings: [{ content_encoding: 'identity', sha256: [fake(11)], length: 10n, modified: 1n }, { content_encoding: 'gzip', sha256: [fake(12)], length: 5n, modified: 1n }] },
      { key: '/app.js', content_type: 'text/javascript', encodings: [{ content_encoding: 'identity', sha256: [fake(13)], length: 10n, modified: 1n }] },
      { key: '/a.css', content_type: 'text/css', encodings: [{ content_encoding: 'identity', sha256: [], length: 3n, modified: 1n }] },
      { key: '/img/logo.png', content_type: 'image/png', encodings: [{ content_encoding: 'identity', sha256: [fake(14)], length: 9n, modified: 1n }] },
      { key: '/zz.txt', content_type: 'text/plain', encodings: [{ content_encoding: 'identity', sha256: [fake(15)], length: 1n, modified: 1n }] },
    ];
    await assets.set_assets(list, 2n, false);
    const tree = treeHash(list);
    const idTree = treeHash(list, true);
    const batch = (t) => ({ asset_batch: { target: assetsId, batch_id: 5n, proposed_evidence: evidence, built_evidence: [evidence], tree_sha256: t } });
    ok(await attAlice.attest(attestInput(pSubject(snsId, 6), batch(tree))));
    ok(await attBob.attest(attestInput(pSubject(snsId, 6), batch(fake(99)))));
    ok(await attCarol.attest(attestInput(pSubject(snsId, 6), batch(idTree))));
    await settle();
    let st = await status(snsId, 6);
    expect(st.read[0].proposal_kind[0]).toBe('ExecuteGenericNervousSystemFunction 7000 (commit_proposed_batch)');
    const p = st.steps[0].proposed[0];
    expect(p.target[0].toText()).toBe(assetsId.toText());
    expect(p.artifact.asset_batch.batch_id).toEqual([5n]);
    expect(hex(p.artifact.asset_batch.evidence[0])).toBe(hex(evidence));
    expect((await sns.calls()).functions).toBe(1n);
    expect((await att.get_attestations(pSubject(snsId, 6))).every((v) => v.proposal_agrees[0] === true)).toBe(true);

    await sns.set_state(6n, await nowS(), await nowS(), 0n, []);
    const listCalls = await assets.calls();
    await settle(61);
    st = await status(snsId, 6);
    const r = st.steps[0].live_check[0].result.asset_tree;
    expect(hex(r.tree_sha256)).toBe(hex(tree));
    expect(hex(r.identity_tree_sha256)).toBe(hex(idTree));
    expect(r.assets).toBe(5n);
    expect(r.encodings).toBe(6n);
    expect((await assets.calls()) - listCalls).toBe(4n); // pages of 2: 2 + 2 + 1, then an empty page
    expect(st.steps[0].builders_live_agree).toBe(2n); // alice (all encodings) and carol (identity only)
    expect(st.steps[0].builders_live_disagree).toBe(1n);
    const v = await att.get_attestations(pSubject(snsId, 6));
    expect(v.find((x) => x.attestation.builder.toText() === bob.toText()).live_agrees).toEqual([false]);
    expect(await att.get_tree_hash_format()).toMatch(/sorted by code point/);

    // an asset canister that doesn't page: the second page starts over, so the first one was all
    await sns.put_gnsf(7n, 7000n, new Uint8Array(IDL.encode([IDL.Record({ batch_id: IDL.Nat, evidence: IDL.Vec(IDL.Nat8) })], [{ batch_id: 6n, evidence }])));
    await assets.set_assets(list, 2n, true);
    ok(await attAlice.attest(attestInput(pSubject(snsId, 7), { asset_batch: { target: assetsId, batch_id: 6n, proposed_evidence: evidence, built_evidence: [], tree_sha256: tree } })));
    await settle();
    await sns.set_state(7n, await nowS(), await nowS(), 0n, []);
    await settle(61);
    const r7 = (await status(snsId, 7)).steps[0].live_check[0].result.asset_tree;
    expect(hex(r7.tree_sha256)).toBe(hex(tree));
    expect(r7.assets).toBe(5n);
  });
});

describe('OhShii adapter (planned get_proposal_upgrade_steps)', () => {
  let ta, tb, tc, td, snapId;
  const step = (index, tgt, artifact, execution) => ({
    index, target: tgt, is_self: false, role: [], artifact, execution, staged_at: 1n,
    source: { git_repo_url: 'https://example.org/ohshii', git_commit_hash: 'cd'.repeat(20), build_instructions: 'verify-proposal.sh', truncated: false },
  });
  const wasmA = (hash) => ({ wasm: { module_hash: hash, size_bytes: 1000n, chunked: false, upgrade_arg_sha256: [] } });

  beforeAll(async () => {
    ta = await target([ohId]);
    tb = await target([ohId]);
    tc = await target([ohId]);
    td = await target([ohId]);
    // tb already runs V1, installed by governance earlier (the step will be skipped)
    expect(await oh.install(tb, V1, { upgrade: null })).toEqual([]);
  });

  it('multi-step proposal: executed, skipped, failed and snapshot-restore steps', async () => {
    const pending = { pending: null };
    const steps = (exec) => [
      step(0, ta, wasmA(H.v2), exec[0]),
      step(1, tb, wasmA(H.v1), exec[1]),
      step(2, tc, wasmA(H.v2), exec[2]),
      step(3, td, { snapshot_restore: { snapshot_id: new Uint8Array([0]) } }, exec[3]),
    ];
    await oh.set_steps(10n, [{ proposal_id: 10n, kind: 'UpgradeFleet', status: 'open', executed_at: [], steps: steps([pending, pending, pending, pending]) }]);
    ok(await attAlice.attest(attestInput(pSubject(ohId, 10, 0), wasmArt(ta, H.v2, H.v2))));
    ok(await attAlice.attest(attestInput(pSubject(ohId, 10, 1), wasmArt(tb, H.v1, H.v1))));
    ok(await attBob.attest(attestInput(pSubject(ohId, 10, 2), wasmArt(tc, H.v2, H.v2))));
    await settle();
    let st = await status(ohId, 10);
    expect(st.kind).toEqual([{ ohshii: null }]);
    expect(st.read[0].steps).toHaveLength(4);
    expect(st.read[0].steps.map((s) => s.index)).toEqual([0n, 1n, 2n, 3n]); // index sent as nat32: position used
    expect(st.read[0].steps[0].source[0].commit).toEqual(['cd'.repeat(20)]);
    expect(st.read[0].proposal_kind).toEqual(['UpgradeFleet']);
    expect(st.steps.map((s) => s.step)).toEqual([0n, 1n, 2n, 3n]);

    // governance executes: installs V2 into ta, skips tb, fails tc, restores a snapshot on td
    expect(await oh.install(ta, V2, { upgrade: null })).toEqual([]);
    const snap = await oh.snapshot_cycle(td, V2);
    expect(snap).toHaveProperty('ok');
    snapId = snap.ok;
    const t = BigInt(Math.floor(await pic.getTime())) * 1_000_000n;
    const exec = [{ executed: t }, { skipped: t }, { failed: { at: t, error: 'install_code trapped' } }, { executed: t }];
    await oh.set_steps(10n, [{ proposal_id: 10n, kind: 'UpgradeFleet', status: 'executed', executed_at: [t], steps: steps(exec).map((s, i) => (i === 3 ? { ...s, artifact: { snapshot_restore: { snapshot_id: snapId } } } : s)) }]);
    await settle(61);
    st = await status(ohId, 10);
    const [s0, s1, s2, s3] = st.steps;
    expect(s0.live).toEqual([{ live_match: null }]);
    expect(s0.live_check[0].installed_by[0].principal.toText()).toBe(ohId.toText());
    expect(s0.live_check[0].installed_by[0].role).toEqual({ governance: null });
    // skipped: live, and the installer is the earlier install that put the module there
    expect(s1.live).toEqual([{ live_match: null }]);
    expect(s1.live_check[0].skipped).toBe(true);
    expect(s1.live_check[0].installed_by[0].role).toEqual({ governance: null });
    expect(s2.live).toEqual([]);
    expect(s2.live_check[0].result.not_checked).toMatch(/the step failed: install_code trapped/);
    // snapshot restore: nothing proposed to rebuild, but the module before and after is shown
    const r3 = s3.live_check[0].result.snapshot_restored;
    expect(hex(r3.before[0])).toBe(hex(H.v2));
    expect(hex(r3.after[0])).toBe(hex(H.v1));
    expect(hex(r3.snapshot_id[0])).toBe(hex(snapId));
    expect(s3.attested_by).toBe(0n);
    expect(st.watch).toEqual({ done: null });
  });

  it('an older module without the method: "cannot read proposal", given up after max_read_failures', async () => {
    ok(await att.admin_set_config(cfg({ max_read_failures: 2n })));
    const oldOh = await install(pic, { name: 'MockAttOhShii', targetSubnetId: appSubnet, cycles: 5n * T });
    await actorAs(pic, ohIdl, oldOh, admin).set_missing_method(true);
    ok(await attAlice.attest(attestInput(pSubject(oldOh, 1), wasmArt(ta, H.v2, H.v2))));
    await settle();
    let st = await status(oldOh, 1);
    expect(st.read_error[0]).toMatch(/^cannot read proposal: neither get_proposal_upgrade_steps/);
    expect(st.watch).toEqual({ watching: null });
    await settle(700);
    st = await status(oldOh, 1);
    expect(st.watch.stopped).toMatch(/cannot read proposal after 2 attempts/);
    ok(await att.admin_set_config(cfg({ max_read_failures: 5n })));
    // a controller can make it try again (e.g. after the DAO admitted the registry)
    ok(await att.admin_recheck(oldOh, 1n));
    expect((await status(oldOh, 1)).watch).toEqual({ watching: null });
  });

  it('a release (not a proposal) is checked as soon as it is attested', async () => {
    ok(await attAlice.attest(attestInput({ release: { target: ta, module_hash: H.v2 } }, wasmArt(ta, H.v2, H.v2))));
    ok(await attAlice.attest(attestInput({ release: { target: tc, module_hash: H.v2 } }, wasmArt(tc, H.v2, H.v2))));
    await settle(3);
    const r = (await att.get_release_status(ta, H.v2))[0];
    expect(r.live_check[0].result).toEqual({ live_match: null });
    expect(r.live_check[0].installed_by[0].principal.toText()).toBe(ohId.toText());
    expect(r.attestations[0].live_agrees).toEqual([true]);
    const r2 = (await att.get_release_status(tc, H.v2))[0];
    expect(r2.live_check[0].result.live_mismatch).toMatch(/is not in the last \d+ changes/);
  });
});

describe('known builders', () => {
  const payload = (builders) => new Uint8Array(IDL.encode(KnownArgsT, [{ builders }]));
  const decodeValidation = (bytes) => IDL.decode([IDL.Variant({ Ok: IDL.Text, Err: IDL.Text })], bytes)[0];

  it('only the governance canister sets its own list; the validator renders it', async () => {
    ok(await attAlice.set_builder_profile({ name: 'Alice CI', contact: [], repo: ['https://example.org/alice'], description: [] }));
    const p = payload([{ builder: alice, note: ['Sneed Verifier'] }, { builder: carol, note: [] }]);
    const v = await sns.call_raw(attId, 'validate_set_known_builders', p);
    const text = decodeValidation(v.ok).Ok;
    expect(text).toContain(`known builders of ${snsId.toText()}, 2 in all`);
    expect(text).toContain(`Add: ${alice.toText()} "Alice CI" · Sneed Verifier`);
    const r = await sns.call_raw(attId, 'set_known_builders', p);
    expect(r).toHaveProperty('ok');
    const k = (await att.get_known_builders(snsId))[0];
    expect(k.builders.map((b) => b.builder.toText())).toEqual([alice.toText(), carol.toText()]);
    // highlighting only: counts per known builder, nothing else changes
    const s0 = (await status(snsId, 6)).steps[0];
    expect(s0.known_match).toBe(2n);
    expect(s0.builders_match).toBe(3n);
    expect((await att.get_attestations(pSubject(snsId, 6))).filter((x) => x.known_builder)).toHaveLength(2);
    // a removal shows in the validator
    const v2 = decodeValidation((await sns.call_raw(attId, 'validate_set_known_builders', payload([{ builder: alice, note: [] }]))).ok);
    expect(v2.Ok).toContain(`Remove: ${carol.toText()}`);
    // users can't set it (refused at ingress); another canister only sets its own list
    expect(await refusedAtIngress(attAlice.set_known_builders({ builders: [{ builder: bob, note: [] }] }))).toBe(true);
    expect(await root.call_raw(attId, 'set_known_builders', payload([{ builder: bob, note: [] }]))).toHaveProperty('ok');
    expect((await att.get_known_builders(snsId))[0].builders).toHaveLength(2);
    expect((await att.get_known_builders(rootId))[0].builders.map((b) => b.builder.toText())).toEqual([bob.toText()]);
    // refusals: duplicates fail validation, and the execution traps (governance marks it failed)
    const dup = payload([{ builder: bob, note: [] }, { builder: bob, note: [] }]);
    expect(decodeValidation((await sns.call_raw(attId, 'validate_set_known_builders', dup)).ok).Err).toMatch(/listed twice/);
    expect((await sns.call_raw(attId, 'set_known_builders', dup)).err).toMatch(/listed twice/);
  });
});

describe('abuse limits and the ingress guard', () => {
  it('per-builder rate limit', async () => {
    ok(await att.admin_set_rate_limit('attest', [{ capacity: 2n, per_minute: 1n }]));
    const dave = user('dave');
    const a = actorAs(pic, attIdl, attId, dave);
    ok(await a.attest(attestInput(pSubject(snsId, 950), wasmArt(snsId, fake(1), fake(2)))));
    ok(await a.attest(attestInput(pSubject(snsId, 950), wasmArt(snsId, fake(1), fake(2)))));
    // the third in the same minute: inspect refuses it before it costs anything
    expect(await refusedAtIngress(a.attest(attestInput(pSubject(snsId, 950), wasmArt(snsId, fake(1), fake(2)))))).toBe(true);
    expect(await refusedAtIngress(a.attest(attestInput(pSubject(snsId, 950), wasmArt(snsId, fake(1), fake(2)))))).toBe(true);
    // a token a minute: one more after a minute
    await pic.advanceTime(61_000);
    await pic.tick();
    ok(await a.attest(attestInput(pSubject(snsId, 950), wasmArt(snsId, fake(1), fake(2)))));
    expect(await refusedAtIngress(a.attest(attestInput(pSubject(snsId, 950), wasmArt(snsId, fake(1), fake(2)))))).toBe(true);
    // the method checks too (inspect only runs for ingress): a new subject per minute at most
    ok(await att.admin_set_rate_limit('attest', []));
    ok(await att.admin_set_rate_limit('new_subject', []));
    const rules = Object.fromEntries(await att.get_rate_limits());
    expect(rules.attest).toEqual({ capacity: 30n, per_minute: 5n });
    expect(rules.new_subject).toEqual({ capacity: 20n, per_minute: 1n });
    expect(rules.profile).toEqual({ capacity: 5n, per_minute: 1n });
    const g = user('gina');
    const ga = actorAs(pic, attIdl, attId, g);
    for (let i = 0; i < 20; i++) ok(await ga.attest(attestInput(pSubject(user('ghost-gov'), 1000 + i), wasmArt(snsId, fake(1), fake(2)))));
    expect((await ga.attest(attestInput(pSubject(user('ghost-gov'), 1100), wasmArt(snsId, fake(1), fake(2))))).err).toMatch(/too many new subjects/);
    ok(await ga.attest(attestInput(pSubject(user('ghost-gov'), 1000), wasmArt(snsId, fake(1), fake(2))))); // an existing subject is fine
    await relaxRateLimits();
  });

  it('bounded storage: builders per subject (known builders still admitted) and versions per builder', async () => {
    ok(await att.admin_set_config(cfg({ max_builders_per_subject: 2n, max_versions_per_builder: 2n })));
    const s = pSubject(snsId, 951);
    const e = user('erin');
    const f = user('frank');
    ok(await actorAs(pic, attIdl, attId, e).attest(attestInput(s, wasmArt(snsId, fake(1), fake(2)))));
    ok(await actorAs(pic, attIdl, attId, f).attest(attestInput(s, wasmArt(snsId, fake(1), fake(2)))));
    expect((await attBob.attest(attestInput(s, wasmArt(snsId, fake(1), fake(2))))).err).toMatch(/maximum/);
    ok(await attAlice.attest(attestInput(s, wasmArt(snsId, fake(1), fake(2))))); // alice is a known builder of snsId
    for (let i = 0; i < 3; i++) ok(await attAlice.attest(attestInput(s, wasmArt(snsId, fake(1), fake(2)), { match: null }, { log_url: [`v${i}`] })));
    const hist = await att.get_attestation_history(s, alice);
    expect(hist.map((x) => x.log_url[0])).toEqual(['v1', 'v2']); // the oldest left state (still in the log)
    ok(await att.admin_set_config(cfg({ max_builders_per_subject: 64n, max_versions_per_builder: 5n })));
  });

  it('refuses every query sent as an update call, and admin calls from non-controllers', async () => {
    const queries = attSvc._fields.filter(([, f]) => f.annotations.includes('query'));
    expect(queries.length).toBeGreaterThan(20);
    const asUpd = actorAs(pic, asUpdates(attIdl), attId, alice);
    for (const [name, f] of queries) {
      expect(await refusedAtIngress(asUpd[name](...f.argTypes.map(defaultOf))), name).toBe(true);
    }
    expect(await refusedAtIngress(attAlice.admin_set_config(cfg({ paused: true })))).toBe(true);
    expect(await refusedAtIngress(attAlice.admin_run_now())).toBe(true);
    expect(await refusedAtIngress(attAlice.admin_recheck(snsId, 1n))).toBe(true);
    expect((await att.get_config()).paused).toBe(false);
  });
});

describe('per-DAO call budget', () => {
  it('caps billed calls per DAO per hour, backs off, then doubles the back-off', async () => {
    ok(await att.admin_set_config(cfg({ calls_per_hour_per_dao: 3n })));
    const g3 = await install(pic, { name: 'MockAttSnsGov', targetSubnetId: appSubnet, cycles: 5n * T });
    const gov3 = actorAs(pic, snsIdl, g3, admin);
    ok(await att.admin_set_governance_kind(g3, [{ sns: null }])); // one call per read, no probe
    // carol is a known builder of this DAO: the proposal she attested is read first
    const knownPayload = new Uint8Array(IDL.encode(KnownArgsT, [{ builders: [{ builder: carol, note: [] }] }]));
    expect(await gov3.call_raw(attId, 'set_known_builders', knownPayload)).toHaveProperty('ok');
    for (let i = 1n; i <= 6n; i++) {
      await gov3.put_upgrade(i, g3, H.v1, [], false);
      ok(await attAlice.attest(attestInput(pSubject(g3, i), wasmArt(g3, H.v1, H.v1))));
    }
    ok(await attCarol.attest(attestInput(pSubject(g3, 6), wasmArt(g3, H.v1, H.v1))));
    await settle();
    expect((await gov3.calls()).proposals).toBe(3n);
    expect((await status(g3, 6)).read).toHaveLength(1);
    expect((await Promise.all([1, 2, 3, 4, 5].map((i) => status(g3, i)))).filter((x) => x.read.length).length).toBe(2);
    let d = (await att.get_call_budget()).daos.find((x) => x.governance.toText() === g3.toText());
    expect(d.calls_this_hour).toBe(3n);
    expect(d.throttled_hours).toBe(1n);
    expect(d.backoff_until).toHaveLength(1);
    expect(d.watched_proposals).toBe(6n);
    await settle(30 * 60);
    expect((await gov3.calls()).proposals).toBe(3n); // still backed off
    await settle(31 * 60);
    expect((await gov3.calls()).proposals).toBe(6n); // the next hour: three more
    d = (await att.get_call_budget()).daos.find((x) => x.governance.toText() === g3.toText());
    expect(d.throttled_hours).toBe(2n);
    const now = BigInt(Math.floor(await pic.getTime())) * 1_000_000n;
    expect(d.backoff_until[0] - now).toBeGreaterThan(90n * 60n * 1_000_000_000n); // twice as long
    await settle(65 * 60);
    expect((await gov3.calls()).proposals).toBe(6n); // an hour later: still backed off
    await settle(60 * 60);
    expect((await gov3.calls()).proposals).toBe(9n);
    const budget = await att.get_call_budget();
    expect(budget.principals).toEqual([['ic', 'a5rqn-baaaa-aaaac-bghua-cai'], ['staging', 'xrnbc-uaaaa-aaaac-qhm7a-cai']]);
    expect(budget.methods.map((m) => m.method)).toContain('get_proposal_upgrade_steps');
    expect(budget.estimate).toMatch(/Hard cap: 3 billed calls per DAO per hour/);
    // pausing stops all polling
    ok(await att.admin_set_config(cfg({ paused: true, calls_per_hour_per_dao: 60n })));
    await settle(3 * 3600);
    expect((await gov3.calls()).proposals).toBe(9n);
    ok(await att.admin_set_config(cfg({ paused: false })));
  });
});

describe('log and upgrade', () => {
  it('every attestation and live check is a block of a verifiable ICRC-3 log', async () => {
    const { blocks } = await verifyLog(att, attId, rootKey, (id) => actorAs(pic, archiveIdl, id, admin));
    const types = blocks.map(btype);
    const stats = await att.get_stats();
    expect(types.filter((t) => t === 'sneedatt_attest').length).toBe(Number(stats.attestations_ever));
    expect(types.filter((t) => t === 'sneedatt_live_check').length).toBe(Number(stats.live_checks));
    for (const t of ['sneedatt_proposal_final', 'sneedatt_known_builders', 'sneedatt_builder_profile', 'sneedatt_governance_kind', 'sneedatt_config']) expect(types, t).toContain(t);
    const live = blocks.filter((b) => btype(b) === 'sneedatt_live_check' && txField(b, 'installer_role')?.Text === 'dao_root');
    expect(live.length).toBe(1);
    expect(Principal.fromUint8Array(new Uint8Array(txField(live[0], 'installed_by').Blob)).toText()).toBe(rootId.toText());
    const supported = (await att.icrc3_supported_block_types()).map((t) => t.block_type);
    expect(new Set(types).size).toBeLessThanOrEqual(supported.length);
    // the text log explains the reads and checks
    const log = await att.get_log(0n, 500n);
    expect(log.some((e) => /Live check of step 0 of proposal 1 of/.test(e.message))).toBe(true);
    expect(log.some((e) => /Call budget of .* reached/.test(e.message))).toBe(true);
  });

  it('keeps everything across an upgrade (enhanced orthogonal persistence)', async () => {
    const before = {
      stats: await att.get_stats(),
      s1: await att.get_proposal_status(snsId, 1n),
      known: await att.get_known_builders(snsId),
      atts: await att.get_attestations(pSubject(snsId, 6)),
      log: (await att.icrc3_log_status()).log_length,
      builder: await att.get_builder(alice),
      config: await att.get_config(),
    };
    await pic.upgradeCanister({ sender: admin, canisterId: attId, wasm: wasm('sneed_attestations'), arg: IDL.encode([], []), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    for (let i = 0; i < 3; i++) await pic.tick();
    const after = await att.get_stats();
    expect({ ...after, cycles: 0n, ticks: 0n, last_tick_at: [] }).toEqual({ ...before.stats, cycles: 0n, ticks: 0n, last_tick_at: [] });
    expect(await att.get_proposal_status(snsId, 1n)).toEqual(before.s1);
    expect(await att.get_known_builders(snsId)).toEqual(before.known);
    expect(await att.get_attestations(pSubject(snsId, 6))).toEqual(before.atts);
    expect((await att.icrc3_log_status()).log_length).toBe(before.log);
    expect(await att.get_builder(alice)).toEqual(before.builder);
    expect(await att.get_config()).toEqual(before.config);
    await verifyLog(att, attId, rootKey, (id) => actorAs(pic, archiveIdl, id, admin));
    // and the timers run again: a new attestation is still checked
    const t5 = await target([snsId]);
    await sns.put_upgrade(20n, t5, H.v2, [], false);
    ok(await attAlice.attest(attestInput(pSubject(snsId, 20), wasmArt(t5, H.v2, H.v2))));
    await settle();
    expect(await sns.execute_upgrade(20n, V2)).toEqual([]);
    await settle(61);
    expect((await status(snsId, 20)).steps[0].live).toEqual([{ live_match: null }]);
  });

  it('get_api_doc is a short guide linking the full reference', async () => {
    const doc = await att.get_api_doc();
    expect(doc).toContain('https://app.sneeddao.com/api-docs/sneed_attestations.md');
  });
});
