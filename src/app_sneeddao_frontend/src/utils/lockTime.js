// Sneed Lock v2 time helpers (spec/sneed_lock_v2.md, section 1).
//
// A lock's `expiry` is its effective unlock time. A lock with a dissolve delay that is
// not dissolving carries the largest Nat64 ("not before it dissolves"): shown as a date
// it reads as the year 2554, and a countdown runs for centuries. Everything that shows
// a lock's expiry goes through these instead.

import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';

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

const nowNs = () => BigInt(Date.now()) * 1_000_000n;

/**
 * The soonest a lock can be free, in ns: its expiry, or for a lock with a dissolve delay that
 * is not dissolving, the end of its lock period (or now, once that is past) plus the delay.
 * For a lock that is not dissolving this moves forward with time once its lock period is over:
 * it is "at the soonest", not a date the lock unlocks by itself. Uses the canister's
 * `earliest_unlock` when it has one (computed the same way).
 */
export function earliestUnlockNs(state) {
    if (!state) return null;
    const delay = toBig(state.dissolve_delay);
    if (delay === 0n || state.dissolving_until?.[0] !== undefined) return toBig(state.expiry);
    const now = nowNs();
    const end = toBig(state.lock_end);
    return (end > now ? end : now) + delay;
}

/** When the lock was created (a Date), or null when Sneed Lock has no record of it. */
export function lockCreatedDate(state) {
    const c = state?.created_at?.[0];
    return c === undefined ? null : new Date(Number(toBig(c) / 1_000_000n));
}

/** "3d 4h" since the lock was created, or null when unknown. */
export function lockAgeText(state) {
    const c = state?.created_at?.[0];
    if (c === undefined) return null;
    const age = nowNs() - toBig(c);
    return age > 0n ? formatNsDuration(age) : '0s';
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
    const soonest = fmt(lockExpiryToDate(earliestUnlockNs(state)));
    const periodLeft = toBig(state.lock_end) - nowNs();
    return periodLeft > 0n
        ? `free ${soonest} at the soonest (lock period until ${fmt(lockExpiryToDate(state.lock_end))}, then a ${formatNsDuration(delay)} dissolve delay)`
        : `not dissolving: free ${formatNsDuration(delay)} after dissolving starts (${soonest} at the soonest)`;
}

// ---- cached, batched lock states for lists of locks -------------------------------
// Cards show many locks at once; their states are fetched in one get_lock_states call per
// 100 locks and kept for a minute.
const STATE_TTL_MS = 60_000;
const stateCache = new Map(); // id -> { at, state }
let queued = new Map(); // id -> [resolve]
let flushTimer = null;

async function flushQueue() {
    flushTimer = null;
    const batch = queued; queued = new Map();
    const ids = [...batch.keys()];
    let states = {};
    try {
        states = await fetchLockStates(createSneedLockActor(sneedLockCanisterId), ids.map((x) => BigInt(x)));
    } catch (_) { /* leave empty */ }
    const at = Date.now();
    for (const id of ids) {
        const st = states[id] || null;
        stateCache.set(id, { at, state: st });
        for (const r of batch.get(id)) r(st);
    }
}

/** The lock's v2 state (cached), or null when unknown or the canister predates v2. */
export function getLockStateCached(lockId) {
    const id = toBig(lockId).toString();
    const hit = stateCache.get(id);
    if (hit && Date.now() - hit.at < STATE_TTL_MS) return Promise.resolve(hit.state);
    return new Promise((resolve) => {
        if (!queued.has(id)) queued.set(id, []);
        queued.get(id).push(resolve);
        if (!flushTimer) flushTimer = setTimeout(flushQueue, 30);
    });
}

/** Forget cached states, e.g. after the owner changed a lock. */
export function invalidateLockState(lockId) {
    if (lockId === undefined) stateCache.clear(); else stateCache.delete(toBig(lockId).toString());
}
