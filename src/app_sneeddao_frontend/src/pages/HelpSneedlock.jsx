import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';

function HelpSneedlock() {
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
        successBox: {
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
        errorBox: {
            background: `${theme.colors.error}15`,
            border: `1px solid ${theme.colors.error}50`,
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
            <Header customLogo="/sneedlock-logo4.png" />
            <div style={styles.content}>
                <h1 style={styles.heading}>Understanding Sneedlock</h1>
                
                <p style={styles.paragraph}>
                    Sneedlock is a trustless time-locking service for tokens and liquidity positions on the Internet Computer. 
                    It allows you to lock assets for a specified period, proving commitment and enabling various use cases 
                    like vesting schedules, governance participation, and trust-building mechanisms.
                </p>

                {/* What is Sneedlock */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>What is Sneedlock?</h2>
                    
                    <p style={styles.paragraph}>
                        Sneedlock is a canister (smart contract) that holds tokens and liquidity positions on your behalf 
                        until a predetermined expiration date. Once locked, assets cannot be accessed by anyone—including you—until 
                        the lock expires. This creates a verifiable, on-chain proof of long-term commitment.
                    </p>
                    
                    <div style={styles.infoBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>Key Feature:</strong> Locks are immutable and trustless. Even the 
                            Sneedlock canister itself cannot release your assets before the expiration date. This is enforced 
                            at the protocol level, ensuring complete security and transparency.
                        </p>
                    </div>
                </div>

                {/* Why Lock Assets */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Why Lock Assets?</h2>
                    
                    <p style={styles.paragraph}>
                        Locking assets serves multiple purposes in the decentralized ecosystem:
                    </p>
                    
                    <h3 style={styles.subsubheading}>1. Demonstrate Commitment</h3>
                    <p style={styles.paragraph}>
                        By locking tokens, you provide verifiable proof that you're committed to a project for the long term. 
                        This is especially valuable for:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>Project founders showing commitment to their community</li>
                        <li style={styles.listItem}>Team members demonstrating long-term alignment</li>
                        <li style={styles.listItem}>Investors proving they won't immediately dump tokens</li>
                    </ul>
                    
                    <h3 style={styles.subsubheading}>2. Vesting Schedules</h3>
                    <p style={styles.paragraph}>
                        Create custom vesting arrangements by locking tokens or liquidity positions with different expiration 
                        dates. This is commonly used for:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>Team token allocations that unlock over time</li>
                        <li style={styles.listItem}>Investor tokens with cliff and vesting periods</li>
                        <li style={styles.listItem}>Grant distributions with milestone-based unlocks</li>
                    </ul>
                    
                    <h3 style={styles.subsubheading}>3. Liquidity Provision Commitment</h3>
                    <p style={styles.paragraph}>
                        For liquidity providers, locking LP positions demonstrates that you won't suddenly remove liquidity, 
                        which helps stabilize trading pairs and builds trust with traders and other LPs.
                    </p>
                    
                    <h3 style={styles.subsubheading}>4. Governance Participation</h3>
                    <p style={styles.paragraph}>
                        Some DAOs may require or incentivize locking tokens as a prerequisite for governance participation, 
                        ensuring voters have long-term skin in the game.
                    </p>
                </div>

                {/* How to Lock Tokens */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>How to Lock Tokens</h2>
                    
                    <p style={styles.paragraph}>
                        Token locking can be done through the <Link to="/wallet" style={styles.link}>Wallet page</Link> or 
                        using the guided <Link to="/lock_wizard" style={styles.link}>Lock Wizard</Link>. Here's 
                        the step-by-step process:
                    </p>
                    
                    <div style={styles.successBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>🧙 New to Locking?</strong> Try the{' '}
                            <Link to="/lock_wizard" style={styles.link}>Lock Wizard</Link> for a guided step-by-step 
                            experience that walks you through selecting what to lock and configuring your lock parameters.
                        </p>
                    </div>
                    
                    <h3 style={styles.subsubheading}>Step 1: Navigate to Your Wallet</h3>
                    <p style={styles.paragraph}>
                        Go to the <Link to="/wallet" style={styles.link}>Wallet page</Link> and find the token you want to lock. 
                        Make sure you have sufficient available balance (not already locked or staked).
                    </p>
                    
                    <h3 style={styles.subsubheading}>Step 2: Open the Lock Modal</h3>
                    <p style={styles.paragraph}>
                        Expand the token card and click the <strong style={styles.strong}>"Lock"</strong> button. This opens 
                        the lock creation dialog.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Step 3: Configure the Lock</h3>
                    <p style={styles.paragraph}>
                        In the lock dialog, you need to specify:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Amount:</strong> How many tokens to lock. You can click "MAX" to 
                            lock all available tokens (minus the transfer fee).
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Expiration Date:</strong> When the lock expires and you can withdraw 
                            your tokens. Must be in the future and within the maximum lock duration.
                        </li>
                    </ul>
                    
                    <h3 style={styles.subsubheading}>Step 4: Confirm and Execute</h3>
                    <p style={styles.paragraph}>
                        Review the lock details carefully. Once confirmed, your tokens will be:
                    </p>
                    <ol style={styles.list}>
                        <li style={styles.listItem}>Deposited from your wallet to your Sneed Hub subaccount (if not already deposited)</li>
                        <li style={styles.listItem}>Locked with your specified expiration date</li>
                        <li style={styles.listItem}>Displayed in the "Locked" section of your token card</li>
                    </ol>
                    
                    <div style={styles.infoBox}>
                        <p style={{...styles.paragraph, marginBottom: '0.5rem'}}>
                            <strong style={styles.strong}>💡 Transaction Fees for Locking:</strong>
                        </p>
                        <ul style={{...styles.list, marginBottom: '0.5rem'}}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>If locking already-deposited tokens:</strong> FREE! Locking tokens that are 
                                already in your deposited balance incurs <strong style={styles.strong}>no transaction fee</strong>. This means 
                                you can lock your entire deposited (unlocked) amount without losing any tokens to fees.
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>If locking tokens from your wallet:</strong> The system will automatically 
                                deposit them first, which costs <strong style={styles.strong}>1 transaction fee</strong>. Any funds not yet 
                                deposited will be transferred to your deposited balance automatically as part of the lock process.
                            </li>
                        </ul>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>Tip:</strong> If you're creating <strong style={styles.strong}>multiple locks</strong>, 
                            batch deposit all the tokens first using the Deposit button in the Liquid section! This way you only pay one 
                            deposit fee, then can create multiple locks for free (0 tx fees per lock) from your deposited balance. For a 
                            single lock, there's no fee difference between depositing first or locking directly from your wallet.
                        </p>
                    </div>
                    
                    <div style={styles.warningBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>⚠️ Important:</strong> Once a lock is created, it cannot be 
                            canceled, modified, or unlocked early. Make absolutely sure the amount and expiration date 
                            are correct before confirming!
                        </p>
                    </div>
                </div>

                {/* How to Lock Liquidity Positions */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>How to Lock Liquidity Positions</h2>
                    
                    <p style={styles.paragraph}>
                        You can lock entire liquidity positions (LP positions) from ICPSwap, which locks both tokens in 
                        the position simultaneously.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Step 1: Add Your Swap Pair</h3>
                    <p style={styles.paragraph}>
                        On the <Link to="/wallet" style={styles.link}>Wallet page</Link>, make sure you've added the ICPSwap 
                        canister for your liquidity pair using the <strong style={styles.strong}>"+ Add Swap Pair"</strong> button.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Step 2: Transfer Position to Sneed Wallet</h3>
                    <p style={styles.paragraph}>
                        Before you can lock a position in Sneed Hub, you need to transfer it from your ICPSwap wallet to 
                        your Sneed Wallet principal:
                    </p>
                    <ol style={styles.list}>
                        <li style={styles.listItem}>
                            Copy your Sneed Wallet principal from the <Link to="/wallet" style={styles.link}>Wallet page</Link> 
                            (displayed at the top in the collapsible section)
                        </li>
                        <li style={styles.listItem}>
                            Go to ICPSwap and find your liquidity position
                        </li>
                        <li style={styles.listItem}>
                            Use ICPSwap's transfer function to send the position to your Sneed Wallet principal
                        </li>
                        <li style={styles.listItem}>
                            Return to Sneed Hub and refresh your wallet—the position should now appear in your Liquidity Positions
                        </li>
                    </ol>
                    
                    <h3 style={styles.subsubheading}>Step 3: Select the Position</h3>
                    <p style={styles.paragraph}>
                        Find the position you want to lock in the Liquidity Positions section of your wallet. Expand the card for 
                        your position.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Step 4: Lock the Position</h3>
                    <p style={styles.paragraph}>
                        Click the <strong style={styles.strong}>"Lock Position"</strong> button and specify the expiration date. 
                        The entire position (both tokens and any unclaimed fees) will be locked.
                    </p>
                    
                    <div style={styles.successBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>💰 Claim Fees from Locked Positions:</strong> When you lock a liquidity 
                            position, you're locking the position itself, not just the underlying tokens. The position continues 
                            to earn trading fees while locked, and you can <strong style={styles.strong}>claim those fees directly 
                            from your wallet even while the position remains locked!</strong> You cannot withdraw, modify the liquidity 
                            amounts, or pull the position until the lock expires, but you retain full access to the trading fees 
                            it generates.
                        </p>
                    </div>
                </div>

                {/* Viewing Your Locks */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Viewing Your Locks</h2>
                    
                    <h3 style={styles.subsubheading}>In Your Wallet</h3>
                    <p style={styles.paragraph}>
                        The <Link to="/wallet" style={styles.link}>Wallet page</Link> displays your locks in two ways:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Token Cards:</strong> Each token card shows your locked balance 
                            and, when expanded, lists individual locks with their amounts and expiration dates
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Position Cards:</strong> Locked liquidity positions are marked 
                            and show lock details including the owner (you) and expiration date
                        </li>
                    </ul>
                    
                    <h3 style={styles.subsubheading}>Public Sneedlock Dashboard</h3>
                    <p style={styles.paragraph}>
                        All locks are publicly visible for transparency. You can view aggregate lock 
                        information and individual locks through the <Link to="/sneedlock_info" style={styles.link}>SneedLock Dashboard</Link>. This allows anyone to 
                        verify commitments and see total locked amounts.
                    </p>
                </div>

                {/* Unlocking Assets */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Unlocking Assets After Expiration</h2>
                    
                    <p style={styles.paragraph}>
                        Once a lock reaches its expiration date, you can withdraw your assets back to your wallet.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Unlocking Tokens</h3>
                    <p style={styles.paragraph}>
                        When a token lock expires, it automatically disappears—no action needed! Your tokens are automatically 
                        unlocked and will appear in your <strong style={styles.strong}>"Liquid"</strong> balance:
                    </p>
                    <ol style={styles.list}>
                        <li style={styles.listItem}>Go to your <Link to="/wallet" style={styles.link}>Wallet page</Link></li>
                        <li style={styles.listItem}>Your unlocked tokens will now be included in the "Liquid" balance</li>
                        <li style={styles.listItem}>Expand the "Liquid" section to see the breakdown—you'll notice tokens in your deposited balance</li>
                        <li style={styles.listItem}>You can now use these tokens immediately!</li>
                    </ol>
                    <p style={styles.paragraph}>
                        <strong style={styles.strong}>Note:</strong> You don't need to withdraw tokens from your deposited balance 
                        to use them. When you send tokens, the wallet automatically combines balances from both your wallet 
                        and deposited balance. However, if you prefer to have everything in your wallet, you can click 
                        the <strong style={styles.strong}>"Withdraw"</strong> button in the expanded Liquid section.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Unlocking Liquidity Positions</h3>
                    <p style={styles.paragraph}>
                        For position locks that have expired:
                    </p>
                    <ol style={styles.list}>
                        <li style={styles.listItem}>Navigate to your locked position in the <Link to="/wallet" style={styles.link}>Wallet page</Link></li>
                        <li style={styles.listItem}>Once the lock has expired, the position remains deposited but becomes unlocked</li>
                        <li style={styles.listItem}>You can now <strong style={styles.strong}>Send</strong> the position to another address directly from your deposited balance</li>
                        <li style={styles.listItem}>Or click <strong style={styles.strong}>"Withdraw"</strong> to transfer the position back to your wallet</li>
                    </ol>
                    <p style={styles.paragraph}>
                        The position stays deposited after unlock, giving you the flexibility to either send it to someone else 
                        or withdraw it back to your wallet for management on ICPSwap.
                    </p>
                </div>

                {/* Liquid Locking - Transferring Locked Assets */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Liquid Locking: Transferring Locked Assets</h2>
                    
                    <p style={styles.paragraph}>
                        One of Sneedlock's most powerful features is <strong style={styles.strong}>"Liquid Locking"</strong>—the 
                        ability to transfer ownership of locked assets <strong style={styles.strong}>while they remain locked</strong>. 
                        This creates a revolutionary combination: <strong style={styles.strong}>liquidity without compromising security</strong>.
                    </p>
                    
                    <div style={styles.successBox}>
                        <h3 style={{...styles.subsubheading, marginTop: 0}}>
                            🚀 Why Liquid Locking Changes Everything
                        </h3>
                        <p style={styles.paragraph}>
                            <strong style={styles.strong}>Isn't transferring locked assets exactly what locks prevent?</strong> 
                            No! The locks remain fully enforced:
                        </p>
                        <ul style={{...styles.list, marginBottom: '0.5rem'}}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Locked LP Positions:</strong> The recipient still cannot pull 
                                liquidity until the lock expires, but they CAN claim the trading fees the position generates
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Locked Tokens:</strong> The recipient cannot sell them or use 
                                them normally—they can only hold them or transfer the entire lock to someone else
                            </li>
                        </ul>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            This means locked positions and tokens can be <strong style={styles.strong}>liquid</strong> (tradeable/transferable) 
                            without making rugs possible. Liquidity in pools stays locked. Big token positions can change ownership but 
                            cannot be dumped into pools. This creates <strong style={styles.strong}>greater liquidity AND greater safety</strong> for 
                            ICP token traders.
                        </p>
                    </div>
                    
                    <h3 style={styles.subsubheading}>Transferring Locked Token Locks</h3>
                    <p style={styles.paragraph}>
                        For active token locks, you can transfer ownership to another principal:
                    </p>
                    <ol style={styles.list}>
                        <li style={styles.listItem}>Go to your <Link to="/wallet" style={styles.link}>Wallet page</Link> and expand the token card</li>
                        <li style={styles.listItem}>In the Locks section, find the lock you want to transfer</li>
                        <li style={styles.listItem}>Click the <strong style={styles.strong}>"Transfer Ownership"</strong> button</li>
                        <li style={styles.listItem}>Enter the recipient's principal ID</li>
                        <li style={styles.listItem}>Confirm the transfer</li>
                    </ol>
                    <p style={styles.paragraph}>
                        The tokens remain locked on the backend with the same expiration date, but ownership is transferred to the 
                        recipient. The recipient will be able to withdraw the tokens once the lock expires.
                    </p>
                    
                    <div style={styles.infoBox}>
                        <p style={{...styles.paragraph, marginBottom: '0.5rem'}}>
                            <strong style={styles.strong}>Transaction Fees:</strong> Transferring a token lock costs either{' '}
                            <strong style={styles.strong}>1 or 2 transaction fees</strong> depending on your deposited balance:
                        </p>
                        <ul style={{...styles.list, marginBottom: '0.5rem'}}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>If you have at least 1 tx fee in your deposited balance:</strong> Only 1 tx fee is required 
                                (the fee is paid from your deposited balance)
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>If you have less than 1 tx fee deposited:</strong> 2 tx fees total—the system will 
                                automatically transfer 1 tx fee from your wallet to your deposited balance first, then use it for the transfer
                            </li>
                        </ul>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>Tip:</strong> Keep at least 1 tx fee in your deposited balance for each token type 
                            you plan to transfer locks for—this saves you fees in the long run!
                        </p>
                    </div>
                    
                    <div style={styles.infoBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>Note:</strong> The tokens stay locked and cannot be used before the 
                            lock expires, regardless of who owns them. This ensures the commitment remains intact even when 
                            ownership changes.
                        </p>
                    </div>
                    
                    <h3 style={styles.subsubheading}>Transferring Locked Liquidity Positions</h3>
                    <p style={styles.paragraph}>
                        Similarly, you can transfer ownership of locked liquidity positions:
                    </p>
                    <ol style={styles.list}>
                        <li style={styles.listItem}>Navigate to the locked position in your <Link to="/wallet" style={styles.link}>Wallet page</Link></li>
                        <li style={styles.listItem}>Expand the position card to see details</li>
                        <li style={styles.listItem}>Click the <strong style={styles.strong}>"Transfer"</strong> button (available even when locked)</li>
                        <li style={styles.listItem}>Enter the recipient's principal ID</li>
                        <li style={styles.listItem}>Confirm the transfer</li>
                    </ol>
                    <p style={styles.paragraph}>
                        The position remains locked and continues earning trading fees. The recipient becomes the owner and can 
                        <strong style={styles.strong}> claim the trading fees</strong> the position generates, but they cannot 
                        pull liquidity or modify the position until the lock expires, ensuring the commitment is preserved.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Use Cases for Lock Transfers (Liquid Locking)</h3>
                    <p style={styles.paragraph}>
                        Liquid Locking enables several powerful use cases:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Easy team token distribution:</strong> Token creators can create 
                            multiple locked token allocations and then simply transfer the token locks to team members. The 
                            team receives their tokens immediately but cannot dump them until the vesting period expires—all 
                            without complex smart contracts!
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Vesting transfers:</strong> Transfer vested tokens to employees or 
                            contributors while maintaining the vesting schedule
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Secondary market for locked positions:</strong> Sell locked tokens or 
                            LP positions at a discount. Buyers get exposure to assets at lower prices, sellers get liquidity, 
                            and the lock provides security for both parties by preventing rugs
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>DAO treasuries:</strong> Transfer locked liquidity positions to a DAO 
                            while keeping the commitment guarantee. The DAO can even claim trading fees from locked LP positions!
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Inheritance planning:</strong> Transfer locked assets to family members 
                            or beneficiaries
                        </li>
                    </ul>
                    
                    <div style={styles.warningBox}>
                        <p style={{...styles.paragraph, marginBottom: '0.5rem'}}>
                            <strong style={styles.strong}>⚠️ Important Warnings:</strong>
                        </p>
                        <ul style={{...styles.list, marginBottom: 0}}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Wallet Compatibility:</strong> Only transfer locked positions 
                                to recipient wallets that support Sneed Lock! Currently, this means only Sneed Wallet principals. 
                                Transferring locked assets to incompatible wallets (like exchanges or other wallet types) may 
                                result in permanent loss of access.
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Permanent Transfers:</strong> Lock transfers are permanent. Once you 
                                transfer ownership of a locked asset, you cannot get it back unless the recipient transfers it back 
                                to you. Double-check the recipient principal before confirming!
                            </li>
                        </ul>
                    </div>
                </div>

                {/* Fees and Limits */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Fees and Limits</h2>
                    
                    <h3 style={styles.subsubheading}>Lock Fees</h3>
                    <p style={styles.paragraph}>
                        Creating a lock requires a small fee paid in SNEED tokens. This fee helps maintain the Sneedlock 
                        canister and prevents spam. The current fee is displayed when you create a lock.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Maximum Lock Duration</h3>
                    <p style={styles.paragraph}>
                        There is a maximum lock duration limit (configured by the Sneedlock canister). You cannot create 
                        locks that expire beyond this limit. The current maximum is displayed in the lock creation dialog.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Minimum Lock Amounts</h3>
                    <p style={styles.paragraph}>
                        Each lock must meet a minimum amount to be created. This is typically the token's transfer fee 
                        plus a small buffer to ensure the lock is economically meaningful.
                    </p>
                    
                    <div style={styles.errorBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>⚠️ SNEED Cannot Be Locked:</strong> SNEED tokens (the governance 
                            token of Sneed DAO) cannot be locked in Sneedlock. If you try to lock SNEED, you'll receive 
                            an error message. All other ICRC-1 tokens can be locked normally.
                        </p>
                    </div>
                </div>

                {/* Use Cases and Examples */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Use Cases and Examples</h2>
                    
                    <h3 style={styles.subsubheading}>Example 1: Team Token Vesting</h3>
                    <p style={styles.paragraph}>
                        A project team member receives 10,000 tokens with a 2-year vesting schedule:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>Lock 2,500 tokens expiring in 6 months</li>
                        <li style={styles.listItem}>Lock 2,500 tokens expiring in 12 months</li>
                        <li style={styles.listItem}>Lock 2,500 tokens expiring in 18 months</li>
                        <li style={styles.listItem}>Lock 2,500 tokens expiring in 24 months</li>
                    </ul>
                    <p style={styles.paragraph}>
                        This creates four separate locks that unlock quarterly, demonstrating long-term commitment while 
                        providing regular liquidity.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Example 2: Liquidity Provider Commitment</h3>
                    <p style={styles.paragraph}>
                        An LP wants to prove they won't remove liquidity from a new trading pair:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>Provide liquidity on ICPSwap for TOKEN/ICP pair</li>
                        <li style={styles.listItem}>Lock the entire position for 6 months</li>
                        <li style={styles.listItem}>Share the lock proof with the community</li>
                    </ul>
                    <p style={styles.paragraph}>
                        This builds trust with traders and other LPs, encouraging more participation in the pool.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Example 3: Founder Commitment Signal</h3>
                    <p style={styles.paragraph}>
                        A project founder locks their token allocation to demonstrate long-term alignment:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>Lock 100,000 tokens for 1 year</li>
                        <li style={styles.listItem}>Lock another 100,000 tokens for 2 years</li>
                        <li style={styles.listItem}>Keep 50,000 tokens liquid for operational needs</li>
                    </ul>
                    <p style={styles.paragraph}>
                        The community can verify these locks on-chain, providing confidence that the founder isn't 
                        planning to exit in the near term.
                    </p>
                </div>

                {/* Security and Trust */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Security and Trust</h2>
                    
                    <h3 style={styles.subsubheading}>Trustless by Design</h3>
                    <p style={styles.paragraph}>
                        Sneedlock is completely trustless. Once assets are locked:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>No One Can Access Them Early:</strong> Not you, not the Sneedlock 
                            operators, not anyone. The lock is enforced by the Internet Computer's execution environment.
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Publicly Verifiable:</strong> All locks are recorded on-chain 
                            and can be independently verified by anyone.
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Immutable:</strong> Lock parameters cannot be changed after 
                            creation, preventing any manipulation or alteration.
                        </li>
                    </ul>
                    
                    <h3 style={styles.subsubheading}>Asset Custody</h3>
                    <p style={styles.paragraph}>
                        When you lock assets, they are transferred to and held by the Sneedlock canister. The canister 
                        has strict rules that prevent any withdrawals before the expiration date. Your assets remain yours 
                        and are returned to you automatically once the lock expires (you just need to initiate the withdrawal).
                    </p>
                    
                    <div style={styles.successBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>✓ Safe and Secure:</strong>The Sneed Lock canister code is open-source and can be reviewed by anyone. Your locked 
                            assets are protected by the Internet Computer's SNS DAO security guarantees.
                        </p>
                    </div>
                </div>

                {/* Common Questions */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Common Questions</h2>
                    
                    <h3 style={styles.subsubheading}>Can I cancel or shorten a lock?</h3>
                    <p style={styles.paragraph}>
                        No. Locks are immutable and cannot be canceled, shortened, or modified in any way. This is a 
                        fundamental security feature that ensures commitment and trust. Always verify the lock parameters 
                        carefully before confirming.
                    </p>
                    
                    <h3 style={styles.subsubheading}>What happens if I forget about my lock?</h3>
                    <p style={styles.paragraph}>
                        Your locked assets remain safely in the Sneedlock canister indefinitely after they expire. There's 
                        no time limit for claiming expired locks—you can withdraw them whenever you remember, even years later.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Can I transfer a lock to someone else?</h3>
                    <p style={styles.paragraph}>
                        Yes! Sneedlock 2.0 supports transferring ownership of locked assets while they remain locked. 
                        Both token locks and locked liquidity positions can be transferred to another principal. The lock 
                        expiration and all other parameters remain unchanged—only the owner changes. See the 
                        "Transferring Locked Assets" section above for details.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Do locked assets still earn rewards?</h3>
                    <p style={styles.paragraph}>
                        It depends on the type of lock:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Locked Tokens:</strong> Regular token locks typically don't earn 
                            staking or governance rewards because they're held in the Sneedlock canister, not staked in governance.
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Locked LP Positions:</strong> These continue to earn trading fees 
                            while locked, and you can <strong style={styles.strong}>claim those fees directly from your wallet 
                            even while the position remains locked!</strong> This means your locked liquidity keeps working for you.
                        </li>
                    </ul>
                    
                    <h3 style={styles.subsubheading}>Why can't I lock SNEED tokens?</h3>
                    <p style={styles.paragraph}>
                        SNEED is the governance token for Sneed DAO. To prevent potential conflicts between token locking 
                        and governance participation (where tokens need to be staked in neurons), SNEED tokens are 
                        explicitly excluded from Sneedlock. If you want to demonstrate commitment with SNEED, use the 
                        neuron system instead (see <Link to="/help/neurons" style={styles.link}>Understanding SNS Neurons</Link>).
                    </p>
                    
                    <h3 style={styles.subsubheading}>Can I add more tokens to an existing lock?</h3>
                    <p style={styles.paragraph}>
                        No. Each lock is independent. If you want to lock more tokens, you need to create a new lock. 
                        You can have multiple locks for the same token with different amounts and expiration dates.
                    </p>
                    
                    <h3 style={styles.subsubheading}>What happens if the Sneedlock canister is upgraded?</h3>
                    <p style={styles.paragraph}>
                        The Sneedlock canister can be upgraded to add new features or fix issues, but the core locking 
                        logic is immutable. Your existing locks are guaranteed to remain secure and unlockable at their 
                        original expiration dates, regardless of any upgrades.
                    </p>
                </div>

                {/* Related Pages */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Related Help Topics</h2>
                    
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <Link to="/lock_wizard" style={styles.link}>Lock Wizard</Link> - Guided step-by-step lock creation
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/wallet" style={styles.link}>Understanding Your Wallet</Link> - Learn how to 
                            manage tokens, positions, and neurons in your wallet
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/neurons" style={styles.link}>Understanding SNS Neurons</Link> - Alternative 
                            commitment mechanism for governance tokens
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/wallet" style={styles.link}>Go to Wallet</Link> - Manage your assets and create locks
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/sneedlock_info" style={styles.link}>SneedLock Dashboard</Link> - View all locks and aggregate statistics
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

export default HelpSneedlock;

