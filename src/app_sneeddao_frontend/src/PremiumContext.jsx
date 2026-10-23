import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Principal } from '@dfinity/principal';
import { createSneedPremiumActor } from './utils/SneedPremiumUtils';
import { needsCheck, markFailed } from './utils/premiumCache';

const PremiumContext = createContext();
export { PremiumContext };

// Premium badges without downloading every member: the principals actually shown are asked for in
// batches (checkMemberships, at most 500 per query) the first time they are shown, and cached.
const BATCH_MAX = 500;
const FLUSH_DELAY_MS = 50; // gathers the principals of one render into one query

export function PremiumProvider({ children }) {
    // principal text -> { until: ms the membership is active until (0: not a member), checkedAt: ms }
    const cache = useRef(new Map());
    const queue = useRef(new Set());
    const timer = useRef(null);
    const [premiumMembers, setPremiumMembers] = useState(new Set());
    const [loading, setLoading] = useState(false);
    const [lastFetched, setLastFetched] = useState(null);

    const publish = useCallback(() => {
        const now = Date.now();
        const active = new Set();
        for (const [p, e] of cache.current) if (e.until > now) active.add(p);
        setPremiumMembers(active);
    }, []);

    const flush = useCallback(async () => {
        timer.current = null;
        const principals = [...queue.current];
        queue.current.clear();
        if (principals.length === 0) return;
        setLoading(true);
        try {
            const actor = await createSneedPremiumActor(); // anonymous: a public query
            for (let i = 0; i < principals.length; i += BATCH_MAX) {
                const chunk = principals.slice(i, i + BATCH_MAX);
                const statuses = await actor.checkMemberships(chunk.map((p) => Principal.fromText(p)));
                const now = Date.now();
                statuses.forEach((s, j) => {
                    const until = 'Active' in s ? Number(BigInt(s.Active.expiration) / 1_000_000n) : 0;
                    cache.current.set(chunk[j], { until, checkedAt: now });
                });
            }
            setLastFetched(Date.now());
            publish();
        } catch (err) {
            console.error('PremiumContext: Error checking premium members:', err);
            markFailed(cache.current, principals, Date.now()); // asked again later, not on the next render
        } finally {
            setLoading(false);
        }
    }, [publish]);

    /** Ask for a principal's premium status (batched; no-op while cached and fresh). */
    const requestPremium = useCallback((principal) => {
        if (!principal) return;
        const p = typeof principal === 'string' ? principal : principal.toString();
        const e = cache.current.get(p);
        if (!needsCheck(e, Date.now())) return;
        cache.current.set(p, { until: e?.until ?? 0, checkedAt: -1 }); // in flight
        queue.current.add(p);
        if (!timer.current) timer.current = setTimeout(flush, FLUSH_DELAY_MS);
    }, [flush]);

    /** Re-check every principal seen so far (e.g. after buying premium). */
    const refreshPremiumMembers = useCallback(async () => {
        for (const p of cache.current.keys()) queue.current.add(p);
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        await flush();
    }, [flush]);

    // memberships that run out while the page is open
    useEffect(() => {
        const interval = setInterval(publish, 60 * 1000);
        return () => { clearInterval(interval); if (timer.current) clearTimeout(timer.current); };
    }, [publish]);

    /**
     * Check if a principal is a premium member. The first time a principal is asked about, its
     * status is fetched in the background (false until it arrives).
     * @param {string|import('@dfinity/principal').Principal} principal - The principal to check
     * @returns {boolean} True if the principal is an active premium member
     */
    const isPremiumMember = useCallback((principal) => {
        if (!principal) return false;
        const principalStr = typeof principal === 'string' ? principal : principal.toString();
        requestPremium(principalStr);
        return premiumMembers.has(principalStr) && (cache.current.get(principalStr)?.until ?? 0) > Date.now();
    }, [premiumMembers, requestPremium]);

    return (
        <PremiumContext.Provider value={{
            premiumMembers,
            loading,
            lastFetched,
            isPremiumMember,
            requestPremium,
            refreshPremiumMembers
        }}>
            {children}
        </PremiumContext.Provider>
    );
}

export function usePremiumMembers() {
    const context = useContext(PremiumContext);
    if (!context) {
        throw new Error('usePremiumMembers must be used within a PremiumProvider');
    }
    return context;
}
