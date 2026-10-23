// RLL paging and growth fixes (src/sneed_rewards; spec/paging_audit.md U1, U2, S1, S2) and its
// rate limits (src/RateLimit.mo).
// - U1 get_user_distribution_events: beyond one page it refuses with a pointer to the paged
//   method (the old one failed on the reply size, IC0504).
// - U2 get_user_voting_history: served from a per-neuron ballot index (the old one scanned every
//   ballot and exceeded the query instruction limit at production size); a paged variant.
// - S1/S2 get_hotkey_voting_power and the daily distribution: a cached per-neuron cast-voting-
//   power index, kept up to date at proposal import and rebuilt in postupgrade, instead of a
//   walk over every ballot per call / per token. Crediting splits into chunks of
//   credit_chunk_size owners per message when there are more owners than that.
// - Rate limits on claim_full_balance_of_hotkey, balances_of_hotkey and balance_reconciliation,
//   admin-settable.
// Old and new give the same results: the same dataset in a canister running the production
// code (build/rll_prepaging.wasm, commit ea66c7eb, module c5e52913… on mainnet) and in one
// upgraded from it to the new code, side by side; and at production size (seeded through the
// test-only methods of build/rll_prepaging_seed.wasm), before and after the upgrade.
// RLL_WASM=rll_prepaging npx vitest run tests/rll-paging.test.js "upgrades" to the old code (fails).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, account, admin, alice, bob, carol, user, SNEED_GOVERNANCE, T, unwrap, errOf, wasm, refusedAtIngress } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { rllGovernanceIdl, icpswapListIdl, neuronSpec, hex } from '../lib/idl-rll.js';
import { idlFactory as rllIdl } from '../build/rll.did.js';

const NEW_WASM = process.env.RLL_WASM || 'rll';
const ICPSWAP_LIST_ID = Principal.fromText('k37c6-riaaa-aaaag-qcyza-cai');
const EXCLUDED = Principal.fromText('umo43-o3yqa-363iw-wroso-jm5az-kmfp2-rdzoj-q7il2-zfhcj-l35r7-oqe');
const FEE_A = 1_000n;
const dave = user('dave');
const erin = user('erin');

let pic, appSubnet, gov, list, tokA, tokAId;

const as = (id, p = admin) => actorAs(pic, rllIdl, id, p);
const advance = async (seconds, ticks = 6) => { await pic.advanceTime(seconds * 1000); await pic.tick(ticks); };
const nowS = async () => BigInt(Math.floor((await pic.getTime()) / 1000));
const listToken = (id, symbol, fee) => ({ canisterId: id.toText(), decimals: 8n, fee, name: `${symbol} token`, symbol, standard: 'ICRC1' });
/// upgrades, then (new code) runs the timer until the vote index is rebuilt; `during` sees the
/// canister before the first rebuild slice ran
const upgrade = async (id, name = NEW_WASM, during = null) => {
  await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(name), arg: IDL.encode([], []) });
  if (during) await during();
  for (let i = 0; i < 200; i++) {
    await pic.tick();
    let st;
    try { st = await as(id).get_vote_index_status(); } catch { return; } // the old code has no index
    if (st.ready) return st;
  }
  throw new Error('vote index rebuild did not finish');
};

/// runs a distribution cycle in every canister at once, until all are idle
async function cycleAll(ids, max = 80) {
  for (const id of ids) unwrap(await as(id).start_distribution_cycle());
  for (let i = 0; i < max; i++) {
    await advance(16);
    const stages = await Promise.all(ids.map((id) => as(id).get_import_stage()));
    if (stages.every((s) => s.startsWith('idle (no timer)'))) return;
  }
  throw new Error('cycle did not finish');
}

const txt = (p) => p.toText();
const sortedBalances = async (id) => (await as(id).get_all_user_balances())
  .map(([o, bs]) => [txt(o), bs.map(([t, n]) => [txt(t), n]).sort()]).sort(([a], [b]) => a.localeCompare(b));
/// every user distribution event, without its timestamp, in a stable order
async function userEvents(id) {
  const r = as(id);
  const out = [];
  const total = (await r.get_user_distribution_events_page(0n, 0n)).total;
  for (let s = 0n; s < total; s += 2000n) {
    for (const e of (await r.get_user_distribution_events_page(s, 2000n)).events) {
      out.push(`${txt(e.user)}|${txt(e.token_id)}|${e.amount}|${e.proposal_range.first}-${e.proposal_range.last}`);
    }
  }
  return out.sort();
}

