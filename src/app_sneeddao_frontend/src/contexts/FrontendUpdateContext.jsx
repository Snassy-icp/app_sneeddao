import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getFrontendCanisterModuleHash, isRunningOnCanister } from '../utils/frontendCanisterUtils';
import { clearAllCaches } from '../utils/cacheUtils';
import { getMySettings } from '../utils/BackendUtils';
import { useAuth } from '../AuthContext';

const FrontendUpdateContext = createContext(null);

const DEFAULT_CHECK_INTERVAL_SEC = 60;
const DEFAULT_COUNTDOWN_SEC = 30;

function readSettingsFromStorage() {
    try {
        const autoUpdate = localStorage.getItem('frontendAutoUpdateEnabled');
        const checkInterval = localStorage.getItem('frontendUpdateCheckIntervalSec');
        const countdown = localStorage.getItem('frontendUpdateCountdownSec');
        const checkNum = checkInterval != null ? parseInt(checkInterval, 10) : NaN;
        const countNum = countdown != null ? parseInt(countdown, 10) : NaN;
        return {
            autoUpdateEnabled: autoUpdate !== null ? JSON.parse(autoUpdate) : true,
            checkIntervalSec: Number.isNaN(checkNum) ? DEFAULT_CHECK_INTERVAL_SEC : Math.max(30, Math.min(600, checkNum)),
            countdownSec: Number.isNaN(countNum) ? DEFAULT_COUNTDOWN_SEC : Math.max(10, Math.min(120, countNum)),
        };
    } catch {
        return {
            autoUpdateEnabled: true,
            checkIntervalSec: DEFAULT_CHECK_INTERVAL_SEC,
            countdownSec: DEFAULT_COUNTDOWN_SEC,
        };
    }
}

export function FrontendUpdateProvider({ children }) {
    const { identity } = useAuth();
    const [hasUpdateAvailable, setHasUpdateAvailable] = useState(false);
    const [countdownSeconds, setCountdownSeconds] = useState(DEFAULT_COUNTDOWN_SEC);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [settings, setSettings] = useState(readSettingsFromStorage);
    const initialHashRef = useRef(null);
    const countdownIntervalRef = useRef(null);
    const checkIntervalRef = useRef(null);

    const performRefresh = useCallback(async () => {
        if (isRefreshing) return;
        setIsRefreshing(true);

        try {
            await clearAllCaches();
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
        if (!settings.autoUpdateEnabled) return;

        const currentHash = await getFrontendCanisterModuleHash();
        if (!currentHash) return;

        if (initialHashRef.current === null) {
            initialHashRef.current = currentHash;
            return;
        }

        if (currentHash !== initialHashRef.current) {
            setHasUpdateAvailable(true);
            setCountdownSeconds(settings.countdownSec);

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
    }, [performRefresh, settings.autoUpdateEnabled, settings.countdownSec]);

    useEffect(() => {
        const applySettings = (s) => {
            const toNum = (v) => (typeof v === 'bigint' ? Number(v) : Number(v));
            setSettings(prev => ({
                ...prev,
                ...s,
                checkIntervalSec: s.checkIntervalSec !== undefined
                    ? Math.max(30, Math.min(600, toNum(s.checkIntervalSec)))
                    : prev.checkIntervalSec,
                countdownSec: s.countdownSec !== undefined
                    ? Math.max(10, Math.min(120, toNum(s.countdownSec)))
                    : prev.countdownSec,
            }));
        };

        if (identity) {
            getMySettings(identity).then(backendSettings => {
                if (backendSettings) {
                    const checkInterval = backendSettings.frontend_update_check_interval_sec;
                    const countdown = backendSettings.frontend_update_countdown_sec;
                    applySettings({
                        autoUpdateEnabled: backendSettings.frontend_auto_update_enabled ?? true,
                        checkIntervalSec: checkInterval !== undefined && checkInterval !== null
                            ? (typeof checkInterval === 'bigint' ? Number(checkInterval) : Number(checkInterval))
                            : DEFAULT_CHECK_INTERVAL_SEC,
                        countdownSec: countdown !== undefined && countdown !== null
                            ? (typeof countdown === 'bigint' ? Number(countdown) : Number(countdown))
                            : DEFAULT_COUNTDOWN_SEC,
                    });
                }
            });
        } else {
            setSettings(readSettingsFromStorage());
        }

        const handleSettingsChanged = (e) => {
            if (e.detail) {
                const d = e.detail;
                applySettings({
                    autoUpdateEnabled: d.autoUpdateEnabled,
                    checkIntervalSec: d.checkIntervalSec != null ? Number(d.checkIntervalSec) : undefined,
                    countdownSec: d.countdownSec != null ? Number(d.countdownSec) : undefined,
                });
            }
        };

        window.addEventListener('frontendUpdateSettingsChanged', handleSettingsChanged);
        return () => window.removeEventListener('frontendUpdateSettingsChanged', handleSettingsChanged);
    }, [identity]);

    useEffect(() => {
        if (!isRunningOnCanister()) return;
        if (!settings.autoUpdateEnabled) return;
        if (hasUpdateAvailable) return;

        const runCheck = () => {
            checkForUpdates();
        };

        runCheck();

        const intervalMs = Number(settings.checkIntervalSec) * 1000;
        checkIntervalRef.current = setInterval(runCheck, intervalMs);

        return () => {
            if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current);
                checkIntervalRef.current = null;
            }
        };
    }, [checkForUpdates, settings.autoUpdateEnabled, settings.checkIntervalSec, hasUpdateAvailable]);

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
