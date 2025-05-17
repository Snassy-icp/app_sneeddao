import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { useAuth } from '../AuthContext';
import Header from '../components/Header';
import ReactMarkdown from 'react-markdown';
import { fetchAndCacheSnsData, getSnsById } from '../utils/SnsUtils';
import { formatProposalIdLink } from '../utils/NeuronUtils';

function Proposals() {
    const { isAuthenticated, identity } = useAuth();
    const navigate = useNavigate();
    const [selectedSnsRoot, setSelectedSnsRoot] = useState('fp274-iaaaa-aaaaq-aacha-cai'); // Default to Sneed
    const [snsList, setSnsList] = useState([]);
    const [proposals, setProposals] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingSnses, setLoadingSnses] = useState(true);
    
    // Pagination state
    const [itemsPerPage, setItemsPerPage] = useState(20);
    const [currentPage, setCurrentPage] = useState(1);
    const [hasMoreProposals, setHasMoreProposals] = useState(true);
    const [lastProposalId, setLastProposalId] = useState(null);

    // Add state to track expanded summaries
    const [expandedSummaries, setExpandedSummaries] = useState(new Set());

    // Fetch SNS data on component mount
    useEffect(() => {
        async function loadSnsData() {
            setLoadingSnses(true);
            try {
                const data = await fetchAndCacheSnsData(identity);
                setSnsList(data);
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

    // Fetch proposals when SNS changes or pagination changes
    useEffect(() => {
        if (selectedSnsRoot) {
            fetchProposals();
        }
    }, [selectedSnsRoot, itemsPerPage, currentPage]);

    const fetchProposals = async () => {
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

            const listProposalsArg = {
                limit: itemsPerPage,
                before_proposal: lastProposalId ? [{ id: BigInt(lastProposalId) }] : [],
                include_reward_status: [],
                exclude_type: [],
                include_status: [],
                include_topics: []
            };

            const response = await snsGovActor.list_proposals(listProposalsArg);
            
            if (response.proposals.length < itemsPerPage) {
                setHasMoreProposals(false);
            }

            if (currentPage === 1) {
                setProposals(response.proposals);
            } else {
                setProposals(prev => [...prev, ...response.proposals]);
            }

            if (response.proposals.length > 0) {
                const lastProposal = response.proposals[response.proposals.length - 1];
                setLastProposalId(lastProposal.id[0].id.toString());
            }
        } catch (err) {
            console.error('Error fetching proposals:', err);
            setError('Failed to fetch proposals');
        } finally {
            setLoading(false);
        }
    };

    const handleSnsChange = (e) => {
        const newSnsRoot = e.target.value;
        setSelectedSnsRoot(newSnsRoot);
        setCurrentPage(1);
        setLastProposalId(null);
        setHasMoreProposals(true);
        setProposals([]);
    };

    const handleItemsPerPageChange = (e) => {
        setItemsPerPage(Number(e.target.value));
        setCurrentPage(1);
        setLastProposalId(null);
        setHasMoreProposals(true);
        setProposals([]);
    };

    const loadMore = () => {
        setCurrentPage(prev => prev + 1);
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

    // Helper function to convert HTML breaks to Markdown
    const convertHtmlToMarkdown = (text) => {
        if (!text) return '';
        return text.replace(/<br>/g, '\n\n');
    };

    // Add toggle function for summaries
    const toggleSummary = (proposalId) => {
        setExpandedSummaries(prev => {
            const newSet = new Set(prev);
            if (newSet.has(proposalId)) {
                newSet.delete(proposalId);
            } else {
                newSet.add(proposalId);
            }
            return newSet;
        });
    };

    return (
        <div className='page-container'>
            <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
            <main className="wallet-container">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h1 style={{ color: '#ffffff' }}>Proposals</h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <label style={{ color: '#ffffff' }}>Items per page:</label>
                        <select
                            value={itemsPerPage}
                            onChange={handleItemsPerPageChange}
                            style={{
                                backgroundColor: '#3a3a3a',
                                color: '#fff',
                                border: '1px solid #4a4a4a',
                                borderRadius: '4px',
                                padding: '4px 8px'
                            }}
                        >
                            <option value={10}>10</option>
                            <option value={20}>20</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                        </select>
                    </div>
                </div>

                {error && <div style={{ color: '#e74c3c', marginBottom: '20px' }}>{error}</div>}

                {loading && proposals.length === 0 ? (
                    <div style={{ color: '#ffffff', textAlign: 'center', padding: '20px' }}>
                        Loading...
                    </div>
                ) : (
                    <div>
                        {proposals.map((proposal, index) => (
                            <div
                                key={index}
                                style={{
                                    backgroundColor: '#2a2a2a',
                                    borderRadius: '8px',
                                    padding: '20px',
                                    marginBottom: '15px'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                                    <div>
                                        <h3 style={{ color: '#ffffff', margin: '0 0 5px 0' }}>
                                            {formatProposalIdLink(proposal.id[0].id.toString(), selectedSnsRoot)}
                                        </h3>
                                        <h4 style={{ color: '#ffffff', margin: '0 0 10px 0' }}>
                                            {proposal.proposal[0]?.title || 'No title'}
                                        </h4>
                                    </div>
                                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                        <a 
                                            href={`https://nns.ic0.app/proposal/?u=${selectedSnsRoot}&proposal=${proposal.id[0].id.toString()}`}
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
                                            href={`https://dashboard.internetcomputer.org/sns/${selectedSnsRoot}/proposal/${proposal.id[0].id.toString()}`}
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
                                            href={`https://ic-toolkit.app/sns-management/${selectedSnsRoot}/proposals/view/${proposal.id[0].id.toString()}`}
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
                                        <div style={{
                                            padding: '5px 10px',
                                            borderRadius: '4px',
                                            backgroundColor: '#3a3a3a',
                                            color: '#ffffff'
                                        }}>
                                            {getProposalStatus(proposal)}
                                        </div>
                                    </div>
                                </div>
                                <div 
                                    onClick={() => toggleSummary(proposal.id[0].id.toString())}
                                    style={{
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                        padding: '10px',
                                        backgroundColor: '#3a3a3a',
                                        borderRadius: '6px',
                                        marginBottom: expandedSummaries.has(proposal.id[0].id.toString()) ? '10px' : '0',
                                        color: '#888'
                                    }}
                                >
                                    <span style={{ 
                                        transform: expandedSummaries.has(proposal.id[0].id.toString()) ? 'rotate(90deg)' : 'none',
                                        transition: 'transform 0.3s ease',
                                        display: 'inline-block'
                                    }}>▶</span>
                                    <span>Summary</span>
                                </div>
                                {expandedSummaries.has(proposal.id[0].id.toString()) && (
                                    <div style={{ 
                                        backgroundColor: '#3a3a3a', 
                                        padding: '15px', 
                                        borderRadius: '6px',
                                        color: '#888', 
                                        margin: '0 0 10px 0'
                                    }}>
                                        <ReactMarkdown>
                                            {convertHtmlToMarkdown(proposal.proposal[0]?.summary || 'No summary')}
                                        </ReactMarkdown>
                                    </div>
                                )}
                                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666', fontSize: '14px' }}>
                                    <span>Created: {new Date(Number(proposal.proposal_creation_timestamp_seconds) * 1000).toLocaleString()}</span>
                                    <span>Voting Period: {Math.floor(Number(proposal.initial_voting_period_seconds) / (24 * 60 * 60))} days</span>
                                </div>
                            </div>
                        ))}

                        {hasMoreProposals && (
                            <div style={{ textAlign: 'center', marginTop: '20px' }}>
                                <button
                                    onClick={loadMore}
                                    disabled={loading}
                                    style={{
                                        backgroundColor: '#3498db',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '10px 20px',
                                        cursor: loading ? 'not-allowed' : 'pointer',
                                        opacity: loading ? 0.7 : 1
                                    }}
                                >
                                    {loading ? 'Loading...' : 'Load More'}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}

export default Proposals; 