/// a governance Neuron record as get_hotkey_voting_power takes it (only id and permissions matter)
const neuronRecord = (idBytes, owner, hotkeys = []) => ({
  id: [{ id: Uint8Array.from(idBytes) }],
  staked_maturity_e8s_equivalent: [],
  permissions: [
    ...(owner ? [{ principal: [owner], permission_type: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }] : []),
    ...hotkeys.map((h) => ({ principal: [h], permission_type: [3, 4] })),
  ],
  maturity_e8s_equivalent: 0n, cached_neuron_stake_e8s: 1n, created_timestamp_seconds: 0n, source_nns_neuron_id: [],
  auto_stake_maturity: [], aging_since_timestamp_seconds: 0n, dissolve_state: [], voting_power_percentage_multiplier: 100n,
  vesting_period_seconds: [], disburse_maturity_in_progress: [], followees: [], neuron_fees_e8s: 0n,
});
const vpKey = (r) => ({
  owners: r.neurons_by_owner.map(([o, ns]) => [txt(o), ns.length]).sort(([a], [b]) => a.localeCompare(b)),
  total: r.total_voting_power, distribution: r.distribution_voting_power,
});

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  const govId = await install(pic, { name: 'MockRllGovernance', targetCanisterId: SNEED_GOVERNANCE });
  const listId = await install(pic, { name: 'MockIcpSwapTokenList', targetCanisterId: ICPSWAP_LIST_ID });
  tokAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  gov = actorAs(pic, rllGovernanceIdl, govId, admin);
  list = actorAs(pic, icpswapListIdl, listId, admin);
  tokA = actorAs(pic, ledgerIdl, tokAId, admin);
  await list.set_list([listToken(tokAId, 'AAA', FEE_A)]);
}, 180_000);

afterAll(async () => { await pic?.tearDown(); });

