// Sneed Lock pages: what counts as "locked" (src/app_sneeddao_frontend/src/utils/sneedLockActive.js). No canister needed.
//   Audit 2026-11-02, H3: the token page, the token-locks overview and the Sneed Lock stats summed
//   every lock the lists returned into "locked" and TVL, but those lists include expired locks
//   (until archived) and, for one ledger or pool, archived ones too. Only active locks count now;
//   the lists carry the canister's own `active` (locked and not archived), older records fall
//   back to their expiry.
import { describe, it, expect } from 'vitest';
import { isLockActive, activeLockTuples, sumActiveAmounts } from '../../../src/app_sneeddao_frontend/src/utils/sneedLockActive.js';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const ns = (ms) => BigInt(ms) * 1_000_000n;
const NEVER = 2n ** 64n - 1n;
const DAY = 86_400_000;

describe('isLockActive', () => {
    it('trusts the canister flag when the record has one', () => {
        expect(isLockActive({ active: false, expiry: ns(NOW + DAY) }, NOW)).toBe(false);
        expect(isLockActive({ active: true, expiry: ns(NOW - DAY) }, NOW)).toBe(true);
    });
    it('falls back to the expiry (ns or Date), until-dissolved being active', () => {
        expect(isLockActive({ expiry: ns(NOW - DAY) }, NOW)).toBe(false);
        expect(isLockActive({ expiry: ns(NOW + DAY) }, NOW)).toBe(true);
        expect(isLockActive({ expiry: new Date(NOW - 1) }, NOW)).toBe(false);
        expect(isLockActive({ expiry: NEVER }, NOW)).toBe(true);
        expect(isLockActive({ archived: true, expiry: NEVER }, NOW)).toBe(false);
        expect(isLockActive(null, NOW)).toBe(false);
    });
});

describe('locked amounts and TVL count active locks only', () => {
    const tuples = [
        ['owner-a', 'ledger', { lock_id: 1n, amount: 100n, expiry: ns(NOW + DAY), active: true }],
        ['owner-b', 'ledger', { lock_id: 2n, amount: 1_000n, expiry: ns(NOW - DAY), active: false }], // archived
        ['owner-c', 'ledger', { lock_id: 3n, amount: 10n, expiry: ns(NOW - DAY) }],                   // expired, legacy record
        ['owner-d', 'ledger', { lock_id: 4n, amount: 1n, expiry: NEVER }],                            // until dissolved
    ];
    it('sums only the active locks', () => {
        expect(sumActiveAmounts(tuples.map((t) => t[2]), NOW)).toBe(101n);
    });
    it('keeps only active tuples (stats, position locks of a token)', () => {
        expect(activeLockTuples(tuples, NOW).map((t) => t[2].lock_id)).toEqual([1n, 4n]);
    });
});
