import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { 
    FaCubes, FaArrowLeft, FaServer, FaFolderOpen, FaHeartbeat, FaCogs, 
    FaPlus, FaEye, FaShieldAlt, FaUpload, FaLightbulb, FaQuestionCircle, FaStar
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

@keyframes canisterFloat {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    50% { transform: translateY(-10px) rotate(3deg); }
}

.canister-help-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.canister-help-float {
    animation: canisterFloat 4s ease-in-out infinite;
}
`;

// Page accent colors - pink/magenta theme for canisters
const canisterPrimary = '#ec4899';
const canisterSecondary = '#f472b6';

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
    sectionIcon: (color = canisterPrimary) => ({
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
        background: `linear-gradient(135deg, ${canisterPrimary}15, ${canisterPrimary}08)`,
        border: `1px solid ${canisterPrimary}40`,
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
    statusLamp: (color) => ({
        display: 'inline-block',
        width: '12px',
        height: '12px',
        borderRadius: '50%',
        backgroundColor: color,
        boxShadow: `0 0 6px ${color}`,
        marginRight: '8px',
    }),
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

function HelpCanisterManager() {
    const { theme } = useTheme();
    const styles = getStyles(theme);

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customAnimations}</style>
            <Header />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${canisterPrimary}15 0%, ${canisterSecondary}10 50%, transparent 100%)`,
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
                    background: `radial-gradient(circle, ${canisterPrimary}20 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-30%',
                    left: '-5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${canisterSecondary}15 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />
                
                <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '16px', flexWrap: 'wrap' }}>
                        <div className="canister-help-float" style={{
                            width: '72px',
                            height: '72px',
                            borderRadius: '20px',
                            background: `linear-gradient(135deg, ${canisterPrimary}, ${canisterSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 12px 40px ${canisterPrimary}50`,
                        }}>
                            <FaCubes size={36} color="#fff" />
                        </div>
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <div style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                background: `${canisterPrimary}20`,
                                border: `1px solid ${canisterPrimary}40`,
                                borderRadius: '20px',
                                padding: '4px 12px',
                                marginBottom: '8px',
                            }}>
                                <FaServer size={12} color={canisterPrimary} />
                                <span style={{ fontSize: '0.75rem', fontWeight: '600', color: canisterPrimary }}>
                                    Infrastructure
                                </span>
                            </div>
                            <h1 style={{
                                fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
                                fontWeight: '800',
                                color: theme.colors.primaryText,
                                margin: 0,
                            }}>
                                Canister Manager
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
                        Track, organize, and monitor all your Internet Computer canisters
                    </p>
                </div>
            </div>

            <main style={styles.container}>
                <Link to="/help" style={styles.backLink}>
                    <FaArrowLeft size={14} />
                    Back to Help Center
                </Link>

                {/* Premium Notice */}
                <div style={styles.tipBox} className="canister-help-fade-in">
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                        <FaStar size={16} color={canisterPrimary} style={{ flexShrink: 0, marginTop: '2px' }} />
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Premium Feature:</strong> Custom canister tracking is available 
                            exclusively to Sneed DAO staking members. ICP Neuron Managers are always visible to all users.
                        </p>
                    </div>
                </div>

                {/* Overview */}
                <div style={styles.section} className="canister-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaCubes size={20} color={canisterPrimary} />
                        </div>
                        <h2 style={styles.subheading}>Overview</h2>
                    </div>
                    
                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaFolderOpen size={14} color={canisterPrimary} />
                            <Link to="/canisters" style={styles.link}>Canister Manager</Link> (/canisters)
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>Main dashboard showing all tracked canisters:</p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>ICP Neuron Managers section with version tracking</li>
                            <li style={styles.listItem}>Custom Canisters with folder organization</li>
                            <li style={styles.listItem}>Health status indicators (cycle monitoring)</li>
                        </ul>
                    </div>
                    
                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaEye size={14} color="#3b82f6" />
                            <Link to="/canister" style={styles.link}>Canister Details</Link> (/canister?id=...)
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>Detailed view for individual canisters:</p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Status (running/stopped/stopping)</li>
                            <li style={styles.listItem}>Cycles balance and memory usage</li>
                            <li style={styles.listItem}>Controller management</li>
                            <li style={styles.listItem}>WASM upgrades and reinstallation</li>
                        </ul>
                    </div>
                </div>

                {/* Health Status */}
                <div style={styles.section} className="canister-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#10b981')}>
                            <FaHeartbeat size={20} color="#10b981" />
                        </div>
                        <h2 style={styles.subheading}>Health Status Indicators</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Colored status lamps help you quickly identify canisters that need attention:
                    </p>
                    
                    <div style={styles.infoBox}>
                        <ul style={{ ...styles.list, listStyleType: 'none', marginLeft: 0, marginBottom: 0 }}>
                            <li style={{ ...styles.listItem, display: 'flex', alignItems: 'center' }}>
                                <span style={styles.statusLamp('#ef4444')} />
                                <strong style={{ color: '#ef4444' }}>Critical (Red)</strong> — Cycles below 1T. Needs immediate top-up!
                            </li>
                            <li style={{ ...styles.listItem, display: 'flex', alignItems: 'center' }}>
                                <span style={styles.statusLamp('#f59e0b')} />
                                <strong style={{ color: '#f59e0b' }}>Warning (Orange)</strong> — Cycles below 5T. Consider topping up soon.
                            </li>
                            <li style={{ ...styles.listItem, display: 'flex', alignItems: 'center' }}>
                                <span style={styles.statusLamp('#22c55e')} />
                                <strong style={{ color: '#22c55e' }}>Healthy (Green)</strong> — Cycles at 5T or above. Good to go!
                            </li>
                            <li style={{ ...styles.listItem, display: 'flex', alignItems: 'center' }}>
                                <span style={{ ...styles.statusLamp('#6b7280'), boxShadow: 'none' }} />
                                <strong style={{ color: '#6b7280' }}>Unknown (Gray)</strong> — Cycle data unavailable (not a controller).
                            </li>
                        </ul>
                    </div>
                    
                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Folder Status:</strong> Folders display the worst status of all canisters 
                            they contain. A red folder means at least one canister inside needs attention!
                        </p>
                    </div>
                </div>

                {/* Custom Canisters */}
                <div style={styles.section} className="canister-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#8b5cf6')}>
                            <FaPlus size={20} color="#8b5cf6" />
                        </div>
                        <h2 style={styles.subheading}>Custom Canisters</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Adding Canisters</h4>
                    <ol style={styles.stepList}>
                        <li style={styles.stepItem}>Enter a valid canister ID in the "Add Canister" field</li>
                        <li style={styles.stepItem}>Click "Add" or press Enter</li>
                        <li style={styles.stepItem}>The canister appears in "Ungrouped" or your chosen folder</li>
                    </ol>
                    
                    <h4 style={styles.subsubheading}>Organizing with Folders</h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Create Folder:</strong> Click "New Group" for top-level folders</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Create Subfolder:</strong> Click folder icon on any folder for nested folders</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Rename:</strong> Click edit icon to rename</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Delete:</strong> Click trash icon (canisters move to Ungrouped)</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Move Canisters:</strong> Use "Move to..." dropdown to relocate</li>
                    </ul>
                </div>

                {/* Individual Canister View */}
                <div style={styles.section} className="canister-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#3b82f6')}>
                            <FaCogs size={20} color="#3b82f6" />
                        </div>
                        <h2 style={styles.subheading}>Individual Canister View</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Information</h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>Status: Running, Stopped, or Stopping</li>
                        <li style={styles.listItem}>Cycles Balance with color-coded health</li>
                        <li style={styles.listItem}>Memory Usage</li>
                        <li style={styles.listItem}>Module Hash for version verification</li>
                        <li style={styles.listItem}>Controllers list</li>
                    </ul>
                    
                    <h4 style={styles.subsubheading}>
                        <FaShieldAlt size={14} color="#ef4444" />
                        Controller Management
                    </h4>
                    <p style={styles.paragraph}>
                        If you're a controller, you can add or remove other controllers.
                    </p>
                    <div style={styles.warningBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>⚠️ Caution:</strong> Controllers have full power. Never remove yourself as 
                            the last controller, and only add principals you completely trust.
                        </p>
                    </div>
                    
                    <h4 style={styles.subsubheading}>
                        <FaUpload size={14} color="#6366f1" />
                        WASM Management
                    </h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Upload WASM:</strong> Upload a WASM file from your computer</li>
                        <li style={styles.listItem}><strong style={styles.strong}>WASM URL:</strong> Provide a URL to download and install</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Upgrade Mode:</strong> Install new code while preserving stable memory</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Reinstall Mode:</strong> Fresh install, clearing all state</li>
                    </ul>
                </div>

                {/* Best Practices */}
                <div style={styles.section} className="canister-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#f59e0b')}>
                            <FaLightbulb size={20} color="#f59e0b" />
                        </div>
                        <h2 style={styles.subheading}>Best Practices</h2>
                    </div>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Monitor Cycle Balances:</strong> Regularly check health summary—red indicators need immediate attention
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Organize by Purpose:</strong> Use folders for project, environment (dev/staging/prod), or function
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Backup Controllers:</strong> Add a backup principal for important canisters
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Use Naming:</strong> Give canisters meaningful nicknames for easier navigation
                        </li>
                    </ul>
                </div>

                {/* FAQ */}
                <div style={styles.section} className="canister-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon(theme.colors.accent)}>
                            <FaQuestionCircle size={20} color={theme.colors.accent} />
                        </div>
                        <h2 style={styles.subheading}>Common Questions</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Why can't I see cycle balances for some canisters?</h4>
                    <p style={styles.paragraph}>
                        You can only see detailed status for canisters where you're a controller. Others show "unknown" status.
                    </p>
                    
                    <h4 style={styles.subsubheading}>What happens if I remove a canister from tracking?</h4>
                    <p style={styles.paragraph}>
                        It only removes from your tracking list—the actual canister on the IC is unaffected. Add it back anytime with the ID.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Can I track canisters I don't control?</h4>
                    <p style={styles.paragraph}>
                        Yes! You can track any canister by ID, but you'll only see limited information and can't perform management actions.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Why is Custom Canisters a premium feature?</h4>
                    <p style={styles.paragraph}>
                        It helps support Sneed Hub development. ICP Neuron Managers are always accessible to all users.
                    </p>
                </div>

                {/* Related Topics */}
                <div style={styles.section} className="canister-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaArrowLeft size={20} color={canisterPrimary} />
                        </div>
                        <h2 style={styles.subheading}>Related Help Topics</h2>
                    </div>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <Link to="/help/icp-neuron-manager" style={styles.link}>ICP Neuron Manager Help</Link> — Managing ICP neurons through canisters
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/wallet" style={styles.link}>Wallet Help</Link> — Understanding the Sneed Wallet
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

export default HelpCanisterManager;
