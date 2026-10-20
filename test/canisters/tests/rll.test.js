// Integration tests of the reward loop canister (rll, src/sneed_rewards) on
// PocketIC. rll hard-codes the Sneed SNS governance id and ICPSwap's token
// list id, so a mock governance (canisters/MockRllGovernance.mo: paged
// list_neurons, get_proposal with ballots) is installed at the governance id
// and a mock token list (canisters/MockIcpSwapTokenList.mo) at
// k37c6-riaaa-aaaag-qcyza-cai. Covered: admin guards and the admin list, the
// whitelist import, known tokens and per-token min/max, manual neuron and
// proposal imports (paging), the orchestrated distribution cycle (vote
// weights from closed proposals, multiple neurons per owner, abstentions,
// open proposals, the exclusion principal, min/max per cycle), hotkey claims
// on a mock ledger (balances before and after, under-fee, bad fee, stopped
// ledger), the claim incident path on a ledger that rejects
// (canisters/MockRejectLedger.mo), the main loop timer, stopping, the ICPSwap
// outage, statistics and history queries, and upgrades (the main loop re-armed,
// an interrupted cycle restarted).
// The claim and distribution event buffers are checked directly here; the
// ICRC-3 activity log is covered in rll-icrc3.test.js.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import {
  createPic, install, actorAs, account, admin, alice, bob, carol, user, SNEED_GOVERNANCE, T, unwrap, errOf, wasm,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { rllGovernanceIdl, icpswapListIdl, neuronSpec, hex, rejectLedgerIdl, rejectLedgerInit } from '../lib/idl-rll.js';
import { idlFactory as rllIdl } from '../build/rll.did.js';

const ICPSWAP_LIST_ID = Principal.fromText('k37c6-riaaa-aaaag-qcyza-cai');
const TEAM_ADMIN = Principal.fromText('d7zib-qo5mr-qzmpb-dtyof-l7yiu-pu52k-wk7ng-cbm3n-ffmys-crbkz-nae');
const EXCLUDED = Principal.fromText('umo43-o3yqa-363iw-wroso-jm5az-kmfp2-rdzoj-q7il2-zfhcj-l35r7-oqe');
const dave = user('dave');
const erin = user('erin');
const zed = user('zed');
const FEE_A = 1_000n;
const FEE_B = 10_000n;
const FEE_R = 100n;
const DAY_S = 86_400;

// neurons: alice owns two, bob one (carol is its hotkey, listed first), the
// exclusion principal one, one has no owner permission (erin is its only
// hotkey), zed owns one that abstains
const A1 = [0x0a, 0x01], A2 = [0x0a, 0x02], B = [0x0b, 0x01], X = [0x0c, 0x01], H = [0x0d, 0x01], Z = [0x0e, 0x01];

let pic, appSubnet;
let govId, listId, tokAId, tokBId, rejId, rllId;
let gov, list, tokA, tokB, rej, rll, rllAlice, rllBob, rllCarol, rllDave, rllErin;

const nowS = async () => BigInt(Math.floor((await pic.getTime()) / 1000));
const toMap = (arr) => Object.fromEntries(arr.map(([p, n]) => [p.toText(), n]));
const ballot = (vote, vp) => ({ vote, cast_timestamp_seconds: 1n, voting_power: vp });
const listToken = (id, symbol, fee, standard = 'ICRC1') => ({ canisterId: id.toText(), decimals: 8n, fee, name: `${symbol} token`, symbol, standard });
const local = (owner, ledger) => rll.balance_of(owner, ledger);
const advance = async (seconds, ticks = 6) => { await pic.advanceTime(seconds * 1000); await pic.tick(ticks); };
const stage = () => rll.get_import_stage();
/// pump the orchestrator (15 s steps) until it is idle with no timer
async function runUntilIdle(max = 60) {
  for (let i = 0; i < max; i++) {
    await advance(16);
    const s = await stage();
    if (s.startsWith('idle (no timer)')) return s;
  }
  throw new Error(`cycle did not finish: ${await stage()}`);
}
const jsNeuron = (id, perms) => ({
  id: [{ id: Uint8Array.from(id) }], staked_maturity_e8s_equivalent: [], permissions: perms.map(([p, types]) => ({ principal: [p], permission_type: types })),
  maturity_e8s_equivalent: 0n, cached_neuron_stake_e8s: 0n, created_timestamp_seconds: 0n, source_nns_neuron_id: [], auto_stake_maturity: [],
  aging_since_timestamp_seconds: 0n, dissolve_state: [], voting_power_percentage_multiplier: 100n, vesting_period_seconds: [],
  disburse_maturity_in_progress: [], followees: [], neuron_fees_e8s: 0n,
});
const FULL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  govId = await install(pic, { name: 'MockRllGovernance', targetCanisterId: SNEED_GOVERNANCE });
  listId = await install(pic, { name: 'MockIcpSwapTokenList', targetCanisterId: ICPSWAP_LIST_ID });
  expect(listId.toText()).toBe(ICPSWAP_LIST_ID.toText());
  tokAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  tokBId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_B, symbol: 'BBB', decimals: 8 }], targetSubnetId: appSubnet });
  rejId = await install(pic, { name: 'MockRejectLedger', initTypes: rejectLedgerInit, initArgs: [{ fee: FEE_R, symbol: 'REJ', decimals: 8 }], targetSubnetId: appSubnet });
  rllId = await install(pic, { name: 'rll', cycles: 50n * T, targetSubnetId: appSubnet });
  gov = actorAs(pic, rllGovernanceIdl, govId, admin);
  list = actorAs(pic, icpswapListIdl, listId, admin);
  tokA = actorAs(pic, ledgerIdl, tokAId, admin);
  tokB = actorAs(pic, ledgerIdl, tokBId, admin);
  rej = actorAs(pic, rejectLedgerIdl, rejId, admin);
  rll = actorAs(pic, rllIdl, rllId, admin);
  rllAlice = actorAs(pic, rllIdl, rllId, alice);
  rllBob = actorAs(pic, rllIdl, rllId, bob);
  rllCarol = actorAs(pic, rllIdl, rllId, carol);
  rllDave = actorAs(pic, rllIdl, rllId, dave);
  rllErin = actorAs(pic, rllIdl, rllId, erin);

  await gov.add_neuron(neuronSpec({ id: A1, owner: alice, stake: 100_000_000n, dissolve: 1000n }));
  await gov.add_neuron(neuronSpec({ id: A2, owner: alice, stake: 200_000_000n, dissolve: 2000n }));
  await gov.add_neuron(neuronSpec({ id: B, owner: bob, hotkeys: [carol], hotkeysFirst: true, stake: 300_000_000n, dissolve: 500n }));
  await gov.add_neuron(neuronSpec({ id: X, owner: EXCLUDED, stake: 100_000_000n, dissolve: 500n }));
  await gov.add_neuron(neuronSpec({ id: H, owner: null, hotkeys: [erin], stake: 100_000_000n, dissolve: 500n }));
  await gov.add_neuron(neuronSpec({ id: Z, owner: zed, stake: 100_000_000n, dissolve: 500n }));
  await gov.add_filler_neurons(250n, zed); // forces three list_neurons pages
  const now = await nowS();
  // two closed proposals: alice 384 + 128, bob 128 (a no vote counts) + 128, excluded 128, erin's 256; zed abstains
  await gov.set_proposal({ id: 1n, title: 'One', deadline_seconds: now - 1000n, ballots: [[hex(A1), ballot(1, 384n)], [hex(B), ballot(2, 128n)], [hex(X), ballot(1, 128n)], [hex(Z), ballot(0, 500n)]] });
  await gov.set_proposal({ id: 2n, title: 'Two', deadline_seconds: now - 500n, ballots: [[hex(A2), ballot(1, 128n)], [hex(B), ballot(1, 128n)], [hex(H), ballot(1, 256n)]] });
  // still open for an hour
  await gov.set_proposal({ id: 3n, title: 'Three', deadline_seconds: now + 3600n, ballots: [[hex(A1), ballot(1, 1024n)]] });
  await list.set_list([
    listToken(tokAId, 'AAA', FEE_A), listToken(tokBId, 'BBB', FEE_B), listToken(rejId, 'REJ', FEE_R, 'icrc2'),
    listToken(Principal.fromText('aaaaa-aa'), 'DIP', 1n, 'DIP20'), // not ICRC: skipped
    { canisterId: 'not-a-canister', decimals: 8n, fee: 1n, name: 'bad', symbol: 'BAD', standard: 'ICRC1' }, // unparsable: skipped
  ]);
}, 180_000);

