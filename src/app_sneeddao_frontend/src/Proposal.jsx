import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { createActor as createSnsGovernanceActor, canisterId as snsGovernanceCanisterId } from 'external/sns_governance';
import { useAuth } from './AuthContext';
import Header from './components/Header';
import './Wallet.css';

function Proposal() {
    const { isAuthenticated, identity } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const [proposalIdInput, setProposalIdInput] = useState(searchParams.get('proposalid') || '');
    const [currentProposalId, setCurrentProposalId] = useState(searchParams.get('proposalid') || '');
    const [proposalData, setProposalData] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (currentProposalId) {
            fetchProposalData();
        }
    }, [currentProposalId]);

    const fetchProposalData = async () => {
        setLoading(true);
        setError('');
        try {
            const snsGovActor = createSnsGovernanceActor(snsGovernanceCanisterId, {
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

        // Validate that the input is a valid number
        if (!/^\d+$/.test(proposalIdInput)) {
            setError('Proposal ID must be a number');
            return;
        }

        // Update URL and trigger search
        setSearchParams({ proposalid: proposalIdInput });
        setCurrentProposalId(proposalIdInput);
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

    return (
        <div className='page-container'>
            <Header />
            <main className="wallet-container">
                <h1 style={{ color: '#ffffff' }}>Proposal Details</h1>
                
                <section style={{ backgroundColor: '#2a2a2a', borderRadius: '8px', padding: '20px', marginTop: '20px' }}>
                    <form onSubmit={handleSearch} style={{ display: 'flex', alignItems: 'center', marginBottom: '20px', gap: '10px' }}>
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
                                maxWidth: '500px',
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
                                fontSize: '14px'
                            }}
                        >
                            Search
                        </button>
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
                                <p><strong>Title:</strong> {proposalData.proposal?.[0]?.title || 'No title'}</p>
                                <p><strong>Summary:</strong> {proposalData.proposal?.[0]?.summary || 'No summary'}</p>
                                <p><strong>URL:</strong> <a href={proposalData.proposal?.[0]?.url} target="_blank" rel="noopener noreferrer" style={{ color: '#3498db' }}>{proposalData.proposal?.[0]?.url}</a></p>
                                <p><strong>Status:</strong> {getProposalStatus(proposalData)}</p>
                                <p><strong>Created:</strong> {new Date(Number(proposalData.proposal_creation_timestamp_seconds || 0) * 1000).toLocaleString()}</p>
                                <p><strong>Voting Period:</strong> {Math.floor(Number(proposalData.initial_voting_period_seconds || 0) / (24 * 60 * 60))} days</p>
                                
                                {proposalData.latest_tally?.[0] && (
                                    <div style={{ marginTop: '20px' }}>
                                        <h3>Latest Tally</h3>
                                        <p><strong>Yes Votes:</strong> {formatE8s(proposalData.latest_tally[0].yes)} SNS</p>
                                        <p><strong>No Votes:</strong> {formatE8s(proposalData.latest_tally[0].no)} SNS</p>
                                        <p><strong>Total Eligible:</strong> {formatE8s(proposalData.latest_tally[0].total)} SNS</p>
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