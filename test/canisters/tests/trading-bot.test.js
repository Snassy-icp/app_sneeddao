// Integration tests of the sneed_trading_bot canister on PocketIC. The bot
// talks to ICP, ckUSDC, the ICPSwap factory and KongSwap by their mainnet ids,
// so mocks are installed at exactly those ids (PocketIC creates the subnets
// that own them): MockLedger for ICP and ckUSDC, MockIcpswapFactory,
// MockKongSwap, and a MockDexPool for the AAA/BBB pair the factory points at.
// Covered: botkey permissions (controller vs hotkey vs anyone), the token
// registry, pause/freeze, DEX and action configuration, withdrawals and sends
// with fee handling, balance reconciliation and capital flows, chore purses
// and the accounting identity, one-off trades through ICPSwap (ICRC-1 and
// ICRC-2 paths) and KongSwap, slippage/impact/min-output guards, failed swaps
// and pool recovery, the circuit breaker, a trade chore run on its timers,
// logs, an upgrade, and the bounds on basis-point settings (slippage and
// price impact at most 10 000 bps).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import {
  createPic, install, actorAs, account, principalToSubaccount, refusedAtIngress,
  admin, alice, bob, carol, user, ICP_LEDGER_ID, T, wasm,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { idlFactory as botIdl } from '../build/sneed_trading_bot.did.js';

const CKUSDC_ID = Principal.fromText('xevnm-gaaaa-aaaar-qafnq-cai');
const FACTORY_ID = Principal.fromText('4mmnk-kiaaa-aaaag-qbllq-cai');
const KONG_ID = Principal.fromText('2ipq2-uqaaa-aaaar-qailq-cai');

const ICP_FEE = 10_000n;
const FEE_A = 1_000n;
const FEE_B = 500n;

// ---- Candid of the new mocks (canisters/MockIcpswapFactory.mo, MockDexPool.mo, MockKongSwap.mo) ----
const factoryIdl = ({ IDL }) => IDL.Service({
  set_pool: IDL.Func([IDL.Principal, IDL.Principal, IDL.Text, IDL.Text, IDL.Principal], [], []),
  clear_pools: IDL.Func([], [], []),
});
const dexPoolInit = (IDL) => [IDL.Record({ token0: IDL.Principal, token1: IDL.Principal })];
const dexPoolIdl = ({ IDL }) => {
  const PoolError = IDL.Variant({ CommonError: IDL.Null, InternalError: IDL.Text, UnsupportedToken: IDL.Text, InsufficientFunds: IDL.Null });
  return IDL.Service({
    getUserUnusedBalance: IDL.Func([IDL.Principal], [IDL.Variant({ ok: IDL.Record({ balance0: IDL.Nat, balance1: IDL.Nat }), err: PoolError })], ['query']),
    set_rate: IDL.Func([IDL.Nat, IDL.Nat], [], []),
    set_swap_bps: IDL.Func([IDL.Nat], [], []),
    set_fail: IDL.Func([IDL.Bool], [], []),
    get_swaps: IDL.Func([], [IDL.Vec(IDL.Record({ caller: IDL.Principal, zeroForOne: IDL.Bool, amountIn: IDL.Nat, amountOut: IDL.Nat, path: IDL.Text }))], ['query']),
  });
};
const kongIdl = ({ IDL }) => IDL.Service({
  set_rate: IDL.Func([IDL.Principal, IDL.Principal, IDL.Nat, IDL.Nat], [], []),
  clear_rates: IDL.Func([], [], []),
  set_slippage: IDL.Func([IDL.Float64], [], []),
  set_swap_bps: IDL.Func([IDL.Nat], [], []),
  set_fail: IDL.Func([IDL.Bool], [], []),
  get_swaps: IDL.Func([], [IDL.Vec(IDL.Record({ caller: IDL.Principal, pay_token: IDL.Text, pay_amount: IDL.Nat, receive_token: IDL.Text, receive_amount: IDL.Nat, pay_tx_id: IDL.Opt(IDL.Nat) }))], ['query']),
});

let pic, appSubnet;
let icpId, ckusdcId, tokenAId, tokenBId, poolId, botId;
let icp, tokenA, tokenB, factory, pool, kong, bot, botAlice, botBob, botCarol;
let aIsToken0; // ICPSwap orders a pair by principal text

const dave = user('dave');
const hot = user('hotkey-trader');
const P = (name) => ({ [name]: null });
const bal = (ledger, owner, sub = null) => ledger.icrc1_balance_of(account(owner, sub));
const botBal = (ledger) => bal(ledger, botId);
const regEntry = (id, symbol, fee, decimals = 8) => ({ ledgerCanisterId: id, symbol, decimals, fee });

/// Pool output for `amountIn` of `inputToken` at rate token1 = 2 * token0.
const poolQuote = (amountIn, inputIsA) => ((inputIsA === aIsToken0) ? amountIn * 2n : amountIn / 2n);

/// An ActionConfigInput with everything optional left out.
const action = (over) => ({
  key: '', actionType: 0n, enabled: true, inputToken: tokenAId, outputToken: [], minAmount: 0n, maxAmount: 0n,
  amountMode: 0n, balancePercent: [], preferredDex: [], sourcePurseId: [], targetPurseId: [],
  destinationOwner: [], destinationSubaccount: [], minBalance: [], maxBalance: [], balanceDenominationToken: [],
  minPrice: [], maxPrice: [], priceDenominationToken: [], maxPriceImpactBps: [], maxSlippageBps: [],
  minFrequencySeconds: [], maxFrequencySeconds: [], tradeSizeDenominationToken: [], trailingStopBps: [],
  trailingStopDirection: [], trailingStopResetOnExec: [], haltChoreAfterExecution: false,
  maxCumulativeInput: [], maxCumulativeOutput: [], maxExecutions: [], ...over,
});
const oneOff = (over) => ({
  inputToken: tokenAId, outputToken: tokenBId, inputAmount: 100_000n, minOutputAmount: [], maxSlippageBps: [],
  maxPriceImpactBps: [], preferredDex: [], sourcePurseId: [], ...over,
});
const tradeLogQuery = (over = {}) => ({
  startId: [], limit: [500n], offset: [], choreId: [], choreTypeId: [], actionType: [], inputToken: [], outputToken: [],
  status: [], fromTime: [], toTime: [], ...over,
});
const logFilter = (over = {}) => ({ minLevel: [], source: [], caller: [], fromTime: [], toTime: [], startId: [], limit: [1000n], beforeId: [], ...over });
const cond = (over) => ({
  conditionType: 2n, priceToken1: [], priceToken2: [], balanceToken: [], balanceChoreInstanceId: [], valueSources: [],
  operator: 0n, threshold: [], rangeMin: [], rangeMax: [], changePercentBps: [], changeDirection: [], changePeriodSeconds: [],
  denominationToken: [], children: [], ...over,
});

/// Let the demand-driven one-off timer (2 s) run until the entry settles.
async function settleOneOff(b, id) {
  for (let i = 0; i < 30; i++) {
    await pic.advanceTime(2_500);
    await pic.tick(8);
    const e = (await b.getOneOffTradeQueue()).find((x) => x.id === id);
    if (e && e.status >= 2n) return e;
  }
  return (await b.getOneOffTradeQueue()).find((x) => x.id === id);
}

async function installBot() {
  return install(pic, { name: 'sneed_trading_bot', cycles: 50n * T, targetSubnetId: appSubnet });
}

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  ckusdcId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 10_000n, symbol: 'ckUSDC', decimals: 6 }], targetCanisterId: CKUSDC_ID });
  const { IDL } = await import('@icp-sdk/core/candid');
  await install(pic, { name: 'MockIcpswapFactory', targetCanisterId: FACTORY_ID });
  await install(pic, { name: 'MockKongSwap', targetCanisterId: KONG_ID });
  tokenAId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_A, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  tokenBId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE_B, symbol: 'BBB', decimals: 8 }], targetSubnetId: appSubnet });
  aIsToken0 = tokenAId.toText() < tokenBId.toText();
  const [t0, t1] = aIsToken0 ? [tokenAId, tokenBId] : [tokenBId, tokenAId];
  poolId = await install(pic, { name: 'MockDexPool', initTypes: dexPoolInit(IDL), initArgs: [{ token0: t0, token1: t1 }], targetSubnetId: appSubnet });
  botId = await installBot();

  icp = actorAs(pic, ledgerIdl, icpId, admin);
  tokenA = actorAs(pic, ledgerIdl, tokenAId, admin);
  tokenB = actorAs(pic, ledgerIdl, tokenBId, admin);
  factory = actorAs(pic, factoryIdl, FACTORY_ID, admin);
  pool = actorAs(pic, dexPoolIdl, poolId, admin);
  kong = actorAs(pic, kongIdl, KONG_ID, admin);
  bot = actorAs(pic, botIdl, botId, admin);
  botAlice = actorAs(pic, botIdl, botId, alice);
  botBob = actorAs(pic, botIdl, botId, bob);
  botCarol = actorAs(pic, botIdl, botId, carol);

  // AAA is a plain ICRC-1 token for ICPSwap, BBB an ICRC-2 one: each swap direction takes a different path
  const std = (id) => (id.toText() === tokenAId.toText() ? 'ICRC1' : 'ICRC2');
  await factory.set_pool(t0, t1, std(t0), std(t1), poolId);
  await pool.set_rate(2n, 1n); // token1 = 2 x token0
  await tokenA.mint(account(poolId), 100_000_000n);
  await tokenB.mint(account(poolId), 100_000_000n);
  await tokenA.mint(account(KONG_ID), 100_000_000n);
  await tokenB.mint(account(KONG_ID), 100_000_000n);
});

