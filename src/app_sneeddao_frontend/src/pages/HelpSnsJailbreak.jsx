import React from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import { FaUnlock, FaArrowRight, FaExclamationTriangle, FaCheckCircle, FaLightbulb, FaKey, FaShieldAlt, FaExchangeAlt } from 'react-icons/fa';

function HelpSnsJailbreak() {
    const { theme } = useTheme();

    const styles = {
        container: {
            minHeight: '100vh',
            background: theme.colors.background,
            color: theme.colors.primaryText
        },
        content: {
            maxWidth: '900px',
            margin: '0 auto',
            padding: '40px 20px'
        },
        heading: {
            fontSize: '2.5rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
            marginBottom: '1rem',
            marginTop: '0',
            display: 'flex',
            alignItems: 'center',
            gap: '16px'
        },
        subheading: {
            fontSize: '1.8rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
            marginTop: '2.5rem',
            marginBottom: '1rem',
            borderBottom: `2px solid ${theme.colors.border}`,
            paddingBottom: '0.5rem'
        },
        subsubheading: {
            fontSize: '1.3rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
            marginTop: '1.5rem',
            marginBottom: '0.75rem'
        },
        paragraph: {
            fontSize: '1rem',
            lineHeight: '1.7',
            color: theme.colors.secondaryText,
            marginBottom: '1rem'
        },
        list: {
            marginLeft: '1.5rem',
            marginBottom: '1rem',
            color: theme.colors.secondaryText
        },
        listItem: {
            marginBottom: '0.75rem',
            lineHeight: '1.6'
        },
        numberedList: {
            marginLeft: '1.5rem',
            marginBottom: '1rem',
            color: theme.colors.secondaryText,
            listStyleType: 'decimal'
        },
        infoBox: {
            background: `${theme.colors.accent}15`,
            border: `1px solid ${theme.colors.accent}50`,
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px'
        },
        tipBox: {
            background: `${theme.colors.success || '#4CAF50'}15`,
            border: `1px solid ${theme.colors.success || '#4CAF50'}50`,
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px'
        },
        warningBox: {
            background: `${theme.colors.warning || '#FF9800'}15`,
            border: `1px solid ${theme.colors.warning || '#FF9800'}50`,
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px'
        },
        dangerBox: {
            background: `${theme.colors.error || '#f44336'}15`,
            border: `1px solid ${theme.colors.error || '#f44336'}50`,
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px'
        },
        link: {
            color: theme.colors.accent,
            textDecoration: 'none',
            fontWeight: '500',
            transition: 'opacity 0.2s ease'
        },
        strong: {
            color: theme.colors.primaryText,
            fontWeight: '600'
        },
        code: {
            background: theme.colors.secondaryBg,
            padding: '2px 8px',
            borderRadius: '4px',
            fontFamily: 'monospace',
            fontSize: '0.9em',
            color: theme.colors.accent
        },
        codeBlock: {
            background: theme.colors.secondaryBg,
            padding: '16px',
            borderRadius: '8px',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            overflowX: 'auto',
            marginBottom: '1rem',
            border: `1px solid ${theme.colors.border}`
        },
        section: {
            marginBottom: '2rem'
        },
        ctaButton: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: theme.colors.accent,
            color: '#fff',
            padding: '14px 24px',
            borderRadius: '10px',
            textDecoration: 'none',
            fontWeight: '600',
            marginTop: '1rem',
            marginBottom: '2rem'
        },
        stepCard: {
            background: theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '1rem'
        },
        stepNumber: {
            width: '32px',
            height: '32px',
            background: theme.colors.accent,
            color: '#fff',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '700',
            fontSize: '1rem',
            marginRight: '12px',
            flexShrink: 0
        },
        stepHeader: {
            display: 'flex',
            alignItems: 'center',
            marginBottom: '12px'
        },
        stepTitle: {
            fontWeight: '600',
            color: theme.colors.primaryText,
            fontSize: '1.1rem'
        },
        featureGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '1rem',
            marginTop: '1rem',
            marginBottom: '1.5rem'
        },
        featureCard: {
            background: theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '12px',
            padding: '20px',
            textAlign: 'center'
        },
        featureIcon: {
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px auto',
            fontSize: '1.3rem'
        },
        featureTitle: {
            fontWeight: '600',
            color: theme.colors.primaryText,
            marginBottom: '8px'
        },
        featureDesc: {
            fontSize: '0.9rem',
            color: theme.colors.mutedText,
            lineHeight: '1.5'
        }
    };

    return (
        <div style={styles.container}>
            <Header />
            <div style={styles.content}>
                <h1 style={styles.heading}>
                    <FaUnlock style={{ color: theme.colors.accent }} />
                    SNS Jailbreak
                </h1>
                
                <p style={styles.paragraph}>
                    <strong style={styles.strong}>SNS Jailbreak</strong> is a tool that helps you unlock the full potential of your 
                    SNS neurons by adding your Sneed Wallet principal as a full controller. This makes your neurons 
                    transferable, tradable, and fully manageable from within the Sneed ecosystem.
                </p>

                <Link to="/tools/sns_jailbreak" style={styles.ctaButton}>
                    <FaUnlock />
                    Start Jailbreaking
                    <FaArrowRight size={14} />
                </Link>

                {/* What is SNS Jailbreak */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>What is SNS Jailbreak?</h2>
                    
                    <p style={styles.paragraph}>
                        When you create an SNS neuron through the NNS app, that neuron is controlled exclusively by your 
                        NNS identity. While this is secure, it also means you can't easily transfer the neuron, trade it, 
                        or manage it from other applications.
                    </p>
                    
                    <p style={styles.paragraph}>
                        SNS Jailbreak solves this by adding your Sneed Wallet principal ID as a <strong style={styles.strong}>full controller</strong> to 
                        your neuron. This doesn't remove your NNS control—it simply adds an additional controller with 
                        full permissions, giving you the flexibility to manage your neuron from multiple places.
                    </p>

                    <div style={styles.featureGrid}>
                        <div style={styles.featureCard}>
                            <div style={{ ...styles.featureIcon, background: `${theme.colors.accent}20`, color: theme.colors.accent }}>
                                <FaExchangeAlt />
                            </div>
                            <div style={styles.featureTitle}>Trade Neurons</div>
                            <div style={styles.featureDesc}>
                                List and sell your jailbroken neurons on the Sneedex marketplace
                            </div>
                        </div>
                        <div style={styles.featureCard}>
                            <div style={{ ...styles.featureIcon, background: `${theme.colors.success}20`, color: theme.colors.success }}>
                                <FaKey />
                            </div>
                            <div style={styles.featureTitle}>Full Control</div>
                            <div style={styles.featureDesc}>
                                Vote, stake, disburse, and manage from your Sneed Wallet
                            </div>
                        </div>
                        <div style={styles.featureCard}>
                            <div style={{ ...styles.featureIcon, background: '#9b59b620', color: '#9b59b6' }}>
                                <FaShieldAlt />
                            </div>
                            <div style={styles.featureTitle}>Keep NNS Access</div>
                            <div style={styles.featureDesc}>
                                Your original NNS control remains intact—jailbreaking adds control, doesn't remove it
                            </div>
                        </div>
                    </div>
                </div>

                {/* How It Works */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>How It Works</h2>
                    
                    <p style={styles.paragraph}>
                        The jailbreak process uses a JavaScript script that runs in your browser's developer console 
                        while you're logged into the NNS app. This script calls the SNS governance canister to add 
                        your Sneed Wallet principal as a controller with full permissions.
                    </p>

                    <div style={styles.tipBox}>
                        <FaLightbulb style={{ color: theme.colors.success, flexShrink: 0, marginTop: '2px' }} size={20} />
                        <div>
                            <strong style={styles.strong}>Why a script?</strong> The NNS app doesn't provide a UI to add 
                            controllers with full permissions. Our script uses the same APIs the NNS app uses, just 
                            with the parameters needed to grant full control.
                        </div>
                    </div>

                    <h3 style={styles.subsubheading}>The Jailbreak Process</h3>
                    
                    <div style={styles.stepCard}>
                        <div style={styles.stepHeader}>
                            <span style={styles.stepNumber}>1</span>
                            <span style={styles.stepTitle}>Select Your SNS</span>
                        </div>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            Choose which SNS DAO your neuron belongs to. Only SNSes that support full hotkey permissions 
                            can be jailbroken.
                        </p>
                    </div>

                    <div style={styles.stepCard}>
                        <div style={styles.stepHeader}>
                            <span style={styles.stepNumber}>2</span>
                            <span style={styles.stepTitle}>Select Your Neuron</span>
                        </div>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            Pick the neuron you want to jailbreak. You can select from neurons you've already hotkeyed 
                            to your Sneed Wallet, or enter any neuron ID manually.
                        </p>
                    </div>

                    <div style={styles.stepCard}>
                        <div style={styles.stepHeader}>
                            <span style={styles.stepNumber}>3</span>
                            <span style={styles.stepTitle}>Choose Target Principal</span>
                        </div>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            Your Sneed Wallet principal is pre-selected as the recipient of full control. You can 
                            change this to any principal ID if needed.
                        </p>
                    </div>

                    <div style={styles.stepCard}>
                        <div style={styles.stepHeader}>
                            <span style={styles.stepNumber}>4</span>
                            <span style={styles.stepTitle}>Generate & Run the Script</span>
                        </div>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            The wizard generates a customized JavaScript script. Copy it, then paste and run it in 
                            your browser's developer console while logged into the NNS app.
                        </p>
                    </div>

                    <div style={styles.stepCard}>
                        <div style={styles.stepHeader}>
                            <span style={styles.stepNumber}>5</span>
                            <span style={styles.stepTitle}>Verify Success</span>
                        </div>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            Check that your Sneed Wallet principal now appears as a controller with full permissions 
                            on your neuron. You can verify this on the neuron details page.
                        </p>
                    </div>
                </div>

                {/* Running the Script */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Running the Script</h2>
                    
                    <p style={styles.paragraph}>
                        The script needs to run in your browser's developer console while you're logged into the 
                        NNS app. Here's how to open the console in different browsers:
                    </p>

                    <h3 style={styles.subsubheading}>Opening the Developer Console</h3>
                    
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Chrome / Brave / Edge:</strong> Press <code style={styles.code}>F12</code> or <code style={styles.code}>Ctrl+Shift+J</code> (Windows/Linux) 
                            or <code style={styles.code}>Cmd+Option+J</code> (Mac), then click the "Console" tab
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Firefox:</strong> Press <code style={styles.code}>F12</code> or <code style={styles.code}>Ctrl+Shift+K</code> (Windows/Linux) 
                            or <code style={styles.code}>Cmd+Option+K</code> (Mac), then click the "Console" tab
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Safari:</strong> Enable Developer menu in Safari → Preferences → Advanced, 
                            then press <code style={styles.code}>Cmd+Option+C</code>
                        </li>
                    </ul>

                    <div style={styles.warningBox}>
                        <FaExclamationTriangle style={{ color: theme.colors.warning, flexShrink: 0, marginTop: '2px' }} size={20} />
                        <div>
                            <strong style={styles.strong}>Security Warning:</strong> Only run scripts in your browser console 
                            that you trust. Our jailbreak script is <Link to="https://github.com/Snassy-icp/app_sneeddao/blob/main/resources/sns_jailbreak/base_script.js" target="_blank" style={styles.link}>open source on GitHub</Link> and 
                            you can verify exactly what it does before running it.
                        </div>
                    </div>

                    <h3 style={styles.subsubheading}>Step-by-Step Instructions</h3>
                    
                    <ol style={styles.numberedList}>
                        <li style={styles.listItem}>
                            Go to <Link to="https://nns.ic0.app" target="_blank" style={styles.link}>nns.ic0.app</Link> and 
                            log in with your Internet Identity
                        </li>
                        <li style={styles.listItem}>
                            Open the developer console using one of the methods above
                        </li>
                        <li style={styles.listItem}>
                            Copy the entire script from the Sneed Jailbreak wizard
                        </li>
                        <li style={styles.listItem}>
                            Paste the script into the console and press Enter
                        </li>
                        <li style={styles.listItem}>
                            Wait for the script to complete—you'll see a success or error message
                        </li>
                    </ol>
                </div>

                {/* After Jailbreaking */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>After Jailbreaking</h2>
                    
                    <p style={styles.paragraph}>
                        Once your neuron is jailbroken, you can:
                    </p>

                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Manage from Sneed Wallet:</strong> View, vote, stake maturity, and 
                            disburse your neuron directly from the Sneed app
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>List on Sneedex:</strong> Create an offer to sell your neuron on 
                            the <Link to="/sneedex" style={styles.link}>Sneedex marketplace</Link>
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Transfer Ownership:</strong> Add or remove controllers, transfer 
                            full control to another principal
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Keep Using NNS:</strong> Your original NNS access remains unchanged—you 
                            can still manage the neuron from the NNS app
                        </li>
                    </ul>

                    <div style={styles.tipBox}>
                        <FaCheckCircle style={{ color: theme.colors.success, flexShrink: 0, marginTop: '2px' }} size={20} />
                        <div>
                            <strong style={styles.strong}>Pro Tip:</strong> After jailbreaking, visit your 
                            <Link to="/neurons" style={styles.link}> Neurons page</Link> to see all your neurons 
                            with the Sneed Wallet as controller. You can manage them all from one place!
                        </div>
                    </div>
                </div>

                {/* Supported SNSes */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Supported SNS DAOs</h2>
                    
                    <p style={styles.paragraph}>
                        Not all SNS DAOs support jailbreaking. For the jailbreak to work, the SNS must allow granting 
                        full permissions (including <code style={styles.code}>ManagePrincipals</code>) to hotkeys. This is controlled by 
                        the SNS's <code style={styles.code}>neuron_grantable_permissions</code> parameter.
                    </p>

                    <p style={styles.paragraph}>
                        The jailbreak wizard automatically filters out unsupported SNSes and shows you which ones 
                        can be jailbroken. If your SNS isn't supported, it means the DAO has configured its 
                        governance to restrict full hotkey permissions.
                    </p>

                    <div style={styles.infoBox}>
                        <FaLightbulb style={{ color: theme.colors.accent, flexShrink: 0, marginTop: '2px' }} size={20} />
                        <div>
                            SNS DAOs can choose to enable full hotkey permissions through a governance proposal. 
                            If your favorite SNS doesn't support jailbreaking, consider proposing a parameter 
                            change to the DAO!
                        </div>
                    </div>
                </div>

                {/* FAQ */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Frequently Asked Questions</h2>

                    <h3 style={styles.subsubheading}>Is this safe?</h3>
                    <p style={styles.paragraph}>
                        Yes! The jailbreak script is open source and only adds a controller—it doesn't remove your 
                        existing access or modify your neuron in any other way. You can review the 
                        <Link to="https://github.com/Snassy-icp/app_sneeddao/blob/main/resources/sns_jailbreak/base_script.js" target="_blank" style={styles.link}> source code on GitHub</Link>.
                    </p>

                    <h3 style={styles.subsubheading}>Will I lose my NNS access?</h3>
                    <p style={styles.paragraph}>
                        No. Jailbreaking adds your Sneed Wallet as an additional controller. Your original NNS 
                        control remains fully intact.
                    </p>

                    <h3 style={styles.subsubheading}>Can I undo a jailbreak?</h3>
                    <p style={styles.paragraph}>
                        Yes. Since you have full control from both your NNS identity and your Sneed Wallet, you 
                        can remove any controller you've added. Simply remove the Sneed Wallet principal as a 
                        hotkey to revert to NNS-only control.
                    </p>

                    <h3 style={styles.subsubheading}>Why do I need to run a script?</h3>
                    <p style={styles.paragraph}>
                        The NNS app's UI doesn't provide a way to add controllers with full permissions. The 
                        script uses the same SNS governance APIs that the NNS app uses, just with the specific 
                        parameters needed to grant full control.
                    </p>

                    <h3 style={styles.subsubheading}>Why doesn't my SNS support jailbreaking?</h3>
                    <p style={styles.paragraph}>
                        Each SNS DAO can configure which permissions can be granted to hotkeys. If an SNS doesn't 
                        support jailbreaking, it means the DAO's governance parameters don't allow granting full 
                        permissions like <code style={styles.code}>ManagePrincipals</code> or <code style={styles.code}>ManageVotingPermission</code>.
                    </p>
                </div>

                {/* CTA */}
                <div style={{ textAlign: 'center', marginTop: '3rem' }}>
                    <Link to="/tools/sns_jailbreak" style={styles.ctaButton}>
                        <FaUnlock />
                        Start Jailbreaking
                        <FaArrowRight size={14} />
                    </Link>
                </div>
            </div>
        </div>
    );
}

export default HelpSnsJailbreak;
