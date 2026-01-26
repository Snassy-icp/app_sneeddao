import React, { useState, useEffect, useCallback } from 'react';
import Header from '../components/Header';
import NeuronDisplay from '../components/NeuronDisplay';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { FaArrowLeft, FaClock, FaGavel, FaUser, FaCubes, FaBrain, FaCoins, FaCheck, FaTimes, FaExternalLinkAlt, FaSync, FaWallet, FaChevronDown, FaChevronUp, FaMicrochip, FaMemory, FaBolt, FaLock, FaUserCheck, FaRobot, FaExclamationTriangle } from 'react-icons/fa';
import { Principal } from '@dfinity/principal';
import { Actor, HttpAgent } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { 
    createSneedexActor, 
    createLedgerActor,
    formatAmount, 
    formatDate,
    formatTimeRemaining,
    isOfferPastExpiration,
    getOfferStateString,
    getBidStateString,
    getAssetDetails,
    parseAmount,
    getErrorMessage,
    formatFeeRate,
    calculateMarketplaceFee,
    formatUsd,
    calculateUsdValue,
    SNEEDEX_CANISTER_ID,
    CANISTER_KIND_UNKNOWN,
    CANISTER_KIND_ICP_NEURON_MANAGER,
    CANISTER_KIND_NAMES
} from '../utils/SneedexUtils';
import { createActor as createBackendActor } from 'declarations/app_sneeddao_backend';
import priceService from '../services/PriceService';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneed_icp_neuron_manager_factory';
import { createActor as createGovernanceActor } from 'external/sns_governance';
import { createActor as createICRC1Actor } from 'external/icrc1_ledger';
import { fetchAndCacheSnsData, fetchSnsLogo, getAllSnses } from '../utils/SnsUtils';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import InfoModal from '../components/InfoModal';
import ConfirmationModal from '../ConfirmationModal';

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
    const [bidInputMode, setBidInputMode] = useState('token'); // 'token' or 'usd'
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
    const [expandedAssets, setExpandedAssets] = useState({}); // {assetIndex: boolean}
    const [expandedDescriptions, setExpandedDescriptions] = useState({}); // {assetIndex: boolean} - for long descriptions
    const [publicNoteExpanded, setPublicNoteExpanded] = useState(false); // For long public notes
    const [buyerNoteExpanded, setBuyerNoteExpanded] = useState(false); // For long buyer notes
    const [canisterInfo, setCanisterInfo] = useState({}); // {assetIndex: canisterInfo}
    const [loadingCanisterInfo, setLoadingCanisterInfo] = useState({}); // {assetIndex: boolean}
    const [neuronManagerInfo, setNeuronManagerInfo] = useState({}); // {assetIndex: neuronManagerInfo}
    const [loadingNeuronManagerInfo, setLoadingNeuronManagerInfo] = useState({}); // {assetIndex: boolean}
    const [managerWasmVerification, setManagerWasmVerification] = useState({}); // {assetIndex: {verified, officialVersion}}
    const [neuronInfo, setNeuronInfo] = useState({}); // {assetIndex: neuronInfo}
    const [loadingNeuronInfo, setLoadingNeuronInfo] = useState({}); // {assetIndex: boolean}
    const [tokenMetadata, setTokenMetadata] = useState({}); // {ledgerId: metadata}
    const [loadingTokenMetadata, setLoadingTokenMetadata] = useState({}); // {assetIndex: boolean}
    const [escrowSubaccount, setEscrowSubaccount] = useState(null); // Blob for ICRC1 token escrow
    const [snsData, setSnsData] = useState([]); // All SNS data
    const [snsLogos, setSnsLogos] = useState({}); // {governanceId: logoUrl}
    const [snsSymbols, setSnsSymbols] = useState({}); // {governanceId: tokenSymbol}
    const [tokenLogos, setTokenLogos] = useState({}); // {ledgerId: logoUrl}
    
    // USD pricing state
    const [tokenPrices, setTokenPrices] = useState({}); // ledger_id -> USD price per token
    const [icpPrice, setIcpPrice] = useState(null); // ICP/USD price
    const [assetUsdEstimates, setAssetUsdEstimates] = useState({}); // assetIndex -> USD value
    const [totalUsdEstimate, setTotalUsdEstimate] = useState(null); // Total USD for all assets
    
    // Countdown timer state
    const [timeRemainingMs, setTimeRemainingMs] = useState(null); // Milliseconds remaining
    
    // InfoModal state
    const [infoModal, setInfoModal] = useState({ show: false, title: '', message: '', type: 'info' });
    
    const showInfo = (message, type = 'info', title = '') => {
        setInfoModal({ show: true, title, message, type });
    };
    const closeInfoModal = () => setInfoModal({ ...infoModal, show: false });
    
    // ConfirmationModal state
    const [confirmModal, setConfirmModal] = useState({ show: false, message: '', action: null });
    
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
    
    // Countdown timer for offer expiration
    useEffect(() => {
        if (!offer?.expiration?.[0]) {
            setTimeRemainingMs(null);
            return;
        }
        
        const expirationMs = Number(offer.expiration[0]) / 1_000_000;
        
        const updateRemaining = () => {
            const remaining = expirationMs - Date.now();
            setTimeRemainingMs(remaining > 0 ? remaining : 0);
        };
        
        // Initial update
        updateRemaining();
        
        // Only set up interval if less than 1 hour remaining (or close to it)
        const remaining = expirationMs - Date.now();
        if (remaining > 0 && remaining <= 3600000) { // 1 hour in ms
            const intervalId = setInterval(updateRemaining, 1000);
            return () => clearInterval(intervalId);
        } else if (remaining > 3600000) {
            // For longer times, check every minute to see if we should start the countdown
            const intervalId = setInterval(() => {
                const r = expirationMs - Date.now();
                if (r <= 3600000) {
                    updateRemaining();
                }
            }, 60000);
            return () => clearInterval(intervalId);
        }
    }, [offer?.expiration]);
    
    // Format time remaining with seconds when < 1 hour
    const formatCountdown = useCallback(() => {
        if (timeRemainingMs === null || timeRemainingMs === undefined) {
            return formatTimeRemaining(offer?.expiration?.[0]);
        }
        
        if (timeRemainingMs <= 0) {
            return 'Expired';
        }
        
        const totalSeconds = Math.floor(timeRemainingMs / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        if (hours > 0) {
            return `${hours}h ${minutes}m ${seconds}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        } else {
            return `${seconds}s`;
        }
    }, [timeRemainingMs, offer?.expiration]);
    
    // Check if offer is expired based on countdown
    const isCountdownExpired = timeRemainingMs !== null && timeRemainingMs <= 0;
    
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
    
    // Fetch canister info for an escrowed canister asset
    const fetchCanisterInfo = useCallback(async (assetIndex) => {
        if (!identity || !offer) return;
        
        setLoadingCanisterInfo(prev => ({ ...prev, [assetIndex]: true }));
        
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.getCanisterInfo(BigInt(id), BigInt(assetIndex));
            
            if ('ok' in result) {
                setCanisterInfo(prev => ({ ...prev, [assetIndex]: result.ok }));
            } else {
                console.error('Failed to get canister info:', result.err);
            }
        } catch (e) {
            console.error('Failed to fetch canister info:', e);
        } finally {
            setLoadingCanisterInfo(prev => ({ ...prev, [assetIndex]: false }));
        }
    }, [identity, offer, id]);
    
    // Fetch neuron manager info for an escrowed ICP Neuron Manager canister
    const fetchNeuronManagerInfo = useCallback(async (assetIndex, canisterId) => {
        if (!identity || !offer) return;
        
        setLoadingNeuronManagerInfo(prev => ({ ...prev, [assetIndex]: true }));
        
        try {
            const actor = createSneedexActor(identity);
            console.log('Fetching neuron manager info for canister:', canisterId);
            const result = await actor.getNeuronManagerInfo(Principal.fromText(canisterId));
            console.log('Neuron manager info result:', result);
            
            if ('Ok' in result) {
                const info = result.Ok;
                console.log('Neuron manager info details:', {
                    version: info.version,
                    neuron_count: Number(info.neuron_count),
                    neurons: info.neurons,
                });
                setNeuronManagerInfo(prev => ({ ...prev, [assetIndex]: info }));
                
                // Verify wasm hash against official versions
                // Get module_hash from canisterInfo if already loaded, otherwise fetch via Sneedex backend
                let moduleHashHex = null;
                
                // Try to get from already loaded canister info
                const existingCanisterInfo = canisterInfo[assetIndex];
                if (existingCanisterInfo?.module_hash?.[0]) {
                    moduleHashHex = Array.from(existingCanisterInfo.module_hash[0])
                        .map(b => b.toString(16).padStart(2, '0'))
                        .join('');
                    console.log('Got module hash from existing canister info:', moduleHashHex);
                } else {
                    // Fetch canister info directly via Sneedex backend
                    // Note: getCanisterInfo takes (offerId, assetIndex) not canisterId
                    try {
                        console.log('Fetching canister info via backend for offer', offer.id, 'asset', assetIndex);
                        const canisterInfoResult = await actor.getCanisterInfo(offer.id, BigInt(assetIndex));
                        console.log('Canister info result:', canisterInfoResult);
                        if ('ok' in canisterInfoResult && canisterInfoResult.ok.module_hash?.[0]) {
                            moduleHashHex = Array.from(canisterInfoResult.ok.module_hash[0])
                                .map(b => b.toString(16).padStart(2, '0'))
                                .join('');
                            console.log('Got module hash from backend:', moduleHashHex);
                        }
                    } catch (e) {
                        console.log('Could not get canister info for wasm verification:', e);
                    }
                }
                
                if (moduleHashHex) {
                    try {
                        const host = getHost();
                        const agent = HttpAgent.createSync({ host, identity });
                        if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                            await agent.fetchRootKey();
                        }
                        
                        const factory = createFactoryActor(factoryCanisterId, { agent });
                        console.log('Checking official version by hash:', moduleHashHex);
                        const officialVersionResult = await factory.getOfficialVersionByHash(moduleHashHex);
                        console.log('Official version result:', officialVersionResult);
                        
                        if (officialVersionResult && officialVersionResult.length > 0) {
                            const officialVersion = officialVersionResult[0];
                            const managerVersion = info.version;
                            const managerVersionStr = `${Number(managerVersion.major)}.${Number(managerVersion.minor)}.${Number(managerVersion.patch)}`;
                            const officialVersionStr = `${Number(officialVersion.major)}.${Number(officialVersion.minor)}.${Number(officialVersion.patch)}`;
                            
                            setManagerWasmVerification(prev => ({
                                ...prev,
                                [assetIndex]: {
                                    checked: true,
                                    verified: true,
                                    versionMatch: managerVersionStr === officialVersionStr,
                                    officialVersion: officialVersion,
                                    moduleHash: moduleHashHex,
                                }
                            }));
                        } else {
                            setManagerWasmVerification(prev => ({
                                ...prev,
                                [assetIndex]: {
                                    checked: true,
                                    verified: false,
                                    moduleHash: moduleHashHex,
                                    message: 'Unknown WASM hash',
                                }
                            }));
                        }
                    } catch (e) {
                        console.error('Failed to verify wasm hash:', e);
                        setManagerWasmVerification(prev => ({
                            ...prev,
                            [assetIndex]: {
                                checked: true,
                                verified: false,
                                moduleHash: moduleHashHex,
                                message: 'Verification failed',
                            }
                        }));
                    }
                } else {
                    setManagerWasmVerification(prev => ({
                        ...prev,
                        [assetIndex]: {
                            checked: true,
                            verified: false,
                            moduleHash: null,
                            message: 'Could not get module hash',
                        }
                    }));
                }
            } else {
                console.error('Failed to get neuron manager info:', result.Err);
                setManagerWasmVerification(prev => ({
                    ...prev,
                    [assetIndex]: {
                        checked: true,
                        verified: false,
                        moduleHash: null,
                        message: 'Failed to get neuron manager info',
                    }
                }));
            }
        } catch (e) {
            console.error('Failed to fetch neuron manager info:', e);
            setManagerWasmVerification(prev => ({
                ...prev,
                [assetIndex]: {
                    checked: true,
                    verified: false,
                    moduleHash: null,
                    message: e.message || 'Error fetching info',
                }
            }));
        } finally {
            setLoadingNeuronManagerInfo(prev => ({ ...prev, [assetIndex]: false }));
        }
    }, [identity, canisterInfo, offer]);
    
    // Fetch SNS neuron info directly from governance canister
    const fetchNeuronInfo = useCallback(async (assetIndex, governanceId, neuronIdHex) => {
        if (!identity) return;
        
        setLoadingNeuronInfo(prev => ({ ...prev, [assetIndex]: true }));
        
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
                setNeuronInfo(prev => ({ ...prev, [assetIndex]: result.result[0].Neuron }));
            }
        } catch (e) {
            console.error('Failed to fetch neuron info:', e);
        } finally {
            setLoadingNeuronInfo(prev => ({ ...prev, [assetIndex]: false }));
        }
    }, [identity]);
    
    // Fetch token metadata from ledger
    const fetchTokenMetadata = useCallback(async (assetIndex, ledgerId) => {
        // Check if we already have metadata for this ledger
        if (tokenMetadata[ledgerId]) return;
        
        setLoadingTokenMetadata(prev => ({ ...prev, [assetIndex]: true }));
        
        try {
            const host = getHost();
            const agent = HttpAgent.createSync({ host, identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const ledgerActor = createICRC1Actor(ledgerId, { agent });
            
            const [name, symbol, decimals, fee] = await Promise.all([
                ledgerActor.icrc1_name(),
                ledgerActor.icrc1_symbol(),
                ledgerActor.icrc1_decimals(),
                ledgerActor.icrc1_fee(),
            ]);
            
            setTokenMetadata(prev => ({ 
                ...prev, 
                [ledgerId]: { name, symbol, decimals: Number(decimals), fee: Number(fee) } 
            }));
        } catch (e) {
            console.error('Failed to fetch token metadata:', e);
        } finally {
            setLoadingTokenMetadata(prev => ({ ...prev, [assetIndex]: false }));
        }
    }, [identity, tokenMetadata]);
    
    // Fetch the escrow subaccount for the offer
    const fetchEscrowSubaccountForOffer = useCallback(async () => {
        if (!offer || !identity) return;
        
        try {
            const host = getHost();
            const agent = HttpAgent.createSync({ host, identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const sneedexActor = createSneedexActor(identity);
            const subaccount = await sneedexActor.getOfferEscrowSubaccount(
                Principal.fromText(offer.creator.toString()),
                BigInt(offer.id)
            );
            setEscrowSubaccount(subaccount);
        } catch (e) {
            console.error('Failed to fetch escrow subaccount:', e);
        }
    }, [offer, identity]);
    
    // Fetch SNS data for neuron assets
    const fetchSnsData = useCallback(async () => {
        try {
            // Try to get cached data first
            let data = getAllSnses();
            if (!data || data.length === 0) {
                data = await fetchAndCacheSnsData(identity);
            }
            setSnsData(data || []);
        } catch (e) {
            console.error('Failed to fetch SNS data:', e);
        }
    }, [identity]);
    
    // Fetch SNS logo for a governance canister
    const fetchSnsLogoForGovernance = useCallback(async (governanceId) => {
        if (snsLogos[governanceId]) return;
        
        try {
            const host = getHost();
            const agent = HttpAgent.createSync({ host, identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const logo = await fetchSnsLogo(governanceId, agent);
            if (logo) {
                setSnsLogos(prev => ({ ...prev, [governanceId]: logo }));
            }
        } catch (e) {
            console.error('Failed to fetch SNS logo:', e);
        }
    }, [identity, snsLogos]);
    
    // Fetch SNS token symbol from ledger metadata
    const fetchSnsSymbol = useCallback(async (governanceId) => {
        if (snsSymbols[governanceId]) return;
        
        // Find the SNS to get its ledger ID
        const sns = snsData.find(s => s.canisters?.governance === governanceId);
        const ledgerId = sns?.canisters?.ledger;
        if (!ledgerId) return;
        
        try {
            const host = getHost();
            const agent = HttpAgent.createSync({ host, identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const ledgerActor = createLedgerActor(ledgerId, { agent });
            const metadata = await ledgerActor.icrc1_metadata();
            
            // Find symbol in metadata
            const symbolEntry = metadata.find(([key]) => key === 'icrc1:symbol');
            if (symbolEntry && symbolEntry[1]?.Text) {
                setSnsSymbols(prev => ({ ...prev, [governanceId]: symbolEntry[1].Text }));
            }
        } catch (e) {
            console.warn('Failed to fetch SNS token symbol:', e);
        }
    }, [identity, snsSymbols, snsData]);
    
    // Fetch token logo from ledger metadata
    const fetchTokenLogo = useCallback(async (ledgerId) => {
        if (tokenLogos[ledgerId]) return;
        
        try {
            const host = getHost();
            const agent = HttpAgent.createSync({ host, identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const ledgerActor = createICRC1Actor(ledgerId, { agent });
            const metadata = await ledgerActor.icrc1_metadata();
            
            // Find logo in metadata
            const logoEntry = metadata.find(([key]) => key === 'icrc1:logo');
            if (logoEntry && logoEntry[1] && 'Text' in logoEntry[1]) {
                setTokenLogos(prev => ({ ...prev, [ledgerId]: logoEntry[1].Text }));
            }
        } catch (e) {
            console.error('Failed to fetch token logo:', e);
        }
    }, [identity, tokenLogos]);
    
    // Fetch metadata for payment (bid) token
    useEffect(() => {
        if (offer && identity) {
            const paymentLedger = offer.price_token_ledger.toString();
            // Skip if already in whitelist, already fetched, or is ICP
            const isWhitelisted = whitelistedTokens.some(t => t.ledger_id.toString() === paymentLedger);
            const isIcp = paymentLedger === 'ryjl3-tyaaa-aaaaa-aaaba-cai';
            if (!isWhitelisted && !isIcp && !tokenMetadata[paymentLedger]) {
                fetchTokenMetadata('payment', paymentLedger);
            }
        }
    }, [offer, identity, whitelistedTokens, tokenMetadata, fetchTokenMetadata]);
    
    // Fetch escrow subaccount and token metadata for ICRC1 token assets
    useEffect(() => {
        if (offer && identity) {
            const tokenAssets = offer.assets?.filter(a => 'ICRC1Token' in a.asset) || [];
            if (tokenAssets.length > 0) {
                fetchEscrowSubaccountForOffer();
                // Fetch metadata and logos for all token assets
                tokenAssets.forEach((assetEntry, idx) => {
                    const ledgerId = assetEntry.asset.ICRC1Token.ledger_canister_id.toString();
                    if (!tokenMetadata[ledgerId]) {
                        fetchTokenMetadata(idx, ledgerId);
                    }
                    if (!tokenLogos[ledgerId]) {
                        fetchTokenLogo(ledgerId);
                    }
                });
            }
        }
    }, [offer, identity, fetchEscrowSubaccountForOffer, fetchTokenMetadata, tokenMetadata, fetchTokenLogo, tokenLogos]);
    
    // Fetch SNS data, logos, and neuron info for neuron assets
    useEffect(() => {
        if (offer && identity) {
            const neuronAssets = offer.assets?.filter(a => 'SNSNeuron' in a.asset) || [];
            if (neuronAssets.length > 0) {
                // Fetch SNS data first
                fetchSnsData();
                // Fetch logos and neuron info for all neuron assets
                neuronAssets.forEach((assetEntry, idx) => {
                    const governanceId = assetEntry.asset.SNSNeuron.governance_canister_id.toString();
                    const neuronIdHex = Array.from(assetEntry.asset.SNSNeuron.neuron_id.id)
                        .map(b => b.toString(16).padStart(2, '0'))
                        .join('');
                    
                    if (!snsLogos[governanceId]) {
                        fetchSnsLogoForGovernance(governanceId);
                    }
                    // Fetch token symbol for the SNS
                    if (!snsSymbols[governanceId]) {
                        fetchSnsSymbol(governanceId);
                    }
                    // Also fetch neuron info to show staked amount
                    if (!neuronInfo[idx]) {
                        fetchNeuronInfo(idx, governanceId, neuronIdHex);
                    }
                });
            }
        }
    }, [offer, identity, fetchSnsData, fetchSnsLogoForGovernance, snsLogos, snsSymbols, fetchSnsSymbol, neuronInfo, fetchNeuronInfo]);
    
    // Proactively fetch neuronManagerInfo for ICP Neuron Manager canisters (for USD estimates)
    useEffect(() => {
        if (offer && identity) {
            offer.assets?.forEach((assetEntry, idx) => {
                if ('Canister' in assetEntry.asset && assetEntry.escrowed) {
                    const details = getAssetDetails(assetEntry);
                    if (details.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER && !neuronManagerInfo[idx]) {
                        fetchNeuronManagerInfo(idx, details.canister_id);
                    }
                }
            });
        }
    }, [offer, identity, neuronManagerInfo, fetchNeuronManagerInfo]);
    
    // Toggle asset expansion and fetch info if needed
    const toggleAssetExpanded = useCallback((assetIndex, assetEntry, details) => {
        const isExpanding = !expandedAssets[assetIndex];
        setExpandedAssets(prev => ({ ...prev, [assetIndex]: isExpanding }));
        
        if (isExpanding && assetEntry.escrowed) {
            // Fetch appropriate info based on asset type
            if ('Canister' in assetEntry.asset) {
                // Always fetch canister info
                if (!canisterInfo[assetIndex]) {
                    fetchCanisterInfo(assetIndex);
                }
                // If it's an ICP Neuron Manager, also fetch neuron manager info
                if (details.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER && !neuronManagerInfo[assetIndex]) {
                    fetchNeuronManagerInfo(assetIndex, details.canister_id);
                }
            } else if ('SNSNeuron' in assetEntry.asset && !neuronInfo[assetIndex]) {
                fetchNeuronInfo(assetIndex, details.governance_id, details.neuron_id);
            } else if ('ICRC1Token' in assetEntry.asset && !tokenMetadata[details.ledger_id]) {
                fetchTokenMetadata(assetIndex, details.ledger_id);
            }
        }
    }, [expandedAssets, canisterInfo, neuronManagerInfo, neuronInfo, tokenMetadata, fetchCanisterInfo, fetchNeuronManagerInfo, fetchNeuronInfo, fetchTokenMetadata, offer]);
    
    // Format bytes to human readable
    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };
    
    // Format cycles to human readable
    const formatCycles = (cycles) => {
        if (cycles >= 1_000_000_000_000) {
            return (cycles / 1_000_000_000_000).toFixed(2) + ' T';
        } else if (cycles >= 1_000_000_000) {
            return (cycles / 1_000_000_000).toFixed(2) + ' B';
        } else if (cycles >= 1_000_000) {
            return (cycles / 1_000_000).toFixed(2) + ' M';
        } else if (cycles >= 1_000) {
            return (cycles / 1_000).toFixed(2) + ' K';
        }
        return cycles.toString();
    };
    
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
    
    // Fetch token prices for USD display
    useEffect(() => {
        const fetchPrices = async () => {
            if (!offer) return;
            
            try {
                // Get ICP price first
                const icp = await priceService.getICPUSDPrice();
                setIcpPrice(icp);
                
                // Collect unique ledger IDs
                const ledgerIds = new Set();
                
                // Add payment token
                const paymentLedger = offer.price_token_ledger.toString();
                ledgerIds.add(paymentLedger);
                
                // Add asset tokens
                offer.assets.forEach(assetEntry => {
                    const details = getAssetDetails(assetEntry);
                    if (details.type === 'ICRC1Token') {
                        ledgerIds.add(details.ledger_id);
                    } else if (details.type === 'SNSNeuron') {
                        // Add SNS ledger for neuron assets (handle both data formats)
                        const sns = snsData.find(s => 
                            s.canisters?.governance === details.governance_id ||
                            s.governance_canister_id?.[0]?.toString() === details.governance_id ||
                            s.governance_canister_id?.toString() === details.governance_id
                        );
                        const snsLedger = sns?.canisters?.ledger || 
                                          sns?.ledger_canister_id?.[0]?.toString() || 
                                          sns?.ledger_canister_id?.toString();
                        if (snsLedger) {
                            ledgerIds.add(snsLedger);
                        }
                    }
                });
                
                // Fetch prices for each ledger (silently ignore failures - token may not have pool)
                const prices = {};
                for (const ledgerId of ledgerIds) {
                    try {
                        const token = whitelistedTokens.find(t => t.ledger_id.toString() === ledgerId);
                        const decimals = token ? Number(token.decimals) : 8;
                        const price = await priceService.getTokenUSDPrice(ledgerId, decimals);
                        prices[ledgerId] = price;
                    } catch (e) {
                        // Silently ignore - token may not have an ICPSwap pool
                    }
                }
                setTokenPrices(prices);
            } catch (e) {
                // Silently ignore ICP price fetch errors
            }
        };
        
        fetchPrices();
    }, [offer, whitelistedTokens, snsData]);
    
    // Calculate USD estimates for assets (progressively as data loads)
    // First uses cached values from offer, then updates with live data
    const [usdEstimatesLoading, setUsdEstimatesLoading] = useState(true);
    
    useEffect(() => {
        if (!offer) return;
        // Need either tokenPrices or icpPrice for any estimates
        if (Object.keys(tokenPrices).length === 0 && !icpPrice) return;
        
        const estimates = {};
        let total = 0;
        let hasAnyEstimate = false;
        let hasLoadingAssets = false;
        
        offer.assets.forEach((assetEntry, idx) => {
            const details = getAssetDetails(assetEntry);
            
            if (details.type === 'ICRC1Token') {
                // Token assets - straightforward price × amount
                const ledgerId = details.ledger_id;
                const price = tokenPrices[ledgerId];
                if (price) {
                    const meta = tokenMetadata[ledgerId];
                    const decimals = meta?.decimals || 8;
                    const usd = calculateUsdValue(details.amount, decimals, price);
                    estimates[idx] = usd;
                    total += usd;
                    hasAnyEstimate = true;
                }
            } else if (details.type === 'SNSNeuron') {
                // SNS Neuron - get SNS ledger and calculate from staked amount + maturity
                const sns = snsData.find(s => 
                    s.canisters?.governance === details.governance_id ||
                    s.governance_canister_id?.[0]?.toString() === details.governance_id ||
                    s.governance_canister_id?.toString() === details.governance_id
                );
                const snsLedger = sns?.canisters?.ledger || 
                                  sns?.ledger_canister_id?.[0]?.toString() || 
                                  sns?.ledger_canister_id?.toString();
                const price = snsLedger ? tokenPrices[snsLedger] : null;
                
                if (price) {
                    const nInfo = neuronInfo[idx];
                    if (nInfo) {
                        // Use live data: staked + maturity (both available for disbursement)
                        const stakedE8s = Number(nInfo.cached_neuron_stake_e8s || 0);
                        const maturityE8s = Number(nInfo.maturity_e8s_equivalent || 0);
                        const totalE8s = stakedE8s + maturityE8s;
                        const usd = calculateUsdValue(totalE8s, 8, price);
                        estimates[idx] = usd;
                        total += usd;
                        hasAnyEstimate = true;
                    } else if (details.cached_stake_e8s !== null) {
                        // Use cached stake from offer (doesn't include maturity)
                        const usd = calculateUsdValue(details.cached_stake_e8s, 8, price);
                        estimates[idx] = { value: usd, cached: true };
                        total += usd;
                        hasAnyEstimate = true;
                        hasLoadingAssets = true; // Still loading for more accurate data
                    } else {
                        // No cached or live data yet
                        estimates[idx] = null; // Loading
                        hasLoadingAssets = true;
                    }
                }
            } else if (details.type === 'Canister' && details.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER) {
                // ICP Neuron Manager - calculate from managed neurons' total ICP value
                if (icpPrice) {
                    const mInfo = neuronManagerInfo[idx];
                    if (mInfo?.neurons && mInfo.neurons.length > 0) {
                        // Use live data with maturity
                        let totalIcpE8s = 0;
                        mInfo.neurons.forEach(n => {
                            totalIcpE8s += Number(n.cached_neuron_stake_e8s || 0);
                            totalIcpE8s += Number(n.maturity_e8s_equivalent || 0);
                            totalIcpE8s += Number(n.staked_maturity_e8s_equivalent || 0);
                        });
                        const usd = calculateUsdValue(totalIcpE8s, 8, icpPrice);
                        estimates[idx] = usd;
                        total += usd;
                        hasAnyEstimate = true;
                    } else if (details.cached_total_stake_e8s !== null) {
                        // Use cached total stake from offer (doesn't include maturity)
                        const usd = calculateUsdValue(details.cached_total_stake_e8s, 8, icpPrice);
                        estimates[idx] = { value: usd, cached: true };
                        total += usd;
                        hasAnyEstimate = true;
                        hasLoadingAssets = true; // Still loading for more accurate data
                    } else if (assetEntry.escrowed) {
                        // Escrowed but no data yet
                        estimates[idx] = null; // Loading
                        hasLoadingAssets = true;
                    }
                }
            }
            // Other canisters: can't easily price, skip
        });
        
        setAssetUsdEstimates(estimates);
        setTotalUsdEstimate(hasAnyEstimate ? total : null);
        setUsdEstimatesLoading(hasLoadingAssets);
    }, [offer, tokenPrices, icpPrice, tokenMetadata, neuronInfo, neuronManagerInfo, snsData]);
    
    // Get token info from whitelisted tokens or dynamically fetched metadata
    const tokenInfo = (() => {
        if (!offer) return { symbol: 'TOKEN', decimals: 8, fee: null };
        const ledgerId = offer.price_token_ledger.toString();
        // First check whitelisted tokens
        const token = whitelistedTokens.find(t => t.ledger_id.toString() === ledgerId);
        if (token) {
            return { symbol: token.symbol, decimals: Number(token.decimals), name: token.name, fee: token.fee ? BigInt(token.fee) : null };
        }
        // Then check dynamically fetched metadata
        const cachedMeta = tokenMetadata[ledgerId];
        if (cachedMeta) {
            return { symbol: cachedMeta.symbol, decimals: cachedMeta.decimals, name: cachedMeta.name, fee: cachedMeta.fee ? BigInt(cachedMeta.fee) : null };
        }
        // Fallback for known tokens if not in whitelist
        if (ledgerId === 'ryjl3-tyaaa-aaaaa-aaaba-cai') return { symbol: 'ICP', decimals: 8, fee: BigInt(10000) };
        return { symbol: 'TOKEN', decimals: 8, fee: null };
    })();
    
    const tokenFee = tokenInfo.fee;
    
    // Returns minimum bid in e8s as BigInt - all math done in integers, no floating point
    const getMinimumBidE8s = () => {
        if (!offer) return BigInt(0);
        if (highestBid) {
            // Calculate minimum increment based on min_bid_increment_fee_multiple if set
            let minIncrement;
            if (offer.min_bid_increment_fee_multiple?.[0] && tokenFee) {
                // Increment = multiple × fee (all BigInt math)
                minIncrement = BigInt(offer.min_bid_increment_fee_multiple[0]) * tokenFee;
            } else {
                // Default: 1 smallest unit
                minIncrement = BigInt(1);
            }
            return BigInt(highestBid.amount) + minIncrement;
        }
        if (offer.min_bid_price[0]) {
            return BigInt(offer.min_bid_price[0]);
        }
        if (offer.buyout_price[0]) {
            return BigInt(offer.buyout_price[0]);
        }
        return BigInt(0);
    };
    
    // Convert e8s to decimal for display
    const getMinimumBid = () => {
        return Number(getMinimumBidE8s()) / Math.pow(10, tokenInfo.decimals);
    };
    
    const getAssetTypeIcon = (type, canisterKind) => {
        switch (type) {
            case 'Canister': 
                // Show robot icon with ICP logo overlay for ICP Neuron Manager, otherwise cubes
                if (canisterKind === CANISTER_KIND_ICP_NEURON_MANAGER) {
                    return (
                        <span style={{ position: 'relative', display: 'inline-flex', marginRight: '2px' }}>
                            <FaRobot style={{ color: theme.colors.accent, fontSize: '20px' }} />
                            <img 
                                src="/icp_symbol.svg" 
                                alt="ICP" 
                                style={{ 
                                    width: 12, 
                                    height: 12, 
                                    borderRadius: '50%',
                                    position: 'absolute',
                                    bottom: -2,
                                    right: -4,
                                    border: `1px solid ${theme.colors.cardBg}`,
                                    background: theme.colors.cardBg,
                                }}
                            />
                        </span>
                    );
                }
                return <FaCubes style={{ color: theme.colors.accent }} />;
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
        let amount = parseFloat(bidAmount);
        
        if (isNaN(amount) || amount <= 0) {
            setError('Please enter a valid bid amount');
            return;
        }
        
        // Convert USD to token amount if in USD mode
        if (bidInputMode === 'usd') {
            const paymentLedger = offer.price_token_ledger.toString();
            const paymentPrice = tokenPrices[paymentLedger];
            if (!paymentPrice) {
                setError('Unable to convert USD to token - price not available');
                return;
            }
            amount = amount / paymentPrice;
        }
        
        const minBidE8s = getMinimumBidE8s();
        const minBid = Number(minBidE8s) / Math.pow(10, tokenInfo.decimals);
        if (amount < minBid) {
            setError(`Bid must be at least ${formatAmount(minBidE8s, tokenInfo.decimals)} ${tokenInfo.symbol}`);
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
            showInfo('Bid placed successfully!', 'success');
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
            
            showInfo('Bid confirmed successfully! Your bid is now active.', 'success');
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
            
            showInfo(`Payment successful! Transaction ID: ${result.Ok}\n\nYou can now click "Confirm Bid" to activate your bid.`, 'success', 'Payment Complete');
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
            
            showInfo(`Withdrawal successful! Transaction ID: ${result.ok}`, 'success');
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
            showInfo('Buyout successful! You now own the assets.', 'success');
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
            
            showInfo('Bid accepted! The offer is now completed.', 'success');
            await fetchOffer();
        } catch (e) {
            console.error('Failed to accept bid:', e);
            setError(e.message || 'Failed to accept bid');
        } finally {
            setActionLoading(false);
        }
    };
    
    const handleCancelOffer = () => {
        if (!identity || !offer) return;
        
        const hasBids = bids.length > 0;
        const message = hasBids 
            ? `Are you sure you want to cancel this offer? There ${bids.length === 1 ? 'is 1 bid' : `are ${bids.length} bids`} that will be refunded.`
            : 'Are you sure you want to cancel this offer?';
        
        setConfirmModal({
            show: true,
            message,
            action: async () => {
                setActionLoading(true);
                setError('');
                try {
                    const actor = createSneedexActor(identity);
                    const result = await actor.cancelOffer(BigInt(id));
                    
                    if ('err' in result) {
                        throw new Error(getErrorMessage(result.err));
                    }
                    
                    const successMsg = hasBids 
                        ? 'Offer cancelled. Bidders will be refunded automatically.'
                        : 'Offer cancelled.';
                    showInfo(successMsg, 'success');
                    navigate('/sneedex_my');
                } catch (e) {
                    console.error('Failed to cancel offer:', e);
                    setError(e.message || 'Failed to cancel offer');
                } finally {
                    setActionLoading(false);
                }
            }
        });
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
            
            showInfo('Assets claimed successfully!', 'success');
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
            
            showInfo('Payment claimed successfully!', 'success');
            await fetchOffer();
        } catch (e) {
            console.error('Failed to claim payment:', e);
            setError(e.message || 'Failed to claim payment');
        } finally {
            setActionLoading(false);
        }
    };
    
    const handleProcessExpiration = async () => {
        if (!identity || !offer) return;
        
        setActionLoading(true);
        setError('');
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.processExpiration(BigInt(id));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            // Check if there was a highest bid (auction completes) or not (assets returned)
            const hadBids = bids.length > 0;
            if (hadBids) {
                showInfo('Auction completed! The highest bidder has won.', 'success');
            } else {
                showInfo('Offer expired with no bids. Assets are being returned to the seller.', 'success');
            }
            await fetchOffer();
        } catch (e) {
            console.error('Failed to process expiration:', e);
            setError(e.message || 'Failed to process expiration');
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
            
            showInfo('Assets finalized! You can now verify and escrow each asset.', 'success');
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
            
            showInfo('Canister escrowed successfully! Sneedex is now a controller.', 'success');
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
            
            showInfo('SNS Neuron escrowed successfully!', 'success');
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
        
        const assetEntry = offer.assets[assetIndex];
        if (!assetEntry || !('ICRC1Token' in assetEntry.asset)) {
            setError('Invalid token asset');
            return;
        }
        
        const tokenAsset = assetEntry.asset.ICRC1Token;
        const ledgerId = tokenAsset.ledger_canister_id.toString();
        const amount = tokenAsset.amount;
        
        setEscrowingAsset(assetIndex);
        setError('');
        try {
            const host = getHost();
            const agent = HttpAgent.createSync({ host, identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            // Create actor for the specific token ledger (not ICP)
            const ledgerActor = createICRC1Actor(ledgerId, { agent });
            
            // Get the escrow subaccount
            const sneedexActor = createSneedexActor(identity);
            const escrowSubaccount = await sneedexActor.getOfferEscrowSubaccount(
                offer.creator,
                BigInt(offer.id)
            );
            
            // Transfer tokens to the escrow subaccount
            const transferResult = await ledgerActor.icrc1_transfer({
                to: {
                    owner: Principal.fromText(SNEEDEX_CANISTER_ID),
                    subaccount: [escrowSubaccount],
                },
                amount: amount,
                fee: [],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
            });
            
            if ('Err' in transferResult) {
                throw new Error(`Token transfer failed: ${JSON.stringify(transferResult.Err)}`);
            }
            
            // Now verify the escrow in the backend
            const result = await sneedexActor.escrowICRC1Tokens(BigInt(id), BigInt(assetIndex));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            showInfo('Tokens escrowed successfully!', 'success');
            await fetchOffer();
        } catch (e) {
            console.error('Failed to escrow tokens:', e);
            setError(e.message || 'Failed to escrow tokens. Make sure you have sufficient balance.');
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
            
            showInfo('Offer activated! It is now live on the marketplace.', 'success');
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
    const isClaimed = offer && 'Claimed' in offer.state;
    const isSold = isCompleted || isClaimed;

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
            flexWrap: 'wrap',
        },
        bidInput: {
            flex: '1 1 150px',
            minWidth: '120px',
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
            padding: '12px 16px',
            borderRadius: '10px',
            border: 'none',
            minWidth: '100px',
            whiteSpace: 'nowrap',
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
            maxHeight: '400px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
        },
        bidItem: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '0.85rem 1rem',
            background: theme.colors.tertiaryBg,
            borderRadius: '10px',
            transition: 'all 0.2s ease',
        },
        bidRank: {
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '700',
            fontSize: '0.85rem',
            flexShrink: 0,
        },
        bidInfo: {
            flex: 1,
            minWidth: 0,
        },
        bidder: {
            fontSize: '0.9rem',
            color: theme.colors.primaryText,
            fontWeight: '500',
        },
        bidMeta: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '4px',
            flexWrap: 'wrap',
        },
        bidStateBadge: {
            fontSize: '0.7rem',
            padding: '2px 8px',
            borderRadius: '10px',
            fontWeight: '600',
            textTransform: 'uppercase',
        },
        bidAmountValue: {
            fontSize: '1.1rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
            textAlign: 'right',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
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
                            <FaUser /> Created by <PrincipalDisplay 
                                principal={offer.creator} 
                                short={true}
                                showCopyButton={false}
                                style={{ display: 'inline-flex' }}
                                isAuthenticated={isAuthenticated}
                            />
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
                                {totalUsdEstimate !== null && totalUsdEstimate > 0 ? (
                                    <span style={{ 
                                        marginLeft: '12px', 
                                        fontSize: '0.85rem', 
                                        fontWeight: '500',
                                        color: theme.colors.success,
                                        background: `${theme.colors.success}15`,
                                        padding: '4px 10px',
                                        borderRadius: '6px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                    }}>
                                        ~{formatUsd(totalUsdEstimate)} total
                                        {usdEstimatesLoading && (
                                            <FaSync style={{ 
                                                animation: 'spin 1s linear infinite', 
                                                fontSize: '0.7rem',
                                                opacity: 0.7,
                                            }} title="Updating with live data..." />
                                        )}
                                    </span>
                                ) : (Object.keys(tokenPrices).length > 0 || icpPrice) && offer.assets.some(a => 
                                    ('SNSNeuron' in a.asset) || 
                                    ('ICRC1Token' in a.asset) || 
                                    ('Canister' in a.asset && Number(a.asset.Canister.canister_kind?.[0] || 0) === CANISTER_KIND_ICP_NEURON_MANAGER)
                                ) ? (
                                    <span style={{ 
                                        marginLeft: '12px', 
                                        fontSize: '0.85rem', 
                                        fontWeight: '500',
                                        color: theme.colors.mutedText,
                                        background: `${theme.colors.mutedText}15`,
                                        padding: '4px 10px',
                                        borderRadius: '6px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                    }}>
                                        <FaSync style={{ 
                                            animation: 'spin 1s linear infinite', 
                                            fontSize: '0.7rem',
                                        }} />
                                        Estimating...
                                    </span>
                                ) : null}
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
                                    
                                    const isExpanded = expandedAssets[idx];
                                    const info = canisterInfo[idx];
                                    const isLoadingInfo = loadingCanisterInfo[idx];
                                    const nInfo = neuronInfo[idx];
                                    const isLoadingNeuron = loadingNeuronInfo[idx];
                                    const tMeta = tokenMetadata[details.ledger_id];
                                    const isLoadingToken = loadingTokenMetadata[idx];
                                    
                                    return (
                                        <div key={idx} style={{
                                            ...styles.assetItem,
                                            cursor: details.escrowed ? 'pointer' : 'default',
                                        }}
                                        onClick={() => {
                                            if (details.escrowed) {
                                                toggleAssetExpanded(idx, assetEntry, details);
                                            }
                                        }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ 
                                                        display: 'flex', 
                                                        alignItems: 'center', 
                                                        gap: '12px', 
                                                        marginBottom: '0.75rem',
                                                        justifyContent: 'flex-start',
                                                    }}>
                                                        {/* Show custom icons for tokens and neurons */}
                                                        {details.type === 'ICRC1Token' && (
                                                            <div style={{ 
                                                                position: 'relative', 
                                                                width: '36px', 
                                                                height: '36px', 
                                                                flexShrink: 0,
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                            }}>
                                                                {tokenLogos[details.ledger_id] ? (
                                                                    <img 
                                                                        src={tokenLogos[details.ledger_id]} 
                                                                        alt="Token" 
                                                                        style={{ width: '36px', height: '36px', borderRadius: '50%' }}
                                                                        onError={(e) => { e.target.style.display = 'none'; }}
                                                                    />
                                                                ) : (
                                                                    <FaCoins style={{ fontSize: '28px', color: theme.colors.warning }} />
                                                                )}
                                                            </div>
                                                        )}
                                                        {details.type === 'SNSNeuron' && (
                                                            <div style={{ 
                                                                position: 'relative', 
                                                                width: '40px', 
                                                                height: '36px', 
                                                                flexShrink: 0,
                                                            }}>
                                                                {/* Base neuron icon */}
                                                                <FaBrain style={{ 
                                                                    fontSize: '28px', 
                                                                    color: theme.colors.success,
                                                                    position: 'absolute',
                                                                    left: 0,
                                                                    top: '4px',
                                                                }} />
                                                                {/* Overlay SNS logo */}
                                                                {snsLogos[details.governance_id] && (
                                                                    <img 
                                                                        src={snsLogos[details.governance_id]} 
                                                                        alt="SNS" 
                                                                        style={{ 
                                                                            width: '22px', 
                                                                            height: '22px', 
                                                                            borderRadius: '50%',
                                                                            position: 'absolute',
                                                                            right: 0,
                                                                            bottom: 0,
                                                                            border: `2px solid ${theme.colors.primaryBg}`,
                                                                        }}
                                                                        onError={(e) => { e.target.style.display = 'none'; }}
                                                                    />
                                                                )}
                                                            </div>
                                                        )}
                                                        {details.type === 'Canister' && getAssetTypeIcon(details.type, details.canister_kind)}
                                                        <span style={styles.assetType}>
                                                            {details.type === 'Canister' && (
                                                                details.title 
                                                                    ? details.title 
                                                                    : (details.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER ? 'ICP Neuron Manager' : 'Canister')
                                                            )}
                                                            {details.type === 'SNSNeuron' && (() => {
                                                                // Find SNS name from snsData
                                                                const sns = snsData.find(s => s.canisters?.governance === details.governance_id);
                                                                const snsName = sns?.name || 'SNS';
                                                                return `${snsName} Neuron`;
                                                            })()}
                                                            {details.type === 'ICRC1Token' && (() => {
                                                                const meta = tokenMetadata[details.ledger_id];
                                                                const decimals = meta?.decimals || 8;
                                                                const symbol = meta?.symbol || 'Tokens';
                                                                const displayAmount = Number(details.amount) / Math.pow(10, decimals);
                                                                const rawUsd = assetUsdEstimates[idx];
                                                                const usdValue = typeof rawUsd === 'object' ? rawUsd?.value : rawUsd;
                                                                return (
                                                                    <>
                                                                        Token: {displayAmount.toLocaleString(undefined, { maximumFractionDigits: decimals })} {symbol}
                                                                        {usdValue > 0 && (
                                                                            <span style={{ color: theme.colors.mutedText, marginLeft: '8px', fontSize: '0.85rem' }}>
                                                                                (~{formatUsd(usdValue)})
                                                                            </span>
                                                                        )}
                                                                    </>
                                                                );
                                                            })()}
                                                        </span>
                                                    </div>
                                                    {/* SNS Neuron staked amount on separate line */}
                                                    {details.type === 'SNSNeuron' && (() => {
                                                        const nInfo = neuronInfo[idx];
                                                        const symbol = snsSymbols[details.governance_id] || 'tokens';
                                                        const rawUsd = assetUsdEstimates[idx];
                                                        const usdValue = typeof rawUsd === 'object' ? rawUsd?.value : rawUsd;
                                                        const isCachedUsd = typeof rawUsd === 'object' && rawUsd?.cached;
                                                        
                                                        if (nInfo?.cached_neuron_stake_e8s) {
                                                            const staked = Number(nInfo.cached_neuron_stake_e8s) / 1e8;
                                                            const maturityE8s = Number(nInfo.maturity_e8s_equivalent || 0);
                                                            return (
                                                                <div style={{
                                                                    fontSize: '0.9rem',
                                                                    fontWeight: '600',
                                                                    color: theme.colors.accent,
                                                                    marginTop: '4px',
                                                                }}>
                                                                    {formatAmount(nInfo.cached_neuron_stake_e8s, 8)} {symbol} staked
                                                                    {maturityE8s > 0 && (
                                                                        <span style={{ color: theme.colors.mutedText, fontWeight: '400' }}>
                                                                            {' '}+ {formatAmount(maturityE8s, 8)} maturity
                                                                        </span>
                                                                    )}
                                                                    {usdValue > 0 && (
                                                                        <span style={{ color: theme.colors.success, marginLeft: '8px', fontSize: '0.85rem', fontWeight: '500' }}>
                                                                            (~{formatUsd(usdValue)})
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            );
                                                        } else if (details.cached_stake_e8s !== null) {
                                                            // Show cached stake while loading live data
                                                            return (
                                                                <div style={{
                                                                    fontSize: '0.9rem',
                                                                    fontWeight: '600',
                                                                    color: theme.colors.accent,
                                                                    marginTop: '4px',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px',
                                                                }}>
                                                                    {formatAmount(details.cached_stake_e8s, 8)} {symbol} staked
                                                                    {usdValue > 0 && (
                                                                        <span style={{ color: theme.colors.success, fontSize: '0.85rem', fontWeight: '500' }}>
                                                                            (~{formatUsd(usdValue)})
                                                                        </span>
                                                                    )}
                                                                    <FaSync style={{ 
                                                                        animation: 'spin 1s linear infinite', 
                                                                        fontSize: '0.7rem',
                                                                        color: theme.colors.mutedText,
                                                                    }} title="Loading live data..." />
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    })()}
                                                    {/* ICP Neuron Manager summary line */}
                                                    {details.type === 'Canister' && details.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER && (() => {
                                                        const mInfo = neuronManagerInfo[idx];
                                                        const rawUsd = assetUsdEstimates[idx];
                                                        const usdValue = typeof rawUsd === 'object' ? rawUsd?.value : rawUsd;
                                                        const isCachedUsd = typeof rawUsd === 'object' && rawUsd?.cached;
                                                        
                                                        if (mInfo?.neurons && mInfo.neurons.length > 0) {
                                                            let totalIcpE8s = 0n;
                                                            mInfo.neurons.forEach(n => {
                                                                totalIcpE8s += BigInt(n.cached_neuron_stake_e8s || 0);
                                                                totalIcpE8s += BigInt(n.maturity_e8s_equivalent || 0);
                                                                totalIcpE8s += BigInt(n.staked_maturity_e8s_equivalent || 0);
                                                            });
                                                            return (
                                                                <div style={{
                                                                    fontSize: '0.9rem',
                                                                    fontWeight: '600',
                                                                    color: theme.colors.accent,
                                                                    marginTop: '4px',
                                                                }}>
                                                                    {formatAmount(totalIcpE8s, 8)} ICP total ({mInfo.neurons.length} neuron{mInfo.neurons.length !== 1 ? 's' : ''})
                                                                    {usdValue > 0 && (
                                                                        <span style={{ color: theme.colors.success, marginLeft: '8px', fontSize: '0.85rem', fontWeight: '500' }}>
                                                                            (~{formatUsd(usdValue)})
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            );
                                                        } else if (details.cached_total_stake_e8s !== null && assetEntry.escrowed) {
                                                            // Show cached stake while loading live data
                                                            return (
                                                                <div style={{
                                                                    fontSize: '0.9rem',
                                                                    fontWeight: '600',
                                                                    color: theme.colors.accent,
                                                                    marginTop: '4px',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px',
                                                                }}>
                                                                    ~{formatAmount(details.cached_total_stake_e8s, 8)} ICP staked
                                                                    {usdValue > 0 && (
                                                                        <span style={{ color: theme.colors.success, fontSize: '0.85rem', fontWeight: '500' }}>
                                                                            (~{formatUsd(usdValue)})
                                                                        </span>
                                                                    )}
                                                                    <FaSync style={{ 
                                                                        animation: 'spin 1s linear infinite', 
                                                                        fontSize: '0.7rem',
                                                                        color: theme.colors.mutedText,
                                                                    }} title="Loading live data..." />
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    })()}
                                                    {details.type === 'Canister' && (
                                                        <div style={{...styles.assetDetail, display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap'}}>
                                                            ID: <PrincipalDisplay 
                                                                principal={details.canister_id}
                                                                short={true}
                                                                showCopyButton={false}
                                                                style={{ fontSize: 'inherit' }}
                                                                isAuthenticated={isAuthenticated}
                                                            />
                                                            <Link 
                                                                to={`/canister?id=${details.canister_id}`}
                                                                style={{ 
                                                                    marginLeft: '8px',
                                                                    color: theme.colors.accent,
                                                                    fontSize: '0.75rem',
                                                                    textDecoration: 'none',
                                                                }}
                                                            >
                                                                View Details →
                                                            </Link>
                                                        </div>
                                                    )}
                                                    {details.type === 'SNSNeuron' && !details.escrowed && (() => {
                                                        const sns = snsData.find(s => s.canisters?.governance === details.governance_id);
                                                        const snsRoot = sns?.canisters?.root;
                                                        return (
                                                            <>
                                                                <div style={{...styles.assetDetail, display: 'flex', alignItems: 'center', gap: '4px'}}>
                                                                    Governance: <PrincipalDisplay 
                                                                        principal={details.governance_id}
                                                                        short={true}
                                                                        showCopyButton={false}
                                                                        style={{ fontSize: 'inherit' }}
                                                                        isAuthenticated={isAuthenticated}
                                                                    />
                                                                </div>
                                                                <div style={{...styles.assetDetail, display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap'}}>
                                                                    Neuron: {snsRoot ? (
                                                                        <NeuronDisplay
                                                                            neuronId={details.neuron_id}
                                                                            snsRoot={snsRoot}
                                                                            showCopyButton={true}
                                                                            enableContextMenu={true}
                                                                            isAuthenticated={isAuthenticated}
                                                                            style={{ fontSize: 'inherit' }}
                                                                        />
                                                                    ) : (
                                                                        <span style={{ fontFamily: 'monospace' }}>{details.neuron_id?.slice(0, 16)}...</span>
                                                                    )}
                                                                </div>
                                                                {snsRoot && (
                                                                    <div style={{...styles.assetDetail}}>
                                                                        <Link 
                                                                            to={`/hub?sns=${snsRoot}`}
                                                                            style={{ 
                                                                                color: theme.colors.success,
                                                                                fontSize: '0.75rem',
                                                                                textDecoration: 'none',
                                                                            }}
                                                                        >
                                                                            SNS Hub →
                                                                        </Link>
                                                                    </div>
                                                                )}
                                                            </>
                                                        );
                                                    })()}
                                                    {details.type === 'ICRC1Token' && !details.escrowed && (
                                                        <div style={{...styles.assetDetail, display: 'flex', alignItems: 'center', gap: '4px'}}>
                                                            Ledger: <PrincipalDisplay 
                                                                principal={details.ledger_id}
                                                                short={true}
                                                                showCopyButton={false}
                                                                style={{ fontSize: 'inherit' }}
                                                                isAuthenticated={isAuthenticated}
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                                
                                                {/* Expand/Collapse button for escrowed assets */}
                                                {details.escrowed && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            toggleAssetExpanded(idx, assetEntry, details);
                                                        }}
                                                        style={{
                                                            background: 'transparent',
                                                            border: 'none',
                                                            color: theme.colors.accent,
                                                            cursor: 'pointer',
                                                            padding: '4px',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '4px',
                                                            fontSize: '0.8rem',
                                                        }}
                                                    >
                                                        {isExpanded ? <FaChevronUp /> : <FaChevronDown />}
                                                        {isExpanded ? 'Less' : 'Info'}
                                                    </button>
                                                )}
                                            </div>
                                            
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
                                            
                                            {/* Expanded Canister Info Section */}
                                            {details.type === 'Canister' && isExpanded && (
                                                <div style={{
                                                    marginTop: '1rem',
                                                    padding: '1rem',
                                                    background: theme.colors.secondaryBg,
                                                    borderRadius: '10px',
                                                    borderTop: `1px solid ${theme.colors.border}`,
                                                }}>
                                                    {/* Description (shown first in expanded section) */}
                                                    {details.description && (() => {
                                                        const MAX_DESC_LENGTH = 300;
                                                        const isLongDescription = details.description.length > MAX_DESC_LENGTH;
                                                        // For long descriptions, start collapsed; for short ones, always show full
                                                        const isDescExpanded = isLongDescription ? (expandedDescriptions[idx] === true) : true;
                                                        const displayText = isLongDescription && !isDescExpanded
                                                            ? details.description.slice(0, MAX_DESC_LENGTH) + '...'
                                                            : details.description;
                                                        
                                                        return (
                                                            <div style={{
                                                                marginBottom: '1rem',
                                                                padding: '0.75rem 1rem',
                                                                background: theme.colors.tertiaryBg,
                                                                borderRadius: '8px',
                                                                border: `1px solid ${theme.colors.border}`,
                                                            }}>
                                                                <div style={{
                                                                    fontSize: '0.75rem',
                                                                    fontWeight: '600',
                                                                    color: theme.colors.mutedText,
                                                                    marginBottom: '0.5rem',
                                                                    textTransform: 'uppercase',
                                                                    letterSpacing: '0.5px',
                                                                }}>
                                                                    Description
                                                                </div>
                                                                <div style={{
                                                                    fontSize: '0.85rem',
                                                                    color: theme.colors.secondaryText,
                                                                    lineHeight: '1.5',
                                                                    whiteSpace: 'pre-wrap',
                                                                    wordBreak: 'break-word',
                                                                }}>
                                                                    {/* React automatically escapes text, preventing XSS */}
                                                                    {displayText}
                                                                </div>
                                                                {isLongDescription && (
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setExpandedDescriptions(prev => ({
                                                                                ...prev,
                                                                                [idx]: !isDescExpanded
                                                                            }));
                                                                        }}
                                                                        style={{
                                                                            background: 'transparent',
                                                                            border: 'none',
                                                                            color: theme.colors.accent,
                                                                            cursor: 'pointer',
                                                                            fontSize: '0.8rem',
                                                                            padding: '0.5rem 0 0 0',
                                                                            fontWeight: '500',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '4px',
                                                                        }}
                                                                    >
                                                                        {isDescExpanded ? '▲ Show less' : '▼ Show more...'}
                                                                    </button>
                                                                )}
                                                            </div>
                                                        );
                                                    })()}
                                                    
                                                    {isLoadingInfo ? (
                                                        <div style={{ 
                                                            display: 'flex', 
                                                            alignItems: 'center', 
                                                            justifyContent: 'center',
                                                            gap: '10px',
                                                            padding: '1rem',
                                                            color: theme.colors.mutedText,
                                                        }}>
                                                            <FaSync style={{ animation: 'spin 1s linear infinite' }} />
                                                            Loading canister info...
                                                        </div>
                                                    ) : info ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                            <div style={{ 
                                                                display: 'flex', 
                                                                alignItems: 'center', 
                                                                justifyContent: 'space-between',
                                                                marginBottom: '0.5rem',
                                                            }}>
                                                                <h4 style={{ 
                                                                    margin: 0, 
                                                                    fontSize: '0.9rem', 
                                                                    color: theme.colors.primaryText,
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '8px',
                                                                }}>
                                                                    <FaMicrochip /> Canister Status
                                                                </h4>
                                                                <span style={{
                                                                    fontSize: '0.75rem',
                                                                    padding: '3px 10px',
                                                                    borderRadius: '12px',
                                                                    fontWeight: '600',
                                                                    textTransform: 'uppercase',
                                                                    background: 'running' in info.status 
                                                                        ? `${theme.colors.success}20`
                                                                        : 'stopping' in info.status 
                                                                            ? `${theme.colors.warning}20`
                                                                            : `${theme.colors.error}20`,
                                                                    color: 'running' in info.status 
                                                                        ? theme.colors.success
                                                                        : 'stopping' in info.status 
                                                                            ? theme.colors.warning
                                                                            : theme.colors.error,
                                                                }}>
                                                                    {'running' in info.status ? '● Running' : 
                                                                     'stopping' in info.status ? '◐ Stopping' : 
                                                                     '○ Stopped'}
                                                                </span>
                                                            </div>
                                                            
                                                            {/* Stats Grid */}
                                                            <div style={{
                                                                display: 'grid',
                                                                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                                                                gap: '0.75rem',
                                                            }}>
                                                                {/* Cycles */}
                                                                <div style={{
                                                                    background: theme.colors.tertiaryBg,
                                                                    borderRadius: '8px',
                                                                    padding: '0.75rem',
                                                                }}>
                                                                    <div style={{ 
                                                                        fontSize: '0.7rem', 
                                                                        color: theme.colors.mutedText,
                                                                        marginBottom: '4px',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '4px',
                                                                    }}>
                                                                        <FaBolt /> Cycles
                                                                    </div>
                                                                    <div style={{ 
                                                                        fontSize: '1rem', 
                                                                        fontWeight: '700',
                                                                        color: theme.colors.accent,
                                                                    }}>
                                                                        {formatCycles(Number(info.cycles))}
                                                                    </div>
                                                                </div>
                                                                
                                                                {/* Memory */}
                                                                <div style={{
                                                                    background: theme.colors.tertiaryBg,
                                                                    borderRadius: '8px',
                                                                    padding: '0.75rem',
                                                                }}>
                                                                    <div style={{ 
                                                                        fontSize: '0.7rem', 
                                                                        color: theme.colors.mutedText,
                                                                        marginBottom: '4px',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '4px',
                                                                    }}>
                                                                        <FaMemory /> Memory
                                                                    </div>
                                                                    <div style={{ 
                                                                        fontSize: '1rem', 
                                                                        fontWeight: '700',
                                                                        color: theme.colors.primaryText,
                                                                    }}>
                                                                        {formatBytes(Number(info.memory_size))}
                                                                    </div>
                                                                </div>
                                                                
                                                                {/* Idle Burn */}
                                                                <div style={{
                                                                    background: theme.colors.tertiaryBg,
                                                                    borderRadius: '8px',
                                                                    padding: '0.75rem',
                                                                }}>
                                                                    <div style={{ 
                                                                        fontSize: '0.7rem', 
                                                                        color: theme.colors.mutedText,
                                                                        marginBottom: '4px',
                                                                    }}>
                                                                        Daily Burn
                                                                    </div>
                                                                    <div style={{ 
                                                                        fontSize: '1rem', 
                                                                        fontWeight: '700',
                                                                        color: theme.colors.warning,
                                                                    }}>
                                                                        {formatCycles(Number(info.idle_cycles_burned_per_day))}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            
                                                            {/* Controllers */}
                                                            {(() => {
                                                                const isSneedexOnlyController = info.controllers.length === 1 && 
                                                                    info.controllers[0].toString() === SNEEDEX_CANISTER_ID;
                                                                return (
                                                                    <div style={{ marginTop: '0.5rem' }}>
                                                                        <div style={{ 
                                                                            fontSize: '0.75rem', 
                                                                            color: theme.colors.mutedText,
                                                                            marginBottom: '6px',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '8px',
                                                                        }}>
                                                                            Controllers ({info.controllers.length})
                                                                            {isSneedexOnlyController && (
                                                                                <span style={{
                                                                                    display: 'inline-flex',
                                                                                    alignItems: 'center',
                                                                                    gap: '4px',
                                                                                    fontSize: '0.7rem',
                                                                                    color: theme.colors.success,
                                                                                    background: `${theme.colors.success}15`,
                                                                                    padding: '2px 8px',
                                                                                    borderRadius: '10px',
                                                                                    fontWeight: '600',
                                                                                }}>
                                                                                    <FaCheck style={{ fontSize: '0.6rem' }} />
                                                                                    Fully escrowed
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div style={{ 
                                                                            display: 'flex', 
                                                                            flexDirection: 'column', 
                                                                            gap: '4px',
                                                                        }}>
                                                                            {info.controllers.map((ctrl, i) => {
                                                                                const isSneedex = ctrl.toString() === SNEEDEX_CANISTER_ID;
                                                                                return (
                                                                                    <div key={i} style={{
                                                                                        fontSize: '0.75rem',
                                                                                        background: theme.colors.tertiaryBg,
                                                                                        padding: '4px 8px',
                                                                                        borderRadius: '4px',
                                                                                        display: 'flex',
                                                                                        alignItems: 'center',
                                                                                        gap: '6px',
                                                                                    }}>
                                                                                        {isSneedex && (
                                                                                            <span style={{ 
                                                                                                fontSize: '0.65rem',
                                                                                                background: isSneedexOnlyController ? theme.colors.success : theme.colors.accent,
                                                                                                color: '#fff',
                                                                                                padding: '1px 5px',
                                                                                                borderRadius: '3px',
                                                                                            }}>
                                                                                                SNEEDEX
                                                                                            </span>
                                                                                        )}
                                                                                        <PrincipalDisplay 
                                                                                            principal={ctrl}
                                                                                            short={true}
                                                                                            showCopyButton={false}
                                                                                            style={{ 
                                                                                                fontSize: 'inherit',
                                                                                                color: isSneedex ? theme.colors.accent : theme.colors.secondaryText 
                                                                                            }}
                                                                                            isAuthenticated={isAuthenticated}
                                                                                        />
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })()}
                                                            
                                                            {/* Module Hash */}
                                                            {info.module_hash && info.module_hash.length > 0 && (
                                                                <div style={{ marginTop: '0.25rem' }}>
                                                                    <div style={{ 
                                                                        fontSize: '0.75rem', 
                                                                        color: theme.colors.mutedText,
                                                                        marginBottom: '4px',
                                                                    }}>
                                                                        Module Hash
                                                                    </div>
                                                                    <div style={{
                                                                        fontSize: '0.7rem',
                                                                        fontFamily: 'monospace',
                                                                        color: theme.colors.secondaryText,
                                                                        wordBreak: 'break-all',
                                                                        background: theme.colors.tertiaryBg,
                                                                        padding: '6px 8px',
                                                                        borderRadius: '4px',
                                                                    }}>
                                                                        {Array.from(info.module_hash[0]).map(b => b.toString(16).padStart(2, '0')).join('')}
                                                                    </div>
                                                                </div>
                                                            )}
                                                            
                                                            {/* Refresh button */}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    fetchCanisterInfo(idx);
                                                                }}
                                                                style={{
                                                                    marginTop: '0.5rem',
                                                                    background: 'transparent',
                                                                    border: `1px solid ${theme.colors.border}`,
                                                                    color: theme.colors.mutedText,
                                                                    padding: '6px 12px',
                                                                    borderRadius: '6px',
                                                                    fontSize: '0.75rem',
                                                                    cursor: 'pointer',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px',
                                                                    width: 'fit-content',
                                                                }}
                                                            >
                                                                <FaSync /> Refresh Info
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div style={{ 
                                                            color: theme.colors.mutedText, 
                                                            textAlign: 'center',
                                                            padding: '1rem',
                                                        }}>
                                                            Failed to load canister info
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            
                                            {/* ICP Neuron Manager Info Section */}
                                            {details.type === 'Canister' && details.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER && details.escrowed && isExpanded && (
                                                <div style={{
                                                    marginTop: '1rem',
                                                    padding: '1rem',
                                                    background: `linear-gradient(135deg, ${theme.colors.accent}10, ${theme.colors.secondaryBg})`,
                                                    borderRadius: '10px',
                                                    border: `1px solid ${theme.colors.accent}30`,
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                                >
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        marginBottom: '1rem',
                                                        color: theme.colors.accent,
                                                        fontWeight: '600',
                                                    }}>
                                                        <FaRobot /> ICP Neuron Manager Details
                                                    </div>
                                                    
                                                    {loadingNeuronManagerInfo[idx] ? (
                                                        <div style={{ 
                                                            display: 'flex', 
                                                            alignItems: 'center', 
                                                            justifyContent: 'center',
                                                            gap: '10px',
                                                            padding: '1rem',
                                                            color: theme.colors.mutedText,
                                                        }}>
                                                            <FaSync style={{ animation: 'spin 1s linear infinite' }} />
                                                            Loading neuron manager info...
                                                        </div>
                                                    ) : neuronManagerInfo[idx] ? (
                                                        <div>
                                                            {/* Version & Verification */}
                                                            <div style={{
                                                                display: 'flex',
                                                                gap: '12px',
                                                                flexWrap: 'wrap',
                                                                marginBottom: '1rem',
                                                            }}>
                                                                <div style={{
                                                                    background: theme.colors.tertiaryBg,
                                                                    padding: '8px 12px',
                                                                    borderRadius: '8px',
                                                                    minWidth: '100px',
                                                                }}>
                                                                    <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText }}>Version</div>
                                                                    <div style={{ fontWeight: '600', color: theme.colors.text, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                        v{neuronManagerInfo[idx].version.major.toString()}.
                                                                        {neuronManagerInfo[idx].version.minor.toString()}.
                                                                        {neuronManagerInfo[idx].version.patch.toString()}
                                                                        {managerWasmVerification[idx]?.verified && managerWasmVerification[idx]?.versionMatch && (
                                                                            <FaCheck style={{ color: '#10B981', fontSize: '0.8rem' }} title="Official version verified" />
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div style={{
                                                                    background: theme.colors.tertiaryBg,
                                                                    padding: '8px 12px',
                                                                    borderRadius: '8px',
                                                                    minWidth: '100px',
                                                                }}>
                                                                    <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText }}>Neurons</div>
                                                                    <div style={{ fontWeight: '600', color: theme.colors.text }}>
                                                                        {neuronManagerInfo[idx].neuron_count.toString()}
                                                                    </div>
                                                                </div>
                                                                <div style={{
                                                                    background: managerWasmVerification[idx]?.verified 
                                                                        ? `${managerWasmVerification[idx]?.versionMatch ? '#10B981' : '#F59E0B'}15`
                                                                        : `${theme.colors.tertiaryBg}`,
                                                                    padding: '8px 12px',
                                                                    borderRadius: '8px',
                                                                    minWidth: '150px',
                                                                    border: managerWasmVerification[idx]?.verified 
                                                                        ? `1px solid ${managerWasmVerification[idx]?.versionMatch ? '#10B981' : '#F59E0B'}30`
                                                                        : 'none',
                                                                }}>
                                                                    <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText }}>WASM Status</div>
                                                                    <div style={{ 
                                                                        fontWeight: '600', 
                                                                        color: managerWasmVerification[idx]?.verified 
                                                                            ? (managerWasmVerification[idx]?.versionMatch ? '#10B981' : '#F59E0B')
                                                                            : theme.colors.mutedText,
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '4px',
                                                                        fontSize: '0.85rem',
                                                                    }}>
                                                                        {managerWasmVerification[idx]?.verified ? (
                                                                            <>
                                                                                <FaCheck />
                                                                                Official v{Number(managerWasmVerification[idx].officialVersion.major)}.
                                                                                {Number(managerWasmVerification[idx].officialVersion.minor)}.
                                                                                {Number(managerWasmVerification[idx].officialVersion.patch)}
                                                                            </>
                                                                        ) : managerWasmVerification[idx]?.checked ? (
                                                                            managerWasmVerification[idx]?.moduleHash ? (
                                                                                <>
                                                                                    <FaExclamationTriangle style={{ color: '#F59E0B' }} />
                                                                                    Unknown WASM
                                                                                </>
                                                                            ) : (
                                                                                <>
                                                                                    <FaExclamationTriangle style={{ color: theme.colors.mutedText }} />
                                                                                    {managerWasmVerification[idx]?.message || 'Could not verify'}
                                                                                </>
                                                                            )
                                                                        ) : (
                                                                            'Checking...'
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            
                                                            {/* Neurons List */}
                                                            {neuronManagerInfo[idx].neurons && neuronManagerInfo[idx].neurons.length > 0 && (
                                                                <div>
                                                                    <div style={{ 
                                                                        fontSize: '0.85rem', 
                                                                        fontWeight: '600',
                                                                        marginBottom: '8px',
                                                                        color: theme.colors.text,
                                                                    }}>
                                                                        Managed ICP Neurons
                                                                    </div>
                                                                    {/* Grand Total Summary */}
                                                                    {(() => {
                                                                        const neurons = neuronManagerInfo[idx].neurons;
                                                                        let grandTotalStake = 0;
                                                                        let grandTotalMaturity = 0;
                                                                        let grandTotalStakedMaturity = 0;
                                                                        neurons.forEach(n => {
                                                                            grandTotalStake += Number(n.cached_neuron_stake_e8s) / 1e8;
                                                                            grandTotalMaturity += Number(n.maturity_e8s_equivalent || 0) / 1e8;
                                                                            grandTotalStakedMaturity += Number(n.staked_maturity_e8s_equivalent || 0) / 1e8;
                                                                        });
                                                                        const grandTotal = grandTotalStake + grandTotalMaturity + grandTotalStakedMaturity;
                                                                        const rawUsd = assetUsdEstimates[idx];
                                                                        const usdValue = typeof rawUsd === 'object' ? rawUsd?.value : rawUsd;
                                                                        
                                                                        return (
                                                                            <div style={{
                                                                                background: `${theme.colors.accent}15`,
                                                                                border: `1px solid ${theme.colors.accent}40`,
                                                                                borderRadius: '8px',
                                                                                padding: '12px',
                                                                                marginBottom: '12px',
                                                                            }}>
                                                                                <div style={{ 
                                                                                    fontWeight: '700', 
                                                                                    color: theme.colors.text,
                                                                                    marginBottom: '8px',
                                                                                    fontSize: '0.9rem',
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    gap: '10px',
                                                                                }}>
                                                                                    <span>Total: {grandTotal.toFixed(4)} ICP</span>
                                                                                    {usdValue > 0 && (
                                                                                        <span style={{ 
                                                                                            color: theme.colors.success, 
                                                                                            fontWeight: '600',
                                                                                            fontSize: '0.85rem',
                                                                                        }}>
                                                                                            (~{formatUsd(usdValue)})
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                                <div style={{
                                                                                    display: 'grid',
                                                                                    gridTemplateColumns: 'repeat(3, 1fr)',
                                                                                    gap: '8px',
                                                                                    fontSize: '0.75rem',
                                                                                }}>
                                                                                    <div>
                                                                                        <div style={{ color: theme.colors.mutedText }}>Staked</div>
                                                                                        <div style={{ fontWeight: '600', color: theme.colors.text }}>{grandTotalStake.toFixed(4)} ICP</div>
                                                                                    </div>
                                                                                    <div>
                                                                                        <div style={{ color: theme.colors.mutedText }}>Maturity</div>
                                                                                        <div style={{ fontWeight: '600', color: theme.colors.text }}>{grandTotalMaturity.toFixed(4)} ICP</div>
                                                                                    </div>
                                                                                    <div>
                                                                                        <div style={{ color: theme.colors.mutedText }}>Staked Maturity</div>
                                                                                        <div style={{ fontWeight: '600', color: theme.colors.text }}>{grandTotalStakedMaturity.toFixed(4)} ICP</div>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })()}
                                                                    
                                                                    {neuronManagerInfo[idx].neurons.map((neuron, neuronIdx) => {
                                                                        const stakeIcp = Number(neuron.cached_neuron_stake_e8s) / 1e8;
                                                                        const maturityIcp = Number(neuron.maturity_e8s_equivalent || 0) / 1e8;
                                                                        const stakedMaturityIcp = Number(neuron.staked_maturity_e8s_equivalent || 0) / 1e8;
                                                                        const totalIcp = stakeIcp + maturityIcp + stakedMaturityIcp;
                                                                        const dissolveDelaySeconds = Number(neuron.dissolve_delay_seconds);
                                                                        const dissolveDelayDays = dissolveDelaySeconds / (24 * 60 * 60);
                                                                        const dissolveDelayYears = dissolveDelayDays / 365;
                                                                        const ageDays = Number(neuron.age_seconds) / (24 * 60 * 60);
                                                                        const ageYears = ageDays / 365;
                                                                        const stateText = neuron.state === 1 ? 'Locked' : neuron.state === 2 ? 'Dissolving' : neuron.state === 3 ? 'Dissolved' : 'Unknown';
                                                                        const stateColor = neuron.state === 1 ? '#10B981' : neuron.state === 2 ? '#F59E0B' : neuron.state === 3 ? '#EF4444' : theme.colors.mutedText;
                                                                        const neuronId = neuron.neuron_id.id.toString();
                                                                        const dashboardUrl = `https://dashboard.internetcomputer.org/neuron/${neuronId}`;
                                                                        
                                                                        // Format dissolve delay nicely
                                                                        const formatDelay = () => {
                                                                            if (dissolveDelayYears >= 1) {
                                                                                return `${dissolveDelayYears.toFixed(1)} years`;
                                                                            }
                                                                            return `${dissolveDelayDays.toFixed(0)} days`;
                                                                        };
                                                                        
                                                                        // Format age nicely
                                                                        const formatAge = () => {
                                                                            if (ageYears >= 1) {
                                                                                return `${ageYears.toFixed(1)} years`;
                                                                            }
                                                                            return `${ageDays.toFixed(0)} days`;
                                                                        };
                                                                        
                                                                        const hotKeys = neuron.hot_keys || [];
                                                                        const hasHotkeys = hotKeys.length > 0;
                                                                        
                                                                        return (
                                                                            <div 
                                                                                key={neuronIdx}
                                                                                style={{
                                                                                    background: theme.colors.secondaryBg,
                                                                                    border: `1px solid ${theme.colors.border}`,
                                                                                    borderRadius: '8px',
                                                                                    padding: '12px',
                                                                                    marginBottom: '8px',
                                                                                }}
                                                                            >
                                                                                {/* Neuron ID and State Badge Row */}
                                                                                <div style={{ 
                                                                                    display: 'flex', 
                                                                                    justifyContent: 'space-between', 
                                                                                    alignItems: 'center',
                                                                                    marginBottom: '4px',
                                                                                }}>
                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                        <FaBrain style={{ color: theme.colors.success, fontSize: '16px' }} />
                                                                                        <a 
                                                                                            href={dashboardUrl}
                                                                                            target="_blank"
                                                                                            rel="noopener noreferrer"
                                                                                            onClick={(e) => e.stopPropagation()}
                                                                                            style={{ 
                                                                                                fontFamily: 'monospace', 
                                                                                                fontSize: '0.8rem',
                                                                                                color: theme.colors.accent,
                                                                                                textDecoration: 'none',
                                                                                                display: 'flex',
                                                                                                alignItems: 'center',
                                                                                                gap: '4px',
                                                                                            }}
                                                                                        >
                                                                                            <FaExternalLinkAlt style={{ fontSize: '0.65rem' }} />
                                                                                            {neuronId}
                                                                                        </a>
                                                                                    </div>
                                                                                    <span style={{
                                                                                        padding: '2px 8px',
                                                                                        borderRadius: '12px',
                                                                                        fontSize: '0.75rem',
                                                                                        fontWeight: '600',
                                                                                        background: `${stateColor}20`,
                                                                                        color: stateColor,
                                                                                    }}>
                                                                                        {stateText}
                                                                                    </span>
                                                                                </div>
                                                                                {/* Total ICP on its own row */}
                                                                                <div style={{
                                                                                    fontSize: '1rem',
                                                                                    fontWeight: '600',
                                                                                    color: theme.colors.text,
                                                                                    marginBottom: '8px',
                                                                                }}>
                                                                                    {totalIcp.toFixed(4)} ICP
                                                                                </div>
                                                                                {/* Hotkeys Status */}
                                                                                <div style={{
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    gap: '6px',
                                                                                    marginBottom: '8px',
                                                                                    padding: '4px 8px',
                                                                                    borderRadius: '6px',
                                                                                    background: hasHotkeys ? `#F59E0B15` : `#10B98115`,
                                                                                    border: `1px solid ${hasHotkeys ? '#F59E0B40' : '#10B98140'}`,
                                                                                }}>
                                                                                    {hasHotkeys ? (
                                                                                        <>
                                                                                            <FaExclamationTriangle style={{ color: '#F59E0B', fontSize: '0.75rem' }} />
                                                                                            <span style={{ fontSize: '0.75rem', color: '#F59E0B' }}>
                                                                                                {hotKeys.length} hotkey{hotKeys.length !== 1 ? 's' : ''}: {hotKeys.map(h => h.toText().slice(0, 8) + '...').join(', ')}
                                                                                            </span>
                                                                                        </>
                                                                                    ) : (
                                                                                        <>
                                                                                            <FaCheck style={{ color: '#10B981', fontSize: '0.75rem' }} />
                                                                                            <span style={{ fontSize: '0.75rem', color: '#10B981' }}>No hotkeys</span>
                                                                                        </>
                                                                                    )}
                                                                                </div>
                                                                                <div style={{
                                                                                    display: 'grid',
                                                                                    gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))',
                                                                                    gap: '8px',
                                                                                    fontSize: '0.8rem',
                                                                                }}>
                                                                                    <div>
                                                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.7rem' }}>Stake</div>
                                                                                        <div style={{ fontWeight: '600', color: theme.colors.text }}>
                                                                                            {stakeIcp.toFixed(4)} ICP
                                                                                        </div>
                                                                                    </div>
                                                                                    <div>
                                                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.7rem' }}>Maturity</div>
                                                                                        <div style={{ fontWeight: '600', color: theme.colors.text }}>
                                                                                            {maturityIcp.toFixed(4)} ICP
                                                                                        </div>
                                                                                    </div>
                                                                                    <div>
                                                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.7rem' }}>Staked Maturity</div>
                                                                                        <div style={{ fontWeight: '600', color: theme.colors.text }}>
                                                                                            {stakedMaturityIcp.toFixed(4)} ICP
                                                                                        </div>
                                                                                    </div>
                                                                                    <div>
                                                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.7rem' }}>Dissolve Delay</div>
                                                                                        <div style={{ fontWeight: '600', color: theme.colors.text }}>
                                                                                            {formatDelay()}
                                                                                        </div>
                                                                                    </div>
                                                                                    <div>
                                                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.7rem' }}>Age</div>
                                                                                        <div style={{ fontWeight: '600', color: theme.colors.text }}>
                                                                                            {formatAge()}
                                                                                        </div>
                                                                                    </div>
                                                                                    <div>
                                                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.7rem' }}>Voting Power</div>
                                                                                        <div style={{ fontWeight: '600', color: theme.colors.text }}>
                                                                                            {(Number(neuron.voting_power) / 1e8).toFixed(2)}
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                                {/* Dissolve status details */}
                                                                                {neuron.state === 2 && (
                                                                                    <div style={{
                                                                                        marginTop: '8px',
                                                                                        padding: '8px',
                                                                                        background: `${stateColor}10`,
                                                                                        borderRadius: '6px',
                                                                                        fontSize: '0.75rem',
                                                                                        color: stateColor,
                                                                                    }}>
                                                                                        <FaClock style={{ marginRight: '6px' }} />
                                                                                        Dissolving - {formatDelay()} remaining
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                            
                                                            {/* Refresh button */}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    fetchNeuronManagerInfo(idx, details.canister_id);
                                                                }}
                                                                style={{
                                                                    marginTop: '0.5rem',
                                                                    background: 'transparent',
                                                                    border: `1px solid ${theme.colors.accent}50`,
                                                                    color: theme.colors.accent,
                                                                    padding: '6px 12px',
                                                                    borderRadius: '6px',
                                                                    fontSize: '0.75rem',
                                                                    cursor: 'pointer',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px',
                                                                    width: 'fit-content',
                                                                }}
                                                            >
                                                                <FaSync /> Refresh Neuron Info
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div style={{ 
                                                            color: theme.colors.mutedText, 
                                                            textAlign: 'center',
                                                            padding: '1rem',
                                                        }}>
                                                            Failed to load neuron manager info
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            
                                            {/* Expanded SNS Neuron Info Section */}
                                            {details.type === 'SNSNeuron' && details.escrowed && isExpanded && (
                                                <div style={{
                                                    marginTop: '1rem',
                                                    padding: '1rem',
                                                    background: theme.colors.secondaryBg,
                                                    borderRadius: '10px',
                                                    border: `1px solid ${theme.colors.border}`,
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                                >
                                                    {isLoadingNeuron ? (
                                                        <div style={{ 
                                                            display: 'flex', 
                                                            alignItems: 'center', 
                                                            justifyContent: 'center',
                                                            gap: '10px',
                                                            padding: '1rem',
                                                            color: theme.colors.mutedText,
                                                        }}>
                                                            <FaSync style={{ animation: 'spin 1s linear infinite' }} />
                                                            Loading neuron info...
                                                        </div>
                                                    ) : nInfo ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                            <div style={{ 
                                                                display: 'flex', 
                                                                alignItems: 'center', 
                                                                justifyContent: 'flex-start',
                                                                gap: '12px',
                                                                marginBottom: '0.5rem',
                                                                flexWrap: 'wrap',
                                                            }}>
                                                                <h4 style={{ 
                                                                    margin: 0, 
                                                                    fontSize: '0.9rem', 
                                                                    color: theme.colors.primaryText,
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'flex-start',
                                                                    gap: '8px',
                                                                }}>
                                                                    {snsLogos[details.governance_id] ? (
                                                                        <img 
                                                                            src={snsLogos[details.governance_id]} 
                                                                            alt="SNS" 
                                                                            style={{ width: '24px', height: '24px', borderRadius: '50%' }}
                                                                        />
                                                                    ) : (
                                                                        <FaBrain />
                                                                    )}
                                                                    {(() => {
                                                                        const sns = snsData.find(s => s.canisters?.governance === details.governance_id);
                                                                        return sns?.name ? `${sns.name} Neuron Details` : 'Neuron Details';
                                                                    })()}
                                                                </h4>
                                                                {nInfo.state && (
                                                                    <span style={{
                                                                        fontSize: '0.75rem',
                                                                        padding: '3px 10px',
                                                                        borderRadius: '12px',
                                                                        fontWeight: '600',
                                                                        background: nInfo.state === 1 || nInfo.state === 2 
                                                                            ? `${theme.colors.success}20`
                                                                            : `${theme.colors.warning}20`,
                                                                        color: nInfo.state === 1 || nInfo.state === 2
                                                                            ? theme.colors.success
                                                                            : theme.colors.warning,
                                                                    }}>
                                                                        {nInfo.state === 0 ? 'Unspecified' : 
                                                                         nInfo.state === 1 ? '● Locked' :
                                                                         nInfo.state === 2 ? '● Not Dissolving' :
                                                                         nInfo.state === 3 ? '◐ Dissolving' :
                                                                         nInfo.state === 4 ? '○ Dissolved' :
                                                                         nInfo.state === 5 ? 'Spawning' :
                                                                         `State ${nInfo.state}`}
                                                                    </span>
                                                                )}
                                                                {/* Neuron ID and links */}
                                                                {(() => {
                                                                    const sns = snsData.find(s => s.canisters?.governance === details.governance_id);
                                                                    const snsRoot = sns?.canisters?.root;
                                                                    return (
                                                                        <div style={{ display: 'flex', gap: '12px', marginLeft: 'auto', alignItems: 'center', flexWrap: 'wrap' }}>
                                                                            {snsRoot ? (
                                                                                <NeuronDisplay
                                                                                    neuronId={details.neuron_id}
                                                                                    snsRoot={snsRoot}
                                                                                    showCopyButton={true}
                                                                                    enableContextMenu={true}
                                                                                    isAuthenticated={isAuthenticated}
                                                                                    style={{ fontSize: '0.8rem' }}
                                                                                />
                                                                            ) : (
                                                                                <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                                                                                    {details.neuron_id?.slice(0, 12)}...
                                                                                </span>
                                                                            )}
                                                                            {snsRoot && (
                                                                                <Link 
                                                                                    to={`/hub?sns=${snsRoot}`}
                                                                                    style={{ 
                                                                                        color: theme.colors.success,
                                                                                        fontSize: '0.75rem',
                                                                                        textDecoration: 'none',
                                                                                    }}
                                                                                >
                                                                                    SNS Hub →
                                                                                </Link>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })()}
                                                            </div>
                                                            
                                                            {/* Stats Grid */}
                                                            <div style={{
                                                                display: 'grid',
                                                                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                                                                gap: '0.75rem',
                                                            }}>
                                                                {/* Staked Tokens */}
                                                                {nInfo.cached_neuron_stake_e8s !== undefined && (
                                                                    <div style={{
                                                                        background: theme.colors.tertiaryBg,
                                                                        borderRadius: '8px',
                                                                        padding: '0.75rem',
                                                                    }}>
                                                                        <div style={{ 
                                                                            fontSize: '0.7rem', 
                                                                            color: theme.colors.mutedText,
                                                                            marginBottom: '4px',
                                                                        }}>
                                                                            Staked Amount
                                                                        </div>
                                                                        <div style={{ 
                                                                            fontSize: '1rem', 
                                                                            fontWeight: '700',
                                                                            color: theme.colors.accent,
                                                                        }}>
                                                                            {(Number(nInfo.cached_neuron_stake_e8s) / 1e8).toFixed(4)}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                
                                                                {/* Voting Power */}
                                                                {nInfo.voting_power !== undefined && (
                                                                    <div style={{
                                                                        background: theme.colors.tertiaryBg,
                                                                        borderRadius: '8px',
                                                                        padding: '0.75rem',
                                                                    }}>
                                                                        <div style={{ 
                                                                            fontSize: '0.7rem', 
                                                                            color: theme.colors.mutedText,
                                                                            marginBottom: '4px',
                                                                        }}>
                                                                            Voting Power
                                                                        </div>
                                                                        <div style={{ 
                                                                            fontSize: '1rem', 
                                                                            fontWeight: '700',
                                                                            color: theme.colors.primaryText,
                                                                        }}>
                                                                            {(Number(nInfo.voting_power) / 1e8).toFixed(4)}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                
                                                                {/* Maturity */}
                                                                {nInfo.maturity_e8s_equivalent !== undefined && (
                                                                    <div style={{
                                                                        background: theme.colors.tertiaryBg,
                                                                        borderRadius: '8px',
                                                                        padding: '0.75rem',
                                                                    }}>
                                                                        <div style={{ 
                                                                            fontSize: '0.7rem', 
                                                                            color: theme.colors.mutedText,
                                                                            marginBottom: '4px',
                                                                        }}>
                                                                            Maturity
                                                                        </div>
                                                                        <div style={{ 
                                                                            fontSize: '1rem', 
                                                                            fontWeight: '700',
                                                                            color: theme.colors.success,
                                                                        }}>
                                                                            {(Number(nInfo.maturity_e8s_equivalent) / 1e8).toFixed(4)}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                
                                                                {/* Age (Seconds) */}
                                                                {nInfo.age_seconds !== undefined && Number(nInfo.age_seconds) > 0 && (
                                                                    <div style={{
                                                                        background: theme.colors.tertiaryBg,
                                                                        borderRadius: '8px',
                                                                        padding: '0.75rem',
                                                                    }}>
                                                                        <div style={{ 
                                                                            fontSize: '0.7rem', 
                                                                            color: theme.colors.mutedText,
                                                                            marginBottom: '4px',
                                                                        }}>
                                                                            Age
                                                                        </div>
                                                                        <div style={{ 
                                                                            fontSize: '1rem', 
                                                                            fontWeight: '700',
                                                                            color: theme.colors.primaryText,
                                                                        }}>
                                                                            {Math.floor(Number(nInfo.age_seconds) / 86400)}d
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            
                                                            {/* Permissions/Hotkeys */}
                                                            {nInfo.permissions && nInfo.permissions.length > 0 && (
                                                                <div style={{ marginTop: '0.5rem' }}>
                                                                    <div style={{ 
                                                                        fontSize: '0.75rem', 
                                                                        color: theme.colors.mutedText,
                                                                        marginBottom: '6px',
                                                                    }}>
                                                                        Hotkeys/Permissions ({nInfo.permissions.length})
                                                                    </div>
                                                                    <div style={{ 
                                                                        display: 'flex', 
                                                                        flexDirection: 'column', 
                                                                        gap: '4px',
                                                                        maxHeight: '150px',
                                                                        overflowY: 'auto',
                                                                    }}>
                                                                        {nInfo.permissions.map((perm, i) => {
                                                                            const isSneedex = perm.principal?.[0]?.toString() === SNEEDEX_CANISTER_ID;
                                                                            return (
                                                                                <div key={i} style={{
                                                                                    fontSize: '0.75rem',
                                                                                    background: theme.colors.tertiaryBg,
                                                                                    padding: '4px 8px',
                                                                                    borderRadius: '4px',
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    justifyContent: 'space-between',
                                                                                    gap: '6px',
                                                                                }}>
                                                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                                        {isSneedex && (
                                                                                            <span style={{ 
                                                                                                fontSize: '0.65rem',
                                                                                                background: theme.colors.accent,
                                                                                                color: '#fff',
                                                                                                padding: '1px 5px',
                                                                                                borderRadius: '3px',
                                                                                            }}>
                                                                                                SNEEDEX
                                                                                            </span>
                                                                                        )}
                                                                                        {perm.principal?.[0] && (
                                                                                            <PrincipalDisplay 
                                                                                                principal={perm.principal[0]}
                                                                                                short={true}
                                                                                                showCopyButton={false}
                                                                                                style={{ 
                                                                                                    fontSize: 'inherit',
                                                                                                    color: isSneedex ? theme.colors.accent : theme.colors.secondaryText
                                                                                                }}
                                                                                                isAuthenticated={isAuthenticated}
                                                                                            />
                                                                                        )}
                                                                                    </span>
                                                                                    <span style={{
                                                                                        fontSize: '0.65rem',
                                                                                        color: theme.colors.mutedText,
                                                                                    }}>
                                                                                        [{perm.permission_type?.length || 0} perms]
                                                                                    </span>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            )}
                                                            
                                                            {/* Dissolve Delay */}
                                                            {nInfo.dissolve_state && nInfo.dissolve_state[0] && (
                                                                <div style={{ marginTop: '0.25rem' }}>
                                                                    <div style={{ 
                                                                        fontSize: '0.75rem', 
                                                                        color: theme.colors.mutedText,
                                                                        marginBottom: '4px',
                                                                    }}>
                                                                        Dissolve Info
                                                                    </div>
                                                                    <div style={{
                                                                        fontSize: '0.8rem',
                                                                        color: theme.colors.secondaryText,
                                                                        background: theme.colors.tertiaryBg,
                                                                        padding: '6px 8px',
                                                                        borderRadius: '4px',
                                                                    }}>
                                                                        {'DissolveDelaySeconds' in nInfo.dissolve_state[0] 
                                                                            ? `Delay: ${Math.floor(Number(nInfo.dissolve_state[0].DissolveDelaySeconds) / 86400)} days`
                                                                            : 'WhenDissolvedTimestampSeconds' in nInfo.dissolve_state[0]
                                                                                ? `Dissolves: ${new Date(Number(nInfo.dissolve_state[0].WhenDissolvedTimestampSeconds) * 1000).toLocaleDateString()}`
                                                                                : JSON.stringify(nInfo.dissolve_state[0])
                                                                        }
                                                                    </div>
                                                                </div>
                                                            )}
                                                            
                                                            {/* Refresh button */}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    fetchNeuronInfo(idx, details.governance_id, details.neuron_id);
                                                                }}
                                                                style={{
                                                                    marginTop: '0.5rem',
                                                                    background: 'transparent',
                                                                    border: `1px solid ${theme.colors.border}`,
                                                                    color: theme.colors.mutedText,
                                                                    padding: '6px 12px',
                                                                    borderRadius: '6px',
                                                                    fontSize: '0.75rem',
                                                                    cursor: 'pointer',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px',
                                                                    width: 'fit-content',
                                                                }}
                                                            >
                                                                <FaSync /> Refresh Info
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div style={{ 
                                                            color: theme.colors.mutedText, 
                                                            textAlign: 'center',
                                                            padding: '1rem',
                                                        }}>
                                                            Failed to load neuron info
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            
                                            {/* Expanded ICRC1 Token Info Section */}
                                            {details.type === 'ICRC1Token' && details.escrowed && isExpanded && (
                                                <div style={{
                                                    marginTop: '1rem',
                                                    padding: '1rem',
                                                    background: theme.colors.secondaryBg,
                                                    borderRadius: '10px',
                                                    border: `1px solid ${theme.colors.border}`,
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                                >
                                                    {isLoadingToken ? (
                                                        <div style={{ 
                                                            display: 'flex', 
                                                            alignItems: 'center', 
                                                            justifyContent: 'center',
                                                            gap: '10px',
                                                            padding: '1rem',
                                                            color: theme.colors.mutedText,
                                                        }}>
                                                            <FaSync style={{ animation: 'spin 1s linear infinite' }} />
                                                            Loading token info...
                                                        </div>
                                                    ) : tMeta ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                            <h4 style={{ 
                                                                margin: 0, 
                                                                fontSize: '0.9rem', 
                                                                color: theme.colors.primaryText,
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'flex-start',
                                                                gap: '8px',
                                                            }}>
                                                                {tokenLogos[details.ledger_id] ? (
                                                                    <img 
                                                                        src={tokenLogos[details.ledger_id]} 
                                                                        alt="Token" 
                                                                        style={{ width: '24px', height: '24px', borderRadius: '50%' }}
                                                                    />
                                                                ) : (
                                                                    <FaCoins />
                                                                )}
                                                                {tMeta?.name || 'Token'} Details
                                                            </h4>
                                                            
                                                            {/* Token Metadata */}
                                                            <div style={{
                                                                display: 'grid',
                                                                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                                                                gap: '0.75rem',
                                                            }}>
                                                                <div style={{
                                                                    background: theme.colors.tertiaryBg,
                                                                    borderRadius: '8px',
                                                                    padding: '0.75rem',
                                                                }}>
                                                                    <div style={{ 
                                                                        fontSize: '0.7rem', 
                                                                        color: theme.colors.mutedText,
                                                                        marginBottom: '4px',
                                                                    }}>
                                                                        Name
                                                                    </div>
                                                                    <div style={{ 
                                                                        fontSize: '1rem', 
                                                                        fontWeight: '700',
                                                                        color: theme.colors.primaryText,
                                                                    }}>
                                                                        {tMeta.name}
                                                                    </div>
                                                                </div>
                                                                
                                                                <div style={{
                                                                    background: theme.colors.tertiaryBg,
                                                                    borderRadius: '8px',
                                                                    padding: '0.75rem',
                                                                }}>
                                                                    <div style={{ 
                                                                        fontSize: '0.7rem', 
                                                                        color: theme.colors.mutedText,
                                                                        marginBottom: '4px',
                                                                    }}>
                                                                        Symbol
                                                                    </div>
                                                                    <div style={{ 
                                                                        fontSize: '1rem', 
                                                                        fontWeight: '700',
                                                                        color: theme.colors.accent,
                                                                    }}>
                                                                        {tMeta.symbol}
                                                                    </div>
                                                                </div>
                                                                
                                                                <div style={{
                                                                    background: theme.colors.tertiaryBg,
                                                                    borderRadius: '8px',
                                                                    padding: '0.75rem',
                                                                }}>
                                                                    <div style={{ 
                                                                        fontSize: '0.7rem', 
                                                                        color: theme.colors.mutedText,
                                                                        marginBottom: '4px',
                                                                    }}>
                                                                        Decimals
                                                                    </div>
                                                                    <div style={{ 
                                                                        fontSize: '1rem', 
                                                                        fontWeight: '700',
                                                                        color: theme.colors.primaryText,
                                                                    }}>
                                                                        {tMeta.decimals}
                                                                    </div>
                                                                </div>
                                                                
                                                                <div style={{
                                                                    background: theme.colors.tertiaryBg,
                                                                    borderRadius: '8px',
                                                                    padding: '0.75rem',
                                                                }}>
                                                                    <div style={{ 
                                                                        fontSize: '0.7rem', 
                                                                        color: theme.colors.mutedText,
                                                                        marginBottom: '4px',
                                                                    }}>
                                                                        Transfer Fee
                                                                    </div>
                                                                    <div style={{ 
                                                                        fontSize: '1rem', 
                                                                        fontWeight: '700',
                                                                        color: theme.colors.warning,
                                                                    }}>
                                                                        {tMeta.fee / Math.pow(10, tMeta.decimals)} {tMeta.symbol}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            
                                                            {/* Escrowed Amount */}
                                                            <div style={{
                                                                background: `${theme.colors.accent}15`,
                                                                borderRadius: '8px',
                                                                padding: '1rem',
                                                                border: `1px solid ${theme.colors.accent}30`,
                                                                marginTop: '0.5rem',
                                                            }}>
                                                                <div style={{ 
                                                                    fontSize: '0.75rem', 
                                                                    color: theme.colors.mutedText,
                                                                    marginBottom: '4px',
                                                                }}>
                                                                    Escrowed Amount
                                                                </div>
                                                                <div style={{ 
                                                                    fontSize: '1.25rem', 
                                                                    fontWeight: '700',
                                                                    color: theme.colors.accent,
                                                                }}>
                                                                    {(Number(details.amount) / Math.pow(10, tMeta.decimals)).toLocaleString(undefined, { maximumFractionDigits: tMeta.decimals })} {tMeta.symbol}
                                                                </div>
                                                            </div>
                                                            
                                                            {/* Escrow Account Info */}
                                                            <div style={{ marginTop: '0.5rem' }}>
                                                                <div style={{ 
                                                                    fontSize: '0.75rem', 
                                                                    color: theme.colors.mutedText,
                                                                    marginBottom: '6px',
                                                                }}>
                                                                    Escrow Account
                                                                </div>
                                                                <div style={{ 
                                                                    display: 'flex', 
                                                                    flexDirection: 'column', 
                                                                    gap: '6px',
                                                                }}>
                                                                    <div style={{
                                                                        fontSize: '0.75rem',
                                                                        background: theme.colors.tertiaryBg,
                                                                        padding: '8px 10px',
                                                                        borderRadius: '6px',
                                                                    }}>
                                                                        <span style={{ color: theme.colors.mutedText }}>Principal: </span>
                                                                        <span style={{
                                                                            fontFamily: 'monospace',
                                                                            color: theme.colors.secondaryText,
                                                                        }}>
                                                                            {SNEEDEX_CANISTER_ID}
                                                                        </span>
                                                                    </div>
                                                                    <div style={{
                                                                        fontSize: '0.75rem',
                                                                        background: theme.colors.tertiaryBg,
                                                                        padding: '8px 10px',
                                                                        borderRadius: '6px',
                                                                    }}>
                                                                        <span style={{ color: theme.colors.mutedText }}>Subaccount: </span>
                                                                        <span style={{
                                                                            fontFamily: 'monospace',
                                                                            color: theme.colors.secondaryText,
                                                                            fontSize: '0.7rem',
                                                                            wordBreak: 'break-all',
                                                                        }}>
                                                                            {escrowSubaccount 
                                                                                ? Array.from(escrowSubaccount).map(b => b.toString(16).padStart(2, '0')).join('')
                                                                                : '(Loading...)'
                                                                            }
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            
                                                            {/* Ledger Canister */}
                                                            <div style={{ marginTop: '0.25rem' }}>
                                                                <div style={{ 
                                                                    fontSize: '0.75rem', 
                                                                    color: theme.colors.mutedText,
                                                                    marginBottom: '4px',
                                                                }}>
                                                                    Ledger Canister
                                                                </div>
                                                                <div style={{
                                                                    fontSize: '0.75rem',
                                                                    fontFamily: 'monospace',
                                                                    color: theme.colors.secondaryText,
                                                                    background: theme.colors.tertiaryBg,
                                                                    padding: '6px 8px',
                                                                    borderRadius: '4px',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'space-between',
                                                                }}>
                                                                    {details.ledger_id}
                                                                    <a 
                                                                        href={`https://dashboard.internetcomputer.org/canister/${details.ledger_id}`}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        style={{ color: theme.colors.accent }}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                    >
                                                                        <FaExternalLinkAlt size={12} />
                                                                    </a>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div style={{ 
                                                            color: theme.colors.mutedText, 
                                                            textAlign: 'center',
                                                            padding: '1rem',
                                                        }}>
                                                            Failed to load token info
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        
                        {/* Public Note - Visible to everyone */}
                        {offer.public_note && offer.public_note[0] && (() => {
                            const MAX_NOTE_LENGTH = 300;
                            const noteText = offer.public_note[0];
                            const isLongNote = noteText.length > MAX_NOTE_LENGTH;
                            const displayText = isLongNote && !publicNoteExpanded
                                ? noteText.slice(0, MAX_NOTE_LENGTH) + '...'
                                : noteText;
                            
                            return (
                                <div style={styles.card}>
                                    <h3 style={styles.cardTitle}>
                                        📝 Seller's Note
                                    </h3>
                                    <div style={{
                                        fontSize: '0.9rem',
                                        color: theme.colors.secondaryText,
                                        lineHeight: '1.6',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                    }}>
                                        {displayText}
                                    </div>
                                    {isLongNote && (
                                        <button
                                            onClick={() => setPublicNoteExpanded(!publicNoteExpanded)}
                                            style={{
                                                background: 'transparent',
                                                border: 'none',
                                                color: theme.colors.accent,
                                                cursor: 'pointer',
                                                fontSize: '0.8rem',
                                                padding: '0.5rem 0 0 0',
                                                fontWeight: '500',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                            }}
                                        >
                                            {publicNoteExpanded ? '▲ Show less' : '▼ Show more...'}
                                        </button>
                                    )}
                                </div>
                            );
                        })()}
                        
                        {/* Note to Buyer - Only visible to creator or winning bidder */}
                        {offer.note_to_buyer && offer.note_to_buyer[0] && (() => {
                            const MAX_NOTE_LENGTH = 300;
                            const noteText = offer.note_to_buyer[0];
                            const isLongNote = noteText.length > MAX_NOTE_LENGTH;
                            const displayText = isLongNote && !buyerNoteExpanded
                                ? noteText.slice(0, MAX_NOTE_LENGTH) + '...'
                                : noteText;
                            
                            return (
                                <div style={{
                                    ...styles.card,
                                    background: `linear-gradient(145deg, ${theme.colors.secondaryBg}, ${theme.colors.success}10)`,
                                    border: `1px solid ${theme.colors.success}40`,
                                }}>
                                    <h3 style={{
                                        ...styles.cardTitle,
                                        color: theme.colors.success,
                                    }}>
                                        🔐 Private Note from Seller
                                    </h3>
                                    <p style={{
                                        fontSize: '0.8rem',
                                        color: theme.colors.mutedText,
                                        marginTop: 0,
                                        marginBottom: '0.75rem',
                                        fontStyle: 'italic',
                                    }}>
                                        {isCreator ? 'This note is only visible to you and the winning bidder.' : 'This note is only visible to you as the winning bidder.'}
                                    </p>
                                    <div style={{
                                        fontSize: '0.9rem',
                                        color: theme.colors.secondaryText,
                                        lineHeight: '1.6',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                    }}>
                                        {displayText}
                                    </div>
                                    {isLongNote && (
                                        <button
                                            onClick={() => setBuyerNoteExpanded(!buyerNoteExpanded)}
                                            style={{
                                                background: 'transparent',
                                                border: 'none',
                                                color: theme.colors.success,
                                                cursor: 'pointer',
                                                fontSize: '0.8rem',
                                                padding: '0.5rem 0 0 0',
                                                fontWeight: '500',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                            }}
                                        >
                                            {buyerNoteExpanded ? '▲ Show less' : '▼ Show more...'}
                                        </button>
                                    )}
                                </div>
                            );
                        })()}
                        
                        {/* Bids History */}
                        <div style={styles.card}>
                            <h3 style={styles.cardTitle}>
                                <FaGavel /> Bid History ({bids.length})
                            </h3>
                            {bids.length === 0 ? (
                                <div style={styles.noBids}>No bids yet. Be the first!</div>
                            ) : (
                                <div style={styles.bidsList}>
                                    {bids.sort((a, b) => Number(b.amount) - Number(a.amount)).map((bid, idx) => {
                                        const isHighest = idx === 0;
                                        const bidState = getBidStateString(bid.state);
                                        const stateColor = 
                                            'Won' in bid.state ? theme.colors.success :
                                            'Lost' in bid.state ? theme.colors.error :
                                            'Refunded' in bid.state ? theme.colors.mutedText :
                                            'Pending' in bid.state ? theme.colors.warning :
                                            theme.colors.mutedText;
                                        
                                        return (
                                            <div 
                                                key={Number(bid.id)} 
                                                style={{
                                                    ...styles.bidItem,
                                                    background: isHighest 
                                                        ? `linear-gradient(135deg, ${theme.colors.success}15, ${theme.colors.success}08)`
                                                        : theme.colors.tertiaryBg,
                                                    border: isHighest 
                                                        ? `1px solid ${theme.colors.success}40`
                                                        : '1px solid transparent',
                                                }}
                                            >
                                                {/* Rank */}
                                                <div style={{
                                                    ...styles.bidRank,
                                                    background: isHighest ? theme.colors.success : theme.colors.secondaryBg,
                                                    color: isHighest ? '#fff' : theme.colors.mutedText,
                                                }}>
                                                    {isHighest ? '👑' : `#${idx + 1}`}
                                                </div>
                                                
                                                {/* Bidder Info */}
                                                <div style={styles.bidInfo}>
                                                    <div style={styles.bidder}>
                                                        <PrincipalDisplay 
                                                            principal={bid.bidder}
                                                            short={true}
                                                            showCopyButton={true}
                                                            isAuthenticated={isAuthenticated}
                                                        />
                                                    </div>
                                                    <div style={styles.bidMeta}>
                                                        <span style={{ fontSize: '0.75rem', color: theme.colors.mutedText }}>
                                                            {formatDate(bid.created_at)}
                                                        </span>
                                                        <span style={{
                                                            ...styles.bidStateBadge,
                                                            background: `${stateColor}20`,
                                                            color: stateColor,
                                                        }}>
                                                            {bidState}
                                                        </span>
                                                    </div>
                                                </div>
                                                
                                                {/* Amount */}
                                                <div style={{
                                                    ...styles.bidAmountValue,
                                                    color: isHighest ? theme.colors.success : theme.colors.primaryText,
                                                }}>
                                                    {formatAmount(bid.amount, tokenInfo.decimals)}
                                                    <span style={{ 
                                                        fontSize: '0.85rem', 
                                                        fontWeight: '500',
                                                        color: theme.colors.mutedText,
                                                    }}>
                                                        {tokenInfo.symbol}
                                                    </span>
                                                    {(() => {
                                                        const paymentLedger = offer.price_token_ledger.toString();
                                                        const paymentPrice = tokenPrices[paymentLedger];
                                                        const bidUsd = paymentPrice ? calculateUsdValue(bid.amount, tokenInfo.decimals, paymentPrice) : null;
                                                        return bidUsd > 0 ? (
                                                            <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, marginTop: '2px' }}>
                                                                {formatUsd(bidUsd)}
                                                            </div>
                                                        ) : null;
                                                    })()}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                    
                    {/* Right Column - Pricing & Actions */}
                    <div style={styles.rightColumn}>
                        <div style={{ ...styles.priceCard, position: 'relative', overflow: 'hidden' }}>
                            {/* SOLD overlay for sold offers (Completed or Claimed) */}
                            {isSold && (
                                <div style={{
                                    position: 'absolute',
                                    top: '20px',
                                    right: '-35px',
                                    background: 'linear-gradient(135deg, #e74c3c, #c0392b)',
                                    color: '#fff',
                                    padding: '8px 50px',
                                    fontWeight: '800',
                                    fontSize: '1rem',
                                    textTransform: 'uppercase',
                                    transform: 'rotate(45deg)',
                                    boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
                                    zIndex: 10,
                                    letterSpacing: '2px',
                                }}>
                                    SOLD
                                </div>
                            )}
                            {(() => {
                                const paymentLedger = offer.price_token_ledger.toString();
                                const paymentPrice = tokenPrices[paymentLedger];
                                const minBidUsd = offer.min_bid_price[0] && paymentPrice 
                                    ? calculateUsdValue(offer.min_bid_price[0], tokenInfo.decimals, paymentPrice) : null;
                                const buyoutUsd = offer.buyout_price[0] && paymentPrice 
                                    ? calculateUsdValue(offer.buyout_price[0], tokenInfo.decimals, paymentPrice) : null;
                                const highestBidUsd = highestBid?.amount && paymentPrice 
                                    ? calculateUsdValue(highestBid.amount, tokenInfo.decimals, paymentPrice) : null;
                                
                                return (
                                    <>
                                        <div style={styles.priceRow}>
                                            <span style={styles.priceLabel}>Minimum Bid</span>
                                            <span style={styles.priceValue}>
                                                {offer.min_bid_price[0] ? `${formatAmount(offer.min_bid_price[0], tokenInfo.decimals)} ${tokenInfo.symbol}` : '—'}
                                                {minBidUsd > 0 && (
                                                    <span style={{ color: theme.colors.mutedText, marginLeft: '8px', fontSize: '0.85rem' }}>
                                                        ({formatUsd(minBidUsd)})
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                        <div style={styles.priceRow}>
                                            <span style={styles.priceLabel}>Buyout Price</span>
                                            <span style={styles.priceValue}>
                                                {offer.buyout_price[0] ? `${formatAmount(offer.buyout_price[0], tokenInfo.decimals)} ${tokenInfo.symbol}` : '—'}
                                                {buyoutUsd > 0 && (
                                                    <span style={{ color: theme.colors.mutedText, marginLeft: '8px', fontSize: '0.85rem' }}>
                                                        ({formatUsd(buyoutUsd)})
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                    </>
                                );
                            })()}
                            {(() => {
                                // Calculate relevant USD values for Good Deal determination
                                const paymentLedger = offer.price_token_ledger.toString();
                                const paymentPrice = tokenPrices[paymentLedger];
                                const minBidUsd = offer.min_bid_price[0] && paymentPrice
                                    ? calculateUsdValue(offer.min_bid_price[0], tokenInfo.decimals, paymentPrice)
                                    : null;
                                const buyoutUsd = offer.buyout_price[0] && paymentPrice
                                    ? calculateUsdValue(offer.buyout_price[0], tokenInfo.decimals, paymentPrice)
                                    : null;
                                const highestBidUsd = highestBid?.amount && paymentPrice
                                    ? calculateUsdValue(highestBid.amount, tokenInfo.decimals, paymentPrice)
                                    : null;
                                
                                // Show loading state if we're still fetching prices
                                if (totalUsdEstimate === null && (Object.keys(tokenPrices).length === 0 && !icpPrice)) {
                                    return (
                                        <div style={{
                                            ...styles.priceRow,
                                            background: `${theme.colors.mutedText}10`,
                                            borderRadius: '8px',
                                            padding: '10px 12px',
                                            margin: '8px 0',
                                        }}>
                                            <span style={{ ...styles.priceLabel, color: theme.colors.mutedText, fontWeight: '600' }}>
                                                Est. Asset Value
                                            </span>
                                            <span style={{ 
                                                ...styles.priceValue, 
                                                color: theme.colors.mutedText,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                            }}>
                                                <FaSync style={{ animation: 'spin 1s linear infinite', fontSize: '0.8rem' }} />
                                                Loading...
                                            </span>
                                        </div>
                                    );
                                }
                                
                                if (totalUsdEstimate === null || totalUsdEstimate <= 0) return null;
                                
                                // Determine if this is a "good deal"
                                // Compare asset value against current effective price (what you'd pay now)
                                // - If there are bids: compare vs current highest bid
                                // - If no bids: compare vs minimum bid price
                                const currentEffectivePrice = highestBidUsd || minBidUsd;
                                const isGoodDeal = totalUsdEstimate > 0 && currentEffectivePrice && totalUsdEstimate > currentEffectivePrice;
                                
                                return (
                                    <div style={{
                                        ...styles.priceRow,
                                        background: isGoodDeal ? `${theme.colors.success}20` : `${theme.colors.success}10`,
                                        borderRadius: '8px',
                                        padding: '10px 12px',
                                        margin: '8px 0',
                                        border: isGoodDeal ? `2px solid ${theme.colors.success}` : 'none',
                                    }}>
                                        <span style={{ ...styles.priceLabel, color: theme.colors.success, fontWeight: '600' }}>
                                            Est. Asset Value
                                        </span>
                                        <span style={{ 
                                            ...styles.priceValue, 
                                            color: theme.colors.success, 
                                            fontWeight: '700',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px',
                                        }}>
                                            ~{formatUsd(totalUsdEstimate)}
                                            {usdEstimatesLoading && (
                                                <FaSync style={{ 
                                                    animation: 'spin 1s linear infinite', 
                                                    fontSize: '0.7rem',
                                                    opacity: 0.7,
                                                }} title="Updating with live data..." />
                                            )}
                                            {isGoodDeal && (
                                                <span style={{
                                                    background: theme.colors.success,
                                                    color: '#fff',
                                                    padding: '3px 8px',
                                                    borderRadius: '4px',
                                                    fontWeight: '700',
                                                    fontSize: '0.7rem',
                                                    whiteSpace: 'nowrap',
                                                }}>
                                                    🔥 GOOD DEAL
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                );
                            })()}
                            {offer.min_bid_increment_fee_multiple?.[0] && tokenFee && (
                                <div style={styles.priceRow}>
                                    <span style={styles.priceLabel}>Min Bid Increment</span>
                                    <span style={styles.priceValue}>
                                        {formatAmount(BigInt(Number(offer.min_bid_increment_fee_multiple[0])) * tokenFee, tokenInfo.decimals)} {tokenInfo.symbol}
                                    </span>
                                </div>
                            )}
                            <div style={styles.priceRow}>
                                <span style={styles.priceLabel}>{isSold ? 'Winning Bid' : 'Current Highest Bid'}</span>
                                <div style={{ ...styles.priceValue, color: theme.colors.success, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                    {highestBid ? (
                                        <>
                                            <span>{formatAmount(highestBid.amount, tokenInfo.decimals)} {tokenInfo.symbol}</span>
                                            {(() => {
                                                const paymentLedger = offer.price_token_ledger.toString();
                                                const paymentPrice = tokenPrices[paymentLedger];
                                                const highestBidUsd = highestBid?.amount && paymentPrice 
                                                    ? calculateUsdValue(highestBid.amount, tokenInfo.decimals, paymentPrice) : null;
                                                return highestBidUsd > 0 ? (
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>
                                                        {formatUsd(highestBidUsd)}
                                                    </span>
                                                ) : null;
                                            })()}
                                        </>
                                    ) : (
                                        <span style={{ color: isSold ? theme.colors.accent : theme.colors.mutedText }}>
                                            {isSold ? 'Buyout' : 'No bids yet'}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div style={{ ...styles.priceRow, borderBottom: offer.approved_bidders?.[0]?.length > 0 ? undefined : 'none' }}>
                                <span style={styles.priceLabel}>Time Remaining</span>
                                <span style={{ 
                                    ...styles.priceValue, 
                                    color: isCountdownExpired ? theme.colors.error : 
                                           (timeRemainingMs !== null && timeRemainingMs < 300000) ? theme.colors.error : // < 5 min = red
                                           (timeRemainingMs !== null && timeRemainingMs < 3600000) ? theme.colors.warning : // < 1 hour = warning
                                           theme.colors.warning,
                                    fontFamily: (timeRemainingMs !== null && timeRemainingMs <= 3600000) ? 'monospace' : 'inherit',
                                }}>
                                    <FaClock style={{ marginRight: '8px' }} />
                                    {timeRemainingMs !== null && timeRemainingMs <= 3600000 
                                        ? formatCountdown() 
                                        : formatTimeRemaining(offer.expiration[0])}
                                </span>
                            </div>
                            
                            {/* Private Offer indicator */}
                            {offer.approved_bidders?.[0]?.length > 0 && (
                                <div style={{ ...styles.priceRow, borderBottom: 'none' }}>
                                    <span style={styles.priceLabel}>
                                        <FaLock style={{ marginRight: '6px' }} />
                                        Private Offer
                                    </span>
                                    <span style={{ ...styles.priceValue, fontSize: '0.9rem' }}>
                                        {offer.approved_bidders[0].length} approved bidder{offer.approved_bidders[0].length !== 1 ? 's' : ''}
                                    </span>
                                </div>
                            )}
                            
                            {/* Approved Bidders List - visible to creator only */}
                            {isCreator && offer.approved_bidders?.[0]?.length > 0 && (
                                <div style={{
                                    background: `${theme.colors.warning}10`,
                                    border: `1px solid ${theme.colors.warning}40`,
                                    borderRadius: '10px',
                                    padding: '1rem',
                                    marginTop: '1rem',
                                }}>
                                    <h4 style={{ 
                                        margin: '0 0 0.75rem 0', 
                                        fontSize: '0.9rem', 
                                        color: theme.colors.warning,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}>
                                        <FaUserCheck /> Approved Bidders
                                    </h4>
                                    <div style={{ 
                                        maxHeight: '150px', 
                                        overflowY: 'auto',
                                        fontSize: '0.8rem',
                                    }}>
                                        {offer.approved_bidders[0].map((principal, idx) => (
                                            <div 
                                                key={idx}
                                                style={{
                                                    padding: '6px 8px',
                                                    background: idx % 2 === 0 ? theme.colors.tertiaryBg : 'transparent',
                                                    borderRadius: '4px',
                                                }}
                                            >
                                                <PrincipalDisplay 
                                                    principal={principal}
                                                    short={false}
                                                    showCopyButton={true}
                                                    style={{ fontSize: 'inherit' }}
                                                    isAuthenticated={isAuthenticated}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            
                            {isActive && isAuthenticated && !pendingBid && !isCountdownExpired && !isOfferPastExpiration(offer.expiration?.[0]) && (
                                <div style={styles.bidSection}>
                                    {/* Only show bid input if there's a min_bid_price (auction mode) */}
                                    {offer.min_bid_price[0] ? (
                                        <>
                                            <div style={{ 
                                                display: 'flex', 
                                                justifyContent: 'space-between', 
                                                alignItems: 'center',
                                                marginBottom: '0.75rem',
                                                fontSize: '0.85rem'
                                            }}>
                                                <span style={{ color: theme.colors.mutedText }}>
                                                    Min: {formatAmount(getMinimumBidE8s(), tokenInfo.decimals)} {tokenInfo.symbol}
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
                                            {/* Input mode toggle (only show if price available) */}
                                            {(() => {
                                                const paymentLedger = offer.price_token_ledger.toString();
                                                const paymentPrice = tokenPrices[paymentLedger];
                                                if (paymentPrice) {
                                                    return (
                                                        <div style={{ 
                                                            display: 'flex', 
                                                            justifyContent: 'flex-end', 
                                                            marginBottom: '8px',
                                                        }}>
                                                            <div style={{
                                                                display: 'flex',
                                                                background: theme.colors.tertiaryBg || theme.colors.secondaryBg,
                                                                borderRadius: '6px',
                                                                padding: '2px',
                                                                gap: '2px',
                                                            }}>
                                                                <button
                                                                    onClick={() => {
                                                                        if (bidInputMode === 'usd' && paymentPrice) {
                                                                            // Convert USD to token
                                                                            const usdValue = parseFloat(bidAmount) || 0;
                                                                            if (usdValue > 0) {
                                                                                const tokenAmount = usdValue / paymentPrice;
                                                                                setBidAmount(tokenAmount.toFixed(Math.min(tokenInfo.decimals, 8)));
                                                                            }
                                                                        }
                                                                        setBidInputMode('token');
                                                                    }}
                                                                    style={{
                                                                        padding: '4px 10px',
                                                                        border: 'none',
                                                                        borderRadius: '4px',
                                                                        cursor: 'pointer',
                                                                        fontSize: '0.75rem',
                                                                        fontWeight: '500',
                                                                        background: bidInputMode === 'token' ? theme.colors.accent : 'transparent',
                                                                        color: bidInputMode === 'token' ? '#fff' : theme.colors.mutedText,
                                                                        transition: 'all 0.15s ease',
                                                                    }}
                                                                >
                                                                    {tokenInfo.symbol}
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        if (bidInputMode === 'token' && paymentPrice) {
                                                                            // Convert token to USD
                                                                            const tokenValue = parseFloat(bidAmount) || 0;
                                                                            if (tokenValue > 0) {
                                                                                const usdAmount = tokenValue * paymentPrice;
                                                                                // Use more decimal places for small amounts
                                                                                const decimals = usdAmount < 0.01 ? 6 : usdAmount < 1 ? 4 : 2;
                                                                                setBidAmount(usdAmount.toFixed(decimals));
                                                                            }
                                                                        }
                                                                        setBidInputMode('usd');
                                                                    }}
                                                                    style={{
                                                                        padding: '4px 10px',
                                                                        border: 'none',
                                                                        borderRadius: '4px',
                                                                        cursor: 'pointer',
                                                                        fontSize: '0.75rem',
                                                                        fontWeight: '500',
                                                                        background: bidInputMode === 'usd' ? theme.colors.accent : 'transparent',
                                                                        color: bidInputMode === 'usd' ? '#fff' : theme.colors.mutedText,
                                                                        transition: 'all 0.15s ease',
                                                                    }}
                                                                >
                                                                    USD
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            })()}
                                            <div style={styles.bidInputRow}>
                                                <button
                                                    style={{
                                                        padding: '12px 12px',
                                                        background: theme.colors.secondaryBg,
                                                        color: theme.colors.accent,
                                                        border: `1px solid ${theme.colors.accent}`,
                                                        borderRadius: '10px',
                                                        cursor: 'pointer',
                                                        fontWeight: '600',
                                                        fontSize: '0.85rem',
                                                        whiteSpace: 'nowrap',
                                                        flexShrink: 0,
                                                    }}
                                                    onClick={() => {
                                                        const paymentLedger = offer.price_token_ledger.toString();
                                                        const paymentPrice = tokenPrices[paymentLedger];
                                                        const minTokenAmount = formatAmount(getMinimumBidE8s(), tokenInfo.decimals);
                                                        if (bidInputMode === 'usd' && paymentPrice) {
                                                            const minUsd = parseFloat(minTokenAmount) * paymentPrice;
                                                            // Use more decimal places for small amounts
                                                            const decimals = minUsd < 0.01 ? 6 : minUsd < 1 ? 4 : 2;
                                                            setBidAmount(minUsd.toFixed(decimals));
                                                        } else {
                                                            setBidAmount(minTokenAmount);
                                                        }
                                                    }}
                                                    title={`Set to minimum bid: ${formatAmount(getMinimumBidE8s(), tokenInfo.decimals)} ${tokenInfo.symbol}`}
                                                >
                                                    Min
                                                </button>
                                                <div style={{ 
                                                    flex: 1, 
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                }}>
                                                    {bidInputMode === 'usd' && (
                                                        <span style={{
                                                            color: theme.colors.mutedText,
                                                            fontSize: '0.9rem',
                                                            flexShrink: 0,
                                                        }}>
                                                            $
                                                        </span>
                                                    )}
                                                    <input
                                                        type="number"
                                                        step={bidInputMode === 'usd' ? '0.01' : '0.0001'}
                                                        placeholder={bidInputMode === 'usd' ? 'Amount' : 'Amount'}
                                                        style={{
                                                            ...styles.bidInput,
                                                            flex: 1,
                                                            minWidth: 0,
                                                        }}
                                                        value={bidAmount}
                                                        onChange={(e) => setBidAmount(e.target.value)}
                                                        onFocus={(e) => e.target.style.borderColor = theme.colors.accent}
                                                        onBlur={(e) => e.target.style.borderColor = theme.colors.border}
                                                    />
                                                    {bidInputMode === 'token' && (
                                                        <span style={{
                                                            color: theme.colors.mutedText,
                                                            fontSize: '0.9rem',
                                                            flexShrink: 0,
                                                        }}>
                                                            {tokenInfo.symbol}
                                                        </span>
                                                    )}
                                                </div>
                                                <button
                                                    style={styles.bidButton}
                                                    onClick={handlePlaceBid}
                                                    disabled={bidding}
                                                >
                                                    {bidding ? (bidProgress || 'Processing...') : 'Place Bid'}
                                                </button>
                                            </div>
                                            {/* Percentage increment buttons */}
                                            <div style={{ 
                                                display: 'flex', 
                                                gap: '6px', 
                                                flexWrap: 'wrap',
                                                marginTop: '8px',
                                            }}>
                                                {[1, 5, 10, 25, 50, 100].map((percent) => {
                                                    const incrementBid = () => {
                                                        const paymentLedger = offer.price_token_ledger.toString();
                                                        const paymentPrice = tokenPrices[paymentLedger];
                                                        
                                                        // Get base amount in tokens
                                                        let baseTokenAmount;
                                                        if (bidAmount && parseFloat(bidAmount) > 0) {
                                                            if (bidInputMode === 'usd' && paymentPrice) {
                                                                baseTokenAmount = parseFloat(bidAmount) / paymentPrice;
                                                            } else {
                                                                baseTokenAmount = parseFloat(bidAmount);
                                                            }
                                                        } else {
                                                            baseTokenAmount = Number(getMinimumBidE8s()) / Math.pow(10, tokenInfo.decimals);
                                                        }
                                                        
                                                        const newTokenAmount = baseTokenAmount * (1 + percent / 100);
                                                        
                                                        if (bidInputMode === 'usd' && paymentPrice) {
                                                            const newUsd = newTokenAmount * paymentPrice;
                                                            // Use more decimal places for small amounts
                                                            const decimals = newUsd < 0.01 ? 6 : newUsd < 1 ? 4 : 2;
                                                            setBidAmount(newUsd.toFixed(decimals));
                                                        } else {
                                                            const formatted = newTokenAmount.toFixed(Math.min(tokenInfo.decimals, 4));
                                                            setBidAmount(parseFloat(formatted).toString());
                                                        }
                                                    };
                                                    return (
                                                        <button
                                                            key={percent}
                                                            onClick={incrementBid}
                                                            style={{
                                                                padding: '6px 10px',
                                                                background: 'transparent',
                                                                color: theme.colors.mutedText,
                                                                border: `1px solid ${theme.colors.border}`,
                                                                borderRadius: '6px',
                                                                cursor: 'pointer',
                                                                fontSize: '0.75rem',
                                                                fontWeight: '500',
                                                                transition: 'all 0.15s ease',
                                                            }}
                                                            onMouseEnter={(e) => {
                                                                e.target.style.borderColor = theme.colors.accent;
                                                                e.target.style.color = theme.colors.accent;
                                                            }}
                                                            onMouseLeave={(e) => {
                                                                e.target.style.borderColor = theme.colors.border;
                                                                e.target.style.color = theme.colors.mutedText;
                                                            }}
                                                            title={`Increase bid by ${percent}%`}
                                                        >
                                                            +{percent}%
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            {/* Conversion display - show the other currency */}
                                            {bidAmount && parseFloat(bidAmount) > 0 && (() => {
                                                const paymentLedger = offer.price_token_ledger.toString();
                                                const paymentPrice = tokenPrices[paymentLedger];
                                                if (paymentPrice) {
                                                    if (bidInputMode === 'usd') {
                                                        // Show token equivalent (this is the actual amount that will be used)
                                                        const tokenAmount = parseFloat(bidAmount) / paymentPrice;
                                                        // Always show token amount with enough decimals to be meaningful
                                                        const tokenDecimals = Math.min(tokenInfo.decimals, 8);
                                                        return (
                                                            <div style={{ 
                                                                fontSize: '0.85rem', 
                                                                color: theme.colors.mutedText, 
                                                                marginTop: '8px',
                                                                textAlign: 'right',
                                                            }}>
                                                                = <strong style={{ color: theme.colors.primaryText }}>
                                                                    {tokenAmount.toFixed(tokenDecimals)} {tokenInfo.symbol}
                                                                </strong>
                                                            </div>
                                                        );
                                                    } else {
                                                        // Show USD equivalent with more decimals for small amounts
                                                        const bidUsd = parseFloat(bidAmount) * paymentPrice;
                                                        const usdDecimals = bidUsd < 0.01 ? 6 : bidUsd < 1 ? 4 : 2;
                                                        return (
                                                            <div style={{ 
                                                                fontSize: '0.85rem', 
                                                                color: theme.colors.mutedText, 
                                                                marginTop: '8px',
                                                                textAlign: 'right',
                                                            }}>
                                                                ≈ <strong style={{ color: theme.colors.primaryText }}>${bidUsd.toFixed(usdDecimals)}</strong> USD
                                                            </div>
                                                        );
                                                    }
                                                }
                                                return null;
                                            })()}
                                            {/* Warning when bid would trigger immediate buyout */}
                                            {bidAmount && offer.buyout_price?.[0] && (() => {
                                                const paymentLedger = offer.price_token_ledger.toString();
                                                const paymentPrice = tokenPrices[paymentLedger];
                                                
                                                // Calculate bid in tokens regardless of input mode
                                                let bidTokenAmount = parseFloat(bidAmount);
                                                if (bidInputMode === 'usd' && paymentPrice) {
                                                    bidTokenAmount = parseFloat(bidAmount) / paymentPrice;
                                                }
                                                
                                                const bidAmountE8s = bidTokenAmount * Math.pow(10, tokenInfo.decimals);
                                                const buyoutE8s = Number(offer.buyout_price[0]);
                                                
                                                if (bidAmountE8s >= buyoutE8s) {
                                                    const displayBid = bidInputMode === 'usd' 
                                                        ? `$${bidAmount}` 
                                                        : `${bidAmount} ${tokenInfo.symbol}`;
                                                    return (
                                                        <div style={{
                                                            marginTop: '10px',
                                                            padding: '10px 14px',
                                                            backgroundColor: `${theme.colors.accent}15`,
                                                            border: `1px solid ${theme.colors.accent}50`,
                                                            borderRadius: '8px',
                                                            fontSize: '0.85rem',
                                                        }}>
                                                            <div style={{ 
                                                                color: theme.colors.accent, 
                                                                fontWeight: '600',
                                                                marginBottom: '4px',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '6px',
                                                            }}>
                                                                ⚡ Instant Buyout
                                                            </div>
                                                            <div style={{ color: theme.colors.text }}>
                                                                Your bid of <strong>{displayBid}</strong> meets or exceeds the buyout price.
                                                                You will pay exactly <strong>{formatAmount(buyoutE8s, tokenInfo.decimals)} {tokenInfo.symbol}</strong> and win immediately.
                                                                {bidAmountE8s > buyoutE8s && (
                                                                    <span style={{ color: theme.colors.mutedText }}>
                                                                        {' '}(excess will be refunded)
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            })()}
                                        </>
                                    ) : (
                                        /* Buyout-only mode - show wallet balance */
                                        <div style={{ 
                                            display: 'flex', 
                                            justifyContent: 'flex-end', 
                                            alignItems: 'center',
                                            marginBottom: '0.75rem',
                                            fontSize: '0.85rem'
                                        }}>
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
                                    )}
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
                                    background: (isCountdownExpired || isOfferPastExpiration(offer.expiration?.[0])) 
                                        ? `${theme.colors.warning}10` 
                                        : `${theme.colors.accent}10`,
                                    border: `2px solid ${(isCountdownExpired || isOfferPastExpiration(offer.expiration?.[0])) 
                                        ? theme.colors.warning 
                                        : theme.colors.accent}`,
                                    borderRadius: '12px',
                                    padding: '1.5rem',
                                    marginTop: '1rem',
                                    position: 'relative'
                                }}>
                                    {/* Expired offer warning */}
                                    {(isCountdownExpired || isOfferPastExpiration(offer.expiration?.[0])) && (
                                        <div style={{
                                            background: `${theme.colors.warning}20`,
                                            border: `1px solid ${theme.colors.warning}`,
                                            borderRadius: '8px',
                                            padding: '1rem',
                                            marginBottom: '1rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px',
                                            color: theme.colors.warning
                                        }}>
                                            <FaClock style={{ fontSize: '1.2rem', flexShrink: 0 }} />
                                            <div>
                                                <strong>This offer has expired!</strong>
                                                <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: theme.colors.text }}>
                                                    You can no longer complete this bid. Please withdraw any funds you've deposited.
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                    
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
                                    
                                    {/* Quick pay button - hidden when expired */}
                                    {!(isCountdownExpired || isOfferPastExpiration(offer.expiration?.[0])) && (
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
                                    )}
                                    
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
                                        {/* Confirm button - hidden when expired */}
                                        {!(isCountdownExpired || isOfferPastExpiration(offer.expiration?.[0])) && (
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
                                        )}
                                        
                                        {/* Withdraw button - always available when there are funds */}
                                        {pendingBid.escrowBalance > 0n && (
                                            <button
                                                style={{
                                                    ...styles.cancelButton,
                                                    background: (isCountdownExpired || isOfferPastExpiration(offer.expiration?.[0])) 
                                                        ? theme.colors.warning 
                                                        : 'transparent',
                                                    border: `1px solid ${theme.colors.warning}`,
                                                    color: (isCountdownExpired || isOfferPastExpiration(offer.expiration?.[0])) 
                                                        ? '#fff' 
                                                        : theme.colors.warning,
                                                    flex: (isCountdownExpired || isOfferPastExpiration(offer.expiration?.[0])) ? '1' : 'none'
                                                }}
                                                onClick={handleWithdraw}
                                                disabled={withdrawLoading}
                                            >
                                                {withdrawLoading ? 'Withdrawing...' : '💸 Withdraw Funds'}
                                            </button>
                                        )}
                                        
                                        <button
                                            style={{
                                                ...styles.cancelButton,
                                                flex: (pendingBid.escrowBalance > 0n && !(isCountdownExpired || isOfferPastExpiration(offer.expiration?.[0]))) ? 'none' : '1'
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
                            
                            {/* Process Expiration - visible to anyone when offer is Active and past expiration */}
                            {isActive && isAuthenticated && offer.expiration[0] && (isCountdownExpired || isOfferPastExpiration(offer.expiration[0])) && (
                                <div style={{
                                    background: `${theme.colors.warning}15`,
                                    border: `1px solid ${theme.colors.warning}50`,
                                    borderRadius: '12px',
                                    padding: '1rem',
                                    marginTop: '1rem',
                                }}>
                                    <div style={{ 
                                        color: theme.colors.warning, 
                                        fontSize: '0.9rem', 
                                        marginBottom: '0.75rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}>
                                        <FaClock />
                                        <strong>This offer has expired!</strong>
                                    </div>
                                    <p style={{ 
                                        color: theme.colors.mutedText, 
                                        fontSize: '0.85rem', 
                                        margin: '0 0 1rem 0' 
                                    }}>
                                        {bids.length > 0 
                                            ? `The auction can now be finalized. The highest bidder (${formatAmount(highestBid?.amount, tokenInfo.decimals)} ${tokenInfo.symbol}) will win.`
                                            : 'There were no bids on this offer. The assets will be returned to the seller.'
                                        }
                                    </p>
                                    <button 
                                        style={{
                                            ...styles.acceptButton,
                                            background: theme.colors.warning,
                                        }}
                                        onClick={handleProcessExpiration}
                                        disabled={actionLoading}
                                    >
                                        <FaClock style={{ marginRight: '8px' }} />
                                        {actionLoading ? 'Processing...' : (bids.length > 0 ? '⚡ Finalize Auction' : '⚡ Process Expiration')}
                                    </button>
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
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <strong>Ledger:</strong> 
                                    <PrincipalDisplay 
                                        principal={offer.price_token_ledger}
                                        short={true}
                                        showCopyButton={true}
                                        isAuthenticated={isAuthenticated}
                                    />
                                </div>
                                {offer.fee_rate_bps !== undefined && Number(offer.fee_rate_bps) > 0 && (
                                    <div style={{ marginTop: '0.5rem' }}>
                                        <strong>Marketplace Fee:</strong>{' '}
                                        <span style={{ color: theme.colors.warning }}>
                                            {formatFeeRate(offer.fee_rate_bps)}
                                        </span>
                                        <span style={{ color: theme.colors.mutedText, marginLeft: '4px', fontSize: '0.85rem' }}>
                                            (deducted from winning bid)
                                        </span>
                                    </div>
                                )}
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
            
            {/* Info Modal */}
            <InfoModal
                show={infoModal.show}
                onClose={closeInfoModal}
                title={infoModal.title}
                message={infoModal.message}
                type={infoModal.type}
            />
            
            {/* Confirmation Modal */}
            <ConfirmationModal
                show={confirmModal.show}
                onClose={() => setConfirmModal({ ...confirmModal, show: false })}
                onSubmit={confirmModal.action}
                message={confirmModal.message}
                doAwait={true}
            />
        </div>
    );
}

export default SneedexOffer;
