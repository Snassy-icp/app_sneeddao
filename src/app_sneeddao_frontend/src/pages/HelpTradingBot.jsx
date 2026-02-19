import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import {
    FaChartLine, FaArrowLeft, FaExchangeAlt, FaBalanceScale, FaWallet,
    FaCogs, FaShieldAlt, FaKey, FaRocket, FaLightbulb, FaQuestionCircle,
    FaCheckCircle, FaExclamationTriangle, FaPlay, FaPause, FaStop,
    FaClipboardList, FaSyncAlt, FaArrowRight, FaPaperPlane, FaCamera,
    FaUserShield, FaDownload
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
                        A Sneed Trading Bot is a smart contract (app canister) deployed on the Internet Computer that can 
                        automatically execute token swaps, rebalance portfolios, move funds between subaccounts, and 
                        distribute tokens to multiple recipients — all on a configurable schedule.
                    </p>

                    <div style={styles.diagramBox}>
                        <div style={styles.diagramItem}>
                            <div style={{ color: tradingPrimary, fontWeight: 'bold' }}>Your Wallet</div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>(Controller of Trading Bot)</div>
                        </div>
                        <div style={styles.diagramArrow}>
                            <div style={{ fontSize: '0.8rem' }}>controls</div>
                            <div style={{ fontSize: '1.5rem' }}>↓</div>
                        </div>
                        <div style={styles.diagramItem}>
                            <div style={{ color: tradingPrimary, fontWeight: 'bold' }}>Trading Bot Canister</div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>(On-chain smart contract)</div>
                        </div>
                        <div style={styles.diagramArrow}>
                            <div style={{ fontSize: '0.8rem' }}>trades on</div>
                            <div style={{ fontSize: '1.5rem' }}>↓</div>
                        </div>
                        <div style={styles.diagramItem}>
                            <div style={{ color: tradingPrimary, fontWeight: 'bold' }}>DEX Aggregators</div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>(ICPSwap, KongSwap, etc.)</div>
                        </div>
                    </div>

                    <div style={styles.infoBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>Key Benefits</h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Fully On-Chain:</strong> Your bot is a canister on the Internet Computer — no off-chain servers, no centralized custody</li>
                            <li style={styles.listItem}><strong style={styles.strong}>You Own Your Keys:</strong> Only controllers can manage the bot; your funds stay in your canister</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Automated Scheduling:</strong> Set up chores to run on configurable intervals — trades execute even while you sleep</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Multi-Strategy:</strong> Run rebalancing, DCA, fund distribution, and more in parallel</li>
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
                        <h2 style={styles.subheading}>Getting a Trading Bot</h2>
                    </div>
                    <ol style={styles.stepList}>
                        <li style={styles.stepItem}>Navigate to the <Link to="/sneedapp" style={styles.link}>Sneedapp</Link> page</li>
                        <li style={styles.stepItem}>Find the <strong style={styles.strong}>Sneed Trading Bot</strong> app and click <strong style={styles.strong}>Mint</strong></li>
                        <li style={styles.stepItem}>Pay the creation fee to deploy your own trading bot canister</li>
                        <li style={styles.stepItem}>Once minted, the bot appears in your wallet — click it to start configuring</li>
                    </ol>
                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>What You Get:</strong> A dedicated canister you fully control, pre-funded 
                            with cycles and ready to register tokens, deposit funds, and start trading.
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
                        <li style={styles.listItem}><strong style={styles.strong}>Trigger:</strong> Manually fire a chore right now, regardless of schedule.</li>
                    </ul>

                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                            <strong style={styles.strong}>Interval Setting:</strong> Each chore has a configurable run interval 
                            (e.g. every 1 hour, every 24 hours). The chore will automatically fire at each interval.
                            You can also trigger a chore manually at any time.
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
                        The trade chore executes a list of actions each time it fires. Actions can be token swaps, 
                        deposits, withdrawals, or sends — each with optional conditions.
                    </p>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaExchangeAlt size={14} color="#f59e0b" />
                            Action Types
                        </h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Trade (Swap):</strong> Swap one token for another via DEX aggregators. Set the input token, output token, and amount.</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Deposit:</strong> Move tokens from an external account into the bot's subaccount.</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Withdraw:</strong> Move tokens from a subaccount back to the bot's main balance.</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Send:</strong> Transfer tokens from the bot to an external address.</li>
                        </ul>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaLightbulb size={14} color="#3b82f6" />
                            Conditions &amp; Frequency
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            Each action can be configured with optional conditions that must be met before it executes:
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Balance conditions:</strong> Only execute if a token balance is above or below a threshold</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Price conditions:</strong> Only execute if a token's price is within a specified range</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Frequency limits:</strong> Limit how often an action can fire (e.g. once per day) even if the chore runs more frequently</li>
                        </ul>
                    </div>

                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                            <strong style={styles.strong}>DCA Example:</strong> Create a trade chore running every 24 hours with a 
                            single swap action (e.g. ICP → ckBTC). The bot will dollar-cost-average into ckBTC daily.
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
                            <li style={styles.stepItem}>The chore checks current allocations each time it fires</li>
                            <li style={styles.stepItem}>If any token is off-target by more than the threshold, the bot executes trades to rebalance</li>
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
                            <li style={styles.listItem}><strong style={styles.strong}>Per-token targets:</strong> Set a target weight for each token in the portfolio</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Pause individual tokens:</strong> Temporarily exclude a token from rebalancing without removing it</li>
                        </ul>
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
                        The move funds chore schedules deposit, withdrawal, and send operations between the bot's subaccounts 
                        and external addresses. Use this to automate periodic fund transfers.
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Deposit:</strong> Pull tokens into a subaccount from external sources</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Withdraw:</strong> Move tokens between the bot's internal subaccounts</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Send:</strong> Transfer tokens out of the bot to any ICRC-1 account</li>
                    </ul>
                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                            <strong style={styles.strong}>Use Case:</strong> Automatically sweep profits from your trading subaccount
                            to your personal wallet on a daily schedule.
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
                        Configure recipient addresses and amounts or percentages, and the chore will split and send 
                        funds automatically each time it fires.
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>Define distribution lists with multiple recipients</li>
                        <li style={styles.listItem}>Set fixed amounts or percentage-based splits</li>
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
                    </p>
                    <div style={styles.featureCard}>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Balance Snapshots:</strong> Records balances of all registered tokens across the main account and all named subaccounts</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Price Snapshots:</strong> Fetches fresh price quotes for all registered token pairs, building price history and daily candles</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Daily Archive:</strong> Finalizes the previous day's OHLC summaries for portfolio value and individual token prices</li>
                        </ul>
                    </div>
                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                            <strong style={styles.strong}>Pipeline:</strong> Metadata Refresh → Price Fetch → Balance Snapshots → Daily Archive. 
                            Running snapshots regularly gives you accurate portfolio value charts in the management UI.
                        </p>
                    </div>
                </div>

                {/* Subaccounts & Token Registry */}
                <div style={styles.section} className="trading-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#f59e0b')}>
                            <FaWallet size={20} color="#f59e0b" />
                        </div>
                        <h2 style={styles.subheading}>Subaccounts &amp; Token Registry</h2>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaWallet size={14} color="#f59e0b" />
                            Named Subaccounts
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            Your trading bot can manage multiple named subaccounts to organize funds for different strategies:
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Create subaccounts for different trading strategies (e.g. "DCA", "Rebalance", "Savings")</li>
                            <li style={styles.listItem}>Move funds between subaccounts using the move funds chore</li>
                            <li style={styles.listItem}>Each subaccount has its own ICRC-1 deposit address for receiving tokens</li>
                        </ul>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaClipboardList size={14} color="#3b82f6" />
                            Token Registry
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>
                            Register tokens your bot will work with:
                        </p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}>Add ICRC-1 tokens by ledger canister ID</li>
                            <li style={styles.listItem}>The bot fetches token metadata (symbol, decimals, fee) automatically</li>
                            <li style={styles.listItem}>Registered tokens appear in trade configuration, rebalance targets, and portfolio views</li>
                            <li style={styles.listItem}>Remove tokens you no longer need</li>
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
                        <li style={styles.listItem}><strong style={styles.strong}>Slippage tolerance:</strong> Maximum allowed price impact on swaps (protects against unfavorable fills)</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Enabled DEXes:</strong> Choose which DEX aggregators the bot can route trades through</li>
                    </ul>
                    <div style={styles.warningBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                            <strong style={styles.strong}>Slippage Warning:</strong> Setting slippage too high can result in poor fills 
                            on volatile pairs. Setting it too low may cause trades to fail. A reasonable default is 1-3% for 
                            liquid pairs.
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
                        actions when thresholds are breached. Think of it as automated risk management.
                    </p>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaShieldAlt size={14} color="#ef4444" />
                            How Rules Work
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: '0.5rem' }}>Each circuit breaker rule has:</p>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Trigger condition:</strong> What to monitor — balance above/below threshold, price change percentage, value inside/outside a range</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Value source:</strong> Which token(s) to check — a specific token, all tokens in a rebalance portfolio, or all tokens in an account</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Actions:</strong> What happens when triggered — pause/stop a specific chore, pause/stop all chores of a type, freeze a token, or stop everything</li>
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
                            <li style={styles.listItem}><strong style={styles.strong}>Stop all chores by type</strong> — halt all instances of a chore type (e.g. all trade chores)</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Stop ALL chores</strong> — emergency halt of all bot activity</li>
                        </ul>
                    </div>

                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                            <strong style={styles.strong}>Example Rule:</strong> "If ckBTC drops more than 10% in 1 hour, 
                            pause all rebalance chores." This prevents the bot from selling into a crash.
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
                        The <strong style={styles.strong}>Log</strong> tab provides a real-time view into your bot's activity. 
                        Every action — chore runs, trade executions, permission checks, errors — is logged.
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Filter by level:</strong> Error, Warning, Info, Debug, or Trace</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Filter by source:</strong> api, permissions, chore, system, or log</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Auto-refresh:</strong> Toggle auto-refresh to see new entries as they appear</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Configure logging:</strong> Set the log write level and max stored entries</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Clear logs:</strong> Wipe all stored log entries when no longer needed</li>
                    </ul>
                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.85rem' }}>
                            <strong style={styles.strong}>Debugging Tip:</strong> If a trade isn't executing as expected, check the logs 
                            filtered to "chore" source at Debug level to see step-by-step what happened — including 
                            which conditions passed or failed.
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
                        Each bot is independent with its own token registry, subaccounts, and chore configurations.
                    </p>

                    <h4 style={styles.subsubheading}>Is my configuration preserved during upgrades?</h4>
                    <p style={styles.paragraph}>
                        Yes. Upgrades preserve stable memory, so your token registry, chore configurations, subaccounts, 
                        botkeys, and all settings survive the upgrade. Chores that were running will resume automatically.
                    </p>

                    <h4 style={styles.subsubheading}>What DEXes does the bot trade on?</h4>
                    <p style={styles.paragraph}>
                        The bot routes trades through DEX aggregators on the Internet Computer including ICPSwap 
                        and KongSwap. You can configure which DEXes are enabled in the DEX Settings panel.
                    </p>

                    <h4 style={styles.subsubheading}>What's the difference between a controller and a botkey?</h4>
                    <p style={styles.paragraph}>
                        <strong style={styles.strong}>Controllers</strong> have full administrative access — they can upgrade the canister, 
                        change controllers, and do everything. <strong style={styles.strong}>Botkeys</strong> have fine-grained 
                        permissions — you choose exactly which API functions they can access. Use botkeys when you want to 
                        grant limited access without full control.
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
                            <li style={styles.stepItem}><strong style={styles.strong}>Register Tokens:</strong> Add the tokens you want to trade</li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Deposit Funds:</strong> Send tokens to the bot's deposit address</li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Configure DEX Settings:</strong> Set slippage tolerance and enable DEXes</li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Set Up a Chore:</strong> Create a trade or rebalance chore with your desired strategy</li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Start the Chore:</strong> Hit start and your bot begins executing on schedule</li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Enable Snapshots:</strong> Start a snapshot chore to track portfolio performance over time</li>
                            <li style={styles.stepItem}><strong style={styles.strong}>Set Up Safety Rules:</strong> Configure circuit breaker rules to protect against adverse conditions</li>
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
