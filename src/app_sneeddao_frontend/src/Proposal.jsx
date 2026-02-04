import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'declarations/rll';
import { useAuth } from './AuthContext';
import { useSns } from './contexts/SnsContext';
import { useNeurons } from './contexts/NeuronsContext';
import { useForum } from './contexts/ForumContext';
import Header from './components/Header';
import HotkeyNeurons from './components/HotkeyNeurons';
import Discussion from './components/Discussion';
import ThreadViewer from './components/ThreadViewer';
import ReactMarkdown from 'react-markdown';
import './Wallet.css';
import { getSnsById, getAllSnses, clearSnsCache } from './utils/SnsUtils';
import { useOptimizedSnsLoading } from './hooks/useOptimizedSnsLoading';
import { formatNeuronDisplayWithContext, uint8ArrayToHex, extractPrincipalString } from './utils/NeuronUtils';
import { fetchUserNeuronsForSns } from './utils/NeuronUtils';
import { useNaming } from './NamingContext';
import { useTheme } from './contexts/ThemeContext';
import { Principal } from '@dfinity/principal';
import { getProposalStatus, isProposalAcceptingVotes, getVotingTimeRemaining } from './utils/ProposalUtils';
import { calculateVotingPower, formatVotingPower } from './utils/VotingPowerUtils';
import { FaChevronLeft, FaChevronRight, FaSearch, FaExternalLinkAlt, FaCheckCircle, FaTimesCircle, FaClock, FaVoteYea, FaComments, FaChevronDown, FaChevronUp, FaFilter, FaSort, FaGavel, FaUsers, FaCrown, FaKey, FaUserShield, FaCoins, FaQuestion } from 'react-icons/fa';
import { getRelativeTime, getFullDate } from './utils/DateUtils';
import { getNeuronFromCache } from './hooks/useNeuronsCache';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from './utils/PrincipalUtils';

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

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

