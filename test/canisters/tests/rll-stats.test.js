// RLL event statistics (src/sneed_rewards, get_event_statistics): running counters instead of a
// full scan of the event lists, rebuilt by one pass in postupgrade.
// - Upgrades from the production build (commit 75cef0a7, build/rll_prod.wasm) and from the
//   ICRC-3 build (commit 2d6abe89, proposal #443, build/rll_icrc3.wasm): the statistics after
//   the upgrade equal what the old full scan returned, and stay equal to a full scan (computed
//   here from the event lists) as distributions, claims and resets follow.
// - Event lists that are not in time order (only possible for a synthetic history) still give
//   the full-scan figures.
// - A production-sized history (500k owner credits, seeded through the test-only method of
//   build/rll_prod_seed.wasm): the old get_event_statistics exceeds the query instruction limit,
//   the new one answers; the rebuild's cost is measured; the per-owner and paged queries.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, account, admin, alice, bob, carol, user, SNEED_GOVERNANCE, T, unwrap, errOf, wasm, nowNs } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { rllGovernanceIdl, icpswapListIdl, neuronSpec, hex } from '../lib/idl-rll.js';
import { idlFactory as rllIdl } from '../build/rll.did.js';

// RLL_WASM=rll_icrc3 npx vitest run tests/rll-stats.test.js upgrades to the #443 code instead (fails)
const NEW_WASM = process.env.RLL_WASM || 'rll';
const ICPSWAP_LIST_ID = Principal.fromText('k37c6-riaaa-aaaag-qcyza-cai');
const DAY_NS = 86_400_000_000_000n;
const FEE_A = 1_000n;
const FEE_B = 10_000n;
const erin = user('erin');

let pic, appSubnet, gov, list, tokA, tokB, tokAId, tokBId;

const as = (id, p = admin) => actorAs(pic, rllIdl, id, p);
const advance = async (seconds, ticks = 6) => { await pic.advanceTime(seconds * 1000); await pic.tick(ticks); };
async function runUntilIdle(actor, max = 60) {
  for (let i = 0; i < max; i++) {
    await advance(16);
    if ((await actor.get_import_stage()).startsWith('idle (no timer)')) return;
  }
  throw new Error(`cycle did not finish: ${await actor.get_import_stage()}`);
}
const ballot = (vote, vp) => ({ vote, cast_timestamp_seconds: 1n, voting_power: vp });
const listToken = (id, symbol, fee) => ({ canisterId: id.toText(), decimals: 8n, fee, name: `${symbol} token`, symbol, standard: 'ICRC1' });

/// per_token lists in a stable order (the canister returns hash-map order)
const sortPerToken = (x) => [...x].map(([p, n]) => [p.toText(), n]).sort(([a], [b]) => a.localeCompare(b));
const normalize = (s) => {
  const period = (p) => ({
    server_distributions: { ...p.server_distributions, per_token: sortPerToken(p.server_distributions.per_token) },
    user_distributions: { ...p.user_distributions, per_token: sortPerToken(p.user_distributions.per_token) },
    claims: { ...p.claims, per_token: sortPerToken(p.claims.per_token) },
  });
  return { all_time: period(s.all_time), last_24h: period(s.last_24h) };
};

