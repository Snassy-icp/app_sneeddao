import React, { useState, useEffect, useCallback } from 'react';
import Header from '../components/Header';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { FaArrowLeft, FaClock, FaGavel, FaUser, FaCubes, FaBrain, FaCoins, FaCheck, FaTimes, FaExternalLinkAlt, FaSync, FaWallet } from 'react-icons/fa';
import { Principal } from '@dfinity/principal';
import { Actor, HttpAgent } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { 
    createSneedexActor, 
    createLedgerActor,
    formatAmount, 
    formatDate,
    formatTimeRemaining, 
    getOfferStateString,
    getBidStateString,
    getAssetDetails,
    parseAmount,
    getErrorMessage,
    SNEEDEX_CANISTER_ID 
} from '../utils/SneedexUtils';
import { createActor as createBackendActor } from 'declarations/app_sneeddao_backend';
import { createActor as createGovernanceActor } from 'external/sns_governance';
import { createActor as createICRC1Actor } from 'external/icrc1_ledger';

const backendCanisterId = process.env.CANISTER_ID_APP_SNEEDDAO_BACKEND || process.env.REACT_APP_BACKEND_CANISTER_ID;

const MANAGEMENT_CANISTER_ID = 'aaaaa-aa';
const getHost = () => process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943';

// Management canister IDL for canister_status and update_settings
const managementIdlFactory = () => {
    const definite_canister_settings = IDL.Record({
        'controllers': IDL.Vec(IDL.Principal),
        'freezing_threshold': IDL.Nat,
        'memory_allocation': IDL.Nat,
        'compute_allocation': IDL.Nat,
        'reserved_cycles_limit': IDL.Nat,
        'log_visibility': IDL.Variant({
            'controllers': IDL.Null,
            'public': IDL.Null,
        }),
        'wasm_memory_limit': IDL.Nat,
    });
    const canister_status_result = IDL.Record({
        'status': IDL.Variant({
            'running': IDL.Null,
            'stopping': IDL.Null,
            'stopped': IDL.Null,
        }),
        'settings': definite_canister_settings,
        'module_hash': IDL.Opt(IDL.Vec(IDL.Nat8)),
        'memory_size': IDL.Nat,
        'cycles': IDL.Nat,
        'idle_cycles_burned_per_day': IDL.Nat,
        'reserved_cycles': IDL.Nat,
        'query_stats': IDL.Record({
            'num_calls_total': IDL.Nat,
            'num_instructions_total': IDL.Nat,
            'request_payload_bytes_total': IDL.Nat,
            'response_payload_bytes_total': IDL.Nat,
        }),
    });
    // Settings for update_settings - all fields optional
    const canister_settings = IDL.Record({
        'controllers': IDL.Opt(IDL.Vec(IDL.Principal)),
        'compute_allocation': IDL.Opt(IDL.Nat),
        'memory_allocation': IDL.Opt(IDL.Nat),
        'freezing_threshold': IDL.Opt(IDL.Nat),
        'reserved_cycles_limit': IDL.Opt(IDL.Nat),
        'log_visibility': IDL.Opt(IDL.Variant({
            'controllers': IDL.Null,
            'public': IDL.Null,
        })),
        'wasm_memory_limit': IDL.Opt(IDL.Nat),
    });
    return IDL.Service({
        'canister_status': IDL.Func(
            [IDL.Record({ 'canister_id': IDL.Principal })],
            [canister_status_result],
            []
        ),
        'update_settings': IDL.Func(
            [IDL.Record({ 
                'canister_id': IDL.Principal,
                'settings': canister_settings,
            })],
            [],
            []
        ),
    });
};

