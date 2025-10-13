import React from 'react';
import Header from '../components/Header';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';

function Sneedlock() {
    const { identity } = useAuth();
    const { theme } = useTheme();
    
    const styles = {
        container: {
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '2rem',
            color: theme.colors.primaryText,
        },
        hero: {
            textAlign: 'center',
            marginBottom: '4rem',
        },
        title: {
            fontSize: '3rem',
            marginBottom: '1.5rem',
            color: theme.colors.accent,
            fontWeight: 'bold',
        },
        subtitle: {
            fontSize: '1.5rem',
            color: theme.colors.mutedText,
            marginBottom: '2rem',
            lineHeight: '1.4',
        },
        section: {
            marginBottom: '3rem',
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '12px',
            padding: '2rem',
            boxShadow: theme.colors.cardShadow,
            transition: 'all 0.3s ease',
        },
        sectionTitle: {
            fontSize: '1.8rem',
            marginBottom: '1.5rem',
            color: theme.colors.accent,
            fontWeight: '600',
        },
        text: {
            fontSize: '1.1rem',
            lineHeight: '1.6',
            marginBottom: '1.5rem',
            color: theme.colors.secondaryText,
        },
        featureGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '2rem',
            marginTop: '2rem',
        },
        feature: {
            background: theme.colors.tertiaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '10px',
            padding: '1.5rem',
            boxShadow: theme.colors.cardShadow,
            transition: 'all 0.3s ease',
        },
        featureTitle: {
            fontSize: '1.3rem',
            marginBottom: '1rem',
            color: theme.colors.success,
            fontWeight: '600',
        },
        featureText: {
            fontSize: '1rem',
            lineHeight: '1.5',
            color: theme.colors.secondaryText,
        },
    };

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header customLogo="/sneedlock-logo4.png" />
            <main style={styles.container}>
                <div style={styles.hero}>
                    <h1 style={styles.title}>SneedLock</h1>
                    <p style={styles.subtitle}>
                        Trustless time-locking for tokens and liquidity positions with Liquid Locking™ and fee claiming
                    </p>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        gap: '16px',
                        marginTop: '20px',
                        flexWrap: 'wrap'
                    }}>
                        <Link
                            to="/help/sneedlock"
                            style={{
                                background: `${theme.colors.accent}20`,
                                color: theme.colors.accent,
                                border: `2px solid ${theme.colors.accent}`,
                                borderRadius: '8px',
                                padding: '10px 20px',
                                textDecoration: 'none',
                                fontSize: '1rem',
                                fontWeight: '600',
                                transition: 'all 0.3s ease'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.background = theme.colors.accent;
                                e.target.style.color = theme.colors.primaryBg;
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.background = `${theme.colors.accent}20`;
                                e.target.style.color = theme.colors.accent;
                            }}
                        >
                            📚 Full Documentation
                        </Link>
                        <Link
                            to="/wallet"
                            style={{
                                background: `${theme.colors.success}20`,
                                color: theme.colors.success,
                                border: `2px solid ${theme.colors.success}`,
                                borderRadius: '8px',
                                padding: '10px 20px',
                                textDecoration: 'none',
                                fontSize: '1rem',
                                fontWeight: '600',
                                transition: 'all 0.3s ease'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.background = theme.colors.success;
                                e.target.style.color = theme.colors.primaryBg;
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.background = `${theme.colors.success}20`;
                                e.target.style.color = theme.colors.success;
                            }}
                        >
                            💼 Open Wallet
                        </Link>
                    </div>
                </div>

                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>What is SneedLock?</h2>
                    <p style={styles.text}>
                        SneedLock is a trustless time-locking service for tokens and liquidity positions on the Internet Computer, 
                        integrated directly into your Sneed Wallet. It allows you to lock assets for a specified period, proving 
                        commitment and enabling various use cases like vesting schedules, governance participation, and trust-building 
                        mechanisms—all while maintaining complete transparency and security.
                    </p>
                    <p style={styles.text}>
                        Once locked, assets cannot be accessed by anyone—including you—until the lock expires. This creates a 
                        verifiable, on-chain proof of long-term commitment that's perfect for token developers, team members, 
                        and investors who want to demonstrate they won't "rug pull" the community.
                    </p>
                </section>

                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>Revolutionary Features</h2>
                    <p style={styles.text}>
                        SneedLock introduces groundbreaking capabilities that set it apart from traditional locking mechanisms:
                    </p>
                    <div style={styles.featureGrid}>
                        <div 
                            style={styles.feature}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-5px)';
                                e.currentTarget.style.boxShadow = `0 12px 35px ${theme.colors.accent}20`;
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = theme.colors.cardShadow;
                            }}
                        >
                            <h3 style={styles.featureTitle}>💰 Fee Claiming from Locked LPs</h3>
                            <p style={styles.featureText}>
                                Lock your liquidity positions to prove commitment while still earning! Claim trading fees 
                                directly from your wallet even while the position remains locked. Your locked liquidity 
                                keeps working for you.
                            </p>
                        </div>
                        <div 
                            style={styles.feature}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-5px)';
                                e.currentTarget.style.boxShadow = `0 12px 35px ${theme.colors.accent}20`;
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = theme.colors.cardShadow;
                            }}
                        >
                            <h3 style={styles.featureTitle}>✨ Liquid Locking™</h3>
                            <p style={styles.featureText}>
                                Transfer locked tokens and LP positions to other users! The locks stay enforced (no rug pulls), 
                                but ownership can change. This creates a secondary market for locked assets while maintaining 
                                security—liquidity meets safety.
                            </p>
                        </div>
                        <div 
                            style={styles.feature}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-5px)';
                                e.currentTarget.style.boxShadow = `0 12px 35px ${theme.colors.accent}20`;
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = theme.colors.cardShadow;
                            }}
                        >
                            <h3 style={styles.featureTitle}>🔒 Trustless & Immutable</h3>
                            <p style={styles.featureText}>
                                Locks cannot be canceled, modified, or unlocked early by anyone—not even the Sneedlock 
                                operators. This is enforced at the protocol level, ensuring complete security and transparency.
                            </p>
                        </div>
                    </div>
                </section>

                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>Use Cases</h2>
                    <div style={styles.featureGrid}>
                        <div 
                            style={styles.feature}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-5px)';
                                e.currentTarget.style.boxShadow = `0 12px 35px ${theme.colors.accent}20`;
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = theme.colors.cardShadow;
                            }}
                        >
                            <h3 style={styles.featureTitle}>Team Token Distribution</h3>
                            <p style={styles.featureText}>
                                Create locked token allocations and transfer them to team members using Liquid Locking. 
                                Team receives tokens immediately but can't dump them until vesting completes—all without 
                                complex smart contracts!
                            </p>
                        </div>
                        <div 
                            style={styles.feature}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-5px)';
                                e.currentTarget.style.boxShadow = `0 12px 35px ${theme.colors.accent}20`;
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = theme.colors.cardShadow;
                            }}
                        >
                            <h3 style={styles.featureTitle}>LP Commitment Proof</h3>
                            <p style={styles.featureText}>
                                Lock liquidity positions to demonstrate you won't remove liquidity. Continue earning 
                                and claiming trading fees while the position stays locked. Build trust with your community.
                            </p>
                        </div>
                        <div 
                            style={styles.feature}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-5px)';
                                e.currentTarget.style.boxShadow = `0 12px 35px ${theme.colors.accent}20`;
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = theme.colors.cardShadow;
                            }}
                        >
                            <h3 style={styles.featureTitle}>Secondary Markets</h3>
                            <p style={styles.featureText}>
                                Trade locked positions at a discount using Liquid Locking. Buyers get exposure at lower 
                                prices, sellers get liquidity, and the lock provides security—no rugs possible.
                            </p>
                        </div>
                    </div>
                </section>

                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>Getting Started</h2>
                    <p style={styles.text}>
                        Getting started with SneedLock is simple and integrated into your Sneed Wallet:
                    </p>
                    <ol style={{ 
                        fontSize: '1.1rem', 
                        lineHeight: '1.8', 
                        color: theme.colors.secondaryText,
                        marginLeft: '2rem',
                        marginBottom: '2rem'
                    }}>
                        <li><strong style={{ color: theme.colors.primaryText }}>Open Your Wallet:</strong> Navigate to your <Link to="/wallet" style={{ color: theme.colors.accent, textDecoration: 'none' }}>Sneed Wallet</Link></li>
                        <li><strong style={{ color: theme.colors.primaryText }}>Register Tokens or LP Positions:</strong> Add the tokens or swap pairs you want to lock</li>
                        <li><strong style={{ color: theme.colors.primaryText }}>Create a Lock:</strong> Click the lock button, specify the amount and expiration date</li>
                        <li><strong style={{ color: theme.colors.primaryText }}>Optional - Transfer:</strong> Use Liquid Locking to transfer locked assets to other users</li>
                        <li><strong style={{ color: theme.colors.primaryText }}>Claim Fees:</strong> For locked LP positions, claim trading fees anytime directly from your wallet</li>
                    </ol>
                    <p style={styles.text}>
                        All locks are publicly verifiable on-chain. View all locks, track expiration dates, and demonstrate 
                        your commitment with complete transparency.
                    </p>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        gap: '16px',
                        marginTop: '2rem',
                        flexWrap: 'wrap'
                    }}>
                        <Link
                            to="/wallet"
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '12px',
                                background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}dd)`,
                                color: theme.colors.primaryBg,
                                padding: '14px 28px',
                                borderRadius: '10px',
                                textDecoration: 'none',
                                fontSize: '1.1rem',
                                fontWeight: '600',
                                transition: 'all 0.3s ease',
                                boxShadow: theme.colors.accentShadow
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.transform = 'translateY(-2px)';
                                e.target.style.boxShadow = `0 8px 25px ${theme.colors.accent}40`;
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.transform = 'translateY(0)';
                                e.target.style.boxShadow = theme.colors.accentShadow;
                            }}
                        >
                            💼 Open Wallet
                        </Link>
                        <Link
                            to={`/sneedlock_info${identity ? `?owner=${identity.getPrincipal().toString()}` : ''}`}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '12px',
                                background: theme.colors.secondaryBg,
                                color: theme.colors.primaryText,
                                padding: '14px 28px',
                                borderRadius: '10px',
                                textDecoration: 'none',
                                fontSize: '1.1rem',
                                fontWeight: '600',
                                transition: 'all 0.3s ease',
                                border: `2px solid ${theme.colors.border}`
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.transform = 'translateY(-2px)';
                                e.target.style.borderColor = theme.colors.accent;
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.transform = 'translateY(0)';
                                e.target.style.borderColor = theme.colors.border;
                            }}
                        >
                            <img 
                                src="/sneedlock-logo4.png" 
                                alt="Sneedlock"
                                style={{
                                    width: '24px',
                                    height: '24px',
                                    objectFit: 'contain'
                                }}
                            />
                            View All Locks
                        </Link>
                    </div>
                </section>
            </main>
        </div>
    );
}

export default Sneedlock; 