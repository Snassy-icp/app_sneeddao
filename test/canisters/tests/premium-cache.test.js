// PremiumContext's cache rules (src/app_sneeddao_frontend/src/utils/premiumCache.js): a failed
// membership check must not be asked again on the next render, or every render re-queues the
// principals and the page loops on failing queries.
import { describe, it, expect } from 'vitest';
import { needsCheck, markFailed, STALE_MS } from '../../../src/app_sneeddao_frontend/src/utils/premiumCache.js';

describe('premium cache', () => {
    it('asks for unknown and stale principals, not fresh or in-flight ones', () => {
        const now = 1_000_000_000;
        expect(needsCheck(undefined, now)).toBe(true);
        expect(needsCheck({ until: 0, checkedAt: -1 }, now)).toBe(false);
        expect(needsCheck({ until: 0, checkedAt: now - 1000 }, now)).toBe(false);
        expect(needsCheck({ until: 0, checkedAt: now - STALE_MS }, now)).toBe(true);
    });

    it('backs off after a failed check instead of asking again right away', () => {
        const now = 1_000_000_000;
        const cache = new Map([['a', { until: 0, checkedAt: -1 }], ['b', { until: now + 5000, checkedAt: -1 }]]);
        markFailed(cache, ['a', 'b'], now);
        expect(needsCheck(cache.get('a'), now + 50)).toBe(false); // the next render
        expect(needsCheck(cache.get('a'), now + 59_000)).toBe(false);
        expect(needsCheck(cache.get('a'), now + 61_000)).toBe(true); // retried after a minute
        expect(cache.get('b').until).toBe(now + 5000); // a known membership is kept
    });
});