function SneedexOffer() {
    const { id } = useParams();
    const { identity, isAuthenticated } = useAuth();
    const { theme } = useTheme();
    const navigate = useNavigate();
    
    const [offer, setOffer] = useState(null);
    const [bids, setBids] = useState([]);
    const [highestBid, setHighestBid] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [bidAmount, setBidAmount] = useState('');
    const [bidding, setBidding] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [pendingBid, setPendingBid] = useState(null); // {bidId, amount, subaccount, escrowBalance}
    const [paymentLoading, setPaymentLoading] = useState(false);
    const [withdrawLoading, setWithdrawLoading] = useState(false);
    const [userBalance, setUserBalance] = useState(null);
    const [canisterControllerStatus, setCanisterControllerStatus] = useState({}); // {canisterId: boolean}
    const [neuronPermissionStatus, setNeuronPermissionStatus] = useState({}); // {governanceId_neuronId: {verified, message}}
    const [tokenBalanceStatus, setTokenBalanceStatus] = useState({}); // {ledgerId: {verified, balance, required}}
    const [checkingAssets, setCheckingAssets] = useState(false);
    const [whitelistedTokens, setWhitelistedTokens] = useState([]);
    
    // Fetch whitelisted tokens for metadata lookup
    useEffect(() => {
        const fetchTokens = async () => {
            try {
                const backendActor = createBackendActor(backendCanisterId, {
                    agentOptions: { identity }
                });
                const tokens = await backendActor.get_whitelisted_tokens();
                setWhitelistedTokens(tokens);
            } catch (e) {
                console.error('Failed to fetch whitelisted tokens:', e);
            }
        };
        fetchTokens();
    }, [identity]);
    
    // Check if the user is a controller of a specific canister
    const checkCanisterController = useCallback(async (canisterId) => {
        if (!identity) return false;
        
        try {
            const canisterPrincipal = Principal.fromText(canisterId);
            const host = getHost();
            const agent = HttpAgent.createSync({ host, identity });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const managementCanister = Actor.createActor(managementIdlFactory, {
                agent,
                canisterId: MANAGEMENT_CANISTER_ID,
                callTransform: (methodName, args, callConfig) => ({
                    ...callConfig,
                    effectiveCanisterId: canisterPrincipal,
                }),
            });
            
            // If this call succeeds, the user is a controller
            await managementCanister.canister_status({ canister_id: canisterPrincipal });
            return true;
        } catch (e) {
            // Call failed - user is not a controller
            console.log(`User is not a controller of ${canisterId}:`, e.message);
            return false;
        }
    }, [identity]);
    
    // Check if user has ManagePrincipals permission on an SNS neuron
    const checkNeuronPermission = useCallback(async (governanceId, neuronIdHex) => {
        if (!identity) return { verified: false, message: 'Not authenticated' };
        
        try {
            const host = getHost();
            const agent = HttpAgent.createSync({ host, identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const governanceActor = createGovernanceActor(governanceId, { agent });
            const neuronIdBlob = new Uint8Array(neuronIdHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            
            const result = await governanceActor.get_neuron({
                neuron_id: [{ id: neuronIdBlob }]
            });
            
            if (result.result && result.result[0] && 'Neuron' in result.result[0]) {
                const neuron = result.result[0].Neuron;
                const userPrincipal = identity.getPrincipal().toString();
                
                const permissions = neuron.permissions || [];
                const userPerms = permissions.find(p => 
                    p.principal && p.principal[0] && p.principal[0].toString() === userPrincipal
                );
                
                if (userPerms && userPerms.permission_type) {
                    // ManagePrincipals (2) is required to add Sneedex as a hotkey for escrow
                    const PERM_MANAGE_PRINCIPALS = 2;
                    
                    if (userPerms.permission_type.includes(PERM_MANAGE_PRINCIPALS)) {
                        return { verified: true, message: 'Can escrow (has ManagePrincipals)' };
                    } else {
                        return { verified: false, message: 'Missing ManagePrincipals permission' };
                    }
                }
                return { verified: false, message: 'No permissions found' };
            }
            return { verified: false, message: 'Neuron not found' };
        } catch (e) {
            console.error('Failed to check neuron permission:', e);
            return { verified: false, message: 'Could not verify' };
        }
    }, [identity]);
    
    // Check if user has sufficient token balance for escrow
    const checkTokenBalance = useCallback(async (ledgerId, requiredAmount) => {
        if (!identity) return { verified: false, message: 'Not authenticated', balance: 0n };
        
        try {
            const host = getHost();
            const agent = HttpAgent.createSync({ host, identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const ledgerActor = createICRC1Actor(ledgerId, { agent });
            const balance = await ledgerActor.icrc1_balance_of({
                owner: identity.getPrincipal(),
                subaccount: []
            });
            const fee = await ledgerActor.icrc1_fee();
            
            // Need amount + fee for transfer
            const totalRequired = requiredAmount + fee;
            
            if (balance >= totalRequired) {
                return { verified: true, message: 'Sufficient balance', balance, required: totalRequired };
            } else {
                return { verified: false, message: 'Insufficient balance', balance, required: totalRequired };
            }
        } catch (e) {
            console.error('Failed to check token balance:', e);
            return { verified: false, message: 'Could not verify', balance: 0n, required: requiredAmount };
        }
    }, [identity]);
    
    // Check all pending escrow assets (canisters, neurons, tokens)
    // Run in both Draft and PendingEscrow states
    const checkAllPendingAssets = useCallback(async () => {
        if (!offer || !identity) return;
        const isDraftOrPending = 'Draft' in offer.state || 'PendingEscrow' in offer.state;
        if (!isDraftOrPending) return;
        
        setCheckingAssets(true);
        const canisterStatus = {};
        const neuronStatus = {};
        const tokenStatus = {};
        
        for (const assetEntry of offer.assets) {
            const details = getAssetDetails(assetEntry);
            if (details.escrowed) continue; // Skip already escrowed assets
            
            if (details.type === 'Canister') {
                const canisterId = details.canister_id;
                if (canisterId) {
                    canisterStatus[canisterId] = await checkCanisterController(canisterId);
                }
            } else if (details.type === 'SNSNeuron') {
                const governanceId = details.governance_id;
                const neuronIdHex = details.neuron_id;
                if (governanceId && neuronIdHex) {
                    const key = `${governanceId}_${neuronIdHex}`;
                    neuronStatus[key] = await checkNeuronPermission(governanceId, neuronIdHex);
                }
            } else if (details.type === 'ICRC1Token') {
                const ledgerId = details.ledger_id;
                const amount = details.amount || 0n;
                if (ledgerId) {
                    tokenStatus[ledgerId] = await checkTokenBalance(ledgerId, BigInt(amount));
                }
            }
        }
        
        setCanisterControllerStatus(canisterStatus);
        setNeuronPermissionStatus(neuronStatus);
        setTokenBalanceStatus(tokenStatus);
        setCheckingAssets(false);
    }, [offer, identity, checkCanisterController, checkNeuronPermission, checkTokenBalance]);
    
    // Run asset verification check when offer loads (in Draft or PendingEscrow state)
    useEffect(() => {
        if (offer && identity && ('Draft' in offer.state || 'PendingEscrow' in offer.state)) {
            checkAllPendingAssets();
        }
    }, [offer, identity, checkAllPendingAssets]);
    
    // Fetch user's token balance
    const fetchUserBalance = useCallback(async () => {
        if (!identity || !offer) return;
        
        try {
            const ledgerActor = await createLedgerActor(
                offer.price_token_ledger.toString(),
                identity
            );
            
            const balance = await ledgerActor.icrc1_balance_of({
                owner: identity.getPrincipal(),
                subaccount: [],
            });
            
            setUserBalance(balance);
        } catch (e) {
            console.error('Failed to fetch user balance:', e);
        }
    }, [identity, offer]);
    
    // Fetch balance when offer loads or identity changes
    useEffect(() => {
        if (offer && identity) {
            fetchUserBalance();
        }
    }, [offer, identity, fetchUserBalance]);
    
    const fetchOffer = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const actor = createSneedexActor(identity);
            const offerView = await actor.getOfferView(BigInt(id));
            
            if (offerView && offerView.length > 0) {
                setOffer(offerView[0].offer);
                setBids(offerView[0].bids);
                setHighestBid(offerView[0].highest_bid[0] || null);
            } else {
                setError('Offer not found');
            }
        } catch (e) {
            console.error('Failed to fetch offer:', e);
            setError('Failed to load offer. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [id, identity]);
    
    useEffect(() => {
        fetchOffer();
    }, [fetchOffer]);
    
    // Get token info from whitelisted tokens
    const tokenInfo = (() => {
        if (!offer) return { symbol: 'TOKEN', decimals: 8 };
        const ledgerId = offer.price_token_ledger.toString();
        const token = whitelistedTokens.find(t => t.ledger_id.toString() === ledgerId);
        if (token) {
            return { symbol: token.symbol, decimals: Number(token.decimals), name: token.name };
        }
        // Fallback for known tokens if not in whitelist
        if (ledgerId === 'ryjl3-tyaaa-aaaaa-aaaba-cai') return { symbol: 'ICP', decimals: 8 };
        return { symbol: 'TOKEN', decimals: 8 };
    })();
    
    const getMinimumBid = () => {
        if (!offer) return 0;
        if (highestBid) {
            // Must beat highest bid by at least 1 smallest unit
            return Number(highestBid.amount) / Math.pow(10, tokenInfo.decimals) + 0.0001;
        }
        if (offer.min_bid_price[0]) {
            return Number(offer.min_bid_price[0]) / Math.pow(10, tokenInfo.decimals);
        }
        if (offer.buyout_price[0]) {
            return Number(offer.buyout_price[0]) / Math.pow(10, tokenInfo.decimals);
        }
        return 0;
    };
    
    const getAssetTypeIcon = (type) => {
        switch (type) {
            case 'Canister': return <FaCubes style={{ color: theme.colors.accent }} />;
            case 'SNSNeuron': return <FaBrain style={{ color: theme.colors.success }} />;
            case 'ICRC1Token': return <FaCoins style={{ color: theme.colors.warning }} />;
            default: return <FaCubes />;
        }
    };
    
    const [bidProgress, setBidProgress] = useState(''); // For showing progress during auto-bid
    
    const handlePlaceBid = async () => {
        if (!identity) {
            setError('Please connect your wallet first');
            return;
        }
        
        setError('');
        const amount = parseFloat(bidAmount);
        
        if (isNaN(amount) || amount <= 0) {
            setError('Please enter a valid bid amount');
            return;
        }
        
        const minBid = getMinimumBid();
        if (amount < minBid) {
            setError(`Bid must be at least ${minBid.toFixed(4)} ${tokenInfo.symbol}`);
            return;
        }
        
        setBidding(true);
        setBidProgress('Reserving bid...');
        
        let bidId = null;
        let subaccount = null;
        const amountE8s = parseAmount(amount, tokenInfo.decimals);
        
        try {
            const actor = createSneedexActor(identity);
            
            // Step 1: Reserve a bid
            const reserveResult = await actor.reserveBid(BigInt(id));
            if ('err' in reserveResult) {
                throw new Error(getErrorMessage(reserveResult.err));
            }
            bidId = reserveResult.ok;
            
            // Step 2: Get the escrow subaccount
            subaccount = await actor.getBidEscrowSubaccount(
                identity.getPrincipal(),
                bidId
            );
            
            // Set pending bid in case auto-steps fail
            setPendingBid({
                bidId: bidId,
                amount: amountE8s,
                displayAmount: amount,
                subaccount: subaccount,
                escrowBalance: 0n
            });
            
            setBidAmount('');
            
            // Step 3: Auto-pay from wallet
            setBidProgress('Transferring from wallet...');
            
            const ledgerActor = await createLedgerActor(
                offer.price_token_ledger.toString(),
                identity
            );
            
            const fee = await ledgerActor.icrc1_fee();
            
            const transferArg = {
                to: {
                    owner: Principal.fromText(SNEEDEX_CANISTER_ID),
                    subaccount: [Array.from(subaccount)],
                },
                fee: [fee],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
                amount: amountE8s,
            };
            
            const transferResult = await ledgerActor.icrc1_transfer(transferArg);
            
            if ('Err' in transferResult) {
                const err = transferResult.Err;
                if ('InsufficientFunds' in err) {
                    throw new Error(`Insufficient funds. Balance: ${formatAmount(err.InsufficientFunds.balance, tokenInfo.decimals)} ${tokenInfo.symbol}`);
                }
                throw new Error(`Transfer failed: ${JSON.stringify(err)}`);
            }
            
            // Update pending bid with new balance
            setPendingBid(prev => prev ? { ...prev, escrowBalance: amountE8s } : null);
            
            // Step 4: Auto-confirm bid
            setBidProgress('Confirming bid...');
            
            const confirmResult = await actor.confirmBid(bidId, amountE8s);
            
            if ('err' in confirmResult) {
                throw new Error(getErrorMessage(confirmResult.err));
            }
            
            // Success! Clear pending bid and refresh
            setPendingBid(null);
            setBidProgress('');
            alert('Bid placed successfully!');
            await fetchOffer();
            fetchUserBalance(); // Refresh balance
            
        } catch (e) {
            console.error('Failed during bid process:', e);
            setError(e.message || 'Failed to place bid');
            setBidProgress('');
            
            // If we have a pending bid set, keep it so user can retry manually
            // If reservation failed, clear everything
            if (!bidId) {
                setPendingBid(null);
            }
        } finally {
            setBidding(false);
            setBidProgress('');
        }
    };
    
    const handleConfirmBid = async () => {
        if (!identity || !pendingBid) return;
        
        setActionLoading(true);
        setError('');
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.confirmBid(pendingBid.bidId, pendingBid.amount);
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            alert('Bid confirmed successfully! Your bid is now active.');
            setPendingBid(null);
            await fetchOffer();
        } catch (e) {
            console.error('Failed to confirm bid:', e);
            setError(e.message || 'Failed to confirm bid. Make sure you have sent the tokens to the escrow subaccount.');
        } finally {
            setActionLoading(false);
        }
    };
    
    const handleCancelPendingBid = () => {
        setPendingBid(null);
    };
    
    // Fetch escrow balance for pending bid
    const fetchEscrowBalance = useCallback(async () => {
        if (!pendingBid || !offer) return;
        
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.getBidEscrowBalance(pendingBid.bidId);
            
            if ('ok' in result) {
                setPendingBid(prev => prev ? { ...prev, escrowBalance: result.ok } : null);
            }
        } catch (e) {
            console.error('Failed to fetch escrow balance:', e);
        }
    }, [pendingBid?.bidId, offer, identity]);
    
    // Refresh escrow balance periodically when there's a pending bid
    useEffect(() => {
        if (pendingBid) {
            fetchEscrowBalance();
            const interval = setInterval(fetchEscrowBalance, 5000); // Refresh every 5 seconds
            return () => clearInterval(interval);
        }
    }, [pendingBid?.bidId, fetchEscrowBalance]);
    
    // Direct payment from wallet
    const handleDirectPayment = async () => {
        if (!identity || !offer || !pendingBid) return;
        
        setPaymentLoading(true);
        setError('');
        try {
            const ledgerActor = await createLedgerActor(
                offer.price_token_ledger.toString(),
                identity
            );
            
            // Get the transfer fee
            const fee = await ledgerActor.icrc1_fee();
            
            // Prepare transfer
            const transferArg = {
                to: {
                    owner: Principal.fromText(SNEEDEX_CANISTER_ID),
                    subaccount: [Array.from(pendingBid.subaccount)],
                },
                fee: [fee],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
                amount: pendingBid.amount,
            };
            
            const result = await ledgerActor.icrc1_transfer(transferArg);
            
            if ('Err' in result) {
                const err = result.Err;
                if ('InsufficientFunds' in err) {
                    throw new Error(`Insufficient funds. Balance: ${formatAmount(err.InsufficientFunds.balance, tokenInfo.decimals)} ${tokenInfo.symbol}`);
                }
                throw new Error(JSON.stringify(err));
            }
            
            // Refresh balance
            await fetchEscrowBalance();
            
            alert(`Payment successful! Transaction ID: ${result.Ok}\n\nYou can now click "Confirm Bid" to activate your bid.`);
        } catch (e) {
            console.error('Failed to make payment:', e);
            setError(e.message || 'Failed to make payment');
        } finally {
            setPaymentLoading(false);
        }
    };
    
    // Withdraw from escrow subaccount
    // For unconfirmed bids: can withdraw everything
    // For confirmed bids: backend reserves (bid_amount + 1 fee) for eventual transfer
    const handleWithdraw = async () => {
        if (!identity || !pendingBid) return;
        
        const currentBalance = pendingBid.escrowBalance || 0n;
        
        // For pending (unconfirmed) bids, user can withdraw everything
        // Backend handles the actual validation including fee reservation for confirmed bids
        const maxWithdrawable = currentBalance;
        
        if (maxWithdrawable <= 0n) {
            setError('No funds available to withdraw');
            return;
        }
        
        // Ask user how much to withdraw
        const amountStr = window.prompt(
            `How much ${tokenInfo.symbol} to withdraw?\nAvailable: ${formatAmount(maxWithdrawable, tokenInfo.decimals)} ${tokenInfo.symbol}`,
            formatAmount(maxWithdrawable, tokenInfo.decimals)
        );
        
        if (!amountStr) return;
        
        const withdrawAmount = parseAmount(parseFloat(amountStr), tokenInfo.decimals);
        if (withdrawAmount <= 0n || withdrawAmount > maxWithdrawable) {
            setError(`Invalid amount. Max: ${formatAmount(maxWithdrawable, tokenInfo.decimals)} ${tokenInfo.symbol}`);
            return;
        }
        
        setWithdrawLoading(true);
        setError('');
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.withdrawBidEscrow(pendingBid.bidId, withdrawAmount);
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            alert(`Withdrawal successful! Transaction ID: ${result.ok}`);
            await fetchEscrowBalance();
        } catch (e) {
            console.error('Failed to withdraw:', e);
            setError(e.message || 'Failed to withdraw');
        } finally {
            setWithdrawLoading(false);
        }
    };
    
    const [buyoutProgress, setBuyoutProgress] = useState('');
    
    const handleBuyout = async () => {
        if (!identity || !offer) return;
        
        setActionLoading(true);
        setError('');
        setBuyoutProgress('Reserving buyout...');
        
        let bidId = null;
        let subaccount = null;
        const buyoutAmountE8s = offer.buyout_price[0];
        const buyoutDisplayAmount = Number(buyoutAmountE8s) / Math.pow(10, tokenInfo.decimals);
        
        try {
            const actor = createSneedexActor(identity);
            
            // Step 1: Reserve a bid for the buyout amount
            const reserveResult = await actor.reserveBid(BigInt(id));
            if ('err' in reserveResult) {
                throw new Error(getErrorMessage(reserveResult.err));
            }
            bidId = reserveResult.ok;
            
            subaccount = await actor.getBidEscrowSubaccount(
                identity.getPrincipal(),
                bidId
            );
            
            // Set pending bid in case auto-steps fail
            setPendingBid({
                bidId: bidId,
                amount: buyoutAmountE8s,
                displayAmount: buyoutDisplayAmount,
                subaccount: subaccount,
                isBuyout: true,
                escrowBalance: 0n
            });
            
            // Step 2: Auto-pay from wallet
            setBuyoutProgress('Transferring from wallet...');
            
            const ledgerActor = await createLedgerActor(
                offer.price_token_ledger.toString(),
                identity
            );
            
            const fee = await ledgerActor.icrc1_fee();
            
            const transferArg = {
                to: {
                    owner: Principal.fromText(SNEEDEX_CANISTER_ID),
                    subaccount: [Array.from(subaccount)],
                },
                fee: [fee],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
                amount: buyoutAmountE8s,
            };
            
            const transferResult = await ledgerActor.icrc1_transfer(transferArg);
            
            if ('Err' in transferResult) {
                const err = transferResult.Err;
                if ('InsufficientFunds' in err) {
                    throw new Error(`Insufficient funds. Balance: ${formatAmount(err.InsufficientFunds.balance, tokenInfo.decimals)} ${tokenInfo.symbol}`);
                }
                throw new Error(`Transfer failed: ${JSON.stringify(err)}`);
            }
            
            // Update pending bid with new balance
            setPendingBid(prev => prev ? { ...prev, escrowBalance: buyoutAmountE8s } : null);
            
            // Step 3: Auto-confirm bid (buyout)
            setBuyoutProgress('Confirming buyout...');
            
            const confirmResult = await actor.confirmBid(bidId, buyoutAmountE8s);
            
            if ('err' in confirmResult) {
                throw new Error(getErrorMessage(confirmResult.err));
            }
            
            // Success! Clear pending bid and refresh
            setPendingBid(null);
            setBuyoutProgress('');
            alert('Buyout successful! You now own the assets.');
            await fetchOffer();
            fetchUserBalance(); // Refresh balance
            
        } catch (e) {
            console.error('Failed during buyout process:', e);
            setError(e.message || 'Failed to complete buyout');
            setBuyoutProgress('');
            
            // If reservation failed, clear pending bid
            if (!bidId) {
                setPendingBid(null);
            }
        } finally {
            setActionLoading(false);
            setBuyoutProgress('');
        }
    };
    
    const handleAcceptBid = async () => {
        if (!identity || !offer) return;
        
        setActionLoading(true);
        setError('');
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.acceptBid(BigInt(id));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            alert('Bid accepted! The offer is now completed.');
            await fetchOffer();
        } catch (e) {
            console.error('Failed to accept bid:', e);
            setError(e.message || 'Failed to accept bid');
        } finally {
            setActionLoading(false);
        }
    };
    
    const handleCancelOffer = async () => {
        if (!identity || !offer) return;
        
        if (!window.confirm('Are you sure you want to cancel this offer?')) return;
        
        setActionLoading(true);
        setError('');
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.cancelOffer(BigInt(id));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            alert('Offer cancelled.');
            navigate('/sneedex_my');
        } catch (e) {
            console.error('Failed to cancel offer:', e);
            setError(e.message || 'Failed to cancel offer');
        } finally {
            setActionLoading(false);
        }
    };
    
    const handleClaimAssets = async () => {
        if (!identity || !offer) return;
        
        setActionLoading(true);
        setError('');
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.claimAssets(BigInt(id));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            alert('Assets claimed successfully!');
            await fetchOffer();
        } catch (e) {
            console.error('Failed to claim assets:', e);
            setError(e.message || 'Failed to claim assets');
        } finally {
            setActionLoading(false);
        }
    };
    
    const handleClaimPayment = async () => {
        if (!identity || !offer) return;
        
        setActionLoading(true);
        setError('');
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.claimWinningBid(BigInt(id));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            alert('Payment claimed successfully!');
            await fetchOffer();
        } catch (e) {
            console.error('Failed to claim payment:', e);
            setError(e.message || 'Failed to claim payment');
        } finally {
            setActionLoading(false);
        }
    };
    
    const handleFinalizeAssets = async () => {
        if (!identity || !offer) return;
        
        setActionLoading(true);
        setError('');
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.finalizeAssets(BigInt(id));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            alert('Assets finalized! You can now verify and escrow each asset.');
            await fetchOffer();
        } catch (e) {
            console.error('Failed to finalize assets:', e);
            setError(e.message || 'Failed to finalize assets');
        } finally {
            setActionLoading(false);
        }
    };
    
    const [escrowingAsset, setEscrowingAsset] = useState(null);
    
    const handleEscrowCanister = async (assetIndex) => {
        if (!identity || !offer) return;
        
        setEscrowingAsset(assetIndex);
        setError('');
        try {
            // Get the canister ID from the asset
            const assetEntry = offer.assets[assetIndex];
            const details = getAssetDetails(assetEntry);
            const canisterId = details.canister_id;
            
            if (!canisterId) {
                throw new Error('Could not find canister ID');
            }
            
            const canisterPrincipal = Principal.fromText(canisterId);
            const sneedexPrincipal = Principal.fromText(SNEEDEX_CANISTER_ID);
            const host = getHost();
            const agent = HttpAgent.createSync({ host, identity });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const managementCanister = Actor.createActor(managementIdlFactory, {
                agent,
                canisterId: MANAGEMENT_CANISTER_ID,
                callTransform: (methodName, args, callConfig) => ({
                    ...callConfig,
                    effectiveCanisterId: canisterPrincipal,
                }),
            });
            
            // Step 1: Get current controllers
            const status = await managementCanister.canister_status({ canister_id: canisterPrincipal });
            const currentControllers = status.settings.controllers;
            
            // Check if Sneedex is already a controller
            const sneedexIsController = currentControllers.some(c => c.toString() === SNEEDEX_CANISTER_ID);
            
            if (!sneedexIsController) {
                // Step 2: Add Sneedex as a controller
                const newControllers = [...currentControllers, sneedexPrincipal];
                await managementCanister.update_settings({
                    canister_id: canisterPrincipal,
                    settings: {
                        controllers: [newControllers],
                        compute_allocation: [],
                        memory_allocation: [],
                        freezing_threshold: [],
                        reserved_cycles_limit: [],
                        log_visibility: [],
                        wasm_memory_limit: [],
                    },
                });
            }
            
            // Step 3: Call backend to verify and complete escrow
            const actor = createSneedexActor(identity);
            const result = await actor.escrowCanister(BigInt(id), BigInt(assetIndex));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            alert('Canister escrowed successfully! Sneedex is now a controller.');
            await fetchOffer();
        } catch (e) {
            console.error('Failed to escrow canister:', e);
            setError(e.message || 'Failed to escrow canister. Make sure you are a controller of the canister.');
        } finally {
            setEscrowingAsset(null);
        }
    };
    
    const handleEscrowSNSNeuron = async (assetIndex) => {
        if (!identity || !offer) return;
        
        setEscrowingAsset(assetIndex);
        setError('');
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.escrowSNSNeuron(BigInt(id), BigInt(assetIndex));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            alert('SNS Neuron escrowed successfully!');
            await fetchOffer();
        } catch (e) {
            console.error('Failed to escrow neuron:', e);
            setError(e.message || 'Failed to escrow neuron. Make sure Sneedex is added as a hotkey.');
        } finally {
            setEscrowingAsset(null);
        }
    };
    
    const handleEscrowICRC1Tokens = async (assetIndex) => {
        if (!identity || !offer) return;
        
        setEscrowingAsset(assetIndex);
        setError('');
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.escrowICRC1Tokens(BigInt(id), BigInt(assetIndex));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            alert('Tokens escrowed successfully!');
            await fetchOffer();
        } catch (e) {
            console.error('Failed to escrow tokens:', e);
            setError(e.message || 'Failed to escrow tokens. Make sure you have sent tokens to the escrow subaccount.');
        } finally {
            setEscrowingAsset(null);
        }
    };
    
    const handleActivateOffer = async () => {
        if (!identity || !offer) return;
        
        setActionLoading(true);
        setError('');
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.activateOffer(BigInt(id));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            alert('Offer activated! It is now live on the marketplace.');
            await fetchOffer();
        } catch (e) {
            console.error('Failed to activate offer:', e);
            setError(e.message || 'Failed to activate offer. Make sure all assets are escrowed.');
        } finally {
            setActionLoading(false);
        }
    };
    
    const isCreator = identity && offer && offer.creator.toString() === identity.getPrincipal().toString();
    const isActive = offer && 'Active' in offer.state;
    const isCompleted = offer && 'Completed' in offer.state;

    const styles = {
        container: {
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '2rem',
            color: theme.colors.primaryText,
        },
        backButton: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            color: theme.colors.mutedText,
            textDecoration: 'none',
            marginBottom: '1.5rem',
            fontSize: '0.95rem',
            transition: 'color 0.3s ease',
        },
        header: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '2rem',
            flexWrap: 'wrap',
            gap: '1rem',
        },
        titleSection: {
            flex: 1,
        },
        title: {
            fontSize: '2.5rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
            marginBottom: '0.5rem',
        },
        subtitle: {
            color: theme.colors.mutedText,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
        },
        refreshButton: {
            background: theme.colors.tertiaryBg,
            color: theme.colors.primaryText,
            padding: '8px 16px',
            borderRadius: '8px',
            border: `1px solid ${theme.colors.border}`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
        },
        statusBadge: {
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '0.9rem',
            fontWeight: '600',
        },
        mainContent: {
            display: 'grid',
            gridTemplateColumns: '1fr 400px',
            gap: '2rem',
        },
        leftColumn: {
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
        },
        rightColumn: {
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
        },
        card: {
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
            padding: '1.5rem',
        },
        cardTitle: {
            fontSize: '1.2rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
        },
        assetsList: {
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
        },
        assetItem: {
            background: theme.colors.tertiaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '12px',
            padding: '1rem',
        },
        assetHeader: {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '0.75rem',
        },
        assetType: {
            fontSize: '1rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
        },
        assetDetail: {
            fontSize: '0.85rem',
            color: theme.colors.mutedText,
            marginBottom: '0.25rem',
            fontFamily: 'monospace',
            wordBreak: 'break-all',
        },
        escrowBadge: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '0.75rem',
            padding: '4px 8px',
            borderRadius: '4px',
            marginTop: '0.5rem',
        },
        priceCard: {
            background: `linear-gradient(145deg, ${theme.colors.secondaryBg}, ${theme.colors.tertiaryBg})`,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
            padding: '1.5rem',
        },
        priceRow: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.75rem 0',
            borderBottom: `1px solid ${theme.colors.border}`,
        },
        priceLabel: {
            color: theme.colors.mutedText,
            fontSize: '0.9rem',
        },
        priceValue: {
            fontSize: '1.2rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
        },
        bidSection: {
            marginTop: '1rem',
        },
        bidInputRow: {
            display: 'flex',
            gap: '0.5rem',
            marginBottom: '0.75rem',
        },
        bidInput: {
            flex: 1,
            padding: '12px 16px',
            borderRadius: '10px',
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.primaryBg,
            color: theme.colors.primaryText,
            fontSize: '1rem',
            outline: 'none',
        },
        bidButton: {
            background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}cc)`,
            color: theme.colors.primaryBg,
            padding: '12px 24px',
            borderRadius: '10px',
            border: 'none',
            fontSize: '1rem',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
        },
        buyoutButton: {
            width: '100%',
            background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}cc)`,
            color: theme.colors.primaryBg,
            padding: '14px',
            borderRadius: '10px',
            border: 'none',
            fontSize: '1.1rem',
            fontWeight: '700',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            marginTop: '0.5rem',
        },
        minBidHint: {
            fontSize: '0.85rem',
            color: theme.colors.mutedText,
            marginBottom: '1rem',
        },
        errorText: {
            color: theme.colors.error || '#ff4444',
            background: `${theme.colors.error || '#ff4444'}15`,
            padding: '12px',
            borderRadius: '8px',
            fontSize: '0.9rem',
            marginTop: '0.75rem',
        },
        bidsList: {
            maxHeight: '300px',
            overflowY: 'auto',
        },
        bidItem: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.75rem',
            borderBottom: `1px solid ${theme.colors.border}`,
        },
        bidder: {
            fontSize: '0.85rem',
            fontFamily: 'monospace',
            color: theme.colors.mutedText,
        },
        bidAmountValue: {
            fontSize: '1rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
        },
        noBids: {
            textAlign: 'center',
            padding: '2rem',
            color: theme.colors.mutedText,
        },
        creatorActions: {
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            marginTop: '1rem',
        },
        acceptButton: {
            width: '100%',
            background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}cc)`,
            color: theme.colors.primaryBg,
            padding: '12px',
            borderRadius: '10px',
            border: 'none',
            fontSize: '1rem',
            fontWeight: '600',
            cursor: 'pointer',
        },
        cancelButton: {
            width: '100%',
            background: 'transparent',
            color: theme.colors.error || '#ff4444',
            padding: '12px',
            borderRadius: '10px',
            border: `2px solid ${theme.colors.error || '#ff4444'}`,
            fontSize: '1rem',
            fontWeight: '600',
            cursor: 'pointer',
        },
        loadingState: {
            textAlign: 'center',
            padding: '4rem 2rem',
            color: theme.colors.mutedText,
        },
    };
    
    const getStatusBadgeStyle = () => {
        if (!offer) return {};
        if ('Active' in offer.state) {
            return { ...styles.statusBadge, background: `${theme.colors.success}20`, color: theme.colors.success };
        }
        if ('Completed' in offer.state) {
            return { ...styles.statusBadge, background: `${theme.colors.accent}20`, color: theme.colors.accent };
        }
        return { ...styles.statusBadge, background: `${theme.colors.mutedText}20`, color: theme.colors.mutedText };
    };

    if (loading) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main style={styles.container}>
                    <div style={styles.loadingState}>
                        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⏳</div>
                        Loading offer...
                    </div>
                </main>
            </div>
        );
    }

    if (!offer) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main style={styles.container}>
                    <Link to="/sneedex_offers" style={styles.backButton}>
                        <FaArrowLeft /> Back to Marketplace
                    </Link>
                    <div style={styles.loadingState}>
                        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>❌</div>
                        Offer not found
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={styles.container}>
                <Link 
                    to="/sneedex_offers" 
                    style={styles.backButton}
                    onMouseEnter={(e) => e.target.style.color = theme.colors.accent}
                    onMouseLeave={(e) => e.target.style.color = theme.colors.mutedText}
                >
                    <FaArrowLeft /> Back to Marketplace
                </Link>
                
                <div style={styles.header}>
                    <div style={styles.titleSection}>
                        <h1 style={styles.title}>Offer #{Number(offer.id)}</h1>
                        <div style={styles.subtitle}>
                            <FaUser /> Created by {offer.creator.toString().slice(0, 12)}...
                        </div>
                    </div>
                    <button style={styles.refreshButton} onClick={fetchOffer}>
                        <FaSync /> Refresh
                    </button>
                    <span style={getStatusBadgeStyle()}>{getOfferStateString(offer.state)}</span>
                </div>
                
                {error && <div style={styles.errorText}>{error}</div>}
                
                <div style={styles.mainContent}>
                    {/* Left Column - Assets & Details */}
                    <div style={styles.leftColumn}>
                        {/* Assets */}
                        <div style={styles.card}>
                            <h3 style={styles.cardTitle}>
                                <FaCubes /> Assets in this Offer
                            </h3>
                            
                            {/* Escrow instructions for creator - only show in PendingEscrow state */}
                            {isCreator && 'PendingEscrow' in offer.state && offer.assets.some(a => !a.escrowed) && (
                                <div style={{
                                    background: `${theme.colors.accent}10`,
                                    border: `1px solid ${theme.colors.accent}40`,
                                    borderRadius: '10px',
                                    padding: '1rem',
                                    marginBottom: '1rem',
                                    fontSize: '0.85rem',
                                }}>
                                    <strong style={{ color: theme.colors.accent }}>📋 How to Escrow Assets:</strong>
                                    <ul style={{ margin: '0.5rem 0 0 1rem', padding: 0, color: theme.colors.secondaryText, lineHeight: 1.8 }}>
                                        <li><strong>Canisters:</strong> Add <code style={{ background: theme.colors.tertiaryBg, padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem' }}>{SNEEDEX_CANISTER_ID}</code> as a controller</li>
                                        <li><strong>SNS Neurons:</strong> Add Sneedex as a hotkey with full permissions</li>
                                        <li><strong>ICRC1 Tokens:</strong> Transfer tokens to the escrow subaccount</li>
                                    </ul>
                                    <div style={{ marginTop: '0.75rem', color: theme.colors.mutedText, fontSize: '0.8rem' }}>
                                        After adding Sneedex, click "Verify & Escrow" on each asset below.
                                    </div>
                                </div>
                            )}
                            <div style={styles.assetsList}>
                                {offer.assets.map((assetEntry, idx) => {
                                    const details = getAssetDetails(assetEntry);
                                    const isDraftOrPending = 'Draft' in offer.state || 'PendingEscrow' in offer.state;
                                    const isPendingEscrow = 'PendingEscrow' in offer.state;
                                    
                                    // Check verification status for each asset type
                                    let canEscrow = false;
                                    let verificationStatus = null;
                                    
                                    if (isCreator && !details.escrowed && isDraftOrPending) {
                                        if (details.type === 'Canister') {
                                            const canisterId = details.canister_id;
                                            canEscrow = canisterId && canisterControllerStatus[canisterId] === true;
                                            verificationStatus = canisterControllerStatus[canisterId];
                                        } else if (details.type === 'SNSNeuron') {
                                            const governanceId = details.governance_id;
                                            const neuronIdHex = details.neuron_id;
                                            const key = `${governanceId}_${neuronIdHex}`;
                                            verificationStatus = neuronPermissionStatus[key];
                                            canEscrow = verificationStatus?.verified === true;
                                        } else if (details.type === 'ICRC1Token') {
                                            const ledgerId = details.ledger_id;
                                            verificationStatus = tokenBalanceStatus[ledgerId];
                                            canEscrow = verificationStatus?.verified === true;
                                        }
                                    }
                                    
                                    return (
                                        <div key={idx} style={styles.assetItem}>
                                            <div style={styles.assetHeader}>
                                                {getAssetTypeIcon(details.type)}
                                                <span style={styles.assetType}>
                                                    {details.type === 'Canister' && 'Canister'}
                                                    {details.type === 'SNSNeuron' && 'SNS Neuron'}
                                                    {details.type === 'ICRC1Token' && `${formatAmount(details.amount)} Tokens`}
                                                </span>
                                            </div>
                                            {details.type === 'Canister' && (
                                                <div style={styles.assetDetail}>
                                                    ID: {details.canister_id}
                                                </div>
                                            )}
                                            {details.type === 'SNSNeuron' && (
                                                <>
                                                    <div style={styles.assetDetail}>Governance: {details.governance_id}</div>
                                                    <div style={styles.assetDetail}>Neuron: {details.neuron_id}</div>
                                                </>
                                            )}
                                            {details.type === 'ICRC1Token' && (
                                                <div style={styles.assetDetail}>Ledger: {details.ledger_id}</div>
                                            )}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                                                <span style={{
                                                    ...styles.escrowBadge,
                                                    background: details.escrowed ? `${theme.colors.success}20` : `${theme.colors.warning}20`,
                                                    color: details.escrowed ? theme.colors.success : theme.colors.warning,
                                                }}>
                                                    {details.escrowed ? <><FaCheck /> Escrowed</> : <><FaClock /> Pending Escrow</>}
                                                </span>
                                                
                                                {/* Show verification status for all asset types (Draft and PendingEscrow) */}
                                                {!details.escrowed && isDraftOrPending && isCreator && (
                                                    checkingAssets ? (
                                                        <span style={{
                                                            fontSize: '0.75rem',
                                                            color: theme.colors.mutedText,
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '6px',
                                                        }}>
                                                            <FaSync style={{ animation: 'spin 1s linear infinite' }} /> Verifying...
                                                        </span>
                                                    ) : verificationStatus === true || verificationStatus?.verified === true ? (
                                                        <span style={{
                                                            fontSize: '0.75rem',
                                                            color: theme.colors.success,
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '4px',
                                                        }}>
                                                            <FaCheck /> {
                                                                details.type === 'Canister' ? 'You are a controller - ready to escrow' :
                                                                details.type === 'SNSNeuron' ? (verificationStatus?.message || 'Has permissions') :
                                                                details.type === 'ICRC1Token' ? (verificationStatus?.message || 'Sufficient balance') :
                                                                'Ready'
                                                            }
                                                        </span>
                                                    ) : verificationStatus === false || verificationStatus?.verified === false ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                            <span style={{
                                                                fontSize: '0.75rem',
                                                                color: theme.colors.warning,
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '4px',
                                                            }}>
                                                                <FaTimes /> {
                                                                    details.type === 'Canister' ? 'You must be a controller to escrow' :
                                                                    details.type === 'SNSNeuron' ? (verificationStatus?.message || 'Missing permissions - add hotkey manually') :
                                                                    details.type === 'ICRC1Token' ? (verificationStatus?.message || 'Insufficient balance') :
                                                                    'Cannot auto-escrow'
                                                                }
                                                            </span>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    checkAllPendingAssets();
                                                                }}
                                                                style={{
                                                                    background: 'transparent',
                                                                    border: `1px solid ${theme.colors.accent}`,
                                                                    color: theme.colors.accent,
                                                                    padding: '3px 8px',
                                                                    borderRadius: '4px',
                                                                    fontSize: '0.7rem',
                                                                    cursor: 'pointer',
                                                                }}
                                                            >
                                                                <FaSync /> Recheck
                                                            </button>
                                                        </div>
                                                    ) : null
                                                )}
                                                
                                                {/* Escrow button only in PendingEscrow state */}
                                                {canEscrow && isPendingEscrow && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (details.type === 'Canister') handleEscrowCanister(idx);
                                                            else if (details.type === 'SNSNeuron') handleEscrowSNSNeuron(idx);
                                                            else if (details.type === 'ICRC1Token') handleEscrowICRC1Tokens(idx);
                                                        }}
                                                        disabled={escrowingAsset === idx}
                                                        style={{
                                                            background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}cc)`,
                                                            color: theme.colors.primaryBg,
                                                            border: 'none',
                                                            padding: '6px 12px',
                                                            borderRadius: '6px',
                                                            fontSize: '0.8rem',
                                                            fontWeight: '600',
                                                            cursor: 'pointer',
                                                            opacity: escrowingAsset === idx ? 0.7 : 1,
                                                        }}
                                                    >
                                                        {escrowingAsset === idx ? 'Verifying...' : '🔒 Verify & Escrow'}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        
                        {/* Bids History */}
                        <div style={styles.card}>
                            <h3 style={styles.cardTitle}>
                                <FaGavel /> Bid History ({bids.length})
                            </h3>
                            {bids.length === 0 ? (
                                <div style={styles.noBids}>No bids yet. Be the first!</div>
                            ) : (
                                <div style={styles.bidsList}>
                                    {bids.sort((a, b) => Number(b.amount) - Number(a.amount)).map((bid, idx) => (
                                        <div key={Number(bid.id)} style={styles.bidItem}>
                                            <div>
                                                <div style={styles.bidder}>{bid.bidder.toString().slice(0, 12)}...</div>
                                                <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText }}>
                                                    {formatDate(bid.created_at)} • {getBidStateString(bid.state)}
                                                </div>
                                            </div>
                                            <div style={styles.bidAmountValue}>
                                                {formatAmount(bid.amount, tokenInfo.decimals)} {tokenInfo.symbol}
                                                {idx === 0 && <span style={{ color: theme.colors.success, marginLeft: '8px' }}>👑</span>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    
                    {/* Right Column - Pricing & Actions */}
                    <div style={styles.rightColumn}>
                        <div style={styles.priceCard}>
                            <div style={styles.priceRow}>
                                <span style={styles.priceLabel}>Minimum Bid</span>
                                <span style={styles.priceValue}>
                                    {offer.min_bid_price[0] ? `${formatAmount(offer.min_bid_price[0], tokenInfo.decimals)} ${tokenInfo.symbol}` : '—'}
                                </span>
                            </div>
                            <div style={styles.priceRow}>
                                <span style={styles.priceLabel}>Buyout Price</span>
                                <span style={styles.priceValue}>
                                    {offer.buyout_price[0] ? `${formatAmount(offer.buyout_price[0], tokenInfo.decimals)} ${tokenInfo.symbol}` : '—'}
                                </span>
                            </div>
                            <div style={styles.priceRow}>
                                <span style={styles.priceLabel}>Current Highest Bid</span>
                                <span style={{ ...styles.priceValue, color: theme.colors.success }}>
                                    {highestBid ? `${formatAmount(highestBid.amount, tokenInfo.decimals)} ${tokenInfo.symbol}` : 'No bids'}
                                </span>
                            </div>
                            <div style={{ ...styles.priceRow, borderBottom: 'none' }}>
                                <span style={styles.priceLabel}>Time Remaining</span>
                                <span style={{ ...styles.priceValue, color: theme.colors.warning }}>
                                    <FaClock style={{ marginRight: '8px' }} />
                                    {formatTimeRemaining(offer.expiration[0])}
                                </span>
                            </div>
                            
                            {isActive && isAuthenticated && !pendingBid && (
                                <div style={styles.bidSection}>
                                    <div style={{ 
                                        display: 'flex', 
                                        justifyContent: 'space-between', 
                                        alignItems: 'center',
                                        marginBottom: '0.75rem',
                                        fontSize: '0.85rem'
                                    }}>
                                        <span style={{ color: theme.colors.mutedText }}>
                                            Min: {getMinimumBid().toFixed(4)} {tokenInfo.symbol}
                                        </span>
                                        <span style={{ color: theme.colors.text }}>
                                            <FaWallet style={{ marginRight: '6px', opacity: 0.7 }} />
                                            {userBalance !== null ? (
                                                <span style={{ fontWeight: '600' }}>
                                                    {formatAmount(userBalance, tokenInfo.decimals)} {tokenInfo.symbol}
                                                </span>
                                            ) : (
                                                <span style={{ opacity: 0.5 }}>Loading...</span>
                                            )}
                                        </span>
                                    </div>
                                    <div style={styles.bidInputRow}>
                                        <input
                                            type="number"
                                            step="0.0001"
                                            placeholder={`Amount in ${tokenInfo.symbol}`}
                                            style={styles.bidInput}
                                            value={bidAmount}
                                            onChange={(e) => setBidAmount(e.target.value)}
                                            onFocus={(e) => e.target.style.borderColor = theme.colors.accent}
                                            onBlur={(e) => e.target.style.borderColor = theme.colors.border}
                                        />
                                        <button
                                            style={styles.bidButton}
                                            onClick={handlePlaceBid}
                                            disabled={bidding}
                                        >
                                            {bidding ? (bidProgress || 'Processing...') : 'Place Bid'}
                                        </button>
                                    </div>
                                    {offer.buyout_price[0] && (
                                        <button
                                            style={styles.buyoutButton}
                                            onClick={handleBuyout}
                                            disabled={actionLoading}
                                        >
                                            {actionLoading && buyoutProgress ? buyoutProgress : `⚡ Instant Buyout for ${formatAmount(offer.buyout_price[0], tokenInfo.decimals)} ${tokenInfo.symbol}`}
                                        </button>
                                    )}
                                </div>
                            )}
                            
                            {/* Pending bid confirmation */}
                            {pendingBid && (
                                <div style={{
                                    background: `${theme.colors.accent}10`,
                                    border: `2px solid ${theme.colors.accent}`,
                                    borderRadius: '12px',
                                    padding: '1.5rem',
                                    marginTop: '1rem',
                                    position: 'relative'
                                }}>
                                    {/* Loading overlay during auto-pay-and-confirm */}
                                    {(bidding || (actionLoading && buyoutProgress)) && (
                                        <div style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            right: 0,
                                            bottom: 0,
                                            background: `${theme.colors.primaryBg}ee`,
                                            borderRadius: '12px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            zIndex: 10,
                                            gap: '1rem'
                                        }}>
                                            <div style={{
                                                width: '48px',
                                                height: '48px',
                                                border: `4px solid ${theme.colors.border}`,
                                                borderTopColor: theme.colors.accent,
                                                borderRadius: '50%',
                                                animation: 'spin 1s linear infinite'
                                            }} />
                                            <div style={{
                                                fontSize: '1.1rem',
                                                fontWeight: '600',
                                                color: theme.colors.accent
                                            }}>
                                                {bidProgress || buyoutProgress || 'Processing...'}
                                            </div>
                                            <div style={{
                                                fontSize: '0.85rem',
                                                color: theme.colors.mutedText
                                            }}>
                                                Please wait, do not close this page
                                            </div>
                                        </div>
                                    )}
                                    
                                    <h4 style={{ 
                                        margin: '0 0 1rem 0', 
                                        color: pendingBid.isBuyout ? theme.colors.success : theme.colors.accent,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}>
                                        <FaGavel /> {pendingBid.isBuyout ? '⚡ Buyout' : 'Bid'} Reserved - Complete Payment
                                    </h4>
                                    
                                    {/* Bid details */}
                                    <div style={{ 
                                        background: theme.colors.background,
                                        borderRadius: '8px',
                                        padding: '1rem',
                                        marginBottom: '1rem',
                                        fontSize: '0.9rem'
                                    }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                            <p style={{ margin: 0 }}><strong>Bid ID:</strong></p>
                                            <p style={{ margin: 0 }}>{pendingBid.bidId.toString()}</p>
                                            
                                            <p style={{ margin: 0 }}><strong>Bid Amount:</strong></p>
                                            <p style={{ margin: 0 }}>{pendingBid.displayAmount} {tokenInfo.symbol}</p>
                                            
                                            <p style={{ margin: 0 }}><strong>Escrow Balance:</strong></p>
                                            <p style={{ 
                                                margin: 0, 
                                                color: pendingBid.escrowBalance >= pendingBid.amount ? theme.colors.success : theme.colors.warning,
                                                fontWeight: 'bold'
                                            }}>
                                                {formatAmount(pendingBid.escrowBalance || 0n, tokenInfo.decimals)} {tokenInfo.symbol}
                                                {pendingBid.escrowBalance >= pendingBid.amount && ' ✓'}
                                            </p>
                                        </div>
                                    </div>
                                    
                                    {/* Quick pay button */}
                                    <button
                                        style={{
                                            ...styles.acceptButton,
                                            width: '100%',
                                            marginBottom: '1rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '8px'
                                        }}
                                        onClick={handleDirectPayment}
                                        disabled={paymentLoading || (pendingBid.escrowBalance >= pendingBid.amount)}
                                    >
                                        <FaWallet />
                                        {paymentLoading ? 'Processing Payment...' : 
                                         pendingBid.escrowBalance >= pendingBid.amount ? 'Payment Complete ✓' :
                                         `Pay ${pendingBid.displayAmount} ${tokenInfo.symbol} from Wallet`}
                                    </button>
                                    
                                    {/* Manual payment instructions (collapsed) */}
                                    <details style={{ marginBottom: '1rem' }}>
                                        <summary style={{ 
                                            cursor: 'pointer', 
                                            color: theme.colors.mutedText,
                                            fontSize: '0.85rem'
                                        }}>
                                            Or pay manually via CLI/wallet...
                                        </summary>
                                        <div style={{ 
                                            marginTop: '0.5rem',
                                            padding: '0.75rem',
                                            background: theme.colors.cardBackground,
                                            borderRadius: '6px',
                                            fontSize: '0.8rem'
                                        }}>
                                            <p style={{ margin: '0 0 0.5rem 0' }}>
                                                <strong>Canister:</strong> {SNEEDEX_CANISTER_ID}
                                            </p>
                                            <p style={{ margin: '0', wordBreak: 'break-all' }}>
                                                <strong>Subaccount:</strong><br/>
                                                <code style={{ 
                                                    fontSize: '0.75rem'
                                                }}>
                                                    {Array.from(pendingBid.subaccount).map(b => b.toString(16).padStart(2, '0')).join('')}
                                                </code>
                                            </p>
                                        </div>
                                    </details>
                                    
                                    {/* Action buttons */}
                                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                        <button
                                            style={{
                                                ...styles.acceptButton,
                                                flex: '1',
                                                opacity: pendingBid.escrowBalance >= pendingBid.amount ? 1 : 0.6
                                            }}
                                            onClick={handleConfirmBid}
                                            disabled={actionLoading || pendingBid.escrowBalance < pendingBid.amount}
                                            title={pendingBid.escrowBalance < pendingBid.amount ? 
                                                'Send payment first' : 'Confirm your bid'}
                                        >
                                            {actionLoading ? 'Confirming...' : '✓ Confirm Bid'}
                                        </button>
                                        
                                        {pendingBid.escrowBalance > 0n && (
                                            <button
                                                style={{
                                                    ...styles.cancelButton,
                                                    background: 'transparent',
                                                    border: `1px solid ${theme.colors.warning}`,
                                                    color: theme.colors.warning
                                                }}
                                                onClick={handleWithdraw}
                                                disabled={withdrawLoading}
                                            >
                                                {withdrawLoading ? 'Withdrawing...' : 'Withdraw'}
                                            </button>
                                        )}
                                        
                                        <button
                                            style={{
                                                ...styles.cancelButton,
                                                flex: pendingBid.escrowBalance > 0n ? 'none' : '1'
                                            }}
                                            onClick={handleCancelPendingBid}
                                            disabled={actionLoading}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                    
                                    <p style={{ 
                                        margin: '1rem 0 0 0', 
                                        fontSize: '0.8rem',
                                        color: theme.colors.mutedText,
                                        textAlign: 'center'
                                    }}>
                                        <FaSync style={{ marginRight: '4px' }} /> Balance auto-refreshes every 5s
                                    </p>
                                </div>
                            )}
                            
                            {/* Draft state - show finalize button */}
                            {isCreator && 'Draft' in offer.state && (
                                <div style={styles.creatorActions}>
                                    {offer.assets.length > 0 ? (
                                        <>
                                            <div style={{ 
                                                background: `${theme.colors.accent}15`,
                                                border: `1px solid ${theme.colors.accent}`,
                                                borderRadius: '10px',
                                                padding: '1rem',
                                                fontSize: '0.9rem',
                                                color: theme.colors.text,
                                                textAlign: 'center',
                                                marginBottom: '1rem'
                                            }}>
                                                📋 <strong>Step 1:</strong> Your offer has {offer.assets.length} asset{offer.assets.length > 1 ? 's' : ''}. 
                                                Click "Finalize Assets" to lock in your asset list and proceed to escrow.
                                            </div>
                                            <button 
                                                style={styles.acceptButton}
                                                onClick={handleFinalizeAssets}
                                                disabled={actionLoading}
                                            >
                                                {actionLoading ? 'Finalizing...' : '📋 Finalize Assets'}
                                            </button>
                                        </>
                                    ) : (
                                        <div style={{ 
                                            background: `${theme.colors.warning}15`,
                                            border: `1px solid ${theme.colors.warning}`,
                                            borderRadius: '10px',
                                            padding: '1rem',
                                            fontSize: '0.9rem',
                                            color: theme.colors.warning,
                                            textAlign: 'center'
                                        }}>
                                            ⚠️ No assets added yet. Add assets to your offer before finalizing.
                                        </div>
                                    )}
                                    <button 
                                        style={styles.cancelButton}
                                        onClick={handleCancelOffer}
                                        disabled={actionLoading}
                                    >
                                        <FaTimes style={{ marginRight: '8px' }} />
                                        {actionLoading ? 'Processing...' : 'Cancel Offer'}
                                    </button>
                                </div>
                            )}
                            
                            {/* PendingEscrow state - show activate button when all escrowed */}
                            {isCreator && 'PendingEscrow' in offer.state && (
                                <div style={styles.creatorActions}>
                                    {(() => {
                                        const allEscrowed = offer.assets.every(a => a.escrowed);
                                        const pendingCount = offer.assets.filter(a => !a.escrowed).length;
                                        
                                        if (allEscrowed) {
                                            return (
                                                <button 
                                                    style={styles.acceptButton}
                                                    onClick={handleActivateOffer}
                                                    disabled={actionLoading}
                                                >
                                                    {actionLoading ? 'Activating...' : '🚀 Activate Offer'}
                                                </button>
                                            );
                                        } else {
                                            return (
                                                <div style={{ 
                                                    background: `${theme.colors.warning}15`,
                                                    border: `1px solid ${theme.colors.warning}`,
                                                    borderRadius: '10px',
                                                    padding: '1rem',
                                                    fontSize: '0.9rem',
                                                    color: theme.colors.warning,
                                                    textAlign: 'center'
                                                }}>
                                                    ⚠️ {pendingCount} asset{pendingCount > 1 ? 's' : ''} still pending escrow.
                                                    <br />
                                                    <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>
                                                        Use the "Verify & Escrow" buttons above to escrow each asset.
                                                    </span>
                                                </div>
                                            );
                                        }
                                    })()}
                                    <button 
                                        style={styles.cancelButton}
                                        onClick={handleCancelOffer}
                                        disabled={actionLoading}
                                    >
                                        <FaTimes style={{ marginRight: '8px' }} />
                                        {actionLoading ? 'Processing...' : 'Cancel Offer'}
                                    </button>
                                </div>
                            )}
                            
                            {isActive && isCreator && (
                                <div style={styles.creatorActions}>
                                    {bids.length > 0 && (
                                        <button 
                                            style={styles.acceptButton}
                                            onClick={handleAcceptBid}
                                            disabled={actionLoading}
                                        >
                                            {actionLoading ? 'Processing...' : `Accept Highest Bid (${formatAmount(highestBid?.amount, tokenInfo.decimals)} ${tokenInfo.symbol})`}
                                        </button>
                                    )}
                                    {bids.length === 0 && (
                                        <button 
                                            style={styles.cancelButton}
                                            onClick={handleCancelOffer}
                                            disabled={actionLoading}
                                        >
                                            <FaTimes style={{ marginRight: '8px' }} />
                                            {actionLoading ? 'Processing...' : 'Cancel Offer'}
                                        </button>
                                    )}
                                </div>
                            )}
                            
                            {isCompleted && isCreator && (
                                <div style={styles.creatorActions}>
                                    <button 
                                        style={styles.acceptButton}
                                        onClick={handleClaimPayment}
                                        disabled={actionLoading}
                                    >
                                        {actionLoading ? 'Processing...' : '💰 Claim Payment'}
                                    </button>
                                </div>
                            )}
                            
                            {isCompleted && !isCreator && identity && (
                                <div style={styles.creatorActions}>
                                    {/* Check if current user is the winner */}
                                    {highestBid && highestBid.bidder.toString() === identity.getPrincipal().toString() && (
                                        <button 
                                            style={styles.acceptButton}
                                            onClick={handleClaimAssets}
                                            disabled={actionLoading}
                                        >
                                            {actionLoading ? 'Processing...' : '🎁 Claim Your Assets'}
                                        </button>
                                    )}
                                </div>
                            )}
                            
                            {!isAuthenticated && (
                                <div style={{ textAlign: 'center', padding: '1rem', color: theme.colors.mutedText }}>
                                    Connect your wallet to place a bid
                                </div>
                            )}
                        </div>
                        
                        {/* Offer Info */}
                        <div style={styles.card}>
                            <h3 style={styles.cardTitle}>Offer Details</h3>
                            <div style={{ fontSize: '0.9rem', color: theme.colors.mutedText }}>
                                <div style={{ marginBottom: '0.5rem' }}>
                                    <strong>Created:</strong> {formatDate(offer.created_at)}
                                </div>
                                {offer.activated_at[0] && (
                                    <div style={{ marginBottom: '0.5rem' }}>
                                        <strong>Activated:</strong> {formatDate(offer.activated_at[0])}
                                    </div>
                                )}
                                <div style={{ marginBottom: '0.5rem' }}>
                                    <strong>Price Token:</strong> {tokenInfo.symbol}
                                </div>
                                <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                    <strong>Ledger:</strong> {offer.price_token_ledger.toString()}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
            
            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}

export default SneedexOffer;
