import React, { useState, useEffect } from 'react';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { useAuth } from '../AuthContext';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { getSnsById } from '../utils/SnsUtils';
import { useSns } from '../contexts/SnsContext';

const HotkeyNeurons = ({ 
    fetchNeuronsFromSns, 
    showVotingStats = true, 
    showExpandButton = true,
    defaultExpanded = false,
    title = "Your Hotkey Neurons",
    infoTooltip = "For each NNS account (Internet Identity) containing SNS neurons, you only need to configure one neuron as a hotkey per SNS. All other neurons of the same SNS in the same account will be automatically accessible. If you have multiple NNS accounts with Sneed neurons, you'll need to set up one hotkey neuron per account.",
    proposalData = null,
    currentProposalId = null,
    onVoteSuccess = null
}) => {
    const { isAuthenticated, identity } = useAuth();
    const { selectedSnsRoot } = useSns();
    const [hotkeyNeurons, setHotkeyNeurons] = useState({
        neurons_by_owner: [],
        total_voting_power: 0,
        distribution_voting_power: 0
    });
    const [loadingHotkeyNeurons, setLoadingHotkeyNeurons] = useState(false);
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const [votingStates, setVotingStates] = useState({});

    // Helper functions
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

    // Check if proposal is open for voting
    const isProposalOpenForVoting = () => {
        if (!proposalData) return false;
        try {
            const now = BigInt(Math.floor(Date.now() / 1000));
            const executed = BigInt(proposalData.executed_timestamp_seconds || 0);
            const failed = BigInt(proposalData.failed_timestamp_seconds || 0);
            const decided = BigInt(proposalData.decided_timestamp_seconds || 0);
            const created = BigInt(proposalData.proposal_creation_timestamp_seconds || 0);
            const votingPeriod = BigInt(proposalData.initial_voting_period_seconds || 0);
            
            return executed === 0n && failed === 0n && decided === 0n && (created + votingPeriod > now);
        } catch (err) {
            console.error('Error checking proposal status:', err);
            return false;
        }
    };

    // Check if a neuron has already voted on the proposal
    const getNeuronVote = (neuronId) => {
        if (!proposalData?.ballots || !neuronId) {
            return null;
        }
        
        const neuronIdHex = uint8ArrayToHex(neuronId);
        const ballot = proposalData.ballots.find(([id, _]) => id === neuronIdHex);
        
        console.log('Checking vote for neuron:', neuronIdHex);
        console.log('Available ballots:', proposalData.ballots);
        console.log('Found ballot:', ballot);
        
        if (ballot && ballot[1]) {
            const ballotData = ballot[1];
            // A neuron has voted if cast_timestamp_seconds > 0
            const hasVoted = ballotData.cast_timestamp_seconds && Number(ballotData.cast_timestamp_seconds) > 0;
            
            if (hasVoted) {
                return ballotData;
            }
        }
        
        return null;
    };

    // Format vote for display
    const formatVote = (voteNumber) => {
        switch (voteNumber) {
            case 1: return { text: 'Adopt', color: '#2ecc71' };
            case 2: return { text: 'Reject', color: '#e74c3c' };
            default: return { text: 'Not Voted', color: '#888' };
        }
    };

    // Vote with a specific neuron
    const voteWithNeuron = async (neuronId, vote) => {
        if (!identity || !selectedSnsRoot || !currentProposalId) return;
        
        const neuronIdHex = uint8ArrayToHex(neuronId);
        setVotingStates(prev => ({ ...prev, [neuronIdHex]: 'voting' }));
        
        try {
            const selectedSns = getSnsById(selectedSnsRoot);
            if (!selectedSns) throw new Error('SNS not found');
            
            const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                agentOptions: { identity }
            });
            
            const manageNeuronRequest = {
                subaccount: neuronId,
                command: [{
                    RegisterVote: {
                        vote: vote, // 1 for Adopt, 2 for Reject
                        proposal: [{ id: BigInt(currentProposalId) }]
                    }
                }]
            };
            
            const response = await snsGovActor.manage_neuron(manageNeuronRequest);
            
            if (response?.command?.[0]?.RegisterVote) {
                setVotingStates(prev => ({ ...prev, [neuronIdHex]: 'success' }));
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

    // Vote with all neurons
    const voteWithAllNeurons = async (vote) => {
        if (!neurons || !proposalData || !currentProposalId) {
            alert('Missing required data for voting');
            return;
        }

        try {
            // Filter eligible neurons
            const eligibleNeurons = neurons.filter(neuron => {
                // Check if neuron has hotkey access
                const hasHotkeyAccess = neuron.permissions.some(p => p.permission_type.includes(4));
                if (!hasHotkeyAccess) return false;

                // Check if neuron has already voted using the same logic as getNeuronVote
                const neuronIdHex = uint8ArrayToHex(neuron.id[0]?.id);
                const ballot = proposalData.ballots?.find(([id, _]) => id === neuronIdHex);
                
                if (ballot && ballot[1]) {
                    const ballotData = ballot[1];
                    const hasVoted = ballotData.cast_timestamp_seconds && Number(ballotData.cast_timestamp_seconds) > 0;
                    if (hasVoted) return false; // Skip neurons that have already voted
                }

                return true;
            });

            // Debug logging
            console.log('Vote All Debug:', {
                totalNeurons: neurons.length,
                eligibleNeurons: eligibleNeurons.length,
                userPrincipal: identity?.getPrincipal()?.toString(),
                proposalData: !!proposalData,
                currentProposalId,
                ballotsCount: proposalData?.ballots?.length || 0
            });

            if (eligibleNeurons.length === 0) {
                const neuronsWithHotkey = neurons.filter(neuron => 
                    neuron.permissions.some(p => p.permission_type.includes(4))
                ).length;
                
                const neuronsAlreadyVoted = neurons.filter(neuron => {
                    const neuronIdHex = uint8ArrayToHex(neuron.id[0]?.id);
                    const ballot = proposalData.ballots?.find(([id, _]) => id === neuronIdHex);
                    if (ballot && ballot[1]) {
                        const ballotData = ballot[1];
                        return ballotData.cast_timestamp_seconds && Number(ballotData.cast_timestamp_seconds) > 0;
                    }
                    return false;
                }).length;

                alert(`No eligible neurons found for voting.\n\nTotal neurons: ${neurons.length}\nNeurons with hotkey access: ${neuronsWithHotkey}\nNeurons that already voted: ${neuronsAlreadyVoted}\nEligible neurons: ${eligibleNeurons.length}`);
                return;
            }

            // Vote with all eligible neurons
            for (const neuron of eligibleNeurons) {
                await voteWithNeuron(neuron.id[0].id, vote);
            }

            alert(`Successfully voted with ${eligibleNeurons.length} neurons!`);
            if (onVoteSuccess) {
                onVoteSuccess();
            }
        } catch (error) {
            console.error('Error voting with all neurons:', error);
            alert('Error voting with all neurons: ' + error.message);
        }
    };

    // Fetch hotkey neurons data
    useEffect(() => {
        const fetchHotkeyNeuronsData = async () => {
            if (!identity || !fetchNeuronsFromSns) {
                setLoadingHotkeyNeurons(false);
                return;
            }
            
            setLoadingHotkeyNeurons(true);
            try {
                const neurons = await fetchNeuronsFromSns();
                const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
                const result = await rllActor.get_hotkey_voting_power(neurons);
                setHotkeyNeurons(result);
            } catch (error) {
                console.error('Error fetching hotkey neurons:', error);
                setHotkeyNeurons({
                    neurons_by_owner: [],
                    total_voting_power: 0,
                    distribution_voting_power: 0
                });
            } finally {
                setLoadingHotkeyNeurons(false);
            }
        };

        if (isAuthenticated && identity) {
            fetchHotkeyNeuronsData();
        } else {
            setLoadingHotkeyNeurons(false);
        }
    }, [isAuthenticated, identity, fetchNeuronsFromSns]);

    const styles = {
        section: {
            backgroundColor: '#2a2a2a',
            borderRadius: '8px',
            padding: '20px',
            marginBottom: '20px',
            border: '1px solid #3a3a3a'
        },
        sectionHeader: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '15px'
        },
        heading: {
            color: '#ffffff',
            fontSize: '1.5em',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
        },
        infoIcon: {
            display: 'inline-block',
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            backgroundColor: '#3498db',
            color: 'white',
            fontSize: '12px',
            textAlign: 'center',
            lineHeight: '16px',
            cursor: 'help',
            fontWeight: 'bold'
        },
        expandButton: {
            backgroundColor: 'transparent',
            border: 'none',
            color: '#3498db',
            cursor: 'pointer',
            fontSize: '1.2em',
            padding: '5px'
        },
        statusGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '15px',
            marginBottom: '20px'
        },
        statusItem: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            color: '#888',
            fontSize: '14px'
        },
        spinner: {
            border: '3px solid #3a3a3a',
            borderTop: '3px solid #3498db',
            borderRadius: '50%',
            width: '30px',
            height: '30px',
            animation: 'spin 1s linear infinite'
        },
        noNeuronsMessage: {
            textAlign: 'center',
            color: '#888',
            padding: '20px'
        },
        instructionsList: {
            textAlign: 'left',
            color: '#ccc',
            marginTop: '15px'
        },
        principalCode: {
            backgroundColor: '#3a3a3a',
            padding: '2px 6px',
            borderRadius: '3px',
            fontFamily: 'monospace',
            color: '#3498db'
        },
        voteButton: {
            padding: '6px 12px',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 'bold',
            minWidth: '60px'
        },
        adoptButton: {
            backgroundColor: '#2ecc71',
            color: 'white'
        },
        rejectButton: {
            backgroundColor: '#e74c3c',
            color: 'white'
        },
        voteAllContainer: {
            display: 'flex',
            gap: '10px',
            marginBottom: '15px',
            padding: '15px',
            backgroundColor: '#3a3a3a',
            borderRadius: '6px',
            alignItems: 'center'
        },
        voteAllButton: {
            padding: '8px 16px',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold'
        }
    };

    if (!isAuthenticated) {
        return (
            <section style={styles.section}>
                <h2 style={styles.heading}>
                    {title}
                    <span style={styles.infoIcon} title={infoTooltip}>i</span>
                </h2>
                <div style={styles.noNeuronsMessage}>
                    <p>Please connect your wallet to view your hotkey neurons.</p>
                </div>
            </section>
        );
    }

    if (hotkeyNeurons.neurons_by_owner.length === 0 && !loadingHotkeyNeurons) {
        return (
            <section style={styles.section}>
                <h2 style={styles.heading}>
                    Add Your Principal as a Hotkey
                    <span 
                        style={styles.infoIcon} 
                        title="To participate in Sneed DAO and earn rewards, add your principal as a hotkey to one Sneed neuron in your NNS account. This will automatically give access to all other Sneed neurons in the same account. If you have multiple NNS accounts (different Internet Identities), you'll need to set up one hotkey neuron per account."
                    >
                        i
                    </span>
                </h2>
                <div style={styles.noNeuronsMessage}>
                    <p>To participate in Sneed DAO and earn rewards:</p>
                    <ol style={styles.instructionsList}>
                        <li>First, you need to have a Sneed neuron</li>
                        <li>Add your principal from this application as a hotkey to your neuron</li>
                        <li>Your current principal is: <code style={styles.principalCode}>{identity && identity.getPrincipal ? identity.getPrincipal().toText() : 'Not connected'}</code></li>
                        <li>Once added as a hotkey, you'll be able to claim voting rewards, see your balances, claim history, and neurons here</li>
                    </ol>
                    <button 
                        onClick={() => window.location.reload()}
                        style={{
                            backgroundColor: '#3498db',
                            color: 'white',
                            border: 'none',
                            padding: '10px 20px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            marginTop: '20px',
                            fontSize: '1.1em'
                        }}
                    >
                        Check Hotkey Status
                    </button>
                </div>
            </section>
        );
    }

    return (
        <section style={styles.section}>
            <div style={styles.sectionHeader}>
                <h2 style={styles.heading}>
                    {title}
                    <span style={styles.infoIcon} title={infoTooltip}>i</span>
                </h2>
                {showExpandButton && (
                    <button 
                        onClick={() => setIsExpanded(!isExpanded)}
                        style={styles.expandButton}
                    >
                        {isExpanded ? '▼' : '▶'}
                    </button>
                )}
            </div>
            {(isExpanded || !showExpandButton) && (
                loadingHotkeyNeurons ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                        <div style={styles.spinner} />
                    </div>
                ) : (
                    <div>
                        {showVotingStats && (
                            <div style={styles.statusGrid}>
                                <div style={styles.statusItem}>
                                    <span title="The sum of all voting power you have cast across all Sneed proposals through your hotkey neurons">Total Voting Power:</span>
                                    <span title="Your total voting power used across all Sneed proposals">{Number(hotkeyNeurons.total_voting_power).toLocaleString()}</span>
                                </div>
                                <div style={styles.statusItem}>
                                    <span title="The sum of all voting power cast by all users across all Sneed proposals">Distribution Voting Power:</span>
                                    <span title="Total voting power from all users participating in Sneed proposals">{Number(hotkeyNeurons.distribution_voting_power).toLocaleString()}</span>
                                </div>
                                <div style={styles.statusItem}>
                                    <span title="Your percentage share of the total distribution voting power, which determines your share of distributed rewards">Your Voting Share:</span>
                                    <span title="This percentage represents your share of distributed rewards based on your voting participation">{((Number(hotkeyNeurons.total_voting_power) / Number(hotkeyNeurons.distribution_voting_power)) * 100).toFixed(2)}%</span>
                                </div>
                            </div>
                        )}
                        
                        {/* Vote All buttons for open proposals */}
                        {proposalData && isProposalOpenForVoting() && (
                            <div style={styles.voteAllContainer}>
                                <span style={{ color: '#ffffff', fontWeight: 'bold' }}>Vote with all eligible neurons:</span>
                                <button 
                                    style={{...styles.voteAllButton, ...styles.adoptButton}}
                                    onClick={() => voteWithAllNeurons(1)}
                                >
                                    Adopt All
                                </button>
                                <button 
                                    style={{...styles.voteAllButton, ...styles.rejectButton}}
                                    onClick={() => voteWithAllNeurons(2)}
                                >
                                    Reject All
                                </button>
                            </div>
                        )}
                        
                        <div style={{marginTop: showVotingStats ? '20px' : '0'}}>
                            {hotkeyNeurons.neurons_by_owner.map(([owner, neurons], index) => (
                                <div key={owner.toText()} style={{
                                    backgroundColor: '#3a3a3a',
                                    borderRadius: '6px',
                                    padding: '15px',
                                    marginBottom: '15px'
                                }}>
                                    <div style={{
                                        ...styles.statusItem,
                                        borderBottom: '1px solid #4a4a4a',
                                        paddingBottom: '10px',
                                        marginBottom: '10px'
                                    }}>
                                        <span>Owner:</span>
                                        <span style={{fontFamily: 'monospace'}}>{owner.toText()}</span>
                                    </div>
                                    <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
                                        {neurons.map((neuron, neuronIndex) => (
                                            <div key={neuronIndex} style={{
                                                backgroundColor: '#2a2a2a',
                                                borderRadius: '4px',
                                                padding: '10px'
                                            }}>
                                                <div style={styles.statusItem}>
                                                    <span>Neuron ID:</span>
                                                    <span style={{
                                                        fontFamily: 'monospace',
                                                        wordBreak: 'break-all',
                                                        maxWidth: '100%'
                                                    }}>
                                                        {neuron.id && neuron.id[0] && neuron.id[0].id ? 
                                                            uint8ArrayToHex(neuron.id[0].id)
                                                            : 'Unknown'}
                                                    </span>
                                                </div>
                                                <div style={{ 
                                                    display: 'grid',
                                                    gridTemplateColumns: '1fr 1fr',
                                                    gap: '15px',
                                                    fontSize: '14px',
                                                    marginTop: '10px'
                                                }}>
                                                    <div>
                                                        <div style={{ color: '#888' }}>Created</div>
                                                        <div style={{ color: '#ffffff' }}>
                                                            {new Date(Number(neuron.created_timestamp_seconds) * 1000).toLocaleDateString()}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div style={{ color: '#888' }}>Dissolve State</div>
                                                        <div style={{ color: '#ffffff' }}>{getDissolveState(neuron)}</div>
                                                    </div>
                                                    <div>
                                                        <div style={{ color: '#888' }}>Maturity</div>
                                                        <div style={{ color: '#ffffff' }}>{formatE8s(neuron.maturity_e8s_equivalent)} SNEED</div>
                                                    </div>
                                                    <div>
                                                        <div style={{ color: '#888' }}>Voting Power</div>
                                                        <div style={{ color: '#ffffff' }}>{(Number(neuron.voting_power_percentage_multiplier) / 100).toFixed(2)}x</div>
                                                    </div>
                                                    {neuron.permissions.some(p => 
                                                        p.principal?.toString() === identity.getPrincipal().toString() &&
                                                        p.permission_type.includes(4)
                                                    ) && (
                                                        <div style={{ gridColumn: '1 / -1' }}>
                                                            <div style={{ 
                                                                color: '#888',
                                                                fontSize: '14px',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '5px'
                                                            }}>
                                                                <span style={{ color: '#2ecc71' }}>🔑 Hotkey Access</span>
                                                            </div>
                                                            
                                                            {/* Voting section for proposals */}
                                                            {(() => {
                                                                console.log('Voting section check:', {
                                                                    hasProposalData: !!proposalData,
                                                                    hasCurrentProposalId: !!currentProposalId,
                                                                    shouldShow: !!(proposalData && currentProposalId)
                                                                });
                                                                return proposalData && currentProposalId;
                                                            })() && (
                                                                <div style={{ marginTop: '10px' }}>
                                                                    {(() => {
                                                                        const neuronId = neuron.id?.[0]?.id;
                                                                        if (!neuronId) return null;
                                                                        
                                                                        const neuronIdHex = uint8ArrayToHex(neuronId);
                                                                        const existingVote = getNeuronVote(neuronId);
                                                                        const votingState = votingStates[neuronIdHex];
                                                                        const isOpen = isProposalOpenForVoting();
                                                                        
                                                                        // Debug logging for individual neurons
                                                                        console.log(`Neuron ${neuronIdHex} voting debug:`, {
                                                                            hasProposalData: !!proposalData,
                                                                            hasCurrentProposalId: !!currentProposalId,
                                                                            existingVote,
                                                                            isOpen,
                                                                            votingState
                                                                        });
                                                                        
                                                                        if (existingVote) {
                                                                            const voteInfo = formatVote(existingVote.vote);
                                                                            return (
                                                                                <div style={{
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    gap: '8px',
                                                                                    padding: '8px',
                                                                                    backgroundColor: '#1a1a1a',
                                                                                    borderRadius: '4px'
                                                                                }}>
                                                                                    <span style={{ color: '#888' }}>Vote:</span>
                                                                                    <span style={{ 
                                                                                        color: voteInfo.color,
                                                                                        fontWeight: 'bold'
                                                                                    }}>
                                                                                        {voteInfo.text}
                                                                                    </span>
                                                                                </div>
                                                                            );
                                                                        }
                                                                        
                                                                        if (!isOpen) {
                                                                            return (
                                                                                <div style={{
                                                                                    padding: '8px',
                                                                                    backgroundColor: '#1a1a1a',
                                                                                    borderRadius: '4px',
                                                                                    color: '#888'
                                                                                }}>
                                                                                    Proposal not open for voting
                                                                                </div>
                                                                            );
                                                                        }
                                                                        
                                                                        if (votingState === 'voting') {
                                                                            return (
                                                                                <div style={{
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    gap: '8px',
                                                                                    padding: '8px',
                                                                                    backgroundColor: '#1a1a1a',
                                                                                    borderRadius: '4px'
                                                                                }}>
                                                                                    <div style={{
                                                                                        width: '16px',
                                                                                        height: '16px',
                                                                                        border: '2px solid #3498db',
                                                                                        borderTop: '2px solid transparent',
                                                                                        borderRadius: '50%',
                                                                                        animation: 'spin 1s linear infinite'
                                                                                    }} />
                                                                                    <span style={{ color: '#3498db' }}>Voting...</span>
                                                                                </div>
                                                                            );
                                                                        }
                                                                        
                                                                        if (votingState === 'success') {
                                                                            return (
                                                                                <div style={{
                                                                                    padding: '8px',
                                                                                    backgroundColor: '#1a1a1a',
                                                                                    borderRadius: '4px',
                                                                                    color: '#2ecc71'
                                                                                }}>
                                                                                    ✓ Vote submitted successfully
                                                                                </div>
                                                                            );
                                                                        }
                                                                        
                                                                        if (votingState === 'error') {
                                                                            return (
                                                                                <div style={{
                                                                                    display: 'flex',
                                                                                    gap: '8px',
                                                                                    padding: '8px',
                                                                                    backgroundColor: '#1a1a1a',
                                                                                    borderRadius: '4px'
                                                                                }}>
                                                                                    <span style={{ color: '#e74c3c' }}>✗ Voting failed</span>
                                                                                    <button 
                                                                                        style={{...styles.voteButton, ...styles.adoptButton}}
                                                                                        onClick={() => voteWithNeuron(neuronId, 1)}
                                                                                    >
                                                                                        Adopt
                                                                                    </button>
                                                                                    <button 
                                                                                        style={{...styles.voteButton, ...styles.rejectButton}}
                                                                                        onClick={() => voteWithNeuron(neuronId, 2)}
                                                                                    >
                                                                                        Reject
                                                                                    </button>
                                                                                </div>
                                                                            );
                                                                        }
                                                                        
                                                                        // Default: show voting buttons
                                                                        return (
                                                                            <div style={{
                                                                                display: 'flex',
                                                                                gap: '8px',
                                                                                padding: '8px',
                                                                                backgroundColor: '#1a1a1a',
                                                                                borderRadius: '4px'
                                                                            }}>
                                                                                <span style={{ color: '#888', alignSelf: 'center' }}>Vote:</span>
                                                                                <button 
                                                                                    style={{...styles.voteButton, ...styles.adoptButton}}
                                                                                    onClick={() => voteWithNeuron(neuronId, 1)}
                                                                                >
                                                                                    Adopt
                                                                                </button>
                                                                                <button 
                                                                                    style={{...styles.voteButton, ...styles.rejectButton}}
                                                                                    onClick={() => voteWithNeuron(neuronId, 2)}
                                                                                >
                                                                                    Reject
                                                                                </button>
                                                                            </div>
                                                                        );
                                                                    })()}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
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
        </section>
    );
};

export default HotkeyNeurons; 