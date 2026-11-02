// Who may receive a liquidity position (audit 2026-11-02, M5; pure, no imports).
//
// A position sent straight to Sneed Lock's canister is stuck: Sneed Lock only releases positions
// to the principal that claimed them before depositing (the lock wizard does that), so nobody can
// withdraw it. Sent to the anonymous principal it is burned; sent to a pool canister (its own
// pool or any ICPSwap pool) nobody can act for it either. These recipients are refused.

export const SNEED_LOCK_PROD_ID = 'pqsms-lqaaa-aaaal-ajjza-cai';
export const ANONYMOUS_ID = '2vxsx-fae';
export const MANAGEMENT_ID = 'aaaaa-aa';

const txt = (p) => (p === undefined || p === null ? '' : typeof p === 'string' ? p.trim() : typeof p.toText === 'function' ? p.toText() : String(p));

/**
 * Why `recipient` may not receive a position, or null when it may.
 * opts: { sneedLockIds: [ids of Sneed Lock], poolId: the position's pool, isPool: (id) => bool for
 * any known pool canister (e.g. the ICPSwap factory list) }.
 */
export function positionRecipientRefusal(recipient, opts = {}) {
    const r = txt(recipient);
    if (!r) return null;
    const sneedLocks = new Set([SNEED_LOCK_PROD_ID, ...(opts.sneedLockIds || []).map(txt).filter(Boolean)]);
    if (sneedLocks.has(r)) {
        return 'This is Sneed Lock\'s own canister. A position sent to it directly gets stuck: Sneed Lock only releases positions to whoever claimed them before depositing. To lock a position, use the Sneed Lock wizard (it claims and deposits in the right order).';
    }
    if (r === ANONYMOUS_ID) return 'This is the anonymous principal: nobody can ever act for it, so the position would be lost for good.';
    if (r === MANAGEMENT_ID) return 'This is the IC management canister: it cannot hold positions, the position would be lost.';
    if ((opts.poolId && r === txt(opts.poolId)) || (typeof opts.isPool === 'function' && opts.isPool(r))) {
        return 'This is a liquidity pool canister: a pool cannot act on positions sent to it, so the position would be lost.';
    }
    return null;
}
