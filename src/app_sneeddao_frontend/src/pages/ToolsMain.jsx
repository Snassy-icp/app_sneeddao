import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';

const styles = {
    container: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '2rem',
        color: '#ffffff',
    },
    heading: {
        fontSize: '2.5rem',
        marginBottom: '2rem',
        color: '#ffffff',
        textAlign: 'center',
    },
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '2rem',
    },
    tool: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '2rem',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
    },
    toolTitle: {
        fontSize: '2rem',
        marginBottom: '1rem',
        color: '#3498db',
    },
    description: {
        fontSize: '1.1rem',
        lineHeight: '1.6',
        color: '#ccc',
        marginBottom: '2rem',
        flexGrow: 1,
    },
    button: {
        backgroundColor: '#3498db',
        color: '#ffffff',
        border: 'none',
        borderRadius: '4px',
        padding: '1rem',
        fontSize: '1.1rem',
        cursor: 'pointer',
        textDecoration: 'none',
        textAlign: 'center',
        transition: 'background-color 0.2s',
        display: 'inline-block',
    },
    buttonDisabled: {
        backgroundColor: '#666',
        color: '#999',
        cursor: 'not-allowed',
    },
};

function ToolsMain() {
    return (
        <div className="page-container">
            <Header />
            <main style={styles.container}>
                <h1 style={styles.heading}>Sneed Tools</h1>
                <p style={{ textAlign: 'center', fontSize: '1.2rem', color: '#ccc', marginBottom: '3rem' }}>
                    Powerful tools to enhance your DeFi experience on the Internet Computer
                </p>
                
                <div style={styles.grid}>
                    {/* Escrow Tool */}
                    <div style={styles.tool}>
                        <h2 style={styles.toolTitle}>Escrow Service</h2>
                        <p style={styles.description}>
                            Secure peer-to-peer transactions with our decentralized escrow service.
                            Create trustless agreements for token exchanges, service payments, and more.
                            Built with smart contracts to ensure both parties are protected.
                        </p>
                        
                        <div style={{display: 'flex', gap: '1rem', flexWrap: 'wrap'}}>
                            <Link 
                                to="/tools/escrow/swap" 
                                style={styles.button}
                            >
                                Lookup Swap
                            </Link>
                            <Link 
                                to="/tools/escrow" 
                                style={{...styles.button, ...styles.buttonDisabled}}
                                onClick={(e) => e.preventDefault()}
                            >
                                Create Swap (Coming Soon)
                            </Link>
                        </div>
                    </div>

                    {/* Placeholder for future tools */}
                    <div style={styles.tool}>
                        <h2 style={styles.toolTitle}>More Tools Coming</h2>
                        <p style={styles.description}>
                            We're constantly developing new tools to make your DeFi journey easier and more secure.
                            Stay tuned for more powerful utilities and services.
                        </p>
                        
                        <div style={{...styles.button, ...styles.buttonDisabled}}>
                            Stay Tuned
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default ToolsMain;