/// what the old get_event_statistics computed: a full scan of the three lists
function fullScan(dist, userDist, claims, now) {
  const cutoff = now - DAY_NS;
  const add = (m, k, n) => m.set(k, (m.get(k) ?? 0n) + n);
  const period = (inWindow) => {
    const sAmt = new Map(), uAmt = new Map(), cAmt = new Map(), users = new Set(), cUsers = new Set();
    let sN = 0n, uN = 0n, cN = 0n, ok = 0n, failed = 0n, pending = 0n;
    for (const e of dist) if (inWindow(BigInt(e.timestamp))) { sN++; add(sAmt, e.token_id.toText(), e.amount); }
    for (const e of userDist) if (inWindow(BigInt(e.timestamp))) { uN++; users.add(e.user.toText()); add(uAmt, e.token_id.toText(), e.amount); }
    for (const e of claims) {
      if (!inWindow(BigInt(e.timestamp))) continue;
      cN++; cUsers.add(e.hotkey.toText());
      if ('Success' in e.status) { ok++; add(cAmt, e.token_id.toText(), e.amount); } else if ('Failed' in e.status) failed++; else pending++;
    }
    const pt = (m) => [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
    return {
      server_distributions: { total: sN, per_token: pt(sAmt) },
      user_distributions: { total: uN, unique_users: BigInt(users.size), per_token: pt(uAmt) },
      claims: { total: cN, successful: ok, failed, pending, unique_users: BigInt(cUsers.size), per_token: pt(cAmt) },
    };
  };
  return { all_time: period(() => true), last_24h: period((t) => t >= cutoff) };
}
const scanOf = async (r) => fullScan(await r.get_distribution_events(), await r.get_user_distribution_events(), await r.get_claim_events(), await nowNs(pic));
const statsOf = async (r) => normalize(await r.get_event_statistics());

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  const govId = await install(pic, { name: 'MockRllGovernance', targetCanisterId: SNEED_GOVERNANCE });
  const listId = await install(pic, { name: 'MockIcpSwapTokenList', targetCanisterId: ICPSWAP_LIST_ID });
  tokAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  tokBId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_B, symbol: 'BBB', decimals: 8 }], targetSubnetId: appSubnet });
  gov = actorAs(pic, rllGovernanceIdl, govId, admin);
  list = actorAs(pic, icpswapListIdl, listId, admin);
  tokA = actorAs(pic, ledgerIdl, tokAId, admin);
  tokB = actorAs(pic, ledgerIdl, tokBId, admin);
  const A = [0x0a, 0x01], B = [0x0b, 0x01], E = [0x0e, 0x01];
  await gov.add_neuron(neuronSpec({ id: A, owner: alice, stake: 100_000_000n, dissolve: 1000n }));
  await gov.add_neuron(neuronSpec({ id: B, owner: bob, hotkeys: [carol], hotkeysFirst: true, stake: 300_000_000n, dissolve: 500n }));
  await gov.add_neuron(neuronSpec({ id: E, owner: erin, stake: 100_000_000n, dissolve: 500n }));
  const now = BigInt(Math.floor((await pic.getTime()) / 1000));
  await gov.set_proposal({ id: 1n, title: 'One', deadline_seconds: now - 1000n, ballots: [[hex(A), ballot(1, 300n)], [hex(B), ballot(2, 200n)], [hex(E), ballot(1, 100n)]] });
  await list.set_list([listToken(tokAId, 'AAA', FEE_A), listToken(tokBId, 'BBB', FEE_B)]);
}, 180_000);

afterAll(async () => { await pic?.tearDown(); });

/// one daily cycle sharing fresh rewards, then claims: some paid, one refused by the ledger (BadFee)
async function activity(id, round) {
  const r = as(id);
  await tokA.mint(account(id), 600_000n + BigInt(round) * 1_000n);
  if (round % 2 === 0) await tokB.mint(account(id), 6_000_000n);
  unwrap(await r.start_distribution_cycle());
  await runUntilIdle(r);
  unwrap(await as(id, alice).claim_full_balance_of_hotkey(tokAId, FEE_A));
  errOf(await as(id, erin).claim_full_balance_of_hotkey(tokAId, 999n)); // Pending, then Failed
  if (round % 2 === 1) unwrap(await as(id, carol).claim_full_balance_of_hotkey(tokAId, FEE_A)); // bob's hotkey
}

