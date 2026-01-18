import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';

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
    featureCard: {
        backgroundColor: theme.colors.tertiaryBg,
        padding: '1.5rem',
        borderRadius: '8px',
        marginBottom: '1rem',
        border: `1px solid ${theme.colors.border}`,
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
    statusLamp: {
        display: 'inline-block',
        width: '12px',
        height: '12px',
        borderRadius: '50%',
        marginRight: '8px',
    },
});

function HelpCanisterManager() {
    const { theme } = useTheme();
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
                    <h1 style={styles.heading}>📦 Canister Manager</h1>
                    <p style={styles.paragraph}>
                        The Canister Manager helps you track, organize, and monitor all your canisters on the Internet Computer.
                        Whether you're managing ICP Neuron Managers, custom canisters, or any other smart contracts, 
                        the Canister Manager provides a unified dashboard for oversight.
                    </p>
                    
                    <div style={styles.infoBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>Premium Feature:</strong> Custom canister tracking is available 
                            exclusively to Sneed DAO staking members. ICP Neuron Managers are always visible to all users.
                        </p>
                    </div>
                </div>

                {/* Overview */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Overview</h2>
                    <p style={styles.paragraph}>
                        The Canister Manager consists of two main pages:
                    </p>
                    
                    <div style={styles.featureCard}>
                        <h3 style={{...styles.subsubheading, marginTop: 0}}>
                            📋 <Link to="/canisters" style={styles.link}>Canister Manager</Link> (/canisters)
                        </h3>
                        <p style={styles.paragraph}>
                            The main dashboard showing all your tracked canisters. Features include:
                        </p>
                        <ul style={styles.list}>
                            <li style={styles.listItem}>ICP Neuron Managers section with version tracking</li>
                            <li style={styles.listItem}>Custom Canisters with folder organization</li>
                            <li style={styles.listItem}>Health status indicators (cycle monitoring)</li>
                            <li style={styles.listItem}>Quick access to individual canister pages</li>
                        </ul>
                    </div>

                    <div style={styles.featureCard}>
                        <h3 style={{...styles.subsubheading, marginTop: 0}}>
                            🔧 <Link to="/canister" style={styles.link}>Canister Details</Link> (/canister?id=...)
                        </h3>
                        <p style={styles.paragraph}>
                            Detailed view and management for individual canisters. Features include:
                        </p>
                        <ul style={styles.list}>
                            <li style={styles.listItem}>Canister status (running/stopped/stopping)</li>
                            <li style={styles.listItem}>Cycles balance and memory usage</li>
                            <li style={styles.listItem}>Controller management (add/remove)</li>
                            <li style={styles.listItem}>WASM upgrades and reinstallation</li>
                            <li style={styles.listItem}>ICP and cycles top-up</li>
                        </ul>
                    </div>
                </div>

                {/* Health Status Indicators */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Health Status Indicators</h2>
                    <p style={styles.paragraph}>
                        The Canister Manager uses colored status lamps to help you quickly identify canisters that need attention.
                        These appear on both individual canisters and folders (showing the worst status of contained canisters).
                    </p>

                    <div style={styles.highlight}>
                        <h3 style={{...styles.subsubheading, marginTop: 0}}>Status Colors</h3>
                        <ul style={{...styles.list, listStyleType: 'none', marginLeft: 0}}>
                            <li style={{...styles.listItem, display: 'flex', alignItems: 'center'}}>
                                <span style={{...styles.statusLamp, backgroundColor: '#ef4444', boxShadow: '0 0 6px #ef4444'}} />
                                <strong style={{color: '#ef4444'}}>Critical (Red)</strong> — Cycles below 1T. Needs immediate top-up!
                            </li>
                            <li style={{...styles.listItem, display: 'flex', alignItems: 'center'}}>
                                <span style={{...styles.statusLamp, backgroundColor: '#f59e0b', boxShadow: '0 0 6px #f59e0b'}} />
                                <strong style={{color: '#f59e0b'}}>Warning (Orange)</strong> — Cycles below 5T. Consider topping up soon.
                            </li>
                            <li style={{...styles.listItem, display: 'flex', alignItems: 'center'}}>
                                <span style={{...styles.statusLamp, backgroundColor: '#22c55e', boxShadow: '0 0 6px #22c55e'}} />
                                <strong style={{color: '#22c55e'}}>Healthy (Green)</strong> — Cycles at 5T or above. Good to go!
                            </li>
                            <li style={{...styles.listItem, display: 'flex', alignItems: 'center'}}>
                                <span style={{...styles.statusLamp, backgroundColor: '#6b7280'}} />
                                <strong style={{color: '#6b7280'}}>Unknown (Gray)</strong> — Cycle data unavailable (not a controller).
                            </li>
                        </ul>
                    </div>

                    <div style={styles.infoBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>Folder Status:</strong> Folders display the worst status of all canisters 
                            they contain (including nested subfolders). A red folder means at least one canister inside needs attention!
                        </p>
                    </div>
                </div>

                {/* ICP Neuron Managers Section */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>ICP Neuron Managers</h2>
                    <p style={styles.paragraph}>
                        The ICP Neuron Managers section shows all neuron manager canisters you've created through the 
                        <Link to="/create_icp_neuron" style={styles.link}> Create ICP Neuron</Link> page.
                    </p>

                    <h3 style={styles.subsubheading}>What's Displayed</h3>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Canister ID:</strong> The unique identifier with copy and link options
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Neuron Count:</strong> How many ICP neurons the manager controls
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Version:</strong> Current software version with upgrade alerts
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Cycles:</strong> Current cycle balance with color-coded status
                        </li>
                    </ul>

                    <div style={styles.successBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>💡 Tip:</strong> Click "Manage" on any neuron manager to access the full 
                            management interface where you can create neurons, vote, manage maturity, and more. 
                            See the <Link to="/help/icp-neuron-manager" style={styles.link}>ICP Neuron Manager Help</Link> for details.
                        </p>
                    </div>
                </div>

                {/* Custom Canisters Section */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Custom Canisters</h2>
                    <p style={styles.paragraph}>
                        Track any canister on the Internet Computer by adding its ID. Organize them into folders for easy management.
                    </p>

                    <h3 style={styles.subsubheading}>Adding Canisters</h3>
                    <ol style={styles.stepList}>
                        <li style={styles.stepItem}>Enter a valid canister ID in the "Add Canister" field</li>
                        <li style={styles.stepItem}>Click "Add" or press Enter</li>
                        <li style={styles.stepItem}>The canister appears in "Ungrouped" or your chosen folder</li>
                    </ol>

                    <h3 style={styles.subsubheading}>Organizing with Folders</h3>
                    <p style={styles.paragraph}>
                        Create folders to group related canisters together. Useful for organizing by project, purpose, or any criteria.
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Create Folder:</strong> Click "New Group" to create a top-level folder
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Create Subfolder:</strong> Click the folder icon on any folder to add a nested subfolder
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Rename:</strong> Click the edit icon to rename any folder
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Delete:</strong> Click the trash icon to delete a folder (canisters move to Ungrouped)
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Move Canisters:</strong> Use the "Move to..." dropdown on any canister to relocate it
                        </li>
                    </ul>

                    <h3 style={styles.subsubheading}>Expand/Collapse</h3>
                    <p style={styles.paragraph}>
                        Use the "Expand" and "Collapse" buttons in the health summary bar to quickly open or close all folders at once.
                        Click individual folders to toggle them independently.
                    </p>
                </div>

                {/* Individual Canister View */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Individual Canister View</h2>
                    <p style={styles.paragraph}>
                        Click "View" on any tracked canister to open the detailed canister management page.
                    </p>

                    <h3 style={styles.subsubheading}>Canister Information</h3>
                    <div style={styles.featureCard}>
                        <ul style={styles.list}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Status:</strong> Running, Stopped, or Stopping
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Cycles Balance:</strong> Current cycles with color-coded health indicator
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Memory Usage:</strong> Current memory consumption
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Module Hash:</strong> WASM hash for version verification
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Controllers:</strong> List of principals that can manage the canister
                            </li>
                        </ul>
                    </div>

                    <h3 style={styles.subsubheading}>Controller Management</h3>
                    <p style={styles.paragraph}>
                        If you're a controller of the canister, you can manage who else has control:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Add Controller:</strong> Grant another principal full control
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Remove Controller:</strong> Revoke a principal's access
                        </li>
                    </ul>

                    <div style={styles.warningBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>⚠️ Caution:</strong> Controllers have full power over a canister. 
                            Never remove yourself as the last controller, and only add principals you completely trust.
                        </p>
                    </div>

                    <h3 style={styles.subsubheading}>WASM Management</h3>
                    <p style={styles.paragraph}>
                        Controllers can upgrade or reinstall the canister's code:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Upload WASM:</strong> Upload a WASM file from your computer
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>WASM URL:</strong> Provide a URL to download and install
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Upgrade Mode:</strong> Install new code while preserving stable memory
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Reinstall Mode:</strong> Fresh install, clearing all state
                        </li>
                    </ul>

                    <h3 style={styles.subsubheading}>Top Up Cycles</h3>
                    <p style={styles.paragraph}>
                        Keep your canisters running by topping up cycles:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>ICP Top-Up:</strong> Convert ICP to cycles via the Cycles Minting Canister (CMC)
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Cycles Top-Up:</strong> Send cycles directly from another canister
                        </li>
                    </ul>
                </div>

                {/* Best Practices */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Best Practices</h2>
                    
                    <div style={styles.highlight}>
                        <h3 style={{...styles.subsubheading, marginTop: 0}}>🔋 Monitor Cycle Balances</h3>
                        <p style={styles.paragraph}>
                            Regularly check the health summary to identify canisters running low on cycles. 
                            Red indicators mean urgent action is needed - a canister without cycles will stop functioning.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={{...styles.subsubheading, marginTop: 0}}>📁 Organize by Purpose</h3>
                        <p style={styles.paragraph}>
                            Use folders to group canisters by project, environment (dev/staging/prod), or function. 
                            This makes it easier to spot issues and manage related canisters together.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={{...styles.subsubheading, marginTop: 0}}>🔐 Backup Controllers</h3>
                        <p style={styles.paragraph}>
                            For important canisters, consider adding a backup principal as a controller. 
                            This provides recovery options if you lose access to your primary wallet.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={{...styles.subsubheading, marginTop: 0}}>🏷️ Use Naming</h3>
                        <p style={styles.paragraph}>
                            Give your canisters meaningful nicknames using the app's naming feature. 
                            This makes the Canister Manager much easier to navigate, especially with many canisters.
                        </p>
                    </div>
                </div>

                {/* FAQ */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Frequently Asked Questions</h2>
                    
                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>Why can't I see cycle balances for some canisters?</h3>
                        <p style={styles.paragraph}>
                            You can only see detailed status (cycles, memory) for canisters where you're a controller. 
                            Canisters you're not a controller of will show "unknown" status.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>What happens if I remove a canister from tracking?</h3>
                        <p style={styles.paragraph}>
                            Removing a canister from the Canister Manager only removes it from your tracking list - 
                            it doesn't affect the actual canister on the IC. You can always add it back using the canister ID.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>Can I track canisters I don't control?</h3>
                        <p style={styles.paragraph}>
                            Yes! You can track any canister by ID. However, you'll only see limited information (the canister exists) 
                            and won't be able to see cycles, memory, or perform management actions.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>How do I get the Canister ID for a canister?</h3>
                        <p style={styles.paragraph}>
                            Canister IDs are displayed when you deploy a canister (e.g., via <span style={styles.code}>dfx deploy</span>), 
                            or can be found in your <span style={styles.code}>canister_ids.json</span> file. 
                            For canisters created through Sneed Hub (like Neuron Managers), the ID is shown after creation.
                        </p>
                    </div>

                    <div style={styles.highlight}>
                        <h3 style={styles.subsubheading}>Why is Custom Canisters a premium feature?</h3>
                        <p style={styles.paragraph}>
                            Custom canister tracking is available to Sneed DAO staking members as a premium feature. 
                            This helps support the development and maintenance of Sneed Hub. 
                            ICP Neuron Managers are always accessible to all users.
                        </p>
                    </div>
                </div>

                {/* Related Help */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Related Help Topics</h2>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <Link to="/help/icp-neuron-manager" style={styles.link}>ICP Neuron Manager Help</Link> — 
                            Learn about managing ICP neurons through dedicated canisters
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/wallet" style={styles.link}>Wallet Help</Link> — 
                            Understand the Sneed Wallet and its integration with neuron managers
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

export default HelpCanisterManager;

