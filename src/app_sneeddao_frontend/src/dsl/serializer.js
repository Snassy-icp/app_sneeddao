// SneedScript DSL Serializer — Queries bot state and produces DSL text.
// The output is a valid DSL document that would recreate the current config if executed.

const ACTION_TYPE_NAMES = { 0: 'trade', 1: 'fund_purse', 2: 'reclaim', 3: 'send' };
const DEX_NAMES = { 0: 'ICPSwap', 1: 'KongSwap' };
const AMOUNT_MODE_NAMES = { 0: 'range', 1: 'percent' };
const TRAILING_STOP_DIR = { 0: 'stop_loss', 1: 'take_profit' };
const TRAILING_STOP_RESET = { 0: 'on_exec', 1: 'never' };
const CB_CONDITION_TYPE = { 0: 'price', 1: 'value', 2: 'balance', 3: 'and_group', 4: 'or_group' };
const CB_OPERATOR = { 0: '>', 1: '<', 2: 'in_range', 3: 'outside_range', 4: 'changed' };
const CB_CHANGE_DIR = { 0: 'up', 1: 'down', 2: 'either' };
const CB_VALUE_SOURCE_TYPE = { 0: 'token', 1: 'rebal_tokens', 2: 'all_in_account' };
const CB_ACTION_TYPE = {
  0: 'pause_token_in_rebal', 1: 'pause_token', 2: 'freeze_token',
  3: 'stop_chore', 4: 'pause_chore', 5: 'stop_all_by_type', 6: 'pause_all_by_type',
  7: 'stop_all', 8: 'pause_all', 9: 'start_chore', 10: 'start_all_by_type', 11: 'start_all',
};
const EVENT_CONDITION_OP = { 0: 'equals', 1: 'not_equals', 2: 'contains', 3: 'greater_than', 4: 'less_than' };

function principalToText(p) {
  if (!p) return '?';
  return typeof p === 'string' ? p : (p.toText ? p.toText() : String(p));
}

function formatAmount(rawAmount, decimals, symbol) {
  if (rawAmount === 0n || rawAmount === 0) return `0 ${symbol}`;
  const d = Number(decimals || 8);
  const divisor = 10 ** d;
  const raw = typeof rawAmount === 'bigint' ? rawAmount : BigInt(rawAmount);
  const whole = raw / BigInt(divisor);
  const frac = raw % BigInt(divisor);
  if (frac === 0n) return `${whole} ${symbol}`;
  const fracStr = frac.toString().padStart(d, '0').replace(/0+$/, '');
  return `${whole}.${fracStr} ${symbol}`;
}

function formatDuration(seconds) {
  const s = Number(seconds);
  if (s % 3600 === 0 && s >= 3600) return `${s / 3600}h`;
  if (s % 60 === 0 && s >= 60) return `${s / 60}m`;
  return `${s}s`;
}

