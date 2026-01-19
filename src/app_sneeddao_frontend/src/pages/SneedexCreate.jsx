import React, { useState, useEffect, useCallback } from 'react';
import Header from '../components/Header';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import { FaArrowLeft, FaPlus, FaTrash, FaCubes, FaBrain, FaCoins, FaCheck, FaExclamationTriangle, FaServer, FaRobot, FaWallet, FaSync } from 'react-icons/fa';
import { Principal } from '@dfinity/principal';
import { HttpAgent, Actor } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { 
    createSneedexActor, 
    parseAmount, 
    daysToExpirationNs,
    createAssetVariant,
    getErrorMessage,
    SNEEDEX_CANISTER_ID 
} from '../utils/SneedexUtils';
import { getCanisterGroups, convertGroupsFromBackend } from '../utils/BackendUtils';
import TokenSelector from '../components/TokenSelector';
import { createActor as createBackendActor } from 'declarations/app_sneeddao_backend';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneed_icp_neuron_manager_factory';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createGovernanceActor } from 'external/sns_governance';

const backendCanisterId = process.env.CANISTER_ID_APP_SNEEDDAO_BACKEND || process.env.REACT_APP_BACKEND_CANISTER_ID;
const getHost = () => process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943';
const MANAGEMENT_CANISTER_ID = 'aaaaa-aa';

// Management canister IDL for canister_status
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
    return IDL.Service({
        'canister_status': IDL.Func(
            [IDL.Record({ 'canister_id': IDL.Principal })],
            [canister_status_result],
            []
        ),
    });
};

