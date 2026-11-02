// Sneed Lock pages: expiry labels and unknown decimals (src/app_sneeddao_frontend/src/utils/sneedLockDisplay.js). No canister needed.
//   Audit 2026-11-02, low findings: the Sneedex lock picker showed a dissolve-delay lock's expiry
//   (2^64-1 ns) as a date in the year 2554, and the Sneed Lock info page called it (and any expiry
//   after 2100, or a missing one) "Never". It is "until dissolved" everywhere; a missing expiry is
//   "unknown". Pages guessed 8 decimals for tokens whose decimals were unknown (and `|| 8` turned a
//   real 0 into 8); now unknown decimals show raw units.
import { describe, it, expect } from 'vitest';
import { lockExpiryLabel, knownDecimals, displayDecimals, UNTIL_DISSOLVED } from '../../../src/app_sneeddao_frontend/src/utils/sneedLockDisplay.js';

const NEVER = 2n ** 64n - 1n;
const iso = (d) => d.toISOString();

describe('lockExpiryLabel', () => {
    it('says "until dissolved" for 2^64-1, never a date in 2554 or "Never"', () => {
        expect(lockExpiryLabel(NEVER, iso)).toBe(UNTIL_DISSOLVED);
        expect(UNTIL_DISSOLVED).toBe('until dissolved');
    });
    it('formats real expiries, also far ones, and says "unknown" without one', () => {
        expect(lockExpiryLabel(1_800_000_000_000_000_000n, iso)).toBe('2027-01-15T08:00:00.000Z');
        expect(lockExpiryLabel(4_200_000_000_000_000_000n, iso)).toBe(iso(new Date(4_200_000_000_000)));
        expect(lockExpiryLabel(null)).toBe('unknown');
        expect(lockExpiryLabel(0n)).toBe('unknown');
    });
});

describe('decimals', () => {
    it('keeps known decimals, 0 included', () => {
        expect(displayDecimals(8)).toBe(8);
        expect(displayDecimals(0)).toBe(0);
        expect(displayDecimals(18n)).toBe(18);
    });
    it('shows raw units (0) when unknown, never a guessed 8', () => {
        expect(knownDecimals(undefined)).toBe(null);
        expect(knownDecimals(null)).toBe(null);
        expect(displayDecimals(undefined)).toBe(0);
        expect(displayDecimals('x')).toBe(0);
    });
});
