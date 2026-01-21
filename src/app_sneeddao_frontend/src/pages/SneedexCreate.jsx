import React, { useState, useEffect, useCallback } from 'react';
import Header from '../components/Header';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import { useAdminCheck } from '../hooks/useAdminCheck';
import { FaArrowLeft, FaPlus, FaTrash, FaCubes, FaBrain, FaCoins, FaCheck, FaExclamationTriangle, FaServer, FaRobot, FaWallet, FaSync, FaPencilAlt, FaChevronDown, FaChevronUp } from 'react-icons/fa';
import { Principal } from '@dfinity/principal';
import { HttpAgent, Actor } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { 
    createSneedexActor, 
    parseAmount, 
    daysToExpirationNs,
    createAssetVariant,
    getErrorMessage,
    formatFeeRate,
    SNEEDEX_CANISTER_ID,
    CANISTER_KIND_UNKNOWN,
    CANISTER_KIND_ICP_NEURON_MANAGER,
    CANISTER_KIND_NAMES,
    MAX_CANISTER_TITLE_LENGTH,
    MAX_CANISTER_DESCRIPTION_LENGTH
} from '../utils/SneedexUtils';
import { getCanisterGroups, convertGroupsFromBackend } from '../utils/BackendUtils';
import TokenSelector from '../components/TokenSelector';
import { createActor as createBackendActor } from 'declarations/app_sneeddao_backend';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneed_icp_neuron_manager_factory';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createGovernanceActor } from 'external/sns_governance';
import { getAllSnses, startBackgroundSnsFetch, fetchSnsLogo, getSnsById } from '../utils/SnsUtils';
import { fetchUserNeuronsForSns, getNeuronId, uint8ArrayToHex } from '../utils/NeuronUtils';
import { PrincipalDisplay } from '../utils/PrincipalUtils';

