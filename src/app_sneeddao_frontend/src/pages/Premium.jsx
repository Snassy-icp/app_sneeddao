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
import { createActor as createSneedexActor, canisterId as SNEEDEX_CANISTER_ID } from 'declarations/sneedex';
import { createActor as createNeuronManagerFactoryActor, canisterId as NEURON_MANAGER_FACTORY_CANISTER_ID } from 'declarations/sneed_icp_neuron_manager_factory';
import { createActor as createForumActor, canisterId as FORUM_CANISTER_ID } from 'declarations/sneed_sns_forum';
import { createActor as createSmsActor, canisterId as SMS_CANISTER_ID } from 'declarations/sneed_sms';
import { createActor as createBackendActor, canisterId as BACKEND_CANISTER_ID } from 'declarations/app_sneeddao_backend';
import { useSneedMembership } from '../hooks/useSneedMembership';
import InfoModal from '../components/InfoModal';
import { 
    FaCrown, FaSpinner, FaCoins, FaVoteYea, FaClock, FaCheckCircle, 
    FaTimesCircle, FaExclamationTriangle, FaArrowRight, FaWallet,
    FaGift, FaShieldAlt, FaStar, FaRocket, FaTicketAlt, FaExchangeAlt,
    FaBrain, FaComments, FaEnvelope, FaAddressBook, FaCube, FaPercent, FaUsers, FaTachometerAlt, FaFolder, FaUnlock, FaLock
} from 'react-icons/fa';
import { Link } from 'react-router-dom';

// Custom CSS for animations
const customStyles = `
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

@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

@keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

@keyframes goldGlow {
    0%, 100% { box-shadow: 0 0 20px rgba(255, 215, 0, 0.3); }
    50% { box-shadow: 0 0 40px rgba(255, 215, 0, 0.5); }
}

.premium-card-animate {
    animation: fadeInUp 0.5s ease-out forwards;
}

.premium-float {
    animation: float 3s ease-in-out infinite;
}

.premium-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.premium-glow {
    animation: goldGlow 2s ease-in-out infinite;
}

.premium-shimmer {
    background: linear-gradient(90deg, transparent 0%, rgba(255,215,0,0.15) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: shimmer 2s infinite;
}
`;

