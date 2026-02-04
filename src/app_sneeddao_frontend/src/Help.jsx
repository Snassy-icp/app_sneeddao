import React from 'react';
import { Link } from 'react-router-dom';
import Header from './components/Header';
import { useTheme } from './contexts/ThemeContext';
import { 
    FaQuestionCircle, FaBook, FaWallet, FaBrain, FaLock, FaServer, 
    FaCubes, FaStore, FaUnlock, FaArrowRight, FaLifeRing 
} from 'react-icons/fa';

// Custom CSS for animations
const customAnimations = `
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

@keyframes helpFloat {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    50% { transform: translateY(-10px) rotate(3deg); }
}

.help-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.help-float {
    animation: helpFloat 4s ease-in-out infinite;
}

.help-topic-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
}

.help-topic-card:hover .help-topic-icon {
    transform: scale(1.1);
}
`;

// Page accent colors - blue/cyan theme for help/knowledge
const helpPrimary = '#06b6d4';
const helpSecondary = '#22d3ee';

const helpTopics = [
    {
        path: '/help/wallet',
        icon: FaWallet,
        title: 'Understanding Your Wallet',
        description: 'Learn how to manage tokens, positions, and neurons in your wallet',
        color: '#10b981',
    },
    {
        path: '/help/neurons',
        icon: FaBrain,
        title: 'Understanding SNS Neurons',
        description: 'Governance, voting, hotkeys, and cross-platform management',
        color: '#8b5cf6',
    },
    {
        path: '/help/sneedlock',
        icon: FaLock,
        title: 'Understanding Sneedlock',
        description: 'Time-lock tokens and LP positions for commitment and vesting',
        color: '#f59e0b',
    },
    {
        path: '/help/icp-neuron-manager',
        icon: FaServer,
        title: 'ICP Neuron Manager Canisters',
        description: 'Create and manage dedicated canisters for your ICP neurons',
        color: '#3b82f6',
    },
    {
        path: '/help/dapp-manager',
        icon: FaCubes,
        title: 'Dapp Manager',
        description: 'Track, organize, and monitor all your Internet Computer canisters',
        color: '#ec4899',
    },
    {
        path: '/help/sneedex',
        icon: FaStore,
        title: 'Sneedex Marketplace',
        description: 'Trade canisters, neurons, and tokens on the decentralized marketplace',
        color: '#14b8a6',
    },
    {
        path: '/help/sns_jailbreak',
        icon: FaUnlock,
        title: 'SNS Jailbreak',
        description: 'Add full controller access to your SNS neurons for trading',
        color: '#ef4444',
    },
];

