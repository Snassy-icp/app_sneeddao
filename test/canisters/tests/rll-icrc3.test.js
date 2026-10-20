// The RLL ICRC-3 activity log (spec/rll_icrc3.md): an empty log with the documented catalogue;
// config and admin changes (admins, the whitelist import, known tokens, per-token minimums
// and maximums, the main loop, cycles, imports, the reset tools) and nothing for refused calls;
// a distribution cycle's blocks (whitelist and known tokens added by the cycle, one
// reconciliation per known token, a distribution summary and one credit per owner credited a
// non-zero amount, matching balance_of); claims (a block only after the ledger's Ok; nothing
// for under-fee, ledger errors and calls that never executed; an incident block for an unknown
// outcome and a block for its resolution); a cycle's reconciliation reserving an unresolved
// incident; the hash chain and certified tip verify (lib/icrc3.js); spills into archives
// co-controlled by SNS root and registered through a hotkeyed neuron; the ingress guard; an
// upgrade keeps the log; and an upgrade from the production build (commit 75cef0a7,
// build/rll_prod.wasm) keeps every balance, event, token, limit, incident and the main loop and
// starts an empty log.
// RLL_WASM=rll_prod npx vitest run tests/rll-icrc3.test.js runs it against the production code.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import {
  createPic, install, actorAs, account, admin, alice, bob, carol, user, SNEED_GOVERNANCE, SNEED_SNS_ROOT, T, unwrap, errOf, wasm,
  refusedAtIngress, asUpdates,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { rllGovernanceIdl, icpswapListIdl, neuronSpec, hex, rejectLedgerIdl, rejectLedgerInit } from '../lib/idl-rll.js';
import { archiveIdl, btype, tx, verifyLog } from '../lib/icrc3.js';
import { idlFactory as rllIdl } from '../build/rll.did.js';

const RLL_WASM = process.env.RLL_WASM || 'rll';
const ICPSWAP_LIST_ID = Principal.fromText('k37c6-riaaa-aaaag-qcyza-cai');
const EXCLUDED = Principal.fromText('umo43-o3yqa-363iw-wroso-jm5az-kmfp2-rdzoj-q7il2-zfhcj-l35r7-oqe');
const BLOCK_TYPES_URL = 'https://app.sneeddao.com/api/rll#block-types';
const CATALOGUE = [
  'rll_reconciliation', 'rll_distribution', 'rll_credit', 'rll_claim', 'rll_claim_incident', 'rll_claim_incident_resolve',
  'rll_config_update', 'rll_admin_action',
];
const dave = user('dave');
const erin = user('erin');
const zed = user('zed');
const FEE_A = 1_000n;
const FEE_B = 10_000n;
const FEE_R = 100n;

// neurons: alice owns two, bob one (carol is its hotkey), the exclusion principal one, erin is
// the only principal on one, zed abstains, dave casts a single unit of voting power (his share
// of a small distribution rounds down to zero)
const A1 = [0x0a, 0x01], A2 = [0x0a, 0x02], B = [0x0b, 0x01], X = [0x0c, 0x01], H = [0x0d, 0x01], Z = [0x0e, 0x01], D = [0x0f, 0x01];

let pic, rootKey, appSubnet;
let govId, listId, tokAId, tokBId, rejId, rllId;
let gov, list, tokA, rej, rll;

const P = (p) => hex(p.toUint8Array());
const plain = (v) => {
  if ('Nat' in v) return v.Nat;
  if ('Int' in v) return v.Int;
  if ('Text' in v) return v.Text;
  if ('Blob' in v) return hex(v.Blob);
  if ('Array' in v) return v.Array.map(plain);
  return Object.fromEntries(v.Map.map(([k, x]) => [k, plain(x)]));
};
const as = (p, id = rllId) => actorAs(pic, rllIdl, id, p);
const archiveActor = (id) => actorAs(pic, archiveIdl, id, admin);
const advance = async (seconds, ticks = 6) => { await pic.advanceTime(seconds * 1000); await pic.tick(ticks); };
/// pump the orchestrator (15 s steps) until it is idle with no timer
async function runUntilIdle(actor = rll, max = 60) {
  for (let i = 0; i < max; i++) {
    await advance(16);
    if ((await actor.get_import_stage()).startsWith('idle (no timer)')) return;
  }
  throw new Error(`cycle did not finish: ${await actor.get_import_stage()}`);
}
const ballot = (vote, vp) => ({ vote, cast_timestamp_seconds: 1n, voting_power: vp });
const listToken = (id, symbol, fee) => ({ canisterId: id.toText(), decimals: 8n, fee, name: `${symbol} token`, symbol, standard: 'ICRC1' });

