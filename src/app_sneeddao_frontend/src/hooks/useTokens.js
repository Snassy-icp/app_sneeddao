import { useState, useEffect, useCallback } from 'react';
import { Principal } from '@dfinity/principal';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { getTokenLogo, get_token_conversion_rates } from '../utils/TokenUtils';

// Custom hook for managing tokens data
export const useTokens = (identity) => {
    const [tokens, setTokens] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchTokenDetails = useCallback(async (ledgerCanisterId) => {
        if (!identity) return null;

        try {
            const ledgerActor = createLedgerActor(ledgerCanisterId, {
                agentOptions: { identity }
            });

            const [metadata, symbol, decimals, fee, balance] = await Promise.all([
                ledgerActor.icrc1_metadata(),
                ledgerActor.icrc1_symbol(),
                ledgerActor.icrc1_decimals(),
                ledgerActor.icrc1_fee(),
                ledgerActor.icrc1_balance_of({ 
                    owner: identity.getPrincipal(), 
                    subaccount: [] 
                })
            ]);

            const logo = getTokenLogo(metadata);
            const tokenConversionRates = await get_token_conversion_rates();

            return {
                principal: ledgerCanisterId.toString(),
                ledger_canister_id: ledgerCanisterId,
                symbol,
                decimals,
                fee,
                logo: symbol.toLowerCase() === "icp" && logo === "" ? "icp_symbol.svg" : logo,
                balance,
                conversion_rate: tokenConversionRates[symbol] || 0
            };
        } catch (error) {
            console.error(`Error fetching token details for ${ledgerCanisterId}:`, error);
            return {
                principal: ledgerCanisterId.toString(),
                ledger_canister_id: ledgerCanisterId,
                symbol: "ERROR",
                decimals: 8,
                fee: 0,
                logo: "",
                balance: BigInt(0),
                conversion_rate: 0
            };
        }
    }, [identity]);

    const fetchTokens = useCallback(async () => {
        if (!identity) {
            setTokens([]);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            // Get registered ledger canister IDs from backend
            const backendActor = createBackendActor(backendCanisterId, { 
                agentOptions: { identity } 
            });
            const registeredLedgers = await backendActor.get_ledger_canister_ids();

            // Fetch details for all tokens in parallel
            const tokenPromises = registeredLedgers.map(ledger => 
                fetchTokenDetails(ledger)
            );
            
            const tokenResults = await Promise.all(tokenPromises);
            const validTokens = tokenResults.filter(token => token !== null);
            
            setTokens(validTokens);
        } catch (err) {
            console.error('Error fetching tokens:', err);
            setError(err.message);
            setTokens([]);
        } finally {
            setLoading(false);
        }
    }, [identity, fetchTokenDetails]);

    const refreshTokenBalance = useCallback(async (ledgerCanisterId) => {
        if (!identity) return;

        try {
            const updatedToken = await fetchTokenDetails(
                typeof ledgerCanisterId === 'string' 
                    ? Principal.fromText(ledgerCanisterId) 
                    : ledgerCanisterId
            );
            
            if (updatedToken) {
                setTokens(prevTokens => 
                    prevTokens.map(token => 
                        token.principal === updatedToken.principal ? updatedToken : token
                    )
                );
            }
        } catch (error) {
            console.error('Error refreshing token balance:', error);
        }
    }, [identity, fetchTokenDetails]);

    // Fetch tokens when identity changes
    useEffect(() => {
        fetchTokens();
    }, [fetchTokens]);

    return {
        tokens,
        loading,
        error,
        refreshTokens: fetchTokens,
        refreshTokenBalance
    };
};
