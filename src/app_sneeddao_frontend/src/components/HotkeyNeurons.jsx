import React, { useState, useEffect } from 'react';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { useAuth } from '../AuthContext';

const HotkeyNeurons = ({ 
    fetchNeuronsFromSns, 
    showVotingStats = true, 
    showExpandButton = true,
    defaultExpanded = false,
    title = "Your Hotkey Neurons",
    infoTooltip = "For each NNS account (Internet Identity) containing SNS neurons, you only need to configure one neuron as a hotkey per SNS. All other neurons of the same SNS in the same account will be automatically accessible. If you have multiple NNS accounts with Sneed neurons, you'll need to set up one hotkey neuron per account."
}) => {
    const { isAuthenticated, identity } = useAuth();
    const [hotkeyNeurons, setHotkeyNeurons] = useState({
        neurons_by_owner: [],
        total_voting_power: 0,
        distribution_voting_power: 0
    });
    const [loadingHotkeyNeurons, setLoadingHotkeyNeurons] = useState(false);
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    // Helper functions
    const uint8ArrayToHex = (uint8Array) => {
        return Array.from(uint8Array)
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join('');
    };

    const getDissolveState = (neuron) => {
        if (neuron.dissolve_state && neuron.dissolve_state[0]) {
            const state = neuron.dissolve_state[0];
            if ('DissolveDelaySeconds' in state) {
                const delaySeconds = Number(state.DissolveDelaySeconds);
                const delayDays = Math.floor(delaySeconds / (24 * 60 * 60));
                return `${delayDays} days`;
            } else if ('WhenDissolvedTimestampSeconds' in state) {
                const dissolveTime = Number(state.WhenDissolvedTimestampSeconds) * 1000;
                const now = Date.now();
                if (dissolveTime <= now) {
                    return 'Dissolved';
                } else {
                    const remainingMs = dissolveTime - now;
                    const remainingDays = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
                    return `Dissolving (${remainingDays} days)`;
                }
            }
        }
        return 'Unknown';
    };

    const formatE8s = (e8s) => {
        return (Number(e8s) / 100_000_000).toFixed(2);
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