function formatTimestamp(nanos) {
  if (!nanos) return 'never';
  const ms = Number(BigInt(nanos) / 1_000_000n);
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

function indent(text, level = 1) {
  const prefix = '  '.repeat(level);
  return text.split('\n').map(l => prefix + l).join('\n');
}

// Build a lookup: principal text -> { symbol, decimals, fee }
function buildTokenLookup(registry) {
  const lookup = {};
  for (const entry of registry) {
    const pid = principalToText(entry.ledgerCanisterId);
    lookup[pid] = {
      symbol: entry.symbol,
      decimals: Number(entry.decimals),
      fee: entry.fee,
    };
  }
  return lookup;
}

function sym(tokenLookup, principal) {
  const pid = principalToText(principal);
  return tokenLookup[pid]?.symbol || pid;
}

function dec(tokenLookup, principal) {
  const pid = principalToText(principal);
  return tokenLookup[pid]?.decimals ?? 8;
}

function fmtAmt(tokenLookup, principal, amount) {
  const pid = principalToText(principal);
  const info = tokenLookup[pid];
  return formatAmount(amount, info?.decimals ?? 8, info?.symbol ?? pid);
}

function optPrincipal(val) {
  if (!val || (Array.isArray(val) && val.length === 0)) return null;
  if (Array.isArray(val)) return val[0];
  return val;
}

function optNat(val) {
  if (val === null || val === undefined) return null;
  if (Array.isArray(val)) return val.length > 0 ? val[0] : null;
  return val;
}

function optText(val) {
  if (val === null || val === undefined) return null;
  if (Array.isArray(val)) return val.length > 0 ? val[0] : null;
  return val;
}

// ============================================
// MAIN SERIALIZER
// ============================================

export async function serializeBotState(bot) {
  const lines = [];
  function ln(text = '') { lines.push(text); }
  function comment(text) { ln(`# ${text}`); }

  // ---- Fetch all state in parallel ----
  const [
    registry, pausedTokens, frozenTokens,
    enabledDexes, supportedDexes,
    choreStatuses, choreInstances,
    allPurseAllocations,
    cbEnabled, cbRules,
    loggingSettings, choreLoggingOverrides,
    priceStaleness, metadataStaleness, priceHistoryMaxSize,
    lastKnownPrices,
    eventSubscriptions, eventReactions,
    version,
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
    bot.getLastKnownPrices(),
    bot.getEventSubscriptions(),
    bot.getEventReactions(),
    bot.getVersion(),
  ]);

  // Fetch default slippage/impact via enabled dexes info
  let defaultSlippage, defaultMaxPriceImpact;
  try {
    // These are available as separate getters
    const [slipBps, impBps] = await Promise.all([
      bot.setDefaultSlippage ? null : null, // We don't have a getter; infer from supportedDexes or skip
    ]);
  } catch (_) { /* ignore */ }

  const tokenLookup = buildTokenLookup(registry);
  const pausedSet = new Set(pausedTokens.map(p => principalToText(p)));
  const frozenSet = new Set(frozenTokens.map(p => principalToText(p)));
  const enabledDexSet = new Set(enabledDexes.map(Number));

  // Price lookup: "token1-token2" -> priceE8s
  const priceLookup = {};
  for (const p of lastKnownPrices) {
    const key = `${principalToText(p[1]?.inputToken || p[0])}`; // adapt to shape
    // Prices come as [(Text, CachedPrice)]
    if (p[1] && p[1].quote) {
      priceLookup[p[0]] = p[1].quote;
    }
  }

  // ---- Fetch per-chore data ----
  const choreInstanceMap = new Map();
  for (const [id, info] of choreInstances) {
    choreInstanceMap.set(id, info);
  }

  const perChoreData = {};
  const fetchPromises = [];
  for (const [id, info] of choreInstances) {
    const choreType = info.typeId;
    perChoreData[id] = { info, type: choreType };

    if (choreType === 'trade') {
      fetchPromises.push(
        Promise.all([
          bot.getTradeActions(id),
          bot.getTradeFallbackRouteTokens(id),
        ]).then(([actions, fallbackTokens]) => {
          perChoreData[id].actions = actions;
          perChoreData[id].fallbackTokens = fallbackTokens;
        })
      );
    } else if (choreType === 'move-funds') {
      fetchPromises.push(
        bot.getMoveFundsActions(id).then(actions => {
          perChoreData[id].actions = actions;
        })
      );
    } else if (choreType === 'rebalance') {
      fetchPromises.push(
        Promise.all([
          bot.getRebalanceTargets(id),
          bot.getRebalanceSettings(id),
        ]).then(([targets, settings]) => {
          perChoreData[id].targets = targets;
          perChoreData[id].settings = settings;
        })
      );
    } else if (choreType === 'distribute-funds') {
      fetchPromises.push(
        bot.getDistributionLists(id).then(lists => {
          perChoreData[id].distributions = lists;
        })
      );
    }

    // Fetch purse trading override for every chore
    fetchPromises.push(
      bot.getTradingPurseId(id).then(purseId => {
        perChoreData[id].tradingPurseId = optText(purseId);
      }).catch(() => { perChoreData[id].tradingPurseId = null; })
    );
  }
  await Promise.all(fetchPromises);

  // ---- Header ----
  ln('# ==========================================');
  ln('# Sneed Trading Bot Configuration Export');
  ln(`# Exported: ${new Date().toISOString()}`);
  ln(`# Version: ${version.major}.${version.minor}.${version.patch}`);
  ln('# ==========================================');
  ln();

  // ---- Token Registry ----
  comment('---- Token Registry ----');
  for (const entry of registry) {
    const pid = principalToText(entry.ledgerCanisterId);
    const paused = pausedSet.has(pid);
    const frozen = frozenSet.has(pid);
    const statusParts = [];
    if (paused) statusParts.push('PAUSED');
    if (frozen) statusParts.push('FROZEN');
    const statusStr = statusParts.length > 0 ? ` | ${statusParts.join(', ')}` : '';
    comment(`${entry.symbol}${statusStr}`);
    ln(`ensure token ${entry.symbol} {`);
    ln(`  ledger: "${pid}"`);
    ln(`  symbol: "${entry.symbol}"`);
    ln(`  decimals: ${entry.decimals}`);
    ln(`  fee: ${formatAmount(entry.fee, entry.decimals, entry.symbol)}`);
    ln('}');
    ln();
  }

  // ---- Token Pause/Freeze State ----
  const hasPauseFreeze = pausedTokens.length > 0 || frozenTokens.length > 0;
  if (hasPauseFreeze) {
    comment('---- Token Pause/Freeze State ----');
    for (const p of pausedTokens) {
      ln(`set token ${sym(tokenLookup, p)} paused: true`);
    }
    for (const f of frozenTokens) {
      ln(`set token ${sym(tokenLookup, f)} frozen: true`);
    }
    ln();
  }

  // ---- DEX Settings ----
  comment('---- DEX Settings ----');
  for (const dex of supportedDexes) {
    const name = DEX_NAMES[Number(dex.id)] || `DEX-${dex.id}`;
    ln(`set dex ${name} enabled: ${dex.enabled}`);
  }
  ln();

  // ---- Global Settings ----
  comment('---- Global Settings ----');
  ln(`set circuit_breaker_enabled: ${cbEnabled}`);
  ln(`set price_staleness: ${formatDuration(Number(priceStaleness))}`);
  ln(`set metadata_staleness: ${formatDuration(Number(metadataStaleness))}`);
  ln(`set price_history_max_size: ${Number(priceHistoryMaxSize)}`);
  ln();

  // ---- Logging ----
  comment('---- Logging ----');
  ln(`set logging trade_log: ${loggingSettings.tradeLogEnabled}`);
  ln(`set logging portfolio_log: ${loggingSettings.portfolioLogEnabled}`);
  ln(`set logging max_trade_log_entries: ${Number(loggingSettings.maxTradeLogEntries)}`);
  ln(`set logging max_portfolio_log_entries: ${Number(loggingSettings.maxPortfolioLogEntries)}`);
  ln();

  // ---- Chore Instances ----
  comment('---- Chore Instances ----');
  const choreStatusMap = new Map();
  for (const cs of choreStatuses) {
    choreStatusMap.set(cs.choreId, cs);
  }

  for (const [id, info] of choreInstances) {
    const cs = choreStatusMap.get(id);
    const status = cs ? (cs.enabled ? (cs.paused ? 'paused' : 'running') : 'stopped') : 'stopped';
    const statsLine = cs
      ? `Status: ${status} | Runs: ${cs.totalRunCount} (${cs.totalSuccessCount} ok, ${cs.totalFailureCount} fail)` +
        (cs.lastCompletedRunAt ? ` | Last: ${formatTimestamp(cs.lastCompletedRunAt)}` : '')
      : `Status: ${status}`;
    comment(statsLine);
    ln(`ensure chore "${id}" {`);
    ln(`  type: ${info.typeId}`);
    ln(`  label: "${info.instanceLabel}"`);
    ln('}');
    if (cs) {
      ln(`set chore "${id}" interval: ${formatDuration(Number(cs.intervalSeconds))}`);
      if (cs.maxIntervalSeconds && cs.maxIntervalSeconds.length > 0) {
        ln(`set chore "${id}" max_interval: ${formatDuration(Number(cs.maxIntervalSeconds[0]))}`);
      }
      ln(`set chore "${id}" task_timeout: ${formatDuration(Number(cs.taskTimeoutSeconds))}`);
      ln(`set chore "${id}" status: ${status}`);
    }
    ln();
  }

  // ---- Per-Chore Configuration ----
  for (const [id, data] of Object.entries(perChoreData)) {
    if (data.type === 'trade' && data.actions) {
      comment(`---- Trade Actions in "${id}" ----`);
      for (const action of data.actions) {
        serializeAction(lines, action, tokenLookup, id);
      }
      if (data.fallbackTokens && data.fallbackTokens.length > 0) {
        const tokenList = data.fallbackTokens.map(t => sym(tokenLookup, t)).join(', ');
        ln(`set trade "${id}" fallback_route_tokens: [${tokenList}]`);
        ln();
      }
    }

    if (data.type === 'move-funds' && data.actions) {
      comment(`---- Move Funds Actions in "${id}" ----`);
      for (const action of data.actions) {
        serializeAction(lines, action, tokenLookup, id);
      }
    }

    if (data.type === 'rebalance' && data.settings) {
      comment(`---- Rebalance Configuration for "${id}" ----`);
      const s = data.settings;
      ln(`set rebalance "${id}" denomination: ${sym(tokenLookup, s.denominationToken)}`);
      ln(`set rebalance "${id}" max_trade_size: ${fmtAmt(tokenLookup, s.denominationToken, s.maxTradeSize)}`);
      ln(`set rebalance "${id}" min_trade_size: ${fmtAmt(tokenLookup, s.denominationToken, s.minTradeSize)}`);
      ln(`set rebalance "${id}" threshold: ${Number(s.thresholdBps)} bps`);
      ln(`set rebalance "${id}" max_slippage: ${Number(s.maxSlippageBps)} bps`);
      ln(`set rebalance "${id}" max_price_impact: ${Number(s.maxPriceImpactBps)} bps`);
      if (s.fallbackRouteTokens && s.fallbackRouteTokens.length > 0) {
        const tokenList = s.fallbackRouteTokens.map(t => sym(tokenLookup, t)).join(', ');
        ln(`set rebalance "${id}" fallback_route_tokens: [${tokenList}]`);
      }
      ln();

      if (data.targets) {
        for (const target of data.targets) {
          const tsym = sym(tokenLookup, target.token);
          const pct = (Number(target.targetBps) / 100).toFixed(1);
          comment(`${tsym}: ${pct}%${target.paused ? ' (paused)' : ''}`);
          ln(`ensure rebalance_target ${tsym} in "${id}" {`);
          ln(`  target: ${Number(target.targetBps)} bps`);
          ln(`  paused: ${target.paused}`);
          ln('}');
          ln();
        }
      }
    }

    if (data.type === 'distribute-funds' && data.distributions) {
      comment(`---- Distribution Lists in "${id}" ----`);
      for (const list of data.distributions) {
        ln(`ensure distribution "${list.name}" in "${id}" {`);
        ln(`  token: ${sym(tokenLookup, list.tokenLedgerCanisterId)}`);
        ln(`  threshold: ${fmtAmt(tokenLookup, list.tokenLedgerCanisterId, list.thresholdAmount)}`);
        ln(`  max_amount: ${fmtAmt(tokenLookup, list.tokenLedgerCanisterId, list.maxDistributionAmount)}`);
        ln(`  min_amount: ${fmtAmt(tokenLookup, list.tokenLedgerCanisterId, list.minDistributionAmount)}`);
        ln(`  amount_mode: ${AMOUNT_MODE_NAMES[Number(list.amountMode)] || 'range'}`);
        const bp = optNat(list.balancePercent);
        if (bp !== null) ln(`  balance_percent: ${Number(bp)} bps`);
        const sp = optText(list.sourcePurseId);
        ln(`  source_purse: ${sp ? `"${sp}"` : 'none'}`);
        if (list.targets && list.targets.length > 0) {
          ln('  targets: [');
          for (const t of list.targets) {
            const choreId = optText(t.choreInstanceId);
            if (choreId) {
              const share = optNat(t.basisPoints);
              ln(`    { purse: "${choreId}", share: ${share !== null ? `${Number(share)} bps` : 'auto'} }`);
            } else {
              const owner = principalToText(t.account.owner);
              const share = optNat(t.basisPoints);
              ln(`    { account: "${owner}", share: ${share !== null ? `${Number(share)} bps` : 'auto'} }`);
            }
          }
          ln('  ]');
        }
        ln('}');
        ln();
      }
    }
  }

  // ---- Circuit Breaker Rules ----
  if (cbRules.length > 0) {
    comment('---- Circuit Breaker Rules ----');
    for (const rule of cbRules) {
      serializeCBRule(lines, rule, tokenLookup);
    }
  }

  // ---- Purse Configuration ----
  if (allPurseAllocations.length > 0) {
    comment('---- Purse Configuration ----');
    for (const purse of allPurseAllocations) {
      const balDesc = purse.balances.map(b => fmtAmt(tokenLookup, b.token, b.balance)).join(', ');
      if (balDesc) comment(`Purse "${purse.instanceId}" balances: ${balDesc}`);
      ln(`set purse "${purse.instanceId}" enabled: ${purse.enabled}`);
      const td = perChoreData[purse.instanceId]?.tradingPurseId;
      if (td) ln(`set purse "${purse.instanceId}" trading_purse: "${td}"`);
    }
    ln();
  }

  // ---- Event System ----
  if (eventSubscriptions.length > 0 || eventReactions.length > 0) {
    comment('---- Event System ----');

    for (const sub of eventSubscriptions) {
      const source = principalToText(sub.sourceBotCanisterId);
      const types = sub.eventTypeIds.map(Number).join(', ');
      comment(`Subscription #${sub.id} - enabled: ${sub.enabled}`);
      ln(`ensure event_subscription to "${source}" {`);
      ln(`  event_types: [${types}]`);
      ln('}');
      ln();
    }

    for (const reaction of eventReactions) {
      const trigCount = Number(reaction.triggerCount || 0);
      const lastTrig = reaction.lastTriggeredAt ? formatTimestamp(optNat(reaction.lastTriggeredAt)) : 'never';
      comment(`Triggers: ${trigCount} | Last: ${lastTrig}`);
      ln(`ensure event_reaction "${reaction.name}" {`);
      ln(`  enabled: ${reaction.enabled}`);
      // Find subscription source principal
      const sub = eventSubscriptions.find(s => Number(s.id) === Number(reaction.subscriptionId));
      if (sub) {
        ln(`  subscription: "${principalToText(sub.sourceBotCanisterId)}"`);
      } else {
        ln(`  subscription_id: ${Number(reaction.subscriptionId)}`);
      }
      ln(`  event_type: ${Number(reaction.eventTypeId)}`);
      ln(`  action: ${Number(reaction.reactionActionId)}`);
      if (reaction.actionParams && reaction.actionParams.length > 0) {
        ln('  action_params: {');
        for (const [k, v] of reaction.actionParams) {
          ln(`    ${k}: "${v}"`);
        }
        ln('  }');
      }
      if (reaction.conditions && reaction.conditions.length > 0) {
        ln('  conditions: [');
        for (const c of reaction.conditions) {
          ln(`    { key: "${c.dataKey}", op: ${EVENT_CONDITION_OP[Number(c.operator)] || c.operator}, value: "${c.value}" }`);
        }
        ln('  ]');
      }
      const cd = optNat(reaction.cooldownSeconds);
      if (cd !== null) ln(`  cooldown: ${formatDuration(Number(cd))}`);
      ln('}');
      ln();
    }
  }

  // ---- Per-Chore Logging Overrides ----
  if (choreLoggingOverrides.length > 0) {
    comment('---- Per-Chore Logging Overrides ----');
    for (const [choreId, overrides] of choreLoggingOverrides) {
      const tl = optNat(overrides.tradeLogEnabled);
      const pl = optNat(overrides.portfolioLogEnabled);
      if (tl !== null) ln(`set chore_logging "${choreId}" trade_log: ${tl}`);
      if (pl !== null) ln(`set chore_logging "${choreId}" portfolio_log: ${pl}`);
    }
    ln();
  }

  return lines.join('\n');
}

