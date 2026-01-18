import React from 'react';
import { Link } from 'react-router-dom';
import './Help.css';
import Header from './components/Header';
import { useTheme } from './contexts/ThemeContext';

const getStyles = (theme) => ({
    container: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '2rem',
        color: theme.colors.primaryText,
    },
    section: {
        backgroundColor: theme.colors.secondaryBg,
        borderRadius: '8px',
        padding: '2rem',
        marginBottom: '2rem',
        textAlign: 'center',
    },
    heading: {
        fontSize: '2.5rem',
        marginBottom: '1.5rem',
        color: theme.colors.primaryText,
    },
    paragraph: {
        marginBottom: '1rem',
        lineHeight: '1.6',
        color: theme.colors.secondaryText,
        fontSize: '1.1rem',
    },
    linkSection: {
        backgroundColor: theme.colors.secondaryBg,
        borderRadius: '8px',
        padding: '2rem',
        marginBottom: '2rem',
    },
    subheading: {
        fontSize: '1.8rem',
        marginBottom: '1rem',
        color: theme.colors.primaryText,
    },
    linkList: {
        listStyle: 'none',
        padding: 0,
        margin: 0,
    },
    linkItem: {
        marginBottom: '0.8rem',
    },
    link: {
        color: theme.colors.accent,
        textDecoration: 'none',
        fontSize: '1.1rem',
    },
});

function Help() {
    const { theme } = useTheme();
    const styles = getStyles(theme);

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={styles.container}>
                <div style={styles.section}>
                    <h1 style={styles.heading}>Help Center</h1>
                    <p style={styles.paragraph}>
                        More help content coming soon!
                    </p>
                </div>

                <div style={styles.linkSection}>
                    <h2 style={styles.subheading}>Available Help Topics</h2>
                    <ul style={styles.linkList}>
                        <li style={styles.linkItem}>
                            <Link 
                                to="/help/wallet" 
                                style={styles.link}
                                onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                            >
                                Understanding Your Wallet
                            </Link>
                        </li>
                        <li style={styles.linkItem}>
                            <Link 
                                to="/help/neurons" 
                                style={styles.link}
                                onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                            >
                                Understanding SNS Neurons
                            </Link>
                        </li>
                        <li style={styles.linkItem}>
                            <Link 
                                to="/help/sneedlock" 
                                style={styles.link}
                                onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                            >
                                Understanding Sneedlock
                            </Link>
                        </li>
                        <li style={styles.linkItem}>
                            <Link 
                                to="/help/icp-neuron-manager" 
                                style={styles.link}
                                onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                            >
                                ICP Neuron Manager Canisters
                            </Link>
                        </li>
                        <li style={styles.linkItem}>
                            <Link 
                                to="/help/canister-manager" 
                                style={styles.link}
                                onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                            >
                                Canister Manager
                            </Link>
                        </li>
                    </ul>
                </div>
            </main>
        </div>
    );
}

export default Help;