import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import PositionTransferPanel from '../components/PositionTransferPanel';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { 
    FaLock, FaArrowLeft, FaMagic, FaCoins, FaWater, FaUnlock, 
    FaExchangeAlt, FaDollarSign, FaClock, FaShieldAlt, 
    FaQuestionCircle, FaSpinner, FaStar, FaHourglassHalf, FaGem,
    FaGasPump, FaSearch
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
                width: '100%',
                boxSizing: 'border-box'
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
                        Time-locking for tokens and liquidity positions on the Internet Computer: lock dates, dissolve delays, and locks you can send as NFTs
                    </p>
                </div>
            </div>

            <main style={styles.container}>
                <Link to="/help" style={styles.backLink}>
                    <FaArrowLeft size={14} />
                    Back to Help Center
                </Link>

                {/* Lock Wizard CTA */}
                <div style={styles.wizardBox} className="lock-help-fade-in" id="wizard">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon(lockPrimary)}>
                            <FaMagic size={20} color={lockPrimary} />
                        </div>
                        <h3 style={styles.subheading}>Get Started with the Lock Wizard</h3>
                    </div>
                    <p style={styles.paragraph}>
                        New to locking? The Lock Wizard walks you through three steps: <strong style={styles.strong}>Type</strong> (token
                        lock or LP position lock), <strong style={styles.strong}>Select</strong> (the token, or the ICPSwap position) and
                        {' '}<strong style={styles.strong}>Lock</strong> (amount, end date and an optional dissolve delay). Before you press
                        {' '}<strong style={styles.strong}>Create Lock</strong> it shows the ICP lock fee and where it will be paid from, and a
                        confirmation sums up exactly what will happen.
                    </p>
                    <Link to="/lock_wizard" style={styles.ctaButton}>
                        <FaMagic size={16} />
                        Launch Lock Wizard
                    </Link>
                </div>

                {/* What is Sneedlock */}
                <div style={styles.section} className="lock-help-fade-in" id="overview">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaLock size={20} color={lockPrimary} />
                        </div>
                        <h2 style={styles.subheading}>What is Sneedlock?</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Sneedlock is a canister (smart contract) that holds tokens and ICPSwap liquidity positions on your behalf
                        while they are locked. A lock can follow one of two time rules:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>A plain lock</strong> unlocks by itself at the date you chose.
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>A lock with a dissolve delay</strong> works like an NNS neuron: it does not unlock
                            by itself. Once its lock period is over, its owner starts dissolving it, and it unlocks when the delay has
                            run out. See <a href="#dissolve-delay" style={styles.link}>Dissolve delays</a>.
                        </li>
                    </ul>
                    <p style={styles.paragraph}>
                        Every lock is also an ICRC-7 NFT. Whoever holds the NFT owns the lock, so locks can be sent, sold and shown
                        in NFT wallets while the assets inside stay locked.
                    </p>
                    <div style={styles.infoBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Key Feature:</strong> Sneed Lock has no way to release a lock early or to
                            shorten it, not even for its owner. A lock can only be made stricter: its lock period extended, or its
                            dissolve delay increased.
                        </p>
                    </div>
                </div>

                {/* Why Lock Assets */}
                <div style={styles.section} className="lock-help-fade-in" id="why">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#10b981')}>
                            <FaShieldAlt size={20} color="#10b981" />
                        </div>
                        <h2 style={styles.subheading}>Why Lock Assets?</h2>
                    </div>

                    <h4 style={styles.subsubheading}>Demonstrate Commitment</h4>
                    <p style={styles.paragraph}>
                        Verifiable on-chain proof for project teams and holders that tokens or liquidity will stay put.
                    </p>

                    <h4 style={styles.subsubheading}>Vesting Schedules</h4>
                    <p style={styles.paragraph}>
                        Create several locks with different end dates for team allocations or grants, and send each lock to its recipient.
                    </p>

                    <h4 style={styles.subsubheading}>Liquidity Provision</h4>
                    <p style={styles.paragraph}>
                        Lock LP positions to show that the liquidity cannot be pulled, while the position keeps earning trading fees.
                    </p>

                    <h4 style={styles.subsubheading}>Open-Ended Commitments</h4>
                    <p style={styles.paragraph}>
                        With a dissolve delay, a lock stays locked until its owner decides to start dissolving, and even then it
                        takes the full delay to unlock. Anyone watching gets that much warning.
                    </p>
                </div>

                {/* How to Lock Tokens */}
                <div style={styles.section} className="lock-help-fade-in" id="token-locks">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#3b82f6')}>
                            <FaCoins size={20} color="#3b82f6" />
                        </div>
                        <h2 style={styles.subheading}>How to Lock Tokens</h2>
                    </div>

                    <h4 style={styles.subsubheading}>With the Lock Wizard</h4>
                    <ol style={styles.stepList}>
                        <li style={styles.stepItem}>Open the <Link to="/lock_wizard" style={styles.link}>Lock Wizard</Link> and choose a token lock</li>
                        <li style={styles.stepItem}>Select the token from your wallet</li>
                        <li style={styles.stepItem}>Enter the <strong style={styles.strong}>Amount to Lock</strong> (or press MAX), a <strong style={styles.strong}>Lock Until</strong> date, and optionally a <strong style={styles.strong}>Dissolve delay in days</strong>. With a dissolve delay the date is optional.</li>
                        <li style={styles.stepItem}>Press <strong style={styles.strong}>Create Lock</strong>, read the confirmation and confirm</li>
                    </ol>

                    <h4 style={styles.subsubheading}>From your Wallet</h4>
                    <ol style={styles.stepList}>
                        <li style={styles.stepItem}>On the <Link to="/wallet" style={styles.link}>Wallet</Link> page, open the token's card and its <strong style={styles.strong}>Locks</strong> tab</li>
                        <li style={styles.stepItem}>Click <strong style={styles.strong}>Lock</strong>, enter the amount and the expiration date</li>
                        <li style={styles.stepItem}>Confirm. The wallet's lock dialog makes plain locks; for a dissolve delay use the wizard, or add one later on the lock's page</li>
                    </ol>

                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            <strong style={styles.strong}>Transaction Fees</strong> (on top of the ICP lock fee):
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Already-deposited tokens:</strong> no ledger fee for locking tokens that are already deposited in Sneed Lock.
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>From wallet:</strong> 1 transaction fee (the missing amount is deposited first).
                            </li>
                        </ul>
                        <p style={{ ...styles.paragraph, marginBottom: 0, marginTop: '0.5rem' }}>
                            <strong style={styles.strong}>Tip:</strong> Creating several locks of one token? Deposit the total once, then each lock costs no ledger fee.
                        </p>
                    </div>

                    <div style={styles.warningBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Important:</strong> Once created, a lock cannot be canceled, shortened or unlocked early.
                            These are real tokens: check the amount, the date and the delay before confirming.
                        </p>
                    </div>
                </div>

                {/* How to Lock LP Positions */}
                <div style={styles.section} className="lock-help-fade-in" id="position-locks">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#14b8a6')}>
                            <FaWater size={20} color="#14b8a6" />
                        </div>
                        <h2 style={styles.subheading}>How to Lock Liquidity Positions</h2>
                    </div>

                    <ol style={styles.stepList}>
                        <li style={styles.stepItem}><strong style={styles.strong}>Pick the pool:</strong> In the Lock Wizard, choose the two tokens of your pair (or enter the ICPSwap pool canister id). The pool is added to your wallet automatically.</li>
                        <li style={styles.stepItem}><strong style={styles.strong}>Transfer Position:</strong> On ICPSwap, open the position under Liquidity, choose Details, then "Transfer position" to your Sneed Wallet principal. The wizard shows the exact steps and your principal.</li>
                        <li style={styles.stepItem}><strong style={styles.strong}>Select Position:</strong> Pick the position in the wizard. You can also start from the position's card in the Liquidity tab of your wallet (its <strong style={styles.strong}>Locks</strong> tab, then <strong style={styles.strong}>Lock</strong>), or from <strong style={styles.strong}>Lock in Sneed Lock</strong> on the <Link to="/position" style={styles.link}>position page</Link>.</li>
                        <li style={styles.stepItem}><strong style={styles.strong}>Lock:</strong> Set the end date (and, in the wizard, an optional dissolve delay) and confirm. The lock fee is paid as part of this step.</li>
                    </ol>

                    <div style={{ margin: '0 0 1.25rem' }}>
                        <PositionTransferPanel compact title="Move a position to your Sneed wallet now" />
                    </div>

                    <p style={styles.paragraph}>
                        For a position that is already locked, the <strong style={styles.strong}>Lock</strong> button on its wallet card lets you
                        set a later end date.
                    </p>

                    <div style={styles.successBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Claim Fees from Locked Positions:</strong> Locked LP positions keep earning trading fees.
                            Press <strong style={styles.strong}>Claim Fees</strong> on the position's wallet card while it stays locked. Only the
                            current holder of the lock can claim. Claimed fees are delivered to your Sneed wallet and forwarded to your
                            wallet when the amount covers the transfer fee.
                        </p>
                    </div>

                    <div style={{ ...styles.successBox, marginTop: '1rem' }}>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            <strong style={styles.strong}>Add Liquidity to a Locked Position:</strong> You can grow a position while it stays locked.
                            Open the locked position in your wallet and choose "Add Liquidity". Enter the amounts of each token; the wizard
                            uses tokens already in your Sneed wallet first and tops up the rest from your frontend wallet.
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Liquidity is added within the position's existing price range, so it must be in range for both tokens to be used. Out of range, only one token is accepted and the rest is returned.</li>
                            <li style={styles.listItem}>Whatever ICPSwap does not use is returned to your Sneed wallet. Amounts below a token's transfer fee cannot be returned and stay in the pool.</li>
                            <li style={styles.listItem}>The lock itself is unchanged: same position, same lock rules. The added liquidity is locked with it.</li>
                        </ul>
                    </div>
                </div>

                {/* Dissolve delays */}
                <div style={styles.section} className="lock-help-fade-in" id="dissolve-delay">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#f97316')}>
                            <FaHourglassHalf size={20} color="#f97316" />
                        </div>
                        <h2 style={styles.subheading}>Dissolve Delays</h2>
                    </div>
                    <p style={styles.paragraph}>
                        A lock can have a dissolve delay, like an NNS neuron. It then has two parts: a <strong style={styles.strong}>lock period</strong>
                        {' '}(the date you chose, or none) and a <strong style={styles.strong}>delay</strong>. When the lock period is over, the owner
                        can start dissolving, and the lock unlocks once the delay has run out. Until dissolving starts, nothing counts down.
                    </p>
                    <div style={styles.infoBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Example:</strong> a lock with a 1 hour lock period and a 1 hour delay is free 2 hours from
                            now at the soonest, and later if dissolving is not started right away.
                        </p>
                    </div>

                    <h4 style={styles.subsubheading}>Managing it on the lock's page</h4>
                    <p style={styles.paragraph}>
                        Open a lock (the <strong style={styles.strong}>View</strong> link next to its Lock ID in your wallet) to see the
                        {' '}<strong style={styles.strong}>Lock period and dissolve delay</strong> panel: its status, when the lock period ends,
                        the delay, when it is free (or free at the soonest), when it was created, and Sneed Lock's limits. The owner gets these buttons:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Start dissolving:</strong> available once the lock period has ended, for a lock with a delay.</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Stop dissolving:</strong> the time left becomes the delay again.</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Add to the dissolve delay</strong> (or <strong style={styles.strong}>Give it a dissolve delay</strong> for a plain lock): enter a number of hours. The delay can only grow.</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Extend the lock period:</strong> pick a later end date. Not possible while dissolving; stop dissolving first.</li>
                    </ul>
                    <p style={styles.paragraph}>
                        In lock lists, a lock with a delay that is not dissolving shows its date as "at the soonest", with its delay
                        next to it, and its time left as "≥". A dissolving lock can still be sent; its delay and dissolving state go with it.
                    </p>
                </div>

                {/* Locks as NFTs */}
                <div style={styles.section} className="lock-help-fade-in" id="nft">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#a78bfa')}>
                            <FaGem size={20} color="#a78bfa" />
                        </div>
                        <h2 style={styles.subheading}>Locks as NFTs</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Every token lock and locked LP position is an NFT in the Sneed Lock collection (ICRC-7, with ICRC-37
                        approvals). Whoever holds the NFT owns the lock: for a token lock, the tokens once it unlocks; for a position,
                        the position, its lock and its fees. Wallets and marketplaces that speak ICRC-7 can show, send and list it.
                    </p>
                    <h4 style={styles.subsubheading}>Ways to send a lock</h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Wallet, token lock:</strong> in the token's Locks tab, press <strong style={styles.strong}>Transfer Ownership</strong> on the lock.</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Wallet, locked position:</strong> press <strong style={styles.strong}>Transfer</strong> on the position's card.</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Lock page:</strong> the NFT card shows the image, NFT number, who holds it (and the subaccount, if any); its holder can <strong style={styles.strong}>Send</strong> it from there.</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Sneedex:</strong> <strong style={styles.strong}>Sell on Sneedex</strong> on a lock or locked position creates an offer with it as the asset (see <Link to="/help/sneedex" style={styles.link}>Sneedex help</Link>).</li>
                    </ul>
                    <p style={styles.paragraph}>
                        Each send asks for a recipient principal and an optional recipient subaccount (64 hex characters). Leave the
                        subaccount empty to send to a normal wallet. Sending a locked position has no fee; a token lock costs one ledger
                        fee of its token (see <a href="#gas" style={styles.link}>Gas</a>).
                    </p>
                    <div style={styles.warningBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Wallet compatibility:</strong> only send a lock to a wallet that supports ICRC-7 NFTs
                            (the Sneed wallet does). An exchange or a wallet without ICRC-7 support may be unable to show it or send it on,
                            which can mean losing access to it.
                        </p>
                    </div>
                </div>

                {/* Gas */}
                <div style={styles.section} className="lock-help-fade-in" id="gas">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#f59e0b')}>
                            <FaGasPump size={20} color="#f59e0b" />
                        </div>
                        <h2 style={styles.subheading}>Gas for Token Locks</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Sending a token lock to another principal moves the locked tokens on the ledger, so it costs one ledger fee of
                        that token. Moving it between subaccounts of your own principal is free, and position locks never need gas.
                        The fee is paid from the owner's free (deposited) balance of the token in Sneed Lock, or, when there is none,
                        from the lock's own <strong style={styles.strong}>gas</strong> account, which pays two fees per transfer.
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>Token lock rows in the wallet, the lock page, the token lock page and the NFT page show <strong style={styles.strong}>Gas</strong>: its balance and about how many transfers it covers.</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Add gas</strong> works for anyone and any lock: choose 1, 5 or 20 transfers or type an amount. It is paid from your wallet (plus one ledger fee). Gas is a gift to whoever owns the lock, and only they can take it back.</li>
                        <li style={styles.listItem}>When you are not logged in, the dialog shows the gas account so you can send the token to it from any wallet.</li>
                        <li style={styles.listItem}>When you send a token lock from the wallet and have less than one fee deposited, the wallet first sends one fee from your wallet, so the transfer costs two fees in total. The dialog shows the exact cost.</li>
                    </ul>
                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Tip:</strong> if a send fails because the lock needs gas, add some (anyone can), or keep a
                            little of the token free in your Sneed wallet.
                        </p>
                    </div>
                </div>

                {/* Liquid Locking */}
                <div style={styles.section} className="lock-help-fade-in" id="liquid-locking">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#ec4899')}>
                            <FaExchangeAlt size={20} color="#ec4899" />
                        </div>
                        <h2 style={styles.subheading}>Liquid Locking: Transferring Locked Assets</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Because locks can change hands while they stay locked, a lock is still useful to its holder before it ends.
                    </p>

                    <div style={styles.successBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>What the recipient gets</h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Locked LP Positions:</strong> recipients can't pull the liquidity but can claim its trading fees
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Locked Tokens:</strong> recipients can hold the lock or send it on, but can't move the tokens until it unlocks
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>The lock rules stay:</strong> same end date, same dissolve delay, whoever holds it
                            </li>
                        </ul>
                    </div>

                    <h4 style={styles.subsubheading}>Use Cases</h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Team token distribution:</strong> create locks and send them to team members for simple vesting</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Secondary market:</strong> offer locks on Sneedex or any ICRC-7 marketplace</li>
                        <li style={styles.listItem}><strong style={styles.strong}>DAO treasuries:</strong> move locked LP positions while keeping the commitment</li>
                    </ul>
                </div>

                {/* Viewing locks */}
                <div style={styles.section} className="lock-help-fade-in" id="browse">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#0ea5e9')}>
                            <FaSearch size={20} color="#0ea5e9" />
                        </div>
                        <h2 style={styles.subheading}>Finding and Sharing Locks</h2>
                    </div>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <Link to="/sneedlock_info" style={styles.link}>SneedLock Dashboard</Link>: total value locked, every lock grouped by token,
                            with <strong style={styles.strong}>My Locks</strong>, filters by owner and by token, and <strong style={styles.strong}>Active</strong> and
                            {' '}<strong style={styles.strong}>Expired</strong> tabs.
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/tokenlocksoverview" style={styles.link}>Token locks overview</Link>: enter a token's ledger canister id to see its
                            token locks and position locks.
                        </li>
                        <li style={styles.listItem}>
                            The <strong style={styles.strong}>Link</strong> button on a token's or position's Locks tab in your wallet opens a public page
                            for those locks that you can share with anyone.
                        </li>
                        <li style={styles.listItem}>
                            Each lock has its own page (the <strong style={styles.strong}>View</strong> link next to its Lock ID) with its details, the dissolve
                            panel, its NFT and its gas.
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/dashboard" style={styles.link}>All locks list</Link>: a simple list of every token lock and position lock.
                        </li>
                    </ul>
                </div>

                {/* Fees and Limits */}
                <div style={styles.section} className="lock-help-fade-in" id="fees">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#6366f1')}>
                            <FaDollarSign size={20} color="#6366f1" />
                        </div>
                        <h2 style={styles.subheading}>Fees and Limits</h2>
                    </div>

                    <div style={styles.infoBox}>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            <strong style={styles.strong}>Current Lock Fees</strong> (paid in ICP when you create a lock):
                        </p>
                        {loadingFees ? (
                            <p style={{ ...styles.paragraph, marginBottom: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <FaSpinner className="lock-help-spin" color={lockPrimary} /> Loading fees...
                            </p>
                        ) : lockFees ? (
                            <ul style={{ ...styles.list, marginBottom: 0 }}>
                                <li style={styles.listItem}>
                                    <strong style={styles.strong}>Token lock:</strong> {formatIcp(lockFees.token_lock_fee_icp_e8s)} per lock
                                    {' '}(Premium members: {formatIcp(lockFees.premium_token_lock_fee_icp_e8s)})
                                </li>
                                <li style={styles.listItem}>
                                    <strong style={styles.strong}>Position lock:</strong> {formatIcp(lockFees.position_lock_fee_icp_e8s)} per lock
                                    {' '}(Premium members: {formatIcp(lockFees.premium_position_lock_fee_icp_e8s)})
                                </li>
                            </ul>
                        ) : (
                            <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                                Unable to load fees. Check the lock creation dialog for current pricing.
                            </p>
                        )}
                    </div>

                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            The Lock Wizard pays the fee from ICP you already deposited for fees first, then from your Sneed wallet's
                            deposited ICP, then from your ICP wallet, and shows any ledger transfer fees on top. If a lock fails after the
                            fee was paid, the deposit is kept and used when you try again.
                        </li>
                        <li style={styles.listItem}>
                            Sending a locked position costs nothing; sending a token lock costs one ledger fee of its token (see Gas above).
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Limits:</strong> the lock period plus the dissolve delay must stay between Sneed Lock's
                            minimum and maximum lock length. The lock page shows the current limits.
                        </li>
                    </ul>

                    <div style={styles.successBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                            <FaStar size={16} color="#10b981" style={{ flexShrink: 0, marginTop: '2px' }} />
                            <span>
                                <strong style={styles.strong}>Save with Sneed Premium!</strong> <Link to="/premium" style={styles.link}>Premium</Link> members
                                enjoy reduced lock fees.
                                {lockFees && lockFees.token_lock_fee_icp_e8s > lockFees.premium_token_lock_fee_icp_e8s && (
                                    <span> That's a savings of {formatIcp(lockFees.token_lock_fee_icp_e8s - lockFees.premium_token_lock_fee_icp_e8s)} per token lock
                                    {lockFees.position_lock_fee_icp_e8s > lockFees.premium_position_lock_fee_icp_e8s && (
                                        <> and {formatIcp(lockFees.position_lock_fee_icp_e8s - lockFees.premium_position_lock_fee_icp_e8s)} per position lock</>
                                    )}!</span>
                                )}
                            </span>
                        </p>
                    </div>
                </div>

                {/* Unlocking */}
                <div style={styles.section} className="lock-help-fade-in" id="unlocking">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#10b981')}>
                            <FaUnlock size={20} color="#10b981" />
                        </div>
                        <h2 style={styles.subheading}>Unlocking Assets</h2>
                    </div>
                    <p style={styles.paragraph}>
                        A plain lock unlocks at its date. A lock with a dissolve delay unlocks when dissolving has finished; if you never
                        start dissolving, it stays locked.
                    </p>

                    <h4 style={styles.subsubheading}>Unlocking Tokens</h4>
                    <p style={styles.paragraph}>
                        When a token lock unlocks, no action is needed: the tokens show up in your "Liquid" balance as deposited tokens.
                        You can send them right away or press <strong style={styles.strong}>Withdraw</strong> to move them to your wallet.
                    </p>

                    <h4 style={styles.subsubheading}>Unlocking LP Positions</h4>
                    <p style={styles.paragraph}>
                        An unlocked position stays deposited in Sneed Lock. You can then <strong style={styles.strong}>Send</strong> it or press
                        {' '}<strong style={styles.strong}>Withdraw to Wallet</strong> on its card.
                    </p>
                    <p style={styles.paragraph}>
                        Once a lock has unlocked it can no longer be sent as an NFT; you move the tokens or the position itself instead.
                    </p>
                </div>

                {/* Security */}
                <div style={styles.section} className="lock-help-fade-in" id="security">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#ef4444')}>
                            <FaShieldAlt size={20} color="#ef4444" />
                        </div>
                        <h2 style={styles.subheading}>Security and Trust</h2>
                    </div>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>No Early Access:</strong> Sneed Lock offers no way to release or shorten a lock, for you or anyone else.
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Publicly Verifiable:</strong> All locks, their owners and their history are on-chain and public.
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Only Stricter:</strong> After creation a lock can only be extended or given a longer delay; starting and stopping dissolving is up to its owner.
                        </li>
                    </ul>
                    <div style={styles.successBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Open and DAO-governed:</strong> The Sneed Lock canister code is open source, and changes to
                            it go through Sneed DAO proposals.
                        </p>
                    </div>
                </div>

                {/* Common Questions */}
                <div style={styles.section} className="lock-help-fade-in" id="faq">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon(theme.colors.accent)}>
                            <FaQuestionCircle size={20} color={theme.colors.accent} />
                        </div>
                        <h2 style={styles.subheading}>Common Questions</h2>
                    </div>

                    <h4 style={styles.subsubheading}>Can I cancel or shorten a lock?</h4>
                    <p style={styles.paragraph}>
                        No. You can only make it longer: extend the lock period, or add to the dissolve delay. Always verify before confirming.
                    </p>

                    <h4 style={styles.subsubheading}>What if I forget about my lock?</h4>
                    <p style={styles.paragraph}>
                        Unlocked assets stay in Sneedlock for you with no time limit. A lock with a dissolve delay simply stays locked
                        until you start dissolving it.
                    </p>

                    <h4 style={styles.subsubheading}>Why does my lock say "at the soonest"?</h4>
                    <p style={styles.paragraph}>
                        It has a dissolve delay and is not dissolving, so it has no unlock date yet. The date shown is the earliest it
                        could be free if dissolving started as soon as it is allowed.
                    </p>

                    <h4 style={styles.subsubheading}>Do locked assets earn rewards?</h4>
                    <p style={styles.paragraph}>
                        Locked tokens don't earn staking rewards (held in Sneedlock, not staked). Locked LP positions
                        keep earning trading fees, and the lock's holder can claim them while it is locked.
                    </p>

                    <h4 style={styles.subsubheading}>Can I add more tokens to an existing lock?</h4>
                    <p style={styles.paragraph}>
                        For token locks, no. Each lock is independent. Create new locks for additional tokens; you can have many locks per token.
                        For locked liquidity positions, yes: use "Add Liquidity" on the position in your wallet to add more to the locked position.
                    </p>

                    <h4 style={styles.subsubheading}>Where do I see my lock NFTs?</h4>
                    <p style={styles.paragraph}>
                        Your locks show on their token and position cards in the <Link to="/wallet" style={styles.link}>Wallet</Link>. To see them as NFTs,
                        add the Sneed Lock collection on the <Link to="/nft" style={styles.link}>NFTs</Link> page.
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
                            <Link to="/help/sneedex" style={styles.link}>Sneedex</Link> — Sell or buy locks and other assets
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
