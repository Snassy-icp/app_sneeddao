import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaCoins, FaWater, FaArrowRight, FaArrowLeft, FaLock, FaCheck, FaSpinner } from 'react-icons/fa';
import { Principal } from '@dfinity/principal';
import { principalToSubAccount } from '@dfinity/utils';
import Header from '../components/Header';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'external/sneed_lock';
import { getTokenLogo, getTokenMetaForSwap, get_token_conversion_rate } from '../utils/TokenUtils';
import { formatAmount } from '../utils/StringUtils';
import { get_short_timezone, format_duration, dateToReadable, getInitialExpiry } from '../utils/DateUtils';
import ConfirmationModal from '../ConfirmationModal';

const SNEED_CANISTER_ID = 'hvgxa-wqaaa-aaaaq-aacia-cai';
const dex_icpswap = { ICPSwap: null };

function LockWizard() {
    const navigate = useNavigate();
    const { identity, isAuthenticated } = useAuth();
    const { theme } = useTheme();
    
    // Wizard state
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
    
    // Step 3: Lock configuration state
    const [lockAmount, setLockAmount] = useState('');
    const [lockExpiry, setLockExpiry] = useState('');
    const [isLocking, setIsLocking] = useState(false);
    const [lockError, setLockError] = useState('');
    const [lockSuccess, setLockSuccess] = useState(false);
    
    // Confirmation modal
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const [confirmMessage, setConfirmMessage] = useState('');

    // Reset expiry when entering step 3
    useEffect(() => {
        if (currentStep === 3) {
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
            // Check if SNEED token
            const tokenId = selectedToken.ledgerId;
            if (tokenId === SNEED_CANISTER_ID) {
                setLockError("SNEED tokens cannot be locked.");
                return false;
            }
            
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
            } else if (step === 2) {
                setLockAmount('');
                setLockSuccess(false);
            }
        }
    };

    const styles = {
        container: {
            maxWidth: '900px',
            margin: '0 auto',
            padding: '2rem',
            color: theme.colors.primaryText,
        },
        hero: {
            textAlign: 'center',
            marginBottom: '2rem',
        },
        title: {
            fontSize: '2.2rem',
            marginBottom: '0.5rem',
            color: theme.colors.primaryText,
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
        },
        subtitle: {
            fontSize: '1.1rem',
            color: theme.colors.mutedText,
            marginBottom: '0.5rem',
            lineHeight: '1.5',
        },
        stepProgress: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0',
            marginBottom: '2rem',
        },
        stepCircle: (stepNum, isActive, isCompleted) => ({
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '600',
            fontSize: '1rem',
            background: isCompleted 
                ? theme.colors.success 
                : isActive 
                    ? theme.colors.accent 
                    : theme.colors.tertiaryBg,
            color: isCompleted || isActive ? theme.colors.primaryBg : theme.colors.mutedText,
            border: `2px solid ${isCompleted ? theme.colors.success : isActive ? theme.colors.accent : theme.colors.border}`,
            cursor: isCompleted ? 'pointer' : 'default',
            transition: 'all 0.3s ease',
        }),
        stepLine: (isCompleted) => ({
            width: '60px',
            height: '3px',
            background: isCompleted ? theme.colors.success : theme.colors.border,
            transition: 'all 0.3s ease',
        }),
        stepLabel: (isActive) => ({
            fontSize: '0.75rem',
            color: isActive ? theme.colors.primaryText : theme.colors.mutedText,
            marginTop: '6px',
            textAlign: 'center',
        }),
        optionsGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1.5rem',
            marginBottom: '2rem',
        },
        optionCard: (isSelected, isHovered) => ({
            background: isSelected 
                ? theme.colors.accentGradient 
                : theme.colors.cardGradient,
            border: `2px solid ${isSelected ? theme.colors.accent : isHovered ? theme.colors.borderHover : theme.colors.border}`,
            borderRadius: '16px',
            padding: '1.5rem',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            transform: isHovered ? 'translateY(-4px)' : 'translateY(0)',
            boxShadow: isSelected || isHovered 
                ? `0 12px 40px ${theme.colors.accent}20` 
                : theme.colors.cardShadow,
        }),
        optionIcon: (isSelected) => ({
            fontSize: '2.5rem',
            marginBottom: '0.75rem',
            color: isSelected ? theme.colors.accent : theme.colors.mutedText,
            transition: 'color 0.3s ease',
        }),
        optionTitle: {
            fontSize: '1.25rem',
            fontWeight: '600',
            marginBottom: '0.5rem',
            color: theme.colors.primaryText,
        },
        optionDescription: {
            fontSize: '0.9rem',
            color: theme.colors.secondaryText,
            lineHeight: '1.4',
        },
        tokenList: {
            display: 'grid',
            gap: '12px',
            marginBottom: '2rem',
        },
        tokenItem: (isSelected) => ({
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '16px',
            background: isSelected ? theme.colors.accentGradient : theme.colors.cardGradient,
            border: `2px solid ${isSelected ? theme.colors.accent : theme.colors.border}`,
            borderRadius: '12px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
        }),
        tokenLogo: {
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            objectFit: 'cover',
        },
        tokenInfo: {
            flex: 1,
        },
        tokenSymbol: {
            fontSize: '1.1rem',
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
            gap: '16px',
            padding: '16px',
            background: isSelected ? theme.colors.accentGradient : theme.colors.cardGradient,
            border: `2px solid ${isSelected ? theme.colors.accent : theme.colors.border}`,
            borderRadius: '12px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
        }),
        positionLogos: {
            display: 'flex',
            alignItems: 'center',
        },
        positionLogo: (index) => ({
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            objectFit: 'cover',
            marginLeft: index > 0 ? '-10px' : '0',
            border: `2px solid ${theme.colors.primaryBg}`,
        }),
        configCard: {
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
            padding: '2rem',
            marginBottom: '1.5rem',
        },
        inputGroup: {
            marginBottom: '1.5rem',
        },
        label: {
            display: 'block',
            color: theme.colors.primaryText,
            marginBottom: '8px',
            fontWeight: '500',
        },
        inputRow: {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
        },
        input: {
            flex: 1,
            padding: '12px',
            background: theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '8px',
            color: theme.colors.primaryText,
            fontSize: '0.95rem',
        },
        maxButton: {
            background: theme.colors.accent,
            color: theme.colors.primaryBg,
            border: 'none',
            borderRadius: '8px',
            padding: '12px 16px',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '0.85rem',
        },
        buttonRow: {
            display: 'flex',
            gap: '12px',
            marginTop: '2rem',
        },
        backButton: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            flex: 1,
            padding: '14px 24px',
            background: theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '10px',
            color: theme.colors.primaryText,
            fontSize: '1rem',
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
            padding: '14px 24px',
            background: isEnabled 
                ? `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}dd)` 
                : theme.colors.tertiaryBg,
            border: 'none',
            borderRadius: '10px',
            color: isEnabled ? theme.colors.primaryBg : theme.colors.mutedText,
            fontSize: '1rem',
            fontWeight: '600',
            cursor: isEnabled ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s ease',
            boxShadow: isEnabled ? theme.colors.accentShadow : 'none',
        }),
        errorBox: {
            color: theme.colors.error,
            padding: '12px',
            background: `${theme.colors.error}15`,
            border: `1px solid ${theme.colors.error}30`,
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '0.9rem',
        },
        successCard: {
            textAlign: 'center',
            padding: '3rem',
            background: theme.colors.cardGradient,
            border: `2px solid ${theme.colors.success}`,
            borderRadius: '16px',
        },
        successIcon: {
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: `${theme.colors.success}20`,
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
        },
        loginPrompt: {
            textAlign: 'center',
            padding: '3rem',
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
        },
    };

    // Add keyframes for spinner
    const spinnerKeyframes = `
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    `;

    if (!isAuthenticated) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header customLogo="/sneedlock-logo4.png" />
                <main style={styles.container}>
                    <div style={styles.loginPrompt}>
                        <FaLock size={48} style={{ color: theme.colors.mutedText, marginBottom: '1rem' }} />
                        <p style={{ fontSize: '1.2rem', color: theme.colors.secondaryText }}>
                            Please log in to access the Lock Wizard
                        </p>
                    </div>
                </main>
            </div>
        );
    }

    const renderStepProgress = () => (
        <div style={styles.stepProgress}>
            <style>{spinnerKeyframes}</style>
            {[1, 2, 3].map((stepNum, index) => (
                <React.Fragment key={stepNum}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div 
                            style={styles.stepCircle(stepNum, stepNum === currentStep, stepNum < currentStep)}
                            onClick={() => stepNum < currentStep && goToStep(stepNum)}
                        >
                            {stepNum < currentStep ? <FaCheck size={16} /> : stepNum}
                        </div>
                        <div style={styles.stepLabel(stepNum === currentStep)}>
                            {stepNum === 1 ? 'Type' : stepNum === 2 ? 'Select' : 'Configure'}
                        </div>
                    </div>
                    {index < 2 && <div style={styles.stepLine(stepNum < currentStep)} />}
                </React.Fragment>
            ))}
        </div>
    );

    const renderStep1 = () => (
        <>
            <div style={styles.hero}>
                <h1 style={styles.title}>
                    <FaLock style={{ color: theme.colors.accent }} />
                    Lock Wizard
                </h1>
                <p style={styles.subtitle}>
                    What would you like to lock?
                </p>
            </div>

            <div style={styles.optionsGrid}>
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
                <div style={styles.hero}>
                    <h1 style={styles.title}>
                        <FaLock style={{ color: theme.colors.accent }} />
                        Select {lockType === 'token' ? 'Token' : 'Position'}
                    </h1>
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

    const renderStep3 = () => {
        if (lockSuccess) {
            return (
                <div style={styles.successCard}>
                    <div style={styles.successIcon}>
                        <FaCheck size={40} style={{ color: theme.colors.success }} />
                    </div>
                    <h2 style={{ color: theme.colors.primaryText, marginBottom: '1rem', fontSize: '1.8rem' }}>
                        Lock Created Successfully!
                    </h2>
                    <p style={{ color: theme.colors.secondaryText, marginBottom: '2rem', fontSize: '1.1rem' }}>
                        Your {lockType === 'token' ? 'tokens have' : 'liquidity position has'} been locked until {dateToReadable(new Date(lockExpiry))}.
                    </p>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                        <button
                            style={{
                                ...styles.backButton,
                                flex: 'none',
                                padding: '14px 28px',
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
                            Create Another Lock
                        </button>
                        <button
                            style={{
                                ...styles.continueButton(true),
                                flex: 'none',
                                padding: '14px 28px',
                            }}
                            onClick={() => navigate(`/sneedlock_info?owner=${identity.getPrincipal().toString()}`)}
                        >
                            View My Locks
                        </button>
                    </div>
                </div>
            );
        }

        return (
            <>
                <div style={styles.hero}>
                    <h1 style={styles.title}>
                        <FaLock style={{ color: theme.colors.accent }} />
                        Configure Lock
                    </h1>
                    <p style={styles.subtitle}>
                        Set the lock parameters for your {lockType === 'token' ? selectedToken?.symbol : selectedPosition?.symbols}
                    </p>
                </div>

                <div style={styles.configCard}>
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
                        onClick={() => goToStep(2)}
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
            <Header customLogo="/sneedlock-logo4.png" />
            <main style={styles.container}>
                {renderStepProgress()}
                {currentStep === 1 && renderStep1()}
                {currentStep === 2 && renderStep2()}
                {currentStep === 3 && renderStep3()}
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
