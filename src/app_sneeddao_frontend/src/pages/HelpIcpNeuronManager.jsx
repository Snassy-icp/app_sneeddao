import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { 
    FaServer, FaArrowLeft, FaNetworkWired, FaWallet, FaLock, FaVoteYea, 
    FaCoins, FaKey, FaCut, FaShieldAlt, FaCogs, FaRocket, 
    FaLightbulb, FaQuestionCircle, FaCheckCircle, FaExclamationTriangle,
    FaRobot, FaClock, FaPlay, FaPause, FaStop, FaExchangeAlt, FaSyncAlt,
    FaHandshake, FaBrain, FaUserShield
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

@keyframes serverFloat {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    50% { transform: translateY(-10px) rotate(3deg); }
}

.icp-help-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.icp-help-float {
    animation: serverFloat 4s ease-in-out infinite;
}
`;

// Page accent colors - blue theme for ICP/infrastructure
const icpPrimary = '#3b82f6';
const icpSecondary = '#60a5fa';

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
    sectionIcon: (color = icpPrimary) => ({
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
        background: `linear-gradient(135deg, ${icpPrimary}15, ${icpPrimary}08)`,
        border: `1px solid ${icpPrimary}40`,
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
    featureCard: {
        background: theme.colors.secondaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '12px',
        padding: '1rem',
        marginBottom: '0.75rem',
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
    diagramBox: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        padding: '1.5rem',
        marginBottom: '1rem',
    },
    diagramItem: {
        background: theme.colors.secondaryBg,
        border: `2px solid ${icpPrimary}`,
        borderRadius: '12px',
        padding: '12px 24px',
        textAlign: 'center',
        minWidth: '220px',
    },
    diagramArrow: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        color: theme.colors.mutedText,
    },
});

function HelpIcpNeuronManager() {
    const { theme } = useTheme();
    const { isAuthenticated, identity } = useAuth();
    const styles = getStyles(theme);

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customAnimations}</style>
            <Header />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${icpPrimary}15 0%, ${icpSecondary}10 50%, transparent 100%)`,
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
                    background: `radial-gradient(circle, ${icpPrimary}20 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-30%',
                    left: '-5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${icpSecondary}15 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />
                
                <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '16px', flexWrap: 'wrap' }}>
                        <div className="icp-help-float" style={{
                            width: '72px',
                            height: '72px',
                            borderRadius: '20px',
                            background: `linear-gradient(135deg, ${icpPrimary}, ${icpSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 12px 40px ${icpPrimary}50`,
                        }}>
                            <FaServer size={36} color="#fff" />
                        </div>
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <div style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                background: `${icpPrimary}20`,
                                border: `1px solid ${icpPrimary}40`,
                                borderRadius: '20px',
                                padding: '4px 12px',
                                marginBottom: '8px',
                            }}>
                                <FaNetworkWired size={12} color={icpPrimary} />
                                <span style={{ fontSize: '0.75rem', fontWeight: '600', color: icpPrimary }}>
                                    NNS Governance
                                </span>
                            </div>
                            <h1 style={{
                                fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
                                fontWeight: '800',
                                color: theme.colors.primaryText,
                                margin: 0,
                            }}>
                                ICP Staking Bot App Canisters
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
                        Create and manage dedicated app canisters for secure, decentralized ICP neuron control
                    </p>
                </div>
            </div>

            <main style={styles.container}>
                <Link to="/help" style={styles.backLink}>
                    <FaArrowLeft size={14} />
                    Back to Help Center
                </Link>

                {/* What is an ICP Staking Bot */}
                <div style={styles.section} className="icp-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaServer size={20} color={icpPrimary} />
                        </div>
                        <h2 style={styles.subheading}>What is an ICP Staking Bot?</h2>
                    </div>
                    <p style={styles.paragraph}>
                        An ICP Staking Bot is a smart contract (app canister) deployed on the Internet Computer that acts as 
                        the controller of your ICP neurons. Instead of your personal wallet directly controlling neurons, 
                        the app canister becomes the neuron controller, and you control the app canister.
                    </p>
                    
                    {/* Diagram */}
                    <div style={styles.diagramBox}>
                        <div style={styles.diagramItem}>
                            <div style={{ color: icpPrimary, fontWeight: 'bold' }}>Your Wallet</div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>(Controller of App Canister)</div>
                        </div>
                        <div style={styles.diagramArrow}>
                            <div style={{ fontSize: '0.8rem' }}>controls</div>
                            <div style={{ fontSize: '1.5rem' }}>↓</div>
                        </div>
                        <div style={styles.diagramItem}>
                            <div style={{ color: icpPrimary, fontWeight: 'bold' }}>ICP Staking Bot</div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>(On-chain smart contract)</div>
                        </div>
                        <div style={styles.diagramArrow}>
                            <div style={{ fontSize: '0.8rem' }}>controls</div>
                            <div style={{ fontSize: '1.5rem' }}>↓</div>
                        </div>
                        <div style={styles.diagramItem}>
                            <div style={{ color: icpPrimary, fontWeight: 'bold' }}>ICP Neurons</div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>(Staked on NNS)</div>
                        </div>
                    </div>
                    
                    <div style={styles.infoBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>Key Benefits</h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Decentralized Control:</strong> Neurons controlled by on-chain code, not centralized services</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Multi-Controller:</strong> Multiple wallets can control the same app canister and neurons</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Programmable:</strong> Automate neuron management with custom logic</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Upgradeable:</strong> Update app canister code while preserving neurons</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Transparent:</strong> All operations are on-chain and auditable</li>
                        </ul>
                    </div>
                </div>

                {/* Creating */}
                <div style={styles.section} className="icp-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#10b981')}>
                            <FaRocket size={20} color="#10b981" />
                        </div>
                        <h2 style={styles.subheading}>Creating a Staking Bot</h2>
                    </div>
                    <ol style={styles.stepList}>
                        <li style={styles.stepItem}>Navigate to the <Link to="/create_icp_neuron" style={styles.link}>Create ICP Neuron</Link> page</li>
                        <li style={styles.stepItem}>Click "Pay" to send the required ICP creation fee</li>
                        <li style={styles.stepItem}>Once payment is confirmed, click "Create" to deploy your app canister</li>
                        <li style={styles.stepItem}>Your app canister is created with you as the controller, funded with cycles</li>
                    </ol>
                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>What You Get:</strong> A dedicated app canister you fully control, pre-funded 
                            with cycles and ready to create/manage ICP neurons immediately.
                        </p>
                    </div>
                </div>

                {/* Neuron Operations */}
                <div style={styles.section} className="icp-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#8b5cf6')}>
                            <FaCogs size={20} color="#8b5cf6" />
                        </div>
                        <h2 style={styles.subheading}>Neuron Operations</h2>
                    </div>
                    
                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaLock size={14} color="#f59e0b" />
                            Dissolve Management
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Start/Stop Dissolving</li>
                            <li style={styles.listItem}>Increase Dissolve Delay</li>
                        </ul>
                    </div>
                    
                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaVoteYea size={14} color="#10b981" />
                            Voting & Following
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Vote on NNS proposals</li>
                            <li style={styles.listItem}>Set following for automatic voting</li>
                            <li style={styles.listItem}>Configure different followees by topic</li>
                        </ul>
                    </div>
                    
                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaCoins size={14} color="#3b82f6" />
                            Stake & Rewards
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Increase stake on existing neurons</li>
                            <li style={styles.listItem}>Spawn maturity into new neurons</li>
                            <li style={styles.listItem}>Disburse maturity to liquid ICP</li>
                            <li style={styles.listItem}>Disburse from dissolved neurons</li>
                        </ul>
                    </div>
                    
                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaKey size={14} color="#ec4899" />
                            Hotkey Management
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Add hotkeys for voting access</li>
                            <li style={styles.listItem}>Remove hotkeys as needed</li>
                        </ul>
                        <div style={{ ...styles.tipBox, marginTop: '0.5rem', marginBottom: 0 }}>
                            <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                                <strong style={styles.strong}>💡 Tip:</strong> Add your NNS principal as a hotkey to vote directly 
                                from the <a href="https://nns.ic0.app" target="_blank" rel="noopener noreferrer" style={styles.link}>NNS dApp</a>!
                            </p>
                        </div>
                    </div>
                    
                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaCut size={14} color="#6366f1" />
                            Advanced Operations
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Split neurons into multiple neurons</li>
                            <li style={styles.listItem}>Merge neurons together</li>
                        </ul>
                    </div>
                </div>

                {/* Controllers and Security */}
                <div style={styles.section} className="icp-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#ef4444')}>
                            <FaShieldAlt size={20} color="#ef4444" />
                        </div>
                        <h2 style={styles.subheading}>Controllers and Security</h2>
                    </div>
                    <p style={styles.paragraph}>
                        The app canister uses the IC's built-in controller system for access control. Only listed controllers 
                        can perform management operations.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Managing Controllers</h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Add Controller:</strong> Grant another principal full control</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Remove Controller:</strong> Revoke a principal's access (requires at least one to remain)</li>
                    </ul>
                    
                    <div style={styles.warningBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaExclamationTriangle size={14} color="#f59e0b" />
                            Security Considerations
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Controllers have full power—add/remove controllers, manage neurons</li>
                            <li style={styles.listItem}>Never remove yourself as the last controller</li>
                            <li style={styles.listItem}>Only add principals you completely trust</li>
                            <li style={styles.listItem}>Consider a backup controller for recovery</li>
                        </ul>
                    </div>
                </div>

                {/* Botkeys */}
                <div style={styles.section} className="icp-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#ec4899')}>
                            <FaUserShield size={20} color="#ec4899" />
                        </div>
                        <h2 style={styles.subheading}>Botkeys</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Botkeys allow you to grant other principals permission to use specific features of your staking bot 
                        <strong style={styles.strong}> without making them a controller</strong>. While controllers have 
                        unrestricted access to everything, botkey holders can only perform the operations you explicitly allow.
                    </p>

                    <div style={styles.infoBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaKey size={14} color={icpPrimary} />
                            Botkeys vs Controllers
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Controllers</strong> have full, unrestricted access — they can upgrade the canister, manage all neurons, and do anything</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Botkey holders</strong> can only perform the specific operations you've granted — for example, voting but not disbursing</li>
                            <li style={styles.listItem}>Botkeys are managed entirely within the bot canister's permission system, not the IC controller list</li>
                        </ul>
                    </div>

                    <h4 style={styles.subsubheading}>
                        <FaCogs size={14} color="#8b5cf6" />
                        Managing Botkeys
                    </h4>
                    <p style={styles.paragraph}>
                        Navigate to your staking bot's page and open the <strong style={styles.strong}>Botkeys</strong> tab 
                        (requires bot version 0.9.1 or newer). From there you can:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Add a principal</strong> and select which permissions to grant</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Edit permissions</strong> for an existing botkey holder at any time</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Remove a principal</strong> to revoke all their access</li>
                    </ul>

                    <h4 style={styles.subsubheading}>
                        <FaShieldAlt size={14} color="#ef4444" />
                        Available Permissions
                    </h4>
                    <p style={styles.paragraph}>
                        Permissions are fine-grained — you choose exactly what each botkey holder can do:
                    </p>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0, fontSize: '0.9rem' }}>
                            General
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Full Permissions</strong> — all permissions, including any added in future updates</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Manage Permissions</strong> — add/remove other botkey principals and their permissions</li>
                            <li style={styles.listItem}><strong style={styles.strong}>View Neurons</strong> — view neuron info, list neurons, and check balances</li>
                        </ul>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0, fontSize: '0.9rem' }}>
                            Neuron Operations
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Configure Dissolve State</strong> — start/stop dissolving, set dissolve delay</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Vote</strong> — vote on NNS proposals, refresh voting power</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Make Proposal</strong> — submit NNS proposals</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Manage Followees</strong> — set followees and confirm following</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Stake Neuron</strong> — create neurons, increase or refresh stake</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Disburse</strong> — disburse neuron stake</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Disburse Maturity</strong> — disburse accumulated maturity</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Stake / Merge / Spawn Maturity</strong> — manage maturity as stake</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Split / Merge Neurons</strong> — restructure neurons</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Manage Neuron Hotkeys</strong> — add/remove NNS hotkeys on neurons</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Auto-Stake Maturity</strong> — toggle automatic maturity staking</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Manage Visibility</strong> — change neuron visibility settings</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Withdraw Funds</strong> — withdraw ICP or tokens held by the canister</li>
                        </ul>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0, fontSize: '0.9rem' }}>
                            Chore Permissions
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Manage [Chore]</strong> — start, stop, pause, resume, trigger, and set the interval for a specific chore (one permission per chore)</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Configure Collect Maturity</strong> — set the maturity threshold and destination account</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Configure Distribution</strong> — add, edit, and remove distribution lists</li>
                            <li style={styles.listItem}><strong style={styles.strong}>View Chores</strong> — view chore statuses and configurations (read-only)</li>
                        </ul>
                    </div>

                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                            <strong style={styles.strong}>💡 Use Case:</strong> Grant a trusted friend "Vote" permission so they 
                            can vote on your behalf during vacations, without giving them access to disburse or transfer funds.
                        </p>
                    </div>
                </div>

                {/* Bot Chores */}
                <div style={styles.section} className="icp-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#8b5cf6')}>
                            <FaRobot size={20} color="#8b5cf6" />
                        </div>
                        <h2 style={styles.subheading}>Bot Chores</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Bot Chores are <strong style={styles.strong}>automated recurring tasks</strong> that your staking bot 
                        can run on a schedule. Instead of logging in regularly to perform routine neuron maintenance, you 
                        configure chores once and the bot handles the rest — all on-chain, with no external servers.
                    </p>

                    <div style={styles.infoBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaClock size={14} color={icpPrimary} />
                            How Chores Work
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            Each chore uses a three-level timer architecture that runs safely within the Internet Computer's 
                            instruction limits:
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Scheduler</strong> — fires on your configured interval (e.g. every 7 days) and kicks off the work</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Conductor</strong> — orchestrates the chore by starting tasks and monitoring their progress</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Task</strong> — does the actual work in small, safe chunks until complete</li>
                        </ul>
                    </div>

                    <div style={styles.tipBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaClock size={14} color={icpPrimary} />
                            Interval Randomization
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            Each chore's interval can optionally be set as a <strong style={styles.strong}>range</strong> (e.g. 
                            "every 5 to 10 days"). When a range is set, the bot picks a random time within 
                            the range each time it reschedules. This is useful for bots where perfectly regular 
                            scheduling is undesirable — for example, a trading bot that should vary the timing of its actions. 
                            Leave the max field blank for exact, predictable scheduling.
                        </p>
                    </div>

                    {/* Confirm Following */}
                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaHandshake size={14} color="#10b981" />
                            Confirm Following
                        </h4>
                        <p style={styles.paragraph}>
                            The NNS requires you to <strong style={styles.strong}>re-confirm your neuron followees every 6 months</strong>, 
                            or your neurons stop earning voting rewards. This chore automates that confirmation so you never miss the deadline.
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Default interval: every 30 days</li>
                            <li style={styles.listItem}>Iterates through all neurons and re-confirms each of their follow relationships</li>
                            <li style={styles.listItem}>Warns you if the next scheduled run is after the followings would expire</li>
                        </ul>
                    </div>

                    {/* Auto-Refresh Stake */}
                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaSyncAlt size={14} color="#3b82f6" />
                            Auto-Refresh Stake
                        </h4>
                        <p style={styles.paragraph}>
                            To increase stake on a neuron, you first send ICP to the neuron's governance account, then call 
                            a refresh method. This chore <strong style={styles.strong}>automatically refreshes all your neurons' stakes</strong>, 
                            picking up any ICP that has been deposited since the last refresh.
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Default interval: every 1 day</li>
                            <li style={styles.listItem}>Perfect for external bots or scripts that deposit ICP directly to neuron accounts</li>
                            <li style={styles.listItem}>The deposit address for each neuron is shown in the Stake tab</li>
                        </ul>
                    </div>

                    {/* Collect Maturity */}
                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaCoins size={14} color="#f59e0b" />
                            Collect Maturity
                        </h4>
                        <p style={styles.paragraph}>
                            Neurons accumulate maturity from voting rewards. This chore <strong style={styles.strong}>automatically 
                            disburses maturity</strong> to an account of your choice whenever it exceeds a threshold.
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Default interval: every 7 days</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Threshold:</strong> minimum maturity (in ICP) before collection happens — leave blank to collect any amount</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Destination:</strong> any ICRC-1 account (principal + optional subaccount) — leave blank to send to the bot's own account</li>
                        </ul>
                    </div>

                    {/* Distribution */}
                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaExchangeAlt size={14} color="#6366f1" />
                            Distribute Funds
                        </h4>
                        <p style={styles.paragraph}>
                            Automatically <strong style={styles.strong}>distribute tokens from the bot to a list of recipients</strong> based 
                            on configured percentages. This is ideal for splitting staking rewards among multiple parties.
                        </p>
                        <p style={{ ...styles.paragraph, fontSize: '0.85rem' }}>
                            Each distribution list defines:
                        </p>
                        <ul style={{ ...styles.list, marginBottom: '0.5rem' }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Source:</strong> which token and (optional) subaccount to check</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Threshold:</strong> minimum balance before distribution happens</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Max per round:</strong> optional cap on how much to distribute in one run</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Targets:</strong> a list of accounts, each with an optional percentage share</li>
                        </ul>
                        <div style={{ ...styles.tipBox, marginBottom: 0 }}>
                            <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                                <strong style={styles.strong}>💡 Percentage Math:</strong> Targets with no percentage set split equally 
                                what's left after the assigned targets. If assigned percentages exceed 100%, they are automatically 
                                renormalized. The actual calculated share for each target is displayed in the configuration UI.
                            </p>
                        </div>
                    </div>

                    {/* Lifecycle */}
                    <h4 style={styles.subsubheading}>
                        <FaCogs size={14} color="#8b5cf6" />
                        Chore Lifecycle
                    </h4>
                    <p style={styles.paragraph}>
                        Each chore can be in one of three states, and you control transitions through five actions:
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '1rem' }}>
                        <div style={styles.featureCard}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <FaPlay size={12} color="#10b981" />
                                <strong style={{ ...styles.strong, fontSize: '0.9rem' }}>Start</strong>
                                <span style={{ ...styles.paragraph, margin: 0, fontSize: '0.85rem' }}>— runs the chore immediately and schedules the next run</span>
                            </div>
                        </div>
                        <div style={styles.featureCard}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <FaPause size={12} color="#f59e0b" />
                                <strong style={{ ...styles.strong, fontSize: '0.9rem' }}>Pause</strong>
                                <span style={{ ...styles.paragraph, margin: 0, fontSize: '0.85rem' }}>— suspends the schedule but remembers when it should have run next</span>
                            </div>
                        </div>
                        <div style={styles.featureCard}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <FaPlay size={12} color="#3b82f6" />
                                <strong style={{ ...styles.strong, fontSize: '0.9rem' }}>Resume</strong>
                                <span style={{ ...styles.paragraph, margin: 0, fontSize: '0.85rem' }}>— reactivates the schedule; runs immediately if the scheduled time has passed</span>
                            </div>
                        </div>
                        <div style={styles.featureCard}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <FaStop size={12} color="#ef4444" />
                                <strong style={{ ...styles.strong, fontSize: '0.9rem' }}>Stop</strong>
                                <span style={{ ...styles.paragraph, margin: 0, fontSize: '0.85rem' }}>— cancels everything and clears the schedule entirely</span>
                            </div>
                        </div>
                        <div style={styles.featureCard}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <FaSyncAlt size={12} color="#8b5cf6" />
                                <strong style={{ ...styles.strong, fontSize: '0.9rem' }}>Run Now</strong>
                                <span style={{ ...styles.paragraph, margin: 0, fontSize: '0.85rem' }}>— triggers a one-off run without changing the regular schedule</span>
                            </div>
                        </div>
                    </div>

                    {/* Status Lamps */}
                    <h4 style={styles.subsubheading}>
                        <FaLightbulb size={14} color="#f59e0b" />
                        Status Lamps
                    </h4>
                    <p style={styles.paragraph}>
                        Each chore displays colored status lamps for its Scheduler, Conductor, and Task to help you 
                        quickly understand what's happening:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <span style={{ color: '#22c55e', fontWeight: 600 }}>Green</span> — timer is currently running
                        </li>
                        <li style={styles.listItem}>
                            <span style={{ color: '#3b82f6', fontWeight: 600 }}>Blue</span> — not running now, but scheduled to run
                        </li>
                        <li style={styles.listItem}>
                            <span style={{ color: '#6b7280', fontWeight: 600 }}>Gray</span> — off (not running and not scheduled)
                        </li>
                        <li style={styles.listItem}>
                            <span style={{ color: '#f59e0b', fontWeight: 600 }}>Orange</span> — warning: timer should be running but hasn't run in suspiciously long
                        </li>
                        <li style={styles.listItem}>
                            <span style={{ color: '#ef4444', fontWeight: 600 }}>Red</span> — error state detected
                        </li>
                    </ul>
                    <p style={styles.paragraph}>
                        Summary lamps aggregate across all chores — if any single chore has a problem, the summary 
                        turns red/orange, making it easy to spot issues at a glance from the bot card, wallet, or page banner.
                    </p>

                    <div style={styles.warningBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaExclamationTriangle size={14} color="#f59e0b" />
                            Important Notes
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Chores survive canister upgrades — running chores resume automatically after an upgrade</li>
                            <li style={styles.listItem}>Chores consume cycles on your bot canister — make sure it stays funded</li>
                            <li style={styles.listItem}>The "Confirm Following" chore is especially important: without it, followings expire after 6 months and you stop earning voting rewards</li>
                        </ul>
                    </div>
                </div>

                {/* Cycles */}
                <div style={styles.section} className="icp-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#14b8a6')}>
                            <FaCogs size={20} color="#14b8a6" />
                        </div>
                        <h2 style={styles.subheading}>Cycles and Maintenance</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Like all IC app canisters, your staking bot requires cycles to operate. Monitor your cycles balance 
                        and top up as needed.
                    </p>
                    <div style={styles.infoBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Top Up:</strong> Navigate to your ICP staking bot page, find "Top Up Cycles", 
                            and enter ICP amount. The CMC converts ICP to cycles automatically.
                        </p>
                    </div>
                </div>

                {/* FAQ */}
                <div style={styles.section} className="icp-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon(theme.colors.accent)}>
                            <FaQuestionCircle size={20} color={theme.colors.accent} />
                        </div>
                        <h2 style={styles.subheading}>Common Questions</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>What if my app canister runs out of cycles?</h4>
                    <div style={styles.successBox}>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            <strong style={styles.strong}>Your neurons are completely safe.</strong> Neurons are stored on the NNS, 
                            not in your app canister—your app canister is just a "remote control."
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>You remain the controller even if the app canister freezes</li>
                            <li style={styles.listItem}>Top up cycles anytime to unfreeze</li>
                            <li style={styles.listItem}>No important state is stored in the app canister</li>
                        </ul>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Why use an app canister instead of controlling neurons directly?</h4>
                    <p style={styles.paragraph}>
                        Multi-controller support, potential automation, upgradeability, and transferring control of all neurons 
                        by changing app canister controllers rather than each neuron individually.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Can I have multiple neuron managers?</h4>
                    <p style={styles.paragraph}>
                        Yes! Create as many as you want for separating different neuron sets or having different controller configurations.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Is my data safe during upgrades?</h4>
                    <p style={styles.paragraph}>
                        Yes! "Upgrade" mode preserves stable memory. Neurons are on the NNS, so they're always safe regardless 
                        of what happens to the app canister. Chore settings and botkey configurations are also preserved across upgrades.
                    </p>

                    <h4 style={styles.subsubheading}>Do chores keep running after a canister upgrade?</h4>
                    <p style={styles.paragraph}>
                        Yes! Chore state (including schedules) is stored in stable memory. After an upgrade, any chores that 
                        were running or scheduled will resume automatically. If a scheduled run was missed during the upgrade, 
                        it will run as soon as the canister restarts.
                    </p>

                    <h4 style={styles.subsubheading}>What's the difference between a botkey and a neuron hotkey?</h4>
                    <p style={styles.paragraph}>
                        <strong style={styles.strong}>Neuron hotkeys</strong> are an NNS feature — they allow a principal to vote and 
                        view a specific neuron directly via the NNS. <strong style={styles.strong}>Botkeys</strong> are a bot canister 
                        feature — they allow a principal to use the staking bot's API with fine-grained permissions across all 
                        neurons the bot controls. Botkeys are more powerful and flexible, supporting permissions for chores, 
                        fund management, and more.
                    </p>
                </div>

                {/* Getting Started */}
                <div style={styles.section} className="icp-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#10b981')}>
                            <FaCheckCircle size={20} color="#10b981" />
                        </div>
                        <h2 style={styles.subheading}>Getting Started</h2>
                    </div>
                    <div style={styles.successBox}>
                        <ol style={{ ...styles.stepList, marginBottom: 0 }}>
                            <li style={styles.stepItem}><strong style={styles.strong}>Create a Bot:</strong> Visit <Link to="/create_icp_neuron" style={styles.link}>Create ICP Neuron</Link></li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Create Neurons:</strong> Stake ICP directly from your wallet</li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Set Up Following:</strong> Configure automatic voting for rewards</li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Enable Chores:</strong> Start the "Confirm Following" chore to never miss the 6-month deadline</li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Optionally:</strong> Enable "Collect Maturity" and "Distribute Funds" to automate reward collection and distribution</li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Share Access:</strong> Use Botkeys to grant trusted principals specific permissions if needed</li>
                        </ol>
                    </div>
                </div>

                {/* Related Topics */}
                <div style={styles.section} className="icp-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaArrowLeft size={20} color={icpPrimary} />
                        </div>
                        <h2 style={styles.subheading}>Related Help Topics</h2>
                    </div>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <Link to="/help/neurons" style={styles.link}>Understanding SNS Neurons</Link> — Comparison with DAO-specific neurons
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/dapp-manager" style={styles.link}>App Manager</Link> — Track and organize all your apps
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

export default HelpIcpNeuronManager;