// ---------------------------------------------------------------------------------------------
// The import path, side by side: `ref` keeps the production code, `sut` is upgraded to the new
// code after the first cycle. Every step must give both the same balances, credits, hotkey
// voting power and voting histories.
// ---------------------------------------------------------------------------------------------
describe('the same results as the old full scans (import path, production code side by side)', () => {
  // neurons 0..N-1: owner (i % 9) of OWNERS; every 4th has carol as a hotkey; neuron 5 belongs
  // to the exclusion principal; neuron 7 has no owner permission (erin is its hotkey)
  const N = 36;
  const OWNERS = [alice, bob, dave, user('o3'), user('o4'), user('o5'), user('o6'), user('o7'), user('o8')];
  const nid = (i) => [0x51, i];
  const ownerOf = (i) => (i === 5 ? EXCLUDED : i === 7 ? null : OWNERS[i % OWNERS.length]);
  const hotkeysOf = (i) => (i === 7 ? [erin] : i % 4 === 0 ? [carol] : []);
  // ballots of proposal p: every neuron j with (p + j) % 3 != 1, plus one neuron rll never
  // imported; cast when (p * j) % 5 != 0 (else vote 0); neuron 11 casts with voting power 0
  const ballotsOf = (p, extra = 0) => {
    const out = [];
    for (let j = 0; j < N + extra; j++) {
      if ((p + j) % 3 === 1) continue;
      const cast = (p * j) % 5 !== 0;
      out.push([hex(nid(j)), { vote: cast ? (j % 2 ? 1 : 2) : 0, cast_timestamp_seconds: BigInt(p * 100 + j), voting_power: j === 11 ? 0n : BigInt(1_000 + 37 * j + p) }]);
    }
    out.push([hex([0x99, p]), { vote: 1, cast_timestamp_seconds: 1n, voting_power: 5_000n }]);
    return out;
  };
  let ref, sut, now;
  const ids = () => [ref, sut];

  async function compare(label) {
    expect(await sortedBalances(sut), label).toEqual(await sortedBalances(ref));
    expect(await userEvents(sut), label).toEqual(await userEvents(ref));
    const sets = [
      [],
      [neuronRecord(nid(0), alice, [carol])],
      Array.from({ length: N }, (_, i) => neuronRecord(nid(i), ownerOf(i), hotkeysOf(i))),
      [neuronRecord(nid(5), EXCLUDED), neuronRecord(nid(11), OWNERS[2]), neuronRecord(nid(11), OWNERS[2]), neuronRecord([0x99, 3], null)],
    ];
    for (const s of sets) expect(vpKey(await as(sut).get_hotkey_voting_power(s)), label).toEqual(vpKey(await as(ref).get_hotkey_voting_power(s)));
    for (const p of [alice, bob, carol, erin, EXCLUDED, user('nobody')]) {
      // the same entries (the order is the proposal map's, which an upgrade reshuffles even for the old code)
      const byId = (h) => [...h].sort((a, b) => Number(a.proposal_id - b.proposal_id));
      expect(byId(await as(sut).get_user_voting_history(p)), label).toEqual(byId(await as(ref).get_user_voting_history(p)));
    }
  }

  beforeAll(async () => {
    for (let i = 0; i < N; i++) {
      await gov.add_neuron(neuronSpec({ id: nid(i), owner: ownerOf(i), hotkeys: hotkeysOf(i), stake: 100_000_000n, dissolve: 1000n }));
    }
    now = await nowS();
    for (let p = 1; p <= 12; p++) await gov.set_proposal({ id: BigInt(p), title: `P${p}`, deadline_seconds: now - 1000n, ballots: ballotsOf(p) });
    // 13 and 14 still open
    for (let p = 13; p <= 14; p++) await gov.set_proposal({ id: BigInt(p), title: `P${p}`, deadline_seconds: now + 3n * 86_400n, ballots: ballotsOf(p).slice(0, 10) });
    ref = await install(pic, { name: 'rll_prepaging', cycles: 50n * T, targetSubnetId: appSubnet });
    sut = await install(pic, { name: 'rll_prepaging', cycles: 50n * T, targetSubnetId: appSubnet });
  }, 300_000);

  it('a first cycle, then the upgrade of one of them from the production code', async () => {
    for (const id of ids()) await tokA.mint(account(id), 10_000_000n);
    await cycleAll(ids());
    const before = await sortedBalances(ref);
    expect(before.length).toBeGreaterThan(5);
    expect(before.find(([o]) => o === txt(EXCLUDED))).toBeUndefined();
    await upgrade(sut);
    const st = await as(sut).get_vote_index_status();
    expect(st).toMatchObject({ proposals: 14n, indexed_through: 14n });
    await compare('after the upgrade');
  });

  it('open proposals re-imported with more ballots, then closing; new proposals', async () => {
    for (let p = 13; p <= 14; p++) await gov.set_proposal({ id: BigInt(p), title: `P${p}`, deadline_seconds: now + 3n * 86_400n, ballots: ballotsOf(p) });
    for (const id of ids()) await tokA.mint(account(id), 7_000_000n);
    await cycleAll(ids());
    await compare('open proposals re-imported');
    await advance(4 * 86_400);
    now = await nowS();
    for (let p = 15; p <= 18; p++) await gov.set_proposal({ id: BigInt(p), title: `P${p}`, deadline_seconds: p === 18 ? now + 86_400n : now - 10n, ballots: ballotsOf(p, 3) });
    for (const id of ids()) await tokA.mint(account(id), 9_000_000n);
    await cycleAll(ids());
    await compare('proposals closed, new ones');
    expect((await as(sut).get_vote_index_status()).indexed_through).toBe(18n);
  });

  it('clear_imported_props and an upgrade of the new code rebuild the same index', async () => {
    for (const id of ids()) await as(id).clear_imported_props();
    await pic.tick(2); // the (empty) rebuild's one slice
    expect((await as(sut).get_vote_index_status()).ready).toBe(true);
    expect((await as(sut).get_vote_index_status()).indexed_through).toBe(0n);
    await compare('props cleared');
    // proposals 1..18 imported again by the next cycle (the import starts after the highest closed: none)
    for (const id of ids()) await tokA.mint(account(id), 3_000_000n);
    await cycleAll(ids());
    await compare('imported again');
    await upgrade(sut);
    await compare('after an upgrade of the new code');
    const st = await as(sut).get_vote_index_status();
    expect(st.proposals).toBe(18n);
    expect(st.rebuild_instructions).toBeGreaterThan(0n);
  });

  it('credits in chunks when there are more owners than credit_chunk_size, with the same results', async () => {
    errOf(await as(sut, alice).admin_set_credit_chunk_size(2n));
    errOf(await as(sut).admin_set_credit_chunk_size(0n));
    unwrap(await as(sut).admin_set_credit_chunk_size(2n));
    for (const id of ids()) await tokA.mint(account(id), 11_000_000n);
    await cycleAll(ids());
    await compare('credited in chunks of 2');
    const st = await as(sut).get_vote_index_status();
    expect(st.credit_chunk_size).toBe(2n);
    // nothing reserved is left: the ledger covers every local balance, and what is left over
    // is shared out by the next cycle (no pending credit counted against it)
    const [rec] = await as(sut).balance_reconciliation();
    const [recRef] = await as(ref).balance_reconciliation();
    expect(rec.local_total).toBe(recRef.local_total);
    expect(rec.remaining).toBe(recRef.remaining);
    unwrap(await as(sut).admin_set_credit_chunk_size(1000n));
  });
});

