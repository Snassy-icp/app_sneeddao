import React from 'react';
import { Link } from 'react-router-dom';
import { FaArrowRight, FaExchangeAlt, FaLock, FaUnlock, FaCoins, FaCheckCircle, FaRocket, FaShieldAlt } from 'react-icons/fa';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';

export default function LiquidStaking() {
    const { theme } = useTheme();

    const styles = {
        container: {
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '2rem',
        },
        heroSection: {
            textAlign: 'center',
            marginBottom: '3rem',
            padding: '3rem 2rem',
            background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, ${theme.colors.tertiaryBg || theme.colors.secondaryBg} 100%)`,
            borderRadius: '20px',
            border: `1px solid ${theme.colors.border}`,
            position: 'relative',
            overflow: 'hidden',
        },
        heroTitle: {
            fontSize: '2.8rem',
            fontWeight: '800',
            color: theme.colors.primaryText,
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
        },
        heroSubtitle: {
            fontSize: '1.25rem',
            color: theme.colors.secondaryText,
            maxWidth: '800px',
            margin: '0 auto 2rem',
            lineHeight: '1.7',
        },
        heroHighlight: {
            color: theme.colors.accent,
            fontWeight: '700',
        },
        heroBadge: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: `linear-gradient(135deg, ${theme.colors.accent}20, ${theme.colors.accent}10)`,
            border: `1px solid ${theme.colors.accent}40`,
            borderRadius: '30px',
            padding: '8px 20px',
            fontSize: '0.95rem',
            color: theme.colors.accent,
            fontWeight: '600',
            marginBottom: '1.5rem',
        },
        featureGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '1.5rem',
            marginBottom: '2rem',
        },
        featureCard: {
            background: theme.colors.secondaryBg,
            borderRadius: '16px',
            padding: '2rem',
            border: `1px solid ${theme.colors.border}`,
            transition: 'all 0.3s ease',
            position: 'relative',
            overflow: 'hidden',
        },
        featureCardPrimary: {
            background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, ${theme.colors.accent}08 100%)`,
            border: `2px solid ${theme.colors.accent}40`,
        },
        featureIcon: {
            width: '60px',
            height: '60px',
            borderRadius: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1.25rem',
            fontSize: '1.8rem',
        },
        featureTitle: {
            fontSize: '1.5rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
            marginBottom: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
        },
        featureDesc: {
            color: theme.colors.secondaryText,
            fontSize: '1rem',
            lineHeight: '1.7',
            marginBottom: '1.25rem',
        },
        featureBullets: {
            listStyle: 'none',
            padding: 0,
            margin: '0 0 1.5rem 0',
        },
        featureBullet: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            marginBottom: '10px',
            color: theme.colors.secondaryText,
            fontSize: '0.95rem',
            lineHeight: '1.5',
        },
        bulletIcon: {
            color: theme.colors.success,
            marginTop: '3px',
            flexShrink: 0,
        },
        buttonGroup: {
            display: 'flex',
            gap: '12px',
            flexWrap: 'wrap',
            marginTop: 'auto',
        },
        primaryButton: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}dd)`,
            color: '#fff',
            padding: '14px 24px',
            borderRadius: '10px',
            textDecoration: 'none',
            fontWeight: '700',
            fontSize: '1rem',
            transition: 'all 0.2s ease',
            boxShadow: `0 4px 15px ${theme.colors.accent}30`,
        },
        secondaryButton: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'transparent',
            color: theme.colors.primaryText,
            padding: '14px 24px',
            borderRadius: '10px',
            textDecoration: 'none',
            fontWeight: '600',
            fontSize: '1rem',
            border: `1px solid ${theme.colors.border}`,
            transition: 'all 0.2s ease',
        },
        sneedexSection: {
            background: `linear-gradient(135deg, ${theme.colors.success}15 0%, ${theme.colors.success}05 100%)`,
            borderRadius: '16px',
            padding: '2rem',
            border: `1px solid ${theme.colors.success}30`,
            marginBottom: '2rem',
        },
        sneedexTitle: {
            fontSize: '1.4rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
        },
        sneedexDesc: {
            color: theme.colors.secondaryText,
            fontSize: '1.05rem',
            lineHeight: '1.7',
            marginBottom: '1.5rem',
        },
        comparisonSection: {
            background: theme.colors.secondaryBg,
            borderRadius: '16px',
            padding: '2rem',
            border: `1px solid ${theme.colors.border}`,
            marginBottom: '2rem',
        },
        comparisonTitle: {
            fontSize: '1.3rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
            marginBottom: '1.5rem',
            textAlign: 'center',
        },
        comparisonGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1.5rem',
        },
        comparisonCard: {
            padding: '1.5rem',
            borderRadius: '12px',
            textAlign: 'center',
        },
        comparisonBad: {
            background: `${theme.colors.error}10`,
            border: `1px solid ${theme.colors.error}30`,
        },
        comparisonGood: {
            background: `${theme.colors.success}10`,
            border: `1px solid ${theme.colors.success}30`,
        },
        tag: {
            display: 'inline-block',
            padding: '4px 12px',
            borderRadius: '20px',
            fontSize: '0.75rem',
            fontWeight: '700',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
        },
        tagPrimary: {
            background: `${theme.colors.accent}20`,
            color: theme.colors.accent,
        },
        tagSuccess: {
            background: `${theme.colors.success}20`,
            color: theme.colors.success,
        },
    };

    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={styles.container}>
                {/* Hero Section */}
                <div style={styles.heroSection}>
                    <div style={styles.heroBadge}>
                        <FaRocket size={14} />
                        Sneed DAO's Core Innovation
                    </div>
                    <h1 style={styles.heroTitle}>
                        <span style={{ fontSize: '2.5rem' }}>💧</span>
                        Liquid Staking
                    </h1>
                    <p style={styles.heroSubtitle}>
                        Transform your staking positions into <span style={styles.heroHighlight}>tradable assets</span>. 
                        When you create neurons through Sneed, they remain 
                        <span style={styles.heroHighlight}> transferable and liquid</span> — 
                        sell your position anytime on Sneedex without waiting for dissolve delays.
                    </p>
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '10px',
                        background: `linear-gradient(135deg, ${theme.colors.success}15, ${theme.colors.accent}10)`,
                        border: `1px solid ${theme.colors.success}40`,
                        borderRadius: '12px',
                        padding: '12px 20px',
                        fontSize: '0.95rem',
                        color: theme.colors.success,
                        marginBottom: '1.5rem',
                    }}>
                        <FaUnlock size={16} />
                        <span><strong>Already have SNS neurons?</strong> Use the <Link to="/tools/sns_jailbreak" style={{ color: theme.colors.success, fontWeight: '700' }}>Jailbreak Wizard</Link> to make them tradable!</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap' }}>
                        <Link to="/create_icp_neuron" style={styles.primaryButton}>
                            Start ICP Liquid Staking
                            <FaArrowRight size={14} />
                        </Link>
                        <Link to="/sns_neuron_wizard" style={styles.secondaryButton}>
                            Stake SNS Tokens
                            <FaArrowRight size={14} />
                        </Link>
                        <Link to="/tools/sns_jailbreak" style={{ ...styles.secondaryButton, borderColor: theme.colors.success, color: theme.colors.success }}>
                            <FaUnlock size={14} />
                            Jailbreak Wizard
                        </Link>
                    </div>
                </div>

                {/* Feature Cards */}
                <div style={styles.featureGrid}>
                    {/* ICP Liquid Staking - Primary */}
                    <div style={{ ...styles.featureCard, ...styles.featureCardPrimary }}>
                        <div style={{ ...styles.tag, ...styles.tagPrimary, marginBottom: '1rem' }}>
                            Featured
                        </div>
                        <div style={{ ...styles.featureIcon, background: `linear-gradient(135deg, ${theme.colors.accent}30, ${theme.colors.accent}10)` }}>
                            🧠
                        </div>
                        <h2 style={styles.featureTitle}>
                            ICP Liquid Staking
                        </h2>
                        <p style={styles.featureDesc}>
                            ICP neurons on the NNS cannot be directly transferred — they're permanently tied to their controller. 
                            <strong> Our solution:</strong> Create a dedicated canister that owns your neurons. 
                            You control the canister, and the canister can be <strong>traded on Sneedex</strong>.
                        </p>
                        <div style={{
                            background: `${theme.colors.info || theme.colors.accent}10`,
                            borderRadius: '8px',
                            padding: '10px 12px',
                            marginBottom: '1rem',
                            fontSize: '0.85rem',
                            color: theme.colors.secondaryText,
                            lineHeight: '1.5',
                        }}>
                            💡 <strong>Important:</strong> You must create new neurons through your Neuron Manager canister. 
                            Existing neurons in your NNS wallet cannot be transferred into a manager.
                        </div>
                        <ul style={styles.featureBullets}>
                            <li style={styles.featureBullet}>
                                <FaCheckCircle style={styles.bulletIcon} size={14} />
                                <span>Deploy your own <strong>Neuron Manager canister</strong> in seconds</span>
                            </li>
                            <li style={styles.featureBullet}>
                                <FaCheckCircle style={styles.bulletIcon} size={14} />
                                <span>Stake ICP and manage multiple neurons from one place</span>
                            </li>
                            <li style={styles.featureBullet}>
                                <FaCheckCircle style={styles.bulletIcon} size={14} />
                                <span>Trade your entire staking position by transferring the canister</span>
                            </li>
                            <li style={styles.featureBullet}>
                                <FaCheckCircle style={styles.bulletIcon} size={14} />
                                <span>Full NNS governance: vote, set dissolve delay, spawn maturity</span>
                            </li>
                            <li style={styles.featureBullet}>
                                <FaCheckCircle style={styles.bulletIcon} size={14} />
                                <span>Your neurons are always safe — stored on NNS, not in the canister</span>
                            </li>
                        </ul>
                        <div style={styles.buttonGroup}>
                            <Link to="/create_icp_neuron" style={styles.primaryButton}>
                                Create ICP Neuron Manager
                                <FaArrowRight size={14} />
                            </Link>
                            <Link to="/help/icp-neuron-manager" style={styles.secondaryButton}>
                                Learn More
                            </Link>
                        </div>
                    </div>

                    {/* SNS Liquid Staking */}
                    <div style={styles.featureCard}>
                        <div style={{ ...styles.tag, ...styles.tagSuccess, marginBottom: '1rem' }}>
                            Native Support
                        </div>
                        <div style={{ ...styles.featureIcon, background: `linear-gradient(135deg, ${theme.colors.success}30, ${theme.colors.success}10)` }}>
                            🧬
                        </div>
                        <h2 style={styles.featureTitle}>
                            SNS Liquid Staking
                        </h2>
                        <p style={styles.featureDesc}>
                            Great news: SNS neurons are <strong>natively transferable</strong>! 
                            When you create SNS neurons through Sneed (instead of the NNS dapp), 
                            they remain liquid and can be <strong>sent to other wallets</strong> or <strong>traded on Sneedex</strong>.
                        </p>
                        <div style={{
                            background: `${theme.colors.info || theme.colors.accent}10`,
                            borderRadius: '8px',
                            padding: '10px 12px',
                            marginBottom: '0.75rem',
                            fontSize: '0.85rem',
                            color: theme.colors.secondaryText,
                            lineHeight: '1.5',
                        }}>
                            💡 <strong>New neurons:</strong> Create through Sneed's wizard for instant liquidity.
                        </div>
                        <div style={{
                            background: `${theme.colors.success}10`,
                            borderRadius: '8px',
                            padding: '10px 12px',
                            marginBottom: '1rem',
                            fontSize: '0.85rem',
                            color: theme.colors.success,
                            lineHeight: '1.5',
                        }}>
                            ✨ <strong>Existing neurons:</strong> Use the <Link to="/tools/sns_jailbreak" style={{ color: theme.colors.success, fontWeight: '600' }}>Jailbreak Wizard</Link> to 
                            add your Sneed Wallet as a controller and make them tradable!
                        </div>
                        <ul style={styles.featureBullets}>
                            <li style={styles.featureBullet}>
                                <FaCheckCircle style={styles.bulletIcon} size={14} />
                                <span>Stake tokens in <strong>any SNS DAO</strong> (Dragginz, OpenChat, etc.)</span>
                            </li>
                            <li style={styles.featureBullet}>
                                <FaCheckCircle style={styles.bulletIcon} size={14} />
                                <span>Neurons remain fully transferable to any wallet</span>
                            </li>
                            <li style={styles.featureBullet}>
                                <FaCheckCircle style={styles.bulletIcon} size={14} />
                                <span>List and sell your neurons on Sneedex marketplace</span>
                            </li>
                            <li style={styles.featureBullet}>
                                <FaCheckCircle style={styles.bulletIcon} size={14} />
                                <span>Participate in governance and earn rewards</span>
                            </li>
                            <li style={styles.featureBullet}>
                                <FaCheckCircle style={styles.bulletIcon} size={14} />
                                <span>Auto-finds free nonce — no technical knowledge required</span>
                            </li>
                        </ul>
                        <div style={styles.buttonGroup}>
                            <Link to="/sns_neuron_wizard" style={{ ...styles.primaryButton, background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`, boxShadow: `0 4px 15px ${theme.colors.success}30` }}>
                                Open SNS Staking Wizard
                                <FaArrowRight size={14} />
                            </Link>
                            <Link to="/tools/sns_jailbreak" style={{ ...styles.secondaryButton, borderColor: theme.colors.success, color: theme.colors.success }}>
                                <FaUnlock size={14} />
                                Jailbreak Wizard
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Sneedex Integration */}
                <div style={styles.sneedexSection}>
                    <h3 style={styles.sneedexTitle}>
                        <FaExchangeAlt style={{ color: theme.colors.success }} />
                        Trade on Sneedex Marketplace
                    </h3>
                    <p style={styles.sneedexDesc}>
                        <strong>Sneedex</strong> is Sneed DAO's on-chain escrow marketplace where you can buy and sell 
                        staking positions securely. List your ICP Neuron Manager canisters or SNS neurons, 
                        set your price, and trade with confidence — all transactions are secured by smart contract escrow.
                    </p>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        <Link to="/sneedex_offers" style={styles.primaryButton}>
                            Browse Marketplace
                            <FaArrowRight size={14} />
                        </Link>
                        <Link to="/sneedex_create" style={styles.secondaryButton}>
                            Create an Offer
                        </Link>
                        <Link to="/help/sneedex" style={styles.secondaryButton}>
                            How Sneedex Works
                        </Link>
                    </div>
                </div>

                {/* Why Liquid Staking Matters */}
                <div style={styles.comparisonSection}>
                    <h3 style={styles.comparisonTitle}>
                        Why Liquid Staking Changes Everything
                    </h3>
                    <div style={styles.comparisonGrid}>
                        <div style={{ ...styles.comparisonCard, ...styles.comparisonBad }}>
                            <FaLock size={32} style={{ color: theme.colors.error, marginBottom: '1rem' }} />
                            <h4 style={{ color: theme.colors.primaryText, marginBottom: '0.75rem', fontWeight: '700' }}>
                                Traditional Staking
                            </h4>
                            <ul style={{ textAlign: 'left', color: theme.colors.secondaryText, lineHeight: '1.8', paddingLeft: '1.25rem', margin: 0 }}>
                                <li>Tokens locked for months or years</li>
                                <li>No way to exit early</li>
                                <li>Can't transfer your position</li>
                                <li>Miss opportunities while locked</li>
                                <li>ICP neurons permanently tied to one wallet</li>
                            </ul>
                        </div>
                        <div style={{ ...styles.comparisonCard, ...styles.comparisonGood }}>
                            <FaUnlock size={32} style={{ color: theme.colors.success, marginBottom: '1rem' }} />
                            <h4 style={{ color: theme.colors.primaryText, marginBottom: '0.75rem', fontWeight: '700' }}>
                                Liquid Staking on Sneed
                            </h4>
                            <ul style={{ textAlign: 'left', color: theme.colors.secondaryText, lineHeight: '1.8', paddingLeft: '1.25rem', margin: 0 }}>
                                <li>Earn staking rewards as normal</li>
                                <li>Sell your position anytime on Sneedex</li>
                                <li>Transfer neurons to other wallets</li>
                                <li>Stay liquid — never miss an opportunity</li>
                                <li>Full governance participation maintained</li>
                            </ul>
                        </div>
                    </div>
                </div>

                {/* Security Note */}
                <div style={{
                    background: theme.colors.secondaryBg,
                    borderRadius: '12px',
                    padding: '1.5rem',
                    border: `1px solid ${theme.colors.border}`,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '1rem',
                }}>
                    <FaShieldAlt size={24} style={{ color: theme.colors.accent, flexShrink: 0, marginTop: '2px' }} />
                    <div>
                        <h4 style={{ color: theme.colors.primaryText, marginBottom: '0.5rem', fontWeight: '700' }}>
                            Your Assets Are Always Safe
                        </h4>
                        <p style={{ color: theme.colors.secondaryText, margin: 0, lineHeight: '1.6' }}>
                            ICP neurons are stored on the NNS governance system, not inside your canister. 
                            Even if a canister runs low on cycles, your neurons remain safe and you stay the controller.
                            SNS neurons use ICRC-7 standard and can always be recovered. 
                            All Sneedex trades use secure on-chain escrow — no trust required.
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
}