function SneedexCreate() {
    const { identity, isAuthenticated } = useAuth();
    const { theme } = useTheme();
    const { principalNames } = useNaming();
    const navigate = useNavigate();
    
    // Offer settings
    const [minBidPrice, setMinBidPrice] = useState('');
    const [buyoutPrice, setBuyoutPrice] = useState('');
    const [hasExpiration, setHasExpiration] = useState(true);
    const [expirationDays, setExpirationDays] = useState('7');
    const [priceTokenLedger, setPriceTokenLedger] = useState('ryjl3-tyaaa-aaaaa-aaaba-cai'); // ICP default
    
    // Token metadata from backend
    const [whitelistedTokens, setWhitelistedTokens] = useState([]);
    const [loadingTokens, setLoadingTokens] = useState(true);
    
    // User's registered canisters and neuron managers
    const [userCanisters, setUserCanisters] = useState([]); // Array of canister ID strings
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
    
    // Helper to get canister display name
    const getCanisterName = useCallback((canisterId) => {
        const name = principalNames?.get(canisterId);
        if (name) return name;
        return canisterId.slice(0, 10) + '...' + canisterId.slice(-5);
    }, [principalNames]);
    
    // Assets
    const [assets, setAssets] = useState([]);
    const [assetVerification, setAssetVerification] = useState({}); // {assetKey: {verified: bool, checking: bool, message: string}}
    const [showAddAsset, setShowAddAsset] = useState(false);
    const [newAssetType, setNewAssetType] = useState('canister');
    const [newAssetCanisterId, setNewAssetCanisterId] = useState('');
    const [newAssetGovernanceId, setNewAssetGovernanceId] = useState('');
    const [newAssetNeuronId, setNewAssetNeuronId] = useState('');
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
                    // Check for key permissions (Vote, ManageVotingPermission, etc.)
                    const hasVote = userPerms.permission_type.some(p => 'Vote' in p);
                    const hasManageVoting = userPerms.permission_type.some(p => 'ManageVotingPermission' in p);
                    
                    if (hasVote && hasManageVoting) {
                        return { verified: true, message: 'Has hotkey permissions' };
                    } else {
                        return { verified: false, message: 'Missing some permissions' };
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
                asset = { 
                    type: 'canister', 
                    canister_id: newAssetCanisterId.trim(),
                    display: `Canister: ${newAssetCanisterId.trim().slice(0, 10)}...`
                };
            } else if (newAssetType === 'neuron') {
                if (!newAssetGovernanceId.trim() || !newAssetNeuronId.trim()) {
                    setError('Please enter governance canister ID and neuron ID');
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
        
        // Check for duplicates
        if (assetExists(asset)) {
            setError('This asset has already been added to the offer');
            return;
        }
        
        setAssets([...assets, asset]);
        setShowAddAsset(false);
        setNewAssetCanisterId('');
        setNewAssetGovernanceId('');
        setNewAssetNeuronId('');
        setNewAssetTokenLedger('');
        setNewAssetTokenAmount('');
        setNewAssetTokenSymbol('');
        setNewAssetTokenBalance(null);
    };
    
    const removeAsset = (index) => {
        setAssets(assets.filter((_, i) => i !== index));
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
        
        try {
            const actor = createSneedexActor(identity);
            
            // Step 1: Create the offer
            const createRequest = {
                price_token_ledger: Principal.fromText(priceTokenLedger),
                min_bid_price: minBidPrice ? [parseAmount(minBidPrice, priceTokenDecimals)] : [],
                buyout_price: buyoutPrice ? [parseAmount(buyoutPrice, priceTokenDecimals)] : [],
                expiration: hasExpiration ? [daysToExpirationNs(parseInt(expirationDays))] : [],
            };
            
            const createResult = await actor.createOffer(createRequest);
            
            if ('err' in createResult) {
                throw new Error(getErrorMessage(createResult.err));
            }
            
            const offerId = createResult.ok;
            setCreatedOfferId(offerId);
            
            // Step 2: Add assets to the offer
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
            
            // Show success and next steps
            setStep(4); // Success step
            
        } catch (e) {
            console.error('Failed to create offer:', e);
            setError(e.message || 'Failed to create offer');
        } finally {
            setCreating(false);
        }
    };
    
    const getAssetIcon = (type) => {
        switch (type) {
            case 'canister': return <FaCubes style={{ color: theme.colors.accent }} />;
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
                                                {getAssetIcon(asset.type)}
                                                <div style={styles.assetDetails}>
                                                    <div style={styles.assetType}>
                                                        {asset.type === 'canister' && 'Canister'}
                                                        {asset.type === 'neuron' && 'SNS Neuron'}
                                                        {asset.type === 'token' && `${asset.amount} ${asset.symbol}`}
                                                    </div>
                                                    <div style={styles.assetId}>
                                                        {asset.type === 'canister' && asset.canister_id}
                                                        {asset.type === 'neuron' && `${asset.governance_id.slice(0, 10)}... / ${asset.neuron_id.slice(0, 10)}...`}
                                                        {asset.type === 'token' && asset.ledger_id}
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
                                                    style={styles.removeButton}
                                                    onClick={() => removeAsset(idx)}
                                                    onMouseEnter={(e) => e.target.style.background = `${theme.colors.error || '#ff4444'}20`}
                                                    onMouseLeave={(e) => e.target.style.background = 'transparent'}
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
                                <div style={styles.formGroup}>
                                    <label style={styles.label}>Asset Type</label>
                                    <select
                                        style={styles.select}
                                        value={newAssetType}
                                        onChange={(e) => setNewAssetType(e.target.value)}
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
                                        ) : (userCanisters.length > 0 || neuronManagers.length > 0) ? (
                                            <>
                                                <select
                                                    style={{
                                                        ...styles.input,
                                                        cursor: 'pointer',
                                                    }}
                                                    value={newAssetCanisterId}
                                                    onChange={(e) => setNewAssetCanisterId(e.target.value)}
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
                                    </div>
                                )}
                                
                                {newAssetType === 'neuron' && (
                                    <>
                                        <div style={styles.formGroup}>
                                            <label style={styles.label}>SNS Governance Canister ID</label>
                                            <input
                                                type="text"
                                                placeholder="e.g., fi3zi-fyaaa-aaaaq-aachq-cai"
                                                style={styles.input}
                                                value={newAssetGovernanceId}
                                                onChange={(e) => setNewAssetGovernanceId(e.target.value)}
                                            />
                                        </div>
                                        <div style={styles.formGroup}>
                                            <label style={styles.label}>Neuron ID (hex)</label>
                                            <input
                                                type="text"
                                                placeholder="Neuron ID in hex format"
                                                style={styles.input}
                                                value={newAssetNeuronId}
                                                onChange={(e) => setNewAssetNeuronId(e.target.value)}
                                            />
                                        </div>
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
                                        onClick={() => setShowAddAsset(false)}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        style={styles.nextBtn}
                                        onClick={addAsset}
                                    >
                                        Add Asset
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
                        
                        <div style={styles.reviewSection}>
                            <div style={styles.reviewLabel}>Assets ({assets.length})</div>
                            <div style={styles.assetsList}>
                                {assets.map((asset, idx) => (
                                    <div key={idx} style={{ ...styles.assetItem, background: theme.colors.secondaryBg }}>
                                        <div style={styles.assetInfo}>
                                            {getAssetIcon(asset.type)}
                                            <div style={styles.assetDetails}>
                                                <div style={styles.assetType}>{asset.display}</div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        
                        <div style={{ 
                            background: `${theme.colors.warning}15`, 
                            border: `1px solid ${theme.colors.warning}`,
                            borderRadius: '10px',
                            padding: '1rem',
                            marginBottom: '1.5rem',
                            fontSize: '0.9rem',
                            color: theme.colors.warning,
                        }}>
                            <strong>⚠️ Important:</strong> After creating the offer, you'll need to escrow each asset:
                            <ul style={{ margin: '0.5rem 0 0 1.5rem', padding: 0 }}>
                                <li>For canisters: Add Sneedex ({SNEEDEX_CANISTER_ID}) as a controller first</li>
                                <li>For neurons: Add Sneedex as a hotkey with full permissions</li>
                                <li>For tokens: Send tokens to the escrow subaccount</li>
                            </ul>
                        </div>
                        
                        <div style={styles.buttonRow}>
                            <button style={styles.backBtn} onClick={handleBack}>
                                ← Back
                            </button>
                            <button
                                style={styles.createBtn}
                                onClick={handleCreate}
                                disabled={creating}
                                onMouseEnter={(e) => {
                                    e.target.style.transform = 'translateY(-2px)';
                                    e.target.style.boxShadow = `0 8px 25px ${theme.colors.success}40`;
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
                        <h2 style={styles.successTitle}>Offer Created Successfully!</h2>
                        <p style={styles.successText}>
                            Your offer (ID: {Number(createdOfferId)}) has been created and is now in <strong>Draft</strong> state.
                        </p>
                        
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
            </main>
        </div>
    );
}

export default SneedexCreate;
