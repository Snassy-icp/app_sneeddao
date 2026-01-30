import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { 
    FaLock, FaArrowLeft, FaMagic, FaCoins, FaWater, FaUnlock, 
    FaExchangeAlt, FaDollarSign, FaClock, FaShieldAlt, 
    FaLightbulb, FaQuestionCircle, FaSpinner, FaStar
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

@keyframes lockFloat {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    50% { transform: translateY(-10px) rotate(3deg); }
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.lock-help-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.lock-help-float {
    animation: lockFloat 4s ease-in-out infinite;
}

.lock-help-spin {
    animation: spin 1s linear infinite;
}
`;

// Page accent colors - amber/gold theme for locking/vault
const lockPrimary = '#f59e0b';
const lockSecondary = '#fbbf24';

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
    sectionIcon: (color = lockPrimary) => ({
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
        background: `linear-gradient(135deg, ${lockPrimary}15, ${lockPrimary}08)`,
        border: `1px solid ${lockPrimary}40`,
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
    wizardBox: {
        background: `linear-gradient(135deg, ${lockPrimary}20, ${lockSecondary}15)`,
        border: `2px solid ${lockPrimary}60`,
        borderRadius: '16px',
        padding: '1.25rem',
        marginBottom: '1.5rem',
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
    ctaButton: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        background: `linear-gradient(135deg, ${lockPrimary}, ${lockSecondary})`,
        color: '#fff',
        padding: '12px 20px',
        borderRadius: '10px',
        textDecoration: 'none',
        fontWeight: '600',
        marginTop: '0.5rem',
        boxShadow: `0 4px 16px ${lockPrimary}40`,
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
});

function HelpSneedlock() {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const styles = getStyles(theme);
    
    // State for lock fees
    const [lockFees, setLockFees] = useState(null);
    const [loadingFees, setLoadingFees] = useState(true);
    
    // Fetch lock fees on mount
    useEffect(() => {
        const fetchFees = async () => {
            try {
                const actor = createSneedLockActor(sneedLockCanisterId);
                const fees = await actor.get_lock_fees_icp();
                setLockFees(fees);
            } catch (error) {
                console.error('Error fetching lock fees:', error);
            } finally {
                setLoadingFees(false);
            }
        };
        fetchFees();
    }, []);
    
    // Format ICP amount from e8s
    const formatIcp = (e8s) => {
        if (e8s === null || e8s === undefined) return '...';
        const icp = Number(e8s) / 100_000_000;
        return icp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + ' ICP';
    };

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customAnimations}</style>
            <Header customLogo="/sneedlock-logo4.png" />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${lockPrimary}15 0%, ${lockSecondary}10 50%, transparent 100%)`,
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
                    background: `radial-gradient(circle, ${lockPrimary}20 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-30%',
                    left: '-5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${lockSecondary}15 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />
                
                <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '16px', flexWrap: 'wrap' }}>
                        <div className="lock-help-float" style={{
                            width: '72px',
                            height: '72px',
                            borderRadius: '20px',
                            background: `linear-gradient(135deg, ${lockPrimary}, ${lockSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 12px 40px ${lockPrimary}50`,
                        }}>
                            <FaLock size={36} color="#fff" />
                        </div>
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <div style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                background: `${lockPrimary}20`,
                                border: `1px solid ${lockPrimary}40`,
                                borderRadius: '20px',
                                padding: '4px 12px',
                                marginBottom: '8px',
                            }}>
                                <FaClock size={12} color={lockPrimary} />
                                <span style={{ fontSize: '0.75rem', fontWeight: '600', color: lockPrimary }}>
                                    Time-Locking
                                </span>
                            </div>
                            <h1 style={{
                                fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
                                fontWeight: '800',
                                color: theme.colors.primaryText,
                                margin: 0,
                            }}>
                                Understanding Sneedlock
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
                        Trustless time-locking for tokens and liquidity positions on the Internet Computer
                    </p>
                </div>
            </div>

            <main style={styles.container}>
                <Link to="/help" style={styles.backLink}>
                    <FaArrowLeft size={14} />
                    Back to Help Center
                </Link>

                {/* Lock Wizard CTA */}
                <div style={styles.wizardBox} className="lock-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon(lockPrimary)}>
                            <FaMagic size={20} color={lockPrimary} />
                        </div>
                        <h3 style={styles.subheading}>Get Started with the Lock Wizard</h3>
                    </div>
                    <p style={styles.paragraph}>
                        New to locking? The Lock Wizard provides a guided, step-by-step experience that walks you through 
                        choosing between token locks and LP position locks, selecting assets, handling ICP payment, and 
                        setting up your lock parameters.
                    </p>
                    <Link to="/lock_wizard" style={styles.ctaButton}>
                        <FaMagic size={16} />
                        Launch Lock Wizard
                    </Link>
                </div>

                {/* What is Sneedlock */}
                <div style={styles.section} className="lock-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaLock size={20} color={lockPrimary} />
                        </div>
                        <h2 style={styles.subheading}>What is Sneedlock?</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Sneedlock is a canister (smart contract) that holds tokens and liquidity positions on your behalf 
                        until a predetermined expiration date. Once locked, assets cannot be accessed by anyone—including you—until 
                        the lock expires.
                    </p>
                    <div style={styles.infoBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Key Feature:</strong> Locks are immutable and trustless. Even the 
                            Sneedlock canister itself cannot release your assets early—enforced at the protocol level.
                        </p>
                    </div>
                </div>

                {/* Why Lock Assets */}
                <div style={styles.section} className="lock-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#10b981')}>
                            <FaShieldAlt size={20} color="#10b981" />
                        </div>
                        <h2 style={styles.subheading}>Why Lock Assets?</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Demonstrate Commitment</h4>
                    <p style={styles.paragraph}>
                        Verifiable proof for project founders, team members, and investors showing long-term alignment.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Vesting Schedules</h4>
                    <p style={styles.paragraph}>
                        Create custom vesting for team token allocations, investor tokens, or grant distributions with milestone unlocks.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Liquidity Provision</h4>
                    <p style={styles.paragraph}>
                        Lock LP positions to stabilize trading pairs and build trust with traders and other LPs.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Governance Participation</h4>
                    <p style={styles.paragraph}>
                        Some DAOs incentivize locking as a prerequisite for governance, ensuring voters have long-term skin in the game.
                    </p>
                </div>

                {/* How to Lock Tokens */}
                <div style={styles.section} className="lock-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#3b82f6')}>
                            <FaCoins size={20} color="#3b82f6" />
                        </div>
                        <h2 style={styles.subheading}>How to Lock Tokens</h2>
                    </div>
                    
                    <ol style={styles.stepList}>
                        <li style={styles.stepItem}><strong style={styles.strong}>Navigate to Wallet:</strong> Go to the Wallet page and find the token</li>
                        <li style={styles.stepItem}><strong style={styles.strong}>Open Lock Modal:</strong> Expand the token card and click "Lock"</li>
                        <li style={styles.stepItem}><strong style={styles.strong}>Configure:</strong> Enter amount and expiration date</li>
                        <li style={styles.stepItem}><strong style={styles.strong}>Confirm:</strong> Review and execute the lock</li>
                    </ol>
                    
                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            <strong style={styles.strong}>Transaction Fees:</strong>
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Already-deposited tokens:</strong> FREE! No transaction fee for locking deposited tokens.
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>From wallet:</strong> 1 transaction fee (auto-deposits first).
                            </li>
                        </ul>
                        <p style={{ ...styles.paragraph, marginBottom: 0, marginTop: '0.5rem' }}>
                            <strong style={styles.strong}>Tip:</strong> Creating multiple locks? Batch deposit all tokens first—then lock for free!
                        </p>
                    </div>
                    
                    <div style={styles.warningBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>⚠️ Important:</strong> Once created, locks cannot be canceled, modified, or unlocked early. 
                            Verify amount and date before confirming!
                        </p>
                    </div>
                </div>

                {/* How to Lock LP Positions */}
                <div style={styles.section} className="lock-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#14b8a6')}>
                            <FaWater size={20} color="#14b8a6" />
                        </div>
                        <h2 style={styles.subheading}>How to Lock Liquidity Positions</h2>
                    </div>
                    
                    <ol style={styles.stepList}>
                        <li style={styles.stepItem}><strong style={styles.strong}>Add Swap Pair:</strong> Add the ICPSwap canister for your liquidity pair</li>
                        <li style={styles.stepItem}><strong style={styles.strong}>Transfer Position:</strong> Send LP position from ICPSwap to your Sneed Wallet principal</li>
                        <li style={styles.stepItem}><strong style={styles.strong}>Select Position:</strong> Find it in Liquidity Positions section</li>
                        <li style={styles.stepItem}><strong style={styles.strong}>Lock:</strong> Click "Lock Position" and set expiration date</li>
                    </ol>
                    
                    <div style={styles.successBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>💰 Claim Fees from Locked Positions:</strong> Locked LP positions continue earning trading fees. 
                            You can claim those fees directly from your wallet even while the position remains locked!
                        </p>
                    </div>
                </div>

                {/* Liquid Locking */}
                <div style={styles.section} className="lock-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#ec4899')}>
                            <FaExchangeAlt size={20} color="#ec4899" />
                        </div>
                        <h2 style={styles.subheading}>Liquid Locking: Transferring Locked Assets</h2>
                    </div>
                    <p style={styles.paragraph}>
                        One of Sneedlock's most powerful features—transfer ownership of locked assets while they remain locked. 
                        This creates liquidity without compromising security.
                    </p>
                    
                    <div style={styles.successBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>Why Liquid Locking Changes Everything</h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Locked LP Positions:</strong> Recipients can't pull liquidity but CAN claim trading fees
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Locked Tokens:</strong> Recipients can hold or transfer but can't sell until expiry
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Result:</strong> Greater liquidity AND greater safety—no rugs possible!
                            </li>
                        </ul>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Use Cases</h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Team token distribution:</strong> Create locks and transfer to team members—simple vesting!</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Secondary market:</strong> Sell locked positions at a discount—buyers get exposure, sellers get liquidity</li>
                        <li style={styles.listItem}><strong style={styles.strong}>DAO treasuries:</strong> Transfer locked LP positions while keeping commitment guarantees</li>
                    </ul>
                    
                    <div style={styles.warningBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>⚠️ Wallet Compatibility:</strong> Only transfer to Sneed Wallet principals. Transferring to 
                            incompatible wallets may result in permanent loss of access.
                        </p>
                    </div>
                </div>

                {/* Fees and Limits */}
                <div style={styles.section} className="lock-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#6366f1')}>
                            <FaDollarSign size={20} color="#6366f1" />
                        </div>
                        <h2 style={styles.subheading}>Fees and Limits</h2>
                    </div>
                    
                    <div style={styles.infoBox}>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            <strong style={styles.strong}>💰 Current Lock Fees:</strong>
                        </p>
                        {loadingFees ? (
                            <p style={{ ...styles.paragraph, marginBottom: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <FaSpinner className="lock-help-spin" color={lockPrimary} /> Loading fees...
                            </p>
                        ) : lockFees ? (
                            <ul style={{ ...styles.list, marginBottom: 0 }}>
                                <li style={styles.listItem}>
                                    <strong style={styles.strong}>Standard fee:</strong> {formatIcp(lockFees.lock_fee_icp_e8s)} per lock
                                </li>
                                <li style={styles.listItem}>
                                    <strong style={styles.strong}>Premium member fee:</strong> {formatIcp(lockFees.premium_lock_fee_icp_e8s)} per lock
                                </li>
                            </ul>
                        ) : (
                            <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                                Unable to load fees. Check the lock creation dialog for current pricing.
                            </p>
                        )}
                    </div>
                    
                    <div style={styles.successBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                            <FaStar size={16} color="#10b981" style={{ flexShrink: 0, marginTop: '2px' }} />
                            <span>
                                <strong style={styles.strong}>Save with Sneed Premium!</strong> <Link to="/premium" style={styles.link}>Premium</Link> members 
                                enjoy reduced lock fees.
                                {lockFees && lockFees.lock_fee_icp_e8s > lockFees.premium_lock_fee_icp_e8s && (
                                    <span> That's a savings of {formatIcp(lockFees.lock_fee_icp_e8s - lockFees.premium_lock_fee_icp_e8s)} per lock!</span>
                                )}
                            </span>
                        </p>
                    </div>
                </div>

                {/* Unlocking */}
                <div style={styles.section} className="lock-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#10b981')}>
                            <FaUnlock size={20} color="#10b981" />
                        </div>
                        <h2 style={styles.subheading}>Unlocking Assets After Expiration</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Unlocking Tokens</h4>
                    <p style={styles.paragraph}>
                        When a token lock expires, it automatically disappears—no action needed! Tokens appear in your 
                        "Liquid" balance as deposited tokens. You can use them immediately or withdraw to your wallet.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Unlocking LP Positions</h4>
                    <p style={styles.paragraph}>
                        For expired position locks, the position remains deposited but becomes unlocked. You can then 
                        Send the position or Withdraw it back to your wallet.
                    </p>
                </div>

                {/* Security */}
                <div style={styles.section} className="lock-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#ef4444')}>
                            <FaShieldAlt size={20} color="#ef4444" />
                        </div>
                        <h2 style={styles.subheading}>Security and Trust</h2>
                    </div>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>No One Can Access Early:</strong> Not you, not operators, not anyone—enforced by the IC.
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Publicly Verifiable:</strong> All locks are on-chain and independently verifiable.
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Immutable:</strong> Lock parameters cannot be changed after creation.
                        </li>
                    </ul>
                    <div style={styles.successBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>✓ Safe and Secure:</strong> Sneed Lock canister code is open-source. Your locked 
                            assets are protected by the Internet Computer's SNS DAO security guarantees.
                        </p>
                    </div>
                </div>

                {/* Common Questions */}
                <div style={styles.section} className="lock-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon(theme.colors.accent)}>
                            <FaQuestionCircle size={20} color={theme.colors.accent} />
                        </div>
                        <h2 style={styles.subheading}>Common Questions</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Can I cancel or shorten a lock?</h4>
                    <p style={styles.paragraph}>
                        No. Locks are immutable—this ensures commitment and trust. Always verify before confirming.
                    </p>
                    
                    <h4 style={styles.subsubheading}>What if I forget about my lock?</h4>
                    <p style={styles.paragraph}>
                        Assets remain safely in Sneedlock indefinitely after expiry. No time limit for claiming.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Do locked assets earn rewards?</h4>
                    <p style={styles.paragraph}>
                        Locked tokens don't earn staking rewards (held in Sneedlock, not staked). Locked LP positions 
                        continue earning trading fees—and you can claim them while locked!
                    </p>
                    
                    <h4 style={styles.subsubheading}>Can I add more tokens to an existing lock?</h4>
                    <p style={styles.paragraph}>
                        No. Each lock is independent. Create new locks for additional tokens—you can have multiple locks per token.
                    </p>
                </div>

                {/* Related Topics */}
                <div style={styles.section} className="lock-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaArrowLeft size={20} color={lockPrimary} />
                        </div>
                        <h2 style={styles.subheading}>Related Help Topics</h2>
                    </div>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <Link to="/lock_wizard" style={styles.link}>Lock Wizard</Link> — Guided step-by-step lock creation
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/wallet" style={styles.link}>Understanding Your Wallet</Link> — Manage tokens, positions, and neurons
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/sneedlock_info" style={styles.link}>SneedLock Dashboard</Link> — View all locks and aggregate statistics
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

export default HelpSneedlock;