describe.each([
  ['the production build (75cef0a7)', 'rll_prod'],
  ['the ICRC-3 build (2d6abe89, #443)', 'rll_icrc3'],
])('upgrade from %s', (_label, oldWasm) => {
  let id, r;
  beforeAll(async () => {
    id = await install(pic, { name: oldWasm, cycles: 50n * T, targetSubnetId: appSubnet });
    r = as(id);
    await activity(id, 0);
    await advance(25 * 3600); // the first round leaves the 24h window
    await activity(id, 1);
  }, 600_000);

  it('keeps the statistics the old full scan computed, then stays equal to a full scan', async () => {
    const old = await statsOf(r);
    // the reference scan reproduces the old canister's figures
    expect(await scanOf(r)).toEqual(old);
    expect(old.all_time.claims.failed).toBe(2n);
    expect(old.last_24h.claims.total).toBeLessThan(old.all_time.claims.total);
    expect(old.last_24h.user_distributions.total).toBeLessThan(old.all_time.user_distributions.total);
    expect(old.last_24h.server_distributions.total).toBeGreaterThan(0n);

    await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(NEW_WASM), arg: IDL.encode([], []) });
    await pic.tick(2);
    expect(await statsOf(r)).toEqual(old);
    const status = await r.get_event_statistics_status();
    expect(status).toMatchObject({
      distribution_events: BigInt((await r.get_distribution_events()).length),
      user_distribution_events: BigInt((await r.get_user_distribution_events()).length),
      claim_events: BigInt((await r.get_claim_events()).length),
    });
    expect(status.rebuild_instructions).toBeGreaterThan(0n);
    expect(status.postupgrade_instructions).toBeGreaterThanOrEqual(status.rebuild_instructions);

    // appended events update the counters: more rounds, one of them a day later
    await activity(id, 2);
    expect(await statsOf(r)).toEqual(await scanOf(r));
    await advance(25 * 3600);
    expect(await statsOf(r)).toEqual(await scanOf(r)); // the window moved on, nothing appended
    await activity(id, 3);
    const after = await statsOf(r);
    expect(after).toEqual(await scanOf(r));
    expect(after.all_time.user_distributions.unique_users).toBe(3n);
    expect(after.all_time.claims.unique_users).toBe(3n);

    // another upgrade (from the new code) rebuilds the same figures
    await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(NEW_WASM), arg: IDL.encode([], []) });
    await pic.tick(2);
    expect(await statsOf(r)).toEqual(after);
  });

  it('serves the per-owner lists from the index and pages the full lists', async () => {
    const all = await r.get_user_distribution_events();
    for (const p of [alice, bob, erin, carol]) {
      expect(await r.get_user_specific_distribution_events(p)).toEqual(all.filter((e) => e.user.toText() === p.toText()));
      for (const tok of [tokAId, tokBId]) {
        expect(await r.get_user_token_distribution_events(p, tok)).toEqual(all.filter((e) => e.user.toText() === p.toText() && e.token_id.toText() === tok.toText()));
      }
    }
    const pageAll = async (fn, total) => {
      const out = [];
      for (let s = 0n; s < total; s += 3n) {
        const page = await fn(s, 3n);
        expect(page.total).toBe(total);
        out.push(...page.events);
      }
      return out;
    };
    expect(await pageAll((s, n) => r.get_user_distribution_events_page(s, n), BigInt(all.length))).toEqual(all);
    const dist = await r.get_distribution_events();
    expect(await pageAll((s, n) => r.get_distribution_events_page(s, n), BigInt(dist.length))).toEqual(dist);
    const claims = await r.get_claim_events();
    expect(await pageAll((s, n) => r.get_claim_events_page(s, n), BigInt(claims.length))).toEqual(claims);
    expect(await r.get_claim_events_page(BigInt(claims.length) + 5n, 10n)).toEqual({ total: BigInt(claims.length), events: [] });
  });

  it('resets: clearing a list clears its figures and keeps the others', async () => {
    await r.clear_claim_events();
    const s = await statsOf(r);
    expect(s).toEqual(await scanOf(r));
    expect(s.all_time.claims).toEqual({ total: 0n, successful: 0n, failed: 0n, pending: 0n, unique_users: 0n, per_token: [] });
    expect(s.all_time.user_distributions.total).toBeGreaterThan(0n);
    await activity(id, 4);
    expect(await statsOf(r)).toEqual(await scanOf(r));
    await r.clear_all_balances_and_distributions();
    expect(await statsOf(r)).toEqual(await scanOf(r));
    expect(await r.get_user_specific_distribution_events(alice)).toEqual([]);
    expect((await statsOf(r)).all_time.user_distributions).toEqual({ total: 0n, unique_users: 0n, per_token: [] });
  });
});

