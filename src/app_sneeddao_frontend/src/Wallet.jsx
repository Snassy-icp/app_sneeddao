// Wallet.jsx
import { principalToSubAccount } from "@dfinity/utils";
import { Principal } from "@dfinity/principal";
import { HttpAgent } from "@dfinity/agent";
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { app_sneeddao_backend, createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'declarations/rll';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId  } from 'declarations/sneed_lock';
import { createActor as createSgldtActor } from 'external/sgldt';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useTheme } from './contexts/ThemeContext';
import PrincipalBox from './PrincipalBox';
import './Wallet.css';
import SendTokenModal from './SendTokenModal';
import WrapUnwrapModal from './WrapUnwrapModal';
import LockModal from './LockModal';
import LockPositionModal from './LockPositionModal';
import AddSwapCanisterModal from './AddSwapCanisterModal';
import AddLedgerCanisterModal from './AddLedgerCanisterModal';
import SendLiquidityPositionModal from './SendLiquidityPositionModal';
import ConfirmationModal from './ConfirmationModal';
import TransferTokenLockModal from './TransferTokenLockModal';
import WithdrawTokenModal from './WithdrawTokenModal';
import DepositTokenModal from './DepositTokenModal';
import { get_short_timezone, format_duration, bigDateToReadable, dateToReadable } from './utils/DateUtils';
import { formatAmount, toJsonString, formatAmountWithConversion } from './utils/StringUtils';
import TokenCard from './TokenCard';
import TokenCardModal from './components/TokenCardModal';
import DappCardModal from './components/DappCardModal';
import PositionCard from './PositionCard';
import { get_available, get_available_backend, getTokenLogo, get_token_conversion_rate, get_token_icp_rate, getTokenTVL, getTokenMetaForSwap, rewardAmountOrZero, availableOrZero } from './utils/TokenUtils';
import { registerTrackedCanister, unregisterTrackedCanister, getCanisterInfo } from './utils/BackendUtils';
import { getPositionTVL, isLockedPosition } from "./utils/PositionUtils";
import { headerStyles } from './styles/HeaderStyles';
import { usePremiumStatus } from './hooks/usePremiumStatus';
import { createActor as createSnsGovernanceActor, canisterId as snsGovernanceCanisterId } from 'external/sns_governance';
import { fetchAndCacheSnsData, getAllSnses, getSnsById, getSnsByLedgerId } from './utils/SnsUtils';
import { createActor as createForumActor, canisterId as forumCanisterId } from 'declarations/sneed_sns_forum';
import Header from './components/Header';
import PrincipalInput from './components/PrincipalInput';
import TokenIcon from './components/TokenIcon';
import { fetchUserNeurons, fetchUserNeuronsForSns, uint8ArrayToHex } from './utils/NeuronUtils';
import { getTipTokensReceivedByUser } from './utils/BackendUtils';
import { normalizeId } from './hooks/useNeuronsCache';
import { getCachedRewards, setCachedRewards } from './hooks/useRewardsCache';
import { getCachedLocks, setCachedLocks } from './hooks/useLocksCache';
import priceService from './services/PriceService';
import ConsolidateModal from './ConsolidateModal';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneed_icp_neuron_manager_factory';
import { createActor as createManagerActor } from 'declarations/sneed_icp_neuron_manager';
import { createActor as createCmcActor, CMC_CANISTER_ID } from 'external/cmc';
import { useNaming } from './NamingContext';
import { useWallet } from './contexts/WalletContext';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext, computeAccountId } from './utils/PrincipalUtils';
import { getCyclesColor, formatCyclesCompact, formatMemory, getNeuronManagerSettings, getCanisterManagerSettings } from './utils/NeuronManagerSettings';
import { PERM } from './utils/NeuronPermissionUtils.jsx';
import { Actor } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { FaWallet, FaCoins, FaExchangeAlt, FaLock, FaBrain, FaSync, FaChevronDown, FaChevronRight, FaQuestionCircle, FaTint, FaSeedling, FaGift, FaHourglassHalf, FaWater, FaUnlock, FaCheck, FaExclamationTriangle, FaCrown, FaBox, FaDatabase, FaCog, FaExternalLinkAlt, FaTimes, FaLightbulb, FaArrowRight, FaDollarSign, FaChartBar, FaBullseye, FaMoneyBillWave, FaBug, FaCopy, FaExpand } from 'react-icons/fa';

// Custom CSS for Wallet page animations
const walletCustomStyles = `
@keyframes walletFadeInUp {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes walletPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

@keyframes walletSpin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.wallet-section-animate {
    animation: walletFadeInUp 0.5s ease-out forwards;
}

.wallet-card-hover:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(16, 185, 129, 0.15);
}
`;

// Accent colors for wallet page
const walletPrimary = '#10b981'; // Emerald green
const walletSecondary = '#059669'; // Darker green
const walletAccent = '#34d399'; // Light green

const MANAGEMENT_CANISTER_ID = Principal.fromText('aaaaa-aa');
const ICP_LEDGER_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const E8S_ICP = 100_000_000;
const ICP_FEE = 10_000;
// CMC memo for top-up operation: "TPUP" = 0x50555054
const TOP_UP_MEMO = new Uint8Array([0x54, 0x50, 0x55, 0x50, 0x00, 0x00, 0x00, 0x00]);

// Management canister IDL factory for canister_status
const managementCanisterIdlFactory = ({ IDL }) => {
    const definite_canister_settings = IDL.Record({
        'controllers': IDL.Vec(IDL.Principal),
        'freezing_threshold': IDL.Nat,
        'memory_allocation': IDL.Nat,
        'compute_allocation': IDL.Nat,
        'reserved_cycles_limit': IDL.Nat,
        'log_visibility': IDL.Variant({
            'controllers': IDL.Null,
            'public': IDL.Null,
        }),
        'wasm_memory_limit': IDL.Nat,
    });
    const canister_status_result = IDL.Record({
        'status': IDL.Variant({
            'running': IDL.Null,
            'stopping': IDL.Null,
            'stopped': IDL.Null,
        }),
        'settings': definite_canister_settings,
        'module_hash': IDL.Opt(IDL.Vec(IDL.Nat8)),
        'memory_size': IDL.Nat,
        'cycles': IDL.Nat,
        'idle_cycles_burned_per_day': IDL.Nat,
        'query_stats': IDL.Record({
            'num_calls_total': IDL.Nat,
            'num_instructions_total': IDL.Nat,
            'request_payload_bytes_total': IDL.Nat,
            'response_payload_bytes_total': IDL.Nat,
        }),
        'reserved_cycles': IDL.Nat,
    });
    return IDL.Service({
        'canister_status': IDL.Func(
            [IDL.Record({ 'canister_id': IDL.Principal })],
            [canister_status_result],
            []
        ),
    });
};

// Fallback component for missing token logos
const TokenLogoFallback = ({ symbol, size = 36, zIndex = 1, marginRight = 0 }) => (
    <div style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '10px',
        background: 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontSize: `${size * 0.4}px`,
        fontWeight: '700',
        textTransform: 'uppercase',
        boxShadow: '0 2px 8px rgba(107, 114, 128, 0.3)',
        zIndex,
        marginRight: `${marginRight}px`,
        flexShrink: 0
    }}>
        {symbol ? symbol.charAt(0) : '?'}
    </div>
);

// Component for empty position cards (when no positions exist for a swap pair)
const EmptyPositionCard = ({ position, onRemove, handleRefreshPosition, isRefreshing, theme }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [logo0Loaded, setLogo0Loaded] = useState(false);
    const [logo1Loaded, setLogo1Loaded] = useState(false);
    const [logo0Error, setLogo0Error] = useState(false);
    const [logo1Error, setLogo1Error] = useState(false);
    
    // Preload logos
    useEffect(() => {
        setLogo0Error(false);
        setLogo1Error(false);
        setLogo0Loaded(false);
        setLogo1Loaded(false);
        
        if (position.token0Logo && position.token0Logo.trim() !== '') {
            const img = new Image();
            img.onload = () => { setLogo0Loaded(true); setLogo0Error(false); };
            img.onerror = () => { setLogo0Loaded(true); setLogo0Error(true); };
            img.src = position.token0Logo;
        } else {
            setLogo0Loaded(true);
            setLogo0Error(true);
        }
        
        if (position.token1Logo && position.token1Logo.trim() !== '') {
            const img = new Image();
            img.onload = () => { setLogo1Loaded(true); setLogo1Error(false); };
            img.onerror = () => { setLogo1Loaded(true); setLogo1Error(true); };
            img.src = position.token1Logo;
        } else {
            setLogo1Loaded(true);
            setLogo1Error(true);
        }
    }, [position.token0Logo, position.token1Logo]);

    const handleHeaderClick = () => {
        setIsExpanded(!isExpanded);
    };

    return (
        <div className="card">
            <div className="card-header" onClick={handleHeaderClick}>
                <div className="header-logo-column" style={{ minWidth: '64px', minHeight: '36px', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
                    {(!logo0Loaded || !logo1Loaded) ? (
                        <div className="spinner" style={{ width: '24px', height: '24px' }}></div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                            {logo0Error || !position.token0Logo ? (
                                <TokenLogoFallback symbol={position.token0Symbol} size={36} zIndex={2} marginRight={-8} />
                            ) : (
                                <img src={position.token0Logo} alt={position.token0Symbol} className="swap-token-logo1" />
                            )}
                            {logo1Error || !position.token1Logo ? (
                                <TokenLogoFallback symbol={position.token1Symbol} size={36} zIndex={1} />
                            ) : (
                                <img src={position.token1Logo} alt={position.token1Symbol} className="swap-token-logo2" />
                            )}
                        </div>
                    )}
                </div>
                <div className="header-content-column">
                    <div className="header-row-1">
                        <span className="token-name">{position.token0Symbol}/{position.token1Symbol}</span>
                        <span className="token-usd-value"></span>
                    </div>
                    <div className="header-row-2">
                        <div className="amount-symbol">
                            <span className="token-amount">{position.loading ? 'Loading...' : 'No Positions'}</span>
                        </div>
                        {handleRefreshPosition && !position.loading && (
                            <button
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    await handleRefreshPosition(position);
                                }}
                                disabled={isRefreshing}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: isRefreshing ? 'default' : 'pointer',
                                    padding: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    color: theme.colors.mutedText,
                                    fontSize: '1.2rem',
                                    transition: 'color 0.2s ease',
                                    opacity: isRefreshing ? 0.6 : 1
                                }}
                                onMouseEnter={(e) => !isRefreshing && (e.target.style.color = theme.colors.primaryText)}
                                onMouseLeave={(e) => !isRefreshing && (e.target.style.color = theme.colors.mutedText)}
                                title="Refresh position data"
                            >
                                <FaSync size={12} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
            {isExpanded && !position.loading && (
                <>
                    <div className="action-buttons">
                        <button 
                            onClick={onRemove}
                            style={{
                                background: theme.colors.error,
                                color: theme.colors.primaryBg,
                                border: 'none',
                                borderRadius: '6px',
                                padding: '6px 12px',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: '500',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.background = theme.colors.errorHover || `${theme.colors.error}dd`;
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.background = theme.colors.error;
                            }}
                        >
                            <img 
                                src="red-x-black.png" 
                                alt="Remove" 
                                style={{ width: '14px', height: '14px' }}
                            />
                            Remove
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};

// Collapsible section header component
const SectionHeader = ({ title, subtitle, isExpanded, onToggle, onAdd, addButtonText, onRefresh, isRefreshing, theme }) => {
    return (
        <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 0',
            borderBottom: `1px solid ${theme.colors.border}`,
            marginBottom: '20px',
            cursor: 'pointer'
        }} onClick={onToggle}>
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                fontSize: '1.5rem',
                fontWeight: '600',
                color: theme.colors.primaryText
            }}>
                <span style={{
                    fontSize: '1.2rem',
                    color: theme.colors.secondaryText,
                    transition: 'transform 0.2s ease'
                }}>
                    {isExpanded ? '▼' : '▶'}
                </span>
                {title}
                {subtitle && (
                    <span style={{
                        fontSize: '1.2rem',
                        fontWeight: '400',
                        color: theme.colors.secondaryText,
                        marginLeft: '8px'
                    }}>
                        {subtitle}
                    </span>
                )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
                {addButtonText && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onAdd();
                        }}
                        style={{
                            background: theme.colors.accent,
                            color: theme.colors.primaryBg,
                            border: 'none',
                            borderRadius: '8px',
                            padding: '8px 16px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: '600',
                            transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                            e.target.style.background = theme.colors.accentHover;
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.background = theme.colors.accent;
                        }}
                    >
                        {addButtonText}
                    </button>
                )}
                {onRefresh && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onRefresh();
                        }}
                        disabled={isRefreshing}
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: isRefreshing ? 'default' : 'pointer',
                            padding: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            color: theme.colors.mutedText,
                            fontSize: '1.2rem',
                            transition: 'color 0.2s ease',
                            opacity: isRefreshing ? 0.6 : 1
                        }}
                        onMouseEnter={(e) => !isRefreshing && (e.target.style.color = theme.colors.primaryText)}
                        onMouseLeave={(e) => !isRefreshing && (e.target.style.color = theme.colors.mutedText)}
                        title="Refresh section"
                    >
                        <FaSync size={12} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
                    </button>
                )}
            </div>
        </div>
    );
};

// Constants for GLDT and sGLDT canister IDs
const GLDT_CANISTER_ID = '6c7su-kiaaa-aaaar-qaira-cai';
const SGLDT_CANISTER_ID = 'i2s4q-syaaa-aaaan-qz4sq-cai';

console.log('Wallet constants:', { GLDT_CANISTER_ID, SGLDT_CANISTER_ID });

const showDebug = false;
        
const known_icrc1_ledgers = {};
var summed_locks = {};

