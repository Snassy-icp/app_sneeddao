// The PremiumContext cache rules: principal text -> { until: ms the membership is active until
// (0: not a member), checkedAt: ms of the last answer (-1: in flight) }.
export const STALE_MS = 10 * 60 * 1000; // re-checked when shown again after this
export const RETRY_MS = 60 * 1000; // a failed check is asked again after this

/** Whether a principal's status should be asked for now. */
export const needsCheck = (entry, now) => !entry || (entry.checkedAt !== -1 && now - entry.checkedAt >= STALE_MS);

/** Principals whose check failed keep what was known and are asked again after RETRY_MS. */
export function markFailed(cache, principals, now) {
    for (const p of principals) {
        const e = cache.get(p);
        if (e?.checkedAt === -1) cache.set(p, { until: e.until, checkedAt: now - STALE_MS + RETRY_MS });
    }
}
