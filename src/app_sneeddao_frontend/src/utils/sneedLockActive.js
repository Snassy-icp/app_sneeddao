// Which Sneed Lock locks still lock something (audit 2026-11-02, H3/M4).
//
// Lists of locks can hold expired and archived locks (getLedgerTokenLocks and
// getSwapPositionLocks include archived ones; the other lists hold expired locks until they are
// archived). Only active locks may be counted as "locked" or in a TVL, and the lock that decides
// whether a position is locked is its active one, never just the first record for that position.
//
// A lock record from sneedLockLists carries `active` (the canister's own `locked && !archived`);
// records from older code paths only have `expiry` (ns, bigint, or a Date), which is then
// compared with now. An expiry of 2^64-1 ("until dissolved") is active.
// No imports: the tests run this module as is.

const NOW_NS = (nowMs) => BigInt(Math.floor(nowMs)) * 1_000_000n;

/** True when the lock still locks: active per the canister, else its expiry is in the future. */
export function isLockActive(lock, nowMs = Date.now()) {
    if (!lock) return false;
    if (typeof lock.active === 'boolean') return lock.active;
    if (lock.archived === true) return false;
    if (typeof lock.locked === 'boolean') return lock.locked;
    const e = lock.expiry;
    if (e === undefined || e === null) return false;
    if (e instanceof Date) return e.getTime() > nowMs;
    try { return BigInt(e) > NOW_NS(nowMs); } catch { return false; }
}

/** Token lock tuples [owner, ledger, lock] that are active. */
export const activeLockTuples = (tuples, nowMs = Date.now()) => (tuples || []).filter((t) => isLockActive(t?.[2], nowMs));

/** The summed `amount` of the active locks among `locks` (lock records, not tuples). */
export function sumActiveAmounts(locks, nowMs = Date.now()) {
    let sum = 0n;
    for (const l of locks || []) if (isLockActive(l, nowMs)) sum += BigInt(l.amount ?? 0);
    return sum;
}

/**
 * The lock tuple [owner, swap, lock] of `positionId` among `positionLocks` (one pool's locks):
 * its active lock when it has one, else its newest (highest lock id) record, else null.
 */
export function pickPositionLock(positionId, positionLocks, nowMs = Date.now()) {
    const id = BigInt(positionId);
    let active = null; let newest = null;
    for (const t of positionLocks || []) {
        const rec = t?.[2];
        if (!rec || BigInt(rec.position_id) !== id) continue;
        if (!newest || BigInt(rec.lock_id) > BigInt(newest[2].lock_id)) newest = t;
        if (isLockActive(rec, nowMs) && (!active || BigInt(rec.lock_id) > BigInt(active[2].lock_id))) active = t;
    }
    return active || newest;
}

/**
 * Where a position stands, for display:
 *  'wallet'        the viewer holds it at the pool (frontendOwnership)
 *  'locked'        an active lock AND Sneed Lock holds the position at the pool
 *  'lock-not-held' an active lock record, but the pool says Sneed Lock does not hold the position
 *  'unlocked'      in Sneed Lock without an active lock (expired, or never locked)
 *  'not-locked'    held directly by its owner at the pool (ownershipStatus 'match'): NOT locked
 * `ownershipStatus` ('match' | 'locked' | 'mismatch'), when the page asked the pool, says who
 * holds it; without it, a position Sneed Lock lists for its owner is taken as held by Sneed Lock.
 */
export function positionLockStatus(pd, nowMs = Date.now()) {
    if (!pd) return 'unlocked';
    if (pd.frontendOwnership) return 'wallet';
    const active = isLockActive(pd.lockInfo, nowMs);
    const s = pd.ownershipStatus;
    if (s === 'match') return 'not-locked';
    const held = s === undefined || s === null ? true : s === 'locked';
    if (active) return held ? 'locked' : 'lock-not-held';
    return 'unlocked';
}

/** True only when the position is really locked (see positionLockStatus). */
export const isPositionEffectivelyLocked = (pd, nowMs = Date.now()) => positionLockStatus(pd, nowMs) === 'locked';
