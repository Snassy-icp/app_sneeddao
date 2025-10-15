// Wallet.jsx
import { principalToSubAccount } from "@dfinity/utils";
import { Principal } from "@dfinity/principal";
import React, { useState, useEffect, useRef } from 'react';
import { app_sneeddao_backend, createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId  } from 'external/sneed_lock';
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
import { get_short_timezone, format_duration, bigDateToReadable, dateToReadable } from './utils/DateUtils';
import { formatAmount, toJsonString } from './utils/StringUtils';
import TokenCard from './TokenCard';
import PositionCard from './PositionCard';
import { get_available, get_available_backend, getTokenLogo, get_token_conversion_rate, get_token_icp_rate, getTokenTVL, getTokenMetaForSwap } from './utils/TokenUtils';
import { getPositionTVL } from "./utils/PositionUtils";
import { headerStyles } from './styles/HeaderStyles';
import { createActor as createSnsGovernanceActor, canisterId as snsGovernanceCanisterId } from 'external/sns_governance';
import { fetchAndCacheSnsData, getAllSnses } from './utils/SnsUtils';
import { createActor as createForumActor, canisterId as forumCanisterId } from 'declarations/sneed_sns_forum';
import Header from './components/Header';
import { fetchUserNeurons, fetchUserNeuronsForSns } from './utils/NeuronUtils';
import { getTipTokensReceivedByUser } from './utils/BackendUtils';

