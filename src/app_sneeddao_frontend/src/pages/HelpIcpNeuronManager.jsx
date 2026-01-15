import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';

// Theme-aware styles function
const getStyles = (theme) => ({
    container: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '2rem',
        color: theme.colors.primaryText,
    },
    section: {
        backgroundColor: theme.colors.secondaryBg,
        borderRadius: '8px',
        padding: '2rem',
        marginBottom: '2rem',
    },
    heading: {
        fontSize: '2.5rem',
        marginBottom: '1.5rem',
        color: theme.colors.primaryText,
    },
    subheading: {
        fontSize: '1.8rem',
        marginBottom: '1rem',
        color: theme.colors.primaryText,
        marginTop: '1.5rem',
    },
    subsubheading: {
        fontSize: '1.4rem',
        marginBottom: '0.8rem',
        color: theme.colors.primaryText,
        marginTop: '1rem',
    },
    paragraph: {
        marginBottom: '1rem',
        lineHeight: '1.6',
        color: theme.colors.secondaryText,
        fontSize: '1.1rem',
    },
    list: {
        marginLeft: '2rem',
        marginBottom: '1rem',
    },
    listItem: {
        marginBottom: '0.8rem',
        color: theme.colors.secondaryText,
        fontSize: '1.1rem',
        lineHeight: '1.6',
    },
    highlight: {
        backgroundColor: theme.colors.tertiaryBg,
        padding: '1.5rem',
        borderRadius: '8px',
        marginBottom: '1.5rem',
    },
    warningBox: {
        backgroundColor: theme.colors.warningBg || theme.colors.tertiaryBg,
        padding: '1.5rem',
        borderRadius: '8px',
        marginBottom: '1.5rem',
        borderLeft: `4px solid ${theme.colors.warning || '#f59e0b'}`,
    },
    infoBox: {
        backgroundColor: theme.colors.infoBg || theme.colors.tertiaryBg,
        padding: '1.5rem',
        borderRadius: '8px',
        marginBottom: '1.5rem',
        borderLeft: `4px solid ${theme.colors.info || theme.colors.accent}`,
    },
    successBox: {
        backgroundColor: theme.colors.successBg || theme.colors.tertiaryBg,
        padding: '1.5rem',
        borderRadius: '8px',
        marginBottom: '1.5rem',
        borderLeft: `4px solid ${theme.colors.success || '#22c55e'}`,
    },
    strong: {
        color: theme.colors.accent,
        fontWeight: 'bold',
    },
    code: {
        backgroundColor: theme.colors.tertiaryBg,
        padding: '0.2rem 0.5rem',
        borderRadius: '4px',
        fontFamily: 'monospace',
        fontSize: '0.95rem',
    },
    link: {
        color: theme.colors.accent,
        textDecoration: 'none',
    },
    scenarioBox: {
        backgroundColor: theme.colors.tertiaryBg,
        padding: '1.5rem',
        borderRadius: '8px',
        marginBottom: '1rem',
    },
    stepList: {
        marginLeft: '2rem',
        marginTop: '1rem',
    },
    stepItem: {
        marginBottom: '0.8rem',
        color: theme.colors.secondaryText,
        fontSize: '1.05rem',
        lineHeight: '1.6',
    },
    featureCard: {
        backgroundColor: theme.colors.tertiaryBg,
        padding: '1.5rem',
        borderRadius: '8px',
        marginBottom: '1rem',
        border: `1px solid ${theme.colors.border}`,
    },
});

