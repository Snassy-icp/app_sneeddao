import { useState, useEffect, useCallback } from 'react';
import { Principal } from '@dfinity/principal';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { createActor as createForumActor, canisterId as forumCanisterId } from 'declarations/sneed_sns_forum';
import { getTokenLogo, get_token_conversion_rate } from '../utils/TokenUtils';
import { fetchUserNeuronsForSns } from '../utils/NeuronUtils';
import { getTipTokensReceivedByUser } from '../utils/BackendUtils';

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
            
            // Fetch conversion rate using the new price service
            const conversion_rate = await get_token_conversion_rate(
                ledgerCanisterId.toString(), 
                decimals
            );

            return {
                principal: ledgerCanisterId.toString(),
                ledger_canister_id: ledgerCanisterId,
                symbol,
                decimals,
                fee,
                logo: symbol.toLowerCase() === "icp" && logo === "" ? "icp_symbol.svg" : logo,
                balance,
                conversion_rate
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

            // 3. Get tokens from received tips
            try {
                const forumActor = createForumActor(forumCanisterId, {
                    agentOptions: {
                        host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
                        identity: identity,
                    },
                });
                const tipTokenSummaries = await getTipTokensReceivedByUser(forumActor, identity.getPrincipal());
                
                // Extract unique token ledger principals from tip summaries
                for (const summary of tipTokenSummaries) {
                    const ledger = summary.token_ledger_principal;
                    const ledgerId = ledger.toString();
                    if (!knownLedgers.has(ledgerId)) {
                        knownLedgers.add(ledgerId);
                        allLedgers.push(ledger);
                    }
                }
            } catch (tipErr) {
                console.warn('Could not fetch tip tokens:', tipErr);
                // Continue without tip tokens
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