/// The whole log, verified (certificate, tree, phash chain, catalogue), as plain records { i, t, ...tx }.
const verifiedLog = async (id = rllId) => {
  const { blocks } = await verifyLog(as(admin, id), id, rootKey, archiveActor);
  return blocks.map((b, i) => ({ i, t: btype(b), ...plain(tx(b)) }));
};
const logLength = async (id = rllId) => Number((await as(admin, id).icrc3_log_status()).log_length);
const since = async (mark, id = rllId) => (await verifiedLog(id)).slice(mark);
const only = (blocks, t, pred = () => true) => blocks.filter((b) => b.t === t && pred(b));
const one = (blocks, t, pred) => { const found = only(blocks, t, pred); expect(found, `${t}`).toHaveLength(1); return found[0]; };
const configs = (blocks) => only(blocks, 'rll_config_update').map((b) => [b.key, b.value, b.old_value]);

beforeAll(async () => {
  ({ pic, appSubnet, rootKey } = await createPic());
  govId = await install(pic, { name: 'MockRllGovernance', targetCanisterId: SNEED_GOVERNANCE });
  listId = await install(pic, { name: 'MockIcpSwapTokenList', targetCanisterId: ICPSWAP_LIST_ID });
  tokAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  tokBId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_B, symbol: 'BBB', decimals: 8 }], targetSubnetId: appSubnet });
  rejId = await install(pic, { name: 'MockRejectLedger', initTypes: rejectLedgerInit, initArgs: [{ fee: FEE_R, symbol: 'REJ', decimals: 8 }], targetSubnetId: appSubnet });
  rllId = await install(pic, { name: RLL_WASM, cycles: 50n * T, targetSubnetId: appSubnet });
  gov = actorAs(pic, rllGovernanceIdl, govId, admin);
  list = actorAs(pic, icpswapListIdl, listId, admin);
  tokA = actorAs(pic, ledgerIdl, tokAId, admin);
  rej = actorAs(pic, rejectLedgerIdl, rejId, admin);
  rll = as(admin);

  await gov.add_neuron(neuronSpec({ id: A1, owner: alice, stake: 100_000_000n, dissolve: 1000n }));
  await gov.add_neuron(neuronSpec({ id: A2, owner: alice, stake: 200_000_000n, dissolve: 2000n }));
  await gov.add_neuron(neuronSpec({ id: B, owner: bob, hotkeys: [carol], hotkeysFirst: true, stake: 300_000_000n, dissolve: 500n }));
  await gov.add_neuron(neuronSpec({ id: X, owner: EXCLUDED, stake: 100_000_000n, dissolve: 500n }));
  await gov.add_neuron(neuronSpec({ id: H, owner: null, hotkeys: [erin], stake: 100_000_000n, dissolve: 500n }));
  await gov.add_neuron(neuronSpec({ id: Z, owner: zed, stake: 100_000_000n, dissolve: 500n }));
  await gov.add_neuron(neuronSpec({ id: D, owner: dave, stake: 100_000_000n, dissolve: 500n }));
  const now = BigInt(Math.floor((await pic.getTime()) / 1000));
  // voting power cast, excluded principal left out: alice 384 + 128, bob 128 + 128, erin 256, dave 1 = 1025
  await gov.set_proposal({ id: 1n, title: 'One', deadline_seconds: now - 1000n, ballots: [[hex(A1), ballot(1, 384n)], [hex(B), ballot(2, 128n)], [hex(X), ballot(1, 128n)], [hex(Z), ballot(0, 500n)]] });
  await gov.set_proposal({ id: 2n, title: 'Two', deadline_seconds: now - 500n, ballots: [[hex(A2), ballot(1, 128n)], [hex(B), ballot(1, 128n)], [hex(H), ballot(1, 256n)], [hex(D), ballot(1, 1n)]] });
  await list.set_list([listToken(tokAId, 'AAA', FEE_A), listToken(rejId, 'REJ', FEE_R)]);
}, 180_000);

afterAll(async () => { await pic?.tearDown(); });

