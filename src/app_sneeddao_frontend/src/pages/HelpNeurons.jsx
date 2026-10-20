import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { 
    FaBrain, FaVoteYea, FaArrowLeft, FaKey, FaUserFriends, FaClock, 
    FaExchangeAlt, FaPlusCircle, FaMinusCircle, FaWallet, FaCopy,
    FaShieldAlt, FaLightbulb, FaQuestionCircle, FaCheckCircle
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

@keyframes neuronFloat {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    50% { transform: translateY(-10px) rotate(3deg); }
}

.neuron-help-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.neuron-help-float {
    animation: neuronFloat 4s ease-in-out infinite;
}
`;

// Page accent colors - purple theme for governance/neurons
const neuronPrimary = '#8b5cf6';
const neuronSecondary = '#a78bfa';

const getStyles = (theme) => ({
    container: {
        maxWidth: '900px',
        margin: '0 auto',
        padding: '1.25rem',
        color: theme.colors.primaryText,
    },
    backLink: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        color: theme.colors.accent,
        textDecoration: 'none',
        fontSize: '0.9rem',
        fontWeight: '500',
        marginBottom: '1.5rem',
        transition: 'opacity 0.2s ease',
    },
    section: {
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '16px',
        padding: '1.25rem',
        marginBottom: '1rem',
        boxShadow: theme.colors.cardShadow,
    },
    sectionHeader: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '1rem',
    },
    sectionIcon: (color = neuronPrimary) => ({
        width: '40px',
        height: '40px',
        borderRadius: '12px',
        background: `linear-gradient(135deg, ${color}20, ${color}10)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    }),
    subheading: {
        fontSize: '1.1rem',
        fontWeight: '700',
        color: theme.colors.primaryText,
        margin: 0,
    },
    subsubheading: {
        fontSize: '1rem',
        fontWeight: '600',
        color: theme.colors.primaryText,
        marginTop: '1rem',
        marginBottom: '0.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    paragraph: {
        marginBottom: '0.75rem',
        lineHeight: '1.7',
        color: theme.colors.secondaryText,
        fontSize: '0.9rem',
    },
    list: {
        marginLeft: '1.25rem',
        marginBottom: '0.75rem',
        paddingLeft: '0.5rem',
    },
    listItem: {
        marginBottom: '0.5rem',
        color: theme.colors.secondaryText,
        fontSize: '0.9rem',
        lineHeight: '1.6',
    },
    infoBox: {
        background: `linear-gradient(135deg, ${theme.colors.accent}15, ${theme.colors.accent}08)`,
        border: `1px solid ${theme.colors.accent}40`,
        borderRadius: '12px',
        padding: '1rem',
        marginBottom: '1rem',
    },
    tipBox: {
        background: `linear-gradient(135deg, ${neuronPrimary}15, ${neuronPrimary}08)`,
        border: `1px solid ${neuronPrimary}40`,
        borderRadius: '12px',
        padding: '1rem',
        marginBottom: '1rem',
    },
    successBox: {
        background: `linear-gradient(135deg, #10b98115, #10b98108)`,
        border: `1px solid #10b98140`,
        borderRadius: '12px',
        padding: '1rem',
        marginBottom: '1rem',
    },
    warningBox: {
        background: `linear-gradient(135deg, #f59e0b15, #f59e0b08)`,
        border: `1px solid #f59e0b40`,
        borderRadius: '12px',
        padding: '1rem',
        marginBottom: '1rem',
    },
    scenarioBox: {
        background: theme.colors.secondaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '12px',
        padding: '1rem',
        marginBottom: '1rem',
    },
    link: {
        color: theme.colors.accent,
        textDecoration: 'none',
        fontWeight: '500',
    },
    strong: {
        color: theme.colors.primaryText,
        fontWeight: '600',
    },
    code: {
        background: theme.colors.secondaryBg,
        padding: '2px 6px',
        borderRadius: '4px',
        fontFamily: 'monospace',
        fontSize: '0.85em',
        color: theme.colors.accent,
    },
    principalBox: {
        background: theme.colors.secondaryBg,
        padding: '12px',
        borderRadius: '10px',
        marginBottom: '12px',
        fontFamily: 'monospace',
        fontSize: '0.85rem',
        wordBreak: 'break-all',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        flexWrap: 'wrap',
    },
    copyButton: {
        background: neuronPrimary,
        color: '#fff',
        border: 'none',
        borderRadius: '8px',
        padding: '8px 16px',
        cursor: 'pointer',
        fontSize: '0.85rem',
        fontWeight: '500',
        transition: 'all 0.2s ease',
        whiteSpace: 'nowrap',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
    },
    stepList: {
        marginLeft: '1.25rem',
        marginTop: '0.5rem',
    },
    stepItem: {
        marginBottom: '0.5rem',
        color: theme.colors.secondaryText,
        fontSize: '0.9rem',
        lineHeight: '1.6',
    },
});

