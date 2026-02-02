import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
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

    // Fetch token details for a single ledger
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
            
            // Fetch conversion rate
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
                available: balance, // For compatibility with compact wallet display
                conversion_rate
            };
        } catch (error) {
            console.error(`Error fetching token details for ${ledgerCanisterId}:`, error);
            return null;
        }
    }, [identity]);

    // Fetch all tokens for the compact wallet
    const fetchCompactWalletTokens = useCallback(async () => {
        if (!identity || !isAuthenticated) {
            setWalletTokens([]);
            setWalletLoading(false);
            return;
        }

        setWalletLoading(true);

        try {
            const backendActor = createBackendActor(backendCanisterId, { 
                agentOptions: { identity } 
            });

            // Track known ledgers to avoid duplicates
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

            // 2. Get reward tokens from RLL
            try {
                const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
                const sneedGovernanceCanisterId = 'fi3zi-fyaaa-aaaaq-aachq-cai';
                const neurons = await fetchUserNeuronsForSns(identity, sneedGovernanceCanisterId);
                const rewardBalances = await rllActor.balances_of_hotkey_neurons(neurons);
                
                rewardBalances.forEach(balance => {
                    const ledger = balance[0];
                    const ledgerId = ledger.toString();
                    if (!knownLedgers.has(ledgerId)) {
                        knownLedgers.add(ledgerId);
                        allLedgers.push(ledger);
                    }
                });
            } catch (rewardErr) {
                console.warn('Could not fetch reward tokens:', rewardErr);
            }

            // 3. Get tokens from received tips
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
                    if (!knownLedgers.has(ledgerId)) {
                        knownLedgers.add(ledgerId);
                        allLedgers.push(ledger);
                    }
                }
            } catch (tipErr) {
                console.warn('Could not fetch tip tokens:', tipErr);
            }

            // Fetch details for all tokens in parallel
            const tokenPromises = allLedgers.map(ledger => fetchTokenDetails(ledger));
            const tokenResults = await Promise.all(tokenPromises);
            const validTokens = tokenResults.filter(token => token !== null);
            
            setWalletTokens(validTokens);
            setLastUpdated(new Date());
            setHasFetchedInitial(true);
        } catch (err) {
            console.error('Error fetching compact wallet tokens:', err);
            setWalletTokens([]);
        } finally {
            setWalletLoading(false);
        }
    }, [identity, isAuthenticated, fetchTokenDetails]);

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
            updateWalletTokens,
            setLoading,
            clearWallet,
            refreshWallet,
            sendToken
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