function HelpIcpNeuronManager() {
    const { theme } = useTheme();
    const { isAuthenticated, identity } = useAuth();
    const styles = getStyles(theme);

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={styles.container}>
                {/* Back to Help */}
                <div style={{ marginBottom: '1.5rem' }}>
                    <Link 
                        to="/help" 
                        style={styles.link}
                        onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                        onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                    >
                        ← Back to Help
                    </Link>
                </div>

                {/* Main Title */}
                <div style={styles.section}>
                    <h1 style={styles.heading}>ICP Neuron Manager Canisters</h1>
                    <p style={styles.paragraph}>
                        This guide explains how ICP Neuron Manager canisters work, how to create and manage them, 
                        and how they enable secure, decentralized management of ICP neurons on the Network Nervous System (NNS).
                    </p>
                </div>

                {/* What is an ICP Neuron Manager? */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>What is an ICP Neuron Manager?</h2>
                    <p style={styles.paragraph}>
                        An ICP Neuron Manager is a <strong style={styles.strong}>smart contract (canister)</strong> deployed on the 
                        Internet Computer that acts as the controller of your ICP neurons. Instead of your personal wallet directly 
                        controlling neurons, the canister becomes the neuron controller, and you control the canister.
                    </p>
                    
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '2rem',
                        marginBottom: '1.5rem',
                    }}>
                        {/* Your Wallet Box */}
                        <div style={{
                            backgroundColor: theme.colors.tertiaryBg,
                            border: `2px solid ${theme.colors.accent}`,
                            borderRadius: '12px',
                            padding: '16px 32px',
                            textAlign: 'center',
                            minWidth: '280px',
                        }}>
                            <div style={{ color: theme.colors.accent, fontWeight: 'bold', fontSize: '1.1rem' }}>
                                Your Wallet
                            </div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                (Controller of the Canister)
                            </div>
                        </div>
                        
                        {/* Arrow down */}
                        <div style={{ 
                            display: 'flex', 
                            flexDirection: 'column', 
                            alignItems: 'center',
                            color: theme.colors.mutedText,
                        }}>
                            <div style={{ fontSize: '0.85rem', marginBottom: '4px' }}>controls</div>
                            <div style={{ fontSize: '1.5rem' }}>↓</div>
                        </div>
                        
                        {/* Canister Box */}
                        <div style={{
                            backgroundColor: theme.colors.tertiaryBg,
                            border: `2px solid ${theme.colors.accent}`,
                            borderRadius: '12px',
                            padding: '16px 32px',
                            textAlign: 'center',
                            minWidth: '280px',
                        }}>
                            <div style={{ color: theme.colors.accent, fontWeight: 'bold', fontSize: '1.1rem' }}>
                                ICP Neuron Manager Canister
                            </div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                (On-chain smart contract)
                            </div>
                        </div>
                        
                        {/* Arrow down */}
                        <div style={{ 
                            display: 'flex', 
                            flexDirection: 'column', 
                            alignItems: 'center',
                            color: theme.colors.mutedText,
                        }}>
                            <div style={{ fontSize: '0.85rem', marginBottom: '4px' }}>controls</div>
                            <div style={{ fontSize: '1.5rem' }}>↓</div>
                        </div>
                        
                        {/* Neurons Box */}
                        <div style={{
                            backgroundColor: theme.colors.tertiaryBg,
                            border: `2px solid ${theme.colors.accent}`,
                            borderRadius: '12px',
                            padding: '16px 32px',
                            textAlign: 'center',
                            minWidth: '280px',
                        }}>
                            <div style={{ color: theme.colors.accent, fontWeight: 'bold', fontSize: '1.1rem' }}>
                                ICP Neurons
                            </div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                (Staked on NNS Governance)
                            </div>
                        </div>
                    </div>

                    <div style={styles.infoBox}>
                        <h3 style={{...styles.subsubheading, marginTop: 0}}>Key Benefits</h3>
                        <ul style={styles.list}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Decentralized Control:</strong> Your neurons are controlled by 
                                on-chain code, not a centralized service
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Multi-Controller Support:</strong> Multiple wallets can control 
                                the same canister (and thus the same neurons)
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Programmable:</strong> The canister can automate neuron management 
                                and implement custom logic
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Upgradeable:</strong> The canister code can be upgraded to add 
                                new features while preserving your neurons
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Transparent:</strong> All operations are on-chain and auditable
                            </li>
                        </ul>
                    </div>
                </div>

                {/* How to Create a Neuron Manager */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Creating a Neuron Manager</h2>
                    <p style={styles.paragraph}>
                        Creating an ICP Neuron Manager is simple and can be done directly from Sneed Hub:
                    </p>

                    <div style={styles.scenarioBox}>
                        <h3 style={{...styles.subsubheading, marginTop: 0}}>Steps to Create</h3>
                        <ol style={styles.stepList}>
                            <li style={styles.stepItem}>
                                Navigate to the <Link to="/create_icp_neuron" style={styles.link}>Create ICP Neuron</Link> page
                            </li>
                            <li style={styles.stepItem}>
                                Click "Pay" to send the required ICP creation fee
                            </li>
                            <li style={styles.stepItem}>
                                Once payment is confirmed, click "Create" to deploy your new canister
                            </li>
                            <li style={styles.stepItem}>
                                Your new canister will be created with you as the controller
                            </li>
                            <li style={styles.stepItem}>
                                The factory will automatically fund the canister with cycles for operation
                            </li>
                        </ol>
                    </div>

                    <div style={styles.infoBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>What You Get:</strong> A dedicated canister on the Internet Computer 
                            that you fully control. The canister comes pre-funded with cycles and is ready to create and manage 
                            ICP neurons immediately.
                        </p>
                    </div>
                </div>

                {/* Managing Your Canister */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Managing Your Canister</h2>
                    
                    <p style={styles.paragraph}>
                        Once created, you can access your neuron manager from multiple locations:
                    </p>

                    <h3 style={styles.subsubheading}>Access Points</h3>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Wallet Page:</strong> The <Link to="/wallet" style={styles.link}>Wallet</Link> page 
                            shows all your ICP Neuron Managers in a dedicated section with quick access to manage them
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Canisters Page:</strong> The <Link to="/canisters" style={styles.link}>Canisters</Link> page 
                            lists all your neuron managers under "ICP Neuron Managers"
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Direct URL:</strong> Access any manager directly at{' '}
                            <span style={styles.code}>/icp_neuron_manager/CANISTER_ID</span>
                        </li>
                    </ul>

                    <h3 style={styles.subsubheading}>Canister Information</h3>
                    <p style={styles.paragraph}>
                        The neuron manager page shows important information about your canister:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Canister ID:</strong> The unique identifier for your canister on the IC
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>ICP Balance:</strong> ICP held by the canister (for staking new neurons)
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Cycles Balance:</strong> Computational resources for canister operation
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Memory Usage:</strong> How much memory the canister is using
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Module Hash:</strong> The WASM hash of the installed code (for version verification)
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Version:</strong> The current software version
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Controllers:</strong> The principals that can control the canister
                        </li>
                    </ul>
                </div>

                {/* Creating and Managing Neurons */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Creating and Managing Neurons</h2>
                    
                    <p style={styles.paragraph}>
                        Your neuron manager canister interacts with the NNS governance canister to create and manage ICP neurons.
                    </p>

                    <h3 style={styles.subsubheading}>Creating a Neuron</h3>
                    <div style={styles.scenarioBox}>
                        <ol style={styles.stepList}>
                            <li style={styles.stepItem}>
                                <strong style={styles.strong}>Fund the Canister:</strong> Send ICP to your canister's address 
                                (displayed on the management page)
                            </li>
                            <li style={styles.stepItem}>
                                <strong style={styles.strong}>Set Stake Amount:</strong> Enter how much ICP to stake (minimum 1 ICP)
                            </li>
                            <li style={styles.stepItem}>
                                <strong style={styles.strong}>Set Dissolve Delay:</strong> Choose the initial lock-up period 
                                (minimum 6 months for voting rewards)
                            </li>
                            <li style={styles.stepItem}>
                                <strong style={styles.strong}>Create:</strong> The canister transfers ICP to NNS and creates the neuron
                            </li>
                        </ol>
                    </div>

                    <h3 style={styles.subsubheading}>Neuron Operations</h3>
                    <p style={styles.paragraph}>
                        Once you have neurons, you can perform all standard NNS operations through your manager:
                    </p>

                    <div style={styles.featureCard}>
                        <h4 style={{...styles.subsubheading, marginTop: 0}}>🔒 Dissolve Management</h4>
                        <ul style={styles.list}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Start Dissolving:</strong> Begin the countdown to unlock your stake
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Stop Dissolving:</strong> Pause the countdown and maintain voting power
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Increase Dissolve Delay:</strong> Extend lock-up for more voting power
                            </li>
                        </ul>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{...styles.subsubheading, marginTop: 0}}>🗳️ Voting & Following</h4>
                        <ul style={styles.list}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Vote on Proposals:</strong> Cast votes on NNS governance proposals
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Set Following:</strong> Configure neurons to follow for automatic voting
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Follow by Topic:</strong> Set different followees for different proposal topics
                            </li>
                        </ul>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{...styles.subsubheading, marginTop: 0}}>💰 Stake & Rewards</h4>
                        <ul style={styles.list}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Increase Stake:</strong> Add more ICP to an existing neuron
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Spawn Maturity:</strong> Convert accumulated rewards into new neurons
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Disburse Maturity:</strong> Convert rewards to liquid ICP
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Disburse:</strong> Withdraw stake from fully dissolved neurons
                            </li>
                        </ul>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{...styles.subsubheading, marginTop: 0}}>🔑 Hotkey Management</h4>
                        <ul style={styles.list}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Add Hotkeys:</strong> Allow other principals to vote with your neurons
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Remove Hotkeys:</strong> Revoke access from principals
                            </li>
                        </ul>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{...styles.subsubheading, marginTop: 0}}>✂️ Advanced Operations</h4>
                        <ul style={styles.list}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Split Neuron:</strong> Divide one neuron into multiple neurons
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Merge Neurons:</strong> Combine multiple neurons into one
                            </li>
                        </ul>
                    </div>
                </div>

                {/* Controllers and Security */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Controllers and Security</h2>
                    
                    <p style={styles.paragraph}>
                        The canister uses the Internet Computer's built-in controller system for access control. 
                        Only principals listed as controllers can perform management operations.
                    </p>

                    <h3 style={styles.subsubheading}>Managing Controllers</h3>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Add Controller:</strong> Grant another principal full control 
                            of the canister and its neurons
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Remove Controller:</strong> Revoke a principal's control 
                            (requires at least one controller to remain)
                        </li>
                    </ul>

                    <div style={styles.warningBox}>
                        <h3 style={{...styles.subsubheading, marginTop: 0}}>⚠️ Important Security Considerations</h3>
                        <ul style={styles.list}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Controllers have full power:</strong> Anyone listed as a controller 
                                can perform any operation, including adding/removing other controllers and managing neurons
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Never remove yourself:</strong> Removing yourself as the last 
                                controller will make the canister permanently uncontrollable
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Only add trusted principals:</strong> Only add principals you 
                                fully control or completely trust as controllers
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Backup access:</strong> Consider adding a backup principal you 
                                control as a second controller for recovery purposes
                            </li>
                        </ul>
                    </div>

                    <h3 style={styles.subsubheading}>Transferring Ownership</h3>
                    <p style={styles.paragraph}>
                        You can transfer full control of your neuron manager to another principal:
                    </p>
                    <ol style={styles.stepList}>
                        <li style={styles.stepItem}>
                            Add the new owner's principal as a controller
                        </li>
                        <li style={styles.stepItem}>
                            Have the new owner verify they can access the canister
                        </li>
                        <li style={styles.stepItem}>
                            Remove yourself as a controller
                        </li>
                    </ol>
                    <p style={styles.paragraph}>
                        The <Link to="/wallet" style={styles.link}>Wallet page</Link> provides a convenient "Transfer" button 
                        that automates this process.
                    </p>
                </div>

                {/* Cycles and Maintenance */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Cycles and Canister Maintenance</h2>
                    
                    <p style={styles.paragraph}>
                        Like all canisters on the Internet Computer, your neuron manager requires cycles to operate. 
                        Cycles are consumed when the canister executes operations.
                    </p>

                    <h3 style={styles.subsubheading}>Monitoring Cycles</h3>
                    <p style={styles.paragraph}>
                        The canister management page displays your current cycles balance. Keep an eye on this to ensure 
                        your canister remains operational.
                    </p>

                    <h3 style={styles.subsubheading}>Topping Up Cycles</h3>
                    <p style={styles.paragraph}>
                        You can add more cycles to your canister by sending ICP through the Cycles Minting Canister (CMC):
                    </p>
                    <ol style={styles.stepList}>
                        <li style={styles.stepItem}>
                            Navigate to your neuron manager page
                        </li>
                        <li style={styles.stepItem}>
                            Find the "Top Up Cycles" section in the canister info
                        </li>
                        <li style={styles.stepItem}>
                            Enter the amount of ICP to convert to cycles
                        </li>
                        <li style={styles.stepItem}>
                            The ICP is sent to CMC and cycles are credited to your canister
                        </li>
                    </ol>

                    <div style={styles.infoBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>Cycles Rate:</strong> The ICP to cycles conversion rate is determined 
                            by the CMC based on current XDR rates. The UI shows the estimated cycles you'll receive.
                        </p>
                    </div>
                </div>

                {/* Version Management and Upgrades */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Version Management and Upgrades</h2>
                    
                    <p style={styles.paragraph}>
                        Your neuron manager canister runs open-source code that can be verified and upgraded.
                    </p>

                    <h3 style={styles.subsubheading}>Version Verification</h3>
                    <p style={styles.paragraph}>
                        Each canister has a <strong style={styles.strong}>module hash</strong> - a cryptographic fingerprint 
                        of the installed WASM code. This allows you to verify that your canister is running official code:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>✓ Official:</strong> If your module hash matches a known official 
                            version, a green checkmark and version number are displayed
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>⚠ Unverified:</strong> If the hash doesn't match any known version, 
                            a warning is shown (this could mean custom code or an outdated version)
                        </li>
                    </ul>

                    <h3 style={styles.subsubheading}>One-Click Upgrades</h3>
                    <p style={styles.paragraph}>
                        When a new official version is available, you'll see an "Upgrade Available" notification:
                    </p>
                    <div style={styles.successBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>🚀 Easy Upgrades:</strong> Simply click the "Upgrade Now" button to 
                            automatically download and install the latest official version. Your neurons and data are preserved 
                            during the upgrade.
                        </p>
                    </div>

                    <h3 style={styles.subsubheading}>Manual Upgrades</h3>
                    <p style={styles.paragraph}>
                        For advanced users, the <Link to="/canister" style={styles.link}>Canister</Link> page provides 
                        manual upgrade options:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Upload WASM:</strong> Upload a WASM file directly
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>WASM URL:</strong> Provide a URL to download and install a WASM
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Upgrade vs Reinstall:</strong> Choose between preserving state (upgrade) 
                            or starting fresh (reinstall)
                        </li>
                    </ul>

                    <div style={styles.warningBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>Caution with Manual Upgrades:</strong> Only install code from trusted 
                            sources. Installing malicious or buggy code could result in loss of control over your neurons.
                        </p>
                    </div>
                </div>

                {/* FAQ */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Frequently Asked Questions</h2>
                    
                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>Why use a canister instead of controlling neurons directly?</h3>
                        <p style={styles.paragraph}>
                            Using a canister provides several advantages: multi-controller support, potential for automation, 
                            upgradeability, and the ability to transfer control of all neurons by changing canister controllers 
                            rather than each neuron individually.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>What happens if my canister runs out of cycles?</h3>
                        <p style={styles.paragraph}>
                            If a canister runs out of cycles, it will stop responding to calls. Your neurons remain safe on 
                            the NNS - you just won't be able to manage them until you top up the canister with more cycles. 
                            Monitor your cycles balance regularly and top up before it gets too low.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>Can I have multiple neuron managers?</h3>
                        <p style={styles.paragraph}>
                            Yes! You can create as many neuron manager canisters as you want. This might be useful for 
                            separating different sets of neurons, having different controller configurations, or other 
                            organizational purposes.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>How do I see which neurons my canister controls?</h3>
                        <p style={styles.paragraph}>
                            The canister queries the NNS governance canister to list all neurons where your canister is 
                            the controller. This list is displayed in the "Neurons" section of the management page.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>Is my data safe during upgrades?</h3>
                        <p style={styles.paragraph}>
                            Yes! When using the "Upgrade" mode (not "Reinstall"), the canister's stable memory is preserved. 
                            Your neurons are stored on the NNS, not in the canister, so they're always safe regardless of 
                            what happens to the canister.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>Can someone else control my neurons if they're not a controller?</h3>
                        <p style={styles.paragraph}>
                            No. Only principals listed as controllers of the canister can issue commands to manage neurons. 
                            The canister uses the IC's built-in controller mechanism which is enforced at the protocol level.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>Where can I see the source code?</h3>
                        <p style={styles.paragraph}>
                            Official versions include links to the source code. Look for the "View Source" link next to the 
                            version information on the canister management page. You can review the code and verify that 
                            the WASM hash matches the published source.
                        </p>
                    </div>
                </div>

                {/* Getting Started */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Getting Started</h2>
                    
                    <p style={styles.paragraph}>
                        Ready to create your own ICP Neuron Manager? Here's how to get started:
                    </p>

                    <div style={styles.successBox}>
                        <ol style={styles.stepList}>
                            <li style={styles.stepItem}>
                                <strong style={styles.strong}>Create a Manager:</strong> Visit the{' '}
                                <Link to="/create_icp_neuron" style={styles.link}>Create ICP Neuron</Link> page 
                                to deploy your canister
                            </li>
                            <li style={styles.stepItem}>
                                <strong style={styles.strong}>Fund It:</strong> Send ICP to your canister's address
                            </li>
                            <li style={styles.stepItem}>
                                <strong style={styles.strong}>Create Neurons:</strong> Stake ICP to create neurons with 
                                your desired dissolve delay
                            </li>
                            <li style={styles.stepItem}>
                                <strong style={styles.strong}>Set Up Following:</strong> Configure automatic voting to 
                                earn rewards
                            </li>
                            <li style={styles.stepItem}>
                                <strong style={styles.strong}>Participate:</strong> Vote on proposals and watch your 
                                rewards grow!
                            </li>
                        </ol>
                    </div>
                </div>

                {/* Need More Help */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Need More Help?</h2>
                    <p style={styles.paragraph}>
                        If you have questions or encounter issues:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            Visit our <Link to="/forum" style={styles.link}>Forum</Link> to ask questions and discuss with other users
                        </li>
                        <li style={styles.listItem}>
                            Check out the official{' '}
                            <a href="https://wiki.internetcomputer.org/wiki/Network_Nervous_System" 
                               target="_blank" rel="noopener noreferrer" style={styles.link}>
                                NNS documentation
                            </a>
                        </li>
                        <li style={styles.listItem}>
                            Learn more about{' '}
                            <Link to="/help/neurons" style={styles.link}>SNS Neurons</Link> for comparison with 
                            DAO-specific neurons
                        </li>
                    </ul>
                </div>

                {/* Back to Help */}
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                    <Link 
                        to="/help" 
                        style={{...styles.link, fontSize: '1.2rem'}}
                        onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                        onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                    >
                        ← Back to Help Center
                    </Link>
                </div>
            </main>
        </div>
    );
}

export default HelpIcpNeuronManager;

