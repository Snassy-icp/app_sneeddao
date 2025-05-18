import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from '../AuthContext';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import Header from '../components/Header';
import { fetchUserNeuronsForSns } from '../utils/NeuronUtils';
import { uint8ArrayToHex } from '../utils/NeuronUtils';
import Notification from '../Notification';

// Styles
const styles = {
    section: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginTop: '20px',
        color: '#ffffff'
    },
    heading: {
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        margin: '0 0 15px 0'
    },
    infoIcon: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        backgroundColor: '#3a3a3a',
        color: '#888',
        fontSize: '14px',
        cursor: 'help'
    },
    spinner: {
        width: '20px',
        height: '20px',
        border: '2px solid #f3f3f3',
        borderTop: '2px solid #3498db',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite'
    },
    sectionHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
    },
    expandButton: {
        background: 'none',
        border: 'none',
        color: '#3498db',
        cursor: 'pointer',
        fontSize: '20px',
        padding: '0 10px'
    },
    statusGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: '15px',
        marginTop: '15px'
    },
    statusItem: {
        display: 'flex',
        justifyContent: 'space-between',
        backgroundColor: '#3a3a3a',
        padding: '10px 15px',
        borderRadius: '4px',
        color: '#ffffff'
    },
    noNeuronsMessage: {
        backgroundColor: '#2a2a2a',
        padding: '20px',
        borderRadius: '8px',
        color: '#ffffff'
    },
    instructionsList: {
        marginTop: '15px',
        paddingLeft: '20px',
        lineHeight: '1.6'
    },
    principalCode: {
        backgroundColor: '#3a3a3a',
        padding: '4px 8px',
        borderRadius: '4px',
        fontFamily: 'monospace',
        wordBreak: 'break-all'
    }
};

// Add keyframes for spin animation
const spinKeyframes = `
@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
`;

// Add helper functions
const getDissolveState = (neuron) => {
    if (!neuron.dissolve_state?.[0]) return 'Unknown';
    
    if ('DissolveDelaySeconds' in neuron.dissolve_state[0]) {
        const seconds = Number(neuron.dissolve_state[0].DissolveDelaySeconds);
        const days = Math.floor(seconds / (24 * 60 * 60));
        return `Locked for ${days} days`;
    }
    
    if ('WhenDissolvedTimestampSeconds' in neuron.dissolve_state[0]) {
        const dissolveTime = Number(neuron.dissolve_state[0].WhenDissolvedTimestampSeconds);
        const now = Math.floor(Date.now() / 1000);
        if (dissolveTime <= now) {
            return 'Dissolved';
        }
        const daysLeft = Math.floor((dissolveTime - now) / (24 * 60 * 60));
        return `Dissolving (${daysLeft} days left)`;
    }
    
    return 'Unknown';
};

const formatE8s = (e8s) => {
    if (!e8s) return '0';
    return (Number(e8s) / 100000000).toFixed(8);
};

