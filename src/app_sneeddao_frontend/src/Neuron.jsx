import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { useAuth } from './AuthContext';
import { useSns } from './contexts/SnsContext';
import Header from './components/Header';
import './Wallet.css';
import { fetchAndCacheSnsData, getSnsById, getAllSnses, clearSnsCache, fetchSnsLogo } from './utils/SnsUtils';
import { formatProposalIdLink, uint8ArrayToHex, getNeuronColor, getOwnerPrincipals, formatNeuronIdLink } from './utils/NeuronUtils';
import { useNaming } from './NamingContext';
import { useTheme } from './contexts/ThemeContext';
import { setNeuronNickname } from './utils/BackendUtils';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from './utils/PrincipalUtils';
import { Principal } from '@dfinity/principal';
import { HttpAgent } from '@dfinity/agent';
import { calculateVotingPower, formatVotingPower, VotingPowerCalculator } from './utils/VotingPowerUtils';
import NeuronInput from './components/NeuronInput';
import NeuronDisplay from './components/NeuronDisplay';
import PrincipalInput from './components/PrincipalInput';
import ConfirmDialog from './components/ConfirmDialog';
import TokenIcon from './components/TokenIcon';
import { FaSearch, FaCopy, FaExternalLinkAlt, FaEdit, FaCheck, FaTimes, FaChevronDown, FaChevronRight, FaUserShield, FaUsers, FaHistory, FaCrown, FaKey, FaPlus, FaTrash, FaLock, FaUnlock, FaClock, FaCoins, FaVoteYea, FaQuestion, FaCalendarAlt, FaPercent, FaChartLine, FaWallet, FaCheckCircle } from 'react-icons/fa';

// Accent colors
const neuronPrimary = '#6366f1';
const neuronSecondary = '#8b5cf6';
const neuronAccent = '#06b6d4';
const neuronGold = '#f59e0b';

