// sneed_attestations' timers (2026-11-01). The registry used to run a recurring tick_s (60 s) timer
// plus the ICRC-3 library's 15-minute spill timer whether or not it watched anything; each Motoko
// timer run is a few messages with a base fee each, so the idle registry burned ~2 B cycles an hour
// (~50 B a day). Now one one-shot work timer is armed only for work that is due (a watched
// proposal's next read, live checks, releases, the call budget's back-off, a full ICRC-3 live
// store) plus an hourly housekeeping run; `config.paused` arms nothing.
//
// The idle-cost test also runs against the build before the change, where it fails:
//   ATT_WASM=sneed_attestations_preidle npx vitest run tests/attestations-timers.test.js -t "idle:"
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, admin, alice, bob, T, wasm, refusedAtIngress } from '../lib/pic.js';
import { sha256 } from '../lib/icrc3.js';
import { idlFactory as attIdl } from '../build/sneed_attestations.did.js';

const ATT_WASM = process.env.ATT_WASM || 'sneed_attestations';
const PREV_WASM = 'sneed_attestations_preidle'; // main before this change (what production runs)
const KEEP = { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] };
const MIN = 60_000;
const SEC_NS = 1_000_000_000n;

const InstallMode = IDL.Variant({ install: IDL.Null, reinstall: IDL.Null, upgrade: IDL.Null });
const snsIdl = ({ IDL }) => IDL.Service({
  put_upgrade: IDL.Func([IDL.Nat64, IDL.Principal, IDL.Vec(IDL.Nat8), IDL.Opt(IDL.Vec(IDL.Nat8)), IDL.Bool], [], []),
  execute_upgrade: IDL.Func([IDL.Nat64, IDL.Vec(IDL.Nat8)], [IDL.Opt(IDL.Text)], []),
  install: IDL.Func([IDL.Principal, IDL.Vec(IDL.Nat8), InstallMode], [IDL.Opt(IDL.Text)], []),
  calls: IDL.Func([], [IDL.Record({ proposals: IDL.Nat, functions: IDL.Nat })], ['query']),
});
const snswIdl = ({ IDL }) => IDL.Service({ set_deployed_snses: IDL.Func([IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Principal))], [], []) });

const V1 = wasm('MockAttTarget');
const H1 = new Uint8Array(sha256(V1));
const cfgKeys = ['paused', 'tick_s', 'max_in_flight', 'max_calls_per_tick', 'calls_per_hour_per_dao', 'max_backoff_s', 'poll_open_s', 'poll_executing_s',
  'max_watch_s', 'max_read_failures', 'max_subjects', 'max_attestations', 'max_builders_per_subject', 'max_versions_per_builder', 'max_steps', 'max_asset_entries',
  'max_asset_pages', 'max_known_builders', 'max_known_lists', 'min_cycles', 'sns_wasm', 'archive_controllers'];
const cfg = (over = {}) => Object.fromEntries(cfgKeys.map((k) => [k, k in over ? [over[k]] : []]));
const ok = (r) => { if ('ok' in r) return r.ok; throw new Error(`expected ok, got ${JSON.stringify(r, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`); };
const nowNs = async (pic) => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const M = (c) => `${(Number(c) / 1e6).toFixed(1)} M`;

/// The registry (`name`), a mock SNS governance and SNS-W, and a target canister the governance controls.
async function world(pic, appSubnet, name) {
  const on = { targetSubnetId: appSubnet, cycles: 20n * T };
  const attId = await install(pic, { name, ...on });
  const snsId = await install(pic, { name: 'MockAttSnsGov', ...on });
  const snswId = await install(pic, { name: 'MockSnsWasm', ...on });
  await actorAs(pic, snswIdl, snswId, admin).set_deployed_snses([]);
  const att = actorAs(pic, attIdl, attId, admin);
  const sns = actorAs(pic, snsIdl, snsId, admin);
  ok(await att.admin_set_config(cfg({ poll_open_s: 600n, poll_executing_s: 60n, sns_wasm: snswId })));
  const target = await pic.createCanister({ sender: admin, cycles: 2n * T, controllers: [snsId, admin], targetSubnetId: appSubnet });
  await pic.installCode({ sender: admin, canisterId: target, wasm: V1, arg: IDL.encode([], []) });
  const attest = (id, who = alice) => actorAs(pic, attIdl, attId, who).attest({
    subject: { proposal: { governance: snsId, proposal_id: BigInt(id), step: 0n } },
    artifact: { wasm: { target, proposed_sha256: H1, built_raw_sha256: H1, built_gz_sha256: [], embedded: [], upgrade_arg_sha256: [] } },
    source: { repo: 'https://github.com/Snassy-icp/app_sneeddao', commit: 'ab'.repeat(20), recipe: 'tools/release-build.sh', environment: [] },
    verdict: { match: null },
    log_url: [],
  });
  const status = async (id) => (await att.get_proposal_status(snsId, BigInt(id)))[0];
  const propose = (id) => sns.put_upgrade(BigInt(id), target, H1, [], false);
  return { attId, att, snsId, sns, target, attest, status, propose };
}

