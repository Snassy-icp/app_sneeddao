// The ICRC-3 library runs no timer while the live store has room (owner rule 2026-11-01: no
// always-on short timers; a Motoko timer firing costs tens of millions of cycles even when it
// finds nothing to do). The write that fills the store arms a one-shot spill; a spill that cannot
// finish retries with a doubling back-off; a store that was already full at upgrade time spills
// after the upgrade. Before, every logging canister ran a recurring 15-minute spill check.
//
// The idle-cost and spill-on-write tests also run against the library before the change
// (Icrc3Demo built from main at c80882bd), where they fail:
//   ICRC3_DEMO_WASM=Icrc3Demo_preidle npx vitest run tests/icrc3-spill-on-write.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, T, unwrap, wasm } from '../lib/pic.js';
import { demoIdl, demoInit } from '../lib/idl.js';
import { archiveIdl, verifyLog } from '../lib/icrc3.js';

const DEMO_WASM = process.env.ICRC3_DEMO_WASM || 'Icrc3Demo';
const EXTRA = Principal.fromText('fp274-iaaaa-aaaaq-aacha-cai');
const PERIOD = 15 * 60; // what every logging canister passes (the old timer period, now the first back-off)
const M = (n) => `${(Number(n) / 1e6).toFixed(1)} M`;

let pic, rootKey, appSubnet, govId;
const args = (cycle_reserve) => [{ extra_controller: EXTRA, cycle_reserve, timer_seconds: BigInt(PERIOD), governance: govId }];
const setup = async (cycle_reserve = 2n * T) => {
  const id = await install(pic, { name: DEMO_WASM, initTypes: demoInit, initArgs: args(cycle_reserve), cycles: 50n * T, targetSubnetId: appSubnet });
  return { id, demo: actorAs(pic, demoIdl, id, admin), demoAlice: actorAs(pic, demoIdl, id, alice) };
};
const settings = (demo, u) => demo.admin_set_icrc3_settings({
  max_live_blocks: [], spill_batch_size: [], archive_max_blocks: [],
  archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [], ...u,
});
const spillErrors = async (demo) => (await demo.logs()).filter(([, m]) => m.includes('ICRC-3 spill stopped')).length;
/// a few rounds with time moving by one second each: enough for a spill's message chain, far
/// below any timer period
const rounds = async (n = 8) => { for (let i = 0; i < n; i++) { await pic.advanceTime(1_000); await pic.tick(2); } };

beforeAll(async () => {
  ({ pic, rootKey, appSubnet } = await createPic());
  govId = await install(pic, { name: 'MockSnsGovernance' });
});
afterAll(async () => { await pic?.tearDown(); });

describe('an idle log', () => {
  it('idle: burns under 60 M cycles an hour with a store that has room (the old 15-minute timer: ~140 M)', async () => {
    const { id, demoAlice } = await setup();
    await demoAlice.record_many(5n);
    await rounds(3);
    const burn = async () => {
      const b0 = BigInt(await pic.getCyclesBalance(id));
      for (let i = 0; i < 60; i++) { await pic.advanceTime(60_000); await pic.tick(1); }
      return b0 - BigInt(await pic.getCyclesBalance(id));
    };
    const hour1 = await burn();
    const hour2 = await burn();
    console.log(`${DEMO_WASM} idle: ${M(hour1)} and ${M(hour2)} cycles an hour`);
    expect(hour1).toBeLessThan(60_000_000n);
    expect(hour2).toBeLessThan(60_000_000n);
  });
});

describe('spilling on the write that fills the store', () => {
  it('spills within seconds of the write that reaches max_live_blocks, and not before', async () => {
    const { id, demo, demoAlice } = await setup();
    unwrap(await settings(demo, { max_live_blocks: [10n], spill_batch_size: [4n], archive_max_blocks: [1000n] })); // 3 config blocks
    await demoAlice.record_many(6n); // 9 live: below the threshold
    await rounds();
    expect((await demo.icrc3_log_status()).live_blocks).toBe(9n);
    expect(await demo.icrc3_get_archives({ from: [] })).toEqual([]);
    await demoAlice.record(([['n', { Nat: 10n }]])); // the 10th block fills the store
    await rounds();
    const s = await demo.icrc3_log_status();
    expect(s.live_blocks).toBeLessThan(10n);
    expect(s.archives.length).toBe(1);
    expect(s.spilling).toBe(false);
    await verifyLog(demo, id, rootKey, (a) => actorAs(pic, archiveIdl, a, admin));
  });

  it('moves a backlog bigger than one run (50 batches) without waiting for a timer period', async () => {
    const { demo, demoAlice } = await setup();
    unwrap(await settings(demo, { max_live_blocks: [60n], spill_batch_size: [1n], archive_max_blocks: [1000n] }));
    await demoAlice.record_many(120n); // 123 live: a run moves 50 and stops, the next one goes on right away
    await rounds(60);
    expect((await demo.icrc3_log_status()).live_blocks).toBeLessThan(60n);
  });

  it('retries a spill that cannot finish with a doubling back-off, then spills once it can', async () => {
    // a cycle reserve above the balance: no archive can be created
    const { id, demo, demoAlice } = await setup(1000n * T);
    unwrap(await settings(demo, { max_live_blocks: [5n], archive_max_blocks: [500n] })); // 2 config blocks
    await demoAlice.record_many(3n);
    await rounds();
    expect(await spillErrors(demo)).toBe(1); // the write that filled the store armed one attempt
    await demoAlice.record_many(3n); // more writes while backing off arm nothing new
    await rounds();
    expect(await spillErrors(demo)).toBe(1);
    await pic.advanceTime((PERIOD - 30) * 1000); await pic.tick(2);
    expect(await spillErrors(demo)).toBe(1);
    await pic.advanceTime(40_000); await pic.tick(3); // first retry: PERIOD after the failure
    expect(await spillErrors(demo)).toBe(2);
    await pic.advanceTime((PERIOD + 30) * 1000); await pic.tick(3); // the second waits 2 × PERIOD
    expect(await spillErrors(demo)).toBe(2);
    await pic.advanceTime((PERIOD - 20) * 1000); await pic.tick(3);
    expect(await spillErrors(demo)).toBe(3);
    // an upgrade with a reserve the canister can afford: the store is still full, so postupgrade arms a spill
    await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(DEMO_WASM), arg: IDL.encode(demoInit, args(2n * T)) });
    await rounds();
    const s = await demo.icrc3_log_status();
    expect(s.live_blocks).toBeLessThan(5n);
    expect(s.archives.length).toBe(1);
    expect(await spillErrors(demo)).toBe(0); // the demo's text log is transient: nothing failed since the upgrade
  });
});
