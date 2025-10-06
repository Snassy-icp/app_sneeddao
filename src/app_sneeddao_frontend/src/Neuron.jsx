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
    const [managePermissionsInput, setManagePermissionsInput] = useState('1,2,4');
    const [topicInput, setTopicInput] = useState('Governance');
    const [followeeInput, setFolloweeInput] = useState('');
    const [followeeAliasInput, setFolloweeAliasInput] = useState('');
    
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

    // SNS permission ints: commonly used
    // 1 = ConfigureDissolveState, 2 = ManagePrincipals, 4 = RegisterVote (hotkey), 8 = Disburse
    const PERM = {
        CONFIGURE: 1,
        MANAGE_PRINCIPALS: 2,
        VOTE: 4,
        DISBURSE: 8
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
    const parsePermissions = (text) => {
        return text
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .map(n => Number(n))
            .filter(n => Number.isInteger(n));
    };

    const addPrincipalPermissions = async () => {
        try {
            setActionBusy(true); setActionMsg('Adding permissions...'); setError('');
            const principal = Principal.fromText(managePrincipalInput);
            const perms = parsePermissions(managePermissionsInput);
            const result = await manageNeuron({
                AddNeuronPermissions: {
                    principal_id: [principal],
                    permissions_to_add: [{ permissions: perms }]
                }
            });
            if (!result.ok) setError(result.err); else await fetchNeuronData();
        } catch (e) {
            setError(e.message || String(e));
        } finally {
            setActionBusy(false); setActionMsg('');
        }
    };

    const removePrincipalPermissions = async () => {
        try {
            setActionBusy(true); setActionMsg('Removing permissions...'); setError('');
            const principal = Principal.fromText(managePrincipalInput);
            const perms = parsePermissions(managePermissionsInput);
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
            setActionBusy(false); setActionMsg('');
        }
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

    const removeFollowee = async () => {
        try {
            setActionBusy(true); setActionMsg('Updating followees...'); setError('');
            const existing = getCurrentFolloweesForTopic(topicInput);
            const filtered = existing.filter(f => f.neuronId !== followeeInput.trim());
            const allFollowees = filtered.map(f => ({
                neuron_id: [{ id: Array.from(hexToBytes(f.neuronId)) }],
                alias: f.alias ? [f.alias] : []
            }));
            
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
                                {currentUserHasPermission(PERM.CONFIGURE) && (
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
                                    <h3 style={{ color: '#888', marginBottom: '12px' }}>Permissions</h3>
                                    {/* Owner */}
                                    {getOwnerPrincipals(neuronData).length > 0 && (
                                        <div style={{ 
                                            marginBottom: '12px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                        }}>
                                            <span style={{ color: '#888' }}>Owner:</span>
                                            <PrincipalDisplay 
                                                principal={Principal.fromText(getOwnerPrincipals(neuronData)[0])}
                                                displayInfo={principalDisplayInfo.get(getOwnerPrincipals(neuronData)[0])}
                                                showCopyButton={true}
                                                short={true}
                                            />
                                        </div>
                                    )}
                                    {/* Hotkeys */}
                                    {neuronData.permissions
                                        .filter(p => !getOwnerPrincipals(neuronData).includes(p.principal?.toString()))
                                        .map((p, index) => (
                                            <div key={index} style={{ 
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                marginBottom: index < neuronData.permissions.length - 1 ? '12px' : 0
                                            }}>
                                                <span style={{ color: '#888', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    🔑 Hotkey:
                                                </span>
                                                <PrincipalDisplay 
                                                    principal={p.principal}
                                                    displayInfo={principalDisplayInfo.get(p.principal?.toString())}
                                                    showCopyButton={true}
                                                    short={true}
                                                />
                                            </div>
                                        ))
                                    }
                                    {currentUserHasPermission(PERM.MANAGE_PRINCIPALS) && (
                                        <div style={{ marginTop: '12px', padding: '12px', backgroundColor: theme.colors.secondaryBg, borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <div style={{ color: theme.colors.mutedText, fontWeight: 'bold' }}>Manage principals and permissions</div>
                                            <input
                                                type="text"
                                                placeholder="Principal (PID)"
                                                value={managePrincipalInput}
                                                onChange={(e) => setManagePrincipalInput(e.target.value)}
                                                style={{ backgroundColor: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}`, color: theme.colors.primaryText, borderRadius: '4px', padding: '6px 8px' }}
                                            />
                                            <input
                                                type="text"
                                                placeholder="Permissions (comma-separated ints, e.g. 1,2,4)"
                                                value={managePermissionsInput}
                                                onChange={(e) => setManagePermissionsInput(e.target.value)}
                                                style={{ backgroundColor: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}`, color: theme.colors.primaryText, borderRadius: '4px', padding: '6px 8px' }}
                                            />
                                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                <button disabled={actionBusy} onClick={addPrincipalPermissions} style={{ backgroundColor: theme.colors.accent, color: theme.colors.primaryText, border: 'none', borderRadius: '4px', padding: '6px 10px', cursor: actionBusy ? 'not-allowed' : 'pointer' }}>Add permissions</button>
                                                <button disabled={actionBusy} onClick={removePrincipalPermissions} style={{ backgroundColor: theme.colors.error, color: theme.colors.primaryText, border: 'none', borderRadius: '4px', padding: '6px 10px', cursor: actionBusy ? 'not-allowed' : 'pointer' }}>Remove permissions</button>
                                            </div>
                                            <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                                Common permissions: 1 Configure, 2 Manage Principals, 4 Vote, 8 Disburse
                                            </div>
                                            {actionMsg && <div style={{ color: theme.colors.mutedText }}>{actionMsg}</div>}
                                        </div>
                                    )}
                                </div>

                                {/* Add followees section */}
                                <div style={{ marginTop: '20px' }}>
                                    <h3 style={{ color: '#888', marginBottom: '12px' }}>Following</h3>
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
                                                        {neuronData.topic_followees[0].topic_id_to_followees.map(([topicId, topicFollowees], index) => (
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
                                                                    {topicFollowees.topic && topicFollowees.topic[0] && (
                                                                        <span style={{ marginLeft: '8px', color: '#aaa' }}>
                                                                            ({Object.keys(topicFollowees.topic[0])[0]})
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
                                                                                {followee.alias && followee.alias[0] && (
                                                                                    <span style={{ 
                                                                                        color: theme.colors.mutedText,
                                                                                        fontSize: '12px',
                                                                                        fontStyle: 'italic'
                                                                                    }}>
                                                                                        alias: {followee.alias[0]}
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                    {currentUserHasPermission(PERM.CONFIGURE) && (
                                        <div style={{ marginTop: '12px', padding: '12px', backgroundColor: theme.colors.secondaryBg, borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <div style={{ color: theme.colors.mutedText, fontWeight: 'bold' }}>Edit followees (by topic)</div>
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
                                            {actionMsg && <div style={{ color: theme.colors.mutedText }}>{actionMsg}</div>}
                                        </div>
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