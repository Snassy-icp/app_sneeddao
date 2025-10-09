import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { useAuth } from './AuthContext';
import { useSns } from './contexts/SnsContext';
import Header from './components/Header';
import './Wallet.css';
import { fetchAndCacheSnsData, getSnsById, getAllSnses, clearSnsCache } from './utils/SnsUtils';
import { formatProposalIdLink, uint8ArrayToHex, getNeuronColor, getOwnerPrincipals, formatNeuronIdLink } from './utils/NeuronUtils';
import { useNaming } from './NamingContext';
import { useTheme } from './contexts/ThemeContext';
import { setNeuronNickname } from './utils/BackendUtils';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from './utils/PrincipalUtils';
import { Principal } from '@dfinity/principal';
import { calculateVotingPower, formatVotingPower } from './utils/VotingPowerUtils';
import NeuronInput from './components/NeuronInput';
import NeuronDisplay from './components/NeuronDisplay';

// Add keyframes for spin animation after imports
const spinKeyframes = `
@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
`;

function Neuron() {
    const { theme } = useTheme();
    const { isAuthenticated, identity } = useAuth();
    const { selectedSnsRoot, updateSelectedSns, SNEED_SNS_ROOT } = useSns();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const [neuronIdInput, setNeuronIdInput] = useState(searchParams.get('neuronid') || '');
    const [currentNeuronId, setCurrentNeuronId] = useState(searchParams.get('neuronid') || '');
    const [snsList, setSnsList] = useState([]);
    const [neuronData, setNeuronData] = useState(null);
    const [votingHistory, setVotingHistory] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingSnses, setLoadingSnses] = useState(true);
    // Add filter states
    const [hideYes, setHideYes] = useState(false);
    const [hideNo, setHideNo] = useState(false);
    const [hideNotVoted, setHideNotVoted] = useState(false);
    // Add sort state
    const [sortBy, setSortBy] = useState('proposalId');
    // Add voting history collapse state
    const [isVotingHistoryExpanded, setIsVotingHistoryExpanded] = useState(false);
    // Add nickname editing states
    const [isEditingNickname, setIsEditingNickname] = useState(false);
    const [nicknameInput, setNicknameInput] = useState('');
    const [inputError, setInputError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    // Add principal display info state
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    // Add nervous system parameters state
    const [nervousSystemParameters, setNervousSystemParameters] = useState(null);
    const [actionBusy, setActionBusy] = useState(false);
    const [actionMsg, setActionMsg] = useState('');
    const [managePrincipalInput, setManagePrincipalInput] = useState('');
    const [selectedPermissions, setSelectedPermissions] = useState({
        unspecified: false,
        configureDissolveState: true,
        managePrincipals: true,
        submitProposal: true,
        vote: true,
        disburse: false,
        split: false,
        mergeMaturity: false,
        disburseMaturity: false,
        stakeMaturity: false,
        manageVotingPermission: true
    });
    const [editingPrincipal, setEditingPrincipal] = useState(null);
    const [topicInput, setTopicInput] = useState('Governance');
    const [followeeInput, setFolloweeInput] = useState('');
    const [followeeAliasInput, setFolloweeAliasInput] = useState('');
    const [bulkMode, setBulkMode] = useState(null); // null = single, 'neurons' = bulk neurons, 'topics' = bulk topics
    const [bulkFolloweeInput, setBulkFolloweeInput] = useState('');
    const [bulkTopicsNeuronId, setBulkTopicsNeuronId] = useState('');
    const [bulkTopicsAlias, setBulkTopicsAlias] = useState('');
    const [selectedTopics, setSelectedTopics] = useState({
        Governance: true,
        DaoCommunitySettings: false,
        SnsFrameworkManagement: false,
        DappCanisterManagement: false,
        ApplicationBusinessLogic: false,
        TreasuryAssetManagement: false,
        CriticalDappOperations: false
    });
    const [isPermissionsExpanded, setIsPermissionsExpanded] = useState(false);
    const [isFolloweesExpanded, setIsFolloweesExpanded] = useState(false);
    
    // Get naming context
    const { neuronNames, neuronNicknames, verifiedNames, fetchAllNames, principalNames, principalNicknames } = useNaming();

    // Listen for URL parameter changes and sync with global state
    useEffect(() => {
        const snsParam = searchParams.get('sns');
        if (snsParam && snsParam !== selectedSnsRoot) {
            updateSelectedSns(snsParam);
        }
    }, [searchParams, selectedSnsRoot, updateSelectedSns]);

    // Listen for neuron ID parameter changes
    useEffect(() => {
        const neuronIdParam = searchParams.get('neuronid');
        console.log('URL neuron ID changed:', { neuronIdParam, currentNeuronId });
        
        if (neuronIdParam && neuronIdParam !== currentNeuronId) {
            console.log('Navigating to new neuron:', neuronIdParam);
            
            // Clear previous data when navigating to a new neuron
            setNeuronData(null);
            setVotingHistory(null);
            setError('');
            setPrincipalDisplayInfo(new Map());
            
            setCurrentNeuronId(neuronIdParam);
            setNeuronIdInput(neuronIdParam);
        }
    }, [searchParams, currentNeuronId]);

    // Helper function to get display name
    const getDisplayName = (neuronId) => {
        const mapKey = `${selectedSnsRoot}:${neuronId}`;
        
        // Convert arrays to Maps for easier lookup
        const namesMap = new Map(Array.from(neuronNames.entries()));
        const nicknamesMap = new Map(Array.from(neuronNicknames.entries()));
        const verifiedMap = new Map(Array.from(verifiedNames.entries()));

        // Get values from maps
        const name = namesMap.get(mapKey);
        const nickname = nicknamesMap.get(mapKey);
        const isVerified = verifiedMap.get(mapKey);

        console.log('Getting display name for:', {
            neuronId,
            mapKey,
            name,
            nickname,
            isVerified,
            allNames: Array.from(namesMap.entries()),
            allNicknames: Array.from(nicknamesMap.entries()),
            allVerified: Array.from(verifiedMap.entries())
        });

        return { name, nickname, isVerified };
    };

    // Add filter and sort function
    const filterAndSortVotes = (votes) => {
        if (!votes) return [];
        const filtered = votes.filter(vote => {
            if (vote.vote === 1 && hideYes) return false;
            if (vote.vote === 2 && hideNo) return false;
            if (vote.vote !== 1 && vote.vote !== 2 && hideNotVoted) return false;
            return true;
        });

        return filtered.sort((a, b) => {
            switch (sortBy) {
                case 'proposalId':
                    return Number(b.proposal_id) - Number(a.proposal_id);
                case 'date':
                    return Number(b.timestamp) - Number(a.timestamp);
                case 'votingPower':
                    return Number(b.voting_power) - Number(a.voting_power);
                default:
                    return 0;
            }
        });
    };

    // Fetch SNS data on component mount
    useEffect(() => {
        async function loadSnsData() {
            console.log('Starting loadSnsData in Neuron component...'); // Debug log
            setLoadingSnses(true);
            try {
                console.log('Calling fetchAndCacheSnsData...'); // Debug log
                const data = await fetchAndCacheSnsData(identity);
                console.log('Received SNS data:', data); // Debug log
                setSnsList(data);
                
                // Fetch all names when component mounts
                console.log('Fetching all names on mount...');
                await fetchAllNames();
                console.log('Names after mount fetch:', {
                    names: Array.from(neuronNames.entries()),
                    nicknames: Array.from(neuronNicknames.entries()),
                    verified: Array.from(verifiedNames.entries())
                });
            } catch (err) {
                console.error('Error loading SNS data:', err);
                setError('Failed to load SNS list');
            } finally {
                setLoadingSnses(false);
            }
        }

        if (isAuthenticated) {
            console.log('User is authenticated, loading SNS data...'); // Debug log
            loadSnsData();
        } else {
            console.log('User is not authenticated'); // Debug log
        }
    }, [isAuthenticated, identity]);

    useEffect(() => {
        if (currentNeuronId && selectedSnsRoot) {
            fetchNeuronData();
            // If this is a Sneed neuron, also fetch its voting history
            if (selectedSnsRoot === SNEED_SNS_ROOT) {
                fetchVotingHistory();
            }
        }
    }, [currentNeuronId, selectedSnsRoot]);

    const fetchNeuronData = async () => {
        setLoading(true);
        setError('');
        try {
            const selectedSns = getSnsById(selectedSnsRoot);
            if (!selectedSns) {
                setError('Selected SNS not found');
                return;
            }

            const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                agentOptions: {
                    identity,
                },
            });

            // Convert the hex string neuron ID back to a byte array
            const neuronIdBytes = new Uint8Array(
                currentNeuronId.match(/.{1,2}/g)
                    .map(byte => parseInt(byte, 16))
            );
            
            const neuronIdArg = {
                neuron_id: [{ id: Array.from(neuronIdBytes) }]
            };

            const response = await snsGovActor.get_neuron(neuronIdArg);
            if (response?.result?.[0]?.Neuron) {
                setNeuronData(response.result[0].Neuron);
                // Fetch all names to ensure we have the latest data
                console.log('Fetching all names after getting neuron data...');
                await fetchAllNames();
                console.log('Names after neuron data fetch:', {
                    names: Array.from(neuronNames.entries()),
                    nicknames: Array.from(neuronNicknames.entries()),
                    verified: Array.from(verifiedNames.entries())
                });
            } else if (response?.result?.[0]?.Error) {
                setError(response.result[0].Error.error_message);
            } else {
                setError('Neuron not found');
            }
        } catch (err) {
            console.error('Error fetching neuron data:', err);
            setError('Failed to fetch neuron data');
        } finally {
            setLoading(false);
        }
    };

    const fetchVotingHistory = async () => {
        try {
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            
            // Convert the hex string neuron ID back to a byte array
            const neuronIdBytes = new Uint8Array(
                currentNeuronId.match(/.{1,2}/g)
                    .map(byte => parseInt(byte, 16))
            );
            
            const history = await rllActor.get_neuron_voting_history(Array.from(neuronIdBytes));
            setVotingHistory(history);
        } catch (err) {
            console.error('Error fetching voting history:', err);
            setVotingHistory([]);
        }
    };

    // Helper to validate neuron ID format (same as NeuronInput component)
    const isValidNeuronId = (neuronIdStr) => {
        if (!neuronIdStr || typeof neuronIdStr !== 'string') return false;
        
        // Check if it's a hex string (with or without 0x prefix)
        const hexPattern = /^(0x)?[0-9a-fA-F]+$/;
        if (hexPattern.test(neuronIdStr)) {
            const cleanHex = neuronIdStr.replace(/^0x/, '');
            // Should be even length and reasonable length (not too short or too long)
            return cleanHex.length >= 16 && cleanHex.length <= 128 && cleanHex.length % 2 === 0;
        }
        
        return false;
    };

    const handleSearch = (e) => {
        if (e) e.preventDefault();
        setError('');
        
        if (!neuronIdInput.trim()) {
            setError('Please enter a neuron ID');
            return;
        }

        if (!selectedSnsRoot) {
            setError('Please select an SNS');
            return;
        }

        // Update URL and trigger search
        setSearchParams({ neuronid: neuronIdInput, sns: selectedSnsRoot });
        setCurrentNeuronId(neuronIdInput);
    };

    // Auto-search when valid neuron ID is entered
    useEffect(() => {
        const trimmedInput = neuronIdInput.trim();
        
        if (trimmedInput && selectedSnsRoot && isValidNeuronId(trimmedInput)) {
            // Debounce the search to avoid too frequent calls
            const timeoutId = setTimeout(() => {
                setError('');
                setSearchParams({ neuronid: trimmedInput, sns: selectedSnsRoot });
                setCurrentNeuronId(trimmedInput);
            }, 500);
            
            return () => clearTimeout(timeoutId);
        }
    }, [neuronIdInput, selectedSnsRoot, setSearchParams]);

    const handleSnsChange = (newSnsRoot) => {
        // Update global context
        updateSelectedSns(newSnsRoot);
        
        // Update URL parameters
        setSearchParams(prev => {
            prev.set('sns', newSnsRoot);
            if (currentNeuronId) {
                prev.set('neuronid', currentNeuronId);
            }
            return prev;
        });
    };

    const formatE8s = (e8s) => {
        return (Number(e8s) / 100000000).toFixed(8);
    };

    const getDissolveState = (neuron) => {
        if (!neuron.dissolve_state?.[0]) return 'Unknown';
        
        if ('DissolveDelaySeconds' in neuron.dissolve_state[0]) {
            const seconds = Number(neuron.dissolve_state[0].DissolveDelaySeconds);
            const days = Math.floor(seconds / (24 * 60 * 60));
            return `Locked for ${days} days`;
        }
        
        if ('WhenDissolvedTimestampSeconds' in neuron.dissolve_state[0]) {
            const dissolveTime = Number(neuron.dissolve_state[0].WhenDissolvedTimestampSeconds);
            const now = Math.floor(Date.now() / 1000);
            if (dissolveTime <= now) {
                return 'Dissolved';
            }
            const daysLeft = Math.floor((dissolveTime - now) / (24 * 60 * 60));
            return `Dissolving (${daysLeft} days left)`;
        }
        
        return 'Unknown';
    };

    const selectedSns = getSnsById(selectedSnsRoot);

    const currentUserHasPermission = (permInt) => {
        if (!neuronData || !identity) return false;
        const me = identity.getPrincipal()?.toString();
        return neuronData.permissions?.some(p => p.principal?.toString() === me && p.permission_type?.includes(permInt));
    };

    // SNS permission ints and metadata
    // Based on official SNS governance neuron permission types (all 11 types)
    // Reference: @dfinity/sns SnsNeuronPermissionType enum
    // Official source: https://github.com/dfinity/ic/blob/master/rs/sns/governance/proto/ic_sns_governance.proto
    // See NeuronPermissionType enum definition
    const PERM = {
        UNSPECIFIED: 0,
        CONFIGURE_DISSOLVE_STATE: 1,
        MANAGE_PRINCIPALS: 2,
        SUBMIT_PROPOSAL: 3,
        VOTE: 4,
        DISBURSE: 5,
        SPLIT: 6,
        MERGE_MATURITY: 7,
        DISBURSE_MATURITY: 8,
        STAKE_MATURITY: 9,
        MANAGE_VOTING_PERMISSION: 10
    };

    const PERMISSION_INFO = {
        unspecified: {
            value: PERM.UNSPECIFIED,
            label: 'Unspecified',
            icon: '❓',
            description: 'Legacy/unspecified permission (typically only on neuron creator)'
        },
        configureDissolveState: {
            value: PERM.CONFIGURE_DISSOLVE_STATE,
            label: 'Configure Dissolve State',
            icon: '⏱️',
            description: 'Start/stop dissolving, change dissolve delay'
        },
        managePrincipals: {
            value: PERM.MANAGE_PRINCIPALS,
            label: 'Manage Principals',
            icon: '👥',
            description: 'Add or remove principals and manage their permissions'
        },
        submitProposal: {
            value: PERM.SUBMIT_PROPOSAL,
            label: 'Submit Proposals',
            icon: '📝',
            description: 'Create and submit new proposals'
        },
        vote: {
            value: PERM.VOTE,
            label: 'Vote',
            icon: '🗳️',
            description: 'Vote on proposals (hotkey access)'
        },
        disburse: {
            value: PERM.DISBURSE,
            label: 'Disburse',
            icon: '💰',
            description: 'Disburse neuron stake to account'
        },
        split: {
            value: PERM.SPLIT,
            label: 'Split Neuron',
            icon: '✂️',
            description: 'Split neuron into multiple neurons'
        },
        mergeMaturity: {
            value: PERM.MERGE_MATURITY,
            label: 'Merge Maturity',
            icon: '🔗',
            description: 'Merge maturity into stake'
        },
        disburseMaturity: {
            value: PERM.DISBURSE_MATURITY,
            label: 'Disburse Maturity',
            icon: '💸',
            description: 'Disburse maturity to account'
        },
        stakeMaturity: {
            value: PERM.STAKE_MATURITY,
            label: 'Stake Maturity',
            icon: '🎯',
            description: 'Stake maturity for increased voting power'
        },
        manageVotingPermission: {
            value: PERM.MANAGE_VOTING_PERMISSION,
            label: 'Manage Voting Permission',
            icon: '🔐',
            description: 'Manage followees and voting settings'
        }
    };

    const manageNeuron = async (command) => {
        if (!selectedSnsRoot || !identity || !currentNeuronId) return { ok: false, err: 'Missing context' };
        try {
            const selectedSns = getSnsById(selectedSnsRoot);
            if (!selectedSns) return { ok: false, err: 'SNS not found' };
            const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                agentOptions: { identity }
            });
            const neuronIdBytes = new Uint8Array(currentNeuronId.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            const req = { subaccount: Array.from(neuronIdBytes), command: [command] };
            const resp = await snsGovActor.manage_neuron(req);
            if (resp?.command?.[0]?.Error) return { ok: false, err: resp.command[0].Error.error_message };
            return { ok: true };
        } catch (e) {
            return { ok: false, err: e.message || String(e) };
        }
    };

    // Dissolve controls
    const increaseDissolveDelay = async (secondsToAdd) => {
        setActionBusy(true); setActionMsg('Increasing dissolve delay...');
        const result = await manageNeuron({ Configure: { operation: [{ IncreaseDissolveDelay: { additional_dissolve_delay_seconds: Number(secondsToAdd) } }] } });
        if (!result.ok) setError(result.err); else await fetchNeuronData();
        setActionBusy(false); setActionMsg('');
    };
    const startDissolving = async () => {
        setActionBusy(true); setActionMsg('Starting dissolving...');
        const result = await manageNeuron({ Configure: { operation: [{ StartDissolving: {} }] } });
        if (!result.ok) setError(result.err); else await fetchNeuronData();
        setActionBusy(false); setActionMsg('');
    };
    const stopDissolving = async () => {
        setActionBusy(true); setActionMsg('Stopping dissolving...');
        const result = await manageNeuron({ Configure: { operation: [{ StopDissolving: {} }] } });
        if (!result.ok) setError(result.err); else await fetchNeuronData();
        setActionBusy(false); setActionMsg('');
    };
    const setDissolveTimestamp = async (timestampSec) => {
        setActionBusy(true); setActionMsg('Setting dissolve timestamp...');
        const result = await manageNeuron({ Configure: { operation: [{ SetDissolveTimestamp: { dissolve_timestamp_seconds: BigInt(timestampSec) } }] } });
        if (!result.ok) setError(result.err); else await fetchNeuronData();
        setActionBusy(false); setActionMsg('');
    };

    // Principal/permission management
    const getPermissionsArray = (permObj) => {
        const perms = [];
        if (permObj.unspecified) perms.push(PERM.UNSPECIFIED);
        if (permObj.configureDissolveState) perms.push(PERM.CONFIGURE_DISSOLVE_STATE);
        if (permObj.managePrincipals) perms.push(PERM.MANAGE_PRINCIPALS);
        if (permObj.submitProposal) perms.push(PERM.SUBMIT_PROPOSAL);
        if (permObj.vote) perms.push(PERM.VOTE);
        if (permObj.disburse) perms.push(PERM.DISBURSE);
        if (permObj.split) perms.push(PERM.SPLIT);
        if (permObj.mergeMaturity) perms.push(PERM.MERGE_MATURITY);
        if (permObj.disburseMaturity) perms.push(PERM.DISBURSE_MATURITY);
        if (permObj.stakeMaturity) perms.push(PERM.STAKE_MATURITY);
        if (permObj.manageVotingPermission) perms.push(PERM.MANAGE_VOTING_PERMISSION);
        return perms;
    };

    const getPermissionsFromArray = (permsArray) => {
        return {
            unspecified: permsArray.includes(PERM.UNSPECIFIED),
            configureDissolveState: permsArray.includes(PERM.CONFIGURE_DISSOLVE_STATE),
            managePrincipals: permsArray.includes(PERM.MANAGE_PRINCIPALS),
            submitProposal: permsArray.includes(PERM.SUBMIT_PROPOSAL),
            vote: permsArray.includes(PERM.VOTE),
            disburse: permsArray.includes(PERM.DISBURSE),
            split: permsArray.includes(PERM.SPLIT),
            mergeMaturity: permsArray.includes(PERM.MERGE_MATURITY),
            disburseMaturity: permsArray.includes(PERM.DISBURSE_MATURITY),
            stakeMaturity: permsArray.includes(PERM.STAKE_MATURITY),
            manageVotingPermission: permsArray.includes(PERM.MANAGE_VOTING_PERMISSION)
        };
    };

    const savePrincipalPermissions = async () => {
        try {
            setActionBusy(true); setActionMsg('Updating permissions...'); setError('');
            const principal = Principal.fromText(managePrincipalInput);
            
            // Prevent users from modifying their own permissions
            const userPrincipal = identity?.getPrincipal()?.toString();
            if (userPrincipal && principal.toString() === userPrincipal) {
                setError('You cannot modify your own permissions. Please ask another principal with management rights to change your permissions.');
                setActionBusy(false);
                setActionMsg('');
                return;
            }
            
            const newPerms = getPermissionsArray(selectedPermissions);
            
            // If editing existing principal, first remove all their permissions, then add new ones
            if (editingPrincipal) {
                const existingPerms = editingPrincipal.permission_type || [];
                if (existingPerms.length > 0) {
                    const removeResult = await manageNeuron({
                        RemoveNeuronPermissions: {
                            principal_id: [principal],
                            permissions_to_remove: [{ permissions: existingPerms }]
                        }
                    });
                    if (!removeResult.ok) {
                        setError(removeResult.err);
                        setActionBusy(false);
                        setActionMsg('');
                        return;
                    }
                }
            }
            
            // Add new permissions
            if (newPerms.length > 0) {
                const result = await manageNeuron({
                    AddNeuronPermissions: {
                        principal_id: [principal],
                        permissions_to_add: [{ permissions: newPerms }]
                    }
                });
                if (!result.ok) {
                    setError(result.err);
                } else {
                    await fetchNeuronData();
                    setManagePrincipalInput('');
                    setEditingPrincipal(null);
                    setSelectedPermissions({
                        unspecified: false,
                        configureDissolveState: true,
                        managePrincipals: true,
                        submitProposal: true,
                        vote: true,
                        disburse: false,
                        split: false,
                        mergeMaturity: false,
                        disburseMaturity: false,
                        stakeMaturity: false,
                        manageVotingPermission: true
                    });
                }
            } else {
                // If no permissions selected and we were editing, just remove (already done above)
                if (editingPrincipal) {
                    await fetchNeuronData();
                    setManagePrincipalInput('');
                    setEditingPrincipal(null);
                    setSelectedPermissions({
                        unspecified: false,
                        configureDissolveState: true,
                        managePrincipals: true,
                        submitProposal: true,
                        vote: true,
                        disburse: false,
                        split: false,
                        mergeMaturity: false,
                        disburseMaturity: false,
                        stakeMaturity: false,
                        manageVotingPermission: true
                    });
                } else {
                    setError('Please select at least one permission');
                }
            }
        } catch (e) {
            setError(e.message || String(e));
        } finally {
            setActionBusy(false);
            setActionMsg('');
        }
    };

    const removePrincipal = async (principalStr, perms) => {
        try {
            setActionBusy(true); setActionMsg('Removing principal...'); setError('');
            const principal = Principal.fromText(principalStr);
            const result = await manageNeuron({
                RemoveNeuronPermissions: {
                    principal_id: [principal],
                    permissions_to_remove: [{ permissions: perms }]
                }
            });
            if (!result.ok) setError(result.err); else await fetchNeuronData();
        } catch (e) {
            setError(e.message || String(e));
        } finally {
            setActionBusy(false);
            setActionMsg('');
        }
    };

    const startEditingPrincipal = (permission) => {
        if (!permission.principal) return;
        setEditingPrincipal(permission);
        setManagePrincipalInput(permission.principal.toString());
        setSelectedPermissions(getPermissionsFromArray(permission.permission_type || []));
    };

    const cancelEditing = () => {
        setEditingPrincipal(null);
        setManagePrincipalInput('');
        setSelectedPermissions({
            configureDissolveState: true,
            managePrincipals: true,
            submitProposal: true,
            vote: true,
            disburse: false,
            split: false,
            mergeMaturity: false,
            disburseMaturity: false,
            stakeMaturity: false,
            manageVotingPermission: true
        });
    };

    const makeFullOwner = () => {
        setSelectedPermissions({
            unspecified: true,
            configureDissolveState: true,
            managePrincipals: true,
            submitProposal: true,
            vote: true,
            disburse: true,
            split: true,
            mergeMaturity: true,
            disburseMaturity: true,
            stakeMaturity: true,
            manageVotingPermission: true
        });
    };

    const makeHotkey = () => {
        setSelectedPermissions({
            unspecified: false,
            configureDissolveState: false,
            managePrincipals: false,
            submitProposal: true,
            vote: true,
            disburse: false,
            split: false,
            mergeMaturity: false,
            disburseMaturity: false,
            stakeMaturity: false,
            manageVotingPermission: false
        });
    };

    const getPrincipalSymbol = (perms) => {
        const permArray = perms.permission_type || [];
        const permCount = permArray.length;
        
        // Full owner (all 10 or 11 permissions - 11 includes UNSPECIFIED from neuron creation)
        if (permCount === 10 || permCount === 11) {
            return { icon: '👑', title: permCount === 11 ? 'Full Owner - All permissions (including creator permission)' : 'Full Owner - All permissions' };
        }
        
        // Hotkey (exactly permissions 3 and 4: submit proposal and vote)
        const hasSubmit = permArray.includes(PERM.SUBMIT_PROPOSAL);
        const hasVote = permArray.includes(PERM.VOTE);
        if (permCount === 2 && hasSubmit && hasVote) {
            return { icon: '🔑', title: 'Hotkey - Submit proposals and vote' };
        }
        
        // Voting only (just vote permission)
        if (permCount === 1 && hasVote) {
            return { icon: '🗳️', title: 'Voter - Vote only' };
        }
        
        // Management focused (has manage principals)
        if (permArray.includes(PERM.MANAGE_PRINCIPALS)) {
            return { icon: '⚡', title: 'Manager - Has management permissions' };
        }
        
        // Financial focused (has disburse or disburse maturity)
        if (permArray.includes(PERM.DISBURSE) || permArray.includes(PERM.DISBURSE_MATURITY)) {
            return { icon: '💼', title: 'Financial - Has disbursement permissions' };
        }
        
        // Custom/partial permissions
        return { icon: '🔧', title: 'Custom permissions' };
    };

    // Followees editor helpers - topic-based (modern)
    const hexToBytes = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
    
    const getCurrentFolloweesForTopic = (topicName) => {
        // Check topic_followees (modern format)
        if (neuronData?.topic_followees?.[0]?.topic_id_to_followees) {
            const entries = neuronData.topic_followees[0].topic_id_to_followees;
            for (const [_topicId, topicFollowees] of entries) {
                if (topicFollowees.topic?.[0]) {
                    const currentTopic = Object.keys(topicFollowees.topic[0])[0];
                    if (currentTopic === topicName) {
                        return topicFollowees.followees.map(f => ({
                            neuronId: f.neuron_id?.[0] ? uint8ArrayToHex(f.neuron_id[0].id) : '',
                            alias: f.alias?.[0] || ''
                        }));
                    }
                }
            }
        }
        return [];
    };

    const addFollowee = async () => {
        try {
            setActionBusy(true); setActionMsg('Updating followees...'); setError('');
            const existing = getCurrentFolloweesForTopic(topicInput);
            // Add new followee
            const newFollowee = {
                neuron_id: [{ id: Array.from(hexToBytes(followeeInput.trim())) }],
                alias: followeeAliasInput.trim() ? [followeeAliasInput.trim()] : []
            };
            const allFollowees = [...existing.map(f => ({
                neuron_id: [{ id: Array.from(hexToBytes(f.neuronId)) }],
                alias: f.alias ? [f.alias] : []
            })), newFollowee];
            
            const result = await manageNeuron({
                SetFollowing: {
                    topic_following: [{
                        topic: [{ [topicInput]: null }],
                        followees: allFollowees
                    }]
                }
            });
            if (!result.ok) setError(result.err); else { await fetchNeuronData(); setFolloweeInput(''); setFolloweeAliasInput(''); }
        } catch (e) {
            setError(e.message || String(e));
        } finally {
            setActionBusy(false); setActionMsg('');
        }
    };

    const bulkAddFollowees = async () => {
        try {
            setActionBusy(true); setActionMsg('Adding multiple followees...'); setError('');
            
            // Parse the input - split by newlines and filter out empty lines
            const lines = bulkFolloweeInput.split('\n').filter(line => line.trim());
            
            if (lines.length === 0) {
                setError('Please enter at least one neuron ID');
                return;
            }
            
            const existing = getCurrentFolloweesForTopic(topicInput);
            const existingIds = new Set(existing.map(f => f.neuronId.toLowerCase()));
            
            // Parse each line - format can be "neuronId" or "neuronId alias"
            const newFollowees = [];
            const errors = [];
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                const parts = line.split(/\s+/); // Split by whitespace
                const neuronId = parts[0];
                const alias = parts.slice(1).join(' '); // Everything after first part is alias
                
                // Validate neuron ID format (hex string)
                if (!/^[0-9a-fA-F]+$/.test(neuronId)) {
                    errors.push(`Line ${i + 1}: Invalid neuron ID format "${neuronId}"`);
                    continue;
                }
                
                // Skip if already following
                if (existingIds.has(neuronId.toLowerCase())) {
                    console.log(`Skipping duplicate: ${neuronId}`);
                    continue;
                }
                
                newFollowees.push({
                    neuron_id: [{ id: Array.from(hexToBytes(neuronId)) }],
                    alias: alias ? [alias] : []
                });
                
                // Add to set to prevent duplicates within the same bulk add
                existingIds.add(neuronId.toLowerCase());
            }
            
            if (errors.length > 0) {
                setError(errors.join('\n'));
                return;
            }
            
            if (newFollowees.length === 0) {
                setError('No new followees to add (all may already be followed)');
                return;
            }
            
            // Combine existing and new followees
            const allFollowees = [
                ...existing.map(f => ({
                    neuron_id: [{ id: Array.from(hexToBytes(f.neuronId)) }],
                    alias: f.alias ? [f.alias] : []
                })),
                ...newFollowees
            ];
            
            const result = await manageNeuron({
                SetFollowing: {
                    topic_following: [{
                        topic: [{ [topicInput]: null }],
                        followees: allFollowees
                    }]
                }
            });
            
            if (!result.ok) {
                setError(result.err);
            } else {
                await fetchNeuronData();
                setBulkFolloweeInput('');
                alert(`Successfully added ${newFollowees.length} followee(s) to ${topicInput}`);
            }
        } catch (e) {
            setError(e.message || String(e));
        } finally {
            setActionBusy(false); setActionMsg('');
        }
    };

    const bulkAddToMultipleTopics = async () => {
        try {
            setActionBusy(true); setActionMsg('Adding neuron to multiple topics...'); setError('');
            
            const neuronId = bulkTopicsNeuronId.trim();
            
            if (!neuronId) {
                setError('Please enter a neuron ID');
                return;
            }
            
            // Validate neuron ID format (hex string)
            if (!/^[0-9a-fA-F]+$/.test(neuronId)) {
                setError('Invalid neuron ID format');
                return;
            }
            
            // Get selected topics
            const topicsToFollow = Object.entries(selectedTopics)
                .filter(([_, isSelected]) => isSelected)
                .map(([topic, _]) => topic);
            
            if (topicsToFollow.length === 0) {
                setError('Please select at least one topic');
                return;
            }
            
            // Build the followee object
            const followeeObj = {
                neuron_id: [{ id: Array.from(hexToBytes(neuronId)) }],
                alias: bulkTopicsAlias.trim() ? [bulkTopicsAlias.trim()] : []
            };
            
            // For each selected topic, add this neuron
            const topicFollowingArray = [];
            let addedCount = 0;
            let skippedCount = 0;
            
            for (const topic of topicsToFollow) {
                const existing = getCurrentFolloweesForTopic(topic);
                const existingIds = new Set(existing.map(f => f.neuronId.toLowerCase()));
                
                // Skip if already following in this topic
                if (existingIds.has(neuronId.toLowerCase())) {
                    console.log(`Already following ${neuronId} in ${topic}, skipping`);
                    skippedCount++;
                    continue;
                }
                
                // Combine existing and new followee
                const allFollowees = [
                    ...existing.map(f => ({
                        neuron_id: [{ id: Array.from(hexToBytes(f.neuronId)) }],
                        alias: f.alias ? [f.alias] : []
                    })),
                    followeeObj
                ];
                
                topicFollowingArray.push({
                    topic: [{ [topic]: null }],
                    followees: allFollowees
                });
                addedCount++;
            }
            
            if (topicFollowingArray.length === 0) {
                setError('Neuron is already followed in all selected topics');
                return;
            }
            
            // Send all topics in one manage_neuron call
            const result = await manageNeuron({
                SetFollowing: {
                    topic_following: topicFollowingArray
                }
            });
            
            if (!result.ok) {
                setError(result.err);
            } else {
                await fetchNeuronData();
                setBulkTopicsNeuronId('');
                setBulkTopicsAlias('');
                const message = `Successfully added neuron to ${addedCount} topic(s)` + 
                    (skippedCount > 0 ? ` (skipped ${skippedCount} where already following)` : '');
                alert(message);
            }
        } catch (e) {
            setError(e.message || String(e));
        } finally {
            setActionBusy(false); setActionMsg('');
        }
    };

    const removeFollowee = async (neuronIdHex = null, specificTopic = null) => {
        try {
            setActionBusy(true); setActionMsg('Updating followees...'); setError('');
            const targetNeuronId = neuronIdHex || followeeInput.trim();
            const targetTopic = specificTopic || topicInput;
            
            // Helper to get followees for a specific topic
            const getFolloweesForTopic = (topicName) => {
                if (neuronData?.topic_followees?.[0]?.topic_id_to_followees) {
                    const entries = neuronData.topic_followees[0].topic_id_to_followees;
                    for (const [_topicId, topicFollowees] of entries) {
                        if (topicFollowees.topic?.[0]) {
                            const currentTopic = Object.keys(topicFollowees.topic[0])[0];
                            if (currentTopic === topicName) {
                                return topicFollowees.followees.map(f => ({
                                    neuronId: f.neuron_id?.[0] ? uint8ArrayToHex(f.neuron_id[0].id) : '',
                                    alias: f.alias?.[0] || ''
                                }));
                            }
                        }
                    }
                }
                return [];
            };
            
            const existing = getFolloweesForTopic(targetTopic);
            const filtered = existing.filter(f => f.neuronId !== targetNeuronId);
            const allFollowees = filtered.map(f => ({
                neuron_id: [{ id: Array.from(hexToBytes(f.neuronId)) }],
                alias: f.alias ? [f.alias] : []
            }));
            
            const result = await manageNeuron({
                SetFollowing: {
                    topic_following: [{
                        topic: [{ [targetTopic]: null }],
                        followees: allFollowees
                    }]
                }
            });
            if (!result.ok) setError(result.err); else { await fetchNeuronData(); setFolloweeInput(''); setFolloweeAliasInput(''); }
        } catch (e) {
            setError(e.message || String(e));
        } finally {
            setActionBusy(false); setActionMsg('');
        }
    };

    // Helper function to format vote
    const formatVote = (voteNumber) => {
        switch (voteNumber) {
            case 1:
                return 'Yes';
            case 2:
                return 'No';
            default:
                return 'Not Voted';
        }
    };

    // Add validation function
    const validateNameInput = (input) => {
        if (input.length > 32) {
            return "Name must not exceed 32 characters";
        }
        
        const validPattern = /^[a-zA-Z0-9\s\-_.']*$/;
        if (!validPattern.test(input)) {
            return "Only alphanumeric characters, spaces, hyphens, underscores, dots, and apostrophes are allowed";
        }
        
        return "";
    };

    // Modify handleNicknameSubmit to include loading state
    const handleNicknameSubmit = async () => {
        const error = validateNameInput(nicknameInput);
        if (error) {
            setInputError(error);
            return;
        }

        if (!nicknameInput.trim() || !identity || !currentNeuronId) return;

        setIsSubmitting(true);
        try {
            const response = await setNeuronNickname(identity, selectedSnsRoot, currentNeuronId, nicknameInput);
            if ('ok' in response) {
                // Refresh global names
                await fetchAllNames();
                setInputError('');
            } else {
                setError(response.err);
            }
        } catch (err) {
            console.error('Error setting neuron nickname:', err);
            setError('Failed to set neuron nickname');
        } finally {
            setIsSubmitting(false);
            setIsEditingNickname(false);
            setNicknameInput('');
        }
    };

    // Add effect to fetch principal display info
    useEffect(() => {
        const fetchPrincipalInfo = () => {
            if (!neuronData?.permissions || !principalNames || !principalNicknames) return;

            const uniquePrincipals = new Set();
            
            // Add owner principals
            getOwnerPrincipals(neuronData).forEach(p => uniquePrincipals.add(p));
            
            // Add all principals with permissions
            neuronData.permissions.forEach(p => {
                if (p.principal) uniquePrincipals.add(p.principal.toString());
            });

            const displayInfoMap = new Map();
            Array.from(uniquePrincipals).forEach(principal => {
                const displayInfo = getPrincipalDisplayInfoFromContext(Principal.fromText(principal), principalNames, principalNicknames);
                displayInfoMap.set(principal, displayInfo);
            });

            setPrincipalDisplayInfo(displayInfoMap);
        };

        fetchPrincipalInfo();
    }, [neuronData, principalNames, principalNicknames]);

    // Auto-expand followees section if there are any followees
    useEffect(() => {
        if (!neuronData) return;
        
        const hasFollowees = neuronData.followees && neuronData.followees.length > 0;
        const hasTopicFollowees = neuronData.topic_followees && 
            neuronData.topic_followees[0] && 
            neuronData.topic_followees[0].topic_id_to_followees && 
            neuronData.topic_followees[0].topic_id_to_followees.length > 0;
        
        if (hasFollowees || hasTopicFollowees) {
            setIsFolloweesExpanded(true);
        }
    }, [neuronData]);

    // Fetch nervous system parameters for voting power calculation
    useEffect(() => {
        const fetchNervousSystemParameters = async () => {
            if (!selectedSnsRoot || !identity) return;
            
            try {
                const selectedSns = getSnsById(selectedSnsRoot);
                if (!selectedSns) return;

                const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                    agentOptions: { identity }
                });
                
                const params = await snsGovActor.get_nervous_system_parameters(null);
                setNervousSystemParameters(params);
            } catch (error) {
                console.error('Error fetching nervous system parameters:', error);
            }
        };

        fetchNervousSystemParameters();
    }, [selectedSnsRoot, identity]);

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header showSnsDropdown={true} />
            <main className="wallet-container">
                <h1 style={{ color: theme.colors.primaryText }}>Neuron Details</h1>
                
                <section style={{ backgroundColor: theme.colors.secondaryBg, borderRadius: '8px', padding: '20px', marginTop: '20px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        <div style={{ 
                            display: 'flex', 
                            justifyContent: 'flex-start'
                        }}>
                            <div style={{ width: '100%', maxWidth: '500px' }}>
                                <NeuronInput
                                    value={neuronIdInput}
                                    onChange={setNeuronIdInput}
                                    placeholder="Enter neuron ID or search by name/nickname"
                                    snsRoot={selectedSnsRoot}
                                />
                            </div>
                        </div>
                    </div>
                    {error && <div style={{ color: theme.colors.error, marginTop: '10px' }}>{error}</div>}

                    {loading && (
                        <div style={{ color: theme.colors.primaryText, textAlign: 'center', padding: '20px' }}>
                            Loading...
                        </div>
                    )}

                    {neuronData && !loading && (
                        <div style={{ color: theme.colors.primaryText }}>
                            <h2>Neuron Information</h2>
                            <div style={{ backgroundColor: theme.colors.tertiaryBg, padding: '15px', borderRadius: '6px', marginTop: '10px' }}>
                                <div style={{ marginBottom: '15px' }}>
                                    <div style={{ 
                                        display: 'flex', 
                                        alignItems: 'flex-start', 
                                        gap: '10px',
                                        marginBottom: '10px'
                                    }}>
                                        <div style={{ 
                                            fontFamily: 'monospace',
                                            fontSize: '16px',
                                            color: theme.colors.mutedText,
                                            wordBreak: 'break-all',
                                            overflowWrap: 'anywhere',
                                            lineHeight: '1.4',
                                            flex: 1,
                                            minWidth: 0
                                        }}>
                                            {currentNeuronId}
                                        </div>
                                        <button
                                            onClick={() => navigator.clipboard.writeText(currentNeuronId)}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                padding: '4px',
                                                cursor: 'pointer',
                                                color: theme.colors.mutedText,
                                                display: 'flex',
                                                alignItems: 'center',
                                                flexShrink: 0
                                            }}
                                            title="Copy neuron ID to clipboard"
                                        >
                                            📋
                                        </button>
                                    </div>
                                    {(() => {
                                        const { name, nickname, isVerified } = getDisplayName(currentNeuronId);
                                        const neuronColor = getNeuronColor(currentNeuronId);
                                        return (
                                            <>
                                                {name && (
                                                    <div style={{ 
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        marginBottom: '5px'
                                                    }}>
                                                        <span style={{ 
                                                            color: neuronColor,
                                                            fontSize: '18px',
                                                            fontWeight: 'bold'
                                                        }}>
                                                            {name}
                                                        </span>
                                                        {isVerified && (
                                                            <span 
                                                                style={{ 
                                                                    fontSize: '14px',
                                                                    cursor: 'help'
                                                                }}
                                                                title="Verified name"
                                                            >
                                                                ✓
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                                {nickname && (
                                                    <div style={{ 
                                                        color: neuronColor,
                                                        fontSize: '16px',
                                                        fontStyle: 'italic',
                                                        opacity: 0.8,
                                                        marginBottom: '5px'
                                                    }}>
                                                        {nickname}
                                                    </div>
                                                )}
                                                <div style={{ 
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    marginBottom: '5px'
                                                }}>
                                                    {isEditingNickname ? (
                                                        <div style={{ 
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            gap: '10px',
                                                            width: '100%'
                                                        }}>
                                                            <div>
                                                                <input
                                                                    type="text"
                                                                    value={nicknameInput}
                                                                    onChange={(e) => {
                                                                        const newValue = e.target.value;
                                                                        setNicknameInput(newValue);
                                                                        setInputError(validateNameInput(newValue));
                                                                    }}
                                                                    maxLength={32}
                                                                    placeholder="Enter nickname (max 32 chars)"
                                                                    style={{
                                                                        backgroundColor: theme.colors.secondaryBg,
                                                                        border: `1px solid ${inputError ? theme.colors.error : theme.colors.border}`,
                                                                        borderRadius: '4px',
                                                                        color: theme.colors.primaryText,
                                                                        padding: '8px',
                                                                        width: '100%',
                                                                        fontSize: '14px'
                                                                    }}
                                                                />
                                                                {inputError && (
                                                                    <div style={{
                                                                        color: theme.colors.error,
                                                                        fontSize: '12px',
                                                                        marginTop: '4px'
                                                                    }}>
                                                                        {inputError}
                                                                    </div>
                                                                )}
                                                                <div style={{
                                                                    color: theme.colors.mutedText,
                                                                    fontSize: '12px',
                                                                    marginTop: '4px'
                                                                }}>
                                                                    Allowed: letters, numbers, spaces, hyphens (-), underscores (_), dots (.), apostrophes (')
                                                                </div>
                                                            </div>
                                                            <div style={{
                                                                display: 'flex',
                                                                gap: '8px',
                                                                justifyContent: 'flex-end'
                                                            }}>
                                                                <button
                                                                    onClick={handleNicknameSubmit}
                                                                    disabled={isSubmitting}
                                                                    style={{
                                                                        backgroundColor: theme.colors.mutedText,
                                                                        color: theme.colors.primaryText,
                                                                        border: 'none',
                                                                        borderRadius: '4px',
                                                                        padding: '8px 12px',
                                                                        cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                                                        whiteSpace: 'nowrap',
                                                                        opacity: isSubmitting ? 0.7 : 1,
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '6px'
                                                                    }}
                                                                >
                                                                    {isSubmitting ? (
                                                                        <>
                                                                            <span style={{ 
                                                                                display: 'inline-block',
                                                                                animation: 'spin 1s linear infinite',
                                                                                fontSize: '14px'
                                                                            }}>⟳</span>
                                                                            Setting...
                                                                        </>
                                                                    ) : (
                                                                        'Save'
                                                                    )}
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        setIsEditingNickname(false);
                                                                        setNicknameInput('');
                                                                    }}
                                                                    disabled={isSubmitting}
                                                                    style={{
                                                                        backgroundColor: theme.colors.error,
                                                                        color: theme.colors.primaryText,
                                                                        border: 'none',
                                                                        borderRadius: '4px',
                                                                        padding: '8px 12px',
                                                                        cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                                                        whiteSpace: 'nowrap',
                                                                        opacity: isSubmitting ? 0.7 : 1
                                                                    }}
                                                                >
                                                                    Cancel
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            {isAuthenticated && (
                                                                <button
                                                                    onClick={() => {
                                                                        setIsEditingNickname(true);
                                                                        setNicknameInput(nickname || '');
                                                                    }}
                                                                    style={{
                                                                        background: 'none',
                                                                        border: 'none',
                                                                        padding: '4px',
                                                                        cursor: 'pointer',
                                                                        color: theme.colors.mutedText,
                                                                        display: 'flex',
                                                                        alignItems: 'center'
                                                                    }}
                                                                    title={nickname ? "Edit nickname" : "Add nickname"}
                                                                >
                                                                    ✏️
                                                                </button>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                                <p><strong>SNS:</strong> {selectedSns?.name || 'Unknown SNS'}</p>
                                <p><strong>Stake:</strong> {formatE8s(neuronData.cached_neuron_stake_e8s)} {selectedSns?.name || 'SNS'}</p>
                                <p><strong>Created:</strong> {new Date(Number(neuronData.created_timestamp_seconds || 0) * 1000).toLocaleString()}</p>
                                <p><strong>Dissolve State:</strong> {getDissolveState(neuronData)}</p>
                                <p><strong>Maturity:</strong> {formatE8s(neuronData.maturity_e8s_equivalent)} {selectedSns?.name || 'SNS'}</p>
                                <div className="text-sm text-gray-600 dark:text-gray-400">
                                    Voting Power: {
                                        nervousSystemParameters 
                                            ? formatVotingPower(calculateVotingPower(neuronData, nervousSystemParameters))
                                            : `${(Number(neuronData.cached_neuron_stake_e8s) / 100000000 * (Number(neuronData.voting_power_percentage_multiplier) / 100)).toFixed(2)}`
                                    }
                                </div>

                                {/* Dissolve controls (permission-gated) */}
                                {currentUserHasPermission(PERM.CONFIGURE_DISSOLVE_STATE) && (
                                    <div style={{ marginTop: '16px', padding: '12px', backgroundColor: theme.colors.secondaryBg, borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <div style={{ color: theme.colors.mutedText, fontWeight: 'bold' }}>Manage Dissolve</div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                            <button disabled={actionBusy} onClick={() => increaseDissolveDelay(24*60*60)} style={{ backgroundColor: theme.colors.accent, color: theme.colors.primaryText, border: 'none', borderRadius: '4px', padding: '6px 10px', cursor: actionBusy ? 'not-allowed' : 'pointer' }}>+1 day</button>
                                            <button disabled={actionBusy} onClick={() => increaseDissolveDelay(7*24*60*60)} style={{ backgroundColor: theme.colors.accent, color: theme.colors.primaryText, border: 'none', borderRadius: '4px', padding: '6px 10px', cursor: actionBusy ? 'not-allowed' : 'pointer' }}>+1 week</button>
                                            <button disabled={actionBusy} onClick={() => increaseDissolveDelay(30*24*60*60)} style={{ backgroundColor: theme.colors.accent, color: theme.colors.primaryText, border: 'none', borderRadius: '4px', padding: '6px 10px', cursor: actionBusy ? 'not-allowed' : 'pointer' }}>+1 month</button>
                                            <button disabled={actionBusy} onClick={startDissolving} style={{ backgroundColor: theme.colors.error, color: theme.colors.primaryText, border: 'none', borderRadius: '4px', padding: '6px 10px', cursor: actionBusy ? 'not-allowed' : 'pointer' }}>Start dissolving</button>
                                            <button disabled={actionBusy} onClick={stopDissolving} style={{ backgroundColor: theme.colors.mutedText, color: theme.colors.primaryText, border: 'none', borderRadius: '4px', padding: '6px 10px', cursor: actionBusy ? 'not-allowed' : 'pointer' }}>Stop dissolving</button>
                                        </div>
                                        {actionMsg && <div style={{ color: theme.colors.mutedText }}>{actionMsg}</div>}
                                    </div>
                                )}

                                {/* Add permissions section */}
                                <div style={{ marginTop: '20px' }}>
                                    <div 
                                        style={{ 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            gap: '8px', 
                                            marginBottom: '12px',
                                            cursor: 'pointer',
                                            userSelect: 'none'
                                        }}
                                        onClick={() => setIsPermissionsExpanded(!isPermissionsExpanded)}
                                    >
                                        <span style={{ 
                                            color: '#888',
                                            fontSize: '16px',
                                            transform: isPermissionsExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                            transition: 'transform 0.2s ease'
                                        }}>
                                            ▶
                                        </span>
                                        <h3 style={{ color: '#888', margin: 0 }}>Principals & Permissions</h3>
                                    </div>
                                    {isPermissionsExpanded && (
                                        <>
                                    {/* List all principals with their permissions */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {neuronData.permissions.map((p, index) => {
                                            if (!p.principal) return null;
                                            const principalStr = p.principal.toString();
                                            const perms = getPermissionsFromArray(p.permission_type || []);
                                            const permCount = p.permission_type?.length || 0;
                                            const symbol = getPrincipalSymbol(p);
                                            const isCurrentUser = identity && principalStr === identity.getPrincipal()?.toString();
                                            
                                            return (
                                                <div key={index} style={{
                                                    backgroundColor: theme.colors.tertiaryBg,
                                                    borderRadius: '6px',
                                                    padding: '12px',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '8px'
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                        <span style={{ fontSize: '16px' }} title={symbol.title}>{symbol.icon}</span>
                                                        <PrincipalDisplay 
                                                            principal={p.principal}
                                                            displayInfo={principalDisplayInfo.get(principalStr)}
                                                            showCopyButton={true}
                                                            short={true}
                                                        />
                                                        {isCurrentUser && (
                                                            <span style={{ 
                                                                color: theme.colors.accent, 
                                                                fontSize: '12px', 
                                                                fontWeight: '600',
                                                                backgroundColor: theme.colors.accent + '20',
                                                                padding: '2px 8px',
                                                                borderRadius: '12px'
                                                            }}>
                                                                (You)
                                                            </span>
                                                        )}
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '12px', marginLeft: 'auto' }}>
                                                            {permCount} permission{permCount !== 1 ? 's' : ''}
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '12px' }}>
                                                        {Object.entries(PERMISSION_INFO).map(([key, info]) => {
                                                            const hasPermission = perms[key];
                                                            return (
                                                                <span
                                                                    key={key}
                                                                    title={info.description}
                                                                    style={{
                                                                        backgroundColor: hasPermission ? theme.colors.accent : theme.colors.secondaryBg,
                                                                        color: theme.colors.primaryText,
                                                                        padding: '3px 8px',
                                                                        borderRadius: '12px',
                                                                        display: 'inline-flex',
                                                                        alignItems: 'center',
                                                                        gap: '4px',
                                                                        opacity: hasPermission ? 1 : 0.4
                                                                    }}
                                                                >
                                                                    <span>{info.icon}</span>
                                                                    <span>{info.label}</span>
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                    {currentUserHasPermission(PERM.MANAGE_PRINCIPALS) && !isCurrentUser && (
                                                        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                                                            <button
                                                                disabled={actionBusy}
                                                                onClick={() => startEditingPrincipal(p)}
                                                                style={{
                                                                    backgroundColor: theme.colors.mutedText,
                                                                    color: theme.colors.primaryText,
                                                                    border: 'none',
                                                                    borderRadius: '4px',
                                                                    padding: '4px 10px',
                                                                    cursor: actionBusy ? 'not-allowed' : 'pointer',
                                                                    fontSize: '12px'
                                                                }}
                                                            >
                                                                ✏️ Edit
                                                            </button>
                                                            <button
                                                                disabled={actionBusy}
                                                                onClick={() => removePrincipal(principalStr, p.permission_type || [])}
                                                                style={{
                                                                    backgroundColor: theme.colors.error,
                                                                    color: theme.colors.primaryText,
                                                                    border: 'none',
                                                                    borderRadius: '4px',
                                                                    padding: '4px 10px',
                                                                    cursor: actionBusy ? 'not-allowed' : 'pointer',
                                                                    fontSize: '12px'
                                                                }}
                                                            >
                                                                ✕ Remove
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Add/Edit principal form */}
                                    {currentUserHasPermission(PERM.MANAGE_PRINCIPALS) && (
                                        <div style={{ marginTop: '12px', padding: '16px', backgroundColor: theme.colors.secondaryBg, borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            <div style={{ color: theme.colors.primaryText, fontWeight: 'bold', fontSize: '14px' }}>
                                                {editingPrincipal ? '✏️ Edit Principal Permissions' : '➕ Add New Principal'}
                                            </div>
                                            <input
                                                type="text"
                                                placeholder="Principal ID"
                                                value={managePrincipalInput}
                                                onChange={(e) => setManagePrincipalInput(e.target.value)}
                                                disabled={!!editingPrincipal}
                                                style={{
                                                    backgroundColor: theme.colors.tertiaryBg,
                                                    border: `1px solid ${theme.colors.border}`,
                                                    color: theme.colors.primaryText,
                                                    borderRadius: '4px',
                                                    padding: '8px',
                                                    opacity: editingPrincipal ? 0.6 : 1
                                                }}
                                            />
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '13px', fontWeight: 'bold' }}>
                                                        Select Permissions:
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '6px' }}>
                                                        <button
                                                            type="button"
                                                            onClick={makeFullOwner}
                                                            style={{
                                                                backgroundColor: theme.colors.accent,
                                                                color: theme.colors.primaryText,
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                padding: '4px 8px',
                                                                cursor: 'pointer',
                                                                fontSize: '11px',
                                                                fontWeight: 'bold'
                                                            }}
                                                        >
                                                            👑 Make Full Owner
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={makeHotkey}
                                                            style={{
                                                                backgroundColor: theme.colors.mutedText,
                                                                color: theme.colors.primaryText,
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                padding: '4px 8px',
                                                                cursor: 'pointer',
                                                                fontSize: '11px',
                                                                fontWeight: 'bold'
                                                            }}
                                                        >
                                                            🔑 Make Hotkey
                                                        </button>
                                                    </div>
                                                </div>
                                                {Object.entries(PERMISSION_INFO).map(([key, info]) => (
                                                    <label
                                                        key={key}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '10px',
                                                            padding: '8px',
                                                            backgroundColor: theme.colors.tertiaryBg,
                                                            borderRadius: '4px',
                                                            cursor: 'pointer',
                                                            border: `2px solid ${selectedPermissions[key] ? theme.colors.accent : 'transparent'}`
                                                        }}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedPermissions[key]}
                                                            onChange={(e) => setSelectedPermissions({
                                                                ...selectedPermissions,
                                                                [key]: e.target.checked
                                                            })}
                                                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                        />
                                                        <span style={{ fontSize: '18px' }}>{info.icon}</span>
                                                        <div style={{ flex: 1 }}>
                                                            <div style={{ color: theme.colors.primaryText, fontWeight: 'bold', fontSize: '13px' }}>
                                                                {info.label}
                                                            </div>
                                                            <div style={{ color: theme.colors.mutedText, fontSize: '11px' }}>
                                                                {info.description}
                                                            </div>
                                                        </div>
                                                    </label>
                                                ))}
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                                                <button
                                                    disabled={actionBusy || !managePrincipalInput.trim()}
                                                    onClick={savePrincipalPermissions}
                                                    style={{
                                                        backgroundColor: theme.colors.accent,
                                                        color: theme.colors.primaryText,
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        padding: '8px 16px',
                                                        cursor: (actionBusy || !managePrincipalInput.trim()) ? 'not-allowed' : 'pointer',
                                                        fontWeight: 'bold',
                                                        opacity: (actionBusy || !managePrincipalInput.trim()) ? 0.5 : 1
                                                    }}
                                                >
                                                    {editingPrincipal ? '💾 Save Changes' : '➕ Add Principal'}
                                                </button>
                                                {editingPrincipal && (
                                                    <button
                                                        disabled={actionBusy}
                                                        onClick={cancelEditing}
                                                        style={{
                                                            backgroundColor: theme.colors.mutedText,
                                                            color: theme.colors.primaryText,
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            padding: '8px 16px',
                                                            cursor: actionBusy ? 'not-allowed' : 'pointer'
                                                        }}
                                                    >
                                                        Cancel
                                                    </button>
                                                )}
                                            </div>
                                            {actionMsg && <div style={{ color: theme.colors.accent, fontSize: '12px' }}>{actionMsg}</div>}
                                        </div>
                                    )}
                                        </>
                                    )}
                                </div>

                                {/* Add followees section */}
                                <div style={{ marginTop: '20px' }}>
                                    <div 
                                        style={{ 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            gap: '8px', 
                                            marginBottom: '12px',
                                            cursor: 'pointer',
                                            userSelect: 'none'
                                        }}
                                        onClick={() => setIsFolloweesExpanded(!isFolloweesExpanded)}
                                    >
                                        <span style={{ 
                                            color: '#888',
                                            fontSize: '16px',
                                            transform: isFolloweesExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                            transition: 'transform 0.2s ease'
                                        }}>
                                            ▶
                                        </span>
                                        <h3 style={{ color: '#888', margin: 0 }}>Following</h3>
                                    </div>
                                    {isFolloweesExpanded && (
                                        <>
                                    
                                    {(() => {
                                        const hasFollowees = neuronData.followees && neuronData.followees.length > 0;
                                        const hasTopicFollowees = neuronData.topic_followees && 
                                            neuronData.topic_followees[0] && 
                                            neuronData.topic_followees[0].topic_id_to_followees && 
                                            neuronData.topic_followees[0].topic_id_to_followees.length > 0;

                                        if (!hasFollowees && !hasTopicFollowees) {
                                            return (
                                                <div style={{ 
                                                    color: theme.colors.mutedText,
                                                    fontStyle: 'italic',
                                                    padding: '10px',
                                                    backgroundColor: theme.colors.tertiaryBg,
                                                    borderRadius: '4px'
                                                }}>
                                                    This neuron is not following any other neurons for voting
                                                </div>
                                            );
                                        }

                                        return (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                {/* General followees */}
                                                {hasFollowees && (
                                                    <div>
                                                        <h4 style={{ color: '#aaa', fontSize: '14px', marginBottom: '8px' }}>
                                                            General Following (by Function ID)
                                                        </h4>
                                                        {neuronData.followees.map(([functionId, followees], index) => (
                                                            <div key={index} style={{
                                                                backgroundColor: theme.colors.tertiaryBg,
                                                                padding: '10px',
                                                                borderRadius: '4px',
                                                                marginBottom: '8px'
                                                            }}>
                                                                <div style={{ 
                                                                    color: theme.colors.mutedText,
                                                                    fontSize: '12px',
                                                                    marginBottom: '6px'
                                                                }}>
                                                                    Function ID: {functionId.toString()}
                                                                </div>
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                    {followees.followees.map((followeeId, followeeIndex) => {
                                                                        const followeeIdHex = uint8ArrayToHex(followeeId.id);
                                                                        
                                                                        return (
                                                                            <div key={followeeIndex} style={{
                                                                                display: 'flex',
                                                                                alignItems: 'flex-start',
                                                                                gap: '8px',
                                                                                padding: '4px 0'
                                                                            }}>
                                                                                <NeuronDisplay
                                                                                    neuronId={followeeIdHex}
                                                                                    snsRoot={selectedSnsRoot}
                                                                                    displayInfo={getDisplayName(followeeIdHex)}
                                                                                    showCopyButton={true}
                                                                                    enableContextMenu={true}
                                                                                />
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Topic-specific followees */}
                                                {hasTopicFollowees && (
                                                    <div>
                                                        <h4 style={{ color: '#aaa', fontSize: '14px', marginBottom: '8px' }}>
                                                            Topic-Specific Following
                                                        </h4>
                                                        {neuronData.topic_followees[0].topic_id_to_followees.map(([topicId, topicFollowees], index) => {
                                                            const topicName = topicFollowees.topic?.[0] ? Object.keys(topicFollowees.topic[0])[0] : null;
                                                            return (
                                                            <div key={index} style={{
                                                                backgroundColor: theme.colors.tertiaryBg,
                                                                padding: '10px',
                                                                borderRadius: '4px',
                                                                marginBottom: '8px'
                                                            }}>
                                                                <div style={{ 
                                                                    color: theme.colors.mutedText,
                                                                    fontSize: '12px',
                                                                    marginBottom: '6px'
                                                                }}>
                                                                    Topic ID: {topicId.toString()}
                                                                    {topicName && (
                                                                        <span style={{ marginLeft: '8px', color: '#aaa' }}>
                                                                            ({topicName})
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                    {topicFollowees.followees.map((followee, followeeIndex) => {
                                                                        if (!followee.neuron_id || !followee.neuron_id[0]) return null;
                                                                        
                                                                        const followeeIdHex = uint8ArrayToHex(followee.neuron_id[0].id);
                                                                        
                                                                        return (
                                                                            <div key={followeeIndex} style={{
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                gap: '8px',
                                                                                padding: '4px 0'
                                                                            }}>
                                                                                <NeuronDisplay
                                                                                    neuronId={followeeIdHex}
                                                                                    snsRoot={selectedSnsRoot}
                                                                                    displayInfo={getDisplayName(followeeIdHex)}
                                                                                    showCopyButton={true}
                                                                                    enableContextMenu={true}
                                                                                />
                                                                                {followee.alias && followee.alias[0] && (
                                                                                    <span style={{ 
                                                                                        color: theme.colors.mutedText,
                                                                                        fontSize: '12px',
                                                                                        fontStyle: 'italic'
                                                                                    }}>
                                                                                        alias: {followee.alias[0]}
                                                                                    </span>
                                                                                )}
                                                                                {currentUserHasPermission(PERM.MANAGE_VOTING_PERMISSION) && topicName && (
                                                                                    <button
                                                                                        disabled={actionBusy}
                                                                                        onClick={() => removeFollowee(followeeIdHex, topicName)}
                                                                                        style={{
                                                                                            backgroundColor: theme.colors.error,
                                                                                            color: theme.colors.primaryText,
                                                                                            border: 'none',
                                                                                            borderRadius: '4px',
                                                                                            padding: '2px 6px',
                                                                                            cursor: actionBusy ? 'not-allowed' : 'pointer',
                                                                                            fontSize: '12px',
                                                                                            marginLeft: 'auto'
                                                                                        }}
                                                                                        title="Remove this followee"
                                                                                    >
                                                                                        ✕
                                                                                    </button>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                    {currentUserHasPermission(PERM.MANAGE_VOTING_PERMISSION) && (
                                        <div style={{ marginTop: '12px', padding: '12px', backgroundColor: theme.colors.secondaryBg, borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div style={{ color: theme.colors.mutedText, fontWeight: 'bold' }}>Edit followees</div>
                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                    <button
                                                        onClick={() => {
                                                            setBulkMode(null);
                                                            setError('');
                                                        }}
                                                        style={{ 
                                                            backgroundColor: bulkMode === null ? theme.colors.accent : theme.colors.tertiaryBg, 
                                                            color: theme.colors.primaryText, 
                                                            border: `1px solid ${theme.colors.border}`, 
                                                            borderRadius: '4px', 
                                                            padding: '4px 8px', 
                                                            cursor: 'pointer',
                                                            fontSize: '11px'
                                                        }}
                                                    >
                                                        📝 Single
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setBulkMode('neurons');
                                                            setError('');
                                                        }}
                                                        style={{ 
                                                            backgroundColor: bulkMode === 'neurons' ? theme.colors.accent : theme.colors.tertiaryBg, 
                                                            color: theme.colors.primaryText, 
                                                            border: `1px solid ${theme.colors.border}`, 
                                                            borderRadius: '4px', 
                                                            padding: '4px 8px', 
                                                            cursor: 'pointer',
                                                            fontSize: '11px'
                                                        }}
                                                    >
                                                        📋 Bulk Neurons
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setBulkMode('topics');
                                                            setError('');
                                                        }}
                                                        style={{ 
                                                            backgroundColor: bulkMode === 'topics' ? theme.colors.accent : theme.colors.tertiaryBg, 
                                                            color: theme.colors.primaryText, 
                                                            border: `1px solid ${theme.colors.border}`, 
                                                            borderRadius: '4px', 
                                                            padding: '4px 8px', 
                                                            cursor: 'pointer',
                                                            fontSize: '11px'
                                                        }}
                                                    >
                                                        🔀 Bulk Topics
                                                    </button>
                                                </div>
                                            </div>
                                            {/* Single Mode - Add one neuron to one topic */}
                                            {bulkMode === null && (
                                                <>
                                                    <select
                                                        value={topicInput}
                                                        onChange={(e) => setTopicInput(e.target.value)}
                                                        style={{ backgroundColor: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}`, color: theme.colors.primaryText, borderRadius: '4px', padding: '6px 8px' }}
                                                    >
                                                        <option value="Governance">Governance</option>
                                                        <option value="DaoCommunitySettings">DaoCommunitySettings</option>
                                                        <option value="SnsFrameworkManagement">SnsFrameworkManagement</option>
                                                        <option value="DappCanisterManagement">DappCanisterManagement</option>
                                                        <option value="ApplicationBusinessLogic">ApplicationBusinessLogic</option>
                                                        <option value="TreasuryAssetManagement">TreasuryAssetManagement</option>
                                                        <option value="CriticalDappOperations">CriticalDappOperations</option>
                                                    </select>
                                                    <input
                                                        type="text"
                                                        placeholder="Followee Neuron ID (hex)"
                                                        value={followeeInput}
                                                        onChange={(e) => setFolloweeInput(e.target.value)}
                                                        style={{ backgroundColor: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}`, color: theme.colors.primaryText, borderRadius: '4px', padding: '6px 8px' }}
                                                    />
                                                    <input
                                                        type="text"
                                                        placeholder="Alias (optional)"
                                                        value={followeeAliasInput}
                                                        onChange={(e) => setFolloweeAliasInput(e.target.value)}
                                                        style={{ backgroundColor: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}`, color: theme.colors.primaryText, borderRadius: '4px', padding: '6px 8px' }}
                                                    />
                                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                        <button disabled={actionBusy} onClick={addFollowee} style={{ backgroundColor: theme.colors.accent, color: theme.colors.primaryText, border: 'none', borderRadius: '4px', padding: '6px 10px', cursor: actionBusy ? 'not-allowed' : 'pointer' }}>Add followee</button>
                                                        <button disabled={actionBusy} onClick={removeFollowee} style={{ backgroundColor: theme.colors.error, color: theme.colors.primaryText, border: 'none', borderRadius: '4px', padding: '6px 10px', cursor: actionBusy ? 'not-allowed' : 'pointer' }}>Remove followee</button>
                                                    </div>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                                        Current followees for {topicInput}: {getCurrentFolloweesForTopic(topicInput).map(f => f.alias || f.neuronId.substring(0, 8) + '...').join(', ') || 'None'}
                                                    </div>
                                                </>
                                            )}
                                            
                                            {/* Bulk Neurons Mode - Add many neurons to one topic */}
                                            {bulkMode === 'neurons' && (
                                                <>
                                                    <select
                                                        value={topicInput}
                                                        onChange={(e) => setTopicInput(e.target.value)}
                                                        style={{ backgroundColor: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}`, color: theme.colors.primaryText, borderRadius: '4px', padding: '6px 8px' }}
                                                    >
                                                        <option value="Governance">Governance</option>
                                                        <option value="DaoCommunitySettings">DaoCommunitySettings</option>
                                                        <option value="SnsFrameworkManagement">SnsFrameworkManagement</option>
                                                        <option value="DappCanisterManagement">DappCanisterManagement</option>
                                                        <option value="ApplicationBusinessLogic">ApplicationBusinessLogic</option>
                                                        <option value="TreasuryAssetManagement">TreasuryAssetManagement</option>
                                                        <option value="CriticalDappOperations">CriticalDappOperations</option>
                                                    </select>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginTop: '4px' }}>
                                                        Enter neuron IDs (one per line). Optional: add an alias after the ID separated by space.
                                                        <br />
                                                        Example: abc123def456 MyNeuronName
                                                    </div>
                                                    <textarea
                                                        placeholder="Paste neuron IDs here (one per line)&#10;Example:&#10;abc123def456 NeuronAlias1&#10;789ghi012jkl&#10;345mno678pqr AnotherNeuron"
                                                        value={bulkFolloweeInput}
                                                        onChange={(e) => setBulkFolloweeInput(e.target.value)}
                                                        style={{ 
                                                            backgroundColor: theme.colors.tertiaryBg, 
                                                            border: `1px solid ${theme.colors.border}`, 
                                                            color: theme.colors.primaryText, 
                                                            borderRadius: '4px', 
                                                            padding: '8px', 
                                                            minHeight: '120px',
                                                            fontFamily: 'monospace',
                                                            fontSize: '12px',
                                                            resize: 'vertical'
                                                        }}
                                                    />
                                                    <button 
                                                        disabled={actionBusy || !bulkFolloweeInput.trim()} 
                                                        onClick={bulkAddFollowees} 
                                                        style={{ 
                                                            backgroundColor: theme.colors.accent, 
                                                            color: theme.colors.primaryText, 
                                                            border: 'none', 
                                                            borderRadius: '4px', 
                                                            padding: '8px 12px', 
                                                            cursor: (actionBusy || !bulkFolloweeInput.trim()) ? 'not-allowed' : 'pointer',
                                                            fontWeight: 'bold'
                                                        }}
                                                    >
                                                        Add Multiple Followees to {topicInput}
                                                    </button>
                                                </>
                                            )}
                                            
                                            {/* Bulk Topics Mode - Add one neuron to many topics */}
                                            {bulkMode === 'topics' && (
                                                <>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                                        Follow one neuron across multiple topics at once
                                                    </div>
                                                    <input
                                                        type="text"
                                                        placeholder="Neuron ID (hex)"
                                                        value={bulkTopicsNeuronId}
                                                        onChange={(e) => setBulkTopicsNeuronId(e.target.value)}
                                                        style={{ backgroundColor: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}`, color: theme.colors.primaryText, borderRadius: '4px', padding: '6px 8px' }}
                                                    />
                                                    <input
                                                        type="text"
                                                        placeholder="Alias (optional)"
                                                        value={bulkTopicsAlias}
                                                        onChange={(e) => setBulkTopicsAlias(e.target.value)}
                                                        style={{ backgroundColor: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}`, color: theme.colors.primaryText, borderRadius: '4px', padding: '6px 8px' }}
                                                    />
                                                    <div style={{ 
                                                        display: 'grid', 
                                                        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', 
                                                        gap: '8px',
                                                        padding: '8px',
                                                        backgroundColor: theme.colors.tertiaryBg,
                                                        borderRadius: '4px'
                                                    }}>
                                                        {Object.entries(selectedTopics).map(([topic, isSelected]) => (
                                                            <label key={topic} style={{ 
                                                                display: 'flex', 
                                                                alignItems: 'center', 
                                                                gap: '6px',
                                                                color: theme.colors.primaryText,
                                                                cursor: 'pointer',
                                                                fontSize: '12px'
                                                            }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isSelected}
                                                                    onChange={(e) => setSelectedTopics({
                                                                        ...selectedTopics,
                                                                        [topic]: e.target.checked
                                                                    })}
                                                                    style={{ cursor: 'pointer' }}
                                                                />
                                                                {topic}
                                                            </label>
                                                        ))}
                                                    </div>
                                                    <button 
                                                        disabled={actionBusy || !bulkTopicsNeuronId.trim() || Object.values(selectedTopics).every(v => !v)} 
                                                        onClick={bulkAddToMultipleTopics} 
                                                        style={{ 
                                                            backgroundColor: theme.colors.accent, 
                                                            color: theme.colors.primaryText, 
                                                            border: 'none', 
                                                            borderRadius: '4px', 
                                                            padding: '8px 12px', 
                                                            cursor: (actionBusy || !bulkTopicsNeuronId.trim() || Object.values(selectedTopics).every(v => !v)) ? 'not-allowed' : 'pointer',
                                                            fontWeight: 'bold'
                                                        }}
                                                    >
                                                        Follow Across {Object.values(selectedTopics).filter(v => v).length} Topic(s)
                                                    </button>
                                                </>
                                            )}
                                            
                                            {actionMsg && <div style={{ color: theme.colors.mutedText }}>{actionMsg}</div>}
                                        </div>
                                    )}
                                        </>
                                    )}
                                </div>
                            </div>

                            {selectedSnsRoot === SNEED_SNS_ROOT && votingHistory && votingHistory.length > 0 && (
                                <div style={{ marginTop: '20px' }}>
                                    <div style={{ 
                                        display: 'flex', 
                                        justifyContent: 'space-between', 
                                        alignItems: 'center',
                                        marginBottom: '15px'
                                    }}>
                                        <h2 style={{ margin: 0 }}>Voting History ({votingHistory.length} votes)</h2>
                                        <button
                                            onClick={() => setIsVotingHistoryExpanded(!isVotingHistoryExpanded)}
                                            style={{
                                                backgroundColor: 'transparent',
                                                border: 'none',
                                                color: '#3498db',
                                                cursor: 'pointer',
                                                fontSize: '1.2em',
                                                padding: '5px 10px',
                                                borderRadius: '4px'
                                            }}
                                            title={isVotingHistoryExpanded ? 'Collapse voting history' : 'Expand voting history'}
                                        >
                                            {isVotingHistoryExpanded ? '▼' : '▶'}
                                        </button>
                                    </div>
                                    {isVotingHistoryExpanded && (
                                        <div style={{ backgroundColor: theme.colors.tertiaryBg, padding: '15px', borderRadius: '6px' }}>
                                            <div style={{
                                                display: 'flex',
                                                gap: '20px',
                                                marginBottom: '15px',
                                                padding: '10px',
                                                backgroundColor: theme.colors.secondaryBg,
                                                borderRadius: '4px',
                                                flexWrap: 'wrap',
                                                alignItems: 'center',
                                                justifyContent: 'space-between'
                                            }}>
                                                <div style={{
                                                    display: 'flex',
                                                    gap: '20px',
                                                    alignItems: 'center'
                                                }}>
                                                    <label style={{ 
                                                        display: 'flex', 
                                                        alignItems: 'center', 
                                                        gap: '8px',
                                                        color: '#2ecc71',
                                                        cursor: 'pointer'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={hideYes}
                                                            onChange={(e) => setHideYes(e.target.checked)}
                                                        />
                                                        Hide Yes
                                                    </label>
                                                    <label style={{ 
                                                        display: 'flex', 
                                                        alignItems: 'center', 
                                                        gap: '8px',
                                                        color: theme.colors.error,
                                                        cursor: 'pointer'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={hideNo}
                                                            onChange={(e) => setHideNo(e.target.checked)}
                                                        />
                                                        Hide No
                                                    </label>
                                                    <label style={{ 
                                                        display: 'flex', 
                                                        alignItems: 'center', 
                                                        gap: '8px',
                                                        color: theme.colors.mutedText,
                                                        cursor: 'pointer'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={hideNotVoted}
                                                            onChange={(e) => setHideNotVoted(e.target.checked)}
                                                        />
                                                        Hide Not Voted
                                                    </label>
                                                </div>
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px'
                                                }}>
                                                    <label style={{
                                                        color: theme.colors.mutedText,
                                                        fontSize: '14px'
                                                    }}>
                                                        Sort by:
                                                    </label>
                                                    <select
                                                        value={sortBy}
                                                        onChange={(e) => setSortBy(e.target.value)}
                                                        style={{
                                                            backgroundColor: theme.colors.tertiaryBg,
                                                            color: '#fff',
                                                            border: '1px solid #4a4a4a',
                                                            borderRadius: '4px',
                                                            padding: '4px 8px',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        <option value="proposalId">Proposal ID</option>
                                                        <option value="date">Date</option>
                                                        <option value="votingPower">Voting Power</option>
                                                    </select>
                                                </div>
                                            </div>
                                            {filterAndSortVotes(votingHistory).map((vote, index) => (
                                                <div 
                                                    key={index}
                                                    style={{
                                                        padding: '10px',
                                                        backgroundColor: theme.colors.secondaryBg,
                                                        marginBottom: '10px',
                                                        borderRadius: '4px'
                                                    }}
                                                >
                                                    <div style={{ 
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        alignItems: 'center',
                                                        marginBottom: '5px'
                                                    }}>
                                                        <div>
                                                            <strong>Proposal:</strong>{' '}
                                                            {formatProposalIdLink(vote.proposal_id, selectedSnsRoot)}
                                                        </div>
                                                        <div style={{ 
                                                            color: vote.vote === 1 ? '#2ecc71' : vote.vote === 2 ? '#e74c3c' : '#ffffff',
                                                            fontWeight: 'bold'
                                                        }}>
                                                            {formatVote(vote.vote)}
                                                        </div>
                                                    </div>
                                                    <div style={{ fontSize: '14px', color: '#888' }}>
                                                        <div>{vote.proposal_title || 'No title'}</div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px' }}>
                                                            <span>{vote.vote !== 0 ? new Date(Number(vote.timestamp) * 1000).toLocaleString() : ''}</span>
                                                            <span>{formatE8s(vote.voting_power)} VP</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </section>
            </main>
            <style>{spinKeyframes}</style>
        </div>
    );
}

export default Neuron; 