afterAll(async () => { await pic?.tearDown(); });

describe('fresh install', () => {
  it('reports its version and principal and starts empty with defaults', async () => {
    const v = await bot.getVersion();
    expect(v).toEqual({ major: 0n, minor: 9n, patch: 4n });
    expect((await bot.getCanisterPrincipal()).toText()).toBe(botId.toText());
    expect(await bot.getTokenRegistry()).toEqual([]);
    expect(await bot.getEnabledDexes()).toEqual([0n, 1n]);
    expect((await bot.getSupportedDexes()).map((d) => [d.id, d.name, d.enabled])).toEqual([[0n, 'ICPSwap', true], [1n, 'KongSwap', true]]);
    expect(await bot.listHotkeyPrincipals()).toEqual([]);
    expect(await bot.getCircuitBreakerEnabled()).toBe(true);
    expect(await bot.getLoggingSettings()).toEqual({ tradeLogEnabled: true, portfolioLogEnabled: true, maxTradeLogEntries: 10_000n, maxPortfolioLogEntries: 5_000n });
    expect((await bot.getChoreTypes()).map((t) => t.id).sort()).toEqual(['distribute-funds', 'move-funds', 'rebalance', 'snapshot', 'trade']);
    expect(await bot.listChoreInstances([])).toEqual([]);
    expect(await bot.getOneOffTradeQueue()).toEqual([]);
    expect((await bot.getTradeLogStats()).totalEntries).toBe(0n);
  });
});

describe('botkey permissions', () => {
  it('gives controllers every permission and strangers none', async () => {
    const all = (await bot.listPermissionTypes()).map(([, v]) => Object.keys(v)[0]);
    expect(all).toContain('WithdrawFunds');
    expect((await bot.callerPermissions()).map((v) => Object.keys(v)[0]).sort()).toEqual([...all].sort());
    expect(await botAlice.callerPermissions()).toEqual([]);
    expect(await botAlice.checkPermission(P('ViewPortfolio'))).toBe(false);
    expect(await bot.checkPermission(P('WithdrawFunds'))).toBe(true);
  });

  it('only principals with ManagePermissions manage botkeys; anonymous cannot be a hotkey', async () => {
    await expect(botAlice.addHotkeyPermissions(alice, [P('FullPermissions')])).rejects.toThrow();
    expect(await bot.addHotkeyPermissions(Principal.anonymous(), [P('ViewPortfolio')])).toEqual({ Err: { InvalidOperation: 'Cannot add anonymous principal as hotkey' } });
    expect(await bot.addHotkeyPermissions(bob, [P('ViewPortfolio')])).toEqual({ Ok: null });
    expect(await bot.addHotkeyPermissions(bob, [P('ViewLogs'), P('ViewPortfolio')])).toEqual({ Ok: null }); // merges, no duplicates
    expect(await bot.getHotkeyPermissions(bob)).toEqual([P('ViewPortfolio'), P('ViewLogs')]);
    expect(await botBob.checkPermission(P('ViewPortfolio'))).toBe(true);
    expect(await botBob.checkPermission(P('WithdrawFunds'))).toBe(false);
    // a hotkey with ManagePermissions can delegate further
    await bot.addHotkeyPermissions(carol, [P('ManagePermissions')]);
    expect(await botCarol.addHotkeyPermissions(dave, [P('ViewChores')])).toEqual({ Ok: null });
    expect(await botCarol.removeHotkeyPrincipal(dave)).toEqual({ Ok: null });
    expect(await bot.removeHotkeyPermissions(carol, [P('ManagePermissions')])).toEqual({ Ok: null });
    // removing the last permission removes the principal
    expect((await bot.listHotkeyPrincipals()).map((h) => h.principal.toText())).toEqual([bob.toText()]);
    await expect(botCarol.addHotkeyPermissions(dave, [P('ViewChores')])).rejects.toThrow();
  });

  it('a read-only hotkey can read but not act', async () => {
    expect(await botBob.getTokenRegistry()).toEqual([]);
    await expect(botBob.addToken(regEntry(tokenAId, 'AAA', FEE_A))).rejects.toThrow();
    await expect(botBob.withdrawToken(tokenAId, 1n, account(bob))).rejects.toThrow();
    await expect(botBob.getChoreStatuses()).rejects.toThrow(); // needs ViewChores
  });

  it('FullPermissions grants everything except the controller-only botkey snapshot', async () => {
    await bot.addHotkeyPermissions(carol, [P('FullPermissions')]);
    expect(await botCarol.checkPermission(P('ExecuteOneOffTrade'))).toBe(true);
    await botCarol.setDefaultSlippage(100n);
    await expect(botCarol.getBotkeySnapshot()).rejects.toThrow();
    await expect(botCarol.restoreBotkeySnapshot([])).rejects.toThrow();
    const snap = await bot.getBotkeySnapshot();
    expect(snap.map(([p, ids]) => [p.toText(), ids])).toEqual([[bob.toText(), [200n, 3n]], [carol.toText(), [0n]]]);
    await bot.restoreBotkeySnapshot(snap);
    expect(await bot.getBotkeySnapshot()).toEqual(snap);
    await bot.removeHotkeyPrincipal(carol);
    expect(await botCarol.checkPermission(P('ExecuteOneOffTrade'))).toBe(false);
  });

  it('refuses every mutating method to a caller without permissions', async () => {
    const pr = alice;
    const calls = [
      ['addHotkeyPermissions', [pr, [P('ViewLogs')]]], ['removeHotkeyPermissions', [pr, [P('ViewLogs')]]], ['removeHotkeyPrincipal', [pr]],
      ['getBotkeySnapshot', []], ['restoreBotkeySnapshot', [[]]],
      ['addToken', [regEntry(tokenAId, 'AAA', FEE_A)]], ['removeToken', [tokenAId]], ['reorderTokenRegistry', [[]]], ['refreshTokenMetadata', [tokenAId]],
      ['pauseToken', [tokenAId]], ['unpauseToken', [tokenAId]], ['freezeToken', [tokenAId]], ['unfreezeToken', [tokenAId]],
      ['withdrawIcp', [1n, account(pr)]], ['withdrawToken', [tokenAId, 1n, account(pr)]], ['manualSend', [tokenAId, [], pr, [], 1n]],
      ['recoverPoolFunds', [tokenAId, tokenBId]],
      ['setDexEnabled', [0n, false]], ['setEnabledDexes', [[0n]]], ['setDefaultSlippage', [1n]], ['setDefaultMaxPriceImpact', [1n]],
      ['addTradeAction', ['t', action({})]], ['updateTradeAction', ['t', 0n, action({})]], ['removeTradeAction', ['t', 0n]], ['reorderTradeActions', ['t', []]],
      ['setTradeFallbackRouteTokens', ['t', []]], ['addMoveFundsAction', ['m', action({ actionType: 3n })]], ['updateMoveFundsAction', ['m', 0n, action({ actionType: 3n })]],
      ['removeMoveFundsAction', ['m', 0n]], ['resetActionStats', ['t', 0n]],
      ['setRebalanceTargets', ['r', []]], ['setRebalanceDenominationToken', ['r', tokenAId]], ['setRebalanceMaxTradeSize', ['r', 1n]], ['setRebalanceMinTradeSize', ['r', 1n]],
      ['setRebalanceMaxPriceImpactBps', ['r', 1n]], ['setRebalanceMaxSlippageBps', ['r', 1n]], ['setRebalanceThresholdBps', ['r', 1n]], ['setRebalanceFallbackRouteTokens', ['r', []]],
      ['addDistributionList', ['d', { sourcePurseId: [], name: 'x', amountMode: 0n, thresholdAmount: 0n, targets: [], balancePercent: [], maxDistributionAmount: 0n, minDistributionAmount: 0n, tokenLedgerCanisterId: tokenAId }]],
      ['removeDistributionList', ['d', 0n]],
      ['createChoreInstance', ['trade', 'x', 'x']], ['deleteChoreInstance', ['trade']], ['renameChoreInstance', ['trade', 'y']],
      ['startChore', ['trade']], ['scheduleStartChore', ['trade', 0n]], ['pauseChore', ['trade']], ['resumeChore', ['trade']], ['stopChore', ['trade']],
      ['stopAllChores', []], ['triggerChore', ['trade']], ['setChoreInterval', ['trade', 60n]], ['setChoreMaxInterval', ['trade', []]],
      ['setChoreTaskTimeout', ['trade', 60n]], ['setChoreNextRun', ['trade', 0n]],
      ['setLogLevel', [P('Debug')]], ['clearLogs', []], ['clearTradeLog', []], ['deleteTradeLogEntries', [[]]], ['adjustCapitalDeployed', [1n, 1n]],
      ['clearPortfolioSnapshots', []], ['setLoggingSettings', [{ tradeLogEnabled: false, portfolioLogEnabled: false, maxTradeLogEntries: 1n, maxPortfolioLogEntries: 1n }]],
      ['setChoreLoggingOverride', ['trade', { tradeLogEnabled: [], portfolioLogEnabled: [] }]], ['removeChoreLoggingOverride', ['trade']],
      ['setMetadataStaleness', [1n]], ['setPriceStaleness', [1n]], ['setPriceHistoryMaxSize', [1n]],
      ['addCircuitBreakerRule', [{ name: 'x', enabled: true, topLevelOperator: 0n, conditions: [], actions: [] }]],
      ['updateCircuitBreakerRule', [1n, { name: 'x', enabled: true, topLevelOperator: 0n, conditions: [], actions: [] }]],
      ['removeCircuitBreakerRule', [1n]], ['enableCircuitBreakerRule', [1n, false]], ['setCircuitBreakerEnabled', [false]], ['clearCircuitBreakerLog', []],
      ['enablePurse', ['t']], ['disablePurse', ['t']], ['fundPurse', ['t', tokenAId, 1n]], ['reclaimFromPurse', ['t', tokenAId, 1n]], ['setTradingPurseId', ['t', []]],
      ['getMainPurseBalances', []], ['getMainPurseBalance', [tokenAId]],
      ['submitOneOffTrade', [oneOff({})]], ['cancelOneOffTrade', [1n]], ['clearOneOffTradeHistory', []],
      ['setEventEmissionEnabled', [false]],
    ];
    const refused = [];
    for (const [m, args] of calls) {
      expect(typeof botAlice[m], m).toBe('function');
      try { await botAlice[m](...args); } catch { refused.push(m); }
    }
    expect(refused).toEqual(calls.map(([m]) => m));
    // and nothing changed
    expect(await bot.listHotkeyPrincipals()).toHaveLength(1);
    expect(await bot.getTokenRegistry()).toEqual([]);
  });

  it('lets a listener register for events only with the permissions those events need', async () => {
    // alice holds no botkey: refused at ingress (a botkey without the view permission is refused by the method)
    expect(await refusedAtIngress(botAlice.registerEventListener({ eventTypeIds: [200n] }))).toBe(true);
    const r = await botBob.registerEventListener({ eventTypeIds: [200n] }); // bob holds ViewPortfolio
    expect(r).toHaveProperty('Ok');
    expect(await botBob.registerEventListener({ eventTypeIds: [200n] })).toEqual({ Err: 'Listener already registered. Unregister first to update.' });
    expect(await botBob.updateEventListenerTypes(r.Ok, [0n])).toEqual({ Err: 'Insufficient permissions for requested event types' }); // ViewChores missing
    expect(await refusedAtIngress(botAlice.unregisterEventListener(r.Ok))).toBe(true); // not the owner
    expect(await bot.getEventListeners()).toHaveLength(1);
    await botBob.unregisterEventListener(r.Ok);
    expect(await bot.getEventListeners()).toEqual([]);
  });
});

