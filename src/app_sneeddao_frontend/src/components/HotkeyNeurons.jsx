import React, { useState, useEffect } from 'react';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'declarations/rll';
import { useAuth } from '../AuthContext';
import { useNeurons } from '../contexts/NeuronsContext';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import { getSnsById } from '../utils/SnsUtils';
import { useSns } from '../contexts/SnsContext';
import { calculateVotingPower, formatVotingPower } from '../utils/VotingPowerUtils';
import { useTheme } from '../contexts/ThemeContext';
import { isProposalAcceptingVotes } from '../utils/ProposalUtils';
import { FaKey, FaCheckCircle, FaTimesCircle, FaVoteYea, FaChevronDown, FaChevronUp, FaInfoCircle, FaCopy, FaSync } from 'react-icons/fa';

// Accent colors - matching Proposal page
const accentPrimary = '#6366f1';
const accentSecondary = '#8b5cf6';

const HotkeyNeurons = ({ 
    fetchNeuronsFromSns, 
    showVotingStats = true, 
    showExpandButton = true,
    defaultExpanded = false,
    title = "Your Hotkey Neurons",
    infoTooltip = "For each NNS account (Internet Identity) containing SNS neurons, you only need to configure one neuron as a hotkey per SNS. All other neurons of the same SNS in the same account will be automatically accessible. If you have multiple NNS accounts with Sneed neurons, you'll need to set up one hotkey neuron per account.",
    proposalData = null,
    currentProposalId = null,
    onVoteSuccess = null,
    forceSneedSns = false
}) => {
    const { theme } = useTheme();
    const { isAuthenticated, identity } = useAuth();
    const { selectedSnsRoot, SNEED_SNS_ROOT } = useSns();
    const { getHotkeyNeurons, loading: neuronsLoading, refreshNeurons, neuronsData } = useNeurons();
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const [votingStates, setVotingStates] = useState({});
    const [tokenSymbol, setTokenSymbol] = useState('SNS');
    const [nervousSystemParameters, setNervousSystemParameters] = useState(null);
    const [copiedPrincipal, setCopiedPrincipal] = useState(false);

    const effectiveSnsRoot = forceSneedSns ? SNEED_SNS_ROOT : selectedSnsRoot;

    const hotkeyNeurons = neuronsData || {
        neurons_by_owner: [],
        total_voting_power: 0,
        distribution_voting_power: 0
    };

    const uint8ArrayToHex = (uint8Array) => {
        if (!uint8Array) return '';
        return Array.from(uint8Array, byte => byte.toString(16).padStart(2, '0')).join('');
    };

    const getDissolveState = (neuron) => {
        if (!neuron.dissolve_state || !neuron.dissolve_state[0]) {
            return 'Unknown';
        }
        
        const dissolveState = neuron.dissolve_state[0];
        if (dissolveState.DissolveDelaySeconds !== undefined) {
            const delaySeconds = Number(dissolveState.DissolveDelaySeconds);
            const days = Math.floor(delaySeconds / (24 * 60 * 60));
            return `${days} days`;
        } else if (dissolveState.WhenDissolvedTimestampSeconds !== undefined) {
            const timestamp = Number(dissolveState.WhenDissolvedTimestampSeconds);
            const date = new Date(timestamp * 1000);
            return `Dissolved ${date.toLocaleDateString()}`;
        }
        return 'Unknown';
    };

    const formatE8s = (e8s) => {
        return (Number(e8s) / 100_000_000).toFixed(2);
    };

    const getAllNeurons = () => {
        return hotkeyNeurons?.neurons_by_owner?.flatMap(([owner, neurons]) => neurons) || [];
    };

    const hasEligibleNeurons = () => {
        if (!proposalData || !currentProposalId) return false;
        
        const allNeurons = getAllNeurons();
        return allNeurons.some(neuron => {
            const hasHotkeyAccess = neuron.permissions.some(p => 
                p.principal?.toString() === identity.getPrincipal().toString() &&
                p.permission_type.includes(4)
            );
            if (!hasHotkeyAccess) return false;

            const neuronVotingPower = nervousSystemParameters ? 
                calculateVotingPower(neuron, nervousSystemParameters) : 0;
            if (neuronVotingPower === 0) return false;

            const neuronIdHex = uint8ArrayToHex(neuron.id[0]?.id);
            const ballot = proposalData.ballots?.find(([id, _]) => id === neuronIdHex);
            
            if (ballot && ballot[1]) {
                const ballotData = ballot[1];
                const hasVoted = ballotData.cast_timestamp_seconds && Number(ballotData.cast_timestamp_seconds) > 0;
                if (hasVoted) return false;
            }

            return true;
        });
    };

    const isProposalOpenForVoting = () => {
        return isProposalAcceptingVotes(proposalData);
    };

    const getNeuronVote = (neuronId) => {
        if (!proposalData?.ballots || !neuronId) {
            return null;
        }
        
        const neuronIdHex = uint8ArrayToHex(neuronId);
        const ballot = proposalData.ballots.find(([id, _]) => id === neuronIdHex);
        
        if (ballot && ballot[1]) {
            const ballotData = ballot[1];
            const hasVoted = ballotData.cast_timestamp_seconds && Number(ballotData.cast_timestamp_seconds) > 0;
            
            if (hasVoted) {
                return ballotData;
            }
        }
        
        return null;
    };

    const formatVote = (voteNumber) => {
        switch (voteNumber) {
            case 1: return { text: 'Adopt', color: theme.colors.success };
            case 2: return { text: 'Reject', color: theme.colors.error };
            default: return { text: 'Not Voted', color: theme.colors.mutedText };
        }
    };

    const voteWithNeuron = async (neuronId, vote) => {
        if (!identity || !effectiveSnsRoot || !currentProposalId) return;
        
        const neuronIdHex = uint8ArrayToHex(neuronId);
        setVotingStates(prev => ({ ...prev, [neuronIdHex]: 'voting' }));
        
        try {
            const selectedSns = getSnsById(effectiveSnsRoot);
            if (!selectedSns) throw new Error('SNS not found');
            
            const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                agentOptions: { identity }
            });
            
            const manageNeuronRequest = {
                subaccount: neuronId,
                command: [{
                    RegisterVote: {
                        vote: vote,
                        proposal: [{ id: BigInt(currentProposalId) }]
                    }
                }]
            };
            
            const response = await snsGovActor.manage_neuron(manageNeuronRequest);
            
            if (response?.command?.[0]?.RegisterVote) {
                setVotingStates(prev => ({ ...prev, [neuronIdHex]: 'success' }));
                await refreshNeurons(effectiveSnsRoot);
                if (onVoteSuccess) onVoteSuccess();
            } else if (response?.command?.[0]?.Error) {
                throw new Error(response.command[0].Error.error_message);
            } else {
                throw new Error('Unknown voting error');
            }
        } catch (error) {
            console.error('Error voting:', error);
            setVotingStates(prev => ({ ...prev, [neuronIdHex]: 'error' }));
            alert(`Voting failed: ${error.message}`);
        }
    };

    const voteWithAllNeurons = async (vote) => {
        const allNeurons = getAllNeurons();
        if (!allNeurons || !proposalData || !currentProposalId) {
            alert('Missing required data for voting');
            return;
        }

        try {
            const eligibleNeurons = allNeurons.filter(neuron => {
                const hasHotkeyAccess = neuron.permissions.some(p => 
                    p.principal?.toString() === identity.getPrincipal().toString() &&
                    p.permission_type.includes(4)
                );
                if (!hasHotkeyAccess) return false;

                const neuronIdHex = uint8ArrayToHex(neuron.id[0]?.id);
                const ballot = proposalData.ballots?.find(([id, _]) => id === neuronIdHex);
                
                if (ballot && ballot[1]) {
                    const ballotData = ballot[1];
                    const hasVoted = ballotData.cast_timestamp_seconds && Number(ballotData.cast_timestamp_seconds) > 0;
                    if (hasVoted) return false;
                }

                return true;
            });

            if (eligibleNeurons.length === 0) {
                const neuronsWithHotkey = allNeurons.filter(neuron => 
                    neuron.permissions.some(p => 
                        p.principal?.toString() === identity.getPrincipal().toString() &&
                        p.permission_type.includes(4)
                    )
                ).length;
                
                const neuronsAlreadyVoted = allNeurons.filter(neuron => {
                    const neuronIdHex = uint8ArrayToHex(neuron.id[0]?.id);
                    const ballot = proposalData.ballots?.find(([id, _]) => id === neuronIdHex);
                    if (ballot && ballot[1]) {
                        const ballotData = ballot[1];
                        return ballotData.cast_timestamp_seconds && Number(ballotData.cast_timestamp_seconds) > 0;
                    }
                    return false;
                }).length;

                alert(`No eligible neurons found for voting.\n\nTotal neurons: ${allNeurons.length}\nNeurons with hotkey access: ${neuronsWithHotkey}\nNeurons that already voted: ${neuronsAlreadyVoted}\nEligible neurons: ${eligibleNeurons.length}`);
                return;
            }

            let successfulVotes = 0;
            let failedVotes = 0;
            
            for (const neuron of eligibleNeurons) {
                const neuronIdHex = uint8ArrayToHex(neuron.id[0].id);
                
                await voteWithNeuron(neuron.id[0].id, vote);
                
                const finalState = votingStates[neuronIdHex];
                if (finalState === 'success') {
                    successfulVotes++;
                } else if (finalState === 'error') {
                    failedVotes++;
                }
            }

            if (successfulVotes > 0) {
                alert(`Successfully voted with ${successfulVotes} neuron(s)!${failedVotes > 0 ? ` ${failedVotes} vote(s) failed.` : ''}`);
                await refreshNeurons(effectiveSnsRoot);
                if (onVoteSuccess) {
                    onVoteSuccess();
                }
            } else if (failedVotes > 0) {
                alert(`All ${failedVotes} vote(s) failed.`);
            }
        } catch (error) {
            console.error('Error voting with all neurons:', error);
            alert('Error voting with all neurons: ' + error.message);
        }
    };

    const copyPrincipal = () => {
        if (identity && identity.getPrincipal) {
            navigator.clipboard.writeText(identity.getPrincipal().toText());
            setCopiedPrincipal(true);
            setTimeout(() => setCopiedPrincipal(false), 2000);
        }
    };

    useEffect(() => {
        const fetchTokenSymbol = async () => {
            if (forceSneedSns) {
                setTokenSymbol('SNEED');
                return;
            }

            if (!effectiveSnsRoot) return;
            
            try {
                const selectedSns = getSnsById(effectiveSnsRoot);
                if (!selectedSns) return;

                const icrc1Actor = createIcrc1Actor(selectedSns.canisters.ledger, {
                    agentOptions: { identity }
                });
                const metadata = await icrc1Actor.icrc1_metadata();
                const symbolEntry = metadata.find(entry => entry[0] === 'icrc1:symbol');
                if (symbolEntry && symbolEntry[1]) {
                    setTokenSymbol(symbolEntry[1].Text);
                }
            } catch (error) {
                console.error('Error fetching token symbol:', error);
                setTokenSymbol('SNS');
            }
        };

        fetchTokenSymbol();
    }, [effectiveSnsRoot, identity, forceSneedSns]);

    useEffect(() => {
        const fetchNervousSystemParameters = async () => {
            if (!effectiveSnsRoot) return;
            
            try {
                const selectedSns = getSnsById(effectiveSnsRoot);
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

        if (isAuthenticated && identity && effectiveSnsRoot) {
            fetchNervousSystemParameters();
        }
    }, [isAuthenticated, identity, effectiveSnsRoot]);

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
                    <p style={{ margin: 0 }}>Please connect your wallet to view your hotkey neurons.</p>
                </div>
            </div>
        );
    }

    // No neurons state
    if (hotkeyNeurons?.neurons_by_owner?.length === 0 && !neuronsLoading) {
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
                            To participate in Sneed DAO and earn rewards:
                        </p>
                        <ol style={{ color: theme.colors.secondaryText, paddingLeft: '1.25rem', margin: 0, lineHeight: '1.8' }}>
                            <li>First, you need to have a Sneed neuron</li>
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
                            <li>Once added as a hotkey, you'll be able to claim voting rewards, see your balances, claim history, and neurons here</li>
                        </ol>
                    </div>
                    <button 
                        onClick={() => window.location.reload()}
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
                        Check Hotkey Status
                    </button>
                </div>
            </div>
        );
    }

    // Main component with neurons
    return (
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
                        Loading neurons...
                    </div>
                ) : (
                    <div style={{ padding: '1.5rem' }}>
                        {/* Voting Stats */}
                        {showVotingStats && (
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                                gap: '1rem',
                                marginBottom: '1.5rem'
                            }}>
                                <div style={{
                                    background: theme.colors.primaryBg,
                                    borderRadius: '10px',
                                    padding: '1rem'
                                }}>
                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                                        Total Voting Power
                                    </div>
                                    <div style={{ color: theme.colors.primaryText, fontSize: '1.1rem', fontWeight: '600' }}>
                                        {Number(hotkeyNeurons?.total_voting_power || 0).toLocaleString()}
                                    </div>
                                </div>
                                <div style={{
                                    background: theme.colors.primaryBg,
                                    borderRadius: '10px',
                                    padding: '1rem'
                                }}>
                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                                        Distribution VP
                                    </div>
                                    <div style={{ color: theme.colors.primaryText, fontSize: '1.1rem', fontWeight: '600' }}>
                                        {Number(hotkeyNeurons?.distribution_voting_power || 0).toLocaleString()}
                                    </div>
                                </div>
                                <div style={{
                                    background: theme.colors.primaryBg,
                                    borderRadius: '10px',
                                    padding: '1rem'
                                }}>
                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                                        Your Share
                                    </div>
                                    <div style={{ color: accentPrimary, fontSize: '1.1rem', fontWeight: '600' }}>
                                        {((Number(hotkeyNeurons?.total_voting_power || 0) / Number(hotkeyNeurons?.distribution_voting_power || 1)) * 100).toFixed(2)}%
                                    </div>
                                </div>
                            </div>
                        )}
                        
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
                            const allNeurons = getAllNeurons();
                            const hotkeyedNeurons = allNeurons.filter(neuron => 
                                neuron.permissions.some(p => 
                                    p.principal?.toString() === identity?.getPrincipal()?.toString() &&
                                    p.permission_type.includes(4)
                                )
                            );
                            
                            const totalHotkeyedVP = hotkeyedNeurons.reduce((total, neuron) => {
                                try {
                                    const votingPower = nervousSystemParameters ? 
                                        calculateVotingPower(neuron, nervousSystemParameters) : 0;
                                    return total + votingPower;
                                } catch (error) {
                                    return total;
                                }
                            }, 0);

                            if (hotkeyedNeurons.length > 0) {
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
                                                Total Hotkeyed Voting Power
                                            </span>
                                            <span style={{ 
                                                color: theme.colors.success, 
                                                fontWeight: '700',
                                                fontSize: '1.1rem'
                                            }}>
                                                {nervousSystemParameters ? 
                                                    formatVotingPower(totalHotkeyedVP) : 
                                                    'Loading...'
                                                } VP
                                            </span>
                                        </div>
                                        <div style={{
                                            fontSize: '0.8rem',
                                            color: theme.colors.mutedText
                                        }}>
                                            From {hotkeyedNeurons.length} hotkeyed neuron{hotkeyedNeurons.length !== 1 ? 's' : ''} 
                                            {allNeurons.length > hotkeyedNeurons.length && 
                                                ` (${allNeurons.length - hotkeyedNeurons.length} additional reachable)`
                                            }
                                        </div>
                                    </div>
                                );
                            }
                            return null;
                        })()}
                        
                        {/* Neurons List */}
                        <div>
                            {(hotkeyNeurons?.neurons_by_owner || []).map(([owner, neurons], index) => (
                                <div key={owner} style={{
                                    background: theme.colors.primaryBg,
                                    borderRadius: '12px',
                                    padding: '1.25rem',
                                    marginBottom: '1rem',
                                    border: `1px solid ${theme.colors.border}`
                                }}>
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        borderBottom: `1px solid ${theme.colors.border}`,
                                        paddingBottom: '0.75rem',
                                        marginBottom: '1rem'
                                    }}>
                                        <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Owner:</span>
                                        <span style={{
                                            fontFamily: 'monospace',
                                            fontSize: '0.8rem',
                                            color: theme.colors.secondaryText,
                                            background: theme.colors.secondaryBg,
                                            padding: '0.25rem 0.5rem',
                                            borderRadius: '6px'
                                        }}>{owner.slice(0, 12)}...{owner.slice(-8)}</span>
                                    </div>
                                    
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                        {neurons.map((neuron, neuronIndex) => (
                                            <div key={neuronIndex} style={{
                                                background: theme.colors.secondaryBg,
                                                borderRadius: '10px',
                                                padding: '1rem',
                                                border: `1px solid ${theme.colors.border}`
                                            }}>
                                                {/* Neuron ID */}
                                                <div style={{
                                                    fontSize: '0.75rem',
                                                    color: theme.colors.mutedText,
                                                    fontFamily: 'monospace',
                                                    marginBottom: '0.75rem',
                                                    wordBreak: 'break-all',
                                                    background: theme.colors.primaryBg,
                                                    padding: '0.5rem',
                                                    borderRadius: '6px'
                                                }}>
                                                    {neuron.id && neuron.id[0] && neuron.id[0].id ? 
                                                        uint8ArrayToHex(neuron.id[0].id)
                                                        : 'Unknown'}
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
                                                            {new Date(Number(neuron.created_timestamp_seconds) * 1000).toLocaleDateString()}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>Dissolve State</div>
                                                        <div style={{ color: theme.colors.primaryText }}>{getDissolveState(neuron)}</div>
                                                    </div>
                                                    <div>
                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>Maturity</div>
                                                        <div style={{ color: theme.colors.primaryText }}>{formatE8s(neuron.maturity_e8s_equivalent)} {tokenSymbol}</div>
                                                    </div>
                                                    <div>
                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>Staked Amount</div>
                                                        <div style={{ color: theme.colors.primaryText }}>{formatE8s(neuron.cached_neuron_stake_e8s)} {tokenSymbol}</div>
                                                    </div>
                                                    <div>
                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>Voting Power</div>
                                                        <div style={{ color: accentPrimary, fontWeight: '600' }}>
                                                            {nervousSystemParameters ? 
                                                                formatVotingPower(calculateVotingPower(neuron, nervousSystemParameters)) :
                                                                (Number(neuron.voting_power_percentage_multiplier) / 100).toFixed(2) + 'x'
                                                            }
                                                        </div>
                                                    </div>
                                                    {neuron.permissions.some(p => 
                                                        p.principal?.toString() === identity.getPrincipal().toString() &&
                                                        p.permission_type.includes(4)
                                                    ) && (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                            <FaKey size={10} style={{ color: theme.colors.success }} />
                                                            <span style={{ color: theme.colors.success, fontSize: '0.8rem' }}>Hotkey Access</span>
                                                        </div>
                                                    )}
                                                </div>
                                                
                                                {/* Voting Section for Proposals */}
                                                {neuron.permissions.some(p => 
                                                    p.principal?.toString() === identity.getPrincipal().toString() &&
                                                    p.permission_type.includes(4)
                                                ) && proposalData && currentProposalId && (
                                                    <div style={{ marginTop: '1rem' }}>
                                                        {(() => {
                                                            const neuronId = neuron.id?.[0]?.id;
                                                            if (!neuronId) return null;
                                                            
                                                            const neuronIdHex = uint8ArrayToHex(neuronId);
                                                            const existingVote = getNeuronVote(neuronId);
                                                            const votingState = votingStates[neuronIdHex];
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
                                                                        background: theme.colors.primaryBg,
                                                                        borderRadius: '8px',
                                                                        color: theme.colors.mutedText,
                                                                        fontSize: '0.85rem'
                                                                    }}>
                                                                        Proposal not open for voting
                                                                    </div>
                                                                );
                                                            }
                                                            
                                                            const neuronVotingPower = nervousSystemParameters ? 
                                                                calculateVotingPower(neuron, nervousSystemParameters) : 0;
                                                            if (neuronVotingPower === 0) {
                                                                return (
                                                                    <div style={{
                                                                        padding: '0.75rem',
                                                                        background: theme.colors.primaryBg,
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
                                                                        background: theme.colors.primaryBg,
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
                                                                    background: theme.colors.primaryBg,
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
                                        ))}
                                    </div>
                                </div>
                            ))}
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
    );
};

export default HotkeyNeurons;