afterAll(async () => { await pic?.tearDown(); });

describe('fresh install', () => {
  it('is idle, empty, and has the governance and team admins', async () => {
    expect((await rll.list_admins()).map((p) => p.toText())).toEqual([SNEED_GOVERNANCE.toText(), TEAM_ADMIN.toText()]);
    expect(await rll.caller_is_admin()).toBe(true); // the controller
    expect(await rllAlice.caller_is_admin()).toBe(false);
    expect(await rll.principal_is_admin(SNEED_GOVERNANCE)).toBe(true);
    expect(await rll.principal_is_admin(TEAM_ADMIN)).toBe(true);
    expect(await rll.principal_is_admin(alice)).toBe(false);
    expect(await stage()).toBe('idle (no timer), neuron ticks: 0, prop ticks: 0');
    const s = await rll.get_main_loop_status();
    expect(s).toMatchObject({ is_running: false, last_started: [], last_stopped: [], last_cycle_started: [], last_cycle_ended: [], next_scheduled: [], frequency_seconds: 86_400n });
    expect(await rll.imported_neurons_count()).toBe(0n);
    expect(await rll.imported_props_count()).toBe(0n);
    expect(await rll.balances_count()).toBe(0n);
    expect(await rll.get_known_tokens()).toEqual([]);
    expect(await rll.get_whitelisted_tokens()).toEqual([]);
    expect(await rll.get_claim_events()).toEqual([]);
    expect(await rll.get_distribution_events()).toEqual([]);
    expect(unwrap(await rll.get_neuron_import_status())).toBe('No neuron import process running');
    expect(unwrap(await rll.get_proposal_import_status())).toBe('No proposal import process running');
    expect(await rll.list_claim_incidents()).toEqual([]);
  });
});