describe('token registry, pause and freeze', () => {
  it('adds tokens idempotently, reorders and removes them', async () => {
    await bot.addToken(regEntry(tokenAId, 'AAA', FEE_A));
    await bot.addToken(regEntry(tokenAId, 'DUPLICATE', 1n)); // already registered: ignored
    await bot.addToken(regEntry(tokenBId, 'BBB', FEE_B));
    await bot.addToken(regEntry(icpId, 'ICP', ICP_FEE));
    expect((await bot.getTokenRegistry()).map((e) => e.symbol)).toEqual(['AAA', 'BBB', 'ICP']);
    await bot.reorderTokenRegistry([icpId, tokenBId]);
    expect((await bot.getTokenRegistry()).map((e) => e.symbol)).toEqual(['ICP', 'BBB', 'AAA']); // unlisted ones are kept at the end
    await bot.removeToken(icpId);
    expect((await bot.getTokenRegistry()).map((e) => e.symbol)).toEqual(['BBB', 'AAA']);
    await bot.addToken(regEntry(icpId, 'ICP', ICP_FEE));
  });

  it('refreshes metadata from the ledger', async () => {
    await bot.addToken({ ledgerCanisterId: ckusdcId, symbol: 'stale', decimals: 8, fee: 1n });
    await bot.refreshTokenMetadata(ckusdcId);
    expect((await bot.getTokenRegistry()).find((e) => e.ledgerCanisterId.toText() === ckusdcId.toText())).toEqual({ ledgerCanisterId: ckusdcId, symbol: 'ckUSDC', decimals: 6, fee: 10_000n });
  });

  it('pauses and freezes tokens globally, once each', async () => {
    await bot.pauseToken(tokenBId);
    await bot.pauseToken(tokenBId);
    await bot.freezeToken(tokenAId);
    expect(await bot.getPausedTokens()).toEqual([tokenBId]);
    expect(await bot.getFrozenTokens()).toEqual([tokenAId]);
    await bot.unpauseToken(tokenBId);
    await bot.unfreezeToken(tokenAId);
    expect(await bot.getPausedTokens()).toEqual([]);
    expect(await bot.getFrozenTokens()).toEqual([]);
  });
});

