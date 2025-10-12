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
import { get_short_timezone, format_duration, bigDateToReadable, dateToReadable } from './utils/DateUtils';
import { formatAmount, toJsonString } from './utils/StringUtils';
import TokenCard from './TokenCard';
import PositionCard from './PositionCard';
import { get_available, get_available_backend, getTokenLogo, get_token_conversion_rate, getTokenTVL, getTokenMetaForSwap } from './utils/TokenUtils';
import { getPositionTVL } from "./utils/PositionUtils";
import { headerStyles } from './styles/HeaderStyles';
import { createActor as createSnsGovernanceActor, canisterId as snsGovernanceCanisterId } from 'external/sns_governance';
import { fetchAndCacheSnsData, getAllSnses } from './utils/SnsUtils';
import { createActor as createForumActor, canisterId as forumCanisterId } from 'declarations/sneed_sns_forum';
import Header from './components/Header';
import { fetchUserNeurons, fetchUserNeuronsForSns } from './utils/NeuronUtils';
import { getTipTokensReceivedByUser } from './utils/BackendUtils';

// Component for empty position cards (when no positions exist for a swap pair)
const EmptyPositionCard = ({ position, onRemove, theme }) => {
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
                            <span className="token-amount">No Positions</span>
                        </div>
                        <span className="expand-indicator">{isExpanded ? '▼' : '▶'}</span>
                    </div>
                </div>
            </div>
            {isExpanded && (
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
    const [tokensExpanded, setTokensExpanded] = useState(true);
    const [positionsExpanded, setPositionsExpanded] = useState(true);
    const [principalExpanded, setPrincipalExpanded] = useState(true);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const [confirmMessage, setConfirmMessage] = useState('');
    const [rewardDetailsLoading, setRewardDetailsLoading] = useState({});
    const [totalDollarValue, setTotalDollarValue] = useState(0.0);
    const [snsTokens, setSnsTokens] = useState(new Set()); // Set of ledger canister IDs that are SNS tokens
    const [neuronTotals, setNeuronTotals] = useState({}); // Track neuron USD values by token ledger ID

    const dex_icpswap = 1;
 
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

            // Fetch conversion rate using the new price service
            const conversion_rate = await get_token_conversion_rate(
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
                conversion_rate
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

            setLiquidityPositions([]);

            await Promise.all(swap_canisters.map(async (swap_canister) => {
                    
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

                    const positionDetails = await Promise.all(userPositions.map(async (compoundPosition) => {

                        const position = compoundPosition.position;

                        const tokensOwed0 = position.tokensOwed0;
                        const tokensOwed1 = position.tokensOwed1;
                        const token0Amount = position.token0Amount;
                        const token1Amount = position.token1Amount;
                        var tokensUnused0 = 0;
                        var tokensUnused1 = 0;

                        const unused = await swapActor.getUserUnusedBalance(identity.getPrincipal());
                        if (unused.ok) {
                            tokensUnused0 = unused.ok.balance0;
                            tokensUnused1 = unused.ok.balance1;
                        }

                        return {
                            positionId: position.id,
                            tokensOwed0: tokensOwed0,
                            tokensOwed1: tokensOwed1,
                            tokensUnused0: tokensUnused0,
                            tokensUnused1: tokensUnused1,
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
                        token0_conversion_rate: token0_conversion_rate,
                        token1_conversion_rate: token1_conversion_rate,
                        positions: positionDetails
                    };

                    setLiquidityPositions(prevPositions => [...prevPositions, liquidityPosition]);

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
                        token0_conversion_rate: 0,
                        token1_conversion_rate: 0,
                        positions: []
                    };

                    console.error('Error fetching liquidity position: ', err);
                    setLiquidityPositions(prevPositions => [...prevPositions, liquidityPosition]);
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
        
        for (const token of tokens) {
            // Get base token TVL (liquid + locked + rewards)
            const baseTVL = getTokenTVL(token, rewardDetailsLoading, false);
            total += baseTVL;
            
            // Add neuron totals (staked + maturity) if available
            const ledgerId = token.ledger_canister_id?.toString?.() || token.ledger_canister_id?.toText?.() || token.ledger_canister_id;
            if (neuronTotals[ledgerId]) {
                total += neuronTotals[ledgerId];
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

        // Calculate amount to withdraw (backend balance minus 1 tx fee)
        const withdrawAmount = token.available_backend - BigInt(token.fee);
        
        if (withdrawAmount <= 0n) {
            console.log('Backend balance too small to cover transaction fee');
            return;
        }

        console.log('Withdrawal calculation:', {
            backendBalance: token.available_backend.toString(),
            txFee: token.fee.toString(),
            withdrawAmount: withdrawAmount.toString()
        });

        // Show confirmation dialog
        setConfirmAction(() => async () => {
            try {
                console.log('=== Starting confirmed backend withdrawal ===');
                
                const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { 
                    agentOptions: { identity } 
                });

                // Transfer (backend_balance - 1_tx_fee) to user's frontend wallet
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
        });

        const amountFormatted = formatAmount(withdrawAmount, token.decimals);
        setConfirmMessage(`You are about to withdraw ${amountFormatted} ${token.symbol} from your backend wallet to your frontend wallet. This will cost ${formatAmount(token.fee, token.decimals)} ${token.symbol} in transaction fees.`);
        setShowConfirmModal(true);
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

    
    const withdraw_position_rewards = async (liquidityPosition) => {

        if (liquidityPosition.frontendOwnership) {

            const swapActor = createIcpSwapActor(liquidityPosition.swapCanisterId, { agentOptions: { identity } });

            // Call icpswap API to claim fee rewards
            const claim_result = await swapActor.claim({ positionId : Number(liquidityPosition.id) });
            var ok = claim_result["ok"];

            if (ok) {

                var amount0 = ok.amount0;
                var amount1 = ok.amount1;

                var swap_meta = await swapActor.metadata();;
                const icrc1_ledger0 = swap_meta.ok.token0.address;
                const icrc1_ledger1 = swap_meta.ok.token1.address;

                const unused = await swapActor.getUserUnusedBalance(identity.getPrincipal());
                if (unused.ok) {
                    amount0 += unused.ok.balance0;
                    amount1 += unused.ok.balance1;
                }

                const ledgerActor0 = createLedgerActor(icrc1_ledger0);
                const fee0 = await ledgerActor0.icrc1_fee();

                const ledgerActor1 = createLedgerActor(icrc1_ledger1);
                const fee1 = await ledgerActor1.icrc1_fee();

                var withdraw0_ok = null;
                var withdraw1_ok = null;

                // Call icpswap API to withdraw token0 rewards
                if (amount0 > 0 && amount0 > fee0) {
                    const withdraw0_result = await swapActor.withdraw({
                        fee : fee0,
                        token : icrc1_ledger0,
                        amount : amount0
                    })
                    console.log(toJsonString(withdraw0_result));
                    withdraw0_ok = withdraw0_result.ok;

                    // update token card

                }

                // Call icpswap API to withdraw token1 rewards
                if (amount1 > 0 && amount1 > fee1) {
                    console.log(amount1 + " > fee: " + fee1);
                    const withdraw1_result = await swapActor.withdraw({
                        fee : fee1,
                        token : icrc1_ledger1,
                        amount : amount1
                    })
                    console.log(toJsonString(withdraw1_result));
                    withdraw1_ok = withdraw1_result.ok;

                    // update token card

                }

                // update position card

            } else {
                console.error("claim failed: " + toJsonString(claim_result["err"]));
            }    

        } else {
            //console.log("back" + toJsonString(liquidityPosition));

        }
 
        // if the position is on the frontend, just withdraw directly with a call to swap canister

        // if the position is on the backend, withdraw to backend (preferrably to subaccount!) 
        // then (optionally) send the withdrawn funds to the frontend (may not be needed if in subaccount)

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
        // Refresh token balance, locks, and rewards
        await fetchBalancesAndLocks(token.ledger_canister_id);
        await fetchRewardDetails(token.ledger_canister_id);
        // Note: Neurons are refreshed within TokenCard itself
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
                                cursor: 'pointer',
                                borderBottom: principalExpanded ? `1px solid ${theme.colors.border}` : 'none'
                            }}
                            onClick={() => setPrincipalExpanded(!principalExpanded)}
                        >
                            <span style={{
                                fontSize: '1.2rem',
                                color: theme.colors.secondaryText,
                                transition: 'transform 0.2s ease'
                            }}>
                                {principalExpanded ? '▼' : '▶'}
                            </span>
                            <div style={{
                                color: theme.colors.mutedText,
                                fontSize: '14px',
                                letterSpacing: '1px',
                                textTransform: 'uppercase',
                                fontWeight: '600'
                            }}>
                                Your Sneed Wallet Principal
                            </div>
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
                        marginBottom: '20px',
                        textAlign: 'center',
                        boxShadow: theme.colors.cardShadow
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
                        console.log(`[Wallet] Token ${token.symbol}:`, {
                            ledger_canister_id: token.ledger_canister_id,
                            ledger_canister_id_string: ledgerIdString,
                            isSnsToken: isSns,
                            snsTokensSet: Array.from(snsTokens)
                        });
                        
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
                                isSnsToken={isSns}
                                onNeuronTotalsChange={(usdValue) => {
                                    const ledgerId = token.ledger_canister_id?.toString?.() || token.ledger_canister_id?.toText?.() || token.ledger_canister_id;
                                    setNeuronTotals(prev => ({
                                        ...prev,
                                        [ledgerId]: usdValue
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
                            theme={theme}
                          />

                        : position.positions.map((positionDetails, positionIndex) => (
                            <PositionCard
                                key={`${index}-${positionIndex}`}
                                position={position}
                                positionDetails={positionDetails}
                                openSendLiquidityPositionModal={openSendLiquidityPositionModal}
                                openLockPositionModal={openLockPositionModal}
                                withdraw_position_rewards={withdraw_position_rewards}
                                handleWithdrawPosition={handleWithdrawPosition}
                                handleTransferPositionOwnership={handleSendLiquidityPosition}
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
                    title="Sneed Lock 2.0"
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
                            <p>Sneed Lock 2.0 is a new version of Sneed Lock that is permissionless, offers timed locks, and is integrated directly into the Sneed Wallet.</p>
                            <p>After registering a token or liquidity position, you can lock it for a specified time period by clicking the lock icon in the token or position card. You can also transfer tokens and positions to a different address (unless locked).</p>
                            <p>Locking tokens or positions means you will not be able to transfer them until the lock time expires.</p>
                            <p><b>Do NOT lock tokens or positions that you might need access to during the lock period!</b></p>
                            <p>NB: Sneed Locked funds do not give rewards! <br />Sneed Lock 2.0 is intended for token developers, team members and whales who wish to make trading their token safer for users, preventing "rug pulls" by locking large token and liquidity positions.</p>
                            <p><b>All use is at the user's own risk. Sneed DAO, its members, developers and contributors bear no responsibility for any funds lost or stolen.</b></p>
                            <p>Maximum lock time is 10 years.</p>
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