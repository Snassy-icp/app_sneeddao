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
import { FaSearch, FaCopy, FaExternalLinkAlt, FaEdit, FaCheck, FaTimes, FaChevronDown, FaChevronRight, FaUserShield, FaUsers, FaHistory, FaCrown, FaKey, FaPlus, FaTrash, FaLock, FaUnlock, FaClock, FaCoins, FaVoteYea, FaQuestion } from 'react-icons/fa';

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
    const [bulkMode, setBulkMode] = useState(null);
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
    const [showDissolveDelayDialog, setShowDissolveDelayDialog] = useState(false);
    const [dissolveDelayInput, setDissolveDelayInput] = useState('');
    
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
                                background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                boxShadow: `0 4px 20px ${neuronPrimary}40`
                            }}>
                                <FaUserShield size={24} color="white" />
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
                    {/* Search Section */}
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

                    {/* Neuron Data */}
                    {neuronData && !loading && (
                        <>
                            {/* Neuron Identity Card */}
                            <div className="neuron-card-animate" style={{ ...cardStyle, opacity: 0, animationDelay: '0.2s' }}>
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

                            {/* Stats Grid */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                                {/* Stake */}
                                <div className="neuron-card-animate" style={{ ...cardStyle, opacity: 0, animationDelay: '0.25s', marginBottom: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                        <FaCoins size={14} style={{ color: neuronGold }} />
                                        <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Stake</span>
                                    </div>
                                    <div style={{ color: theme.colors.primaryText, fontSize: '1.25rem', fontWeight: '700' }}>
                                        {formatE8s(neuronData.cached_neuron_stake_e8s)} {selectedSns?.symbol || 'tokens'}
                                    </div>
                                </div>

                                {/* Voting Power */}
                                <div className="neuron-card-animate" style={{ ...cardStyle, opacity: 0, animationDelay: '0.3s', marginBottom: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                        <FaVoteYea size={14} style={{ color: neuronPrimary }} />
                                        <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Voting Power</span>
                                    </div>
                                    <div style={{ color: theme.colors.primaryText, fontSize: '1.25rem', fontWeight: '700' }}>
                                        {nervousSystemParameters 
                                            ? formatVotingPower(calculateVotingPower(neuronData, nervousSystemParameters))
                                            : formatE8s(neuronData.voting_power || 0)}
                                    </div>
                                </div>

                                {/* Dissolve State */}
                                <div className="neuron-card-animate" style={{ ...cardStyle, opacity: 0, animationDelay: '0.35s', marginBottom: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                        {getDissolveState(neuronData).includes('Dissolving') ? <FaUnlock size={14} style={{ color: '#f59e0b' }} /> : <FaLock size={14} style={{ color: '#10b981' }} />}
                                        <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status</span>
                                    </div>
                                    <div style={{ color: theme.colors.primaryText, fontSize: '1rem', fontWeight: '600' }}>
                                        {getDissolveState(neuronData)}
                                    </div>
                                    {currentUserHasPermission(PERM.CONFIGURE_DISSOLVE_STATE) && (
                                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                                            <button onClick={() => setShowDissolveDelayDialog(true)} disabled={actionBusy}
                                                style={{
                                                    padding: '0.4rem 0.75rem', borderRadius: '6px', border: 'none',
                                                    background: neuronPrimary, color: 'white', fontSize: '0.75rem',
                                                    cursor: actionBusy ? 'wait' : 'pointer', opacity: actionBusy ? 0.5 : 1
                                                }}
                                            >
                                                <FaClock size={10} style={{ marginRight: '4px' }} /> Increase Delay
                                            </button>
                                            {getDissolveState(neuronData).includes('Locked') && (
                                                <button onClick={startDissolving} disabled={actionBusy}
                                                    style={{
                                                        padding: '0.4rem 0.75rem', borderRadius: '6px', border: `1px solid ${theme.colors.border}`,
                                                        background: 'transparent', color: theme.colors.secondaryText, fontSize: '0.75rem',
                                                        cursor: actionBusy ? 'wait' : 'pointer', opacity: actionBusy ? 0.5 : 1
                                                    }}
                                                >
                                                    <FaUnlock size={10} style={{ marginRight: '4px' }} /> Start Dissolving
                                                </button>
                                            )}
                                            {getDissolveState(neuronData).includes('Dissolving') && (
                                                <button onClick={stopDissolving} disabled={actionBusy}
                                                    style={{
                                                        padding: '0.4rem 0.75rem', borderRadius: '6px', border: `1px solid ${theme.colors.border}`,
                                                        background: 'transparent', color: theme.colors.secondaryText, fontSize: '0.75rem',
                                                        cursor: actionBusy ? 'wait' : 'pointer', opacity: actionBusy ? 0.5 : 1
                                                    }}
                                                >
                                                    <FaLock size={10} style={{ marginRight: '4px' }} /> Stop Dissolving
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Maturity */}
                                <div className="neuron-card-animate" style={{ ...cardStyle, opacity: 0, animationDelay: '0.4s', marginBottom: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                        <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Maturity</span>
                                    </div>
                                    <div style={{ color: theme.colors.primaryText, fontSize: '1rem', fontWeight: '600' }}>
                                        {formatE8s(neuronData.maturity_e8s_equivalent)}
                                    </div>
                                    {neuronData.staked_maturity_e8s_equivalent?.[0] > 0 && (
                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                            + {formatE8s(neuronData.staked_maturity_e8s_equivalent[0])} staked
                                        </div>
                                    )}
                                </div>
                            </div>

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
                                                    return (
                                                        <div key={idx} style={{
                                                            padding: '0.75rem 1rem', borderRadius: '10px',
                                                            background: theme.colors.primaryBg, border: `1px solid ${theme.colors.border}`
                                                        }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                                                                <div style={{ color: symbolInfo.color, fontSize: '1rem' }} title={symbolInfo.title}>
                                                                    {symbolInfo.icon}
                                                                </div>
                                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                                    <PrincipalDisplay 
                                                                        principal={perm.principal}
                                                                        displayInfo={principalDisplayInfo.get(perm.principal?.toString())}
                                                                        showCopyButton={false}
                                                                        short={true}
                                                                        isAuthenticated={isAuthenticated}
                                                                    />
                                                                </div>
                                                                {currentUserHasPermission(PERM.MANAGE_PRINCIPALS) && (
                                                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                                        <button onClick={() => startEditingPrincipal(perm)}
                                                                            style={{
                                                                                padding: '0.4rem', borderRadius: '6px', border: 'none',
                                                                                background: `${neuronPrimary}15`, color: neuronPrimary, cursor: 'pointer'
                                                                            }}
                                                                        >
                                                                            <FaEdit size={12} />
                                                                        </button>
                                                                        <button onClick={() => removePrincipal(perm.principal?.toString(), perm.permission_type)}
                                                                            style={{
                                                                                padding: '0.4rem', borderRadius: '6px', border: 'none',
                                                                                background: `${theme.colors.error}15`, color: theme.colors.error, cursor: 'pointer'
                                                                            }}
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
                                                <input
                                                    type="text" value={managePrincipalInput}
                                                    onChange={(e) => setManagePrincipalInput(e.target.value)}
                                                    placeholder="Enter principal ID"
                                                    disabled={!!editingPrincipal}
                                                    style={{
                                                        width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px',
                                                        border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg,
                                                        color: theme.colors.primaryText, fontSize: '0.85rem', marginBottom: '0.75rem',
                                                        boxSizing: 'border-box'
                                                    }}
                                                />
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
                                        {/* All Topics and Followees */}
                                        {(() => {
                                            const allTopics = [
                                                { key: 'Governance', label: 'Governance' },
                                                { key: 'DaoCommunitySettings', label: 'DAO Community Settings' },
                                                { key: 'SnsFrameworkManagement', label: 'SNS Framework Management' },
                                                { key: 'DappCanisterManagement', label: 'Dapp Canister Management' },
                                                { key: 'ApplicationBusinessLogic', label: 'Application Business Logic' },
                                                { key: 'TreasuryAssetManagement', label: 'Treasury Asset Management' },
                                                { key: 'CriticalDappOperations', label: 'Critical Dapp Operations' }
                                            ];
                                            const topicsWithFollowees = allTopics.filter(t => getCurrentFolloweesForTopic(t.key).length > 0);
                                            const hasAnyFollowees = topicsWithFollowees.length > 0;
                                            
                                            return (
                                                <div style={{ marginBottom: '1rem' }}>
                                                    {!hasAnyFollowees ? (
                                                        <p style={{ color: theme.colors.mutedText, fontSize: '0.9rem', textAlign: 'center', padding: '1rem' }}>
                                                            No followees configured for any topic
                                                        </p>
                                                    ) : (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                            {topicsWithFollowees.map(topic => {
                                                                const followees = getCurrentFolloweesForTopic(topic.key);
                                                                return (
                                                                    <div key={topic.key} style={{
                                                                        padding: '0.75rem', borderRadius: '10px',
                                                                        background: theme.colors.primaryBg, border: `1px solid ${theme.colors.border}`
                                                                    }}>
                                                                        <div style={{
                                                                            color: neuronAccent, fontSize: '0.8rem', fontWeight: '600',
                                                                            marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.5px'
                                                                        }}>
                                                                            {topic.label}
                                                                        </div>
                                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                                                            {followees.map((f, idx) => (
                                                                                <div key={idx} style={{
                                                                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                                                                    padding: '0.4rem 0.5rem', borderRadius: '6px',
                                                                                    background: theme.colors.secondaryBg
                                                                                }}>
                                                                                    <NeuronDisplay neuronId={f.neuronId} snsRoot={selectedSnsRoot} />
                                                                                    {f.alias && <span style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>({f.alias})</span>}
                                                                                    {currentUserHasPermission(PERM.MANAGE_VOTING_PERMISSION) && (
                                                                                        <button onClick={() => removeFollowee(f.neuronId, topic.key)} disabled={actionBusy}
                                                                                            style={{
                                                                                                marginLeft: 'auto', padding: '0.25rem', borderRadius: '4px', border: 'none',
                                                                                                background: `${theme.colors.error}15`, color: theme.colors.error, cursor: 'pointer'
                                                                                            }}
                                                                                        >
                                                                                            <FaTrash size={10} />
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

                                        {/* Add followee */}
                                        {currentUserHasPermission(PERM.MANAGE_VOTING_PERMISSION) && (
                                            <div style={{
                                                padding: '1rem', borderRadius: '10px',
                                                background: `linear-gradient(135deg, ${neuronAccent}08, ${neuronPrimary}05)`,
                                                border: `1px solid ${neuronAccent}20`
                                            }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Add Followee</h4>
                                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                                                    <select
                                                        value={topicInput}
                                                        onChange={(e) => setTopicInput(e.target.value)}
                                                        style={{
                                                            flex: '1 1 180px', padding: '0.5rem 0.75rem', borderRadius: '8px',
                                                            border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg,
                                                            color: theme.colors.primaryText, fontSize: '0.85rem'
                                                        }}
                                                    >
                                                        <option value="Governance">Governance</option>
                                                        <option value="DaoCommunitySettings">DAO Community Settings</option>
                                                        <option value="SnsFrameworkManagement">SNS Framework Management</option>
                                                        <option value="DappCanisterManagement">Dapp Canister Management</option>
                                                        <option value="ApplicationBusinessLogic">Application Business Logic</option>
                                                        <option value="TreasuryAssetManagement">Treasury Asset Management</option>
                                                        <option value="CriticalDappOperations">Critical Dapp Operations</option>
                                                    </select>
                                                </div>
                                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                    <input
                                                        type="text" value={followeeInput}
                                                        onChange={(e) => setFolloweeInput(e.target.value)}
                                                        placeholder="Neuron ID (hex)"
                                                        style={{
                                                            flex: '2 1 200px', padding: '0.5rem 0.75rem', borderRadius: '8px',
                                                            border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg,
                                                            color: theme.colors.primaryText, fontSize: '0.85rem'
                                                        }}
                                                    />
                                                    <input
                                                        type="text" value={followeeAliasInput}
                                                        onChange={(e) => setFolloweeAliasInput(e.target.value)}
                                                        placeholder="Alias (optional)"
                                                        style={{
                                                            flex: '1 1 120px', padding: '0.5rem 0.75rem', borderRadius: '8px',
                                                            border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg,
                                                            color: theme.colors.primaryText, fontSize: '0.85rem'
                                                        }}
                                                    />
                                                    <button onClick={addFollowee} disabled={actionBusy || !followeeInput}
                                                        style={{
                                                            padding: '0.5rem 1rem', borderRadius: '8px', border: 'none',
                                                            background: neuronAccent, color: 'white', fontSize: '0.85rem',
                                                            cursor: (actionBusy || !followeeInput) ? 'not-allowed' : 'pointer',
                                                            opacity: (actionBusy || !followeeInput) ? 0.5 : 1, whiteSpace: 'nowrap'
                                                        }}
                                                    >
                                                        <FaPlus size={10} style={{ marginRight: '4px' }} /> Add to {topicInput}
                                                    </button>
                                                </div>
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
                                        if (isNaN(days) || days < 0) { alert('Please enter a valid number of days'); return; }
                                        if (maxAdditionalDays > 0 && days > maxAdditionalDays) {
                                            alert(`Maximum ${isIncreasing ? 'additional ' : ''}dissolve delay is ${maxAdditionalDays} days`);
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
        </div>
    );
}

export default Neuron;
