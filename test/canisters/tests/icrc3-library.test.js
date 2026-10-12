// Tests of the src/icrc3 library through the Icrc3Demo canister: chaining,
// certification, read endpoints, settings, spilling into archive canisters,
// archive access control, cycle top-ups, timers and upgrades.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, T, unwrap, errOf } from '../lib/pic.js';
import { demoIdl, demoInit } from '../lib/idl.js';
import { archiveIdl, hashValue, field, txField, btype, verifyTip, verifyLog, fetchBlocks, verifyChain } from '../lib/icrc3.js';

const EXTRA = Principal.fromText('fp274-iaaaa-aaaaq-aacha-cai');
const TIMER_SECONDS = 60;

let pic, rootKey, demoId, demo, demoAlice;

const archiveActor = (id) => actorAs(pic, archiveIdl, id, admin);
const verify = () => verifyLog(demo, demoId, rootKey, archiveActor);
const status = () => demo.icrc3_log_status();
const setSettings = (u) => demo.admin_set_icrc3_settings({
  max_live_blocks: [], spill_batch_size: [], archive_max_blocks: [],
  archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [], ...u,
});

beforeAll(async () => {
  ({ pic, rootKey } = await createPic());
  demoId = await install(pic, { name: 'Icrc3Demo', initTypes: demoInit, initArgs: [{ extra_controller: EXTRA, cycle_reserve: 2n * T, timer_seconds: BigInt(TIMER_SECONDS) }], cycles: 50n * T });
  demo = actorAs(pic, demoIdl, demoId, admin);
  demoAlice = actorAs(pic, demoIdl, demoId, alice);
});

afterAll(async () => { await pic?.tearDown(); });

describe('empty log', () => {
  it('reports an empty state and no certificate', async () => {
    const s = await status();
    expect(s.log_length).toBe(0n);
    expect(s.live_blocks).toBe(0n);
    expect(s.archives).toEqual([]);
    expect(s.last_block_hash).toEqual([]);
    expect(await demo.icrc3_get_tip_certificate()).toEqual([]);
    const r = await demo.icrc3_get_blocks([{ start: 0n, length: 10n }]);
    expect(r.log_length).toBe(0n);
    expect(r.blocks).toEqual([]);
    expect(r.archived_blocks).toEqual([]);
    expect(await demo.icrc3_get_archives({ from: [] })).toEqual([]);
  });

  it('lists the configured block types and standards', async () => {
    const types = await demo.icrc3_supported_block_types();
    expect(types.map((t) => t.block_type)).toEqual(['demo_event', 'demo_config_update']);
    expect(types[0].url).toBe('https://example.test/demo#block-types');
    const standards = await demo.icrc10_supported_standards();
    expect(standards.map((s) => s.name)).toEqual(['ICRC-3', 'ICRC-10']);
  });

  it('has the default settings', async () => {
    const { settings } = await status();
    expect(settings).toEqual({
      max_live_blocks: 2000n, spill_batch_size: 500n, archive_max_blocks: 1_000_000n,
      archive_initial_cycles: 1_500_000_000_000n, archive_top_up_threshold: 500_000_000_000n, archive_top_up_amount: 500_000_000_000n,
    });
  });
});

