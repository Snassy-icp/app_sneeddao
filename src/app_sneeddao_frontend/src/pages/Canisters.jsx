import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { Principal } from '@dfinity/principal';
import { HttpAgent, Actor } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { getCanisterGroups, setCanisterGroups, convertGroupsFromBackend } from '../utils/BackendUtils';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { useNaming } from '../NamingContext';
import { FaPlus, FaTrash, FaCube, FaSpinner, FaChevronDown, FaChevronRight, FaBrain, FaFolder, FaFolderOpen, FaEdit, FaCheck, FaTimes, FaCrown, FaLock } from 'react-icons/fa';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneed_icp_neuron_manager_factory';
import { createActor as createManagerActor } from 'declarations/sneed_icp_neuron_manager';
import { getCyclesColor, formatCyclesCompact, getNeuronManagerSettings } from '../utils/NeuronManagerSettings';
import { useSneedMembership } from '../hooks/useSneedMembership';
import { SneedMemberGateMessage, SneedMemberGateLoading, SneedMemberBadge, GATE_TYPES } from '../components/SneedMemberGate';

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
    
    // Sneed membership for premium features
    const { 
        isSneedMember, 
        sneedNeurons, 
        sneedVotingPower, 
        loading: loadingSneedMembership 
    } = useSneedMembership();
    
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
            await setCanisterGroups(identity, newGroups);
            setCanisterGroupsState(newGroups);
        } catch (err) {
            console.error('Error saving canister groups:', err);
            setError('Failed to save changes');
            throw err;  // Re-throw so callers know save failed
        } finally {
            setSaving(false);
        }
    }, [identity]);
    
    // Persist collapsible states
    useEffect(() => {
        try { localStorage.setItem('canisters_customExpanded', JSON.stringify(customExpanded)); } catch {}
    }, [customExpanded]);
    
    useEffect(() => {
        try { localStorage.setItem('canisters_neuronManagersExpanded', JSON.stringify(neuronManagersExpanded)); } catch {}
    }, [neuronManagersExpanded]);

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

    // Recursive component for rendering a group
    const GroupComponent = ({ 
        group, depth, styles, theme, expandedGroups, setExpandedGroups,
        editingGroup, setEditingGroup, editingGroupName, setEditingGroupName,
        handleRenameGroup, handleDeleteGroup, canisterStatus, cycleSettings,
        principalNames, principalNicknames, isAuthenticated,
        confirmRemoveCanister, setConfirmRemoveCanister, handleRemoveCanister,
        canisterGroups, handleMoveCanister,
        // New props for subgroups and adding canisters
        newSubgroupParent, setNewSubgroupParent, newSubgroupName, setNewSubgroupName,
        handleCreateSubgroup, addingCanisterToGroupId, setAddingCanisterToGroupId,
        newCanisterForGroup, setNewCanisterForGroup, handleAddCanisterToGroup
    }) => {
        const isExpanded = expandedGroups[group.id] ?? true;
        const isEditing = editingGroup === group.id;
        const isAddingSubgroup = newSubgroupParent === group.id;
        const isAddingCanister = addingCanisterToGroupId === group.id;
        const totalCanisters = group.canisters.length + 
            group.subgroups.reduce((sum, sg) => sum + sg.canisters.length, 0);

        return (
            <div style={{ 
                marginBottom: '8px',
                marginLeft: depth > 0 ? '20px' : '0',
            }}>
                {/* Group Header */}
                <div 
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        backgroundColor: theme.colors.card,
                        borderRadius: '8px',
                        border: `1px solid ${theme.colors.border}`,
                        cursor: 'pointer',
                    }}
                    onClick={() => setExpandedGroups(prev => ({ ...prev, [group.id]: !isExpanded }))}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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

    // Component for rendering a single canister card
    const CanisterCard = ({ 
        canisterId, groupId, styles, theme, canisterStatus, cycleSettings,
        principalNames, principalNicknames, isAuthenticated,
        confirmRemoveCanister, setConfirmRemoveCanister, handleRemoveCanister,
        canisterGroups, handleMoveCanister
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

        return (
            <div style={styles.canisterCard}>
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
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {/* Move to group dropdown */}
                    {allGroups.length > 0 && (
                        <select
                            onChange={(e) => {
                                if (e.target.value) {
                                    handleMoveCanister(canisterId, groupId, e.target.value);
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
                            }}
                            defaultValue=""
                        >
                            <option value="" disabled>Move to...</option>
                            {allGroups.map(g => (
                                <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                        </select>
                    )}
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
            padding: '16px 20px',
            border: `1px solid ${theme.colors.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            transition: 'border-color 0.2s',
        },
        canisterInfo: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flex: 1,
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
            padding: '16px 20px',
            border: `1px solid ${theme.colors.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
        },
        managerInfo: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flex: 1,
            minWidth: '200px',
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
            <div style={styles.container}>
                <h1 style={styles.title}>
                    <FaCube /> Tracked Canisters
                </h1>

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
                                {!isSneedMember && (
                                    <FaCrown size={12} style={{ color: theme.colors.warning || '#f59e0b', marginLeft: '6px' }} title="Premium Feature" />
                                )}
                                {isSneedMember && getAllCanisterIds(canisterGroups).length > 0 && (
                                    <span style={styles.sectionCount}>{getAllCanisterIds(canisterGroups).length}</span>
                                )}
                                {saving && <FaSpinner className="spin" size={12} style={{ marginLeft: '8px', color: theme.colors.textSecondary }} />}
                            </div>
                            {isSneedMember && (
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
                            )}
                        </div>
                        
                        {customExpanded && (
                            <>
                                {/* Membership gating for Custom Canisters */}
                                {loadingSneedMembership ? (
                                    <SneedMemberGateLoading />
                                ) : !isSneedMember ? (
                                    <SneedMemberGateMessage 
                                        gateType={GATE_TYPES.PREMIUM}
                                        featureName="Custom Canisters"
                                    />
                                ) : (
                                    <>
                                        {/* Sneed Member Badge */}
                                        <SneedMemberBadge 
                                            sneedNeurons={sneedNeurons}
                                            sneedVotingPower={sneedVotingPower}
                                        />
                                        
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
                                            />
                                        ))}
                                        
                                        {/* Render Ungrouped Canisters */}
                                        {canisterGroups.ungrouped.length > 0 && (
                                            <div style={{ marginTop: canisterGroups.groups.length > 0 ? '16px' : '0' }}>
                                                <div style={{ 
                                                    fontSize: '12px', 
                                                    color: theme.colors.textSecondary, 
                                                    marginBottom: '8px',
                                                    fontWeight: 500,
                                                }}>
                                                    Ungrouped ({canisterGroups.ungrouped.length})
                                                </div>
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
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                                    </>
                                )}
                            </>
                        )}

                        {/* ICP Neuron Managers Section */}
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
                                    <div style={styles.canisterList}>
                                        {neuronManagers.map((manager) => {
                                            const canisterId = manager.canisterId.toText();
                                            const displayInfo = getPrincipalDisplayInfoFromContext(canisterId, principalNames, principalNicknames);
                                            
                                            return (
                                                <div 
                                                    key={canisterId} 
                                                    style={styles.managerCard}
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
                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
                                )}
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
        </div>
    );
}

