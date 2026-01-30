import React from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import { 
    FaUnlock, FaArrowRight, FaArrowLeft, FaExclamationTriangle, FaCheckCircle, 
    FaLightbulb, FaKey, FaShieldAlt, FaExchangeAlt, FaCode, FaTerminal,
    FaQuestionCircle, FaRocket
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

@keyframes jailbreakFloat {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    50% { transform: translateY(-10px) rotate(3deg); }
}

.jailbreak-help-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.jailbreak-help-float {
    animation: jailbreakFloat 4s ease-in-out infinite;
}
`;

// Page accent colors - red/orange theme for jailbreak
const jailbreakPrimary = '#ef4444';
const jailbreakSecondary = '#f97316';

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
    sectionIcon: (color = jailbreakPrimary) => ({
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
    stepCard: {
        background: theme.colors.secondaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '12px',
        padding: '1rem',
        marginBottom: '0.75rem',
    },
    stepNumber: {
        width: '32px',
        height: '32px',
        background: `linear-gradient(135deg, ${jailbreakPrimary}, ${jailbreakSecondary})`,
        color: '#fff',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: '700',
        fontSize: '0.9rem',
        marginRight: '12px',
        flexShrink: 0,
    },
    stepHeader: {
        display: 'flex',
        alignItems: 'center',
        marginBottom: '8px',
    },
    stepTitle: {
        fontWeight: '600',
        color: theme.colors.primaryText,
        fontSize: '1rem',
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
        padding: '2px 8px',
        borderRadius: '4px',
        fontFamily: 'monospace',
        fontSize: '0.85em',
        color: theme.colors.accent,
    },
    ctaButton: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        background: `linear-gradient(135deg, ${jailbreakPrimary}, ${jailbreakSecondary})`,
        color: '#fff',
        padding: '12px 20px',
        borderRadius: '10px',
        textDecoration: 'none',
        fontWeight: '600',
        marginTop: '0.5rem',
        boxShadow: `0 4px 16px ${jailbreakPrimary}40`,
    },
    featureGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '0.75rem',
        marginTop: '1rem',
        marginBottom: '1rem',
    },
    featureGridCard: (color) => ({
        background: theme.colors.secondaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '12px',
        padding: '1rem',
        textAlign: 'center',
    }),
    featureGridIcon: (color) => ({
        width: '44px',
        height: '44px',
        borderRadius: '12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 10px auto',
        background: `linear-gradient(135deg, ${color}20, ${color}10)`,
    }),
    featureGridTitle: {
        fontWeight: '600',
        color: theme.colors.primaryText,
        marginBottom: '6px',
        fontSize: '0.95rem',
    },
    featureGridDesc: {
        fontSize: '0.8rem',
        color: theme.colors.mutedText,
        lineHeight: '1.4',
    },
});

function HelpSnsJailbreak() {
    const { theme } = useTheme();
    const styles = getStyles(theme);

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customAnimations}</style>
            <Header />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${jailbreakPrimary}15 0%, ${jailbreakSecondary}10 50%, transparent 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '3rem 1.25rem 2.5rem',
                position: 'relative',
                overflow: 'hidden',
            }}>
                <div style={{
                    position: 'absolute',
                    top: '-50%',
                    right: '-10%',
                    width: '400px',
                    height: '400px',
                    background: `radial-gradient(circle, ${jailbreakPrimary}20 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-30%',
                    left: '-5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${jailbreakSecondary}15 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />
                
                <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '16px', flexWrap: 'wrap' }}>
                        <div className="jailbreak-help-float" style={{
                            width: '72px',
                            height: '72px',
                            borderRadius: '20px',
                            background: `linear-gradient(135deg, ${jailbreakPrimary}, ${jailbreakSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 12px 40px ${jailbreakPrimary}50`,
                        }}>
                            <FaUnlock size={36} color="#fff" />
                        </div>
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <div style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                background: `${jailbreakPrimary}20`,
                                border: `1px solid ${jailbreakPrimary}40`,
                                borderRadius: '20px',
                                padding: '4px 12px',
                                marginBottom: '8px',
                            }}>
                                <FaKey size={12} color={jailbreakPrimary} />
                                <span style={{ fontSize: '0.75rem', fontWeight: '600', color: jailbreakPrimary }}>
                                    Neuron Control
                                </span>
                            </div>
                            <h1 style={{
                                fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
                                fontWeight: '800',
                                color: theme.colors.primaryText,
                                margin: 0,
                            }}>
                                SNS Jailbreak
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
                        Add full controller access to your SNS neurons for trading and management
                    </p>
                </div>
            </div>

            <main style={styles.container}>
                <Link to="/help" style={styles.backLink}>
                    <FaArrowLeft size={14} />
                    Back to Help Center
                </Link>

                {/* CTA */}
                <div style={{ textAlign: 'center', marginBottom: '1.5rem' }} className="jailbreak-help-fade-in">
                    <Link to="/tools/sns_jailbreak" style={styles.ctaButton}>
                        <FaUnlock size={16} />
                        Start Jailbreaking
                        <FaArrowRight size={14} />
                    </Link>
                </div>

                {/* What is SNS Jailbreak */}
                <div style={styles.section} className="jailbreak-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaUnlock size={20} color={jailbreakPrimary} />
                        </div>
                        <h2 style={styles.subheading}>What is SNS Jailbreak?</h2>
                    </div>
                    <p style={styles.paragraph}>
                        <strong style={styles.strong}>SNS Jailbreak</strong> helps you unlock the full potential of your 
                        SNS neurons by adding your Sneed Wallet principal as a full controller. This makes your neurons 
                        transferable, tradable, and fully manageable from within the Sneed ecosystem.
                    </p>
                    <p style={styles.paragraph}>
                        When you create an SNS neuron through the NNS app, that neuron is controlled exclusively by your 
                        NNS identity. SNS Jailbreak adds your Sneed Wallet principal as a full controller—it doesn't remove 
                        your NNS control, just adds additional access with full permissions.
                    </p>
                    
                    <div style={styles.featureGrid}>
                        <div style={styles.featureGridCard(theme.colors.accent)}>
                            <div style={styles.featureGridIcon(theme.colors.accent)}>
                                <FaExchangeAlt size={20} color={theme.colors.accent} />
                            </div>
                            <div style={styles.featureGridTitle}>Trade Neurons</div>
                            <div style={styles.featureGridDesc}>
                                List and sell jailbroken neurons on Sneedex marketplace
                            </div>
                        </div>
                        <div style={styles.featureGridCard('#10b981')}>
                            <div style={styles.featureGridIcon('#10b981')}>
                                <FaKey size={20} color="#10b981" />
                            </div>
                            <div style={styles.featureGridTitle}>Full Control</div>
                            <div style={styles.featureGridDesc}>
                                Vote, stake, disburse, and manage from your Sneed Wallet
                            </div>
                        </div>
                        <div style={styles.featureGridCard('#8b5cf6')}>
                            <div style={styles.featureGridIcon('#8b5cf6')}>
                                <FaShieldAlt size={20} color="#8b5cf6" />
                            </div>
                            <div style={styles.featureGridTitle}>Keep NNS Access</div>
                            <div style={styles.featureGridDesc}>
                                Original NNS control remains intact—jailbreaking adds, doesn't remove
                            </div>
                        </div>
                    </div>
                </div>

                {/* How It Works */}
                <div style={styles.section} className="jailbreak-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#3b82f6')}>
                            <FaCode size={20} color="#3b82f6" />
                        </div>
                        <h2 style={styles.subheading}>How It Works</h2>
                    </div>
                    <p style={styles.paragraph}>
                        The jailbreak process uses a JavaScript script that runs in your browser's developer console 
                        while you're logged into the NNS app. This script calls the SNS governance canister to add 
                        your Sneed Wallet principal as a controller with full permissions.
                    </p>
                    
                    <div style={styles.tipBox}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                            <FaLightbulb size={18} color="#10b981" style={{ flexShrink: 0, marginTop: '2px' }} />
                            <div>
                                <strong style={styles.strong}>Why a script?</strong> The NNS app doesn't provide a UI to add 
                                controllers with full permissions. Our script uses the same APIs the NNS app uses, just 
                                with the parameters needed to grant full control.
                            </div>
                        </div>
                    </div>
                    
                    <h4 style={styles.subsubheading}>The Jailbreak Process</h4>
                    
                    <div style={styles.stepCard}>
                        <div style={styles.stepHeader}>
                            <span style={styles.stepNumber}>1</span>
                            <span style={styles.stepTitle}>Select Your SNS</span>
                        </div>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            Choose which SNS DAO your neuron belongs to. Only SNSes that support full hotkey permissions can be jailbroken.
                        </p>
                    </div>
                    
                    <div style={styles.stepCard}>
                        <div style={styles.stepHeader}>
                            <span style={styles.stepNumber}>2</span>
                            <span style={styles.stepTitle}>Select Your Neuron</span>
                        </div>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            Pick the neuron you want to jailbreak. Select from neurons already hotkeyed to your Sneed Wallet, or enter any neuron ID manually.
                        </p>
                    </div>
                    
                    <div style={styles.stepCard}>
                        <div style={styles.stepHeader}>
                            <span style={styles.stepNumber}>3</span>
                            <span style={styles.stepTitle}>Choose Target Principal</span>
                        </div>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            Your Sneed Wallet principal is pre-selected. You can change this to any principal ID if needed.
                        </p>
                    </div>
                    
                    <div style={styles.stepCard}>
                        <div style={styles.stepHeader}>
                            <span style={styles.stepNumber}>4</span>
                            <span style={styles.stepTitle}>Generate & Run Script</span>
                        </div>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            The wizard generates a customized JavaScript script. Copy it, then paste and run it in your browser's developer console while logged into the NNS app.
                        </p>
                    </div>
                    
                    <div style={styles.stepCard}>
                        <div style={styles.stepHeader}>
                            <span style={styles.stepNumber}>5</span>
                            <span style={styles.stepTitle}>Verify Success</span>
                        </div>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            Check that your Sneed Wallet principal appears as a controller with full permissions on your neuron.
                        </p>
                    </div>
                </div>

                {/* Running the Script */}
                <div style={styles.section} className="jailbreak-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#8b5cf6')}>
                            <FaTerminal size={20} color="#8b5cf6" />
                        </div>
                        <h2 style={styles.subheading}>Running the Script</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Opening the Developer Console</h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Chrome / Brave / Edge:</strong> <code style={styles.code}>F12</code> or <code style={styles.code}>Ctrl+Shift+J</code> (Win/Linux) or <code style={styles.code}>Cmd+Option+J</code> (Mac)
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Firefox:</strong> <code style={styles.code}>F12</code> or <code style={styles.code}>Ctrl+Shift+K</code> (Win/Linux) or <code style={styles.code}>Cmd+Option+K</code> (Mac)
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Safari:</strong> Enable Developer menu in Preferences → Advanced, then <code style={styles.code}>Cmd+Option+C</code>
                        </li>
                    </ul>
                    
                    <div style={styles.warningBox}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                            <FaExclamationTriangle size={18} color="#f59e0b" style={{ flexShrink: 0, marginTop: '2px' }} />
                            <div>
                                <strong style={styles.strong}>Security Warning:</strong> Only run scripts you trust. Our jailbreak script is{' '}
                                <a href="https://github.com/Snassy-icp/app_sneeddao/blob/main/resources/sns_jailbreak/base_script.js" target="_blank" rel="noopener noreferrer" style={styles.link}>
                                    open source on GitHub
                                </a>—verify exactly what it does before running.
                            </div>
                        </div>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Step-by-Step</h4>
                    <ol style={styles.list}>
                        <li style={styles.listItem}>Go to <a href="https://nns.ic0.app" target="_blank" rel="noopener noreferrer" style={styles.link}>nns.ic0.app</a> and log in</li>
                        <li style={styles.listItem}>Open the developer console</li>
                        <li style={styles.listItem}>Copy the entire script from the Sneed Jailbreak wizard</li>
                        <li style={styles.listItem}>Paste the script into the console and press Enter</li>
                        <li style={styles.listItem}>Wait for success or error message</li>
                    </ol>
                </div>

                {/* After Jailbreaking */}
                <div style={styles.section} className="jailbreak-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#10b981')}>
                            <FaCheckCircle size={20} color="#10b981" />
                        </div>
                        <h2 style={styles.subheading}>After Jailbreaking</h2>
                    </div>
                    <p style={styles.paragraph}>Once your neuron is jailbroken, you can:</p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Manage from Sneed Wallet:</strong> View, vote, stake maturity, and disburse directly from Sneed Hub</li>
                        <li style={styles.listItem}><strong style={styles.strong}>List on Sneedex:</strong> Create an offer to sell your neuron on the <Link to="/sneedex" style={styles.link}>Sneedex marketplace</Link></li>
                        <li style={styles.listItem}><strong style={styles.strong}>Transfer Ownership:</strong> Add or remove controllers, transfer full control to another principal</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Keep Using NNS:</strong> Your original NNS access remains unchanged</li>
                    </ul>
                    
                    <div style={styles.tipBox}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                            <FaCheckCircle size={18} color="#10b981" style={{ flexShrink: 0, marginTop: '2px' }} />
                            <div>
                                <strong style={styles.strong}>Pro Tip:</strong> After jailbreaking, visit your{' '}
                                <Link to="/neurons" style={styles.link}>Neurons page</Link> to see all your neurons with Sneed Wallet as controller—manage them all from one place!
                            </div>
                        </div>
                    </div>
                </div>

                {/* Supported SNSes */}
                <div style={styles.section} className="jailbreak-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#f59e0b')}>
                            <FaRocket size={20} color="#f59e0b" />
                        </div>
                        <h2 style={styles.subheading}>Supported SNS DAOs</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Not all SNS DAOs support jailbreaking. For it to work, the SNS must allow granting 
                        full permissions (including <code style={styles.code}>ManagePrincipals</code>) to hotkeys. 
                        This is controlled by the SNS's <code style={styles.code}>neuron_grantable_permissions</code> parameter.
                    </p>
                    <p style={styles.paragraph}>
                        The jailbreak wizard automatically filters out unsupported SNSes and shows which ones can be jailbroken.
                    </p>
                    <div style={styles.infoBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            SNS DAOs can enable full hotkey permissions through a governance proposal. If your favorite SNS 
                            doesn't support jailbreaking, consider proposing a parameter change to the DAO!
                        </p>
                    </div>
                </div>

                {/* FAQ */}
                <div style={styles.section} className="jailbreak-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon(theme.colors.accent)}>
                            <FaQuestionCircle size={20} color={theme.colors.accent} />
                        </div>
                        <h2 style={styles.subheading}>Common Questions</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Is this safe?</h4>
                    <p style={styles.paragraph}>
                        Yes! The script is open source and only adds a controller—it doesn't remove your existing access or modify your neuron in any other way.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Will I lose my NNS access?</h4>
                    <p style={styles.paragraph}>
                        No. Jailbreaking adds your Sneed Wallet as an additional controller. Your original NNS control remains fully intact.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Can I undo a jailbreak?</h4>
                    <p style={styles.paragraph}>
                        Yes. Since you have full control from both identities, you can remove any controller you've added.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Why do I need to run a script?</h4>
                    <p style={styles.paragraph}>
                        The NNS app's UI doesn't provide a way to add controllers with full permissions. The script uses the same SNS governance APIs, just with the specific parameters needed for full control.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Why doesn't my SNS support jailbreaking?</h4>
                    <p style={styles.paragraph}>
                        Each SNS DAO configures which permissions can be granted to hotkeys. If an SNS doesn't support jailbreaking, the DAO's governance parameters don't allow granting full permissions like <code style={styles.code}>ManagePrincipals</code>.
                    </p>
                </div>

                {/* Related Topics */}
                <div style={styles.section} className="jailbreak-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaArrowLeft size={20} color={jailbreakPrimary} />
                        </div>
                        <h2 style={styles.subheading}>Related Help Topics</h2>
                    </div>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <Link to="/help/neurons" style={styles.link}>Understanding SNS Neurons</Link> — Neuron management and hotkeys
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/sneedex" style={styles.link}>Sneedex Marketplace</Link> — Trade jailbroken neurons
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help" style={styles.link}>Help Center</Link> — Browse all help topics
                        </li>
                    </ul>
                </div>

                {/* Final CTA */}
                <div style={{ textAlign: 'center', marginTop: '2rem' }} className="jailbreak-help-fade-in">
                    <Link to="/tools/sns_jailbreak" style={styles.ctaButton}>
                        <FaUnlock size={16} />
                        Start Jailbreaking
                        <FaArrowRight size={14} />
                    </Link>
                </div>
            </main>
        </div>
    );
}

export default HelpSnsJailbreak;