describe('fresh install', () => {
  it('has an empty log, the documented catalogue and ICRC-3 among its standards', async () => {
    expect(await as(bob).icrc3_log_status()).toMatchObject({ log_length: 0n, live_blocks: 0n, archives: [], history_imported: false, last_block_hash: [] });
    expect(await as(bob).icrc3_get_tip_certificate()).toEqual([]);
    expect(await as(bob).icrc3_supported_block_types()).toEqual(CATALOGUE.map((block_type) => ({ block_type, url: BLOCK_TYPES_URL })));
    expect((await as(bob).icrc10_supported_standards()).map((s) => s.name)).toEqual(['ICRC-3', 'ICRC-10']);
    const r = await as(bob).icrc3_get_blocks([{ start: 0n, length: 10n }]);
    expect(r).toEqual({ log_length: 0n, blocks: [], archived_blocks: [] });
    expect(await as(bob).icrc3_get_archives({ from: [] })).toEqual([]);
  });
});

describe('settings and admin changes', () => {
  it('log nothing for refused calls', async () => {
    const mark = await logLength();
    expect(errOf(await as(alice).add_admin(alice))).toBe('Caller is not admin');
    expect(errOf(await as(alice).resolve_claim_incident(0n, true))).toBe('Caller is not admin');
    await expect(as(alice).add_known_token(tokAId)).rejects.toThrow();
    await expect(as(alice).set_token_min_distribution(rejId, 1n)).rejects.toThrow();
    await expect(as(alice).clear_balances()).rejects.toThrow();
    const none = { max_live_blocks: [5n], spill_batch_size: [], archive_max_blocks: [], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] };
    expect(errOf(await as(alice).admin_set_icrc3_settings(none))).toMatch(/admins/);
    expect(errOf(await as(alice).admin_icrc3_spill_now())).toMatch(/admins/);
    expect(errOf(await as(alice).admin_set_icrc3_proposal_neuron([]))).toMatch(/admins/);
    expect(errOf(await as(alice).admin_icrc3_register_archives_now())).toMatch(/admins/);
    expect(await logLength()).toBe(mark);
  });

  it('log admins, the whitelist import, known tokens and limits, with old values', async () => {
    const mark = await logLength();
    unwrap(await rll.add_admin(bob));
    errOf(await rll.add_admin(bob)); // already one: no block
    unwrap(await rll.remove_admin(bob));
    await rll.import_whitelisted_tokens_from_icpswap();
    await rll.import_whitelisted_tokens_from_swaprunner(); // nothing new: no block
    await rll.add_known_token(tokAId);
    await rll.remove_known_token(tokAId);
    await rll.remove_known_token(tokAId); // not known: no block
    unwrap(await rll.set_token_min_distribution(rejId, 5n));
    unwrap(await rll.set_token_min_distribution(rejId, 7n));
    unwrap(await rll.remove_token_min_distribution(rejId));
    errOf(await rll.remove_token_min_distribution(rejId)); // none: no block
    unwrap(await rll.set_token_max_distribution(tokAId, 2_000_000_000n));
    unwrap(await rll.remove_token_max_distribution(tokAId));
    const blocks = await since(mark);
    expect(blocks.every((b) => b.t === 'rll_config_update' && b.caller === P(admin) && b.via === undefined)).toBe(true);
    const lim = (ledger, amount) => (amount === undefined ? { ledger: P(ledger) } : { ledger: P(ledger), amount });
    expect(configs(blocks)).toEqual([
      ['admin_added', P(bob), undefined],
      ['admin_removed', P(bob), undefined],
      ['whitelist_tokens_added', [P(tokAId), P(rejId)], undefined],
      ['known_token_added', { ledger: P(tokAId), symbol: 'AAA', decimals: 8n, fee: FEE_A }, undefined],
      ['known_token_removed', P(tokAId), undefined],
      ['token_min_distribution', lim(rejId, 5n), lim(rejId)],
      ['token_min_distribution', lim(rejId, 7n), lim(rejId, 5n)],
      ['token_min_distribution', lim(rejId), lim(rejId, 7n)],
      ['token_max_distribution', lim(tokAId, 2_000_000_000n), lim(tokAId)],
      ['token_max_distribution', lim(tokAId), lim(tokAId, 2_000_000_000n)],
    ]);
  });
});

