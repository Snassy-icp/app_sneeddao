import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { useAuth } from './AuthContext';
import Header from './components/Header';
import ReactMarkdown from 'react-markdown';
import './Wallet.css';
import { fetchAndCacheSnsData, getSnsById, getAllSnses, clearSnsCache } from './utils/SnsUtils';

function Proposal() {
    const { isAuthenticated, identity } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const [proposalIdInput, setProposalIdInput] = useState(searchParams.get('proposalid') || '');
    const [currentProposalId, setCurrentProposalId] = useState(searchParams.get('proposalid') || '');
    const [selectedSnsRoot, setSelectedSnsRoot] = useState(searchParams.get('sns') || '');
    const [snsList, setSnsList] = useState([]);
    const [proposalData, setProposalData] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingSnses, setLoadingSnses] = useState(true);

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
                
                // If no SNS is selected but we have SNSes, select the first one
                if (!selectedSnsRoot && data.length > 0) {
                    console.log('Setting default SNS:', data[0]); // Debug log
                    setSelectedSnsRoot(data[0].rootCanisterId);
                    setSearchParams(prev => {
                        prev.set('sns', data[0].rootCanisterId);
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

    const handleSnsChange = (e) => {
        const newSnsRoot = e.target.value;
        setSelectedSnsRoot(newSnsRoot);
        setSearchParams(prev => {
            prev.set('sns', newSnsRoot);
            if (currentProposalId) {
                prev.set('proposalid', currentProposalId);
            }
            return prev;
        });
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

    const selectedSns = getSnsById(selectedSnsRoot);

    return (
        <div className='page-container'>
            <Header />
            <main className="wallet-container">
                <h1 style={{ color: '#ffffff' }}>Proposal Details</h1>
                
                <section style={{ backgroundColor: '#2a2a2a', borderRadius: '8px', padding: '20px', marginTop: '20px' }}>
                    <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <select
                                value={selectedSnsRoot}
                                onChange={handleSnsChange}
                                style={{
                                    backgroundColor: '#3a3a3a',
                                    border: '1px solid #4a4a4a',
                                    borderRadius: '4px',
                                    color: '#ffffff',
                                    padding: '8px 12px',
                                    fontSize: '14px',
                                    flex: '1'
                                }}
                                disabled={loadingSnses}
                            >
                                {loadingSnses ? (
                                    <option>Loading SNSes...</option>
                                ) : (
                                    <>
                                        <option value="">Select an SNS</option>
                                        {snsList.map(sns => (
                                            <option key={sns.rootCanisterId} value={sns.rootCanisterId}>
                                                {sns.name}
                                            </option>
                                        ))}
                                    </>
                                )}
                            </select>
                            <button
                                onClick={async () => {
                                    setLoadingSnses(true);
                                    clearSnsCache();
                                    await loadSnsData();
                                }}
                                style={{
                                    backgroundColor: '#3498db',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '8px 12px',
                                    cursor: 'pointer',
                                    fontSize: '14px'
                                }}
                                disabled={loadingSnses}
                            >
                                🔄 Refresh SNS List
                            </button>
                        </div>
                        
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

                    {proposalData && !loading && (
                        <div style={{ color: '#ffffff' }}>
                            <h2>Proposal Information</h2>
                            <div style={{ backgroundColor: '#3a3a3a', padding: '15px', borderRadius: '6px', marginTop: '10px' }}>
                                <p><strong>SNS:</strong> {selectedSns?.name || 'Unknown SNS'}</p>
                                <p><strong>Title:</strong> {proposalData.proposal?.[0]?.title || 'No title'}</p>
                                <p><strong>Summary:</strong> <div style={{ 
                                    backgroundColor: '#2a2a2a', 
                                    padding: '10px', 
                                    borderRadius: '4px',
                                    marginTop: '5px'
                                }}>
                                    <ReactMarkdown>{proposalData.proposal?.[0]?.summary || 'No summary'}</ReactMarkdown>
                                </div></p>
                                <p><strong>URL:</strong> <a href={proposalData.proposal?.[0]?.url} target="_blank" rel="noopener noreferrer" style={{ color: '#3498db' }}>{proposalData.proposal?.[0]?.url}</a></p>
                                <p><strong>Status:</strong> {getProposalStatus(proposalData)}</p>
                                <p><strong>Created:</strong> {new Date(Number(proposalData.proposal_creation_timestamp_seconds || 0) * 1000).toLocaleString()}</p>
                                <p><strong>Voting Period:</strong> {Math.floor(Number(proposalData.initial_voting_period_seconds || 0) / (24 * 60 * 60))} days</p>
                                
                                {proposalData.latest_tally?.[0] && (
                                    <div style={{ marginTop: '20px' }}>
                                        <h3>Latest Tally</h3>
                                        <p><strong>Yes Votes:</strong> {formatE8s(proposalData.latest_tally[0].yes)} {selectedSns?.name || 'SNS'}</p>
                                        <p><strong>No Votes:</strong> {formatE8s(proposalData.latest_tally[0].no)} {selectedSns?.name || 'SNS'}</p>
                                        <p><strong>Total Eligible:</strong> {formatE8s(proposalData.latest_tally[0].total)} {selectedSns?.name || 'SNS'}</p>
                                        <p><strong>Last Updated:</strong> {new Date(Number(proposalData.latest_tally[0].timestamp_seconds || 0) * 1000).toLocaleString()}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}

export default Proposal; 