describe('DEX settings and action configuration', () => {
  it('never leaves zero DEXes enabled', async () => {
    await bot.setDexEnabled(1n, false);
    expect(await bot.getEnabledDexes()).toEqual([0n]);
    await bot.setDexEnabled(0n, false); // the last one: the others are enabled instead
    expect(await bot.getEnabledDexes()).toEqual([1n]);
    await bot.setEnabledDexes([]); // ignored
    expect(await bot.getEnabledDexes()).toEqual([1n]);
    await expect(bot.setEnabledDexes([0n, 7n])).rejects.toThrow(/Unknown DEX ID: 7/);
    expect(await bot.getEnabledDexes()).toEqual([1n]);
    await bot.setEnabledDexes([0n, 1n]);
    await bot.setDexEnabled(0n, true); // already on: no duplicate
    expect(await bot.getEnabledDexes()).toEqual([0n, 1n]);
  });

  it('manages trade actions with unique keys and keeps runtime stats on update', async () => {
    const id0 = await bot.addTradeAction('cfg', action({ key: 'buy-b', outputToken: [tokenBId], minAmount: 10n, maxAmount: 20n }));
    const id1 = await bot.addTradeAction('cfg', action({ outputToken: [tokenBId] })); // key auto-generated
    expect([id0, id1]).toEqual([1n, 2n]); // ids start at 1 per instance
    let actions = await bot.getTradeActions('cfg');
    expect(actions.map((a) => a.key)).toHaveLength(2);
    expect(actions[1].key).not.toBe('');
    expect(actions[0]).toMatchObject({ id: id0, key: 'buy-b', minAmount: 10n, maxAmount: 20n, executionCount: 0n, cumulativeInputSpent: 0n, lastExecutedAt: [] });
    await expect(bot.addTradeAction('cfg', action({ key: 'buy-b' }))).rejects.toThrow(/Duplicate action key/);
    await expect(bot.updateTradeAction('cfg', id1, action({ key: 'buy-b' }))).rejects.toThrow(/Duplicate action key/);
    expect(await bot.updateTradeAction('cfg', id0, action({ key: '', outputToken: [tokenBId], minAmount: 5n, maxAmount: 6n }))).toBe(true);
    expect((await bot.getTradeActions('cfg'))[0]).toMatchObject({ key: 'buy-b', minAmount: 5n, maxAmount: 6n });
    expect(await bot.updateTradeAction('cfg', 99n, action({}))).toBe(false);
    expect(await bot.reorderTradeActions('cfg', [id1])).toBe(false); // must name every action
    expect(await bot.reorderTradeActions('cfg', [id1, id0])).toBe(true);
    expect((await bot.getTradeActions('cfg')).map((a) => a.id)).toEqual([id1, id0]);
    expect(await bot.removeTradeAction('cfg', id1)).toBe(true);
    expect(await bot.removeTradeAction('cfg', id1)).toBe(false);
    expect(await bot.resetActionStats('cfg', id0)).toBe(true);
    // ids are never reused within an instance
    expect(await bot.addTradeAction('cfg', action({ outputToken: [tokenBId] }))).toBe(3n);
    // the actions of other instances are separate
    expect(await bot.getTradeActions('other')).toEqual([]);
  });

  it('refuses invalid trade action configurations: min > max, output = input, basis points above 10 000', async () => {
    const before = await bot.getTradeActions('cfg');
    const ok = { outputToken: [tokenBId], minAmount: 1n, maxAmount: 2n };
    await expect(bot.addTradeAction('cfg', action({ ...ok, minAmount: 100n, maxAmount: 1n }))).rejects.toThrow(/minAmount \(100\) must not exceed maxAmount \(1\)/);
    await expect(bot.addTradeAction('cfg', action({ ...ok, outputToken: [tokenAId] }))).rejects.toThrow(/Input and output tokens must be different/);
    await expect(bot.addTradeAction('cfg', action({ ...ok, maxSlippageBps: [10_001n] }))).rejects.toThrow(/maxSlippageBps must be at most 10000 bps/);
    await expect(bot.addTradeAction('cfg', action({ ...ok, maxPriceImpactBps: [50_000n] }))).rejects.toThrow(/maxPriceImpactBps must be at most 10000 bps/);
    const id = before[0].id;
    await expect(bot.updateTradeAction('cfg', id, action({ ...ok, minAmount: 3n }))).rejects.toThrow(/must not exceed maxAmount/);
    await expect(bot.updateTradeAction('cfg', id, action({ ...ok, maxSlippageBps: [20_000n] }))).rejects.toThrow(/maxSlippageBps must be at most/);
    expect(await bot.getTradeActions('cfg')).toEqual(before);
    // the boundary itself is allowed
    const edge = await bot.addTradeAction('cfg', action({ ...ok, minAmount: 2n, maxSlippageBps: [10_000n], maxPriceImpactBps: [10_000n] }));
    expect((await bot.getTradeActions('cfg')).find((a) => a.id === edge)).toMatchObject({ minAmount: 2n, maxAmount: 2n, maxSlippageBps: [10_000n] });
    await bot.removeTradeAction('cfg', edge);
  });

  it('keeps trades out of move-funds chores', async () => {
    await expect(bot.addMoveFundsAction('mf', action({ actionType: 0n }))).rejects.toThrow(/Trade actions not allowed/);
    const id = await bot.addMoveFundsAction('mf', action({ actionType: 3n, destinationOwner: [dave], minAmount: 1n, maxAmount: 2n }));
    expect((await bot.getMoveFundsActions('mf')).map((a) => [a.id, a.actionType])).toEqual([[id, 3n]]);
    expect(await bot.removeMoveFundsAction('mf', id)).toBe(true);
  });

  it('stores rebalance settings per instance with ICP as the default denomination', async () => {
    const s0 = await bot.getRebalanceSettings('rb');
    expect(s0.denominationToken.toText()).toBe(ICP_LEDGER_ID.toText());
    await bot.setRebalanceTargets('rb', [{ token: tokenAId, targetBps: 6_000n, paused: false }, { token: tokenBId, targetBps: 4_000n, paused: false }]);
    await bot.setRebalanceDenominationToken('rb', tokenBId);
    await bot.setRebalanceMaxTradeSize('rb', 1_000n);
    await bot.setRebalanceMinTradeSize('rb', 10n);
    await bot.setRebalanceMaxPriceImpactBps('rb', 50n);
    await bot.setRebalanceMaxSlippageBps('rb', 40n);
    await bot.setRebalanceThresholdBps('rb', 200n);
    await bot.setRebalanceFallbackRouteTokens('rb', [icpId]);
    expect(await bot.getRebalanceSettings('rb')).toEqual({ denominationToken: tokenBId, maxTradeSize: 1_000n, minTradeSize: 10n, maxPriceImpactBps: 50n, maxSlippageBps: 40n, thresholdBps: 200n, fallbackRouteTokens: [icpId] });
    expect((await bot.getRebalanceTargets('rb')).map((t) => t.targetBps)).toEqual([6_000n, 4_000n]);
    expect((await bot.getRebalanceSettings('other')).maxTradeSize).not.toBe(1_000n);
  });

  it('manages distribution lists', async () => {
    const input = { sourcePurseId: [], name: 'split', amountMode: 0n, thresholdAmount: 10n, targets: [{ basisPoints: [5_000n], choreInstanceId: [], account: account(dave) }], balancePercent: [], maxDistributionAmount: 100n, minDistributionAmount: 0n, tokenLedgerCanisterId: tokenAId };
    const id = await bot.addDistributionList('dist', input);
    await bot.updateDistributionList('dist', id, { ...input, name: 'renamed' });
    expect((await bot.getDistributionLists('dist')).map((l) => l.name)).toEqual(['renamed']);
    await bot.removeDistributionList('dist', id);
    expect(await bot.getDistributionLists('dist')).toEqual([]);
  });
});

describe('deposits, withdrawals and sends', () => {
  it('detects deposits by reconciliation and records them as capital inflow', async () => {
    await tokenA.mint(account(botId), 10_000_000n);
    await tokenB.mint(account(botId), 10_000_000n);
    await icp.mint(account(botId), 1_000_000n);
    // a withdrawal reads the ledger balance and reconciles it first
    const r = await bot.withdrawToken(tokenAId, 100_000n, account(dave));
    expect(r).toHaveProperty('Ok');
    expect(await bal(tokenA, dave)).toBe(100_000n);
    expect(await botBal(tokenA)).toBe(10_000_000n - 100_000n - FEE_A);
    // the trade log is returned newest first
    const log = (await bot.getTradeLog(tradeLogQuery({ inputToken: [tokenAId] }))).entries.sort((x, y) => (x.id < y.id ? -1 : 1));
    expect(log.map((e) => [e.actionType, e.inputAmount, Object.keys(e.status)[0]])).toEqual([[4n, 10_000_000n, 'Success'], [3n, 100_000n, 'Success']]);
    expect(log[1].destinationOwner).toEqual([dave]);
    const flows = await bot.getCapitalFlows();
    expect(flows.perToken.find(([k]) => k === tokenAId.toText())[1]).toEqual({ totalInflowNative: 10_000_000n, totalOutflowNative: 100_000n });
  });

  it('refuses withdrawals that cannot cover amount plus fee', async () => {
    const all = await botBal(tokenA);
    expect(await bot.withdrawToken(tokenAId, all, account(dave))).toEqual({ Err: { TransferFailed: 'Insufficient balance' } });
    expect(await bot.withdrawToken(tokenAId, all - FEE_A, account(dave))).toHaveProperty('Ok');
    expect(await botBal(tokenA)).toBe(0n);
    await tokenA.mint(account(botId), 10_000_000n);
  });

  it('withdraws ICP with the ICP fee', async () => {
    const before = await botBal(icp);
    const r = await bot.withdrawIcp(50_000n, account(dave, principalToSubaccount(bob)));
    expect(r).toHaveProperty('Ok');
    expect(await bal(icp, dave, principalToSubaccount(bob))).toBe(50_000n);
    expect(await botBal(icp)).toBe(before - 50_000n - ICP_FEE);
  });

  it('a stale registry fee is answered with BadFee and retried once with the fee the ledger expects', async () => {
    await tokenB.set_fee(700n);
    const b0 = await botBal(tokenB);
    const d0 = await bal(tokenB, dave);
    expect(await bot.withdrawToken(tokenBId, 1_000n, account(dave))).toHaveProperty('Ok');
    expect(await bal(tokenB, dave)).toBe(d0 + 1_000n);
    expect(await botBal(tokenB)).toBe(b0 - 1_000n - 700n);
    expect((await bot.getTradeLog(tradeLogQuery({ inputToken: [tokenBId], status: [{ Failed: null }] }))).totalCount).toBe(0n);
    // the bookkeeping used the fee actually paid: the next reconciliation finds no untracked outflow
    expect(await bot.withdrawToken(tokenBId, 1_000n, account(dave))).toHaveProperty('Ok');
    expect((await bot.getTradeLog(tradeLogQuery({ inputToken: [tokenBId], actionType: [5n] }))).totalCount).toBe(0n);
    await tokenB.set_fee(FEE_B);
    await bot.refreshTokenMetadata(tokenBId);
  });

  it('withdraws and sends a token missing from the registry, letting the ledger apply its fee', async () => {
    const tokenC = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 300n, symbol: 'CCC', decimals: 8 }], targetSubnetId: appSubnet });
    const c = actorAs(pic, ledgerIdl, tokenC, admin);
    await c.mint(account(botId), 50_000n);
    expect(await bot.withdrawToken(tokenC, 10_000n, account(dave))).toHaveProperty('Ok');
    expect(await bot.manualSend(tokenC, [], dave, [], 10_000n)).toHaveProperty('Ok');
    expect(await c.icrc1_balance_of(account(dave))).toBe(20_000n);
    expect(await c.icrc1_balance_of(account(botId))).toBe(50_000n - 2n * (10_000n + 300n));
    expect(await bot.getTokenRegistry()).not.toContainEqual(expect.objectContaining({ ledgerCanisterId: tokenC }));
  });

  it('never moves a frozen token, but a paused one can still be withdrawn', async () => {
    await bot.freezeToken(tokenAId);
    expect(await bot.withdrawToken(tokenAId, 1n, account(dave))).toEqual({ Err: { InvalidOperation: 'Token is frozen' } });
    expect(await bot.manualSend(tokenAId, [], dave, [], 1n)).toEqual({ Err: { InvalidOperation: 'Token is frozen' } });
    await bot.unfreezeToken(tokenAId);
    await bot.pauseToken(tokenAId);
    expect(await bot.withdrawToken(tokenAId, 1_000n, account(dave))).toHaveProperty('Ok');
    await bot.unpauseToken(tokenAId);
  });

  it('only a WithdrawFunds hotkey can move funds out', async () => {
    await bot.addHotkeyPermissions(hot, [P('ExecuteOneOffTrade'), P('ViewPortfolio')]);
    const botHot = actorAs(pic, botIdl, botId, hot);
    await expect(botHot.withdrawToken(tokenAId, 1_000n, account(hot))).rejects.toThrow();
    await bot.addHotkeyPermissions(hot, [P('WithdrawFunds')]);
    expect(await botHot.withdrawToken(tokenAId, 1_000n, account(hot))).toHaveProperty('Ok');
    expect(await bal(tokenA, hot)).toBe(1_000n);
    await bot.removeHotkeyPermissions(hot, [P('WithdrawFunds')]);
  });
});

