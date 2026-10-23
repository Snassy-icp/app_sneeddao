// The bot items of spec/paging_audit.md (S8-S11, getTradeLog/getLogs/getPriceHistory and the
// daily-summary bug), on PocketIC:
//   - list getters cap their pages (trade log 500, bot log 500, snapshots 200, price history and
//     daily rows 1000) and stop at about 1 MB, and page with offset / beforeId;
//   - snapshots, purse snapshots, daily summaries, candles and price history can be read newest
//     first (`newestFirst`), so the Performance tab no longer goes stale;
//   - a daily summary counts each snapshot once and keeps its close when the snapshot log is full;
//   - log appends are O(1) (ring buffers) and the log sizes are capped;
//   - a circuit-breaker percent-change condition no longer builds a pair key per history entry;
//   - upgrades from the published versions (trading bot 0.9.3, staking bot 0.9.4) and from the
//     array logs keep every entry, in order.
// The seeding methods (test_seed_*, test_cb_price_change) exist only in the *_seed test builds
// (build.sh, canisters/*_bot_seed.mo.part); they fill the logs through the bots' own append paths
// and return the instructions used.
//
// BOTS_BUILD=prepaging runs everything against the bots as they were before these fixes (HEAD
// 2a0164bc): the fixed behaviour fails there.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, account, admin, user, ICP_LEDGER_ID, T, wasm } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { idlFactory as tradingIdl } from '../build/sneed_trading_bot.did.js';
import { idlFactory as stakingIdl } from '../build/sneed_icp_staking_bot.did.js';

const SFX = process.env.BOTS_BUILD === 'prepaging' ? '_prepaging' : '';
const TRADING = `sneed_trading_bot${SFX}`;
const STAKING = `sneed_icp_staking_bot${SFX}`;
const RELEASES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'releases');
const published = (path) => readFileSync(resolve(RELEASES, path));

const CKUSDC_ID = Principal.fromText('xevnm-gaaaa-aaaar-qafnq-cai');
const GOVERNANCE_ID = Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai');
const DAY_NS = 86_400_000_000_000n;
const dave = user('dave');
const alice = user('alice');
// thresholds between the measured costs before and after the fixes (printed by the tests)
const PRICE_FILTER_MAX_CYCLES = 100_000_000n; // before: about 186M, after: about 48M
const DELIVERY_BACKLOG_MAX_EXTRA_CYCLES = 20_000_000n; // before: about +78M per batch at 20 000 queued

const seedIdl = ({ IDL }) => IDL.Service({
  test_seed_logs: IDL.Func([IDL.Nat], [IDL.Nat64], []),
  test_seed_trade_log: IDL.Func([IDL.Nat, IDL.Principal], [IDL.Nat64], []),
  test_seed_snapshots: IDL.Func([IDL.Vec(IDL.Nat)], [IDL.Nat64], []),
  test_seed_purse_snapshots: IDL.Func([IDL.Text, IDL.Nat], [IDL.Nat64], []),
  test_seed_price_history: IDL.Func([IDL.Nat, IDL.Principal, IDL.Principal, IDL.Int, IDL.Int, IDL.Nat], [IDL.Nat64], []),
  test_seed_daily: IDL.Func([IDL.Nat, IDL.Principal, IDL.Principal], [], []),
  test_cb_price_change: IDL.Func([IDL.Principal, IDL.Principal, IDL.Nat, IDL.Nat], [IDL.Bool, IDL.Nat64], []),
  test_candle_quotes: IDL.Func([IDL.Nat, IDL.Nat, IDL.Nat], [IDL.Nat64], []),
  test_queue_events: IDL.Func([IDL.Nat], [], []),
  test_price_history_query_cycles: IDL.Func([IDL.Text], [IDL.Nat], []),
});

