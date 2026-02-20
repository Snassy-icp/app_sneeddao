/**
 * DenominationUtils - Shared currency denomination constants and formatting.
 *
 * Extracted from TradingBot.jsx so that every page can use the same
 * sign map, formatting helpers, and two-hop price fetching logic.
 */

import priceService from '../services/PriceService';

// Well-known canister IDs
export const CKUSDC_LEDGER = 'xevnm-gaaaa-aaaar-qafnq-cai';
export const CKUSDT_LEDGER = 'cngnf-vqaaa-aaaar-qag4q-cai';
export const CKEURC_LEDGER = 'pe5t5-diaaa-aaaar-qahwa-cai';
export const CKBTC_LEDGER  = 'mxzaz-hqaaa-aaaar-qaada-cai';
export const CKETH_LEDGER  = 'ss2fx-dyaaa-aaaar-qacoq-cai';
export const ICP_LEDGER    = 'ryjl3-tyaaa-aaaaa-aaaba-cai';

/**
 * Map of well-known canister IDs to their native currency sign.
 * Fiat-pegged stablecoins use the fiat symbol; crypto-pegged use their unicode symbols.
 */
export const CURRENCY_SIGNS = {
    [CKUSDC_LEDGER]: '$',
    [CKUSDT_LEDGER]: '$',
    [CKEURC_LEDGER]: '€',
    [CKBTC_LEDGER]:  '₿',      // U+20BF Bitcoin Sign
    [CKETH_LEDGER]:  'Ξ',      // U+039E Greek Capital Letter Xi (Ethereum)
};

/** Fiat-style currencies use 2 fixed decimal places; crypto signs use significant digits */
export const FIAT_SIGNS = new Set(['$', '€']);

/**
 * Approximate USD peg for fiat stablecoins.
 * Used to derive reliable ICP prices from the liquid ICP/USDC pool
 * instead of relying on potentially illiquid individual token/ICP pools.
 */
export const FIAT_USD_PEG = {
    [CKUSDC_LEDGER]: 1.0,
    [CKUSDT_LEDGER]: 1.0,
    [CKEURC_LEDGER]: 1.08,
};

/** Returns the native currency sign for a canister ID, or null if none. */
export const getCurrencySign = (canisterId) => {
    if (!canisterId) return null;
    const id = typeof canisterId === 'string' ? canisterId : canisterId?.toText?.() || String(canisterId);
    return CURRENCY_SIGNS[id] || null;
};

/** True when the token has any known currency sign. */
export const hasCurrencySign = (canisterId) => getCurrencySign(canisterId) !== null;

/** True when the sign represents a fiat-pegged currency. */
export const isFiatSign = (sign) => FIAT_SIGNS.has(sign);

/**
 * Format a human-readable amount using a native currency sign if available,
 * otherwise append the denomination symbol.
 *
 * @param {number|string} amount
 * @param {string} denomCanisterId
 * @param {string} [denomSymbol] - fallback symbol (e.g. 'ckBTC')
 * @returns {string} e.g. "$12.50", "€8.30", "₿0.00512", "Ξ1.234", "1,234 SNEED"
 */
export const formatDenomAmount = (amount, denomCanisterId, denomSymbol) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : Number(amount);
    if (isNaN(num)) return '—';
    const sign = getCurrencySign(denomCanisterId);
    if (sign) {
        const fiat = FIAT_SIGNS.has(sign);
        if (fiat) {
            if (num === 0) return `${sign}0.00`;
            if (Math.abs(num) < 0.01) return num > 0 ? `<${sign}0.01` : `>-${sign}0.01`;
            return (num < 0 ? '-' : '') + sign + Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        if (num === 0) return `${sign}0`;
        return (num < 0 ? '-' : '') + sign + Math.abs(num).toLocaleString(undefined, { maximumSignificantDigits: 6 });
    }
    return `${num.toLocaleString(undefined, { maximumSignificantDigits: 6 })} ${denomSymbol || ''}`.trim();
};

/**
 * Compact formatting for badges / tab subtitles.
 * Fiat: whole number with sign.  Crypto: up to 4 significant digits with sign.
 */
