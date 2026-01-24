import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { Principal } from '@dfinity/principal';
import { HttpAgent, Actor } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { getCanisterGroups, setCanisterGroups, convertGroupsFromBackend, getTrackedCanisters, registerTrackedCanister, unregisterTrackedCanister } from '../utils/BackendUtils';
import { createActor as createBackendActor, canisterId as BACKEND_CANISTER_ID } from 'declarations/app_sneeddao_backend';
import { usePremiumStatus } from '../hooks/usePremiumStatus';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { useNaming } from '../NamingContext';
import { FaPlus, FaTrash, FaCube, FaSpinner, FaChevronDown, FaChevronRight, FaBrain, FaFolder, FaFolderOpen, FaEdit, FaCheck, FaTimes, FaCrown, FaLock, FaStar, FaArrowRight } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneed_icp_neuron_manager_factory';
import { createActor as createManagerActor } from 'declarations/sneed_icp_neuron_manager';
import { getCyclesColor, formatCyclesCompact, getNeuronManagerSettings } from '../utils/NeuronManagerSettings';

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

export default function CanistersPage() {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const { principalNames, principalNicknames } = useNaming();
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
    const [cycleSettings, setCycleSettings] = useState(() => getNeuronManagerSettings());
    
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

    // Tracked canisters (wallet canisters) state
    const [trackedCanisters, setTrackedCanisters] = useState([]);
    const [loadingTrackedCanisters, setLoadingTrackedCanisters] = useState(true);
    const [newWalletCanisterId, setNewWalletCanisterId] = useState('');
    const [addingWalletCanister, setAddingWalletCanister] = useState(false);
    const [walletCanisterError, setWalletCanisterError] = useState(null);
    const [confirmRemoveWalletCanister, setConfirmRemoveWalletCanister] = useState(null);
    const [removingWalletCanister, setRemovingWalletCanister] = useState(null);
    const [trackedCanisterStatus, setTrackedCanisterStatus] = useState({}); // canisterId -> { cycles, memory, isController }

    // Drag and drop state
    const [draggedItem, setDraggedItem] = useState(null); // { type: 'canister' | 'group', id: string, sourceGroupId?: string }
    const [dragOverTarget, setDragOverTarget] = useState(null); // { type: 'group' | 'wallet' | 'neuron_managers' | 'ungrouped', id?: string }
    const dragCounterRef = React.useRef({}); // Track drag enter/leave counts per target

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
            const [canisterIds, officialVersions] = await Promise.all([
                factory.getMyManagers(),
                factory.getOfficialVersions(),
            ]);
            
            // Find latest official version
            if (officialVersions && officialVersions.length > 0) {
                const sorted = [...officialVersions].sort((a, b) => compareVersions(b, a));
                setLatestOfficialVersion(sorted[0]);
            }
            
            // Fetch current version, neuron count, and cycles from each canister
            const managersWithInfo = await Promise.all(
                canisterIds.map(async (canisterIdPrincipal) => {
                    const canisterId = canisterIdPrincipal.toString();
                    try {
                        const managerActor = createManagerActor(canisterId, { agent });
                        const [currentVersion, neuronIds] = await Promise.all([
                            managerActor.getVersion(),
                            managerActor.getNeuronIds(),
                        ]);
                        
                        // Try to fetch cycles and memory (may fail if not controller)
                        // Need to create actor with effectiveCanisterId for management canister
                        let cycles = null;
                        let memory = null;
                        let isController = false;
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
                        };
                    } catch (err) {
                        console.error(`Error fetching info for ${canisterId}:`, err);
                        return { canisterId: canisterIdPrincipal, version: { major: 0, minor: 0, patch: 0 }, neuronCount: 0, cycles: null, memory: null, isController: false };
                    }
                })
            );
            
            setNeuronManagers(managersWithInfo);
        } catch (err) {
            console.error('Error loading neuron managers:', err);
        } finally {
            setLoadingNeuronManagers(false);
        }
    }, [identity]);

    // Fetch status (cycles & memory) for a single custom canister (async, doesn't block UI)
    const fetchCanisterStatus = useCallback(async (canisterId) => {
        if (!identity) return;
        
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
            const cycles = Number(status.cycles);
            const memory = Number(status.memory_size);
            
            setCanisterStatus(prev => ({ ...prev, [canisterId]: { cycles, memory, isController: true } }));
        } catch (err) {
            // Not a controller or other error - mark isController as false
            console.log(`Cannot fetch status for ${canisterId}:`, err.message || err);
            setCanisterStatus(prev => ({ ...prev, [canisterId]: { cycles: null, memory: null, isController: false } }));
        }
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
                setError('Failed to load canister groups');
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
                            statusMap[canisterId] = {
                                cycles: Number(status.cycles),
                                memory: Number(status.memory_size),
                                isController: true,
                            };
                        } catch {
                            // Can't get status - not a controller
                            statusMap[canisterId] = null;
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
            setWalletCanisterError('Invalid canister ID format');
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
            setWalletCanisterError(err.message || 'Failed to add canister');
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
            setError('Invalid canister ID format');
            return;
        }

        const canisterIdStr = canisterPrincipal.toString();

        // Check if already tracked
        if (canisterExistsInGroups(canisterIdStr, canisterGroups)) {
            setError('This canister is already being tracked');
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
            setSuccessMessage('Canister added');
            // Fetch cycles for the new canister asynchronously
            fetchCanisterStatus(canisterIdStr);
        } catch (err) {
            console.error('Error adding canister:', err);
            setError('Failed to add canister');
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
            setSuccessMessage('Canister removed');
            setConfirmRemoveCanister(null);
        } catch (err) {
            console.error('Error removing canister:', err);
            setError('Failed to remove canister');
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
            setError('Invalid canister ID format');
            return;
        }

        const canisterIdStr = canisterPrincipal.toString();

        if (canisterExistsInGroups(canisterIdStr, canisterGroups)) {
            setError('This canister is already being tracked');
            return;
        }

        try {
            const newGroups = addCanisterToGroup(canisterGroups, canisterIdStr, groupId);
            await saveCanisterGroups(newGroups);
            setNewCanisterForGroup('');
            setAddingCanisterToGroupId(null);
            setSuccessMessage('Canister added to group');
            fetchCanisterStatus(canisterIdStr);
        } catch (err) {
            console.error('Error adding canister to group:', err);
            setError('Failed to add canister');
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
            setSuccessMessage('Canister moved');
        } catch (err) {
            console.error('Error moving canister:', err);
            setError('Failed to move canister');
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
            setManagerError('Invalid canister ID format');
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
    const handleMoveFromWallet = async (canisterId, destination) => {
        try {
            // Remove from wallet
            await unregisterTrackedCanister(identity, canisterId);
            const canisters = await getTrackedCanisters(identity);
            setTrackedCanisters(canisters.map(p => p.toText()));
            
            // Add to destination
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
                setSuccessMessage('Canister moved to Neuron Managers');
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
                setSuccessMessage('Canister moved to groups');
            }
        } catch (err) {
            console.error('Error moving canister from wallet:', err);
            setError('Failed to move canister: ' + (err.message || 'Unknown error'));
        }
    };

    // Move canister from groups to wallet or neuron managers
    const handleMoveFromGroups = async (canisterId, fromGroupId, destination) => {
        try {
            // Remove from current group
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
            
            // Add to destination
            if (destination === 'wallet') {
                await registerTrackedCanister(identity, canisterId);
                const canisters = await getTrackedCanisters(identity);
                setTrackedCanisters(canisters.map(p => p.toText()));
                setSuccessMessage('Canister moved to Wallet');
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
                setSuccessMessage('Canister moved to Neuron Managers');
            }
        } catch (err) {
            console.error('Error moving canister from groups:', err);
            setError('Failed to move canister: ' + (err.message || 'Unknown error'));
        }
    };

    // Move neuron manager to wallet or groups
    const handleMoveFromNeuronManagers = async (canisterId, destination) => {
        try {
            // Remove from neuron managers
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
            
            const canisterIdStr = typeof canisterId === 'string' ? canisterId : canisterId.toText();
            
            // Add to destination
            if (destination === 'wallet') {
                await registerTrackedCanister(identity, canisterIdStr);
                const canisters = await getTrackedCanisters(identity);
                setTrackedCanisters(canisters.map(p => p.toText()));
                setSuccessMessage('Canister moved to Wallet');
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
                setSuccessMessage('Canister moved to groups');
            }
        } catch (err) {
            console.error('Error moving canister from neuron managers:', err);
            setError('Failed to move canister: ' + (err.message || 'Unknown error'));
        }
    };

    // Drag and drop handlers
    const handleDragStart = (e, type, id, sourceGroupId = null) => {
        // Reset all drag counters
        dragCounterRef.current = {};
        setDraggedItem({ type, id, sourceGroupId });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify({ type, id, sourceGroupId }));
        // Set a custom drag image (optional - let browser handle it)
        // The opacity will be handled by React state (isDragging prop)
    };

    const handleDragEnd = (e) => {
        setDraggedItem(null);
        setDragOverTarget(null);
        dragCounterRef.current = {};
    };

    // Check if dropping is allowed for this target
    const isDropAllowed = (targetType, targetId) => {
        if (!draggedItem) return false;
        
        // Don't allow dropping a group onto itself or its children
        if (draggedItem.type === 'group' && targetType === 'group') {
            if (draggedItem.id === targetId) return false;
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
            if (isChildOf(draggedItem.id, targetId, canisterGroups.groups)) return false;
        }
        
        // Don't allow dropping on the same source
        if (draggedItem.type === 'canister') {
            if (targetType === 'wallet' && draggedItem.sourceGroupId === 'wallet') return false;
            if (targetType === 'neuron_managers' && draggedItem.sourceGroupId === 'neuron_managers') return false;
            if (targetType === 'ungrouped' && draggedItem.sourceGroupId === 'ungrouped') return false;
            if (targetType === 'group' && draggedItem.sourceGroupId === targetId) return false;
        }
        
        return true;
    };

    const getTargetKey = (targetType, targetId) => `${targetType}-${targetId || 'root'}`;

    const handleDragEnter = (e, targetType, targetId = null) => {
        e.preventDefault();
        
        if (!isDropAllowed(targetType, targetId)) return;
        
        // Simply set the current target - the most recent valid target wins
        setDragOverTarget({ type: targetType, id: targetId });
    };

    const handleDragOver = (e, targetType, targetId = null) => {
        e.preventDefault();
        
        if (!isDropAllowed(targetType, targetId)) {
            e.dataTransfer.dropEffect = 'none';
            return;
        }
        
        e.dataTransfer.dropEffect = 'move';
        
        // Keep the target active while dragging over it
        if (!dragOverTarget || dragOverTarget.type !== targetType || dragOverTarget.id !== targetId) {
            setDragOverTarget({ type: targetType, id: targetId });
        }
    };

    const handleDragLeave = (e, targetType, targetId = null) => {
        e.preventDefault();
        
        // Only clear if we're actually leaving this element (not entering a child)
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        
        // Check if cursor is outside the element bounds
        const isOutside = x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
        
        if (isOutside && dragOverTarget?.type === targetType && dragOverTarget?.id === targetId) {
            setDragOverTarget(null);
        }
    };

    const handleDrop = async (e, targetType, targetId = null) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOverTarget(null);
        
        if (!draggedItem) return;
        
        const { type: itemType, id: itemId, sourceGroupId } = draggedItem;
        setDraggedItem(null);
        
        // Handle canister drops
        if (itemType === 'canister') {
            // From wallet
            if (sourceGroupId === 'wallet') {
                if (targetType === 'group' || targetType === 'ungrouped') {
                    await handleMoveFromWallet(itemId, targetId || 'ungrouped');
                } else if (targetType === 'neuron_managers') {
                    await handleMoveFromWallet(itemId, 'neuron_managers');
                }
                // If dropping on wallet again, do nothing
            }
            // From neuron managers
            else if (sourceGroupId === 'neuron_managers') {
                if (targetType === 'wallet') {
                    await handleMoveFromNeuronManagers(Principal.fromText(itemId), 'wallet');
                } else if (targetType === 'group' || targetType === 'ungrouped') {
                    await handleMoveFromNeuronManagers(Principal.fromText(itemId), targetId || 'ungrouped');
                }
                // If dropping on neuron_managers again, do nothing
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

    // Recursive component for rendering a group
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
        // Drag and drop props
        onDragStart, onDragEnd, onDragEnter, onDragOver, onDragLeave, onDrop, draggedItem, dragOverTarget
    }) => {
        const isExpanded = expandedGroups[group.id] ?? true;
        const isEditing = editingGroup === group.id;
        const isAddingSubgroup = newSubgroupParent === group.id;
        const isAddingCanister = addingCanisterToGroupId === group.id;
        const totalCanisters = group.canisters.length + 
            group.subgroups.reduce((sum, sg) => sum + sg.canisters.length, 0);
        
        // Calculate health status for this group
        const healthStatus = getGroupHealthStatus(group, canisterStatus, cycleSettings);
        const lampColor = getStatusLampColor(healthStatus);
        const isDropTarget = dragOverTarget?.type === 'group' && dragOverTarget?.id === group.id;
        const isBeingDragged = draggedItem?.type === 'group' && draggedItem?.id === group.id;

        return (
            <div 
                style={{ 
                    marginBottom: '8px',
                    marginLeft: depth > 0 ? '20px' : '0',
                }}
                onDragEnter={(e) => {
                    e.stopPropagation(); // Stop bubbling to parent groups
                    onDragEnter && onDragEnter(e, 'group', group.id);
                }}
                onDragOver={(e) => {
                    e.stopPropagation(); // Stop bubbling to parent groups
                    onDragOver && onDragOver(e, 'group', group.id);
                }}
                onDragLeave={(e) => {
                    e.stopPropagation(); // Stop bubbling to parent groups
                    onDragLeave && onDragLeave(e, 'group', group.id);
                }}
                onDrop={(e) => {
                    e.stopPropagation(); // Stop bubbling to parent groups
                    onDrop && onDrop(e, 'group', group.id);
                }}
            >
                {/* Group Header */}
                <div 
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        backgroundColor: isDropTarget ? `${theme.colors.primary}20` : theme.colors.card,
                        borderRadius: '8px',
                        border: isDropTarget 
                            ? `2px dashed ${theme.colors.primary}` 
                            : `1px solid ${theme.colors.border}`,
                        cursor: isBeingDragged ? 'grabbing' : 'grab',
                        opacity: isBeingDragged ? 0.4 : 1,
                        transition: 'all 0.15s ease',
                        userSelect: 'none',
                        WebkitUserDrag: 'element',
                    }}
                    draggable="true"
                    onDragStart={(e) => {
                        if (onDragStart) {
                            onDragStart(e, 'group', group.id, null);
                        }
                    }}
                    onDragEnd={(e) => {
                        if (onDragEnd) {
                            onDragEnd(e);
                        }
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
                                    backgroundColor: theme.colors.inputBackground,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: '4px',
                                    color: theme.colors.text,
                                }}
                                autoFocus
                            />
                        ) : (
                            <span style={{ fontWeight: 500, color: theme.colors.text }}>{group.name}</span>
                        )}
                        <span style={{ 
                            fontSize: '11px', 
                            color: theme.colors.textSecondary,
                            backgroundColor: theme.colors.inputBackground,
                            padding: '2px 8px',
                            borderRadius: '10px',
                        }}>
                            {totalCanisters}
                        </span>
                        {isDropTarget && (
                            <span style={{ 
                                fontSize: '11px', 
                                color: theme.colors.primary,
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
                                    style={{ padding: '4px 8px', backgroundColor: theme.colors.card, color: theme.colors.textSecondary, border: `1px solid ${theme.colors.border}`, borderRadius: '4px', cursor: 'pointer' }}
                                >
                                    <FaTimes size={10} />
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    onClick={() => { setAddingCanisterToGroupId(group.id); setNewCanisterForGroup(''); }}
                                    style={{ padding: '4px 8px', backgroundColor: 'transparent', color: theme.colors.primary || '#3b82f6', border: 'none', cursor: 'pointer' }}
                                    title="Add canister to this group"
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
                                    style={{ padding: '4px 8px', backgroundColor: 'transparent', color: theme.colors.textSecondary, border: 'none', cursor: 'pointer' }}
                                    title="Rename group"
                                >
                                    <FaEdit size={12} />
                                </button>
                                <button
                                    onClick={() => {
                                        if (window.confirm(`Delete group "${group.name}"? Canisters will be moved to ungrouped.`)) {
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
                        {/* Add Canister to Group Input */}
                        {isAddingCanister && (
                            <div style={{ 
                                display: 'flex', 
                                gap: '8px', 
                                alignItems: 'center', 
                                marginBottom: '8px',
                                padding: '10px',
                                backgroundColor: theme.colors.inputBackground,
                                borderRadius: '6px',
                            }}>
                                <FaCube size={14} style={{ color: theme.colors.primary || '#3b82f6' }} />
                                <input
                                    type="text"
                                    placeholder="Canister ID"
                                    value={newCanisterForGroup}
                                    onChange={(e) => setNewCanisterForGroup(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleAddCanisterToGroup(group.id);
                                        if (e.key === 'Escape') { setAddingCanisterToGroupId(null); setNewCanisterForGroup(''); }
                                    }}
                                    style={{ 
                                        flex: 1,
                                        padding: '6px 10px', 
                                        fontSize: '12px',
                                        fontFamily: 'monospace',
                                        backgroundColor: theme.colors.card,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '4px',
                                        color: theme.colors.text,
                                    }}
                                    autoFocus
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
                                    style={{ padding: '6px 10px', backgroundColor: theme.colors.card, color: theme.colors.textSecondary, border: `1px solid ${theme.colors.border}`, borderRadius: '4px', cursor: 'pointer' }}
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
                                backgroundColor: theme.colors.inputBackground,
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
                                        backgroundColor: theme.colors.card,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '4px',
                                        color: theme.colors.text,
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
                                    style={{ padding: '6px 10px', backgroundColor: theme.colors.card, color: theme.colors.textSecondary, border: `1px solid ${theme.colors.border}`, borderRadius: '4px', cursor: 'pointer' }}
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
                                onDragStart={onDragStart}
                                onDragEnd={onDragEnd}
                                onDragEnter={onDragEnter}
                                onDragOver={onDragOver}
                                onDragLeave={onDragLeave}
                                onDrop={onDrop}
                                draggedItem={draggedItem}
                                dragOverTarget={dragOverTarget}
                            />
                        ))}
                        
                        {/* Canisters in this group */}
                        {group.canisters.length > 0 && (
                            <div style={styles.canisterList}>
                                {group.canisters.map((canisterId) => (
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
                                        canisterGroups={canisterGroups}
                                        handleMoveCanister={handleMoveCanister}
                                        handleMoveFromGroups={handleMoveFromGroups}
                                        onDragStart={onDragStart}
                                        onDragEnd={onDragEnd}
                                        isDragging={draggedItem?.type === 'canister' && draggedItem?.id === canisterId}
                                    />
                                ))}
                            </div>
                        )}
                        
                        {/* Empty group message */}
                        {group.canisters.length === 0 && group.subgroups.length === 0 && (
                            <div style={{ 
                                padding: '16px', 
                                textAlign: 'center', 
                                color: theme.colors.textSecondary,
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
        
        // Recursively find worst status
        const getWorstStatus = (grp) => {
            let worst = 0;
            
            // Check all canisters in this group
            for (const canisterId of grp.canisters) {
                const level = getCanisterStatusLevel(canisterId);
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
    }, []);

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
    const getOverallHealthStats = useCallback((groupsRoot, canisterStatus, cycleSettings) => {
        const { cycleThresholdRed, cycleThresholdOrange } = cycleSettings;
        
        // Collect all canister IDs
        const allCanisterIds = [];
        const collectFromGroups = (groups) => {
            for (const group of groups) {
                allCanisterIds.push(...group.canisters);
                collectFromGroups(group.subgroups);
            }
        };
        collectFromGroups(groupsRoot.groups);
        allCanisterIds.push(...groupsRoot.ungrouped);
        
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
            total: allCanisterIds.length,
            overallStatus
        };
    }, []);

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
            const status = getManagerHealthStatus(manager, cycleSettings);
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

    // Component for rendering a single canister card
    const CanisterCard = ({ 
        canisterId, groupId, styles, theme, canisterStatus, cycleSettings,
        principalNames, principalNicknames, isAuthenticated,
        confirmRemoveCanister, setConfirmRemoveCanister, handleRemoveCanister,
        canisterGroups, handleMoveCanister, handleMoveFromGroups,
        // Drag and drop props
        onDragStart, onDragEnd, isDragging
    }) => {
        const displayInfo = getPrincipalDisplayInfoFromContext(canisterId, principalNames, principalNicknames);
        const status = canisterStatus[canisterId];
        const cycles = status?.cycles;
        const memory = status?.memory;
        const isController = status?.isController;
        const isConfirming = confirmRemoveCanister?.canisterId === canisterId && confirmRemoveCanister?.groupId === groupId;

        // Collect all groups for the move dropdown
        const collectGroups = (groups, prefix = '') => {
            let result = [];
            for (const g of groups) {
                result.push({ id: g.id, name: prefix + g.name });
                result = result.concat(collectGroups(g.subgroups, prefix + g.name + ' / '));
            }
            return result;
        };
        const allGroups = [
            { id: 'ungrouped', name: 'Ungrouped' },
            ...collectGroups(canisterGroups.groups)
        ].filter(g => g.id !== groupId);
        
        // Special destinations
        const specialDestinations = [
            { id: 'wallet', name: '💼 Wallet' },
            { id: 'neuron_managers', name: '🧠 Neuron Managers' }
        ];

        // Handler for drag start - needs to be a separate function for proper event handling
        const onDragStartHandler = (e) => {
            // Don't stop propagation here - let the drag start naturally
            if (onDragStart) {
                onDragStart(e, 'canister', canisterId, groupId);
            }
        };
        
        const onDragEndHandler = (e) => {
            if (onDragEnd) {
                onDragEnd(e);
            }
        };

        return (
            <div 
                style={{
                    ...styles.canisterCard,
                    cursor: isDragging ? 'grabbing' : 'grab',
                    opacity: isDragging ? 0.4 : 1,
                    transition: 'opacity 0.15s ease',
                    userSelect: 'none',
                    WebkitUserDrag: 'element',
                }}
                draggable="true"
                onDragStart={onDragStartHandler}
                onDragEnd={onDragEndHandler}
            >
                <div style={styles.canisterInfo}>
                    <div style={{ ...styles.canisterIcon, position: 'relative' }}>
                        <FaCube size={18} />
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
                    {/* Cycles badge */}
                    {cycles !== undefined && cycles !== null && (
                        <span 
                            style={{
                                ...styles.managerVersion,
                                backgroundColor: `${getCyclesColor(cycles, cycleSettings)}20`,
                                color: getCyclesColor(cycles, cycleSettings),
                                marginLeft: '8px',
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
                                backgroundColor: `${theme.colors.primary || '#3b82f6'}20`,
                                color: theme.colors.primary || '#3b82f6',
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
                                backgroundColor: `${theme.colors.mutedText || theme.colors.textSecondary}20`,
                                color: theme.colors.mutedText || theme.colors.textSecondary,
                                marginLeft: '8px',
                            }}
                        >
                            ⚡ ...
                        </span>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginLeft: 'auto' }}>
                    {/* Move to group dropdown */}
                    <select
                        onChange={(e) => {
                            if (e.target.value) {
                                const dest = e.target.value;
                                if (dest === 'wallet' || dest === 'neuron_managers') {
                                    handleMoveFromGroups(canisterId, groupId, dest);
                                } else {
                                    handleMoveCanister(canisterId, groupId, dest);
                                }
                                e.target.value = '';
                            }
                        }}
                        style={{
                            padding: '6px 8px',
                            borderRadius: '6px',
                            border: `1px solid ${theme.colors.border}`,
                            backgroundColor: theme.colors.card,
                            color: theme.colors.textSecondary,
                            fontSize: '11px',
                            cursor: 'pointer',
                            maxWidth: '110px',
                        }}
                        defaultValue=""
                    >
                        <option value="" disabled>Move to...</option>
                        <optgroup label="Special">
                            {specialDestinations.map(d => (
                                <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                        </optgroup>
                        <optgroup label="Groups">
                            {allGroups.map(g => (
                                <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                        </optgroup>
                    </select>
                    <Link
                        to={`/canister?id=${canisterId}`}
                        style={styles.viewLink}
                    >
                        View
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
                                    backgroundColor: theme.colors.card,
                                    color: theme.colors.text,
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

    const styles = {
        pageContainer: {
            minHeight: '100vh',
            backgroundColor: theme.colors.background,
            color: theme.colors.text,
        },
        container: {
            maxWidth: '900px',
            margin: '0 auto',
            padding: '24px',
        },
        title: {
            fontSize: '28px',
            fontWeight: 600,
            marginBottom: '24px',
            color: theme.colors.text,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
        },
        addSection: {
            backgroundColor: theme.colors.card,
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '24px',
            border: `1px solid ${theme.colors.border}`,
        },
        addSectionTitle: {
            fontSize: '16px',
            fontWeight: 500,
            marginBottom: '12px',
            color: theme.colors.textSecondary,
        },
        inputRow: {
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
        },
        input: {
            flex: 1,
            padding: '12px 16px',
            borderRadius: '8px',
            border: `1px solid ${theme.colors.border}`,
            backgroundColor: theme.colors.inputBackground,
            color: theme.colors.text,
            fontSize: '14px',
            fontFamily: 'monospace',
            outline: 'none',
        },
        addButton: {
            padding: '12px 20px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: (addingCanister || !newCanisterId.trim()) ? '#6c757d' : '#28a745',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 600,
            cursor: (addingCanister || !newCanisterId.trim()) ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s',
            opacity: (addingCanister || !newCanisterId.trim()) ? 0.6 : 1,
        },
        canisterList: {
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
        },
        canisterCard: {
            backgroundColor: theme.colors.card,
            borderRadius: '12px',
            padding: '12px 16px',
            border: `1px solid ${theme.colors.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            transition: 'border-color 0.2s',
            flexWrap: 'wrap',
            gap: '10px',
        },
        canisterInfo: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flex: '1 1 auto',
            minWidth: '200px',
            flexWrap: 'wrap',
        },
        canisterIcon: {
            width: '40px',
            height: '40px',
            borderRadius: '8px',
            backgroundColor: theme.colors.primary + '20',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: theme.colors.primary,
        },
        canisterId: {
            fontFamily: 'monospace',
            fontSize: '14px',
            color: theme.colors.text,
            wordBreak: 'break-all',
        },
        canisterLink: {
            color: theme.colors.primary,
            textDecoration: 'none',
            fontFamily: 'monospace',
            fontSize: '14px',
        },
        removeButton: {
            padding: '8px 12px',
            borderRadius: '6px',
            border: `1px solid ${theme.colors.border}`,
            backgroundColor: 'transparent',
            color: theme.colors.textSecondary,
            fontSize: '14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.2s',
        },
        removeButtonHover: {
            borderColor: '#dc3545',
            color: '#dc3545',
        },
        emptyState: {
            textAlign: 'center',
            padding: '48px 24px',
            backgroundColor: theme.colors.card,
            borderRadius: '12px',
            border: `1px solid ${theme.colors.border}`,
        },
        emptyIcon: {
            fontSize: '48px',
            color: theme.colors.textSecondary,
            marginBottom: '16px',
            opacity: 0.5,
        },
        emptyText: {
            fontSize: '16px',
            color: theme.colors.textSecondary,
            marginBottom: '8px',
        },
        emptySubtext: {
            fontSize: '14px',
            color: theme.colors.textSecondary,
            opacity: 0.7,
        },
        message: {
            padding: '12px 16px',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '14px',
        },
        errorMessage: {
            backgroundColor: '#dc354520',
            color: '#dc3545',
            border: '1px solid #dc354540',
        },
        successMessage: {
            backgroundColor: '#28a74520',
            color: '#28a745',
            border: '1px solid #28a74540',
        },
        loadingSpinner: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px',
            color: theme.colors.textSecondary,
        },
        notLoggedIn: {
            textAlign: 'center',
            padding: '48px 24px',
            backgroundColor: theme.colors.card,
            borderRadius: '12px',
            border: `1px solid ${theme.colors.border}`,
        },
        viewLink: {
            padding: '8px 16px',
            borderRadius: '6px',
            backgroundColor: theme.colors.primary + '15',
            color: theme.colors.primary,
            textDecoration: 'none',
            fontSize: '13px',
            fontWeight: 500,
        },
        sectionHeader: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 0',
            cursor: 'pointer',
            borderBottom: `1px solid ${theme.colors.border}`,
            marginBottom: '16px',
        },
        sectionTitle: {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '18px',
            fontWeight: 600,
            color: theme.colors.text,
        },
        sectionCount: {
            fontSize: '14px',
            fontWeight: 400,
            color: theme.colors.textSecondary,
            backgroundColor: theme.colors.primary + '15',
            padding: '2px 10px',
            borderRadius: '12px',
        },
        sectionToggle: {
            color: theme.colors.textSecondary,
            fontSize: '14px',
        },
        managerCard: {
            backgroundColor: theme.colors.card,
            borderRadius: '12px',
            padding: '12px 16px',
            border: `1px solid ${theme.colors.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            flexWrap: 'wrap',
        },
        managerInfo: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flex: '1 1 auto',
            minWidth: '200px',
            flexWrap: 'wrap',
        },
        managerIcon: {
            width: '40px',
            height: '40px',
            borderRadius: '8px',
            backgroundColor: '#8b5cf620',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#8b5cf6',
        },
        managerVersion: {
            fontSize: '11px',
            color: theme.colors.textSecondary,
            backgroundColor: theme.colors.inputBackground,
            padding: '2px 8px',
            borderRadius: '10px',
        },
    };

    return (
        <div style={styles.pageContainer}>
            <Header />
            
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
                        background: `linear-gradient(135deg, ${theme.colors.card} 0%, ${theme.colors.primaryBg} 100%)`,
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
                            background: `${theme.colors.inputBackground}`,
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
                                        <div>• Up to <strong style={{ color: theme.colors.success }}>{groupLimits.premiumMaxPerGroup}</strong> canisters per folder (vs {groupLimits.maxPerGroup})</div>
                                        <div>• Up to <strong style={{ color: theme.colors.success }}>{groupLimits.premiumMaxTotal}</strong> total canisters (vs {groupLimits.maxTotal})</div>
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
            
            <div style={styles.container}>
                <h1 style={styles.title}>
                    <FaCube /> Canister Manager
                </h1>
                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                    <Link 
                        to="/help/canister-manager" 
                        style={{ color: theme.colors.accent, fontSize: '14px', textDecoration: 'none' }}
                        onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                        onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                    >
                        Learn how it works →
                    </Link>
                </div>

                {!isAuthenticated ? (
                    <div style={styles.notLoggedIn}>
                        <div style={styles.emptyIcon}>🔒</div>
                        <div style={styles.emptyText}>Please log in to track canisters</div>
                        <div style={styles.emptySubtext}>
                            You can track any canister on the Internet Computer to quickly access its details.
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

                        {/* Add canister section */}
                        <div style={styles.addSection}>
                            <div style={styles.addSectionTitle}>Add a canister to track</div>
                            <div style={styles.inputRow}>
                                <input
                                    type="text"
                                    placeholder="Enter canister ID (e.g., ryjl3-tyaaa-aaaaa-aaaba-cai)"
                                    value={newCanisterId}
                                    onChange={(e) => setNewCanisterId(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAddCanister()}
                                    style={styles.input}
                                    disabled={addingCanister}
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

                        {/* Custom Canisters Section with Groups - Premium Feature */}
                        <div 
                            style={styles.sectionHeader}
                            onClick={() => setCustomExpanded(!customExpanded)}
                        >
                            <div style={styles.sectionTitle}>
                                {customExpanded ? <FaChevronDown /> : <FaChevronRight />}
                                <FaCube />
                                Custom Canisters
                                {getAllCanisterIds(canisterGroups).length > 0 && (
                                    <span style={styles.sectionCount}>{getAllCanisterIds(canisterGroups).length}</span>
                                )}
                                {saving && <FaSpinner className="spin" size={12} style={{ marginLeft: '8px', color: theme.colors.textSecondary }} />}
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
                                            color: theme.colors.textSecondary,
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
                                        padding: '10px 14px',
                                        backgroundColor: theme.colors.card,
                                        borderRadius: '8px',
                                        border: `1px solid ${theme.colors.border}`,
                                        marginBottom: '12px',
                                        flexWrap: 'wrap',
                                        gap: '10px',
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                                            <span style={{ color: theme.colors.textSecondary, fontSize: '13px' }}>
                                                Folders: <span style={{ 
                                                    color: groupUsage.groupCount >= groupUsage.groupLimit ? '#ef4444' : theme.colors.text,
                                                    fontWeight: 600 
                                                }}>{groupUsage.groupCount}</span> / {groupUsage.groupLimit}
                                            </span>
                                            <span style={{ color: theme.colors.textSecondary, fontSize: '13px' }}>
                                                Canisters: <span style={{ 
                                                    color: groupUsage.totalCanisters >= groupUsage.totalLimit ? '#ef4444' : theme.colors.text,
                                                    fontWeight: 600 
                                                }}>{groupUsage.totalCanisters}</span> / {groupUsage.totalLimit}
                                            </span>
                                            <span style={{ color: theme.colors.textSecondary, fontSize: '13px' }}>
                                                Per Folder: max {groupUsage.perGroupLimit}
                                            </span>
                                        </div>
                                        {groupUsage.isPremium && (
                                            <span style={{
                                                backgroundColor: '#ffd700',
                                                color: '#000',
                                                padding: '2px 8px',
                                                borderRadius: '4px',
                                                fontSize: '11px',
                                                fontWeight: 600,
                                            }}>
                                                ⭐ PREMIUM LIMITS
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
                                        <div style={styles.emptyText}>No custom canisters being tracked</div>
                                        <div style={styles.emptySubtext}>
                                            Add a canister ID above to start tracking it, or create a group to organize your canisters.
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
                                                    padding: '12px 16px',
                                                    backgroundColor: theme.colors.card,
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
                                                            color: theme.colors.text,
                                                            fontSize: '14px',
                                                        }}>
                                                            {stats.total} {stats.total === 1 ? 'Canister' : 'Canisters'}
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
                                                        
                                                        {/* Expand/Collapse All buttons */}
                                                        {canisterGroups.groups.length > 0 && (
                                                            <div style={{ 
                                                                display: 'flex', 
                                                                alignItems: 'center', 
                                                                gap: '8px',
                                                                marginLeft: '8px',
                                                                paddingLeft: '16px',
                                                                borderLeft: `1px solid ${theme.colors.border}`,
                                                            }}>
                                                                <button
                                                                    onClick={handleExpandAll}
                                                                    style={{
                                                                        padding: '4px 10px',
                                                                        borderRadius: '4px',
                                                                        border: `1px solid ${theme.colors.border}`,
                                                                        backgroundColor: 'transparent',
                                                                        color: theme.colors.textSecondary,
                                                                        fontSize: '11px',
                                                                        cursor: 'pointer',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '4px',
                                                                    }}
                                                                    title="Expand all groups"
                                                                >
                                                                    <FaChevronDown size={10} /> Expand
                                                                </button>
                                                                <button
                                                                    onClick={handleCollapseAll}
                                                                    style={{
                                                                        padding: '4px 10px',
                                                                        borderRadius: '4px',
                                                                        border: `1px solid ${theme.colors.border}`,
                                                                        backgroundColor: 'transparent',
                                                                        color: theme.colors.textSecondary,
                                                                        fontSize: '11px',
                                                                        cursor: 'pointer',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '4px',
                                                                    }}
                                                                    title="Collapse all groups"
                                                                >
                                                                    <FaChevronRight size={10} /> Collapse
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
                                                onDragStart={handleDragStart}
                                                onDragEnd={handleDragEnd}
                                                onDragEnter={handleDragEnter}
                                                onDragOver={handleDragOver}
                                                onDragLeave={handleDragLeave}
                                                onDrop={handleDrop}
                                                draggedItem={draggedItem}
                                                dragOverTarget={dragOverTarget}
                                            />
                                        ))}
                                        
                                        {/* Ungrouped Section - Drop Zone */}
                                        <div 
                                            style={{ 
                                                marginTop: canisterGroups.groups.length > 0 ? '16px' : '0',
                                                padding: draggedItem ? '8px' : '0',
                                                backgroundColor: dragOverTarget?.type === 'ungrouped' ? `${theme.colors.primary}15` : 'transparent',
                                                border: dragOverTarget?.type === 'ungrouped' ? `2px dashed ${theme.colors.primary}` : '2px dashed transparent',
                                                borderRadius: '8px',
                                                transition: 'all 0.2s ease',
                                                minHeight: draggedItem && canisterGroups.ungrouped.length === 0 ? '60px' : 'auto',
                                            }}
                                            onDragEnter={(e) => handleDragEnter(e, 'ungrouped')}
                                            onDragOver={(e) => handleDragOver(e, 'ungrouped')}
                                            onDragLeave={(e) => handleDragLeave(e, 'ungrouped')}
                                            onDrop={(e) => handleDrop(e, 'ungrouped')}
                                        >
                                            <div style={{ 
                                                fontSize: '12px', 
                                                color: theme.colors.textSecondary, 
                                                marginBottom: '8px',
                                                fontWeight: 500,
                                            }}>
                                                Ungrouped ({canisterGroups.ungrouped.length})
                                                {dragOverTarget?.type === 'ungrouped' && (
                                                    <span style={{ marginLeft: '8px', color: theme.colors.primary }}>
                                                        Drop here
                                                    </span>
                                                )}
                                            </div>
                                            {canisterGroups.ungrouped.length > 0 && (
                                                <div style={styles.canisterList}>
                                                    {canisterGroups.ungrouped.map((canisterId) => (
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
                                                            canisterGroups={canisterGroups}
                                                            handleMoveCanister={handleMoveCanister}
                                                            handleMoveFromGroups={handleMoveFromGroups}
                                                            onDragStart={handleDragStart}
                                                            onDragEnd={handleDragEnd}
                                                            isDragging={draggedItem?.type === 'canister' && draggedItem?.id === canisterId}
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {/* Wallet Section (Tracked Canisters) - Drop Zone */}
                        <div
                            onDragEnter={(e) => handleDragEnter(e, 'wallet')}
                            onDragOver={(e) => handleDragOver(e, 'wallet')}
                            onDragLeave={(e) => handleDragLeave(e, 'wallet')}
                            onDrop={(e) => handleDrop(e, 'wallet')}
                            style={{
                                backgroundColor: dragOverTarget?.type === 'wallet' ? `${theme.colors.primary}10` : 'transparent',
                                border: dragOverTarget?.type === 'wallet' ? `2px dashed ${theme.colors.primary}` : '2px dashed transparent',
                                borderRadius: '12px',
                                transition: 'all 0.2s ease',
                                padding: dragOverTarget?.type === 'wallet' ? '8px' : '0',
                                margin: dragOverTarget?.type === 'wallet' ? '-8px' : '0',
                            }}
                        >
                        <div 
                            style={styles.sectionHeader}
                            onClick={() => setWalletExpanded(!walletExpanded)}
                        >
                            <div style={styles.sectionTitle}>
                                {walletExpanded ? <FaChevronDown /> : <FaChevronRight />}
                                <span style={{ fontSize: '18px' }}>💼</span>
                                Wallet
                                {trackedCanisters.length > 0 && (
                                    <span style={styles.sectionCount}>{trackedCanisters.length}</span>
                                )}
                                {dragOverTarget?.type === 'wallet' && (
                                    <span style={{ marginLeft: '8px', color: theme.colors.primary, fontSize: '12px' }}>
                                        Drop here to add to wallet
                                    </span>
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
                                    color: theme.colors.textSecondary,
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
                                {/* Add canister input */}
                                <div style={{ ...styles.addSection, marginBottom: '16px' }}>
                                    <div style={styles.addSectionTitle}>Add canister to wallet</div>
                                    <div style={styles.inputRow}>
                                        <input
                                            type="text"
                                            placeholder="Enter canister ID"
                                            value={newWalletCanisterId}
                                            onChange={(e) => {
                                                setNewWalletCanisterId(e.target.value);
                                                setWalletCanisterError(null);
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && newWalletCanisterId.trim()) {
                                                    handleAddWalletCanister();
                                                }
                                            }}
                                            style={styles.input}
                                            disabled={addingWalletCanister}
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
                                        <div style={styles.emptyText}>No canisters in wallet</div>
                                        <div style={styles.emptySubtext}>
                                            Add a canister ID above to track it in your wallet.
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
                                                    backgroundColor: theme.colors.card,
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
                                                            color: theme.colors.text,
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
                                                const displayInfo = getPrincipalDisplayInfoFromContext(canisterId, principalNames, principalNicknames);
                                                const status = trackedCanisterStatus[canisterId];
                                                const cycles = status?.cycles;
                                                const memory = status?.memory;
                                                const isController = status?.isController;
                                                const isConfirming = confirmRemoveWalletCanister === canisterId;
                                                const isRemoving = removingWalletCanister === canisterId;
                                                
                                                // Get health status for this canister
                                                const canisterHealth = getCanisterHealthStatus(canisterId, trackedCanisterStatus, cycleSettings);
                                                const canisterLampColor = getStatusLampColor(canisterHealth);
                                                
                                                // Build move destinations
                                                const collectGroups = (groups, prefix = '') => {
                                                    let result = [];
                                                    for (const g of groups) {
                                                        result.push({ id: g.id, name: prefix + g.name });
                                                        result = result.concat(collectGroups(g.subgroups, prefix + g.name + ' / '));
                                                    }
                                                    return result;
                                                };
                                                const allMoveDestinations = [
                                                    { id: 'ungrouped', name: 'Ungrouped' },
                                                    ...collectGroups(canisterGroups.groups)
                                                ];

                                                return (
                                                    <div 
                                                        key={canisterId} 
                                                        style={{
                                                            ...styles.canisterCard,
                                                            cursor: draggedItem?.type === 'canister' && draggedItem?.id === canisterId ? 'grabbing' : 'grab',
                                                            opacity: draggedItem?.type === 'canister' && draggedItem?.id === canisterId ? 0.4 : 1,
                                                            transition: 'opacity 0.15s ease',
                                                            userSelect: 'none',
                                                            WebkitUserDrag: 'element',
                                                        }}
                                                        draggable="true"
                                                        onDragStart={(e) => handleDragStart(e, 'canister', canisterId, 'wallet')}
                                                        onDragEnd={handleDragEnd}
                                                    >
                                                        <div style={styles.canisterInfo}>
                                                            {/* Health status lamp */}
                                                            <span
                                                                style={{
                                                                    width: '8px',
                                                                    height: '8px',
                                                                    borderRadius: '50%',
                                                                    backgroundColor: canisterLampColor,
                                                                    boxShadow: canisterHealth !== 'unknown' ? `0 0 6px ${canisterLampColor}` : 'none',
                                                                    flexShrink: 0,
                                                                }}
                                                                title={`Health: ${canisterHealth}`}
                                                            />
                                                            <div style={{ ...styles.canisterIcon, position: 'relative' }}>
                                                                <FaCube size={18} />
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
                                                            {/* Cycles badge */}
                                                            {cycles !== undefined && cycles !== null && (
                                                                <span 
                                                                    style={{
                                                                        ...styles.managerVersion,
                                                                        backgroundColor: `${getCyclesColor(cycles, cycleSettings)}20`,
                                                                        color: getCyclesColor(cycles, cycleSettings),
                                                                        marginLeft: '8px',
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
                                                                        backgroundColor: `${theme.colors.primary || '#3b82f6'}20`,
                                                                        color: theme.colors.primary || '#3b82f6',
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
                                                                        backgroundColor: `${theme.colors.mutedText || theme.colors.textSecondary}20`,
                                                                        color: theme.colors.mutedText || theme.colors.textSecondary,
                                                                        marginLeft: '8px',
                                                                    }}
                                                                >
                                                                    ⚡ ...
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                            {/* Move to dropdown */}
                                                            <select
                                                                onChange={(e) => {
                                                                    if (e.target.value) {
                                                                        handleMoveFromWallet(canisterId, e.target.value);
                                                                        e.target.value = '';
                                                                    }
                                                                }}
                                                                style={{
                                                                    padding: '6px 8px',
                                                                    borderRadius: '6px',
                                                                    border: `1px solid ${theme.colors.border}`,
                                                                    backgroundColor: theme.colors.card,
                                                                    color: theme.colors.textSecondary,
                                                                    fontSize: '11px',
                                                                    cursor: 'pointer',
                                                                    maxWidth: '110px',
                                                                }}
                                                                defaultValue=""
                                                            >
                                                                <option value="" disabled>Move to...</option>
                                                                <optgroup label="Special">
                                                                    <option value="neuron_managers">🧠 Neuron Managers</option>
                                                                </optgroup>
                                                                <optgroup label="Groups">
                                                                    {allMoveDestinations.map(g => (
                                                                        <option key={g.id} value={g.id}>{g.name}</option>
                                                                    ))}
                                                                </optgroup>
                                                            </select>
                                                            <Link
                                                                to={`/canister?id=${canisterId}`}
                                                                style={styles.viewLink}
                                                            >
                                                                View
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
                                                                            backgroundColor: theme.colors.card,
                                                                            color: theme.colors.text,
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
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                        </div>

                        {/* ICP Neuron Managers Section - Drop Zone */}
                        <div
                            onDragEnter={(e) => handleDragEnter(e, 'neuron_managers')}
                            onDragOver={(e) => handleDragOver(e, 'neuron_managers')}
                            onDragLeave={(e) => handleDragLeave(e, 'neuron_managers')}
                            onDrop={(e) => handleDrop(e, 'neuron_managers')}
                            style={{
                                backgroundColor: dragOverTarget?.type === 'neuron_managers' ? `${theme.colors.primary}10` : 'transparent',
                                border: dragOverTarget?.type === 'neuron_managers' ? `2px dashed ${theme.colors.primary}` : '2px dashed transparent',
                                borderRadius: '12px',
                                transition: 'all 0.2s ease',
                                padding: dragOverTarget?.type === 'neuron_managers' ? '8px' : '0',
                                margin: dragOverTarget?.type === 'neuron_managers' ? '-8px' : '0',
                            }}
                        >
                        <div 
                            style={styles.sectionHeader}
                            onClick={() => setNeuronManagersExpanded(!neuronManagersExpanded)}
                        >
                            <div style={styles.sectionTitle}>
                                {neuronManagersExpanded ? <FaChevronDown /> : <FaChevronRight />}
                                <FaBrain style={{ color: '#8b5cf6' }} />
                                ICP Neuron Managers
                                {neuronManagers.length > 0 && (
                                    <span style={styles.sectionCount}>{neuronManagers.length}</span>
                                )}
                                {dragOverTarget?.type === 'neuron_managers' && (
                                    <span style={{ marginLeft: '8px', color: theme.colors.primary, fontSize: '12px' }}>
                                        Drop here to add as manager
                                    </span>
                                )}
                            </div>
                            <Link 
                                to="/create_icp_neuron"
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                    padding: '6px 12px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    backgroundColor: '#8b5cf6',
                                    color: '#fff',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    textDecoration: 'none',
                                }}
                            >
                                <FaPlus size={10} /> Create
                            </Link>
                        </div>
                        
                        {neuronManagersExpanded && (
                            <>
                                {/* Add existing manager input */}
                                <div style={{ ...styles.addSection, marginBottom: '16px' }}>
                                    <div style={styles.addSectionTitle}>Add existing manager</div>
                                    <div style={styles.inputRow}>
                                        <input
                                            type="text"
                                            placeholder="Enter neuron manager canister ID"
                                            value={newManagerId}
                                            onChange={(e) => {
                                                setNewManagerId(e.target.value);
                                                setManagerError(null);
                                            }}
                                            onKeyDown={(e) => e.key === 'Enter' && handleAddManager()}
                                            style={styles.input}
                                            disabled={addingManager}
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
                                        <div style={styles.emptyText}>No ICP Neuron Managers</div>
                                        <div style={styles.emptySubtext}>
                                            <Link to="/create_icp_neuron" style={{ color: theme.colors.primary }}>
                                                Create your first neuron manager →
                                            </Link>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {/* Manager Health Summary */}
                                        {(() => {
                                            const stats = getManagersHealthStats(neuronManagers, cycleSettings);
                                            const overallColor = getStatusLampColor(stats.overallStatus);
                                            
                                            return (
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    padding: '12px 16px',
                                                    backgroundColor: theme.colors.card,
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
                                                            color: theme.colors.text,
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
                                            const displayInfo = getPrincipalDisplayInfoFromContext(canisterId, principalNames, principalNicknames);
                                            const managerHealth = getManagerHealthStatus(manager, cycleSettings);
                                            const managerLampColor = getStatusLampColor(managerHealth);
                                            
                                            // Build move destinations for neuron managers
                                            const collectGroups = (groups, prefix = '') => {
                                                let result = [];
                                                for (const g of groups) {
                                                    result.push({ id: g.id, name: prefix + g.name });
                                                    result = result.concat(collectGroups(g.subgroups, prefix + g.name + ' / '));
                                                }
                                                return result;
                                            };
                                            const managerMoveDestinations = [
                                                { id: 'ungrouped', name: 'Ungrouped' },
                                                ...collectGroups(canisterGroups.groups)
                                            ];
                                            
                                            return (
                                                <div 
                                                    key={canisterId} 
                                                    style={{
                                                        ...styles.managerCard,
                                                        cursor: draggedItem?.type === 'canister' && draggedItem?.id === canisterId ? 'grabbing' : 'grab',
                                                        opacity: draggedItem?.type === 'canister' && draggedItem?.id === canisterId ? 0.4 : 1,
                                                        transition: 'opacity 0.15s ease',
                                                        userSelect: 'none',
                                                        WebkitUserDrag: 'element',
                                                    }}
                                                    draggable="true"
                                                    onDragStart={(e) => handleDragStart(e, 'canister', canisterId, 'neuron_managers')}
                                                    onDragEnd={handleDragEnd}
                                                >
                                                    <div style={styles.managerInfo}>
                                                        {/* Health status lamp */}
                                                        <span
                                                            style={{
                                                                width: '8px',
                                                                height: '8px',
                                                                borderRadius: '50%',
                                                                backgroundColor: managerLampColor,
                                                                boxShadow: managerHealth !== 'unknown' ? `0 0 6px ${managerLampColor}` : 'none',
                                                                flexShrink: 0,
                                                            }}
                                                            title={`Health: ${managerHealth}${isVersionOutdated(manager.version) ? ' (outdated version)' : ''}`}
                                                        />
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
                                                                    v{Number(manager.version.major)}.{Number(manager.version.minor)}.{Number(manager.version.patch)}
                                                                </span>
                                                                <span style={{
                                                                    ...styles.managerVersion,
                                                                    backgroundColor: manager.neuronCount > 0 ? '#8b5cf620' : theme.colors.inputBackground,
                                                                    color: manager.neuronCount > 0 ? '#8b5cf6' : theme.colors.textSecondary,
                                                                }}>
                                                                    🧠 {manager.neuronCount} neuron{manager.neuronCount !== 1 ? 's' : ''}
                                                                </span>
                                                                {manager.cycles !== null && (
                                                                    <span 
                                                                        style={{
                                                                            ...styles.managerVersion,
                                                                            backgroundColor: `${getCyclesColor(manager.cycles, cycleSettings)}20`,
                                                                            color: getCyclesColor(manager.cycles, cycleSettings),
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
                                                                            backgroundColor: `${theme.colors.primary || '#3b82f6'}20`,
                                                                            color: theme.colors.primary || '#3b82f6',
                                                                        }}
                                                                        title={`${manager.memory.toLocaleString()} bytes`}
                                                                    >
                                                                        💾 {formatMemory(manager.memory)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                        {/* Move to dropdown */}
                                                        <select
                                                            onChange={(e) => {
                                                                e.stopPropagation();
                                                                if (e.target.value) {
                                                                    handleMoveFromNeuronManagers(manager.canisterId, e.target.value);
                                                                    e.target.value = '';
                                                                }
                                                            }}
                                                            onClick={(e) => e.stopPropagation()}
                                                            style={{
                                                                padding: '6px 8px',
                                                                borderRadius: '6px',
                                                                border: `1px solid ${theme.colors.border}`,
                                                                backgroundColor: theme.colors.card,
                                                                color: theme.colors.textSecondary,
                                                                fontSize: '11px',
                                                                cursor: 'pointer',
                                                                maxWidth: '110px',
                                                            }}
                                                            defaultValue=""
                                                        >
                                                            <option value="" disabled>Move to...</option>
                                                            <optgroup label="Special">
                                                                <option value="wallet">💼 Wallet</option>
                                                            </optgroup>
                                                            <optgroup label="Groups">
                                                                {managerMoveDestinations.map(g => (
                                                                    <option key={g.id} value={g.id}>{g.name}</option>
                                                                ))}
                                                            </optgroup>
                                                        </select>
                                                        <Link
                                                            to={`/icp_neuron_manager/${canisterId}`}
                                                            style={{
                                                                ...styles.viewLink,
                                                                backgroundColor: '#8b5cf615',
                                                                color: '#8b5cf6',
                                                            }}
                                                        >
                                                            Manage
                                                        </Link>
                                                        <Link
                                                            to={`/canister?id=${canisterId}`}
                                                            style={styles.viewLink}
                                                        >
                                                            Details
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
                                                                title="Remove from list (does not delete canister)"
                                                            >
                                                                {removingManager === canisterId ? (
                                                                    <FaSpinner className="spin" />
                                                                ) : (
                                                                    <FaTrash />
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    </>
                                )}
                            </>
                        )}
                        </div>
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
        </div>
    );
}

