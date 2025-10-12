import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';

function HelpWallet() {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();

    const styles = {
        container: {
            minHeight: '100vh',
            background: theme.colors.background,
            color: theme.colors.primaryText
        },
        content: {
            maxWidth: '900px',
            margin: '0 auto',
            padding: '40px 20px'
        },
        heading: {
            fontSize: '2.5rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
            marginBottom: '1rem',
            marginTop: '0'
        },
        subheading: {
            fontSize: '1.8rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
            marginTop: '2.5rem',
            marginBottom: '1rem',
            borderBottom: `2px solid ${theme.colors.border}`,
            paddingBottom: '0.5rem'
        },
        subsubheading: {
            fontSize: '1.3rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
            marginTop: '1.5rem',
            marginBottom: '0.75rem'
        },
        paragraph: {
            fontSize: '1rem',
            lineHeight: '1.7',
            color: theme.colors.secondaryText,
            marginBottom: '1rem'
        },
        list: {
            marginLeft: '1.5rem',
            marginBottom: '1rem',
            color: theme.colors.secondaryText
        },
        listItem: {
            marginBottom: '0.75rem',
            lineHeight: '1.6'
        },
        infoBox: {
            background: `${theme.colors.accent}15`,
            border: `1px solid ${theme.colors.accent}50`,
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '1.5rem'
        },
        tipBox: {
            background: `${theme.colors.success || '#4CAF50'}15`,
            border: `1px solid ${theme.colors.success || '#4CAF50'}50`,
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '1.5rem'
        },
        warningBox: {
            background: `${theme.colors.warning || '#FF9800'}15`,
            border: `1px solid ${theme.colors.warning || '#FF9800'}50`,
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '1.5rem'
        },
        link: {
            color: theme.colors.accent,
            textDecoration: 'none',
            fontWeight: '500',
            transition: 'opacity 0.2s ease'
        },
        strong: {
            color: theme.colors.primaryText,
            fontWeight: '600'
        },
        code: {
            background: theme.colors.secondaryBg,
            padding: '2px 6px',
            borderRadius: '4px',
            fontFamily: 'monospace',
            fontSize: '0.9em',
            color: theme.colors.accent
        },
        section: {
            marginBottom: '2rem'
        }
    };

    return (
        <div style={styles.container}>
            <Header />
            <div style={styles.content}>
                <h1 style={styles.heading}>Understanding Your Sneed Wallet</h1>
                
                <p style={styles.paragraph}>
                    The <Link to="/wallet" style={styles.link}>Wallet page</Link> is your comprehensive financial hub in Sneed Hub. 
                    It provides a unified interface for managing tokens, liquidity positions, and SNS neurons all in one place.
                </p>

                {/* Your Principal ID */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Your Sneed Wallet Principal</h2>
                    
                    {isAuthenticated && identity && (
                        <div style={{
                            ...styles.tipBox,
                            marginBottom: '1.5rem'
                        }}>
                            <h3 style={{...styles.subsubheading, marginTop: 0}}>
                                Your Current Principal
                            </h3>
                            <div style={{
                                background: theme.colors.secondaryBg,
                                padding: '12px',
                                borderRadius: '8px',
                                marginBottom: '12px',
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
                        </div>
                    )}
                    
                    <p style={styles.paragraph}>
                        Your principal ID is your unique identifier on the Internet Computer. On the Wallet page, 
                        you'll see your principal displayed in a collapsible section at the top.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Why Your Principal Matters</h3>
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
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Token Management</h2>
                    
                    <p style={styles.paragraph}>
                        The Wallet page displays all tokens you've added, along with their balances, locked amounts, 
                        and USD values (when available).
                    </p>
                    
                    <h3 style={styles.subsubheading}>Adding Tokens to Your Wallet</h3>
                    <p style={styles.paragraph}>
                        To track a token in your wallet, click the <strong style={styles.strong}>"+ Add Token"</strong> button 
                        and enter the ICRC-1 ledger canister ID. Once added, the wallet will display:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>Token symbol, name, and logo</li>
                        <li style={styles.listItem}>Total balance (available + locked)</li>
                        <li style={styles.listItem}>Available balance (what you can send or lock)</li>
                        <li style={styles.listItem}>Locked balance (tokens in <Link to="/help/sneedlock" style={styles.link}>Sneedlock</Link>)</li>
                        <li style={styles.listItem}>USD value (when conversion rates are available)</li>
                    </ul>
                    
                    <h3 style={styles.subsubheading}>Token Operations</h3>
                    
                    <h4 style={{...styles.subsubheading, fontSize: '1.1rem'}}>📤 Send Tokens</h4>
                    <p style={styles.paragraph}>
                        Transfer tokens to any principal ID or account address. Click the <strong style={styles.strong}>"Send"</strong> button,
                        enter the recipient's principal, the amount, and an optional memo. The wallet will automatically calculate 
                        the transfer fee.
                    </p>
                    
                    <h4 style={{...styles.subsubheading, fontSize: '1.1rem'}}>🔒 Lock Tokens</h4>
                    <p style={styles.paragraph}>
                        Lock tokens for a specified time period using <Link to="/help/sneedlock" style={styles.link}>Sneedlock</Link>. 
                        This is useful for commitment demonstrations, vesting schedules, or governance participation. Click the{' '}
                        <strong style={styles.strong}>"Lock"</strong> button to specify the amount and expiration date.
                    </p>
                    <div style={styles.infoBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>Note:</strong> SNEED tokens cannot be locked. Locked tokens 
                            are transferred to the Sneedlock canister and can be withdrawn after the expiration date.
                        </p>
                    </div>
                    
                    <h4 style={{...styles.subsubheading, fontSize: '1.1rem'}}>🔄 Wrap/Unwrap</h4>
                    <p style={styles.paragraph}>
                        For certain token pairs (like GLDT/sGLDT), you can wrap and unwrap tokens. This converts tokens 
                        between their wrapped and native forms. The wallet automatically detects wrappable tokens and 
                        displays the appropriate buttons.
                    </p>
                    
                    <h4 style={{...styles.subsubheading, fontSize: '1.1rem'}}>💰 Claim Rewards</h4>
                    <p style={styles.paragraph}>
                        Some tokens accumulate rewards in the backend. If rewards are available, you'll see a{' '}
                        <strong style={styles.strong}>"Claim Rewards"</strong> button to transfer them to your wallet.
                    </p>
                    
                    <h4 style={{...styles.subsubheading, fontSize: '1.1rem'}}>🗑️ Remove Token</h4>
                    <p style={styles.paragraph}>
                        If you no longer want to track a token, expand its card and click the{' '}
                        <strong style={styles.strong}>"Unregister Token"</strong> button. This only removes it from your 
                        view—it doesn't affect your actual balance.
                    </p>
                </div>

                {/* Liquidity Positions */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Liquidity Position Management</h2>
                    
                    <p style={styles.paragraph}>
                        If you provide liquidity on ICPSwap, your positions will appear in the Wallet page after you 
                        add the swap canister pair.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Adding Swap Pairs</h3>
                    <p style={styles.paragraph}>
                        Click <strong style={styles.strong}>"+ Add Swap Pair"</strong> and enter the ICPSwap canister ID 
                        for the trading pair. The wallet will display all your positions for that pair, including:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>Token pair (e.g., ICP/SNEED)</li>
                        <li style={styles.listItem}>Amounts of each token in the position</li>
                        <li style={styles.listItem}>Unclaimed fees</li>
                        <li style={styles.listItem}>Locked positions (if any are in <Link to="/help/sneedlock" style={styles.link}>Sneedlock</Link>)</li>
                        <li style={styles.listItem}>Total USD value</li>
                    </ul>
                    
                    <h3 style={styles.subsubheading}>Position Operations</h3>
                    
                    <h4 style={{...styles.subsubheading, fontSize: '1.1rem'}}>📤 Send Positions</h4>
                    <p style={styles.paragraph}>
                        Transfer liquidity positions to another principal. This is a unique feature that allows you to 
                        move entire LP positions without closing them.
                    </p>
                    
                    <h4 style={{...styles.subsubheading, fontSize: '1.1rem'}}>🔒 Lock Positions</h4>
                    <p style={styles.paragraph}>
                        Lock entire liquidity positions using <Link to="/help/sneedlock" style={styles.link}>Sneedlock</Link>. 
                        This locks both tokens in the position until the expiration date. See the{' '}
                        <Link to="/help/sneedlock" style={styles.link}>Sneedlock help page</Link> for more details.
                    </p>
                </div>

                {/* SNS Neurons */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>SNS Neuron Management</h2>
                    
                    <p style={styles.paragraph}>
                        The Wallet page displays all your SNS neurons across all SNS DAOs for which you've added tokens. 
                        This provides a unified view of your governance participation across the entire Internet Computer ecosystem.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Neuron Operations in Wallet</h3>
                    <p style={styles.paragraph}>
                        The Wallet page supports comprehensive neuron management. Click on any token card that represents 
                        an SNS governance token to see your neurons and perform these operations:
                    </p>
                    
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Create Neurons:</strong> Stake tokens to create new neurons 
                            with your chosen dissolve delay
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Add Stake:</strong> Increase the stake of existing neurons 
                            to boost voting power
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Set Dissolve Time:</strong> Adjust the dissolve delay, which 
                            affects your voting power multiplier
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Start/Stop Dissolving:</strong> Control the dissolving state 
                            to unlock your tokens or maintain voting power
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Auto-Stake Maturity:</strong> Enable automatic staking of 
                            voting rewards to compound your voting power
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Disburse:</strong> Withdraw tokens from fully dissolved neurons 
                            back to your wallet
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Disburse Maturity:</strong> Claim accumulated voting rewards 
                            as liquid tokens
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Split Neurons:</strong> Split a neuron into two neurons, 
                            useful for managing different voting strategies or transferring partial stakes
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Send Neurons:</strong> Transfer entire neurons to other users' 
                            wallets—a unique Sneed Hub feature not available on the NNS!
                        </li>
                    </ul>
                    
                    <div style={styles.infoBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>Want to learn more?</strong> For detailed information about 
                            SNS neurons, voting, hotkeys, and cross-platform management, see our comprehensive{' '}
                            <Link to="/help/neurons" style={styles.link}>Understanding SNS Neurons</Link> guide.
                        </p>
                    </div>
                    
                    <h3 style={styles.subsubheading}>Additional Neuron Pages</h3>
                    <p style={styles.paragraph}>
                        While the Wallet page provides most neuron operations, other pages offer specialized functionality:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}><Link to="/me" style={styles.link}>/me</Link>:</strong> View 
                            only your neurons for the currently selected SNS
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}><Link to="/neurons" style={styles.link}>/neurons</Link>:</strong> Browse 
                            all neurons in the selected SNS (public neuron browser)
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>/neuron:</strong> Inspect individual neurons, manage detailed 
                            permissions, configure following relationships, and vote on proposals
                        </li>
                    </ul>
                </div>

                {/* Portfolio Overview */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Portfolio Overview</h2>
                    
                    <p style={styles.paragraph}>
                        At the top of the Wallet page, you'll see your total portfolio value in USD. This aggregates:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>All token balances (both available and locked)</li>
                        <li style={styles.listItem}>All liquidity position values</li>
                        <li style={styles.listItem}>All neuron stakes</li>
                    </ul>
                    
                    <p style={styles.paragraph}>
                        The portfolio value is calculated using real-time conversion rates when available. Tokens without 
                        price data won't be included in the total but are still tracked in your wallet.
                    </p>
                </div>

                {/* Tips and Best Practices */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Tips and Best Practices</h2>
                    
                    <div style={styles.tipBox}>
                        <h3 style={{...styles.subsubheading, marginTop: 0}}>
                            💡 Wallet Management Tips
                        </h3>
                        <ul style={{...styles.list, marginBottom: 0}}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Keep Your Principal Handy:</strong> Save your principal ID 
                                in a secure location for easy access when receiving assets
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Verify Before Sending:</strong> Always double-check recipient 
                                addresses before sending tokens, positions, or neurons—transfers are irreversible
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Monitor Locked Assets:</strong> Keep track of lock expiration 
                                dates for your tokens and positions
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Claim Fees Regularly:</strong> If you have liquidity positions, 
                                remember to claim accumulated trading fees
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Organize Your Tokens:</strong> Remove tokens you no longer 
                                track to keep your wallet view clean and focused
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Enable Auto-Stake for Neurons:</strong> Consider enabling 
                                automatic maturity staking for your neurons to compound your voting rewards
                            </li>
                        </ul>
                    </div>
                </div>

                {/* Common Questions */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Common Questions</h2>
                    
                    <h3 style={styles.subsubheading}>Why is my balance different from what I expect?</h3>
                    <p style={styles.paragraph}>
                        Your balance might appear different if:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>Some tokens are locked in Sneedlock</li>
                        <li style={styles.listItem}>Tokens are staked in neurons</li>
                        <li style={styles.listItem}>You have pending transactions</li>
                        <li style={styles.listItem}>The wallet is showing "available" balance instead of "total" balance</li>
                    </ul>
                    
                    <h3 style={styles.subsubheading}>Can I cancel a lock?</h3>
                    <p style={styles.paragraph}>
                        No, locks are immutable once created. You must wait until the expiration date to withdraw your 
                        locked assets. This is by design to ensure commitment and prevent premature withdrawals.
                    </p>
                    
                    <h3 style={styles.subsubheading}>What happens if I remove a token from my wallet view?</h3>
                    <p style={styles.paragraph}>
                        Removing a token only hides it from your wallet display. Your actual balance remains unchanged on 
                        the blockchain, and you can always add the token back by entering its ledger canister ID again.
                    </p>
                    
                    <h3 style={styles.subsubheading}>How do transfer fees work?</h3>
                    <p style={styles.paragraph}>
                        Each token has its own transfer fee set by the ledger. When sending tokens, the wallet automatically 
                        deducts the fee from your balance. Make sure you have enough balance to cover both the amount you're 
                        sending and the fee.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Can I access my wallet from multiple devices?</h3>
                    <p style={styles.paragraph}>
                        Yes! Your wallet is associated with your Internet Identity or authentication method. You can log in 
                        from any device using the same identity to access your assets. Your principal ID remains the same 
                        across all devices.
                    </p>
                </div>

                {/* Related Pages */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Related Help Topics</h2>
                    
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <Link to="/help/neurons" style={styles.link}>Understanding SNS Neurons</Link> - Learn about 
                            neuron management, voting, and hotkeys
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/sneedlock" style={styles.link}>Understanding Sneedlock</Link> - Learn how to 
                            lock tokens and liquidity positions
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help" style={styles.link}>Help Center</Link> - Browse all help topics
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    );
}

export default HelpWallet;