const logFilter = (over = {}) => ({ minLevel: [], source: [], caller: [], fromTime: [], toTime: [], startId: [], limit: [], beforeId: [], ...over });
const tradeQ = (over = {}) => ({
  startId: [], limit: [], offset: [], choreId: [], choreTypeId: [], actionType: [], inputToken: [], outputToken: [],
  status: [], fromTime: [], toTime: [], ...over,
});
const snapQ = (over = {}) => ({ startId: [], limit: [], tradeLogId: [], phase: [], fromTime: [], toTime: [], offset: [], newestFirst: [], ...over });
const dailyQ = (over = {}) => ({ fromDate: [], toDate: [], limit: [], offset: [], newestFirst: [], ...over });
const candleQ = (over = {}) => ({ pairKey: [], fromDate: [], toDate: [], limit: [], offset: [], newestFirst: [], ...over });
const priceQ = (over = {}) => ({ pairKey: [], limit: [], offset: [], newestFirst: [], ...over });
const ids = (entries) => entries.map((e) => e.id);
const desc = (xs) => xs.every((x, i) => i === 0 || xs[i - 1] > x);
const asc = (xs) => xs.every((x, i) => i === 0 || xs[i - 1] < x);
const range = (from, to) => Array.from({ length: to - from }, (_, i) => BigInt(from + i)); // [from, to)

let pic, appSubnet, tokenAId, tokenBId;

async function installTrading(name = `${TRADING}_seed`) {
  const id = await install(pic, { name, cycles: 50n * T, targetSubnetId: appSubnet });
  return { id, bot: actorAs(pic, tradingIdl, id, admin), seed: actorAs(pic, seedIdl, id, admin) };
}

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 10_000n, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 10_000n, symbol: 'ckUSDC', decimals: 6 }], targetCanisterId: CKUSDC_ID });
  await install(pic, { name: 'MockNnsGovernance', targetCanisterId: GOVERNANCE_ID });
  tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 1_000n, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  tokenBId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 500n, symbol: 'BBB', decimals: 8 }], targetSubnetId: appSubnet });
});

afterAll(async () => { await pic?.tearDown(); });

