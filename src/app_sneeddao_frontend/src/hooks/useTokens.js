import { useState, useEffect, useCallback } from 'react';
import { Principal } from '@dfinity/principal';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { getTokenLogo, get_token_conversion_rates } from '../utils/TokenUtils';
import { fetchUserNeuronsForSns } from '../utils/NeuronUtils';

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
            const backendActor = createBackendActor(backendCanisterId, { 
                agentOptions: { identity } 
            });

            // Track known ledgers to avoid duplicates (like wallet does)
            const knownLedgers = new Set();
            const allLedgers = [];

            // 1. Get registered ledger canister IDs from backend
            const registeredLedgers = await backendActor.get_ledger_canister_ids();
            registeredLedgers.forEach(ledger => {
                const ledgerId = ledger.toString();
                if (!knownLedgers.has(ledgerId)) {
                    knownLedgers.add(ledgerId);
                    allLedgers.push(ledger);
                }
            });

            // 2. Get reward tokens from RLL (like wallet does)
            try {
                const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
                
                // Get neurons using the same method as wallet
                const sneedGovernanceCanisterId = 'fi3zi-fyaaa-aaaaq-aachq-cai';
                const neurons = await fetchUserNeuronsForSns(identity, sneedGovernanceCanisterId);
                
                // Get reward balances which includes token ledger IDs
                const rewardBalances = await rllActor.balances_of_hotkey_neurons(neurons);
                
                rewardBalances.forEach(balance => {
                    const ledger = balance[0]; // Principal
                    const ledgerId = ledger.toString();
                    if (!knownLedgers.has(ledgerId)) {
                        knownLedgers.add(ledgerId);
                        allLedgers.push(ledger);
                    }
                });
            } catch (rewardErr) {
                console.warn('Could not fetch reward tokens:', rewardErr);
                // Continue without reward tokens
            }

            // Fetch details for all tokens in parallel
            const tokenPromises = allLedgers.map(ledger => 
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