// ---- Action serialization helper ----
function serializeAction(lines, action, tokenLookup, choreId) {
  const ln = (t = '') => lines.push(t);
  const typeName = ACTION_TYPE_NAMES[Number(action.actionType)] || `type_${action.actionType}`;
  const inputSym = sym(tokenLookup, action.inputToken);
  const outputSym = action.outputToken && optPrincipal(action.outputToken)
    ? sym(tokenLookup, optPrincipal(action.outputToken)) : null;

  // Stats comment
  const execCount = Number(action.executionCount);
  const cumIn = action.cumulativeInputSpent;
  const cumOut = action.cumulativeOutputReceived;
  const lastExec = action.lastExecutedAt ? formatTimestamp(optNat(action.lastExecutedAt)) : 'never';
  const statsLine = `Executions: ${execCount} | Last: ${lastExec}` +
    (cumIn > 0 ? ` | Spent: ${fmtAmt(tokenLookup, action.inputToken, cumIn)}` : '') +
    (cumOut > 0 && outputSym ? ` → Received: ${fmtAmt(tokenLookup, optPrincipal(action.outputToken), cumOut)}` : '');
  ln(`# ${statsLine}`);

  const actionKey = action.key || `action-${action.id}`;
  ln(`ensure action "${actionKey}" in "${choreId}" {`);
  ln(`  type: ${typeName}`);
  ln(`  enabled: ${action.enabled}`);
  ln(`  input: ${inputSym}`);
  if (outputSym) ln(`  output: ${outputSym}`);
  ln(`  min_amount: ${fmtAmt(tokenLookup, action.inputToken, action.minAmount)}`);
  ln(`  max_amount: ${fmtAmt(tokenLookup, action.inputToken, action.maxAmount)}`);
  ln(`  amount_mode: ${AMOUNT_MODE_NAMES[Number(action.amountMode)] || 'range'}`);
  const bp = optNat(action.balancePercent);
  if (bp !== null) ln(`  balance_percent: ${Number(bp)} bps`);

  if (Number(action.actionType) === 0) {
    const pd = optNat(action.preferredDex);
    ln(`  preferred_dex: ${pd !== null ? (DEX_NAMES[Number(pd)] || pd) : 'auto'}`);
  }

  if (Number(action.actionType) === 1) {
    const tp = optText(action.targetPurseId);
    if (tp) ln(`  target_purse: "${tp}"`);
  }
  if (Number(action.actionType) === 2 || Number(action.actionType) === 3) {
    const sp = optText(action.sourcePurseId);
    if (sp) ln(`  source_purse: "${sp}"`);
  }
  if (Number(action.actionType) === 3) {
    const dstOwner = optPrincipal(action.destinationOwner);
    if (dstOwner) ln(`  destination: "${principalToText(dstOwner)}"`);
  }

  // Conditions
  const minBal = optNat(action.minBalance);
  const maxBal = optNat(action.maxBalance);
  const balDenom = optPrincipal(action.balanceDenominationToken);
  if (minBal !== null) ln(`  min_balance: ${balDenom ? fmtAmt(tokenLookup, balDenom, minBal) : Number(minBal)}`);
  if (maxBal !== null) ln(`  max_balance: ${balDenom ? fmtAmt(tokenLookup, balDenom, maxBal) : Number(maxBal)}`);
  if (balDenom) ln(`  balance_denomination: ${sym(tokenLookup, balDenom)}`);

  if (Number(action.actionType) === 0) {
    const minP = optNat(action.minPrice);
    const maxP = optNat(action.maxPrice);
    const priceDenom = optPrincipal(action.priceDenominationToken);
    if (minP !== null) ln(`  min_price: ${priceDenom ? fmtAmt(tokenLookup, priceDenom, minP) : Number(minP)}`);
    if (maxP !== null) ln(`  max_price: ${priceDenom ? fmtAmt(tokenLookup, priceDenom, maxP) : Number(maxP)}`);
    if (priceDenom) ln(`  price_denomination: ${sym(tokenLookup, priceDenom)}`);
    const mpi = optNat(action.maxPriceImpactBps);
    const msl = optNat(action.maxSlippageBps);
    if (mpi !== null) ln(`  max_price_impact: ${Number(mpi)} bps`);
    if (msl !== null) ln(`  max_slippage: ${Number(msl)} bps`);
    const tsz = optPrincipal(action.tradeSizeDenominationToken);
    if (tsz) ln(`  trade_size_denomination: ${sym(tokenLookup, tsz)}`);
  }

  // Frequency
  const minF = optNat(action.minFrequencySeconds);
  const maxF = optNat(action.maxFrequencySeconds);
  if (minF !== null) ln(`  min_frequency: ${formatDuration(Number(minF))}`);
  if (maxF !== null) ln(`  max_frequency: ${formatDuration(Number(maxF))}`);

  // Trailing stop (trade only)
  if (Number(action.actionType) === 0) {
    const tsBps = optNat(action.trailingStopBps);
    if (tsBps !== null) {
      ln(`  trailing_stop: ${Number(tsBps)} bps`);
      const tsDir = optNat(action.trailingStopDirection);
      if (tsDir !== null) ln(`  trailing_stop_direction: ${TRAILING_STOP_DIR[Number(tsDir)] || tsDir}`);
      const tsReset = optNat(action.trailingStopResetOnExec);
      if (tsReset !== null) ln(`  trailing_stop_reset: ${TRAILING_STOP_RESET[Number(tsReset)] || tsReset}`);
    }
  }

  // Limits
  ln(`  halt_chore_after: ${action.haltChoreAfterExecution}`);
  const mci = optNat(action.maxCumulativeInput);
  const mco = optNat(action.maxCumulativeOutput);
  const mex = optNat(action.maxExecutions);
  if (mci !== null) ln(`  max_cumulative_input: ${fmtAmt(tokenLookup, action.inputToken, mci)}`);
  if (mco !== null && outputSym) ln(`  max_cumulative_output: ${fmtAmt(tokenLookup, optPrincipal(action.outputToken), mco)}`);
  if (mex !== null) ln(`  max_executions: ${Number(mex)}`);

  ln('}');
  ln();
}

