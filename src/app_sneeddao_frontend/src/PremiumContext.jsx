import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { createSneedPremiumActor } from './utils/SneedPremiumUtils';

const PremiumContext = createContext();
export { PremiumContext };

export function PremiumProvider({ children }) {
    const [premiumMembers, setPremiumMembers] = useState(new Set());
    const [loading, setLoading] = useState(true);
    const [lastFetched, setLastFetched] = useState(null);

    const fetchPremiumMembers = useCallback(async () => {
        try {
            setLoading(true);
            console.log('PremiumContext: Fetching active premium members...');
            
            // Create an anonymous actor (no identity needed for public query)
            const actor = await createSneedPremiumActor();
            const activePrincipals = await actor.getActivePremiumMembers();
            
            // Convert to a Set of principal strings for fast lookup
            const membersSet = new Set(
                activePrincipals.map(p => p.toString())
            );
            
            console.log('PremiumContext: Loaded', membersSet.size, 'active premium members');
            setPremiumMembers(membersSet);
            setLastFetched(Date.now());
        } catch (err) {
            console.error('PremiumContext: Error fetching premium members:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial fetch on mount
    useEffect(() => {
        fetchPremiumMembers();
    }, [fetchPremiumMembers]);

    // Refresh every 5 minutes to catch new/expired memberships
    useEffect(() => {
        const interval = setInterval(() => {
            fetchPremiumMembers();
        }, 5 * 60 * 1000); // 5 minutes

        return () => clearInterval(interval);
    }, [fetchPremiumMembers]);

    /**
     * Check if a principal is a premium member
     * @param {string|Principal} principal - The principal to check
     * @returns {boolean} True if the principal is an active premium member
     */
    const isPremiumMember = useCallback((principal) => {
        if (!principal) return false;
        const principalStr = typeof principal === 'string' ? principal : principal.toString();
        return premiumMembers.has(principalStr);
    }, [premiumMembers]);

    return (
        <PremiumContext.Provider value={{
            premiumMembers,
            loading,
            lastFetched,
            isPremiumMember,
            refreshPremiumMembers: fetchPremiumMembers
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
