import React, { createContext, useContext, useState, useEffect } from 'react';

const SnsContext = createContext();

const SNEED_SNS_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';
const SNS_SELECTION_KEY = 'selectedSnsRoot';

export function SnsProvider({ children }) {
    // Initialize from localStorage or default to SNEED
    const [selectedSnsRoot, setSelectedSnsRoot] = useState(() => {
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