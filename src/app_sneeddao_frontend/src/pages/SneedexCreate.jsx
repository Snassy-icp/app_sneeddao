import React, { useState, useEffect, useCallback } from 'react';
import Header from '../components/Header';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { usePremiumStatus } from '../hooks/usePremiumStatus';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import { useAdminCheck } from '../hooks/useAdminCheck';
import { FaArrowLeft, FaPlus, FaTrash, FaCubes, FaBrain, FaCoins, FaCheck, FaExclamationTriangle, FaServer, FaRobot, FaWallet, FaSync, FaPencilAlt, FaChevronDown, FaChevronUp, FaUnlock } from 'react-icons/fa';
import { Principal } from '@dfinity/principal';
import { HttpAgent, Actor } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { 
    createSneedexActor, 
    parseAmount, 
    createAssetVariant,
    getErrorMessage,
    formatFeeRate,
    formatUsd,
    calculateUsdValue,
    SNEEDEX_CANISTER_ID,
    CANISTER_KIND_UNKNOWN,
    CANISTER_KIND_ICP_NEURON_MANAGER,
    CANISTER_KIND_NAMES,
    MAX_CANISTER_TITLE_LENGTH,
    MAX_CANISTER_DESCRIPTION_LENGTH
} from '../utils/SneedexUtils';
import { getCanisterGroups, convertGroupsFromBackend } from '../utils/BackendUtils';
import TokenSelector from '../components/TokenSelector';
import priceService from '../services/PriceService';
import { createActor as createBackendActor } from 'declarations/app_sneeddao_backend';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneed_icp_neuron_manager_factory';
import { createActor as createNeuronManagerActor } from 'declarations/sneed_icp_neuron_manager';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createGovernanceActor } from 'external/sns_governance';
import { getAllSnses, startBackgroundSnsFetch, fetchSnsLogo, getSnsById } from '../utils/SnsUtils';
import { normalizeId } from '../utils/IdUtils';
import { useWalletOptional } from '../contexts/WalletContext';
import { useNeuronsOptional } from '../contexts/NeuronsContext';
import { fetchUserNeuronsForSns, getNeuronId, uint8ArrayToHex } from '../utils/NeuronUtils';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import PrincipalInput from '../components/PrincipalInput';
import NeuronDisplay from '../components/NeuronDisplay';

const backendCanisterId = process.env.CANISTER_ID_APP_SNEEDDAO_BACKEND || process.env.REACT_APP_BACKEND_CANISTER_ID;
const getHost = () => process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943';
const MANAGEMENT_CANISTER_ID = 'aaaaa-aa';
const SNEED_SNS_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';
const ICP_LEDGER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const ICP_FEE = 10_000n; // 0.0001 ICP
const E8S = 100_000_000n;

// Accent colors for Sneedex
const sneedexPrimary = '#8b5cf6'; // Purple
const sneedexSecondary = '#a78bfa';

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

