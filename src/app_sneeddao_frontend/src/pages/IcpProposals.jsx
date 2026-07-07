import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useWallet } from '../contexts/WalletContext';
import { useNaming } from '../NamingContext';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import MarkdownBody, { convertHtmlBreaks } from '../components/MarkdownBody';
import { getRelativeTime, getFullDate } from '../utils/DateUtils';
import {
    createNnsGovActor, NNS_TOPICS, NNS_PROPOSAL_STATUS,
    getNnsTopicName, getNnsProposalStatusText, getNnsProposalStatus,
    isNnsProposalAcceptingVotes, getNnsVotingTimeRemaining,
    getNnsActionTypeName, getNnsBallotForNeuron, formatNnsVote,
    getNnsNeuronId, getNnsNeuronVotingPower, hasNnsVotingAccess,
    voteOnNnsProposal, formatIcpE8s, NNS_GOVERNANCE_CANISTER_ID,
    fetchKnownNeurons, fetchUserNnsNeurons
} from '../utils/NnsUtils';
import { FaGavel, FaSearch, FaFilter, FaDownload, FaChevronDown, FaChevronRight, FaExternalLinkAlt, FaCheck, FaTimes, FaClock, FaLayerGroup, FaVoteYea } from 'react-icons/fa';

// Custom CSS for animations
const customStyles = `
@keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
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
    50% { opacity: 0.7; }
}

@keyframes slideDown {
    from {
        opacity: 0;
        max-height: 0;
    }
    to {
        opacity: 1;
        max-height: 2000px;
    }
}

.icp-proposals-card-animate {
    animation: fadeInUp 0.4s ease-out forwards;
}

.icp-proposals-shimmer {
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: shimmer 2s infinite;
}

.icp-proposals-pulse {
    animation: pulse 2s ease-in-out infinite;
}
`;

// Accent colors
const proposalPrimary = '#6366f1'; // Indigo
const proposalSecondary = '#8b5cf6'; // Purple
const proposalAccent = '#06b6d4'; // Cyan

// ICP brand color
const icpColor = '#29abe2';

// Topic filter options built from NNS_TOPICS
const topicOptions = [
    { value: '', label: 'All Topics', id: -1 },
    ...NNS_TOPICS.map(t => ({ value: String(t.id), label: t.name, id: t.id }))
];

// Status filter options
const statusOptions = [
    { value: '', label: 'All Statuses' },
    { value: '1', label: 'Open' },
    { value: '2', label: 'Rejected' },
    { value: '3', label: 'Adopted' },
    { value: '4', label: 'Executed' },
    { value: '5', label: 'Failed' },
];

