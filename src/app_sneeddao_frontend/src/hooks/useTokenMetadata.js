import { useState, useCallback } from 'react';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { getTokenLogo } from '../utils/TokenUtils';
import { getLogo, setLogo, getLogoSync, hasLogo } from './useLogoCache';

// Global cache for token metadata to persist across component unmounts
// NOTE: Logos are stored separately in the unified logo cache (IndexedDB)
const metadataCache = new Map();
const loadingStates = new Map();

export const useTokenMetadata = () => {
    const [metadata, setMetadata] = useState(new Map(metadataCache));
    const [loading, setLoading] = useState(new Map(loadingStates));

    const fetchTokenMetadata = useCallback(async (tokenPrincipal) => {
        const principalStr = tokenPrincipal.toString();
        
        // Check if already cached
        if (metadataCache.has(principalStr)) {
            const cached = metadataCache.get(principalStr);
            // Try to get logo from unified cache if not in metadata
            if (!cached.logo || cached.logo === '') {
                const cachedLogo = getLogoSync(principalStr);
                if (cachedLogo) {
                    cached.logo = cachedLogo;
                }
            }
            return cached;
        }

        // Check if already loading
        if (loadingStates.get(principalStr)) {
            return null; // Will be updated when loading completes
        }

        // Mark as loading
        loadingStates.set(principalStr, true);
        setLoading(new Map(loadingStates));

        try {
            // First check if we have a cached logo (from previous session)
            let cachedLogo = await getLogo(principalStr);
            
            const ledgerActor = createLedgerActor(tokenPrincipal);
            
            // Fetch metadata in parallel
            const [rawMetadata, symbol, decimals] = await Promise.all([
                ledgerActor.icrc1_metadata(),
                ledgerActor.icrc1_symbol(),
                ledgerActor.icrc1_decimals()
            ]);

            // Get logo from metadata
            let logo = getTokenLogo(rawMetadata);
            
            // Handle ICP special case
            if (symbol.toLowerCase() === "icp" && logo === "") {
                logo = "icp_symbol.svg";
            }
            
            // Use cached logo if we didn't get one from metadata
            if (!logo && cachedLogo) {
                logo = cachedLogo;
            }
            
            // Cache logo in unified logo cache (persists to IndexedDB)
            if (logo && logo !== '' && logo !== cachedLogo) {
                await setLogo(principalStr, logo);
            }
            
            const tokenMetadata = {
                principal: principalStr,
                symbol,
                decimals,
                logo,
                metadata: rawMetadata
            };

            // Cache metadata (without logo stored here - it's in unified cache)
            metadataCache.set(principalStr, tokenMetadata);
            setMetadata(new Map(metadataCache));
            
            return tokenMetadata;
            
        } catch (error) {
            console.error(`Error fetching metadata for token ${principalStr}:`, error);
            
            // Try to get cached logo even on error
            const cachedLogo = getLogoSync(principalStr);
            
            // Cache error result to avoid repeated failed requests
            const errorMetadata = {
                principal: principalStr,
                symbol: principalStr.slice(0, 8) + '...',
                decimals: 8,
                logo: cachedLogo || '',
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