// Custom CSS for animations
const customStyles = `
@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

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

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
}

@keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}

.neuron-card-animate {
    animation: fadeInUp 0.4s ease-out forwards;
}

.neuron-pulse {
    animation: pulse 2s ease-in-out infinite;
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
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const [votingHistory, setVotingHistory] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingSnses, setLoadingSnses] = useState(true);
    const [hideYes, setHideYes] = useState(false);
    const [hideNo, setHideNo] = useState(false);
    const [hideNotVoted, setHideNotVoted] = useState(false);
    const [sortBy, setSortBy] = useState('proposalId');
    const [isVotingHistoryExpanded, setIsVotingHistoryExpanded] = useState(false);
    const [isEditingNickname, setIsEditingNickname] = useState(false);
    const [nicknameInput, setNicknameInput] = useState('');
    const [inputError, setInputError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    const [nervousSystemParameters, setNervousSystemParameters] = useState(null);
    const [tokenSymbol, setTokenSymbol] = useState('');
    const [tokenLogo, setTokenLogo] = useState(null);
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
    const [bulkMode, setBulkMode] = useState(null); // Keep for backwards compat
    const [bulkFolloweeInput, setBulkFolloweeInput] = useState(''); // Keep for backwards compat
    const [bulkTopicsNeuronId, setBulkTopicsNeuronId] = useState(''); // Keep for backwards compat
    const [bulkTopicsAlias, setBulkTopicsAlias] = useState(''); // Keep for backwards compat
    const [neuronsToAdd, setNeuronsToAdd] = useState([]); // List of {neuronId, alias} to add
    const [currentNeuronToAdd, setCurrentNeuronToAdd] = useState(''); // Current input for adding to list
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
    const [showDissolveDelayDialog, setShowDissolveDelayDialog] = useState(false);
    const [dissolveDelayInput, setDissolveDelayInput] = useState('');
    
    // Dialog state for confirmations and alerts
    const [dialogConfig, setDialogConfig] = useState({
        isOpen: false,
        type: 'warning',
        title: '',
        message: '',
        confirmText: 'OK',
        cancelText: 'Cancel',
        confirmVariant: 'primary',
        showCancel: true,
        onConfirm: null
    });
    
    const showDialog = (config) => {
        setDialogConfig({
            isOpen: true,
            type: config.type || 'warning',
            title: config.title || 'Notice',
            message: config.message || '',
            confirmText: config.confirmText || 'OK',
            cancelText: config.cancelText || 'Cancel',
            confirmVariant: config.confirmVariant || 'primary',
            showCancel: config.showCancel !== undefined ? config.showCancel : !!config.onConfirm,
            onConfirm: config.onConfirm || null
        });
    };
    
    const closeDialog = () => {
        setDialogConfig(prev => ({ ...prev, isOpen: false }));
    };
    
    const { neuronNames, neuronNicknames, verifiedNames, fetchAllNames, principalNames, principalNicknames } = useNaming();

    // URL sync effects
    useEffect(() => {
        const snsParam = searchParams.get('sns');
        if (snsParam && snsParam !== selectedSnsRoot) {
            updateSelectedSns(snsParam);
        }
    }, [searchParams, selectedSnsRoot, updateSelectedSns]);

    useEffect(() => {
        const neuronIdParam = searchParams.get('neuronid');
        if (neuronIdParam && neuronIdParam !== currentNeuronId) {
            setNeuronData(null);
            setVotingHistory(null);
            setError('');
            setPrincipalDisplayInfo(new Map());
            setCurrentNeuronId(neuronIdParam);
            setNeuronIdInput(neuronIdParam);
        }
    }, [searchParams, currentNeuronId]);

    const getDisplayName = (neuronId) => {
        const mapKey = `${selectedSnsRoot}:${neuronId}`;
        const namesMap = new Map(Array.from(neuronNames.entries()));
        const nicknamesMap = new Map(Array.from(neuronNicknames.entries()));
        const verifiedMap = new Map(Array.from(verifiedNames.entries()));
        return {
            name: namesMap.get(mapKey),
            nickname: nicknamesMap.get(mapKey),
            isVerified: verifiedMap.get(mapKey)
        };
    };

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
                case 'proposalId': return Number(b.proposal_id) - Number(a.proposal_id);
                case 'date': return Number(b.timestamp) - Number(a.timestamp);
                case 'votingPower': return Number(b.voting_power) - Number(a.voting_power);
                default: return 0;
            }
        });
    };

    useEffect(() => {
        async function loadSnsData() {
            setLoadingSnses(true);
            try {
                const data = await fetchAndCacheSnsData(identity);
                setSnsList(data);
                await fetchAllNames();
            } catch (err) {
                console.error('Error loading SNS data:', err);
                setError('Failed to load SNS list');
            } finally {
                setLoadingSnses(false);
            }
        }
        if (isAuthenticated) {
            loadSnsData();
        }
    }, [isAuthenticated, identity]);

    useEffect(() => {
        if (currentNeuronId && selectedSnsRoot) {
            fetchNeuronData();
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
                agentOptions: { identity },
            });
            const neuronIdBytes = new Uint8Array(currentNeuronId.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            const neuronIdArg = { neuron_id: [{ id: Array.from(neuronIdBytes) }] };
            const response = await snsGovActor.get_neuron(neuronIdArg);
            if (response?.result?.[0]?.Neuron) {
                setNeuronData(response.result[0].Neuron);
                await fetchAllNames();
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
            const neuronIdBytes = new Uint8Array(currentNeuronId.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            const history = await rllActor.get_neuron_voting_history(Array.from(neuronIdBytes));
            setVotingHistory(history);
        } catch (err) {
            console.error('Error fetching voting history:', err);
            setVotingHistory([]);
        }
    };

    const isValidNeuronId = (neuronIdStr) => {
        if (!neuronIdStr || typeof neuronIdStr !== 'string') return false;
        const hexPattern = /^(0x)?[0-9a-fA-F]+$/;
        if (hexPattern.test(neuronIdStr)) {
            const cleanHex = neuronIdStr.replace(/^0x/, '');
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
        setSearchParams({ neuronid: neuronIdInput, sns: selectedSnsRoot });
        setCurrentNeuronId(neuronIdInput);
    };

    useEffect(() => {
        const trimmedInput = neuronIdInput.trim();
        if (trimmedInput && selectedSnsRoot && isValidNeuronId(trimmedInput)) {
            const timeoutId = setTimeout(() => {
                setError('');
                setSearchParams({ neuronid: trimmedInput, sns: selectedSnsRoot });
                setCurrentNeuronId(trimmedInput);
            }, 500);
            return () => clearTimeout(timeoutId);
        }
    }, [neuronIdInput, selectedSnsRoot, setSearchParams]);

    const handleSnsChange = (newSnsRoot) => {
        updateSelectedSns(newSnsRoot);
        setSearchParams(prev => {
            prev.set('sns', newSnsRoot);
            if (currentNeuronId) prev.set('neuronid', currentNeuronId);
            return prev;
        });
    };

    const formatE8s = (e8s) => (Number(e8s) / 100000000).toFixed(8);

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
            if (dissolveTime <= now) return 'Dissolved';
            const daysLeft = Math.floor((dissolveTime - now) / (24 * 60 * 60));
            return `Dissolving (${daysLeft} days left)`;
        }
        return 'Unknown';
    };

    const getDissolveDelaySeconds = (neuron) => {
        const dissolveState = neuron.dissolve_state?.[0];
        if (!dissolveState) return 0;
        if ('DissolveDelaySeconds' in dissolveState) {
            return Number(dissolveState.DissolveDelaySeconds);
        } else if ('WhenDissolvedTimestampSeconds' in dissolveState) {
            const dissolveTime = Number(dissolveState.WhenDissolvedTimestampSeconds);
            const now = Date.now() / 1000;
            if (dissolveTime > now) return dissolveTime - now;
        }
        return 0;
    };

    const selectedSns = getSnsById(selectedSnsRoot);

    const currentUserHasPermission = (permInt) => {
        if (!neuronData || !identity) return false;
        const me = identity.getPrincipal()?.toString();
        return neuronData.permissions?.some(p => p.principal?.toString() === me && p.permission_type?.includes(permInt));
    };

    const PERM = {
        UNSPECIFIED: 0, CONFIGURE_DISSOLVE_STATE: 1, MANAGE_PRINCIPALS: 2, SUBMIT_PROPOSAL: 3,
        VOTE: 4, DISBURSE: 5, SPLIT: 6, MERGE_MATURITY: 7, DISBURSE_MATURITY: 8, STAKE_MATURITY: 9, MANAGE_VOTING_PERMISSION: 10
    };

    const PERMISSION_INFO = {
        unspecified: { value: PERM.UNSPECIFIED, label: 'Unspecified', icon: '❓', description: 'Legacy/unspecified permission' },
        configureDissolveState: { value: PERM.CONFIGURE_DISSOLVE_STATE, label: 'Configure Dissolve State', icon: '⏱️', description: 'Start/stop dissolving, change delay' },
        managePrincipals: { value: PERM.MANAGE_PRINCIPALS, label: 'Manage Principals', icon: '👥', description: 'Add or remove principals' },
        submitProposal: { value: PERM.SUBMIT_PROPOSAL, label: 'Submit Proposals', icon: '📝', description: 'Create and submit proposals' },
        vote: { value: PERM.VOTE, label: 'Vote', icon: '🗳️', description: 'Vote on proposals (hotkey)' },
        disburse: { value: PERM.DISBURSE, label: 'Disburse', icon: '💰', description: 'Disburse neuron stake' },
        split: { value: PERM.SPLIT, label: 'Split Neuron', icon: '✂️', description: 'Split into multiple neurons' },
        mergeMaturity: { value: PERM.MERGE_MATURITY, label: 'Merge Maturity', icon: '🔗', description: 'Merge maturity into stake' },
        disburseMaturity: { value: PERM.DISBURSE_MATURITY, label: 'Disburse Maturity', icon: '💸', description: 'Disburse maturity' },
        stakeMaturity: { value: PERM.STAKE_MATURITY, label: 'Stake Maturity', icon: '🎯', description: 'Stake maturity' },
        manageVotingPermission: { value: PERM.MANAGE_VOTING_PERMISSION, label: 'Manage Voting Permission', icon: '🔐', description: 'Manage followees' }
    };

    const manageNeuron = async (command) => {
        if (!selectedSnsRoot || !identity || !currentNeuronId) return { ok: false, err: 'Missing context' };
        try {
            const selectedSns = getSnsById(selectedSnsRoot);
            if (!selectedSns) return { ok: false, err: 'SNS not found' };
            const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, { agentOptions: { identity } });
            const neuronIdBytes = new Uint8Array(currentNeuronId.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            const req = { subaccount: Array.from(neuronIdBytes), command: [command] };
            const resp = await snsGovActor.manage_neuron(req);
            if (resp?.command?.[0]?.Error) return { ok: false, err: resp.command[0].Error.error_message };
            return { ok: true };
        } catch (e) {
            return { ok: false, err: e.message || String(e) };
        }
    };

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

    const getPermissionsFromArray = (permsArray) => ({
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
    });

    const savePrincipalPermissions = async () => {
        try {
            setActionBusy(true); setActionMsg('Updating permissions...'); setError('');
            const principal = Principal.fromText(managePrincipalInput);
            const userPrincipal = identity?.getPrincipal()?.toString();
            if (userPrincipal && principal.toString() === userPrincipal) {
                setError('You cannot modify your own permissions.');
                setActionBusy(false); setActionMsg('');
                return;
            }
            const newPerms = getPermissionsArray(selectedPermissions);
            if (editingPrincipal) {
                const existingPerms = editingPrincipal.permission_type || [];
                if (existingPerms.length > 0) {
                    const removeResult = await manageNeuron({
                        RemoveNeuronPermissions: { principal_id: [principal], permissions_to_remove: [{ permissions: existingPerms }] }
                    });
                    if (!removeResult.ok) { setError(removeResult.err); setActionBusy(false); setActionMsg(''); return; }
                }
            }
            if (newPerms.length > 0) {
                const result = await manageNeuron({
                    AddNeuronPermissions: { principal_id: [principal], permissions_to_add: [{ permissions: newPerms }] }
                });
                if (!result.ok) { setError(result.err); } 
                else { await fetchNeuronData(); setManagePrincipalInput(''); setEditingPrincipal(null); resetPermissions(); }
            } else if (editingPrincipal) {
                await fetchNeuronData(); setManagePrincipalInput(''); setEditingPrincipal(null); resetPermissions();
            } else {
                setError('Please select at least one permission');
            }
        } catch (e) { setError(e.message || String(e)); }
        finally { setActionBusy(false); setActionMsg(''); }
    };

    const removePrincipal = async (principalStr, perms) => {
        try {
            // Safety check: prevent removing the last principal
            if (neuronData?.permissions?.length === 1) {
                setError('Cannot remove the last principal - this would permanently lock you out of the neuron!');
                return;
            }
            // Safety check: prevent removing the last principal with management permissions
            const managersCount = neuronData?.permissions?.filter(p => 
                p.permission_type?.includes(PERM.MANAGE_PRINCIPALS)
            ).length || 0;
            if (managersCount === 1 && perms?.includes(PERM.MANAGE_PRINCIPALS)) {
                setError('Cannot remove the last principal with management permissions!');
                return;
            }
            
            setActionBusy(true); setActionMsg('Removing principal...'); setError('');
            const principal = Principal.fromText(principalStr);
            const result = await manageNeuron({
                RemoveNeuronPermissions: { principal_id: [principal], permissions_to_remove: [{ permissions: perms }] }
            });
            if (!result.ok) setError(result.err); else await fetchNeuronData();
        } catch (e) { setError(e.message || String(e)); }
        finally { setActionBusy(false); setActionMsg(''); }
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
        resetPermissions();
    };

    const resetPermissions = () => {
        setSelectedPermissions({
            unspecified: false, configureDissolveState: true, managePrincipals: true, submitProposal: true,
            vote: true, disburse: false, split: false, mergeMaturity: false, disburseMaturity: false, stakeMaturity: false, manageVotingPermission: true
        });
    };

    const makeFullOwner = () => {
        setSelectedPermissions({
            unspecified: true, configureDissolveState: true, managePrincipals: true, submitProposal: true,
            vote: true, disburse: true, split: true, mergeMaturity: true, disburseMaturity: true, stakeMaturity: true, manageVotingPermission: true
        });
    };

    const makeHotkey = () => {
        setSelectedPermissions({
            unspecified: false, configureDissolveState: false, managePrincipals: false, submitProposal: true,
            vote: true, disburse: false, split: false, mergeMaturity: false, disburseMaturity: false, stakeMaturity: false, manageVotingPermission: false
        });
    };

    const getPrincipalSymbol = (perms) => {
        const permArray = perms.permission_type || [];
        const permCount = permArray.length;
        if (permCount === 10 || permCount === 11) return { icon: <FaCrown />, title: 'Full Owner', color: neuronGold };
        const hasSubmit = permArray.includes(PERM.SUBMIT_PROPOSAL);
        const hasVote = permArray.includes(PERM.VOTE);
        if (permCount === 2 && hasSubmit && hasVote) return { icon: <FaKey />, title: 'Hotkey', color: neuronAccent };
        if (permCount === 1 && hasVote) return { icon: <FaVoteYea />, title: 'Voter', color: '#10b981' };
        if (permArray.includes(PERM.MANAGE_PRINCIPALS)) return { icon: <FaUserShield />, title: 'Manager', color: neuronPrimary };
        if (permArray.includes(PERM.DISBURSE) || permArray.includes(PERM.DISBURSE_MATURITY)) return { icon: <FaCoins />, title: 'Financial', color: '#f59e0b' };
        return { icon: <FaQuestion />, title: 'Custom', color: theme.colors.mutedText };
    };

    // Followees helpers
    const hexToBytes = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
    
    const getCurrentFolloweesForTopic = (topicName) => {
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
            const newFollowee = {
                neuron_id: [{ id: Array.from(hexToBytes(followeeInput.trim())) }],
                alias: followeeAliasInput.trim() ? [followeeAliasInput.trim()] : []
            };
            const allFollowees = [...existing.map(f => ({
                neuron_id: [{ id: Array.from(hexToBytes(f.neuronId)) }],
                alias: f.alias ? [f.alias] : []
            })), newFollowee];
            const result = await manageNeuron({
                SetFollowing: { topic_following: [{ topic: [{ [topicInput]: null }], followees: allFollowees }] }
            });
            if (!result.ok) setError(result.err); else { await fetchNeuronData(); setFolloweeInput(''); setFolloweeAliasInput(''); }
        } catch (e) { setError(e.message || String(e)); }
        finally { setActionBusy(false); setActionMsg(''); }
    };

    const removeFollowee = async (neuronIdHex, specificTopic) => {
        try {
            setActionBusy(true); setActionMsg('Updating followees...'); setError('');
            const targetTopic = specificTopic || topicInput;
            const existing = getCurrentFolloweesForTopic(targetTopic);
            const filtered = existing.filter(f => f.neuronId !== neuronIdHex);
            const allFollowees = filtered.map(f => ({
                neuron_id: [{ id: Array.from(hexToBytes(f.neuronId)) }],
                alias: f.alias ? [f.alias] : []
            }));
            const result = await manageNeuron({
                SetFollowing: { topic_following: [{ topic: [{ [targetTopic]: null }], followees: allFollowees }] }
            });
            if (!result.ok) setError(result.err); else await fetchNeuronData();
        } catch (e) { setError(e.message || String(e)); }
        finally { setActionBusy(false); setActionMsg(''); }
    };

    // Bulk add multiple neurons to one topic
    const bulkAddFollowees = async () => {
        try {
            setActionBusy(true); setActionMsg('Adding multiple followees...'); setError('');
            const lines = bulkFolloweeInput.split('\n').filter(line => line.trim());
            if (lines.length === 0) { setError('Please enter at least one neuron ID'); return; }
            
            const existing = getCurrentFolloweesForTopic(topicInput);
            const existingIds = new Set(existing.map(f => f.neuronId.toLowerCase()));
            const newFollowees = [];
            const errors = [];
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                const parts = line.split(/\s+/);
                const neuronId = parts[0];
                const alias = parts.slice(1).join(' ');
                
                if (!/^[0-9a-fA-F]+$/.test(neuronId)) {
                    errors.push(`Line ${i + 1}: Invalid neuron ID format "${neuronId}"`);
                    continue;
                }
                if (existingIds.has(neuronId.toLowerCase())) continue;
                
                newFollowees.push({
                    neuron_id: [{ id: Array.from(hexToBytes(neuronId)) }],
                    alias: alias ? [alias] : []
                });
                existingIds.add(neuronId.toLowerCase());
            }
            
            if (errors.length > 0) { setError(errors.join('\n')); return; }
            if (newFollowees.length === 0) { setError('No new followees to add (all may already be followed)'); return; }
            
            const allFollowees = [
                ...existing.map(f => ({
                    neuron_id: [{ id: Array.from(hexToBytes(f.neuronId)) }],
                    alias: f.alias ? [f.alias] : []
                })),
                ...newFollowees
            ];
            
            const result = await manageNeuron({
                SetFollowing: { topic_following: [{ topic: [{ [topicInput]: null }], followees: allFollowees }] }
            });
            
            if (!result.ok) { setError(result.err); }
            else { 
                await fetchNeuronData(); 
                setBulkFolloweeInput(''); 
                showDialog({
                    type: 'success',
                    title: 'Followees Added',
                    message: `Successfully added ${newFollowees.length} followee(s) to ${topicInput}`,
                    confirmText: 'OK',
                    showCancel: false
                });
            }
        } catch (e) { setError(e.message || String(e)); }
        finally { setActionBusy(false); setActionMsg(''); }
    };

    // Bulk add one neuron to multiple topics
    const bulkAddToMultipleTopics = async () => {
        try {
            setActionBusy(true); setActionMsg('Adding neuron to multiple topics...'); setError('');
            const neuronId = bulkTopicsNeuronId.trim();
            
            if (!neuronId) { setError('Please enter a neuron ID'); return; }
            if (!/^[0-9a-fA-F]+$/.test(neuronId)) { setError('Invalid neuron ID format'); return; }
            
            const topicsToFollow = Object.entries(selectedTopics).filter(([_, isSelected]) => isSelected).map(([topic]) => topic);
            if (topicsToFollow.length === 0) { setError('Please select at least one topic'); return; }
            
            const followeeObj = {
                neuron_id: [{ id: Array.from(hexToBytes(neuronId)) }],
                alias: bulkTopicsAlias.trim() ? [bulkTopicsAlias.trim()] : []
            };
            
            const topicFollowingArray = [];
            let addedCount = 0, skippedCount = 0;
            
            for (const topic of topicsToFollow) {
                const existing = getCurrentFolloweesForTopic(topic);
                const existingIds = new Set(existing.map(f => f.neuronId.toLowerCase()));
                
                if (existingIds.has(neuronId.toLowerCase())) { skippedCount++; continue; }
                
                const allFollowees = [
                    ...existing.map(f => ({
                        neuron_id: [{ id: Array.from(hexToBytes(f.neuronId)) }],
                        alias: f.alias ? [f.alias] : []
                    })),
                    followeeObj
                ];
                
                topicFollowingArray.push({ topic: [{ [topic]: null }], followees: allFollowees });
                addedCount++;
            }
            
            if (topicFollowingArray.length === 0) { setError('Neuron is already followed in all selected topics'); return; }
            
            const result = await manageNeuron({ SetFollowing: { topic_following: topicFollowingArray } });
            
            if (!result.ok) { setError(result.err); }
            else {
                await fetchNeuronData();
                setBulkTopicsNeuronId(''); setBulkTopicsAlias('');
                const message = `Successfully added neuron to ${addedCount} topic(s)` + (skippedCount > 0 ? ` (skipped ${skippedCount} where already following)` : '');
                showDialog({
                    type: 'success',
                    title: 'Followees Added',
                    message: message,
                    confirmText: 'OK',
                    showCancel: false
                });
            }
        } catch (e) { setError(e.message || String(e)); }
        finally { setActionBusy(false); setActionMsg(''); }
    };

    // Unified add: add all neurons in neuronsToAdd list to all selected topics
    const addNeuronsToSelectedTopics = async () => {
        try {
            if (neuronsToAdd.length === 0) { setError('Please add at least one neuron to the list'); return; }
            const topicsToFollow = Object.entries(selectedTopics).filter(([_, isSelected]) => isSelected).map(([topic]) => topic);
            if (topicsToFollow.length === 0) { setError('Please select at least one topic'); return; }
            
            setActionBusy(true); setActionMsg('Adding followees...'); setError('');
            
            const topicFollowingArray = [];
            let totalAdded = 0;
            
            for (const topic of topicsToFollow) {
                const existing = getCurrentFolloweesForTopic(topic);
                const existingIds = new Set(existing.map(f => f.neuronId.toLowerCase()));
                
                const newFollowees = neuronsToAdd.filter(n => !existingIds.has(n.neuronId.toLowerCase()));
                if (newFollowees.length === 0) continue;
                
                const allFollowees = [
                    ...existing.map(f => ({
                        neuron_id: [{ id: Array.from(hexToBytes(f.neuronId)) }],
                        alias: f.alias ? [f.alias] : []
                    })),
                    ...newFollowees.map(n => ({
                        neuron_id: [{ id: Array.from(hexToBytes(n.neuronId)) }],
                        alias: n.alias ? [n.alias] : []
                    }))
                ];
                
                topicFollowingArray.push({ topic: [{ [topic]: null }], followees: allFollowees });
                totalAdded += newFollowees.length;
            }
            
            if (topicFollowingArray.length === 0) { 
                setError('All neurons are already followed in all selected topics'); 
                setActionBusy(false); setActionMsg('');
                return; 
            }
            
            const result = await manageNeuron({ SetFollowing: { topic_following: topicFollowingArray } });
            
            if (!result.ok) { setError(result.err); }
            else {
                await fetchNeuronData();
                setNeuronsToAdd([]);
                showDialog({
                    type: 'success',
                    title: 'Followees Added',
                    message: `Successfully added ${totalAdded} followee(s) across ${topicFollowingArray.length} topic(s)`,
                    confirmText: 'OK',
                    showCancel: false
                });
            }
        } catch (e) { setError(e.message || String(e)); }
        finally { setActionBusy(false); setActionMsg(''); }
    };

    const formatVote = (voteNumber) => {
        switch (voteNumber) {
            case 1: return 'Yes';
            case 2: return 'No';
            default: return 'Not Voted';
        }
    };

    const validateNameInput = (input) => {
        if (input.length > 32) return "Name must not exceed 32 characters";
        const validPattern = /^[a-zA-Z0-9\s\-_.']*$/;
        if (!validPattern.test(input)) return "Only alphanumeric characters, spaces, hyphens, underscores, dots, and apostrophes are allowed";
        return "";
    };

    const handleNicknameSubmit = async () => {
        const error = validateNameInput(nicknameInput);
        if (error) { setInputError(error); return; }
        if (!nicknameInput.trim() || !identity || !currentNeuronId) return;
        setIsSubmitting(true);
        try {
            const response = await setNeuronNickname(identity, selectedSnsRoot, currentNeuronId, nicknameInput);
            if ('ok' in response) { await fetchAllNames(); setInputError(''); }
            else { setError(response.err); }
        } catch (err) {
            console.error('Error setting neuron nickname:', err);
            setError('Failed to set neuron nickname');
        } finally {
            setIsSubmitting(false);
            setIsEditingNickname(false);
            setNicknameInput('');
        }
    };

    useEffect(() => {
        const fetchPrincipalInfo = () => {
            if (!neuronData?.permissions || !principalNames || !principalNicknames) return;
            const uniquePrincipals = new Set();
            getOwnerPrincipals(neuronData).forEach(p => uniquePrincipals.add(p));
            neuronData.permissions.forEach(p => { if (p.principal) uniquePrincipals.add(p.principal.toString()); });
            const displayInfoMap = new Map();
            Array.from(uniquePrincipals).forEach(principal => {
                const displayInfo = getPrincipalDisplayInfoFromContext(Principal.fromText(principal), principalNames, principalNicknames);
                displayInfoMap.set(principal, displayInfo);
            });
            setPrincipalDisplayInfo(displayInfoMap);
        };
        fetchPrincipalInfo();
    }, [neuronData, principalNames, principalNicknames]);

    useEffect(() => {
        if (!neuronData) return;
        const hasFollowees = neuronData.followees && neuronData.followees.length > 0;
        const hasTopicFollowees = neuronData.topic_followees?.[0]?.topic_id_to_followees?.length > 0;
        if (hasFollowees || hasTopicFollowees) setIsFolloweesExpanded(true);
    }, [neuronData]);

    useEffect(() => {
        const fetchNervousSystemParameters = async () => {
            if (!selectedSnsRoot || !identity) return;
            try {
                const selectedSns = getSnsById(selectedSnsRoot);
                if (!selectedSns) return;
                const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, { agentOptions: { identity } });
                const params = await snsGovActor.get_nervous_system_parameters(null);
                setNervousSystemParameters(params);
            } catch (error) { console.error('Error fetching nervous system parameters:', error); }
        };
        fetchNervousSystemParameters();
    }, [selectedSnsRoot, identity]);

    // Fetch token symbol from ledger
    useEffect(() => {
        const fetchTokenSymbol = async () => {
            if (!selectedSnsRoot) return;
            try {
                const selectedSns = getSnsById(selectedSnsRoot);
                if (!selectedSns?.canisters?.ledger) return;
                
                const ledgerActor = createIcrc1Actor(selectedSns.canisters.ledger, {});
                const metadata = await ledgerActor.icrc1_metadata();
                
                // Find the symbol in metadata
                const symbolEntry = metadata.find(([key]) => key === 'icrc1:symbol');
                if (symbolEntry && symbolEntry[1]?.Text) {
                    setTokenSymbol(symbolEntry[1].Text);
                } else {
                    // Fallback to SNS name
                    setTokenSymbol(selectedSns.name || 'SNS');
                }
            } catch (error) {
                console.error('Error fetching token symbol:', error);
                // Fallback to SNS name on error
                const selectedSns = getSnsById(selectedSnsRoot);
                setTokenSymbol(selectedSns?.name || 'SNS');
            }
        };
        fetchTokenSymbol();
    }, [selectedSnsRoot]);

    // Fetch token logo from governance
    useEffect(() => {
        const loadTokenLogo = async () => {
            if (!selectedSnsRoot) return;
            try {
                const selectedSns = getSnsById(selectedSnsRoot);
                if (!selectedSns?.canisters?.governance) return;
                
                const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                    ? 'https://ic0.app' 
                    : 'http://localhost:4943';
                const agent = new HttpAgent({ host });
                if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                    await agent.fetchRootKey();
                }
                
                const logo = await fetchSnsLogo(selectedSns.canisters.governance, agent);
                if (logo) {
                    setTokenLogo(logo);
                }
            } catch (error) {
                console.error('Error fetching token logo:', error);
            }
        };
        loadTokenLogo();
    }, [selectedSnsRoot]);

    // Card style helper
    const cardStyle = {
        background: theme.colors.secondaryBg,
        borderRadius: '16px',
        border: `1px solid ${theme.colors.border}`,
        padding: '1.5rem',
        marginBottom: '1rem'
    };

    const sectionHeaderStyle = {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
        padding: '1rem 1.25rem',
        background: theme.colors.primaryBg,
        borderRadius: '12px',
        border: `1px solid ${theme.colors.border}`,
        marginBottom: '1rem',
        transition: 'all 0.2s ease'
    };

    return (
        <div className='page-container'>
            <style>{customStyles}</style>
            <Header showSnsDropdown={true} />
            
            <main style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${neuronPrimary}15 50%, ${neuronSecondary}10 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    padding: '2rem 1.5rem',
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    {/* Background decorations */}
                    <div style={{
                        position: 'absolute', top: '-50%', right: '-10%', width: '400px', height: '400px',
                        background: `radial-gradient(circle, ${neuronPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%', pointerEvents: 'none'
                    }} />
                    <div style={{
                        position: 'absolute', bottom: '-30%', left: '-5%', width: '300px', height: '300px',
                        background: `radial-gradient(circle, ${neuronSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%', pointerEvents: 'none'
                    }} />
                    
                    <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                            <div style={{
                                width: '56px', height: '56px', borderRadius: '14px',
                                minWidth: '56px', maxWidth: '56px', flexShrink: 0,
                                overflow: 'hidden'
                            }}>
                                {tokenLogo ? (
                                    <img src={tokenLogo} alt="SNS" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                    <div style={{
                                        width: '100%', height: '100%',
                                        background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        boxShadow: `0 4px 20px ${neuronPrimary}40`
                                    }}>
                                        <FaUserShield size={24} color="white" />
                                    </div>
                                )}
                            </div>
                            <div>
                                <h1 style={{ color: theme.colors.primaryText, fontSize: '1.75rem', fontWeight: '700', margin: 0 }}>
                                    Neuron Details
                                </h1>
                                <p style={{ color: theme.colors.secondaryText, fontSize: '0.95rem', margin: '0.25rem 0 0 0' }}>
                                    View and manage SNS neuron information
                                </p>
                            </div>
                            <Link 
                                to="/help/neurons"
                                style={{
                                    marginLeft: 'auto', padding: '0.5rem 1rem', borderRadius: '8px',
                                    background: `${neuronPrimary}15`, color: neuronPrimary,
                                    textDecoration: 'none', fontSize: '0.85rem', fontWeight: '500',
                                    display: 'flex', alignItems: 'center', gap: '0.5rem'
                                }}
                            >
                                <FaQuestion size={12} /> Help
                            </Link>
                        </div>
                        
                        {/* Did you know banner */}
                        <div style={{
                            background: `linear-gradient(135deg, ${neuronAccent}15, ${theme.colors.success}10)`,
                            border: `1px solid ${neuronAccent}30`,
                            borderRadius: '12px', padding: '1rem 1.25rem',
                            display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap'
                        }}>
                            <div style={{ flex: 1, minWidth: '200px' }}>
                                <div style={{ color: neuronAccent, fontWeight: '700', marginBottom: '4px', fontSize: '0.9rem' }}>
                                    💡 Did you know?
                                </div>
                                <div style={{ color: theme.colors.secondaryText, fontSize: '0.85rem', lineHeight: '1.5' }}>
                                    Create <strong>transferable SNS neurons</strong> with our Liquid Staking wizard!
                                </div>
                            </div>
                            <Link to="/liquid_staking" style={{
                                background: neuronAccent, color: '#fff', padding: '0.6rem 1.25rem',
                                borderRadius: '8px', textDecoration: 'none', fontWeight: '600', fontSize: '0.85rem', whiteSpace: 'nowrap'
                            }}>
                                Learn More →
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div style={{ maxWidth: '900px', margin: '0 auto', padding: '1.5rem' }}>
                    {/* Search Section - only show when searching or no neuron data */}
                    {(isSearchFocused || !neuronData) && (
                        <div className="neuron-card-animate" style={{ ...cardStyle, opacity: 0, animationDelay: '0.1s' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                                <div style={{
                                    width: '36px', height: '36px', borderRadius: '10px',
                                    background: `linear-gradient(135deg, ${neuronPrimary}30, ${neuronSecondary}20)`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: neuronPrimary
                                }}>
                                    <FaSearch size={16} />
                                </div>
                                <h2 style={{ color: theme.colors.primaryText, fontSize: '1.1rem', fontWeight: '600', margin: 0 }}>
                                    Search Neuron
                                </h2>
                            </div>
                            <div style={{ maxWidth: '500px' }}>
                                <NeuronInput
                                    value={neuronIdInput}
                                    onChange={setNeuronIdInput}
                                    placeholder="Enter neuron ID or search by name/nickname"
                                    snsRoot={selectedSnsRoot}
                                    defaultTab="all"
                                    onFocus={() => setIsSearchFocused(true)}
                                    onBlur={() => setIsSearchFocused(false)}
                                    autoFocus={isSearchFocused && !!neuronData}
                                />
                            </div>
                            {error && (
                                <div style={{
                                    marginTop: '1rem', padding: '0.75rem 1rem', borderRadius: '8px',
                                    background: `${theme.colors.error}15`, border: `1px solid ${theme.colors.error}30`,
                                    color: theme.colors.error, fontSize: '0.9rem'
                                }}>
                                    {error}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Loading State */}
                    {loading && (
                        <div style={{
                            ...cardStyle, textAlign: 'center', padding: '3rem'
                        }}>
                            <div className="neuron-pulse" style={{
                                width: '56px', height: '56px', borderRadius: '50%', margin: '0 auto 1rem',
                                background: `linear-gradient(135deg, ${neuronPrimary}30, ${neuronSecondary}20)`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}>
                                <FaUserShield size={24} style={{ color: neuronPrimary }} />
                            </div>
                            <p style={{ color: theme.colors.secondaryText, margin: 0 }}>Loading neuron data...</p>
                        </div>
                    )}

                    {/* Neuron Data - hide when search is focused */}
                    {neuronData && !loading && !isSearchFocused && (
                        <>
                            {/* Neuron Identity Card */}
                            <div className="neuron-card-animate" style={{ ...cardStyle, opacity: 0, animationDelay: '0.2s' }}>
                                {/* Search different neuron button */}
                                <button
                                    onClick={() => setIsSearchFocused(true)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                                        background: 'none', border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '8px', padding: '0.5rem 0.75rem',
                                        color: theme.colors.secondaryText, cursor: 'pointer',
                                        fontSize: '0.85rem', marginBottom: '1rem',
                                        transition: 'all 0.2s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.target.style.borderColor = neuronPrimary;
                                        e.target.style.color = neuronPrimary;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.target.style.borderColor = theme.colors.border;
                                        e.target.style.color = theme.colors.secondaryText;
                                    }}
                                >
                                    <FaSearch size={12} /> Search different neuron
                                </button>
                                
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                                    <div style={{ flex: 1, minWidth: '200px' }}>
                                        {/* Name/Nickname */}
                                        {(() => {
                                            const { name, nickname, isVerified } = getDisplayName(currentNeuronId);
                                            const neuronColor = getNeuronColor(currentNeuronId);
                                            return (
                                                <>
                                                    {name && (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                            <span style={{ color: neuronColor, fontSize: '1.5rem', fontWeight: '700' }}>{name}</span>
                                                            {isVerified && <span title="Verified" style={{ color: '#10b981' }}>✓</span>}
                                                        </div>
                                                    )}
                                                    {nickname && (
                                                        <div style={{ color: neuronColor, fontSize: '1rem', fontStyle: 'italic', opacity: 0.8, marginBottom: '0.5rem' }}>
                                                            {nickname}
                                                        </div>
                                                    )}
                                                </>
                                            );
                                        })()}
                                        
                                        {/* Neuron ID */}
                                        <div style={{
                                            fontFamily: 'monospace', fontSize: '0.8rem', color: theme.colors.mutedText,
                                            wordBreak: 'break-all', lineHeight: '1.5', padding: '0.75rem',
                                            background: theme.colors.primaryBg, borderRadius: '8px',
                                            display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap'
                                        }}>
                                            <span style={{ flex: 1, minWidth: '200px' }}>{currentNeuronId}</span>
                                            <button
                                                onClick={() => navigator.clipboard.writeText(currentNeuronId)}
                                                style={{
                                                    background: 'none', border: 'none', padding: '4px', cursor: 'pointer',
                                                    color: theme.colors.mutedText, display: 'flex', alignItems: 'center'
                                                }}
                                                title="Copy neuron ID"
                                            >
                                                <FaCopy size={14} />
                                            </button>
                                            <a
                                                href={`https://dashboard.internetcomputer.org/sns/${selectedSnsRoot}/neuron/${currentNeuronId}`}
                                                target="_blank" rel="noopener noreferrer"
                                                style={{
                                                    color: neuronPrimary, display: 'flex', alignItems: 'center', gap: '4px',
                                                    fontSize: '0.8rem', textDecoration: 'none'
                                                }}
                                            >
                                                <FaExternalLinkAlt size={12} /> Dashboard
                                            </a>
                                        </div>
                                        
                                        {/* Nickname editing */}
                                        {isAuthenticated && (
                                            <div style={{ marginTop: '0.75rem' }}>
                                                {isEditingNickname ? (
                                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                        <input
                                                            type="text" value={nicknameInput}
                                                            onChange={(e) => { setNicknameInput(e.target.value); setInputError(validateNameInput(e.target.value)); }}
                                                            maxLength={32} placeholder="Enter nickname"
                                                            style={{
                                                                flex: 1, minWidth: '150px', padding: '0.5rem 0.75rem', borderRadius: '8px',
                                                                border: `1px solid ${inputError ? theme.colors.error : theme.colors.border}`,
                                                                background: theme.colors.primaryBg, color: theme.colors.primaryText, fontSize: '0.9rem'
                                                            }}
                                                        />
                                                        <button onClick={handleNicknameSubmit} disabled={isSubmitting || inputError}
                                                            style={{
                                                                padding: '0.5rem 0.75rem', borderRadius: '8px', border: 'none',
                                                                background: neuronPrimary, color: 'white', cursor: 'pointer',
                                                                opacity: (isSubmitting || inputError) ? 0.5 : 1
                                                            }}
                                                        >
                                                            <FaCheck size={14} />
                                                        </button>
                                                        <button onClick={() => { setIsEditingNickname(false); setNicknameInput(''); setInputError(''); }}
                                                            style={{
                                                                padding: '0.5rem 0.75rem', borderRadius: '8px', border: `1px solid ${theme.colors.border}`,
                                                                background: 'transparent', color: theme.colors.mutedText, cursor: 'pointer'
                                                            }}
                                                        >
                                                            <FaTimes size={14} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button onClick={() => setIsEditingNickname(true)}
                                                        style={{
                                                            padding: '0.4rem 0.75rem', borderRadius: '6px', border: `1px solid ${theme.colors.border}`,
                                                            background: 'transparent', color: theme.colors.secondaryText, cursor: 'pointer',
                                                            fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem'
                                                        }}
                                                    >
                                                        <FaEdit size={12} /> Set Nickname
                                                    </button>
                                                )}
                                                {inputError && <div style={{ color: theme.colors.error, fontSize: '0.8rem', marginTop: '0.25rem' }}>{inputError}</div>}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Stats Grid - Comprehensive Neuron Information */}
                            {(() => {
                                const symbol = tokenSymbol || selectedSns?.name || 'SNS';
                                const now = Math.floor(Date.now() / 1000);
                                
                                // Smart number formatter - removes unnecessary trailing zeros
                                const formatTokenAmount = (e8s) => {
                                    const value = Number(e8s) / 100_000_000;
                                    if (value === 0) return '0';
                                    // Use up to 8 decimals, but trim trailing zeros
                                    const formatted = value.toFixed(8);
                                    return formatted.replace(/\.?0+$/, '');
                                };
                                
                                // Calculate age from aging_since_timestamp_seconds
                                const agingSince = Number(neuronData.aging_since_timestamp_seconds || 0);
                                const ageSeconds = agingSince > 0 && agingSince < now ? now - agingSince : 0;
                                
                                // Calculate dissolve delay
                                let dissolveDelay = 0;
                                let isDissolving = false;
                                if (neuronData.dissolve_state?.[0]) {
                                    const ds = neuronData.dissolve_state[0];
                                    if (ds.DissolveDelaySeconds !== undefined) {
                                        dissolveDelay = Number(ds.DissolveDelaySeconds);
                                    } else if (ds.WhenDissolvedTimestampSeconds !== undefined) {
                                        const dissolveTs = Number(ds.WhenDissolvedTimestampSeconds);
                                        dissolveDelay = dissolveTs > now ? dissolveTs - now : 0;
                                        isDissolving = dissolveTs > now;
                                    }
                                }
                                
                                // Calculate bonuses if we have nervous system parameters
                                let dissolveBonusPct = 0;
                                let ageBonusPct = 0;
                                let maxDissolveDelay = 0;
                                let maxAge = 0;
                                let maxDissolveBonusPct = 0;
                                let maxAgeBonusPct = 0;
                                
                                if (nervousSystemParameters) {
                                    maxDissolveDelay = nervousSystemParameters.max_dissolve_delay_seconds?.[0] ? Number(nervousSystemParameters.max_dissolve_delay_seconds[0]) : 0;
                                    maxAge = nervousSystemParameters.max_neuron_age_for_age_bonus?.[0] ? Number(nervousSystemParameters.max_neuron_age_for_age_bonus[0]) : 0;
                                    maxDissolveBonusPct = nervousSystemParameters.max_dissolve_delay_bonus_percentage?.[0] ? Number(nervousSystemParameters.max_dissolve_delay_bonus_percentage[0]) : 0;
                                    maxAgeBonusPct = nervousSystemParameters.max_age_bonus_percentage?.[0] ? Number(nervousSystemParameters.max_age_bonus_percentage[0]) : 0;
                                    
                                    // Calculate actual bonus percentages
                                    if (maxDissolveDelay > 0) {
                                        const cappedDissolve = Math.min(dissolveDelay, maxDissolveDelay);
                                        dissolveBonusPct = (cappedDissolve / maxDissolveDelay) * maxDissolveBonusPct;
                                    }
                                    if (maxAge > 0) {
                                        const cappedAge = Math.min(ageSeconds, maxAge);
                                        ageBonusPct = (cappedAge / maxAge) * maxAgeBonusPct;
                                    }
                                }
                                
                                // Total bonus is MULTIPLICATIVE: (1 + dissolve%) * (1 + age%) - 1
                                // NOT additive like dissolve% + age%
                                const totalBonusPct = ((1 + dissolveBonusPct / 100) * (1 + ageBonusPct / 100) - 1) * 100;
                                const maxTotalBonusPct = ((1 + maxDissolveBonusPct / 100) * (1 + maxAgeBonusPct / 100) - 1) * 100;
                                
                                // Neuron fees (from failed proposals, etc.) - deducted from stake when disbursing
                                const neuronFees = Number(neuronData.neuron_fees_e8s || 0);
                                
                                // Actual stake after fees (this is what you'll receive when disbursing)
                                const cachedStakeE8s = Number(neuronData.cached_neuron_stake_e8s || 0);
                                const actualStakeE8s = cachedStakeE8s - neuronFees;
                                
                                // Maturity breakdown - always show all three types
                                const availableMaturity = Number(neuronData.maturity_e8s_equivalent || 0);
                                const stakedMaturity = neuronData.staked_maturity_e8s_equivalent?.[0] ? Number(neuronData.staked_maturity_e8s_equivalent[0]) : 0;
                                const disbursingMaturity = (neuronData.disburse_maturity_in_progress || [])
                                    .reduce((sum, d) => sum + Number(d.amount_e8s || 0), 0);
                                const totalMaturity = availableMaturity + stakedMaturity + disbursingMaturity;
                                
                                // Total value (actual stake + all maturity)
                                const totalValue = actualStakeE8s + totalMaturity;
                                
                                // Voting power multiplier (base multiplier, usually 100%)
                                const baseVpMultiplier = Number(neuronData.voting_power_percentage_multiplier || 100);
                                // Effective multiplier including bonuses
                                const effectiveMultiplier = (baseVpMultiplier / 100) * (1 + totalBonusPct / 100) * 100;
                                
                                // Creation date
                                const createdTimestamp = neuronData.created_timestamp_seconds ? Number(neuronData.created_timestamp_seconds) : null;
                                const createdDate = createdTimestamp ? new Date(createdTimestamp * 1000) : null;
                                
                                // Additional neuron properties
                                const autoStakeMaturity = neuronData.auto_stake_maturity?.[0] || false;
                                const vestingPeriod = neuronData.vesting_period_seconds?.[0] ? Number(neuronData.vesting_period_seconds[0]) : 0;
                                const sourceNnsNeuronId = neuronData.source_nns_neuron_id?.[0] ? neuronData.source_nns_neuron_id[0].toString() : null;
                                
                                // Calculate vesting status
                                const nowSeconds = Math.floor(Date.now() / 1000);
                                const vestingElapsed = createdTimestamp ? nowSeconds - createdTimestamp : 0;
                                const vestingRemaining = vestingPeriod > 0 ? Math.max(0, vestingPeriod - vestingElapsed) : 0;
                                const vestingComplete = vestingPeriod > 0 && vestingRemaining <= 0;
                                const vestingProgress = vestingPeriod > 0 ? Math.min(100, (vestingElapsed / vestingPeriod) * 100) : 0;
                                
                                // Duration formatter
                                const formatDuration = (seconds) => {
                                    if (seconds <= 0) return '0d';
                                    const days = Math.floor(seconds / 86400);
                                    const months = Math.floor(days / 30);
                                    const years = Math.floor(days / 365);
                                    if (years > 0) return `${years}y ${Math.floor((days % 365) / 30)}m`;
                                    if (months > 0) return `${months}m ${days % 30}d`;
                                    if (days > 0) return `${days}d`;
                                    const hours = Math.floor(seconds / 3600);
                                    if (hours > 0) return `${hours}h`;
                                    return `${Math.floor(seconds / 60)}m`;
                                };
                                
                                return (
                                    <>
                                    {/* Primary Stats Row */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                                        {/* Stake */}
                                        <div className="neuron-card-animate" style={{ ...cardStyle, opacity: 0, animationDelay: '0.25s', marginBottom: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                <TokenIcon logo={tokenLogo} alt={symbol} size={18} fallbackColor={neuronGold} />
                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Staked</span>
                                            </div>
                                            <div style={{ color: theme.colors.primaryText, fontSize: '1.25rem', fontWeight: '700' }}>
                                                {formatTokenAmount(actualStakeE8s)} <span style={{ fontSize: '0.9rem', fontWeight: '500', color: theme.colors.secondaryText }}>{symbol}</span>
                                            </div>
                                            {neuronFees > 0 && (
                                                <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: '0.35rem' }}>
                                                    Fees deducted: {formatTokenAmount(neuronFees)}
                                                </div>
                                            )}
                                        </div>

                                        {/* Maturity Breakdown */}
                                        <div className="neuron-card-animate" style={{ ...cardStyle, opacity: 0, animationDelay: '0.3s', marginBottom: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                <FaChartLine size={14} style={{ color: '#10b981' }} />
                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Maturity</span>
                                            </div>
                                            <div style={{ color: '#10b981', fontSize: '1.25rem', fontWeight: '700' }}>
                                                {formatTokenAmount(totalMaturity)} <span style={{ fontSize: '0.9rem', fontWeight: '500', opacity: 0.8 }}>{symbol}</span>
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: '0.35rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                <span>Available: {formatTokenAmount(availableMaturity)}</span>
                                                <span>Staked: {formatTokenAmount(stakedMaturity)}</span>
                                                {disbursingMaturity > 0 && <span style={{ color: '#f59e0b' }}>Disbursing: {formatTokenAmount(disbursingMaturity)}</span>}
                                            </div>
                                        </div>

                                        {/* Total Value */}
                                        <div className="neuron-card-animate" style={{ ...cardStyle, opacity: 0, animationDelay: '0.35s', marginBottom: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                <FaWallet size={14} style={{ color: neuronGold }} />
                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Value</span>
                                            </div>
                                            <div style={{ color: neuronGold, fontSize: '1.25rem', fontWeight: '700' }}>
                                                {formatTokenAmount(totalValue)} <span style={{ fontSize: '0.9rem', fontWeight: '500', opacity: 0.8 }}>{symbol}</span>
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: '0.35rem' }}>
                                                Stake + Maturity
                                            </div>
                                        </div>

                                        {/* Voting Power */}
                                        <div className="neuron-card-animate" style={{ ...cardStyle, opacity: 0, animationDelay: '0.4s', marginBottom: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                <FaVoteYea size={14} style={{ color: neuronPrimary }} />
                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Voting Power</span>
                                            </div>
                                            <div style={{ color: theme.colors.primaryText, fontSize: '1.25rem', fontWeight: '700' }}>
                                                {nervousSystemParameters 
                                                    ? formatVotingPower(calculateVotingPower(neuronData, nervousSystemParameters))
                                                    : formatTokenAmount(neuronData.voting_power || 0)}
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: '0.35rem' }}>
                                                Effective: {effectiveMultiplier.toFixed(0)}% {baseVpMultiplier !== 100 && <span>(base {baseVpMultiplier}%)</span>}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Secondary Stats Row - Age, Dissolve, Bonuses */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                                        {/* Neuron Age */}
                                        <div className="neuron-card-animate" style={{ ...cardStyle, opacity: 0, animationDelay: '0.45s', marginBottom: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                <FaCalendarAlt size={14} style={{ color: neuronAccent }} />
                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Age</span>
                                            </div>
                                            <div style={{ color: theme.colors.primaryText, fontSize: '1.1rem', fontWeight: '600' }}>
                                                {formatDuration(ageSeconds)}
                                            </div>
                                            {nervousSystemParameters && maxAge > 0 && (
                                                <div style={{ fontSize: '0.75rem', color: ageBonusPct > 0 ? '#10b981' : theme.colors.mutedText, marginTop: '0.35rem' }}>
                                                    Age Bonus: +{ageBonusPct.toFixed(1)}%
                                                    {ageSeconds < maxAge && <span style={{ color: theme.colors.mutedText }}> (max {maxAgeBonusPct}%)</span>}
                                                </div>
                                            )}
                                        </div>

                                        {/* Dissolve Delay/Time */}
                                        <div className="neuron-card-animate" style={{ ...cardStyle, opacity: 0, animationDelay: '0.5s', marginBottom: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                {isDissolving ? <FaClock size={14} style={{ color: '#f59e0b' }} /> : <FaLock size={14} style={{ color: '#10b981' }} />}
                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                    {isDissolving ? 'Time to Dissolve' : 'Dissolve Delay'}
                                                </span>
                                            </div>
                                            <div style={{ color: isDissolving ? '#f59e0b' : theme.colors.primaryText, fontSize: '1.1rem', fontWeight: '600' }}>
                                                {formatDuration(dissolveDelay)}
                                            </div>
                                            {nervousSystemParameters && maxDissolveDelay > 0 && (
                                                <div style={{ fontSize: '0.75rem', color: dissolveBonusPct > 0 ? '#10b981' : theme.colors.mutedText, marginTop: '0.35rem' }}>
                                                    Dissolve Bonus: +{dissolveBonusPct.toFixed(1)}%
                                                    {dissolveDelay < maxDissolveDelay && <span style={{ color: theme.colors.mutedText }}> (max {maxDissolveBonusPct}%)</span>}
                                                </div>
                                            )}
                                        </div>

                                        {/* Total Bonus */}
                                        {nervousSystemParameters && (maxAge > 0 || maxDissolveDelay > 0) && (
                                            <div className="neuron-card-animate" style={{ ...cardStyle, opacity: 0, animationDelay: '0.55s', marginBottom: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                    <FaPercent size={14} style={{ color: '#10b981' }} />
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Bonus</span>
                                                </div>
                                                <div style={{ color: totalBonusPct > 0 ? '#10b981' : theme.colors.primaryText, fontSize: '1.1rem', fontWeight: '600' }}>
                                                    +{totalBonusPct.toFixed(0)}%
                                                </div>
                                                <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: '0.35rem' }}>
                                                    Max: {maxTotalBonusPct.toFixed(0)}%
                                                </div>
                                            </div>
                                        )}

                                        {/* Creation Date */}
                                        {createdDate && (
                                            <div className="neuron-card-animate" style={{ ...cardStyle, opacity: 0, animationDelay: '0.6s', marginBottom: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                    <FaHistory size={14} style={{ color: theme.colors.secondaryText }} />
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Created</span>
                                                </div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '0.95rem', fontWeight: '600' }}>
                                                    {createdDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                                                </div>
                                                <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: '0.35rem' }}>
                                                    {createdDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Additional Info Row - always show auto-stake, optionally others */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                                        {/* Auto-Stake Maturity - always show */}
                                        <div className="neuron-card-animate" style={{ ...cardStyle, opacity: 0, animationDelay: '0.65s', marginBottom: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                <FaChartLine size={14} style={{ color: autoStakeMaturity ? '#10b981' : theme.colors.mutedText }} />
                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Auto-Stake</span>
                                            </div>
                                            <div style={{ color: autoStakeMaturity ? '#10b981' : theme.colors.secondaryText, fontSize: '1rem', fontWeight: '600' }}>
                                                {autoStakeMaturity ? 'Enabled' : 'Disabled'}
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: '0.35rem' }}>
                                                Maturity auto-staking
                                            </div>
                                        </div>

                                        {/* Vesting Period - show if set */}
                                        {vestingPeriod > 0 && (
                                            <div className="neuron-card-animate" style={{ ...cardStyle, opacity: 0, animationDelay: '0.7s', marginBottom: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                    {vestingComplete ? (
                                                        <FaCheckCircle size={14} style={{ color: '#10b981' }} />
                                                    ) : (
                                                        <FaClock size={14} style={{ color: '#8b5cf6' }} />
                                                    )}
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Vesting</span>
                                                </div>
                                                {vestingComplete ? (
                                                    <>
                                                        <div style={{ color: '#10b981', fontSize: '1rem', fontWeight: '600' }}>
                                                            Complete ✓
                                                        </div>
                                                        <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: '0.35rem' }}>
                                                            {formatDuration(vestingPeriod)} vesting period ended
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div style={{ color: '#8b5cf6', fontSize: '1rem', fontWeight: '600' }}>
                                                            {formatDuration(vestingRemaining)} left
                                                        </div>
                                                        <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: '0.35rem' }}>
                                                            {vestingProgress.toFixed(0)}% of {formatDuration(vestingPeriod)}
                                                        </div>
                                                        {/* Progress bar */}
                                                        <div style={{ 
                                                            marginTop: '0.5rem', 
                                                            height: '4px', 
                                                            backgroundColor: theme.colors.tertiaryBg, 
                                                            borderRadius: '2px',
                                                            overflow: 'hidden'
                                                        }}>
                                                            <div style={{ 
                                                                width: `${vestingProgress}%`, 
                                                                height: '100%', 
                                                                backgroundColor: '#8b5cf6',
                                                                borderRadius: '2px',
                                                                transition: 'width 0.3s ease'
                                                            }} />
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        )}

                                        {/* Source NNS Neuron - show if exists */}
                                        {sourceNnsNeuronId && (
                                            <div className="neuron-card-animate" style={{ ...cardStyle, opacity: 0, animationDelay: '0.75s', marginBottom: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                    <FaKey size={14} style={{ color: neuronPrimary }} />
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Source NNS</span>
                                                </div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '0.9rem', fontWeight: '600', fontFamily: 'monospace' }}>
                                                    {sourceNnsNeuronId.slice(0, 8)}...
                                                </div>
                                                <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: '0.35rem' }}>
                                                    From NNS neuron
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Dissolve State Actions */}
                                    <div className="neuron-card-animate" style={{ ...cardStyle, opacity: 0, animationDelay: '0.85s', marginBottom: '1rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                                                    {isDissolving ? <FaUnlock size={14} style={{ color: '#f59e0b' }} /> : dissolveDelay > 0 ? <FaLock size={14} style={{ color: '#10b981' }} /> : <FaUnlock size={14} style={{ color: '#ef4444' }} />}
                                                    <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                                                        {getDissolveState(neuronData)}
                                                    </span>
                                                </div>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>
                                                    {isDissolving && `Dissolves on ${new Date((Number(neuronData.dissolve_state[0].WhenDissolvedTimestampSeconds)) * 1000).toLocaleDateString()}`}
                                                    {!isDissolving && dissolveDelay > 0 && `Locked for ${formatDuration(dissolveDelay)}`}
                                                    {!isDissolving && dissolveDelay === 0 && 'Ready to disburse'}
                                                </div>
                                            </div>
                                            {currentUserHasPermission(PERM.CONFIGURE_DISSOLVE_STATE) && (
                                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                    <button onClick={() => setShowDissolveDelayDialog(true)} disabled={actionBusy}
                                                        style={{
                                                            padding: '0.5rem 1rem', borderRadius: '8px', border: 'none',
                                                            background: neuronPrimary, color: 'white', fontSize: '0.8rem', fontWeight: '500',
                                                            cursor: actionBusy ? 'wait' : 'pointer', opacity: actionBusy ? 0.5 : 1,
                                                            display: 'flex', alignItems: 'center', gap: '0.4rem'
                                                        }}
                                                    >
                                                        <FaClock size={12} /> Increase Delay
                                                    </button>
                                                    {getDissolveState(neuronData).includes('Locked') && (
                                                        <button onClick={startDissolving} disabled={actionBusy}
                                                            style={{
                                                                padding: '0.5rem 1rem', borderRadius: '8px', border: `1px solid ${theme.colors.border}`,
                                                                background: 'transparent', color: theme.colors.secondaryText, fontSize: '0.8rem', fontWeight: '500',
                                                                cursor: actionBusy ? 'wait' : 'pointer', opacity: actionBusy ? 0.5 : 1,
                                                                display: 'flex', alignItems: 'center', gap: '0.4rem'
                                                            }}
                                                        >
                                                            <FaUnlock size={12} /> Start Dissolving
                                                        </button>
                                                    )}
                                                    {getDissolveState(neuronData).includes('Dissolving') && (
                                                        <button onClick={stopDissolving} disabled={actionBusy}
                                                            style={{
                                                                padding: '0.5rem 1rem', borderRadius: '8px', border: `1px solid ${theme.colors.border}`,
                                                                background: 'transparent', color: theme.colors.secondaryText, fontSize: '0.8rem', fontWeight: '500',
                                                                cursor: actionBusy ? 'wait' : 'pointer', opacity: actionBusy ? 0.5 : 1,
                                                                display: 'flex', alignItems: 'center', gap: '0.4rem'
                                                            }}
                                                        >
                                                            <FaLock size={12} /> Stop Dissolving
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    </>
                                );
                            })()}

                            {/* Permissions Section */}
                            <div className="neuron-card-animate" style={{ opacity: 0, animationDelay: '0.45s' }}>
                                <div 
                                    style={sectionHeaderStyle}
                                    onClick={() => setIsPermissionsExpanded(!isPermissionsExpanded)}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <div style={{
                                            width: '32px', height: '32px', borderRadius: '8px',
                                            background: `linear-gradient(135deg, ${neuronPrimary}30, ${neuronSecondary}20)`,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: neuronPrimary
                                        }}>
                                            <FaUsers size={14} />
                                        </div>
                                        <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                                            Permissions
                                        </span>
                                        <span style={{
                                            padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem',
                                            background: `${neuronPrimary}20`, color: neuronPrimary
                                        }}>
                                            {neuronData.permissions?.length || 0}
                                        </span>
                                    </div>
                                    {isPermissionsExpanded ? <FaChevronDown size={14} color={theme.colors.mutedText} /> : <FaChevronRight size={14} color={theme.colors.mutedText} />}
                                </div>

                                {isPermissionsExpanded && (
                                    <div style={cardStyle}>
                                        {/* Current Principals */}
                                        <div style={{ marginBottom: '1.5rem' }}>
                                            <h4 style={{ color: theme.colors.secondaryText, fontSize: '0.85rem', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                Current Principals
                                            </h4>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                {neuronData.permissions?.map((perm, idx) => {
                                                    const symbolInfo = getPrincipalSymbol(perm);
                                                    const permTypes = perm.permission_type || [];
                                                    const principalStr = perm.principal?.toString();
                                                    const isCurrentUser = identity && principalStr === identity.getPrincipal()?.toString();
                                                    const isLastPrincipal = neuronData.permissions?.length === 1;
                                                    const isLastWithManagePermission = neuronData.permissions?.filter(p => 
                                                        p.permission_type?.includes(PERM.MANAGE_PRINCIPALS)
                                                    ).length === 1 && permTypes.includes(PERM.MANAGE_PRINCIPALS);
                                                    
                                                    return (
                                                        <div key={idx} style={{
                                                            padding: '0.75rem 1rem', borderRadius: '10px',
                                                            background: isCurrentUser ? `${neuronAccent}08` : theme.colors.primaryBg,
                                                            border: `1px solid ${isCurrentUser ? neuronAccent + '40' : theme.colors.border}`
                                                        }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                                                                <div style={{ color: symbolInfo.color, fontSize: '1rem' }} title={symbolInfo.title}>
                                                                    {symbolInfo.icon}
                                                                </div>
                                                                <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                                    <PrincipalDisplay 
                                                                        principal={perm.principal}
                                                                        displayInfo={principalDisplayInfo.get(principalStr)}
                                                                        showCopyButton={false}
                                                                        short={true}
                                                                        isAuthenticated={isAuthenticated}
                                                                    />
                                                                    {isCurrentUser && (
                                                                        <span style={{
                                                                            padding: '0.15rem 0.4rem', borderRadius: '4px',
                                                                            background: neuronAccent, color: 'white',
                                                                            fontSize: '0.65rem', fontWeight: '600', textTransform: 'uppercase'
                                                                        }}>
                                                                            You
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {currentUserHasPermission(PERM.MANAGE_PRINCIPALS) && (
                                                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                                        <button onClick={() => startEditingPrincipal(perm)}
                                                                            style={{
                                                                                padding: '0.4rem', borderRadius: '6px', border: 'none',
                                                                                background: `${neuronPrimary}15`, color: neuronPrimary, cursor: 'pointer'
                                                                            }}
                                                                            title="Edit permissions"
                                                                        >
                                                                            <FaEdit size={12} />
                                                                        </button>
                                                                        <button 
                                                                            onClick={() => {
                                                                                if (isLastPrincipal) {
                                                                                    showDialog({
                                                                                        type: 'error',
                                                                                        title: 'Cannot Remove Principal',
                                                                                        message: 'This is the last principal on this neuron. Removing it would permanently lock you out with no way to recover access.',
                                                                                        confirmText: 'I Understand',
                                                                                        showCancel: false
                                                                                    });
                                                                                    return;
                                                                                }
                                                                                if (isLastWithManagePermission) {
                                                                                    showDialog({
                                                                                        type: 'error',
                                                                                        title: 'Cannot Remove Principal',
                                                                                        message: 'This is the last principal with management permissions. Removing it would prevent you from managing this neuron\'s permissions in the future.',
                                                                                        confirmText: 'I Understand',
                                                                                        showCancel: false
                                                                                    });
                                                                                    return;
                                                                                }
                                                                                if (isCurrentUser) {
                                                                                    showDialog({
                                                                                        type: 'warning',
                                                                                        title: 'Remove Yourself?',
                                                                                        message: 'You are about to remove YOURSELF from this neuron. This will revoke your access and cannot be easily undone. Are you absolutely sure?',
                                                                                        confirmText: 'Yes, Remove Me',
                                                                                        cancelText: 'Cancel',
                                                                                        confirmVariant: 'danger',
                                                                                        onConfirm: () => removePrincipal(principalStr, perm.permission_type)
                                                                                    });
                                                                                    return;
                                                                                }
                                                                                // Normal removal - still confirm
                                                                                showDialog({
                                                                                    type: 'warning',
                                                                                    title: 'Remove Principal?',
                                                                                    message: 'Are you sure you want to remove this principal from the neuron? This action cannot be easily undone.',
                                                                                    confirmText: 'Remove',
                                                                                    cancelText: 'Cancel',
                                                                                    confirmVariant: 'danger',
                                                                                    onConfirm: () => removePrincipal(principalStr, perm.permission_type)
                                                                                });
                                                                            }}
                                                                            disabled={isLastPrincipal}
                                                                            style={{
                                                                                padding: '0.4rem', borderRadius: '6px', border: 'none',
                                                                                background: isLastPrincipal ? theme.colors.border : `${theme.colors.error}15`,
                                                                                color: isLastPrincipal ? theme.colors.mutedText : theme.colors.error,
                                                                                cursor: isLastPrincipal ? 'not-allowed' : 'pointer',
                                                                                opacity: isLastPrincipal ? 0.5 : 1
                                                                            }}
                                                                            title={isLastPrincipal ? 'Cannot remove the last principal' : isCurrentUser ? 'Remove yourself (warning!)' : 'Remove principal'}
                                                                        >
                                                                            <FaTrash size={12} />
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            {/* Show actual permissions */}
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', paddingLeft: '1.75rem' }}>
                                                                {Object.entries(PERMISSION_INFO).map(([key, info]) => {
                                                                    const hasPermission = permTypes.includes(info.value);
                                                                    if (!hasPermission) return null;
                                                                    return (
                                                                        <span key={key} style={{
                                                                            padding: '0.2rem 0.5rem', borderRadius: '4px',
                                                                            background: `${neuronPrimary}15`, color: theme.colors.secondaryText,
                                                                            fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.25rem'
                                                                        }} title={info.description}>
                                                                            <span>{info.icon}</span>
                                                                            <span>{info.label}</span>
                                                                        </span>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {/* Add/Edit Principal */}
                                        {currentUserHasPermission(PERM.MANAGE_PRINCIPALS) && (
                                            <div style={{
                                                padding: '1rem', borderRadius: '12px',
                                                background: `linear-gradient(135deg, ${neuronPrimary}08, ${neuronSecondary}05)`,
                                                border: `1px solid ${neuronPrimary}20`
                                            }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                                                    {editingPrincipal ? 'Edit Principal' : 'Add Principal'}
                                                </h4>
                                                <div style={{ marginBottom: '0.75rem' }}>
                                                    <PrincipalInput
                                                        value={managePrincipalInput}
                                                        onChange={setManagePrincipalInput}
                                                        placeholder="Enter principal ID or search by name"
                                                        disabled={!!editingPrincipal}
                                                        isAuthenticated={isAuthenticated}
                                                        defaultTab="all"
                                                        style={{ maxWidth: '100%' }}
                                                    />
                                                </div>
                                                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                                    <button onClick={makeFullOwner} style={{
                                                        padding: '0.4rem 0.75rem', borderRadius: '6px', border: `1px solid ${neuronGold}40`,
                                                        background: `${neuronGold}15`, color: neuronGold, fontSize: '0.75rem', cursor: 'pointer'
                                                    }}>
                                                        <FaCrown size={10} style={{ marginRight: '4px' }} /> Full Owner
                                                    </button>
                                                    <button onClick={makeHotkey} style={{
                                                        padding: '0.4rem 0.75rem', borderRadius: '6px', border: `1px solid ${neuronAccent}40`,
                                                        background: `${neuronAccent}15`, color: neuronAccent, fontSize: '0.75rem', cursor: 'pointer'
                                                    }}>
                                                        <FaKey size={10} style={{ marginRight: '4px' }} /> Hotkey
                                                    </button>
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                                    {Object.entries(PERMISSION_INFO).map(([key, info]) => (
                                                        <label key={key} style={{
                                                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                                                            padding: '0.5rem', borderRadius: '6px',
                                                            background: selectedPermissions[key] ? `${neuronPrimary}15` : 'transparent',
                                                            border: `1px solid ${selectedPermissions[key] ? neuronPrimary : theme.colors.border}`,
                                                            cursor: 'pointer', fontSize: '0.8rem'
                                                        }}>
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedPermissions[key]}
                                                                onChange={(e) => setSelectedPermissions({ ...selectedPermissions, [key]: e.target.checked })}
                                                            />
                                                            <span>{info.icon}</span>
                                                            <span style={{ color: theme.colors.primaryText }}>{info.label}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                    <button onClick={savePrincipalPermissions} disabled={actionBusy || !managePrincipalInput}
                                                        style={{
                                                            padding: '0.6rem 1.25rem', borderRadius: '8px', border: 'none',
                                                            background: neuronPrimary, color: 'white', fontSize: '0.85rem', fontWeight: '500',
                                                            cursor: (actionBusy || !managePrincipalInput) ? 'not-allowed' : 'pointer',
                                                            opacity: (actionBusy || !managePrincipalInput) ? 0.5 : 1
                                                        }}
                                                    >
                                                        {actionBusy ? 'Saving...' : (editingPrincipal ? 'Update' : 'Add Principal')}
                                                    </button>
                                                    {editingPrincipal && (
                                                        <button onClick={cancelEditing}
                                                            style={{
                                                                padding: '0.6rem 1.25rem', borderRadius: '8px',
                                                                border: `1px solid ${theme.colors.border}`, background: 'transparent',
                                                                color: theme.colors.secondaryText, fontSize: '0.85rem', cursor: 'pointer'
                                                            }}
                                                        >
                                                            Cancel
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Followees Section */}
                            <div className="neuron-card-animate" style={{ opacity: 0, animationDelay: '0.5s' }}>
                                <div 
                                    style={sectionHeaderStyle}
                                    onClick={() => setIsFolloweesExpanded(!isFolloweesExpanded)}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <div style={{
                                            width: '32px', height: '32px', borderRadius: '8px',
                                            background: `linear-gradient(135deg, ${neuronAccent}30, ${neuronPrimary}20)`,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: neuronAccent
                                        }}>
                                            <FaUserShield size={14} />
                                        </div>
                                        <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                                            Followees
                                        </span>
                                    </div>
                                    {isFolloweesExpanded ? <FaChevronDown size={14} color={theme.colors.mutedText} /> : <FaChevronRight size={14} color={theme.colors.mutedText} />}
                                </div>

                                {isFolloweesExpanded && (
                                    <div style={cardStyle}>
                                        {/* Compact display of all followees */}
                                        {(() => {
                                            const allTopics = [
                                                { key: 'Governance', label: 'Gov' },
                                                { key: 'DaoCommunitySettings', label: 'Community' },
                                                { key: 'SnsFrameworkManagement', label: 'SNS Framework' },
                                                { key: 'DappCanisterManagement', label: 'Dapp' },
                                                { key: 'ApplicationBusinessLogic', label: 'App Logic' },
                                                { key: 'TreasuryAssetManagement', label: 'Treasury' },
                                                { key: 'CriticalDappOperations', label: 'Critical' }
                                            ];
                                            const topicsWithFollowees = allTopics.filter(t => getCurrentFolloweesForTopic(t.key).length > 0);
                                            const hasAnyFollowees = topicsWithFollowees.length > 0;
                                            
                                            return (
                                                <div style={{ marginBottom: '1rem' }}>
                                                    {!hasAnyFollowees ? (
                                                        <p style={{ color: theme.colors.mutedText, fontSize: '0.85rem', textAlign: 'center', padding: '0.5rem' }}>
                                                            No followees configured
                                                        </p>
                                                    ) : (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                            {topicsWithFollowees.map(topic => {
                                                                const followees = getCurrentFolloweesForTopic(topic.key);
                                                                return (
                                                                    <div key={topic.key} style={{
                                                                        display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                                                                        padding: '0.5rem', borderRadius: '8px',
                                                                        background: theme.colors.primaryBg
                                                                    }}>
                                                                        <span style={{
                                                                            color: neuronAccent, fontSize: '0.7rem', fontWeight: '600',
                                                                            textTransform: 'uppercase', minWidth: '70px', paddingTop: '0.15rem'
                                                                        }}>
                                                                            {topic.label}
                                                                        </span>
                                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', flex: 1 }}>
                                                                            {followees.map((f, idx) => (
                                                                                <div key={idx} style={{
                                                                                    display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                                                                    padding: '0.2rem 0.4rem', borderRadius: '4px',
                                                                                    background: theme.colors.secondaryBg, fontSize: '0.75rem'
                                                                                }}>
                                                                                    <NeuronDisplay neuronId={f.neuronId} snsRoot={selectedSnsRoot} showCopyButton={false} />
                                                                                    {currentUserHasPermission(PERM.MANAGE_VOTING_PERMISSION) && (
                                                                                        <button onClick={() => removeFollowee(f.neuronId, topic.key)} disabled={actionBusy}
                                                                                            style={{
                                                                                                padding: '0.1rem', borderRadius: '3px', border: 'none',
                                                                                                background: 'transparent', color: theme.colors.mutedText, cursor: 'pointer',
                                                                                                display: 'flex', alignItems: 'center'
                                                                                            }}
                                                                                            onMouseEnter={(e) => e.target.style.color = theme.colors.error}
                                                                                            onMouseLeave={(e) => e.target.style.color = theme.colors.mutedText}
                                                                                        >
                                                                                            <FaTimes size={8} />
                                                                                        </button>
                                                                                    )}
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })()}

                                        {/* Add followees - unified interface */}
                                        {currentUserHasPermission(PERM.MANAGE_VOTING_PERMISSION) && (
                                            <div style={{
                                                padding: '1rem', borderRadius: '10px',
                                                background: `linear-gradient(135deg, ${neuronAccent}08, ${neuronPrimary}05)`,
                                                border: `1px solid ${neuronAccent}20`
                                            }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Add Followees</h4>
                                                
                                                {/* Topic selection */}
                                                <div style={{ marginBottom: '0.75rem' }}>
                                                    <div style={{ color: theme.colors.secondaryText, fontSize: '0.75rem', marginBottom: '0.4rem' }}>
                                                        Select topics:
                                                    </div>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                                        {Object.entries(selectedTopics).map(([topic, isSelected]) => (
                                                            <label key={topic} style={{
                                                                display: 'flex', alignItems: 'center', gap: '0.25rem',
                                                                padding: '0.25rem 0.5rem', borderRadius: '5px',
                                                                background: isSelected ? `${neuronAccent}25` : 'transparent',
                                                                border: `1px solid ${isSelected ? neuronAccent : theme.colors.border}`,
                                                                cursor: 'pointer', fontSize: '0.7rem', transition: 'all 0.15s ease'
                                                            }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isSelected}
                                                                    onChange={(e) => setSelectedTopics({ ...selectedTopics, [topic]: e.target.checked })}
                                                                    style={{ margin: 0, width: '12px', height: '12px' }}
                                                                />
                                                                <span style={{ color: isSelected ? neuronAccent : theme.colors.secondaryText }}>
                                                                    {topic.replace(/([A-Z])/g, ' $1').trim()}
                                                                </span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* Neurons to add list */}
                                                <div style={{ marginBottom: '0.75rem' }}>
                                                    <div style={{ color: theme.colors.secondaryText, fontSize: '0.75rem', marginBottom: '0.4rem' }}>
                                                        Neurons to add ({neuronsToAdd.length}):
                                                    </div>
                                                    
                                                    {/* Add neuron input */}
                                                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'flex-start' }}>
                                                        <div style={{ flex: '2 1 200px', minWidth: '150px' }}>
                                                            <NeuronInput
                                                                value={currentNeuronToAdd}
                                                                onChange={setCurrentNeuronToAdd}
                                                                placeholder="Search neuron..."
                                                                snsRoot={selectedSnsRoot}
                                                                defaultTab="all"
                                                            />
                                                        </div>
                                                        <button 
                                                            onClick={() => {
                                                                if (currentNeuronToAdd.trim() && /^[0-9a-fA-F]+$/.test(currentNeuronToAdd.trim())) {
                                                                    const exists = neuronsToAdd.some(n => n.neuronId.toLowerCase() === currentNeuronToAdd.trim().toLowerCase());
                                                                    if (!exists) {
                                                                        setNeuronsToAdd([...neuronsToAdd, { neuronId: currentNeuronToAdd.trim(), alias: '' }]);
                                                                        setCurrentNeuronToAdd('');
                                                                    }
                                                                }
                                                            }}
                                                            disabled={!currentNeuronToAdd.trim()}
                                                            style={{
                                                                padding: '0.5rem 0.75rem', borderRadius: '6px', border: 'none',
                                                                background: currentNeuronToAdd.trim() ? neuronAccent : theme.colors.border,
                                                                color: 'white', fontSize: '0.8rem', cursor: currentNeuronToAdd.trim() ? 'pointer' : 'not-allowed',
                                                                height: '38px', display: 'flex', alignItems: 'center', gap: '0.25rem'
                                                            }}
                                                        >
                                                            <FaPlus size={10} /> Add
                                                        </button>
                                                    </div>
                                                    
                                                    {/* List of neurons to add */}
                                                    {neuronsToAdd.length > 0 && (
                                                        <div style={{
                                                            display: 'flex', flexWrap: 'wrap', gap: '0.35rem',
                                                            padding: '0.5rem', borderRadius: '6px',
                                                            background: theme.colors.primaryBg, border: `1px solid ${theme.colors.border}`
                                                        }}>
                                                            {neuronsToAdd.map((n, idx) => (
                                                                <div key={idx} style={{
                                                                    display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                                                                    padding: '0.3rem 0.5rem', borderRadius: '5px',
                                                                    background: `${neuronAccent}15`, border: `1px solid ${neuronAccent}30`
                                                                }}>
                                                                    <NeuronDisplay neuronId={n.neuronId} snsRoot={selectedSnsRoot} showCopyButton={false} />
                                                                    <button 
                                                                        onClick={() => setNeuronsToAdd(neuronsToAdd.filter((_, i) => i !== idx))}
                                                                        style={{
                                                                            padding: '0.15rem', borderRadius: '3px', border: 'none',
                                                                            background: 'transparent', color: theme.colors.mutedText, cursor: 'pointer',
                                                                            display: 'flex', alignItems: 'center'
                                                                        }}
                                                                        onMouseEnter={(e) => e.target.style.color = theme.colors.error}
                                                                        onMouseLeave={(e) => e.target.style.color = theme.colors.mutedText}
                                                                    >
                                                                        <FaTimes size={10} />
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Submit button */}
                                                <button 
                                                    onClick={addNeuronsToSelectedTopics} 
                                                    disabled={actionBusy || neuronsToAdd.length === 0 || !Object.values(selectedTopics).some(v => v)}
                                                    style={{
                                                        padding: '0.6rem 1.25rem', borderRadius: '8px', border: 'none',
                                                        background: (neuronsToAdd.length > 0 && Object.values(selectedTopics).some(v => v)) ? neuronAccent : theme.colors.border,
                                                        color: 'white', fontSize: '0.85rem', fontWeight: '500',
                                                        cursor: (actionBusy || neuronsToAdd.length === 0 || !Object.values(selectedTopics).some(v => v)) ? 'not-allowed' : 'pointer',
                                                        opacity: actionBusy ? 0.6 : 1, width: '100%'
                                                    }}
                                                >
                                                    {actionBusy ? 'Adding...' : `Add ${neuronsToAdd.length} neuron${neuronsToAdd.length !== 1 ? 's' : ''} to ${Object.values(selectedTopics).filter(v => v).length} topic${Object.values(selectedTopics).filter(v => v).length !== 1 ? 's' : ''}`}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Voting History (Sneed SNS only) */}
                            {selectedSnsRoot === SNEED_SNS_ROOT && votingHistory && (
                                <div className="neuron-card-animate" style={{ opacity: 0, animationDelay: '0.55s' }}>
                                    <div 
                                        style={sectionHeaderStyle}
                                        onClick={() => setIsVotingHistoryExpanded(!isVotingHistoryExpanded)}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                            <div style={{
                                                width: '32px', height: '32px', borderRadius: '8px',
                                                background: `linear-gradient(135deg, ${neuronGold}30, ${neuronPrimary}20)`,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', color: neuronGold
                                            }}>
                                                <FaHistory size={14} />
                                            </div>
                                            <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                                                Voting History
                                            </span>
                                            <span style={{
                                                padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem',
                                                background: `${neuronGold}20`, color: neuronGold
                                            }}>
                                                {votingHistory.length}
                                            </span>
                                        </div>
                                        {isVotingHistoryExpanded ? <FaChevronDown size={14} color={theme.colors.mutedText} /> : <FaChevronRight size={14} color={theme.colors.mutedText} />}
                                    </div>

                                    {isVotingHistoryExpanded && (
                                        <div style={cardStyle}>
                                            {/* Filters */}
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem', alignItems: 'center' }}>
                                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem', color: theme.colors.secondaryText }}>
                                                        <input type="checkbox" checked={hideYes} onChange={(e) => setHideYes(e.target.checked)} />
                                                        <span style={{ color: '#10b981' }}>Hide Yes</span>
                                                    </label>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem', color: theme.colors.secondaryText }}>
                                                        <input type="checkbox" checked={hideNo} onChange={(e) => setHideNo(e.target.checked)} />
                                                        <span style={{ color: '#ef4444' }}>Hide No</span>
                                                    </label>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem', color: theme.colors.secondaryText }}>
                                                        <input type="checkbox" checked={hideNotVoted} onChange={(e) => setHideNotVoted(e.target.checked)} />
                                                        Hide Not Voted
                                                    </label>
                                                </div>
                                                <select
                                                    value={sortBy}
                                                    onChange={(e) => setSortBy(e.target.value)}
                                                    style={{
                                                        padding: '0.4rem 0.75rem', borderRadius: '6px',
                                                        border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg,
                                                        color: theme.colors.primaryText, fontSize: '0.85rem'
                                                    }}
                                                >
                                                    <option value="proposalId">Sort by Proposal ID</option>
                                                    <option value="date">Sort by Date</option>
                                                    <option value="votingPower">Sort by Voting Power</option>
                                                </select>
                                            </div>

                                            {/* Votes list */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '400px', overflowY: 'auto' }}>
                                                {filterAndSortVotes(votingHistory).map((vote, idx) => (
                                                    <div key={idx} style={{
                                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                        padding: '0.75rem 1rem', borderRadius: '8px',
                                                        background: theme.colors.primaryBg, border: `1px solid ${theme.colors.border}`
                                                    }}>
                                                        <div>
                                                            <Link to={`/proposal?id=${vote.proposal_id}&sns=${selectedSnsRoot}`}
                                                                style={{ color: neuronPrimary, textDecoration: 'none', fontWeight: '600' }}
                                                            >
                                                                #{vote.proposal_id.toString()}
                                                            </Link>
                                                            <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText, marginTop: '2px' }}>
                                                                {vote.proposal_title || 'No title'}
                                                            </div>
                                                        </div>
                                                        <div style={{ textAlign: 'right' }}>
                                                            <div style={{
                                                                color: vote.vote === 1 ? '#10b981' : vote.vote === 2 ? '#ef4444' : theme.colors.mutedText,
                                                                fontWeight: '600'
                                                            }}>
                                                                {formatVote(vote.vote)}
                                                            </div>
                                                            <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText }}>
                                                                {formatE8s(vote.voting_power)} VP
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}

                    {/* Action busy overlay */}
                    {actionBusy && actionMsg && (
                        <div style={{
                            position: 'fixed', bottom: '2rem', right: '2rem',
                            padding: '1rem 1.5rem', borderRadius: '12px',
                            background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`,
                            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                            display: 'flex', alignItems: 'center', gap: '0.75rem',
                            zIndex: 1000
                        }}>
                            <div className="neuron-pulse" style={{
                                width: '24px', height: '24px', borderRadius: '50%',
                                background: neuronPrimary, display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}>
                                <FaClock size={12} color="white" />
                            </div>
                            <span style={{ color: theme.colors.primaryText }}>{actionMsg}</span>
                        </div>
                    )}
                </div>
            </main>

            {/* Dissolve Delay Dialog */}
            {showDissolveDelayDialog && neuronData && (() => {
                const currentDelaySeconds = getDissolveDelaySeconds(neuronData);
                const isIncreasing = currentDelaySeconds > 0;
                const minDelaySeconds = nervousSystemParameters?.neuron_minimum_dissolve_delay_to_vote_seconds?.[0] 
                    ? Number(nervousSystemParameters.neuron_minimum_dissolve_delay_to_vote_seconds[0]) : 0;
                const maxDelaySeconds = nervousSystemParameters?.max_dissolve_delay_seconds?.[0]
                    ? Number(nervousSystemParameters.max_dissolve_delay_seconds[0]) : 0;
                const minDelayDays = Math.ceil(minDelaySeconds / (24 * 60 * 60));
                const maxDelayDays = Math.floor(maxDelaySeconds / (24 * 60 * 60));
                const currentDelayDays = Math.floor(currentDelaySeconds / (24 * 60 * 60));
                const maxAdditionalDays = isIncreasing ? maxDelayDays - currentDelayDays : maxDelayDays;

                return (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0, 0, 0, 0.7)', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', zIndex: 1000
                    }}
                    onClick={() => { if (!actionBusy) { setShowDissolveDelayDialog(false); setDissolveDelayInput(''); } }}
                    >
                        <div style={{
                            background: theme.colors.secondaryBg, borderRadius: '16px',
                            padding: '1.5rem', maxWidth: '450px', width: '90%',
                            boxShadow: '0 4px 30px rgba(0,0,0,0.4)', border: `1px solid ${theme.colors.border}`
                        }}
                        onClick={(e) => e.stopPropagation()}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                                <div style={{
                                    width: '40px', height: '40px', borderRadius: '10px',
                                    background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                                }}>
                                    <FaClock size={18} color="white" />
                                </div>
                                <h3 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '1.1rem' }}>
                                    {isIncreasing ? 'Increase' : 'Set'} Dissolve Delay
                                </h3>
                            </div>

                            {isIncreasing && (
                                <p style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                                    Current delay: <strong>{currentDelayDays} days</strong>
                                </p>
                            )}

                            <p style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                                Enter the number of days to {isIncreasing ? 'increase' : 'set'} the dissolve delay:
                            </p>

                            {maxDelayDays > 0 && (
                                <p style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '1rem' }}>
                                    {isIncreasing 
                                        ? <>Min: <strong>0</strong> • Max additional: <strong>{maxAdditionalDays} days</strong></>
                                        : <>Min for voting: <strong>{minDelayDays} days</strong> • Max: <strong>{maxDelayDays} days</strong></>
                                    }
                                </p>
                            )}

                            <input
                                type="number" value={dissolveDelayInput}
                                onChange={(e) => setDissolveDelayInput(e.target.value)}
                                placeholder={`Days (e.g., ${isIncreasing ? Math.min(180, maxAdditionalDays) : Math.min(180, maxDelayDays)})`}
                                min="0" max={maxAdditionalDays > 0 ? maxAdditionalDays : undefined}
                                disabled={actionBusy}
                                style={{
                                    width: '100%', padding: '0.75rem', borderRadius: '10px',
                                    border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg,
                                    color: theme.colors.primaryText, fontSize: '1rem', marginBottom: '1.25rem', boxSizing: 'border-box'
                                }}
                            />

                            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                                <button
                                    onClick={() => { setShowDissolveDelayDialog(false); setDissolveDelayInput(''); }}
                                    disabled={actionBusy}
                                    style={{
                                        padding: '0.6rem 1.25rem', borderRadius: '8px',
                                        border: `1px solid ${theme.colors.border}`, background: 'transparent',
                                        color: theme.colors.secondaryText, fontSize: '0.9rem', cursor: actionBusy ? 'wait' : 'pointer'
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        const days = parseInt(dissolveDelayInput);
                                        if (isNaN(days) || days < 0) { 
                                            showDialog({
                                                type: 'error',
                                                title: 'Invalid Input',
                                                message: 'Please enter a valid number of days (0 or greater).',
                                                confirmText: 'OK',
                                                showCancel: false
                                            });
                                            return; 
                                        }
                                        if (maxAdditionalDays > 0 && days > maxAdditionalDays) {
                                            showDialog({
                                                type: 'error',
                                                title: 'Value Too High',
                                                message: `Maximum ${isIncreasing ? 'additional ' : ''}dissolve delay is ${maxAdditionalDays} days.`,
                                                confirmText: 'OK',
                                                showCancel: false
                                            });
                                            return;
                                        }
                                        increaseDissolveDelay(days * 24 * 60 * 60);
                                        setShowDissolveDelayDialog(false);
                                        setDissolveDelayInput('');
                                    }}
                                    disabled={actionBusy || !dissolveDelayInput}
                                    style={{
                                        padding: '0.6rem 1.25rem', borderRadius: '8px', border: 'none',
                                        background: neuronPrimary, color: 'white', fontSize: '0.9rem', fontWeight: '500',
                                        cursor: (actionBusy || !dissolveDelayInput) ? 'not-allowed' : 'pointer',
                                        opacity: (actionBusy || !dissolveDelayInput) ? 0.6 : 1
                                    }}
                                >
                                    {actionBusy ? 'Processing...' : 'Confirm'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
            
            {/* Confirmation/Alert Dialog */}
            <ConfirmDialog
                isOpen={dialogConfig.isOpen}
                onClose={closeDialog}
                onConfirm={dialogConfig.onConfirm}
                title={dialogConfig.title}
                message={dialogConfig.message}
                type={dialogConfig.type}
                confirmText={dialogConfig.confirmText}
                cancelText={dialogConfig.cancelText}
                confirmVariant={dialogConfig.confirmVariant}
                showCancel={dialogConfig.showCancel}
            />
        </div>
    );
}

export default Neuron;
