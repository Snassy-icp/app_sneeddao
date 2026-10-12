// Health page configuration: thresholds the checks compare against. Stored per
// browser; the defaults are what the DAO considers healthy today.
export const STORAGE_KEY = 'sneed_health_config_v1';

export const DEFAULT_CONFIG = {
    cyclesOrangeT: 2,          // warn below this many T cycles
    cyclesRedT: 1,             // fail below this many T cycles
    ignoreEmptyCanisters: true, // skip registered canisters with no code (frozen and deleted dapps)
    memoryOrangePct: 60,       // warn when a canister uses this much of its memory limit
    memoryRedPct: 80,          // fail when a canister uses this much of its memory limit
    archiveCyclesOrangeT: 0.7, // ICRC-3 archives are topped up by their parent; smaller margins
    archiveCyclesRedT: 0.3,
    rllSlackHours: 6,          // the RLL may run this long past its schedule before it counts as late
    rllFailPeriods: 2,         // no distribution for this many periods is a failure (one period is a warning)
    minNeuronDissolveDays: 720, // the DAO's ICP neuron must stay locked at least this long (it is a 2-year neuron today)
    vectorActivityDays: 14,    // the ICP neuron vector must have logged a successful operation this recently
    buybackSlackFactor: 2,     // a buy is late after this many buy intervals
    indexLagBlocks: 100,       // SNS index may trail the ledger by this many blocks
    proposalWindowDays: 30,    // failed proposals inside this window are reported
    minTreasuryIcp: 1,         // warn when the ICP treasury holds less than this
    callTimeoutSec: 30,        // per-call timeout
};

export const CONFIG_FIELDS = [
    ['cyclesOrangeT', 'Cycles warning (T)', 'Canisters below this many trillion cycles show orange'],
    ['cyclesRedT', 'Cycles failure (T)', 'Canisters below this many trillion cycles show red'],
    ['ignoreEmptyCanisters', 'Ignore empty canisters', 'Skip registered canisters that have no code (frozen and deleted dapps) instead of failing them', 'bool'],
    ['memoryOrangePct', 'Memory warning (%)', 'Warn when a canister uses this much of its memory limit'],
    ['memoryRedPct', 'Memory failure (%)', 'Fail when a canister uses this much of its memory limit'],
    ['archiveCyclesOrangeT', 'Archive cycles warning (T)', 'ICRC-3 archive canisters, topped up by Sneed Lock'],
    ['archiveCyclesRedT', 'Archive cycles failure (T)', ''],
    ['rllSlackHours', 'RLL slack (hours)', 'How long past its schedule the rewards loop may run before it is late'],
    ['rllFailPeriods', 'RLL failure (periods)', 'Missing this many distribution periods is a failure'],
    ['minNeuronDissolveDays', 'Neuron dissolve delay (days)', 'Warn when the DAO ICP neuron is locked for less than this'],
    ['vectorActivityDays', 'Vector activity (days)', 'The ICP neuron vector must have a successful operation this recent'],
    ['buybackSlackFactor', 'Buyback slack (x interval)', 'A buy is late after this many buy intervals without one'],
    ['indexLagBlocks', 'Index lag (blocks)', 'SNEED index may trail the ledger by this many blocks'],
    ['proposalWindowDays', 'Proposal window (days)', 'Failed proposals within this window are reported'],
    ['minTreasuryIcp', 'Minimum treasury ICP', 'Warn when the ICP treasury holds less than this'],
    ['callTimeoutSec', 'Call timeout (s)', 'A check that takes longer than this fails'],
];

export function loadConfig() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_CONFIG };
        const parsed = JSON.parse(raw);
        const out = { ...DEFAULT_CONFIG };
        for (const [k, , , type] of CONFIG_FIELDS) {
            if (type === 'bool') { if (typeof parsed[k] === 'boolean') out[k] = parsed[k]; }
            else if (typeof parsed[k] === 'number' && Number.isFinite(parsed[k])) out[k] = parsed[k];
        }
        return out;
    } catch { return { ...DEFAULT_CONFIG }; }
}

export function saveConfig(config) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch { /* private window */ }
}
