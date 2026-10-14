// Sneed Lock v2 time helpers (spec/sneed_lock_v2.md, section 1).
//
// A lock's `expiry` is its effective unlock time. A lock with a dissolve delay that is
// not dissolving carries the largest Nat64 ("not before it dissolves"): shown as a date
// it reads as the year 2554, and a countdown runs for centuries. Everything that shows
// a lock's expiry goes through these instead.

export const NEVER_NS = 18_446_744_073_709_551_615n;

const toBig = (v) => (typeof v === 'bigint' ? v : BigInt(v ?? 0));

/** True when the lock is held until it has dissolved (no unlock time yet). Accepts ns or a Date. */
export function isUntilDissolved(expiry) {
    if (expiry instanceof Date) return expiry.getTime() >= Number(NEVER_NS / 1_000_000n) - 1;
    return toBig(expiry) >= NEVER_NS;
}

/** A Date for an expiry in ns, or null when the lock is held until it dissolves. */
export function lockExpiryToDate(expiryNs) {
    if (isUntilDissolved(expiryNs)) return null;
    return new Date(Number(toBig(expiryNs) / 1_000_000n));
}

/** "until it dissolves" or the formatted date. `fmt` formats a Date. */
export function lockUntilText(expiry, fmt = (d) => d.toLocaleString()) {
    if (isUntilDissolved(expiry)) return 'until dissolved';
    const d = expiry instanceof Date ? expiry : lockExpiryToDate(expiry);
    return d ? fmt(d) : '';
}

/** A duration in ns as "3d 4h", "45m", "12s". */
export function formatNsDuration(ns) {
    let s = Number(toBig(ns) / 1_000_000_000n);
    if (s <= 0) return '0s';
    const d = Math.floor(s / 86_400); s -= d * 86_400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m && !d) parts.push(`${m}m`);
    if (!d && !h && s) parts.push(`${s}s`);
    return parts.join(' ') || '0s';
}

/**
 * The dissolve state of locks, from the canister's `get_lock_states` (v2). Returns a map
 * lock_id (string) -> LockState, or an empty map when the canister has no such method yet
 * (older build), so callers can always fall back to what `expiry` says.
 */
export async function fetchLockStates(sneedLockActor, lockIds) {
    const out = {};
    const ids = [...new Set(lockIds.map((x) => toBig(x)))];
    try {
        for (let i = 0; i < ids.length; i += 100) {
            const batch = ids.slice(i, i + 100);
            const states = await sneedLockActor.get_lock_states(batch);
            states.forEach((s, j) => { if (s && s[0]) out[batch[j].toString()] = s[0]; });
        }
    } catch (_) { /* older canister without v2 queries */ }
    return out;
}

/** One line for a lock's time rules: "until <date>", or the delay/dissolving story. */
export function describeLockTime(state, fmt = (d) => d.toLocaleString()) {
    if (!state) return '';
    const delay = toBig(state.dissolve_delay);
    if (delay === 0n) return state.locked ? `until ${lockUntilText(state.expiry, fmt)}` : 'unlocked';
    const until = state.dissolving_until?.[0];
    if (until !== undefined) {
        return state.locked ? `dissolving, free ${fmt(lockExpiryToDate(until))}` : `dissolved ${fmt(lockExpiryToDate(until))}`;
    }
    const periodLeft = toBig(state.lock_end) - BigInt(Date.now()) * 1_000_000n;
    return periodLeft > 0n
        ? `locked until ${fmt(lockExpiryToDate(state.lock_end))}, then a ${formatNsDuration(delay)} dissolve delay`
        : `not dissolving (dissolve delay ${formatNsDuration(delay)})`;
}
