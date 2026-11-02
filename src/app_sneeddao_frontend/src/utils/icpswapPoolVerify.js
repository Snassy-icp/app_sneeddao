// The ICPSwap SwapFactory's pool list, read once per session (audit 2026-11-02, H2).
// See utils/icpswapPoolMatch.js for the matching rules; tokensafety/checks.js reads the same list.
import { createActor as createFactoryActor } from 'external/icp_swap_factory';
import { ICPSWAP_FACTORY_ID, indexFactoryPools, poolVerdict } from './icpswapPoolMatch';

export { UNVERIFIED_POOL_LABEL, isFactoryVerifiedPool, isKnownPoolCanister, poolVerdict } from './icpswapPoolMatch';

let pending = null;

/** Map pool id -> { token0, token1, fee } of every pool the factory lists, or null when it cannot be read. */
export function loadFactoryPoolIndex() {
    if (!pending) {
        pending = (async () => {
            try {
                const r = await createFactoryActor(ICPSWAP_FACTORY_ID).getPools();
                if (!('ok' in r)) throw new Error('ICPSwap factory returned an error');
                return indexFactoryPools(r.ok);
            } catch (e) {
                console.warn('ICPSwap factory pool list unavailable:', e);
                pending = null; // try again next time
                return null;
            }
        })();
    }
    return pending;
}

/** { verified, reason } for one pool (see poolVerdict). */
export async function verifyIcpswapPool(poolId, token0, token1) {
    return poolVerdict(await loadFactoryPoolIndex(), poolId, token0, token1);
}
