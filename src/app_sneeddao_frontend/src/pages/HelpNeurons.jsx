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
        borderLeft: `4px solid ${theme.colors.warning || theme.colors.accent}`,
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
        borderLeft: `4px solid ${theme.colors.success || theme.colors.accent}`,
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
});

function HelpNeurons() {
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
                    <h1 style={styles.heading}>Understanding SNS Neurons</h1>
                    <p style={styles.paragraph}>
                        This guide provides comprehensive information about SNS (Service Nervous System) neurons, how they work, 
                        what you can do with them, and how to manage them effectively using Sneed Hub and the NNS dApp.
                    </p>
                </div>

                {/* Your Sneed Hub Principal */}
                {isAuthenticated && identity && (
                    <div style={{
                        ...styles.successBox,
                        marginBottom: '2rem'
                    }}>
                        <h3 style={{...styles.subsubheading, marginTop: 0}}>
                            Your Sneed Hub Principal
                        </h3>
                        <div style={{
                            background: theme.colors.secondaryBg,
                            padding: '12px',
                            borderRadius: '8px',
                            marginBottom: '12px',
                            marginTop: '12px',
                            fontFamily: 'monospace',
                            fontSize: '14px',
                            wordBreak: 'break-all',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '12px',
                            flexWrap: 'wrap'
                        }}>
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
                                style={{
                                    background: theme.colors.accent,
                                    color: theme.colors.primaryBg,
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '8px 16px',
                                    cursor: 'pointer',
                                    fontSize: '0.85rem',
                                    fontWeight: '500',
                                    transition: 'all 0.2s ease',
                                    whiteSpace: 'nowrap'
                                }}
                                onMouseEnter={(e) => {
                                    e.target.style.background = theme.colors.accentHover || `${theme.colors.accent}dd`;
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.background = theme.colors.accent;
                                }}
                            >
                                Copy
                            </button>
                        </div>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>This is your Sneed Hub principal ID.</strong> Use this when adding hotkeys 
                            to your neurons on the NNS dApp (see instructions below). Copy this principal and paste it into the 
                            "Add Hotkey" field on NNS to enable cross-platform neuron management.
                        </p>
                    </div>
                )}

                {/* What are SNS Neurons? */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>What are SNS Neurons?</h2>
                    <p style={styles.paragraph}>
                        SNS neurons are the core governance mechanism for Service Nervous System DAOs on the Internet Computer. 
                        When you stake tokens in an SNS (like SNEED tokens in Sneed DAO), you create a neuron that represents 
                        your governance power in that DAO.
                    </p>
                    
                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>Key Characteristics:</h3>
                        <ul style={styles.list}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Staked Tokens:</strong> Neurons hold a specific amount of staked tokens that are locked for a minimum dissolve delay period
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Voting Power:</strong> Your voting power is determined by the amount of staked tokens, dissolve delay, and age bonus
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Governance Rights:</strong> Neurons allow you to vote on proposals that shape the direction of the DAO
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Rewards:</strong> Active participation in governance is rewarded with additional tokens
                            </li>
                        </ul>
                    </div>
                </div>

                {/* What Can You Do With SNS Neurons? */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>What Can You Do With SNS Neurons?</h2>
                    
                    <h3 style={styles.subsubheading}>1. Vote on Proposals</h3>
                    <p style={styles.paragraph}>
                        Cast votes on governance proposals to influence decisions about the DAO's treasury, upgrades, 
                        parameter changes, and strategic direction.
                    </p>

                    <h3 style={styles.subsubheading}>2. Follow Other Neurons</h3>
                    <p style={styles.paragraph}>
                        Set up your neuron to automatically follow (copy votes from) other neurons you trust, 
                        ensuring you never miss voting rewards even when you're away.
                    </p>

                    <h3 style={styles.subsubheading}>3. Increase Dissolve Delay</h3>
                    <p style={styles.paragraph}>
                        Extend your neuron's dissolve delay to increase your voting power and demonstrate long-term 
                        commitment to the DAO. Longer dissolve delays result in higher voting power multipliers.
                    </p>

                    <h3 style={styles.subsubheading}>4. Start/Stop Dissolving</h3>
                    <p style={styles.paragraph}>
                        Control when your staked tokens become available. Start dissolving to begin the countdown to 
                        unlock your tokens, or stop dissolving to keep them staked and maintain voting power.
                    </p>

                    <h3 style={styles.subsubheading}>5. Disburse Neurons</h3>
                    <p style={styles.paragraph}>
                        Once a neuron has fully dissolved (dissolve delay reaches zero), you can disburse it to 
                        withdraw your staked tokens plus any accumulated rewards.
                    </p>

                    <h3 style={styles.subsubheading}>6. Add/Remove Hotkeys</h3>
                    <p style={styles.paragraph}>
                        Configure hotkeys (additional principals) that can manage and vote with your neuron without 
                        having the ability to disburse it. This is crucial for using your neurons across multiple platforms.
                    </p>

                    <h3 style={styles.subsubheading}>7. Split Neurons</h3>
                    <p style={styles.paragraph}>
                        Divide a neuron into multiple neurons with different configurations, allowing you to have 
                        varied dissolve delays or delegate voting to different entities.
                    </p>

                    <h3 style={styles.subsubheading}>8. Merge Neurons</h3>
                    <p style={styles.paragraph}>
                        <em style={{ color: theme.colors.mutedText }}>Note: This feature is not currently supported by the SNS API. 
                        The merge neurons permission has been deprecated.</em> Originally intended to combine multiple neurons into 
                        one to simplify management while maintaining the age and dissolve characteristics of the neurons being merged.
                    </p>
                </div>

                {/* Voting on Proposals */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Voting on SNS Proposals</h2>
                    
                    <p style={styles.paragraph}>
                        Sneed Hub makes it easy to participate in governance by voting on proposals. You can review and vote on 
                        proposals through two main pages:
                    </p>

                    <h3 style={styles.subsubheading}>Proposals Page</h3>
                    <p style={styles.paragraph}>
                        The <Link to="/proposals" style={styles.link}>Proposals page</Link> provides a comprehensive list of all 
                        proposals for the currently selected SNS:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Browse All Proposals:</strong> See all active, pending, and past proposals for the selected SNS
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Quick Overview:</strong> View proposal titles, status, voting deadlines, and basic details at a glance
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Filter & Sort:</strong> Find proposals by status, type, or voting deadline
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>SNS-Specific:</strong> Only shows proposals from the SNS selected in the dropdown
                        </li>
                    </ul>

                    <h3 style={styles.subsubheading}>Proposal Detail Page</h3>
                    <p style={styles.paragraph}>
                        The <Link to="/proposal" style={styles.link}>Proposal page</Link> (accessible by clicking on any proposal) 
                        shows detailed information about a specific proposal and allows you to vote:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Full Proposal Details:</strong> Read the complete proposal text, rationale, and technical specifications
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Voting Statistics:</strong> See current vote counts, voting power distribution, and proposal status
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Vote With Your Neurons:</strong> Cast votes using any of your neurons that have voting permissions
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Select Multiple Neurons:</strong> Vote with multiple neurons at once if you have more than one
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Vote History:</strong> See how your neurons have voted on previous proposals
                        </li>
                    </ul>

                    <div style={styles.infoBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>Voting Power Matters:</strong> Each neuron's vote is weighted by its voting power, 
                            which is calculated based on the amount staked, dissolve delay, and neuron age. Neurons with longer dissolve 
                            delays and older ages have more influence on proposal outcomes.
                        </p>
                    </div>
                </div>

                {/* Understanding Hotkeys */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Understanding Hotkeys</h2>
                    
                    <p style={styles.paragraph}>
                        Hotkeys are one of the most powerful features of SNS neurons. A hotkey is an additional principal ID 
                        that can perform most neuron operations (like voting, following, adjusting dissolve delay) without 
                        being able to disburse the neuron or change critical security settings.
                    </p>

                    <div style={styles.infoBox}>
                        <h3 style={styles.subsubheading}>Why Use Hotkeys?</h3>
                        <ul style={styles.list}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Security:</strong> Keep your main principal secure while allowing operational access through a hotkey
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Convenience:</strong> Vote from multiple platforms without exposing your main identity
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Delegation:</strong> Allow trusted parties to manage voting without giving them disbursement rights
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Cross-Platform Access:</strong> Use your neurons seamlessly between the NNS dApp and Sneed Hub
                            </li>
                        </ul>
                    </div>

                    <h3 style={styles.subsubheading}>How to Add Hotkeys on NNS</h3>
                    <ol style={styles.list}>
                        <li style={styles.listItem}>
                            Navigate to the <a href="https://nns.ic0.app" target="_blank" rel="noopener noreferrer" style={styles.link}>NNS dApp</a>
                        </li>
                        <li style={styles.listItem}>
                            Go to the SNS section and select your SNS (e.g., Sneed DAO)
                        </li>
                        <li style={styles.listItem}>
                            Click on the neuron you want to add a hotkey to
                        </li>
                        <li style={styles.listItem}>
                            Find the "Hotkeys" section and click "Add Hotkey"
                        </li>
                        <li style={styles.listItem}>
                            Enter the principal ID you want to add as a hotkey (e.g., your Sneed Hub principal)
                        </li>
                        <li style={styles.listItem}>
                            Confirm the transaction
                        </li>
                    </ol>

                    <div style={styles.warningBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>Important:</strong> To find your Sneed Hub principal ID, 
                            log into Sneed Hub and navigate to the <Link to="/wallet" style={styles.link}>Wallet page</Link> 
                            {' '}or <Link to="/me" style={styles.link}>Me page</Link> where your principal is displayed.
                        </p>
                    </div>
                </div>

                {/* Managing Neurons in Sneed Hub */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Managing SNS Neurons in Sneed Hub</h2>
                    
                    <p style={styles.paragraph}>
                        Sneed Hub provides comprehensive tools for browsing, creating, and managing SNS neurons across multiple pages. 
                        Each page serves a different purpose in your neuron management workflow:
                    </p>

                    <h3 style={styles.subsubheading}>1. Wallet Page</h3>
                    <p style={styles.paragraph}>
                        The <Link to="/wallet" style={styles.link}>Wallet page</Link> is your all-in-one neuron management hub that shows 
                        neurons across all SNSes for which you've added tokens:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>View All Your Neurons:</strong> See all neurons you own across all SNSes that you've added tokens for in your wallet
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Create Neurons:</strong> Stake tokens to create new neurons with your chosen dissolve delay
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Add Stake:</strong> Increase the stake of existing neurons
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Set Dissolve Time:</strong> Adjust dissolve delay settings
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Start/Stop Dissolving:</strong> Control the dissolving state of your neurons
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Disburse:</strong> Withdraw tokens from fully dissolved neurons
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Disburse Maturity:</strong> Claim accumulated voting rewards
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Send Neurons:</strong> Transfer neurons to other users' wallets (a unique Sneed Hub feature not available on the NNS!)
                        </li>
                    </ul>

                    <h3 style={styles.subsubheading}>2. Me Page</h3>
                    <p style={styles.paragraph}>
                        The <Link to="/me" style={styles.link}>Me page</Link> provides a focused view of your neurons for the currently selected SNS:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Your Neurons Only:</strong> See all neurons you own or have hotkey access to for the selected SNS
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>SNS-Specific View:</strong> Filter by the SNS you're currently working with using the SNS selector
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Quick Access:</strong> Jump directly to individual neuron details
                        </li>
                    </ul>

                    <h3 style={styles.subsubheading}>3. Neurons Page (Browse All)</h3>
                    <p style={styles.paragraph}>
                        The <Link to="/neurons" style={styles.link}>Neurons page</Link> is a public browser for exploring all neurons in the selected SNS:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Browse All Neurons:</strong> See all neurons that exist in the currently selected SNS, not just your own
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Research Governance:</strong> Explore how others are voting and which neurons to follow
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Public Information:</strong> View voting power, voting history, and following relationships for any neuron
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>SNS-Specific:</strong> Limited to neurons from the SNS selected in the dropdown
                        </li>
                    </ul>

                    <h3 style={styles.subsubheading}>4. Neuron Detail Page</h3>
                    <p style={styles.paragraph}>
                        The <Link to="/neuron" style={styles.link}>Neuron page</Link> (accessible via <span style={styles.code}>/neuron?neuronid=NEURON_ID</span>) 
                        provides detailed inspection and management of individual neurons:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Inspect Any Neuron:</strong> View comprehensive details about any neuron by ID
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Manage With Permissions:</strong> Perform management operations when you have appropriate permissions
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Edit Permissions:</strong> Configure detailed permissions for hotkeys (voting, proposal creation, neuron management, etc.)
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Edit Following:</strong> Set up and modify which neurons to follow for each proposal type
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Vote on Proposals:</strong> Cast votes with this neuron if you have voting permissions
                        </li>
                    </ul>
                    
                    <div style={styles.warningBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>Note:</strong> Most neuron operations like staking, adding stake, setting dissolve 
                            time, starting/stopping dissolving, disbursing, disbursing maturity, and sending neurons are available on the{' '}
                            <Link to="/wallet" style={styles.link}>Wallet page</Link>. The Neuron detail page focuses on inspection, 
                            permissions management, and following configuration.
                        </p>
                    </div>

                    <div style={styles.infoBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>Unique Sneed Hub Features:</strong> Unlike the NNS dApp, Sneed Hub allows you to 
                            send neurons to other users and configure detailed permissions for hotkeys. The NNS only allows adding hotkeys 
                            with exactly 2 permissions (voting and creating proposals), while Sneed Hub gives you granular control over 
                            each permission type.
                        </p>
                    </div>
                </div>

                {/* Cross-Platform Neuron Management */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Cross-Platform Neuron Management: NNS & Sneed Hub</h2>
                    
                    <p style={styles.paragraph}>
                        One of the most powerful features of SNS neurons is the ability to manage them from multiple platforms. 
                        There are two main approaches to achieve this: using <strong style={styles.strong}>following relationships</strong> (where 
                        neurons automatically copy each other's votes) or using <strong style={styles.strong}>hotkeys</strong> (where you can 
                        directly control neurons from different principals). This section explains both methods and how to set them up for 
                        maximum flexibility between the NNS dApp and Sneed Hub.
                    </p>

                    <h3 style={styles.subsubheading}>Understanding the Setup Scenarios</h3>
                    <p style={styles.paragraph}>
                        Let's say you have two neurons:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Neuron 1:</strong> Created on the NNS dApp with your NNS principal
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Neuron 2:</strong> Created on Sneed Hub with your Sneed Hub principal
                        </li>
                    </ul>

                    <h3 style={styles.subsubheading}>Method 1: Using Following (Recommended for Automated Voting)</h3>
                    <p style={styles.paragraph}>
                        The following approach allows neurons to automatically vote based on how other neurons vote. This is simpler 
                        to set up than hotkeys and doesn't require managing multiple principals.
                    </p>

                    {/* Following Unidirectional */}
                    <div style={styles.scenarioBox}>
                        <h4 style={styles.subsubheading}>Set Up Neuron Following (Unidirectional)</h4>
                        <p style={styles.paragraph}>
                            Configure one neuron to automatically follow and copy the votes of another:
                        </p>
                        <ol style={styles.stepList}>
                            <li style={styles.stepItem}>
                                Decide which neuron will be the "follower" and which will be the "leader"
                            </li>
                            <li style={styles.stepItem}>
                                On Sneed Hub or NNS, navigate to the follower neuron's detail page
                            </li>
                            <li style={styles.stepItem}>
                                Find the "Following" or "Followees" configuration section
                            </li>
                            <li style={styles.stepItem}>
                                Add the leader neuron's ID to the following list for the desired proposal types
                            </li>
                            <li style={styles.stepItem}>
                                Save the configuration
                            </li>
                        </ol>
                        <div style={styles.successBox}>
                            <p style={{...styles.paragraph, marginBottom: 0}}>
                                <strong style={styles.strong}>Result:</strong> When you vote with the leader neuron from either platform, 
                                the follower neuron will automatically vote the same way. This means you only need to vote once, and both 
                                neurons' voting power is applied!
                            </p>
                        </div>
                    </div>

                    {/* Following Bidirectional */}
                    <div style={styles.scenarioBox}>
                        <h4 style={styles.subsubheading}>Set Up Bidirectional Following (Advanced)</h4>
                        <p style={styles.paragraph}>
                            For maximum flexibility, you can set up both neurons to follow each other. The first neuron to vote will 
                            cause the other to automatically vote the same way:
                        </p>
                        <ol style={styles.stepList}>
                            <li style={styles.stepItem}>
                                Configure Neuron 1 to follow Neuron 2 (for all proposal types or specific types)
                            </li>
                            <li style={styles.stepItem}>
                                Configure Neuron 2 to follow Neuron 1 (for the same proposal types)
                            </li>
                            <li style={styles.stepItem}>
                                Now both neurons follow each other
                            </li>
                        </ol>
                        <div style={styles.successBox}>
                            <p style={{...styles.paragraph, marginBottom: 0}}>
                                <strong style={styles.strong}>Result:</strong> You can vote with either neuron from either platform (NNS or Sneed Hub), 
                                and the other neuron will automatically cast the same vote. This gives you complete flexibility - vote from wherever 
                                you're logged in, and both neurons will vote together!
                            </p>
                        </div>
                    </div>

                    <div style={styles.infoBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>Why Use Following?</strong> Following is ideal when you want automatic voting 
                            synchronization between neurons. You don't need to manage multiple principals or hotkeys, and it ensures your 
                            full voting power is always applied with a single vote. This is particularly useful if you have neurons across 
                            different platforms or want to ensure consistent voting without manual effort.
                        </p>
                    </div>

                    <h3 style={styles.subsubheading}>Method 2: Using Hotkeys (For Direct Control)</h3>
                    <p style={styles.paragraph}>
                        The hotkey approach gives you direct control over neurons created with different principals. This is useful when 
                        you want to manage neurons individually or need more granular control.
                    </p>

                    {/* Hotkey Scenario 1 */}
                    <div style={styles.scenarioBox}>
                        <h4 style={styles.subsubheading}>Hotkey Setup 1: Vote with Both Neurons from Sneed Hub</h4>
                        <p style={styles.paragraph}>
                            To access and vote with Neuron 1 (created on NNS) from Sneed Hub:
                        </p>
                        <ol style={styles.stepList}>
                            <li style={styles.stepItem}>
                                Get your Sneed Hub principal ID from the <Link to="/wallet" style={styles.link}>Wallet</Link> or 
                                {' '}<Link to="/me" style={styles.link}>Me</Link> page
                            </li>
                            <li style={styles.stepItem}>
                                Go to the <a href="https://nns.ic0.app" target="_blank" rel="noopener noreferrer" style={styles.link}>NNS dApp</a>
                            </li>
                            <li style={styles.stepItem}>
                                Select your SNS and navigate to Neuron 1
                            </li>
                            <li style={styles.stepItem}>
                                Add your Sneed Hub principal as a hotkey to Neuron 1
                            </li>
                            <li style={styles.stepItem}>
                                Return to Sneed Hub and refresh the <Link to="/wallet" style={styles.link}>Wallet page</Link>
                            </li>
                            <li style={styles.stepItem}>
                                You will now see both Neuron 1 and Neuron 2, and can vote with both from Sneed Hub!
                            </li>
                        </ol>
                        <div style={styles.successBox}>
                            <p style={{...styles.paragraph, marginBottom: 0}}>
                                <strong style={styles.strong}>Result:</strong> You can now manage and vote with both neurons 
                                directly from Sneed Hub, enjoying a unified interface for all your governance activities.
                            </p>
                        </div>
                    </div>

                    {/* Hotkey Scenario 2 */}
                    <div style={styles.scenarioBox}>
                        <h4 style={styles.subsubheading}>Hotkey Setup 2: Vote with Both Neurons from NNS</h4>
                        <p style={styles.paragraph}>
                            To access and vote with Neuron 2 (created on Sneed Hub) from the NNS dApp:
                        </p>
                        <ol style={styles.stepList}>
                            <li style={styles.stepItem}>
                                Get your NNS principal ID from the NNS dApp
                            </li>
                            <li style={styles.stepItem}>
                                Go to Sneed Hub and navigate to the <Link to="/wallet" style={styles.link}>Wallet page</Link>
                            </li>
                            <li style={styles.stepItem}>
                                Find Neuron 2 and access its detail view
                            </li>
                            <li style={styles.stepItem}>
                                In the neuron management section, add your NNS principal as a hotkey
                            </li>
                            <li style={styles.stepItem}>
                                Return to the NNS dApp and refresh
                            </li>
                            <li style={styles.stepItem}>
                                You will now see both Neuron 1 and Neuron 2 in the NNS interface!
                            </li>
                        </ol>
                        <div style={styles.successBox}>
                            <p style={{...styles.paragraph, marginBottom: 0}}>
                                <strong style={styles.strong}>Result:</strong> You can now manage and vote with both neurons 
                                from the NNS dApp interface.
                            </p>
                        </div>
                    </div>

                    {/* Hotkey Scenario 3 */}
                    <div style={styles.scenarioBox}>
                        <h4 style={styles.subsubheading}>Hotkey Setup 3: Vote from Both Platforms (Maximum Flexibility)</h4>
                        <p style={styles.paragraph}>
                            For maximum flexibility, you can set up bidirectional hotkey access by combining both setups above:
                        </p>
                        <ol style={styles.stepList}>
                            <li style={styles.stepItem}>
                                Follow Hotkey Setup 1 to add your Sneed Hub principal as a hotkey to Neuron 1 (on NNS)
                            </li>
                            <li style={styles.stepItem}>
                                Follow Hotkey Setup 2 to add your NNS principal as a hotkey to Neuron 2 (on Sneed Hub)
                            </li>
                            <li style={styles.stepItem}>
                                Now both neurons have both principals as hotkeys
                            </li>
                        </ol>
                        <div style={styles.successBox}>
                            <p style={{...styles.paragraph, marginBottom: 0}}>
                                <strong style={styles.strong}>Result:</strong> You can now vote with both neurons from either 
                                the NNS dApp or Sneed Hub, whichever is more convenient at the moment. Vote from wherever you 
                                happen to be logged in!
                            </p>
                        </div>
                    </div>

                    <div style={styles.infoBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>Following vs. Hotkeys:</strong> Following is simpler and provides automatic 
                            vote synchronization (one vote applies both neurons), while hotkeys give you direct individual control over 
                            each neuron. You can even combine both approaches - use hotkeys for direct access and following for automatic 
                            voting synchronization!
                        </p>
                    </div>

                    <div style={styles.warningBox}>
                        <h4 style={styles.subsubheading}>Security Considerations</h4>
                        <ul style={styles.list}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Be Extremely Careful With Permissions:</strong> On Sneed Hub, you have full control 
                                over which permissions you grant to hotkeys. Unlike the NNS (which only allows hotkeys with voting and proposal 
                                creation permissions), Sneed Hub lets you grant any combination of permissions, including disbursement rights.
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>NNS Hotkeys are Limited:</strong> Hotkeys created on the NNS dApp are restricted 
                                to voting and creating proposals only - they cannot disburse neurons or modify critical security settings.
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Sneed Hub Hotkeys are Flexible:</strong> When adding hotkeys on Sneed Hub, YOU choose 
                                what permissions to grant. Only grant disburse permissions to principals you completely trust and control.
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Only Trust Yourself:</strong> Only add principals you personally control as hotkeys. 
                                Never add someone else's principal with powerful permissions like disbursement.
                            </li>
                            <li style={styles.listItem}>
                                You can remove hotkeys at any time if needed, so review your hotkey configurations regularly
                            </li>
                        </ul>
                    </div>
                </div>

                {/* Best Practices */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Best Practices for Neuron Management</h2>
                    
                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>1. Set Up Following for Automated Voting</h3>
                        <p style={styles.paragraph}>
                            Configure your neurons to follow trusted neurons to ensure you never miss voting rewards, even when 
                            you're unavailable to vote manually.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>2. Use Multiple Neurons for Flexibility</h3>
                        <p style={styles.paragraph}>
                            Consider splitting your stake into multiple neurons with different dissolve delays. This gives you 
                            flexibility to access some funds earlier while maintaining long-term voting power with others.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>3. Keep Track of Your Neurons</h3>
                        <p style={styles.paragraph}>
                            Regularly check your neurons on the <Link to="/wallet" style={styles.link}>Wallet page</Link> or{' '}
                            <Link to="/me" style={styles.link}>Me page</Link> to monitor their status, voting power, and any pending actions.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>4. Participate Actively in Governance</h3>
                        <p style={styles.paragraph}>
                            Active voting not only earns you rewards but also helps shape the future of the DAO. Review proposals 
                            carefully and vote according to what you believe is best for the community.
                        </p>
                    </div>
                </div>

                {/* Common Questions */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Common Questions</h2>
                    
                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>Can I increase my neuron's stake after creation?</h3>
                        <p style={styles.paragraph}>
                            Yes! You can increase a neuron's stake by creating a new neuron with additional tokens and then 
                            merging it with your existing neuron. Both neurons must have compatible settings (dissolve state) 
                            to be merged.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>What happens to my rewards?</h3>
                        <p style={styles.paragraph}>
                            Voting rewards accumulate as "maturity" in your neuron. You can optionally add this maturity back to your 
                            neuron's stake (increasing its voting power), or you can disburse the maturity to claim your rewards as 
                            liquid tokens. Sneed Hub provides UI options in the <Link to="/wallet" style={styles.link}>Wallet page</Link> to 
                            manage your maturity, including disbursing it to your wallet.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>Can I decrease my dissolve delay?</h3>
                        <p style={styles.paragraph}>
                            You cannot directly decrease the dissolve delay. However, you can start dissolving your neuron, which 
                            begins the countdown. Once dissolving is started, the dissolve delay decreases automatically over time 
                            until it reaches zero.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>What if I lose access to my principal?</h3>
                        <p style={styles.paragraph}>
                            If you lose access to your principal ID, you will not be able to manage or disburse your neurons. 
                            This is why it's crucial to securely back up your identity (seed phrase or Internet Identity) and 
                            consider setting up hotkeys as a backup access method.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>Why don't I see all my neurons on Sneed Hub?</h3>
                        <p style={styles.paragraph}>
                            The <Link to="/wallet" style={styles.link}>Wallet</Link> and <Link to="/me" style={styles.link}>Me</Link> pages 
                            display neurons where your current principal is either the controller or a hotkey. If you created a neuron on NNS 
                            and haven't added your Sneed Hub principal as a hotkey, it won't appear on these pages. Follow Scenario 1 above to 
                            make NNS neurons visible on Sneed Hub. Note that the <Link to="/neurons" style={styles.link}>Neurons page</Link> shows 
                            all neurons in the selected SNS, not just yours.
                        </p>
                    </div>
                </div>

                {/* Getting Help */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Need More Help?</h2>
                    <p style={styles.paragraph}>
                        If you have questions or encounter issues with neuron management:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            Visit our <Link to="/forum" style={styles.link}>Forum</Link> to ask questions and discuss with other users
                        </li>
                        <li style={styles.listItem}>
                            Check out the official <a href="https://wiki.internetcomputer.org/wiki/Service_Nervous_System_(SNS)" target="_blank" rel="noopener noreferrer" style={styles.link}>SNS documentation</a>
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

export default HelpNeurons;