describe('admin guards', () => {
  it('reject the asserting admin methods from anyone else', async () => {
    const calls = [
      () => rllAlice.start_rll_main_loop(), () => rllAlice.stop_rll_main_loop(), () => rllAlice.start_distribution_cycle(), () => rllAlice.stop_distribution_cycle(),
      () => rllAlice.add_known_token(tokAId), () => rllAlice.remove_known_token(tokAId), () => rllAlice.clear_balances(), () => rllAlice.clear_all_balances_and_distributions(),
      () => rllAlice.clear_known_tokens(), () => rllAlice.clear_whitelisted_tokens(), () => rllAlice.clear_imported_neurons(), () => rllAlice.clear_claim_events(),
      () => rllAlice.import_whitelisted_tokens_from_icpswap(), () => rllAlice.import_whitelisted_tokens_from_swaprunner(),
      () => rllAlice.set_token_min_distribution(tokAId, 1n), () => rllAlice.set_token_max_distribution(tokAId, 1n),
      () => rllAlice.check_whitelisted_token_balances(), () => rllAlice.check_wallet_token_balances(alice), () => rllAlice.stop_token_balance_check(),
      () => rllAlice.list_claim_incidents(),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow();
  });

  it('answer the Result-returning admin methods with an error', async () => {
    const msg = 'Caller is not admin';
    expect(errOf(await rllAlice.import_all_neurons())).toBe(msg);
    expect(errOf(await rllAlice.import_all_new_neurons())).toBe(msg);
    expect(errOf(await rllAlice.import_all_proposals())).toBe(msg);
    expect(errOf(await rllAlice.import_all_new_proposals())).toBe(msg);
    expect(errOf(await rllAlice.stop_neuron_import())).toBe(msg);
    expect(errOf(await rllAlice.stop_proposal_import())).toBe(msg);
    expect(errOf(await rllAlice.add_admin(alice))).toBe(msg);
    expect(errOf(await rllAlice.remove_admin(TEAM_ADMIN))).toBe(msg);
    expect(errOf(await rllAlice.resolve_claim_incident(0n, true))).toBe(msg);
    expect(errOf(await rllAlice.get_error_claim_events())).toBe(msg);
    expect(errOf(await rllAlice.get_unmatched_pending_claims())).toBe(msg);
    expect(await rll.get_known_tokens()).toEqual([]);
  });

  it('manage the admin list, never dropping the governance canister', async () => {
    expect(unwrap(await rll.add_admin(bob))).toBe(`Added admin ${bob.toText()}`);
    expect(errOf(await rll.add_admin(bob))).toBe('Principal is already an admin');
    expect(await rllBob.caller_is_admin()).toBe(true);
    expect(errOf(await rllBob.remove_admin(SNEED_GOVERNANCE))).toBe('Cannot remove governance canister from admin list');
    expect(errOf(await rllBob.remove_admin(carol))).toBe('Principal is not an admin');
    unwrap(await rllBob.remove_admin(bob));
    expect(await rllBob.caller_is_admin()).toBe(false);
    expect((await rll.list_admins()).map((p) => p.toText())).toEqual([SNEED_GOVERNANCE.toText(), TEAM_ADMIN.toText()]);
  });
});

describe('token lists', () => {
  it('import ICRC tokens from the ICPSwap list and skip the rest', async () => {
    await rll.import_whitelisted_tokens_from_icpswap();
    const wl = toMap((await rll.get_whitelisted_tokens()).map(([p, m]) => [p, m]));
    expect(Object.keys(wl).sort()).toEqual([tokAId, tokBId, rejId].map((p) => p.toText()).sort());
    expect(wl[tokAId.toText()]).toEqual({ name: 'AAA token', symbol: 'AAA', fee: FEE_A, decimals: 8 });
    await rll.import_whitelisted_tokens_from_swaprunner(); // the old name, idempotent
    expect(await rll.get_whitelisted_tokens()).toHaveLength(3);
  });

  it('refuse an import while the ICPSwap list is failing', async () => {
    await list.set_fail(true);
    await expect(rll.import_whitelisted_tokens_from_icpswap()).rejects.toThrow(/ICPSwap token list: token list unavailable/);
    await list.set_fail(false);
    expect(await rll.get_whitelisted_tokens()).toHaveLength(3);
  });

  it('add known tokens with metadata from the ledger, and remove them', async () => {
    await rll.add_known_token(tokAId);
    expect(await rll.get_token_metadata(tokAId)).toEqual([{ name: 'AAA mock', symbol: 'AAA', fee: FEE_A, decimals: 8 }]);
    await expect(rll.add_known_token(alice)).rejects.toThrow(); // not a canister
    await rll.remove_known_token(tokAId);
    expect(await rll.get_known_tokens()).toEqual([]);
    expect(await rll.get_token_metadata(tokAId)).toEqual([]);
  });

  it('set per-token minimums and maximums, for whitelisted tokens only', async () => {
    expect(errOf(await rll.set_token_min_distribution(alice, 1n))).toBe(`Token ${alice.toText()} not found in whitelisted tokens`);
    expect(errOf(await rll.set_token_max_distribution(alice, 1n))).toBe(`Token ${alice.toText()} not found in whitelisted tokens`);
    expect(errOf(await rll.remove_token_min_distribution(tokBId))).toMatch(/No minimum distribution amount set/);
    expect(errOf(await rll.remove_token_max_distribution(tokBId))).toMatch(/No maximum distribution amount set/);
    unwrap(await rll.set_token_min_distribution(tokBId, 5n));
    expect(await rll.get_token_min_distribution(tokBId)).toEqual([5n]);
    expect(toMap(await rll.get_all_token_min_distributions())).toEqual({ [tokBId.toText()]: 5n });
    unwrap(await rll.remove_token_min_distribution(tokBId)); // back to the default: 10 x fee
    expect(await rll.get_token_min_distribution(tokBId)).toEqual([]);
    unwrap(await rll.set_token_max_distribution(tokBId, 100_000n));
    expect(await rll.get_token_max_distribution(tokBId)).toEqual([100_000n]);
    expect(toMap(await rll.get_all_token_max_distributions())).toEqual({ [tokBId.toText()]: 100_000n });
  });
});

describe('manual imports', () => {
  it('page through all neurons, recording the owner of each', async () => {
    expect(errOf(await rll.stop_neuron_import())).toBe('No neuron import process running');
    expect(unwrap(await rll.import_all_neurons())).toBe('Started full neuron import');
    expect(unwrap(await rll.get_neuron_import_status())).toBe('Neuron import process is running');
    expect(errOf(await rll.import_all_neurons())).toBe('Neuron import already running');
    await advance(1, 10);
    expect(unwrap(await rll.get_neuron_import_status())).toBe('No neuron import process running');
    expect(await rll.imported_neurons_count()).toBe(256n); // 6 + 250 fillers, three pages of 100
    // the ownerless neuron is attributed to its only permission holder, erin
    expect(await rll.imported_owners_count()).toBe(256n);
    expect(await rll.get_import_next_neuron_id()).toEqual([]);
  });

  it('import proposals until the first missing id', async () => {
    expect(errOf(await rll.stop_proposal_import())).toBe('No proposal import process running');
    unwrap(await rll.import_all_proposals());
    await advance(1, 10);
    expect(unwrap(await rll.get_proposal_import_status())).toBe('No proposal import process running');
    expect(await rll.imported_props_count()).toBe(3n);
    expect(await rll.get_imported_proposal_max()).toBe(3n);
    expect(await rll.get_highest_closed_proposal_id()).toBe(2n); // 3 is still open
    unwrap(await rll.import_all_new_proposals()); // from the highest closed one: refreshes 3
    await advance(1, 10);
    expect(await rll.imported_props_count()).toBe(3n);
    expect((await rll.get_proposal_ballots(1n)).map(([k]) => k).sort()).toEqual([hex(A1), hex(B), hex(X), hex(Z)].sort());
    expect(await rll.get_proposal_ballots(9n)).toEqual([]);
    const empty = await rll.get_empty_ballot_proposals();
    expect([...empty.proposal_ids]).toEqual([]); // a vec nat64 decodes as a BigUint64Array
    expect(empty.total_count).toBe(0n);
  });

  it('answer acceptsVote from the proposal deadline', async () => {
    const p = { id: [{ id: 1n }], payload_text_rendering: [], action: 1n, failure_reason: [], ballots: [], minimum_yes_proportion_of_total: [], reward_event_round: 0n, failed_timestamp_seconds: 0n, reward_event_end_timestamp_seconds: [], proposal_creation_timestamp_seconds: 1000n, initial_voting_period_seconds: 100n, reject_cost_e8s: 0n, latest_tally: [], wait_for_quiet_deadline_increase_seconds: 0n, decided_timestamp_seconds: 0n, proposal: [], proposer: [], wait_for_quiet_state: [], minimum_yes_proportion_of_exercised: [], is_eligible_for_rewards: true, executed_timestamp_seconds: 0n };
    expect(await rll.acceptsVote(p, 1099n)).toBe(true);
    expect(await rll.acceptsVote(p, 1100n)).toBe(false);
    expect(await rll.acceptsVote({ ...p, wait_for_quiet_state: [{ current_deadline_timestamp_seconds: 2000n }] }, 1500n)).toBe(true);
  });

  it('serve voting histories and neuron statistics from the imported data', async () => {
    const history = (await rll.get_user_voting_history(alice)).sort((a, b) => Number(a.proposal_id - b.proposal_id));
    expect(history.map((h) => [h.proposal_id, h.voting_power, h.proposal_title[0]])).toEqual([[1n, 384n, 'One'], [2n, 128n, 'Two'], [3n, 1024n, 'Three']]);
    expect(history[0].neuron_votes).toEqual([{ neuron_id: hex(A1), vote: 1, voting_power: 384n, timestamp: 1n }]);
    const bobHistory = await rll.get_user_voting_history(carol); // carol's hotkey on bob's neuron shows his votes
    expect(bobHistory).toHaveLength(2);
    const nh = (await rll.get_neuron_voting_history(Uint8Array.from(B))).sort((a, b) => Number(a.proposal_id - b.proposal_id));
    expect(nh.map((h) => [h.proposal_id, h.vote])).toEqual([[1n, 2], [2n, 1]]);
    const st = await rll.get_neuron_statistics();
    expect(st.total_neurons).toBe(256n);
    expect(st.active_neurons).toBe(256n);
    expect(st.total_stake).toBe(900_000_250n);
    expect(st.dissolve_state).toMatchObject({ not_dissolving: 256n, dissolving: 0n, dissolved: 0n, not_dissolving_stake: 900_000_250n });
    expect(st.dissolve_times.min_dissolve_delay_seconds).toEqual([0n]);
    expect(st.dissolve_times.min_delay_neurons.count).toBe(250n);
    expect(st.dissolve_times.max_dissolve_delay_seconds).toEqual([2000n]);
    expect(st.dissolve_times.max_delay_neurons.count).toBe(1n);
    // "voting power" here is stake * multiplier / 1e10: whole tokens, fillers round to 0
    expect(st.voting_power.total).toBe(9n);
    expect(st.voting_power.max).toBe(3n);
    expect(st.permissions).toEqual({ total_hotkeys: 6n, multi_hotkey_neurons: 1n });
  });

  it('compute voting power and owners of given neurons from closed proposals', async () => {
    const vp = await rll.get_hotkey_voting_power([jsNeuron(A1, [[alice, FULL]]), jsNeuron(A2, [[alice, FULL]])]);
    expect(vp.total_voting_power).toBe(512n);
    expect(vp.distribution_voting_power).toBe(1152n); // all yes/no votes on closed proposals; abstentions and the open proposal do not count
    expect(vp.neurons_by_owner.map(([p, ns]) => [p.toText(), ns.length])).toEqual([[alice.toText(), 2]]);
    // owner detection: the first permission with more than seven types, else the last listed principal
    const owners = await rll.get_hotkey_voting_power([jsNeuron(B, [[carol, [3, 4]], [bob, FULL]]), jsNeuron(H, [[dave, [3]], [erin, [3, 4]]])]);
    expect(owners.neurons_by_owner.map(([p]) => p.toText()).sort()).toEqual([bob.toText(), erin.toText()].sort());
  });
});

describe('distribution cycle', () => {
  it('discovers whitelisted tokens with a balance and shares them by votes on closed proposals', async () => {
    await tokA.mint(account(rllId), 1_024_000n);
    await rej.mint(account(rllId), 5_000n);
    const started = unwrap(await rll.start_distribution_cycle());
    expect(started).toMatch(/^Started distribution cycle with timer id/);
    expect(errOf(await rll.start_distribution_cycle())).toBe('Distribution cycle already running');
    expect(await stage()).toMatch(/^importing whitelist \(timer active\)/);
    await runUntilIdle();
    // tokB has no balance yet: not a known token
    expect(Object.keys(toMap(await rll.get_known_tokens())).sort()).toEqual([tokAId.toText(), rejId.toText()].sort());
    // weights 512 : 256 : 256 of 1024 (alice two neurons, bob yes+no, erin); the exclusion
    // principal's 128 does not count, so the others share the full amount
    expect(await local(alice, tokAId)).toBe(512_000n);
    expect(await local(bob, tokAId)).toBe(256_000n);
    expect(await local(erin, tokAId)).toBe(256_000n);
    expect(await local(zed, tokAId)).toBe(0n); // abstained
    expect(await local(EXCLUDED, tokAId)).toBe(0n);
    expect(await local(EXCLUDED, rejId)).toBe(0n);
    expect(await local(alice, rejId)).toBe(2_500n);
    expect(await rll.total_balance(tokAId)).toBe(1_024_000n);
    expect(toMap(await rll.all_token_balances())).toEqual({ [tokAId.toText()]: 1_024_000n, [rejId.toText()]: 5_000n });
    expect(await rll.get_token_total_distribution(tokAId)).toBe(1_024_000n);
    expect(await rll.get_token_total_distribution(tokBId)).toBe(0n);
    expect(toMap(await rll.get_user_distributions(alice))).toEqual({ [tokAId.toText()]: 512_000n, [rejId.toText()]: 2_500n });
    expect(await rll.get_user_token_distribution(bob, tokAId)).toBe(256_000n);
    const events = await rll.get_token_distribution_events(tokAId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ amount: 1_024_000n, proposal_range: { first: 1n, last: 2n } });
    expect(await rll.get_distribution_events()).toHaveLength(2);
    expect(await rll.get_user_distribution_events()).toHaveLength(6);
    expect(await rll.get_user_specific_distribution_events(alice)).toHaveLength(2);
    expect(await rll.get_user_token_distribution_events(alice, rejId)).toEqual([expect.objectContaining({ amount: 2_500n, user: alice })]);
    const all = toMap((await rll.get_all_user_balances()).map(([p, b]) => [p, toMap(b)]));
    expect(all[bob.toText()]).toEqual({ [tokAId.toText()]: 256_000n, [rejId.toText()]: 1_250n });
    expect(all[zed.toText()]).toBeUndefined();
    expect(all[EXCLUDED.toText()]).toBeUndefined();
    const rec = await rll.balance_reconciliation();
    expect(rec.map((r) => [r.token_id.toText(), r.local_total, r.server_balance, r.remaining, r.underflow]).sort()).toEqual(
      [[tokAId.toText(), 1_024_000n, 1_024_000n, 0n, 0n], [rejId.toText(), 5_000n, 5_000n, 0n, 0n]].sort());
    const fromGiven = await rll.balance_reconciliation_from_balances([[tokAId, 1_000_000n]]);
    expect(fromGiven.find((r) => r.token_id.toText() === tokAId.toText())).toMatchObject({ remaining: 0n, underflow: 24_000n });
    expect(fromGiven.find((r) => r.token_id.toText() === rejId.toText())).toMatchObject({ server_balance: 0n, underflow: 5_000n });
    const s = await rll.get_main_loop_status();
    expect(s.last_cycle_ended).toHaveLength(1);
    expect(s.is_running).toBe(false);
  });

  it('reports the balances a hotkey can claim for the owners behind it', async () => {
    expect(toMap(await rllCarol.balances_of_hotkey())).toEqual({ [tokAId.toText()]: 256_000n, [rejId.toText()]: 1_250n });
    expect(toMap(await rllAlice.balances_of_hotkey())).toEqual({ [tokAId.toText()]: 512_000n, [rejId.toText()]: 2_500n });
    expect(await rllDave.balances_of_hotkey()).toEqual([]);
    expect(toMap(await rll.balances_of_hotkey_neurons([jsNeuron(B, [[carol, [3, 4]], [bob, FULL]])]))).toEqual({ [tokAId.toText()]: 256_000n, [rejId.toText()]: 1_250n });
  });
});

