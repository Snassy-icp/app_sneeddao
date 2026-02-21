import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import {
    FaChartLine, FaArrowLeft, FaExchangeAlt, FaBalanceScale, FaWallet,
    FaCogs, FaShieldAlt, FaKey, FaRocket, FaLightbulb, FaQuestionCircle,
    FaCheckCircle, FaExclamationTriangle, FaPlay, FaPause, FaStop,
    FaClipboardList, FaSyncAlt, FaArrowRight, FaPaperPlane, FaCamera,
    FaUserShield, FaDownload, FaRoute, FaBullseye, FaChartArea
} from 'react-icons/fa';

const customAnimations = `
@keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
}
@keyframes tradingHelpFloat {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    50% { transform: translateY(-10px) rotate(3deg); }
}
.trading-help-fade-in { animation: fadeInUp 0.5s ease-out forwards; }
.trading-help-float { animation: tradingHelpFloat 4s ease-in-out infinite; }
`;

const tradingPrimary = '#10b981';
const tradingSecondary = '#34d399';

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
    sectionIcon: (color = tradingPrimary) => ({
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
        background: `linear-gradient(135deg, ${tradingPrimary}15, ${tradingPrimary}08)`,
        border: `1px solid ${tradingPrimary}40`,
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
    diagramBox: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        padding: '1.5rem',
        marginBottom: '1rem',
    },
    diagramItem: {
        background: theme.colors.secondaryBg,
        border: `2px solid ${tradingPrimary}`,
        borderRadius: '12px',
        padding: '12px 24px',
        textAlign: 'center',
        minWidth: '220px',
    },
    diagramArrow: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        color: theme.colors.mutedText,
    },
});