describe('appending and chaining', () => {
  it('block 0 has no phash, carries btype, ts and the tx map, and is certified', async () => {
    const idx = await demoAlice.record([['amount', { Nat: 42n }], ['note', { Text: 'first' }]]);
    expect(idx).toBe(0n);
    const r = await demo.icrc3_get_blocks([{ start: 0n, length: 1n }]);
    expect(r.log_length).toBe(1n);
    const block = r.blocks[0].block;
    expect(btype(block)).toBe('demo_event');
    expect(field(block, 'phash')).toBeUndefined();
    expect(field(block, 'ts').Nat).toBeGreaterThan(0n);
    expect(txField(block, 'amount')).toEqual({ Nat: 42n });
    expect(txField(block, 'note')).toEqual({ Text: 'first' });
    expect(Buffer.from(txField(block, 'caller').Blob)).toEqual(Buffer.from(alice.toUint8Array()));
    const tip = await verifyTip(demo, demoId, rootKey);
    expect(tip.lastIndex).toBe(0n);
    expect(tip.lastHash.equals(hashValue(block))).toBe(true);
    const s = await status();
    expect(Buffer.from(s.last_block_hash[0]).equals(hashValue(block))).toBe(true);
  });

  it('every later block links to its parent and the tip follows the last block', async () => {
    for (let i = 1; i <= 5; i++) await demoAlice.record([['n', { Nat: BigInt(i) }]]);
    const { blocks, lastIndex } = await verify();
    expect(lastIndex).toBe(5n);
    expect(blocks).toHaveLength(6);
    for (let i = 1; i < blocks.length; i++) {
      expect(Buffer.from(field(blocks[i], 'phash').Blob).equals(hashValue(blocks[i - 1]))).toBe(true);
    }
  });

  it('serves ranges, clamps beyond the end and merges several ranges', async () => {
    const r = await demo.icrc3_get_blocks([{ start: 4n, length: 100n }, { start: 0n, length: 2n }]);
    expect(r.blocks.map((b) => b.id)).toEqual([4n, 5n, 0n, 1n]);
    const empty = await demo.icrc3_get_blocks([{ start: 100n, length: 5n }]);
    expect(empty.blocks).toEqual([]);
    expect(empty.log_length).toBe(6n);
  });

  it('a modified block would break verification', async () => {
    const { blocks, lastIndex, lastHash } = await verify();
    const map = new Map(blocks.map((b, i) => [BigInt(i), b]));
    const tampered = { Map: blocks[2].Map.map(([k, v]) => (k === 'tx' ? ['tx', { Map: [['n', { Nat: 999n }]] }] : [k, v])) };
    map.set(2n, tampered);
    expect(() => verifyChain(map, lastIndex, lastHash)).toThrow(/broken chain at block 3/);
  });
});

describe('settings', () => {
  it('rejects non-admins', async () => {
    expect(errOf(await demoAlice.admin_set_icrc3_settings({ max_live_blocks: [1n], spill_batch_size: [], archive_max_blocks: [], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }))).toMatch(/admin/);
    expect(errOf(await demoAlice.admin_icrc3_spill_now())).toMatch(/admin/);
  });

  it('validates values and keeps the old settings on error', async () => {
    expect(errOf(await setSettings({ max_live_blocks: [0n] }))).toMatch(/max_live_blocks/);
    expect(errOf(await setSettings({ spill_batch_size: [0n] }))).toMatch(/spill_batch_size/);
    expect(errOf(await setSettings({ spill_batch_size: [1001n] }))).toMatch(/spill_batch_size/);
    expect(errOf(await setSettings({ archive_max_blocks: [10n] }))).toMatch(/archive_max_blocks must be at least spill_batch_size/);
    expect(errOf(await setSettings({ archive_initial_cycles: [1n] }))).toMatch(/0.2 T/);
    expect(errOf(await setSettings({ archive_top_up_amount: [1n] }))).toMatch(/0.1 T/);
    expect((await status()).settings.max_live_blocks).toBe(2000n);
  });

  it('applies changes and logs each one as a config block', async () => {
    const before = (await status()).log_length;
    const s = unwrap(await setSettings({ spill_batch_size: [3n], archive_max_blocks: [3n], max_live_blocks: [4n] }));
    expect(s.spill_batch_size).toBe(3n);
    expect(s.archive_max_blocks).toBe(3n);
    expect(s.max_live_blocks).toBe(4n);
    const after = (await status()).log_length;
    expect(after - before).toBe(3n);
    const r = await demo.icrc3_get_blocks([{ start: before, length: 3n }]);
    const keys = r.blocks.map((b) => txField(b.block, 'key').Text).sort();
    expect(keys).toEqual(['icrc3_archive_max_blocks', 'icrc3_max_live_blocks', 'icrc3_spill_batch_size']);
    const b = r.blocks.find((x) => txField(x.block, 'key').Text === 'icrc3_spill_batch_size').block;
    expect(txField(b, 'value')).toEqual({ Nat: 3n });
    expect(txField(b, 'old_value')).toEqual({ Nat: 500n });
    expect(btype(b)).toBe('demo_config_update');
  });
});

