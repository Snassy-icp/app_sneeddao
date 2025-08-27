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
                        The next generation of secure token vesting and distribution on the Internet Computer
                    </p>
                </div>

                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>What is SneedLock?</h2>
                    <p style={styles.text}>
                        SneedLock is a revolutionary token vesting and distribution system built on the Internet Computer, 
                        designed to provide maximum security, transparency, and flexibility for token distribution programs. 
                        Whether you're managing team tokens, investor allocations, or community rewards, SneedLock ensures 
                        your tokens are distributed exactly according to plan, with zero possibility of manipulation or 
                        unauthorized access.
                    </p>
                </section>

                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>How It Works</h2>
                    <p style={styles.text}>
                        SneedLock operates through a system of smart contracts on the Internet Computer, utilizing 
                        the platform's unique capabilities to provide secure and efficient token vesting. Each vesting 
                        schedule is immutably recorded on-chain, with automatic distribution mechanisms that execute 
                        precisely according to the predetermined schedule.
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
                            <h3 style={styles.featureTitle}>Secure Token Storage</h3>
                            <p style={styles.featureText}>
                                Tokens are held in secure canister-based wallets, protected by the Internet Computer's 
                                robust security infrastructure. Each wallet is isolated and independently verifiable.
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
                            <h3 style={styles.featureTitle}>Flexible Vesting Schedules</h3>
                            <p style={styles.featureText}>
                                Create custom vesting schedules with multiple parameters including cliff periods, 
                                linear vesting, and milestone-based releases. Adapt to any token distribution strategy.
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
                            <h3 style={styles.featureTitle}>Automated Distribution</h3>
                            <p style={styles.featureText}>
                                Once configured, distributions happen automatically according to the schedule. No manual 
                                intervention needed, eliminating human error and reducing operational overhead.
                            </p>
                        </div>
                    </div>
                </section>

                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>Key Benefits</h2>
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
                            <h3 style={styles.featureTitle}>Trustless Operation</h3>
                            <p style={styles.featureText}>
                                All rules are enforced by smart contracts. No need to trust intermediaries or 
                                administrators - the code ensures everything happens as planned.
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
                            <h3 style={styles.featureTitle}>Full Transparency</h3>
                            <p style={styles.featureText}>
                                Every aspect of the vesting process is visible on-chain. Track vesting progress, 
                                distribution events, and wallet balances in real-time.
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
                            <h3 style={styles.featureTitle}>Gas-Free Operations</h3>
                            <p style={styles.featureText}>
                                Leveraging the Internet Computer's unique architecture, all operations are gas-free, 
                                making token distribution cost-effective and predictable.
                            </p>
                        </div>
                    </div>
                </section>

                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>Getting Started</h2>
                    <p style={styles.text}>
                        Using SneedLock is straightforward. Connect your Internet Computer wallet, create your vesting 
                        schedules, and deposit your tokens. The system takes care of the rest, ensuring your tokens 
                        are distributed according to plan while providing you with real-time visibility into the 
                        entire process.
                    </p>
                    <p style={styles.text}>
                        Whether you're a project founder, team member, or token recipient, SneedLock provides the 
                        tools and transparency you need to manage token vesting with confidence.
                    </p>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        marginTop: '2rem'
                    }}>
                        <Link
                            to={`/sneedlock_info${identity ? `?owner=${identity.getPrincipal().toString()}` : ''}`}
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
                            <img 
                                src="/sneedlock-logo4.png" 
                                alt="Sneedlock"
                                style={{
                                    width: '24px',
                                    height: '24px',
                                    objectFit: 'contain'
                                }}
                            />
                            View My Locks
                        </Link>
                    </div>
                </section>
            </main>
        </div>
    );
}

export default Sneedlock; 