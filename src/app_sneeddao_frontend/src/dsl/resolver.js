// SneedScript DSL Resolver — Maps parsed AST statements to canister operations.
// Takes the current bot state + parsed AST and produces an ordered list of operations.

import { Principal } from '@dfinity/principal';

const ACTION_TYPE_IDS = { trade: 0, fund_purse: 1, reclaim: 2, send: 3 };
const DEX_IDS = { ICPSwap: 0, KongSwap: 1, auto: null };
const AMOUNT_MODE_IDS = { range: 0, percent: 1 };
const TRAILING_STOP_DIR_IDS = { stop_loss: 0, take_profit: 1 };
const TRAILING_STOP_RESET_IDS = { on_exec: 0, never: 1 };
const EVENT_CONDITION_OP_IDS = { equals: 0, not_equals: 1, contains: 2, greater_than: 3, less_than: 4 };
const CB_CONDITION_TYPE = { price: 0, value: 1, balance: 2, and_group: 3, or_group: 4 };
const CB_ACTION_TYPE = {
  stop_chore: 3, pause_chore: 4, start_chore: 9,
  stop_all_chores: 7, pause_all_chores: 8, start_all_chores: 11,
  stop_all_chores_by_type: 5, pause_all_chores_by_type: 6, start_all_chores_by_type: 10,
  pause_token_in_rebal: 0, pause_token: 1, freeze_token: 2,
};

function principalToText(p) {
  if (!p) return null;
  return typeof p === 'string' ? p : (p.toText ? p.toText() : String(p));
}

function toPrincipal(text) {
  return Principal.fromText(text);
}

function optToArray(val) {
  if (val === null || val === undefined) return [];
  return [val];
}

function optFromArray(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[0];
}

// ============================================
// TOKEN RESOLUTION
// ============================================

