import React from 'react';
import Header from '../components/Header';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { FaLock, FaWallet, FaMagic, FaBook, FaShieldAlt, FaCoins, FaWater, FaExchangeAlt, FaUsers, FaChartLine, FaArrowRight, FaCheckCircle } from 'react-icons/fa';

// Custom CSS for animations
const customStyles = `
@keyframes fadeInUp {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-10px); }
}

@keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.85; transform: scale(1.03); }
}

@keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}

.sneedlock-float {
    animation: float 3s ease-in-out infinite;
}

.sneedlock-fade-in {
    animation: fadeInUp 0.6s ease-out forwards;
}

.sneedlock-fade-in-delay {
    animation: fadeInUp 0.6s ease-out 0.2s forwards;
    opacity: 0;
}

.sneedlock-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.sneedlock-shimmer {
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
    background-size: 200% 100%;
    animation: shimmer 2s infinite;
}
`;

// Page accent colors - indigo/blue theme for locking
const lockPrimary = '#6366f1';
const lockSecondary = '#818cf8';
const lockAccent = '#a5b4fc';

function Sneedlock() {
    const { identity } = useAuth();
    const { theme } = useTheme();
    
    const styles = {
        container: {
            maxWidth: '1000px',
            margin: '0 auto',
            padding: '1.5rem 1rem',
            color: theme.colors.primaryText,
        },
        section: {
            marginBottom: '1.5rem',
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '20px',
            padding: '1.5rem',
            boxShadow: theme.colors.cardShadow,
            transition: 'all 0.3s ease',
        },
        sectionHeader: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '1.25rem',
        },
        sectionIcon: {
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
        },
        sectionTitle: {
            fontSize: '1.35rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
            margin: 0,
        },
        text: {
            fontSize: '0.95rem',
            lineHeight: '1.7',
            marginBottom: '1rem',
            color: theme.colors.secondaryText,
        },
        featureGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '1rem',
            marginTop: '1rem',
        },
        feature: {
            background: theme.colors.primaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '14px',
            padding: '1.25rem',
            transition: 'all 0.3s ease',
        },
        featureIcon: {
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '0.75rem',
        },
        featureTitle: {
            fontSize: '1.05rem',
            marginBottom: '0.5rem',
            color: theme.colors.primaryText,
            fontWeight: '600',
        },
        featureText: {
            fontSize: '0.9rem',
            lineHeight: '1.6',
            color: theme.colors.secondaryText,
        },
        ctaButton: (bg, shadow) => ({
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: bg,
            color: '#fff',
            padding: '12px 20px',
            borderRadius: '12px',
            textDecoration: 'none',
            fontSize: '0.95rem',
            fontWeight: '600',
            transition: 'all 0.3s ease',
            boxShadow: shadow,
            border: 'none',
        }),
        outlineButton: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: theme.colors.cardGradient,
            color: theme.colors.primaryText,
            padding: '12px 20px',
            borderRadius: '12px',
            textDecoration: 'none',
            fontSize: '0.95rem',
            fontWeight: '600',
            transition: 'all 0.3s ease',
            border: `1px solid ${theme.colors.border}`,
        },
        stepNumber: {
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            background: `linear-gradient(135deg, ${lockPrimary}, ${lockSecondary})`,
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.85rem',
            fontWeight: '700',
            marginRight: '12px',
            flexShrink: 0,
        },
    };

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            <Header customLogo="/sneedlock-logo4.png" />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${lockPrimary}15 50%, ${lockSecondary}08 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '3rem 1rem',
                position: 'relative',
                overflow: 'hidden'
            }}>
                {/* Background decorations */}
                <div style={{
                    position: 'absolute',
                    top: '-30%',
                    right: '-5%',
                    width: '400px',
                    height: '400px',
                    background: `radial-gradient(circle, ${lockPrimary}20 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-50%',
                    left: '5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${lockSecondary}15 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                
                <div className="sneedlock-fade-in" style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
                    {/* Floating Logo */}
                    <div className="sneedlock-float" style={{
                        width: '80px',
                        height: '80px',
                        borderRadius: '20px',
                        background: `linear-gradient(135deg, ${lockPrimary}, ${lockSecondary})`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 1.5rem',
                        boxShadow: `0 12px 40px ${lockPrimary}50`,
                    }}>
                        <FaShieldAlt size={36} style={{ color: '#fff' }} />
                    </div>
                    
                    <h1 style={{
                        fontSize: '2.5rem',
                        fontWeight: '700',
                        color: theme.colors.primaryText,
                        margin: '0 0 1rem',
                        letterSpacing: '-0.5px'
                    }}>
                        SneedLock
                    </h1>
                    <p style={{
                        fontSize: '1.15rem',
                        color: theme.colors.secondaryText,
                        lineHeight: '1.6',
                        margin: '0 0 2rem',
                        maxWidth: '600px',
                        marginLeft: 'auto',
                        marginRight: 'auto'
                    }}>
                        Trustless time-locking for tokens and liquidity positions with <strong style={{ color: lockPrimary }}>Liquid Locking™</strong> and fee claiming
                    </p>
                    
                    {/* CTA Buttons */}
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        <Link to="/lock_wizard" style={styles.ctaButton(`linear-gradient(135deg, ${lockPrimary}, ${lockSecondary})`, `0 4px 20px ${lockPrimary}40`)}>
                            <FaMagic size={16} /> Lock Wizard
                        </Link>
                        <Link to="/wallet" style={styles.ctaButton(`linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`, `0 4px 20px ${theme.colors.success}40`)}>
                            <FaWallet size={16} /> Open Wallet
                        </Link>
                        <Link to="/help/sneedlock" style={styles.outlineButton}>
                            <FaBook size={16} /> Documentation
                        </Link>
                    </div>
                </div>
            </div>
            
            <main style={styles.container}>
                {/* What is SneedLock Section */}
                <section className="sneedlock-fade-in" style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <div style={{ ...styles.sectionIcon, background: `linear-gradient(135deg, ${lockPrimary}20, ${lockPrimary}10)` }}>
                            <FaLock size={20} style={{ color: lockPrimary }} />
                        </div>
                        <h2 style={styles.sectionTitle}>What is SneedLock?</h2>
                    </div>
                    <p style={styles.text}>
                        SneedLock is a trustless time-locking service for tokens and liquidity positions on the Internet Computer, 
                        integrated directly into your Sneed Wallet. It allows you to lock assets for a specified period, proving 
                        commitment and enabling various use cases like vesting schedules, governance participation, and trust-building 
                        mechanisms—all while maintaining complete transparency and security.
                    </p>
                    <p style={{ ...styles.text, marginBottom: 0 }}>
                        Once locked, assets cannot be accessed by anyone—including you—until the lock expires. This creates a 
                        verifiable, on-chain proof of long-term commitment that's perfect for token developers, team members, 
                        and investors who want to demonstrate they won't "rug pull" the community.
                    </p>
                </section>

                {/* Revolutionary Features Section */}
                <section className="sneedlock-fade-in-delay" style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <div style={{ ...styles.sectionIcon, background: `linear-gradient(135deg, ${theme.colors.success}20, ${theme.colors.success}10)` }}>
                            <FaCheckCircle size={20} style={{ color: theme.colors.success }} />
                        </div>
                        <h2 style={styles.sectionTitle}>Revolutionary Features</h2>
                    </div>
                    <p style={styles.text}>
                        SneedLock introduces groundbreaking capabilities that set it apart from traditional locking mechanisms:
                    </p>
                    <div style={styles.featureGrid}>
                        <div style={styles.feature}>
                            <div style={{ ...styles.featureIcon, background: `linear-gradient(135deg, ${theme.colors.warning}20, ${theme.colors.warning}10)` }}>
                                <FaCoins size={18} style={{ color: theme.colors.warning }} />
                            </div>
                            <h3 style={styles.featureTitle}>Fee Claiming from Locked LPs</h3>
                            <p style={styles.featureText}>
                                Lock your liquidity positions to prove commitment while still earning! Claim trading fees 
                                directly from your wallet even while the position remains locked.
                            </p>
                        </div>
                        <div style={styles.feature}>
                            <div style={{ ...styles.featureIcon, background: `linear-gradient(135deg, ${lockPrimary}20, ${lockPrimary}10)` }}>
                                <FaWater size={18} style={{ color: lockPrimary }} />
                            </div>
                            <h3 style={styles.featureTitle}>Liquid Locking™</h3>
                            <p style={styles.featureText}>
                                Transfer locked tokens and LP positions to other users! The locks stay enforced (no rug pulls), 
                                but ownership can change—liquidity meets safety.
                            </p>
                        </div>
                        <div style={styles.feature}>
                            <div style={{ ...styles.featureIcon, background: `linear-gradient(135deg, ${theme.colors.success}20, ${theme.colors.success}10)` }}>
                                <FaShieldAlt size={18} style={{ color: theme.colors.success }} />
                            </div>
                            <h3 style={styles.featureTitle}>Trustless & Immutable</h3>
                            <p style={styles.featureText}>
                                Locks cannot be canceled, modified, or unlocked early by anyone—not even the SneedLock 
                                operators. Enforced at the protocol level.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Use Cases Section */}
                <section className="sneedlock-fade-in-delay" style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <div style={{ ...styles.sectionIcon, background: `linear-gradient(135deg, ${theme.colors.accent}20, ${theme.colors.accent}10)` }}>
                            <FaChartLine size={20} style={{ color: theme.colors.accent }} />
                        </div>
                        <h2 style={styles.sectionTitle}>Use Cases</h2>
                    </div>
                    <div style={styles.featureGrid}>
                        <div style={styles.feature}>
                            <div style={{ ...styles.featureIcon, background: `linear-gradient(135deg, ${theme.colors.accent}20, ${theme.colors.accent}10)` }}>
                                <FaUsers size={18} style={{ color: theme.colors.accent }} />
                            </div>
                            <h3 style={styles.featureTitle}>Team Token Distribution</h3>
                            <p style={styles.featureText}>
                                Create locked token allocations and transfer them to team members using Liquid Locking. 
                                Team receives tokens immediately but can't dump them until vesting completes!
                            </p>
                        </div>
                        <div style={styles.feature}>
                            <div style={{ ...styles.featureIcon, background: `linear-gradient(135deg, ${lockPrimary}20, ${lockPrimary}10)` }}>
                                <FaLock size={18} style={{ color: lockPrimary }} />
                            </div>
                            <h3 style={styles.featureTitle}>LP Commitment Proof</h3>
                            <p style={styles.featureText}>
                                Lock liquidity positions to demonstrate you won't remove liquidity. Continue earning 
                                and claiming trading fees while building trust with your community.
                            </p>
                        </div>
                        <div style={styles.feature}>
                            <div style={{ ...styles.featureIcon, background: `linear-gradient(135deg, ${theme.colors.warning}20, ${theme.colors.warning}10)` }}>
                                <FaExchangeAlt size={18} style={{ color: theme.colors.warning }} />
                            </div>
                            <h3 style={styles.featureTitle}>Secondary Markets</h3>
                            <p style={styles.featureText}>
                                Trade locked positions at a discount using Liquid Locking. Buyers get exposure at lower 
                                prices, sellers get liquidity—no rugs possible.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Getting Started Section */}
                <section className="sneedlock-fade-in-delay" style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <div style={{ ...styles.sectionIcon, background: `linear-gradient(135deg, ${lockPrimary}20, ${lockPrimary}10)` }}>
                            <FaArrowRight size={20} style={{ color: lockPrimary }} />
                        </div>
                        <h2 style={styles.sectionTitle}>Getting Started</h2>
                    </div>
                    <p style={styles.text}>
                        Getting started with SneedLock is simple and integrated into your Sneed Wallet:
                    </p>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '1.5rem' }}>
                        {[
                            { text: 'Open Your Wallet', detail: <>Navigate to your <Link to="/wallet" style={{ color: lockPrimary, textDecoration: 'none', fontWeight: '500' }}>Sneed Wallet</Link> or use the <Link to="/lock_wizard" style={{ color: lockPrimary, textDecoration: 'none', fontWeight: '500' }}>Lock Wizard</Link></> },
                            { text: 'Register Tokens or LP Positions', detail: 'Add the tokens or swap pairs you want to lock' },
                            { text: 'Create a Lock', detail: 'Click the lock button, specify the amount and expiration date' },
                            { text: 'Optional - Transfer', detail: 'Use Liquid Locking to transfer locked assets to other users' },
                            { text: 'Claim Fees', detail: 'For locked LP positions, claim trading fees anytime from your wallet' }
                        ].map((step, i) => (
                            <div key={i} style={{ 
                                display: 'flex', 
                                alignItems: 'flex-start',
                                padding: '12px 14px',
                                background: theme.colors.primaryBg,
                                borderRadius: '12px',
                                border: `1px solid ${theme.colors.border}`,
                            }}>
                                <span style={styles.stepNumber}>{i + 1}</span>
                                <div>
                                    <strong style={{ color: theme.colors.primaryText, fontSize: '0.95rem' }}>{step.text}</strong>
                                    <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', marginTop: '2px' }}>{step.detail}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                    
                    <p style={{ ...styles.text, marginBottom: '1.5rem' }}>
                        All locks are publicly verifiable on-chain. View all locks, track expiration dates, and demonstrate 
                        your commitment with complete transparency.
                    </p>
                    
                    {/* Action Buttons */}
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        <Link to="/lock_wizard" style={styles.ctaButton(`linear-gradient(135deg, ${lockPrimary}, ${lockSecondary})`, `0 4px 20px ${lockPrimary}40`)}>
                            <FaMagic size={14} /> Lock Wizard
                        </Link>
                        <Link to="/wallet" style={styles.ctaButton(`linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`, `0 4px 20px ${theme.colors.success}40`)}>
                            <FaWallet size={14} /> Open Wallet
                        </Link>
                        <Link to={`/sneedlock_info${identity ? `?owner=${identity.getPrincipal().toString()}` : ''}`} style={styles.outlineButton}>
                            <FaLock size={14} /> My Locks
                        </Link>
                        <Link to="/sneedlock_info" style={styles.outlineButton}>
                            <FaShieldAlt size={14} /> All Locks
                        </Link>
                    </div>
                </section>
            </main>
        </div>
    );
}

export default Sneedlock; 