/// Cycles burned in one hour of one-minute steps (each step: time moves on, a few rounds run).
async function burnOneHour(pic, id) {
  const b0 = BigInt(await pic.getCyclesBalance(id));
  for (let i = 0; i < 60; i++) { await pic.advanceTime(MIN); await pic.tick(2); }
  return b0 - BigInt(await pic.getCyclesBalance(id));
}

describe('an idle registry', () => {
  let pic, w;
  beforeAll(async () => {
    let appSubnet;
    ({ pic, appSubnet } = await createPic());
    w = await world(pic, appSubnet, ATT_WASM); // nothing attested, as production since its install
    for (let i = 0; i < 5; i++) { await pic.advanceTime(MIN); await pic.tick(2); }
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('idle: burns under 300 M cycles an hour (the old 60-second timer: ~2 B)', async () => {
    const hour1 = await burnOneHour(pic, w.attId);
    const hour2 = await burnOneHour(pic, w.attId);
    console.log(`${ATT_WASM} idle: ${M(hour1)} and ${M(hour2)} cycles an hour (${(Number(hour2) * 24 / 1e9).toFixed(1)} B a day, ${(Number(hour2) * 24 * 30 / 1e12).toFixed(2)} T a month at this subnet's prices)`);
    expect(hour2).toBeLessThan(300_000_000n);
  }, 600_000);
});

describe('the work timer', () => {
  let pic, w;
  beforeAll(async () => {
    let appSubnet;
    ({ pic, appSubnet } = await createPic());
    w = await world(pic, appSubnet, ATT_WASM);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  const timer = () => w.att.get_timer_status();
  const ticks = async () => (await w.att.get_stats()).ticks;
  /// idle: no work run armed, only the hourly housekeeping
  const expectIdle = async () => {
    const t = await timer();
    expect(t.paused).toBe(false);
    expect(t.next_run_at).toEqual([]);
    const now = await nowNs(pic);
    expect(t.next_housekeeping_at[0]).toBeGreaterThan(now);
    expect(t.next_housekeeping_at[0] - now).toBeLessThanOrEqual(3_600_001_000_000n);
  };

  it('is idle with nothing watched: only the hourly housekeeping, which arms nothing; a public query', async () => {
    await expectIdle();
    const t0 = await timer();
    const n0 = await ticks();
    await pic.advanceTime(Number((t0.next_housekeeping_at[0] - (await nowNs(pic))) / 1_000_000n) + 1_000); await pic.tick(3);
    const t1 = await timer();
    expect(t1.last_housekeeping_at[0]).toBeGreaterThanOrEqual(t0.next_housekeeping_at[0]);
    expect(await ticks()).toBe(n0); // no polling run
    await expectIdle();
    const asUpdate = actorAs(pic, ({ IDL: I }) => I.Service({ get_timer_status: I.Func([], [I.Reserved], []) }), w.attId, bob);
    expect(await refusedAtIngress(asUpdate.get_timer_status())).toBe(true);
  });

  it('reads right after an attestation, then runs only when the next read is due, then goes idle when done', async () => {
    await w.propose(1);
    const n0 = await ticks();
    ok(await w.attest(1));
    await pic.advanceTime(1_000); await pic.tick(10); // the kick: a second after the attestation
    let st = await w.status(1);
    expect(st.read[0].status).toBe('open');
    expect(await ticks()).toBe(n0 + 1n);
    // armed for the next read (poll_open_s = 600 s), not every tick_s
    let t = await timer();
    expect(t.next_run_at).toEqual(st.next_check_at);
    const due = t.next_run_at[0] - (await nowNs(pic));
    expect(due).toBeGreaterThan(590n * SEC_NS);
    expect(due).toBeLessThanOrEqual(601n * SEC_NS);
    const reads = (await w.sns.calls()).proposals;
    for (let i = 0; i < 9; i++) { await pic.advanceTime(MIN); await pic.tick(2); }
    expect(await ticks()).toBe(n0 + 1n); // nine minutes: no run
    expect((await w.sns.calls()).proposals).toBe(reads);
    // the proposal executes; the next read sees it and the live check follows in the same run
    expect(await w.sns.execute_upgrade(1n, V1)).toEqual([]);
    await pic.advanceTime(MIN + 1_000); await pic.tick(10);
    st = await w.status(1);
    expect(st.read[0].status).toBe('executed');
    expect(st.steps[0].live).toEqual([{ live_match: null }]);
    expect(st.watch).toEqual({ done: null });
    expect(await ticks()).toBe(n0 + 2n);
    await expectIdle();
    for (let i = 0; i < 30; i++) { await pic.advanceTime(MIN); await pic.tick(2); }
    expect(await ticks()).toBe(n0 + 2n);
  });

  it('paused: nothing is armed and nothing is read; unpaused: the waiting read runs at once', async () => {
    ok(await w.att.admin_set_config(cfg({ paused: true })));
    await w.propose(2);
    ok(await w.attest(2));
    await pic.advanceTime(1_000); await pic.tick(5);
    let t = await timer();
    expect(t.paused).toBe(true);
    expect(t.next_run_at).toEqual([]);
    expect(t.next_housekeeping_at).toHaveLength(1); // the housekeeping goes on (the log spill check)
    const reads = (await w.sns.calls()).proposals;
    for (let i = 0; i < 3; i++) { await pic.advanceTime(30 * MIN); await pic.tick(3); }
    expect((await w.sns.calls()).proposals).toBe(reads);
    expect((await w.status(2)).read).toEqual([]);
    ok(await w.att.admin_set_config(cfg({ paused: false })));
    await pic.tick(10);
    expect((await w.status(2)).read[0].status).toBe('open');
    t = await timer();
    expect(t.next_run_at).toEqual((await w.status(2)).next_check_at);
  });

  it('a DAO over its call budget: the next run waits for the back-off, not every tick_s', async () => {
    ok(await w.att.admin_set_config(cfg({ calls_per_hour_per_dao: 1n })));
    for (const id of [3, 4]) { await w.propose(id); ok(await w.attest(id)); }
    await pic.advanceTime(1_000); await pic.tick(10);
    const d = (await w.att.get_call_budget()).daos.find((x) => x.governance.toText() === w.snsId.toText());
    expect(d.backoff_until).toHaveLength(1);
    const t = await timer();
    expect(t.next_run_at[0]).toBeGreaterThanOrEqual(d.backoff_until[0]);
    const n0 = await ticks();
    for (let i = 0; i < 20; i++) { await pic.advanceTime(MIN); await pic.tick(2); }
    expect(await ticks()).toBe(n0); // twenty minutes into the back-off: no run
    ok(await w.att.admin_set_config(cfg({ calls_per_hour_per_dao: 60n })));
  });
});

describe('upgrade with keep from the build before (production)', () => {
  let pic, w;
  beforeAll(async () => {
    let appSubnet;
    ({ pic, appSubnet } = await createPic());
    w = await world(pic, appSubnet, PREV_WASM);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('keeps the state and re-arms the timers: a watched proposal is read when due and checked live', async () => {
    await w.propose(7);
    ok(await w.attest(7));
    await pic.advanceTime(5_000); await pic.tick(10); // the old kick: a 1-second timer
    const before = { stats: await w.att.get_stats(), st: await w.status(7), config: await w.att.get_config(), log: (await w.att.icrc3_log_status()).log_length };
    expect(before.st.read[0].status).toBe('open');
    expect(before.st.watch).toEqual({ watching: null });
    await pic.upgradeCanister({ sender: admin, canisterId: w.attId, wasm: wasm('sneed_attestations'), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    await pic.tick(3);
    const after = await w.att.get_stats();
    expect({ ...after, cycles: 0n }).toEqual({ ...before.stats, cycles: 0n });
    expect(await w.status(7)).toEqual(before.st);
    expect(await w.att.get_config()).toEqual(before.config);
    expect((await w.att.icrc3_log_status()).log_length).toBe(before.log);
    // the timers run again: armed for the proposal's next read
    const t = await w.att.get_timer_status();
    expect(t.next_run_at).toEqual(before.st.next_check_at);
    expect(t.next_housekeeping_at).toHaveLength(1);
    expect(await w.sns.execute_upgrade(7n, V1)).toEqual([]);
    await pic.advanceTime(Number((t.next_run_at[0] - (await nowNs(pic))) / 1_000_000n) + 1_000); await pic.tick(10);
    const st = await w.status(7);
    expect(st.read[0].status).toBe('executed');
    expect(st.steps[0].live).toEqual([{ live_match: null }]);
    expect(st.watch).toEqual({ done: null });
    expect((await w.att.get_timer_status()).next_run_at).toEqual([]);
    // and a new attestation is read at once
    await w.propose(8);
    ok(await w.attest(8, bob));
    await pic.advanceTime(1_000); await pic.tick(10);
    expect((await w.status(8)).read[0].status).toBe('open');
  });
});