const getStyles = (theme) => ({
    container: {
        maxWidth: '1000px',
        margin: '0 auto',
        padding: '1.25rem',
        color: theme.colors.primaryText,
    },
    introSection: {
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '16px',
        padding: '1.5rem',
        marginBottom: '1.5rem',
        boxShadow: theme.colors.cardShadow,
        textAlign: 'center',
    },
    introParagraph: {
        color: theme.colors.secondaryText,
        fontSize: '1rem',
        lineHeight: '1.7',
        margin: 0,
    },
    topicsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '1rem',
    },
    topicCard: (color) => ({
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '16px',
        padding: '1.5rem',
        boxShadow: theme.colors.cardShadow,
        textDecoration: 'none',
        transition: 'all 0.3s ease',
        position: 'relative',
        overflow: 'hidden',
        display: 'block',
    }),
    decorativeGlow: (color) => ({
        position: 'absolute',
        top: '-30%',
        right: '-15%',
        width: '150px',
        height: '150px',
        background: `radial-gradient(circle, ${color}15 0%, transparent 70%)`,
        pointerEvents: 'none',
    }),
    topicHeader: {
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        marginBottom: '12px',
    },
    topicIcon: (color) => ({
        width: '48px',
        height: '48px',
        borderRadius: '14px',
        background: `linear-gradient(135deg, ${color}, ${color}cc)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: `0 6px 20px ${color}40`,
        transition: 'transform 0.3s ease',
    }),
    topicTitle: {
        fontSize: '1.1rem',
        fontWeight: '700',
        color: theme.colors.primaryText,
        margin: 0,
        flex: 1,
    },
    topicDescription: {
        color: theme.colors.secondaryText,
        fontSize: '0.9rem',
        lineHeight: '1.5',
        margin: 0,
        marginBottom: '12px',
    },
    topicArrow: (color) => ({
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        color: color,
        fontSize: '0.85rem',
        fontWeight: '600',
    }),
});

function Help() {
    const { theme } = useTheme();
    const styles = getStyles(theme);

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customAnimations}</style>
            <Header />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${helpPrimary}15 0%, ${helpSecondary}10 50%, transparent 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '3rem 1.25rem 2.5rem',
                position: 'relative',
                overflow: 'hidden',
                width: '100%',
                boxSizing: 'border-box'
            }}>
                {/* Decorative elements */}
                <div style={{
                    position: 'absolute',
                    top: '-50%',
                    right: '-10%',
                    width: '400px',
                    height: '400px',
                    background: `radial-gradient(circle, ${helpPrimary}20 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-30%',
                    left: '-5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${helpSecondary}15 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />
                
                <div style={{ maxWidth: '1000px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '16px', flexWrap: 'wrap' }}>
                        <div className="help-float" style={{
                            width: '72px',
                            height: '72px',
                            borderRadius: '20px',
                            background: `linear-gradient(135deg, ${helpPrimary}, ${helpSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 12px 40px ${helpPrimary}50`,
                        }}>
                            <FaLifeRing size={36} color="#fff" />
                        </div>
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <div style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                background: `${helpPrimary}20`,
                                border: `1px solid ${helpPrimary}40`,
                                borderRadius: '20px',
                                padding: '4px 12px',
                                marginBottom: '8px',
                            }}>
                                <FaBook size={12} color={helpPrimary} />
                                <span style={{ fontSize: '0.75rem', fontWeight: '600', color: helpPrimary }}>
                                    Documentation
                                </span>
                            </div>
                            <h1 style={{
                                fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
                                fontWeight: '800',
                                color: theme.colors.primaryText,
                                margin: 0,
                            }}>
                                Help Center
                            </h1>
                        </div>
                    </div>
                    <p style={{
                        fontSize: '1rem',
                        color: theme.colors.secondaryText,
                        margin: 0,
                        maxWidth: '600px',
                        lineHeight: '1.6',
                    }}>
                        Find guides, tutorials, and answers to help you get the most out of Sneed Hub
                    </p>
                </div>
            </div>

            <main style={styles.container}>
                {/* Introduction */}
                <div style={styles.introSection} className="help-fade-in">
                    <div style={{
                        width: '56px',
                        height: '56px',
                        borderRadius: '16px',
                        background: `linear-gradient(135deg, ${helpPrimary}20, ${helpSecondary}15)`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 16px',
                    }}>
                        <FaQuestionCircle size={28} color={helpPrimary} />
                    </div>
                    <p style={styles.introParagraph}>
                        Welcome to the Sneed Hub Help Center! Browse the topics below to learn about 
                        managing your wallet, participating in governance, locking assets, and more.
                    </p>
                </div>

                {/* Help Topics Grid */}
                <div style={styles.topicsGrid}>
                    {helpTopics.map((topic, index) => {
                        const IconComponent = topic.icon;
                        return (
                            <Link
                                key={topic.path}
                                to={topic.path}
                                style={styles.topicCard(topic.color)}
                                className="help-fade-in help-topic-card"
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = `${topic.color}60`;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = theme.colors.border;
                                }}
                            >
                                <div style={{ ...styles.decorativeGlow(topic.color) }} />
                                <div style={styles.topicHeader}>
                                    <div style={styles.topicIcon(topic.color)} className="help-topic-icon">
                                        <IconComponent size={24} color="#fff" />
                                    </div>
                                    <h3 style={styles.topicTitle}>{topic.title}</h3>
                                </div>
                                <p style={styles.topicDescription}>{topic.description}</p>
                                <div style={styles.topicArrow(topic.color)}>
                                    <span>Learn more</span>
                                    <FaArrowRight size={12} />
                                </div>
                            </Link>
                        );
                    })}
                </div>
            </main>
        </div>
    );
}

export default Help;