const backendCanisterId = process.env.CANISTER_ID_APP_SNEEDDAO_BACKEND || process.env.REACT_APP_BACKEND_CANISTER_ID;
const getHost = () => process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943';
const MANAGEMENT_CANISTER_ID = 'aaaaa-aa';
const SNEED_SNS_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';

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
    const { principalNames, principalNicknames, getNeuronDisplayName: getNeuronNameInfo } = useNaming();
    const navigate = useNavigate();
    
    // Offer settings
    const [minBidPrice, setMinBidPrice] = useState('');
    const [buyoutPrice, setBuyoutPrice] = useState('');
    const [hasExpiration, setHasExpiration] = useState(true);
    const [expirationDays, setExpirationDays] = useState('7');
    const [priceTokenLedger, setPriceTokenLedger] = useState('ryjl3-tyaaa-aaaaa-aaaba-cai'); // ICP default
    
    // Minimum bid increment (as multiple of token fee)
    const [minBidIncrementMultiple, setMinBidIncrementMultiple] = useState('');
    
    // Private offer / Approved bidders
    const [isPrivateOffer, setIsPrivateOffer] = useState(false);
    const [approvedBiddersText, setApprovedBiddersText] = useState(''); // Comma-separated principals
    
    // Notes
    const [publicNote, setPublicNote] = useState(''); // Visible to everyone
    const [noteToBuyer, setNoteToBuyer] = useState(''); // Only visible to winning bidder
    
    // Token metadata from backend
    const [whitelistedTokens, setWhitelistedTokens] = useState([]);
    const [loadingTokens, setLoadingTokens] = useState(true);
    
    // Marketplace fee rate
    const [marketplaceFeeRate, setMarketplaceFeeRate] = useState(null);
    
    // Admin status (admins can create offers with unverified assets)
    const { isAdmin } = useAdminCheck({ identity, isAuthenticated, redirectPath: null });
    
    // User's registered canisters and neuron managers
    const [userCanisters, setUserCanisters] = useState([]); // Array of canister ID strings (from canister groups)
    const [walletCanisters, setWalletCanisters] = useState([]); // Array of canister ID strings (from tracked_canisters)
    const [neuronManagers, setNeuronManagers] = useState([]); // Array of canister ID strings
    const [loadingCanisters, setLoadingCanisters] = useState(true);
    
    // Derived token info from selected ledger
    const selectedPriceToken = whitelistedTokens.find(t => t.ledger_id.toString() === priceTokenLedger);
    const priceTokenSymbol = selectedPriceToken?.symbol || 'TOKEN';
    const priceTokenDecimals = selectedPriceToken?.decimals || 8;
    
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
    
    // Fetch marketplace fee rate on mount
    useEffect(() => {
        const fetchFeeRate = async () => {
            try {
                const sneedexActor = createSneedexActor(identity);
                const rate = await sneedexActor.getMarketplaceFeeRate();
                setMarketplaceFeeRate(Number(rate));
            } catch (e) {
                console.error('Failed to fetch marketplace fee rate:', e);
            }
        };
        fetchFeeRate();
    }, [identity]);
    
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
    
    // SNS and Neuron selection state
    const [snsList, setSnsList] = useState([]);
    const [loadingSnses, setLoadingSnses] = useState(true);
    const [selectedSnsRoot, setSelectedSnsRoot] = useState('');
    const [snsNeurons, setSnsNeurons] = useState([]);
    const [loadingSnsNeurons, setLoadingSnsNeurons] = useState(false);
    const [snsLogos, setSnsLogos] = useState(new Map());
    
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
            return { verified: false, message: 'Not a controller - add Sneedex manually' };
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
            setCanisterControllerStatus({ verified: false, message: 'Invalid canister ID format' });
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
        if (!canisterId) return { verified: false, message: 'No canister ID' };
        
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
            return { verified: false, message: 'Could not verify - add hotkey manually' };
        }
    }, [identity]);
    
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
            if (newAssetType === 'canister') {
                if (!newAssetCanisterId.trim()) {
                    setError('Please enter a canister ID');
                    return;
                }
                // Validate principal
                Principal.fromText(newAssetCanisterId.trim());
                
                // If ICP Neuron Manager selected but not verified, show error
                if (newAssetCanisterKind === CANISTER_KIND_ICP_NEURON_MANAGER && !canisterKindVerified?.verified) {
                    setError('Please verify the canister is an ICP Neuron Manager first');
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
                
                const kindName = CANISTER_KIND_NAMES[newAssetCanisterKind] || 'Canister';
                const displayTitle = newAssetCanisterTitle.trim() || `${newAssetCanisterId.trim().slice(0, 10)}...`;
                asset = { 
                    type: 'canister', 
                    canister_id: newAssetCanisterId.trim(),
                    canister_kind: newAssetCanisterKind,
                    title: newAssetCanisterTitle.trim() || null,
                    description: newAssetCanisterDescription.trim() || null,
                    display: `${kindName}: ${displayTitle}`
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
                asset = { 
                    type: 'neuron', 
                    governance_id: newAssetGovernanceId.trim(), 
                    neuron_id: newAssetNeuronId.trim(),
                    display: `Neuron: ${newAssetNeuronId.trim().slice(0, 10)}...`
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
                    display: `${newAssetTokenAmount} ${newAssetTokenSymbol.trim() || 'TOKEN'}`
                };
            }
        } catch (e) {
            setError('Invalid principal/canister ID format');
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
            setNewAssetType('canister');
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
        setNewAssetGovernanceId('');
        setNewAssetNeuronId('');
        setSelectedSnsRoot('');
        setSnsNeurons([]);
        setNewAssetTokenLedger('');
        setNewAssetTokenAmount('');
        setNewAssetTokenSymbol('');
        setNewAssetTokenDecimals('8');
        setNewAssetTokenBalance(null);
    };
    
    const validateStep1 = () => {
        if (!minBidPrice && !buyoutPrice) {
            setError('You must set either a minimum bid price or a buyout price (or both)');
            return false;
        }
        if (!hasExpiration && !buyoutPrice) {
            setError('If there is no expiration, you must set a buyout price');
            return false;
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
    
    const handleCreate = async () => {
        if (!identity) {
            setError('Please connect your wallet first');
            return;
        }
        
        setCreating(true);
        setError('');
        setProgressError(null);
        
        // Build progress steps based on what we need to do
        const steps = [
            { label: 'Creating offer...', status: 'pending' },
            { label: 'Adding assets...', status: 'pending' },
            { label: 'Finalizing offer...', status: 'pending' },
        ];
        
        if (allAssetsReady) {
            steps.push({ label: 'Escrowing assets...', status: 'pending' });
            steps.push({ label: 'Activating offer...', status: 'pending' });
        }
        
        setProgressSteps(steps);
        setCurrentProgressStep(0);
        setShowProgressOverlay(true);
        
        try {
            const actor = createSneedexActor(identity);
            
            // Step 1: Create the offer
            updateProgressStep(0, 'in_progress');
            
            // Parse approved bidders if this is a private offer
            let approvedBidders = [];
            if (isPrivateOffer && approvedBiddersText.trim()) {
                const lines = approvedBiddersText.split('\n').map(l => l.trim()).filter(l => l);
                for (const line of lines) {
                    try {
                        approvedBidders.push(Principal.fromText(line));
                    } catch (e) {
                        throw new Error(`Invalid principal ID: ${line}`);
                    }
                }
            }
            
            const createRequest = {
                price_token_ledger: Principal.fromText(priceTokenLedger),
                min_bid_price: minBidPrice ? [parseAmount(minBidPrice, priceTokenDecimals)] : [],
                buyout_price: buyoutPrice ? [parseAmount(buyoutPrice, priceTokenDecimals)] : [],
                expiration: hasExpiration ? [daysToExpirationNs(parseInt(expirationDays))] : [],
                approved_bidders: isPrivateOffer && approvedBidders.length > 0 ? [approvedBidders] : [],
                min_bid_increment_fee_multiple: minBidIncrementMultiple ? [BigInt(parseInt(minBidIncrementMultiple))] : [],
                public_note: publicNote.trim() ? [publicNote.trim()] : [],
                note_to_buyer: noteToBuyer.trim() ? [noteToBuyer.trim()] : [],
            };
            
            const createResult = await actor.createOffer(createRequest);
            
            if ('err' in createResult) {
                throw new Error(getErrorMessage(createResult.err));
            }
            
            const offerId = createResult.ok;
            setCreatedOfferId(offerId);
            updateProgressStep(0, 'complete');
            
            // Step 2: Add assets to the offer
            updateProgressStep(1, 'in_progress');
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
            updateProgressStep(1, 'complete');
            
            // Step 3: Finalize assets
            updateProgressStep(2, 'in_progress');
            const finalizeResult = await actor.finalizeAssets(offerId);
            if ('err' in finalizeResult) {
                throw new Error(`Failed to finalize: ${getErrorMessage(finalizeResult.err)}`);
            }
            updateProgressStep(2, 'complete');
            
            // If all assets are ready, auto-escrow and activate
            if (allAssetsReady) {
                // Step 4: Escrow all assets
                updateProgressStep(3, 'in_progress');
                
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
                updateProgressStep(3, 'complete');
                
                // Step 5: Activate the offer
                updateProgressStep(4, 'in_progress');
                const activateResult = await actor.activateOffer(offerId);
                if ('err' in activateResult) {
                    throw new Error(`Failed to activate: ${getErrorMessage(activateResult.err)}`);
                }
                updateProgressStep(4, 'complete');
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
            throw new Error(`Failed to escrow canister: ${getErrorMessage(result.err)}`);
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
    
    const getAssetIcon = (asset) => {
        switch (asset.type) {
            case 'canister': 
                // Show robot icon for ICP Neuron Manager
                if (asset.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER) {
                    return <FaRobot style={{ color: theme.colors.accent }} />;
                }
                return <FaCubes style={{ color: theme.colors.accent }} />;
            case 'neuron': return <FaBrain style={{ color: theme.colors.success }} />;
            case 'token': return <FaCoins style={{ color: theme.colors.warning }} />;
            default: return <FaCubes />;
        }
    };

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
            padding: '1rem',
            background: theme.colors.tertiaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '10px',
        },
        assetInfo: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
        },
        assetDetails: {
            fontSize: '0.9rem',
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
            padding: '8px',
            borderRadius: '6px',
            transition: 'background 0.3s ease',
        },
        editButton: {
            background: 'transparent',
            border: 'none',
            color: theme.colors.accent,
            cursor: 'pointer',
            padding: '8px',
            borderRadius: '6px',
            transition: 'background 0.3s ease',
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
                <main style={styles.container}>
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
            <main style={styles.container}>
                <Link 
                    to="/sneedex_offers" 
                    style={styles.backButton}
                    onMouseEnter={(e) => e.target.style.color = theme.colors.accent}
                    onMouseLeave={(e) => e.target.style.color = theme.colors.mutedText}
                >
                    <FaArrowLeft /> Back to Marketplace
                </Link>
                
                <h1 style={styles.title}>Create Offer</h1>
                <p style={styles.subtitle}>List your assets for auction or instant sale</p>
                
                {/* Progress Bar */}
                {step < 4 && (
                    <div style={styles.progressBar}>
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
                    <div style={styles.card}>
                        <h3 style={styles.cardTitle}>Pricing Configuration</h3>
                        
                        <div style={styles.formGroup}>
                            <label style={styles.label}>
                                Price Token
                                <span style={styles.labelHint}> — The token buyers will pay in</span>
                            </label>
                            <TokenSelector
                                value={priceTokenLedger}
                                onChange={(ledgerId) => setPriceTokenLedger(ledgerId)}
                                placeholder="Select payment token..."
                                disabled={loadingTokens}
                            />
                        </div>
                        
                        <div style={styles.formGroup}>
                            <label style={styles.label}>
                                Minimum Bid Price
                                <span style={styles.labelHint}> — Optional, for auction-style offers</span>
                            </label>
                            <input
                                type="number"
                                step="0.0001"
                                placeholder={`e.g., 10 ${priceTokenSymbol}`}
                                style={styles.input}
                                value={minBidPrice}
                                onChange={(e) => setMinBidPrice(e.target.value)}
                            />
                        </div>
                        
                        <div style={styles.formGroup}>
                            <label style={styles.label}>
                                Buyout Price
                                <span style={styles.labelHint}> — Optional, for instant purchase</span>
                            </label>
                            <input
                                type="number"
                                step="0.0001"
                                placeholder={`e.g., 50 ${priceTokenSymbol}`}
                                style={styles.input}
                                value={buyoutPrice}
                                onChange={(e) => setBuyoutPrice(e.target.value)}
                            />
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
                                <select
                                    style={styles.select}
                                    value={expirationDays}
                                    onChange={(e) => setExpirationDays(e.target.value)}
                                >
                                    <option value="1">1 day</option>
                                    <option value="3">3 days</option>
                                    <option value="7">7 days</option>
                                    <option value="14">14 days</option>
                                    <option value="30">30 days</option>
                                </select>
                            </div>
                        )}
                        
                        <div style={styles.formGroup}>
                            <label style={styles.label}>
                                Min Bid Increment
                                <span style={styles.labelHint}> — Optional, as multiple of token transaction fee</span>
                            </label>
                            <input
                                type="number"
                                style={styles.input}
                                value={minBidIncrementMultiple}
                                onChange={(e) => setMinBidIncrementMultiple(e.target.value)}
                                placeholder={`e.g. 10 = 10× fee${selectedPriceToken ? ` (${(10 * Number(selectedPriceToken.fee) / Math.pow(10, Number(selectedPriceToken.decimals))).toFixed(4)} ${selectedPriceToken.symbol})` : ''}`}
                                min="1"
                            />
                            {minBidIncrementMultiple && selectedPriceToken && (
                                <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText, marginTop: '4px' }}>
                                    Min increment: {(parseInt(minBidIncrementMultiple) * Number(selectedPriceToken.fee) / Math.pow(10, Number(selectedPriceToken.decimals))).toFixed(4)} {selectedPriceToken.symbol}
                                </div>
                            )}
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
                                        <span style={styles.labelHint}> — Enter Principal IDs, one per line</span>
                                    </label>
                                    <textarea
                                        style={{
                                            ...styles.input,
                                            minHeight: '100px',
                                            resize: 'vertical',
                                            fontFamily: 'monospace',
                                            fontSize: '0.9rem',
                                        }}
                                        placeholder="Enter principal IDs, one per line:&#10;xxxxx-xxxxx-xxxxx-xxxxx-cai&#10;yyyyy-yyyyy-yyyyy-yyyyy-cai"
                                        value={approvedBiddersText}
                                        onChange={(e) => setApprovedBiddersText(e.target.value)}
                                    />
                                    <p style={{ 
                                        fontSize: '0.85rem', 
                                        color: theme.colors.mutedText, 
                                        marginTop: '8px' 
                                    }}>
                                        Only these principals will be able to bid on your offer.
                                        You can add multiple principals, one per line.
                                    </p>
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
                        {marketplaceFeeRate !== null && marketplaceFeeRate > 0 && (
                            <div style={{
                                background: `${theme.colors.warning}10`,
                                border: `1px solid ${theme.colors.warning}40`,
                                borderRadius: '10px',
                                padding: '16px',
                                marginBottom: '24px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                            }}>
                                <span style={{ fontSize: '1.5rem' }}>💰</span>
                                <div>
                                    <strong style={{ color: theme.colors.warning }}>
                                        Sneedex Marketplace Fee: {formatFeeRate(marketplaceFeeRate)}
                                    </strong>
                                    <p style={{ 
                                        fontSize: '0.85rem', 
                                        color: theme.colors.mutedText, 
                                        margin: '4px 0 0 0' 
                                    }}>
                                        When your offer sells, Sneedex will take a {formatFeeRate(marketplaceFeeRate)} cut from the winning bid.
                                        The remaining amount goes to you. This rate is locked when the offer is created.
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
                    <div style={styles.card}>
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
                                                        {asset.type === 'canister' && (asset.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER ? 'ICP Neuron Manager' : 'Canister')}
                                                        {asset.type === 'neuron' && 'SNS Neuron'}
                                                        {asset.type === 'token' && `${asset.amount} ${asset.symbol}`}
                                                    </div>
                                                    <div style={styles.assetId}>
                                                        {asset.type === 'canister' && (
                                                            <PrincipalDisplay 
                                                                principal={asset.canister_id}
                                                                short={true}
                                                                showCopyButton={false}
                                                                style={{ fontSize: 'inherit', color: 'inherit' }}
                                                                isAuthenticated={isAuthenticated}
                                                            />
                                                        )}
                                                        {asset.type === 'neuron' && (
                                                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                                                                <PrincipalDisplay 
                                                                    principal={asset.governance_id}
                                                                    short={true}
                                                                    showCopyButton={false}
                                                                    style={{ fontSize: 'inherit', color: 'inherit' }}
                                                                    isAuthenticated={isAuthenticated}
                                                                /> / {asset.neuron_id.slice(0, 10)}...
                                                            </span>
                                                        )}
                                                        {asset.type === 'token' && (
                                                            <PrincipalDisplay 
                                                                principal={asset.ledger_id}
                                                                short={true}
                                                                showCopyButton={false}
                                                                style={{ fontSize: 'inherit', color: 'inherit' }}
                                                                isAuthenticated={isAuthenticated}
                                                            />
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            {/* Verification status */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
                                                            <><FaExclamationTriangle /> Manual escrow</>
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
                                <div style={styles.formGroup}>
                                    <label style={styles.label}>Asset Type</label>
                                    <select
                                        style={styles.select}
                                        value={newAssetType}
                                        onChange={(e) => setNewAssetType(e.target.value)}
                                        disabled={editingAssetIndex !== null} // Can't change type when editing
                                    >
                                        <option value="canister">Canister</option>
                                        <option value="neuron">SNS Neuron</option>
                                        <option value="token">ICRC1 Token</option>
                                    </select>
                                </div>
                                
                                {newAssetType === 'canister' && (
                                    <div style={styles.formGroup}>
                                        <label style={styles.label}>Select Canister</label>
                                        
                                        {loadingCanisters ? (
                                            <div style={{ 
                                                padding: '12px', 
                                                color: theme.colors.mutedText,
                                                background: theme.colors.secondaryBg,
                                                borderRadius: '8px',
                                                fontSize: '0.9rem'
                                            }}>
                                                Loading your canisters...
                                            </div>
                                        ) : (userCanisters.length > 0 || walletCanisters.length > 0 || neuronManagers.length > 0) ? (
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
                                                        // Auto-set canister kind if selecting from neuron managers
                                                        if (neuronManagers.includes(selectedId)) {
                                                            setNewAssetCanisterKind(CANISTER_KIND_ICP_NEURON_MANAGER);
                                                            // Also auto-verify
                                                            if (selectedId) {
                                                                verifyICPNeuronManager(selectedId);
                                                            }
                                                        } else {
                                                            setNewAssetCanisterKind(CANISTER_KIND_UNKNOWN);
                                                            setCanisterKindVerified(null);
                                                        }
                                                        // Controller status will be checked by debounced useEffect
                                                    }}
                                                >
                                                    <option value="">Select a canister...</option>
                                                    
                                                    {userCanisters.length > 0 && (
                                                        <optgroup label="📦 Registered Canisters">
                                                            {userCanisters.map(canisterId => (
                                                                <option key={canisterId} value={canisterId}>
                                                                    {getCanisterName(canisterId)}
                                                                </option>
                                                            ))}
                                                        </optgroup>
                                                    )}
                                                    
                                                    {walletCanisters.filter(id => !neuronManagers.includes(id)).length > 0 && (
                                                        <optgroup label="💼 Wallet Canisters">
                                                            {walletCanisters
                                                                .filter(id => !neuronManagers.includes(id))
                                                                .map(canisterId => (
                                                                <option key={canisterId} value={canisterId}>
                                                                    {getCanisterName(canisterId)}
                                                                </option>
                                                            ))}
                                                        </optgroup>
                                                    )}
                                                    
                                                    {neuronManagers.length > 0 && (
                                                        <optgroup label="🤖 ICP Neuron Managers">
                                                            {neuronManagers.map(canisterId => (
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
                                                    Or enter a canister ID manually:
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
                                                    <strong style={{ color: theme.colors.accent }}>💡 Tip:</strong> Register canisters on the{' '}
                                                    <Link to="/canisters" style={{ color: theme.colors.accent }}>Canisters page</Link>{' '}
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
                                                            You are not a controller of this canister. Only canisters you control can be added to offers.
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
                                        
                                        {/* Canister Kind Selection */}
                                        <div style={{ marginTop: '16px' }}>
                                            <label style={styles.label}>Canister Type (Optional)</label>
                                            <select
                                                style={{
                                                    ...styles.input,
                                                    cursor: 'pointer',
                                                }}
                                                value={newAssetCanisterKind}
                                                onChange={(e) => {
                                                    setNewAssetCanisterKind(parseInt(e.target.value));
                                                    setCanisterKindVerified(null);
                                                }}
                                            >
                                                <option value={CANISTER_KIND_UNKNOWN}>Generic Canister</option>
                                                <option value={CANISTER_KIND_ICP_NEURON_MANAGER}>ICP Neuron Manager</option>
                                            </select>
                                            
                                            {newAssetCanisterKind === CANISTER_KIND_ICP_NEURON_MANAGER && (
                                                <div style={{ marginTop: '8px' }}>
                                                    {canisterKindVerified?.verified ? (
                                                        <div style={{ 
                                                            background: theme.colors.secondaryBg,
                                                            borderRadius: '8px',
                                                            padding: '12px',
                                                            marginTop: '8px',
                                                        }}>
                                                            <div style={{ 
                                                                display: 'flex', 
                                                                alignItems: 'center', 
                                                                gap: '8px',
                                                                color: '#10B981',
                                                                fontSize: '0.9rem',
                                                                marginBottom: '8px',
                                                            }}>
                                                                <FaCheck /> Verified as ICP Neuron Manager
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
                                                    ) : null}
                                                    
                                                    <button
                                                        type="button"
                                                        onClick={() => verifyICPNeuronManager(newAssetCanisterId)}
                                                        disabled={!newAssetCanisterId || verifyingCanisterKind}
                                                        style={{
                                                            ...styles.secondaryButton,
                                                            marginTop: '8px',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '8px',
                                                            opacity: (!newAssetCanisterId || verifyingCanisterKind) ? 0.5 : 1,
                                                        }}
                                                    >
                                                        {verifyingCanisterKind ? (
                                                            <>
                                                                <FaSync style={{ animation: 'spin 1s linear infinite' }} />
                                                                Verifying...
                                                            </>
                                                        ) : (
                                                            <>
                                                                <FaRobot /> Verify as Neuron Manager
                                                            </>
                                                        )}
                                                    </button>
                                                    
                                                    <div style={{ 
                                                        marginTop: '8px', 
                                                        fontSize: '0.8rem', 
                                                        color: theme.colors.mutedText 
                                                    }}>
                                                        Selecting this will enable enhanced display of managed ICP neurons
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        
                                        {/* Title and Description */}
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
                                                placeholder="Give your canister a name"
                                                maxLength={MAX_CANISTER_TITLE_LENGTH}
                                                value={newAssetCanisterTitle}
                                                onChange={(e) => setNewAssetCanisterTitle(e.target.value)}
                                                style={styles.input}
                                            />
                                        </div>
                                        
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
                                                placeholder="Describe what this canister does, its features, why it's valuable..."
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
                                                placeholder="Select token to sell..."
                                                disabled={loadingTokens}
                                            />
                                            
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
                                                type="number"
                                                placeholder="e.g., 1000"
                                                style={styles.input}
                                                value={newAssetTokenAmount}
                                                onChange={(e) => setNewAssetTokenAmount(e.target.value)}
                                            />
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
                    <div style={styles.card}>
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
                                </div>
                            </div>
                            <div style={styles.reviewSection}>
                                <div style={styles.reviewLabel}>Buyout Price</div>
                                <div style={styles.reviewValue}>
                                    {buyoutPrice ? `${buyoutPrice} ${priceTokenSymbol}` : 'Not set'}
                                </div>
                            </div>
                        </div>
                        
                        <div style={styles.reviewSection}>
                            <div style={styles.reviewLabel}>Expiration</div>
                            <div style={styles.reviewValue}>
                                {hasExpiration ? `${expirationDays} days from activation` : 'No expiration'}
                            </div>
                        </div>
                        
                        {minBidIncrementMultiple && (
                            <div style={styles.reviewSection}>
                                <div style={styles.reviewLabel}>Min Bid Increment</div>
                                <div style={styles.reviewValue}>
                                    {minBidIncrementMultiple}× fee
                                    {selectedPriceToken && (
                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                            ({(parseInt(minBidIncrementMultiple) * Number(selectedPriceToken.fee) / Math.pow(10, Number(selectedPriceToken.decimals))).toFixed(4)} {selectedPriceToken.symbol})
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                        
                        {marketplaceFeeRate !== null && marketplaceFeeRate > 0 && (
                            <div style={styles.reviewSection}>
                                <div style={styles.reviewLabel}>Sneedex Cut</div>
                                <div style={{ ...styles.reviewValue, color: theme.colors.warning }}>
                                    {formatFeeRate(marketplaceFeeRate)}
                                    <span style={{ color: theme.colors.mutedText, marginLeft: '8px', fontWeight: 'normal' }}>
                                        (taken from the winning bid when the sale completes)
                                    </span>
                                </div>
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
                                                        <div style={styles.assetType}>{asset.display}</div>
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
                                                            <FaExclamationTriangle /> {verification.message || 'Manual escrow needed'}
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
                                                                <span style={{ color: theme.colors.mutedText, minWidth: '100px' }}>Canister ID:</span>
                                                                <PrincipalDisplay 
                                                                    principal={asset.canister_id}
                                                                    short={false}
                                                                    showCopyButton={true}
                                                                />
                                                            </div>
                                                            {asset.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER && (
                                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                                    <span style={{ color: theme.colors.mutedText, minWidth: '100px' }}>Type:</span>
                                                                    <span style={{ color: theme.colors.accent }}>ICP Neuron Manager</span>
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
                                                    {asset.type === 'neuron' && (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                <span style={{ color: theme.colors.mutedText, minWidth: '100px' }}>Governance:</span>
                                                                <PrincipalDisplay 
                                                                    principal={asset.governance_id}
                                                                    short={false}
                                                                    showCopyButton={true}
                                                                />
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                <span style={{ color: theme.colors.mutedText, minWidth: '100px' }}>Neuron ID:</span>
                                                                <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{asset.neuron_id}</span>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {asset.type === 'token' && (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                <span style={{ color: theme.colors.mutedText, minWidth: '100px' }}>Ledger:</span>
                                                                <PrincipalDisplay 
                                                                    principal={asset.ledger_id}
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
                        </div>
                        
                        {/* Show different message based on whether all assets are ready */}
                        {allAssetsReady ? (
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
                        ) : isAdmin ? (
                            <div style={{ 
                                background: `${theme.colors.warning}15`, 
                                border: `1px solid ${theme.colors.warning}`,
                                borderRadius: '10px',
                                padding: '1rem',
                                marginBottom: '1.5rem',
                                fontSize: '0.9rem',
                                color: theme.colors.warning,
                            }}>
                                <strong>⚠️ Some assets need manual escrow.</strong> After creating the offer, you'll need to:
                                <ul style={{ margin: '0.5rem 0 0 1.5rem', padding: 0 }}>
                                    <li>For canisters: Add Sneedex ({SNEEDEX_CANISTER_ID}) as a controller</li>
                                    <li>For neurons: Add Sneedex as a hotkey with full permissions</li>
                                    <li>For tokens: Ensure sufficient balance (amount + fee)</li>
                                </ul>
                                <div style={{ marginTop: '0.5rem', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>
                                    ℹ️ <em>Admin mode: You can create the offer anyway and escrow assets later.</em>
                                </div>
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
                                    <li>For canisters: You must be a controller</li>
                                    <li>For neurons: You must have a hotkey with ManagePrincipals permission</li>
                                    <li>For tokens: You must have sufficient balance (amount + fee)</li>
                                </ul>
                            </div>
                        )}
                        
                        <div style={styles.buttonRow}>
                            <button style={styles.backBtn} onClick={handleBack}>
                                ← Back
                            </button>
                            <button
                                style={{
                                    ...styles.createBtn,
                                    ...((!allAssetsReady && !isAdmin) ? {
                                        opacity: 0.5,
                                        cursor: 'not-allowed',
                                    } : {})
                                }}
                                onClick={handleCreate}
                                disabled={creating || (!allAssetsReady && !isAdmin)}
                                onMouseEnter={(e) => {
                                    if (!creating && (allAssetsReady || isAdmin)) {
                                        e.target.style.transform = 'translateY(-2px)';
                                        e.target.style.boxShadow = `0 8px 25px ${theme.colors.success}40`;
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.transform = 'translateY(0)';
                                    e.target.style.boxShadow = 'none';
                                }}
                            >
                                {creating ? 'Creating...' : '🚀 Create Offer'}
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
                                            <li>Canisters: Add <code style={{ background: theme.colors.tertiaryBg, padding: '2px 6px', borderRadius: '4px' }}>{SNEEDEX_CANISTER_ID}</code> as a controller</li>
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
            </main>
        </div>
    );
}

export default SneedexCreate;