// Accent colors for Premium page
const premiumPrimary = '#FFD700'; // Gold
const premiumSecondary = '#FFA500'; // Orange/Amber
const premiumAccent = '#F5B041'; // Lighter gold

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
    
    // Premium pricing comparison from other canisters
    const [premiumPricing, setPremiumPricing] = useState(null);
    
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
    
    // Fetch premium pricing from external canisters
    useEffect(() => {
        const fetchPremiumPricing = async () => {
            try {
                const pricing = { sneedex: null, neuronManager: null, forum: null, sms: null };
                
                // Fetch sneedex fees
                if (SNEEDEX_CANISTER_ID) {
                    try {
                        const sneedexActor = createSneedexActor(SNEEDEX_CANISTER_ID, {});
                        const feeConfig = await sneedexActor.getFeeConfig();
                        pricing.sneedex = {
                            regularCreationFeeE8s: feeConfig.regularCreationFeeE8s,
                            premiumCreationFeeE8s: feeConfig.premiumCreationFeeE8s,
                            regularAuctionCutBps: feeConfig.regularAuctionCutBps,
                            premiumAuctionCutBps: feeConfig.premiumAuctionCutBps,
                        };
                    } catch (err) {
                        console.warn('Failed to fetch sneedex fees:', err);
                    }
                }
                
                // Fetch neuron manager factory fees
                if (NEURON_MANAGER_FACTORY_CANISTER_ID) {
                    try {
                        const factoryActor = createNeuronManagerFactoryActor(NEURON_MANAGER_FACTORY_CANISTER_ID, {});
                        const [paymentConfig, premiumFee] = await Promise.all([
                            factoryActor.getPaymentConfig(),
                            factoryActor.getPremiumCreationFee(),
                        ]);
                        
                        // Only show if there's a discount
                        if (Number(paymentConfig.creationFeeE8s) > Number(premiumFee)) {
                            pricing.neuronManager = {
                                regularFeeE8s: paymentConfig.creationFeeE8s,
                                premiumFeeE8s: premiumFee,
                            };
                        }
                    } catch (err) {
                        console.warn('Failed to fetch ICP staking bot factory fees:', err);
                    }
                }
                
                // Fetch forum text limits
                if (FORUM_CANISTER_ID) {
                    try {
                        const forumActor = createForumActor(FORUM_CANISTER_ID, {});
                        const [textLimits, premiumConfig] = await Promise.all([
                            forumActor.get_text_limits(),
                            forumActor.get_premium_config().catch(() => null),
                        ]);
                        
                        if (textLimits && premiumConfig) {
                            const regularPostBodyLimit = Number(textLimits.post_body_max_length);
                            const premiumPostBodyLimit = Number(premiumConfig.premium_post_body_max_length);
                            const regularThreadBodyLimit = Number(textLimits.thread_body_max_length);
                            const premiumThreadBodyLimit = Number(premiumConfig.premium_thread_body_max_length);
                            
                            // Only show if premium has higher limits
                            if (premiumPostBodyLimit > regularPostBodyLimit || premiumThreadBodyLimit > regularThreadBodyLimit) {
                                pricing.forum = {
                                    regularPostBodyLimit,
                                    premiumPostBodyLimit,
                                    regularThreadBodyLimit,
                                    premiumThreadBodyLimit,
                                };
                            }
                        }
                    } catch (err) {
                        console.warn('Failed to fetch forum limits:', err);
                    }
                }
                
                // Fetch SMS limits
                if (SMS_CANISTER_ID) {
                    try {
                        const smsActor = createSmsActor(SMS_CANISTER_ID, {});
                        const [config, premiumConfig] = await Promise.all([
                            smsActor.get_config(),
                            smsActor.get_premium_config().catch(() => null),
                        ]);
                        
                        if (config && premiumConfig) {
                            const regularSubjectLimit = Number(config.max_subject_length);
                            const premiumSubjectLimit = Number(premiumConfig.premium_max_subject_length);
                            const regularBodyLimit = Number(config.max_body_length);
                            const premiumBodyLimit = Number(premiumConfig.premium_max_body_length);
                            const regularRateLimit = Number(config.rate_limit_minutes);
                            const premiumRateLimit = Number(premiumConfig.premium_rate_limit_minutes);
                            const regularMaxRecipients = Number(config.max_recipients);
                            const premiumMaxRecipients = Number(premiumConfig.premium_max_recipients);
                            
                            // Only show if premium has better limits
                            if (premiumSubjectLimit > regularSubjectLimit || 
                                premiumBodyLimit > regularBodyLimit || 
                                premiumRateLimit < regularRateLimit ||
                                premiumMaxRecipients > regularMaxRecipients) {
                                pricing.sms = {
                                    regularSubjectLimit,
                                    premiumSubjectLimit,
                                    regularBodyLimit,
                                    premiumBodyLimit,
                                    regularRateLimit,
                                    premiumRateLimit,
                                    regularMaxRecipients,
                                    premiumMaxRecipients,
                                };
                            }
                        }
                    } catch (err) {
                        console.warn('Failed to fetch SMS limits:', err);
                    }
                }
                
                // Fetch nickname limits from main backend
                if (BACKEND_CANISTER_ID) {
                    try {
                        const backendActor = createBackendActor(BACKEND_CANISTER_ID, {});
                        const nicknameConfig = await backendActor.get_nickname_limits_config();
                        
                        const regularNeuronLimit = Number(nicknameConfig.max_neuron_nicknames);
                        const premiumNeuronLimit = Number(nicknameConfig.premium_max_neuron_nicknames);
                        const regularPrincipalLimit = Number(nicknameConfig.max_principal_nicknames);
                        const premiumPrincipalLimit = Number(nicknameConfig.premium_max_principal_nicknames);
                        
                        // Only show if premium has higher limits
                        if (premiumNeuronLimit > regularNeuronLimit || premiumPrincipalLimit > regularPrincipalLimit) {
                            pricing.nicknames = {
                                regularNeuronLimit,
                                premiumNeuronLimit,
                                regularPrincipalLimit,
                                premiumPrincipalLimit,
                            };
                        }
                        
                        // Fetch canister groups limits from the same backend
                        const canisterGroupsConfig = await backendActor.get_canister_groups_limits_config();
                        
                        const regularMaxGroups = Number(canisterGroupsConfig.max_canister_groups);
                        const premiumMaxGroups = Number(canisterGroupsConfig.premium_max_canister_groups);
                        const regularMaxPerGroup = Number(canisterGroupsConfig.max_canisters_per_group);
                        const premiumMaxPerGroup = Number(canisterGroupsConfig.premium_max_canisters_per_group);
                        const regularMaxTotal = Number(canisterGroupsConfig.max_total_grouped_canisters);
                        const premiumMaxTotal = Number(canisterGroupsConfig.premium_max_total_grouped_canisters);
                        
                        // Only show if premium has higher limits
                        if (premiumMaxGroups > regularMaxGroups || premiumMaxPerGroup > regularMaxPerGroup || premiumMaxTotal > regularMaxTotal) {
                            pricing.canisterGroups = {
                                regularMaxGroups,
                                premiumMaxGroups,
                                regularMaxPerGroup,
                                premiumMaxPerGroup,
                                regularMaxTotal,
                                premiumMaxTotal,
                            };
                        }
                    } catch (err) {
                        console.warn('Failed to fetch nickname/canister limits:', err);
                    }
                }
                
                // Only update if we got at least some pricing
                if (pricing.sneedex || pricing.neuronManager || pricing.forum || pricing.sms || pricing.nicknames || pricing.canisterGroups) {
                    setPremiumPricing(pricing);
                }
            } catch (err) {
                console.error('Failed to fetch premium pricing:', err);
            }
        };
        
        fetchPremiumPricing();
    }, []);
    
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
        
        console.log('handleClaimVP - VP:', vp, 'vpTiers:', vpTiers);
        
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
        
        // Check if there are no active tiers
        if (activeTiers.length === 0) {
            showInfo('No VP Tiers', 'No voting power tiers are configured yet. Please try again later or contact an admin.', 'error');
            return;
        }
        
        // Check if user doesn't qualify for any tier
        if (!matchedTier) {
            showInfo('Insufficient Voting Power', 
                `Your voting power: ${formatVotingPower(vp)}\n\nMinimum required: ${formatVotingPower(minRequired)}\n\nStake more SNEED tokens to qualify for premium membership!`, 
                'error'
            );
            return;
        }
        
        console.log('Opening VP claim modal with matchedTier:', matchedTier);
        
        setPremiumConfirmModal({
            show: true,
            type: 'vp',
            title: 'Claim with Voting Power',
            icon: <FaVoteYea style={{ fontSize: '2.5rem', color: theme.colors.info || theme.colors.accent }} />,
            details: [
                { label: 'Your Voting Power', value: formatVotingPower(vp), highlight: true },
                { label: 'Matched Tier', value: matchedTier.name },
                { label: 'Duration', value: formatDuration(matchedTier.durationNs) },
            ],
            highlight: `You qualify for "${matchedTier.name}" - ${formatDuration(matchedTier.durationNs)} of membership!`,
            confirmText: 'Claim Membership',
            onConfirm: doClaimVP,
        });
    };
    
    const doClaimVP = async () => {
        console.log('doClaimVP called');
        closePremiumConfirmModal();
        setClaiming(true);
        
        try {
            console.log('Getting actor...');
            const actor = await getActor();
            console.log('Calling claimWithVotingPower...');
            const result = await actor.claimWithVotingPower();
            console.log('claimWithVotingPower result:', result);
            
            if ('ok' in result) {
                showInfo('🎉 Success!', `Premium membership claimed!\n\nYour membership expires: ${formatTimestamp(result.ok.expiration)}`, 'success');
                await fetchData();
            } else {
                const err = result.err;
                console.log('Claim error:', err);
                let errorMessage = 'Claim failed';
                if ('NoEligibleNeurons' in err) {
                    errorMessage = 'No eligible neurons found for your principal. Make sure you have staked SNEED in the SNS governance.';
                } else if ('InsufficientVotingPower' in err) {
                    errorMessage = `Insufficient voting power. You have ${formatVotingPower(err.InsufficientVotingPower.found)}, but the minimum required is ${formatVotingPower(err.InsufficientVotingPower.required)}.`;
                } else if ('NoActiveTiers' in err) {
                    errorMessage = 'No active voting power tiers configured';
                } else if ('AlreadyClaimedRecently' in err) {
                    const { lastClaimTime, intervalNs, nextClaimTime } = err.AlreadyClaimedRecently;
                    const nextClaimDate = new Date(Number(nextClaimTime) / 1_000_000);
                    const intervalHours = Number(intervalNs) / (1_000_000_000 * 60 * 60);
                    const now = Date.now();
                    const waitMs = nextClaimDate.getTime() - now;
                    
                    let waitTime;
                    if (waitMs <= 0) {
                        waitTime = 'now (please try again)';
                    } else if (waitMs < 60 * 1000) {
                        waitTime = `${Math.ceil(waitMs / 1000)} seconds`;
                    } else if (waitMs < 60 * 60 * 1000) {
                        waitTime = `${Math.ceil(waitMs / (60 * 1000))} minutes`;
                    } else if (waitMs < 24 * 60 * 60 * 1000) {
                        const hours = Math.floor(waitMs / (60 * 60 * 1000));
                        const mins = Math.ceil((waitMs % (60 * 60 * 1000)) / (60 * 1000));
                        waitTime = mins > 0 ? `${hours}h ${mins}m` : `${hours} hours`;
                    } else {
                        const days = Math.floor(waitMs / (24 * 60 * 60 * 1000));
                        const hours = Math.ceil((waitMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
                        waitTime = hours > 0 ? `${days}d ${hours}h` : `${days} days`;
                    }
                    
                    errorMessage = `You have already claimed recently.\n\nClaim interval: ${intervalHours >= 24 ? `${Math.round(intervalHours / 24)} days` : `${Math.round(intervalHours)} hours`}\n\nYou can claim again in: ${waitTime}`;
                } else if ('InternalError' in err) {
                    errorMessage = err.InternalError;
                } else {
                    errorMessage = 'Unknown error: ' + JSON.stringify(err);
                }
                showInfo('Claim Failed', errorMessage, 'error');
            }
        } catch (err) {
            console.error('doClaimVP error:', err);
            showInfo('Error', 'Failed to claim membership: ' + err.message, 'error');
        }
        
        setClaiming(false);
        console.log('doClaimVP completed');
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
            <div className="page-container">
                <style>{customStyles}</style>
                <Header />
                <main style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                    {/* Hero Section */}
                    <div style={{
                        background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${premiumPrimary}15 50%, ${premiumSecondary}10 100%)`,
                        borderBottom: `1px solid ${theme.colors.border}`,
                        padding: '2rem 1.5rem',
                        position: 'relative',
                        overflow: 'hidden'
                    }}>
                        <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                                <div className="premium-float premium-glow" style={{
                                    width: '64px',
                                    height: '64px',
                                    minWidth: '64px',
                                    borderRadius: '16px',
                                    background: `linear-gradient(135deg, ${premiumPrimary}, ${premiumSecondary})`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: `0 8px 30px ${premiumPrimary}40`
                                }}>
                                    <FaCrown size={28} color="#1a1a2e" />
                                </div>
                                <div>
                                    <h1 style={{ color: theme.colors.primaryText, fontSize: '2rem', fontWeight: '700', margin: 0 }}>
                                        Sneed Premium
                                    </h1>
                                    <p style={{ color: theme.colors.secondaryText, fontSize: '1rem', margin: '0.35rem 0 0 0' }}>
                                        Loading premium features...
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Loading State */}
                    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
                        <div style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '4rem 2rem',
                            textAlign: 'center',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            <div className="premium-pulse" style={{
                                width: '60px',
                                height: '60px',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${premiumPrimary}, ${premiumSecondary})`,
                                margin: '0 auto 1.5rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <FaCrown size={24} color="#1a1a2e" />
                            </div>
                            <p style={{ color: theme.colors.secondaryText, fontSize: '1.1rem' }}>
                                Loading Sneed Premium...
                            </p>
                        </div>
                    </div>
                </main>
            </div>
        );
    }
    
    const isActive = membershipStatus && isMembershipActive(membershipStatus);
    const isExpired = membershipStatus && 'Expired' in membershipStatus;
    
    return (
        <div className="page-container">
            <style>{customStyles}</style>
            <Header />
            <main style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${premiumPrimary}15 50%, ${premiumSecondary}10 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    padding: '2rem 1.5rem',
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    {/* Background decorations */}
                    <div style={{
                        position: 'absolute',
                        top: '-50%',
                        right: '-10%',
                        width: '400px',
                        height: '400px',
                        background: `radial-gradient(circle, ${premiumPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    <div style={{
                        position: 'absolute',
                        bottom: '-30%',
                        left: '-5%',
                        width: '300px',
                        height: '300px',
                        background: `radial-gradient(circle, ${premiumSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    
                    <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '1rem' }}>
                            <div className="premium-float premium-glow" style={{
                                width: '64px',
                                height: '64px',
                                minWidth: '64px',
                                maxWidth: '64px',
                                flexShrink: 0,
                                borderRadius: '16px',
                                background: `linear-gradient(135deg, ${premiumPrimary}, ${premiumSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: `0 8px 30px ${premiumPrimary}40`
                            }}>
                                <FaCrown size={28} color="#1a1a2e" />
                            </div>
                            <div>
                                <h1 style={{ color: theme.colors.primaryText, fontSize: '2rem', fontWeight: '700', margin: 0, lineHeight: '1.2' }}>
                                    Sneed Premium
                                </h1>
                                <p style={{ color: theme.colors.secondaryText, fontSize: '1rem', margin: '0.35rem 0 0 0' }}>
                                    Unlock exclusive benefits, discounts, and features
                                </p>
                            </div>
                        </div>
                        
                        {/* Quick Status Badge */}
                        {isAuthenticated && membershipStatus && (
                            <div style={{ 
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                padding: '0.5rem 1rem',
                                borderRadius: '20px',
                                background: isActive 
                                    ? `${theme.colors.success}20` 
                                    : isExpired 
                                        ? `${theme.colors.error}20` 
                                        : `${premiumPrimary}20`,
                                border: `1px solid ${isActive ? theme.colors.success : isExpired ? theme.colors.error : premiumPrimary}40`,
                                fontSize: '0.9rem'
                            }}>
                                {isActive ? (
                                    <>
                                        <FaCheckCircle color={theme.colors.success} size={14} />
                                        <span style={{ color: theme.colors.success, fontWeight: '600' }}>Premium Active</span>
                                        <span style={{ color: theme.colors.mutedText }}>• {getTimeRemaining(membershipStatus.Active.expiration)}</span>
                                    </>
                                ) : isExpired ? (
                                    <>
                                        <FaTimesCircle color={theme.colors.error} size={14} />
                                        <span style={{ color: theme.colors.error, fontWeight: '600' }}>Membership Expired</span>
                                    </>
                                ) : (
                                    <>
                                        <FaLock color={premiumPrimary} size={14} />
                                        <span style={{ color: premiumPrimary, fontWeight: '600' }}>Not a member yet</span>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Main Content */}
                <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
                    
                    {error && (
                        <div className="premium-card-animate" style={{
                            background: `linear-gradient(135deg, ${theme.colors.error}15, ${theme.colors.error}08)`,
                            border: `1px solid ${theme.colors.error}30`,
                            borderRadius: '12px',
                            padding: '1rem 1.25rem',
                            marginBottom: '1.5rem',
                            color: theme.colors.error,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            opacity: 0,
                            animationDelay: '0.1s'
                        }}>
                            <FaExclamationTriangle /> {error}
                        </div>
                    )}
                    
                    {/* Membership Status Card (detailed) */}
                    {isAuthenticated && membershipStatus && (
                        <div className="premium-card-animate" style={{
                            background: isActive 
                                ? `linear-gradient(135deg, ${theme.colors.success}15, ${theme.colors.success}05)` 
                                : isExpired 
                                    ? `linear-gradient(135deg, ${theme.colors.error}15, ${theme.colors.error}05)`
                                    : `linear-gradient(135deg, ${premiumPrimary}15, ${premiumSecondary}08)`,
                            border: `2px solid ${isActive ? theme.colors.success : isExpired ? theme.colors.error : premiumPrimary}`,
                            borderRadius: '20px',
                            padding: '1.25rem 1.5rem',
                            marginBottom: '2rem',
                            textAlign: 'center',
                            opacity: 0,
                            animationDelay: '0.15s'
                        }}>
                            {isActive ? (
                                <>
                                    <div style={{ 
                                        fontSize: '1.2rem', 
                                        fontWeight: '600', 
                                        marginBottom: '0.5rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '10px',
                                        color: theme.colors.success 
                                    }}>
                                        <FaCheckCircle />
                                        You're a Premium Member!
                                    </div>
                                    <div style={{ 
                                        color: theme.colors.mutedText, 
                                        fontSize: '0.9rem',
                                        display: 'flex',
                                        flexWrap: 'wrap',
                                        justifyContent: 'center',
                                        gap: '0.5rem',
                                        alignItems: 'center'
                                    }}>
                                        <span>Expires: <strong style={{ color: theme.colors.primaryText }}>{formatTimestamp(membershipStatus.Active.expiration)}</strong></span>
                                        <span style={{ color: theme.colors.border }}>•</span>
                                        <span>Time remaining: <strong style={{ color: theme.colors.success }}>{getTimeRemaining(membershipStatus.Active.expiration)}</strong></span>
                                    </div>
                                </>
                            ) : isExpired ? (
                                <>
                                    <div style={{ 
                                        fontSize: '1.2rem', 
                                        fontWeight: '600', 
                                        marginBottom: '0.5rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '10px',
                                        color: theme.colors.error 
                                    }}>
                                        <FaTimesCircle />
                                        Membership Expired
                                    </div>
                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                        Your membership expired on {formatTimestamp(membershipStatus.Expired.expiredAt)}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div style={{ 
                                        fontSize: '1.2rem', 
                                        fontWeight: '600', 
                                        marginBottom: '0.5rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '10px',
                                        color: premiumPrimary 
                                    }}>
                                        <FaCrown />
                                        Become a Premium Member
                                    </div>
                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
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
                    </div>
                    
                    {/* Actual Pricing Comparison - Grouped by Service */}
                    {premiumPricing && (premiumPricing.sneedex || premiumPricing.neuronManager || premiumPricing.forum || premiumPricing.sms || premiumPricing.nicknames || premiumPricing.canisterGroups) && (
                        <div style={{
                            marginTop: '1.5rem',
                            background: `linear-gradient(135deg, ${theme.colors.tertiaryBg} 0%, ${theme.colors.secondaryBg}40 100%)`,
                            borderRadius: '16px',
                            padding: '1rem',
                            border: `1px solid ${theme.colors.border}`,
                            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
                        }}>
                            <h3 style={{ 
                                color: '#ffd700', 
                                marginBottom: '1rem', 
                                fontSize: '1.05rem',
                                fontWeight: '700',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                            }}>
                                <div style={{
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '8px',
                                    background: 'linear-gradient(135deg, #ffd700 0%, #ffb300 100%)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: '0 2px 8px rgba(255, 215, 0, 0.3)',
                                    flexShrink: 0,
                                }}>
                                    <FaStar style={{ color: '#000', fontSize: '14px' }} />
                                </div>
                                Premium Benefits & Savings
                            </h3>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                
                                {/* Sneedex Section */}
                                {premiumPricing.sneedex && (Number(premiumPricing.sneedex.regularCreationFeeE8s) > 0 || 
                                    Number(premiumPricing.sneedex.regularAuctionCutBps) > Number(premiumPricing.sneedex.premiumAuctionCutBps)) && (
                                    <div style={{
                                        background: theme.colors.card,
                                        borderRadius: '10px',
                                        overflow: 'hidden',
                                        border: `1px solid ${theme.colors.border}`,
                                    }}>
                                        <div style={{
                                            padding: '10px 12px',
                                            background: `linear-gradient(90deg, #e74c3c20 0%, transparent 100%)`,
                                            borderBottom: `1px solid ${theme.colors.border}`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                        }}>
                                            <div style={{
                                                width: '24px',
                                                height: '24px',
                                                borderRadius: '6px',
                                                background: '#e74c3c20',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexShrink: 0,
                                            }}>
                                                <FaExchangeAlt style={{ color: '#e74c3c', fontSize: '10px' }} />
                                            </div>
                                            <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '0.9rem' }}>
                                                Sneedex Marketplace
                                            </span>
                                        </div>
                                        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <p style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', marginBottom: '0.25rem', lineHeight: '1.4' }}>
                                                Trade apps, SNS neurons, ICP Staking Bots, and tokens through trustless escrow auctions.
                                            </p>
                                            {Number(premiumPricing.sneedex.regularCreationFeeE8s) > 0 && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <FaCoins style={{ color: '#f39c12', fontSize: '10px' }} /> Offer Creation Fee
                                                    </span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span style={{ color: theme.colors.mutedText, textDecoration: 'line-through', fontSize: '0.75rem' }}>
                                                            {formatIcp(premiumPricing.sneedex.regularCreationFeeE8s)} ICP
                                                        </span>
                                                        <span style={{ color: '#2ecc71', fontWeight: '700', fontSize: '0.85rem' }}>
                                                            {Number(premiumPricing.sneedex.premiumCreationFeeE8s) > 0 
                                                                ? `${formatIcp(premiumPricing.sneedex.premiumCreationFeeE8s)} ICP`
                                                                : '✨ FREE'}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            {Number(premiumPricing.sneedex.regularAuctionCutBps) > Number(premiumPricing.sneedex.premiumAuctionCutBps) && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <FaPercent style={{ color: '#9b59b6', fontSize: '9px' }} /> Auction Cut
                                                    </span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span style={{ color: theme.colors.mutedText, textDecoration: 'line-through', fontSize: '0.75rem' }}>
                                                            {(Number(premiumPricing.sneedex.regularAuctionCutBps) / 100).toFixed(2)}%
                                                        </span>
                                                        <span style={{ color: '#2ecc71', fontWeight: '700', fontSize: '0.85rem' }}>
                                                            {(Number(premiumPricing.sneedex.premiumAuctionCutBps) / 100).toFixed(2)}%
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            <Link 
                                                to="/sneedex_offers"
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    color: '#e74c3c',
                                                    fontSize: '0.8rem',
                                                    fontWeight: '600',
                                                    textDecoration: 'none',
                                                    marginTop: '0.25rem'
                                                }}
                                            >
                                                Learn more <FaArrowRight size={9} />
                                            </Link>
                                        </div>
                                    </div>
                                )}
                                
                                {/* ICP Staking Bot Section */}
                                {premiumPricing.neuronManager && 
                                 Number(premiumPricing.neuronManager.regularFeeE8s) > Number(premiumPricing.neuronManager.premiumFeeE8s) && (
                                    <div style={{
                                        background: theme.colors.card,
                                        borderRadius: '10px',
                                        overflow: 'hidden',
                                        border: `1px solid ${theme.colors.border}`,
                                    }}>
                                        <div style={{
                                            padding: '10px 12px',
                                            background: `linear-gradient(90deg, #9b59b620 0%, transparent 100%)`,
                                            borderBottom: `1px solid ${theme.colors.border}`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                        }}>
                                            <div style={{
                                                width: '24px',
                                                height: '24px',
                                                borderRadius: '6px',
                                                background: '#9b59b620',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexShrink: 0,
                                            }}>
                                                <FaBrain style={{ color: '#9b59b6', fontSize: '10px' }} />
                                            </div>
                                            <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '0.9rem' }}>
                                                ICP Staking Bot
                                            </span>
                                        </div>
                                        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <p style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', marginBottom: '0.25rem', lineHeight: '1.4' }}>
                                                Deploy a smart contract to control your ICP neurons with multi-controller support and automation.
                                            </p>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                                                <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <FaCoins style={{ color: '#f39c12', fontSize: '10px' }} /> Manager Creation Fee
                                                </span>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <span style={{ color: theme.colors.mutedText, textDecoration: 'line-through', fontSize: '0.75rem' }}>
                                                        {formatIcp(premiumPricing.neuronManager.regularFeeE8s)} ICP
                                                    </span>
                                                    <span style={{ color: '#2ecc71', fontWeight: '700', fontSize: '0.85rem' }}>
                                                        {Number(premiumPricing.neuronManager.premiumFeeE8s) > 0 
                                                            ? `${formatIcp(premiumPricing.neuronManager.premiumFeeE8s)} ICP`
                                                            : '✨ FREE'}
                                                    </span>
                                                </div>
                                            </div>
                                            <Link 
                                                to="/create_icp_neuron"
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    color: '#9b59b6',
                                                    fontSize: '0.8rem',
                                                    fontWeight: '600',
                                                    textDecoration: 'none',
                                                    marginTop: '0.25rem'
                                                }}
                                            >
                                                Learn more <FaArrowRight size={9} />
                                            </Link>
                                        </div>
                                    </div>
                                )}
                                
                                {/* SNS Jailbreak Tool Section - moved here after ICP Neuron Manager */}
                                <div style={{
                                    background: theme.colors.card,
                                    borderRadius: '10px',
                                    overflow: 'hidden',
                                    border: `1px solid ${theme.colors.border}`,
                                }}>
                                    <div style={{
                                        padding: '10px 12px',
                                        background: `linear-gradient(90deg, #1abc9c20 0%, transparent 100%)`,
                                        borderBottom: `1px solid ${theme.colors.border}`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                    }}>
                                        <div style={{
                                            width: '24px',
                                            height: '24px',
                                            borderRadius: '6px',
                                            background: '#1abc9c20',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            flexShrink: 0,
                                        }}>
                                            <FaUnlock style={{ color: '#1abc9c', fontSize: '10px' }} />
                                        </div>
                                        <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '0.9rem' }}>
                                            SNS Jailbreak Tool
                                        </span>
                                    </div>
                                    <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <p style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', marginBottom: '0.25rem', lineHeight: '1.4' }}>
                                            Unlock the SNS neurons in your NNS wallet to make them tradable on Sneedex.
                                        </p>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                                            <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <FaCoins style={{ color: '#f39c12', fontSize: '10px' }} /> Script Price
                                            </span>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span style={{ color: theme.colors.mutedText, textDecoration: 'line-through', fontSize: '0.75rem' }}>
                                                    0.5 ICP
                                                </span>
                                                <span style={{ color: '#2ecc71', fontWeight: '700', fontSize: '0.85rem' }}>
                                                    ✨ FREE
                                                </span>
                                            </div>
                                        </div>
                                        <Link 
                                            to="/tools/sns_jailbreak"
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                color: '#1abc9c',
                                                fontSize: '0.8rem',
                                                fontWeight: '600',
                                                textDecoration: 'none',
                                                marginTop: '0.25rem'
                                            }}
                                        >
                                            Learn more <FaArrowRight size={9} />
                                        </Link>
                                    </div>
                                </div>
                                
                                {/* SNS Forum Section */}
                                {premiumPricing.forum && (premiumPricing.forum.premiumPostBodyLimit > premiumPricing.forum.regularPostBodyLimit ||
                                    premiumPricing.forum.premiumThreadBodyLimit > premiumPricing.forum.regularThreadBodyLimit) && (
                                    <div style={{
                                        background: theme.colors.card,
                                        borderRadius: '10px',
                                        overflow: 'hidden',
                                        border: `1px solid ${theme.colors.border}`,
                                    }}>
                                        <div style={{
                                            padding: '10px 12px',
                                            background: `linear-gradient(90deg, #3498db20 0%, transparent 100%)`,
                                            borderBottom: `1px solid ${theme.colors.border}`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                        }}>
                                            <div style={{
                                                width: '24px',
                                                height: '24px',
                                                borderRadius: '6px',
                                                background: '#3498db20',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexShrink: 0,
                                            }}>
                                                <FaComments style={{ color: '#3498db', fontSize: '10px' }} />
                                            </div>
                                            <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '0.9rem' }}>
                                                SNS Forum
                                            </span>
                                        </div>
                                        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <p style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', marginBottom: '0.25rem', lineHeight: '1.4' }}>
                                                Discuss SNS governance proposals and community topics in dedicated forums.
                                            </p>
                                            {premiumPricing.forum.premiumPostBodyLimit > premiumPricing.forum.regularPostBodyLimit && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem' }}>Post Length</span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span style={{ color: theme.colors.mutedText, textDecoration: 'line-through', fontSize: '0.75rem' }}>
                                                            {premiumPricing.forum.regularPostBodyLimit.toLocaleString()}
                                                        </span>
                                                        <span style={{ color: '#2ecc71', fontWeight: '700', fontSize: '0.85rem' }}>
                                                            {premiumPricing.forum.premiumPostBodyLimit.toLocaleString()} chars
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            {premiumPricing.forum.premiumThreadBodyLimit > premiumPricing.forum.regularThreadBodyLimit && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem' }}>Thread Length</span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span style={{ color: theme.colors.mutedText, textDecoration: 'line-through', fontSize: '0.75rem' }}>
                                                            {premiumPricing.forum.regularThreadBodyLimit.toLocaleString()}
                                                        </span>
                                                        <span style={{ color: '#2ecc71', fontWeight: '700', fontSize: '0.85rem' }}>
                                                            {premiumPricing.forum.premiumThreadBodyLimit.toLocaleString()} chars
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            <Link 
                                                to="/forum"
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    color: '#3498db',
                                                    fontSize: '0.8rem',
                                                    fontWeight: '600',
                                                    textDecoration: 'none',
                                                    marginTop: '0.25rem'
                                                }}
                                            >
                                                Learn more <FaArrowRight size={9} />
                                            </Link>
                                        </div>
                                    </div>
                                )}
                                
                                {/* Direct Messages (SMS) Section */}
                                {premiumPricing.sms && (premiumPricing.sms.premiumBodyLimit > premiumPricing.sms.regularBodyLimit ||
                                    premiumPricing.sms.premiumRateLimit < premiumPricing.sms.regularRateLimit ||
                                    premiumPricing.sms.premiumMaxRecipients > premiumPricing.sms.regularMaxRecipients) && (
                                    <div style={{
                                        background: theme.colors.card,
                                        borderRadius: '10px',
                                        overflow: 'hidden',
                                        border: `1px solid ${theme.colors.border}`,
                                    }}>
                                        <div style={{
                                            padding: '10px 12px',
                                            background: `linear-gradient(90deg, #2ecc7120 0%, transparent 100%)`,
                                            borderBottom: `1px solid ${theme.colors.border}`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                        }}>
                                            <div style={{
                                                width: '24px',
                                                height: '24px',
                                                borderRadius: '6px',
                                                background: '#2ecc7120',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexShrink: 0,
                                            }}>
                                                <FaEnvelope style={{ color: '#2ecc71', fontSize: '10px' }} />
                                            </div>
                                            <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '0.9rem' }}>
                                                Direct Messages
                                            </span>
                                        </div>
                                        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <p style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', marginBottom: '0.25rem', lineHeight: '1.4' }}>
                                                Send private on-chain messages to any Internet Computer principal.
                                            </p>
                                            {premiumPricing.sms.premiumBodyLimit > premiumPricing.sms.regularBodyLimit && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem' }}>Message Length</span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span style={{ color: theme.colors.mutedText, textDecoration: 'line-through', fontSize: '0.75rem' }}>
                                                            {premiumPricing.sms.regularBodyLimit.toLocaleString()}
                                                        </span>
                                                        <span style={{ color: '#2ecc71', fontWeight: '700', fontSize: '0.85rem' }}>
                                                            {premiumPricing.sms.premiumBodyLimit.toLocaleString()} chars
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            {premiumPricing.sms.premiumRateLimit < premiumPricing.sms.regularRateLimit && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <FaTachometerAlt style={{ color: '#e67e22', fontSize: '9px' }} /> Rate Limit
                                                    </span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span style={{ color: theme.colors.mutedText, textDecoration: 'line-through', fontSize: '0.75rem' }}>
                                                            {premiumPricing.sms.regularRateLimit} min
                                                        </span>
                                                        <span style={{ color: '#2ecc71', fontWeight: '700', fontSize: '0.85rem' }}>
                                                            {premiumPricing.sms.premiumRateLimit > 0 ? `${premiumPricing.sms.premiumRateLimit} min` : '⚡ Unlimited'}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            {premiumPricing.sms.premiumMaxRecipients > premiumPricing.sms.regularMaxRecipients && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <FaUsers style={{ color: '#1abc9c', fontSize: '9px' }} /> Max Recipients
                                                    </span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span style={{ color: theme.colors.mutedText, textDecoration: 'line-through', fontSize: '0.75rem' }}>
                                                            {premiumPricing.sms.regularMaxRecipients}
                                                        </span>
                                                        <span style={{ color: '#2ecc71', fontWeight: '700', fontSize: '0.85rem' }}>
                                                            {premiumPricing.sms.premiumMaxRecipients}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            <Link 
                                                to="/sms"
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    color: '#2ecc71',
                                                    fontSize: '0.8rem',
                                                    fontWeight: '600',
                                                    textDecoration: 'none',
                                                    marginTop: '0.25rem'
                                                }}
                                            >
                                                Learn more <FaArrowRight size={9} />
                                            </Link>
                                        </div>
                                    </div>
                                )}
                                
                                {/* Address Book (Nicknames) Section */}
                                {premiumPricing.nicknames && (premiumPricing.nicknames.premiumNeuronLimit > premiumPricing.nicknames.regularNeuronLimit ||
                                    premiumPricing.nicknames.premiumPrincipalLimit > premiumPricing.nicknames.regularPrincipalLimit) && (
                                    <div style={{
                                        background: theme.colors.card,
                                        borderRadius: '10px',
                                        overflow: 'hidden',
                                        border: `1px solid ${theme.colors.border}`,
                                    }}>
                                        <div style={{
                                            padding: '10px 12px',
                                            background: `linear-gradient(90deg, #f39c1220 0%, transparent 100%)`,
                                            borderBottom: `1px solid ${theme.colors.border}`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                        }}>
                                            <div style={{
                                                width: '24px',
                                                height: '24px',
                                                borderRadius: '6px',
                                                background: '#f39c1220',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexShrink: 0,
                                            }}>
                                                <FaAddressBook style={{ color: '#f39c12', fontSize: '10px' }} />
                                            </div>
                                            <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '0.9rem' }}>
                                                Address Book
                                            </span>
                                        </div>
                                        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <p style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', marginBottom: '0.25rem', lineHeight: '1.4' }}>
                                                Save custom nicknames for principals and neurons to easily identify them.
                                            </p>
                                            {premiumPricing.nicknames.premiumNeuronLimit > premiumPricing.nicknames.regularNeuronLimit && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem' }}>Neuron Nicknames</span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span style={{ color: theme.colors.mutedText, textDecoration: 'line-through', fontSize: '0.75rem' }}>
                                                            {premiumPricing.nicknames.regularNeuronLimit}
                                                        </span>
                                                        <span style={{ color: '#2ecc71', fontWeight: '700', fontSize: '0.85rem' }}>
                                                            {premiumPricing.nicknames.premiumNeuronLimit}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            {premiumPricing.nicknames.premiumPrincipalLimit > premiumPricing.nicknames.regularPrincipalLimit && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem' }}>Principal Nicknames</span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span style={{ color: theme.colors.mutedText, textDecoration: 'line-through', fontSize: '0.75rem' }}>
                                                            {premiumPricing.nicknames.regularPrincipalLimit}
                                                        </span>
                                                        <span style={{ color: '#2ecc71', fontWeight: '700', fontSize: '0.85rem' }}>
                                                            {premiumPricing.nicknames.premiumPrincipalLimit}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            <Link 
                                                to="/names"
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    color: '#f39c12',
                                                    fontSize: '0.8rem',
                                                    fontWeight: '600',
                                                    textDecoration: 'none',
                                                    marginTop: '0.25rem'
                                                }}
                                            >
                                                Learn more <FaArrowRight size={9} />
                                            </Link>
                                        </div>
                                    </div>
                                )}
                                
                                {/* Canister Manager Section */}
                                {premiumPricing.canisterGroups && (premiumPricing.canisterGroups.premiumMaxGroups > premiumPricing.canisterGroups.regularMaxGroups ||
                                    premiumPricing.canisterGroups.premiumMaxPerGroup > premiumPricing.canisterGroups.regularMaxPerGroup ||
                                    premiumPricing.canisterGroups.premiumMaxTotal > premiumPricing.canisterGroups.regularMaxTotal) && (
                                    <div style={{
                                        background: theme.colors.card,
                                        borderRadius: '10px',
                                        overflow: 'hidden',
                                        border: `1px solid ${theme.colors.border}`,
                                    }}>
                                        <div style={{
                                            padding: '10px 12px',
                                            background: `linear-gradient(90deg, #8e44ad20 0%, transparent 100%)`,
                                            borderBottom: `1px solid ${theme.colors.border}`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                        }}>
                                            <div style={{
                                                width: '24px',
                                                height: '24px',
                                                borderRadius: '6px',
                                                background: '#8e44ad20',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexShrink: 0,
                                            }}>
                                                <FaCube style={{ color: '#8e44ad', fontSize: '10px' }} />
                                            </div>
                                            <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '0.9rem' }}>
                                                App Manager
                                            </span>
                                        </div>
                                        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <p style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', marginBottom: '0.25rem', lineHeight: '1.4' }}>
                                                Organize and monitor your canisters with folders and cycle tracking.
                                            </p>
                                            {premiumPricing.canisterGroups.premiumMaxGroups > premiumPricing.canisterGroups.regularMaxGroups && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <FaFolder style={{ color: '#e67e22', fontSize: '9px' }} /> Folders
                                                    </span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span style={{ color: theme.colors.mutedText, textDecoration: 'line-through', fontSize: '0.75rem' }}>
                                                            {premiumPricing.canisterGroups.regularMaxGroups}
                                                        </span>
                                                        <span style={{ color: '#2ecc71', fontWeight: '700', fontSize: '0.85rem' }}>
                                                            {premiumPricing.canisterGroups.premiumMaxGroups}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            {premiumPricing.canisterGroups.premiumMaxPerGroup > premiumPricing.canisterGroups.regularMaxPerGroup && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem' }}>Apps per Folder</span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span style={{ color: theme.colors.mutedText, textDecoration: 'line-through', fontSize: '0.75rem' }}>
                                                            {premiumPricing.canisterGroups.regularMaxPerGroup}
                                                        </span>
                                                        <span style={{ color: '#2ecc71', fontWeight: '700', fontSize: '0.85rem' }}>
                                                            {premiumPricing.canisterGroups.premiumMaxPerGroup}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            {premiumPricing.canisterGroups.premiumMaxTotal > premiumPricing.canisterGroups.regularMaxTotal && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem' }}>Total Apps</span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span style={{ color: theme.colors.mutedText, textDecoration: 'line-through', fontSize: '0.75rem' }}>
                                                            {premiumPricing.canisterGroups.regularMaxTotal}
                                                        </span>
                                                        <span style={{ color: '#2ecc71', fontWeight: '700', fontSize: '0.85rem' }}>
                                                            {premiumPricing.canisterGroups.premiumMaxTotal}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            <Link 
                                                to="/canisters"
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    color: '#8e44ad',
                                                    fontSize: '0.8rem',
                                                    fontWeight: '600',
                                                    textDecoration: 'none',
                                                    marginTop: '0.25rem'
                                                }}
                                            >
                                                Learn more <FaArrowRight size={9} />
                                            </Link>
                                        </div>
                                    </div>
                                )}
                                
                            </div>
                        </div>
                    )}
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
                                        padding: '1rem',
                                        marginBottom: '1.5rem',
                                    }}>
                                        <h3 style={{ 
                                            color: theme.colors.success, 
                                            margin: '0 0 0.75rem 0',
                                            fontSize: '1rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                        }}>
                                            <FaWallet /> Pay Directly from Wallet
                                        </h3>
                                        <div style={{ 
                                            display: 'flex', 
                                            justifyContent: 'space-between', 
                                            alignItems: 'flex-start', 
                                            marginBottom: '1rem',
                                            flexWrap: 'wrap',
                                            gap: '0.75rem'
                                        }}>
                                            <div style={{ minWidth: '120px' }}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>Your Wallet Balance</div>
                                                <div style={{ fontSize: '1.1rem', fontWeight: '600', color: theme.colors.primaryText }}>
                                                    {walletBalance !== null ? formatIcp(walletBalance) : '—'}
                                                </div>
                                            </div>
                                            {selectedIcpTier !== null && (
                                                <div style={{ minWidth: '100px' }}>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>Selected Tier Cost</div>
                                                    <div style={{ fontSize: '1.1rem', fontWeight: '600', color: theme.colors.accent }}>
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
                            {/* Show user's VP if authenticated */}
                            {isAuthenticated && !loadingVp && sneedVotingPower > 0 && (
                                <div style={{
                                    background: `linear-gradient(135deg, ${theme.colors.info || theme.colors.accent}20, ${theme.colors.accent}10)`,
                                    border: `1px solid ${theme.colors.info || theme.colors.accent}40`,
                                    borderRadius: '12px',
                                    padding: '1rem',
                                    marginBottom: '1rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                }}>
                                    <div>
                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Your Voting Power</div>
                                        <div style={{ fontSize: '1.5rem', fontWeight: '700', color: theme.colors.info || theme.colors.accent }}>
                                            {formatVotingPower(sneedVotingPower)}
                                        </div>
                                    </div>
                                    {(() => {
                                        const activeTiers = vpTiers.filter(t => t.active);
                                        const matchedTier = [...activeTiers]
                                            .sort((a, b) => Number(b.minVotingPowerE8s) - Number(a.minVotingPowerE8s))
                                            .find(t => sneedVotingPower >= Number(t.minVotingPowerE8s));
                                        return matchedTier ? (
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>You qualify for</div>
                                                <div style={{ fontSize: '1.1rem', fontWeight: '600', color: theme.colors.success }}>
                                                    {matchedTier.name} ✓
                                                </div>
                                            </div>
                                        ) : null;
                                    })()}
                                </div>
                            )}
                            
                            <div style={styles.tierGrid}>
                                {vpTiers.map((tier, index) => {
                                    // Check if user qualifies for this tier (and it's their best match)
                                    const activeTiers = vpTiers.filter(t => t.active);
                                    const matchedTier = isAuthenticated && sneedVotingPower > 0
                                        ? [...activeTiers]
                                            .sort((a, b) => Number(b.minVotingPowerE8s) - Number(a.minVotingPowerE8s))
                                            .find(t => sneedVotingPower >= Number(t.minVotingPowerE8s))
                                        : null;
                                    const isMatchedTier = matchedTier && tier.name === matchedTier.name;
                                    
                                    return (
                                        <div
                                            key={index}
                                            style={{
                                                ...styles.tierCard,
                                                cursor: 'default',
                                                opacity: !tier.active ? 0.5 : 1,
                                                ...(isMatchedTier ? {
                                                    borderColor: theme.colors.success,
                                                    background: `${theme.colors.success}15`,
                                                    boxShadow: `0 0 20px ${theme.colors.success}30`,
                                                } : {}),
                                            }}
                                        >
                                            {isMatchedTier && (
                                                <div style={{
                                                    position: 'absolute',
                                                    top: '-10px',
                                                    right: '10px',
                                                    background: theme.colors.success,
                                                    color: '#fff',
                                                    padding: '4px 12px',
                                                    borderRadius: '20px',
                                                    fontSize: '0.75rem',
                                                    fontWeight: '700',
                                                }}>
                                                    ✓ YOUR TIER
                                                </div>
                                            )}
                                            <div style={{
                                                ...styles.vpBadge,
                                                ...(isMatchedTier ? {
                                                    background: `${theme.colors.success}20`,
                                                    color: theme.colors.success,
                                                } : {}),
                                            }}>
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
                                    );
                                })}
                            </div>
                            
                            {isAuthenticated ? (
                                <button
                                    onClick={handleClaimVP}
                                    disabled={claiming || loadingVp}
                                    style={{
                                        ...styles.button,
                                        ...styles.buttonLarge,
                                        opacity: (claiming || loadingVp) ? 0.5 : 1,
                                        cursor: (claiming || loadingVp) ? 'not-allowed' : 'pointer',
                                    }}
                                >
                                    {claiming ? (
                                        <><FaSpinner className="spin" /> Claiming...</>
                                    ) : loadingVp ? (
                                        <><FaSpinner className="spin" /> Loading Neurons...</>
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
                
                </div>{/* End Main Content */}
            </main>
            
            <InfoModal
                show={infoModal.show}
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

