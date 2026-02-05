import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { 
    FaServer, FaArrowLeft, FaNetworkWired, FaWallet, FaLock, FaVoteYea, 
    FaCoins, FaKey, FaCut, FaShieldAlt, FaCogs, FaRocket, 
    FaLightbulb, FaQuestionCircle, FaCheckCircle, FaExclamationTriangle
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
                                ICP Neuron Manager Canisters
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
                        Create and manage dedicated canisters for secure, decentralized ICP neuron control
                    </p>
                </div>
            </div>

            <main style={styles.container}>
                <Link to="/help" style={styles.backLink}>
                    <FaArrowLeft size={14} />
                    Back to Help Center
                </Link>

                {/* What is an ICP Neuron Manager */}
                <div style={styles.section} className="icp-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaServer size={20} color={icpPrimary} />
                        </div>
                        <h2 style={styles.subheading}>What is an ICP Neuron Manager?</h2>
                    </div>
                    <p style={styles.paragraph}>
                        An ICP Neuron Manager is a smart contract (canister) deployed on the Internet Computer that acts as 
                        the controller of your ICP neurons. Instead of your personal wallet directly controlling neurons, 
                        the canister becomes the neuron controller, and you control the canister.
                    </p>
                    
                    {/* Diagram */}
                    <div style={styles.diagramBox}>
                        <div style={styles.diagramItem}>
                            <div style={{ color: icpPrimary, fontWeight: 'bold' }}>Your Wallet</div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>(Controller of Canister)</div>
                        </div>
                        <div style={styles.diagramArrow}>
                            <div style={{ fontSize: '0.8rem' }}>controls</div>
                            <div style={{ fontSize: '1.5rem' }}>↓</div>
                        </div>
                        <div style={styles.diagramItem}>
                            <div style={{ color: icpPrimary, fontWeight: 'bold' }}>ICP Neuron Manager</div>
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
                            <li style={styles.listItem}><strong style={styles.strong}>Multi-Controller:</strong> Multiple wallets can control the same canister and neurons</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Programmable:</strong> Automate neuron management with custom logic</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Upgradeable:</strong> Update canister code while preserving neurons</li>
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
                        <h2 style={styles.subheading}>Creating a Neuron Manager</h2>
                    </div>
                    <ol style={styles.stepList}>
                        <li style={styles.stepItem}>Navigate to the <Link to="/create_icp_neuron" style={styles.link}>Create ICP Neuron</Link> page</li>
                        <li style={styles.stepItem}>Click "Pay" to send the required ICP creation fee</li>
                        <li style={styles.stepItem}>Once payment is confirmed, click "Create" to deploy your canister</li>
                        <li style={styles.stepItem}>Your canister is created with you as the controller, funded with cycles</li>
                    </ol>
                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>What You Get:</strong> A dedicated canister you fully control, pre-funded 
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
                        The canister uses the IC's built-in controller system for access control. Only listed controllers 
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

                {/* Cycles */}
                <div style={styles.section} className="icp-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#14b8a6')}>
                            <FaCogs size={20} color="#14b8a6" />
                        </div>
                        <h2 style={styles.subheading}>Cycles and Maintenance</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Like all IC canisters, your neuron manager requires cycles to operate. Monitor your cycles balance 
                        and top up as needed.
                    </p>
                    <div style={styles.infoBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Top Up:</strong> Navigate to your neuron manager page, find "Top Up Cycles", 
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
                    
                    <h4 style={styles.subsubheading}>What if my canister runs out of cycles?</h4>
                    <div style={styles.successBox}>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            <strong style={styles.strong}>Your neurons are completely safe.</strong> Neurons are stored on the NNS, 
                            not in your canister—your canister is just a "remote control."
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>You remain the controller even if the canister freezes</li>
                            <li style={styles.listItem}>Top up cycles anytime to unfreeze</li>
                            <li style={styles.listItem}>No important state is stored in the canister</li>
                        </ul>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Why use a canister instead of controlling neurons directly?</h4>
                    <p style={styles.paragraph}>
                        Multi-controller support, potential automation, upgradeability, and transferring control of all neurons 
                        by changing canister controllers rather than each neuron individually.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Can I have multiple neuron managers?</h4>
                    <p style={styles.paragraph}>
                        Yes! Create as many as you want for separating different neuron sets or having different controller configurations.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Is my data safe during upgrades?</h4>
                    <p style={styles.paragraph}>
                        Yes! "Upgrade" mode preserves stable memory. Neurons are on the NNS, so they're always safe regardless 
                        of what happens to the canister.
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
                            <li style={styles.stepItem}><strong style={styles.strong}>Create a Manager:</strong> Visit <Link to="/create_icp_neuron" style={styles.link}>Create ICP Neuron</Link></li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Create Neurons:</strong> Stake ICP directly from your wallet</li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Set Up Following:</strong> Configure automatic voting for rewards</li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Participate:</strong> Vote on proposals and watch your rewards grow!</li>
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
                            <Link to="/help/dapp-manager" style={styles.link}>App Manager</Link> — Track and organize all your canisters
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