// ---------------------------------------------------------------------------------------------
// Production size, seeded: 2,451 neurons of 829 owners, 458 closed proposals with 463 ballots
// each (212k ballots, a third cast), as on mainnet on 2026-10-22.
// ---------------------------------------------------------------------------------------------
const seedIdl = ({ IDL }) => IDL.Service({
  test_seed_events: IDL.Func([IDL.Nat, IDL.Vec(IDL.Principal), IDL.Nat, IDL.Nat, IDL.Int, IDL.Int, IDL.Nat], [IDL.Nat], []),
  test_seed_neurons: IDL.Func([IDL.Nat, IDL.Nat, IDL.Nat, IDL.Principal, IDL.Nat], [IDL.Nat], []),
  test_seed_proposals: IDL.Func([IDL.Nat, IDL.Nat, IDL.Nat, IDL.Nat, IDL.Nat64], [IDL.Nat], []),
});
// the formulas of canisters/rll_seed_votes.mo.part
const seedNeuronId = (i) => [0x4e, (i >> 16) & 255, (i >> 8) & 255, i & 255, ...Array.from({ length: 28 }, (_, k) => (i * 7 + k + 4) % 256)];
const seedOwner = (o) => Principal.fromUint8Array(Uint8Array.from([0x6f, (o >> 8) & 255, o & 255, 0x01]));
const HOTKEY = user('seed-hotkey');

async function seedVotes(id, { neurons, owners, hotkeyEvery, proposals, voters, castEvery, deadline, firstProposal = 1 }) {
  const seed = actorAs(pic, seedIdl, id, admin);
  for (let i = 0; i < neurons; i += 1000) await seed.test_seed_neurons(BigInt(i), BigInt(Math.min(1000, neurons - i)), BigInt(owners), HOTKEY, BigInt(hotkeyEvery));
  const per = Math.max(1, Math.floor(20_000 / voters));
  for (let p = firstProposal; p < firstProposal + proposals; p += per) {
    await seed.test_seed_proposals(BigInt(p), BigInt(Math.min(per, firstProposal + proposals - p)), BigInt(voters), BigInt(castEvery), deadline);
  }
}

/// what get_user_voting_history must return for `who`, from the seeding formulas (by proposal id)
function expectedHistory(who, { neurons, owners, hotkeyEvery, proposals, voters, castEvery }) {
  const mine = [];
  for (let i = 0; i < Math.min(neurons, voters); i++) {
    if (txt(seedOwner(i % owners)) === txt(who) || (txt(who) === txt(HOTKEY) && i % hotkeyEvery === 0)) mine.push(i);
  }
  const out = [];
  for (let p = 1; p <= proposals; p++) {
    if (mine.length === 0) break;
    const nv = mine.map((j) => ({
      neuron_id: hex(seedNeuronId(j)),
      vote: (p + j) % castEvery !== 0 ? 0 : (p + j) % 2 === 0 ? 1 : 2,
      voting_power: BigInt((j + 1) * 1000 + p),
      timestamp: BigInt(p * 10 + j),
    }));
    out.push({
      proposal_id: BigInt(p), vote: nv[nv.length - 1].vote, voting_power: nv.reduce((a, x) => a + x.voting_power, 0n),
      timestamp: nv.reduce((a, x) => (x.timestamp > a ? x.timestamp : a), 0n), proposal_title: [`Proposal ${p}`], proposal_action: 1n, neuron_votes: nv,
    });
  }
  return out;
}

