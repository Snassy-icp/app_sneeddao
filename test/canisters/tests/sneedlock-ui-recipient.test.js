// Sending a liquidity position: refused recipients (src/app_sneeddao_frontend/src/utils/positionRecipient.js). No canister needed.
//   Audit 2026-11-02, M5: the send dialog accepted Sneed Lock's own canister as the recipient. A
//   position sent there directly is stuck (Sneed Lock releases positions only to whoever claimed
//   them before depositing; the sender no longer can). The anonymous principal and pool canisters
//   lose the position the same way. These are refused, with an explanation.
import { describe, it, expect } from 'vitest';
import { positionRecipientRefusal } from '../../../src/app_sneeddao_frontend/src/utils/positionRecipient.js';

const POOL = 'osyzs-xiaaa-aaaag-qc76q-cai';
const OTHER_POOL = 'xmiu5-jqaaa-aaaag-qbz7q-cai';
const STAGING_LOCK = 'ufdrd-pqaaa-aaaal-qjmsa-cai';
const USER = 'seabo-x4xz7-2fnvn-2pnu6-vtu5k-6ctwq-ulzil-fwdvp-gsldr-4npww-iqe';

describe('positionRecipientRefusal', () => {
    it('refuses Sneed Lock (production, and the configured id) and points to the wizard', () => {
        expect(positionRecipientRefusal('pqsms-lqaaa-aaaal-ajjza-cai')).toMatch(/Sneed Lock.*stuck.*wizard/s);
        expect(positionRecipientRefusal(STAGING_LOCK, { sneedLockIds: [STAGING_LOCK] })).toMatch(/stuck/);
    });
    it('refuses the anonymous principal and the management canister', () => {
        expect(positionRecipientRefusal(' 2vxsx-fae ')).toMatch(/anonymous/);
        expect(positionRecipientRefusal('aaaaa-aa')).toMatch(/management/);
    });
    it('refuses the position\'s own pool and any known pool', () => {
        expect(positionRecipientRefusal(POOL, { poolId: POOL })).toMatch(/pool/);
        expect(positionRecipientRefusal(OTHER_POOL, { poolId: POOL, isPool: (id) => id === OTHER_POOL })).toMatch(/pool/);
    });
    it('lets a person receive it', () => {
        expect(positionRecipientRefusal(USER, { sneedLockIds: [STAGING_LOCK], poolId: POOL, isPool: () => false })).toBe(null);
    });
});