describe('spilling to archives', () => {
  let archives;

  it('a forced spill moves every live block into contiguous archives of the configured size', async () => {
    const before = await status();
    const moved = unwrap(await demo.admin_icrc3_spill_now());
    expect(moved).toBe(before.live_blocks);
    const s = await status();
    expect(s.live_blocks).toBe(0n);
    expect(s.live_first_index).toBe(before.log_length);
    expect(s.log_length).toBe(before.log_length);
    archives = await demo.icrc3_get_archives({ from: [] });
    expect(archives.length).toBe(Number((before.log_length + 2n) / 3n));
    let expectStart = 0n;
    for (const a of archives) {
      expect(a.start).toBe(expectStart);
      expect(a.end - a.start + 1n <= 3n).toBe(true);
      expectStart = a.end + 1n;
    }
    expect(expectStart).toBe(before.log_length);
    expect(s.archives.map((a) => a.canister_id.toText())).toEqual(archives.map((a) => a.canister_id.toText()));
  });

  it('archives have the parent, the configured capacity and the intended controllers', async () => {
    const a = archiveActor(archives[0].canister_id);
    const st = await a.archive_status();
    expect(st.parent.toText()).toBe(demoId.toText());
    expect(st.first_index).toBe(0n);
    expect(st.block_count).toBe(3n);
    expect(st.max_blocks).toBe(3n);
    expect(st.data_bytes).toBeGreaterThan(0n);
    expect(st.cycles).toBeGreaterThan(500_000_000_000n); // 1.5 T grant minus creation fee
    const controllers = (await pic.getControllers(archives[0].canister_id)).map((p) => p.toText()).sort();
    expect(controllers).toEqual([demoId.toText(), EXTRA.toText()].sort());
  });

  it('icrc3_get_blocks hands out one callback per archive and the chain verifies across all of them', async () => {
    const s = await status();
    const r = await demo.icrc3_get_blocks([{ start: 0n, length: s.log_length }]);
    expect(r.blocks).toEqual([]);
    expect(r.archived_blocks).toHaveLength(archives.length);
    for (const ab of r.archived_blocks) {
      const [id, method] = ab.callback;
      expect(method).toBe('icrc3_get_blocks');
      expect(archives.some((a) => a.canister_id.toText() === id.toText())).toBe(true);
    }
    const { blocks, lastIndex } = await verify();
    expect(lastIndex).toBe(s.log_length - 1n);
    expect(blocks).toHaveLength(Number(s.log_length));
  });

  it('an archive answers only for its own range and ignores the rest', async () => {
    const a = archiveActor(archives[1].canister_id);
    const r = await a.icrc3_get_blocks([{ start: 0n, length: 100n }]);
    expect(r.blocks.map((b) => b.id)).toEqual([3n, 4n, 5n]);
    expect(r.archived_blocks).toEqual([]);
    expect(r.log_length).toBe(6n);
  });

  it('get_archives with `from` returns the archives after it', async () => {
    const after = await demo.icrc3_get_archives({ from: [archives[0].canister_id] });
    expect(after.map((a) => a.canister_id.toText())).toEqual(archives.slice(1).map((a) => a.canister_id.toText()));
    const none = await demo.icrc3_get_archives({ from: [archives[archives.length - 1].canister_id] });
    expect(none).toEqual([]);
  });

  it('only the parent can append; ingress calls are refused before execution', async () => {
    const asAlice = actorAs(pic, archiveIdl, archives[0].canister_id, alice);
    await expect(asAlice.append_blocks({ first_index: 3n, blocks: [new Uint8Array([0])] })).rejects.toThrow(/inspect_message|refused/i);
    const st = await asAlice.archive_status();
    expect(st.block_count).toBe(3n);
  });

  it('new blocks go live first, then spill into a new archive once the last one is full', async () => {
    const s0 = await status();
    await demoAlice.record_many(2n);
    expect((await status()).live_blocks).toBe(2n);
    const moved = unwrap(await demo.admin_icrc3_spill_now());
    expect(moved).toBe(2n);
    const all = await demo.icrc3_get_archives({ from: [] });
    const last = all[all.length - 1];
    expect(last.start).toBe(s0.log_length);
    expect(last.end).toBe(s0.log_length + 1n);
    // the next block fills that archive, the one after starts another
    await demoAlice.record_many(2n);
    unwrap(await demo.admin_icrc3_spill_now());
    const all2 = await demo.icrc3_get_archives({ from: [] });
    expect(all2.length).toBe(all.length + 1);
    expect(all2[all2.length - 2].end - all2[all2.length - 2].start + 1n).toBe(3n);
    await verify();
  });

  it('spill_now with nothing to move returns 0', async () => {
    expect(unwrap(await demo.admin_icrc3_spill_now())).toBe(0n);
  });
});