function HelpNeurons() {
    const { theme } = useTheme();
    const { isAuthenticated, identity } = useAuth();
    const styles = getStyles(theme);

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customAnimations}</style>
            <Header />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${neuronPrimary}15 0%, ${neuronSecondary}10 50%, transparent 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '3rem 1.25rem 2.5rem',
                position: 'relative',
                overflow: 'hidden',
                width: '100%',
                boxSizing: 'border-box'
            }}>
                <div style={{
                    position: 'absolute',
                    top: '-50%',
                    right: '-10%',
                    width: '400px',
                    height: '400px',
                    background: `radial-gradient(circle, ${neuronPrimary}20 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-30%',
                    left: '-5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${neuronSecondary}15 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />
                
                <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '16px', flexWrap: 'wrap' }}>
                        <div className="neuron-help-float" style={{
                            width: '72px',
                            height: '72px',
                            borderRadius: '20px',
                            background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 12px 40px ${neuronPrimary}50`,
                        }}>
                            <FaBrain size={36} color="#fff" />
                        </div>
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <div style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                background: `${neuronPrimary}20`,
                                border: `1px solid ${neuronPrimary}40`,
                                borderRadius: '20px',
                                padding: '4px 12px',
                                marginBottom: '8px',
                            }}>
                                <FaVoteYea size={12} color={neuronPrimary} />
                                <span style={{ fontSize: '0.75rem', fontWeight: '600', color: neuronPrimary }}>
                                    Governance
                                </span>
                            </div>
                            <h1 style={{
                                fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
                                fontWeight: '800',
                                color: theme.colors.primaryText,
                                margin: 0,
                            }}>
                                Understanding SNS Neurons
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
                        Master SNS governance: voting, hotkeys, following, and cross-platform management
                    </p>
                </div>
            </div>

            <main style={styles.container}>
                <Link to="/help" style={styles.backLink}>
                    <FaArrowLeft size={14} />
                    Back to Help Center
                </Link>

                {/* Principal Section */}
                {isAuthenticated && identity && (
                    <div style={styles.tipBox} className="neuron-help-fade-in">
                        <div style={styles.sectionHeader}>
                            <div style={styles.sectionIcon(neuronPrimary)}>
                                <FaKey size={20} color={neuronPrimary} />
                            </div>
                            <h3 style={styles.subheading}>Your Sneed Hub Principal</h3>
                        </div>
                        <div style={styles.principalBox}>
                            <span style={{ flex: 1, minWidth: '200px', color: theme.colors.primaryText }}>
                                {identity.getPrincipal().toText()}
                            </span>
                            <button
                                onClick={async () => {
                                    try {
                                        await navigator.clipboard.writeText(identity.getPrincipal().toText());
                                    } catch (err) {
                                        console.error('Failed to copy:', err);
                                    }
                                }}
                                style={styles.copyButton}
                            >
                                <FaCopy size={14} />
                                Copy
                            </button>
                        </div>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            Use this when adding hotkeys to your neurons on the NNS dApp. Paste it into the "Add Hotkey" field 
                            to enable cross-platform neuron management.
                        </p>
                    </div>
                )}

                {/* What are SNS Neurons */}
                <div style={styles.section} className="neuron-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaBrain size={20} color={neuronPrimary} />
                        </div>
                        <h2 style={styles.subheading}>What are SNS Neurons?</h2>
                    </div>
                    <p style={styles.paragraph}>
                        SNS neurons are the core governance mechanism for Service Nervous System DAOs on the Internet Computer. 
                        When you stake tokens in an SNS, you create a neuron that represents your governance power in that DAO.
                    </p>
                    <div style={styles.infoBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>Key Characteristics</h4>
                        <ul style={styles.list}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Staked Tokens:</strong> Neurons hold tokens locked for a minimum dissolve delay period
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Voting Power:</strong> Determined by staked amount, dissolve delay, and age bonus
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Governance Rights:</strong> Vote on proposals that shape the DAO's direction
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Rewards:</strong> Active governance participation earns additional tokens
                            </li>
                        </ul>
                    </div>
                </div>

                {/* What Can You Do */}
                <div style={styles.section} className="neuron-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#3b82f6')}>
                            <FaVoteYea size={20} color="#3b82f6" />
                        </div>
                        <h2 style={styles.subheading}>What Can You Do With Neurons?</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>
                        <FaVoteYea size={14} color={neuronPrimary} />
                        Vote on Proposals
                    </h4>
                    <p style={styles.paragraph}>
                        Vote on the DAO's proposals from the <Link to="/proposals" style={styles.link}>Proposals</Link> page or a 
                        single proposal's page, with every neuron you can vote with. The proposal list shows a small yes/no bar for 
                        each proposal. Votes are public. See the <Link to="/help/proposals" style={styles.link}>proposals and voting 
                        help</Link> for details.
                    </p>
                    
                    <h4 style={styles.subsubheading}>
                        <FaUserFriends size={14} color="#10b981" />
                        Follow Other Neurons
                    </h4>
                    <p style={styles.paragraph}>
                        On the neuron page, <strong style={styles.strong}>Followees</strong> lets you add one or more neurons to follow 
                        on chosen topics (Governance, Community, SNS Framework, Dapp, App Logic, Treasury, Critical). Your neuron then 
                        votes the way its followees vote, so it keeps voting while you're away.
                    </p>
                    
                    <h4 style={styles.subsubheading}>
                        <FaClock size={14} color="#f59e0b" />
                        Set or Increase Dissolve Delay
                    </h4>
                    <p style={styles.paragraph}>
                        A longer dissolve delay gives more voting power. The delay can only go up, never down, and each SNS has a 
                        minimum delay for voting and a maximum.
                    </p>
                    
                    <h4 style={styles.subsubheading}>
                        <FaExchangeAlt size={14} color="#ec4899" />
                        Start/Stop Dissolving
                    </h4>
                    <p style={styles.paragraph}>
                        Start dissolving to begin the countdown to unlocking the stake; stop dissolving to lock it again at the 
                        remaining delay.
                    </p>
                    
                    <h4 style={styles.subsubheading}>
                        <FaMinusCircle size={14} color="#ef4444" />
                        Disburse and Maturity
                    </h4>
                    <p style={styles.paragraph}>
                        When a neuron is fully dissolved, <strong style={styles.strong}>Disburse to Wallet</strong> sends its stake to 
                        your wallet. Voting rewards build up as maturity: <strong style={styles.strong}>Disburse Maturity</strong> turns 
                        it into tokens (the neuron shows the pending amount and when it arrives), or tick{' '}
                        <strong style={styles.strong}>Automatically stake new maturity</strong> to add new rewards to the neuron instead.
                    </p>
                    
                    <h4 style={styles.subsubheading}>
                        <FaKey size={14} color="#14b8a6" />
                        Manage Principals and Hotkeys
                    </h4>
                    <p style={styles.paragraph}>
                        Add other principals (hotkeys or more) with the permissions you choose, for example to vote from another 
                        app without giving it the right to disburse.
                    </p>
                    
                    <h4 style={styles.subsubheading}>
                        <FaPlusCircle size={14} color="#6366f1" />
                        Split, Increase Stake and Send
                    </h4>
                    <p style={styles.paragraph}>
                        <strong style={styles.strong}>Split Neuron</strong> moves part of the stake into a new neuron (the amount must 
                        include the transaction fee, and both neurons must keep the SNS's minimum stake). <strong style={styles.strong}>Increase 
                        Stake</strong> adds tokens from your wallet. <strong style={styles.strong}>Send</strong> hands the whole neuron to 
                        another principal: the recipient gets full permissions, then every other principal (including you) is 
                        removed. That cannot be undone, so check the recipient carefully.
                    </p>

                    <h4 style={styles.subsubheading}>
                        <FaCheckCircle size={14} color="#8b5cf6" />
                        Names and Nicknames
                    </h4>
                    <p style={styles.paragraph}>
                        A <strong style={styles.strong}>Name</strong> is public: everyone sees it next to the neuron (a check mark means 
                        the name is verified). A <strong style={styles.strong}>Nickname</strong> (set on the neuron page or the Me page) 
                        is shown only to you. Inappropriate public names can get you banned.
                    </p>
                </div>

                {/* Understanding Hotkeys */}
                <div style={styles.section} className="neuron-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#14b8a6')}>
                            <FaKey size={20} color="#14b8a6" />
                        </div>
                        <h2 style={styles.subheading}>Understanding Hotkeys</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Every SNS neuron has a list of principals, each with its own set of permissions. A "hotkey" in the NNS app 
                        sense is a principal with only the Vote and Submit Proposal permissions: it can vote and make proposals but 
                        cannot disburse the neuron or change its principals. On the neuron page Sneed Hub labels each principal by 
                        what it can do: <strong style={styles.strong}>Full Owner</strong>, <strong style={styles.strong}>Manager</strong> (can 
                        manage principals), <strong style={styles.strong}>Hotkey</strong>, <strong style={styles.strong}>Voter</strong>,{' '}
                        <strong style={styles.strong}>Financial</strong> (can disburse) or <strong style={styles.strong}>Custom</strong>.
                    </p>
                    <p style={styles.paragraph}>
                        With the Manage Principals permission you can <strong style={styles.strong}>Add Principal</strong> with exactly 
                        the permissions you choose (as far as the SNS allows), edit or remove principals. Sneed Hub will not let you 
                        remove the last principal that can manage the neuron.
                    </p>
                    
                    <div style={styles.infoBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>Why Use Hotkeys?</h4>
                        <ul style={styles.list}>
                            <li style={styles.listItem}><strong style={styles.strong}>Security:</strong> Keep your main principal secure while allowing operational access</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Convenience:</strong> Vote from multiple platforms without exposing your main identity</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Delegation:</strong> Allow trusted parties to manage voting without disbursement rights</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Cross-Platform:</strong> Use neurons between NNS dApp and Sneed Hub seamlessly</li>
                        </ul>
                    </div>
                    
                    <h4 style={styles.subsubheading}>How to Add Hotkeys on NNS</h4>
                    <ol style={styles.stepList}>
                        <li style={styles.stepItem}>Navigate to <a href="https://nns.ic0.app" target="_blank" rel="noopener noreferrer" style={styles.link}>nns.ic0.app</a></li>
                        <li style={styles.stepItem}>Go to the SNS section and select your SNS</li>
                        <li style={styles.stepItem}>Click on the neuron you want to add a hotkey to</li>
                        <li style={styles.stepItem}>Find "Hotkeys" section and click "Add Hotkey"</li>
                        <li style={styles.stepItem}>Enter your Sneed Hub principal ID</li>
                        <li style={styles.stepItem}>Confirm the transaction</li>
                    </ol>
                </div>

                {/* Managing Neurons */}
                <div style={styles.section} className="neuron-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#ec4899')}>
                            <FaWallet size={20} color="#ec4899" />
                        </div>
                        <h2 style={styles.subheading}>Managing Neurons in Sneed Hub</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Wallet Page</h4>
                    <p style={styles.paragraph}>
                        The <Link to="/wallet" style={styles.link}>Wallet page</Link> shows your neurons under each SNS token's card. 
                        From there you can <strong style={styles.strong}>Create New Neuron</strong> (stake amount and dissolve delay; the 
                        button is disabled for SNSes that don't allow managing neuron permissions, since such a neuron would be stuck in 
                        this wallet), <strong style={styles.strong}>Increase Stake</strong>, <strong style={styles.strong}>Set</strong> or{' '}
                        <strong style={styles.strong}>Increase Dissolve Delay</strong>, <strong style={styles.strong}>Start</strong> /{' '}
                        <strong style={styles.strong}>Stop Dissolving</strong>, <strong style={styles.strong}>Disburse to Wallet</strong>,{' '}
                        <strong style={styles.strong}>Disburse Maturity</strong>, tick <strong style={styles.strong}>Automatically stake new 
                        maturity</strong>, <strong style={styles.strong}>Split Neuron</strong> and <strong style={styles.strong}>Send</strong> the 
                        neuron. <strong style={styles.strong}>Manage</strong> opens the neuron's own page.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Me Page</h4>
                    <p style={styles.paragraph}>
                        The <Link to="/me" style={styles.link}>Me page</Link> lists your neurons for the SNS selected in the header 
                        (optionally including neurons you can only reach as a hotkey). Here you can give a neuron a public{' '}
                        <strong style={styles.strong}>Name</strong> or a <strong style={styles.strong}>Nickname</strong> (see Names and 
                        Nicknames above).
                    </p>
                    
                    <h4 style={styles.subsubheading}>Neurons Page</h4>
                    <p style={styles.paragraph}>
                        The <Link to="/neurons" style={styles.link}>Neurons page</Link> is a public browser for the selected SNS, with 
                        two tabs: <strong style={styles.strong}>Neurons</strong> (filter by dissolve state, owners or hotkeys, named or 
                        verified neurons; sort by stake or voting power; <strong style={styles.strong}>Export CSV</strong>) and{' '}
                        <strong style={styles.strong}>Stakers</strong> (each principal with its neurons, total and owned stake). Use it to 
                        research governance and find neurons to follow.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Neuron Page</h4>
                    <p style={styles.paragraph}>
                        Open any neuron from a list, or search by ID, name or nickname on{' '}
                        <span style={styles.code}>/neuron?sns=ROOT_ID&amp;neuronid=NEURON_ID</span>. It shows stake, maturity, voting 
                        power, age, dissolve state, auto-stake and the neuron's stake account (send tokens there to increase the stake), 
                        with <strong style={styles.strong}>Details</strong> and <strong style={styles.strong}>Transactions</strong> tabs. If you 
                        have the right permissions you can also <strong style={styles.strong}>Increase Delay</strong>,{' '}
                        <strong style={styles.strong}>Start</strong> / <strong style={styles.strong}>Stop Dissolving</strong>, manage{' '}
                        <strong style={styles.strong}>Permissions</strong> and <strong style={styles.strong}>Followees</strong>, and see the 
                        neuron's <strong style={styles.strong}>Voting History</strong> (each vote links to its proposal).
                    </p>
                    
                    <div style={styles.infoBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Unique Features:</strong> Sneed Hub lets you send neurons to other users, split them and 
                            give principals exactly the permissions you choose, which the NNS dApp does not offer.
                        </p>
                    </div>
                </div>

                {/* Cross-Platform Management */}
                <div style={styles.section} className="neuron-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#f59e0b')}>
                            <FaExchangeAlt size={20} color="#f59e0b" />
                        </div>
                        <h2 style={styles.subheading}>Cross-Platform Management</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Manage neurons from multiple platforms using <strong style={styles.strong}>following</strong> (neurons auto-copy votes) 
                        or <strong style={styles.strong}>hotkeys</strong> (direct control from different principals).
                    </p>
                    
                    {/* Following */}
                    <div style={styles.scenarioBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaUserFriends size={14} color="#10b981" />
                            Method 1: Following (Recommended)
                        </h4>
                        <p style={styles.paragraph}>
                            Configure one neuron to automatically follow another. When you vote with the leader, the follower votes the same way.
                        </p>
                        <div style={styles.successBox}>
                            <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                                <strong style={styles.strong}>Bidirectional Following:</strong> Set both neurons to follow each other—vote from 
                                anywhere and both neurons vote together!
                            </p>
                        </div>
                    </div>
                    
                    {/* Hotkeys */}
                    <div style={styles.scenarioBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaKey size={14} color="#14b8a6" />
                            Method 2: Hotkeys (Direct Control)
                        </h4>
                        <p style={styles.paragraph}>
                            Add your Sneed Hub principal as a hotkey to NNS neurons, or add your NNS principal to Sneed Hub neurons.
                        </p>
                        <ol style={styles.stepList}>
                            <li style={styles.stepItem}>For Sneed Hub access to NNS neurons: Add Sneed Hub principal as hotkey on NNS</li>
                            <li style={styles.stepItem}>For NNS access to Sneed Hub neurons: Add NNS principal as hotkey on Sneed Hub</li>
                            <li style={styles.stepItem}>For full flexibility: Do both!</li>
                        </ol>
                    </div>
                    
                    <div style={styles.warningBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaShieldAlt size={14} color="#f59e0b" />
                            Security Considerations
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>NNS hotkeys are limited:</strong> Only voting and proposal creation permissions
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Sneed Hub hotkeys are flexible:</strong> YOU choose what permissions to grant—only grant 
                                disburse permissions to principals you control
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Only trust yourself:</strong> Never add someone else's principal with powerful permissions
                            </li>
                        </ul>
                    </div>
                </div>

                {/* Best Practices */}
                <div style={styles.section} className="neuron-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#10b981')}>
                            <FaLightbulb size={20} color="#10b981" />
                        </div>
                        <h2 style={styles.subheading}>Best Practices</h2>
                    </div>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Set Up Following:</strong> Configure neurons to follow trusted neurons for automated voting rewards
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Use Multiple Neurons:</strong> Split stake into neurons with different dissolve delays for flexibility
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Monitor Regularly:</strong> Check your neurons on the Wallet or Me page to track status
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Participate Actively:</strong> Vote to earn rewards and shape the DAO's future
                        </li>
                    </ul>
                </div>

                {/* Common Questions */}
                <div style={styles.section} className="neuron-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon(theme.colors.accent)}>
                            <FaQuestionCircle size={20} color={theme.colors.accent} />
                        </div>
                        <h2 style={styles.subheading}>Common Questions</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Can I increase my neuron's stake?</h4>
                    <p style={styles.paragraph}>
                        Yes. Use <strong style={styles.strong}>Increase Stake</strong> on the neuron in your <Link to="/wallet" style={styles.link}>Wallet</Link>, or send tokens to the stake account shown on the neuron page (anyone can do this, even without permissions on the neuron).
                    </p>
                    
                    <h4 style={styles.subsubheading}>What happens to my rewards?</h4>
                    <p style={styles.paragraph}>
                        Voting rewards accumulate as maturity. Use <strong style={styles.strong}>Disburse Maturity</strong> to turn it into tokens in your wallet, or turn on <strong style={styles.strong}>Automatically stake new maturity</strong> to add it to the neuron's voting power.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Can I decrease my dissolve delay?</h4>
                    <p style={styles.paragraph}>
                        Not directly. Start dissolving to begin the countdown—the delay decreases automatically over time until zero.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Why don't I see the SNS neurons I staked in the NNS app?</h4>
                    <p style={styles.paragraph}>
                        Neurons staked in the NNS app belong to your NNS identity. Add your Sneed Hub principal as a hotkey on them 
                        (see Understanding Hotkeys above) to see and vote with them here. To get full control in Sneed Hub (for example 
                        to send or sell the neuron), use the <Link to="/tools/sns_jailbreak" style={styles.link}>SNS Jailbreak</Link> wizard.
                    </p>
                    
                    <h4 style={styles.subsubheading}>What if I lose access to my principal?</h4>
                    <p style={styles.paragraph}>
                        You won't be able to manage or disburse your neurons. Securely back up your identity and consider backup hotkeys.
                    </p>
                </div>

                {/* Related Topics */}
                <div style={styles.section} className="neuron-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaArrowLeft size={20} color={neuronPrimary} />
                        </div>
                        <h2 style={styles.subheading}>Related Help Topics</h2>
                    </div>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <Link to="/help/wallet" style={styles.link}>Understanding Your Wallet</Link> — Manage tokens, positions, and neurons
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/icp-neuron-manager" style={styles.link}>ICP Staking Bot App Canisters</Link> — Dedicated app canisters for ICP neurons
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/proposals" style={styles.link}>Proposals and Voting</Link> — Reading proposals and voting with your neurons
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/sns_jailbreak" style={styles.link}>SNS Jailbreak</Link> — Full control of neurons staked in the NNS app
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/liquid-staking" style={styles.link}>Liquid Staking</Link> — Neurons that stay transferable
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/sneedex" style={styles.link}>Sneedex</Link> — Buy and sell SNS neurons
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/forum" style={styles.link}>Forum</Link> — Ask questions and discuss with other users
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help" style={styles.link}>Help Center</Link> — Browse all help topics
                        </li>
                    </ul>
                </div>
            </main>
        </div>
    );
}

export default HelpNeurons;