describe('trading bot: list getters are capped and page', () => {
  let bot, seed;
  beforeAll(async () => {
    ({ bot, seed } = await installTrading());
    await bot.addToken({ ledgerCanisterId: tokenAId, symbol: 'AAA', decimals: 8, fee: 1_000n });
    await bot.addToken({ ledgerCanisterId: tokenBId, symbol: 'BBB', decimals: 8, fee: 500n });
  });

  it('getTradeLog returns at most 500 entries however many are asked for, and pages with offset', async () => {
    await seed.test_seed_trade_log(1_200n, tokenAId);
    const first = await bot.getTradeLog(tradeQ({ limit: [100_000n] })); // what DuplicateCleanupDialog asked for
    expect(first.totalCount).toBe(1_200n);
    expect(first.entries).toHaveLength(500);
    expect(first.hasMore).toBe(true);
    const all = [...first.entries];
    while (all.length < 1_200) {
      const page = await bot.getTradeLog(tradeQ({ limit: [500n], offset: [BigInt(all.length)] }));
      expect(page.entries.length).toBeGreaterThan(0);
      all.push(...page.entries);
    }
    expect(ids(all)).toEqual(range(0, 1_200).reverse()); // newest first, nothing lost or repeated
  });

  it('getLogs returns at most 500 entries and pages back from the newest with beforeId', async () => {
    await seed.test_seed_logs(1_100n);
    const newest = await bot.getLogs(logFilter({ limit: [100_000n] }));
    expect(newest.entries).toHaveLength(500);
    expect(newest.hasMore).toBe(true);
    const total = Number(newest.totalMatching);
    const all = [...newest.entries];
    while (all.length < total) {
      const page = await bot.getLogs(logFilter({ limit: [500n], beforeId: [all[0].id] }));
      expect(page.entries.length).toBeGreaterThan(0);
      expect(page.entries.at(-1).id).toBeLessThan(all[0].id);
      all.unshift(...page.entries);
    }
    const got = ids(all);
    expect(asc(got)).toBe(true);
    expect(got.at(-1) - got[0] + 1n).toBe(BigInt(total)); // contiguous: every line exactly once
  });

  it('snapshots can be read newest first, 200 per page, with offset', async () => {
    await seed.test_seed_snapshots(range(1, 301)); // values 1..300
    const page1 = await bot.getPortfolioSnapshots(snapQ({ limit: [500n], newestFirst: [true] }));
    expect(page1.totalCount).toBe(300n);
    expect(page1.entries).toHaveLength(200);
    expect(page1.entries[0].totalValueIcpE8s).toEqual([300n]);
    expect(desc(ids(page1.entries))).toBe(true);
    expect(page1.hasMore).toBe(true);
    const page2 = await bot.getPortfolioSnapshots(snapQ({ limit: [500n], newestFirst: [true], offset: [200n] }));
    expect(page2.entries.map((s) => s.totalValueIcpE8s[0])).toEqual(range(1, 101).reverse());
    expect(page2.hasMore).toBe(false);
    // without the flag: oldest first, as before (now capped)
    const old = await bot.getPortfolioSnapshots(snapQ({ limit: [500n] }));
    expect(old.entries[0].totalValueIcpE8s).toEqual([1n]);
    expect(old.entries).toHaveLength(200);
  });

  it('purse snapshots can be read newest first, 200 per page', async () => {
    await seed.test_seed_purse_snapshots('p1', 250n);
    const r = await bot.getPursePortfolioSnapshots('p1', snapQ({ limit: [500n], newestFirst: [true] }));
    expect(r.totalCount).toBe(250n);
    expect(r.entries).toHaveLength(200);
    expect(r.entries[0].totalValueIcpE8s).toEqual([250n]);
    const rest = await bot.getPursePortfolioSnapshots('p1', snapQ({ limit: [500n], newestFirst: [true], offset: [200n] }));
    expect(rest.entries.map((s) => s.totalValueIcpE8s[0])).toEqual(range(1, 51).reverse());
  });

  it('daily summaries and candles can be read newest first, 1000 per page', async () => {
    await seed.test_seed_daily(1_500n, tokenAId, tokenBId);
    const sums = await bot.getDailyPortfolioSummaries(dailyQ({ limit: [5_000n], newestFirst: [true] }));
    expect(sums.totalCount).toBe(1_500n);
    expect(sums.entries).toHaveLength(1_000);
    expect(sums.entries[0].date).toBe(1_499n * DAY_NS);
    expect(desc(sums.entries.map((s) => s.date))).toBe(true);
    const sums2 = await bot.getDailyPortfolioSummaries(dailyQ({ limit: [1_000n], newestFirst: [true], offset: [1_000n] }));
    expect(sums2.entries.map((s) => s.closeValueIcpE8s)).toEqual(range(0, 500).reverse());
    const candles = await bot.getDailyPriceCandles(candleQ({ limit: [5_000n], newestFirst: [true] }));
    expect(candles.totalCount).toBe(1_500n);
    expect(candles.entries).toHaveLength(1_000);
    expect(candles.entries[0].closeE8s).toBe(1_500n); // day d closes at d + 1
    // the default order is unchanged: oldest first
    expect((await bot.getDailyPriceCandles(candleQ({ limit: [3n] }))).entries.map((c) => c.closeE8s)).toEqual([1n, 2n, 3n]);
  });

  it('price history can be read newest first, 1000 per page', async () => {
    const t0 = BigInt(Math.round(await pic.getTime())) * 1_000_000n - 10_000n * 60_000_000_000n;
    await seed.test_seed_price_history(3_000n, tokenAId, tokenBId, t0, 60_000_000_000n, 1_000_000n);
    const r = await bot.getPriceHistory(priceQ({ limit: [5_000n], newestFirst: [true] }));
    expect(r.totalCount).toBe(3_000n);
    expect(r.entries).toHaveLength(1_000);
    expect(r.entries[0].quote.expectedOutput).toBe(1_000_000n + 2_999n);
    expect(desc(r.entries.map((e) => e.fetchedAt))).toBe(true);
  });

  it('a page stops at about 1 MB however many rows fit the count cap', async () => {
    // 60 tokens per snapshot: 200 snapshots would be about 1.7 MB
    for (let i = 0; i < 58; i++) {
      await bot.addToken({ ledgerCanisterId: user(`tok-${i}`), symbol: `T${String(i).padStart(3, '0')}`, decimals: 8, fee: 1n });
    }
    await seed.test_seed_snapshots(range(1_000, 1_250));
    const r = await bot.getPortfolioSnapshots(snapQ({ limit: [200n], newestFirst: [true], fromTime: [0n] }));
    expect(r.entries[0].tokens).toHaveLength(60);
    expect(r.entries.length).toBeGreaterThan(50);
    expect(r.entries.length).toBeLessThan(200);
    expect(r.hasMore).toBe(true);
    for (let i = 0; i < 58; i++) await bot.removeToken(user(`tok-${i}`));
  });
});