describe('distribution cycle', () => {
  let mark, blocks;
  beforeAll(async () => {
    await list.set_list([listToken(tokAId, 'AAA', FEE_A), listToken(rejId, 'REJ', FEE_R), listToken(tokBId, 'BBB', FEE_B)]);
    await tokA.mint(account(rllId), 1_025_000n);
    await rej.mint(account(rllId), 1_000n); // exactly the default minimum, 10 x fee
    mark = await logLength();
    unwrap(await rll.start_distribution_cycle());
    await runUntilIdle();
    blocks = await since(mark);
  });

  it('logs the admin start, and the whitelist and known tokens the cycle added', async () => {
    expect(one(blocks, 'rll_admin_action')).toMatchObject({ caller: P(admin), action: 'distribution_cycle_start' });
    const cfg = only(blocks, 'rll_config_update');
    expect(cfg.every((b) => b.via === 'cycle' && b.caller === undefined)).toBe(true);
    expect(cfg.filter((b) => b.key === 'whitelist_tokens_added').map((b) => b.value)).toEqual([[P(tokBId)]]);
    const known = cfg.filter((b) => b.key === 'known_token_added').map((b) => b.value).sort((a, b) => a.symbol.localeCompare(b.symbol));
    expect(known).toEqual([
      { ledger: P(tokAId), symbol: 'AAA', decimals: 8n, fee: FEE_A, balance: 1_025_000n },
      { ledger: P(rejId), symbol: 'REJ', decimals: 8n, fee: FEE_R, balance: 1_000n }, // tokB has no balance: not known
    ]);
  });

  it('reconciles every known token before sharing it', async () => {
    expect(one(blocks, 'rll_reconciliation', (b) => b.token === P(tokAId))).toMatchObject({
      ledger_balance: 1_025_000n, claimable: 0n, reserved: 0n, undistributed: 1_025_000n, underflow: 0n, to_distribute: 1_025_000n, via: 'cycle',
    });
    expect(one(blocks, 'rll_reconciliation', (b) => b.token === P(rejId))).toMatchObject({ ledger_balance: 1_000n, to_distribute: 1_000n });
    // each reconciliation comes before the distribution of its token
    for (const token of [P(tokAId), P(rejId)]) {
      expect(one(blocks, 'rll_reconciliation', (b) => b.token === token).i).toBeLessThan(one(blocks, 'rll_distribution', (b) => b.token === token).i);
    }
  });

  it('logs a summary and one credit per owner, each matching the balances and voting power', async () => {
    const vp = { [P(alice)]: 512n, [P(bob)]: 256n, [P(erin)]: 256n, [P(dave)]: 1n };
    for (const [ledger, requested, owners] of [[tokAId, 1_025_000n, [alice, bob, erin, dave]], [rejId, 1_000n, [alice, bob, erin]]]) {
      const d = one(blocks, 'rll_distribution', (b) => b.token === P(ledger));
      const credits = only(blocks, 'rll_credit', (b) => b.token === P(ledger));
      expect(d).toMatchObject({
        requested, amount: await rll.get_token_total_distribution(ledger), owners: BigInt(owners.length), neurons: 5n, voting_power: 1025n,
        first_proposal: 1n, last_proposal: 2n, via: 'cycle',
      });
      expect(d.amount).toBeLessThanOrEqual(requested);
      expect(credits.map((c) => c.owner).sort()).toEqual(owners.map(P).sort());
      expect(credits.every((c) => c.distribution === BigInt(d.i) && c.i > d.i && c.amount > 0n)).toBe(true);
      expect(credits.reduce((s, c) => s + c.amount, 0n)).toBe(d.amount);
      for (const c of credits) {
        const owner = owners.find((o) => P(o) === c.owner);
        expect(c.amount).toBe(await rll.balance_of(owner, ledger));
        expect(c.voting_power).toBe(vp[c.owner]);
      }
    }
    // dave's share of 1_000 REJ rounds down to zero: credited (an event), not logged
    expect(await rll.balance_of(dave, rejId)).toBe(0n);
    expect(await rll.get_user_token_distribution_events(dave, rejId)).toHaveLength(1);
    expect(only(blocks, 'rll_credit').some((c) => c.owner === P(EXCLUDED) || c.owner === P(zed))).toBe(false);
  });
});