describe('production size (seeded), before and after the upgrade', () => {
  const PROD = { neurons: 2451, owners: 829, hotkeyEvery: 50, proposals: 458, voters: 463, castEvery: 3 };
  let p1, p2, oldVp, oldHistoryErr;
  const someNeurons = () => [3, 832, 1661, 40, 5000].map((i) => neuronRecord(seedNeuronId(i), seedOwner(i % 829)));

  beforeAll(async () => {
    const deadline = (await nowS()) - 10_000n;
    p1 = await install(pic, { name: 'rll_prepaging_seed', cycles: 200n * T, targetSubnetId: appSubnet });
    p2 = await install(pic, { name: 'rll_prepaging_seed', cycles: 200n * T, targetSubnetId: appSubnet });
    for (const id of [p1, p2]) await seedVotes(id, { ...PROD, deadline });
  }, 900_000);

  it('the old get_user_voting_history exceeds the query instruction limit; the new one answers from the index', async () => {
    const r = as(p1);
    expect(await r.imported_props_count()).toBe(458n);
    oldVp = vpKey(await r.get_hotkey_voting_power(someNeurons())); // the old full walk still answers at this size
    await expect(r.get_user_voting_history(seedOwner(3))).rejects.toThrow(/instruction/i);
    await upgrade(p1, NEW_WASM, async () => {
      // before the rebuild: the voting power from the old walk, the history asks to retry
      expect((await r.get_vote_index_status()).ready).toBe(false);
      expect(vpKey(await r.get_hotkey_voting_power(someNeurons()))).toEqual(oldVp);
      await expect(r.get_user_voting_history(seedOwner(3))).rejects.toThrow(/being rebuilt/);
    });
    const st = await r.get_vote_index_status();
    console.log(`vote index rebuild over ${st.ballots} ballots of ${st.proposals} proposals: ${st.rebuild_instructions} instructions in ${st.rebuild_messages} messages`);
    expect(st.ready).toBe(true);
    expect(st).toMatchObject({ proposals: 458n, indexed_through: 458n, ballots: 458n * 463n });
    for (const who of [seedOwner(3), seedOwner(400), HOTKEY]) {
      const got = (await r.get_user_voting_history(who)).sort((a, b) => Number(a.proposal_id - b.proposal_id));
      expect(got).toEqual(expectedHistory(who, PROD));
    }
    expect(await r.get_user_voting_history(seedOwner(828))).toEqual([]); // owns neurons that never vote
    const page = await r.get_user_voting_history_page(seedOwner(3), 0n, 1000n);
    expect(page.total).toBe(458n);
    expect(page.history.map((h) => h.proposal_id)).toEqual(Array.from({ length: 100 }, (_, k) => BigInt(458 - k)));
    expect(page.history[0]).toEqual(expectedHistory(seedOwner(3), PROD)[457]);
    const tail = await r.get_user_voting_history_page(seedOwner(3), 450n, 100n);
    expect(tail.history.map((h) => h.proposal_id)).toEqual([8n, 7n, 6n, 5n, 4n, 3n, 2n, 1n]);
  });

  it('get_hotkey_voting_power gives what the old full walk gave', async () => {
    expect(vpKey(await as(p1).get_hotkey_voting_power(someNeurons()))).toEqual(oldVp);
    // the expected figures from the formulas
    let total = 0n, all = 0n;
    for (let p = 1; p <= 458; p++) {
      for (let j = 0; j < 463; j++) {
        if ((p + j) % 3 !== 0) continue;
        const vp = BigInt((j + 1) * 1000 + p);
        all += vp;
        if ([3, 832, 1661, 40].includes(j)) total += vp;
      }
    }
    expect(oldVp.distribution).toBe(all);
    expect(oldVp.total).toBe(total);
  });

  it('a daily cycle shares the same amounts as the production code', async () => {
    const before = await cyclesOf([p1, p2]);
    for (const id of [p1, p2]) await tokA.mint(account(id), 123_456_789_000n);
    await cycleAll([p1, p2]);
    const burned = (await cyclesOf([p1, p2])).map((c, k) => before[k] - c);
    const bal = await sortedBalances(p1);
    expect(bal.length).toBe(463); // the owners of the voting neurons 0..462
    expect(bal).toEqual(await sortedBalances(p2));
    expect(await userEvents(p1)).toEqual(await userEvents(p2));
    const st = await as(p1).get_vote_index_status();
    console.log(`daily cycle at production size: cycles burned new ${burned[0]}, old ${burned[1]}; `
      + `new crediting message ${st.max_credit_instructions} instructions`);
    expect(burned[0]).toBeLessThan(burned[1]);
  });
});