describe('trading bot: daily summaries once the snapshot log is full', () => {
  it('counts every snapshot once and keeps the earlier day\'s close', async () => {
    const { bot, seed } = await installTrading();
    await bot.addToken({ ledgerCanisterId: tokenAId, symbol: 'AAA', decimals: 8, fee: 1_000n });
    await bot.setLoggingSettings({ tradeLogEnabled: true, portfolioLogEnabled: true, maxTradeLogEntries: 10_000n, maxPortfolioLogEntries: 2n });
    await seed.test_seed_snapshots([10n, 20n, 30n]); // day 1
    await pic.advanceTime(86_400_000);
    await pic.tick();
    await seed.test_seed_snapshots([40n]); // day 2: the log drops the day-1 snapshot of 20
    const { entries } = await bot.getDailyPortfolioSummaries(dailyQ());
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ snapshotCount: 3n, openValueIcpE8s: 10n, highValueIcpE8s: 30n, lowValueIcpE8s: 10n, closeValueIcpE8s: 30n });
    expect(entries[1]).toMatchObject({ snapshotCount: 1n, openValueIcpE8s: 40n, closeValueIcpE8s: 40n });
    // and the log itself holds the newest two
    expect((await bot.getPortfolioSnapshots(snapQ({ limit: [10n] }))).entries.map((s) => s.totalValueIcpE8s[0])).toEqual([30n, 40n]);
  });
});

describe('trading bot: appends are O(1) and sizes are capped', () => {
  let bot, seed;
  beforeAll(async () => {
    ({ bot, seed } = await installTrading());
    await bot.addToken({ ledgerCanisterId: tokenAId, symbol: 'AAA', decimals: 8, fee: 1_000n });
  });

  it('a log line with 10 000 lines stored costs about what it costs in an empty log', async () => {
    for (let i = 0; i < 5; i++) await seed.test_seed_logs(2_000n);
    expect((await bot.getLogConfig()).entryCount).toBe(10_000n);
    const n = await seed.test_seed_logs(100n);
    console.log(`100 log lines with a full 10 000-line log: ${n} instructions`);
    expect(n).toBeLessThan(10_000_000n); // the array log copied the whole log per line: ~100M here
  });

  it('a trade log entry with 10 000 stored costs about what it costs in an empty log', async () => {
    for (let i = 0; i < 5; i++) await seed.test_seed_trade_log(2_000n, tokenAId);
    const n = await seed.test_seed_trade_log(100n, tokenAId);
    console.log(`100 trade log entries with 10 000 stored: ${n} instructions`);
    expect(n).toBeLessThan(10_000_000n);
  });

  it('caps the log sizes: trade log 50 000, snapshots 20 000, price history 20 000', async () => {
    await bot.setLoggingSettings({ tradeLogEnabled: true, portfolioLogEnabled: true, maxTradeLogEntries: 10_000_000n, maxPortfolioLogEntries: 10_000_000n });
    expect(await bot.getLoggingSettings()).toMatchObject({ maxTradeLogEntries: 50_000n, maxPortfolioLogEntries: 20_000n });
    await bot.setPriceHistoryMaxSize(10_000_000n);
    expect(await bot.getPriceHistoryMaxSize()).toBe(20_000n);
    // shrinking trims right away, keeping the newest
    await bot.setLoggingSettings({ tradeLogEnabled: true, portfolioLogEnabled: true, maxTradeLogEntries: 100n, maxPortfolioLogEntries: 5_000n });
    const tl = await bot.getTradeLog(tradeQ({ limit: [500n] }));
    expect(tl.totalCount).toBe(100n);
    expect(tl.entries[0].id).toBe((await bot.getTradeLogStats()).nextId - 1n);
  });

  it('a percent-change price condition over 20 000 history entries no longer builds a pair key per entry', async () => {
    await bot.setPriceHistoryMaxSize(20_000n);
    const nowNs = BigInt(Math.round(await pic.getTime())) * 1_000_000n;
    const step = 60_000_000_000n; // a minute
    const t0 = nowNs - 20_000n * step;
    for (let i = 0n; i < 10n; i++) {
      await seed.test_seed_price_history(2_000n, tokenAId, tokenBId, t0 + i * 2_000n * step, step, 1_000_000n + i * 2_000n);
    }
    expect((await bot.getPriceHistory(priceQ({ limit: [1n] }))).totalCount).toBe(20_000n);
    // an hour ago the price was about 1 019 940; now 2 000 000: +96 %, so it fires
    const [fired, n] = await seed.test_cb_price_change(tokenAId, tokenBId, 2_000_000n, 3_600n);
    console.log(`percent-change condition over 20 000 entries: ${n} instructions`);
    expect(fired).toBe(true);
    expect(n).toBeLessThan(40_000_000n); // before: about 380M (two Principal.toText per entry)
    // the same price as an hour ago does not fire (the match is the entry closest to the cutoff)
    const [quiet] = await seed.test_cb_price_change(tokenAId, tokenBId, 1_019_940n, 3_600n);
    expect(quiet).toBe(false);
  });
});

