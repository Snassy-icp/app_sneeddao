import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
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
import { formatNeuronDisplayWithContext, uint8ArrayToHex } from './utils/NeuronUtils';
import { fetchUserNeuronsForSns } from './utils/NeuronUtils';
import { useNaming } from './NamingContext';
import { useTheme } from './contexts/ThemeContext';
import { Principal } from '@dfinity/principal';

function Proposal() {
    const { theme } = useTheme();
    const { isAuthenticated, identity } = useAuth();
    const { selectedSnsRoot, updateSelectedSns, SNEED_SNS_ROOT } = useSns();
    const { fetchNeuronsForSns, refreshNeurons } = useNeurons();
    const { createForumActor } = useForum();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const [proposalIdInput, setProposalIdInput] = useState(searchParams.get('proposalid') || '');
    const [currentProposalId, setCurrentProposalId] = useState(searchParams.get('proposalid') || '');
    const [proposalData, setProposalData] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    
    // Use optimized SNS loading
    const { 
        snsList, 
        currentSns, 
        loadingCurrent: loadingSnses, 
        error: snsError 
    } = useOptimizedSnsLoading();
    const [votingHistory, setVotingHistory] = useState(null);
    const [isVotingHistoryExpanded, setIsVotingHistoryExpanded] = useState(false);
    // Add filter states
    const [hideYes, setHideYes] = useState(false);
    const [hideNo, setHideNo] = useState(false);
    const [hideNotVoted, setHideNotVoted] = useState(false);
    // Add sort state
    const [sortBy, setSortBy] = useState('date');

    // Forum actor state
    const [forumActor, setForumActor] = useState(null);
    const [isProposalExpanded, setIsProposalExpanded] = useState(true);
    const [isDiscussionExpanded, setIsDiscussionExpanded] = useState(true);
    const [proposalThreadId, setProposalThreadId] = useState(null);
    const [threadLinkLoading, setThreadLinkLoading] = useState(false);
    const [discussionThread, setDiscussionThread] = useState(null);
    const [loadingThread, setLoadingThread] = useState(false);

    // Get naming context
    const { getNeuronDisplayName, neuronNames, neuronNicknames, verifiedNames } = useNaming();

    // Helper function to get neuron display info
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

    // Handle nickname updates
    const handleNicknameUpdate = (neuronId, snsRoot, newNickname) => {
        // The naming context will be updated by the dialog's success callback
        // which should trigger a re-render via the useNaming hook
        console.log('Nickname updated for neuron:', neuronId, 'in SNS:', snsRoot, 'new nickname:', newNickname);
    };

    // Initialize forum actor
    useEffect(() => {
        if (isAuthenticated && identity) {
            const actor = createForumActor(identity);
            setForumActor(actor);
        } else {
            // Create anonymous actor for unauthenticated users to allow read-only access
            const actor = createForumActor(null);
            setForumActor(actor);
        }
    }, [isAuthenticated, identity, createForumActor]);

    // Handle SNS loading errors
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

    // Fetch discussion thread when forum actor and proposal are ready
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

        // Validate that the input is a valid number
        if (!/^\d+$/.test(proposalIdInput)) {
            setError('Proposal ID must be a number');
            return;
        }

        // Update URL and trigger search
        setSearchParams({ proposalid: proposalIdInput, sns: selectedSnsRoot });
        setCurrentProposalId(proposalIdInput);
    };

    const handleSnsChange = async (newSnsRoot) => {
        // Update global context
        updateSelectedSns(newSnsRoot);
        
        setProposalData(null); // Clear immediately
        
        // Update URL params
        setSearchParams(prev => {
            prev.set('sns', newSnsRoot);
            if (currentProposalId) {
                prev.set('proposalid', currentProposalId);
            }
            return prev;
        });

        // Fetch with the new SNS root
        if (currentProposalId) {
            const selectedSns = getSnsById(newSnsRoot); // Use newSnsRoot directly instead of state
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

    // Fetch discussion thread for the proposal
    const fetchDiscussionThread = async () => {
        if (!forumActor || !currentProposalId || !selectedSnsRoot) return;
        
        setLoadingThread(true);
        try {
            // Check if a thread exists for this proposal
            const threadResult = await forumActor.get_proposal_thread(
                Principal.fromText(selectedSnsRoot), 
                Number(currentProposalId)
            );
            
            if (threadResult && threadResult.length > 0) {
                // Motoko optional returns as array
                const thread = threadResult[0];
                setDiscussionThread(thread);
                setProposalThreadId(Number(thread.thread_id));
                console.log('Found existing thread for proposal:', thread.thread_id);
            } else {
                // No thread exists yet
                setDiscussionThread(null);
                setProposalThreadId(null);
                console.log('No thread exists for this proposal yet');
            }
        } catch (err) {
            console.error('Error fetching discussion thread:', err);
            setDiscussionThread(null);
            setProposalThreadId(null);
        } finally {
            setLoadingThread(false);
        }
    };

    // Function to fetch neurons directly from SNS using global context
    const fetchNeuronsFromSns = async () => {
        if (!selectedSnsRoot) return [];
        return await fetchNeuronsForSns(selectedSnsRoot);
    };

    const getProposalStatus = (data) => {
        try {
            const now = BigInt(Math.floor(Date.now() / 1000));
            const executed = BigInt(data.executed_timestamp_seconds || 0);
            const failed = BigInt(data.failed_timestamp_seconds || 0);
            const decided = BigInt(data.decided_timestamp_seconds || 0);
            const created = BigInt(data.proposal_creation_timestamp_seconds || 0);
            const votingPeriod = BigInt(data.initial_voting_period_seconds || 0);
            
            if (executed > 0n) return 'Executed';
            if (failed > 0n) return 'Failed';
            if (decided > 0n) return 'Decided';
            if (created + votingPeriod > now) {
                return 'Open for Voting';
            }
            return 'Unknown';
        } catch (err) {
            console.error('Error in getProposalStatus:', err);
            return 'Unknown';
        }
    };

    // Helper function to calculate voting percentages
    const calculateVotingPercentages = (tally) => {
        if (!tally) return { yesPercent: 0, noPercent: 0 };
        const total = Number(tally.total);
        if (total === 0) return { yesPercent: 0, noPercent: 0 };
        
        const yesPercent = (Number(tally.yes) / total) * 100;
        const noPercent = (Number(tally.no) / total) * 100;
        return { yesPercent, noPercent };
    };

    // Function to fetch thread ID for the current proposal
    const fetchProposalThread = async () => {
        if (!forumActor || !currentProposalId || !selectedSnsRoot) return;
        
        try {
            setThreadLinkLoading(true);
            const response = await forumActor.get_proposal_thread(
                Principal.fromText(selectedSnsRoot), 
                Number(currentProposalId)
            );
            
            if (response && response.length > 0) {
                // Motoko optional returns as array
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

    // Helper function to check if proposal is critical
    const isCriticalProposal = (data) => {
        console.log('Checking if proposal is critical:', {
            exercisedProportion: data?.minimum_yes_proportion_of_exercised?.[0]?.basis_points?.[0],
            totalProportion: data?.minimum_yes_proportion_of_total?.[0]?.basis_points?.[0]
        });
        return data?.minimum_yes_proportion_of_exercised?.[0]?.basis_points?.[0] === 6700n;
    };

    // Helper function to get topic name
    const getTopicName = (data) => {
        if (!data?.topic?.[0]) return 'Unknown';
        // Get the first key of the topic object
        const topicKey = Object.keys(data.topic[0])[0];
        return topicKey || 'Unknown';
    };

    // Helper function to calculate standard majority threshold
    const calculateStandardMajorityThreshold = (tally) => {
        if (!tally) return 0;
        // 3% of total voting power
        return (Number(tally.total) * 0.03);
    };

    // Helper function to convert HTML breaks to Markdown
    const convertHtmlToMarkdown = (text) => {
        if (!text) return '';
        return text.replace(/<br>/g, '\n\n');
    };

    const selectedSns = getSnsById(selectedSnsRoot);

    // Theme-aware styles
    const getStyles = (theme) => ({
        pageContainer: {
            backgroundColor: theme.colors.primaryBg,
            minHeight: '100vh'
        },
        title: {
            color: theme.colors.primaryText
        },
        section: {
            backgroundColor: theme.colors.secondaryBg,
            borderRadius: '8px',
            padding: '20px',
            marginTop: '20px'
        },
        button: {
            backgroundColor: theme.colors.accent,
            color: theme.colors.primaryText,
            border: 'none',
            borderRadius: '4px'
        },
        secondaryButton: {
            backgroundColor: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            border: 'none',
            borderRadius: '4px'
        },
        input: {
            backgroundColor: theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '4px',
            color: theme.colors.primaryText,
            padding: '8px 12px'
        },
        error: {
            color: theme.colors.error,
            marginBottom: '20px'
        },
        loading: {
            color: theme.colors.primaryText,
            textAlign: 'center',
            padding: '20px'
        },
        content: {
            color: theme.colors.primaryText
        },
        expandToggle: {
            backgroundColor: theme.colors.border,
            borderRadius: '6px',
            padding: '10px'
        },
        expandedContent: {
            backgroundColor: theme.colors.border,
            padding: '15px',
            borderRadius: '6px',
            marginTop: '10px'
        },
        summaryBox: {
            backgroundColor: theme.colors.primaryBg,
            padding: '10px',
            borderRadius: '4px'
        },
        payloadBox: {
            backgroundColor: theme.colors.primaryBg,
            padding: '15px',
            borderRadius: '6px',
            marginTop: '8px',
            border: `1px solid ${theme.colors.border}`,
            fontFamily: 'monospace',
            fontSize: '0.9rem',
            lineHeight: '1.4',
            color: theme.colors.primaryText,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word'
        },
        link: {
            color: theme.colors.accent,
            wordBreak: 'break-all',
            overflowWrap: 'break-word'
        },
        mutedText: {
            color: theme.colors.mutedText
        },
        votingInfo: {
            marginTop: '25px',
            fontSize: '14px',
            color: theme.colors.mutedText
        },
        votingDetails: {
            margin: '5px 0',
            color: theme.colors.secondaryText
        }
    });

    // VotingBar component
    const VotingBar = ({ proposalData }) => {
        if (!proposalData?.latest_tally?.[0]) return null;
        
        const tally = proposalData.latest_tally[0];
        
        // Memoize expensive calculations to prevent them from running on every render
        const { yesPercent, noPercent } = useMemo(() => calculateVotingPercentages(tally), [tally]);
        const isCritical = useMemo(() => isCriticalProposal(proposalData), [proposalData]);
        const standardMajorityThreshold = useMemo(() => calculateStandardMajorityThreshold(tally), [tally]);
        const standardMajorityPercent = useMemo(() => (standardMajorityThreshold / Number(tally.total)) * 100, [standardMajorityThreshold, tally.total]);
        
        return (
            <div style={{ marginTop: '20px' }}>
                <h3>Voting Results</h3>
                <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ color: theme.colors.success }}>
                        <span style={{ fontSize: '16px', fontWeight: 'bold' }}>Yes: {yesPercent.toFixed(3)}%</span>
                        <br />
                        <span style={{ fontSize: '14px', opacity: 0.9 }}>{formatE8s(tally.yes)} VP</span>
                    </div>
                    <div style={{ color: theme.colors.error, textAlign: 'right' }}>
                        <span style={{ fontSize: '16px', fontWeight: 'bold' }}>No: {noPercent.toFixed(3)}%</span>
                        <br />
                        <span style={{ fontSize: '14px', opacity: 0.9 }}>{formatE8s(tally.no)} VP</span>
                    </div>
                </div>
                
                {/* Total eligible votes */}
                <div style={{ 
                    marginBottom: '15px',
                    textAlign: 'center',
                    fontSize: '14px',
                    color: theme.colors.mutedText
                }}>
                    <span>Total Eligible: {formatE8s(tally.total)} VP</span>
                    <br />
                    <span>Last Updated: {new Date(Number(tally.timestamp_seconds || 0) * 1000).toLocaleString()}</span>
                </div>
                
                {/* Voting bar container */}
                <div style={{ 
                    position: 'relative',
                    height: '24px',
                    backgroundColor: theme.colors.border,
                    borderRadius: '12px',
                    overflow: 'hidden',
                    marginBottom: '30px' // Space for the markers below
                }}>
                    {/* Yes votes (green) */}
                    <div style={{
                        position: 'absolute',
                        left: 0,
                        height: '100%',
                        width: `${yesPercent}%`,
                        backgroundColor: theme.colors.success,
                        transition: 'width 0.3s ease'
                    }} />
                    
                    {/* No votes (red) */}
                    <div style={{
                        position: 'absolute',
                        right: 0,
                        height: '100%',
                        width: `${noPercent}%`,
                        backgroundColor: theme.colors.error,
                        transition: 'width 0.3s ease'
                    }} />
                    
                    {/* Pass threshold marker */}
                    {isCritical ? (
                        <>
                            {/* 67% marker for critical proposals */}
                            <div style={{
                                position: 'absolute',
                                left: '67%',
                                height: '32px',
                                width: '2px',
                                backgroundColor: '#8247e5',
                                top: '-4px',
                                cursor: 'help'
                            }} 
                            title="Critical Proposal Pass Threshold (67%): If this many votes are cast as 'Yes', the proposal will pass immediately"
                            />
                            {/* 20% marker for critical proposals */}
                            <div style={{
                                position: 'absolute',
                                left: '20%',
                                height: '32px',
                                width: '2px',
                                backgroundColor: '#f39c12',
                                top: '-4px',
                                cursor: 'help'
                            }}
                            title="Critical Proposal Minimum Total Threshold (20%): At least this much of total voting power must participate"
                            />
                        </>
                    ) : (
                        <>
                            {/* 50% marker for regular proposals */}
                            <div style={{
                                position: 'absolute',
                                left: '50%',
                                height: '32px',
                                width: '2px',
                                backgroundColor: '#8247e5',
                                top: '-4px',
                                cursor: 'help'
                            }}
                            title="Regular Proposal Threshold (50%): If more than half of the votes are 'Yes', the proposal will pass at the end of the voting period"
                            />
                            {/* Standard majority threshold marker (3% of total voting power) */}
                            <div style={{
                                position: 'absolute',
                                left: `${standardMajorityPercent}%`,
                                height: '32px',
                                width: '2px',
                                backgroundColor: '#f39c12',
                                top: '-4px',
                                cursor: 'help'
                            }}
                            title="Minimum Participation Threshold (3%): At least this much voting power must participate for the proposal to be valid"
                            />
                        </>
                    )}
                    
                    {/* Current position marker */}
                    <div style={{
                        position: 'absolute',
                        left: `${yesPercent}%`,
                        height: '32px',
                        width: '2px',
                        backgroundColor: '#3498db',
                        top: '-4px',
                        cursor: 'help'
                    }}
                    title={`Current Position (${yesPercent.toFixed(2)}%): Current percentage of 'Yes' votes`}
                    />
                </div>
                
                {/* Voting information */}
                <div style={{ marginTop: '25px', fontSize: '14px', color: theme.colors.mutedText }}>
                    <p>There are two ways {isCritical ? 'a critical' : 'a'} proposal can be decided:</p>
                    
                    <ol style={{ paddingLeft: '20px' }}>
                        <li style={{ marginBottom: '10px' }}>
                            <strong>Immediate {isCritical ? 'supermajority' : 'majority'} decision</strong> <span style={{ fontSize: '12px' }}>ℹ️</span>
                            <p style={{ margin: '5px 0', color: theme.colors.secondaryText }}>
                                {isCritical ? 
                                    'A critical proposal is immediately adopted or rejected if, before the voting period ends, more than 67% of the total voting power votes Yes (indicated by the purple marker), or at least 33% votes No, respectively.' :
                                    'A proposal is immediately adopted or rejected if, before the voting period ends, more than half of the total voting power votes Yes (indicated by the yellow marker), or at least half votes No, respectively.'}
                            </p>
                        </li>
                        <li>
                            <strong>Standard {isCritical ? 'supermajority' : 'majority'} decision</strong> <span style={{ fontSize: '12px' }}>ℹ️</span>
                            <p style={{ margin: '5px 0', color: theme.colors.secondaryText }}>
                                {isCritical ?
                                    'At the end of the voting period, a critical proposal is adopted if more than 67% of the votes cast are Yes votes, provided these votes represent at least 3% of the total voting power. Otherwise, it is rejected. Before a proposal is decided, the voting period can be extended in order to "wait for quiet". Such voting period extensions occur when a proposal\'s voting results turn from either a Yes majority to a No majority or vice versa.' :
                                    'At the end of the voting period, a proposal is adopted if more than half of the votes cast are Yes votes, provided these votes represent at least 3% of the total voting power (indicated by the orange marker). Otherwise, it is rejected. Before a proposal is decided, the voting period can be extended in order to "wait for quiet". Such voting period extensions occur when a proposal\'s voting results turn from either a Yes majority to a No majority or vice versa.'}
                            </p>
                        </li>
                    </ol>
                </div>
            </div>
        );
    };

    // Add helper function to format vote
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

    // Add helper function to format neuron ID
    const formatNeuronId = (neuronId) => {
        if (!neuronId) return 'Unknown';
        return Array.from(neuronId).map(b => b.toString(16).padStart(2, '0')).join('');
    };

    // Modify the fetch voting history to be a fallback for Sneed
    const fetchRllVotingHistory = async (proposalId) => {
        try {
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            const ballots = await rllActor.get_proposal_ballots(BigInt(proposalId));
            setVotingHistory(ballots);
        } catch (err) {
            console.error('Error fetching RLL voting history:', err);
            setVotingHistory([]); // Set empty array on error
        }
    };

    // Effect to handle fallback to RLL for Sneed when no ballots found
    useEffect(() => {
        if (proposalData && selectedSnsRoot === SNEED_SNS_ROOT && (!proposalData.ballots || proposalData.ballots.length === 0)) {
            fetchRllVotingHistory(currentProposalId);
        } else if (proposalData && proposalData.ballots) {
            setVotingHistory(proposalData.ballots);
        }
    }, [proposalData, selectedSnsRoot, currentProposalId]);

    // Effect to fetch proposal thread when forum actor and proposal data are available
    useEffect(() => {
        if (forumActor && currentProposalId && selectedSnsRoot) {
            fetchProposalThread();
        }
    }, [forumActor, currentProposalId, selectedSnsRoot]);

    // Add helper function to filter and sort votes
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
        <div className='page-container' style={getStyles(theme).pageContainer}>
            <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
            <main className="wallet-container">
                <h1 style={getStyles(theme).title}>Proposal Details</h1>
                
                <section style={getStyles(theme).section}>
                    <div style={{ 
                        display: 'grid',
                        gridTemplateColumns: '1fr minmax(auto, 500px) 1fr',
                        gap: '20px',
                        alignItems: 'center',
                        marginBottom: '20px'
                    }}>
                        <div style={{ justifySelf: 'start' }}>
                            <button 
                                onClick={() => {
                                    const prevId = Number(currentProposalId) - 1;
                                    if (prevId >= 1) {
                                        setProposalIdInput(prevId.toString());
                                        setSearchParams({ proposalid: prevId.toString(), sns: selectedSnsRoot });
                                        setCurrentProposalId(prevId.toString());
                                    }
                                }}
                                style={{
                                    ...getStyles(theme).button,
                                    padding: '8px 16px',
                                    cursor: Number(currentProposalId) > 1 ? 'pointer' : 'not-allowed',
                                    opacity: Number(currentProposalId) > 1 ? 1 : 0.5,
                                    fontSize: '14px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}
                                disabled={Number(currentProposalId) <= 1}
                            >
                                <span style={{ fontSize: '18px' }}>←</span>
                                Previous
                            </button>
                        </div>

                        <form onSubmit={handleSearch} style={{ 
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            width: '100%'
                        }}>
                            <div style={{ 
                                flex: 1,
                                position: 'relative',
                                display: 'flex',
                                alignItems: 'center'
                            }}>
                                <span style={{
                                    position: 'absolute',
                                    left: '12px',
                                    color: theme.colors.mutedText,
                                    fontSize: '14px'
                                }}>#</span>
                                <input
                                    type="text"
                                    value={proposalIdInput}
                                    onChange={(e) => setProposalIdInput(e.target.value)}
                                    placeholder="Proposal ID"
                                    style={{
                                        ...getStyles(theme).input,
                                        padding: '8px 12px 8px 26px',
                                        width: '100%',
                                        fontSize: '14px'
                                    }}
                                />
                            </div>
                            <button 
                                type="submit" 
                                style={{
                                    ...getStyles(theme).button,
                                    padding: '8px 16px',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    whiteSpace: 'nowrap',
                                    minWidth: '80px'
                                }}
                            >
                                Search
                            </button>
                        </form>

                        <div style={{ justifySelf: 'end' }}>
                                                        <button
                                onClick={() => {
                                    const nextId = Number(currentProposalId) + 1;
                                    setProposalIdInput(nextId.toString());
                                    setSearchParams({ proposalid: nextId.toString(), sns: selectedSnsRoot });
                                    setCurrentProposalId(nextId.toString());
                                }}
                                style={{
                                    ...getStyles(theme).button,
                                    padding: '8px 16px',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}
                            >
                                Next
                                <span style={{ fontSize: '18px' }}>→</span>
                            </button>
                        </div>
                    </div>

                    {error && <div style={getStyles(theme).error}>{error}</div>}

                    {loading && (
                        <div style={getStyles(theme).loading}>
                            Loading...
                        </div>
                    )}

                    {proposalData && !loading && !error && (
                        <div style={getStyles(theme).content}>
                            <div 
                                onClick={() => setIsProposalExpanded(!isProposalExpanded)}
                                style={{
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    ...getStyles(theme).expandToggle,
                                    marginBottom: isProposalExpanded ? '10px' : '0'
                                }}
                            >
                                <span style={{ 
                                    transform: isProposalExpanded ? 'rotate(90deg)' : 'none',
                                    transition: 'transform 0.3s ease',
                                    display: 'inline-block'
                                }}>▶</span>
                                <h2 style={{ margin: 0 }}>Proposal Information</h2>
                            </div>
                            
                            {isProposalExpanded && (
                                <div style={getStyles(theme).expandedContent}>
                                    <p><strong>SNS:</strong> {selectedSns?.name || 'Unknown SNS'}</p>
                                    <p><strong>Topic:</strong> {getTopicName(proposalData)}</p>
                                    <p><strong>Title:</strong> {proposalData.proposal?.[0]?.title || 'No title'}</p>
                                    <p style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <strong>Proposer Neuron:</strong> 
                                        {proposalData.proposer?.[0]?.id ? 
                                            formatNeuronDisplayWithContext(
                                                proposalData.proposer[0].id, 
                                                selectedSnsRoot, 
                                                getNeuronDisplayInfo(proposalData.proposer[0].id),
                                                { onNicknameUpdate: handleNicknameUpdate }
                                            ) : 
                                            <span>Unknown</span>
                                        }
                                    </p>
                                    <p><strong>External Links:</strong>{' '}
                                        <span style={{ display: 'inline-flex', gap: '10px', marginLeft: '10px' }}>
                                            <a 
                                                href={`https://nns.ic0.app/proposal/?u=${selectedSnsRoot}&proposal=${currentProposalId}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{
                                                    padding: '5px 10px',
                                                    borderRadius: '4px',
                                                    backgroundColor: theme.colors.accent,
                                                    color: theme.colors.primaryText,
                                                    textDecoration: 'none',
                                                    fontSize: '14px'
                                                }}
                                            >
                                                NNS
                                            </a>
                                            <a 
                                                href={`https://dashboard.internetcomputer.org/sns/${selectedSnsRoot}/proposal/${currentProposalId}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{
                                                    padding: '5px 10px',
                                                    borderRadius: '4px',
                                                    backgroundColor: theme.colors.accent,
                                                    color: theme.colors.primaryText,
                                                    textDecoration: 'none',
                                                    fontSize: '14px'
                                                }}
                                            >
                                                Dashboard
                                            </a>
                                            <a 
                                                href={`https://ic-toolkit.app/sns-management/${selectedSnsRoot}/proposals/view/${currentProposalId}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{
                                                    padding: '5px 10px',
                                                    borderRadius: '4px',
                                                    backgroundColor: theme.colors.accent,
                                                    color: theme.colors.primaryText,
                                                    textDecoration: 'none',
                                                    fontSize: '14px'
                                                }}
                                            >
                                                Toolkit
                                            </a>
                                        </span>
                                    </p>
                                    <p><strong>Summary:</strong> <div style={{ 
                                        ...getStyles(theme).summaryBox,
                                        marginTop: '5px',
                                        wordBreak: 'break-word',
                                        overflowWrap: 'anywhere',
                                        overflow: 'hidden',
                                        width: '100%',
                                        boxSizing: 'border-box'
                                    }}>
                                        <ReactMarkdown
                                            components={{
                                                // Custom styling for links to handle long URLs
                                                a: ({node, ...props}) => (
                                                    <a {...props} style={{
                                                        color: theme.colors.linkText,
                                                        wordBreak: 'break-all',
                                                        overflowWrap: 'break-word',
                                                        textDecoration: 'underline'
                                                    }} />
                                                ),
                                                // Custom styling for paragraphs
                                                p: ({node, ...props}) => (
                                                    <p {...props} style={{
                                                        wordBreak: 'break-word',
                                                        overflowWrap: 'anywhere',
                                                        margin: '0 0 10px 0'
                                                    }} />
                                                )
                                            }}
                                        >
                                            {convertHtmlToMarkdown(proposalData.proposal?.[0]?.summary || 'No summary')}
                                        </ReactMarkdown>
                                    </div></p>
                                    <p><strong>URL:</strong> <a href={proposalData.proposal?.[0]?.url} target="_blank" rel="noopener noreferrer" style={{ 
                                        color: theme.colors.linkText,
                                        wordBreak: 'break-all',
                                        overflowWrap: 'break-word',
                                        display: 'inline-block',
                                        maxWidth: '100%'
                                    }}>{proposalData.proposal?.[0]?.url}</a></p>
                                    
                                    {proposalData.payload_text_rendering?.[0] && (
                                        <div style={{ marginTop: '15px' }}>
                                            <p><strong>Proposal Payload:</strong></p>
                                            <div style={{ 
                                                ...getStyles(theme).payloadBox,
                                                whiteSpace: 'pre-wrap',
                                                overflowWrap: 'break-word',
                                                maxHeight: '400px',
                                                overflowY: 'auto'
                                            }}>
                                                {proposalData.payload_text_rendering[0]}
                                            </div>
                                        </div>
                                    )}
                                    
                                    <p><strong>Status:</strong> {getProposalStatus(proposalData)}</p>
                                    <p><strong>Created:</strong> {new Date(Number(proposalData.proposal_creation_timestamp_seconds || 0) * 1000).toLocaleString()}</p>
                                    <p><strong>Voting Period:</strong> {Math.floor(Number(proposalData.initial_voting_period_seconds || 0) / (24 * 60 * 60))} days</p>
                                    
                                    {/* Additional proposal metadata */}
                                    {proposalData.decided_timestamp_seconds && Number(proposalData.decided_timestamp_seconds) > 0 && (
                                        <p><strong>Decided:</strong> {new Date(Number(proposalData.decided_timestamp_seconds) * 1000).toLocaleString()}</p>
                                    )}
                                    
                                    {proposalData.executed_timestamp_seconds && Number(proposalData.executed_timestamp_seconds) > 0 && (
                                        <p><strong>Executed:</strong> {new Date(Number(proposalData.executed_timestamp_seconds) * 1000).toLocaleString()}</p>
                                    )}
                                    
                                    {proposalData.failed_timestamp_seconds && Number(proposalData.failed_timestamp_seconds) > 0 && (
                                        <p><strong>Failed:</strong> {new Date(Number(proposalData.failed_timestamp_seconds) * 1000).toLocaleString()}</p>
                                    )}
                                    
                                    {proposalData.reject_cost_e8s && Number(proposalData.reject_cost_e8s) > 0 && (
                                        <p><strong>Reject Cost:</strong> {formatE8s(proposalData.reject_cost_e8s)} tokens</p>
                                    )}
                                    
                                    {proposalData.is_eligible_for_rewards !== undefined && (
                                        <p><strong>Eligible for Rewards:</strong> {proposalData.is_eligible_for_rewards ? 'Yes' : 'No'}</p>
                                    )}
                                    
                                    {proposalData.latest_tally?.[0] && <VotingBar proposalData={proposalData} />}
                                    
                                    {/* Modified voting history section to show for any SNS with ballots */}
                                    {votingHistory && votingHistory.length > 0 && (
                                        <div style={{ marginTop: '20px' }}>
                                            <div 
                                                onClick={() => setIsVotingHistoryExpanded(!isVotingHistoryExpanded)}
                                                style={{
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    padding: '10px',
                                                    backgroundColor: theme.colors.tertiaryBg,
                                                    borderRadius: '6px',
                                                    marginBottom: isVotingHistoryExpanded ? '10px' : '0'
                                                }}
                                            >
                                                <span style={{ 
                                                    transform: isVotingHistoryExpanded ? 'rotate(90deg)' : 'none',
                                                    transition: 'transform 0.3s ease',
                                                    display: 'inline-block',
                                                    color: theme.colors.primaryText
                                                }}>▶</span>
                                                <h3 style={{ margin: 0, color: theme.colors.primaryText }}>Voting History</h3>
                                            </div>
                                            
                                            {isVotingHistoryExpanded && (
                                                <div style={{ 
                                                    backgroundColor: theme.colors.tertiaryBg,
                                                    padding: '15px',
                                                    borderRadius: '6px'
                                                }}>
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
                                                                color: '#e74c3c',
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
                                                                color: '#888',
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
                                                                    backgroundColor: theme.colors.primaryBg,
                                                                    color: theme.colors.primaryText,
                                                                    border: `1px solid ${theme.colors.border}`,
                                                                    borderRadius: '4px',
                                                                    padding: '4px 8px',
                                                                    cursor: 'pointer'
                                                                }}
                                                            >
                                                                <option value="date">Voting Date</option>
                                                                <option value="power">Voting Power</option>
                                                            </select>
                                                        </div>
                                                    </div>
                                                    {filterAndSortVotes(votingHistory).map(([neuronId, ballot], index) => (
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
                                                                wordBreak: 'break-all',
                                                                color: theme.colors.mutedText,
                                                                fontSize: '14px',
                                                                marginBottom: '4px',
                                                                fontFamily: 'monospace'
                                                            }}>
                                                                {formatNeuronDisplayWithContext(
                                                                    neuronId, 
                                                                    selectedSnsRoot, 
                                                                    getNeuronDisplayInfo(neuronId),
                                                                    { onNicknameUpdate: handleNicknameUpdate }
                                                                )}
                                                            </div>
                                                            <div style={{ 
                                                                display: 'flex',
                                                                justifyContent: 'space-between',
                                                                alignItems: 'center',
                                                                color: theme.colors.mutedText,
                                                                fontSize: '14px'
                                                            }}>
                                                                <div style={{ 
                                                                    color: ballot.vote === 1 ? theme.colors.success : ballot.vote === 2 ? theme.colors.error : theme.colors.primaryText,
                                                                    fontWeight: 'bold'
                                                                }}>
                                                                    {formatVote(ballot.vote)}
                                                                </div>
                                                                {ballot.vote !== 0 && (
                                                                    <div>
                                                                        {new Date(Number(ballot.cast_timestamp_seconds) * 1000).toLocaleString()}
                                                                    </div>
                                                                )}
                                                                <div>
                                                                    {formatE8s(ballot.voting_power)} VP
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
                        </div>
                    )}

                    {/* Hotkey Neurons Section */}
                    {selectedSnsRoot && (
                        <div style={{ marginTop: '20px' }}>
                            <HotkeyNeurons 
                                fetchNeuronsFromSns={fetchNeuronsFromSns}
                                showVotingStats={false}
                                showExpandButton={true}
                                defaultExpanded={false}
                                title="Vote with Your Neurons"
                                infoTooltip="These are your neurons that can be used to vote on this proposal. You need hotkey access to vote."
                                proposalData={proposalData}
                                currentProposalId={currentProposalId}
                                onVoteSuccess={() => {
                                    // Refresh proposal data after successful vote
                                    fetchProposalData();
                                    // Refresh neurons data to update voting power
                                    refreshNeurons(selectedSnsRoot);
                                }}
                            />
                        </div>
                    )}


                    {/* Discussion Section */}
                    {proposalData && !loading && !error && (
                        <div style={{ marginTop: '20px' }}>
                            <div 
                                onClick={() => setIsDiscussionExpanded(!isDiscussionExpanded)}
                                style={{
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '10px',
                                    padding: '10px',
                                    backgroundColor: theme.colors.tertiaryBg,
                                    borderRadius: '6px',
                                    marginBottom: isDiscussionExpanded ? '10px' : '0'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span style={{ 
                                        transform: isDiscussionExpanded ? 'rotate(90deg)' : 'none',
                                        transition: 'transform 0.3s ease',
                                        display: 'inline-block'
                                    }}>▶</span>
                                    <h2 style={{ margin: 0, color: theme.colors.primaryText }}>Discussion</h2>
                                </div>
                                
                                {/* Thread link - only show if thread exists */}
                                {proposalThreadId && (
                                    <Link 
                                        to={`/thread?threadid=${proposalThreadId}&sns=${selectedSnsRoot}`}
                                        onClick={(e) => e.stopPropagation()} // Prevent header click
                                        style={{
                                            color: theme.colors.linkText,
                                            textDecoration: 'none',
                                            fontSize: '0.9rem',
                                            padding: '4px 8px',
                                            borderRadius: '4px',
                                            border: `1px solid ${theme.colors.border}`,
                                            transition: 'all 0.2s ease'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.target.style.backgroundColor = theme.colors.accentHover;
                                            e.target.style.borderColor = theme.colors.borderHover;
                                        }}
                                        onMouseLeave={(e) => {
                                            e.target.style.backgroundColor = 'transparent';
                                            e.target.style.borderColor = theme.colors.border;
                                        }}
                                    >
                                        {threadLinkLoading ? 'Loading...' : 'View in Forum →'}
                                    </Link>
                                )}
                            </div>
                            
                            {isDiscussionExpanded && (
                                <>
                                    {loadingThread ? (
                                        <div style={{ 
                                            padding: '20px', 
                                            textAlign: 'center', 
                                            color: theme.colors.mutedText 
                                        }}>
                                            Loading discussion...
                                        </div>
                                    ) : discussionThread ? (
                                        /* Thread exists - use ThreadViewer */
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
                                        /* No thread exists - show create thread UI */
                                        <Discussion
                                            forumActor={forumActor}
                                            currentProposalId={currentProposalId}
                                            selectedSnsRoot={selectedSnsRoot}
                                            isAuthenticated={isAuthenticated}
                                            onError={setError}
                                            onThreadCreated={fetchDiscussionThread}
                                        />
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}

export default Proposal; 