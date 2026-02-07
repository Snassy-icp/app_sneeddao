import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useWallet } from '../contexts/WalletContext';
import Header from '../components/Header';
import { getAllSnses, fetchSnsLogo } from '../utils/SnsUtils';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { HttpAgent } from '@dfinity/agent';
import { uint8ArrayToHex, safePrincipalString } from '../utils/NeuronUtils';
import { calculateVotingPower } from '../utils/VotingPowerUtils';
import { isProposalAcceptingVotes, getProposalStatus, getVotingTimeRemaining } from '../utils/ProposalUtils';
import { FaGavel, FaChevronDown, FaChevronRight, FaCheck, FaTimes, FaClock, FaSync, FaVoteYea, FaBrain, FaExternalLinkAlt, FaFilter } from 'react-icons/fa';

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

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.proposal-card-animate {
    animation: fadeInUp 0.4s ease-out forwards;
}
`;

// Accent colors
const proposalPrimary = '#8b5cf6'; // Violet
const proposalAccent = '#10b981'; // Green for voting

function ActiveProposals() {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const { neuronCache } = useWallet();
    
    // State
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [snsProposalsData, setSnsProposalsData] = useState([]); // [{ snsInfo, proposals, neurons, nervousSystemParams, logo }]
    const [expandedSns, setExpandedSns] = useState(new Set());
    const [proposalEligibility, setProposalEligibility] = useState({}); // { snsRoot_proposalId: { loading, eligibleCount, totalVP } }
    const [quickVotingStates, setQuickVotingStates] = useState({}); // { snsRoot_proposalId: 'idle' | 'voting' | 'success' | 'error' }
    const [votedProposals, setVotedProposals] = useState(new Set());
    const [refreshing, setRefreshing] = useState(false);
    const [snsLogos, setSnsLogos] = useState({});
    const hasFetchedRef = useRef(false);
    
    // Get all SNSes with user's neurons that have voting power
    const getRelevantSnses = useCallback(() => {
        if (!neuronCache || neuronCache.size === 0) return [];
        
        const allSnses = getAllSnses();
        const relevant = [];
        
        for (const sns of allSnses) {
            const govId = sns.canisters?.governance;
            if (!govId) continue;
            
            const neurons = neuronCache.get(govId);
            if (!neurons || neurons.length === 0) continue;
            
            // Check if user has any neurons with hotkey permission
            const userPrincipal = identity?.getPrincipal()?.toString();
            if (!userPrincipal) continue;
            
            const hotkeyNeurons = neurons.filter(neuron => {
                return neuron.permissions?.some(p => {
                    const permPrincipal = safePrincipalString(p.principal);
                    if (!permPrincipal || permPrincipal !== userPrincipal) return false;
                    const permTypes = p.permission_type || [];
                    return permTypes.includes(4); // Vote permission
                });
            });
            
            if (hotkeyNeurons.length > 0) {
                relevant.push({ sns, neurons: hotkeyNeurons });
            }
        }
        
        return relevant;
    }, [neuronCache, identity]);

    // Fetch proposals for all relevant SNSes
    const fetchAllProposals = useCallback(async () => {
        if (!identity || !isAuthenticated) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError('');

        try {
            const relevantSnses = getRelevantSnses();
            
            if (relevantSnses.length === 0) {
                setSnsProposalsData([]);
                setLoading(false);
                return;
            }

            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ host, identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }

            const results = await Promise.all(relevantSnses.map(async ({ sns, neurons }) => {
                try {
                    const govId = sns.canisters.governance;
                    
                    // Create governance actor
                    const snsGovActor = createSnsGovernanceActor(govId, {
                        agentOptions: { identity }
                    });
                    
                    // Fetch nervous system parameters for VP calculation
                    let nervousSystemParams = null;
                    try {
                        nervousSystemParams = await snsGovActor.get_nervous_system_parameters(null);
                    } catch (e) {
                        console.warn(`Failed to get params for ${sns.name}:`, e);
                    }

                    const response = await snsGovActor.list_proposals({
                        limit: 50,
                        before_proposal: [],
                        include_reward_status: [],
                        exclude_type: [],
                        include_status: [],
                        include_topics: []
                    });

                    // Filter to only proposals accepting votes
                    const activeProposals = response.proposals.filter(p => isProposalAcceptingVotes(p));
                    
                    // Fetch logo
                    let logo = snsLogos[sns.rootCanisterId];
                    if (!logo) {
                        try {
                            logo = await fetchSnsLogo(govId, agent);
                            setSnsLogos(prev => ({ ...prev, [sns.rootCanisterId]: logo }));
                        } catch (e) {
                            // Ignore logo errors
                        }
                    }

                    return {
                        snsInfo: sns,
                        proposals: activeProposals,
                        neurons,
                        nervousSystemParams,
                        logo
                    };
                } catch (err) {
                    console.error(`Error fetching proposals for ${sns.name}:`, err);
                    return null;
                }
            }));

            // Filter out nulls and SNSes with no active proposals
            const validResults = results.filter(r => r && r.proposals.length > 0);
            
            // Sort by number of votable proposals (most first)
            validResults.sort((a, b) => b.proposals.length - a.proposals.length);
            
            setSnsProposalsData(validResults);
            
            // Expand all sections by default
            setExpandedSns(new Set(validResults.map(r => r.snsInfo.rootCanisterId)));
            
        } catch (err) {
            console.error('Error fetching proposals:', err);
            setError('Failed to fetch proposals');
        } finally {
            setLoading(false);
        }
    }, [identity, isAuthenticated, getRelevantSnses, snsLogos]);

    // Check eligibility for proposals
    useEffect(() => {
        if (snsProposalsData.length === 0) return;

        const checkEligibility = async () => {
            const updates = {};
            const userPrincipal = identity?.getPrincipal()?.toString();

            for (const { snsInfo, proposals, neurons, nervousSystemParams } of snsProposalsData) {
                for (const proposal of proposals) {
                    const proposalId = proposal.id[0]?.id?.toString();
                    const key = `${snsInfo.rootCanisterId}_${proposalId}`;
                    
                    if (votedProposals.has(key)) {
                        updates[key] = { loading: false, eligibleCount: 0, totalVP: 0 };
                        continue;
                    }

                    let eligibleCount = 0;
                    let totalVP = 0;

                    for (const neuron of neurons) {
                        // Check if user has vote permission
                        const hasVotePerm = neuron.permissions?.some(p => {
                            const permPrincipal = safePrincipalString(p.principal);
                            if (!permPrincipal || permPrincipal !== userPrincipal) return false;
                            const permTypes = p.permission_type || [];
                            return permTypes.includes(4);
                        });
                        if (!hasVotePerm) continue;

                        // Calculate voting power
                        const votingPower = nervousSystemParams ? 
                            calculateVotingPower(neuron, nervousSystemParams) : 0;
                        if (votingPower === 0) continue;

                        // Check if already voted
                        const neuronIdHex = uint8ArrayToHex(neuron.id?.[0]?.id);
                        const ballot = proposal.ballots?.find(([id, _]) => id === neuronIdHex);
                        
                        if (ballot && ballot[1]) {
                            const ballotData = ballot[1];
                            const hasVoted = ballotData.cast_timestamp_seconds && Number(ballotData.cast_timestamp_seconds) > 0;
                            if (hasVoted) continue;
                        }

                        eligibleCount++;
                        totalVP += votingPower;
                    }

                    updates[key] = { loading: false, eligibleCount, totalVP };
                }
            }

            setProposalEligibility(updates);
        };

        checkEligibility();
    }, [snsProposalsData, identity, votedProposals]);

    // Initial fetch - only once when neurons are available
    useEffect(() => {
        if (isAuthenticated && identity && neuronCache.size > 0 && !hasFetchedRef.current) {
            hasFetchedRef.current = true;
            fetchAllProposals();
        } else if (!isAuthenticated) {
            hasFetchedRef.current = false;
            setLoading(false);
        }
    }, [isAuthenticated, identity, neuronCache.size, fetchAllProposals]);

    // Quick vote function
    const quickVote = useCallback(async (snsInfo, proposal, neurons, nervousSystemParams, vote) => {
        const proposalId = proposal.id[0]?.id?.toString();
        const key = `${snsInfo.rootCanisterId}_${proposalId}`;
        
        if (!proposalId || !identity) return;

        setQuickVotingStates(prev => ({ ...prev, [key]: 'voting' }));

        try {
            const snsGovActor = createSnsGovernanceActor(snsInfo.canisters.governance, {
                agentOptions: { identity }
            });

            const userPrincipal = identity.getPrincipal().toString();

            // Filter eligible neurons
            const eligibleNeurons = neurons.filter(neuron => {
                const hasVotePerm = neuron.permissions?.some(p => {
                    const permPrincipal = safePrincipalString(p.principal);
                    if (!permPrincipal || permPrincipal !== userPrincipal) return false;
                    const permTypes = p.permission_type || [];
                    return permTypes.includes(4);
                });
                if (!hasVotePerm) return false;

                const votingPower = nervousSystemParams ? 
                    calculateVotingPower(neuron, nervousSystemParams) : 0;
                if (votingPower === 0) return false;

                const neuronIdHex = uint8ArrayToHex(neuron.id?.[0]?.id);
                const ballot = proposal.ballots?.find(([id, _]) => id === neuronIdHex);
                
                if (ballot && ballot[1]) {
                    const ballotData = ballot[1];
                    const hasVoted = ballotData.cast_timestamp_seconds && Number(ballotData.cast_timestamp_seconds) > 0;
                    if (hasVoted) return false;
                }

                return true;
            });

            if (eligibleNeurons.length === 0) {
                setQuickVotingStates(prev => ({ ...prev, [key]: 'error' }));
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
                                proposal: [{ id: BigInt(proposalId) }]
                            }
                        }]
                    };

                    await snsGovActor.manage_neuron(manageNeuronRequest);
                    successCount++;
                } catch (e) {
                    console.error('Vote error:', e);
                }
            }

            if (successCount > 0) {
                setQuickVotingStates(prev => ({ ...prev, [key]: 'success' }));
                setVotedProposals(prev => new Set([...prev, key]));
                setProposalEligibility(prev => ({ 
                    ...prev, 
                    [key]: { loading: false, eligibleCount: 0, totalVP: 0 } 
                }));
            } else {
                setQuickVotingStates(prev => ({ ...prev, [key]: 'error' }));
            }

            setTimeout(() => {
                setQuickVotingStates(prev => ({ ...prev, [key]: 'idle' }));
            }, 2000);

        } catch (err) {
            console.error('Vote error:', err);
            setQuickVotingStates(prev => ({ ...prev, [key]: 'error' }));
        }
    }, [identity]);

    // Format VP for display
    const formatCompactVP = (vp) => {
        if (vp >= 1e12) return `${(vp / 1e12).toFixed(1)}T`;
        if (vp >= 1e9) return `${(vp / 1e9).toFixed(1)}B`;
        if (vp >= 1e6) return `${(vp / 1e6).toFixed(1)}M`;
        if (vp >= 1e3) return `${(vp / 1e3).toFixed(1)}K`;
        return vp.toFixed(0);
    };

    // Toggle SNS section
    const toggleSns = (snsRootId) => {
        setExpandedSns(prev => {
            const next = new Set(prev);
            if (next.has(snsRootId)) {
                next.delete(snsRootId);
            } else {
                next.add(snsRootId);
            }
            return next;
        });
    };

    // Refresh handler
    const handleRefresh = async () => {
        setRefreshing(true);
        setVotedProposals(new Set());
        await fetchAllProposals();
        setRefreshing(false);
    };

    // Count total votable proposals
    const totalVotableCount = useMemo(() => {
        let count = 0;
        for (const { snsInfo, proposals } of snsProposalsData) {
            for (const proposal of proposals) {
                const proposalId = proposal.id[0]?.id?.toString();
                const key = `${snsInfo.rootCanisterId}_${proposalId}`;
                const elig = proposalEligibility[key];
                if (elig && elig.eligibleCount > 0) {
                    count++;
                }
            }
        }
        return count;
    }, [snsProposalsData, proposalEligibility]);

    // Get status style
    const getStatusStyle = (status) => {
        if (status.includes('Executed')) {
            return { color: '#10b981', bg: '#10b98115', icon: <FaCheck size={10} /> };
        }
        if (status.includes('Failed') || status.includes('Rejected')) {
            return { color: '#ef4444', bg: '#ef444415', icon: <FaTimes size={10} /> };
        }
        if (status.includes('Open') || status.includes('Voting')) {
            return { color: proposalAccent, bg: `${proposalAccent}15`, icon: <FaVoteYea size={10} /> };
        }
        return { color: theme.colors.secondaryText, bg: theme.colors.tertiaryBg, icon: null };
    };

    return (
        <div className='page-container'>
            <style>{customStyles}</style>
            <Header />
            
            <main style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${proposalPrimary}15 50%, ${proposalAccent}10 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    padding: '2rem 1.5rem',
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    <div style={{
                        position: 'absolute', top: '-50%', right: '-10%', width: '400px', height: '400px',
                        background: `radial-gradient(circle, ${proposalPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%', pointerEvents: 'none'
                    }} />
                    
                    <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
                            <div style={{
                                width: '56px', height: '56px',
                                borderRadius: '14px',
                                background: `linear-gradient(135deg, ${proposalPrimary}, ${proposalAccent})`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                boxShadow: `0 4px 20px ${proposalPrimary}40`
                            }}>
                                <FaGavel size={24} color="white" />
                            </div>
                            <div>
                                <h1 style={{ 
                                    color: theme.colors.primaryText, 
                                    fontSize: '1.75rem', 
                                    fontWeight: '700', 
                                    margin: 0 
                                }}>
                                    Active Proposals
                                </h1>
                                <p style={{ color: theme.colors.secondaryText, fontSize: '0.95rem', margin: '0.25rem 0 0 0' }}>
                                    Vote on open proposals across all your SNS neurons
                                </p>
                            </div>
                        </div>
                        
                        {/* Stats Row */}
                        {!loading && snsProposalsData.length > 0 && (
                            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                                <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                    <span style={{ color: proposalPrimary, fontWeight: '600' }}>{snsProposalsData.length}</span> SNS{snsProposalsData.length !== 1 ? 'es' : ''} with proposals
                                </div>
                                <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                    <span style={{ color: proposalAccent, fontWeight: '600' }}>
                                        {snsProposalsData.reduce((sum, d) => sum + d.proposals.length, 0)}
                                    </span> active proposal{snsProposalsData.reduce((sum, d) => sum + d.proposals.length, 0) !== 1 ? 's' : ''}
                                </div>
                                {totalVotableCount > 0 && (
                                    <div style={{ 
                                        color: proposalAccent, 
                                        fontSize: '0.9rem',
                                        background: `${proposalAccent}15`,
                                        padding: '0.25rem 0.75rem',
                                        borderRadius: '20px',
                                        fontWeight: '500'
                                    }}>
                                        <FaVoteYea size={12} style={{ marginRight: '0.35rem' }} />
                                        {totalVotableCount} you can vote on
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div style={{ maxWidth: '900px', margin: '0 auto', padding: '1.5rem' }}>
                    {/* Refresh Button */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        marginBottom: '1rem'
                    }}>
                        <button
                            onClick={handleRefresh}
                            disabled={loading || refreshing}
                            style={{
                                background: theme.colors.tertiaryBg,
                                color: theme.colors.primaryText,
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '8px',
                                padding: '0.5rem 1rem',
                                cursor: loading || refreshing ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                fontSize: '0.85rem',
                                fontWeight: '500',
                                opacity: loading || refreshing ? 0.6 : 1
                            }}
                        >
                            <FaSync size={12} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
                            Refresh
                        </button>
                    </div>

                    {/* Not Authenticated */}
                    {!isAuthenticated && (
                        <div style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '3rem',
                            textAlign: 'center',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            <FaGavel size={48} color={theme.colors.mutedText} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                            <div style={{ color: theme.colors.secondaryText, fontSize: '1rem' }}>
                                Please log in to see your active proposals
                            </div>
                        </div>
                    )}

                    {/* Loading State */}
                    {isAuthenticated && loading && (
                        <div style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '3rem',
                            textAlign: 'center',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            <div style={{
                                width: '48px', height: '48px',
                                border: `3px solid ${proposalPrimary}30`,
                                borderTop: `3px solid ${proposalPrimary}`,
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite',
                                margin: '0 auto 1.5rem'
                            }} />
                            <div style={{ color: theme.colors.primaryText, fontSize: '1rem' }}>
                                Loading proposals from your SNS neurons...
                            </div>
                        </div>
                    )}

                    {/* Error State */}
                    {error && (
                        <div style={{
                            background: `linear-gradient(135deg, ${theme.colors.error}15, ${theme.colors.error}08)`,
                            border: `1px solid ${theme.colors.error}30`,
                            borderRadius: '12px',
                            padding: '1rem',
                            marginBottom: '1rem'
                        }}>
                            <span style={{ color: theme.colors.error }}>⚠️ {error}</span>
                        </div>
                    )}

                    {/* Empty State */}
                    {isAuthenticated && !loading && snsProposalsData.length === 0 && (
                        <div style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '3rem',
                            textAlign: 'center',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            <FaBrain size={48} color={theme.colors.mutedText} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                            <div style={{ color: theme.colors.secondaryText, fontSize: '1rem' }}>
                                No active proposals found
                            </div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginTop: '0.5rem' }}>
                                Either you have no hotkey neurons, or there are no open proposals for the SNSes you participate in
                            </div>
                        </div>
                    )}

                    {/* SNS Sections */}
                    {isAuthenticated && !loading && snsProposalsData.map(({ snsInfo, proposals, neurons, nervousSystemParams, logo }) => {
                        const isExpanded = expandedSns.has(snsInfo.rootCanisterId);
                        
                        // Count votable proposals for this SNS
                        const votableCount = proposals.filter(p => {
                            const key = `${snsInfo.rootCanisterId}_${p.id[0]?.id?.toString()}`;
                            const elig = proposalEligibility[key];
                            return elig && elig.eligibleCount > 0;
                        }).length;
                        
                        return (
                            <div 
                                key={snsInfo.rootCanisterId}
                                style={{
                                    background: theme.colors.secondaryBg,
                                    borderRadius: '16px',
                                    border: `1px solid ${theme.colors.border}`,
                                    marginBottom: '1rem',
                                    overflow: 'hidden'
                                }}
                            >
                                {/* SNS Header */}
                                <div 
                                    onClick={() => toggleSns(snsInfo.rootCanisterId)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '1rem',
                                        padding: '1rem 1.25rem',
                                        cursor: 'pointer',
                                        background: isExpanded ? `${proposalPrimary}08` : 'transparent',
                                        borderBottom: isExpanded ? `1px solid ${theme.colors.border}` : 'none',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    {/* SNS Logo */}
                                    <div style={{
                                        width: '40px', height: '40px',
                                        borderRadius: '10px',
                                        overflow: 'hidden',
                                        flexShrink: 0,
                                        background: theme.colors.tertiaryBg
                                    }}>
                                        {logo ? (
                                            <img src={logo} alt={snsInfo.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : (
                                            <div style={{
                                                width: '100%', height: '100%',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                background: `linear-gradient(135deg, ${proposalPrimary}, ${proposalAccent})`,
                                                color: 'white', fontWeight: '700', fontSize: '1rem'
                                            }}>
                                                {snsInfo.name?.charAt(0) || '?'}
                                            </div>
                                        )}
                                    </div>
                                    
                                    {/* SNS Name & Stats */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ 
                                            color: theme.colors.primaryText, 
                                            fontWeight: '600', 
                                            fontSize: '1.1rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem'
                                        }}>
                                            {snsInfo.name}
                                            <span style={{
                                                fontSize: '0.8rem',
                                                fontWeight: '500',
                                                color: theme.colors.secondaryText,
                                                background: theme.colors.tertiaryBg,
                                                padding: '2px 8px',
                                                borderRadius: '10px'
                                            }}>
                                                {proposals.length} proposal{proposals.length !== 1 ? 's' : ''}
                                            </span>
                                            {votableCount > 0 && (
                                                <span style={{
                                                    fontSize: '0.8rem',
                                                    fontWeight: '500',
                                                    color: proposalAccent,
                                                    background: `${proposalAccent}15`,
                                                    padding: '2px 8px',
                                                    borderRadius: '10px'
                                                }}>
                                                    {votableCount} votable
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ 
                                            color: theme.colors.mutedText, 
                                            fontSize: '0.8rem',
                                            marginTop: '0.15rem'
                                        }}>
                                            {neurons.length} neuron{neurons.length !== 1 ? 's' : ''} with vote access
                                        </div>
                                    </div>
                                    
                                    {/* Expand/Collapse Icon */}
                                    <div style={{ color: theme.colors.mutedText }}>
                                        {isExpanded ? <FaChevronDown size={14} /> : <FaChevronRight size={14} />}
                                    </div>
                                </div>
                                
                                {/* Proposals List */}
                                {isExpanded && (
                                    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                        {proposals.map((proposal, index) => {
                                            const proposalId = proposal.id[0]?.id?.toString();
                                            const key = `${snsInfo.rootCanisterId}_${proposalId}`;
                                            const status = getProposalStatus(proposal);
                                            const statusStyle = getStatusStyle(status);
                                            const eligibility = proposalEligibility[key];
                                            const votingState = quickVotingStates[key];
                                            const isLoading = !eligibility;
                                            const eligibleCount = eligibility?.eligibleCount || 0;
                                            const totalVP = eligibility?.totalVP || 0;
                                            const isEnabled = !isLoading && eligibleCount > 0;
                                            
                                            return (
                                                <div
                                                    key={proposalId}
                                                    className="proposal-card-animate"
                                                    style={{
                                                        background: theme.colors.tertiaryBg,
                                                        borderRadius: '12px',
                                                        padding: '1rem',
                                                        border: `1px solid ${theme.colors.border}`,
                                                        animationDelay: `${index * 0.05}s`,
                                                        opacity: 0
                                                    }}
                                                >
                                                    {/* Top Row: ID, Status, Time */}
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.5rem',
                                                        marginBottom: '0.5rem',
                                                        flexWrap: 'wrap'
                                                    }}>
                                                        <Link 
                                                            to={`/proposal?proposalid=${proposalId}&sns=${snsInfo.rootCanisterId}`}
                                                            style={{
                                                                color: proposalPrimary,
                                                                fontWeight: '600',
                                                                fontSize: '0.85rem',
                                                                textDecoration: 'none'
                                                            }}
                                                        >
                                                            #{proposalId}
                                                        </Link>
                                                        
                                                        <span style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '4px',
                                                            padding: '2px 8px',
                                                            borderRadius: '12px',
                                                            background: statusStyle.bg,
                                                            color: statusStyle.color,
                                                            fontSize: '0.75rem',
                                                            fontWeight: '500'
                                                        }}>
                                                            {statusStyle.icon}
                                                            {status}
                                                        </span>
                                                        
                                                        <span style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '4px',
                                                            padding: '2px 8px',
                                                            borderRadius: '12px',
                                                            background: `${proposalAccent}15`,
                                                            color: proposalAccent,
                                                            fontSize: '0.75rem',
                                                            fontWeight: '500'
                                                        }}>
                                                            <FaClock size={9} />
                                                            {getVotingTimeRemaining(proposal)}
                                                        </span>
                                                    </div>
                                                    
                                                    {/* Title */}
                                                    <Link 
                                                        to={`/proposal?proposalid=${proposalId}&sns=${snsInfo.rootCanisterId}`}
                                                        style={{
                                                            color: theme.colors.primaryText,
                                                            textDecoration: 'none',
                                                            fontSize: '1rem',
                                                            fontWeight: '600',
                                                            lineHeight: '1.4',
                                                            display: 'block',
                                                            marginBottom: '0.75rem'
                                                        }}
                                                    >
                                                        {proposal.proposal[0]?.title || 'Untitled Proposal'}
                                                    </Link>
                                                    
                                                    {/* Vote Buttons */}
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        gap: '0.75rem',
                                                        flexWrap: 'wrap'
                                                    }}>
                                                        {/* Eligibility Info */}
                                                        <div style={{ 
                                                            fontSize: '0.8rem', 
                                                            color: eligibleCount > 0 ? proposalAccent : theme.colors.mutedText 
                                                        }}>
                                                            {isLoading ? (
                                                                <span>Checking eligibility...</span>
                                                            ) : eligibleCount > 0 ? (
                                                                <span>
                                                                    <FaBrain size={10} style={{ marginRight: '4px' }} />
                                                                    {eligibleCount} neuron{eligibleCount !== 1 ? 's' : ''} • {formatCompactVP(totalVP)} VP
                                                                </span>
                                                            ) : (
                                                                <span>Already voted or no eligible neurons</span>
                                                            )}
                                                        </div>
                                                        
                                                        {/* Vote Buttons */}
                                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                            {votingState === 'voting' ? (
                                                                <span style={{ 
                                                                    color: theme.colors.secondaryText, 
                                                                    fontSize: '0.85rem',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '0.5rem'
                                                                }}>
                                                                    <FaSync size={12} style={{ animation: 'spin 1s linear infinite' }} />
                                                                    Voting...
                                                                </span>
                                                            ) : votingState === 'success' ? (
                                                                <span style={{ 
                                                                    color: proposalAccent, 
                                                                    fontSize: '0.85rem',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '0.5rem'
                                                                }}>
                                                                    <FaCheck size={12} />
                                                                    Voted!
                                                                </span>
                                                            ) : votingState === 'error' ? (
                                                                <span style={{ 
                                                                    color: theme.colors.error, 
                                                                    fontSize: '0.85rem' 
                                                                }}>
                                                                    Vote failed
                                                                </span>
                                                            ) : (
                                                                <>
                                                                    <button
                                                                        onClick={() => isEnabled && quickVote(snsInfo, proposal, neurons, nervousSystemParams, 1)}
                                                                        disabled={!isEnabled}
                                                                        style={{
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '4px',
                                                                            padding: '0.35rem 0.75rem',
                                                                            borderRadius: '6px',
                                                                            border: 'none',
                                                                            background: isEnabled ? proposalAccent : theme.colors.tertiaryBg,
                                                                            color: isEnabled ? 'white' : theme.colors.mutedText,
                                                                            cursor: isEnabled ? 'pointer' : 'not-allowed',
                                                                            fontSize: '0.8rem',
                                                                            fontWeight: '500',
                                                                            opacity: isEnabled ? 1 : 0.5
                                                                        }}
                                                                        title={isEnabled ? `Adopt with ${eligibleCount} neuron${eligibleCount !== 1 ? 's' : ''}` : 'No eligible neurons'}
                                                                    >
                                                                        <FaCheck size={10} />
                                                                        Adopt
                                                                    </button>
                                                                    
                                                                    <button
                                                                        onClick={() => isEnabled && quickVote(snsInfo, proposal, neurons, nervousSystemParams, 2)}
                                                                        disabled={!isEnabled}
                                                                        style={{
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '4px',
                                                                            padding: '0.35rem 0.75rem',
                                                                            borderRadius: '6px',
                                                                            border: 'none',
                                                                            background: isEnabled ? '#ef4444' : theme.colors.tertiaryBg,
                                                                            color: isEnabled ? 'white' : theme.colors.mutedText,
                                                                            cursor: isEnabled ? 'pointer' : 'not-allowed',
                                                                            fontSize: '0.8rem',
                                                                            fontWeight: '500',
                                                                            opacity: isEnabled ? 1 : 0.5
                                                                        }}
                                                                        title={isEnabled ? `Reject with ${eligibleCount} neuron${eligibleCount !== 1 ? 's' : ''}` : 'No eligible neurons'}
                                                                    >
                                                                        <FaTimes size={10} />
                                                                        Reject
                                                                    </button>
                                                                </>
                                                            )}
                                                            
                                                            <Link
                                                                to={`/proposal?proposalid=${proposalId}&sns=${snsInfo.rootCanisterId}`}
                                                                style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '4px',
                                                                    padding: '0.35rem 0.75rem',
                                                                    borderRadius: '6px',
                                                                    background: theme.colors.secondaryBg,
                                                                    color: theme.colors.secondaryText,
                                                                    textDecoration: 'none',
                                                                    fontSize: '0.8rem',
                                                                    fontWeight: '500',
                                                                    border: `1px solid ${theme.colors.border}`
                                                                }}
                                                            >
                                                                <FaExternalLinkAlt size={10} />
                                                                Details
                                                            </Link>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </main>
        </div>
    );
}

export default ActiveProposals;
