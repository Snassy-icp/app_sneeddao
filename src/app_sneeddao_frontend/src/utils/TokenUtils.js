import { createActor as createNeutriniteDappActor } from 'external/neutrinite_dapp';
import { Principal } from "@dfinity/principal";
import { formatAmountWithConversion } from './StringUtils';

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
        const [metadata, symbol, decimals] = await Promise.all([
            ledgerActor.icrc1_metadata(),
            ledgerActor.icrc1_symbol(),
            ledgerActor.icrc1_decimals()
        ]);

        return [
            ["symbol", { Text: symbol }],
            ["decimals", { Nat: decimals }],
            ...metadata.map(([key, value]) => [key, value])
        ];
    } catch (error) {
        console.error("Error fetching ICRC1 token metadata:", error);
        throw error;
    }
}

async function getTokenMetaForSwap(swapActor, backendActor) {
    try {
        // First try to get from cache
        const swapCanisterId = swapActor.getCanisterId();
        const cachedMeta = await backendActor.get_cached_token_meta(swapCanisterId);
        if (cachedMeta && cachedMeta[0]) {
            return cachedMeta[0];
        }

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

        // Cache the result
        await backendActor.set_cached_token_meta(swapCanisterId, tokenMeta);
        return tokenMeta;
    } catch (error) {
        console.error("Error fetching swap token metadata:", error);
        throw error;
    }
}

let tokenConversionRates = {};

const get_token_conversion_rates = async () => {

    if (Object.keys(tokenConversionRates).length < 1) {
        let can = createNeutriniteDappActor(Principal.fromText("u45jl-liaaa-aaaam-abppa-cai"));
        let tokens = await can.get_latest_wallet_tokens();

        tokens.latest.forEach(token => {
            if (token.rates) {
                token.rates.forEach(rate => {
                    if (rate.symbol.endsWith("/USD")) {
                        const tokenSymbol = rate.symbol.split("/")[0];
                        tokenConversionRates[tokenSymbol] = rate.rate;
                    }
                });
            }
        });
    }

    return tokenConversionRates;
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
    get_token_conversion_rates,
    rewardAmountOrZero,
    availableOrZero,
    getTokenTVL,
    getTokenMetaFromIcrc1,
    getTokenMetaForSwap
};