function Wallet() {
    const { identity, isAuthenticated, logout } = useAuth();
    const { theme } = useTheme();
    const { principalNames, principalNicknames } = useNaming();
    const { isPremium } = usePremiumStatus(identity);
    const { 
        walletTokens, 
        walletLoading, 
        refreshWallet: contextRefreshWallet,
        updateWalletTokens,
        updateTokenRewards, // Sync rewards to context for quick wallet
        setLoading: setWalletLoading, 
        // Positions from context (shared with quick wallet)
        liquidityPositions: contextLiquidityPositions,
        positionsLoading: contextPositionsLoading,
        hasFetchedPositions: contextHasFetchedPositions,
        updateLiquidityPositions,
        refreshPositions: contextRefreshPositions,
        hasFetchedInitial: contextHasFetchedTokens,
        // Neuron managers from context (shared with quick wallet)
        neuronManagers: contextNeuronManagers,
        managerNeurons: contextManagerNeurons,
        managerNeuronsTotal: contextManagerNeuronsTotal,
        neuronManagersLoading: contextNeuronManagersLoading,
        hasFetchedManagers: contextHasFetchedManagers,
        refreshNeuronManagers: contextRefreshNeuronManagers,
        fetchManagerNeuronsData: contextFetchManagerNeuronsData,
        // Tracked canisters from context (shared with quick wallet)
        trackedCanisters: contextTrackedCanisters,
        trackedCanistersLoading: contextTrackedCanistersLoading,
        hasFetchedTrackedCanisters: contextHasFetchedTrackedCanisters,
        refreshTrackedCanisters: contextRefreshTrackedCanisters,
        // Shared ICP price (same as quick wallet)
        icpPrice: contextIcpPrice,
        fetchIcpPrice: contextFetchIcpPrice
    } = useWallet();
    const navigate = useNavigate();
    
    // Compute account ID for the logged-in user
    const userAccountId = useMemo(() => {
        if (!identity) return null;
        return computeAccountId(identity.getPrincipal());
    }, [identity]);
    const location = useLocation();
    // Use WalletContext as the source of truth for tokens
    // Local state is only used for additional Wallet.jsx-specific updates
    const [localTokenOverrides, setLocalTokenOverrides] = useState({});
    
    // Merge context tokens with any local overrides (for immediate UI updates after operations)
    const tokens = useMemo(() => {
        if (!walletTokens || walletTokens.length === 0) return [];
        return walletTokens.map(token => {
            const ledgerId = normalizeId(token.ledger_canister_id) || normalizeId(token.principal);
            if (localTokenOverrides[ledgerId]) {
                return { ...token, ...localTokenOverrides[ledgerId] };
            }
            return token;
        });
    }, [walletTokens, localTokenOverrides]);
    
    // Helper to update a single token (for immediate UI feedback after operations)
    const updateSingleToken = useCallback((ledgerId, updates) => {
        setLocalTokenOverrides(prev => ({
            ...prev,
            [ledgerId]: { ...prev[ledgerId], ...updates }
        }));
    }, []);
    
    // Helper to set tokens (for backwards compatibility with existing code)
    const setTokens = useCallback((newTokensOrUpdater) => {
        if (typeof newTokensOrUpdater === 'function') {
            // For function updates, we can't easily apply to context, so update context directly
            const updated = newTokensOrUpdater(tokens);
            updateWalletTokens(updated);
        } else {
            updateWalletTokens(newTokensOrUpdater);
        }
        // Clear local overrides when setting full token list
        setLocalTokenOverrides({});
    }, [tokens, updateWalletTokens]);
    const [showSendModal, setShowSendModal] = useState(false);
    const [showWrapUnwrapModal, setShowWrapUnwrapModal] = useState(false);
    const [showWithdrawModal, setShowWithdrawModal] = useState(false);
    const [showDepositModal, setShowDepositModal] = useState(false);
    const [selectedToken, setSelectedToken] = useState(null);
    const [showLockModal, setShowLockModal] = useState(false);
    const [showLockPositionModal, setShowLockPositionModal] = useState(false);
    const [showAddSwapModal, setShowAddSwapModal] = useState(false);
    const [showAddLedgerModal, setShowAddLedgerModal] = useState(false);
    const [showSendLiquidityPositionModal, setShowSendLiquidityPositionModal] = useState(false);
    const [selectedLiquidityPosition, setSelectedLiquidityPosition] = useState(null);
    const [showTransferTokenLockModal, setShowTransferTokenLockModal] = useState(false);
    const [selectedTokenLock, setSelectedTokenLock] = useState(null);
    const [locks, setLocks] = useState([]);
    
    // Dapp Card Modal state
    const [showDappDetailModal, setShowDappDetailModal] = useState(false);
    const [detailDapp, setDetailDapp] = useState(null);
    const [isRefreshingDapp, setIsRefreshingDapp] = useState(false);
    
    // Local position overrides for immediate UI updates (merged with context positions)
    const [localPositionOverrides, setLocalPositionOverrides] = useState({});
    
    // Merge context positions with local overrides (same pattern as tokens)
    const liquidityPositions = useMemo(() => {
        if (!contextLiquidityPositions || contextLiquidityPositions.length === 0) return [];
        return contextLiquidityPositions.map(pos => {
            const swapId = normalizeId(pos.swapCanisterId);
            if (localPositionOverrides[swapId]) {
                return { ...pos, ...localPositionOverrides[swapId] };
            }
            return pos;
        });
    }, [contextLiquidityPositions, localPositionOverrides]);
    
    // Helper to update a single position (for immediate UI feedback)
    const updateSinglePosition = useCallback((swapId, updates) => {
        const swapIdStr = normalizeId(swapId);
        setLocalPositionOverrides(prev => ({
            ...prev,
            [swapIdStr]: { ...prev[swapIdStr], ...updates }
        }));
    }, []);
    
    // Helper to set positions (syncs to context)
    const setLiquidityPositions = useCallback((newPositionsOrUpdater) => {
        if (typeof newPositionsOrUpdater === 'function') {
            const updated = newPositionsOrUpdater(liquidityPositions);
            updateLiquidityPositions(updated);
        } else {
            updateLiquidityPositions(newPositionsOrUpdater);
        }
        setLocalPositionOverrides({}); // Clear local overrides after full update
    }, [liquidityPositions, updateLiquidityPositions]);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    // Derive positions spinner from context (positions are now fetched by WalletContext)
    const showPositionsSpinner = contextPositionsLoading || (!contextHasFetchedPositions && contextLiquidityPositions.length === 0);
    // Separate state for manual refresh vs initial loading
    const [isManuallyRefreshingTokens, setIsManuallyRefreshingTokens] = useState(false);
    // Derive tokens spinner from context - instant display when context has data
    // Shows spinner only during manual refresh OR if context hasn't loaded AND we have no tokens
    const showTokensSpinner = isManuallyRefreshingTokens || (!contextHasFetchedTokens && walletTokens.length === 0);
    const [lockDetailsLoading, setLockDetailsLoading] = useState({});
    const [refreshingTokens, setRefreshingTokens] = useState(new Set());
    const [refreshingPositions, setRefreshingPositions] = useState(new Set());
    const [refreshingAllWallet, setRefreshingAllWallet] = useState(false);
    const [refreshingTokensSection, setRefreshingTokensSection] = useState(false);
    const [refreshingPositionsSection, setRefreshingPositionsSection] = useState(false);
    const [tokensExpanded, setTokensExpanded] = useState(true);
    const [positionsExpanded, setPositionsExpanded] = useState(true);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const [confirmMessage, setConfirmMessage] = useState('');
    const [rewardDetailsLoading, setRewardDetailsLoading] = useState({});
    const [totalDollarValue, setTotalDollarValue] = useState(0.0);
    const [snsTokens, setSnsTokens] = useState(new Set()); // Set of ledger canister IDs that are SNS tokens
    const [neuronTotals, setNeuronTotals] = useState({}); // Track additional neuron details (collectableMaturity) by token ledger ID
    const [hideDust, setHideDust] = useState(() => {
        try {
            const saved = localStorage.getItem('hideDust_Wallet');
            return saved !== null ? JSON.parse(saved) : false;
        } catch {
            return false;
        }
    });
    const [totalBreakdown, setTotalBreakdown] = useState({
        liquid: 0.0,
        liquidity: 0.0,
        maturity: 0.0,
        collectableMaturity: 0.0, // Maturity user can actually collect (has DISBURSE_MATURITY permission)
        rewards: 0.0,
        fees: 0.0,
        staked: 0.0,
        locked: 0.0,
        hasAnyFees: false,
        hasAnyRewards: false,
        hasAnyMaturity: false,
        hasAnyCollectableMaturity: false // User can collect some maturity
    });
    const [tokensTotal, setTokensTotal] = useState(0.0);
    const [lpPositionsTotal, setLpPositionsTotal] = useState(0.0);
    // icpPrice now comes from WalletContext (contextIcpPrice) - shared with quick wallet
    const icpPrice = contextIcpPrice;
    const [showTokenDetailModal, setShowTokenDetailModal] = useState(false);
    const [detailToken, setDetailToken] = useState(null);
    const [showConsolidateModal, setShowConsolidateModal] = useState(false);
    const [consolidateType, setConsolidateType] = useState(null); // 'fees', 'rewards', 'maturity', 'all'
    const [consolidateItems, setConsolidateItems] = useState([]);
    const [consolidateError, setConsolidateError] = useState(''); // Error message shown instead of alert
    const [snsNeuronsByToken, setSnsNeuronsByToken] = useState({}); // ledgerId -> neurons array (for collect maturity)
    const [consolidationExpanded, setConsolidationExpanded] = useState(() => {
        try {
            const saved = localStorage.getItem('consolidationExpanded');
            return saved !== null ? JSON.parse(saved) : true;
        } catch (error) {
            console.warn('Could not read consolidation state from localStorage:', error);
            return true; // Default to expanded
        }
    });
    const [collectiblesThreshold, setCollectiblesThreshold] = useState(() => {
        try {
            const saved = localStorage.getItem('collectiblesThreshold');
            return saved !== null ? parseFloat(saved) : 1.0; // Default $1
        } catch (error) {
            return 1.0;
        }
    });
    
    // ICP Neuron Manager state - from context (shared with quick wallet)
    // Use context values with local aliases for compatibility
    const neuronManagers = contextNeuronManagers || [];
    const managerNeurons = contextManagerNeurons || {};
    const managerNeuronsTotal = contextManagerNeuronsTotal || 0;
    const neuronManagersLoading = contextNeuronManagersLoading;
    
    // Local UI state for managers (not shared with context)
    const [neuronManagerCounts, setNeuronManagerCounts] = useState({}); // canisterId -> neuron count
    const [neuronManagerCycles, setNeuronManagerCycles] = useState({}); // canisterId -> cycles
    const [neuronManagerMemory, setNeuronManagerMemory] = useState({}); // canisterId -> memory bytes
    const [neuronManagerIsController, setNeuronManagerIsController] = useState({}); // canisterId -> boolean
    const [neuronManagerModuleHash, setNeuronManagerModuleHash] = useState({}); // canisterId -> moduleHash string
    const [latestOfficialVersion, setLatestOfficialVersion] = useState(null);
    const [neuronManagerCycleSettings] = useState(() => getNeuronManagerSettings());
    const [canisterCycleSettings] = useState(() => getCanisterManagerSettings());
    // Cycles top-up state
    const [topUpManagerId, setTopUpManagerId] = useState(null); // Which manager is showing top-up UI
    const [topUpAmount, setTopUpAmount] = useState('');
    const [toppingUp, setToppingUp] = useState(false);
    const [topUpError, setTopUpError] = useState('');
    const [topUpSuccess, setTopUpSuccess] = useState('');
    const [icpToCyclesRate, setIcpToCyclesRate] = useState(null);
    const [neuronManagersExpanded, setNeuronManagersExpanded] = useState(() => {
        try {
            const saved = localStorage.getItem('neuronManagersExpanded');
            return saved !== null ? JSON.parse(saved) : true;
        } catch (error) {
            return true;
        }
    });
    const [refreshingNeuronManagers, setRefreshingNeuronManagers] = useState(false);
    const [transferModalOpen, setTransferModalOpen] = useState(false);
    const [transferTargetManager, setTransferTargetManager] = useState(null);
    const [transferRecipient, setTransferRecipient] = useState('');
    const [transferring, setTransferring] = useState(false);
    const [transferError, setTransferError] = useState('');
    const [transferSuccess, setTransferSuccess] = useState('');
    const [registerManagerId, setRegisterManagerId] = useState('');
    const [registeringManager, setRegisteringManager] = useState(false);
    const [registerManagerError, setRegisterManagerError] = useState('');
    const [deregisteringManager, setDeregisteringManager] = useState(null);
    const [deregisterManagerError, setDeregisterManagerError] = useState(''); // Error message for remove manager
    const [confirmRemoveManager, setConfirmRemoveManager] = useState(null);
    
    // Tracked canisters from context - local alias and extra state
    const trackedCanisters = contextTrackedCanisters || [];
    const trackedCanistersLoading = contextTrackedCanistersLoading;
    const [refreshingTrackedCanisters, setRefreshingTrackedCanisters] = useState(false);
    const [trackedCanistersExpanded, setTrackedCanistersExpanded] = useState(() => {
        try {
            const saved = localStorage.getItem('trackedCanistersExpanded');
            return saved !== null ? JSON.parse(saved) : true;
        } catch (error) {
            return true;
        }
    });
    
    // Active tab for main wallet sections
    const [activeWalletTab, setActiveWalletTab] = useState(() => {
        try {
            const saved = localStorage.getItem('activeWalletTab');
            return saved || 'tokens';
        } catch (error) {
            return 'tokens';
        }
    });
    const [newTrackedCanisterId, setNewTrackedCanisterId] = useState('');
    const [addingTrackedCanister, setAddingTrackedCanister] = useState(false);
    const [addTrackedCanisterError, setAddTrackedCanisterError] = useState('');
    const [confirmRemoveTrackedCanister, setConfirmRemoveTrackedCanister] = useState(null);
    const [removingTrackedCanister, setRemovingTrackedCanister] = useState(null);
    // Tracked canister status (cycles, memory, isController)
    const [trackedCanisterStatus, setTrackedCanisterStatus] = useState({}); // canisterId -> { cycles, memory, isController, moduleHash }
    const [expandedCanisterCards, setExpandedCanisterCards] = useState({}); // canisterId -> boolean
    
    // Neuron manager detection for tracked canisters
    const [officialVersions, setOfficialVersions] = useState([]); // Known neuron manager WASM hashes
    const [detectedNeuronManagers, setDetectedNeuronManagers] = useState({}); // canisterId -> { version, neuronCount, cycles, memory, isController }
    // Canister top-up and transfer state
    const [topUpCanisterId, setTopUpCanisterId] = useState(null); // Which canister is showing top-up UI
    const [canisterTopUpAmount, setCanisterTopUpAmount] = useState('');
    const [canisterTopUpError, setCanisterTopUpError] = useState('');
    const [canisterTopUpSuccess, setCanisterTopUpSuccess] = useState('');
    const [canisterToppingUp, setCanisterToppingUp] = useState(false);
    
    // Admin debug report state
    const [isAdmin, setIsAdmin] = useState(false);
    const [showDebugReportModal, setShowDebugReportModal] = useState(false);
    const [debugReportCopied, setDebugReportCopied] = useState(false);
    const [transferCanisterModalOpen, setTransferCanisterModalOpen] = useState(false);
    const [transferTargetCanister, setTransferTargetCanister] = useState(null);
    const [transferCanisterRecipient, setTransferCanisterRecipient] = useState('');
    const [transferringCanister, setTransferringCanister] = useState(false);
    const [transferCanisterError, setTransferCanisterError] = useState('');
    const [transferCanisterSuccess, setTransferCanisterSuccess] = useState('');
    // Individual card refresh state
    const [refreshingCanisterCard, setRefreshingCanisterCard] = useState(null); // canisterId being refreshed
    const [refreshingManagerCard, setRefreshingManagerCard] = useState(null); // canisterId being refreshed
    
    // Expanded manager cards and their neurons (UI state only)
    const [expandedManagerCards, setExpandedManagerCards] = useState({}); // canisterId -> boolean
    const [expandedNeuronsInManager, setExpandedNeuronsInManager] = useState({}); // "canisterId:neuronId" -> boolean

    const dex_icpswap = 1;
 
    // Save consolidationExpanded state to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('consolidationExpanded', JSON.stringify(consolidationExpanded));
        } catch (error) {
            console.warn('Could not save consolidation expanded state to localStorage:', error);
        }
    }, [consolidationExpanded]);
    
    // Listen for collectibles threshold changes from settings
    useEffect(() => {
        const handleThresholdChange = (e) => {
            setCollectiblesThreshold(e.detail);
        };
        window.addEventListener('collectiblesThresholdChanged', handleThresholdChange);
        return () => window.removeEventListener('collectiblesThresholdChanged', handleThresholdChange);
    }, []);

    // Save neuronManagersExpanded state to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('neuronManagersExpanded', JSON.stringify(neuronManagersExpanded));
        } catch (error) {
            console.warn('Could not save neuron managers expanded state to localStorage:', error);
        }
    }, [neuronManagersExpanded]);

    // Sync hideDust with localStorage
    useEffect(() => {
        localStorage.setItem('hideDust_Wallet', JSON.stringify(hideDust));
    }, [hideDust]);

    // Listen for hideDust changes from other components (e.g., PrincipalBox quick wallet)
    useEffect(() => {
        const handleStorageChange = (e) => {
            if (e.key === 'hideDust_Wallet') {
                try {
                    setHideDust(JSON.parse(e.newValue));
                } catch {
                    // ignore
                }
            }
        };
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    // Save trackedCanistersExpanded state to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('trackedCanistersExpanded', JSON.stringify(trackedCanistersExpanded));
        } catch (error) {
            console.warn('Could not save tracked canisters expanded state to localStorage:', error);
        }
    }, [trackedCanistersExpanded]);

    // Save activeWalletTab state to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('activeWalletTab', activeWalletTab);
        } catch (error) {
            console.warn('Could not save active wallet tab to localStorage:', error);
        }
    }, [activeWalletTab]);

    // Load SNS data progressively (non-blocking)
    useEffect(() => {
        async function loadSnsData() {
            try {
                console.log('[Wallet] Loading SNS data...');
                
                // First try to get cached data immediately
                const cached = getAllSnses();
                console.log('[Wallet] Cached SNS data:', cached);
                if (cached && cached.length > 0) {
                    const snsLedgers = new Set(
                        cached
                            .map(sns => {
                                console.log('[Wallet] SNS:', sns.name, 'Ledger:', sns.canisters?.ledger);
                                return sns.canisters?.ledger;
                            })
                            .filter(Boolean)
                    );
                    console.log('[Wallet] SNS Ledger IDs from cache:', Array.from(snsLedgers));
                    setSnsTokens(snsLedgers);
                }
                
                // Then fetch fresh data in the background
                const freshData = await fetchAndCacheSnsData(identity);
                console.log('[Wallet] Fresh SNS data:', freshData);
                if (freshData && freshData.length > 0) {
                    const snsLedgers = new Set(
                        freshData
                            .map(sns => {
                                console.log('[Wallet] Fresh SNS:', sns.name, 'Ledger:', sns.canisters?.ledger);
                                return sns.canisters?.ledger;
                            })
                            .filter(Boolean)
                    );
                    console.log('[Wallet] SNS Ledger IDs from fresh data:', Array.from(snsLedgers));
                    setSnsTokens(snsLedgers);
                }
            } catch (error) {
                console.warn('Failed to load SNS data for wallet:', error);
                // Non-critical, continue without SNS badges
            }
        }
        
        loadSnsData();
    }, [identity]);

    // Track if we've already done initial setup to prevent repeated fetches
    const hasInitializedRef = useRef(false);
    
    // Initialize tokens: use context if available, otherwise fetch
    useEffect(() => {
        if (!isAuthenticated) return;
        if (hasInitializedRef.current) return; // Already initialized
        
        // If context already has tokens, use them (instant load)
        // Spinner is now derived from context state, so no need to set it
        if (contextHasFetchedTokens && walletTokens && walletTokens.length > 0) {
            // Populate known_icrc1_ledgers for future incremental updates
            walletTokens.forEach(token => {
                const ledgerId = normalizeId(token.ledger_canister_id) || normalizeId(token.principal);
                if (ledgerId) known_icrc1_ledgers[ledgerId] = true;
            });
            hasInitializedRef.current = true;
        } else if (!contextHasFetchedTokens) {
            // Context hasn't fetched yet - wait for it
            // Don't double-fetch, context will load the data
        }
    }, [isAuthenticated, contextHasFetchedTokens, walletTokens]);
    
    // Fetch rewards when tokens are loaded (either from context or fresh fetch)
    // Instant load from cache, then silent background validation
    const hasInitializedRewardsRef = useRef(false);
    useEffect(() => {
        if (!isAuthenticated || !identity) return;
        if (hasInitializedRewardsRef.current) return;
        if (!tokens || tokens.length === 0) return;
        
        hasInitializedRewardsRef.current = true;
        
        // Load cached rewards and locks instantly, then fetch fresh in background
        const userPrincipal = identity.getPrincipal();
        (async () => {
            // First, load cached rewards for instant display
            const cachedRewards = await getCachedRewards(userPrincipal);
            if (cachedRewards && Object.keys(cachedRewards).length > 0) {
                // Show cached rewards immediately
                setRewardDetailsLoading(cachedRewards);
            }
            
            // Load cached locks for instant display
            const cachedLocksData = await getCachedLocks(userPrincipal);
            if (cachedLocksData && Object.keys(cachedLocksData).length > 0) {
                // Show cached locks immediately
                setLocks(cachedLocksData);
                // Mark all cached locks as "loaded" (not loading)
                const loadedState = {};
                for (const ledgerId of Object.keys(cachedLocksData)) {
                    loadedState[ledgerId] = false;
                }
                setLockDetailsLoading(prev => ({ ...prev, ...loadedState }));
            }
            
            // Then fetch fresh rewards and locks in background (will update cache)
            fetchRewardDetails();
            // Fetch fresh locks (will silently update if cached data exists)
            if (tokens && tokens.length > 0) {
                fetchLockDetails(tokens);
            }
        })();
    }, [isAuthenticated, identity, tokens]);
    
    // Fetch wallet-specific data on mount
    // Positions, neuron managers, and tracked canisters are now fetched by WalletContext
    useEffect(() => {
        if (!isAuthenticated) return;
        
        fetchIcpPrice();
        fetchIcpToCyclesRate();
    }, [isAuthenticated]);
    
    // Handle manual refresh
    useEffect(() => {
        if (refreshTrigger > 0 && isAuthenticated) {
            hasInitializedRef.current = false;
            hasInitializedRewardsRef.current = false; // Reset rewards fetch flag
            setLocalPositionOverrides({}); // Clear local overrides
            // Trigger context refresh which will update our derived tokens and positions
            if (contextRefreshWallet) {
                contextRefreshWallet();
            }
        }
    }, [refreshTrigger, isAuthenticated, contextRefreshWallet]);

    // Note: Tokens and positions are now derived FROM WalletContext (shared with quick wallet)

    // Sync loading state to WalletContext (when Wallet.jsx is actively fetching manually)
    useEffect(() => {
        // Only update context loading if we're doing a manual wallet refresh
        if (isManuallyRefreshingTokens) {
            setWalletLoading(true);
        }
    }, [isManuallyRefreshingTokens, setWalletLoading]);

    // Check admin status for debug features
    useEffect(() => {
        const checkAdmin = async () => {
            if (!identity || !isAuthenticated) {
                setIsAdmin(false);
                return;
            }
            try {
                const backendActor = createBackendActor(backendCanisterId, {
                    agentOptions: { identity }
                });
                const result = await backendActor.caller_is_admin();
                setIsAdmin(result);
            } catch (err) {
                console.warn('Error checking admin status:', err);
                setIsAdmin(false);
            }
        };
        checkAdmin();
    }, [identity, isAuthenticated]);

    // Generate debug report for wallet totals
    const generateDebugReport = () => {
        const timestamp = new Date().toISOString();
        const lines = [];
        
        lines.push('='.repeat(60));
        lines.push('WALLET DEBUG REPORT');
        lines.push(`Generated: ${timestamp}`);
        lines.push('='.repeat(60));
        lines.push('');
        
        // Summary
        lines.push('--- SUMMARY ---');
        lines.push(`Grand Total: $${totalDollarValue}`);
        lines.push(`Tokens Total: $${tokensTotal.toFixed(2)}`);
        lines.push(`LP Positions Total: $${lpPositionsTotal.toFixed(2)}`);
        lines.push('');
        
        // Breakdown
        lines.push('--- BREAKDOWN ---');
        lines.push(`Liquid: $${totalBreakdown.liquid?.toFixed(2) || '0.00'}`);
        lines.push(`Locked (tokens): $${totalBreakdown.locked?.toFixed(2) || '0.00'}`);
        lines.push(`Staked (neurons): $${totalBreakdown.staked?.toFixed(2) || '0.00'}`);
        lines.push(`Maturity: $${totalBreakdown.maturity?.toFixed(2) || '0.00'}`);
        lines.push(`Rewards: $${totalBreakdown.rewards?.toFixed(2) || '0.00'}`);
        lines.push(`LP Liquidity: $${totalBreakdown.liquidity?.toFixed(2) || '0.00'}`);
        lines.push(`LP Fees: $${totalBreakdown.fees?.toFixed(2) || '0.00'}`);
        lines.push('');
        
        // Token details
        lines.push('--- TOKEN DETAILS ---');
        for (const token of tokens) {
            const ledgerId = normalizeId(token.ledger_canister_id);
            const divisor = 10 ** (token.decimals || 8);
            const rate = token.conversion_rate || 0;
            
            const available = Number(token.available || 0n);
            const locked = Number(token.locked || 0n);
            const availableUSD = (available / divisor) * rate;
            const lockedUSD = (locked / divisor) * rate;
            
            // Use token.neuronStake/neuronMaturity directly (like PrincipalBox)
            const neuronStake = Number(token.neuronStake || 0n);
            const neuronMaturity = Number(token.neuronMaturity || 0n);
            const stakedUSD = (neuronStake / divisor) * rate;
            const maturityUSD = (neuronMaturity / divisor) * rate;
            
            const rewardRaw = rewardDetailsLoading?.[ledgerId];
            const rewardUSD = rewardRaw ? (Number(BigInt(rewardRaw)) / divisor) * rate : 0;
            
            const tokenTotal = availableUSD + lockedUSD + stakedUSD + maturityUSD + rewardUSD;
            
            if (tokenTotal > 0.001 || available > 0 || locked > 0) {
                lines.push('');
                lines.push(`${token.symbol} (${ledgerId})`);
                lines.push(`  Decimals: ${token.decimals}, Rate: ${rate}`);
                lines.push(`  Available: ${(available / divisor).toFixed(8)} = $${availableUSD.toFixed(2)}`);
                lines.push(`  Locked: ${(locked / divisor).toFixed(8)} = $${lockedUSD.toFixed(2)}`);
                if (stakedUSD > 0) lines.push(`  Staked (neurons): $${stakedUSD.toFixed(2)}`);
                if (maturityUSD > 0) lines.push(`  Maturity: $${maturityUSD.toFixed(2)}`);
                if (rewardUSD > 0) lines.push(`  Rewards: $${rewardUSD.toFixed(2)}`);
                lines.push(`  Token Total: $${tokenTotal.toFixed(2)}`);
            }
        }
        
        // neuronTotals state
        lines.push('');
        lines.push('--- NEURON TOTALS STATE ---');
        for (const [ledgerId, data] of Object.entries(neuronTotals)) {
            if (typeof data === 'object') {
                lines.push(`${ledgerId}: total=$${data.total?.toFixed(2)}, staked=$${data.staked?.toFixed(2)}, maturity=$${data.maturity?.toFixed(2)}`);
            } else {
                lines.push(`${ledgerId}: ${data}`);
            }
        }
        
        // LP Positions details
        lines.push('');
        lines.push('--- LP POSITION DETAILS ---');
        for (const lp of liquidityPositions) {
            for (const positionDetails of lp.positions) {
                const fees0USD = parseFloat(formatAmountWithConversion(positionDetails.tokensOwed0, lp.token0Decimals, lp.token0_conversion_rate)) || 0;
                const fees1USD = parseFloat(formatAmountWithConversion(positionDetails.tokensOwed1, lp.token1Decimals, lp.token1_conversion_rate)) || 0;
                // Handle both token0Amount/token1Amount and amount0/amount1 naming conventions
                const token0Amt = positionDetails.token0Amount ?? positionDetails.amount0 ?? 0n;
                const token1Amt = positionDetails.token1Amount ?? positionDetails.amount1 ?? 0n;
                const liq0USD = parseFloat(formatAmountWithConversion(token0Amt, lp.token0Decimals, lp.token0_conversion_rate)) || 0;
                const liq1USD = parseFloat(formatAmountWithConversion(token1Amt, lp.token1Decimals, lp.token1_conversion_rate)) || 0;
                
                lines.push('');
                lines.push(`${lp.token0Symbol}/${lp.token1Symbol} #${positionDetails.positionId}`);
                lines.push(`  Swap: ${lp.swapCanisterId}`);
                lines.push(`  Token0 Liquidity: $${liq0USD.toFixed(2)}, Fees: $${fees0USD.toFixed(2)}`);
                lines.push(`  Token1 Liquidity: $${liq1USD.toFixed(2)}, Fees: $${fees1USD.toFixed(2)}`);
                lines.push(`  Position Total: $${(liq0USD + liq1USD + fees0USD + fees1USD).toFixed(2)}`);
            }
        }
        
        // Manager neurons
        if (managerNeuronsTotal > 0 && icpPrice) {
            lines.push('');
            lines.push('--- ICP NEURON MANAGERS ---');
            lines.push(`Total ICP: ${managerNeuronsTotal.toFixed(8)}`);
            lines.push(`ICP Price: $${icpPrice}`);
            lines.push(`USD Value: $${(managerNeuronsTotal * icpPrice).toFixed(2)}`);
        }
        
        lines.push('');
        lines.push('='.repeat(60));
        lines.push('END REPORT');
        lines.push('='.repeat(60));
        
        return lines.join('\n');
    };

    // fetchIcpPrice now comes from WalletContext (contextFetchIcpPrice) - shared with quick wallet
    const fetchIcpPrice = contextFetchIcpPrice;

    async function fetchTokenDetails(icrc1_ledger, summed_locks) {
        try {

            const ledgerActor = createLedgerActor(icrc1_ledger);
            const metadata = await ledgerActor.icrc1_metadata();
            var logo = getTokenLogo(metadata);
            const name = metadata.find(([key]) => key === 'icrc1:name')?.[1]?.Text || null;
            const symbol = await ledgerActor.icrc1_symbol();
            const decimals = await ledgerActor.icrc1_decimals();
            const fee = await ledgerActor.icrc1_fee();
            
            console.log(`=== fetchTokenDetails for ${symbol} ===`);
            console.log('User principal:', identity.getPrincipal().toText());
            console.log('SneedLock canister:', sneedLockCanisterId);
            
            const balance = await ledgerActor.icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] });
            console.log('Frontend balance (raw):', balance.toString());
            
            // ICP does not produce a logo in metadata.
            if (symbol.toLowerCase() == "icp" && logo == "") { logo = "icp_symbol.svg"; }

            const subaccount = principalToSubAccount(identity.getPrincipal()); 
            console.log('Subaccount bytes:', Array.from(subaccount));
            console.log('Subaccount hex:', Array.from(subaccount).map(b => b.toString(16).padStart(2, '0')).join(''));
            
            const balance_backend = await ledgerActor.icrc1_balance_of({ owner: Principal.fromText(sneedLockCanisterId), subaccount: [subaccount] });
            console.log('Backend balance (raw):', balance_backend.toString());

            var locked = BigInt(0);
            if (summed_locks[icrc1_ledger]) {
                locked = summed_locks[icrc1_ledger];
            }
            console.log('Locked amount (raw):', locked.toString());

            // Fetch conversion rates using the new price service
            const conversion_rate = await get_token_conversion_rate(
                icrc1_ledger.toText ? icrc1_ledger.toText() : icrc1_ledger.toString(),
                decimals
            );
            const icp_rate = await get_token_icp_rate(
                icrc1_ledger.toText ? icrc1_ledger.toText() : icrc1_ledger.toString(),
                decimals
            );

            var token = {
                ledger_canister_id: icrc1_ledger,
                name: name,
                symbol: symbol,
                decimals: decimals,
                fee: fee,
                logo: logo,
                balance: balance,
                balance_backend: balance_backend,
                locked: locked,
                conversion_rate,
                icp_rate
            };

            const avail_backend = get_available_backend(token);
            token.available = get_available(token);
            token.available_backend = avail_backend;
            
            console.log('Calculated available backend:', avail_backend.toString());
            console.log('Calculated total available:', token.available.toString());
            console.log('Manual calculation check:', (BigInt(balance) + avail_backend).toString());
            console.log(`=== End fetchTokenDetails for ${symbol} ===`);

            return token;
        } catch (e) {
            var token = {
                ledger_canister_id: icrc1_ledger,
                name: "ERROR",
                symbol: "ERROR",
                decimals: 8,
                fee: 0,
                logo: "",
                balance: BigInt(0),
                balance_backend: BigInt(0),
                locked: BigInt(0),
                claimable_rewards : BigInt(0),
                available: BigInt(0),
                available_backend: BigInt(0),
                conversion_rate: 0
            };

            return token;
        }
    }

    async function fetchRewardDetails(for_ledger_id) {
        const normalizedForLedgerId = for_ledger_id ? normalizeId(for_ledger_id) : null;
        
        // For single token refresh, show loading state
        // For full refresh, don't clear existing rewards (cached data shows instantly)
        if (normalizedForLedgerId) {
            setRewardDetailsLoading(prevState => ({
                ...prevState,
                [normalizedForLedgerId]: BigInt(-1)
            }));
        }
        // Note: For full refresh, we keep existing rewards visible (from cache) while fetching fresh data
        
        try {
            // fetch rewards from RLL canister
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            
            // Get neurons using the common utility function with Sneed governance canister
            const sneedGovernanceCanisterId = 'fi3zi-fyaaa-aaaaq-aachq-cai';
            const neurons = await fetchUserNeuronsForSns(identity, sneedGovernanceCanisterId);
            
            // Then get rewards using the new query method
            const arr_balances = await rllActor.balances_of_hotkey_neurons(neurons);

            var new_reward_balances = {};
            var new_icrc1_ledgers = [];

            for (const balance of arr_balances) {
                const ledger_id = normalizeId(balance[0]);
                new_reward_balances[ledger_id] = BigInt(balance[1]);
                if (!known_icrc1_ledgers[ledger_id]) {
                    known_icrc1_ledgers[ledger_id] = true;
                    new_icrc1_ledgers[new_icrc1_ledgers.length] = balance[0];
                }
            };

            if (normalizedForLedgerId) {
                // Set to 0 if no rewards for this token (clear the loading state)
                const rewardValue = new_reward_balances[normalizedForLedgerId] ?? 0n;
                setRewardDetailsLoading(prevState => {
                    // Merge into existing state and save to cache
                    const updated = { ...prevState, [normalizedForLedgerId]: rewardValue };
                    setCachedRewards(identity.getPrincipal(), updated);
                    return updated;
                });
            } else {
                if (Object.keys(new_reward_balances).length === 0) {
                    setRewardDetailsLoading({ "aaaa-aa" : 0n }); // make non-empty with 0n to indicate loaded
                    setCachedRewards(identity.getPrincipal(), { "aaaa-aa" : 0n });
                } else {
                    setRewardDetailsLoading(new_reward_balances);
                    setCachedRewards(identity.getPrincipal(), new_reward_balances);
                    // Sync rewards to WalletContext for quick wallet
                    updateTokenRewards(new_reward_balances);
                }
            }

            if (new_icrc1_ledgers.length > 0) {
                // Reverse order to match main tokens ordering
                const reversedLedgers = [...new_icrc1_ledgers].reverse();
                
                // Add placeholders at the end to preserve order
                const placeholders = reversedLedgers.map(ledger => ({
                    ledger_canister_id: ledger,
                    symbol: '...',
                    decimals: 8,
                    fee: 0n,
                    logo: '',
                    balance: 0n,
                    balance_backend: 0n,
                    locked: 0n,
                    available: 0n,
                    available_backend: 0n,
                    conversion_rate: 0,
                    loading: true
                }));
                setTokens(prevTokens => [...prevTokens, ...placeholders]);
                
                const allUpdatedTokens = await Promise.all(reversedLedgers.map(async (icrc1_ledger) => {
                    const updatedToken = await fetchTokenDetails(icrc1_ledger, summed_locks);
                    // Update the specific token by matching ledger_canister_id
                    setTokens(prevTokens => prevTokens.map(token => 
                        normalizeId(token.ledger_canister_id) === normalizeId(icrc1_ledger) ? updatedToken : token
                    ));
                    return updatedToken;
                }));

                fetchLockDetails(allUpdatedTokens);
            }
        } catch (error) {
            console.error('Error fetching reward details:', error);
            // Clear loading state on error - keep cached rewards visible if available
            if (normalizedForLedgerId) {
                setRewardDetailsLoading(prevState => ({
                    ...prevState,
                    [normalizedForLedgerId]: prevState[normalizedForLedgerId] >= 0n ? prevState[normalizedForLedgerId] : 0n
                }));
            } else {
                // On full refresh error, keep existing cached rewards if we have them
                setRewardDetailsLoading(prevState => {
                    if (Object.keys(prevState).length > 0 && !prevState["aaaa-aa"]) {
                        return prevState; // Keep cached rewards
                    }
                    return { "aaaa-aa" : 0n }; // make non-empty with 0n to indicate loaded (with error)
                });
            }
        }
    }

    async function fetchTipTokens(for_ledger_id) {
        try {
            // Create forum actor to get tips received by user
            const forumActor = createForumActor(forumCanisterId, {
                agentOptions: {
                    host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943',
                    identity: identity,
                },
            });
            const tipTokenSummaries = await getTipTokensReceivedByUser(forumActor, identity.getPrincipal());
            
            var new_tip_ledgers = [];
            
            // Extract unique token ledger principals from tip summaries
            for (const summary of tipTokenSummaries) {
                const ledger_id = summary.token_ledger_principal.toText();
                if (!known_icrc1_ledgers[ledger_id]) {
                    known_icrc1_ledgers[ledger_id] = true;
                    new_tip_ledgers.push(summary.token_ledger_principal);
                }
            }
            
            if (new_tip_ledgers.length > 0) {
                // Reverse order to match main tokens ordering
                const reversedLedgers = [...new_tip_ledgers].reverse();
                
                // Add placeholders at the end to preserve order
                const placeholders = reversedLedgers.map(ledger => ({
                    ledger_canister_id: ledger,
                    symbol: '...',
                    decimals: 8,
                    fee: 0n,
                    logo: '',
                    balance: 0n,
                    balance_backend: 0n,
                    locked: 0n,
                    available: 0n,
                    available_backend: 0n,
                    conversion_rate: 0,
                    loading: true
                }));
                setTokens(prevTokens => [...prevTokens, ...placeholders]);
                
                const allUpdatedTokens = await Promise.all(reversedLedgers.map(async (icrc1_ledger) => {
                    const updatedToken = await fetchTokenDetails(icrc1_ledger, summed_locks);
                    // Update the specific token by matching ledger_canister_id
                    setTokens(prevTokens => prevTokens.map(token => 
                        normalizeId(token.ledger_canister_id) === normalizeId(icrc1_ledger) ? updatedToken : token
                    ));
                    return updatedToken;
                }));

                fetchLockDetails(allUpdatedTokens);
            }
        } catch (error) {
            console.error('Error fetching tip tokens:', error);
            // Don't throw error - tip tokens are optional, continue with other tokens
        }
    }

    // Fetch the token balances and locks from the backend and update the state
    async function fetchBalancesAndLocks(single_refresh_ledger_canister_id) {
        setIsManuallyRefreshingTokens(true);
        try {
            // retrieve all the summed locks from the backend first.
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            if (await sneedLockActor.has_expired_locks()) {
                await sneedLockActor.clear_expired_locks();
            }    
            const summed_locks_list = await sneedLockActor.get_summed_locks();

            summed_locks = {};
            for (const summed_lock of summed_locks_list) {
                const token = summed_lock[0];
                const amount = summed_lock[1];
                summed_locks[token] = amount;
            }

            const registered_icrc1_ledgers = await backendActor.get_ledger_canister_ids();
            var icrc1_ledgers = [];
            
            // If single refresh, only add new ledgers. If full refresh, add all ledgers.
            if (single_refresh_ledger_canister_id) {
            for (const ledger of registered_icrc1_ledgers) {
                const ledger_id = ledger.toText();
                if (!known_icrc1_ledgers[ledger_id]) {
                        known_icrc1_ledgers[ledger_id] = true;
                        icrc1_ledgers.push(ledger);
                    }
                }
            } else {
                // Full refresh - fetch all ledgers
                for (const ledger of registered_icrc1_ledgers) {
                    const ledger_id = ledger.toText();
                    known_icrc1_ledgers[ledger_id] = true;
                    icrc1_ledgers.push(ledger);
                }
            }
            
            var singleUpdatedToken = [];
            var allUpdatedTokens = [];
            if (single_refresh_ledger_canister_id) {
                // Mark this ledger as known
                const ledger_id = single_refresh_ledger_canister_id.toText();
                if (!known_icrc1_ledgers[ledger_id]) {
                    known_icrc1_ledgers[ledger_id] = true;
                }
                
                const updatedToken = await fetchTokenDetails(single_refresh_ledger_canister_id, summed_locks);
                setTokens(prevTokens => {
                    // Check if token already exists
                    const normalizedSingleRefreshId = normalizeId(single_refresh_ledger_canister_id);
                    const existingIndex = prevTokens.findIndex(token => 
                        normalizeId(token.ledger_canister_id) === normalizedSingleRefreshId
                    );
                    
                    if (existingIndex >= 0) {
                        // Update existing token
                        return prevTokens.map(token => 
                            normalizeId(token.ledger_canister_id) === normalizedSingleRefreshId ? updatedToken : token
                        );
                    } else {
                        // Add new token to the end
                        return [...prevTokens, updatedToken];
                    }
                });
                singleUpdatedToken = [updatedToken];
            } else {
                // Reverse order so most recently added tokens appear last
                const reversedLedgers = [...icrc1_ledgers].reverse();
                
                // Create placeholders immediately to preserve order
                const placeholders = reversedLedgers.map(ledger => ({
                    ledger_canister_id: ledger,
                    symbol: '...',
                    decimals: 8,
                    fee: 0n,
                    logo: '',
                    balance: 0n,
                    balance_backend: 0n,
                    locked: 0n,
                    available: 0n,
                    available_backend: 0n,
                    conversion_rate: 0,
                    loading: true
                }));
                setTokens(placeholders);
                
                // Fetch details and update each token as data arrives
                allUpdatedTokens = await Promise.all(reversedLedgers.map(async (icrc1_ledger, index) => {
                    const updatedToken = await fetchTokenDetails(icrc1_ledger, summed_locks);
                    // Update the specific token by index to preserve order
                    setTokens(prevTokens => prevTokens.map((token, i) => 
                        i === index ? updatedToken : token
                    ));
                    return updatedToken;
                }));
            }

            fetchLockDetails(single_refresh_ledger_canister_id ? singleUpdatedToken : allUpdatedTokens);
            fetchRewardDetails(single_refresh_ledger_canister_id);
            
            // Only fetch tip tokens on full refresh (not single token refresh)
            if (!single_refresh_ledger_canister_id) {
                fetchTipTokens();
            }

        } catch (error) {
            console.error('Error fetching balances:', error);
        } finally {
            setIsManuallyRefreshingTokens(false);
        }
    }

    // Fetch detailed liquidity positions (includes lock info, etc.)
    // This updates the shared context cache
    async function fetchDetailedPositions() {
        try {
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            const swap_canisters = await backendActor.get_swap_canister_ids();

            if (await sneedLockActor.has_expired_position_locks()) {
                await sneedLockActor.clear_expired_position_locks();
            }
            const claimed_positions = await sneedLockActor.get_claimed_positions_for_principal(identity.getPrincipal());
            const claimed_positions_by_swap = {};
            for (const claimed_position of claimed_positions) {
                if (!claimed_positions_by_swap[claimed_position.swap_canister_id]) {
                    claimed_positions_by_swap[claimed_position.swap_canister_id] = [];
                }
                claimed_positions_by_swap[claimed_position.swap_canister_id].push(claimed_position);
            }

            // Create placeholders immediately to preserve order
            const placeholders = swap_canisters.map(swap_canister => ({
                swapCanisterId: swap_canister,
                token0: null,
                token1: null,
                token0Symbol: '...',
                token1Symbol: '...',
                token0Logo: '',
                token1Logo: '',
                token0Decimals: 0,
                token1Decimals: 0,
                token0Fee: 0n,
                token1Fee: 0n,
                token0_conversion_rate: 0,
                token1_conversion_rate: 0,
                swapCanisterBalance0: 0n,
                swapCanisterBalance1: 0n,
                positions: [],
                loading: true
            }));
            setLiquidityPositions(placeholders);

            await Promise.all(swap_canisters.map(async (swap_canister, index) => {
                    
                try {

                    const claimed_positions_for_swap = claimed_positions_by_swap[swap_canister] || [];
                    const claimed_position_ids_for_swap = claimed_positions_for_swap.map(claimed_position => claimed_position.position_id);
                    const claimed_positions_for_swap_by_id = {};
                    for (const claimed_position of claimed_positions_for_swap) {
                        claimed_positions_for_swap_by_id[claimed_position.position_id] = claimed_position;
                    }

                    // Cache meta
                    const swapActor = createIcpSwapActor(swap_canister);
                    const token_meta = await getTokenMetaForSwap(swapActor, backendActor, swap_canister);

                    var swap_meta = await swapActor.metadata();;

                    const icrc1_ledger0 = swap_meta.ok.token0.address;
                    const ledgerActor0 = createLedgerActor(icrc1_ledger0);
                    const metadata0 = await ledgerActor0.icrc1_metadata();
                    var token0Logo = getTokenLogo(metadata0);

                    const icrc1_ledger1 = swap_meta.ok.token1.address;
                    const ledgerActor1 = createLedgerActor(icrc1_ledger1);
                    const metadata1 = await ledgerActor1.icrc1_metadata();
                    var token1Logo = getTokenLogo(metadata1);

                    const token0Decimals = token_meta?.token0?.find(([key]) => key === "decimals")?.[1]?.Nat ?? 0;
                    const token0Symbol = token_meta?.token0?.find(([key]) => key === "symbol")?.[1]?.Text ?? "Unknown";
                    const token1Decimals = token_meta?.token1?.find(([key]) => key === "decimals")?.[1]?.Nat ?? 0;
                    const token1Symbol = token_meta?.token1?.find(([key]) => key === "symbol")?.[1]?.Text ?? "Unknown";

                    // Get token fees
                    const token0Fee = await ledgerActor0.icrc1_fee();
                    const token1Fee = await ledgerActor1.icrc1_fee();

                    // ICP does not produce a logo in metadata.
                    if (token0Symbol?.toLowerCase() === "icp" && token0Logo === "") { token0Logo = "icp_symbol.svg"; }
                    if (token1Symbol?.toLowerCase() === "icp" && token1Logo === "") { token1Logo = "icp_symbol.svg"; }

                    // Fetch conversion rates for both tokens
                    const token0_conversion_rate = await get_token_conversion_rate(
                        icrc1_ledger0,
                        token0Decimals
                    );
                    const token1_conversion_rate = await get_token_conversion_rate(
                        icrc1_ledger1,
                        token1Decimals
                    );

                    const userPositionIds = (await swapActor.getUserPositionIdsByPrincipal(identity.getPrincipal())).ok;

                    let offset = 0;
                    const limit = 10;
                    let userPositions = [];
                    let hasMorePositions = true;
                    while (hasMorePositions) {
                        const allPositions = (await swapActor.getUserPositionWithTokenAmount(offset, limit)).ok.content;

                        for (const position of allPositions) {
                            if (userPositionIds.includes(position.id) || claimed_position_ids_for_swap.includes(position.id)) {
                                userPositions.push({
                                    position: position,
                                    claimInfo: claimed_positions_for_swap_by_id[position.id],
                                    frontendOwnership: userPositionIds.includes(position.id)
                                });
                            }
                        }

                        offset += limit;
                        hasMorePositions = allPositions.length === limit;
                    }

                    // Get the swap canister balance once (shared across all positions)
                    var swapCanisterBalance0 = 0n;
                    var swapCanisterBalance1 = 0n;
                    const unused = await swapActor.getUserUnusedBalance(identity.getPrincipal());
                    if (unused.ok) {
                        swapCanisterBalance0 = unused.ok.balance0;
                        swapCanisterBalance1 = unused.ok.balance1;
                    }

                    const positionDetails = await Promise.all(userPositions.map(async (compoundPosition) => {

                        const position = compoundPosition.position;

                        const tokensOwed0 = position.tokensOwed0;
                        const tokensOwed1 = position.tokensOwed1;
                        const token0Amount = position.token0Amount;
                        const token1Amount = position.token1Amount;

                        return {
                            positionId: position.id,
                            tokensOwed0: tokensOwed0,
                            tokensOwed1: tokensOwed1,
                            token0Amount: token0Amount,
                            token1Amount: token1Amount,
                            frontendOwnership: compoundPosition.frontendOwnership,
                            lockInfo:
                                (!compoundPosition.frontendOwnership && compoundPosition.claimInfo.position_lock && toJsonString(compoundPosition.claimInfo.position_lock) !== '[]')
                                    ? compoundPosition.claimInfo.position_lock[0]
                                    : null
                        };
                    }));

                    const liquidityPosition = {
                        swapCanisterId: swap_canister,
                        token0: Principal.fromText(icrc1_ledger0),
                        token1: Principal.fromText(icrc1_ledger1),
                        token0Symbol: token0Symbol,
                        token1Symbol: token1Symbol,
                        token0Logo: token0Logo,
                        token1Logo: token1Logo,
                        token0Decimals : token0Decimals,
                        token1Decimals : token1Decimals,
                        token0Fee: token0Fee,
                        token1Fee: token1Fee,
                        token0_conversion_rate: token0_conversion_rate,
                        token1_conversion_rate: token1_conversion_rate,
                        swapCanisterBalance0: swapCanisterBalance0,
                        swapCanisterBalance1: swapCanisterBalance1,
                        positions: positionDetails,
                        loading: false
                    };

                    // Update the specific LP by index to preserve order
                    setLiquidityPositions(prevPositions => prevPositions.map((pos, i) => 
                        i === index ? liquidityPosition : pos
                    ));

                } catch (err) {
                    const liquidityPosition = {
                        swapCanisterId: swap_canister,
                        token0: null,
                        token1: null,
                        token0Symbol: "ERROR",
                        token1Symbol: "ERROR",
                        token0Logo: "",
                        token1Logo: "",
                        token0Decimals : 0,
                        token1Decimals : 0,
                        token0Fee: 0n,
                        token1Fee: 0n,
                        token0_conversion_rate: 0,
                        token1_conversion_rate: 0,
                        swapCanisterBalance0: 0n,
                        swapCanisterBalance1: 0n,
                        positions: [],
                        loading: false
                    };

                    console.error('Error fetching liquidity position: ', err);
                    // Update the specific LP by index to preserve order
                    setLiquidityPositions(prevPositions => prevPositions.map((pos, i) => 
                        i === index ? liquidityPosition : pos
                    ));
                }
            }));
        } catch (error) {
            console.error('Error fetching liquidity positions: ', error);
        }
    }

    // Helper to compare versions
    const compareVersions = (a, b) => {
        const aMajor = Number(a.major), aMinor = Number(a.minor), aPatch = Number(a.patch);
        const bMajor = Number(b.major), bMinor = Number(b.minor), bPatch = Number(b.patch);
        if (aMajor !== bMajor) return aMajor - bMajor;
        if (aMinor !== bMinor) return aMinor - bMinor;
        return aPatch - bPatch;
    };

    // Check if a version is outdated compared to latest
    const isVersionOutdated = (version) => {
        if (!latestOfficialVersion || !version) return false;
        return compareVersions(version, latestOfficialVersion) < 0;
    };

    // Fetch official versions for neuron manager detection
    async function fetchOfficialVersions() {
        if (!identity) return;
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const factory = createFactoryActor(factoryCanisterId, { agent });
            const fetchedOfficialVersions = await factory.getOfficialVersions();
            console.log(`[NM Detection] Loaded ${fetchedOfficialVersions?.length || 0} official versions`);
            setOfficialVersions(fetchedOfficialVersions || []);
            if (fetchedOfficialVersions && fetchedOfficialVersions.length > 0) {
                const sorted = [...fetchedOfficialVersions].sort((a, b) => compareVersions(b, a));
                setLatestOfficialVersion(sorted[0]);
            }
        } catch (err) {
            console.error('Error fetching official versions:', err);
        }
    }
    
    // Fetch official versions on auth
    useEffect(() => {
        if (isAuthenticated) {
            fetchOfficialVersions();
        }
    }, [isAuthenticated]);
    
    // Fetch additional manager data (cycles, controller status) - supplements context data
    // Main manager fetching is done by WalletContext
    async function fetchManagerSupplementalData() {
        if (!identity || neuronManagers.length === 0) return;
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            // Fetch cycles, memory, controller status, and module hash for all managers
            const counts = {};
            const cycles = {};
            const memory = {};
            const controllerStatus = {};
            const moduleHashes = {};
            
            await Promise.all(neuronManagers.map(async (manager) => {
                const canisterIdPrincipal = manager.canisterId;
                const canisterId = normalizeId(canisterIdPrincipal);
                
                counts[canisterId] = manager.neuronCount || 0;
                
                // Try to fetch cycles and module hash (may fail if not controller)
                let isController = false;
                let moduleHash = null;
                try {
                    const mgmtActor = Actor.createActor(managementCanisterIdlFactory, {
                        agent,
                        canisterId: MANAGEMENT_CANISTER_ID,
                        callTransform: (methodName, args, callConfig) => ({
                            ...callConfig,
                            effectiveCanisterId: typeof canisterIdPrincipal === 'string' 
                                ? Principal.fromText(canisterIdPrincipal) 
                                : canisterIdPrincipal,
                        }),
                    });
                    const principalObj = typeof canisterIdPrincipal === 'string' 
                        ? Principal.fromText(canisterIdPrincipal) 
                        : canisterIdPrincipal;
                    const status = await mgmtActor.canister_status({ canister_id: principalObj });
                    cycles[canisterId] = Number(status.cycles);
                    memory[canisterId] = Number(status.memory_size);
                    moduleHash = status.module_hash[0] ? uint8ArrayToHex(status.module_hash[0]) : null;
                    isController = true;
                } catch (cyclesErr) {
                    // Not a controller - try backend fallback for module_hash
                    cycles[canisterId] = null;
                    memory[canisterId] = null;
                    try {
                        const result = await getCanisterInfo(identity, canisterId);
                        if (result && 'ok' in result) {
                            moduleHash = result.ok.module_hash[0] ? uint8ArrayToHex(result.ok.module_hash[0]) : null;
                        }
                    } catch (fallbackErr) {
                        console.log(`Backend fallback error for manager ${canisterId}:`, fallbackErr.message || fallbackErr);
                    }
                }
                
                controllerStatus[canisterId] = isController;
                moduleHashes[canisterId] = moduleHash;
            }));
            
            setNeuronManagerCounts(counts);
            setNeuronManagerCycles(cycles);
            setNeuronManagerMemory(memory);
            setNeuronManagerIsController(controllerStatus);
            setNeuronManagerModuleHash(moduleHashes);
        } catch (err) {
            console.error('Error fetching manager supplemental data:', err);
        }
    }
    
    // Fetch supplemental data when managers are loaded from context
    useEffect(() => {
        if (neuronManagers.length > 0 && isAuthenticated) {
            fetchManagerSupplementalData();
        }
    }, [neuronManagers, isAuthenticated]);

    // Fetch status for tracked canisters (cycles, memory, module hash)
    // The canister list comes from WalletContext, this just fetches detailed status
    const fetchTrackedCanistersStatus = useCallback(async (canisterIds) => {
        if (!identity || !canisterIds || canisterIds.length === 0) {
            return;
        }
        
        try {
            // Fetch status for each canister in parallel
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const statusMap = {};
            await Promise.all(canisterIds.map(async (canisterId) => {
                let cycles = null;
                let memory = null;
                let isController = false;
                let moduleHash = null;
                
                try {
                    const canisterIdPrincipal = Principal.fromText(canisterId);
                    const mgmtActor = Actor.createActor(managementCanisterIdlFactory, {
                        agent,
                        canisterId: MANAGEMENT_CANISTER_ID,
                        callTransform: (methodName, args, callConfig) => ({
                            ...callConfig,
                            effectiveCanisterId: canisterIdPrincipal,
                        }),
                    });
                    const status = await mgmtActor.canister_status({ canister_id: canisterIdPrincipal });
                    cycles = Number(status.cycles);
                    memory = Number(status.memory_size);
                    moduleHash = status.module_hash[0] ? uint8ArrayToHex(status.module_hash[0]) : null;
                    isController = true;
                } catch (err) {
                    // Not a controller - try backend fallback to get module_hash
                    try {
                        const result = await getCanisterInfo(identity, canisterId);
                        if (result && 'ok' in result) {
                            moduleHash = result.ok.module_hash[0] ? uint8ArrayToHex(result.ok.module_hash[0]) : null;
                        }
                    } catch (fallbackErr) {
                        console.log(`Backend fallback error for ${canisterId}:`, fallbackErr.message || fallbackErr);
                    }
                }
                
                statusMap[canisterId] = { cycles, memory, isController, moduleHash };
            }));
            setTrackedCanisterStatus(prev => ({ ...prev, ...statusMap }));
        } catch (err) {
            console.error('Error fetching tracked canister status:', err);
        }
    }, [identity]);
    
    // Fetch status for tracked canisters when the list changes
    useEffect(() => {
        if (trackedCanisters.length > 0 && identity) {
            fetchTrackedCanistersStatus(trackedCanisters);
        }
    }, [trackedCanisters, identity, fetchTrackedCanistersStatus]);
    
    // Check if a module hash matches any known neuron manager version
    const isKnownNeuronManagerHash = useCallback((moduleHash) => {
        if (!moduleHash || officialVersions.length === 0) return null;
        const hashLower = moduleHash.toLowerCase();
        return officialVersions.find(v => v.wasmHash.toLowerCase() === hashLower) || null;
    }, [officialVersions]);
    
    // Fetch neuron manager info for a detected canister
    const fetchDetectedManagerInfo = useCallback(async (canisterId, existingStatus) => {
        if (!identity) return;
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const managerActor = createManagerActor(canisterId, { agent });
            const [version, neuronIds] = await Promise.all([
                managerActor.getVersion(),
                managerActor.getNeuronIds(),
            ]);
            
            console.log(`[NM Detection] Fetched manager info for ${canisterId}: v${version.major}.${version.minor}.${version.patch}, ${neuronIds?.length || 0} neurons`);
            
            setDetectedNeuronManagers(prev => ({
                ...prev,
                [canisterId]: {
                    version,
                    neuronCount: neuronIds?.length || 0,
                    cycles: existingStatus?.cycles,
                    memory: existingStatus?.memory,
                    isController: existingStatus?.isController,
                    isValid: true,
                }
            }));
        } catch (err) {
            console.warn(`[NM Detection] Failed to fetch manager info for ${canisterId}:`, err.message || err);
            // Mark as detected but invalid - WASM matches but interface doesn't work
            setDetectedNeuronManagers(prev => ({
                ...prev,
                [canisterId]: {
                    version: null,
                    neuronCount: 0,
                    cycles: existingStatus?.cycles,
                    memory: existingStatus?.memory,
                    isController: existingStatus?.isController,
                    isValid: false,
                }
            }));
        }
    }, [identity]);
    
    // Detect neuron managers from tracked canisters based on module hash
    useEffect(() => {
        if (officialVersions.length === 0) return;
        
        for (const [canisterId, status] of Object.entries(trackedCanisterStatus)) {
            if (!status?.moduleHash) continue;
            if (detectedNeuronManagers[canisterId]) continue; // Already detected
            
            const matchedVersion = isKnownNeuronManagerHash(status.moduleHash);
            if (matchedVersion) {
                console.log(`[NM Detection] Detected neuron manager ${canisterId} (v${matchedVersion.major}.${matchedVersion.minor}.${matchedVersion.patch})`);
                fetchDetectedManagerInfo(canisterId, status);
            }
        }
    }, [officialVersions, trackedCanisterStatus, detectedNeuronManagers, isKnownNeuronManagerHash, fetchDetectedManagerInfo]);

    // Refresh a single tracked canister's status
    async function handleRefreshCanisterCard(canisterId) {
        if (!identity || !canisterId) return;
        
        setRefreshingCanisterCard(canisterId);
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            let cycles = null;
            let memory = null;
            let isController = false;
            let moduleHash = null;
            
            try {
                const canisterIdPrincipal = Principal.fromText(canisterId);
                const mgmtActor = Actor.createActor(managementCanisterIdlFactory, {
                    agent,
                    canisterId: MANAGEMENT_CANISTER_ID,
                    callTransform: (methodName, args, callConfig) => ({
                        ...callConfig,
                        effectiveCanisterId: canisterIdPrincipal,
                    }),
                });
                const status = await mgmtActor.canister_status({ canister_id: canisterIdPrincipal });
                cycles = Number(status.cycles);
                memory = Number(status.memory_size);
                moduleHash = status.module_hash[0] ? uint8ArrayToHex(status.module_hash[0]) : null;
                isController = true;
            } catch (err) {
                // Not a controller - try backend fallback to get module_hash
                try {
                    const result = await getCanisterInfo(identity, canisterId);
                    if (result && 'ok' in result) {
                        moduleHash = result.ok.module_hash[0] ? uint8ArrayToHex(result.ok.module_hash[0]) : null;
                    }
                } catch (fallbackErr) {
                    console.log(`Backend fallback error for ${canisterId}:`, fallbackErr.message || fallbackErr);
                }
            }
            
            const newStatus = { cycles, memory, isController, moduleHash };
            setTrackedCanisterStatus(prev => ({
                ...prev,
                [canisterId]: newStatus
            }));
            
            // If this is a detected neuron manager, refresh its info too
            if (detectedNeuronManagers[canisterId] && moduleHash) {
                const matchedVersion = isKnownNeuronManagerHash(moduleHash);
                if (matchedVersion) {
                    fetchDetectedManagerInfo(canisterId, newStatus);
                }
            }
        } catch (err) {
            console.error('Error refreshing canister card:', err);
        } finally {
            setRefreshingCanisterCard(null);
        }
    }

    // Refresh a single neuron manager's data
    async function handleRefreshManagerCard(canisterId) {
        if (!identity || !canisterId) return;
        
        setRefreshingManagerCard(canisterId);
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const canisterIdPrincipal = Principal.fromText(canisterId);
            
            // Fetch neuron count and cycles
            try {
                const managerActor = createManagerActor(canisterIdPrincipal, { agent });
                const [count, version] = await Promise.all([
                    managerActor.getNeuronCount(),
                    managerActor.getVersion(),
                ]);
                
                setNeuronManagerCounts(prev => ({ ...prev, [canisterId]: Number(count) }));
                
                // Update version in managers array
                setNeuronManagers(prev => prev.map(m => 
                    normalizeId(m.canisterId) === canisterId 
                        ? { ...m, version } 
                        : m
                ));
            } catch (err) {
                console.error(`Error fetching manager data for ${canisterId}:`, err);
            }
            
            // Try to fetch cycles
            try {
                const mgmtActor = Actor.createActor(managementCanisterIdlFactory, {
                    agent,
                    canisterId: MANAGEMENT_CANISTER_ID,
                    callTransform: (methodName, args, callConfig) => ({
                        ...callConfig,
                        effectiveCanisterId: canisterIdPrincipal,
                    }),
                });
                const status = await mgmtActor.canister_status({ canister_id: canisterIdPrincipal });
                setNeuronManagerCycles(prev => ({ ...prev, [canisterId]: Number(status.cycles) }));
                setNeuronManagerMemory(prev => ({ ...prev, [canisterId]: Number(status.memory_size) }));
                setNeuronManagerIsController(prev => ({ ...prev, [canisterId]: true }));
            } catch (err) {
                // Not a controller
                setNeuronManagerCycles(prev => ({ ...prev, [canisterId]: null }));
                setNeuronManagerMemory(prev => ({ ...prev, [canisterId]: null }));
            }
            
            // Refresh neurons data if expanded
            if (expandedManagerCards[canisterId]) {
                await fetchManagerNeuronsData(canisterId);
            }
        } catch (err) {
            console.error('Error refreshing manager card:', err);
        } finally {
            setRefreshingManagerCard(null);
        }
    }

    // Add a tracked canister
    async function handleAddTrackedCanister() {
        if (!identity || !newTrackedCanisterId.trim()) return;
        
        setAddingTrackedCanister(true);
        setAddTrackedCanisterError('');
        
        try {
            // Validate the canister ID
            Principal.fromText(newTrackedCanisterId.trim());
        } catch (e) {
            setAddTrackedCanisterError('Invalid canister ID format');
            setAddingTrackedCanister(false);
            return;
        }
        
        try {
            await registerTrackedCanister(identity, newTrackedCanisterId.trim());
            setNewTrackedCanisterId('');
            if (contextRefreshTrackedCanisters) contextRefreshTrackedCanisters();
        } catch (err) {
            console.error('Error adding tracked canister:', err);
            setAddTrackedCanisterError(err.message || 'Failed to add canister');
        } finally {
            setAddingTrackedCanister(false);
        }
    }

    // Remove a tracked canister
    async function handleRemoveTrackedCanister(canisterId) {
        if (!identity || !canisterId) return;
        
        setRemovingTrackedCanister(canisterId);
        try {
            await unregisterTrackedCanister(identity, canisterId);
            if (contextRefreshTrackedCanisters) contextRefreshTrackedCanisters();
        } catch (err) {
            console.error('Error removing tracked canister:', err);
        } finally {
            setRemovingTrackedCanister(null);
            setConfirmRemoveTrackedCanister(null);
        }
    }

    // Refresh tracked canisters
    async function handleRefreshTrackedCanisters() {
        setRefreshingTrackedCanisters(true);
        try {
            if (contextRefreshTrackedCanisters) await contextRefreshTrackedCanisters();
            // Also refresh status
            if (trackedCanisters.length > 0) {
                await fetchTrackedCanistersStatus(trackedCanisters);
            }
        } finally {
            setRefreshingTrackedCanisters(false);
        }
    }

    // Fetch ICP to cycles conversion rate
    async function fetchIcpToCyclesRate() {
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ host });
            
            const cmc = createCmcActor(CMC_CANISTER_ID, { agent });
            const response = await cmc.get_icp_xdr_conversion_rate();
            
            const xdrPerIcp = Number(response.data.xdr_permyriad_per_icp) / 10000;
            const cyclesPerIcp = xdrPerIcp * 1_000_000_000_000;
            
            setIcpToCyclesRate(cyclesPerIcp);
        } catch (err) {
            console.error('Error fetching ICP to cycles rate:', err);
        }
    }

    // Handle cycles top-up for a manager canister
    async function handleCyclesTopUp(managerCanisterId) {
        if (!identity || !managerCanisterId || !topUpAmount) return;
        
        const icpAmount = parseFloat(topUpAmount);
        if (isNaN(icpAmount) || icpAmount <= 0) {
            setTopUpError('Please enter a valid ICP amount');
            return;
        }
        
        const amountE8s = BigInt(Math.floor(icpAmount * E8S_ICP));
        const totalNeeded = amountE8s + BigInt(ICP_FEE);
        
        setToppingUp(true);
        setTopUpError('');
        setTopUpSuccess('');
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            // Fetch user's ICP balance directly from ledger
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            const userIcpBalance = await ledger.icrc1_balance_of({
                owner: identity.getPrincipal(),
                subaccount: [],
            });
            
            if (BigInt(userIcpBalance) < totalNeeded) {
                setTopUpError(`Insufficient ICP balance. You have ${(Number(userIcpBalance) / E8S_ICP).toFixed(4)} ICP, need ${(Number(totalNeeded) / E8S_ICP).toFixed(4)} ICP (including fee)`);
                setToppingUp(false);
                return;
            }
            
            const canisterPrincipal = Principal.fromText(managerCanisterId);
            const cmcPrincipal = Principal.fromText(CMC_CANISTER_ID);
            
            // Step 1: Transfer ICP to CMC with canister's subaccount and TPUP memo
            const subaccount = principalToSubAccount(canisterPrincipal);
            
            console.log('Transferring ICP to CMC for cycles top-up...');
            
            const transferResult = await ledger.icrc1_transfer({
                to: {
                    owner: cmcPrincipal,
                    subaccount: [subaccount],
                },
                amount: amountE8s,
                fee: [BigInt(ICP_FEE)],
                memo: [TOP_UP_MEMO],
                from_subaccount: [],
                created_at_time: [],
            });
            
            if ('Err' in transferResult) {
                const err = transferResult.Err;
                if ('InsufficientFunds' in err) {
                    throw new Error(`Insufficient funds: ${(Number(err.InsufficientFunds.balance) / E8S_ICP).toFixed(4)} ICP available`);
                }
                throw new Error(`Transfer failed: ${JSON.stringify(err)}`);
            }
            
            const blockIndex = transferResult.Ok;
            console.log('Transfer successful, block index:', blockIndex.toString());
            
            // Step 2: Notify CMC to mint cycles
            const cmc = createCmcActor(CMC_CANISTER_ID, { agent });
            
            console.log('Notifying CMC to mint cycles...');
            const notifyResult = await cmc.notify_top_up({
                block_index: blockIndex,
                canister_id: canisterPrincipal,
            });
            
            if ('Err' in notifyResult) {
                const err = notifyResult.Err;
                if ('Refunded' in err) {
                    throw new Error(`Top-up refunded: ${err.Refunded.reason}`);
                } else if ('InvalidTransaction' in err) {
                    throw new Error(`Invalid transaction: ${err.InvalidTransaction}`);
                } else if ('Other' in err) {
                    throw new Error(`CMC error: ${err.Other.error_message}`);
                } else if ('Processing' in err) {
                    throw new Error('Transaction is still being processed. Please try again in a moment.');
                }
                throw new Error(`Unknown CMC error: ${JSON.stringify(err)}`);
            }
            
            const cyclesAdded = Number(notifyResult.Ok);
            setTopUpSuccess(`✅ Added ${formatCyclesCompact(cyclesAdded)} cycles!`);
            setTopUpAmount('');
            setTopUpManagerId(null);
            
            // Refresh data
            if (contextRefreshNeuronManagers) contextRefreshNeuronManagers();
            fetchTokens();
            
        } catch (err) {
            console.error('Cycles top-up error:', err);
            setTopUpError(`Top-up failed: ${err.message || 'Unknown error'}`);
        } finally {
            setToppingUp(false);
        }
    }

    // Handle cycles top-up for tracked canisters
    async function handleCanisterCyclesTopUp(canisterId) {
        if (!identity || !canisterId || !canisterTopUpAmount) return;
        
        const icpAmount = parseFloat(canisterTopUpAmount);
        if (isNaN(icpAmount) || icpAmount <= 0) {
            setCanisterTopUpError('Please enter a valid ICP amount');
            return;
        }
        
        const amountE8s = BigInt(Math.floor(icpAmount * E8S_ICP));
        const totalNeeded = amountE8s + BigInt(ICP_FEE);
        
        setCanisterToppingUp(true);
        setCanisterTopUpError('');
        setCanisterTopUpSuccess('');
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            // Fetch user's ICP balance directly from ledger
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            const userIcpBalance = await ledger.icrc1_balance_of({
                owner: identity.getPrincipal(),
                subaccount: [],
            });
            
            if (BigInt(userIcpBalance) < totalNeeded) {
                setCanisterTopUpError(`Insufficient ICP balance. You have ${(Number(userIcpBalance) / E8S_ICP).toFixed(4)} ICP, need ${(Number(totalNeeded) / E8S_ICP).toFixed(4)} ICP (including fee)`);
                setCanisterToppingUp(false);
                return;
            }
            
            const canisterPrincipal = Principal.fromText(canisterId);
            const cmcPrincipal = Principal.fromText(CMC_CANISTER_ID);
            
            // Step 1: Transfer ICP to CMC with canister's subaccount and TPUP memo
            const subaccount = principalToSubAccount(canisterPrincipal);
            
            console.log('Transferring ICP to CMC for cycles top-up...');
            
            const transferResult = await ledger.icrc1_transfer({
                to: {
                    owner: cmcPrincipal,
                    subaccount: [subaccount],
                },
                amount: amountE8s,
                fee: [BigInt(ICP_FEE)],
                memo: [TOP_UP_MEMO],
                from_subaccount: [],
                created_at_time: [],
            });
            
            if ('Err' in transferResult) {
                const err = transferResult.Err;
                if ('InsufficientFunds' in err) {
                    throw new Error(`Insufficient funds: ${(Number(err.InsufficientFunds.balance) / E8S_ICP).toFixed(4)} ICP available`);
                }
                throw new Error(`Transfer failed: ${JSON.stringify(err)}`);
            }
            
            const blockIndex = transferResult.Ok;
            console.log('Transfer successful, block index:', blockIndex.toString());
            
            // Step 2: Notify CMC to mint cycles
            const cmc = createCmcActor(CMC_CANISTER_ID, { agent });
            
            console.log('Notifying CMC to mint cycles...');
            const notifyResult = await cmc.notify_top_up({
                block_index: blockIndex,
                canister_id: canisterPrincipal,
            });
            
            if ('Err' in notifyResult) {
                const err = notifyResult.Err;
                if ('Refunded' in err) {
                    throw new Error(`Top-up refunded: ${err.Refunded.reason}`);
                } else if ('InvalidTransaction' in err) {
                    throw new Error(`Invalid transaction: ${err.InvalidTransaction}`);
                } else if ('Other' in err) {
                    throw new Error(`CMC error: ${err.Other.error_message}`);
                } else if ('Processing' in err) {
                    throw new Error('Transaction is still being processed. Please try again in a moment.');
                }
                throw new Error(`Unknown CMC error: ${JSON.stringify(err)}`);
            }
            
            const cyclesAdded = Number(notifyResult.Ok);
            setCanisterTopUpSuccess(`✅ Added ${formatCyclesCompact(cyclesAdded)} cycles!`);
            setCanisterTopUpAmount('');
            setTopUpCanisterId(null);
            
            // Refresh data
            if (contextRefreshTrackedCanisters) contextRefreshTrackedCanisters();
            fetchTokens();
            
        } catch (err) {
            console.error('Canister cycles top-up error:', err);
            setCanisterTopUpError(`Top-up failed: ${err.message || 'Unknown error'}`);
        } finally {
            setCanisterToppingUp(false);
        }
    }

    // Handle canister transfer (change controller)
    async function handleCanisterTransfer() {
        if (!identity || !transferTargetCanister || !transferCanisterRecipient.trim()) return;
        
        setTransferringCanister(true);
        setTransferCanisterError('');
        setTransferCanisterSuccess('');
        
        try {
            // Validate recipient principal
            let recipientPrincipal;
            try {
                recipientPrincipal = Principal.fromText(transferCanisterRecipient.trim());
            } catch (e) {
                throw new Error('Invalid recipient principal ID');
            }
            
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const canisterPrincipal = Principal.fromText(transferTargetCanister);
            
            // Create management canister actor
            const mgmtActor = Actor.createActor(managementCanisterIdlFactory, {
                agent,
                canisterId: MANAGEMENT_CANISTER_ID,
                callTransform: (methodName, args, callConfig) => ({
                    ...callConfig,
                    effectiveCanisterId: canisterPrincipal,
                }),
            });
            
            // First get current settings
            const currentStatus = await mgmtActor.canister_status({ canister_id: canisterPrincipal });
            
            // Update settings to change controllers to only the new owner
            // Note: This is a simplified transfer - in practice you might want to add the new controller
            // while keeping yourself as controller, then let the new owner remove you
            const updateSettingsIdl = ({ IDL }) => {
                return IDL.Service({
                    'update_settings': IDL.Func(
                        [IDL.Record({
                            'canister_id': IDL.Principal,
                            'settings': IDL.Record({
                                'controllers': IDL.Opt(IDL.Vec(IDL.Principal)),
                                'compute_allocation': IDL.Opt(IDL.Nat),
                                'memory_allocation': IDL.Opt(IDL.Nat),
                                'freezing_threshold': IDL.Opt(IDL.Nat),
                            }),
                        })],
                        [],
                        []
                    ),
                });
            };
            
            const updateActor = Actor.createActor(updateSettingsIdl, {
                agent,
                canisterId: MANAGEMENT_CANISTER_ID,
                callTransform: (methodName, args, callConfig) => ({
                    ...callConfig,
                    effectiveCanisterId: canisterPrincipal,
                }),
            });
            
            await updateActor.update_settings({
                canister_id: canisterPrincipal,
                settings: {
                    controllers: [[recipientPrincipal]],
                    compute_allocation: [],
                    memory_allocation: [],
                    freezing_threshold: [],
                },
            });
            
            setTransferCanisterSuccess('✅ Canister transferred successfully!');
            
            // Refresh and close modal after delay
            setTimeout(() => {
                setTransferCanisterModalOpen(false);
                setTransferTargetCanister(null);
                setTransferCanisterRecipient('');
                setTransferCanisterSuccess('');
                if (contextRefreshTrackedCanisters) contextRefreshTrackedCanisters();
            }, 2000);
            
        } catch (err) {
            console.error('Error transferring canister:', err);
            setTransferCanisterError(`Transfer failed: ${err.message || 'Unknown error'}`);
        } finally {
            setTransferringCanister(false);
        }
    }

    // Fetch neurons for a specific manager canister (uses context function)
    const fetchManagerNeuronsData = (managerCanisterId) => {
        if (contextFetchManagerNeuronsData) {
            contextFetchManagerNeuronsData(managerCanisterId);
        }
    };
    
    // Toggle manager card expansion
    const toggleManagerCard = (canisterId) => {
        const canisterIdStr = normalizeId(canisterId);
        const isExpanding = !expandedManagerCards[canisterIdStr];
        
        setExpandedManagerCards(prev => ({
            ...prev,
            [canisterIdStr]: isExpanding
        }));
        
        // Fetch neurons when expanding if not already loaded
        if (isExpanding && (!managerNeurons[canisterIdStr] || managerNeurons[canisterIdStr].error)) {
            fetchManagerNeuronsData(canisterIdStr);
        }
    };

    // Handle transfer of neuron manager control
    async function handleTransferManager() {
        if (!transferTargetManager || !transferRecipient.trim()) return;
        
        setTransferring(true);
        setTransferError('');
        setTransferSuccess('');
        
        try {
            // Validate recipient principal
            let newController;
            try {
                newController = Principal.fromText(transferRecipient.trim());
            } catch (e) {
                throw new Error('Invalid principal ID format');
            }
            
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            // Management canister IDL for update_settings
            const { IDL } = await import('@dfinity/candid');
            
            const canister_settings = IDL.Record({
                'controllers': IDL.Opt(IDL.Vec(IDL.Principal)),
                'compute_allocation': IDL.Opt(IDL.Nat),
                'memory_allocation': IDL.Opt(IDL.Nat),
                'freezing_threshold': IDL.Opt(IDL.Nat),
                'reserved_cycles_limit': IDL.Opt(IDL.Nat),
                'log_visibility': IDL.Opt(IDL.Variant({
                    'controllers': IDL.Null,
                    'public': IDL.Null,
                })),
                'wasm_memory_limit': IDL.Opt(IDL.Nat),
            });
            
            const managementIdl = ({ IDL }) => IDL.Service({
                update_settings: IDL.Func([IDL.Record({
                    canister_id: IDL.Principal,
                    settings: canister_settings,
                })], [], []),
            });
            
            const { Actor } = await import('@dfinity/agent');
            const targetCanisterId = transferTargetManager.canisterId;
            const managementCanister = Actor.createActor(
                managementIdl, 
                { 
                    agent, 
                    canisterId: Principal.fromText('aaaaa-aa'),
                    callTransform: (methodName, args, callConfig) => ({
                        ...callConfig,
                        effectiveCanisterId: targetCanisterId,
                    }),
                }
            );
            
            // Transfer: set only the new controller (removes all existing)
            await managementCanister.update_settings({
                canister_id: targetCanisterId,
                settings: {
                    controllers: [[newController]],
                    compute_allocation: [],
                    memory_allocation: [],
                    freezing_threshold: [],
                    reserved_cycles_limit: [],
                    log_visibility: [],
                    wasm_memory_limit: [],
                },
            });
            
            // Also transfer the factory registration to the new owner
            try {
                const factory = createFactoryActor(factoryCanisterId, { agent });
                await factory.transferManager(transferTargetManager.canisterId, newController);
            } catch (factoryErr) {
                console.warn('Could not transfer factory registration (may not have been registered):', factoryErr);
                // Don't fail the transfer if factory registration fails
            }
            
            setTransferSuccess(`✅ Successfully transferred control to ${newController.toText()}`);
            
            // Refresh the list (the transferred manager will no longer appear)
            if (contextRefreshNeuronManagers) contextRefreshNeuronManagers();
            
            // Close modal after a brief delay to show success
            setTimeout(() => {
                setTransferModalOpen(false);
                setTransferTargetManager(null);
                setTransferRecipient('');
                setTransferSuccess('');
            }, 2000);
            
        } catch (err) {
            console.error('Error transferring manager:', err);
            setTransferError(`Transfer failed: ${err.message || 'Unknown error'}`);
        } finally {
            setTransferring(false);
        }
    }

    // Handle registering an existing manager canister
    async function handleRegisterManager(canisterId) {
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const factory = createFactoryActor(factoryCanisterId, { agent });
            const result = await factory.registerManager(canisterId);
            
            if ('Err' in result) {
                throw new Error(result.Err);
            }
            
            if (contextRefreshNeuronManagers) contextRefreshNeuronManagers();
            return { success: true };
        } catch (err) {
            console.error('Error registering manager:', err);
            return { success: false, error: err.message || 'Unknown error' };
        }
    }

    // Handle deregistering a manager canister
    async function handleDeregisterManager(canisterId) {
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const factory = createFactoryActor(factoryCanisterId, { agent });
            const result = await factory.deregisterManager(canisterId);
            
            if ('Err' in result) {
                throw new Error(result.Err);
            }
            
            if (contextRefreshNeuronManagers) contextRefreshNeuronManagers();
            return { success: true };
        } catch (err) {
            console.error('Error deregistering manager:', err);
            return { success: false, error: err.message || 'Unknown error' };
        }
    }

    // Refresh a single liquidity position instead of all positions
    async function refreshSinglePosition(swapCanisterId) {
        try {
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });

            // Get claimed positions for this swap canister
            const claimed_positions = await sneedLockActor.get_claimed_positions_for_principal(identity.getPrincipal());
            const normalizedSwapCanisterId = normalizeId(swapCanisterId);
            const claimed_positions_for_swap = claimed_positions.filter(cp => 
                normalizeId(cp.swap_canister_id) === normalizedSwapCanisterId
            );
            const claimed_position_ids_for_swap = claimed_positions_for_swap.map(cp => cp.position_id);
            const claimed_positions_for_swap_by_id = {};
            for (const claimed_position of claimed_positions_for_swap) {
                claimed_positions_for_swap_by_id[claimed_position.position_id] = claimed_position;
            }

            // Get swap metadata and token info
            const swapActor = createIcpSwapActor(swapCanisterId);
            const token_meta = await getTokenMetaForSwap(swapActor, backendActor, swapCanisterId);
            const swap_meta = await swapActor.metadata();

            const icrc1_ledger0 = swap_meta.ok.token0.address;
            const ledgerActor0 = createLedgerActor(icrc1_ledger0);
            const metadata0 = await ledgerActor0.icrc1_metadata();
            const token0Logo = getTokenLogo(metadata0);

            const icrc1_ledger1 = swap_meta.ok.token1.address;
            const ledgerActor1 = createLedgerActor(icrc1_ledger1);
            const metadata1 = await ledgerActor1.icrc1_metadata();
            const token1Logo = getTokenLogo(metadata1);

            const token0Decimals = token_meta?.token0?.find(([key]) => key === "decimals")?.[1]?.Nat ?? 0;
            const token0Symbol = token_meta?.token0?.find(([key]) => key === "symbol")?.[1]?.Text ?? "Unknown";
            const token1Decimals = token_meta?.token1?.find(([key]) => key === "decimals")?.[1]?.Nat ?? 0;
            const token1Symbol = token_meta?.token1?.find(([key]) => key === "symbol")?.[1]?.Text ?? "Unknown";

            const token0Fee = await ledgerActor0.icrc1_fee();
            const token1Fee = await ledgerActor1.icrc1_fee();

            let token0LogoFinal = token0Logo;
            let token1LogoFinal = token1Logo;
            if (token0Symbol?.toLowerCase() === "icp" && token0Logo === "") { token0LogoFinal = "icp_symbol.svg"; }
            if (token1Symbol?.toLowerCase() === "icp" && token1Logo === "") { token1LogoFinal = "icp_symbol.svg"; }

            const token0_conversion_rate = await get_token_conversion_rate(icrc1_ledger0, token0Decimals);
            const token1_conversion_rate = await get_token_conversion_rate(icrc1_ledger1, token1Decimals);

            const userPositionIds = (await swapActor.getUserPositionIdsByPrincipal(identity.getPrincipal())).ok;

            let offset = 0;
            const limit = 10;
            let userPositions = [];
            let hasMorePositions = true;
            while (hasMorePositions) {
                const allPositions = (await swapActor.getUserPositionWithTokenAmount(offset, limit)).ok.content;
                for (const position of allPositions) {
                    if (userPositionIds.includes(position.id) || claimed_position_ids_for_swap.includes(position.id)) {
                        userPositions.push({
                            position: position,
                            claimInfo: claimed_positions_for_swap_by_id[position.id],
                            frontendOwnership: userPositionIds.includes(position.id)
                        });
                    }
                }
                offset += limit;
                hasMorePositions = allPositions.length === limit;
            }

            const unused = await swapActor.getUserUnusedBalance(identity.getPrincipal());
            const swapCanisterBalance0 = unused.ok ? unused.ok.balance0 : 0n;
            const swapCanisterBalance1 = unused.ok ? unused.ok.balance1 : 0n;

            const positionDetails = await Promise.all(userPositions.map(async (compoundPosition) => {
                const position = compoundPosition.position;
                return {
                    positionId: position.id,
                    tokensOwed0: position.tokensOwed0,
                    tokensOwed1: position.tokensOwed1,
                    token0Amount: position.token0Amount,
                    token1Amount: position.token1Amount,
                    frontendOwnership: compoundPosition.frontendOwnership,
                    lockInfo: (!compoundPosition.frontendOwnership && compoundPosition.claimInfo.position_lock && toJsonString(compoundPosition.claimInfo.position_lock) !== '[]')
                        ? compoundPosition.claimInfo.position_lock[0]
                        : null
                };
            }));

            const liquidityPosition = {
                swapCanisterId: swapCanisterId,
                token0: Principal.fromText(icrc1_ledger0),
                token1: Principal.fromText(icrc1_ledger1),
                token0Symbol: token0Symbol,
                token1Symbol: token1Symbol,
                token0Logo: token0LogoFinal,
                token1Logo: token1LogoFinal,
                token0Decimals: token0Decimals,
                token1Decimals: token1Decimals,
                token0Fee: token0Fee,
                token1Fee: token1Fee,
                token0_conversion_rate: token0_conversion_rate,
                token1_conversion_rate: token1_conversion_rate,
                swapCanisterBalance0: swapCanisterBalance0,
                swapCanisterBalance1: swapCanisterBalance1,
                positions: positionDetails,
                loading: false
            };

            // Update only this position in state
            setLiquidityPositions(prevPositions => prevPositions.map(pos => 
                normalizeId(pos.swapCanisterId) === normalizedSwapCanisterId ? liquidityPosition : pos
            ));

            return {
                token0Ledger: Principal.fromText(icrc1_ledger0),
                token1Ledger: Principal.fromText(icrc1_ledger1)
            };

        } catch (error) {
            console.error('Error refreshing single position:', error);
            throw error;
        }
    }

    async function fetchLockDetails(currentTokens) {
        // Don't show loading spinners if we already have cached data - silent background update
        const initialLoadingState = {};
        currentTokens.forEach(token => {
            const ledgerId = normalizeId(token.ledger_canister_id);
            // Only set loading if we don't have cached locks for this token
            if (!locks[ledgerId] || locks[ledgerId].length === 0) {
                initialLoadingState[ledgerId] = true;
            }
        });
        if (Object.keys(initialLoadingState).length > 0) {
            setLockDetailsLoading(prevState => ({...prevState, ...initialLoadingState}));
        }

        const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
        if (await sneedLockActor.has_expired_locks()) {
            await sneedLockActor.clear_expired_locks();
        }
        const locks_from_backend = await sneedLockActor.get_token_locks();

        // Build all locks at once for caching
        const allLocks = {};

        // Fetch lock details for each token in parallel
        await Promise.all(currentTokens.map(async (token) => {
            const ledgerId = normalizeId(token.ledger_canister_id);
            const ledgerActor = createLedgerActor(token.ledger_canister_id);
            try {

                const tokenLocks = [];
    
                for (const lock of locks_from_backend) {
                    if (normalizeId(lock[1]) === ledgerId) {
                        const readableDateFromHugeInt = new Date(Number(lock[3] / (10n ** 6n)));
                        tokenLocks.push({
                            lock_id: lock[0],
                            amount: lock[2],
                            expiry: readableDateFromHugeInt
                        });
                    }
                }
    
                // Store for caching
                allLocks[ledgerId] = tokenLocks;

                // Update locks state for this token
                setLocks(prevLocks => ({
                    ...prevLocks,
                    [ledgerId]: tokenLocks
                }));
    
                // Update loading state for this token
                setLockDetailsLoading(prevState => ({
                    ...prevState,
                    [ledgerId]: false
                }));
    
            } catch (err) {

                console.error('Error fetching lock details: ', err);
                //console.error(er);
                setLockDetailsLoading(prevState => ({
                    ...prevState,
                    [ledgerId]: false
                }));

            }
        }));

        // Save all locks to cache for instant load next time
        if (Object.keys(allLocks).length > 0) {
            setCachedLocks(identity.getPrincipal(), allLocks);
        }
    }

    useEffect(() => {
        var total = 0.0;
        var liquidTotal = 0.0;
        var lockedTotal = 0.0;
        var rewardsTotal = 0.0;
        var stakedTotal = 0.0;
        var maturityTotal = 0.0;
        var collectableMaturityTotal = 0.0;
        var hasAnyRewards = false; // Track if there are any rewards regardless of USD value
        var hasAnyMaturity = false; // Track if there are any maturity regardless of USD value
        var hasAnyCollectableMaturity = false; // Track if user can collect any maturity
        
        for (const token of tokens) {
            const divisor = 10 ** token.decimals;
            const rate = token.conversion_rate || 0;
            
            // Calculate liquid (available = frontend + backend balances)
            const liquidAmount = Number(token.available || 0n) / divisor * rate;
            liquidTotal += liquidAmount;
            
            // Calculate locked
            const lockedAmount = Number(token.locked || 0n) / divisor * rate;
            lockedTotal += lockedAmount;
            
            // Calculate rewards
            const ledgerId = normalizeId(token.ledger_canister_id);
            if (rewardDetailsLoading && rewardDetailsLoading[ledgerId] != null && BigInt(rewardDetailsLoading[ledgerId]) > 0) {
                hasAnyRewards = true;
                const rewardAmount = Number(BigInt(rewardDetailsLoading[ledgerId])) / divisor * rate;
                rewardsTotal += rewardAmount;
            }
            
            // Add neuron breakdown (staked + maturity) directly from token data (like PrincipalBox)
            // This ensures neuron totals show instantly from cached tokens
            const neuronStake = BigInt(token.neuronStake || 0n);
            const neuronMaturity = BigInt(token.neuronMaturity || 0n);
            
            if (neuronStake > 0n) {
                const stakedUSD = Number(neuronStake) / divisor * rate;
                stakedTotal += stakedUSD;
                total += stakedUSD;
            }
            
            if (neuronMaturity > 0n) {
                hasAnyMaturity = true;
                const maturityUSD = Number(neuronMaturity) / divisor * rate;
                maturityTotal += maturityUSD;
                total += maturityUSD;
            }
            
            // Track collectable maturity from neuronTotals (requires TokenCard to compute)
            if (neuronTotals[ledgerId]) {
                const neuronData = neuronTotals[ledgerId];
                if (typeof neuronData === 'object' && neuronData.collectableMaturity && neuronData.collectableMaturity > 0) {
                    hasAnyCollectableMaturity = true;
                    collectableMaturityTotal += neuronData.collectableMaturity;
                }
            }
            
            // Get base token TVL (liquid + locked + rewards) - neuron totals already added above
            const baseTVL = getTokenTVL(token, rewardDetailsLoading, false);
            total += baseTVL;
        }

        // Calculate liquidity and fees from LP positions
        let feesTotal = 0.0;
        let hasAnyFees = false; // Track if there are any fees regardless of USD value
        let liquidityTotal = 0.0;
        for (const lp of liquidityPositions) {
            for (const positionDetails of lp.positions) {
                const positionTVL = getPositionTVL(lp, positionDetails, false);
                total += positionTVL;
                
                // Check if there are any fees in tokens
                if (positionDetails.tokensOwed0 > 0n || positionDetails.tokensOwed1 > 0n) {
                    hasAnyFees = true;
                }
                
                // Calculate unclaimed fees (tokensOwed)
                const fees0USD = parseFloat(formatAmountWithConversion(positionDetails.tokensOwed0, lp.token0Decimals, lp.token0_conversion_rate));
                const fees1USD = parseFloat(formatAmountWithConversion(positionDetails.tokensOwed1, lp.token1Decimals, lp.token1_conversion_rate));
                feesTotal += fees0USD + fees1USD;
                
                // Calculate position liquidity (excluding fees)
                // Handle both token0Amount/token1Amount and amount0/amount1 naming conventions
                const token0Amt = positionDetails.token0Amount ?? positionDetails.amount0 ?? 0n;
                const token1Amt = positionDetails.token1Amount ?? positionDetails.amount1 ?? 0n;
                const position0USD = parseFloat(formatAmountWithConversion(token0Amt, lp.token0Decimals, lp.token0_conversion_rate));
                const position1USD = parseFloat(formatAmountWithConversion(token1Amt, lp.token1Decimals, lp.token1_conversion_rate));
                const positionLiquidityValue = position0USD + position1USD;
                
                // If position is locked, add to locked total, otherwise to liquidity total
                if (isLockedPosition(positionDetails)) {
                    lockedTotal += positionLiquidityValue;
                } else {
                    liquidityTotal += positionLiquidityValue;
                }
            }
        }

        // Add manager neurons ICP value to total (converted to USD)
        if (managerNeuronsTotal > 0 && icpPrice) {
            total += managerNeuronsTotal * icpPrice;
        }

        // Format with commas and 2 decimals
        const formattedTotal = total.toLocaleString(undefined, { 
            minimumFractionDigits: 2, 
            maximumFractionDigits: 2 
        });

        setTotalDollarValue(formattedTotal);
        
        // Console log subtotals to verify they add up
        setTotalBreakdown({
            liquid: liquidTotal,
            liquidity: liquidityTotal,
            maturity: maturityTotal,
            collectableMaturity: collectableMaturityTotal,
            rewards: rewardsTotal,
            fees: feesTotal,
            staked: stakedTotal,
            locked: lockedTotal,
            hasAnyFees: hasAnyFees, // Track if there are any fees in tokens
            hasAnyRewards: hasAnyRewards, // Track if there are any rewards in tokens
            hasAnyMaturity: hasAnyMaturity, // Track if there are any maturity in tokens
            hasAnyCollectableMaturity: hasAnyCollectableMaturity // Track if user can collect any maturity
        });
        
        // Calculate tokens total (liquid + locked + staked + maturity + rewards)
        const tokensUsdTotal = liquidTotal + lockedTotal + stakedTotal + maturityTotal + rewardsTotal;
        setTokensTotal(tokensUsdTotal);
        
        // Calculate LP positions total (liquidity + fees)
        const lpUsdTotal = liquidityTotal + feesTotal;
        setLpPositionsTotal(lpUsdTotal);
    }, [tokens, liquidityPositions, rewardDetailsLoading, neuronTotals, managerNeuronsTotal, icpPrice]);

    // Note: Total ICP value from manager neurons is now calculated in WalletContext

    const calc_send_amounts = (token, amount) => {
        console.log('=== calc_send_amounts START ===');
        
        var send_from_frontend = BigInt(0);
        var send_from_backend = BigInt(0);
        const avail_backend = get_available_backend(token);
        const avail_tot = BigInt(get_available(token));
        const full_amount = amount + BigInt(token.fee);
        const fuller_amount = full_amount + BigInt(token.fee);
        
        console.log('calc_send_amounts values:', {
            amount: amount.toString(),
            tokenFee: token.fee.toString(),
            tokenBalance: token.balance.toString(),
            tokenAvailable: token.available.toString(),
            avail_backend: avail_backend.toString(),
            avail_tot: avail_tot.toString(),
            full_amount: full_amount.toString(),
            fuller_amount: fuller_amount.toString()
        });
        
        // New logic: Try backend first, then frontend, then split
        const backendUsable = avail_backend - BigInt(token.fee); // Backend balance minus 1 tx fee
        const frontendUsable = BigInt(token.balance) - BigInt(token.fee); // Frontend balance minus 1 tx fee
        
        console.log('Send logic calculations:', {
            amount: amount.toString(),
            backendBalance: avail_backend.toString(),
            frontendBalance: token.balance.toString(),
            backendUsable: backendUsable.toString(),
            frontendUsable: frontendUsable.toString(),
            txFee: token.fee.toString()
        });

        if (amount <= backendUsable && backendUsable > 0n) {
            // Rule 1: Send entirely from backend
            send_from_backend = amount;
            console.log('Rule 1: Sending entirely from backend:', amount.toString());
            
        } else if (amount <= frontendUsable && frontendUsable > 0n) {
            // Rule 2: Send entirely from frontend  
            send_from_frontend = amount;
            console.log('Rule 2: Sending entirely from frontend:', amount.toString());
            
        } else {
            // Rule 3: Split send - backend first, then frontend
            console.log('Rule 3: Need to split send');
            
            if (backendUsable > 0n) {
                send_from_backend = backendUsable; // Send max possible from backend
                const remaining = amount - backendUsable;
                
                if (remaining <= frontendUsable && frontendUsable > 0n) {
                    send_from_frontend = remaining; // Send remainder from frontend
                    console.log('Split send successful:', {
                        backendSend: send_from_backend.toString(),
                        frontendSend: send_from_frontend.toString(),
                        remaining: remaining.toString()
                    });
                } else {
                    console.log('ERROR: Cannot send remainder from frontend');
                    console.log('Remaining needed:', remaining.toString(), 'Frontend usable:', frontendUsable.toString());
                    // Reset to 0 since we can't complete the transaction
                    send_from_backend = 0n;
                    send_from_frontend = 0n;
                }
            } else if (frontendUsable > 0n) {
                // Backend can't help, try frontend only
                if (amount <= frontendUsable) {
                    send_from_frontend = amount;
                    console.log('Backend unavailable, sending from frontend only');
                } else {
                    console.log('ERROR: Amount exceeds frontend capacity');
                }
            } else {
                console.log('ERROR: Neither backend nor frontend can send this amount');
            }
        }
        
        console.log('calc_send_amounts result:', {
            send_from_frontend: send_from_frontend.toString(),
            send_from_backend: send_from_backend.toString()
        });
        
        return {
            send_from_frontend : send_from_frontend,
            send_from_backend : send_from_backend
        };
    };

    const handleSendToken = async (token, recipient, amount, subaccount = []) => {
        console.log('=== Wallet.handleSendToken START ===');
        console.log('Parameters:', { 
            tokenSymbol: token.symbol, 
            recipient, 
            amount,
            tokenAvailable: token.available?.toString(),
            tokenFee: token.fee?.toString(),
            hasSubaccount: subaccount.length > 0
        });

        try {
            const decimals = await token.decimals;
            console.log('Token decimals:', decimals);
            
            // Convert to BigInt safely - handle decimal inputs
            const amountFloat = parseFloat(amount);
            const scaledAmount = amountFloat * (10 ** decimals);
            const bigintAmount = BigInt(Math.floor(scaledAmount));
            
            console.log('Amount conversion:', {
                amountFloat,
                scaledAmount, 
                bigintAmount: bigintAmount.toString()
            });
            
            const send_amounts = calc_send_amounts(token, bigintAmount);
            console.log('Send amounts calculated:', {
                send_from_backend: send_amounts.send_from_backend.toString(),
                send_from_frontend: send_amounts.send_from_frontend.toString(),
                total: (send_amounts.send_from_backend + send_amounts.send_from_frontend).toString()
            });

            if (send_amounts.send_from_backend + send_amounts.send_from_frontend <= BigInt(0)) {
                console.log('ERROR: Total send amount is zero or negative');
                throw new Error('Invalid send amounts calculated');
            }

            if (send_amounts.send_from_backend > 0) {
                console.log('Sending from backend:', send_amounts.send_from_backend.toString());

                const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            
                const recipientPrincipal = Principal.fromText(recipient);
                console.log('Backend transfer - recipient principal:', recipientPrincipal.toText());
                
                // Backend transfer with subaccount support
                const result = await sneedLockActor.transfer_tokens(
                    recipientPrincipal,
                    subaccount,
                    token.ledger_canister_id,
                    send_amounts.send_from_backend
                );
        
                const resultJson = JSON.stringify(result, (key, value) => {
                    if (typeof value === 'bigint') {
                        return value.toString();
                    }
                    return value;
                });
                
                console.log('Backend transfer result:', resultJson);
            }

            if (send_amounts.send_from_frontend > 0) {
                console.log('Sending from frontend:', send_amounts.send_from_frontend.toString());

                const actor = createLedgerActor(token.ledger_canister_id, {
                    agentOptions: {
                        identity,
                    },
                });
        
                const decimals = await token.decimals;
        
                const recipientPrincipal = Principal.fromText(recipient);
                console.log('Frontend transfer - recipient principal:', recipientPrincipal.toText());
                console.log('Frontend transfer - subaccount:', subaccount.length > 0 ? 'provided' : 'none');
                
                const result = await actor.icrc1_transfer({
                    to: { owner: recipientPrincipal, subaccount: subaccount },
                    fee: [],
                    memo: [],
                    from_subaccount: [],
                    created_at_time: [],
                    amount: send_amounts.send_from_frontend
                });
        
                const resultJson = JSON.stringify(result, (key, value) => {
                    if (typeof value === 'bigint') {
                        return value.toString();
                    }
                    return value;
                });
                
                console.log('Frontend transfer result:', resultJson);
            }

            console.log('Refreshing token balances...');
            await fetchBalancesAndLocks(token.ledger_canister_id);
            console.log('=== Wallet.handleSendToken SUCCESS ===');
            
        } catch (error) {
            console.error('=== Wallet.handleSendToken ERROR ===');
            console.error('Error details:', error);
            console.error('Error message:', error.message);
            console.error('Error stack:', error.stack);
            throw error; // Re-throw so the modal can handle it
        }
    };

    const openSendModal = (token) => {
        setSelectedToken(token);
        setShowSendModal(true);
    };

    const openTokenDetailModal = (token) => {
        setDetailToken(token);
        setShowTokenDetailModal(true);
    };

    // Open dapp detail modal (for canisters and neuron managers)
    const openDappDetailModal = (dappInfo) => {
        setDetailDapp(dappInfo);
        setShowDappDetailModal(true);
    };

    // Refresh dapp in detail modal
    const handleRefreshDappModal = async (canisterId) => {
        if (!identity || !canisterId) return;
        
        setIsRefreshingDapp(true);
        try {
            await handleRefreshCanisterCard(canisterId);
            
            // Update modal with fresh data
            const status = trackedCanisterStatus[canisterId];
            const detectedManager = detectedNeuronManagers[canisterId];
            
            setDetailDapp(prev => prev ? {
                ...prev,
                cycles: status?.cycles,
                memory: status?.memory,
                isController: status?.isController,
                neuronCount: detectedManager?.neuronCount || prev?.neuronCount,
            } : null);
        } finally {
            setIsRefreshingDapp(false);
        }
    };

    const openWrapModal = (token) => {
        setSelectedToken(token);
        setShowWrapUnwrapModal(true);
    };

    const openUnwrapModal = (token) => {
        setSelectedToken(token);
        setShowWrapUnwrapModal(true);
    };

    const handleWrap = async (token, amount) => {
        console.log('Starting wrap operation:', { token: token.symbol, amount });
        
        const decimals = token.decimals;
        // Convert to BigInt safely - handle decimal inputs
        const amountFloat = parseFloat(amount);
        const scaledAmount = amountFloat * (10 ** decimals);
        const bigIntAmount = BigInt(Math.floor(scaledAmount));
        
        // Step 1: Check existing allowance and approve if needed
        const gldtLedgerActor = createLedgerActor(GLDT_CANISTER_ID, {
            agentOptions: { identity }
        });
        
        const approveAmount = bigIntAmount - token.fee; // amount - 1 GLDT tx fee
        console.log('Required approve amount:', approveAmount.toString());
        
        // Check current allowance
        const allowanceArgs = {
            account: { owner: identity.getPrincipal(), subaccount: [] },
            spender: { owner: Principal.fromText(SGLDT_CANISTER_ID), subaccount: [] }
        };
        
        const currentAllowance = await gldtLedgerActor.icrc2_allowance(allowanceArgs);
        console.log('Current allowance:', currentAllowance.allowance.toString());
        
        // Only approve if current allowance is insufficient
        if (currentAllowance.allowance < approveAmount) {
            console.log('Insufficient allowance, calling icrc2_approve...');
            
            const approveResult = await gldtLedgerActor.icrc2_approve({
                spender: { owner: Principal.fromText(SGLDT_CANISTER_ID), subaccount: [] },
                amount: approveAmount,
                fee: [],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
                expires_at: [],
                expected_allowance: [currentAllowance.allowance] // Set current allowance as expected
            });

            // Check if approve was successful
            if ('Err' in approveResult) {
                throw new Error(`Approve failed: ${JSON.stringify(approveResult.Err)}`);
            }
            console.log('Approve successful');
        } else {
            console.log('Sufficient allowance already exists, skipping approve');
        }

        // Step 2: Call deposit on sGLDT canister (amount - 2 tx fees)
        const sgldtActor = createSgldtActor(SGLDT_CANISTER_ID, {
            agentOptions: { identity }
        });

        const depositAmount = bigIntAmount - (2n * token.fee); // amount - 2 GLDT tx fees
        console.log('Depositing amount:', depositAmount.toString());
        
        const depositResult = await sgldtActor.deposit([], depositAmount);
        
        if ('err' in depositResult) {
            throw new Error(`Deposit failed: ${depositResult.err}`);
        }
        console.log('Deposit successful');

        // Auto-register sGLDT token if not already registered
        const sgldtExists = tokens.find(t => normalizeId(t.ledger_canister_id) === SGLDT_CANISTER_ID || normalizeId(t.principal) === SGLDT_CANISTER_ID);
        if (!sgldtExists) {
            console.log('Auto-registering sGLDT token');
            await handleAddLedgerCanister(SGLDT_CANISTER_ID);
        }

        // Refresh balances for both tokens
        await fetchBalancesAndLocks(Principal.fromText(GLDT_CANISTER_ID));
        await fetchBalancesAndLocks(Principal.fromText(SGLDT_CANISTER_ID));
        console.log('Wrap operation completed');
    };

    const handleUnwrap = async (token, amount) => {
        console.log('Starting unwrap operation:', { token: token.symbol, amount });
        
        const decimals = token.decimals;
        // Convert to BigInt safely - handle decimal inputs  
        const amountFloat = parseFloat(amount);
        const scaledAmount = amountFloat * (10 ** decimals);
        const bigIntAmount = BigInt(Math.floor(scaledAmount));
        
        // Call withdraw on sGLDT canister
        const sgldtActor = createSgldtActor(SGLDT_CANISTER_ID, {
            agentOptions: { identity }
        });

        console.log('Withdrawing amount:', bigIntAmount.toString());
        const withdrawResult = await sgldtActor.withdraw([], bigIntAmount);
        
        if ('err' in withdrawResult) {
            throw new Error(`Withdraw failed: ${withdrawResult.err}`);
        }
        console.log('Withdraw successful');

        // Auto-register GLDT token if not already registered
        const gldtExists = tokens.find(t => normalizeId(t.ledger_canister_id) === GLDT_CANISTER_ID || normalizeId(t.principal) === GLDT_CANISTER_ID);
        if (!gldtExists) {
            console.log('Auto-registering GLDT token');
            await handleAddLedgerCanister(GLDT_CANISTER_ID);
        }

        // Refresh balances for both tokens
        await fetchBalancesAndLocks(Principal.fromText(GLDT_CANISTER_ID));
        await fetchBalancesAndLocks(Principal.fromText(SGLDT_CANISTER_ID));
        console.log('Unwrap operation completed');
    };

    const handleWithdrawFromBackend = async (token) => {
        console.log('=== Backend withdrawal button clicked ===');
        console.log('Token:', token.symbol, 'Backend balance:', token.available_backend.toString());
        
        if (token.available_backend <= 0n) {
            console.log('No backend balance to withdraw');
            return;
        }

        if (token.available_backend <= BigInt(token.fee)) {
            console.log('Backend balance too small to cover transaction fee');
            return;
        }

        // Open the withdraw modal
        setSelectedToken(token);
        setShowWithdrawModal(true);
    };

    const handleWithdrawTokenFromBackend = async (token, amount) => {
        console.log('=== handleWithdrawTokenFromBackend ===');
        console.log('Token:', token.symbol);
        console.log('Amount:', amount);

        try {
            const decimals = await token.decimals;
            console.log('Token decimals:', decimals);
            
            // Convert to BigInt safely - handle decimal inputs
            const amountFloat = parseFloat(amount);
            const scaledAmount = amountFloat * (10 ** decimals);
            const withdrawAmount = BigInt(Math.floor(scaledAmount));
            
            console.log('Withdrawal calculation:', {
                backendBalance: token.available_backend.toString(),
                txFee: token.fee.toString(),
                withdrawAmount: withdrawAmount.toString()
            });

            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { 
                agentOptions: { identity } 
            });

            // Transfer the specified amount to user's frontend wallet
            const result = await sneedLockActor.transfer_tokens(
                identity.getPrincipal(),
                [],
                token.ledger_canister_id,
                withdrawAmount
            );

            console.log('Backend withdrawal result:', JSON.stringify(result, (key, value) => {
                if (typeof value === 'bigint') {
                    return value.toString();
                }
                return value;
            }));

            // Refresh the token balance
            await fetchBalancesAndLocks(token.ledger_canister_id);
            console.log('=== Backend withdrawal completed ===');
            
        } catch (error) {
            console.error('=== Backend withdrawal error ===');
            console.error('Error details:', error);
            throw error;
        }
    };

    const handleDepositToBackend = async (token) => {
        console.log('=== Backend deposit button clicked ===');
        console.log('Token:', token.symbol, 'Frontend balance:', token.balance.toString());
        
        if (token.balance <= 0n) {
            console.log('No frontend balance to deposit');
            return;
        }

        if (token.balance <= BigInt(token.fee)) {
            console.log('Frontend balance too small to cover transaction fee');
            return;
        }

        // Open the deposit modal
        setSelectedToken(token);
        setShowDepositModal(true);
    };

    const handleDepositTokenToBackend = async (token, amount) => {
        console.log('=== handleDepositTokenToBackend ===');
        console.log('Token:', token.symbol);
        console.log('Amount:', amount);

        try {
            const decimals = await token.decimals;
            console.log('Token decimals:', decimals);
            
            // Convert to BigInt safely - handle decimal inputs
            const amountFloat = parseFloat(amount);
            const scaledAmount = amountFloat * (10 ** decimals);
            const depositAmount = BigInt(Math.floor(scaledAmount));
            
            console.log('Deposit calculation:', {
                frontendBalance: token.balance.toString(),
                txFee: token.fee.toString(),
                depositAmount: depositAmount.toString()
            });

            const ledgerActor = createLedgerActor(token.ledger_canister_id, {
                agentOptions: { identity }
            });

            const principal_subaccount = principalToSubAccount(identity.getPrincipal());
            const recipientPrincipal = Principal.fromText(sneedLockCanisterId);
            
            // Transfer to the user's subaccount on the backend
            const result = await ledgerActor.icrc1_transfer({
                to: { owner: recipientPrincipal, subaccount: [principal_subaccount] },
                fee: [],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
                amount: depositAmount
            });

            console.log('Backend deposit result:', JSON.stringify(result, (key, value) => {
                if (typeof value === 'bigint') {
                    return value.toString();
                }
                return value;
            }));

            // Refresh the token balance
            await fetchBalancesAndLocks(token.ledger_canister_id);
            console.log('=== Backend deposit completed ===');
            
        } catch (error) {
            console.error('=== Backend deposit error ===');
            console.error('Error details:', error);
            throw error;
        }
    };

    const handleSendLiquidityPosition = async (liquidityPosition, recipient) => {
        const isBackendTransfer = liquidityPosition.isBackendTransfer || false;
        console.log('=== handleSendLiquidityPosition ===');
        console.log('isBackendTransfer:', isBackendTransfer);
        console.log('liquidityPosition:', liquidityPosition);
        console.log('recipient:', recipient);

        try {
            if(liquidityPosition.frontendOwnership) {
                const actor = createIcpSwapActor(liquidityPosition.swapCanisterId, {
                    agentOptions: {
                        identity,
                    },
                });

                const recipientPrincipal = Principal.fromText(recipient);
                const result = await actor.transferPosition(identity.getPrincipal(), recipientPrincipal, liquidityPosition.id);

                const resultJson = JSON.stringify(result, (key, value) => {
                    if (typeof value === 'bigint') {
                        return value.toString();
                    }
                    return value;
                });
                console.log('Frontend transfer result:', resultJson);

            } else {
                const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
                
                if (isBackendTransfer) {
                    // Transfer backend ownership only (for locked positions)
                    console.log('=== Transferring backend ownership ===');
                    console.log('Position:', liquidityPosition.symbols, 'ID:', liquidityPosition.id, 'To:', recipient);
                    const result = await sneedLockActor.transfer_position_ownership(
                        Principal.fromText(recipient), 
                        liquidityPosition.swapCanisterId, 
                        liquidityPosition.id
                    );
                    console.log('Backend ownership transfer result:', toJsonString(result));
                    
                    // Check for error in result
                    if (result.Err) {
                        throw new Error(result.Err.message || 'Transfer failed');
                    }
                } else {
                    // Full transfer (actual position transfer on ICPSwap)
                    const result = await sneedLockActor.transfer_position(
                        Principal.fromText(recipient), 
                        liquidityPosition.swapCanisterId, 
                        liquidityPosition.id
                    );
                    const resultJson = toJsonString(result);
                    console.log('Backend full transfer result:', resultJson);
                    
                    // Check for error in result
                    if (result.err) {
                        throw new Error(result.err.message || result.err.InternalError || 'Transfer failed');
                    }
                }
            }

            // Refresh positions in context (shared with quick wallet)
            if (contextRefreshPositions) contextRefreshPositions();
        } catch (error) {
            console.error('=== handleSendLiquidityPosition ERROR ===');
            console.error('Error:', error);
            throw error; // Re-throw so the modal can catch it
        }
    };

    const handleWithdrawPosition = async (liquidityPosition) => {
        console.log('=== Withdrawing position from backend ===');
        console.log('Position:', liquidityPosition.symbols, 'ID:', liquidityPosition.id);
        
        // Show confirmation dialog
        setConfirmAction(() => async () => {
            try {
                console.log('=== Starting confirmed position withdrawal ===');
                
                const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { 
                    agentOptions: { identity } 
                });

                // Transfer position from backend to user's frontend wallet
                const result = await sneedLockActor.transfer_position(
                    identity.getPrincipal(),
                    liquidityPosition.swapCanisterId,
                    liquidityPosition.id
                );

                console.log('Position withdrawal result:', toJsonString(result));

                // Refresh only the specific position
                await refreshSinglePosition(liquidityPosition.swapCanisterId);
                console.log('=== Position withdrawal completed ===');
                
            } catch (error) {
                console.error('=== Position withdrawal error ===');
                console.error('Error details:', error);
                throw error;
            }
        });

        setConfirmMessage(`You are about to withdraw position #${liquidityPosition.id} (${liquidityPosition.symbols}) to your wallet. Continue?`);
        setShowConfirmModal(true);
    };

    const openSendLiquidityPositionModal = (liquidityPosition) => {
        setSelectedLiquidityPosition(liquidityPosition);
        setShowSendLiquidityPositionModal(true);
    };

    const handleAddLock = async (token, amount, expiry, onProgress) => {
        const ledger_canister_id = token.ledger_canister_id;
        const ledgerActor = createLedgerActor(ledger_canister_id, { agentOptions: { identity } });
        const decimals = await ledgerActor.icrc1_decimals();
        // Convert to BigInt safely - handle decimal inputs
        const amountFloat = parseFloat(amount);
        const scaledAmount = amountFloat * (10 ** decimals);
        const bigIntAmount = BigInt(Math.floor(scaledAmount));
        const available_balance_backend = get_available_backend(token);
        const bigIntAmountSendToBackend = bigIntAmount - available_balance_backend;

        if (bigIntAmountSendToBackend > 0) {
            // Report progress: depositing
            if (onProgress) onProgress('depositing');
            
            const principal_subaccount = principalToSubAccount(identity.getPrincipal());
            const recipientPrincipal = Principal.fromText(sneedLockCanisterId);
            const resultSend = await ledgerActor.icrc1_transfer({
                to: { owner: recipientPrincipal, subaccount: [principal_subaccount] },
                fee: [],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
                amount: bigIntAmountSendToBackend
            });

        }

        // Report progress: locking
        if (onProgress) onProgress('locking');

        const sneedLockActor = createSneedLockActor(sneedLockCanisterId, {
            agentOptions: {
                identity
            }
        });

        const result = await sneedLockActor.create_lock(
            bigIntAmount,
            ledger_canister_id,
            BigInt(expiry) * (10n ** 6n)
        );

        locks[token] = locks[token] || [];
        locks[token].push({ lock_id: result.Ok, amount: amount, expiry: expiry });
        setLocks(locks);

        /*await*/ fetchBalancesAndLocks(ledger_canister_id);

        return result;
    };

    const openLockModal = async (token) => {
        setSelectedToken(token);
        setShowLockModal(true);
    };

    const openTransferTokenLockModal = (lock, token) => {
        setSelectedTokenLock({ ...lock, token });
        setShowTransferTokenLockModal(true);
    };

    const handleTransferTokenLock = async (tokenLock, recipient) => {
        console.log('=== handleTransferTokenLock ===');
        console.log('Lock ID:', tokenLock.lock_id);
        console.log('Token:', tokenLock.token.symbol);
        console.log('Recipient:', recipient);

        try {
            const token = tokenLock.token;
            const liquidBackend = get_available_backend(token);
            const needsPreSend = liquidBackend < BigInt(token.fee);

            console.log('Liquid backend balance:', liquidBackend.toString());
            console.log('Token fee:', token.fee.toString());
            console.log('Needs pre-send:', needsPreSend);

            // If we don't have enough liquid balance on backend, send 1 tx fee first
            if (needsPreSend) {
                console.log('=== Sending 1 tx fee to backend subaccount ===');
                
                const ledgerActor = createLedgerActor(token.ledger_canister_id, {
                    agentOptions: { identity }
                });

                const principal_subaccount = principalToSubAccount(identity.getPrincipal());
                const recipientPrincipal = Principal.fromText(sneedLockCanisterId);
                
                const sendResult = await ledgerActor.icrc1_transfer({
                    to: { owner: recipientPrincipal, subaccount: [principal_subaccount] },
                    fee: [],
                    memo: [],
                    from_subaccount: [],
                    created_at_time: [],
                    amount: BigInt(token.fee)
                });

                console.log('Pre-send result:', toJsonString(sendResult));

                if (sendResult.Err) {
                    throw new Error(`Failed to send fee to backend: ${sendResult.Err}`);
                }

                // Wait and verify the tokens arrived by checking backend balance
                console.log('=== Verifying tokens arrived at backend ===');
                let attempts = 0;
                const maxAttempts = 10;
                let verified = false;

                while (attempts < maxAttempts && !verified) {
                    // Wait a bit before checking
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    attempts++;

                    // Fetch the updated backend balance
                    const updatedBackendBalance = await ledgerActor.icrc1_balance_of({ 
                        owner: Principal.fromText(sneedLockCanisterId), 
                        subaccount: [principal_subaccount] 
                    });

                    const updatedLiquidBackend = BigInt(updatedBackendBalance) - BigInt(token.locked);
                    console.log(`Verification attempt ${attempts}: Backend balance = ${updatedBackendBalance.toString()}, Liquid = ${updatedLiquidBackend.toString()}`);

                    if (updatedLiquidBackend >= BigInt(token.fee)) {
                        console.log('✓ Verified: Backend now has sufficient liquid balance');
                        verified = true;
                    }
                }

                if (!verified) {
                    throw new Error('Timeout waiting for tokens to arrive at backend subaccount');
                }
            }

            // Now proceed with the actual transfer
            console.log('=== Proceeding with transfer_token_lock_ownership ===');
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { 
                agentOptions: { identity } 
            });

            const result = await sneedLockActor.transfer_token_lock_ownership(
                Principal.fromText(recipient),
                tokenLock.token.ledger_canister_id,
                tokenLock.lock_id
            );

            console.log('Transfer token lock result:', toJsonString(result));

            // Check for error in result
            if (result.Err) {
                throw new Error(result.Err.message || 'Transfer failed');
            }

            // Refresh token balances and locks
            await fetchBalancesAndLocks(tokenLock.token.ledger_canister_id);
            console.log('=== Token lock transfer completed ===');

        } catch (error) {
            console.error('=== handleTransferTokenLock ERROR ===');
            console.error('Error:', error);
            throw error; // Re-throw so the modal can catch it
        }
    };

    const handleAddLockPosition = async (position, expiry, onProgress) => {
        var result = { "Ok": true };

        const swapActor = createIcpSwapActor(position.swapCanisterId, { agentOptions: { identity } });
        const userPositionIds = (await swapActor.getUserPositionIdsByPrincipal(identity.getPrincipal())).ok;
        const frontendOwnership = userPositionIds.includes(position.id);
        
        // Report whether transfer is needed (for progress tracking)
        if (onProgress) onProgress('checkOwnership', { frontendOwnership });
        
        if (frontendOwnership) {
            // Report progress: transferring position
            if (onProgress) onProgress('transferring');

            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });

            // Only try to lock if we have been able to claim the position on the backend
            if (await sneedLockActor.claim_position(position.swapCanisterId, position.id)) {
                result = await swapActor.transferPosition(
                    identity.getPrincipal(), 
                    Principal.fromText(sneedLockCanisterId), 
                    position.id);

                if (!result["err"]) {
                    // Report progress: locking
                    if (onProgress) onProgress('locking');
                    
                    const expiryBig = BigInt(expiry) * (10n ** 6n);
                    result = await sneedLockActor.create_position_lock(
                        position.swapCanisterId,
                        dex_icpswap,
                        position.id,
                        expiryBig,
                        position.token0,
                        position.token1
                    );
                } else {
                    result = { "Err": { "message": "Unable to transfer position to Sneedlock: "
                        + toJsonString(result["err"]) } };
                }
            } else {
                result = { "Err": { "message": "Unable to claim position." } };
            }
        } else {
            // Report progress: locking (position already in vault)
            if (onProgress) onProgress('locking');

            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });

            const expiryBig = BigInt(expiry) * (10n ** 6n);

            result = position.isLocked
                ? await sneedLockActor.update_position_lock(
                    position.swapCanisterId,
                    position.id,
                    expiryBig
                )
                : await sneedLockActor.create_position_lock(
                    position.swapCanisterId,
                    dex_icpswap,
                    position.id,
                    expiryBig,
                    position.token0,
                    position.token1
                );
        }

        // Refresh only the specific position that was locked
        if (result["Ok"]) { 
            /*await*/ refreshSinglePosition(position.swapCanisterId); 
        }

        return result;
    };

    const openLockPositionModal = async (liquidityPosition) => {

        setSelectedLiquidityPosition(liquidityPosition);
        setShowLockPositionModal(true);

    };

    const handleWithdrawSwapBalance = async (liquidityPosition) => {
        console.log('=== Withdrawing swap canister balance ===');
        console.log('Swap Canister:', liquidityPosition.swapCanisterId);
        
        try {
            const swapActor = createIcpSwapActor(liquidityPosition.swapCanisterId, { 
                agentOptions: { identity } 
            });

            // Get token metadata
            const swapMeta = await swapActor.metadata();
            if (!swapMeta.ok) {
                throw new Error('Failed to get swap metadata');
            }

            const token0Ledger = swapMeta.ok.token0.address;
            const token1Ledger = swapMeta.ok.token1.address;

            // Get current balance
            const unused = await swapActor.getUserUnusedBalance(identity.getPrincipal());
            if (!unused.ok) {
                throw new Error('Failed to get swap canister balance');
            }

            const balance0 = unused.ok.balance0;
            const balance1 = unused.ok.balance1;

            console.log('Current balances:', {
                token0: balance0.toString(),
                token1: balance1.toString()
            });

            // Get fees for both tokens
            const ledgerActor0 = createLedgerActor(token0Ledger);
            const fee0 = await ledgerActor0.icrc1_fee();

            const ledgerActor1 = createLedgerActor(token1Ledger);
            const fee1 = await ledgerActor1.icrc1_fee();

            // Withdraw token0 if balance exceeds fee
            if (balance0 > fee0) {
                console.log('Withdrawing token0:', balance0.toString());
                const withdraw0Result = await swapActor.withdraw({
                    fee: fee0,
                    token: token0Ledger,
                    amount: balance0
                });
                
                console.log('Token0 withdraw result:', toJsonString(withdraw0Result));
                
                if (withdraw0Result.err) {
                    console.error('Token0 withdraw failed:', toJsonString(withdraw0Result.err));
                }
            } else {
                console.log('Token0 balance too small to withdraw:', balance0.toString());
            }

            // Withdraw token1 if balance exceeds fee
            if (balance1 > fee1) {
                console.log('Withdrawing token1:', balance1.toString());
                const withdraw1Result = await swapActor.withdraw({
                    fee: fee1,
                    token: token1Ledger,
                    amount: balance1
                });
                
                console.log('Token1 withdraw result:', toJsonString(withdraw1Result));
                
                if (withdraw1Result.err) {
                    console.error('Token1 withdraw failed:', toJsonString(withdraw1Result.err));
                }
            } else {
                console.log('Token1 balance too small to withdraw:', balance1.toString());
            }

            // Refresh only the specific position
            await refreshSinglePosition(liquidityPosition.swapCanisterId);
            
            // Also refresh token balances for both tokens
            await fetchBalancesAndLocks(Principal.fromText(token0Ledger));
            await fetchBalancesAndLocks(Principal.fromText(token1Ledger));
            
            console.log('=== Swap balance withdrawal completed ===');

        } catch (error) {
            console.error('=== Error withdrawing swap balance ===');
            console.error('Error:', error);
            throw error;
        }
    };
    
    const handleWithdrawPositionRewards = async (liquidityPosition) => {
        console.log('=== Claiming position fees ===');
        console.log('Position:', liquidityPosition.symbols, 'ID:', liquidityPosition.id);
        
        // Only available for frontend positions
        if (!liquidityPosition.frontendOwnership) {
            console.error('Cannot claim fees from backend position');
            throw new Error('Fee claiming is only available for positions in your wallet');
        }

        try {
            console.log('Creating swap actor for canister:', liquidityPosition.swapCanisterId);
            const swapActor = createIcpSwapActor(liquidityPosition.swapCanisterId, { 
                agentOptions: { identity } 
            });

            // Claim the position fees (this moves ALL fees from position to user balance in the swap canister)
            console.log('Calling claim for position', liquidityPosition.id);
            const claimResult = await swapActor.claim({ 
                positionId: Number(liquidityPosition.id) 
            });

            console.log('Claim result:', toJsonString(claimResult));

            if (!claimResult.ok) {
                console.error('Claim failed:', toJsonString(claimResult.err || claimResult));
                throw new Error(`Failed to claim fees: ${toJsonString(claimResult.err || claimResult)}`);
            }

            const claimedAmount0 = claimResult.ok.amount0;
            const claimedAmount1 = claimResult.ok.amount1;
            console.log('Claimed amounts:', {
                token0: claimedAmount0.toString(),
                token1: claimedAmount1.toString()
            });

            // Refresh only this position
            const { token0Ledger, token1Ledger } = await refreshSinglePosition(liquidityPosition.swapCanisterId);
            
            // Ensure both tokens are in wallet and refresh them
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            
            // Check if tokens exist in wallet, if not add them
            const normalizedToken0Ledger = normalizeId(token0Ledger);
            const normalizedToken1Ledger = normalizeId(token1Ledger);
            const token0Exists = tokens.some(t => normalizeId(t.ledger_canister_id) === normalizedToken0Ledger);
            const token1Exists = tokens.some(t => normalizeId(t.ledger_canister_id) === normalizedToken1Ledger);
            
            // Auto-add tokens if not in wallet
            if (!token0Exists) {
                console.log('Auto-adding token0 to wallet:', normalizedToken0Ledger);
                await backendActor.register_ledger_canister_id(token0Ledger);
            }
            if (!token1Exists) {
                console.log('Auto-adding token1 to wallet:', normalizedToken1Ledger);
                await backendActor.register_ledger_canister_id(token1Ledger);
            }
            
            // Refresh both tokens (whether newly added or existing)
            await fetchBalancesAndLocks(token0Ledger);
            await fetchBalancesAndLocks(token1Ledger);
            
            console.log('=== Claim process completed ===');

        } catch (error) {
            console.error('=== Error claiming position fees ===');
            console.error('Error:', error);
            throw error;
        }
    };

    const handleClaimUnlockedDepositedPositionFees = async (liquidityPosition) => {
        console.log('=== Claiming fees from unlocked deposited position ===');
        console.log('Position:', liquidityPosition.symbols, 'ID:', liquidityPosition.id);
        
        try {
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { 
                agentOptions: { identity } 
            });

            // Step 1: Withdraw position to frontend
            console.log('Step 1: Withdrawing position to frontend wallet...');
            const withdrawResult = await sneedLockActor.transfer_position(
                identity.getPrincipal(),
                liquidityPosition.swapCanisterId,
                liquidityPosition.id
            );

            console.log('Position withdrawal result:', toJsonString(withdrawResult));

            if (withdrawResult.err) {
                throw new Error(`Failed to withdraw position: ${withdrawResult.err.message || withdrawResult.err.InternalError || 'Transfer failed'}`);
            }

            // Step 2: Claim fees from the now-frontend position
            console.log('Step 2: Claiming fees from frontend position...');
            const swapActor = createIcpSwapActor(liquidityPosition.swapCanisterId, { 
                agentOptions: { identity } 
            });

            const claimResult = await swapActor.claim({ 
                positionId: Number(liquidityPosition.id) 
            });

            console.log('Claim result:', toJsonString(claimResult));

            if (!claimResult.ok) {
                console.error('Claim failed:', toJsonString(claimResult.err || claimResult));
                throw new Error(`Failed to claim fees: ${toJsonString(claimResult.err || claimResult)}`);
            }

            const claimedAmount0 = claimResult.ok.amount0;
            const claimedAmount1 = claimResult.ok.amount1;
            console.log('Claimed amounts:', {
                token0: claimedAmount0.toString(),
                token1: claimedAmount1.toString()
            });

            // Refresh only this position
            const { token0Ledger, token1Ledger } = await refreshSinglePosition(liquidityPosition.swapCanisterId);
            
            // Ensure both tokens are in wallet and refresh them
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            
            // Check if tokens exist in wallet, if not add them
            const normalizedToken0Ledger = normalizeId(token0Ledger);
            const normalizedToken1Ledger = normalizeId(token1Ledger);
            const token0Exists = tokens.some(t => normalizeId(t.ledger_canister_id) === normalizedToken0Ledger);
            const token1Exists = tokens.some(t => normalizeId(t.ledger_canister_id) === normalizedToken1Ledger);
            
            // Auto-add tokens if not in wallet
            if (!token0Exists) {
                console.log('Auto-adding token0 to wallet:', normalizedToken0Ledger);
                await backendActor.register_ledger_canister_id(token0Ledger);
            }
            if (!token1Exists) {
                console.log('Auto-adding token1 to wallet:', normalizedToken1Ledger);
                await backendActor.register_ledger_canister_id(token1Ledger);
            }
            
            // Refresh both tokens (whether newly added or existing)
            await fetchBalancesAndLocks(token0Ledger);
            await fetchBalancesAndLocks(token1Ledger);
            
            console.log('=== Unlocked deposited position fees claim completed ===');

        } catch (error) {
            console.error('=== Error claiming unlocked deposited position fees ===');
            console.error('Error:', error);
            throw error;
        }
    };

    const handleClaimLockedPositionFees = async ({ swapCanisterId, positionId, symbols, onStatusUpdate }) => {
        console.log('=== Claiming locked position fees ===');
        console.log('Position:', symbols, 'ID:', positionId);
        console.log('Swap Canister:', swapCanisterId);

        try {
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { 
                agentOptions: { identity } 
            });

            // Convert swapCanisterId to Principal if it's a string
            const swapPrincipal = typeof swapCanisterId === 'string' 
                ? Principal.fromText(swapCanisterId)
                : swapCanisterId;

            // Submit claim request
            console.log('Submitting claim request...');
            const submitResult = await sneedLockActor.request_claim_and_withdraw(
                swapPrincipal,
                BigInt(positionId)
            );

            console.log('Submit result:', toJsonString(submitResult));

            if (submitResult.Err) {
                throw new Error(submitResult.Err);
            }

            const requestId = Number(submitResult.Ok);
            console.log('Request submitted with ID:', requestId);
            onStatusUpdate('⏳ Waiting in queue...', requestId);

            // Poll for status updates
            let isComplete = false;
            let pollCount = 0;
            const maxPolls = 120; // 10 minutes max (5 sec intervals)

            while (!isComplete && pollCount < maxPolls) {
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
                pollCount++;

                console.log(`Polling status (attempt ${pollCount})...`);
                const statusResult = await sneedLockActor.get_claim_request_status(BigInt(requestId));

                if (!statusResult || statusResult.length === 0) {
                    console.log('Request not found');
                    throw new Error('Request not found');
                }

                const status = statusResult[0];
                
                // Check for Completed status (now returns full ClaimRequest)
                if ('Completed' in status) {
                    const completedRequest = status.Completed;
                    console.log('Request completed:', toJsonString(completedRequest));
                    
                    // Check if the status has transaction details
                    if ('Completed' in completedRequest.status) {
                        const details = completedRequest.status.Completed;
                        console.log('Transfer details:', {
                            amount0_claimed: details.amount0_claimed.toString(),
                            amount0_transferred: details.amount0_transferred.toString(),
                            amount1_claimed: details.amount1_claimed.toString(),
                            amount1_transferred: details.amount1_transferred.toString(),
                            transfer0_tx_id: details.transfer0_tx_id,
                            transfer1_tx_id: details.transfer1_tx_id
                        });
                    }
                    
                    onStatusUpdate('✅ Completed', requestId);
                    isComplete = true;
                    break;
                }

                // Check for Failed status (now returns full ClaimRequest)
                if ('Failed' in status) {
                    const failedRequest = status.Failed;
                    console.log('Request failed:', toJsonString(failedRequest));
                    
                    // Extract failure message from the status
                    let failureMessage = 'Unknown failure';
                    if ('Failed' in failedRequest.status) {
                        failureMessage = failedRequest.status.Failed;
                    } else if ('TimedOut' in failedRequest.status) {
                        failureMessage = 'Request timed out';
                    }
                    
                    throw new Error(`Claim failed: ${failureMessage}`);
                }

                // Check for Active status
                if ('Active' in status) {
                    const activeRequest = status.Active;
                    const requestStatus = activeRequest.status;

                    // Map status to user-friendly message
                    let statusMessage = '⚙️ Processing...';
                    if ('Pending' in requestStatus) {
                        statusMessage = '⏳ Waiting in queue...';
                    } else if ('Processing' in requestStatus) {
                        statusMessage = '⚙️ Processing started';
                    } else if ('BalanceRecorded' in requestStatus) {
                        statusMessage = '📊 Recording balances...';
                    } else if ('ClaimAttempted' in requestStatus) {
                        statusMessage = '🎯 Claiming rewards...';
                    } else if ('ClaimVerified' in requestStatus) {
                        statusMessage = '✓ Verified, withdrawing...';
                    } else if ('Withdrawn' in requestStatus) {
                        statusMessage = '💰 Withdrawing...';
                    } else if ('Failed' in requestStatus) {
                        throw new Error(`Claim failed: ${requestStatus.Failed}`);
                    } else if ('TimedOut' in requestStatus) {
                        throw new Error('Request timed out');
                    }

                    console.log('Status:', statusMessage);
                    onStatusUpdate(statusMessage, requestId);
                }
            }

            if (!isComplete) {
                throw new Error('Polling timeout - request may still be processing');
            }

            // Refresh only this position
            const { token0Ledger, token1Ledger } = await refreshSinglePosition(swapCanisterId);
            
            // Ensure both tokens are in wallet and refresh them
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            
            // Check if tokens exist in wallet, if not add them
            const normalizedToken0Ledger = normalizeId(token0Ledger);
            const normalizedToken1Ledger = normalizeId(token1Ledger);
            const token0Exists = tokens.some(t => normalizeId(t.ledger_canister_id) === normalizedToken0Ledger);
            const token1Exists = tokens.some(t => normalizeId(t.ledger_canister_id) === normalizedToken1Ledger);
            
            // Auto-add tokens if not in wallet
            if (!token0Exists) {
                console.log('Auto-adding token0 to wallet:', normalizedToken0Ledger);
                await backendActor.register_ledger_canister_id(token0Ledger);
            }
            if (!token1Exists) {
                console.log('Auto-adding token1 to wallet:', normalizedToken1Ledger);
                await backendActor.register_ledger_canister_id(token1Ledger);
            }
            
            // Refresh both tokens (whether newly added or existing)
            await fetchBalancesAndLocks(token0Ledger);
            await fetchBalancesAndLocks(token1Ledger);
            
            console.log('=== Locked position claim completed ===');

        } catch (error) {
            console.error('=== Error claiming locked position fees ===');
            console.error('Error:', error);
            throw error;
        }
    };

    const handleAddLedgerCanister = async (ledgerCanisterId) => {
        const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
        await backendActor.register_ledger_canister_id(Principal.fromText(ledgerCanisterId));

        // Pass the ledger canister ID so it only refreshes the new token, not all tokens
        /*await*/ fetchBalancesAndLocks(Principal.fromText(ledgerCanisterId));
    };

    const handleAddSwapCanister = async (swapCanisterId) => {
        const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
        await backendActor.register_swap_canister_id(Principal.fromText(swapCanisterId));

        // Refresh positions in context (shared with quick wallet)
        if (contextRefreshPositions) contextRefreshPositions();
    };

    const handleUnregisterToken = async (ledgerCanisterId) => {
        setConfirmAction(() => async () => {
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            await backendActor.unregister_ledger_canister_id(ledgerCanisterId);
            
            // Remove the token from state and mark as unknown
            const ledger_id = normalizeId(ledgerCanisterId);
            delete known_icrc1_ledgers[ledger_id];
            
            setTokens(prevTokens => prevTokens.filter(token => 
                normalizeId(token.ledger_canister_id) !== ledger_id
            ));
        });
        setConfirmMessage(`You are about to unregister ledger canister ${ledgerCanisterId}?`);
        setShowConfirmModal(true);
    };

    const handleUnregisterSwapCanister = async (swapCanisterId) => {
        setConfirmAction(() => async () => {
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            await backendActor.unregister_swap_canister_id(swapCanisterId);
            // Refresh positions in context (shared with quick wallet)
            if (contextRefreshPositions) contextRefreshPositions();
        });
        setConfirmMessage(`You are about to unregister swap canister ${swapCanisterId}?`);
        setShowConfirmModal(true);
    };

    const handleClaimRewards = async (token) => {
        try {
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            const claim_results = await rllActor.claim_full_balance_of_hotkey(
                token.ledger_canister_id,
                token.fee);
            /*await*/ fetchBalancesAndLocks(token.ledger_canister_id);
        } catch (error) {
            console.error('Error claiming rewards:', error);
            throw error;
        }
    };

    const handleRefreshToken = async (token) => {
        const ledgerId = normalizeId(token.ledger_canister_id);
        // Mark as refreshing
        setRefreshingTokens(prev => new Set(prev).add(ledgerId));
        try {
            // Refresh token balance, locks, and rewards
            await fetchBalancesAndLocks(ledgerId);
            await fetchRewardDetails(ledgerId);
            // Note: Neurons are refreshed within TokenCard itself
        } finally {
            // Clear refreshing state
            setRefreshingTokens(prev => {
                const next = new Set(prev);
                next.delete(ledgerId);
                return next;
            });
        }
    };

    const handleRefreshPosition = async (position) => {
        // Refresh just this specific liquidity position
        const swap_canister = position.swapCanisterId;
        const normalizedSwapCanister = normalizeId(swap_canister);
        
        // Mark as refreshing
        setRefreshingPositions(prev => new Set(prev).add(normalizedSwapCanister));
        
        try {
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });

            // Get claimed positions for this swap
            const claimed_positions = await sneedLockActor.get_claimed_positions_for_principal(identity.getPrincipal());
            const claimed_positions_for_swap = claimed_positions.filter(cp => normalizeId(cp.swap_canister_id) === normalizedSwapCanister);
            const claimed_position_ids_for_swap = claimed_positions_for_swap.map(claimed_position => claimed_position.position_id);
            const claimed_positions_for_swap_by_id = {};
            for (const claimed_position of claimed_positions_for_swap) {
                claimed_positions_for_swap_by_id[claimed_position.position_id] = claimed_position;
            }

            // Fetch updated data for this swap canister
            const swapActor = createIcpSwapActor(swap_canister);
            const token_meta = await getTokenMetaForSwap(swapActor, backendActor, swap_canister);
            const swap_meta = await swapActor.metadata();

            const icrc1_ledger0 = swap_meta.ok.token0.address;
            const ledgerActor0 = createLedgerActor(icrc1_ledger0);
            const metadata0 = await ledgerActor0.icrc1_metadata();
            let token0Logo = getTokenLogo(metadata0);

            const icrc1_ledger1 = swap_meta.ok.token1.address;
            const ledgerActor1 = createLedgerActor(icrc1_ledger1);
            const metadata1 = await ledgerActor1.icrc1_metadata();
            let token1Logo = getTokenLogo(metadata1);

            const token0Decimals = token_meta?.token0?.find(([key]) => key === "decimals")?.[1]?.Nat ?? 0;
            const token0Symbol = token_meta?.token0?.find(([key]) => key === "symbol")?.[1]?.Text ?? "Unknown";
            const token1Decimals = token_meta?.token1?.find(([key]) => key === "decimals")?.[1]?.Nat ?? 0;
            const token1Symbol = token_meta?.token1?.find(([key]) => key === "symbol")?.[1]?.Text ?? "Unknown";

            const token0Fee = await ledgerActor0.icrc1_fee();
            const token1Fee = await ledgerActor1.icrc1_fee();

            if (token0Symbol?.toLowerCase() === "icp" && token0Logo === "") { token0Logo = "icp_symbol.svg"; }
            if (token1Symbol?.toLowerCase() === "icp" && token1Logo === "") { token1Logo = "icp_symbol.svg"; }

            const token0_conversion_rate = await get_token_conversion_rate(icrc1_ledger0, token0Decimals);
            const token1_conversion_rate = await get_token_conversion_rate(icrc1_ledger1, token1Decimals);

            const userPositionIds = (await swapActor.getUserPositionIdsByPrincipal(identity.getPrincipal())).ok;

            let offset = 0;
            const limit = 10;
            let userPositions = [];
            let hasMorePositions = true;
            while (hasMorePositions) {
                const allPositions = (await swapActor.getUserPositionWithTokenAmount(offset, limit)).ok.content;
                for (const pos of allPositions) {
                    if (userPositionIds.includes(pos.id) || claimed_position_ids_for_swap.includes(pos.id)) {
                        userPositions.push({
                            position: pos,
                            claimInfo: claimed_positions_for_swap_by_id[pos.id],
                            frontendOwnership: userPositionIds.includes(pos.id)
                        });
                    }
                }
                offset += limit;
                hasMorePositions = allPositions.length === limit;
            }

            let swapCanisterBalance0 = 0n;
            let swapCanisterBalance1 = 0n;
            const unused = await swapActor.getUserUnusedBalance(identity.getPrincipal());
            if (unused.ok) {
                swapCanisterBalance0 = unused.ok.balance0;
                swapCanisterBalance1 = unused.ok.balance1;
            }

            const positionDetails = await Promise.all(userPositions.map(async (compoundPosition) => {
                const pos = compoundPosition.position;
                return {
                    positionId: pos.id,
                    tokensOwed0: pos.tokensOwed0,
                    tokensOwed1: pos.tokensOwed1,
                    token0Amount: pos.token0Amount,
                    token1Amount: pos.token1Amount,
                    frontendOwnership: compoundPosition.frontendOwnership,
                    lockInfo: (!compoundPosition.frontendOwnership && compoundPosition.claimInfo.position_lock && toJsonString(compoundPosition.claimInfo.position_lock) !== '[]')
                        ? compoundPosition.claimInfo.position_lock[0]
                        : null
                };
            }));

            const updatedPosition = {
                swapCanisterId: swap_canister,
                token0: Principal.fromText(icrc1_ledger0),
                token1: Principal.fromText(icrc1_ledger1),
                token0Symbol: token0Symbol,
                token1Symbol: token1Symbol,
                token0Logo: token0Logo,
                token1Logo: token1Logo,
                token0Decimals: token0Decimals,
                token1Decimals: token1Decimals,
                token0Fee: token0Fee,
                token1Fee: token1Fee,
                token0_conversion_rate: token0_conversion_rate,
                token1_conversion_rate: token1_conversion_rate,
                swapCanisterBalance0: swapCanisterBalance0,
                swapCanisterBalance1: swapCanisterBalance1,
                positions: positionDetails,
                loading: false
            };

            // Update the specific position in state
            setLiquidityPositions(prevPositions => prevPositions.map(p => 
                normalizeId(p.swapCanisterId) === normalizedSwapCanister ? updatedPosition : p
            ));
        } catch (error) {
            console.error('Error refreshing position:', error);
        } finally {
            // Clear refreshing state
            setRefreshingPositions(prev => {
                const next = new Set(prev);
                next.delete(normalizedSwapCanister);
                return next;
            });
        }
    };

    // Refresh functions for different sections
    const handleRefreshAllWallet = async () => {
        setRefreshingAllWallet(true);
        try {
            // Refresh positions in context (shared with quick wallet)
            if (contextRefreshPositions) contextRefreshPositions();
            await Promise.all([
                fetchBalancesAndLocks(),
                fetchIcpPrice()
            ]);
        } catch (error) {
            console.error('Error refreshing all wallet:', error);
        } finally {
            setRefreshingAllWallet(false);
        }
    };

    const handleRefreshTokensSection = async () => {
        setRefreshingTokensSection(true);
        try {
            await fetchBalancesAndLocks();
        } catch (error) {
            console.error('Error refreshing tokens section:', error);
        } finally {
            setRefreshingTokensSection(false);
        }
    };

    const handleRefreshPositionsSection = async () => {
        setRefreshingPositionsSection(true);
        setLocalPositionOverrides({}); // Clear local overrides
        try {
            // Use context's refresh function (shared with quick wallet)
            if (contextRefreshPositions) {
                contextRefreshPositions();
            }
            // Wait a bit for the refresh to complete
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            console.error('Error refreshing positions section:', error);
        } finally {
            setRefreshingPositionsSection(false);
        }
    };

    const handleRefreshNeuronManagers = async () => {
        setRefreshingNeuronManagers(true);
        try {
            if (contextRefreshNeuronManagers) contextRefreshNeuronManagers();
            // Wait a bit for the refresh to complete
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            console.error('Error refreshing neuron managers:', error);
        } finally {
            setRefreshingNeuronManagers(false);
        }
    };

    // Format ICP amount
    const formatIcpAmount = (e8s) => {
        if (e8s === null || e8s === undefined) return '...';
        const icp = e8s / 100_000_000;
        return icp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    };

    // Consolidation Functions
    const getFeesItems = () => {
        const items = [];
        liquidityPositions.forEach(position => {
            position.positions.forEach(positionDetails => {
                if (positionDetails.tokensOwed0 > 0n || positionDetails.tokensOwed1 > 0n) {
                    // Skip if neither token amount is >= its transaction fee (can't collect)
                    const canCollect0 = positionDetails.tokensOwed0 >= (position.token0Fee || 0n);
                    const canCollect1 = positionDetails.tokensOwed1 >= (position.token1Fee || 0n);
                    if (!canCollect0 && !canCollect1) {
                        return; // Skip this position - fees below transaction fees
                    }
                    
                    const fee0USD = position.token0_conversion_rate 
                        ? Number(positionDetails.tokensOwed0) / Number(10n ** BigInt(position.token0Decimals)) * position.token0_conversion_rate
                        : 0;
                    const fee1USD = position.token1_conversion_rate
                        ? Number(positionDetails.tokensOwed1) / Number(10n ** BigInt(position.token1Decimals)) * position.token1_conversion_rate
                        : 0;
                    const totalFeesUSD = fee0USD + fee1USD;
                    
                    const isFrontend = positionDetails.frontendOwnership;
                    const isLocked = !isFrontend && positionDetails.lockInfo;
                    
                    items.push({
                        type: 'fee',
                        subtype: isFrontend ? 'frontend' : (isLocked ? 'locked' : 'unlocked'),
                        name: `${position.token0Symbol}/${position.token1Symbol} Position #${positionDetails.positionId.toString()}${isFrontend ? ' (Direct)' : (isLocked ? ' (Locked)' : ' (Unlocked)')}`,
                        description: `${formatAmount(positionDetails.tokensOwed0, position.token0Decimals)} ${position.token0Symbol} + ${formatAmount(positionDetails.tokensOwed1, position.token1Decimals)} ${position.token1Symbol}`,
                        usdValue: totalFeesUSD,
                        position: position,
                        positionDetails: positionDetails
                    });
                }
            });
        });
        return items;
    };

    const getRewardsItems = () => {
        const items = [];
        tokens.forEach(token => {
            const rewardAmount = rewardAmountOrZero(token, rewardDetailsLoading, false);
            if (rewardAmount > 0n) {
                // Skip if reward amount is less than transaction fee (can't collect)
                const tokenFee = BigInt(token.fee || 0);
                if (rewardAmount < tokenFee) {
                    return; // Skip this reward - below transaction fee
                }
                
                const rewardsUSD = token.conversion_rate 
                    ? Number(rewardAmount) / Number(10n ** BigInt(token.decimals)) * token.conversion_rate
                    : 0;
                
                items.push({
                    type: 'reward',
                    name: `${token.symbol} Rewards`,
                    description: `${formatAmount(rewardAmount, token.decimals)} ${token.symbol}`,
                    usdValue: rewardsUSD,
                    token: token,
                    amount: rewardAmount
                });
            }
        });
        return items;
    };

    // Helper to check if user has a specific permission on a neuron
    const userHasNeuronPermission = (neuron, permissionType) => {
        if (!identity || !neuron.permissions) return false;
        const userPrincipal = normalizeId(identity.getPrincipal());
        const userPerms = neuron.permissions.find(p => 
            normalizeId(p.principal?.[0]) === userPrincipal
        );
        return userPerms?.permission_type?.includes(permissionType) || false;
    };

    const getMaturityItems = () => {
        const items = [];
        // Only SNS tokens have neurons with maturity
        tokens.forEach(token => {
            const ledgerId = normalizeId(token.ledger_canister_id);
            if (!snsTokens.has(ledgerId)) return;
            
            // Use the neurons stored from TokenCard callback
            const neurons = snsNeuronsByToken[ledgerId] || [];
            const tokenFee = BigInt(token.fee || 0);
            
            neurons.forEach(neuron => {
                const maturity = BigInt(neuron.maturity_e8s_equivalent || 0n);
                // Only include neurons where user has DISBURSE_MATURITY permission
                if (maturity > 0n && userHasNeuronPermission(neuron, PERM.DISBURSE_MATURITY)) {
                    // Skip if maturity is less than transaction fee (can't collect)
                    if (maturity < tokenFee) {
                        return; // Skip this neuron - maturity below transaction fee
                    }
                    
                    const maturityUSD = token.conversion_rate 
                        ? Number(maturity) / Number(10n ** BigInt(token.decimals)) * token.conversion_rate
                        : 0;
                    
                    const neuronIdHex = Array.from(neuron.id[0].id)
                        .map(b => b.toString(16).padStart(2, '0'))
                        .join('');
                    
                    items.push({
                        type: 'maturity',
                        name: `${token.symbol} Neuron ${neuronIdHex.substring(0, 8)}...`,
                        description: `${formatAmount(maturity, token.decimals)} ${token.symbol}`,
                        usdValue: maturityUSD,
                        token: token,
                        neuron: neuron,
                        neuronIdHex: neuronIdHex,
                        amount: maturity
                    });
                }
            });
        });
        return items;
    };

    const handleOpenConsolidateModal = (type) => {
        let items = [];
        
        if (type === 'fees') {
            items = getFeesItems();
        } else if (type === 'rewards') {
            items = getRewardsItems();
        } else if (type === 'maturity') {
            items = getMaturityItems();
        } else if (type === 'all') {
            items = [
                ...getFeesItems(),
                ...getRewardsItems(),
                ...getMaturityItems()
            ];
        }
        
        if (items.length === 0) {
            setConsolidateError('No items available to collect at this time. Please ensure data is loaded and try again.');
            // Auto-clear error after 5 seconds
            setTimeout(() => setConsolidateError(''), 5000);
            return;
        }
        
        setConsolidateError(''); // Clear any previous error
        setConsolidateItems(items);
        setConsolidateType(type);
        setShowConsolidateModal(true);
    };

    const handleConsolidateItem = async (item) => {
        if (item.type === 'fee') {
            const { position, positionDetails, subtype } = item;
            
            if (subtype === 'frontend') {
                // Direct position - withdraw rewards directly
                await handleWithdrawPositionRewards({
                    swapCanisterId: position.swapCanisterId,
                    id: positionDetails.positionId,
                    frontendOwnership: positionDetails.frontendOwnership,
                    symbols: position.token0Symbol + '/' + position.token1Symbol
                });
            } else if (subtype === 'locked') {
                // Locked position - claim through SneedLock
                await handleClaimLockedPositionFees({
                    swapCanisterId: position.swapCanisterId,
                    positionId: positionDetails.positionId,
                    symbols: position.token0Symbol + '/' + position.token1Symbol,
                    onStatusUpdate: (status) => {
                        console.log('Claim status:', status);
                    }
                });
            } else if (subtype === 'unlocked') {
                // Unlocked backend position - withdraw and claim
                await handleClaimUnlockedDepositedPositionFees({
                    swapCanisterId: position.swapCanisterId,
                    id: positionDetails.positionId,
                    symbols: position.token0Symbol + '/' + position.token1Symbol
                });
            }
        } else if (item.type === 'reward') {
            await handleClaimRewards(item.token);
        } else if (item.type === 'maturity') {
            await handleDisburseMaturity(item.token, item.neuronIdHex);
        }
    };

    const handleDisburseMaturity = async (token, neuronIdHex) => {
        const ledgerId = normalizeId(token.ledger_canister_id);
        const snsInfo = getSnsByLedgerId(ledgerId);
        if (!snsInfo) {
            throw new Error('SNS information not found for ledger: ' + ledgerId);
        }

        const governanceActor = createSnsGovernanceActor(snsInfo.canisters.governance, {
            agentOptions: { identity }
        });

        // Convert hex string to byte array (browser-compatible, no Buffer)
        const hexToBytes = (hex) => {
            const bytes = [];
            for (let i = 0; i < hex.length; i += 2) {
                bytes.push(parseInt(hex.substr(i, 2), 16));
            }
            return bytes;
        };
        const neuronId = { id: hexToBytes(neuronIdHex) };
        
        const result = await governanceActor.manage_neuron({
            subaccount: neuronId.id,
            command: [{
                DisburseMaturity: { 
                    to_account: [],
                    percentage_to_disburse: 100 
                }
            }]
        });

        if (result.command && result.command[0] && 'Error' in result.command[0]) {
            throw new Error(result.command[0].Error.error_message);
        }
    };

    const [isSneedLockExpanded, setIsSneedLockExpanded] = useState(() => {
        try {
            const saved = localStorage.getItem('sneedLockDisclaimerExpanded');
            return saved !== null ? JSON.parse(saved) : true; // Default to expanded
        } catch (error) {
            console.warn('Could not read disclaimer state from localStorage:', error);
            return true; // Default to expanded
        }
    });

    return (
        <div 
            className='page-container'
            style={{
                background: theme.colors.primaryGradient,
                color: theme.colors.primaryText,
                minHeight: '100vh'
            }}
        >
            <style>{`
                @media (max-width: 768px) {
                    .principal-full-text {
                        display: none !important;
                    }
                    .principal-short-text {
                        display: inline !important;
                    }
                    .breakdown-text-label {
                        display: none !important;
                    }
                    .wallet-help-text {
                        display: none !important;
                    }
                    .total-portfolio-label {
                        display: none !important;
                    }
                }
            `}</style>
            <style>{walletCustomStyles}</style>
            <Header />
            
            {/* Hero Section - Streamlined */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${walletPrimary}12 50%, ${walletSecondary}08 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '1.5rem',
                position: 'relative',
                overflow: 'hidden'
            }}>
                {/* Background decorations */}
                <div style={{
                    position: 'absolute',
                    top: '-60%',
                    right: '-5%',
                    width: '350px',
                    height: '350px',
                    background: `radial-gradient(circle, ${walletPrimary}15 0%, transparent 70%)`,
                    borderRadius: '50%',
                    pointerEvents: 'none'
                }} />
                
                <div style={{ maxWidth: '1200px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                    {/* Top Row: Title + Refresh */}
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '1rem',
                        marginBottom: '1.25rem'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                            <div style={{
                                width: '48px',
                                height: '48px',
                                borderRadius: '12px',
                                background: `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: `0 4px 16px ${walletPrimary}40`,
                                flexShrink: 0
                            }}>
                                <FaWallet size={22} color="white" />
                            </div>
                            <div>
                                <h1 style={{ 
                                    color: theme.colors.primaryText, 
                                    fontSize: '1.5rem', 
                                    fontWeight: '700', 
                                    margin: 0 
                                }}>
                                    Sneed Wallet
                                </h1>
                                <p style={{ 
                                    color: theme.colors.mutedText, 
                                    fontSize: '0.85rem', 
                                    margin: '0.15rem 0 0 0' 
                                }}>
                                    Tokens, liquidity & locked assets
                                </p>
                            </div>
                        </div>
                        
                        {/* Action Buttons */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Link 
                                to="/help/wallet"
                                style={{
                                    color: theme.colors.mutedText,
                                    textDecoration: 'none',
                                    fontSize: '0.8rem',
                                    fontWeight: '500',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.35rem',
                                    padding: '0.5rem 0.75rem',
                                    borderRadius: '8px',
                                    transition: 'all 0.2s ease',
                                    background: `${theme.colors.secondaryBg}`,
                                    border: `1px solid ${theme.colors.border}`
                                }}
                            >
                                <FaQuestionCircle size={12} />
                                <span>Help</span>
                            </Link>
                            {isAuthenticated && (
                                <button
                                    onClick={handleRefreshAllWallet}
                                    disabled={refreshingAllWallet}
                                    style={{
                                        background: `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})`,
                                        border: 'none',
                                        cursor: refreshingAllWallet ? 'default' : 'pointer',
                                        padding: '0.5rem 0.875rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        color: 'white',
                                        fontSize: '0.8rem',
                                        fontWeight: '600',
                                        borderRadius: '8px',
                                        transition: 'all 0.2s ease',
                                        opacity: refreshingAllWallet ? 0.7 : 1,
                                        boxShadow: `0 2px 10px ${walletPrimary}30`
                                    }}
                                    title="Refresh entire wallet"
                                >
                                    <FaSync size={11} style={{ animation: refreshingAllWallet ? 'walletSpin 1s linear infinite' : 'none' }} />
                                    Refresh
                                </button>
                            )}
                        </div>
                    </div>
                    
                    {/* Stats Row - Integrated cards */}
                    {isAuthenticated && (
                        <div style={{ 
                            display: 'grid', 
                            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                            gap: '0.75rem'
                        }}>
                            {/* Total Portfolio with Breakdown */}
                            {totalDollarValue && (
                                <div style={{
                                    background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, ${walletPrimary}08 100%)`,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: '12px',
                                    padding: '1rem 1.25rem',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.5rem'
                                }}>
                                    <div style={{ 
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}>
                                        <div style={{ 
                                            color: theme.colors.mutedText, 
                                            fontSize: '0.7rem', 
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px',
                                            fontWeight: '500'
                                        }}>
                                            Total Portfolio
                                        </div>
                                        {/* ICP Price inline */}
                                        {icpPrice && (
                                            <div style={{ 
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.3rem',
                                                color: theme.colors.secondaryText,
                                                fontSize: '0.75rem',
                                                fontWeight: '500'
                                            }}>
                                                <TokenIcon 
                                                    logo="https://swaprunner.com/icp_symbol.svg" 
                                                    alt="ICP" 
                                                    size={14} 
                                                />
                                                ${icpPrice.toFixed(2)}
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ 
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem'
                                    }}>
                                        <div style={{ 
                                            color: walletPrimary, 
                                            fontSize: '1.5rem', 
                                            fontWeight: '700'
                                        }}>
                                            ${totalDollarValue}
                                        </div>
                                        {/* Admin debug report button */}
                                        {isAdmin && (
                                            <button
                                                onClick={() => setShowDebugReportModal(true)}
                                                style={{
                                                    background: 'transparent',
                                                    border: `1px solid ${theme.colors.border}`,
                                                    borderRadius: '4px',
                                                    padding: '4px 6px',
                                                    cursor: 'pointer',
                                                    color: theme.colors.mutedText,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    fontSize: '0.7rem'
                                                }}
                                                title="Debug Report"
                                            >
                                                <FaBug size={10} />
                                            </button>
                                        )}
                                    </div>
                                    {/* Breakdown badges inside portfolio card */}
                                    {totalBreakdown && (totalBreakdown.liquid > 0 || totalBreakdown.staked > 0 || totalBreakdown.locked > 0 || totalBreakdown.liquidity > 0 || totalBreakdown.hasAnyRewards || totalBreakdown.hasAnyFees || totalBreakdown.hasAnyMaturity) && (
                                        <div style={{ 
                                            display: 'flex', 
                                            flexWrap: 'wrap', 
                                            gap: '0.4rem',
                                            fontSize: '0.7rem',
                                            borderTop: `1px solid ${theme.colors.border}`,
                                            paddingTop: '0.5rem',
                                            marginTop: '0.25rem'
                                        }}>
                                            {totalBreakdown.liquid > 0 && (
                                                <span style={{ 
                                                    color: theme.colors.secondaryText,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.2rem'
                                                }}>
                                                    <FaTint size={12} style={{ marginRight: '4px' }} /> ${totalBreakdown.liquid.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </span>
                                            )}
                                            {totalBreakdown.staked > 0 && (
                                                <span style={{ 
                                                    color: theme.colors.secondaryText,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.2rem'
                                                }}>
                                                    <FaBrain size={12} style={{ marginRight: '4px' }} /> ${totalBreakdown.staked.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </span>
                                            )}
                                            {totalBreakdown.locked > 0 && (
                                                <span style={{ 
                                                    color: theme.colors.secondaryText,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.2rem'
                                                }}>
                                                    <FaLock size={12} style={{ marginRight: '4px' }} /> ${totalBreakdown.locked.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </span>
                                            )}
                                            {totalBreakdown.liquidity > 0 && (
                                                <span style={{ 
                                                    color: theme.colors.secondaryText,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.2rem'
                                                }}>
                                                    <FaWater size={12} style={{ marginRight: '4px' }} /> ${totalBreakdown.liquidity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </span>
                                            )}
                                            {totalBreakdown.hasAnyMaturity && totalBreakdown.maturity > 0 && (
                                                <span style={{ 
                                                    color: theme.colors.secondaryText,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.2rem'
                                                }}>
                                                    <FaSeedling size={12} style={{ marginRight: '4px' }} /> ${totalBreakdown.maturity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </span>
                                            )}
                                            {totalBreakdown.hasAnyRewards && totalBreakdown.rewards > 0 && (
                                                <span style={{ 
                                                    color: theme.colors.secondaryText,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.2rem'
                                                }}>
                                                    <FaGift size={12} style={{ marginRight: '4px' }} /> ${totalBreakdown.rewards.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </span>
                                            )}
                                            {totalBreakdown.hasAnyFees && totalBreakdown.fees > 0 && (
                                                <span style={{ 
                                                    color: theme.colors.secondaryText,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.2rem'
                                                }}>
                                                    <FaMoneyBillWave size={12} style={{ marginRight: '4px' }} /> ${totalBreakdown.fees.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                            
                            {/* Collect Card - only show if there's something collectable above threshold (maturity requires permission) */}
                            {(totalBreakdown.hasAnyFees || totalBreakdown.hasAnyRewards || totalBreakdown.hasAnyCollectableMaturity) && 
                             (totalBreakdown.fees + totalBreakdown.rewards + totalBreakdown.collectableMaturity) >= collectiblesThreshold && (
                                <div style={{
                                    background: `linear-gradient(135deg, ${walletPrimary}15 0%, ${walletAccent}10 100%)`,
                                    border: `1px solid ${walletPrimary}30`,
                                    borderRadius: '12px',
                                    padding: '0.75rem 1rem',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.5rem'
                                }}>
                                    <div style={{ 
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: '0.5rem'
                                    }}>
                                        <div>
                                            <div style={{ 
                                                color: theme.colors.mutedText, 
                                                fontSize: '0.7rem', 
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.5px',
                                                fontWeight: '500'
                                            }}>
                                                Collect
                                            </div>
                                            <div style={{ 
                                                color: walletPrimary, 
                                                fontSize: '1.25rem', 
                                                fontWeight: '700'
                                            }}>
                                                ${(totalBreakdown.fees + totalBreakdown.rewards + totalBreakdown.collectableMaturity).toLocaleString(undefined, { 
                                                    minimumFractionDigits: 2, 
                                                    maximumFractionDigits: 2 
                                                })}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleOpenConsolidateModal('all')}
                                            style={{
                                                background: `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})`,
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '8px',
                                                padding: '0.5rem 0.875rem',
                                                cursor: 'pointer',
                                                fontSize: '0.75rem',
                                                fontWeight: '600',
                                                transition: 'all 0.2s ease',
                                                whiteSpace: 'nowrap',
                                                boxShadow: `0 2px 8px ${walletPrimary}30`
                                            }}
                                        >
                                            Collect All
                                        </button>
                                    </div>
                                    <div style={{ 
                                        display: 'flex', 
                                        flexWrap: 'wrap', 
                                        gap: '0.5rem',
                                        fontSize: '0.7rem'
                                    }}>
                                        {totalBreakdown.hasAnyFees && (
                                            <span 
                                                onClick={() => handleOpenConsolidateModal('fees')}
                                                style={{ 
                                                    color: theme.colors.secondaryText,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.2rem',
                                                    cursor: 'pointer',
                                                    padding: '0.2rem 0.4rem',
                                                    borderRadius: '4px',
                                                    transition: 'background 0.2s ease'
                                                }}
                                                onMouseEnter={(e) => e.target.style.background = `${walletPrimary}20`}
                                                onMouseLeave={(e) => e.target.style.background = 'transparent'}
                                            >
                                                <FaMoneyBillWave size={12} style={{ marginRight: '4px' }} /> ${totalBreakdown.fees.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </span>
                                        )}
                                        {totalBreakdown.hasAnyRewards && (
                                            <span 
                                                onClick={() => handleOpenConsolidateModal('rewards')}
                                                style={{ 
                                                    color: theme.colors.secondaryText,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.2rem',
                                                    cursor: 'pointer',
                                                    padding: '0.2rem 0.4rem',
                                                    borderRadius: '4px',
                                                    transition: 'background 0.2s ease'
                                                }}
                                                onMouseEnter={(e) => e.target.style.background = `${walletPrimary}20`}
                                                onMouseLeave={(e) => e.target.style.background = 'transparent'}
                                            >
                                                <FaGift size={12} style={{ marginRight: '4px' }} /> ${totalBreakdown.rewards.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </span>
                                        )}
                                        {totalBreakdown.hasAnyCollectableMaturity && (
                                            <span 
                                                onClick={() => handleOpenConsolidateModal('maturity')}
                                                style={{ 
                                                    color: theme.colors.secondaryText,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.2rem',
                                                    cursor: 'pointer',
                                                    padding: '0.2rem 0.4rem',
                                                    borderRadius: '4px',
                                                    transition: 'background 0.2s ease'
                                                }}
                                                onMouseEnter={(e) => e.target.style.background = `${walletPrimary}20`}
                                                onMouseLeave={(e) => e.target.style.background = 'transparent'}
                                            >
                                                <FaSeedling size={12} style={{ marginRight: '4px' }} /> ${totalBreakdown.collectableMaturity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}
                            
                            {/* Collect Error Message */}
                            {consolidateError && (
                                <div style={{
                                    background: `${theme.colors.error || '#ef4444'}15`,
                                    border: `1px solid ${theme.colors.error || '#ef4444'}40`,
                                    borderRadius: '10px',
                                    padding: '0.75rem 1rem',
                                    color: theme.colors.error || '#ef4444',
                                    fontSize: '0.85rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem'
                                }}>
                                    <FaExclamationTriangle size={14} style={{ color: '#f59e0b' }} />
                                    <span>{consolidateError}</span>
                                    <button
                                        onClick={() => setConsolidateError('')}
                                        style={{
                                            marginLeft: 'auto',
                                            background: 'none',
                                            border: 'none',
                                            color: theme.colors.error || '#ef4444',
                                            cursor: 'pointer',
                                            padding: '0.25rem',
                                            fontSize: '1rem',
                                            lineHeight: 1
                                        }}
                                    >
                                        ×
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div 
                className="wallet-container"
                style={{
                    backgroundColor: 'transparent'
                }}
            >
                {!isAuthenticated ? (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minHeight: '400px',
                        textAlign: 'center',
                        padding: '40px 20px'
                    }}>
                        <div style={{
                            background: theme.colors.cardGradient,
                            border: `1px solid ${theme.colors.border}`,
                            boxShadow: theme.colors.cardShadow,
                            borderRadius: '16px',
                            padding: '40px',
                            maxWidth: '500px',
                            width: '100%'
                        }}>
                            <h2 style={{ 
                                color: theme.colors.primaryText, 
                                marginBottom: '20px',
                                fontSize: '1.5rem'
                            }}>
                                <FaLock size={20} style={{ marginRight: '10px', verticalAlign: 'middle' }} /> Login Required
                            </h2>
                            <p style={{ 
                                color: theme.colors.secondaryText, 
                                marginBottom: '30px',
                                lineHeight: '1.6',
                                fontSize: '1.1rem'
                            }}>
                                Please log in to view and manage your wallet. Your tokens, locks, and liquidity positions will be displayed here.
                            </p>
                            <p style={{ 
                                color: theme.colors.mutedText, 
                                fontSize: '0.9rem',
                                marginBottom: '0'
                            }}>
                                Click the "Connect Wallet" button in the header to get started.
                            </p>
                        </div>
                    </div>
                ) : (
                    <>
                {/* Tab Bar for Wallet Sections */}
                <div style={{
                    background: theme.colors.secondaryBg,
                    borderRadius: '16px',
                    padding: '0.5rem',
                    marginBottom: '1.5rem',
                    display: 'flex',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                    border: `1px solid ${theme.colors.border}`
                }}>
                    {[
                        { id: 'tokens', label: 'Tokens', icon: <FaCoins size={14} />, subtitle: tokensTotal > 0 ? `$${tokensTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : null },
                        { id: 'positions', label: 'Liquidity', icon: <FaExchangeAlt size={14} />, subtitle: lpPositionsTotal > 0 ? `$${lpPositionsTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : null },
                        { id: 'dapps', label: 'Dapps', icon: <FaBox size={14} />, subtitle: (neuronManagers.length + trackedCanisters.length) > 0 ? `${neuronManagers.length + trackedCanisters.length}` : null }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveWalletTab(tab.id)}
                            style={{
                                flex: '1 1 auto',
                                minWidth: '120px',
                                padding: '0.75rem 1rem',
                                borderRadius: '12px',
                                border: 'none',
                                background: activeWalletTab === tab.id 
                                    ? `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})`
                                    : 'transparent',
                                color: activeWalletTab === tab.id ? 'white' : theme.colors.secondaryText,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.5rem',
                                fontSize: '0.9rem',
                                fontWeight: activeWalletTab === tab.id ? '600' : '500',
                                transition: 'all 0.2s ease',
                                boxShadow: activeWalletTab === tab.id ? `0 4px 15px ${walletPrimary}40` : 'none'
                            }}
                        >
                            {tab.icon}
                            <span>{tab.label}</span>
                            {tab.subtitle && (
                                <span style={{
                                    fontSize: '0.75rem',
                                    opacity: 0.9,
                                    fontWeight: '500',
                                    marginLeft: '0.25rem'
                                }}>
                                    ({tab.subtitle})
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Tokens Tab Content - Always render to ensure neurons load, but hide when not active */}
                <div style={{ display: activeWalletTab === 'tokens' ? 'block' : 'none' }}>
                    <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '1rem',
                        gap: '1rem',
                        flexWrap: 'wrap'
                    }}>
                        <h3 style={{ 
                            color: theme.colors.primaryText, 
                            fontSize: '1.1rem', 
                            fontWeight: '600',
                            margin: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                        }}>
                            <FaCoins size={16} color={walletPrimary} />
                            Tokens
                            {tokensTotal > 0 && (
                                <span style={{ color: walletPrimary, fontWeight: '500' }}>
                                    (${tokensTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                                </span>
                            )}
                        </h3>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <label 
                                style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '6px',
                                    cursor: 'pointer',
                                    fontSize: '0.85rem',
                                    color: hideDust ? walletPrimary : theme.colors.mutedText,
                                    padding: '0.5rem 0.75rem',
                                    borderRadius: '8px',
                                    background: hideDust ? `${walletPrimary}15` : 'transparent',
                                    border: `1px solid ${hideDust ? walletPrimary + '30' : 'transparent'}`,
                                    transition: 'all 0.2s ease'
                                }}
                                title="Hide tokens worth less than $0.01"
                            >
                                <input
                                    type="checkbox"
                                    checked={hideDust}
                                    onChange={(e) => setHideDust(e.target.checked)}
                                    style={{ 
                                        width: '14px', 
                                        height: '14px',
                                        cursor: 'pointer',
                                        accentColor: walletPrimary
                                    }}
                                />
                                Hide dust
                            </label>
                            <button
                                onClick={handleRefreshTokensSection}
                                disabled={refreshingTokensSection}
                                style={{
                                    background: `${walletPrimary}15`,
                                    color: walletPrimary,
                                    border: `1px solid ${walletPrimary}30`,
                                    borderRadius: '8px',
                                    padding: '0.5rem 0.75rem',
                                    cursor: refreshingTokensSection ? 'not-allowed' : 'pointer',
                                    fontSize: '0.85rem',
                                    fontWeight: '500',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem',
                                    transition: 'all 0.2s ease',
                                    opacity: refreshingTokensSection ? 0.6 : 1
                                }}
                            >
                                <FaSync size={12} style={{ animation: refreshingTokensSection ? 'walletSpin 1s linear infinite' : 'none' }} />
                                Refresh
                            </button>
                            <button
                                onClick={() => setShowAddLedgerModal(true)}
                                style={{
                                    background: `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})`,
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    padding: '0.5rem 1rem',
                                    cursor: 'pointer',
                                    fontSize: '0.85rem',
                                    fontWeight: '600',
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                + Add Token
                            </button>
                        </div>
                    </div>
                    <div className="card-grid">
                    {tokens
                        .filter(token => {
                            // If hideDust is enabled, filter by USD value
                            if (hideDust) {
                                const ledgerId = normalizeId(token.ledger_canister_id);
                                
                                // Calculate base token USD value (including neuron stake/maturity like PrincipalBox)
                                let usdValue = 0;
                                if (token.conversion_rate) {
                                    const available = BigInt(token.available || token.balance || 0n);
                                    const locked = BigInt(token.locked || 0n);
                                    const staked = BigInt(token.staked || 0n);
                                    const maturity = BigInt(token.maturity || 0n);
                                    const rewards = BigInt(token.rewards || 0n);
                                    // Include neuron stake/maturity directly from token (cached)
                                    const neuronStake = BigInt(token.neuronStake || 0n);
                                    const neuronMaturity = BigInt(token.neuronMaturity || 0n);
                                    const totalBalance = available + locked + staked + maturity + rewards + neuronStake + neuronMaturity;
                                    const balanceNum = Number(totalBalance) / (10 ** (token.decimals || 8));
                                    usdValue = balanceNum * token.conversion_rate;
                                }
                                
                                return usdValue >= 0.01;
                            }
                            return true;
                        })
                        .map((token, index) => {
                        // Convert Principal to string for comparison
                        const ledgerId = normalizeId(token.ledger_canister_id);
                        const isSns = snsTokens.has(ledgerId);
                        
                        return (
                            <TokenCard
                                key={index}
                                token={token}
                                locks={locks}
                                lockDetailsLoading={lockDetailsLoading}
                                showDebug={showDebug}
                                openSendModal={openSendModal}
                                openLockModal={openLockModal}
                                openWrapModal={openWrapModal}
                                openUnwrapModal={openUnwrapModal}
                                handleUnregisterToken={handleUnregisterToken}
                                rewardDetailsLoading={rewardDetailsLoading}
                                handleClaimRewards={handleClaimRewards}
                                handleWithdrawFromBackend={handleWithdrawFromBackend}
                                handleDepositToBackend={handleDepositToBackend}
                                handleRefreshToken={handleRefreshToken}
                                isRefreshing={refreshingTokens.has(ledgerId)}
                                isSnsToken={isSns}
                                onNeuronTotalsChange={(breakdown) => {
                                    setNeuronTotals(prev => ({
                                        ...prev,
                                        [ledgerId]: breakdown
                                    }));
                                }}
                                onNeuronsLoaded={(neurons) => {
                                    setSnsNeuronsByToken(prev => ({
                                        ...prev,
                                        [ledgerId]: neurons
                                    }));
                                }}
                                openTransferTokenLockModal={openTransferTokenLockModal}
                                onOpenDetailModal={openTokenDetailModal}
                            />
                        );
                    })}
                    {showTokensSpinner ? (
                        <div className="card">
                            <div className="spinner"></div>
                        </div>
                    ) : (
                        <div/>
                    )}
                </div>
                </div>

                {/* Liquidity Positions Tab Content */}
                {activeWalletTab === 'positions' && (
                    <>
                    <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '1rem',
                        gap: '1rem',
                        flexWrap: 'wrap'
                    }}>
                        <h3 style={{ 
                            color: theme.colors.primaryText, 
                            fontSize: '1.1rem', 
                            fontWeight: '600',
                            margin: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                        }}>
                            <FaExchangeAlt size={16} color={walletPrimary} />
                            Liquidity Positions
                            {lpPositionsTotal > 0 && (
                                <span style={{ color: walletPrimary, fontWeight: '500' }}>
                                    (${lpPositionsTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                                </span>
                            )}
                        </h3>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                                onClick={handleRefreshPositionsSection}
                                disabled={refreshingPositionsSection}
                                style={{
                                    background: `${walletPrimary}15`,
                                    color: walletPrimary,
                                    border: `1px solid ${walletPrimary}30`,
                                    borderRadius: '8px',
                                    padding: '0.5rem 0.75rem',
                                    cursor: refreshingPositionsSection ? 'not-allowed' : 'pointer',
                                    fontSize: '0.85rem',
                                    fontWeight: '500',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem',
                                    transition: 'all 0.2s ease',
                                    opacity: refreshingPositionsSection ? 0.6 : 1
                                }}
                            >
                                <FaSync size={12} style={{ animation: refreshingPositionsSection ? 'walletSpin 1s linear infinite' : 'none' }} />
                                Refresh
                            </button>
                            <button
                                onClick={() => setShowAddSwapModal(true)}
                                style={{
                                    background: `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})`,
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    padding: '0.5rem 1rem',
                                    cursor: 'pointer',
                                    fontSize: '0.85rem',
                                    fontWeight: '600',
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                + Add Swap Pair
                            </button>
                        </div>
                    </div>
                    <div className="card-grid">                
                    {liquidityPositions.map((position, index) => {
                        const normalizedSwapId = normalizeId(position.swapCanisterId);
                        return (
                        position.positions.length < 1 
                        ? <EmptyPositionCard 
                            key={index} 
                            position={position} 
                            onRemove={() => handleUnregisterSwapCanister(position.swapCanisterId)}
                            handleRefreshPosition={handleRefreshPosition}
                            isRefreshing={refreshingPositions.has(normalizedSwapId)}
                            theme={theme}
                          />

                        : position.positions.map((positionDetails, positionIndex) => (
                            <PositionCard
                                key={`${index}-${positionIndex}`}
                                position={position}
                                positionDetails={positionDetails}
                                openSendLiquidityPositionModal={openSendLiquidityPositionModal}
                                openLockPositionModal={openLockPositionModal}
                                handleWithdrawPositionRewards={handleWithdrawPositionRewards}
                                handleClaimLockedPositionFees={handleClaimLockedPositionFees}
                                handleClaimUnlockedDepositedPositionFees={handleClaimUnlockedDepositedPositionFees}
                                handleWithdrawPosition={handleWithdrawPosition}
                                handleWithdrawSwapBalance={handleWithdrawSwapBalance}
                                handleTransferPositionOwnership={handleSendLiquidityPosition}
                                handleRefreshPosition={handleRefreshPosition}
                                isRefreshing={refreshingPositions.has(normalizedSwapId)}
                                swapCanisterBalance0={position.swapCanisterBalance0}
                                swapCanisterBalance1={position.swapCanisterBalance1}
                                token0Fee={position.token0Fee}
                                token1Fee={position.token1Fee}
                                hideButtons={false}
                                hideUnclaimedFees={false}
                            />
                        ))
                    );})}
                    {showPositionsSpinner ? (
                        <div className="card">
                            <div className="spinner"></div>
                        </div>
                    ) : (
                        <div/>
                    )}
                </div>
                </>
                )}

                {/* Dapps Tab Content - Neuron Managers and Canisters combined */}
                {activeWalletTab === 'dapps' && (
                    <div style={{ marginBottom: '20px' }}>
                        {/* Link to manage canisters */}
                        <div style={{ marginBottom: '16px' }}>
                            <Link 
                                to="/canisters" 
                                style={{ color: walletPrimary, fontSize: '13px', textDecoration: 'none' }}
                                onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                            >
                                Manage canister groups <FaArrowRight size={10} style={{ marginLeft: '4px' }} />
                            </Link>
                        </div>

                        {/* ICP Neuron Managers Section */}
                        <div style={{ 
                            backgroundColor: theme.colors.secondaryBg, 
                            borderRadius: '12px', 
                            padding: '16px',
                            marginBottom: '16px'
                        }}>
                            <div 
                                style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    cursor: 'pointer',
                                    marginBottom: neuronManagersExpanded ? '12px' : 0
                                }}
                                onClick={() => setNeuronManagersExpanded(!neuronManagersExpanded)}
                            >
                                <h3 style={{ 
                                    color: theme.colors.primaryText, 
                                    fontSize: '1rem', 
                                    fontWeight: '600',
                                    margin: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem'
                                }}>
                                    {neuronManagersExpanded ? <FaChevronDown size={12} /> : <FaChevronRight size={12} />}
                                    <FaBrain size={16} color="#8b5cf6" />
                                    ICP Neuron Managers
                                    {neuronManagers.length > 0 && (
                                        <span style={{ color: '#8b5cf6', fontWeight: '500' }}>
                                            ({neuronManagers.length})
                                            {managerNeuronsTotal > 0 && icpPrice && (
                                                <span style={{ marginLeft: '0.25rem' }}>
                                                    • ${(managerNeuronsTotal * icpPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </span>
                                            )}
                                        </span>
                                    )}
                                </h3>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleRefreshNeuronManagers(); }}
                                        disabled={refreshingNeuronManagers}
                                        style={{
                                            background: `${walletPrimary}15`,
                                            color: walletPrimary,
                                            border: `1px solid ${walletPrimary}30`,
                                            borderRadius: '8px',
                                            padding: '0.4rem 0.6rem',
                                            cursor: refreshingNeuronManagers ? 'not-allowed' : 'pointer',
                                            fontSize: '0.8rem',
                                            fontWeight: '500',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.3rem',
                                            transition: 'all 0.2s ease',
                                            opacity: refreshingNeuronManagers ? 0.6 : 1
                                        }}
                                    >
                                        <FaSync size={10} style={{ animation: refreshingNeuronManagers ? 'walletSpin 1s linear infinite' : 'none' }} />
                                        Refresh
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); navigate('/create_icp_neuron'); }}
                                        style={{
                                            background: `linear-gradient(135deg, #8b5cf6, #7c3aed)`,
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '8px',
                                            padding: '0.4rem 0.8rem',
                                            cursor: 'pointer',
                                            fontSize: '0.8rem',
                                            fontWeight: '600',
                                            transition: 'all 0.2s ease'
                                        }}
                                    >
                                        + Create
                                    </button>
                                </div>
                            </div>
                            {neuronManagersExpanded && (
                            <>
                        {/* Learn how it works link */}
                        <div style={{ marginBottom: '12px' }}>
                            <Link 
                                to="/help/icp-neuron-manager" 
                                style={{ color: walletPrimary, fontSize: '13px', textDecoration: 'none' }}
                                onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                            >
                                Learn how it works <FaArrowRight size={10} style={{ marginLeft: '4px' }} />
                            </Link>
                        </div>
                        {/* Add existing manager input */}
                        <div style={{ 
                            backgroundColor: theme.colors.secondaryBg, 
                            borderRadius: '8px', 
                            padding: '12px 16px',
                            marginBottom: '12px',
                            display: 'flex',
                            gap: '10px',
                            alignItems: 'center',
                            flexWrap: 'wrap'
                        }}>
                            <PrincipalInput
                                value={registerManagerId}
                                onChange={(v) => {
                                    setRegisterManagerId(v);
                                    setRegisterManagerError('');
                                }}
                                placeholder="Add existing manager by canister ID"
                                style={{ flex: 1, minWidth: '200px', maxWidth: 'none' }}
                                inputStyle={{ fontFamily: 'monospace', fontSize: '13px' }}
                                disabled={registeringManager}
                            />
                            <button
                                onClick={async () => {
                                    if (!registerManagerId.trim()) return;
                                    let canisterId;
                                    try {
                                        canisterId = Principal.fromText(registerManagerId.trim());
                                    } catch (e) {
                                        setRegisterManagerError('Invalid canister ID format');
                                        return;
                                    }
                                    setRegisteringManager(true);
                                    const result = await handleRegisterManager(canisterId);
                                    setRegisteringManager(false);
                                    if (result.success) {
                                        setRegisterManagerId('');
                                    } else {
                                        setRegisterManagerError(result.error);
                                    }
                                }}
                                disabled={registeringManager || !registerManagerId.trim()}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    backgroundColor: (registeringManager || !registerManagerId.trim()) ? theme.colors.mutedText : theme.colors.accent,
                                    color: '#fff',
                                    fontSize: '13px',
                                    fontWeight: '600',
                                    cursor: (registeringManager || !registerManagerId.trim()) ? 'not-allowed' : 'pointer',
                                    opacity: (registeringManager || !registerManagerId.trim()) ? 0.6 : 1,
                                }}
                            >
                                {registeringManager ? '...' : '+ Add'}
                            </button>
                        </div>
                        {registerManagerError && (
                            <div style={{ 
                                color: '#ef4444', 
                                fontSize: '12px', 
                                marginBottom: '12px',
                                marginTop: '-8px',
                                padding: '0 4px'
                            }}>
                                {registerManagerError}
                            </div>
                        )}
                        {deregisterManagerError && (
                            <div style={{ 
                                background: `${theme.colors.error || '#ef4444'}15`,
                                border: `1px solid ${theme.colors.error || '#ef4444'}40`,
                                borderRadius: '8px',
                                padding: '0.6rem 0.75rem',
                                color: theme.colors.error || '#ef4444',
                                fontSize: '12px',
                                marginBottom: '12px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '0.5rem'
                            }}>
                                <span>{deregisterManagerError}</span>
                                <button
                                    onClick={() => setDeregisterManagerError('')}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: theme.colors.error || '#ef4444',
                                        cursor: 'pointer',
                                        padding: '2px 6px',
                                        fontSize: '14px',
                                        lineHeight: 1
                                    }}
                                >
                                    ×
                                </button>
                            </div>
                        )}
                        
                        {neuronManagersLoading ? (
                            <div className="card">
                                <div className="spinner"></div>
                            </div>
                        ) : neuronManagers.length === 0 ? (
                            <div style={{ 
                                backgroundColor: theme.colors.secondaryBg, 
                                borderRadius: '8px', 
                                padding: '24px',
                                textAlign: 'center'
                            }}>
                                <p style={{ color: theme.colors.mutedText, marginBottom: '16px' }}>
                                    No ICP Neuron Managers found.
                                </p>
                                <Link 
                                    to="/create_icp_neuron"
                                    style={{
                                        background: theme.colors.accent,
                                        color: '#fff',
                                        padding: '10px 20px',
                                        borderRadius: '8px',
                                        textDecoration: 'none',
                                        fontSize: '14px',
                                        fontWeight: '600',
                                    }}
                                >
                                    Create Your First Manager <FaArrowRight size={10} style={{ marginLeft: '4px' }} />
                                </Link>
                            </div>
                        ) : (
                            <div className="card-grid">
                                {neuronManagers.map((manager) => {
                                    const canisterId = normalizeId(manager.canisterId);
                                    const neuronCount = neuronManagerCounts[canisterId];
                                    const isExpanded = expandedManagerCards[canisterId];
                                    const neuronsData = managerNeurons[canisterId];
                                    const displayInfo = getPrincipalDisplayInfoFromContext(canisterId, principalNames, principalNicknames);
                                    
                                    // Check if this manager has a valid WASM hash
                                    const managerModuleHash = neuronManagerModuleHash[canisterId];
                                    const hasMatchingWasm = managerModuleHash && isKnownNeuronManagerHash(managerModuleHash);
                                    const isValidManager = manager.version && hasMatchingWasm;
                                    
                                    // Calculate total ICP value for this manager (stake + maturity)
                                    let managerTotalIcp = 0;
                                    let managerTotalMaturity = 0;
                                    if (neuronsData?.neurons) {
                                        neuronsData.neurons.forEach(neuron => {
                                            if (neuron.info) managerTotalIcp += Number(neuron.info.stake_e8s || 0) / 1e8;
                                            if (neuron.full) {
                                                const maturity = Number(neuron.full.maturity_e8s_equivalent || 0) / 1e8;
                                                const stakedMaturity = neuron.full.staked_maturity_e8s_equivalent?.[0] 
                                                    ? Number(neuron.full.staked_maturity_e8s_equivalent[0]) / 1e8 
                                                    : 0;
                                                managerTotalMaturity += maturity + stakedMaturity;
                                                managerTotalIcp += maturity + stakedMaturity;
                                            }
                                        });
                                    }
                                    const hasMaturity = managerTotalMaturity > 0;
                                    
                                    return (
                                        <div 
                                            key={canisterId}
                                            className="card"
                                        >
                                            {/* Card Header - Similar to TokenCard */}
                                            <div 
                                                className="card-header"
                                                onClick={() => toggleManagerCard(canisterId)}
                                            >
                                                <div className="header-logo-column" style={{ alignSelf: 'flex-start', minWidth: '48px', minHeight: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                                                    <FaBrain size={36} style={{ color: isValidManager === false ? '#ef4444' : theme.colors.mutedText }} />
                                                    {neuronManagerIsController[canisterId] && (
                                                        <span 
                                                            style={{ 
                                                                position: 'absolute', 
                                                                top: 0, 
                                                                right: 0,
                                                                color: theme.colors.accent
                                                            }}
                                                            title="You are a controller"
                                                        >
                                                            <FaCrown size={14} />
                                                        </span>
                                                    )}
                                                    {officialVersions.length > 0 && !isValidManager && (
                                                        <span 
                                                            style={{ 
                                                                position: 'absolute', 
                                                                bottom: 0, 
                                                                right: 0,
                                                                color: '#ef4444'
                                                            }}
                                                            title="WASM hash doesn't match any official neuron manager version"
                                                        >
                                                            <FaExclamationTriangle size={14} />
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="header-content-column">
                                                    {/* Row 1: Name, USD value, and Refresh */}
                                                    <div className="header-row-1" style={{ minWidth: 0 }}>
                                                        <span className="token-name">
                                                            <PrincipalDisplay
                                                                principal={canisterId}
                                                                displayInfo={displayInfo}
                                                                showCopyButton={false}
                                                                isAuthenticated={isAuthenticated}
                                                                noLink={true}
                                                            />
                                                        </span>
                                                        <span className="token-usd-value">
                                                            {managerTotalIcp > 0 && icpPrice && 
                                                                `$${(managerTotalIcp * icpPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                                            }
                                                        </span>
                                                        <button
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                await handleRefreshManagerCard(canisterId);
                                                            }}
                                                            disabled={refreshingManagerCard === canisterId}
                                                            style={{
                                                                background: 'none',
                                                                border: 'none',
                                                                cursor: refreshingManagerCard === canisterId ? 'default' : 'pointer',
                                                                padding: '4px',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                color: theme.colors.mutedText,
                                                                fontSize: '1.2rem',
                                                                transition: 'color 0.2s ease',
                                                                opacity: refreshingManagerCard === canisterId ? 0.6 : 1
                                                            }}
                                                            onMouseEnter={(e) => refreshingManagerCard !== canisterId && (e.target.style.color = theme.colors.primaryText)}
                                                            onMouseLeave={(e) => refreshingManagerCard !== canisterId && (e.target.style.color = theme.colors.mutedText)}
                                                            title="Refresh manager data"
                                                        >
                                                            <FaSync size={12} style={{ animation: refreshingManagerCard === canisterId ? 'spin 1s linear infinite' : 'none' }} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                openDappDetailModal({
                                                                    canisterId,
                                                                    isNeuronManager: true,
                                                                    neuronManagerVersion: manager.version,
                                                                    neuronCount: neuronCount || 0,
                                                                    cycles: neuronManagerCycles[canisterId],
                                                                    memory: neuronManagerMemory[canisterId],
                                                                    isController: neuronManagerControllers[canisterId],
                                                                    neuronsData: neuronsData,
                                                                });
                                                            }}
                                                            style={{
                                                                background: 'none',
                                                                border: 'none',
                                                                cursor: 'pointer',
                                                                padding: '4px',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                color: theme.colors.mutedText,
                                                                transition: 'color 0.2s ease',
                                                            }}
                                                            onMouseEnter={(e) => e.target.style.color = theme.colors.primaryText}
                                                            onMouseLeave={(e) => e.target.style.color = theme.colors.mutedText}
                                                            title="Open in dialog"
                                                        >
                                                            <FaExpand size={12} />
                                                        </button>
                                                    </div>
                                                    {/* Row 2: Total ICP amount */}
                                                    <div className="header-row-2">
                                                        <div className="amount-symbol">
                                                            <span className="token-amount">
                                                                {managerTotalIcp > 0 
                                                                    ? `${managerTotalIcp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ICP`
                                                                    : `${neuronCount || 0} neuron${neuronCount !== 1 ? 's' : ''}`
                                                                }
                                                            </span>
                                                        </div>
                                                    </div>
                                                    {/* Row 3: Version, cycles, and icons */}
                                                    <div className="header-row-3" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span 
                                                            style={{
                                                                background: isVersionOutdated(manager.version) ? '#f59e0b20' : (theme.colors.tertiaryBg || theme.colors.primaryBg),
                                                                color: isVersionOutdated(manager.version) ? '#f59e0b' : theme.colors.mutedText,
                                                                padding: '2px 8px',
                                                                borderRadius: '12px',
                                                                fontSize: '0.7rem',
                                                                fontWeight: '500',
                                                            }}
                                                            title={isVersionOutdated(manager.version) 
                                                                ? `Newer version available: v${Number(latestOfficialVersion.major)}.${Number(latestOfficialVersion.minor)}.${Number(latestOfficialVersion.patch)}`
                                                                : undefined
                                                            }
                                                        >
                                                            {isVersionOutdated(manager.version) && <FaExclamationTriangle size={10} style={{ marginRight: '4px', color: '#f59e0b' }} />}
                                                            {manager.version ? `v${Number(manager.version.major)}.${Number(manager.version.minor)}.${Number(manager.version.patch)}` : '...'}
                                                        </span>
                                                        {/* Cycles badge */}
                                                        {neuronManagerCycles[canisterId] !== undefined && neuronManagerCycles[canisterId] !== null && (
                                                            <span 
                                                                style={{
                                                                    background: `${getCyclesColor(neuronManagerCycles[canisterId], neuronManagerCycleSettings)}20`,
                                                                    color: getCyclesColor(neuronManagerCycles[canisterId], neuronManagerCycleSettings),
                                                                    padding: '2px 8px',
                                                                    borderRadius: '12px',
                                                                    fontSize: '0.7rem',
                                                                    fontWeight: '500',
                                                                }}
                                                                title={`${neuronManagerCycles[canisterId].toLocaleString()} cycles`}
                                                            >
                                                                ⚡ {formatCyclesCompact(neuronManagerCycles[canisterId])}
                                                            </span>
                                                        )}
                                                        {/* Memory badge */}
                                                        {neuronManagerMemory[canisterId] !== undefined && neuronManagerMemory[canisterId] !== null && (
                                                            <span 
                                                                style={{
                                                                    background: `${theme.colors.accent}20`,
                                                                    color: theme.colors.accent,
                                                                    padding: '2px 8px',
                                                                    borderRadius: '12px',
                                                                    fontSize: '0.7rem',
                                                                    fontWeight: '500',
                                                                }}
                                                                title={`${neuronManagerMemory[canisterId].toLocaleString()} bytes`}
                                                            >
                                                                💾 {formatMemory(neuronManagerMemory[canisterId])}
                                                            </span>
                                                        )}
                                                        {/* Maturity icon */}
                                                        {hasMaturity && (
                                                            <span 
                                                                style={{
                                                                    background: '#10B98120',
                                                                    color: '#10B981',
                                                                    padding: '2px 8px',
                                                                    borderRadius: '12px',
                                                                    fontSize: '0.7rem',
                                                                    fontWeight: '500',
                                                                    cursor: 'help',
                                                                }} 
                                                                title={`${managerTotalMaturity.toFixed(4)} ICP maturity available`}
                                                            >
                                                                <FaSeedling size={12} style={{ marginRight: '4px' }} /> {managerTotalMaturity.toFixed(2)}
                                                            </span>
                                                        )}
                                                        {/* Neurons icon */}
                                                        {neuronCount > 0 && (
                                                            <span 
                                                                style={{ fontSize: '14px', cursor: 'help', display: 'flex', alignItems: 'center', color: theme.colors.mutedText }} 
                                                                title={`${neuronCount} neuron${neuronCount > 1 ? 's' : ''}`}
                                                            >
                                                                <FaBrain size={12} />
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            {/* Expanded Section */}
                                            {isExpanded && (
                                                <div className="card-content">
                                                    {/* First Row: Send button (right-aligned) */}
                                                    {neuronManagerIsController[canisterId] && (
                                                        <div style={{ 
                                                            display: 'flex', 
                                                            justifyContent: 'flex-end',
                                                            marginBottom: '12px'
                                                        }}>
                                                            <button
                                                                onClick={() => {
                                                                    setTransferTargetManager(manager);
                                                                    setTransferRecipient('');
                                                                    setTransferError('');
                                                                    setTransferSuccess('');
                                                                    setTransferModalOpen(true);
                                                                }}
                                                                style={{
                                                                    background: theme.colors.accent,
                                                                    color: theme.colors.primaryBg,
                                                                    border: 'none',
                                                                    borderRadius: '6px',
                                                                    padding: '6px 12px',
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.85rem',
                                                                    fontWeight: '500',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px',
                                                                    transition: 'all 0.2s ease'
                                                                }}
                                                                onMouseEnter={(e) => {
                                                                    e.target.style.background = theme.colors.accentHover;
                                                                }}
                                                                onMouseLeave={(e) => {
                                                                    e.target.style.background = theme.colors.accent;
                                                                }}
                                                            >
                                                                <img 
                                                                    src="send-inverted.png" 
                                                                    alt="Send" 
                                                                    style={{ width: '14px', height: '14px' }}
                                                                />
                                                                Send
                                                            </button>
                                                        </div>
                                                    )}
                                                    
                                                    {/* Canister Info */}
                                                    <div style={{ 
                                                        padding: '12px 16px',
                                                        backgroundColor: theme.colors.tertiaryBg || 'rgba(0,0,0,0.05)',
                                                        borderRadius: '8px',
                                                        marginBottom: '12px',
                                                    }}>
                                                        <div style={{ 
                                                            display: 'flex', 
                                                            justifyContent: 'space-between', 
                                                            alignItems: 'center',
                                                            flexWrap: 'wrap',
                                                            gap: '12px'
                                                        }}>
                                                            <div>
                                                                <div style={{ color: theme.colors.mutedText, fontSize: '11px', marginBottom: '2px' }}>Canister ID</div>
                                                                <div style={{ 
                                                                    color: theme.colors.secondaryText, 
                                                                    fontFamily: 'monospace', 
                                                                    fontSize: '12px',
                                                                }}>
                                                                    {canisterId}
                                                                </div>
                                                            </div>
                                                            <div style={{ textAlign: 'center' }}>
                                                                <div style={{ color: theme.colors.mutedText, fontSize: '10px', textTransform: 'uppercase' }}>Neurons</div>
                                                                <div style={{ 
                                                                    color: neuronCount > 0 ? (theme.colors.success || '#22c55e') : theme.colors.warning || '#f59e0b',
                                                                    fontWeight: '600',
                                                                    fontSize: '13px'
                                                                }}>
                                                                    {neuronCount !== null && neuronCount !== undefined ? neuronCount : '...'}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    
                                                    {/* Neurons List */}
                                                    {neuronsData?.loading ? (
                                                        <div style={{ 
                                                            display: 'flex', 
                                                            alignItems: 'center', 
                                                            justifyContent: 'center',
                                                            padding: '20px',
                                                            gap: '10px'
                                                        }}>
                                                            <div className="spinner" style={{ width: '20px', height: '20px' }}></div>
                                                            <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>Loading neurons...</span>
                                                        </div>
                                                    ) : neuronsData?.error ? (
                                                        <div style={{ 
                                                            padding: '16px', 
                                                            display: 'flex', 
                                                            flexDirection: 'column',
                                                            alignItems: 'center',
                                                            gap: '8px',
                                                            textAlign: 'center'
                                                        }}>
                                                            <FaExclamationTriangle size={20} style={{ color: theme.colors.warning || '#f59e0b' }} />
                                                            <span style={{ color: theme.colors.warning || '#f59e0b', fontSize: '13px', fontWeight: '500' }}>
                                                                Unable to load neurons
                                                            </span>
                                                            <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                                                This canister may not be a compatible neuron manager
                                                            </span>
                                                            <Link 
                                                                to={`/canister?id=${canisterId}`} 
                                                                style={{ 
                                                                    color: theme.colors.accent, 
                                                                    fontSize: '12px',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '4px',
                                                                    marginTop: '4px'
                                                                }}
                                                            >
                                                                View canister details <FaArrowRight size={10} />
                                                            </Link>
                                                        </div>
                                                    ) : neuronsData?.neurons?.length === 0 ? (
                                                        <div style={{ 
                                                            color: theme.colors.mutedText, 
                                                            fontSize: '13px', 
                                                            textAlign: 'center',
                                                            padding: '16px' 
                                                        }}>
                                                            No neurons found. <Link to={`/icp_neuron_manager/${canisterId}`} style={{ color: theme.colors.accent, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>Stake ICP <FaArrowRight size={10} /></Link>
                                                        </div>
                                                    ) : (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                            {neuronsData?.neurons?.map((neuron) => {
                                                                const stake = neuron.info ? Number(neuron.info.stake_e8s || 0) / 1e8 : 0;
                                                                const maturity = neuron.full ? Number(neuron.full.maturity_e8s_equivalent || 0) / 1e8 : 0;
                                                                const stakedMaturity = neuron.full?.staked_maturity_e8s_equivalent?.[0] 
                                                                    ? Number(neuron.full.staked_maturity_e8s_equivalent[0]) / 1e8 
                                                                    : 0;
                                                                const totalNeuronIcp = stake + maturity + stakedMaturity;
                                                                const stateNum = neuron.info?.state;
                                                                const stateLabel = stateNum === 1 ? 'Locked' 
                                                                    : stateNum === 2 ? 'Dissolving' 
                                                                    : stateNum === 3 ? 'Dissolved' 
                                                                    : 'Unknown';
                                                                const stateColor = stateNum === 1 ? (theme.colors.success || '#22c55e')
                                                                    : stateNum === 2 ? (theme.colors.warning || '#f59e0b')
                                                                    : stateNum === 3 ? (theme.colors.accent || '#3b82f6')
                                                                    : theme.colors.mutedText;
                                                                const stateIcon = stateNum === 1 ? <FaLock size={12} /> : stateNum === 2 ? <FaHourglassHalf size={12} /> : stateNum === 3 ? <FaCheck size={12} /> : <FaQuestionCircle size={12} />;
                                                                
                                                                const neuronIdStr = neuron.id?.id?.toString() || neuron.id?.toString() || 'Unknown';
                                                                const neuronExpandKey = `${canisterId}:${neuronIdStr}`;
                                                                const isNeuronExpanded = expandedNeuronsInManager[neuronExpandKey];
                                                                
                                                                // Get additional neuron details
                                                                const dissolveDelay = neuron.info?.dissolve_delay_seconds ? Number(neuron.info.dissolve_delay_seconds) : 0;
                                                                const votingPower = neuron.info?.voting_power ? Number(neuron.info.voting_power) / 1e8 : 0;
                                                                const age = neuron.info?.age_seconds ? Number(neuron.info.age_seconds) : 0;
                                                                const autoStakeMaturity = neuron.full?.auto_stake_maturity?.[0] || false;
                                                                
                                                                return (
                                                                    <div 
                                                                        key={neuronIdStr}
                                                                        style={{
                                                                            borderRadius: '8px',
                                                                            border: `1px solid ${theme.colors.border}`,
                                                                            overflow: 'hidden',
                                                                        }}
                                                                    >
                                                                        {/* Neuron Header - Click to expand */}
                                                                        <div 
                                                                            onClick={() => setExpandedNeuronsInManager(prev => ({
                                                                                ...prev,
                                                                                [neuronExpandKey]: !prev[neuronExpandKey]
                                                                            }))}
                                                                            style={{
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                justifyContent: 'space-between',
                                                                                padding: '10px 12px',
                                                                                backgroundColor: theme.colors.secondaryBg,
                                                                                cursor: 'pointer',
                                                                                transition: 'background 0.2s ease',
                                                                            }}
                                                                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.colors.tertiaryBg || theme.colors.primaryBg}
                                                                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = theme.colors.secondaryBg}
                                                                        >
                                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                                                                                <div style={{ 
                                                                                    color: theme.colors.primaryText, 
                                                                                    fontWeight: '500',
                                                                                    fontSize: '0.9rem'
                                                                                }}>
                                                                                    Neuron #{neuronIdStr.slice(-8)}...
                                                                                </div>
                                                                                <div style={{ 
                                                                                    color: theme.colors.accent, 
                                                                                    fontWeight: '600',
                                                                                    fontSize: '0.95rem'
                                                                                }}>
                                                                                    {stake.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ICP
                                                                                    {icpPrice && (
                                                                                        <span style={{ color: theme.colors.mutedText, fontWeight: '400', fontSize: '0.85rem', marginLeft: '6px' }}>
                                                                                            (${(stake * icpPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                {/* Maturity indicator */}
                                                                                {maturity > 0 && (
                                                                                    <span 
                                                                                        style={{ cursor: 'help', display: 'flex', alignItems: 'center', color: theme.colors.mutedText }} 
                                                                                        title={`${maturity.toFixed(4)} ICP maturity`}
                                                                                    >
                                                                                        <FaSeedling size={12} />
                                                                                    </span>
                                                                                )}
                                                                                {/* State icon */}
                                                                                <span 
                                                                                    style={{ fontSize: '1.1rem', cursor: 'help' }}
                                                                                    title={stateLabel}
                                                                                >
                                                                                    {stateIcon}
                                                                                </span>
                                                                                {/* Expand indicator */}
                                                                                <span style={{ 
                                                                                    color: theme.colors.mutedText, 
                                                                                    fontSize: '1rem',
                                                                                    transform: isNeuronExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                                                                    transition: 'transform 0.2s ease'
                                                                                }}>
                                                                                    ▼
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                        
                                                                        {/* Expanded Neuron Details */}
                                                                        {isNeuronExpanded && (
                                                                            <div style={{
                                                                                padding: '12px',
                                                                                background: theme.colors.primaryBg,
                                                                                borderTop: `1px solid ${theme.colors.border}`
                                                                            }}>
                                                                                {/* Manage button row */}
                                                                                <div style={{ 
                                                                                    display: 'flex',
                                                                                    justifyContent: 'flex-end',
                                                                                    gap: '8px',
                                                                                    marginBottom: '12px',
                                                                                    paddingBottom: '12px',
                                                                                    borderBottom: `1px solid ${theme.colors.border}`
                                                                                }}>
                                                                                    <Link
                                                                                        to={`/icp_neuron_manager/${canisterId}`}
                                                                                        style={{
                                                                                            background: theme.colors.secondaryBg,
                                                                                            color: theme.colors.primaryText,
                                                                                            border: `1px solid ${theme.colors.border}`,
                                                                                            borderRadius: '6px',
                                                                                            padding: '6px 12px',
                                                                                            textDecoration: 'none',
                                                                                            fontSize: '0.85rem',
                                                                                            fontWeight: '500',
                                                                                            display: 'inline-flex',
                                                                                            alignItems: 'center',
                                                                                            gap: '6px',
                                                                                        }}
                                                                                    >
                                                                                        <FaCog size={10} style={{ marginRight: '4px' }} /> Manage
                                                                                    </Link>
                                                                                    <a
                                                                                        href={`https://dashboard.internetcomputer.org/neuron/${neuronIdStr}`}
                                                                                        target="_blank"
                                                                                        rel="noopener noreferrer"
                                                                                        style={{
                                                                                            background: theme.colors.secondaryBg,
                                                                                            color: theme.colors.primaryText,
                                                                                            border: `1px solid ${theme.colors.border}`,
                                                                                            borderRadius: '6px',
                                                                                            padding: '6px 12px',
                                                                                            textDecoration: 'none',
                                                                                            fontSize: '0.85rem',
                                                                                            fontWeight: '500',
                                                                                            display: 'inline-flex',
                                                                                            alignItems: 'center',
                                                                                            gap: '6px',
                                                                                        }}
                                                                                    >
                                                                                        <FaExternalLinkAlt size={10} style={{ marginRight: '4px' }} /> Dashboard
                                                                                    </a>
                                                                                </div>
                                                                                
                                                                                {/* Neuron Details */}
                                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.9rem' }}>
                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                                        <span style={{ color: theme.colors.secondaryText }}>Neuron ID:</span>
                                                                                        <span style={{ color: theme.colors.primaryText, fontFamily: 'monospace', fontSize: '0.8rem' }}>
                                                                                            {neuronIdStr}
                                                                                        </span>
                                                                                    </div>
                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                                        <span style={{ color: theme.colors.secondaryText }}>Stake:</span>
                                                                                        <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                                                                                            {stake.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ICP
                                                                                        </span>
                                                                                    </div>
                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                                        <span style={{ color: theme.colors.secondaryText }}>State:</span>
                                                                                        <span style={{ 
                                                                                            color: stateColor,
                                                                                            fontWeight: '500',
                                                                                            display: 'flex',
                                                                                            alignItems: 'center',
                                                                                            gap: '4px'
                                                                                        }}>
                                                                                            {stateIcon} {stateLabel}
                                                                                        </span>
                                                                                    </div>
                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                                        <span style={{ color: theme.colors.secondaryText }}>Dissolve Delay:</span>
                                                                                        <span style={{ color: theme.colors.primaryText }}>
                                                                                            {dissolveDelay > 0 ? format_duration(dissolveDelay * 1000) : 'Not set'}
                                                                                        </span>
                                                                                    </div>
                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                                        <span style={{ color: theme.colors.secondaryText }}>Voting Power:</span>
                                                                                        <span style={{ color: theme.colors.primaryText }}>
                                                                                            {votingPower.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                                        </span>
                                                                                    </div>
                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                                        <span style={{ color: theme.colors.secondaryText }}>Age:</span>
                                                                                        <span style={{ color: theme.colors.primaryText }}>
                                                                                            {age > 0 ? format_duration(age * 1000) : '0'}
                                                                                        </span>
                                                                                    </div>
                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                                        <span style={{ color: theme.colors.secondaryText }}>Maturity:</span>
                                                                                        <span style={{ color: maturity > 0 ? theme.colors.accent : theme.colors.primaryText, fontWeight: maturity > 0 ? '600' : '400' }}>
                                                                                            {maturity.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ICP
                                                                                            {maturity > 0 && icpPrice && (
                                                                                                <span style={{ color: theme.colors.mutedText, fontWeight: '400', marginLeft: '6px' }}>
                                                                                                    (${(maturity * icpPrice).toFixed(2)})
                                                                                                </span>
                                                                                            )}
                                                                                        </span>
                                                                                    </div>
                                                                                    {stakedMaturity > 0 && (
                                                                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                                            <span style={{ color: theme.colors.secondaryText }}>Staked Maturity:</span>
                                                                                            <span style={{ color: theme.colors.primaryText }}>
                                                                                                {stakedMaturity.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ICP
                                                                                            </span>
                                                                                        </div>
                                                                                    )}
                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                                        <span style={{ color: theme.colors.secondaryText }}>Auto-stake Maturity:</span>
                                                                                        <span style={{ color: autoStakeMaturity ? theme.colors.success : theme.colors.mutedText }}>
                                                                                            {autoStakeMaturity ? <><FaCheck size={10} style={{ marginRight: '4px' }} /> Enabled</> : <><FaTimes size={10} style={{ marginRight: '4px' }} /> Disabled</>}
                                                                                        </span>
                                                                                    </div>
                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                                        <span style={{ color: theme.colors.secondaryText }}>Total Value:</span>
                                                                                        <span style={{ color: theme.colors.accent, fontWeight: '700' }}>
                                                                                            {totalNeuronIcp.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ICP
                                                                                            {icpPrice && (
                                                                                                <span style={{ marginLeft: '6px' }}>
                                                                                                    (${(totalNeuronIcp * icpPrice).toFixed(2)})
                                                                                                </span>
                                                                                            )}
                                                                                        </span>
                                                                                    </div>
                                                                                </div>
                                                                                
                                                                                {/* Quick Actions Note */}
                                                                                <div style={{ 
                                                                                    marginTop: '12px',
                                                                                    padding: '10px',
                                                                                    backgroundColor: theme.colors.tertiaryBg || theme.colors.secondaryBg,
                                                                                    borderRadius: '6px',
                                                                                    fontSize: '0.85rem',
                                                                                    color: theme.colors.mutedText,
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    gap: '8px'
                                                                                }}>
                                                                                    <FaLightbulb size={14} style={{ color: theme.colors.accent }} />
                                                                                    <span>
                                                                                        For advanced actions like dissolving, disburse maturity, staking, or following, 
                                                                                        use the <strong style={{ color: theme.colors.primaryText }}>Manage</strong> button above.
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                    
                                                    {/* Action Buttons */}
                                                    <div style={{ 
                                                        display: 'flex', 
                                                        gap: '8px', 
                                                        marginTop: '16px',
                                                        flexWrap: 'wrap',
                                                        justifyContent: 'flex-end'
                                                    }}>
                                                        <Link 
                                                            to={`/icp_neuron_manager/${canisterId}`}
                                                            style={{
                                                                background: theme.colors.accent,
                                                                color: '#fff',
                                                                padding: '8px 16px',
                                                                borderRadius: '6px',
                                                                textDecoration: 'none',
                                                                fontSize: '13px',
                                                                fontWeight: '600',
                                                            }}
                                                        >
                                                            Manage
                                                        </Link>
                                                        {/* Top-Up - available for anyone */}
                                                        <button
                                                            onClick={() => {
                                                                if (topUpManagerId === canisterId) {
                                                                    setTopUpManagerId(null);
                                                                    setTopUpAmount('');
                                                                    setTopUpError('');
                                                                    setTopUpSuccess('');
                                                                } else {
                                                                    setTopUpManagerId(canisterId);
                                                                    setTopUpAmount('');
                                                                    setTopUpError('');
                                                                    setTopUpSuccess('');
                                                                }
                                                            }}
                                                            style={{
                                                                background: 'transparent',
                                                                color: theme.colors.success || '#22c55e',
                                                                border: `1px solid ${theme.colors.success || '#22c55e'}`,
                                                                padding: '8px 16px',
                                                                borderRadius: '6px',
                                                                cursor: 'pointer',
                                                                fontSize: '13px',
                                                                fontWeight: '600',
                                                            }}
                                                        >
                                                            ⚡ Top-Up
                                                        </button>
                                                        {confirmRemoveManager === canisterId ? (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <span style={{ 
                                                                    color: theme.colors.mutedText, 
                                                                    fontSize: '11px',
                                                                }}>
                                                                    Remove?
                                                                </span>
                                                                <button
                                                                    onClick={async () => {
                                                                        setConfirmRemoveManager(null);
                                                                        setDeregisterManagerError('');
                                                                        setDeregisteringManager(canisterId);
                                                                        const result = await handleDeregisterManager(manager.canisterId);
                                                                        setDeregisteringManager(null);
                                                                        if (!result.success) {
                                                                            setDeregisterManagerError(`Failed to remove: ${result.error}`);
                                                                            // Auto-clear after 5 seconds
                                                                            setTimeout(() => setDeregisterManagerError(''), 5000);
                                                                        }
                                                                    }}
                                                                    disabled={deregisteringManager === canisterId}
                                                                    style={{
                                                                        backgroundColor: theme.colors.error || '#ef4444',
                                                                        color: '#fff',
                                                                        border: 'none',
                                                                        borderRadius: '4px',
                                                                        padding: '4px 10px',
                                                                        cursor: deregisteringManager === canisterId ? 'not-allowed' : 'pointer',
                                                                        fontSize: '12px',
                                                                        fontWeight: '500',
                                                                        opacity: deregisteringManager === canisterId ? 0.7 : 1,
                                                                    }}
                                                                >
                                                                    {deregisteringManager === canisterId ? '...' : 'Yes'}
                                                                </button>
                                                                <button
                                                                    onClick={() => setConfirmRemoveManager(null)}
                                                                    style={{
                                                                        backgroundColor: theme.colors.secondaryBg,
                                                                        color: theme.colors.primaryText,
                                                                        border: `1px solid ${theme.colors.border}`,
                                                                        borderRadius: '4px',
                                                                        padding: '4px 10px',
                                                                        cursor: 'pointer',
                                                                        fontSize: '12px',
                                                                    }}
                                                                >
                                                                    No
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                onClick={() => setConfirmRemoveManager(canisterId)}
                                                                disabled={deregisteringManager === canisterId}
                                                                style={{
                                                                    background: 'transparent',
                                                                    color: theme.colors.mutedText,
                                                                    border: `1px solid ${theme.colors.border}`,
                                                                    padding: '8px 12px',
                                                                    borderRadius: '6px',
                                                                    cursor: deregisteringManager === canisterId ? 'not-allowed' : 'pointer',
                                                                    fontSize: '13px',
                                                                    opacity: deregisteringManager === canisterId ? 0.6 : 1,
                                                                }}
                                                                title="Remove from list (does not delete canister)"
                                                            >
                                                                {deregisteringManager === canisterId ? '...' : '✕ Remove'}
                                                            </button>
                                                        )}
                                                    </div>
                                                    
                                                    {/* Top-Up Section */}
                                                    {topUpManagerId === canisterId && (
                                                        <div style={{
                                                            marginTop: '16px',
                                                            padding: '16px',
                                                            backgroundColor: theme.colors.tertiaryBg || 'rgba(0,0,0,0.05)',
                                                            borderRadius: '8px',
                                                            border: `1px solid ${theme.colors.success || '#22c55e'}40`,
                                                        }}>
                                                            <div style={{ 
                                                                display: 'flex', 
                                                                alignItems: 'center', 
                                                                gap: '8px',
                                                                marginBottom: '12px'
                                                            }}>
                                                                <span style={{ fontSize: '18px' }}>⚡</span>
                                                                <span style={{ 
                                                                    fontWeight: '600', 
                                                                    color: theme.colors.primaryText,
                                                                    fontSize: '14px'
                                                                }}>
                                                                    Add Cycles
                                                                </span>
                                                            </div>
                                                            
                                                            {topUpError && (
                                                                <div style={{
                                                                    padding: '10px',
                                                                    backgroundColor: (theme.colors.error || '#ef4444') + '20',
                                                                    borderRadius: '6px',
                                                                    color: theme.colors.error || '#ef4444',
                                                                    fontSize: '12px',
                                                                    marginBottom: '12px',
                                                                }}>
                                                                    {topUpError}
                                                                </div>
                                                            )}
                                                            
                                                            {topUpSuccess && (
                                                                <div style={{
                                                                    padding: '10px',
                                                                    backgroundColor: (theme.colors.success || '#22c55e') + '20',
                                                                    borderRadius: '6px',
                                                                    color: theme.colors.success || '#22c55e',
                                                                    fontSize: '12px',
                                                                    marginBottom: '12px',
                                                                }}>
                                                                    {topUpSuccess}
                                                                </div>
                                                            )}
                                                            
                                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch', flexWrap: 'wrap' }}>
                                                                <div style={{ flex: '1', minWidth: '150px' }}>
                                                                    <input
                                                                        type="number"
                                                                        placeholder="ICP amount"
                                                                        value={topUpAmount}
                                                                        onChange={(e) => setTopUpAmount(e.target.value)}
                                                                        step="0.0001"
                                                                        min="0"
                                                                        style={{
                                                                            width: '100%',
                                                                            padding: '10px 12px',
                                                                            borderRadius: '6px',
                                                                            border: `1px solid ${theme.colors.border}`,
                                                                            backgroundColor: theme.colors.primaryBg,
                                                                            color: theme.colors.primaryText,
                                                                            fontSize: '14px',
                                                                            boxSizing: 'border-box',
                                                                        }}
                                                                    />
                                                                </div>
                                                                <button
                                                                    onClick={() => handleCyclesTopUp(canisterId)}
                                                                    disabled={toppingUp || !topUpAmount || parseFloat(topUpAmount) <= 0}
                                                                    style={{
                                                                        padding: '10px 20px',
                                                                        borderRadius: '6px',
                                                                        border: 'none',
                                                                        backgroundColor: theme.colors.success || '#22c55e',
                                                                        color: '#fff',
                                                                        fontWeight: '600',
                                                                        fontSize: '13px',
                                                                        cursor: (toppingUp || !topUpAmount || parseFloat(topUpAmount) <= 0) ? 'not-allowed' : 'pointer',
                                                                        opacity: (toppingUp || !topUpAmount || parseFloat(topUpAmount) <= 0) ? 0.6 : 1,
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '6px',
                                                                    }}
                                                                >
                                                                    {toppingUp ? (
                                                                        <>
                                                                            <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></div>
                                                                            Processing...
                                                                        </>
                                                                    ) : (
                                                                        'Top Up'
                                                                    )}
                                                                </button>
                                                            </div>
                                                            
                                                            {/* Conversion estimate */}
                                                            {topUpAmount && parseFloat(topUpAmount) > 0 && icpToCyclesRate && (
                                                                <div style={{
                                                                    marginTop: '10px',
                                                                    fontSize: '12px',
                                                                    color: theme.colors.mutedText,
                                                                }}>
                                                                    ≈ {formatCyclesCompact(parseFloat(topUpAmount) * icpToCyclesRate)} cycles
                                                                </div>
                                                            )}
                                                            
                                                            <div style={{
                                                                marginTop: '10px',
                                                                fontSize: '11px',
                                                                color: theme.colors.mutedText,
                                                            }}>
                                                                Converts ICP from your wallet to cycles for this canister.
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                            </>
                            )}
                        </div>

                        {/* Canisters Section */}
                        <div style={{ 
                            backgroundColor: theme.colors.secondaryBg, 
                            borderRadius: '12px', 
                            padding: '16px',
                            marginBottom: '16px'
                        }}>
                            <div 
                                style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    cursor: 'pointer',
                                    marginBottom: trackedCanistersExpanded ? '12px' : 0
                                }}
                                onClick={() => setTrackedCanistersExpanded(!trackedCanistersExpanded)}
                            >
                                <h3 style={{ 
                                    color: theme.colors.primaryText, 
                                    fontSize: '1rem', 
                                    fontWeight: '600',
                                    margin: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem'
                                }}>
                                    {trackedCanistersExpanded ? <FaChevronDown size={12} /> : <FaChevronRight size={12} />}
                                    <FaBox size={16} color={walletPrimary} />
                                    Canisters
                                    {trackedCanisters.length > 0 && (
                                        <span style={{ color: walletPrimary, fontWeight: '500' }}>
                                            ({trackedCanisters.length})
                                        </span>
                                    )}
                                </h3>
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleRefreshTrackedCanisters(); }}
                                    disabled={refreshingTrackedCanisters}
                                    style={{
                                        background: `${walletPrimary}15`,
                                        color: walletPrimary,
                                        border: `1px solid ${walletPrimary}30`,
                                        borderRadius: '8px',
                                        padding: '0.4rem 0.6rem',
                                        cursor: refreshingTrackedCanisters ? 'not-allowed' : 'pointer',
                                        fontSize: '0.8rem',
                                        fontWeight: '500',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.3rem',
                                        transition: 'all 0.2s ease',
                                        opacity: refreshingTrackedCanisters ? 0.6 : 1
                                    }}
                                >
                                    <FaSync size={10} style={{ animation: refreshingTrackedCanisters ? 'walletSpin 1s linear infinite' : 'none' }} />
                                    Refresh
                                </button>
                            </div>
                            {trackedCanistersExpanded && (
                            <>
                        {/* Add canister input */}
                        <div style={{ 
                            backgroundColor: theme.colors.tertiaryBg || theme.colors.primaryBg, 
                            borderRadius: '8px', 
                            padding: '12px 16px',
                            marginBottom: '12px',
                            display: 'flex',
                            gap: '10px',
                            alignItems: 'center',
                            flexWrap: 'wrap'
                        }}>
                            <PrincipalInput
                                value={newTrackedCanisterId}
                                onChange={(v) => {
                                    setNewTrackedCanisterId(v);
                                    setAddTrackedCanisterError('');
                                }}
                                placeholder="Add canister by ID"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && newTrackedCanisterId.trim()) {
                                        handleAddTrackedCanister();
                                    }
                                }}
                                style={{ flex: 1, minWidth: '200px', maxWidth: 'none' }}
                                inputStyle={{ fontFamily: 'monospace', fontSize: '13px' }}
                                disabled={addingTrackedCanister}
                            />
                            <button
                                onClick={handleAddTrackedCanister}
                                disabled={addingTrackedCanister || !newTrackedCanisterId.trim()}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    backgroundColor: (addingTrackedCanister || !newTrackedCanisterId.trim()) ? theme.colors.mutedText : theme.colors.accent,
                                    color: '#fff',
                                    fontSize: '13px',
                                    fontWeight: '600',
                                    cursor: (addingTrackedCanister || !newTrackedCanisterId.trim()) ? 'not-allowed' : 'pointer',
                                    opacity: (addingTrackedCanister || !newTrackedCanisterId.trim()) ? 0.6 : 1,
                                }}
                            >
                                {addingTrackedCanister ? '...' : '+ Add'}
                            </button>
                        </div>
                        {addTrackedCanisterError && (
                            <div style={{ 
                                color: '#ef4444', 
                                fontSize: '12px', 
                                marginBottom: '12px',
                                marginTop: '-8px',
                                padding: '0 4px'
                            }}>
                                {addTrackedCanisterError}
                            </div>
                        )}
                        
                        {trackedCanistersLoading ? (
                            <div className="card">
                                <div className="spinner"></div>
                            </div>
                        ) : trackedCanisters.length === 0 ? (
                            <div style={{ 
                                backgroundColor: theme.colors.secondaryBg, 
                                borderRadius: '8px', 
                                padding: '24px',
                                textAlign: 'center'
                            }}>
                                <p style={{ color: theme.colors.mutedText, marginBottom: '16px' }}>
                                    No canisters tracked in your wallet.
                                </p>
                                <p style={{ color: theme.colors.mutedText, fontSize: '13px' }}>
                                    Add a canister ID above to start tracking it.
                                </p>
                            </div>
                        ) : (
                            <div className="card-grid">
                                {trackedCanisters.map((canisterId) => {
                                    const displayInfo = getPrincipalDisplayInfoFromContext(canisterId, principalNames, principalNicknames);
                                    const isConfirming = confirmRemoveTrackedCanister === canisterId;
                                    const isRemoving = removingTrackedCanister === canisterId;
                                    const status = trackedCanisterStatus[canisterId];
                                    const isExpanded = expandedCanisterCards[canisterId];
                                    const isController = status?.isController;
                                    const cycles = status?.cycles;
                                    const memory = status?.memory;
                                    
                                    // Helper to format memory
                                    const formatMemory = (bytes) => {
                                        if (bytes === null || bytes === undefined) return 'N/A';
                                        const MB = 1024 * 1024;
                                        const GB = 1024 * 1024 * 1024;
                                        if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
                                        if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
                                        return `${(bytes / 1024).toFixed(0)} KB`;
                                    };
                                    
                                    // Check if this canister is a detected neuron manager
                                    const detectedManager = detectedNeuronManagers[canisterId];
                                    if (detectedManager && detectedManager.isValid) {
                                        // Render as valid neuron manager card
                                        const managerVersion = detectedManager.version;
                                        const managerNeuronCount = detectedManager.neuronCount || 0;
                                        const managerCycles = detectedManager.cycles;
                                        const managerIsController = detectedManager.isController;
                                        
                                        return (
                                            <div 
                                                key={canisterId}
                                                className="card"
                                            >
                                                {/* Card Header - Neuron Manager style */}
                                                <div 
                                                    className="card-header"
                                                    onClick={() => setExpandedCanisterCards(prev => ({ ...prev, [canisterId]: !prev[canisterId] }))}
                                                >
                                                    <div className="header-logo-column" style={{ alignSelf: 'flex-start', minWidth: '48px', minHeight: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                                                        <FaBrain size={36} style={{ color: '#8b5cf6' }} />
                                                        {managerIsController && (
                                                            <span 
                                                                style={{ 
                                                                    position: 'absolute', 
                                                                    top: 0, 
                                                                    right: 0,
                                                                    color: '#f59e0b'
                                                                }}
                                                                title="You are a controller"
                                                            >
                                                                <FaCrown size={14} />
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="header-content-column">
                                                        {/* Row 1: Name and Refresh */}
                                                        <div className="header-row-1" style={{ minWidth: 0 }}>
                                                            <span className="token-name">
                                                                <PrincipalDisplay
                                                                    principal={canisterId}
                                                                    displayInfo={displayInfo}
                                                                    showCopyButton={false}
                                                                    isAuthenticated={isAuthenticated}
                                                                    noLink={true}
                                                                />
                                                            </span>
                                                            <button
                                                                onClick={async (e) => {
                                                                    e.stopPropagation();
                                                                    await handleRefreshCanisterCard(canisterId);
                                                                }}
                                                                disabled={refreshingCanisterCard === canisterId}
                                                                style={{
                                                                    background: 'none',
                                                                    border: 'none',
                                                                    cursor: refreshingCanisterCard === canisterId ? 'default' : 'pointer',
                                                                    padding: '4px',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    color: theme.colors.mutedText,
                                                                    fontSize: '1.2rem',
                                                                    transition: 'color 0.2s ease',
                                                                    opacity: refreshingCanisterCard === canisterId ? 0.6 : 1
                                                                }}
                                                                title="Refresh data"
                                                            >
                                                                <FaSync size={12} style={{ animation: refreshingCanisterCard === canisterId ? 'spin 1s linear infinite' : 'none' }} />
                                                            </button>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    openDappDetailModal({
                                                                        canisterId,
                                                                        isNeuronManager: true,
                                                                        neuronManagerVersion: managerVersion,
                                                                        neuronCount: managerNeuronCount,
                                                                        cycles: managerCycles,
                                                                        memory: status?.memory,
                                                                        isController: managerIsController,
                                                                    });
                                                                }}
                                                                style={{
                                                                    background: 'none',
                                                                    border: 'none',
                                                                    cursor: 'pointer',
                                                                    padding: '4px',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    color: theme.colors.mutedText,
                                                                    transition: 'color 0.2s ease',
                                                                }}
                                                                onMouseEnter={(e) => e.target.style.color = theme.colors.primaryText}
                                                                onMouseLeave={(e) => e.target.style.color = theme.colors.mutedText}
                                                                title="Open in dialog"
                                                            >
                                                                <FaExpand size={12} />
                                                            </button>
                                                        </div>
                                                        {/* Row 2: ICP Neuron Manager label */}
                                                        <div className="header-row-2">
                                                            <div className="amount-symbol">
                                                                <span className="token-amount" style={{ color: '#8b5cf6' }}>
                                                                    ICP Neuron Manager
                                                                </span>
                                                            </div>
                                                        </div>
                                                        {/* Row 3: Version, Neurons, Cycles badges */}
                                                        <div className="header-row-3" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                            {/* Version badge */}
                                                            {managerVersion && (
                                                                <span 
                                                                    style={{
                                                                        background: `#8b5cf620`,
                                                                        color: '#8b5cf6',
                                                                        padding: '2px 8px',
                                                                        borderRadius: '12px',
                                                                        fontSize: '0.7rem',
                                                                        fontWeight: '500',
                                                                    }}
                                                                >
                                                                    v{Number(managerVersion.major)}.{Number(managerVersion.minor)}.{Number(managerVersion.patch)}
                                                                </span>
                                                            )}
                                                            {/* Neurons badge */}
                                                            <span 
                                                                style={{
                                                                    background: managerNeuronCount > 0 ? `#8b5cf620` : theme.colors.tertiaryBg,
                                                                    color: managerNeuronCount > 0 ? '#8b5cf6' : theme.colors.mutedText,
                                                                    padding: '2px 8px',
                                                                    borderRadius: '12px',
                                                                    fontSize: '0.7rem',
                                                                    fontWeight: '500',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '4px',
                                                                }}
                                                            >
                                                                <FaBrain size={10} /> {managerNeuronCount} neuron{managerNeuronCount !== 1 ? 's' : ''}
                                                            </span>
                                                            {/* Cycles badge */}
                                                            {managerCycles !== undefined && managerCycles !== null && (
                                                                <span 
                                                                    style={{
                                                                        background: `${getCyclesColor(managerCycles, neuronManagerCycleSettings)}20`,
                                                                        color: getCyclesColor(managerCycles, neuronManagerCycleSettings),
                                                                        padding: '2px 8px',
                                                                        borderRadius: '12px',
                                                                        fontSize: '0.7rem',
                                                                        fontWeight: '500',
                                                                    }}
                                                                    title={`${managerCycles.toLocaleString()} cycles`}
                                                                >
                                                                    ⚡ {formatCyclesCompact(managerCycles)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                
                                                {/* Expanded Section */}
                                                {isExpanded && (
                                                    <div className="card-content">
                                                        {/* Actions */}
                                                        <div style={{ 
                                                            display: 'flex', 
                                                            gap: '8px', 
                                                            flexWrap: 'wrap',
                                                            justifyContent: 'flex-end',
                                                            alignItems: 'center',
                                                        }}>
                                                            <Link
                                                                to={`/icp_neuron_manager/${canisterId}`}
                                                                style={{
                                                                    padding: '8px 16px',
                                                                    borderRadius: '8px',
                                                                    backgroundColor: '#8b5cf6',
                                                                    color: '#fff',
                                                                    fontSize: '13px',
                                                                    textDecoration: 'none',
                                                                    fontWeight: '600',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px',
                                                                }}
                                                            >
                                                                <FaBrain size={12} />
                                                                Manage Neurons
                                                            </Link>
                                                            <Link
                                                                to={`/canister?id=${canisterId}`}
                                                                style={{
                                                                    padding: '8px 16px',
                                                                    borderRadius: '8px',
                                                                    backgroundColor: theme.colors.accent,
                                                                    color: '#fff',
                                                                    fontSize: '13px',
                                                                    textDecoration: 'none',
                                                                    fontWeight: '600',
                                                                }}
                                                            >
                                                                View Details
                                                            </Link>
                                                            {isConfirming ? (
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                    <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Remove?</span>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleRemoveTrackedCanister(canisterId); }}
                                                                        disabled={isRemoving}
                                                                        style={{
                                                                            backgroundColor: '#ef4444',
                                                                            color: '#fff',
                                                                            border: 'none',
                                                                            borderRadius: '6px',
                                                                            padding: '8px 12px',
                                                                            cursor: isRemoving ? 'not-allowed' : 'pointer',
                                                                            fontSize: '13px',
                                                                            opacity: isRemoving ? 0.6 : 1,
                                                                        }}
                                                                    >
                                                                        {isRemoving ? '...' : 'Yes'}
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); setConfirmRemoveTrackedCanister(null); }}
                                                                        style={{
                                                                            backgroundColor: theme.colors.secondaryBg,
                                                                            color: theme.colors.primaryText,
                                                                            border: `1px solid ${theme.colors.border}`,
                                                                            borderRadius: '6px',
                                                                            padding: '8px 12px',
                                                                            cursor: 'pointer',
                                                                            fontSize: '13px',
                                                                        }}
                                                                    >
                                                                        No
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); setConfirmRemoveTrackedCanister(canisterId); }}
                                                                    style={{
                                                                        padding: '8px 16px',
                                                                        borderRadius: '8px',
                                                                        border: `1px solid ${theme.colors.border}`,
                                                                        backgroundColor: 'transparent',
                                                                        color: theme.colors.mutedText,
                                                                        fontSize: '13px',
                                                                        cursor: 'pointer',
                                                                    }}
                                                                    title="Remove from wallet"
                                                                >
                                                                    Remove
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    }
                                    
                                    // Invalid detected manager - WASM matches but interface doesn't work
                                    if (detectedManager && !detectedManager.isValid) {
                                        const managerCycles = detectedManager.cycles;
                                        const managerIsController = detectedManager.isController;
                                        
                                        return (
                                            <div 
                                                key={canisterId}
                                                className="card"
                                            >
                                                {/* Card Header - Warning style */}
                                                <div 
                                                    className="card-header"
                                                    onClick={() => setExpandedCanisterCards(prev => ({ ...prev, [canisterId]: !prev[canisterId] }))}
                                                >
                                                    <div className="header-logo-column" style={{ alignSelf: 'flex-start', minWidth: '48px', minHeight: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                                                        <FaBrain size={36} style={{ color: '#f59e0b' }} />
                                                        {managerIsController && (
                                                            <span 
                                                                style={{ 
                                                                    position: 'absolute', 
                                                                    top: 0, 
                                                                    right: 0,
                                                                    color: '#f59e0b'
                                                                }}
                                                                title="You are a controller"
                                                            >
                                                                <FaCrown size={14} />
                                                            </span>
                                                        )}
                                                        <span 
                                                            style={{ 
                                                                position: 'absolute', 
                                                                bottom: 0, 
                                                                right: 0,
                                                                color: '#ef4444'
                                                            }}
                                                            title="Canister WASM matches neuron manager but interface is not working"
                                                        >
                                                            <FaExclamationTriangle size={14} />
                                                        </span>
                                                    </div>
                                                    <div className="header-content-column">
                                                        {/* Row 1: Name and Refresh */}
                                                        <div className="header-row-1" style={{ minWidth: 0 }}>
                                                            <span className="token-name">
                                                                <PrincipalDisplay
                                                                    principal={canisterId}
                                                                    displayInfo={displayInfo}
                                                                    showCopyButton={false}
                                                                    isAuthenticated={isAuthenticated}
                                                                    noLink={true}
                                                                />
                                                            </span>
                                                            <button
                                                                onClick={async (e) => {
                                                                    e.stopPropagation();
                                                                    // Clear detection to allow re-detection on refresh
                                                                    setDetectedNeuronManagers(prev => {
                                                                        const newState = { ...prev };
                                                                        delete newState[canisterId];
                                                                        return newState;
                                                                    });
                                                                    await handleRefreshCanisterCard(canisterId);
                                                                }}
                                                                disabled={refreshingCanisterCard === canisterId}
                                                                style={{
                                                                    background: 'none',
                                                                    border: 'none',
                                                                    cursor: refreshingCanisterCard === canisterId ? 'default' : 'pointer',
                                                                    padding: '4px',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    color: theme.colors.mutedText,
                                                                    fontSize: '1.2rem',
                                                                    transition: 'color 0.2s ease',
                                                                    opacity: refreshingCanisterCard === canisterId ? 0.6 : 1
                                                                }}
                                                                title="Refresh data"
                                                            >
                                                                <FaSync size={12} style={{ animation: refreshingCanisterCard === canisterId ? 'spin 1s linear infinite' : 'none' }} />
                                                            </button>
                                                        </div>
                                                        {/* Row 2: Warning label */}
                                                        <div className="header-row-2">
                                                            <div className="amount-symbol">
                                                                <span className="token-amount" style={{ color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                    <FaExclamationTriangle size={12} />
                                                                    Incompatible Manager
                                                                </span>
                                                            </div>
                                                        </div>
                                                        {/* Row 3: Cycles badge only */}
                                                        <div className="header-row-3" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                            {/* Cycles badge */}
                                                            {managerCycles !== undefined && managerCycles !== null && (
                                                                <span 
                                                                    style={{
                                                                        background: `${getCyclesColor(managerCycles, neuronManagerCycleSettings)}20`,
                                                                        color: getCyclesColor(managerCycles, neuronManagerCycleSettings),
                                                                        padding: '2px 8px',
                                                                        borderRadius: '12px',
                                                                        fontSize: '0.7rem',
                                                                        fontWeight: '500',
                                                                    }}
                                                                    title={`${managerCycles.toLocaleString()} cycles`}
                                                                >
                                                                    ⚡ {formatCyclesCompact(managerCycles)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                
                                                {/* Expanded Section */}
                                                {isExpanded && (
                                                    <div className="card-content">
                                                        {/* Warning message */}
                                                        <div style={{
                                                            padding: '12px',
                                                            backgroundColor: '#f59e0b15',
                                                            borderRadius: '8px',
                                                            marginBottom: '12px',
                                                            border: '1px solid #f59e0b30',
                                                        }}>
                                                            <p style={{ 
                                                                color: '#f59e0b', 
                                                                fontSize: '12px', 
                                                                margin: 0,
                                                                display: 'flex',
                                                                alignItems: 'flex-start',
                                                                gap: '8px',
                                                            }}>
                                                                <FaExclamationTriangle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                                                                <span>
                                                                    This canister's WASM matches a neuron manager version, but its interface is not responding correctly. 
                                                                    It may have been upgraded to different code or is not fully deployed.
                                                                </span>
                                                            </p>
                                                        </div>
                                                        
                                                        {/* Actions */}
                                                        <div style={{ 
                                                            display: 'flex', 
                                                            gap: '8px', 
                                                            flexWrap: 'wrap',
                                                            justifyContent: 'flex-end',
                                                            alignItems: 'center',
                                                        }}>
                                                            <Link
                                                                to={`/canister?id=${canisterId}`}
                                                                style={{
                                                                    padding: '8px 16px',
                                                                    borderRadius: '8px',
                                                                    backgroundColor: theme.colors.accent,
                                                                    color: '#fff',
                                                                    fontSize: '13px',
                                                                    textDecoration: 'none',
                                                                    fontWeight: '600',
                                                                }}
                                                            >
                                                                View Details
                                                            </Link>
                                                            {isConfirming ? (
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                    <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Remove?</span>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleRemoveTrackedCanister(canisterId); }}
                                                                        disabled={isRemoving}
                                                                        style={{
                                                                            backgroundColor: '#ef4444',
                                                                            color: '#fff',
                                                                            border: 'none',
                                                                            borderRadius: '6px',
                                                                            padding: '8px 12px',
                                                                            cursor: isRemoving ? 'not-allowed' : 'pointer',
                                                                            fontSize: '13px',
                                                                            opacity: isRemoving ? 0.6 : 1,
                                                                        }}
                                                                    >
                                                                        {isRemoving ? '...' : 'Yes'}
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); setConfirmRemoveTrackedCanister(null); }}
                                                                        style={{
                                                                            backgroundColor: theme.colors.secondaryBg,
                                                                            color: theme.colors.primaryText,
                                                                            border: `1px solid ${theme.colors.border}`,
                                                                            borderRadius: '6px',
                                                                            padding: '8px 12px',
                                                                            cursor: 'pointer',
                                                                            fontSize: '13px',
                                                                        }}
                                                                    >
                                                                        No
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); setConfirmRemoveTrackedCanister(canisterId); }}
                                                                    style={{
                                                                        padding: '8px 16px',
                                                                        borderRadius: '8px',
                                                                        border: `1px solid ${theme.colors.border}`,
                                                                        backgroundColor: 'transparent',
                                                                        color: theme.colors.mutedText,
                                                                        fontSize: '13px',
                                                                        cursor: 'pointer',
                                                                    }}
                                                                    title="Remove from wallet"
                                                                >
                                                                    Remove
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    }
                                    
                                    // Regular canister card
                                    return (
                                        <div 
                                            key={canisterId}
                                            className="card"
                                        >
                                            {/* Card Header - Similar to TokenCard */}
                                            <div 
                                                className="card-header"
                                                onClick={() => setExpandedCanisterCards(prev => ({ ...prev, [canisterId]: !prev[canisterId] }))}
                                            >
                                                <div className="header-logo-column" style={{ alignSelf: 'flex-start', minWidth: '48px', minHeight: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                                                    <FaBox size={36} style={{ color: theme.colors.mutedText }} />
                                                    {isController && (
                                                        <span 
                                                            style={{ 
                                                                position: 'absolute', 
                                                                top: 0, 
                                                                right: 0,
                                                                color: theme.colors.accent
                                                            }}
                                                            title="You are a controller"
                                                        >
                                                            <FaCrown size={14} />
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="header-content-column">
                                                    {/* Row 1: Name and Refresh */}
                                                    <div className="header-row-1" style={{ minWidth: 0 }}>
                                                        <span className="token-name">
                                                            <PrincipalDisplay
                                                                principal={canisterId}
                                                                displayInfo={displayInfo}
                                                                showCopyButton={false}
                                                                isAuthenticated={isAuthenticated}
                                                                noLink={true}
                                                            />
                                                        </span>
                                                        <button
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                await handleRefreshCanisterCard(canisterId);
                                                            }}
                                                            disabled={refreshingCanisterCard === canisterId}
                                                            style={{
                                                                background: 'none',
                                                                border: 'none',
                                                                cursor: refreshingCanisterCard === canisterId ? 'default' : 'pointer',
                                                                padding: '4px',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                color: theme.colors.mutedText,
                                                                fontSize: '1.2rem',
                                                                transition: 'color 0.2s ease',
                                                                opacity: refreshingCanisterCard === canisterId ? 0.6 : 1
                                                            }}
                                                            onMouseEnter={(e) => refreshingCanisterCard !== canisterId && (e.target.style.color = theme.colors.primaryText)}
                                                            onMouseLeave={(e) => refreshingCanisterCard !== canisterId && (e.target.style.color = theme.colors.mutedText)}
                                                            title="Refresh canister data"
                                                        >
                                                            <FaSync size={12} style={{ animation: refreshingCanisterCard === canisterId ? 'spin 1s linear infinite' : 'none' }} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                openDappDetailModal({
                                                                    canisterId,
                                                                    isNeuronManager: false,
                                                                    neuronManagerVersion: null,
                                                                    neuronCount: 0,
                                                                    cycles,
                                                                    memory,
                                                                    isController,
                                                                });
                                                            }}
                                                            style={{
                                                                background: 'none',
                                                                border: 'none',
                                                                cursor: 'pointer',
                                                                padding: '4px',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                color: theme.colors.mutedText,
                                                                transition: 'color 0.2s ease',
                                                            }}
                                                            onMouseEnter={(e) => e.target.style.color = theme.colors.primaryText}
                                                            onMouseLeave={(e) => e.target.style.color = theme.colors.mutedText}
                                                            title="Open in dialog"
                                                        >
                                                            <FaExpand size={12} />
                                                        </button>
                                                    </div>
                                                    {/* Row 2: Status indicator */}
                                                    <div className="header-row-2">
                                                        <div className="amount-symbol">
                                                            <span className="token-amount">
                                                                {isController ? 'Controller' : 'Tracked'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    {/* Row 3: Cycles & Memory badges */}
                                                    <div className="header-row-3" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        {/* Cycles badge */}
                                                        {cycles !== undefined && cycles !== null && (
                                                            <span 
                                                                style={{
                                                                    background: `${getCyclesColor(cycles, canisterCycleSettings)}20`,
                                                                    color: getCyclesColor(cycles, canisterCycleSettings),
                                                                    padding: '2px 8px',
                                                                    borderRadius: '12px',
                                                                    fontSize: '0.7rem',
                                                                    fontWeight: '500',
                                                                }}
                                                                title={`${cycles.toLocaleString()} cycles`}
                                                            >
                                                                ⚡ {formatCyclesCompact(cycles)}
                                                            </span>
                                                        )}
                                                        {/* Memory badge */}
                                                        {memory !== undefined && memory !== null && (
                                                            <span 
                                                                style={{
                                                                    background: `${theme.colors.accent || '#3b82f6'}20`,
                                                                    color: theme.colors.accent || '#3b82f6',
                                                                    padding: '2px 8px',
                                                                    borderRadius: '12px',
                                                                    fontSize: '0.7rem',
                                                                    fontWeight: '500',
                                                                }}
                                                                title={`${memory.toLocaleString()} bytes`}
                                                            >
                                                                <FaDatabase size={10} style={{ marginRight: '4px' }} /> {formatMemory(memory)}
                                                            </span>
                                                        )}
                                                        {/* Loading indicator if status not yet fetched */}
                                                        {!status && (
                                                            <span 
                                                                style={{
                                                                    background: theme.colors.tertiaryBg || theme.colors.primaryBg,
                                                                    color: theme.colors.mutedText,
                                                                    padding: '2px 8px',
                                                                    borderRadius: '12px',
                                                                    fontSize: '0.7rem',
                                                                    fontWeight: '500',
                                                                }}
                                                            >
                                                                ⚡ ...
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            {/* Expanded Section */}
                                            {isExpanded && (
                                                <div className="card-content">
                                                    {/* First Row: Send button (right-aligned) */}
                                                    {isController && (
                                                        <div style={{ 
                                                            display: 'flex', 
                                                            justifyContent: 'flex-end',
                                                            marginBottom: '12px'
                                                        }}>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setTransferTargetCanister(canisterId);
                                                                    setTransferCanisterRecipient('');
                                                                    setTransferCanisterError('');
                                                                    setTransferCanisterSuccess('');
                                                                    setTransferCanisterModalOpen(true);
                                                                }}
                                                                style={{
                                                                    background: theme.colors.accent,
                                                                    color: theme.colors.primaryBg,
                                                                    border: 'none',
                                                                    borderRadius: '6px',
                                                                    padding: '6px 12px',
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.85rem',
                                                                    fontWeight: '500',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px',
                                                                    transition: 'all 0.2s ease'
                                                                }}
                                                                onMouseEnter={(e) => {
                                                                    e.target.style.background = theme.colors.accentHover;
                                                                }}
                                                                onMouseLeave={(e) => {
                                                                    e.target.style.background = theme.colors.accent;
                                                                }}
                                                            >
                                                                <img 
                                                                    src="send-inverted.png" 
                                                                    alt="Send" 
                                                                    style={{ width: '14px', height: '14px' }}
                                                                />
                                                                Send
                                                            </button>
                                                        </div>
                                                    )}
                                                    
                                                    {/* Canister Info */}
                                                    <div style={{ 
                                                        padding: '12px 16px',
                                                        backgroundColor: theme.colors.tertiaryBg || 'rgba(0,0,0,0.05)',
                                                        borderRadius: '8px',
                                                        marginBottom: '12px',
                                                    }}>
                                                        <div style={{ 
                                                            display: 'flex', 
                                                            justifyContent: 'space-between', 
                                                            alignItems: 'center',
                                                            flexWrap: 'wrap',
                                                            gap: '12px'
                                                        }}>
                                                            <div>
                                                                <div style={{ color: theme.colors.mutedText, fontSize: '11px', marginBottom: '2px' }}>Canister ID</div>
                                                                <div style={{ 
                                                                    color: theme.colors.secondaryText, 
                                                                    fontFamily: 'monospace', 
                                                                    fontSize: '12px',
                                                                }}>
                                                                    {canisterId}
                                                                </div>
                                                            </div>
                                                            {isController && (
                                                                <>
                                                                    <div style={{ textAlign: 'center' }}>
                                                                        <div style={{ color: theme.colors.mutedText, fontSize: '10px', textTransform: 'uppercase' }}>Cycles</div>
                                                                        <div style={{ 
                                                                            color: cycles ? getCyclesColor(cycles, canisterCycleSettings) : theme.colors.mutedText,
                                                                            fontWeight: '600',
                                                                            fontSize: '13px'
                                                                        }}>
                                                                            {cycles !== null && cycles !== undefined ? formatCyclesCompact(cycles) : '...'}
                                                                        </div>
                                                                    </div>
                                                                    <div style={{ textAlign: 'center' }}>
                                                                        <div style={{ color: theme.colors.mutedText, fontSize: '10px', textTransform: 'uppercase' }}>Memory</div>
                                                                        <div style={{ 
                                                                            color: theme.colors.accent || '#3b82f6',
                                                                            fontWeight: '600',
                                                                            fontSize: '13px'
                                                                        }}>
                                                                            {memory !== null && memory !== undefined ? formatMemory(memory) : '...'}
                                                                        </div>
                                                                    </div>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                    
                                                    {/* Actions */}
                                                    <div style={{ 
                                                        display: 'flex', 
                                                        gap: '8px', 
                                                        flexWrap: 'wrap',
                                                        justifyContent: 'flex-end',
                                                        alignItems: 'center',
                                                    }}>
                                                        <Link
                                                            to={`/canister?id=${canisterId}`}
                                                            style={{
                                                                padding: '8px 16px',
                                                                borderRadius: '8px',
                                                                backgroundColor: theme.colors.accent,
                                                                color: '#fff',
                                                                fontSize: '13px',
                                                                textDecoration: 'none',
                                                                fontWeight: '600',
                                                            }}
                                                        >
                                                            View Details
                                                        </Link>
                                                        {/* Top-Up - available for anyone */}
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (topUpCanisterId === canisterId) {
                                                                    setTopUpCanisterId(null);
                                                                    setCanisterTopUpAmount('');
                                                                    setCanisterTopUpError('');
                                                                    setCanisterTopUpSuccess('');
                                                                } else {
                                                                    setTopUpCanisterId(canisterId);
                                                                    setCanisterTopUpAmount('');
                                                                    setCanisterTopUpError('');
                                                                    setCanisterTopUpSuccess('');
                                                                }
                                                            }}
                                                            style={{
                                                                background: 'transparent',
                                                                color: theme.colors.success || '#22c55e',
                                                                border: `1px solid ${theme.colors.success || '#22c55e'}`,
                                                                padding: '8px 16px',
                                                                borderRadius: '6px',
                                                                cursor: 'pointer',
                                                                fontSize: '13px',
                                                                fontWeight: '600',
                                                            }}
                                                        >
                                                            ⚡ Top-Up
                                                        </button>
                                                        {isConfirming ? (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Remove?</span>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleRemoveTrackedCanister(canisterId); }}
                                                                    disabled={isRemoving}
                                                                    style={{
                                                                        backgroundColor: '#ef4444',
                                                                        color: '#fff',
                                                                        border: 'none',
                                                                        borderRadius: '6px',
                                                                        padding: '8px 12px',
                                                                        cursor: isRemoving ? 'not-allowed' : 'pointer',
                                                                        fontSize: '13px',
                                                                        opacity: isRemoving ? 0.6 : 1,
                                                                    }}
                                                                >
                                                                    {isRemoving ? '...' : 'Yes'}
                                                                </button>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); setConfirmRemoveTrackedCanister(null); }}
                                                                    style={{
                                                                        backgroundColor: theme.colors.secondaryBg,
                                                                        color: theme.colors.primaryText,
                                                                        border: `1px solid ${theme.colors.border}`,
                                                                        borderRadius: '6px',
                                                                        padding: '8px 12px',
                                                                        cursor: 'pointer',
                                                                        fontSize: '13px',
                                                                    }}
                                                                >
                                                                    No
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setConfirmRemoveTrackedCanister(canisterId); }}
                                                                style={{
                                                                    padding: '8px 16px',
                                                                    borderRadius: '8px',
                                                                    border: `1px solid ${theme.colors.border}`,
                                                                    backgroundColor: 'transparent',
                                                                    color: theme.colors.mutedText,
                                                                    fontSize: '13px',
                                                                    cursor: 'pointer',
                                                                }}
                                                                title="Remove from wallet"
                                                            >
                                                                Remove
                                                            </button>
                                                        )}
                                                    </div>
                                                    
                                                    {/* Top-Up Section */}
                                                    {topUpCanisterId === canisterId && (
                                                        <div style={{
                                                            marginTop: '16px',
                                                            padding: '16px',
                                                            backgroundColor: theme.colors.tertiaryBg || 'rgba(0,0,0,0.05)',
                                                            borderRadius: '8px',
                                                            border: `1px solid ${theme.colors.success || '#22c55e'}40`,
                                                        }}>
                                                            <div style={{ 
                                                                display: 'flex', 
                                                                alignItems: 'center', 
                                                                gap: '8px',
                                                                marginBottom: '12px'
                                                            }}>
                                                                <span style={{ fontSize: '18px' }}>⚡</span>
                                                                <span style={{ 
                                                                    fontWeight: '600', 
                                                                    color: theme.colors.primaryText,
                                                                    fontSize: '14px'
                                                                }}>
                                                                    Add Cycles
                                                                </span>
                                                            </div>
                                                            
                                                            {canisterTopUpError && (
                                                                <div style={{
                                                                    padding: '10px',
                                                                    backgroundColor: (theme.colors.error || '#ef4444') + '20',
                                                                    borderRadius: '6px',
                                                                    color: theme.colors.error || '#ef4444',
                                                                    fontSize: '12px',
                                                                    marginBottom: '12px',
                                                                }}>
                                                                    {canisterTopUpError}
                                                                </div>
                                                            )}
                                                            
                                                            {canisterTopUpSuccess && (
                                                                <div style={{
                                                                    padding: '10px',
                                                                    backgroundColor: (theme.colors.success || '#22c55e') + '20',
                                                                    borderRadius: '6px',
                                                                    color: theme.colors.success || '#22c55e',
                                                                    fontSize: '12px',
                                                                    marginBottom: '12px',
                                                                }}>
                                                                    {canisterTopUpSuccess}
                                                                </div>
                                                            )}
                                                            
                                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch', flexWrap: 'wrap' }}>
                                                                <div style={{ flex: '1', minWidth: '150px' }}>
                                                                    <input
                                                                        type="number"
                                                                        placeholder="ICP amount"
                                                                        value={canisterTopUpAmount}
                                                                        onChange={(e) => setCanisterTopUpAmount(e.target.value)}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        step="0.0001"
                                                                        min="0"
                                                                        style={{
                                                                            width: '100%',
                                                                            padding: '10px 12px',
                                                                            borderRadius: '6px',
                                                                            border: `1px solid ${theme.colors.border}`,
                                                                            backgroundColor: theme.colors.primaryBg,
                                                                            color: theme.colors.primaryText,
                                                                            fontSize: '14px',
                                                                            boxSizing: 'border-box',
                                                                        }}
                                                                    />
                                                                </div>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleCanisterCyclesTopUp(canisterId); }}
                                                                    disabled={canisterToppingUp || !canisterTopUpAmount || parseFloat(canisterTopUpAmount) <= 0}
                                                                    style={{
                                                                        padding: '10px 20px',
                                                                        borderRadius: '6px',
                                                                        border: 'none',
                                                                        backgroundColor: theme.colors.success || '#22c55e',
                                                                        color: '#fff',
                                                                        fontWeight: '600',
                                                                        fontSize: '13px',
                                                                        cursor: (canisterToppingUp || !canisterTopUpAmount || parseFloat(canisterTopUpAmount) <= 0) ? 'not-allowed' : 'pointer',
                                                                        opacity: (canisterToppingUp || !canisterTopUpAmount || parseFloat(canisterTopUpAmount) <= 0) ? 0.6 : 1,
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '6px',
                                                                    }}
                                                                >
                                                                    {canisterToppingUp ? (
                                                                        <>
                                                                            <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></div>
                                                                            Processing...
                                                                        </>
                                                                    ) : (
                                                                        'Top Up'
                                                                    )}
                                                                </button>
                                                            </div>
                                                            
                                                            {icpToCyclesRate && (
                                                                <div style={{ 
                                                                    marginTop: '10px',
                                                                    fontSize: '11px',
                                                                    color: theme.colors.mutedText,
                                                                }}>
                                                                    ≈ {canisterTopUpAmount && parseFloat(canisterTopUpAmount) > 0 
                                                                        ? formatCyclesCompact(parseFloat(canisterTopUpAmount) * icpToCyclesRate)
                                                                        : '0'} cycles
                                                                    {' '}(1 ICP ≈ {formatCyclesCompact(icpToCyclesRate)})
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                            </>
                            )}
                        </div>
                    </div>
                )}

                {/* Transfer Neuron Manager Modal */}
                {transferModalOpen && transferTargetManager && (() => {
                    const dangerPrimary = '#ef4444';
                    const dangerSecondary = '#dc2626';
                    return (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.75)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000,
                        padding: '20px',
                        backdropFilter: 'blur(4px)'
                    }}>
                        <div style={{
                            background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${dangerPrimary}08 100%)`,
                            borderRadius: '16px',
                            padding: '0',
                            maxWidth: '500px',
                            width: '100%',
                            border: `1px solid ${theme.colors.border}`,
                            boxShadow: `0 20px 60px rgba(0, 0, 0, 0.4), 0 0 40px ${dangerPrimary}15`,
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden'
                        }}>
                            {/* Header */}
                            <div style={{
                                background: `linear-gradient(135deg, ${dangerPrimary}, ${dangerSecondary})`,
                                padding: '1.25rem 1.5rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between'
                            }}>
                                <h3 style={{ 
                                    color: 'white', 
                                    margin: 0,
                                    fontSize: '1.1rem',
                                    fontWeight: '600'
                                }}>
                                    <FaExclamationTriangle size={14} style={{ marginRight: '8px', color: '#f59e0b' }} /> Transfer Neuron Manager
                                </h3>
                                <button
                                    onClick={() => {
                                        setTransferModalOpen(false);
                                        setTransferTargetManager(null);
                                        setTransferRecipient('');
                                        setTransferError('');
                                        setTransferSuccess('');
                                    }}
                                    disabled={transferring}
                                    style={{
                                        background: 'rgba(255, 255, 255, 0.2)',
                                        border: 'none',
                                        fontSize: '1.25rem',
                                        cursor: transferring ? 'not-allowed' : 'pointer',
                                        color: 'white',
                                        width: '32px',
                                        height: '32px',
                                        borderRadius: '8px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        opacity: transferring ? 0.5 : 1
                                    }}
                                >
                                    ×
                                </button>
                            </div>

                            {/* Content */}
                            <div style={{ padding: '1.25rem' }}>
                            <p style={{ 
                                color: theme.colors.mutedText, 
                                fontSize: '0.85rem',
                                marginTop: 0,
                                marginBottom: '20px',
                                lineHeight: 1.5
                            }}>
                                This will transfer full control of the canister to another principal. 
                                <strong style={{ color: dangerPrimary }}> You will lose all access.</strong>
                            </p>
                            
                            <div style={{ marginBottom: '16px' }}>
                                <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '6px', fontWeight: '500', textTransform: 'uppercase' }}>
                                    Canister to Transfer
                                </div>
                                <div style={{ 
                                    color: theme.colors.primaryText, 
                                    fontFamily: 'monospace', 
                                    fontSize: '0.85rem',
                                    backgroundColor: theme.colors.secondaryBg,
                                    padding: '12px',
                                    borderRadius: '10px',
                                    wordBreak: 'break-all',
                                    border: `1px solid ${theme.colors.border}`
                                }}>
                                    {transferTargetManager.canisterId.toText()}
                                </div>
                            </div>
                            
                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ 
                                    color: theme.colors.mutedText, 
                                    fontSize: '0.75rem', 
                                    display: 'block', 
                                    marginBottom: '6px',
                                    fontWeight: '500',
                                    textTransform: 'uppercase'
                                }}>
                                    Recipient Principal ID
                                </label>
                                <PrincipalInput
                                    value={transferRecipient}
                                    onChange={setTransferRecipient}
                                    placeholder="Enter recipient principal or name"
                                    disabled={transferring}
                                    defaultFilter="users"
                                    style={{ width: '100%' }}
                                />
                            </div>
                            
                            {transferError && (
                                <div style={{ 
                                    backgroundColor: `${theme.colors.error}15`,
                                    border: `1px solid ${theme.colors.error}30`,
                                    color: theme.colors.error,
                                    padding: '12px',
                                    borderRadius: '10px',
                                    fontSize: '0.85rem',
                                    marginBottom: '16px'
                                }}>
                                    {transferError}
                                </div>
                            )}
                            
                            {transferSuccess && (
                                <div style={{ 
                                    backgroundColor: `${theme.colors.success || '#22c55e'}15`,
                                    border: `1px solid ${theme.colors.success || '#22c55e'}30`,
                                    color: theme.colors.success || '#22c55e',
                                    padding: '12px',
                                    borderRadius: '10px',
                                    fontSize: '0.85rem',
                                    marginBottom: '16px'
                                }}>
                                    {transferSuccess}
                                </div>
                            )}
                            
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button
                                    onClick={() => {
                                        setTransferModalOpen(false);
                                        setTransferTargetManager(null);
                                        setTransferRecipient('');
                                        setTransferError('');
                                        setTransferSuccess('');
                                    }}
                                    disabled={transferring}
                                    style={{
                                        flex: 1,
                                        padding: '14px 20px',
                                        borderRadius: '10px',
                                        border: `1px solid ${theme.colors.border}`,
                                        backgroundColor: theme.colors.secondaryBg,
                                        color: theme.colors.primaryText,
                                        cursor: transferring ? 'not-allowed' : 'pointer',
                                        fontSize: '0.95rem',
                                        fontWeight: '500'
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleTransferManager}
                                    disabled={transferring || !transferRecipient.trim()}
                                    style={{
                                        flex: 2,
                                        padding: '14px 20px',
                                        borderRadius: '10px',
                                        border: 'none',
                                        background: (transferring || !transferRecipient.trim()) 
                                            ? theme.colors.tertiaryBg 
                                            : `linear-gradient(135deg, ${dangerPrimary}, ${dangerSecondary})`,
                                        color: (transferring || !transferRecipient.trim()) 
                                            ? theme.colors.mutedText 
                                            : 'white',
                                        cursor: (transferring || !transferRecipient.trim()) ? 'not-allowed' : 'pointer',
                                        fontSize: '0.95rem',
                                        fontWeight: '600',
                                        boxShadow: (transferring || !transferRecipient.trim()) 
                                            ? 'none' 
                                            : `0 4px 12px ${dangerPrimary}40`
                                    }}
                                >
                                    {transferring ? <><FaSync size={12} style={{ marginRight: '6px', animation: 'spin 1s linear infinite' }} /> Transferring...</> : <><FaExclamationTriangle size={12} style={{ marginRight: '6px' }} /> Transfer Control</>}
                                </button>
                            </div>
                            </div>
                        </div>
                    </div>
                    );
                })()}

                {/* Transfer Canister Modal */}
                {transferCanisterModalOpen && transferTargetCanister && (() => {
                    const dangerPrimary = '#ef4444';
                    const dangerSecondary = '#dc2626';
                    return (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.75)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000,
                        padding: '20px',
                        backdropFilter: 'blur(4px)'
                    }}>
                        <div style={{
                            background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${dangerPrimary}08 100%)`,
                            borderRadius: '16px',
                            padding: '0',
                            maxWidth: '500px',
                            width: '100%',
                            border: `1px solid ${theme.colors.border}`,
                            boxShadow: `0 20px 60px rgba(0, 0, 0, 0.4), 0 0 40px ${dangerPrimary}15`,
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden'
                        }}>
                            {/* Header */}
                            <div style={{
                                background: `linear-gradient(135deg, ${dangerPrimary}, ${dangerSecondary})`,
                                padding: '1.25rem 1.5rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between'
                            }}>
                                <h3 style={{ 
                                    color: 'white', 
                                    margin: 0,
                                    fontSize: '1.1rem',
                                    fontWeight: '600'
                                }}>
                                    <FaExclamationTriangle size={14} style={{ marginRight: '8px', color: '#f59e0b' }} /> Transfer Canister
                                </h3>
                                <button
                                    onClick={() => {
                                        setTransferCanisterModalOpen(false);
                                        setTransferTargetCanister(null);
                                        setTransferCanisterRecipient('');
                                        setTransferCanisterError('');
                                        setTransferCanisterSuccess('');
                                    }}
                                    disabled={transferringCanister}
                                    style={{
                                        background: 'rgba(255, 255, 255, 0.2)',
                                        border: 'none',
                                        fontSize: '1.25rem',
                                        cursor: transferringCanister ? 'not-allowed' : 'pointer',
                                        color: 'white',
                                        width: '32px',
                                        height: '32px',
                                        borderRadius: '8px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        opacity: transferringCanister ? 0.5 : 1
                                    }}
                                >
                                    ×
                                </button>
                            </div>

                            {/* Content */}
                            <div style={{ padding: '1.25rem' }}>
                            <p style={{ 
                                color: theme.colors.mutedText, 
                                fontSize: '0.85rem',
                                marginTop: 0,
                                marginBottom: '20px',
                                lineHeight: 1.5
                            }}>
                                This will transfer full control of the canister to another principal. 
                                <strong style={{ color: dangerPrimary }}> You will lose all access.</strong>
                            </p>
                            
                            <div style={{ marginBottom: '16px' }}>
                                <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '6px', fontWeight: '500', textTransform: 'uppercase' }}>
                                    Canister to Transfer
                                </div>
                                <div style={{ 
                                    color: theme.colors.primaryText, 
                                    fontFamily: 'monospace', 
                                    fontSize: '0.85rem',
                                    backgroundColor: theme.colors.secondaryBg,
                                    padding: '12px',
                                    borderRadius: '10px',
                                    wordBreak: 'break-all',
                                    border: `1px solid ${theme.colors.border}`
                                }}>
                                    {transferTargetCanister}
                                </div>
                            </div>
                            
                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ 
                                    color: theme.colors.mutedText, 
                                    fontSize: '0.75rem', 
                                    display: 'block', 
                                    marginBottom: '6px',
                                    fontWeight: '500',
                                    textTransform: 'uppercase'
                                }}>
                                    Recipient Principal ID
                                </label>
                                <PrincipalInput
                                    value={transferCanisterRecipient}
                                    onChange={setTransferCanisterRecipient}
                                    placeholder="Enter recipient principal or name"
                                    disabled={transferringCanister}
                                    defaultFilter="users"
                                    style={{ width: '100%' }}
                                />
                            </div>
                            
                            {transferCanisterError && (
                                <div style={{ 
                                    backgroundColor: `${theme.colors.error}15`,
                                    border: `1px solid ${theme.colors.error}30`,
                                    color: theme.colors.error,
                                    padding: '12px',
                                    borderRadius: '10px',
                                    fontSize: '0.85rem',
                                    marginBottom: '16px'
                                }}>
                                    {transferCanisterError}
                                </div>
                            )}
                            
                            {transferCanisterSuccess && (
                                <div style={{ 
                                    backgroundColor: `${theme.colors.success || '#22c55e'}15`,
                                    border: `1px solid ${theme.colors.success || '#22c55e'}30`,
                                    color: theme.colors.success || '#22c55e',
                                    padding: '12px',
                                    borderRadius: '10px',
                                    fontSize: '0.85rem',
                                    marginBottom: '16px'
                                }}>
                                    {transferCanisterSuccess}
                                </div>
                            )}
                            
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button
                                    onClick={() => {
                                        setTransferCanisterModalOpen(false);
                                        setTransferTargetCanister(null);
                                        setTransferCanisterRecipient('');
                                        setTransferCanisterError('');
                                        setTransferCanisterSuccess('');
                                    }}
                                    disabled={transferringCanister}
                                    style={{
                                        flex: 1,
                                        padding: '14px 20px',
                                        borderRadius: '10px',
                                        border: `1px solid ${theme.colors.border}`,
                                        backgroundColor: theme.colors.secondaryBg,
                                        color: theme.colors.primaryText,
                                        cursor: transferringCanister ? 'not-allowed' : 'pointer',
                                        fontSize: '0.95rem',
                                        fontWeight: '500'
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleCanisterTransfer}
                                    disabled={transferringCanister || !transferCanisterRecipient.trim()}
                                    style={{
                                        flex: 2,
                                        padding: '14px 20px',
                                        borderRadius: '10px',
                                        border: 'none',
                                        background: (transferringCanister || !transferCanisterRecipient.trim()) 
                                            ? theme.colors.tertiaryBg 
                                            : `linear-gradient(135deg, ${dangerPrimary}, ${dangerSecondary})`,
                                        color: (transferringCanister || !transferCanisterRecipient.trim()) 
                                            ? theme.colors.mutedText 
                                            : 'white',
                                        cursor: (transferringCanister || !transferCanisterRecipient.trim()) ? 'not-allowed' : 'pointer',
                                        fontSize: '0.95rem',
                                        fontWeight: '600',
                                        boxShadow: (transferringCanister || !transferCanisterRecipient.trim()) 
                                            ? 'none' 
                                            : `0 4px 12px ${dangerPrimary}40`
                                    }}
                                >
                                    {transferringCanister ? <><FaSync size={12} style={{ marginRight: '6px', animation: 'spin 1s linear infinite' }} /> Transferring...</> : <><FaExclamationTriangle size={12} style={{ marginRight: '6px' }} /> Transfer Control</>}
                                </button>
                            </div>
                            </div>
                        </div>
                    </div>
                    );
                })()}

                <AddSwapCanisterModal
                    show={showAddSwapModal}
                    onClose={() => setShowAddSwapModal(false)}
                    onSubmit={handleAddSwapCanister}
                />
                <AddLedgerCanisterModal
                    show={showAddLedgerModal}
                    onClose={() => setShowAddLedgerModal(false)}
                    onSubmit={handleAddLedgerCanister}
                />
                <SendTokenModal
                    show={showSendModal}
                    onClose={() => setShowSendModal(false)}
                    onSend={handleSendToken}
                    token={selectedToken}
                />
                <WithdrawTokenModal
                    show={showWithdrawModal}
                    onClose={() => setShowWithdrawModal(false)}
                    onWithdraw={handleWithdrawTokenFromBackend}
                    token={selectedToken}
                />
                <DepositTokenModal
                    show={showDepositModal}
                    onClose={() => setShowDepositModal(false)}
                    onDeposit={handleDepositTokenToBackend}
                    token={selectedToken}
                />
                <WrapUnwrapModal
                    show={showWrapUnwrapModal}
                    onClose={() => setShowWrapUnwrapModal(false)}
                    onWrap={handleWrap}
                    onUnwrap={handleUnwrap}
                    token={selectedToken}
                    gldtToken={tokens.find(t => normalizeId(t.ledger_canister_id) === GLDT_CANISTER_ID || normalizeId(t.principal) === GLDT_CANISTER_ID)}
                />
                <LockModal
                    show={showLockModal}
                    onClose={() => setShowLockModal(false)}
                    token={selectedToken}
                    locks={locks}
                    onAddLock={handleAddLock}
                    identity={identity}
                    isPremium={isPremium}
                />
                <SendLiquidityPositionModal
                    show={showSendLiquidityPositionModal}
                    onClose={() => setShowSendLiquidityPositionModal(false)}
                    onSend={handleSendLiquidityPosition}
                    liquidityPosition={selectedLiquidityPosition}
                />
                <LockPositionModal
                    show={showLockPositionModal}
                    onClose={() => setShowLockPositionModal(false)}
                    liquidityPosition={selectedLiquidityPosition}
                    onAddLockPosition={handleAddLockPosition}
                    identity={identity}
                    isPremium={isPremium}
                />
                <ConfirmationModal
                    show={showConfirmModal}
                    onClose={() => setShowConfirmModal(false)}
                    onSubmit={confirmAction}
                    message={confirmMessage}
                    doAwait={true}
                />
                <TransferTokenLockModal
                    show={showTransferTokenLockModal}
                    onClose={() => setShowTransferTokenLockModal(false)}
                    onTransfer={handleTransferTokenLock}
                    tokenLock={selectedTokenLock}
                    token={selectedTokenLock?.token}
                />
                <ConsolidateModal
                    isOpen={showConsolidateModal}
                    onClose={() => setShowConsolidateModal(false)}
                    type={consolidateType}
                    items={consolidateItems}
                    onConsolidate={handleConsolidateItem}
                />
                
                {/* Debug Report Modal (Admin only) */}
                {showDebugReportModal && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.7)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10000,
                        padding: '20px'
                    }} onClick={() => setShowDebugReportModal(false)}>
                        <div style={{
                            background: theme.colors.primaryBg,
                            borderRadius: '12px',
                            padding: '20px',
                            maxWidth: '800px',
                            maxHeight: '80vh',
                            width: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px'
                        }} onClick={(e) => e.stopPropagation()}>
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                borderBottom: `1px solid ${theme.colors.border}`,
                                paddingBottom: '12px'
                            }}>
                                <h3 style={{ 
                                    margin: 0, 
                                    color: theme.colors.primaryText,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}>
                                    <FaBug /> /wallet Debug Report
                                </h3>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(generateDebugReport());
                                            setDebugReportCopied(true);
                                            setTimeout(() => setDebugReportCopied(false), 2000);
                                        }}
                                        style={{
                                            background: debugReportCopied ? '#10b981' : theme.colors.accent,
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '6px',
                                            padding: '8px 12px',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            fontSize: '0.85rem'
                                        }}
                                    >
                                        {debugReportCopied ? <FaCheck /> : <FaCopy />}
                                        {debugReportCopied ? 'Copied!' : 'Copy'}
                                    </button>
                                    <button
                                        onClick={() => setShowDebugReportModal(false)}
                                        style={{
                                            background: 'transparent',
                                            border: `1px solid ${theme.colors.border}`,
                                            borderRadius: '6px',
                                            padding: '8px 12px',
                                            cursor: 'pointer',
                                            color: theme.colors.primaryText,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            fontSize: '0.85rem'
                                        }}
                                    >
                                        <FaTimes /> Close
                                    </button>
                                </div>
                            </div>
                            <pre style={{
                                flex: 1,
                                overflow: 'auto',
                                background: theme.colors.secondaryBg,
                                padding: '12px',
                                borderRadius: '6px',
                                fontSize: '0.75rem',
                                fontFamily: 'monospace',
                                color: theme.colors.primaryText,
                                whiteSpace: 'pre-wrap',
                                margin: 0
                            }}>
                                {generateDebugReport()}
                            </pre>
                        </div>
                    </div>
                )}
                
                <TokenCardModal
                    show={showTokenDetailModal}
                    onClose={() => setShowTokenDetailModal(false)}
                    token={detailToken}
                    locks={locks}
                    lockDetailsLoading={lockDetailsLoading}
                    rewardDetailsLoading={rewardDetailsLoading}
                    openSendModal={openSendModal}
                    openLockModal={openLockModal}
                    openWrapModal={openWrapModal}
                    openUnwrapModal={openUnwrapModal}
                    handleClaimRewards={handleClaimRewards}
                    handleWithdrawFromBackend={handleWithdrawFromBackend}
                    handleDepositToBackend={handleDepositToBackend}
                    handleRefreshToken={handleRefreshToken}
                    isRefreshing={detailToken ? refreshingTokens.has(normalizeId(detailToken.ledger_canister_id)) : false}
                    isSnsToken={detailToken ? snsTokens.has(normalizeId(detailToken.ledger_canister_id)) : false}
                />
                <DappCardModal
                    show={showDappDetailModal}
                    onClose={() => {
                        setShowDappDetailModal(false);
                        setDetailDapp(null);
                    }}
                    canisterId={detailDapp?.canisterId}
                    cycles={detailDapp?.cycles}
                    memory={detailDapp?.memory}
                    isController={detailDapp?.isController}
                    isNeuronManager={detailDapp?.isNeuronManager}
                    neuronManagerVersion={detailDapp?.neuronManagerVersion}
                    neuronCount={detailDapp?.neuronCount}
                    handleRefresh={handleRefreshDappModal}
                    isRefreshing={isRefreshingDapp}
                    neuronsData={detailDapp?.neuronsData}
                />
                    </>
                )}
            </div>
        </div>
    );
}

export default Wallet;