describe('chore purses', () => {
  it('needs an enabled purse and enough main-purse balance to fund it', async () => {
    expect(await bot.isPurseEnabled('t1')).toBe(false);
    expect(await bot.fundPurse('t1', tokenAId, 1n)).toEqual({ Err: 'Purse is not enabled for this chore.' });
    await bot.enablePurse('t1');
    expect(await bot.isPurseEnabled('t1')).toBe(true);
    expect(await bot.fundPurse('t1', tokenAId, 0n)).toEqual({ Err: 'Amount must be > 0.' });
    const onChain = await botBal(tokenA);
    expect((await bot.fundPurse('t1', tokenAId, onChain + 1n)).Err).toMatch(/Insufficient main purse balance/);
    expect(await bot.fundPurse('t1', tokenAId, 1_000_000n)).toEqual({ Ok: null });
  });

  it('keeps on-chain = main purse + chore purses', async () => {
    const onChain = await botBal(tokenA);
    expect(await bot.getPurseBalance('t1', tokenAId)).toBe(1_000_000n);
    expect(await bot.getMainPurseBalance(tokenAId)).toEqual({ token: tokenAId, balance: onChain - 1_000_000n, overcommitted: false });
    expect(await bot.getPurseBalances('t1')).toEqual([{ token: tokenAId, balance: 1_000_000n }]);
    expect(await bot.getAllPurseAllocations()).toEqual([{ instanceId: 't1', enabled: true, balances: [{ token: tokenAId, balance: 1_000_000n }] }]);
    const mains = await bot.getMainPurseBalances();
    expect(mains.find((m) => m.token.toText() === tokenAId.toText()).balance).toBe(onChain - 1_000_000n);
  });

  it('sends from a purse and debits amount plus fee', async () => {
    const r = await bot.manualSend(tokenAId, ['t1'], dave, [], 100_000n);
    expect(r).toHaveProperty('Ok');
    expect(await bot.getPurseBalance('t1', tokenAId)).toBe(1_000_000n - 100_000n - FEE_A);
    expect((await bot.manualSend(tokenAId, ['t1'], dave, [], 1_000_000n)).Err).toEqual({ TransferFailed: 'Insufficient balance' });
  });

  it('a main-purse send cannot dip into allocated purse funds', async () => {
    const main = (await bot.getMainPurseBalance(tokenAId)).balance;
    expect(await bot.manualSend(tokenAId, [], dave, [], main)).toEqual({ Err: { TransferFailed: 'Insufficient balance' } });
  });

  it('reclaims, shares purses and only disables empty, unreferenced ones', async () => {
    const left = await bot.getPurseBalance('t1', tokenAId);
    expect((await bot.reclaimFromPurse('t1', tokenAId, left + 1n)).Err).toMatch(/Insufficient purse balance/);
    expect(await bot.setTradingPurseId('t1', ['t1'])).toHaveProperty('Err');
    expect((await bot.setTradingPurseId('t2', ['nope'])).Err).toMatch(/not enabled/);
    expect(await bot.setTradingPurseId('t2', ['t1'])).toEqual({ Ok: null });
    expect(await bot.getTradingPurseId('t2')).toEqual(['t1']);
    expect(await bot.getResolvedPurseId('t2')).toEqual(['t1']);
    expect((await bot.disablePurse('t1')).Err).toMatch(/referenced by chore t2/);
    await bot.setTradingPurseId('t2', []);
    expect((await bot.disablePurse('t1')).Err).toMatch(/non-zero balances/);
    expect(await bot.reclaimFromPurse('t1', tokenAId, left)).toEqual({ Ok: null });
    expect(await bot.disablePurse('t1')).toEqual({ Ok: null });
    expect(await bot.getResolvedPurseId('t1')).toEqual([]);
  });
});