async function cyclesOf(ids) { return Promise.all(ids.map((id) => pic.getCyclesBalance(id))); }

// ---------------------------------------------------------------------------------------------
// Beyond production size: three times the ballots. The old rewards-page query no longer fits
// the query instruction limit; the new one does.
// ---------------------------------------------------------------------------------------------
describe('three times the production ballots', () => {
  const BIG = { neurons: 2451, owners: 829, hotkeyEvery: 50, proposals: 1374, voters: 463, castEvery: 3 };
  let id;
  beforeAll(async () => {
    id = await install(pic, { name: 'rll_prepaging_seed', cycles: 300n * T, targetSubnetId: appSubnet });
    await seedVotes(id, { ...BIG, deadline: (await nowS()) - 10_000n });
  }, 900_000);

  it('the old get_hotkey_voting_power exceeds the query instruction limit; the new one answers', async () => {
    const r = as(id);
    const ns = [neuronRecord(seedNeuronId(3), seedOwner(3))];
    await expect(r.get_hotkey_voting_power(ns)).rejects.toThrow(/instruction/i);
    await upgrade(id);
    const got = await r.get_hotkey_voting_power(ns);
    let total = 0n, all = 0n;
    for (let p = 1; p <= BIG.proposals; p++) {
      for (let j = 0; j < 463; j++) {
        if ((p + j) % 3 !== 0) continue;
        all += BigInt((j + 1) * 1000 + p);
        if (j === 3) total += BigInt((j + 1) * 1000 + p);
      }
    }
    expect(got.total_voting_power).toBe(total);
    expect(got.distribution_voting_power).toBe(all);
    const st = await r.get_vote_index_status();
    console.log(`vote index rebuild over ${st.ballots} ballots: ${st.rebuild_instructions} instructions in ${st.rebuild_messages} messages`);
  }, 600_000);
});

// ---------------------------------------------------------------------------------------------
// U1: the whole per-owner credit list
// ---------------------------------------------------------------------------------------------
describe('get_user_distribution_events beyond one reply', () => {
  it('refuses with a pointer to the paged method (the old one failed on the reply size)', async () => {
    const id = await install(pic, { name: 'rll_prepaging_seed', cycles: 100n * T, targetSubnetId: appSubnet });
    const seed = actorAs(pic, seedIdl, id, admin);
    const r = as(id);
    const tokens = [Principal.fromUint8Array(Uint8Array.from([0x70, 0, 0x01, 0x01]))];
    const t0 = (await pic.getTime()) * 1_000_000;
    for (let round = 0; round < 150; round += 10) await seed.test_seed_events(1000n, tokens, BigInt(round), 10n, BigInt(Math.round(t0)), 1_000_000_000n, 0n);
    expect((await r.get_user_distribution_events_page(0n, 0n)).total).toBe(150_000n);
    const msg = async () => { try { await r.get_user_distribution_events(); return 'answered'; } catch (e) { return String(e.message); } };
    const old = await msg();
    expect(old).not.toBe('answered');
    await upgrade(id);
    const now = await msg();
    expect(now).toMatch(/too large for one reply \(150000 events\)/);
    expect(now).toMatch(/get_user_distribution_events_page/);
    // the paged method and a small list still answer
    expect((await r.get_user_distribution_events_page(149_999n, 10n)).events).toHaveLength(1);
  }, 600_000);
});

