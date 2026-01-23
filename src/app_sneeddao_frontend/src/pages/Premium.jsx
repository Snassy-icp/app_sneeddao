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
import { useSneedMembership } from '../hooks/useSneedMembership';
import InfoModal from '../components/InfoModal';
import { 
    FaCrown, FaSpinner, FaCoins, FaVoteYea, FaClock, FaCheckCircle, 
    FaTimesCircle, FaExclamationTriangle, FaArrowRight, FaWallet,
    FaGift, FaShieldAlt, FaStar, FaRocket, FaTicketAlt
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
    const [selectedIcpTier, setSelectedIcpTier] = useState(null);
    
    // User wallet balance
    const [walletBalance, setWalletBalance] = useState(null);
    const [icpFee, setIcpFee] = useState(null);
    
    // User voting power (from Sneed membership hook)
    const { sneedVotingPower, loading: loadingVp, refresh: refreshVp } = useSneedMembership();
    
    // Promo code state
    const [promoCode, setPromoCode] = useState('');
    const [redeemingPromo, setRedeemingPromo] = useState(false);
    
    // Loading states
    const [claiming, setClaiming] = useState(false);
    const [payingNow, setPayingNow] = useState(false);
    
    // Modals
    const [infoModal, setInfoModal] = useState({ show: false, title: '', message: '', type: 'info' });
    const [premiumConfirmModal, setPremiumConfirmModal] = useState({ 
        show: false, 
        type: null, // 'icp', 'vp', 'promo'
        title: '',
        icon: null,
        details: [],
        highlight: '',
        confirmText: '',
        onConfirm: null 
    });
    
    const showInfo = (title, message, type = 'info') => {
        setInfoModal({ show: true, title, message, type });
    };
    
    const closeInfoModal = () => {
        setInfoModal({ ...infoModal, show: false });
    };
    
    const closePremiumConfirmModal = () => {
        setPremiumConfirmModal({ ...premiumConfirmModal, show: false });
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
                const [icpTiersResult, vpTiersResult] = await Promise.all([
                    anonActor.getIcpTiers(),
                    anonActor.getVotingPowerTiers(),
                ]);
                setIcpTiers(icpTiersResult);
                setVpTiers(vpTiersResult);
                setLoading(false);
                return;
            }
            
            const principal = identity.getPrincipal();
            
            const [statusResult, icpTiersResult, vpTiersResult, depositResult] = await Promise.all([
                actor.checkMembership(principal),
                actor.getIcpTiers(),
                actor.getVotingPowerTiers(),
                actor.getDepositAccount(principal),
            ]);
            
            setMembershipStatus(statusResult);
            setIcpTiers(icpTiersResult);
            setVpTiers(vpTiersResult);
            setDepositAccount(depositResult);
            
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
    
    // Fetch wallet balance and ICP fee
    const fetchWalletBalance = useCallback(async () => {
        if (!identity) return;
        
        try {
            const icpLedger = createIcrc1Actor(ICP_LEDGER_ID, { agentOptions: { identity, host: 'https://icp-api.io' } });
            const userAccount = {
                owner: identity.getPrincipal(),
                subaccount: [],
            };
            const [balance, fee] = await Promise.all([
                icpLedger.icrc1_balance_of(userAccount),
                icpLedger.icrc1_fee(),
            ]);
            setWalletBalance(balance);
            setIcpFee(fee);
        } catch (err) {
            console.error('Failed to fetch wallet balance:', err);
        }
    }, [identity]);
    
    // Fetch wallet balance when identity changes
    useEffect(() => {
        if (identity) {
            fetchWalletBalance();
        }
    }, [identity, fetchWalletBalance]);
    
    // Pay directly from wallet
    const handlePayNow = async () => {
        if (selectedIcpTier === null) {
            showInfo('Select Tier', 'Please select a membership tier first', 'error');
            return;
        }
        
        const tier = icpTiers[selectedIcpTier];
        const totalRequired = BigInt(tier.amountE8s) + (icpFee ? BigInt(icpFee) : 10000n);
        
        if (walletBalance === null || BigInt(walletBalance) < totalRequired) {
            showInfo('Insufficient Balance', `You need at least ${formatIcp(totalRequired)} ICP in your wallet (including fee) to purchase this tier.`, 'error');
            return;
        }
        
        setPremiumConfirmModal({
            show: true,
            type: 'icp',
            title: 'Purchase Premium Membership',
            icon: <FaCoins style={{ fontSize: '2.5rem', color: '#FFD700' }} />,
            details: [
                { label: 'Tier', value: tier.name },
                { label: 'Cost', value: formatIcp(tier.amountE8s) },
                { label: 'Duration', value: formatDuration(tier.durationNs) },
            ],
            highlight: isActive 
                ? `This will extend your existing membership by ${formatDuration(tier.durationNs)}` 
                : `You'll become a Sneed Premium member!`,
            confirmText: `Pay ${formatIcp(tier.amountE8s)}`,
            onConfirm: doPayNow,
        });
    };
    
    const doPayNow = async () => {
        closePremiumConfirmModal();
        setPayingNow(true);
        
        try {
            const tier = icpTiers[selectedIcpTier];
            const icpLedger = createIcrc1Actor(ICP_LEDGER_ID, { agentOptions: { identity, host: 'https://icp-api.io' } });
            
            // Step 1: Transfer ICP from wallet to deposit account
            const transferArgs = {
                to: depositAccount,
                fee: [],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
                amount: BigInt(tier.amountE8s),
            };
            
            const transferResult = await icpLedger.icrc1_transfer(transferArgs);
            
            if ('Err' in transferResult) {
                const err = transferResult.Err;
                let errorMessage = 'Transfer failed';
                if ('InsufficientFunds' in err) {
                    errorMessage = `Insufficient funds. Your balance: ${formatIcp(err.InsufficientFunds.balance)}`;
                } else if ('BadFee' in err) {
                    errorMessage = `Bad fee. Expected: ${formatIcp(err.BadFee.expected_fee)}`;
                } else {
                    errorMessage = JSON.stringify(err);
                }
                showInfo('Transfer Failed', errorMessage, 'error');
                setPayingNow(false);
                return;
            }
            
            // Step 2: Complete the purchase
            const actor = await getActor();
            const purchaseResult = await actor.purchaseWithIcp();
            
            if ('ok' in purchaseResult) {
                showInfo('🎉 Success!', `You are now a Sneed Premium member!\n\nYour membership expires: ${formatTimestamp(purchaseResult.ok.expiration)}`, 'success');
                await fetchData();
                await fetchWalletBalance();
            } else {
                const err = purchaseResult.err;
                let errorMessage = 'Purchase failed after transfer';
                if ('InsufficientPayment' in err) {
                    errorMessage = `Unexpected error: deposit not detected. Please try "Complete Purchase" button.`;
                } else if ('InternalError' in err) {
                    errorMessage = err.InternalError;
                } else {
                    errorMessage = JSON.stringify(err);
                }
                showInfo('Purchase Failed', errorMessage, 'error');
            }
        } catch (err) {
            showInfo('Error', 'Failed to complete payment: ' + err.message, 'error');
        }
        
        setPayingNow(false);
    };
    
    // Claim with Voting Power
    const handleClaimVP = async () => {
        // Refresh voting power first if needed
        if (loadingVp) {
            showInfo('Loading', 'Still loading your voting power. Please wait...', 'info');
            return;
        }
        
        // Use the voting power from the hook
        const vp = sneedVotingPower || 0;
        
        // Find the best VP tier to show
        const activeTiers = vpTiers.filter(t => t.active);
        
        // Find matching tier for user's VP
        let matchedTier = null;
        for (const tier of [...activeTiers].sort((a, b) => Number(b.minVotingPowerE8s) - Number(a.minVotingPowerE8s))) {
            if (vp >= Number(tier.minVotingPowerE8s)) {
                matchedTier = tier;
                break;
            }
        }
        
        // Find minimum required if no match
        const minRequired = activeTiers.length > 0 
            ? activeTiers.reduce((min, t) => Number(t.minVotingPowerE8s) < min ? Number(t.minVotingPowerE8s) : min, Number(activeTiers[0].minVotingPowerE8s))
            : 0;
        
        if (!matchedTier && activeTiers.length > 0) {
            showInfo('Insufficient Voting Power', 
                `Your voting power: ${formatVotingPower(vp)}\n\nMinimum required: ${formatVotingPower(minRequired)}\n\nStake more SNEED tokens to qualify for premium membership!`, 
                'error'
            );
            return;
        }
        
        setPremiumConfirmModal({
            show: true,
            type: 'vp',
            title: 'Claim with Voting Power',
            icon: <FaVoteYea style={{ fontSize: '2.5rem', color: theme.colors.info || theme.colors.accent }} />,
            details: [
                { label: 'Your Voting Power', value: formatVotingPower(vp), highlight: true },
                ...(matchedTier ? [
                    { label: 'Matched Tier', value: matchedTier.name },
                    { label: 'Duration', value: formatDuration(matchedTier.durationNs) },
                ] : []),
            ],
            highlight: matchedTier 
                ? `You qualify for "${matchedTier.name}" - ${formatDuration(matchedTier.durationNs)} of membership!`
                : 'Your staked SNEED neurons will be checked to determine your membership duration',
            confirmText: 'Claim Membership',
            onConfirm: doClaimVP,
        });
    };
    
    const doClaimVP = async () => {
        closePremiumConfirmModal();
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
    
    // Redeem promo code - show confirmation first
    const handleRedeemPromoCode = async () => {
        const code = promoCode.trim().toUpperCase();
        if (!code) {
            showInfo('Enter Code', 'Please enter a promo code', 'error');
            return;
        }
        
        setPremiumConfirmModal({
            show: true,
            type: 'promo',
            title: 'Redeem Promo Code',
            icon: <FaTicketAlt style={{ fontSize: '2.5rem', color: '#FF69B4' }} />,
            details: [
                { label: 'Code', value: code, mono: true },
            ],
            highlight: 'This promo code will grant you free premium membership!',
            confirmText: 'Redeem Code',
            onConfirm: () => doRedeemPromoCode(code),
        });
    };
    
    const doRedeemPromoCode = async (code) => {
        closePremiumConfirmModal();
        setRedeemingPromo(true);
        
        try {
            const actor = await getActor();
            const result = await actor.claimPromoCode(code);
            
            if ('ok' in result) {
                showInfo('🎉 Success!', `Promo code redeemed!\n\nYour membership now expires: ${formatTimestamp(result.ok.expiration)}`, 'success');
                setPromoCode('');
                await fetchData();
            } else {
                const err = result.err;
                let errorMessage = 'Failed to redeem promo code';
                if ('InvalidCode' in err) {
                    errorMessage = 'Invalid promo code. Please check the code and try again.';
                } else if ('CodeExpired' in err) {
                    errorMessage = 'This promo code has expired.';
                } else if ('CodeFullyClaimed' in err) {
                    errorMessage = 'This promo code has reached its maximum number of claims.';
                } else if ('CodeInactive' in err) {
                    errorMessage = 'This promo code is no longer active.';
                } else if ('AlreadyClaimed' in err) {
                    errorMessage = 'You have already claimed this promo code.';
                } else if ('InternalError' in err) {
                    errorMessage = err.InternalError;
                }
                showInfo('Redemption Failed', errorMessage, 'error');
            }
        } catch (err) {
            showInfo('Error', 'Failed to redeem promo code: ' + err.message, 'error');
        }
        
        setRedeemingPromo(false);
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
                            <div style={styles.perkIcon}><FaCrown /></div>
                            <div style={styles.perkTitle}>Premium Badge</div>
                            <div style={styles.perkDesc}>Show off your support in the community</div>
                        </div>
                        <div style={styles.perkCard}>
                            <div style={styles.perkIcon}><FaRocket /></div>
                            <div style={styles.perkTitle}>Support the DAO</div>
                            <div style={styles.perkDesc}>Help fund development and growth</div>
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
                                    {/* Pay Now Section */}
                                    <div style={{ 
                                        background: `linear-gradient(135deg, ${theme.colors.success}15, ${theme.colors.success}05)`,
                                        border: `1px solid ${theme.colors.success}40`,
                                        borderRadius: '12px',
                                        padding: '1.25rem',
                                        marginBottom: '1.5rem',
                                    }}>
                                        <h3 style={{ 
                                            color: theme.colors.success, 
                                            margin: '0 0 0.75rem 0',
                                            fontSize: '1.1rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                        }}>
                                            <FaWallet /> Pay Directly from Wallet
                                        </h3>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                            <div>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Your Wallet Balance</div>
                                                <div style={{ fontSize: '1.25rem', fontWeight: '600', color: theme.colors.primaryText }}>
                                                    {walletBalance !== null ? formatIcp(walletBalance) : '—'}
                                                </div>
                                            </div>
                                            {selectedIcpTier !== null && (
                                                <div style={{ textAlign: 'right' }}>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Selected Tier Cost</div>
                                                    <div style={{ fontSize: '1.25rem', fontWeight: '600', color: theme.colors.accent }}>
                                                        {formatIcp(icpTiers[selectedIcpTier].amountE8s)}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            onClick={handlePayNow}
                                            disabled={payingNow || selectedIcpTier === null}
                                            style={{
                                                ...styles.button,
                                                ...styles.buttonLarge,
                                                ...styles.buttonSuccess,
                                                width: '100%',
                                                marginTop: 0,
                                                opacity: payingNow || selectedIcpTier === null ? 0.5 : 1,
                                                cursor: payingNow || selectedIcpTier === null ? 'not-allowed' : 'pointer',
                                            }}
                                        >
                                            {payingNow ? (
                                                <><FaSpinner className="spin" /> Processing Payment...</>
                                            ) : (
                                                <><FaCrown /> Pay Now{selectedIcpTier !== null ? ` - ${formatIcp(icpTiers[selectedIcpTier].amountE8s)}` : ''}</>
                                            )}
                                        </button>
                                    </div>
                                    
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
                
                {/* Divider */}
                <div style={styles.divider}>
                    <div style={styles.dividerLine}></div>
                    <span>OR</span>
                    <div style={styles.dividerLine}></div>
                </div>
                
                {/* Promo Code Redemption */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaTicketAlt style={{ color: '#FF69B4' }} />
                        Redeem Promo Code
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Have a promo code? Enter it below to claim free premium membership.
                    </p>
                    
                    {isAuthenticated ? (
                        <div style={{
                            display: 'flex',
                            gap: '1rem',
                            alignItems: 'stretch',
                            flexWrap: 'wrap',
                        }}>
                            <input
                                type="text"
                                placeholder="Enter promo code"
                                value={promoCode}
                                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                                onKeyDown={(e) => e.key === 'Enter' && handleRedeemPromoCode()}
                                style={{
                                    flex: '1',
                                    minWidth: '200px',
                                    padding: '14px 18px',
                                    borderRadius: '10px',
                                    border: `2px solid ${theme.colors.border}`,
                                    background: theme.colors.tertiaryBg,
                                    color: theme.colors.primaryText,
                                    fontSize: '1.1rem',
                                    fontFamily: 'monospace',
                                    letterSpacing: '2px',
                                    textTransform: 'uppercase',
                                }}
                            />
                            <button
                                onClick={handleRedeemPromoCode}
                                disabled={redeemingPromo || !promoCode.trim()}
                                style={{
                                    ...styles.button,
                                    padding: '14px 28px',
                                    background: '#FF69B4',
                                    opacity: redeemingPromo || !promoCode.trim() ? 0.5 : 1,
                                    cursor: redeemingPromo || !promoCode.trim() ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {redeemingPromo ? (
                                    <><FaSpinner className="spin" /> Redeeming...</>
                                ) : (
                                    <><FaTicketAlt /> Redeem Code</>
                                )}
                            </button>
                        </div>
                    ) : (
                        <div style={styles.loginPrompt}>
                            <FaExclamationTriangle style={{ color: theme.colors.warning, marginBottom: '0.5rem', fontSize: '1.5rem' }} />
                            <p>Please log in to redeem a promo code</p>
                        </div>
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
            
            {/* Premium Confirmation Modal */}
            {premiumConfirmModal.show && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    background: 'rgba(0,0,0,0.8)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1001,
                    backdropFilter: 'blur(4px)',
                }}>
                    <div style={{
                        background: theme.colors.primaryBg,
                        border: `2px solid ${
                            premiumConfirmModal.type === 'icp' ? '#FFD700' :
                            premiumConfirmModal.type === 'vp' ? (theme.colors.info || theme.colors.accent) :
                            '#FF69B4'
                        }`,
                        borderRadius: '20px',
                        padding: '2rem',
                        width: '420px',
                        maxWidth: '90vw',
                        boxShadow: `0 20px 60px rgba(0,0,0,0.5), 0 0 40px ${
                            premiumConfirmModal.type === 'icp' ? 'rgba(255,215,0,0.2)' :
                            premiumConfirmModal.type === 'vp' ? 'rgba(100,149,237,0.2)' :
                            'rgba(255,105,180,0.2)'
                        }`,
                        animation: 'fadeInScale 0.2s ease-out',
                    }}>
                        {/* Icon */}
                        <div style={{
                            textAlign: 'center',
                            marginBottom: '1.5rem',
                        }}>
                            <div style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '80px',
                                height: '80px',
                                borderRadius: '50%',
                                background: `${
                                    premiumConfirmModal.type === 'icp' ? 'linear-gradient(135deg, #FFD700, #FFA500)' :
                                    premiumConfirmModal.type === 'vp' ? `linear-gradient(135deg, ${theme.colors.info || theme.colors.accent}, ${theme.colors.accent})` :
                                    'linear-gradient(135deg, #FF69B4, #FF1493)'
                                }`,
                                boxShadow: `0 8px 24px ${
                                    premiumConfirmModal.type === 'icp' ? 'rgba(255,215,0,0.4)' :
                                    premiumConfirmModal.type === 'vp' ? 'rgba(100,149,237,0.4)' :
                                    'rgba(255,105,180,0.4)'
                                }`,
                            }}>
                                {React.cloneElement(premiumConfirmModal.icon, { 
                                    style: { fontSize: '2rem', color: '#fff' } 
                                })}
                            </div>
                        </div>
                        
                        {/* Title */}
                        <h2 style={{
                            textAlign: 'center',
                            color: theme.colors.primaryText,
                            margin: '0 0 1.5rem 0',
                            fontSize: '1.5rem',
                            fontWeight: '700',
                        }}>
                            {premiumConfirmModal.title}
                        </h2>
                        
                        {/* Details */}
                        <div style={{
                            background: theme.colors.tertiaryBg,
                            borderRadius: '12px',
                            padding: '1rem',
                            marginBottom: '1rem',
                        }}>
                            {premiumConfirmModal.details.map((detail, idx) => (
                                <div key={idx} style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '0.5rem 0',
                                    borderBottom: idx < premiumConfirmModal.details.length - 1 ? `1px solid ${theme.colors.border}` : 'none',
                                    ...(detail.highlight ? {
                                        background: `linear-gradient(90deg, transparent, ${theme.colors.info || theme.colors.accent}15)`,
                                        margin: '0 -1rem',
                                        padding: '0.75rem 1rem',
                                        borderRadius: '8px',
                                    } : {}),
                                }}>
                                    <span style={{ color: detail.highlight ? theme.colors.primaryText : theme.colors.mutedText }}>{detail.label}</span>
                                    <span style={{ 
                                        color: detail.highlight ? (theme.colors.info || theme.colors.accent) : theme.colors.primaryText, 
                                        fontWeight: detail.highlight ? '700' : '600',
                                        fontSize: detail.highlight ? '1.1rem' : 'inherit',
                                        fontFamily: detail.mono ? 'monospace' : 'inherit',
                                        letterSpacing: detail.mono ? '1px' : 'normal',
                                    }}>
                                        {detail.value}
                                    </span>
                                </div>
                            ))}
                        </div>
                        
                        {/* Highlight */}
                        <div style={{
                            background: `linear-gradient(135deg, ${
                                premiumConfirmModal.type === 'icp' ? 'rgba(255,215,0,0.15), rgba(255,165,0,0.1)' :
                                premiumConfirmModal.type === 'vp' ? `rgba(100,149,237,0.15), ${theme.colors.accent}15` :
                                'rgba(255,105,180,0.15), rgba(255,20,147,0.1)'
                            })`,
                            border: `1px solid ${
                                premiumConfirmModal.type === 'icp' ? 'rgba(255,215,0,0.3)' :
                                premiumConfirmModal.type === 'vp' ? 'rgba(100,149,237,0.3)' :
                                'rgba(255,105,180,0.3)'
                            }`,
                            borderRadius: '10px',
                            padding: '1rem',
                            marginBottom: '1.5rem',
                            textAlign: 'center',
                        }}>
                            <FaCrown style={{ 
                                color: '#FFD700', 
                                marginRight: '8px',
                                verticalAlign: 'middle',
                            }} />
                            <span style={{ 
                                color: theme.colors.primaryText,
                                fontSize: '0.95rem',
                            }}>
                                {premiumConfirmModal.highlight}
                            </span>
                        </div>
                        
                        {/* Buttons */}
                        <div style={{
                            display: 'flex',
                            gap: '12px',
                        }}>
                            <button
                                onClick={() => premiumConfirmModal.onConfirm && premiumConfirmModal.onConfirm()}
                                style={{
                                    flex: 1,
                                    padding: '14px 24px',
                                    borderRadius: '10px',
                                    border: 'none',
                                    background: `linear-gradient(135deg, ${
                                        premiumConfirmModal.type === 'icp' ? '#FFD700, #FFA500' :
                                        premiumConfirmModal.type === 'vp' ? `${theme.colors.info || theme.colors.accent}, ${theme.colors.accent}` :
                                        '#FF69B4, #FF1493'
                                    })`,
                                    color: premiumConfirmModal.type === 'icp' ? '#1a1a2e' : '#fff',
                                    fontWeight: '700',
                                    fontSize: '1rem',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    boxShadow: `0 4px 16px ${
                                        premiumConfirmModal.type === 'icp' ? 'rgba(255,215,0,0.4)' :
                                        premiumConfirmModal.type === 'vp' ? 'rgba(100,149,237,0.4)' :
                                        'rgba(255,105,180,0.4)'
                                    }`,
                                    transition: 'transform 0.1s ease',
                                }}
                                onMouseDown={(e) => e.target.style.transform = 'scale(0.98)'}
                                onMouseUp={(e) => e.target.style.transform = 'scale(1)'}
                                onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
                            >
                                <FaCheckCircle />
                                {premiumConfirmModal.confirmText}
                            </button>
                            <button
                                onClick={closePremiumConfirmModal}
                                style={{
                                    padding: '14px 24px',
                                    borderRadius: '10px',
                                    border: `1px solid ${theme.colors.border}`,
                                    background: theme.colors.secondaryBg,
                                    color: theme.colors.mutedText,
                                    fontWeight: '600',
                                    fontSize: '1rem',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

