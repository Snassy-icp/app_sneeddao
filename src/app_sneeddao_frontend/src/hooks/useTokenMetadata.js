import { useState, useCallback } from 'react';
import { 
    getTokenMetadata, 
    getTokenMetadataSync, 
    hasTokenMetadata, 
    isLoadingMetadata,
    fetchAndCacheTokenMetadata 
} from './useTokenCache';

/**
 * Hook for accessing unified token metadata cache
 * Uses IndexedDB for persistence, memory cache for speed
 */
export const useTokenMetadata = () => {
    const [metadata, setMetadata] = useState(new Map());
    const [loading, setLoading] = useState(new Map());

    const fetchTokenMetadata = useCallback(async (tokenPrincipal, identity = null) => {
        const principalStr = tokenPrincipal.toString();
        
        // Check unified cache first
        const cached = getTokenMetadataSync(principalStr);
        if (cached) {
            return cached;
        }

        // Check if already loading
        if (isLoadingMetadata(principalStr)) {
            return null;
        }

        // Mark as loading in local state
        setLoading(prev => {
            const next = new Map(prev);
            next.set(principalStr, true);
            return next;
        });

        try {
            // Fetch and cache using unified cache
            const result = await fetchAndCacheTokenMetadata(tokenPrincipal, identity);
            
            if (result) {
                setMetadata(prev => {
                    const next = new Map(prev);
                    next.set(principalStr, result);
                    return next;
                });
            }
            
            return result;
            
        } catch (error) {
            console.error(`Error fetching metadata for token ${principalStr}:`, error);
            return null;
        } finally {
            setLoading(prev => {
                const next = new Map(prev);
                next.delete(principalStr);
                return next;
            });
        }
    }, []);

    const getMetadata = useCallback((tokenPrincipal) => {
        return getTokenMetadataSync(tokenPrincipal?.toString());
    }, []);

    const checkLoading = useCallback((tokenPrincipal) => {
        return isLoadingMetadata(tokenPrincipal?.toString());
    }, []);

    // Batch fetch multiple token metadata
    const fetchMultipleTokenMetadata = useCallback(async (tokenPrincipals, identity = null) => {
        const promises = tokenPrincipals.map(principal => 
            fetchTokenMetadata(principal, identity)
        );
        
        return await Promise.all(promises);
    }, [fetchTokenMetadata]);

    return {
        metadata,
        loading,
        fetchTokenMetadata,
        getTokenMetadata: getMetadata,
        isLoadingMetadata: checkLoading,
        fetchMultipleTokenMetadata,
        // Also expose unified cache functions directly
        hasTokenMetadata
    };
};
