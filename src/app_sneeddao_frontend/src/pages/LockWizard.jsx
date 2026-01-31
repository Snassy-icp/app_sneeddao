import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaCoins, FaWater, FaArrowRight, FaArrowLeft, FaLock, FaCheck, FaSpinner, FaCrown, FaWallet, FaShieldAlt } from 'react-icons/fa';
import { Principal } from '@dfinity/principal';
import { principalToSubAccount } from '@dfinity/utils';
import Header from '../components/Header';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { getTokenLogo, getTokenMetaForSwap, get_token_conversion_rate } from '../utils/TokenUtils';
import { formatAmount } from '../utils/StringUtils';
import { get_short_timezone, format_duration, dateToReadable, getInitialExpiry } from '../utils/DateUtils';
import ConfirmationModal from '../ConfirmationModal';
import { usePremiumStatus, PremiumBadge } from '../hooks/usePremiumStatus';

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
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.05); }
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.lock-float {
    animation: float 3s ease-in-out infinite;
}

.lock-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.lock-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.spin {
    animation: spin 1s linear infinite;
}
`;

// Page accent colors - indigo/blue theme for locking/security
const lockPrimary = '#6366f1';
const lockSecondary = '#818cf8';
const lockAccent = '#a5b4fc';

const ICP_LEDGER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const dex_icpswap = 1;

function LockWizard() {
    const navigate = useNavigate();
    const { identity, isAuthenticated } = useAuth();
    const { theme } = useTheme();
    
    // Premium status
    const { isPremium, loading: loadingPremium } = usePremiumStatus(identity);
    
    // Wizard state - now 4 steps: Type -> Select -> Payment -> Configure
    const [currentStep, setCurrentStep] = useState(1);
    const [lockType, setLockType] = useState(null); // 'token' or 'position'
    const [isHovering, setIsHovering] = useState(null);
    
    // Step 2: Selection state
    const [tokens, setTokens] = useState([]);
    const [liquidityPositions, setLiquidityPositions] = useState([]);
    const [loadingTokens, setLoadingTokens] = useState(false);
    const [loadingPositions, setLoadingPositions] = useState(false);
    const [selectedToken, setSelectedToken] = useState(null);
    const [selectedPosition, setSelectedPosition] = useState(null);
    
    // Step 3: Payment state
    const [lockFeeConfig, setLockFeeConfig] = useState(null);
    const [requiredFee, setRequiredFee] = useState(0n);
    const [paymentBalance, setPaymentBalance] = useState(0n);
    const [paymentSubaccount, setPaymentSubaccount] = useState(null);
    const [loadingPayment, setLoadingPayment] = useState(false);
    const [isPayingFee, setIsPayingFee] = useState(false);
    const [paymentError, setPaymentError] = useState('');
    const [icpWalletBalance, setIcpWalletBalance] = useState(0n);
    
    // Step 4: Lock configuration state
    const [lockAmount, setLockAmount] = useState('');
    const [lockExpiry, setLockExpiry] = useState('');
    const [isLocking, setIsLocking] = useState(false);
    const [lockError, setLockError] = useState('');
    const [lockSuccess, setLockSuccess] = useState(false);
    
    // Confirmation modal
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const [confirmMessage, setConfirmMessage] = useState('');

    // Reset expiry when entering step 4 (Configure)
    useEffect(() => {
        if (currentStep === 4) {
            setLockExpiry(getInitialExpiry());
            setLockError('');
        }
    }, [currentStep]);

    // Fetch tokens when entering step 2 for token lock
    useEffect(() => {
        if (currentStep === 2 && lockType === 'token' && isAuthenticated && identity) {
            fetchTokens();
        }
    }, [currentStep, lockType, isAuthenticated, identity]);

    // Fetch positions when entering step 2 for position lock
    useEffect(() => {
        if (currentStep === 2 && lockType === 'position' && isAuthenticated && identity) {
            fetchPositions();
        }
    }, [currentStep, lockType, isAuthenticated, identity]);

    // Fetch payment info when entering step 3 (Payment)
    useEffect(() => {
        if (currentStep === 3 && isAuthenticated && identity) {
            fetchPaymentInfo();
        }
    }, [currentStep, isAuthenticated, identity, lockType]);

    const fetchPaymentInfo = async () => {
        setLoadingPayment(true);
        setPaymentError('');
        try {
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            const icpLedgerActor = createLedgerActor(ICP_LEDGER_ID, { agentOptions: { identity } });
            
            // Get fee configuration
            const feeConfig = await sneedLockActor.get_lock_fees_icp();
            setLockFeeConfig(feeConfig);
            
            // Determine required fee based on lock type and premium status
            const isPositionLock = lockType === 'position';
            let fee;
            if (isPremium) {
                fee = isPositionLock ? feeConfig.premium_position_lock_fee_icp_e8s : feeConfig.premium_token_lock_fee_icp_e8s;
            } else {
                fee = isPositionLock ? feeConfig.position_lock_fee_icp_e8s : feeConfig.token_lock_fee_icp_e8s;
            }
            setRequiredFee(fee);
            
            // Get payment subaccount
            const subaccount = await sneedLockActor.getPaymentSubaccount(identity.getPrincipal());
            setPaymentSubaccount(subaccount);
            
            // Get current payment balance
            const payBal = await sneedLockActor.getPaymentBalance(identity.getPrincipal());
            setPaymentBalance(BigInt(payBal));
            
            // Get ICP wallet balance
            const walletBal = await icpLedgerActor.icrc1_balance_of({
                owner: identity.getPrincipal(),
                subaccount: []
            });
            setIcpWalletBalance(BigInt(walletBal));
        } catch (error) {
            console.error('Error fetching payment info:', error);
            setPaymentError('Failed to load payment information');
        } finally {
            setLoadingPayment(false);
        }
    };

    const handlePayFee = async () => {
        if (!identity || !paymentSubaccount) return;
        
        setIsPayingFee(true);
        setPaymentError('');
        
        try {
            const icpLedgerActor = createLedgerActor(ICP_LEDGER_ID, { agentOptions: { identity } });
            
            // Calculate amount to send (required fee minus any existing balance, plus ICP transaction fee)
            const existingBalance = paymentBalance;
            const amountNeeded = BigInt(requiredFee) - existingBalance;
            const icpTxFee = 10_000n; // 0.0001 ICP
            const amountToSend = amountNeeded + icpTxFee;
            
            if (icpWalletBalance < amountToSend) {
                setPaymentError(`Insufficient ICP balance. Need ${formatIcp(amountToSend)}, have ${formatIcp(icpWalletBalance)}`);
                setIsPayingFee(false);
                return;
            }
            
            // Transfer ICP to payment subaccount
            const result = await icpLedgerActor.icrc1_transfer({
                to: { owner: Principal.fromText(sneedLockCanisterId), subaccount: [paymentSubaccount] },
                fee: [],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
                amount: amountToSend - icpTxFee // The fee will be deducted by the ledger
            });
            
            if (result.Err) {
                throw new Error(`Transfer failed: ${JSON.stringify(result.Err)}`);
            }
            
            // Refresh payment balance
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            const newBalance = await sneedLockActor.getPaymentBalance(identity.getPrincipal());
            setPaymentBalance(BigInt(newBalance));
            
            // Refresh wallet balance
            const walletBal = await icpLedgerActor.icrc1_balance_of({
                owner: identity.getPrincipal(),
                subaccount: []
            });
            setIcpWalletBalance(BigInt(walletBal));
        } catch (error) {
            console.error('Payment error:', error);
            setPaymentError(error.message || 'Failed to send payment');
        } finally {
            setIsPayingFee(false);
        }
    };

    const formatIcp = (e8s) => {
        const icp = Number(e8s) / 100_000_000;
        return `${icp.toFixed(4)} ICP`;
    };

    const fetchTokens = async () => {
        setLoadingTokens(true);
        try {
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            
            // Get summed locks
            const summedLocksList = await sneedLockActor.get_summed_locks();
            const summedLocks = {};
            for (const lock of summedLocksList) {
                summedLocks[lock[0].toText ? lock[0].toText() : lock[0]] = lock[1];
            }
            
            // Get registered ledgers
            const registeredLedgers = await backendActor.get_ledger_canister_ids();
            
            // Fetch details for each token
            const tokenDetails = await Promise.all(registeredLedgers.map(async (ledger) => {
                try {
                    const ledgerId = ledger.toText ? ledger.toText() : ledger.toString();
                    const ledgerActor = createLedgerActor(ledgerId);
                    
                    const [metadata, symbol, decimals, fee, balance] = await Promise.all([
                        ledgerActor.icrc1_metadata(),
                        ledgerActor.icrc1_symbol(),
                        ledgerActor.icrc1_decimals(),
                        ledgerActor.icrc1_fee(),
                        ledgerActor.icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] })
                    ]);
                    
                    let logo = getTokenLogo(metadata);
                    if (symbol.toLowerCase() === 'icp' && !logo) logo = 'icp_symbol.svg';
                    
                    const subaccount = principalToSubAccount(identity.getPrincipal());
                    const balanceBackend = await ledgerActor.icrc1_balance_of({ 
                        owner: Principal.fromText(sneedLockCanisterId), 
                        subaccount: [subaccount] 
                    });
                    
                    const locked = summedLocks[ledgerId] || 0n;
                    const available = balance + balanceBackend - locked;
                    
                    return {
                        ledger_canister_id: ledger,
                        ledgerId,
                        symbol,
                        decimals,
                        fee,
                        logo,
                        balance,
                        balance_backend: balanceBackend,
                        locked,
                        available,
                        available_backend: balanceBackend > locked ? balanceBackend - locked : 0n
                    };
                } catch (err) {
                    console.error('Error fetching token:', err);
                    return null;
                }
            }));
            
            // Filter out failed fetches and tokens with no available balance
            setTokens(tokenDetails.filter(t => t && t.available > 0n));
        } catch (error) {
            console.error('Error fetching tokens:', error);
        } finally {
            setLoadingTokens(false);
        }
    };

    const fetchPositions = async () => {
        setLoadingPositions(true);
        try {
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            
            const swapCanisters = await backendActor.get_swap_canister_ids();
            const claimedPositions = await sneedLockActor.get_claimed_positions_for_principal(identity.getPrincipal());
            
            const claimedBySwap = {};
            for (const pos of claimedPositions) {
                const swapId = pos.swap_canister_id.toText ? pos.swap_canister_id.toText() : pos.swap_canister_id;
                if (!claimedBySwap[swapId]) claimedBySwap[swapId] = [];
                claimedBySwap[swapId].push(pos);
            }
            
            const allPositions = [];
            
            await Promise.all(swapCanisters.map(async (swapCanister) => {
                try {
                    const swapId = swapCanister.toText ? swapCanister.toText() : swapCanister.toString();
                    const swapActor = createIcpSwapActor(swapId, { agentOptions: { identity } });
                    
                    const tokenMeta = await getTokenMetaForSwap(swapActor, backendActor, swapId);
                    const swapMeta = await swapActor.metadata();
                    
                    const icrc1Ledger0 = swapMeta.ok.token0.address;
                    const icrc1Ledger1 = swapMeta.ok.token1.address;
                    
                    const ledgerActor0 = createLedgerActor(icrc1Ledger0);
                    const ledgerActor1 = createLedgerActor(icrc1Ledger1);
                    
                    const [metadata0, metadata1] = await Promise.all([
                        ledgerActor0.icrc1_metadata(),
                        ledgerActor1.icrc1_metadata()
                    ]);
                    
                    let token0Logo = getTokenLogo(metadata0);
                    let token1Logo = getTokenLogo(metadata1);
                    
                    const token0Symbol = tokenMeta?.token0?.find(([key]) => key === "symbol")?.[1]?.Text ?? "Unknown";
                    const token1Symbol = tokenMeta?.token1?.find(([key]) => key === "symbol")?.[1]?.Text ?? "Unknown";
                    const token0Decimals = tokenMeta?.token0?.find(([key]) => key === "decimals")?.[1]?.Nat ?? 8;
                    const token1Decimals = tokenMeta?.token1?.find(([key]) => key === "decimals")?.[1]?.Nat ?? 8;
                    
                    if (token0Symbol?.toLowerCase() === 'icp' && !token0Logo) token0Logo = 'icp_symbol.svg';
                    if (token1Symbol?.toLowerCase() === 'icp' && !token1Logo) token1Logo = 'icp_symbol.svg';
                    
                    const userPositionIds = (await swapActor.getUserPositionIdsByPrincipal(identity.getPrincipal())).ok || [];
                    const claimedForSwap = claimedBySwap[swapId] || [];
                    const claimedIds = claimedForSwap.map(p => p.position_id);
                    
                    let offset = 0;
                    const limit = 10;
                    let hasMore = true;
                    
                    while (hasMore) {
                        const posResult = await swapActor.getUserPositionWithTokenAmount(offset, limit);
                        const positions = posResult.ok?.content || [];
                        
                        for (const pos of positions) {
                            const isOwned = userPositionIds.includes(pos.id);
                            const isClaimed = claimedIds.includes(pos.id);
                            
                            if (isOwned || isClaimed) {
                                // Check if already locked
                                const claimInfo = claimedForSwap.find(c => c.position_id === pos.id);
                                const isLocked = claimInfo?.lock_info?.unlock_timestamp > BigInt(Date.now()) * 1000000n;
                                
                                if (!isLocked) {
                                    allPositions.push({
                                        swapCanisterId: swapId,
                                        id: pos.id,
                                        token0: Principal.fromText(icrc1Ledger0),
                                        token1: Principal.fromText(icrc1Ledger1),
                                        token0Symbol,
                                        token1Symbol,
                                        token0Logo,
                                        token1Logo,
                                        token0Decimals,
                                        token1Decimals,
                                        token0Amount: pos.token0Amount,
                                        token1Amount: pos.token1Amount,
                                        symbols: `${token0Symbol}/${token1Symbol}`,
                                        frontendOwnership: isOwned
                                    });
                                }
                            }
                        }
                        
                        offset += limit;
                        hasMore = positions.length === limit;
                    }
                } catch (err) {
                    console.error('Error fetching positions for swap:', swapCanister, err);
                }
            }));
            
            setLiquidityPositions(allPositions);
        } catch (error) {
            console.error('Error fetching positions:', error);
        } finally {
            setLoadingPositions(false);
        }
    };

    const handleSetMax = () => {
        if (!selectedToken) return;
        
        let max = selectedToken.available_backend;
        if (selectedToken.available > selectedToken.available_backend) {
            let frontendMax = selectedToken.available - selectedToken.available_backend - selectedToken.fee;
            if (frontendMax < 0n) frontendMax = 0n;
            max += frontendMax;
        }
        if (max < 0n) max = 0n;
        
        setLockAmount(formatAmount(max, selectedToken.decimals));
    };

    const validateLock = () => {
        setLockError('');
        
        if (lockType === 'token') {
            if (!lockAmount) {
                setLockError("Please enter an amount.");
                return false;
            }
            
            const amountFloat = parseFloat(lockAmount);
            if (isNaN(amountFloat) || amountFloat <= 0) {
                setLockError("Please enter a valid positive amount.");
                return false;
            }
            
            const scaledAmount = amountFloat * (10 ** selectedToken.decimals);
            const bigIntAmount = BigInt(Math.floor(scaledAmount));
            
            if (bigIntAmount > selectedToken.available) {
                setLockError("Insufficient available balance.");
                return false;
            }
        }
        
        if (!lockExpiry) {
            setLockError("Please enter an expiration date.");
            return false;
        }
        
        if (new Date(lockExpiry) < new Date()) {
            setLockError("Expiration must be in the future.");
            return false;
        }
        
        return true;
    };

    const handleLock = async () => {
        if (!validateLock()) return;
        
        const expiryDate = new Date(lockExpiry);
        const duration = format_duration(expiryDate - new Date());
        
        if (lockType === 'token') {
            setConfirmMessage(
                `You are about to lock ${lockAmount} ${selectedToken.symbol} ` +
                `until ${dateToReadable(expiryDate)} ${get_short_timezone()} ` +
                `(for ${duration}).`
            );
        } else {
            setConfirmMessage(
                `You are about to lock position #${selectedPosition.id} (${selectedPosition.symbols}) ` +
                `until ${dateToReadable(expiryDate)} ${get_short_timezone()} ` +
                `(for ${duration}).`
            );
        }
        
        setConfirmAction(() => executeLock);
        setShowConfirmModal(true);
    };

    const executeLock = async () => {
        setIsLocking(true);
        setLockError('');
        
        try {
            if (lockType === 'token') {
                await executeTokenLock();
            } else {
                await executePositionLock();
            }
            setLockSuccess(true);
        } catch (error) {
            console.error('Lock error:', error);
            setLockError(error.message || 'An error occurred while creating the lock.');
        } finally {
            setIsLocking(false);
        }
    };

    const executeTokenLock = async () => {
        const ledgerActor = createLedgerActor(selectedToken.ledgerId, { agentOptions: { identity } });
        const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
        
        const amountFloat = parseFloat(lockAmount);
        const scaledAmount = amountFloat * (10 ** selectedToken.decimals);
        const bigIntAmount = BigInt(Math.floor(scaledAmount));
        const amountToSendToBackend = bigIntAmount - selectedToken.available_backend;
        
        // Transfer to backend if needed
        if (amountToSendToBackend > 0n) {
            const subaccount = principalToSubAccount(identity.getPrincipal());
            const result = await ledgerActor.icrc1_transfer({
                to: { owner: Principal.fromText(sneedLockCanisterId), subaccount: [subaccount] },
                fee: [],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
                amount: amountToSendToBackend
            });
            
            if (result.Err) {
                throw new Error(`Transfer failed: ${JSON.stringify(result.Err)}`);
            }
        }
        
        // Create the lock
        const expiryBigInt = BigInt(new Date(lockExpiry).getTime()) * 1000000n;
        const result = await sneedLockActor.create_lock(
            bigIntAmount,
            selectedToken.ledger_canister_id,
            expiryBigInt
        );
        
        if (result.Err) {
            throw new Error(result.Err.message || JSON.stringify(result.Err));
        }
    };

    const executePositionLock = async () => {
        const swapActor = createIcpSwapActor(selectedPosition.swapCanisterId, { agentOptions: { identity } });
        const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
        
        const expiryBigInt = BigInt(new Date(lockExpiry).getTime()) * 1000000n;
        
        if (selectedPosition.frontendOwnership) {
            // Position is owned by user - need to claim and transfer
            const claimed = await sneedLockActor.claim_position(
                Principal.fromText(selectedPosition.swapCanisterId), 
                selectedPosition.id
            );
            
            if (!claimed) {
                throw new Error("Unable to claim position.");
            }
            
            const transferResult = await swapActor.transferPosition(
                identity.getPrincipal(),
                Principal.fromText(sneedLockCanisterId),
                selectedPosition.id
            );
            
            if (transferResult.err) {
                throw new Error(`Unable to transfer position: ${JSON.stringify(transferResult.err)}`);
            }
            
            const lockResult = await sneedLockActor.create_position_lock(
                Principal.fromText(selectedPosition.swapCanisterId),
                dex_icpswap,
                selectedPosition.id,
                expiryBigInt,
                selectedPosition.token0,
                selectedPosition.token1
            );
            
            if (lockResult.Err) {
                throw new Error(lockResult.Err.message || JSON.stringify(lockResult.Err));
            }
        } else {
            // Position already claimed - just create lock
            const lockResult = await sneedLockActor.create_position_lock(
                Principal.fromText(selectedPosition.swapCanisterId),
                dex_icpswap,
                selectedPosition.id,
                expiryBigInt,
                selectedPosition.token0,
                selectedPosition.token1
            );
            
            if (lockResult.Err) {
                throw new Error(lockResult.Err.message || JSON.stringify(lockResult.Err));
            }
        }
    };

    const goToStep = (step) => {
        if (step < currentStep) {
            setCurrentStep(step);
            if (step === 1) {
                setSelectedToken(null);
                setSelectedPosition(null);
                setLockAmount('');
                setLockSuccess(false);
                setPaymentError('');
            } else if (step === 2) {
                setLockAmount('');
                setLockSuccess(false);
                setPaymentError('');
            } else if (step === 3) {
                setLockAmount('');
                setLockSuccess(false);
            }
        }
    };

    const styles = {
        container: {
            maxWidth: '800px',
            margin: '0 auto',
            padding: '1.5rem 1rem',
            color: theme.colors.primaryText,
        },
        hero: {
            textAlign: 'center',
            marginBottom: '1.5rem',
        },
        title: {
            fontSize: '1.75rem',
            marginBottom: '0.5rem',
            color: theme.colors.primaryText,
            fontWeight: '700',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
        },
        subtitle: {
            fontSize: '1rem',
            color: theme.colors.secondaryText,
            marginBottom: '0.5rem',
            lineHeight: '1.6',
        },
        stepProgress: {
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            gap: '0',
            marginBottom: '1.5rem',
            padding: '1.25rem',
            background: theme.colors.cardGradient,
            borderRadius: '16px',
            border: `1px solid ${theme.colors.border}`,
            boxShadow: theme.colors.cardShadow,
        },
        stepCircle: (stepNum, isActive, isCompleted) => ({
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '600',
            fontSize: '1rem',
            background: isCompleted 
                ? `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)` 
                : isActive 
                    ? `linear-gradient(135deg, ${lockPrimary}, ${lockSecondary})` 
                    : theme.colors.tertiaryBg,
            color: isCompleted || isActive ? '#fff' : theme.colors.mutedText,
            border: 'none',
            cursor: isCompleted ? 'pointer' : 'default',
            transition: 'all 0.3s ease',
            boxShadow: isActive ? `0 4px 16px ${lockPrimary}50` : isCompleted ? `0 4px 12px ${theme.colors.success}40` : 'none',
        }),
        stepLine: (isCompleted) => ({
            width: '40px',
            height: '3px',
            background: isCompleted 
                ? `linear-gradient(90deg, ${theme.colors.success}, ${theme.colors.success}dd)` 
                : theme.colors.border,
            transition: 'all 0.3s ease',
            marginTop: '20px',
            borderRadius: '2px',
        }),
        stepLabel: (isActive) => ({
            fontSize: '0.7rem',
            fontWeight: isActive ? '600' : '500',
            color: isActive ? theme.colors.primaryText : theme.colors.mutedText,
            marginTop: '8px',
            textAlign: 'center',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
        }),
        optionsGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem',
        },
        optionCard: (isSelected, isHovered) => ({
            background: isSelected 
                ? `linear-gradient(135deg, ${lockPrimary}15, ${lockPrimary}05)` 
                : theme.colors.cardGradient,
            border: `2px solid ${isSelected ? lockPrimary : isHovered ? `${lockPrimary}50` : theme.colors.border}`,
            borderRadius: '16px',
            padding: '1.5rem',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            transform: isHovered ? 'translateY(-4px)' : 'translateY(0)',
            boxShadow: isSelected || isHovered 
                ? `0 12px 40px ${lockPrimary}20` 
                : theme.colors.cardShadow,
        }),
        optionIcon: (isSelected) => ({
            fontSize: '2.5rem',
            marginBottom: '0.75rem',
            color: isSelected ? lockPrimary : theme.colors.mutedText,
            transition: 'color 0.3s ease',
        }),
        optionTitle: {
            fontSize: '1.15rem',
            fontWeight: '600',
            marginBottom: '0.5rem',
            color: theme.colors.primaryText,
        },
        optionDescription: {
            fontSize: '0.85rem',
            color: theme.colors.secondaryText,
            lineHeight: '1.5',
        },
        tokenList: {
            display: 'grid',
            gap: '10px',
            marginBottom: '1.5rem',
        },
        tokenItem: (isSelected) => ({
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            padding: '14px',
            background: isSelected ? `linear-gradient(135deg, ${lockPrimary}15, ${lockPrimary}05)` : theme.colors.cardGradient,
            border: `2px solid ${isSelected ? lockPrimary : theme.colors.border}`,
            borderRadius: '14px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: isSelected ? `0 4px 16px ${lockPrimary}20` : 'none',
        }),
        tokenLogo: {
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            objectFit: 'cover',
            border: `2px solid ${theme.colors.border}`,
        },
        tokenInfo: {
            flex: 1,
        },
        tokenSymbol: {
            fontSize: '1.05rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
        },
        tokenBalance: {
            fontSize: '0.85rem',
            color: theme.colors.mutedText,
        },
        positionItem: (isSelected) => ({
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            padding: '14px',
            background: isSelected ? `linear-gradient(135deg, ${lockPrimary}15, ${lockPrimary}05)` : theme.colors.cardGradient,
            border: `2px solid ${isSelected ? lockPrimary : theme.colors.border}`,
            borderRadius: '14px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: isSelected ? `0 4px 16px ${lockPrimary}20` : 'none',
        }),
        positionLogos: {
            display: 'flex',
            alignItems: 'center',
        },
        positionLogo: (index) => ({
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            objectFit: 'cover',
            marginLeft: index > 0 ? '-12px' : '0',
            border: `3px solid ${theme.colors.primaryBg}`,
        }),
        configCard: {
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
            padding: '1.5rem',
            marginBottom: '1.25rem',
            boxShadow: theme.colors.cardShadow,
        },
        inputGroup: {
            marginBottom: '1.25rem',
        },
        label: {
            display: 'block',
            color: theme.colors.primaryText,
            marginBottom: '8px',
            fontWeight: '600',
            fontSize: '0.9rem',
        },
        inputRow: {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
        },
        input: {
            flex: 1,
            minWidth: '150px',
            padding: '12px 14px',
            background: theme.colors.primaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '10px',
            color: theme.colors.primaryText,
            fontSize: '1rem',
            outline: 'none',
        },
        maxButton: {
            background: `linear-gradient(135deg, ${lockPrimary}, ${lockSecondary})`,
            color: '#fff',
            border: 'none',
            borderRadius: '10px',
            padding: '12px 16px',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '0.85rem',
            boxShadow: `0 4px 12px ${lockPrimary}30`,
        },
        buttonRow: {
            display: 'flex',
            gap: '12px',
            marginTop: '1.5rem',
            flexWrap: 'wrap',
        },
        backButton: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            flex: 1,
            minWidth: '120px',
            padding: '14px 20px',
            background: theme.colors.cardGradient || theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '12px',
            color: theme.colors.primaryText,
            fontSize: '0.95rem',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
        },
        continueButton: (isEnabled) => ({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            flex: 2,
            minWidth: '180px',
            padding: '14px 24px',
            background: isEnabled 
                ? `linear-gradient(135deg, ${lockPrimary}, ${lockSecondary})` 
                : theme.colors.tertiaryBg,
            border: 'none',
            borderRadius: '12px',
            color: isEnabled ? '#fff' : theme.colors.mutedText,
            fontSize: '0.95rem',
            fontWeight: '600',
            cursor: isEnabled ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s ease',
            boxShadow: isEnabled ? `0 4px 20px ${lockPrimary}40` : 'none',
        }),
        errorBox: {
            color: theme.colors.error,
            padding: '14px',
            background: `${theme.colors.error}15`,
            border: `1px solid ${theme.colors.error}30`,
            borderRadius: '12px',
            marginBottom: '1rem',
            fontSize: '0.9rem',
        },
        successCard: {
            textAlign: 'center',
            padding: '2.5rem 1.5rem',
            background: `linear-gradient(135deg, ${theme.colors.success}10 0%, ${theme.colors.cardGradient || theme.colors.cardBackground} 100%)`,
            border: `2px solid ${theme.colors.success}40`,
            borderRadius: '20px',
            boxShadow: `0 8px 32px ${theme.colors.success}20`,
        },
        successIcon: {
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: `linear-gradient(135deg, ${theme.colors.success}30, ${theme.colors.success}10)`,
            border: `2px solid ${theme.colors.success}40`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.5rem',
        },
        spinner: {
            animation: 'spin 1s linear infinite',
        },
        loadingContainer: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '3rem',
            gap: '1rem',
        },
        emptyState: {
            textAlign: 'center',
            padding: '3rem',
            color: theme.colors.mutedText,
            background: theme.colors.cardGradient,
            borderRadius: '16px',
            border: `1px solid ${theme.colors.border}`,
        },
        loginPrompt: {
            textAlign: 'center',
            padding: '2.5rem 1.5rem',
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '20px',
            boxShadow: theme.colors.cardShadow,
        },
    };

    if (!isAuthenticated) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <style>{customStyles}</style>
                <Header customLogo="/sneedlock-logo4.png" />
                <main style={styles.container}>
                    <div className="lock-fade-in" style={styles.loginPrompt}>
                        <div className="lock-float" style={{
                            width: '72px',
                            height: '72px',
                            borderRadius: '18px',
                            background: `linear-gradient(135deg, ${lockPrimary}, ${lockSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 1.5rem',
                            boxShadow: `0 8px 32px ${lockPrimary}50`,
                        }}>
                            <FaLock size={28} style={{ color: '#fff' }} />
                        </div>
                        <h2 style={{ color: theme.colors.primaryText, marginBottom: '0.75rem', fontSize: '1.5rem', fontWeight: '700' }}>
                            Lock Wizard
                        </h2>
                        <p style={{ fontSize: '1rem', color: theme.colors.secondaryText, marginBottom: '1.5rem', lineHeight: '1.6' }}>
                            Please log in to access the Lock Wizard
                        </p>
                    </div>
                </main>
            </div>
        );
    }

    const stepLabels = ['Type', 'Select', 'Payment', 'Configure'];
    
    const renderStepProgress = () => (
        <div className="lock-fade-in" style={styles.stepProgress}>
            {[1, 2, 3, 4].map((stepNum, index) => (
                <React.Fragment key={stepNum}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div 
                            style={styles.stepCircle(stepNum, stepNum === currentStep, stepNum < currentStep)}
                            onClick={() => stepNum < currentStep && goToStep(stepNum)}
                        >
                            {stepNum < currentStep ? <FaCheck size={16} /> : stepNum}
                        </div>
                        <div style={styles.stepLabel(stepNum === currentStep)}>
                            {stepLabels[stepNum - 1]}
                        </div>
                    </div>
                    {index < 3 && <div style={styles.stepLine(stepNum < currentStep)} />}
                </React.Fragment>
            ))}
        </div>
    );

    const renderStep1 = () => (
        <>
            <div className="lock-fade-in" style={styles.hero}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', marginBottom: '0.75rem' }}>
                    <div className="lock-float" style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '14px',
                        background: `linear-gradient(135deg, ${lockPrimary}, ${lockSecondary})`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: `0 4px 16px ${lockPrimary}40`,
                    }}>
                        <FaLock size={20} style={{ color: '#fff' }} />
                    </div>
                    <h1 style={{ ...styles.title, margin: 0, justifyContent: 'flex-start' }}>
                        Lock Wizard
                    </h1>
                </div>
                <p style={styles.subtitle}>
                    What would you like to lock?
                </p>
            </div>

            <div className="lock-fade-in" style={styles.optionsGrid}>
                <div
                    style={styles.optionCard(lockType === 'token', isHovering === 'token')}
                    onClick={() => setLockType('token')}
                    onMouseEnter={() => setIsHovering('token')}
                    onMouseLeave={() => setIsHovering(null)}
                >
                    <div style={styles.optionIcon(lockType === 'token')}>
                        <FaCoins />
                    </div>
                    <h3 style={styles.optionTitle}>Lock Tokens</h3>
                    <p style={styles.optionDescription}>
                        Lock ICRC-1 tokens for vesting, commitment proof, or trust-building.
                    </p>
                </div>

                <div
                    style={styles.optionCard(lockType === 'position', isHovering === 'position')}
                    onClick={() => setLockType('position')}
                    onMouseEnter={() => setIsHovering('position')}
                    onMouseLeave={() => setIsHovering(null)}
                >
                    <div style={styles.optionIcon(lockType === 'position')}>
                        <FaWater />
                    </div>
                    <h3 style={styles.optionTitle}>Lock Liquidity Position</h3>
                    <p style={styles.optionDescription}>
                        Lock LP positions while still earning fees.
                    </p>
                </div>
            </div>

            <div style={styles.buttonRow}>
                <button
                    style={styles.continueButton(!!lockType)}
                    onClick={() => lockType && setCurrentStep(2)}
                    disabled={!lockType}
                >
                    Continue
                    <FaArrowRight />
                </button>
            </div>
        </>
    );

    const renderStep2 = () => {
        const isLoading = lockType === 'token' ? loadingTokens : loadingPositions;
        const items = lockType === 'token' ? tokens : liquidityPositions;
        const selectedItem = lockType === 'token' ? selectedToken : selectedPosition;
        
        return (
            <>
                <div className="lock-fade-in" style={styles.hero}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', marginBottom: '0.75rem' }}>
                        <div style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '14px',
                            background: `linear-gradient(135deg, ${lockPrimary}30, ${lockPrimary}10)`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                            {lockType === 'token' ? <FaCoins size={22} style={{ color: lockPrimary }} /> : <FaWater size={22} style={{ color: lockPrimary }} />}
                        </div>
                        <h1 style={{ ...styles.title, margin: 0, justifyContent: 'flex-start' }}>
                            Select {lockType === 'token' ? 'Token' : 'Position'}
                        </h1>
                    </div>
                    <p style={styles.subtitle}>
                        Choose the {lockType === 'token' ? 'token' : 'liquidity position'} you want to lock
                    </p>
                </div>

                {isLoading ? (
                    <div style={styles.loadingContainer}>
                        <FaSpinner size={32} style={{ ...styles.spinner, color: theme.colors.accent }} />
                        <p style={{ color: theme.colors.mutedText }}>
                            Loading {lockType === 'token' ? 'tokens' : 'positions'}...
                        </p>
                    </div>
                ) : items.length === 0 ? (
                    <div style={styles.emptyState}>
                        <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                            No {lockType === 'token' ? 'tokens' : 'positions'} available to lock
                        </p>
                        <p style={{ fontSize: '0.9rem' }}>
                            {lockType === 'token' 
                                ? 'Add tokens to your wallet first' 
                                : 'Create liquidity positions first'}
                        </p>
                    </div>
                ) : (
                    <div style={styles.tokenList}>
                        {lockType === 'token' ? (
                            tokens.map((token) => (
                                <div
                                    key={token.ledgerId}
                                    style={styles.tokenItem(selectedToken?.ledgerId === token.ledgerId)}
                                    onClick={() => setSelectedToken(token)}
                                >
                                    <img 
                                        src={token.logo || '/icp_symbol.svg'} 
                                        alt={token.symbol}
                                        style={styles.tokenLogo}
                                        onError={(e) => { e.target.src = '/icp_symbol.svg'; }}
                                    />
                                    <div style={styles.tokenInfo}>
                                        <div style={styles.tokenSymbol}>{token.symbol}</div>
                                        <div style={styles.tokenBalance}>
                                            Available: {formatAmount(token.available, token.decimals)} {token.symbol}
                                        </div>
                                    </div>
                                    {selectedToken?.ledgerId === token.ledgerId && (
                                        <FaCheck style={{ color: theme.colors.accent }} />
                                    )}
                                </div>
                            ))
                        ) : (
                            liquidityPositions.map((pos) => (
                                <div
                                    key={`${pos.swapCanisterId}-${pos.id}`}
                                    style={styles.positionItem(selectedPosition?.id === pos.id && selectedPosition?.swapCanisterId === pos.swapCanisterId)}
                                    onClick={() => setSelectedPosition(pos)}
                                >
                                    <div style={styles.positionLogos}>
                                        <img 
                                            src={pos.token0Logo || '/icp_symbol.svg'} 
                                            alt={pos.token0Symbol}
                                            style={styles.positionLogo(0)}
                                            onError={(e) => { e.target.src = '/icp_symbol.svg'; }}
                                        />
                                        <img 
                                            src={pos.token1Logo || '/icp_symbol.svg'} 
                                            alt={pos.token1Symbol}
                                            style={styles.positionLogo(1)}
                                            onError={(e) => { e.target.src = '/icp_symbol.svg'; }}
                                        />
                                    </div>
                                    <div style={styles.tokenInfo}>
                                        <div style={styles.tokenSymbol}>
                                            {pos.symbols} #{pos.id.toString()}
                                        </div>
                                        <div style={styles.tokenBalance}>
                                            {formatAmount(pos.token0Amount, pos.token0Decimals)} {pos.token0Symbol} / {formatAmount(pos.token1Amount, pos.token1Decimals)} {pos.token1Symbol}
                                        </div>
                                    </div>
                                    {selectedPosition?.id === pos.id && selectedPosition?.swapCanisterId === pos.swapCanisterId && (
                                        <FaCheck style={{ color: theme.colors.accent }} />
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                )}

                <div style={styles.buttonRow}>
                    <button
                        style={styles.backButton}
                        onClick={() => goToStep(1)}
                    >
                        <FaArrowLeft />
                        Back
                    </button>
                    <button
                        style={styles.continueButton(!!selectedItem)}
                        onClick={() => selectedItem && setCurrentStep(3)}
                        disabled={!selectedItem}
                    >
                        Continue
                        <FaArrowRight />
                    </button>
                </div>
            </>
        );
    };

    // Step 3: Payment
    const renderStep3 = () => {
        const feeAmount = BigInt(requiredFee);
        const hasSufficientPayment = paymentBalance >= feeAmount;
        const isFreeToLock = feeAmount === 0n;
        
        return (
            <>
                <div className="lock-fade-in" style={styles.hero}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', marginBottom: '0.75rem' }}>
                        <div style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '14px',
                            background: `linear-gradient(135deg, ${lockPrimary}30, ${lockPrimary}10)`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                            <FaWallet size={22} style={{ color: lockPrimary }} />
                        </div>
                        <h1 style={{ ...styles.title, margin: 0, justifyContent: 'flex-start' }}>
                            Payment
                        </h1>
                    </div>
                    <p style={styles.subtitle}>
                        {isFreeToLock 
                            ? '✨ No payment required for this lock!' 
                            : 'Send the required ICP to proceed with your lock'}
                    </p>
                </div>

                <div className="lock-fade-in" style={styles.configCard}>
                    {/* Premium status */}
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        paddingBottom: '1rem',
                        borderBottom: `1px solid ${theme.colors.border}`,
                        marginBottom: '1.5rem'
                    }}>
                        <div>
                            <span style={{ color: theme.colors.secondaryText, marginRight: '10px' }}>Status:</span>
                            {loadingPremium ? (
                                <FaSpinner style={styles.spinner} />
                            ) : isPremium ? (
                                <PremiumBadge size="small" />
                            ) : (
                                <span style={{ color: theme.colors.mutedText }}>Standard User</span>
                            )}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>Lock Type</div>
                            <div style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                                {lockType === 'token' ? 'Token Lock' : 'Position Lock'}
                            </div>
                        </div>
                    </div>

                    {loadingPayment ? (
                        <div style={styles.loadingContainer}>
                            <FaSpinner size={32} style={{ ...styles.spinner, color: theme.colors.accent }} />
                            <p style={{ color: theme.colors.mutedText }}>Loading payment information...</p>
                        </div>
                    ) : (
                        <>
                            {/* Fee breakdown */}
                            <div style={{ 
                                background: theme.colors.secondaryBg, 
                                borderRadius: '12px', 
                                padding: '1.5rem',
                                marginBottom: '1.5rem'
                            }}>
                                <div style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center',
                                    marginBottom: '1rem'
                                }}>
                                    <span style={{ color: theme.colors.secondaryText }}>Lock Fee:</span>
                                    <span style={{ 
                                        color: isFreeToLock ? theme.colors.success : theme.colors.primaryText,
                                        fontSize: '1.2rem',
                                        fontWeight: 'bold'
                                    }}>
                                        {isFreeToLock ? 'FREE' : formatIcp(feeAmount)}
                                    </span>
                                </div>
                                
                                {!isFreeToLock && (
                                    <>
                                        <div style={{ 
                                            display: 'flex', 
                                            justifyContent: 'space-between', 
                                            alignItems: 'center',
                                            marginBottom: '1rem'
                                        }}>
                                            <span style={{ color: theme.colors.secondaryText }}>Payment Deposited:</span>
                                            <span style={{ 
                                                color: hasSufficientPayment ? theme.colors.success : theme.colors.warning,
                                                fontWeight: '500'
                                            }}>
                                                {formatIcp(paymentBalance)}
                                            </span>
                                        </div>
                                        
                                        <div style={{ 
                                            display: 'flex', 
                                            justifyContent: 'space-between', 
                                            alignItems: 'center',
                                            paddingTop: '1rem',
                                            borderTop: `1px solid ${theme.colors.border}`
                                        }}>
                                            <span style={{ color: theme.colors.secondaryText }}>Your ICP Wallet:</span>
                                            <span style={{ color: theme.colors.primaryText }}>
                                                {formatIcp(icpWalletBalance)}
                                            </span>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Payment status / action */}
                            {!isFreeToLock && (
                                <div style={{ 
                                    background: hasSufficientPayment 
                                        ? `${theme.colors.success}15` 
                                        : `${theme.colors.warning}15`,
                                    border: `1px solid ${hasSufficientPayment ? theme.colors.success : theme.colors.warning}30`,
                                    borderRadius: '12px',
                                    padding: '1rem',
                                    marginBottom: '1rem'
                                }}>
                                    {hasSufficientPayment ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <FaCheck style={{ color: theme.colors.success }} />
                                            <span style={{ color: theme.colors.success }}>
                                                Payment ready! You can proceed to configure your lock.
                                            </span>
                                        </div>
                                    ) : (
                                        <div>
                                            <p style={{ color: theme.colors.warning, marginBottom: '1rem' }}>
                                                Please deposit {formatIcp(feeAmount - paymentBalance)} more ICP to proceed.
                                            </p>
                                            <button
                                                onClick={handlePayFee}
                                                disabled={isPayingFee || icpWalletBalance < (feeAmount - paymentBalance + 10_000n)}
                                                style={{
                                                    background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}dd)`,
                                                    color: theme.colors.primaryBg,
                                                    border: 'none',
                                                    borderRadius: '8px',
                                                    padding: '12px 24px',
                                                    fontWeight: '600',
                                                    cursor: isPayingFee ? 'not-allowed' : 'pointer',
                                                    opacity: isPayingFee ? 0.7 : 1,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px'
                                                }}
                                            >
                                                {isPayingFee ? (
                                                    <>
                                                        <FaSpinner style={styles.spinner} />
                                                        Sending...
                                                    </>
                                                ) : (
                                                    <>
                                                        <FaWallet />
                                                        Send {formatIcp(feeAmount - paymentBalance + 10_000n)}
                                                    </>
                                                )}
                                            </button>
                                            {icpWalletBalance < (feeAmount - paymentBalance + 10_000n) && (
                                                <p style={{ color: theme.colors.error, fontSize: '0.85rem', marginTop: '0.5rem' }}>
                                                    Insufficient ICP balance in wallet
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {paymentError && (
                                <div style={styles.errorBox}>
                                    {paymentError}
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div style={styles.buttonRow}>
                    <button
                        style={styles.backButton}
                        onClick={() => goToStep(2)}
                    >
                        <FaArrowLeft />
                        Back
                    </button>
                    <button
                        style={styles.continueButton(isFreeToLock || hasSufficientPayment)}
                        onClick={() => (isFreeToLock || hasSufficientPayment) && setCurrentStep(4)}
                        disabled={!isFreeToLock && !hasSufficientPayment}
                    >
                        Continue
                        <FaArrowRight />
                    </button>
                </div>
            </>
        );
    };

    // Step 4: Configure
    const renderStep4 = () => {
        if (lockSuccess) {
            return (
                <div className="lock-fade-in" style={styles.successCard}>
                    <div className="lock-pulse" style={styles.successIcon}>
                        <FaCheck size={40} style={{ color: theme.colors.success }} />
                    </div>
                    <h2 style={{ color: theme.colors.primaryText, marginBottom: '0.75rem', fontSize: '1.5rem', fontWeight: '700' }}>
                        🎉 Lock Created Successfully!
                    </h2>
                    <p style={{ color: theme.colors.secondaryText, marginBottom: '1.5rem', fontSize: '1rem', lineHeight: '1.6' }}>
                        Your {lockType === 'token' ? 'tokens have' : 'liquidity position has'} been locked until <strong style={{ color: theme.colors.primaryText }}>{dateToReadable(new Date(lockExpiry))}</strong>.
                    </p>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button
                            style={{
                                ...styles.backButton,
                                flex: 'none',
                                padding: '12px 20px',
                            }}
                            onClick={() => {
                                setCurrentStep(1);
                                setLockType(null);
                                setSelectedToken(null);
                                setSelectedPosition(null);
                                setLockAmount('');
                                setLockSuccess(false);
                            }}
                        >
                            <FaLock size={14} /> Create Another Lock
                        </button>
                        <button
                            style={{
                                ...styles.continueButton(true),
                                flex: 'none',
                                padding: '12px 20px',
                                background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`,
                                boxShadow: `0 4px 16px ${theme.colors.success}40`,
                            }}
                            onClick={() => navigate(`/sneedlock_info?owner=${identity.getPrincipal().toString()}`)}
                        >
                            <FaShieldAlt size={14} /> View My Locks
                        </button>
                    </div>
                </div>
            );
        }

        return (
            <>
                <div className="lock-fade-in" style={styles.hero}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', marginBottom: '0.75rem' }}>
                        <div style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '14px',
                            background: `linear-gradient(135deg, ${lockPrimary}30, ${lockPrimary}10)`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                            <FaLock size={22} style={{ color: lockPrimary }} />
                        </div>
                        <h1 style={{ ...styles.title, margin: 0, justifyContent: 'flex-start' }}>
                            Configure Lock
                        </h1>
                    </div>
                    <p style={styles.subtitle}>
                        Set the lock parameters for your <strong style={{ color: lockPrimary }}>{lockType === 'token' ? selectedToken?.symbol : selectedPosition?.symbols}</strong>
                    </p>
                </div>

                <div className="lock-fade-in" style={styles.configCard}>
                    {/* Summary of what's being locked */}
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '16px', 
                        paddingBottom: '1.5rem',
                        borderBottom: `1px solid ${theme.colors.border}`,
                        marginBottom: '1.5rem'
                    }}>
                        {lockType === 'token' ? (
                            <>
                                <img 
                                    src={selectedToken?.logo || '/icp_symbol.svg'} 
                                    alt={selectedToken?.symbol}
                                    style={styles.tokenLogo}
                                    onError={(e) => { e.target.src = '/icp_symbol.svg'; }}
                                />
                                <div>
                                    <div style={styles.tokenSymbol}>{selectedToken?.symbol}</div>
                                    <div style={styles.tokenBalance}>
                                        Available: {formatAmount(selectedToken?.available || 0n, selectedToken?.decimals || 8)}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                <div style={styles.positionLogos}>
                                    <img 
                                        src={selectedPosition?.token0Logo || '/icp_symbol.svg'} 
                                        alt={selectedPosition?.token0Symbol}
                                        style={styles.positionLogo(0)}
                                        onError={(e) => { e.target.src = '/icp_symbol.svg'; }}
                                    />
                                    <img 
                                        src={selectedPosition?.token1Logo || '/icp_symbol.svg'} 
                                        alt={selectedPosition?.token1Symbol}
                                        style={styles.positionLogo(1)}
                                        onError={(e) => { e.target.src = '/icp_symbol.svg'; }}
                                    />
                                </div>
                                <div>
                                    <div style={styles.tokenSymbol}>
                                        {selectedPosition?.symbols} #{selectedPosition?.id?.toString()}
                                    </div>
                                    <div style={styles.tokenBalance}>
                                        {formatAmount(selectedPosition?.token0Amount || 0n, selectedPosition?.token0Decimals || 8)} {selectedPosition?.token0Symbol} / {formatAmount(selectedPosition?.token1Amount || 0n, selectedPosition?.token1Decimals || 8)} {selectedPosition?.token1Symbol}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Amount input (token lock only) */}
                    {lockType === 'token' && (
                        <div style={styles.inputGroup}>
                            <label style={styles.label}>Amount to Lock:</label>
                            <div style={styles.inputRow}>
                                <input
                                    type="number"
                                    placeholder="Enter amount"
                                    value={lockAmount}
                                    onChange={(e) => setLockAmount(e.target.value)}
                                    style={styles.input}
                                />
                                <button onClick={handleSetMax} style={styles.maxButton}>
                                    MAX
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Expiry input */}
                    <div style={styles.inputGroup}>
                        <label style={styles.label}>Lock Until ({get_short_timezone()}):</label>
                        <input
                            type="datetime-local"
                            value={lockExpiry}
                            onChange={(e) => setLockExpiry(e.target.value)}
                            style={{ ...styles.input, width: '100%' }}
                        />
                    </div>

                    {lockError && (
                        <div style={styles.errorBox}>
                            {lockError}
                        </div>
                    )}
                </div>

                <div style={styles.buttonRow}>
                    <button
                        style={styles.backButton}
                        onClick={() => goToStep(3)}
                        disabled={isLocking}
                    >
                        <FaArrowLeft />
                        Back
                    </button>
                    <button
                        style={styles.continueButton(!isLocking)}
                        onClick={handleLock}
                        disabled={isLocking}
                    >
                        {isLocking ? (
                            <>
                                <FaSpinner style={styles.spinner} />
                                Locking...
                            </>
                        ) : (
                            <>
                                <FaLock />
                                Create Lock
                            </>
                        )}
                    </button>
                </div>
            </>
        );
    };

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            <Header customLogo="/sneedlock-logo4.png" />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${lockPrimary}12 50%, ${lockSecondary}08 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '1.5rem 1rem',
                position: 'relative',
                overflow: 'hidden',
                width: '100%',
                boxSizing: 'border-box'
            }}>
                {/* Background decorations */}
                <div style={{
                    position: 'absolute',
                    top: '-50%',
                    right: '-5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${lockPrimary}15 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-40%',
                    left: '10%',
                    width: '200px',
                    height: '200px',
                    background: `radial-gradient(circle, ${lockSecondary}10 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                
                <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        background: `${lockPrimary}20`,
                        color: lockPrimary,
                        padding: '6px 14px',
                        borderRadius: '20px',
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        marginBottom: '0.5rem'
                    }}>
                        <FaLock size={12} /> SneedLock
                    </div>
                    <h1 style={{
                        fontSize: '1.75rem',
                        fontWeight: '700',
                        color: theme.colors.primaryText,
                        margin: '0.5rem 0',
                        letterSpacing: '-0.5px'
                    }}>
                        Lock Wizard
                    </h1>
                    <p style={{
                        color: theme.colors.secondaryText,
                        fontSize: '0.95rem',
                        margin: 0
                    }}>
                        Secure your tokens and liquidity positions
                    </p>
                </div>
            </div>
            
            <main style={styles.container}>
                {renderStepProgress()}
                {currentStep === 1 && renderStep1()}
                {currentStep === 2 && renderStep2()}
                {currentStep === 3 && renderStep3()}
                {currentStep === 4 && renderStep4()}
            </main>
            <ConfirmationModal
                show={showConfirmModal}
                onClose={() => setShowConfirmModal(false)}
                onSubmit={confirmAction}
                message={confirmMessage}
                doAwait={false}
            />
        </div>
    );
}

export default LockWizard;
