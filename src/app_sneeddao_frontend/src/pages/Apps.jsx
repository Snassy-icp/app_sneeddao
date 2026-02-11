import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import PrincipalInput from '../components/PrincipalInput';
import { useTheme } from '../contexts/ThemeContext';
import { Principal } from '@dfinity/principal';
import { HttpAgent, Actor } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { getCanisterGroups, setCanisterGroups, convertGroupsFromBackend, getTrackedCanisters, registerTrackedCanister, unregisterTrackedCanister, getCanisterInfo } from '../utils/BackendUtils';
import { createActor as createBackendActor, canisterId as BACKEND_CANISTER_ID } from 'declarations/app_sneeddao_backend';
import { usePremiumStatus } from '../hooks/usePremiumStatus';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext, getCanisterTypeIcon, isSnsCanisterType, SnsPill } from '../utils/PrincipalUtils';
import { useNaming } from '../NamingContext';
import { FaPlus, FaTrash, FaCube, FaSpinner, FaChevronDown, FaChevronRight, FaBrain, FaFolder, FaFolderOpen, FaEdit, FaCheck, FaTimes, FaCrown, FaLock, FaStar, FaArrowRight, FaWallet, FaQuestionCircle, FaBox, FaExclamationTriangle, FaBolt } from 'react-icons/fa';
import { uint8ArrayToHex } from '../utils/NeuronUtils';
import { useNavigate } from 'react-router-dom';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneed_icp_neuron_manager_factory';
import { createActor as createManagerActor } from 'declarations/sneed_icp_neuron_manager';
import { getCyclesColor, formatCyclesCompact, getNeuronManagerSettings, getCanisterManagerSettings } from '../utils/NeuronManagerSettings';
import { buildSnsCanisterToRootMap, fetchSnsCyclesFromRoot, getSnsById } from '../utils/SnsUtils';
import { getLogoSync } from '../hooks/useLogoCache';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import UpgradeBotsDialog from '../components/UpgradeBotsDialog';
import TopUpCyclesDialog from '../components/TopUpCyclesDialog';

// Drag item types for react-dnd
const DragItemTypes = {
    CANISTER: 'canister',
    GROUP: 'group',
};

// Droppable section wrapper component for react-dnd
const DroppableSection = ({ targetType, targetId = null, onDrop, canDropItem, children, style, className }) => {
    const [{ isOver, canDrop }, drop] = useDrop(() => ({
        accept: [DragItemTypes.CANISTER, DragItemTypes.GROUP],
        canDrop: (item) => canDropItem(item, targetType, targetId),
        drop: (item, monitor) => {
            if (monitor.didDrop()) return;
            onDrop(item, targetType, targetId);
        },
        collect: (monitor) => ({
            isOver: monitor.isOver({ shallow: true }),
            canDrop: monitor.canDrop(),
        }),
    }), [targetType, targetId, canDropItem, onDrop]);

    return (
        <div ref={drop} style={style} className={className} data-is-over={isOver && canDrop}>
            {typeof children === 'function' ? children({ isOver: isOver && canDrop, canDrop }) : children}
        </div>
    );
};

// Draggable item wrapper component for react-dnd
const DraggableItem = ({ type, id, sourceGroupId, children, style }) => {
    const [{ isDragging }, drag] = useDrag(() => ({
        type: type === 'canister' ? DragItemTypes.CANISTER : DragItemTypes.GROUP,
        item: { type, id, sourceGroupId },
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
    }), [type, id, sourceGroupId]);

    return (
        <div ref={drag} style={{ ...style, opacity: isDragging ? 0.4 : 1, cursor: isDragging ? 'grabbing' : 'grab' }}>
            {typeof children === 'function' ? children({ isDragging }) : children}
        </div>
    );
};

// Custom CSS for animations
const customStyles = `
@keyframes fadeInUp {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.canister-float {
    animation: float 3s ease-in-out infinite;
}

.canister-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}
`;

// Page accent colors
const canisterPrimary = '#8b5cf6'; // Purple
const canisterSecondary = '#a78bfa';
const canisterAccent = '#c4b5fd';

const MANAGEMENT_CANISTER_ID = Principal.fromText('aaaaa-aa');

// Management canister IDL factory for canister_status
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
    return IDL.Service({
        'canister_status': IDL.Func(
            [IDL.Record({ 'canister_id': IDL.Principal })],
            [canister_status_result],
            []
        ),
    });
};