export const formatDenomCompact = (amount, denomCanisterId, denomSymbol) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : Number(amount);
    if (isNaN(num) || num === 0) return null;
    const sign = getCurrencySign(denomCanisterId);
    if (sign) {
        const fiat = FIAT_SIGNS.has(sign);
        if (fiat) {
            return (num < 0 ? '-' : '') + sign + Math.abs(num).toLocaleString(undefined, { maximumFractionDigits: 0 });
        }
        return (num < 0 ? '-' : '') + sign + Math.abs(num).toLocaleString(undefined, { maximumSignificantDigits: 4 });
    }
    return `${num.toLocaleString(undefined, { maximumSignificantDigits: 4 })} ${denomSymbol || ''}`.trim();
};

/**
 * Format a label suffix for denomination.
 * Returns " ($)" / " (€)" / " (₿)" etc. for known currencies, otherwise " (SYM)".
 */
export const denomLabel = (denomCanisterId, denomSymbol, fallbackSymbol) => {
    const sign = getCurrencySign(denomCanisterId);
    if (sign) return ` (${sign})`;
    if (denomSymbol) return ` (${denomSymbol})`;
    if (fallbackSymbol) return ` (${fallbackSymbol})`;
    return '';
};

/**
 * Fetch the USD price of a denomination token.
 * For fiat-pegged stablecoins, returns the peg value directly.
 *
 * @param {string} denomTokenId - Canister ID of the denomination token
 * @returns {Promise<number|null>} USD price per 1 denomination token unit
 */
export async function fetchDenomTokenUsdPrice(denomTokenId) {
    if (!denomTokenId) return null;

    const peg = FIAT_USD_PEG[denomTokenId];
    if (peg != null) return peg;

    if (denomTokenId === ICP_LEDGER) {
        try { return await priceService.getICPUSDPrice(); }
        catch { return null; }
    }

    try { return await priceService.getTokenUSDPrice(denomTokenId); }
    catch { return null; }
}

/**
 * Fetch prices for a set of tokens denominated in a chosen denomination token.
 * Uses PriceService (shared singleton with memory + localStorage cache).
 *
 * @param {string[]} tokenIds - Canister IDs of tokens to price
 * @param {string} denomTokenId - Canister ID of the denomination token
 * @param {(id: string) => number} decFor - Returns decimals for a given token ID
 * @returns {Promise<Record<string, number|null>>} tokenId → price in denom units, or null
 */
export async function fetchDenomPrices(tokenIds, denomTokenId, decFor) {
    for (const tid of tokenIds) priceService.setTokenDecimals(tid, decFor(tid));
    if (denomTokenId && denomTokenId !== ICP_LEDGER) priceService.setTokenDecimals(denomTokenId, decFor(denomTokenId));

    const getIcpPrice = async (tid) => {
        if (tid === ICP_LEDGER) return 1;
        const fiatPeg = FIAT_USD_PEG[tid];
        if (fiatPeg != null) {
            const icpUsd = await priceService.getICPUSDPrice();
            return icpUsd > 0 ? fiatPeg / icpUsd : null;
        }
        return await priceService.getTokenICPPrice(tid, decFor(tid));
    };

    const [tokenResults, denomIcpPriceRaw] = await Promise.all([
        Promise.all(tokenIds.map(async (tid) => {
            try { return { tid, icpPrice: await getIcpPrice(tid) }; }
            catch (_) { return { tid, icpPrice: null }; }
        })),
        denomTokenId !== ICP_LEDGER ? getIcpPrice(denomTokenId).catch(() => null) : Promise.resolve(1),
    ]);

    const denomIcpPrice = (denomIcpPriceRaw != null && isFinite(denomIcpPriceRaw) && denomIcpPriceRaw > 0) ? denomIcpPriceRaw : null;
    const prices = {};
    for (const { tid, icpPrice } of tokenResults) {
        if (tid === denomTokenId) { prices[tid] = 1; continue; }
        if (icpPrice != null && denomIcpPrice != null && denomIcpPrice > 0) {
            prices[tid] = icpPrice / denomIcpPrice;
        } else {
            prices[tid] = null;
        }
    }
    return prices;
}
