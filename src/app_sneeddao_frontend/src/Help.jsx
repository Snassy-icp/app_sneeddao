import React from 'react';
import { Link } from 'react-router-dom';
import Header from './components/Header';
import { useTheme } from './contexts/ThemeContext';
import { FaMobileAlt, 
    FaQuestionCircle, FaBook, FaWallet, FaBrain, FaLock, FaServer, 
    FaCubes, FaStore, FaUnlock, FaArrowRight, FaLifeRing, FaChartLine,
    FaIdBadge, FaLandmark, FaVoteYea, FaWater, FaComments, FaEnvelope, FaBell,
    FaRocket, FaFlask, FaTools, FaRobot, FaCode
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

const helpGroups = [
    {
        title: 'Getting started',
        topics: [
            { path: '/help/app', icon: FaMobileAlt, title: 'Sneed Hub on Your Phone', description: 'Install Sneed Hub as an app and log in there by pairing it with your browser', color: '#3498db' },
            { path: '/help/wallet', icon: FaWallet, title: 'Understanding Your Wallet', description: 'Tokens, liquidity positions, locks, neurons, apps and NFTs', color: '#10b981' },
            { path: '/help/names', icon: FaIdBadge, title: 'Names, Profiles and Settings', description: 'Log in, your principal, public names and private nicknames, verified names, NFT avatars, profiles and your settings', color: '#f97316' },
        ],
    },
    {
        title: 'Sneed DAO and governance',
        topics: [
            { path: '/help/dao', icon: FaLandmark, title: 'Sneed DAO', description: 'The DAO, its revenue loop, voting rewards, Premium, donations, feedback, Mr Sneed and the lore', color: '#06b6d4' },
            { path: '/help/proposals', icon: FaVoteYea, title: 'Proposals and Voting', description: 'Browse SNS and NNS proposals, read the vote bars and details, and vote with your hotkeyed neurons', color: '#7c3aed' },
            { path: '/help/neurons', icon: FaBrain, title: 'Understanding SNS Neurons', description: 'Stake, vote, follow, dissolve, split, send and name your SNS neurons', color: '#8b5cf6' },
            { path: '/help/liquid-staking', icon: FaWater, title: 'Liquid Staking', description: 'Create SNS neurons and ICP staking bots you can send or sell, plus the SNS directory', color: '#0ea5e9' },
        ],
    },
    {
        title: 'Community',
        topics: [
            { path: '/help/forum', icon: FaComments, title: 'Forum, Feed and Tips', description: 'Discuss with every SNS community: threads, post voting with neurons, polls, tips and @-mentions', color: '#6366f1' },
            { path: '/help/sms', icon: FaEnvelope, title: 'Sneed SMS Messages', description: 'Direct messages between principals: compose, reply, threads, limits and who can read them', color: '#ec4899' },
            { path: '/help/notifications', icon: FaBell, title: 'Notifications', description: 'Choose which apps may notify you and where: Sneed SMS, phone push or Discord; levels, quiet hours, balance and history', color: '#f59e0b' },
        ],
    },
    {
        title: 'Locking and trading',
        topics: [
            { path: '/help/sneedlock', icon: FaLock, title: 'Understanding Sneedlock', description: 'Lock tokens and LP positions: lock dates, dissolve delays, locks as NFTs, gas and fees', color: '#f59e0b' },
            { path: '/help/sneedex', icon: FaStore, title: 'Sneedex Marketplace', description: 'Buy and sell apps, bots, SNS neurons, NFTs, Sneed Locks and tokens through escrow', color: '#14b8a6' },
            { path: '/help/sns_jailbreak', icon: FaUnlock, title: 'SNS Jailbreak', description: 'Give your Sneed Wallet full control of SNS neurons staked in the NNS app', color: '#ef4444' },
        ],
    },
    {
        title: 'Apps and bots',
        topics: [
            { path: '/help/sneedapp', icon: FaRocket, title: 'Sneedapp App Store', description: 'Browse apps and mint your own app canister that you alone control, then keep your bots upgraded', color: '#d946ef' },
            { path: '/help/dapp-manager', icon: FaCubes, title: 'App Manager', description: 'Track your apps, check cycle health, manage controllers and top up cycles with ICP, ck-USDC or a card', color: '#ec4899' },
            { path: '/help/icp-neuron-manager', icon: FaServer, title: 'ICP Staking Bot App Canisters', description: 'Create a bot canister that controls your NNS neurons, with chores, events and botkeys', color: '#3b82f6' },
            { path: '/help/trading_bot', icon: FaChartLine, title: 'Sneed Trading Bot', description: 'Automated swaps, rebalancing, purses, circuit breakers and SneedScript', color: '#10b981' },
        ],
    },
    {
        title: 'Tools',
        topics: [
            { path: '/help/token-studio', icon: FaFlask, title: 'Token Studio and Token Safety', description: 'Check any token from public chain data, read its safety rating and fix what the report flags', color: '#10b981' },
            { path: '/help/tools', icon: FaTools, title: 'Tools and Explorers', description: 'Swap, account tool, ICRC-3 browser, follow the money, wallet scan, transactions and the NFT browser', color: '#64748b' },
        ],
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
    groupTitle: {
        fontSize: '0.85rem',
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: theme.colors.mutedText || theme.colors.secondaryText,
        margin: '0 0 0.75rem 0.25rem',
    },
    topicsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
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
                        managing your wallet, taking part in governance, talking with the community, locking assets,
                        running apps and bots, and more.
                    </p>
                </div>

                {/* Help Topics, grouped */}
                {helpGroups.map((group) => (
                    <section key={group.title} style={{ marginBottom: '1.75rem' }}>
                        <h2 style={styles.groupTitle}>{group.title}</h2>
                        <div style={styles.topicsGrid}>
                            {group.topics.map((topic) => {
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
                    </section>
                ))}

                {/* For AI agents and developers */}
                <section style={{ marginBottom: '1.75rem' }}>
                    <h2 style={styles.groupTitle}>For AI agents and developers</h2>
                    <div style={{ ...styles.introSection, textAlign: 'left', marginBottom: 0 }} className="help-fade-in">
                        <div style={styles.topicHeader}>
                            <div style={styles.topicIcon('#64748b')}>
                                <FaRobot size={24} color="#fff" />
                            </div>
                            <h3 style={styles.topicTitle}>Ask your AI agent</h3>
                        </div>
                        <p style={{ ...styles.topicDescription, fontSize: '0.95rem' }}>
                            Point your AI agent at <a href="/llms.txt" style={{ color: theme.colors.accent, fontWeight: 600 }}>app.sneeddao.com/llms.txt</a>:
                            it lists what Sneed Hub and the Sneed DAO canisters do and how to call them.
                            Developers can browse the canister interfaces in the <Link to="/api" style={{ color: theme.colors.accent, fontWeight: 600 }}>API docs</Link>.
                        </p>
                        <div style={styles.topicArrow('#64748b')}>
                            <FaCode size={12} />
                            <Link to="/api" style={{ color: 'inherit', textDecoration: 'none' }}>Open the API docs</Link>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
}

export default Help;