describe('trading bot: candles, the price-history pair filter and event delivery', () => {
  let id, bot, seed;
  beforeAll(async () => {
    ({ id, bot, seed } = await installTrading());
    await bot.addToken({ ledgerCanisterId: tokenAId, symbol: 'AAA', decimals: 8, fee: 1_000n });
  });

  it('a quote updates its daily candle without going through every candle', async () => {
    const n = await seed.test_candle_quotes(10n, 200n, 100n); // 2 000 candles, then 100 quotes on the latest day
    console.log(`100 quotes with 2 000 candles stored: ${n} instructions`);
    expect(n).toBeLessThan(5_000_000n);
    const { entries, totalCount } = await bot.getDailyPriceCandles(candleQ({ limit: [10n], newestFirst: [true] }));
    expect(totalCount).toBe(2_000n); // updated in place, nothing appended
    // round robin over 10 pairs: each latest candle got 10 more quotes, closing at its last one
    const byClose = entries.map((c) => [c.quoteCount, c.closeE8s]).sort((a, b) => Number(a[1] - b[1]));
    expect(byClose).toEqual(Array.from({ length: 10 }, (_, p) => [11n, 5_090n + BigInt(p)]));
    expect(entries.every((c) => c.openE8s === 1_199n && c.highE8s === 5_090n + (c.closeE8s - 5_090n) && c.lowE8s === 1_199n)).toBe(true);
  });

  it('getPriceHistory with a pair filter compares principals instead of building a key per entry', async () => {
    await bot.setPriceHistoryMaxSize(20_000n);
    const nowNs = BigInt(Math.round(await pic.getTime())) * 1_000_000n;
    for (let i = 0n; i < 10n; i++) await seed.test_seed_price_history(2_000n, tokenAId, tokenBId, nowNs - 20_000n * 1_000_000_000n + i * 2_000_000_000_000n, 1_000_000_000n, 1n);
    const [a, b] = [tokenAId.toText(), tokenBId.toText()].sort();
    const pk = `${a}:${b}`;
    expect((await bot.getPriceHistory(priceQ({ pairKey: [pk], limit: [1n] }))).totalCount).toBe(20_000n);
    expect((await bot.getPriceHistory(priceQ({ pairKey: [`${a}:${a}`], limit: [1n] }))).totalCount).toBe(0n);
    await bot.addHotkeyPermissions(id, [{ ViewLogs: null }]); // the bot reads itself in the measurement
    const cycles = await seed.test_price_history_query_cycles(pk);
    console.log(`getPriceHistory(pairKey) over 20 000 entries, as a call: ${cycles} cycles`);
    expect(cycles).toBeLessThan(PRICE_FILTER_MAX_CYCLES);
  });

  it('delivers every queued event, and a long backlog no longer makes each batch cost more', async () => {
    const botAlice = actorAs(pic, tradingIdl, id, alice);
    await bot.addHotkeyPermissions(alice, [{ FullPermissions: null }]);
    expect(await botAlice.registerEventListener({ eventTypeIds: [260n] })).toHaveProperty('Ok');
    // a short queue: every delivery is attempted once, in order (alice is not a canister: each fails and is logged)
    const failed = async () => (await bot.getLogs(logFilter({ limit: [500n], source: ['events'] }))).entries
      .filter((e) => e.message.startsWith('Delivery failed')).map((e) => e.tags.find(([k]) => k === 'eventId')[1]);
    const before = (await failed()).length;
    await seed.test_queue_events(25n);
    for (let i = 0; i < 20 && (await failed()).length - before < 25; i++) { await pic.advanceTime(2_500); await pic.tick(4); }
    const got = (await failed()).slice(before);
    expect(got).toHaveLength(25);
    expect(got.map(Number)).toEqual(got.map(Number).slice().sort((x, y) => x - y));
    // what one batch of 10 deliveries costs with nothing behind it, and with 20 000 behind it
    // (measured between batches, when no call is in flight: a pending call reserves cycles)
    await bot.setLogLevel({ Warning: null }); // keep 20 000 'Event queued' lines out of the measurement
    const batchCost = async () => {
      const c0 = await pic.getCyclesBalance(id);
      await pic.advanceTime(2_500); await pic.tick(30);
      return c0 - (await pic.getCyclesBalance(id));
    };
    await seed.test_queue_events(10n);
    const alone = await batchCost();
    for (let i = 0; i < 4; i++) await seed.test_queue_events(5_000n);
    const behind = await batchCost();
    console.log(`one delivery batch: ${alone} cycles alone, ${behind} cycles with 20 000 queued behind it`);
    expect(behind - alone).toBeLessThan(DELIVERY_BACKLOG_MAX_EXTRA_CYCLES);
    await bot.setLogLevel({ Info: null });
  });
});