describe('one-off trades', () => {
  it('validates the input at submission', async () => {
    const err = async (over) => (await bot.submitOneOffTrade(oneOff(over))).Err;
    expect(await err({ inputAmount: 0n })).toBe('Input amount must be > 0');
    expect(await err({ outputToken: tokenAId })).toBe('Input and output tokens must be different');
    expect(await err({ inputToken: dave })).toBe('Input token not in registry');
    expect(await err({ outputToken: dave })).toBe('Output token not in registry');
    expect(await err({ preferredDex: [7n] })).toBe('Unknown DEX ID: 7');
    expect(await err({ sourcePurseId: ['ghost'] })).toMatch(/does not exist or is not enabled/);
    await bot.pauseToken(tokenBId);
    expect(await err({})).toBe('Output token is paused or frozen');
    await bot.unpauseToken(tokenBId);
    await bot.freezeToken(tokenAId);
    expect(await err({})).toBe('Input token is paused or frozen');
    await bot.unfreezeToken(tokenAId);
    expect(await bot.getOneOffTradeQueue()).toEqual([]);
  });

  it('swaps AAA -> BBB on ICPSwap through the ICRC-1 path, spending exactly the input', async () => {
    await kong.clear_rates(); // ICPSwap is the only market
    const a0 = await botBal(tokenA); const b0 = await botBal(tokenB);
    const amount = 100_000n;
    const { Ok: id } = await bot.submitOneOffTrade(oneOff({ inputAmount: amount }));
    expect((await bot.getOneOffTradeQueue())[0]).toMatchObject({ id, status: 0n, submittedBy: admin });
    const e = await settleOneOff(bot, id);
    const effective = amount - 2n * FEE_A; // transfer + deposit fees
    const gross = poolQuote(effective, true);
    expect(e).toMatchObject({ status: 2n, outputAmount: [gross], dexUsed: [0n], errorMessage: [] });
    expect(await botBal(tokenA)).toBe(a0 - amount);
    expect(await botBal(tokenB)).toBe(b0 + gross - FEE_B);
    const swaps = await pool.get_swaps();
    expect(swaps.at(-1)).toMatchObject({ caller: botId, amountIn: effective, amountOut: gross, path: 'icrc1' });
    // trade log entry, before/after portfolio snapshots, no spurious reconciliation entries
    const [entry] = (await bot.getTradeLog(tradeLogQuery({ choreTypeId: ['one-off'] }))).entries;
    expect(entry).toMatchObject({ actionType: 0n, inputAmount: amount, outputAmount: [gross], dexId: [0n], status: { Success: null }, actionId: [id] });
    expect(e.tradeLogId).toEqual([entry.id]);
    const after = await bot.getTradeLog(tradeLogQuery({ startId: [entry.id], actionType: [5n] }));
    expect(after.totalCount).toBe(0n);
    const snaps = await bot.getPortfolioSnapshots({ startId: [], limit: [50n], tradeLogId: [entry.id], phase: [], fromTime: [], toTime: [], offset: [], newestFirst: [] });
    expect(snaps.entries.map((s) => Object.keys(s.phase)[0])).toEqual(['After']);
    expect(snaps.entries[0].tokens.map((t) => t.balance)).toEqual([a0 - amount, b0 + gross - FEE_B]);
  });

  it('swaps BBB -> AAA on ICPSwap through the ICRC-2 path (approve + depositFromAndSwap)', async () => {
    const a0 = await botBal(tokenA); const b0 = await botBal(tokenB);
    const amount = 200_000n;
    const { Ok: id } = await bot.submitOneOffTrade(oneOff({ inputToken: tokenBId, outputToken: tokenAId, inputAmount: amount, preferredDex: [0n] }));
    const e = await settleOneOff(bot, id);
    const effective = amount - 2n * FEE_B; // approve fee + transfer_from fee
    const gross = poolQuote(effective, false);
    expect(e).toMatchObject({ status: 2n, outputAmount: [gross], dexUsed: [0n] });
    expect((await pool.get_swaps()).at(-1)).toMatchObject({ amountIn: effective, path: 'icrc2' });
    expect(await botBal(tokenB)).toBe(b0 - amount);
    expect(await botBal(tokenA)).toBe(a0 + gross - FEE_A);
  });

  it('routes to KongSwap when it quotes more, with one input fee', async () => {
    const better = aIsToken0 ? [3n, 1n] : [1n, 1n]; // beat ICPSwap's AAA->BBB rate either way
    await kong.set_rate(tokenAId, tokenBId, ...better);
    const a0 = await botBal(tokenA); const b0 = await botBal(tokenB);
    const amount = 50_000n;
    const { Ok: id } = await bot.submitOneOffTrade(oneOff({ inputAmount: amount }));
    const e = await settleOneOff(bot, id);
    const effective = amount - FEE_A;
    const receive = effective * better[0] / better[1];
    expect(e).toMatchObject({ status: 2n, dexUsed: [1n], outputAmount: [receive] });
    const ks = (await kong.get_swaps()).at(-1);
    expect(ks).toMatchObject({ pay_amount: effective, receive_amount: receive });
    expect(ks.pay_tx_id).toHaveLength(1); // the ICRC-1 block index of the bot's transfer to Kong
    expect(await botBal(tokenA)).toBe(a0 - amount);
    expect(await botBal(tokenB)).toBe(b0 + receive);
  });

  it('skips a quote whose price impact exceeds the limit', async () => {
    await kong.set_slippage(5.0); // 500 bps reported impact, default limit 300
    const { Ok: id } = await bot.submitOneOffTrade(oneOff({ inputAmount: 50_000n, preferredDex: [1n] }));
    const e = await settleOneOff(bot, id);
    expect(e.status).toBe(3n);
    expect(e.errorMessage[0]).toBe('Price impact 500 bps exceeds max 300 bps');
    // with no preference, the high-impact Kong quote is filtered out and ICPSwap is used
    const { Ok: id2 } = await bot.submitOneOffTrade(oneOff({ inputAmount: 50_000n }));
    expect(await settleOneOff(bot, id2)).toMatchObject({ status: 2n, dexUsed: [0n] });
    await kong.clear_rates();
    await kong.set_slippage(0);
  });

  it('refuses when the best quote is below minOutputAmount, moving nothing', async () => {
    const a0 = await botBal(tokenA);
    const { Ok: id } = await bot.submitOneOffTrade(oneOff({ inputAmount: 10_000n, minOutputAmount: [10_000_000n] }));
    const e = await settleOneOff(bot, id);
    expect(e.status).toBe(3n);
    expect(e.errorMessage[0]).toMatch(/^Expected output \d+ < min output 10000000$/);
    expect(await botBal(tokenA)).toBe(a0);
  });

  it('fails when the main purse cannot cover the input', async () => {
    const { Ok: id } = await bot.submitOneOffTrade(oneOff({ inputAmount: 10n ** 12n }));
    const e = await settleOneOff(bot, id);
    expect(e.errorMessage[0]).toMatch(/^Insufficient main purse balance/);
  });

  it('a slippage-protected swap that the pool refuses leaves funds in the pool, and recoverPoolFunds returns them', async () => {
    await pool.set_swap_bps(9_000n); // execution pays 10 % less than quoted, tolerance is 1 %
    const a0 = await botBal(tokenA);
    const amount = 100_000n;
    const { Ok: id } = await bot.submitOneOffTrade(oneOff({ inputAmount: amount, maxSlippageBps: [100n] }));
    const e = await settleOneOff(bot, id);
    expect(e.status).toBe(3n);
    expect(e.errorMessage[0]).toMatch(/ICPSwap swap failed: InternalError: slippage/);
    expect(await botBal(tokenA)).toBe(a0 - amount);
    const unused = (await pool.getUserUnusedBalance(botId)).ok;
    const effective = amount - 2n * FEE_A;
    expect(aIsToken0 ? unused.balance0 : unused.balance1).toBe(effective);
    await pool.set_swap_bps(10_000n);
    await expect(botAlice.recoverPoolFunds(tokenAId, tokenBId)).rejects.toThrow();
    const r = await bot.recoverPoolFunds(tokenAId, tokenBId);
    const recovered = effective - FEE_A;
    expect(r).toEqual({ Ok: aIsToken0 ? { recovered0: recovered, recovered1: 0n } : { recovered0: 0n, recovered1: recovered } });
    expect(await botBal(tokenA)).toBe(a0 - amount + recovered);
    expect(await bot.recoverPoolFunds(tokenAId, tokenBId)).toEqual({ Err: 'No recoverable funds found in this pool' });
  });

  it('trades from a chore purse with purse bookkeeping', async () => {
    await bot.enablePurse('p1');
    expect(await bot.fundPurse('p1', tokenAId, 500_000n)).toEqual({ Ok: null });
    const amount = 100_000n;
    const { Ok: id } = await bot.submitOneOffTrade(oneOff({ inputAmount: amount, sourcePurseId: ['p1'] }));
    const e = await settleOneOff(bot, id);
    expect(e.status).toBe(2n);
    const gross = e.outputAmount[0];
    expect(await bot.getPurseBalance('p1', tokenAId)).toBe(500_000n - amount);
    expect(await bot.getPurseBalance('p1', tokenBId)).toBe(gross - FEE_B);
    const { Ok: big } = await bot.submitOneOffTrade(oneOff({ inputAmount: 500_000n, sourcePurseId: ['p1'] }));
    expect((await settleOneOff(bot, big)).errorMessage[0]).toMatch(/^Insufficient purse 'p1' balance/);
  });

  it('cancels pending trades only, and clears finished history', async () => {
    const { Ok: id } = await bot.submitOneOffTrade(oneOff({ inputAmount: 10_000n }));
    expect(await bot.cancelOneOffTrade(id)).toEqual({ Ok: null });
    expect(await bot.cancelOneOffTrade(id)).toEqual({ Err: `Trade ${id} is not pending (cannot cancel)` });
    expect(await bot.cancelOneOffTrade(999n)).toEqual({ Err: 'Trade 999 not found' });
    await pic.advanceTime(3_000); await pic.tick(5);
    expect((await bot.getOneOffTradeQueue()).find((x) => x.id === id).status).toBe(4n);
    await bot.clearOneOffTradeHistory();
    expect(await bot.getOneOffTradeQueue()).toEqual([]);
  });

  it('a hotkey with ExecuteOneOffTrade trades but cannot withdraw', async () => {
    const botHot = actorAs(pic, botIdl, botId, hot);
    const { Ok: id } = await botHot.submitOneOffTrade(oneOff({ inputAmount: 20_000n }));
    expect((await settleOneOff(botHot, id)).status).toBe(2n);
    expect((await botHot.getOneOffTradeQueue())[0].submittedBy.toText()).toBe(hot.toText());
    await expect(botHot.withdrawToken(tokenBId, 1n, account(hot))).rejects.toThrow();
  });
});

describe('circuit breaker', () => {
  it('stores, updates, toggles and removes rules', async () => {
    const id = await bot.addCircuitBreakerRule({ name: 'r', enabled: false, topLevelOperator: 0n, conditions: [], actions: [] });
    await bot.updateCircuitBreakerRule(id, { name: 'renamed', enabled: false, topLevelOperator: 1n, conditions: [], actions: [] });
    await bot.enableCircuitBreakerRule(id, true);
    expect((await bot.getCircuitBreakerRules()).map((r) => [r.id, r.name, r.enabled, r.topLevelOperator])).toEqual([[id, 'renamed', true, 1n]]);
    await bot.removeCircuitBreakerRule(id);
    expect(await bot.getCircuitBreakerRules()).toEqual([]);
  });

  it('freezes a token when a balance rule fires before a one-off trade, failing the trade', async () => {
    const id = await bot.addCircuitBreakerRule({
      name: 'AAA whale', enabled: true, topLevelOperator: 0n,
      conditions: [cond({ balanceToken: [tokenAId], operator: 0n, threshold: [1_000n] })],
      actions: [{ actionType: 2n, token: [tokenAId], choreInstanceId: [], choreTypeId: [] }],
    });
    const a0 = await botBal(tokenA);
    const { Ok: tid } = await bot.submitOneOffTrade(oneOff({ inputAmount: 10_000n }));
    const e = await settleOneOff(bot, tid);
    expect(e.status).toBe(3n);
    expect(e.errorMessage[0]).toMatch(/paused\/frozen \(may have been triggered by circuit breaker\)/);
    expect(await bot.getFrozenTokens()).toEqual([tokenAId]);
    expect(await botBal(tokenA)).toBe(a0);
    const cbLog = await bot.getCircuitBreakerLog({ startId: [], limit: [], ruleId: [id], fromTime: [], toTime: [] });
    expect(cbLog.entries.map((x) => [x.ruleName, x.actionsTaken])).toEqual([['AAA whale', [`Frozen token globally: ${tokenAId.toText()}`]]]);
    // the frozen token cannot leave the bot either
    expect(await bot.withdrawToken(tokenAId, 1n, account(dave))).toEqual({ Err: { InvalidOperation: 'Token is frozen' } });
    // switching the breaker off globally stops evaluation
    await bot.setCircuitBreakerEnabled(false);
    await bot.unfreezeToken(tokenAId);
    const { Ok: tid2 } = await bot.submitOneOffTrade(oneOff({ inputAmount: 10_000n }));
    expect((await settleOneOff(bot, tid2)).status).toBe(2n);
    expect(await bot.getFrozenTokens()).toEqual([]);
    await bot.setCircuitBreakerEnabled(true);
    await bot.removeCircuitBreakerRule(id);
    await bot.clearCircuitBreakerLog();
    expect((await bot.getCircuitBreakerLog({ startId: [], limit: [], ruleId: [], fromTime: [], toTime: [] })).totalCount).toBe(0n);
  });
});

