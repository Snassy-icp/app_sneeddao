/**
 * DenominationContext - Site-wide currency denomination preference.
 *
 * Provides the user's selected denomination token and helpers to convert
 * and format USD-based values into that denomination.
 *
 * Default denomination is ckUSDC (i.e. USD).
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
    CKUSDC_LEDGER,
    FIAT_USD_PEG,
    ICP_LEDGER,
    getCurrencySign,
    isFiatSign,
    formatDenomAmount,
    formatDenomCompact,
    fetchDenomTokenUsdPrice,
} from '../utils/DenominationUtils';
import { getTokenMetadataSync } from '../hooks/useTokenCache';

const STORAGE_KEY = 'denominationToken';
const DENOM_CHANGED_EVENT = 'denominationTokenChanged';
const PRICE_REFRESH_INTERVAL = 60_000; // 1 min

const DenominationContext = createContext(null);

export function DenominationProvider({ children }) {
    const [denomTokenId, setDenomTokenIdState] = useState(() => {
        try {
            return localStorage.getItem(STORAGE_KEY) || CKUSDC_LEDGER;
        } catch { return CKUSDC_LEDGER; }
    });

    const [denomTokenUsdPrice, setDenomTokenUsdPrice] = useState(() => {
        const peg = FIAT_USD_PEG[denomTokenId];
        return peg != null ? peg : null;
    });

    const [denomTokenSymbol, setDenomTokenSymbol] = useState(() => {
        const meta = getTokenMetadataSync(denomTokenId);
        return meta?.symbol || null;
    });

    const priceRefreshTimer = useRef(null);

    // Fetch / refresh the denomination token's USD price
    const refreshPrice = useCallback(async (tokenId) => {
        const id = tokenId || denomTokenId;
        try {
            const price = await fetchDenomTokenUsdPrice(id);
            if (price != null) setDenomTokenUsdPrice(price);
        } catch { /* cached / stale price kept */ }
    }, [denomTokenId]);

    useEffect(() => {
        refreshPrice(denomTokenId);

        // Resolve symbol from cache
        const meta = getTokenMetadataSync(denomTokenId);
        if (meta?.symbol) setDenomTokenSymbol(meta.symbol);

        // Periodic refresh
        if (priceRefreshTimer.current) clearInterval(priceRefreshTimer.current);
        priceRefreshTimer.current = setInterval(() => refreshPrice(denomTokenId), PRICE_REFRESH_INTERVAL);
        return () => clearInterval(priceRefreshTimer.current);
    }, [denomTokenId, refreshPrice]);

    // Listen for changes from other tabs / components
    useEffect(() => {
        const handler = (e) => {
            const newId = e.detail;
            if (newId && newId !== denomTokenId) {
                setDenomTokenIdState(newId);
            }
        };
        window.addEventListener(DENOM_CHANGED_EVENT, handler);
        return () => window.removeEventListener(DENOM_CHANGED_EVENT, handler);
    }, [denomTokenId]);

    const setDenomToken = useCallback((tokenId, tokenSymbol) => {
        const id = tokenId || CKUSDC_LEDGER;
        setDenomTokenIdState(id);
        if (tokenSymbol) setDenomTokenSymbol(tokenSymbol);
        try { localStorage.setItem(STORAGE_KEY, id); } catch {}
        window.dispatchEvent(new CustomEvent(DENOM_CHANGED_EVENT, { detail: id }));
    }, []);

    /** Convert a USD amount to the denomination value. Returns null when price is unavailable. */
    const convertUSD = useCallback((usdValue) => {
        if (usdValue == null || denomTokenUsdPrice == null || denomTokenUsdPrice === 0) return null;
        return usdValue / denomTokenUsdPrice;
    }, [denomTokenUsdPrice]);

    /** Format a USD amount in the user's denomination with proper sign/precision. */
    const formatValue = useCallback((usdValue) => {
        const denom = convertUSD(usdValue);
        if (denom == null) return '...';
        return formatDenomAmount(denom, denomTokenId, denomTokenSymbol);
    }, [convertUSD, denomTokenId, denomTokenSymbol]);

    /** Compact formatting for badges and tab subtitles. Returns null when zero. */
    const formatValueCompact = useCallback((usdValue) => {
        const denom = convertUSD(usdValue);
        if (denom == null) return null;
        return formatDenomCompact(denom, denomTokenId, denomTokenSymbol);
    }, [convertUSD, denomTokenId, denomTokenSymbol]);

    const currencySign = getCurrencySign(denomTokenId);
    const isFiat = currencySign ? isFiatSign(currencySign) : true;

    /** Is the current denomination effectively USD? (ckUSDC or ckUSDT) */
    const isUSD = denomTokenId === CKUSDC_LEDGER || denomTokenId === 'cngnf-vqaaa-aaaar-qag4q-cai';

    const value = useMemo(() => ({
        denomTokenId,
        denomTokenSymbol,
        denomTokenUsdPrice,
        setDenomToken,
        convertUSD,
        formatValue,
        formatValueCompact,
        currencySign,
        isFiat,
        isUSD,
    }), [denomTokenId, denomTokenSymbol, denomTokenUsdPrice, setDenomToken, convertUSD, formatValue, formatValueCompact, currencySign, isFiat, isUSD]);

    return (
        <DenominationContext.Provider value={value}>
            {children}
        </DenominationContext.Provider>
    );
}

/** Hook to consume the denomination context. Always available (returns defaults if no provider). */
export function useDenomination() {
    const ctx = useContext(DenominationContext);
    if (!ctx) {
        return {
            denomTokenId: CKUSDC_LEDGER,
            denomTokenSymbol: 'ckUSDC',
            denomTokenUsdPrice: 1,
            setDenomToken: () => {},
            convertUSD: (v) => v,
            formatValue: (v) => v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '...',
            formatValueCompact: (v) => v != null && v > 0 ? `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : null,
            currencySign: '$',
            isFiat: true,
            isUSD: true,
        };
    }
    return ctx;
}

export default DenominationContext;