describe('trading bot: upgrades keep every entry, in order', () => {
  it('from the array logs (the bot before the paging fixes) into the ring buffers', async () => {
    const { id, bot, seed } = await installTrading(`sneed_trading_bot_prepaging_seed`);
    await bot.addToken({ ledgerCanisterId: tokenAId, symbol: 'AAA', decimals: 8, fee: 1_000n });
    await seed.test_seed_logs(700n);
    await seed.test_seed_trade_log(700n, tokenAId);
    await seed.test_seed_snapshots(range(1, 151));
    await seed.test_seed_purse_snapshots('p1', 120n);
    await seed.test_seed_daily(30n, tokenAId, tokenBId);
    // a wrapped price ring: 1 000 slots, 1 500 pushed
    await bot.setPriceHistoryMaxSize(1_000n);
    const nowNs = BigInt(Math.round(await pic.getTime())) * 1_000_000n;
    await seed.test_seed_price_history(1_500n, tokenAId, tokenBId, nowNs - 1_500n * 1_000_000_000n, 1_000_000_000n, 0n);
    const old = {
      logs: (await bot.getLogs(logFilter({ limit: [500n], startId: [0n] }))).entries,
      logCount: (await bot.getLogConfig()).entryCount,
      logNext: (await bot.getLogConfig()).nextId,
      trades: (await bot.getTradeLog(tradeQ({ limit: [700n] }))).entries,
      snaps: (await bot.getPortfolioSnapshots(snapQ({ limit: [150n] }))).entries,
      purse: (await bot.getPursePortfolioSnapshots('p1', snapQ({ limit: [120n] }))).entries,
      prices: (await bot.getPriceHistory(priceQ({ limit: [1_000n] }))).entries,
      sums: (await bot.getDailyPortfolioSummaries(dailyQ())).entries,
      candles: (await bot.getDailyPriceCandles(candleQ({ limit: [100n] }))).entries,
      stats: [await bot.getTradeLogStats(), await bot.getPortfolioSnapshotStats()],
    };
    expect(old.prices).toHaveLength(1_000);
    expect(old.prices[0].quote.expectedOutput).toBe(500n); // the oldest kept
    await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(`${TRADING}_seed`) });
    expect((await bot.getLogs(logFilter({ limit: [500n], startId: [0n] }))).entries).toEqual(old.logs);
    expect((await bot.getLogConfig()).entryCount).toBe(old.logCount);
    expect((await bot.getLogConfig()).nextId).toBe(old.logNext);
    const trades = [];
    while (trades.length < 700) trades.push(...(await bot.getTradeLog(tradeQ({ limit: [500n], offset: [BigInt(trades.length)] }))).entries);
    expect(trades).toEqual(old.trades);
    expect((await bot.getPortfolioSnapshots(snapQ({ limit: [150n] }))).entries).toEqual(old.snaps);
    expect((await bot.getPursePortfolioSnapshots('p1', snapQ({ limit: [120n] }))).entries).toEqual(old.purse);
    expect((await bot.getPriceHistory(priceQ({ limit: [1_000n] }))).entries).toEqual(old.prices);
    expect((await bot.getDailyPortfolioSummaries(dailyQ())).entries).toEqual(old.sums);
    expect(old.candles).toHaveLength(30);
    expect((await bot.getDailyPriceCandles(candleQ({ limit: [100n] }))).entries).toEqual(old.candles);
    // the candle index is rebuilt: a later candle for the pair is appended after the old ones
    await seed.test_seed_daily(31n, tokenAId, tokenBId); // days 0..29 again (updated in place) and day 30 (new)
    const after = (await bot.getDailyPriceCandles(candleQ({ limit: [100n] }))).entries;
    expect(after).toHaveLength(31);
    expect(after[0]).toMatchObject({ quoteCount: 2n, closeE8s: 1n });
    expect(after[30]).toMatchObject({ quoteCount: 1n, closeE8s: 31n });
    expect([await bot.getTradeLogStats(), await bot.getPortfolioSnapshotStats()]).toEqual(old.stats);
    // appending continues the ids and the order
    await seed.test_seed_trade_log(1n, tokenAId);
    expect((await bot.getTradeLog(tradeQ({ limit: [1n] }))).entries[0].id).toBe(old.stats[0].nextId);
    await seed.test_seed_price_history(1n, tokenAId, tokenBId, nowNs, 1n, 9_999n);
    const newest = (await bot.getPriceHistory(priceQ({ limit: [1n], newestFirst: [true] }))).entries[0];
    expect(newest.quote.expectedOutput).toBe(9_999n);
    expect((await bot.getPriceHistory(priceQ({ limit: [1n] }))).entries[0].quote.expectedOutput).toBe(501n);
  });

  it('from the published 0.9.3 (releases/trading_bot/0.9.3)', async () => {
    const id = await pic.createCanister({ sender: admin, cycles: 50n * T, targetSubnetId: appSubnet, controllers: [admin] });
    await pic.installCode({ sender: admin, canisterId: id, wasm: published('trading_bot/0.9.3/sneed_trading_bot.wasm'), arg: new Uint8Array([0x44, 0x49, 0x44, 0x4c, 0, 0]) });
    const bot = actorAs(pic, tradingIdl, id, admin);
    expect(await bot.getVersion()).toEqual({ major: 0n, minor: 9n, patch: 3n });
    await bot.addToken({ ledgerCanisterId: tokenAId, symbol: 'AAA', decimals: 8, fee: 1_000n });
    await actorAs(pic, ledgerIdl, tokenAId, admin).mint(account(id), 10_000_000n);
    for (let i = 0; i < 3; i++) expect(await bot.withdrawToken(tokenAId, 10_000n + BigInt(i), account(dave))).toHaveProperty('Ok');
    const before = {
      logs: (await bot.getLogs(logFilter({ limit: [500n] }))).entries,
      trades: (await bot.getTradeLog(tradeQ({ limit: [500n] }))).entries,
      tradeStats: await bot.getTradeLogStats(),
      snaps: (await bot.getPortfolioSnapshots(snapQ({ limit: [200n] }))).entries,
      registry: await bot.getTokenRegistry(),
    };
    expect(before.trades.length).toBeGreaterThanOrEqual(3);
    await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(TRADING) });
    expect(await bot.getVersion()).toEqual({ major: 0n, minor: 9n, patch: 4n });
    const logs = (await bot.getLogs(logFilter({ limit: [500n] }))).entries;
    expect(logs.slice(0, before.logs.length)).toEqual(before.logs);
    expect((await bot.getTradeLog(tradeQ({ limit: [500n] }))).entries).toEqual(before.trades);
    expect(await bot.getTradeLogStats()).toEqual(before.tradeStats);
    expect((await bot.getPortfolioSnapshots(snapQ({ limit: [200n] }))).entries).toEqual(before.snaps);
    expect(await bot.getTokenRegistry()).toEqual(before.registry);
    // it keeps working: a withdrawal is logged after the old entries, newest first
    expect(await bot.withdrawToken(tokenAId, 12_345n, account(dave))).toHaveProperty('Ok');
    const after = (await bot.getTradeLog(tradeQ({ limit: [500n] }))).entries;
    expect(after.slice(1)).toEqual(before.trades);
    expect(after[0]).toMatchObject({ inputAmount: 12_345n, id: before.tradeStats.nextId });
  });
});

