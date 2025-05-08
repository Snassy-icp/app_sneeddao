import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from './AuthContext';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { getTokenLogo } from './utils/TokenUtils';
import ConfirmationModal from './ConfirmationModal';
import './Help.css'; // We'll reuse the Help page styling for now

// Styles
const styles = {
    tokenBalances: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginTop: '20px',
        color: '#ffffff'
    },
    tokenList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '15px'
    },
    tokenItem: {
        display: 'flex',
        alignItems: 'center',
        padding: '15px',
        backgroundColor: '#3a3a3a',
        borderRadius: '6px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        color: '#ffffff'
    },
    tokenSymbol: {
        fontWeight: 'bold',
        marginRight: 'auto',
        color: '#ffffff'
    },
    tokenBalance: {
        fontFamily: 'monospace',
        fontSize: '1.1em',
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
    },
    heading: {
        color: '#ffffff',
        marginBottom: '15px'
    },
    spinner: {
        width: '20px',
        height: '20px',
        border: '2px solid #f3f3f3',
        borderTop: '2px solid #3498db',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
    },
    controls: {
        marginBottom: '15px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        color: '#ffffff'
    },
    checkbox: {
        cursor: 'pointer',
        width: '16px',
        height: '16px',
        accentColor: '#3498db'
    },
    section: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginTop: '20px',
        color: '#ffffff'
    },
    distributionItem: {
        display: 'flex',
        alignItems: 'center',
        padding: '15px',
        backgroundColor: '#3a3a3a',
        borderRadius: '6px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        color: '#ffffff',
        marginBottom: '10px'
    },
    distributionLabel: {
        fontWeight: 'bold',
        marginRight: 'auto',
        color: '#ffffff'
    },
    distributionValue: {
        fontFamily: 'monospace',
        fontSize: '1.1em',
        color: '#ffffff'
    },
    eventList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '15px'
    },
    eventItem: {
        display: 'flex',
        flexDirection: 'column',
        padding: '15px',
        backgroundColor: '#3a3a3a',
        borderRadius: '6px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        color: '#ffffff'
    },
    eventHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: '10px'
    },
    eventDetails: {
        display: 'flex',
        flexDirection: 'column',
        gap: '5px'
    }
};

// Token configurations
const TOKENS = [
    {
        canisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai',
        symbol: 'ICP',
        decimals: 8,
        fee: 0.0001,
        standard: 'ICRC2'
    },
    {
        canisterId: 'hvgxa-wqaaa-aaaaq-aacia-cai',
        symbol: 'SNEED',
        decimals: 8,
        fee: 0.00001,
        standard: 'ICRC2'
    }
];

