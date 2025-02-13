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

export {
    get_available,
    get_available_backend,
    getTokenLogo,
    getTokenMetaData,
    get_token_conversion_rates,
    rewardAmountOrZero,
    availableOrZero,
    getTokenTVL
};