describe('staking bot: the log', () => {
  let id, bot, seed;
  beforeAll(async () => {
    id = await install(pic, { name: `${STAKING}_seed`, targetSubnetId: appSubnet });
    bot = actorAs(pic, stakingIdl, id, admin);
    seed = actorAs(pic, seedIdl, id, admin);
  });

  it('caps setMaxLogEntries at 50 000', async () => {
    await bot.setMaxLogEntries(1_000_000n);
    expect((await bot.getLogConfig()).maxEntries).toBe(50_000n);
    await bot.setMaxLogEntries(10_000n);
    expect((await bot.getLogConfig()).maxEntries).toBe(10_000n);
  });

  it('a log line with 10 000 lines stored costs about what it costs in an empty log', async () => {
    for (let i = 0; i < 5; i++) await seed.test_seed_logs(2_000n);
    expect((await bot.getLogConfig()).entryCount).toBe(10_000n);
    const n = await seed.test_seed_logs(100n);
    console.log(`staking bot, 100 log lines with a full 10 000-line log: ${n} instructions`);
    expect(n).toBeLessThan(10_000_000n);
  });

  it('getLogs returns at most 500 and pages back with beforeId; shrinking keeps the newest', async () => {
    const r = await bot.getLogs(logFilter({ limit: [5_000n] }));
    expect(r.entries).toHaveLength(500);
    const older = await bot.getLogs(logFilter({ limit: [10n], beforeId: [r.entries[0].id] }));
    expect(older.entries.map((e) => e.id)).toEqual(Array.from({ length: 10 }, (_, i) => r.entries[0].id - 10n + BigInt(i)));
    const next = (await bot.getLogConfig()).nextId;
    await bot.setMaxLogEntries(100n);
    const kept = (await bot.getLogs(logFilter({ limit: [500n] }))).entries;
    expect(kept).toHaveLength(100);
    expect(kept.at(-1).id).toBe(next); // the setMaxLogEntries line itself is the newest
    await bot.setMaxLogEntries(10_000n);
  });

  it('upgrades from the published 0.9.4 (releases/icp_staking_bot/0.9.4) with its log intact', async () => {
    const sid = await pic.createCanister({ sender: admin, cycles: 50n * T, targetSubnetId: appSubnet, controllers: [admin] });
    await pic.installCode({ sender: admin, canisterId: sid, wasm: published('icp_staking_bot/0.9.4/sneed_icp_staking_bot.wasm'), arg: new Uint8Array([0x44, 0x49, 0x44, 0x4c, 0, 0]) });
    const sb = actorAs(pic, stakingIdl, sid, admin);
    expect(await sb.getVersion()).toEqual({ major: 0n, minor: 9n, patch: 4n });
    await sb.setMaxLogEntries(300n);
    for (let i = 0; i < 400; i += 1) await sb.setLogLevel({ Info: null }); // each call logs a line
    const before = (await sb.getLogs(logFilter({ limit: [500n] }))).entries;
    const cfg = await sb.getLogConfig();
    expect(before).toHaveLength(300);
    await pic.upgradeCanister({ sender: admin, canisterId: sid, wasm: wasm(STAKING) });
    expect(await sb.getVersion()).toEqual({ major: 0n, minor: 9n, patch: 5n });
    expect((await sb.getLogs(logFilter({ limit: [500n] }))).entries).toEqual(before);
    expect(await sb.getLogConfig()).toEqual(cfg);
    await sb.setLogLevel({ Info: null });
    const after = (await sb.getLogs(logFilter({ limit: [500n] }))).entries;
    expect(after).toHaveLength(300);
    expect(after.slice(0, 299)).toEqual(before.slice(1));
    expect(after.at(-1).id).toBe(cfg.nextId);
  });
});