describe('cycles', () => {
  it('tops an archive up when it reports less than the threshold', async () => {
    const all = await demo.icrc3_get_archives({ from: [] });
    const last = all[all.length - 1].canister_id;
    const before = await pic.getCyclesBalance(last);
    unwrap(await setSettings({ archive_top_up_threshold: [10n * T], archive_top_up_amount: [1n * T] }));
    await demoAlice.record_many(1n);
    unwrap(await demo.admin_icrc3_spill_now());
    const after = await pic.getCyclesBalance(last);
    expect(after - before).toBeGreaterThan(900_000_000_000n);
    const logs = await demo.logs();
    expect(logs.some(([, m]) => m.includes('topped up archive ' + last.toText()))).toBe(true);
    unwrap(await setSettings({ archive_top_up_threshold: [500_000_000_000n], archive_top_up_amount: [500_000_000_000n] }));
  });

  it('stops without creating an archive when the balance would drop below the reserve', async () => {
    // fill the last archive, then make creation unaffordable
    const balance = await pic.getCyclesBalance(demoId);
    unwrap(await setSettings({ archive_initial_cycles: [balance] }));
    await demoAlice.record_many(4n);
    const s0 = await status();
    const moved = unwrap(await demo.admin_icrc3_spill_now());
    const s1 = await status();
    const archivesBefore = (await demo.icrc3_get_archives({ from: [] })).length;
    // whatever fit into the existing last archive moved; the rest stayed live
    expect(s1.live_blocks + moved).toBe(s0.live_blocks);
    expect(s1.live_blocks).toBeGreaterThan(0n);
    const logs = await demo.logs();
    expect(logs.some(([, m]) => m.includes('not enough cycles to create an archive'))).toBe(true);
    unwrap(await setSettings({ archive_initial_cycles: [1_500_000_000_000n] }));
    unwrap(await demo.admin_icrc3_spill_now());
    expect((await status()).live_blocks).toBe(0n);
    expect((await demo.icrc3_get_archives({ from: [] })).length).toBeGreaterThan(archivesBefore);
    await verify();
  });
});

describe('timer', () => {
  it('spills on its own once the live store reaches max_live_blocks', async () => {
    unwrap(await setSettings({ max_live_blocks: [4n] }));
    await demoAlice.record_many(3n);
    await pic.advanceTime(TIMER_SECONDS * 1000 + 1000);
    await pic.tick(10);
    expect((await status()).live_blocks).toBe(3n); // below threshold: nothing moved
    await demoAlice.record_many(1n);
    // the spill needs several message rounds (create archive, set controllers, append, status)
    for (let i = 0; i < 3; i++) { await pic.advanceTime(TIMER_SECONDS * 1000 + 1000); await pic.tick(10); }
    const s = await status();
    expect(s.live_blocks).toBeLessThan(4n);
    await verify();
  });
});