// ---- Circuit breaker serialization ----
function serializeCBRule(lines, rule, tokenLookup) {
  const ln = (t = '') => lines.push(t);
  ln(`ensure circuit_breaker "${rule.name}" {`);
  ln(`  enabled: ${rule.enabled}`);

  const topOp = Number(rule.topLevelOperator) === 0 ? 'ALL' : 'ANY';
  ln(`  when ${topOp} {`);
  for (const cond of rule.conditions) {
    serializeCBCondition(lines, cond, tokenLookup, 2);
  }
  ln('  }');

  ln('  then {');
  for (const action of rule.actions) {
    serializeCBAction(lines, action, tokenLookup, 2);
  }
  ln('  }');
  ln('}');
  ln();
}

function serializeCBCondition(lines, cond, tokenLookup, indentLevel) {
  const ln = (t) => lines.push('  '.repeat(indentLevel) + t);
  const condType = Number(cond.conditionType);

  if (condType === 3 || condType === 4) {
    const groupOp = condType === 3 ? 'ALL' : 'ANY';
    ln(`${groupOp} {`);
    for (const child of (cond.children || [])) {
      serializeCBCondition(lines, child, tokenLookup, indentLevel + 1);
    }
    ln('}');
    return;
  }

  const op = Number(cond.operator);
  if (condType === 0) {
    const t1 = sym(tokenLookup, optPrincipal(cond.priceToken1));
    const t2 = sym(tokenLookup, optPrincipal(cond.priceToken2));
    if (op === 4) {
      const dir = CB_CHANGE_DIR[Number(optNat(cond.changeDirection))] || 'either';
      const bps = Number(optNat(cond.changePercentBps) || 0);
      const period = formatDuration(Number(optNat(cond.changePeriodSeconds) || 0));
      ln(`price ${t1}/${t2} changed ${dir} ${bps} bps in ${period}`);
    } else {
      const opSym = op === 0 ? '>' : op === 1 ? '<' : CB_OPERATOR[op];
      const thresh = optNat(cond.threshold);
      ln(`price ${t1}/${t2} ${opSym} ${thresh !== null ? Number(thresh) : '?'}`);
    }
  } else if (condType === 2) {
    const token = sym(tokenLookup, optPrincipal(cond.balanceToken));
    const purse = optText(cond.balanceChoreInstanceId) || 'main';
    const opSym = op === 0 ? '>' : op === 1 ? '<' : CB_OPERATOR[op];
    const thresh = optNat(cond.threshold);
    ln(`balance ${token} in ${purse === 'main' ? 'main' : `"${purse}"`} ${opSym} ${thresh !== null ? Number(thresh) : '?'}`);
  } else if (condType === 1) {
    ln(`value ... (complex value condition)`);
  }
}