// The seeding method of the test-only build/rll_prod_seed.wasm (canisters/rll_seed_events.mo.part).
const seedIdl = ({ IDL }) => IDL.Service({
  test_seed_events: IDL.Func([IDL.Nat, IDL.Vec(IDL.Principal), IDL.Nat, IDL.Nat, IDL.Int, IDL.Int, IDL.Nat], [IDL.Nat], []),
});
const seedUser = (u) => Principal.fromUint8Array(Uint8Array.from([0x5e, u >> 8, u & 255, 0x01]));

describe('event lists out of time order (synthetic)', () => {
  it('give the full-scan figures in the 24h window', async () => {
    const id = await install(pic, { name: 'rll_prod_seed', cycles: 50n * T, targetSubnetId: appSubnet });
    const seed = actorAs(pic, seedIdl, id, admin);
    const r = as(id);
    const now = await nowNs(pic);
    const H = 3_600_000_000_000n;
    // recent, then a month old, then recent again, then a few hours old: three unsorted runs
    await seed.test_seed_events(3n, [tokAId, tokBId], 0n, 1n, now - H / 6n, 0n, 2n);
    await seed.test_seed_events(4n, [tokAId], 1n, 3n, now - 30n * DAY_NS, DAY_NS, 1n);
    await seed.test_seed_events(2n, [tokBId], 4n, 2n, now - 2n * H, H / 2n, 3n);
    await seed.test_seed_events(5n, [tokAId], 6n, 2n, now - 5n * H, H, 2n);
    const old = await statsOf(r);
    expect(old).toEqual(await scanOf(r));
    await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(NEW_WASM), arg: IDL.encode([], []) });
    await pic.tick(2);
    expect(await statsOf(r)).toEqual(old);
    // later, more of the history leaves the window (steps avoid landing on a timestamp's 24h mark):
    // first the end of the list, then its middle, then only the unsorted head is left, then nothing
    for (const hours of [1.25, 2, 18.5, 1.5, 0.5, 30 * 24]) {
      await advance(hours * 3600, 1);
      expect(await statsOf(r)).toEqual(await scanOf(r));
    }
  });
});

