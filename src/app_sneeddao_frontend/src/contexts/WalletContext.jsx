import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { Principal } from '@dfinity/principal';
import { useAuth } from '../AuthContext';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'declarations/rll';
import { createActor as createForumActor, canisterId as forumCanisterId } from 'declarations/sneed_sns_forum';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { getTokenLogo, get_token_conversion_rate } from '../utils/TokenUtils';
import { fetchUserNeuronsForSns } from '../utils/NeuronUtils';
import { getTipTokensReceivedByUser } from '../utils/BackendUtils';
import { fetchAndCacheSnsData, getAllSnses } from '../utils/SnsUtils';

const WalletContext = createContext(null);

export const WalletProvider = ({ children }) => {
    const { identity, isAuthenticated } = useAuth();
    
    // Tokens from the wallet - same structure as Wallet.jsx tokens state
    const [walletTokens, setWalletTokens] = useState([]);
    const [walletLoading, setWalletLoading] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [hasFetchedInitial, setHasFetchedInitial] = useState(false);
    // Track if detailed wallet data has been loaded (from Wallet.jsx)
    const [hasDetailedData, setHasDetailedData] = useState(false);
    // Track fetch session to prevent stale updates
    const fetchSessionRef = useRef(0);
    // Track SNS token ledger IDs
    const [snsTokenLedgers, setSnsTokenLedgers] = useState(new Set());

    // Load SNS data to know which tokens are SNS tokens
    useEffect(() => {
        async function loadSnsData() {
            try {
                // First try cached data for instant display
                const cached = getAllSnses();
                if (cached && cached.length > 0) {
                    const snsLedgers = new Set(
                        cached.map(sns => sns.canisters?.ledger).filter(Boolean)
                    );
                    setSnsTokenLedgers(snsLedgers);
                }
                
                // Then fetch fresh data in background
                if (identity) {
                    const freshData = await fetchAndCacheSnsData(identity);
                    if (freshData && freshData.length > 0) {
                        const snsLedgers = new Set(
                            freshData.map(sns => sns.canisters?.ledger).filter(Boolean)
                        );
                        setSnsTokenLedgers(snsLedgers);
                    }
                }
            } catch (error) {
                console.warn('[WalletContext] Failed to load SNS data:', error);
            }
        }
        
        loadSnsData();
    }, [identity]);

    // Helper to check if a token is an SNS token
    const isTokenSns = useCallback((ledgerCanisterId) => {
        const ledgerId = typeof ledgerCanisterId === 'string' 
            ? ledgerCanisterId 
            : ledgerCanisterId?.toString?.() || ledgerCanisterId;
        return snsTokenLedgers.has(ledgerId);
    }, [snsTokenLedgers]);

    // Fetch token details for a single ledger - FAST version (no conversion rate)
    const fetchTokenDetailsFast = useCallback(async (ledgerCanisterId) => {
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

            return {
                principal: ledgerCanisterId.toString(),
                ledger_canister_id: ledgerCanisterId,
                symbol,
                decimals,
                fee,
                logo: symbol.toLowerCase() === "icp" && logo === "" ? "icp_symbol.svg" : logo,
                balance,
                available: balance,
                conversion_rate: null, // Will be fetched progressively
                usdValue: null
            };
        } catch (error) {
            console.error(`Error fetching token details for ${ledgerCanisterId}:`, error);
            return null;
        }
    }, [identity]);

    // Fetch conversion rate for a token and update it in place
    const fetchAndUpdateConversionRate = useCallback(async (ledgerCanisterId, decimals, sessionId) => {
        try {
            const conversion_rate = await get_token_conversion_rate(
                ledgerCanisterId.toString(), 
                decimals
            );
            
            // Only update if still in same fetch session
            if (fetchSessionRef.current === sessionId) {
                setWalletTokens(prev => prev.map(token => {
                    if (token.principal === ledgerCanisterId.toString()) {
                        const balance = BigInt(token.available || token.balance || 0n);
                        const balanceNum = Number(balance) / (10 ** (token.decimals || 8));
                        const usdValue = conversion_rate ? balanceNum * conversion_rate : null;
                        return { ...token, conversion_rate, usdValue };
                    }
                    return token;
                }));
            }
        } catch (error) {
            console.warn(`Could not fetch conversion rate for ${ledgerCanisterId}:`, error);
        }
    }, []);

    // Fetch neuron totals for an SNS token and update it in place
    const fetchAndUpdateNeuronTotals = useCallback(async (ledgerCanisterId, sessionId) => {
        const ledgerId = ledgerCanisterId.toString();
        
        // Check if this is an SNS token
        if (!snsTokenLedgers.has(ledgerId)) return;
        
        try {
            // Find the governance canister for this SNS
            const allSnses = getAllSnses();
            const snsData = allSnses.find(sns => sns.canisters?.ledger === ledgerId);
            
            if (!snsData || !snsData.canisters?.governance) return;
            
            const governanceCanisterId = snsData.canisters.governance;
            
            // Fetch neurons
            const neurons = await fetchUserNeuronsForSns(identity, governanceCanisterId);
            
            if (fetchSessionRef.current !== sessionId) return;
            
            // Calculate totals
            const neuronStake = neurons.reduce((total, neuron) => {
                return total + BigInt(neuron.cached_neuron_stake_e8s || 0n);
            }, 0n);
            
            const neuronMaturity = neurons.reduce((total, neuron) => {
                return total + BigInt(neuron.maturity_e8s_equivalent || 0n);
            }, 0n);
            
            // Update token with neuron data
            setWalletTokens(prev => prev.map(token => {
                if (token.principal === ledgerId) {
                    return { 
                        ...token, 
                        neuronStake,
                        neuronMaturity,
                        neuronsLoaded: true
                    };
                }
                return token;
            }));
        } catch (error) {
            console.warn(`Could not fetch neuron totals for ${ledgerId}:`, error);
        }
    }, [identity, snsTokenLedgers]);

    // Progressive token fetcher - adds tokens as they load
    const addTokenProgressively = useCallback((token, sessionId) => {
        if (fetchSessionRef.current !== sessionId) return;
        
        setWalletTokens(prev => {
            // Check if token already exists
            const exists = prev.some(t => t.principal === token.principal);
            if (exists) {
                return prev.map(t => t.principal === token.principal ? token : t);
            }
            return [...prev, token];
        });
    }, []);

    // Fetch all tokens for the compact wallet - PROGRESSIVE
    const fetchCompactWalletTokens = useCallback(async () => {
        if (!identity || !isAuthenticated) {
            setWalletTokens([]);
            setWalletLoading(false);
            return;
        }

        // Increment session to invalidate any in-flight requests from previous fetches
        const sessionId = ++fetchSessionRef.current;
        
        setWalletLoading(true);
        // Don't clear tokens - keep showing existing while refreshing

        try {
            const backendActor = createBackendActor(backendCanisterId, { 
                agentOptions: { identity } 
            });

            // Track known ledgers to avoid duplicates
            const knownLedgers = new Set();

            // 1. Get registered ledger canister IDs from backend FIRST (fastest)
            const registeredLedgers = await backendActor.get_ledger_canister_ids();
            
            // Start fetching registered tokens immediately (don't wait for RLL/tips)
            registeredLedgers.forEach(ledger => {
                const ledgerId = ledger.toString();
                if (!knownLedgers.has(ledgerId)) {
                    knownLedgers.add(ledgerId);
                    // Fire and forget - will add progressively
                    fetchTokenDetailsFast(ledger).then(token => {
                        if (token && fetchSessionRef.current === sessionId) {
                            addTokenProgressively(token, sessionId);
                            // Then fetch USD value and neuron totals in background
                            fetchAndUpdateConversionRate(ledger, token.decimals, sessionId);
                            // Fetch neuron data for SNS tokens (progressive)
                            fetchAndUpdateNeuronTotals(ledger, sessionId);
                        }
                    });
                }
            });

            // 2. Get reward tokens from RLL (in parallel, don't block)
            (async () => {
                try {
                    const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
                    const sneedGovernanceCanisterId = 'fi3zi-fyaaa-aaaaq-aachq-cai';
                    const neurons = await fetchUserNeuronsForSns(identity, sneedGovernanceCanisterId);
                    const rewardBalances = await rllActor.balances_of_hotkey_neurons(neurons);
                    
                    rewardBalances.forEach(balance => {
                        const ledger = balance[0];
                        const ledgerId = ledger.toString();
                        if (!knownLedgers.has(ledgerId) && fetchSessionRef.current === sessionId) {
                            knownLedgers.add(ledgerId);
                            fetchTokenDetailsFast(ledger).then(token => {
                                if (token && fetchSessionRef.current === sessionId) {
                                    addTokenProgressively(token, sessionId);
                                    fetchAndUpdateConversionRate(ledger, token.decimals, sessionId);
                                    fetchAndUpdateNeuronTotals(ledger, sessionId);
                                }
                            });
                        }
                    });
                } catch (rewardErr) {
                    console.warn('Could not fetch reward tokens:', rewardErr);
                }
            })();

            // 3. Get tokens from received tips (in parallel, don't block)
            (async () => {
                try {
                    const forumActor = createForumActor(forumCanisterId, {
                        agentOptions: {
                            host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943',
                            identity: identity,
                        },
                    });
                    const tipTokenSummaries = await getTipTokensReceivedByUser(forumActor, identity.getPrincipal());
                    
                    for (const summary of tipTokenSummaries) {
                        const ledger = summary.token_ledger_principal;
                        const ledgerId = ledger.toString();
                        if (!knownLedgers.has(ledgerId) && fetchSessionRef.current === sessionId) {
                            knownLedgers.add(ledgerId);
                            fetchTokenDetailsFast(ledger).then(token => {
                                if (token && fetchSessionRef.current === sessionId) {
                                    addTokenProgressively(token, sessionId);
                                    fetchAndUpdateConversionRate(ledger, token.decimals, sessionId);
                                    fetchAndUpdateNeuronTotals(ledger, sessionId);
                                }
                            });
                        }
                    }
                } catch (tipErr) {
                    console.warn('Could not fetch tip tokens:', tipErr);
                }
            })();

            setLastUpdated(new Date());
            setHasFetchedInitial(true);
            
            // Set loading to false after a short delay to allow first tokens to appear
            setTimeout(() => {
                if (fetchSessionRef.current === sessionId) {
                    setWalletLoading(false);
                }
            }, 500);
            
        } catch (err) {
            console.error('Error fetching compact wallet tokens:', err);
            if (fetchSessionRef.current === sessionId) {
                setWalletLoading(false);
            }
        }
    }, [identity, isAuthenticated, fetchTokenDetailsFast, addTokenProgressively, fetchAndUpdateConversionRate, fetchAndUpdateNeuronTotals]);

    // Fetch tokens when user authenticates
    useEffect(() => {
        if (isAuthenticated && identity && !hasFetchedInitial) {
            fetchCompactWalletTokens();
        } else if (!isAuthenticated) {
            // Clear wallet on logout
            setWalletTokens([]);
            setHasFetchedInitial(false);
            setHasDetailedData(false);
            setLastUpdated(null);
        }
    }, [isAuthenticated, identity, hasFetchedInitial, fetchCompactWalletTokens]);

    // Update tokens from Wallet.jsx (more detailed data including locks, staked, etc.)
    const updateWalletTokens = useCallback((tokens) => {
        if (tokens && tokens.length > 0) {
            setWalletTokens(tokens);
            setLastUpdated(new Date());
            setHasDetailedData(true);
        }
    }, []);

    // Set loading state
    const setLoading = useCallback((loading) => {
        setWalletLoading(loading);
    }, []);

    // Clear wallet data (e.g., on logout)
    const clearWallet = useCallback(() => {
        setWalletTokens([]);
        setLastUpdated(null);
        setHasFetchedInitial(false);
        setHasDetailedData(false);
    }, []);

    // Refresh tokens manually
    const refreshWallet = useCallback(() => {
        setHasFetchedInitial(false);
        fetchCompactWalletTokens();
    }, [fetchCompactWalletTokens]);

    // Helper to calculate send amounts (frontend vs backend balance)
    const calcSendAmounts = useCallback((token, bigintAmount) => {
        const available = BigInt(token.available || token.balance || 0n);
        const balance = BigInt(token.balance || token.available || 0n);
        const available_backend = BigInt(token.available_backend || 0n);
        const fee = BigInt(token.fee || 0n);

        let send_from_frontend = 0n;
        let send_from_backend = 0n;

        if (available_backend > 0n) {
            // Has backend balance, prefer sending from backend first
            if (bigintAmount <= available_backend) {
                send_from_backend = bigintAmount;
            } else {
                send_from_backend = available_backend;
                send_from_frontend = bigintAmount - available_backend;
            }
        } else {
            // No backend balance, send from frontend only
            send_from_frontend = bigintAmount;
        }

        return { send_from_frontend, send_from_backend };
    }, []);

    // Send token function - can be used from anywhere
    const sendToken = useCallback(async (token, recipient, amount, subaccount = []) => {
        if (!identity) throw new Error('Not authenticated');

        const decimals = token.decimals || 8;
        const amountFloat = parseFloat(amount);
        const scaledAmount = amountFloat * (10 ** decimals);
        const bigintAmount = BigInt(Math.floor(scaledAmount));

        const sendAmounts = calcSendAmounts(token, bigintAmount);

        if (sendAmounts.send_from_backend + sendAmounts.send_from_frontend <= 0n) {
            throw new Error('Invalid send amounts calculated');
        }

        // Send from backend if needed
        if (sendAmounts.send_from_backend > 0n) {
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            const recipientPrincipal = Principal.fromText(recipient);
            
            await sneedLockActor.transfer_tokens(
                recipientPrincipal,
                subaccount,
                token.ledger_canister_id,
                sendAmounts.send_from_backend
            );
        }

        // Send from frontend if needed
        if (sendAmounts.send_from_frontend > 0n) {
            const ledgerActor = createLedgerActor(token.ledger_canister_id, {
                agentOptions: { identity }
            });

            const recipientPrincipal = Principal.fromText(recipient);
            
            await ledgerActor.icrc1_transfer({
                to: { owner: recipientPrincipal, subaccount: subaccount },
                fee: [],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
                amount: sendAmounts.send_from_frontend
            });
        }

        // Refresh wallet after send
        refreshWallet();
    }, [identity, calcSendAmounts, refreshWallet]);

    return (
        <WalletContext.Provider value={{
            walletTokens,
            walletLoading,
            lastUpdated,
            hasDetailedData,
            hasFetchedInitial,
            updateWalletTokens,
            setLoading,
            clearWallet,
            refreshWallet,
            sendToken,
            isTokenSns
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