function resolveToken(ref, tokenLookup, context = '') {
  if (!ref) throw new ResolverError(`Missing token reference${context ? ' for ' + context : ''}`);

  // If it looks like a principal (contains dashes and is long enough)
  if (typeof ref === 'string' && ref.includes('-') && ref.length > 10) {
    try {
      toPrincipal(ref); // validate
      return ref;
    } catch (e) { /* fall through to symbol lookup */ }
  }

  // Symbol lookup
  const symbol = typeof ref === 'object' && ref.value ? ref.value : ref;
  const matches = [];
  for (const [pid, info] of Object.entries(tokenLookup)) {
    if (info.symbol === symbol) matches.push(pid);
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new ResolverError(`Ambiguous token symbol "${symbol}" — ${matches.length} matches. Use explicit principal.${context ? ' Context: ' + context : ''}`);
  throw new ResolverError(`Unknown token symbol "${symbol}"${context ? ' in ' + context : ''}. Register it first with 'ensure token'.`);
}

// ============================================
// VALUE RESOLUTION
// ============================================

function resolveValue(val, tokenLookup) {
  if (!val) return null;
  switch (val.type) {
    case 'bool': return val.value;
    case 'none': return null;
    case 'auto': return null;
    case 'number': return BigInt(Math.round(parseFloat(val.value)));
    case 'bps': return BigInt(Math.round(parseFloat(val.value)));
    case 'duration': {
      const n = parseFloat(val.value);
      if (val.unit === 'm') return BigInt(Math.round(n * 60));
      if (val.unit === 'h') return BigInt(Math.round(n * 3600));
      return BigInt(Math.round(n)); // seconds
    }
    case 'amount': {
      const tokenPid = resolveToken(val.token, tokenLookup);
      const decimals = tokenLookup[tokenPid]?.decimals ?? 8;
      const raw = parseFloat(val.value) * (10 ** decimals);
      return BigInt(Math.round(raw));
    }
    case 'string': return val.value;
    case 'keyword': return val.value;
    case 'ident': return val.value;
    case 'list': return val.items.map(item => resolveValue(item, tokenLookup));
    case 'object': {
      const resolved = {};
      for (const [k, v] of Object.entries(val.properties)) {
        resolved[k] = resolveValue(v, tokenLookup);
      }
      return resolved;
    }
    default: return val.value || val;
  }
}

function resolveDuration(val) {
  if (!val) return null;
  if (val.type === 'duration') {
    const n = parseFloat(val.value);
    if (val.unit === 'm') return BigInt(Math.round(n * 60));
    if (val.unit === 'h') return BigInt(Math.round(n * 3600));
    return BigInt(Math.round(n));
  }
  if (val.type === 'number') return BigInt(Math.round(parseFloat(val.value)));
  return BigInt(Math.round(parseFloat(val.value || val)));
}

function resolveBps(val) {
  if (!val) return null;
  if (val.type === 'bps') return BigInt(Math.round(parseFloat(val.value)));
  if (val.type === 'number') return BigInt(Math.round(parseFloat(val.value)));
  return BigInt(Math.round(parseFloat(val.value || val)));
}

function resolveAmount(val, tokenLookup, defaultToken = null) {
  if (!val) return null;
  if (val.type === 'none') return null;
  if (val.type === 'amount') {
    const tokenPid = resolveToken(val.token, tokenLookup);
    const decimals = tokenLookup[tokenPid]?.decimals ?? 8;
    return BigInt(Math.round(parseFloat(val.value) * (10 ** decimals)));
  }
  if (val.type === 'number') {
    if (defaultToken) {
      const pid = resolveToken(defaultToken, tokenLookup);
      const decimals = tokenLookup[pid]?.decimals ?? 8;
      return BigInt(Math.round(parseFloat(val.value) * (10 ** decimals)));
    }
    return BigInt(Math.round(parseFloat(val.value)));
  }
  return BigInt(Math.round(parseFloat(val.value || val)));
}

// ============================================
// RESOLVER ERROR
// ============================================

export class ResolverError extends Error {
  constructor(message, line) {
    super(message);
    this.line = line;
  }
}

// ============================================
// MAIN RESOLVER
// ============================================

export async function resolveOperations(ast, bot, tokenLookupOverride = null) {
  const operations = [];
  const errors = [];

  // ---- Fetch current state ----
  const [
    registry, pausedTokens, frozenTokens,
    enabledDexes, supportedDexes,
    choreStatuses, choreInstances,
    allPurseAllocations,
    cbEnabled, cbRules,
    loggingSettings, choreLoggingOverrides,
    priceStaleness, metadataStaleness, priceHistoryMaxSize,
    eventSubscriptions, eventReactions,
  ] = await Promise.all([
    bot.getTokenRegistry(),
    bot.getPausedTokens(),
    bot.getFrozenTokens(),
    bot.getEnabledDexes(),
    bot.getSupportedDexes(),
    bot.getChoreStatuses(),
    bot.listChoreInstances([]),
    bot.getAllPurseAllocations(),
    bot.getCircuitBreakerEnabled(),
    bot.getCircuitBreakerRules(),
    bot.getLoggingSettings(),
    bot.getChoreLoggingOverrides(),
    bot.getPriceStaleness(),
    bot.getMetadataStaleness(),
    bot.getPriceHistoryMaxSize(),
    bot.getEventSubscriptions(),
    bot.getEventReactions(),
  ]);

  // Build token lookup
  const tokenLookup = tokenLookupOverride || {};
  if (!tokenLookupOverride) {
    for (const entry of registry) {
      const pid = principalToText(entry.ledgerCanisterId);
      tokenLookup[pid] = { symbol: entry.symbol, decimals: Number(entry.decimals), fee: entry.fee };
    }
  }

  // Build state indexes
  const registryBySymbol = {};
  const registryByPrincipal = {};
  for (const entry of registry) {
    const pid = principalToText(entry.ledgerCanisterId);
    registryByPrincipal[pid] = entry;
    if (!registryBySymbol[entry.symbol]) registryBySymbol[entry.symbol] = [];
    registryBySymbol[entry.symbol].push(entry);
  }

  const pausedSet = new Set(pausedTokens.map(p => principalToText(p)));
  const frozenSet = new Set(frozenTokens.map(p => principalToText(p)));
  const enabledDexSet = new Set(enabledDexes.map(Number));

  const choreInstanceMap = new Map();
  for (const [id, info] of choreInstances) choreInstanceMap.set(id, info);

  const choreStatusMap = new Map();
  for (const cs of choreStatuses) choreStatusMap.set(cs.choreId, cs);

  const cbRuleByName = new Map();
  for (const r of cbRules) cbRuleByName.set(r.name, r);

  const subsBySource = new Map();
  for (const sub of eventSubscriptions) {
    subsBySource.set(principalToText(sub.sourceBotCanisterId), sub);
  }
  const reactionsByName = new Map();
  for (const r of eventReactions) reactionsByName.set(r.name, r);

  const purseMap = new Map();
  for (const p of allPurseAllocations) purseMap.set(p.instanceId, p);

  const choreLoggingMap = new Map();
  for (const [id, overrides] of choreLoggingOverrides) choreLoggingMap.set(id, overrides);

  // Fetch per-chore actions (for action resolution)
  const tradeActionsByChore = new Map();
  const moveFundsActionsByChore = new Map();
  const rebalTargetsByChore = new Map();
  const distributionsByChore = new Map();

  const choreDataFetches = [];
  for (const [id, info] of choreInstances) {
    if (info.typeId === 'trade') {
      choreDataFetches.push(bot.getTradeActions(id).then(a => tradeActionsByChore.set(id, a)));
    } else if (info.typeId === 'move-funds') {
      choreDataFetches.push(bot.getMoveFundsActions(id).then(a => moveFundsActionsByChore.set(id, a)));
    } else if (info.typeId === 'rebalance') {
      choreDataFetches.push(bot.getRebalanceTargets(id).then(t => rebalTargetsByChore.set(id, t)));
    } else if (info.typeId === 'distribute-funds') {
      choreDataFetches.push(bot.getDistributionLists(id).then(l => distributionsByChore.set(id, l)));
    }
  }
  await Promise.all(choreDataFetches);

  // ---- Sort statements: tokens first, then chores, then config, then CB, then events, then submits ----
  const sorted = sortStatements(ast.statements);

  // Track rebalance target diffs per instance for batching
  const rebalTargetDiffs = new Map();

  // ---- Process each statement ----
  for (const stmt of sorted) {
    try {
      switch (stmt.type) {
        case 'ensure': resolveEnsure(stmt); break;
        case 'remove': resolveRemove(stmt); break;
        case 'set': resolveSet(stmt); break;
        case 'submit': resolveSubmit(stmt); break;
        case 'reset_stats': resolveResetStats(stmt); break;
        default: errors.push({ line: stmt.line, message: `Unknown statement type: ${stmt.type}` });
      }
    } catch (e) {
      errors.push({ line: stmt.line, message: e.message });
    }
  }

  // Flush batched rebalance target diffs
  for (const [instanceId, diff] of rebalTargetDiffs) {
    const current = rebalTargetsByChore.get(instanceId) || [];
    const currentByToken = new Map();
    for (const t of current) currentByToken.set(principalToText(t.token), t);

    // Apply removes
    for (const tokenPid of (diff.removes || [])) {
      currentByToken.delete(tokenPid);
    }
    // Apply ensures (upserts)
    for (const target of (diff.ensures || [])) {
      const pid = principalToText(target.token);
      currentByToken.set(pid, target);
    }

    const newTargets = Array.from(currentByToken.values());
    operations.push({
      type: 'call', method: 'setRebalanceTargets',
      args: [instanceId, newTargets],
      description: `Set ${newTargets.length} rebalance targets for "${instanceId}"`,
      category: 'rebalance', line: diff.line,
    });
  }

  return { operations, errors };

  // ============================================
  // Statement handlers
  // ============================================

  function resolveEnsure(stmt) {
    switch (stmt.entity) {
      case 'token': return resolveEnsureToken(stmt);
      case 'chore': return resolveEnsureChore(stmt);
      case 'action': return resolveEnsureAction(stmt);
      case 'rebalance_target': return resolveEnsureRebalanceTarget(stmt);
      case 'distribution': return resolveEnsureDistribution(stmt);
      case 'circuit_breaker': return resolveEnsureCircuitBreaker(stmt);
      case 'event_subscription': return resolveEnsureEventSubscription(stmt);
      case 'event_reaction': return resolveEnsureEventReaction(stmt);
      default: throw new ResolverError(`Unknown entity type: ${stmt.entity}`, stmt.line);
    }
  }

  function resolveRemove(stmt) {
    switch (stmt.entity) {
      case 'token': return resolveRemoveToken(stmt);
      case 'chore': return resolveRemoveChore(stmt);
      case 'action': return resolveRemoveAction(stmt);
      case 'rebalance_target': return resolveRemoveRebalanceTarget(stmt);
      case 'distribution': return resolveRemoveDistribution(stmt);
      case 'circuit_breaker': return resolveRemoveCBRule(stmt);
      case 'event_subscription': return resolveRemoveEventSub(stmt);
      case 'event_reaction': return resolveRemoveEventReaction(stmt);
      case 'chore_logging': return resolveRemoveChoreLogging(stmt);
      default: throw new ResolverError(`Cannot remove entity type: ${stmt.entity}`, stmt.line);
    }
  }

  // ---- Token ----
  function resolveEnsureToken(stmt) {
    const props = stmt.properties;
    const ledger = resolveValue(props.ledger, tokenLookup);
    if (!ledger) throw new ResolverError('ensure token requires "ledger" property', stmt.line);

    const pid = typeof ledger === 'string' ? ledger : principalToText(ledger);
    if (registryByPrincipal[pid]) {
      operations.push({ type: 'no-op', description: `Token ${stmt.key} already registered`, category: 'tokens', line: stmt.line });
      return;
    }

    const entry = {
      ledgerCanisterId: toPrincipal(pid),
      symbol: resolveValue(props.symbol, tokenLookup) || stmt.key,
      decimals: Number(resolveValue(props.decimals, tokenLookup) || 8),
      fee: Number(resolveValue(props.fee, tokenLookup) || 0),
    };
    // Register in local lookup for subsequent statements
    tokenLookup[pid] = { symbol: entry.symbol, decimals: entry.decimals, fee: entry.fee };
    registryByPrincipal[pid] = entry;

    operations.push({
      type: 'call', method: 'addToken',
      args: [entry],
      description: `Register token ${entry.symbol} (${pid})`,
      category: 'tokens', line: stmt.line,
    });
  }

  function resolveRemoveToken(stmt) {
    const pid = resolveToken(stmt.key, tokenLookup, 'remove token');
    if (!registryByPrincipal[pid]) {
      operations.push({ type: 'no-op', description: `Token ${stmt.key} not in registry`, category: 'tokens', line: stmt.line });
      return;
    }
    operations.push({
      type: 'call', method: 'removeToken',
      args: [toPrincipal(pid)],
      description: `Remove token ${stmt.key} from registry`,
      category: 'tokens', line: stmt.line,
    });
  }

  // ---- Chore ----
  function resolveEnsureChore(stmt) {
    const id = stmt.key;
    const props = stmt.properties;
    const choreType = resolveValue(props.type, tokenLookup);
    const label = resolveValue(props.label, tokenLookup) || id;

    if (choreInstanceMap.has(id)) {
      const existing = choreInstanceMap.get(id);
      if (existing.instanceLabel !== label) {
        operations.push({
          type: 'call', method: 'renameChoreInstance',
          args: [id, label],
          description: `Rename chore "${id}" to "${label}"`,
          category: 'chores', line: stmt.line,
        });
      } else {
        operations.push({ type: 'no-op', description: `Chore "${id}" already exists`, category: 'chores', line: stmt.line });
      }
      return;
    }

    operations.push({
      type: 'call', method: 'createChoreInstance',
      args: [choreType, id, label],
      description: `Create ${choreType} chore "${id}" ("${label}")`,
      category: 'chores', line: stmt.line,
    });
    choreInstanceMap.set(id, { typeId: choreType, instanceLabel: label });
  }

  function resolveRemoveChore(stmt) {
    if (!choreInstanceMap.has(stmt.key)) {
      operations.push({ type: 'no-op', description: `Chore "${stmt.key}" does not exist`, category: 'chores', line: stmt.line });
      return;
    }
    operations.push({
      type: 'call', method: 'deleteChoreInstance',
      args: [stmt.key],
      description: `Delete chore "${stmt.key}"`,
      category: 'chores', line: stmt.line,
    });
  }

  // ---- Action ----
  function resolveEnsureAction(stmt) {
    const scope = stmt.scope;
    if (!scope) throw new ResolverError('ensure action requires "in" scope (chore instance ID)', stmt.line);
    const choreInfo = choreInstanceMap.get(scope);
    if (!choreInfo) throw new ResolverError(`Chore "${scope}" not found`, stmt.line);

    const isTradeChore = choreInfo.typeId === 'trade';
    const isMoveChore = choreInfo.typeId === 'move-funds';
    if (!isTradeChore && !isMoveChore) throw new ResolverError(`Chore "${scope}" is type "${choreInfo.typeId}", not trade or move-funds`, stmt.line);

    const actions = isTradeChore
      ? (tradeActionsByChore.get(scope) || [])
      : (moveFundsActionsByChore.get(scope) || []);

    const existing = actions.find(a => a.key === stmt.key);
    const input = buildActionConfigInput(stmt, tokenLookup);

    if (existing) {
      const method = isTradeChore ? 'updateTradeAction' : 'updateMoveFundsAction';
      operations.push({
        type: 'call', method,
        args: [scope, Number(existing.id), input],
        description: `Update action "${stmt.key}" in "${scope}"`,
        category: 'actions', line: stmt.line,
      });
    } else {
      const method = isTradeChore ? 'addTradeAction' : 'addMoveFundsAction';
      operations.push({
        type: 'call', method,
        args: [scope, input],
        description: `Add action "${stmt.key}" to "${scope}"`,
        category: 'actions', line: stmt.line,
      });
    }
  }

  function resolveRemoveAction(stmt) {
    const scope = stmt.scope;
    if (!scope) throw new ResolverError('remove action requires "from" scope', stmt.line);
    const choreInfo = choreInstanceMap.get(scope);
    if (!choreInfo) throw new ResolverError(`Chore "${scope}" not found`, stmt.line);

    const isTradeChore = choreInfo.typeId === 'trade';
    const actions = isTradeChore
      ? (tradeActionsByChore.get(scope) || [])
      : (moveFundsActionsByChore.get(scope) || []);

    const existing = actions.find(a => a.key === stmt.key);
    if (!existing) {
      operations.push({ type: 'no-op', description: `Action "${stmt.key}" not found in "${scope}"`, category: 'actions', line: stmt.line });
      return;
    }
    const method = isTradeChore ? 'removeTradeAction' : 'removeMoveFundsAction';
    operations.push({
      type: 'call', method,
      args: [scope, Number(existing.id)],
      description: `Remove action "${stmt.key}" from "${scope}"`,
      category: 'actions', line: stmt.line,
    });
  }

  // ---- Rebalance Target ----
  function resolveEnsureRebalanceTarget(stmt) {
    const scope = stmt.scope;
    if (!scope) throw new ResolverError('ensure rebalance_target requires "in" scope', stmt.line);
    const tokenPid = resolveToken(stmt.key, tokenLookup, 'rebalance_target');
    const props = stmt.properties;

    if (!rebalTargetDiffs.has(scope)) rebalTargetDiffs.set(scope, { ensures: [], removes: [], line: stmt.line });
    const diff = rebalTargetDiffs.get(scope);
    diff.ensures.push({
      token: toPrincipal(tokenPid),
      targetBps: Number(resolveBps(props.target) || 0),
      paused: resolveValue(props.paused, tokenLookup) === true,
    });
  }

  function resolveRemoveRebalanceTarget(stmt) {
    const scope = stmt.scope;
    if (!scope) throw new ResolverError('remove rebalance_target requires "from" scope', stmt.line);
    const tokenPid = resolveToken(stmt.key, tokenLookup, 'remove rebalance_target');

    if (!rebalTargetDiffs.has(scope)) rebalTargetDiffs.set(scope, { ensures: [], removes: [], line: stmt.line });
    rebalTargetDiffs.get(scope).removes.push(tokenPid);
  }

  // ---- Distribution ----
  function resolveEnsureDistribution(stmt) {
    const scope = stmt.scope;
    if (!scope) throw new ResolverError('ensure distribution requires "in" scope', stmt.line);
    const lists = distributionsByChore.get(scope) || [];
    const existing = lists.find(l => l.name === stmt.key);
    const input = buildDistributionListInput(stmt, tokenLookup);

    if (existing) {
      operations.push({
        type: 'call', method: 'updateDistributionList',
        args: [scope, Number(existing.id), input],
        description: `Update distribution "${stmt.key}" in "${scope}"`,
        category: 'distributions', line: stmt.line,
      });
    } else {
      operations.push({
        type: 'call', method: 'addDistributionList',
        args: [scope, input],
        description: `Add distribution "${stmt.key}" to "${scope}"`,
        category: 'distributions', line: stmt.line,
      });
    }
  }

  function resolveRemoveDistribution(stmt) {
    const scope = stmt.scope;
    if (!scope) throw new ResolverError('remove distribution requires "from" scope', stmt.line);
    const lists = distributionsByChore.get(scope) || [];
    const existing = lists.find(l => l.name === stmt.key);
    if (!existing) {
      operations.push({ type: 'no-op', description: `Distribution "${stmt.key}" not found in "${scope}"`, category: 'distributions', line: stmt.line });
      return;
    }
    operations.push({
      type: 'call', method: 'removeDistributionList',
      args: [scope, Number(existing.id)],
      description: `Remove distribution "${stmt.key}" from "${scope}"`,
      category: 'distributions', line: stmt.line,
    });
  }

  // ---- Circuit Breaker ----
  function resolveEnsureCircuitBreaker(stmt) {
    const existing = cbRuleByName.get(stmt.key);
    const input = buildCBRuleInput(stmt, tokenLookup);

    if (existing) {
      operations.push({
        type: 'call', method: 'updateCircuitBreakerRule',
        args: [Number(existing.id), input],
        description: `Update circuit breaker rule "${stmt.key}"`,
        category: 'circuit_breaker', line: stmt.line,
      });
    } else {
      operations.push({
        type: 'call', method: 'addCircuitBreakerRule',
        args: [input],
        description: `Add circuit breaker rule "${stmt.key}"`,
        category: 'circuit_breaker', line: stmt.line,
      });
    }
  }

  function resolveRemoveCBRule(stmt) {
    const existing = cbRuleByName.get(stmt.key);
    if (!existing) {
      operations.push({ type: 'no-op', description: `Circuit breaker rule "${stmt.key}" not found`, category: 'circuit_breaker', line: stmt.line });
      return;
    }
    operations.push({
      type: 'call', method: 'removeCircuitBreakerRule',
      args: [Number(existing.id)],
      description: `Remove circuit breaker rule "${stmt.key}"`,
      category: 'circuit_breaker', line: stmt.line,
    });
  }

  // ---- Event Subscription ----
  function resolveEnsureEventSubscription(stmt) {
    const sourcePid = stmt.key;
    const existing = subsBySource.get(sourcePid);
    const eventTypes = resolveValue(stmt.properties.event_types, tokenLookup) || [];
    const eventTypeNats = eventTypes.map(Number);

    if (existing) {
      operations.push({
        type: 'call', method: 'updateEventSubscription',
        args: [Number(existing.id), eventTypeNats],
        description: `Update event subscription to "${sourcePid}"`,
        category: 'events', line: stmt.line,
      });
    } else {
      operations.push({
        type: 'call', method: 'addEventSubscription',
        args: [toPrincipal(sourcePid), eventTypeNats],
        description: `Subscribe to events from "${sourcePid}"`,
        category: 'events', line: stmt.line,
      });
    }
  }

  function resolveRemoveEventSub(stmt) {
    const existing = subsBySource.get(stmt.key);
    if (!existing) {
      operations.push({ type: 'no-op', description: `No subscription to "${stmt.key}"`, category: 'events', line: stmt.line });
      return;
    }
    operations.push({
      type: 'call', method: 'removeEventSubscription',
      args: [Number(existing.id)],
      description: `Remove event subscription to "${stmt.key}"`,
      category: 'events', line: stmt.line,
    });
  }

  // ---- Event Reaction ----
  function resolveEnsureEventReaction(stmt) {
    const existing = reactionsByName.get(stmt.key);
    const props = stmt.properties;
    const subRef = resolveValue(props.subscription, tokenLookup);
    const sub = subsBySource.get(subRef);
    const subscriptionId = sub ? Number(sub.id) : Number(resolveValue(props.subscription_id, tokenLookup) || 0);

    const conditions = [];
    if (props.conditions && props.conditions.type === 'list') {
      for (const item of props.conditions.items) {
        if (item.type === 'object') {
          conditions.push({
            dataKey: resolveValue(item.properties.key, tokenLookup) || '',
            operator: EVENT_CONDITION_OP_IDS[resolveValue(item.properties.op, tokenLookup)] ?? 0,
            value: String(resolveValue(item.properties.value, tokenLookup) || ''),
          });
        }
      }
    }

    const actionParams = [];
    if (props.action_params && props.action_params.type === 'object') {
      for (const [k, v] of Object.entries(props.action_params.properties)) {
        actionParams.push([k, String(resolveValue(v, tokenLookup))]);
      }
    }

    const input = {
      name: stmt.key,
      enabled: resolveValue(props.enabled, tokenLookup) !== false,
      subscriptionId,
      eventTypeId: Number(resolveValue(props.event_type, tokenLookup) || 0),
      reactionActionId: Number(resolveValue(props.action, tokenLookup) || 0),
      actionParams,
      conditions,
      cooldownSeconds: props.cooldown ? optToArray(Number(resolveDuration(props.cooldown))) : [],
    };

    if (existing) {
      operations.push({
        type: 'call', method: 'updateEventReaction',
        args: [Number(existing.id), input],
        description: `Update event reaction "${stmt.key}"`,
        category: 'events', line: stmt.line,
      });
    } else {
      operations.push({
        type: 'call', method: 'addEventReaction',
        args: [input],
        description: `Add event reaction "${stmt.key}"`,
        category: 'events', line: stmt.line,
      });
    }
  }

  function resolveRemoveEventReaction(stmt) {
    const existing = reactionsByName.get(stmt.key);
    if (!existing) {
      operations.push({ type: 'no-op', description: `Event reaction "${stmt.key}" not found`, category: 'events', line: stmt.line });
      return;
    }
    operations.push({
      type: 'call', method: 'removeEventReaction',
      args: [Number(existing.id)],
      description: `Remove event reaction "${stmt.key}"`,
      category: 'events', line: stmt.line,
    });
  }

  function resolveRemoveChoreLogging(stmt) {
    operations.push({
      type: 'call', method: 'removeChoreLoggingOverride',
      args: [stmt.key],
      description: `Remove logging overrides for "${stmt.key}"`,
      category: 'logging', line: stmt.line,
    });
  }

  // ---- set ----
  function resolveSet(stmt) {
    switch (stmt.entity) {
      case 'token': return resolveSetToken(stmt);
      case 'chore': return resolveSetChore(stmt);
      case 'dex': return resolveSetDex(stmt);
      case 'rebalance': return resolveSetRebalance(stmt);
      case 'purse': return resolveSetPurse(stmt);
      case 'trade': return resolveSetTrade(stmt);
      case 'logging': return resolveSetLogging(stmt);
      case 'chore_logging': return resolveSetChoreLogging(stmt);
      case 'global': return resolveSetGlobal(stmt);
      default: throw new ResolverError(`Unknown set entity: ${stmt.entity}`, stmt.line);
    }
  }

  function resolveSetToken(stmt) {
    const pid = resolveToken(stmt.key, tokenLookup, 'set token');
    const val = resolveValue(stmt.value, tokenLookup);
    if (stmt.property === 'paused') {
      const method = val ? 'pauseToken' : 'unpauseToken';
      operations.push({
        type: 'call', method, args: [toPrincipal(pid)],
        description: `${val ? 'Pause' : 'Unpause'} token ${stmt.key}`,
        category: 'tokens', line: stmt.line,
      });
    } else if (stmt.property === 'frozen') {
      const method = val ? 'freezeToken' : 'unfreezeToken';
      operations.push({
        type: 'call', method, args: [toPrincipal(pid)],
        description: `${val ? 'Freeze' : 'Unfreeze'} token ${stmt.key}`,
        category: 'tokens', line: stmt.line,
      });
    }
  }

  function resolveSetChore(stmt) {
    const id = stmt.key;
    const prop = stmt.property;
    const val = resolveValue(stmt.value, tokenLookup);

    if (prop === 'status') {
      const cs = choreStatusMap.get(id);
      const currentStatus = cs ? (cs.enabled ? (cs.paused ? 'paused' : 'running') : 'stopped') : 'stopped';
      if (val === currentStatus) {
        operations.push({ type: 'no-op', description: `Chore "${id}" already ${val}`, category: 'chores', line: stmt.line });
        return;
      }
      let method;
      if (val === 'running') method = currentStatus === 'paused' ? 'resumeChore' : 'startChore';
      else if (val === 'paused') method = 'pauseChore';
      else if (val === 'stopped') method = 'stopChore';
      else throw new ResolverError(`Invalid chore status: ${val}`, stmt.line);
      operations.push({
        type: 'call', method, args: [id],
        description: `${method.replace('Chore', '')} chore "${id}" (${currentStatus} → ${val})`,
        category: 'chores', line: stmt.line,
      });
    } else if (prop === 'interval') {
      operations.push({
        type: 'call', method: 'setChoreInterval', args: [id, Number(val)],
        description: `Set chore "${id}" interval to ${Number(val)}s`,
        category: 'chores', line: stmt.line,
      });
    } else if (prop === 'max_interval') {
      operations.push({
        type: 'call', method: 'setChoreMaxInterval', args: [id, optToArray(Number(val))],
        description: `Set chore "${id}" max interval to ${Number(val)}s`,
        category: 'chores', line: stmt.line,
      });
    } else if (prop === 'task_timeout') {
      operations.push({
        type: 'call', method: 'setChoreTaskTimeout', args: [id, Number(val)],
        description: `Set chore "${id}" task timeout to ${Number(val)}s`,
        category: 'chores', line: stmt.line,
      });
    }
  }

  function resolveSetDex(stmt) {
    const dexName = stmt.key;
    const dexId = DEX_IDS[dexName];
    if (dexId === undefined || dexId === null) throw new ResolverError(`Unknown DEX: ${dexName}`, stmt.line);
    const val = resolveValue(stmt.value, tokenLookup);
    operations.push({
      type: 'call', method: 'setDexEnabled', args: [dexId, val],
      description: `${val ? 'Enable' : 'Disable'} ${dexName}`,
      category: 'dex', line: stmt.line,
    });
  }

  function resolveSetRebalance(stmt) {
    const id = stmt.key;
    const prop = stmt.property;
    const val = resolveValue(stmt.value, tokenLookup);

    const methodMap = {
      denomination: 'setRebalanceDenominationToken',
      max_trade_size: 'setRebalanceMaxTradeSize',
      min_trade_size: 'setRebalanceMinTradeSize',
      threshold: 'setRebalanceThresholdBps',
      max_slippage: 'setRebalanceMaxSlippageBps',
      max_price_impact: 'setRebalanceMaxPriceImpactBps',
      fallback_route_tokens: 'setRebalanceFallbackRouteTokens',
    };

    const method = methodMap[prop];
    if (!method) throw new ResolverError(`Unknown rebalance property: ${prop}`, stmt.line);

    let arg;
    if (prop === 'denomination') {
      arg = toPrincipal(resolveToken(stmt.value, tokenLookup, 'rebalance denomination'));
    } else if (prop === 'fallback_route_tokens') {
      arg = (Array.isArray(val) ? val : []).map(v => toPrincipal(resolveToken(v, tokenLookup, 'fallback token')));
    } else {
      arg = Number(val);
    }

    operations.push({
      type: 'call', method, args: [id, arg],
      description: `Set rebalance "${id}" ${prop}`,
      category: 'rebalance', line: stmt.line,
    });
  }

  function resolveSetPurse(stmt) {
    const id = stmt.key;
    const prop = stmt.property;
    const val = resolveValue(stmt.value, tokenLookup);

    if (prop === 'enabled') {
      operations.push({
        type: 'call', method: val ? 'enablePurse' : 'disablePurse', args: [id],
        description: `${val ? 'Enable' : 'Disable'} purse for "${id}"`,
        category: 'purses', line: stmt.line,
      });
    } else if (prop === 'trading_purse') {
      operations.push({
        type: 'call', method: 'setTradingPurseId',
        args: [id, val ? optToArray(val) : []],
        description: `Set trading purse for "${id}" to ${val || 'none'}`,
        category: 'purses', line: stmt.line,
      });
    }
  }

  function resolveSetTrade(stmt) {
    const id = stmt.key;
    if (stmt.property === 'fallback_route_tokens') {
      const val = resolveValue(stmt.value, tokenLookup);
      const tokens = (Array.isArray(val) ? val : []).map(v => toPrincipal(resolveToken(v, tokenLookup, 'fallback token')));
      operations.push({
        type: 'call', method: 'setTradeFallbackRouteTokens', args: [id, tokens],
        description: `Set fallback route tokens for trade chore "${id}"`,
        category: 'actions', line: stmt.line,
      });
    }
  }

  function resolveSetLogging(stmt) {
    const current = { ...loggingSettings };
    const prop = stmt.property;
    const val = resolveValue(stmt.value, tokenLookup);

    const update = {
      tradeLogEnabled: current.tradeLogEnabled,
      portfolioLogEnabled: current.portfolioLogEnabled,
      maxTradeLogEntries: Number(current.maxTradeLogEntries),
      maxPortfolioLogEntries: Number(current.maxPortfolioLogEntries),
    };

    if (prop === 'trade_log') update.tradeLogEnabled = val;
    else if (prop === 'portfolio_log') update.portfolioLogEnabled = val;
    else if (prop === 'max_trade_log_entries') update.maxTradeLogEntries = Number(val);
    else if (prop === 'max_portfolio_log_entries') update.maxPortfolioLogEntries = Number(val);

    operations.push({
      type: 'call', method: 'setLoggingSettings', args: [update],
      description: `Set logging ${prop} to ${val}`,
      category: 'logging', line: stmt.line,
    });
  }

  function resolveSetChoreLogging(stmt) {
    const id = stmt.key;
    const prop = stmt.property;
    const val = resolveValue(stmt.value, tokenLookup);
    const existing = choreLoggingMap.get(id) || { tradeLogEnabled: [], portfolioLogEnabled: [] };

    const overrides = {
      tradeLogEnabled: existing.tradeLogEnabled || [],
      portfolioLogEnabled: existing.portfolioLogEnabled || [],
    };
    if (prop === 'trade_log') overrides.tradeLogEnabled = optToArray(val);
    else if (prop === 'portfolio_log') overrides.portfolioLogEnabled = optToArray(val);

    operations.push({
      type: 'call', method: 'setChoreLoggingOverride', args: [id, overrides],
      description: `Set chore logging "${id}" ${prop} to ${val}`,
      category: 'logging', line: stmt.line,
    });
  }

  function resolveSetGlobal(stmt) {
    const prop = stmt.property;
    const val = resolveValue(stmt.value, tokenLookup);

    const globalMap = {
      circuit_breaker_enabled: { method: 'setCircuitBreakerEnabled', args: [val] },
      event_emission: { method: 'setEventEmissionEnabled', args: [val] },
      default_slippage: { method: 'setDefaultSlippage', args: [Number(val)] },
      default_max_price_impact: { method: 'setDefaultMaxPriceImpact', args: [Number(val)] },
      price_staleness: { method: 'setPriceStaleness', args: [Number(val)] },
      metadata_staleness: { method: 'setMetadataStaleness', args: [Number(val)] },
      price_history_max_size: { method: 'setPriceHistoryMaxSize', args: [Number(val)] },
    };

    const mapping = globalMap[prop];
    if (!mapping) throw new ResolverError(`Unknown global property: ${prop}`, stmt.line);

    operations.push({
      type: 'call', method: mapping.method, args: mapping.args,
      description: `Set ${prop} to ${val}`,
      category: 'settings', line: stmt.line,
    });
  }

  // ---- submit ----
  function resolveSubmit(stmt) {
    const props = stmt.properties;

    switch (stmt.action) {
      case 'trade': {
        const inputPid = resolveToken(resolveValue(props.input, tokenLookup), tokenLookup, 'trade input');
        const outputPid = resolveToken(resolveValue(props.output, tokenLookup), tokenLookup, 'trade output');
        const amount = resolveAmount(props.amount, tokenLookup, inputPid);
        const minOutput = props.min_output ? resolveAmount(props.min_output, tokenLookup, outputPid) : null;
        const slippage = props.slippage ? Number(resolveBps(props.slippage)) : null;
        const maxImpact = props.max_price_impact ? Number(resolveBps(props.max_price_impact)) : null;
        const dex = resolveValue(props.dex, tokenLookup);
        const dexId = dex && DEX_IDS[dex] !== undefined ? DEX_IDS[dex] : null;
        const sourcePurse = resolveValue(props.source_purse, tokenLookup);

        operations.push({
          type: 'call', method: 'submitOneOffTrade',
          args: [{
            inputToken: toPrincipal(inputPid),
            outputToken: toPrincipal(outputPid),
            inputAmount: Number(amount),
            minOutputAmount: minOutput !== null ? optToArray(Number(minOutput)) : [],
            maxSlippageBps: slippage !== null ? optToArray(slippage) : [],
            maxPriceImpactBps: maxImpact !== null ? optToArray(maxImpact) : [],
            preferredDex: dexId !== null ? optToArray(dexId) : [],
            sourcePurseId: sourcePurse && sourcePurse !== 'none' ? optToArray(sourcePurse) : [],
          }],
          description: `Quick trade: ${tokenLookup[inputPid]?.symbol || inputPid} → ${tokenLookup[outputPid]?.symbol || outputPid}`,
          category: 'trades', line: stmt.line,
        });
        break;
      }
      case 'withdraw': {
        const tokenPid = resolveToken(resolveValue(props.token, tokenLookup), tokenLookup, 'withdraw token');
        const to = resolveValue(props.to, tokenLookup);
        const amount = resolveAmount(props.amount, tokenLookup, tokenPid);
        operations.push({
          type: 'call', method: 'withdrawToken',
          args: [toPrincipal(tokenPid), toPrincipal(to), Number(amount), []],
          description: `Withdraw ${tokenLookup[tokenPid]?.symbol || tokenPid} to ${to}`,
          category: 'trades', line: stmt.line,
        });
        break;
      }
      case 'send': {
        const tokenPid = resolveToken(resolveValue(props.token, tokenLookup), tokenLookup, 'send token');
        const to = resolveValue(props.to, tokenLookup);
        const amount = resolveAmount(props.amount, tokenLookup, tokenPid);
        const sourcePurse = resolveValue(props.source_purse, tokenLookup);
        operations.push({
          type: 'call', method: 'manualSend',
          args: [toPrincipal(tokenPid), toPrincipal(to), Number(amount), [], []],
          description: `Send ${tokenLookup[tokenPid]?.symbol || tokenPid} to ${to}`,
          category: 'trades', line: stmt.line,
        });
        break;
      }
      case 'fund_purse': {
        const purseId = resolveValue(props.purse, tokenLookup);
        const tokenPid = resolveToken(resolveValue(props.token, tokenLookup), tokenLookup, 'fund token');
        const amount = resolveAmount(props.amount, tokenLookup, tokenPid);
        operations.push({
          type: 'call', method: 'fundPurse',
          args: [purseId, toPrincipal(tokenPid), Number(amount)],
          description: `Fund purse "${purseId}" with ${tokenLookup[tokenPid]?.symbol || tokenPid}`,
          category: 'purses', line: stmt.line,
        });
        break;
      }
      case 'reclaim': {
        const purseId = resolveValue(props.purse, tokenLookup);
        const tokenPid = resolveToken(resolveValue(props.token, tokenLookup), tokenLookup, 'reclaim token');
        const amount = resolveAmount(props.amount, tokenLookup, tokenPid);
        operations.push({
          type: 'call', method: 'reclaimFromPurse',
          args: [purseId, toPrincipal(tokenPid), Number(amount)],
          description: `Reclaim from purse "${purseId}"`,
          category: 'purses', line: stmt.line,
        });
        break;
      }
    }
  }

  // ---- reset_stats ----
  function resolveResetStats(stmt) {
    const scope = stmt.scope;
    if (!scope) throw new ResolverError('reset_stats requires "in" scope', stmt.line);
    const actions = tradeActionsByChore.get(scope) || moveFundsActionsByChore.get(scope) || [];
    const existing = actions.find(a => a.key === stmt.key);
    if (!existing) throw new ResolverError(`Action "${stmt.key}" not found in "${scope}"`, stmt.line);
    operations.push({
      type: 'call', method: 'resetActionStats',
      args: [scope, Number(existing.id)],
      description: `Reset stats for action "${stmt.key}" in "${scope}"`,
      category: 'actions', line: stmt.line,
    });
  }
}

// ============================================
// HELPERS
// ============================================

function sortStatements(stmts) {
  const order = { token: 0, chore: 1, action: 2, rebalance_target: 3, distribution: 3, circuit_breaker: 4, event_subscription: 5, event_reaction: 6 };
  const typeOrder = (s) => {
    if (s.type === 'submit') return 10;
    if (s.type === 'set') return s.entity === 'global' ? 1 : 3;
    return order[s.entity] ?? 7;
  };
  return [...stmts].sort((a, b) => typeOrder(a) - typeOrder(b));
}

function buildActionConfigInput(stmt, tokenLookup) {
  const p = stmt.properties;
  const actionType = ACTION_TYPE_IDS[resolveValue(p.type, tokenLookup)] ?? 0;
  const inputPid = resolveToken(resolveValue(p.input, tokenLookup), tokenLookup, 'action input');
  const outputRef = resolveValue(p.output, tokenLookup);
  const outputPid = outputRef ? resolveToken(outputRef, tokenLookup, 'action output') : null;

  return {
    key: stmt.key,
    actionType,
    enabled: resolveValue(p.enabled, tokenLookup) !== false,
    inputToken: toPrincipal(inputPid),
    outputToken: outputPid ? [toPrincipal(outputPid)] : [],
    minAmount: Number(resolveAmount(p.min_amount, tokenLookup, inputPid) || 0n),
    maxAmount: Number(resolveAmount(p.max_amount, tokenLookup, inputPid) || 0n),
    amountMode: AMOUNT_MODE_IDS[resolveValue(p.amount_mode, tokenLookup)] ?? 0,
    balancePercent: p.balance_percent ? [Number(resolveBps(p.balance_percent))] : [],
    preferredDex: p.preferred_dex ? (DEX_IDS[resolveValue(p.preferred_dex, tokenLookup)] !== undefined ? [DEX_IDS[resolveValue(p.preferred_dex, tokenLookup)]] : []) : [],
    sourcePurseId: p.source_purse ? (resolveValue(p.source_purse, tokenLookup) !== null ? [resolveValue(p.source_purse, tokenLookup)] : []) : [],
    targetPurseId: p.target_purse ? (resolveValue(p.target_purse, tokenLookup) !== null ? [resolveValue(p.target_purse, tokenLookup)] : []) : [],
    destinationOwner: p.destination ? [toPrincipal(resolveValue(p.destination, tokenLookup))] : [],
    destinationSubaccount: [],
    minBalance: p.min_balance ? (resolveAmount(p.min_balance, tokenLookup) !== null ? [Number(resolveAmount(p.min_balance, tokenLookup))] : []) : [],
    maxBalance: p.max_balance ? (resolveAmount(p.max_balance, tokenLookup) !== null ? [Number(resolveAmount(p.max_balance, tokenLookup))] : []) : [],
    balanceDenominationToken: p.balance_denomination ? [toPrincipal(resolveToken(resolveValue(p.balance_denomination, tokenLookup), tokenLookup))] : [],
    minPrice: p.min_price ? (resolveAmount(p.min_price, tokenLookup) !== null ? [Number(resolveAmount(p.min_price, tokenLookup))] : []) : [],
    maxPrice: p.max_price ? (resolveAmount(p.max_price, tokenLookup) !== null ? [Number(resolveAmount(p.max_price, tokenLookup))] : []) : [],
    priceDenominationToken: p.price_denomination ? [toPrincipal(resolveToken(resolveValue(p.price_denomination, tokenLookup), tokenLookup))] : [],
    maxPriceImpactBps: p.max_price_impact ? [Number(resolveBps(p.max_price_impact))] : [],
    maxSlippageBps: p.max_slippage ? [Number(resolveBps(p.max_slippage))] : [],
    minFrequencySeconds: p.min_frequency ? [Number(resolveDuration(p.min_frequency))] : [],
    maxFrequencySeconds: p.max_frequency ? [Number(resolveDuration(p.max_frequency))] : [],
    tradeSizeDenominationToken: p.trade_size_denomination ? [toPrincipal(resolveToken(resolveValue(p.trade_size_denomination, tokenLookup), tokenLookup))] : [],
    trailingStopBps: p.trailing_stop ? [Number(resolveBps(p.trailing_stop))] : [],
    trailingStopDirection: p.trailing_stop_direction ? [TRAILING_STOP_DIR_IDS[resolveValue(p.trailing_stop_direction, tokenLookup)] ?? 0] : [],
    trailingStopResetOnExec: p.trailing_stop_reset ? [TRAILING_STOP_RESET_IDS[resolveValue(p.trailing_stop_reset, tokenLookup)] ?? 0] : [],
    haltChoreAfterExecution: resolveValue(p.halt_chore_after, tokenLookup) === true,
    maxCumulativeInput: p.max_cumulative_input ? (resolveAmount(p.max_cumulative_input, tokenLookup) !== null ? [Number(resolveAmount(p.max_cumulative_input, tokenLookup))] : []) : [],
    maxCumulativeOutput: p.max_cumulative_output ? (resolveAmount(p.max_cumulative_output, tokenLookup) !== null ? [Number(resolveAmount(p.max_cumulative_output, tokenLookup))] : []) : [],
    maxExecutions: p.max_executions ? [Number(resolveValue(p.max_executions, tokenLookup))] : [],
  };
}

function buildDistributionListInput(stmt, tokenLookup) {
  const p = stmt.properties;
  const tokenPid = resolveToken(resolveValue(p.token, tokenLookup), tokenLookup, 'distribution token');
  const targets = [];
  if (p.targets && p.targets.type === 'list') {
    for (const item of p.targets.items) {
      if (item.type === 'object') {
        const props = item.properties;
        const choreId = resolveValue(props.purse, tokenLookup);
        const accountOwner = resolveValue(props.account, tokenLookup);
        const share = props.share ? Number(resolveBps(props.share)) : null;
        targets.push({
          account: { owner: toPrincipal(accountOwner || 'aaaaa-aa'), subaccount: [] },
          basisPoints: share !== null ? [share] : [],
          choreInstanceId: choreId ? [choreId] : [],
        });
      }
    }
  }

  return {
    name: stmt.key,
    tokenLedgerCanisterId: toPrincipal(tokenPid),
    thresholdAmount: Number(resolveAmount(p.threshold, tokenLookup, tokenPid) || 0n),
    maxDistributionAmount: Number(resolveAmount(p.max_amount, tokenLookup, tokenPid) || 0n),
    minDistributionAmount: Number(resolveAmount(p.min_amount, tokenLookup, tokenPid) || 0n),
    targets,
    sourcePurseId: p.source_purse ? (resolveValue(p.source_purse, tokenLookup) !== null ? [resolveValue(p.source_purse, tokenLookup)] : []) : [],
    amountMode: AMOUNT_MODE_IDS[resolveValue(p.amount_mode, tokenLookup)] ?? 0,
    balancePercent: p.balance_percent ? [Number(resolveBps(p.balance_percent))] : [],
  };
}

function buildCBRuleInput(stmt, tokenLookup) {
  const topOp = stmt.conditions?.operator === 'ANY' ? 1 : 0;

  function buildCondition(cond) {
    if (cond.operator === 'ALL' || cond.operator === 'ANY') {
      return {
        conditionType: cond.operator === 'ALL' ? 3 : 4,
        priceToken1: [], priceToken2: [],
        balanceToken: [], balanceChoreInstanceId: [], valueSources: [],
        operator: 0, threshold: [], rangeMin: [], rangeMax: [],
        changePercentBps: [], changeDirection: [], changePeriodSeconds: [],
        denominationToken: [],
        children: (cond.conditions || []).map(buildCondition),
      };
    }
    const base = {
      conditionType: CB_CONDITION_TYPE[cond.type] ?? 0,
      priceToken1: [], priceToken2: [],
      balanceToken: [], balanceChoreInstanceId: [], valueSources: [],
      operator: 0, threshold: [], rangeMin: [], rangeMax: [],
      changePercentBps: [], changeDirection: [], changePeriodSeconds: [],
      denominationToken: [],
      children: [],
    };

    if (cond.type === 'price') {
      base.priceToken1 = [toPrincipal(resolveToken(cond.token1, tokenLookup))];
      base.priceToken2 = [toPrincipal(resolveToken(cond.token2, tokenLookup))];
      base.operator = cond.op === '>' ? 0 : cond.op === '<' ? 1 : cond.op === 'in_range' ? 2 : 3;
      const thresh = resolveValue(cond.threshold, tokenLookup);
      if (thresh !== null) base.threshold = [Number(thresh)];
    } else if (cond.type === 'price_change') {
      base.conditionType = 0;
      base.priceToken1 = [toPrincipal(resolveToken(cond.token1, tokenLookup))];
      base.priceToken2 = [toPrincipal(resolveToken(cond.token2, tokenLookup))];
      base.operator = 4;
      const bps = resolveValue(cond.changeBps, tokenLookup);
      base.changePercentBps = [Number(bps)];
      base.changeDirection = [{ up: 0, down: 1, either: 2 }[cond.direction] ?? 2];
      const period = resolveValue(cond.period, tokenLookup);
      base.changePeriodSeconds = [Number(period)];
    } else if (cond.type === 'balance') {
      base.conditionType = 2;
      base.balanceToken = [toPrincipal(resolveToken(cond.token, tokenLookup))];
      const purse = cond.purse;
      if (purse && purse !== 'main') base.balanceChoreInstanceId = [purse];
      base.operator = cond.op === '>' ? 0 : cond.op === '<' ? 1 : cond.op === 'in_range' ? 2 : 3;
      const thresh = resolveValue(cond.threshold, tokenLookup);
      if (thresh !== null) base.threshold = [Number(thresh)];
    }

    return base;
  }

  function buildCBAction(action) {
    const typeId = CB_ACTION_TYPE[action.type] ?? 0;
    const result = { actionType: typeId, token: [], choreInstanceId: [], choreTypeId: [] };

    if (action.token) {
      try { result.token = [toPrincipal(resolveToken(action.token, tokenLookup))]; } catch (_) {}
    }
    if (action.choreId) result.choreInstanceId = [action.choreId];
    if (action.choreType) result.choreTypeId = [action.choreType];
    if (action.rebalId) result.choreInstanceId = [action.rebalId];
    return result;
  }

  return {
    name: stmt.key,
    enabled: resolveValue(stmt.properties.enabled, tokenLookup) !== false,
    topLevelOperator: topOp,
    conditions: (stmt.conditions?.conditions || []).map(buildCondition),
    actions: (stmt.actions || []).map(buildCBAction),
  };
}
