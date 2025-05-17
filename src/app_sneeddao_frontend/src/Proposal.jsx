import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { useAuth } from './AuthContext';
import Header from './components/Header';
import ReactMarkdown from 'react-markdown';
import './Wallet.css';
import { fetchAndCacheSnsData, getSnsById, getAllSnses, clearSnsCache } from './utils/SnsUtils';
import { formatNeuronIdLink } from './utils/NeuronUtils';

function Proposal() {
    const { isAuthenticated, identity } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const SNEED_SNS_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';
    const [proposalIdInput, setProposalIdInput] = useState(searchParams.get('proposalid') || '');
    const [currentProposalId, setCurrentProposalId] = useState(searchParams.get('proposalid') || '');
    const [selectedSnsRoot, setSelectedSnsRoot] = useState(searchParams.get('sns') || SNEED_SNS_ROOT);
    const [snsList, setSnsList] = useState([]);
    const [proposalData, setProposalData] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingSnses, setLoadingSnses] = useState(true);
    const [votingHistory, setVotingHistory] = useState(null);
    const [isVotingHistoryExpanded, setIsVotingHistoryExpanded] = useState(false);
    // Add filter states
    const [hideYes, setHideYes] = useState(false);
    const [hideNo, setHideNo] = useState(false);
    const [hideNotVoted, setHideNotVoted] = useState(false);
    // Add sort state
    const [sortBy, setSortBy] = useState('date');

    // Fetch SNS data on component mount
    useEffect(() => {
        async function loadSnsData() {
            console.log('Starting loadSnsData in Proposal component...'); // Debug log
            setLoadingSnses(true);
            try {
                console.log('Calling fetchAndCacheSnsData...'); // Debug log
                const data = await fetchAndCacheSnsData(identity);
                console.log('Received SNS data:', data); // Debug log
                setSnsList(data);
                
                // If no SNS is selected in the URL, set it to Sneed
                if (!searchParams.get('sns')) {
                    console.log('Setting default SNS to Sneed:', SNEED_SNS_ROOT); // Debug log
                    setSearchParams(prev => {
                        prev.set('sns', SNEED_SNS_ROOT);
                        return prev;
                    });
                }
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
        if (currentProposalId && selectedSnsRoot) {
            fetchProposalData();
        }
    }, [currentProposalId, selectedSnsRoot]);

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
        setProposalData(null); // Clear immediately
        setSelectedSnsRoot(newSnsRoot);
        
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

    // VotingBar component
    const VotingBar = ({ proposalData }) => {
        if (!proposalData?.latest_tally?.[0]) return null;
        
        const tally = proposalData.latest_tally[0];
        const { yesPercent, noPercent } = calculateVotingPercentages(tally);
        const isCritical = isCriticalProposal(proposalData);
        const standardMajorityThreshold = calculateStandardMajorityThreshold(tally);
        const standardMajorityPercent = (standardMajorityThreshold / Number(tally.total)) * 100;
        
        return (
            <div style={{ marginTop: '20px' }}>
                <h3>Voting Results</h3>
                <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ color: '#2ecc71' }}>
                        <span style={{ fontSize: '16px', fontWeight: 'bold' }}>Yes: {yesPercent.toFixed(3)}%</span>
                        <br />
                        <span style={{ fontSize: '14px', opacity: 0.9 }}>{formatE8s(tally.yes)} VP</span>
                    </div>
                    <div style={{ color: '#e74c3c', textAlign: 'right' }}>
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
                    color: '#bdc3c7'
                }}>
                    <span>Total Eligible: {formatE8s(tally.total)} VP</span>
                    <br />
                    <span>Last Updated: {new Date(Number(tally.timestamp_seconds || 0) * 1000).toLocaleString()}</span>
                </div>
                
                {/* Voting bar container */}
                <div style={{ 
                    position: 'relative',
                    height: '24px',
                    backgroundColor: '#34495e',
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
                        backgroundColor: '#2ecc71',
                        transition: 'width 0.3s ease'
                    }} />
                    
                    {/* No votes (red) */}
                    <div style={{
                        position: 'absolute',
                        right: 0,
                        height: '100%',
                        width: `${noPercent}%`,
                        backgroundColor: '#e74c3c',
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
                <div style={{ marginTop: '25px', fontSize: '14px', color: '#bdc3c7' }}>
                    <p>There are two ways {isCritical ? 'a critical' : 'a'} proposal can be decided:</p>
                    
                    <ol style={{ paddingLeft: '20px' }}>
                        <li style={{ marginBottom: '10px' }}>
                            <strong>Immediate {isCritical ? 'supermajority' : 'majority'} decision</strong> <span style={{ fontSize: '12px' }}>ℹ️</span>
                            <p style={{ margin: '5px 0', color: '#95a5a6' }}>
                                {isCritical ? 
                                    'A critical proposal is immediately adopted or rejected if, before the voting period ends, more than 67% of the total voting power votes Yes (indicated by the purple marker), or at least 33% votes No, respectively.' :
                                    'A proposal is immediately adopted or rejected if, before the voting period ends, more than half of the total voting power votes Yes (indicated by the yellow marker), or at least half votes No, respectively.'}
                            </p>
                        </li>
                        <li>
                            <strong>Standard {isCritical ? 'supermajority' : 'majority'} decision</strong> <span style={{ fontSize: '12px' }}>ℹ️</span>
                            <p style={{ margin: '5px 0', color: '#95a5a6' }}>
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
        <div className='page-container'>
            <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
            <main className="wallet-container">
                <h1 style={{ color: '#ffffff' }}>Proposal Details</h1>
                
                <section style={{ backgroundColor: '#2a2a2a', borderRadius: '8px', padding: '20px', marginTop: '20px' }}>
                    <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <input
                                type="text"
                                value={proposalIdInput}
                                onChange={(e) => setProposalIdInput(e.target.value)}
                                placeholder="Enter Proposal ID"
                                style={{
                                    backgroundColor: '#3a3a3a',
                                    border: '1px solid #4a4a4a',
                                    borderRadius: '4px',
                                    color: '#ffffff',
                                    padding: '8px 12px',
                                    width: '100%',
                                    fontSize: '14px'
                                }}
                            />
                            <button 
                                type="submit" 
                                style={{
                                    backgroundColor: '#3498db',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '8px 16px',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                Search
                            </button>
                        </div>
                    </form>
                    {error && <div style={{ color: '#e74c3c', marginTop: '10px' }}>{error}</div>}

                    {loading && (
                        <div style={{ color: '#ffffff', textAlign: 'center', padding: '20px' }}>
                            Loading...
                        </div>
                    )}

                    {proposalData && !loading && !error && (
                        <div style={{ color: '#ffffff' }}>
                            <h2>Proposal Information</h2>
                            <div style={{ backgroundColor: '#3a3a3a', padding: '15px', borderRadius: '6px', marginTop: '10px' }}>
                                <p><strong>SNS:</strong> {selectedSns?.name || 'Unknown SNS'}</p>
                                <p><strong>Topic:</strong> {getTopicName(proposalData)}</p>
                                <p><strong>Title:</strong> {proposalData.proposal?.[0]?.title || 'No title'}</p>
                                <p><strong>Proposer Neuron:</strong> {proposalData.proposer?.[0]?.id ? formatNeuronIdLink(proposalData.proposer[0].id, selectedSnsRoot) : 'Unknown'}</p>
                                <p><strong>External Links:</strong>{' '}
                                    <span style={{ display: 'inline-flex', gap: '10px', marginLeft: '10px' }}>
                                        <a 
                                            href={`https://nns.ic0.app/proposal/?u=${selectedSnsRoot}&proposal=${currentProposalId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{
                                                padding: '5px 10px',
                                                borderRadius: '4px',
                                                backgroundColor: '#2c3e50',
                                                color: '#ffffff',
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
                                                backgroundColor: '#2c3e50',
                                                color: '#ffffff',
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
                                                backgroundColor: '#2c3e50',
                                                color: '#ffffff',
                                                textDecoration: 'none',
                                                fontSize: '14px'
                                            }}
                                        >
                                            Toolkit
                                        </a>
                                    </span>
                                </p>
                                <p><strong>Summary:</strong> <div style={{ 
                                    backgroundColor: '#2a2a2a', 
                                    padding: '10px', 
                                    borderRadius: '4px',
                                    marginTop: '5px'
                                }}>
                                    <ReactMarkdown>
                                        {convertHtmlToMarkdown(proposalData.proposal?.[0]?.summary || 'No summary')}
                                    </ReactMarkdown>
                                </div></p>
                                <p><strong>URL:</strong> <a href={proposalData.proposal?.[0]?.url} target="_blank" rel="noopener noreferrer" style={{ color: '#3498db' }}>{proposalData.proposal?.[0]?.url}</a></p>
                                <p><strong>Status:</strong> {getProposalStatus(proposalData)}</p>
                                <p><strong>Created:</strong> {new Date(Number(proposalData.proposal_creation_timestamp_seconds || 0) * 1000).toLocaleString()}</p>
                                <p><strong>Voting Period:</strong> {Math.floor(Number(proposalData.initial_voting_period_seconds || 0) / (24 * 60 * 60))} days</p>
                                
                                {proposalData.latest_tally?.[0] && <VotingBar proposalData={proposalData} />}
                            </div>

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
                                            backgroundColor: '#3a3a3a',
                                            borderRadius: '6px',
                                            marginBottom: isVotingHistoryExpanded ? '10px' : '0'
                                        }}
                                    >
                                        <span style={{ 
                                            transform: isVotingHistoryExpanded ? 'rotate(90deg)' : 'none',
                                            transition: 'transform 0.3s ease',
                                            display: 'inline-block'
                                        }}>▶</span>
                                        <h3 style={{ margin: 0 }}>Voting History</h3>
                                    </div>
                                    
                                    {isVotingHistoryExpanded && (
                                        <div style={{ 
                                            backgroundColor: '#3a3a3a',
                                            padding: '15px',
                                            borderRadius: '6px'
                                        }}>
                                            <div style={{
                                                display: 'flex',
                                                gap: '20px',
                                                marginBottom: '15px',
                                                padding: '10px',
                                                backgroundColor: '#2a2a2a',
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
                                                        color: '#888',
                                                        fontSize: '14px'
                                                    }}>
                                                        Sort by:
                                                    </label>
                                                    <select
                                                        value={sortBy}
                                                        onChange={(e) => setSortBy(e.target.value)}
                                                        style={{
                                                            backgroundColor: '#3a3a3a',
                                                            color: '#fff',
                                                            border: '1px solid #4a4a4a',
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
                                                        backgroundColor: '#2a2a2a',
                                                        marginBottom: '10px',
                                                        borderRadius: '4px'
                                                    }}
                                                >
                                                    <div style={{ 
                                                        wordBreak: 'break-all',
                                                        color: '#888',
                                                        fontSize: '14px',
                                                        marginBottom: '4px',
                                                        fontFamily: 'monospace'
                                                    }}>
                                                        {formatNeuronIdLink(neuronId, selectedSnsRoot)}
                                                    </div>
                                                    <div style={{ 
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        alignItems: 'center',
                                                        color: '#888',
                                                        fontSize: '14px'
                                                    }}>
                                                        <div style={{ 
                                                            color: ballot.vote === 1 ? '#2ecc71' : ballot.vote === 2 ? '#e74c3c' : '#ffffff',
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
                </section>
            </main>
        </div>
    );
}

export default Proposal; 