describe('a production-sized history', () => {
  const USERS = 1000, TOKENS = 5, ROUNDS = 100, CLAIMS = 20;
  let id, r, tokens, now;
  beforeAll(async () => {
    id = await install(pic, { name: 'rll_prod_seed', cycles: 200n * T, targetSubnetId: appSubnet });
    r = as(id);
    const seed = actorAs(pic, seedIdl, id, admin);
    tokens = Array.from({ length: TOKENS }, (_, k) => Principal.fromUint8Array(Uint8Array.from([0x70, k, 0x01, 0x01])));
    now = await nowNs(pic);
    // rounds 0..98 a day apart ending ~3 days ago, round 99 an hour ago (inside the 24h window)
    for (let first = 0; first < ROUNDS - 1; first += 11) {
      const n = Math.min(11, ROUNDS - 1 - first);
      await seed.test_seed_events(BigInt(USERS), tokens, BigInt(first), BigInt(n), now - BigInt(ROUNDS + 2 - first) * DAY_NS, DAY_NS, BigInt(CLAIMS));
    }
    expect(await seed.test_seed_events(BigInt(USERS), tokens, BigInt(ROUNDS - 1), 1n, now - 3_600_000_000_000n, 0n, BigInt(CLAIMS)))
      .toBe(BigInt(USERS * TOKENS * ROUNDS));
  }, 600_000);

  /// the figures the seeded history must give, from the seeding formula
  function expected() {
    const period = (rounds) => {
      const uAmt = new Map(), cAmt = new Map();
      let ok = 0n, failed = 0n;
      for (const rd of rounds) {
        for (let k = 0; k < TOKENS; k++) {
          // sum over u of (u + 1) * (k + 1) + rd
          const sum = BigInt((k + 1) * USERS * (USERS + 1) / 2 + rd * USERS);
          uAmt.set(tokens[k].toText(), (uAmt.get(tokens[k].toText()) ?? 0n) + sum);
        }
        for (let c = 0; c < CLAIMS; c++) {
          if (c % 3 === 2) { failed++; continue; }
          ok++;
          const t = tokens[c % TOKENS].toText();
          cAmt.set(t, (cAmt.get(t) ?? 0n) + BigInt(100 + rd));
        }
      }
      const pt = (m) => [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
      const n = BigInt(rounds.length);
      return {
        server_distributions: { total: n * BigInt(TOKENS), per_token: pt(uAmt) },
        user_distributions: { total: n * BigInt(TOKENS * USERS), unique_users: BigInt(USERS), per_token: pt(uAmt) },
        claims: { total: n * BigInt(2 * CLAIMS), successful: ok, failed, pending: n * BigInt(CLAIMS), unique_users: BigInt(CLAIMS), per_token: pt(cAmt) },
      };
    };
    return { all_time: period([...Array(ROUNDS).keys()]), last_24h: period([ROUNDS - 1]) };
  }

  it('the old full scan exceeds the query instruction limit; after the upgrade the counters answer', async () => {
    await expect(r.get_event_statistics()).rejects.toThrow(/instructions/);
    await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(NEW_WASM), arg: IDL.encode([], []) });
    await pic.tick(2);
    expect(await statsOf(r)).toEqual(expected());
    const status = await r.get_event_statistics_status();
    console.log(`rebuild of ${status.user_distribution_events} owner credits, ${status.distribution_events} distributions, ${status.claim_events} claim events: `
      + `${status.rebuild_instructions} instructions (post-upgrade step in all: ${status.postupgrade_instructions})`);
    expect(status.user_distribution_events).toBe(BigInt(USERS * TOKENS * ROUNDS));
    // far inside the upgrade limit (300B), with room for many times this history
    expect(status.postupgrade_instructions).toBeLessThan(30_000_000_000n);
    // and a second upgrade from the new code (preupgrade + rebuild) also goes through, once
    // PocketIC's install_code rate limit (instructions spent by recent installs) has recovered
    for (let i = 0; i < 10; i++) await advance(60, 50);
    await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(NEW_WASM), arg: IDL.encode([], []) });
    await pic.tick(2);
    expect(await statsOf(r)).toEqual(expected());
  }, 600_000);

  it('the per-owner queries use the index; the paged queries cap a page', async () => {
    const mine = await r.get_user_specific_distribution_events(seedUser(7));
    expect(mine).toHaveLength(TOKENS * ROUNDS);
    expect(mine.every((e) => e.user.toText() === seedUser(7).toText())).toBe(true);
    expect(mine.map((e) => e.amount)).toEqual(Array.from({ length: TOKENS * ROUNDS }, (_, i) => BigInt(8 * ((i % TOKENS) + 1) + Math.floor(i / TOKENS))));
    const one = await r.get_user_token_distribution_events(seedUser(999), tokens[2]);
    expect(one.map((e) => e.amount)).toEqual(Array.from({ length: ROUNDS }, (_, rd) => BigInt(1000 * 3 + rd)));
    expect(await r.get_user_specific_distribution_events(alice)).toEqual([]);
    const total = BigInt(USERS * TOKENS * ROUNDS);
    const page = await r.get_user_distribution_events_page(0n, 100_000n);
    expect(page.total).toBe(total);
    expect(page.events).toHaveLength(2000);
    const last = await r.get_user_distribution_events_page(total - 3n, 10n);
    expect(last.events.map((e) => e.user.toText())).toEqual([997, 998, 999].map((u) => seedUser(u).toText()));
    expect((await r.get_claim_events_page(0n, 5000n)).events).toHaveLength(2000);
    expect((await r.get_distribution_events_page(0n, 5000n)).events).toHaveLength(TOKENS * ROUNDS);
    // the whole list does not fit a response: why the paged version exists
    await expect(r.get_user_distribution_events()).rejects.toThrow(/payload|size|large/i);
  }, 300_000);
});
