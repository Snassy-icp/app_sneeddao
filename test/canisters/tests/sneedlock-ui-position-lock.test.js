// Position cards: is this position locked? (src/app_sneeddao_frontend/src/utils/sneedLockActive.js,
// lockFromLocks in utils/PositionUtils.js). No canister needed.
//   Audit 2026-11-02, M4: lockFromLocks took the first record for a position, which in lists with
//   expired and archived locks was often an old lock; the card called a position "locked" from
//   that record's expiry alone, and showed the case where the lock owner holds the position
//   directly at the pool (not locked at all) as a green "Match!". Now the active lock is picked,
//   and "locked" needs an active lock AND Sneed Lock holding the position.
import { describe, it, expect } from 'vitest';
import { pickPositionLock, positionLockStatus, isPositionEffectivelyLocked } from '../../../src/app_sneeddao_frontend/src/utils/sneedLockActive.js';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const ns = (ms) => BigInt(ms) * 1_000_000n;
const DAY = 86_400_000;
const rec = (lock_id, position_id, expiryMs, active) => ['owner', 'pool', { lock_id, position_id, expiry: ns(expiryMs), ...(active === undefined ? {} : { active }) }];

describe('lockFromLocks / pickPositionLock', () => {
    it('picks the active lock, not the first (old, archived) record of the position', () => {
        const locks = [rec(1n, 7n, NOW - 30 * DAY, false), rec(5n, 8n, NOW + DAY, true), rec(9n, 7n, NOW + 30 * DAY, true)];
        expect(pickPositionLock(7n, locks, NOW)[2].lock_id).toBe(9n);
    });
    it('without an active lock, the newest record', () => {
        const locks = [rec(1n, 7n, NOW - 30 * DAY), rec(4n, 7n, NOW - DAY)];
        expect(pickPositionLock(7n, locks, NOW)[2].lock_id).toBe(4n);
        expect(pickPositionLock(3n, locks, NOW)).toBe(null);
    });
});

describe('positionLockStatus', () => {
    const active = { lock_id: 9n, expiry: ns(NOW + DAY), active: true };
    const expired = { lock_id: 1n, expiry: ns(NOW - DAY), active: false };
    it('is locked only with an active lock and Sneed Lock holding the position', () => {
        expect(positionLockStatus({ lockInfo: active, ownershipStatus: 'locked' }, NOW)).toBe('locked');
        expect(isPositionEffectivelyLocked({ lockInfo: active, ownershipStatus: 'locked' }, NOW)).toBe(true);
    });
    it('the owner holding the position directly ("match") is NOT locked, whatever the lock record says', () => {
        expect(positionLockStatus({ lockInfo: active, ownershipStatus: 'match' }, NOW)).toBe('not-locked');
        expect(isPositionEffectivelyLocked({ lockInfo: active, ownershipStatus: 'match' }, NOW)).toBe(false);
    });
    it('an active lock record on a position Sneed Lock does not hold is flagged', () => {
        expect(positionLockStatus({ lockInfo: active, ownershipStatus: 'mismatch' }, NOW)).toBe('lock-not-held');
    });
    it('an expired or archived lock is not locked, even with a future-looking expiry field', () => {
        expect(positionLockStatus({ lockInfo: expired, ownershipStatus: 'locked' }, NOW)).toBe('unlocked');
        expect(positionLockStatus({ lockInfo: { ...active, active: false }, ownershipStatus: 'locked' }, NOW)).toBe('unlocked');
    });
    it('wallet positions and positions listed by Sneed Lock without a pool check', () => {
        expect(positionLockStatus({ frontendOwnership: true, lockInfo: null }, NOW)).toBe('wallet');
        expect(positionLockStatus({ frontendOwnership: false, lockInfo: active }, NOW)).toBe('locked');
    });
});