describe('upgrade', () => {
  it('an archive upgraded by a co-controller keeps its parent, range and blocks, and still takes the parent\'s batches', async () => {
    const { IDL } = await import('@icp-sdk/core/candid');
    const { wasm } = await import('../lib/pic.js');
    const archives = await demo.icrc3_get_archives({ from: [] });
    expect(archives.length).toBeGreaterThan(0);
    const before = await Promise.all(archives.map((a) => archiveActor(a.canister_id).archive_status()));
    // the SNS root co-controller upgrades every archive, with init args that must be ignored
    const bogus = IDL.encode([IDL.Record({ first_index: IDL.Nat, max_blocks: IDL.Nat })], [{ first_index: 999_999n, max_blocks: 1n }]);
    for (const a of archives) {
      await pic.upgradeCanister({ sender: EXTRA, canisterId: a.canister_id, wasm: wasm('Icrc3Archive'), arg: bogus });
    }
    const after = await Promise.all(archives.map((a) => archiveActor(a.canister_id).archive_status()));
    for (let i = 0; i < archives.length; i++) {
      expect(after[i].parent.toText()).toBe(demoId.toText());
      expect(after[i].first_index).toBe(before[i].first_index);
      expect(after[i].max_blocks).toBe(before[i].max_blocks);
      expect(after[i].block_count).toBe(before[i].block_count);
      expect(after[i].data_bytes).toBe(before[i].data_bytes);
    }
    await verify();
    // the parent can still spill into the upgraded chain
    const liveBefore = (await status()).live_blocks;
    unwrap(await setSettings({ max_live_blocks: [1n] }));
    await demoAlice.record_many(2n);
    expect(unwrap(await demo.admin_icrc3_spill_now())).toBeGreaterThan(0n);
    expect((await status()).live_blocks).toBeLessThan(liveBefore + 2n);
    unwrap(await setSettings({ max_live_blocks: [4n] }));
    await verify();
  });

  it('keeps the log, archives and settings, re-certifies the tip and restarts the timer', async () => {
    const before = await status();
    const tipBefore = await verifyTip(demo, demoId, rootKey);
    await pic.upgradeCanister({ sender: admin, canisterId: demoId, wasm: (await import('../lib/pic.js')).wasm('Icrc3Demo'), arg: (await import('@icp-sdk/core/candid')).IDL.encode(demoInit, [{ extra_controller: EXTRA, cycle_reserve: 2n * T, timer_seconds: BigInt(TIMER_SECONDS) }]) });
    const after = await status();
    expect(after.log_length).toBe(before.log_length);
    expect(after.live_first_index).toBe(before.live_first_index);
    expect(after.archives).toEqual(before.archives);
    expect(after.settings).toEqual(before.settings);
    const tipAfter = await verifyTip(demo, demoId, rootKey);
    expect(tipAfter.lastIndex).toBe(tipBefore.lastIndex);
    expect(tipAfter.lastHash.equals(tipBefore.lastHash)).toBe(true);
    await verify();
    // timer: fill to the threshold and let it fire
    const live = (await status()).live_blocks;
    await demoAlice.record_many(live < 4n ? 4n - live : 1n);
    for (let i = 0; i < 3; i++) { await pic.advanceTime(TIMER_SECONDS * 1000 + 1000); await pic.tick(10); }
    expect((await status()).live_blocks).toBeLessThan(4n);
    await verify();
  });
});

describe('value conventions', () => {
  it('encodes principals as Blob and keeps field order irrelevant to the hash', async () => {
    const idx = await demoAlice.record([['who', { Blob: bob.toUint8Array() }], ['acct', { Array: [{ Blob: bob.toUint8Array() }, { Blob: new Uint8Array(32) }] }], ['neg', { Int: -7n }]]);
    const blocks = await fetchBlocks(demo, archiveActor, idx, idx);
    const block = blocks.get(idx);
    expect(Principal.fromUint8Array(new Uint8Array(txField(block, 'who').Blob)).toText()).toBe(bob.toText());
    expect(txField(block, 'neg')).toEqual({ Int: -7n });
    const reordered = { Map: [...block.Map].reverse() };
    expect(hashValue(reordered).equals(hashValue(block))).toBe(true);
  });
});
