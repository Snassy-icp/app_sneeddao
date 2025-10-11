import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { Principal } from "@dfinity/principal";
import { formatAmountWithConversion } from './StringUtils';
import priceService from '../services/PriceService';

const get_available_backend = (token) => {
    return BigInt(Math.max(0, Number(BigInt(token.balance_backend) - BigInt(token.locked))));
}

const get_available = (token) => {
    const avail_backend = get_available_backend(token);
    return BigInt(token.balance) + avail_backend;
}

function getTokenLogo(metadata) {
    var result = getTokenMetaData(metadata, "icrc1:logo");
    if (result) {
        result = result.Text;
    } else { 
        result = "icp_symbol.svg"; 
    }
    return result;
}

function getTokenMetaData(metadata, key) {

    for (var i = 0; i < metadata.length; i++) {
        if (metadata[i][0] == key) {
            return metadata[i][1];
        }
    }

    return null;
}

async function getTokenMetaFromIcrc1(ledgerActor) {
    try {
        const metadata = await ledgerActor.icrc1_metadata();
        
        // Find symbol and decimals in the metadata array
        const symbolEntry = metadata.find(([key]) => key === "symbol" || key === "icrc1:symbol");
        const decimalsEntry = metadata.find(([key]) => key === "decimals" || key === "icrc1:decimals");
        
        if (!symbolEntry || !decimalsEntry) {
            throw new Error("Required metadata fields not found");
        }

        return [
            ["symbol", symbolEntry[1]],
            ["decimals", decimalsEntry[1]],
            ...metadata
        ];
    } catch (error) {
        console.error("Error fetching ICRC1 token metadata:", error);
        throw error;
    }
}

async function getTokenMetaForSwap(swapActor, backendActor, swapCanisterId) {
    try {
        console.log("SWAPACTOR!!!", swapCanisterId);

        // First try to get from cache
        const canisterPrincipal = typeof swapCanisterId === 'string' ? Principal.fromText(swapCanisterId) : swapCanisterId;
        const cachedMeta = await backendActor.get_cached_token_meta(canisterPrincipal);
        //if (cachedMeta && cachedMeta[0]) {
        //    return cachedMeta[0];
        //}

        // If not in cache, fetch from ICRC1 ledgers
        const swapMeta = await swapActor.metadata();
        if (!swapMeta.ok) {
            throw new Error("Failed to fetch swap metadata");
        }

        const token0Actor = createLedgerActor(swapMeta.ok.token0.address);
        const token1Actor = createLedgerActor(swapMeta.ok.token1.address);

        const [token0Meta, token1Meta] = await Promise.all([
            getTokenMetaFromIcrc1(token0Actor),
            getTokenMetaFromIcrc1(token1Actor)
        ]);

        const tokenMeta = {
            token0: token0Meta,
            token1: token1Meta
        };

        console.log("TOKENMETA!!!", tokenMeta);

        // Cache the result
        await backendActor.set_cached_token_meta(canisterPrincipal, tokenMeta);
        return tokenMeta;
    } catch (error) {
        console.error("Error fetching swap token metadata:", error);
        throw error;
    }
}

/**
 * Get USD conversion rate for a token using the new PriceService
 * @param {string} tokenCanisterId - Token canister ID  
 * @param {number} decimals - Token decimals (optional)
 * @returns {Promise<number>} USD conversion rate, or 0 if unavailable
 */
const get_token_conversion_rate = async (tokenCanisterId, decimals = null) => {
    try {
        // Set decimals in cache if provided
        if (decimals !== null) {
            priceService.setTokenDecimals(tokenCanisterId, decimals);
        }
        
        const usdPrice = await priceService.getTokenUSDPrice(tokenCanisterId, decimals);
        return usdPrice;
    } catch (error) {
        console.warn(`Unable to fetch USD price for token ${tokenCanisterId}:`, error);
        return 0;
    }
};

/**
 * Legacy function for backward compatibility
 * Returns an empty object - use get_token_conversion_rate instead
 * @deprecated Use get_token_conversion_rate(tokenCanisterId, decimals) instead
 */
const get_token_conversion_rates = async () => {
    console.warn('get_token_conversion_rates is deprecated. Use get_token_conversion_rate(tokenCanisterId, decimals) instead');
    return {};
};

function rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable) {
    if(!hideAvailable && rewardDetailsLoading && rewardDetailsLoading[token.ledger_canister_id] != null && BigInt(rewardDetailsLoading[token.ledger_canister_id]) > 0) {
        return BigInt(rewardDetailsLoading[token.ledger_canister_id]);
    }
    return 0n;
}

function availableOrZero(available) {
    return available ? available : 0n;
}

function getTokenTVL(token, rewardDetailsLoading, hideAvailable) {
    const unconverted = availableOrZero(token.available) + token.locked + rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable);
    const converted = formatAmountWithConversion(unconverted, token.decimals, token.conversion_rate, 2);

    return parseFloat(converted);
}

// Calculate total ICP value including all sources
export const calculateTotalIcpValue = (reconciliationData) => {
    const icpReconciliation = reconciliationData.find(item => 
        item.token_id.toString() === 'ryjl3-tyaaa-aaaaa-aaaba-cai'
    );
    return icpReconciliation ? icpReconciliation.server_balance : 0n;
};

// Calculate total SNEED value including all sources
export const calculateTotalSneedValue = (reconciliationData) => {
    const sneedReconciliation = reconciliationData.find(item => 
        item.token_id.toString() === 'hvgxa-wqaaa-aaaaq-aacia-cai'
    );
    return sneedReconciliation ? sneedReconciliation.server_balance : 0n;
};

// Calculate total value of other tokens
export const calculateOtherTokensValue = (reconciliationData, conversionRates) => {
    let totalUsdValue = 0;
    
    // Process all tokens except ICP and SNEED
    reconciliationData.forEach(item => {
        const tokenIdStr = item.token_id.toString();
        if (tokenIdStr !== 'ryjl3-tyaaa-aaaaa-aaaba-cai' && // not ICP
            tokenIdStr !== 'hvgxa-wqaaa-aaaaq-aacia-cai') { // not SNEED
            
            // Get symbol and decimals from metadata if available
            const symbol = item.metadata?.symbol || tokenIdStr;
            const decimals = item.metadata?.decimals || 8;
            const rate = conversionRates[symbol] || 0;
            
            // Calculate USD value using server balance
            const value = Number(item.server_balance) / Math.pow(10, decimals) * rate;
            totalUsdValue += value;
        }
    });
    
    return totalUsdValue;
};

// Calculate total value of other positions
export const calculateOtherPositionsValue = (lpPositions, otherLpPositions, conversionRates) => {
    let totalUsdValue = 0;
    
    // Add LP positions value
    if (lpPositions) {
        lpPositions.forEach(position => {
            if (position.usd_value) {
                totalUsdValue += Number(position.usd_value);
            }
        });
    }
    
    // Add other LP positions value
    if (otherLpPositions) {
        otherLpPositions.forEach(position => {
            if (position.usd_value) {
                totalUsdValue += Number(position.usd_value);
            }
        });
    }
    
    return totalUsdValue;
};

// Calculate total assets value
export const calculateTotalAssetsValue = (
    reconciliationData,
    lpPositions,
    otherLpPositions,
    conversionRates
) => {
    // Calculate ICP total
    const totalIcp = calculateTotalIcpValue(reconciliationData);
    const icpUsdValue = Number(totalIcp) / 1e8 * (conversionRates['ICP'] || 0);
    
    // Calculate SNEED total
    const totalSneed = calculateTotalSneedValue(reconciliationData);
    const sneedUsdValue = Number(totalSneed) / 1e8 * (conversionRates['SNEED'] || 0);
    
    // Calculate other tokens value
    const otherTokensUsdValue = calculateOtherTokensValue(reconciliationData, conversionRates);
    
    // Calculate other positions value
    const otherPositionsUsdValue = calculateOtherPositionsValue(lpPositions, otherLpPositions, conversionRates);
    
    return {
        totalIcp,
        totalSneed,
        icpUsdValue,
        sneedUsdValue,
        otherTokensUsdValue,
        otherPositionsUsdValue,
        totalUsdValue: icpUsdValue + sneedUsdValue + otherTokensUsdValue + otherPositionsUsdValue
    };
};

export {
    get_available,
    get_available_backend,
    getTokenLogo,
    getTokenMetaData,
    get_token_conversion_rates, // deprecated - kept for compatibility
    get_token_conversion_rate,  // use this instead
    rewardAmountOrZero,
    availableOrZero,
    getTokenTVL,
    getTokenMetaFromIcrc1,
    getTokenMetaForSwap
};