function HelpTradingBot() {
    const { theme } = useTheme();
    const styles = getStyles(theme);

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customAnimations}</style>
            <Header />

            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${tradingPrimary}15 0%, ${tradingSecondary}10 50%, transparent 100%)`,
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
                    background: `radial-gradient(circle, ${tradingPrimary}20 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-30%',
                    left: '-5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${tradingSecondary}15 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />

                <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '16px', flexWrap: 'wrap' }}>
                        <div className="trading-help-float" style={{
                            width: '72px',
                            height: '72px',
                            borderRadius: '20px',
                            background: `linear-gradient(135deg, ${tradingPrimary}, ${tradingSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 12px 40px ${tradingPrimary}50`,
                        }}>
                            <FaChartLine size={36} color="#fff" />
                        </div>
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <div style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                background: `${tradingPrimary}20`,
                                border: `1px solid ${tradingPrimary}40`,
                                borderRadius: '20px',
                                padding: '4px 12px',
                                marginBottom: '8px',
                            }}>
                                <FaExchangeAlt size={12} color={tradingPrimary} />
                                <span style={{ fontSize: '0.75rem', fontWeight: '600', color: tradingPrimary }}>
                                    Automated Trading
                                </span>
                            </div>
                            <h1 style={{
                                fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
                                fontWeight: '800',
                                color: theme.colors.primaryText,
                                margin: 0,
                            }}>
                                Sneed Trading Bot
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
                        Automate token swaps, portfolio rebalancing, fund distribution, and more with your own on-chain trading bot
                    </p>
                </div>
            </div>

            <main style={styles.container}>
                <Link to="/help" style={styles.backLink}>
                    <FaArrowLeft size={14} />
                    Back to Help Center
                </Link>

                {/* What is a Trading Bot */}
                <div style={styles.section} className="trading-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaChartLine size={20} color={tradingPrimary} />
                        </div>
                        <h2 style={styles.subheading}>What is a Sneed Trading Bot?</h2>
                    </div>
                    <p style={styles.paragraph}>
                        A Sneed Trading Bot is a smart contract (canister) deployed on the Internet Computer that can
                        automatically execute token swaps, rebalance portfolios, move funds, and
                        distribute tokens to multiple recipients — all on a configurable schedule.
                    </p>

                    <div style={styles.diagramBox}>
                        <div style={styles.diagramItem}>
                            <div style={{ color: tradingPrimary, fontWeight: 'bold' }}>Your Wallet</div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>(Controller of Trading Bot)</div>
                        </div>
                        <div style={styles.diagramArrow}>
                            <div style={{ fontSize: '0.8rem' }}>controls</div>
                            <div style={{ fontSize: '1.5rem' }}>&#8595;</div>
                        </div>
                        <div style={styles.diagramItem}>
                            <div style={{ color: tradingPrimary, fontWeight: 'bold' }}>Trading Bot Canister</div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>(On-chain smart contract with purses)</div>
                        </div>
                        <div style={styles.diagramArrow}>
                            <div style={{ fontSize: '0.8rem' }}>trades on</div>
                            <div style={{ fontSize: '1.5rem' }}>&#8595;</div>
                        </div>
                        <div style={styles.diagramItem}>
                            <div style={{ color: tradingPrimary, fontWeight: 'bold' }}>DEX Aggregators</div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>(ICPSwap, KongSwap)</div>
                        </div>
                    </div>

                    <div style={styles.infoBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>Key Benefits</h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Fully On-Chain:</strong> Your bot is a canister on the Internet Computer — no off-chain servers, no centralized custody</li>
                            <li style={styles.listItem}><strong style={styles.strong}>You Own Your Keys:</strong> Only controllers can manage the bot; your funds stay in your canister</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Automated Scheduling:</strong> Set up chores to run on configurable intervals — trades execute even while you sleep</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Multi-Strategy:</strong> Run DCA, range trading, rebalancing, fund distribution, and more in parallel</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Fund Isolation:</strong> Purses keep each chore's funds separated — one strategy can't accidentally spend another's budget</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Upgradeable:</strong> Update your bot to the latest version without losing configuration or funds</li>
                        </ul>
                    </div>
                </div>

                {/* Getting a Trading Bot */}
                <div style={styles.section} className="trading-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#3b82f6')}>
                            <FaRocket size={20} color="#3b82f6" />
                        </div>
                        <h2 style={styles.subheading}>Getting Started</h2>
                    </div>
                    <ol style={styles.stepList}>
                        <li style={styles.stepItem}>Navigate to the <Link to="/sneedapp" style={styles.link}>Sneedapp</Link> page</li>
                        <li style={styles.stepItem}>Find the <strong style={styles.strong}>Sneed Trading Bot</strong> app and click <strong style={styles.strong}>Mint</strong></li>
                        <li style={styles.stepItem}>Pay the creation fee to deploy your own trading bot canister</li>
                        <li style={styles.stepItem}>Once minted, the bot appears in your wallet — click it to start configuring</li>
                    </ol>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaRocket size={14} color="#3b82f6" />
                            Setup Wizard
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            When you open a new bot for the first time, the <strong style={styles.strong}>Setup Wizard</strong> launches automatically to help you get started quickly. It offers two guided flows:
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>DCA (Dollar-Cost Average):</strong> Set up a recurring swap — pick an input and output token, trade size, interval, and optional budget limit. The wizard handles token registration, chore creation, and purse setup for you.</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Range Trade:</strong> Trade between two tokens based on price ranges — buy when cheap, sell when expensive. Includes an optional stop-loss action that halts the chore if price drops below a threshold.</li>
                        </ul>
                    </div>

                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                            <strong style={styles.strong}>Auto Token Scan:</strong> When the wizard detects your bot has no registered tokens, it automatically scans for tokens with existing balances in the background, so they're ready when you finish the wizard.
                        </p>
                    </div>
                </div>

                {/* Chores Overview */}
                <div style={styles.section} className="trading-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#8b5cf6')}>
                            <FaCogs size={20} color="#8b5cf6" />
                        </div>
                        <h2 style={styles.subheading}>Chores — Automated Tasks</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Your trading bot runs <strong style={styles.strong}>chores</strong> — scheduled tasks that execute automatically
                        at configurable intervals. Each chore type serves a different purpose, and you can run multiple instances
                        of each type simultaneously.
                    </p>

                    <h4 style={styles.subsubheading}>
                        <FaPlay size={12} color={tradingPrimary} />
                        Chore Lifecycle
                    </h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Stopped:</strong> Not running. Must be started to begin executing.</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Running:</strong> Actively executing on schedule. Each run fires the chore's configured actions.</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Paused:</strong> Temporarily halted. Resume to continue from where it left off.</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Trigger / Run Once:</strong> Manually fire a chore right now, regardless of schedule. "Run Once" fires from a stopped state without enabling recurring schedule.</li>
                    </ul>

                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                            <strong style={styles.strong}>Interval Randomization:</strong> Each chore supports an optional max interval — the scheduler
                            picks a random time within your range each cycle. This prevents predictable scheduling patterns.
                        </p>
                    </div>
                </div>

                {/* Purses */}
                <div style={styles.section} className="trading-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#f59e0b')}>
                            <FaWallet size={20} color="#f59e0b" />
                        </div>
                        <h2 style={styles.subheading}>Purses — Fund Isolation</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Purses are a virtual accounting system that keeps each chore's funds separated. All tokens physically
                        remain in the bot canister, but purses track how much belongs to each chore.
                    </p>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaWallet size={14} color="#f59e0b" />
                            How Purses Work
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Main Purse:</strong> Your bot's unallocated funds. Computed as on-chain balance minus the sum of all chore purses.</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Chore Purse:</strong> Each chore instance can have its own purse. When a chore trades, it only uses its own purse balance.</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Fund:</strong> Move tokens from the main purse into a chore's purse (bookkeeping only — no on-chain transfer needed).</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Reclaim:</strong> Move tokens from a chore's purse back to the main purse.</li>
                        </ul>
                    </div>

                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                            <strong style={styles.strong}>Why Purses Matter:</strong> Without purses, a rebalance chore could accidentally
                            spend the funds you set aside for a DCA strategy. Purses prevent this by giving each chore its own
                            budget. New chore instances have purses enabled by default.
                        </p>
                    </div>

                    <div style={styles.warningBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                            <strong style={styles.strong}>Overcommit Detection:</strong> If you allocate more to chore purses than the bot
                            actually holds on-chain, the UI will display a warning. The bot will also detect unexpected inflows
                            (someone sends tokens to the bot) and credit them to the main purse.
                        </p>
                    </div>
                </div>

                {/* Trade Chore */}
                <div style={styles.section} className="trading-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#f59e0b')}>
                            <FaExchangeAlt size={20} color="#f59e0b" />
                        </div>
                        <h2 style={styles.subheading}>Trade Chore</h2>
                    </div>
                    <p style={styles.paragraph}>
                        The trade chore executes a list of actions each time it fires. Actions execute in order and can be
                        individually configured with conditions, limits, and trade parameters.
                    </p>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaExchangeAlt size={14} color="#f59e0b" />
                            Action Types
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Trade (Swap):</strong> Swap one token for another via DEX aggregators. The bot fetches quotes from all enabled DEXes and picks the best price.</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Fund Purse:</strong> Move tokens from the main purse into this chore's purse.</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Reclaim:</strong> Move tokens from this chore's purse back to the main purse.</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Send:</strong> Transfer tokens from the bot to any external ICRC-1 account.</li>
                        </ul>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaCogs size={14} color={tradingPrimary} />
                            Trade Size Options
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Fixed range:</strong> Random amount between a min and max (e.g. spend 1–3 ICP each time)</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Percentage of balance:</strong> Trade a percentage of the current token balance, clamped by min/max caps</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Size by input (spend):</strong> Specify how much of the input token to spend each time</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Size by output (buy):</strong> Specify how much of the output token to buy each time — the bot calculates the required input amount using live prices at each execution</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Denomination:</strong> Express trade sizes in any registered token (e.g. "trade $50 worth" using ckUSDC denomination)</li>
                        </ul>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaLightbulb size={14} color="#3b82f6" />
                            Conditions (all optional per action)
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Balance conditions:</strong> Only execute if a token balance is above or below a threshold, with optional denomination in any token</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Price conditions:</strong> Only execute if the token's price is within a specified min/max range, with optional denomination (e.g. "only buy if SNEED {'<'} 50 ckUSDC")</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Max price impact:</strong> Reject trades where the price impact exceeds a configurable threshold</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Max slippage:</strong> Reject trades where expected slippage exceeds a configurable threshold</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Trailing stop loss:</strong> Track the price peak and trigger a sell when price drops by a configurable percentage from that peak (see below)</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Trailing take profit:</strong> Track the price trough and trigger a buy when price rises by a configurable percentage from that trough</li>
                        </ul>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaChartArea size={14} color="#ef4444" />
                            Trailing Stop Loss &amp; Take Profit
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            A trailing stop dynamically tracks the price and triggers a trade when the price reverses by a specified percentage.
                        </p>
                        <ul style={{ ...styles.list, marginBottom: '0.5rem' }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Trailing Stop Loss:</strong> Tracks the highest price seen (the "peak"). When the current price drops below the peak by your threshold percentage, the action triggers. Use this to sell after a price reversal from a high.</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Trailing Take Profit:</strong> Tracks the lowest price seen (the "trough"). When the current price rises above the trough by your threshold percentage, the action triggers. Use this to buy after a price reversal from a low.</li>
                        </ul>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            <strong style={styles.strong}>Reset behavior</strong> is configurable per action:
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Reset after execution (default):</strong> After the trade fires, the watermark clears and starts tracking fresh from the current price. Good for recurring trailing stops.</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Never reset:</strong> The watermark keeps tracking from the all-time peak or trough, even after execution. Good for single-use or persistent tracking.</li>
                        </ul>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem', fontStyle: 'italic' }}>
                            The watermark can also be manually reset using the "Reset Stats" button on the action card.
                        </p>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaStop size={14} color="#ef4444" />
                            Execution Limits &amp; Auto-Halt
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Halt after execution:</strong> Stop the entire chore after this specific action fires once (useful for stop-loss actions)</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Max cumulative input:</strong> Budget cap — the chore halts when total input spent reaches this limit</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Max cumulative output:</strong> Output cap — the chore halts when total output received reaches this limit</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Max executions:</strong> Execution count cap — the chore halts after N successful executions</li>
                        </ul>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaRoute size={14} color="#6366f1" />
                            Fallback Routing (Multi-Hop Trades)
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            If a direct swap between two tokens has insufficient liquidity or excessive price impact, the bot
                            automatically tries multi-hop routes through intermediary tokens.
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Configure one or more <strong style={styles.strong}>fallback route tokens</strong> per trade chore (e.g. ICP)</li>
                            <li style={styles.listItem}>The bot tries: Token A &#8594; ICP &#8594; Token B if the direct A &#8594; B route fails or has too much impact</li>
                            <li style={styles.listItem}>The DCA and Range wizards suggest ICP as a fallback token when neither trade token is ICP</li>
                            <li style={styles.listItem}>Paused or frozen intermediary tokens are automatically skipped</li>
                        </ul>
                    </div>

                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                            <strong style={styles.strong}>DCA Example:</strong> Create a trade chore running every 24 hours with a
                            single swap action (e.g. ICP &#8594; ckBTC, spend 1 ICP). The bot will dollar-cost-average into ckBTC daily.
                            Or specify "buy 0.00005 ckBTC each time" to target a specific output amount instead.
                        </p>
                    </div>
                </div>

                {/* Rebalance Chore */}
                <div style={styles.section} className="trading-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#6366f1')}>
                            <FaBalanceScale size={20} color="#6366f1" />
                        </div>
                        <h2 style={styles.subheading}>Rebalance Chore</h2>
                    </div>
                    <p style={styles.paragraph}>
                        The rebalance chore maintains a target portfolio allocation. You define target percentages for each
                        token, and the bot automatically trades to keep your portfolio aligned.
                    </p>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaBalanceScale size={14} color="#6366f1" />
                            How It Works
                        </h4>
                        <ol style={{ ...styles.stepList, marginBottom: 0 }}>
                            <li style={styles.stepItem}>Set target allocations (e.g. 50% ICP, 30% ckBTC, 20% ckUSDC)</li>
                            <li style={styles.stepItem}>Configure a <strong style={styles.strong}>rebalance threshold</strong> — the percentage deviation that triggers a rebalance</li>
                            <li style={styles.stepItem}>The chore checks current allocations against targets each time it fires</li>
                            <li style={styles.stepItem}>If any token deviates by more than the threshold, the bot trades from overweight to underweight tokens</li>
                        </ol>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaCogs size={14} color={tradingPrimary} />
                            Configuration Options
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Denomination token:</strong> The token used to measure portfolio value (e.g. ckUSDC for USD-denominated tracking)</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Rebalance threshold:</strong> Minimum deviation percentage before rebalancing occurs</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Trade size limits:</strong> Min and max trade size per rebalance cycle</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Price impact / slippage limits:</strong> Configurable maximums per rebalancer</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Per-token pause:</strong> Temporarily exclude a token from rebalancing without removing it</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Fallback routing:</strong> Multi-hop routes through intermediary tokens (e.g. ICP) for illiquid pairs</li>
                        </ul>
                    </div>

                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                            <strong style={styles.strong}>Weighted Random Selection:</strong> The rebalancer uses weighted random pair selection — tokens
                            further from their target have a higher probability of being selected for trading. This naturally
                            prioritizes the biggest deviations while adding unpredictability.
                        </p>
                    </div>
                </div>

                {/* Move Funds Chore */}
                <div style={styles.section} className="trading-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#ec4899')}>
                            <FaPaperPlane size={20} color="#ec4899" />
                        </div>
                        <h2 style={styles.subheading}>Move Funds Chore</h2>
                    </div>
                    <p style={styles.paragraph}>
                        The move funds chore schedules fund purse, reclaim, and send operations on a recurring schedule.
                        Use this to automate periodic fund transfers without trading.
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Fund Purse:</strong> Move tokens from the main purse into a chore's purse</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Reclaim:</strong> Move tokens from a chore's purse back to the main purse</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Send:</strong> Transfer tokens out of the bot to any ICRC-1 account</li>
                    </ul>
                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                            <strong style={styles.strong}>Use Case:</strong> Automatically sweep profits from your bot
                            to your personal wallet on a daily schedule by creating a Move Funds chore with a Send action.
                        </p>
                    </div>
                </div>

                {/* Distribute Funds Chore */}
                <div style={styles.section} className="trading-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#14b8a6')}>
                            <FaDownload size={20} color="#14b8a6" />
                        </div>
                        <h2 style={styles.subheading}>Distribute Funds Chore</h2>
                    </div>
                    <p style={styles.paragraph}>
                        The distribute funds chore sends tokens to multiple recipients according to a distribution list.
                        Configure recipient addresses and percentage splits, and the chore distributes funds automatically each time it fires.
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>Define distribution lists with multiple recipients and percentage allocations</li>
                        <li style={styles.listItem}>Set a minimum threshold balance before distribution triggers</li>
                        <li style={styles.listItem}>Configure a max distribution amount per round</li>
                        <li style={styles.listItem}>Recipients without assigned percentages evenly split the remainder</li>
                        <li style={styles.listItem}>Schedule distributions on any interval</li>
                    </ul>
                </div>

                {/* Snapshot Chore */}
                <div style={styles.section} className="trading-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#06b6d4')}>
                            <FaCamera size={20} color="#06b6d4" />
                        </div>
                        <h2 style={styles.subheading}>Snapshot Chore</h2>
                    </div>
                    <p style={styles.paragraph}>
                        The snapshot chore captures periodic portfolio snapshots for tracking performance over time.
                        It runs independently of trading chores so you always have data accumulating.
                    </p>
                    <div style={styles.featureCard}>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Token Metadata Refresh:</strong> Updates symbol, decimals, and fee information for all registered tokens</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Price Fetch:</strong> Fetches fresh price quotes for all registered token pairs, building price history and daily candles</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Balance Snapshots:</strong> Records balances of all registered tokens across the bot's account</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Daily Archive:</strong> Finalizes the previous day's OHLC summaries for portfolio value and individual token prices</li>
                        </ul>
                    </div>
                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                            <strong style={styles.strong}>Tip:</strong> Start a snapshot chore early — the portfolio value charts and price
                            history in the management UI are built from this data. Running snapshots every hour is a good default.
                        </p>
                    </div>
                </div>

                {/* Wallet & Token Registry */}
                <div style={styles.section} className="trading-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#f59e0b')}>
                            <FaWallet size={20} color="#f59e0b" />
                        </div>
                        <h2 style={styles.subheading}>Wallet &amp; Token Registry</h2>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaClipboardList size={14} color="#3b82f6" />
                            Token Registry
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            Register the tokens your bot will work with:
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Add any ICRC-1 token by its ledger canister ID</li>
                            <li style={styles.listItem}>The bot fetches token metadata (symbol, decimals, fee) automatically</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Scan for Tokens:</strong> Automatically discover tokens with existing balances from the token whitelist</li>
                            <li style={styles.listItem}>Registered tokens appear in trade configuration, rebalance targets, and portfolio views</li>
                            <li style={styles.listItem}>Drag-and-drop reordering for display preference</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Pause/Freeze:</strong> Paused tokens won't be traded; frozen tokens won't be traded or moved at all</li>
                        </ul>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaWallet size={14} color="#f59e0b" />
                            Wallet Panel
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            The wallet panel shows your bot's complete financial picture:
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Token balances with ICP and USD values</li>
                            <li style={styles.listItem}>Main purse vs. chore purse breakdown</li>
                            <li style={styles.listItem}>Portfolio value chart over time (from snapshot data)</li>
                            <li style={styles.listItem}>Price charts for individual token pairs</li>
                            <li style={styles.listItem}>Deposit, withdraw, and send operations</li>
                            <li style={styles.listItem}>Capital tracking with net inflows/outflows and P&amp;L</li>
                        </ul>
                    </div>
                </div>

                {/* DEX Settings */}
                <div style={styles.section} className="trading-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon(tradingPrimary)}>
                            <FaSyncAlt size={20} color={tradingPrimary} />
                        </div>
                        <h2 style={styles.subheading}>DEX Settings</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Configure how the bot executes swaps on decentralized exchanges:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Enabled DEXes:</strong> Choose which DEXes the bot can route trades through (ICPSwap, KongSwap)</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Default slippage:</strong> Global default slippage tolerance for all trades (default: 1%). Individual actions can override this.</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Default max price impact:</strong> Global default price impact limit (default: 3%). Individual actions can override this.</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Best-quote selection:</strong> The bot fetches quotes from all enabled DEXes and automatically picks the best price</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Per-action DEX preference:</strong> Optionally restrict a specific trade action to a single DEX</li>
                    </ul>
                    <div style={styles.warningBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                            <strong style={styles.strong}>Slippage Warning:</strong> Setting slippage too high can result in poor fills
                            on volatile pairs. Setting it too low may cause trades to fail. A reasonable default is 1-3% for
                            liquid pairs, and higher (5-25%) for illiquid or meme tokens.
                        </p>
                    </div>
                </div>

                {/* Circuit Breaker */}
                <div style={styles.section} className="trading-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#ef4444')}>
                            <FaShieldAlt size={20} color="#ef4444" />
                        </div>
                        <h2 style={styles.subheading}>Circuit Breaker</h2>
                    </div>
                    <p style={styles.paragraph}>
                        The circuit breaker is a safety system that monitors conditions and automatically takes protective
                        actions when thresholds are breached — automated risk management for your bot.
                    </p>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaShieldAlt size={14} color="#ef4444" />
                            Rule Structure
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>Each circuit breaker rule has:</p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Conditions:</strong> What to monitor — price, balance, or portfolio value with operators like greater/less than, inside/outside range, or percentage change over time</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Logic:</strong> AND (all conditions must be true) or OR (any condition triggers)</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Actions:</strong> What happens — pause/stop a specific chore, pause/stop all chores of a type, freeze a token, or halt everything</li>
                        </ul>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaExclamationTriangle size={14} color="#f59e0b" />
                            Available Actions
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Pause token in rebalance portfolio</strong> — exclude a token from rebalancing</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Pause/freeze token globally</strong> — prevent all trades involving that token</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Pause/stop a specific chore</strong> — halt one chore instance</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Stop all chores by type</strong> — halt all instances of a chore type</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Stop ALL chores</strong> — emergency halt of all bot activity</li>
                        </ul>
                    </div>

                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                            <strong style={styles.strong}>Example Rule:</strong> "If ckBTC drops more than 10% in 1 hour,
                            pause all rebalance chores." This prevents the bot from selling into a crash. Affected chores stay
                            paused until you manually resume them.
                        </p>
                    </div>
                </div>

                {/* Controllers & Botkeys */}
                <div style={styles.section} className="trading-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#8b5cf6')}>
                            <FaUserShield size={20} color="#8b5cf6" />
                        </div>
                        <h2 style={styles.subheading}>Controllers &amp; Botkeys</h2>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaKey size={14} color="#8b5cf6" />
                            Controllers
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            Controllers have full administrative access to the bot canister:
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Add or remove other controllers</li>
                            <li style={styles.listItem}>Upgrade the bot to new versions</li>
                            <li style={styles.listItem}>Full access to all bot functions</li>
                        </ul>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaUserShield size={14} color={tradingPrimary} />
                            Botkeys (Fine-Grained Permissions)
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            Botkeys allow you to grant other principals limited access to specific bot functions:
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>View Chores / View Logs / View Portfolio:</strong> Read-only access to monitor the bot</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Manage Trades / Manage Rebalancer:</strong> Configure trade actions and rebalance targets</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Manage Chores:</strong> Start, stop, pause, resume, or trigger specific chore types</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Manage Token Registry / DEX Settings:</strong> Add tokens and configure DEX parameters</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Manage Purses:</strong> Enable/disable chore purses, fund and reclaim tokens</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Withdraw Funds:</strong> Send tokens out of the bot</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Full Permissions:</strong> Grants all current and future permissions</li>
                        </ul>
                    </div>

                    <div style={styles.warningBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaExclamationTriangle size={14} color="#f59e0b" />
                            Security Considerations
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Only add controllers you completely trust — they can do anything, including withdrawing all funds</li>
                            <li style={styles.listItem}>Use botkeys instead of controller access when possible — grant only the permissions needed</li>
                            <li style={styles.listItem}>Never remove yourself as the last controller</li>
                            <li style={styles.listItem}>The <strong style={styles.strong}>WithdrawFunds</strong> permission is sensitive — only grant it to trusted principals</li>
                        </ul>
                    </div>
                </div>

                {/* Logs */}
                <div style={styles.section} className="trading-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#06b6d4')}>
                            <FaClipboardList size={20} color="#06b6d4" />
                        </div>
                        <h2 style={styles.subheading}>Logs &amp; Monitoring</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Comprehensive logging gives you full visibility into your bot's activity.
                    </p>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>Activity Log</h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Filter by level:</strong> Error, Warning, Info, Debug, or Trace</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Filter by source:</strong> api, permissions, chore, system, or log</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Auto-refresh:</strong> Toggle auto-refresh to see new entries as they appear</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Configurable logging level:</strong> Set how much detail to capture (Info is the default)</li>
                        </ul>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>Trade Log</h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Every trade, fund purse, reclaim, send, detected inflow, and detected outflow is recorded</li>
                            <li style={styles.listItem}>Includes: tokens, amounts, price, price impact, slippage, DEX used, status, error messages</li>
                            <li style={styles.listItem}>Filterable by chore, action type, token pair, status, and time range</li>
                            <li style={styles.listItem}>Live swap progress cards show real-time status of in-flight trades</li>
                        </ul>
                    </div>

                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                            <strong style={styles.strong}>Debugging Tip:</strong> If a trade isn't executing as expected, check the activity logs
                            at Info level — the bot now logs detailed skip reasons (balance too low, price out of range,
                            trailing stop not triggered, etc.) so you can see exactly why an action was skipped.
                        </p>
                    </div>
                </div>

                {/* FAQ */}
                <div style={styles.section} className="trading-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon(theme.colors.accent)}>
                            <FaQuestionCircle size={20} color={theme.colors.accent} />
                        </div>
                        <h2 style={styles.subheading}>Common Questions</h2>
                    </div>

                    <h4 style={styles.subsubheading}>Where are my funds stored?</h4>
                    <p style={styles.paragraph}>
                        Your funds are held directly in your trading bot canister on the Internet Computer. The bot is a smart
                        contract that you control — no third party has access unless you grant it via controllers or botkeys.
                        Within the bot, funds are organized into purses for per-chore isolation.
                    </p>

                    <h4 style={styles.subsubheading}>What if my bot canister runs out of cycles?</h4>
                    <div style={styles.successBox}>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            <strong style={styles.strong}>Your funds are safe.</strong> If the canister runs out of cycles it will freeze,
                            but your tokens remain in the canister's accounts.
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Top up cycles to unfreeze the canister and resume operations</li>
                            <li style={styles.listItem}>Chores will resume once the canister is running again</li>
                            <li style={styles.listItem}>You remain the controller even while frozen</li>
                        </ul>
                    </div>

                    <h4 style={styles.subsubheading}>Can I run multiple trading bots?</h4>
                    <p style={styles.paragraph}>
                        Yes! Mint as many trading bots as you need from the <Link to="/sneedapp" style={styles.link}>Sneedapp</Link> page.
                        Each bot is independent with its own token registry, purses, and chore configurations.
                    </p>

                    <h4 style={styles.subsubheading}>What's the difference between a trailing stop and a circuit breaker?</h4>
                    <p style={styles.paragraph}>
                        A <strong style={styles.strong}>trailing stop</strong> is a condition on an individual trade action — when triggered,
                        it executes that specific trade (e.g. sell the token). A <strong style={styles.strong}>circuit breaker</strong> is a
                        safety system that pauses or stops chores entirely — it doesn't execute trades, it prevents them.
                        Use trailing stops for automated sell/buy decisions and circuit breakers for emergency risk management.
                    </p>

                    <h4 style={styles.subsubheading}>Is my configuration preserved during upgrades?</h4>
                    <p style={styles.paragraph}>
                        Yes. Upgrades preserve stable memory, so your token registry, chore configurations, purse allocations,
                        botkeys, and all settings survive the upgrade. Chores that were running will resume automatically.
                    </p>

                    <h4 style={styles.subsubheading}>What DEXes does the bot trade on?</h4>
                    <p style={styles.paragraph}>
                        The bot routes trades through ICPSwap (V3 concentrated liquidity AMM) and KongSwap (hybrid orderbook/AMM).
                        It queries all enabled DEXes for quotes and picks the best price automatically.
                    </p>

                    <h4 style={styles.subsubheading}>Can I specify how much output to buy instead of how much input to spend?</h4>
                    <p style={styles.paragraph}>
                        Yes! When configuring a trade action, toggle to "Amount to buy" mode. Specify the desired output amount
                        (e.g. "buy 0.00005 ckBTC each time"). The bot converts this to the required input amount using live prices
                        at each execution — so you always buy the same amount of the target token regardless of price changes.
                    </p>
                </div>

                {/* Getting Started */}
                <div style={styles.section} className="trading-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#10b981')}>
                            <FaCheckCircle size={20} color="#10b981" />
                        </div>
                        <h2 style={styles.subheading}>Getting Started Checklist</h2>
                    </div>
                    <div style={styles.successBox}>
                        <ol style={{ ...styles.stepList, marginBottom: 0 }}>
                            <li style={styles.stepItem}><strong style={styles.strong}>Mint a Bot:</strong> Visit <Link to="/sneedapp" style={styles.link}>Sneedapp</Link> and mint a Sneed Trading Bot</li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Use the Wizard:</strong> The Setup Wizard launches automatically — follow it to register tokens, fund the bot, and create your first trade</li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Fund Your Purse:</strong> Send tokens to the bot's deposit address, then fund the chore's purse from the main purse</li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Configure DEX Settings:</strong> Adjust slippage tolerance and enable your preferred DEXes</li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Start Your Chore:</strong> Hit start and your bot begins executing on schedule</li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Enable Snapshots:</strong> Start a snapshot chore to track portfolio performance over time</li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Add Safety Rules:</strong> Configure circuit breaker rules and trailing stops to protect against adverse conditions</li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Monitor:</strong> Check the trade log and activity logs to see your bot in action</li>
                        </ol>
                    </div>
                </div>

                {/* Related Topics */}
                <div style={styles.section} className="trading-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaArrowLeft size={20} color={tradingPrimary} />
                        </div>
                        <h2 style={styles.subheading}>Related Help Topics</h2>
                    </div>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <Link to="/help/icp-neuron-manager" style={styles.link}>ICP Staking Bot</Link> — Manage ICP neurons with a similar bot architecture
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/dapp-manager" style={styles.link}>App Manager</Link> — Track and organize all your app canisters
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/wallet" style={styles.link}>Understanding Your Wallet</Link> — Manage tokens and view your bots
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

export default HelpTradingBot;