describe('chores on timers', () => {
  let tcAction;
  it('creates instances only of known types and needs the type permission', async () => {
    expect(await bot.createChoreInstance('trade', 'tc', 'Trade AAA')).toBe(true);
    expect(await bot.createChoreInstance('trade', 'tc', 'again')).toBe(false);
    await expect(bot.createChoreInstance('bogus', 'b', 'b')).rejects.toThrow(/Unknown chore type/);
    expect(await bot.renameChoreInstance('tc', 'Trade AAA->BBB')).toBe(true);
    expect(await bot.listChoreInstances([ 'trade' ])).toEqual([['tc', { typeId: 'trade', instanceLabel: 'Trade AAA->BBB' }]]);
    const s = await bot.getChoreStatus('tc');
    expect(s[0]).toMatchObject({ choreTypeId: 'trade', enabled: false, intervalSeconds: 300n, maxIntervalSeconds: [600n], taskTimeoutSeconds: 300n });
    // a ManageTradeChore hotkey cannot touch other chore types
    await bot.addHotkeyPermissions(dave, [P('ManageTradeChore')]);
    const botDave = actorAs(pic, botIdl, botId, dave);
    await botDave.setChoreInterval('tc', 120n);
    await expect(botDave.createChoreInstance('rebalance', 'rx', 'x')).rejects.toThrow();
    await expect(botDave.stopAllChores()).rejects.toThrow(); // needs FullPermissions
    expect((await bot.getChoreConfigs()).find(([k]) => k === 'tc')[1].intervalSeconds).toBe(120n);
  });

  it('runs a trade chore: metadata, prices, snapshot, swap, then halts at maxExecutions', async () => {
    const amount = 30_000n;
    tcAction = await bot.addTradeAction('tc', action({ key: 'a2b', outputToken: [tokenBId], minAmount: amount, maxAmount: amount, maxExecutions: [1n] }));
    const a0 = await botBal(tokenA); const b0 = await botBal(tokenB);
    await bot.startChore('tc');
    expect((await bot.getChoreStatus('tc'))[0].enabled).toBe(true);
    let entries = [];
    for (let i = 0; i < 40 && entries.length === 0; i++) {
      await pic.advanceTime(5_000); await pic.tick(6);
      entries = (await bot.getTradeLog(tradeLogQuery({ choreId: ['tc'], actionType: [0n] }))).entries;
    }
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ choreTypeId: ['trade'], actionId: [tcAction], inputAmount: amount, status: { Success: null }, dexId: [0n] });
    const gross = poolQuote(amount - 2n * FEE_A, true);
    expect(await botBal(tokenA)).toBe(a0 - amount);
    expect(await botBal(tokenB)).toBe(b0 + gross - FEE_B);
    for (let i = 0; i < 10; i++) { await pic.advanceTime(5_000); await pic.tick(4); }
    const [act] = await bot.getTradeActions('tc');
    expect(act).toMatchObject({ executionCount: 1n, cumulativeInputSpent: amount });
    const st = (await bot.getChoreStatus('tc'))[0];
    expect(st.enabled).toBe(false); // maxExecutions reached: the chore stopped itself
    // a later run does nothing more
    await bot.triggerChore('tc');
    for (let i = 0; i < 10; i++) { await pic.advanceTime(5_000); await pic.tick(4); }
    expect((await bot.getTradeLog(tradeLogQuery({ choreId: ['tc'], actionType: [0n], status: [{ Success: null }] }))).totalCount).toBe(1n);
    expect(await botBal(tokenA)).toBe(a0 - amount);
  });

  it('skips a trade whose token is paused', async () => {
    expect(await bot.resetActionStats('tc', tcAction)).toBe(true);
    await bot.pauseToken(tokenBId);
    const skips = async () => (await bot.getTradeLog(tradeLogQuery({ choreId: ['tc'], status: [{ Skipped: null }] }))).entries;
    const before = (await skips()).length; // the post-limit run above logged an 'Execution limit reached' skip
    const a0 = await botBal(tokenA);
    await bot.startChore('tc');
    for (let i = 0; i < 30 && (await skips()).length === before; i++) { await pic.advanceTime(5_000); await pic.tick(6); }
    const [e] = await skips(); // newest first
    expect(e.errorMessage).toEqual(['Output token is paused/frozen']);
    expect(await botBal(tokenA)).toBe(a0);
    await bot.stopChore('tc');
    await bot.unpauseToken(tokenBId);
    expect((await bot.getChoreStatus('tc'))[0].enabled).toBe(false);
  });

  it('pauses, resumes and stops; stopAllChores is the emergency stop', async () => {
    await bot.startChore('tc');
    await bot.pauseChore('tc');
    expect((await bot.getChoreStatus('tc'))[0]).toMatchObject({ enabled: true, paused: true });
    await bot.resumeChore('tc');
    expect((await bot.getChoreStatus('tc'))[0]).toMatchObject({ enabled: true, paused: false });
    await bot.stopAllChores();
    expect((await bot.getChoreStatuses()).every((s) => !s.enabled)).toBe(true);
    expect(await bot.deleteChoreInstance('tc')).toBe(true);
    expect(await bot.listChoreInstances([])).toEqual([]);
  });
});

describe('logs and stats', () => {
  it('logs API actions with the caller, filters by level, and summarises alerts', async () => {
    const r = await bot.getLogs(logFilter({ caller: [admin], source: ['api'] }));
    expect(r.totalMatching).toBeGreaterThan(10n);
    expect(r.entries.some((e) => e.message.startsWith('Added token: AAA'))).toBe(true);
    const errors = await bot.getLogs(logFilter({ minLevel: [P('Error')] }));
    expect(errors.entries.every((e) => 'Error' in e.level)).toBe(true);
    expect(errors.entries.some((e) => /One-off trade failed/.test(e.message))).toBe(true);
    const sum = await bot.getLogAlertSummary(0n);
    expect(sum.unseenErrorCount).toBeGreaterThan(0n);
    await bot.setLogLevel(P('Error'));
    expect((await bot.getLogConfig()).logLevel).toEqual(P('Error'));
    await bot.setLogLevel(P('Info'));
    await bot.addHotkeyPermissions(bob, [P('ViewLogs')]);
    expect((await botBob.getLogs(logFilter({ limit: [1n] }))).entries).toHaveLength(1);
  });

  it('turns the trade log off and on, and adjusts deployed capital manually', async () => {
    const before = await bot.getTradeLogStats();
    const flows0 = await bot.getCapitalFlows();
    await bot.setLoggingSettings({ tradeLogEnabled: false, portfolioLogEnabled: true, maxTradeLogEntries: 10_000n, maxPortfolioLogEntries: 5_000n });
    expect(await bot.withdrawToken(tokenBId, 1_000n, account(dave))).toHaveProperty('Ok');
    expect((await bot.getTradeLogStats()).totalEntries).toBe(before.totalEntries);
    await bot.setLoggingSettings({ tradeLogEnabled: true, portfolioLogEnabled: true, maxTradeLogEntries: 10_000n, maxPortfolioLogEntries: 5_000n });
    await bot.adjustCapitalDeployed(5n, -7n);
    const flows1 = await bot.getCapitalFlows();
    expect(flows1.capitalDeployedIcpE8s - flows0.capitalDeployedIcpE8s).toBe(5n);
    expect(flows1.capitalDeployedUsdE8s - flows0.capitalDeployedUsdE8s).toBe(-7n);
  });
});

describe('upgrade', () => {
  it('keeps configuration, permissions, purses, logs and balances', async () => {
    await bot.enablePurse('keep');
    await bot.fundPurse('keep', tokenBId, 12_345n);
    await bot.setEnabledDexes([0n]);
    await bot.pauseToken(icpId);
    await bot.addTradeAction('kept', action({ key: 'k', outputToken: [tokenBId], minAmount: 1n, maxAmount: 2n }));
    await bot.createChoreInstance('snapshot', 'snap', 'Snapshots');
    const snapshot = async () => ({
      registry: await bot.getTokenRegistry(), hotkeys: await bot.getBotkeySnapshot(), dexes: await bot.getEnabledDexes(),
      paused: await bot.getPausedTokens(), purses: await bot.getAllPurseAllocations(), actions: await bot.getTradeActions('kept'),
      rebalance: await bot.getRebalanceSettings('rb'), instances: await bot.listChoreInstances([]), tradeLog: await bot.getTradeLogStats(),
      flows: await bot.getCapitalFlows(), queue: await bot.getOneOffTradeQueue(), version: await bot.getVersion(),
    });
    const before = await snapshot();
    const a0 = await botBal(tokenA);
    await pic.upgradeCanister({ sender: admin, canisterId: botId, wasm: wasm('sneed_trading_bot') });
    await pic.tick(2);
    expect(await snapshot()).toEqual(before);
    expect(await botBal(tokenA)).toBe(a0);
    // and it still trades after the upgrade
    await bot.unpauseToken(icpId);
    const { Ok: id } = await bot.submitOneOffTrade(oneOff({ inputAmount: 10_000n }));
    expect((await settleOneOff(bot, id)).status).toBe(2n);
  });
});

