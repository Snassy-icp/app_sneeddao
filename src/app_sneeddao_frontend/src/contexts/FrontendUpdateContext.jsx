import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getFrontendCanisterModuleHash, isRunningOnCanister } from '../utils/frontendCanisterUtils';
import { clearAllCaches } from '../utils/cacheUtils';

const FrontendUpdateContext = createContext(null);

const CHECK_INTERVAL_MS = 60 * 1000; // Check every 60 seconds
const COUNTDOWN_SECONDS = 30; // Countdown before auto-refresh

export function FrontendUpdateProvider({ children }) {
    const [hasUpdateAvailable, setHasUpdateAvailable] = useState(false);
    const [countdownSeconds, setCountdownSeconds] = useState(COUNTDOWN_SECONDS);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const initialHashRef = useRef(null);
    const countdownIntervalRef = useRef(null);
    const checkIntervalRef = useRef(null);

    const performRefresh = useCallback(async () => {
        if (isRefreshing) return;
        setIsRefreshing(true);

        try {
            await clearAllCaches();
            // Small delay to ensure cache clear completes
            await new Promise(r => setTimeout(r, 300));
        } catch (err) {
            console.error('[FrontendUpdate] Failed to clear cache before refresh:', err);
        } finally {
            window.location.reload();
        }
    }, [isRefreshing]);

    const triggerRefresh = useCallback(() => {
        if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
        }
        if (checkIntervalRef.current) {
            clearInterval(checkIntervalRef.current);
            checkIntervalRef.current = null;
        }
        setHasUpdateAvailable(false);
        performRefresh();
    }, [performRefresh]);

    const checkForUpdates = useCallback(async () => {
        if (!isRunningOnCanister()) return;

        const currentHash = await getFrontendCanisterModuleHash(null);
        if (!currentHash) return;

        if (initialHashRef.current === null) {
            initialHashRef.current = currentHash;
            return;
        }

        if (currentHash !== initialHashRef.current) {
            setHasUpdateAvailable(true);
            setCountdownSeconds(COUNTDOWN_SECONDS);

            if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current);
                checkIntervalRef.current = null;
            }

            countdownIntervalRef.current = setInterval(() => {
                setCountdownSeconds(prev => {
                    if (prev <= 1) {
                        if (countdownIntervalRef.current) {
                            clearInterval(countdownIntervalRef.current);
                            countdownIntervalRef.current = null;
                        }
                        performRefresh();
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
    }, [performRefresh]);

    useEffect(() => {
        if (!isRunningOnCanister()) return;

        const runCheck = () => {
            checkForUpdates();
        };

        runCheck();

        checkIntervalRef.current = setInterval(runCheck, CHECK_INTERVAL_MS);

        return () => {
            if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current);
            }
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
            }
        };
    }, [checkForUpdates]);

    const value = {
        hasUpdateAvailable,
        countdownSeconds,
        triggerRefresh,
        isRefreshing,
    };

    return (
        <FrontendUpdateContext.Provider value={value}>
            {children}
        </FrontendUpdateContext.Provider>
    );
}

export function useFrontendUpdate() {
    const ctx = useContext(FrontendUpdateContext);
    return ctx;
}
