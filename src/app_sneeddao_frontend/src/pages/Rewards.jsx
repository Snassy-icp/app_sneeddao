import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import Header from '../components/Header';
import { fetchUserNeuronsForSns } from '../utils/NeuronUtils';
import Notification from '../Notification';
import HotkeyNeurons from '../components/HotkeyNeurons';

// Theme-aware styles function
const getStyles = (theme) => ({
    section: {
        backgroundColor: theme.colors.secondaryBg,
        borderRadius: '8px',
        padding: '20px',
        marginTop: '20px',
        color: theme.colors.primaryText
    },
    heading: {
        color: theme.colors.primaryText,
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
        backgroundColor: theme.colors.tertiaryBg,
        color: theme.colors.mutedText,
        fontSize: '14px',
        cursor: 'help'
    },
    spinner: {
        width: '20px',
        height: '20px',
        border: `2px solid ${theme.colors.border}`,
        borderTop: `2px solid ${theme.colors.accent}`,
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
        color: theme.colors.accent,
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
        backgroundColor: theme.colors.tertiaryBg,
        padding: '10px 15px',
        borderRadius: '4px',
        color: theme.colors.primaryText
    },
    noNeuronsMessage: {
        backgroundColor: theme.colors.secondaryBg,
        padding: '20px',
        borderRadius: '8px',
        color: theme.colors.primaryText
    },
    instructionsList: {
        marginTop: '15px',
        paddingLeft: '20px',
        lineHeight: '1.6'
    },
    principalCode: {
        backgroundColor: theme.colors.tertiaryBg,
        padding: '4px 8px',
        borderRadius: '4px',
        fontFamily: 'monospace',
        wordBreak: 'break-all'
    }
});

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
    const { theme } = useTheme();
    const [userBalances, setUserBalances] = useState([]);
    const [loadingUserBalances, setLoadingUserBalances] = useState(true);
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

    // Add function to get token fee
    const fetchTokenFee = async (tokenId) => {
        try {
            const icrc1Actor = createIcrc1Actor(tokenId.toString(), {
                agentOptions: { identity }
            });
            const metadata = await icrc1Actor.icrc1_metadata();
            const feeEntry = metadata.find(entry => entry[0] === 'icrc1:fee');
            if (feeEntry && feeEntry[1]) {
                return BigInt(feeEntry[1].Nat);
            }
        } catch (error) {
            console.error('Error fetching token fee:', error);
        }
        return BigInt(10000); // Default fee if not found
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
        // Check if balance is 0
        if (!balance || Number(balance) === 0) {
            setNotification({
                type: 'error',
                message: 'No rewards available to claim'
            });
            return;
        }

        // Get token info including fee
        const fee = await fetchTokenFee(tokenId);
        const token = {
            id: tokenId,
            symbol: tokenSymbols[tokenId.toString()] || tokenId.toString(),
            fee: fee
        };

        console.log("balance", balance, "token.fee", token.fee);
        // Check if balance is less than or equal to fee
        if (balance <= token.fee) {
            const msg = `Your ${token.symbol} rewards (${formatBalance(balance, 8)} ${token.symbol}) are less than the transaction fee (${formatBalance(token.fee, 8)} ${token.symbol}). Please wait until you have accumulated more rewards before claiming.`;
            console.error(msg);
            setNotification({
                type: 'error',
                message: msg
            });
            return;
        }

        setClaimingTokens(prev => ({ ...prev, [tokenId.toString()]: true }));
        try {
            const rllActor = createRllActor(rllCanisterId, {
                agentOptions: { identity }
            });
            const claim_results = await rllActor.claim_full_balance_of_hotkey(tokenId, token.fee);
            
            // Check the result
            if ('Ok' in claim_results) {
                setNotification({
                    type: 'success',
                    message: `Successfully claimed ${formatBalance(balance, 8)} ${token.symbol}`
                });
                // Refresh balances
                const neurons = await fetchNeuronsFromSns();
                const newBalances = await rllActor.balances_of_hotkey_neurons(neurons);
                setUserBalances(newBalances);
            } else {
                // Handle specific transfer errors
                const error = claim_results.Err;
                let errorMessage = '';
                
                if (error.InsufficientFunds) {
                    const availableBalance = error.InsufficientFunds.balance;
                    errorMessage = `Insufficient funds. Available balance: ${formatBalance(availableBalance, 8)} ${token.symbol}`;
                } else if (error.BadFee) {
                    const expectedFee = error.BadFee.expected_fee;
                    errorMessage = `Your ${token.symbol} rewards are less than the transaction fee (${formatBalance(expectedFee, 8)} ${token.symbol}). Please wait until you have accumulated more rewards before claiming.`;
                } else if (error.GenericError) {
                    errorMessage = error.GenericError.message;
                } else {
                    errorMessage = `Transfer failed: ${Object.keys(error)[0]}`;
                }
                
                setNotification({
                    type: 'error',
                    message: errorMessage
                });
            }
        } catch (error) {
            console.error('Error claiming rewards:', error);
            setNotification({
                type: 'error',
                message: `Failed to claim ${token.symbol}: ${error.message}`
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

    // Theme-aware event styles
    const styles = getStyles(theme);
    const eventStyles = {
        eventItem: {
            backgroundColor: theme.colors.tertiaryBg,
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
            color: theme.colors.mutedText
        }
    };

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main className="rll-container">
                <h1 style={{ color: theme.colors.primaryText, marginBottom: '20px' }}>Sneed Rewards</h1>
                
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
                            backgroundColor: theme.colors.secondaryBg,
                            borderRadius: '8px',
                            marginTop: '20px'
                        }}>
                            <p style={{ 
                                color: theme.colors.primaryText, 
                                marginBottom: '20px',
                                fontSize: '1.1em'
                            }}>
                                Log in to claim your Sneed voting rewards
                            </p>
                            <button 
                                onClick={login}
                                style={{
                                    backgroundColor: theme.colors.accent,
                                    color: theme.colors.primaryText,
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
                ) : userBalances.length > 0 ? (
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
                                color: theme.colors.primaryText, 
                                marginBottom: '20px',
                                fontSize: '1.1em'
                            }}>
                                Claimed rewards are available in your SneedLock wallet <Link 
                                    to="/wallet"
                                    style={{ 
                                        color: theme.colors.accent,
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
                                            backgroundColor: theme.colors.tertiaryBg,
                                            padding: '15px',
                                            borderRadius: '6px',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center'
                                        }}>
                                            <div>
                                                <div style={{ fontSize: '18px', marginBottom: '5px', color: theme.colors.primaryText }}>
                                                    {tokenSymbols[tokenId.toString()] || tokenId.toString()}
                                                </div>
                                                <div style={{ color: theme.colors.mutedText }}>
                                                    Balance: {formatBalance(balance, 8)}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleClaimRewards(tokenId, balance)}
                                                disabled={!balance || Number(balance) === 0 || claimingTokens[tokenId.toString()]}
                                                style={{
                                                    backgroundColor: theme.colors.accent,
                                                    color: theme.colors.primaryText,
                                                    border: 'none',
                                                    borderRadius: '4px',
                                                    padding: '8px 16px',
                                                    cursor: !balance || Number(balance) === 0 || claimingTokens[tokenId.toString()] ? 'not-allowed' : 'pointer',
                                                    opacity: !balance || Number(balance) === 0 || claimingTokens[tokenId.toString()] ? 0.7 : 1,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px'
                                                }}
                                            >
                                                {claimingTokens[tokenId.toString()] ? (
                                                    <>
                                                        <div style={styles.spinner} />
                                                        Claiming...
                                                    </>
                                                ) : (
                                                    'Claim'
                                                )}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p style={{ color: theme.colors.mutedText }}>No rewards available to claim</p>
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
                                                                color: status === 'Success' ? theme.colors.success : 
                                                                       status === 'Pending' ? theme.colors.warning : 
                                                                       status === 'Failed' ? theme.colors.error : theme.colors.primaryText
                                                            }}>
                                                                {status}
                                                            </span>
                                                            <span style={{ color: theme.colors.primaryText }}>{formatNanoTimestamp(latestEvent.timestamp)}</span>
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
                                                                    <span key={idx} style={{ color: theme.colors.error }}>
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
                                    <p style={{ color: theme.colors.mutedText }}>No claim history available</p>
                                )
                            )}
                        </section>

                        {/* Your Hotkey Neurons */}
                        <HotkeyNeurons 
                            fetchNeuronsFromSns={fetchNeuronsFromSns}
                            showVotingStats={true}
                            showExpandButton={true}
                            defaultExpanded={isHotkeyNeuronsExpanded}
                            forceSneedSns={true}
                        />
                    </>
                ) : (
                    <HotkeyNeurons 
                        fetchNeuronsFromSns={fetchNeuronsFromSns}
                        showVotingStats={false}
                        showExpandButton={false}
                        defaultExpanded={true}
                        forceSneedSns={true}
                    />
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