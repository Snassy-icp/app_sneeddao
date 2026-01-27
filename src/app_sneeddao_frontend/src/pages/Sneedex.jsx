import React, { useState, useEffect, useCallback } from 'react';
import Header from '../components/Header';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { FaExchangeAlt, FaGavel, FaShieldAlt, FaCubes, FaCoins, FaBrain, FaCog, FaUnlock } from 'react-icons/fa';
import { createSneedexActor, formatFeeRate } from '../utils/SneedexUtils';

function Sneedex() {
    const { identity, isAuthenticated } = useAuth();
    const { theme } = useTheme();
    const [stats, setStats] = useState(null);
    const [feeRate, setFeeRate] = useState(null);
    const [isAdmin, setIsAdmin] = useState(false);
    
    const fetchFeeSettings = useCallback(async () => {
        try {
            const actor = createSneedexActor(identity);
            const rate = await actor.getMarketplaceFeeRate();
            setFeeRate(Number(rate));
        } catch (e) {
            console.error('Failed to fetch fee settings:', e);
        }
    }, [identity]);
    
    const checkAdminStatus = useCallback(async () => {
        if (!isAuthenticated || !identity) {
            setIsAdmin(false);
            return;
        }
        try {
            const actor = createSneedexActor(identity);
            const config = await actor.getConfig();
            const userPrincipal = identity.getPrincipal().toString();
            const adminList = config.admins.map(p => p.toString());
            setIsAdmin(adminList.includes(userPrincipal));
        } catch (e) {
            console.error('Failed to check admin status:', e);
            setIsAdmin(false);
        }
    }, [identity, isAuthenticated]);
    
    useEffect(() => {
        const fetchStats = async () => {
            try {
                const actor = createSneedexActor(identity);
                const marketStats = await actor.getMarketStats();
                setStats(marketStats);
            } catch (e) {
                console.error('Failed to fetch market stats:', e);
            }
        };
        fetchStats();
        fetchFeeSettings();
        checkAdminStatus();
    }, [identity, fetchFeeSettings, checkAdminStatus]);
    
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
            position: 'relative',
        },
        heroGlow: {
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '600px',
            height: '400px',
            background: `radial-gradient(ellipse, ${theme.colors.accent}15, transparent 70%)`,
            zIndex: 0,
            pointerEvents: 'none',
        },
        title: {
            fontSize: '3.5rem',
            marginBottom: '1rem',
            background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.success})`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            fontWeight: 'bold',
            position: 'relative',
            zIndex: 1,
        },
        tagline: {
            fontSize: '1.3rem',
            color: theme.colors.mutedText,
            marginBottom: '0.5rem',
            fontStyle: 'italic',
        },
        subtitle: {
            fontSize: '1.5rem',
            color: theme.colors.secondaryText,
            marginBottom: '2rem',
            lineHeight: '1.5',
            maxWidth: '800px',
            margin: '0 auto 2rem auto',
            position: 'relative',
            zIndex: 1,
        },
        buttonRow: {
            display: 'flex',
            justifyContent: 'center',
            gap: '16px',
            marginTop: '24px',
            flexWrap: 'wrap',
            position: 'relative',
            zIndex: 1,
        },
        primaryButton: {
            background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}cc)`,
            color: theme.colors.primaryBg,
            padding: '14px 32px',
            borderRadius: '12px',
            textDecoration: 'none',
            fontSize: '1.1rem',
            fontWeight: '700',
            transition: 'all 0.3s ease',
            boxShadow: `0 4px 20px ${theme.colors.accent}40`,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '10px',
        },
        secondaryButton: {
            background: `${theme.colors.success}15`,
            color: theme.colors.success,
            border: `2px solid ${theme.colors.success}`,
            padding: '12px 28px',
            borderRadius: '12px',
            textDecoration: 'none',
            fontSize: '1rem',
            fontWeight: '600',
            transition: 'all 0.3s ease',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
        },
        section: {
            marginBottom: '3rem',
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
            padding: '2.5rem',
            boxShadow: theme.colors.cardShadow,
        },
        sectionTitle: {
            fontSize: '2rem',
            marginBottom: '1.5rem',
            color: theme.colors.accent,
            fontWeight: '700',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
        },
        text: {
            fontSize: '1.1rem',
            lineHeight: '1.7',
            marginBottom: '1.5rem',
            color: theme.colors.secondaryText,
        },
        assetGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1.5rem',
            marginTop: '2rem',
        },
        assetCard: {
            background: `linear-gradient(145deg, ${theme.colors.tertiaryBg}, ${theme.colors.secondaryBg})`,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '14px',
            padding: '1.5rem',
            transition: 'all 0.3s ease',
            cursor: 'pointer',
        },
        assetIcon: {
            fontSize: '2.5rem',
            marginBottom: '1rem',
        },
        assetTitle: {
            fontSize: '1.3rem',
            fontWeight: '700',
            marginBottom: '0.75rem',
            color: theme.colors.primaryText,
        },
        assetDescription: {
            fontSize: '0.95rem',
            color: theme.colors.mutedText,
            lineHeight: '1.5',
        },
        featureList: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '1.5rem',
            marginTop: '1.5rem',
        },
        feature: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: '1rem',
            padding: '1.25rem',
            background: theme.colors.tertiaryBg,
            borderRadius: '12px',
            border: `1px solid ${theme.colors.border}`,
        },
        featureIcon: {
            fontSize: '1.5rem',
            color: theme.colors.accent,
            flexShrink: 0,
            marginTop: '2px',
        },
        featureContent: {
            flex: 1,
        },
        featureTitle: {
            fontSize: '1.1rem',
            fontWeight: '600',
            marginBottom: '0.5rem',
            color: theme.colors.primaryText,
        },
        featureText: {
            fontSize: '0.95rem',
            color: theme.colors.mutedText,
            lineHeight: '1.5',
        },
        statsRow: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '1rem',
            marginTop: '2rem',
        },
        statCard: {
            background: theme.colors.tertiaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '12px',
            padding: '1.25rem',
            textAlign: 'center',
        },
        statValue: {
            fontSize: '2rem',
            fontWeight: '700',
            color: theme.colors.accent,
            marginBottom: '0.25rem',
        },
        statLabel: {
            fontSize: '0.9rem',
            color: theme.colors.mutedText,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
        },
    };

    const assetTypes = [
        {
            icon: '🏭',
            title: 'Canisters',
            description: 'Trade full Internet Computer canisters. Controllers are transferred atomically through escrow.',
            color: theme.colors.accent,
        },
        {
            icon: '🧠',
            title: 'SNS Neurons',
            description: 'Buy and sell SNS governance neurons. Hotkey permissions ensure secure atomic transfers.',
            color: theme.colors.success,
        },
        {
            icon: '🏛️',
            title: 'ICP Neuron Managers',
            description: 'Trade ICP neurons via manager canisters. Full NNS voting power, liquid ownership.',
            color: '#8B5CF6',
        },
        {
            icon: '🪙',
            title: 'ICRC1 Tokens',
            description: 'Bundle fungible tokens into offers. Perfect for OTC trades and bulk transactions.',
            color: theme.colors.warning,
        },
    ];

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={styles.container}>
                {/* Hero Section */}
                <div style={styles.hero}>
                    <div style={styles.heroGlow} />
                    <h1 style={styles.title}>Sneedex</h1>
                    <p style={styles.tagline}>The Decentralized Exchange for Everything</p>
                    <p style={styles.subtitle}>
                        Trade canisters, SNS neurons, ICP Neuron Managers, and ICRC1 tokens through trustless escrow auctions.
                        Bundle multiple assets, set your terms, and let the market decide.
                    </p>
                    <div style={{
                        margin: '18px auto 0 auto',
                        maxWidth: '900px',
                        background: `linear-gradient(135deg, ${theme.colors.accent}15, #8B5CF615)`,
                        border: `1px solid ${theme.colors.accent}40`,
                        borderRadius: '14px',
                        padding: '16px 20px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '16px',
                        flexWrap: 'wrap'
                    }}>
                        <div style={{ color: theme.colors.primaryText, fontWeight: 600, flex: 1, minWidth: '200px' }}>
                            ✨ <strong>Liquid Staking:</strong> Create tradable ICP or SNS neurons and sell them here on Sneedex!
                        </div>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <Link
                                to="/create_icp_neuron"
                                style={{
                                    background: theme.colors.accent,
                                    color: theme.colors.primaryBg,
                                    padding: '10px 14px',
                                    borderRadius: '10px',
                                    textDecoration: 'none',
                                    fontWeight: 700,
                                    whiteSpace: 'nowrap',
                                    fontSize: '0.9rem'
                                }}
                            >
                                ICP Liquid Staking →
                            </Link>
                            <Link
                                to="/sns_neuron_wizard"
                                style={{
                                    background: '#8B5CF6',
                                    color: '#fff',
                                    padding: '10px 14px',
                                    borderRadius: '10px',
                                    textDecoration: 'none',
                                    fontWeight: 700,
                                    whiteSpace: 'nowrap',
                                    fontSize: '0.9rem'
                                }}
                            >
                                SNS Liquid Staking →
                            </Link>
                        </div>
                    </div>
                    {/* SNS Jailbreak Banner */}
                    <div style={{
                        margin: '12px auto 0 auto',
                        maxWidth: '900px',
                        background: `linear-gradient(135deg, #e67e2215, #f39c1215)`,
                        border: `1px solid #e67e2240`,
                        borderRadius: '14px',
                        padding: '14px 20px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '16px',
                        flexWrap: 'wrap'
                    }}>
                        <div style={{ color: theme.colors.primaryText, fontWeight: 600, flex: 1, minWidth: '200px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <FaUnlock style={{ color: '#e67e22' }} />
                            <span><strong>SNS Jailbreak:</strong> Already have SNS neurons? Make them tradable on Sneedex!</span>
                        </div>
                        <Link
                            to="/tools/sns_jailbreak"
                            style={{
                                background: '#e67e22',
                                color: '#fff',
                                padding: '10px 14px',
                                borderRadius: '10px',
                                textDecoration: 'none',
                                fontWeight: 700,
                                whiteSpace: 'nowrap',
                                fontSize: '0.9rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                            }}
                        >
                            <FaUnlock size={12} /> Jailbreak Neurons →
                        </Link>
                    </div>
                    <div style={styles.buttonRow}>
                        <Link
                            to="/sneedex_offers"
                            style={styles.primaryButton}
                            onMouseEnter={(e) => {
                                e.target.style.transform = 'translateY(-3px)';
                                e.target.style.boxShadow = `0 8px 30px ${theme.colors.accent}50`;
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.transform = 'translateY(0)';
                                e.target.style.boxShadow = `0 4px 20px ${theme.colors.accent}40`;
                            }}
                        >
                            <FaExchangeAlt /> Browse Marketplace
                        </Link>
                        {isAuthenticated && (
                            <Link
                                to="/sneedex_create"
                                style={styles.secondaryButton}
                                onMouseEnter={(e) => {
                                    e.target.style.background = theme.colors.success;
                                    e.target.style.color = theme.colors.primaryBg;
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.background = `${theme.colors.success}15`;
                                    e.target.style.color = theme.colors.success;
                                }}
                            >
                                <FaGavel /> Create Offer
                            </Link>
                        )}
                        {isAuthenticated && (
                            <Link
                                to="/sneedex_my"
                                style={{
                                    ...styles.secondaryButton,
                                    background: `${theme.colors.accent}15`,
                                    color: theme.colors.accent,
                                    borderColor: theme.colors.accent,
                                }}
                                onMouseEnter={(e) => {
                                    e.target.style.background = theme.colors.accent;
                                    e.target.style.color = theme.colors.primaryBg;
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.background = `${theme.colors.accent}15`;
                                    e.target.style.color = theme.colors.accent;
                                }}
                            >
                                📋 My Offers & Bids
                            </Link>
                        )}
                    </div>
                </div>

                {/* What is Sneedex */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaShieldAlt style={{ color: theme.colors.accent }} />
                        What is Sneedex?
                    </h2>
                    <p style={styles.text}>
                        Sneedex is a trustless marketplace for trading unique Internet Computer assets. 
                        Unlike traditional DEXes that only handle fungible tokens, Sneedex enables 
                        atomic trades of <strong>canisters</strong>, <strong>SNS neurons</strong>, and 
                        <strong> ICRC1 tokens</strong>—all through secure escrow.
                    </p>
                    <p style={styles.text}>
                        Create offers with flexible pricing: set a minimum bid for auctions, a buyout 
                        price for instant sales, or both. Bundle multiple assets into a single offer, 
                        and let buyers compete through trustless bidding.
                    </p>
                </section>

                {/* Supported Assets */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaCubes style={{ color: theme.colors.success }} />
                        Supported Asset Types
                    </h2>
                    <p style={styles.text}>
                        Sneedex supports four types of assets, with more coming in the future:
                    </p>
                    <div style={styles.assetGrid}>
                        {assetTypes.map((asset, index) => (
                            <div
                                key={index}
                                style={styles.assetCard}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-5px)';
                                    e.currentTarget.style.borderColor = asset.color;
                                    e.currentTarget.style.boxShadow = `0 10px 30px ${asset.color}20`;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.borderColor = theme.colors.border;
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                            >
                                <div style={styles.assetIcon}>{asset.icon}</div>
                                <h3 style={{ ...styles.assetTitle, color: asset.color }}>{asset.title}</h3>
                                <p style={styles.assetDescription}>{asset.description}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* How It Works */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaGavel style={{ color: theme.colors.warning }} />
                        How It Works
                    </h2>
                    <div style={styles.featureList}>
                        <div style={styles.feature}>
                            <div style={styles.featureIcon}>1️⃣</div>
                            <div style={styles.featureContent}>
                                <h4 style={styles.featureTitle}>Create an Offer</h4>
                                <p style={styles.featureText}>
                                    Define your terms: minimum bid, buyout price, and/or expiration date. 
                                    Add assets (canisters, neurons, tokens) to your offer.
                                </p>
                            </div>
                        </div>
                        <div style={styles.feature}>
                            <div style={styles.featureIcon}>2️⃣</div>
                            <div style={styles.featureContent}>
                                <h4 style={styles.featureTitle}>Escrow Your Assets</h4>
                                <p style={styles.featureText}>
                                    Transfer asset control to Sneedex. Controllers are snapshotted, 
                                    tokens moved to escrow subaccounts. Your assets are safe.
                                </p>
                            </div>
                        </div>
                        <div style={styles.feature}>
                            <div style={styles.featureIcon}>3️⃣</div>
                            <div style={styles.featureContent}>
                                <h4 style={styles.featureTitle}>Receive Bids</h4>
                                <p style={styles.featureText}>
                                    Buyers place bids by depositing tokens. Bids must exceed the minimum 
                                    and beat existing bids. Buyout triggers instant completion.
                                </p>
                            </div>
                        </div>
                        <div style={styles.feature}>
                            <div style={styles.featureIcon}>4️⃣</div>
                            <div style={styles.featureContent}>
                                <h4 style={styles.featureTitle}>Atomic Settlement</h4>
                                <p style={styles.featureText}>
                                    When the offer completes, assets transfer to the winner and payment 
                                    to the seller—atomically. Losing bids are refunded.
                                </p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Key Features */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaCoins style={{ color: theme.colors.accent }} />
                        Key Features
                    </h2>
                    <div style={styles.featureList}>
                        <div style={styles.feature}>
                            <div style={styles.featureIcon}>🔒</div>
                            <div style={styles.featureContent}>
                                <h4 style={styles.featureTitle}>Trustless Escrow</h4>
                                <p style={styles.featureText}>
                                    Assets are held securely until the trade completes. No middleman, 
                                    no trust required—just code.
                                </p>
                            </div>
                        </div>
                        <div style={styles.feature}>
                            <div style={styles.featureIcon}>⚡</div>
                            <div style={styles.featureContent}>
                                <h4 style={styles.featureTitle}>Atomic Transfers</h4>
                                <p style={styles.featureText}>
                                    All assets in an offer change hands simultaneously. No partial 
                                    fills, no race conditions.
                                </p>
                            </div>
                        </div>
                        <div style={styles.feature}>
                            <div style={styles.featureIcon}>📦</div>
                            <div style={styles.featureContent}>
                                <h4 style={styles.featureTitle}>Asset Bundling</h4>
                                <p style={styles.featureText}>
                                    Combine multiple canisters, neurons, and tokens into a single 
                                    offer for complex deals.
                                </p>
                            </div>
                        </div>
                        <div style={styles.feature}>
                            <div style={styles.featureIcon}>🎯</div>
                            <div style={styles.featureContent}>
                                <h4 style={styles.featureTitle}>Flexible Pricing</h4>
                                <p style={styles.featureText}>
                                    Auctions with minimum bids, instant buyouts, timed expirations, 
                                    or combinations—you choose.
                                </p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Live Stats */}
                {stats && (
                    <section style={styles.section}>
                        <h2 style={styles.sectionTitle}>
                            📊 Marketplace Stats
                        </h2>
                        <div style={styles.statsRow}>
                            <div style={styles.statCard}>
                                <div style={styles.statValue}>{Number(stats.active_offers)}</div>
                                <div style={styles.statLabel}>Active Offers</div>
                            </div>
                            <div style={styles.statCard}>
                                <div style={styles.statValue}>{Number(stats.total_offers)}</div>
                                <div style={styles.statLabel}>Total Offers</div>
                            </div>
                            <div style={styles.statCard}>
                                <div style={styles.statValue}>{Number(stats.completed_offers)}</div>
                                <div style={styles.statLabel}>Completed</div>
                            </div>
                            <div style={styles.statCard}>
                                <div style={styles.statValue}>{Number(stats.total_bids)}</div>
                                <div style={styles.statLabel}>Total Bids</div>
                            </div>
                            {feeRate !== null && (
                                <div style={styles.statCard}>
                                    <div style={{ ...styles.statValue, color: theme.colors.warning }}>
                                        {formatFeeRate(feeRate)}
                                    </div>
                                    <div style={styles.statLabel}>Marketplace Fee</div>
                                </div>
                            )}
                        </div>
                    </section>
                )}
                
                {/* Admin Link */}
                {isAdmin && (
                    <section style={{ ...styles.section, borderColor: theme.colors.warning }}>
                        <Link
                            to="/admin/sneedex"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                textDecoration: 'none',
                                color: theme.colors.primaryText,
                            }}
                        >
                            <FaCog style={{ color: theme.colors.warning, fontSize: '1.5rem' }} />
                            <div>
                                <h2 style={{ ...styles.sectionTitle, marginBottom: '0.25rem' }}>
                                    Admin Settings
                                </h2>
                                <p style={{ color: theme.colors.mutedText, margin: 0, fontSize: '0.95rem' }}>
                                    Manage marketplace fees, admins, and configuration →
                                </p>
                            </div>
                        </Link>
                    </section>
                )}

                {/* CTA */}
                <section style={{ ...styles.section, textAlign: 'center', background: `linear-gradient(135deg, ${theme.colors.accent}15, ${theme.colors.success}15)` }}>
                    <h2 style={{ ...styles.sectionTitle, justifyContent: 'center' }}>
                        Ready to Trade?
                    </h2>
                    <p style={{ ...styles.text, maxWidth: '600px', margin: '0 auto 2rem auto' }}>
                        Browse active offers, create your own, or manage your existing trades. 
                        The decentralized marketplace awaits.
                    </p>
                    <div style={styles.buttonRow}>
                        <Link
                            to="/sneedex_offers"
                            style={styles.primaryButton}
                            onMouseEnter={(e) => {
                                e.target.style.transform = 'translateY(-3px)';
                                e.target.style.boxShadow = `0 8px 30px ${theme.colors.accent}50`;
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.transform = 'translateY(0)';
                                e.target.style.boxShadow = `0 4px 20px ${theme.colors.accent}40`;
                            }}
                        >
                            <FaExchangeAlt /> Explore Marketplace
                        </Link>
                    </div>
                </section>
            </main>
        </div>
    );
}

export default Sneedex;

