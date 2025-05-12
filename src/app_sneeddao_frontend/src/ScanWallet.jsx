import React, { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from './AuthContext';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { getTokenLogo } from './utils/TokenUtils';
import './Help.css';

// Styles
const styles = {
    section: {
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
    input: {
        backgroundColor: '#3a3a3a',
        border: '1px solid #4a4a4a',
        borderRadius: '4px',
        color: '#ffffff',
        padding: '8px 12px',
        width: '100%',
        maxWidth: '500px',
        marginRight: '10px',
        fontSize: '14px'
    },
    button: {
        backgroundColor: '#3498db',
        color: '#ffffff',
        border: 'none',
        borderRadius: '4px',
        padding: '8px 16px',
        cursor: 'pointer',
        fontSize: '14px',
        transition: 'background-color 0.2s',
        '&:hover': {
            backgroundColor: '#2980b9'
        }
    },
    searchForm: {
        display: 'flex',
        alignItems: 'center',
        marginBottom: '20px',
        gap: '10px'
    },
    error: {
        color: '#e74c3c',
        marginTop: '10px'
    }
};

function ScanWallet() {
    const { isAuthenticated, identity } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const [principalInput, setPrincipalInput] = useState(searchParams.get('principal') || '');
    const [currentPrincipal, setCurrentPrincipal] = useState(searchParams.get('principal') || '');
    const [error, setError] = useState('');
    
    const [tokens, setTokens] = useState([]);
    const [balances, setBalances] = useState({});
    const [loadingTokens, setLoadingTokens] = useState(true);
    const [loadingBalances, setLoadingBalances] = useState({});
    const [hideEmptyBalances, setHideEmptyBalances] = useState(false);

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

    // Fetch balances when principal or tokens change
    useEffect(() => {
        const fetchBalance = async (token) => {
            if (!currentPrincipal) return;
            
            // Skip non-ICRC tokens
            if (!token.standard.toLowerCase().startsWith('icrc')) {
                setBalances(prev => ({
                    ...prev,
                    [token.ledger_id.toText()]: {
                        ...token,
                        balance: null,
                        error: 'Unsupported token standard'
                    }
                }));
                return;
            }
            
            setLoadingBalances(prev => ({ ...prev, [token.ledger_id.toText()]: true }));
            try {
                const ledgerActor = createLedgerActor(token.ledger_id.toText());
                const balance = await ledgerActor.icrc1_balance_of({
                    owner: Principal.fromText(currentPrincipal),
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
                setBalances(prev => ({
                    ...prev,
                    [token.ledger_id.toText()]: {
                        ...token,
                        balance: null,
                        error: 'Error loading balance'
                    }
                }));
            } finally {
                setLoadingBalances(prev => ({ ...prev, [token.ledger_id.toText()]: false }));
            }
        };

        if (tokens.length > 0 && currentPrincipal) {
            // Reset balances when scanning a new principal
            setBalances({});
            tokens.forEach((token) => {
                fetchBalance(token);
            });
        }
    }, [tokens, currentPrincipal]);

    const handleScan = (e) => {
        e.preventDefault();
        setError('');
        
        try {
            // Validate principal
            Principal.fromText(principalInput);
            
            // Update URL and trigger scan
            setSearchParams({ principal: principalInput });
            setCurrentPrincipal(principalInput);
        } catch (error) {
            setError('Invalid principal ID');
        }
    };

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
            if (!balance || balance.balance === undefined || balance.error) return false;
            
            return Number(balance.balance) > 0;
        });
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
                    <Link to="/rll">RLL</Link>
                    <Link to="/scan_wallet" className="active">Scan Wallet</Link>
                </nav>
            </header>
            <main className="scanwallet-container">
                <h1 style={{ color: '#ffffff' }}>Scan Wallet</h1>
                
                <section style={styles.section}>
                    <form onSubmit={handleScan} style={styles.searchForm}>
                        <input
                            type="text"
                            value={principalInput}
                            onChange={(e) => setPrincipalInput(e.target.value)}
                            placeholder="Enter Principal ID"
                            style={styles.input}
                        />
                        <button type="submit" style={styles.button}>
                            Scan
                        </button>
                    </form>
                    {error && <div style={styles.error}>{error}</div>}

                    {currentPrincipal && (
                        <>
                            <h2 style={styles.heading}>Token Balances</h2>
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
                        </>
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

export default ScanWallet; 