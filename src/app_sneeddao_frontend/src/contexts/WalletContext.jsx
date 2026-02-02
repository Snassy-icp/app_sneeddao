import React, { createContext, useContext, useState, useCallback } from 'react';

const WalletContext = createContext(null);

export const WalletProvider = ({ children }) => {
    // Tokens from the wallet - same structure as Wallet.jsx tokens state
    const [walletTokens, setWalletTokens] = useState([]);
    const [walletLoading, setWalletLoading] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);

    // Update tokens from Wallet.jsx
    const updateWalletTokens = useCallback((tokens) => {
        setWalletTokens(tokens);
        setLastUpdated(new Date());
    }, []);

    // Set loading state
    const setLoading = useCallback((loading) => {
        setWalletLoading(loading);
    }, []);

    // Clear wallet data (e.g., on logout)
    const clearWallet = useCallback(() => {
        setWalletTokens([]);
        setLastUpdated(null);
    }, []);

    return (
        <WalletContext.Provider value={{
            walletTokens,
            walletLoading,
            lastUpdated,
            updateWalletTokens,
            setLoading,
            clearWallet
        }}>
            {children}
        </WalletContext.Provider>
    );
};

export const useWallet = () => {
    const context = useContext(WalletContext);
    if (!context) {
        throw new Error('useWallet must be used within a WalletProvider');
    }
    return context;
};

// Optional hook that returns null if not within provider (for components that may be outside)
export const useWalletOptional = () => {
    return useContext(WalletContext);
};

export default WalletContext;
