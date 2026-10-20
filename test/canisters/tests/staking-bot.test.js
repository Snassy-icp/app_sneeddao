// sneed_icp_staking_bot (actor class NeuronManagerCanister) on PocketIC with a
// mock NNS governance canister at the real governance id and the mock ICRC-1
// ledger at the real ICP ledger id (both on the NNS subnet): the controller and
// botkey permission model (the factory as a co-controller and its hand-over),
// staking from the canister balance and claiming from deposits, dissolve
// delays and the 2-year NNS maximum, hotkeys, following, voting, proposals,
// maturity (stake, spawn, disburse, the removed merge), split and merge,
// disbursing and withdrawing ICP and other tokens, governance refusals, the
// four chores and their timers (refresh stake, confirm following, collect
// maturity, distribute funds), logs, events between two bots and an upgrade.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import {
  createPic, install, actorAs, account, user, admin, alice, bob, carol, ICP_LEDGER_ID, T, wasm, refusedAtIngress,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { idlFactory as botIdl } from '../build/sneed_icp_staking_bot.did.js';

const GOVERNANCE_ID = Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai');
const ICP_FEE = 10_000n;
const E8S = 100_000_000n;
const DAY = 86_400n;
const SIX_MONTHS = 15_778_800n;
const MAX_DISSOLVE = 63_072_000n; // 2 years
const factory = user('factory');
const dave = user('dave');

// ---- mock NNS governance (test/canisters/canisters/MockNnsGovernance.mo) ----
const govIdl = ({ IDL }) => {
  const NeuronId = IDL.Record({ id: IDL.Nat64 });
  const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
  // a reduced view of the NNS Neuron record (Candid skips the other fields)
  const Neuron = IDL.Record({
    id: IDL.Opt(NeuronId), controller: IDL.Opt(IDL.Principal), account: IDL.Vec(IDL.Nat8),
    cached_neuron_stake_e8s: IDL.Nat64, maturity_e8s_equivalent: IDL.Nat64, staked_maturity_e8s_equivalent: IDL.Opt(IDL.Nat64),
    hot_keys: IDL.Vec(IDL.Principal), followees: IDL.Vec(IDL.Tuple(IDL.Int32, IDL.Record({ followees: IDL.Vec(NeuronId) }))),
    dissolve_state: IDL.Opt(IDL.Variant({ DissolveDelaySeconds: IDL.Nat64, WhenDissolvedTimestampSeconds: IDL.Nat64 })),
    auto_stake_maturity: IDL.Opt(IDL.Bool), visibility: IDL.Opt(IDL.Int32), spawn_at_timestamp_seconds: IDL.Opt(IDL.Nat64),
    recent_ballots: IDL.Vec(IDL.Record({ vote: IDL.Int32, proposal_id: IDL.Opt(NeuronId) })),
    aging_since_timestamp_seconds: IDL.Nat64, voting_power_refreshed_timestamp_seconds: IDL.Opt(IDL.Nat64),
  });
  const GovernanceError = IDL.Record({ error_message: IDL.Text, error_type: IDL.Int32 });
  return IDL.Service({
    create_neuron: IDL.Func([IDL.Principal, IDL.Nat64, IDL.Nat64, IDL.Nat64], [IDL.Nat64], []),
    set_maturity: IDL.Func([IDL.Nat64, IDL.Nat64], [], []),
    set_staked_maturity: IDL.Func([IDL.Nat64, IDL.Nat64], [], []),
    set_stake: IDL.Func([IDL.Nat64, IDL.Nat64], [], []),
    set_age: IDL.Func([IDL.Nat64, IDL.Nat64], [], []),
    set_controller: IDL.Func([IDL.Nat64, IDL.Principal], [], []),
    set_mode: IDL.Func([IDL.Variant({ normal: IDL.Null, trap: IDL.Null, refuse: IDL.Text, empty_reply: IDL.Null, unexpected_reply: IDL.Null })], [], []),
    set_max_dissolve_delay: IDL.Func([IDL.Nat64], [], []),
    add_proposal: IDL.Func([IDL.Nat64], [], []),
    clear_calls: IDL.Func([], [], []),
    get_neuron: IDL.Func([IDL.Nat64], [IDL.Opt(Neuron)], ['query']),
    neuron_subaccount: IDL.Func([IDL.Principal, IDL.Nat64], [IDL.Vec(IDL.Nat8)], ['query']),
    get_calls: IDL.Func([], [IDL.Vec(IDL.Text)], ['query']),
    get_disbursements: IDL.Func([], [IDL.Vec(IDL.Record({ neuron: IDL.Nat64, amount_e8s: IDL.Nat64, to_account_id: IDL.Opt(IDL.Vec(IDL.Nat8)), to: Account, block: IDL.Nat64 }))], ['query']),
    get_maturity_disbursements: IDL.Func([], [IDL.Vec(IDL.Record({ neuron: IDL.Nat64, amount_e8s: IDL.Nat64, to: Account }))], ['query']),
    get_proposals: IDL.Func([], [IDL.Vec(IDL.Record({ id: IDL.Nat64, proposer: IDL.Opt(IDL.Nat64), title: IDL.Opt(IDL.Text), summary: IDL.Text, url: IDL.Text, motion: IDL.Opt(IDL.Text) }))], ['query']),
    get_full_neuron: IDL.Func([IDL.Nat64], [IDL.Variant({ Ok: Neuron, Err: GovernanceError })], ['query']),
  });
};

// ---- the NNS derivations, independently in JavaScript ----
const sha = (alg, ...parts) => Uint8Array.from(createHash(alg).update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest());
const u64be = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
const neuronSubaccount = (controller, memo) => sha('sha256', [0x0c], Buffer.from('neuron-stake'), controller.toUint8Array(), u64be(memo));
function accountIdentifier(owner, subaccount = new Uint8Array(32)) {
  const hash = sha('sha224', [0x0a], Buffer.from('account-id'), owner.toUint8Array(), subaccount);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(hash));
  return Uint8Array.from([...crc, ...hash]);
}
const bytes = (b) => Array.from(b);