// ---------------------------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------------------------
describe('rate limits', () => {
  let id;
  beforeAll(async () => {
    id = await install(pic, { name: NEW_WASM, cycles: 50n * T, targetSubnetId: appSubnet });
  });

  it('claims: 30 at once, then refused at ingress until the bucket refills (10 a minute)', async () => {
    const r = as(id, dave);
    expect(await as(id).get_rate_limits()).toContainEqual(['claim_full_balance_of_hotkey', { capacity: 30n, per_minute: 10n }]);
    for (let i = 0; i < 30; i++) errOf(await r.claim_full_balance_of_hotkey(tokAId, FEE_A)); // nothing to claim
    await refusedAtIngress(r.claim_full_balance_of_hotkey(tokAId, FEE_A));
    // another caller has its own bucket
    errOf(await as(id, erin).claim_full_balance_of_hotkey(tokAId, FEE_A));
    await pic.advanceTime(6_500); await pic.tick(); // one call refilled
    errOf(await r.claim_full_balance_of_hotkey(tokAId, FEE_A));
    await refusedAtIngress(r.claim_full_balance_of_hotkey(tokAId, FEE_A));
  });

  it('balances_of_hotkey and balance_reconciliation are limited too', async () => {
    const r = as(id, user('spammer'));
    for (let i = 0; i < 30; i++) await r.balances_of_hotkey();
    await refusedAtIngress(r.balances_of_hotkey());
    for (let i = 0; i < 30; i++) await r.balance_reconciliation();
    await refusedAtIngress(r.balance_reconciliation());
  });

  it('page loads read the reconciliation with queries (anonymous, any number); anonymous update calls are refused', async () => {
    const anon = as(id, Principal.anonymous());
    await as(id).add_known_token(tokAId);
    await tokA.mint(account(id), 5_000_000n);
    // what DaoInfo.jsx does on every load: three queries
    const pageLoad = async () => {
      const known = await anon.get_known_tokens();
      const balances = await Promise.all(known.map(async ([ledger]) => [ledger, await tokA.icrc1_balance_of(account(id))]));
      return anon.balance_reconciliation_from_balances(balances);
    };
    const signed = await as(id, user('auditor')).balance_reconciliation();
    for (let i = 0; i < 60; i++) expect(await pageLoad()).toEqual(signed);
    // the update itself: refused for the anonymous principal (it has no reason to use it)
    await refusedAtIngress(anon.balance_reconciliation());
  });

  it('admins set the rules (capacity 0: no limit), logged as a config change', async () => {
    errOf(await as(id, alice).admin_set_rate_limit('balances_of_hotkey', [{ capacity: 0n, per_minute: 0n }]));
    errOf(await as(id).admin_set_rate_limit('nope', [{ capacity: 1n, per_minute: 1n }]));
    unwrap(await as(id).admin_set_rate_limit('balances_of_hotkey', [{ capacity: 0n, per_minute: 0n }]));
    const r = as(id, user('spammer'));
    for (let i = 0; i < 5; i++) await r.balances_of_hotkey();
    unwrap(await as(id).admin_set_rate_limit('claim_full_balance_of_hotkey', [{ capacity: 2n, per_minute: 1n }]));
    const c = as(id, user('claimer'));
    errOf(await c.claim_full_balance_of_hotkey(tokAId, FEE_A));
    errOf(await c.claim_full_balance_of_hotkey(tokAId, FEE_A));
    await refusedAtIngress(c.claim_full_balance_of_hotkey(tokAId, FEE_A));
    expect(await as(id).get_rate_limits()).toContainEqual(['claim_full_balance_of_hotkey', { capacity: 2n, per_minute: 1n }]);
    const log = await as(id).icrc3_get_blocks([{ start: 0n, length: 100n }]);
    const text = JSON.stringify(log.blocks, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    expect(text).toContain('rate_limit:claim_full_balance_of_hotkey');
    // the rules survive an upgrade (once PocketIC's install_code rate limit has recovered)
    for (let i = 0; i < 10; i++) await advance(60, 50);
    await upgrade(id);
    expect(await as(id).get_rate_limits()).toContainEqual(['claim_full_balance_of_hotkey', { capacity: 2n, per_minute: 1n }]);
    // null: back to the default
    unwrap(await as(id).admin_set_rate_limit('claim_full_balance_of_hotkey', []));
    expect(await as(id).get_rate_limits()).toContainEqual(['claim_full_balance_of_hotkey', { capacity: 30n, per_minute: 10n }]);
  });
});
