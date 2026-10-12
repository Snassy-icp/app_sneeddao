import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaCoins, FaWater, FaArrowRight, FaArrowLeft, FaLock, FaCheck, FaSpinner, FaCrown, FaWallet, FaShieldAlt, FaSync, FaChevronDown, FaChevronUp } from 'react-icons/fa';
import { Principal } from '@dfinity/principal';
import { principalToSubAccount } from '@dfinity/utils';
import Header from '../components/Header';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { resolveTokenLogo } from '../utils/TokenUtils';
import TokenSelector from '../components/TokenSelector';
import SwapPoolPicker, { SwapPoolSummary, describeSwapPool } from '../components/SwapPoolPicker';
import PositionTransferGuide, { WalletPrincipalBox } from '../components/PositionTransferGuide';
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
    const [loadingTokens, setLoadingTokens] = useState(false);
    const [loadingPositions, setLoadingPositions] = useState(false);
    const [selectedToken, setSelectedToken] = useState(null);
    const [selectedPosition, setSelectedPosition] = useState(null);
    // Token selection: any known token, or only the ones registered in the wallet
    const [tokenFilter, setTokenFilter] = useState('all'); // 'all' | 'wallet'
    const [selectedTokenId, setSelectedTokenId] = useState('');
    const [tokenCheckLoading, setTokenCheckLoading] = useState(false);
    const [tokenCheckError, setTokenCheckError] = useState('');
    // Pool selection: any ICPSwap pool (via picker), or only pools registered in the wallet
    const [pairFilter, setPairFilter] = useState('all'); // 'all' | 'wallet'
    const [walletPairs, setWalletPairs] = useState([]); // [{ poolId, pool, positions }]
    const [selectedPoolId, setSelectedPoolId] = useState('');
    const [selectedPool, setSelectedPool] = useState(null); // describeSwapPool() result
    const [poolPositions, setPoolPositions] = useState(null); // null until loaded
    const [poolCheckLoading, setPoolCheckLoading] = useState(false);
    const [poolCheckError, setPoolCheckError] = useState('');
    const [showTransferHelp, setShowTransferHelp] = useState(false);
    const [pickerResetKey, setPickerResetKey] = useState(0);
    const registeredLedgersRef = useRef(new Set());
    const registeredSwapsRef = useRef(new Set());
    const summedLocksRef = useRef({});
    const tokenCheckRequestRef = useRef(0);
    const poolCheckRequestRef = useRef(0);
    
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

    // ---- Step 2 helpers: wallet registration, token details, pool positions ----

    const walletPid = identity ? identity.getPrincipal().toText() : '';

    const ensureLedgerRegistered = async (ledgerId) => {
        if (registeredLedgersRef.current.has(ledgerId)) return;
        const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
        await backendActor.register_ledger_canister_id(Principal.fromText(ledgerId));
        registeredLedgersRef.current.add(ledgerId);
    };

    const ensureSwapRegistered = async (swapId) => {
        if (registeredSwapsRef.current.has(swapId)) return;
        const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
        await backendActor.register_swap_canister_id(Principal.fromText(swapId));
        registeredSwapsRef.current.add(swapId);
    };

    const loadSummedLocks = async () => {
        const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
        const summedLocksList = await sneedLockActor.get_summed_locks();
        const summedLocks = {};
        for (const lock of summedLocksList) {
            summedLocks[lock[0].toText ? lock[0].toText() : lock[0]] = lock[1];
        }
        summedLocksRef.current = summedLocks;
        return summedLocks;
    };

    // Balances and metadata for one token, in the shape steps 3 and 4 expect
    const loadTokenDetails = async (ledgerId, summedLocks) => {
        const ledgerActor = createLedgerActor(ledgerId);
        const subaccount = principalToSubAccount(identity.getPrincipal());
        const [metadata, symbol, decimals, fee, balance, balanceBackend] = await Promise.all([
            ledgerActor.icrc1_metadata(),
            ledgerActor.icrc1_symbol(),
            ledgerActor.icrc1_decimals(),
            ledgerActor.icrc1_fee(),
            ledgerActor.icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] }),
            ledgerActor.icrc1_balance_of({ owner: Principal.fromText(sneedLockCanisterId), subaccount: [subaccount] })
        ]);

        const logo = await resolveTokenLogo(ledgerId, metadata, symbol);
        const locked = summedLocks[ledgerId] || 0n;
        const total = balance + balanceBackend;
        const available = total > locked ? total - locked : 0n;

        return {
            ledger_canister_id: Principal.fromText(ledgerId),
            ledgerId,
            symbol,
            decimals: Number(decimals),
            fee,
            logo,
            balance,
            balance_backend: balanceBackend,
            locked,
            available,
            available_backend: balanceBackend > locked ? balanceBackend - locked : 0n
        };
    };

    // Tokens registered in the user's wallet (for the "tokens in my wallet" filter)
    const fetchTokens = async () => {
        setLoadingTokens(true);
        try {
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            const [summedLocks, registeredLedgers] = await Promise.all([
                loadSummedLocks(),
                backendActor.get_ledger_canister_ids()
            ]);
            const ledgerIds = registeredLedgers.map(l => l.toText ? l.toText() : l.toString());
            registeredLedgersRef.current = new Set(ledgerIds);

            const tokenDetails = await Promise.all(ledgerIds.map(async (ledgerId) => {
                try {
                    return await loadTokenDetails(ledgerId, summedLocks);
                } catch (err) {
                    console.error('Error fetching token:', ledgerId, err);
                    return null;
                }
            }));

            setTokens(prev => {
                const loaded = tokenDetails.filter(Boolean);
                // Keep a token the user already picked in this session even if it failed to reload
                for (const t of prev) {
                    if (!loaded.some(l => l.ledgerId === t.ledgerId)) loaded.push(t);
                }
                return loaded;
            });
        } catch (error) {
            console.error('Error fetching tokens:', error);
        } finally {
            setLoadingTokens(false);
        }
    };

    const handleTokenChosen = async (ledgerId) => {
        if (!ledgerId) return;
        const requestId = ++tokenCheckRequestRef.current;
        setSelectedTokenId(ledgerId);
        setSelectedToken(null);
        setTokenCheckError('');
        setTokenCheckLoading(true);
        try {
            await ensureLedgerRegistered(ledgerId);
            const summedLocks = await loadSummedLocks();
            const token = await loadTokenDetails(ledgerId, summedLocks);
            if (tokenCheckRequestRef.current !== requestId) return;
            setSelectedToken(token);
            setTokens(prev => {
                const idx = prev.findIndex(t => t.ledgerId === ledgerId);
                if (idx >= 0) return prev.map((t, i) => i === idx ? token : t);
                return [...prev, token];
            });
        } catch (error) {
            if (tokenCheckRequestRef.current !== requestId) return;
            console.error('Error loading token:', ledgerId, error);
            setTokenCheckError('Could not load this token. Make sure the id is an ICRC-1 ledger canister. ' + (error?.message || ''));
        } finally {
            if (tokenCheckRequestRef.current === requestId) setTokenCheckLoading(false);
        }
    };

    // Unlocked positions in one pool that the user can lock: owned by the user on ICPSwap,
    // or already transferred to SneedLock and claimed by the user but not (or no longer) locked.
    const loadPoolPositions = async (poolId, pool, claimedForSwap) => {
        const swapActor = createIcpSwapActor(poolId, { agentOptions: { identity } });
        const userPositionIds = (await swapActor.getUserPositionIdsByPrincipal(identity.getPrincipal())).ok || [];
        const claimedIds = claimedForSwap.map(p => p.position_id);
        const found = [];

        let offset = 0;
        const limit = 50;
        let hasMore = userPositionIds.length > 0 || claimedIds.length > 0;
        while (hasMore) {
            const posResult = await swapActor.getUserPositionWithTokenAmount(offset, limit);
            const positions = posResult.ok?.content || [];
            for (const pos of positions) {
                const isOwned = userPositionIds.includes(pos.id);
                const isClaimed = claimedIds.includes(pos.id);
                if (!isOwned && !isClaimed) continue;
                const claimInfo = claimedForSwap.find(c => c.position_id === pos.id);
                const lockInfo = claimInfo?.position_lock?.[0];
                const isLocked = lockInfo?.expiry !== undefined && lockInfo.expiry > BigInt(Date.now()) * 1000000n;
                if (isLocked) continue;
                found.push({
                    swapCanisterId: poolId,
                    id: pos.id,
                    token0: Principal.fromText(pool.token0.ledgerId),
                    token1: Principal.fromText(pool.token1.ledgerId),
                    token0Symbol: pool.token0.symbol,
                    token1Symbol: pool.token1.symbol,
                    token0Logo: pool.token0.logo,
                    token1Logo: pool.token1.logo,
                    token0Decimals: pool.token0.decimals,
                    token1Decimals: pool.token1.decimals,
                    token0Amount: pos.token0Amount,
                    token1Amount: pos.token1Amount,
                    symbols: `${pool.token0.symbol}/${pool.token1.symbol}`,
                    frontendOwnership: isOwned
                });
            }
            offset += limit;
            hasMore = positions.length === limit;
        }
        return found;
    };

    const groupClaimedBySwap = (claimedPositions) => {
        const claimedBySwap = {};
        for (const pos of claimedPositions) {
            const swapId = pos.swap_canister_id.toText ? pos.swap_canister_id.toText() : String(pos.swap_canister_id);
            if (!claimedBySwap[swapId]) claimedBySwap[swapId] = [];
            claimedBySwap[swapId].push(pos);
        }
        return claimedBySwap;
    };

    // Pools registered in the user's wallet (for the "pools in my wallet" filter)
    const fetchPositions = async () => {
        setLoadingPositions(true);
        try {
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });

            const [swapCanisters, claimedPositions] = await Promise.all([
                backendActor.get_swap_canister_ids(),
                sneedLockActor.get_claimed_positions_for_principal(identity.getPrincipal())
            ]);
            const swapIds = swapCanisters.map(s => s.toText ? s.toText() : s.toString());
            registeredSwapsRef.current = new Set(swapIds);
            const claimedBySwap = groupClaimedBySwap(claimedPositions);

            const pairs = await Promise.all(swapIds.map(async (poolId) => {
                try {
                    const pool = await describeSwapPool(poolId);
                    const positions = await loadPoolPositions(poolId, pool, claimedBySwap[poolId] || []);
                    return { poolId, pool, positions };
                } catch (err) {
                    console.error('Error fetching positions for swap:', poolId, err);
                    return null;
                }
            }));

            setWalletPairs(pairs.filter(Boolean));
        } catch (error) {
            console.error('Error fetching positions:', error);
        } finally {
            setLoadingPositions(false);
        }
    };

    const clearPoolSelection = () => {
        setSelectedPoolId('');
        setSelectedPool(null);
        setPoolPositions(null);
        setPoolCheckError('');
        setPoolCheckLoading(false);
        setSelectedPosition(null);
    };

    const handlePoolChosen = async (poolId, pool) => {
        const requestId = ++poolCheckRequestRef.current;
        setSelectedPoolId(poolId);
        setSelectedPool(pool);
        setSelectedPosition(null);
        setPoolPositions(null);
        setPoolCheckError('');
        setPoolCheckLoading(true);
        try {
            // Make sure the pool and both of its tokens show up in the user's wallet from now on
            await ensureSwapRegistered(poolId);
            await ensureLedgerRegistered(pool.token0.ledgerId);
            await ensureLedgerRegistered(pool.token1.ledgerId);

            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            const claimedPositions = await sneedLockActor.get_claimed_positions_for_principal(identity.getPrincipal());
            const claimedForSwap = groupClaimedBySwap(claimedPositions)[poolId] || [];
            const positions = await loadPoolPositions(poolId, pool, claimedForSwap);
            if (poolCheckRequestRef.current !== requestId) return;
            setPoolPositions(positions);
            if (positions.length === 1) setSelectedPosition(positions[0]);
            setWalletPairs(prev => {
                const entry = { poolId, pool, positions };
                const idx = prev.findIndex(p => p.poolId === poolId);
                if (idx >= 0) return prev.map((p, i) => i === idx ? entry : p);
                return [...prev, entry];
            });
        } catch (error) {
            if (poolCheckRequestRef.current !== requestId) return;
            console.error('Error loading pool positions:', poolId, error);
            setPoolCheckError('Could not load your positions in this pool. ' + (error?.message || ''));
        } finally {
            if (poolCheckRequestRef.current === requestId) setPoolCheckLoading(false);
        }
    };

    // The pool picker reports every change; act once a pool is verified, clear when it is not
    const handlePickerChange = useCallback((poolId, pool, status) => {
        if (status === 'ready' && pool) {
            handlePoolChosen(poolId, pool);
        } else if (!poolId || status === 'error') {
            clearPoolSelection();
        } else {
            // resolving: show nothing yet
            setSelectedPosition(null);
            setPoolPositions(null);
            setPoolCheckError('');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [identity]);

    // ---- Step 2 rendering ----

    const renderWalletPid = (compact = false) => <WalletPrincipalBox compact={compact} accentColor={lockPrimary} />;

    const renderFilterToggle = (value, onChange, options) => (
        <div style={{
            display: 'flex', gap: '6px', padding: '4px', marginBottom: '1rem',
            background: theme.colors.secondaryBg, borderRadius: '10px',
        }}>
            {options.map(opt => (
                <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange(opt.value)}
                    style={{
                        flex: 1, padding: '8px 12px', border: 'none', borderRadius: '8px', cursor: 'pointer',
                        fontSize: '0.85rem', fontWeight: 500, transition: 'all 0.2s ease',
                        background: value === opt.value ? lockPrimary : 'transparent',
                        color: value === opt.value ? 'white' : theme.colors.mutedText,
                    }}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );

    const infoCard = (children, tone = 'info') => {
        const color = tone === 'warn' ? '#f59e0b' : lockPrimary;
        return (
            <div style={{
                padding: '14px 16px', borderRadius: '12px', marginBottom: '1rem', fontSize: '0.9rem',
                background: `${color}12`, border: `1px solid ${color}40`, color: theme.colors.primaryText, lineHeight: 1.5,
            }}>
                {children}
            </div>
        );
    };

    const renderCheckingRow = (text) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: theme.colors.mutedText, marginBottom: '1rem', fontSize: '0.9rem' }}>
            <FaSpinner style={{ ...styles.spinner, color: lockPrimary }} /> {text}
        </div>
    );

    const smallActionButton = (label, onClick, icon) => (
        <button
            type="button"
            onClick={onClick}
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: 'transparent', color: lockPrimary, border: `1px solid ${lockPrimary}60`,
                borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
            }}
        >
            {icon} {label}
        </button>
    );

    const renderTokenStep = () => {
        const walletSubset = tokens.map(t => ({ ledger_id: t.ledgerId, symbol: t.symbol, name: t.symbol, decimals: t.decimals, fee: t.fee }));
        const hasFunds = !!selectedToken && selectedToken.available > 0n;
        return (
            <>
                {renderFilterToggle(tokenFilter, setTokenFilter, [
                    { value: 'all', label: 'All known tokens' },
                    { value: 'wallet', label: loadingTokens ? 'Tokens in my wallet…' : `Tokens in my wallet (${tokens.length})` },
                ])}

                <div style={{ marginBottom: '1rem' }}>
                    <TokenSelector
                        value={selectedTokenId}
                        onChange={handleTokenChosen}
                        placeholder={tokenFilter === 'wallet' ? 'Select a token from your wallet' : 'Search any token, or add one by ledger id'}
                        allowCustom={true}
                        tokenSubset={tokenFilter === 'wallet' ? walletSubset : undefined}
                    />
                </div>

                {tokenCheckLoading && renderCheckingRow('Checking your balance...')}
                {tokenCheckError && <div style={styles.errorBox}>{tokenCheckError}</div>}

                {selectedToken && !tokenCheckLoading && (
                    <>
                        <div style={{ ...styles.tokenItem(true), cursor: 'default', marginBottom: '1rem' }}>
                            {selectedToken.logo ? (
                                <img src={selectedToken.logo} alt={selectedToken.symbol} style={styles.tokenLogo}
                                    onError={(e) => { e.target.style.visibility = 'hidden'; }} />
                            ) : (
                                <div style={{ ...styles.tokenLogo, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${lockPrimary}30`, color: lockPrimary, fontWeight: 700 }}>
                                    {selectedToken.symbol.charAt(0)}
                                </div>
                            )}
                            <div style={styles.tokenInfo}>
                                <div style={styles.tokenSymbol}>{selectedToken.symbol}</div>
                                <div style={styles.tokenBalance}>
                                    Available to lock: <strong style={{ color: theme.colors.primaryText }}>{formatAmount(selectedToken.available, selectedToken.decimals)} {selectedToken.symbol}</strong>
                                    {selectedToken.locked > 0n && (
                                        <span> · {formatAmount(selectedToken.locked, selectedToken.decimals)} already locked</span>
                                    )}
                                </div>
                            </div>
                            {smallActionButton('Check again', () => handleTokenChosen(selectedToken.ledgerId), <FaSync size={11} />)}
                        </div>

                        {!hasFunds ? infoCard(
                            <>
                                <div style={{ fontWeight: 600, marginBottom: '6px' }}>Your Sneed wallet holds no {selectedToken.symbol} yet</div>
                                <p style={{ margin: '0 0 10px 0' }}>
                                    SneedLock can only lock tokens held by the principal you are logged in with on this site.
                                    Send the {selectedToken.symbol} you want to lock to your Sneed wallet principal:
                                </p>
                                {renderWalletPid()}
                                <p style={{ margin: '10px 0 0 0', color: theme.colors.mutedText, fontSize: '0.85rem' }}>
                                    Any wallet or exchange that supports ICRC-1 transfers can send to this principal. The tokens
                                    arrive within seconds. Then press <strong>Check again</strong> and continue.
                                </p>
                            </>, 'warn'
                        ) : (
                            <div style={{ marginBottom: '1rem', fontSize: '0.85rem', color: theme.colors.mutedText }}>
                                <div style={{ marginBottom: '6px' }}>
                                    Want to lock more than this? Send {selectedToken.symbol} to your Sneed wallet principal and press Check again:
                                </div>
                                {renderWalletPid(true)}
                            </div>
                        )}
                    </>
                )}

                <div style={styles.buttonRow}>
                    <button style={styles.backButton} onClick={() => goToStep(1)}>
                        <FaArrowLeft />
                        Back
                    </button>
                    <button
                        style={styles.continueButton(hasFunds)}
                        onClick={() => hasFunds && setCurrentStep(3)}
                        disabled={!hasFunds}
                    >
                        Continue
                        <FaArrowRight />
                    </button>
                </div>
            </>
        );
    };

    const renderTransferSteps = (pool, compact) => (
        <div style={{ marginTop: compact ? '8px' : '10px' }}>
            <PositionTransferGuide token0Symbol={pool.token0.symbol} token1Symbol={pool.token1.symbol} compact={compact} accentColor={lockPrimary} intro="" />
        </div>
    );

    const renderPositionStep = () => {
        const canContinue = !!selectedPosition;
        const positionsLoaded = Array.isArray(poolPositions);
        return (
            <>
                {renderFilterToggle(pairFilter, (v) => { setPairFilter(v); if (v === 'all') { clearPoolSelection(); setPickerResetKey(k => k + 1); } else { clearPoolSelection(); } }, [
                    { value: 'all', label: 'Any ICPSwap pool' },
                    { value: 'wallet', label: loadingPositions ? 'Pools in my wallet…' : `Pools in my wallet (${walletPairs.length})` },
                ])}

                {pairFilter === 'all' ? (
                    <SwapPoolPicker onPoolChange={handlePickerChange} resetKey={pickerResetKey} accentColor={lockPrimary} />
                ) : (
                    loadingPositions && walletPairs.length === 0 ? (
                        renderCheckingRow('Loading the pools in your wallet...')
                    ) : walletPairs.length === 0 ? (
                        <div style={{ ...styles.emptyState, padding: '2rem', marginBottom: '1rem' }}>
                            <p style={{ margin: 0 }}>No pools in your wallet yet. Switch to <strong>Any ICPSwap pool</strong> to pick one.</p>
                        </div>
                    ) : (
                        <div style={styles.tokenList}>
                            {walletPairs.map(({ poolId, pool, positions }) => (
                                <div
                                    key={poolId}
                                    style={styles.positionItem(selectedPoolId === poolId)}
                                    onClick={() => handlePoolChosen(poolId, pool)}
                                >
                                    <div style={styles.positionLogos}>
                                        {[pool.token0, pool.token1].map((t, i) => t.logo ? (
                                            <img key={i} src={t.logo} alt={t.symbol} style={styles.positionLogo(i)}
                                                onError={(e) => { e.target.style.visibility = 'hidden'; }} />
                                        ) : (
                                            <div key={i} style={{ ...styles.positionLogo(i), display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${lockPrimary}30`, color: lockPrimary, fontWeight: 700 }}>
                                                {t.symbol.charAt(0)}
                                            </div>
                                        ))}
                                    </div>
                                    <div style={styles.tokenInfo}>
                                        <div style={styles.tokenSymbol}>{pool.token0.symbol}/{pool.token1.symbol}</div>
                                        <div style={styles.tokenBalance}>
                                            {positions.length === 0 ? 'No positions to lock' : `${positions.length} position${positions.length === 1 ? '' : 's'} available to lock`}
                                        </div>
                                    </div>
                                    {selectedPoolId === poolId && <FaCheck style={{ color: theme.colors.accent }} />}
                                </div>
                            ))}
                        </div>
                    )
                )}

                {selectedPool && pairFilter === 'wallet' && (
                    <div style={{ marginBottom: '1rem' }}>
                        <SwapPoolSummary pool={selectedPool} accentColor={lockPrimary} compact />
                    </div>
                )}

                {selectedPool && poolCheckLoading && renderCheckingRow(`Looking for your ${selectedPool.token0.symbol}/${selectedPool.token1.symbol} positions...`)}
                {poolCheckError && <div style={styles.errorBox}>{poolCheckError}</div>}

                {selectedPool && positionsLoaded && !poolCheckLoading && poolPositions.length === 0 && infoCard(
                    <>
                        <div style={{ fontWeight: 600, marginBottom: '6px' }}>
                            No {selectedPool.token0.symbol}/{selectedPool.token1.symbol} position in your Sneed wallet yet
                        </div>
                        <p style={{ margin: 0 }}>
                            SneedLock can only lock positions owned by the principal you are logged in with on this site.
                            A position you created on ICPSwap belongs to your ICPSwap login, so move it over first. It takes a minute:
                        </p>
                        {renderTransferSteps(selectedPool, false)}
                        <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>
                                The position stays yours. Once it is in your Sneed wallet you can lock it here and manage it from the Wallet page.
                            </span>
                            {smallActionButton('Check again', () => handlePoolChosen(selectedPoolId, selectedPool), <FaSync size={11} />)}
                        </div>
                    </>, 'warn'
                )}

                {selectedPool && positionsLoaded && !poolCheckLoading && poolPositions.length > 0 && (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                            <div style={{ fontWeight: 600, color: theme.colors.primaryText }}>Choose the position to lock</div>
                            {smallActionButton('Check again', () => handlePoolChosen(selectedPoolId, selectedPool), <FaSync size={11} />)}
                        </div>
                        <div style={styles.tokenList}>
                            {poolPositions.map((pos) => {
                                const isSel = selectedPosition?.id === pos.id && selectedPosition?.swapCanisterId === pos.swapCanisterId;
                                return (
                                    <div
                                        key={`${pos.swapCanisterId}-${pos.id}`}
                                        style={styles.positionItem(isSel)}
                                        onClick={() => setSelectedPosition(pos)}
                                    >
                                        <div style={styles.positionLogos}>
                                            {[pos.token0Logo, pos.token1Logo].map((logo, i) => logo ? (
                                                <img key={i} src={logo} alt="" style={styles.positionLogo(i)}
                                                    onError={(e) => { e.target.style.visibility = 'hidden'; }} />
                                            ) : (
                                                <div key={i} style={{ ...styles.positionLogo(i), display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${lockPrimary}30`, color: lockPrimary, fontWeight: 700 }}>
                                                    {(i === 0 ? pos.token0Symbol : pos.token1Symbol).charAt(0)}
                                                </div>
                                            ))}
                                        </div>
                                        <div style={styles.tokenInfo}>
                                            <div style={styles.tokenSymbol}>
                                                {pos.symbols} #{pos.id.toString()}
                                                {!pos.frontendOwnership && (
                                                    <span style={{ marginLeft: 8, fontSize: '0.75rem', color: theme.colors.mutedText, fontWeight: 400 }}>already in SneedLock</span>
                                                )}
                                            </div>
                                            <div style={styles.tokenBalance}>
                                                {formatAmount(pos.token0Amount, pos.token0Decimals)} {pos.token0Symbol} / {formatAmount(pos.token1Amount, pos.token1Decimals)} {pos.token1Symbol}
                                            </div>
                                        </div>
                                        {isSel && <FaCheck style={{ color: theme.colors.accent }} />}
                                    </div>
                                );
                            })}
                        </div>

                        <div style={{ marginBottom: '1rem', fontSize: '0.85rem', color: theme.colors.mutedText }}>
                            <button
                                type="button"
                                onClick={() => setShowTransferHelp(v => !v)}
                                style={{ background: 'none', border: 'none', color: lockPrimary, cursor: 'pointer', padding: 0, fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                            >
                                {showTransferHelp ? <FaChevronUp size={10} /> : <FaChevronDown size={10} />}
                                Have another {selectedPool.token0.symbol}/{selectedPool.token1.symbol} position on ICPSwap? How to move it here
                            </button>
                            {showTransferHelp && renderTransferSteps(selectedPool, true)}
                        </div>
                    </>
                )}

                <div style={styles.buttonRow}>
                    <button style={styles.backButton} onClick={() => goToStep(1)}>
                        <FaArrowLeft />
                        Back
                    </button>
                    <button
                        style={styles.continueButton(canContinue)}
                        onClick={() => canContinue && setCurrentStep(3)}
                        disabled={!canContinue}
                    >
                        Continue
                        <FaArrowRight />
                    </button>
                </div>
            </>
        );
    };

    const renderStep2 = () => (
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
                    {lockType === 'token'
                        ? 'Pick the token you want to lock. We check that your Sneed wallet holds it.'
                        : 'Pick the pool, then the liquidity position you want to lock.'}
                </p>
            </div>

            {lockType === 'token' ? renderTokenStep() : renderPositionStep()}
        </>
    );

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
                                    type="text"
                                    inputMode="decimal"
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