function SneedexCreate() {
    const { identity, isAuthenticated } = useAuth();
    const { theme } = useTheme();
    const walletContext = useWalletOptional();
    const neuronsContext = useNeuronsOptional();
    const { principalNames, principalNicknames, getNeuronDisplayName: getNeuronNameInfo } = useNaming();
    const navigate = useNavigate();
    
    // Offer settings
    const [minBidPrice, setMinBidPrice] = useState('');
    const [buyoutPrice, setBuyoutPrice] = useState('');
    const [hasExpiration, setHasExpiration] = useState(true);
    const [expirationDays, setExpirationDays] = useState('7');
    const [expirationHours, setExpirationHours] = useState('0');
    const [expirationMinutes, setExpirationMinutes] = useState('0');
    const [priceTokenLedger, setPriceTokenLedger] = useState('ryjl3-tyaaa-aaaaa-aaaba-cai'); // ICP default
    
    // Custom price token metadata (for tokens not in whitelist)
    const [customPriceTokenSymbol, setCustomPriceTokenSymbol] = useState('');
    const [customPriceTokenDecimals, setCustomPriceTokenDecimals] = useState('');
    const [customPriceTokenName, setCustomPriceTokenName] = useState('');
    const [customPriceTokenLogo, setCustomPriceTokenLogo] = useState('');
    
    // Minimum bid increment (in whole tokens, user-friendly)
    const [minBidIncrement, setMinBidIncrement] = useState('');
    const [suggestedMinBidIncrement, setSuggestedMinBidIncrement] = useState('1'); // Fallback suggestion
    
    // Private offer / Approved bidders
    const [isPrivateOffer, setIsPrivateOffer] = useState(false);
    const [approvedBidders, setApprovedBidders] = useState([]); // Array of principal strings
    const [newBidderInput, setNewBidderInput] = useState(''); // Current input for adding new bidder
    
    // Notes
    const [publicNote, setPublicNote] = useState(''); // Visible to everyone
    const [noteToBuyer, setNoteToBuyer] = useState(''); // Only visible to winning bidder
    
    // Token metadata from backend
    const [whitelistedTokens, setWhitelistedTokens] = useState([]);
    const [loadingTokens, setLoadingTokens] = useState(true);
    
    // USD price for selected payment token
    const [paymentTokenPrice, setPaymentTokenPrice] = useState(null);
    
    // USD prices for assets
    const [assetPrices, setAssetPrices] = useState({}); // ledgerId -> USD price per token
    const [icpPrice, setIcpPrice] = useState(null); // USD price for ICP (for neuron managers)
    
    // Marketplace fee rate
    const [marketplaceFeeRate, setMarketplaceFeeRate] = useState(null);
    
    // Min increment settings from sneedex canister
    const [minIncrementSettings, setMinIncrementSettings] = useState({
        usd_range_min: 100,  // $1.00 default
        usd_range_max: 1000, // $10.00 default
        usd_target: 500,     // $5.00 default
        fallback_tokens: 100000000, // 1 token default
    });
    
    // Premium status (cached in localStorage)
    const { isPremium: isPremiumUser, loading: premiumLoading } = usePremiumStatus(identity);
    
    // Offer creation fee (ICP)
    const [regularOfferCreationFee, setRegularOfferCreationFee] = useState(0n); // Regular (non-premium) fee
    const [premiumOfferCreationFee, setPremiumOfferCreationFee] = useState(0n); // Premium fee
    const [premiumAuctionCut, setPremiumAuctionCut] = useState(0); // Premium auction cut in bps
    const [userPaymentBalance, setUserPaymentBalance] = useState(0n);
    
    // Effective fee is calculated from premium status (not fetched)
    const offerCreationFee = isPremiumUser ? premiumOfferCreationFee : regularOfferCreationFee;
    const [paymentSubaccount, setPaymentSubaccount] = useState(null);
    const [loadingFeeInfo, setLoadingFeeInfo] = useState(true);
    const [withdrawingPayment, setWithdrawingPayment] = useState(false);
    const [userIcpBalance, setUserIcpBalance] = useState(null);
    
    // Admin status (admins can create offers with unverified assets)
    const { isAdmin } = useAdminCheck({ identity, isAuthenticated, redirectPath: null });
    
    // User's registered canisters and neuron managers
    const [userCanisters, setUserCanisters] = useState([]); // Array of canister ID strings (from canister groups)
    const [walletCanisters, setWalletCanisters] = useState([]); // Array of canister ID strings (from tracked_canisters)
    const [neuronManagers, setNeuronManagers] = useState([]); // Array of canister ID strings
    const [loadingCanisters, setLoadingCanisters] = useState(true);
    
    // Derived token info from selected ledger (with custom token fallback)
    const selectedPriceToken = whitelistedTokens.find(t => t.ledger_id.toString() === priceTokenLedger);
    const priceTokenSymbol = selectedPriceToken?.symbol || customPriceTokenSymbol || 'TOKEN';
    const priceTokenDecimals = selectedPriceToken?.decimals || (customPriceTokenDecimals ? parseInt(customPriceTokenDecimals) : 8);
    
    // Fetch whitelisted tokens on mount
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
            } finally {
                setLoadingTokens(false);
            }
        };
        fetchTokens();
    }, [identity]);
    
    // Fetch USD price for selected payment token
    useEffect(() => {
        const fetchPrice = async () => {
            if (!priceTokenLedger) return;
            try {
                const decimals = selectedPriceToken?.decimals || 8;
                const price = await priceService.getTokenUSDPrice(priceTokenLedger, Number(decimals));
                setPaymentTokenPrice(price);
            } catch (e) {
                // Silently ignore - token may not have an ICPSwap pool
                setPaymentTokenPrice(null);
            }
        };
        fetchPrice();
    }, [priceTokenLedger, selectedPriceToken]);
    
    // Set default min bid increment, targeting the configured USD target (or fallback tokens if no price)
    useEffect(() => {
        const decimals = Number(selectedPriceToken?.decimals) || 8;
        // Fallback: use configured token amount
        const fallbackTokens = minIncrementSettings.fallback_tokens / Math.pow(10, decimals);
        let suggested = fallbackTokens.toString();
        
        if (selectedPriceToken && paymentTokenPrice && paymentTokenPrice > 0) {
            // Calculate token amount that equals the target USD (cents / 100)
            const targetUsd = minIncrementSettings.usd_target / 100;
            const defaultIncrement = targetUsd / paymentTokenPrice;
            
            // Format nicely (avoid excessive decimals)
            const maxDecimals = Math.min(decimals, 4);
            suggested = parseFloat(defaultIncrement.toFixed(maxDecimals)).toString();
        }
        
        setSuggestedMinBidIncrement(suggested);
        setMinBidIncrement(suggested);
    }, [selectedPriceToken, paymentTokenPrice, minIncrementSettings]);
    
    // Fetch ICP price on mount
    useEffect(() => {
        const fetchIcpPrice = async () => {
            try {
                const price = await priceService.getICPUSDPrice();
                setIcpPrice(price);
            } catch (e) {
                // Silently ignore
            }
        };
        fetchIcpPrice();
    }, []);
    
    // Fetch offer creation fee info (all query calls - fast!)
    const fetchFeeInfo = useCallback(async () => {
        if (!identity || !isAuthenticated) return;
        
        setLoadingFeeInfo(true);
        try {
            const actor = createSneedexActor(identity);
            const userPrincipal = identity.getPrincipal();
            
            // First get fee config, subaccount, and min increment settings (queries)
            const [feeConfig, subaccount, incrementSettings] = await Promise.all([
                actor.getFeeConfig(), // Single query for all 4 fee values
                actor.getOfferCreationPaymentSubaccount(userPrincipal),
                actor.getMinIncrementSettings(),
            ]);
            
            setRegularOfferCreationFee(feeConfig.regularCreationFeeE8s);
            setPremiumOfferCreationFee(feeConfig.premiumCreationFeeE8s);
            setMarketplaceFeeRate(Number(feeConfig.regularAuctionCutBps));
            setPremiumAuctionCut(Number(feeConfig.premiumAuctionCutBps));
            setPaymentSubaccount(subaccount);
            setMinIncrementSettings({
                usd_range_min: Number(incrementSettings.usd_range_min),
                usd_range_max: Number(incrementSettings.usd_range_max),
                usd_target: Number(incrementSettings.usd_target),
                fallback_tokens: Number(incrementSettings.fallback_tokens),
            });
            
            // Then get balances from ICP ledger directly (queries, don't block fee display)
            const icpLedger = createLedgerActor(ICP_LEDGER_ID, {
                agentOptions: { identity, host: getHost() }
            });
            const [walletBalance, depositBalance] = await Promise.all([
                icpLedger.icrc1_balance_of({
                    owner: userPrincipal,
                    subaccount: [],
                }),
                icpLedger.icrc1_balance_of({
                    owner: Principal.fromText(SNEEDEX_CANISTER_ID),
                    subaccount: [subaccount],
                }),
            ]);
            
            setUserIcpBalance(walletBalance);
            setUserPaymentBalance(depositBalance);
        } catch (e) {
            console.error('Failed to fetch fee info:', e);
        } finally {
            setLoadingFeeInfo(false);
        }
    }, [identity, isAuthenticated]);
    
    useEffect(() => {
        fetchFeeInfo();
    }, [fetchFeeInfo]);
    
    // Helper to calculate expiration timestamp in nanoseconds from days, hours, minutes
    const getExpirationNs = useCallback(() => {
        const days = parseInt(expirationDays) || 0;
        const hours = parseInt(expirationHours) || 0;
        const minutes = parseInt(expirationMinutes) || 0;
        const totalMs = (days * 24 * 60 * 60 * 1000) + (hours * 60 * 60 * 1000) + (minutes * 60 * 1000);
        const expirationMs = Date.now() + totalMs;
        return BigInt(expirationMs) * 1_000_000n;
    }, [expirationDays, expirationHours, expirationMinutes]);
    
    // Format expiration time for display
    const formatExpirationTime = useCallback(() => {
        const days = parseInt(expirationDays) || 0;
        const hours = parseInt(expirationHours) || 0;
        const minutes = parseInt(expirationMinutes) || 0;
        
        const parts = [];
        if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
        if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
        if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
        
        return parts.length > 0 ? parts.join(', ') : '0 minutes';
    }, [expirationDays, expirationHours, expirationMinutes]);
    
    // Fetch user's registered canisters and neuron managers
    useEffect(() => {
        const fetchUserCanisters = async () => {
            if (!identity) {
                setLoadingCanisters(false);
                return;
            }
            
            setLoadingCanisters(true);
            try {
                // Fetch canister groups (registered canisters)
                const groupsResult = await getCanisterGroups(identity);
                const canisters = [];
                
                if (groupsResult) {
                    const groups = convertGroupsFromBackend(groupsResult);
                    // Collect all canister IDs from groups and ungrouped
                    if (groups.ungrouped) {
                        canisters.push(...groups.ungrouped);
                    }
                    if (groups.groups) {
                        const collectFromGroups = (groupList) => {
                            for (const group of groupList) {
                                if (group.canisters) {
                                    canisters.push(...group.canisters);
                                }
                                if (group.subgroups) {
                                    collectFromGroups(group.subgroups);
                                }
                            }
                        };
                        collectFromGroups(groups.groups);
                    }
                }
                setUserCanisters(canisters);
                
                // Fetch wallet canisters (tracked_canisters)
                try {
                    const backendActor = createBackendActor(backendCanisterId, {
                        agentOptions: { identity }
                    });
                    const trackedCanisters = await backendActor.get_tracked_canisters();
                    // Filter out any that are already in userCanisters
                    const uniqueTracked = trackedCanisters
                        .map(p => p.toString())
                        .filter(id => !canisters.includes(id));
                    setWalletCanisters(uniqueTracked);
                } catch (e) {
                    console.error('Failed to fetch tracked canisters:', e);
                    setWalletCanisters([]);
                }
                
                // Fetch neuron managers
                const host = getHost();
                const agent = HttpAgent.createSync({ host, identity });
                if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                    await agent.fetchRootKey();
                }
                
                const factory = createFactoryActor(factoryCanisterId, { agent });
                const managerIds = await factory.getMyManagers();
                setNeuronManagers(managerIds.map(p => p.toString()));
                
            } catch (e) {
                console.error('Failed to fetch user canisters:', e);
            } finally {
                setLoadingCanisters(false);
            }
        };
        
        fetchUserCanisters();
    }, [identity]);
    
    // Helper to get canister display name (show nickname + name if both exist)
    const getCanisterName = useCallback((canisterId) => {
        const nickname = principalNicknames?.get(canisterId);
        const name = principalNames?.get(canisterId);
        const shortId = canisterId.slice(0, 10) + '...' + canisterId.slice(-5);
        
        if (nickname && name) {
            // Show both nickname and public name
            return `🏷️ ${nickname} (${name})`;
        } else if (nickname) {
            // Just nickname
            return `🏷️ ${nickname}`;
        } else if (name) {
            // Just public name
            return name;
        }
        
        // Fallback to shortened ID
        return shortId;
    }, [principalNames, principalNicknames]);
    
    // Assets
    const [assets, setAssets] = useState([]);
    const [assetVerification, setAssetVerification] = useState({}); // {assetKey: {verified: bool, checking: bool, message: string}}
    const [showAddAsset, setShowAddAsset] = useState(false);
    const [editingAssetIndex, setEditingAssetIndex] = useState(null); // Index of asset being edited, null if adding new
    const [expandedReviewAssets, setExpandedReviewAssets] = useState({}); // {index: boolean} for review screen
    const [newAssetType, setNewAssetType] = useState('canister');
    const [newAssetCanisterId, setNewAssetCanisterId] = useState('');
    const [newAssetCanisterKind, setNewAssetCanisterKind] = useState(0); // 0 = unknown, 1 = ICP Neuron Manager
    const [newAssetCanisterTitle, setNewAssetCanisterTitle] = useState('');
    const [newAssetCanisterDescription, setNewAssetCanisterDescription] = useState('');
    const [verifyingCanisterKind, setVerifyingCanisterKind] = useState(false);
    const [canisterKindVerified, setCanisterKindVerified] = useState(null); // null, true, or error message
    const [canisterControllerStatus, setCanisterControllerStatus] = useState(null); // null, {checking: true}, {verified: true/false, message: string}
    const [newAssetGovernanceId, setNewAssetGovernanceId] = useState('');
    const [newAssetNeuronId, setNewAssetNeuronId] = useState('');
    const [neuronVerificationStatus, setNeuronVerificationStatus] = useState(null); // null, {checking: true}, {verified: true/false, message: string}
    
    // Neuron Manager info state (for displaying ICP neurons inside when selecting)
    const [neuronManagerInfo, setNeuronManagerInfo] = useState(null); // { neurons: [], totalStakeE8s, totalMaturityE8s, totalIcpE8s }
    const [loadingNeuronManagerInfo, setLoadingNeuronManagerInfo] = useState(false);
    
    // SNS and Neuron selection state
    const [snsList, setSnsList] = useState([]);
    const [loadingSnses, setLoadingSnses] = useState(true);
    const [selectedSnsRoot, setSelectedSnsRoot] = useState('');
    const [snsNeurons, setSnsNeurons] = useState([]);
    const [loadingSnsNeurons, setLoadingSnsNeurons] = useState(false);
    const [snsLogos, setSnsLogos] = useState(new Map());
    
    // Helper to get SNS ledger from governance ID
    const getSnsLedgerFromGovernance = useCallback((governanceId) => {
        const sns = snsList.find(s => 
            s.canisters?.governance === governanceId ||
            s.governance_canister_id?.[0]?.toString() === governanceId ||
            s.governance_canister_id?.toString() === governanceId
        );
        if (sns) {
            return sns.canisters?.ledger || 
                   sns.ledger_canister_id?.[0]?.toString() || 
                   sns.ledger_canister_id?.toString();
        }
        return null;
    }, [snsList]);
    
    // Helper to get SNS decimals from governance ID
    const getSnsDecimals = useCallback((governanceId) => {
        const sns = snsList.find(s => 
            s.canisters?.governance === governanceId ||
            s.governance_canister_id?.[0]?.toString() === governanceId ||
            s.governance_canister_id?.toString() === governanceId
        );
        return sns?.decimals || 8;
    }, [snsList]);
    
    // Fetch SNS list on mount
    useEffect(() => {
        const loadSnsData = async () => {
            setLoadingSnses(true);
            try {
                // Check for cached data first
                const cachedData = getAllSnses();
                if (cachedData && cachedData.length > 0) {
                    // Sort so Sneed comes first
                    const sortedData = [...cachedData].sort((a, b) => {
                        if (a.rootCanisterId === SNEED_SNS_ROOT) return -1;
                        if (b.rootCanisterId === SNEED_SNS_ROOT) return 1;
                        return a.name.localeCompare(b.name);
                    });
                    setSnsList(sortedData);
                    setLoadingSnses(false);
                    
                    // Load logos
                    const host = getHost();
                    const agent = HttpAgent.createSync({ host, identity });
                    cachedData.forEach(async (sns) => {
                        if (sns.canisters.governance && !snsLogos.has(sns.canisters.governance)) {
                            try {
                                const logo = await fetchSnsLogo(sns.canisters.governance, agent);
                                setSnsLogos(prev => new Map(prev).set(sns.canisters.governance, logo));
                            } catch (e) {}
                        }
                    });
                    return;
                }
                
                // No cached data - start background fetch
                startBackgroundSnsFetch(identity, (data) => {
                    const sortedData = [...data].sort((a, b) => {
                        if (a.rootCanisterId === SNEED_SNS_ROOT) return -1;
                        if (b.rootCanisterId === SNEED_SNS_ROOT) return 1;
                        return a.name.localeCompare(b.name);
                    });
                    setSnsList(sortedData);
                    setLoadingSnses(false);
                }).catch(() => setLoadingSnses(false));
            } catch (e) {
                console.error('Failed to load SNS data:', e);
                setLoadingSnses(false);
            }
        };
        loadSnsData();
    }, [identity]);
    
    // Fetch neurons when SNS is selected
    const fetchNeuronsForSelectedSns = useCallback(async (snsRoot) => {
        if (!identity || !snsRoot) {
            setSnsNeurons([]);
            return;
        }
        
        setLoadingSnsNeurons(true);
        try {
            const snsData = getSnsById(snsRoot);
            if (!snsData) {
                setSnsNeurons([]);
                return;
            }
            
            const neurons = await fetchUserNeuronsForSns(identity, snsData.canisters.governance);
            
            // Filter to only neurons where user has hotkey permissions
            const userPrincipal = identity.getPrincipal().toString();
            const hotkeyNeurons = neurons.filter(neuron => {
                return neuron.permissions?.some(p => 
                    p.principal?.[0]?.toString() === userPrincipal
                );
            });
            
            setSnsNeurons(hotkeyNeurons);
            
            // Auto-set governance ID
            setNewAssetGovernanceId(snsData.canisters.governance);
        } catch (e) {
            console.error('Failed to fetch neurons:', e);
            setSnsNeurons([]);
        } finally {
            setLoadingSnsNeurons(false);
        }
    }, [identity]);
    
    // Robust neuron ID extraction - handles different structures
    const extractNeuronId = useCallback((neuron) => {
        // Try standard structure: neuron.id[0].id (Candid opt type)
        if (neuron.id && Array.isArray(neuron.id) && neuron.id.length > 0 && neuron.id[0]?.id) {
            return uint8ArrayToHex(neuron.id[0].id);
        }
        // Try direct id structure: neuron.id.id
        if (neuron.id && neuron.id.id && !Array.isArray(neuron.id)) {
            return uint8ArrayToHex(neuron.id.id);
        }
        // Try if id is directly bytes
        if (neuron.id && (neuron.id instanceof Uint8Array || (Array.isArray(neuron.id) && typeof neuron.id[0] === 'number'))) {
            return uint8ArrayToHex(neuron.id);
        }
        // Fallback to getNeuronId utility
        return getNeuronId(neuron);
    }, []);
    
    // Get display name for a neuron (with name/nickname if available)
    const getNeuronDisplayName = useCallback((neuron, snsRoot) => {
        const idHex = extractNeuronId(neuron) || '';
        const shortId = idHex.length > 16 ? idHex.slice(0, 8) + '...' + idHex.slice(-8) : (idHex || '???');
        const stake = neuron.cached_neuron_stake_e8s ? 
            (Number(neuron.cached_neuron_stake_e8s) / 1e8).toFixed(2) : '0';
        
        // Try to get name/nickname from naming context
        let displayName = shortId;
        if (snsRoot && idHex && getNeuronNameInfo) {
            const nameInfo = getNeuronNameInfo(idHex, snsRoot);
            if (nameInfo) {
                // Prefer nickname, then public name
                if (nameInfo.nickname) {
                    displayName = `🏷️ ${nameInfo.nickname}`;
                } else if (nameInfo.name) {
                    displayName = nameInfo.name;
                }
            }
        }
        
        return `${displayName} (${stake} tokens)`;
    }, [extractNeuronId, getNeuronNameInfo]);
    
    const [newAssetTokenLedger, setNewAssetTokenLedger] = useState('');
    const [newAssetTokenAmount, setNewAssetTokenAmount] = useState('');
    const [newAssetTokenSymbol, setNewAssetTokenSymbol] = useState('');
    const [newAssetTokenDecimals, setNewAssetTokenDecimals] = useState('8');
    const [newAssetTokenLogo, setNewAssetTokenLogo] = useState('');
    const [newAssetTokenBalance, setNewAssetTokenBalance] = useState(null);
    const [loadingTokenBalance, setLoadingTokenBalance] = useState(false);
    
    // Fetch balance for selected asset token
    const fetchAssetTokenBalance = useCallback(async (ledgerId) => {
        if (!identity || !ledgerId) {
            setNewAssetTokenBalance(null);
            return;
        }
        
        setLoadingTokenBalance(true);
        try {
            const host = getHost();
            const agent = HttpAgent.createSync({ host, identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const ledgerActor = createLedgerActor(ledgerId, { agent });
            const balance = await ledgerActor.icrc1_balance_of({
                owner: identity.getPrincipal(),
                subaccount: [],
            });
            setNewAssetTokenBalance(balance);
        } catch (e) {
            console.error('Failed to fetch token balance:', e);
            setNewAssetTokenBalance(null);
        } finally {
            setLoadingTokenBalance(false);
        }
    }, [identity]);
    
    // Fetch prices for assets when assets or snsList changes
    useEffect(() => {
        const fetchAssetPrices = async () => {
            const ledgerIds = new Set();
            
            // Collect ledgers from token assets
            assets.forEach(asset => {
                if (asset.type === 'token' && asset.ledger_id) {
                    ledgerIds.add(asset.ledger_id);
                } else if (asset.type === 'neuron' && asset.governance_id) {
                    // Add SNS ledger for neuron assets
                    const snsLedger = getSnsLedgerFromGovernance(asset.governance_id);
                    if (snsLedger) {
                        ledgerIds.add(snsLedger);
                    }
                }
            });
            
            // Also add current editing token if any
            if (newAssetType === 'token' && newAssetTokenLedger) {
                ledgerIds.add(newAssetTokenLedger);
            }
            
            // Also add SNS ledger for currently editing neuron
            if (newAssetType === 'neuron' && newAssetGovernanceId) {
                const snsLedger = getSnsLedgerFromGovernance(newAssetGovernanceId);
                if (snsLedger) {
                    ledgerIds.add(snsLedger);
                }
            }
            
            if (ledgerIds.size === 0) return;
            
            const newPrices = {};
            for (const ledgerId of ledgerIds) {
                try {
                    const token = whitelistedTokens.find(t => t.ledger_id.toString() === ledgerId);
                    const decimals = token ? Number(token.decimals) : 8;
                    const price = await priceService.getTokenUSDPrice(ledgerId, decimals);
                    newPrices[ledgerId] = price;
                } catch (e) {
                    // Silently ignore - token may not have an ICPSwap pool
                }
            }
            setAssetPrices(prev => ({ ...prev, ...newPrices }));
        };
        
        if (snsList.length > 0) {
            fetchAssetPrices();
        }
    }, [assets, snsList, newAssetType, newAssetTokenLedger, newAssetGovernanceId, whitelistedTokens, getSnsLedgerFromGovernance]);
    
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState('');
    const [step, setStep] = useState(1); // 1: Configure, 2: Add Assets, 3: Review
    const [createdOfferId, setCreatedOfferId] = useState(null);
    
    // Review step verification
    const [reviewVerification, setReviewVerification] = useState({}); // {assetKey: {verified, checking, message}}
    const [allAssetsReady, setAllAssetsReady] = useState(false);
    
    // Auto-create progress overlay
    const [showProgressOverlay, setShowProgressOverlay] = useState(false);
    const [progressSteps, setProgressSteps] = useState([]);
    const [currentProgressStep, setCurrentProgressStep] = useState(0);
    const [progressError, setProgressError] = useState(null);
    
    // Generate unique key for an asset (for duplicate detection and verification tracking)
    const getAssetKey = useCallback((asset) => {
        if (asset.type === 'canister') return `canister:${asset.canister_id}`;
        if (asset.type === 'neuron') return `neuron:${asset.governance_id}:${asset.neuron_id}`;
        if (asset.type === 'token') return `token:${asset.ledger_id}`;
        return `unknown:${Date.now()}`;
    }, []);
    
    // Check if asset already exists in the list
    const assetExists = useCallback((newAsset) => {
        const newKey = getAssetKey(newAsset);
        return assets.some(a => getAssetKey(a) === newKey);
    }, [assets, getAssetKey]);
    
    // Verify canister - check if user is controller
    const verifyCanister = useCallback(async (canisterId) => {
        if (!identity) return { verified: false, message: 'Not authenticated' };
        
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
            
            await managementCanister.canister_status({ canister_id: canisterPrincipal });
            return { verified: true, message: 'You are a controller' };
        } catch (e) {
            return { verified: false, message: 'Not a controller' };
        }
    }, [identity]);
    
    // Check canister controller status and update state
    const checkCanisterControllerStatus = useCallback(async (canisterId) => {
        if (!canisterId) {
            setCanisterControllerStatus(null);
            return;
        }
        
        // Validate canister ID format
        try {
            Principal.fromText(canisterId);
        } catch (e) {
            setCanisterControllerStatus({ verified: false, message: 'Invalid app canister id format' });
            return;
        }
        
        setCanisterControllerStatus({ checking: true });
        const result = await verifyCanister(canisterId);
        setCanisterControllerStatus(result);
    }, [verifyCanister]);
    
    // Debounced effect to check controller status when canister ID changes
    useEffect(() => {
        if (!newAssetCanisterId || newAssetType !== 'canister') {
            setCanisterControllerStatus(null);
            return;
        }
        
        // Validate canister ID format before checking
        try {
            Principal.fromText(newAssetCanisterId);
        } catch (e) {
            // Invalid format, don't check yet
            setCanisterControllerStatus(null);
            return;
        }
        
        // Debounce the check
        const timer = setTimeout(() => {
            checkCanisterControllerStatus(newAssetCanisterId);
        }, 500);
        
        return () => clearTimeout(timer);
    }, [newAssetCanisterId, newAssetType, checkCanisterControllerStatus]);
    
    // Verify if a canister is an ICP Neuron Manager with wasm hash verification
    const verifyICPNeuronManager = useCallback(async (canisterId) => {
        if (!canisterId) return { verified: false, message: 'No app canister id' };
        
        try {
            setVerifyingCanisterKind(true);
            setCanisterKindVerified(null);
            
            const host = getHost();
            const agent = HttpAgent.createSync({ host, identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            // Step 1: Get canister's module_hash via management canister
            const canisterPrincipal = Principal.fromText(canisterId);
            const managementCanister = Actor.createActor(managementIdlFactory, {
                agent,
                canisterId: MANAGEMENT_CANISTER_ID,
                callTransform: (methodName, args, callConfig) => ({
                    ...callConfig,
                    effectiveCanisterId: canisterPrincipal,
                }),
            });
            
            let moduleHash = null;
            try {
                const status = await managementCanister.canister_status({ canister_id: canisterPrincipal });
                if (status.module_hash && status.module_hash.length > 0) {
                    moduleHash = uint8ArrayToHex(status.module_hash[0]);
                }
            } catch (e) {
                // User might not be controller - continue anyway since wasm hash is public info
                console.log('Could not get canister status (may not be controller):', e.message);
            }
            
            // Step 2: Call getVersion() on the neuron manager to verify it responds correctly
            const sneedexActor = await createSneedexActor(identity);
            const versionResult = await sneedexActor.verifyICPNeuronManager(canisterPrincipal);
            
            if ('Err' in versionResult) {
                setCanisterKindVerified(versionResult.Err);
                return { verified: false, message: versionResult.Err };
            }
            
            const version = versionResult.Ok;
            const versionStr = `${Number(version.major)}.${Number(version.minor)}.${Number(version.patch)}`;
            
            // Step 3: Verify wasm hash against official versions if we have it
            let officialVersion = null;
            let wasmVerified = false;
            
            if (moduleHash) {
                try {
                    const factory = createFactoryActor(factoryCanisterId, { agent });
                    const officialVersionResult = await factory.getOfficialVersionByHash(moduleHash);
                    if (officialVersionResult && officialVersionResult.length > 0) {
                        officialVersion = officialVersionResult[0];
                        const officialVersionStr = `${Number(officialVersion.major)}.${Number(officialVersion.minor)}.${Number(officialVersion.patch)}`;
                        wasmVerified = (officialVersionStr === versionStr);
                    }
                } catch (e) {
                    console.log('Could not check official versions:', e.message);
                }
            }
            
            // Build verification result
            const verificationInfo = {
                verified: true,
                version: version,
                versionStr: versionStr,
                moduleHash: moduleHash,
                officialVersion: officialVersion,
                wasmVerified: wasmVerified,
            };
            
            setCanisterKindVerified(verificationInfo);
            return verificationInfo;
            
        } catch (e) {
            const msg = 'Failed to verify: ' + (e.message || 'Unknown error');
            setCanisterKindVerified(msg);
            return { verified: false, message: msg };
        } finally {
            setVerifyingCanisterKind(false);
        }
    }, [identity]);
    
    // Fetch neuron manager info (list of ICP neurons inside)
    const fetchNeuronManagerInfo = useCallback(async (canisterId) => {
        if (!canisterId || !identity) return;
        
        setLoadingNeuronManagerInfo(true);
        setNeuronManagerInfo(null);
        
        try {
            const host = getHost();
            const agent = HttpAgent.createSync({ host, identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const nmActor = createNeuronManagerActor(canisterId, { agent });
            const neuronsData = await nmActor.getAllNeuronsInfo();
            
            // Process neuron data to calculate totals
            let totalStakeE8s = 0n;
            let totalMaturityE8s = 0n;
            
            const neurons = neuronsData.map(([neuronId, infoOpt]) => {
                const info = infoOpt?.[0] || infoOpt;
                const stakeE8s = info?.stake_e8s ? BigInt(info.stake_e8s) : 0n;
                const maturityE8s = info?.maturity_e8s_equivalent ? BigInt(info.maturity_e8s_equivalent) : 0n;
                const stakedMaturityE8s = info?.staked_maturity_e8s_equivalent ? BigInt(info.staked_maturity_e8s_equivalent) : 0n;
                
                totalStakeE8s += stakeE8s;
                totalMaturityE8s += maturityE8s + stakedMaturityE8s;
                
                // Get dissolve state for ICP neurons (state: 1=Locked, 2=Dissolving, 3=Dissolved)
                let dissolveState = 'Unknown';
                let dissolveDelaySeconds = 0n;
                
                // ICP neurons use 'state' field: 1=Locked, 2=Dissolving, 3=Dissolved
                if (info?.state !== undefined) {
                    const state = Number(info.state);
                    dissolveState = state === 1 ? 'Locked' : state === 2 ? 'Dissolving' : state === 3 ? 'Dissolved' : 'Unknown';
                }
                
                if (info?.dissolve_delay_seconds !== undefined) {
                    dissolveDelaySeconds = BigInt(info.dissolve_delay_seconds);
                }
                
                // Get neuron ID - it may be a BigInt directly or have an 'id' property
                let nId = 0;
                if (typeof neuronId === 'bigint') {
                    nId = Number(neuronId);
                } else if (neuronId?.id !== undefined) {
                    nId = Number(neuronId.id);
                } else if (typeof neuronId === 'number') {
                    nId = neuronId;
                }
                
                return {
                    neuronId: nId,
                    stakeE8s,
                    maturityE8s: maturityE8s + stakedMaturityE8s,
                    totalE8s: stakeE8s + maturityE8s + stakedMaturityE8s,
                    dissolveState,
                    dissolveDelaySeconds,
                    ageSeconds: info?.age_seconds ? BigInt(info.age_seconds) : 0n,
                };
            });
            
            const totalIcpE8s = totalStakeE8s + totalMaturityE8s;
            
            setNeuronManagerInfo({
                neurons,
                totalStakeE8s,
                totalMaturityE8s,
                totalIcpE8s,
            });
            
        } catch (e) {
            console.error('Failed to fetch ICP staking bot info:', e);
            setNeuronManagerInfo(null);
        } finally {
            setLoadingNeuronManagerInfo(false);
        }
    }, [identity]);
    
    // Fetch neuron manager info when one is selected and verified
    useEffect(() => {
        if (newAssetCanisterKind === CANISTER_KIND_ICP_NEURON_MANAGER && 
            canisterKindVerified?.verified && 
            newAssetCanisterId) {
            fetchNeuronManagerInfo(newAssetCanisterId);
        } else {
            setNeuronManagerInfo(null);
        }
    }, [newAssetCanisterKind, canisterKindVerified, newAssetCanisterId, fetchNeuronManagerInfo]);
    
    // Verify ICRC1 token - check if user has sufficient balance
    const verifyTokenBalance = useCallback(async (ledgerId, amount, decimals) => {
        if (!identity) return { verified: false, message: 'Not authenticated' };
        
        try {
            const host = getHost();
            const agent = HttpAgent.createSync({ host, identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const ledgerActor = createLedgerActor(ledgerId, { agent });
            const balance = await ledgerActor.icrc1_balance_of({
                owner: identity.getPrincipal(),
                subaccount: [],
            });
            
            // Get fee
            const token = whitelistedTokens.find(t => t.ledger_id.toString() === ledgerId);
            const fee = token?.fee ? Number(token.fee) : 10000;
            
            // Required: amount + fee (in smallest units)
            const amountInSmallest = parseFloat(amount) * Math.pow(10, decimals);
            const required = amountInSmallest + fee;
            
            if (Number(balance) >= required) {
                return { verified: true, message: 'Sufficient balance' };
            } else {
                const shortfall = (required - Number(balance)) / Math.pow(10, decimals);
                return { verified: false, message: `Insufficient balance (need ${shortfall.toFixed(4)} more)` };
            }
        } catch (e) {
            return { verified: false, message: 'Could not verify balance' };
        }
    }, [identity, whitelistedTokens]);
    
    // Verify SNS Neuron - check if user has hotkey with full permissions
    const verifyNeuronHotkey = useCallback(async (governanceId, neuronId) => {
        if (!identity) return { verified: false, message: 'Not authenticated' };
        
        try {
            const host = getHost();
            const agent = HttpAgent.createSync({ host, identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const governanceActor = createGovernanceActor(governanceId, { agent });
            const neuronIdBlob = new Uint8Array(neuronId.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            
            const result = await governanceActor.get_neuron({
                neuron_id: [{ id: neuronIdBlob }]
            });
            
            if (result.result && result.result[0] && 'Neuron' in result.result[0]) {
                const neuron = result.result[0].Neuron;
                const userPrincipal = identity.getPrincipal().toString();
                
                // Check permissions - need all key permissions
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
                return { verified: false, message: 'No permissions found - add Sneedex as hotkey' };
            }
            return { verified: false, message: 'Neuron not found or no access' };
        } catch (e) {
            console.error('Failed to verify neuron:', e);
            return { verified: false, message: 'Could not verify neuron permissions' };
        }
    }, [identity]);
    
    // Verify neuron when one is selected (debounced)
    useEffect(() => {
        if (!newAssetGovernanceId || !newAssetNeuronId || newAssetNeuronId.length < 10) {
            setNeuronVerificationStatus(null);
            return;
        }
        
        const timeoutId = setTimeout(async () => {
            setNeuronVerificationStatus({ checking: true });
            const result = await verifyNeuronHotkey(newAssetGovernanceId, newAssetNeuronId);
            setNeuronVerificationStatus(result);
        }, 500); // Debounce 500ms
        
        return () => clearTimeout(timeoutId);
    }, [newAssetGovernanceId, newAssetNeuronId, verifyNeuronHotkey]);
    
    // Verify an asset and update verification state
    const verifyAsset = useCallback(async (asset) => {
        const key = getAssetKey(asset);
        
        setAssetVerification(prev => ({
            ...prev,
            [key]: { ...prev[key], checking: true }
        }));
        
        let result;
        if (asset.type === 'canister') {
            result = await verifyCanister(asset.canister_id);
        } else if (asset.type === 'token') {
            result = await verifyTokenBalance(asset.ledger_id, asset.amount, asset.decimals);
        } else if (asset.type === 'neuron') {
            result = await verifyNeuronHotkey(asset.governance_id, asset.neuron_id);
        } else {
            result = { verified: false, message: 'Unknown asset type' };
        }
        
        setAssetVerification(prev => ({
            ...prev,
            [key]: { verified: result.verified, checking: false, message: result.message }
        }));
    }, [getAssetKey, verifyCanister, verifyTokenBalance, verifyNeuronHotkey]);
    
    // Verify all assets when they change
    useEffect(() => {
        assets.forEach(asset => {
            const key = getAssetKey(asset);
            // Only verify if not already verified or checking
            if (!assetVerification[key] || (!assetVerification[key].checking && assetVerification[key].verified === undefined)) {
                verifyAsset(asset);
            }
        });
    }, [assets, getAssetKey, assetVerification, verifyAsset]);
    
    // Verify all assets when entering review step
    const verifyAllAssetsForReview = useCallback(async () => {
        if (!identity || assets.length === 0) {
            setAllAssetsReady(false);
            return;
        }
        
        const newVerification = {};
        let allReady = true;
        
        for (const asset of assets) {
            const key = getAssetKey(asset);
            newVerification[key] = { checking: true, verified: undefined, message: 'Checking...' };
        }
        setReviewVerification(newVerification);
        
        for (const asset of assets) {
            const key = getAssetKey(asset);
            let result;
            
            try {
                if (asset.type === 'canister') {
                    result = await verifyCanister(asset.canister_id);
                } else if (asset.type === 'token') {
                    result = await verifyTokenBalance(asset.ledger_id, asset.amount, asset.decimals);
                } else if (asset.type === 'neuron') {
                    result = await verifyNeuronHotkey(asset.governance_id, asset.neuron_id);
                } else {
                    result = { verified: false, message: 'Unknown asset type' };
                }
            } catch (e) {
                result = { verified: false, message: 'Verification failed' };
            }
            
            newVerification[key] = { checking: false, verified: result.verified, message: result.message };
            if (!result.verified) allReady = false;
            
            setReviewVerification({ ...newVerification });
        }
        
        setAllAssetsReady(allReady);
    }, [identity, assets, getAssetKey, verifyCanister, verifyTokenBalance, verifyNeuronHotkey]);
    
    // Trigger review verification when entering step 3
    useEffect(() => {
        if (step === 3) {
            verifyAllAssetsForReview();
        }
    }, [step, verifyAllAssetsForReview]);
    
    const addAsset = () => {
        setError('');
        let asset;
        
        try {
            if (newAssetType === 'canister' || newAssetType === 'neuron_manager') {
                if (!newAssetCanisterId.trim()) {
                    setError(newAssetType === 'neuron_manager' ? 'Please enter an ICP Staking Bot app canister id' : 'Please enter an app canister id');
                    return;
                }
                // Validate principal
                Principal.fromText(newAssetCanisterId.trim());
                
                // For neuron_manager type, verification is required
                if (newAssetType === 'neuron_manager' && !canisterKindVerified?.verified) {
                    setError('Please verify the app canister is an ICP Staking Bot first');
                    return;
                }
                
                // Validate title and description lengths
                if (newAssetCanisterTitle.length > MAX_CANISTER_TITLE_LENGTH) {
                    setError(`Title exceeds maximum length of ${MAX_CANISTER_TITLE_LENGTH} characters`);
                    return;
                }
                if (newAssetCanisterDescription.length > MAX_CANISTER_DESCRIPTION_LENGTH) {
                    setError(`Description exceeds maximum length of ${MAX_CANISTER_DESCRIPTION_LENGTH} characters`);
                    return;
                }
                
                // Determine canister kind based on asset type
                const canisterKind = newAssetType === 'neuron_manager' ? CANISTER_KIND_ICP_NEURON_MANAGER : CANISTER_KIND_UNKNOWN;
                const displayTitle = newAssetCanisterTitle.trim() || `${newAssetCanisterId.trim().slice(0, 10)}...`;
                
                // For neuron managers, store the total ICP
                let totalIcpE8s = null;
                if (newAssetType === 'neuron_manager' && neuronManagerInfo) {
                    totalIcpE8s = neuronManagerInfo.totalIcpE8s;
                }
                
                const displayName = (newAssetType === 'neuron_manager' && totalIcpE8s)
                    ? `${(Number(totalIcpE8s) / 1e8).toFixed(2)} ICP (Staking Bot)`
                    : newAssetType === 'neuron_manager' 
                    ? `ICP Staking Bot: ${displayTitle}`
                        : `App: ${displayTitle}`;
                
                asset = { 
                    type: 'canister', // Always save as 'canister' type in the backend
                    canister_id: newAssetCanisterId.trim(),
                    canister_kind: canisterKind,
                    title: newAssetCanisterTitle.trim() || null,
                    description: newAssetCanisterDescription.trim() || null,
                    totalIcpE8s, // Store for neuron managers
                    display: displayName
                };
            } else if (newAssetType === 'neuron') {
                if (!selectedSnsRoot || !newAssetGovernanceId.trim()) {
                    setError('Please select an SNS');
                    return;
                }
                if (!newAssetNeuronId.trim()) {
                    setError('Please select or enter a neuron ID');
                    return;
                }
                // Validate governance principal
                Principal.fromText(newAssetGovernanceId.trim());
                
                // Get stake from selected neuron (if available)
                const selectedNeuron = snsNeurons.find(n => extractNeuronId(n) === newAssetNeuronId.trim());
                const stakeE8s = selectedNeuron?.cached_neuron_stake_e8s || null;
                const sns = snsList.find(s => s.rootCanisterId === selectedSnsRoot);
                const snsSymbol = sns?.tokenSymbol || 'tokens';
                const snsDecimals = sns?.decimals || 8;
                const stakeDisplay = stakeE8s ? (Number(stakeE8s) / Math.pow(10, snsDecimals)).toFixed(2) : '?';
                
                asset = { 
                    type: 'neuron', 
                    governance_id: newAssetGovernanceId.trim(), 
                    neuron_id: newAssetNeuronId.trim(),
                    stake: stakeE8s, // Store stake in e8s for USD calculation
                    symbol: snsSymbol,
                    display: `${stakeDisplay} ${snsSymbol} Neuron`
                };
            } else if (newAssetType === 'token') {
                if (!newAssetTokenLedger.trim() || !newAssetTokenAmount.trim()) {
                    setError('Please enter token ledger and amount');
                    return;
                }
                // Validate ledger principal
                Principal.fromText(newAssetTokenLedger.trim());
                const amount = parseFloat(newAssetTokenAmount);
                if (isNaN(amount) || amount <= 0) {
                    setError('Please enter a valid token amount');
                    return;
                }
                asset = { 
                    type: 'token', 
                    ledger_id: newAssetTokenLedger.trim(), 
                    amount: newAssetTokenAmount.trim(),
                    symbol: newAssetTokenSymbol.trim() || 'TOKEN',
                    decimals: parseInt(newAssetTokenDecimals) || 8,
                    logo: newAssetTokenLogo || '',
                    display: `${newAssetTokenAmount} ${newAssetTokenSymbol.trim() || 'TOKEN'}`
                };
            }
        } catch (e) {
            setError('Invalid principal/app canister id format');
            return;
        }
        
        // Check for duplicates (skip if editing the same asset)
        if (editingAssetIndex === null) {
            if (assetExists(asset)) {
                setError('This asset has already been added to the offer');
                return;
            }
            // Adding new asset
            setAssets([...assets, asset]);
        } else {
            // Editing existing asset - check for duplicates with other assets
            const newKey = getAssetKey(asset);
            const isDuplicate = assets.some((a, idx) => idx !== editingAssetIndex && getAssetKey(a) === newKey);
            if (isDuplicate) {
                setError('This asset already exists in the offer');
                return;
            }
            // Update existing asset
            const updatedAssets = [...assets];
            updatedAssets[editingAssetIndex] = asset;
            setAssets(updatedAssets);
            setEditingAssetIndex(null);
        }
        
        setShowAddAsset(false);
        setNewAssetCanisterId('');
        setNewAssetCanisterKind(0);
        setNewAssetCanisterTitle('');
        setNewAssetCanisterDescription('');
        setCanisterKindVerified(null);
        setCanisterControllerStatus(null);
        setNewAssetGovernanceId('');
        setNewAssetNeuronId('');
        setSelectedSnsRoot('');
        setSnsNeurons([]);
        setNewAssetTokenLedger('');
        setNewAssetTokenAmount('');
        setNewAssetTokenSymbol('');
        setNewAssetTokenLogo('');
        setNewAssetTokenBalance(null);
    };
    
    const removeAsset = (index) => {
        setAssets(assets.filter((_, i) => i !== index));
        // If we were editing this asset, cancel the edit
        if (editingAssetIndex === index) {
            cancelAssetEdit();
        } else if (editingAssetIndex !== null && editingAssetIndex > index) {
            // Adjust editing index if we removed an asset before it
            setEditingAssetIndex(editingAssetIndex - 1);
        }
    };
    
    const editAsset = (index) => {
        const asset = assets[index];
        setEditingAssetIndex(index);
        setShowAddAsset(true);
        setError('');
        
        if (asset.type === 'canister') {
            // Use 'neuron_manager' type if canister_kind indicates it's a neuron manager
            if (asset.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER) {
                setNewAssetType('neuron_manager');
            } else {
            setNewAssetType('canister');
            }
            setNewAssetCanisterId(asset.canister_id);
            setNewAssetCanisterKind(asset.canister_kind || 0);
            setNewAssetCanisterTitle(asset.title || '');
            setNewAssetCanisterDescription(asset.description || '');
            // Mark as verified if it was previously added
            if (asset.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER) {
                setCanisterKindVerified({ verified: true, message: 'Previously verified' });
            }
        } else if (asset.type === 'neuron') {
            setNewAssetType('neuron');
            setNewAssetGovernanceId(asset.governance_id);
            setNewAssetNeuronId(asset.neuron_id);
            // Try to find the SNS root for this governance
            const sns = snsList.find(s => s.canisters?.governance === asset.governance_id);
            if (sns) {
                setSelectedSnsRoot(sns.rootCanisterId);
            }
        } else if (asset.type === 'token') {
            setNewAssetType('token');
            setNewAssetTokenLedger(asset.ledger_id);
            setNewAssetTokenAmount(asset.amount?.toString() || '');
            setNewAssetTokenSymbol(asset.symbol || '');
            setNewAssetTokenDecimals(asset.decimals?.toString() || '8');
            setNewAssetTokenLogo(asset.logo || '');
        }
    };
    
    const cancelAssetEdit = () => {
        setEditingAssetIndex(null);
        setShowAddAsset(false);
        // Reset form fields
        setNewAssetType('canister');
        setNewAssetCanisterId('');
        setNewAssetCanisterKind(0);
        setNewAssetCanisterTitle('');
        setNewAssetCanisterDescription('');
        setCanisterKindVerified(null);
        setCanisterControllerStatus(null);
        setNeuronManagerInfo(null);
        setNewAssetGovernanceId('');
        setNewAssetNeuronId('');
        setNeuronVerificationStatus(null);
        setSelectedSnsRoot('');
        setSnsNeurons([]);
        setNewAssetTokenLedger('');
        setNewAssetTokenAmount('');
        setNewAssetTokenSymbol('');
        setNewAssetTokenDecimals('8');
        setNewAssetTokenLogo('');
        setNewAssetTokenBalance(null);
    };
    
    const validateStep1 = () => {
        if (!minBidPrice && !buyoutPrice) {
            setError('You must set either a minimum bid price or a buyout price (or both)');
            return false;
        }
        if (minBidPrice) {
            const parsedMinBid = parseFloat(minBidPrice);
            if (!Number.isFinite(parsedMinBid) || parsedMinBid <= 0) {
                setError('Minimum bid must be greater than 0. Leave it blank for buyout-only offers.');
                return false;
            }
        }
        if (!hasExpiration && !buyoutPrice) {
            setError('If there is no expiration, you must set a buyout price');
            return false;
        }
        // Validate expiration time is at least 1 minute
        if (hasExpiration) {
            const days = parseInt(expirationDays) || 0;
            const hours = parseInt(expirationHours) || 0;
            const minutes = parseInt(expirationMinutes) || 0;
            const totalMinutes = (days * 24 * 60) + (hours * 60) + minutes;
            if (totalMinutes < 1) {
                setError('Expiration time must be at least 1 minute');
                return false;
            }
        }
        if (minBidPrice && buyoutPrice && parseFloat(minBidPrice) > parseFloat(buyoutPrice)) {
            setError('Minimum bid cannot be higher than buyout price');
            return false;
        }
        try {
            Principal.fromText(priceTokenLedger);
        } catch (e) {
            setError('Invalid price token ledger ID');
            return false;
        }
        setError('');
        return true;
    };
    
    const validateStep2 = () => {
        if (assets.length === 0) {
            setError('You must add at least one asset to your offer');
            return false;
        }
        setError('');
        return true;
    };
    
    const handleNext = () => {
        if (step === 1 && validateStep1()) {
            setStep(2);
        } else if (step === 2 && validateStep2()) {
            setStep(3);
        }
    };
    
    const handleBack = () => {
        setStep(step - 1);
        setError('');
    };
    
    // Withdraw payment balance
    const handleWithdrawPayment = async () => {
        if (!identity) return;
        
        setWithdrawingPayment(true);
        setError('');
        
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.withdrawOfferCreationPayment();
            
            if ('ok' in result) {
                await fetchFeeInfo();
            } else {
                setError(`Withdrawal failed: ${JSON.stringify(result.err)}`);
            }
        } catch (e) {
            console.error('Withdrawal error:', e);
            setError(`Withdrawal error: ${e.message}`);
        } finally {
            setWithdrawingPayment(false);
        }
    };
    
    // Check if user has paid enough for offer creation
    const hasEnoughPayment = userPaymentBalance >= offerCreationFee;
    // User needs to have enough ICP to pay (either already deposited, or in wallet)
    const totalAvailable = (userIcpBalance || 0n) + userPaymentBalance;
    const canAffordCreation = totalAvailable >= offerCreationFee + ICP_FEE;
    const needsPayment = offerCreationFee > 0n;
    
    const handleCreate = async () => {
        if (!identity) {
            setError('Please connect your wallet first');
            return;
        }
        
        setCreating(true);
        setError('');
        setProgressError(null);
        
        // Build progress steps based on what we need to do
        const steps = [];
        
        // Add payment step if needed
        const requiresPaymentStep = offerCreationFee > 0n && !hasEnoughPayment;
        if (requiresPaymentStep) {
            steps.push({ label: `Paying ${Number(offerCreationFee) / Number(E8S)} ICP fee...`, status: 'pending' });
        }
        
        steps.push({ label: 'Creating offer...', status: 'pending' });
        steps.push({ label: 'Adding assets...', status: 'pending' });
        steps.push({ label: 'Finalizing offer...', status: 'pending' });
        
        if (allAssetsReady) {
            steps.push({ label: 'Escrowing assets...', status: 'pending' });
            steps.push({ label: 'Activating offer...', status: 'pending' });
        }
        
        setProgressSteps(steps);
        setCurrentProgressStep(0);
        setShowProgressOverlay(true);
        
        let stepIndex = 0;
        
        try {
            const actor = createSneedexActor(identity);
            
            // Step: Pay creation fee (if needed and not already deposited)
            if (requiresPaymentStep) {
                updateProgressStep(stepIndex, 'in_progress');
                
                const icpLedger = createLedgerActor(ICP_LEDGER_ID, {
                    agentOptions: { identity, host: getHost() }
                });
                
                const result = await icpLedger.icrc1_transfer({
                    to: {
                        owner: Principal.fromText(SNEEDEX_CANISTER_ID),
                        subaccount: [paymentSubaccount],
                    },
                    amount: offerCreationFee,
                    fee: [ICP_FEE],
                    memo: [],
                    from_subaccount: [],
                    created_at_time: [],
                });
                
                if ('Err' in result) {
                    const err = result.Err;
                    if ('InsufficientFunds' in err) {
                        throw new Error(`Insufficient funds: ${Number(err.InsufficientFunds.balance) / Number(E8S)} ICP available`);
                    } else {
                        throw new Error(`Payment failed: ${JSON.stringify(err)}`);
                    }
                }
                
                updateProgressStep(stepIndex, 'complete');
                stepIndex++;
            }
            
            // Step: Create the offer
            updateProgressStep(stepIndex, 'in_progress');
            
            // Convert approved bidders to principals
            const approvedBidderPrincipals = approvedBidders.map(str => Principal.fromText(str));
            
            // Convert min bid increment from token amount to fee multiple
            // Always use a minimum increment (fall back to suggested if empty)
            const effectiveIncrement = (minBidIncrement && parseFloat(minBidIncrement) > 0) 
                ? minBidIncrement 
                : suggestedMinBidIncrement;
            let minBidIncrementFeeMultiple = [];
            if (effectiveIncrement && selectedPriceToken && Number(selectedPriceToken.fee) > 0) {
                const incrementInBaseUnits = parseFloat(effectiveIncrement) * Math.pow(10, Number(selectedPriceToken.decimals));
                const feeMultiple = Math.ceil(incrementInBaseUnits / Number(selectedPriceToken.fee));
                if (feeMultiple >= 1) {
                    minBidIncrementFeeMultiple = [BigInt(feeMultiple)];
                }
            }
            
            const createRequest = {
                price_token_ledger: Principal.fromText(priceTokenLedger),
                min_bid_price: minBidPrice ? [parseAmount(minBidPrice, priceTokenDecimals)] : [],
                buyout_price: buyoutPrice ? [parseAmount(buyoutPrice, priceTokenDecimals)] : [],
                expiration: hasExpiration ? [getExpirationNs()] : [],
                approved_bidders: isPrivateOffer && approvedBidderPrincipals.length > 0 ? [approvedBidderPrincipals] : [],
                min_bid_increment_fee_multiple: minBidIncrementFeeMultiple,
                public_note: publicNote.trim() ? [publicNote.trim()] : [],
                note_to_buyer: noteToBuyer.trim() ? [noteToBuyer.trim()] : [],
            };
            
            const createResult = await actor.createOffer(createRequest);
            
            if ('err' in createResult) {
                throw new Error(getErrorMessage(createResult.err));
            }
            
            const offerId = createResult.ok;
            setCreatedOfferId(offerId);
            updateProgressStep(stepIndex, 'complete');
            stepIndex++;
            
            // Step: Add assets to the offer
            updateProgressStep(stepIndex, 'in_progress');
            for (const asset of assets) {
                const assetVariant = createAssetVariant(asset.type, asset);
                const addResult = await actor.addAsset({
                    offer_id: offerId,
                    asset: assetVariant,
                });
                
                if ('err' in addResult) {
                    throw new Error(`Failed to add asset: ${getErrorMessage(addResult.err)}`);
                }
            }
            updateProgressStep(stepIndex, 'complete');
            stepIndex++;
            
            // Step: Finalize assets
            updateProgressStep(stepIndex, 'in_progress');
            const finalizeResult = await actor.finalizeAssets(offerId);
            if ('err' in finalizeResult) {
                throw new Error(`Failed to finalize: ${getErrorMessage(finalizeResult.err)}`);
            }
            updateProgressStep(stepIndex, 'complete');
            stepIndex++;
            
            // If all assets are ready, auto-escrow and activate
            if (allAssetsReady) {
                // Step: Escrow all assets
                updateProgressStep(stepIndex, 'in_progress');
                
                for (let idx = 0; idx < assets.length; idx++) {
                    const asset = assets[idx];
                    
                    if (asset.type === 'canister') {
                        // Add Sneedex as controller then escrow
                        await escrowCanisterAsset(asset.canister_id, offerId, idx);
                    } else if (asset.type === 'neuron') {
                        // Add Sneedex as hotkey then escrow
                        await escrowNeuronAsset(asset.governance_id, asset.neuron_id, offerId, idx);
                    } else if (asset.type === 'token') {
                        // Transfer tokens then escrow
                        await escrowTokenAsset(asset.ledger_id, asset.amount, asset.decimals, offerId, idx, identity.getPrincipal());
                    }
                }
                updateProgressStep(stepIndex, 'complete');
                stepIndex++;
                
                // Step: Activate the offer
                updateProgressStep(stepIndex, 'in_progress');
                const activateResult = await actor.activateOffer(offerId);
                if ('err' in activateResult) {
                    throw new Error(`Failed to activate: ${getErrorMessage(activateResult.err)}`);
                }
                updateProgressStep(stepIndex, 'complete');
            }
            
            // Show success
            setTimeout(() => {
                setShowProgressOverlay(false);
                setStep(4);
            }, 1000);
            
        } catch (e) {
            console.error('Failed to create offer:', e);
            setProgressError(e.message || 'Failed to create offer');
        } finally {
            setCreating(false);
        }
    };
    
    const updateProgressStep = (index, status) => {
        setProgressSteps(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], status };
            return updated;
        });
        if (status === 'in_progress') {
            setCurrentProgressStep(index);
        }
    };
    
    // Auto-escrow helper for canisters
    const escrowCanisterAsset = async (canisterId, offerId, assetIndex) => {
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
        
        // Get current controllers and add Sneedex
        const status = await managementCanister.canister_status({ canister_id: canisterPrincipal });
        const currentControllers = status.settings.controllers;
        
        if (!currentControllers.some(c => c.toString() === SNEEDEX_CANISTER_ID)) {
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
        
        // Call backend to verify and complete escrow
        const actor = createSneedexActor(identity);
        const result = await actor.escrowCanister(offerId, BigInt(assetIndex));
        if ('err' in result) {
            throw new Error(`Failed to escrow app: ${getErrorMessage(result.err)}`);
        }
    };
    
    // Auto-escrow helper for SNS neurons
    const escrowNeuronAsset = async (governanceId, neuronIdHex, offerId, assetIndex) => {
        const host = getHost();
        const agent = HttpAgent.createSync({ host, identity });
        if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
            await agent.fetchRootKey();
        }
        
        const governanceActor = createGovernanceActor(governanceId, { agent });
        const neuronIdBlob = new Uint8Array(neuronIdHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        const sneedexPrincipal = Principal.fromText(SNEEDEX_CANISTER_ID);
        
        // Add Sneedex as hotkey with full permissions
        await governanceActor.manage_neuron({
            subaccount: neuronIdBlob,
            command: [{
                AddNeuronPermissions: {
                    permissions_to_add: [{ permissions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }], // All permissions
                    principal_id: [sneedexPrincipal],
                }
            }]
        });
        
        // Call backend to verify and complete escrow
        const actor = createSneedexActor(identity);
        const result = await actor.escrowSNSNeuron(offerId, BigInt(assetIndex));
        if ('err' in result) {
            throw new Error(`Failed to escrow neuron: ${getErrorMessage(result.err)}`);
        }
        // Refresh hotkey neuron caches - neuron is now in escrow, no longer in our list
        walletContext?.refreshNeuronsForGovernance?.(governanceId);
        const govIdNorm = normalizeId(governanceId);
        const sns = getAllSnses().find(s => normalizeId(s.canisters?.governance) === govIdNorm);
        if (sns?.rootCanisterId) neuronsContext?.refreshNeurons?.(sns.rootCanisterId);
    };
    
    // Auto-escrow helper for ICRC1 tokens
    const escrowTokenAsset = async (ledgerId, amount, decimals, offerId, assetIndex, creatorPrincipal) => {
        const host = getHost();
        const agent = HttpAgent.createSync({ host, identity });
        if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
            await agent.fetchRootKey();
        }
        
        const ledgerActor = createLedgerActor(ledgerId, { agent });
        const sneedexPrincipal = Principal.fromText(SNEEDEX_CANISTER_ID);
        
        // Get the escrow subaccount from the backend
        const actor = createSneedexActor(identity);
        const escrowSubaccount = await actor.getOfferEscrowSubaccount(
            creatorPrincipal,
            offerId
        );
        
        // Transfer tokens to escrow
        const amountBigInt = parseAmount(amount.toString(), decimals);
        const transferResult = await ledgerActor.icrc1_transfer({
            to: {
                owner: sneedexPrincipal,
                subaccount: [escrowSubaccount],
            },
            amount: amountBigInt,
            fee: [],
            memo: [],
            from_subaccount: [],
            created_at_time: [],
        });
        
        if ('Err' in transferResult) {
            throw new Error(`Token transfer failed: ${JSON.stringify(transferResult.Err)}`);
        }
        
        // Call backend to verify escrow
        const result = await actor.escrowICRC1Tokens(offerId, BigInt(assetIndex));
        if ('err' in result) {
            throw new Error(`Failed to escrow tokens: ${getErrorMessage(result.err)}`);
        }
    };
    
    const getAssetIcon = (asset, size = 24) => {
        switch (asset.type) {
            case 'canister': 
                // Show ICP logo for ICP Neuron Manager
                if (asset.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER) {
                    return (
                        <div style={{ position: 'relative', width: size, height: size }}>
                            <img 
                                src="icp_symbol.svg" 
                                alt="ICP" 
                                style={{ 
                                    width: size, 
                                    height: size, 
                                    borderRadius: '50%',
                                    objectFit: 'cover'
                                }} 
                            />
                            <FaRobot style={{ 
                                position: 'absolute', 
                                bottom: -2, 
                                right: -2, 
                                fontSize: size * 0.5,
                                color: theme.colors.accent,
                                background: theme.colors.primaryBg,
                                borderRadius: '50%',
                                padding: '1px',
                            }} />
                        </div>
                    );
                }
                return <FaCubes style={{ color: theme.colors.accent, fontSize: size }} />;
            case 'neuron': {
                // Try to get SNS logo - handle both formats of SNS data
                const sns = snsList.find(s => 
                    s.canisters?.governance === asset.governance_id ||
                    s.governance_canister_id?.[0]?.toString() === asset.governance_id ||
                    s.governance_canister_id?.toString() === asset.governance_id
                );
                // Get the governance ID key that's used in snsLogos map
                const govKey = sns?.canisters?.governance || 
                              sns?.governance_canister_id?.[0]?.toString() || 
                              sns?.governance_canister_id?.toString() ||
                              asset.governance_id;
                const snsLogo = snsLogos.get(govKey) || snsLogos.get(asset.governance_id);
                
                if (snsLogo) {
                    return (
                        <div style={{ position: 'relative', width: size, height: size }}>
                            <img 
                                src={snsLogo} 
                                alt={sns?.name || 'SNS'} 
                                style={{ 
                                    width: size, 
                                    height: size, 
                                    borderRadius: '50%',
                                    objectFit: 'cover'
                                }} 
                            />
                            <FaBrain style={{ 
                                position: 'absolute', 
                                bottom: -2, 
                                right: -2, 
                                fontSize: size * 0.5,
                                color: theme.colors.success,
                                background: theme.colors.primaryBg,
                                borderRadius: '50%',
                                padding: '1px',
                            }} />
                        </div>
                    );
                }
                return <FaBrain style={{ color: theme.colors.success, fontSize: size }} />;
            }
            case 'token': {
                // First check if asset has logo stored directly (from TokenSelector)
                // Fall back to looking in whitelisted tokens
                const logo = asset.logo || (() => {
                    const token = whitelistedTokens.find(t => {
                        const tokenLedgerId = typeof t.ledger_id === 'string' 
                            ? t.ledger_id 
                            : t.ledger_id?.toString?.() || '';
                        return tokenLedgerId === asset.ledger_id;
                    });
                    return token?.logo;
                })();
                
                if (logo) {
                    return (
                        <img 
                            src={logo} 
                            alt={asset.symbol || 'Token'} 
                            style={{ 
                                width: size, 
                                height: size, 
                                borderRadius: '50%',
                                objectFit: 'cover'
                            }} 
                        />
                    );
                }
                return <FaCoins style={{ color: theme.colors.warning, fontSize: size }} />;
            }
            default: return <FaCubes style={{ fontSize: size }} />;
        }
    };
    
    // Calculate USD value for an asset
    const getAssetUsdValue = useCallback((asset) => {
        if (asset.type === 'token') {
            // ICRC1 Token - use token price
            const price = assetPrices[asset.ledger_id];
            if (price && asset.amount) {
                const decimals = asset.decimals || 8;
                const amount = parseFloat(asset.amount);
                return amount * price;
            }
        } else if (asset.type === 'neuron') {
            // SNS Neuron - use SNS token price
            const snsLedger = getSnsLedgerFromGovernance(asset.governance_id);
            const price = snsLedger ? assetPrices[snsLedger] : null;
            if (price && asset.stake) {
                const decimals = getSnsDecimals(asset.governance_id);
                const stake = Number(asset.stake) / Math.pow(10, decimals);
                return stake * price;
            }
        } else if (asset.type === 'canister' && asset.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER) {
            // ICP Neuron Manager - use stored totalIcpE8s and ICP price
            if (asset.totalIcpE8s && icpPrice) {
                return (Number(asset.totalIcpE8s) / 1e8) * icpPrice;
            }
            return null;
        }
        return null;
    }, [assetPrices, icpPrice, getSnsLedgerFromGovernance, getSnsDecimals]);

    // Responsive CSS for mobile
    useEffect(() => {
        const mediaQueryCSS = `
            <style id="sneedex-create-responsive-css">
                @media (max-width: 600px) {
                    .sneedex-create-container {
                        padding: 1rem !important;
                    }
                    .sneedex-create-card {
                        padding: 1rem !important;
                    }
                    .sneedex-create-asset-types {
                        gap: 8px !important;
                        padding: 6px !important;
                    }
                    .sneedex-create-asset-types button {
                        padding: 10px 6px !important;
                        gap: 4px !important;
                    }
                    .sneedex-create-progress-bar {
                        margin-bottom: 1rem !important;
                    }
                    .sneedex-create-progress-label {
                        font-size: 0.7rem !important;
                    }
                }
            </style>
        `;
        
        const existingStyle = document.getElementById('sneedex-create-responsive-css');
        if (existingStyle) {
            existingStyle.remove();
        }
        document.head.insertAdjacentHTML('beforeend', mediaQueryCSS);
        
        return () => {
            const style = document.getElementById('sneedex-create-responsive-css');
            if (style) style.remove();
        };
    }, []);

    const styles = {
        container: {
            maxWidth: '800px',
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
        title: {
            fontSize: '2.5rem',
            fontWeight: '700',
            color: theme.colors.accent,
            marginBottom: '0.5rem',
        },
        subtitle: {
            color: theme.colors.mutedText,
            marginBottom: '2rem',
        },
        progressBar: {
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '2rem',
            position: 'relative',
        },
        progressStep: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            flex: 1,
            zIndex: 1,
        },
        progressCircle: {
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '600',
            marginBottom: '8px',
            transition: 'all 0.3s ease',
        },
        progressLabel: {
            fontSize: '0.85rem',
            color: theme.colors.mutedText,
            textAlign: 'center',
        },
        progressLine: {
            position: 'absolute',
            top: '20px',
            left: '20%',
            right: '20%',
            height: '2px',
            background: theme.colors.border,
            zIndex: 0,
        },
        card: {
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
            padding: '2rem',
            marginBottom: '1.5rem',
        },
        cardTitle: {
            fontSize: '1.3rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
            marginBottom: '1.5rem',
        },
        formGroup: {
            marginBottom: '1.5rem',
        },
        label: {
            display: 'block',
            fontSize: '0.95rem',
            fontWeight: '500',
            color: theme.colors.primaryText,
            marginBottom: '0.5rem',
        },
        labelHint: {
            fontSize: '0.85rem',
            color: theme.colors.mutedText,
            fontWeight: 'normal',
        },
        input: {
            width: '100%',
            padding: '12px 16px',
            borderRadius: '10px',
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            fontSize: '1rem',
            outline: 'none',
            transition: 'border-color 0.3s ease',
            boxSizing: 'border-box',
        },
        inputRow: {
            display: 'flex',
            gap: '1rem',
            alignItems: 'flex-end',
        },
        checkbox: {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            cursor: 'pointer',
        },
        checkboxInput: {
            width: '20px',
            height: '20px',
            cursor: 'pointer',
        },
        select: {
            width: '100%',
            padding: '12px 16px',
            borderRadius: '10px',
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            fontSize: '1rem',
            outline: 'none',
            cursor: 'pointer',
        },
        assetsList: {
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            marginBottom: '1.5rem',
        },
        assetItem: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.75rem',
            background: theme.colors.tertiaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '10px',
            flexWrap: 'wrap',
            gap: '0.5rem',
        },
        assetInfo: {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flex: '1 1 auto',
            minWidth: 0,
            overflow: 'hidden',
        },
        assetDetails: {
            fontSize: '0.85rem',
            minWidth: 0,
            overflow: 'hidden',
        },
        assetType: {
            fontWeight: '600',
            color: theme.colors.primaryText,
        },
        assetId: {
            fontSize: '0.8rem',
            color: theme.colors.mutedText,
            fontFamily: 'monospace',
        },
        removeButton: {
            background: 'transparent',
            border: 'none',
            color: theme.colors.error || '#ff4444',
            cursor: 'pointer',
            padding: '6px',
            borderRadius: '6px',
            transition: 'background 0.3s ease',
            fontSize: '0.85rem',
        },
        editButton: {
            background: 'transparent',
            border: 'none',
            color: theme.colors.accent,
            cursor: 'pointer',
            padding: '6px',
            borderRadius: '6px',
            transition: 'background 0.3s ease',
            fontSize: '0.85rem',
        },
        addAssetButton: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            width: '100%',
            padding: '1rem',
            background: `${theme.colors.accent}15`,
            border: `2px dashed ${theme.colors.accent}`,
            borderRadius: '10px',
            color: theme.colors.accent,
            fontSize: '1rem',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
        },
        addAssetModal: {
            background: theme.colors.tertiaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '12px',
            padding: '1.5rem',
            marginTop: '1rem',
        },
        buttonRow: {
            display: 'flex',
            justifyContent: 'space-between',
            gap: '1rem',
            marginTop: '2rem',
        },
        backBtn: {
            padding: '12px 24px',
            borderRadius: '10px',
            border: `2px solid ${theme.colors.border}`,
            background: 'transparent',
            color: theme.colors.primaryText,
            fontSize: '1rem',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
        },
        nextBtn: {
            padding: '12px 32px',
            borderRadius: '10px',
            border: 'none',
            background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}cc)`,
            color: theme.colors.primaryBg,
            fontSize: '1rem',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
        },
        createBtn: {
            padding: '14px 40px',
            borderRadius: '10px',
            border: 'none',
            background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}cc)`,
            color: theme.colors.primaryBg,
            fontSize: '1.1rem',
            fontWeight: '700',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
        },
        errorText: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: theme.colors.error || '#ff4444',
            background: `${theme.colors.error || '#ff4444'}15`,
            padding: '12px 16px',
            borderRadius: '8px',
            marginBottom: '1.5rem',
        },
        reviewSection: {
            marginBottom: '1.5rem',
            padding: '1rem',
            background: theme.colors.tertiaryBg,
            borderRadius: '10px',
        },
        reviewLabel: {
            fontSize: '0.85rem',
            color: theme.colors.mutedText,
            marginBottom: '4px',
        },
        reviewValue: {
            fontSize: '1.1rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
        },
        emptyAssets: {
            textAlign: 'center',
            padding: '2rem',
            color: theme.colors.mutedText,
        },
        successCard: {
            background: `${theme.colors.success}15`,
            border: `1px solid ${theme.colors.success}`,
            borderRadius: '16px',
            padding: '2rem',
            textAlign: 'center',
        },
        successIcon: {
            fontSize: '4rem',
            marginBottom: '1rem',
        },
        successTitle: {
            fontSize: '1.5rem',
            fontWeight: '700',
            color: theme.colors.success,
            marginBottom: '1rem',
        },
        successText: {
            color: theme.colors.primaryText,
            marginBottom: '1.5rem',
            lineHeight: '1.6',
        },
        nextStepsBox: {
            background: theme.colors.tertiaryBg,
            borderRadius: '10px',
            padding: '1.5rem',
            textAlign: 'left',
            marginTop: '1.5rem',
        },
    };
    
    const getStepStyle = (stepNum) => ({
        ...styles.progressCircle,
        background: step >= stepNum ? theme.colors.accent : theme.colors.tertiaryBg,
        color: step >= stepNum ? theme.colors.primaryBg : theme.colors.mutedText,
        border: `2px solid ${step >= stepNum ? theme.colors.accent : theme.colors.border}`,
    });

    if (!isAuthenticated) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main style={styles.container} className="sneedex-create-container">
                    <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
                        <h2 style={{ color: theme.colors.primaryText, marginBottom: '1rem' }}>Connect Your Wallet</h2>
                        <p style={{ color: theme.colors.mutedText }}>Please connect your wallet to create an offer.</p>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={{ color: theme.colors.primaryText }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(180deg, ${sneedexPrimary}12 0%, transparent 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    padding: '2rem 1.5rem 1.5rem',
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    {/* Decorative glows */}
                    <div style={{
                        position: 'absolute',
                        top: '-50%',
                        right: '-10%',
                        width: '400px',
                        height: '400px',
                        background: `radial-gradient(circle, ${sneedexPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    <div style={{
                        position: 'absolute',
                        bottom: '-30%',
                        left: '-5%',
                        width: '300px',
                        height: '300px',
                        background: `radial-gradient(circle, ${sneedexSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    
                    <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                        {/* Back link */}
                        <Link 
                            to="/sneedex_offers" 
                            style={{
                                color: theme.colors.mutedText,
                                textDecoration: 'none',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                                fontSize: '0.9rem',
                                marginBottom: '1rem',
                                transition: 'color 0.2s ease'
                            }}
                            onMouseEnter={(e) => e.target.style.color = sneedexPrimary}
                            onMouseLeave={(e) => e.target.style.color = theme.colors.mutedText}
                        >
                            <FaArrowLeft /> Back to Marketplace
                        </Link>
                        
                        {/* Hero Content */}
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            textAlign: 'center'
                        }}>
                            {/* Icon and Title */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '1rem',
                                marginBottom: '0.5rem'
                            }}>
                                <div style={{
                                    width: '56px',
                                    height: '56px',
                                    borderRadius: '16px',
                                    background: `linear-gradient(135deg, ${sneedexPrimary}, ${sneedexSecondary})`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: `0 4px 20px ${sneedexPrimary}40`
                                }}>
                                    <FaPlus size={26} color="white" />
                                </div>
                                <h1 style={{
                                    fontSize: '2rem',
                                    fontWeight: '800',
                                    margin: 0,
                                    background: `linear-gradient(135deg, ${theme.colors.primaryText} 30%, ${sneedexPrimary})`,
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent',
                                    backgroundClip: 'text'
                                }}>
                                    Create Offer
                                </h1>
                            </div>
                            
                            <p style={{
                                color: theme.colors.mutedText,
                                fontSize: '0.95rem',
                                margin: 0,
                                maxWidth: '500px'
                            }}>
                                List your assets for auction or instant sale
                            </p>
                        </div>
                    </div>
                </div>
                
                {/* Main Content */}
                <div style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }} className="sneedex-create-container">
                
                {/* Progress Bar */}
                {step < 4 && (
                    <div style={styles.progressBar} className="sneedex-create-progress-bar">
                        <div style={styles.progressLine} />
                        <div style={styles.progressStep}>
                            <div style={getStepStyle(1)}>{step > 1 ? <FaCheck /> : '1'}</div>
                            <span style={styles.progressLabel}>Configure Pricing</span>
                        </div>
                        <div style={styles.progressStep}>
                            <div style={getStepStyle(2)}>{step > 2 ? <FaCheck /> : '2'}</div>
                            <span style={styles.progressLabel}>Add Assets</span>
                        </div>
                        <div style={styles.progressStep}>
                            <div style={getStepStyle(3)}>3</div>
                            <span style={styles.progressLabel}>Review & Create</span>
                        </div>
                    </div>
                )}
                
                {error && (
                    <div style={styles.errorText}>
                        <FaExclamationTriangle /> {error}
                    </div>
                )}
                
                {/* Step 1: Configure Pricing */}
                {step === 1 && (
                    <div style={styles.card} className="sneedex-create-card">
                        <h3 style={styles.cardTitle}>Pricing Configuration</h3>
                        
                        <div style={styles.formGroup}>
                            <label style={styles.label}>
                                Price Token
                                <span style={styles.labelHint}> — The token buyers will pay in</span>
                            </label>
                            <TokenSelector
                                value={priceTokenLedger}
                                onChange={(ledgerId) => {
                                    setPriceTokenLedger(ledgerId);
                                    // Check if it's a whitelisted token and populate from there
                                    const token = whitelistedTokens.find(t => t.ledger_id.toString() === ledgerId);
                                    if (token) {
                                        setCustomPriceTokenSymbol(token.symbol);
                                        setCustomPriceTokenDecimals(token.decimals.toString());
                                        setCustomPriceTokenName(token.name || '');
                                        setCustomPriceTokenLogo(token.logo?.[0] || '');
                                    } else {
                                        // Clear custom fields for manual entry
                                        setCustomPriceTokenSymbol('');
                                        setCustomPriceTokenDecimals('');
                                        setCustomPriceTokenName('');
                                        setCustomPriceTokenLogo('');
                                    }
                                }}
                                onSelectToken={(tokenData) => {
                                    // Capture metadata from TokenSelector (for custom entries)
                                    if (tokenData.symbol) {
                                        setCustomPriceTokenSymbol(tokenData.symbol);
                                    }
                                    if (tokenData.decimals !== undefined) {
                                        setCustomPriceTokenDecimals(tokenData.decimals.toString());
                                    }
                                    if (tokenData.name) {
                                        setCustomPriceTokenName(tokenData.name);
                                    }
                                    if (tokenData.logo) {
                                        setCustomPriceTokenLogo(tokenData.logo);
                                    }
                                }}
                                placeholder="Select payment token..."
                                disabled={loadingTokens}
                                allowCustom={true}
                            />
                            
                            {/* Show selected custom token info */}
                            {priceTokenLedger && !selectedPriceToken && customPriceTokenSymbol && (
                                <div style={{
                                    marginTop: '12px',
                                    padding: '12px',
                                    background: theme.colors.secondaryBg,
                                    borderRadius: '8px',
                                    border: `1px solid ${theme.colors.border}`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px'
                                }}>
                                    {customPriceTokenLogo ? (
                                        <img 
                                            src={customPriceTokenLogo} 
                                            alt={customPriceTokenSymbol}
                                            style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }}
                                        />
                                    ) : (
                                        <FaCoins style={{ fontSize: '24px', color: theme.colors.warning }} />
                                    )}
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: '600', color: theme.colors.primaryText }}>
                                            {customPriceTokenSymbol}
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>
                                            {customPriceTokenName || 'Custom Token'} (Decimals: {customPriceTokenDecimals || '8'})
                                        </div>
                                    </div>
                                    <div style={{ 
                                        fontSize: '0.75rem', 
                                        color: theme.colors.success, 
                                        background: `${theme.colors.success}15`,
                                        padding: '4px 8px',
                                        borderRadius: '4px'
                                    }}>
                                        Custom Token
                                    </div>
                                </div>
                            )}
                            
                            {/* Show USD price of selected token */}
                            {priceTokenLedger && priceTokenSymbol && (
                                <div style={{
                                    marginTop: '8px',
                                    fontSize: '0.85rem',
                                    color: theme.colors.secondaryText,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}>
                                    {paymentTokenPrice ? (
                                        <>
                                            <span>1 {priceTokenSymbol} ≈</span>
                                            <span style={{ 
                                                color: theme.colors.success, 
                                                fontWeight: '600' 
                                            }}>
                                                ${paymentTokenPrice.toFixed(paymentTokenPrice < 0.01 ? 6 : paymentTokenPrice < 1 ? 4 : 2)}
                                            </span>
                                        </>
                                    ) : (
                                        <span style={{ color: theme.colors.mutedText, fontStyle: 'italic' }}>
                                            USD price not available
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                        
                        <div style={styles.formGroup}>
                            <label style={styles.label}>
                                Minimum Bid Price
                                <span style={styles.labelHint}> — Optional, for auction-style offers</span>
                            </label>
                            <input
                                type="text"
                                inputMode="decimal"
                                placeholder={`e.g., 10 ${priceTokenSymbol}`}
                                style={styles.input}
                                value={minBidPrice}
                                onChange={(e) => setMinBidPrice(e.target.value)}
                            />
                            {minBidPrice && parseFloat(minBidPrice) <= 0 && (
                                <div style={{ fontSize: '0.8rem', color: theme.colors.error, marginTop: '4px' }}>
                                    Minimum bid must be greater than 0. Leave it blank for buyout-only offers.
                                </div>
                            )}
                            {minBidPrice && paymentTokenPrice && (
                                <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText, marginTop: '4px' }}>
                                    ≈ {formatUsd(parseFloat(minBidPrice) * paymentTokenPrice)}
                                </div>
                            )}
                        </div>
                        
                        <div style={styles.formGroup}>
                            <label style={styles.label}>
                                Buyout Price
                                <span style={styles.labelHint}> — Optional, for instant purchase</span>
                            </label>
                            <input
                                type="text"
                                inputMode="decimal"
                                placeholder={`e.g., 50 ${priceTokenSymbol}`}
                                style={styles.input}
                                value={buyoutPrice}
                                onChange={(e) => setBuyoutPrice(e.target.value)}
                            />
                            {buyoutPrice && paymentTokenPrice && (
                                <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText, marginTop: '4px' }}>
                                    ≈ {formatUsd(parseFloat(buyoutPrice) * paymentTokenPrice)}
                                </div>
                            )}
                        </div>
                        
                        <div style={styles.formGroup}>
                            <label style={styles.checkbox}>
                                <input
                                    type="checkbox"
                                    style={styles.checkboxInput}
                                    checked={hasExpiration}
                                    onChange={(e) => setHasExpiration(e.target.checked)}
                                />
                                Set an expiration date
                            </label>
                        </div>
                        
                        {hasExpiration && (
                            <div style={styles.formGroup}>
                                <label style={styles.label}>Expires in</label>
                                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            style={{ ...styles.input, width: '70px', textAlign: 'center' }}
                                            value={expirationDays}
                                            onChange={(e) => setExpirationDays(e.target.value)}
                                            placeholder="0"
                                        />
                                        <span style={{ color: theme.colors.mutedText }}>days</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            style={{ ...styles.input, width: '70px', textAlign: 'center' }}
                                            value={expirationHours}
                                            onChange={(e) => setExpirationHours(e.target.value)}
                                            placeholder="0"
                                        />
                                        <span style={{ color: theme.colors.mutedText }}>hours</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            style={{ ...styles.input, width: '70px', textAlign: 'center' }}
                                            value={expirationMinutes}
                                            onChange={(e) => setExpirationMinutes(e.target.value)}
                                            placeholder="0"
                                        />
                                        <span style={{ color: theme.colors.mutedText }}>min</span>
                                    </div>
                                </div>
                                <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText, marginTop: '8px' }}>
                                    Total: {formatExpirationTime()}
                                </div>
                            </div>
                        )}
                        
                        <div style={styles.formGroup}>
                            <label style={styles.label}>
                                Min Bid Increment
                                <span style={styles.labelHint}> — Minimum amount each bid must increase by</span>
                            </label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    style={{ ...styles.input, flex: 1 }}
                                    value={minBidIncrement}
                                    onChange={(e) => setMinBidIncrement(e.target.value)}
                                    onBlur={(e) => {
                                        // Reset to suggested value if empty or invalid
                                        if (!e.target.value || parseFloat(e.target.value) <= 0) {
                                            setMinBidIncrement(suggestedMinBidIncrement);
                                        }
                                    }}
                                    placeholder={suggestedMinBidIncrement}
                                />
                                <span style={{ color: theme.colors.primaryText, fontWeight: '500', minWidth: '60px' }}>
                                    {priceTokenSymbol}
                                </span>
                            </div>
                            {minBidIncrement && parseFloat(minBidIncrement) > 0 && paymentTokenPrice && (() => {
                                const usdValue = parseFloat(minBidIncrement) * paymentTokenPrice;
                                const rangeMin = minIncrementSettings.usd_range_min / 100; // cents to dollars
                                const rangeMax = minIncrementSettings.usd_range_max / 100; // cents to dollars
                                const isOutsideRange = usdValue < rangeMin || usdValue > rangeMax;
                                return (
                                    <>
                                        <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText, marginTop: '4px' }}>
                                            ≈ ${usdValue.toFixed(2)} USD
                                        </div>
                                        {isOutsideRange && (
                                            <div style={{ 
                                                fontSize: '0.8rem', 
                                                color: theme.colors.warning || '#f59e0b',
                                                marginTop: '4px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                            }}>
                                                ⚠️ {usdValue < rangeMin 
                                                    ? `Small increment (< $${rangeMin.toFixed(2)}) - may lead to many small bids` 
                                                    : `Large increment (> $${rangeMax.toFixed(2)}) - may discourage bidders`}
                                            </div>
                                        )}
                                    </>
                                );
                            })()}
                        </div>
                        
                        <div style={{ 
                            borderTop: `1px solid ${theme.colors.border}`, 
                            margin: '24px 0', 
                            paddingTop: '24px' 
                        }}>
                            <div style={styles.formGroup}>
                                <label style={styles.checkbox}>
                                    <input
                                        type="checkbox"
                                        style={styles.checkboxInput}
                                        checked={isPrivateOffer}
                                        onChange={(e) => setIsPrivateOffer(e.target.checked)}
                                    />
                                    Private Offer (OTC)
                                    <span style={{ 
                                        fontWeight: 'normal', 
                                        color: theme.colors.mutedText, 
                                        marginLeft: '8px' 
                                    }}>
                                        — Only approved bidders can place bids
                                    </span>
                                </label>
                            </div>
                            
                            {isPrivateOffer && (
                                <div style={styles.formGroup}>
                                    <label style={styles.label}>
                                        Approved Bidders
                                        <span style={styles.labelHint}> — Add principals who can bid</span>
                                    </label>
                                    
                                    {/* Add new bidder input */}
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '12px' }}>
                                        <PrincipalInput
                                            value={newBidderInput}
                                            onChange={setNewBidderInput}
                                            placeholder="Enter principal ID or search by name"
                                            style={{ flex: 1, maxWidth: 'none' }}
                                            isAuthenticated={isAuthenticated}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (!newBidderInput.trim()) return;
                                                try {
                                                    // Validate principal format
                                                    Principal.fromText(newBidderInput.trim());
                                                    // Check for duplicates
                                                    if (approvedBidders.includes(newBidderInput.trim())) {
                                                        setError('This principal is already in the list');
                                                        return;
                                                    }
                                                    setApprovedBidders([...approvedBidders, newBidderInput.trim()]);
                                                    setNewBidderInput('');
                                                    setError('');
                                                } catch (e) {
                                                    setError('Invalid principal ID format');
                                                }
                                            }}
                                            style={{
                                                padding: '8px 16px',
                                                background: theme.colors.accent,
                                                color: '#fff',
                                                border: 'none',
                                                borderRadius: '6px',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                fontWeight: '500',
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            <FaPlus /> Add
                                        </button>
                                    </div>
                                    
                                    {/* List of approved bidders */}
                                    {approvedBidders.length > 0 ? (
                                        <div style={{
                                            background: theme.colors.secondaryBg,
                                            borderRadius: '8px',
                                            padding: '12px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '8px',
                                        }}>
                                            <div style={{ 
                                                fontSize: '0.8rem', 
                                                color: theme.colors.mutedText,
                                                marginBottom: '4px',
                                            }}>
                                                {approvedBidders.length} approved bidder{approvedBidders.length !== 1 ? 's' : ''}:
                                            </div>
                                            {approvedBidders.map((bidderStr, idx) => (
                                                <div 
                                                    key={bidderStr} 
                                                    style={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        alignItems: 'center',
                                                        padding: '8px 12px',
                                                        background: theme.colors.tertiaryBg,
                                                        borderRadius: '6px',
                                                    }}
                                                >
                                                    <PrincipalDisplay
                                                        principal={bidderStr}
                                                        displayInfo={getPrincipalDisplayInfoFromContext(bidderStr, principalNames, principalNicknames)}
                                                        short={false}
                                                        showCopyButton={true}
                                                        isAuthenticated={isAuthenticated}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setApprovedBidders(approvedBidders.filter((_, i) => i !== idx));
                                                        }}
                                                        style={{
                                                            background: 'transparent',
                                                            border: 'none',
                                                            color: theme.colors.error,
                                                            cursor: 'pointer',
                                                            padding: '4px 8px',
                                                            borderRadius: '4px',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                        }}
                                                        title="Remove bidder"
                                                    >
                                                        <FaTrash />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p style={{ 
                                            fontSize: '0.85rem', 
                                            color: theme.colors.mutedText, 
                                            margin: 0,
                                            fontStyle: 'italic',
                                        }}>
                                            No approved bidders added yet. Add principals who will be allowed to bid on your offer.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                        
                        {/* Notes Section */}
                        <div style={{ marginBottom: '24px' }}>
                            <h4 style={{ 
                                margin: '0 0 16px 0', 
                                color: theme.colors.primaryText,
                                fontSize: '1rem',
                            }}>
                                📝 Offer Notes
                            </h4>
                            
                            <div style={styles.formGroup}>
                                <label style={styles.label}>
                                    Public Note
                                    <span style={styles.labelHint}> — Visible to everyone</span>
                                </label>
                                <textarea
                                    style={{
                                        ...styles.input,
                                        minHeight: '80px',
                                        resize: 'vertical',
                                    }}
                                    placeholder="Add a public note about this offer (optional)..."
                                    value={publicNote}
                                    onChange={(e) => setPublicNote(e.target.value.slice(0, 4000))}
                                    maxLength={4000}
                                />
                                <div style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginTop: '4px',
                                }}>
                                    <p style={{ 
                                        fontSize: '0.8rem', 
                                        color: theme.colors.mutedText, 
                                        margin: 0,
                                    }}>
                                        This note will be visible to all viewers of the offer.
                                    </p>
                                    <span style={{ 
                                        fontSize: '0.75rem', 
                                        color: publicNote.length > 3800 ? theme.colors.warning : theme.colors.mutedText,
                                    }}>
                                        {publicNote.length}/4000
                                    </span>
                                </div>
                            </div>
                            
                            <div style={styles.formGroup}>
                                <label style={styles.label}>
                                    Note to Buyer
                                    <span style={styles.labelHint}> — Only visible to winning bidder</span>
                                </label>
                                <textarea
                                    style={{
                                        ...styles.input,
                                        minHeight: '80px',
                                        resize: 'vertical',
                                    }}
                                    placeholder="Add a private note for the buyer (optional)..."
                                    value={noteToBuyer}
                                    onChange={(e) => setNoteToBuyer(e.target.value.slice(0, 4000))}
                                    maxLength={4000}
                                />
                                <div style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginTop: '4px',
                                }}>
                                    <p style={{ 
                                        fontSize: '0.8rem', 
                                        color: theme.colors.mutedText, 
                                        margin: 0,
                                    }}>
                                        Only you and the winning bidder will be able to see this note.
                                    </p>
                                    <span style={{ 
                                        fontSize: '0.75rem', 
                                        color: noteToBuyer.length > 3800 ? theme.colors.warning : theme.colors.mutedText,
                                    }}>
                                        {noteToBuyer.length}/4000
                                    </span>
                                </div>
                            </div>
                        </div>
                        
                        {/* Marketplace Fee Info */}
                        {marketplaceFeeRate !== null && marketplaceFeeRate > 0 && !premiumLoading && (
                            <div style={{
                                background: isPremiumUser && premiumAuctionCut > 0 && premiumAuctionCut < marketplaceFeeRate 
                                    ? `linear-gradient(135deg, ${theme.colors.warning}10 0%, rgba(255, 215, 0, 0.15) 100%)`
                                    : `${theme.colors.warning}10`,
                                border: `1px solid ${isPremiumUser && premiumAuctionCut > 0 && premiumAuctionCut < marketplaceFeeRate ? 'rgba(255, 215, 0, 0.4)' : `${theme.colors.warning}40`}`,
                                borderRadius: '10px',
                                padding: '16px',
                                marginBottom: '24px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                            }}>
                                <span style={{ fontSize: '1.5rem' }}>💰</span>
                                <div>
                                    <strong style={{ color: isPremiumUser && premiumAuctionCut > 0 && premiumAuctionCut < marketplaceFeeRate ? '#FFD700' : theme.colors.warning }}>
                                        Sneedex Marketplace Fee: {isPremiumUser && premiumAuctionCut > 0 && premiumAuctionCut < marketplaceFeeRate 
                                            ? formatFeeRate(premiumAuctionCut)
                                            : formatFeeRate(marketplaceFeeRate)}
                                        {isPremiumUser && premiumAuctionCut > 0 && premiumAuctionCut < marketplaceFeeRate && (
                                            <span style={{ marginLeft: '8px', fontSize: '0.8rem', background: 'linear-gradient(135deg, #FFD700, #FFA500)', color: '#1a1a2e', padding: '2px 8px', borderRadius: '10px' }}>
                                                👑 PREMIUM
                                            </span>
                                        )}
                                    </strong>
                                    <p style={{ 
                                        fontSize: '0.85rem', 
                                        color: theme.colors.mutedText, 
                                        margin: '4px 0 0 0' 
                                    }}>
                                        When your offer sells, Sneedex will take a {isPremiumUser && premiumAuctionCut > 0 && premiumAuctionCut < marketplaceFeeRate 
                                            ? formatFeeRate(premiumAuctionCut)
                                            : formatFeeRate(marketplaceFeeRate)} cut from the winning bid.
                                        The remaining amount goes to you. This rate is locked when the offer is created.
                                        {isPremiumUser && premiumAuctionCut > 0 && premiumAuctionCut < marketplaceFeeRate && (
                                            <span style={{ color: theme.colors.success, marginLeft: '4px' }}>
                                                (Regular: {formatFeeRate(marketplaceFeeRate)})
                                            </span>
                                        )}
                                        {!isPremiumUser && premiumAuctionCut > 0 && premiumAuctionCut < marketplaceFeeRate && (
                                            <span style={{ display: 'block', marginTop: '4px' }}>
                                                <Link to="/premium" style={{ color: '#FFD700' }}>
                                                    👑 Premium members pay only {formatFeeRate(premiumAuctionCut)} →
                                                </Link>
                                            </span>
                                        )}
                                    </p>
                                </div>
                            </div>
                        )}
                        
                        <div style={styles.buttonRow}>
                            <div />
                            <button style={styles.nextBtn} onClick={handleNext}>
                                Next: Add Assets →
                            </button>
                        </div>
                    </div>
                )}
                
                {/* Step 2: Add Assets */}
                {step === 2 && (
                    <div style={styles.card} className="sneedex-create-card">
                        <h3 style={styles.cardTitle}>Assets to Sell</h3>
                        
                        {assets.length === 0 ? (
                            <div style={styles.emptyAssets}>
                                No assets added yet. Add at least one asset to continue.
                            </div>
                        ) : (
                            <div style={styles.assetsList}>
                                {assets.map((asset, idx) => {
                                    const key = getAssetKey(asset);
                                    const verification = assetVerification[key] || {};
                                    
                                    return (
                                        <div key={idx} style={styles.assetItem}>
                                            <div style={styles.assetInfo}>
                                                {getAssetIcon(asset)}
                                                <div style={styles.assetDetails}>
                                                    <div style={styles.assetType}>
                                                        {asset.type === 'canister' && (
                                                            asset.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER && asset.totalIcpE8s
                                                                ? `${(Number(asset.totalIcpE8s) / 1e8).toFixed(2)} ICP`
                                                                : (asset.title || 'App')
                                                        )}
                                                        {asset.type === 'neuron' && (
                                                            asset.stake
                                                                ? `${(Number(asset.stake) / Math.pow(10, getSnsDecimals(asset.governance_id))).toFixed(2)} ${asset.symbol || 'tokens'}`
                                                                : 'SNS Neuron'
                                                        )}
                                                        {asset.type === 'token' && `${asset.amount} ${asset.symbol}`}
                                                    </div>
                                                    <div style={styles.assetId}>
                                                        {asset.type === 'canister' && (
                                                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                {asset.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER && (
                                                                    <span style={{ color: theme.colors.accent, fontSize: '0.75rem' }}>
                                                                        Staking Bot •
                                                                    </span>
                                                                )}
                                                                <PrincipalDisplay 
                                                                    principal={asset.canister_id}
                                                                    displayInfo={getPrincipalDisplayInfoFromContext(asset.canister_id, principalNames, principalNicknames)}
                                                                    short={true}
                                                                    showCopyButton={false}
                                                                    style={{ fontSize: 'inherit', color: 'inherit' }}
                                                                    isAuthenticated={isAuthenticated}
                                                                />
                                                            </span>
                                                        )}
                                                        {asset.type === 'neuron' && (
                                                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                                                                Neuron • {asset.neuron_id.slice(0, 10)}...
                                                            </span>
                                                        )}
                                                        {asset.type === 'token' && (
                                                            <PrincipalDisplay 
                                                                principal={asset.ledger_id}
                                                                displayInfo={getPrincipalDisplayInfoFromContext(asset.ledger_id, principalNames, principalNicknames)}
                                                                short={true}
                                                                showCopyButton={false}
                                                                style={{ fontSize: 'inherit', color: 'inherit' }}
                                                                isAuthenticated={isAuthenticated}
                                                            />
                                                        )}
                                                    </div>
                                                    {/* USD Value */}
                                                    {(() => {
                                                        const usdValue = getAssetUsdValue(asset);
                                                        if (usdValue !== null) {
                                                            return (
                                                                <div style={{ 
                                                                    fontSize: '0.75rem', 
                                                                    color: theme.colors.success,
                                                                    fontWeight: '600',
                                                                    marginTop: '2px',
                                                                }}>
                                                                    ≈ {formatUsd(usdValue)}
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    })()}
                                                </div>
                                            </div>
                                            
                                            {/* Verification status */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                                {verification.checking ? (
                                                    <span style={{ 
                                                        display: 'flex', 
                                                        alignItems: 'center', 
                                                        gap: '6px',
                                                        fontSize: '0.8rem',
                                                        color: theme.colors.mutedText 
                                                    }}>
                                                        <FaSync style={{ animation: 'spin 1s linear infinite' }} />
                                                        Checking...
                                                    </span>
                                                ) : verification.verified !== undefined ? (
                                                    <span 
                                                        style={{ 
                                                            display: 'flex', 
                                                            alignItems: 'center', 
                                                            gap: '6px',
                                                            fontSize: '0.8rem',
                                                            padding: '4px 8px',
                                                            borderRadius: '6px',
                                                            background: verification.verified 
                                                                ? `${theme.colors.success}15` 
                                                                : `${theme.colors.warning}15`,
                                                            color: verification.verified 
                                                                ? theme.colors.success 
                                                                : theme.colors.warning,
                                                        }}
                                                        title={verification.message}
                                                    >
                                                        {verification.verified ? (
                                                            <><FaCheck /> Ready</>
                                                        ) : (
                                                            <><FaExclamationTriangle /> Not ready</>
                                                        )}
                                                    </span>
                                                ) : null}
                                                
                                                <button
                                                    style={styles.editButton}
                                                    onClick={() => editAsset(idx)}
                                                    onMouseEnter={(e) => e.target.style.background = `${theme.colors.accent}20`}
                                                    onMouseLeave={(e) => e.target.style.background = 'transparent'}
                                                    title="Edit asset"
                                                >
                                                    <FaPencilAlt />
                                                </button>
                                                <button
                                                    style={styles.removeButton}
                                                    onClick={() => removeAsset(idx)}
                                                    onMouseEnter={(e) => e.target.style.background = `${theme.colors.error || '#ff4444'}20`}
                                                    onMouseLeave={(e) => e.target.style.background = 'transparent'}
                                                    title="Remove asset"
                                                >
                                                    <FaTrash />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                                
                                {/* Total Estimated Value */}
                                {(() => {
                                    const totalUsd = assets.reduce((sum, asset) => {
                                        const usdValue = getAssetUsdValue(asset);
                                        return sum + (usdValue || 0);
                                    }, 0);
                                    
                                    if (totalUsd > 0) {
                                        return (
                                            <div style={{
                                                marginTop: '12px',
                                                padding: '12px 16px',
                                                background: `linear-gradient(135deg, ${theme.colors.success}15, ${theme.colors.accent}10)`,
                                                borderRadius: '10px',
                                                border: `1px solid ${theme.colors.success}30`,
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                            }}>
                                                <span style={{ 
                                                    fontSize: '0.9rem', 
                                                    fontWeight: '500',
                                                    color: theme.colors.primaryText,
                                                }}>
                                                    📊 Total Estimated Value:
                                                </span>
                                                <span style={{ 
                                                    fontSize: '1.1rem', 
                                                    fontWeight: '700',
                                                    color: theme.colors.success,
                                                }}>
                                                    {formatUsd(totalUsd)}
                                                </span>
                                            </div>
                                        );
                                    }
                                    return null;
                                })()}
                            </div>
                        )}
                        
                        {!showAddAsset ? (
                            <button
                                style={styles.addAssetButton}
                                onClick={() => setShowAddAsset(true)}
                                onMouseEnter={(e) => {
                                    e.target.style.background = `${theme.colors.accent}25`;
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.background = `${theme.colors.accent}15`;
                                }}
                            >
                                <FaPlus /> Add Asset
                            </button>
                        ) : (
                            <div style={styles.addAssetModal}>
                                <div style={{ 
                                    fontWeight: '600', 
                                    fontSize: '1rem', 
                                    marginBottom: '1rem',
                                    color: theme.colors.primaryText,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                }}>
                                    {editingAssetIndex !== null ? (
                                        <><FaPencilAlt /> Edit Asset</>
                                    ) : (
                                        <><FaPlus /> Add New Asset</>
                                    )}
                                </div>
                                {/* Asset Type Tabs */}
                                <div 
                                    className="sneedex-create-asset-types"
                                    style={{
                                        display: 'flex',
                                        flexWrap: 'wrap',
                                        gap: '10px',
                                        marginBottom: '1.5rem',
                                        padding: '8px',
                                        background: theme.colors.secondaryBg,
                                        borderRadius: '16px',
                                        border: `1px solid ${theme.colors.border}`,
                                    }}>
                                    {[
                                        { type: 'canister', icon: FaServer, label: 'App', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
                                        { type: 'neuron_manager', icon: FaRobot, label: 'ICP Staking Bot', gradient: 'linear-gradient(135deg, #f5af19 0%, #f12711 100%)' },
                                        { type: 'neuron', icon: FaBrain, label: 'SNS Neuron', gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
                                        { type: 'token', icon: FaCoins, label: 'ICRC1 Token', gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
                                    ].map(({ type, icon: Icon, label, gradient }) => {
                                        const isSelected = newAssetType === type;
                                        const isDisabled = editingAssetIndex !== null; // Can't change type when editing
                                        return (
                                            <button
                                                key={type}
                                                onClick={() => {
                                                    if (isDisabled) return;
                                                    setNewAssetType(type);
                                                    // Reset canister-related state when switching types
                                                    if (type === 'neuron_manager') {
                                                        setNewAssetCanisterKind(CANISTER_KIND_ICP_NEURON_MANAGER);
                                                    } else if (type === 'canister') {
                                                        setNewAssetCanisterKind(CANISTER_KIND_UNKNOWN);
                                                    }
                                                    // Clear previous canister selection when switching types
                                                    setNewAssetCanisterId('');
                                                    setCanisterKindVerified(null);
                                                    setCanisterControllerStatus(null);
                                                }}
                                                disabled={isDisabled}
                                                style={{
                                                    flex: '1 1 calc(50% - 10px)',
                                                    minWidth: '120px',
                                                    maxWidth: 'calc(50% - 5px)',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    padding: '12px 8px',
                                                    border: 'none',
                                                    borderRadius: '12px',
                                                    background: isSelected ? gradient : 'transparent',
                                                    color: isSelected ? '#fff' : theme.colors.mutedText,
                                                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                                                    opacity: isDisabled ? 0.5 : 1,
                                                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                                    transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                                                    boxShadow: isSelected 
                                                        ? '0 8px 24px rgba(0, 0, 0, 0.2)' 
                                                        : 'none',
                                                }}
                                                onMouseEnter={(e) => {
                                                    if (!isSelected && !isDisabled) {
                                                        e.currentTarget.style.background = `${theme.colors.border}50`;
                                                        e.currentTarget.style.color = theme.colors.primaryText;
                                                    }
                                                }}
                                                onMouseLeave={(e) => {
                                                    if (!isSelected && !isDisabled) {
                                                        e.currentTarget.style.background = 'transparent';
                                                        e.currentTarget.style.color = theme.colors.mutedText;
                                                    }
                                                }}
                                            >
                                                <div style={{
                                                    width: '40px',
                                                    height: '40px',
                                                    borderRadius: '10px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    background: isSelected 
                                                        ? 'rgba(255, 255, 255, 0.2)' 
                                                        : `${theme.colors.border}40`,
                                                    backdropFilter: isSelected ? 'blur(8px)' : 'none',
                                                    transition: 'all 0.3s ease',
                                                }}>
                                                    <Icon size={20} />
                                                </div>
                                                <span style={{
                                                    fontSize: '0.75rem',
                                                    fontWeight: isSelected ? '600' : '500',
                                                    letterSpacing: '0.02em',
                                                    textAlign: 'center',
                                                    lineHeight: '1.2',
                                                }}>
                                                    {label}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                                
                                {(newAssetType === 'canister' || newAssetType === 'neuron_manager') && (
                                    <div style={styles.formGroup}>
                                        <label style={styles.label}>
                                            {newAssetType === 'neuron_manager' ? 'Select ICP Staking Bot' : 'Select App'}
                                        </label>
                                        
                                        {loadingCanisters ? (
                                            <div style={{ 
                                                padding: '12px', 
                                                color: theme.colors.mutedText,
                                                background: theme.colors.secondaryBg,
                                                borderRadius: '8px',
                                                fontSize: '0.9rem'
                                            }}>
                                                {newAssetType === 'neuron_manager' ? 'Loading your ICP Staking Bots...' : 'Loading your apps...'}
                                            </div>
                                        ) : newAssetType === 'neuron_manager' ? (
                                            // Neuron Manager selection - only show neuron managers
                                            neuronManagers.length > 0 ? (
                                            <>
                                                <select
                                                    style={{
                                                        ...styles.input,
                                                        cursor: 'pointer',
                                                    }}
                                                    value={newAssetCanisterId}
                                                    onChange={(e) => {
                                                        const selectedId = e.target.value;
                                                        setNewAssetCanisterId(selectedId);
                                                            // Auto-set canister kind and verify
                                                            setNewAssetCanisterKind(CANISTER_KIND_ICP_NEURON_MANAGER);
                                                            if (selectedId) {
                                                                verifyICPNeuronManager(selectedId);
                                                            }
                                                        }}
                                                    >
                                                        <option value="">Select an ICP Staking Bot...</option>
                                                        {neuronManagers.map(canisterId => (
                                                            <option key={canisterId} value={canisterId}>
                                                                {getCanisterName(canisterId)}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    
                                                    <div style={{ 
                                                        marginTop: '8px', 
                                                        fontSize: '0.8rem', 
                                                        color: theme.colors.mutedText 
                                                    }}>
                                                        Or enter an ICP Staking Bot app canister id manually:
                                                    </div>
                                                    <input
                                                        type="text"
                                                        placeholder="e.g., abc12-defgh-xxxxx-xxxxx-cai"
                                                        style={{ ...styles.input, marginTop: '4px' }}
                                                        value={newAssetCanisterId}
                                                        onChange={(e) => {
                                                            setNewAssetCanisterId(e.target.value);
                                                            setNewAssetCanisterKind(CANISTER_KIND_ICP_NEURON_MANAGER);
                                                            setCanisterKindVerified(null);
                                                        }}
                                                    />
                                                </>
                                            ) : (
                                                <>
                                                    <div style={{ 
                                                        padding: '12px', 
                                                        background: `${theme.colors.accent}10`,
                                                        borderRadius: '8px',
                                                        marginBottom: '8px',
                                                        fontSize: '0.85rem',
                                                        color: theme.colors.secondaryText,
                                                    }}>
                                                        <strong style={{ color: theme.colors.accent }}>💡 Tip:</strong> You don't have any ICP Staking Bots registered yet.
                                                        Create one on the{' '}
                                                        <Link to="/canisters" style={{ color: theme.colors.accent }}>Apps page</Link>{' '}
                                                        or enter an existing one manually below.
                                                    </div>
                                                    <input
                                                        type="text"
                                                        placeholder="e.g., abc12-defgh-xxxxx-xxxxx-cai"
                                                        style={styles.input}
                                                        value={newAssetCanisterId}
                                                        onChange={(e) => {
                                                            setNewAssetCanisterId(e.target.value);
                                                            setNewAssetCanisterKind(CANISTER_KIND_ICP_NEURON_MANAGER);
                                                            setCanisterKindVerified(null);
                                                        }}
                                                    />
                                                </>
                                            )
                                        ) : (
                                            // Regular Canister selection - exclude neuron managers
                                            (userCanisters.length > 0 || walletCanisters.filter(id => !neuronManagers.includes(id)).length > 0) ? (
                                            <>
                                                <select
                                                    style={{
                                                        ...styles.input,
                                                        cursor: 'pointer',
                                                    }}
                                                    value={newAssetCanisterId}
                                                    onChange={(e) => {
                                                        const selectedId = e.target.value;
                                                        setNewAssetCanisterId(selectedId);
                                                            setNewAssetCanisterKind(CANISTER_KIND_UNKNOWN);
                                                            setCanisterKindVerified(null);
                                                    }}
                                                >
                                                    <option value="">Select an app...</option>
                                                    
                                                    {userCanisters.filter(id => !neuronManagers.includes(id)).length > 0 && (
                                                        <optgroup label="📦 Registered Apps">
                                                            {userCanisters
                                                                .filter(id => !neuronManagers.includes(id))
                                                                .map(canisterId => (
                                                                <option key={canisterId} value={canisterId}>
                                                                    {getCanisterName(canisterId)}
                                                                </option>
                                                            ))}
                                                        </optgroup>
                                                    )}
                                                    
                                                    {walletCanisters.filter(id => !neuronManagers.includes(id)).length > 0 && (
                                                        <optgroup label="💼 Wallet Apps">
                                                            {walletCanisters
                                                                .filter(id => !neuronManagers.includes(id))
                                                                .map(canisterId => (
                                                                <option key={canisterId} value={canisterId}>
                                                                    {getCanisterName(canisterId)}
                                                                </option>
                                                            ))}
                                                        </optgroup>
                                                    )}
                                                </select>
                                                
                                                <div style={{ 
                                                    marginTop: '8px', 
                                                    fontSize: '0.8rem', 
                                                    color: theme.colors.mutedText 
                                                }}>
                                                    Or enter an app canister id manually:
                                                </div>
                                                <input
                                                    type="text"
                                                    placeholder="e.g., abc12-defgh-xxxxx-xxxxx-cai"
                                                    style={{ ...styles.input, marginTop: '4px' }}
                                                    value={newAssetCanisterId}
                                                    onChange={(e) => setNewAssetCanisterId(e.target.value)}
                                                />
                                            </>
                                        ) : (
                                            <>
                                                <div style={{ 
                                                    padding: '12px', 
                                                    background: `${theme.colors.accent}10`,
                                                    borderRadius: '8px',
                                                    marginBottom: '8px',
                                                    fontSize: '0.85rem',
                                                    color: theme.colors.secondaryText,
                                                }}>
                                                    <strong style={{ color: theme.colors.accent }}>💡 Tip:</strong> Register apps on the{' '}
                                                    <Link to="/canisters" style={{ color: theme.colors.accent }}>Apps page</Link>{' '}
                                                    to see them here, or enter an ID manually below.
                                                </div>
                                                <input
                                                    type="text"
                                                    placeholder="e.g., abc12-defgh-xxxxx-xxxxx-cai"
                                                    style={styles.input}
                                                    value={newAssetCanisterId}
                                                    onChange={(e) => setNewAssetCanisterId(e.target.value)}
                                                />
                                            </>
                                        )
                                        )}
                                        
                                        {/* Controller Status Display */}
                                        {newAssetCanisterId && (
                                            <div style={{ 
                                                marginTop: '10px', 
                                                padding: '10px 12px',
                                                borderRadius: '8px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                fontSize: '0.85rem',
                                                background: canisterControllerStatus?.checking 
                                                    ? `${theme.colors.accent}10`
                                                    : canisterControllerStatus?.verified 
                                                        ? `${theme.colors.success}15`
                                                        : canisterControllerStatus 
                                                            ? `${theme.colors.warning}15`
                                                            : `${theme.colors.accent}10`,
                                                border: `1px solid ${
                                                    canisterControllerStatus?.checking 
                                                        ? theme.colors.border
                                                        : canisterControllerStatus?.verified 
                                                            ? theme.colors.success
                                                            : canisterControllerStatus 
                                                                ? theme.colors.warning
                                                                : theme.colors.border
                                                }`,
                                            }}>
                                                {canisterControllerStatus?.checking ? (
                                                    <>
                                                        <FaSync style={{ animation: 'spin 1s linear infinite', color: theme.colors.accent }} />
                                                        <span style={{ color: theme.colors.secondaryText }}>Checking controller status...</span>
                                                    </>
                                                ) : canisterControllerStatus?.verified ? (
                                                    <>
                                                        <FaCheck style={{ color: theme.colors.success }} />
                                                        <span style={{ color: theme.colors.success }}>You are a controller - can escrow automatically</span>
                                                    </>
                                                ) : canisterControllerStatus ? (
                                                    <>
                                                        <FaExclamationTriangle style={{ color: theme.colors.warning }} />
                                                        <span style={{ color: theme.colors.warning }}>
                                                            You are not a controller of this app canister. Only app canisters you control can be added to offers.
                                                        </span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <FaSync style={{ animation: 'spin 1s linear infinite', color: theme.colors.mutedText }} />
                                                        <span style={{ color: theme.colors.mutedText }}>Verifying...</span>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                        
                                        {/* Neuron Manager Verification for neuron_manager asset type */}
                                        {newAssetType === 'neuron_manager' && newAssetCanisterId && (
                                                <div style={{ marginTop: '8px' }}>
                                                    {canisterKindVerified?.verified ? (
                                                        <div style={{ 
                                                            background: theme.colors.secondaryBg,
                                                            borderRadius: '8px',
                                                            padding: '12px',
                                                        }}>
                                                            <div style={{ 
                                                                display: 'flex', 
                                                                alignItems: 'center', 
                                                                gap: '8px',
                                                                color: '#10B981',
                                                                fontSize: '0.9rem',
                                                                marginBottom: '8px',
                                                            }}>
                                                                <FaCheck /> Verified as ICP Staking Bot
                                                            </div>
                                                            <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText }}>
                                                                <div>Version: <strong>{canisterKindVerified.versionStr}</strong></div>
                                                                {canisterKindVerified.moduleHash && (
                                                                    <div style={{ marginTop: '4px' }}>
                                                                        {canisterKindVerified.wasmVerified ? (
                                                                            <span style={{ color: '#10B981' }}>
                                                                                <FaCheck style={{ marginRight: '4px' }} />
                                                                                Official WASM (v{Number(canisterKindVerified.officialVersion.major)}.{Number(canisterKindVerified.officialVersion.minor)}.{Number(canisterKindVerified.officialVersion.patch)})
                                                                            </span>
                                                                        ) : (
                                                                            <span style={{ color: '#F59E0B' }}>
                                                                                <FaExclamationTriangle style={{ marginRight: '4px' }} />
                                                                                Unknown WASM hash (not in official registry)
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                )}
                                                                {!canisterKindVerified.moduleHash && (
                                                                    <div style={{ marginTop: '4px', color: theme.colors.mutedText, fontSize: '0.8rem' }}>
                                                                        (Could not verify WASM - not a controller)
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ) : typeof canisterKindVerified === 'string' ? (
                                                        <div style={{ 
                                                            display: 'flex', 
                                                            alignItems: 'center', 
                                                            gap: '8px',
                                                            color: '#EF4444',
                                                            fontSize: '0.9rem'
                                                        }}>
                                                            <FaExclamationTriangle /> {canisterKindVerified}
                                                        </div>
                                                ) : verifyingCanisterKind ? (
                                                    <div style={{ 
                                                        display: 'flex', 
                                                        alignItems: 'center', 
                                                        gap: '8px',
                                                        color: theme.colors.secondaryText,
                                                        fontSize: '0.9rem'
                                                    }}>
                                                        <FaSync style={{ animation: 'spin 1s linear infinite' }} /> Verifying...
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => verifyICPNeuronManager(newAssetCanisterId)}
                                                        disabled={!newAssetCanisterId || verifyingCanisterKind}
                                                        style={{
                                                            ...styles.secondaryButton,
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '8px',
                                                            opacity: (!newAssetCanisterId || verifyingCanisterKind) ? 0.5 : 1,
                                                        }}
                                                    >
                                                                <FaRobot /> Verify as Staking Bot
                                                    </button>
                                            )}
                                        </div>
                                        )}
                                        
                                        {/* Title and Description */}
                                        {/* Title - only for generic canisters, not neuron managers */}
                                        {newAssetType !== 'neuron_manager' && (
                                        <div style={styles.formGroup}>
                                            <label style={styles.label}>
                                                Title (optional)
                                                <span style={{ 
                                                    color: theme.colors.mutedText, 
                                                    fontWeight: 'normal',
                                                    fontSize: '0.8rem',
                                                    marginLeft: '8px'
                                                }}>
                                                    {newAssetCanisterTitle.length}/{MAX_CANISTER_TITLE_LENGTH}
                                                </span>
                                            </label>
                                            <input
                                                type="text"
                                                placeholder="Give your app a name"
                                                maxLength={MAX_CANISTER_TITLE_LENGTH}
                                                value={newAssetCanisterTitle}
                                                onChange={(e) => setNewAssetCanisterTitle(e.target.value)}
                                                style={styles.input}
                                            />
                                        </div>
                                        )}
                                        
                                        <div style={styles.formGroup}>
                                            <label style={styles.label}>
                                                Description (optional)
                                                <span style={{ 
                                                    color: theme.colors.mutedText, 
                                                    fontWeight: 'normal',
                                                    fontSize: '0.8rem',
                                                    marginLeft: '8px'
                                                }}>
                                                    {newAssetCanisterDescription.length}/{MAX_CANISTER_DESCRIPTION_LENGTH}
                                                </span>
                                            </label>
                                            <textarea
                                                placeholder={newAssetType === 'neuron_manager' 
                                                    ? "Describe your ICP Staking Bot, specific notes, and why it's valuable..."
                                                    : "Describe what this app does, its features, why it's valuable..."
                                                }
                                                maxLength={MAX_CANISTER_DESCRIPTION_LENGTH}
                                                value={newAssetCanisterDescription}
                                                onChange={(e) => setNewAssetCanisterDescription(e.target.value)}
                                                rows={4}
                                                style={{
                                                    ...styles.input,
                                                    resize: 'vertical',
                                                    minHeight: '80px',
                                                    fontFamily: 'inherit',
                                                }}
                                            />
                                        </div>
                                        
                                        {/* Neuron Manager Info Display - shows neurons inside the manager */}
                                        {canisterKindVerified?.verified && (
                                            <div style={{
                                                marginTop: '16px',
                                                padding: '16px',
                                                background: `${theme.colors.success}08`,
                                                border: `1px solid ${theme.colors.success}30`,
                                                borderRadius: '12px',
                                            }}>
                                                {loadingNeuronManagerInfo ? (
                                                    <div style={{ 
                                                        display: 'flex', 
                                                        alignItems: 'center', 
                                                        gap: '8px',
                                                        color: theme.colors.mutedText,
                                                    }}>
                                                        <FaSync style={{ animation: 'spin 1s linear infinite' }} />
                                                        Loading neuron info...
                                                    </div>
                                                ) : neuronManagerInfo ? (
                                                    <>
                                                        <div style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '8px',
                                                            marginBottom: '12px',
                                                            fontWeight: '600',
                                                            color: theme.colors.primaryText,
                                                        }}>
                                                            <FaBrain style={{ color: theme.colors.accent }} />
                                                            {neuronManagerInfo.neurons.length} ICP Neuron{neuronManagerInfo.neurons.length !== 1 ? 's' : ''}
                                                        </div>
                                                        
                                                        {neuronManagerInfo.neurons.length > 0 && (
                                                            <div style={{
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                gap: '8px',
                                                                fontSize: '0.85rem',
                                                            }}>
                                                                {neuronManagerInfo.neurons.map((neuron, idx) => (
                                                                    <div key={idx} style={{
                                                                        display: 'flex',
                                                                        justifyContent: 'space-between',
                                                                        alignItems: 'center',
                                                                        padding: '8px 12px',
                                                                        background: theme.colors.secondaryBg,
                                                                        borderRadius: '8px',
                                                                    }}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                            <span style={{ 
                                                                                color: theme.colors.mutedText,
                                                                                fontSize: '0.75rem',
                                                                            }}>
                                                                                #{neuron.neuronId}
                                                                            </span>
                                                                            <span style={{
                                                                                padding: '2px 6px',
                                                                                borderRadius: '4px',
                                                                                fontSize: '0.7rem',
                                                                                background: neuron.dissolveState === 'Locked' 
                                                                                    ? `${theme.colors.success}20`
                                                                                    : neuron.dissolveState === 'Dissolving'
                                                                                        ? `${theme.colors.warning}20`
                                                                                        : `${theme.colors.mutedText}20`,
                                                                                color: neuron.dissolveState === 'Locked' 
                                                                                    ? theme.colors.success
                                                                                    : neuron.dissolveState === 'Dissolving'
                                                                                        ? theme.colors.warning
                                                                                        : theme.colors.mutedText,
                                                                            }}>
                                                                                {neuron.dissolveState}
                                                                            </span>
                                                                        </div>
                                                                        <div style={{ textAlign: 'right' }}>
                                                                            <div style={{ fontWeight: '600', color: theme.colors.primaryText }}>
                                                                                {(Number(neuron.totalE8s) / 1e8).toFixed(4)} ICP
                                                                            </div>
                                                                            {icpPrice && (
                                                                                <div style={{ fontSize: '0.75rem', color: theme.colors.success }}>
                                                                                    {formatUsd((Number(neuron.totalE8s) / 1e8) * icpPrice)}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                                
                                                                {/* Totals */}
                                                                <div style={{
                                                                    marginTop: '8px',
                                                                    paddingTop: '12px',
                                                                    borderTop: `1px solid ${theme.colors.border}`,
                                                                    display: 'flex',
                                                                    justifyContent: 'space-between',
                                                                    alignItems: 'center',
                                                                }}>
                                                                    <span style={{ fontWeight: '600', color: theme.colors.primaryText }}>
                                                                        Total:
                                                                    </span>
                                                                    <div style={{ textAlign: 'right' }}>
                                                                        <div style={{ 
                                                                            fontWeight: '700', 
                                                                            color: theme.colors.accent,
                                                                            fontSize: '1.1rem',
                                                                        }}>
                                                                            {(Number(neuronManagerInfo.totalIcpE8s) / 1e8).toFixed(4)} ICP
                                                                        </div>
                                                                        {icpPrice && (
                                                                            <div style={{ 
                                                                                fontSize: '0.85rem', 
                                                                                color: theme.colors.success,
                                                                                fontWeight: '600',
                                                                            }}>
                                                                                {formatUsd((Number(neuronManagerInfo.totalIcpE8s) / 1e8) * icpPrice)}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </>
                                                ) : (
                                                    <div style={{ color: theme.colors.mutedText }}>
                                                        Could not load neuron information
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                                
                                {newAssetType === 'neuron' && (
                                    <>
                                        <div style={styles.formGroup}>
                                            <label style={styles.label}>Select SNS</label>
                                            {loadingSnses ? (
                                                <div style={{ 
                                                    padding: '12px', 
                                                    color: theme.colors.mutedText,
                                                    background: theme.colors.secondaryBg,
                                                    borderRadius: '8px'
                                                }}>
                                                    Loading SNSes...
                                                </div>
                                            ) : (
                                                <select
                                                    style={{
                                                        ...styles.input,
                                                        cursor: 'pointer',
                                                    }}
                                                    value={selectedSnsRoot}
                                                    onChange={(e) => {
                                                        setSelectedSnsRoot(e.target.value);
                                                        setNewAssetNeuronId('');
                                                        setNeuronVerificationStatus(null);
                                                        fetchNeuronsForSelectedSns(e.target.value);
                                                    }}
                                                >
                                                    <option value="">Select an SNS...</option>
                                                    {snsList.map(sns => (
                                                        <option key={sns.rootCanisterId} value={sns.rootCanisterId}>
                                                            {sns.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            )}
                                        </div>
                                        
                                        {selectedSnsRoot && (
                                            <div style={styles.formGroup}>
                                                <label style={styles.label}>Select Your Neuron</label>
                                                {loadingSnsNeurons ? (
                                                    <div style={{ 
                                                        padding: '12px', 
                                                        color: theme.colors.mutedText,
                                                        background: theme.colors.secondaryBg,
                                                        borderRadius: '8px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px'
                                                    }}>
                                                        <FaSync style={{ animation: 'spin 1s linear infinite' }} />
                                                        Loading your neurons...
                                                    </div>
                                                ) : snsNeurons.length > 0 ? (
                                                    <>
                                                        <select
                                                            style={{
                                                                ...styles.input,
                                                                cursor: 'pointer',
                                                            }}
                                                            value={newAssetNeuronId}
                                                            onChange={(e) => setNewAssetNeuronId(e.target.value)}
                                                        >
                                                            <option value="">Select a neuron...</option>
                                                            {snsNeurons
                                                                .filter(neuron => extractNeuronId(neuron))
                                                                .map(neuron => {
                                                                    const hexId = extractNeuronId(neuron);
                                                                    return (
                                                                        <option key={hexId} value={hexId}>
                                                                            {getNeuronDisplayName(neuron, selectedSnsRoot)}
                                                                        </option>
                                                                    );
                                                                })}
                                                        </select>
                                                        
                                                        <div style={{ 
                                                            marginTop: '8px', 
                                                            fontSize: '0.8rem', 
                                                            color: theme.colors.mutedText 
                                                        }}>
                                                            Or enter a neuron ID manually:
                                                        </div>
                                                        <input
                                                            type="text"
                                                            placeholder="Neuron ID in hex format"
                                                            style={{ ...styles.input, marginTop: '4px' }}
                                                            value={newAssetNeuronId}
                                                            onChange={(e) => setNewAssetNeuronId(e.target.value)}
                                                        />
                                                    </>
                                                ) : (
                                                    <>
                                                        <div style={{ 
                                                            padding: '12px', 
                                                            background: `${theme.colors.warning}15`,
                                                            borderRadius: '8px',
                                                            marginBottom: '8px',
                                                            fontSize: '0.85rem',
                                                            color: theme.colors.warning,
                                                        }}>
                                                            <FaExclamationTriangle style={{ marginRight: '8px' }} />
                                                            No hotkeyed neurons found for this SNS. You can still enter a neuron ID manually.
                                                        </div>
                                                        <input
                                                            type="text"
                                                            placeholder="Neuron ID in hex format"
                                                            style={styles.input}
                                                            value={newAssetNeuronId}
                                                            onChange={(e) => setNewAssetNeuronId(e.target.value)}
                                                        />
                                                    </>
                                                )}
                                                
                                                {/* Hidden input to store governance ID */}
                                                <input type="hidden" value={newAssetGovernanceId} />
                                                
                                                {/* Neuron verification status */}
                                                {newAssetNeuronId && (
                                                    <div style={{
                                                        marginTop: '12px',
                                                        padding: '12px',
                                                        background: neuronVerificationStatus?.checking 
                                                            ? `${theme.colors.accent}10`
                                                            : neuronVerificationStatus?.verified 
                                                                ? `${theme.colors.success}10` 
                                                                : neuronVerificationStatus?.verified === false
                                                                    ? `${theme.colors.warning}10`
                                                                    : theme.colors.secondaryBg,
                                                        borderRadius: '8px',
                                                        fontSize: '0.85rem',
                                                        border: `1px solid ${
                                                            neuronVerificationStatus?.checking 
                                                                ? theme.colors.accent
                                                                : neuronVerificationStatus?.verified 
                                                                    ? theme.colors.success 
                                                                    : neuronVerificationStatus?.verified === false
                                                                        ? theme.colors.warning
                                                                        : theme.colors.border
                                                        }30`,
                                                    }}>
                                                        {neuronVerificationStatus?.checking ? (
                                                            <div style={{ 
                                                                display: 'flex', 
                                                                alignItems: 'center', 
                                                                gap: '8px',
                                                                color: theme.colors.accent,
                                                            }}>
                                                                <FaSync style={{ animation: 'spin 1s linear infinite' }} />
                                                                <span>Verifying permissions...</span>
                                                            </div>
                                                        ) : neuronVerificationStatus?.verified ? (
                                                            <div style={{ 
                                                                display: 'flex', 
                                                                alignItems: 'center', 
                                                                gap: '8px',
                                                                color: theme.colors.success,
                                                            }}>
                                                                <FaCheck />
                                                                <span>{neuronVerificationStatus.message}</span>
                                                            </div>
                                                        ) : neuronVerificationStatus?.verified === false ? (
                                                            <div style={{ 
                                                                display: 'flex', 
                                                                flexDirection: 'column',
                                                                gap: '10px',
                                                            }}>
                                                                <div style={{ 
                                                                    display: 'flex', 
                                                                    alignItems: 'center', 
                                                                    gap: '8px',
                                                                    color: theme.colors.warning,
                                                                }}>
                                                                    <FaExclamationTriangle />
                                                                    <span>{neuronVerificationStatus.message}</span>
                                                                </div>
                                                                <Link 
                                                                    to="/tools/sns_jailbreak"
                                                                    style={{
                                                                        display: 'inline-flex',
                                                                        alignItems: 'center',
                                                                        gap: '6px',
                                                                        color: theme.colors.success,
                                                                        fontSize: '0.85rem',
                                                                        textDecoration: 'none',
                                                                    }}
                                                                >
                                                                    <FaUnlock size={12} />
                                                                    <span>Use the <strong>Jailbreak Wizard</strong> to add Sneedex as a hotkey</span>
                                                                </Link>
                                                            </div>
                                                        ) : (
                                                            <div style={{ 
                                                                display: 'flex', 
                                                                alignItems: 'center', 
                                                                gap: '8px',
                                                                color: theme.colors.mutedText,
                                                            }}>
                                                                <FaSync />
                                                                <span>Waiting to verify...</span>
                                                            </div>
                                                        )}
                                                        
                                                        {/* USD estimate */}
                                                        {(() => {
                                                            const selectedNeuron = snsNeurons.find(n => extractNeuronId(n) === newAssetNeuronId);
                                                            const stakeE8s = selectedNeuron?.cached_neuron_stake_e8s;
                                                            const snsLedger = getSnsLedgerFromGovernance(newAssetGovernanceId);
                                                            const price = snsLedger ? assetPrices[snsLedger] : null;
                                                            
                                                            if (stakeE8s && price) {
                                                                const decimals = getSnsDecimals(newAssetGovernanceId);
                                                                const stake = Number(stakeE8s) / Math.pow(10, decimals);
                                                                const usdValue = stake * price;
                                                                const sns = snsList.find(s => s.rootCanisterId === selectedSnsRoot);
                                                                const symbol = sns?.tokenSymbol || 'tokens';
                                                                
                                                                return (
                                                                    <>
                                                                        <div style={{ 
                                                                            borderTop: `1px solid ${theme.colors.border}`,
                                                                            marginTop: '10px',
                                                                            paddingTop: '10px',
                                                                        }}>
                                                                            <div style={{ 
                                                                                display: 'flex', 
                                                                                justifyContent: 'space-between',
                                                                                alignItems: 'center',
                                                                            }}>
                                                                                <span style={{ color: theme.colors.mutedText }}>Staked:</span>
                                                                                <span style={{ fontWeight: '600', color: theme.colors.primaryText }}>
                                                                                    {stake.toFixed(decimals > 4 ? 4 : decimals)} {symbol}
                                                                                </span>
                                                                            </div>
                                                                            <div style={{ 
                                                                                display: 'flex', 
                                                                                justifyContent: 'space-between',
                                                                                alignItems: 'center',
                                                                                marginTop: '4px',
                                                                            }}>
                                                                                <span style={{ color: theme.colors.mutedText }}>Est. Value:</span>
                                                                                <span style={{ fontWeight: '600', color: theme.colors.success }}>
                                                                                    {formatUsd(usdValue)}
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    </>
                                                                );
                                                            }
                                                            return null;
                                                        })()}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}
                                
                                {newAssetType === 'token' && (
                                    <>
                                        <div style={styles.formGroup}>
                                            <label style={styles.label}>Select Token</label>
                                            <TokenSelector
                                                value={newAssetTokenLedger}
                                                onChange={(ledgerId) => {
                                                    setNewAssetTokenLedger(ledgerId);
                                                    // Auto-populate symbol and decimals from whitelisted tokens
                                                    const token = whitelistedTokens.find(t => t.ledger_id.toString() === ledgerId);
                                                    if (token) {
                                                        setNewAssetTokenSymbol(token.symbol);
                                                        setNewAssetTokenDecimals(token.decimals.toString());
                                                    }
                                                    // Fetch balance for selected token
                                                    fetchAssetTokenBalance(ledgerId);
                                                }}
                                                onSelectToken={(tokenData) => {
                                                    // Capture logo from TokenSelector which fetches it from metadata
                                                    if (tokenData.logo) {
                                                        setNewAssetTokenLogo(tokenData.logo);
                                                    }
                                                    // Also capture symbol and decimals from custom entry
                                                    if (tokenData.symbol) {
                                                        setNewAssetTokenSymbol(tokenData.symbol);
                                                    }
                                                    if (tokenData.decimals !== undefined) {
                                                        setNewAssetTokenDecimals(tokenData.decimals.toString());
                                                    }
                                                }}
                                                placeholder="Select token to sell..."
                                                disabled={loadingTokens}
                                                allowCustom={true}
                                            />
                                            
                                            {/* Show selected token info */}
                                            {newAssetTokenLedger && newAssetTokenSymbol && (
                                                <div style={{
                                                    marginTop: '12px',
                                                    padding: '12px',
                                                    background: theme.colors.secondaryBg,
                                                    borderRadius: '8px',
                                                    border: `1px solid ${theme.colors.border}`,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '12px',
                                                }}>
                                                    {newAssetTokenLogo ? (
                                                        <img 
                                                            src={newAssetTokenLogo} 
                                                            alt={newAssetTokenSymbol}
                                                            style={{
                                                                width: '40px',
                                                                height: '40px',
                                                                borderRadius: '50%',
                                                                objectFit: 'cover'
                                                            }}
                                                            onError={(e) => e.target.style.display = 'none'}
                                                        />
                                                    ) : (
                                                        <div style={{
                                                            width: '40px',
                                                            height: '40px',
                                                            borderRadius: '50%',
                                                            background: theme.colors.tertiaryBg,
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            fontWeight: '700',
                                                            fontSize: '1rem',
                                                            color: theme.colors.accent
                                                        }}>
                                                            {newAssetTokenSymbol.slice(0, 2).toUpperCase()}
                                                        </div>
                                                    )}
                                                    <div style={{ flex: 1 }}>
                                                        <div style={{ 
                                                            fontWeight: '700', 
                                                            fontSize: '1.1rem',
                                                            color: theme.colors.primaryText 
                                                        }}>
                                                            {newAssetTokenSymbol}
                                                        </div>
                                                        <div style={{ 
                                                            fontSize: '0.8rem', 
                                                            color: theme.colors.mutedText,
                                                            fontFamily: 'monospace'
                                                        }}>
                                                            {newAssetTokenLedger.slice(0, 15)}...
                                                        </div>
                                                    </div>
                                                    <div style={{
                                                        fontSize: '0.75rem',
                                                        color: theme.colors.mutedText,
                                                        textAlign: 'right',
                                                    }}>
                                                        <div>Decimals: {newAssetTokenDecimals}</div>
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {/* Show wallet balance */}
                                            {newAssetTokenLedger && (
                                                <div style={{
                                                    marginTop: '8px',
                                                    padding: '10px 12px',
                                                    background: `${theme.colors.accent}10`,
                                                    borderRadius: '8px',
                                                    fontSize: '0.85rem',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                }}>
                                                    <FaWallet style={{ color: theme.colors.accent }} />
                                                    <span style={{ color: theme.colors.secondaryText }}>Your balance:</span>
                                                    {loadingTokenBalance ? (
                                                        <span style={{ color: theme.colors.mutedText }}>Loading...</span>
                                                    ) : newAssetTokenBalance !== null ? (
                                                        <span style={{ 
                                                            fontWeight: '600', 
                                                            color: theme.colors.primaryText 
                                                        }}>
                                                            {(Number(newAssetTokenBalance) / Math.pow(10, parseInt(newAssetTokenDecimals) || 8)).toLocaleString(undefined, {
                                                                minimumFractionDigits: 0,
                                                                maximumFractionDigits: 4,
                                                            })} {newAssetTokenSymbol || 'TOKEN'}
                                                        </span>
                                                    ) : (
                                                        <span style={{ color: theme.colors.mutedText }}>—</span>
                                                    )}
                                                    
                                                    {/* Quick fill button - uses balance minus one fee */}
                                                    {newAssetTokenBalance !== null && Number(newAssetTokenBalance) > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const decimals = parseInt(newAssetTokenDecimals) || 8;
                                                                const token = whitelistedTokens.find(t => t.ledger_id.toString() === newAssetTokenLedger);
                                                                const fee = token?.fee ? Number(token.fee) : 10000; // Default to 0.0001 if no fee found
                                                                const maxAmount = Number(newAssetTokenBalance) - fee;
                                                                if (maxAmount > 0) {
                                                                    const maxFormatted = maxAmount / Math.pow(10, decimals);
                                                                    setNewAssetTokenAmount(maxFormatted.toString());
                                                                }
                                                            }}
                                                            style={{
                                                                marginLeft: 'auto',
                                                                background: theme.colors.accent,
                                                                color: theme.colors.primaryBg,
                                                                border: 'none',
                                                                padding: '4px 10px',
                                                                borderRadius: '4px',
                                                                fontSize: '0.75rem',
                                                                fontWeight: '600',
                                                                cursor: 'pointer',
                                                            }}
                                                        >
                                                            Use Max
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <div style={styles.formGroup}>
                                            <label style={styles.label}>
                                                Amount
                                                {newAssetTokenSymbol && <span style={styles.labelHint}> in {newAssetTokenSymbol}</span>}
                                            </label>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                placeholder="e.g., 1000"
                                                style={styles.input}
                                                value={newAssetTokenAmount}
                                                onChange={(e) => setNewAssetTokenAmount(e.target.value)}
                                            />
                                            {/* USD estimate for token amount */}
                                            {newAssetTokenAmount && assetPrices[newAssetTokenLedger] && (
                                                <div style={{
                                                    marginTop: '8px',
                                                    fontSize: '0.85rem',
                                                    color: theme.colors.mutedText,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                }}>
                                                    <span>≈</span>
                                                    <span style={{ 
                                                        color: theme.colors.success, 
                                                        fontWeight: '600' 
                                                    }}>
                                                        {formatUsd(parseFloat(newAssetTokenAmount) * assetPrices[newAssetTokenLedger])}
                                                    </span>
                                                    <span>USD</span>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                                
                                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                                    <button
                                        style={styles.backBtn}
                                        onClick={cancelAssetEdit}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        style={styles.nextBtn}
                                        onClick={addAsset}
                                    >
                                        {editingAssetIndex !== null ? 'Update Asset' : 'Add Asset'}
                                    </button>
                                </div>
                            </div>
                        )}
                        
                        <div style={styles.buttonRow}>
                            <button style={styles.backBtn} onClick={handleBack}>
                                ← Back
                            </button>
                            <button style={styles.nextBtn} onClick={handleNext}>
                                Next: Review →
                            </button>
                        </div>
                    </div>
                )}
                
                {/* Step 3: Review & Create */}
                {step === 3 && (
                    <div style={styles.card} className="sneedex-create-card">
                        <h3 style={styles.cardTitle}>Review Your Offer</h3>
                        
                        <div style={styles.reviewSection}>
                            <div style={styles.reviewLabel}>Price Token</div>
                            <div style={styles.reviewValue}>
                                {priceTokenSymbol}
                                {selectedPriceToken?.name && (
                                    <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginLeft: '8px' }}>
                                        ({selectedPriceToken.name})
                                    </span>
                                )}
                            </div>
                        </div>
                        
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div style={styles.reviewSection}>
                                <div style={styles.reviewLabel}>Minimum Bid</div>
                                <div style={styles.reviewValue}>
                                    {minBidPrice ? `${minBidPrice} ${priceTokenSymbol}` : 'Not set'}
                                    {minBidPrice && paymentTokenPrice && (
                                        <span style={{ color: theme.colors.success, marginLeft: '8px', fontSize: '0.85rem' }}>
                                            ≈ {formatUsd(parseFloat(minBidPrice) * paymentTokenPrice)}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div style={styles.reviewSection}>
                                <div style={styles.reviewLabel}>Buyout Price</div>
                                <div style={styles.reviewValue}>
                                    {buyoutPrice ? `${buyoutPrice} ${priceTokenSymbol}` : 'Not set'}
                                    {buyoutPrice && paymentTokenPrice && (
                                        <span style={{ color: theme.colors.success, marginLeft: '8px', fontSize: '0.85rem' }}>
                                            ≈ {formatUsd(parseFloat(buyoutPrice) * paymentTokenPrice)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        
                        <div style={styles.reviewSection}>
                            <div style={styles.reviewLabel}>Expiration</div>
                            <div style={styles.reviewValue}>
                                {hasExpiration ? `${formatExpirationTime()} from activation` : 'No expiration'}
                            </div>
                        </div>
                        
                        {/* Offer Visibility */}
                        <div style={styles.reviewSection}>
                            <div style={styles.reviewLabel}>Offer Visibility</div>
                            <div style={styles.reviewValue}>
                                {isPrivateOffer ? (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ color: theme.colors.warning || '#f59e0b' }}>🔒 Private Offer</span>
                                    </span>
                                ) : (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ color: theme.colors.success }}>🌐 Public Offer</span>
                                    </span>
                                )}
                            </div>
                            {isPrivateOffer && approvedBidders.length > 0 && (
                                <div style={{ marginTop: '0.75rem' }}>
                                    <div style={{ 
                                        fontSize: '0.85rem', 
                                        color: theme.colors.mutedText, 
                                        marginBottom: '0.5rem' 
                                    }}>
                                        Approved Bidders ({approvedBidders.length}):
                                    </div>
                                    <div style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '6px',
                                        padding: '0.75rem',
                                        background: theme.colors.primaryBg,
                                        borderRadius: '8px',
                                        border: `1px solid ${theme.colors.border}`,
                                    }}>
                                        {approvedBidders.map((bidderStr, idx) => (
                                            <div 
                                                key={bidderStr}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                    padding: '4px 0',
                                                    borderBottom: idx < approvedBidders.length - 1 ? `1px solid ${theme.colors.border}` : 'none',
                                                }}
                                            >
                                                <PrincipalDisplay 
                                                    principal={bidderStr} 
                                                    size="small"
                                                    showCopy={false}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        {minBidIncrement && (
                            <div style={styles.reviewSection}>
                                <div style={styles.reviewLabel}>Min Bid Increment</div>
                                <div style={styles.reviewValue}>
                                    {minBidIncrement} {priceTokenSymbol}
                                    {paymentTokenPrice && parseFloat(minBidIncrement) > 0 && (
                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                            (≈ ${(parseFloat(minBidIncrement) * paymentTokenPrice).toFixed(2)})
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                        
                        {marketplaceFeeRate !== null && marketplaceFeeRate > 0 && !premiumLoading && (
                            <div style={{
                                ...styles.reviewSection,
                                background: isPremiumUser && premiumAuctionCut > 0 && premiumAuctionCut < marketplaceFeeRate 
                                    ? `linear-gradient(135deg, ${theme.colors.cardBackground} 0%, rgba(255, 215, 0, 0.15) 100%)`
                                    : theme.colors.secondaryBg,
                                border: isPremiumUser && premiumAuctionCut > 0 && premiumAuctionCut < marketplaceFeeRate
                                    ? '1px solid rgba(255, 215, 0, 0.3)'
                                    : `1px solid ${theme.colors.border}`,
                                borderRadius: '10px',
                                padding: '1rem',
                            }}>
                                <div style={{ ...styles.reviewLabel, marginBottom: '0.5rem' }}>Sneedex Cut</div>
                                {isPremiumUser && premiumAuctionCut > 0 && premiumAuctionCut < marketplaceFeeRate ? (
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '0.5rem' }}>
                                            <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#FFD700' }}>
                                                {formatFeeRate(premiumAuctionCut)}
                                            </span>
                                            <span style={{ 
                                                fontSize: '0.9rem', 
                                                textDecoration: 'line-through', 
                                                color: theme.colors.mutedText 
                                            }}>
                                                {formatFeeRate(marketplaceFeeRate)}
                                            </span>
                                            <span style={{ 
                                                background: 'linear-gradient(135deg, #FFD700, #FFA500)', 
                                                color: '#1a1a2e', 
                                                padding: '3px 10px', 
                                                borderRadius: '12px',
                                                fontSize: '0.8rem',
                                                fontWeight: 'bold',
                                            }}>
                                                👑 {Math.round((1 - premiumAuctionCut / marketplaceFeeRate) * 100)}% OFF
                                            </span>
                                        </div>
                                        <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>
                                            Taken from the winning bid when the sale completes
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: theme.colors.warning, marginBottom: '0.25rem' }}>
                                            {formatFeeRate(marketplaceFeeRate)}
                                        </div>
                                        <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>
                                            Taken from the winning bid when the sale completes
                                            {premiumAuctionCut > 0 && premiumAuctionCut < marketplaceFeeRate && (
                                                <span style={{ display: 'block', marginTop: '0.5rem' }}>
                                                    <Link to="/premium" style={{ color: '#FFD700' }}>
                                                        👑 Premium members pay only {formatFeeRate(premiumAuctionCut)} →
                                                    </Link>
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        
                        <div style={styles.reviewSection}>
                            <div style={styles.reviewLabel}>Assets ({assets.length})</div>
                            <div style={styles.assetsList}>
                                {assets.map((asset, idx) => {
                                    const key = getAssetKey(asset);
                                    const verification = reviewVerification[key];
                                    const isExpanded = expandedReviewAssets[idx];
                                    
                                    return (
                                        <div key={idx} style={{ 
                                            ...styles.assetItem, 
                                            background: theme.colors.secondaryBg,
                                            flexDirection: 'column',
                                            alignItems: 'stretch',
                                        }}>
                                            <div 
                                                style={{ 
                                                    display: 'flex', 
                                                    justifyContent: 'space-between', 
                                                    alignItems: 'center',
                                                    cursor: 'pointer',
                                                }}
                                                onClick={() => setExpandedReviewAssets(prev => ({ ...prev, [idx]: !prev[idx] }))}
                                            >
                                                <div style={styles.assetInfo}>
                                                    {getAssetIcon(asset)}
                                                    <div style={styles.assetDetails}>
                                                        <div style={styles.assetType}>
                                                            {asset.type === 'canister' && (
                                                                asset.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER && asset.totalIcpE8s
                                                                    ? `${(Number(asset.totalIcpE8s) / 1e8).toFixed(2)} ICP (Staking Bot)`
                                                                    : (asset.title || asset.display)
                                                            )}
                                                            {asset.type === 'neuron' && (
                                                                asset.stake
                                                                    ? `${(Number(asset.stake) / Math.pow(10, getSnsDecimals(asset.governance_id))).toFixed(2)} ${asset.symbol || 'tokens'} (Neuron)`
                                                                    : asset.display
                                                            )}
                                                            {asset.type === 'token' && asset.display}
                                                        </div>
                                                        {/* USD Value */}
                                                        {(() => {
                                                            const usdValue = getAssetUsdValue(asset);
                                                            if (usdValue !== null) {
                                                                return (
                                                                    <div style={{ 
                                                                        fontSize: '0.75rem', 
                                                                        color: theme.colors.success,
                                                                        fontWeight: '600',
                                                                        marginTop: '2px',
                                                                    }}>
                                                                        ≈ {formatUsd(usdValue)}
                                                                    </div>
                                                                );
                                                            }
                                                            return null;
                                                        })()}
                                                    </div>
                                                </div>
                                                <div style={{ 
                                                    display: 'flex', 
                                                    alignItems: 'center', 
                                                    gap: '8px',
                                                    marginLeft: 'auto',
                                                }}>
                                                    {verification?.checking ? (
                                                        <span style={{ 
                                                            color: theme.colors.mutedText, 
                                                            fontSize: '0.8rem',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '6px',
                                                        }}>
                                                            <FaSync style={{ animation: 'spin 1s linear infinite' }} /> Checking...
                                                        </span>
                                                    ) : verification?.verified ? (
                                                        <span style={{ 
                                                            color: theme.colors.success, 
                                                            fontSize: '0.8rem',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '4px',
                                                        }}>
                                                            <FaCheck /> Ready to escrow
                                                        </span>
                                                    ) : verification?.verified === false ? (
                                                        <span style={{ 
                                                            color: theme.colors.warning, 
                                                            fontSize: '0.8rem',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '4px',
                                                        }}>
                                                            <FaExclamationTriangle /> {verification.message || 'Not ready for escrow'}
                                                        </span>
                                                    ) : null}
                                                    <span style={{ color: theme.colors.mutedText, marginLeft: '4px' }}>
                                                        {isExpanded ? <FaChevronUp /> : <FaChevronDown />}
                                                    </span>
                                                </div>
                                            </div>
                                            
                                            {/* Expanded Details */}
                                            {isExpanded && (
                                                <div style={{ 
                                                    marginTop: '12px', 
                                                    paddingTop: '12px',
                                                    borderTop: `1px solid ${theme.colors.border}`,
                                                    fontSize: '0.85rem',
                                                }}>
                                                    {asset.type === 'canister' && (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                <span style={{ color: theme.colors.mutedText, minWidth: '100px' }}>App canister id:</span>
                                                                <PrincipalDisplay 
                                                                    principal={asset.canister_id}
                                                                    displayInfo={getPrincipalDisplayInfoFromContext(asset.canister_id, principalNames, principalNicknames)}
                                                                    short={false}
                                                                    showCopyButton={true}
                                                                />
                                                            </div>
                                                            {asset.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER && (
                                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                                    <span style={{ color: theme.colors.mutedText, minWidth: '100px' }}>Type:</span>
                                                                    <span style={{ color: theme.colors.accent }}>ICP Staking Bot</span>
                                                                </div>
                                                            )}
                                                            {asset.title && (
                                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                                    <span style={{ color: theme.colors.mutedText, minWidth: '100px' }}>Title:</span>
                                                                    <span>{asset.title}</span>
                                                                </div>
                                                            )}
                                                            {asset.description && (
                                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                                                    <span style={{ color: theme.colors.mutedText, minWidth: '100px' }}>Description:</span>
                                                                    <span style={{ 
                                                                        whiteSpace: 'pre-wrap',
                                                                        wordBreak: 'break-word',
                                                                        maxHeight: '100px',
                                                                        overflow: 'auto',
                                                                    }}>{asset.description}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    {asset.type === 'neuron' && (() => {
                                                        // Get SNS info for display
                                                        const sns = snsList.find(s => 
                                                            s.canisters?.governance === asset.governance_id ||
                                                            s.governance_canister_id?.[0]?.toString() === asset.governance_id ||
                                                            s.governance_canister_id?.toString() === asset.governance_id
                                                        );
                                                        const snsRoot = sns?.canisters?.root || 
                                                                       sns?.root_canister_id?.[0]?.toString() || 
                                                                       sns?.root_canister_id?.toString() || '';
                                                        const govKey = sns?.canisters?.governance || 
                                                                      sns?.governance_canister_id?.[0]?.toString() || 
                                                                      asset.governance_id;
                                                        const snsLogo = snsLogos.get(govKey) || snsLogos.get(asset.governance_id);
                                                        const snsName = sns?.name || 'SNS';
                                                        
                                                        return (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                                {/* SNS Info Header */}
                                                                <div style={{ 
                                                                    display: 'flex', 
                                                                    alignItems: 'center', 
                                                                    gap: '10px',
                                                                    padding: '8px 12px',
                                                                    background: theme.colors.tertiaryBg,
                                                                    borderRadius: '8px',
                                                                }}>
                                                                    {snsLogo && (
                                                                        <img 
                                                                            src={snsLogo} 
                                                                            alt={snsName} 
                                                                            style={{ 
                                                                                width: 28, 
                                                                                height: 28, 
                                                                                borderRadius: '50%',
                                                                                objectFit: 'cover'
                                                                            }} 
                                                                        />
                                                                    )}
                                                                    <div>
                                                                        <div style={{ 
                                                                            fontWeight: '600', 
                                                                            color: theme.colors.primaryText,
                                                                            fontSize: '0.9rem'
                                                                        }}>
                                                                            {snsName}
                                                                        </div>
                                                                        <div style={{ 
                                                                            fontSize: '0.75rem', 
                                                                            color: theme.colors.mutedText 
                                                                        }}>
                                                                            SNS Neuron
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                
                                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                                                    <span style={{ color: theme.colors.mutedText, minWidth: '100px' }}>Neuron ID:</span>
                                                                    <NeuronDisplay 
                                                                        neuronId={asset.neuron_id}
                                                                        snsRoot={snsRoot}
                                                                        showCopyButton={true}
                                                                        enableContextMenu={false}
                                                                        isAuthenticated={isAuthenticated}
                                                                        noLink={true}
                                                                    />
                                                                </div>
                                                                
                                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                                    <span style={{ color: theme.colors.mutedText, minWidth: '100px' }}>Governance:</span>
                                                                    <PrincipalDisplay 
                                                                        principal={asset.governance_id}
                                                                        displayInfo={getPrincipalDisplayInfoFromContext(asset.governance_id, principalNames, principalNicknames)}
                                                                        short={false}
                                                                        showCopyButton={true}
                                                                    />
                                                                </div>
                                                                
                                                                {asset.stake && (
                                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                                        <span style={{ color: theme.colors.mutedText, minWidth: '100px' }}>Staked:</span>
                                                                        <span style={{ 
                                                                            fontWeight: '600', 
                                                                            color: theme.colors.success 
                                                                        }}>
                                                                            {(Number(asset.stake) / Math.pow(10, getSnsDecimals(asset.governance_id))).toFixed(2)} {asset.symbol || 'tokens'}
                                                                        </span>
                                                                    </div>
                                                                )}
                                                                
                                                                {/* Jailbreak link for failed neuron verification */}
                                                                {verification?.verified === false && (
                                                                    <div style={{ 
                                                                        marginTop: '8px',
                                                                        padding: '10px 12px',
                                                                        background: `${theme.colors.success}10`,
                                                                        borderRadius: '6px',
                                                                        border: `1px solid ${theme.colors.success}30`,
                                                                    }}>
                                                                        <Link 
                                                                            to="/tools/sns_jailbreak"
                                                                            style={{
                                                                                display: 'inline-flex',
                                                                                alignItems: 'center',
                                                                                gap: '6px',
                                                                                color: theme.colors.success,
                                                                                fontSize: '0.85rem',
                                                                                textDecoration: 'none',
                                                                            }}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                        >
                                                                            <FaUnlock size={12} />
                                                                            <span>Use the <strong>Jailbreak Wizard</strong> to add Sneedex as a hotkey</span>
                                                                        </Link>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })()}
                                                    {asset.type === 'token' && (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                <span style={{ color: theme.colors.mutedText, minWidth: '100px' }}>Ledger:</span>
                                                                <PrincipalDisplay 
                                                                    principal={asset.ledger_id}
                                                                    displayInfo={getPrincipalDisplayInfoFromContext(asset.ledger_id, principalNames, principalNicknames)}
                                                                    short={false}
                                                                    showCopyButton={true}
                                                                />
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                <span style={{ color: theme.colors.mutedText, minWidth: '100px' }}>Amount:</span>
                                                                <span>{asset.amount} {asset.symbol}</span>
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                <span style={{ color: theme.colors.mutedText, minWidth: '100px' }}>Decimals:</span>
                                                                <span>{asset.decimals}</span>
                                                            </div>
                                                        </div>
                                                    )}
                                                    
                                                    {/* Edit button in expanded view */}
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setStep(2);
                                                            setTimeout(() => editAsset(idx), 100);
                                                        }}
                                                        style={{
                                                            marginTop: '12px',
                                                            background: `${theme.colors.accent}15`,
                                                            border: `1px solid ${theme.colors.accent}40`,
                                                            color: theme.colors.accent,
                                                            padding: '6px 12px',
                                                            borderRadius: '6px',
                                                            cursor: 'pointer',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '6px',
                                                            fontSize: '0.8rem',
                                                        }}
                                                    >
                                                        <FaPencilAlt /> Edit This Asset
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            <button
                                onClick={verifyAllAssetsForReview}
                                disabled={Object.values(reviewVerification).some(v => v?.checking)}
                                style={{
                                    marginTop: '0.75rem',
                                    background: 'transparent',
                                    border: `1px solid ${theme.colors.accent}`,
                                    color: theme.colors.accent,
                                    padding: '6px 12px',
                                    borderRadius: '6px',
                                    fontSize: '0.8rem',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                }}
                            >
                                <FaSync /> Recheck Assets
                            </button>
                            
                            {/* Total Estimated Value */}
                            {(() => {
                                const totalUsd = assets.reduce((sum, asset) => {
                                    const usdValue = getAssetUsdValue(asset);
                                    return sum + (usdValue || 0);
                                }, 0);
                                
                                if (totalUsd > 0) {
                                    return (
                                        <div style={{
                                            marginTop: '1rem',
                                            padding: '12px 16px',
                                            background: `linear-gradient(135deg, ${theme.colors.success}15, ${theme.colors.accent}10)`,
                                            borderRadius: '10px',
                                            border: `1px solid ${theme.colors.success}30`,
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                        }}>
                                            <span style={{ 
                                                fontSize: '0.9rem', 
                                                fontWeight: '500',
                                                color: theme.colors.primaryText,
                                            }}>
                                                📊 Total Estimated Value:
                                            </span>
                                            <span style={{ 
                                                fontSize: '1.1rem', 
                                                fontWeight: '700',
                                                color: theme.colors.success,
                                            }}>
                                                {formatUsd(totalUsd)}
                                            </span>
                                        </div>
                                    );
                                }
                                return null;
                            })()}
                        </div>
                        
                        {/* Show different message based on verification status */}
                        {Object.values(reviewVerification).some(v => v?.checking) ? (
                            <div style={{ 
                                background: `${theme.colors.accent}15`, 
                                border: `1px solid ${theme.colors.accent}`,
                                borderRadius: '10px',
                                padding: '1rem',
                                marginBottom: '1.5rem',
                                fontSize: '0.9rem',
                                color: theme.colors.accent,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                            }}>
                                <FaSync style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                                <span><strong>Verifying assets...</strong> Checking ownership and permissions for all assets. This may take a moment.</span>
                            </div>
                        ) : allAssetsReady ? (
                            <div style={{ 
                                background: `${theme.colors.success}15`, 
                                border: `1px solid ${theme.colors.success}`,
                                borderRadius: '10px',
                                padding: '1rem',
                                marginBottom: '1.5rem',
                                fontSize: '0.9rem',
                                color: theme.colors.success,
                            }}>
                                <strong>✅ All assets ready!</strong> When you click "Create Offer", the system will automatically:
                                <ol style={{ margin: '0.5rem 0 0 1.5rem', padding: 0 }}>
                                    <li>Create and finalize the offer</li>
                                    <li>Escrow all assets (add Sneedex as controller/hotkey, transfer tokens)</li>
                                    <li>Activate the offer and make it live</li>
                                </ol>
                            </div>
                        ) : (
                            <div style={{ 
                                background: `${theme.colors.error}15`, 
                                border: `1px solid ${theme.colors.error}`,
                                borderRadius: '10px',
                                padding: '1rem',
                                marginBottom: '1.5rem',
                                fontSize: '0.9rem',
                                color: theme.colors.error,
                            }}>
                                <strong>🚫 Cannot create offer yet.</strong> All assets must be ready for escrow before creating an offer. Please ensure:
                                <ul style={{ margin: '0.5rem 0 0 1.5rem', padding: 0 }}>
                                    <li>For apps: You must be a controller of the app canister</li>
                                    <li>For neurons: You must have a hotkey with ManagePrincipals permission</li>
                                    <li>For tokens: You must have sufficient balance (amount + fee)</li>
                                </ul>
                            </div>
                        )}
                        
                        {/* Offer Creation Fee Section */}
                        {!loadingFeeInfo && !premiumLoading && (regularOfferCreationFee > 0n || userPaymentBalance > 0n) && (
                            <div style={{
                                background: `linear-gradient(135deg, ${theme.colors.cardBackground} 0%, rgba(255, 215, 0, 0.1) 100%)`,
                                border: `1px solid rgba(255, 215, 0, 0.3)`,
                                borderRadius: '12px',
                                padding: '1.25rem',
                                marginBottom: '1.5rem',
                            }}>
                                <h4 style={{ color: '#FFD700', margin: '0 0 0.75rem 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    💰 Offer Creation Fee
                                    {isPremiumUser && <span style={{ fontSize: '0.75rem', background: 'linear-gradient(135deg, #FFD700, #FFA500)', color: '#1a1a2e', padding: '2px 8px', borderRadius: '10px' }}>👑 PREMIUM</span>}
                                </h4>
                                
                                {regularOfferCreationFee > 0n && (
                                    <div style={{ color: theme.colors.mutedText, margin: '0 0 1rem 0', fontSize: '0.9rem' }}>
                                        {isPremiumUser ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                <span>Fee: <strong style={{ color: '#FFD700' }}>{Number(offerCreationFee) / Number(E8S)} ICP</strong></span>
                                                <span style={{ textDecoration: 'line-through', color: theme.colors.mutedText, fontSize: '0.8rem' }}>
                                                    {Number(regularOfferCreationFee) / Number(E8S)} ICP
                                                </span>
                                                <span style={{ color: theme.colors.success, fontSize: '0.8rem', fontWeight: 'bold' }}>
                                                    {Math.round((1 - Number(offerCreationFee) / Number(regularOfferCreationFee)) * 100)}% OFF
                                                </span>
                                            </div>
                                        ) : (
                                            <span>Fee: <strong style={{ color: '#FFD700' }}>{Number(offerCreationFee) / Number(E8S)} ICP</strong></span>
                                        )}
                                        {!isPremiumUser && premiumOfferCreationFee < regularOfferCreationFee && (
                                            <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                                                <Link to="/premium" style={{ color: '#FFD700' }}>
                                                    👑 Premium members pay only {Number(premiumOfferCreationFee) / Number(E8S)} ICP →
                                                </Link>
                                            </div>
                                        )}
                                    </div>
                                )}
                                
                                {/* Show balance check */}
                                {needsPayment && !hasEnoughPayment && (
                                    <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText, marginBottom: '0.5rem' }}>
                                        Wallet balance: <strong>{userIcpBalance !== null ? `${Number(userIcpBalance) / Number(E8S)} ICP` : 'Loading...'}</strong>
                                        {!canAffordCreation && (
                                            <span style={{ color: theme.colors.error, marginLeft: '8px' }}>
                                                ⚠️ Insufficient funds
                                            </span>
                                        )}
                                    </div>
                                )}
                                
                                {/* Show deposited balance if > 0 (recovery from failed attempt) */}
                                {userPaymentBalance > 0n && (
                                    <div style={{
                                        background: hasEnoughPayment ? `${theme.colors.success}15` : `${theme.colors.warning}15`,
                                        border: `1px solid ${hasEnoughPayment ? theme.colors.success : theme.colors.warning}`,
                                        borderRadius: '8px',
                                        padding: '0.75rem 1rem',
                                        marginTop: '0.75rem',
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                                            <span style={{ color: hasEnoughPayment ? theme.colors.success : theme.colors.warning, fontSize: '0.9rem' }}>
                                                {hasEnoughPayment ? '✅' : '💰'} Pending deposit: <strong>{Number(userPaymentBalance) / Number(E8S)} ICP</strong>
                                                {hasEnoughPayment && ' — Will be used automatically'}
                                            </span>
                                            <button
                                                onClick={handleWithdrawPayment}
                                                disabled={withdrawingPayment}
                                                style={{
                                                    background: 'transparent',
                                                    border: `1px solid ${theme.colors.error}`,
                                                    color: theme.colors.error,
                                                    padding: '4px 12px',
                                                    borderRadius: '6px',
                                                    fontSize: '0.8rem',
                                                    cursor: withdrawingPayment ? 'not-allowed' : 'pointer',
                                                    opacity: withdrawingPayment ? 0.5 : 1,
                                                }}
                                            >
                                                {withdrawingPayment ? 'Withdrawing...' : '↩️ Withdraw'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        
                        <div style={styles.buttonRow}>
                            <button style={styles.backBtn} onClick={handleBack}>
                                ← Back
                            </button>
                            <button
                                style={{
                                    ...styles.createBtn,
                                    ...((!allAssetsReady && !isAdmin) || (needsPayment && !canAffordCreation) ? {
                                        opacity: 0.5,
                                        cursor: 'not-allowed',
                                    } : {})
                                }}
                                onClick={handleCreate}
                                disabled={creating || (!allAssetsReady && !isAdmin) || (needsPayment && !canAffordCreation)}
                                onMouseEnter={(e) => {
                                    if (!creating && (allAssetsReady || isAdmin) && !(needsPayment && !canAffordCreation)) {
                                        e.target.style.transform = 'translateY(-2px)';
                                        e.target.style.boxShadow = `0 8px 25px ${theme.colors.success}40`;
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.transform = 'translateY(0)';
                                    e.target.style.boxShadow = 'none';
                                }}
                            >
                                {creating ? 'Creating...' : 
                                 (needsPayment && !canAffordCreation) ? '⚠️ Insufficient Funds' :
                                 '🚀 Create Offer'}
                            </button>
                        </div>
                    </div>
                )}
                
                {/* Step 4: Success */}
                {step === 4 && (
                    <div style={styles.successCard}>
                        <div style={styles.successIcon}>🎉</div>
                        <h2 style={styles.successTitle}>
                            {allAssetsReady ? 'Offer Live!' : 'Offer Created Successfully!'}
                        </h2>
                        <p style={styles.successText}>
                            Your offer (ID: {Number(createdOfferId)}) has been created
                            {allAssetsReady ? ' and is now ' : ' and is in '}
                            <strong>{allAssetsReady ? 'Active' : 'Draft'}</strong>
                            {allAssetsReady ? '!' : ' state.'}
                        </p>
                        
                        {!allAssetsReady && (
                            <div style={styles.nextStepsBox}>
                                <h4 style={{ color: theme.colors.primaryText, marginBottom: '1rem' }}>Next Steps:</h4>
                                <ol style={{ color: theme.colors.secondaryText, margin: 0, paddingLeft: '1.25rem', lineHeight: '2' }}>
                                    <li><strong>Escrow your assets</strong> - For each asset in your offer:
                                        <ul style={{ marginTop: '0.5rem' }}>
                                            <li>Apps: Add <code style={{ background: theme.colors.tertiaryBg, padding: '2px 6px', borderRadius: '4px' }}>{SNEEDEX_CANISTER_ID}</code> as a controller of the app canister</li>
                                            <li>Neurons: Add Sneedex as a hotkey</li>
                                            <li>Tokens: Transfer to the escrow subaccount</li>
                                        </ul>
                                    </li>
                                    <li><strong>Verify escrow</strong> - Call the escrow functions for each asset</li>
                                    <li><strong>Activate the offer</strong> - Once all assets are escrowed, activate to go live</li>
                                </ol>
                            </div>
                        )}
                        
                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '2rem' }}>
                            <Link
                                to={`/sneedex_offer/${createdOfferId}`}
                                style={styles.nextBtn}
                            >
                                View Offer →
                            </Link>
                            <Link
                                to="/sneedex_my"
                                style={{ ...styles.backBtn, textDecoration: 'none' }}
                            >
                                My Offers
                            </Link>
                        </div>
                    </div>
                )}
                
                {/* Progress Overlay */}
                {showProgressOverlay && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0, 0, 0, 0.85)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000,
                    }}>
                        <div style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '2rem',
                            maxWidth: '450px',
                            width: '90%',
                            boxShadow: `0 20px 60px rgba(0, 0, 0, 0.5)`,
                        }}>
                            <h3 style={{ 
                                color: theme.colors.primaryText, 
                                marginBottom: '1.5rem',
                                textAlign: 'center',
                                fontSize: '1.3rem',
                            }}>
                                {progressError ? '❌ Error' : '🚀 Creating Your Offer'}
                            </h3>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {progressSteps.map((step, idx) => (
                                    <div key={idx} style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        padding: '0.75rem',
                                        background: step.status === 'in_progress' ? `${theme.colors.accent}15` : 'transparent',
                                        borderRadius: '8px',
                                        transition: 'all 0.3s ease',
                                    }}>
                                        <div style={{
                                            width: '28px',
                                            height: '28px',
                                            borderRadius: '50%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '0.85rem',
                                            fontWeight: '600',
                                            background: step.status === 'complete' ? theme.colors.success :
                                                       step.status === 'in_progress' ? theme.colors.accent :
                                                       theme.colors.tertiaryBg,
                                            color: step.status === 'pending' ? theme.colors.mutedText : '#fff',
                                        }}>
                                            {step.status === 'complete' ? <FaCheck /> :
                                             step.status === 'in_progress' ? <FaSync style={{ animation: 'spin 1s linear infinite' }} /> :
                                             idx + 1}
                                        </div>
                                        <span style={{
                                            color: step.status === 'complete' ? theme.colors.success :
                                                   step.status === 'in_progress' ? theme.colors.primaryText :
                                                   theme.colors.mutedText,
                                            fontWeight: step.status === 'in_progress' ? '600' : '400',
                                        }}>
                                            {step.label}
                                        </span>
                                    </div>
                                ))}
                            </div>
                            
                            {progressError && (
                                <div style={{
                                    marginTop: '1.5rem',
                                    padding: '1rem',
                                    background: `${theme.colors.error}15`,
                                    border: `1px solid ${theme.colors.error}`,
                                    borderRadius: '8px',
                                    color: theme.colors.error,
                                    fontSize: '0.9rem',
                                }}>
                                    {progressError}
                                </div>
                            )}
                            
                            {progressError && (
                                <div style={{ 
                                    display: 'flex', 
                                    gap: '1rem', 
                                    justifyContent: 'center', 
                                    marginTop: '1.5rem' 
                                }}>
                                    <button
                                        style={styles.backBtn}
                                        onClick={() => {
                                            setShowProgressOverlay(false);
                                            setProgressError(null);
                                        }}
                                    >
                                        Close
                                    </button>
                                    {createdOfferId && (
                                        <Link
                                            to={`/sneedex_offer/${createdOfferId}`}
                                            style={{ ...styles.nextBtn, textDecoration: 'none' }}
                                        >
                                            View Offer
                                        </Link>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}
                </div>
                {/* End main content */}
            </main>
        </div>
    );
}

export default SneedexCreate;
