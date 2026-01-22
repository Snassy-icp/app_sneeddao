import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import { Principal } from '@dfinity/principal';
import { 
    createSneedPremiumActor, 
    formatDuration, 
    formatIcp, 
    formatVotingPower,
    formatTimestamp,
    getTimeRemaining,
    isMembershipActive,
    E8S_PER_ICP,
    SNEED_PREMIUM_CANISTER_ID
} from '../utils/SneedPremiumUtils';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import InfoModal from '../components/InfoModal';
import ConfirmationModal from '../ConfirmationModal';
import { 
    FaCrown, FaSpinner, FaCoins, FaVoteYea, FaClock, FaCheckCircle, 
    FaTimesCircle, FaExclamationTriangle, FaArrowRight, FaWallet,
    FaGift, FaShieldAlt, FaStar, FaRocket
} from 'react-icons/fa';

// ICP Ledger canister ID (mainnet)
const ICP_LEDGER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';

export default function Premium() {
    const { isAuthenticated, identity } = useAuth();
    const { theme } = useTheme();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    
    // Actor ref
    const actorRef = useRef(null);
    
    // State
    const [membershipStatus, setMembershipStatus] = useState(null);
    const [icpTiers, setIcpTiers] = useState([]);
    const [vpTiers, setVpTiers] = useState([]);
    const [depositAccount, setDepositAccount] = useState(null);
    const [depositBalance, setDepositBalance] = useState(null);
    const [selectedIcpTier, setSelectedIcpTier] = useState(null);
    const [canisterId, setCanisterId] = useState(null);
    
    // Loading states
    const [purchasing, setPurchasing] = useState(false);
    const [claiming, setClaiming] = useState(false);
    const [checkingBalance, setCheckingBalance] = useState(false);
    
    // Modals
    const [infoModal, setInfoModal] = useState({ show: false, title: '', message: '', type: 'info' });
    const [confirmModal, setConfirmModal] = useState({ show: false, message: '', onConfirm: null });
    
    const showInfo = (title, message, type = 'info') => {
        setInfoModal({ show: true, title, message, type });
    };
    
    const closeInfoModal = () => {
        setInfoModal({ ...infoModal, show: false });
    };
    
    const showConfirm = (message, onConfirm) => {
        setConfirmModal({ show: true, message, onConfirm });
    };
    
    const closeConfirmModal = () => {
        setConfirmModal({ ...confirmModal, show: false });
    };
    
    // Get or create actor
    const getActor = useCallback(async () => {
        if (!identity) return null;
        if (!actorRef.current) {
            actorRef.current = await createSneedPremiumActor(identity);
        }
        return actorRef.current;
    }, [identity]);
    
    // Reset actor when identity changes
    useEffect(() => {
        actorRef.current = null;
    }, [identity]);
    
    // Fetch data
    const fetchData = useCallback(async () => {
        setLoading(true);
        setError('');
        
        try {
            const actor = await getActor();
            if (!actor) {
                // Unauthenticated - fetch public data only
                const anonActor = await createSneedPremiumActor();
                const [icpTiersResult, vpTiersResult, canisterIdResult] = await Promise.all([
                    anonActor.getIcpTiers(),
                    anonActor.getVotingPowerTiers(),
                    anonActor.getCanisterId(),
                ]);
                setIcpTiers(icpTiersResult);
                setVpTiers(vpTiersResult);
                setCanisterId(canisterIdResult);
                setLoading(false);
                return;
            }
            
            const principal = identity.getPrincipal();
            
            const [statusResult, icpTiersResult, vpTiersResult, depositResult, canisterIdResult] = await Promise.all([
                actor.checkMembership(principal),
                actor.getIcpTiers(),
                actor.getVotingPowerTiers(),
                actor.getDepositAccount(principal),
                actor.getCanisterId(),
            ]);
            
            setMembershipStatus(statusResult);
            setIcpTiers(icpTiersResult);
            setVpTiers(vpTiersResult);
            setDepositAccount(depositResult);
            setCanisterId(canisterIdResult);
            
            // Auto-select first tier if any
            if (icpTiersResult.length > 0) {
                setSelectedIcpTier(0);
            }
            
        } catch (err) {
            console.error('Failed to fetch premium data:', err);
            setError('Failed to load premium data: ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [identity, getActor]);
    
    useEffect(() => {
        fetchData();
    }, [fetchData]);
    
    // Check deposit balance
    const checkDepositBalance = async () => {
        if (!depositAccount || !identity) return;
        
        setCheckingBalance(true);
        try {
            const icpLedger = createIcrc1Actor(ICP_LEDGER_ID, { agentOptions: { identity, host: 'https://icp-api.io' } });
            const balance = await icpLedger.icrc1_balance_of(depositAccount);
            setDepositBalance(balance);
        } catch (err) {
            console.error('Failed to check balance:', err);
            showInfo('Error', 'Failed to check deposit balance: ' + err.message, 'error');
        }
        setCheckingBalance(false);
    };
    
    // Purchase with ICP
    const handlePurchase = async () => {
        if (selectedIcpTier === null) {
            showInfo('Select Tier', 'Please select a membership tier first', 'error');
            return;
        }
        
        const tier = icpTiers[selectedIcpTier];
        
        showConfirm(
            `Complete your purchase of "${tier.name}"?\n\nThis will use ${formatIcp(tier.amountE8s)} from your deposit account to grant you ${formatDuration(tier.durationNs)} of premium membership.`,
            () => doPurchase()
        );
    };
    
    const doPurchase = async () => {
        closeConfirmModal();
        setPurchasing(true);
        
        try {
            const actor = await getActor();
            const result = await actor.purchaseWithIcp();
            
            if ('ok' in result) {
                showInfo('🎉 Success!', `You are now a Sneed Premium member!\n\nYour membership expires: ${formatTimestamp(result.ok.expiration)}`, 'success');
                await fetchData();
                await checkDepositBalance();
            } else {
                const err = result.err;
                let errorMessage = 'Purchase failed';
                if ('InsufficientPayment' in err) {
                    errorMessage = `Insufficient funds. Required: ${formatIcp(err.InsufficientPayment.required)}, but your deposit has: ${formatIcp(err.InsufficientPayment.received)}`;
                } else if ('InvalidTier' in err) {
                    errorMessage = 'No valid tier found for your deposit amount';
                } else if ('TierNotActive' in err) {
                    errorMessage = 'This tier is not currently active';
                } else if ('TransferFailed' in err) {
                    errorMessage = 'Payment transfer failed: ' + err.TransferFailed;
                } else if ('InternalError' in err) {
                    errorMessage = err.InternalError;
                }
                showInfo('Purchase Failed', errorMessage, 'error');
            }
        } catch (err) {
            showInfo('Error', 'Failed to complete purchase: ' + err.message, 'error');
        }
        
        setPurchasing(false);
    };
    
    // Claim with Voting Power
    const handleClaimVP = async () => {
        showConfirm(
            `Claim premium membership with your Sneed voting power?\n\nThis will check your staked SNEED neurons and grant membership based on your total voting power.`,
            () => doClaimVP()
        );
    };
    
    const doClaimVP = async () => {
        closeConfirmModal();
        setClaiming(true);
        
        try {
            const actor = await getActor();
            const result = await actor.claimWithVotingPower();
            
            if ('ok' in result) {
                showInfo('🎉 Success!', `Premium membership claimed!\n\nYour membership expires: ${formatTimestamp(result.ok.expiration)}`, 'success');
                await fetchData();
            } else {
                const err = result.err;
                let errorMessage = 'Claim failed';
                if ('NoEligibleNeurons' in err) {
                    errorMessage = 'No eligible neurons found for your principal. Make sure you have staked SNEED in the SNS governance.';
                } else if ('InsufficientVotingPower' in err) {
                    errorMessage = `Insufficient voting power. You have ${formatVotingPower(err.InsufficientVotingPower.found)}, but the minimum required is ${formatVotingPower(err.InsufficientVotingPower.required)}.`;
                } else if ('NoActiveTiers' in err) {
                    errorMessage = 'No active voting power tiers configured';
                } else if ('AlreadyClaimedRecently' in err) {
                    errorMessage = 'You have already claimed recently. Please wait before claiming again.';
                } else if ('InternalError' in err) {
                    errorMessage = err.InternalError;
                }
                showInfo('Claim Failed', errorMessage, 'error');
            }
        } catch (err) {
            showInfo('Error', 'Failed to claim membership: ' + err.message, 'error');
        }
        
        setClaiming(false);
    };
    
    // Format subaccount for display
    const formatSubaccount = (subaccount) => {
        if (!subaccount || subaccount.length === 0) return null;
        const bytes = subaccount[0] || subaccount;
        const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
        return hex;
    };
    
    // Copy to clipboard helper
    const copyToClipboard = async (text, label) => {
        try {
            await navigator.clipboard.writeText(text);
            showInfo('Copied!', `${label} copied to clipboard`, 'success');
        } catch (err) {
            showInfo('Error', 'Failed to copy to clipboard', 'error');
        }
    };
    
    // ============================================
    // Styles
    // ============================================
    
    const styles = {
        container: {
            maxWidth: '900px',
            margin: '0 auto',
            padding: '2rem',
            color: theme.colors.primaryText,
        },
        header: {
            textAlign: 'center',
            marginBottom: '2rem',
        },
        title: {
            fontSize: '3rem',
            marginBottom: '0.5rem',
            background: `linear-gradient(135deg, #FFD700, ${theme.colors.accent}, #FFD700)`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
        },
        subtitle: {
            color: theme.colors.mutedText,
            fontSize: '1.2rem',
            maxWidth: '600px',
            margin: '0 auto',
        },
        statusCard: {
            background: `linear-gradient(135deg, ${theme.colors.accent}15, ${theme.colors.accent}05)`,
            border: `2px solid ${theme.colors.accent}`,
            borderRadius: '20px',
            padding: '2rem',
            marginBottom: '2rem',
            textAlign: 'center',
        },
        statusActive: {
            background: `linear-gradient(135deg, ${theme.colors.success}20, ${theme.colors.success}05)`,
            border: `2px solid ${theme.colors.success}`,
        },
        statusExpired: {
            background: `linear-gradient(135deg, ${theme.colors.error}15, ${theme.colors.error}05)`,
            border: `2px solid ${theme.colors.error}`,
        },
        statusTitle: {
            fontSize: '1.5rem',
            fontWeight: '600',
            marginBottom: '0.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
        },
        statusSubtitle: {
            color: theme.colors.mutedText,
            fontSize: '1rem',
        },
        section: {
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
            padding: '1.5rem',
            marginBottom: '1.5rem',
            boxShadow: theme.colors.cardShadow,
        },
        sectionTitle: {
            fontSize: '1.4rem',
            fontWeight: '600',
            marginBottom: '1rem',
            color: theme.colors.primaryText,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
        },
        tierGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '1rem',
        },
        tierCard: {
            background: theme.colors.tertiaryBg,
            border: `2px solid ${theme.colors.border}`,
            borderRadius: '12px',
            padding: '1.5rem',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            position: 'relative',
        },
        tierCardSelected: {
            borderColor: theme.colors.accent,
            background: `${theme.colors.accent}15`,
            boxShadow: `0 0 20px ${theme.colors.accent}30`,
        },
        tierName: {
            fontSize: '1.2rem',
            fontWeight: '600',
            marginBottom: '0.5rem',
            color: theme.colors.primaryText,
        },
        tierPrice: {
            fontSize: '1.5rem',
            fontWeight: '700',
            color: theme.colors.accent,
            marginBottom: '0.5rem',
        },
        tierDuration: {
            color: theme.colors.mutedText,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
        },
        vpBadge: {
            background: `${theme.colors.info || theme.colors.accent}20`,
            color: theme.colors.info || theme.colors.accent,
            padding: '4px 10px',
            borderRadius: '20px',
            fontSize: '0.85rem',
            fontWeight: '600',
            marginBottom: '0.5rem',
            display: 'inline-block',
        },
        depositBox: {
            background: theme.colors.tertiaryBg,
            borderRadius: '12px',
            padding: '1.5rem',
            marginTop: '1rem',
        },
        depositLabel: {
            color: theme.colors.mutedText,
            fontSize: '0.9rem',
            marginBottom: '0.5rem',
        },
        depositValue: {
            fontFamily: 'monospace',
            fontSize: '0.9rem',
            background: theme.colors.secondaryBg,
            padding: '10px 14px',
            borderRadius: '8px',
            border: `1px solid ${theme.colors.border}`,
            wordBreak: 'break-all',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
        },
        balanceDisplay: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '1rem',
            padding: '1rem',
            background: theme.colors.secondaryBg,
            borderRadius: '10px',
        },
        button: {
            padding: '12px 24px',
            borderRadius: '10px',
            border: 'none',
            background: theme.colors.accent,
            color: theme.colors.primaryBg,
            fontWeight: '600',
            fontSize: '1rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            transition: 'all 0.2s ease',
        },
        buttonLarge: {
            padding: '16px 32px',
            fontSize: '1.1rem',
            width: '100%',
            marginTop: '1.5rem',
        },
        buttonSuccess: {
            background: theme.colors.success,
        },
        buttonSecondary: {
            background: theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            color: theme.colors.primaryText,
        },
        perksGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            marginTop: '1rem',
        },
        perkCard: {
            background: theme.colors.tertiaryBg,
            borderRadius: '12px',
            padding: '1.25rem',
            textAlign: 'center',
        },
        perkIcon: {
            fontSize: '2rem',
            marginBottom: '0.75rem',
            color: '#FFD700',
        },
        perkTitle: {
            fontWeight: '600',
            marginBottom: '0.25rem',
            color: theme.colors.primaryText,
        },
        perkDesc: {
            fontSize: '0.9rem',
            color: theme.colors.mutedText,
        },
        loading: {
            textAlign: 'center',
            padding: '3rem',
            color: theme.colors.mutedText,
        },
        error: {
            background: `${theme.colors.error}15`,
            border: `1px solid ${theme.colors.error}`,
            color: theme.colors.error,
            padding: '1rem',
            borderRadius: '10px',
            marginBottom: '1rem',
        },
        noTiers: {
            textAlign: 'center',
            padding: '2rem',
            color: theme.colors.mutedText,
            fontStyle: 'italic',
        },
        loginPrompt: {
            textAlign: 'center',
            padding: '2rem',
            background: theme.colors.tertiaryBg,
            borderRadius: '12px',
            marginTop: '1rem',
        },
        divider: {
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            margin: '1.5rem 0',
            color: theme.colors.mutedText,
        },
        dividerLine: {
            flex: 1,
            height: '1px',
            background: theme.colors.border,
        },
    };
    
    // ============================================
    // Render
    // ============================================
    
    if (loading) {
        return (
            <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main style={styles.container}>
                    <div style={styles.loading}>
                        <FaSpinner className="spin" size={32} />
                        <p style={{ marginTop: '1rem' }}>Loading Sneed Premium...</p>
                    </div>
                </main>
            </div>
        );
    }
    
    const isActive = membershipStatus && isMembershipActive(membershipStatus);
    const isExpired = membershipStatus && 'Expired' in membershipStatus;
    
    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={styles.container}>
                {/* Hero Header */}
                <div style={styles.header}>
                    <h1 style={styles.title}>
                        <FaCrown style={{ color: '#FFD700' }} />
                        Sneed Premium
                    </h1>
                    <p style={styles.subtitle}>
                        Unlock exclusive benefits, discounts, and features across the Sneed ecosystem
                    </p>
                </div>
                
                {error && (
                    <div style={styles.error}>{error}</div>
                )}
                
                {/* Membership Status */}
                {isAuthenticated && membershipStatus && (
                    <div style={{
                        ...styles.statusCard,
                        ...(isActive ? styles.statusActive : {}),
                        ...(isExpired ? styles.statusExpired : {}),
                    }}>
                        {isActive ? (
                            <>
                                <div style={{ ...styles.statusTitle, color: theme.colors.success }}>
                                    <FaCheckCircle />
                                    You're a Premium Member!
                                </div>
                                <div style={styles.statusSubtitle}>
                                    Your membership expires: <strong>{formatTimestamp(membershipStatus.Active.expiration)}</strong>
                                    <br />
                                    Time remaining: <strong>{getTimeRemaining(membershipStatus.Active.expiration)}</strong>
                                </div>
                            </>
                        ) : isExpired ? (
                            <>
                                <div style={{ ...styles.statusTitle, color: theme.colors.error }}>
                                    <FaTimesCircle />
                                    Membership Expired
                                </div>
                                <div style={styles.statusSubtitle}>
                                    Your premium membership expired on {formatTimestamp(membershipStatus.Expired.expiredAt)}
                                </div>
                            </>
                        ) : (
                            <>
                                <div style={{ ...styles.statusTitle, color: theme.colors.accent }}>
                                    <FaCrown />
                                    Become a Premium Member
                                </div>
                                <div style={styles.statusSubtitle}>
                                    Purchase or claim your membership below
                                </div>
                            </>
                        )}
                    </div>
                )}
                
                {/* Premium Perks */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaStar style={{ color: '#FFD700' }} />
                        Premium Benefits
                    </h2>
                    <div style={styles.perksGrid}>
                        <div style={styles.perkCard}>
                            <div style={styles.perkIcon}><FaShieldAlt /></div>
                            <div style={styles.perkTitle}>Exclusive Access</div>
                            <div style={styles.perkDesc}>Access premium-only features and tools</div>
                        </div>
                        <div style={styles.perkCard}>
                            <div style={styles.perkIcon}><FaGift /></div>
                            <div style={styles.perkTitle}>Discounts</div>
                            <div style={styles.perkDesc}>Special rates on Sneedex and other services</div>
                        </div>
                        <div style={styles.perkCard}>
                            <div style={styles.perkIcon}><FaRocket /></div>
                            <div style={styles.perkTitle}>Priority Support</div>
                            <div style={styles.perkDesc}>Get help faster from the Sneed team</div>
                        </div>
                        <div style={styles.perkCard}>
                            <div style={styles.perkIcon}><FaCrown /></div>
                            <div style={styles.perkTitle}>Premium Badge</div>
                            <div style={styles.perkDesc}>Show off your support in the community</div>
                        </div>
                    </div>
                </section>
                
                {/* Purchase with ICP */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaCoins style={{ color: '#FFD700' }} />
                        Purchase with ICP
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Select a tier and deposit ICP to your unique deposit account to purchase premium membership.
                        {isActive && ' Additional purchases will extend your existing membership.'}
                    </p>
                    
                    {icpTiers.length > 0 ? (
                        <>
                            <div style={styles.tierGrid}>
                                {icpTiers.map((tier, index) => (
                                    <div
                                        key={index}
                                        onClick={() => isAuthenticated && setSelectedIcpTier(index)}
                                        style={{
                                            ...styles.tierCard,
                                            ...(selectedIcpTier === index ? styles.tierCardSelected : {}),
                                            cursor: isAuthenticated ? 'pointer' : 'default',
                                            opacity: !tier.active ? 0.5 : 1,
                                        }}
                                    >
                                        {selectedIcpTier === index && (
                                            <FaCheckCircle 
                                                style={{ 
                                                    position: 'absolute', 
                                                    top: '10px', 
                                                    right: '10px',
                                                    color: theme.colors.accent,
                                                    fontSize: '1.2rem',
                                                }}
                                            />
                                        )}
                                        <div style={styles.tierName}>{tier.name}</div>
                                        <div style={styles.tierPrice}>{formatIcp(tier.amountE8s)}</div>
                                        <div style={styles.tierDuration}>
                                            <FaClock /> {formatDuration(tier.durationNs)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            
                            {isAuthenticated && depositAccount && (
                                <div style={styles.depositBox}>
                                    <div style={styles.depositLabel}>Your Deposit Account (send ICP here):</div>
                                    <div 
                                        style={styles.depositValue}
                                        onClick={() => copyToClipboard(canisterId?.toString() || SNEED_PREMIUM_CANISTER_ID, 'Principal')}
                                        title="Click to copy principal"
                                    >
                                        <strong>Principal:</strong> {canisterId?.toString() || SNEED_PREMIUM_CANISTER_ID}
                                    </div>
                                    {depositAccount.subaccount && depositAccount.subaccount.length > 0 && (
                                        <div 
                                            style={{ ...styles.depositValue, marginTop: '8px' }}
                                            onClick={() => copyToClipboard(formatSubaccount(depositAccount.subaccount), 'Subaccount')}
                                            title="Click to copy subaccount"
                                        >
                                            <strong>Subaccount:</strong> {formatSubaccount(depositAccount.subaccount)}
                                        </div>
                                    )}
                                    
                                    <div style={styles.balanceDisplay}>
                                        <div>
                                            <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Your Deposit Balance</div>
                                            <div style={{ fontSize: '1.25rem', fontWeight: '600', color: theme.colors.primaryText }}>
                                                {depositBalance !== null ? formatIcp(depositBalance) : '—'}
                                            </div>
                                        </div>
                                        <button
                                            onClick={checkDepositBalance}
                                            disabled={checkingBalance}
                                            style={{
                                                ...styles.button,
                                                ...styles.buttonSecondary,
                                                opacity: checkingBalance ? 0.5 : 1,
                                            }}
                                        >
                                            {checkingBalance ? <FaSpinner className="spin" /> : <FaWallet />}
                                            Check Balance
                                        </button>
                                    </div>
                                    
                                    <button
                                        onClick={handlePurchase}
                                        disabled={purchasing || selectedIcpTier === null}
                                        style={{
                                            ...styles.button,
                                            ...styles.buttonLarge,
                                            ...styles.buttonSuccess,
                                            opacity: purchasing || selectedIcpTier === null ? 0.5 : 1,
                                            cursor: purchasing || selectedIcpTier === null ? 'not-allowed' : 'pointer',
                                        }}
                                    >
                                        {purchasing ? (
                                            <><FaSpinner className="spin" /> Processing...</>
                                        ) : (
                                            <><FaCrown /> Complete Purchase</>
                                        )}
                                    </button>
                                </div>
                            )}
                            
                            {!isAuthenticated && (
                                <div style={styles.loginPrompt}>
                                    <FaExclamationTriangle style={{ color: theme.colors.warning, marginBottom: '0.5rem', fontSize: '1.5rem' }} />
                                    <p>Please log in to purchase premium membership</p>
                                </div>
                            )}
                        </>
                    ) : (
                        <div style={styles.noTiers}>No ICP payment tiers configured yet.</div>
                    )}
                </section>
                
                {/* Divider */}
                <div style={styles.divider}>
                    <div style={styles.dividerLine}></div>
                    <span>OR</span>
                    <div style={styles.dividerLine}></div>
                </div>
                
                {/* Claim with Voting Power */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaVoteYea style={{ color: theme.colors.info || theme.colors.accent }} />
                        Claim with Sneed Voting Power
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Stake SNEED tokens in the SNS governance to earn premium membership based on your voting power.
                        The more you stake, the longer your membership!
                    </p>
                    
                    {vpTiers.length > 0 ? (
                        <>
                            <div style={styles.tierGrid}>
                                {vpTiers.map((tier, index) => (
                                    <div
                                        key={index}
                                        style={{
                                            ...styles.tierCard,
                                            cursor: 'default',
                                            opacity: !tier.active ? 0.5 : 1,
                                        }}
                                    >
                                        <div style={styles.vpBadge}>
                                            ≥ {formatVotingPower(tier.minVotingPowerE8s)}
                                        </div>
                                        <div style={styles.tierName}>{tier.name}</div>
                                        <div style={styles.tierDuration}>
                                            <FaClock /> {formatDuration(tier.durationNs)}
                                        </div>
                                        <div style={{ marginTop: '0.5rem', color: theme.colors.mutedText, fontSize: '0.85rem' }}>
                                            <FaArrowRight style={{ marginRight: '4px' }} />
                                            Grants membership
                                        </div>
                                    </div>
                                ))}
                            </div>
                            
                            {isAuthenticated ? (
                                <button
                                    onClick={handleClaimVP}
                                    disabled={claiming}
                                    style={{
                                        ...styles.button,
                                        ...styles.buttonLarge,
                                        opacity: claiming ? 0.5 : 1,
                                        cursor: claiming ? 'not-allowed' : 'pointer',
                                    }}
                                >
                                    {claiming ? (
                                        <><FaSpinner className="spin" /> Checking Neurons...</>
                                    ) : (
                                        <><FaVoteYea /> Claim with Voting Power</>
                                    )}
                                </button>
                            ) : (
                                <div style={styles.loginPrompt}>
                                    <FaExclamationTriangle style={{ color: theme.colors.warning, marginBottom: '0.5rem', fontSize: '1.5rem' }} />
                                    <p>Please log in to claim premium with your voting power</p>
                                </div>
                            )}
                        </>
                    ) : (
                        <div style={styles.noTiers}>No voting power tiers configured yet.</div>
                    )}
                </section>
                
            </main>
            
            <InfoModal
                isOpen={infoModal.show}
                onClose={closeInfoModal}
                title={infoModal.title}
                message={infoModal.message}
                type={infoModal.type}
            />
            
            <ConfirmationModal
                show={confirmModal.show}
                onClose={closeConfirmModal}
                onSubmit={confirmModal.onConfirm}
                message={confirmModal.message}
                doAwait={true}
            />
        </div>
    );
}

