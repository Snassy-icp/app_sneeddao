// Is a pool canister a genuine ICPSwap pool? (audit 2026-11-02, H2; pure part, no imports.)
//
// Anyone can deploy a canister that answers like an ICPSwap pool and names real tokens in its
// metadata, so a pool's own metadata proves nothing. The authority is ICPSwap's SwapFactory
// (4mmnk-kiaaa-aaaag-qbllq-cai), as in tokensafety/checks.js: a pool is genuine only when the
// factory lists that canister id, for the same token pair. utils/icpswapPoolVerify.js loads the
// factory's list; these functions match against it.

export const ICPSWAP_FACTORY_ID = '4mmnk-kiaaa-aaaag-qbllq-cai';
export const UNVERIFIED_POOL_LABEL = 'unverified pool';

const txt = (p) => {
    if (p === undefined || p === null) return '';
    if (typeof p === 'string') return p;
    if (typeof p.toText === 'function') return p.toText();
    if (typeof p.address === 'string') return p.address;
    return String(p);
};

/** Map pool canister id (text) -> { token0, token1, fee } from the factory's getPools().ok. */
export function indexFactoryPools(pools) {
    const m = new Map();
    for (const p of pools || []) {
        m.set(txt(p.canisterId), { token0: txt(p.token0), token1: txt(p.token1), fee: p.fee });
    }
    return m;
}

/**
 * { verified, reason } for `poolId` with tokens `token0`/`token1` (either order; omit them to
 * check only that the factory lists the canister). `verified` is null when the factory list is
 * unavailable (`index` null): treat that as not verified.
 */
export function poolVerdict(index, poolId, token0, token1) {
    if (!index) return { verified: null, reason: 'The ICPSwap factory could not be read, so this pool is not verified' };
    const e = index.get(txt(poolId));
    if (!e) return { verified: false, reason: 'The ICPSwap factory does not list this pool canister: it is not a genuine ICPSwap pool' };
    if (token0 !== undefined && token0 !== null && token1 !== undefined && token1 !== null) {
        const a = txt(token0); const b = txt(token1);
        const same = (e.token0 === a && e.token1 === b) || (e.token0 === b && e.token1 === a);
        if (!same) return { verified: false, reason: 'The ICPSwap factory lists this pool canister for other tokens' };
    }
    return { verified: true, reason: 'Listed by the ICPSwap factory' };
}

/** True only for a pool the factory confirms. */
export const isFactoryVerifiedPool = (index, poolId, token0, token1) => poolVerdict(index, poolId, token0, token1).verified === true;

/** True when `id` is a pool canister the factory lists (for refusing pools as recipients). */
export const isKnownPoolCanister = (index, id) => !!index && index.has(txt(id));