describe('claims', () => {
  it('answers a hotkey without neurons with InsufficientFunds and logs nothing', async () => {
    expect(errOf(await rllDave.claim_full_balance_of_hotkey(tokAId, FEE_A))).toEqual({ InsufficientFunds: { balance: 0n } });
    expect(await rll.get_claim_events()).toEqual([]);
  });

  it('pays the owner balance minus the fee to the claiming principal', async () => {
    const idx = unwrap(await rllAlice.claim_full_balance_of_hotkey(tokAId, FEE_A));
    expect(await tokA.icrc1_balance_of(account(alice))).toBe(511_000n);
    expect(await tokA.icrc1_balance_of(account(rllId))).toBe(512_000n);
    expect(await local(alice, tokAId)).toBe(0n);
    const ev = await rll.get_claim_events_for_hotkey(alice);
    expect(ev.map((e) => Object.keys(e.status)[0])).toEqual(['Pending', 'Success']);
    expect(ev[1]).toMatchObject({ sequence_number: 2n, amount: 511_000n, fee: FEE_A, tx_index: [idx], error_message: [] });
    expect(ev[0].sequence_number).toBe(ev[1].sequence_number);
    // nothing left: the next claim is under the fee
    expect(errOf(await rllAlice.claim_full_balance_of_hotkey(tokAId, FEE_A))).toEqual({ InsufficientFunds: { balance: 0n } });
  });

  it('lets a hotkey claim the balance of the neuron owner, to itself', async () => {
    unwrap(await rllCarol.claim_full_balance_of_hotkey(tokAId, FEE_A));
    expect(await tokA.icrc1_balance_of(account(carol))).toBe(255_000n);
    expect(await tokA.icrc1_balance_of(account(bob))).toBe(0n);
    expect(await local(bob, tokAId)).toBe(0n);
  });

  it('keeps the balance when it does not cover the caller-given fee', async () => {
    expect(errOf(await rllErin.claim_full_balance_of_hotkey(tokAId, 300_000n))).toEqual({ InsufficientFunds: { balance: 256_000n } });
    expect(errOf(await rllErin.claim_full_balance_of_hotkey(tokAId, 256_000n))).toEqual({ InsufficientFunds: { balance: 256_000n } }); // equal is not enough either
    expect(await local(erin, tokAId)).toBe(256_000n);
    expect(await rll.get_claim_events_for_hotkey(erin)).toEqual([]);
  });

  it('re-credits the owners when the ledger answers with an error (wrong fee)', async () => {
    expect(errOf(await rllErin.claim_full_balance_of_hotkey(tokAId, 999n))).toEqual({ BadFee: { expected_fee: FEE_A } });
    expect(await local(erin, tokAId)).toBe(256_000n);
    const ev = await rll.get_claim_events_for_hotkey(erin);
    expect(ev.map((e) => Object.keys(e.status)[0])).toEqual(['Pending', 'Failed']);
    expect(ev[1].error_message[0]).toMatch(/BadFee/);
  });

  it('re-credits the owners when the ledger is stopped (the call never executed)', async () => {
    await pic.stopCanister({ canisterId: tokAId, sender: admin });
    const err = errOf(await rllErin.claim_full_balance_of_hotkey(tokAId, FEE_A));
    await pic.startCanister({ canisterId: tokAId, sender: admin });
    expect(err.GenericError.error_code).toBe(1n);
    expect(err.GenericError.message).not.toMatch(/Incident/);
    expect(await local(erin, tokAId)).toBe(256_000n);
    expect(await rll.list_claim_incidents()).toEqual([]);
  });

  it('records an incident and does not re-credit when the ledger rejects: resolved as not landed, it re-credits', async () => {
    await rej.set_mode({ reject_before: null });
    const err = errOf(await rllAlice.claim_full_balance_of_hotkey(rejId, FEE_R));
    expect(err.GenericError.message).toMatch(/^Transfer outcome unknown; balances were NOT re-credited. Incident #0 recorded/);
    expect(await local(alice, rejId)).toBe(0n); // debited although nothing moved
    expect(await rej.get_transactions()).toEqual([]);
    const [inc] = await rll.list_claim_incidents();
    expect(inc).toMatchObject({ id: 0n, token_id: rejId, recipient: alice, total: 2_500n, amount: 2_400n, fee: FEE_R, resolved: false, landed: [], resolved_at: [] });
    expect(inc.owners.map(([p, n]) => [p.toText(), n])).toEqual([[alice.toText(), 2_500n]]);
    expect(Buffer.from(inc.memo).toString()).toBe(`rll-claim:${inc.sequence_number}`);
    // a reconciliation now shows the gap the incident explains
    expect((await rll.balance_reconciliation()).find((r) => r.token_id.toText() === rejId.toText())).toMatchObject({ remaining: 2_500n });
    // a distribution cycle does not share out the 2_500 the unresolved incident holds
    const distributedBefore = await rll.get_token_total_distribution(rejId);
    unwrap(await rll.start_distribution_cycle());
    await runUntilIdle();
    expect(await rll.get_token_total_distribution(rejId)).toBe(distributedBefore);
    expect(await rll.total_balance(rejId)).toBe(2_500n); // bob's and erin's 1_250 each
    expect(await local(alice, rejId)).toBe(0n);
    expect(unwrap(await rll.resolve_claim_incident(0n, false))).toBe('Incident #0 resolved: transfer did not land, 1 owner balance(s) re-credited');
    expect(await local(alice, rejId)).toBe(2_500n);
    expect(errOf(await rll.resolve_claim_incident(0n, false))).toBe('Incident #0 not found or already resolved');
    expect(errOf(await rll.resolve_claim_incident(7n, true))).toBe('Incident #7 not found or already resolved');
    expect((await rll.list_claim_incidents())[0]).toMatchObject({ resolved: true, landed: [false] });
  });

  it('records an incident when the transfer landed but the reply was a reject: resolved as landed, nothing is re-credited', async () => {
    await rej.set_mode({ reject_after: null });
    const err = errOf(await rllCarol.claim_full_balance_of_hotkey(rejId, FEE_R));
    expect(err.GenericError.message).toMatch(/Incident #1/);
    const [tx] = await rej.get_transactions();
    const inc = (await rll.list_claim_incidents())[1];
    expect(tx.amount).toBe(1_150n);
    expect(Buffer.from(tx.memo[0]).equals(Buffer.from(inc.memo))).toBe(true); // the match key works
    expect(await rej.icrc1_balance_of(account(carol))).toBe(1_150n);
    expect(unwrap(await rll.resolve_claim_incident(1n, true))).toBe('Incident #1 resolved: transfer confirmed landed, no re-credit');
    expect(await local(bob, rejId)).toBe(0n);
    await rej.set_mode({ normal: null });
    unwrap(await rllAlice.claim_full_balance_of_hotkey(rejId, FEE_R));
    expect(await rej.icrc1_balance_of(account(alice))).toBe(2_400n);
    const rec = (await rll.balance_reconciliation()).find((r) => r.token_id.toText() === rejId.toText());
    expect(rec).toMatchObject({ local_total: 1_250n, server_balance: 1_250n, remaining: 0n, underflow: 0n });
  });

  it('summarises claims in the statistics and admin views', async () => {
    const stats = await rll.get_event_statistics();
    expect(stats.all_time.claims).toMatchObject({ total: 14n, successful: 3n, failed: 4n, pending: 7n, unique_users: 3n });
    expect(toMap(stats.all_time.claims.per_token)).toEqual({ [tokAId.toText()]: 766_000n, [rejId.toText()]: 2_400n });
    expect(stats.all_time.server_distributions.total).toBe(2n);
    expect(stats.all_time.user_distributions).toMatchObject({ total: 6n, unique_users: 3n });
    expect(stats.last_24h.claims.total).toBe(14n);
    expect(unwrap(await rll.get_error_claim_events())).toHaveLength(4);
    expect(unwrap(await rll.get_unmatched_pending_claims())).toEqual([]);
    expect(toMap(await rll.get_hotkey_claimed_amounts(alice))).toEqual({ [tokAId.toText()]: 511_000n, [rejId.toText()]: 2_400n });
    expect(await rll.get_hotkey_claimed_amounts(erin)).toEqual([]);
  });
});

describe('main loop', () => {
  it('runs a cycle at once and then every 24 hours, with per-cycle min and max', async () => {
    await advance(3600 * 2); // proposal 3 closes
    await tokA.mint(account(rllId), 2_048_000n);
    await tokB.mint(account(rllId), 300_000n); // capped at 100_000 per cycle
    await rej.mint(account(rllId), 999n); // under the default minimum of 10 x fee = 1_000
    const t0 = BigInt(Math.round(await pic.getTime())) * 1_000_000n;
    expect(unwrap(await rll.start_rll_main_loop())).toMatch(/^Started main loop with timer id/);
    expect(errOf(await rll.start_rll_main_loop())).toBe('Main loop already running');
    let s = await rll.get_main_loop_status();
    expect(s.is_running).toBe(true);
    expect(s.last_started[0]).toBeGreaterThanOrEqual(t0);
    expect(s.next_scheduled[0]).toBe(s.last_started[0] + 86_400n * 1_000_000_000n);
    await runUntilIdle();
    s = await rll.get_main_loop_status();
    const firstCycle = s.last_cycle_started[0];
    expect(firstCycle).toBeGreaterThanOrEqual(t0);
    expect(s.last_cycle_ended[0]).toBeGreaterThan(firstCycle);
    // now proposal 3 counts: alice 1536 of 2048
    expect(await local(alice, tokAId)).toBe(1_536_000n);
    expect(await local(bob, tokAId)).toBe(256_000n);
    expect(await local(erin, tokAId)).toBe(512_000n); // 256_000 unclaimed from the first cycle
    expect(await local(alice, tokBId)).toBe(75_000n);
    expect(await rll.total_balance(tokBId)).toBe(100_000n);
    expect(await rll.total_balance(rejId)).toBe(1_250n); // 999 not distributed
    const ev = await rll.get_token_distribution_events(tokAId);
    expect(ev.at(-1)).toMatchObject({ amount: 2_048_000n, proposal_range: { first: 1n, last: 3n } });
    expect(await rll.get_highest_closed_proposal_id()).toBe(3n);
    // the next day the timer starts another cycle: the rest of tokB, another 100_000
    await advance(DAY_S, 10);
    await runUntilIdle();
    s = await rll.get_main_loop_status();
    expect(s.last_cycle_started[0]).toBeGreaterThan(firstCycle + 86_000n * 1_000_000_000n);
    expect(await rll.total_balance(tokBId)).toBe(200_000n);
    expect(await rll.get_token_total_distribution(tokBId)).toBe(200_000n);
    expect(await rll.get_token_total_distribution(tokAId)).toBe(3_072_000n);
  });

  it('stops on request', async () => {
    unwrap(await rll.stop_rll_main_loop());
    expect(errOf(await rll.stop_rll_main_loop())).toBe('Main loop not running');
    const s = await rll.get_main_loop_status();
    expect(s).toMatchObject({ is_running: false, next_scheduled: [] });
    expect(s.last_stopped).toHaveLength(1);
    const before = s.last_cycle_started[0];
    await advance(DAY_S + 60, 10);
    await advance(60, 10);
    expect((await rll.get_main_loop_status()).last_cycle_started[0]).toBe(before);
  });
});

describe('stopping and outages', () => {
  it('stalls in the whitelist stage while ICPSwap is down, until stopped', async () => {
    await list.set_fail(true);
    unwrap(await rll.start_distribution_cycle());
    for (let i = 0; i < 5; i++) await advance(16);
    expect(await stage()).toMatch(/^importing whitelist \(timer active\)/);
    expect(unwrap(await rll.stop_distribution_cycle())).toBe('Distribution cycle stopped');
    expect(await stage()).toBe('idle (no timer), neuron ticks: 0, prop ticks: 0');
    await list.set_fail(false);
    // and a fresh cycle runs through again
    unwrap(await rll.start_distribution_cycle());
    await runUntilIdle();
    expect(await rll.total_balance(tokBId)).toBe(300_000n); // the last 100_000 of tokB
  });

  it('checks whitelisted token balances on request', async () => {
    expect(errOf(await rll.stop_token_balance_check())).toBe('No token balance check process running');
    await rll.remove_known_token(tokBId);
    expect(unwrap(await rll.check_whitelisted_token_balances())).toBe('Started token balance check process for 3 tokens');
    expect(errOf(await rll.check_whitelisted_token_balances())).toBe('Token balance check already running');
    expect((await rll.get_token_balance_check_status()).is_running).toBe(true);
    await advance(1, 10);
    expect(await rll.get_token_balance_check_status()).toEqual({ is_running: false, processed: 0n, total: 0n, ticks: 1n });
    expect(await rll.get_token_metadata(tokBId)).toEqual([{ name: 'BBB token', symbol: 'BBB', fee: FEE_B, decimals: 8 }]); // list metadata
  });

  it('records which whitelisted tokens a wallet holds', async () => {
    expect(errOf(await rll.stop_wallet_token_check())).toBe('No wallet token check process running');
    expect(unwrap(await rll.check_wallet_token_balances(alice))).toBe(`Started wallet token balance check process for ${alice.toText()}`);
    expect(errOf(await rll.check_wallet_token_balances(bob))).toBe('Wallet token check already running');
    expect((await rll.get_wallet_token_check_status()).wallet.map((p) => p.toText())).toEqual([alice.toText()]);
    await advance(1, 10);
    expect(Object.keys(toMap(await rll.get_wallet_known_tokens(alice))).sort()).toEqual([tokAId, rejId].map((p) => p.toText()).sort());
    await tokB.mint(account(alice), 1n);
    unwrap(await rll.check_wallet_token_balances(alice));
    await advance(1, 10);
    expect(await rll.get_wallet_known_tokens(alice)).toHaveLength(3);
    expect(await rll.get_wallet_known_tokens(dave)).toEqual([]);
    expect(await rll.get_wallet_token_check_status()).toMatchObject({ is_running: false, wallet: [] });
  });
});

describe('upgrade', () => {
  it('keeps balances, events, tokens, limits, neurons, proposals and incidents', async () => {
    unwrap(await rll.start_rll_main_loop());
    await runUntilIdle(); // nothing new to distribute
    const snapshot = async () => ({
      balances: toMap((await rll.get_all_user_balances()).map(([p, b]) => [p, toMap(b)])),
      known: toMap(await rll.get_known_tokens()),
      whitelisted: toMap(await rll.get_whitelisted_tokens()),
      totals: toMap(await rll.get_total_distributions()),
      userDist: toMap(await rll.get_user_distributions(alice)),
      events: await rll.get_distribution_events(),
      userEvents: await rll.get_user_distribution_events(),
      claims: await rll.get_claim_events(),
      incidents: await rll.list_claim_incidents(),
      max: toMap(await rll.get_all_token_max_distributions()),
      wallet: toMap(await rll.get_wallet_known_tokens(alice)),
      neurons: await rll.imported_neurons_count(),
      owners: await rll.imported_owners_count(),
      props: await rll.imported_props_count(),
      admins: (await rll.list_admins()).map((p) => p.toText()),
    });
    const before = await snapshot();
    const loopBefore = await rll.get_main_loop_status();
    expect(loopBefore.is_running).toBe(true);
    await pic.upgradeCanister({ sender: admin, canisterId: rllId, wasm: wasm('rll'), arg: IDL.encode([], []) });
    await pic.tick(2);
    expect(await snapshot()).toEqual(before);
    expect(await stage()).toMatch(/^idle \(no timer\)/);

    // timers do not survive an upgrade: the main loop is re-armed on its schedule (last cycle
    // start + 24 h) and runs again without a manual stop and start
    let s = await rll.get_main_loop_status();
    expect(s.is_running).toBe(true);
    const due = loopBefore.last_cycle_started[0] + 86_400n * 1_000_000_000n;
    expect(s.next_scheduled[0]).toBeLessThanOrEqual(due);
    expect(s.next_scheduled[0]).toBeGreaterThan(due - 2_000_000_000n);
    expect(errOf(await rll.start_rll_main_loop())).toBe('Main loop already running');
    await advance(DAY_S + 60, 10);
    await runUntilIdle();
    s = await rll.get_main_loop_status();
    expect(s.last_cycle_started[0]).toBeGreaterThan(loopBefore.last_cycle_started[0]);
    expect(s.last_cycle_ended[0]).toBeGreaterThan(s.last_cycle_started[0]);
    unwrap(await rll.stop_rll_main_loop());

    // still operational: a claim after the upgrade continues the sequence
    const seqBefore = before.claims.at(-1).sequence_number;
    unwrap(await rllErin.claim_full_balance_of_hotkey(tokAId, FEE_A));
    expect(await tokA.icrc1_balance_of(account(erin))).toBe(511_000n);
    expect((await rll.get_claim_events()).at(-1).sequence_number).toBe(seqBefore + 1n);
  });

  it('restarts a cycle the upgrade interrupted from its first stage, without paying anything twice', async () => {
    // alice 1536, bob 256, erin 256 of 2048
    await tokA.mint(account(rllId), 1_024_000n);
    await rej.mint(account(rllId), 5_000n);
    const totals = async () => ({
      a: await rll.get_token_total_distribution(tokAId), r: await rll.get_token_total_distribution(rejId),
      alice: await local(alice, tokAId), aliceR: await local(alice, rejId), events: (await rll.get_distribution_events()).length,
    });
    const before = await totals();
    const remaining = toMap((await rll.balance_reconciliation()).map((r) => [r.token_id, r.remaining]));
    expect(remaining[tokAId.toText()]).toBe(1_024_000n);
    expect(remaining[rejId.toText()]).toBeGreaterThanOrEqual(5_000n); // plus earlier leftovers under the minimum
    unwrap(await rll.start_distribution_cycle());
    // pump in small steps until the first token is shared out and the next is pending
    let st = await stage();
    for (let i = 0; i < 400 && !/processing .*, [1-9]\d*\/\d+\)/.test(st); i++) { await advance(1, 2); st = await stage(); }
    expect(st).toMatch(/^distributing tokens \(processing .*, [1-9]\d*\/\d+\) \(timer active\)/);
    const mid = await totals();
    expect(mid.events).toBe(before.events + 1); // one of the two tokens is done
    await pic.upgradeCanister({ sender: admin, canisterId: rllId, wasm: wasm('rll'), arg: IDL.encode([], []) });
    expect(await stage()).toMatch(/^importing whitelist \(timer active\)/);
    expect((await rll.get_main_loop_status()).is_running).toBe(false); // the loop was stopped: it stays stopped
    await runUntilIdle();
    const after = await totals();
    expect(after.a).toBe(before.a + 1_024_000n);
    // rej is shared once: at most what was undistributed, less only the rounding dust
    expect(after.r - before.r).toBeLessThanOrEqual(remaining[rejId.toText()]);
    expect(after.r - before.r).toBeGreaterThan(remaining[rejId.toText()] - 4n); // four neurons, each share floored
    expect(after.alice).toBe(before.alice + 768_000n);
    const aliceShare = (remaining[rejId.toText()] * 1536n) / 2048n; // her two neurons are floored separately
    expect(after.aliceR - before.aliceR).toBeLessThanOrEqual(aliceShare);
    expect(after.aliceR - before.aliceR).toBeGreaterThanOrEqual(aliceShare - 1n);
    expect(after.events).toBe(before.events + 2);
    const rec = toMap((await rll.balance_reconciliation()).map((r) => [r.token_id, [r.remaining, r.underflow]]));
    expect(rec[tokAId.toText()]).toEqual([0n, 0n]);
    expect(rec[rejId.toText()]).toEqual([remaining[rejId.toText()] - (after.r - before.r), 0n]);
  });
});

describe('clearing', () => {
  it('wipes balances and history on request, leaving the tokens with the canister', async () => {
    const server = await tokA.icrc1_balance_of(account(rllId));
    await rll.clear_all_balances_and_distributions();
    expect(await rll.balances_count()).toBe(0n);
    expect(await rll.get_distribution_events()).toEqual([]);
    expect(await rll.get_user_distribution_events()).toEqual([]);
    expect(await rll.get_claim_events()).toEqual([]);
    expect(await rll.get_total_distributions()).toEqual([]);
    expect(await rll.list_claim_incidents()).toHaveLength(2); // incidents are never cleared
    expect((await rll.balance_reconciliation()).find((r) => r.token_id.toText() === tokAId.toText())).toMatchObject({ local_total: 0n, server_balance: server, remaining: server });
    await rll.clear_imported_neurons();
    await rll.clear_imported_owners();
    await rll.clear_imported_props();
    await rll.clear_known_tokens();
    await rll.clear_whitelisted_tokens();
    expect([await rll.imported_neurons_count(), await rll.imported_owners_count(), await rll.imported_props_count()]).toEqual([0n, 0n, 0n]);
    expect(await rll.get_known_tokens()).toEqual([]);
    expect(await rll.get_whitelisted_tokens()).toEqual([]);
  });
});
