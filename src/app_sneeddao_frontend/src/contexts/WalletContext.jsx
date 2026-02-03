import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { Principal } from '@dfinity/principal';
import { principalToSubAccount } from '@dfinity/utils';
import { useAuth } from '../AuthContext';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'declarations/rll';
import { createActor as createForumActor, canisterId as forumCanisterId } from 'declarations/sneed_sns_forum';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { getTokenLogo, get_token_conversion_rate, get_available, get_available_backend } from '../utils/TokenUtils';
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
    // Liquidity positions from the wallet
    const [liquidityPositions, setLiquidityPositions] = useState([]);
    const [positionsLoading, setPositionsLoading] = useState(false);
    const [hasFetchedPositions, setHasFetchedPositions] = useState(false);
    const positionsFetchSessionRef = useRef(0);

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

    // Fetch token details for a single ledger - includes locked and backend balance
    const fetchTokenDetailsFast = useCallback(async (ledgerCanisterId, summedLocks = {}) => {
        if (!identity) return null;

        try {
            const ledgerActor = createLedgerActor(ledgerCanisterId, {
                agentOptions: { identity }
            });

            const principal = identity.getPrincipal();
            const subaccount = principalToSubAccount(principal);

            const [metadata, symbol, decimals, fee, balance, balance_backend] = await Promise.all([
                ledgerActor.icrc1_metadata(),
                ledgerActor.icrc1_symbol(),
                ledgerActor.icrc1_decimals(),
                ledgerActor.icrc1_fee(),
                ledgerActor.icrc1_balance_of({ 
                    owner: principal, 
                    subaccount: [] 
                }),
                ledgerActor.icrc1_balance_of({ 
                    owner: Principal.fromText(sneedLockCanisterId), 
                    subaccount: [subaccount] 
                })
            ]);

            const logo = getTokenLogo(metadata);
            const ledgerId = ledgerCanisterId.toString();
            
            // Get locked amount from summedLocks map
            const locked = summedLocks[ledgerId] || BigInt(0);

            // Create token object with all balances
            const token = {
                principal: ledgerId,
                ledger_canister_id: ledgerCanisterId,
                symbol,
                decimals,
                fee,
                logo: symbol.toLowerCase() === "icp" && logo === "" ? "icp_symbol.svg" : logo,
                balance,
                balance_backend,
                locked,
                conversion_rate: null, // Will be fetched progressively
                usdValue: null
            };

            // Calculate available balances using same logic as Wallet.jsx
            token.available_backend = get_available_backend(token);
            token.available = get_available(token);

            return token;
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

    // Add a position progressively as it loads
    const addPositionProgressively = useCallback((positionData, sessionId) => {
        if (positionsFetchSessionRef.current !== sessionId) return;
        
        setLiquidityPositions(prev => {
            // Check if position already exists
            const exists = prev.some(p => p.swapCanisterId === positionData.swapCanisterId);
            if (exists) {
                return prev.map(p => p.swapCanisterId === positionData.swapCanisterId ? positionData : p);
            }
            return [...prev, positionData];
        });
    }, []);

    // Fetch conversion rate for a position and update it in place
    const fetchPositionConversionRates = useCallback(async (swapCanisterId, ledger0, ledger1, decimals0, decimals1, sessionId) => {
        try {
            const [rate0, rate1] = await Promise.all([
                get_token_conversion_rate(ledger0, decimals0).catch(() => 0),
                get_token_conversion_rate(ledger1, decimals1).catch(() => 0)
            ]);
            
            if (positionsFetchSessionRef.current === sessionId) {
                setLiquidityPositions(prev => prev.map(p => {
                    if (p.swapCanisterId === swapCanisterId) {
                        return { ...p, token0_conversion_rate: rate0, token1_conversion_rate: rate1 };
                    }
                    return p;
                }));
            }
        } catch (e) {
            console.warn('Could not fetch conversion rates for position:', e);
        }
    }, []);

    // Fetch compact positions for the quick wallet - PROGRESSIVE
    const fetchCompactPositions = useCallback(async () => {
        if (!identity || !isAuthenticated) {
            setLiquidityPositions([]);
            setPositionsLoading(false);
            return;
        }

        const sessionId = ++positionsFetchSessionRef.current;
        setPositionsLoading(true);
        // Don't clear positions - keep showing existing while refreshing

        try {
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            
            // Get swap canister IDs FIRST (fast)
            const swap_canisters = await backendActor.get_swap_canister_ids();
            
            if (swap_canisters.length === 0) {
                if (positionsFetchSessionRef.current === sessionId) {
                    setPositionsLoading(false);
                    setHasFetchedPositions(true);
                }
                return;
            }

            // Get claimed positions in parallel with swap fetches
            const claimedPositionsPromise = (async () => {
                try {
                    // Clear expired locks in background
                    sneedLockActor.has_expired_position_locks().then(async (hasExpired) => {
                        if (hasExpired) await sneedLockActor.clear_expired_position_locks();
                    }).catch(() => {});
                    
                    return await sneedLockActor.get_claimed_positions_for_principal(identity.getPrincipal());
                } catch (e) {
                    console.warn('Could not get claimed positions:', e);
                    return [];
                }
            })();

            // Mark as fetched early so UI shows loading state properly
            setHasFetchedPositions(true);

            // Fetch each swap canister's positions in parallel - fire and forget pattern
            swap_canisters.forEach(async (swap_canister) => {
                if (positionsFetchSessionRef.current !== sessionId) return;
                
                try {
                    const swapActor = createIcpSwapActor(swap_canister);
                    
                    // Get swap metadata first
                    const swap_meta = await swapActor.metadata();
                    if (!swap_meta.ok) return;

                    const icrc1_ledger0 = swap_meta.ok.token0.address;
                    const icrc1_ledger1 = swap_meta.ok.token1.address;

                    // Get user's position IDs quickly
                    const userPositionIds = (await swapActor.getUserPositionIdsByPrincipal(identity.getPrincipal())).ok || [];
                    
                    // Get claimed positions (from the parallel promise)
                    const claimed_positions = await claimedPositionsPromise;
                    const claimed_positions_for_swap = claimed_positions.filter(cp => cp.swap_canister_id === swap_canister);
                    const claimed_position_ids_for_swap = claimed_positions_for_swap.map(cp => cp.position_id);
                    
                    // If no positions for this user in this swap, skip
                    if (userPositionIds.length === 0 && claimed_position_ids_for_swap.length === 0) return;

                    // Get token metadata in parallel
                    const [ledgerActor0, ledgerActor1] = [
                        createLedgerActor(icrc1_ledger0),
                        createLedgerActor(icrc1_ledger1)
                    ];

                    const [metadata0, metadata1, decimals0, decimals1, symbol0, symbol1, fee0, fee1] = await Promise.all([
                        ledgerActor0.icrc1_metadata(),
                        ledgerActor1.icrc1_metadata(),
                        ledgerActor0.icrc1_decimals(),
                        ledgerActor1.icrc1_decimals(),
                        ledgerActor0.icrc1_symbol(),
                        ledgerActor1.icrc1_symbol(),
                        ledgerActor0.icrc1_fee(),
                        ledgerActor1.icrc1_fee()
                    ]);

                    let token0Logo = getTokenLogo(metadata0);
                    let token1Logo = getTokenLogo(metadata1);
                    if (symbol0?.toLowerCase() === "icp" && token0Logo === "") token0Logo = "icp_symbol.svg";
                    if (symbol1?.toLowerCase() === "icp" && token1Logo === "") token1Logo = "icp_symbol.svg";

                    // Build claimed positions lookup
                    const claimed_positions_for_swap_by_id = {};
                    for (const cp of claimed_positions_for_swap) {
                        claimed_positions_for_swap_by_id[cp.position_id] = cp;
                    }
                    
                    // Fetch positions with amounts
                    let userPositions = [];
                    let offset = 0;
                    const limit = 50;
                    let hasMore = true;
                    
                    while (hasMore && positionsFetchSessionRef.current === sessionId) {
                        const result = await swapActor.getUserPositionWithTokenAmount(offset, limit);
                        const allPositions = result.ok?.content || [];
                        
                        for (const position of allPositions) {
                            if (userPositionIds.includes(position.id) || claimed_position_ids_for_swap.includes(position.id)) {
                                userPositions.push({
                                    position: position,
                                    claimInfo: claimed_positions_for_swap_by_id[position.id],
                                    frontendOwnership: userPositionIds.includes(position.id)
                                });
                            }
                        }
                        
                        offset += limit;
                        hasMore = allPositions.length === limit;
                    }

                    if (userPositions.length === 0 || positionsFetchSessionRef.current !== sessionId) return;

                    // Build position details
                    const positionDetails = userPositions.map(compoundPosition => {
                        const position = compoundPosition.position;
                        return {
                            positionId: position.id,
                            tokensOwed0: position.tokensOwed0,
                            tokensOwed1: position.tokensOwed1,
                            amount0: position.token0Amount,
                            amount1: position.token1Amount,
                            frontendOwnership: compoundPosition.frontendOwnership,
                            lockInfo: (!compoundPosition.frontendOwnership && compoundPosition.claimInfo?.position_lock?.[0]) 
                                ? compoundPosition.claimInfo.position_lock[0] 
                                : null
                        };
                    });

                    // Add position immediately (without conversion rates)
                    const positionData = {
                        swapCanisterId: swap_canister,
                        token0: Principal.fromText(icrc1_ledger0),
                        token1: Principal.fromText(icrc1_ledger1),
                        token0Symbol: symbol0,
                        token1Symbol: symbol1,
                        token0Logo: token0Logo,
                        token1Logo: token1Logo,
                        token0Decimals: Number(decimals0),
                        token1Decimals: Number(decimals1),
                        token0Fee: fee0,
                        token1Fee: fee1,
                        token0_conversion_rate: 0, // Will be updated progressively
                        token1_conversion_rate: 0,
                        swapCanisterBalance0: 0n,
                        swapCanisterBalance1: 0n,
                        positions: positionDetails,
                        loading: false
                    };
                    
                    addPositionProgressively(positionData, sessionId);
                    
                    // Fetch conversion rates in background
                    fetchPositionConversionRates(swap_canister, icrc1_ledger0, icrc1_ledger1, decimals0, decimals1, sessionId);
                    
                } catch (err) {
                    console.warn(`Could not fetch positions for swap ${swap_canister}:`, err);
                }
            });

            // Set loading to false after a short delay to allow first positions to appear
            setTimeout(() => {
                if (positionsFetchSessionRef.current === sessionId) {
                    setPositionsLoading(false);
                }
            }, 500);
            
        } catch (error) {
            console.error('Error fetching compact positions:', error);
            if (positionsFetchSessionRef.current === sessionId) {
                setPositionsLoading(false);
                setHasFetchedPositions(true);
            }
        }
    }, [identity, isAuthenticated, addPositionProgressively, fetchPositionConversionRates]);

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
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { 
                agentOptions: { identity } 
            });

            // Track known ledgers to avoid duplicates
            const knownLedgers = new Set();

            // 1. Fetch summed locks from sneed_lock (needed for locked balances)
            // Also clear expired locks if any
            if (await sneedLockActor.has_expired_locks()) {
                await sneedLockActor.clear_expired_locks();
            }
            const summedLocksList = await sneedLockActor.get_summed_locks();
            const summedLocks = {};
            for (const [tokenLedger, amount] of summedLocksList) {
                summedLocks[tokenLedger.toString()] = amount;
            }

            // 2. Get registered ledger canister IDs from backend
            const registeredLedgers = await backendActor.get_ledger_canister_ids();
            
            // Start fetching registered tokens immediately (don't wait for RLL/tips)
            registeredLedgers.forEach(ledger => {
                const ledgerId = ledger.toString();
                if (!knownLedgers.has(ledgerId)) {
                    knownLedgers.add(ledgerId);
                    // Fire and forget - will add progressively
                    fetchTokenDetailsFast(ledger, summedLocks).then(token => {
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

            // 3. Get reward tokens from RLL (in parallel, don't block)
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
                            fetchTokenDetailsFast(ledger, summedLocks).then(token => {
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

            // 4. Get tokens from received tips (in parallel, don't block)
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
                            fetchTokenDetailsFast(ledger, summedLocks).then(token => {
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
            
            // Set loading to false and hasFetchedInitial to true after tokens have had time to load
            // This prevents the brief "No tokens" flash during progressive loading
            setTimeout(() => {
                if (fetchSessionRef.current === sessionId) {
                    setHasFetchedInitial(true);
                    setWalletLoading(false);
                }
            }, 800);
            
        } catch (err) {
            console.error('Error fetching compact wallet tokens:', err);
            if (fetchSessionRef.current === sessionId) {
                setWalletLoading(false);
            }
        }
    }, [identity, isAuthenticated, fetchTokenDetailsFast, addTokenProgressively, fetchAndUpdateConversionRate, fetchAndUpdateNeuronTotals]);

    // Fetch tokens and positions when user authenticates
    useEffect(() => {
        if (isAuthenticated && identity && !hasFetchedInitial) {
            fetchCompactWalletTokens();
        }
        if (isAuthenticated && identity && !hasFetchedPositions) {
            fetchCompactPositions();
        }
        if (!isAuthenticated) {
            // Clear wallet on logout
            setWalletTokens([]);
            setLiquidityPositions([]);
            setHasFetchedInitial(false);
            setHasFetchedPositions(false);
            setHasDetailedData(false);
            setLastUpdated(null);
        }
    }, [isAuthenticated, identity, hasFetchedInitial, hasFetchedPositions, fetchCompactWalletTokens, fetchCompactPositions]);

    // Update tokens from Wallet.jsx (more detailed data including locks, staked, etc.)
    const updateWalletTokens = useCallback((tokens) => {
        if (tokens && tokens.length > 0) {
            setWalletTokens(tokens);
            setLastUpdated(new Date());
            setHasDetailedData(true);
        }
    }, []);

    // Update liquidity positions from Wallet.jsx
    const updateLiquidityPositions = useCallback((positions, loading = false) => {
        setLiquidityPositions(positions || []);
        setPositionsLoading(loading);
    }, []);

    // Set loading state
    const setLoading = useCallback((loading) => {
        setWalletLoading(loading);
    }, []);

    // Clear wallet data (e.g., on logout)
    const clearWallet = useCallback(() => {
        setWalletTokens([]);
        setLiquidityPositions([]);
        setLastUpdated(null);
        setHasFetchedInitial(false);
        setHasFetchedPositions(false);
        setHasDetailedData(false);
    }, []);

    // Refresh tokens manually
    const refreshWallet = useCallback(() => {
        setHasFetchedInitial(false);
        setHasFetchedPositions(false);
        fetchCompactWalletTokens();
        fetchCompactPositions();
    }, [fetchCompactWalletTokens, fetchCompactPositions]);

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
            isTokenSns,
            // Liquidity positions
            liquidityPositions,
            positionsLoading,
            updateLiquidityPositions
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