function serializeCBAction(lines, action, tokenLookup, indentLevel) {
  const ln = (t) => lines.push('  '.repeat(indentLevel) + t);
  const actionType = Number(action.actionType);

  switch (actionType) {
    case 0: ln(`pause token ${sym(tokenLookup, optPrincipal(action.token))} in "${optText(action.choreInstanceId)}"`); break;
    case 1: ln(`pause token ${sym(tokenLookup, optPrincipal(action.token))}`); break;
    case 2: ln(`freeze token ${sym(tokenLookup, optPrincipal(action.token))}`); break;
    case 3: ln(`stop chore "${optText(action.choreInstanceId)}"`); break;
    case 4: ln(`pause chore "${optText(action.choreInstanceId)}"`); break;
    case 5: ln(`stop all ${optText(action.choreTypeId)} chores`); break;
    case 6: ln(`pause all ${optText(action.choreTypeId)} chores`); break;
    case 7: ln('stop all chores'); break;
    case 8: ln('pause all chores'); break;
    case 9: ln(`start chore "${optText(action.choreInstanceId)}"`); break;
    case 10: ln(`start all ${optText(action.choreTypeId)} chores`); break;
    case 11: ln('start all chores'); break;
    default: ln(`# Unknown CB action type: ${actionType}`);
  }
}