@keyframes slideIn {
    from {
        opacity: 0;
        transform: translateX(-10px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

.proposal-animate {
    animation: fadeInUp 0.4s ease-out forwards;
}

.proposal-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.proposal-slide {
    animation: slideIn 0.3s ease-out forwards;
}
`;

// Accent colors - matching Forum/Topic pages
const proposalPrimary = '#6366f1'; // Indigo
const proposalSecondary = '#8b5cf6'; // Purple
const proposalAccent = '#06b6d4'; // Cyan

// System font stack
const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function Proposal() {
    const { theme } = useTheme();
    const { isAuthenticated, identity } = useAuth();
    const { selectedSnsRoot, updateSelectedSns, SNEED_SNS_ROOT } = useSns();
    const { fetchNeuronsForSns, refreshNeurons, getHotkeyNeurons } = useNeurons();
    const { createForumActor } = useForum();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const [proposalIdInput, setProposalIdInput] = useState(searchParams.get('proposalid') || '');
    const [currentProposalId, setCurrentProposalId] = useState(searchParams.get('proposalid') || '');
    const [proposalData, setProposalData] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    
    const { 
        snsList, 
        currentSns, 
        loadingCurrent: loadingSnses, 
        error: snsError 
    } = useOptimizedSnsLoading();
    const [votingHistory, setVotingHistory] = useState(null);
    const [isVotingHistoryExpanded, setIsVotingHistoryExpanded] = useState(false);
    const [hideYes, setHideYes] = useState(false);
    const [hideNo, setHideNo] = useState(false);
    const [hideNotVoted, setHideNotVoted] = useState(false);
    const [sortBy, setSortBy] = useState('date');

    const [forumActor, setForumActor] = useState(null);
    const [isProposalExpanded, setIsProposalExpanded] = useState(true);
    const [isDiscussionExpanded, setIsDiscussionExpanded] = useState(true);
    const [proposalThreadId, setProposalThreadId] = useState(null);
    const [threadLinkLoading, setThreadLinkLoading] = useState(false);
    const [discussionThread, setDiscussionThread] = useState(null);
    const [loadingThread, setLoadingThread] = useState(false);
    
    const [quickVoteState, setQuickVoteState] = useState('idle');
    const [eligibleNeuronsInfo, setEligibleNeuronsInfo] = useState({ count: 0, totalVP: 0 });
    const [nervousSystemParams, setNervousSystemParams] = useState(null);

    const { getNeuronDisplayName, neuronNames, neuronNicknames, verifiedNames, principalNames, principalNicknames } = useNaming();

    // Proposer permissions state
    const [proposerPermissions, setProposerPermissions] = useState(null);

    // Permission constants
    const PERM = {
        UNSPECIFIED: 0, CONFIGURE_DISSOLVE_STATE: 1, MANAGE_PRINCIPALS: 2, SUBMIT_PROPOSAL: 3,
        VOTE: 4, DISBURSE: 5, SPLIT: 6, MERGE_MATURITY: 7, DISBURSE_MATURITY: 8, STAKE_MATURITY: 9, MANAGE_VOTING_PERMISSION: 10
    };

    // Get principal symbol based on permissions
    const getPrincipalSymbol = (perms) => {
        const permArray = perms?.permission_type || [];
        const permCount = permArray.length;
        if (permCount === 10 || permCount === 11) return { icon: <FaCrown size={10} />, title: 'Full Owner', color: '#f59e0b' };
        const hasSubmit = permArray.includes(PERM.SUBMIT_PROPOSAL);
        const hasVote = permArray.includes(PERM.VOTE);
        if (permCount === 2 && hasSubmit && hasVote) return { icon: <FaKey size={10} />, title: 'Hotkey', color: '#06b6d4' };
        if (permCount === 1 && hasVote) return { icon: <FaVoteYea size={10} />, title: 'Voter', color: '#10b981' };
        if (permArray.includes(PERM.MANAGE_PRINCIPALS)) return { icon: <FaUserShield size={10} />, title: 'Manager', color: proposalPrimary };
        if (permArray.includes(PERM.DISBURSE) || permArray.includes(PERM.DISBURSE_MATURITY)) return { icon: <FaCoins size={10} />, title: 'Financial', color: '#f59e0b' };
        return { icon: <FaQuestion size={10} />, title: 'Custom', color: theme.colors.mutedText };
    };

    // Get principal display info
    const getPrincipalDisplayInfoLocal = (principalStr) => {
        if (!principalStr || !principalNames || !principalNicknames) return null;
        try {
            return getPrincipalDisplayInfoFromContext(Principal.fromText(principalStr), principalNames, principalNicknames);
        } catch {
            return null;
        }
    };

    const getNeuronDisplayInfo = (neuronId) => {
        if (!neuronId || !selectedSnsRoot) return null;
        
        const neuronIdHex = uint8ArrayToHex(neuronId);
        if (!neuronIdHex) return null;
        
        const mapKey = `${selectedSnsRoot}:${neuronIdHex}`;
        const name = neuronNames?.get(mapKey);
        const nickname = neuronNicknames?.get(mapKey);
        const isVerified = verifiedNames?.get(mapKey);
        
        return { name, nickname, isVerified };
    };

    const handleNicknameUpdate = (neuronId, snsRoot, newNickname) => {
        console.log('Nickname updated for neuron:', neuronId, 'in SNS:', snsRoot, 'new nickname:', newNickname);
    };

    useEffect(() => {
        if (isAuthenticated && identity) {
            const actor = createForumActor(identity);
            setForumActor(actor);
        } else {
            const actor = createForumActor(null);
            setForumActor(actor);
        }
    }, [isAuthenticated, identity, createForumActor]);

    useEffect(() => {
        if (snsError) {
            setError(snsError);
        }
    }, [snsError]);

    useEffect(() => {
        if (currentProposalId && selectedSnsRoot) {
            fetchProposalData();
        }
    }, [currentProposalId, selectedSnsRoot]);

    // Fetch proposer neuron permissions
    useEffect(() => {
        if (!proposalData?.proposer?.[0]?.id || !selectedSnsRoot) {
            setProposerPermissions(null);
            return;
        }
        
        const fetchProposerPermissions = async () => {
            const neuronIdHex = uint8ArrayToHex(proposalData.proposer[0].id);
            if (!neuronIdHex) return;
            
            try {
                const neuron = await getNeuronFromCache(selectedSnsRoot, neuronIdHex);
                if (neuron?.permissions?.length > 0) {
                    setProposerPermissions(neuron.permissions);
                }
            } catch (err) {
                console.warn('Failed to load proposer permissions:', err);
            }
        };
        
        fetchProposerPermissions();
    }, [proposalData, selectedSnsRoot]);

    useEffect(() => {
        if (forumActor && currentProposalId && selectedSnsRoot) {
            fetchDiscussionThread();
        }
    }, [forumActor, currentProposalId, selectedSnsRoot]);

    const fetchProposalData = async () => {
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

            const proposalIdArg = {
                proposal_id: [{ id: BigInt(currentProposalId) }]
            };

            const response = await snsGovActor.get_proposal(proposalIdArg);
            if (response?.result?.[0]?.Proposal) {
                setProposalData(response.result[0].Proposal);
            } else if (response?.result?.[0]?.Error) {
                setError(response.result[0].Error.error_message);
            } else {
                setError('Proposal not found');
            }
        } catch (err) {
            console.error('Error fetching proposal data:', err);
            setError('Failed to fetch proposal data');
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = (e) => {
        e.preventDefault();
        setError('');
        
        if (!proposalIdInput.trim()) {
            setError('Please enter a proposal ID');
            return;
        }

        if (!selectedSnsRoot) {
            setError('Please select an SNS');
            return;
        }

        if (!/^\d+$/.test(proposalIdInput)) {
            setError('Proposal ID must be a number');
            return;
        }

        setSearchParams({ proposalid: proposalIdInput, sns: selectedSnsRoot });
        setCurrentProposalId(proposalIdInput);
    };

    const handleSnsChange = async (newSnsRoot) => {
        updateSelectedSns(newSnsRoot);
        setProposalData(null);
        
        setSearchParams(prev => {
            prev.set('sns', newSnsRoot);
            if (currentProposalId) {
                prev.set('proposalid', currentProposalId);
            }
            return prev;
        });

        if (currentProposalId) {
            const selectedSns = getSnsById(newSnsRoot);
            if (!selectedSns) {
                setError('Selected SNS not found');
                return;
            }

            setLoading(true);
            setError('');
            try {
                const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                    agentOptions: {
                        identity,
                    },
                });

                const proposalIdArg = {
                    proposal_id: [{ id: BigInt(currentProposalId) }]
                };

                const response = await snsGovActor.get_proposal(proposalIdArg);
                if (response?.result?.[0]?.Proposal) {
                    setProposalData(response.result[0].Proposal);
                } else if (response?.result?.[0]?.Error) {
                    setError(response.result[0].Error.error_message);
                } else {
                    setError('Proposal not found');
                }
            } catch (err) {
                console.error('Error fetching proposal data:', err);
                setError('Failed to fetch proposal data');
            } finally {
                setLoading(false);
            }
        }
    };

    const formatE8s = (e8s) => {
        return (Number(e8s) / 100000000).toFixed(8);
    };

    const fetchDiscussionThread = async () => {
        if (!forumActor || !currentProposalId || !selectedSnsRoot) return;
        
        setLoadingThread(true);
        try {
            const threadResult = await forumActor.get_proposal_thread(
                Principal.fromText(selectedSnsRoot), 
                Number(currentProposalId)
            );
            
            if (threadResult && threadResult.length > 0) {
                const thread = threadResult[0];
                setDiscussionThread(thread);
                setProposalThreadId(Number(thread.thread_id));
            } else {
                setDiscussionThread(null);
                setProposalThreadId(null);
            }
        } catch (err) {
            console.error('Error fetching discussion thread:', err);
            setDiscussionThread(null);
            setProposalThreadId(null);
        } finally {
            setLoadingThread(false);
        }
    };

    const fetchNeuronsFromSns = async () => {
        if (!selectedSnsRoot) return [];
        return await fetchNeuronsForSns(selectedSnsRoot);
    };

    useEffect(() => {
        const fetchParams = async () => {
            if (!selectedSnsRoot || !identity) {
                setNervousSystemParams(null);
                return;
            }
            
            try {
                const selectedSns = getSnsById(selectedSnsRoot);
                if (!selectedSns) return;

                const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                    agentOptions: { identity }
                });
                
                const params = await snsGovActor.get_nervous_system_parameters(null);
                setNervousSystemParams(params);
            } catch (error) {
                console.error('Error fetching nervous system parameters:', error);
                setNervousSystemParams(null);
            }
        };

        fetchParams();
    }, [selectedSnsRoot, identity]);

    useEffect(() => {
        if (!proposalData || !isAuthenticated || !identity || !isProposalAcceptingVotes(proposalData)) {
            setEligibleNeuronsInfo({ count: 0, totalVP: 0 });
            return;
        }

        const hotkeyNeurons = getHotkeyNeurons();
        if (!hotkeyNeurons || hotkeyNeurons.length === 0) {
            setEligibleNeuronsInfo({ count: 0, totalVP: 0 });
            return;
        }

        let eligibleCount = 0;
        let totalVP = 0;

        for (const neuron of hotkeyNeurons) {
            const votingPower = nervousSystemParams ? 
                calculateVotingPower(neuron, nervousSystemParams) : 0;
            if (votingPower === 0) continue;

            const neuronIdHex = uint8ArrayToHex(neuron.id?.[0]?.id);
            const ballot = proposalData.ballots?.find(([id, _]) => id === neuronIdHex);
            
            if (ballot && ballot[1]) {
                const ballotData = ballot[1];
                const hasVoted = ballotData.cast_timestamp_seconds && Number(ballotData.cast_timestamp_seconds) > 0;
                if (hasVoted) continue;
            }

            eligibleCount++;
            totalVP += votingPower;
        }

        setEligibleNeuronsInfo({ count: eligibleCount, totalVP });
    }, [proposalData, isAuthenticated, identity, getHotkeyNeurons, nervousSystemParams]);

    const quickVoteAll = async (vote) => {
        if (!identity || !selectedSnsRoot || !currentProposalId || !proposalData) return;

        const hotkeyNeurons = getHotkeyNeurons();
        if (!hotkeyNeurons || hotkeyNeurons.length === 0) return;

        setQuickVoteState('voting');

        try {
            const selectedSns = getSnsById(selectedSnsRoot);
            if (!selectedSns) throw new Error('SNS not found');

            const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                agentOptions: { identity }
            });

            const eligibleNeurons = hotkeyNeurons.filter(neuron => {
                const votingPower = nervousSystemParams ? 
                    calculateVotingPower(neuron, nervousSystemParams) : 0;
                if (votingPower === 0) return false;

                const neuronIdHex = uint8ArrayToHex(neuron.id?.[0]?.id);
                const ballot = proposalData.ballots?.find(([id, _]) => id === neuronIdHex);
                
                if (ballot && ballot[1]) {
                    const ballotData = ballot[1];
                    const hasVoted = ballotData.cast_timestamp_seconds && Number(ballotData.cast_timestamp_seconds) > 0;
                    if (hasVoted) return false;
                }

                return true;
            });

            if (eligibleNeurons.length === 0) {
                setQuickVoteState('error');
                setTimeout(() => setQuickVoteState('idle'), 3000);
                return;
            }

            let successCount = 0;

            for (const neuron of eligibleNeurons) {
                try {
                    const manageNeuronRequest = {
                        subaccount: neuron.id[0]?.id,
                        command: [{
                            RegisterVote: {
                                vote: vote,
                                proposal: [{ id: BigInt(currentProposalId) }]
                            }
                        }]
                    };
                    
                    const response = await snsGovActor.manage_neuron(manageNeuronRequest);
                    
                    if (response?.command?.[0]?.RegisterVote) {
                        successCount++;
                    }
                } catch (error) {
                    console.error('Error voting with neuron:', error);
                }
            }

            if (successCount > 0) {
                setQuickVoteState('success');
                setEligibleNeuronsInfo({ count: 0, totalVP: 0 });
                await refreshNeurons(selectedSnsRoot);
                fetchProposalData();
            } else {
                setQuickVoteState('error');
            }

            setTimeout(() => setQuickVoteState('idle'), 3000);

        } catch (error) {
            console.error('Quick vote error:', error);
            setQuickVoteState('error');
            setTimeout(() => setQuickVoteState('idle'), 3000);
        }
    };

    const formatCompactVP = (vp) => {
        if (!vp || vp === 0) return '0';
        const displayValue = vp / 100_000_000;
        if (displayValue >= 1_000_000) {
            return (displayValue / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
        } else if (displayValue >= 1_000) {
            return (displayValue / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
        }
        return displayValue.toFixed(displayValue < 10 ? 1 : 0).replace(/\.0$/, '');
    };

    const calculateVotingPercentages = (tally) => {
        if (!tally) return { yesPercent: 0, noPercent: 0 };
        const total = Number(tally.total);
        if (total === 0) return { yesPercent: 0, noPercent: 0 };
        
        const yesPercent = (Number(tally.yes) / total) * 100;
        const noPercent = (Number(tally.no) / total) * 100;
        return { yesPercent, noPercent };
    };

    const fetchProposalThread = async () => {
        if (!forumActor || !currentProposalId || !selectedSnsRoot) return;
        
        try {
            setThreadLinkLoading(true);
            const response = await forumActor.get_proposal_thread(
                Principal.fromText(selectedSnsRoot), 
                Number(currentProposalId)
            );
            
            if (response && response.length > 0) {
                setProposalThreadId(Number(response[0].thread_id));
            } else {
                setProposalThreadId(null);
            }
        } catch (error) {
            console.error('Error fetching proposal thread:', error);
            setProposalThreadId(null);
        } finally {
            setThreadLinkLoading(false);
        }
    };

    const isCriticalProposal = (data) => {
        return data?.minimum_yes_proportion_of_exercised?.[0]?.basis_points?.[0] === 6700n;
    };

    const getTopicName = (data) => {
        if (!data?.topic?.[0]) return 'Unknown';
        const topicKey = Object.keys(data.topic[0])[0];
        return topicKey || 'Unknown';
    };

    const calculateStandardMajorityThreshold = (tally) => {
        if (!tally) return 0;
        return (Number(tally.total) * 0.03);
    };

    const convertHtmlToMarkdown = (text) => {
        if (!text) return '';
        return text.replace(/<br>/g, '\n\n');
    };

    const selectedSns = getSnsById(selectedSnsRoot);

    // Get status color
    const getStatusColor = (status) => {
        if (status.includes('Executed') || status.includes('Adopted')) return theme.colors.success;
        if (status.includes('Rejected') || status.includes('Failed')) return theme.colors.error;
        if (status.includes('Open')) return proposalPrimary;
        return theme.colors.mutedText;
    };

    // Get status icon
    const getStatusIcon = (status) => {
        if (status.includes('Executed') || status.includes('Adopted')) return <FaCheckCircle />;
        if (status.includes('Rejected') || status.includes('Failed')) return <FaTimesCircle />;
        if (status.includes('Open')) return <FaClock />;
        return <FaClock />;
    };

    // VotingBar component
    const VotingBar = ({ proposalData }) => {
        if (!proposalData?.latest_tally?.[0]) return null;
        
        const tally = proposalData.latest_tally[0];
        const { yesPercent, noPercent } = useMemo(() => calculateVotingPercentages(tally), [tally]);
        const isCritical = useMemo(() => isCriticalProposal(proposalData), [proposalData]);
        const standardMajorityThreshold = useMemo(() => calculateStandardMajorityThreshold(tally), [tally]);
        const standardMajorityPercent = useMemo(() => (standardMajorityThreshold / Number(tally.total)) * 100, [standardMajorityThreshold, tally.total]);
        
        return (
            <div style={{ marginTop: '1.5rem' }}>
                {/* Vote Summary */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '1rem'
                }}>
                    <div>
                        <div style={{
                            color: theme.colors.success,
                            fontSize: '1.5rem',
                            fontWeight: '700'
                        }}>
                            {yesPercent.toFixed(2)}%
                        </div>
                        <div style={{
                            color: theme.colors.success,
                            fontSize: '0.85rem',
                            opacity: 0.8
                        }}>
                            {formatE8s(tally.yes)} VP
                        </div>
                    </div>
                    <div style={{
                        textAlign: 'center',
                        color: theme.colors.mutedText,
                        fontSize: '0.8rem'
                    }}>
                        <div>Total: {formatE8s(tally.total)} VP</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{
                            color: theme.colors.error,
                            fontSize: '1.5rem',
                            fontWeight: '700'
                        }}>
                            {noPercent.toFixed(2)}%
                        </div>
                        <div style={{
                            color: theme.colors.error,
                            fontSize: '0.85rem',
                            opacity: 0.8
                        }}>
                            {formatE8s(tally.no)} VP
                        </div>
                    </div>
                </div>
                
                {/* Voting Bar */}
                <div style={{ 
                    position: 'relative',
                    height: '28px',
                    backgroundColor: theme.colors.border,
                    borderRadius: '14px',
                    overflow: 'visible',
                    marginBottom: '2.5rem'
                }}>
                    {/* Yes votes */}
                    <div style={{
                        position: 'absolute',
                        left: 0,
                        height: '100%',
                        width: `${yesPercent}%`,
                        background: `linear-gradient(90deg, ${theme.colors.success}, #27ae60)`,
                        borderRadius: '14px 0 0 14px',
                        transition: 'width 0.5s ease'
                    }} />
                    
                    {/* No votes */}
                    <div style={{
                        position: 'absolute',
                        right: 0,
                        height: '100%',
                        width: `${noPercent}%`,
                        background: `linear-gradient(90deg, #c0392b, ${theme.colors.error})`,
                        borderRadius: '0 14px 14px 0',
                        transition: 'width 0.5s ease'
                    }} />
                    
                    {/* Threshold markers */}
                    {isCritical ? (
                        <>
                            <div style={{
                                position: 'absolute',
                                left: '67%',
                                height: '36px',
                                width: '3px',
                                backgroundColor: proposalSecondary,
                                top: '-4px',
                                borderRadius: '2px',
                                cursor: 'help'
                            }} title="Critical: 67% threshold for immediate adoption" />
                            <div style={{
                                position: 'absolute',
                                left: '20%',
                                height: '36px',
                                width: '3px',
                                backgroundColor: '#f39c12',
                                top: '-4px',
                                borderRadius: '2px',
                                cursor: 'help'
                            }} title="Minimum 20% participation required" />
                        </>
                    ) : (
                        <>
                            <div style={{
                                position: 'absolute',
                                left: '50%',
                                height: '36px',
                                width: '3px',
                                backgroundColor: proposalSecondary,
                                top: '-4px',
                                borderRadius: '2px',
                                cursor: 'help'
                            }} title="50% threshold for adoption" />
                            <div style={{
                                position: 'absolute',
                                left: `${standardMajorityPercent}%`,
                                height: '36px',
                                width: '3px',
                                backgroundColor: '#f39c12',
                                top: '-4px',
                                borderRadius: '2px',
                                cursor: 'help'
                            }} title="3% minimum participation" />
                        </>
                    )}
                    
                    {/* Current position */}
                    <div style={{
                        position: 'absolute',
                        left: `${yesPercent}%`,
                        height: '36px',
                        width: '3px',
                        backgroundColor: proposalAccent,
                        top: '-4px',
                        borderRadius: '2px',
                        cursor: 'help',
                        boxShadow: `0 0 8px ${proposalAccent}`
                    }} title={`Current: ${yesPercent.toFixed(2)}% Yes`} />
                </div>
                
                {/* Legend */}
                <div style={{
                    display: 'flex',
                    gap: '1.5rem',
                    flexWrap: 'wrap',
                    fontSize: '0.8rem',
                    color: theme.colors.mutedText
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '12px', height: '12px', backgroundColor: proposalAccent, borderRadius: '2px' }} />
                        <span>Current</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '12px', height: '12px', backgroundColor: proposalSecondary, borderRadius: '2px' }} />
                        <span>{isCritical ? '67% Threshold' : '50% Threshold'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '12px', height: '12px', backgroundColor: '#f39c12', borderRadius: '2px' }} />
                        <span>Min. Participation</span>
                    </div>
                </div>
            </div>
        );
    };

    const formatVote = (voteNumber) => {
        switch (voteNumber) {
            case 1: return 'Yes';
            case 2: return 'No';
            default: return 'Not Voted';
        }
    };

    const formatNeuronId = (neuronId) => {
        if (!neuronId) return 'Unknown';
        return Array.from(neuronId).map(b => b.toString(16).padStart(2, '0')).join('');
    };

    const fetchRllVotingHistory = async (proposalId) => {
        try {
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            const ballots = await rllActor.get_proposal_ballots(BigInt(proposalId));
            setVotingHistory(ballots);
        } catch (err) {
            console.error('Error fetching RLL voting history:', err);
            setVotingHistory([]);
        }
    };

    useEffect(() => {
        if (proposalData && selectedSnsRoot === SNEED_SNS_ROOT && (!proposalData.ballots || proposalData.ballots.length === 0)) {
            fetchRllVotingHistory(currentProposalId);
        } else if (proposalData && proposalData.ballots) {
            setVotingHistory(proposalData.ballots);
        }
    }, [proposalData, selectedSnsRoot, currentProposalId]);

    useEffect(() => {
        if (forumActor && currentProposalId && selectedSnsRoot) {
            fetchProposalThread();
        }
    }, [forumActor, currentProposalId, selectedSnsRoot]);

    const filterAndSortVotes = (votes) => {
        if (!votes) return [];
        const filtered = votes.filter(([_, ballot]) => {
            if (ballot.vote === 1 && hideYes) return false;
            if (ballot.vote === 2 && hideNo) return false;
            if (ballot.vote !== 1 && ballot.vote !== 2 && hideNotVoted) return false;
            return true;
        });

        return filtered.sort((a, b) => {
            const [, ballotA] = a;
            const [, ballotB] = b;
            if (sortBy === 'date') {
                return Number(ballotB.cast_timestamp_seconds) - Number(ballotA.cast_timestamp_seconds);
            } else {
                return Number(ballotB.voting_power) - Number(ballotA.voting_power);
            }
        });
    };

    return (
        <div className='page-container'>
            <style>{customStyles}</style>
            <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
            
            <main style={{
                background: theme.colors.primaryGradient,
                minHeight: '100vh'
            }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${proposalPrimary}15 50%, ${proposalSecondary}10 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    padding: '2rem 1.5rem',
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    <div style={{
                        position: 'absolute',
                        top: '-50%',
                        right: '-10%',
                        width: '400px',
                        height: '400px',
                        background: `radial-gradient(circle, ${proposalPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    
                    <div style={{
                        maxWidth: '900px',
                        margin: '0 auto',
                        position: 'relative',
                        zIndex: 1
                    }}>
                        {/* Title */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1rem',
                            marginBottom: '1.5rem'
                        }}>
                            <div style={{
                                width: '56px',
                                height: '56px',
                                borderRadius: '16px',
                                background: `linear-gradient(135deg, ${proposalPrimary}, ${proposalSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'white',
                                flexShrink: 0,
                                boxShadow: `0 4px 20px ${proposalPrimary}40`
                            }}>
                                <FaGavel size={24} />
                            </div>
                            <div>
                                <h1 style={{
                                    color: theme.colors.primaryText,
                                    fontSize: '2rem',
                                    fontWeight: '700',
                                    margin: 0
                                }}>
                                    Proposal Details
                                </h1>
                                <p style={{
                                    color: theme.colors.secondaryText,
                                    fontSize: '1rem',
                                    margin: '0.25rem 0 0 0'
                                }}>
                                    {selectedSns?.name || 'Select an SNS'} Governance
                                </p>
                            </div>
                        </div>
                        
                        {/* Navigation */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1rem',
                            flexWrap: 'wrap'
                        }}>
                            <button 
                                onClick={() => {
                                    const prevId = Number(currentProposalId) - 1;
                                    if (prevId >= 1) {
                                        setProposalIdInput(prevId.toString());
                                        setSearchParams({ proposalid: prevId.toString(), sns: selectedSnsRoot });
                                        setCurrentProposalId(prevId.toString());
                                    }
                                }}
                                disabled={Number(currentProposalId) <= 1}
                                style={{
                                    background: Number(currentProposalId) > 1 
                                        ? `linear-gradient(135deg, ${proposalPrimary}, ${proposalSecondary})`
                                        : theme.colors.mutedText,
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '10px',
                                    padding: '0.6rem 1rem',
                                    cursor: Number(currentProposalId) > 1 ? 'pointer' : 'not-allowed',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    fontSize: '0.9rem',
                                    fontWeight: '500',
                                    opacity: Number(currentProposalId) > 1 ? 1 : 0.5,
                                    transition: 'all 0.3s ease'
                                }}
                            >
                                <FaChevronLeft size={12} />
                                Previous
                            </button>

                            <form onSubmit={handleSearch} style={{ 
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                flex: 1,
                                maxWidth: '300px'
                            }}>
                                <div style={{ 
                                    flex: 1,
                                    position: 'relative'
                                }}>
                                    <span style={{
                                        position: 'absolute',
                                        left: '12px',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        color: theme.colors.mutedText,
                                        fontSize: '0.9rem'
                                    }}>#</span>
                                    <input
                                        type="text"
                                        value={proposalIdInput}
                                        onChange={(e) => setProposalIdInput(e.target.value)}
                                        placeholder="Proposal ID"
                                        style={{
                                            width: '100%',
                                            background: theme.colors.secondaryBg,
                                            border: `1px solid ${theme.colors.border}`,
                                            borderRadius: '10px',
                                            padding: '0.6rem 0.75rem 0.6rem 2rem',
                                            color: theme.colors.primaryText,
                                            fontSize: '0.9rem',
                                            boxSizing: 'border-box'
                                        }}
                                    />
                                </div>
                                <button 
                                    type="submit" 
                                    style={{
                                        background: `linear-gradient(135deg, ${proposalPrimary}, ${proposalSecondary})`,
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '10px',
                                        padding: '0.6rem 1rem',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        fontSize: '0.9rem',
                                        fontWeight: '500'
                                    }}
                                >
                                    <FaSearch size={12} />
                                    Go
                                </button>
                            </form>

                            <button
                                onClick={() => {
                                    const nextId = Number(currentProposalId) + 1;
                                    setProposalIdInput(nextId.toString());
                                    setSearchParams({ proposalid: nextId.toString(), sns: selectedSnsRoot });
                                    setCurrentProposalId(nextId.toString());
                                }}
                                style={{
                                    background: `linear-gradient(135deg, ${proposalPrimary}, ${proposalSecondary})`,
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '10px',
                                    padding: '0.6rem 1rem',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    fontSize: '0.9rem',
                                    fontWeight: '500',
                                    transition: 'all 0.3s ease'
                                }}
                            >
                                Next
                                <FaChevronRight size={12} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div style={{
                    maxWidth: '900px',
                    margin: '0 auto',
                    padding: '2rem 1.5rem'
                }}>
                    {/* Error */}
                    {error && (
                        <div style={{
                            background: 'rgba(231, 76, 60, 0.1)',
                            border: '1px solid rgba(231, 76, 60, 0.3)',
                            borderRadius: '12px',
                            padding: '1rem 1.5rem',
                            marginBottom: '1.5rem',
                            color: theme.colors.error,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem'
                        }}>
                            <FaTimesCircle />
                            {error}
                        </div>
                    )}

                    {/* Loading */}
                    {loading && (
                        <div style={{
                            textAlign: 'center',
                            padding: '4rem 2rem',
                            color: theme.colors.mutedText
                        }}>
                            <div className="proposal-pulse" style={{
                                width: '60px',
                                height: '60px',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${proposalPrimary}, ${proposalSecondary})`,
                                margin: '0 auto 1rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <FaGavel size={24} color="white" />
                            </div>
                            <p>Loading proposal...</p>
                        </div>
                    )}

                    {/* Proposal Content */}
                    {proposalData && !loading && !error && (
                        <div className="proposal-animate" style={{ opacity: 0 }}>
                            {/* Proposal Info Card */}
                            <div style={{
                                background: theme.colors.secondaryBg,
                                borderRadius: '16px',
                                border: `1px solid ${theme.colors.border}`,
                                marginBottom: '1.5rem',
                                overflow: 'hidden'
                            }}>
                                {/* Header */}
                                <div 
                                    onClick={() => setIsProposalExpanded(!isProposalExpanded)}
                                    style={{
                                        padding: '1.25rem 1.5rem',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        background: `linear-gradient(135deg, ${proposalPrimary}10 0%, transparent 100%)`,
                                        borderBottom: isProposalExpanded ? `1px solid ${theme.colors.border}` : 'none'
                                    }}
                                >
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '1rem'
                                    }}>
                                        <div style={{
                                            width: '40px',
                                            height: '40px',
                                            borderRadius: '10px',
                                            background: `${proposalPrimary}20`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: proposalPrimary
                                        }}>
                                            <FaGavel size={18} />
                                        </div>
                                        <div>
                                            <h2 style={{
                                                color: theme.colors.primaryText,
                                                fontSize: '1.1rem',
                                                fontWeight: '600',
                                                margin: 0
                                            }}>
                                                Proposal #{currentProposalId}
                                            </h2>
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.75rem',
                                                marginTop: '0.25rem'
                                            }}>
                                                <span style={{
                                                    color: getStatusColor(getProposalStatus(proposalData)),
                                                    fontSize: '0.85rem',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px'
                                                }}>
                                                    {getStatusIcon(getProposalStatus(proposalData))}
                                                    {getProposalStatus(proposalData)}
                                                </span>
                                                <span style={{
                                                    color: theme.colors.mutedText,
                                                    fontSize: '0.85rem'
                                                }}>
                                                    • {getTopicName(proposalData)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    {isProposalExpanded ? <FaChevronUp color={theme.colors.mutedText} /> : <FaChevronDown color={theme.colors.mutedText} />}
                                </div>
                                
                                {/* Content */}
                                {isProposalExpanded && (
                                    <div style={{ padding: '1.5rem' }}>
                                        {/* Title */}
                                        <h3 style={{
                                            color: theme.colors.primaryText,
                                            fontSize: '1.25rem',
                                            fontWeight: '600',
                                            marginBottom: '1rem'
                                        }}>
                                            {proposalData.proposal?.[0]?.title || 'Untitled Proposal'}
                                        </h3>
                                        
                                        {/* Meta Info */}
                                        <div style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                                            gap: '1rem',
                                            marginBottom: '1.5rem'
                                        }}>
                                            <div style={{
                                                background: theme.colors.primaryBg,
                                                borderRadius: '10px',
                                                padding: '0.75rem 1rem'
                                            }}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '0.25rem' }}>Created</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '0.9rem' }}>
                                                    {new Date(Number(proposalData.proposal_creation_timestamp_seconds || 0) * 1000).toLocaleString()}
                                                </div>
                                            </div>
                                            
                                            {isProposalAcceptingVotes(proposalData) && (
                                                <div style={{
                                                    background: `${proposalPrimary}15`,
                                                    borderRadius: '10px',
                                                    padding: '0.75rem 1rem',
                                                    border: `1px solid ${proposalPrimary}30`
                                                }}>
                                                    <div style={{ color: proposalPrimary, fontSize: '0.8rem', marginBottom: '0.25rem' }}>⏱️ Voting Ends</div>
                                                    <div style={{ color: proposalPrimary, fontSize: '0.9rem', fontWeight: '500' }}>
                                                        {getVotingTimeRemaining(proposalData)}
                                                    </div>
                                                </div>
                                            )}
                                            
                                            <div style={{
                                                background: theme.colors.primaryBg,
                                                borderRadius: '10px',
                                                padding: '0.75rem 1rem'
                                            }}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '0.25rem' }}>Voting Period</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '0.9rem' }}>
                                                    {Math.floor(Number(proposalData.initial_voting_period_seconds || 0) / (24 * 60 * 60))} days
                                                </div>
                                            </div>
                                        </div>
                                        
                                        {/* Proposed By */}
                                        {proposalData.proposer?.[0]?.id && (
                                            <div style={{
                                                background: theme.colors.primaryBg,
                                                borderRadius: '12px',
                                                padding: '1rem 1.25rem',
                                                marginBottom: '1.5rem'
                                            }}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Proposed by</div>
                                                <div style={{ marginBottom: proposerPermissions?.length > 0 ? '0.75rem' : 0 }}>
                                                    {formatNeuronDisplayWithContext(
                                                        proposalData.proposer[0].id, 
                                                        selectedSnsRoot, 
                                                        getNeuronDisplayInfo(proposalData.proposer[0].id),
                                                        { 
                                                            onNicknameUpdate: handleNicknameUpdate,
                                                            isAuthenticated: isAuthenticated
                                                        }
                                                    )}
                                                </div>
                                                
                                                {/* Principals (show all) */}
                                                {proposerPermissions?.length > 0 && (
                                                    <div 
                                                        style={{
                                                            display: 'flex',
                                                            flexWrap: 'wrap',
                                                            gap: '0.4rem',
                                                            alignItems: 'center'
                                                        }}
                                                    >
                                                        {proposerPermissions.map((perm, idx) => {
                                                            const symbolInfo = getPrincipalSymbol(perm);
                                                            const principalStr = extractPrincipalString(perm.principal);
                                                            if (!principalStr) return null;
                                                            
                                                            return (
                                                                <div
                                                                    key={idx}
                                                                    style={{
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '0.25rem',
                                                                        padding: '0.25rem 0.5rem',
                                                                        background: `${symbolInfo.color}15`,
                                                                        borderRadius: '4px',
                                                                        border: `1px solid ${symbolInfo.color}25`
                                                                    }}
                                                                    title={symbolInfo.title}
                                                                >
                                                                    <span style={{ color: symbolInfo.color, display: 'flex', alignItems: 'center' }}>
                                                                        {symbolInfo.icon}
                                                                    </span>
                                                                    <PrincipalDisplay
                                                                        principal={Principal.fromText(principalStr)}
                                                                        displayInfo={getPrincipalDisplayInfoLocal(principalStr)}
                                                                        showCopyButton={false}
                                                                        short={true}
                                                                        isAuthenticated={isAuthenticated}
                                                                        style={{ fontSize: '0.75rem' }}
                                                                    />
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        
                                        {/* Summary */}
                                        <div style={{
                                            background: theme.colors.primaryBg,
                                            borderRadius: '12px',
                                            padding: '1.25rem',
                                            marginBottom: '1.5rem'
                                        }}>
                                            <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '0.75rem' }}>Summary</div>
                                            <div style={{
                                                color: theme.colors.primaryText,
                                                fontSize: '0.95rem',
                                                lineHeight: '1.6',
                                                wordBreak: 'break-word'
                                            }}>
                                                <ReactMarkdown
                                                    components={{
                                                        a: ({node, ...props}) => (
                                                            <a {...props} style={{
                                                                color: proposalPrimary,
                                                                wordBreak: 'break-all'
                                                            }} target="_blank" rel="noopener noreferrer" />
                                                        ),
                                                        p: ({node, ...props}) => (
                                                            <p {...props} style={{ margin: '0 0 0.75rem 0' }} />
                                                        )
                                                    }}
                                                >
                                                    {convertHtmlToMarkdown(proposalData.proposal?.[0]?.summary || 'No summary')}
                                                </ReactMarkdown>
                                            </div>
                                        </div>
                                        
                                        {/* External Links */}
                                        <div style={{
                                            display: 'flex',
                                            gap: '0.75rem',
                                            flexWrap: 'wrap',
                                            marginBottom: '1.5rem'
                                        }}>
                                            <a 
                                                href={`https://nns.ic0.app/proposal/?u=${selectedSnsRoot}&proposal=${currentProposalId}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem',
                                                    padding: '0.5rem 1rem',
                                                    background: `${proposalPrimary}15`,
                                                    border: `1px solid ${proposalPrimary}30`,
                                                    borderRadius: '8px',
                                                    color: proposalPrimary,
                                                    textDecoration: 'none',
                                                    fontSize: '0.85rem',
                                                    fontWeight: '500',
                                                    transition: 'all 0.2s ease'
                                                }}
                                            >
                                                <FaExternalLinkAlt size={12} />
                                                NNS
                                            </a>
                                            <a 
                                                href={`https://dashboard.internetcomputer.org/sns/${selectedSnsRoot}/proposal/${currentProposalId}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem',
                                                    padding: '0.5rem 1rem',
                                                    background: `${proposalPrimary}15`,
                                                    border: `1px solid ${proposalPrimary}30`,
                                                    borderRadius: '8px',
                                                    color: proposalPrimary,
                                                    textDecoration: 'none',
                                                    fontSize: '0.85rem',
                                                    fontWeight: '500'
                                                }}
                                            >
                                                <FaExternalLinkAlt size={12} />
                                                Dashboard
                                            </a>
                                            <a 
                                                href={`https://ic-toolkit.app/sns-management/${selectedSnsRoot}/proposals/view/${currentProposalId}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem',
                                                    padding: '0.5rem 1rem',
                                                    background: `${proposalPrimary}15`,
                                                    border: `1px solid ${proposalPrimary}30`,
                                                    borderRadius: '8px',
                                                    color: proposalPrimary,
                                                    textDecoration: 'none',
                                                    fontSize: '0.85rem',
                                                    fontWeight: '500'
                                                }}
                                            >
                                                <FaExternalLinkAlt size={12} />
                                                Toolkit
                                            </a>
                                            {proposalData.proposal?.[0]?.url && (
                                                <a 
                                                    href={proposalData.proposal[0].url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.5rem',
                                                        padding: '0.5rem 1rem',
                                                        background: `${proposalAccent}15`,
                                                        border: `1px solid ${proposalAccent}30`,
                                                        borderRadius: '8px',
                                                        color: proposalAccent,
                                                        textDecoration: 'none',
                                                        fontSize: '0.85rem',
                                                        fontWeight: '500'
                                                    }}
                                                >
                                                    <FaExternalLinkAlt size={12} />
                                                    Proposal URL
                                                </a>
                                            )}
                                        </div>
                                        
                                        {/* Payload */}
                                        {proposalData.payload_text_rendering?.[0] && (
                                            <div style={{ marginBottom: '1.5rem' }}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Payload</div>
                                                <div style={{
                                                    background: theme.colors.primaryBg,
                                                    borderRadius: '10px',
                                                    padding: '1rem',
                                                    border: `1px solid ${theme.colors.border}`,
                                                    fontFamily: 'monospace',
                                                    fontSize: '0.85rem',
                                                    color: theme.colors.primaryText,
                                                    whiteSpace: 'pre-wrap',
                                                    overflowWrap: 'break-word',
                                                    maxHeight: '300px',
                                                    overflowY: 'auto'
                                                }}>
                                                    {proposalData.payload_text_rendering[0]}
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Voting Bar */}
                                        {proposalData.latest_tally?.[0] && <VotingBar proposalData={proposalData} />}
                                        
                                        {/* Quick Vote Buttons */}
                                        {isAuthenticated && isProposalAcceptingVotes(proposalData) && (
                                            <div style={{
                                                marginTop: '1.5rem',
                                                padding: '1.25rem',
                                                background: theme.colors.primaryBg,
                                                borderRadius: '12px',
                                                border: `1px solid ${theme.colors.border}`
                                            }}>
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '1rem',
                                                    flexWrap: 'wrap'
                                                }}>
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.5rem',
                                                        color: theme.colors.primaryText,
                                                        fontWeight: '600',
                                                        fontSize: '0.9rem'
                                                    }}>
                                                        <FaVoteYea size={16} style={{ color: proposalPrimary }} />
                                                        Quick Vote:
                                                    </div>
                                                    
                                                    <button
                                                        onClick={() => quickVoteAll(1)}
                                                        disabled={eligibleNeuronsInfo.count === 0 || quickVoteState === 'voting'}
                                                        style={{
                                                            padding: '0.6rem 1.25rem',
                                                            borderRadius: '10px',
                                                            border: 'none',
                                                            cursor: eligibleNeuronsInfo.count > 0 && quickVoteState !== 'voting' ? 'pointer' : 'not-allowed',
                                                            fontWeight: '600',
                                                            fontSize: '0.9rem',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '0.5rem',
                                                            background: eligibleNeuronsInfo.count > 0 
                                                                ? `linear-gradient(135deg, ${theme.colors.success}, #27ae60)`
                                                                : theme.colors.mutedText,
                                                            color: 'white',
                                                            opacity: eligibleNeuronsInfo.count > 0 ? 1 : 0.5,
                                                            transition: 'all 0.2s ease'
                                                        }}
                                                    >
                                                        {quickVoteState === 'voting' ? '...' : <FaCheckCircle size={14} />}
                                                        Adopt
                                                        {eligibleNeuronsInfo.count > 0 && (
                                                            <span style={{ opacity: 0.8, fontWeight: '400' }}>
                                                                ({eligibleNeuronsInfo.count})
                                                            </span>
                                                        )}
                                                    </button>
                                                    
                                                    <button
                                                        onClick={() => quickVoteAll(2)}
                                                        disabled={eligibleNeuronsInfo.count === 0 || quickVoteState === 'voting'}
                                                        style={{
                                                            padding: '0.6rem 1.25rem',
                                                            borderRadius: '10px',
                                                            border: 'none',
                                                            cursor: eligibleNeuronsInfo.count > 0 && quickVoteState !== 'voting' ? 'pointer' : 'not-allowed',
                                                            fontWeight: '600',
                                                            fontSize: '0.9rem',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '0.5rem',
                                                            background: eligibleNeuronsInfo.count > 0 
                                                                ? `linear-gradient(135deg, ${theme.colors.error}, #c0392b)`
                                                                : theme.colors.mutedText,
                                                            color: 'white',
                                                            opacity: eligibleNeuronsInfo.count > 0 ? 1 : 0.5,
                                                            transition: 'all 0.2s ease'
                                                        }}
                                                    >
                                                        {quickVoteState === 'voting' ? '...' : <FaTimesCircle size={14} />}
                                                        Reject
                                                        {eligibleNeuronsInfo.count > 0 && (
                                                            <span style={{ opacity: 0.8, fontWeight: '400' }}>
                                                                ({eligibleNeuronsInfo.count})
                                                            </span>
                                                        )}
                                                    </button>
                                                    
                                                    {quickVoteState === 'success' && (
                                                        <span style={{ color: theme.colors.success, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <FaCheckCircle /> Vote submitted!
                                                        </span>
                                                    )}
                                                    {quickVoteState === 'error' && (
                                                        <span style={{ color: theme.colors.error, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <FaTimesCircle /> Voting failed
                                                        </span>
                                                    )}
                                                </div>
                                                
                                                {eligibleNeuronsInfo.count === 0 && (
                                                    <div style={{ 
                                                        marginTop: '0.75rem', 
                                                        fontSize: '0.8rem', 
                                                        color: theme.colors.mutedText 
                                                    }}>
                                                        No eligible neurons available. Either you've already voted or your neurons have no voting power.
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        
                                        {/* Voting History */}
                                        {votingHistory && votingHistory.length > 0 && (
                                            <div style={{ marginTop: '1.5rem' }}>
                                                <div 
                                                    onClick={() => setIsVotingHistoryExpanded(!isVotingHistoryExpanded)}
                                                    style={{
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        padding: '0.75rem 1rem',
                                                        background: theme.colors.primaryBg,
                                                        borderRadius: '10px',
                                                        border: `1px solid ${theme.colors.border}`
                                                    }}
                                                >
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.5rem',
                                                        color: theme.colors.primaryText,
                                                        fontWeight: '600'
                                                    }}>
                                                        <FaUsers size={16} style={{ color: proposalPrimary }} />
                                                        Voting History
                                                        <span style={{
                                                            background: `${proposalPrimary}20`,
                                                            color: proposalPrimary,
                                                            padding: '2px 8px',
                                                            borderRadius: '10px',
                                                            fontSize: '0.8rem'
                                                        }}>
                                                            {votingHistory.length}
                                                        </span>
                                                    </div>
                                                    {isVotingHistoryExpanded ? <FaChevronUp color={theme.colors.mutedText} /> : <FaChevronDown color={theme.colors.mutedText} />}
                                                </div>
                                                
                                                {isVotingHistoryExpanded && (
                                                    <div style={{
                                                        marginTop: '0.75rem',
                                                        background: theme.colors.primaryBg,
                                                        borderRadius: '12px',
                                                        padding: '1rem',
                                                        border: `1px solid ${theme.colors.border}`
                                                    }}>
                                                        {/* Filters */}
                                                        <div style={{
                                                            display: 'flex',
                                                            gap: '1rem',
                                                            marginBottom: '1rem',
                                                            padding: '0.75rem',
                                                            background: theme.colors.secondaryBg,
                                                            borderRadius: '8px',
                                                            flexWrap: 'wrap',
                                                            alignItems: 'center',
                                                            justifyContent: 'space-between'
                                                        }}>
                                                            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: theme.colors.success, cursor: 'pointer', fontSize: '0.85rem' }}>
                                                                    <input type="checkbox" checked={hideYes} onChange={(e) => setHideYes(e.target.checked)} />
                                                                    Hide Yes
                                                                </label>
                                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: theme.colors.error, cursor: 'pointer', fontSize: '0.85rem' }}>
                                                                    <input type="checkbox" checked={hideNo} onChange={(e) => setHideNo(e.target.checked)} />
                                                                    Hide No
                                                                </label>
                                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: theme.colors.mutedText, cursor: 'pointer', fontSize: '0.85rem' }}>
                                                                    <input type="checkbox" checked={hideNotVoted} onChange={(e) => setHideNotVoted(e.target.checked)} />
                                                                    Hide Pending
                                                                </label>
                                                            </div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <FaSort size={12} color={theme.colors.mutedText} />
                                                                <select
                                                                    value={sortBy}
                                                                    onChange={(e) => setSortBy(e.target.value)}
                                                                    style={{
                                                                        background: theme.colors.primaryBg,
                                                                        color: theme.colors.primaryText,
                                                                        border: `1px solid ${theme.colors.border}`,
                                                                        borderRadius: '6px',
                                                                        padding: '4px 8px',
                                                                        fontSize: '0.85rem',
                                                                        cursor: 'pointer'
                                                                    }}
                                                                >
                                                                    <option value="date">By Date</option>
                                                                    <option value="power">By VP</option>
                                                                </select>
                                                            </div>
                                                        </div>
                                                        
                                                        {/* Votes List */}
                                                        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                                                            {filterAndSortVotes(votingHistory).map(([neuronId, ballot], index) => (
                                                                <div 
                                                                    key={index}
                                                                    style={{
                                                                        padding: '0.75rem',
                                                                        background: theme.colors.secondaryBg,
                                                                        marginBottom: '0.5rem',
                                                                        borderRadius: '8px',
                                                                        border: `1px solid ${theme.colors.border}`
                                                                    }}
                                                                >
                                                                    <div style={{ 
                                                                        fontSize: '0.8rem',
                                                                        color: theme.colors.mutedText,
                                                                        marginBottom: '0.5rem',
                                                                        fontFamily: 'monospace',
                                                                        wordBreak: 'break-all'
                                                                    }}>
                                                                        {formatNeuronDisplayWithContext(
                                                                            neuronId, 
                                                                            selectedSnsRoot, 
                                                                            getNeuronDisplayInfo(neuronId),
                                                                            { 
                                                                                onNicknameUpdate: handleNicknameUpdate,
                                                                                isAuthenticated: isAuthenticated
                                                                            }
                                                                        )}
                                                                    </div>
                                                                    <div style={{ 
                                                                        display: 'flex',
                                                                        justifyContent: 'space-between',
                                                                        alignItems: 'center',
                                                                        fontSize: '0.85rem'
                                                                    }}>
                                                                        <span style={{ 
                                                                            color: ballot.vote === 1 ? theme.colors.success : ballot.vote === 2 ? theme.colors.error : theme.colors.mutedText,
                                                                            fontWeight: '600'
                                                                        }}>
                                                                            {formatVote(ballot.vote)}
                                                                        </span>
                                                                        {ballot.vote !== 0 && ballot.cast_timestamp_seconds && (
                                                                            <span style={{ color: theme.colors.mutedText }}>
                                                                                {new Date(Number(ballot.cast_timestamp_seconds) * 1000).toLocaleString()}
                                                                            </span>
                                                                        )}
                                                                        <span style={{ color: theme.colors.secondaryText }}>
                                                                            {formatE8s(ballot.voting_power)} VP
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Hotkey Neurons Section */}
                            {selectedSnsRoot && (
                                <div style={{ marginBottom: '1.5rem' }}>
                                    <HotkeyNeurons 
                                        fetchNeuronsFromSns={fetchNeuronsFromSns}
                                        showVotingStats={false}
                                        showExpandButton={true}
                                        defaultExpanded={false}
                                        title="Vote with Your Neurons"
                                        infoTooltip="These are your neurons that can be used to vote on this proposal."
                                        proposalData={proposalData}
                                        currentProposalId={currentProposalId}
                                        onVoteSuccess={() => {
                                            fetchProposalData();
                                            refreshNeurons(selectedSnsRoot);
                                        }}
                                    />
                                </div>
                            )}

                            {/* Discussion Section */}
                            <div style={{
                                background: theme.colors.secondaryBg,
                                borderRadius: '16px',
                                border: `1px solid ${theme.colors.border}`,
                                overflow: 'hidden'
                            }}>
                                <div 
                                    onClick={() => setIsDiscussionExpanded(!isDiscussionExpanded)}
                                    style={{
                                        padding: '1.25rem 1.5rem',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        background: `linear-gradient(135deg, ${proposalAccent}10 0%, transparent 100%)`,
                                        borderBottom: isDiscussionExpanded ? `1px solid ${theme.colors.border}` : 'none'
                                    }}
                                >
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '1rem'
                                    }}>
                                        <div style={{
                                            width: '40px',
                                            height: '40px',
                                            borderRadius: '10px',
                                            background: `${proposalAccent}20`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: proposalAccent
                                        }}>
                                            <FaComments size={18} />
                                        </div>
                                        <h2 style={{
                                            color: theme.colors.primaryText,
                                            fontSize: '1.1rem',
                                            fontWeight: '600',
                                            margin: 0
                                        }}>
                                            Discussion
                                        </h2>
                                    </div>
                                    
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                        {proposalThreadId && (
                                            <Link 
                                                to={`/thread?threadid=${proposalThreadId}&sns=${selectedSnsRoot}`}
                                                onClick={(e) => e.stopPropagation()}
                                                style={{
                                                    color: proposalAccent,
                                                    textDecoration: 'none',
                                                    fontSize: '0.85rem',
                                                    padding: '0.4rem 0.75rem',
                                                    borderRadius: '6px',
                                                    border: `1px solid ${proposalAccent}40`,
                                                    background: `${proposalAccent}10`,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px'
                                                }}
                                            >
                                                {threadLinkLoading ? 'Loading...' : 'View in Forum'}
                                                <FaExternalLinkAlt size={10} />
                                            </Link>
                                        )}
                                        {isDiscussionExpanded ? <FaChevronUp color={theme.colors.mutedText} /> : <FaChevronDown color={theme.colors.mutedText} />}
                                    </div>
                                </div>
                                
                                {isDiscussionExpanded && (
                                    <div style={{ padding: '1.5rem' }}>
                                        {loadingThread ? (
                                            <div style={{ 
                                                padding: '2rem', 
                                                textAlign: 'center', 
                                                color: theme.colors.mutedText 
                                            }}>
                                                Loading discussion...
                                            </div>
                                        ) : discussionThread ? (
                                            <ThreadViewer
                                                forumActor={forumActor}
                                                threadId={proposalThreadId.toString()}
                                                mode="thread"
                                                selectedSnsRoot={selectedSnsRoot}
                                                isAuthenticated={isAuthenticated}
                                                onError={setError}
                                                showCreatePost={true}
                                                title={`Discussion for Proposal #${currentProposalId}`}
                                                hideProposalLink={true}
                                            />
                                        ) : (
                                            <Discussion
                                                forumActor={forumActor}
                                                currentProposalId={currentProposalId}
                                                selectedSnsRoot={selectedSnsRoot}
                                                isAuthenticated={isAuthenticated}
                                                onError={setError}
                                                onThreadCreated={fetchDiscussionThread}
                                            />
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default Proposal;
