import React, { createContext, useContext, useState, useEffect } from 'react';
import { getSnsById, fetchSingleSnsData, SNS_CACHE_UPDATED_EVENT } from '../utils/SnsUtils';

const SnsContext = createContext();

const SNEED_SNS_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';
const SNS_SELECTION_KEY = 'selectedSnsRoot';

export function SnsProvider({ children }) {
    // Initialize from the URL (?sns=, so a link works at once), else localStorage, else SNEED
    const [selectedSnsRoot, setSelectedSnsRoot] = useState(() => {
        try {
            const fromUrl = new URLSearchParams(window.location.search).get('sns');
            if (fromUrl) return fromUrl;
        } catch (error) {
            // no URL to read
        }
        try {
            const stored = localStorage.getItem(SNS_SELECTION_KEY);
            return stored || SNEED_SNS_ROOT;
        } catch (error) {
            console.warn('Failed to read from localStorage:', error);
            return SNEED_SNS_ROOT;
        }
    });

    // Persist to localStorage whenever selection changes
    useEffect(() => {
        try {
            localStorage.setItem(SNS_SELECTION_KEY, selectedSnsRoot);
        } catch (error) {
            console.warn('Failed to write to localStorage:', error);
        }
    }, [selectedSnsRoot]);

    // The selected SNS's details (governance, ledger, ...). On a clean browser the full SNS list
    // takes a while, so fetch just this one at once; snsReady turns true when its details are in
    // the cache, and pages that read getSnsById() can re-run on it.
    const [snsReady, setSnsReady] = useState(() => !!getSnsById(selectedSnsRoot));
    useEffect(() => {
        let cancelled = false;
        const check = () => {
            const ready = !!getSnsById(selectedSnsRoot);
            if (!cancelled) setSnsReady(ready);
            return ready;
        };
        if (!check()) {
            fetchSingleSnsData(selectedSnsRoot, null).then(check).catch((error) => {
                console.warn(`Could not load SNS ${selectedSnsRoot}:`, error);
            });
        }
        window.addEventListener(SNS_CACHE_UPDATED_EVENT, check);
        return () => {
            cancelled = true;
            window.removeEventListener(SNS_CACHE_UPDATED_EVENT, check);
        };
    }, [selectedSnsRoot]);

    const updateSelectedSns = (snsRoot) => {
        setSelectedSnsRoot(snsRoot);
    };

    const resetToSneed = () => {
        setSelectedSnsRoot(SNEED_SNS_ROOT);
    };

    const value = {
        selectedSnsRoot,
        updateSelectedSns,
        resetToSneed,
        snsReady,
        SNEED_SNS_ROOT
    };

    return (
        <SnsContext.Provider value={value}>
            {children}
        </SnsContext.Provider>
    );
}

export function useSns() {
    const context = useContext(SnsContext);
    if (!context) {
        throw new Error('useSns must be used within a SnsProvider');
    }
    return context;
}

/// Whether an SNS's details are in the cache; turns true when they arrive. For code that reads
/// getSnsById(root) for a root other than (or besides) the selected one.
export function useSnsDetailsReady(snsRoot) {
    const [ready, setReady] = useState(() => !!(snsRoot && getSnsById(snsRoot)));
    useEffect(() => {
        const check = () => setReady(!!(snsRoot && getSnsById(snsRoot)));
        check();
        window.addEventListener(SNS_CACHE_UPDATED_EVENT, check);
        return () => window.removeEventListener(SNS_CACHE_UPDATED_EVENT, check);
    }, [snsRoot]);
    return ready;
}
