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
    const [hideEmptyBalances, setHideEmptyBalances] = useState(false);
    const [distributions, setDistributions] = useState(null);
    const [loadingDistributions, setLoadingDistributions] = useState(true);

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

    // Fetch balances progressively
    useEffect(() => {
        const fetchBalance = async (token) => {
            setLoadingBalances(prev => ({ ...prev, [token.ledger_id.toText()]: true }));
            try {
                const ledgerActor = createLedgerActor(token.ledger_id.toText());
                const balance = await ledgerActor.icrc1_balance_of({
                    owner: Principal.fromText("lvc4n-7aaaa-aaaam-adm6a-cai" /*rllCanisterId*/),
                    subaccount: []
                });
                
                // Get metadata for logo
                const metadata = await ledgerActor.icrc1_metadata();
                const logo = getTokenLogo(metadata);

                setBalances(prev => ({
                    ...prev,
                    [token.ledger_id.toText()]: {
                        ...token,
                        balance,
                        logo
                    }
                }));
            } catch (error) {
                console.error(`Error fetching balance for ${token.symbol}:`, error);
            } finally {
                setLoadingBalances(prev => ({ ...prev, [token.ledger_id.toText()]: false }));
            }
        };

        if (tokens.length > 0) {
            tokens.forEach((token) => {
                fetchBalance(token);
            });
        }
    }, [tokens]);

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

    const formatBalance = (balance, decimals) => {
        return (Number(balance) / Math.pow(10, decimals)).toFixed(decimals);
    };

    const getFilteredTokens = () => {
        if (!hideEmptyBalances) return tokens;
        
        return tokens.filter(token => {
            const balance = balances[token.ledger_id.toText()];
            const isLoading = loadingBalances[token.ledger_id.toText()];
            
            // Show loading tokens
            if (isLoading) return true;
            
            // Hide error tokens and empty balances
            if (!balance || balance.balance === undefined) return false;
            
            return Number(balance.balance) > 0;
        });
    };

    const formatDistributionValue = (value) => {
        return Number(value) / Math.pow(10, 8); // Assuming 8 decimals for ICP
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
                        <input
                            type="checkbox"
                            id="hideEmptyBalances"
                            checked={hideEmptyBalances}
                            onChange={(e) => setHideEmptyBalances(e.target.checked)}
                            style={styles.checkbox}
                        />
                        <label htmlFor="hideEmptyBalances">Hide empty balances</label>
                    </div>
                    {loadingTokens ? (
                        <p style={{ color: '#ffffff' }}>Loading tokens...</p>
                    ) : (
                        <div style={styles.tokenList}>
                            {getFilteredTokens().map((token) => {
                                const balance = balances[token.ledger_id.toText()];
                                const isLoading = loadingBalances[token.ledger_id.toText()];
                                
                                return (
                                    <div key={token.ledger_id.toText()} style={styles.tokenItem}>
                                        {balance?.logo && (
                                            <img 
                                                src={balance.logo} 
                                                alt={token.symbol} 
                                                className="token-logo"
                                                style={{ width: '24px', height: '24px', marginRight: '8px' }}
                                            />
                                        )}
                                        <span style={styles.tokenSymbol}>{token.symbol}</span>
                                        <span style={styles.tokenBalance}>
                                            {isLoading ? (
                                                <div style={styles.spinner} />
                                            ) : balance ? (
                                                formatBalance(balance.balance, token.decimals)
                                            ) : (
                                                'Error loading balance'
                                            )}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>

                <section style={styles.section}>
                    <h2 style={styles.heading}>Total Distributions</h2>
                    {loadingDistributions ? (
                        <div style={styles.spinner} />
                    ) : distributions ? (
                        <>
                            <div style={styles.distributionItem}>
                                <span style={styles.distributionLabel}>Total ICP Distributed</span>
                                <span style={styles.distributionValue}>
                                    {formatDistributionValue(distributions.total_icp_distributed)} ICP
                                </span>
                            </div>
                            <div style={styles.distributionItem}>
                                <span style={styles.distributionLabel}>Total SNEED Distributed</span>
                                <span style={styles.distributionValue}>
                                    {formatDistributionValue(distributions.total_sneed_distributed)} SNEED
                                </span>
                            </div>
                        </>
                    ) : (
                        <p style={{ color: '#ffffff' }}>Error loading distributions</p>
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