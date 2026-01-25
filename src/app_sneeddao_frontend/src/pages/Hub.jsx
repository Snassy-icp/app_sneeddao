import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import { Link } from 'react-router-dom';
import { FaExchangeAlt, FaCoins, FaLock, FaComments, FaWallet, FaServer, FaNewspaper, FaUsers, FaVoteYea, FaRss, FaArrowRight } from 'react-icons/fa';

function Hub() {
    const { theme } = useTheme();

    const styles = {
        heroSection: {
            background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, ${theme.colors.tertiaryBg || theme.colors.secondaryBg} 100%)`,
            borderRadius: '20px',
            padding: '3rem 2rem',
            marginBottom: '2rem',
            border: `1px solid ${theme.colors.border}`,
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
        },
        heroTitle: {
            fontSize: '3rem',
            fontWeight: '800',
            color: theme.colors.primaryText,
            marginBottom: '1.5rem',
            letterSpacing: '-0.02em',
        },
        heroSubtitle: {
            color: theme.colors.secondaryText,
            fontSize: '1.15rem',
            lineHeight: '1.8',
            maxWidth: '850px',
            margin: '0 auto 2rem auto',
        },
        highlight: {
            color: theme.colors.accent,
            fontWeight: '600',
        },
        ctaButtons: {
            display: 'flex',
            justifyContent: 'center',
            gap: '1rem',
            flexWrap: 'wrap',
        },
        primaryBtn: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}dd)`,
            color: '#fff',
            padding: '14px 28px',
            borderRadius: '12px',
            textDecoration: 'none',
            fontWeight: '700',
            fontSize: '1rem',
            boxShadow: `0 4px 20px ${theme.colors.accent}40`,
            transition: 'all 0.2s ease',
        },
        secondaryBtn: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: theme.colors.success,
            color: '#fff',
            padding: '14px 28px',
            borderRadius: '12px',
            textDecoration: 'none',
            fontWeight: '700',
            fontSize: '1rem',
            boxShadow: `0 4px 20px ${theme.colors.success}40`,
            transition: 'all 0.2s ease',
        },
        tertiaryBtn: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: '#9b59b6',
            color: '#fff',
            padding: '14px 28px',
            borderRadius: '12px',
            textDecoration: 'none',
            fontWeight: '700',
            fontSize: '1rem',
            boxShadow: '0 4px 20px rgba(155, 89, 182, 0.4)',
            transition: 'all 0.2s ease',
        },
        sectionTitle: {
            fontSize: '1.5rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
        },
        featureGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '1rem',
            marginBottom: '2rem',
        },
        featureCard: {
            background: theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            transition: 'all 0.2s ease',
            textDecoration: 'none',
            color: 'inherit',
        },
        cardIcon: {
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1rem',
            fontSize: '1.4rem',
        },
        cardTitle: {
            color: theme.colors.primaryText,
            fontWeight: '700',
            fontSize: '1.1rem',
            marginBottom: '0.5rem',
        },
        cardDesc: {
            color: theme.colors.mutedText,
            fontSize: '0.9rem',
            lineHeight: '1.6',
            marginBottom: '1rem',
            flex: 1,
        },
        cardCta: {
            color: theme.colors.accent,
            fontWeight: '600',
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
        },
        featuredSection: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '1.5rem',
            marginBottom: '2rem',
        },
        featuredCard: {
            background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, ${theme.colors.tertiaryBg || theme.colors.secondaryBg} 100%)`,
            border: `2px solid ${theme.colors.border}`,
            borderRadius: '20px',
            padding: '2rem',
            display: 'flex',
            flexDirection: 'column',
            textDecoration: 'none',
            color: 'inherit',
            position: 'relative',
            overflow: 'hidden',
        },
        featuredBadge: {
            position: 'absolute',
            top: '1rem',
            right: '1rem',
            background: `${theme.colors.accent}20`,
            color: theme.colors.accent,
            padding: '4px 12px',
            borderRadius: '20px',
            fontSize: '0.75rem',
            fontWeight: '700',
            textTransform: 'uppercase',
        },
        featuredTitle: {
            fontSize: '1.4rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
            marginBottom: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
        },
        featuredDesc: {
            color: theme.colors.secondaryText,
            fontSize: '1rem',
            lineHeight: '1.7',
            marginBottom: '1.5rem',
            flex: 1,
        },
        contextNote: {
            background: `${theme.colors.accent}10`,
            border: `1px solid ${theme.colors.accent}30`,
            borderRadius: '12px',
            padding: '1rem 1.5rem',
            marginBottom: '2rem',
            textAlign: 'center',
            color: theme.colors.secondaryText,
            fontSize: '0.95rem',
        },
    };

    const featuredProducts = [
        {
            title: 'Sneedex Marketplace',
            icon: <FaExchangeAlt />,
            desc: 'Trade canisters, neurons, tokens, and more through secure on-chain escrow. Buy and sell staking positions, neuron managers, and digital assets with confidence.',
            path: '/sneedex_offers',
            cta: 'Browse Marketplace',
            color: theme.colors.accent,
            badge: 'Popular',
        },
        {
            title: 'Liquid Staking',
            icon: <FaCoins />,
            desc: 'Make your staking positions tradable! Create ICP Neuron Manager canisters or stake SNS tokens in a way that keeps them transferable and sellable on Sneedex.',
            path: '/liquid_staking',
            cta: 'Start Staking',
            color: theme.colors.success,
            badge: 'Core Feature',
        },
        {
            title: 'Sneed Lock',
            icon: <FaLock />,
            desc: 'Create token locks, vesting schedules, and time-locked positions. Perfect for team tokens, investor vesting, or personal savings goals.',
            path: '/sneedlock_info',
            cta: 'Create Lock',
            color: '#9b59b6',
            badge: 'Secure',
        },
    ];

    const communityFeatures = [
        {
            title: 'SNS Forum',
            icon: <FaComments />,
            desc: 'Discuss proposals, share ideas, and engage with your DAO community. Rich text with Markdown and emoji support.',
            path: '/forum',
            cta: 'Visit Forum',
            color: '#e74c3c',
        },
        {
            title: 'Activity Feed',
            icon: <FaRss />,
            desc: 'Stay up to date with the latest activity across SNS DAOs. See proposals, votes, and community updates in real-time.',
            path: '/feed',
            cta: 'View Feed',
            color: '#f39c12',
        },
        {
            title: 'Direct Messages',
            icon: <FaUsers />,
            desc: 'Send private messages to other users with full Markdown and emoji support.',
            path: '/sms',
            cta: 'Open Messages',
            color: '#1abc9c',
        },
    ];

    const governanceFeatures = [
        {
            title: 'Proposals',
            icon: <FaVoteYea />,
            desc: 'Browse and vote on proposals across all SNS DAOs. Track voting activity and governance decisions.',
            path: '/proposals',
            cta: 'View Proposals',
            color: theme.colors.accent,
        },
        {
            title: 'Neurons',
            icon: <FaNewspaper />,
            desc: 'Explore neurons, manage voting power, and configure your staking positions.',
            path: '/neurons',
            cta: 'Browse Neurons',
            color: theme.colors.success,
        },
        {
            title: 'SNS Directory',
            icon: <FaUsers />,
            desc: 'Discover SNS DAOs and explore their governance, communities, and tokens.',
            path: '/sns',
            cta: 'Browse SNSes',
            color: '#9b59b6',
        },
    ];

    const utilityFeatures = [
        {
            title: 'Wallet',
            icon: <FaWallet />,
            desc: 'Track your token balances across all SNS tokens and ICP. Send, receive, and manage your assets.',
            path: '/wallet',
            cta: 'Open Wallet',
            color: theme.colors.accent,
        },
        {
            title: 'Canisters',
            icon: <FaServer />,
            desc: 'Monitor your canisters, check cycles, and manage canister ownership and controllers.',
            path: '/canisters',
            cta: 'Manage Canisters',
            color: theme.colors.success,
        },
    ];

    const renderFeatureCard = (card) => (
        <Link
            key={card.title}
            to={card.path}
            style={styles.featureCard}
            onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = card.color;
                e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = theme.colors.border;
                e.currentTarget.style.transform = 'translateY(0)';
            }}
        >
            <div style={{ ...styles.cardIcon, background: `${card.color}20`, color: card.color }}>
                {card.icon}
            </div>
            <div style={styles.cardTitle}>{card.title}</div>
            <div style={styles.cardDesc}>{card.desc}</div>
            <div style={{ ...styles.cardCta, color: card.color }}>
                {card.cta}
                <FaArrowRight size={12} />
            </div>
        </Link>
    );

    return (
        <div 
            className='page-container'
            style={{
                background: theme.colors.primaryGradient,
                color: theme.colors.primaryText,
                minHeight: '100vh'
            }}
        >
            <Header showSnsDropdown={true} />
            <main style={{
                maxWidth: '1200px',
                margin: '0 auto',
                padding: '2rem'
            }}>
                {/* Hero Section */}
                <div style={styles.heroSection}>
                    <h1 style={styles.heroTitle}>
                        Welcome to Sneed Hub
                    </h1>
                    <p style={styles.heroSubtitle}>
                        Your all-in-one platform for the Internet Computer ecosystem. 
                        Trade on <span style={styles.highlight}>Sneedex</span>, 
                        unlock <span style={styles.highlight}>liquid staking</span> for ICP and SNS neurons, 
                        secure tokens with <span style={styles.highlight}>Sneed Lock</span>, 
                        and engage in <span style={styles.highlight}>DAO governance</span> with 
                        forums, feeds, and social tools — all from your <span style={styles.highlight}>wallet</span>.
                    </p>
                    <div style={styles.ctaButtons}>
                        <Link to="/sneedex_offers" style={styles.primaryBtn}>
                            <FaExchangeAlt />
                            Browse Sneedex
                        </Link>
                        <Link to="/liquid_staking" style={styles.secondaryBtn}>
                            <FaCoins />
                            Liquid Staking
                        </Link>
                        <Link to="/sneedlock_info" style={styles.tertiaryBtn}>
                            <FaLock />
                            Sneed Lock
                        </Link>
                    </div>
                </div>

                {/* Context Note */}
                <div style={styles.contextNote}>
                    💡 Use the <strong>SNS dropdown</strong> in the header to switch context across DAOs anywhere on the site.
                </div>

                {/* Featured Products */}
                <div style={styles.featuredSection}>
                    {featuredProducts.map((product) => (
                        <Link
                            key={product.title}
                            to={product.path}
                            style={{ ...styles.featuredCard, borderColor: `${product.color}40` }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor = product.color;
                                e.currentTarget.style.transform = 'translateY(-4px)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = `${product.color}40`;
                                e.currentTarget.style.transform = 'translateY(0)';
                            }}
                        >
                            <div style={{ ...styles.featuredBadge, background: `${product.color}20`, color: product.color }}>
                                {product.badge}
                            </div>
                            <div style={styles.featuredTitle}>
                                <span style={{ color: product.color }}>{product.icon}</span>
                                {product.title}
                            </div>
                            <div style={styles.featuredDesc}>{product.desc}</div>
                            <div style={{ ...styles.cardCta, color: product.color }}>
                                {product.cta}
                                <FaArrowRight size={12} />
                            </div>
                        </Link>
                    ))}
                </div>

                {/* Community & Social */}
                <h2 style={styles.sectionTitle}>
                    <FaComments style={{ color: '#e74c3c' }} />
                    Community & Social
                </h2>
                <div style={styles.featureGrid}>
                    {communityFeatures.map(renderFeatureCard)}
                </div>

                {/* Governance */}
                <h2 style={styles.sectionTitle}>
                    <FaVoteYea style={{ color: theme.colors.accent }} />
                    Governance
                </h2>
                <div style={styles.featureGrid}>
                    {governanceFeatures.map(renderFeatureCard)}
                </div>

                {/* Utilities */}
                <h2 style={styles.sectionTitle}>
                    <FaWallet style={{ color: theme.colors.success }} />
                    Utilities
                </h2>
                <div style={styles.featureGrid}>
                    {utilityFeatures.map(renderFeatureCard)}
                </div>
            </main>
        </div>
    );
}

export default Hub;