function IcpProposals() {
    const { theme } = useTheme();
    const { isAuthenticated, identity } = useAuth();
    const { getNeuronsForGovernance } = useWallet();
    const navigate = useNavigate();
    const { neuronNames, neuronNicknames, verifiedNames, principalNames, principalNicknames } = useNaming();

    const [proposals, setProposals] = useState([]);
    const [filteredProposals, setFilteredProposals] = useState([]);
    const [topicFilter, setTopicFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [searchFilter, setSearchFilter] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    // Pagination state
    const [itemsPerPage, setItemsPerPage] = useState(20);
    const [hasMoreProposals, setHasMoreProposals] = useState(true);
    const [lastProposalId, setLastProposalId] = useState(null);
    const [loadingAll, setLoadingAll] = useState(false);
    const [allProposalsLoaded, setAllProposalsLoaded] = useState(false);

    // Expanded summaries
    const [expandedSummaries, setExpandedSummaries] = useState(new Set());
    const [hoveredCard, setHoveredCard] = useState(null);

    // Known neurons map
    const [knownNeurons, setKnownNeurons] = useState({});

    // Quick voting state
    const [proposalEligibility, setProposalEligibility] = useState({});
    const [quickVotingStates, setQuickVotingStates] = useState({});
    const [votedProposals, setVotedProposals] = useState(new Set());
    const eligibilityCheckRef = useRef(null);

    // Excluded topics for the API call (none by default; topic filter is applied client-side)
    const excludedTopics = [];
    // Status filter for API call
    const includeStatus = statusFilter ? [statusFilter] : [];

    // Actively fetch NNS neurons (not passive cache read - cache may not be populated yet)
    const [nnsNeurons, setNnsNeurons] = useState([]);
    const userPrincipal = identity?.getPrincipal()?.toString();

    useEffect(() => {
        if (!isAuthenticated || !identity) return;
        (async () => {
            try {
                const neurons = getNeuronsForGovernance
                    ? await getNeuronsForGovernance(NNS_GOVERNANCE_CANISTER_ID)
                    : await fetchUserNnsNeurons(identity);
                setNnsNeurons(neurons || []);
            } catch (err) {
                console.warn('Failed to load NNS neurons for proposals page:', err);
            }
        })();
    }, [isAuthenticated, identity, getNeuronsForGovernance]);

    // Format VP in compact form (K, M suffixes)
    const formatCompactVP = (vp) => {
        if (!vp || vp === 0n) return '0';
        const displayValue = Number(vp) / 100_000_000;
        if (displayValue >= 1_000_000) {
            return (displayValue / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
        } else if (displayValue >= 1_000) {
            return (displayValue / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
        }
        return displayValue.toFixed(displayValue < 10 ? 1 : 0).replace(/\.0$/, '');
    };

    // Fetch known neurons on mount
    useEffect(() => {
        const loadKnownNeurons = async () => {
            try {
                const kn = await fetchKnownNeurons(identity);
                setKnownNeurons(kn);
            } catch (err) {
                console.warn('Failed to fetch known neurons:', err);
            }
        };
        loadKnownNeurons();
    }, [identity]);

    // Fetch proposals
    const fetchProposals = useCallback(async (appendMode = false) => {
        setLoading(true);
        setError('');
        try {
            const nnsGovActor = createNnsGovActor(identity);

            const response = await nnsGovActor.list_proposals({
                include_reward_status: [],
                omit_large_fields: [true],
                before_proposal: lastProposalId ? [{ id: BigInt(lastProposalId) }] : [],
                limit: itemsPerPage,
                exclude_topic: excludedTopics.map(t => Number(t)),
                include_all_manage_neuron_proposals: [],
                include_status: includeStatus.length > 0 ? includeStatus.map(s => Number(s)) : [],
            });

            const newProposals = response.proposal_info || [];

            if (newProposals.length < itemsPerPage) {
                setHasMoreProposals(false);
            }

            if (appendMode) {
                setProposals(prev => [...prev, ...newProposals]);
            } else {
                setProposals(newProposals);
            }

            if (newProposals.length > 0) {
                const lastP = newProposals[newProposals.length - 1];
                setLastProposalId(lastP.id?.[0]?.id?.toString());
            }
        } catch (err) {
            console.error('Error fetching ICP proposals:', err);
            setError('Failed to fetch proposals. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [identity, lastProposalId, itemsPerPage, excludedTopics, includeStatus]);

    // Fetch on mount and when status filter changes
    useEffect(() => {
        setProposals([]);
        setLastProposalId(null);
        setHasMoreProposals(true);
        setAllProposalsLoaded(false);
        setProposalEligibility({});
        setQuickVotingStates({});
        setVotedProposals(new Set());
    }, [statusFilter]);

    // Trigger fetch after reset
    useEffect(() => {
        if (proposals.length === 0 && !loading) {
            fetchProposals(false);
        }
    }, [proposals.length]); // eslint-disable-line react-hooks/exhaustive-deps

    // Filter proposals client-side (topic + search)
    useEffect(() => {
        if (!proposals.length) {
            setFilteredProposals([]);
            return;
        }

        let filtered = proposals;

        // Topic filter
        if (topicFilter) {
            const topicId = Number(topicFilter);
            filtered = filtered.filter(p => Number(p.topic) === topicId);
        }

        // Search filter (searches title and proposer neuron ID)
        if (searchFilter.trim()) {
            const q = searchFilter.toLowerCase();
            filtered = filtered.filter(p => {
                const title = (p.proposal?.[0]?.title?.[0] || '').toLowerCase();
                const proposerId = p.proposer?.[0]?.id?.toString() || '';
                const proposerName = knownNeurons[proposerId] || '';
                return title.includes(q) || proposerId.includes(q) || proposerName.toLowerCase().includes(q);
            });
        }

        setFilteredProposals(filtered);
    }, [proposals, topicFilter, searchFilter, knownNeurons]);

    // Progressive eligibility check for proposals
    useEffect(() => {
        if (!isAuthenticated || !identity || filteredProposals.length === 0) {
            return;
        }

        if (eligibilityCheckRef.current) {
            clearTimeout(eligibilityCheckRef.current);
        }

        if (!nnsNeurons || nnsNeurons.length === 0) {
            const emptyEligibility = {};
            filteredProposals.forEach(p => {
                const proposalId = p.id?.[0]?.id?.toString();
                if (proposalId) {
                    emptyEligibility[proposalId] = { loading: false, eligibleCount: 0, totalVP: 0n, votedCount: 0, votedVP: 0n, checked: true };
                }
            });
            setProposalEligibility(emptyEligibility);
            return;
        }

        const checkEligibilityBatch = async (startIndex) => {
            const batchSize = 5;
            const batch = filteredProposals.slice(startIndex, startIndex + batchSize);

            if (batch.length === 0) return;

            const updates = {};

            for (const proposal of batch) {
                const proposalId = proposal.id?.[0]?.id?.toString();
                if (!proposalId || !isNnsProposalAcceptingVotes(proposal)) {
                    if (proposalId) {
                        updates[proposalId] = { loading: false, eligibleCount: 0, totalVP: 0n, votedCount: 0, votedVP: 0n, checked: true };
                    }
                    continue;
                }

                if (votedProposals.has(proposalId)) continue;

                let eligibleCount = 0;
                let totalVP = 0n;
                let votedCount = 0;
                let votedVP = 0n;

                for (const neuron of nnsNeurons) {
                    if (!hasNnsVotingAccess(neuron, userPrincipal)) continue;

                    const vp = getNnsNeuronVotingPower(neuron);
                    if (vp === 0n) continue;

                    const neuronId = getNnsNeuronId(neuron);
                    const ballot = getNnsBallotForNeuron(proposal.ballots, neuronId);

                    if (ballot) {
                        const voteVal = Number(ballot.vote);
                        if (voteVal === 1 || voteVal === 2) {
                            votedCount++;
                            votedVP += vp;
                            continue;
                        }
                    }

                    eligibleCount++;
                    totalVP += vp;
                }

                updates[proposalId] = { loading: false, eligibleCount, totalVP, votedCount, votedVP, checked: true };
            }

            setProposalEligibility(prev => ({ ...prev, ...updates }));

            if (startIndex + batchSize < filteredProposals.length) {
                eligibilityCheckRef.current = setTimeout(() => {
                    checkEligibilityBatch(startIndex + batchSize);
                }, 50);
            }
        };

        const loadingState = {};
        filteredProposals.forEach(p => {
            const proposalId = p.id?.[0]?.id?.toString();
            if (proposalId && !proposalEligibility[proposalId]?.checked) {
                loadingState[proposalId] = { loading: true, eligibleCount: 0, totalVP: 0n, votedCount: 0, votedVP: 0n, checked: false };
            }
        });
        if (Object.keys(loadingState).length > 0) {
            setProposalEligibility(prev => ({ ...prev, ...loadingState }));
        }

        eligibilityCheckRef.current = setTimeout(() => {
            checkEligibilityBatch(0);
        }, 100);

        return () => {
            if (eligibilityCheckRef.current) {
                clearTimeout(eligibilityCheckRef.current);
            }
        };
    }, [filteredProposals, isAuthenticated, identity, nnsNeurons, userPrincipal, votedProposals]); // eslint-disable-line react-hooks/exhaustive-deps

    // Quick vote function
    const quickVote = useCallback(async (proposal, vote) => {
        const proposalId = proposal.id?.[0]?.id?.toString();
        if (!proposalId || !identity) return;

        if (!nnsNeurons || nnsNeurons.length === 0) return;

        setQuickVotingStates(prev => ({ ...prev, [proposalId]: 'voting' }));

        try {
            const eligibleNeurons = nnsNeurons.filter(neuron => {
                if (!hasNnsVotingAccess(neuron, userPrincipal)) return false;
                const vp = getNnsNeuronVotingPower(neuron);
                if (vp === 0n) return false;

                const neuronId = getNnsNeuronId(neuron);
                const ballot = getNnsBallotForNeuron(proposal.ballots, neuronId);
                if (ballot) {
                    const voteVal = Number(ballot.vote);
                    if (voteVal === 1 || voteVal === 2) return false;
                }
                return true;
            });

            if (eligibleNeurons.length === 0) {
                setQuickVotingStates(prev => ({ ...prev, [proposalId]: 'error' }));
                setTimeout(() => {
                    setQuickVotingStates(prev => ({ ...prev, [proposalId]: 'idle' }));
                }, 3000);
                return;
            }

            let successCount = 0;
            let totalVotedVP = 0n;

            for (const neuron of eligibleNeurons) {
                const neuronId = getNnsNeuronId(neuron);
                if (!neuronId) continue;

                const result = await voteOnNnsProposal(identity, neuronId, proposalId, vote);
                if (result.success) {
                    successCount++;
                    totalVotedVP += getNnsNeuronVotingPower(neuron);
                } else {
                    console.error('Vote error for neuron', neuronId.toString(), ':', result.error);
                }
            }

            if (successCount > 0) {
                setQuickVotingStates(prev => ({ ...prev, [proposalId]: 'success' }));
                setVotedProposals(prev => new Set([...prev, proposalId]));
                setProposalEligibility(prev => ({
                    ...prev,
                    [proposalId]: { loading: false, eligibleCount: 0, totalVP: 0n, votedCount: successCount, votedVP: totalVotedVP, checked: true }
                }));
            } else {
                setQuickVotingStates(prev => ({ ...prev, [proposalId]: 'error' }));
            }

            setTimeout(() => {
                setQuickVotingStates(prev => ({ ...prev, [proposalId]: 'idle' }));
            }, 3000);

        } catch (err) {
            console.error('Quick vote error:', err);
            setQuickVotingStates(prev => ({ ...prev, [proposalId]: 'error' }));
            setTimeout(() => {
                setQuickVotingStates(prev => ({ ...prev, [proposalId]: 'idle' }));
            }, 3000);
        }
    }, [identity, nnsNeurons, userPrincipal]);

    // Load more proposals
    const loadMore = () => {
        fetchProposals(true);
    };

    // Load all proposals
    const loadAllProposals = async () => {
        if (loadingAll || allProposalsLoaded) return;

        setLoadingAll(true);
        try {
            const nnsGovActor = createNnsGovActor(identity);
            let allProposals = [...proposals];
            let hasMore = hasMoreProposals;
            let currentLastId = lastProposalId;
            let pageCount = 0;

            while (hasMore && pageCount < 100) {
                pageCount++;

                const response = await nnsGovActor.list_proposals({
                    include_reward_status: [],
                    omit_large_fields: [true],
                    before_proposal: currentLastId ? [{ id: BigInt(currentLastId) }] : [],
                    limit: 100,
                    exclude_topic: excludedTopics.map(t => Number(t)),
                    include_all_manage_neuron_proposals: [],
                    include_status: includeStatus.length > 0 ? includeStatus.map(s => Number(s)) : [],
                });

                const newProposals = response.proposal_info || [];

                if (newProposals.length === 0) {
                    hasMore = false;
                } else {
                    const dedupedNew = newProposals.filter(newP =>
                        !allProposals.some(existP =>
                            existP.id?.[0]?.id?.toString() === newP.id?.[0]?.id?.toString()
                        )
                    );
                    allProposals = [...allProposals, ...dedupedNew];

                    const lastP = newProposals[newProposals.length - 1];
                    currentLastId = lastP.id?.[0]?.id?.toString();

                    if (newProposals.length < 100) {
                        hasMore = false;
                    }
                }
            }

            setProposals(allProposals);
            setHasMoreProposals(false);
            setAllProposalsLoaded(true);
            setLastProposalId(currentLastId);
        } catch (err) {
            console.error('Error loading all ICP proposals:', err);
            setError('Failed to load all proposals: ' + err.message);
        } finally {
            setLoadingAll(false);
        }
    };

    const handleItemsPerPageChange = (e) => {
        setItemsPerPage(parseInt(e.target.value));
        setProposals([]);
        setLastProposalId(null);
        setHasMoreProposals(true);
        setAllProposalsLoaded(false);
    };

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

    // Get status color and icon
    const getStatusStyle = (status) => {
        const statusLower = status.toLowerCase();
        if (statusLower.includes('executed') || statusLower.includes('adopted')) {
            return { color: theme.colors.success, bg: `${theme.colors.success}20`, icon: <FaCheck size={10} /> };
        }
        if (statusLower.includes('rejected') || statusLower.includes('failed')) {
            return { color: theme.colors.error, bg: `${theme.colors.error}20`, icon: <FaTimes size={10} /> };
        }
        if (statusLower.includes('open') || statusLower.includes('voting')) {
            return { color: proposalAccent, bg: `${proposalAccent}20`, icon: <FaClock size={10} /> };
        }
        return { color: theme.colors.mutedText, bg: theme.colors.tertiaryBg, icon: null };
    };

    // CSV Export
    const exportProposalsToCSV = async () => {
        let proposalsToExport = filteredProposals;

        if (!allProposalsLoaded && hasMoreProposals) {
            await loadAllProposals();
            // After loadAllProposals, proposals state is updated; re-filter
            // For simplicity we export what we currently have
            proposalsToExport = filteredProposals;
        }

        if (proposalsToExport.length === 0) {
            alert('No proposals to export');
            return;
        }

        const headers = [
            'Proposal ID', 'Title', 'Topic', 'Status', 'Proposer Neuron ID',
            'Proposer Known Name', 'Created At', 'Deadline', 'Yes Votes', 'No Votes',
            'Total Votes', 'Summary', 'NNS URL', 'Dashboard URL'
        ];

        const csvRows = proposalsToExport.map(p => {
            const proposalId = p.id?.[0]?.id?.toString() || '';
            const title = p.proposal?.[0]?.title?.[0] || '';
            const topic = getNnsTopicName(p.topic);
            const status = getNnsProposalStatus(p);
            const proposerId = p.proposer?.[0]?.id?.toString() || '';
            const proposerName = knownNeurons[proposerId] || '';
            const createdAt = p.proposal_timestamp_seconds
                ? new Date(Number(p.proposal_timestamp_seconds) * 1000).toISOString()
                : '';
            const deadline = p.deadline_timestamp_seconds?.[0]
                ? new Date(Number(p.deadline_timestamp_seconds[0]) * 1000).toISOString()
                : '';
            const tally = p.latest_tally?.[0];
            const yes = tally ? formatIcpE8s(tally.yes) : '';
            const no = tally ? formatIcpE8s(tally.no) : '';
            const total = tally ? formatIcpE8s(tally.total) : '';
            const summary = (p.proposal?.[0]?.summary || '').replace(/\n+/g, ' ').trim();
            const nnsUrl = `https://nns.ic0.app/proposal/?proposal=${proposalId}`;
            const dashboardUrl = `https://dashboard.internetcomputer.org/proposal/${proposalId}`;

            return [proposalId, title, topic, status, proposerId, proposerName, createdAt, deadline, yes, no, total, summary, nnsUrl, dashboardUrl];
        });

        const csvContent = [
            headers.join(','),
            ...csvRows.map(row =>
                row.map(cell => {
                    const cellStr = String(cell);
                    if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
                        return `"${cellStr.replace(/"/g, '""')}"`;
                    }
                    return cellStr;
                }).join(',')
            )
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        link.setAttribute('download', `icp_proposals_${timestamp}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    // Loading state
    if (loading && proposals.length === 0) {
        return (
            <div className='page-container'>
                <style>{customStyles}</style>
                <Header />
                <main style={{
                    background: theme.colors.primaryGradient,
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <div style={{
                        textAlign: 'center',
                        color: theme.colors.mutedText
                    }}>
                        <div className="icp-proposals-pulse" style={{
                            width: '60px',
                            height: '60px',
                            borderRadius: '50%',
                            background: `linear-gradient(135deg, ${proposalPrimary}, ${proposalSecondary})`,
                            margin: '0 auto 1rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <FaGavel size={28} color="white" />
                        </div>
                        <p style={{ fontSize: '1.1rem' }}>Loading ICP proposals...</p>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container'>
            <style>{customStyles}</style>
            <Header />

            <main style={{
                background: theme.colors.primaryGradient,
                minHeight: '100vh'
            }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${proposalPrimary}15 50%, ${proposalSecondary}10 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    padding: '2.5rem 1.5rem',
                    position: 'relative',
                    overflow: 'hidden',
                    width: '100%',
                    boxSizing: 'border-box'
                }}>
                    {/* Background decoration */}
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
                        position: 'absolute',
                        bottom: '-30%',
                        left: '-5%',
                        width: '300px',
                        height: '300px',
                        background: `radial-gradient(circle, ${proposalSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />

                    <div style={{
                        maxWidth: '900px',
                        margin: '0 auto',
                        position: 'relative',
                        zIndex: 1
                    }}>
                        {/* ICP Logo and Title */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1.25rem',
                            marginBottom: '1.25rem'
                        }}>
                            {/* ICP Logo Icon */}
                            <div style={{
                                width: '64px',
                                height: '64px',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${icpColor}, #1b2a4a)`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: `3px solid ${icpColor}40`,
                                boxShadow: `0 4px 20px ${icpColor}30`,
                                fontSize: '1.4rem',
                                fontWeight: '800',
                                color: 'white',
                                letterSpacing: '-0.5px'
                            }}>
                                ICP
                            </div>

                            <div style={{ flex: 1 }}>
                                <h1 style={{
                                    color: theme.colors.primaryText,
                                    fontSize: '2rem',
                                    fontWeight: '700',
                                    margin: 0,
                                    lineHeight: '1.2'
                                }}>
                                    ICP Governance Proposals
                                </h1>
                                <p style={{
                                    color: theme.colors.secondaryText,
                                    fontSize: '1rem',
                                    margin: '0.35rem 0 0 0'
                                }}>
                                    NNS proposals for the Internet Computer &bull;{' '}
                                    <Link
                                        to="/proposals"
                                        style={{ color: proposalPrimary, textDecoration: 'none' }}
                                    >
                                        Looking for SNS proposals? Go to /proposals
                                    </Link>
                                </p>
                            </div>
                        </div>

                        {/* Quick Stats */}
                        <div style={{
                            display: 'flex',
                            gap: '1.5rem',
                            flexWrap: 'wrap',
                            alignItems: 'center'
                        }}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                color: theme.colors.secondaryText,
                                fontSize: '0.9rem'
                            }}>
                                <FaLayerGroup size={14} style={{ color: proposalPrimary }} />
                                <span>{proposals.length} proposal{proposals.length !== 1 ? 's' : ''} loaded</span>
                            </div>
                            {filteredProposals.filter(p => isNnsProposalAcceptingVotes(p)).length > 0 && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    color: proposalAccent,
                                    background: `${proposalAccent}15`,
                                    padding: '0.4rem 0.75rem',
                                    borderRadius: '20px',
                                    fontSize: '0.85rem',
                                    fontWeight: '500'
                                }}>
                                    <FaVoteYea size={14} />
                                    <span>{filteredProposals.filter(p => isNnsProposalAcceptingVotes(p)).length} open for voting</span>
                                </div>
                            )}
                            {nnsNeurons.length > 0 && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    color: theme.colors.secondaryText,
                                    fontSize: '0.85rem'
                                }}>
                                    <FaGavel size={12} style={{ color: icpColor }} />
                                    <span>{nnsNeurons.length} neuron{nnsNeurons.length !== 1 ? 's' : ''} available</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div style={{
                    maxWidth: '900px',
                    margin: '0 auto',
                    padding: '1.5rem'
                }}>
                    {/* Controls Section */}
                    <div style={{
                        background: theme.colors.secondaryBg,
                        borderRadius: '16px',
                        border: `1px solid ${theme.colors.border}`,
                        padding: '1.25rem',
                        marginBottom: '1.5rem'
                    }}>
                        {/* Filters Row */}
                        <div style={{
                            display: 'flex',
                            gap: '0.75rem',
                            marginBottom: '1rem',
                            flexWrap: 'wrap'
                        }}>
                            {/* Search Input */}
                            <div style={{
                                flex: '1 1 250px',
                                position: 'relative'
                            }}>
                                <FaSearch size={14} style={{
                                    position: 'absolute',
                                    left: '12px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: theme.colors.mutedText
                                }} />
                                <input
                                    type="text"
                                    value={searchFilter}
                                    onChange={(e) => setSearchFilter(e.target.value)}
                                    placeholder="Search by title or proposer..."
                                    style={{
                                        width: '100%',
                                        padding: '0.65rem 0.75rem 0.65rem 2.25rem',
                                        borderRadius: '10px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: theme.colors.primaryBg,
                                        color: theme.colors.primaryText,
                                        fontSize: '0.9rem',
                                        outline: 'none',
                                        transition: 'border-color 0.2s ease',
                                        boxSizing: 'border-box'
                                    }}
                                />
                            </div>

                            {/* Topic Filter */}
                            <div style={{
                                flex: '0 0 auto',
                                position: 'relative'
                            }}>
                                <FaFilter size={12} style={{
                                    position: 'absolute',
                                    left: '12px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: theme.colors.mutedText
                                }} />
                                <select
                                    value={topicFilter}
                                    onChange={(e) => setTopicFilter(e.target.value)}
                                    style={{
                                        padding: '0.65rem 2rem 0.65rem 2rem',
                                        borderRadius: '10px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: theme.colors.primaryBg,
                                        color: theme.colors.primaryText,
                                        fontSize: '0.9rem',
                                        outline: 'none',
                                        cursor: 'pointer',
                                        appearance: 'none',
                                        maxWidth: '280px'
                                    }}
                                >
                                    {topicOptions.map(option => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                <FaChevronDown size={10} style={{
                                    position: 'absolute',
                                    right: '12px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: theme.colors.mutedText,
                                    pointerEvents: 'none'
                                }} />
                            </div>

                            {/* Status Filter */}
                            <div style={{
                                flex: '0 0 auto',
                                position: 'relative'
                            }}>
                                <select
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value)}
                                    style={{
                                        padding: '0.65rem 2rem 0.65rem 0.75rem',
                                        borderRadius: '10px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: theme.colors.primaryBg,
                                        color: theme.colors.primaryText,
                                        fontSize: '0.9rem',
                                        outline: 'none',
                                        cursor: 'pointer',
                                        appearance: 'none',
                                        maxWidth: '180px'
                                    }}
                                >
                                    {statusOptions.map(option => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                <FaChevronDown size={10} style={{
                                    position: 'absolute',
                                    right: '12px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: theme.colors.mutedText,
                                    pointerEvents: 'none'
                                }} />
                            </div>
                        </div>

                        {/* Actions Row */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '0.75rem'
                        }}>
                            {/* Left side - Action buttons */}
                            <div style={{
                                display: 'flex',
                                gap: '0.5rem',
                                flexWrap: 'wrap'
                            }}>
                                <button
                                    onClick={loadAllProposals}
                                    disabled={loadingAll || allProposalsLoaded}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        padding: '0.5rem 1rem',
                                        borderRadius: '8px',
                                        border: `1px solid ${allProposalsLoaded ? theme.colors.success : theme.colors.border}`,
                                        background: allProposalsLoaded ? `${theme.colors.success}15` : 'transparent',
                                        color: allProposalsLoaded ? theme.colors.success : theme.colors.primaryText,
                                        fontSize: '0.85rem',
                                        fontWeight: '500',
                                        cursor: (loadingAll || allProposalsLoaded) ? 'not-allowed' : 'pointer',
                                        opacity: loadingAll ? 0.7 : 1,
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    {allProposalsLoaded ? <FaCheck size={12} /> : loadingAll ? (
                                        <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>&#x27F3;</span>
                                    ) : (
                                        <FaLayerGroup size={12} />
                                    )}
                                    {loadingAll ? 'Loading...' : allProposalsLoaded ? 'All Loaded' : 'Load All'}
                                </button>

                                <button
                                    onClick={exportProposalsToCSV}
                                    disabled={loading || loadingAll || proposals.length === 0}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        padding: '0.5rem 1rem',
                                        borderRadius: '8px',
                                        border: 'none',
                                        background: `linear-gradient(135deg, ${proposalPrimary}, ${proposalSecondary})`,
                                        color: 'white',
                                        fontSize: '0.85rem',
                                        fontWeight: '500',
                                        cursor: (loading || loadingAll || proposals.length === 0) ? 'not-allowed' : 'pointer',
                                        opacity: (loading || loadingAll || proposals.length === 0) ? 0.6 : 1,
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    <FaDownload size={12} />
                                    Export CSV
                                </button>
                            </div>

                            {/* Right side - Items per page */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                fontSize: '0.85rem',
                                color: theme.colors.secondaryText
                            }}>
                                <span>Show</span>
                                <select
                                    value={itemsPerPage}
                                    onChange={handleItemsPerPageChange}
                                    style={{
                                        padding: '0.35rem 0.5rem',
                                        borderRadius: '6px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: theme.colors.primaryBg,
                                        color: theme.colors.primaryText,
                                        fontSize: '0.85rem',
                                        outline: 'none',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <option value={10}>10</option>
                                    <option value={20}>20</option>
                                    <option value={50}>50</option>
                                    <option value={100}>100</option>
                                </select>
                                <span>per page</span>
                            </div>
                        </div>

                        {/* Filter info */}
                        {(topicFilter || searchFilter.trim() || statusFilter) && (
                            <div style={{
                                marginTop: '1rem',
                                padding: '0.75rem 1rem',
                                background: `${proposalPrimary}10`,
                                borderRadius: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                flexWrap: 'wrap',
                                gap: '0.5rem'
                            }}>
                                <span style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                    Showing <strong style={{ color: proposalPrimary }}>{filteredProposals.length}</strong> of {proposals.length} proposals
                                    {searchFilter.trim() && <span> matching &quot;{searchFilter}&quot;</span>}
                                    {topicFilter && <span> in {topicOptions.find(opt => opt.value === topicFilter)?.label || topicFilter}</span>}
                                    {statusFilter && <span> with status {statusOptions.find(opt => opt.value === statusFilter)?.label || statusFilter}</span>}
                                </span>
                                <button
                                    onClick={() => {
                                        setSearchFilter('');
                                        setTopicFilter('');
                                        setStatusFilter('');
                                    }}
                                    style={{
                                        background: 'transparent',
                                        border: `1px solid ${theme.colors.border}`,
                                        color: theme.colors.secondaryText,
                                        padding: '0.25rem 0.75rem',
                                        borderRadius: '6px',
                                        fontSize: '0.8rem',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    Clear Filters
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div style={{
                            background: `${theme.colors.error}15`,
                            border: `1px solid ${theme.colors.error}40`,
                            borderRadius: '12px',
                            padding: '1rem 1.25rem',
                            marginBottom: '1.5rem',
                            color: theme.colors.error
                        }}>
                            {error}
                        </div>
                    )}

                    {/* Proposals List */}
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '1rem'
                    }}>
                        {filteredProposals.map((proposal, index) => {
                            const proposalId = proposal.id?.[0]?.id?.toString();
                            const status = getNnsProposalStatus(proposal);
                            const statusStyle = getStatusStyle(status);
                            const isHovered = hoveredCard === proposalId;
                            const isExpanded = expandedSummaries.has(proposalId);
                            const acceptingVotes = isNnsProposalAcceptingVotes(proposal);
                            const topicName = getNnsTopicName(proposal.topic);
                            const title = proposal.proposal?.[0]?.title?.[0] || 'Untitled Proposal';
                            const summary = proposal.proposal?.[0]?.summary || '';
                            const proposerId = proposal.proposer?.[0]?.id?.toString() || '';
                            const proposerName = knownNeurons[proposerId] || '';
                            const tally = proposal.latest_tally?.[0];
                            const actionType = proposal.proposal?.[0]?.action?.[0]
                                ? getNnsActionTypeName(proposal.proposal[0].action[0])
                                : '';

                            // Topic info
                            const topicInfo = NNS_TOPICS.find(t => t.id === Number(proposal.topic));

                            return (
                                <div
                                    key={proposalId || index}
                                    className="icp-proposals-card-animate"
                                    style={{
                                        background: theme.colors.secondaryBg,
                                        borderRadius: '16px',
                                        border: `1px solid ${isHovered ? proposalPrimary : theme.colors.border}`,
                                        overflow: 'hidden',
                                        transition: 'all 0.3s ease',
                                        transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
                                        boxShadow: isHovered
                                            ? `0 8px 30px ${proposalPrimary}20`
                                            : '0 2px 10px rgba(0,0,0,0.08)',
                                        animationDelay: `${index * 0.05}s`,
                                        opacity: 0
                                    }}
                                    onMouseEnter={() => setHoveredCard(proposalId)}
                                    onMouseLeave={() => setHoveredCard(null)}
                                >
                                    {/* Card Header */}
                                    <div style={{
                                        padding: '1.25rem 1.5rem',
                                        borderBottom: `1px solid ${theme.colors.border}`,
                                        background: acceptingVotes
                                            ? `linear-gradient(135deg, ${proposalAccent}08 0%, transparent 100%)`
                                            : 'transparent'
                                    }}>
                                        {/* Top Row: ID, Status, Time */}
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.75rem',
                                            marginBottom: '0.75rem',
                                            flexWrap: 'wrap'
                                        }}>
                                            <span style={{
                                                color: proposalPrimary,
                                                fontWeight: '600',
                                                fontSize: '0.9rem'
                                            }}>
                                                #{proposalId}
                                            </span>

                                            <span style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                padding: '3px 10px',
                                                borderRadius: '20px',
                                                background: statusStyle.bg,
                                                color: statusStyle.color,
                                                fontSize: '0.8rem',
                                                fontWeight: '500'
                                            }}>
                                                {statusStyle.icon}
                                                {status}
                                            </span>

                                            {acceptingVotes && (
                                                <span style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    padding: '3px 10px',
                                                    borderRadius: '20px',
                                                    background: `${proposalAccent}15`,
                                                    color: proposalAccent,
                                                    fontSize: '0.8rem',
                                                    fontWeight: '500'
                                                }}>
                                                    <FaClock size={10} />
                                                    {getNnsVotingTimeRemaining(proposal)}
                                                </span>
                                            )}

                                            <span style={{
                                                padding: '3px 10px',
                                                borderRadius: '20px',
                                                background: topicInfo?.isCritical ? '#f59e0b20' : theme.colors.tertiaryBg,
                                                color: topicInfo?.isCritical ? '#f59e0b' : theme.colors.secondaryText,
                                                fontSize: '0.75rem',
                                                fontWeight: topicInfo?.isCritical ? '600' : '400'
                                            }}>
                                                {topicName}{topicInfo?.isCritical ? ' (Critical)' : ''}
                                            </span>

                                            {actionType && actionType !== topicName && (
                                                <span style={{
                                                    padding: '3px 10px',
                                                    borderRadius: '20px',
                                                    background: theme.colors.tertiaryBg,
                                                    color: theme.colors.mutedText,
                                                    fontSize: '0.7rem'
                                                }}>
                                                    {actionType}
                                                </span>
                                            )}
                                        </div>

                                        {/* Title */}
                                        <Link
                                            to={`/icp_proposal?proposalid=${proposalId}`}
                                            style={{
                                                color: theme.colors.primaryText,
                                                textDecoration: 'none',
                                                fontSize: '1.15rem',
                                                fontWeight: '600',
                                                lineHeight: '1.4',
                                                display: 'block',
                                                marginBottom: '0.75rem',
                                                transition: 'color 0.2s ease'
                                            }}
                                        >
                                            {title}
                                        </Link>

                                        {/* Proposer */}
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            fontSize: '0.85rem',
                                            color: theme.colors.secondaryText
                                        }}>
                                            <span>Proposer:</span>
                                            <span style={{
                                                fontFamily: 'monospace',
                                                fontSize: '0.8rem',
                                                color: theme.colors.primaryText
                                            }}>
                                                {proposerName ? (
                                                    <span title={`Neuron ${proposerId}`}>
                                                        {proposerName}{' '}
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>
                                                            ({proposerId})
                                                        </span>
                                                    </span>
                                                ) : (
                                                    <span>{proposerId || 'Unknown'}</span>
                                                )}
                                            </span>
                                        </div>

                                        {/* Tally bar */}
                                        {tally && (
                                            <div style={{ marginTop: '0.75rem' }}>
                                                <div style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    fontSize: '0.75rem',
                                                    color: theme.colors.secondaryText,
                                                    marginBottom: '0.35rem'
                                                }}>
                                                    <span style={{ color: theme.colors.success }}>
                                                        Adopt: {formatIcpE8s(tally.yes)} ICP
                                                    </span>
                                                    <span style={{ color: theme.colors.error }}>
                                                        Reject: {formatIcpE8s(tally.no)} ICP
                                                    </span>
                                                </div>
                                                <div style={{
                                                    height: '6px',
                                                    borderRadius: '3px',
                                                    background: theme.colors.tertiaryBg,
                                                    overflow: 'hidden',
                                                    display: 'flex'
                                                }}>
                                                    {(() => {
                                                        const total = Number(tally.yes) + Number(tally.no);
                                                        const yesPercent = total > 0 ? (Number(tally.yes) / total) * 100 : 0;
                                                        return (
                                                            <>
                                                                <div style={{
                                                                    width: `${yesPercent}%`,
                                                                    background: theme.colors.success,
                                                                    transition: 'width 0.3s ease'
                                                                }} />
                                                                <div style={{
                                                                    width: `${100 - yesPercent}%`,
                                                                    background: total > 0 ? theme.colors.error : 'transparent',
                                                                    transition: 'width 0.3s ease'
                                                                }} />
                                                            </>
                                                        );
                                                    })()}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Summary Toggle */}
                                    <div
                                        onClick={() => toggleSummary(proposalId)}
                                        style={{
                                            padding: '0.75rem 1.5rem',
                                            borderBottom: isExpanded ? `1px solid ${theme.colors.border}` : 'none',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            color: theme.colors.secondaryText,
                                            fontSize: '0.9rem',
                                            transition: 'background 0.2s ease',
                                            background: isExpanded ? theme.colors.tertiaryBg : 'transparent'
                                        }}
                                    >
                                        <FaChevronRight
                                            size={12}
                                            style={{
                                                transition: 'transform 0.3s ease',
                                                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'
                                            }}
                                        />
                                        <span>Summary</span>
                                    </div>

                                    {/* Summary Content */}
                                    {isExpanded && (
                                        <div style={{
                                            padding: '1rem 1.5rem',
                                            borderBottom: `1px solid ${theme.colors.border}`,
                                            background: theme.colors.primaryBg,
                                            color: theme.colors.secondaryText,
                                            fontSize: '0.9rem',
                                            lineHeight: '1.6',
                                            maxHeight: '400px',
                                            overflow: 'auto'
                                        }}>
                                            <MarkdownBody
                                                text={convertHtmlBreaks(summary || 'No summary available')}
                                                hardBreaks={false}
                                                style={{
                                                    color: theme.colors.secondaryText,
                                                    fontSize: '0.9rem',
                                                    lineHeight: '1.6'
                                                }}
                                            />
                                        </div>
                                    )}

                                    {/* Card Footer */}
                                    <div style={{
                                        padding: '1rem 1.5rem',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                        gap: '0.75rem'
                                    }}>
                                        {/* Left: Meta info */}
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '1rem',
                                            fontSize: '0.8rem',
                                            color: theme.colors.mutedText
                                        }}>
                                            {proposal.proposal_timestamp_seconds ? (
                                                <span title={getFullDate(BigInt(Number(proposal.proposal_timestamp_seconds) * 1_000_000_000))}>
                                                    Created {getRelativeTime(BigInt(Number(proposal.proposal_timestamp_seconds) * 1_000_000_000))}
                                                </span>
                                            ) : (
                                                <span>No timestamp</span>
                                            )}
                                            {proposal.deadline_timestamp_seconds?.[0] && (
                                                <span title={getFullDate(BigInt(Number(proposal.deadline_timestamp_seconds[0]) * 1_000_000_000))}>
                                                    Deadline: {getRelativeTime(BigInt(Number(proposal.deadline_timestamp_seconds[0]) * 1_000_000_000))}
                                                </span>
                                            )}
                                        </div>

                                        {/* Right: Actions */}
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            flexWrap: 'wrap'
                                        }}>
                                            {/* External Links */}
                                            <a
                                                href={`https://nns.ic0.app/proposal/?proposal=${proposalId}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    padding: '0.4rem 0.75rem',
                                                    borderRadius: '6px',
                                                    background: theme.colors.tertiaryBg,
                                                    color: theme.colors.secondaryText,
                                                    textDecoration: 'none',
                                                    fontSize: '0.8rem',
                                                    transition: 'all 0.2s ease'
                                                }}
                                            >
                                                NNS <FaExternalLinkAlt size={10} />
                                            </a>
                                            <a
                                                href={`https://dashboard.internetcomputer.org/proposal/${proposalId}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    padding: '0.4rem 0.75rem',
                                                    borderRadius: '6px',
                                                    background: theme.colors.tertiaryBg,
                                                    color: theme.colors.secondaryText,
                                                    textDecoration: 'none',
                                                    fontSize: '0.8rem',
                                                    transition: 'all 0.2s ease'
                                                }}
                                            >
                                                Dashboard <FaExternalLinkAlt size={10} />
                                            </a>

                                            {/* Quick Vote Buttons */}
                                            {isAuthenticated && acceptingVotes && (() => {
                                                const eligibility = proposalEligibility[proposalId];
                                                const votingState = quickVotingStates[proposalId];
                                                const isLoading = eligibility?.loading !== false;
                                                const eligibleCount = eligibility?.eligibleCount || 0;
                                                const totalVP = eligibility?.totalVP || 0n;
                                                const votedCount = eligibility?.votedCount || 0;
                                                const votedVP = eligibility?.votedVP || 0n;
                                                const isEnabled = !isLoading && eligibleCount > 0;

                                                const getButtonStyle = (isAdopt) => {
                                                    const baseStyle = {
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        padding: '0.4rem 0.75rem',
                                                        borderRadius: '6px',
                                                        fontSize: '0.8rem',
                                                        fontWeight: '500',
                                                        border: 'none',
                                                        cursor: isEnabled ? 'pointer' : 'default',
                                                        transition: 'all 0.2s ease'
                                                    };

                                                    if (votingState === 'voting') {
                                                        return { ...baseStyle, backgroundColor: theme.colors.tertiaryBg, color: theme.colors.mutedText };
                                                    }
                                                    if (votingState === 'success') {
                                                        return { ...baseStyle, backgroundColor: `${theme.colors.success}20`, color: theme.colors.success };
                                                    }
                                                    if (votingState === 'error') {
                                                        return { ...baseStyle, backgroundColor: `${theme.colors.error}20`, color: theme.colors.error };
                                                    }
                                                    if (!isEnabled) {
                                                        return { ...baseStyle, backgroundColor: theme.colors.tertiaryBg, color: theme.colors.mutedText, opacity: 0.5 };
                                                    }
                                                    return {
                                                        ...baseStyle,
                                                        backgroundColor: isAdopt ? `${theme.colors.success}15` : `${theme.colors.error}15`,
                                                        color: isAdopt ? theme.colors.success : theme.colors.error
                                                    };
                                                };

                                                return (
                                                    <>
                                                        <span style={{
                                                            fontSize: '0.8rem',
                                                            color: eligibleCount > 0 ? theme.colors.success : votedCount > 0 ? theme.colors.success : theme.colors.mutedText,
                                                            marginRight: '0.5rem'
                                                        }}>
                                                            {isLoading ? (
                                                                'Checking...'
                                                            ) : eligibleCount > 0 ? (
                                                                <>{eligibleCount} neuron{eligibleCount !== 1 ? 's' : ''} &bull; {formatCompactVP(totalVP)} VP</>
                                                            ) : votedCount > 0 ? (
                                                                <>Voted with {votedCount} neuron{votedCount !== 1 ? 's' : ''} &bull; {formatCompactVP(votedVP)} VP</>
                                                            ) : (
                                                                'No eligible neurons'
                                                            )}
                                                        </span>
                                                        <div style={{
                                                            width: '1px',
                                                            height: '20px',
                                                            backgroundColor: theme.colors.border,
                                                            margin: '0 0.25rem'
                                                        }} />

                                                        <button
                                                            onClick={() => isEnabled && quickVote(proposal, 1)}
                                                            disabled={!isEnabled || votingState === 'voting'}
                                                            style={getButtonStyle(true)}
                                                            title={isLoading ? 'Checking eligibility...' :
                                                                eligibleCount > 0 ? `Adopt with ${eligibleCount} neuron${eligibleCount !== 1 ? 's' : ''} (${formatCompactVP(totalVP)} VP)` :
                                                                    votedCount > 0 ? 'Already voted' : 'No eligible neurons'}
                                                        >
                                                            <FaCheck size={10} />
                                                            {isEnabled && <span>({formatCompactVP(totalVP)})</span>}
                                                        </button>

                                                        <button
                                                            onClick={() => isEnabled && quickVote(proposal, 2)}
                                                            disabled={!isEnabled || votingState === 'voting'}
                                                            style={getButtonStyle(false)}
                                                            title={isLoading ? 'Checking eligibility...' :
                                                                eligibleCount > 0 ? `Reject with ${eligibleCount} neuron${eligibleCount !== 1 ? 's' : ''} (${formatCompactVP(totalVP)} VP)` :
                                                                    votedCount > 0 ? 'Already voted' : 'No eligible neurons'}
                                                        >
                                                            <FaTimes size={10} />
                                                            {isEnabled && <span>({formatCompactVP(totalVP)})</span>}
                                                        </button>
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Load More / All Loaded */}
                    {filteredProposals.length > 0 && (
                        <div style={{
                            textAlign: 'center',
                            marginTop: '2rem',
                            padding: '1rem'
                        }}>
                            {hasMoreProposals && !allProposalsLoaded ? (
                                <button
                                    onClick={loadMore}
                                    disabled={loading || loadingAll}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        padding: '0.75rem 2rem',
                                        borderRadius: '12px',
                                        border: 'none',
                                        background: `linear-gradient(135deg, ${proposalPrimary}, ${proposalSecondary})`,
                                        color: 'white',
                                        fontSize: '0.95rem',
                                        fontWeight: '600',
                                        cursor: (loading || loadingAll) ? 'not-allowed' : 'pointer',
                                        opacity: (loading || loadingAll) ? 0.7 : 1,
                                        transition: 'all 0.3s ease',
                                        boxShadow: `0 4px 15px ${proposalPrimary}40`
                                    }}
                                >
                                    {(loading || loadingAll) ? (
                                        <>
                                            <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>&#x27F3;</span>
                                            Loading...
                                        </>
                                    ) : (
                                        <>
                                            <FaChevronDown size={14} />
                                            Load More Proposals
                                        </>
                                    )}
                                </button>
                            ) : (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '0.5rem',
                                    color: theme.colors.success,
                                    fontSize: '0.95rem',
                                    fontWeight: '500'
                                }}>
                                    <FaCheck size={14} />
                                    All {proposals.length} proposals loaded
                                </div>
                            )}
                        </div>
                    )}

                    {/* Empty State */}
                    {filteredProposals.length === 0 && !loading && (
                        <div style={{
                            textAlign: 'center',
                            padding: '4rem 2rem',
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            <div style={{
                                width: '70px',
                                height: '70px',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${proposalPrimary}30, ${proposalSecondary}20)`,
                                margin: '0 auto 1.5rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: proposalPrimary
                            }}>
                                <FaGavel size={30} />
                            </div>
                            <h3 style={{
                                color: theme.colors.primaryText,
                                fontSize: '1.25rem',
                                fontWeight: '600',
                                marginBottom: '0.5rem'
                            }}>
                                No proposals found
                            </h3>
                            <p style={{
                                color: theme.colors.secondaryText,
                                fontSize: '0.95rem'
                            }}>
                                {(searchFilter || topicFilter || statusFilter)
                                    ? 'Try adjusting your filters to see more results.'
                                    : 'There are no NNS proposals to display.'}
                            </p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default IcpProposals;
