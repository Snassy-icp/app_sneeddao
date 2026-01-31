import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import { 
    FaWallet, FaCoins, FaArrowLeft, FaPiggyBank, FaExchangeAlt, 
    FaLock, FaGift, FaDownload, FaUpload, FaTrash, FaWater, 
    FaBrain, FaChartPie, FaLightbulb, FaQuestionCircle, FaCopy
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

@keyframes walletFloat {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    50% { transform: translateY(-10px) rotate(3deg); }
}

.wallet-help-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.wallet-help-float {
    animation: walletFloat 4s ease-in-out infinite;
}
`;

// Page accent colors - green theme for wallet/money
const walletPrimary = '#10b981';
const walletSecondary = '#34d399';

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
    sectionIcon: (color = walletPrimary) => ({
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
        background: `linear-gradient(135deg, ${walletPrimary}15, ${walletPrimary}08)`,
        border: `1px solid ${walletPrimary}40`,
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
        background: walletPrimary,
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
});

function HelpWallet() {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const styles = getStyles(theme);

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customAnimations}</style>
            <Header />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${walletPrimary}15 0%, ${walletSecondary}10 50%, transparent 100%)`,
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
                    background: `radial-gradient(circle, ${walletPrimary}20 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-30%',
                    left: '-5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${walletSecondary}15 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />
                
                <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '16px', flexWrap: 'wrap' }}>
                        <div className="wallet-help-float" style={{
                            width: '72px',
                            height: '72px',
                            borderRadius: '20px',
                            background: `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 12px 40px ${walletPrimary}50`,
                        }}>
                            <FaWallet size={36} color="#fff" />
                        </div>
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <div style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                background: `${walletPrimary}20`,
                                border: `1px solid ${walletPrimary}40`,
                                borderRadius: '20px',
                                padding: '4px 12px',
                                marginBottom: '8px',
                            }}>
                                <FaCoins size={12} color={walletPrimary} />
                                <span style={{ fontSize: '0.75rem', fontWeight: '600', color: walletPrimary }}>
                                    Asset Management
                                </span>
                            </div>
                            <h1 style={{
                                fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
                                fontWeight: '800',
                                color: theme.colors.primaryText,
                                margin: 0,
                            }}>
                                Understanding Your Wallet
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
                        Your comprehensive hub for managing tokens, liquidity positions, and SNS neurons
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
                    <div style={styles.tipBox} className="wallet-help-fade-in">
                        <div style={styles.sectionHeader}>
                            <div style={styles.sectionIcon(walletPrimary)}>
                                <FaWallet size={20} color={walletPrimary} />
                            </div>
                            <h3 style={styles.subheading}>Your Current Principal</h3>
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
                            This is your unique identifier on the Internet Computer. Use it when receiving assets or setting up hotkeys.
                        </p>
                    </div>
                )}

                {/* Why Principal Matters */}
                <div style={styles.section} className="wallet-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaPiggyBank size={20} color={walletPrimary} />
                        </div>
                        <h2 style={styles.subheading}>Why Your Principal Matters</h2>
                    </div>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Receiving Assets:</strong> Use this principal as the destination 
                            address when others send you tokens, liquidity positions, or neurons
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Hotkey Setup:</strong> Add this principal as a hotkey to your 
                            neurons on the NNS dApp to manage them from Sneed Hub (see <Link to="/help/neurons" style={styles.link}>
                            Understanding SNS Neurons</Link> for details)
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Identity Verification:</strong> Your principal serves as proof 
                            of ownership for all assets in your wallet
                        </li>
                    </ul>
                </div>

                {/* Token Management */}
                <div style={styles.section} className="wallet-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaCoins size={20} color={walletPrimary} />
                        </div>
                        <h2 style={styles.subheading}>Token Management</h2>
                    </div>
                    <p style={styles.paragraph}>
                        The Wallet page displays all tokens you've added, along with their balances, locked amounts, 
                        and USD values (when available).
                    </p>
                    
                    <h4 style={styles.subsubheading}>Understanding Your Token Balances</h4>
                    <p style={styles.paragraph}>
                        Your wallet uses a two-tier system to manage tokens:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Wallet:</strong> Tokens directly controlled by your principal
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Deposited:</strong> Tokens deposited to the Sneed Hub backend canister. 
                            When you lock tokens with <Link to="/help/sneedlock" style={styles.link}>Sneedlock</Link>, they're 
                            first deposited. After a lock expires, tokens appear under "Liquid" as deposited tokens.
                        </li>
                    </ul>
                    
                    <h4 style={styles.subsubheading}>Adding Tokens</h4>
                    <p style={styles.paragraph}>
                        Click <strong style={styles.strong}>"+ Add Token"</strong> and enter the ICRC-1 ledger canister ID. 
                        Once added, you'll see token symbol, name, logo, and balance breakdown including Totals, Liquid, and Locked amounts.
                    </p>
                </div>

                {/* Token Operations */}
                <div style={styles.section} className="wallet-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#3b82f6')}>
                            <FaExchangeAlt size={20} color="#3b82f6" />
                        </div>
                        <h2 style={styles.subheading}>Token Operations</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>
                        <FaUpload size={14} color={walletPrimary} />
                        Send Tokens
                    </h4>
                    <p style={styles.paragraph}>
                        Transfer tokens to any principal ID or account address. The wallet automatically calculates 
                        the transfer fee.
                    </p>
                    <div style={styles.infoBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Smart Balance Combining:</strong> Send automatically combines your
                            Wallet balance and Deposited balance—no need to withdraw deposited tokens first!
                        </p>
                    </div>
                    
                    <h4 style={styles.subsubheading}>
                        <FaLock size={14} color="#f59e0b" />
                        Lock Tokens
                    </h4>
                    <p style={styles.paragraph}>
                        Lock tokens for a specified time period using <Link to="/help/sneedlock" style={styles.link}>Sneedlock</Link>. 
                        This is useful for commitment demonstrations, vesting schedules, or governance participation.
                    </p>
                    <div style={styles.infoBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Liquid Locking:</strong> You can transfer ownership of locked 
                            token locks to other users! Great for distributing vested tokens to team members.
                        </p>
                    </div>
                    
                    <h4 style={styles.subsubheading}>
                        <FaExchangeAlt size={14} color="#8b5cf6" />
                        Wrap/Unwrap
                    </h4>
                    <p style={styles.paragraph}>
                        For certain token pairs (like GLDT/sGLDT), convert between wrapped and native forms directly from your wallet.
                    </p>
                    
                    <h4 style={styles.subsubheading}>
                        <FaGift size={14} color="#ec4899" />
                        Claim Rewards
                    </h4>
                    <p style={styles.paragraph}>
                        Some tokens accumulate rewards in the backend. Click "Claim Rewards" to transfer them to your wallet.
                    </p>
                    
                    <h4 style={styles.subsubheading}>
                        <FaDownload size={14} color={walletPrimary} />
                        Deposit & Withdraw
                    </h4>
                    <p style={styles.paragraph}>
                        Move tokens between your wallet and deposited balance. Depositing costs one transaction fee.
                    </p>
                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Pro Tip:</strong> If creating multiple locks, deposit all tokens in 
                            one batch first! Locking already-deposited tokens is FREE—saving you transaction fees.
                        </p>
                    </div>
                    
                    <h4 style={styles.subsubheading}>
                        <FaTrash size={14} color="#ef4444" />
                        Remove Token
                    </h4>
                    <p style={styles.paragraph}>
                        Click "Unregister Token" to hide a token from your view. This only removes it from display—your actual balance is unaffected.
                    </p>
                </div>

                {/* Liquidity Positions */}
                <div style={styles.section} className="wallet-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#14b8a6')}>
                            <FaWater size={20} color="#14b8a6" />
                        </div>
                        <h2 style={styles.subheading}>Liquidity Position Management</h2>
                    </div>
                    <p style={styles.paragraph}>
                        If you provide liquidity on ICPSwap, your positions appear after you add the swap canister pair.
                    </p>
                    
                    <div style={styles.infoBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Transferring from ICPSwap:</strong> Positions on ICPSwap are owned by 
                            your ICPSwap wallet. Transfer them to your Sneed Wallet principal to manage and lock them here.
                        </p>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Position Operations</h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Send Positions:</strong> Transfer LP positions to another principal—even locked ones!
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Claim Fees:</strong> Collect trading fees even from locked positions
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Lock Positions:</strong> Lock entire LP positions using Sneedlock
                        </li>
                    </ul>
                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Liquid Locking:</strong> Transfer locked LP positions—recipients can't 
                            pull liquidity but CAN claim trading fees. Creates a secondary market while preventing rugs!
                        </p>
                    </div>
                </div>

                {/* SNS Neurons */}
                <div style={styles.section} className="wallet-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#8b5cf6')}>
                            <FaBrain size={20} color="#8b5cf6" />
                        </div>
                        <h2 style={styles.subheading}>SNS Neuron Management</h2>
                    </div>
                    <p style={styles.paragraph}>
                        The Wallet page displays all your SNS neurons across all SNS DAOs for which you've added tokens.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Neuron Operations</h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Create Neurons:</strong> Stake tokens with your chosen dissolve delay</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Add Stake:</strong> Increase existing neurons to boost voting power</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Set Dissolve Time:</strong> Adjust dissolve delay settings</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Start/Stop Dissolving:</strong> Control the dissolving state</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Disburse:</strong> Withdraw tokens from fully dissolved neurons</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Disburse Maturity:</strong> Claim accumulated voting rewards</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Split Neurons:</strong> Divide a neuron into multiple neurons</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Send Neurons:</strong> Transfer neurons to other wallets—unique to Sneed Hub!</li>
                    </ul>
                    
                    <div style={styles.infoBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Want more?</strong> See <Link to="/help/neurons" style={styles.link}>Understanding SNS Neurons</Link> for 
                            detailed information about voting, hotkeys, and cross-platform management.
                        </p>
                    </div>
                </div>

                {/* Portfolio Overview */}
                <div style={styles.section} className="wallet-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#ec4899')}>
                            <FaChartPie size={20} color="#ec4899" />
                        </div>
                        <h2 style={styles.subheading}>Portfolio Overview</h2>
                    </div>
                    <p style={styles.paragraph}>
                        At the top of the Wallet page, see your total portfolio value in USD, aggregating all token balances, 
                        liquidity positions, and neuron stakes. Values use real-time conversion rates when available.
                    </p>
                </div>

                {/* Tips */}
                <div style={styles.section} className="wallet-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#f59e0b')}>
                            <FaLightbulb size={20} color="#f59e0b" />
                        </div>
                        <h2 style={styles.subheading}>Tips and Best Practices</h2>
                    </div>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Keep Your Principal Handy:</strong> Save your principal ID for easy access when receiving assets
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Verify Before Sending:</strong> Double-check recipient addresses—transfers are irreversible
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Monitor Locked Assets:</strong> Track lock expiration dates for tokens and positions
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Understand Wallet vs Deposited:</strong> Deposited tokens can be sent directly or withdrawn
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Enable Auto-Stake:</strong> Consider automatic maturity staking to compound voting rewards
                        </li>
                    </ul>
                </div>

                {/* Common Questions */}
                <div style={styles.section} className="wallet-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon(theme.colors.accent)}>
                            <FaQuestionCircle size={20} color={theme.colors.accent} />
                        </div>
                        <h2 style={styles.subheading}>Common Questions</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Why is my balance different from expected?</h4>
                    <p style={styles.paragraph}>
                        Your balance might differ if some tokens are locked in Sneedlock, staked in neurons, in your deposited balance, 
                        or shown as "Liquid" instead of "Totals".
                    </p>
                    
                    <h4 style={styles.subsubheading}>Can I cancel a lock?</h4>
                    <p style={styles.paragraph}>
                        No, locks are immutable. You must wait until the expiration date—this ensures commitment and trust.
                    </p>
                    
                    <h4 style={styles.subsubheading}>How do transfer fees work?</h4>
                    <p style={styles.paragraph}>
                        Each token has its own transfer fee. Ensure you have enough balance for both the amount and the fee.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Can I access from multiple devices?</h4>
                    <p style={styles.paragraph}>
                        Yes! Log in from any device with the same identity to access your assets—your principal stays the same.
                    </p>
                </div>

                {/* Related Topics */}
                <div style={styles.section} className="wallet-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaArrowLeft size={20} color={walletPrimary} />
                        </div>
                        <h2 style={styles.subheading}>Related Help Topics</h2>
                    </div>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <Link to="/help/neurons" style={styles.link}>Understanding SNS Neurons</Link> — Neuron management, voting, and hotkeys
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/sneedlock" style={styles.link}>Understanding Sneedlock</Link> — Lock tokens and liquidity positions
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

export default HelpWallet;