describe('slippage and price impact are bounded at 10 000 bps', () => {
  // A second, fresh bot so these settings do not affect the tests above.
  it('refuses settings above 100 % at every entry point, and the one-off queue keeps working', async () => {
    const id2 = await installBot();
    const b2 = actorAs(pic, botIdl, id2, admin);
    await b2.addToken(regEntry(tokenAId, 'AAA', FEE_A));
    await b2.addToken(regEntry(tokenBId, 'BBB', FEE_B));
    await tokenA.mint(account(id2), 1_000_000n);
    // a one-off trade with maxSlippageBps > 10000 used to underflow and trap after the entry was marked
    // Processing, leaving it stuck and the queue wedged; now it is refused at submission
    expect(await b2.submitOneOffTrade(oneOff({ inputAmount: 100_000n, maxSlippageBps: [20_000n] }))).toEqual({ Err: 'Max slippage must be at most 10000 bps' });
    expect(await b2.submitOneOffTrade(oneOff({ inputAmount: 100_000n, maxPriceImpactBps: [10_001n] }))).toEqual({ Err: 'Max price impact must be at most 10000 bps' });
    await expect(b2.setDefaultSlippage(20_000n)).rejects.toThrow(/Slippage must be at most 10000 bps/);
    await expect(b2.setDefaultMaxPriceImpact(10_001n)).rejects.toThrow(/Max price impact must be at most 10000 bps/);
    await expect(b2.setRebalanceMaxSlippageBps('rb', 10_001n)).rejects.toThrow(/at most 10000 bps/);
    await expect(b2.setRebalanceMaxPriceImpactBps('rb', 10_001n)).rejects.toThrow(/at most 10000 bps/);
    expect(await b2.getOneOffTradeQueue()).toEqual([]);
    // 100 % itself is allowed and trades (minimum output 0)
    await b2.setDefaultSlippage(10_000n);
    const { Ok: edge } = await b2.submitOneOffTrade(oneOff({ inputAmount: 100_000n, preferredDex: [0n] }));
    expect((await settleOneOff(b2, edge)).status).toBe(2n);
    const { Ok: next } = await b2.submitOneOffTrade(oneOff({ inputAmount: 10_000n, maxSlippageBps: [10_000n], preferredDex: [0n] }));
    expect((await settleOneOff(b2, next)).status).toBe(2n);
    expect((await b2.getOneOffTradeQueue()).every((x) => x.status === 2n)).toBe(true);
  });
});

// Fixed 2026-10-20 (sneed_trading_bot 0.9.4): a distribution transfer the ledger refused was still
// booked as paid (purse debited, DistributionExecuted emitted); assigned shares above 100 % were
// not scaled down (with purse targets the over-debit trapped and left the purse locked); and a
// list whose amount could not cover the fees returned without releasing the purse lock, so the
// next list on the same purse was skipped until the 5-minute lock timeout.
describe('distribution lists on timers', () => {
  const FEE_F = 1_000n;
  let b3, fId, fTok, b3Id;
  const faultyIdl = ({ IDL }) => {
    const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
    return IDL.Service({
      mint: IDL.Func([Account, IDL.Nat], [IDL.Nat], []),
      icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ['query']),
      set_fail_to: IDL.Func([IDL.Vec(IDL.Principal)], [], []),
    });
  };
  const list = (over) => ({
    name: 'l', tokenLedgerCanisterId: fId, thresholdAmount: 0n, amountMode: 0n, balancePercent: [], sourcePurseId: ['df'],
    minDistributionAmount: 100_000n, maxDistributionAmount: 100_000n, targets: [], ...over,
  });
  const ext = (owner, bps) => ({ account: account(owner), basisPoints: bps === undefined ? [] : [bps], choreInstanceId: [] });
  const toPurse = (id, bps) => ({ account: account(botId), basisPoints: [bps], choreInstanceId: [id] });
  const events = async (type) => (await b3.getEventLog({ eventTypeId: [type], fromTime: [], toTime: [], startId: [], limit: [] })).entries;
  async function runDf() {
    const before = (await b3.getChoreStatus('df'))[0].totalRunCount;
    await b3.triggerChore('df');
    for (let i = 0; i < 60; i++) {
      await pic.advanceTime(5_000); await pic.tick(4);
      const s = (await b3.getChoreStatus('df'))[0];
      if (s.totalRunCount > before && 'Idle' in s.conductorStatus) return s;
    }
    throw new Error('distribute-funds run did not finish');
  }
  async function clearLists() {
    for (const l of await b3.getDistributionLists('df')) await b3.removeDistributionList('df', l.id);
  }

  beforeAll(async () => {
    fId = await install(pic, { name: 'MockLedgerFaulty', initTypes: ledgerInit, initArgs: [{ fee: FEE_F, symbol: 'FFF', decimals: 8 }], targetSubnetId: appSubnet });
    fTok = actorAs(pic, faultyIdl, fId, admin);
    b3Id = await installBot();
    b3 = actorAs(pic, botIdl, b3Id, admin);
    await b3.addToken(regEntry(fId, 'FFF', FEE_F));
    await fTok.mint(account(b3Id), 10_000_000n);
    expect(await b3.createChoreInstance('distribute-funds', 'df', 'Distribute')).toBe(true);
    for (const p of ['df', 'p1', 'p2']) await b3.enablePurse(p);
    expect(await b3.fundPurse('df', fId, 5_000_000n)).toEqual({ Ok: null });
  });

  it('books only the transfers the ledger accepted, and reports the failure', async () => {
    await b3.addDistributionList('df', list({ targets: [ext(alice, 5_000n), ext(carol, 5_000n)] }));
    await fTok.set_fail_to([carol]);
    const [purse, a0, c0] = [await b3.getPurseBalance('df', fId), await fTok.icrc1_balance_of(account(alice)), await fTok.icrc1_balance_of(account(carol))];
    await runDf();
    await fTok.set_fail_to([]);
    const share = (100_000n - 2n * FEE_F) / 2n;
    expect(await fTok.icrc1_balance_of(account(alice))).toBe(a0 + share);
    expect(await fTok.icrc1_balance_of(account(carol))).toBe(c0); // refused by the ledger
    // only the accepted transfer (amount + fee) leaves the purse
    expect(await b3.getPurseBalance('df', fId)).toBe(purse - share - FEE_F);
    expect(await fTok.icrc1_balance_of(account(b3Id))).toBe(10_000_000n - share - FEE_F);
    expect(await events(10n)).toHaveLength(0); // no DistributionExecuted
    const [failed] = await events(11n);
    expect(failed.data).toContainEqual(['failed', '1']);
    expect(failed.data).toContainEqual(['externalAmount', `${share}`]);
    const logs = (await b3.getLogs({ minLevel: [], source: ['chore:df'], caller: [], fromTime: [], toTime: [], startId: [], limit: [1000n], beforeId: [] })).entries.map((e) => e.message);
    expect(logs.some((m) => /transfer of \d+ FFF to .* failed/.test(m))).toBe(true);
    await clearLists();
  });

  it('releases the purse lock when a list cannot cover its fees, so the next list on the purse runs', async () => {
    // list 1 cannot cover its transfer fee: it returns early (and used to keep the 'df' purse locked)
    await b3.addDistributionList('df', list({ name: 'tiny', minDistributionAmount: 500n, maxDistributionAmount: 500n, targets: [ext(alice, 10_000n)] }));
    await b3.addDistributionList('df', list({ name: 'next', targets: [ext(alice, 10_000n)] }));
    const a0 = await fTok.icrc1_balance_of(account(alice));
    await runDf();
    expect(await fTok.icrc1_balance_of(account(alice))).toBe(a0 + 100_000n - FEE_F);
    await clearLists();
  });

  it('scales assigned shares above 100 % down instead of over-debiting the source purse', async () => {
    // two purse targets at 80 % each (160 % in total)
    await b3.addDistributionList('df', list({ name: 'over', targets: [toPurse('p1', 8_000n), toPurse('p2', 8_000n)] }));
    const purse = await b3.getPurseBalance('df', fId);
    const onChain = await fTok.icrc1_balance_of(account(b3Id));
    await runDf();
    // each gets 8000/16000 of the 100 000; nothing more than that leaves the source purse
    expect(await b3.getPurseBalance('p1', fId)).toBe(50_000n);
    expect(await b3.getPurseBalance('p2', fId)).toBe(50_000n);
    expect(await b3.getPurseBalance('df', fId)).toBe(purse - 100_000n);
    expect(await fTok.icrc1_balance_of(account(b3Id))).toBe(onChain); // bookkeeping only
    expect((await events(10n)).some((e) => e.data.some(([k, v]) => k === 'list' && v === 'over'))).toBe(true);
    await clearLists();
  });

  it('refuses basis-point fields above 100 % when a list is written', async () => {
    await expect(b3.addDistributionList('df', list({ targets: [ext(alice, 10_001n)] }))).rejects.toThrow(/at most 10000 bps/);
    await expect(b3.addDistributionList('df', list({ amountMode: 1n, balancePercent: [20_000n], targets: [ext(alice)] }))).rejects.toThrow(/at most 10000 bps/);
    const id = await b3.addDistributionList('df', list({ targets: [ext(alice, 6_000n), ext(bob, 6_000n)] })); // over 100 % in total is allowed
    await expect(b3.updateDistributionList('df', id, list({ targets: [ext(alice, 10_001n)] }))).rejects.toThrow(/at most 10000 bps/);
    await clearLists();
  });
});