// Component for empty position cards (when no positions exist for a swap pair)
const EmptyPositionCard = ({ position, onRemove, handleRefreshPosition, isRefreshing, theme }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const handleHeaderClick = () => {
        setIsExpanded(!isExpanded);
    };

    return (
        <div className="card">
            <div className="card-header" onClick={handleHeaderClick}>
                <div className="header-logo-column">
                    <img src={position.token0Logo} alt={position.token0Symbol} className="swap-token-logo1" />
                    <img src={position.token1Logo} alt={position.token1Symbol} className="swap-token-logo2" />
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
                                    {isRefreshing ? '⏳' : '🔄'}
                                </button>
                            )}
                            <span className="expand-indicator">{isExpanded ? '▼' : '▶'}</span>
                        </div>
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
const SectionHeader = ({ title, isExpanded, onToggle, onAdd, addButtonText, theme }) => {
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
            </div>
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
    const navigate = useNavigate();
    const location = useLocation();
    const [tokens, setTokens] = useState([]);
    const [showSendModal, setShowSendModal] = useState(false);
    const [showWrapUnwrapModal, setShowWrapUnwrapModal] = useState(false);
    const [showWithdrawModal, setShowWithdrawModal] = useState(false);
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
    const [liquidityPositions, setLiquidityPositions] = useState([]);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [showPositionsSpinner, setShowPositionsSpinner] = useState(true);
    const [showTokensSpinner, setShowTokensSpinner] = useState(true);
    const [lockDetailsLoading, setLockDetailsLoading] = useState({});
    const [refreshingTokens, setRefreshingTokens] = useState(new Set());
    const [refreshingPositions, setRefreshingPositions] = useState(new Set());
    const [tokensExpanded, setTokensExpanded] = useState(true);
    const [positionsExpanded, setPositionsExpanded] = useState(true);
    const [principalExpanded, setPrincipalExpanded] = useState(() => {
        try {
            const saved = localStorage.getItem('principalExpanded_Wallet');
            return saved !== null ? JSON.parse(saved) : true;
        } catch (error) {
            console.warn('Could not read principalExpanded state from localStorage:', error);
            return true; // Default to expanded
        }
    });
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const [confirmMessage, setConfirmMessage] = useState('');
    const [rewardDetailsLoading, setRewardDetailsLoading] = useState({});
    const [totalDollarValue, setTotalDollarValue] = useState(0.0);
    const [snsTokens, setSnsTokens] = useState(new Set()); // Set of ledger canister IDs that are SNS tokens
    const [neuronTotals, setNeuronTotals] = useState({}); // Track neuron USD values by token ledger ID
    const [totalBreakdown, setTotalBreakdown] = useState({
        liquid: 0.0,
        maturity: 0.0,
        rewards: 0.0,
        staked: 0.0,
        locked: 0.0
    });

    const dex_icpswap = 1;
 
    // Save principalExpanded state to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('principalExpanded_Wallet', JSON.stringify(principalExpanded));
        } catch (error) {
            console.warn('Could not save principalExpanded state to localStorage:', error);
        }
    }, [principalExpanded]);

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

    useEffect(() => {
        if (!isAuthenticated) {
            // Don't redirect - stay on wallet page and show login message
            return;
        }

        // Reset states and cache when component mounts
        setTokens([]);
        setLiquidityPositions([]);
        Object.keys(known_icrc1_ledgers).forEach(key => delete known_icrc1_ledgers[key]);
        
        fetchBalancesAndLocks();
        fetchLiquidityPositions();
    }, [isAuthenticated, location.search, refreshTrigger]);

    async function fetchTokenDetails(icrc1_ledger, summed_locks) {
        try {

            const ledgerActor = createLedgerActor(icrc1_ledger);
            const metadata = await ledgerActor.icrc1_metadata();
            var logo = getTokenLogo(metadata);
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
        if (for_ledger_id) {
            setRewardDetailsLoading(prevState => ({
                ...prevState,
                [for_ledger_id.toText()]: BigInt(-1)
            }));
        } else {
            setRewardDetailsLoading({});
        }
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
            const ledger_id = balance[0].toText();
            new_reward_balances[ledger_id] = BigInt(balance[1]);
            if (!known_icrc1_ledgers[ledger_id]) {
                known_icrc1_ledgers[ledger_id] = true;
                new_icrc1_ledgers[new_icrc1_ledgers.length] = balance[0];
            }
        };

        if (for_ledger_id) {
            setRewardDetailsLoading(prevState => ({
                ...prevState,
                [for_ledger_id.toText()]: new_reward_balances[for_ledger_id.toText()]
            }));
        } else {
            if (Object.keys(new_reward_balances).length === 0) {
                setRewardDetailsLoading({ "aaaa-aa" : -1 }); // make non-empty to prevent forever spinners
            } else {
                setRewardDetailsLoading(new_reward_balances);
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
                    token.ledger_canister_id?.toText?.() === icrc1_ledger.toText() ? updatedToken : token
                ));
                return updatedToken;
            }));

            fetchLockDetails(allUpdatedTokens);
        }
    }

    async function fetchTipTokens(for_ledger_id) {
        try {
            // Create forum actor to get tips received by user
            const forumActor = createForumActor(forumCanisterId, {
                agentOptions: {
                    host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
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
                        token.ledger_canister_id?.toText?.() === icrc1_ledger.toText() ? updatedToken : token
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
        setShowTokensSpinner(true);
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
            for (const ledger of registered_icrc1_ledgers) {
                const ledger_id = ledger.toText();
                if (!known_icrc1_ledgers[ledger_id]) {
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
                    const existingIndex = prevTokens.findIndex(token => 
                        token.ledger_canister_id?.toText?.() === single_refresh_ledger_canister_id?.toText?.()
                    );
                    
                    if (existingIndex >= 0) {
                        // Update existing token
                        return prevTokens.map(token => 
                            token.ledger_canister_id?.toText?.() === single_refresh_ledger_canister_id?.toText?.() ? updatedToken : token
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
            setShowTokensSpinner(false);
        }
    }

    // Fetch the liquidity positions from the backend and update the state
    async function fetchLiquidityPositions() {
        setShowPositionsSpinner(true);
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
        } finally { 
            setShowPositionsSpinner(false);
        }
    }

    async function fetchLockDetails(currentTokens) {
        // Initialize lockDetailsLoading state
        const initialLoadingState = {};
        currentTokens.forEach(token => {
            initialLoadingState[token.ledger_canister_id] = true;
        });
        setLockDetailsLoading(prevState => ({...prevState, ...initialLoadingState}))

        const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
        if (await sneedLockActor.has_expired_locks()) {
            await sneedLockActor.clear_expired_locks();
        }
        const locks_from_backend = await sneedLockActor.get_token_locks();

        // Fetch lock details for each token in parallel
        await Promise.all(currentTokens.map(async (token) => {
            const ledgerActor = createLedgerActor(token.ledger_canister_id);
            try {

                const tokenLocks = [];
    
                for (const lock of locks_from_backend) {
                    if (lock[1]?.toText?.() == token.ledger_canister_id?.toText?.()) {
                        const readableDateFromHugeInt = new Date(Number(lock[3] / (10n ** 6n)));
                        tokenLocks.push({
                            lock_id: lock[0],
                            amount: lock[2],
                            expiry: readableDateFromHugeInt
                        });
                    }
                }
    
                // Update locks state for this token
                setLocks(prevLocks => ({
                    ...prevLocks,
                    [token.ledger_canister_id]: tokenLocks
                }));
    
                // Update loading state for this token
                setLockDetailsLoading(prevState => ({
                    ...prevState,
                    [token.ledger_canister_id]: false
                }));
    
            } catch (err) {

                console.error('Error fetching lock details: ', err);
                //console.error(er);
                setLockDetailsLoading(prevState => ({
                    ...prevState,
                    [token.ledger_canister_id]: false
                }));

            }
        }));
    }

    useEffect(() => {
        var total = 0.0;
        var liquidTotal = 0.0;
        var lockedTotal = 0.0;
        var rewardsTotal = 0.0;
        var stakedTotal = 0.0;
        var maturityTotal = 0.0;
        
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
            const ledgerId = token.ledger_canister_id?.toString?.() || token.ledger_canister_id?.toText?.() || token.ledger_canister_id;
            if (rewardDetailsLoading && rewardDetailsLoading[token.ledger_canister_id] != null && BigInt(rewardDetailsLoading[token.ledger_canister_id]) > 0) {
                const rewardAmount = Number(BigInt(rewardDetailsLoading[token.ledger_canister_id])) / divisor * rate;
                rewardsTotal += rewardAmount;
            }
            
            // Add neuron breakdown (staked + maturity) if available
            if (neuronTotals[ledgerId]) {
                const neuronData = neuronTotals[ledgerId];
                if (typeof neuronData === 'object') {
                    stakedTotal += neuronData.staked || 0;
                    maturityTotal += neuronData.maturity || 0;
                } else {
                    // Legacy support: if it's just a number, add to staked
                    stakedTotal += neuronData || 0;
                }
            }
            
            // Get base token TVL (liquid + locked + rewards)
            const baseTVL = getTokenTVL(token, rewardDetailsLoading, false);
            total += baseTVL;
            
            // Add neuron totals
            if (neuronTotals[ledgerId]) {
                const neuronData = neuronTotals[ledgerId];
                if (typeof neuronData === 'object') {
                    total += neuronData.total || 0;
                } else {
                    total += neuronData || 0;
                }
            }
        }

        for (const lp of liquidityPositions) {
            for (const positionDetails of lp.positions) {
                total += getPositionTVL(lp, positionDetails, false);
            }
        }

        // Format with commas and 2 decimals
        const formattedTotal = total.toLocaleString(undefined, { 
            minimumFractionDigits: 2, 
            maximumFractionDigits: 2 
        });

        setTotalDollarValue(formattedTotal);
        setTotalBreakdown({
            liquid: liquidTotal,
            maturity: maturityTotal,
            rewards: rewardsTotal,
            staked: stakedTotal,
            locked: lockedTotal
        });
    }, [tokens, liquidityPositions, rewardDetailsLoading, neuronTotals]);

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

    const handleSendToken = async (token, recipient, amount) => {
        console.log('=== Wallet.handleSendToken START ===');
        console.log('Parameters:', { 
            tokenSymbol: token.symbol, 
            recipient, 
            amount,
            tokenAvailable: token.available?.toString(),
            tokenFee: token.fee?.toString()
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
                
                const result = await sneedLockActor.transfer_tokens(
                    recipientPrincipal,
                    [],
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
                
                const result = await actor.icrc1_transfer({
                    to: { owner: recipientPrincipal, subaccount: [] },
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
        const sgldtExists = tokens.find(t => t.ledger_canister_id?.toText() === SGLDT_CANISTER_ID);
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
        const gldtExists = tokens.find(t => t.ledger_canister_id?.toText() === GLDT_CANISTER_ID);
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

            /*await*/ fetchLiquidityPositions();
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

                // Refresh the liquidity positions
                await fetchLiquidityPositions();
                console.log('=== Position withdrawal completed ===');
                
            } catch (error) {
                console.error('=== Position withdrawal error ===');
                console.error('Error details:', error);
                throw error;
            }
        });

        setConfirmMessage(`You are about to withdraw position #${liquidityPosition.id} (${liquidityPosition.symbols}) from the backend to your frontend wallet. Continue?`);
        setShowConfirmModal(true);
    };

    const openSendLiquidityPositionModal = (liquidityPosition) => {
        setSelectedLiquidityPosition(liquidityPosition);
        setShowSendLiquidityPositionModal(true);
    };

    const handleAddLock = async (token, amount, expiry) => {
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

    const handleAddLockPosition = async (position, expiry) => {
        var result = { "Ok": true };

        const swapActor = createIcpSwapActor(position.swapCanisterId, { agentOptions: { identity } });
        const userPositionIds = (await swapActor.getUserPositionIdsByPrincipal(identity.getPrincipal())).ok;
        const frontendOwnership = userPositionIds.includes(position.id);
        if (frontendOwnership) {

            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });

            // Only try to lock if we have been able to claim the position on the backend
            if (await sneedLockActor.claim_position(position.swapCanisterId, position.id)) {
                result = await swapActor.transferPosition(
                    identity.getPrincipal(), 
                    Principal.fromText(sneedLockCanisterId), 
                    position.id);

                if (!result["err"]) {
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

        // we don't need to wait for this, but it is nice to trigger a refresh here.
        if (result["Ok"]) { /*await*/ fetchLiquidityPositions(); }

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

            // Refresh liquidity positions to update the UI
            await fetchLiquidityPositions();
            
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
            throw new Error('Fee claiming is only available for positions in your frontend wallet');
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

            // Refresh liquidity positions to update the UI
            await fetchLiquidityPositions();
            
            console.log('=== Claim process completed ===');

        } catch (error) {
            console.error('=== Error claiming position fees ===');
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

            // Refresh liquidity positions to update the UI
            await fetchLiquidityPositions();
            
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

        /*await*/ fetchLiquidityPositions();
    };

    const handleUnregisterToken = async (ledgerCanisterId) => {
        setConfirmAction(() => async () => {
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            await backendActor.unregister_ledger_canister_id(ledgerCanisterId);
            
            // Remove the token from state and mark as unknown
            const ledger_id = ledgerCanisterId.toText();
            delete known_icrc1_ledgers[ledger_id];
            
            setTokens(prevTokens => prevTokens.filter(token => 
                token.ledger_canister_id?.toText?.() !== ledger_id
            ));
        });
        setConfirmMessage(`You are about to unregister ledger canister ${ledgerCanisterId}?`);
        setShowConfirmModal(true);
    };

    const handleUnregisterSwapCanister = async (swapCanisterId) => {
        setConfirmAction(() => async () => {
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            await backendActor.unregister_swap_canister_id(swapCanisterId);
            /*await*/ fetchLiquidityPositions();
        });
        setConfirmMessage(`You are about to unregister swap canister ${swapCanisterId}?`);
        setShowConfirmModal(true);
    };

    const handleClaimRewards = async (token) => {
        setConfirmAction(() => async () => {
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            const claim_results = await rllActor.claim_full_balance_of_hotkey(
                token.ledger_canister_id,
                token.fee);
            /*await*/ fetchBalancesAndLocks(token.ledger_canister_id);
        });
        setConfirmMessage(`Do you want to claim your rewards of ${formatAmount(BigInt(rewardDetailsLoading[token.ledger_canister_id]), token.decimals)} ${token.symbol}?`);
        setShowConfirmModal(true);
    };

    const handleRefreshToken = async (token) => {
        const ledgerId = token.ledger_canister_id;
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
        
        // Mark as refreshing
        setRefreshingPositions(prev => new Set(prev).add(swap_canister));
        
        try {
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });

            // Get claimed positions for this swap
            const claimed_positions = await sneedLockActor.get_claimed_positions_for_principal(identity.getPrincipal());
            const claimed_positions_for_swap = claimed_positions.filter(cp => cp.swap_canister_id === swap_canister);
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
                p.swapCanisterId === swap_canister ? updatedPosition : p
            ));
        } catch (error) {
            console.error('Error refreshing position:', error);
        } finally {
            // Clear refreshing state
            setRefreshingPositions(prev => {
                const next = new Set(prev);
                next.delete(swap_canister);
                return next;
            });
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
                }
            `}</style>
            <Header />
            <div 
                className="wallet-container"
                style={{
                    backgroundColor: 'transparent'
                }}
            >
                {/* Your Sneed Wallet Principal */}
                {isAuthenticated && identity && (
                    <div style={{
                        background: theme.colors.cardGradient,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '12px',
                        marginBottom: '20px',
                        boxShadow: theme.colors.cardShadow,
                        overflow: 'hidden'
                    }}>
                        {/* Collapsible Header */}
                        <div 
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                padding: '16px 20px',
                                borderBottom: principalExpanded ? `1px solid ${theme.colors.border}` : 'none'
                            }}
                        >
                            <span 
                                style={{
                                    fontSize: '1.2rem',
                                    color: theme.colors.secondaryText,
                                    transition: 'transform 0.2s ease',
                                    cursor: 'pointer'
                                }}
                                onClick={() => setPrincipalExpanded(!principalExpanded)}
                            >
                                {principalExpanded ? '▼' : '▶'}
                            </span>
                            <div 
                                style={{
                                    color: theme.colors.mutedText,
                                    fontSize: '14px',
                                    letterSpacing: '1px',
                                    textTransform: 'uppercase',
                                    fontWeight: '600',
                                    flex: 1,
                                    cursor: 'pointer'
                                }}
                                onClick={() => setPrincipalExpanded(!principalExpanded)}
                            >
                                <span className="principal-full-text">Your Sneed Wallet Principal</span>
                                <span className="principal-short-text" style={{ display: 'none' }}>Your Principal</span>
                            </div>
                            <Link 
                                to="/help/wallet"
                                style={{
                                    color: theme.colors.accent,
                                    textDecoration: 'none',
                                    fontSize: '0.9rem',
                                    fontWeight: '500',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '6px 10px',
                                    borderRadius: '6px',
                                    transition: 'all 0.2s ease',
                                    background: `${theme.colors.accent}15`,
                                    border: `1px solid ${theme.colors.accent}30`
                                }}
                                onMouseEnter={(e) => {
                                    e.target.style.background = `${theme.colors.accent}25`;
                                    e.target.style.borderColor = theme.colors.accent;
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.background = `${theme.colors.accent}15`;
                                    e.target.style.borderColor = `${theme.colors.accent}30`;
                                }}
                            >
                                <span style={{ fontSize: '0.95rem' }}>❓</span>
                                <span style={{ whiteSpace: 'nowrap' }}>Wallet Help</span>
                            </Link>
                        </div>

                        {/* Collapsible Content */}
                        {principalExpanded && (
                            <div style={{ padding: '20px' }}>
                                <div style={{
                                    color: theme.colors.primaryText,
                                    fontSize: '16px',
                                    fontWeight: '500',
                                    marginBottom: '12px',
                                    wordBreak: 'break-all',
                                    fontFamily: 'monospace',
                                    background: theme.colors.tertiaryBg,
                                    padding: '12px',
                                    borderRadius: '8px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '12px',
                                    flexWrap: 'wrap'
                                }}>
                                    <span style={{ flex: 1, minWidth: '200px' }}>
                                        {identity.getPrincipal().toText()}
                                    </span>
                                    <button
                                        onClick={async () => {
                                            try {
                                                await navigator.clipboard.writeText(identity.getPrincipal().toText());
                                                // Could add a toast notification here
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
                                <div style={{
                                    color: theme.colors.secondaryText,
                                    fontSize: '14px',
                                    lineHeight: '1.6'
                                }}>
                                    Use this principal to send tokens, LP positions, or neurons to your Sneed Wallet. 
                                    You can also add this as a hotkey to your neurons on the NNS dApp to manage them from Sneed Hub.
                                </div>
                            </div>
                        )}
                    </div>
                )}
                
                {/* Total Value Display */}
                {totalDollarValue && (
                    <div style={{
                        background: theme.colors.cardGradient,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '12px',
                        padding: '20px',
                        paddingBottom: '16px',
                        marginBottom: '20px',
                        boxShadow: theme.colors.cardShadow,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '16px'
                    }}>
                        {/* Center - Total Value */}
                        <div style={{
                            textAlign: 'center'
                        }}>
                            <div style={{
                                color: theme.colors.mutedText,
                                fontSize: '14px',
                                letterSpacing: '1px',
                                textTransform: 'uppercase',
                                marginBottom: '8px'
                            }}>
                                Total Portfolio Value
                            </div>
                            <div style={{
                                color: theme.colors.primaryText,
                                fontSize: '36px',
                                fontWeight: '600',
                                letterSpacing: '0.5px'
                            }}>
                                ${totalDollarValue}
                            </div>
                        </div>
                        
                        {/* Breakdown fields - single row at bottom */}
                        <div style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '12px',
                            fontSize: '12px',
                            color: theme.colors.secondaryText,
                            alignItems: 'center'
                        }}>
                            {totalBreakdown.liquid > 0 && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                }}>
                                    <span style={{ fontSize: '14px', cursor: 'help' }} title="Liquid">💧</span>
                                    <span className="breakdown-text-label">Liquid: </span>
                                    <span>
                                        ${totalBreakdown.liquid.toLocaleString(undefined, { 
                                            minimumFractionDigits: 2, 
                                            maximumFractionDigits: 2 
                                        })}
                                    </span>
                                </div>
                            )}
                            {totalBreakdown.maturity > 0 && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                }}>
                                    <span style={{ fontSize: '14px', cursor: 'help' }} title="Maturity">🌱</span>
                                    <span className="breakdown-text-label">Maturity: </span>
                                    <span>
                                        ${totalBreakdown.maturity.toLocaleString(undefined, { 
                                            minimumFractionDigits: 2, 
                                            maximumFractionDigits: 2 
                                        })}
                                    </span>
                                </div>
                            )}
                            {totalBreakdown.rewards > 0 && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                }}>
                                    <span style={{ fontSize: '14px', cursor: 'help' }} title="Rewards">🎁</span>
                                    <span className="breakdown-text-label">Rewards: </span>
                                    <span>
                                        ${totalBreakdown.rewards.toLocaleString(undefined, { 
                                            minimumFractionDigits: 2, 
                                            maximumFractionDigits: 2 
                                        })}
                                    </span>
                                </div>
                            )}
                            {totalBreakdown.staked > 0 && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                }}>
                                    <span style={{ fontSize: '14px', cursor: 'help' }} title="Staked">🧠</span>
                                    <span className="breakdown-text-label">Staked: </span>
                                    <span>
                                        ${totalBreakdown.staked.toLocaleString(undefined, { 
                                            minimumFractionDigits: 2, 
                                            maximumFractionDigits: 2 
                                        })}
                                    </span>
                                </div>
                            )}
                            {totalBreakdown.locked > 0 && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                }}>
                                    <span style={{ fontSize: '14px', cursor: 'help' }} title="Locked">🔐</span>
                                    <span className="breakdown-text-label">Locked: </span>
                                    <span>
                                        ${totalBreakdown.locked.toLocaleString(undefined, { 
                                            minimumFractionDigits: 2, 
                                            maximumFractionDigits: 2 
                                        })}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                )}
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
                                🔐 Login Required
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
                <SectionHeader 
                    title="Tokens"
                    isExpanded={tokensExpanded}
                    onToggle={() => setTokensExpanded(!tokensExpanded)}
                    onAdd={() => setShowAddLedgerModal(true)}
                    addButtonText="Add Token"
                    theme={theme}
                />
                {tokensExpanded && (
                    <div className="card-grid">
                    {tokens.map((token, index) => {
                        // Debug logging for each token
                        // Convert Principal to string for comparison
                        const ledgerIdString = typeof token.ledger_canister_id === 'string' 
                            ? token.ledger_canister_id 
                            : token.ledger_canister_id?.toString();
                        const isSns = snsTokens.has(ledgerIdString);
                        //console.log(`[Wallet] Token ${token.symbol}:`, {
                        //    ledger_canister_id: token.ledger_canister_id,
                        //    ledger_canister_id_string: ledgerIdString,
                        //    isSnsToken: isSns,
                        //    snsTokensSet: Array.from(snsTokens)
                        //});
                        
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
                                handleRefreshToken={handleRefreshToken}
                                isRefreshing={refreshingTokens.has(token.ledger_canister_id)}
                                isSnsToken={isSns}
                                onNeuronTotalsChange={(breakdown) => {
                                    const ledgerId = token.ledger_canister_id?.toString?.() || token.ledger_canister_id?.toText?.() || token.ledger_canister_id;
                                    setNeuronTotals(prev => ({
                                        ...prev,
                                        [ledgerId]: breakdown
                                    }));
                                }}
                                openTransferTokenLockModal={openTransferTokenLockModal}
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
                )}
                <SectionHeader 
                    title="Liquidity Positions"
                    isExpanded={positionsExpanded}
                    onToggle={() => setPositionsExpanded(!positionsExpanded)}
                    onAdd={() => setShowAddSwapModal(true)}
                    addButtonText="Add Swap Pair"
                    theme={theme}
                />
                {positionsExpanded && (
                    <div className="card-grid">                
                    {liquidityPositions.map((position, index) => (
                        position.positions.length < 1 
                        ? <EmptyPositionCard 
                            key={index} 
                            position={position} 
                            onRemove={() => handleUnregisterSwapCanister(position.swapCanisterId)}
                            handleRefreshPosition={handleRefreshPosition}
                            isRefreshing={refreshingPositions.has(position.swapCanisterId)}
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
                                handleWithdrawPosition={handleWithdrawPosition}
                                handleWithdrawSwapBalance={handleWithdrawSwapBalance}
                                handleTransferPositionOwnership={handleSendLiquidityPosition}
                                handleRefreshPosition={handleRefreshPosition}
                                isRefreshing={refreshingPositions.has(position.swapCanisterId)}
                                swapCanisterBalance0={position.swapCanisterBalance0}
                                swapCanisterBalance1={position.swapCanisterBalance1}
                                token0Fee={position.token0Fee}
                                token1Fee={position.token1Fee}
                                hideButtons={false}
                                hideUnclaimedFees={false}
                            />
                        ))
                    ))}
                    {showPositionsSpinner ? (
                        <div className="card">
                            <div className="spinner"></div>
                        </div>
                    ) : (
                        <div/>
                    )}
                </div>
                )}
                <SectionHeader 
                    title="What is Sneed Lock?"
                    isExpanded={isSneedLockExpanded}
                    onToggle={() => {
                        const newState = !isSneedLockExpanded;
                        setIsSneedLockExpanded(newState);
                        try {
                            localStorage.setItem('sneedLockDisclaimerExpanded', JSON.stringify(newState));
                        } catch (error) {
                            console.warn('Could not save disclaimer state to localStorage:', error);
                        }
                    }}
                    theme={theme}
                />
                {isSneedLockExpanded && (
                    <div style={{ marginBottom: '20px' }}>
                        <div style={{ 
                            backgroundColor: theme.colors.secondaryBg, 
                            borderRadius: '8px', 
                            padding: '20px',
                            color: theme.colors.primaryText
                        }}>
                            <p><strong>Sneed Lock</strong> is a trustless time-locking service for tokens and liquidity positions, integrated directly into your Sneed Wallet. It allows you to lock assets for a specified period, proving commitment and enabling vesting schedules while building trust in the ICP ecosystem.</p>
                            
                            <p><strong>Key Features:</strong></p>
                            <ul style={{ marginLeft: '20px', marginBottom: '12px' }}>
                                <li><strong>Fee Claiming from Locked LPs:</strong> When you lock a liquidity position, you can still claim trading fees directly from your wallet—even while the position remains locked!</li>
                                <li><strong>Liquid Locking:</strong> Transfer locked tokens and LP positions to other Sneed Wallet users! The locks remain enforced (preventing rugs), but ownership can change. This creates liquidity while maintaining security.</li>
                                <li><strong>Trustless & Immutable:</strong> Locks cannot be canceled or modified by anyone—including you. This ensures genuine commitment.</li>
                            </ul>
                            
                            <p>After registering a token or liquidity position, you can lock it by clicking the lock button in the token or position card. Locked assets cannot be withdrawn until the expiration date.</p>
                            
                            <p><b>⚠️ Important: Do NOT lock tokens or positions you might need access to during the lock period!</b></p>
                            
                            <p>Sneed Lock is ideal for token developers, team members, and investors who want to demonstrate long-term commitment and prevent "rug pulls" by locking large token and liquidity positions. Maximum lock time is 10 years.</p>
                            
                            <p style={{ marginTop: '12px' }}>
                                <Link to="/help/sneedlock" style={{ 
                                    color: theme.colors.accent, 
                                    textDecoration: 'none',
                                    fontWeight: '600'
                                }}>
                                    📚 Learn More About Sneed Lock →
                                </Link>
                            </p>
                            
                            <p style={{ marginTop: '8px', fontSize: '0.9rem', color: theme.colors.mutedText }}>
                                <b>Disclaimer:</b> All use is at the user's own risk. Sneed DAO, its members, developers and contributors bear no responsibility for any funds lost or stolen.
                            </p>
                        </div>
                    </div>
                )}
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
                <WrapUnwrapModal
                    show={showWrapUnwrapModal}
                    onClose={() => setShowWrapUnwrapModal(false)}
                    onWrap={handleWrap}
                    onUnwrap={handleUnwrap}
                    token={selectedToken}
                    gldtToken={tokens.find(t => t.ledger_canister_id?.toText() === GLDT_CANISTER_ID)}
                />
                <LockModal
                    show={showLockModal}
                    onClose={() => setShowLockModal(false)}
                    token={selectedToken}
                    locks={locks}
                    onAddLock={handleAddLock}
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
                    </>
                )}
            </div>
        </div>
    );
}

export default Wallet;