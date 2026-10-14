// Lock times for lists of locks (cards, Sneedex): a lock with a dissolve delay that is not
// dissolving has no unlock date of its own (its expiry reads "never"), so these look up its
// v2 state and show the soonest it can be free. Plain locks show their expiry as before.
import React, { useEffect, useState } from 'react';
import { isUntilDissolved, getLockStateCached, earliestUnlockNs, lockExpiryToDate, formatNsDuration, lockAgeText, lockCreatedDate } from '../utils/lockTime';

/** The lock's v2 state when `enabled` (cached and batched), else null. */
export function useLockState(lockId, enabled = true) {
    const [st, setSt] = useState(null);
    const key = lockId === undefined || lockId === null ? null : lockId.toString();
    useEffect(() => {
        if (!enabled || key === null) { setSt(null); return undefined; }
        let alive = true;
        getLockStateCached(key).then((s) => { if (alive) setSt(s); });
        return () => { alive = false; };
    }, [key, enabled]);
    return st;
}

/**
 * The unlock date of a lock. For a delay lock: "<date> at the soonest" while not dissolving,
 * "<date> (dissolving)" while dissolving. `expiry` is the record's expiry (ns, bigint, or a Date).
 */
export function LockUntil({ lockId, expiry, fmt = (d) => d.toLocaleString() }) {
    const held = isUntilDissolved(expiry);
    const st = useLockState(lockId, held);
    if (!held) return <>{fmt(expiry instanceof Date ? expiry : lockExpiryToDate(expiry))}</>;
    if (!st) return <>when dissolved</>;
    const soonest = lockExpiryToDate(earliestUnlockNs(st));
    return <span title="It has a dissolve delay: it unlocks only once its owner starts dissolving it and the delay has run out.">{soonest ? `${fmt(soonest)} at the soonest` : 'when dissolved'}{' '}<span style={{ opacity: 0.7 }}>(dissolve delay {formatNsDuration(st.dissolve_delay)}, not dissolving)</span></span>;
}

/** The time left of a delay lock that is not dissolving: "≥ 2h". */
export function LockTimeLeftAtLeast({ lockId }) {
    const st = useLockState(lockId, true);
    if (!st) return <>until dissolved</>;
    const ms = Number((earliestUnlockNs(st) - BigInt(Date.now()) * 1_000_000n) / 1_000_000n);
    return <span title="At the soonest: it has a dissolve delay and is not dissolving.">≥ {formatNsDuration(BigInt(Math.max(0, ms)) * 1_000_000n)}</span>;
}

/** "3d 4h (since 1 Oct 2026)", or "–" for locks created before Sneed Lock recorded it. */
/// Renders nothing until the state is known, or against a Sneed Lock without v2; `wrap` puts
/// the value in a labelled row so the row appears only with a value.
export function LockAge({ lockId, wrap = (node) => node }) {
    const st = useLockState(lockId, true);
    if (!st) return null;
    const age = lockAgeText(st);
    const created = lockCreatedDate(st);
    return wrap(age
        ? <span title={created ? `Created ${created.toLocaleString()}` : ''}>{age}</span>
        : <span title="Created before Sneed Lock recorded creation times (October 2026)">unknown (older lock)</span>);
}
