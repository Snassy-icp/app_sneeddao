// Staking journal. Creating a neuron is two steps: a transfer to the governance canister's neuron
// subaccount (derived from controller + memo), then a claim (SNS ClaimOrRefresh by
// MemoAndController, or the ICP staking bot's claimNeuronFromDeposit(memo)). If the page dies
// between the two, the tokens sit in that subaccount and only the memo can get them into a
// neuron. So every staking flow writes a record here BEFORE the transfer, adds the block when the
// ledger answers, and removes it only after a successful claim. PendingStakesNotice lists what is
// left with a "Finish staking" button.
//
// Record: { id, kind: 'sns'|'icp_bot', ledger, governance?, bot?, memo, subaccount (hex),
//           amount, owner, block?, dissolveDelaySeconds?, createdMs, lastError? }
// Numbers are strings (BigInt-safe). Storage errors are swallowed: the journal is best effort.

export const STAKE_JOURNAL_KEY = 'sneed_pending_stakes_v1';
export const PENDING_STAKES_EVENT = 'sneed:pending-stakes-changed';

function storage() {
    try { return typeof window !== 'undefined' ? window.localStorage : null; } catch (_) { return null; }
}

function readAll() {
    try {
        const raw = storage()?.getItem(STAKE_JOURNAL_KEY);
        const v = raw ? JSON.parse(raw) : {};
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (_) { return {}; }
}

function writeAll(all) {
    try { storage()?.setItem(STAKE_JOURNAL_KEY, JSON.stringify(all)); } catch (_) { /* full or blocked */ }
    try { if (typeof window !== 'undefined') window.dispatchEvent(new Event(PENDING_STAKES_EVENT)); } catch (_) {}
}

const hex = (bytes) => Array.from(bytes || []).map((b) => Number(b).toString(16).padStart(2, '0')).join('');
/** Raw subaccount bytes (Uint8Array or number[]) to hex. */
export const subaccountToHex = (bytes) => hex(bytes);
export const hexToBytes = (h) => Uint8Array.from((String(h).match(/.{2}/g) || []).map((x) => parseInt(x, 16)));

/** Start a journal entry before the transfer. Returns its id. */
export function journalStake({ kind, ledger, governance = null, bot = null, memo, subaccount, amount, owner, dissolveDelaySeconds = null }) {
    const id = `${kind}:${String(governance || bot)}:${String(memo)}`;
    const all = readAll();
    all[id] = {
        id, kind,
        ledger: String(ledger),
        governance: governance ? String(governance) : null,
        bot: bot ? String(bot) : null,
        memo: String(memo),
        subaccount: typeof subaccount === 'string' ? subaccount : subaccountToHex(subaccount),
        amount: String(amount),
        owner: owner ? String(owner) : null,
        dissolveDelaySeconds: dissolveDelaySeconds != null ? String(dissolveDelaySeconds) : null,
        block: null,
        createdMs: Date.now(),
        lastError: null,
    };
    writeAll(all);
    return id;
}

/** Merge fields into an entry (e.g. { block } after the transfer, { lastError } after a failed claim). */
export function updateStake(id, patch) {
    const all = readAll();
    if (!all[id]) return;
    all[id] = { ...all[id], ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, typeof v === 'bigint' ? String(v) : v])) };
    writeAll(all);
}

/** The claim succeeded, or the transfer definitely did not happen. */
export function removeStake(id) {
    const all = readAll();
    if (!(id in all)) return;
    delete all[id];
    writeAll(all);
}

export function loadPendingStakes() {
    return Object.values(readAll()).sort((a, b) => (a.createdMs || 0) - (b.createdMs || 0));
}
