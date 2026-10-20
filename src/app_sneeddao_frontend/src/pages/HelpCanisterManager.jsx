import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { 
    FaCubes, FaArrowLeft, FaServer, FaFolderOpen, FaHeartbeat, FaCogs, 
    FaPlus, FaEye, FaShieldAlt, FaUpload, FaLightbulb, FaQuestionCircle, FaStar,
    FaBolt, FaCreditCard, FaWallet, FaSearch
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
                                App Manager
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
                        Track, organize, and monitor all your Internet Computer apps
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
                            <strong style={styles.strong}>Premium:</strong> Everyone who is logged in can track apps and use groups, up to a limit on 
                            the number of groups, apps per group and apps in total. <Link to="/premium" style={styles.link}>Sneed Premium</Link> members 
                            get higher limits (the <strong style={styles.strong}>Upgrade to Premium</strong> window shows the exact numbers when you reach a limit). 
                            Your ICP Staking Bots and wallet apps are always shown.
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
                            <Link to="/apps" style={styles.link}>App Manager</Link> (/apps)
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>Main dashboard showing all tracked apps (you need to be logged in):</p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Add an app to track</strong> at the top: enter any app canister id and click <strong style={styles.strong}>Add</strong></li>
                            <li style={styles.listItem}><strong style={styles.strong}>Groups</strong>: your tracked apps in folders and subfolders, plus <strong style={styles.strong}>Ungrouped</strong></li>
                            <li style={styles.listItem}><strong style={styles.strong}>Wallet</strong>: the apps in your wallet, with a <strong style={styles.strong}>Sneedapp</strong> part for your bots (ICP Staking Bots and other Sneedapp bots, with version tracking) and an <strong style={styles.strong}>Other Apps</strong> part</li>
                            <li style={styles.listItem}>Health lamps (cycles, and for bots also the version), an overall status summary, and banners for bots that can be upgraded and canisters low on cycles</li>
                        </ul>
                    </div>
                    
                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaEye size={14} color="#3b82f6" />
                            <Link to="/canister" style={styles.link}>App Details</Link> (/canister?id=...)
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>Detailed view for individual apps:</p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Status (running/stopped/stopping)</li>
                            <li style={styles.listItem}>Cycles balance and memory usage</li>
                            <li style={styles.listItem}>Top up with cycles (anyone who is logged in)</li>
                            <li style={styles.listItem}>Public name and private nickname</li>
                            <li style={styles.listItem}>Controller management</li>
                            <li style={styles.listItem}>WASM upgrades and reinstallation</li>
                        </ul>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaSearch size={14} color="#14b8a6" />
                            <Link to="/canisters" style={styles.link}>Canister Explorer</Link> (/canisters)
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            Browse all canisters that have a public name or one of your nicknames, filter by name type, search by 
                            name or canister id, or enter a canister id to open its details.
                        </p>
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
                        Colored status lamps help you quickly identify apps that need attention:
                    </p>
                    
                    <div style={styles.infoBox}>
                        <ul style={{ ...styles.list, listStyleType: 'none', marginLeft: 0, marginBottom: 0 }}>
                            <li style={{ ...styles.listItem, display: 'flex', alignItems: 'center' }}>
                                <span style={styles.statusLamp('#ef4444')} />
                                <strong style={{ color: '#ef4444' }}>Critical (Red)</strong> — Cycles below the critical level (1T by default). Needs a top-up soon.
                            </li>
                            <li style={{ ...styles.listItem, display: 'flex', alignItems: 'center' }}>
                                <span style={styles.statusLamp('#f59e0b')} />
                                <strong style={{ color: '#f59e0b' }}>Low (Orange)</strong> — Cycles below the warning level (5T by default), or a bot running an outdated version.
                            </li>
                            <li style={{ ...styles.listItem, display: 'flex', alignItems: 'center' }}>
                                <span style={styles.statusLamp('#22c55e')} />
                                <strong style={{ color: '#22c55e' }}>Healthy (Green)</strong> — Cycles at or above the warning level (and, for bots, an up-to-date version).
                            </li>
                            <li style={{ ...styles.listItem, display: 'flex', alignItems: 'center' }}>
                                <span style={{ ...styles.statusLamp('#6b7280'), boxShadow: 'none' }} />
                                <strong style={{ color: '#6b7280' }}>Unknown (Gray)</strong> — Cycle data unavailable (not a controller).
                            </li>
                        </ul>
                    </div>
                    
                    <p style={styles.paragraph}>
                        The levels are yours to set: click <strong style={styles.strong}>Customize →</strong> in the cycle status legend on /apps, 
                        or open <Link to="/me?tab=settings" style={styles.link}>your settings</Link> and use <strong style={styles.strong}>App Cycle Thresholds</strong> (for 
                        apps) and <strong style={styles.strong}>ICP Staking Bot Cycle Thresholds</strong> (for bots). They are saved in this browser.
                    </p>

                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Folder Status:</strong> Folders display the worst status of all apps 
                            they contain. A red folder means at least one app inside needs attention!
                        </p>
                    </div>
                </div>

                {/* Custom Apps */}
                <div style={styles.section} className="canister-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#8b5cf6')}>
                            <FaPlus size={20} color="#8b5cf6" />
                        </div>
                        <h2 style={styles.subheading}>Custom Apps</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Adding Apps</h4>
                    <ol style={styles.stepList}>
                        <li style={styles.stepItem}>Enter a valid app canister id in <strong style={styles.strong}>Add an app to track</strong> (it suggests named canisters as you type)</li>
                        <li style={styles.stepItem}>Click <strong style={styles.strong}>Add</strong> or press Enter</li>
                        <li style={styles.stepItem}>The app appears in <strong style={styles.strong}>Ungrouped</strong>. To add straight into a folder, use the add button on that folder</li>
                    </ol>
                    <p style={styles.paragraph}>
                        If you add the root canister of an SNS, the app shows up as that DAO, with separate health lamps for its 
                        system canisters, dapps and archives.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Organizing with Folders</h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Create Folder:</strong> Click <strong style={styles.strong}>New Group</strong> in the Groups header for a top-level folder</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Create Subfolder:</strong> Use <strong style={styles.strong}>Add subgroup</strong> on any folder</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Rename / Delete:</strong> Use <strong style={styles.strong}>Rename group</strong> or <strong style={styles.strong}>Delete group</strong> on the folder</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Move and reorder:</strong> Drag apps and folders between folders, into Ungrouped, or within a list to reorder them</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Move to the wallet:</strong> Drag an app onto the <strong style={styles.strong}>Wallet</strong> section (or a bot onto <strong style={styles.strong}>Sneedapp</strong>); you can drag it back to Groups the same way</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Expand / collapse:</strong> Buttons in the Groups summary open or close all folders at once</li>
                    </ul>
                    <p style={styles.paragraph}>
                        The Groups summary shows how many groups and apps you use out of your limit, and a <strong style={styles.strong}>PREMIUM</strong> badge if you are a member.
                    </p>
                </div>

                {/* Individual App View */}
                <div style={styles.section} className="canister-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#3b82f6')}>
                            <FaCogs size={20} color="#3b82f6" />
                        </div>
                        <h2 style={styles.subheading}>Individual App View</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Information</h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>Status: Running, Stopped, or Stopping</li>
                        <li style={styles.listItem}>Cycles Balance with color-coded health</li>
                        <li style={styles.listItem}>Memory Usage</li>
                        <li style={styles.listItem}>Module Hash for version verification</li>
                        <li style={styles.listItem}>Controllers list</li>
                        <li style={styles.listItem}>Links to the ICP Dashboard and the Candid UI</li>
                    </ul>
                    <p style={styles.paragraph}>
                        Status, cycles, memory and module hash are only shown in full when you are a controller; otherwise the page shows 
                        the basic information anyone can read from the IC.
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Public Name:</strong> a controller can set a name everyone sees</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Nickname:</strong> your own label for the canister, shown only to you</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Top Up with Cycles:</strong> click <strong style={styles.strong}>Add Cycles</strong>, enter an amount of ICP and click <strong style={styles.strong}>Top Up Canister</strong>. 
                            Under <strong style={styles.strong}>No ICP?</strong> there is a link to pay by card instead (see Topping Up Cycles below)</li>
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
                            <strong style={styles.strong}>Caution:</strong> Controllers have full power. Never remove yourself as 
                            the last controller, and only add principals you completely trust.
                        </p>
                    </div>
                    
                    <h4 style={styles.subsubheading}>
                        <FaUpload size={14} color="#6366f1" />
                        WASM Management
                    </h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Upload File:</strong> Upload a WASM file from your computer</li>
                        <li style={styles.listItem}><strong style={styles.strong}>From URL:</strong> Provide a URL to download and install</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Init Arguments:</strong> None (empty), a principal, an optional principal, DIDC text or raw hex Candid</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Upgrade:</strong> Install new code while preserving stable memory</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Reinstall:</strong> Fresh install, clearing all state</li>
                    </ul>
                    <div style={styles.warningBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Reinstall deletes everything:</strong> all canister state, including stable memory, is 
                            permanently deleted. This cannot be undone. The page only offers <strong style={styles.strong}>Upgrade Canister</strong> when you are a controller.
                        </p>
                    </div>
                </div>

                {/* Topping up cycles */}
                <div style={styles.section} className="canister-help-fade-in" id="top-up">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#ef4444')}>
                            <FaBolt size={20} color="#ef4444" />
                        </div>
                        <h2 style={styles.subheading}>Topping Up Cycles</h2>
                    </div>
                    <p style={styles.paragraph}>
                        When some of your canisters are below their critical level, Sneed Hub shows a <strong style={styles.strong}>low on cycles</strong> notice: 
                        a banner with a <strong style={styles.strong}>Top Up</strong> button on /apps, an indicator in the header, and notices in 
                        the quick wallet and on the <Link to="/wallet" style={styles.link}>Wallet</Link> page. All of them open the same top-up dialog, which lists 
                        those canisters (all selected; use <strong style={styles.strong}>Select all</strong> / <strong style={styles.strong}>Deselect</strong> or tick them one by one).
                    </p>
                    <h4 style={styles.subsubheading}>How much to send</h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Top up each to a target cycle level:</strong> works out what each canister needs to reach the level you set (with a 10% margin); quick buttons set it just above critical or to healthy</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Split equally:</strong> divide one total amount among the selected canisters</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Same amount for each:</strong> send the same amount to every selected canister</li>
                    </ul>
                    <p style={styles.paragraph}>The dialog shows your balance, the estimated cycles per canister and the total needed including fees.</p>

                    <h4 style={styles.subsubheading}><FaWallet size={14} color={canisterPrimary} /> Three ways to pay</h4>
                    <div style={styles.featureCard}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Pay with ICP</strong> (the default): for each canister, ICP from your wallet goes to the 
                            Cycles Minting Canister (CMC), which turns it into cycles for that canister at the current rate. Each transfer costs the 
                            ICP ledger fee (0.0001 ICP).
                        </p>
                    </div>
                    <div style={styles.featureCard}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Pay with ck-USDC</strong>: pays from your ck-USDC balance through 
                            CyclePay (cyclepay.org), an outside service that is not run by Sneed. For each canister you approve 
                            CyclePay to take the amount, CyclePay takes it and delivers the cycles; the dialog waits for the delivery. Amounts are 
                            in whole cents, within CyclePay's limits per canister (shown in the dialog), and each payment costs two ck-USDC ledger 
                            fees (the approval and the transfer). The cycle amounts shown are estimates at the protocol price (1T cycles per XDR). 
                            If CyclePay's daily limit holds a payment, it says so and CyclePay delivers the cycles later.
                        </p>
                    </div>
                    <div style={styles.featureCard}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <FaCreditCard size={12} color={theme.colors.accent} /> <strong style={styles.strong}>Pay by card</strong>: a link next to each canister 
                            (and under <strong style={styles.strong}>No ICP?</strong> on the canister page) opens CyclePay's own checkout in a new tab, 
                            where you can pay with a card, Apple Pay or Google Pay (Stripe). It takes $5 to $100 without signing in, and the card 
                            fee is 2.9% + $0.30. The cycles go straight to that canister. You don't need ICP or a Sneed Hub login for this.
                        </p>
                    </div>
                    <div style={styles.warningBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Cycles can't be taken back:</strong> once a canister has the cycles, they stay there, and 
                            payments are real tokens or real money. Check the canister id before you pay. Card and ck-USDC payments go through 
                            CyclePay, so their terms and limits are CyclePay's.
                        </p>
                    </div>
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
                            <strong style={styles.strong}>Backup Controllers:</strong> Add a backup principal for important app canisters
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Use Naming:</strong> Give apps meaningful nicknames for easier navigation
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
                    
                    <h4 style={styles.subsubheading}>Why can't I see cycle balances for some apps?</h4>
                    <p style={styles.paragraph}>
                        You can only see detailed status for app canisters where you're a controller. Others show the gray "unknown" lamp.
                    </p>
                    
                    <h4 style={styles.subsubheading}>What happens if I remove an app from tracking?</h4>
                    <p style={styles.paragraph}>
                        It only removes from your tracking list—the actual app canister on the IC is unaffected. Add it back anytime with the app canister id.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Can I track apps I don't control?</h4>
                    <p style={styles.paragraph}>
                        Yes! You can track any app canister by id, but you'll only see limited information and can't perform management actions.
                    </p>
                    
                    <h4 style={styles.subsubheading}>I hit a limit on groups or apps. What now?</h4>
                    <p style={styles.paragraph}>
                        Groups have a free limit. <Link to="/premium" style={styles.link}>Sneed Premium</Link> raises it. Your bots and wallet apps don't count towards it.
                    </p>

                    <h4 style={styles.subsubheading}>Can I top up a canister I don't control?</h4>
                    <p style={styles.paragraph}>
                        Yes. Anyone can send cycles to any canister; on the canister page, top-up works for anyone who is logged in, and the card link works without a login.
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
                            <Link to="/help/icp-neuron-manager" style={styles.link}>ICP Staking Bot Help</Link> — Managing ICP neurons through app canisters
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
