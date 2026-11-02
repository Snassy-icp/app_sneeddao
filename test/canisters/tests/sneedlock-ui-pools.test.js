// Sneed Lock pages: which pools are genuine ICPSwap pools (src/app_sneeddao_frontend/src/utils/icpswapPoolMatch.js). No canister needed.
//   Audit 2026-11-02, H2: the lock pages took a pool's own metadata for granted, so a look-alike
//   canister naming real tokens showed as a locked "ICP/SNEED" position and counted in TVL. A pool
//   is genuine only when ICPSwap's SwapFactory lists that canister id for the same token pair (the
//   check tokensafety/checks.js already makes); others are labelled "unverified pool" and left out
//   of TVL and totals.
import { describe, it, expect } from 'vitest';
import { Principal } from '@dfinity/principal';
import { indexFactoryPools, poolVerdict, isFactoryVerifiedPool, isKnownPoolCanister, UNVERIFIED_POOL_LABEL } from '../../../src/app_sneeddao_frontend/src/utils/icpswapPoolMatch.js';

const ICP = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const SNEED = 'hvgxa-wqaaa-aaaaq-aacia-cai';
const REAL_POOL = 'osyzs-xiaaa-aaaag-qc76q-cai';
const FAKE_POOL = 'aaaaa-aa';
const factoryList = [
    { canisterId: Principal.fromText(REAL_POOL), token0: { address: SNEED, standard: 'ICRC1' }, token1: { address: ICP, standard: 'ICP' }, fee: 3000n, key: '', tickSpacing: 60n },
];

describe('poolVerdict', () => {
    const index = indexFactoryPools(factoryList);
    it('accepts a pool the factory lists for the same tokens, in either order, principals or text', () => {
        expect(poolVerdict(index, REAL_POOL, SNEED, ICP).verified).toBe(true);
        expect(isFactoryVerifiedPool(index, Principal.fromText(REAL_POOL), Principal.fromText(ICP), Principal.fromText(SNEED))).toBe(true);
    });
    it('refuses a look-alike canister that claims the real token pair', () => {
        const v = poolVerdict(index, FAKE_POOL, SNEED, ICP);
        expect(v.verified).toBe(false);
        expect(v.reason).toMatch(/does not list this pool/);
    });
    it('refuses a listed pool presented with other tokens', () => {
        expect(poolVerdict(index, REAL_POOL, SNEED, 'mxzaz-hqaaa-aaaar-qaada-cai').verified).toBe(false);
    });
    it('treats an unreadable factory as not verified', () => {
        expect(poolVerdict(null, REAL_POOL, SNEED, ICP).verified).toBe(null);
        expect(isFactoryVerifiedPool(null, REAL_POOL, SNEED, ICP)).toBe(false);
    });
    it('knows pool canisters (refused as position recipients) and labels the rest', () => {
        expect(isKnownPoolCanister(index, REAL_POOL)).toBe(true);
        expect(isKnownPoolCanister(index, FAKE_POOL)).toBe(false);
        expect(UNVERIFIED_POOL_LABEL).toBe('unverified pool');
    });
});
