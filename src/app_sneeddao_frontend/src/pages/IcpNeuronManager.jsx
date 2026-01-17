import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { HttpAgent, Actor } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { sha224 } from '@dfinity/principal/lib/esm/utils/sha224';
import { createActor as createManagerActor } from 'declarations/sneed_icp_neuron_manager';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneed_icp_neuron_manager_factory';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createCmcActor, CMC_CANISTER_ID } from 'external/cmc';
import Header from '../components/Header';
import TokenSelector from '../components/TokenSelector';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { useNaming } from '../NamingContext';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { setPrincipalNickname, setPrincipalNameFor } from '../utils/BackendUtils';
import { FaGasPump } from 'react-icons/fa';
import { uint8ArrayToHex } from '../utils/NeuronUtils';

const ICP_LEDGER_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const NNS_GOVERNANCE_CANISTER_ID = 'rrkah-fqaaa-aaaaa-aaaaq-cai';
const MANAGEMENT_CANISTER_ID = Principal.fromText('aaaaa-aa');
const E8S = 100_000_000;
const ICP_FEE = 10_000; // 0.0001 ICP

// CMC memo for top-up operation: "TPUP" = 0x50555054
const TOP_UP_MEMO = new Uint8Array([0x54, 0x50, 0x55, 0x50, 0x00, 0x00, 0x00, 0x00]);

// Management canister IDL factory
const managementCanisterIdlFactory = ({ IDL }) => {
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
        'query_stats': IDL.Record({
            'num_calls_total': IDL.Nat,
            'num_instructions_total': IDL.Nat,
            'request_payload_bytes_total': IDL.Nat,
            'response_payload_bytes_total': IDL.Nat,
        }),
        'reserved_cycles': IDL.Nat,
    });
    // Settings for update_settings - all fields are optional
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
    // install_code mode for upgrades
    const install_code_mode = IDL.Variant({
        'install': IDL.Null,
        'reinstall': IDL.Null,
        'upgrade': IDL.Null,
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
        'install_code': IDL.Func(
            [IDL.Record({
                'mode': install_code_mode,
                'canister_id': IDL.Principal,
                'wasm_module': IDL.Vec(IDL.Nat8),
                'arg': IDL.Vec(IDL.Nat8),
            })],
            [],
            []
        ),
    });
};

// NNS Governance Topics (matching official NNS GUI)
// Note: "All Except Governance, and SNS & Neurons' Fund" in NNS GUI is a convenience - 
// it sets following for all topics except the critical ones (4 and 12)
const NNS_TOPICS = [
    { id: 0, name: 'All Topics (Catch-all)', description: 'Default following for all topics without specific followees set', isCritical: false },
    { id: 1, name: 'Neuron Management', description: 'Proposals about neuron-related changes', isCritical: false },
    { id: 2, name: 'Exchange Rate', description: 'Exchange rate oracle updates', isCritical: false },
    { id: 3, name: 'Network Economics', description: 'ICP tokenomics, rewards, etc.', isCritical: false },
    { id: 4, name: 'Governance', description: 'Changes to the governance system itself (critical topic)', isCritical: true },
    { id: 5, name: 'Node Admin', description: 'Node operator management', isCritical: false },
    { id: 6, name: 'Participant Management', description: 'Managing participants in the network', isCritical: false },
    { id: 7, name: 'Subnet Management', description: 'Creating/managing subnets', isCritical: false },
    { id: 8, name: 'Network Canister Management', description: 'NNS canister upgrades', isCritical: false },
    { id: 9, name: 'KYC', description: 'Know Your Customer related', isCritical: false },
    { id: 10, name: 'Node Provider Rewards', description: 'Rewards for node providers', isCritical: false },
    { id: 12, name: 'SNS & Neurons\' Fund', description: 'SNS launches and community fund (critical topic)', isCritical: true },
    { id: 13, name: 'Subnet Rental', description: 'Subnet rental requests', isCritical: false },
    { id: 14, name: 'Protocol Canister Management', description: 'Protocol-level canister management', isCritical: false },
    { id: 15, name: 'Service Nervous System Management', description: 'SNS governance management', isCritical: false },
    { id: 16, name: 'IC OS Version Election', description: 'Electing new IC-OS versions', isCritical: false },
    { id: 17, name: 'IC OS Version Deployment', description: 'Deploying IC-OS versions to subnets', isCritical: false },
    { id: 18, name: 'API Boundary Node Management', description: 'Managing API boundary nodes', isCritical: false },
    { id: 19, name: 'Application Canister Management', description: 'Managing application-level canisters', isCritical: false },
];

// Fallback known neurons (used if governance fetch fails)
const KNOWN_NEURONS_FALLBACK = {
    '27': 'DFINITY Foundation',
    '28': 'Internet Computer Association',
};

