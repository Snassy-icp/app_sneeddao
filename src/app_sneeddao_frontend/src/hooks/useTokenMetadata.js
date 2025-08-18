import { useState, useCallback } from 'react';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { getTokenLogo } from '../utils/TokenUtils';

// Global cache for token metadata to persist across component unmounts
const metadataCache = new Map();
const loadingStates = new Map();

export const useTokenMetadata = () => {
    const [metadata, setMetadata] = useState(new Map(metadataCache));
    const [loading, setLoading] = useState(new Map(loadingStates));

    const fetchTokenMetadata = useCallback(async (tokenPrincipal) => {
        const principalStr = tokenPrincipal.toString();
        
        // Check if already cached
        if (metadataCache.has(principalStr)) {
            return metadataCache.get(principalStr);
        }

        // Check if already loading
        if (loadingStates.get(principalStr)) {
            return null; // Will be updated when loading completes
        }

        // Mark as loading
        loadingStates.set(principalStr, true);
        setLoading(new Map(loadingStates));

        try {
            console.log('Fetching metadata for token:', principalStr);
            
            const ledgerActor = createLedgerActor(tokenPrincipal);
            
            // Fetch metadata in parallel
            const [rawMetadata, symbol, decimals] = await Promise.all([
                ledgerActor.icrc1_metadata(),
                ledgerActor.icrc1_symbol(),
                ledgerActor.icrc1_decimals()
            ]);

            const logo = getTokenLogo(rawMetadata);
            
            const tokenMetadata = {
                principal: principalStr,
                symbol,
                decimals,
                logo: symbol.toLowerCase() === "icp" && logo === "" ? "icp_symbol.svg" : logo,
                metadata: rawMetadata
            };

            // Cache the result globally
            metadataCache.set(principalStr, tokenMetadata);
            setMetadata(new Map(metadataCache));
            
            console.log('Cached metadata for token:', principalStr, tokenMetadata);
            return tokenMetadata;
            
        } catch (error) {
            console.error(`Error fetching metadata for token ${principalStr}:`, error);
            
            // Cache error result to avoid repeated failed requests
            const errorMetadata = {
                principal: principalStr,
                symbol: principalStr.slice(0, 8) + '...',
                decimals: 8,
                logo: '',
                error: true
            };
            
            metadataCache.set(principalStr, errorMetadata);
            setMetadata(new Map(metadataCache));
            
            return errorMetadata;
        } finally {
            // Mark as no longer loading
            loadingStates.delete(principalStr);
            setLoading(new Map(loadingStates));
        }
    }, []);

    const getTokenMetadata = useCallback((tokenPrincipal) => {
        const principalStr = tokenPrincipal.toString();
        return metadataCache.get(principalStr) || null;
    }, []);

    const isLoadingMetadata = useCallback((tokenPrincipal) => {
        const principalStr = tokenPrincipal.toString();
        return loadingStates.get(principalStr) || false;
    }, []);

    // Batch fetch multiple token metadata
    const fetchMultipleTokenMetadata = useCallback(async (tokenPrincipals) => {
        const promises = tokenPrincipals.map(principal => 
            fetchTokenMetadata(principal)
        );
        
        return await Promise.all(promises);
    }, [fetchTokenMetadata]);

    return {
        metadata,
        loading,
        fetchTokenMetadata,
        getTokenMetadata,
        isLoadingMetadata,
        fetchMultipleTokenMetadata
    };
};
