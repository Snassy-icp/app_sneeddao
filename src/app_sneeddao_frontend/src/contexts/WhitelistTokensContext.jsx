import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import {
    getCachedWhitelistTokens,
    setCachedWhitelistTokens,
    initializeWhitelistCache,
    WHITELIST_UPDATED_EVENT,
} from '../hooks/useTokenCache';

const WhitelistTokensContext = createContext();

export function WhitelistTokensProvider({ children }) {
    const { identity } = useAuth();
    const [tokens, setTokens] = useState(getCachedWhitelistTokens);
    const [loading, setLoading] = useState(true);

    const fetchWhitelist = useCallback(async () => {
        try {
            const backendActor = createBackendActor(backendCanisterId, {
                agentOptions: { identity }
            });
            const whitelistedTokens = await backendActor.get_whitelisted_tokens();
            const tokensArray = whitelistedTokens || [];
            await setCachedWhitelistTokens(tokensArray);
            setTokens(tokensArray);
            return tokensArray;
        } catch (err) {
            console.error('[WhitelistTokens] Failed to fetch:', err);
            return getCachedWhitelistTokens();
        } finally {
            setLoading(false);
        }
    }, [identity]);

    useEffect(() => {
        let mounted = true;
        async function load() {
            await initializeWhitelistCache();
            const cached = getCachedWhitelistTokens();
            if (cached.length > 0) {
                setTokens(cached);
                setLoading(false);
                fetchWhitelist(); // Refresh in background
            } else {
                await fetchWhitelist();
            }
        }
        load();
        return () => { mounted = false; };
    }, [identity]);

    useEffect(() => {
        const handler = () => {
            const cached = getCachedWhitelistTokens();
            if (cached.length > 0) {
                setTokens(cached);
            }
        };
        window.addEventListener(WHITELIST_UPDATED_EVENT, handler);
        return () => window.removeEventListener(WHITELIST_UPDATED_EVENT, handler);
    }, []);

    return (
        <WhitelistTokensContext.Provider value={{
            whitelistedTokens: tokens,
            loading,
            refreshWhitelist: fetchWhitelist,
        }}>
            {children}
        </WhitelistTokensContext.Provider>
    );
}

export function useWhitelistTokens() {
    const context = useContext(WhitelistTokensContext);
    if (!context) {
        throw new Error('useWhitelistTokens must be used within WhitelistTokensProvider');
    }
    return context;
}
