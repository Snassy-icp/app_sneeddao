// When the relay should make a relay_pull call. relay_pull is an update call, paid by the
// notifications canister (~10-20M cycles each); two relays pulling every 15 s cost ~100B cycles a
// day while nothing is queued. stats() is a free query: pull only when it shows pending jobs, or as
// a safety net every SAFETY_PULL_MS (a stats read that keeps failing never stops deliveries).

export const SAFETY_PULL_MS = 30 * 60 * 1000;

/// pending: stats().pending (null when the query failed); lastPullAt / now in ms.
export function shouldPull(pending, lastPullAt, now) {
    if (pending === null || pending === undefined) return true;
    if (BigInt(pending) > 0n) return true;
    return now - lastPullAt >= SAFETY_PULL_MS;
}
