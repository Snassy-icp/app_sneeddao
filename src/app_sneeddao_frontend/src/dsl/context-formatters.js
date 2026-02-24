// Formatters for LLM context data — compact, human-readable text for clipboard.

function principalToText(p) {
  if (!p) return '?';
  return typeof p === 'string' ? p : (p.toText ? p.toText() : String(p));
}

function formatTimestamp(nanos) {
  if (!nanos) return '?';
  const ms = Number(BigInt(nanos) / 1_000_000n);
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

function formatAmount(rawAmount, decimals) {
  if (rawAmount === 0n || rawAmount === 0) return '0';
  const d = Number(decimals || 8);
  const divisor = 10 ** d;
  const raw = typeof rawAmount === 'bigint' ? rawAmount : BigInt(rawAmount);
  const whole = raw / BigInt(divisor);
  const frac = raw % BigInt(divisor);
  if (frac === 0n) return `${whole}`;
  const fracStr = frac.toString().padStart(d, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

function optVal(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.length > 0 ? v[0] : null;
  return v;
}

// ---- Token Registry ----

export async function formatTokenRegistry(bot) {
  const registry = await bot.getTokenRegistry();
  if (registry.length === 0) return '# Token Registry (empty)\n';
  const lines = [`# Token Registry (${registry.length} tokens)`];
  for (const t of registry) {
    const pid = principalToText(t.ledgerCanisterId);
    lines.push(`${t.symbol} | ${pid} | decimals: ${t.decimals} | fee: ${t.fee}`);
  }
  return lines.join('\n') + '\n';
}

export function formatSingleToken(entry) {
  const pid = principalToText(entry.ledgerCanisterId);
  return `# Token: ${entry.symbol}\nLedger: ${pid}\nSymbol: ${entry.symbol}\nDecimals: ${entry.decimals}\nFee: ${entry.fee}\n`;
}

// ---- Trade Log ----

const ACTION_TYPE_NAMES = { 0: 'trade', 1: 'fund_purse', 2: 'reclaim', 3: 'send' };

export async function formatTradeLog(bot, limit = 50) {
  const result = await bot.getTradeLog({ startId: [], limit: [limit], offset: [], choreId: [], choreTypeId: [], actionType: [], inputToken: [], outputToken: [], status: [], fromTime: [], toTime: [] });
  const entries = result.entries || [];
  if (entries.length === 0) return '# Trade Log (empty)\n';
  const registry = await bot.getTokenRegistry();
  const symLookup = {};
  for (const t of registry) symLookup[principalToText(t.ledgerCanisterId)] = { symbol: t.symbol, decimals: Number(t.decimals) };

  const sym = (p) => symLookup[principalToText(p)]?.symbol || principalToText(p);
  const dec = (p) => symLookup[principalToText(p)]?.decimals ?? 8;

  const lines = [`# Trade Log (${entries.length} entries, newest first)`];
  for (const e of entries) {
    const time = formatTimestamp(e.timestamp);
    const type = ACTION_TYPE_NAMES[Number(e.actionType)] || `type_${e.actionType}`;
    const input = sym(e.inputToken);
    const output = optVal(e.outputToken) ? sym(optVal(e.outputToken)) : '';
    const pair = output ? `${input} -> ${output}` : input;
    const inAmt = `${formatAmount(e.inputAmount, dec(e.inputToken))} ${input}`;

    let statusStr;
    if (e.status.Success !== undefined) {
      const outAmt = optVal(e.outputAmount);
      statusStr = outAmt && output ? `OK: ${inAmt} -> ${formatAmount(outAmt, dec(optVal(e.outputToken)))} ${output}` : `OK: ${inAmt}`;
    } else if (e.status.Skipped !== undefined) {
      statusStr = `Skipped`;
    } else {
      statusStr = `Failed: ${optVal(e.errorMessage) || '?'}`;
    }

    const chore = optVal(e.choreId) || '-';
    lines.push(`#${e.id} | ${time} | ${type} | ${pair} | ${statusStr} | chore: ${chore}`);
  }
  return lines.join('\n') + '\n';
}

// ---- Bot Log ----

const LOG_LEVEL_NAMES = { Off: 'OFF', Error: 'ERROR', Warning: 'WARN', Info: 'INFO', Debug: 'DEBUG', Trace: 'TRACE' };

function logLevelStr(level) {
  if (!level) return '?';
  for (const [k, v] of Object.entries(LOG_LEVEL_NAMES)) {
    if (level[k] !== undefined) return v;
  }
  return '?';
}

export async function formatBotLog(bot, limit = 50) {
  const result = await bot.getLogs({ minLevel: [], source: [], caller: [], fromTime: [], toTime: [], startId: [], limit: [limit] });
  const entries = result.entries || [];
  if (entries.length === 0) return '# Bot Log (empty)\n';
  const lines = [`# Bot Log (${entries.length} entries, newest first)`];
  for (const e of entries) {
    const time = formatTimestamp(e.timestamp);
    const level = logLevelStr(e.level);
    const tags = e.tags && e.tags.length > 0 ? ' | ' + e.tags.map(([k, v]) => `${k}=${v}`).join(', ') : '';
    lines.push(`[${time}] [${level}] [${e.source}] ${e.message}${tags}`);
  }
  return lines.join('\n') + '\n';
}

// ---- Circuit Breaker Log ----

export async function formatCBLog(bot, limit = 20) {
  const result = await bot.getCircuitBreakerLog({ startId: [], limit: [limit], ruleId: [], fromTime: [], toTime: [] });
  const entries = result.entries || [];
  if (entries.length === 0) return '# Circuit Breaker Log (empty)\n';
  const lines = [`# Circuit Breaker Log (${entries.length} entries)`];
  for (const e of entries) {
    const time = formatTimestamp(e.timestamp);
    const actions = e.actionsTaken.join(', ');
    lines.push(`#${e.id} | ${time} | Rule: "${e.ruleName}" | ${e.conditionSummary} | Actions: ${actions}`);
  }
  return lines.join('\n') + '\n';
}