function RLL() {
    const { isAuthenticated, identity } = useAuth();
    const [tokens, setTokens] = useState([]);
    const [balances, setBalances] = useState({});
    const [loadingTokens, setLoadingTokens] = useState(true);
    const [loadingBalances, setLoadingBalances] = useState({});
    const [distributions, setDistributions] = useState(null);
    const [loadingDistributions, setLoadingDistributions] = useState(true);
    const [distributionEvents, setDistributionEvents] = useState([]);
    const [claimEvents, setClaimEvents] = useState([]);
    const [loadingEvents, setLoadingEvents] = useState(true);
    const [userClaimEvents, setUserClaimEvents] = useState([]);
    const [loadingUserEvents, setLoadingUserEvents] = useState(true);
    const [userBalances, setUserBalances] = useState([]);
    const [loadingUserBalances, setLoadingUserBalances] = useState(true);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmMessage, setConfirmMessage] = useState('');
    const [confirmAction, setConfirmAction] = useState(() => () => {});

    // Fetch whitelisted tokens
    useEffect(() => {
        const fetchTokens = async () => {
            console.log('Starting to fetch whitelisted tokens...');
            try {
                const backendActor = createBackendActor(backendCanisterId, {
                    agentOptions: {
                        identity,
                    },
                });
                console.log('Created backend actor, fetching tokens...');
                const whitelistedTokens = await backendActor.get_whitelisted_tokens();
                console.log('Received whitelisted tokens:', whitelistedTokens);
                setTokens(whitelistedTokens);
            } catch (error) {
                console.error('Error fetching whitelisted tokens:', error);
            } finally {
                setLoadingTokens(false);
            }
        };

        if (isAuthenticated) {
            console.log('User is authenticated, fetching tokens...');
            fetchTokens();
        } else {
            console.log('User is not authenticated, skipping token fetch');
        }
    }, [isAuthenticated, identity]);

    // Fetch total distributions
    useEffect(() => {
        const fetchDistributions = async () => {
            if (!isAuthenticated) {
                console.log('Skipping distributions fetch - not authenticated');
                return;
            }
            
            console.log('Starting to fetch total distributions...');
            setLoadingDistributions(true);
            try {
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: {
                        identity,
                    },
                });
                console.log('Created RLL actor, fetching distributions...');
                const totalDistributions = await rllActor.get_total_distributions();
                console.log('Received total distributions:', totalDistributions);
                
                // Transform the data into a more usable format
                const formattedDistributions = totalDistributions.reduce((acc, [principal, amount]) => {
                    acc[principal.toText()] = amount;
                    return acc;
                }, {});
                
                setDistributions(formattedDistributions);
            } catch (error) {
                console.error('Error fetching total distributions:', error);
            } finally {
                setLoadingDistributions(false);
            }
        };

        fetchDistributions();
    }, [isAuthenticated, identity]);

    // Fetch events
    useEffect(() => {
        const fetchEvents = async () => {
            if (!isAuthenticated) {
                console.log('Skipping events fetch - not authenticated');
                return;
            }
            
            console.log('Starting to fetch events...');
            setLoadingEvents(true);
            try {
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: {
                        identity,
                    },
                });
                console.log('Created RLL actor, fetching events...');
                const [distributions, claims] = await Promise.all([
                    rllActor.get_distribution_events(),
                    rllActor.get_claim_events()
                ]);
                
                console.log('Received distribution events:', distributions);
                console.log('Received claim events:', claims);
                
                setDistributionEvents(distributions);
                setClaimEvents(claims);
            } catch (error) {
                console.error('Error fetching events:', error);
            } finally {
                setLoadingEvents(false);
            }
        };

        fetchEvents();
    }, [isAuthenticated, identity]);

    // Fetch user's claim events
    useEffect(() => {
        const fetchUserEvents = async () => {
            if (!isAuthenticated || !identity) {
                console.log('Skipping user events fetch - not authenticated or no identity');
                return;
            }
            
            console.log('Starting to fetch user claim events...');
            setLoadingUserEvents(true);
            try {
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: {
                        identity,
                    },
                });
                console.log('Created RLL actor, fetching user claims...');
                const claims = await rllActor.get_claim_events_for_hotkey(identity.getPrincipal());
                console.log('Received user claim events:', claims);
                setUserClaimEvents(claims);
            } catch (error) {
                console.error('Error fetching user claim events:', error);
            } finally {
                setLoadingUserEvents(false);
            }
        };

        fetchUserEvents();
    }, [isAuthenticated, identity]);

    // Fetch user's balances
    useEffect(() => {
        const fetchUserBalances = async () => {
            if (!isAuthenticated || !identity) {
                console.log('Skipping user balances fetch - not authenticated or no identity');
                return;
            }
            
            console.log('Starting to fetch user balances...');
            setLoadingUserBalances(true);
            try {
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: {
                        identity,
                    },
                });
                console.log('Created RLL actor, fetching user balances...');
                const balances = await rllActor.balances_of_hotkey();
                console.log('Received user balances:', balances);
                setUserBalances(balances);
            } catch (error) {
                console.error('Error fetching user balances:', error);
            } finally {
                setLoadingUserBalances(false);
            }
        };

        fetchUserBalances();
    }, [isAuthenticated, identity]);

    const formatBalance = (balance, decimals) => {
        if (!balance) return '0';
        return (Number(balance) / Math.pow(10, decimals)).toFixed(decimals);
    };

    const getTokenDecimals = (symbol) => {
        const token = tokens.find(t => t.symbol === symbol);
        return token ? token.decimals : 8; // fallback to 8 decimals if token not found
    };

    const formatTimestamp = (timestamp) => {
        return new Date(Number(timestamp) / 1_000_000).toLocaleString();
    };

    const formatProposalRange = (range) => {
        return `${range.first} - ${range.last}`;
    };

    const getTokenSymbolByPrincipal = (principalId) => {
        const token = tokens.find(t => t.ledger_id.toText() === principalId);
        return token ? token.symbol : 'Unknown';
    };

    const getTokenDecimalsByPrincipal = (principalId) => {
        const token = tokens.find(t => t.ledger_id.toText() === principalId);
        return token ? token.decimals : 8; // fallback to 8 decimals
    };

    const handleClaimRewards = async (tokenId, balance, token) => {
        setConfirmAction(() => async () => {
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            const claim_results = await rllActor.claim_full_balance_of_hotkey(
                tokenId,
                token.fee);
            // Refresh balances after claim
            const balances = await rllActor.balances_of_hotkey();
            setUserBalances(balances);
        });
        setConfirmMessage(`Do you want to claim your balance of ${formatBalance(balance, token.decimals)} ${token.symbol}?`);
        setShowConfirmModal(true);
    };

    return (
        <div className='page-container'>
            <header className="site-header">
                <div className="logo">
                    <Link to="/wallet">
                        <img src="sneedlock-logo-cropped.png" alt="Sneedlock" />
                    </Link>
                </div>
                <nav className="nav-links">
                    <Link to="/help">Help</Link>
                    <Link to="/rll" className="active">RLL</Link>
                </nav>
            </header>
            <main className="help-container">
                <h1 style={{ color: '#ffffff' }}>RLL</h1>
                
                <section style={styles.section}>
                    <h2 style={styles.heading}>RLL Canister Token Balances</h2>
                    <div style={styles.controls}>
                        <Link 
                            to={`/scan_wallet?principal=${rllCanisterId}`}
                            style={{
                                color: '#3498db',
                                textDecoration: 'none',
                                marginBottom: '15px',
                                display: 'inline-block'
                            }}
                        >
                            View in Token Scanner
                        </Link>
                    </div>
                </section>

                <section style={styles.section}>
                    <h2 style={styles.heading}>Your Token Balances</h2>
                    {loadingUserBalances ? (
                        <div style={styles.spinner} />
                    ) : userBalances.length > 0 ? (
                        <div style={styles.eventList}>
                            {userBalances.map(([tokenId, balance], index) => {
                                const token = tokens.find(t => t.ledger_id.toString() === tokenId.toString());
                                if (!token) return null;
                                
                                return (
                                    <div key={index} style={styles.eventItem}>
                                        <div style={styles.eventHeader}>
                                            <span>{token.symbol}</span>
                                            {Number(balance) > 0 && (
                                                <button
                                                    onClick={() => handleClaimRewards(tokenId, balance, token)}
                                                    style={{
                                                        backgroundColor: '#3498db',
                                                        color: '#ffffff',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        padding: '4px 8px',
                                                        cursor: 'pointer',
                                                        fontSize: '12px'
                                                    }}
                                                >
                                                    Claim
                                                </button>
                                            )}
                                        </div>
                                        <div style={styles.eventDetails}>
                                            <span>Balance: {formatBalance(balance, token.decimals)} {token.symbol}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <p style={{ color: '#ffffff' }}>No token balances found</p>
                    )}
                </section>

                <section style={styles.section}>
                    <h2 style={styles.heading}>Your Claim History</h2>
                    {loadingUserEvents ? (
                        <div style={styles.spinner} />
                    ) : userClaimEvents.length > 0 ? (
                        <div style={styles.eventList}>
                            {userClaimEvents.slice(0, 5).map((event, index) => (
                                <div key={index} style={styles.eventItem}>
                                    <div style={styles.eventHeader}>
                                        <span>{
                                            'Success' in event.status ? 'Success' :
                                            'Pending' in event.status ? 'Pending' :
                                            'Failed' in event.status ? 'Failed' :
                                            'Unknown'
                                        }</span>
                                        <span>{formatTimestamp(event.timestamp)}</span>
                                    </div>
                                    <div style={styles.eventDetails}>
                                        <span>Amount: {formatBalance(event.amount, getTokenDecimals(event.token_id.toString()))} tokens</span>
                                        <span>Fee: {formatBalance(event.fee, getTokenDecimals(event.token_id.toString()))} tokens</span>
                                        <span>Sequence: {event.sequence_number.toString()}</span>
                                        {event.tx_index && event.tx_index.length > 0 && <span>Transaction ID: {event.tx_index[0].toString()}</span>}
                                        {event.error_message && event.error_message.length > 0 && <span>Message: {event.error_message[0]}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p style={{ color: '#ffffff' }}>No claim history found</p>
                    )}
                </section>

                <section style={styles.section}>
                    <h2 style={styles.heading}>Total Distributions</h2>
                    {loadingDistributions ? (
                        <div style={styles.spinner} />
                    ) : distributions ? (
                        <div style={styles.tokenList}>
                            {Object.entries(distributions).map(([principalId, amount]) => {
                                const symbol = getTokenSymbolByPrincipal(principalId);
                                const decimals = getTokenDecimalsByPrincipal(principalId);
                                return (
                                    <div key={principalId} style={styles.distributionItem}>
                                        <span style={styles.distributionLabel}>Total {symbol} Distributed</span>
                                        <span style={styles.distributionValue}>
                                            {formatBalance(amount, decimals)} {symbol}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <p style={{ color: '#ffffff' }}>No distributions found</p>
                    )}
                </section>

                <section style={styles.section}>
                    <h2 style={styles.heading}>Recent Distribution Events</h2>
                    {loadingEvents ? (
                        <div style={styles.spinner} />
                    ) : (
                        <div style={styles.eventList}>
                            {distributionEvents.slice(0, 5).map((event, index) => (
                                <div key={index} style={styles.eventItem}>
                                    <div style={styles.eventHeader}>
                                        <span>Proposals: {formatProposalRange(event.proposal_range)}</span>
                                        <span>{formatTimestamp(event.timestamp)}</span>
                                    </div>
                                    <div style={styles.eventDetails}>
                                        <span>Amount: {formatBalance(event.amount, getTokenDecimals(event.token_id.toString()))} tokens</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                <section style={styles.section}>
                    <h2 style={styles.heading}>Recent Claim Events</h2>
                    {loadingEvents ? (
                        <div style={styles.spinner} />
                    ) : (
                        <div style={styles.eventList}>
                            {claimEvents.slice(0, 5).map((event, index) => (
                                <div key={index} style={styles.eventItem}>
                                    <div style={styles.eventHeader}>
                                        <span>{
                                            'Success' in event.status ? 'Success' :
                                            'Pending' in event.status ? 'Pending' :
                                            'Failed' in event.status ? 'Failed' :
                                            'Unknown'
                                        }</span>
                                        <span>{formatTimestamp(event.timestamp)}</span>
                                    </div>
                                    <div style={styles.eventDetails}>
                                        <span>Hotkey: {event.hotkey.toString()}</span>
                                        <span>Amount: {formatBalance(event.amount, getTokenDecimals(event.token_id.toString()))} tokens</span>
                                        <span>Fee: {formatBalance(event.fee, getTokenDecimals(event.token_id.toString()))} tokens</span>
                                        <span>Sequence: {event.sequence_number.toString()}</span>
                                        {event.tx_index && event.tx_index.length > 0 && <span>Transaction ID: {event.tx_index[0].toString()}</span>}
                                        {event.error_message && event.error_message.length > 0 && <span>Message: {event.error_message[0]}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </main>

            <ConfirmationModal
                show={showConfirmModal}
                message={confirmMessage}
                onConfirm={async () => {
                    await confirmAction();
                    setShowConfirmModal(false);
                }}
                onCancel={() => setShowConfirmModal(false)}
            />

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
}

export default RLL; 