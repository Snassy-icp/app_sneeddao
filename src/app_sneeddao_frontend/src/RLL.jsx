import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from './AuthContext';
import { createLedgerActor } from './utils/actors';
import { getTokenLogo } from './utils/TokenUtils';
import './Help.css'; // We'll reuse the Help page styling for now

// Styles
const styles = {
    tokenBalances: {
        backgroundColor: '#f5f5f5',
        borderRadius: '8px',
        padding: '20px',
        marginTop: '20px'
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
        backgroundColor: 'white',
        borderRadius: '6px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    },
    tokenSymbol: {
        fontWeight: 'bold',
        marginRight: 'auto'
    },
    tokenBalance: {
        fontFamily: 'monospace',
        fontSize: '1.1em'
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
    const [balances, setBalances] = useState({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (isAuthenticated && identity) {
            fetchBalances();
        }
    }, [isAuthenticated, identity]);

    const fetchBalances = async () => {
        setLoading(true);
        try {
            const newBalances = {};
            for (const token of TOKENS) {
                const ledgerActor = createLedgerActor(token.canisterId);
                const balance = await ledgerActor.icrc1_balance_of({
                    owner: identity.getPrincipal(),
                    subaccount: []
                });
                
                // Get metadata for logo
                const metadata = await ledgerActor.icrc1_metadata();
                const logo = getTokenLogo(metadata);

                newBalances[token.canisterId] = {
                    ...token,
                    balance: balance,
                    logo
                };
            }
            setBalances(newBalances);
        } catch (error) {
            console.error('Error fetching balances:', error);
        } finally {
            setLoading(false);
        }
    };

    const formatBalance = (balance, decimals) => {
        return (Number(balance) / Math.pow(10, decimals)).toFixed(decimals);
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
                <h1>RLL</h1>
                
                <section style={styles.tokenBalances}>
                    <h2>Token Balances</h2>
                    {loading ? (
                        <p>Loading balances...</p>
                    ) : (
                        <div style={styles.tokenList}>
                            {Object.values(balances).map((token) => (
                                <div key={token.canisterId} style={styles.tokenItem}>
                                    <img 
                                        src={token.logo} 
                                        alt={token.symbol} 
                                        className="token-logo"
                                        style={{ width: '24px', height: '24px', marginRight: '8px' }}
                                    />
                                    <span style={styles.tokenSymbol}>{token.symbol}</span>
                                    <span style={styles.tokenBalance}>
                                        {formatBalance(token.balance, token.decimals)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}

export default RLL; 