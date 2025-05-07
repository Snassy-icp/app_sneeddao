import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from './AuthContext';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { getTokenLogo } from './utils/TokenUtils';
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
    const [transferEvents, setTransferEvents] = useState([]);
    const [claimEvents, setClaimEvents] = useState([]);
    const [loadingEvents, setLoadingEvents] = useState(true);
    const [userClaimEvents, setUserClaimEvents] = useState([]);
    const [loadingUserEvents, setLoadingUserEvents] = useState(true);

    // Fetch whitelisted tokens
    useEffect(() => {
        const fetchTokens = async () => {
            try {
                const backendActor = createBackendActor(backendCanisterId, {
                    agentOptions: {
                        identity,
                    },
                });
                const whitelistedTokens = await backendActor.get_whitelisted_tokens();
                setTokens(whitelistedTokens);
            } catch (error) {
                console.error('Error fetching whitelisted tokens:', error);
            } finally {
                setLoadingTokens(false);
            }
        };

        if (isAuthenticated) {
            fetchTokens();
        }
    }, [isAuthenticated, identity]);

    // Fetch total distributions
    useEffect(() => {
        const fetchDistributions = async () => {
            if (!isAuthenticated) return;
            
            setLoadingDistributions(true);
            try {
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: {
                        identity,
                    },
                });
                const totalDistributions = await rllActor.get_total_distributions();
                setDistributions(totalDistributions);
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
            if (!isAuthenticated) return;
            
            setLoadingEvents(true);
            try {
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: {
                        identity,
                    },
                });
                const [distributions, transfers, claims] = await Promise.all([
                    rllActor.get_distribution_events(),
                    rllActor.get_transfer_events(),
                    rllActor.get_claim_events()
                ]);
                
                setDistributionEvents(distributions);
                setTransferEvents(transfers);
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
            if (!isAuthenticated || !identity) return;
            
            setLoadingUserEvents(true);
            try {
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: {
                        identity,
                    },
                });
                const claims = await rllActor.get_claim_events_for_hotkey(identity.getPrincipal());
                setUserClaimEvents(claims);
            } catch (error) {
                console.error('Error fetching user claim events:', error);
            } finally {
                setLoadingUserEvents(false);
            }
        };

        fetchUserEvents();
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
                    <h2 style={styles.heading}>Your Claim History</h2>
                    {loadingUserEvents ? (
                        <div style={styles.spinner} />
                    ) : userClaimEvents.length > 0 ? (
                        <div style={styles.eventList}>
                            {userClaimEvents.slice(0, 5).map((event, index) => (
                                <div key={index} style={styles.eventItem}>
                                    <div style={styles.eventHeader}>
                                        <span>{event.success ? 'Success' : 'Failed'}</span>
                                        <span>{formatTimestamp(event.timestamp)}</span>
                                    </div>
                                    <div style={styles.eventDetails}>
                                        <span>Amount: {formatBalance(event.amount, getTokenDecimals(event.token_id.toString()))} tokens</span>
                                        <span>Fee: {formatBalance(event.fee, getTokenDecimals(event.token_id.toString()))} tokens</span>
                                        {event.error_message && <span>Error: {event.error_message}</span>}
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
                        <>
                            {Object.entries(distributions).map(([key, value]) => {
                                const symbol = key.replace('total_', '').replace('_distributed', '').toUpperCase();
                                return (
                                    <div key={key} style={styles.distributionItem}>
                                        <span style={styles.distributionLabel}>Total {symbol} Distributed</span>
                                        <span style={styles.distributionValue}>
                                            {formatBalance(value, getTokenDecimals(symbol))} {symbol}
                                        </span>
                                    </div>
                                );
                            })}
                        </>
                    ) : (
                        <p style={{ color: '#ffffff' }}>Error loading distributions</p>
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
                    <h2 style={styles.heading}>Recent Transfer Events</h2>
                    {loadingEvents ? (
                        <div style={styles.spinner} />
                    ) : (
                        <div style={styles.eventList}>
                            {transferEvents.slice(0, 5).map((event, index) => (
                                <div key={index} style={styles.eventItem}>
                                    <div style={styles.eventHeader}>
                                        <span>{event.success ? 'Success' : 'Failed'}</span>
                                        <span>{formatTimestamp(event.timestamp)}</span>
                                    </div>
                                    <div style={styles.eventDetails}>
                                        <span>From: {event.from.toString()}</span>
                                        <span>To: {event.to.toString()}</span>
                                        <span>Amount: {formatBalance(event.amount, getTokenDecimals(event.token_id.toString()))} tokens</span>
                                        <span>Fee: {formatBalance(event.fee, getTokenDecimals(event.token_id.toString()))} tokens</span>
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
                                        <span>{event.success ? 'Success' : 'Failed'}</span>
                                        <span>{formatTimestamp(event.timestamp)}</span>
                                    </div>
                                    <div style={styles.eventDetails}>
                                        <span>Hotkey: {event.hotkey.toString()}</span>
                                        <span>Amount: {formatBalance(event.amount, getTokenDecimals(event.token_id.toString()))} tokens</span>
                                        <span>Fee: {formatBalance(event.fee, getTokenDecimals(event.token_id.toString()))} tokens</span>
                                        {event.error_message && <span>Error: {event.error_message}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </main>

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