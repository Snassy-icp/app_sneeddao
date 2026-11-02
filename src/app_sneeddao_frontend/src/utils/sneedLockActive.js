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
