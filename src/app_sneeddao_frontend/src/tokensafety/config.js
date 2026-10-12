// Token safety page configuration: thresholds the rating compares against.
// Stored per browser; the defaults are what the DAO considers reasonable.
export const STORAGE_KEY = 'sneed_token_safety_config_v1';

export const DEFAULT_CONFIG = {
    maxScanBlocks: 500000,     // reconstruct holders from the block log only up to this many blocks
    topHolderWarnPct: 20,      // largest unlocked holder above this share of supply: warning
    topHolderFailPct: 50,      // ... above this share: failure
    top10WarnPct: 60,          // ten largest unlocked holders above this share: warning
    top10FailPct: 90,          // ... above this share: failure
    minHolders: 100,           // fewer holders than this: warning
    lockedSupplyGoodPct: 20,   // share of supply locked in Sneed Lock that counts as good
    minLockDays: 90,           // a lock must have at least this long left to count
    cliffWindowDays: 30,       // unlocks within this window are reported
    cliffWarnPct: 10,          // ... when they exceed this share of supply
    liquidityLockedGoodPct: 50, // share of the main pool's active liquidity that is locked: good above this
    minLiquidityUsd: 1000,     // a pool thinner than this cannot really be traded: warning whatever the market cap
    liquidityGoodPctOfMcap: 5, // depth at or above this share of market cap passes
    deepLiquidityUsd: 50000,   // depth at or above this passes whatever the share
    cyclesOrangeT: 2,          // warn below this many T cycles (when observable)
    cyclesRedT: 0.5,           // fail below this many T cycles
    callTimeoutSec: 45,
};

export const CONFIG_FIELDS = [
    ['maxScanBlocks', 'Max blocks to scan', 'Holders are rebuilt from the ledger log in the browser; larger logs are skipped'],
    ['topHolderWarnPct', 'Largest holder warning (%)', 'Largest unlocked, untagged holder above this share of supply'],
    ['topHolderFailPct', 'Largest holder failure (%)', ''],
    ['top10WarnPct', 'Top 10 warning (%)', 'Ten largest unlocked, untagged holders above this share of supply'],
    ['top10FailPct', 'Top 10 failure (%)', ''],
    ['minHolders', 'Minimum holders', 'Fewer accounts with a balance than this is a warning'],
    ['lockedSupplyGoodPct', 'Locked supply good (%)', 'Share of supply locked in Sneed Lock that earns a pass'],
    ['minLockDays', 'Minimum lock (days)', 'Locks with less time left do not count'],
    ['cliffWindowDays', 'Cliff window (days)', 'Unlocks inside this window are reported'],
    ['cliffWarnPct', 'Cliff warning (%)', 'Unlocks inside the window above this share of supply'],
    ['liquidityLockedGoodPct', 'Locked liquidity good (%)', 'Share of the main pool\'s active liquidity locked in Sneed Lock that earns a pass'],
    ['minLiquidityUsd', 'Minimum liquidity (USD)', 'A main pool thinner than this is a warning whatever the market cap'],
    ['liquidityGoodPctOfMcap', 'Good depth (% of market cap)', 'Main pool depth at or above this share of market cap passes'],
    ['deepLiquidityUsd', 'Deep liquidity (USD)', 'Main pool depth at or above this passes whatever the share'],
    ['cyclesOrangeT', 'Cycles warning (T)', 'When cycles are observable'],
    ['cyclesRedT', 'Cycles failure (T)', ''],
    ['callTimeoutSec', 'Call timeout (s)', ''],
];

export function loadConfig() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_CONFIG };
        const parsed = JSON.parse(raw);
        const out = { ...DEFAULT_CONFIG };
        for (const [k] of CONFIG_FIELDS) if (typeof parsed[k] === 'number' && Number.isFinite(parsed[k])) out[k] = parsed[k];
        return out;
    } catch { return { ...DEFAULT_CONFIG }; }
}

export function saveConfig(config) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch { /* private window */ }
}