describe('claims', () => {
  it('log a paid claim with the owners whose balances paid it', async () => {
    const mark = await logLength();
    const aliceA = await rll.balance_of(alice, tokAId);
    const idx = unwrap(await as(alice).claim_full_balance_of_hotkey(tokAId, FEE_A));
    const bobA = await rll.balance_of(bob, tokAId);
    const idx2 = unwrap(await as(carol).claim_full_balance_of_hotkey(tokAId, FEE_A)); // carol, bob's hotkey, claims his share
    const [b1, b2] = await since(mark);
    const seq = (await rll.get_claim_events_for_hotkey(alice)).at(-1).sequence_number;
    expect(b1).toEqual({
      i: mark, t: 'rll_claim', caller: P(alice), token: P(tokAId), amount: aliceA - FEE_A, fee: FEE_A, total: aliceA,
      owners: [{ owner: P(alice), amount: aliceA }], to: [P(alice)], ledger_tx: idx, seq,
    });
    expect(b2).toMatchObject({ t: 'rll_claim', caller: P(carol), owners: [{ owner: P(bob), amount: bobA }], to: [P(carol)], ledger_tx: idx2, amount: bobA - FEE_A });
    expect(await tokA.icrc1_balance_of(account(carol))).toBe(bobA - FEE_A);
  });

  it('log nothing for claims that change nothing: under the fee, a ledger error, a call that never executed', async () => {
    const mark = await logLength();
    expect(errOf(await as(dave).claim_full_balance_of_hotkey(tokAId, FEE_A))).toHaveProperty('InsufficientFunds'); // dave holds about 1_000
    expect(errOf(await as(zed).claim_full_balance_of_hotkey(tokAId, FEE_A))).toEqual({ InsufficientFunds: { balance: 0n } });
    expect(errOf(await as(erin).claim_full_balance_of_hotkey(tokAId, 999n))).toEqual({ BadFee: { expected_fee: FEE_A } });
    await pic.stopCanister({ canisterId: tokAId, sender: admin });
    expect(errOf(await as(erin).claim_full_balance_of_hotkey(tokAId, FEE_A))).toHaveProperty('GenericError');
    await pic.startCanister({ canisterId: tokAId, sender: admin });
    expect(await logLength()).toBe(mark);
    expect((await rll.get_claim_events_for_hotkey(erin)).map((e) => Object.keys(e.status)[0])).toEqual(['Pending', 'Failed', 'Pending', 'Failed']);
  });

  it('log an incident for an unknown outcome, reserve it in the next cycle, and log its resolution', async () => {
    await rej.set_mode({ reject_before: null });
    const total = await rll.balance_of(alice, rejId);
    let mark = await logLength();
    const err = errOf(await as(alice).claim_full_balance_of_hotkey(rejId, FEE_R));
    expect(err.GenericError.message).toMatch(/Incident #0/);
    const [inc] = await rll.list_claim_incidents();
    const [b] = await since(mark);
    expect(b).toEqual({
      i: mark, t: 'rll_claim_incident', incident_id: 0n, caller: P(alice), token: P(rejId), total, amount: total - FEE_R, fee: FEE_R,
      owners: [{ owner: P(alice), amount: total }], seq: inc.sequence_number, memo: hex(inc.memo), created_at_time: inc.created_at_time,
      error: inc.error_message,
    });
    expect(Buffer.from(inc.memo).toString()).toBe(`rll-claim:${inc.sequence_number}`);

    // the next cycle reconciles REJ with the incident's amount reserved, and shares nothing
    mark = await logLength();
    unwrap(await rll.start_distribution_cycle());
    await runUntilIdle();
    let blocks = await since(mark);
    const claimable = await rll.total_balance(rejId);
    expect(one(blocks, 'rll_reconciliation', (x) => x.token === P(rejId))).toMatchObject({
      ledger_balance: 1_000n, claimable, reserved: total, undistributed: 1_000n - claimable - total, underflow: 0n, to_distribute: 0n,
    });
    expect(one(blocks, 'rll_reconciliation', (x) => x.token === P(tokAId)).to_distribute).toBe(0n); // only dust left
    expect(only(blocks, 'rll_distribution')).toEqual([]);
    expect(only(blocks, 'rll_credit')).toEqual([]);

    mark = await logLength();
    unwrap(await rll.resolve_claim_incident(0n, false));
    errOf(await rll.resolve_claim_incident(0n, false)); // already resolved: no block
    expect(await since(mark)).toEqual([{ i: mark, t: 'rll_claim_incident_resolve', caller: P(admin), incident_id: 0n, token: P(rejId), landed: 0n, recredited: total, owners: [{ owner: P(alice), amount: total }] }]);
    expect(await rll.balance_of(alice, rejId)).toBe(total);

    // a transfer that landed although the reply was a reject: resolved as landed, nothing re-credited
    await rej.set_mode({ reject_after: null });
    const erinTotal = await rll.balance_of(erin, rejId);
    mark = await logLength();
    errOf(await as(erin).claim_full_balance_of_hotkey(rejId, FEE_R));
    unwrap(await rll.resolve_claim_incident(1n, true));
    blocks = await since(mark);
    expect(blocks.map((x) => x.t)).toEqual(['rll_claim_incident', 'rll_claim_incident_resolve']);
    expect(blocks[0]).toMatchObject({ incident_id: 1n, caller: P(erin), total: erinTotal });
    expect(blocks[1]).toEqual({ i: mark + 1, t: 'rll_claim_incident_resolve', caller: P(admin), incident_id: 1n, token: P(rejId), landed: 1n, recredited: 0n });
    await rej.set_mode({ normal: null });
  });
});

describe('admin actions', () => {
  it('log imports, cycle stops and the main loop switch', async () => {
    const mark = await logLength();
    unwrap(await rll.import_all_neurons());
    unwrap(await rll.stop_neuron_import()); // the import's timer has not run yet
    unwrap(await rll.import_all_new_proposals());
    await advance(1, 10);
    errOf(await rll.stop_proposal_import()); // finished: nothing to stop, no block
    unwrap(await rll.stop_distribution_cycle());
    unwrap(await rll.start_rll_main_loop());
    await runUntilIdle(); // the loop runs a cycle at once
    unwrap(await rll.stop_rll_main_loop());
    errOf(await rll.stop_rll_main_loop()); // not running: no block
    const blocks = await since(mark);
    expect(only(blocks, 'rll_admin_action').map((b) => [b.caller, b.action, b.mode, b.from_proposal])).toEqual([
      [P(admin), 'neuron_import_start', 'all', undefined],
      [P(admin), 'neuron_import_stop', undefined, undefined],
      [P(admin), 'proposal_import_start', 'new', 3n], // from the proposal after the highest closed one
      [P(admin), 'distribution_cycle_stop', undefined, undefined],
    ]);
    expect(configs(only(blocks, 'rll_config_update', (b) => b.caller === P(admin)))).toEqual([['main_loop', 'on', undefined], ['main_loop', 'off', undefined]]);
    expect(only(blocks, 'rll_reconciliation')).toHaveLength(2); // the loop's cycle: one per known token
  });
});

describe('verification and ingress', () => {
  it('verifies the whole log: certificate, tree, hash chain and catalogue', async () => {
    const blocks = await verifiedLog();
    expect(blocks).toHaveLength(await logLength());
    expect(new Set(blocks.map((b) => b.t))).toEqual(new Set(CATALOGUE));
  });

  it('refuses the log queries as update calls and oversized admin arguments at ingress', async () => {
    const u = actorAs(pic, asUpdates(rllIdl), rllId, bob);
    expect((await as(bob).icrc3_log_status()).log_length).toEqual(expect.any(BigInt)); // answered as a query
    expect(await as(bob).icrc3_registration_status()).toHaveProperty('registrations');
    expect(await refusedAtIngress(u.icrc3_get_blocks([{ start: 0n, length: 1n }]))).toBe(true);
    expect(await refusedAtIngress(u.icrc3_get_archives({ from: [] }))).toBe(true);
    expect(await refusedAtIngress(u.icrc3_get_tip_certificate())).toBe(true);
    expect(await refusedAtIngress(u.icrc3_supported_block_types())).toBe(true);
    expect(await refusedAtIngress(u.icrc10_supported_standards())).toBe(true);
    expect(await refusedAtIngress(u.icrc3_log_status())).toBe(true);
    expect(await refusedAtIngress(u.icrc3_registration_status())).toBe(true);
    expect(await refusedAtIngress(rll.admin_set_icrc3_proposal_neuron([new Uint8Array(10_000)]))).toBe(true);
  });
});

describe('archives', () => {
  it('spill past the live limit into archives co-controlled by SNS root, and still verify', async () => {
    const before = await logLength();
    unwrap(await rll.admin_set_icrc3_settings({ max_live_blocks: [5n], spill_batch_size: [10n], archive_max_blocks: [20n], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }));
    await advance(15 * 60 + 5, 100); // the 15-minute spill check
    const s = await rll.icrc3_log_status();
    expect(Number(s.log_length)).toBe(before + 3); // three settings changed
    expect(s.live_blocks).toBeLessThan(5n);
    expect(s.archives.length).toBeGreaterThanOrEqual(2);
    const archives = await as(bob).icrc3_get_archives({ from: [] });
    expect(archives.map((a) => a.canister_id.toText())).toEqual(s.archives.map((a) => a.canister_id.toText()));
    for (const a of archives) {
      expect((await pic.getControllers(a.canister_id)).map((p) => p.toText()).sort()).toEqual([rllId.toText(), SNEED_SNS_ROOT.toText()].sort());
      expect((await archiveActor(a.canister_id).archive_status()).parent.toText()).toBe(rllId.toText());
    }
    const r = await as(bob).icrc3_get_blocks([{ start: 0n, length: 3n }]);
    expect(r.blocks).toEqual([]);
    expect(r.archived_blocks).toHaveLength(1);
    const blocks = await verifiedLog(); // follows the callbacks into every archive
    expect(blocks).toHaveLength(Number(s.log_length));
    expect(blocks.slice(-3).map((b) => [b.key, b.caller])).toEqual([
      ['icrc3_max_live_blocks', P(admin)], ['icrc3_spill_batch_size', P(admin)], ['icrc3_archive_max_blocks', P(admin)],
    ]);
    unwrap(await rll.admin_icrc3_spill_now());
    expect((await rll.icrc3_log_status()).live_blocks).toBe(0n);
    expect(await verifiedLog()).toHaveLength(Number(s.log_length));
  });

  it('registers its archives with the SNS through a hotkeyed neuron, and skips the step without one', async () => {
    const NEURON = new Uint8Array(32).fill(9);
    const archives = await as(bob).icrc3_get_archives({ from: [] });
    let s = await as(bob).icrc3_registration_status();
    expect(s.governance.toText()).toBe(SNEED_GOVERNANCE.toText());
    expect(s.neuron).toEqual([]);
    expect(unwrap(await rll.admin_icrc3_register_archives_now())).toBe(0n);
    expect(errOf(await rll.admin_set_icrc3_proposal_neuron([new Uint8Array(5)]))).toMatch(/32-byte/);
    await gov.add_hotkey(NEURON, rllId);
    unwrap(await rll.admin_set_icrc3_proposal_neuron([NEURON]));
    expect((await verifiedLog()).at(-1)).toMatchObject({ t: 'rll_config_update', caller: P(admin), key: 'icrc3_proposal_neuron', value: hex(NEURON), old_value: 'none' });
    expect(unwrap(await rll.admin_icrc3_register_archives_now())).toBe(BigInt(archives.length));
    const proposals = await gov.list_proposals();
    expect(proposals.map((p) => p.canister_ids[0].toText())).toEqual(archives.map((a) => a.canister_id.toText()));
    for (const p of proposals) {
      expect(p.proposer.toText()).toBe(rllId.toText());
      expect(p.title).toMatch(/^Register ICRC-3 archive .* of RLL$/);
      expect(p.url).toBe('https://app.sneeddao.com/api/rll#activity-log-icrc-3');
    }
    s = await as(bob).icrc3_registration_status();
    expect(s.registrations.map((x) => x.proposal_id[0])).toEqual(proposals.map((p) => p.id));
    expect(unwrap(await rll.admin_icrc3_register_archives_now())).toBe(0n);
    expect(unwrap(await rll.admin_icrc3_reset_archive_registration(archives[0].canister_id))).toBe(true);
    expect((await rll.admin_icrc3_repair_archive_controllers()).every(([, r]) => 'Ok' in r)).toBe(true);
    unwrap(await rll.admin_set_icrc3_settings({ max_live_blocks: [2000n], spill_batch_size: [500n], archive_max_blocks: [1_000_000n], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }));
  });
});

describe('upgrades', () => {
  it('keep the log, the archives and the certified tip', async () => {
    const before = await rll.icrc3_log_status();
    const blocksBefore = await verifiedLog();
    await pic.upgradeCanister({ sender: admin, canisterId: rllId, wasm: wasm(RLL_WASM), arg: IDL.encode([], []) });
    await pic.tick(2);
    expect(await rll.icrc3_log_status()).toEqual(before);
    expect(await verifiedLog()).toEqual(blocksBefore); // the tip certificate is republished
    unwrap(await rll.add_admin(carol));
    const blocks = await verifiedLog();
    expect(blocks).toHaveLength(blocksBefore.length + 1);
    expect(blocks.at(-1)).toMatchObject({ t: 'rll_config_update', key: 'admin_added', value: P(carol) });
    unwrap(await rll.remove_admin(carol));
  });

  it('from the production build keep every balance, event, token, limit, incident and the main loop, and start an empty log', async () => {
    const oldId = await install(pic, { name: 'rll_prod', cycles: 20n * T, targetSubnetId: appSubnet });
    const old = as(admin, oldId);
    await expect(old.icrc3_log_status()).rejects.toThrow(); // the production code has no log
    await tokA.mint(account(oldId), 2_050_000n);
    await rej.mint(account(oldId), 2_000n);
    unwrap(await old.start_distribution_cycle());
    await runUntilIdle(old);
    unwrap(await as(alice, oldId).claim_full_balance_of_hotkey(tokAId, FEE_A));
    await rej.set_mode({ reject_before: null });
    errOf(await as(alice, oldId).claim_full_balance_of_hotkey(rejId, FEE_R)); // an unresolved incident
    await rej.set_mode({ normal: null });
    unwrap(await old.set_token_min_distribution(rejId, 1_500n));
    unwrap(await old.set_token_max_distribution(tokAId, 5_000_000n));
    unwrap(await old.add_admin(carol));
    unwrap(await old.start_rll_main_loop());
    await runUntilIdle(old);
    const toMap = (arr) => Object.fromEntries(arr.map(([p, n]) => [p.toText(), n]));
    const snapshot = async () => ({
      balances: toMap((await old.get_all_user_balances()).map(([p, b]) => [p, toMap(b)])),
      known: toMap(await old.get_known_tokens()),
      whitelisted: toMap(await old.get_whitelisted_tokens()),
      totals: toMap(await old.get_total_distributions()),
      userDist: toMap(await old.get_user_distributions(alice)),
      events: await old.get_distribution_events(),
      userEvents: await old.get_user_distribution_events(),
      claims: await old.get_claim_events(),
      incidents: await old.list_claim_incidents(),
      min: toMap(await old.get_all_token_min_distributions()),
      max: toMap(await old.get_all_token_max_distributions()),
      neurons: await old.imported_neurons_count(),
      owners: await old.imported_owners_count(),
      props: await old.imported_props_count(),
      admins: (await old.list_admins()).map((p) => p.toText()),
      reconciliation: (await old.balance_reconciliation()).map((r) => [r.token_id.toText(), r.local_total, r.server_balance]).sort(),
    });
    const before = await snapshot();
    expect(before.incidents).toHaveLength(1);
    expect(before.claims.length).toBeGreaterThan(0);
    const loopBefore = await old.get_main_loop_status();
    expect(loopBefore.is_running).toBe(true);

    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(RLL_WASM), arg: IDL.encode([], []) });
    await pic.tick(2);
    expect(await snapshot()).toEqual(before);
    const loopAfter = await old.get_main_loop_status();
    expect(loopAfter.is_running).toBe(true); // re-armed on its schedule
    expect(loopAfter.last_cycle_started).toEqual(loopBefore.last_cycle_started);
    expect(await as(bob, oldId).icrc3_log_status()).toMatchObject({ log_length: 0n, live_blocks: 0n, archives: [], last_block_hash: [], history_imported: false });
    expect(await as(bob, oldId).icrc3_get_tip_certificate()).toEqual([]);

    // the first change after the upgrade is block 0, without phash; the log verifies
    const total = before.incidents[0].total;
    unwrap(await old.resolve_claim_incident(0n, false));
    unwrap(await as(alice, oldId).claim_full_balance_of_hotkey(rejId, FEE_R));
    const blocks = await verifiedLog(oldId);
    expect(blocks.map((b) => b.t)).toEqual(['rll_claim_incident_resolve', 'rll_claim']);
    expect(blocks[0]).toMatchObject({ i: 0, incident_id: 0n, landed: 0n, recredited: total });
    expect(blocks[1]).toMatchObject({ caller: P(alice), token: P(rejId), total, amount: total - FEE_R });
    unwrap(await old.stop_rll_main_loop());
  });
});