function Rewards() {
    const { identity, isAuthenticated, login } = useAuth();
    const [userBalances, setUserBalances] = useState([]);
    const [loadingUserBalances, setLoadingUserBalances] = useState(true);
    const [hotkeyNeurons, setHotkeyNeurons] = useState({
        neurons_by_owner: [],
        total_voting_power: 0,
        distribution_voting_power: 0
    });
    const [loadingHotkeyNeurons, setLoadingHotkeyNeurons] = useState(true);
    const [isClaimHistoryExpanded, setIsClaimHistoryExpanded] = useState(false);
    const [isHotkeyNeuronsExpanded, setIsHotkeyNeuronsExpanded] = useState(false);
    const [userClaimEvents, setUserClaimEvents] = useState([]);
    const [loadingUserEvents, setLoadingUserEvents] = useState(true);
    const [claimingTokens, setClaimingTokens] = useState({});
    const [notification, setNotification] = useState(null);
    const [tokenSymbols, setTokenSymbols] = useState({});

    // Function to fetch neurons directly from SNS
    const fetchNeuronsFromSns = async () => {
        const sneedGovernanceCanisterId = 'fi3zi-fyaaa-aaaaq-aachq-cai'; // Sneed governance canister
        return await fetchUserNeuronsForSns(identity, sneedGovernanceCanisterId);
    };

    // Add function to get token symbol
    const fetchTokenSymbol = async (tokenId) => {
        try {
            const icrc1Actor = createIcrc1Actor(tokenId.toString(), {
                agentOptions: { identity }
            });
            const metadata = await icrc1Actor.icrc1_metadata();
            const symbolEntry = metadata.find(entry => entry[0] === 'icrc1:symbol');
            if (symbolEntry && symbolEntry[1]) {
                return symbolEntry[1].Text;
            }
        } catch (error) {
            console.error('Error fetching token symbol:', error);
        }
        return tokenId.toString();
    };

    // Modify useEffect to fetch token symbols
    useEffect(() => {
        const fetchUserBalances = async () => {
            if (!isAuthenticated || !identity) {
                setLoadingUserBalances(false);
                return;
            }
            
            setLoadingUserBalances(true);
            try {
                const neurons = await fetchNeuronsFromSns();
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: { identity }
                });
                const balances = await rllActor.balances_of_hotkey_neurons(neurons);
                setUserBalances(balances);

                // Fetch symbols for all tokens
                const symbols = {};
                for (const [tokenId] of balances) {
                    symbols[tokenId.toString()] = await fetchTokenSymbol(tokenId);
                }
                setTokenSymbols(symbols);
            } catch (error) {
                console.error('Error fetching user balances:', error);
            } finally {
                setLoadingUserBalances(false);
            }
        };

        fetchUserBalances();
    }, [isAuthenticated, identity]);

    // Fetch hotkey neurons data
    useEffect(() => {
        const fetchHotkeyNeuronsData = async () => {
            if (!identity) {
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
    }, [isAuthenticated, identity]);

    // Fetch user claim events
    useEffect(() => {
        const fetchUserEvents = async () => {
            if (!isAuthenticated || !identity) {
                setLoadingUserEvents(false);
                return;
            }
            
            setLoadingUserEvents(true);
            try {
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: { identity }
                });
                const events = await rllActor.get_claim_events_for_hotkey(identity.getPrincipal());
                setUserClaimEvents(events);
            } catch (error) {
                console.error('Error fetching user events:', error);
            } finally {
                setLoadingUserEvents(false);
            }
        };

        fetchUserEvents();
    }, [isAuthenticated, identity]);

    // Add before the formatBalance function
    const handleClaimRewards = async (tokenId, balance) => {
        if (!balance || Number(balance) === 0) {
            setNotification({
                type: 'error',
                message: 'No rewards available to claim'
            });
            return;
        }

        setClaimingTokens(prev => ({ ...prev, [tokenId.toString()]: true }));
        try {
            const neurons = await fetchNeuronsFromSns();
            const rllActor = createRllActor(rllCanisterId, {
                agentOptions: { identity }
            });
            await rllActor.claim_hotkey_neuron_rewards(neurons, tokenId);
            setNotification({
                type: 'success',
                message: 'Successfully claimed rewards'
            });
            // Refresh balances
            const newBalances = await rllActor.balances_of_hotkey_neurons(neurons);
            setUserBalances(newBalances);
        } catch (error) {
            console.error('Error claiming rewards:', error);
            setNotification({
                type: 'error',
                message: 'Failed to claim rewards: ' + error.message
            });
        } finally {
            setClaimingTokens(prev => ({ ...prev, [tokenId.toString()]: false }));
        }
    };

    const formatBalance = (balance, decimals) => {
        if (!balance) return '0';
        return (Number(balance) / Math.pow(10, decimals)).toFixed(decimals);
    };

    // Add helper function to format status
    const formatStatus = (status) => {
        if (typeof status === 'object') {
            // If status is an object, get the key (e.g., {Pending: null} -> 'Pending')
            return Object.keys(status)[0];
        }
        return status;
    };

    // Add helper functions for event grouping and status
    const groupEventsBySequence = (events) => {
        const grouped = {};
        events.forEach(event => {
            const seqNum = event.sequence_number.toString();
            if (!grouped[seqNum]) {
                grouped[seqNum] = [];
            }
            grouped[seqNum].push(event);
        });
        return grouped;
    };

    const getGroupStatus = (events) => {
        if (events.some(e => 'Success' in e.status)) return 'Success';
        if (events.some(e => 'Failed' in e.status)) return 'Failed';
        if (events.some(e => 'Pending' in e.status)) return 'Pending';
        return 'Unknown';
    };

    const formatNanoTimestamp = (timestamp) => {
        return new Date(Number(timestamp) / 1_000_000).toLocaleString();
    };

    // Add styles for event items
    const eventStyles = {
        eventItem: {
            backgroundColor: '#3a3a3a',
            padding: '15px',
            borderRadius: '6px'
        },
        eventHeader: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px'
        },
        eventDetails: {
            display: 'flex',
            flexDirection: 'column',
            gap: '5px',
            color: '#888'
        }
    };

    return (
        <div className='page-container'>
            <Header />
            <main className="rll-container">
                <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>Sneed Rewards</h1>
                
                {!isAuthenticated ? (
                    <section style={styles.section}>
                        <h2 style={styles.heading}>
                            Sneed Voting Rewards
                            <span 
                                style={styles.infoIcon} 
                                title="Earn rewards by participating in Sneed DAO governance. Connect your wallet and add this principal as a hotkey to your neuron to start earning"
                            >
                                i
                            </span>
                        </h2>
                        <div style={{
                            textAlign: 'center',
                            padding: '20px',
                            backgroundColor: '#2a2a2a',
                            borderRadius: '8px',
                            marginTop: '20px'
                        }}>
                            <p style={{ 
                                color: '#ffffff', 
                                marginBottom: '20px',
                                fontSize: '1.1em'
                            }}>
                                Log in to claim your Sneed voting rewards
                            </p>
                            <button 
                                onClick={login}
                                style={{
                                    backgroundColor: '#3498db',
                                    color: 'white',
                                    border: 'none',
                                    padding: '10px 20px',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '1.1em'
                                }}
                            >
                                Login
                            </button>
                        </div>
                    </section>
                ) : hotkeyNeurons.total_voting_power > 0 ? (
                    <>
                        {/* Your Token Balances */}
                        <section style={styles.section}>
                            <h2 style={styles.heading}>
                                Your Rewards
                                <span 
                                    style={styles.infoIcon} 
                                    title="Tokens you've earned through Sneed DAO participation. Click 'Claim' to transfer rewards to your wallet"
                                >
                                    i
                                </span>
                            </h2>
                            <p style={{ 
                                color: '#ffffff', 
                                marginBottom: '20px',
                                fontSize: '1.1em'
                            }}>
                                Claimed rewards are available in your SneedLock wallet <Link 
                                    to="/wallet"
                                    style={{ 
                                        color: '#3498db',
                                        textDecoration: 'none',
                                        fontWeight: 'bold'
                                    }}
                                >
                                    here
                                </Link>.
                            </p>
                            {loadingUserBalances ? (
                                <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                                    <div style={styles.spinner} />
                                </div>
                            ) : userBalances.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                    {userBalances.map(([tokenId, balance]) => (
                                        <div key={tokenId.toString()} style={{
                                            backgroundColor: '#3a3a3a',
                                            padding: '15px',
                                            borderRadius: '6px',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center'
                                        }}>
                                            <div>
                                                <div style={{ fontSize: '18px', marginBottom: '5px' }}>
                                                    {tokenSymbols[tokenId.toString()] || tokenId.toString()}
                                                </div>
                                                <div style={{ color: '#888' }}>
                                                    Balance: {formatBalance(balance, 8)}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleClaimRewards(tokenId, balance)}
                                                disabled={claimingTokens[tokenId.toString()]}
                                                style={{
                                                    backgroundColor: '#3498db',
                                                    color: '#ffffff',
                                                    border: 'none',
                                                    borderRadius: '4px',
                                                    padding: '8px 16px',
                                                    cursor: claimingTokens[tokenId.toString()] ? 'not-allowed' : 'pointer',
                                                    opacity: claimingTokens[tokenId.toString()] ? 0.7 : 1
                                                }}
                                            >
                                                {claimingTokens[tokenId.toString()] ? 'Claiming...' : 'Claim'}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p>No rewards available to claim</p>
                            )}
                        </section>

                        {/* Your Claim History */}
                        <section style={styles.section}>
                            <div style={styles.sectionHeader}>
                                <h2 style={styles.heading}>
                                    Your Claim History
                                    <span 
                                        style={styles.infoIcon} 
                                        title="History of your token claim events, including status, timestamps, and amounts"
                                    >
                                        i
                                    </span>
                                </h2>
                                <button 
                                    onClick={() => setIsClaimHistoryExpanded(!isClaimHistoryExpanded)}
                                    style={styles.expandButton}
                                >
                                    {isClaimHistoryExpanded ? '▼' : '▶'}
                                </button>
                            </div>
                            {isClaimHistoryExpanded && (
                                loadingUserEvents ? (
                                    <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                                        <div style={styles.spinner} />
                                    </div>
                                ) : userClaimEvents.length > 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                        {Object.entries(groupEventsBySequence(userClaimEvents))
                                            .sort((a, b) => Number(b[0]) - Number(a[0])) // Sort by sequence number descending
                                            .slice(0, 5) // Take only the 5 most recent sequence groups
                                            .map(([seqNum, events]) => {
                                                const status = getGroupStatus(events);
                                                const latestEvent = events[events.length - 1];

                                                return (
                                                    <div key={seqNum} style={eventStyles.eventItem}>
                                                        <div style={eventStyles.eventHeader}>
                                                            <span style={{
                                                                color: status === 'Success' ? '#2ecc71' : 
                                                                       status === 'Pending' ? '#f1c40f' : 
                                                                       status === 'Failed' ? '#e74c3c' : '#ffffff'
                                                            }}>
                                                                {status}
                                                            </span>
                                                            <span>{formatNanoTimestamp(latestEvent.timestamp_nanos)}</span>
                                                        </div>
                                                        <div style={eventStyles.eventDetails}>
                                                            <span>Sequence: {seqNum}</span>
                                                            <span>Amount: {formatBalance(latestEvent.amount, 8)} {tokenSymbols[latestEvent.token_id.toString()] || latestEvent.token_id.toString()}</span>
                                                            <span>Fee: {formatBalance(latestEvent.fee, 8)} {tokenSymbols[latestEvent.token_id.toString()] || latestEvent.token_id.toString()}</span>
                                                            {events.some(e => e.tx_index && e.tx_index.length > 0) && (
                                                                <span>Transaction ID: {events.find(e => e.tx_index && e.tx_index.length > 0).tx_index[0].toString()}</span>
                                                            )}
                                                            {events.map((event, idx) => (
                                                                event.error_message && event.error_message.length > 0 && (
                                                                    <span key={idx} style={{ color: '#e74c3c' }}>
                                                                        Message: {event.error_message[0]}
                                                                    </span>
                                                                )
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                    </div>
                                ) : (
                                    <p>No claim history available</p>
                                )
                            )}
                        </section>

                        {/* Your Hotkey Neurons */}
                        <section style={styles.section}>
                            <div style={styles.sectionHeader}>
                                <h2 style={styles.heading}>
                                    Your Hotkey Neurons
                                    <span 
                                        style={styles.infoIcon} 
                                        title="For each NNS account (Internet Identity) containing Sneed neurons, you only need to configure one neuron as a hotkey. All other Sneed neurons in the same account will be automatically accessible. If you have multiple NNS accounts with Sneed neurons, you'll need to set up one hotkey neuron per account."
                                    >
                                        i
                                    </span>
                                </h2>
                                <button 
                                    onClick={() => setIsHotkeyNeuronsExpanded(!isHotkeyNeuronsExpanded)}
                                    style={styles.expandButton}
                                >
                                    {isHotkeyNeuronsExpanded ? '▼' : '▶'}
                                </button>
                            </div>
                            {isHotkeyNeuronsExpanded && (
                                loadingHotkeyNeurons ? (
                                    <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                                        <div style={styles.spinner} />
                                    </div>
                                ) : (
                                    <div>
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
                                        
                                        <div style={{marginTop: '20px'}}>
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
                        </section>
                    </>
                ) : (
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
                )}

                {notification && (
                    <Notification
                        type={notification.type}
                        message={notification.message}
                        onClose={() => setNotification(null)}
                    />
                )}
            </main>
            <style>{spinKeyframes}</style>
        </div>
    );
}

export default Rewards; 