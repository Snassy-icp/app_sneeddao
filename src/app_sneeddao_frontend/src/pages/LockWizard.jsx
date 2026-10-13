import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { FaCoins, FaWater, FaArrowRight, FaArrowLeft, FaLock, FaCheck, FaSpinner, FaCrown, FaShieldAlt, FaSync, FaChevronDown, FaChevronUp } from 'react-icons/fa';
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
    
    // Wizard state - 3 steps: Type -> Select -> Configure & Lock (fee shown and paid with the lock)
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
    // The arrival watch: after a transfer on ICPSwap, poll the pool until a new position shows up.
    const [arrival, setArrival] = useState({ status: 'idle', checks: 0, arrived: [] });
    const arrivalRef = useRef({ timer: null, baseline: null, poolId: null });
    const [pickerResetKey, setPickerResetKey] = useState(0);
    const registeredLedgersRef = useRef(new Set());
    const registeredSwapsRef = useRef(new Set());
    const summedLocksRef = useRef({});
    const tokenCheckRequestRef = useRef(0);

    // Arriving from the Token Studio: /lock_wizard?type=token|position&token=<ledger>
    // picks the lock type and, for a token lock, the token, once logged in.
    const location = useLocation();
    const preselectRef = useRef({ typeDone: false, tokenDone: false });
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const type = params.get('type'); const token = params.get('token');
        if (type !== 'token' && type !== 'position') return;
        if (!preselectRef.current.typeDone) { preselectRef.current.typeDone = true; setLockType(type); setCurrentStep(2); }
        if (type === 'token' && token && isAuthenticated && identity && !preselectRef.current.tokenDone) { preselectRef.current.tokenDone = true; handleTokenChosen(token); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.search, isAuthenticated, identity]);
    const poolCheckRequestRef = useRef(0);
    
    // Lock fee state (shown and paid in step 3, together with the lock)
    const [requiredFee, setRequiredFee] = useState(0n);
    const [feeIsPremium, setFeeIsPremium] = useState(false);
    const [paymentBalance, setPaymentBalance] = useState(0n);
    const [paymentSubaccount, setPaymentSubaccount] = useState(null);
    const [loadingPayment, setLoadingPayment] = useState(false);
    const [paymentError, setPaymentError] = useState('');
    const [icpWalletBalance, setIcpWalletBalance] = useState(0n);
    const [icpBackendAvailable, setIcpBackendAvailable] = useState(0n);
    
    // Step 3: Lock configuration state
    const [lockAmount, setLockAmount] = useState('');
    const [lockExpiry, setLockExpiry] = useState('');
    const [isLocking, setIsLocking] = useState(false);
    const [lockProgress, setLockProgress] = useState([]); // [{ label, state: 'done'|'active'|'pending' }]
    const [lockError, setLockError] = useState('');
    const [lockSuccess, setLockSuccess] = useState(false);
    const [createdLockId, setCreatedLockId] = useState(null);
    
    // Confirmation modal
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const [confirmMessage, setConfirmMessage] = useState('');

    // Reset expiry when entering step 3 (Configure & Lock)
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

    // Fetch the lock fee and ICP balances when entering step 3 (Configure & Lock)
    useEffect(() => {
        if (currentStep === 3 && isAuthenticated && identity) {
            fetchPaymentInfo();
        }
    }, [currentStep, isAuthenticated, identity, lockType]);

    const ICP_TX_FEE = 10_000n; // 0.0001 ICP ledger transfer fee

    // Load everything the fee panel needs: the fee for this user and lock type, what is
    // already deposited, and how much ICP the user has in the Sneed wallet and the frontend wallet.
    const fetchPaymentInfo = async () => {
        setLoadingPayment(true);
        setPaymentError('');
        try {
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            const icpLedgerActor = createLedgerActor(ICP_LEDGER_ID, { agentOptions: { identity } });
            const principal = identity.getPrincipal();
            const isPositionLock = lockType === 'position';

            // The canister knows the user's premium status and the fee table; ask it directly.
            let fee;
            let premium = isPremium;
            try {
                const effective = await sneedLockActor.getEffectiveLockFee(principal, isPositionLock);
                fee = BigInt(effective.fee_e8s);
                premium = effective.is_premium;
            } catch (e) {
                console.warn('getEffectiveLockFee failed, falling back to fee table:', e);
                const feeConfig = await sneedLockActor.get_lock_fees_icp();
                fee = BigInt(isPremium
                    ? (isPositionLock ? feeConfig.premium_position_lock_fee_icp_e8s : feeConfig.premium_token_lock_fee_icp_e8s)
                    : (isPositionLock ? feeConfig.position_lock_fee_icp_e8s : feeConfig.token_lock_fee_icp_e8s));
            }
            setRequiredFee(fee);
            setFeeIsPremium(premium);

            const subaccount = await sneedLockActor.getPaymentSubaccount(principal);
            setPaymentSubaccount(subaccount);

            const [payBal, walletBal, backendBal, summedLocksList] = await Promise.all([
                sneedLockActor.getPaymentBalance(principal),
                icpLedgerActor.icrc1_balance_of({ owner: principal, subaccount: [] }),
                icpLedgerActor.icrc1_balance_of({ owner: Principal.fromText(sneedLockCanisterId), subaccount: [principalToSubAccount(principal)] }),
                sneedLockActor.get_summed_locks()
            ]);
            let lockedIcp = 0n;
            for (const lock of summedLocksList) {
                const id = lock[0].toText ? lock[0].toText() : String(lock[0]);
                if (id === ICP_LEDGER_ID) lockedIcp = lock[1];
            }
            setPaymentBalance(BigInt(payBal));
            setIcpWalletBalance(BigInt(walletBal));
            setIcpBackendAvailable(BigInt(backendBal) > lockedIcp ? BigInt(backendBal) - lockedIcp : 0n);
        } catch (error) {
            console.error('Error fetching payment info:', error);
            setPaymentError('Could not load the lock fee information. ' + (error?.message || ''));
        } finally {
            setLoadingPayment(false);
        }
    };

    // Parse the amount typed in step 3 as e8s-style integer (0n when not valid yet)
    const parsedLockAmount = () => {
        if (lockType !== 'token' || !selectedToken) return 0n;
        const amountFloat = parseFloat(lockAmount);
        if (isNaN(amountFloat) || amountFloat <= 0) return 0n;
        return BigInt(Math.floor(amountFloat * (10 ** selectedToken.decimals)));
    };

    // Decide where the ICP for the lock fee comes from. The Sneed wallet's ICP (the user's
    // SneedLock subaccount) is preferred; the frontend wallet covers what is missing. Each
    // transfer costs one ledger fee, paid by the sending account, so a source is only used if
    // it can cover its share plus that fee. When the token being locked is ICP itself, the ICP
    // the lock will consume is reserved first so the fee cannot eat into it.
    const computeFeePlan = () => {
        const fee = BigInt(requiredFee);
        const paid = paymentBalance;
        const need = fee > paid ? fee - paid : 0n;

        let backendAvail = icpBackendAvailable;
        let frontendAvail = icpWalletBalance;
        let backendUsedByLock = 0n;
        if (lockType === 'token' && selectedToken && selectedToken.ledgerId === ICP_LEDGER_ID) {
            const amount = parsedLockAmount();
            backendUsedByLock = amount < selectedToken.available_backend ? amount : selectedToken.available_backend;
            backendAvail = backendAvail > backendUsedByLock ? backendAvail - backendUsedByLock : 0n;
            const toSend = amount - backendUsedByLock;
            if (toSend > 0n) {
                const reserve = toSend + ICP_TX_FEE;
                frontendAvail = frontendAvail > reserve ? frontendAvail - reserve : 0n;
            }
        }

        const plan = { fee, paid, need, fromBackend: 0n, fromFrontend: 0n, txFees: 0n, sufficient: true, shortfall: 0n, backendAvail, frontendAvail };
        if (need === 0n) return plan;

        if (backendAvail >= need + ICP_TX_FEE) {
            plan.fromBackend = need;
            plan.txFees = ICP_TX_FEE;
        } else if (frontendAvail >= need + ICP_TX_FEE) {
            plan.fromFrontend = need;
            plan.txFees = ICP_TX_FEE;
        } else {
            const usableBackend = backendAvail > ICP_TX_FEE ? backendAvail - ICP_TX_FEE : 0n;
            plan.fromBackend = usableBackend < need ? usableBackend : need;
            plan.fromFrontend = need - plan.fromBackend;
            plan.txFees = (plan.fromBackend > 0n ? ICP_TX_FEE : 0n) + (plan.fromFrontend > 0n ? ICP_TX_FEE : 0n);
            const frontendRequired = plan.fromFrontend > 0n ? plan.fromFrontend + ICP_TX_FEE : 0n;
            if (frontendAvail < frontendRequired) {
                plan.sufficient = false;
                plan.shortfall = frontendRequired - frontendAvail;
            }
        }
        return plan;
    };

    // Move the ICP for the fee into the payment subaccount and verify it arrived.
    const payLockFee = async (plan) => {
        if (plan.need === 0n) return;
        if (!plan.sufficient) {
            throw new Error(`Not enough ICP for the lock fee. You need ${formatIcp(plan.shortfall)} more.`);
        }
        const principal = identity.getPrincipal();
        const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
        const paymentAccount = { owner: Principal.fromText(sneedLockCanisterId), subaccount: [paymentSubaccount] };

        if (plan.fromBackend > 0n) {
            const result = await sneedLockActor.transfer_tokens(
                Principal.fromText(sneedLockCanisterId),
                [paymentSubaccount],
                Principal.fromText(ICP_LEDGER_ID),
                plan.fromBackend
            );
            if (result.Err) {
                throw new Error(`Could not move ICP from your Sneed wallet for the fee: ${JSON.stringify(result.Err, (k, v) => typeof v === 'bigint' ? v.toString() : v)}`);
            }
        }
        if (plan.fromFrontend > 0n) {
            const icpLedgerActor = createLedgerActor(ICP_LEDGER_ID, { agentOptions: { identity } });
            const result = await icpLedgerActor.icrc1_transfer({
                to: paymentAccount,
                fee: [],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
                amount: plan.fromFrontend
            });
            if (result.Err) {
                throw new Error(`Could not send ICP from your wallet for the fee: ${JSON.stringify(result.Err, (k, v) => typeof v === 'bigint' ? v.toString() : v)}`);
            }
        }

        const newBalance = BigInt(await sneedLockActor.getPaymentBalance(principal));
        setPaymentBalance(newBalance);
        if (newBalance < plan.fee) {
            throw new Error(`The fee deposit has not fully arrived yet (${formatIcp(newBalance)} of ${formatIcp(plan.fee)}). Nothing is lost: the deposit stays in your payment balance. Please try again in a moment.`);
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

    /// Re-read the user's positions in the selected pool without clearing the selection.
    const refreshPoolPositions = async (poolId, pool) => {
        const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
        const claimedPositions = await sneedLockActor.get_claimed_positions_for_principal(identity.getPrincipal());
        const claimedForSwap = groupClaimedBySwap(claimedPositions)[poolId] || [];
        const positions = await loadPoolPositions(poolId, pool, claimedForSwap);
        setPoolPositions(positions);
        setWalletPairs(prev => {
            const entry = { poolId, pool, positions };
            const idx = prev.findIndex(p => p.poolId === poolId);
            if (idx >= 0) return prev.map((p, i) => i === idx ? entry : p);
            return [...prev, entry];
        });
        return positions;
    };
    const stopArrivalWatch = (status = 'idle') => {
        if (arrivalRef.current.timer) clearInterval(arrivalRef.current.timer);
        arrivalRef.current = { timer: null, baseline: null, poolId: null };
        setArrival(a => ({ ...a, status }));
    };
    const startArrivalWatch = () => {
        if (!selectedPoolId || !selectedPool || !identity) return;
        stopArrivalWatch();
        const baseline = new Set((poolPositions || []).map(p => p.id.toString()));
        const poolId = selectedPoolId; const pool = selectedPool;
        const startedAt = Date.now();
        arrivalRef.current = { timer: null, baseline, poolId };
        setArrival({ status: 'watching', checks: 0, arrived: [] });
        const tick = async () => {
            if (arrivalRef.current.poolId !== poolId) return;
            try {
                const positions = await refreshPoolPositions(poolId, pool);
                if (arrivalRef.current.poolId !== poolId) return;
                const fresh = positions.filter(p => !baseline.has(p.id.toString()));
                if (fresh.length > 0) {
                    if (fresh.length === 1) setSelectedPosition(fresh[0]);
                    clearInterval(arrivalRef.current.timer);
                    arrivalRef.current = { timer: null, baseline: null, poolId: null };
                    setArrival({ status: 'arrived', checks: 0, arrived: fresh.map(p => p.id.toString()) });
                    return;
                }
                setArrival(a => ({ ...a, checks: a.checks + 1 }));
            } catch (e) {
                console.warn('Arrival check failed, trying again', e);
            }
            if (Date.now() - startedAt > 10 * 60 * 1000) stopArrivalWatch('timeout');
        };
        arrivalRef.current.timer = setInterval(tick, 15000);
        tick();
    };
    useEffect(() => () => { if (arrivalRef.current.timer) clearInterval(arrivalRef.current.timer); }, []);

    const clearPoolSelection = () => {
        stopArrivalWatch();
        setSelectedPoolId('');
        setSelectedPool(null);
        setPoolPositions(null);
        setPoolCheckError('');
        setPoolCheckLoading(false);
        setSelectedPosition(null);
    };

    const handlePoolChosen = async (poolId, pool) => {
        stopArrivalWatch();
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

    const describeFeePlan = (plan) => {
        if (plan.fee === 0n) return 'No lock fee applies.';
        if (plan.need === 0n) return `The ${formatIcp(plan.fee)} lock fee is already deposited.`;
        const parts = [];
        if (plan.paid > 0n) parts.push(`${formatIcp(plan.paid)} already deposited`);
        if (plan.fromBackend > 0n) parts.push(`${formatIcp(plan.fromBackend)} from your Sneed wallet ICP`);
        if (plan.fromFrontend > 0n) parts.push(`${formatIcp(plan.fromFrontend)} from your ICP wallet`);
        return `A lock fee of ${formatIcp(plan.fee)} will be paid: ${parts.join(', ')}` +
            (plan.txFees > 0n ? ` (plus ${formatIcp(plan.txFees)} in ledger transfer fees).` : '.');
    };

    const handleLock = async () => {
        if (!validateLock()) return;
        if (loadingPayment) {
            setLockError('Still loading the lock fee information, one moment...');
            return;
        }
        const plan = computeFeePlan();
        if (!plan.sufficient) {
            setLockError(`Not enough ICP for the lock fee. You need ${formatIcp(plan.shortfall)} more ICP in your wallet.`);
            return;
        }
        
        const expiryDate = new Date(lockExpiry);
        const duration = format_duration(expiryDate - new Date());
        
        if (lockType === 'token') {
            setConfirmMessage(
                `You are about to lock ${lockAmount} ${selectedToken.symbol} ` +
                `until ${dateToReadable(expiryDate)} ${get_short_timezone()} ` +
                `(for ${duration}). ` + describeFeePlan(plan)
            );
        } else {
            setConfirmMessage(
                `You are about to lock position #${selectedPosition.id} (${selectedPosition.symbols}) ` +
                `until ${dateToReadable(expiryDate)} ${get_short_timezone()} ` +
                `(for ${duration}). ` + describeFeePlan(plan)
            );
        }
        
        setConfirmAction(() => executeLock);
        setShowConfirmModal(true);
    };

    const executeLock = async () => {
        setIsLocking(true);
        setLockError('');
        
        let feePaid = false;
        const plan = computeFeePlan();
        const phases = [];
        if (plan.need > 0n) phases.push('Paying the lock fee');
        if (lockType === 'token') {
            const amount = parsedLockAmount();
            if (amount > selectedToken.available_backend) phases.push(`Moving ${selectedToken.symbol} to SneedLock`);
            phases.push('Creating the lock');
        } else {
            if (selectedPosition.frontendOwnership) phases.push('Transferring the position to SneedLock');
            phases.push('Creating the lock');
        }
        let phaseIndex = -1;
        const nextPhase = () => {
            phaseIndex += 1;
            setLockProgress(phases.map((label, i) => ({ label, state: i < phaseIndex ? 'done' : i === phaseIndex ? 'active' : 'pending' })));
        };
        nextPhase();
        try {
            // 1. Pay the lock fee (no-op when free or already deposited)
            if (plan.need > 0n) {
                await payLockFee(plan);
                feePaid = true;
                nextPhase();
            }

            // 2. Create the lock. If the fee came out of the Sneed wallet's ICP and we are
            //    locking ICP, that much less of the backend balance is available for the lock.
            if (lockType === 'token') {
                let backendAvailable = selectedToken.available_backend;
                if (selectedToken.ledgerId === ICP_LEDGER_ID && plan.fromBackend > 0n) {
                    const used = plan.fromBackend + ICP_TX_FEE;
                    backendAvailable = backendAvailable > used ? backendAvailable - used : 0n;
                }
                setCreatedLockId(await executeTokenLock(backendAvailable, nextPhase));
            } else {
                setCreatedLockId(await executePositionLock(nextPhase));
            }
            setLockSuccess(true);
        } catch (error) {
            console.error('Lock error:', error);
            let message = error.message || 'An error occurred while creating the lock.';
            if (feePaid) {
                message += ' Your ICP fee deposit is kept in your payment balance and will be used when you try again.';
            }
            setLockError(message);
            // Refresh balances so the fee panel reflects what was deposited
            fetchPaymentInfo();
        } finally {
            setIsLocking(false);
            setLockProgress([]);
        }
    };

    const executeTokenLock = async (backendAvailable, nextPhase) => {
        const ledgerActor = createLedgerActor(selectedToken.ledgerId, { agentOptions: { identity } });
        const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
        
        const amountFloat = parseFloat(lockAmount);
        const scaledAmount = amountFloat * (10 ** selectedToken.decimals);
        const bigIntAmount = BigInt(Math.floor(scaledAmount));
        const amountToSendToBackend = bigIntAmount - backendAvailable;
        
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
            if (nextPhase) nextPhase();
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
        return result.Ok;
    };

    const executePositionLock = async (nextPhase) => {
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
            if (nextPhase) nextPhase();
            
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
            return lockResult.Ok;
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
            return lockResult.Ok;
        }
    };

    const goToStep = (step) => {
        if (step < currentStep) {
            setCurrentStep(step);
            if (step === 1) {
                setSelectedToken(null);
                setSelectedPosition(null);
                setSelectedTokenId('');
                setTokenCheckError('');
                clearPoolSelection();
                setShowTransferHelp(false);
                setPickerResetKey(k => k + 1);
                setLockAmount('');
                setLockSuccess(false);
                setPaymentError('');
            } else if (step === 2) {
                setLockAmount('');
                setLockSuccess(false);
                setPaymentError('');
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

    const stepLabels = ['Type', 'Select', 'Lock'];
    
    const renderStepProgress = () => (
        <div className="lock-fade-in" style={styles.stepProgress}>
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
                            {stepLabels[stepNum - 1]}
                        </div>
                    </div>
                    {index < 2 && <div style={styles.stepLine(stepNum < currentStep)} />}
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
            <PositionTransferGuide token0Symbol={pool.token0.symbol} token1Symbol={pool.token1.symbol} compact={compact} accentColor={lockPrimary} intro=""
                watch={arrival} onWatch={startArrivalWatch} onStopWatch={() => stopArrivalWatch('idle')} />
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
                            <div style={{ marginTop: 6 }}>
                                <Link to={`/position?swap=${selectedPoolId}`} style={{ color: lockPrimary, fontSize: '0.85rem' }}>No position yet? Create one here, in your Sneed wallet, then come back to lock it</Link>
                            </div>
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

    // Fee panel inside the Configure & Lock step: what the lock costs and where the ICP comes from
    const renderFeePanel = () => {
        const plan = computeFeePlan();
        const row = (label, value, valueColor) => (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', fontSize: '0.9rem' }}>
                <span style={{ color: theme.colors.secondaryText }}>{label}</span>
                <span style={{ color: valueColor || theme.colors.primaryText, fontWeight: 500, textAlign: 'right' }}>{value}</span>
            </div>
        );
        return (
            <div style={{
                background: theme.colors.secondaryBg,
                borderRadius: '12px',
                padding: '1rem 1.25rem',
                marginBottom: '1rem',
                display: 'grid',
                gap: '8px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                    <span style={{ color: theme.colors.secondaryText, display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        Lock fee
                        {!loadingPayment && (feeIsPremium ? <PremiumBadge size="small" /> : <span style={{ fontSize: '0.75rem', color: theme.colors.mutedText }}>standard</span>)}
                    </span>
                    {loadingPayment ? (
                        <FaSpinner style={{ ...styles.spinner, color: lockPrimary }} />
                    ) : (
                        <span style={{ color: plan.fee === 0n ? theme.colors.success : theme.colors.primaryText, fontSize: '1.1rem', fontWeight: 700 }}>
                            {plan.fee === 0n ? 'FREE' : formatIcp(plan.fee)}
                        </span>
                    )}
                </div>

                {!loadingPayment && plan.fee > 0n && (
                    <div style={{ borderTop: `1px solid ${theme.colors.border}`, paddingTop: '8px', display: 'grid', gap: '6px' }}>
                        {plan.paid > 0n && row('Already deposited', formatIcp(plan.paid > plan.fee ? plan.fee : plan.paid), theme.colors.success)}
                        {plan.fromBackend > 0n && row('From your Sneed wallet ICP', formatIcp(plan.fromBackend))}
                        {plan.fromFrontend > 0n && row('From your ICP wallet', formatIcp(plan.fromFrontend))}
                        {plan.txFees > 0n && row('Ledger transfer fees', formatIcp(plan.txFees), theme.colors.mutedText)}
                        {plan.need === 0n && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: theme.colors.success, fontSize: '0.85rem' }}>
                                <FaCheck size={12} /> Fee already deposited. Nothing more to pay.
                            </div>
                        )}
                        {plan.need > 0n && plan.sufficient && (
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>
                                Paid automatically when you create the lock. Your Sneed wallet holds {formatIcp(plan.backendAvail)} and your ICP wallet {formatIcp(plan.frontendAvail)} that can be used.
                            </div>
                        )}
                        {!plan.sufficient && (
                            <div style={{
                                marginTop: '4px', padding: '10px 12px', borderRadius: '10px',
                                background: `${theme.colors.error}12`, border: `1px solid ${theme.colors.error}40`,
                                color: theme.colors.primaryText, fontSize: '0.85rem', display: 'grid', gap: '8px'
                            }}>
                                <div>
                                    <strong>Not enough ICP for the fee.</strong> You need {formatIcp(plan.shortfall)} more.
                                    Between your Sneed wallet ({formatIcp(plan.backendAvail)}) and your ICP wallet ({formatIcp(plan.frontendAvail)}) there is not enough to cover the fee and the ledger transfer fees.
                                    Send ICP to your wallet principal and check again:
                                </div>
                                <WalletPrincipalBox compact accentColor={lockPrimary} />
                                <div>
                                    {smallActionButton('Check again', fetchPaymentInfo, <FaSync size={11} />)}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {paymentError && (
                    <div style={{ color: theme.colors.error, fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <span>{paymentError}</span>
                        {smallActionButton('Retry', fetchPaymentInfo, <FaSync size={11} />)}
                    </div>
                )}
            </div>
        );
    };

    // Step 3: Configure & Lock
    const renderStep3 = () => {
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
                                setCreatedLockId(null);
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
                            onClick={() => navigate(createdLockId !== null && createdLockId !== undefined
                                ? `/lock/${createdLockId.toString()}`
                                : `/sneedlock_info?owner=${identity.getPrincipal().toString()}`)}
                        >
                            <FaShieldAlt size={14} /> {createdLockId !== null && createdLockId !== undefined ? `View Lock #${createdLockId.toString()}` : 'View My Locks'}
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
                            Configure & Lock
                        </h1>
                    </div>
                    <p style={styles.subtitle}>
                        Set the lock parameters for your <strong style={{ color: lockPrimary }}>{lockType === 'token' ? selectedToken?.symbol : selectedPosition?.symbols}</strong>
                    </p>
                </div>

                {isLocking ? (
                <div className="lock-fade-in" style={{ ...styles.configCard, textAlign: 'center' }}>
                    <FaSpinner size={32} style={{ ...styles.spinner, color: lockPrimary, marginBottom: '0.75rem' }} />
                    <h2 style={{ color: theme.colors.primaryText, fontSize: '1.2rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>
                        Creating your lock
                    </h2>
                    <p style={{ color: theme.colors.mutedText, fontSize: '0.9rem', margin: '0 0 1.25rem 0' }}>
                        This takes a few seconds per step. Please keep this page open.
                    </p>
                    <div style={{ display: 'inline-grid', gap: '10px', textAlign: 'left' }}>
                        {lockProgress.map((phase, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', color: phase.state === 'pending' ? theme.colors.mutedText : theme.colors.primaryText, fontWeight: phase.state === 'active' ? 600 : 400 }}>
                                {phase.state === 'done' ? (
                                    <FaCheck size={14} style={{ color: theme.colors.success }} />
                                ) : phase.state === 'active' ? (
                                    <FaSpinner size={14} style={{ ...styles.spinner, color: lockPrimary }} />
                                ) : (
                                    <span style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${theme.colors.border}`, display: 'inline-block' }} />
                                )}
                                {phase.label}
                            </div>
                        ))}
                    </div>
                </div>
                ) : (
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

                    {renderFeePanel()}

                    {lockError && (
                        <div style={styles.errorBox}>
                            {lockError}
                        </div>
                    )}
                </div>
                )}

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
                        style={styles.continueButton(!isLocking && !loadingPayment && computeFeePlan().sufficient)}
                        onClick={handleLock}
                        disabled={isLocking || loadingPayment || !computeFeePlan().sufficient}
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