describe('reset tools', () => {
  it('log what they removed: balances become undistributed, the block says how much', async () => {
    const owners = await rll.balances_count();
    const totals = Object.fromEntries((await rll.all_token_balances()).map(([p, n]) => [P(p), n]));
    const counts = { distribution_events: BigInt((await rll.get_distribution_events()).length), user_distribution_events: BigInt((await rll.get_user_distribution_events()).length), claim_events: BigInt((await rll.get_claim_events()).length) };
    const neurons = await rll.imported_neurons_count();
    const mark = await logLength();
    await rll.clear_all_balances_and_distributions();
    await rll.clear_balances();
    await rll.clear_imported_neurons();
    await rll.clear_known_tokens();
    await rll.clear_known_tokens(); // nothing left: no block
    await rll.clear_whitelisted_tokens();
    const blocks = await since(mark);
    const all = blocks[0];
    expect(all).toMatchObject({ t: 'rll_admin_action', caller: P(admin), action: 'clear_all_balances_and_distributions', owners, ...counts });
    expect(Object.fromEntries(all.totals.map((x) => [x.ledger, x.amount]))).toEqual(totals);
    expect(blocks[1]).toMatchObject({ action: 'clear_balances', owners: 0n, totals: [] });
    expect(blocks[2]).toMatchObject({ action: 'clear_imported_neurons', count: neurons });
    expect(configs(blocks.slice(3))).toEqual([['known_tokens_cleared', 2n, undefined], ['whitelist_cleared', 3n, undefined]]);
    expect(blocks).toHaveLength(5);
    await verifiedLog();
  });
});
