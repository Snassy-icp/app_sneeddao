import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import { 
    FaWallet, FaCoins, FaArrowLeft, FaPiggyBank, FaExchangeAlt, 
    FaLock, FaGift, FaDownload, FaUpload, FaTrash, FaWater, 
    FaBrain, FaChartPie, FaLightbulb, FaQuestionCircle, FaCopy, FaBox, FaGem
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
                        Your hub for tokens, liquidity positions, locks, neurons and apps
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
                            This is your unique identifier on the Internet Computer. Use it when receiving assets or setting up hotkeys. It is public.
                        </p>
                    </div>
                )}

                {/* Why Principal Matters */}
                <div style={styles.section} className="wallet-help-fade-in" id="principal">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaPiggyBank size={20} color={walletPrimary} />
                        </div>
                        <h2 style={styles.subheading}>Why Your Principal Matters</h2>
                    </div>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Receiving Assets:</strong> Give this principal to people who send you tokens, liquidity
                            positions, locks, NFTs or neurons. For ICP sent from an exchange, use your account ID instead: the small bar under
                            the Wallet title shows your principal, and its <strong style={styles.strong}>account ID</strong> toggle switches to the
                            account ID. Both have a copy button.
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Hotkey Setup:</strong> Add this principal as a hotkey to your
                            neurons on the NNS dApp to manage them from Sneed Hub (see <Link to="/help/neurons" style={styles.link}>
                            Understanding SNS Neurons</Link> for details)
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Public:</strong> Your principal and everything it holds can be looked up by anyone on-chain.
                        </li>
                    </ul>
                </div>

                {/* Layout */}
                <div style={styles.section} className="wallet-help-fade-in" id="layout">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#ec4899')}>
                            <FaChartPie size={20} color="#ec4899" />
                        </div>
                        <h2 style={styles.subheading}>Finding Your Way Around</h2>
                    </div>
                    <p style={styles.paragraph}>
                        The top of the <Link to="/wallet" style={styles.link}>Wallet</Link> page shows your total portfolio value with a breakdown
                        into liquid tokens, staked (neurons), locked, liquidity, maturity, rewards and fees. <strong style={styles.strong}>Refresh</strong> reloads
                        everything. Below it are four tabs:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Tokens:</strong> one card per token, with balances, locks and neurons</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Liquidity:</strong> your ICPSwap liquidity positions</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Apps:</strong> your bots and canisters (see below)</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Statistics:</strong> charts and a table of your portfolio by token and by category</li>
                    </ul>
                    <div style={styles.infoBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Your currency:</strong> values are shown in the currency you pick under
                            {' '}<strong style={styles.strong}>Currency</strong> in the header's user menu, which can be any token. Values use current
                            prices when they are known and are estimates.
                        </p>
                    </div>
                    <h4 style={styles.subsubheading}>
                        <FaGift size={14} color="#ec4899" />
                        Collect
                    </h4>
                    <p style={styles.paragraph}>
                        When you have enough trading fees, rewards or neuron maturity waiting, a <strong style={styles.strong}>Collect</strong> card
                        appears next to the total. <strong style={styles.strong}>Collect All</strong> (or the fees, rewards or maturity button alone)
                        opens a list where you pick what to collect into your wallet. Maturity only appears for neurons you have permission to manage.
                    </p>
                </div>

                {/* Token Management */}
                <div style={styles.section} className="wallet-help-fade-in" id="tokens">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaCoins size={20} color={walletPrimary} />
                        </div>
                        <h2 style={styles.subheading}>Token Management</h2>
                    </div>

                    <h4 style={styles.subsubheading}>Adding and Finding Tokens</h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>+ Add Token:</strong> pick a token from the list, or enter an ICRC-1 ledger canister ID manually.
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Scan:</strong> checks all whitelisted tokens for a balance and adds the ones you hold.
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Hide dust:</strong> hides tokens whose total is worth almost nothing.
                        </li>
                        <li style={styles.listItem}>
                            Drag cards to put them in the order you like.
                        </li>
                    </ul>

                    <h4 style={styles.subsubheading}>Understanding Your Token Balances</h4>
                    <p style={styles.paragraph}>
                        Each card has <strong style={styles.strong}>Balance</strong>, <strong style={styles.strong}>Locks</strong> and <strong style={styles.strong}>Info</strong> tabs
                        (and <strong style={styles.strong}>Neurons</strong> for SNS tokens and ICP). The Balance tab shows:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Liquid:</strong> what you can spend. Click it to see its two parts:
                            {' '}<strong style={styles.strong}>Wallet</strong> (held directly by your principal) and <strong style={styles.strong}>Deposited</strong> (held
                            for you in your own account at the <Link to="/help/sneedlock" style={styles.link}>Sneed Lock</Link> canister, ready to lock).
                            Tokens from an unlocked lock show up as Deposited.
                        </li>
                        <li style={styles.listItem}><strong style={styles.strong}>Locked:</strong> tokens in active Sneed Lock locks</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Staked, Maturity, Disbursing:</strong> your neurons of that token</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Rewards:</strong> Sneed voting rewards waiting for you, with a <strong style={styles.strong}>Claim</strong> button</li>
                    </ul>
                </div>

                {/* Token Operations */}
                <div style={styles.section} className="wallet-help-fade-in" id="token-actions">
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
                        <strong style={styles.strong}>Send</strong> takes a principal, an extended address (principal plus subaccount in one string)
                        or, for ICP, an account ID. <strong style={styles.strong}>Advanced: Send To Subaccount</strong> lets you add a subaccount by hand;
                        usually leave it empty. You review the transaction before it is sent. The transfer fee is added automatically.
                    </p>
                    <div style={styles.infoBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Smart Balance Combining:</strong> Send uses your Wallet and Deposited balances together,
                            so there is no need to withdraw deposited tokens first.
                        </p>
                    </div>

                    <h4 style={styles.subsubheading}>
                        <FaExchangeAlt size={14} color="#22c55e" />
                        Buy and Sell
                    </h4>
                    <p style={styles.paragraph}>
                        <strong style={styles.strong}>Buy</strong> and <strong style={styles.strong}>Sell</strong> open a swap between the token and ICP.
                    </p>

                    <h4 style={styles.subsubheading}>
                        <FaLock size={14} color="#f59e0b" />
                        Lock Tokens
                    </h4>
                    <p style={styles.paragraph}>
                        In the card's <strong style={styles.strong}>Locks</strong> tab, <strong style={styles.strong}>Lock</strong> locks an amount until a date
                        using <Link to="/help/sneedlock" style={styles.link}>Sneedlock</Link> (an ICP lock fee applies). Each lock row shows its amount,
                        when it unlocks, the time left, its age, its gas and its owner, with a <strong style={styles.strong}>View</strong> link to the lock's page.
                        For locks with a dissolve delay, use the <Link to="/lock_wizard" style={styles.link}>Lock Wizard</Link>.
                    </p>
                    <div style={styles.infoBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Locks are NFTs:</strong> <strong style={styles.strong}>Transfer Ownership</strong> sends a lock to another
                            principal (and optional subaccount) as an ICRC-7 NFT, still locked. It costs one ledger fee of the token, from your
                            Deposited balance, or from the lock's gas. Only send locks to wallets that support ICRC-7 NFTs.
                            {' '}<strong style={styles.strong}>Sell on Sneedex</strong> starts an offer with the lock as the asset.
                        </p>
                    </div>

                    <h4 style={styles.subsubheading}>
                        <FaExchangeAlt size={14} color="#8b5cf6" />
                        Wrap/Unwrap
                    </h4>
                    <p style={styles.paragraph}>
                        For GLDT and sGLDT, convert between the two forms directly from the token card.
                    </p>

                    <h4 style={styles.subsubheading}>
                        <FaGift size={14} color="#ec4899" />
                        Claim Rewards
                    </h4>
                    <p style={styles.paragraph}>
                        When Sneed voting rewards are waiting for you in a token, the Balance tab shows <strong style={styles.strong}>Rewards</strong>.
                        Press <strong style={styles.strong}>Claim</strong> to move them to your wallet.
                    </p>

                    <h4 style={styles.subsubheading}>
                        <FaDownload size={14} color={walletPrimary} />
                        Deposit & Withdraw
                    </h4>
                    <p style={styles.paragraph}>
                        Open <strong style={styles.strong}>Liquid</strong> in the Balance tab to move tokens between your Wallet and Deposited
                        balances with <strong style={styles.strong}>Deposit</strong> and <strong style={styles.strong}>Withdraw</strong>. Each move costs one transaction fee.
                    </p>
                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Pro Tip:</strong> If creating several locks, deposit all the tokens in one go first.
                            Locking already-deposited tokens costs no ledger fee.
                        </p>
                    </div>

                    <h4 style={styles.subsubheading}>
                        <FaCoins size={14} color="#f59e0b" />
                        Mint
                    </h4>
                    <p style={styles.paragraph}>
                        If your principal is a token's minting account, its card shows <strong style={styles.strong}>Mint</strong>.
                    </p>

                    <h4 style={styles.subsubheading}>
                        <FaTrash size={14} color="#ef4444" />
                        Remove Token
                    </h4>
                    <p style={styles.paragraph}>
                        <strong style={styles.strong}>Remove</strong> appears on a card when it holds nothing, and hides the token from your wallet.
                        It only changes what is shown; it does not touch any balance.
                    </p>
                </div>

                {/* Liquidity Positions */}
                <div style={styles.section} className="wallet-help-fade-in" id="positions">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#14b8a6')}>
                            <FaWater size={20} color="#14b8a6" />
                        </div>
                        <h2 style={styles.subheading}>Liquidity Position Management</h2>
                    </div>
                    <p style={styles.paragraph}>
                        The <strong style={styles.strong}>Liquidity</strong> tab lists your ICPSwap positions. <strong style={styles.strong}>Scan</strong> checks
                        all ICPSwap pools for your positions, and <strong style={styles.strong}>+ Add Swap Pair</strong> adds one pool by hand.
                    </p>

                    <div style={styles.infoBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Transferring from ICPSwap:</strong> Positions made on ICPSwap belong to your ICPSwap login.
                            {' '}<strong style={styles.strong}>Move a position here</strong> shows how to transfer one to your Sneed Wallet principal
                            and watches for it to arrive.
                        </p>
                    </div>

                    <h4 style={styles.subsubheading}>Position Operations</h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Manage:</strong> opens the <Link to="/position" style={styles.link}>position page</Link> to add or
                            remove liquidity, collect fees, move the price range, transfer the position, or create a new one.
                            {' '}<Link to="/positions" style={styles.link}>Positions</Link> lists your positions and every position in a pool.
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Send:</strong> transfer an unlocked position to another principal.
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Claim Fees:</strong> collect trading fees, including from locked positions.
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Lock:</strong> in the card's Locks tab, lock the position with Sneedlock, or set a later end
                            date for a position that is already locked. <strong style={styles.strong}>Link</strong> opens a public page for its lock.
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Add Liquidity:</strong> add to a locked position while it stays locked.
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Withdraw to Wallet:</strong> take a deposited, unlocked position back out of Sneed Lock.
                        </li>
                    </ul>
                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Liquid Locking:</strong> <strong style={styles.strong}>Transfer</strong> sends a locked position as an
                            ICRC-7 NFT, with no fee, to a principal and optional subaccount. Recipients can't pull the liquidity but can claim its
                            trading fees. Only send it to wallets that support ICRC-7 NFTs. <strong style={styles.strong}>Sell on Sneedex</strong> offers it for sale.
                        </p>
                    </div>
                </div>

                {/* SNS Neurons */}
                <div style={styles.section} className="wallet-help-fade-in" id="neurons">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#8b5cf6')}>
                            <FaBrain size={20} color="#8b5cf6" />
                        </div>
                        <h2 style={styles.subheading}>Neuron Management</h2>
                    </div>
                    <p style={styles.paragraph}>
                        SNS tokens have a <strong style={styles.strong}>Neurons</strong> tab with your neurons in that DAO. The ICP card has one too, for
                        NNS neurons where your principal is the controller or a hotkey.
                    </p>

                    <h4 style={styles.subsubheading}>Neuron Operations</h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Create New Neuron:</strong> stake tokens with your chosen dissolve delay</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Increase Stake:</strong> add tokens to an existing neuron</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Set / Increase Dissolve Delay</strong></li>
                        <li style={styles.listItem}><strong style={styles.strong}>Start/Stop Dissolving</strong></li>
                        <li style={styles.listItem}><strong style={styles.strong}>Disburse:</strong> withdraw tokens from a fully dissolved neuron</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Disburse Maturity:</strong> claim accumulated voting rewards</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Split Neuron:</strong> divide a neuron into two</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Hotkeys:</strong> on ICP neurons you control, add or remove hotkey principals</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Send:</strong> transfer an SNS neuron to another wallet (where the SNS allows managing neuron permissions)</li>
                    </ul>

                    <div style={styles.infoBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Want more?</strong> See <Link to="/help/neurons" style={styles.link}>Understanding SNS Neurons</Link> for
                            detailed information about voting, hotkeys, and cross-platform management.
                        </p>
                    </div>
                </div>

                {/* Apps */}
                <div style={styles.section} className="wallet-help-fade-in" id="apps">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#0ea5e9')}>
                            <FaBox size={20} color="#0ea5e9" />
                        </div>
                        <h2 style={styles.subheading}>Apps: Bots and Canisters</h2>
                    </div>
                    <p style={styles.paragraph}>
                        The <strong style={styles.strong}>Apps</strong> tab lists the bots you created through Sneedapp (such as ICP staking bots and
                        trading bots) and any other canisters you added, with their cycles, memory and version. See
                        {' '}<Link to="/help/sneedapp" style={styles.link}>Sneedapp help</Link> for the bots themselves.
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Top Up:</strong> a banner warns when canisters run low on cycles. The top-up dialog lets you
                            choose the canisters and how much to add, and pay with ICP or with ck-USDC (through CyclePay). A <strong style={styles.strong}>Pay by card</strong> link
                            per canister opens CyclePay's card checkout.
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Upgrade:</strong> a banner offers to upgrade bots that run an older version.
                        </li>
                    </ul>
                </div>

                {/* NFTs */}
                <div style={styles.section} className="wallet-help-fade-in" id="nfts">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#a78bfa')}>
                            <FaGem size={20} color="#a78bfa" />
                        </div>
                        <h2 style={styles.subheading}>NFTs</h2>
                    </div>
                    <p style={styles.paragraph}>
                        NFTs live on their own <Link to="/nft" style={styles.link}>NFTs</Link> page (in the Sneed Me menu). Press
                        {' '}<strong style={styles.strong}>Add Collection</strong> and enter an ICRC-7 collection to see what you hold in it. From there you
                        can send an NFT (recipient principal, optional subaccount and memo) and, where the collection supports it, approve
                        spenders. If you are an admin of a collection, a mint form appears too. Your Sneed Lock locks are NFTs in the Sneed Lock collection.
                    </p>
                </div>

                {/* Tips */}
                <div style={styles.section} className="wallet-help-fade-in" id="tips">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#f59e0b')}>
                            <FaLightbulb size={20} color="#f59e0b" />
                        </div>
                        <h2 style={styles.subheading}>Tips and Best Practices</h2>
                    </div>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Verify Before Sending:</strong> Double-check recipients. These are real tokens and transfers can't be undone.
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Keep a Little Liquid:</strong> Every transfer costs a ledger fee in that token.
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Monitor Locked Assets:</strong> Track when your tokens and positions unlock; a lock with a dissolve delay only unlocks after you start dissolving it
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Understand Wallet vs Deposited:</strong> Deposited tokens can be sent directly or withdrawn
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Auto-Stake Maturity:</strong> "Automatically stake new maturity" on a neuron compounds its voting rewards
                        </li>
                    </ul>
                </div>

                {/* Common Questions */}
                <div style={styles.section} className="wallet-help-fade-in" id="faq">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon(theme.colors.accent)}>
                            <FaQuestionCircle size={20} color={theme.colors.accent} />
                        </div>
                        <h2 style={styles.subheading}>Common Questions</h2>
                    </div>

                    <h4 style={styles.subsubheading}>Why is my balance different from expected?</h4>
                    <p style={styles.paragraph}>
                        Part of it may be locked in Sneedlock, staked in neurons, or in your Deposited balance. The card's total
                        includes all of these; "Liquid" is only what you can spend.
                    </p>

                    <h4 style={styles.subsubheading}>Can I cancel a lock?</h4>
                    <p style={styles.paragraph}>
                        No. A lock can't be canceled or shortened, only extended. You wait until it unlocks (or, with a dissolve delay,
                        until dissolving finishes).
                    </p>

                    <h4 style={styles.subsubheading}>How do transfer fees work?</h4>
                    <p style={styles.paragraph}>
                        Each token has its own transfer fee. Ensure you have enough balance for both the amount and the fee.
                    </p>

                    <h4 style={styles.subsubheading}>Can I access from multiple devices?</h4>
                    <p style={styles.paragraph}>
                        Yes. Log in from any device with the same identity; your principal stays the same.
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
                            <Link to="/help/sneedapp" style={styles.link}>Sneedapp</Link> — Bots and canisters in the Apps tab
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
