import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useWalletOptional } from '../contexts/WalletContext';
import {
    getNnsNeuronId, getNnsNeuronVotingPower, getNnsNeuronDissolveState,
    getNnsBallotForNeuron, formatNnsVote, voteOnNnsProposal,
    hasNnsVotingAccess, isNnsProposalAcceptingVotes, formatIcpE8s,
    NNS_GOVERNANCE_CANISTER_ID, fetchUserNnsNeurons
} from '../utils/NnsUtils';
import { FaKey, FaCheckCircle, FaTimesCircle, FaVoteYea, FaChevronDown, FaChevronUp, FaInfoCircle, FaCopy, FaSync } from 'react-icons/fa';
import InfoModal from './InfoModal';

// Accent colors - matching Proposal page
const accentPrimary = '#6366f1';
const accentSecondary = '#8b5cf6';

const IcpHotkeyNeurons = ({
    proposalData = null,         // NNS ProposalInfo object
    currentProposalId = null,    // proposal ID (BigInt or number)
    onVoteSuccess = null,        // callback after voting
    inlineInProposal = false,    // compact inline mode for proposal detail page
    showExpandButton = true,
    defaultExpanded = false,
    title = "Your ICP Neurons",
}) => {
    const { theme } = useTheme();
    const { isAuthenticated, identity } = useAuth();
    const walletContext = useWalletOptional();

    const [neurons, setNeurons] = useState([]);
    const [neuronsLoading, setNeuronsLoading] = useState(false);
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const [neuronsListExpanded, setNeuronsListExpanded] = useState(false);
    const [voteAllState, setVoteAllState] = useState('idle');
    const [votingStates, setVotingStates] = useState({});
    const [copiedPrincipal, setCopiedPrincipal] = useState(false);
    const [infoModal, setInfoModal] = useState({ show: false, title: '', message: '', type: 'info' });
    const [pendingVoteSuccessCallback, setPendingVoteSuccessCallback] = useState(null);

    const infoTooltip = "These are your NNS (ICP) neurons where you are the controller or have been added as a hotkey. You can vote on NNS proposals directly from here.";

    const showInfoModal = (title, message, type = 'info', onCloseCallback = null) => {
        setInfoModal({ show: true, title, message, type });
        setPendingVoteSuccessCallback(onCloseCallback);
    };
    const closeInfoModal = () => {
        const cb = pendingVoteSuccessCallback;
        setInfoModal(prev => ({ ...prev, show: false }));
        setPendingVoteSuccessCallback(null);
        if (typeof cb === 'function') cb();
    };

    // Load neurons from WalletContext cache or direct fetch
    useEffect(() => {
        const loadNeurons = async () => {
            if (!isAuthenticated || !identity) return;
            setNeuronsLoading(true);
            try {
                if (walletContext?.getNeuronsForGovernance) {
                    const cached = await walletContext.getNeuronsForGovernance(NNS_GOVERNANCE_CANISTER_ID);
                    setNeurons(cached || []);
                } else {
                    const fetched = await fetchUserNnsNeurons(identity);
                    setNeurons(fetched || []);
                }
            } catch (err) {
                console.error('Error loading NNS neurons:', err);
                setNeurons([]);
            } finally {
                setNeuronsLoading(false);
            }
        };
        if (isAuthenticated && identity) loadNeurons();
    }, [isAuthenticated, identity]);

    const refreshNeurons = async () => {
        setNeuronsLoading(true);
        try {
            if (walletContext?.refreshNeuronsForGovernance) {
                await walletContext.refreshNeuronsForGovernance(NNS_GOVERNANCE_CANISTER_ID);
                const refreshed = await walletContext.getNeuronsForGovernance(NNS_GOVERNANCE_CANISTER_ID);
                setNeurons(refreshed || []);
            } else {
                const fetched = await fetchUserNnsNeurons(identity);
                setNeurons(fetched || []);
            }
        } catch (err) {
            console.error('Error refreshing NNS neurons:', err);
        } finally {
            setNeuronsLoading(false);
        }
    };

    const formatVotingPowerDisplay = (vpBigInt) => {
        return (Number(vpBigInt) / 1e8).toFixed(2);
    };

    const getDissolveStateDisplay = (neuron) => {
        const ds = getNnsNeuronDissolveState(neuron);
        if (ds.state === 'Not Dissolving') {
            return `${ds.days} days`;
        } else if (ds.state === 'Dissolving') {
            return ds.dissolveDate
                ? `Dissolving (${ds.days}d left)`
                : `Dissolving (${ds.days} days)`;
        } else if (ds.state === 'Dissolved') {
            return 'Dissolved';
        }
        return 'Unknown';
    };

    const shortNeuronId = (neuronId) => {
        if (!neuronId) return '--';
        const s = neuronId.toString();
        if (s.length <= 10) return s;
        return `${s.slice(0, 6)}...${s.slice(-4)}`;
    };

    const getPrincipalStr = () => {
        try {
            return identity?.getPrincipal()?.toText() || '';
        } catch {
            return '';
        }
    };

    const getAllNeurons = () => {
        return neurons || [];
    };

    const getVotableNeurons = () => {
        const principalStr = getPrincipalStr();
        if (!principalStr) return [];
        return getAllNeurons().filter(n => hasNnsVotingAccess(n, principalStr));
    };

    const getNeuronVote = (neuronId) => {
        if (!proposalData?.ballots || !neuronId) return null;
        const ballot = getNnsBallotForNeuron(proposalData.ballots, neuronId);
        if (ballot && Number(ballot.vote) !== 0) {
            return ballot;
        }
        return null;
    };

    const formatVote = (voteNumber) => {
        const v = Number(voteNumber);
        switch (v) {
            case 1: return { text: 'Adopt', color: theme.colors.success };
            case 2: return { text: 'Reject', color: theme.colors.error };
            default: return { text: 'Not Voted', color: theme.colors.mutedText };
        }
    };

    const isProposalOpenForVoting = () => {
        return isNnsProposalAcceptingVotes(proposalData);
    };

    const getEligibleNeuronsInfo = () => {
        if (!proposalData || !currentProposalId) return { count: 0, totalVP: 0n };

        const principalStr = getPrincipalStr();
        if (!principalStr) return { count: 0, totalVP: 0n };

        let count = 0;
        let totalVP = 0n;

        for (const neuron of getAllNeurons()) {
            if (!hasNnsVotingAccess(neuron, principalStr)) continue;

            const neuronVP = getNnsNeuronVotingPower(neuron);
            if (neuronVP === 0n) continue;

            const neuronId = getNnsNeuronId(neuron);
            const existingVote = getNeuronVote(neuronId);
            if (existingVote) continue;

            count++;
            totalVP += neuronVP;
        }
        return { count, totalVP };
    };

    const hasEligibleNeurons = () => {
        return getEligibleNeuronsInfo().count > 0;
    };

    const voteWithNeuron = async (neuronId, vote, opts = {}) => {
        const { showErrorModal = true, skipRefreshAndCallback = false } = typeof opts === 'boolean' ? { showErrorModal: opts } : opts;
        if (!identity || !currentProposalId || !neuronId) return 'error';

        const neuronIdStr = neuronId.toString();
        setVotingStates(prev => ({ ...prev, [neuronIdStr]: 'voting' }));

        try {
            const result = await voteOnNnsProposal(identity, neuronId, currentProposalId, vote);

            if (result.success) {
                setVotingStates(prev => ({ ...prev, [neuronIdStr]: 'success' }));
                if (!skipRefreshAndCallback) {
                    const doRefresh = () => {
                        refreshNeurons();
                        if (onVoteSuccess) onVoteSuccess();
                    };
                    showInfoModal('Vote submitted', 'Successfully voted with 1 neuron!', 'success', doRefresh);
                }
                return 'success';
            } else {
                throw new Error(result.error || 'Voting failed');
            }
        } catch (error) {
            console.error('Error voting:', error);
            setVotingStates(prev => ({ ...prev, [neuronIdStr]: 'error' }));
            if (showErrorModal) showInfoModal('Voting failed', error.message, 'error');
            return 'error';
        }
    };

    const voteWithAllNeurons = async (vote) => {
        if (!proposalData || !currentProposalId) {
            showInfoModal('Error', 'Missing required data for voting', 'error');
            return;
        }

        setVoteAllState('voting');
        try {
            const principalStr = getPrincipalStr();
            const allNeurons = getAllNeurons();

            const eligibleNeurons = allNeurons.filter(neuron => {
                if (!hasNnsVotingAccess(neuron, principalStr)) return false;

                const neuronVP = getNnsNeuronVotingPower(neuron);
                if (neuronVP === 0n) return false;

                const neuronId = getNnsNeuronId(neuron);
                const existingVote = getNeuronVote(neuronId);
                if (existingVote) return false;

                return true;
            });

            if (eligibleNeurons.length === 0) {
                const neuronsWithAccess = allNeurons.filter(n => hasNnsVotingAccess(n, principalStr)).length;
                const neuronsAlreadyVoted = allNeurons.filter(n => {
                    const nid = getNnsNeuronId(n);
                    return getNeuronVote(nid) !== null;
                }).length;

                setVoteAllState('idle');
                showInfoModal('No eligible neurons', `No eligible neurons found for voting.\n\nTotal neurons: ${allNeurons.length}\nNeurons with voting access: ${neuronsWithAccess}\nNeurons that already voted: ${neuronsAlreadyVoted}\nEligible neurons: ${eligibleNeurons.length}`, 'warning');
                return;
            }

            let successfulVotes = 0;
            let failedVotes = 0;

            for (const neuron of eligibleNeurons) {
                const neuronId = getNnsNeuronId(neuron);
                const result = await voteWithNeuron(neuronId, vote, { showErrorModal: false, skipRefreshAndCallback: true });
                if (result === 'success') successfulVotes++;
                else failedVotes++;
            }

            if (successfulVotes > 0) {
                setVoteAllState('success');
                const doRefresh = async () => {
                    await refreshNeurons();
                    if (onVoteSuccess) onVoteSuccess();
                };
                showInfoModal(
                    'Vote submitted',
                    `Successfully voted with ${successfulVotes} neuron(s)!${failedVotes > 0 ? ` ${failedVotes} vote(s) failed.` : ''}`,
                    'success',
                    doRefresh
                );
                setTimeout(() => setVoteAllState('idle'), 2000);
            } else if (failedVotes > 0) {
                setVoteAllState('error');
                showInfoModal('Voting failed', `All ${failedVotes} vote(s) failed.`, 'error');
                setTimeout(() => setVoteAllState('idle'), 3000);
            } else {
                setVoteAllState('idle');
            }
        } catch (error) {
            console.error('Error voting with all neurons:', error);
            setVoteAllState('error');
            showInfoModal('Error', 'Error voting with all neurons: ' + error.message, 'error');
            setTimeout(() => setVoteAllState('idle'), 3000);
        }
    };

    const copyPrincipal = () => {
        if (identity && identity.getPrincipal) {
            navigator.clipboard.writeText(identity.getPrincipal().toText());
            setCopiedPrincipal(true);
            setTimeout(() => setCopiedPrincipal(false), 2000);
        }
    };

    // Not authenticated state
    if (!isAuthenticated) {
        return (
            <div style={{
                background: theme.colors.secondaryBg,
                borderRadius: '16px',
                border: `1px solid ${theme.colors.border}`,
                overflow: 'hidden'
            }}>
                <div style={{
                    padding: '1.25rem 1.5rem',
                    background: `linear-gradient(135deg, ${accentPrimary}10 0%, transparent 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem'
                }}>
                    <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '10px',
                        background: `${accentPrimary}20`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: accentPrimary
                    }}>
                        <FaKey size={18} />
                    </div>
                    <div>
                        <h2 style={{
                            color: theme.colors.primaryText,
                            fontSize: '1.1rem',
                            fontWeight: '600',
                            margin: 0
                        }}>
                            {title}
                        </h2>
                    </div>
                </div>
                <div style={{
                    padding: '2rem',
                    textAlign: 'center',
                    color: theme.colors.mutedText
                }}>
                    <FaKey size={40} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                    <p style={{ margin: 0 }}>Please connect your wallet to view your ICP neurons.</p>
                </div>
            </div>
        );
    }

    // No neurons state
    if (neurons.length === 0 && !neuronsLoading) {
        if (inlineInProposal) {
            return (
                <div style={{
                    padding: '1rem 1.25rem',
                    background: theme.colors.primaryBg,
                    borderRadius: '12px',
                    border: `1px solid ${theme.colors.border}`,
                    color: theme.colors.mutedText,
                    fontSize: '0.9rem'
                }}>
                    No ICP neurons found. You need NNS neurons where you are the controller or hotkey to vote.
                </div>
            );
        }
        return (
            <div style={{
                background: theme.colors.secondaryBg,
                borderRadius: '16px',
                border: `1px solid ${theme.colors.border}`,
                overflow: 'hidden'
            }}>
                <div style={{
                    padding: '1.25rem 1.5rem',
                    background: `linear-gradient(135deg, ${accentPrimary}10 0%, transparent 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem'
                }}>
                    <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '10px',
                        background: `${accentPrimary}20`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: accentPrimary
                    }}>
                        <FaKey size={18} />
                    </div>
                    <div>
                        <h2 style={{
                            color: theme.colors.primaryText,
                            fontSize: '1.1rem',
                            fontWeight: '600',
                            margin: 0
                        }}>
                            Add Your Principal as a Hotkey
                        </h2>
                    </div>
                </div>
                <div style={{ padding: '1.5rem' }}>
                    <div style={{
                        background: theme.colors.primaryBg,
                        borderRadius: '12px',
                        padding: '1.5rem',
                        marginBottom: '1.5rem'
                    }}>
                        <p style={{ color: theme.colors.primaryText, marginBottom: '1rem' }}>
                            To vote on NNS proposals:
                        </p>
                        <ol style={{ color: theme.colors.secondaryText, paddingLeft: '1.25rem', margin: 0, lineHeight: '1.8' }}>
                            <li>First, you need to have an NNS neuron (staked ICP)</li>
                            <li>Add your principal from this application as a hotkey to your neuron</li>
                            <li style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                                Your current principal is:
                                <code style={{
                                    background: `${accentPrimary}20`,
                                    color: accentPrimary,
                                    padding: '0.25rem 0.5rem',
                                    borderRadius: '6px',
                                    fontSize: '0.85rem',
                                    fontFamily: 'monospace'
                                }}>
                                    {identity && identity.getPrincipal ? identity.getPrincipal().toText() : 'Not connected'}
                                </code>
                                <button
                                    onClick={copyPrincipal}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: copiedPrincipal ? theme.colors.success : accentPrimary,
                                        cursor: 'pointer',
                                        padding: '4px',
                                        display: 'flex',
                                        alignItems: 'center'
                                    }}
                                    title="Copy principal"
                                >
                                    {copiedPrincipal ? <FaCheckCircle size={14} /> : <FaCopy size={14} />}
                                </button>
                            </li>
                            <li>Once added as a hotkey, you'll be able to vote on NNS proposals from here</li>
                        </ol>
                    </div>
                    <button
                        onClick={() => refreshNeurons()}
                        style={{
                            width: '100%',
                            background: `linear-gradient(135deg, ${accentPrimary}, ${accentSecondary})`,
                            color: 'white',
                            border: 'none',
                            borderRadius: '10px',
                            padding: '0.75rem 1.5rem',
                            cursor: 'pointer',
                            fontSize: '1rem',
                            fontWeight: '500',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem'
                        }}
                    >
                        <FaSync size={14} />
                        Check Neuron Status
                    </button>
                </div>
            </div>
        );
    }

    // Compact neuron card for inline proposal mode
    const renderCompactNeuronCard = (neuron) => {
        const neuronId = getNnsNeuronId(neuron);
        if (!neuronId) return null;

        const neuronIdStr = neuronId.toString();
        const principalStr = getPrincipalStr();
        const hasAccess = hasNnsVotingAccess(neuron, principalStr);
        if (!hasAccess) return null;

        const existingVote = getNeuronVote(neuronId);
        const votingState = votingStates[neuronIdStr];
        const isOpen = isProposalOpenForVoting();
        const neuronVP = getNnsNeuronVotingPower(neuron);
        const shortId = shortNeuronId(neuronId);

        if (existingVote) {
            const voteInfo = formatVote(existingVote.vote);
            return (
                <div key={neuronIdStr} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.5rem 0.75rem',
                    background: theme.colors.secondaryBg,
                    borderRadius: '8px',
                    border: `1px solid ${theme.colors.border}`,
                    flexWrap: 'wrap'
                }}>
                    <code style={{ fontSize: '0.75rem', color: theme.colors.mutedText, fontFamily: 'monospace' }}>{shortId}</code>
                    <span style={{ color: accentPrimary, fontWeight: '600', fontSize: '0.8rem' }}>
                        {formatVotingPowerDisplay(neuronVP)} VP
                    </span>
                    <span style={{ color: voteInfo.color, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {existingVote.vote === 1 ? <FaCheckCircle size={12} /> : <FaTimesCircle size={12} />}
                        {voteInfo.text}
                    </span>
                </div>
            );
        }
        if (!isOpen || neuronVP === 0n) return (
            <div key={neuronIdStr} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.5rem 0.75rem',
                background: theme.colors.secondaryBg,
                borderRadius: '8px',
                border: `1px solid ${theme.colors.border}`
            }}>
                <code style={{ fontSize: '0.75rem', color: theme.colors.mutedText, fontFamily: 'monospace' }}>{shortId}</code>
                <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>
                    {!isOpen ? 'Voting closed' : 'No VP'}
                </span>
            </div>
        );
        if (votingState === 'voting') return (
            <div key={neuronIdStr} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.5rem 0.75rem',
                background: theme.colors.secondaryBg,
                borderRadius: '8px',
                border: `1px solid ${theme.colors.border}`
            }}>
                <code style={{ fontSize: '0.75rem', color: theme.colors.mutedText, fontFamily: 'monospace' }}>{shortId}</code>
                <div style={{ width: '14px', height: '14px', border: `2px solid ${accentPrimary}`, borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <span style={{ color: accentPrimary, fontSize: '0.8rem' }}>Voting...</span>
            </div>
        );
        if (votingState === 'success') return (
            <div key={neuronIdStr} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.5rem 0.75rem',
                background: theme.colors.secondaryBg,
                borderRadius: '8px',
                border: `1px solid ${theme.colors.border}`
            }}>
                <code style={{ fontSize: '0.75rem', color: theme.colors.mutedText, fontFamily: 'monospace' }}>{shortId}</code>
                <span style={{ color: theme.colors.success, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <FaCheckCircle size={12} /> Voted
                </span>
            </div>
        );
        if (votingState === 'error') return (
            <div key={neuronIdStr} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 0.75rem',
                background: theme.colors.secondaryBg,
                borderRadius: '8px',
                border: `1px solid ${theme.colors.border}`,
                flexWrap: 'wrap'
            }}>
                <code style={{ fontSize: '0.75rem', color: theme.colors.mutedText, fontFamily: 'monospace' }}>{shortId}</code>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <button onClick={() => voteWithNeuron(neuronId, 1)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: theme.colors.success, color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Adopt</button>
                    <button onClick={() => voteWithNeuron(neuronId, 2)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: theme.colors.error, color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Reject</button>
                </div>
            </div>
        );
        return (
            <div key={neuronIdStr} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.5rem 0.75rem',
                background: theme.colors.secondaryBg,
                borderRadius: '8px',
                border: `1px solid ${theme.colors.border}`,
                flexWrap: 'wrap'
            }}>
                <code style={{ fontSize: '0.75rem', color: theme.colors.mutedText, fontFamily: 'monospace' }}>{shortId}</code>
                <span style={{ color: accentPrimary, fontWeight: '600', fontSize: '0.8rem' }}>
                    {formatVotingPowerDisplay(neuronVP)} VP
                </span>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <button onClick={() => voteWithNeuron(neuronId, 1)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: theme.colors.success, color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <FaCheckCircle size={10} /> Adopt
                    </button>
                    <button onClick={() => voteWithNeuron(neuronId, 2)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: theme.colors.error, color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <FaTimesCircle size={10} /> Reject
                    </button>
                </div>
            </div>
        );
    };

    // Inline proposal layout
    if (inlineInProposal && proposalData && currentProposalId) {
        if (neuronsLoading) {
            return (
                <div style={{
                    marginTop: '1.5rem',
                    padding: '1.25rem',
                    background: theme.colors.primaryBg,
                    borderRadius: '12px',
                    border: `1px solid ${theme.colors.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    color: theme.colors.mutedText
                }}>
                    <div style={{ width: '20px', height: '20px', border: `2px solid ${theme.colors.border}`, borderTop: `2px solid ${accentPrimary}`, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    Loading ICP neurons...
                </div>
            );
        }
        const eligibleInfo = getEligibleNeuronsInfo();
        const voteableNeurons = getVotableNeurons();

        return (
            <>
            <div style={{ marginTop: '1.5rem' }}>
                <div style={{
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
                            <FaVoteYea size={16} style={{ color: accentPrimary }} />
                            Vote with your ICP neurons:
                        </div>
                        <button
                            onClick={() => voteWithAllNeurons(1)}
                            disabled={eligibleInfo.count === 0 || voteAllState === 'voting'}
                            style={{
                                padding: '0.6rem 1.25rem',
                                borderRadius: '10px',
                                border: 'none',
                                cursor: eligibleInfo.count > 0 && voteAllState !== 'voting' ? 'pointer' : 'not-allowed',
                                fontWeight: '600',
                                fontSize: '0.9rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                background: eligibleInfo.count > 0 ? `linear-gradient(135deg, ${theme.colors.success}, #27ae60)` : theme.colors.mutedText,
                                color: 'white',
                                opacity: eligibleInfo.count > 0 ? 1 : 0.5,
                                transition: 'all 0.2s ease'
                            }}
                        >
                            {voteAllState === 'voting' ? '...' : <FaCheckCircle size={14} />}
                            Adopt
                            {eligibleInfo.count > 0 && (
                                <span style={{ opacity: 0.8, fontWeight: '400' }}>({eligibleInfo.count})</span>
                            )}
                        </button>
                        <button
                            onClick={() => voteWithAllNeurons(2)}
                            disabled={eligibleInfo.count === 0 || voteAllState === 'voting'}
                            style={{
                                padding: '0.6rem 1.25rem',
                                borderRadius: '10px',
                                border: 'none',
                                cursor: eligibleInfo.count > 0 && voteAllState !== 'voting' ? 'pointer' : 'not-allowed',
                                fontWeight: '600',
                                fontSize: '0.9rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                background: eligibleInfo.count > 0 ? `linear-gradient(135deg, ${theme.colors.error}, #c0392b)` : theme.colors.mutedText,
                                color: 'white',
                                opacity: eligibleInfo.count > 0 ? 1 : 0.5,
                                transition: 'all 0.2s ease'
                            }}
                        >
                            {voteAllState === 'voting' ? '...' : <FaTimesCircle size={14} />}
                            Reject
                            {eligibleInfo.count > 0 && (
                                <span style={{ opacity: 0.8, fontWeight: '400' }}>({eligibleInfo.count})</span>
                            )}
                        </button>
                        {voteAllState === 'success' && (
                            <span style={{ color: theme.colors.success, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <FaCheckCircle /> Vote submitted!
                            </span>
                        )}
                        {voteAllState === 'error' && (
                            <span style={{ color: theme.colors.error, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <FaTimesCircle /> Voting failed
                            </span>
                        )}
                    </div>
                    {eligibleInfo.count === 0 && (
                        <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: theme.colors.mutedText }}>
                            No eligible neurons available. Either you've already voted or your neurons have no voting power.
                        </div>
                    )}
                    {voteableNeurons.length > 0 && (
                        <div style={{ marginTop: '1rem' }}>
                            <button
                                onClick={() => setNeuronsListExpanded(!neuronsListExpanded)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    padding: '0.5rem 0',
                                    background: 'none',
                                    border: 'none',
                                    color: accentPrimary,
                                    cursor: 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: '500'
                                }}
                            >
                                {neuronsListExpanded ? <FaChevronUp size={12} /> : <FaChevronDown size={12} />}
                                {neuronsListExpanded ? 'Hide' : 'Show'} my neurons ({voteableNeurons.length})
                            </button>
                            {neuronsListExpanded && (
                                <div style={{
                                    marginTop: '0.75rem',
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                                    gap: '0.5rem'
                                }}>
                                    {voteableNeurons.map(neuron => renderCompactNeuronCard(neuron)).filter(Boolean)}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
            </div>
            <InfoModal show={infoModal.show} onClose={closeInfoModal} title={infoModal.title} message={infoModal.message} type={infoModal.type} />
            </>
        );
    }

    // Full card layout
    return (
        <>
        <div style={{
            background: theme.colors.secondaryBg,
            borderRadius: '16px',
            border: `1px solid ${theme.colors.border}`,
            overflow: 'hidden'
        }}>
            {/* Header */}
            <div
                onClick={showExpandButton ? () => setIsExpanded(!isExpanded) : undefined}
                style={{
                    padding: '1.25rem 1.5rem',
                    background: `linear-gradient(135deg, ${accentPrimary}10 0%, transparent 100%)`,
                    borderBottom: isExpanded ? `1px solid ${theme.colors.border}` : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: showExpandButton ? 'pointer' : 'default'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '10px',
                        background: `${accentPrimary}20`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: accentPrimary
                    }}>
                        <FaVoteYea size={18} />
                    </div>
                    <div>
                        <h2 style={{
                            color: theme.colors.primaryText,
                            fontSize: '1.1rem',
                            fontWeight: '600',
                            margin: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                        }}>
                            {title}
                            <span
                                title={infoTooltip}
                                style={{
                                    width: '18px',
                                    height: '18px',
                                    borderRadius: '50%',
                                    background: `${accentPrimary}30`,
                                    color: accentPrimary,
                                    fontSize: '0.7rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'help'
                                }}
                            >
                                <FaInfoCircle size={10} />
                            </span>
                        </h2>
                    </div>
                </div>
                {showExpandButton && (
                    isExpanded ? <FaChevronUp color={theme.colors.mutedText} /> : <FaChevronDown color={theme.colors.mutedText} />
                )}
            </div>

            {/* Content */}
            {(isExpanded || !showExpandButton) && (
                neuronsLoading ? (
                    <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        padding: '2rem',
                        color: theme.colors.mutedText,
                        gap: '0.75rem'
                    }}>
                        <div style={{
                            width: '24px',
                            height: '24px',
                            border: `3px solid ${theme.colors.border}`,
                            borderTop: `3px solid ${accentPrimary}`,
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite'
                        }} />
                        Loading ICP neurons...
                    </div>
                ) : (
                    <div style={{ padding: '1.5rem' }}>
                        {/* Vote All Buttons for Open Proposals */}
                        {proposalData && isProposalOpenForVoting() && (
                            <div style={{
                                background: theme.colors.primaryBg,
                                borderRadius: '12px',
                                padding: '1rem 1.25rem',
                                marginBottom: '1.5rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '1rem',
                                flexWrap: 'wrap',
                                border: `1px solid ${theme.colors.border}`
                            }}>
                                <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '0.9rem' }}>
                                    Vote with all eligible neurons:
                                </span>
                                <button
                                    onClick={() => voteWithAllNeurons(1)}
                                    disabled={!hasEligibleNeurons()}
                                    style={{
                                        background: hasEligibleNeurons()
                                            ? `linear-gradient(135deg, ${theme.colors.success}, #27ae60)`
                                            : theme.colors.mutedText,
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '8px',
                                        padding: '0.5rem 1rem',
                                        cursor: hasEligibleNeurons() ? 'pointer' : 'not-allowed',
                                        fontWeight: '600',
                                        fontSize: '0.85rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        opacity: hasEligibleNeurons() ? 1 : 0.5
                                    }}
                                >
                                    <FaCheckCircle size={12} />
                                    Adopt All
                                </button>
                                <button
                                    onClick={() => voteWithAllNeurons(2)}
                                    disabled={!hasEligibleNeurons()}
                                    style={{
                                        background: hasEligibleNeurons()
                                            ? `linear-gradient(135deg, ${theme.colors.error}, #c0392b)`
                                            : theme.colors.mutedText,
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '8px',
                                        padding: '0.5rem 1rem',
                                        cursor: hasEligibleNeurons() ? 'pointer' : 'not-allowed',
                                        fontWeight: '600',
                                        fontSize: '0.85rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        opacity: hasEligibleNeurons() ? 1 : 0.5
                                    }}
                                >
                                    <FaTimesCircle size={12} />
                                    Reject All
                                </button>
                            </div>
                        )}

                        {/* Hotkeyed Voting Power Total */}
                        {(() => {
                            const principalStr = getPrincipalStr();
                            const accessibleNeurons = getAllNeurons().filter(n => hasNnsVotingAccess(n, principalStr));
                            const totalVP = accessibleNeurons.reduce((total, neuron) => {
                                try {
                                    return total + getNnsNeuronVotingPower(neuron);
                                } catch {
                                    return total;
                                }
                            }, 0n);

                            if (accessibleNeurons.length > 0) {
                                return (
                                    <div style={{
                                        background: `${theme.colors.success}10`,
                                        border: `1px solid ${theme.colors.success}40`,
                                        borderRadius: '12px',
                                        padding: '1rem 1.25rem',
                                        marginBottom: '1.5rem'
                                    }}>
                                        <div style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            marginBottom: '0.25rem'
                                        }}>
                                            <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                                                Total Voting Power
                                            </span>
                                            <span style={{
                                                color: theme.colors.success,
                                                fontWeight: '700',
                                                fontSize: '1.1rem'
                                            }}>
                                                {formatVotingPowerDisplay(totalVP)} ICP VP
                                            </span>
                                        </div>
                                        <div style={{
                                            fontSize: '0.8rem',
                                            color: theme.colors.mutedText
                                        }}>
                                            From {accessibleNeurons.length} neuron{accessibleNeurons.length !== 1 ? 's' : ''} with voting access
                                        </div>
                                    </div>
                                );
                            }
                            return null;
                        })()}

                        {/* Neurons List */}
                        <div>
                            {getAllNeurons().map((neuron, neuronIndex) => {
                                const neuronId = getNnsNeuronId(neuron);
                                if (!neuronId) return null;

                                const neuronIdStr = neuronId.toString();
                                const principalStr = getPrincipalStr();
                                const hasAccess = hasNnsVotingAccess(neuron, principalStr);
                                const neuronVP = getNnsNeuronVotingPower(neuron);

                                return (
                                    <div key={neuronIdStr} style={{
                                        background: theme.colors.primaryBg,
                                        borderRadius: '12px',
                                        padding: '1.25rem',
                                        marginBottom: '1rem',
                                        border: `1px solid ${theme.colors.border}`
                                    }}>
                                        {/* Neuron ID */}
                                        <div style={{
                                            fontSize: '0.75rem',
                                            color: theme.colors.mutedText,
                                            fontFamily: 'monospace',
                                            marginBottom: '0.75rem',
                                            wordBreak: 'break-all',
                                            background: theme.colors.secondaryBg,
                                            padding: '0.5rem',
                                            borderRadius: '6px'
                                        }}>
                                            {neuronIdStr}
                                        </div>

                                        {/* Neuron Stats Grid */}
                                        <div style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(2, 1fr)',
                                            gap: '0.75rem',
                                            fontSize: '0.85rem'
                                        }}>
                                            <div>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>Created</div>
                                                <div style={{ color: theme.colors.primaryText }}>
                                                    {neuron.created_timestamp_seconds
                                                        ? new Date(Number(neuron.created_timestamp_seconds) * 1000).toLocaleDateString()
                                                        : '--'}
                                                </div>
                                            </div>
                                            <div>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>Dissolve State</div>
                                                <div style={{ color: theme.colors.primaryText }}>{getDissolveStateDisplay(neuron)}</div>
                                            </div>
                                            <div>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>Maturity</div>
                                                <div style={{ color: theme.colors.primaryText }}>
                                                    {formatIcpE8s(neuron.maturity_e8s_equivalent || 0)} ICP
                                                </div>
                                            </div>
                                            <div>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>Staked Amount</div>
                                                <div style={{ color: theme.colors.primaryText }}>
                                                    {formatIcpE8s(neuron.cached_neuron_stake_e8s || 0)} ICP
                                                </div>
                                            </div>
                                            <div>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>Voting Power</div>
                                                <div style={{ color: accentPrimary, fontWeight: '600' }}>
                                                    {formatVotingPowerDisplay(neuronVP)}
                                                </div>
                                            </div>
                                            {hasAccess && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                    <FaKey size={10} style={{ color: theme.colors.success }} />
                                                    <span style={{ color: theme.colors.success, fontSize: '0.8rem' }}>Voting Access</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Voting Section for Proposals */}
                                        {hasAccess && proposalData && currentProposalId && (
                                            <div style={{ marginTop: '1rem' }}>
                                                {(() => {
                                                    const existingVote = getNeuronVote(neuronId);
                                                    const votingState = votingStates[neuronIdStr];
                                                    const isOpen = isProposalOpenForVoting();

                                                    if (existingVote) {
                                                        const voteInfo = formatVote(existingVote.vote);
                                                        return (
                                                            <div style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '0.5rem',
                                                                padding: '0.75rem',
                                                                background: `${voteInfo.color}15`,
                                                                borderRadius: '8px',
                                                                border: `1px solid ${voteInfo.color}40`
                                                            }}>
                                                                {existingVote.vote === 1 ? <FaCheckCircle size={14} style={{ color: voteInfo.color }} /> : <FaTimesCircle size={14} style={{ color: voteInfo.color }} />}
                                                                <span style={{ color: voteInfo.color, fontWeight: '600' }}>
                                                                    Voted: {voteInfo.text}
                                                                </span>
                                                            </div>
                                                        );
                                                    }

                                                    if (!isOpen) {
                                                        return (
                                                            <div style={{
                                                                padding: '0.75rem',
                                                                background: theme.colors.secondaryBg,
                                                                borderRadius: '8px',
                                                                color: theme.colors.mutedText,
                                                                fontSize: '0.85rem'
                                                            }}>
                                                                Proposal not open for voting
                                                            </div>
                                                        );
                                                    }

                                                    if (neuronVP === 0n) {
                                                        return (
                                                            <div style={{
                                                                padding: '0.75rem',
                                                                background: theme.colors.secondaryBg,
                                                                borderRadius: '8px',
                                                                color: theme.colors.mutedText,
                                                                fontSize: '0.85rem'
                                                            }}>
                                                                No voting power
                                                            </div>
                                                        );
                                                    }

                                                    if (votingState === 'voting') {
                                                        return (
                                                            <div style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '0.75rem',
                                                                padding: '0.75rem',
                                                                background: theme.colors.secondaryBg,
                                                                borderRadius: '8px'
                                                            }}>
                                                                <div style={{
                                                                    width: '16px',
                                                                    height: '16px',
                                                                    border: `2px solid ${accentPrimary}`,
                                                                    borderTop: '2px solid transparent',
                                                                    borderRadius: '50%',
                                                                    animation: 'spin 1s linear infinite'
                                                                }} />
                                                                <span style={{ color: accentPrimary }}>Submitting vote...</span>
                                                            </div>
                                                        );
                                                    }

                                                    if (votingState === 'success') {
                                                        return (
                                                            <div style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '0.5rem',
                                                                padding: '0.75rem',
                                                                background: `${theme.colors.success}15`,
                                                                borderRadius: '8px',
                                                                color: theme.colors.success
                                                            }}>
                                                                <FaCheckCircle size={14} />
                                                                Vote submitted successfully!
                                                            </div>
                                                        );
                                                    }

                                                    if (votingState === 'error') {
                                                        return (
                                                            <div style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '0.75rem',
                                                                padding: '0.75rem',
                                                                background: `${theme.colors.error}15`,
                                                                borderRadius: '8px',
                                                                flexWrap: 'wrap'
                                                            }}>
                                                                <span style={{ color: theme.colors.error, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                                    <FaTimesCircle size={12} /> Voting failed
                                                                </span>
                                                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                                    <button
                                                                        onClick={() => voteWithNeuron(neuronId, 1)}
                                                                        style={{
                                                                            background: theme.colors.success,
                                                                            color: 'white',
                                                                            border: 'none',
                                                                            borderRadius: '6px',
                                                                            padding: '0.4rem 0.75rem',
                                                                            cursor: 'pointer',
                                                                            fontSize: '0.8rem',
                                                                            fontWeight: '600'
                                                                        }}
                                                                    >
                                                                        Retry Adopt
                                                                    </button>
                                                                    <button
                                                                        onClick={() => voteWithNeuron(neuronId, 2)}
                                                                        style={{
                                                                            background: theme.colors.error,
                                                                            color: 'white',
                                                                            border: 'none',
                                                                            borderRadius: '6px',
                                                                            padding: '0.4rem 0.75rem',
                                                                            cursor: 'pointer',
                                                                            fontSize: '0.8rem',
                                                                            fontWeight: '600'
                                                                        }}
                                                                    >
                                                                        Retry Reject
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        );
                                                    }

                                                    // Default: show voting buttons
                                                    return (
                                                        <div style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '0.75rem',
                                                            padding: '0.75rem',
                                                            background: theme.colors.secondaryBg,
                                                            borderRadius: '8px'
                                                        }}>
                                                            <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Vote:</span>
                                                            <button
                                                                onClick={() => voteWithNeuron(neuronId, 1)}
                                                                style={{
                                                                    background: `linear-gradient(135deg, ${theme.colors.success}, #27ae60)`,
                                                                    color: 'white',
                                                                    border: 'none',
                                                                    borderRadius: '6px',
                                                                    padding: '0.4rem 0.75rem',
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.8rem',
                                                                    fontWeight: '600',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '0.25rem'
                                                                }}
                                                            >
                                                                <FaCheckCircle size={10} /> Adopt
                                                            </button>
                                                            <button
                                                                onClick={() => voteWithNeuron(neuronId, 2)}
                                                                style={{
                                                                    background: `linear-gradient(135deg, ${theme.colors.error}, #c0392b)`,
                                                                    color: 'white',
                                                                    border: 'none',
                                                                    borderRadius: '6px',
                                                                    padding: '0.4rem 0.75rem',
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.8rem',
                                                                    fontWeight: '600',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '0.25rem'
                                                                }}
                                                            >
                                                                <FaTimesCircle size={10} /> Reject
                                                            </button>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )
            )}
            <style>
                {`
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `}
            </style>
        </div>
        <InfoModal show={infoModal.show} onClose={closeInfoModal} title={infoModal.title} message={infoModal.message} type={infoModal.type} />
        </>
    );
};

export default IcpHotkeyNeurons;