export default function AppsPage() {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const { principalNames, principalNicknames, verifiedNames, principalCanisterTypes } = useNaming();
    const navigate = useNavigate();
    
    // Premium status for folder limits
    const { isPremium, loading: loadingPremium } = usePremiumStatus(identity);
    
    // Canister groups limits
    const [groupLimits, setGroupLimits] = useState(null);
    const [groupUsage, setGroupUsage] = useState(null);
    
    // Premium upgrade modal
    const [showUpgradeModal, setShowUpgradeModal] = useState(false);
    const [upgradeModalMessage, setUpgradeModalMessage] = useState('');
    
    // Canister Groups state
    const [canisterGroups, setCanisterGroupsState] = useState({ groups: [], ungrouped: [] });
    const [canisterStatus, setCanisterStatus] = useState({}); // canisterId -> { cycles, memory } (or null if can't fetch)
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [newCanisterId, setNewCanisterId] = useState('');
    const [addingCanister, setAddingCanister] = useState(false);
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState(null);
    
    // Group management state
    const [expandedGroups, setExpandedGroups] = useState({}); // groupId -> boolean
    const [editingGroup, setEditingGroup] = useState(null); // group id being edited
    const [editingGroupName, setEditingGroupName] = useState('');
    const [newGroupName, setNewGroupName] = useState('');
    const [showNewGroupInput, setShowNewGroupInput] = useState(false);
    const [newSubgroupParent, setNewSubgroupParent] = useState(null); // group id to add subgroup to
    const [newSubgroupName, setNewSubgroupName] = useState('');
    const [addingCanisterToGroupId, setAddingCanisterToGroupId] = useState(null); // group id to add canister to
    const [newCanisterForGroup, setNewCanisterForGroup] = useState('');
    const [confirmRemoveCanister, setConfirmRemoveCanister] = useState(null); // { canisterId, groupId or 'ungrouped' }
    
    // Neuron Managers state
    const [neuronManagers, setNeuronManagers] = useState([]);
    const [loadingNeuronManagers, setLoadingNeuronManagers] = useState(true);
    const [newManagerId, setNewManagerId] = useState('');
    const [addingManager, setAddingManager] = useState(false);
    const [removingManager, setRemovingManager] = useState(null);
    const [confirmRemoveManager, setConfirmRemoveManager] = useState(null);
    const [managerError, setManagerError] = useState(null);
    const [latestOfficialVersion, setLatestOfficialVersion] = useState(null);
    
    // Official versions and detected neuron managers (for progressive upgrade)
    const [officialVersions, setOfficialVersions] = useState([]);
    // Detected neuron managers from custom/wallet sections - canisterId -> { version, neuronCount, cycles, memory, isController }
    const [detectedNeuronManagers, setDetectedNeuronManagers] = useState({});
    // Use different thresholds for neuron managers vs general canisters
    const [cycleSettings] = useState(() => getCanisterManagerSettings());
    const [neuronManagerCycleSettings] = useState(() => getNeuronManagerSettings());
    
    // Collapsible section states
    const [customExpanded, setCustomExpanded] = useState(() => {
        try {
            const saved = localStorage.getItem('canisters_customExpanded');
            return saved !== null ? JSON.parse(saved) : true;
        } catch { return true; }
    });
    const [neuronManagersExpanded, setNeuronManagersExpanded] = useState(() => {
        try {
            const saved = localStorage.getItem('canisters_neuronManagersExpanded');
            return saved !== null ? JSON.parse(saved) : true;
        } catch { return true; }
    });
    const [walletExpanded, setWalletExpanded] = useState(() => {
        try {
            const saved = localStorage.getItem('canisters_walletExpanded');
            return saved !== null ? JSON.parse(saved) : true;
        } catch { return true; }
    });
    const [walletCanistersExpanded, setWalletCanistersExpanded] = useState(() => {
        try {
            const saved = localStorage.getItem('canisters_walletCanistersExpanded');
            return saved !== null ? JSON.parse(saved) : true;
        } catch { return true; }
    });

    // Tracked canisters (wallet canisters) state
    const [trackedCanisters, setTrackedCanisters] = useState([]);
    const [loadingTrackedCanisters, setLoadingTrackedCanisters] = useState(true);
    const [newWalletCanisterId, setNewWalletCanisterId] = useState('');
    const [addingWalletCanister, setAddingWalletCanister] = useState(false);
    const [walletCanisterError, setWalletCanisterError] = useState(null);
    const [confirmRemoveWalletCanister, setConfirmRemoveWalletCanister] = useState(null);
    const [removingWalletCanister, setRemovingWalletCanister] = useState(null);
    const [trackedCanisterStatus, setTrackedCanisterStatus] = useState({}); // canisterId -> { cycles, memory, isController }

    // Upgrade bots + top-up cycles dialog state
    const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);
    const [topUpDialogOpen, setTopUpDialogOpen] = useState(false);

    // Drag and drop state - simplified for react-dnd
    // react-dnd handles the drag state internally, we just need to track the current drag for UI
    const [dropInProgress, setDropInProgress] = useState(null); // { itemType, itemId, targetType } - shown in progress dialog

    // SNS Root folder expansion state (separate from group expansion)
    const [expandedSnsRoots, setExpandedSnsRoots] = useState({}); // rootCanisterId -> boolean
    const [expandedSnsSubfolders, setExpandedSnsSubfolders] = useState({}); // `${rootId}_system` or `${rootId}_dapps` -> boolean

    // Build a map of canister ID -> SNS data for canisters that are SNS roots
    // This is used to render SNS root canisters as special folders
    const snsRootDataMap = useMemo(() => {
        const map = new Map(); // canisterId -> { name, logo, canisters: { governance, ledger, swap, index, root }, dapps: [], archives: [] }
        const snsToRootMap = buildSnsCanisterToRootMap();
        // Collect all canister IDs from groups and ungrouped
        const allCustomIds = canisterGroups ? [
            ...canisterGroups.ungrouped,
            ...(canisterGroups.groups || []).flatMap(g => {
                const ids = [...g.canisters];
                const collectSub = (groups) => {
                    for (const sg of groups) {
                        ids.push(...sg.canisters);
                        if (sg.subgroups) collectSub(sg.subgroups);
                    }
                };
                if (g.subgroups) collectSub(g.subgroups);
                return ids;
            })
        ] : [];
        // Check each canister if it's an SNS root
        for (const cid of allCustomIds) {
            const rootId = snsToRootMap.get(cid);
            if (rootId && rootId === cid) {
                // This canister IS an SNS root
                const snsData = getSnsById(cid);
                if (snsData) {
                    const logo = snsData.logo || getLogoSync(cid) || getLogoSync(snsData.canisters?.governance);
                    map.set(cid, {
                        name: snsData.name || 'Unknown SNS',
                        logo: logo,
                        tokenSymbol: snsData.token_symbol,
                        systemCanisters: [
                            { id: snsData.canisters?.root, type: 'sns_root', label: 'Root' },
                            { id: snsData.canisters?.governance, type: 'sns_governance', label: 'Governance' },
                            { id: snsData.canisters?.ledger, type: 'sns_ledger', label: 'Ledger' },
                            { id: snsData.canisters?.swap, type: 'sns_swap', label: 'Swap' },
                            { id: snsData.canisters?.index, type: 'sns_index', label: 'Index' },
                        ].filter(c => c.id),
                        dappCanisters: (snsData.canisters?.dapps || []).filter(Boolean),
                        archiveCanisters: (snsData.canisters?.archives || []).filter(Boolean),
                    });
                }
            }
        }
        return map;
    }, [canisterGroups, principalCanisterTypes]);

    // Collect all virtual SNS sub-canister IDs for health computations
    const allVirtualSnsCanisterIds = useMemo(() => {
        const ids = new Set();
        for (const [, snsData] of snsRootDataMap) {
            for (const c of snsData.systemCanisters) ids.add(c.id);
            for (const d of snsData.dappCanisters) ids.add(d);
            for (const a of snsData.archiveCanisters) ids.add(a);
        }
        return ids;
    }, [snsRootDataMap]);

    // Helper to compare versions
    const compareVersions = (a, b) => {
        const aMajor = Number(a.major), aMinor = Number(a.minor), aPatch = Number(a.patch);
        const bMajor = Number(b.major), bMinor = Number(b.minor), bPatch = Number(b.patch);
        if (aMajor !== bMajor) return aMajor - bMajor;
        if (aMinor !== bMinor) return aMinor - bMinor;
        return aPatch - bPatch;
    };

    // Check if a version is outdated compared to latest
    const isVersionOutdated = (version) => {
        if (!latestOfficialVersion || !version) return false;
        return compareVersions(version, latestOfficialVersion) < 0;
    };
    
    // Check if a module hash matches any known neuron manager version
    const isKnownNeuronManagerHash = useCallback((moduleHash) => {
        if (!moduleHash || officialVersions.length === 0) return null;
        const hashLower = moduleHash.toLowerCase();
        return officialVersions.find(v => v.wasmHash.toLowerCase() === hashLower) || null;
    }, [officialVersions]);
    
    // Fetch neuron manager info for a detected canister
    const fetchDetectedManagerInfo = useCallback(async (canisterId, existingStatus) => {
        if (!identity) return;
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const managerActor = createManagerActor(canisterId, { agent });
            const [version, neuronIds] = await Promise.all([
                managerActor.getVersion(),
                managerActor.getNeuronIds(),
            ]);
            
            console.log(`[NM Detection] Fetched manager info for ${canisterId}: v${version.major}.${version.minor}.${version.patch}, ${neuronIds?.length || 0} neurons`);
            
            setDetectedNeuronManagers(prev => ({
                ...prev,
                [canisterId]: {
                    version,
                    neuronCount: neuronIds?.length || 0,
                    cycles: existingStatus?.cycles,
                    memory: existingStatus?.memory,
                    isController: existingStatus?.isController,
                }
            }));
        } catch (err) {
            console.warn(`[NM Detection] Failed to fetch manager info for ${canisterId}:`, err.message || err);
            // Still mark as detected but with fallback values
            setDetectedNeuronManagers(prev => ({
                ...prev,
                [canisterId]: {
                    version: { major: 0n, minor: 0n, patch: 0n },
                    neuronCount: 0,
                    cycles: existingStatus?.cycles,
                    memory: existingStatus?.memory,
                    isController: existingStatus?.isController,
                }
            }));
        }
    }, [identity]);
    
    // Detect neuron managers from custom canisters based on module hash
    useEffect(() => {
        if (officialVersions.length === 0) return;
        
        // Check custom canister statuses
        for (const [canisterId, status] of Object.entries(canisterStatus)) {
            if (!status?.moduleHash) continue;
            if (detectedNeuronManagers[canisterId]) continue; // Already detected
            
            const matchedVersion = isKnownNeuronManagerHash(status.moduleHash);
            if (matchedVersion) {
                console.log(`[NM Detection] Detected ICP staking bot ${canisterId} (v${matchedVersion.major}.${matchedVersion.minor}.${matchedVersion.patch})`);
                fetchDetectedManagerInfo(canisterId, status);
            }
        }
        
        // Check tracked (wallet) canister statuses
        for (const [canisterId, status] of Object.entries(trackedCanisterStatus)) {
            if (!status?.moduleHash) continue;
            if (detectedNeuronManagers[canisterId]) continue; // Already detected
            
            const matchedVersion = isKnownNeuronManagerHash(status.moduleHash);
            if (matchedVersion) {
                console.log(`[NM Detection] Detected neuron manager ${canisterId} (v${matchedVersion.major}.${matchedVersion.minor}.${matchedVersion.patch})`);
                fetchDetectedManagerInfo(canisterId, status);
            }
        }
    }, [officialVersions, canisterStatus, trackedCanisterStatus, detectedNeuronManagers, isKnownNeuronManagerHash, fetchDetectedManagerInfo]);

    // Fetch neuron managers
    const fetchNeuronManagers = useCallback(async () => {
        if (!identity) {
            setNeuronManagers([]);
            setLoadingNeuronManagers(false);
            return;
        }
        
        setLoadingNeuronManagers(true);
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const factory = createFactoryActor(factoryCanisterId, { agent });
            
            // Fetch managers and official versions in parallel
            const [canisterIds, fetchedOfficialVersions] = await Promise.all([
                factory.getMyManagers(),
                factory.getOfficialVersions(),
            ]);
            
            // Store official versions for use in detecting neuron managers
            console.log('[NM Detection] Loaded', fetchedOfficialVersions?.length || 0, 'official versions');
            setOfficialVersions(fetchedOfficialVersions || []);
            
            // Find latest official version
            if (fetchedOfficialVersions && fetchedOfficialVersions.length > 0) {
                const sorted = [...fetchedOfficialVersions].sort((a, b) => compareVersions(b, a));
                setLatestOfficialVersion(sorted[0]);
            }
            
            // Fetch current version, neuron count, and cycles from each canister
            const managersWithInfo = await Promise.all(
                canisterIds.map(async (canisterIdPrincipal) => {
                    const canisterId = canisterIdPrincipal.toString();
                    let isValidManager = true; // Track if getVersion/getNeuronIds succeeded
                    let currentVersion = null;
                    let neuronIds = [];
                    
                    try {
                        const managerActor = createManagerActor(canisterId, { agent });
                        [currentVersion, neuronIds] = await Promise.all([
                            managerActor.getVersion(),
                            managerActor.getNeuronIds(),
                        ]);
                    } catch (err) {
                        console.warn(`Manager methods failed for ${canisterId}:`, err.message || err);
                        isValidManager = false;
                        currentVersion = { major: 0n, minor: 0n, patch: 0n };
                        neuronIds = [];
                    }
                    
                    // Try to fetch cycles, memory, and module hash (may fail if not controller)
                    // Need to create actor with effectiveCanisterId for management canister
                    let cycles = null;
                    let memory = null;
                    let isController = false;
                    let moduleHash = null;
                    try {
                        const mgmtActor = Actor.createActor(managementCanisterIdlFactory, {
                            agent,
                            canisterId: MANAGEMENT_CANISTER_ID,
                            callTransform: (methodName, args, callConfig) => ({
                                ...callConfig,
                                effectiveCanisterId: canisterIdPrincipal,
                            }),
                        });
                        const status = await mgmtActor.canister_status({ canister_id: canisterIdPrincipal });
                        cycles = Number(status.cycles);
                        memory = Number(status.memory_size);
                        moduleHash = status.module_hash[0] ? uint8ArrayToHex(status.module_hash[0]) : null;
                        isController = true;
                    } catch (cyclesErr) {
                        // Not a controller, can't get status
                        console.log(`Cannot fetch status for ${canisterId} (not a controller)`);
                    }
                    
                    return { 
                        canisterId: canisterIdPrincipal, 
                        version: currentVersion,
                        neuronCount: neuronIds?.length || 0,
                        cycles,
                        memory,
                        isController,
                        moduleHash,
                        isValidManager, // True if getVersion/getNeuronIds succeeded
                    };
                })
            );
            
            setNeuronManagers(managersWithInfo);
        } catch (err) {
            console.error('Error loading ICP staking bots:', err);
        } finally {
            setLoadingNeuronManagers(false);
        }
    }, [identity]);

    // Fetch status (cycles & memory) for a single custom canister (async, doesn't block UI)
    const fetchCanisterStatus = useCallback(async (canisterId) => {
        if (!identity) return;
        
        let cycles = null;
        let memory = null;
        let isController = false;
        let moduleHash = null;
        
        // First try canister_status (works if user is controller)
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://icp0.io' 
                : 'http://localhost:4943';
            const agent = HttpAgent.createSync({ host, identity });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const canisterPrincipal = Principal.fromText(canisterId);
            const mgmtActor = Actor.createActor(managementCanisterIdlFactory, {
                agent,
                canisterId: MANAGEMENT_CANISTER_ID,
                callTransform: (methodName, args, callConfig) => ({
                    ...callConfig,
                    effectiveCanisterId: canisterPrincipal,
                }),
            });
            
            const status = await mgmtActor.canister_status({ canister_id: canisterPrincipal });
            cycles = Number(status.cycles);
            memory = Number(status.memory_size);
            moduleHash = status.module_hash[0] ? uint8ArrayToHex(status.module_hash[0]) : null;
            isController = true;
            
            console.log(`[NM Detection] Fetched status (controller) for ${canisterId}, moduleHash: ${moduleHash ? 'yes' : 'no'}`);
        } catch (err) {
            // Not a controller - try fallback to get module_hash via backend
            console.log(`[NM Detection] Not controller for ${canisterId}, trying backend fallback...`);
            
            try {
                const result = await getCanisterInfo(identity, canisterId);
                if (result && 'ok' in result) {
                    moduleHash = result.ok.module_hash[0] ? uint8ArrayToHex(result.ok.module_hash[0]) : null;
                    console.log(`[NM Detection] Fetched status (fallback) for ${canisterId}, moduleHash: ${moduleHash ? 'yes' : 'no'}`);
                }
            } catch (fallbackErr) {
                console.log(`[NM Detection] Backend fallback error for ${canisterId}:`, fallbackErr.message || fallbackErr);
            }
        }
        
        setCanisterStatus(prev => ({ ...prev, [canisterId]: { cycles, memory, isController, moduleHash } }));
    }, [identity]);

    // Helper to get all canister IDs from groups (for cycles fetching)
    const getAllCanisterIds = useCallback((groupsRoot) => {
        const ids = [...groupsRoot.ungrouped];
        const collectFromGroups = (groups) => {
            for (const group of groups) {
                ids.push(...group.canisters);
                collectFromGroups(group.subgroups);
            }
        };
        collectFromGroups(groupsRoot.groups);
        return ids;
    }, []);

    // Load canister groups on mount and when identity changes
    useEffect(() => {
        const loadCanisterGroups = async () => {
            if (!identity) {
                setCanisterGroupsState({ groups: [], ungrouped: [] });
                setCanisterStatus({});
                setLoading(false);
                return;
            }

            setLoading(true);
            try {
                const result = await getCanisterGroups(identity);
                const groups = convertGroupsFromBackend(result) || { groups: [], ungrouped: [] };
                setCanisterGroupsState(groups);
                
                // Fetch cycles for all canisters asynchronously
                const allCanisterIds = getAllCanisterIds(groups);
                allCanisterIds.forEach(canisterId => {
                    fetchCanisterStatus(canisterId);
                });
            } catch (err) {
                console.error('Error loading canister groups:', err);
                setError('Failed to load app groups');
            } finally {
                setLoading(false);
            }
        };

        loadCanisterGroups();
        fetchNeuronManagers();
    }, [identity, fetchNeuronManagers, fetchCanisterStatus, getAllCanisterIds]);
    
    // Save canister groups to backend
    const saveCanisterGroups = useCallback(async (newGroups) => {
        if (!identity) {
            throw new Error('Please log in to save changes');
        }
        
        setSaving(true);
        try {
            const result = await setCanisterGroups(identity, newGroups);
            if (result.ok) {
                setCanisterGroupsState(newGroups);
                setError(null);
            } else {
                // Handle limit errors
                const errorMsg = result.err || 'Failed to save changes';
                
                // Check if this is a limit error and user is not premium
                const isLimitError = errorMsg.toLowerCase().includes('exceeded') || 
                                    errorMsg.toLowerCase().includes('maximum') ||
                                    errorMsg.toLowerCase().includes('limit');
                
                if (isLimitError && groupUsage && !groupUsage.isPremium) {
                    // Show premium upgrade modal
                    setUpgradeModalMessage(errorMsg);
                    setShowUpgradeModal(true);
                } else {
                    setError(errorMsg);
                }
                throw new Error(errorMsg);
            }
        } catch (err) {
            console.error('Error saving canister groups:', err);
            const errorMsg = err.message || 'Unknown error';
            const isLimitError = errorMsg.toLowerCase().includes('exceeded') || 
                                errorMsg.toLowerCase().includes('maximum') ||
                                errorMsg.toLowerCase().includes('limit');
            
            if (isLimitError && groupUsage && !groupUsage.isPremium) {
                // Show premium upgrade modal (if not already shown)
                if (!showUpgradeModal) {
                    setUpgradeModalMessage(errorMsg);
                    setShowUpgradeModal(true);
                }
            } else if (!isLimitError) {
                setError('Failed to save changes: ' + errorMsg);
            }
            throw err;  // Re-throw so callers know save failed
        } finally {
            setSaving(false);
        }
    }, [identity, groupUsage, showUpgradeModal]);
    
    
    // Persist collapsible states
    useEffect(() => {
        try { localStorage.setItem('canisters_customExpanded', JSON.stringify(customExpanded)); } catch {}
    }, [customExpanded]);
    
    useEffect(() => {
        try { localStorage.setItem('canisters_neuronManagersExpanded', JSON.stringify(neuronManagersExpanded)); } catch {}
    }, [neuronManagersExpanded]);

    useEffect(() => {
        try { localStorage.setItem('canisters_walletExpanded', JSON.stringify(walletExpanded)); } catch {}
    }, [walletExpanded]);

    useEffect(() => {
        try { localStorage.setItem('canisters_walletCanistersExpanded', JSON.stringify(walletCanistersExpanded)); } catch {}
    }, [walletCanistersExpanded]);

    // Fetch tracked canisters
    useEffect(() => {
        const fetchTracked = async () => {
            if (!identity) {
                setTrackedCanisters([]);
                setLoadingTrackedCanisters(false);
                return;
            }
            
            setLoadingTrackedCanisters(true);
            try {
                const canisters = await getTrackedCanisters(identity);
                const canisterIds = canisters.map(p => p.toText());
                setTrackedCanisters(canisterIds);
                
                // Fetch status for each canister
                if (canisterIds.length > 0) {
                    const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                        ? 'https://ic0.app' 
                        : 'http://localhost:4943';
                    const agent = new HttpAgent({ identity, host });
                    if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                        await agent.fetchRootKey();
                    }

                    const statusMap = {};
                    await Promise.all(canisterIds.map(async (canisterId) => {
                        try {
                            const canisterIdPrincipal = Principal.fromText(canisterId);
                            const mgmtActor = Actor.createActor(managementCanisterIdlFactory, {
                                agent,
                                canisterId: MANAGEMENT_CANISTER_ID,
                                callTransform: (methodName, args, callConfig) => ({
                                    ...callConfig,
                                    effectiveCanisterId: canisterIdPrincipal,
                                }),
                            });
                            const status = await mgmtActor.canister_status({ canister_id: canisterIdPrincipal });
                            const moduleHash = status.module_hash[0] ? uint8ArrayToHex(status.module_hash[0]) : null;
                            console.log(`[NM Detection] Tracked status (controller) for ${canisterId}, moduleHash: ${moduleHash ? 'yes' : 'no'}`);
                            statusMap[canisterId] = {
                                cycles: Number(status.cycles),
                                memory: Number(status.memory_size),
                                isController: true,
                                moduleHash,
                            };
                        } catch (err) {
                            // Can't get status - not a controller, try backend fallback for module_hash
                            let moduleHash = null;
                            try {
                                const result = await getCanisterInfo(identity, canisterId);
                                if (result && 'ok' in result) {
                                    moduleHash = result.ok.module_hash[0] ? uint8ArrayToHex(result.ok.module_hash[0]) : null;
                                    console.log(`[NM Detection] Tracked status (fallback) for ${canisterId}, moduleHash: ${moduleHash ? 'yes' : 'no'}`);
                                }
                            } catch (fallbackErr) {
                                console.log(`[NM Detection] Backend fallback error for tracked ${canisterId}:`, fallbackErr.message || fallbackErr);
                            }
                            statusMap[canisterId] = { cycles: null, memory: null, isController: false, moduleHash };
                        }
                    }));
                    setTrackedCanisterStatus(statusMap);
                }
            } catch (err) {
                console.error('Error fetching tracked canisters:', err);
            } finally {
                setLoadingTrackedCanisters(false);
            }
        };
        
        fetchTracked();
    }, [identity]);

    // Fetch cycles/memory for SNS canisters via get_sns_canisters_summary (non-blocking, progressive)
    // Runs after initial canister statuses are loaded, for any SNS canisters we couldn't get cycles for
    // Also fetches for all virtual SNS sub-canisters (shown in SNS root folders)
    useEffect(() => {
        if (!identity || loading || loadingTrackedCanisters) return;

        const fetchSnsCycles = async () => {
            // Build a map of canisterId -> rootCanisterId from cached SNS data
            const snsMap = buildSnsCanisterToRootMap();
            if (snsMap.size === 0) return;

            // Collect all canister IDs that are SNS canisters and don't have cycles data yet
            const allCustomIds = getAllCanisterIds(canisterGroups);
            const allIds = [...allCustomIds, ...trackedCanisters, ...allVirtualSnsCanisterIds];
            
            // Group by root canister ID
            const rootsToFetch = new Map(); // rootId -> Set<canisterId>
            for (const cid of allIds) {
                const rootId = snsMap.get(cid);
                if (!rootId) continue;
                // Check if we already have cycles data for this canister
                const existingStatus = canisterStatus[cid] || trackedCanisterStatus[cid];
                if (existingStatus && existingStatus.cycles !== null && existingStatus.cycles !== undefined) continue;
                if (!rootsToFetch.has(rootId)) rootsToFetch.set(rootId, new Set());
                rootsToFetch.get(rootId).add(cid);
            }

            if (rootsToFetch.size === 0) return;

            console.log(`[SNS Cycles] Fetching from ${rootsToFetch.size} SNS root(s) for canisters without status...`);

            // Fetch from each root sequentially (to be polite) with a small delay between
            for (const [rootId, canisterIds] of rootsToFetch) {
                try {
                    const cyclesMap = await fetchSnsCyclesFromRoot(rootId, identity);
                    if (cyclesMap.size > 0) {
                        // Update custom canister status - also store ALL returned sub-canisters
                        // for virtual SNS folder display
                        setCanisterStatus(prev => {
                            const updated = { ...prev };
                            for (const [cid, data] of cyclesMap) {
                                // Store for any canister that is: in our groups, a virtual SNS sub-canister, or returned by this root
                                if (canisterIds.has(cid) || allCustomIds.includes(cid) || allVirtualSnsCanisterIds.has(cid)) {
                                    updated[cid] = {
                                        ...(prev[cid] || {}),
                                        cycles: data.cycles,
                                        memory: data.memory,
                                        isController: false,
                                        snsRoot: rootId,
                                    };
                                }
                            }
                            return updated;
                        });
                        // Update tracked canister status
                        setTrackedCanisterStatus(prev => {
                            const updated = { ...prev };
                            for (const [cid, data] of cyclesMap) {
                                if (trackedCanisters.includes(cid)) {
                                    updated[cid] = {
                                        ...(prev[cid] || {}),
                                        cycles: data.cycles,
                                        memory: data.memory,
                                        isController: false,
                                        snsRoot: rootId,
                                    };
                                }
                            }
                            return updated;
                        });
                    }
                } catch (err) {
                    console.warn(`[SNS Cycles] Error fetching from root ${rootId}:`, err);
                }
                // Small delay between roots to avoid hammering the network
                await new Promise(r => setTimeout(r, 500));
            }
        };

        // Delay to avoid competing with initial loads
        const timer = setTimeout(fetchSnsCycles, 3000);
        return () => clearTimeout(timer);
    }, [identity, loading, loadingTrackedCanisters, canisterGroups, trackedCanisters, canisterStatus, trackedCanisterStatus, getAllCanisterIds, allVirtualSnsCanisterIds]);

    // Fetch canister group limits and usage
    useEffect(() => {
        const fetchGroupLimits = async () => {
            if (!BACKEND_CANISTER_ID) return;
            
            try {
                const backendActor = createBackendActor(BACKEND_CANISTER_ID, {
                    agentOptions: identity ? { identity } : {}
                });
                
                // Fetch config (public query)
                const config = await backendActor.get_canister_groups_limits_config();
                setGroupLimits({
                    maxGroups: Number(config.max_canister_groups),
                    maxPerGroup: Number(config.max_canisters_per_group),
                    maxTotal: Number(config.max_total_grouped_canisters),
                    premiumMaxGroups: Number(config.premium_max_canister_groups),
                    premiumMaxPerGroup: Number(config.premium_max_canisters_per_group),
                    premiumMaxTotal: Number(config.premium_max_total_grouped_canisters),
                });
                
                // Fetch usage if authenticated
                if (identity) {
                    try {
                        const usage = await backendActor.get_my_canister_groups_usage();
                        setGroupUsage({
                            groupCount: Number(usage.group_count),
                            totalCanisters: Number(usage.total_canisters),
                            maxInSingleGroup: Number(usage.max_in_single_group),
                            ungroupedCount: Number(usage.ungrouped_count),
                            groupLimit: Number(usage.group_limit),
                            perGroupLimit: Number(usage.per_group_limit),
                            totalLimit: Number(usage.total_limit),
                            isPremium: usage.is_premium,
                        });
                    } catch (err) {
                        console.warn('Failed to fetch group usage:', err);
                    }
                }
            } catch (err) {
                console.warn('Failed to fetch group limits:', err);
            }
        };
        
        fetchGroupLimits();
    }, [identity, canisterGroups]);

    // Add a wallet canister (tracked canister)
    const handleAddWalletCanister = async () => {
        if (!identity || !newWalletCanisterId.trim()) return;
        
        setAddingWalletCanister(true);
        setWalletCanisterError(null);
        
        try {
            Principal.fromText(newWalletCanisterId.trim());
        } catch (e) {
            setWalletCanisterError('Invalid app canister id format');
            setAddingWalletCanister(false);
            return;
        }
        
        try {
            await registerTrackedCanister(identity, newWalletCanisterId.trim());
            setNewWalletCanisterId('');
            // Refresh the list
            const canisters = await getTrackedCanisters(identity);
            setTrackedCanisters(canisters.map(p => p.toText()));
        } catch (err) {
            console.error('Error adding wallet canister:', err);
            setWalletCanisterError(err.message || 'Failed to add app');
        } finally {
            setAddingWalletCanister(false);
        }
    };

    // Remove a wallet canister (tracked canister)
    const handleRemoveWalletCanister = async (canisterId) => {
        if (!identity || !canisterId) return;
        
        setRemovingWalletCanister(canisterId);
        try {
            await unregisterTrackedCanister(identity, canisterId);
            // Refresh the list
            const canisters = await getTrackedCanisters(identity);
            setTrackedCanisters(canisters.map(p => p.toText()));
            setTrackedCanisterStatus(prev => {
                const newStatus = { ...prev };
                delete newStatus[canisterId];
                return newStatus;
            });
        } catch (err) {
            console.error('Error removing wallet canister:', err);
        } finally {
            setRemovingWalletCanister(null);
            setConfirmRemoveWalletCanister(null);
        }
    };

    // Clear messages after timeout
    useEffect(() => {
        if (error) {
            const timeout = setTimeout(() => setError(null), 5000);
            return () => clearTimeout(timeout);
        }
    }, [error]);

    useEffect(() => {
        if (successMessage) {
            const timeout = setTimeout(() => setSuccessMessage(null), 3000);
            return () => clearTimeout(timeout);
        }
    }, [successMessage]);

    // Generate unique ID for new groups
    const generateGroupId = () => `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Check if canister exists in groups
    const canisterExistsInGroups = useCallback((canisterId, groupsRoot) => {
        if (groupsRoot.ungrouped.includes(canisterId)) return true;
        const checkGroups = (groups) => {
            for (const group of groups) {
                if (group.canisters.includes(canisterId)) return true;
                if (checkGroups(group.subgroups)) return true;
            }
            return false;
        };
        return checkGroups(groupsRoot.groups);
    }, []);

    // Add canister to ungrouped
    const handleAddCanister = async (targetGroupId = null) => {
        if (!newCanisterId.trim()) return;

        // Validate principal format
        let canisterPrincipal;
        try {
            canisterPrincipal = Principal.fromText(newCanisterId.trim());
        } catch (err) {
            setError('Invalid app canister id format');
            return;
        }

        const canisterIdStr = canisterPrincipal.toString();

        // Check if already tracked
        if (canisterExistsInGroups(canisterIdStr, canisterGroups)) {
            setError('This app is already being tracked');
            return;
        }

        setAddingCanister(true);
        setError(null);

        try {
            let newGroups;
            if (targetGroupId) {
                // Add to specific group
                newGroups = addCanisterToGroup(canisterGroups, canisterIdStr, targetGroupId);
            } else {
                // Add to ungrouped
                newGroups = {
                    ...canisterGroups,
                    ungrouped: [canisterIdStr, ...canisterGroups.ungrouped],
                };
            }
            
            await saveCanisterGroups(newGroups);
            setNewCanisterId('');
            setSuccessMessage('App added');
            // Fetch cycles for the new canister asynchronously
            fetchCanisterStatus(canisterIdStr);
        } catch (err) {
            console.error('Error adding canister:', err);
            setError('Failed to add app');
        } finally {
            setAddingCanister(false);
        }
    };

    // Helper to add canister to a specific group
    const addCanisterToGroup = (groupsRoot, canisterId, targetGroupId) => {
        const updateGroups = (groups) => groups.map(group => {
            if (group.id === targetGroupId) {
                return { ...group, canisters: [canisterId, ...group.canisters] };
            }
            return { ...group, subgroups: updateGroups(group.subgroups) };
        });
        
        return {
            ...groupsRoot,
            groups: updateGroups(groupsRoot.groups),
        };
    };

    // Remove canister from wherever it is
    const handleRemoveCanister = async (canisterId, fromGroupId = null) => {
        setError(null);

        try {
            let newGroups;
            if (fromGroupId === 'ungrouped' || fromGroupId === null) {
                newGroups = {
                    ...canisterGroups,
                    ungrouped: canisterGroups.ungrouped.filter(c => c !== canisterId),
                };
            } else {
                newGroups = removeCanisterFromGroup(canisterGroups, canisterId, fromGroupId);
            }
            
            await saveCanisterGroups(newGroups);
            setSuccessMessage('App removed');
            setConfirmRemoveCanister(null);
        } catch (err) {
            console.error('Error removing canister:', err);
            setError('Failed to remove app');
        }
    };

    // Helper to remove canister from a specific group
    const removeCanisterFromGroup = (groupsRoot, canisterId, groupId) => {
        const updateGroups = (groups) => groups.map(group => {
            if (group.id === groupId) {
                return { ...group, canisters: group.canisters.filter(c => c !== canisterId) };
            }
            return { ...group, subgroups: updateGroups(group.subgroups) };
        });
        
        return {
            ...groupsRoot,
            groups: updateGroups(groupsRoot.groups),
        };
    };

    // Create a new group
    const handleCreateGroup = async (parentGroupId = null) => {
        if (!newGroupName.trim()) return;

        const newGroup = {
            id: generateGroupId(),
            name: newGroupName.trim(),
            canisters: [],
            subgroups: [],
        };

        try {
            let newGroups;
            if (parentGroupId) {
                // Add as subgroup
                const addSubgroup = (groups) => groups.map(group => {
                    if (group.id === parentGroupId) {
                        return { ...group, subgroups: [...group.subgroups, newGroup] };
                    }
                    return { ...group, subgroups: addSubgroup(group.subgroups) };
                });
                newGroups = { ...canisterGroups, groups: addSubgroup(canisterGroups.groups) };
            } else {
                // Add as top-level group
                newGroups = { ...canisterGroups, groups: [...canisterGroups.groups, newGroup] };
            }
            
            await saveCanisterGroups(newGroups);
            setNewGroupName('');
            setShowNewGroupInput(false);
            setSuccessMessage('Group created');
            // Auto-expand the new group
            setExpandedGroups(prev => ({ ...prev, [newGroup.id]: true }));
        } catch (err) {
            console.error('Error creating group:', err);
            setError('Failed to create group');
        }
    };

    // Rename a group
    const handleRenameGroup = async (groupId) => {
        if (!editingGroupName.trim()) return;

        const updateGroupName = (groups) => groups.map(group => {
            if (group.id === groupId) {
                return { ...group, name: editingGroupName.trim() };
            }
            return { ...group, subgroups: updateGroupName(group.subgroups) };
        });

        try {
            const newGroups = { ...canisterGroups, groups: updateGroupName(canisterGroups.groups) };
            await saveCanisterGroups(newGroups);
            setEditingGroup(null);
            setEditingGroupName('');
            setSuccessMessage('Group renamed');
        } catch (err) {
            console.error('Error renaming group:', err);
            setError('Failed to rename group');
        }
    };

    // Delete a group (moves canisters to ungrouped)
    const handleDeleteGroup = async (groupId) => {
        // Collect all canisters from the group and its subgroups
        const collectCanisters = (group) => {
            let canisters = [...group.canisters];
            for (const subgroup of group.subgroups) {
                canisters = [...canisters, ...collectCanisters(subgroup)];
            }
            return canisters;
        };

        const findAndCollect = (groups) => {
            for (const group of groups) {
                if (group.id === groupId) {
                    return collectCanisters(group);
                }
                const fromSubgroups = findAndCollect(group.subgroups);
                if (fromSubgroups.length > 0) return fromSubgroups;
            }
            return [];
        };

        const canistersToMove = findAndCollect(canisterGroups.groups);

        // Remove the group
        const removeGroup = (groups) => groups
            .filter(g => g.id !== groupId)
            .map(g => ({ ...g, subgroups: removeGroup(g.subgroups) }));

        try {
            const newGroups = {
                groups: removeGroup(canisterGroups.groups),
                ungrouped: [...canisterGroups.ungrouped, ...canistersToMove],
            };
            await saveCanisterGroups(newGroups);
            setSuccessMessage('Group deleted');
        } catch (err) {
            console.error('Error deleting group:', err);
            setError('Failed to delete group');
        }
    };

    // Add canister directly to a specific group
    const handleAddCanisterToGroup = async (groupId) => {
        if (!newCanisterForGroup.trim()) return;

        let canisterPrincipal;
        try {
            canisterPrincipal = Principal.fromText(newCanisterForGroup.trim());
        } catch (err) {
            setError('Invalid app canister id format');
            return;
        }

        const canisterIdStr = canisterPrincipal.toString();

        if (canisterExistsInGroups(canisterIdStr, canisterGroups)) {
            setError('This app is already being tracked');
            return;
        }

        try {
            const newGroups = addCanisterToGroup(canisterGroups, canisterIdStr, groupId);
            await saveCanisterGroups(newGroups);
            setNewCanisterForGroup('');
            setAddingCanisterToGroupId(null);
            setSuccessMessage('App added to group');
            fetchCanisterStatus(canisterIdStr);
        } catch (err) {
            console.error('Error adding canister to group:', err);
            setError('Failed to add app');
        }
    };

    // Create a subgroup inside an existing group
    const handleCreateSubgroup = async (parentGroupId) => {
        if (!newSubgroupName.trim()) return;

        const newGroup = {
            id: generateGroupId(),
            name: newSubgroupName.trim(),
            canisters: [],
            subgroups: [],
        };

        try {
            const addSubgroup = (groups) => groups.map(group => {
                if (group.id === parentGroupId) {
                    return { ...group, subgroups: [...group.subgroups, newGroup] };
                }
                return { ...group, subgroups: addSubgroup(group.subgroups) };
            });
            const newGroups = { ...canisterGroups, groups: addSubgroup(canisterGroups.groups) };
            
            await saveCanisterGroups(newGroups);
            setNewSubgroupName('');
            setNewSubgroupParent(null);
            setSuccessMessage('Subgroup created');
            setExpandedGroups(prev => ({ ...prev, [newGroup.id]: true }));
        } catch (err) {
            console.error('Error creating subgroup:', err);
            setError('Failed to create subgroup');
        }
    };

    // Move canister to a different group (or ungrouped)
    const handleMoveCanister = async (canisterId, fromGroupId, toGroupId) => {
        try {
            // First remove from current location
            let newGroups = canisterGroups;
            
            if (fromGroupId === 'ungrouped') {
                newGroups = {
                    ...newGroups,
                    ungrouped: newGroups.ungrouped.filter(c => c !== canisterId),
                };
            } else {
                newGroups = removeCanisterFromGroup(newGroups, canisterId, fromGroupId);
            }
            
            // Then add to new location
            if (toGroupId === 'ungrouped') {
                newGroups = {
                    ...newGroups,
                    ungrouped: [canisterId, ...newGroups.ungrouped],
                };
            } else {
                newGroups = addCanisterToGroup(newGroups, canisterId, toGroupId);
            }
            
            await saveCanisterGroups(newGroups);
            setSuccessMessage('App moved');
        } catch (err) {
            console.error('Error moving canister:', err);
            setError('Failed to move app');
        }
    };

    // Collect all group IDs recursively
    const getAllGroupIds = useCallback((groupsRoot) => {
        const ids = [];
        const collect = (groups) => {
            for (const group of groups) {
                ids.push(group.id);
                collect(group.subgroups);
            }
        };
        collect(groupsRoot.groups);
        return ids;
    }, []);

    // Expand all groups
    const handleExpandAll = useCallback(() => {
        const allIds = getAllGroupIds(canisterGroups);
        const expanded = {};
        allIds.forEach(id => { expanded[id] = true; });
        setExpandedGroups(expanded);
    }, [canisterGroups, getAllGroupIds]);

    // Collapse all groups
    const handleCollapseAll = useCallback(() => {
        const allIds = getAllGroupIds(canisterGroups);
        const collapsed = {};
        allIds.forEach(id => { collapsed[id] = false; });
        setExpandedGroups(collapsed);
    }, [canisterGroups, getAllGroupIds]);

    const handleAddManager = async () => {
        if (!newManagerId.trim()) return;

        let canisterId;
        try {
            canisterId = Principal.fromText(newManagerId.trim());
        } catch (err) {
            setManagerError('Invalid app canister id format');
            return;
        }

        setAddingManager(true);
        setManagerError(null);

        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const factory = createFactoryActor(factoryCanisterId, { agent });
            const result = await factory.registerManager(canisterId);
            
            if ('Err' in result) {
                throw new Error(result.Err);
            }
            
            await fetchNeuronManagers();
            setNewManagerId('');
            setSuccessMessage('Manager added to list');
        } catch (err) {
            console.error('Error adding manager:', err);
            setManagerError(err.message || 'Failed to add manager');
        } finally {
            setAddingManager(false);
        }
    };

    const handleRemoveManager = async (canisterId) => {
        setRemovingManager(canisterId.toString());
        setManagerError(null);

        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const factory = createFactoryActor(factoryCanisterId, { agent });
            const result = await factory.deregisterManager(canisterId);
            
            if ('Err' in result) {
                throw new Error(result.Err);
            }
            
            await fetchNeuronManagers();
            setSuccessMessage('Manager removed from list');
        } catch (err) {
            console.error('Error removing manager:', err);
            setManagerError(err.message || 'Failed to remove manager');
        } finally {
            setRemovingManager(null);
        }
    };

    // Move canister from wallet to groups or neuron managers
    // IMPORTANT: Add to destination FIRST, then remove from source (prevents data loss on network failure)
    const handleMoveFromWallet = async (canisterId, destination) => {
        try {
            // Add to destination FIRST
            if (destination === 'neuron_managers') {
                // Register as neuron manager
                const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                    ? 'https://ic0.app' 
                    : 'http://localhost:4943';
                const agent = new HttpAgent({ identity, host });
                if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                    await agent.fetchRootKey();
                }
                const factory = createFactoryActor(factoryCanisterId, { agent });
                const result = await factory.registerManager(Principal.fromText(canisterId));
                if ('Err' in result) {
                    throw new Error(result.Err);
                }
                await fetchNeuronManagers();
            } else {
                // Add to a canister group
                let newGroups = canisterGroups;
                if (destination === 'ungrouped') {
                    newGroups = {
                        ...newGroups,
                        ungrouped: [canisterId, ...newGroups.ungrouped],
                    };
                } else {
                    newGroups = addCanisterToGroup(newGroups, canisterId, destination);
                }
                await saveCanisterGroups(newGroups);
            }
            
            // THEN remove from wallet (if this fails, canister exists in both places - better than nowhere)
            await unregisterTrackedCanister(identity, canisterId);
            const canisters = await getTrackedCanisters(identity);
            setTrackedCanisters(canisters.map(p => p.toText()));
            
            setSuccessMessage(destination === 'neuron_managers' ? 'App moved to Staking Bots' : 'App moved to groups');
        } catch (err) {
            console.error('Error moving canister from wallet:', err);
            setError('Failed to move app: ' + (err.message || 'Unknown error'));
        }
    };

    // Move canister from groups to wallet or neuron managers
    // IMPORTANT: Add to destination FIRST, then remove from source (prevents data loss on network failure)
    const handleMoveFromGroups = async (canisterId, fromGroupId, destination) => {
        try {
            // Add to destination FIRST
            if (destination === 'wallet') {
                await registerTrackedCanister(identity, canisterId);
                const canisters = await getTrackedCanisters(identity);
                setTrackedCanisters(canisters.map(p => p.toText()));
            } else if (destination === 'neuron_managers') {
                const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                    ? 'https://ic0.app' 
                    : 'http://localhost:4943';
                const agent = new HttpAgent({ identity, host });
                if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                    await agent.fetchRootKey();
                }
                const factory = createFactoryActor(factoryCanisterId, { agent });
                const result = await factory.registerManager(Principal.fromText(canisterId));
                if ('Err' in result) {
                    throw new Error(result.Err);
                }
                await fetchNeuronManagers();
            }
            
            // THEN remove from current group (if this fails, canister exists in both places - better than nowhere)
            let newGroups = canisterGroups;
            if (fromGroupId === 'ungrouped') {
                newGroups = {
                    ...newGroups,
                    ungrouped: newGroups.ungrouped.filter(c => c !== canisterId),
                };
            } else {
                newGroups = removeCanisterFromGroup(newGroups, canisterId, fromGroupId);
            }
            await saveCanisterGroups(newGroups);
            
            setSuccessMessage(destination === 'wallet' ? 'App moved to Wallet' : 'App moved to Staking Bots');
        } catch (err) {
            console.error('Error moving canister from groups:', err);
            setError('Failed to move app: ' + (err.message || 'Unknown error'));
        }
    };

    // Move neuron manager to wallet or groups
    // IMPORTANT: Add to destination FIRST, then remove from source (prevents data loss on network failure)
    const handleMoveFromNeuronManagers = async (canisterId, destination) => {
        try {
            const canisterIdStr = typeof canisterId === 'string' ? canisterId : canisterId.toText();
            
            // Add to destination FIRST
            if (destination === 'wallet') {
                await registerTrackedCanister(identity, canisterIdStr);
                const canisters = await getTrackedCanisters(identity);
                setTrackedCanisters(canisters.map(p => p.toText()));
            } else if (destination === 'ungrouped' || destination !== 'neuron_managers') {
                // Add to a canister group
                let newGroups = canisterGroups;
                if (destination === 'ungrouped') {
                    newGroups = {
                        ...newGroups,
                        ungrouped: [canisterIdStr, ...newGroups.ungrouped],
                    };
                } else {
                    newGroups = addCanisterToGroup(newGroups, canisterIdStr, destination);
                }
                await saveCanisterGroups(newGroups);
            }
            
            // THEN remove from neuron managers (if this fails, canister exists in both places - better than nowhere)
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const factory = createFactoryActor(factoryCanisterId, { agent });
            const result = await factory.deregisterManager(canisterId);
            if ('Err' in result) {
                throw new Error(result.Err);
            }
            await fetchNeuronManagers();
            
            setSuccessMessage(destination === 'wallet' ? 'App moved to Wallet' : 'App moved to groups');
        } catch (err) {
            console.error('Error moving canister from ICP staking bots:', err);
            setError('Failed to move app: ' + (err.message || 'Unknown error'));
        }
    };

    // Move a group to become a subgroup of another group (or to root level if targetId is null)
    const handleMoveGroup = async (sourceGroupId, targetGroupId) => {
        try {
            // Find and remove the source group from its current location
            let sourceGroup = null;
            
            const removeGroup = (groups) => {
                for (let i = 0; i < groups.length; i++) {
                    if (groups[i].id === sourceGroupId) {
                        sourceGroup = groups[i];
                        return [...groups.slice(0, i), ...groups.slice(i + 1)];
                    }
                    const newSubgroups = removeGroup(groups[i].subgroups);
                    if (sourceGroup) {
                        return [
                            ...groups.slice(0, i),
                            { ...groups[i], subgroups: newSubgroups },
                            ...groups.slice(i + 1)
                        ];
                    }
                }
                return groups;
            };
            
            let newGroups = { ...canisterGroups };
            newGroups.groups = removeGroup(newGroups.groups);
            
            if (!sourceGroup) {
                console.error('Source group not found');
                return;
            }
            
            // Add the group as a subgroup of the target
            const addAsSubgroup = (groups) => {
                return groups.map(g => {
                    if (g.id === targetGroupId) {
                        return { ...g, subgroups: [...g.subgroups, sourceGroup] };
                    }
                    return { ...g, subgroups: addAsSubgroup(g.subgroups) };
                });
            };
            
            if (targetGroupId) {
                newGroups.groups = addAsSubgroup(newGroups.groups);
            } else {
                // Add to root level
                newGroups.groups = [...newGroups.groups, sourceGroup];
            }
            
            await saveCanisterGroups(newGroups);
            setSuccessMessage('Group moved');
        } catch (err) {
            console.error('Error moving group:', err);
            setError('Failed to move group');
        }
    };

    // react-dnd drop handler - called when an item is dropped on a valid target
    const handleDndDrop = useCallback(async (item, targetType, targetId = null) => {
        const { type: itemType, id: itemId, sourceGroupId } = item;
        
        // Helper to check if a move will actually happen (not dropping on same location)
        const willMove = () => {
            if (itemType === 'canister') {
                if (sourceGroupId === 'wallet' && targetType === 'wallet') return false;
                if (sourceGroupId === 'neuron_managers' && targetType === 'neuron_managers') return false;
                if (sourceGroupId === targetId) return false;
                if (sourceGroupId === 'ungrouped' && targetType === 'ungrouped') return false;
                return true;
            }
            if (itemType === 'group' && targetType === 'group') {
                return itemId !== targetId;
            }
            return false;
        };
        
        // Only show progress if we're actually moving something
        if (!willMove()) return;
        
        // Show progress dialog
        setDropInProgress({ itemType, itemId, targetType, targetId });
        
        try {
            // Handle canister drops
            if (itemType === 'canister') {
                // From wallet
                if (sourceGroupId === 'wallet') {
                    if (targetType === 'group' || targetType === 'ungrouped') {
                        await handleMoveFromWallet(itemId, targetId || 'ungrouped');
                    } else if (targetType === 'neuron_managers') {
                        await handleMoveFromWallet(itemId, 'neuron_managers');
                    }
                }
                // From neuron managers
                else if (sourceGroupId === 'neuron_managers') {
                    if (targetType === 'wallet') {
                        await handleMoveFromNeuronManagers(Principal.fromText(itemId), 'wallet');
                    } else if (targetType === 'group' || targetType === 'ungrouped') {
                        await handleMoveFromNeuronManagers(Principal.fromText(itemId), targetId || 'ungrouped');
                    }
                }
                // From groups/ungrouped
                else if (sourceGroupId) {
                    if (targetType === 'wallet') {
                        await handleMoveFromGroups(itemId, sourceGroupId, 'wallet');
                    } else if (targetType === 'neuron_managers') {
                        await handleMoveFromGroups(itemId, sourceGroupId, 'neuron_managers');
                    } else if (targetType === 'group') {
                        if (sourceGroupId !== targetId) {
                            await handleMoveCanister(itemId, sourceGroupId, targetId);
                        }
                    } else if (targetType === 'ungrouped') {
                        if (sourceGroupId !== 'ungrouped') {
                            await handleMoveCanister(itemId, sourceGroupId, 'ungrouped');
                        }
                    }
                }
            }
            // Handle group drops (reordering groups)
            else if (itemType === 'group' && targetType === 'group') {
                if (itemId !== targetId) {
                    await handleMoveGroup(itemId, targetId);
                }
            }
        } finally {
            // Clear progress dialog
            setDropInProgress(null);
        }
    }, [handleMoveFromWallet, handleMoveFromNeuronManagers, handleMoveFromGroups, handleMoveCanister, handleMoveGroup]);

    // react-dnd canDrop checker - determines if a drop is allowed
    const canDropItem = useCallback((item, targetType, targetId = null) => {
        if (!item) return false;
        
        // Groups can only be dropped into other groups (within Groups section)
        // They cannot be dropped into wallet or neuron_managers
        if (item.type === 'group') {
            if (targetType === 'wallet' || targetType === 'neuron_managers' || targetType === 'ungrouped') {
                return false;
            }
        }
        
        // Don't allow dropping a group onto itself or its children
        if (item.type === 'group' && targetType === 'group') {
            if (item.id === targetId) return false;
            // Check if target is a child of the dragged group
            const isChildOf = (parentId, childId, groups) => {
                const findGroup = (gList) => {
                    for (const g of gList) {
                        if (g.id === parentId) {
                            const checkChildren = (subs) => {
                                for (const sub of subs) {
                                    if (sub.id === childId) return true;
                                    if (checkChildren(sub.subgroups)) return true;
                                }
                                return false;
                            };
                            return checkChildren(g.subgroups);
                        }
                        if (isChildOf(parentId, childId, g.subgroups)) return true;
                    }
                    return false;
                };
                return findGroup(groups);
            };
            if (isChildOf(item.id, targetId, canisterGroups.groups)) return false;
        }
        
        // Don't allow dropping on same location
        if (item.type === 'canister') {
            if (item.sourceGroupId === 'wallet' && targetType === 'wallet') return false;
            if (item.sourceGroupId === 'neuron_managers' && targetType === 'neuron_managers') return false;
            if (item.sourceGroupId === targetId) return false;
            if (item.sourceGroupId === 'ungrouped' && targetType === 'ungrouped') return false;
        }
        
        return true;
    }, [canisterGroups.groups]);

    // Recursive component for rendering a group - uses react-dnd
    const GroupComponent = ({ 
        group, depth, styles, theme, expandedGroups, setExpandedGroups,
        editingGroup, setEditingGroup, editingGroupName, setEditingGroupName,
        handleRenameGroup, handleDeleteGroup, canisterStatus, cycleSettings,
        principalNames, principalNicknames, isAuthenticated,
        confirmRemoveCanister, setConfirmRemoveCanister, handleRemoveCanister,
        canisterGroups, handleMoveCanister, handleMoveFromGroups,
        // New props for subgroups and adding canisters
        newSubgroupParent, setNewSubgroupParent, newSubgroupName, setNewSubgroupName,
        handleCreateSubgroup, addingCanisterToGroupId, setAddingCanisterToGroupId,
        newCanisterForGroup, setNewCanisterForGroup, handleAddCanisterToGroup,
        // Health status props
        getGroupHealthStatus, getStatusLampColor,
        // Drag and drop handlers
        onDndDrop, canDropItem,
        // Neuron manager detection props
        detectedNeuronManagers, neuronManagerCycleSettings, latestOfficialVersion,
        isVersionOutdated, getManagerHealthStatus,
    }) => {
        // react-dnd drag hook for making this group draggable
        const [{ isDragging }, drag] = useDrag(() => ({
            type: DragItemTypes.GROUP,
            item: { type: 'group', id: group.id, sourceGroupId: null },
            collect: (monitor) => ({
                isDragging: monitor.isDragging(),
            }),
        }), [group.id]);

        // react-dnd drop hook for accepting drops into this group
        const [{ isOver, canDrop }, drop] = useDrop(() => ({
            accept: [DragItemTypes.CANISTER, DragItemTypes.GROUP],
            canDrop: (item) => canDropItem(item, 'group', group.id),
            drop: (item, monitor) => {
                // Only handle if this is the direct drop target (not a nested one)
                if (monitor.didDrop()) return;
                onDndDrop(item, 'group', group.id);
            },
            collect: (monitor) => ({
                isOver: monitor.isOver({ shallow: true }),
                canDrop: monitor.canDrop(),
            }),
        }), [group.id, canDropItem, onDndDrop]);

        const isExpanded = expandedGroups[group.id] ?? true;
        const isEditing = editingGroup === group.id;
        const isAddingSubgroup = newSubgroupParent === group.id;
        const isAddingCanister = addingCanisterToGroupId === group.id;
        const totalCanisters = group.canisters.length + 
            group.subgroups.reduce((sum, sg) => sum + sg.canisters.length, 0);
        
        // Calculate health status for this group
        const healthStatus = getGroupHealthStatus(group, canisterStatus, cycleSettings);
        const lampColor = getStatusLampColor(healthStatus);
        const isDropTarget = isOver && canDrop;
        const isBeingDragged = isDragging;

        return (
            <div 
                ref={drop}
                style={{ 
                    marginBottom: '8px',
                    marginLeft: depth > 0 ? '20px' : '0',
                }}
            >
                {/* Group Header - draggable */}
                <div 
                    ref={drag}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        backgroundColor: isDropTarget ? `${theme.colors.accent}20` : theme.colors.secondaryBg,
                        borderRadius: '8px',
                        border: isDropTarget 
                            ? `2px dashed ${theme.colors.accent}` 
                            : `1px solid ${theme.colors.border}`,
                        cursor: isBeingDragged ? 'grabbing' : 'grab',
                        opacity: isBeingDragged ? 0.4 : 1,
                        transition: 'all 0.15s ease',
                    }}
                    onClick={() => setExpandedGroups(prev => ({ ...prev, [group.id]: !isExpanded }))}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {/* Health status lamp */}
                        <span
                            style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: lampColor,
                                boxShadow: healthStatus !== 'unknown' ? `0 0 6px ${lampColor}` : 'none',
                                flexShrink: 0,
                            }}
                            title={`Group health: ${healthStatus}`}
                        />
                        {isExpanded ? <FaFolderOpen style={{ color: '#f59e0b' }} /> : <FaFolder style={{ color: '#f59e0b' }} />}
                        {isEditing ? (
                            <input
                                type="text"
                                value={editingGroupName}
                                onChange={(e) => setEditingGroupName(e.target.value)}
                                onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === 'Enter') handleRenameGroup(group.id);
                                    if (e.key === 'Escape') { setEditingGroup(null); setEditingGroupName(''); }
                                }}
                                onClick={(e) => e.stopPropagation()}
                                style={{ 
                                    padding: '4px 8px', 
                                    fontSize: '14px',
                                    backgroundColor: theme.colors.tertiaryBg,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: '4px',
                                    color: theme.colors.primaryText,
                                }}
                                autoFocus
                            />
                        ) : (
                            <span style={{ fontWeight: 500, color: theme.colors.text }}>{group.name}</span>
                        )}
                        <span style={{ 
                            fontSize: '11px', 
                            color: theme.colors.secondaryText,
                            backgroundColor: theme.colors.tertiaryBg,
                            padding: '2px 8px',
                            borderRadius: '10px',
                        }}>
                            {totalCanisters}
                        </span>
                        {isDropTarget && (
                            <span style={{ 
                                fontSize: '11px', 
                                color: theme.colors.accent,
                                fontWeight: 600,
                                marginLeft: '8px',
                            }}>
                                ⬇ Drop here
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
                        {isEditing ? (
                            <>
                                <button
                                    onClick={() => handleRenameGroup(group.id)}
                                    style={{ padding: '4px 8px', backgroundColor: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                >
                                    <FaCheck size={10} />
                                </button>
                                <button
                                    onClick={() => { setEditingGroup(null); setEditingGroupName(''); }}
                                    style={{ padding: '4px 8px', backgroundColor: theme.colors.secondaryBg, color: theme.colors.secondaryText, border: `1px solid ${theme.colors.border}`, borderRadius: '4px', cursor: 'pointer' }}
                                >
                                    <FaTimes size={10} />
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    onClick={() => { setAddingCanisterToGroupId(group.id); setNewCanisterForGroup(''); }}
                                    style={{ padding: '4px 8px', backgroundColor: 'transparent', color: theme.colors.accent, border: 'none', cursor: 'pointer' }}
                                    title="Add app to this group"
                                >
                                    <FaCube size={12} />
                                </button>
                                <button
                                    onClick={() => { setNewSubgroupParent(group.id); setNewSubgroupName(''); }}
                                    style={{ padding: '4px 8px', backgroundColor: 'transparent', color: '#f59e0b', border: 'none', cursor: 'pointer' }}
                                    title="Add subgroup"
                                >
                                    <FaFolder size={12} />
                                </button>
                                <button
                                    onClick={() => { setEditingGroup(group.id); setEditingGroupName(group.name); }}
                                    style={{ padding: '4px 8px', backgroundColor: 'transparent', color: theme.colors.mutedText, border: 'none', cursor: 'pointer' }}
                                    title="Rename group"
                                >
                                    <FaEdit size={12} />
                                </button>
                                <button
                                    onClick={() => {
                                        if (window.confirm(`Delete group "${group.name}"? Apps will be moved to ungrouped.`)) {
                                            handleDeleteGroup(group.id);
                                        }
                                    }}
                                    style={{ padding: '4px 8px', backgroundColor: 'transparent', color: '#ef4444', border: 'none', cursor: 'pointer' }}
                                    title="Delete group"
                                >
                                    <FaTrash size={12} />
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Group Contents */}
                {isExpanded && (
                    <div style={{ marginTop: '8px', marginLeft: '12px' }}>
                        {/* Add App to Group Input */}
                        {isAddingCanister && (
                            <div style={{ 
                                display: 'flex', 
                                gap: '8px', 
                                alignItems: 'center', 
                                marginBottom: '8px',
                                padding: '10px',
                                backgroundColor: theme.colors.tertiaryBg,
                                borderRadius: '6px',
                            }}>
                                <FaCube size={14} style={{ color: theme.colors.accent }} />
                                <PrincipalInput
                                    value={newCanisterForGroup}
                                    onChange={setNewCanisterForGroup}
                                    placeholder="App canister id"
                                    autoFocus={true}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleAddCanisterToGroup(group.id);
                                        if (e.key === 'Escape') { setAddingCanisterToGroupId(null); setNewCanisterForGroup(''); }
                                    }}
                                    style={{ flex: 1, minWidth: 0, maxWidth: 'none' }}
                                    inputStyle={{ padding: '6px 10px', fontSize: '12px', fontFamily: 'monospace' }}
                                    disabled={addingCanister}
                                    defaultPrincipalType="canisters"
                                />
                                <button
                                    onClick={() => handleAddCanisterToGroup(group.id)}
                                    disabled={!newCanisterForGroup.trim()}
                                    style={{ 
                                        padding: '6px 10px', 
                                        backgroundColor: !newCanisterForGroup.trim() ? '#6c757d' : '#28a745', 
                                        color: '#fff', 
                                        border: 'none', 
                                        borderRadius: '4px', 
                                        cursor: !newCanisterForGroup.trim() ? 'not-allowed' : 'pointer',
                                        opacity: !newCanisterForGroup.trim() ? 0.6 : 1,
                                    }}
                                >
                                    <FaCheck size={10} />
                                </button>
                                <button
                                    onClick={() => { setAddingCanisterToGroupId(null); setNewCanisterForGroup(''); }}
                                    style={{ padding: '6px 10px', backgroundColor: theme.colors.secondaryBg, color: theme.colors.secondaryText, border: `1px solid ${theme.colors.border}`, borderRadius: '4px', cursor: 'pointer' }}
                                >
                                    <FaTimes size={10} />
                                </button>
                            </div>
                        )}

                        {/* Add Subgroup Input */}
                        {isAddingSubgroup && (
                            <div style={{ 
                                display: 'flex', 
                                gap: '8px', 
                                alignItems: 'center', 
                                marginBottom: '8px',
                                padding: '10px',
                                backgroundColor: theme.colors.tertiaryBg,
                                borderRadius: '6px',
                            }}>
                                <FaFolder size={14} style={{ color: '#f59e0b' }} />
                                <input
                                    type="text"
                                    placeholder="Subgroup name"
                                    value={newSubgroupName}
                                    onChange={(e) => setNewSubgroupName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleCreateSubgroup(group.id);
                                        if (e.key === 'Escape') { setNewSubgroupParent(null); setNewSubgroupName(''); }
                                    }}
                                    style={{ 
                                        flex: 1,
                                        padding: '6px 10px', 
                                        fontSize: '12px',
                                        backgroundColor: theme.colors.secondaryBg,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '4px',
                                        color: theme.colors.primaryText,
                                    }}
                                    autoFocus
                                />
                                <button
                                    onClick={() => handleCreateSubgroup(group.id)}
                                    disabled={!newSubgroupName.trim()}
                                    style={{ 
                                        padding: '6px 10px', 
                                        backgroundColor: !newSubgroupName.trim() ? '#6c757d' : '#28a745', 
                                        color: '#fff', 
                                        border: 'none', 
                                        borderRadius: '4px', 
                                        cursor: !newSubgroupName.trim() ? 'not-allowed' : 'pointer',
                                        opacity: !newSubgroupName.trim() ? 0.6 : 1,
                                    }}
                                >
                                    <FaCheck size={10} />
                                </button>
                                <button
                                    onClick={() => { setNewSubgroupParent(null); setNewSubgroupName(''); }}
                                    style={{ padding: '6px 10px', backgroundColor: theme.colors.secondaryBg, color: theme.colors.secondaryText, border: `1px solid ${theme.colors.border}`, borderRadius: '4px', cursor: 'pointer' }}
                                >
                                    <FaTimes size={10} />
                                </button>
                            </div>
                        )}

                        {/* Subgroups */}
                        {group.subgroups.map((subgroup) => (
                            <GroupComponent
                                key={subgroup.id}
                                group={subgroup}
                                depth={depth + 1}
                                styles={styles}
                                theme={theme}
                                expandedGroups={expandedGroups}
                                setExpandedGroups={setExpandedGroups}
                                editingGroup={editingGroup}
                                setEditingGroup={setEditingGroup}
                                editingGroupName={editingGroupName}
                                setEditingGroupName={setEditingGroupName}
                                handleRenameGroup={handleRenameGroup}
                                handleDeleteGroup={handleDeleteGroup}
                                canisterStatus={canisterStatus}
                                cycleSettings={cycleSettings}
                                principalNames={principalNames}
                                principalNicknames={principalNicknames}
                                isAuthenticated={isAuthenticated}
                                confirmRemoveCanister={confirmRemoveCanister}
                                setConfirmRemoveCanister={setConfirmRemoveCanister}
                                handleRemoveCanister={handleRemoveCanister}
                                canisterGroups={canisterGroups}
                                handleMoveCanister={handleMoveCanister}
                                handleMoveFromGroups={handleMoveFromGroups}
                                newSubgroupParent={newSubgroupParent}
                                setNewSubgroupParent={setNewSubgroupParent}
                                newSubgroupName={newSubgroupName}
                                setNewSubgroupName={setNewSubgroupName}
                                handleCreateSubgroup={handleCreateSubgroup}
                                addingCanisterToGroupId={addingCanisterToGroupId}
                                setAddingCanisterToGroupId={setAddingCanisterToGroupId}
                                newCanisterForGroup={newCanisterForGroup}
                                setNewCanisterForGroup={setNewCanisterForGroup}
                                handleAddCanisterToGroup={handleAddCanisterToGroup}
                                getGroupHealthStatus={getGroupHealthStatus}
                                getStatusLampColor={getStatusLampColor}
                                onDndDrop={onDndDrop}
                                canDropItem={canDropItem}
                                detectedNeuronManagers={detectedNeuronManagers}
                                neuronManagerCycleSettings={neuronManagerCycleSettings}
                                latestOfficialVersion={latestOfficialVersion}
                                isVersionOutdated={isVersionOutdated}
                                getManagerHealthStatus={getManagerHealthStatus}
                            />
                        ))}
                        
                        {/* Canisters in this group */}
                        {group.canisters.length > 0 && (
                            <div style={styles.canisterList}>
                                {group.canisters.map((canisterId) => {
                                    // Check if this canister is an SNS Root - show as special folder
                                    const snsData = snsRootDataMap.get(canisterId);
                                    if (snsData) {
                                        return (
                                            <SnsRootFolder
                                                key={canisterId}
                                                canisterId={canisterId}
                                                groupId={group.id}
                                                snsData={snsData}
                                                styles={styles}
                                                theme={theme}
                                                canisterStatus={canisterStatus}
                                                cycleSettings={cycleSettings}
                                            />
                                        );
                                    }
                                    // Check if this canister is a detected neuron manager
                                    const detectedManager = detectedNeuronManagers?.[canisterId];
                                    if (detectedManager) {
                                        return (
                                            <NeuronManagerCardItem
                                                key={canisterId}
                                                canisterId={canisterId}
                                                sourceGroupId={group.id}
                                                managerInfo={detectedManager}
                                                styles={styles}
                                                theme={theme}
                                                principalNames={principalNames}
                                                principalNicknames={principalNicknames}
                                                isAuthenticated={isAuthenticated}
                                                neuronManagerCycleSettings={neuronManagerCycleSettings}
                                                latestOfficialVersion={latestOfficialVersion}
                                                isVersionOutdated={isVersionOutdated}
                                                getManagerHealthStatus={getManagerHealthStatus}
                                                getStatusLampColor={getStatusLampColor}
                                                onRemove={(id) => handleRemoveCanister(id, group.id)}
                                                isConfirming={confirmRemoveCanister?.canisterId === canisterId && confirmRemoveCanister?.groupId === group.id}
                                                setConfirmRemove={(id) => setConfirmRemoveCanister(id ? { canisterId: id, groupId: group.id } : null)}
                                                isRemoving={false}
                                            />
                                        );
                                    }
                                    return (
                                        <CanisterCard
                                            key={canisterId}
                                            canisterId={canisterId}
                                            groupId={group.id}
                                            styles={styles}
                                            theme={theme}
                                            canisterStatus={canisterStatus}
                                            cycleSettings={cycleSettings}
                                            principalNames={principalNames}
                                            principalNicknames={principalNicknames}
                                            isAuthenticated={isAuthenticated}
                                            confirmRemoveCanister={confirmRemoveCanister}
                                            setConfirmRemoveCanister={setConfirmRemoveCanister}
                                            handleRemoveCanister={handleRemoveCanister}
                                        />
                                    );
                                })}
                            </div>
                        )}
                        
                        {/* Empty group message */}
                        {group.canisters.length === 0 && group.subgroups.length === 0 && (
                            <div style={{ 
                                padding: '16px', 
                                textAlign: 'center', 
                                color: theme.colors.secondaryText,
                                fontSize: '13px',
                                fontStyle: 'italic',
                            }}>
                                Empty group
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    // Helper to format memory size
    const formatMemory = (bytes) => {
        if (bytes === null || bytes === undefined) return 'N/A';
        const MB = 1024 * 1024;
        const GB = 1024 * 1024 * 1024;
        if (bytes >= GB) {
            return `${(bytes / GB).toFixed(2)} GB`;
        } else if (bytes >= MB) {
            return `${(bytes / MB).toFixed(1)} MB`;
        } else {
            return `${(bytes / 1024).toFixed(0)} KB`;
        }
    };

    // Helper to get group health status (worst status of all canisters in group and subgroups)
    // Also considers virtual SNS sub-canisters when a canister is an SNS root
    // Returns: 'red' | 'orange' | 'green' | 'unknown'
    const getGroupHealthStatus = useCallback((group, canisterStatus, cycleSettings) => {
        const { cycleThresholdRed, cycleThresholdOrange } = cycleSettings;
        
        // Status priority: red (3) > orange (2) > green (1) > unknown (0)
        const getCanisterStatusLevel = (canisterId) => {
            const status = canisterStatus[canisterId];
            if (!status || status.cycles === null || status.cycles === undefined) {
                return 0; // unknown
            }
            const cycles = status.cycles;
            if (cycles < cycleThresholdRed) return 3; // red
            if (cycles < cycleThresholdOrange) return 2; // orange
            return 1; // green
        };
        
        // Get worst status for a single canister, including its virtual SNS sub-canisters if it's an SNS root
        const getCanisterAndSubsLevel = (canisterId) => {
            let worst = getCanisterStatusLevel(canisterId);
            if (worst === 3) return 3;
            // If this is an SNS root, also check all its virtual sub-canisters
            const snsData = snsRootDataMap.get(canisterId);
            if (snsData) {
                for (const sc of snsData.systemCanisters) {
                    if (sc.id === canisterId) continue; // skip root itself (already checked)
                    const level = getCanisterStatusLevel(sc.id);
                    if (level > worst) worst = level;
                    if (worst === 3) return 3;
                }
                for (const dappId of snsData.dappCanisters) {
                    const level = getCanisterStatusLevel(dappId);
                    if (level > worst) worst = level;
                    if (worst === 3) return 3;
                }
                for (const archId of snsData.archiveCanisters) {
                    const level = getCanisterStatusLevel(archId);
                    if (level > worst) worst = level;
                    if (worst === 3) return 3;
                }
            }
            return worst;
        };
        
        // Recursively find worst status
        const getWorstStatus = (grp) => {
            let worst = 0;
            
            // Check all canisters in this group (including virtual SNS sub-canisters)
            for (const canisterId of grp.canisters) {
                const level = getCanisterAndSubsLevel(canisterId);
                if (level > worst) worst = level;
                if (worst === 3) return 3; // Can't get worse than red
            }
            
            // Check all subgroups
            for (const subgroup of grp.subgroups) {
                const subStatus = getWorstStatus(subgroup);
                if (subStatus > worst) worst = subStatus;
                if (worst === 3) return 3;
            }
            
            return worst;
        };
        
        const level = getWorstStatus(group);
        switch (level) {
            case 3: return 'red';
            case 2: return 'orange';
            case 1: return 'green';
            default: return 'unknown';
        }
    }, [snsRootDataMap]);

    // Helper to get status lamp color
    const getStatusLampColor = (status) => {
        switch (status) {
            case 'red': return '#ef4444';
            case 'orange': return '#f59e0b';
            case 'green': return '#22c55e';
            default: return '#6b7280'; // gray for unknown
        }
    };

    // Helper to get individual canister health status (cycles only)
    // Returns: 'red' | 'orange' | 'green' | 'unknown'
    const getCanisterHealthStatus = useCallback((canisterId, statusMap, cycleSettings) => {
        const { cycleThresholdRed, cycleThresholdOrange } = cycleSettings;
        const status = statusMap[canisterId];
        
        if (!status || status.cycles === null || status.cycles === undefined) {
            return 'unknown';
        }
        
        const cycles = status.cycles;
        if (cycles < cycleThresholdRed) return 'red';
        if (cycles < cycleThresholdOrange) return 'orange';
        return 'green';
    }, []);

    // Helper to calculate overall health statistics for wallet canisters
    const getWalletHealthStats = useCallback((canisterIds, statusMap, cycleSettings) => {
        const { cycleThresholdRed, cycleThresholdOrange } = cycleSettings;
        
        let red = 0, orange = 0, green = 0, unknown = 0;
        
        for (const canisterId of canisterIds) {
            const status = statusMap[canisterId];
            if (!status || status.cycles === null || status.cycles === undefined) {
                unknown++;
            } else {
                const cycles = status.cycles;
                if (cycles < cycleThresholdRed) red++;
                else if (cycles < cycleThresholdOrange) orange++;
                else green++;
            }
        }
        
        // Determine overall status (worst wins)
        let overallStatus = 'unknown';
        if (red > 0) overallStatus = 'red';
        else if (orange > 0) overallStatus = 'orange';
        else if (green > 0) overallStatus = 'green';
        
        return {
            red,
            orange,
            green,
            unknown,
            total: canisterIds.length,
            overallStatus
        };
    }, []);

    // Helper to calculate overall health statistics for all canisters
    // Also includes virtual SNS sub-canisters for SNS root canisters
    const getOverallHealthStats = useCallback((groupsRoot, canisterStatus, cycleSettings) => {
        const { cycleThresholdRed, cycleThresholdOrange } = cycleSettings;
        
        // Collect all canister IDs (including virtual SNS sub-canisters)
        const allCanisterIds = new Set();
        const collectFromGroups = (groups) => {
            for (const group of groups) {
                for (const cid of group.canisters) {
                    allCanisterIds.add(cid);
                    // If this is an SNS root, also add its virtual sub-canisters
                    const snsData = snsRootDataMap.get(cid);
                    if (snsData) {
                        for (const sc of snsData.systemCanisters) allCanisterIds.add(sc.id);
                        for (const d of snsData.dappCanisters) allCanisterIds.add(d);
                        for (const a of snsData.archiveCanisters) allCanisterIds.add(a);
                    }
                }
                collectFromGroups(group.subgroups);
            }
        };
        collectFromGroups(groupsRoot.groups);
        for (const cid of groupsRoot.ungrouped) {
            allCanisterIds.add(cid);
            const snsData = snsRootDataMap.get(cid);
            if (snsData) {
                for (const sc of snsData.systemCanisters) allCanisterIds.add(sc.id);
                for (const d of snsData.dappCanisters) allCanisterIds.add(d);
                for (const a of snsData.archiveCanisters) allCanisterIds.add(a);
            }
        }
        
        // Count by status
        let red = 0, orange = 0, green = 0, unknown = 0;
        
        for (const canisterId of allCanisterIds) {
            const status = canisterStatus[canisterId];
            if (!status || status.cycles === null || status.cycles === undefined) {
                unknown++;
            } else {
                const cycles = status.cycles;
                if (cycles < cycleThresholdRed) red++;
                else if (cycles < cycleThresholdOrange) orange++;
                else green++;
            }
        }
        
        // Determine overall status (worst wins)
        let overallStatus = 'unknown';
        if (red > 0) overallStatus = 'red';
        else if (orange > 0) overallStatus = 'orange';
        else if (green > 0) overallStatus = 'green';
        
        return {
            red,
            orange,
            green,
            unknown,
            total: allCanisterIds.size,
            overallStatus
        };
    }, [snsRootDataMap]);

    // Helper to get individual manager health status (considers cycles AND version)
    // Returns: 'red' | 'orange' | 'green' | 'unknown'
    const getManagerHealthStatus = useCallback((manager, cycleSettings) => {
        const { cycleThresholdRed, cycleThresholdOrange } = cycleSettings;
        
        // Check cycles first
        if (manager.cycles === null || manager.cycles === undefined) {
            // Unknown cycles - check if version is outdated (orange) or unknown (gray)
            if (isVersionOutdated(manager.version)) {
                return 'orange';
            }
            return 'unknown';
        }
        
        const cycles = manager.cycles;
        
        // Red: critical cycles
        if (cycles < cycleThresholdRed) {
            return 'red';
        }
        
        // Orange: warning cycles OR outdated version
        if (cycles < cycleThresholdOrange || isVersionOutdated(manager.version)) {
            return 'orange';
        }
        
        // Green: healthy cycles and up-to-date version
        return 'green';
    }, [isVersionOutdated]);

    // Helper to calculate overall health statistics for all neuron managers
    const getManagersHealthStats = useCallback((managers, cycleSettings) => {
        let red = 0, orange = 0, green = 0, unknown = 0;
        let outdated = 0;
        
        for (const manager of managers) {
            const status = getManagerHealthStatus(manager, neuronManagerCycleSettings);
            switch (status) {
                case 'red': red++; break;
                case 'orange': orange++; break;
                case 'green': green++; break;
                default: unknown++; break;
            }
            if (isVersionOutdated(manager.version)) {
                outdated++;
            }
        }
        
        // Determine overall status (worst wins)
        let overallStatus = 'unknown';
        if (red > 0) overallStatus = 'red';
        else if (orange > 0) overallStatus = 'orange';
        else if (green > 0) overallStatus = 'green';
        
        return {
            red,
            orange,
            green,
            unknown,
            outdated,
            total: managers.length,
            overallStatus
        };
    }, [getManagerHealthStatus, isVersionOutdated]);

    // Helper to calculate overall health statistics for all groups
    // Also includes virtual SNS sub-canisters when a canister is an SNS root
    const getGroupsHealthStats = useCallback((groups, ungrouped, statusMap, cycleSettings, detectedManagers, nmCycleSettings) => {
        const { cycleThresholdRed, cycleThresholdOrange } = cycleSettings;
        const nmRed = nmCycleSettings?.cycleThresholdRed || cycleThresholdRed;
        const nmOrange = nmCycleSettings?.cycleThresholdOrange || cycleThresholdOrange;
        
        let red = 0, orange = 0, green = 0, unknown = 0;
        let outdated = 0;
        const counted = new Set(); // avoid double-counting virtual sub-canisters
        
        // Count a single regular canister
        const countRegularCanister = (canisterId) => {
            if (counted.has(canisterId)) return;
            counted.add(canisterId);
            const status = statusMap[canisterId];
            if (!status || status.cycles === null || status.cycles === undefined) {
                unknown++;
            } else {
                const cycles = status.cycles;
                if (cycles < cycleThresholdRed) red++;
                else if (cycles < cycleThresholdOrange) orange++;
                else green++;
            }
        };
        
        // Count a canister, expanding SNS roots to include virtual sub-canisters
        const countCanister = (canisterId) => {
            // Check if this is a detected neuron manager
            const detectedManager = detectedManagers?.[canisterId];
            if (detectedManager?.isValid) {
                if (!counted.has(canisterId)) {
                    counted.add(canisterId);
                    const cycles = detectedManager.cycles;
                    if (cycles === null || cycles === undefined) {
                        unknown++;
                    } else if (cycles < nmRed) {
                        red++;
                    } else if (cycles < nmOrange) {
                        orange++;
                    } else {
                        green++;
                    }
                    if (detectedManager.version && isVersionOutdated(detectedManager.version)) {
                        outdated++;
                    }
                }
            } else {
                countRegularCanister(canisterId);
            }
            // If this is an SNS root, also count all its virtual sub-canisters
            const snsData = snsRootDataMap.get(canisterId);
            if (snsData) {
                for (const sc of snsData.systemCanisters) {
                    countRegularCanister(sc.id);
                }
                for (const d of snsData.dappCanisters) {
                    countRegularCanister(d);
                }
                for (const a of snsData.archiveCanisters) {
                    countRegularCanister(a);
                }
            }
        };
        
        // Recursively count canisters in groups
        const countCanisterInGroup = (grp) => {
            for (const canisterId of grp.canisters) {
                countCanister(canisterId);
            }
            for (const subgroup of grp.subgroups) {
                countCanisterInGroup(subgroup);
            }
        };
        
        // Count all groups
        for (const grp of groups) {
            countCanisterInGroup(grp);
        }
        
        // Count ungrouped canisters
        for (const canisterId of ungrouped) {
            countCanister(canisterId);
        }
        
        // Determine overall status (worst wins)
        let overallStatus = 'unknown';
        if (red > 0) overallStatus = 'red';
        else if (orange > 0) overallStatus = 'orange';
        else if (green > 0) overallStatus = 'green';
        
        const total = red + orange + green + unknown;
        
        return { red, orange, green, unknown, outdated, total, overallStatus };
    }, [isVersionOutdated, snsRootDataMap]);

    // Helper to get overall section status for wallet canisters section
    const getWalletCanistersStatus = useCallback((canisterIds, statusMap, cycleSettings, detectedManagers, nmCycleSettings) => {
        const { cycleThresholdRed, cycleThresholdOrange } = cycleSettings;
        const nmRed = nmCycleSettings?.cycleThresholdRed || cycleThresholdRed;
        const nmOrange = nmCycleSettings?.cycleThresholdOrange || cycleThresholdOrange;
        
        let red = 0, orange = 0, green = 0, unknown = 0;
        
        for (const canisterId of canisterIds) {
            const detectedManager = detectedManagers?.[canisterId];
            if (detectedManager?.isValid) {
                const cycles = detectedManager.cycles;
                if (cycles === null || cycles === undefined) {
                    unknown++;
                } else if (cycles < nmRed) {
                    red++;
                } else if (cycles < nmOrange) {
                    orange++;
                } else {
                    green++;
                }
            } else {
                const status = statusMap[canisterId];
                if (!status || status.cycles === null || status.cycles === undefined) {
                    unknown++;
                } else {
                    const cycles = status.cycles;
                    if (cycles < cycleThresholdRed) red++;
                    else if (cycles < cycleThresholdOrange) orange++;
                    else green++;
                }
            }
        }
        
        let overallStatus = 'unknown';
        if (red > 0) overallStatus = 'red';
        else if (orange > 0) overallStatus = 'orange';
        else if (green > 0) overallStatus = 'green';
        
        return { red, orange, green, unknown, total: canisterIds.length, overallStatus };
    }, []);

    // Component for rendering a single canister card - uses react-dnd
    const CanisterCard = ({ 
        canisterId, groupId, styles, theme, canisterStatus, cycleSettings,
        principalNames, principalNicknames, isAuthenticated,
        confirmRemoveCanister, setConfirmRemoveCanister, handleRemoveCanister
    }) => {
        // react-dnd drag hook
        const [{ isDragging }, drag] = useDrag(() => ({
            type: DragItemTypes.CANISTER,
            item: { type: 'canister', id: canisterId, sourceGroupId: groupId },
            collect: (monitor) => ({
                isDragging: monitor.isDragging(),
            }),
        }), [canisterId, groupId]);

        const displayInfo = getPrincipalDisplayInfoFromContext(canisterId, principalNames, principalNicknames, verifiedNames, principalCanisterTypes);
        const status = canisterStatus[canisterId];
        const cycles = status?.cycles;
        const memory = status?.memory;
        const isController = status?.isController;
        const isConfirming = confirmRemoveCanister?.canisterId === canisterId && confirmRemoveCanister?.groupId === groupId;
        
        // Compute health status for cycle lamp overlay
        const canisterHealth = getCanisterHealthStatus(canisterId, canisterStatus, cycleSettings);
        const canisterLampColor = getStatusLampColor(canisterHealth);

        return (
            <div 
                ref={drag}
                style={{
                    ...styles.canisterCard,
                    cursor: isDragging ? 'grabbing' : 'grab',
                    opacity: isDragging ? 0.4 : 1,
                    transition: 'opacity 0.15s ease',
                }}
            >
                <div style={styles.canisterInfo}>
                    <div style={{ ...styles.canisterIcon, position: 'relative' }}>
                        {getCanisterTypeIcon(displayInfo?.canisterTypes, 18, theme.colors.accent)}
                        {isController && (
                            <FaCrown 
                                size={10} 
                                style={{ 
                                    position: 'absolute', 
                                    top: -4, 
                                    right: -4, 
                                    color: '#f59e0b',
                                }} 
                                title="You are a controller"
                            />
                        )}
                        {/* Cycle status lamp - top left */}
                        <span
                            style={{
                                position: 'absolute',
                                top: -3,
                                left: -3,
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: canisterLampColor,
                                boxShadow: canisterHealth !== 'unknown' ? `0 0 6px ${canisterLampColor}` : 'none',
                                zIndex: 2,
                            }}
                            title={`Health: ${canisterHealth}`}
                        />
                        {isSnsCanisterType(displayInfo?.canisterTypes) && <SnsPill size="small" />}
                    </div>
                    <PrincipalDisplay
                        principal={canisterId}
                        displayInfo={displayInfo}
                        showCopyButton={true}
                        isAuthenticated={isAuthenticated}
                        noLink={true}
                        style={{ fontSize: '14px' }}
                        showSendMessage={false}
                        showViewProfile={false}
                    />
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginLeft: 'auto' }}>
                    {/* Cycles badge */}
                    {cycles !== undefined && cycles !== null && (
                        <span 
                            style={{
                                ...styles.managerVersion,
                                backgroundColor: `${getCyclesColor(cycles, neuronManagerCycleSettings)}20`,
                                color: getCyclesColor(cycles, neuronManagerCycleSettings),
                            }}
                            title={`${cycles.toLocaleString()} cycles`}
                        >
                            ⚡ {formatCyclesCompact(cycles)}
                        </span>
                    )}
                    {/* Memory badge */}
                    {memory !== undefined && memory !== null && (
                        <span 
                            style={{
                                ...styles.managerVersion,
                                backgroundColor: `${theme.colors.accent}20`,
                                color: theme.colors.accent,
                            }}
                            title={`${memory.toLocaleString()} bytes`}
                        >
                            💾 {formatMemory(memory)}
                        </span>
                    )}
                    {status === undefined && (
                        <span 
                            style={{
                                ...styles.managerVersion,
                                backgroundColor: `${theme.colors.mutedText || theme.colors.secondaryText}20`,
                                color: theme.colors.mutedText || theme.colors.secondaryText,
                            }}
                        >
                            ⚡ ...
                        </span>
                    )}
                    <Link
                        to={`/canister?id=${canisterId}`}
                        style={{
                            ...styles.viewLink,
                            padding: '6px 8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                        title="View details"
                    >
                        <FaEdit size={12} />
                    </Link>
                    {isConfirming ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ color: '#888', fontSize: '11px' }}>Remove?</span>
                            <button
                                onClick={() => handleRemoveCanister(canisterId, groupId)}
                                style={{
                                    backgroundColor: '#ef4444',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '4px 10px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                }}
                            >
                                Yes
                            </button>
                            <button
                                onClick={() => setConfirmRemoveCanister(null)}
                                style={{
                                    backgroundColor: theme.colors.secondaryBg,
                                    color: theme.colors.primaryText,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: '4px',
                                    padding: '4px 10px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                }}
                            >
                                No
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setConfirmRemoveCanister({ canisterId, groupId })}
                            style={styles.removeButton}
                            title="Remove from tracking"
                        >
                            <FaTrash />
                        </button>
                    )}
                </div>
            </div>
        );
    };
    
    // Component for rendering a virtual (non-draggable, non-removable) canister card
    // Used for SNS sub-canisters shown inside SNS root folders
    const VirtualCanisterCard = ({ canisterId, typeLabel, styles, theme, canisterStatus: statusMap, cycleSettings: cSettings }) => {
        const displayInfo = getPrincipalDisplayInfoFromContext(canisterId, principalNames, principalNicknames, verifiedNames, principalCanisterTypes);
        const status = statusMap[canisterId];
        const cycles = status?.cycles;
        const memory = status?.memory;
        
        const canisterHealth = getCanisterHealthStatus(canisterId, statusMap, cSettings);
        const canisterLampColor = getStatusLampColor(canisterHealth);

        return (
            <div 
                style={{
                    ...styles.canisterCard,
                    cursor: 'default',
                    transition: 'opacity 0.15s ease',
                }}
            >
                <div style={styles.canisterInfo}>
                    <div style={{ ...styles.canisterIcon, position: 'relative' }}>
                        {getCanisterTypeIcon(displayInfo?.canisterTypes, 18, theme.colors.accent)}
                        {/* Cycle status lamp - top left */}
                        <span
                            style={{
                                position: 'absolute',
                                top: -3,
                                left: -3,
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: canisterLampColor,
                                boxShadow: canisterHealth !== 'unknown' ? `0 0 6px ${canisterLampColor}` : 'none',
                                zIndex: 2,
                            }}
                            title={`Health: ${canisterHealth}`}
                        />
                        {isSnsCanisterType(displayInfo?.canisterTypes) && <SnsPill size="small" />}
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <PrincipalDisplay
                                principal={canisterId}
                                displayInfo={displayInfo}
                                showCopyButton={true}
                                isAuthenticated={isAuthenticated}
                                noLink={true}
                                style={{ fontSize: '13px' }}
                                showSendMessage={false}
                                showViewProfile={false}
                            />
                        </div>
                        {typeLabel && (
                            <span style={{
                                fontSize: '10px',
                                color: theme.colors.secondaryText,
                                fontWeight: 500,
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                            }}>
                                {typeLabel}
                            </span>
                        )}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginLeft: 'auto' }}>
                    {cycles !== undefined && cycles !== null && (
                        <span 
                            style={{
                                ...styles.managerVersion,
                                backgroundColor: `${getCyclesColor(cycles, neuronManagerCycleSettings)}20`,
                                color: getCyclesColor(cycles, neuronManagerCycleSettings),
                            }}
                            title={`${cycles.toLocaleString()} cycles`}
                        >
                            ⚡ {formatCyclesCompact(cycles)}
                        </span>
                    )}
                    {memory !== undefined && memory !== null && (
                        <span 
                            style={{
                                ...styles.managerVersion,
                                backgroundColor: `${theme.colors.accent}20`,
                                color: theme.colors.accent,
                            }}
                            title={`${memory.toLocaleString()} bytes`}
                        >
                            💾 {formatMemory(memory)}
                        </span>
                    )}
                    {status === undefined && (
                        <span 
                            style={{
                                ...styles.managerVersion,
                                backgroundColor: `${theme.colors.mutedText || theme.colors.secondaryText}20`,
                                color: theme.colors.mutedText || theme.colors.secondaryText,
                            }}
                        >
                            ⚡ ...
                        </span>
                    )}
                    <Link
                        to={`/canister?id=${canisterId}`}
                        style={{
                            ...styles.viewLink,
                            padding: '6px 8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                        title="View details"
                    >
                        <FaEdit size={12} />
                    </Link>
                </div>
            </div>
        );
    };

    // Component for rendering an SNS Root canister as a special folder
    // Shows the SNS logo and DAO name, with System and Dapps sub-folders
    const SnsRootFolder = ({ canisterId, groupId, snsData, styles, theme, canisterStatus: statusMap, cycleSettings: cSettings }) => {
        const isExpanded = expandedSnsRoots[canisterId] ?? false;
        const systemExpanded = expandedSnsSubfolders[`${canisterId}_system`] ?? true;
        const dappsExpanded = expandedSnsSubfolders[`${canisterId}_dapps`] ?? true;
        
        // react-dnd drag hook - the SNS root folder is still draggable
        const [{ isDragging }, drag] = useDrag(() => ({
            type: DragItemTypes.CANISTER,
            item: { type: 'canister', id: canisterId, sourceGroupId: groupId },
            collect: (monitor) => ({
                isDragging: monitor.isDragging(),
            }),
        }), [canisterId, groupId]);

        // Compute overall health for the SNS folder (worst of all sub-canisters)
        const getSnsOverallHealth = () => {
            const { cycleThresholdRed, cycleThresholdOrange } = cSettings;
            let worst = 0;
            const checkCanister = (cid) => {
                const status = statusMap[cid];
                if (!status || status.cycles === null || status.cycles === undefined) return;
                if (status.cycles < cycleThresholdRed) { worst = 3; return; }
                if (status.cycles < cycleThresholdOrange) { if (worst < 2) worst = 2; return; }
                if (worst < 1) worst = 1;
            };
            for (const sc of snsData.systemCanisters) { checkCanister(sc.id); if (worst === 3) break; }
            if (worst < 3) {
                for (const d of snsData.dappCanisters) { checkCanister(d); if (worst === 3) break; }
            }
            switch (worst) {
                case 3: return 'red';
                case 2: return 'orange';
                case 1: return 'green';
                default: return 'unknown';
            }
        };
        const overallHealth = getSnsOverallHealth();
        const overallLampColor = getStatusLampColor(overallHealth);
        
        const totalCanisters = snsData.systemCanisters.length + snsData.dappCanisters.length;

        return (
            <div style={{ marginBottom: '4px' }}>
                {/* SNS Folder Header - draggable */}
                <div 
                    ref={drag}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        backgroundColor: theme.colors.secondaryBg,
                        borderRadius: '8px',
                        border: `1px solid ${theme.colors.border}`,
                        cursor: isDragging ? 'grabbing' : 'grab',
                        opacity: isDragging ? 0.4 : 1,
                        transition: 'all 0.15s ease',
                    }}
                    onClick={() => setExpandedSnsRoots(prev => ({ ...prev, [canisterId]: !isExpanded }))}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {/* Health status lamp */}
                        <span
                            style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: overallLampColor,
                                boxShadow: overallHealth !== 'unknown' ? `0 0 6px ${overallLampColor}` : 'none',
                                flexShrink: 0,
                            }}
                            title={`SNS health: ${overallHealth}`}
                        />
                        {/* SNS Logo or fallback icon */}
                        <div style={{ position: 'relative', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {snsData.logo ? (
                                <img 
                                    src={snsData.logo} 
                                    alt={snsData.name}
                                    style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover' }}
                                />
                            ) : (
                                isExpanded ? <FaFolderOpen style={{ color: '#8b5cf6', fontSize: '18px' }} /> : <FaFolder style={{ color: '#8b5cf6', fontSize: '18px' }} />
                            )}
                            <SnsPill size="small" />
                        </div>
                        <span style={{ fontWeight: 600, color: theme.colors.text, fontSize: '14px' }}>
                            {snsData.name}
                        </span>
                        {snsData.tokenSymbol && (
                            <span style={{
                                fontSize: '11px',
                                color: '#8b5cf6',
                                fontWeight: 600,
                                backgroundColor: 'rgba(139, 92, 246, 0.1)',
                                padding: '2px 6px',
                                borderRadius: '8px',
                            }}>
                                ${snsData.tokenSymbol}
                            </span>
                        )}
                        <span style={{ 
                            fontSize: '11px', 
                            color: theme.colors.secondaryText,
                            backgroundColor: theme.colors.tertiaryBg,
                            padding: '2px 8px',
                            borderRadius: '10px',
                        }}>
                            {totalCanisters}
                        </span>
                        {isExpanded ? <FaChevronDown size={10} style={{ color: theme.colors.secondaryText }} /> : <FaChevronRight size={10} style={{ color: theme.colors.secondaryText }} />}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                        <Link
                            to={`/canister?id=${canisterId}`}
                            style={{
                                ...styles.viewLink,
                                padding: '4px 8px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                            title="View root canister"
                        >
                            <FaEdit size={12} />
                        </Link>
                    </div>
                </div>
                
                {/* SNS Folder Contents */}
                {isExpanded && (
                    <div style={{ marginTop: '6px', marginLeft: '16px' }}>
                        {/* System sub-folder */}
                        {snsData.systemCanisters.length > 0 && (
                            <div style={{ marginBottom: '6px' }}>
                                <div 
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '6px 10px',
                                        backgroundColor: theme.colors.tertiaryBg,
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        fontSize: '13px',
                                    }}
                                    onClick={() => setExpandedSnsSubfolders(prev => ({ ...prev, [`${canisterId}_system`]: !systemExpanded }))}
                                >
                                    {/* Sub-folder health lamp */}
                                    {(() => {
                                        const { cycleThresholdRed, cycleThresholdOrange } = cSettings;
                                        let worst = 0;
                                        for (const sc of snsData.systemCanisters) {
                                            const s = statusMap[sc.id];
                                            if (!s || s.cycles == null) continue;
                                            if (s.cycles < cycleThresholdRed) { worst = 3; break; }
                                            if (s.cycles < cycleThresholdOrange && worst < 2) worst = 2;
                                            else if (worst < 1) worst = 1;
                                        }
                                        const health = worst === 3 ? 'red' : worst === 2 ? 'orange' : worst === 1 ? 'green' : 'unknown';
                                        const color = getStatusLampColor(health);
                                        return (
                                            <span style={{
                                                width: '7px', height: '7px', borderRadius: '50%',
                                                backgroundColor: color,
                                                boxShadow: health !== 'unknown' ? `0 0 5px ${color}` : 'none',
                                                flexShrink: 0,
                                            }} title={`System health: ${health}`} />
                                        );
                                    })()}
                                    {systemExpanded ? <FaFolderOpen size={12} style={{ color: '#a78bfa' }} /> : <FaFolder size={12} style={{ color: '#a78bfa' }} />}
                                    <span style={{ fontWeight: 500, color: theme.colors.text }}>System</span>
                                    <span style={{ fontSize: '10px', color: theme.colors.secondaryText }}>
                                        {snsData.systemCanisters.length}
                                    </span>
                                </div>
                                {systemExpanded && (
                                    <div style={{ marginTop: '4px', marginLeft: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        {snsData.systemCanisters.map(sc => (
                                            <VirtualCanisterCard
                                                key={sc.id}
                                                canisterId={sc.id}
                                                typeLabel={sc.label}
                                                styles={styles}
                                                theme={theme}
                                                canisterStatus={statusMap}
                                                cycleSettings={cSettings}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {/* Dapps sub-folder */}
                        {snsData.dappCanisters.length > 0 && (
                            <div style={{ marginBottom: '6px' }}>
                                <div 
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '6px 10px',
                                        backgroundColor: theme.colors.tertiaryBg,
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        fontSize: '13px',
                                    }}
                                    onClick={() => setExpandedSnsSubfolders(prev => ({ ...prev, [`${canisterId}_dapps`]: !dappsExpanded }))}
                                >
                                    {/* Sub-folder health lamp */}
                                    {(() => {
                                        const { cycleThresholdRed, cycleThresholdOrange } = cSettings;
                                        let worst = 0;
                                        for (const d of snsData.dappCanisters) {
                                            const s = statusMap[d];
                                            if (!s || s.cycles == null) continue;
                                            if (s.cycles < cycleThresholdRed) { worst = 3; break; }
                                            if (s.cycles < cycleThresholdOrange && worst < 2) worst = 2;
                                            else if (worst < 1) worst = 1;
                                        }
                                        const health = worst === 3 ? 'red' : worst === 2 ? 'orange' : worst === 1 ? 'green' : 'unknown';
                                        const color = getStatusLampColor(health);
                                        return (
                                            <span style={{
                                                width: '7px', height: '7px', borderRadius: '50%',
                                                backgroundColor: color,
                                                boxShadow: health !== 'unknown' ? `0 0 5px ${color}` : 'none',
                                                flexShrink: 0,
                                            }} title={`Dapps health: ${health}`} />
                                        );
                                    })()}
                                    {dappsExpanded ? <FaFolderOpen size={12} style={{ color: '#60a5fa' }} /> : <FaFolder size={12} style={{ color: '#60a5fa' }} />}
                                    <span style={{ fontWeight: 500, color: theme.colors.text }}>Dapps</span>
                                    <span style={{ fontSize: '10px', color: theme.colors.secondaryText }}>
                                        {snsData.dappCanisters.length}
                                    </span>
                                </div>
                                {dappsExpanded && (
                                    <div style={{ marginTop: '4px', marginLeft: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        {snsData.dappCanisters.map(dappId => (
                                            <VirtualCanisterCard
                                                key={dappId}
                                                canisterId={dappId}
                                                typeLabel="Dapp"
                                                styles={styles}
                                                theme={theme}
                                                canisterStatus={statusMap}
                                                cycleSettings={cSettings}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Archives (if any) */}
                        {snsData.archiveCanisters.length > 0 && (
                            <div style={{ marginBottom: '6px' }}>
                                <div 
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '6px 10px',
                                        backgroundColor: theme.colors.tertiaryBg,
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        fontSize: '13px',
                                    }}
                                    onClick={() => setExpandedSnsSubfolders(prev => ({ ...prev, [`${canisterId}_archives`]: !(expandedSnsSubfolders[`${canisterId}_archives`] ?? false) }))}
                                >
                                    {(expandedSnsSubfolders[`${canisterId}_archives`] ?? false) ? <FaFolderOpen size={12} style={{ color: '#9ca3af' }} /> : <FaFolder size={12} style={{ color: '#9ca3af' }} />}
                                    <span style={{ fontWeight: 500, color: theme.colors.secondaryText }}>Archives</span>
                                    <span style={{ fontSize: '10px', color: theme.colors.secondaryText }}>
                                        {snsData.archiveCanisters.length}
                                    </span>
                                </div>
                                {(expandedSnsSubfolders[`${canisterId}_archives`] ?? false) && (
                                    <div style={{ marginTop: '4px', marginLeft: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        {snsData.archiveCanisters.map(archId => (
                                            <VirtualCanisterCard
                                                key={archId}
                                                canisterId={archId}
                                                typeLabel="Archive"
                                                styles={styles}
                                                theme={theme}
                                                canisterStatus={statusMap}
                                                cycleSettings={cSettings}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    // Component for rendering a detected neuron manager card (can be used in any section)
    const NeuronManagerCardItem = ({
        canisterId,
        sourceGroupId,
        managerInfo, // { version, neuronCount, cycles, memory, isController }
        styles,
        theme,
        principalNames,
        principalNicknames,
        isAuthenticated,
        neuronManagerCycleSettings,
        latestOfficialVersion,
        isVersionOutdated,
        getManagerHealthStatus,
        getStatusLampColor,
        onRemove,
        isConfirming,
        setConfirmRemove,
        isRemoving,
    }) => {
        // react-dnd drag hook
        const [{ isDragging }, drag] = useDrag(() => ({
            type: DragItemTypes.CANISTER,
            item: { type: 'canister', id: canisterId, sourceGroupId },
            collect: (monitor) => ({
                isDragging: monitor.isDragging(),
            }),
        }), [canisterId, sourceGroupId]);

        const displayInfo = getPrincipalDisplayInfoFromContext(canisterId, principalNames, principalNicknames, verifiedNames, principalCanisterTypes);
        const version = managerInfo?.version;
        const neuronCount = managerInfo?.neuronCount || 0;
        const cycles = managerInfo?.cycles;
        const memory = managerInfo?.memory;
        const isController = managerInfo?.isController;
        
        // Compute health status similar to neuron managers section
        const healthStatus = getManagerHealthStatus({ cycles, version }, neuronManagerCycleSettings);
        const lampColor = getStatusLampColor(healthStatus);

        return (
            <div 
                ref={drag}
                style={{
                    ...styles.managerCard,
                    cursor: isDragging ? 'grabbing' : 'grab',
                    opacity: isDragging ? 0.4 : 1,
                    transition: 'opacity 0.15s ease',
                }}
            >
                <div style={styles.managerInfo}>
                    <div style={{ ...styles.managerIcon, position: 'relative' }}>
                        <FaBrain size={18} />
                        {isController && (
                            <FaCrown 
                                size={10} 
                                style={{ 
                                    position: 'absolute', 
                                    top: -4, 
                                    right: -4, 
                                    color: '#f59e0b',
                                }} 
                                title="You are a controller"
                            />
                        )}
                        {/* Cycle status lamp - top left */}
                        <span
                            style={{
                                position: 'absolute',
                                top: -3,
                                left: -3,
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: lampColor,
                                boxShadow: healthStatus !== 'unknown' ? `0 0 6px ${lampColor}` : 'none',
                                zIndex: 2,
                            }}
                            title={`Health: ${healthStatus}${isVersionOutdated(version) ? ' (outdated version)' : ''}`}
                        />
                    </div>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            <PrincipalDisplay
                                principal={canisterId}
                                displayInfo={displayInfo}
                                showCopyButton={true}
                                isAuthenticated={isAuthenticated}
                                noLink={true}
                                style={{ fontSize: '14px' }}
                                showSendMessage={false}
                                showViewProfile={false}
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            {version && (
                                <span 
                                    style={{
                                        ...styles.managerVersion,
                                        ...(isVersionOutdated(version) ? {
                                            backgroundColor: '#f59e0b20',
                                            color: '#f59e0b',
                                        } : {}),
                                    }}
                                    title={isVersionOutdated(version) 
                                        ? `Newer version available: v${Number(latestOfficialVersion?.major || 0)}.${Number(latestOfficialVersion?.minor || 0)}.${Number(latestOfficialVersion?.patch || 0)}`
                                        : undefined
                                    }
                                >
                                    {isVersionOutdated(version) && '⚠️ '}
                                    v{Number(version.major)}.{Number(version.minor)}.{Number(version.patch)}
                                </span>
                            )}
                            <span style={{
                                ...styles.managerVersion,
                                backgroundColor: neuronCount > 0 ? '#8b5cf620' : theme.colors.tertiaryBg,
                                color: neuronCount > 0 ? '#8b5cf6' : theme.colors.secondaryText,
                            }}>
                                🧠 {neuronCount} neuron{neuronCount !== 1 ? 's' : ''}
                            </span>
                            {cycles !== null && cycles !== undefined && (
                                <span 
                                    style={{
                                        ...styles.managerVersion,
                                        backgroundColor: `${getCyclesColor(cycles, neuronManagerCycleSettings)}20`,
                                        color: getCyclesColor(cycles, neuronManagerCycleSettings),
                                    }}
                                    title={`${cycles.toLocaleString()} cycles`}
                                >
                                    ⚡ {formatCyclesCompact(cycles)}
                                </span>
                            )}
                            {memory !== null && memory !== undefined && (
                                <span 
                                    style={{
                                        ...styles.managerVersion,
                                        backgroundColor: `${theme.colors.accent}20`,
                                        color: theme.colors.accent,
                                    }}
                                    title={`${memory.toLocaleString()} bytes`}
                                >
                                    💾 {formatMemory(memory)}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <Link
                        to={`/icp_neuron_manager/${canisterId}`}
                        style={{
                            ...styles.viewLink,
                            backgroundColor: '#8b5cf615',
                            color: '#8b5cf6',
                            padding: '6px 8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                        title="Manage neurons"
                    >
                        <FaBrain size={12} />
                    </Link>
                    <Link
                        to={`/canister?id=${canisterId}`}
                        style={{
                            ...styles.viewLink,
                            padding: '6px 8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                        title="View details"
                    >
                        <FaEdit size={12} />
                    </Link>
                    {isConfirming ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
                            <span style={{ color: '#888', fontSize: '11px', whiteSpace: 'nowrap' }}>Remove?</span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setConfirmRemove(null);
                                    onRemove(canisterId);
                                }}
                                disabled={isRemoving}
                                style={{
                                    backgroundColor: '#ef4444',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '4px 10px',
                                    cursor: isRemoving ? 'not-allowed' : 'pointer',
                                    fontSize: '12px',
                                    fontWeight: '500',
                                    opacity: isRemoving ? 0.7 : 1,
                                }}
                            >
                                {isRemoving ? '...' : 'Yes'}
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setConfirmRemove(null);
                                }}
                                style={{
                                    backgroundColor: theme.colors.secondaryBg,
                                    color: theme.colors.primaryText,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: '4px',
                                    padding: '4px 10px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                }}
                            >
                                No
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={(e) => { 
                                e.stopPropagation(); 
                                setConfirmRemove(canisterId);
                            }}
                            style={styles.removeButton}
                            disabled={isRemoving}
                            title="Remove from list"
                        >
                            {isRemoving ? (
                                <FaSpinner className="spin" />
                            ) : (
                                <FaTrash />
                            )}
                        </button>
                    )}
                </div>
            </div>
        );
    };

    // Computed: outdated neuron managers (controllers only) for upgrade banner
    const outdatedManagersForBanner = React.useMemo(() => {
        if (!latestOfficialVersion || neuronManagers.length === 0) return [];
        return neuronManagers.filter(m => {
            if (!m.version || !isVersionOutdated(m.version)) return false;
            return m.isController === true;
        });
    }, [neuronManagers, latestOfficialVersion, isVersionOutdated]);

    // Computed: low-cycles canisters for top-up banner
    // Includes non-controller canisters since top-up is permissionless (CMC notify_top_up)
    // Also expands SNS root canisters to include all virtual sub-canisters
    const lowCyclesCanistersForBanner = React.useMemo(() => {
        const result = [];
        const checkedIds = new Set();
        const nmRed = neuronManagerCycleSettings?.cycleThresholdRed || 500_000_000_000;
        const nmOrange = neuronManagerCycleSettings?.cycleThresholdOrange || 2_000_000_000_000;
        const genRed = cycleSettings?.cycleThresholdRed || 500_000_000_000;
        const genOrange = cycleSettings?.cycleThresholdOrange || 2_000_000_000_000;

        // Helper to check and add a regular canister
        const checkRegularCanister = (canisterId, statusMap, label) => {
            if (checkedIds.has(canisterId)) return;
            checkedIds.add(canisterId);
            const status = statusMap[canisterId];
            if (!status) return;
            const cycles = status.cycles;
            if (cycles === null || cycles === undefined) return;
            // Check if it's a detected neuron manager
            const detectedManager = detectedNeuronManagers?.[canisterId];
            const critLevel = detectedManager ? nmRed : genRed;
            const healthLevel = detectedManager ? nmOrange : genOrange;
            if (cycles < critLevel) {
                result.push({
                    canisterId,
                    cycles,
                    criticalLevel: critLevel,
                    healthyLevel: healthLevel,
                    type: detectedManager ? 'neuron_manager' : 'canister',
                    label: detectedManager ? 'ICP Staking Bot' : label,
                    version: detectedManager?.version,
                    isController: status.isController === true,
                });
            }
        };

        // Neuron managers (must be controller for these - they are our bots)
        for (const m of neuronManagers) {
            const cid = typeof m.canisterId === 'string' ? m.canisterId : m.canisterId?.toText?.() || m.canisterId?.toString?.() || '';
            checkedIds.add(cid);
            if (!m.isController) continue;
            const cycles = m.cycles;
            if (cycles === null || cycles === undefined) continue;
            if (cycles < nmRed) {
                result.push({
                    canisterId: cid,
                    cycles,
                    criticalLevel: nmRed,
                    healthyLevel: nmOrange,
                    type: 'neuron_manager',
                    label: 'ICP Staking Bot',
                    version: m.version,
                    isController: true,
                });
            }
        }

        // Custom canister groups (all canisters, including virtual SNS sub-canisters)
        const collectGroupCanisters = (groups) => {
            const ids = [];
            for (const g of groups) {
                for (const cid of (g.canisters || [])) {
                    ids.push(cid);
                }
                if (g.subgroups) {
                    ids.push(...collectGroupCanisters(g.subgroups));
                }
            }
            return ids;
        };
        const allCustomIds = [
            ...collectGroupCanisters(canisterGroups.groups || []),
            ...(canisterGroups.ungrouped || []),
        ];
        for (const canisterId of allCustomIds) {
            checkRegularCanister(canisterId, canisterStatus, 'Custom');
            // If this is an SNS root, also check all its virtual sub-canisters
            const snsData = snsRootDataMap.get(canisterId);
            if (snsData) {
                for (const sc of snsData.systemCanisters) {
                    checkRegularCanister(sc.id, canisterStatus, `SNS (${sc.label})`);
                }
                for (const d of snsData.dappCanisters) {
                    checkRegularCanister(d, canisterStatus, 'SNS (Dapp)');
                }
                for (const a of snsData.archiveCanisters) {
                    checkRegularCanister(a, canisterStatus, 'SNS (Archive)');
                }
            }
        }

        // Tracked (wallet) canisters - include even if not controller
        for (const canisterId of trackedCanisters) {
            checkRegularCanister(canisterId, trackedCanisterStatus, 'Wallet');
        }

        return result;
    }, [neuronManagers, canisterGroups, canisterStatus, trackedCanisters, trackedCanisterStatus, detectedNeuronManagers, neuronManagerCycleSettings, cycleSettings, snsRootDataMap]);

    const styles = {
        pageContainer: {
            minHeight: '100vh',
            background: theme.colors.primaryGradient,
            color: theme.colors.primaryText,
        },
        container: {
            width: '100%',
            maxWidth: '900px',
            margin: '0 auto',
            padding: '1.5rem 1rem',
            boxSizing: 'border-box',
        },
        title: {
            fontSize: '28px',
            fontWeight: 600,
            marginBottom: '24px',
            color: theme.colors.primaryText,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
        },
        addSection: {
            background: theme.colors.secondaryBgGradient,
            borderRadius: '12px',
            padding: '1rem 1.25rem',
            marginBottom: '1.25rem',
            border: `1px solid ${theme.colors.border}`,
            boxShadow: theme.colors.secondaryBgShadow,
        },
        addSectionTitle: {
            fontSize: '0.9rem',
            fontWeight: 600,
            marginBottom: '0.75rem',
            color: theme.colors.secondaryText,
        },
        inputRow: {
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'center',
            flexWrap: 'wrap',
        },
        input: {
            flex: 1,
            padding: '0.65rem 1rem',
            borderRadius: '10px',
            border: `1px solid ${theme.colors.border}`,
            backgroundColor: theme.colors.tertiaryBg,
            color: theme.colors.primaryText,
            fontSize: '0.9rem',
            fontFamily: 'monospace',
            outline: 'none',
            transition: 'border-color 0.2s, box-shadow 0.2s',
        },
        addButton: {
            padding: '0.65rem 1.25rem',
            borderRadius: '10px',
            border: 'none',
            background: (addingCanister || !newCanisterId.trim()) ? theme.colors.mutedText : `linear-gradient(135deg, ${canisterPrimary}, ${canisterSecondary})`,
            color: '#fff',
            fontSize: '0.9rem',
            fontWeight: 600,
            cursor: (addingCanister || !newCanisterId.trim()) ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            transition: 'all 0.2s',
            opacity: (addingCanister || !newCanisterId.trim()) ? 0.5 : 1,
            boxShadow: (addingCanister || !newCanisterId.trim()) ? 'none' : `0 4px 12px ${canisterPrimary}40`,
        },
        canisterList: {
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
        },
        canisterCard: {
            background: theme.colors.secondaryBgGradient,
            borderRadius: '10px',
            padding: '0.75rem 1rem',
            border: `1px solid ${theme.colors.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            transition: 'all 0.2s',
            flexWrap: 'wrap',
            gap: '0.5rem',
            boxShadow: theme.colors.secondaryBgShadow,
        },
        canisterInfo: {
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            flex: '1 1 auto',
            minWidth: '200px',
            flexWrap: 'wrap',
        },
        canisterIcon: {
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            backgroundColor: `${canisterPrimary}20`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: canisterPrimary,
        },
        canisterId: {
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            color: theme.colors.primaryText,
            wordBreak: 'break-all',
        },
        canisterLink: {
            color: canisterPrimary,
            textDecoration: 'none',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
        },
        removeButton: {
            padding: '0.4rem 0.6rem',
            borderRadius: '6px',
            border: `1px solid ${theme.colors.border}`,
            backgroundColor: 'transparent',
            color: theme.colors.mutedText,
            fontSize: '0.8rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            transition: 'all 0.2s',
        },
        removeButtonHover: {
            borderColor: '#ef4444',
            color: '#ef4444',
        },
        emptyState: {
            textAlign: 'center',
            padding: '2.5rem 1.5rem',
            background: theme.colors.secondaryBgGradient,
            borderRadius: '12px',
            border: `1px solid ${theme.colors.border}`,
            boxShadow: theme.colors.secondaryBgShadow,
        },
        emptyIcon: {
            fontSize: '2.5rem',
            color: theme.colors.mutedText,
            marginBottom: '1rem',
            opacity: 0.5,
        },
        emptyText: {
            fontSize: '1rem',
            color: theme.colors.secondaryText,
            marginBottom: '0.5rem',
            fontWeight: '500',
        },
        emptySubtext: {
            fontSize: '0.85rem',
            color: theme.colors.mutedText,
            lineHeight: '1.5',
        },
        message: {
            padding: '0.75rem 1rem',
            borderRadius: '10px',
            marginBottom: '1rem',
            fontSize: '0.9rem',
        },
        errorMessage: {
            backgroundColor: '#ef444420',
            color: '#ef4444',
            border: '1px solid #ef444440',
        },
        successMessage: {
            backgroundColor: '#22c55e20',
            color: '#22c55e',
            border: '1px solid #22c55e40',
        },
        loadingSpinner: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '3rem',
            color: theme.colors.mutedText,
        },
        notLoggedIn: {
            textAlign: 'center',
            padding: '3rem 1.5rem',
            background: theme.colors.secondaryBgGradient,
            borderRadius: '16px',
            border: `1px solid ${theme.colors.border}`,
            boxShadow: theme.colors.secondaryBgShadow,
        },
        viewLink: {
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            backgroundColor: `${canisterPrimary}15`,
            color: canisterPrimary,
            textDecoration: 'none',
            fontSize: '0.8rem',
            fontWeight: 600,
        },
        sectionHeader: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1rem 0',
            cursor: 'pointer',
            borderBottom: `1px solid ${theme.colors.border}`,
            marginBottom: '1rem',
        },
        sectionTitle: {
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            fontSize: '1.1rem',
            fontWeight: 600,
            color: theme.colors.primaryText,
        },
        sectionCount: {
            fontSize: '0.8rem',
            fontWeight: 500,
            color: canisterPrimary,
            backgroundColor: `${canisterPrimary}15`,
            padding: '0.15rem 0.6rem',
            borderRadius: '12px',
        },
        sectionToggle: {
            color: theme.colors.mutedText,
            fontSize: '0.85rem',
        },
        managerCard: {
            background: theme.colors.secondaryBgGradient,
            borderRadius: '10px',
            padding: '0.75rem 1rem',
            border: `1px solid ${theme.colors.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            flexWrap: 'wrap',
            boxShadow: theme.colors.secondaryBgShadow,
        },
        managerInfo: {
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            flex: '1 1 auto',
            minWidth: '200px',
            flexWrap: 'wrap',
        },
        managerIcon: {
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            backgroundColor: '#9b59b620',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#9b59b6',
        },
        managerVersion: {
            fontSize: '0.7rem',
            color: theme.colors.secondaryText,
            backgroundColor: theme.colors.tertiaryBg,
            padding: '0.15rem 0.5rem',
            borderRadius: '8px',
        },
    };

    return (
        <div className="page-container" style={styles.pageContainer}>
            <style>{customStyles}</style>
            <Header />
            
            {/* DndProvider for react-dnd drag and drop */}
            <DndProvider backend={HTML5Backend}>
            
            {/* Hero Section */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${canisterPrimary}15 50%, ${canisterSecondary}10 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '2rem 1.5rem',
                position: 'relative',
                overflow: 'hidden'
            }}>
                {/* Background decorations */}
                <div style={{
                    position: 'absolute',
                    top: '-50%',
                    right: '-10%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${canisterPrimary}15 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-30%',
                    left: '5%',
                    width: '200px',
                    height: '200px',
                    background: `radial-gradient(circle, ${canisterSecondary}10 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                
                <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '1rem' }}>
                        <div className="canister-float" style={{
                            width: '56px',
                            height: '56px',
                            borderRadius: '16px',
                            background: `linear-gradient(135deg, ${canisterPrimary}, ${canisterSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 8px 24px ${canisterPrimary}40`
                        }}>
                            <FaCube size={28} color="#fff" />
                        </div>
                        <div>
                            <h1 style={{
                                fontSize: '1.75rem',
                                fontWeight: '700',
                                color: theme.colors.primaryText,
                                margin: 0,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem'
                            }}>
                                App Manager
                            </h1>
                            <p style={{
                                fontSize: '0.95rem',
                                color: theme.colors.secondaryText,
                                margin: '0.25rem 0 0 0'
                            }}>
                                Organize and monitor your Internet Computer apps
                            </p>
                        </div>
                    </div>
                    
                    {/* Quick Stats */}
                    <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                            <FaCube size={14} style={{ color: canisterPrimary }} />
                            <span><strong style={{ color: canisterPrimary }}>{getAllCanisterIds(canisterGroups).length}</strong> custom</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                            <FaWallet size={14} style={{ color: theme.colors.success }} />
                            <span><strong style={{ color: theme.colors.success }}>{trackedCanisters.length}</strong> wallet</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                            <FaBrain size={14} style={{ color: '#9b59b6' }} />
                            <span><strong style={{ color: '#9b59b6' }}>{neuronManagers.length}</strong> ICP staking bots</span>
                        </div>
                        <Link 
                            to="/help/dapp-manager" 
                            style={{ 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: '0.35rem',
                                color: theme.colors.accent, 
                                fontSize: '0.85rem', 
                                textDecoration: 'none',
                                marginLeft: 'auto'
                            }}
                        >
                            <FaQuestionCircle size={12} /> How it works
                        </Link>
                    </div>
                </div>
            </div>
            
            {/* Premium Upgrade Modal */}
            {showUpgradeModal && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    background: 'rgba(0, 0, 0, 0.75)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10001,
                    backdropFilter: 'blur(4px)',
                }}>
                    <div style={{
                        background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, ${theme.colors.primaryBg} 100%)`,
                        border: `2px solid #ffd700`,
                        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5), 0 0 40px rgba(255, 215, 0, 0.15)',
                        borderRadius: '20px',
                        padding: '32px',
                        width: '460px',
                        maxWidth: '90vw',
                        textAlign: 'center',
                    }}>
                        {/* Premium Icon */}
                        <div style={{
                            width: '72px',
                            height: '72px',
                            borderRadius: '50%',
                            background: 'linear-gradient(135deg, #ffd700 0%, #ffb300 100%)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 20px auto',
                            boxShadow: '0 8px 24px rgba(255, 215, 0, 0.4)',
                        }}>
                            <FaStar size={32} color="#000" />
                        </div>
                        
                        {/* Title */}
                        <h2 style={{
                            color: '#ffd700',
                            marginTop: '0',
                            marginBottom: '12px',
                            fontSize: '1.5rem',
                            fontWeight: '700',
                        }}>
                            Upgrade to Premium
                        </h2>
                        
                        {/* Message */}
                        <p style={{
                            color: theme.colors.secondaryText,
                            marginBottom: '16px',
                            lineHeight: '1.6',
                            fontSize: '0.95rem',
                        }}>
                            {upgradeModalMessage}
                        </p>
                        
                        {/* Benefits teaser */}
                        <div style={{
                            background: `${theme.colors.tertiaryBg}`,
                            borderRadius: '12px',
                            padding: '16px',
                            marginBottom: '24px',
                            textAlign: 'left',
                        }}>
                            <div style={{ color: '#ffd700', fontWeight: '600', marginBottom: '10px', fontSize: '0.9rem' }}>
                                ⭐ Premium members get:
                            </div>
                            <div style={{ color: theme.colors.secondaryText, fontSize: '0.85rem', lineHeight: '1.8' }}>
                                {groupLimits && (
                                    <>
                                        <div>• Up to <strong style={{ color: theme.colors.success }}>{groupLimits.premiumMaxGroups}</strong> folders (vs {groupLimits.maxGroups})</div>
                                        <div>• Up to <strong style={{ color: theme.colors.success }}>{groupLimits.premiumMaxPerGroup}</strong> apps per folder (vs {groupLimits.maxPerGroup})</div>
                                        <div>• Up to <strong style={{ color: theme.colors.success }}>{groupLimits.premiumMaxTotal}</strong> total apps (vs {groupLimits.maxTotal})</div>
                                    </>
                                )}
                            </div>
                        </div>
                        
                        {/* Buttons */}
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button 
                                onClick={() => setShowUpgradeModal(false)}
                                style={{
                                    flex: 1,
                                    background: 'transparent',
                                    color: theme.colors.secondaryText,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: '10px',
                                    padding: '14px 20px',
                                    cursor: 'pointer',
                                    fontSize: '0.95rem',
                                    fontWeight: '500',
                                    transition: 'all 0.2s ease',
                                }}
                                onMouseEnter={(e) => {
                                    e.target.style.borderColor = theme.colors.secondaryText;
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.borderColor = theme.colors.border;
                                }}
                            >
                                Maybe Later
                            </button>
                            <button 
                                onClick={() => {
                                    setShowUpgradeModal(false);
                                    navigate('/premium');
                                }}
                                style={{
                                    flex: 1,
                                    background: 'linear-gradient(135deg, #ffd700 0%, #ffb300 100%)',
                                    color: '#000',
                                    border: 'none',
                                    borderRadius: '10px',
                                    padding: '14px 20px',
                                    cursor: 'pointer',
                                    fontSize: '0.95rem',
                                    fontWeight: '700',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    transition: 'all 0.2s ease',
                                    boxShadow: '0 4px 16px rgba(255, 215, 0, 0.3)',
                                }}
                                onMouseEnter={(e) => {
                                    e.target.style.transform = 'translateY(-2px)';
                                    e.target.style.boxShadow = '0 6px 20px rgba(255, 215, 0, 0.4)';
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.transform = 'translateY(0)';
                                    e.target.style.boxShadow = '0 4px 16px rgba(255, 215, 0, 0.3)';
                                }}
                            >
                                View Premium <FaArrowRight size={14} />
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Drop Progress Dialog */}
            {dropInProgress && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    background: 'rgba(0, 0, 0, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10002,
                    backdropFilter: 'blur(2px)',
                }}>
                    <div style={{
                        background: theme.colors.secondaryBgGradient,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '16px',
                        padding: '24px 32px',
                        textAlign: 'center',
                        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
                        minWidth: '200px',
                    }}>
                        <FaSpinner 
                            className="spin" 
                            size={28} 
                            style={{ color: canisterPrimary, marginBottom: '12px' }} 
                        />
                        <div style={{ 
                            color: theme.colors.primaryText, 
                            fontWeight: 600,
                            fontSize: '0.95rem',
                            marginBottom: '4px'
                        }}>
                            Moving {dropInProgress.itemType === 'group' ? 'folder' : 'app'}...
                        </div>
                        <div style={{ 
                            color: theme.colors.mutedText, 
                            fontSize: '0.8rem' 
                        }}>
                            Please wait
                        </div>
                    </div>
                </div>
            )}
            
            <div style={styles.container}>
                {/* Cycle Status Legend */}
                <div className="canister-fade-in" style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '1rem',
                    padding: '0.75rem 1rem',
                    background: theme.colors.secondaryBgGradient,
                    borderRadius: '12px',
                    border: `1px solid ${theme.colors.border}`,
                    marginBottom: '1.25rem',
                    fontSize: '0.8rem',
                    boxShadow: theme.colors.secondaryBgShadow,
                }}>
                    <span style={{ color: theme.colors.mutedText, fontWeight: '600', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Cycle Status</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: '#22c55e',
                            boxShadow: '0 0 6px #22c55e',
                        }} />
                        <span style={{ color: theme.colors.secondaryText }}>Healthy</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: '#f59e0b',
                            boxShadow: '0 0 6px #f59e0b',
                        }} />
                        <span style={{ color: theme.colors.secondaryText }}>Low</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: '#ef4444',
                            boxShadow: '0 0 6px #ef4444',
                        }} />
                        <span style={{ color: theme.colors.secondaryText }}>Critical</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: '#6b7280',
                        }} />
                        <span style={{ color: theme.colors.secondaryText }}>Unknown</span>
                    </div>
                    <Link 
                        to="/me?tab=settings"
                        style={{ 
                            color: theme.colors.accent, 
                            fontSize: '0.75rem', 
                            textDecoration: 'none',
                            fontWeight: '500',
                        }}
                    >
                        Customize →
                    </Link>
                </div>

                {!isAuthenticated ? (
                    <div style={styles.notLoggedIn}>
                        <div style={styles.emptyIcon}>🔒</div>
                        <div style={styles.emptyText}>Please log in to track apps</div>
                        <div style={styles.emptySubtext}>
                            You can track any app canister on the Internet Computer to quickly access its details.
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Messages */}
                        {error && (
                            <div style={{ ...styles.message, ...styles.errorMessage }}>
                                {error}
                            </div>
                        )}
                        {successMessage && (
                            <div style={{ ...styles.message, ...styles.successMessage }}>
                                {successMessage}
                            </div>
                        )}

                        {/* Add app section */}
                        <div style={styles.addSection}>
                            <div style={styles.addSectionTitle}>Add an app to track</div>
                            <div style={styles.inputRow}>
                                <PrincipalInput
                                    value={newCanisterId}
                                    onChange={setNewCanisterId}
                                    placeholder="Enter app canister id (e.g., ryjl3-tyaaa-aaaaa-aaaba-cai)"
                                    onKeyDown={(e) => e.key === 'Enter' && handleAddCanister()}
                                    style={{ flex: 1, maxWidth: 'none' }}
                                    inputStyle={{ fontFamily: 'monospace' }}
                                    disabled={addingCanister}
                                    defaultPrincipalType="canisters"
                                />
                                <button
                                    onClick={() => handleAddCanister()}
                                    style={styles.addButton}
                                    disabled={addingCanister || !newCanisterId.trim()}
                                >
                                    {addingCanister ? (
                                        <FaSpinner className="spin" />
                                    ) : (
                                        <FaPlus />
                                    )}
                                    Add
                                </button>
                            </div>
                        </div>

                        {/* Outdated bots banner */}
                        {outdatedManagersForBanner.length > 0 && (
                            <div
                                onClick={() => setUpgradeDialogOpen(true)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    padding: '10px 14px',
                                    marginBottom: '12px',
                                    borderRadius: '10px',
                                    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(139, 92, 246, 0.05))',
                                    border: '1px solid rgba(139, 92, 246, 0.25)',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.5)';
                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.25)';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                }}
                            >
                                <FaExclamationTriangle size={14} style={{ color: '#f59e0b', flexShrink: 0 }} />
                                <span style={{ flex: 1, fontSize: '13px', color: theme.colors.primaryText }}>
                                    <strong>{outdatedManagersForBanner.length}</strong> bot{outdatedManagersForBanner.length !== 1 ? 's' : ''} can be upgraded to{' '}
                                    <span style={{ color: '#8b5cf6', fontWeight: '600' }}>
                                        v{Number(latestOfficialVersion.major)}.{Number(latestOfficialVersion.minor)}.{Number(latestOfficialVersion.patch)}
                                    </span>
                                </span>
                                <span style={{
                                    padding: '4px 12px',
                                    borderRadius: '6px',
                                    backgroundColor: '#8b5cf6',
                                    color: '#fff',
                                    fontSize: '12px',
                                    fontWeight: '600',
                                    flexShrink: 0,
                                }}>
                                    Upgrade
                                </span>
                            </div>
                        )}
                        {/* Low cycles banner */}
                        {lowCyclesCanistersForBanner.length > 0 && (
                            <div
                                onClick={() => setTopUpDialogOpen(true)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    padding: '10px 14px',
                                    marginBottom: '12px',
                                    borderRadius: '10px',
                                    background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(239, 68, 68, 0.05))',
                                    border: '1px solid rgba(239, 68, 68, 0.25)',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.5)';
                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.25)';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                }}
                            >
                                <FaBolt size={14} style={{ color: '#ef4444', flexShrink: 0 }} />
                                <span style={{ flex: 1, fontSize: '13px', color: theme.colors.primaryText }}>
                                    <strong>{lowCyclesCanistersForBanner.length}</strong> canister{lowCyclesCanistersForBanner.length !== 1 ? 's' : ''} low on cycles
                                </span>
                                <span style={{
                                    padding: '4px 12px',
                                    borderRadius: '6px',
                                    backgroundColor: '#ef4444',
                                    color: '#fff',
                                    fontSize: '12px',
                                    fontWeight: '600',
                                    flexShrink: 0,
                                }}>
                                    Top Up
                                </span>
                            </div>
                        )}

                        {/* Overall Status Summary */}
                        {(() => {
                            const groupsStats = getGroupsHealthStats(
                                canisterGroups.groups, 
                                canisterGroups.ungrouped, 
                                canisterStatus, 
                                cycleSettings,
                                detectedNeuronManagers,
                                neuronManagerCycleSettings
                            );
                            const walletCanisterStats = getWalletCanistersStatus(trackedCanisters, canisterStatus, cycleSettings, detectedNeuronManagers, neuronManagerCycleSettings);
                            const managerStats = getManagersHealthStats(neuronManagers, neuronManagerCycleSettings);
                            
                            // Calculate totals
                            const totalCanisters = groupsStats.total + walletCanisterStats.total + managerStats.total;
                            const totalRed = groupsStats.red + walletCanisterStats.red + managerStats.red;
                            const totalOrange = groupsStats.orange + walletCanisterStats.orange + managerStats.orange;
                            const totalGreen = groupsStats.green + walletCanisterStats.green + managerStats.green;
                            const totalUnknown = groupsStats.unknown + walletCanisterStats.unknown + managerStats.unknown;
                            const totalOutdated = (groupsStats.outdated || 0) + (managerStats.outdated || 0);
                            
                            if (totalCanisters === 0) return null;
                            
                            // Determine overall status
                            let overallStatus = 'unknown';
                            if (totalRed > 0) overallStatus = 'red';
                            else if (totalOrange > 0) overallStatus = 'orange';
                            else if (totalGreen > 0) overallStatus = 'green';
                            const overallColor = getStatusLampColor(overallStatus);
                            
                            return (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '14px 18px',
                                    backgroundColor: theme.colors.secondaryBg,
                                    borderRadius: '12px',
                                    border: `1px solid ${theme.colors.border}`,
                                    marginBottom: '20px',
                                    flexWrap: 'wrap',
                                    gap: '12px',
                                }}>
                                    {/* Overall status */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <span
                                            style={{
                                                width: '18px',
                                                height: '18px',
                                                borderRadius: '50%',
                                                backgroundColor: overallColor,
                                                boxShadow: overallStatus !== 'unknown' ? `0 0 12px ${overallColor}` : 'none',
                                                flexShrink: 0,
                                            }}
                                            title={`Overall health: ${overallStatus}`}
                                        />
                                        <span style={{ 
                                            fontWeight: 600, 
                                            color: theme.colors.primaryText,
                                            fontSize: '15px',
                                        }}>
                                            {totalCanisters} {totalCanisters === 1 ? 'App' : 'Apps'} Total
                                        </span>
                                    </div>
                                    
                                    {/* Status breakdown */}
                                    <div style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '18px',
                                        flexWrap: 'wrap',
                                    }}>
                                        {totalRed > 0 && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span style={{
                                                    width: '10px',
                                                    height: '10px',
                                                    borderRadius: '50%',
                                                    backgroundColor: '#ef4444',
                                                    boxShadow: '0 0 8px #ef4444',
                                                }} />
                                                <span style={{ color: '#ef4444', fontWeight: 500, fontSize: '14px' }}>
                                                    {totalRed} critical
                                                </span>
                                            </div>
                                        )}
                                        {totalOrange > 0 && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span style={{
                                                    width: '10px',
                                                    height: '10px',
                                                    borderRadius: '50%',
                                                    backgroundColor: '#f59e0b',
                                                    boxShadow: '0 0 8px #f59e0b',
                                                }} />
                                                <span style={{ color: '#f59e0b', fontWeight: 500, fontSize: '14px' }}>
                                                    {totalOrange} warning
                                                </span>
                                            </div>
                                        )}
                                        {totalGreen > 0 && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span style={{
                                                    width: '10px',
                                                    height: '10px',
                                                    borderRadius: '50%',
                                                    backgroundColor: '#22c55e',
                                                    boxShadow: '0 0 8px #22c55e',
                                                }} />
                                                <span style={{ color: '#22c55e', fontWeight: 500, fontSize: '14px' }}>
                                                    {totalGreen} healthy
                                                </span>
                                            </div>
                                        )}
                                        {totalUnknown > 0 && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span style={{
                                                    width: '10px',
                                                    height: '10px',
                                                    borderRadius: '50%',
                                                    backgroundColor: '#6b7280',
                                                }} />
                                                <span style={{ color: '#6b7280', fontWeight: 500, fontSize: '14px' }}>
                                                    {totalUnknown} unknown
                                                </span>
                                            </div>
                                        )}
                                        {totalOutdated > 0 && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span style={{
                                                    width: '10px',
                                                    height: '10px',
                                                    borderRadius: '50%',
                                                    backgroundColor: '#8b5cf6',
                                                }} />
                                                <span style={{ color: '#8b5cf6', fontWeight: 500, fontSize: '14px' }}>
                                                    {totalOutdated} outdated
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* Groups Section - Premium Feature */}
                        <div 
                            style={styles.sectionHeader}
                            onClick={() => setCustomExpanded(!customExpanded)}
                        >
                            <div style={styles.sectionTitle}>
                                {customExpanded ? <FaChevronDown /> : <FaChevronRight />}
                                {/* Groups health lamp */}
                                {(() => {
                                    const groupsStats = getGroupsHealthStats(
                                        canisterGroups.groups, 
                                        canisterGroups.ungrouped, 
                                        canisterStatus, 
                                        cycleSettings,
                                        detectedNeuronManagers,
                                        neuronManagerCycleSettings
                                    );
                                    const lampColor = getStatusLampColor(groupsStats.overallStatus);
                                    return groupsStats.total > 0 ? (
                                        <span
                                            style={{
                                                width: '10px',
                                                height: '10px',
                                                borderRadius: '50%',
                                                backgroundColor: lampColor,
                                                boxShadow: groupsStats.overallStatus !== 'unknown' ? `0 0 6px ${lampColor}` : 'none',
                                                flexShrink: 0,
                                            }}
                                            title={`Groups health: ${groupsStats.overallStatus}`}
                                        />
                                    ) : null;
                                })()}
                                <FaCube />
                                Groups
                                {getAllCanisterIds(canisterGroups).length > 0 && (
                                    <span style={styles.sectionCount}>{getAllCanisterIds(canisterGroups).length}</span>
                                )}
                                {saving && <FaSpinner className="spin" size={12} style={{ marginLeft: '8px', color: theme.colors.secondaryText }} />}
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }} onClick={(e) => e.stopPropagation()}>
                                {showNewGroupInput ? (
                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                        <input
                                            type="text"
                                            placeholder="Group name"
                                            value={newGroupName}
                                            onChange={(e) => setNewGroupName(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
                                            style={{ ...styles.input, padding: '6px 10px', fontSize: '12px', width: '150px' }}
                                            autoFocus
                                        />
                                        <button
                                            onClick={() => handleCreateGroup()}
                                            disabled={!newGroupName.trim()}
                                            style={{ 
                                                ...styles.addButton, 
                                                padding: '6px 10px', 
                                                fontSize: '12px',
                                                cursor: !newGroupName.trim() ? 'not-allowed' : 'pointer',
                                                backgroundColor: !newGroupName.trim() ? '#6c757d' : '#28a745',
                                                opacity: !newGroupName.trim() ? 0.6 : 1,
                                            }}
                                        >
                                            <FaCheck size={10} />
                                        </button>
                                        <button
                                            onClick={() => { setShowNewGroupInput(false); setNewGroupName(''); }}
                                            style={{ ...styles.removeButton, padding: '6px 10px' }}
                                        >
                                            <FaTimes size={10} />
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setShowNewGroupInput(true)}
                                        style={{
                                            padding: '6px 12px',
                                            borderRadius: '8px',
                                            border: `1px solid ${theme.colors.border}`,
                                            backgroundColor: 'transparent',
                                            color: theme.colors.secondaryText,
                                            fontSize: '12px',
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                        }}
                                    >
                                        <FaFolder size={10} /> New Group
                                    </button>
                                )}
                            </div>
                        </div>
                        
                        {customExpanded && (
                            <>
                                {/* Limits Info */}
                                {groupUsage && (
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '0.65rem 1rem',
                                        background: theme.colors.secondaryBgGradient,
                                        borderRadius: '10px',
                                        border: `1px solid ${theme.colors.border}`,
                                        marginBottom: '1rem',
                                        flexWrap: 'wrap',
                                        gap: '0.75rem',
                                        boxShadow: theme.colors.secondaryBgShadow,
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                            <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem' }}>
                                                Folders: <span style={{ 
                                                    color: groupUsage.groupCount >= groupUsage.groupLimit ? '#ef4444' : theme.colors.primaryText,
                                                    fontWeight: 600 
                                                }}>{groupUsage.groupCount}</span> / {groupUsage.groupLimit}
                                            </span>
                                            <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem' }}>
                                                Apps: <span style={{ 
                                                    color: groupUsage.totalCanisters >= groupUsage.totalLimit ? '#ef4444' : theme.colors.primaryText,
                                                    fontWeight: 600 
                                                }}>{groupUsage.totalCanisters}</span> / {groupUsage.totalLimit}
                                            </span>
                                            <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem' }}>
                                                Per Folder: max {groupUsage.perGroupLimit}
                                            </span>
                                        </div>
                                        {groupUsage.isPremium && (
                                            <span style={{
                                                background: 'linear-gradient(135deg, #ffd700 0%, #ffb300 100%)',
                                                color: '#000',
                                                padding: '0.2rem 0.6rem',
                                                borderRadius: '12px',
                                                fontSize: '0.65rem',
                                                fontWeight: 700,
                                            }}>
                                                ⭐ PREMIUM
                                            </span>
                                        )}
                                    </div>
                                )}
                                
                                {loading ? (
                                    <div style={styles.loadingSpinner}>
                                        <FaSpinner className="spin" size={24} />
                                    </div>
                                ) : getAllCanisterIds(canisterGroups).length === 0 && canisterGroups.groups.length === 0 ? (
                                    <div style={{ ...styles.emptyState, marginBottom: '24px' }}>
                                        <div style={styles.emptyIcon}>📦</div>
                                        <div style={styles.emptyText}>No groups or apps being tracked</div>
                                        <div style={styles.emptySubtext}>
                                            Add an app canister id above to start tracking it, or create a group to organize your apps.
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ marginBottom: '24px' }}>
                                        {/* Health Summary */}
                                        {(() => {
                                            const stats = getOverallHealthStats(canisterGroups, canisterStatus, cycleSettings);
                                            const overallColor = getStatusLampColor(stats.overallStatus);
                                            
                                            return (
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    padding: '0.875rem 1.25rem',
                                                    background: theme.colors.secondaryBgGradient,
                                                    borderRadius: '12px',
                                                    border: `1px solid ${theme.colors.border}`,
                                                    marginBottom: '1rem',
                                                    flexWrap: 'wrap',
                                                    gap: '0.75rem',
                                                    boxShadow: theme.colors.secondaryBgShadow,
                                                }}>
                                                    {/* Overall status lamp */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                        <div style={{
                                                            width: '36px',
                                                            height: '36px',
                                                            borderRadius: '10px',
                                                            background: `${overallColor}20`,
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                        }}>
                                                            <span
                                                                style={{
                                                                    width: '14px',
                                                                    height: '14px',
                                                                    borderRadius: '50%',
                                                                    backgroundColor: overallColor,
                                                                    boxShadow: stats.overallStatus !== 'unknown' ? `0 0 10px ${overallColor}` : 'none',
                                                                }}
                                                                title={`Overall health: ${stats.overallStatus}`}
                                                            />
                                                        </div>
                                                        <span style={{ 
                                                            fontWeight: 600, 
                                                            color: theme.colors.primaryText,
                                                            fontSize: '0.95rem',
                                                        }}>
                                                            {stats.total} {stats.total === 1 ? 'App' : 'Apps'}
                                                        </span>
                                                    </div>
                                                    
                                                    {/* Status breakdown */}
                                                    <div style={{ 
                                                        display: 'flex', 
                                                        alignItems: 'center', 
                                                        gap: '1rem',
                                                        flexWrap: 'wrap',
                                                    }}>
                                                        {stats.red > 0 && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                                <span style={{
                                                                    width: '8px',
                                                                    height: '8px',
                                                                    borderRadius: '50%',
                                                                    backgroundColor: '#ef4444',
                                                                    boxShadow: '0 0 6px #ef4444',
                                                                }} />
                                                                <span style={{ color: '#ef4444', fontWeight: 500, fontSize: '0.8rem' }}>
                                                                    {stats.red} critical
                                                                </span>
                                                            </div>
                                                        )}
                                                        {stats.orange > 0 && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                                <span style={{
                                                                    width: '8px',
                                                                    height: '8px',
                                                                    borderRadius: '50%',
                                                                    backgroundColor: '#f59e0b',
                                                                    boxShadow: '0 0 6px #f59e0b',
                                                                }} />
                                                                <span style={{ color: '#f59e0b', fontWeight: 500, fontSize: '0.8rem' }}>
                                                                    {stats.orange} warning
                                                                </span>
                                                            </div>
                                                        )}
                                                        {stats.green > 0 && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                                <span style={{
                                                                    width: '8px',
                                                                    height: '8px',
                                                                    borderRadius: '50%',
                                                                    backgroundColor: '#22c55e',
                                                                    boxShadow: '0 0 6px #22c55e',
                                                                }} />
                                                                <span style={{ color: '#22c55e', fontWeight: 500, fontSize: '0.8rem' }}>
                                                                    {stats.green} healthy
                                                                </span>
                                                            </div>
                                                        )}
                                                        {stats.unknown > 0 && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                                <span style={{
                                                                    width: '8px',
                                                                    height: '8px',
                                                                    borderRadius: '50%',
                                                                    backgroundColor: '#6b7280',
                                                                }} />
                                                                <span style={{ color: '#6b7280', fontWeight: 500, fontSize: '0.8rem' }}>
                                                                    {stats.unknown} unknown
                                                                </span>
                                                            </div>
                                                        )}
                                                        
                                                        {/* Expand/Collapse All buttons */}
                                                        {canisterGroups.groups.length > 0 && (
                                                            <div style={{ 
                                                                display: 'flex', 
                                                                alignItems: 'center', 
                                                                gap: '0.5rem',
                                                                marginLeft: '0.5rem',
                                                                paddingLeft: '1rem',
                                                                borderLeft: `1px solid ${theme.colors.border}`,
                                                            }}>
                                                                <button
                                                                    onClick={handleExpandAll}
                                                                    style={{
                                                                        padding: '0.3rem 0.6rem',
                                                                        borderRadius: '6px',
                                                                        border: `1px solid ${theme.colors.border}`,
                                                                        backgroundColor: 'transparent',
                                                                        color: theme.colors.secondaryText,
                                                                        fontSize: '0.7rem',
                                                                        cursor: 'pointer',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '0.25rem',
                                                                        transition: 'all 0.2s'
                                                                    }}
                                                                    title="Expand all groups"
                                                                >
                                                                    <FaChevronDown size={9} /> Expand
                                                                </button>
                                                                <button
                                                                    onClick={handleCollapseAll}
                                                                    style={{
                                                                        padding: '0.3rem 0.6rem',
                                                                        borderRadius: '6px',
                                                                        border: `1px solid ${theme.colors.border}`,
                                                                        backgroundColor: 'transparent',
                                                                        color: theme.colors.secondaryText,
                                                                        fontSize: '0.7rem',
                                                                        cursor: 'pointer',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '0.25rem',
                                                                        transition: 'all 0.2s'
                                                                    }}
                                                                    title="Collapse all groups"
                                                                >
                                                                    <FaChevronRight size={9} /> Collapse
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                        
                                        {/* Render Groups */}
                                        {canisterGroups.groups.map((group) => (
                                            <GroupComponent
                                                key={group.id}
                                                group={group}
                                                depth={0}
                                                styles={styles}
                                                theme={theme}
                                                expandedGroups={expandedGroups}
                                                setExpandedGroups={setExpandedGroups}
                                                editingGroup={editingGroup}
                                                setEditingGroup={setEditingGroup}
                                                editingGroupName={editingGroupName}
                                                setEditingGroupName={setEditingGroupName}
                                                handleRenameGroup={handleRenameGroup}
                                                handleDeleteGroup={handleDeleteGroup}
                                                canisterStatus={canisterStatus}
                                                cycleSettings={cycleSettings}
                                                principalNames={principalNames}
                                                principalNicknames={principalNicknames}
                                                isAuthenticated={isAuthenticated}
                                                confirmRemoveCanister={confirmRemoveCanister}
                                                setConfirmRemoveCanister={setConfirmRemoveCanister}
                                                handleRemoveCanister={handleRemoveCanister}
                                                canisterGroups={canisterGroups}
                                                handleMoveCanister={handleMoveCanister}
                                                handleMoveFromGroups={handleMoveFromGroups}
                                                newSubgroupParent={newSubgroupParent}
                                                setNewSubgroupParent={setNewSubgroupParent}
                                                newSubgroupName={newSubgroupName}
                                                setNewSubgroupName={setNewSubgroupName}
                                                handleCreateSubgroup={handleCreateSubgroup}
                                                addingCanisterToGroupId={addingCanisterToGroupId}
                                                setAddingCanisterToGroupId={setAddingCanisterToGroupId}
                                                newCanisterForGroup={newCanisterForGroup}
                                                setNewCanisterForGroup={setNewCanisterForGroup}
                                                handleAddCanisterToGroup={handleAddCanisterToGroup}
                                                getGroupHealthStatus={getGroupHealthStatus}
                                                getStatusLampColor={getStatusLampColor}
                                                onDndDrop={handleDndDrop}
                                                canDropItem={canDropItem}
                                                detectedNeuronManagers={detectedNeuronManagers}
                                                neuronManagerCycleSettings={neuronManagerCycleSettings}
                                                latestOfficialVersion={latestOfficialVersion}
                                                isVersionOutdated={isVersionOutdated}
                                                getManagerHealthStatus={getManagerHealthStatus}
                                            />
                                        ))}
                                        
                                        {/* Ungrouped Section - Drop Zone */}
                                        <DroppableSection
                                            targetType="ungrouped"
                                            onDrop={handleDndDrop}
                                            canDropItem={canDropItem}
                                        >
                                            {({ isOver }) => (
                                                <div 
                                                    style={{ 
                                                        marginTop: canisterGroups.groups.length > 0 ? '16px' : '0',
                                                        padding: '8px',
                                                        backgroundColor: isOver ? `${theme.colors.accent}15` : 'transparent',
                                                        border: isOver ? `2px dashed ${theme.colors.accent}` : '2px dashed transparent',
                                                        borderRadius: '8px',
                                                        transition: 'all 0.2s ease',
                                                        minHeight: canisterGroups.ungrouped.length === 0 ? '60px' : 'auto',
                                                    }}
                                                >
                                                    <div style={{ 
                                                        fontSize: '12px', 
                                                        color: theme.colors.mutedText, 
                                                        marginBottom: '8px',
                                                        fontWeight: 500,
                                                    }}>
                                                        Ungrouped ({canisterGroups.ungrouped.length})
                                                        {isOver && (
                                                            <span style={{ marginLeft: '8px', color: theme.colors.accent }}>
                                                                Drop here
                                                            </span>
                                                        )}
                                                    </div>
                                                    {canisterGroups.ungrouped.length > 0 && (
                                                        <div style={styles.canisterList}>
                                                            {canisterGroups.ungrouped.map((canisterId) => {
                                                                // Check if this canister is an SNS Root - show as special folder
                                                                const ungroupedSnsData = snsRootDataMap.get(canisterId);
                                                                if (ungroupedSnsData) {
                                                                    return (
                                                                        <SnsRootFolder
                                                                            key={canisterId}
                                                                            canisterId={canisterId}
                                                                            groupId="ungrouped"
                                                                            snsData={ungroupedSnsData}
                                                                            styles={styles}
                                                                            theme={theme}
                                                                            canisterStatus={canisterStatus}
                                                                            cycleSettings={cycleSettings}
                                                                        />
                                                                    );
                                                                }
                                                                // Check if this canister is a detected neuron manager
                                                                const detectedManager = detectedNeuronManagers[canisterId];
                                                                if (detectedManager) {
                                                                    return (
                                                                        <NeuronManagerCardItem
                                                                            key={canisterId}
                                                                            canisterId={canisterId}
                                                                            sourceGroupId="ungrouped"
                                                                            managerInfo={detectedManager}
                                                                            styles={styles}
                                                                            theme={theme}
                                                                            principalNames={principalNames}
                                                                            principalNicknames={principalNicknames}
                                                                            isAuthenticated={isAuthenticated}
                                                                            neuronManagerCycleSettings={neuronManagerCycleSettings}
                                                                            latestOfficialVersion={latestOfficialVersion}
                                                                            isVersionOutdated={isVersionOutdated}
                                                                            getManagerHealthStatus={getManagerHealthStatus}
                                                                            getStatusLampColor={getStatusLampColor}
                                                                            onRemove={(id) => handleRemoveCanister(id, 'ungrouped')}
                                                                            isConfirming={confirmRemoveCanister?.canisterId === canisterId && confirmRemoveCanister?.groupId === 'ungrouped'}
                                                                            setConfirmRemove={(id) => setConfirmRemoveCanister(id ? { canisterId: id, groupId: 'ungrouped' } : null)}
                                                                            isRemoving={false}
                                                                        />
                                                                    );
                                                                }
                                                                return (
                                                                    <CanisterCard
                                                                        key={canisterId}
                                                                        canisterId={canisterId}
                                                                        groupId="ungrouped"
                                                                        styles={styles}
                                                                        theme={theme}
                                                                        canisterStatus={canisterStatus}
                                                                        cycleSettings={cycleSettings}
                                                                        principalNames={principalNames}
                                                                        principalNicknames={principalNicknames}
                                                                        isAuthenticated={isAuthenticated}
                                                                        confirmRemoveCanister={confirmRemoveCanister}
                                                                        setConfirmRemoveCanister={setConfirmRemoveCanister}
                                                                        handleRemoveCanister={handleRemoveCanister}
                                                                    />
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </DroppableSection>
                                    </div>
                                )}
                            </>
                        )}

                        {/* Wallet Section - Contains Canisters and Neuron Managers */}
                        <div 
                            style={styles.sectionHeader}
                            onClick={() => setWalletExpanded(!walletExpanded)}
                        >
                            <div style={styles.sectionTitle}>
                                {walletExpanded ? <FaChevronDown /> : <FaChevronRight />}
                                {/* Wallet health lamp - combines canisters and managers */}
                                {(() => {
                                    const canisterStats = getWalletCanistersStatus(trackedCanisters, canisterStatus, cycleSettings, detectedNeuronManagers, neuronManagerCycleSettings);
                                    const managerStats = getManagersHealthStats(neuronManagers, neuronManagerCycleSettings);
                                    // Combine stats
                                    const totalCount = canisterStats.total + managerStats.total;
                                    if (totalCount === 0) return null;
                                    // Determine overall status (worst wins)
                                    let overallStatus = 'unknown';
                                    if (canisterStats.red > 0 || managerStats.red > 0) overallStatus = 'red';
                                    else if (canisterStats.orange > 0 || managerStats.orange > 0) overallStatus = 'orange';
                                    else if (canisterStats.green > 0 || managerStats.green > 0) overallStatus = 'green';
                                    const lampColor = getStatusLampColor(overallStatus);
                                    return (
                                        <span
                                            style={{
                                                width: '10px',
                                                height: '10px',
                                                borderRadius: '50%',
                                                backgroundColor: lampColor,
                                                boxShadow: overallStatus !== 'unknown' ? `0 0 6px ${lampColor}` : 'none',
                                                flexShrink: 0,
                                            }}
                                            title={`Wallet health: ${overallStatus}`}
                                        />
                                    );
                                })()}
                                <FaWallet size={18} style={{ color: theme.colors.secondaryText }} />
                                Wallet
                                {(trackedCanisters.length + neuronManagers.length) > 0 && (
                                    <span style={styles.sectionCount}>{trackedCanisters.length + neuronManagers.length}</span>
                                )}
                            </div>
                            <Link 
                                to="/wallet"
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                    padding: '6px 12px',
                                    borderRadius: '8px',
                                    border: `1px solid ${theme.colors.border}`,
                                    backgroundColor: 'transparent',
                                    color: theme.colors.secondaryText,
                                    fontSize: '12px',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    textDecoration: 'none',
                                }}
                            >
                                Open Wallet
                            </Link>
                        </div>
                        
                        {walletExpanded && (
                            <>
                                {/* Canisters Subsection - Drop Zone */}
                                <DroppableSection
                                    targetType="wallet"
                                    onDrop={handleDndDrop}
                                    canDropItem={canDropItem}
                                >
                                    {({ isOver: isWalletDropTarget }) => (
                                <div
                                    style={{
                                        backgroundColor: isWalletDropTarget ? `${theme.colors.accent}10` : theme.colors.secondaryBg,
                                        border: isWalletDropTarget ? `2px dashed ${theme.colors.accent}` : `1px solid ${theme.colors.border}`,
                                        borderRadius: '12px',
                                        transition: 'all 0.2s ease',
                                        padding: '12px',
                                        marginBottom: '12px',
                                    }}
                                >
                                <div 
                                    style={{ 
                                        display: 'flex', 
                                        justifyContent: 'space-between', 
                                        alignItems: 'center',
                                        cursor: 'pointer',
                                        marginBottom: walletCanistersExpanded ? '12px' : 0
                                    }}
                                    onClick={() => setWalletCanistersExpanded(!walletCanistersExpanded)}
                                >
                                    <div style={{ ...styles.sectionTitle, fontSize: '14px' }}>
                                        {walletCanistersExpanded ? <FaChevronDown size={12} /> : <FaChevronRight size={12} />}
                                        {/* Apps health lamp */}
                                        {(() => {
                                            const stats = getWalletCanistersStatus(trackedCanisters, canisterStatus, cycleSettings, detectedNeuronManagers, neuronManagerCycleSettings);
                                            if (stats.total === 0) return null;
                                            const lampColor = getStatusLampColor(stats.overallStatus);
                                            return (
                                                <span
                                                    style={{
                                                        width: '8px',
                                                        height: '8px',
                                                        borderRadius: '50%',
                                                        backgroundColor: lampColor,
                                                        boxShadow: stats.overallStatus !== 'unknown' ? `0 0 6px ${lampColor}` : 'none',
                                                        flexShrink: 0,
                                                    }}
                                                    title={`Apps health: ${stats.overallStatus}`}
                                                />
                                            );
                                        })()}
                                        <FaBox style={{ color: theme.colors.accent }} />
                                        Apps
                                        {trackedCanisters.length > 0 && (
                                            <span style={{ ...styles.sectionCount, fontSize: '11px' }}>{trackedCanisters.length}</span>
                                        )}
                                        {isWalletDropTarget && (
                                            <span style={{ marginLeft: '8px', color: theme.colors.accent, fontSize: '11px' }}>
                                                Drop here to add
                                            </span>
                                        )}
                                    </div>
                                </div>
                        
                                {walletCanistersExpanded && (
                            <>
                                {/* Add app input */}
                                <div style={{ ...styles.addSection, marginBottom: '16px' }}>
                                    <div style={styles.addSectionTitle}>Add app to wallet</div>
                                    <div style={styles.inputRow}>
                                        <PrincipalInput
                                            value={newWalletCanisterId}
                                            onChange={(v) => {
                                                setNewWalletCanisterId(v);
                                                setWalletCanisterError(null);
                                            }}
                                            placeholder="Enter app canister id"
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && newWalletCanisterId.trim()) {
                                                    handleAddWalletCanister();
                                                }
                                            }}
                                            style={{ flex: 1, maxWidth: 'none' }}
                                            inputStyle={{ fontFamily: 'monospace' }}
                                            disabled={addingWalletCanister}
                                            defaultPrincipalType="canisters"
                                        />
                                        <button
                                            onClick={handleAddWalletCanister}
                                            style={{
                                                ...styles.addButton,
                                                backgroundColor: (addingWalletCanister || !newWalletCanisterId.trim()) ? '#6c757d' : '#28a745',
                                                cursor: (addingWalletCanister || !newWalletCanisterId.trim()) ? 'not-allowed' : 'pointer',
                                                opacity: (addingWalletCanister || !newWalletCanisterId.trim()) ? 0.6 : 1,
                                            }}
                                            disabled={addingWalletCanister || !newWalletCanisterId.trim()}
                                        >
                                            {addingWalletCanister ? (
                                                <FaSpinner className="spin" />
                                            ) : (
                                                <FaPlus />
                                            )}
                                            Add
                                        </button>
                                    </div>
                                    {walletCanisterError && (
                                        <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '8px' }}>
                                            {walletCanisterError}
                                        </div>
                                    )}
                                </div>

                                {loadingTrackedCanisters ? (
                                    <div style={styles.loadingSpinner}>
                                        <FaSpinner className="spin" size={24} />
                                    </div>
                                ) : trackedCanisters.length === 0 ? (
                                    <div style={{ ...styles.emptyState, marginBottom: '24px' }}>
                                        <div style={styles.emptyIcon}>💼</div>
                                        <div style={styles.emptyText}>No apps in wallet</div>
                                        <div style={styles.emptySubtext}>
                                            Add an app canister id above to track it in your wallet.
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ marginBottom: '24px' }}>
                                        {/* Wallet Health Summary */}
                                        {(() => {
                                            const walletStats = getWalletHealthStats(trackedCanisters, trackedCanisterStatus, cycleSettings);
                                            const walletOverallColor = getStatusLampColor(walletStats.overallStatus);
                                            
                                            return (
                                                <div style={{
                                                    padding: '12px 16px',
                                                    backgroundColor: theme.colors.secondaryBg,
                                                    borderRadius: '10px',
                                                    border: `1px solid ${theme.colors.border}`,
                                                    marginBottom: '16px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    flexWrap: 'wrap',
                                                    gap: '12px',
                                                }}>
                                                    {/* Overall status lamp */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <span
                                                            style={{
                                                                width: '14px',
                                                                height: '14px',
                                                                borderRadius: '50%',
                                                                backgroundColor: walletOverallColor,
                                                                boxShadow: walletStats.overallStatus !== 'unknown' ? `0 0 10px ${walletOverallColor}` : 'none',
                                                                flexShrink: 0,
                                                            }}
                                                            title={`Overall health: ${walletStats.overallStatus}`}
                                                        />
                                                        <span style={{ 
                                                            fontWeight: 600, 
                                                            fontSize: '13px',
                                                            color: theme.colors.primaryText,
                                                        }}>
                                                            Wallet Health
                                                        </span>
                                                    </div>
                                                    
                                                    {/* Status breakdown */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginLeft: 'auto' }}>
                                                        {walletStats.red > 0 && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <span style={{
                                                                    width: '8px',
                                                                    height: '8px',
                                                                    borderRadius: '50%',
                                                                    backgroundColor: '#ef4444',
                                                                    boxShadow: '0 0 6px #ef4444',
                                                                }} />
                                                                <span style={{ color: '#ef4444', fontWeight: 500, fontSize: '13px' }}>
                                                                    {walletStats.red} critical
                                                                </span>
                                                            </div>
                                                        )}
                                                        {walletStats.orange > 0 && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <span style={{
                                                                    width: '8px',
                                                                    height: '8px',
                                                                    borderRadius: '50%',
                                                                    backgroundColor: '#f59e0b',
                                                                    boxShadow: '0 0 6px #f59e0b',
                                                                }} />
                                                                <span style={{ color: '#f59e0b', fontWeight: 500, fontSize: '13px' }}>
                                                                    {walletStats.orange} low
                                                                </span>
                                                            </div>
                                                        )}
                                                        {walletStats.green > 0 && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <span style={{
                                                                    width: '8px',
                                                                    height: '8px',
                                                                    borderRadius: '50%',
                                                                    backgroundColor: '#22c55e',
                                                                    boxShadow: '0 0 6px #22c55e',
                                                                }} />
                                                                <span style={{ color: '#22c55e', fontWeight: 500, fontSize: '13px' }}>
                                                                    {walletStats.green} healthy
                                                                </span>
                                                            </div>
                                                        )}
                                                        {walletStats.unknown > 0 && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <span style={{
                                                                    width: '8px',
                                                                    height: '8px',
                                                                    borderRadius: '50%',
                                                                    backgroundColor: '#6b7280',
                                                                }} />
                                                                <span style={{ color: '#6b7280', fontWeight: 500, fontSize: '13px' }}>
                                                                    {walletStats.unknown} unknown
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                        
                                        <div style={styles.canisterList}>
                                            {trackedCanisters.map((canisterId) => {
                                                const displayInfo = getPrincipalDisplayInfoFromContext(canisterId, principalNames, principalNicknames, verifiedNames, principalCanisterTypes);
                                                const status = trackedCanisterStatus[canisterId];
                                                const cycles = status?.cycles;
                                                const memory = status?.memory;
                                                const isController = status?.isController;
                                                const isConfirming = confirmRemoveWalletCanister === canisterId;
                                                const isRemoving = removingWalletCanister === canisterId;
                                                
                                                // Check if this canister is a detected neuron manager
                                                const detectedManager = detectedNeuronManagers[canisterId];
                                                if (detectedManager) {
                                                    return (
                                                        <NeuronManagerCardItem
                                                            key={canisterId}
                                                            canisterId={canisterId}
                                                            sourceGroupId="wallet"
                                                            managerInfo={detectedManager}
                                                            styles={styles}
                                                            theme={theme}
                                                            principalNames={principalNames}
                                                            principalNicknames={principalNicknames}
                                                            isAuthenticated={isAuthenticated}
                                                            neuronManagerCycleSettings={neuronManagerCycleSettings}
                                                            latestOfficialVersion={latestOfficialVersion}
                                                            isVersionOutdated={isVersionOutdated}
                                                            getManagerHealthStatus={getManagerHealthStatus}
                                                            getStatusLampColor={getStatusLampColor}
                                                            onRemove={handleRemoveWalletCanister}
                                                            isConfirming={isConfirming}
                                                            setConfirmRemove={setConfirmRemoveWalletCanister}
                                                            isRemoving={isRemoving}
                                                        />
                                                    );
                                                }
                                                
                                                // Get health status for this canister
                                                const canisterHealth = getCanisterHealthStatus(canisterId, trackedCanisterStatus, cycleSettings);
                                                const canisterLampColor = getStatusLampColor(canisterHealth);

                                                return (
                                                    <DraggableItem
                                                        key={canisterId}
                                                        type="canister"
                                                        id={canisterId}
                                                        sourceGroupId="wallet"
                                                        style={{
                                                            ...styles.canisterCard,
                                                            transition: 'opacity 0.15s ease',
                                                        }}
                                                    >
                                                        <div style={styles.canisterInfo}>
                                                            <div style={{ ...styles.canisterIcon, position: 'relative' }}>
                                                                {getCanisterTypeIcon(displayInfo?.canisterTypes, 18, theme.colors.accent)}
                                                                {isController && (
                                                                    <FaCrown 
                                                                        size={10} 
                                                                        style={{ 
                                                                            position: 'absolute', 
                                                                            top: -4, 
                                                                            right: -4, 
                                                                            color: '#f59e0b',
                                                                        }} 
                                                                        title="You are a controller"
                                                                    />
                                                                )}
                                                                {/* Cycle status lamp - top left */}
                                                                <span
                                                                    style={{
                                                                        position: 'absolute',
                                                                        top: -3,
                                                                        left: -3,
                                                                        width: '8px',
                                                                        height: '8px',
                                                                        borderRadius: '50%',
                                                                        backgroundColor: canisterLampColor,
                                                                        boxShadow: canisterHealth !== 'unknown' ? `0 0 6px ${canisterLampColor}` : 'none',
                                                                        zIndex: 2,
                                                                    }}
                                                                    title={`Health: ${canisterHealth}`}
                                                                />
                                                                {isSnsCanisterType(displayInfo?.canisterTypes) && <SnsPill size="small" />}
                                                            </div>
                                                            <PrincipalDisplay
                                                                principal={canisterId}
                                                                displayInfo={displayInfo}
                                                                showCopyButton={true}
                                                                isAuthenticated={isAuthenticated}
                                                                noLink={true}
                                                                style={{ fontSize: '14px' }}
                                                                showSendMessage={false}
                                                                showViewProfile={false}
                                                            />
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginLeft: 'auto' }}>
                                                            {/* Cycles badge */}
                                                            {cycles !== undefined && cycles !== null && (
                                                                <span 
                                                                    style={{
                                                                        ...styles.managerVersion,
                                                                        backgroundColor: `${getCyclesColor(cycles, neuronManagerCycleSettings)}20`,
                                                                        color: getCyclesColor(cycles, neuronManagerCycleSettings),
                                                                    }}
                                                                    title={`${cycles.toLocaleString()} cycles`}
                                                                >
                                                                    ⚡ {formatCyclesCompact(cycles)}
                                                                </span>
                                                            )}
                                                            {/* Memory badge */}
                                                            {memory !== undefined && memory !== null && (
                                                                <span 
                                                                    style={{
                                                                        ...styles.managerVersion,
                                                                        backgroundColor: `${theme.colors.accent}20`,
                                                                        color: theme.colors.accent,
                                                                    }}
                                                                    title={`${memory.toLocaleString()} bytes`}
                                                                >
                                                                    💾 {formatMemory(memory)}
                                                                </span>
                                                            )}
                                                            {status === undefined && (
                                                                <span 
                                                                    style={{
                                                                        ...styles.managerVersion,
                                                                        backgroundColor: `${theme.colors.mutedText || theme.colors.secondaryText}20`,
                                                                        color: theme.colors.mutedText || theme.colors.secondaryText,
                                                                    }}
                                                                >
                                                                    ⚡ ...
                                                                </span>
                                                            )}
                                                            <Link
                                                                to={`/canister?id=${canisterId}`}
                                                                style={{
                                                                    ...styles.viewLink,
                                                                    padding: '6px 8px',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                }}
                                                                title="View details"
                                                            >
                                                                <FaEdit size={12} />
                                                            </Link>
                                                            {isConfirming ? (
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                    <span style={{ color: '#888', fontSize: '11px' }}>Remove?</span>
                                                                    <button
                                                                        onClick={() => handleRemoveWalletCanister(canisterId)}
                                                                        disabled={isRemoving}
                                                                        style={{
                                                                            backgroundColor: '#ef4444',
                                                                            color: '#fff',
                                                                            border: 'none',
                                                                            borderRadius: '4px',
                                                                            padding: '4px 10px',
                                                                            cursor: isRemoving ? 'not-allowed' : 'pointer',
                                                                            fontSize: '12px',
                                                                            opacity: isRemoving ? 0.6 : 1,
                                                                        }}
                                                                    >
                                                                        {isRemoving ? <FaSpinner className="spin" size={10} /> : 'Yes'}
                                                                    </button>
                                                                    <button
                                                                        onClick={() => setConfirmRemoveWalletCanister(null)}
                                                                        style={{
                                                                            backgroundColor: theme.colors.secondaryBg,
                                                                            color: theme.colors.primaryText,
                                                                            border: `1px solid ${theme.colors.border}`,
                                                                            borderRadius: '4px',
                                                                            padding: '4px 10px',
                                                                            cursor: 'pointer',
                                                                            fontSize: '12px',
                                                                        }}
                                                                    >
                                                                        No
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <button
                                                                    onClick={() => setConfirmRemoveWalletCanister(canisterId)}
                                                                    style={styles.removeButton}
                                                                    title="Remove from wallet"
                                                                >
                                                                    <FaTrash />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </DraggableItem>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </>
                                )}
                                </div>
                                    )}
                                </DroppableSection>

                                {/* ICP Staking Bots Subsection - Drop Zone */}
                                <DroppableSection
                                    targetType="neuron_managers"
                                    onDrop={handleDndDrop}
                                    canDropItem={canDropItem}
                                >
                                    {({ isOver: isNeuronManagersDropTarget }) => (
                                <div
                                    style={{
                                        backgroundColor: isNeuronManagersDropTarget ? `${theme.colors.accent}10` : theme.colors.secondaryBg,
                                        border: isNeuronManagersDropTarget ? `2px dashed ${theme.colors.accent}` : `1px solid ${theme.colors.border}`,
                                        borderRadius: '12px',
                                        transition: 'all 0.2s ease',
                                        padding: '12px',
                                        marginBottom: '12px',
                                    }}
                                >
                                <div 
                                    style={{ 
                                        display: 'flex', 
                                        justifyContent: 'space-between', 
                                        alignItems: 'center',
                                        cursor: 'pointer',
                                        marginBottom: neuronManagersExpanded ? '12px' : 0
                                    }}
                                    onClick={() => setNeuronManagersExpanded(!neuronManagersExpanded)}
                                >
                                    <div style={{ ...styles.sectionTitle, fontSize: '14px' }}>
                                        {neuronManagersExpanded ? <FaChevronDown size={12} /> : <FaChevronRight size={12} />}
                                        {/* Staking Bots health lamp */}
                                        {(() => {
                                            const stats = getManagersHealthStats(neuronManagers, neuronManagerCycleSettings);
                                            if (stats.total === 0) return null;
                                            const lampColor = getStatusLampColor(stats.overallStatus);
                                            return (
                                                <span
                                                    style={{
                                                        width: '8px',
                                                        height: '8px',
                                                        borderRadius: '50%',
                                                        backgroundColor: lampColor,
                                                        boxShadow: stats.overallStatus !== 'unknown' ? `0 0 6px ${lampColor}` : 'none',
                                                        flexShrink: 0,
                                                    }}
                                                    title={`Staking Bots health: ${stats.overallStatus}`}
                                                />
                                            );
                                        })()}
                                        <FaBrain style={{ color: '#8b5cf6' }} />
                                        ICP Staking Bots
                                        {neuronManagers.length > 0 && (
                                            <span style={{ ...styles.sectionCount, fontSize: '11px' }}>{neuronManagers.length}</span>
                                        )}
                                        {isNeuronManagersDropTarget && (
                                            <span style={{ marginLeft: '8px', color: theme.colors.accent, fontSize: '11px' }}>
                                                Drop here to add
                                            </span>
                                        )}
                                    </div>
                                    <Link 
                                        to="/create_icp_neuron"
                                        onClick={(e) => e.stopPropagation()}
                                        style={{
                                            padding: '4px 10px',
                                            borderRadius: '6px',
                                            border: 'none',
                                            backgroundColor: '#8b5cf6',
                                            color: '#fff',
                                            fontSize: '11px',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            textDecoration: 'none',
                                        }}
                                    >
                                        <FaPlus size={8} /> Create
                                    </Link>
                                </div>
                        
                        {neuronManagersExpanded && (
                            <>
                                {/* Add existing manager input */}
                                <div style={{ ...styles.addSection, marginBottom: '16px' }}>
                                    <div style={styles.addSectionTitle}>Add existing manager</div>
                                    <div style={styles.inputRow}>
                                        <PrincipalInput
                                            value={newManagerId}
                                            onChange={(v) => {
                                                setNewManagerId(v);
                                                setManagerError(null);
                                            }}
                                            placeholder="Enter ICP staking bot app canister id"
                                            onKeyDown={(e) => e.key === 'Enter' && handleAddManager()}
                                            style={{ flex: 1, maxWidth: 'none' }}
                                            inputStyle={{ fontFamily: 'monospace' }}
                                            disabled={addingManager}
                                            defaultPrincipalType="canisters"
                                        />
                                        <button
                                            onClick={handleAddManager}
                                            style={{
                                                ...styles.addButton,
                                                backgroundColor: (addingManager || !newManagerId.trim()) ? '#6c757d' : '#8b5cf6',
                                                cursor: (addingManager || !newManagerId.trim()) ? 'not-allowed' : 'pointer',
                                                opacity: (addingManager || !newManagerId.trim()) ? 0.6 : 1,
                                            }}
                                            disabled={addingManager || !newManagerId.trim()}
                                        >
                                            {addingManager ? (
                                                <FaSpinner className="spin" />
                                            ) : (
                                                <FaPlus />
                                            )}
                                            Add
                                        </button>
                                    </div>
                                    {managerError && (
                                        <div style={{ color: '#dc3545', fontSize: '13px', marginTop: '8px' }}>
                                            {managerError}
                                        </div>
                                    )}
                                </div>

                                {loadingNeuronManagers ? (
                                    <div style={styles.loadingSpinner}>
                                        <FaSpinner className="spin" size={24} />
                                    </div>
                                ) : neuronManagers.length === 0 ? (
                                    <div style={styles.emptyState}>
                                        <div style={styles.emptyIcon}>🧠</div>
                                        <div style={styles.emptyText}>No ICP Staking Bots</div>
                                        <div style={styles.emptySubtext}>
                                            <Link to="/create_icp_neuron" style={{ color: theme.colors.accent }}>
                                                Create your first ICP staking bot →
                                            </Link>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {/* Manager Health Summary */}
                                        {(() => {
                                            const stats = getManagersHealthStats(neuronManagers, neuronManagerCycleSettings);
                                            const overallColor = getStatusLampColor(stats.overallStatus);
                                            
                                            return (
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    padding: '12px 16px',
                                                    backgroundColor: theme.colors.secondaryBg,
                                                    borderRadius: '8px',
                                                    border: `1px solid ${theme.colors.border}`,
                                                    marginBottom: '16px',
                                                    flexWrap: 'wrap',
                                                    gap: '12px',
                                                }}>
                                                    {/* Overall status lamp */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <span
                                                            style={{
                                                                width: '16px',
                                                                height: '16px',
                                                                borderRadius: '50%',
                                                                backgroundColor: overallColor,
                                                                boxShadow: stats.overallStatus !== 'unknown' ? `0 0 10px ${overallColor}` : 'none',
                                                                flexShrink: 0,
                                                            }}
                                                            title={`Overall health: ${stats.overallStatus}`}
                                                        />
                                                        <span style={{ 
                                                            fontWeight: 600, 
                                                            color: theme.colors.primaryText,
                                                            fontSize: '14px',
                                                        }}>
                                                            {stats.total} {stats.total === 1 ? 'Manager' : 'Managers'}
                                                        </span>
                                                    </div>
                                                    
                                                    {/* Status breakdown */}
                                                    <div style={{ 
                                                        display: 'flex', 
                                                        alignItems: 'center', 
                                                        gap: '16px',
                                                        flexWrap: 'wrap',
                                                    }}>
                                                        {stats.red > 0 && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <span style={{
                                                                    width: '8px',
                                                                    height: '8px',
                                                                    borderRadius: '50%',
                                                                    backgroundColor: '#ef4444',
                                                                    boxShadow: '0 0 6px #ef4444',
                                                                }} />
                                                                <span style={{ color: '#ef4444', fontWeight: 500, fontSize: '13px' }}>
                                                                    {stats.red} critical
                                                                </span>
                                                            </div>
                                                        )}
                                                        {stats.orange > 0 && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <span style={{
                                                                    width: '8px',
                                                                    height: '8px',
                                                                    borderRadius: '50%',
                                                                    backgroundColor: '#f59e0b',
                                                                    boxShadow: '0 0 6px #f59e0b',
                                                                }} />
                                                                <span style={{ color: '#f59e0b', fontWeight: 500, fontSize: '13px' }}>
                                                                    {stats.orange} warning
                                                                </span>
                                                            </div>
                                                        )}
                                                        {stats.green > 0 && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <span style={{
                                                                    width: '8px',
                                                                    height: '8px',
                                                                    borderRadius: '50%',
                                                                    backgroundColor: '#22c55e',
                                                                    boxShadow: '0 0 6px #22c55e',
                                                                }} />
                                                                <span style={{ color: '#22c55e', fontWeight: 500, fontSize: '13px' }}>
                                                                    {stats.green} healthy
                                                                </span>
                                                            </div>
                                                        )}
                                                        {stats.unknown > 0 && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <span style={{
                                                                    width: '8px',
                                                                    height: '8px',
                                                                    borderRadius: '50%',
                                                                    backgroundColor: '#6b7280',
                                                                }} />
                                                                <span style={{ color: '#6b7280', fontWeight: 500, fontSize: '13px' }}>
                                                                    {stats.unknown} unknown
                                                                </span>
                                                            </div>
                                                        )}
                                                        {stats.outdated > 0 && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <span style={{ fontSize: '12px' }}>⚠️</span>
                                                                <span style={{ color: '#f59e0b', fontWeight: 500, fontSize: '13px' }}>
                                                                    {stats.outdated} outdated
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                        
                                    <div style={styles.canisterList}>
                                        {neuronManagers.map((manager) => {
                                            const canisterId = manager.canisterId.toText();
                                            const displayInfo = getPrincipalDisplayInfoFromContext(canisterId, principalNames, principalNicknames, verifiedNames, principalCanisterTypes);
                                            
                                            // Check if this is actually a valid neuron manager via WASM hash
                                            // Only show as NeuronManagerCard if WASM matches known versions
                                            const hasMatchingWasm = manager.moduleHash && isKnownNeuronManagerHash(manager.moduleHash);
                                            const shouldShowAsManager = hasMatchingWasm;
                                            
                                            if (!shouldShowAsManager) {
                                                // Show as regular canister card
                                                const canisterHealth = getCanisterHealthStatus(canisterId, { [canisterId]: { cycles: manager.cycles } }, cycleSettings);
                                                const canisterLampColor = getStatusLampColor(canisterHealth);
                                                
                                                return (
                                                    <DraggableItem
                                                        key={canisterId}
                                                        type="canister"
                                                        id={canisterId}
                                                        sourceGroupId="neuron_managers"
                                                        style={{
                                                            ...styles.canisterCard,
                                                            transition: 'opacity 0.15s ease',
                                                        }}
                                                    >
                                                        <div style={styles.canisterInfo}>
                                                        <div style={{ ...styles.canisterIcon, position: 'relative' }}>
                                                            {getCanisterTypeIcon(displayInfo?.canisterTypes, 18, theme.colors.accent)}
                                                            {manager.isController && (
                                                                <FaCrown 
                                                                    size={10} 
                                                                    style={{ 
                                                                        position: 'absolute', 
                                                                        top: -4, 
                                                                        right: -4, 
                                                                        color: '#f59e0b',
                                                                    }} 
                                                                    title="You are a controller"
                                                                />
                                                            )}
                                                            {/* Cycle status lamp - top left */}
                                                            <span
                                                                style={{
                                                                    position: 'absolute',
                                                                    top: -3,
                                                                    left: -3,
                                                                    width: '8px',
                                                                    height: '8px',
                                                                    borderRadius: '50%',
                                                                    backgroundColor: canisterLampColor,
                                                                    boxShadow: canisterHealth !== 'unknown' ? `0 0 6px ${canisterLampColor}` : 'none',
                                                                    zIndex: 2,
                                                                }}
                                                                title={`Health: ${canisterHealth}${!manager.moduleHash ? ' (WASM unknown - not controller)' : ' (WASM mismatch)'}`}
                                                            />
                                                        </div>
                                                        <div>
                                                            <PrincipalDisplay
                                                                principal={canisterId}
                                                                displayInfo={displayInfo}
                                                                showCopyButton={true}
                                                                isAuthenticated={isAuthenticated}
                                                                noLink={true}
                                                                style={{ fontSize: '14px' }}
                                                                showSendMessage={false}
                                                                showViewProfile={false}
                                                            />
                                                            <div style={{ fontSize: '11px', color: manager.moduleHash ? '#ef4444' : theme.colors.secondaryText, marginTop: '2px' }}>
                                                                {manager.moduleHash ? '⚠️ WASM mismatch - not a known ICP staking bot' : '🔒 WASM unknown - need controller access to verify'}
                                                            </div>
                                                        </div>
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginLeft: 'auto' }}>
                                                            {manager.cycles !== null && (
                                                                <span 
                                                                    style={{
                                                                        ...styles.managerVersion,
                                                                        backgroundColor: `${getCyclesColor(manager.cycles, neuronManagerCycleSettings)}20`,
                                                                        color: getCyclesColor(manager.cycles, neuronManagerCycleSettings),
                                                                    }}
                                                                    title={`${manager.cycles.toLocaleString()} cycles`}
                                                                >
                                                                    ⚡ {formatCyclesCompact(manager.cycles)}
                                                                </span>
                                                            )}
                                                            {manager.memory !== null && (
                                                                <span 
                                                                    style={{
                                                                        ...styles.managerVersion,
                                                                        backgroundColor: `${theme.colors.accent}20`,
                                                                        color: theme.colors.accent,
                                                                    }}
                                                                    title={`${manager.memory.toLocaleString()} bytes`}
                                                                >
                                                                    💾 {formatMemory(manager.memory)}
                                                                </span>
                                                            )}
                                                            <Link
                                                                to={`/canister?id=${canisterId}`}
                                                                style={{
                                                                    ...styles.viewLink,
                                                                    padding: '6px 8px',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                }}
                                                                title="View details"
                                                            >
                                                                <FaEdit size={12} />
                                                            </Link>
                                                            {confirmRemoveManager === canisterId ? (
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
                                                                    <span style={{ color: '#888', fontSize: '11px', whiteSpace: 'nowrap' }}>Remove?</span>
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setConfirmRemoveManager(null);
                                                                            handleRemoveManager(manager.canisterId);
                                                                        }}
                                                                        disabled={removingManager === canisterId}
                                                                        style={{
                                                                            backgroundColor: '#ef4444',
                                                                            color: '#fff',
                                                                            border: 'none',
                                                                            borderRadius: '4px',
                                                                            padding: '4px 10px',
                                                                            cursor: removingManager === canisterId ? 'not-allowed' : 'pointer',
                                                                            fontSize: '12px',
                                                                            fontWeight: '500',
                                                                            opacity: removingManager === canisterId ? 0.7 : 1,
                                                                        }}
                                                                    >
                                                                        {removingManager === canisterId ? '...' : 'Yes'}
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setConfirmRemoveManager(null);
                                                                        }}
                                                                        style={{
                                                                            backgroundColor: theme.colors.secondaryBg,
                                                                            color: theme.colors.primaryText,
                                                                            border: `1px solid ${theme.colors.border}`,
                                                                            borderRadius: '4px',
                                                                            padding: '4px 10px',
                                                                            cursor: 'pointer',
                                                                            fontSize: '12px',
                                                                        }}
                                                                    >
                                                                        No
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <button
                                                                    onClick={(e) => { 
                                                                        e.stopPropagation(); 
                                                                        setConfirmRemoveManager(canisterId);
                                                                    }}
                                                                    style={styles.removeButton}
                                                                    disabled={removingManager === canisterId}
                                                                    title="Remove from list"
                                                                >
                                                                    {removingManager === canisterId ? (
                                                                        <FaSpinner className="spin" />
                                                                    ) : (
                                                                        <FaTrash />
                                                                    )}
                                                                </button>
                                                            )}
                                                        </div>
                                                    </DraggableItem>
                                                );
                                            }
                                            
                                            // Show as neuron manager card
                                            const managerHealth = getManagerHealthStatus(manager, neuronManagerCycleSettings);
                                            const managerLampColor = getStatusLampColor(managerHealth);
                                            
                                            return (
                                                <DraggableItem
                                                    key={canisterId}
                                                    type="canister"
                                                    id={canisterId}
                                                    sourceGroupId="neuron_managers"
                                                    style={{
                                                        ...styles.managerCard,
                                                        transition: 'opacity 0.15s ease',
                                                    }}
                                                >
                                                    <div style={styles.managerInfo}>
                                                        <div style={{ ...styles.managerIcon, position: 'relative' }}>
                                                            <FaBrain size={18} />
                                                            {manager.isController && (
                                                                <FaCrown 
                                                                    size={10} 
                                                                    style={{ 
                                                                        position: 'absolute', 
                                                                        top: -4, 
                                                                        right: -4, 
                                                                        color: '#f59e0b',
                                                                    }} 
                                                                    title="You are a controller"
                                                                />
                                                            )}
                                                            {/* Cycle status lamp - top left */}
                                                            <span
                                                                style={{
                                                                    position: 'absolute',
                                                                    top: -3,
                                                                    left: -3,
                                                                    width: '8px',
                                                                    height: '8px',
                                                                    borderRadius: '50%',
                                                                    backgroundColor: managerLampColor,
                                                                    boxShadow: managerHealth !== 'unknown' ? `0 0 6px ${managerLampColor}` : 'none',
                                                                    zIndex: 2,
                                                                }}
                                                                title={`Health: ${managerHealth}${isVersionOutdated(manager.version) ? ' (outdated version)' : ''}`}
                                                            />
                                                        </div>
                                                        <div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                                                <PrincipalDisplay
                                                                    principal={canisterId}
                                                                    displayInfo={displayInfo}
                                                                    showCopyButton={true}
                                                                    isAuthenticated={isAuthenticated}
                                                                    noLink={true}
                                                                    style={{ fontSize: '14px' }}
                                                                    showSendMessage={false}
                                                                    showViewProfile={false}
                                                                />
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                                <span 
                                                                    style={{
                                                                        ...styles.managerVersion,
                                                                        ...(isVersionOutdated(manager.version) ? {
                                                                            backgroundColor: '#f59e0b20',
                                                                            color: '#f59e0b',
                                                                        } : {}),
                                                                    }}
                                                                    title={isVersionOutdated(manager.version) 
                                                                        ? `Newer version available: v${Number(latestOfficialVersion.major)}.${Number(latestOfficialVersion.minor)}.${Number(latestOfficialVersion.patch)}`
                                                                        : undefined
                                                                    }
                                                                >
                                                                    {isVersionOutdated(manager.version) && '⚠️ '}
                                                                    {manager.version ? `v${Number(manager.version.major)}.${Number(manager.version.minor)}.${Number(manager.version.patch)}` : '...'}
                                                                </span>
                                                                <span style={{
                                                                    ...styles.managerVersion,
                                                                    backgroundColor: manager.neuronCount != null && manager.neuronCount > 0 ? '#8b5cf620' : theme.colors.tertiaryBg,
                                                                    color: manager.neuronCount != null && manager.neuronCount > 0 ? '#8b5cf6' : theme.colors.secondaryText,
                                                                }}>
                                                                    🧠 {manager.neuronCount != null ? `${manager.neuronCount} neuron${manager.neuronCount !== 1 ? 's' : ''}` : '...'}
                                                                </span>
                                                                {manager.cycles !== null && (
                                                                    <span 
                                                                        style={{
                                                                            ...styles.managerVersion,
                                                                            backgroundColor: `${getCyclesColor(manager.cycles, neuronManagerCycleSettings)}20`,
                                                                            color: getCyclesColor(manager.cycles, neuronManagerCycleSettings),
                                                                        }}
                                                                        title={`${manager.cycles.toLocaleString()} cycles`}
                                                                    >
                                                                        ⚡ {formatCyclesCompact(manager.cycles)}
                                                                    </span>
                                                                )}
                                                                {manager.memory !== null && (
                                                                    <span 
                                                                        style={{
                                                                            ...styles.managerVersion,
                                                                            backgroundColor: `${theme.colors.accent}20`,
                                                                            color: theme.colors.accent,
                                                                        }}
                                                                        title={`${manager.memory.toLocaleString()} bytes`}
                                                                    >
                                                                        💾 {formatMemory(manager.memory)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                        <Link
                                                            to={`/icp_neuron_manager/${canisterId}`}
                                                            style={{
                                                                ...styles.viewLink,
                                                                backgroundColor: '#8b5cf615',
                                                                color: '#8b5cf6',
                                                                padding: '6px 8px',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                            }}
                                                            title="Manage neurons"
                                                        >
                                                            <FaBrain size={12} />
                                                        </Link>
                                                        <Link
                                                            to={`/canister?id=${canisterId}`}
                                                            style={{
                                                                ...styles.viewLink,
                                                                padding: '6px 8px',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                            }}
                                                            title="View details"
                                                        >
                                                            <FaEdit size={12} />
                                                        </Link>
                                                        {confirmRemoveManager === canisterId ? (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
                                                                <span style={{ 
                                                                    color: '#888', 
                                                                    fontSize: '11px',
                                                                    whiteSpace: 'nowrap'
                                                                }}>
                                                                    Remove?
                                                                </span>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setConfirmRemoveManager(null);
                                                                        handleRemoveManager(manager.canisterId);
                                                                    }}
                                                                    disabled={removingManager === canisterId}
                                                                    style={{
                                                                        backgroundColor: '#ef4444',
                                                                        color: '#fff',
                                                                        border: 'none',
                                                                        borderRadius: '4px',
                                                                        padding: '4px 10px',
                                                                        cursor: removingManager === canisterId ? 'not-allowed' : 'pointer',
                                                                        fontSize: '12px',
                                                                        fontWeight: '500',
                                                                        opacity: removingManager === canisterId ? 0.7 : 1,
                                                                    }}
                                                                >
                                                                    {removingManager === canisterId ? '...' : 'Yes'}
                                                                </button>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setConfirmRemoveManager(null);
                                                                    }}
                                                                    style={{
                                                                        backgroundColor: '#2a2a2a',
                                                                        color: '#fff',
                                                                        border: '1px solid #3a3a3a',
                                                                        borderRadius: '4px',
                                                                        padding: '4px 10px',
                                                                        cursor: 'pointer',
                                                                        fontSize: '12px',
                                                                    }}
                                                                >
                                                                    No
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                onClick={(e) => { 
                                                                    e.stopPropagation(); 
                                                                    setConfirmRemoveManager(canisterId);
                                                                }}
                                                                style={styles.removeButton}
                                                                disabled={removingManager === canisterId}
                                                                title="Remove from list (does not delete app canister)"
                                                            >
                                                                {removingManager === canisterId ? (
                                                                    <FaSpinner className="spin" />
                                                                ) : (
                                                                    <FaTrash />
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>
                                                </DraggableItem>
                                            );
                                        })}
                                    </div>
                                    </>
                                )}
                            </>
                                )}
                                </div>
                                    )}
                                </DroppableSection>
                            </>
                        )}
                    </>
                )}
            </div>

            {/* Spinner animation */}
            <style>{`
                .spin {
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
            </DndProvider>

            {/* Upgrade Bots Dialog */}
            <UpgradeBotsDialog
                isOpen={upgradeDialogOpen}
                onClose={() => setUpgradeDialogOpen(false)}
                outdatedManagers={outdatedManagersForBanner}
                latestVersion={latestOfficialVersion}
                onUpgradeComplete={() => {
                    fetchNeuronManagers();
                }}
            />

            {/* Top Up Cycles Dialog */}
            <TopUpCyclesDialog
                isOpen={topUpDialogOpen}
                onClose={() => setTopUpDialogOpen(false)}
                lowCyclesCanisters={lowCyclesCanistersForBanner}
                onTopUpComplete={() => {
                    fetchNeuronManagers();
                    // Re-fetch custom canister statuses
                    const allIds = [
                        ...getAllCanisterIds(canisterGroups),
                        ...trackedCanisters,
                    ];
                    allIds.forEach(id => fetchCanisterStatus(id));
                }}
            />
        </div>
    );
}