function IcpNeuronManager() {
    const { canisterId } = useParams();
    const navigate = useNavigate();
    const { theme } = useTheme();
    const { identity, isAuthenticated, login } = useAuth();
    const { principalNames, principalNicknames, fetchAllNames } = useNaming();
    
    // Get display info for the canister
    const displayInfo = getPrincipalDisplayInfoFromContext(canisterId, principalNames, principalNicknames);
    
    // Naming state
    const [showNamingSection, setShowNamingSection] = useState(false);
    const [nicknameInput, setNicknameInput] = useState('');
    const [publicNameInput, setPublicNameInput] = useState('');
    const [savingNickname, setSavingNickname] = useState(false);
    const [savingPublicName, setSavingPublicName] = useState(false);
    const [namingError, setNamingError] = useState('');
    const [namingSuccess, setNamingSuccess] = useState('');
    
    // Manager state
    const [managerInfo, setManagerInfo] = useState(null);
    const [neuronIds, setNeuronIds] = useState([]); // Array of neuron IDs
    const [selectedNeuronId, setSelectedNeuronId] = useState(null); // Currently selected neuron
    const [neuronInfo, setNeuronInfo] = useState(null);
    const [fullNeuron, setFullNeuron] = useState(null);
    
    
    // UI state
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [actionLoading, setActionLoading] = useState('');
    
    // Form state
    const [stakeAmount, setStakeAmount] = useState('1');
    const [stakeDissolveDelay, setStakeDissolveDelay] = useState('365'); // Default 1 year for new neurons
    const [dissolveDelay, setDissolveDelay] = useState('');
    const [hotKeyPrincipal, setHotKeyPrincipal] = useState('');
    const [disburseAmount, setDisburseAmount] = useState('');
    const [disburseToAccount, setDisburseToAccount] = useState('');
    const [selectedTopic, setSelectedTopic] = useState(0);
    const [followeeIds, setFolloweeIds] = useState('');
    const [increaseStakeAmount, setIncreaseStakeAmount] = useState('');
    const [maturityPercentage, setMaturityPercentage] = useState('100');
    const [spawnController, setSpawnController] = useState('');
    const [disburseMaturityDestination, setDisburseMaturityDestination] = useState('');
    const [splitAmount, setSplitAmount] = useState('');
    const [mergeSourceNeuronId, setMergeSourceNeuronId] = useState('');
    const [withdrawAmount, setWithdrawAmount] = useState('');
    const [withdrawDestination, setWithdrawDestination] = useState('');
    const [withdrawTokenLedger, setWithdrawTokenLedger] = useState(ICP_LEDGER_CANISTER_ID);
    const [withdrawTokenBalance, setWithdrawTokenBalance] = useState(null);
    const [withdrawTokenSymbol, setWithdrawTokenSymbol] = useState('ICP');
    const [withdrawTokenDecimals, setWithdrawTokenDecimals] = useState(8);
    const [withdrawTokenFee, setWithdrawTokenFee] = useState(10000);
    const [customLedgerInput, setCustomLedgerInput] = useState('');
    const [useCustomLedger, setUseCustomLedger] = useState(false);
    const [withdrawSectionExpanded, setWithdrawSectionExpanded] = useState(false);
    const [userIcpBalance, setUserIcpBalance] = useState(null);
    
    // Canister status state
    const [canisterStatus, setCanisterStatus] = useState(null);
    const [controllers, setControllers] = useState([]);
    
    // Official version verification
    const [officialVersions, setOfficialVersions] = useState([]);
    const [matchedOfficialVersion, setMatchedOfficialVersion] = useState(null);
    
    // Upgrade state
    const [nextAvailableVersion, setNextAvailableVersion] = useState(null);
    const [latestOfficialVersion, setLatestOfficialVersion] = useState(null);
    const [upgrading, setUpgrading] = useState(false);
    const [upgradeMode, setUpgradeMode] = useState('upgrade'); // 'upgrade' or 'reinstall'
    const [upgradeError, setUpgradeError] = useState(null);
    const [upgradeSuccess, setUpgradeSuccess] = useState(null);
    
    // Controller management state
    const [newControllerInput, setNewControllerInput] = useState('');
    const [updatingControllers, setUpdatingControllers] = useState(false);
    const [confirmRemoveController, setConfirmRemoveController] = useState(null);
    const [controllerSuccess, setControllerSuccess] = useState(null);
    
    // Cycles top-up state
    const [topUpAmount, setTopUpAmount] = useState('');
    const [conversionRate, setConversionRate] = useState(null);
    const [showTopUpSection, setShowTopUpSection] = useState(false);
    const [toppingUp, setToppingUp] = useState(false);
    
    // Tabs
    const [activeTab, setActiveTab] = useState('overview');
    
    // Known neurons (fetched from governance)
    const [knownNeurons, setKnownNeurons] = useState(KNOWN_NEURONS_FALLBACK);
    
    // Collapsible section states
    const [canisterSectionExpanded, setCanisterSectionExpanded] = useState(true);
    const [neuronSectionExpanded, setNeuronSectionExpanded] = useState(true);

    // Check if current user is a controller
    const isController = identity && controllers.length > 0 && 
        controllers.some(c => c.toString() === identity.getPrincipal().toString());

    const getAgent = useCallback(() => {
        const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
            ? 'https://ic0.app' 
            : 'http://localhost:4943';
        return new HttpAgent({ identity, host });
    }, [identity]);

    // Fetch known neurons from NNS governance (always from mainnet)
    const fetchKnownNeurons = useCallback(async () => {
        try {
            // Always use mainnet for known neurons (they don't exist on local replica)
            const mainnetAgent = new HttpAgent({ host: 'https://ic0.app' });
            
            // Dynamic import for Actor
            const { Actor } = await import('@dfinity/agent');
            const { IDL } = await import('@dfinity/candid');
            
            // Minimal IDL for list_known_neurons
            const idlFactory = ({ IDL }) => {
                const NeuronId = IDL.Record({ id: IDL.Nat64 });
                const KnownNeuronData = IDL.Record({
                    name: IDL.Text,
                    description: IDL.Opt(IDL.Text),
                });
                const KnownNeuron = IDL.Record({
                    id: IDL.Opt(NeuronId),
                    known_neuron_data: IDL.Opt(KnownNeuronData),
                });
                const ListKnownNeuronsResponse = IDL.Record({
                    known_neurons: IDL.Vec(KnownNeuron),
                });
                return IDL.Service({
                    list_known_neurons: IDL.Func([], [ListKnownNeuronsResponse], ['query']),
                });
            };
            
            const governance = Actor.createActor(idlFactory, {
                agent: mainnetAgent,
                canisterId: NNS_GOVERNANCE_CANISTER_ID,
            });
            
            const result = await governance.list_known_neurons();
            
            // Build lookup map
            const neuronsMap = {};
            for (const neuron of result.known_neurons) {
                // Handle optional fields (Candid optionals are arrays in JS)
                const neuronId = Array.isArray(neuron.id) ? neuron.id[0] : neuron.id;
                const neuronData = Array.isArray(neuron.known_neuron_data) ? neuron.known_neuron_data[0] : neuron.known_neuron_data;
                
                if (neuronId && neuronData && neuronData.name) {
                    const id = neuronId.id.toString();
                    neuronsMap[id] = neuronData.name;
                }
            }
            
            // Merge with fallback
            setKnownNeurons({ ...KNOWN_NEURONS_FALLBACK, ...neuronsMap });
            console.log(`Loaded ${Object.keys(neuronsMap).length} known neurons from NNS governance`);
        } catch (err) {
            console.error('Failed to fetch known neurons, using fallback:', err);
            // Keep fallback values
        }
    }, []);

    // Helper to get neuron name
    const getNeuronName = useCallback((neuronId) => {
        const idStr = neuronId.toString();
        return knownNeurons[idStr] || null;
    }, [knownNeurons]);

    // Format neuron ID with name if known
    const formatNeuronId = useCallback((neuronId) => {
        const name = getNeuronName(neuronId);
        return name ? `${name} (${neuronId})` : neuronId.toString();
    }, [getNeuronName]);

    const fetchManagerData = useCallback(async () => {
        if (!canisterId) return;
        
        setLoading(true);
        setError('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const manager = createManagerActor(canisterId, { agent });
            
            // Fetch basic info
            const [version, neuronIdsResult, accountId] = await Promise.all([
                manager.getVersion(),
                manager.getNeuronIds(),
                manager.getAccountId(),
            ]);
            
            setManagerInfo({
                canisterId,
                version: `${Number(version.major)}.${Number(version.minor)}.${Number(version.patch)}`,
                accountId: Array.from(accountId).map(b => b.toString(16).padStart(2, '0')).join(''),
            });
            
            // Set neuron IDs
            const neurons = neuronIdsResult || [];
            setNeuronIds(neurons);
            
            // Select first neuron if exists and none selected
            if (neurons.length > 0) {
                const firstNeuron = neurons[0];
                setSelectedNeuronId(prev => prev || firstNeuron);
                // Fetch info for selected neuron
                fetchNeuronInfo(manager, firstNeuron);
            } else {
                setSelectedNeuronId(null);
                setNeuronInfo(null);
                setFullNeuron(null);
            }
            
            // Fetch user ICP balance
            fetchUserBalance(agent);
            
        } catch (err) {
            console.error('Error fetching manager data:', err);
            setError(`Failed to load manager: ${err.message || 'Unknown error'}`);
        } finally {
            setLoading(false);
        }
    }, [canisterId, getAgent, identity]);

    const fetchUserBalance = async (agent) => {
        if (!identity) return;
        try {
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            const balance = await ledger.icrc1_balance_of({
                owner: identity.getPrincipal(),
                subaccount: [],
            });
            setUserIcpBalance(Number(balance));
        } catch (err) {
            console.error('Error fetching user ICP balance:', err);
        }
    };

    // Fetch canister status (cycles and controllers)
    const fetchCanisterStatus = useCallback(async () => {
        if (!canisterId || !identity) return;
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://icp0.io' 
                : 'http://localhost:4943';
            const agent = HttpAgent.createSync({ host, identity });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const canisterPrincipal = Principal.fromText(canisterId);
            const managementCanister = Actor.createActor(managementCanisterIdlFactory, {
                agent,
                canisterId: MANAGEMENT_CANISTER_ID,
                callTransform: (methodName, args, callConfig) => ({
                    ...callConfig,
                    effectiveCanisterId: canisterPrincipal,
                }),
            });
            
            const status = await managementCanister.canister_status({
                canister_id: canisterPrincipal
            });
            
            setCanisterStatus({
                cycles: Number(status.cycles),
                memorySize: Number(status.memory_size),
                status: Object.keys(status.status)[0],
                moduleHash: status.module_hash[0] ? uint8ArrayToHex(status.module_hash[0]) : null,
            });
            setControllers(status.settings.controllers);
            
        } catch (err) {
            console.error('Error fetching canister status:', err);
            // User might not be a controller - that's ok, just don't show the info
            setCanisterStatus(null);
            setControllers([]);
        }
    }, [canisterId, identity]);

    // Fetch official versions from factory
    const fetchOfficialVersions = useCallback(async () => {
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://icp0.io' 
                : 'http://localhost:4943';
            const agent = HttpAgent.createSync({ host });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const factory = createFactoryActor(factoryCanisterId, { agent });
            const versions = await factory.getOfficialVersions();
            setOfficialVersions(versions);
        } catch (err) {
            console.error('Error fetching official versions:', err);
            setOfficialVersions([]);
        }
    }, []);

    // Match canister's module hash against official versions
    useEffect(() => {
        if (!canisterStatus?.moduleHash || officialVersions.length === 0) {
            setMatchedOfficialVersion(null);
            return;
        }
        
        const moduleHashLower = canisterStatus.moduleHash.toLowerCase();
        const matched = officialVersions.find(v => 
            v.wasmHash.toLowerCase() === moduleHashLower
        );
        setMatchedOfficialVersion(matched || null);
    }, [canisterStatus?.moduleHash, officialVersions]);

    // Helper to compare versions
    const compareVersions = (a, b) => {
        const aMajor = Number(a.major), aMinor = Number(a.minor), aPatch = Number(a.patch);
        const bMajor = Number(b.major), bMinor = Number(b.minor), bPatch = Number(b.patch);
        if (aMajor !== bMajor) return aMajor - bMajor;
        if (aMinor !== bMinor) return aMinor - bMinor;
        return aPatch - bPatch;
    };

    // Find the latest official version with a WASM URL
    useEffect(() => {
        if (officialVersions.length === 0) {
            setLatestOfficialVersion(null);
            return;
        }
        
        const versionsWithWasm = officialVersions.filter(v => v.wasmUrl && v.wasmUrl.trim().length > 0);
        if (versionsWithWasm.length === 0) {
            setLatestOfficialVersion(null);
            return;
        }
        
        // Sort descending and get the highest version
        versionsWithWasm.sort((a, b) => compareVersions(b, a));
        setLatestOfficialVersion(versionsWithWasm[0]);
    }, [officialVersions]);

    // Find next available version (higher than current, with a WASM URL)
    useEffect(() => {
        if (!matchedOfficialVersion || officialVersions.length === 0) {
            setNextAvailableVersion(null);
            return;
        }
        
        const currentMajor = Number(matchedOfficialVersion.major);
        const currentMinor = Number(matchedOfficialVersion.minor);
        const currentPatch = Number(matchedOfficialVersion.patch);
        
        // Filter versions that are higher than current and have a wasmUrl
        const higherVersions = officialVersions.filter(v => {
            const vMajor = Number(v.major), vMinor = Number(v.minor), vPatch = Number(v.patch);
            const isHigher = vMajor > currentMajor || 
                (vMajor === currentMajor && vMinor > currentMinor) ||
                (vMajor === currentMajor && vMinor === currentMinor && vPatch > currentPatch);
            return isHigher && v.wasmUrl && v.wasmUrl.trim().length > 0;
        });
        
        if (higherVersions.length === 0) {
            setNextAvailableVersion(null);
            return;
        }
        
        // Sort and get the closest higher version
        higherVersions.sort(compareVersions);
        setNextAvailableVersion(higherVersions[0]);
    }, [matchedOfficialVersion, officialVersions]);

    // Fetch ICP to cycles conversion rate from CMC
    const fetchConversionRate = useCallback(async () => {
        try {
            const host = 'https://ic0.app';
            const agent = HttpAgent.createSync({ host });
            
            const cmc = createCmcActor(CMC_CANISTER_ID, { agent });
            const response = await cmc.get_icp_xdr_conversion_rate();
            
            const xdrPerIcp = Number(response.data.xdr_permyriad_per_icp) / 10000;
            const cyclesPerIcp = xdrPerIcp * 1_000_000_000_000;
            
            setConversionRate({
                xdrPerIcp,
                cyclesPerIcp,
                timestamp: Number(response.data.timestamp_seconds),
            });
        } catch (err) {
            console.error('Error fetching conversion rate:', err);
        }
    }, []);

    // Calculate CMC subaccount for a canister principal
    const principalToSubaccount = (principal) => {
        const bytes = principal.toUint8Array();
        const subaccount = new Uint8Array(32);
        subaccount[0] = bytes.length;
        subaccount.set(bytes, 1);
        return subaccount;
    };

    // Format cycles amount
    const formatCycles = (cycles) => {
        if (cycles >= 1_000_000_000_000) {
            return (cycles / 1_000_000_000_000).toFixed(4) + ' T';
        } else if (cycles >= 1_000_000_000) {
            return (cycles / 1_000_000_000).toFixed(4) + ' B';
        } else if (cycles >= 1_000_000) {
            return (cycles / 1_000_000).toFixed(4) + ' M';
        }
        return cycles.toLocaleString();
    };

    // Calculate estimated cycles from ICP amount
    const estimatedCycles = () => {
        if (!topUpAmount || !conversionRate) return null;
        const icpAmount = parseFloat(topUpAmount);
        if (isNaN(icpAmount) || icpAmount <= 0) return null;
        return icpAmount * conversionRate.cyclesPerIcp;
    };

    // Update controllers on the canister
    const updateControllers = async (newControllers) => {
        if (!identity || !canisterId) return;
        
        setUpdatingControllers(true);
        setError('');
        setControllerSuccess(null);
        
        try {
            const canisterPrincipal = Principal.fromText(canisterId);
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://icp0.io' 
                : 'http://localhost:4943';
            const agent = HttpAgent.createSync({ host, identity });

            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }

            const managementCanister = Actor.createActor(managementCanisterIdlFactory, {
                agent,
                canisterId: MANAGEMENT_CANISTER_ID,
                callTransform: (methodName, args, callConfig) => ({
                    ...callConfig,
                    effectiveCanisterId: canisterPrincipal,
                }),
            });

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

            setControllerSuccess('Controllers updated successfully');
            
            // Refresh canister status
            await fetchCanisterStatus();
            
        } catch (e) {
            console.error('Failed to update controllers:', e);
            setError('Failed to update controllers: ' + (e.message || 'Unknown error'));
        } finally {
            setUpdatingControllers(false);
        }
    };

    // Add a new controller
    const handleAddController = async () => {
        if (!newControllerInput.trim()) return;
        
        try {
            const newControllerPrincipal = Principal.fromText(newControllerInput.trim());
            
            // Check if already a controller
            const isAlreadyController = controllers.some(c => c.toString() === newControllerPrincipal.toString());
            
            if (isAlreadyController) {
                setError('This principal is already a controller');
                return;
            }
            
            // Create new list with the added controller
            const newControllers = [...controllers, newControllerPrincipal];
            
            await updateControllers(newControllers);
            setNewControllerInput('');
            
        } catch (e) {
            setError('Invalid principal ID format');
        }
    };

    // Remove a controller
    const handleRemoveController = async (controllerToRemove) => {
        const controllerStr = controllerToRemove.toString();
        
        // Check if this is the last controller
        if (controllers.length === 1) {
            setError('Cannot remove the last controller - the canister would become permanently uncontrollable');
            setConfirmRemoveController(null);
            return;
        }
        
        // Filter out the controller to remove
        const newControllers = controllers.filter(c => c.toString() !== controllerStr);
        
        await updateControllers(newControllers);
        setConfirmRemoveController(null);
    };

    // Handle one-click upgrade/reinstall to a version
    const handleUpgrade = async (targetVersion, mode = 'upgrade') => {
        if (!identity || !canisterId || !targetVersion || !targetVersion.wasmUrl) {
            return;
        }
        
        setUpgrading(true);
        setUpgradeMode(mode);
        setUpgradeError(null);
        setUpgradeSuccess(null);
        
        try {
            const versionStr = `${Number(targetVersion.major)}.${Number(targetVersion.minor)}.${Number(targetVersion.patch)}`;
            console.log(`Starting ${mode} to v${versionStr}...`);
            
            // Step 1: Fetch the WASM from URL
            console.log(`Fetching WASM from: ${targetVersion.wasmUrl}`);
            const response = await fetch(targetVersion.wasmUrl);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            const wasmModule = new Uint8Array(arrayBuffer);
            
            if (wasmModule.length === 0) {
                throw new Error('Downloaded WASM file is empty');
            }
            
            // Validate WASM magic bytes (0x00 0x61 0x73 0x6D = "\0asm") or gzip (0x1f 0x8b)
            const isWasm = wasmModule[0] === 0x00 && wasmModule[1] === 0x61 && wasmModule[2] === 0x73 && wasmModule[3] === 0x6D;
            const isGzip = wasmModule[0] === 0x1F && wasmModule[1] === 0x8B;
            
            if (!isWasm && !isGzip) {
                throw new Error('Downloaded file does not appear to be a valid WASM module');
            }
            
            console.log(`WASM downloaded: ${(wasmModule.length / 1024).toFixed(2)} KB`);
            
            // Step 2: Call install_code to upgrade
            const canisterPrincipal = Principal.fromText(canisterId);
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://icp0.io' 
                : 'http://localhost:4943';
            const agent = HttpAgent.createSync({ host, identity });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const managementCanister = Actor.createActor(managementCanisterIdlFactory, {
                agent,
                canisterId: MANAGEMENT_CANISTER_ID,
                callTransform: (methodName, args, callConfig) => ({
                    ...callConfig,
                    effectiveCanisterId: canisterPrincipal,
                }),
            });
            
            // Empty Candid args (DIDL header for no arguments)
            const emptyArgs = new Uint8Array([0x44, 0x49, 0x44, 0x4C, 0x00, 0x00]);
            
            console.log(`Calling install_code with mode: ${mode}...`);
            
            // Set the mode based on parameter
            const installMode = mode === 'reinstall' ? { reinstall: null } : { upgrade: null };
            
            await managementCanister.install_code({
                mode: installMode,
                canister_id: canisterPrincipal,
                wasm_module: wasmModule,
                arg: emptyArgs,
            });
            
            console.log(`${mode === 'reinstall' ? 'Reinstall' : 'Upgrade'} successful!`);
            setUpgradeSuccess(`✅ Successfully ${mode === 'reinstall' ? 'reinstalled' : 'upgraded'} to v${versionStr}`);
            
            // Refresh canister status and manager data to show the new version
            await Promise.all([
                fetchCanisterStatus(),
                fetchManagerData(),
            ]);
            
        } catch (err) {
            console.error('Upgrade failed:', err);
            setUpgradeError(`Upgrade failed: ${err.message || 'Unknown error'}`);
        } finally {
            setUpgrading(false);
        }
    };

    // Handle cycles top-up
    const handleCyclesTopUp = async () => {
        if (!identity || !canisterId || !topUpAmount) return;
        
        const icpAmount = parseFloat(topUpAmount);
        if (isNaN(icpAmount) || icpAmount <= 0) {
            setError('Please enter a valid ICP amount');
            return;
        }
        
        const amountE8s = BigInt(Math.floor(icpAmount * E8S));
        const totalNeeded = amountE8s + BigInt(ICP_FEE);
        
        if (userIcpBalance === null || BigInt(userIcpBalance) < totalNeeded) {
            setError(`Insufficient ICP balance. You have ${formatIcp(userIcpBalance)} ICP, need ${(Number(totalNeeded) / E8S).toFixed(4)} ICP (including fee)`);
            return;
        }
        
        setToppingUp(true);
        setError('');
        setSuccess('');
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const canisterPrincipal = Principal.fromText(canisterId);
            const cmcPrincipal = Principal.fromText(CMC_CANISTER_ID);
            
            // Step 1: Transfer ICP to CMC with canister's subaccount and TPUP memo
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            const subaccount = principalToSubaccount(canisterPrincipal);
            
            console.log('Transferring ICP to CMC for cycles top-up...');
            
            const transferResult = await ledger.icrc1_transfer({
                to: {
                    owner: cmcPrincipal,
                    subaccount: [subaccount],
                },
                amount: amountE8s,
                fee: [BigInt(ICP_FEE)],
                memo: [TOP_UP_MEMO],
                from_subaccount: [],
                created_at_time: [],
            });
            
            if ('Err' in transferResult) {
                const err = transferResult.Err;
                if ('InsufficientFunds' in err) {
                    throw new Error(`Insufficient funds: ${formatIcp(Number(err.InsufficientFunds.balance))} ICP available`);
                }
                throw new Error(`Transfer failed: ${JSON.stringify(err)}`);
            }
            
            const blockIndex = transferResult.Ok;
            console.log('Transfer successful, block index:', blockIndex.toString());
            
            // Step 2: Notify CMC to mint cycles
            const cmcHost = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : host;
            const cmcAgent = HttpAgent.createSync({ host: cmcHost, identity });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await cmcAgent.fetchRootKey();
            }
            
            const cmc = createCmcActor(CMC_CANISTER_ID, { agent: cmcAgent });
            
            console.log('Notifying CMC to mint cycles...');
            const notifyResult = await cmc.notify_top_up({
                block_index: blockIndex,
                canister_id: canisterPrincipal,
            });
            
            if ('Err' in notifyResult) {
                const err = notifyResult.Err;
                if ('Refunded' in err) {
                    throw new Error(`Top-up refunded: ${err.Refunded.reason}`);
                } else if ('InvalidTransaction' in err) {
                    throw new Error(`Invalid transaction: ${err.InvalidTransaction}`);
                } else if ('Other' in err) {
                    throw new Error(`CMC error: ${err.Other.error_message}`);
                } else if ('Processing' in err) {
                    throw new Error('Transaction is still being processed. Please try again in a moment.');
                }
                throw new Error(`Unknown CMC error: ${JSON.stringify(err)}`);
            }
            
            const cyclesAdded = Number(notifyResult.Ok);
            setSuccess(`✅ Successfully topped up ${formatCycles(cyclesAdded)} cycles!`);
            setTopUpAmount('');
            setShowTopUpSection(false);
            
            // Refresh data
            fetchCanisterStatus();
            fetchUserBalance(agent);
            
        } catch (err) {
            console.error('Cycles top-up error:', err);
            setError(`Top-up failed: ${err.message || 'Unknown error'}`);
        } finally {
            setToppingUp(false);
        }
    };

    const fetchNeuronInfo = async (manager, neuronId) => {
        if (!neuronId) return;
        
        try {
            const [infoResult, fullResult] = await Promise.all([
                manager.getNeuronInfo(neuronId),
                manager.getFullNeuron(neuronId),
            ]);
            
            // These return optional types directly, not Results
            if (infoResult && infoResult.length > 0) {
                setNeuronInfo(infoResult[0]);
            } else {
                setNeuronInfo(null);
            }
            if (fullResult && fullResult.length > 0) {
                setFullNeuron(fullResult[0]);
            } else {
                setFullNeuron(null);
            }
        } catch (err) {
            console.error('Error fetching neuron info:', err);
        }
    };
    
    // Handle neuron selection change
    const handleNeuronSelect = async (neuronId) => {
        setSelectedNeuronId(neuronId);
        setNeuronInfo(null);
        setFullNeuron(null);
        
        if (neuronId) {
            try {
                const agent = getAgent();
                if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                    await agent.fetchRootKey();
                }
                const manager = createManagerActor(canisterId, { agent });
                await fetchNeuronInfo(manager, neuronId);
            } catch (err) {
                console.error('Error fetching selected neuron:', err);
            }
        }
    };

    useEffect(() => {
        if (isAuthenticated && identity && canisterId) {
            fetchManagerData();
            fetchKnownNeurons(); // Fetch known neurons for displaying names
            fetchCanisterStatus(); // Fetch cycles and controllers
            fetchConversionRate(); // Fetch ICP to cycles conversion rate
        }
        // Fetch official versions regardless of auth (public data)
        fetchOfficialVersions();
    }, [isAuthenticated, identity, canisterId, fetchManagerData, fetchKnownNeurons, fetchCanisterStatus, fetchConversionRate, fetchOfficialVersions]);

    // Action handlers
    const handleStakeNeuron = async () => {
        if (!stakeAmount || parseFloat(stakeAmount) < 1) {
            setError('Minimum stake is 1 ICP');
            return;
        }
        
        const delayDays = parseInt(stakeDissolveDelay);
        //if (!delayDays || delayDays < 183) {
        //    setError('Minimum dissolve delay is 183 days (~6 months) to vote');
        //    return;
        //}
        //if (delayDays > 2922) {
        //    setError('Maximum dissolve delay is 2922 days (8 years)');
        //    return;
        //}
        
        setActionLoading('stake');
        setError('');
        setSuccess('');
        
        const amountE8s = BigInt(Math.floor(parseFloat(stakeAmount) * E8S));
        const fee = BigInt(10000); // 0.0001 ICP fee
        
        // Check user has enough balance
        if (userIcpBalance === null || BigInt(userIcpBalance) < amountE8s + fee) {
            setError(`Insufficient balance. You have ${formatIcp(userIcpBalance)} ICP, need ${parseFloat(stakeAmount) + 0.0001} ICP (including fee)`);
            setActionLoading('');
            return;
        }
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            
            // Step 1: Generate memo and get stake account
            const memo = await manager.generateMemo();
            const stakeInfo = await manager.getStakeAccount(memo);
            
            // Step 2: Transfer ICP directly to governance canister's neuron subaccount
            setSuccess('📤 Sending ICP to NNS Governance...');
            const transferResult = await ledger.icrc1_transfer({
                to: {
                    owner: stakeInfo.account.owner,
                    subaccount: stakeInfo.account.subaccount,
                },
                amount: amountE8s,
                fee: [fee],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
            });
            
            if ('Err' in transferResult) {
                const err = transferResult.Err;
                if ('InsufficientFunds' in err) {
                    throw new Error(`Insufficient funds: ${formatIcp(Number(err.InsufficientFunds.balance))} ICP available`);
                }
                throw new Error(`Transfer failed: ${JSON.stringify(err)}`);
            }
            
            // Step 3: Claim the neuron from the deposit
            setSuccess('🧠 Claiming neuron from deposit...');
            const dissolveDelaySeconds = BigInt(delayDays * 24 * 60 * 60);
            const result = await manager.claimNeuronFromDeposit(memo, dissolveDelaySeconds);
            
            if ('Ok' in result) {
                setSuccess(`🎉 Neuron created! ID: ${result.Ok.id.toString()}`);
                setSelectedNeuronId(result.Ok);
                fetchManagerData();
                fetchUserBalance(agent); // Refresh user balance
            } else {
                const err = result.Err;
                if ('GovernanceError' in err) {
                    setError(`Governance error: ${err.GovernanceError.error_message}`);
                } else if ('InvalidDissolveDelay' in err) {
                    const d = err.InvalidDissolveDelay;
                    setError(`Invalid dissolve delay: min ${Math.floor(Number(d.min) / 86400)} days, max ${Math.floor(Number(d.max) / 86400)} days`);
                } else {
                    setError('Failed to claim neuron');
                }
            }
        } catch (err) {
            console.error('Error staking neuron:', err);
            setError(`Error: ${err.message || 'Failed to stake neuron'}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleSetDissolveDelay = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        if (!dissolveDelay || parseInt(dissolveDelay) < 1) {
            setError('Please enter a valid dissolve delay in days');
            return;
        }
        
        setActionLoading('dissolve');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            // setDissolveDelay takes Nat32 (additional seconds to add)
            const delaySeconds = parseInt(dissolveDelay) * 24 * 60 * 60;
            const result = await manager.setDissolveDelay(selectedNeuronId, delaySeconds);
            
            if ('Ok' in result) {
                setSuccess(`✅ Added ${dissolveDelay} days to dissolve delay`);
                setDissolveDelay('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error setting dissolve delay:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleStartDissolving = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        
        setActionLoading('startDissolve');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const result = await manager.startDissolving(selectedNeuronId);
            
            if ('Ok' in result) {
                setSuccess('✅ Neuron is now dissolving');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error starting dissolve:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleStopDissolving = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        
        setActionLoading('stopDissolve');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const result = await manager.stopDissolving(selectedNeuronId);
            
            if ('Ok' in result) {
                setSuccess('✅ Neuron stopped dissolving');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error stopping dissolve:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleAddHotKey = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        if (!hotKeyPrincipal) {
            setError('Please enter a principal ID');
            return;
        }
        
        setActionLoading('addHotKey');
        setError('');
        setSuccess('');
        
        try {
            const principal = Principal.fromText(hotKeyPrincipal);
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const result = await manager.addHotKey(selectedNeuronId, principal);
            
            if ('Ok' in result) {
                setSuccess(`✅ Hot key added: ${hotKeyPrincipal}`);
                setHotKeyPrincipal('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error adding hot key:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleRemoveHotKey = async (principal) => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        
        setActionLoading('removeHotKey');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const result = await manager.removeHotKey(selectedNeuronId, principal);
            
            if ('Ok' in result) {
                setSuccess(`✅ Hot key removed`);
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error removing hot key:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleDisburse = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        
        setActionLoading('disburse');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            // Amount: null means disburse all
            const amountOpt = disburseAmount ? [BigInt(Math.floor(parseFloat(disburseAmount) * E8S))] : [];
            
            // Destination: null means send to controller (this canister)
            // If provided, convert hex string to Uint8Array
            let toAccountOpt = [];
            if (disburseToAccount && disburseToAccount.length === 64) {
                const bytes = [];
                for (let i = 0; i < 64; i += 2) {
                    bytes.push(parseInt(disburseToAccount.substr(i, 2), 16));
                }
                toAccountOpt = [bytes];
            }
            
            const result = await manager.disburse(selectedNeuronId, amountOpt, toAccountOpt);
            
            if ('Ok' in result) {
                setSuccess(`✅ Disbursed! Block height: ${result.Ok.transfer_block_height.toString()}`);
                setDisburseAmount('');
                setDisburseToAccount('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error disbursing:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleSetFollowing = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        
        setActionLoading('following');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            // Parse followee IDs (comma-separated)
            const followees = followeeIds
                .split(',')
                .map(s => s.trim())
                .filter(s => s.length > 0)
                .map(id => ({ id: BigInt(id) }));
            
            const result = await manager.setFollowing(selectedNeuronId, selectedTopic, followees);
            
            if ('Ok' in result) {
                const topicName = NNS_TOPICS.find(t => t.id === selectedTopic)?.name || `Topic ${selectedTopic}`;
                if (followees.length === 0) {
                    setSuccess(`✅ Cleared following for ${topicName}`);
                } else {
                    setSuccess(`✅ Now following ${followees.length} neuron(s) for ${topicName}`);
                }
                setFolloweeIds('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error setting following:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleConfirmFollowing = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        
        setActionLoading('confirmFollowing');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            const result = await manager.confirmFollowing(selectedNeuronId);
            
            if ('Ok' in result) {
                setSuccess('✅ Following confirmed! Your neuron is now active for automatic voting.');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error confirming following:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleIncreaseStake = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        if (!increaseStakeAmount || parseFloat(increaseStakeAmount) <= 0) {
            setError('Please enter a valid amount');
            return;
        }
        
        const amountE8s = BigInt(Math.floor(parseFloat(increaseStakeAmount) * E8S));
        const fee = BigInt(10000); // 0.0001 ICP fee
        
        // Check user has enough balance
        if (userIcpBalance === null || BigInt(userIcpBalance) < amountE8s + fee) {
            setError(`Insufficient balance. You have ${formatIcp(userIcpBalance)} ICP, need ${parseFloat(increaseStakeAmount) + 0.0001} ICP (including fee)`);
            return;
        }
        
        setActionLoading('increaseStake');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            
            // Step 1: Get the neuron's account
            const neuronAccount = await manager.getNeuronAccount(selectedNeuronId);
            if (!neuronAccount || neuronAccount.length === 0) {
                throw new Error('Could not get neuron account');
            }
            const account = neuronAccount[0];
            
            // Step 2: Transfer ICP directly to the neuron's account
            setSuccess('📤 Sending ICP to neuron...');
            const transferResult = await ledger.icrc1_transfer({
                to: {
                    owner: account.owner,
                    subaccount: account.subaccount,
                },
                amount: amountE8s,
                fee: [fee],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
            });
            
            if ('Err' in transferResult) {
                const err = transferResult.Err;
                if ('InsufficientFunds' in err) {
                    throw new Error(`Insufficient funds: ${formatIcp(Number(err.InsufficientFunds.balance))} ICP available`);
                }
                throw new Error(`Transfer failed: ${JSON.stringify(err)}`);
            }
            
            // Step 3: Refresh the neuron stake
            setSuccess('🔄 Refreshing neuron stake... (this may take a moment)');
            console.log('Calling refreshStakeFromDeposit for neuron:', selectedNeuronId);
            const result = await manager.refreshStakeFromDeposit(selectedNeuronId);
            console.log('refreshStakeFromDeposit result:', result);
            
            if ('Ok' in result) {
                setSuccess(`✅ Added ${increaseStakeAmount} ICP to neuron stake! Refreshing data...`);
                setIncreaseStakeAmount('');
                // Give NNS a moment to update, then refresh
                await new Promise(resolve => setTimeout(resolve, 2000));
                await fetchManagerData();
                fetchUserBalance(agent); // Refresh user balance
                setSuccess(`✅ Successfully added ${increaseStakeAmount} ICP to neuron stake`);
            } else {
                console.error('refreshStakeFromDeposit error:', result.Err);
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error increasing stake:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    // Manual refresh stake - useful if user sent ICP externally or automatic refresh didn't work
    const handleManualRefreshStake = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        
        setActionLoading('refreshStake');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            setSuccess('🔄 Refreshing neuron stake from NNS...');
            console.log('Calling refreshStake for neuron:', selectedNeuronId);
            const result = await manager.refreshStake(selectedNeuronId);
            console.log('refreshStake result:', result);
            
            if ('Ok' in result) {
                setSuccess('✅ Neuron stake refreshed! Fetching updated data...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                await fetchManagerData();
                setSuccess('✅ Neuron data refreshed successfully');
            } else {
                console.error('refreshStake error:', result.Err);
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error refreshing stake:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleToggleAutoStakeMaturity = async (newValue) => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        
        setActionLoading('autoStake');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            const result = await manager.setAutoStakeMaturity(selectedNeuronId, newValue);
            
            if ('Ok' in result) {
                setSuccess(`✅ Auto-stake maturity ${newValue ? 'enabled' : 'disabled'}`);
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error toggling auto-stake maturity:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleSpawnMaturity = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        const percentage = parseInt(maturityPercentage);
        if (!percentage || percentage < 1 || percentage > 100) {
            setError('Percentage must be between 1 and 100');
            return;
        }
        
        setActionLoading('spawnMaturity');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            // Optional controller for the spawned neuron
            const controllerOpt = spawnController ? [Principal.fromText(spawnController)] : [];
            
            const result = await manager.spawnMaturity(selectedNeuronId, percentage, controllerOpt);
            
            if ('Ok' in result) {
                setSuccess(`✅ Spawned new neuron! ID: ${result.Ok.id.toString()}`);
                setSpawnController('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error spawning maturity:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleStakeMaturity = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        const percentage = parseInt(maturityPercentage);
        if (!percentage || percentage < 1 || percentage > 100) {
            setError('Percentage must be between 1 and 100');
            return;
        }
        
        setActionLoading('stakeMaturity');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            const result = await manager.stakeMaturity(selectedNeuronId, percentage);
            
            if ('Ok' in result) {
                setSuccess(`✅ Staked ${percentage}% of maturity`);
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error staking maturity:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleMergeMaturity = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        const percentage = parseInt(maturityPercentage);
        if (!percentage || percentage < 1 || percentage > 100) {
            setError('Percentage must be between 1 and 100');
            return;
        }
        
        setActionLoading('mergeMaturity');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            const result = await manager.mergeMaturity(selectedNeuronId, percentage);
            
            if ('Ok' in result) {
                setSuccess(`✅ Merged ${percentage}% of maturity into stake`);
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error merging maturity:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleDisburseMaturity = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        const percentage = parseInt(maturityPercentage);
        if (!percentage || percentage < 1 || percentage > 100) {
            setError('Percentage must be between 1 and 100');
            return;
        }
        
        setActionLoading('disburseMaturity');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            // Optional destination account
            let destOpt = [];
            if (disburseMaturityDestination) {
                try {
                    destOpt = [{ 
                        owner: Principal.fromText(disburseMaturityDestination), 
                        subaccount: [] 
                    }];
                } catch {
                    setError('Invalid principal for destination');
                    setActionLoading('');
                    return;
                }
            }
            
            const result = await manager.disburseMaturity(selectedNeuronId, percentage, destOpt);
            
            if ('Ok' in result) {
                setSuccess(`✅ Disbursed ${percentage}% of maturity`);
                setDisburseMaturityDestination('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error disbursing maturity:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleSplitNeuron = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        if (!splitAmount || parseFloat(splitAmount) < 1) {
            setError('Minimum split amount is 1 ICP');
            return;
        }
        
        setActionLoading('split');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            const amountE8s = BigInt(Math.floor(parseFloat(splitAmount) * E8S));
            const result = await manager.splitNeuron(selectedNeuronId, amountE8s);
            
            if ('Ok' in result) {
                setSuccess(`✅ Neuron split! New neuron ID: ${result.Ok.id.toString()}`);
                setSplitAmount('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error splitting neuron:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleMergeNeurons = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        if (!mergeSourceNeuronId) {
            setError('Please enter the source neuron ID');
            return;
        }
        
        setActionLoading('merge');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            const sourceNeuronId = { id: BigInt(mergeSourceNeuronId) };
            const result = await manager.mergeNeurons(selectedNeuronId, sourceNeuronId);
            
            if ('Ok' in result) {
                setSuccess(`✅ Neurons merged! Source neuron ${mergeSourceNeuronId} merged into selected neuron.`);
                setMergeSourceNeuronId('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error merging neurons:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleSetVisibility = async (makePublic) => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        
        setActionLoading('visibility');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            // NNS visibility values: 0 = unspecified, 1 = private, 2 = public
            const visibility = makePublic ? 2 : 1;
            const result = await manager.setVisibility(selectedNeuronId, visibility);
            
            if ('Ok' in result) {
                setSuccess(`✅ Neuron visibility set to ${makePublic ? 'public' : 'private'}.`);
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error setting visibility:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    // Fetch token balance directly from the ledger (balances are public)
    const fetchWithdrawTokenBalance = useCallback(async (ledgerId) => {
        if (!ledgerId || !canisterId) return;
        
        try {
            // Call the ledger directly - no need to go through the manager canister
            const ledgerActor = createLedgerActor(ledgerId, { agentOptions: { identity } });
            
            // Fetch balance and metadata in parallel
            const [balance, symbol, decimals, fee] = await Promise.all([
                ledgerActor.icrc1_balance_of({
                    owner: Principal.fromText(canisterId),
                    subaccount: [],
                }),
                ledgerActor.icrc1_symbol(),
                ledgerActor.icrc1_decimals(),
                ledgerActor.icrc1_fee(),
            ]);
            
            setWithdrawTokenBalance(balance);
            setWithdrawTokenSymbol(symbol);
            setWithdrawTokenDecimals(decimals);
            setWithdrawTokenFee(Number(fee));
        } catch (err) {
            console.error('Error fetching token balance:', err);
            setWithdrawTokenBalance(null);
            setWithdrawTokenSymbol('Unknown');
            setWithdrawTokenDecimals(8);
            setWithdrawTokenFee(0);
        }
    }, [canisterId, identity]);
    
    // Fetch token balance when selected token changes
    // Only fetch withdraw token balance when section is expanded
    useEffect(() => {
        if (!withdrawSectionExpanded) return;
        const ledgerId = useCustomLedger ? customLedgerInput : withdrawTokenLedger;
        if (ledgerId) {
            fetchWithdrawTokenBalance(ledgerId);
        }
    }, [withdrawTokenLedger, customLedgerInput, useCustomLedger, fetchWithdrawTokenBalance, withdrawSectionExpanded]);

    const handleWithdrawToken = async () => {
        if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
            setError('Please enter a valid amount');
            return;
        }
        if (!withdrawDestination) {
            setError('Please enter a destination principal');
            return;
        }
        
        const ledgerId = useCustomLedger ? customLedgerInput : withdrawTokenLedger;
        if (!ledgerId) {
            setError('Please select a token or enter a ledger principal');
            return;
        }
        
        // Validate custom ledger principal if used
        if (useCustomLedger) {
            try {
                Principal.fromText(customLedgerInput);
            } catch {
                setError('Invalid ledger principal');
                return;
            }
        }
        
        setActionLoading('withdraw');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            const amount = BigInt(Math.floor(parseFloat(withdrawAmount) * Math.pow(10, withdrawTokenDecimals)));
            const destination = {
                owner: Principal.fromText(withdrawDestination),
                subaccount: [],
            };
            
            let result;
            if (ledgerId === ICP_LEDGER_CANISTER_ID) {
                // Use withdrawIcp for ICP
                result = await manager.withdrawIcp(amount, destination);
            } else {
                // Use withdrawToken for other tokens
                result = await manager.withdrawToken(Principal.fromText(ledgerId), amount, destination);
            }
            
            if ('Ok' in result) {
                setSuccess(`✅ Withdrew ${withdrawAmount} ${withdrawTokenSymbol}! Block height: ${result.Ok.transfer_block_height.toString()}`);
                setWithdrawAmount('');
                fetchManagerData();
                fetchWithdrawTokenBalance(ledgerId);
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error withdrawing token:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleOperationError = (err) => {
        if ('GovernanceError' in err) {
            setError(`Governance error: ${err.GovernanceError.error_message}`);
        } else if ('InvalidOperation' in err) {
            setError(`Invalid operation: ${err.InvalidOperation}`);
        } else if ('NotAuthorized' in err) {
            setError('Not authorized to perform this operation');
        } else if ('NeuronNotFound' in err) {
            setError('Neuron not found');
        } else {
            setError('Operation failed');
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };

    const formatIcp = (e8s) => {
        if (e8s === null || e8s === undefined) return '...';
        const icp = e8s / E8S;
        return icp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
    };

    const formatDuration = (seconds) => {
        const days = Math.floor(seconds / 86400);
        const years = Math.floor(days / 365);
        const remainingDays = days % 365;
        
        if (years > 0) {
            return `${years}y ${remainingDays}d`;
        }
        return `${days} days`;
    };

    const getNeuronState = (state) => {
        const states = {
            1: { label: 'Locked', color: theme.colors.success || '#22c55e' },
            2: { label: 'Dissolving', color: theme.colors.warning || '#f59e0b' },
            3: { label: 'Dissolved', color: theme.colors.error || '#ef4444' },
            4: { label: 'Spawning', color: theme.colors.accent },
        };
        return states[state] || { label: 'Unknown', color: theme.colors.mutedText };
    };

    // Calculate time remaining to confirm following (6 months from last refresh)
    const FOLLOWING_CONFIRMATION_PERIOD_SECONDS = 15_778_800; // ~6 months
    const getFollowingConfirmationStatus = (neuron) => {
        if (!neuron?.voting_power_refreshed_timestamp_seconds?.[0]) {
            return { text: 'Unknown', isUrgent: false, secondsRemaining: null };
        }
        
        const lastRefreshSeconds = Number(neuron.voting_power_refreshed_timestamp_seconds[0]);
        const nowSeconds = Math.floor(Date.now() / 1000);
        const deadlineSeconds = lastRefreshSeconds + FOLLOWING_CONFIRMATION_PERIOD_SECONDS;
        const secondsRemaining = deadlineSeconds - nowSeconds;
        
        if (secondsRemaining <= 0) {
            return { text: 'Inactive - confirmation needed!', isUrgent: true, secondsRemaining: 0 };
        }
        
        const days = Math.floor(secondsRemaining / 86400);
        const hours = Math.floor((secondsRemaining % 86400) / 3600);
        
        const isUrgent = days < 30; // Less than 30 days is urgent
        const text = days > 0 ? `${days} days, ${hours} hours to confirm` : `${hours} hours to confirm`;
        
        return { text, isUrgent, secondsRemaining };
    };

    // Styles
    const cardStyle = {
        background: theme.colors.cardBackground,
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '20px',
        border: `1px solid ${theme.colors.border}`,
    };

    const buttonStyle = {
        background: theme.colors.accent,
        color: '#fff',
        border: 'none',
        borderRadius: '8px',
        padding: '10px 20px',
        fontSize: '14px',
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'opacity 0.2s',
    };

    const secondaryButtonStyle = {
        ...buttonStyle,
        background: 'transparent',
        color: theme.colors.accent,
        border: `1px solid ${theme.colors.accent}`,
    };

    const inputStyle = {
        background: theme.colors.inputBackground || theme.colors.cardBackground,
        color: theme.colors.primaryText,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '8px',
        padding: '10px 14px',
        fontSize: '14px',
        width: '100%',
        boxSizing: 'border-box',
    };

    const tabStyle = (isActive) => ({
        padding: '10px 20px',
        cursor: 'pointer',
        borderBottom: isActive ? `2px solid ${theme.colors.accent}` : '2px solid transparent',
        color: isActive ? theme.colors.accent : theme.colors.mutedText,
        fontWeight: isActive ? '600' : '400',
        background: 'none',
        border: 'none',
        fontSize: '14px',
    });

    const statBoxStyle = {
        textAlign: 'center',
        padding: '15px',
        background: `${theme.colors.accent}10`,
        borderRadius: '8px',
        flex: 1,
        minWidth: '120px',
    };

    if (!isAuthenticated) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main className="wallet-container">
                    <div style={{ ...cardStyle, textAlign: 'center' }}>
                        <p style={{ color: theme.colors.mutedText, marginBottom: '20px' }}>
                            Please log in to manage your neuron.
                        </p>
                        <button style={buttonStyle} onClick={login}>
                            Login with Internet Identity
                        </button>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main className="wallet-container">
                <h1 style={{ color: theme.colors.primaryText, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '32px' }}>🧠</span>
                    <PrincipalDisplay
                        principal={canisterId}
                        displayInfo={displayInfo}
                        showCopyButton={false}
                        isAuthenticated={isAuthenticated}
                        noLink={true}
                    />
                </h1>
                <div style={{ marginBottom: '20px', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <Link 
                        to="/help/icp-neuron-manager" 
                        style={{ color: theme.colors.accent, fontSize: '14px', textDecoration: 'none' }}
                        onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                        onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                    >
                        Learn how it works →
                    </Link>
                    <span style={{ color: theme.colors.border }}>|</span>
                    <button
                        onClick={() => setShowNamingSection(!showNamingSection)}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: theme.colors.accent,
                            fontSize: '14px',
                            cursor: 'pointer',
                            padding: 0,
                        }}
                        onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                        onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                    >
                        {showNamingSection ? 'Hide naming options ↑' : 'Set name or nickname →'}
                    </button>
                </div>
                
                {/* Naming Section */}
                {showNamingSection && (
                    <div style={{ 
                        ...cardStyle, 
                        marginBottom: '20px',
                        backgroundColor: theme.colors.tertiaryBg || theme.colors.secondaryBg,
                    }}>
                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px', fontSize: '16px' }}>
                            🏷️ Name This Manager
                        </h3>
                        
                        {namingError && (
                            <div style={{ 
                                color: theme.colors.error || '#ef4444', 
                                fontSize: '13px', 
                                marginBottom: '12px',
                                padding: '8px 12px',
                                backgroundColor: `${theme.colors.error || '#ef4444'}20`,
                                borderRadius: '6px',
                            }}>
                                {namingError}
                            </div>
                        )}
                        
                        {namingSuccess && (
                            <div style={{ 
                                color: theme.colors.success || '#22c55e', 
                                fontSize: '13px', 
                                marginBottom: '12px',
                                padding: '8px 12px',
                                backgroundColor: `${theme.colors.success || '#22c55e'}20`,
                                borderRadius: '6px',
                            }}>
                                {namingSuccess}
                            </div>
                        )}
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {/* Nickname (private, only you see it) */}
                            <div>
                                <label style={{ color: theme.colors.secondaryText, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                                    Private Nickname <span style={{ color: theme.colors.mutedText }}>(only you can see this)</span>
                                </label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <input
                                        type="text"
                                        value={nicknameInput}
                                        onChange={(e) => setNicknameInput(e.target.value)}
                                        placeholder={displayInfo?.nickname || 'e.g., My Staking Manager'}
                                        style={{
                                            flex: 1,
                                            padding: '10px 12px',
                                            borderRadius: '6px',
                                            border: `1px solid ${theme.colors.border}`,
                                            backgroundColor: theme.colors.primaryBg,
                                            color: theme.colors.primaryText,
                                            fontSize: '14px',
                                        }}
                                    />
                                    <button
                                        onClick={async () => {
                                            if (!nicknameInput.trim()) return;
                                            setSavingNickname(true);
                                            setNamingError('');
                                            setNamingSuccess('');
                                            try {
                                                await setPrincipalNickname(identity, canisterId, nicknameInput.trim());
                                                setNamingSuccess('Nickname saved!');
                                                setNicknameInput('');
                                                if (fetchAllNames) fetchAllNames();
                                            } catch (err) {
                                                setNamingError(`Failed to save nickname: ${err.message}`);
                                            } finally {
                                                setSavingNickname(false);
                                            }
                                        }}
                                        disabled={savingNickname || !nicknameInput.trim()}
                                        style={{
                                            ...buttonStyle,
                                            opacity: (savingNickname || !nicknameInput.trim()) ? 0.6 : 1,
                                        }}
                                    >
                                        {savingNickname ? '...' : 'Save'}
                                    </button>
                                </div>
                                {displayInfo?.nickname && (
                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginTop: '4px' }}>
                                        Current: "{displayInfo.nickname}"
                                    </div>
                                )}
                            </div>
                            
                            {/* Public Name (everyone sees it) */}
                            <div>
                                <label style={{ color: theme.colors.secondaryText, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                                    Public Name <span style={{ color: theme.colors.mutedText }}>(visible to everyone)</span>
                                </label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <input
                                        type="text"
                                        value={publicNameInput}
                                        onChange={(e) => setPublicNameInput(e.target.value)}
                                        placeholder={displayInfo?.name || 'e.g., Alice\'s NNS Manager'}
                                        style={{
                                            flex: 1,
                                            padding: '10px 12px',
                                            borderRadius: '6px',
                                            border: `1px solid ${theme.colors.border}`,
                                            backgroundColor: theme.colors.primaryBg,
                                            color: theme.colors.primaryText,
                                            fontSize: '14px',
                                        }}
                                    />
                                    <button
                                        onClick={async () => {
                                            if (!publicNameInput.trim()) return;
                                            setSavingPublicName(true);
                                            setNamingError('');
                                            setNamingSuccess('');
                                            try {
                                                await setPrincipalNameFor(identity, canisterId, publicNameInput.trim());
                                                setNamingSuccess('Public name saved!');
                                                setPublicNameInput('');
                                                if (fetchAllNames) fetchAllNames();
                                            } catch (err) {
                                                setNamingError(`Failed to save public name: ${err.message}`);
                                            } finally {
                                                setSavingPublicName(false);
                                            }
                                        }}
                                        disabled={savingPublicName || !publicNameInput.trim()}
                                        style={{
                                            ...buttonStyle,
                                            opacity: (savingPublicName || !publicNameInput.trim()) ? 0.6 : 1,
                                        }}
                                    >
                                        {savingPublicName ? '...' : 'Save'}
                                    </button>
                                </div>
                                {displayInfo?.name && (
                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginTop: '4px' }}>
                                        Current: "{displayInfo.name}"
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
                
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: theme.colors.primaryText }}>
                        Loading manager...
                    </div>
                ) : error && !managerInfo ? (
                    <div style={{ 
                        backgroundColor: `${theme.colors.error}20`, 
                        border: `1px solid ${theme.colors.error}`,
                        color: theme.colors.error,
                        padding: '15px',
                        borderRadius: '8px',
                    }}>
                        {error}
                    </div>
                ) : managerInfo && (
                    <>
                        {/* ============================================ */}
                        {/* CANISTER SECTION */}
                        {/* ============================================ */}
                        <div style={{ marginBottom: '20px' }}>
                            {/* Section Header */}
                            <button
                                onClick={() => setCanisterSectionExpanded(!canisterSectionExpanded)}
                                style={{
                                    width: '100%',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '16px 20px',
                                    backgroundColor: theme.colors.secondaryBg,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: canisterSectionExpanded ? '12px 12px 0 0' : '12px',
                                    cursor: 'pointer',
                                    color: theme.colors.primaryText,
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <span style={{ fontSize: '20px' }}>🏛️</span>
                                    <span style={{ fontSize: '18px', fontWeight: '600' }}>Canister</span>
                                    {canisterStatus && (
                                        <span style={{ 
                                            fontSize: '12px', 
                                            color: theme.colors.mutedText,
                                            backgroundColor: theme.colors.tertiaryBg || theme.colors.primaryBg,
                                            padding: '4px 10px',
                                            borderRadius: '12px',
                                        }}>
                                            {formatCycles(canisterStatus.cycles)}
                                        </span>
                                    )}
                                </div>
                                <span style={{ 
                                    fontSize: '18px',
                                    transform: canisterSectionExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                    transition: 'transform 0.2s ease',
                                    color: theme.colors.mutedText,
                                }}>
                                    ▼
                                </span>
                            </button>
                            
                            {/* Section Content */}
                            {canisterSectionExpanded && (
                                <div style={{ 
                                    border: `1px solid ${theme.colors.border}`,
                                    borderTop: 'none',
                                    borderRadius: '0 0 12px 12px',
                                    overflow: 'hidden',
                                    padding: '20px',
                                }}>
                        
                        {/* Manager Info Card */}
                        <div style={cardStyle}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
                                <div>
                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                        Canister ID <span style={{ color: theme.colors.accent, fontSize: '11px' }}>(send ICP from wallet/DEX)</span>
                                    </div>
                                    <div style={{ color: theme.colors.primaryText, fontSize: '14px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <PrincipalDisplay
                                            principal={managerInfo.canisterId}
                                            displayInfo={displayInfo}
                                            showCopyButton={true}
                                            isAuthenticated={isAuthenticated}
                                            noLink={true}
                                        />
                                    </div>
                                </div>
                                {canisterStatus && (
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Cycles</div>
                                        <div style={{ 
                                            color: canisterStatus.cycles > 1_000_000_000_000 ? (theme.colors.success || '#22c55e') : theme.colors.warning || '#f59e0b', 
                                            fontSize: '24px', 
                                            fontWeight: '700',
                                            marginTop: '4px',
                                        }}>
                                            {formatCycles(canisterStatus.cycles)}
                                        </div>
                                    </div>
                                )}
                            </div>
                            
                            <div style={{ marginTop: '15px' }}>
                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                    Account ID <span style={{ color: theme.colors.accent, fontSize: '11px' }}>(send ICP from CEX)</span>
                                </div>
                                <div style={{ 
                                    color: theme.colors.accent, 
                                    fontFamily: 'monospace', 
                                    fontSize: '12px',
                                    marginTop: '4px',
                                    wordBreak: 'break-all',
                                    background: `${theme.colors.accent}10`,
                                    padding: '8px',
                                    borderRadius: '4px',
                                }}>
                                    {managerInfo.accountId}
                                    <button 
                                        onClick={() => copyToClipboard(managerInfo.accountId)}
                                        style={{ ...secondaryButtonStyle, padding: '2px 8px', fontSize: '11px', marginLeft: '8px' }}
                                    >
                                        Copy
                                    </button>
                                </div>
                            </div>

                            <div style={{ marginTop: '15px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Version: </span>
                                    <span style={{ color: theme.colors.primaryText, fontSize: '12px' }}>
                                        {managerInfo.version}
                                    </span>
                                    {matchedOfficialVersion && 
                                     `${Number(matchedOfficialVersion.major)}.${Number(matchedOfficialVersion.minor)}.${Number(matchedOfficialVersion.patch)}` === managerInfo.version && (
                                        <span title="Version verified against official registry" style={{ 
                                            color: theme.colors.success || '#22c55e',
                                            fontSize: '14px'
                                        }}>
                                            ✓
                                        </span>
                                    )}
                                </div>
                                {canisterStatus && (
                                    <div>
                                        <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Status: </span>
                                        <span style={{ 
                                            color: canisterStatus.status === 'running' ? (theme.colors.success || '#22c55e') : theme.colors.warning || '#f59e0b',
                                            fontSize: '12px',
                                            textTransform: 'capitalize'
                                        }}>
                                            {canisterStatus.status}
                                        </span>
                                    </div>
                                )}
                                {canisterStatus && canisterStatus.memorySize !== undefined && (
                                    <div>
                                        <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Memory: </span>
                                        <span style={{ color: theme.colors.primaryText, fontSize: '12px' }}>
                                            {(canisterStatus.memorySize / (1024 * 1024)).toFixed(2)} MB
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Module Hash */}
                            {canisterStatus && (
                                <div style={{ marginTop: '15px' }}>
                                    <div style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justifyContent: 'space-between',
                                        marginBottom: '4px'
                                    }}>
                                        <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                            Module Hash
                                        </span>
                                        {matchedOfficialVersion && (
                                            <span style={{ 
                                                color: theme.colors.success || '#22c55e',
                                                fontSize: '11px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px'
                                            }}>
                                                ✓ Official v{Number(matchedOfficialVersion.major)}.{Number(matchedOfficialVersion.minor)}.{Number(matchedOfficialVersion.patch)}
                                            </span>
                                        )}
                                        {canisterStatus.moduleHash && !matchedOfficialVersion && officialVersions.length > 0 && (
                                            <span style={{ 
                                                color: theme.colors.warning || '#f59e0b',
                                                fontSize: '11px'
                                            }}>
                                                ⚠ Unverified
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ 
                                        color: matchedOfficialVersion 
                                            ? (theme.colors.success || '#22c55e') 
                                            : theme.colors.primaryText, 
                                        fontFamily: 'monospace',
                                        fontSize: '11px',
                                        background: theme.colors.tertiaryBg || theme.colors.secondaryBg,
                                        padding: '8px 10px',
                                        borderRadius: '4px',
                                        wordBreak: 'break-all',
                                        border: matchedOfficialVersion 
                                            ? `1px solid ${theme.colors.success || '#22c55e'}30` 
                                            : 'none'
                                    }}>
                                        {canisterStatus.moduleHash || (
                                            <span style={{ color: theme.colors.mutedText, fontStyle: 'italic' }}>
                                                No module installed
                                            </span>
                                        )}
                                    </div>
                                    {/* Show links if matched official version has them */}
                                    {matchedOfficialVersion && (matchedOfficialVersion.wasmUrl || matchedOfficialVersion.sourceUrl) && (
                                        <div style={{ 
                                            display: 'flex', 
                                            gap: '15px', 
                                            marginTop: '8px',
                                            fontSize: '11px'
                                        }}>
                                            {matchedOfficialVersion.sourceUrl && (
                                                <a 
                                                    href={matchedOfficialVersion.sourceUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{ color: theme.colors.accent }}
                                                >
                                                    View Source →
                                                </a>
                                            )}
                                            {matchedOfficialVersion.wasmUrl && (
                                                <a 
                                                    href={matchedOfficialVersion.wasmUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{ color: theme.colors.accent }}
                                                >
                                                    Download WASM →
                                                </a>
                                            )}
                                        </div>
                                    )}
                                    
                                    {/* Upgrade Available Section */}
                                    {nextAvailableVersion && isController && (
                                        <div style={{
                                            marginTop: '12px',
                                            padding: '12px',
                                            background: `${theme.colors.accent}15`,
                                            borderRadius: '6px',
                                            border: `1px solid ${theme.colors.accent}40`,
                                        }}>
                                            <div style={{ 
                                                display: 'flex', 
                                                alignItems: 'flex-start', 
                                                justifyContent: 'space-between',
                                                flexWrap: 'wrap',
                                                gap: '10px'
                                            }}>
                                                <div>
                                                    <div style={{ 
                                                        color: theme.colors.accent, 
                                                        fontWeight: '600',
                                                        fontSize: '13px',
                                                        marginBottom: '2px'
                                                    }}>
                                                        🚀 Upgrade Available
                                                    </div>
                                                    <div style={{ 
                                                        color: theme.colors.mutedText, 
                                                        fontSize: '12px'
                                                    }}>
                                                        v{Number(nextAvailableVersion.major)}.{Number(nextAvailableVersion.minor)}.{Number(nextAvailableVersion.patch)} is available
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                    <button
                                                        onClick={() => handleUpgrade(nextAvailableVersion, 'upgrade')}
                                                        disabled={upgrading}
                                                        style={{
                                                            background: theme.colors.accent,
                                                            color: '#fff',
                                                            border: 'none',
                                                            borderRadius: '6px',
                                                            padding: '8px 16px',
                                                            fontSize: '13px',
                                                            fontWeight: '600',
                                                            cursor: upgrading ? 'wait' : 'pointer',
                                                            opacity: upgrading ? 0.7 : 1,
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '6px',
                                                        }}
                                                        title="Upgrade keeps canister state"
                                                    >
                                                        {upgrading && upgradeMode === 'upgrade' ? (
                                                            <>
                                                                <span style={{
                                                                    animation: 'spin 1s linear infinite',
                                                                    display: 'inline-block',
                                                                }}>⏳</span>
                                                                Upgrading...
                                                            </>
                                                        ) : (
                                                            <>⬆️ Upgrade</>
                                                        )}
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            if (window.confirm('⚠️ Reinstall will WIPE ALL CANISTER STATE including creation time. This cannot be undone. Are you sure?')) {
                                                                handleUpgrade(nextAvailableVersion, 'reinstall');
                                                            }
                                                        }}
                                                        disabled={upgrading}
                                                        style={{
                                                            background: 'transparent',
                                                            color: theme.colors.mutedText,
                                                            border: `1px solid ${theme.colors.border || '#3a3a3a'}`,
                                                            borderRadius: '6px',
                                                            padding: '8px 12px',
                                                            fontSize: '12px',
                                                            cursor: upgrading ? 'wait' : 'pointer',
                                                            opacity: upgrading ? 0.7 : 1,
                                                        }}
                                                        title="⚠️ Reinstall DELETES all canister state!"
                                                    >
                                                        {upgrading && upgradeMode === 'reinstall' ? '⏳...' : '🔄 Reinstall'}
                                                    </button>
                                                </div>
                                            </div>
                                            {nextAvailableVersion.sourceUrl && (
                                                <div style={{ marginTop: '8px', fontSize: '11px' }}>
                                                    <a 
                                                        href={nextAvailableVersion.sourceUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{ color: theme.colors.accent }}
                                                    >
                                                        View release notes →
                                                    </a>
                                                </div>
                                            )}
                                            {upgradeError && (
                                                <div style={{
                                                    marginTop: '10px',
                                                    padding: '8px 10px',
                                                    background: `${theme.colors.error || '#ef4444'}20`,
                                                    borderRadius: '4px',
                                                    color: theme.colors.error || '#ef4444',
                                                    fontSize: '12px',
                                                }}>
                                                    {upgradeError}
                                                </div>
                                            )}
                                            {upgradeSuccess && (
                                                <div style={{
                                                    marginTop: '10px',
                                                    padding: '8px 10px',
                                                    background: `${theme.colors.success || '#22c55e'}20`,
                                                    borderRadius: '4px',
                                                    color: theme.colors.success || '#22c55e',
                                                    fontSize: '12px',
                                                }}>
                                                    {upgradeSuccess}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    
                                    {/* Install Official Version Section - shown when WASM is unverified OR version mismatch */}
                                    {(() => {
                                        // Check for version mismatch (hash matches official but version doesn't match what canister claims)
                                        const hasVersionMismatch = matchedOfficialVersion && managerInfo?.version && 
                                            `${Number(matchedOfficialVersion.major)}.${Number(matchedOfficialVersion.minor)}.${Number(matchedOfficialVersion.patch)}` !== managerInfo.version;
                                        const isUnverifiedWasm = canisterStatus?.moduleHash && !matchedOfficialVersion;
                                        const shouldShowWarning = (isUnverifiedWasm || hasVersionMismatch) && latestOfficialVersion && isController;
                                        
                                        if (!shouldShowWarning) return null;
                                        
                                        return (
                                        <div style={{
                                            marginTop: '12px',
                                            padding: '12px',
                                            background: `${theme.colors.warning || '#f59e0b'}15`,
                                            borderRadius: '6px',
                                            border: `1px solid ${theme.colors.warning || '#f59e0b'}40`,
                                        }}>
                                            <div style={{ 
                                                color: theme.colors.warning || '#f59e0b', 
                                                fontWeight: '600',
                                                fontSize: '13px',
                                                marginBottom: '6px'
                                            }}>
                                                {hasVersionMismatch ? '⚠️ Version Mismatch' : '⚠️ Unknown WASM Version'}
                                            </div>
                                            <div style={{ 
                                                color: theme.colors.mutedText, 
                                                fontSize: '12px',
                                                marginBottom: '12px'
                                            }}>
                                                {hasVersionMismatch 
                                                    ? `The WASM hash matches official v${Number(matchedOfficialVersion.major)}.${Number(matchedOfficialVersion.minor)}.${Number(matchedOfficialVersion.patch)}, but the canister reports v${managerInfo.version}. You can install the latest official version (v${Number(latestOfficialVersion.major)}.${Number(latestOfficialVersion.minor)}.${Number(latestOfficialVersion.patch)}).`
                                                    : `This canister is running an unverified WASM module. You can install the latest official version (v${Number(latestOfficialVersion.major)}.${Number(latestOfficialVersion.minor)}.${Number(latestOfficialVersion.patch)}).`
                                                }
                                            </div>
                                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                                <button
                                                    onClick={() => handleUpgrade(latestOfficialVersion, 'upgrade')}
                                                    disabled={upgrading}
                                                    style={{
                                                        background: theme.colors.accent,
                                                        color: '#fff',
                                                        border: 'none',
                                                        borderRadius: '6px',
                                                        padding: '8px 16px',
                                                        fontSize: '13px',
                                                        fontWeight: '600',
                                                        cursor: upgrading ? 'wait' : 'pointer',
                                                        opacity: upgrading ? 0.7 : 1,
                                                    }}
                                                    title="Upgrade keeps canister state"
                                                >
                                                    {upgrading && upgradeMode === 'upgrade' ? '⏳ Upgrading...' : '⬆️ Upgrade'}
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        if (window.confirm('⚠️ Reinstall will WIPE ALL CANISTER STATE. This cannot be undone. Are you sure?')) {
                                                            handleUpgrade(latestOfficialVersion, 'reinstall');
                                                        }
                                                    }}
                                                    disabled={upgrading}
                                                    style={{
                                                        background: 'transparent',
                                                        color: theme.colors.error || '#ef4444',
                                                        border: `1px solid ${theme.colors.error || '#ef4444'}`,
                                                        borderRadius: '6px',
                                                        padding: '8px 16px',
                                                        fontSize: '13px',
                                                        fontWeight: '600',
                                                        cursor: upgrading ? 'wait' : 'pointer',
                                                        opacity: upgrading ? 0.7 : 1,
                                                    }}
                                                    title="⚠️ Reinstall DELETES all canister state!"
                                                >
                                                    {upgrading && upgradeMode === 'reinstall' ? '⏳ Reinstalling...' : '🔄 Reinstall'}
                                                </button>
                                            </div>
                                            {latestOfficialVersion.sourceUrl && (
                                                <div style={{ marginTop: '10px', fontSize: '11px' }}>
                                                    <a 
                                                        href={latestOfficialVersion.sourceUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{ color: theme.colors.accent }}
                                                    >
                                                        View source code →
                                                    </a>
                                                </div>
                                            )}
                                            {upgradeError && (
                                                <div style={{
                                                    marginTop: '10px',
                                                    padding: '8px 10px',
                                                    background: `${theme.colors.error || '#ef4444'}20`,
                                                    borderRadius: '4px',
                                                    color: theme.colors.error || '#ef4444',
                                                    fontSize: '12px',
                                                }}>
                                                    {upgradeError}
                                                </div>
                                            )}
                                            {upgradeSuccess && (
                                                <div style={{
                                                    marginTop: '10px',
                                                    padding: '8px 10px',
                                                    background: `${theme.colors.success || '#22c55e'}20`,
                                                    borderRadius: '4px',
                                                    color: theme.colors.success || '#22c55e',
                                                    fontSize: '12px',
                                                }}>
                                                    {upgradeSuccess}
                                                </div>
                                            )}
                                        </div>
                                        );
                                    })()}
                                </div>
                            )}

                            {/* Controllers Section */}
                            {controllers.length > 0 && (
                                <div style={{ marginTop: '15px' }}>
                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '8px' }}>
                                        Controllers ({controllers.length})
                                    </div>
                                    <div style={{ 
                                        background: `${theme.colors.tertiaryBg || theme.colors.secondaryBg}`,
                                        padding: '10px',
                                        borderRadius: '6px',
                                    }}>
                                        {controllers.map((controller, index) => {
                                            const controllerStr = controller.toString();
                                            const isCurrentUser = identity && controllerStr === identity.getPrincipal().toString();
                                            const isConfirmingRemove = confirmRemoveController === controllerStr;
                                            return (
                                                <div 
                                                    key={index}
                                                    style={{ 
                                                        display: 'flex', 
                                                        alignItems: 'center', 
                                                        gap: '8px',
                                                        padding: '6px 0',
                                                        borderBottom: index < controllers.length - 1 ? `1px solid ${theme.colors.border}` : 'none',
                                                    }}
                                                >
                                                    <span style={{ 
                                                        color: theme.colors.primaryText, 
                                                        fontFamily: 'monospace', 
                                                        fontSize: '12px',
                                                        flex: 1,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                    }}>
                                                        {controllerStr}
                                                    </span>
                                                    {isCurrentUser && (
                                                        <span style={{
                                                            backgroundColor: `${theme.colors.accent}30`,
                                                            color: theme.colors.accent,
                                                            padding: '2px 6px',
                                                            borderRadius: '4px',
                                                            fontSize: '10px',
                                                            fontWeight: '500',
                                                        }}>
                                                            YOU
                                                        </span>
                                                    )}
                                                    <button 
                                                        onClick={() => copyToClipboard(controllerStr)}
                                                        style={{ ...secondaryButtonStyle, padding: '2px 6px', fontSize: '10px' }}
                                                    >
                                                        Copy
                                                    </button>
                                                    {/* Remove button */}
                                                    {isConfirmingRemove ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <span style={{ 
                                                                color: isCurrentUser ? theme.colors.warning : theme.colors.error, 
                                                                fontSize: '10px',
                                                                whiteSpace: 'nowrap'
                                                            }}>
                                                                {isCurrentUser ? '⚠️ Remove yourself?' : 'Confirm?'}
                                                            </span>
                                                            <button
                                                                onClick={() => handleRemoveController(controller)}
                                                                disabled={updatingControllers}
                                                                style={{
                                                                    backgroundColor: theme.colors.error || '#ef4444',
                                                                    color: '#fff',
                                                                    border: 'none',
                                                                    borderRadius: '4px',
                                                                    padding: '2px 6px',
                                                                    cursor: updatingControllers ? 'not-allowed' : 'pointer',
                                                                    fontSize: '10px',
                                                                    fontWeight: '500',
                                                                    opacity: updatingControllers ? 0.7 : 1,
                                                                }}
                                                            >
                                                                {updatingControllers ? '...' : 'Yes'}
                                                            </button>
                                                            <button
                                                                onClick={() => setConfirmRemoveController(null)}
                                                                style={{
                                                                    backgroundColor: theme.colors.secondaryBg,
                                                                    color: theme.colors.primaryText,
                                                                    border: `1px solid ${theme.colors.border}`,
                                                                    borderRadius: '4px',
                                                                    padding: '2px 6px',
                                                                    cursor: 'pointer',
                                                                    fontSize: '10px',
                                                                }}
                                                            >
                                                                No
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => setConfirmRemoveController(controllerStr)}
                                                            disabled={updatingControllers}
                                                            style={{
                                                                backgroundColor: 'transparent',
                                                                color: theme.colors.error || '#ef4444',
                                                                border: `1px solid ${theme.colors.error || '#ef4444'}`,
                                                                borderRadius: '4px',
                                                                padding: '2px 6px',
                                                                cursor: updatingControllers ? 'not-allowed' : 'pointer',
                                                                fontSize: '10px',
                                                                fontWeight: '500',
                                                                opacity: updatingControllers ? 0.7 : 1,
                                                            }}
                                                        >
                                                            Remove
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        
                                        {/* Add Controller */}
                                        <div style={{ 
                                            marginTop: '12px',
                                            paddingTop: '12px',
                                            borderTop: `1px solid ${theme.colors.border}`
                                        }}>
                                            <div style={{ 
                                                color: theme.colors.mutedText, 
                                                fontSize: '11px',
                                                marginBottom: '6px'
                                            }}>
                                                Add Controller
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                <input
                                                    type="text"
                                                    value={newControllerInput}
                                                    onChange={(e) => setNewControllerInput(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            handleAddController();
                                                        }
                                                    }}
                                                    placeholder="Enter principal ID"
                                                    disabled={updatingControllers}
                                                    style={{
                                                        flex: '1',
                                                        minWidth: '180px',
                                                        padding: '6px 10px',
                                                        border: `1px solid ${theme.colors.border}`,
                                                        borderRadius: '4px',
                                                        backgroundColor: theme.colors.secondaryBg,
                                                        color: theme.colors.primaryText,
                                                        fontSize: '12px',
                                                        outline: 'none'
                                                    }}
                                                />
                                                <button
                                                    onClick={handleAddController}
                                                    disabled={updatingControllers || !newControllerInput.trim()}
                                                    style={{
                                                        backgroundColor: theme.colors.success || '#22c55e',
                                                        color: '#fff',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        padding: '6px 12px',
                                                        cursor: (updatingControllers || !newControllerInput.trim()) ? 'not-allowed' : 'pointer',
                                                        fontSize: '12px',
                                                        fontWeight: '500',
                                                        opacity: (updatingControllers || !newControllerInput.trim()) ? 0.7 : 1
                                                    }}
                                                >
                                                    {updatingControllers ? 'Updating...' : 'Add'}
                                                </button>
                                            </div>
                                            <p style={{ 
                                                color: theme.colors.mutedText, 
                                                fontSize: '10px',
                                                marginTop: '6px',
                                                marginBottom: 0
                                            }}>
                                                ⚠️ Be careful when modifying controllers. Removing all controllers will make the canister permanently uncontrollable.
                                            </p>
                                        </div>
                                        
                                        {/* Controller Success Message */}
                                        {controllerSuccess && (
                                            <div style={{
                                                marginTop: '10px',
                                                padding: '8px',
                                                backgroundColor: `${theme.colors.success || '#22c55e'}20`,
                                                borderRadius: '4px',
                                                color: theme.colors.success || '#22c55e',
                                                fontSize: '12px',
                                            }}>
                                                ✅ {controllerSuccess}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Cycles Top-Up Card */}
                        <div style={cardStyle}>
                            <div style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center',
                                marginBottom: showTopUpSection ? '16px' : '0'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <FaGasPump style={{ color: theme.colors.accent, fontSize: '18px' }} />
                                    <div>
                                        <h3 style={{ color: theme.colors.primaryText, margin: '0 0 2px 0', fontSize: '16px' }}>
                                            ⛽ Top Up Cycles
                                        </h3>
                                        <p style={{ color: theme.colors.mutedText, fontSize: '12px', margin: 0 }}>
                                            Convert ICP to cycles for this canister
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setShowTopUpSection(!showTopUpSection)}
                                    style={{
                                        ...showTopUpSection ? secondaryButtonStyle : buttonStyle,
                                        padding: '8px 16px',
                                    }}
                                >
                                    {showTopUpSection ? 'Cancel' : 'Add Cycles'}
                                </button>
                            </div>
                            
                            {showTopUpSection && (
                                <div>
                                    {/* User ICP Balance */}
                                    <div style={{ 
                                        display: 'flex', 
                                        justifyContent: 'space-between', 
                                        alignItems: 'center',
                                        marginBottom: '12px',
                                        padding: '10px 12px',
                                        backgroundColor: theme.colors.tertiaryBg || theme.colors.secondaryBg,
                                        borderRadius: '6px'
                                    }}>
                                        <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>
                                            Your ICP Balance:
                                        </span>
                                        <span style={{ 
                                            color: theme.colors.primaryText, 
                                            fontWeight: '600',
                                            fontSize: '14px'
                                        }}>
                                            {formatIcp(userIcpBalance)} ICP
                                        </span>
                                    </div>
                                    
                                    {/* Conversion Rate Info */}
                                    {conversionRate && (
                                        <div style={{ 
                                            marginBottom: '12px',
                                            padding: '10px 12px',
                                            backgroundColor: `${theme.colors.accent}10`,
                                            borderRadius: '6px',
                                            fontSize: '12px',
                                            color: theme.colors.mutedText
                                        }}>
                                            <strong style={{ color: theme.colors.primaryText }}>Current Rate:</strong> 1 ICP ≈ {formatCycles(conversionRate.cyclesPerIcp)} cycles
                                        </div>
                                    )}
                                    
                                    {/* Amount Input */}
                                    <div style={{ marginBottom: '12px' }}>
                                        <label style={{ 
                                            display: 'block',
                                            color: theme.colors.mutedText, 
                                            fontSize: '12px',
                                            marginBottom: '6px'
                                        }}>
                                            Amount (ICP)
                                        </label>
                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                            <input
                                                type="number"
                                                value={topUpAmount}
                                                onChange={(e) => setTopUpAmount(e.target.value)}
                                                placeholder="0.0"
                                                step="0.01"
                                                min="0"
                                                disabled={toppingUp}
                                                style={inputStyle}
                                            />
                                            <button
                                                onClick={() => {
                                                    if (userIcpBalance) {
                                                        const maxAmount = Math.max(0, (userIcpBalance - ICP_FEE * 2) / E8S);
                                                        setTopUpAmount(maxAmount.toFixed(4));
                                                    }
                                                }}
                                                disabled={toppingUp || !userIcpBalance}
                                                style={{ ...secondaryButtonStyle, padding: '10px 12px' }}
                                            >
                                                MAX
                                            </button>
                                        </div>
                                    </div>
                                    
                                    {/* Estimated Cycles */}
                                    {estimatedCycles() && (
                                        <div style={{ 
                                            marginBottom: '16px',
                                            padding: '12px',
                                            backgroundColor: `${theme.colors.success || '#22c55e'}15`,
                                            borderRadius: '6px',
                                            border: `1px solid ${theme.colors.success || '#22c55e'}30`,
                                            textAlign: 'center'
                                        }}>
                                            <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '4px' }}>
                                                Estimated Cycles to Add
                                            </div>
                                            <div style={{ 
                                                color: theme.colors.success || '#22c55e', 
                                                fontSize: '20px', 
                                                fontWeight: '700' 
                                            }}>
                                                ~{formatCycles(estimatedCycles())}
                                            </div>
                                        </div>
                                    )}
                                    
                                    {/* Top Up Button */}
                                    <button
                                        onClick={handleCyclesTopUp}
                                        disabled={toppingUp || !topUpAmount || parseFloat(topUpAmount) <= 0}
                                        style={{
                                            ...buttonStyle,
                                            width: '100%',
                                            opacity: (toppingUp || !topUpAmount || parseFloat(topUpAmount) <= 0) ? 0.6 : 1,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        {toppingUp ? (
                                            '⏳ Processing...'
                                        ) : (
                                            <>
                                                <FaGasPump />
                                                Top Up Canister
                                            </>
                                        )}
                                    </button>
                                    
                                    <p style={{ 
                                        color: theme.colors.mutedText, 
                                        fontSize: '11px', 
                                        marginTop: '10px',
                                        marginBottom: 0,
                                        textAlign: 'center'
                                    }}>
                                        Converts ICP to cycles via the Cycles Minting Canister (CMC).
                                        A small ICP fee (0.0001) applies.
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Withdraw Tokens from Canister - Collapsible */}
                        <div style={cardStyle}>
                            <button
                                onClick={() => setWithdrawSectionExpanded(!withdrawSectionExpanded)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    width: '100%',
                                    background: 'transparent',
                                    border: 'none',
                                    padding: 0,
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                }}
                            >
                                <div>
                                    <h3 style={{ color: theme.colors.primaryText, margin: '0 0 5px 0' }}>💸 Withdraw Tokens</h3>
                                    <p style={{ color: theme.colors.mutedText, fontSize: '12px', margin: 0 }}>
                                        Withdraw ICP or any ICRC1 token from this canister
                                    </p>
                                </div>
                                <span style={{ 
                                    color: theme.colors.mutedText, 
                                    fontSize: '18px',
                                    transform: withdrawSectionExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                    transition: 'transform 0.2s ease',
                                }}>
                                    ▼
                                </span>
                            </button>
                            
                            {withdrawSectionExpanded && (
                                <div style={{ marginTop: '15px' }}>
                                    {/* Token Selection */}
                                    <div style={{ marginBottom: '15px' }}>
                                        <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '6px' }}>
                                            Select Token
                                        </label>
                                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
                                            <label style={{ 
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                gap: '6px',
                                                color: theme.colors.primaryText,
                                                fontSize: '13px',
                                                cursor: 'pointer',
                                            }}>
                                                <input 
                                                    type="radio" 
                                                    checked={!useCustomLedger} 
                                                    onChange={() => {
                                                        setUseCustomLedger(false);
                                                        setWithdrawTokenLedger(ICP_LEDGER_CANISTER_ID);
                                                    }}
                                                    style={{ margin: 0 }}
                                                />
                                                From list
                                            </label>
                                            <label style={{ 
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                gap: '6px',
                                                color: theme.colors.primaryText,
                                                fontSize: '13px',
                                                cursor: 'pointer',
                                            }}>
                                                <input 
                                                    type="radio" 
                                                    checked={useCustomLedger} 
                                                    onChange={() => setUseCustomLedger(true)}
                                                    style={{ margin: 0 }}
                                                />
                                                Custom ledger
                                            </label>
                                        </div>
                                        
                                        {!useCustomLedger ? (
                                            <TokenSelector
                                                value={withdrawTokenLedger}
                                                onChange={(ledgerId) => setWithdrawTokenLedger(ledgerId)}
                                                placeholder="Select a token..."
                                            />
                                        ) : (
                                            <input
                                                type="text"
                                                value={customLedgerInput}
                                                onChange={(e) => setCustomLedgerInput(e.target.value)}
                                                style={inputStyle}
                                                placeholder="Enter ledger canister principal"
                                            />
                                        )}
                                    </div>
                                    
                                    {/* Token Balance */}
                                    <div style={{ 
                                        background: `${theme.colors.accent}10`, 
                                        padding: '10px', 
                                        borderRadius: '6px', 
                                        marginBottom: '12px',
                                        fontSize: '12px',
                                        color: theme.colors.mutedText,
                                    }}>
                                        Available: <strong style={{ color: theme.colors.primaryText }}>
                                            {withdrawTokenBalance !== null 
                                                ? `${(Number(withdrawTokenBalance) / Math.pow(10, withdrawTokenDecimals)).toFixed(withdrawTokenDecimals > 4 ? 4 : withdrawTokenDecimals)} ${withdrawTokenSymbol}`
                                                : 'Loading...'
                                            }
                                        </strong>
                                    </div>
                                    
                                    {/* Amount and Destination */}
                                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                        <div style={{ flex: 1, minWidth: '120px' }}>
                                            <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                                                Amount ({withdrawTokenSymbol})
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="any"
                                                value={withdrawAmount}
                                                onChange={(e) => setWithdrawAmount(e.target.value)}
                                                style={inputStyle}
                                                placeholder="Amount to withdraw"
                                            />
                                        </div>
                                        <div style={{ flex: 2, minWidth: '200px' }}>
                                            <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                                                Destination Principal
                                            </label>
                                            <input
                                                type="text"
                                                value={withdrawDestination}
                                                onChange={(e) => setWithdrawDestination(e.target.value)}
                                                style={inputStyle}
                                                placeholder="Principal ID"
                                            />
                                        </div>
                                        <button
                                            onClick={handleWithdrawToken}
                                            disabled={actionLoading === 'withdraw' || withdrawTokenBalance === null || withdrawTokenBalance === BigInt(0)}
                                            style={{ 
                                                ...buttonStyle, 
                                                opacity: (actionLoading === 'withdraw' || withdrawTokenBalance === null || withdrawTokenBalance === BigInt(0)) ? 0.6 : 1,
                                            }}
                                        >
                                            {actionLoading === 'withdraw' ? '⏳...' : '💸 Withdraw'}
                                        </button>
                                    </div>
                                    <p style={{ color: theme.colors.mutedText, fontSize: '11px', marginTop: '8px', marginBottom: 0 }}>
                                        Fee: {(withdrawTokenFee / Math.pow(10, withdrawTokenDecimals)).toFixed(withdrawTokenDecimals > 4 ? 4 : withdrawTokenDecimals)} {withdrawTokenSymbol}
                                    </p>
                                </div>
                            )}
                        </div>
                                </div>
                            )}
                        </div>

                        {/* ============================================ */}
                        {/* NEURONS SECTION */}
                        {/* ============================================ */}
                        <div style={{ marginBottom: '20px' }}>
                            {/* Section Header */}
                            <button
                                onClick={() => setNeuronSectionExpanded(!neuronSectionExpanded)}
                                style={{
                                    width: '100%',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '16px 20px',
                                    backgroundColor: theme.colors.secondaryBg,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: neuronSectionExpanded ? '12px 12px 0 0' : '12px',
                                    cursor: 'pointer',
                                    color: theme.colors.primaryText,
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <span style={{ fontSize: '20px' }}>🧠</span>
                                    <span style={{ fontSize: '18px', fontWeight: '600' }}>Neurons</span>
                                    <span style={{ 
                                        fontSize: '12px', 
                                        color: theme.colors.mutedText,
                                        backgroundColor: theme.colors.tertiaryBg || theme.colors.primaryBg,
                                        padding: '4px 10px',
                                        borderRadius: '12px',
                                    }}>
                                        {neuronIds.length} neuron{neuronIds.length !== 1 ? 's' : ''}
                                    </span>
                                </div>
                                <span style={{ 
                                    fontSize: '18px',
                                    transform: neuronSectionExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                    transition: 'transform 0.2s ease',
                                    color: theme.colors.mutedText,
                                }}>
                                    ▼
                                </span>
                            </button>
                            
                            {/* Section Content */}
                            {neuronSectionExpanded && (
                                <div style={{ 
                                    border: `1px solid ${theme.colors.border}`,
                                    borderTop: 'none',
                                    borderRadius: '0 0 12px 12px',
                                    overflow: 'hidden',
                                    padding: '20px',
                                }}>

                        {/* Success/Error Messages */}
                        {success && (
                            <div style={{ 
                                backgroundColor: `${theme.colors.success || '#22c55e'}20`, 
                                border: `1px solid ${theme.colors.success || '#22c55e'}`,
                                color: theme.colors.success || '#22c55e',
                                padding: '15px',
                                borderRadius: '8px',
                                marginBottom: '20px',
                            }}>
                                {success}
                            </div>
                        )}
                        {error && (
                            <div style={{ 
                                backgroundColor: `${theme.colors.error}20`, 
                                border: `1px solid ${theme.colors.error}`,
                                color: theme.colors.error,
                                padding: '15px',
                                borderRadius: '8px',
                                marginBottom: '20px',
                            }}>
                                {error}
                            </div>
                        )}

                        {/* Neuron Selector - when there are multiple neurons */}
                        {neuronIds.length > 0 && (
                            <div style={cardStyle}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                                    <div>
                                        <h3 style={{ color: theme.colors.primaryText, margin: '0 0 5px 0' }}>
                                            {neuronIds.length} Neuron{neuronIds.length > 1 ? 's' : ''} Managed
                                        </h3>
                                        <p style={{ color: theme.colors.mutedText, fontSize: '12px', margin: 0 }}>
                                            Select a neuron to manage
                                        </p>
                                    </div>
                                    <select
                                        value={selectedNeuronId ? selectedNeuronId.id.toString() : ''}
                                        onChange={(e) => {
                                            const found = neuronIds.find(n => n.id.toString() === e.target.value);
                                            handleNeuronSelect(found);
                                        }}
                                        style={{
                                            ...inputStyle,
                                            width: 'auto',
                                            minWidth: '200px',
                                        }}
                                    >
                                        {neuronIds.map((n) => (
                                            <option key={n.id.toString()} value={n.id.toString()}>
                                                Neuron #{n.id.toString()}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                
                                {/* Neuron list */}
                                <div style={{ marginTop: '15px', maxHeight: '200px', overflowY: 'auto' }}>
                                    {neuronIds.map((n) => (
                                        <div 
                                            key={n.id.toString()} 
                                            style={{ 
                                                display: 'flex', 
                                                justifyContent: 'space-between', 
                                                alignItems: 'center',
                                                padding: '8px 12px',
                                                background: selectedNeuronId && selectedNeuronId.id === n.id ? `${theme.colors.accent}20` : 'transparent',
                                                borderRadius: '6px',
                                                marginBottom: '4px',
                                                cursor: 'pointer',
                                            }}
                                            onClick={() => handleNeuronSelect(n)}
                                        >
                                            <span style={{ color: theme.colors.primaryText, fontFamily: 'monospace' }}>
                                                Neuron #{n.id.toString()}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Create Neuron Section */}
                        <div style={cardStyle}>
                            <h2 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>
                                {neuronIds.length === 0 ? 'Create Your First Neuron' : 'Create Another Neuron'}
                            </h2>
                            
                            {/* Create new neuron */}
                            <div style={{ marginBottom: '20px' }}>
                                <h4 style={{ color: theme.colors.primaryText, marginBottom: '10px', fontSize: '14px' }}>
                                    🆕 Stake to Create New Neuron
                                </h4>
                                <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '15px' }}>
                                    <div style={{ flex: 1, minWidth: '150px' }}>
                                        <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                            Amount to Stake (ICP)
                                        </label>
                                        <input
                                            type="number"
                                            min="1"
                                            step="0.01"
                                            value={stakeAmount}
                                            onChange={(e) => setStakeAmount(e.target.value)}
                                            style={inputStyle}
                                            placeholder="1.0"
                                        />
                                    </div>
                                    <div style={{ flex: 1, minWidth: '150px' }}>
                                        <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                            Dissolve Delay (days)
                                        </label>
                                        <input
                                            type="number"
                                            min="183"
                                            max="2922"
                                            value={stakeDissolveDelay}
                                            onChange={(e) => setStakeDissolveDelay(e.target.value)}
                                            style={inputStyle}
                                            placeholder="365"
                                        />
                                    </div>
                                    <button
                                        onClick={handleStakeNeuron}
                                        disabled={actionLoading === 'stake' || !userIcpBalance || userIcpBalance < E8S}
                                        style={{ 
                                            ...buttonStyle, 
                                            opacity: (actionLoading === 'stake' || !userIcpBalance || userIcpBalance < E8S) ? 0.6 : 1,
                                        }}
                                    >
                                        {actionLoading === 'stake' ? '⏳...' : '🚀 Create'}
                                    </button>
                                </div>
                                <p style={{ color: theme.colors.mutedText, fontSize: '11px', margin: 0 }}>
                                    💡 Min 183 days to vote, max 8 years. Stakes directly from your wallet ({formatIcp(userIcpBalance)} ICP available)
                                </p>
                            </div>
                        </div>

                        {/* Selected Neuron - Show tabs */}
                        {selectedNeuronId && (
                            <>
                                {/* Neuron Summary */}
                                <div style={cardStyle}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                        <h2 style={{ color: theme.colors.primaryText, margin: 0 }}>Neuron #{selectedNeuronId.id.toString()}</h2>
                                        {neuronInfo && (
                                            <span style={{
                                                background: getNeuronState(neuronInfo.state).color,
                                                color: '#fff',
                                                padding: '4px 12px',
                                                borderRadius: '20px',
                                                fontSize: '12px',
                                                fontWeight: '600',
                                            }}>
                                                {getNeuronState(neuronInfo.state).label}
                                            </span>
                                        )}
                                    </div>
                                    
                                    {neuronInfo && (
                                        <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
                                            <div style={statBoxStyle}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '11px' }}>Stake</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '700' }}>
                                                    {formatIcp(Number(neuronInfo.stake_e8s))} ICP
                                                </div>
                                            </div>
                                            <div style={statBoxStyle}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '11px' }}>Voting Power</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '700' }}>
                                                    {formatIcp(Number(neuronInfo.voting_power))}
                                                </div>
                                            </div>
                                            <div style={statBoxStyle}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '11px' }}>Dissolve Delay</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '700' }}>
                                                    {formatDuration(Number(neuronInfo.dissolve_delay_seconds))}
                                                </div>
                                            </div>
                                            <div style={statBoxStyle}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '11px' }}>Age</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '700' }}>
                                                    {formatDuration(Number(neuronInfo.age_seconds))}
                                                </div>
                                            </div>
                                            {fullNeuron && (
                                                <div style={statBoxStyle}>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '11px' }}>Maturity</div>
                                                    <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '700' }}>
                                                        {formatIcp(Number(fullNeuron.maturity_e8s_equivalent))} ICP
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Tabs */}
                                <div style={{ display: 'flex', borderBottom: `1px solid ${theme.colors.border}`, marginBottom: '20px', flexWrap: 'wrap' }}>
                                    <button style={tabStyle(activeTab === 'overview')} onClick={() => setActiveTab('overview')}>
                                        Overview
                                    </button>
                                    <button style={tabStyle(activeTab === 'stake')} onClick={() => setActiveTab('stake')}>
                                        Stake
                                    </button>
                                    <button style={tabStyle(activeTab === 'maturity')} onClick={() => setActiveTab('maturity')}>
                                        Maturity
                                    </button>
                                    <button style={tabStyle(activeTab === 'following')} onClick={() => setActiveTab('following')}>
                                        Following
                                    </button>
                                    <button style={tabStyle(activeTab === 'dissolve')} onClick={() => setActiveTab('dissolve')}>
                                        Dissolve
                                    </button>
                                    <button style={tabStyle(activeTab === 'disburse')} onClick={() => setActiveTab('disburse')}>
                                        Disburse
                                    </button>
                                    <button style={tabStyle(activeTab === 'hotkeys')} onClick={() => setActiveTab('hotkeys')}>
                                        Hot Keys
                                    </button>
                                    <button style={tabStyle(activeTab === 'advanced')} onClick={() => setActiveTab('advanced')}>
                                        Advanced
                                    </button>
                                </div>

                                {/* Tab Content */}
                                {activeTab === 'overview' && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Neuron Overview</h3>
                                        
                                        {/* Dissolving Status Alert */}
                                        {neuronInfo && neuronInfo.state === 2 && (
                                            <div style={{ 
                                                background: `${theme.colors.warning || '#f59e0b'}15`, 
                                                border: `1px solid ${theme.colors.warning || '#f59e0b'}40`,
                                                padding: '12px 15px', 
                                                borderRadius: '8px',
                                                marginBottom: '15px'
                                            }}>
                                                <div style={{ 
                                                    display: 'flex', 
                                                    alignItems: 'center', 
                                                    gap: '8px',
                                                    color: theme.colors.warning || '#f59e0b',
                                                    fontWeight: '600',
                                                    fontSize: '14px',
                                                    marginBottom: '4px'
                                                }}>
                                                    ⏳ Dissolving
                                                </div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '13px' }}>
                                                    <strong>{formatDuration(Number(neuronInfo.dissolve_delay_seconds))}</strong> remaining until dissolved
                                                </div>
                                            </div>
                                        )}

                                        {/* Details Grid */}
                                        <div style={{ display: 'grid', gap: '8px' }}>
                                            {fullNeuron && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${theme.colors.border}` }}>
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>Visibility</span>
                                                    <span style={{ 
                                                        color: fullNeuron.visibility?.[0] === 2 ? (theme.colors.success || '#22c55e') : theme.colors.primaryText, 
                                                        fontSize: '13px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px'
                                                    }}>
                                                        {fullNeuron.visibility?.[0] === 2 ? '🌐 Public' : '🔒 Private'}
                                                    </span>
                                                </div>
                                            )}
                                            {fullNeuron && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${theme.colors.border}` }}>
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>Controller</span>
                                                    <span style={{ color: theme.colors.primaryText, fontFamily: 'monospace', fontSize: '12px' }}>
                                                        {fullNeuron.controller?.[0]?.toText() 
                                                            ? `${fullNeuron.controller[0].toText().slice(0, 10)}...${fullNeuron.controller[0].toText().slice(-5)}`
                                                            : 'N/A'}
                                                    </span>
                                                </div>
                                            )}
                                            {fullNeuron && (
                                                <>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${theme.colors.border}` }}>
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>Available Maturity</span>
                                                        <span style={{ color: theme.colors.primaryText, fontSize: '13px' }}>
                                                            {formatIcp(Number(fullNeuron.maturity_e8s_equivalent))} ICP
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${theme.colors.border}` }}>
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>Staked Maturity</span>
                                                        <span style={{ color: theme.colors.primaryText, fontSize: '13px' }}>
                                                            {fullNeuron.staked_maturity_e8s_equivalent?.[0] 
                                                                ? formatIcp(Number(fullNeuron.staked_maturity_e8s_equivalent[0])) + ' ICP' 
                                                                : '0 ICP'}
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${theme.colors.border}` }}>
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>Hotkeys</span>
                                                        <span style={{ color: theme.colors.primaryText, fontSize: '13px' }}>
                                                            {fullNeuron.hot_keys?.length || 0}
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>Following Topics</span>
                                                        <span style={{ color: theme.colors.primaryText, fontSize: '13px' }}>
                                                            {fullNeuron.followees?.length || 0}
                                                        </span>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                        
                                        {/* Link to IC Dashboard */}
                                        {selectedNeuronId && (
                                            <div style={{ marginTop: '15px' }}>
                                                <a 
                                                    href={`https://dashboard.internetcomputer.org/neuron/${selectedNeuronId.id.toString()}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{ 
                                                        color: theme.colors.accent, 
                                                        fontSize: '13px',
                                                        textDecoration: 'none',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '6px'
                                                    }}
                                                    onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                                    onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                                >
                                                    🔗 View on IC Dashboard →
                                                </a>
                                            </div>
                                        )}
                                        
                                        <div style={{ marginTop: '15px' }}>
                                            <button 
                                                onClick={fetchManagerData}
                                                style={secondaryButtonStyle}
                                            >
                                                🔄 Refresh Data
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'dissolve' && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Dissolve Management</h3>
                                        
                                        {/* Current dissolve delay info */}
                                        {neuronInfo && (
                                            <div style={{ 
                                                background: `${theme.colors.accent}10`, 
                                                padding: '12px', 
                                                borderRadius: '8px', 
                                                marginBottom: '20px' 
                                            }}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Current Dissolve Delay</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '600' }}>
                                                    {formatDuration(Number(neuronInfo.dissolve_delay_seconds))}
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '12px', marginLeft: '8px' }}>
                                                        ({Math.floor(Number(neuronInfo.dissolve_delay_seconds) / 86400)} days)
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Increase Dissolve Delay */}
                                        <div style={{ marginBottom: '25px' }}>
                                            <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Increase Dissolve Delay</h4>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '10px' }}>
                                                <strong>Note:</strong> This <em>adds</em> to your current delay. Max total is 8 years (2922 days).
                                            </p>
                                            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                                <div style={{ flex: 1, minWidth: '150px' }}>
                                                    <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                                                        Days to Add
                                                    </label>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        max="2922"
                                                        value={dissolveDelay}
                                                        onChange={(e) => setDissolveDelay(e.target.value)}
                                                        style={inputStyle}
                                                        placeholder="e.g., 365"
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleSetDissolveDelay}
                                                    disabled={actionLoading === 'dissolve'}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        opacity: actionLoading === 'dissolve' ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'dissolve' ? '⏳...' : '+ Add Days'}
                                                </button>
                                            </div>
                                            {dissolveDelay && neuronInfo && (
                                                <p style={{ color: theme.colors.accent, fontSize: '12px', marginTop: '8px' }}>
                                                    New total will be: {formatDuration(Number(neuronInfo.dissolve_delay_seconds) + parseInt(dissolveDelay) * 86400)}
                                                </p>
                                            )}
                                        </div>

                                        {/* Start/Stop Dissolving */}
                                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                            {/* State 1 = Locked, State 2 = Dissolving, State 3 = Dissolved */}
                                            <button
                                                onClick={handleStartDissolving}
                                                disabled={actionLoading === 'startDissolve' || !neuronInfo || neuronInfo.state !== 1}
                                                style={{ 
                                                    ...buttonStyle,
                                                    background: theme.colors.warning || '#f59e0b',
                                                    opacity: (actionLoading === 'startDissolve' || !neuronInfo || neuronInfo.state !== 1) ? 0.5 : 1,
                                                    cursor: (!neuronInfo || neuronInfo.state !== 1) ? 'not-allowed' : 'pointer',
                                                }}
                                            >
                                                {actionLoading === 'startDissolve' ? '⏳...' : '⏳ Start Dissolving'}
                                            </button>
                                            <button
                                                onClick={handleStopDissolving}
                                                disabled={actionLoading === 'stopDissolve' || !neuronInfo || neuronInfo.state !== 2}
                                                style={{ 
                                                    ...secondaryButtonStyle,
                                                    opacity: (actionLoading === 'stopDissolve' || !neuronInfo || neuronInfo.state !== 2) ? 0.5 : 1,
                                                    cursor: (!neuronInfo || neuronInfo.state !== 2) ? 'not-allowed' : 'pointer',
                                                }}
                                            >
                                                {actionLoading === 'stopDissolve' ? '⏳...' : '⏹️ Stop Dissolving'}
                                            </button>
                                        </div>
                                        {neuronInfo && neuronInfo.state === 3 && (
                                            <p style={{ color: theme.colors.success || '#22c55e', fontSize: '13px', marginTop: '10px' }}>
                                                ✅ Neuron is fully dissolved and ready to disburse.
                                            </p>
                                        )}
                                    </div>
                                )}

                                {activeTab === 'stake' && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Stake Management</h3>
                                        
                                        {/* Current stake info */}
                                        {neuronInfo && (
                                            <div style={{ 
                                                background: `${theme.colors.accent}10`, 
                                                padding: '12px', 
                                                borderRadius: '8px', 
                                                marginBottom: '20px',
                                            }}>
                                                <div>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Current Stake</div>
                                                    <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '600' }}>
                                                        {formatIcp(Number(neuronInfo.stake_e8s))} ICP
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Increase Stake */}
                                        <div style={{ marginBottom: '30px' }}>
                                            <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Increase Stake</h4>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '15px' }}>
                                                Add more ICP to your neuron directly from your wallet. More stake = more voting power.
                                            </p>
                                            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                                <div style={{ flex: 1, minWidth: '150px' }}>
                                                    <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                                        Amount (ICP)
                                                    </label>
                                                    <input
                                                        type="number"
                                                        min="0.0001"
                                                        step="0.01"
                                                        value={increaseStakeAmount}
                                                        onChange={(e) => setIncreaseStakeAmount(e.target.value)}
                                                        style={inputStyle}
                                                        placeholder="e.g., 1.0"
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleIncreaseStake}
                                                    disabled={actionLoading === 'increaseStake' || !userIcpBalance || userIcpBalance < E8S * 0.01}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        opacity: (actionLoading === 'increaseStake' || !userIcpBalance || userIcpBalance < E8S * 0.01) ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'increaseStake' ? '⏳...' : '➕ Add to Stake'}
                                                </button>
                                            </div>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '11px', marginTop: '8px' }}>
                                                Your wallet: {formatIcp(userIcpBalance)} ICP available
                                            </p>
                                            
                                            {/* Manual Refresh Button */}
                                            <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: `1px dashed ${theme.colors.border}` }}>
                                                <button
                                                    onClick={handleManualRefreshStake}
                                                    disabled={actionLoading === 'refreshStake'}
                                                    style={{ 
                                                        background: 'transparent',
                                                        color: theme.colors.accent,
                                                        border: `1px solid ${theme.colors.accent}`,
                                                        borderRadius: '6px',
                                                        padding: '6px 12px',
                                                        fontSize: '12px',
                                                        cursor: actionLoading === 'refreshStake' ? 'not-allowed' : 'pointer',
                                                        opacity: actionLoading === 'refreshStake' ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'refreshStake' ? '⏳ Refreshing...' : '🔄 Refresh Stake from NNS'}
                                                </button>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '10px', marginTop: '5px', marginBottom: 0 }}>
                                                    Use this if you sent ICP to the neuron externally or if stake doesn't update automatically
                                                </p>
                                            </div>
                                        </div>

                                        {/* Auto-stake Maturity */}
                                        <div style={{ borderTop: `1px solid ${theme.colors.border}`, paddingTop: '20px' }}>
                                            <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Auto-Stake Maturity</h4>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '15px' }}>
                                                When enabled, maturity rewards are automatically staked to your neuron instead of accumulating.
                                            </p>
                                            
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    padding: '10px 15px',
                                                    background: `${theme.colors.accent}10`,
                                                    borderRadius: '8px',
                                                }}>
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>Current:</span>
                                                    <span style={{ 
                                                        color: fullNeuron?.auto_stake_maturity?.[0] ? (theme.colors.success || '#22c55e') : theme.colors.mutedText,
                                                        fontWeight: '600',
                                                    }}>
                                                        {fullNeuron?.auto_stake_maturity?.[0] ? '✅ Enabled' : '❌ Disabled'}
                                                    </span>
                                                </div>
                                                
                                                {fullNeuron?.auto_stake_maturity?.[0] ? (
                                                    <button
                                                        onClick={() => handleToggleAutoStakeMaturity(false)}
                                                        disabled={actionLoading === 'autoStake'}
                                                        style={{ 
                                                            ...secondaryButtonStyle, 
                                                            opacity: actionLoading === 'autoStake' ? 0.6 : 1,
                                                        }}
                                                    >
                                                        {actionLoading === 'autoStake' ? '⏳...' : 'Disable'}
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleToggleAutoStakeMaturity(true)}
                                                        disabled={actionLoading === 'autoStake'}
                                                        style={{ 
                                                            ...buttonStyle, 
                                                            opacity: actionLoading === 'autoStake' ? 0.6 : 1,
                                                        }}
                                                    >
                                                        {actionLoading === 'autoStake' ? '⏳...' : 'Enable'}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'maturity' && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Maturity Management</h3>
                                        
                                        {/* Current maturity info */}
                                        <div style={{ 
                                            background: `${theme.colors.accent}10`, 
                                            padding: '15px', 
                                            borderRadius: '8px', 
                                            marginBottom: '25px',
                                            display: 'flex',
                                            gap: '30px',
                                            flexWrap: 'wrap',
                                        }}>
                                            <div>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Available Maturity</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '20px', fontWeight: '700' }}>
                                                    {fullNeuron ? formatIcp(Number(fullNeuron.maturity_e8s_equivalent)) : '...'} ICP
                                                </div>
                                            </div>
                                            <div>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Staked Maturity</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '20px', fontWeight: '700' }}>
                                                    {fullNeuron?.staked_maturity_e8s_equivalent?.[0] 
                                                        ? formatIcp(Number(fullNeuron.staked_maturity_e8s_equivalent[0])) 
                                                        : '0.00'} ICP
                                                </div>
                                            </div>
                                            <div>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Auto-Stake</div>
                                                <div style={{ 
                                                    color: fullNeuron?.auto_stake_maturity?.[0] ? (theme.colors.success || '#22c55e') : theme.colors.mutedText,
                                                    fontSize: '20px', 
                                                    fontWeight: '700' 
                                                }}>
                                                    {fullNeuron?.auto_stake_maturity?.[0] ? 'On' : 'Off'}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Percentage input */}
                                        <div style={{ marginBottom: '20px' }}>
                                            <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                                Percentage of Maturity
                                            </label>
                                            <input
                                                type="number"
                                                min="1"
                                                max="100"
                                                value={maturityPercentage}
                                                onChange={(e) => setMaturityPercentage(e.target.value)}
                                                style={{ ...inputStyle, maxWidth: '150px' }}
                                                placeholder="100"
                                            />
                                            <span style={{ color: theme.colors.mutedText, fontSize: '12px', marginLeft: '8px' }}>%</span>
                                        </div>

                                        {/* Maturity Actions */}
                                        <div style={{ display: 'grid', gap: '20px' }}>
                                            {/* Stake Maturity */}
                                            <div style={{ padding: '15px', border: `1px solid ${theme.colors.border}`, borderRadius: '8px' }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '8px' }}>Stake Maturity</h4>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '12px' }}>
                                                    Convert maturity to staked maturity. Staked maturity increases voting power but takes 7 days to become liquid.
                                                </p>
                                                <button
                                                    onClick={handleStakeMaturity}
                                                    disabled={actionLoading === 'stakeMaturity' || !fullNeuron || fullNeuron.maturity_e8s_equivalent === BigInt(0)}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        opacity: (actionLoading === 'stakeMaturity' || !fullNeuron || fullNeuron.maturity_e8s_equivalent === BigInt(0)) ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'stakeMaturity' ? '⏳...' : '📈 Stake Maturity'}
                                                </button>
                                            </div>

                                            {/* Merge Maturity */}
                                            <div style={{ padding: '15px', border: `1px solid ${theme.colors.border}`, borderRadius: '8px' }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '8px' }}>Merge Maturity</h4>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '12px' }}>
                                                    Merge maturity directly into your neuron's stake. Increases stake permanently.
                                                </p>
                                                <button
                                                    onClick={handleMergeMaturity}
                                                    disabled={actionLoading === 'mergeMaturity' || !fullNeuron || fullNeuron.maturity_e8s_equivalent === BigInt(0)}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        opacity: (actionLoading === 'mergeMaturity' || !fullNeuron || fullNeuron.maturity_e8s_equivalent === BigInt(0)) ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'mergeMaturity' ? '⏳...' : '🔄 Merge into Stake'}
                                                </button>
                                            </div>

                                            {/* Spawn Maturity */}
                                            <div style={{ padding: '15px', border: `1px solid ${theme.colors.border}`, borderRadius: '8px' }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '8px' }}>Spawn New Neuron</h4>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '12px' }}>
                                                    Create a new neuron from your maturity. Requires at least 1 ICP equivalent in maturity.
                                                </p>
                                                <div style={{ marginBottom: '12px' }}>
                                                    <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                                                        Controller (optional, defaults to this canister)
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={spawnController}
                                                        onChange={(e) => setSpawnController(e.target.value)}
                                                        style={inputStyle}
                                                        placeholder="Principal ID (optional)"
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleSpawnMaturity}
                                                    disabled={actionLoading === 'spawnMaturity' || !fullNeuron || Number(fullNeuron.maturity_e8s_equivalent) < E8S}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        opacity: (actionLoading === 'spawnMaturity' || !fullNeuron || Number(fullNeuron.maturity_e8s_equivalent) < E8S) ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'spawnMaturity' ? '⏳...' : '🐣 Spawn Neuron'}
                                                </button>
                                                {fullNeuron && Number(fullNeuron.maturity_e8s_equivalent) < E8S && (
                                                    <p style={{ color: theme.colors.warning || '#f59e0b', fontSize: '11px', marginTop: '8px' }}>
                                                        Need at least 1 ICP equivalent in maturity to spawn.
                                                    </p>
                                                )}
                                            </div>

                                            {/* Disburse Maturity */}
                                            <div style={{ padding: '15px', border: `1px solid ${theme.colors.border}`, borderRadius: '8px' }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '8px' }}>Disburse Maturity</h4>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '12px' }}>
                                                    Convert maturity to ICP and withdraw it. Subject to a 7-day modulation period.
                                                </p>
                                                <div style={{ marginBottom: '12px' }}>
                                                    <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                                                        Destination (optional, defaults to this canister)
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={disburseMaturityDestination}
                                                        onChange={(e) => setDisburseMaturityDestination(e.target.value)}
                                                        style={inputStyle}
                                                        placeholder="Principal ID (optional)"
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleDisburseMaturity}
                                                    disabled={actionLoading === 'disburseMaturity' || !fullNeuron || fullNeuron.maturity_e8s_equivalent === BigInt(0)}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        background: theme.colors.warning || '#f59e0b',
                                                        opacity: (actionLoading === 'disburseMaturity' || !fullNeuron || fullNeuron.maturity_e8s_equivalent === BigInt(0)) ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'disburseMaturity' ? '⏳...' : '💸 Disburse Maturity'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'following' && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Following Management</h3>
                                        <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '20px' }}>
                                            Set neurons to follow for automatic voting. Your neuron will vote the same way as your followees.
                                            Following the DFINITY Foundation neuron (27) is common for governance topics.
                                        </p>
                                        
                                        {/* Current followees */}
                                        {fullNeuron && fullNeuron.followees && fullNeuron.followees.length > 0 && (
                                            <div style={{ marginBottom: '25px' }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Current Following</h4>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '15px' }}>
                                                    {fullNeuron.followees.map(([topicId, followeesData]) => {
                                                        const topicInfo = NNS_TOPICS.find(t => t.id === topicId);
                                                        return (
                                                            <div key={topicId} style={{
                                                                background: `${theme.colors.accent}10`,
                                                                padding: '10px',
                                                                borderRadius: '6px',
                                                            }}>
                                                                <div style={{ color: theme.colors.primaryText, fontWeight: '500', fontSize: '13px' }}>
                                                                    {topicInfo?.name || `Topic ${topicId}`}
                                                                </div>
                                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginTop: '4px' }}>
                                                                    Following: {followeesData.followees.map(f => formatNeuronId(f.id)).join(', ') || 'None'}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                
                                                {/* Confirmation status */}
                                                {(() => {
                                                    const status = getFollowingConfirmationStatus(fullNeuron);
                                                    return (
                                                        <div style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '10px',
                                                            padding: '12px',
                                                            borderRadius: '8px',
                                                            marginBottom: '15px',
                                                            background: status.isUrgent 
                                                                ? `${theme.colors.warning || '#f59e0b'}20`
                                                                : `${theme.colors.green || '#22c55e'}20`,
                                                            border: `1px solid ${status.isUrgent 
                                                                ? (theme.colors.warning || '#f59e0b')
                                                                : (theme.colors.green || '#22c55e')}`,
                                                        }}>
                                                            <span style={{ fontSize: '20px' }}>
                                                                {status.isUrgent ? '⚠️' : '✅'}
                                                            </span>
                                                            <div>
                                                                <div style={{ 
                                                                    color: status.isUrgent 
                                                                        ? (theme.colors.warning || '#f59e0b')
                                                                        : (theme.colors.green || '#22c55e'),
                                                                    fontWeight: '600',
                                                                    fontSize: '14px',
                                                                }}>
                                                                    {status.secondsRemaining > 0 ? 'Active neuron' : 'Inactive neuron'}
                                                                </div>
                                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                                                    {status.text}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                                
                                                <button
                                                    onClick={handleConfirmFollowing}
                                                    disabled={actionLoading === 'confirmFollowing'}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        opacity: actionLoading === 'confirmFollowing' ? 0.6 : 1,
                                                        background: theme.colors.green || '#22c55e',
                                                    }}
                                                >
                                                    {actionLoading === 'confirmFollowing' ? '⏳ Confirming...' : '✅ Confirm Following'}
                                                </button>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '11px', marginTop: '8px' }}>
                                                    Neurons must confirm following every ~6 months to remain active for automatic voting.
                                                </p>
                                            </div>
                                        )}

                                        {/* Set new following */}
                                        <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Set Following</h4>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                            <div>
                                                <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                                    Topic
                                                </label>
                                                <select
                                                    value={selectedTopic}
                                                    onChange={(e) => setSelectedTopic(parseInt(e.target.value))}
                                                    style={{ 
                                                        ...inputStyle, 
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    {NNS_TOPICS.map(topic => (
                                                        <option key={topic.id} value={topic.id}>
                                                            {topic.isCritical ? '⚠️ ' : ''}{topic.name}
                                                        </option>
                                                    ))}
                                                </select>
                                                {(() => {
                                                    const topic = NNS_TOPICS.find(t => t.id === selectedTopic);
                                                    return (
                                                        <p style={{ 
                                                            color: topic?.isCritical ? (theme.colors.warning || '#f59e0b') : theme.colors.mutedText, 
                                                            fontSize: '11px', 
                                                            marginTop: '4px' 
                                                        }}>
                                                            {topic?.isCritical && '⚠️ Critical topic - following is NOT inherited from "All Topics". '}
                                                            {topic?.description}
                                                        </p>
                                                    );
                                                })()}
                                            </div>
                                            <div>
                                                <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                                    Select Neurons to Follow
                                                </label>
                                                
                                                {/* Known neurons dropdown */}
                                                <select
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        if (val && val !== '__clear__') {
                                                            // Add to existing (avoid duplicates)
                                                            const existing = followeeIds.split(',').map(s => s.trim()).filter(s => s);
                                                            if (!existing.includes(val)) {
                                                                setFolloweeIds(existing.length > 0 ? `${followeeIds}, ${val}` : val);
                                                            }
                                                        } else if (val === '__clear__') {
                                                            setFolloweeIds('');
                                                        }
                                                        e.target.value = ''; // Reset dropdown
                                                    }}
                                                    style={{ 
                                                        ...inputStyle, 
                                                        cursor: 'pointer',
                                                        marginBottom: '10px',
                                                    }}
                                                    defaultValue=""
                                                >
                                                    <option value="" disabled>+ Add known neuron...</option>
                                                    <option value="__clear__">🗑️ Clear all followees</option>
                                                    <option disabled>──────────────</option>
                                                    {Object.entries(knownNeurons)
                                                        .sort((a, b) => a[1].localeCompare(b[1]))
                                                        .map(([id, name]) => (
                                                            <option key={id} value={id}>
                                                                {name} ({id})
                                                            </option>
                                                        ))
                                                    }
                                                </select>
                                                
                                                {/* Current selection / manual input */}
                                                <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                                                    Selected neurons (or enter custom IDs, comma-separated):
                                                </label>
                                                <input
                                                    type="text"
                                                    value={followeeIds}
                                                    onChange={(e) => setFolloweeIds(e.target.value)}
                                                    style={inputStyle}
                                                    placeholder="Leave empty to clear following for this topic"
                                                />
                                                
                                                {/* Show selected as pills */}
                                                {followeeIds && (
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                                                        {followeeIds.split(',').map(s => s.trim()).filter(s => s).map((id, idx) => (
                                                            <span 
                                                                key={idx}
                                                                style={{
                                                                    background: `${theme.colors.accent}20`,
                                                                    border: `1px solid ${theme.colors.accent}`,
                                                                    padding: '4px 8px',
                                                                    borderRadius: '16px',
                                                                    fontSize: '12px',
                                                                    color: theme.colors.primaryText,
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px',
                                                                }}
                                                            >
                                                                {knownNeurons[id] ? `${knownNeurons[id]}` : `Neuron ${id}`}
                                                                <button
                                                                    onClick={() => {
                                                                        const ids = followeeIds.split(',').map(s => s.trim()).filter(s => s && s !== id);
                                                                        setFolloweeIds(ids.join(', '));
                                                                    }}
                                                                    style={{
                                                                        background: 'transparent',
                                                                        border: 'none',
                                                                        color: theme.colors.mutedText,
                                                                        cursor: 'pointer',
                                                                        padding: '0',
                                                                        fontSize: '14px',
                                                                        lineHeight: 1,
                                                                    }}
                                                                >
                                                                    ×
                                                                </button>
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                                
                                                <p style={{ color: theme.colors.mutedText, fontSize: '11px', marginTop: '8px' }}>
                                                    {followeeIds ? '🔄 Setting these neurons as followees will replace any existing followees for this topic.' : '🗑️ Submitting with no neurons selected will clear following for this topic.'}
                                                </p>
                                            </div>
                                            <button
                                                onClick={handleSetFollowing}
                                                disabled={actionLoading === 'following'}
                                                style={{ 
                                                    ...buttonStyle, 
                                                    opacity: actionLoading === 'following' ? 0.6 : 1,
                                                    alignSelf: 'flex-start',
                                                    background: followeeIds ? theme.colors.accent : (theme.colors.error || '#ef4444'),
                                                }}
                                            >
                                                {actionLoading === 'following' ? '⏳...' : (followeeIds ? '✅ Set Following' : '🗑️ Clear Following')}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'disburse' && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Disburse Neuron</h3>
                                        
                                        {neuronInfo && neuronInfo.state !== 3 ? (
                                            <div style={{
                                                background: `${theme.colors.warning || '#f59e0b'}20`,
                                                border: `1px solid ${theme.colors.warning || '#f59e0b'}`,
                                                padding: '15px',
                                                borderRadius: '8px',
                                                marginBottom: '20px',
                                            }}>
                                                <p style={{ color: theme.colors.warning || '#f59e0b', margin: 0 }}>
                                                    ⚠️ Neuron must be fully dissolved before disbursing.
                                                    Current state: <strong>{getNeuronState(neuronInfo.state).label}</strong>
                                                </p>
                                                {neuronInfo.state === 1 && (
                                                    <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginTop: '8px', marginBottom: 0 }}>
                                                        Start dissolving first, then wait for the dissolve delay to complete.
                                                    </p>
                                                )}
                                                {neuronInfo.state === 2 && (
                                                    <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginTop: '8px', marginBottom: 0 }}>
                                                        Dissolving... {formatDuration(Number(neuronInfo.dissolve_delay_seconds))} remaining.
                                                    </p>
                                                )}
                                            </div>
                                        ) : (
                                            <>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '20px' }}>
                                                    Withdraw ICP from your dissolved neuron. Leave fields empty to disburse all to this canister.
                                                </p>
                                                
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                                    <div>
                                                        <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                                            Amount (ICP) - leave empty to disburse all
                                                        </label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            value={disburseAmount}
                                                            onChange={(e) => setDisburseAmount(e.target.value)}
                                                            style={inputStyle}
                                                            placeholder="All"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                                            Destination Account ID (hex) - leave empty to send to this canister
                                                        </label>
                                                        <input
                                                            type="text"
                                                            value={disburseToAccount}
                                                            onChange={(e) => setDisburseToAccount(e.target.value)}
                                                            style={inputStyle}
                                                            placeholder="64-character hex (optional)"
                                                        />
                                                    </div>
                                                    <button
                                                        onClick={handleDisburse}
                                                        disabled={actionLoading === 'disburse'}
                                                        style={{ 
                                                            ...buttonStyle, 
                                                            background: theme.colors.error || '#ef4444',
                                                            opacity: actionLoading === 'disburse' ? 0.6 : 1,
                                                            alignSelf: 'flex-start',
                                                        }}
                                                    >
                                                        {actionLoading === 'disburse' ? '⏳...' : '💸 Disburse'}
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}

                                {activeTab === 'advanced' && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Advanced Operations</h3>
                                        
                                        {/* Split Neuron */}
                                        <div style={{ padding: '15px', border: `1px solid ${theme.colors.border}`, borderRadius: '8px', marginBottom: '20px' }}>
                                            <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '8px' }}>✂️ Split Neuron</h4>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '15px' }}>
                                                Split this neuron into two. Specify the amount for the new neuron (minimum 1 ICP). 
                                                The new neuron will have the same controller and dissolve delay.
                                            </p>
                                            {neuronInfo && (
                                                <div style={{ 
                                                    background: `${theme.colors.accent}10`, 
                                                    padding: '10px', 
                                                    borderRadius: '6px', 
                                                    marginBottom: '15px' 
                                                }}>
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Current Stake: </span>
                                                    <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>{formatIcp(Number(neuronInfo.stake_e8s))} ICP</span>
                                                </div>
                                            )}
                                            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                                <div style={{ flex: 1, minWidth: '150px' }}>
                                                    <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                                                        Amount for New Neuron (ICP)
                                                    </label>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        step="0.01"
                                                        value={splitAmount}
                                                        onChange={(e) => setSplitAmount(e.target.value)}
                                                        style={inputStyle}
                                                        placeholder="Min 1 ICP"
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleSplitNeuron}
                                                    disabled={actionLoading === 'split' || !neuronInfo || Number(neuronInfo.stake_e8s) < 2 * E8S}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        background: theme.colors.warning || '#f59e0b',
                                                        opacity: (actionLoading === 'split' || !neuronInfo || Number(neuronInfo.stake_e8s) < 2 * E8S) ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'split' ? '⏳...' : '✂️ Split'}
                                                </button>
                                            </div>
                                            {neuronInfo && Number(neuronInfo.stake_e8s) < 2 * E8S && (
                                                <p style={{ color: theme.colors.warning || '#f59e0b', fontSize: '11px', marginTop: '8px' }}>
                                                    Need at least 2 ICP stake to split (1 ICP min for each neuron).
                                                </p>
                                            )}
                                        </div>

                                        {/* Merge Neurons */}
                                        <div style={{ padding: '15px', border: `1px solid ${theme.colors.border}`, borderRadius: '8px', marginBottom: '20px' }}>
                                            <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '8px' }}>🔗 Merge Neurons</h4>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '15px' }}>
                                                Merge another neuron into this one. Both neurons must:
                                            </p>
                                            <ul style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '15px', paddingLeft: '20px' }}>
                                                <li>Have the same controller</li>
                                                <li>Have no hotkeys</li>
                                                <li>Not be dissolving</li>
                                                <li>Not be in the Community Fund</li>
                                            </ul>
                                            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                                <div style={{ flex: 1, minWidth: '200px' }}>
                                                    <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                                                        Source Neuron ID (to merge FROM)
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={mergeSourceNeuronId}
                                                        onChange={(e) => setMergeSourceNeuronId(e.target.value)}
                                                        style={inputStyle}
                                                        placeholder="Neuron ID"
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleMergeNeurons}
                                                    disabled={actionLoading === 'merge'}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        background: theme.colors.warning || '#f59e0b',
                                                        opacity: actionLoading === 'merge' ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'merge' ? '⏳...' : '🔗 Merge'}
                                                </button>
                                            </div>
                                        </div>

                                        {/* Neuron Visibility */}
                                        <div style={{ padding: '15px', border: `1px solid ${theme.colors.border}`, borderRadius: '8px' }}>
                                            <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '8px' }}>
                                                {fullNeuron?.visibility?.[0] === 2 ? '🌐' : '🔒'} Neuron Visibility
                                            </h4>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '15px' }}>
                                                Control whether your neuron's voting history and details are publicly visible.
                                            </p>
                                            
                                            {fullNeuron && (
                                                <div style={{ 
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    background: fullNeuron.visibility?.[0] === 2 
                                                        ? `${theme.colors.success || '#22c55e'}15` 
                                                        : theme.colors.tertiaryBg || theme.colors.secondaryBg,
                                                    padding: '12px 15px',
                                                    borderRadius: '8px',
                                                    marginBottom: '15px'
                                                }}>
                                                    <div>
                                                        <div style={{ 
                                                            color: fullNeuron.visibility?.[0] === 2 
                                                                ? (theme.colors.success || '#22c55e') 
                                                                : theme.colors.primaryText,
                                                            fontWeight: '600',
                                                            fontSize: '14px'
                                                        }}>
                                                            {fullNeuron.visibility?.[0] === 2 ? '🌐 Public' : '🔒 Private'}
                                                        </div>
                                                        <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginTop: '2px' }}>
                                                            {fullNeuron.visibility?.[0] === 2 
                                                                ? 'Your neuron\'s voting history is visible to everyone'
                                                                : 'Your neuron\'s voting history is hidden'}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                                {fullNeuron?.visibility?.[0] !== 2 ? (
                                                    <button
                                                        onClick={() => handleSetVisibility(true)}
                                                        disabled={actionLoading === 'visibility'}
                                                        style={{ 
                                                            ...buttonStyle,
                                                            background: theme.colors.success || '#22c55e',
                                                            opacity: actionLoading === 'visibility' ? 0.6 : 1,
                                                        }}
                                                    >
                                                        {actionLoading === 'visibility' ? '⏳...' : '🌐 Make Public'}
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleSetVisibility(false)}
                                                        disabled={actionLoading === 'visibility'}
                                                        style={{ 
                                                            ...buttonStyle,
                                                            background: theme.colors.mutedText,
                                                            opacity: actionLoading === 'visibility' ? 0.6 : 1,
                                                        }}
                                                    >
                                                        {actionLoading === 'visibility' ? '⏳...' : '🔒 Make Private'}
                                                    </button>
                                                )}
                                            </div>
                                            
                                            <p style={{ color: theme.colors.mutedText, fontSize: '11px', marginTop: '10px', marginBottom: 0 }}>
                                                ⚠️ Note: Making your neuron public means anyone can see its voting history and other details on the NNS.
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'hotkeys' && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Hot Key Management</h3>
                                        <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '20px' }}>
                                            Hot keys can vote and manage following on behalf of this neuron, but cannot disburse or change dissolve settings.
                                        </p>
                                        
                                        {/* Current Hot Keys */}
                                        {fullNeuron && fullNeuron.hot_keys && fullNeuron.hot_keys.length > 0 && (
                                            <div style={{ marginBottom: '20px' }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Current Hot Keys</h4>
                                                {fullNeuron.hot_keys.map((key, idx) => (
                                                    <div key={idx} style={{ 
                                                        display: 'flex', 
                                                        justifyContent: 'space-between', 
                                                        alignItems: 'center',
                                                        padding: '8px',
                                                        background: `${theme.colors.accent}10`,
                                                        borderRadius: '4px',
                                                        marginBottom: '8px',
                                                    }}>
                                                        <span style={{ color: theme.colors.primaryText, fontFamily: 'monospace', fontSize: '12px' }}>
                                                            {key.toText()}
                                                        </span>
                                                        <button
                                                            onClick={() => handleRemoveHotKey(key)}
                                                            disabled={actionLoading === 'removeHotKey'}
                                                            style={{ 
                                                                ...secondaryButtonStyle, 
                                                                padding: '4px 12px', 
                                                                fontSize: '12px',
                                                                color: theme.colors.error,
                                                                borderColor: theme.colors.error,
                                                            }}
                                                        >
                                                            Remove
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Add Hot Key */}
                                        <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Add Hot Key</h4>
                                        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                            <div style={{ flex: 1, minWidth: '250px' }}>
                                                <input
                                                    type="text"
                                                    value={hotKeyPrincipal}
                                                    onChange={(e) => setHotKeyPrincipal(e.target.value)}
                                                    style={inputStyle}
                                                    placeholder="Principal ID"
                                                />
                                            </div>
                                            <button
                                                onClick={handleAddHotKey}
                                                disabled={actionLoading === 'addHotKey'}
                                                style={{ 
                                                    ...buttonStyle, 
                                                    opacity: actionLoading === 'addHotKey' ? 0.6 : 1,
                                                }}
                                            >
                                                {actionLoading === 'addHotKey' ? '⏳...' : '➕ Add Hot Key'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}

export default IcpNeuronManager;