let pic, appSubnet, icpId, govId, botId, tokenId, bot2Id;
let icp, token, gov, bot, botFactory, botAlice, botCarol, botBob, bot2;
const nowS = async () => BigInt(Math.floor((await pic.getTime()) / 1000));
const neuron = async (id) => (await gov.get_neuron(id))[0];
const delayOf = (n) => n.dissolve_state[0].DissolveDelaySeconds;
const ok = (r) => { if (!('Ok' in r)) throw new Error(`expected Ok, got ${JSON.stringify(r, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`); return r.Ok; };
const err = (r) => { if (!('Err' in r)) throw new Error(`expected Err, got ${JSON.stringify(r, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`); return r.Err; };
const govErr = (r) => err(r).GovernanceError;
const icpOf = (p, sub) => icp.icrc1_balance_of(account(p, sub));
const noFilter = { minLevel: [], source: [], caller: [], fromTime: [], toTime: [], startId: [], limit: [] };
const eventTypesLogged = async (b = bot) => (await b.getEventLog({ eventTypeId: [], fromTime: [], toTime: [], startId: [], limit: [500n] })).entries.map((e) => Number(e.eventTypeId));
const lastEvent = async (b = bot) => { const es = (await b.getEventLog({ eventTypeId: [], fromTime: [], toTime: [], startId: [], limit: [500n] })).entries; return es[es.length - 1]; };
const status = async (id) => (await bot.getChoreStatus(id))[0];
/// Let timers run until the chore finished one more run (or give up).
async function runChore(id, before) {
  for (let i = 0; i < 80; i++) {
    await pic.advanceTime(5_000);
    await pic.tick(3);
    const s = await status(id);
    if (s.totalRunCount > before && 'Idle' in s.conductorStatus) return s;
  }
  throw new Error(`chore ${id} did not finish: ${JSON.stringify(await status(id), (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
}
async function startAndRun(id, start = (b) => b.startChore(id)) {
  const before = (await status(id)).totalRunCount;
  await start(bot);
  return runChore(id, before);
}

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  govId = await install(pic, { name: 'MockNnsGovernance', targetCanisterId: GOVERNANCE_ID });
  expect(govId.toText()).toBe(GOVERNANCE_ID.toText());
  tokenId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 1_000n, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  // as the factory installs it: the owner and the factory are both controllers
  botId = await install(pic, { name: 'sneed_icp_staking_bot', targetSubnetId: appSubnet, controllers: [admin, factory] });
  icp = actorAs(pic, ledgerIdl, icpId, admin);
  token = actorAs(pic, ledgerIdl, tokenId, admin);
  gov = actorAs(pic, govIdl, govId, admin);
  bot = actorAs(pic, botIdl, botId, admin);
  botFactory = actorAs(pic, botIdl, botId, factory);
  botAlice = actorAs(pic, botIdl, botId, alice);
  botBob = actorAs(pic, botIdl, botId, bob);
  botCarol = actorAs(pic, botIdl, botId, carol);
  await pic.tick(2);
});

afterAll(async () => { await pic?.tearDown(); });

describe('identity and public queries', () => {
  it('reports its version, creation time and accounts', async () => {
    expect(await botAlice.getVersion()).toEqual({ major: 0n, minor: 9n, patch: 5n });
    const created = await botAlice.getCreatedAt();
    const now = BigInt(Math.ceil(await pic.getTime())) * 1_000_000n; // getTime has millisecond precision
    expect(created <= now + 1_000_000n && created > now - 60n * 1_000_000_000n).toBe(true);
    expect(await botAlice.getAccount()).toEqual({ owner: botId, subaccount: [] });
    expect(bytes(await botAlice.getAccountId())).toEqual(bytes(accountIdentifier(botId)));
    const memo = await botAlice.generateMemo();
    expect(memo > 0n && BigInt(memo) <= now + 10n * 1_000_000_000n).toBe(true);
  });

  it('derives the neuron staking account exactly as the NNS does', async () => {
    for (const memo of [0n, 42n, 0xffff_ffff_ffff_ffffn]) {
      const { account: acct, memo: m } = await botAlice.getStakeAccount(memo);
      expect(m).toBe(memo);
      expect(acct.owner.toText()).toBe(GOVERNANCE_ID.toText());
      expect(bytes(acct.subaccount[0])).toEqual(bytes(neuronSubaccount(botId, memo)));
      expect(bytes(acct.subaccount[0])).toEqual(bytes(await gov.neuron_subaccount(botId, memo)));
    }
  });

  it('lists its permission types, chores, event types and reaction actions', async () => {
    const types = await botAlice.listPermissionTypes();
    expect(types.map(([id]) => Number(id))).toEqual([0, 1, 2, 3, 4, 5, 6, ...Array.from({ length: 23 }, (_, i) => 100 + i)]);
    expect(Object.keys(types[0][1])).toEqual(['FullPermissions']);
    expect((await bot.getChoreTypes()).map((t) => t.id).sort()).toEqual(['collect-maturity', 'confirm-following', 'distribute-funds', 'refresh-stake']);
    const statuses = await bot.getChoreStatuses();
    expect(statuses).toHaveLength(4);
    expect(statuses.every((s) => !s.enabled && 'Idle' in s.schedulerStatus && s.totalRunCount === 0n)).toBe(true);
    const configs = Object.fromEntries((await bot.getChoreConfigs()).map(([id, c]) => [id, c]));
    expect(configs['refresh-stake'].intervalSeconds).toBe(86_400n);
    expect(configs['confirm-following'].intervalSeconds).toBe(30n * 86_400n);
    expect(configs['collect-maturity'].intervalSeconds).toBe(7n * 86_400n);
    expect(configs['distribute-funds'].intervalSeconds).toBe(86_400n);
    expect((await bot.listChoreInstances([])).map(([id]) => id).sort()).toEqual(['collect-maturity', 'confirm-following', 'distribute-funds', 'refresh-stake']);
    expect(await bot.getChoreStatus('nope')).toEqual([]);
    const events = new Map((await bot.getEventTypes()).map(([id, name]) => [Number(id), name]));
    expect(events.get(100)).toBe('NeuronStaked');
    expect(events.get(161)).toBe('TokenWithdrawn');
    expect((await bot.getAvailableReactionActions()).map(([id]) => Number(id))).toEqual([0, 1, 2, 3, 4, 5, 100, 101, 102, 103, 104, 105, 106]);
    expect(await bot.getEventEmissionEnabled()).toBe(true);
    expect(await bot.getEventListeners()).toEqual([]);
    expect(await bot.getEventSubscriptions()).toEqual([]);
    expect(await bot.getEventReactions()).toEqual([]);
    const cfg = await bot.getLogConfig();
    expect(cfg).toHaveProperty('logLevel');
    expect(cfg.logLevel).toEqual({ Info: null });
  });
});

describe('controllers and botkeys', () => {
  it('gives every controller, the factory included, all permissions and others none', async () => {
    expect(await bot.callerPermissions()).toHaveLength(30);
    expect(await botFactory.callerPermissions()).toHaveLength(30);
    expect(await botAlice.callerPermissions()).toEqual([]);
    expect(await botFactory.checkPermission({ Disburse: null })).toBe(true);
    expect(await botAlice.checkPermission({ ViewNeuron: null })).toBe(false);
    expect(await botFactory.getBalance()).toBe(0n);
  });

  it('refuses every guarded method to a stranger (the canister traps)', async () => {
    const guarded = [
      () => botAlice.getBalance(), () => botAlice.listNeurons(), () => botAlice.getNeuronIds(), () => botAlice.hasNeuron({ id: 1n }),
      () => botAlice.stakeNeuron(E8S, SIX_MONTHS), () => botAlice.claimNeuronFromDeposit(1n, SIX_MONTHS),
      () => botAlice.withdrawIcp(1n, account(alice)), () => botAlice.withdrawToken(tokenId, 1n, account(alice)),
      () => botAlice.disburse({ id: 1n }, [], []), () => botAlice.startDissolving({ id: 1n }), () => botAlice.addHotKey({ id: 1n }, alice),
      () => botAlice.addHotkeyPermissions(alice, [{ FullPermissions: null }]), () => botAlice.getBotkeySnapshot(),
      () => botAlice.getLogs(noFilter), () => botAlice.getChoreStatuses(), () => botAlice.startChore('refresh-stake'),
      () => botAlice.setEventEmissionEnabled(false), () => botAlice.getEventLog({ eventTypeId: [], fromTime: [], toTime: [], startId: [], limit: [] }),
    ];
    for (const call of guarded) await expect(call()).rejects.toThrow();
  });

  it('grants, merges and removes botkey permissions', async () => {
    expect(err(await bot.addHotkeyPermissions(Principal.anonymous(), [{ ViewNeuron: null }]))).toEqual({ InvalidOperation: 'Cannot add anonymous principal as hotkey' });
    ok(await bot.addHotkeyPermissions(carol, [{ ViewNeuron: null }, { ViewLogs: null }]));
    ok(await bot.addHotkeyPermissions(carol, [{ ViewNeuron: null }, { ViewChores: null }])); // merged, no duplicates
    expect(await botAlice.getHotkeyPermissions(carol)).toEqual([{ ViewNeuron: null }, { ViewLogs: null }, { ViewChores: null }]);
    expect(await botCarol.callerPermissions()).toEqual([{ ViewNeuron: null }, { ViewLogs: null }, { ViewChores: null }]);
    expect(await botCarol.checkPermission({ ViewNeuron: null })).toBe(true);
    expect(await botCarol.checkPermission({ WithdrawFunds: null })).toBe(false);
    expect(await botCarol.getBalance()).toBe(0n);
    await expect(botCarol.withdrawIcp(1n, account(carol))).rejects.toThrow();
    await expect(botCarol.addHotkeyPermissions(carol, [{ WithdrawFunds: null }])).rejects.toThrow(); // no self-escalation

    // a botkey holding ManagePermissions may hand out permissions; FullPermissions implies all
    ok(await bot.addHotkeyPermissions(bob, [{ ManagePermissions: null }]));
    ok(await botBob.addHotkeyPermissions(dave, [{ FullPermissions: null }]));
    const botDave = actorAs(pic, botIdl, botId, dave);
    expect(await botDave.callerPermissions()).toHaveLength(30);
    expect(await botDave.checkPermission({ ConfigureDistribution: null })).toBe(true);
    // ... but snapshots stay controller-only, FullPermissions or not
    await expect(botDave.getBotkeySnapshot()).rejects.toThrow();

    ok(await bot.removeHotkeyPermissions(carol, [{ ViewChores: null }]));
    expect(await bot.getHotkeyPermissions(carol)).toEqual([{ ViewNeuron: null }, { ViewLogs: null }]);
    ok(await bot.removeHotkeyPermissions(bob, [{ ManagePermissions: null }])); // last one: bob disappears
    ok(await bot.removeHotkeyPrincipal(dave));
    expect((await bot.listHotkeyPrincipals()).map((p) => p.principal.toText())).toEqual([carol.toText()]);
    await expect(botDave.getBalance()).rejects.toThrow();
  });

  it('lets controllers (Sneedex escrow) snapshot, clear and restore botkeys', async () => {
    const snap = await botFactory.getBotkeySnapshot();
    expect(snap).toEqual([[carol, [116n, 3n]]]);
    await bot.clearBotkeys();
    expect(await bot.listHotkeyPrincipals()).toEqual([]);
    await expect(botCarol.getBalance()).rejects.toThrow();
    await expect(botCarol.restoreBotkeySnapshot(snap)).rejects.toThrow();
    // unknown ids from a future version survive the round trip but are not shown
    await bot.restoreBotkeySnapshot([[carol, [116n, 3n, 199n]]]);
    expect(await bot.getHotkeyPermissions(carol)).toEqual([{ ViewNeuron: null }, { ViewLogs: null }]);
    expect(await bot.getBotkeySnapshot()).toEqual([[carol, [116n, 3n, 199n]]]);
    expect(await botCarol.getBalance()).toBe(0n);
  });
});

let staked; // 10 ICP, 1 year
describe('staking from the canister balance', () => {
  it('refuses without enough ICP or below the 1 ICP minimum', async () => {
    expect(err(await bot.stakeNeuron(10n * E8S, DAY))).toEqual({ InsufficientFunds: { balance: 0n, required: 10n * E8S + ICP_FEE } });
    await icp.mint(account(botId), E8S);
    // the balance covers 0.5 ICP, but the stake is below the NNS minimum
    expect(err(await bot.stakeNeuron(E8S / 2n, DAY))).toEqual({ InsufficientFunds: { balance: E8S / 2n, required: E8S } });
    expect(await bot.getBalance()).toBe(E8S); // nothing moved
  });

  it('transfers to the neuron account, claims and sets the dissolve delay', async () => {
    await icp.mint(account(botId), 30n * E8S); // 31 ICP
    staked = ok(await bot.stakeNeuron(10n * E8S, 365n * DAY)).id;
    expect(await bot.getBalance()).toBe(21n * E8S - ICP_FEE);
    const n = await neuron(staked);
    expect(n.controller[0].toText()).toBe(botId.toText());
    expect(n.cached_neuron_stake_e8s).toBe(10n * E8S);
    const d = delayOf(n);
    expect(d <= 365n * DAY && d >= 365n * DAY - 5n).toBe(true); // set as a timestamp a few rounds earlier
    const calls = await gov.get_calls();
    const claim = calls.find((c) => c.startsWith('claim_or_refresh_neuron_from_account'));
    const memo = BigInt(claim.match(/memo=(\d+)/)[1]);
    expect(bytes(n.account)).toEqual(bytes(neuronSubaccount(botId, memo))); // memo = Time.now() in ns
    expect(calls.some((c) => c.startsWith(`Configure.SetDissolveTimestamp(neuron ${staked} by ${botId.toText()}`))).toBe(true);
    const ev = await lastEvent();
    expect(Number(ev.eventTypeId)).toBe(100);
    expect(ev.data).toEqual([['neuronId', `${staked}`], ['amount_e8s', `${10n * E8S}`], ['dissolveDelay', `${365n * DAY}`]]);
  });

  it('answers the neuron views for its own neurons only', async () => {
    expect(await bot.getNeuronIds()).toEqual([{ id: staked }]);
    expect(await bot.getNeuronCount()).toBe(1n);
    expect(await botCarol.hasNeuron({ id: staked })).toBe(true);
    expect((await bot.listNeurons()).map((n) => n.id[0].id)).toEqual([staked]);
    const full = (await bot.getFullNeuron({ id: staked }))[0];
    expect(full.cached_neuron_stake_e8s).toBe(10n * E8S);
    const info = (await bot.getNeuronInfo({ id: staked }))[0];
    expect(info.stake_e8s).toBe(10n * E8S);
    expect(info.state).toBe(1); // locked
    expect(info.voting_power).toBe(10n * E8S);
    const all = await bot.getAllNeuronsInfo();
    expect(all).toHaveLength(1);
    expect(all[0][0]).toEqual({ id: staked });
    expect(all[0][1][0]).toMatchObject({ stake_e8s: 10n * E8S, state: 1 });
    expect(await bot.getNeuronAccount({ id: staked })).toEqual([{ owner: GOVERNANCE_ID, subaccount: [full.account] }]);
    // someone else's neuron (alice controls it) and a missing one look like nothing
    const foreign = await gov.create_neuron(alice, 2n * E8S, SIX_MONTHS, 0n);
    expect(await bot.hasNeuron({ id: foreign })).toBe(false);
    expect(await bot.getFullNeuron({ id: foreign })).toEqual([]);
    expect(await bot.getNeuronInfo({ id: foreign })).toEqual([]);
    expect(await bot.getNeuronAccount({ id: foreign })).toEqual([]); // the mock does not show foreign full neurons
    expect(await bot.getNeuronInfo({ id: 999_999n })).toEqual([]);
    expect(err(await bot.startDissolving({ id: foreign }))).toEqual({ NoNeuron: null });
    expect(err(await bot.refreshStake({ id: 999_999n }))).toEqual({ NoNeuron: null });
  });

  it('accepts any dissolve delay and leaves the cap to the NNS (2 years since the 2026 change)', async () => {
    // the bot does not validate on purpose (main.mo: "let NNS governance enforce the limits")
    const id = ok(await bot.stakeNeuron(2n * E8S, 8n * 365n * DAY)).id;
    expect(delayOf(await neuron(id))).toBe(MAX_DISSOLVE);
    expect((await bot.getNeuronInfo({ id }))[0].dissolve_delay_seconds).toBe(MAX_DISSOLVE);
  });

  it('returns and logs the memo when governance refuses the claim, so the ICP can be reclaimed', async () => {
    // stakeNeuron transfers first and claims second; on a failed claim the ICP sits in the
    // neuron account, and the error and the log carry the memo for claimNeuronFromDeposit
    const before = await bot.getBalance();
    await gov.set_mode({ refuse: 'governance is busy' });
    const e = govErr(await bot.stakeNeuron(3n * E8S, SIX_MONTHS));
    expect(e.error_message).toMatch(/^governance is busy \(ICP was sent to the neuron account with memo=\d+; claim it with claimNeuronFromDeposit\)$/);
    await gov.set_mode({ normal: null });
    expect(await bot.getBalance()).toBe(before - 3n * E8S - ICP_FEE); // gone from the bot
    const memo = BigInt(e.error_message.match(/memo=(\d+)/)[1]);
    const failLog = (await bot.getLogs({ ...noFilter, source: ['api'] })).entries.filter((l) => l.message === 'stakeNeuron: claim failed').pop();
    expect(failLog.tags).toEqual(expect.arrayContaining([['memo', `${memo}`], ['error', 'governance is busy']]));
    expect(await icpOf(GOVERNANCE_ID, neuronSubaccount(botId, memo))).toBe(3n * E8S);
    const rescued = ok(await bot.claimNeuronFromDeposit(memo, SIX_MONTHS)).id;
    expect((await neuron(rescued)).cached_neuron_stake_e8s).toBe(3n * E8S);
  });
});

let claimed; // 3 ICP + 1 refreshed, 6 months + 1 day
let dissolved; // 2 ICP, delay 0
describe('claiming a neuron from a deposit', () => {
  it('claims what was sent to the staking account and sets the delay', async () => {
    const { account: acct } = await bot.getStakeAccount(42n);
    await icp.mint(acct, 3n * E8S);
    claimed = ok(await botFactory.claimNeuronFromDeposit(42n, SIX_MONTHS + DAY)).id;
    const n = await neuron(claimed);
    expect(n.cached_neuron_stake_e8s).toBe(3n * E8S);
    expect(bytes(n.account)).toEqual(bytes(neuronSubaccount(botId, 42n)));
    const d = delayOf(n);
    expect(d <= SIX_MONTHS + DAY && d >= SIX_MONTHS + DAY - 5n).toBe(true);
  });

  it('reports the NNS refusal for a deposit below 1 ICP', async () => {
    const { account: acct } = await bot.getStakeAccount(43n);
    await icp.mint(acct, E8S / 2n);
    const e = govErr(await bot.claimNeuronFromDeposit(43n, SIX_MONTHS));
    expect(e.error_type).toBe(14);
    expect(e.error_message).toMatch(/at least 1 ICP/);
  });

  it('claims with a zero delay without setting one', async () => {
    const { account: acct } = await bot.getStakeAccount(44n);
    await icp.mint(acct, 2n * E8S);
    const count = await bot.getNeuronCount();
    await gov.clear_calls();
    dissolved = ok(await bot.claimNeuronFromDeposit(44n, 0n)).id;
    expect(await bot.getNeuronCount()).toBe(count + 1n);
    expect((await bot.getNeuronIds()).map((n) => n.id).reduce((a, b) => (a > b ? a : b))).toBe(dissolved);
    expect((await gov.get_calls()).some((c) => c.startsWith('Configure.'))).toBe(false);
    expect(bytes((await neuron(dissolved)).account)).toEqual(bytes(neuronSubaccount(botId, 44n)));
    expect((await bot.getNeuronInfo({ id: dissolved }))[0].state).toBe(3); // dissolved
  });

  it('refreshes the stake after a top-up and says when governance gives no answer', async () => {
    const acct = (await bot.getNeuronAccount({ id: claimed }))[0];
    await icp.mint(acct, E8S);
    ok(await bot.refreshStakeFromDeposit({ id: claimed }));
    expect((await neuron(claimed)).cached_neuron_stake_e8s).toBe(4n * E8S);
    expect(err(await bot.refreshStakeFromDeposit({ id: 999_999n }))).toEqual({ NoNeuron: null });
    await gov.set_mode({ empty_reply: null });
    expect(govErr(await bot.claimNeuronFromDeposit(45n, SIX_MONTHS)).error_message).toBe('No result from claim - no ICP deposited?');
    expect(govErr(await bot.refreshStake({ id: claimed })).error_message).toBe('No response from refresh');
    await gov.set_mode({ normal: null });
    ok(await bot.refreshStake({ id: claimed }));
    expect(Number((await lastEvent()).eventTypeId)).toBe(130);
  });
});

describe('increasing the stake', () => {
  it('sends ICP from the bot to the neuron and refreshes', async () => {
    const before = await bot.getBalance();
    ok(await bot.increaseStake({ id: claimed }, E8S));
    expect((await neuron(claimed)).cached_neuron_stake_e8s).toBe(5n * E8S);
    expect(await bot.getBalance()).toBe(before - E8S - ICP_FEE);
    expect(Number((await lastEvent()).eventTypeId)).toBe(131);
  });

  it('refuses more than the balance, foreign and unknown neurons', async () => {
    expect(err(await bot.increaseStake({ id: claimed }, 1_000n * E8S))).toEqual({ TransferFailed: 'Insufficient balance' });
    const foreign = await gov.create_neuron(bob, 2n * E8S, 0n, 0n);
    // governance hides a foreign full neuron, so the bot reports the governance error
    expect(govErr(await bot.increaseStake({ id: foreign }, E8S)).error_type).toBe(3);
    expect(govErr(await bot.increaseStake({ id: 999_999n }, E8S)).error_type).toBe(4);
  });
});

describe('dissolve delay and dissolving', () => {
  it('increases the delay, refuses zero and clamps at 2 years', async () => {
    const before = delayOf(await neuron(claimed));
    ok(await bot.setDissolveDelay({ id: claimed }, Number(30n * DAY)));
    expect(delayOf(await neuron(claimed))).toBe(before + 30n * DAY);
    expect(Number((await lastEvent()).eventTypeId)).toBe(112);
    expect(govErr(await bot.setDissolveDelay({ id: claimed }, 0)).error_message).toMatch(/Additional delay is 0/);
    // a Nat32 holds up to 136 years; the NNS caps at 2 years
    const id = ok(await bot.stakeNeuron(E8S, SIX_MONTHS)).id;
    ok(await bot.setDissolveDelay({ id }, 4_000_000_000));
    expect(delayOf(await neuron(id))).toBe(MAX_DISSOLVE);
  });

  it('starts and stops dissolving with the matching refusals', async () => {
    const id = staked;
    ok(await bot.startDissolving({ id }));
    expect((await bot.getNeuronInfo({ id }))[0].state).toBe(2);
    expect(Number((await lastEvent()).eventTypeId)).toBe(110);
    expect(govErr(await bot.startDissolving({ id })).error_type).toBe(6);
    await pic.advanceTime(10_000); await pic.tick();
    ok(await bot.stopDissolving({ id }));
    const n = await neuron(id);
    expect('DissolveDelaySeconds' in n.dissolve_state[0]).toBe(true);
    expect(n.dissolve_state[0].DissolveDelaySeconds < 365n * DAY).toBe(true); // the time spent dissolving is gone
    expect(Number((await lastEvent()).eventTypeId)).toBe(111);
    expect(govErr(await bot.stopDissolving({ id })).error_type).toBe(7);
  });
});

describe('hotkeys, following, voting, proposals and neuron settings', () => {
  it('adds and removes NNS hotkeys on the neuron', async () => {
    ok(await bot.addHotKey({ id: staked }, carol));
    expect((await neuron(staked)).hot_keys.map((p) => p.toText())).toEqual([carol.toText()]);
    expect(Number((await lastEvent()).eventTypeId)).toBe(150);
    expect(govErr(await bot.addHotKey({ id: staked }, carol)).error_message).toMatch(/already exists/);
    // the hotkey reads the neuron at governance directly
    const govCarol = actorAs(pic, govIdl, govId, carol);
    expect('Ok' in (await govCarol.get_full_neuron(staked))).toBe(true);
    ok(await bot.removeHotKey({ id: staked }, carol));
    expect((await neuron(staked)).hot_keys).toEqual([]);
    expect(Number((await lastEvent()).eventTypeId)).toBe(151);
    expect(govErr(await bot.removeHotKey({ id: staked }, carol)).error_message).toMatch(/could not be found/);
    expect(err(await govCarol.get_full_neuron(staked)).error_type).toBe(3);
  });

  it('sets, confirms and clears followees', async () => {
    ok(await bot.setFollowing({ id: staked }, 4, [{ id: 27n }, { id: 28n }]));
    ok(await bot.setFollowing({ id: staked }, 0, [{ id: 27n }]));
    expect((await neuron(staked)).followees).toEqual([[4, { followees: [{ id: 27n }, { id: 28n }] }], [0, { followees: [{ id: 27n }] }]]);
    await gov.clear_calls();
    ok(await bot.confirmFollowing({ id: staked }));
    expect((await gov.get_calls()).filter((c) => c.startsWith('Follow('))).toEqual([
      `Follow(neuron ${staked} by ${botId.toText()},topic=4,n=2)`, `Follow(neuron ${staked} by ${botId.toText()},topic=0,n=1)`,
    ]);
    expect(Number((await lastEvent()).eventTypeId)).toBe(141);
    ok(await bot.setFollowing({ id: staked }, 0, []));
    expect((await neuron(staked)).followees.map(([t]) => t)).toEqual([4]);
    const tooMany = Array.from({ length: 16 }, (_, i) => ({ id: BigInt(i + 1) }));
    expect(govErr(await bot.setFollowing({ id: staked }, 4, tooMany)).error_message).toMatch(/Too many followees/);
    expect(err(await bot.setFollowing({ id: 999_999n }, 4, []))).toEqual({ NoNeuron: null });
  });

  it('votes once per proposal, with enough dissolve delay', async () => {
    await gov.add_proposal(77n);
    ok(await bot.vote({ id: staked }, 77n, 1));
    expect((await neuron(staked)).recent_ballots).toEqual([{ vote: 1, proposal_id: [{ id: 77n }] }]);
    expect((await lastEvent()).data).toEqual([['neuronId', `${staked}`], ['proposalId', '77'], ['vote', '1']]);
    expect(govErr(await bot.vote({ id: staked }, 77n, 2)).error_type).toBe(19);
    expect(govErr(await bot.vote({ id: staked }, 78n, 1)).error_message).toMatch(/not found/);
    expect(govErr(await bot.vote({ id: staked }, 77n, 3)).error_message).toMatch(/Invalid vote/);
    expect(govErr(await bot.vote({ id: dissolved }, 77n, 1)).error_message).toMatch(/not eligible to vote/);
    ok(await bot.refreshVotingPower({ id: staked }));
  });

  it('makes a motion proposal with a big enough neuron', async () => {
    const r = ok(await bot.makeProposal({ id: staked }, { url: 'https://sneeddao.com', title: ['Test'], summary: 'a motion', action: [{ Motion: { motion_text: 'do it' } }] }));
    expect(r.proposal_id).toHaveLength(1);
    const p = (await gov.get_proposals()).find((x) => x.id === r.proposal_id[0].id);
    expect(p).toMatchObject({ proposer: [staked], title: ['Test'], motion: ['do it'] });
    expect(govErr(await bot.makeProposal({ id: claimed }, { url: '', title: [], summary: 's', action: [] })).error_message).toMatch(/enough stake/);
  });

  it('sets visibility and auto-stake maturity', async () => {
    ok(await bot.setVisibility({ id: staked }, 2));
    expect((await neuron(staked)).visibility).toEqual([2]);
    expect(govErr(await bot.setVisibility({ id: staked }, 5)).error_type).toBe(5);
    ok(await bot.setAutoStakeMaturity({ id: staked }, true));
    expect((await neuron(staked)).auto_stake_maturity).toEqual([true]);
    ok(await bot.setAutoStakeMaturity({ id: staked }, false));
    expect((await neuron(staked)).auto_stake_maturity).toEqual([false]);
  });

  it('keeps the NNS operations behind their botkey permissions', async () => {
    ok(await bot.addHotkeyPermissions(bob, [{ ManageFollowees: null }, { Vote: null }]));
    ok(await botBob.confirmFollowing({ id: staked }));
    ok(await botBob.refreshVotingPower({ id: staked }));
    for (const call of [
      () => botBob.setVisibility({ id: staked }, 1), () => botBob.addHotKey({ id: staked }, bob), () => botBob.stakeMaturity({ id: staked }, 1),
      () => botBob.spawnMaturity({ id: staked }, 1, []), () => botBob.splitNeuron({ id: staked }, E8S), () => botBob.mergeNeurons({ id: staked }, { id: claimed }),
      () => botBob.setDissolveDelay({ id: staked }, 1), () => botBob.makeProposal({ id: staked }, { url: '', title: [], summary: '', action: [] }),
      () => botBob.disburseMaturity({ id: staked }, 1, []), () => botBob.mergeMaturity({ id: staked }, 1), () => botBob.setAutoStakeMaturity({ id: staked }, true),
      () => botBob.increaseStake({ id: staked }, 1n), () => botBob.refreshStake({ id: staked }),
    ]) await expect(call()).rejects.toThrow();
    ok(await bot.removeHotkeyPrincipal(bob));
  });
});

describe('maturity', () => {
  it('stakes a share of the maturity', async () => {
    await gov.set_maturity(staked, 5n * E8S);
    ok(await bot.stakeMaturity({ id: staked }, 50));
    const n = await neuron(staked);
    expect(n.maturity_e8s_equivalent).toBe(25n * E8S / 10n);
    expect(n.staked_maturity_e8s_equivalent).toEqual([25n * E8S / 10n]);
    expect((await bot.getNeuronInfo({ id: staked }))[0].stake_e8s).toBe(10n * E8S + 25n * E8S / 10n);
    expect((await lastEvent()).data).toEqual([['neuronId', `${staked}`], ['percentage', '50']]);
    expect(govErr(await bot.stakeMaturity({ id: staked }, 0)).error_type).toBe(5);
    expect(govErr(await bot.stakeMaturity({ id: staked }, 101)).error_type).toBe(5);
    expect(govErr(await bot.stakeMaturity({ id: claimed }, 100)).error_message).toMatch(/no maturity/);
  });

  it('passes on the NNS refusal of the retired merge-maturity command', async () => {
    expect(govErr(await bot.mergeMaturity({ id: staked }, 100)).error_message).toMatch(/no longer supported/);
  });

  it('spawns maturity into a new neuron of the bot or of another controller', async () => {
    let spawned = ok(await bot.spawnMaturity({ id: staked }, 100, [])).id;
    let s = await neuron(spawned);
    expect(s.controller[0].toText()).toBe(botId.toText());
    expect(s.maturity_e8s_equivalent).toBe(25n * E8S / 10n);
    expect(s.spawn_at_timestamp_seconds).toHaveLength(1);
    expect((await bot.getNeuronInfo({ id: spawned }))[0].state).toBe(4); // spawning
    expect((await neuron(staked)).maturity_e8s_equivalent).toBe(0n);
    expect((await bot.getNeuronIds()).map((n) => n.id)).toContain(spawned);
    expect((await lastEvent()).data).toEqual([['neuronId', `${staked}`], ['newNeuronId', `${spawned}`], ['percentage', '100']]);
    expect(govErr(await bot.spawnMaturity({ id: staked }, 100, [])).error_message).toMatch(/enough maturity/);
    // to alice: the new neuron is hers, the bot no longer sees it
    await gov.set_maturity(staked, 3n * E8S);
    spawned = ok(await bot.spawnMaturity({ id: staked }, 50, [alice])).id;
    s = await neuron(spawned);
    expect(s.controller[0].toText()).toBe(alice.toText());
    expect(s.maturity_e8s_equivalent).toBe(15n * E8S / 10n);
    expect(await bot.hasNeuron({ id: spawned })).toBe(false);
    expect((await bot.getNeuronIds()).map((n) => n.id)).not.toContain(spawned);
    expect((await neuron(staked)).maturity_e8s_equivalent).toBe(15n * E8S / 10n);
  });

  it('disburses maturity to an account', async () => {
    const before = await icpOf(alice);
    ok(await bot.disburseMaturity({ id: staked }, 100, [account(alice)]));
    expect(await icpOf(alice)).toBe(before + 15n * E8S / 10n);
    expect((await neuron(staked)).maturity_e8s_equivalent).toBe(0n);
    expect(Number((await lastEvent()).eventTypeId)).toBe(120);
    expect(govErr(await bot.disburseMaturity({ id: staked }, 100, [])).error_type).toBe(14);
    // without an account the NNS pays the controller: the bot itself
    await gov.set_maturity(claimed, E8S);
    const own = await bot.getBalance();
    ok(await bot.disburseMaturity({ id: claimed }, 40, []));
    expect(await bot.getBalance()).toBe(own + 4n * E8S / 10n);
  });
});

describe('splitting and merging neurons', () => {
  let part;
  it('splits off a new neuron with the parent settings', async () => {
    part = ok(await bot.splitNeuron({ id: staked }, 3n * E8S)).id;
    const [p, c] = [await neuron(staked), await neuron(part)];
    expect(p.cached_neuron_stake_e8s).toBe(7n * E8S);
    expect(c.cached_neuron_stake_e8s).toBe(3n * E8S - ICP_FEE);
    expect(c.dissolve_state).toEqual(p.dissolve_state);
    expect(c.controller[0].toText()).toBe(botId.toText());
    expect((await lastEvent()).data).toEqual([['neuronId', `${staked}`], ['newNeuronId', `${part}`], ['amount_e8s', `${3n * E8S}`]]);
    expect(govErr(await bot.splitNeuron({ id: staked }, E8S / 2n)).error_type).toBe(14);
    expect(govErr(await bot.splitNeuron({ id: part }, 25n * E8S / 10n)).error_message).toMatch(/less than 1 ICP/);
  });

  it('merges a source neuron into a target, both its own', async () => {
    ok(await bot.mergeNeurons({ id: staked }, { id: part }));
    expect((await neuron(staked)).cached_neuron_stake_e8s).toBe(10n * E8S - 2n * ICP_FEE);
    expect((await neuron(part)).cached_neuron_stake_e8s).toBe(0n);
    expect((await bot.getNeuronIds()).map((n) => n.id)).not.toContain(part); // empty neurons are not listed
    expect(Number((await lastEvent()).eventTypeId)).toBe(103);
    const foreign = await gov.create_neuron(alice, 2n * E8S, SIX_MONTHS, 0n);
    expect(err(await bot.mergeNeurons({ id: staked }, { id: foreign }))).toEqual({ InvalidOperation: 'Source neuron is not controlled by this canister' });
    expect(err(await bot.mergeNeurons({ id: foreign }, { id: staked }))).toEqual({ NoNeuron: null });
  });
});

describe('disbursing neurons and withdrawing funds', () => {
  it('refuses to disburse a neuron that is not dissolved', async () => {
    expect(govErr(await bot.disburse({ id: staked }, [], [])).error_type).toBe(8);
  });

  it('disburses a dissolved neuron to the bot', async () => {
    const before = await bot.getBalance();
    const r = ok(await bot.disburse({ id: dissolved }, [], []));
    expect(await bot.getBalance()).toBe(before + 2n * E8S - ICP_FEE);
    const d = (await gov.get_disbursements()).pop();
    expect(d).toMatchObject({ neuron: dissolved, amount_e8s: 2n * E8S, to_account_id: [], block: r.transfer_block_height });
    expect((await bot.getNeuronIds()).map((n) => n.id)).not.toContain(dissolved);
    expect(Number((await lastEvent()).eventTypeId)).toBe(101);
  });

  it('disburses part of a neuron to an account identifier', async () => {
    const id = await gov.create_neuron(botId, 3n * E8S, 0n, 0n);
    expect(await bot.hasNeuron({ id })).toBe(true);
    const aliceId = accountIdentifier(alice);
    expect(govErr(await bot.disburse({ id }, [4n * E8S], [aliceId])).error_type).toBe(14);
    ok(await bot.disburse({ id }, [E8S], [aliceId]));
    expect(bytes((await gov.get_disbursements()).pop().to_account_id[0])).toEqual(bytes(aliceId));
    expect(await icpOf(GOVERNANCE_ID, aliceId)).toBe(E8S - ICP_FEE); // the mock's sink for account ids
    expect((await neuron(id)).cached_neuron_stake_e8s).toBe(2n * E8S);
  });

  it('withdraws ICP from the canister', async () => {
    const balance = await bot.getBalance();
    expect(err(await bot.withdrawIcp(balance, account(bob)))).toEqual({ TransferFailed: 'Insufficient balance' });
    const before = await icpOf(bob);
    const r = ok(await botFactory.withdrawIcp(E8S, account(bob)));
    expect(r.transfer_block_height).toBeTypeOf('bigint');
    expect(await icpOf(bob)).toBe(before + E8S);
    expect(await bot.getBalance()).toBe(balance - E8S - ICP_FEE);
    expect((await lastEvent()).data).toEqual([['amount_e8s', `${E8S}`], ['to', bob.toText()]]);
    // the whole balance minus the fee is the most that can leave
    await icp.set_paused(true);
    expect(err(await bot.withdrawIcp(1n, account(bob)))).toEqual({ TransferFailed: 'Temporarily unavailable' });
    await icp.set_paused(false);
  });

  it('withdraws any ICRC-1 token at that ledger\'s fee', async () => {
    await token.mint(account(botId), 50_000n);
    expect(await bot.getTokenBalance(tokenId)).toBe(50_000n);
    // the method has no permission check, but as an update call it is only accepted from the
    // bot's controllers and botkeys (ingress guard)
    expect(await refusedAtIngress(botAlice.getTokenBalance(tokenId))).toBe(true);
    expect(err(await bot.withdrawToken(tokenId, 49_001n, account(alice)))).toEqual({ TransferFailed: 'Insufficient token balance' });
    ok(await bot.withdrawToken(tokenId, 49_000n, account(alice)));
    expect(await token.icrc1_balance_of(account(alice))).toBe(49_000n);
    expect(await bot.getTokenBalance(tokenId)).toBe(0n);
    expect(Number((await lastEvent()).eventTypeId)).toBe(161);
  });
});

describe('governance failures', () => {
  it('turns refusals, empty and unexpected replies into errors', async () => {
    await gov.set_mode({ refuse: 'not today' });
    expect(govErr(await bot.setFollowing({ id: staked }, 4, []))).toEqual({ error_message: 'not today', error_type: 11 });
    expect(govErr(await bot.startDissolving({ id: staked })).error_message).toBe('not today');
    await gov.set_mode({ empty_reply: null });
    for (const r of [await bot.vote({ id: staked }, 77n, 1), await bot.disburse({ id: staked }, [], []), await bot.spawnMaturity({ id: staked }, 1, []), await bot.setVisibility({ id: staked }, 1)]) {
      expect(govErr(r).error_message).toBe('No response');
    }
    await gov.set_mode({ unexpected_reply: null });
    expect(err(await bot.stakeMaturity({ id: staked }, 1))).toEqual({ InvalidOperation: 'Unexpected response' });
    expect(err(await bot.disburse({ id: staked }, [], []))).toEqual({ InvalidOperation: 'Unexpected response' });
    expect(err(await bot.refreshStake({ id: staked }))).toEqual({ InvalidOperation: 'Unexpected response' });
    ok(await bot.setFollowing({ id: staked }, 4, [])); // a Follow reply is the expected one here
    await gov.set_mode({ normal: null });
    ok(await bot.setFollowing({ id: staked }, 4, [{ id: 27n }]));
  });

  it('fails the call when governance traps', async () => {
    await gov.set_mode({ trap: null });
    await expect(bot.startDissolving({ id: staked })).rejects.toThrow();
    await expect(bot.claimNeuronFromDeposit(46n, SIX_MONTHS)).rejects.toThrow();
    await gov.set_mode({ normal: null });
    expect((await bot.getNeuronInfo({ id: staked }))[0].state).toBe(1); // untouched
  });
});

describe('chores (automation timers)', () => {
  it('refresh-stake picks up ICP sent straight to the neuron accounts', async () => {
    const acct = (await bot.getNeuronAccount({ id: claimed }))[0];
    await icp.mint(acct, E8S);
    const before = (await neuron(claimed)).cached_neuron_stake_e8s;
    const s = await startAndRun('refresh-stake');
    expect((await neuron(claimed)).cached_neuron_stake_e8s).toBe(before + E8S);
    expect(s.enabled).toBe(true);
    expect('Scheduled' in s.schedulerStatus).toBe(true);
    expect(s.totalSuccessCount).toBe(1n);
    const next = s.nextScheduledRunAt[0];
    const now = BigInt(Math.round(await pic.getTime())) * 1_000_000n;
    expect(next > now + 86_000n * 1_000_000_000n && next <= now + 86_400n * 1_000_000_000n).toBe(true);
    const logs = (await bot.getLogs({ ...noFilter, source: ['chore:refresh-stake'] })).entries.map((e) => e.message);
    expect(logs.some((m) => /Starting: found \d+ neurons/.test(m))).toBe(true);
    expect(logs.some((m) => m === `Refreshed stake for neuron ${claimed}`)).toBe(true);
  });

  it('runs again on its own a day later', async () => {
    const acct = (await bot.getNeuronAccount({ id: claimed }))[0];
    await icp.mint(acct, E8S);
    const before = (await status('refresh-stake')).totalRunCount;
    await pic.advanceTime(86_400 * 1000);
    await pic.tick(2);
    const s = await runChore('refresh-stake', before);
    expect(s.totalRunCount).toBe(before + 1n);
    expect((await neuron(claimed)).cached_neuron_stake_e8s).toBe(7n * E8S); // 5 + 1 + 1
  });

  it('confirm-following re-applies every topic of every neuron', async () => {
    await gov.clear_calls();
    await startAndRun('confirm-following');
    const follows = (await gov.get_calls()).filter((c) => c.startsWith('Follow('));
    expect(follows).toContain(`Follow(neuron ${staked} by ${botId.toText()},topic=4,n=1)`);
    const logs = (await bot.getLogs({ ...noFilter, source: ['chore:confirm-following'] })).entries.map((e) => e.message);
    expect(logs).toContain(`Confirmed 1/1 topics for neuron ${staked}`);
  });

  it('collect-maturity respects the threshold and the destination', async () => {
    await gov.set_maturity(staked, 3n * E8S);
    await bot.setCollectMaturityThreshold('collect-maturity', [5n * E8S]);
    await startAndRun('collect-maturity');
    expect((await neuron(staked)).maturity_e8s_equivalent).toBe(3n * E8S); // below threshold: skipped
    await bot.setCollectMaturityThreshold('collect-maturity', [E8S]);
    await bot.setCollectMaturityDestination('collect-maturity', [account(carol)]);
    expect(await bot.getCollectMaturitySettings('collect-maturity')).toEqual({ thresholdE8s: [E8S], destination: [account(carol)] });
    const before = await icpOf(carol);
    await startAndRun('collect-maturity', (b) => b.triggerChore('collect-maturity'));
    expect(await icpOf(carol)).toBe(before + 3n * E8S);
    expect((await neuron(staked)).maturity_e8s_equivalent).toBe(0n);
    // the neuron still spawning from the maturity tests is skipped, not failed
    const logs = (await bot.getLogs(noFilter)).entries;
    expect(logs.some((e) => /Failed to disburse maturity/.test(e.message))).toBe(false);
    expect(logs.some((e) => /^Neuron \d+ is spawning, skipping$/.test(e.message))).toBe(true);
    const ev = (await bot.getEventLog({ eventTypeId: [120n], fromTime: [], toTime: [], startId: [], limit: [] })).entries.pop();
    expect(ev.data).toEqual([['neuronId', `${staked}`], ['maturity_e8s', `${3n * E8S}`], ['destination', carol.toText()]]);
    // no destination: the bot's own account
    await bot.setCollectMaturityDestination('collect-maturity', []);
    await bot.setCollectMaturityThreshold('collect-maturity', []);
    await gov.set_maturity(staked, 2n * E8S);
    const own = await bot.getBalance();
    await startAndRun('collect-maturity', (b) => b.triggerChore('collect-maturity'));
    expect(await bot.getBalance()).toBe(own + 2n * E8S + 6n * E8S / 10n); // + the 60% left on the claimed neuron
  });

  it('distribute-funds shares the bot balance by basis points (the revenue share)', async () => {
    const input = (over = {}) => ({
      name: 'split', tokenLedgerCanisterId: ICP_LEDGER_ID, thresholdAmount: 0n, amountMode: 0n, balancePercent: [], sourcePurseId: [],
      minDistributionAmount: E8S, maxDistributionAmount: E8S,
      targets: [{ account: account(alice), basisPoints: [6000n], choreInstanceId: [] }, { account: account(bob), basisPoints: [], choreInstanceId: [] }],
      ...over,
    });
    expect(await bot.addDistributionList('distribute-funds', input())).toBe(1n);
    expect(await bot.addDistributionList('distribute-funds', input({ name: 'never', thresholdAmount: 10_000n * E8S }))).toBe(2n);
    expect((await bot.getDistributionLists('distribute-funds')).map((l) => l.name)).toEqual(['split', 'never']);
    const [a, b, own] = [await icpOf(alice), await icpOf(bob), await bot.getBalance()];
    await startAndRun('distribute-funds');
    const net = E8S - 2n * ICP_FEE; // the fees for both transfers come out of the amount
    expect(await icpOf(alice)).toBe(a + net * 6000n / 10000n);
    expect(await icpOf(bob)).toBe(b + net * 4000n / 10000n);
    expect(await bot.getBalance()).toBe(own - net - 2n * ICP_FEE);
    expect(await eventTypesLogged()).toContain(10); // DistributionExecuted
    // percentage mode: 10% of the balance, capped by the maximum
    await bot.updateDistributionList('distribute-funds', 1n, input({ amountMode: 1n, balancePercent: [1000n], maxDistributionAmount: 1_000n * E8S }));
    expect((await bot.getDistributionLists('distribute-funds'))[0]).toMatchObject({ id: 1n, amountMode: 1n, balancePercent: [1000n] });
    const bal = await bot.getBalance();
    const a2 = await icpOf(alice);
    await startAndRun('distribute-funds', (x) => x.triggerChore('distribute-funds'));
    expect(await icpOf(alice)).toBe(a2 + (bal * 1000n / 10000n - 2n * ICP_FEE) * 6000n / 10000n);
    await bot.removeDistributionList('distribute-funds', 2n);
    expect((await bot.getDistributionLists('distribute-funds')).map((l) => l.id)).toEqual([1n]);
  });

  it('pauses, resumes, re-times and stops chores', async () => {
    await bot.pauseChore('refresh-stake');
    let s = await status('refresh-stake');
    expect(s.paused).toBe(true);
    expect('Idle' in s.schedulerStatus).toBe(true);
    await bot.resumeChore('refresh-stake');
    s = await status('refresh-stake');
    expect(s.paused).toBe(false);
    expect('Scheduled' in s.schedulerStatus).toBe(true);
    await bot.setChoreInterval('refresh-stake', 3_600n);
    await bot.setChoreMaxInterval('refresh-stake', [7_200n]);
    await bot.setChoreTaskTimeout('refresh-stake', 60n);
    s = await status('refresh-stake');
    expect([s.intervalSeconds, s.maxIntervalSeconds, s.taskTimeoutSeconds]).toEqual([3_600n, [7_200n], 60n]);
    const at = (BigInt(Math.round(await pic.getTime())) + 600_000n) * 1_000_000n;
    await bot.setChoreNextRun('refresh-stake', at);
    expect((await status('refresh-stake')).nextScheduledRunAt).toEqual([at]);
    const before = (await status('refresh-stake')).totalRunCount;
    await pic.advanceTime(601_000); await pic.tick(2);
    await runChore('refresh-stake', before);
    await bot.stopChore('refresh-stake');
    s = await status('refresh-stake');
    expect(s.enabled).toBe(false);
    expect('Idle' in s.schedulerStatus).toBe(true);
    // scheduleStart arms the first run without running now
    const later = (BigInt(Math.round(await pic.getTime())) + 3_600_000n) * 1_000_000n;
    await bot.scheduleStartChore('refresh-stake', later);
    s = await status('refresh-stake');
    expect(s.enabled && s.totalRunCount === before + 1n && s.nextScheduledRunAt[0] === later).toBe(true);
    await bot.stopAllChores();
    expect((await bot.getChoreStatuses()).every((x) => !x.enabled)).toBe(true);
  });

  it('manages extra chore instances', async () => {
    expect(await bot.createChoreInstance('collect-maturity', 'cm-2', 'Second')).toBe(true);
    expect(await bot.createChoreInstance('collect-maturity', 'cm-2', 'Again')).toBe(false);
    await expect(bot.createChoreInstance('no-such-type', 'x', 'x')).rejects.toThrow(/Unknown chore type/);
    expect(await bot.renameChoreInstance('cm-2', 'Renamed')).toBe(true);
    expect(await bot.renameChoreInstance('missing', 'x')).toBe(false);
    expect(await bot.listChoreInstances(['collect-maturity'])).toEqual([['collect-maturity', { typeId: 'collect-maturity', instanceLabel: 'Collect Maturity' }], ['cm-2', { typeId: 'collect-maturity', instanceLabel: 'Renamed' }]]);
    // per-instance settings
    await bot.setCollectMaturityThreshold('cm-2', [7n]);
    expect((await bot.getCollectMaturitySettings('cm-2')).thresholdE8s).toEqual([7n]);
    await bot.startChore('cm-2');
    expect(await bot.deleteChoreInstance('cm-2')).toBe(false); // must be stopped first
    await bot.stopChore('cm-2');
    expect(await bot.deleteChoreInstance('cm-2')).toBe(true);
    expect(await bot.deleteChoreInstance('cm-2')).toBe(false);
  });

  it('gives each chore type its own manage permission', async () => {
    ok(await bot.addHotkeyPermissions(dave, [{ ManageRefreshStake: null }, { ViewChores: null }]));
    const botDave = actorAs(pic, botIdl, botId, dave);
    await botDave.triggerChore('refresh-stake');
    await expect(botDave.startChore('collect-maturity')).rejects.toThrow();
    await expect(botDave.stopAllChores()).rejects.toThrow(); // needs all four
    await expect(botDave.setCollectMaturityThreshold('collect-maturity', [])).rejects.toThrow();
    await expect(botDave.addDistributionList('distribute-funds', { name: 'x', tokenLedgerCanisterId: ICP_LEDGER_ID, thresholdAmount: 0n, amountMode: 0n, balancePercent: [], sourcePurseId: [], minDistributionAmount: 0n, maxDistributionAmount: 0n, targets: [] })).rejects.toThrow();
    expect(await botDave.getChoreStatuses()).toHaveLength(4);
    ok(await bot.removeHotkeyPrincipal(dave));
  });
});

describe('logs and events', () => {
  it('logs API calls with their caller and filters by level and source', async () => {
    const r = await bot.getLogs({ ...noFilter, source: ['api'], caller: [factory] });
    expect(r.entries.map((e) => e.message)).toEqual(expect.arrayContaining(['claimNeuronFromDeposit', 'withdrawIcp']));
    expect(r.entries.every((e) => e.caller[0].toText() === factory.toText())).toBe(true);
    const errors = await bot.getLogs({ ...noFilter, minLevel: [{ Error: null }] });
    expect(errors.entries.every((e) => 'Error' in e.level)).toBe(true);
    expect(errors.entries.some((e) => e.message === 'claimNeuronFromDeposit: governance error')).toBe(true);
    const page = await bot.getLogs({ ...noFilter, limit: [2n] });
    expect(page.entries).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    const summary = await botCarol.getLogAlertSummary(0n);
    expect(Object.keys(summary).length).toBeGreaterThan(0);
  });

  it('honours the log level, the size limit and clearing', async () => {
    await bot.setLogLevel({ Error: null });
    expect((await bot.getLogConfig()).logLevel).toEqual({ Error: null });
    const count = (await bot.getLogs(noFilter)).totalMatching;
    await bot.getNeuronCount(); // not an API call that logs anyway
    await bot.refreshStake({ id: staked }); // Info: not recorded now
    expect((await bot.getLogs(noFilter)).totalMatching).toBe(count);
    await bot.setLogLevel({ Info: null });
    await bot.setMaxLogEntries(5n);
    await bot.refreshStake({ id: staked });
    expect((await bot.getLogs(noFilter)).totalMatching <= 5n).toBe(true);
    await bot.clearLogs();
    // everything before the clear is gone (a chore timer may have logged since)
    const left = (await bot.getLogs(noFilter)).entries;
    expect(left.length <= 2).toBe(true);
    expect(left.some((e) => e.source === 'api' || e.source === 'log')).toBe(false);
    await bot.setMaxLogEntries(10_000n);
    await expect(botAlice.clearLogs()).rejects.toThrow();
  });

  it('records events and can switch emission off', async () => {
    const types = await eventTypesLogged();
    for (const t of [100, 101, 103, 110, 111, 112, 120, 121, 122, 130, 131, 140, 141, 150, 151, 160, 161]) expect(types).toContain(t);
    await bot.setEventEmissionEnabled(false);
    const n = (await bot.getEventLog({ eventTypeId: [], fromTime: [], toTime: [], startId: [], limit: [] })).totalMatching;
    ok(await bot.withdrawIcp(E8S / 10n, account(bob)));
    expect((await bot.getEventLog({ eventTypeId: [], fromTime: [], toTime: [], startId: [], limit: [] })).totalMatching).toBe(n);
    await bot.setEventEmissionEnabled(true);
    expect(await bot.getEventEmissionEnabled()).toBe(true);
  });

  it('delivers events to a subscribed bot that reacts', async () => {
    bot2Id = await install(pic, { name: 'sneed_icp_staking_bot', targetSubnetId: appSubnet, controllers: [admin] });
    bot2 = actorAs(pic, botIdl, bot2Id, admin);
    await icp.mint(account(bot2Id), 2n * E8S);
    // the listener needs the matching view permission on the source
    expect(err(await bot.addEventSubscription(bot2Id, [160n]))).toMatch(/Insufficient permissions/);
    ok(await bot2.addHotkeyPermissions(botId, [{ ViewNeuron: null }]));
    const sub = ok(await bot.addEventSubscription(bot2Id, [160n]));
    expect((await bot.getEventSubscriptions()).map((s) => s.id)).toEqual([sub]);
    expect((await bot2.getEventListeners()).map((l) => l.listenerCanisterId.toText())).toEqual([botId.toText()]);
    const rule = await bot.addEventReaction({ name: 'refresh on withdraw', subscriptionId: sub, eventTypeId: 160n, conditions: [], reactionActionId: 105n, actionParams: [], enabled: true, cooldownSeconds: [] });
    expect((await bot.getEventReactions()).map((r) => r.id)).toEqual([rule]);
    await gov.clear_calls();
    ok(await bot2.withdrawIcp(E8S, account(carol)));
    for (let i = 0; i < 10; i++) { await pic.advanceTime(2_000); await pic.tick(3); }
    const log = await bot.getEventReactionLog({ reactionRuleId: [], eventTypeId: [], fromTime: [], toTime: [], startId: [], limit: [] });
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0].reactionRuleId).toBe(rule);
    expect((await gov.get_calls()).some((c) => c.startsWith(`ClaimOrRefresh(neuron ${staked} by ${botId.toText()}`))).toBe(true);
    // an event from a principal that is not the source is refused (from a stranger already at ingress)
    const forged = { sourceCanisterId: bot2Id, eventTypeId: 160n, timestamp: 0n, data: [], eventId: 0n };
    expect(await refusedAtIngress(botAlice.onBotEvent(forged))).toBe(true);
    expect(err(await bot.onBotEvent(forged))).toMatch(/does not match/);
    await bot.removeEventReaction(rule);
    await bot.removeEventSubscription(sub);
    expect(await bot.getEventSubscriptions()).toEqual([]);
  });
});

describe('handing the bot over', () => {
  it('drops the factory\'s rights once it is removed as controller', async () => {
    await pic.updateCanisterSettings({ canisterId: botId, controllers: [admin], sender: admin });
    expect(await botFactory.callerPermissions()).toEqual([]);
    await expect(botFactory.getBalance()).rejects.toThrow();
    await expect(botFactory.getBotkeySnapshot()).rejects.toThrow();
    expect((await bot.callerPermissions()).length).toBe(30);
    // a new owner gets everything by becoming controller
    await pic.updateCanisterSettings({ canisterId: botId, controllers: [admin, alice], sender: admin });
    expect(await botAlice.callerPermissions()).toHaveLength(30);
    expect(await botAlice.getNeuronCount()).toBeGreaterThan(0n);
    await pic.updateCanisterSettings({ canisterId: botId, controllers: [admin], sender: admin });
  });
});

describe('upgrade', () => {
  let before;
  beforeAll(async () => {
    ok(await bot.addHotkeyPermissions(carol, [{ ViewChores: null }]));
    await bot.startChore('refresh-stake');
    await bot.setCollectMaturityThreshold('collect-maturity', [123n]);
    // a distribution list using every field added after the first release
    await bot.addDistributionList('distribute-funds', {
      name: 'full', tokenLedgerCanisterId: ICP_LEDGER_ID, thresholdAmount: 5n, amountMode: 1n, balancePercent: [2500n], sourcePurseId: ['purse-1'],
      minDistributionAmount: 77n, maxDistributionAmount: 1_000n,
      targets: [{ account: account(alice), basisPoints: [10000n], choreInstanceId: ['collect-maturity'] }],
    });
    for (let i = 0; i < 10; i++) { await pic.advanceTime(5_000); await pic.tick(3); }
    before = {
      createdAt: await bot.getCreatedAt(), hotkeys: await bot.getBotkeySnapshot(), neurons: await bot.getNeuronIds(),
      configs: await bot.getChoreConfigs(), cm: await bot.getCollectMaturitySettings('collect-maturity'),
      lists: await bot.getDistributionLists('distribute-funds'), logs: (await bot.getLogs(noFilter)).totalMatching,
      events: (await bot.getEventLog({ eventTypeId: [], fromTime: [], toTime: [], startId: [], limit: [] })).totalMatching,
      refresh: await status('refresh-stake'), balance: await bot.getBalance(),
    };
    await pic.upgradeCanister({ sender: admin, canisterId: botId, wasm: wasm('sneed_icp_staking_bot') });
  });

  it('keeps permissions, neurons, chores, settings, logs and events', async () => {
    expect(await bot.getVersion()).toEqual({ major: 0n, minor: 9n, patch: 5n });
    expect(await bot.getCreatedAt()).toBe(before.createdAt);
    expect(await bot.getBotkeySnapshot()).toEqual(before.hotkeys);
    expect(await botCarol.getChoreStatuses()).toHaveLength(4);
    expect(await bot.getNeuronIds()).toEqual(before.neurons);
    expect(await bot.getBalance()).toBe(before.balance);
    expect(await bot.getChoreConfigs()).toEqual(before.configs);
    expect(await bot.getCollectMaturitySettings('collect-maturity')).toEqual(before.cm);
    expect((await bot.getLogs(noFilter)).totalMatching >= before.logs).toBe(true);
    expect((await bot.getEventLog({ eventTypeId: [], fromTime: [], toTime: [], startId: [], limit: [] })).totalMatching).toBe(before.events);
    const s = await status('refresh-stake');
    expect(s.enabled).toBe(true);
    expect('Scheduled' in s.schedulerStatus).toBe(true);
    expect(s.nextScheduledRunAt).toEqual(before.refresh.nextScheduledRunAt);
    expect(s.totalRunCount).toBe(before.refresh.totalRunCount);
  });

  // the inline migration that reset the newer distribution list fields on every upgrade is gone
  it('keeps the distribution lists unchanged', async () => {
    const full = before.lists.find((l) => l.name === 'full');
    expect(full).toMatchObject({ amountMode: 1n, balancePercent: [2500n], minDistributionAmount: 77n, sourcePurseId: ['purse-1'] });
    expect(full.targets[0].choreInstanceId).toEqual(['collect-maturity']);
    expect(await bot.getDistributionLists('distribute-funds')).toEqual(before.lists);
  });

  it('still runs its chores after the upgrade', async () => {
    const acct = (await bot.getNeuronAccount({ id: claimed }))[0];
    await icp.mint(acct, E8S);
    const stake = (await neuron(claimed)).cached_neuron_stake_e8s;
    await startAndRun('refresh-stake', (b) => b.triggerChore('refresh-stake'));
    expect((await neuron(claimed)).cached_neuron_stake_e8s).toBe(stake + E8S);
  });
});

// Fixed 2026-10-20 (sneed_icp_staking_bot 0.9.5).
describe('chore instances and distribution amounts', () => {
  const distInput = (over = {}) => ({
    name: 'd', tokenLedgerCanisterId: tokenId, thresholdAmount: 0n, amountMode: 0n, balancePercent: [], sourcePurseId: [],
    minDistributionAmount: 0n, maxDistributionAmount: 0n,
    targets: [{ account: account(alice), basisPoints: [5000n], choreInstanceId: [] }, { account: account(carol), basisPoints: [], choreInstanceId: [] }],
    ...over,
  });
  const tok = (p) => token.icrc1_balance_of(account(p));

  // amountMode 0 with minDistributionAmount 0 (every list migrated from 0.9.1, and every list the
  // staking bot page saves) paid a random amount in [0, min(balance, max)]; it pays min(balance, max)
  it('amount mode 0 pays min(balance, max), with minDistributionAmount as a floor', async () => {
    await bot.createChoreInstance('distribute-funds', 'df-amt', 'Amounts');
    const own0 = await bot.getTokenBalance(tokenId);
    await token.mint(account(botId), 1_000_000n);
    const id = await bot.addDistributionList('df-amt', distInput({ maxDistributionAmount: 400_000n }));
    const [a0, c0] = [await tok(alice), await tok(carol)];
    await startAndRun('df-amt');
    const net = 400_000n - 2n * 1_000n;
    expect(await tok(alice)).toBe(a0 + net / 2n);
    expect(await tok(carol)).toBe(c0 + net / 2n);
    // now the balance is below the maximum: all of it goes
    const bal = await bot.getTokenBalance(tokenId);
    expect(bal).toBe(own0 + 1_000_000n - 400_000n);
    await bot.updateDistributionList('df-amt', id, distInput({ maxDistributionAmount: 10_000_000n }));
    await startAndRun('df-amt', (b) => b.triggerChore('df-amt'));
    expect(await bot.getTokenBalance(tokenId)).toBe(0n);
    expect(await tok(alice)).toBe(a0 + net / 2n + (bal - 2_000n) / 2n);
    // below minDistributionAmount the list is skipped
    await token.mint(account(botId), 50_000n);
    await bot.updateDistributionList('df-amt', id, distInput({ maxDistributionAmount: 10_000_000n, minDistributionAmount: 60_000n }));
    await startAndRun('df-amt', (b) => b.triggerChore('df-amt'));
    expect(await bot.getTokenBalance(tokenId)).toBe(50_000n);
    await bot.stopChore('df-amt');
  });

  // a second instance of confirm-following or refresh-stake set its tasks under the default
  // instance's id (and shared its neuron list), so it never ran its own work
  it('a second confirm-following instance runs its own run', async () => {
    await bot.stopAllChores();
    expect(await bot.createChoreInstance('confirm-following', 'cf-2', 'Second')).toBe(true);
    const def = await status('confirm-following');
    await gov.clear_calls();
    const s = await startAndRun('cf-2');
    expect(s.totalSuccessCount).toBe(1n);
    expect((await gov.get_calls()).some((c) => c.startsWith(`Follow(neuron ${staked} `))).toBe(true);
    const logs = (await bot.getLogs({ ...noFilter, source: ['chore:cf-2'] })).entries.map((e) => e.message);
    expect(logs).toContain(`Confirmed 1/1 topics for neuron ${staked}`);
    expect((await status('confirm-following')).totalRunCount).toBe(def.totalRunCount); // untouched
    await bot.stopChore('cf-2');
  });

  it('a second refresh-stake instance runs its own run', async () => {
    expect(await bot.createChoreInstance('refresh-stake', 'rs-2', 'Second')).toBe(true);
    const def = await status('refresh-stake');
    const acct = (await bot.getNeuronAccount({ id: claimed }))[0];
    await icp.mint(acct, E8S);
    const stake = (await neuron(claimed)).cached_neuron_stake_e8s;
    const s = await startAndRun('rs-2');
    expect(s.totalSuccessCount).toBe(1n);
    expect((await neuron(claimed)).cached_neuron_stake_e8s).toBe(stake + E8S);
    const logs = (await bot.getLogs({ ...noFilter, source: ['chore:rs-2'] })).entries.map((e) => e.message);
    expect(logs).toContain(`Refreshed stake for neuron ${claimed}`);
    expect((await status('refresh-stake')).totalRunCount).toBe(def.totalRunCount);
    await bot.stopChore('rs-2');
  });

  it('distribution logs and events name their own instance', async () => {
    await token.mint(account(botId), 100_000n);
    expect(await bot.createChoreInstance('distribute-funds', 'df-2', 'Second')).toBe(true);
    await bot.addDistributionList('df-2', distInput({ maxDistributionAmount: 100_000n }));
    await startAndRun('df-2');
    const ev = (await bot.getEventLog({ eventTypeId: [10n], fromTime: [], toTime: [], startId: [], limit: [500n] })).entries.pop();
    expect(ev.data).toContainEqual(['choreId', 'df-2']);
    const logs = (await bot.getLogs({ ...noFilter, source: ['chore:df-2'] })).entries.map((e) => e.message);
    expect(logs.some((m) => /^Distributed \d+ from list 'd'/.test(m))).toBe(true);
    await bot.stopChore('df-2');
  });
});
