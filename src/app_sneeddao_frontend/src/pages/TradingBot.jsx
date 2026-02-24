/**
 * TradingBot — Management page for a Sneed Trading Bot canister.
 *
 * Route: /trading_bot/:canisterId
 *
 * Uses the reusable BotManagementPanel for Info, Botkeys, Chores framework, and Log tabs.
 * The per-chore configuration panels are custom to the trading bot.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { HttpAgent, Actor } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import Header from '../components/Header';
import BotManagementPanel from '../components/BotManagementPanel';
import TokenSelector from '../components/TokenSelector';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { useNaming } from '../NamingContext';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { setPrincipalNickname, setPrincipalNameFor } from '../utils/BackendUtils';
// Trading bot Candid declarations — aligned with staking bot API for shared BotManagementPanel.
import { createActor as createBotActor } from 'external/sneed_trading_bot';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { decodeIcrcAccount, encodeIcrcAccount } from '@dfinity/ledger-icrc';
import { computeAccountId } from '../utils/PrincipalUtils';
import { FaChartLine, FaPlus, FaTrash, FaEdit, FaSave, FaTimes, FaSyncAlt, FaSearch, FaGripVertical, FaLock, FaLockOpen, FaPause, FaPlay, FaArrowUp, FaArrowDown, FaPaperPlane, FaExchangeAlt, FaWallet, FaShieldAlt, FaToggleOn, FaToggleOff, FaCopy, FaDownload, FaArrowRight, FaChevronDown, FaChevronUp, FaTag, FaGlobe, FaEyeSlash, FaRobot, FaMedkit, FaCode } from 'react-icons/fa';
import TradingBotDSLPanel from '../components/TradingBotDSLPanel';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createIcpSwapFactoryActor, canisterId as icpSwapFactoryCanisterId } from 'external/icp_swap_factory';
import { principalToSubaccount } from '../services/dex/types';
import TokenIcon from '../components/TokenIcon';
import BotIcon from '../components/BotIcon';
import PrincipalInput from '../components/PrincipalInput';
import TradingBotWizard, { WIZARD_SVG_URL } from '../components/TradingBotWizard';
import { useWhitelistTokens } from '../contexts/WhitelistTokensContext';
import StatusLamp, { getChoreSummaryLamp, getSchedulerLampState, getConductorLampState, getTaskLampState, LAMP_COLORS } from '../components/ChoreStatusLamp';
import priceService from '../services/PriceService';
import { useDenomination } from '../contexts/DenominationContext';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ComposedChart, Bar, Line } from 'recharts';

// Custom CSS for animations
const tradingBotStyles = `
@keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
}
@keyframes tradingFloat {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
}
.trading-bot-float { animation: tradingFloat 3s ease-in-out infinite; }
.trading-bot-fade-in { animation: fadeInUp 0.5s ease-out forwards; }
@keyframes swapPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
}
@keyframes swapFlowDot {
    0% { transform: translateX(-8px); opacity: 0; }
    30% { opacity: 1; }
    70% { opacity: 1; }
    100% { transform: translateX(8px); opacity: 0; }
}
.swap-card-slot { overflow: hidden; transition: max-height 0.35s ease-out, opacity 0.25s ease-out; }
.swap-pulse { animation: swapPulse 1.5s ease-in-out infinite; }
.swap-flow-dot { animation: swapFlowDot 1.2s ease-in-out infinite; }
`;

// Trading bot accent colors — green/teal for trading
const ACCENT = '#10b981';
const ACCENT_SECONDARY = '#34d399';

// Management canister IDL for fetching controller info
const MANAGEMENT_CANISTER_ID = Principal.fromText('aaaaa-aa');
const managementCanisterIdlFactory = ({ IDL }) => {
    const definite_canister_settings = IDL.Record({
        'controllers': IDL.Vec(IDL.Principal),
        'freezing_threshold': IDL.Nat,
        'memory_allocation': IDL.Nat,
        'compute_allocation': IDL.Nat,
        'reserved_cycles_limit': IDL.Nat,
        'log_visibility': IDL.Variant({ 'controllers': IDL.Null, 'public': IDL.Null }),
        'wasm_memory_limit': IDL.Nat,
    });
    const canister_status_result = IDL.Record({
        'status': IDL.Variant({ 'running': IDL.Null, 'stopping': IDL.Null, 'stopped': IDL.Null }),
        'settings': definite_canister_settings,
        'module_hash': IDL.Opt(IDL.Vec(IDL.Nat8)),
        'memory_size': IDL.Nat,
        'cycles': IDL.Nat,
        'idle_cycles_burned_per_day': IDL.Nat,
        'query_stats': IDL.Record({
            'num_calls_total': IDL.Nat, 'num_instructions_total': IDL.Nat,
            'request_payload_bytes_total': IDL.Nat, 'response_payload_bytes_total': IDL.Nat,
        }),
        'reserved_cycles': IDL.Nat,
    });
    return IDL.Service({
        'canister_status': IDL.Func([IDL.Record({ 'canister_id': IDL.Principal })], [canister_status_result], []),
    });
};

// Trading Bot app ID (registered in the Sneedapp factory)
const APP_ID = 'sneed-trading-bot';

// Permission labels for the trading bot
const PERMISSION_LABELS = {
    'FullPermissions': 'Full Permissions',
    'ManagePermissions': 'Manage Permissions',
    'ViewChores': 'View Chores',
    'ViewLogs': 'Read Logs',
    'ManageLogs': 'Manage Logs',
    'ViewPortfolio': 'View Portfolio',
    'ManagePurses': 'Manage Purses',
    'ManageTrades': 'Manage Trades',
    'ManageRebalancer': 'Manage Rebalancer',
    'ManageTradeChore': 'Manage Trade Chore',
    'ManageRebalanceChore': 'Manage Rebalance Chore',
    'ManageMoveFundsChore': 'Manage Move Funds Chore',
    'ManageTokenRegistry': 'Manage Token Registry',
    'ManageDexSettings': 'Manage DEX Settings',
    'WithdrawFunds': 'Withdraw Funds',
    'ConfigureDistribution': 'Configure Distribution',
    'ManageDistributeFunds': 'Manage Distribute Funds',
    'ManageSnapshotChore': 'Manage Snapshot Chore',
    'ManageCircuitBreaker': 'Manage Circuit Breaker',
    'ManagePurses': 'Manage Purses',
    'ManageEvents': 'Manage Events',
    'ViewEvents': 'View Events',
    'ExecuteOneOffTrade': 'Execute Quick Trades',
};

const PERMISSION_DESCRIPTIONS = {
    'FullPermissions': 'Grants all permissions, including any added in future versions',
    'ManagePermissions': 'Add/remove botkey principals and manage their permissions',
    'ViewChores': 'View bot chore statuses, configurations, and settings',
    'ViewLogs': 'Read bot log entries and view log configuration',
    'ManageLogs': 'Set log level, max entries, and clear logs',
    'ViewPortfolio': 'View balances, purses, and portfolio state',
    'ManagePurses': 'Fund and reclaim purse balances',
    'ManageTrades': 'Configure trade chore actions (add/edit/remove trades)',
    'ManageRebalancer': 'Configure rebalancer targets and parameters',
    'ManageTradeChore': 'Start/stop/pause/resume/trigger trade chores',
    'ManageRebalanceChore': 'Start/stop/pause/resume/trigger rebalance chore',
    'ManageMoveFundsChore': 'Start/stop/pause/resume/trigger move funds chores',
    'ManageTokenRegistry': 'Add/remove supported tokens from the registry',
    'ManageDexSettings': 'Configure DEX parameters (slippage, enabled DEXes)',
    'WithdrawFunds': 'Send tokens from the bot to external accounts',
    'ConfigureDistribution': 'Add, edit, and remove distribution lists',
    'ManageDistributeFunds': 'Start/stop/pause/resume/trigger distribute-funds chore',
    'ManageSnapshotChore': 'Start/stop/pause/resume/trigger snapshot chore',
    'ManageCircuitBreaker': 'Configure circuit breaker rules and conditions',
    'ManagePurses': 'Enable/disable chore purses, fund and reclaim operations',
    'ManageEvents': 'Configure event subscriptions, reaction rules, and emission settings',
    'ViewEvents': 'View event types, listeners, subscriptions, and logs',
    'ExecuteOneOffTrade': 'Submit, view, and cancel one-off quick trades',
};

// Chore types that support multiple instances
const MULTI_INSTANCE_CHORE_TYPES = ['trade', 'move-funds', 'distribute-funds', 'rebalance', 'snapshot'];

// ============================================
// ACTION TYPE CONSTANTS
// ============================================
const ACTION_TYPE_TRADE = 0;
const ACTION_TYPE_DEPOSIT = 1;
const ACTION_TYPE_WITHDRAW = 2;
const ACTION_TYPE_SEND = 3;
const ACTION_TYPE_DETECTED_INFLOW = 4;
const ACTION_TYPE_DETECTED_OUTFLOW = 5;

const ACTION_TYPE_LABELS = {
    [ACTION_TYPE_TRADE]: 'Trade (Swap)',
    [ACTION_TYPE_DEPOSIT]: 'Fund Purse',
    [ACTION_TYPE_WITHDRAW]: 'Reclaim from Purse',
    [ACTION_TYPE_SEND]: 'Send',
    [ACTION_TYPE_DETECTED_INFLOW]: 'Detected Inflow',
    [ACTION_TYPE_DETECTED_OUTFLOW]: 'Detected Outflow',
};

// ============================================
// Well-known canister IDs & currency signs
// ============================================
const CKUSDC_LEDGER = 'xevnm-gaaaa-aaaar-qafnq-cai';
const CKUSDT_LEDGER = 'cngnf-vqaaa-aaaar-qag4q-cai';
const CKEURC_LEDGER = 'pe5t5-diaaa-aaaar-qahwa-cai';
const CKBTC_LEDGER  = 'mxzaz-hqaaa-aaaar-qaada-cai';
const CKETH_LEDGER  = 'ss2fx-dyaaa-aaaar-qacoq-cai';
const ICP_LEDGER    = 'ryjl3-tyaaa-aaaaa-aaaba-cai';

/**
 * Map of well-known canister IDs to their native currency sign.
 * Fiat-pegged stablecoins use the fiat symbol; crypto-pegged use their unicode symbols.
 */
const CURRENCY_SIGNS = {
    [CKUSDC_LEDGER]: '$',
    [CKUSDT_LEDGER]: '$',
    [CKEURC_LEDGER]: '€',
    [CKBTC_LEDGER]:  '₿',      // U+20BF Bitcoin Sign
    [CKETH_LEDGER]:  'Ξ',      // U+039E Greek Capital Letter Xi (Ethereum)
};

/** Fiat-style currencies use 2 fixed decimal places; crypto signs use significant digits */
const FIAT_SIGNS = new Set(['$', '€']);

/**
 * Approximate USD peg for fiat stablecoins.
 * Used to derive reliable ICP prices from the liquid ICP/USDC pool
 * instead of relying on potentially illiquid individual token/ICP pools.
 */
const FIAT_USD_PEG = {
    [CKUSDC_LEDGER]: 1.0,
    [CKUSDT_LEDGER]: 1.0,
    [CKEURC_LEDGER]: 1.08, // approximate EUR/USD
};

/**
 * Returns the native currency sign for a canister ID, or null if none.
 */
const getCurrencySign = (canisterId) => {
    if (!canisterId) return null;
    const id = typeof canisterId === 'string' ? canisterId : canisterId?.toText?.() || String(canisterId);
    return CURRENCY_SIGNS[id] || null;
};

/** Backward-compat shorthand: true when the token has ANY known currency sign. */
const hasCurrencySign = (canisterId) => getCurrencySign(canisterId) !== null;

/**
 * Format a human-readable amount using a native currency sign if available,
 * otherwise append the denomination symbol.
 * @param {number|string} amount
 * @param {string} denomCanisterId
 * @param {string} denomSymbol - fallback symbol (e.g. 'ckBTC')
 * @returns {string} e.g. "$12.50", "€8.30", "₿0.00512", "Ξ1.234", "1,234 SNEED"
 */
const formatDenomAmount = (amount, denomCanisterId, denomSymbol) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : Number(amount);
    if (isNaN(num)) return '—';
    const sign = getCurrencySign(denomCanisterId);
    if (sign) {
        const isFiat = FIAT_SIGNS.has(sign);
        if (isFiat) {
            if (num === 0) return `${sign}0.00`;
            if (Math.abs(num) < 0.01) return num > 0 ? `<${sign}0.01` : `>-${sign}0.01`;
            return (num < 0 ? '-' : '') + sign + Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        // Crypto sign: use up to 6 significant digits
        if (num === 0) return `${sign}0`;
        return (num < 0 ? '-' : '') + sign + Math.abs(num).toLocaleString(undefined, { maximumSignificantDigits: 6 });
    }
    return `${num.toLocaleString(undefined, { maximumSignificantDigits: 6 })} ${denomSymbol || ''}`.trim();
};

/**
 * Format a label suffix for denomination.
 * Returns " ($)" / " (€)" / " (₿)" etc. for known currencies, otherwise " (SYM)".
 */
const denomLabel = (denomCanisterId, denomSymbol, fallbackSymbol) => {
    const sign = getCurrencySign(denomCanisterId);
    if (sign) return ` (${sign})`;
    if (denomSymbol) return ` (${denomSymbol})`;
    if (fallbackSymbol) return ` (${fallbackSymbol})`;
    return '';
};

/**
 * Format a price unit label for denomination.
 * Returns "$/Output", "€/Output", "₿/Output", etc.
 */
const denomPriceUnit = (denomCanisterId, denomSymbol, outputSymbol) => {
    const sign = getCurrencySign(denomCanisterId);
    const denom = sign || (denomSymbol || '?');
    return `${denom}/${outputSymbol || 'Output'}`;
};

// ============================================
// HELPER: Shorten principal for display
// ============================================
const shortPrincipal = (p) => {
    const s = typeof p === 'string' ? p : p?.toText?.() || String(p);
    return s.length > 20 ? s.slice(0, 8) + '...' + s.slice(-6) : s;
};

/** True when a symbol value is a placeholder that should be resolved from cache. */
const _isPlaceholderSymbol = (s) => !s || s === '?' || s === '???' || s === '???';

function CopyToClipboardButton({ getText, accentColor, theme, label = 'Copy' }) {
    const [copied, setCopied] = React.useState(false);
    const handleClick = async () => {
        try {
            const text = typeof getText === 'function' ? getText() : getText;
            await navigator.clipboard.writeText(text);
        } catch (_) {
            const text = typeof getText === 'function' ? getText() : getText;
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <button
            onClick={handleClick}
            title={copied ? 'Copied!' : `${label} to clipboard`}
            style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px',
                display: 'flex', alignItems: 'center', gap: '4px',
                color: copied ? accentColor : theme.colors.secondaryText,
                fontSize: '0.72rem', opacity: copied ? 1 : 0.7,
                transition: 'all 0.15s',
            }}
        >
            <FaCopy style={{ fontSize: '0.7rem' }} />
            <span>{copied ? 'Copied!' : label}</span>
        </button>
    );
}

// ============================================
// SHARED PRICE HELPER — two-hop denom pricing via PriceService
// ============================================

/**
 * Fetch prices for a set of tokens denominated in a chosen denomination token.
 * Uses PriceService (shared singleton with memory + localStorage cache).
 *
 * @param {string[]} tokenIds - Canister IDs of tokens to price
 * @param {string} denomTokenId - Canister ID of the denomination token
 * @param {(id: string) => number} decFor - Returns decimals for a given token ID
 * @returns {Promise<Record<string, number|null>>} tokenId → price in denom units, or null
 */
async function fetchDenomPrices(tokenIds, denomTokenId, decFor) {
    for (const tid of tokenIds) priceService.setTokenDecimals(tid, decFor(tid));
    if (denomTokenId && denomTokenId !== ICP_LEDGER) priceService.setTokenDecimals(denomTokenId, decFor(denomTokenId));

    const getIcpPrice = async (tid) => {
        if (tid === ICP_LEDGER) return 1;
        const fiatPeg = FIAT_USD_PEG[tid];
        if (fiatPeg != null) {
            const icpUsd = await priceService.getICPUSDPrice();
            return icpUsd > 0 ? fiatPeg / icpUsd : null;
        }
        return await priceService.getTokenICPPrice(tid, decFor(tid));
    };

    const [tokenResults, denomIcpPriceRaw] = await Promise.all([
        Promise.all(tokenIds.map(async (tid) => {
            try { return { tid, icpPrice: await getIcpPrice(tid) }; }
            catch (_) { return { tid, icpPrice: null }; }
        })),
        denomTokenId !== ICP_LEDGER ? getIcpPrice(denomTokenId).catch(() => null) : Promise.resolve(1),
    ]);

    const denomIcpPrice = (denomIcpPriceRaw != null && isFinite(denomIcpPriceRaw) && denomIcpPriceRaw > 0) ? denomIcpPriceRaw : null;
    const prices = {};
    for (const { tid, icpPrice } of tokenResults) {
        if (tid === denomTokenId) { prices[tid] = 1; continue; }
        if (icpPrice != null && denomIcpPrice != null && denomIcpPrice > 0) {
            prices[tid] = icpPrice / denomIcpPrice;
        } else {
            prices[tid] = null;
        }
    }
    return prices;
}

// ============================================
// TOKEN METADATA — backed by the site-wide shared cache (IndexedDB + memory)
// ============================================
import {
    getTokenMetadataSync,
    hasTokenMetadata,
    fetchAndCacheTokenMetadata,
    setTokenMetadataManual,
} from '../hooks/useTokenCache';

/** Convert shared cache shape → local shape used by getSymbol/getDecimals helpers. */
function _toLocalMeta(cached) {
    if (!cached) return null;
    return { symbol: cached.symbol || '???', name: cached.symbol || '???', decimals: cached.decimals ?? 8, fee: cached.fee ?? 0 };
}

/** Store metadata from TokenSelector's onSelectToken callback into the shared cache. */
function cacheTokenMeta(tokenData) {
    if (!tokenData?.ledger_id) return;
    setTokenMetadataManual(tokenData.ledger_id, {
        symbol: tokenData.symbol,
        decimals: tokenData.decimals,
        fee: tokenData.fee,
    });
}

/**
 * Hook that resolves an array of canister IDs to metadata, returning a map.
 * Reads from the shared persistent cache first, fetches missing tokens asynchronously.
 */
function useTokenMetadata(canisterIds, identity) {
    const [meta, setMeta] = useState(() => {
        const m = {};
        for (const id of canisterIds) {
            const key = typeof id === 'string' ? id : id?.toText?.() || String(id);
            const cached = _toLocalMeta(getTokenMetadataSync(key));
            if (cached) m[key] = cached;
        }
        return m;
    });
    const prevIdsRef = useRef('');

    useEffect(() => {
        const ids = canisterIds.map(id => typeof id === 'string' ? id : id?.toText?.() || String(id));
        const key = ids.sort().join(',');
        if (key === prevIdsRef.current) return;
        prevIdsRef.current = key;

        // Synchronously populate from shared cache
        const initial = {};
        const missing = [];
        for (const id of ids) {
            const cached = _toLocalMeta(getTokenMetadataSync(id));
            if (cached) {
                initial[id] = cached;
            } else {
                missing.push(id);
            }
        }
        if (Object.keys(initial).length > 0) setMeta(prev => ({ ...prev, ...initial }));

        if (missing.length === 0) return;

        let mounted = true;
        (async () => {
            await Promise.all(missing.map(id => fetchAndCacheTokenMetadata(id, identity)));
            if (!mounted) return;
            const m = {};
            for (const id of ids) {
                m[id] = _toLocalMeta(getTokenMetadataSync(id)) || { symbol: shortPrincipal(id), name: id, decimals: 8, fee: 0 };
            }
            setMeta(m);
        })();
        return () => { mounted = false; };
    }, [canisterIds, identity]);

    return meta;
}

/** Format a raw amount (bigint/number) into human-readable token units. */
const formatTokenAmount = (raw, decimals) => {
    const n = Number(raw);
    if (n === 0) return '0';
    return (n / Math.pow(10, decimals)).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
};

/** Parse a human-readable token amount to raw units (string). */
const parseTokenAmount = (humanStr, decimals) => {
    const n = parseFloat(humanStr);
    if (isNaN(n) || n < 0) return '0';
    return Math.round(n * Math.pow(10, decimals)).toString();
};

// ============================================
// Cumulative progress summary for chore summary card
// ============================================
function ChoreCumulativeSummary({ choreId, chore, getReadyBotActor, accentColor, theme, identity }) {
    const [actions, setActions] = useState(null);
    const optVal = (arr) => arr?.length > 0 ? arr[0] : null;

    const choreType = chore?.choreTypeId || chore?.choreId || '';
    const fetchFn = (choreType === 'move-funds') ? 'getMoveFundsActions'
        : (choreType === 'trade' || choreType === 'rebalance') ? 'getTradeActions' : null;

    const runCount = Number(chore?.totalSuccessCount || 0) + Number(chore?.totalFailureCount || 0);

    useEffect(() => {
        if (!fetchFn) return;
        (async () => {
            try {
                const bot = await getReadyBotActor();
                if (!bot || !bot[fetchFn]) return;
                const acts = await bot[fetchFn](choreId);
                setActions(acts || []);
            } catch { setActions([]); }
        })();
    }, [choreId, fetchFn, getReadyBotActor, runCount]);

    const tokenIds = React.useMemo(() => {
        if (!actions) return [];
        const ids = new Set();
        for (const a of actions) {
            const inp = typeof a.inputToken === 'string' ? a.inputToken : a.inputToken?.toText?.() || '';
            if (inp) ids.add(inp);
            const out = a.outputToken?.[0];
            if (out) ids.add(typeof out === 'string' ? out : out?.toText?.() || '');
        }
        return [...ids];
    }, [actions]);

    const tokenMeta = useTokenMetadata(tokenIds, identity);
    const getSym = (p) => { const k = typeof p === 'string' ? p : p?.toText?.() || String(p); return tokenMeta[k]?.symbol || shortPrincipal(k); };
    const getDec = (p) => { const k = typeof p === 'string' ? p : p?.toText?.() || String(p); return tokenMeta[k]?.decimals ?? 8; };

    if (!actions || actions.length === 0) return null;

    const limitActions = actions.filter(a =>
        optVal(a.maxCumulativeInput) != null || optVal(a.maxCumulativeOutput) != null || optVal(a.maxExecutions) != null
    );
    if (limitActions.length === 0) return null;

    const barBg = `${accentColor}18`;
    const barFill = accentColor;

    return (
        <div style={{ marginTop: '8px', padding: '8px 10px', background: `${accentColor}06`, border: `1px solid ${accentColor}15`, borderRadius: '6px' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: '600', color: theme.colors.secondaryText, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cumulative Progress</div>
            {limitActions.map(a => {
                const inTok = typeof a.inputToken === 'string' ? a.inputToken : a.inputToken?.toText?.() || '';
                const outTok = a.outputToken?.[0] ? (typeof a.outputToken[0] === 'string' ? a.outputToken[0] : a.outputToken[0]?.toText?.() || '') : '';
                const maxIn = optVal(a.maxCumulativeInput);
                const maxOut = optVal(a.maxCumulativeOutput);
                const maxEx = optVal(a.maxExecutions);
                const cumIn = Number(a.cumulativeInputSpent || 0);
                const cumOut = Number(a.cumulativeOutputReceived || 0);
                const exCount = Number(a.executionCount || 0);
                const segments = [];
                if (maxIn != null) {
                    const inDec = getDec(inTok);
                    const pct = Number(maxIn) > 0 ? Math.min(100, (cumIn / Number(maxIn)) * 100) : 0;
                    segments.push({ label: `Input ${formatTokenAmount(cumIn, inDec)}/${formatTokenAmount(Number(maxIn), inDec)} ${getSym(inTok)}`, pct });
                }
                if (maxOut != null && outTok) {
                    const outDec = getDec(outTok);
                    const pct = Number(maxOut) > 0 ? Math.min(100, (cumOut / Number(maxOut)) * 100) : 0;
                    segments.push({ label: `Output ${formatTokenAmount(cumOut, outDec)}/${formatTokenAmount(Number(maxOut), outDec)} ${getSym(outTok)}`, pct });
                }
                if (maxEx != null) {
                    const pct = Number(maxEx) > 0 ? Math.min(100, (exCount / Number(maxEx)) * 100) : 0;
                    segments.push({ label: `Runs ${exCount}/${Number(maxEx)}`, pct });
                }
                if (segments.length === 0) return null;
                return (
                    <div key={Number(a.id)} style={{ marginBottom: limitActions.length > 1 ? '6px' : 0 }}>
                        {limitActions.length > 1 && <div style={{ fontSize: '0.68rem', color: theme.colors.mutedText, marginBottom: '3px' }}>Action #{Number(a.id)}</div>}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
                            {segments.map((seg, i) => (
                                <div key={i} style={{ flex: '1 1 120px', minWidth: '120px' }}>
                                    <div style={{ fontSize: '0.68rem', color: theme.colors.secondaryText, marginBottom: '2px' }}>{seg.label}</div>
                                    <div style={{ height: '5px', borderRadius: '3px', background: barBg, overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${seg.pct}%`, borderRadius: '3px', background: seg.pct >= 100 ? (theme.colors.error || '#ef4444') : barFill, transition: 'width 0.3s ease' }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ============================================
// REUSABLE: Action List Panel (for Trade and Move Funds chores)
// ============================================
function ActionListPanel({ instanceId, getReadyBotActor, theme, accentColor, cardStyle, inputStyle, buttonStyle, secondaryButtonStyle, fetchFn, addFn, updateFn, removeFn, allowedTypes, title, description }) {
    const { identity } = useAuth();
    const [actions, setActions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [saving, setSaving] = useState(false);

    // Form mode: null = list view, 'add' = adding new, { id: N } = editing action N
    const [formMode, setFormMode] = useState(null);
    const [showConditions, setShowConditions] = useState(false);

    // Form fields (shared between add and edit modes)
    const [fActionType, setFActionType] = useState(allowedTypes[0]);
    const [fInputToken, setFInputToken] = useState('');
    const [fOutputToken, setFOutputToken] = useState('');
    const [fMinAmount, setFMinAmount] = useState('');
    const [fMaxAmount, setFMaxAmount] = useState('');
    const [fAmountMode, setFAmountMode] = useState(0); // 0 = random range, 1 = percentage of balance
    const [fBalancePercent, setFBalancePercent] = useState('100'); // percentage string, e.g. '100' for 100%
    const [fEnabled, setFEnabled] = useState(true);
    const [fMinBalance, setFMinBalance] = useState('');
    const [fMaxBalance, setFMaxBalance] = useState('');
    const [fMinPrice, setFMinPrice] = useState('');
    const [fMaxPrice, setFMaxPrice] = useState('');
    const [fMaxPriceImpactBps, setFMaxPriceImpactBps] = useState('');
    const [fMaxSlippageBps, setFMaxSlippageBps] = useState('');
    const [fDestOwner, setFDestOwner] = useState('');
    const [fSourcePurse, setFSourcePurse] = useState('');
    const [fTargetPurse, setFTargetPurse] = useState('');
    // Purse allocations for purse selectors
    const [purseAllocations, setPurseAllocations] = useState([]);
    // Price direction toggle: 'output_per_input' means "SNEED per ICP", 'input_per_output' means "ICP per SNEED"
    const [fPriceDirection, setFPriceDirection] = useState('input_per_output');
    // Denomination token state: null = native, otherwise a canister ID string
    const [fTradeSizeDenom, setFTradeSizeDenom] = useState('');
    const [fSizeByOutput, setFSizeByOutput] = useState(false);
    const [fPriceDenom, setFPriceDenom] = useState('');
    const [fBalanceDenom, setFBalanceDenom] = useState('');
    const [fTrailingStopBps, setFTrailingStopBps] = useState('');
    const [fTrailingStopDirection, setFTrailingStopDirection] = useState(0); // 0=stop loss, 1=take profit
    const [fTrailingStopResetOnExec, setFTrailingStopResetOnExec] = useState(0); // 0=reset, 1=never
    const [fHaltAfterExec, setFHaltAfterExec] = useState(false);
    const [fMaxCumulativeInput, setFMaxCumulativeInput] = useState('');
    const [fMaxCumulativeOutput, setFMaxCumulativeOutput] = useState('');
    const [fMaxExecutions, setFMaxExecutions] = useState('');

    // Collect all unique token principals from actions for metadata resolution
    const actionTokenIds = React.useMemo(() => {
        const ids = new Set();
        for (const a of actions) {
            const inp = typeof a.inputToken === 'string' ? a.inputToken : a.inputToken?.toText?.() || String(a.inputToken);
            ids.add(inp);
            if (a.outputToken?.length > 0) {
                const out = typeof a.outputToken[0] === 'string' ? a.outputToken[0] : a.outputToken[0]?.toText?.() || String(a.outputToken[0]);
                ids.add(out);
            }
            // Include denomination tokens from stored actions
            const tsd = a.tradeSizeDenominationToken?.length > 0 ? a.tradeSizeDenominationToken[0] : null;
            const pd = a.priceDenominationToken?.length > 0 ? a.priceDenominationToken[0] : null;
            const bd = a.balanceDenominationToken?.length > 0 ? a.balanceDenominationToken[0] : null;
            if (tsd) ids.add(typeof tsd === 'string' ? tsd : tsd?.toText?.() || String(tsd));
            if (pd) ids.add(typeof pd === 'string' ? pd : pd?.toText?.() || String(pd));
            if (bd) ids.add(typeof bd === 'string' ? bd : bd?.toText?.() || String(bd));
        }
        if (fInputToken) ids.add(fInputToken);
        if (fOutputToken) ids.add(fOutputToken);
        if (fTradeSizeDenom) ids.add(fTradeSizeDenom);
        if (fPriceDenom) ids.add(fPriceDenom);
        if (fBalanceDenom) ids.add(fBalanceDenom);
        return [...ids];
    }, [actions, fInputToken, fOutputToken, fTradeSizeDenom, fPriceDenom, fBalanceDenom]);
    const tokenMeta = useTokenMetadata(actionTokenIds, identity);

    const getSymbol = (principal) => {
        const key = typeof principal === 'string' ? principal : principal?.toText?.() || String(principal);
        return tokenMeta[key]?.symbol || shortPrincipal(key);
    };
    const getDecimals = (principal) => {
        const key = typeof principal === 'string' ? principal : principal?.toText?.() || String(principal);
        return tokenMeta[key]?.decimals ?? 8;
    };

    // Price conversion helpers.
    // Backend stores spotPriceE8s = humanOutputPerInput * 10^outputDecimals
    // direction: 'output_per_input' (native) or 'input_per_output' (inverse)
    // Price storage format: humanInputPerOutput * 10^inputDecimals
    // e.g. "30 ICP per SNEED" stored as 30 * 10^8 = 3_000_000_000
    const e8sToHumanPrice = (e8sVal, inputDec, direction) => {
        if (!e8sVal || e8sVal === 0n) return '';
        const raw = typeof e8sVal === 'bigint' ? e8sVal : BigInt(e8sVal);
        const storedPrice = Number(raw) / (10 ** inputDec); // humanInputPerOutput
        if (direction === 'output_per_input') {
            return storedPrice > 0 ? (1 / storedPrice) : 0;
        }
        return storedPrice; // input_per_output — direct
    };
    const humanPriceToE8s = (humanVal, inputDec, direction) => {
        if (!humanVal || humanVal === '' || Number(humanVal) === 0) return null;
        const num = Number(humanVal);
        const multiplier = 10 ** inputDec;
        if (direction === 'output_per_input') {
            // User entered output/input, invert to stored format (input/output)
            return BigInt(Math.round((1 / num) * multiplier));
        }
        return BigInt(Math.round(num * multiplier)); // input_per_output — direct
    };
    // Label helpers for price direction
    const inputSym = fInputToken ? getSymbol(fInputToken) : 'Input';
    const outputSym = fOutputToken ? getSymbol(fOutputToken) : 'Output';
    const priceLabel = fPriceDirection === 'output_per_input'
        ? `${outputSym} per ${inputSym}`
        : `${inputSym} per ${outputSym}`;
    const inputDec = fInputToken ? getDecimals(fInputToken) : 8;

    const loadActions = useCallback(async () => {
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const result = await bot[fetchFn](instanceId);
            setActions(result);
        } catch (err) {
            setError('Failed to load actions: ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [getReadyBotActor, instanceId, fetchFn]);

    useEffect(() => { loadActions(); }, [loadActions]);

    // Load chore purse allocations for purse selectors
    const loadPurseAllocations = useCallback(async () => {
        try {
            const bot = await getReadyBotActor();
            if (bot?.getAllPurseAllocations) {
                const allocs = await bot.getAllPurseAllocations();
                setPurseAllocations(allocs);
            }
        } catch (_) {}
    }, [getReadyBotActor]);
    useEffect(() => { loadPurseAllocations(); }, [loadPurseAllocations]);

    // Helper: extract optional Candid value
    const optVal = (arr) => arr?.length > 0 ? arr[0] : null;

    const principalToStr = (p) => typeof p === 'string' ? p : p?.toText?.() || String(p);

    const resetForm = () => {
        setFActionType(allowedTypes[0]); setFInputToken(''); setFOutputToken('');
        setFMinAmount(''); setFMaxAmount(''); setFAmountMode(0); setFBalancePercent('100');
        setFEnabled(true);
        setFMinBalance(''); setFMaxBalance(''); setFMinPrice(''); setFMaxPrice('');
        setFMaxPriceImpactBps(''); setFMaxSlippageBps(''); setFDestOwner('');
        setFSourcePurse(''); setFTargetPurse('');
        setFPriceDirection('input_per_output');
        setFTradeSizeDenom(''); setFSizeByOutput(false); setFPriceDenom(''); setFBalanceDenom('');
        setFTrailingStopBps(''); setFTrailingStopDirection(0); setFTrailingStopResetOnExec(0);
        setFHaltAfterExec(false); setFMaxCumulativeInput(''); setFMaxCumulativeOutput(''); setFMaxExecutions('');
        setShowConditions(false);
    };

    const openAddForm = () => {
        resetForm();
        setFormMode('add');
        setError(''); setSuccess('');
    };

    const openEditForm = (action) => {
        const inputStr = principalToStr(action.inputToken);
        // Load denomination tokens
        const tsDenom = optVal(action.tradeSizeDenominationToken) ? principalToStr(optVal(action.tradeSizeDenominationToken)) : '';
        const pDenom = optVal(action.priceDenominationToken) ? principalToStr(optVal(action.priceDenominationToken)) : '';
        const bDenom = optVal(action.balanceDenominationToken) ? principalToStr(optVal(action.balanceDenominationToken)) : '';
        const outputStr = optVal(action.outputToken) ? principalToStr(optVal(action.outputToken)) : '';
        const isOutputSizing = tsDenom && outputStr && tsDenom === outputStr;
        setFSizeByOutput(isOutputSizing);
        setFTradeSizeDenom(tsDenom);
        setFPriceDenom(pDenom);
        setFBalanceDenom(bDenom);
        // Use denomination token's decimals for amounts/balances/prices when set
        const amountDec = tsDenom ? getDecimals(tsDenom) : getDecimals(inputStr);
        const balanceDec = bDenom ? getDecimals(bDenom) : getDecimals(inputStr);
        const priceDec = pDenom ? getDecimals(pDenom) : getDecimals(inputStr);
        setFActionType(Number(action.actionType));
        setFInputToken(inputStr);
        setFOutputToken(optVal(action.outputToken) ? principalToStr(optVal(action.outputToken)) : '');
        setFMinAmount(Number(action.minAmount) ? formatTokenAmount(action.minAmount, amountDec) : '');
        setFMaxAmount(Number(action.maxAmount) ? formatTokenAmount(action.maxAmount, amountDec) : '');
        setFAmountMode(Number(action.amountMode) || 0);
        const bpVal = optVal(action.balancePercent);
        setFBalancePercent(bpVal != null ? String(Number(bpVal) / 100) : '100');
        setFEnabled(action.enabled);
        setFMinBalance(optVal(action.minBalance) != null ? formatTokenAmount(optVal(action.minBalance), balanceDec) : '');
        setFMaxBalance(optVal(action.maxBalance) != null ? formatTokenAmount(optVal(action.maxBalance), balanceDec) : '');
        // Price direction: when denomination is set, prices are always denomToken/outputToken
        setFPriceDirection(pDenom ? 'input_per_output' : 'input_per_output');
        setFMinPrice(optVal(action.minPrice) != null ? String(e8sToHumanPrice(optVal(action.minPrice), priceDec, 'input_per_output')) : '');
        setFMaxPrice(optVal(action.maxPrice) != null ? String(e8sToHumanPrice(optVal(action.maxPrice), priceDec, 'input_per_output')) : '');
        // Display bps as percentage
        setFMaxPriceImpactBps(optVal(action.maxPriceImpactBps) != null ? String(Number(optVal(action.maxPriceImpactBps)) / 100) : '');
        setFMaxSlippageBps(optVal(action.maxSlippageBps) != null ? String(Number(optVal(action.maxSlippageBps)) / 100) : '');
        // Reconstruct destination: for Send, combine principal + subaccount into ICRC1 account string
        const destOwner = optVal(action.destinationOwner);
        const destSub = optVal(action.destinationSubaccount);
        if (destOwner && destSub && destSub.length > 0) {
            try {
                const ownerPrincipal = typeof destOwner === 'string' ? Principal.fromText(destOwner) : destOwner;
                const subBytes = new Uint8Array(destSub);
                const isDefault = subBytes.every(b => b === 0);
                if (!isDefault) {
                    setFDestOwner(encodeIcrcAccount({ owner: ownerPrincipal, subaccount: subBytes }));
                } else {
                    setFDestOwner(principalToStr(destOwner));
                }
            } catch (_) {
                setFDestOwner(destOwner ? principalToStr(destOwner) : '');
            }
        } else {
            setFDestOwner(destOwner ? principalToStr(destOwner) : '');
        }
        setFSourcePurse(optVal(action.sourcePurseId) || '');
        setFTargetPurse(optVal(action.targetPurseId) || '');
        setFHaltAfterExec(action.haltChoreAfterExecution || false);
        const inputDec = getDecimals(inputStr);
        const outputDec = action.outputToken?.length > 0 ? getDecimals(principalToStr(action.outputToken[0])) : 8;
        setFMaxCumulativeInput(optVal(action.maxCumulativeInput) != null ? (Number(optVal(action.maxCumulativeInput)) / (10 ** inputDec)).toString() : '');
        setFMaxCumulativeOutput(optVal(action.maxCumulativeOutput) != null ? (Number(optVal(action.maxCumulativeOutput)) / (10 ** outputDec)).toString() : '');
        setFMaxExecutions(optVal(action.maxExecutions) != null ? Number(optVal(action.maxExecutions)).toString() : '');
        // Trailing stop fields
        const tsBps = optVal(action.trailingStopBps);
        setFTrailingStopBps(tsBps != null ? String(Number(tsBps) / 100) : '');
        setFTrailingStopDirection(optVal(action.trailingStopDirection) != null ? Number(optVal(action.trailingStopDirection)) : 0);
        setFTrailingStopResetOnExec(optVal(action.trailingStopResetOnExec) != null ? Number(optVal(action.trailingStopResetOnExec)) : 0);
        // Auto-expand conditions if any condition fields are set
        const hasConditions = optVal(action.minBalance) != null || optVal(action.maxBalance) != null ||
            optVal(action.minPrice) != null || optVal(action.maxPrice) != null ||
            optVal(action.maxPriceImpactBps) != null || optVal(action.maxSlippageBps) != null ||
            bDenom || pDenom || tsBps != null;
        setShowConditions(hasConditions);
        setFormMode({ id: Number(action.id), key: action.key || '' });
        setError(''); setSuccess('');
    };

    const closeForm = () => {
        setFormMode(null);
        resetForm();
    };

    /** Build an ActionConfigInput from the current form state */
    const buildConfig = () => {
        const inputDecimals = getDecimals(fInputToken);
        // Use denomination token decimals when set, otherwise fall back to input token decimals
        const amountDecimals = fTradeSizeDenom ? getDecimals(fTradeSizeDenom) : inputDecimals;
        const balanceDecimals = fBalanceDenom ? getDecimals(fBalanceDenom) : inputDecimals;
        const priceDecimals = fPriceDenom ? getDecimals(fPriceDenom) : inputDecimals;
        return {
            key: formMode !== 'add' && formMode?.key ? formMode.key : '',
            actionType: BigInt(fActionType),
            enabled: fEnabled,
            inputToken: Principal.fromText(fInputToken),
            outputToken: fActionType === ACTION_TYPE_TRADE && fOutputToken ? [Principal.fromText(fOutputToken)] : [],
            minAmount: fMinAmount ? BigInt(parseTokenAmount(fMinAmount, amountDecimals)) : BigInt(0),
            maxAmount: fMaxAmount ? BigInt(parseTokenAmount(fMaxAmount, amountDecimals)) : BigInt(0),
            amountMode: BigInt(fAmountMode),
            balancePercent: fAmountMode === 1 ? [BigInt(Math.round(Number(fBalancePercent) * 100))] : [],
            preferredDex: [],
            sourcePurseId: fSourcePurse !== '' ? [fSourcePurse] : [],
            targetPurseId: fTargetPurse !== '' ? [fTargetPurse] : [],
            ...(() => {
                // For Send: parse ICRC1 account to extract principal + optional subaccount
                const raw = fDestOwner.trim();
                if (!raw) return { destinationOwner: [], destinationSubaccount: [] };
                if (raw.includes('.')) {
                    try {
                        const decoded = decodeIcrcAccount(raw);
                        return {
                            destinationOwner: [decoded.owner],
                            destinationSubaccount: decoded.subaccount ? [[...new Uint8Array(decoded.subaccount)]] : [],
                        };
                    } catch (_) {}
                }
                try {
                    return { destinationOwner: [Principal.fromText(raw)], destinationSubaccount: [] };
                } catch (_) {
                    return { destinationOwner: [], destinationSubaccount: [] };
                }
            })(),
            minBalance: fMinBalance ? [BigInt(parseTokenAmount(fMinBalance, balanceDecimals))] : [],
            maxBalance: fMaxBalance ? [BigInt(parseTokenAmount(fMaxBalance, balanceDecimals))] : [],
            balanceDenominationToken: fBalanceDenom ? [Principal.fromText(fBalanceDenom)] : [],
            minPrice: (() => {
                if (fPriceDenom) {
                    // Denominated price: always stored as denomToken/outputToken, no direction swap
                    const v = humanPriceToE8s(fMinPrice, priceDecimals, 'input_per_output');
                    return v != null ? [v] : [];
                }
                // Native: storage is input-per-output. When user enters in output_per_input direction,
                // inversion flips ordering: user's "max" → stored min.
                const src = fPriceDirection === 'output_per_input' ? fMaxPrice : fMinPrice;
                const v = humanPriceToE8s(src, inputDecimals, fPriceDirection);
                return v != null ? [v] : [];
            })(),
            maxPrice: (() => {
                if (fPriceDenom) {
                    const v = humanPriceToE8s(fMaxPrice, priceDecimals, 'input_per_output');
                    return v != null ? [v] : [];
                }
                const src = fPriceDirection === 'output_per_input' ? fMinPrice : fMaxPrice;
                const v = humanPriceToE8s(src, inputDecimals, fPriceDirection);
                return v != null ? [v] : [];
            })(),
            priceDenominationToken: fPriceDenom ? [Principal.fromText(fPriceDenom)] : [],
            maxPriceImpactBps: fMaxPriceImpactBps ? [BigInt(Math.round(Number(fMaxPriceImpactBps) * 100))] : [],
            maxSlippageBps: fMaxSlippageBps ? [BigInt(Math.round(Number(fMaxSlippageBps) * 100))] : [],
            minFrequencySeconds: [],
            maxFrequencySeconds: [],
            tradeSizeDenominationToken: fTradeSizeDenom ? [Principal.fromText(fTradeSizeDenom)] : [],
            trailingStopBps: fTrailingStopBps ? [BigInt(Math.round(Number(fTrailingStopBps) * 100))] : [],
            trailingStopDirection: fTrailingStopBps ? [BigInt(fTrailingStopDirection)] : [],
            trailingStopResetOnExec: fTrailingStopBps ? [BigInt(fTrailingStopResetOnExec)] : [],
            haltChoreAfterExecution: fHaltAfterExec,
            maxCumulativeInput: fMaxCumulativeInput ? [BigInt(Math.round(parseFloat(fMaxCumulativeInput) * (10 ** (fTradeSizeDenom ? getDecimals(fTradeSizeDenom) : getDecimals(fInputToken)))))] : [],
            maxCumulativeOutput: fMaxCumulativeOutput ? [BigInt(Math.round(parseFloat(fMaxCumulativeOutput) * (10 ** (fOutputToken ? getDecimals(fOutputToken) : 8))))] : [],
            maxExecutions: fMaxExecutions ? [BigInt(parseInt(fMaxExecutions))] : [],
        };
    };

    // Auto-register a token to the registry (idempotent — backend skips duplicates)
    const autoRegisterToken = useCallback(async (bot, tokenId) => {
        if (!tokenId) return;
        try {
            const meta = tokenMeta[tokenId];
            await bot.addToken({
                ledgerCanisterId: Principal.fromText(tokenId),
                symbol: meta?.symbol || '???',
                decimals: meta?.decimals ?? 8,
                fee: BigInt(meta?.fee ?? 10000),
            });
        } catch (_) {} // silently ignore — token may already be registered
    }, [tokenMeta]);

    const handleSave = async () => {
        if (!fInputToken) { setError('Input token is required.'); return; }
        if (fActionType === ACTION_TYPE_TRADE && !fOutputToken) { setError('Output token is required for trades.'); return; }
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const config = buildConfig();
            if (formMode === 'add') {
                await bot[addFn](instanceId, config);
                setSuccess('Action added.');
            } else {
                await bot[updateFn](instanceId, BigInt(formMode.id), config);
                setSuccess('Action updated.');
            }
            // Auto-register input/output tokens to the token registry
            await Promise.all([
                autoRegisterToken(bot, fInputToken),
                fOutputToken ? autoRegisterToken(bot, fOutputToken) : Promise.resolve(),
            ]);
            closeForm();
            await loadActions();
        } catch (err) { setError(`Failed to ${formMode === 'add' ? 'add' : 'update'} action: ` + err.message); }
        finally { setSaving(false); }
    };

    const handleRemove = async (actionId) => {
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            await bot[removeFn](instanceId, BigInt(actionId));
            setSuccess('Action removed.');
            if (formMode && formMode.id === actionId) closeForm();
            await loadActions();
        } catch (err) { setError('Failed to remove: ' + err.message); }
        finally { setSaving(false); }
    };

    const handleToggle = async (action) => {
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const updated = {
                key: action.key || '',
                actionType: action.actionType,
                enabled: !action.enabled,
                inputToken: action.inputToken,
                outputToken: action.outputToken?.length > 0 ? action.outputToken : [],
                minAmount: action.minAmount,
                maxAmount: action.maxAmount,
                amountMode: action.amountMode ?? BigInt(0),
                balancePercent: action.balancePercent?.length > 0 ? action.balancePercent : [],
                preferredDex: action.preferredDex?.length > 0 ? action.preferredDex : [],
                sourcePurseId: action.sourcePurseId?.length > 0 ? action.sourcePurseId : [],
                targetPurseId: action.targetPurseId?.length > 0 ? action.targetPurseId : [],
                destinationOwner: action.destinationOwner?.length > 0 ? action.destinationOwner : [],
                destinationSubaccount: action.destinationSubaccount?.length > 0 ? action.destinationSubaccount : [],
                minBalance: action.minBalance?.length > 0 ? action.minBalance : [],
                maxBalance: action.maxBalance?.length > 0 ? action.maxBalance : [],
                balanceDenominationToken: action.balanceDenominationToken?.length > 0 ? action.balanceDenominationToken : [],
                minPrice: action.minPrice?.length > 0 ? action.minPrice : [],
                maxPrice: action.maxPrice?.length > 0 ? action.maxPrice : [],
                priceDenominationToken: action.priceDenominationToken?.length > 0 ? action.priceDenominationToken : [],
                maxPriceImpactBps: action.maxPriceImpactBps?.length > 0 ? action.maxPriceImpactBps : [],
                maxSlippageBps: action.maxSlippageBps?.length > 0 ? action.maxSlippageBps : [],
                minFrequencySeconds: action.minFrequencySeconds?.length > 0 ? action.minFrequencySeconds : [],
                maxFrequencySeconds: action.maxFrequencySeconds?.length > 0 ? action.maxFrequencySeconds : [],
                tradeSizeDenominationToken: action.tradeSizeDenominationToken?.length > 0 ? action.tradeSizeDenominationToken : [],
                trailingStopBps: action.trailingStopBps?.length > 0 ? action.trailingStopBps : [],
                trailingStopDirection: action.trailingStopDirection?.length > 0 ? action.trailingStopDirection : [],
                trailingStopResetOnExec: action.trailingStopResetOnExec?.length > 0 ? action.trailingStopResetOnExec : [],
                haltChoreAfterExecution: action.haltChoreAfterExecution || false,
                maxCumulativeInput: action.maxCumulativeInput?.length > 0 ? action.maxCumulativeInput : [],
                maxCumulativeOutput: action.maxCumulativeOutput?.length > 0 ? action.maxCumulativeOutput : [],
                maxExecutions: action.maxExecutions?.length > 0 ? action.maxExecutions : [],
            };
            await bot[updateFn](instanceId, action.id, updated);
            setSuccess(`Action ${action.enabled ? 'disabled' : 'enabled'}.`);
            await loadActions();
        } catch (err) { setError('Failed to toggle: ' + err.message); }
        finally { setSaving(false); }
    };

    const labelStyle = { fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' };

    /** Shared form JSX (used for both add and edit) */
    const renderForm = () => {
        const isEditing = formMode !== 'add';
        const amountDenomSym = fTradeSizeDenom && tokenMeta[fTradeSizeDenom] ? tokenMeta[fTradeSizeDenom].symbol : null;
        const balanceDenomSym = fBalanceDenom && tokenMeta[fBalanceDenom] ? tokenMeta[fBalanceDenom].symbol : null;
        const priceDenomSym = fPriceDenom && tokenMeta[fPriceDenom] ? tokenMeta[fPriceDenom].symbol : null;
        const nativeInputSym = fInputToken && tokenMeta[fInputToken] ? tokenMeta[fInputToken].symbol : null;
        const amountSymLabel = denomLabel(fTradeSizeDenom, amountDenomSym, nativeInputSym);
        const balanceSymLabel = denomLabel(fBalanceDenom, balanceDenomSym, nativeInputSym);
        const denomPriceLabel = priceDenomSym
            ? denomPriceUnit(fPriceDenom, priceDenomSym, fOutputToken ? getSymbol(fOutputToken) : 'Output')
            : priceLabel;
        return (
            <div style={{ padding: '14px', background: `${accentColor}06`, borderRadius: '8px', border: `1px solid ${accentColor}20`, marginTop: '10px' }}>
                {isEditing && (
                    <div style={{ fontSize: '0.8rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '10px' }}>
                        Editing Action #{formMode.id}
                    </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                    <div>
                        <label style={labelStyle}>Type</label>
                        <select value={fActionType} onChange={(e) => setFActionType(Number(e.target.value))} style={{ ...inputStyle, width: '100%', appearance: 'auto' }}>
                            {allowedTypes.map(t => <option key={t} value={t}>{ACTION_TYPE_LABELS[t]}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>Input Token</label>
                        <TokenSelector
                            value={fInputToken}
                            onChange={setFInputToken}
                            onSelectToken={cacheTokenMeta}
                            allowCustom={true}
                            placeholder="Select input token..."
                        />
                    </div>
                    {fActionType === ACTION_TYPE_TRADE && (
                        <div>
                            <label style={labelStyle}>Output Token</label>
                            <TokenSelector
                                value={fOutputToken}
                                onChange={(v) => { setFOutputToken(v); if (fSizeByOutput && v) { setFTradeSizeDenom(v); setFMinAmount(''); setFMaxAmount(''); } }}
                                onSelectToken={cacheTokenMeta}
                                allowCustom={true}
                                placeholder="Select output token..."
                            />
                        </div>
                    )}
                    {/* Force new row before amounts */}
                    <div style={{ gridColumn: '1 / -1', height: 0 }} />
                    {/* Amount mode toggle */}
                    <div style={{ gridColumn: '1 / -1' }}>
                        <label style={labelStyle}>Amount Mode</label>
                        <div style={{ display: 'flex', gap: '0', borderRadius: '6px', overflow: 'hidden', border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)'}`, width: 'fit-content' }}>
                            {[{ value: 0, label: 'Random in Range' }, { value: 1, label: '% of Balance' }].map(opt => (
                                <button key={opt.value} type="button" onClick={() => setFAmountMode(opt.value)}
                                    style={{
                                        padding: '5px 14px', fontSize: '0.78rem', border: 'none', cursor: 'pointer',
                                        background: fAmountMode === opt.value ? accentColor : 'transparent',
                                        color: fAmountMode === opt.value ? '#fff' : (theme === 'dark' ? '#ccc' : '#555'),
                                        fontWeight: fAmountMode === opt.value ? 600 : 400,
                                        transition: 'all 0.15s',
                                    }}>
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label style={labelStyle}>{fSizeByOutput ? 'Min Buy Amount' : fAmountMode === 1 ? 'Min Amount (cap)' : 'Min Amount'}{amountSymLabel}</label>
                        <input value={fMinAmount} onChange={(e) => setFMinAmount(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="0.0" />
                    </div>
                    <div>
                        <label style={labelStyle}>{fSizeByOutput ? 'Max Buy Amount' : fAmountMode === 1 ? 'Max Amount (cap)' : 'Max Amount'}{amountSymLabel}</label>
                        <input value={fMaxAmount} onChange={(e) => setFMaxAmount(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="0.0" />
                    </div>
                    {fActionType === ACTION_TYPE_TRADE && (
                        <div>
                            <label style={labelStyle}>Size by</label>
                            <div style={{ display: 'flex', gap: '0', borderRadius: '6px', overflow: 'hidden', border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)'}`, width: 'fit-content', marginBottom: '6px' }}>
                                <button type="button" onClick={() => {
                                    setFSizeByOutput(false);
                                    setFTradeSizeDenom(''); setFMinAmount(''); setFMaxAmount('');
                                }} style={{
                                    padding: '5px 12px', fontSize: '0.75rem', border: 'none', cursor: 'pointer',
                                    background: !fSizeByOutput ? accentColor : 'transparent',
                                    color: !fSizeByOutput ? '#fff' : (theme === 'dark' ? '#ccc' : '#555'),
                                    fontWeight: !fSizeByOutput ? 600 : 400,
                                }}>Input (spend)</button>
                                <button type="button" onClick={() => {
                                    setFSizeByOutput(true);
                                    if (fOutputToken) { setFTradeSizeDenom(fOutputToken); }
                                    setFMinAmount(''); setFMaxAmount('');
                                }} style={{
                                    padding: '5px 12px', fontSize: '0.75rem', border: 'none', cursor: 'pointer',
                                    background: fSizeByOutput ? accentColor : 'transparent',
                                    color: fSizeByOutput ? '#fff' : (theme === 'dark' ? '#ccc' : '#555'),
                                    fontWeight: fSizeByOutput ? 600 : 400,
                                }} disabled={!fOutputToken}>Output (buy)</button>
                            </div>
                            {!fSizeByOutput && (
                                <>
                                    <label style={{ ...labelStyle, marginTop: '4px' }}>Amount Denomination</label>
                                    <TokenSelector
                                        value={fTradeSizeDenom}
                                        onChange={(v) => { setFTradeSizeDenom(v); setFMinAmount(''); setFMaxAmount(''); }}
                                        onSelectToken={cacheTokenMeta}
                                        allowCustom={true}
                                        placeholder="Native (input token)"
                                    />
                                    {fTradeSizeDenom && (
                                        <button type="button" onClick={() => { setFTradeSizeDenom(''); setFMinAmount(''); setFMaxAmount(''); }}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.65rem', color: accentColor, padding: '2px 0', marginTop: '2px' }}>
                                            Clear (use native)
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                    {fAmountMode === 1 && (
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={labelStyle}>Balance %</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input
                                    type="range" min="0" max="100" step="0.1"
                                    value={parseFloat(fBalancePercent) || 0}
                                    onChange={(e) => setFBalancePercent(e.target.value)}
                                    style={{ flex: 1, accentColor: accentColor, cursor: 'pointer', height: '6px' }}
                                />
                                <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                                    <input
                                        value={fBalancePercent}
                                        onChange={(e) => setFBalancePercent(e.target.value)}
                                        style={{ ...inputStyle, width: '60px', fontSize: '0.75rem', textAlign: 'right' }}
                                        type="text" inputMode="decimal" placeholder="100"
                                    />
                                    <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>%</span>
                                </div>
                            </div>
                        </div>
                    )}
                    {/* Fund Purse: source and target purse selectors */}
                    {fActionType === ACTION_TYPE_DEPOSIT && (<>
                        <div>
                            <label style={labelStyle}>Source Purse</label>
                            <select value={fSourcePurse} onChange={(e) => setFSourcePurse(e.target.value)} style={{ ...inputStyle, width: '100%', appearance: 'auto' }}>
                                <option value="">Main Purse</option>
                                {purseAllocations.map(a => <option key={a.instanceId} value={a.instanceId}>{a.instanceId}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>Target Purse</label>
                            <select value={fTargetPurse} onChange={(e) => setFTargetPurse(e.target.value)} style={{ ...inputStyle, width: '100%', appearance: 'auto' }}>
                                <option value="">Main Purse</option>
                                {purseAllocations.map(a => <option key={a.instanceId} value={a.instanceId}>{a.instanceId}</option>)}
                            </select>
                        </div>
                    </>)}
                    {/* Reclaim from Purse: source purse selector */}
                    {fActionType === ACTION_TYPE_WITHDRAW && (
                        <div>
                            <label style={labelStyle}>Source Purse</label>
                            <select value={fSourcePurse} onChange={(e) => setFSourcePurse(e.target.value)} style={{ ...inputStyle, width: '100%', appearance: 'auto' }}>
                                <option value="">Main Purse</option>
                                {purseAllocations.map(a => <option key={a.instanceId} value={a.instanceId}>{a.instanceId}</option>)}
                            </select>
                        </div>
                    )}
                    {/* Send: source purse selector */}
                    {fActionType === ACTION_TYPE_SEND && (
                        <div>
                            <label style={labelStyle}>Source Purse (debit)</label>
                            <select value={fSourcePurse} onChange={(e) => setFSourcePurse(e.target.value)} style={{ ...inputStyle, width: '100%', appearance: 'auto' }}>
                                <option value="">Main Purse</option>
                                {purseAllocations.map(a => <option key={a.instanceId} value={a.instanceId}>{a.instanceId}</option>)}
                            </select>
                        </div>
                    )}
                    {/* Send: destination ICRC1 account (principal + optional subaccount) */}
                    {fActionType === ACTION_TYPE_SEND && (
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={labelStyle}>Destination Account</label>
                            <PrincipalInput
                                value={fDestOwner}
                                onChange={setFDestOwner}
                                placeholder="Principal ID or ICRC-1 account..."
                                showSubaccountOption={true}
                                style={{ width: '100%' }}
                            />
                        </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '20px' }}>
                        <input type="checkbox" checked={fEnabled} onChange={(e) => setFEnabled(e.target.checked)} id={`action-enabled-${instanceId}-${formMode === 'add' ? 'new' : formMode.id}`} />
                        <label htmlFor={`action-enabled-${instanceId}-${formMode === 'add' ? 'new' : formMode.id}`} style={{ fontSize: '0.8rem', color: theme.colors.secondaryText }}>Enabled</label>
                    </div>
                </div>

                {/* Conditions toggle */}
                <div style={{ marginTop: '12px', borderTop: `1px solid ${theme.colors.border}`, paddingTop: '10px' }}>
                    <button
                        onClick={() => setShowConditions(!showConditions)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500', color: accentColor, padding: 0, display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                        {showConditions ? '▾' : '▸'} Conditions (optional)
                    </button>
                    {showConditions && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginTop: '10px' }}>
                            <div>
                                <label style={labelStyle}>Min Input Balance{balanceSymLabel}</label>
                                <input value={fMinBalance} onChange={(e) => setFMinBalance(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="Only run if balance ≥" />
                            </div>
                            <div>
                                <label style={labelStyle}>Max Input Balance{balanceSymLabel}</label>
                                <input value={fMaxBalance} onChange={(e) => setFMaxBalance(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="Only run if balance ≤" />
                            </div>
                            <div>
                                <label style={labelStyle}>Balance Denomination</label>
                                <TokenSelector
                                    value={fBalanceDenom}
                                    onChange={(v) => { setFBalanceDenom(v); setFMinBalance(''); setFMaxBalance(''); }}
                                    onSelectToken={cacheTokenMeta}
                                    allowCustom={true}
                                    placeholder="Native (input token)"
                                />
                                {fBalanceDenom && (
                                    <button type="button" onClick={() => { setFBalanceDenom(''); setFMinBalance(''); setFMaxBalance(''); }}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.65rem', color: accentColor, padding: '2px 0', marginTop: '2px' }}>
                                        Clear (use native)
                                    </button>
                                )}
                            </div>
                            {/* Price & slippage conditions — only for Trade (Swap) actions */}
                            {fActionType === ACTION_TYPE_TRADE && fOutputToken && (<>
                                {/* Row break before price fields */}
                                <div style={{ gridColumn: '1 / -1', borderTop: `1px solid ${theme.colors.border}20`, margin: '4px 0' }} />
                                {!fPriceDenom && (
                                    <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <label style={{ ...labelStyle, margin: 0 }}>Price direction:</label>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const newDir = fPriceDirection === 'output_per_input' ? 'input_per_output' : 'output_per_input';
                                                const oldMin = fMinPrice ? Number(fMinPrice) : null;
                                                const oldMax = fMaxPrice ? Number(fMaxPrice) : null;
                                                setFMinPrice(oldMax && oldMax > 0 ? String(1 / oldMax) : '');
                                                setFMaxPrice(oldMin && oldMin > 0 ? String(1 / oldMin) : '');
                                                setFPriceDirection(newDir);
                                            }}
                                            style={{
                                                ...secondaryButtonStyle,
                                                fontSize: '0.7rem',
                                                padding: '2px 8px',
                                                fontWeight: fPriceDirection ? '600' : '400',
                                            }}
                                        >
                                            ⇆ {priceLabel}
                                        </button>
                                    </div>
                                )}
                                <div>
                                    <label style={labelStyle}>Min Price ({denomPriceLabel})</label>
                                    <input value={fMinPrice} onChange={(e) => setFMinPrice(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder={`Skip if price below`} />
                                </div>
                                <div>
                                    <label style={labelStyle}>Max Price ({denomPriceLabel})</label>
                                    <input value={fMaxPrice} onChange={(e) => setFMaxPrice(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder={`Skip if price above`} />
                                </div>
                                <div>
                                    <label style={labelStyle}>Price Denomination</label>
                                    <TokenSelector
                                        value={fPriceDenom}
                                        onChange={(v) => { setFPriceDenom(v); setFMinPrice(''); setFMaxPrice(''); setFPriceDirection('input_per_output'); }}
                                        onSelectToken={cacheTokenMeta}
                                        allowCustom={true}
                                        placeholder="Native (input/output)"
                                    />
                                    {fPriceDenom && (
                                        <button type="button" onClick={() => { setFPriceDenom(''); setFMinPrice(''); setFMaxPrice(''); }}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.65rem', color: accentColor, padding: '2px 0', marginTop: '2px' }}>
                                            Clear (use native)
                                        </button>
                                    )}
                                </div>
                                {/* Row break before impact/slippage */}
                                <div style={{ gridColumn: '1 / -1', borderTop: `1px solid ${theme.colors.border}20`, margin: '4px 0' }} />
                                <div>
                                    <label style={labelStyle}>Max Price Impact (%)</label>
                                    <input value={fMaxPriceImpactBps} onChange={(e) => setFMaxPriceImpactBps(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="e.g. 1 = 1%" />
                                </div>
                                <div>
                                    <label style={labelStyle}>Max Slippage (%)</label>
                                    <input value={fMaxSlippageBps} onChange={(e) => setFMaxSlippageBps(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="e.g. 0.5 = 0.5%" />
                                </div>
                                {/* Trailing Stop section */}
                                <div style={{ gridColumn: '1 / -1', borderTop: `1px solid ${theme.colors.border}20`, margin: '4px 0' }} />
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginBottom: '6px' }}>
                                        <input type="checkbox" checked={!!fTrailingStopBps} onChange={e => { if (!e.target.checked) setFTrailingStopBps(''); else setFTrailingStopBps('5'); }} />
                                        <span style={{ fontSize: '0.8rem', color: theme.colors.primaryText, fontWeight: '500' }}>Trailing Stop</span>
                                    </label>
                                    {!!fTrailingStopBps && (
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', paddingLeft: '22px' }}>
                                            <div>
                                                <label style={labelStyle}>Mode</label>
                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                    <button type="button" onClick={() => setFTrailingStopDirection(0)}
                                                        style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 10px', background: fTrailingStopDirection === 0 ? accentColor : 'transparent', color: fTrailingStopDirection === 0 ? '#fff' : theme.colors.primaryText }}>
                                                        Stop Loss
                                                    </button>
                                                    <button type="button" onClick={() => setFTrailingStopDirection(1)}
                                                        style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 10px', background: fTrailingStopDirection === 1 ? accentColor : 'transparent', color: fTrailingStopDirection === 1 ? '#fff' : theme.colors.primaryText }}>
                                                        Take Profit
                                                    </button>
                                                </div>
                                            </div>
                                            <div>
                                                <label style={labelStyle}>Threshold (%)</label>
                                                <input value={fTrailingStopBps} onChange={(e) => setFTrailingStopBps(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal"
                                                    placeholder={fTrailingStopDirection === 0 ? 'e.g. 5 = sell when 5% below peak' : 'e.g. 3 = buy when 3% above trough'} />
                                            </div>
                                            <div>
                                                <label style={labelStyle}>Reset after execution</label>
                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                    <button type="button" onClick={() => setFTrailingStopResetOnExec(0)}
                                                        style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 10px', background: fTrailingStopResetOnExec === 0 ? accentColor : 'transparent', color: fTrailingStopResetOnExec === 0 ? '#fff' : theme.colors.primaryText }}>
                                                        Yes
                                                    </button>
                                                    <button type="button" onClick={() => setFTrailingStopResetOnExec(1)}
                                                        style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 10px', background: fTrailingStopResetOnExec === 1 ? accentColor : 'transparent', color: fTrailingStopResetOnExec === 1 ? '#fff' : theme.colors.primaryText }}>
                                                        No
                                                    </button>
                                                </div>
                                                <div style={{ fontSize: '0.65rem', color: theme.colors.secondaryText, marginTop: '3px' }}>
                                                    {fTrailingStopResetOnExec === 0 ? 'Watermark resets after each trade, tracking starts fresh' : 'Watermark keeps tracking from the all-time peak/trough'}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>)}
                        </div>
                    )}
                </div>

                {/* Limits section */}
                <div style={{ marginTop: '12px', borderTop: `1px solid ${theme.colors.border}`, paddingTop: '10px' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: '500', color: accentColor, marginBottom: '8px' }}>Limits (optional)</div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginBottom: '10px' }}>
                        <input type="checkbox" checked={fHaltAfterExec} onChange={e => setFHaltAfterExec(e.target.checked)} />
                        <span style={{ fontSize: '0.8rem', color: theme.colors.primaryText }}>Halt chore after execution</span>
                    </label>
                    {fHaltAfterExec && (
                        <div style={{ fontSize: '0.72rem', color: theme.colors.secondaryText, marginTop: '-6px', marginBottom: '8px', paddingLeft: '22px' }}>
                            The chore will be stopped after this action executes successfully (e.g. stop-loss / stop-buy).
                        </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
                        <div>
                            <label style={labelStyle}>Max Cumulative Input{fInputToken ? ` (${getSymbol(fInputToken)})` : ''}</label>
                            <input value={fMaxCumulativeInput} onChange={e => setFMaxCumulativeInput(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="e.g. 100 (budget)" />
                        </div>
                        {fActionType === ACTION_TYPE_TRADE && fOutputToken && (
                            <div>
                                <label style={labelStyle}>Max Cumulative Output{fOutputToken ? ` (${getSymbol(fOutputToken)})` : ''}</label>
                                <input value={fMaxCumulativeOutput} onChange={e => setFMaxCumulativeOutput(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="e.g. 1000 (target)" />
                            </div>
                        )}
                        <div>
                            <label style={labelStyle}>Max Executions</label>
                            <input value={fMaxExecutions} onChange={e => setFMaxExecutions(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="numeric" placeholder="e.g. 50" />
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <button onClick={handleSave} disabled={saving} style={{ ...buttonStyle, background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`, color: '#fff', border: 'none', opacity: saving ? 0.6 : 1 }}>
                        {isEditing ? <><FaSave style={{ marginRight: '4px', fontSize: '0.7rem' }} /> Save Changes</> : <><FaPlus style={{ marginRight: '4px', fontSize: '0.7rem' }} /> Add Action</>}
                    </button>
                    <button onClick={closeForm} style={{ ...secondaryButtonStyle }}>Cancel</button>
                </div>
            </div>
        );
    };

    return (
        <div style={cardStyle}>
            <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>{title}</h3>
            <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5' }}>{description}</p>

            {error && <div style={{ padding: '8px 12px', background: '#ef444415', border: '1px solid #ef444430', borderRadius: '8px', color: '#ef4444', fontSize: '0.8rem', marginBottom: '10px' }}>{error}</div>}
            {success && <div style={{ padding: '8px 12px', background: '#22c55e15', border: '1px solid #22c55e30', borderRadius: '8px', color: '#22c55e', fontSize: '0.8rem', marginBottom: '10px' }}>{success}</div>}

            {loading ? (
                <div style={{ textAlign: 'center', padding: '16px', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Loading actions...</div>
            ) : (
                <>
                    {actions.length === 0 && !formMode && (
                        <div style={{ textAlign: 'center', padding: '16px', color: theme.colors.mutedText, fontSize: '0.85rem', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                            No actions configured yet.
                        </div>
                    )}

                    {actions.map((action) => {
                        const inputSym = getSymbol(action.inputToken);
                        const inputDec = getDecimals(action.inputToken);
                                        const actTsDenom = optVal(action.tradeSizeDenominationToken) ? principalToStr(optVal(action.tradeSizeDenominationToken)) : '';
                                        const actOutputStr = action.outputToken?.length > 0 ? (typeof action.outputToken[0] === 'string' ? action.outputToken[0] : action.outputToken[0]?.toText?.() || String(action.outputToken[0])) : '';
                                        const isOutputSized = actTsDenom && actOutputStr && actTsDenom === actOutputStr;
                                        const actPDenom = optVal(action.priceDenominationToken) ? principalToStr(optVal(action.priceDenominationToken)) : '';
                                        const actBDenom = optVal(action.balanceDenominationToken) ? principalToStr(optVal(action.balanceDenominationToken)) : '';
                        const amtDec = actTsDenom ? getDecimals(actTsDenom) : inputDec;
                        const amtSym = actTsDenom ? getSymbol(actTsDenom) : inputSym;
                        const balDec = actBDenom ? getDecimals(actBDenom) : inputDec;
                        const balSym = actBDenom ? getSymbol(actBDenom) : inputSym;
                        const prcDec = actPDenom ? getDecimals(actPDenom) : inputDec;
                        const prcSym = actPDenom ? getSymbol(actPDenom) : null;
                        const isBeingEdited = formMode && formMode !== 'add' && formMode.id === Number(action.id);
                        return (
                            <div key={Number(action.id)}>
                                <div style={{
                                    padding: '12px', marginBottom: isBeingEdited ? '0' : '8px',
                                    background: theme.colors.primaryBg, borderRadius: isBeingEdited ? '8px 8px 0 0' : '8px',
                                    border: `1px solid ${isBeingEdited ? accentColor + '40' : action.enabled ? accentColor + '30' : theme.colors.border}`,
                                    borderBottom: isBeingEdited ? 'none' : undefined,
                                    opacity: action.enabled ? 1 : 0.6,
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                        <div>
                                            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: theme.colors.primaryText }}>
                                                {action.key ? `"${action.key}"` : `#${Number(action.id)}`} — {ACTION_TYPE_LABELS[Number(action.actionType)] || `Type ${Number(action.actionType)}`}
                                            </span>
                                            <span style={{ marginLeft: '8px', fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: action.enabled ? '#22c55e20' : '#6b728020', color: action.enabled ? '#22c55e' : '#6b7280' }}>
                                                {action.enabled ? 'Enabled' : 'Disabled'}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '6px' }}>
                                            {!isBeingEdited && (
                                                <button onClick={() => openEditForm(action)} disabled={saving || (formMode && formMode !== 'add')}
                                                    style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px' }}
                                                ><FaEdit style={{ fontSize: '0.6rem', marginRight: '3px' }} />Edit</button>
                                            )}
                                            <button onClick={() => handleToggle(action)} disabled={saving}
                                                style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px' }}
                                            >{action.enabled ? 'Disable' : 'Enable'}</button>
                                            <button onClick={() => handleRemove(Number(action.id))} disabled={saving}
                                                style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px', color: '#ef4444', borderColor: '#ef444440' }}
                                            ><FaTrash style={{ fontSize: '0.6rem' }} /></button>
                                        </div>
                                    </div>
                                    {!isBeingEdited && (
                                        <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '6px', fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                            <div><strong>Input:</strong> {inputSym}</div>
                                            {action.outputToken?.length > 0 && <div><strong>Output:</strong> {getSymbol(action.outputToken[0])}</div>}
                                            {Number(action.amountMode) === 1 ? (
                                                <>
                                                    <div><strong>Amount:</strong> {optVal(action.balancePercent) != null ? `${Number(optVal(action.balancePercent)) / 100}%` : '100%'} of balance</div>
                                                    {Number(action.minAmount) > 0 && <div><strong>Min cap:</strong> {isOutputSized
                                                        ? `Buy ${formatTokenAmount(action.minAmount, amtDec)} ${amtSym}`
                                                        : actTsDenom && hasCurrencySign(actTsDenom)
                                                        ? `${formatDenomAmount(Number(formatTokenAmount(action.minAmount, amtDec)), actTsDenom, amtSym)} of ${inputSym}`
                                                        : `${formatTokenAmount(action.minAmount, amtDec)} ${actTsDenom ? `${amtSym} of ${inputSym}` : inputSym}`}</div>}
                                                    {Number(action.maxAmount) > 0 && <div><strong>Max cap:</strong> {isOutputSized
                                                        ? `Buy ${formatTokenAmount(action.maxAmount, amtDec)} ${amtSym}`
                                                        : actTsDenom && hasCurrencySign(actTsDenom)
                                                        ? `${formatDenomAmount(Number(formatTokenAmount(action.maxAmount, amtDec)), actTsDenom, amtSym)} of ${inputSym}`
                                                        : `${formatTokenAmount(action.maxAmount, amtDec)} ${actTsDenom ? `${amtSym} of ${inputSym}` : inputSym}`}</div>}
                                                </>
                                            ) : (
                                                <>
                                                    <div><strong>{isOutputSized ? 'Min buy:' : 'Min:'}</strong> {isOutputSized
                                                        ? `${formatTokenAmount(action.minAmount, amtDec)} ${amtSym}`
                                                        : actTsDenom && hasCurrencySign(actTsDenom)
                                                        ? `${formatDenomAmount(Number(formatTokenAmount(action.minAmount, amtDec)), actTsDenom, amtSym)} of ${inputSym}`
                                                        : `${formatTokenAmount(action.minAmount, amtDec)} ${actTsDenom ? `${amtSym} of ${inputSym}` : inputSym}`}</div>
                                                    <div><strong>{isOutputSized ? 'Max buy:' : 'Max:'}</strong> {isOutputSized
                                                        ? `${formatTokenAmount(action.maxAmount, amtDec)} ${amtSym}`
                                                        : actTsDenom && hasCurrencySign(actTsDenom)
                                                        ? `${formatDenomAmount(Number(formatTokenAmount(action.maxAmount, amtDec)), actTsDenom, amtSym)} of ${inputSym}`
                                                        : `${formatTokenAmount(action.maxAmount, amtDec)} ${actTsDenom ? `${amtSym} of ${inputSym}` : inputSym}`}</div>
                                                </>
                                            )}
                                            {optVal(action.destinationOwner) && <div><strong>Dest:</strong> {shortPrincipal(optVal(action.destinationOwner))}</div>}
                                            {optVal(action.targetPurseId) && (() => {
                                                const p = purseAllocations.find(a => a.instanceId === optVal(action.targetPurseId));
                                                return <div><strong>To Purse:</strong> {p ? `${optVal(action.targetPurseId)}` : optVal(action.targetPurseId)}</div>;
                                            })()}
                                            {optVal(action.sourcePurseId) && (() => {
                                                return <div><strong>From Purse:</strong> {optVal(action.sourcePurseId)}</div>;
                                            })()}
                                            {optVal(action.minBalance) != null && <div><strong>Min Bal:</strong> {actBDenom && hasCurrencySign(actBDenom)
                                                ? formatDenomAmount(Number(formatTokenAmount(optVal(action.minBalance), balDec)), actBDenom, balSym)
                                                : `${formatTokenAmount(optVal(action.minBalance), balDec)} ${balSym}`}</div>}
                                            {optVal(action.maxBalance) != null && <div><strong>Max Bal:</strong> {actBDenom && hasCurrencySign(actBDenom)
                                                ? formatDenomAmount(Number(formatTokenAmount(optVal(action.maxBalance), balDec)), actBDenom, balSym)
                                                : `${formatTokenAmount(optVal(action.maxBalance), balDec)} ${balSym}`}</div>}
                                            {(() => {
                                                const outKey = action.outputToken?.length > 0 ? (typeof action.outputToken[0] === 'string' ? action.outputToken[0] : action.outputToken[0]?.toText?.() || String(action.outputToken[0])) : '';
                                                const outS = outKey ? getSymbol(outKey) : 'Output';
                                                const priceUnit = actPDenom ? denomPriceUnit(actPDenom, prcSym, outS) : `${inputSym}/${outS}`;
                                                const userMin = optVal(action.minPrice) != null ? e8sToHumanPrice(optVal(action.minPrice), prcDec, 'input_per_output') : null;
                                                const userMax = optVal(action.maxPrice) != null ? e8sToHumanPrice(optVal(action.maxPrice), prcDec, 'input_per_output') : null;
                                                const fmtPrice = (v) => {
                                                    if (actPDenom && hasCurrencySign(actPDenom)) return formatDenomAmount(v, actPDenom, prcSym);
                                                    return typeof v === 'number' ? v.toLocaleString(undefined, { maximumSignificantDigits: 6 }) : v;
                                                };
                                                return <>
                                                    {userMin != null && <div><strong>Min Price:</strong> {fmtPrice(userMin)}{actPDenom && hasCurrencySign(actPDenom) ? `/${outS}` : ` ${priceUnit}`}</div>}
                                                    {userMax != null && <div><strong>Max Price:</strong> {fmtPrice(userMax)}{actPDenom && hasCurrencySign(actPDenom) ? `/${outS}` : ` ${priceUnit}`}</div>}
                                                </>;
                                            })()}
                                            {optVal(action.maxPriceImpactBps) != null && <div><strong>Max Impact:</strong> {(Number(optVal(action.maxPriceImpactBps)) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%</div>}
                                            {optVal(action.maxSlippageBps) != null && <div><strong>Max Slippage:</strong> {(Number(optVal(action.maxSlippageBps)) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%</div>}
                                            {optVal(action.trailingStopBps) != null && (() => {
                                                const tsDir = optVal(action.trailingStopDirection);
                                                const isTP = tsDir != null && Number(tsDir) === 1;
                                                const tsPct = (Number(optVal(action.trailingStopBps)) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
                                                const resetMode = optVal(action.trailingStopResetOnExec);
                                                const resets = resetMode == null || Number(resetMode) === 0;
                                                const wm = optVal(action.trailingStopWatermarkE8s);
                                                const outKey = action.outputToken?.length > 0 ? (typeof action.outputToken[0] === 'string' ? action.outputToken[0] : action.outputToken[0]?.toText?.() || String(action.outputToken[0])) : '';
                                                const outS = outKey ? getSymbol(outKey) : 'Output';
                                                return <>
                                                    <div style={{ color: isTP ? '#22c55e' : '#ef4444' }}>
                                                        <strong>Trailing {isTP ? 'take profit' : 'stop loss'}:</strong> {tsPct}% from {isTP ? 'trough' : 'peak'}
                                                    </div>
                                                    {wm != null && Number(wm) > 0 && <div><strong>{isTP ? 'Trough' : 'Peak'}:</strong> {(Number(wm) / 1e8).toLocaleString(undefined, { maximumSignificantDigits: 6 })} {inputSym}/{outS}</div>}
                                                    <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText }}>{resets ? 'Resets after trade' : 'Never resets'}</div>
                                                </>;
                                            })()}
                                            {action.lastExecutedAt?.length > 0 && (
                                                <div><strong>Last run:</strong> {new Date(Number(action.lastExecutedAt[0]) / 1_000_000).toLocaleString()}</div>
                                            )}
                                            {action.haltChoreAfterExecution && (
                                                <div style={{ color: '#ef4444' }}><strong>Halt chore after execution</strong></div>
                                            )}
                                            {(() => {
                                                const outDec = action.outputToken?.length > 0 ? getDecimals(action.outputToken[0]) : 8;
                                                const outSym = action.outputToken?.length > 0 ? getSymbol(action.outputToken[0]) : '';
                                                const cumIn = Number(action.cumulativeInputSpent || 0);
                                                const cumOut = Number(action.cumulativeOutputReceived || 0);
                                                const exCount = Number(action.executionCount || 0);
                                                const maxIn = optVal(action.maxCumulativeInput);
                                                const maxOut = optVal(action.maxCumulativeOutput);
                                                const maxEx = optVal(action.maxExecutions);
                                                const hasStats = maxIn != null || maxOut != null || maxEx != null || exCount > 0;
                                                if (!hasStats) return null;
                                                return <>
                                                    {maxIn != null && <div><strong>Input budget:</strong> {formatTokenAmount(cumIn, inputDec)}/{formatTokenAmount(Number(maxIn), inputDec)} {inputSym}</div>}
                                                    {maxOut != null && <div><strong>Output target:</strong> {formatTokenAmount(cumOut, outDec)}/{formatTokenAmount(Number(maxOut), outDec)} {outSym}</div>}
                                                    {maxEx != null && <div><strong>Executions:</strong> {exCount}/{Number(maxEx)}</div>}
                                                    {maxIn == null && maxOut == null && maxEx == null && exCount > 0 && <div><strong>Executions:</strong> {exCount}</div>}
                                                    {exCount > 0 && (
                                                        <div><button onClick={async () => {
                                                            try {
                                                                const bot = await getReadyBotActor();
                                                                await bot.resetActionStats(instanceId, Number(action.id));
                                                                loadActions();
                                                            } catch (e) { setError(e.message); }
                                                        }} style={{ ...secondaryButtonStyle, fontSize: '0.65rem', padding: '2px 6px' }}>Reset Stats</button></div>
                                                    )}
                                                </>;
                                            })()}
                                        </div>
                                    )}
                                </div>
                                {/* Inline edit form directly below the action card */}
                                {isBeingEdited && renderForm()}
                            </div>
                        );
                    })}

                    {/* Add Action Form (at bottom) */}
                    {formMode === 'add' && renderForm()}

                    {/* Add button (only when not in any form mode) */}
                    {!formMode && (
                        <button onClick={openAddForm} style={{ ...secondaryButtonStyle, marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <FaPlus style={{ fontSize: '0.7rem' }} /> Add Action
                        </button>
                    )}
                </>
            )}
        </div>
    );
}

// ============================================
// PIE CHART — pure SVG donut chart
// ============================================
const CHART_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#06b6d4', '#84cc16', '#e11d48'];
const _tokenColorMap = new Map();
let _nextColorIdx = 0;
function getTokenColor(tokenId) {
    if (!tokenId) return CHART_COLORS[0];
    if (!_tokenColorMap.has(tokenId)) {
        _tokenColorMap.set(tokenId, CHART_COLORS[_nextColorIdx % CHART_COLORS.length]);
        _nextColorIdx++;
    }
    return _tokenColorMap.get(tokenId);
}
function PieChart({ segments, size = 140, thickness = 32, label, theme }) {
    const r = (size - thickness) / 2;
    const cx = size / 2;
    const cy = size / 2;
    const circ = 2 * Math.PI * r;
    const total = segments.reduce((s, seg) => s + (seg.value || 0), 0);
    let offset = 0;
    const arcs = total > 0 ? segments.filter(s => s.value > 0).map((seg) => {
        const frac = seg.value / total;
        const dashLen = frac * circ;
        const dashOffset = -offset * circ;
        offset += frac;
        return { ...seg, dashLen, dashOffset, frac };
    }) : [];
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', minWidth: size }}>
            {label && <div style={{ fontSize: '0.7rem', fontWeight: '600', color: theme.colors.secondaryText, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>}
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                {/* Background circle */}
                <circle cx={cx} cy={cy} r={r} fill="none" stroke={theme.colors.border} strokeWidth={thickness} opacity={0.3} />
                {arcs.map((arc, i) => (
                    <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                        stroke={arc.color}
                        strokeWidth={thickness}
                        strokeDasharray={`${arc.dashLen} ${circ - arc.dashLen}`}
                        strokeDashoffset={arc.dashOffset}
                        transform={`rotate(-90 ${cx} ${cy})`}
                        style={{ transition: 'stroke-dasharray 0.4s ease, stroke-dashoffset 0.4s ease' }}
                    />
                ))}
                {total > 0 && <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill={theme.colors.primaryText} fontSize="11" fontWeight="600">
                    {segments.length} tokens
                </text>}
                {total === 0 && <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill={theme.colors.mutedText} fontSize="10">No data</text>}
            </svg>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', justifyContent: 'center', maxWidth: size + 40 }}>
                {segments.map((seg, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.65rem', color: theme.colors.secondaryText }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: seg.color, flexShrink: 0 }} />
                        {seg.label} {total > 0 ? `${(((seg.value || 0) / total) * 100).toFixed(1)}%` : ''}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ============================================
// REBALANCER CONFIG PANEL
// ============================================
function RebalancerConfigPanel({ instanceId, getReadyBotActor, theme, accentColor, cardStyle, inputStyle, buttonStyle, secondaryButtonStyle, canisterId }) {
    const { identity } = useAuth();
    const [settings, setSettings] = useState(null);
    const [targets, setTargets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [saving, setSaving] = useState(false);

    // Edit state for targets
    const [editingTargets, setEditingTargets] = useState(null);

    // Frontend-only portfolio status
    const [tokenBalances, setTokenBalances] = useState({}); // { tokenId: BigInt balance }
    const [denomPrices, setDenomPrices] = useState({}); // { tokenId: number (denom units per 1 whole token) }
    const [balancesLoading, setBalancesLoading] = useState(false);
    const [pricesLoading, setPricesLoading] = useState(false);
    const balanceFetchRef = useRef('');
    const priceFetchRef = useRef('');
    const refreshTimerRef = useRef(null);

    // Resolve token metadata for all target tokens + denomination token + fallback route tokens
    const allTokenIds = React.useMemo(() => {
        const ids = new Set();
        for (const t of targets) {
            const key = typeof t.token === 'string' ? t.token : t.token?.toText?.() || String(t.token);
            ids.add(key);
        }
        if (settings?.denominationToken) {
            const key = typeof settings.denominationToken === 'string' ? settings.denominationToken : settings.denominationToken?.toText?.() || String(settings.denominationToken);
            ids.add(key);
        }
        for (const ft of (settings?.fallbackRouteTokens || [])) {
            const key = typeof ft === 'string' ? ft : ft?.toText?.() || String(ft);
            ids.add(key);
        }
        return [...ids];
    }, [targets, settings]);
    const tokenMeta = useTokenMetadata(allTokenIds, identity);

    const getTokenLabel = (principal) => {
        const key = typeof principal === 'string' ? principal : principal?.toText?.() || String(principal);
        const m = tokenMeta[key];
        if (!m) return shortPrincipal(key);
        return m.name && m.name !== m.symbol ? `${m.symbol} (${m.name})` : m.symbol;
    };
    const getSymbol = (principal) => {
        const key = typeof principal === 'string' ? principal : principal?.toText?.() || String(principal);
        return tokenMeta[key]?.symbol || shortPrincipal(key);
    };
    const getDecimals = (principal) => {
        const key = typeof principal === 'string' ? principal : principal?.toText?.() || String(principal);
        return tokenMeta[key]?.decimals ?? 8;
    };

    // Denomination token metadata
    const denomKey = settings?.denominationToken
        ? (typeof settings.denominationToken === 'string' ? settings.denominationToken : settings.denominationToken?.toText?.() || String(settings.denominationToken))
        : null;
    const denomMeta = denomKey ? tokenMeta[denomKey] : null;
    const denomDecimals = denomMeta?.decimals ?? 8;
    const denomSymbol = denomMeta?.symbol || 'tokens';

    // Token IDs for targets (stable string list)
    const targetTokenIds = React.useMemo(() =>
        targets.map(t => typeof t.token === 'string' ? t.token : t.token?.toText?.() || String(t.token)),
    [targets]);

    const loadData = useCallback(async () => {
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const [s, t] = await Promise.all([
                bot.getRebalanceSettings(instanceId),
                bot.getRebalanceTargets(instanceId),
            ]);
            setSettings(s);
            setTargets(t);
        } catch (err) {
            setError('Failed to load rebalancer config: ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [getReadyBotActor, instanceId]);

    useEffect(() => { loadData(); }, [loadData]);

    // --- Balance fetching: uses chore purse if enabled, otherwise main purse ---
    const fetchBalances = useCallback(async () => {
        if (targetTokenIds.length === 0) return;
        const key = `${instanceId}:${targetTokenIds.join(',')}`;
        if (key === balanceFetchRef.current && Object.keys(tokenBalances).length > 0) return;
        balanceFetchRef.current = key;
        setBalancesLoading(true);
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const purseEnabled = await bot.isPurseEnabled(instanceId);
            const results = {};
            if (purseEnabled) {
                const balances = await bot.getPurseBalances(instanceId);
                for (const b of balances) {
                    const tok = typeof b.token === 'string' ? b.token : b.token?.toText?.() || String(b.token);
                    results[tok] = BigInt(b.balance);
                }
            } else {
                const balances = await bot.getMainPurseBalances();
                for (const b of balances) {
                    const tok = typeof b.token === 'string' ? b.token : b.token?.toText?.() || String(b.token);
                    results[tok] = BigInt(b.balance);
                }
            }
            for (const tid of targetTokenIds) {
                if (!(tid in results)) results[tid] = 0n;
            }
            setTokenBalances(results);
        } catch (e) { console.warn('Failed to fetch rebalance balances:', e); }
        finally { setBalancesLoading(false); }
    }, [instanceId, targetTokenIds, getReadyBotActor]);

    // --- Frontend-only price fetching (via PriceService) ---
    const fetchPrices = useCallback(async () => {
        if (!denomKey || targetTokenIds.length === 0) return;
        const key = `${denomKey}:${targetTokenIds.join(',')}`;
        if (key === priceFetchRef.current && Object.keys(denomPrices).length > 0) return;
        setPricesLoading(true);
        try {
            const decFor = (id) => getTokenMetadataSync(id)?.decimals ?? 8;
            const prices = await fetchDenomPrices(targetTokenIds, denomKey, decFor);
            priceFetchRef.current = key;
            setDenomPrices(prices);
        } catch (e) { console.warn('Failed to fetch rebalance prices:', e); }
        finally { setPricesLoading(false); }
    }, [denomKey, targetTokenIds]);

    // Auto-fetch balances + prices when targets are known
    useEffect(() => { if (targetTokenIds.length > 0) fetchBalances(); }, [fetchBalances]);
    useEffect(() => { if (targetTokenIds.length > 0 && denomKey) fetchPrices(); }, [fetchPrices]);

    // Auto-refresh every 30s
    useEffect(() => {
        if (targetTokenIds.length === 0) return;
        refreshTimerRef.current = setInterval(() => {
            balanceFetchRef.current = ''; // force re-fetch
            priceFetchRef.current = '';
            fetchBalances();
            fetchPrices();
        }, 30_000);
        return () => clearInterval(refreshTimerRef.current);
    }, [fetchBalances, fetchPrices, targetTokenIds]);

    // Compute portfolio status from balances + prices + targets
    const portfolioStatus = React.useMemo(() => {
        if (targets.length === 0) return null;
        let totalValue = 0;
        const tokens = targetTokenIds.map((tid, i) => {
            const bal = tokenBalances[tid] ?? 0n;
            const dec = getDecimals(tid);
            const humanBal = Number(bal) / (10 ** dec);
            const price = denomPrices[tid];
            const value = price != null ? humanBal * price : 0;
            totalValue += value;
            return { tid, symbol: getSymbol(tid), balance: bal, humanBal, value, targetBps: Number(targets[i]?.targetBps ?? 0) };
        });
        const result = tokens.map(tok => {
            const currentBps = totalValue > 0 ? Math.round((tok.value / totalValue) * 10000) : 0;
            return { ...tok, currentBps, deviationBps: currentBps - tok.targetBps };
        });
        return { totalValue, tokens: result, hasBalances: Object.keys(tokenBalances).length > 0, hasPrices: Object.keys(denomPrices).length > 0 };
    }, [targets, targetTokenIds, tokenBalances, denomPrices, tokenMeta]);

    // Chart segments — saved targets
    const targetSegments = React.useMemo(() =>
        targets.map((t, i) => {
            const tid = typeof t.token === 'string' ? t.token : t.token?.toText?.() || String(t.token);
            return { label: getSymbol(tid), value: Number(t.targetBps), color: getTokenColor(tid) };
        }),
    [targets, tokenMeta]);

    // Chart segments — live editing preview
    const editingTargetSegments = React.useMemo(() => {
        if (!editingTargets) return null;
        return editingTargets.map((t, i) => ({
            label: t.token ? getSymbol(t.token) : `Token ${i + 1}`,
            value: Math.max(0, (parseFloat(t.targetBps) || 0) * 100),
            color: t.token ? getTokenColor(t.token) : CHART_COLORS[i % CHART_COLORS.length],
        }));
    }, [editingTargets, tokenMeta]);

    // Editing helpers
    const editingTotal = React.useMemo(() =>
        editingTargets ? editingTargets.reduce((s, t) => s + (parseFloat(t.targetBps) || 0), 0) : 0,
    [editingTargets]);
    const editingIsValid = editingTargets ? Math.abs(editingTotal - 100) < 0.01 : false;

    // Linked slider: when token i changes to newPct, redistribute delta among unlocked others
    const setLinkedTarget = useCallback((idx, newPct) => {
        if (!editingTargets) return;
        // Don't allow changing a locked token
        if (editingTargets[idx]?.locked) return;

        if (editingTargets.length <= 1) {
            const arr = [...editingTargets]; arr[idx] = { ...arr[idx], targetBps: newPct.toFixed(1) }; setEditingTargets(arr);
            return;
        }
        const oldPct = parseFloat(editingTargets[idx].targetBps) || 0;
        const delta = newPct - oldPct; // positive = this token grew, others must shrink
        if (Math.abs(delta) < 0.01) return;

        // Only redistribute among unlocked others
        const others = editingTargets.map((t, i) => ({ val: i === idx ? 0 : (parseFloat(t.targetBps) || 0), i, locked: !!t.locked })).filter(o => o.i !== idx && !o.locked);
        const othersTotal = others.reduce((s, o) => s + o.val, 0);
        const unlockCount = others.length;

        const arr = editingTargets.map((t, i) => {
            if (i === idx) return { ...t, targetBps: Math.max(0, Math.min(100, newPct)).toFixed(1) };
            if (t.locked) return t; // locked tokens stay as-is
            const cur = parseFloat(t.targetBps) || 0;
            if (othersTotal <= 0) {
                // All unlocked others are 0 — distribute evenly among them
                const share = unlockCount > 0 ? (100 - newPct - editingTargets.reduce((s, tt, j) => j !== idx && tt.locked ? s + (parseFloat(tt.targetBps) || 0) : s, 0)) / unlockCount : 0;
                return { ...t, targetBps: Math.max(0, share).toFixed(1) };
            }
            // Proportional redistribution among unlocked others
            const ratio = cur / othersTotal;
            const adjusted = cur - delta * ratio;
            return { ...t, targetBps: Math.max(0, adjusted).toFixed(1) };
        });

        // Fix rounding so total is exactly 100
        const total = arr.reduce((s, t) => s + parseFloat(t.targetBps), 0);
        if (Math.abs(total - 100) > 0.01) {
            // Find biggest unlocked "other" to absorb rounding error
            let maxIdx = -1; let maxVal = -1;
            arr.forEach((t, i) => { if (i !== idx && !t.locked) { const v = parseFloat(t.targetBps); if (v > maxVal) { maxVal = v; maxIdx = i; } } });
            if (maxIdx >= 0) {
                arr[maxIdx] = { ...arr[maxIdx], targetBps: Math.max(0, parseFloat(arr[maxIdx].targetBps) + (100 - total)).toFixed(1) };
            }
        }
        setEditingTargets(arr);
    }, [editingTargets]);

    const equalSplitTargets = () => {
        if (!editingTargets || editingTargets.length === 0) return;
        const lockedTotal = editingTargets.reduce((s, t) => t.locked ? s + (parseFloat(t.targetBps) || 0) : s, 0);
        const unlockCount = editingTargets.filter(t => !t.locked).length;
        if (unlockCount === 0) return;
        const remaining = 100 - lockedTotal;
        const base = Math.floor((remaining * 10 / unlockCount)) / 10;
        let unlockedIdx = 0;
        const arr = editingTargets.map(t => {
            if (t.locked) return t;
            unlockedIdx++;
            return { ...t, targetBps: base.toFixed(1) };
        });
        // Give remainder to first unlocked token
        const total = base * unlockCount;
        if (Math.abs(total - remaining) > 0.001) {
            const firstUnlocked = arr.findIndex(t => !t.locked);
            if (firstUnlocked >= 0) arr[firstUnlocked] = { ...arr[firstUnlocked], targetBps: (base + (remaining - total)).toFixed(1) };
        }
        setEditingTargets(arr);
    };

    const addEditingToken = () => {
        if (!editingTargets) return;
        const lockedTotal = editingTargets.reduce((s, t) => t.locked ? s + (parseFloat(t.targetBps) || 0) : s, 0);
        const unlockedPctTotal = editingTargets.reduce((s, t) => !t.locked ? s + (parseFloat(t.targetBps) || 0) : s, 0);
        const unlockCount = editingTargets.filter(t => !t.locked).length;
        const available = 100 - lockedTotal;
        const newShare = unlockCount > 0 ? Math.round((available * 10) / (unlockCount + 1)) / 10 : Math.round(available * 10) / 10;
        const scale = unlockedPctTotal > 0 ? (available - newShare) / unlockedPctTotal : 1;
        const arr = editingTargets.map(t => {
            if (t.locked) return t;
            return { ...t, targetBps: (Math.max(0, (parseFloat(t.targetBps) || 0) * scale)).toFixed(1) };
        });
        arr.push({ token: '', targetBps: newShare.toFixed(1), paused: false, locked: false });
        // Fix rounding — target first unlocked token
        const total = arr.reduce((s, t) => s + parseFloat(t.targetBps), 0);
        if (Math.abs(total - 100) > 0.01 && arr.length > 0) {
            const fixIdx = arr.findIndex(t => !t.locked);
            if (fixIdx >= 0) arr[fixIdx] = { ...arr[fixIdx], targetBps: (parseFloat(arr[fixIdx].targetBps) + (100 - total)).toFixed(1) };
        }
        setEditingTargets(arr);
    };

    const removeEditingToken = (idx) => {
        if (!editingTargets) return;
        const removed = parseFloat(editingTargets[idx].targetBps) || 0;
        const arr = editingTargets.filter((_, j) => j !== idx);
        if (arr.length === 0) { setEditingTargets(arr); return; }
        const lockedTotal = arr.reduce((s, t) => t.locked ? s + (parseFloat(t.targetBps) || 0) : s, 0);
        const unlockedTotal = arr.reduce((s, t) => !t.locked ? s + (parseFloat(t.targetBps) || 0) : s, 0);
        const unlockCount = arr.filter(t => !t.locked).length;
        if (unlockCount === 0) { setEditingTargets(arr); return; }
        if (unlockedTotal <= 0) {
            const each = ((100 - lockedTotal) / unlockCount).toFixed(1);
            setEditingTargets(arr.map(t => t.locked ? t : { ...t, targetBps: each }));
            return;
        }
        const targetUnlocked = 100 - lockedTotal;
        const scale = targetUnlocked / unlockedTotal;
        const result = arr.map(t => t.locked ? t : { ...t, targetBps: ((parseFloat(t.targetBps) || 0) * scale).toFixed(1) });
        const total = result.reduce((s, t) => s + parseFloat(t.targetBps), 0);
        if (Math.abs(total - 100) > 0.01) {
            const fixIdx = result.findIndex(t => !t.locked);
            if (fixIdx >= 0) result[fixIdx] = { ...result[fixIdx], targetBps: (parseFloat(result[fixIdx].targetBps) + (100 - total)).toFixed(1) };
        }
        setEditingTargets(result);
    };

    const currentSegments = React.useMemo(() => {
        if (!portfolioStatus) return [];
        return portfolioStatus.tokens.map((tok) => ({
            label: tok.symbol, value: tok.currentBps, color: getTokenColor(tok.tid),
        }));
    }, [portfolioStatus]);

    const handleSaveTargets = async () => {
        if (!editingTargets) return;
        const totalPct = editingTargets.reduce((sum, t) => sum + (parseFloat(t.targetBps) || 0), 0);
        if (Math.abs(totalPct - 100) > 0.01) { setError(`Target allocations must total 100%. Current total: ${totalPct.toFixed(2)}%.`); return; }
        // Validate all tokens are set
        for (const t of editingTargets) {
            if (!t.token) { setError('All tokens must be selected.'); return; }
        }
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const formatted = editingTargets.map(t => ({
                token: Principal.fromText(t.token),
                targetBps: BigInt(Math.round(parseFloat(t.targetBps) * 100)),
                paused: !!t.paused,
            }));
            await bot.setRebalanceTargets(instanceId, formatted);
            // Auto-register all target tokens to the token registry (idempotent)
            await Promise.all(editingTargets.map(t => {
                if (!t.token) return Promise.resolve();
                const meta = tokenMeta[t.token];
                return bot.addToken({
                    ledgerCanisterId: Principal.fromText(t.token),
                    symbol: meta?.symbol || '???',
                    decimals: meta?.decimals ?? 8,
                    fee: BigInt(meta?.fee ?? 10000),
                }).catch(() => {}); // silently ignore duplicates
            }));
            setSuccess('Rebalance targets updated.');
            setEditingTargets(null);
            await loadData();
        } catch (err) { setError('Failed to save targets: ' + err.message); }
        finally { setSaving(false); }
    };

    const handleSaveSetting = async (setter, value) => {
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            await bot[setter](instanceId, value);
            setSuccess('Setting updated.');
            await loadData();
        } catch (err) { setError('Failed to update: ' + err.message); }
        finally { setSaving(false); }
    };

    return (
        <div style={cardStyle}>
            <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>Rebalancer Configuration</h3>
            <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5' }}>
                Set target portfolio allocations. The rebalancer identifies over/underweight tokens
                and trades to bring the portfolio back to target.
            </p>

            {error && <div style={{ padding: '8px 12px', background: '#ef444415', border: '1px solid #ef444430', borderRadius: '8px', color: '#ef4444', fontSize: '0.8rem', marginBottom: '10px' }}>{error}</div>}
            {success && <div style={{ padding: '8px 12px', background: '#22c55e15', border: '1px solid #22c55e30', borderRadius: '8px', color: '#22c55e', fontSize: '0.8rem', marginBottom: '10px' }}>{success}</div>}

            {loading ? (
                <div style={{ textAlign: 'center', padding: '16px', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Loading rebalancer config...</div>
            ) : (
                <>
                    {/* Settings */}
                    {settings && (
                        <div style={{ marginBottom: '16px' }}>
                            <h4 style={{ color: theme.colors.primaryText, margin: '0 0 8px 0', fontSize: '0.85rem', fontWeight: '600' }}>Parameters</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                    <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Denomination Token</div>
                                    <div style={{ fontSize: '0.8rem', color: theme.colors.primaryText, fontWeight: '500' }}>{getTokenLabel(settings.denominationToken)}</div>
                                    <div style={{ marginTop: '6px' }}>
                                        <TokenSelector
                                            value={denomKey || ''}
                                            onChange={(v) => { if (v) handleSaveSetting('setRebalanceDenominationToken', Principal.fromText(v)); }}
                                            onSelectToken={cacheTokenMeta}
                                            allowCustom={true}
                                            placeholder="Change denomination token..."
                                            style={{ fontSize: '0.75rem' }}
                                        />
                                    </div>
                                </div>
                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                    <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Max Trade Size</div>
                                    <div style={{ fontSize: '0.8rem', color: theme.colors.primaryText }}>{formatTokenAmount(settings.maxTradeSize, denomDecimals)} {denomSymbol}</div>
                                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                                        <input type="text" inputMode="decimal" id={`rebal-max-trade-${instanceId}`} defaultValue={formatTokenAmount(settings.maxTradeSize, denomDecimals)} style={{ ...inputStyle, width: '100px', fontSize: '0.7rem' }} />
                                        <button onClick={() => { const v = document.getElementById(`rebal-max-trade-${instanceId}`)?.value; if (v) handleSaveSetting('setRebalanceMaxTradeSize', BigInt(parseTokenAmount(v, denomDecimals))); }} disabled={saving} style={{ ...secondaryButtonStyle, fontSize: '0.65rem', padding: '2px 6px' }}>Set</button>
                                    </div>
                                </div>
                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                    <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Min Trade Size</div>
                                    <div style={{ fontSize: '0.8rem', color: theme.colors.primaryText }}>{formatTokenAmount(settings.minTradeSize, denomDecimals)} {denomSymbol}</div>
                                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                                        <input type="text" inputMode="decimal" id={`rebal-min-trade-${instanceId}`} defaultValue={formatTokenAmount(settings.minTradeSize, denomDecimals)} style={{ ...inputStyle, width: '100px', fontSize: '0.7rem' }} />
                                        <button onClick={() => { const v = document.getElementById(`rebal-min-trade-${instanceId}`)?.value; if (v) handleSaveSetting('setRebalanceMinTradeSize', BigInt(parseTokenAmount(v, denomDecimals))); }} disabled={saving} style={{ ...secondaryButtonStyle, fontSize: '0.65rem', padding: '2px 6px' }}>Set</button>
                                    </div>
                                </div>
                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                    <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Threshold (%)</div>
                                    <div style={{ fontSize: '0.8rem', color: theme.colors.primaryText }}>{(Number(settings.thresholdBps) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%</div>
                                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                                        <input type="text" inputMode="decimal" id={`rebal-threshold-${instanceId}`} defaultValue={(Number(settings.thresholdBps) / 100).toString()} style={{ ...inputStyle, width: '60px', fontSize: '0.7rem' }} />
                                        <span style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, alignSelf: 'center' }}>%</span>
                                        <button onClick={() => { const v = document.getElementById(`rebal-threshold-${instanceId}`)?.value; if (v) handleSaveSetting('setRebalanceThresholdBps', BigInt(Math.round(Number(v) * 100))); }} disabled={saving} style={{ ...secondaryButtonStyle, fontSize: '0.65rem', padding: '2px 6px' }}>Set</button>
                                    </div>
                                </div>
                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                    <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Max Price Impact (%)</div>
                                    <div style={{ fontSize: '0.8rem', color: theme.colors.primaryText }}>{(Number(settings.maxPriceImpactBps) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%</div>
                                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                                        <input type="text" inputMode="decimal" id={`rebal-impact-${instanceId}`} defaultValue={(Number(settings.maxPriceImpactBps) / 100).toString()} style={{ ...inputStyle, width: '60px', fontSize: '0.7rem' }} />
                                        <span style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, alignSelf: 'center' }}>%</span>
                                        <button onClick={() => { const v = document.getElementById(`rebal-impact-${instanceId}`)?.value; if (v) handleSaveSetting('setRebalanceMaxPriceImpactBps', BigInt(Math.round(Number(v) * 100))); }} disabled={saving} style={{ ...secondaryButtonStyle, fontSize: '0.65rem', padding: '2px 6px' }}>Set</button>
                                    </div>
                                </div>
                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                    <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Max Slippage (%)</div>
                                    <div style={{ fontSize: '0.8rem', color: theme.colors.primaryText }}>{(Number(settings.maxSlippageBps) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%</div>
                                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                                        <input type="text" inputMode="decimal" id={`rebal-slippage-${instanceId}`} defaultValue={(Number(settings.maxSlippageBps) / 100).toString()} style={{ ...inputStyle, width: '60px', fontSize: '0.7rem' }} />
                                        <span style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, alignSelf: 'center' }}>%</span>
                                        <button onClick={() => { const v = document.getElementById(`rebal-slippage-${instanceId}`)?.value; if (v) handleSaveSetting('setRebalanceMaxSlippageBps', BigInt(Math.round(Number(v) * 100))); }} disabled={saving} style={{ ...secondaryButtonStyle, fontSize: '0.65rem', padding: '2px 6px' }}>Set</button>
                                    </div>
                                </div>
                            </div>

                            {/* Fallback Route Tokens */}
                            <div style={{ marginTop: '10px', padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginBottom: '6px' }}>Fallback Route Tokens</div>
                                <div style={{ fontSize: '0.65rem', color: theme.colors.mutedText, marginBottom: '6px', lineHeight: '1.4' }}>
                                    When a direct swap has no liquidity or high price impact, the rebalancer routes through these intermediary tokens in order. Paused tokens in the portfolio are automatically skipped.
                                </div>
                                {(settings.fallbackRouteTokens || []).length > 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' }}>
                                        {(settings.fallbackRouteTokens || []).map((ft, i) => {
                                            const ftKey = typeof ft === 'string' ? ft : ft?.toText?.() || String(ft);
                                            return (
                                                <div key={ftKey} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', background: `${accentColor}08`, borderRadius: '6px', border: `1px solid ${theme.colors.border}` }}>
                                                    <span style={{ fontSize: '0.7rem', color: theme.colors.mutedText, fontWeight: '500', width: '16px', textAlign: 'center' }}>{i + 1}.</span>
                                                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                        <TokenIcon canisterId={ftKey} size={16} />
                                                        <span style={{ fontSize: '0.78rem', color: theme.colors.primaryText, fontWeight: '500' }}>{getSymbol(ft)}</span>
                                                    </div>
                                                    {i > 0 && (
                                                        <button onClick={async () => {
                                                            const arr = [...(settings.fallbackRouteTokens || [])];
                                                            [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
                                                            await handleSaveSetting('setRebalanceFallbackRouteTokens', arr);
                                                        }} disabled={saving} style={{ ...secondaryButtonStyle, fontSize: '0.55rem', padding: '1px 4px' }} title="Move up">▲</button>
                                                    )}
                                                    {i < (settings.fallbackRouteTokens || []).length - 1 && (
                                                        <button onClick={async () => {
                                                            const arr = [...(settings.fallbackRouteTokens || [])];
                                                            [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
                                                            await handleSaveSetting('setRebalanceFallbackRouteTokens', arr);
                                                        }} disabled={saving} style={{ ...secondaryButtonStyle, fontSize: '0.55rem', padding: '1px 4px' }} title="Move down">▼</button>
                                                    )}
                                                    <button onClick={async () => {
                                                        const arr = (settings.fallbackRouteTokens || []).filter((_, j) => j !== i);
                                                        await handleSaveSetting('setRebalanceFallbackRouteTokens', arr);
                                                    }} disabled={saving} style={{ ...secondaryButtonStyle, fontSize: '0.55rem', padding: '1px 4px', color: '#ef4444', borderColor: '#ef444440' }} title="Remove">
                                                        <FaTrash style={{ fontSize: '0.5rem' }} />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, marginBottom: '6px', fontStyle: 'italic' }}>
                                        Default: ICP only
                                    </div>
                                )}
                                <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end' }}>
                                    <div style={{ flex: 1 }}>
                                        <TokenSelector
                                            value=""
                                            onChange={async (v) => {
                                                if (!v) return;
                                                const existing = (settings.fallbackRouteTokens || []).map(ft => typeof ft === 'string' ? ft : ft?.toText?.() || String(ft));
                                                if (existing.includes(v)) return;
                                                const arr = [...(settings.fallbackRouteTokens || []), Principal.fromText(v)];
                                                await handleSaveSetting('setRebalanceFallbackRouteTokens', arr);
                                            }}
                                            onSelectToken={cacheTokenMeta}
                                            allowCustom={true}
                                            placeholder="Add fallback token..."
                                            style={{ fontSize: '0.7rem' }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Targets */}
                    <div style={{ marginBottom: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <h4 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '0.85rem', fontWeight: '600' }}>
                                Target Allocations ({targets.length} token{targets.length !== 1 ? 's' : ''})
                            </h4>
                            {editingTargets === null ? (
                                <button onClick={() => {
                                    const raw = targets.map(t => ({ token: t.token.toText ? t.token.toText() : String(t.token), targetBps: Number(t.targetBps) / 100, paused: !!t.paused, locked: false }));
                                    const total = raw.reduce((s, t) => s + t.targetBps, 0);
                                    const scale = total > 0 ? 100 / total : 1;
                                    const normed = raw.map(t => ({ ...t, targetBps: (t.targetBps * scale).toFixed(1) }));
                                    // Fix rounding
                                    const nTotal = normed.reduce((s, t) => s + parseFloat(t.targetBps), 0);
                                    if (normed.length > 0 && Math.abs(nTotal - 100) > 0.01) normed[0] = { ...normed[0], targetBps: (parseFloat(normed[0].targetBps) + (100 - nTotal)).toFixed(1) };
                                    setEditingTargets(normed.length > 0 ? normed : [{ token: '', targetBps: '100.0', paused: false, locked: false }]);
                                }} style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <FaEdit style={{ fontSize: '0.65rem' }} /> Edit
                                </button>
                            ) : (
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <button onClick={handleSaveTargets} disabled={saving || !editingIsValid} style={{ ...buttonStyle, fontSize: '0.7rem', padding: '3px 8px', background: editingIsValid ? `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)` : theme.colors.border, color: editingIsValid ? '#fff' : theme.colors.mutedText, border: 'none', display: 'flex', alignItems: 'center', gap: '4px', cursor: editingIsValid ? 'pointer' : 'not-allowed' }} title={editingIsValid ? 'Save targets' : `Allocations must total 100% (currently ${editingTotal.toFixed(1)}%)`}>
                                        <FaSave style={{ fontSize: '0.6rem' }} /> Save
                                    </button>
                                    <button onClick={() => setEditingTargets(null)} style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <FaTimes style={{ fontSize: '0.6rem' }} /> Cancel
                                    </button>
                                </div>
                            )}
                        </div>

                        {editingTargets === null ? (
                            targets.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '16px', color: theme.colors.mutedText, fontSize: '0.85rem', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                    No rebalance targets set. Click Edit to add tokens.
                                </div>
                            ) : (
                                <div style={{ display: 'grid', gap: '6px' }}>
                                    {targets.map((t, i) => {
                                        const tid = typeof t.token === 'string' ? t.token : t.token?.toText?.() || String(t.token);
                                        const isPaused = !!t.paused;
                                        return (
                                            <div key={tid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${isPaused ? '#f59e0b40' : theme.colors.border}`, opacity: isPaused ? 0.6 : 1 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: getTokenColor(tid), flexShrink: 0 }} />
                                                    <span style={{ fontSize: '0.8rem', color: theme.colors.primaryText, fontWeight: '500' }}>{getTokenLabel(t.token)}</span>
                                                    {isPaused && <span style={{ fontSize: '0.6rem', color: '#f59e0b', fontWeight: '600', padding: '1px 5px', background: '#f59e0b15', borderRadius: '4px', border: '1px solid #f59e0b30' }}>PAUSED</span>}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ fontSize: '0.85rem', fontWeight: '600', color: accentColor }}>{(Number(t.targetBps) / 100).toFixed(1)}%</span>
                                                    <button
                                                        onClick={async () => {
                                                            setSaving(true); setError(''); setSuccess('');
                                                            try {
                                                                const bot = await getReadyBotActor();
                                                                const updated = targets.map((tt, j) => ({
                                                                    token: tt.token,
                                                                    targetBps: tt.targetBps,
                                                                    paused: j === i ? !isPaused : !!tt.paused,
                                                                }));
                                                                await bot.setRebalanceTargets(instanceId, updated);
                                                                setSuccess(isPaused ? `${getSymbol(t.token)} unpaused.` : `${getSymbol(t.token)} paused.`);
                                                                await loadData();
                                                            } catch (err) { setError('Failed to update: ' + err.message); }
                                                            finally { setSaving(false); }
                                                        }}
                                                        disabled={saving}
                                                        style={{ ...secondaryButtonStyle, fontSize: '0.6rem', padding: '2px 6px', color: isPaused ? '#22c55e' : '#f59e0b', borderColor: isPaused ? '#22c55e40' : '#f59e0b40' }}
                                                        title={isPaused ? 'Resume rebalancing for this token' : 'Pause rebalancing for this token'}
                                                    >
                                                        {isPaused ? <FaPlay style={{ fontSize: '0.5rem' }} /> : <FaPause style={{ fontSize: '0.5rem' }} />}
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    <div style={{ textAlign: 'right', fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                        Total: {(targets.reduce((s, t) => s + Number(t.targetBps), 0) / 100).toFixed(1)}%
                                    </div>
                                </div>
                            )
                        ) : (
                            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                {/* Live pie chart preview */}
                                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                                    <PieChart segments={editingTargetSegments || []} label="Preview" theme={theme} />
                                    {/* Total indicator */}
                                    <div style={{
                                        padding: '6px 12px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '600', textAlign: 'center',
                                        background: editingIsValid ? '#22c55e15' : '#f59e0b15',
                                        border: `1px solid ${editingIsValid ? '#22c55e40' : '#f59e0b40'}`,
                                        color: editingIsValid ? '#22c55e' : '#f59e0b',
                                    }}>
                                        Total: {editingTotal.toFixed(1)}%
                                        {editingTargets && editingTargets.length > 0 && (
                                            <span style={{ fontSize: '0.65rem', fontWeight: '400', marginLeft: '4px', opacity: 0.7 }}>
                                                ({editingTargets.length} token{editingTargets.length !== 1 ? 's' : ''})
                                            </span>
                                        )}
                                    </div>
                                </div>
                                {/* Editing form (drag-and-drop reorderable) */}
                                <DndProvider backend={HTML5Backend}>
                                <div style={{ flex: 1, minWidth: '260px' }}>
                                    {editingTargets.map((t, i) => {
                                        const pct = parseFloat(t.targetBps) || 0;
                                        return (
                                            <DraggableEditingTarget key={t.token || `new-${i}`} index={i} onReorder={(from, to) => {
                                                const arr = [...editingTargets];
                                                const [moved] = arr.splice(from, 1);
                                                arr.splice(to, 0, moved);
                                                setEditingTargets(arr);
                                            }} theme={theme}>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                                                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: t.token ? getTokenColor(t.token) : CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                                                    <div style={{ flex: 1 }}>
                                                        <TokenSelector
                                                            value={t.token}
                                                            onChange={(v) => { const arr = [...editingTargets]; arr[i] = { ...arr[i], token: v }; setEditingTargets(arr); }}
                                                            onSelectToken={cacheTokenMeta}
                                                            allowCustom={true}
                                                            placeholder="Select token..."
                                                        />
                                                    </div>
                                                    <button onClick={() => {
                                                        const arr = [...editingTargets]; arr[i] = { ...arr[i], paused: !arr[i].paused }; setEditingTargets(arr);
                                                    }} style={{ ...secondaryButtonStyle, fontSize: '0.65rem', padding: '2px 6px', color: t.paused ? '#f59e0b' : theme.colors.mutedText, borderColor: t.paused ? '#f59e0b40' : theme.colors.border }} title={t.paused ? 'Unpause token (include in rebalancing)' : 'Pause token (exclude from rebalancing)'}>
                                                        {t.paused ? <FaPlay style={{ fontSize: '0.55rem' }} /> : <FaPause style={{ fontSize: '0.55rem' }} />}
                                                    </button>
                                                    <button onClick={() => removeEditingToken(i)} style={{ ...secondaryButtonStyle, fontSize: '0.65rem', padding: '2px 6px', color: '#ef4444', borderColor: '#ef444440' }}>
                                                        <FaTrash style={{ fontSize: '0.6rem' }} />
                                                    </button>
                                                </div>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                    <button onClick={() => {
                                                        const arr = [...editingTargets]; arr[i] = { ...arr[i], locked: !arr[i].locked }; setEditingTargets(arr);
                                                    }} style={{ ...secondaryButtonStyle, fontSize: '0.6rem', padding: '2px 5px', color: t.locked ? accentColor : theme.colors.mutedText, borderColor: t.locked ? `${accentColor}40` : theme.colors.border, flexShrink: 0 }} title={t.locked ? 'Unlock slider' : 'Lock slider (prevent adjustment)'}>
                                                        {t.locked ? <FaLock style={{ fontSize: '0.55rem' }} /> : <FaLockOpen style={{ fontSize: '0.55rem' }} />}
                                                    </button>
                                                    <input
                                                        type="range" min="0" max="100" step="0.1"
                                                        value={pct}
                                                        onChange={(e) => setLinkedTarget(i, parseFloat(e.target.value))}
                                                        disabled={!!t.locked}
                                                        style={{ flex: 1, accentColor: t.token ? getTokenColor(t.token) : CHART_COLORS[i % CHART_COLORS.length], cursor: t.locked ? 'not-allowed' : 'pointer', height: '6px', opacity: t.locked ? 0.5 : 1 }}
                                                    />
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                                        <input
                                                            value={t.targetBps}
                                                            onChange={(e) => {
                                                                if (t.locked) return;
                                                                const v = e.target.value;
                                                                if (v === '' || /^[0-9]*\.?[0-9]*$/.test(v)) {
                                                                    const arr = [...editingTargets]; arr[i] = { ...arr[i], targetBps: v }; setEditingTargets(arr);
                                                                }
                                                            }}
                                                            onBlur={() => {
                                                                if (t.locked) return;
                                                                const num = parseFloat(editingTargets[i].targetBps);
                                                                if (!isNaN(num)) setLinkedTarget(i, Math.max(0, Math.min(100, num)));
                                                                else setLinkedTarget(i, 0);
                                                            }}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') e.target.blur();
                                                            }}
                                                            disabled={!!t.locked}
                                                            style={{ ...inputStyle, width: '60px', fontSize: '0.75rem', textAlign: 'right', opacity: t.locked ? 0.5 : 1 }}
                                                            type="text" inputMode="decimal"
                                                        />
                                                        <span style={{ fontSize: '0.7rem', color: theme.colors.secondaryText }}>%</span>
                                                    </div>
                                                </div>
                                            </DraggableEditingTarget>
                                        );
                                    })}
                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '6px' }}>
                                        <button onClick={addEditingToken} style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <FaPlus style={{ fontSize: '0.6rem' }} /> Add Token
                                        </button>
                                        <button onClick={equalSplitTargets} disabled={editingTargets.length === 0} style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px' }} title="Set all tokens to equal percentage">
                                            Equal Split
                                        </button>
                                    </div>
                                </div>
                                </DndProvider>
                            </div>
                        )}
                    </div>

                    {/* Portfolio Status — pie charts + table (auto-refreshed) */}
                    {targets.length > 0 && (
                        <div>
                            <h4 style={{ color: theme.colors.primaryText, margin: '0 0 10px 0', fontSize: '0.85rem', fontWeight: '600' }}>
                                Portfolio Status
                                {(balancesLoading || pricesLoading) && <span style={{ fontWeight: '400', fontSize: '0.7rem', color: theme.colors.mutedText, marginLeft: '8px' }}>refreshing...</span>}
                            </h4>

                            {/* Pie charts: Target vs Current */}
                            <div style={{ display: 'flex', gap: '24px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '14px', padding: '12px', background: theme.colors.primaryBg, borderRadius: '10px', border: `1px solid ${theme.colors.border}` }}>
                                <PieChart segments={targetSegments} label="Target" theme={theme} />
                                <PieChart segments={currentSegments.length > 0 ? currentSegments : targetSegments.map(s => ({ ...s, value: 0 }))} label="Current" theme={theme} />
                            </div>

                            {/* Portfolio table */}
                            {portfolioStatus && portfolioStatus.hasBalances && (
                                <div style={{ background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}`, overflow: 'hidden' }}>
                                    <div style={{ padding: '8px 12px', fontSize: '0.75rem', color: theme.colors.secondaryText, borderBottom: `1px solid ${theme.colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span>Total value: <strong style={{ color: theme.colors.primaryText }}>
                                            {portfolioStatus.hasPrices
                                                ? formatDenomAmount(portfolioStatus.totalValue, denomKey, denomSymbol)
                                                : '...'}
                                        </strong></span>
                                        <span style={{ fontSize: '0.65rem', color: theme.colors.mutedText }}>Auto-refreshes every 30s</span>
                                    </div>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                                        <thead>
                                            <tr style={{ background: `${accentColor}08` }}>
                                                <th style={{ padding: '6px 10px', textAlign: 'left', color: theme.colors.secondaryText, fontWeight: '500' }}>Token</th>
                                                <th style={{ padding: '6px 10px', textAlign: 'right', color: theme.colors.secondaryText, fontWeight: '500' }}>Balance</th>
                                                <th style={{ padding: '6px 10px', textAlign: 'right', color: theme.colors.secondaryText, fontWeight: '500' }}>Value</th>
                                                <th style={{ padding: '6px 10px', textAlign: 'right', color: theme.colors.secondaryText, fontWeight: '500' }}>Current</th>
                                                <th style={{ padding: '6px 10px', textAlign: 'right', color: theme.colors.secondaryText, fontWeight: '500' }}>Target</th>
                                                <th style={{ padding: '6px 10px', textAlign: 'right', color: theme.colors.secondaryText, fontWeight: '500' }}>Deviation</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {portfolioStatus.tokens.map((tok, i) => {
                                                const isPaused = !!targets[i]?.paused;
                                                return (
                                                <tr key={i} style={{ borderTop: `1px solid ${theme.colors.border}`, opacity: isPaused ? 0.5 : 1 }}>
                                                    <td style={{ padding: '6px 10px', color: theme.colors.primaryText }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: getTokenColor(tok.tid), flexShrink: 0 }} />
                                                            {tok.symbol}
                                                            {isPaused && <span style={{ fontSize: '0.55rem', color: '#f59e0b', fontWeight: '600' }}>PAUSED</span>}
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: theme.colors.secondaryText, fontSize: '0.72rem' }}>
                                                        {formatTokenAmount(tok.balance, getDecimals(tok.tid))}
                                                    </td>
                                                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: theme.colors.secondaryText, fontSize: '0.72rem' }}>
                                                        {tok.value > 0 ? formatDenomAmount(tok.value, denomKey, denomSymbol) : '...'}
                                                    </td>
                                                    <td style={{ padding: '6px 10px', textAlign: 'right', color: theme.colors.primaryText }}>{(tok.currentBps / 100).toFixed(1)}%</td>
                                                    <td style={{ padding: '6px 10px', textAlign: 'right', color: theme.colors.primaryText }}>{(tok.targetBps / 100).toFixed(1)}%</td>
                                                    <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '500', color: tok.deviationBps > 0 ? '#ef4444' : tok.deviationBps < 0 ? '#3b82f6' : theme.colors.secondaryText }}>
                                                        {tok.deviationBps > 0 ? '+' : ''}{(tok.deviationBps / 100).toFixed(1)}%
                                                    </td>
                                                </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            {!portfolioStatus?.hasBalances && balancesLoading && (
                                <div style={{ textAlign: 'center', padding: '12px', color: theme.colors.mutedText, fontSize: '0.8rem' }}>Fetching balances...</div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// ============================================
// DISTRIBUTION CONFIG PANEL
// ============================================
function DistributionConfigPanel({ instanceId, getReadyBotActor, theme, accentColor, cardStyle, inputStyle, buttonStyle, secondaryButtonStyle }) {
    const { identity } = useAuth();
    const [lists, setLists] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [saving, setSaving] = useState(false);
    const [adding, setAdding] = useState(false);
    const [expandedList, setExpandedList] = useState(null);
    const [subaccounts, setSubaccounts] = useState([]);
    const [purseAllocations, setPurseAllocations] = useState([]);
    const [choreStatuses, setChoreStatuses] = useState([]);
    const [editingTargets, setEditingTargets] = useState(null);
    const [draftTargets, setDraftTargets] = useState([]);
    const [editingSettings, setEditingSettings] = useState(null);
    const [draftSettings, setDraftSettings] = useState({});

    const [newName, setNewName] = useState('');
    const [newLedger, setNewLedger] = useState('');
    const [newThreshold, setNewThreshold] = useState('0');
    const [newMaxDist, setNewMaxDist] = useState('0');
    const [newMinDist, setNewMinDist] = useState('0');
    const [newSourcePurse, setNewSourcePurse] = useState('');
    const [newAmountMode, setNewAmountMode] = useState('0');
    const [newBalancePct, setNewBalancePct] = useState('100');

    const loadLists = useCallback(async () => {
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const [result, purses, statuses] = await Promise.all([
                bot.getDistributionLists(instanceId),
                bot.getAllPurseAllocations ? bot.getAllPurseAllocations() : [],
                bot.getChoreStatuses ? bot.getChoreStatuses() : [],
            ]);
            setLists(result);
            setPurseAllocations(purses);
            setChoreStatuses(statuses);
        } catch (err) { setError('Failed to load distribution lists: ' + err.message); }
        finally { setLoading(false); }
    }, [getReadyBotActor, instanceId]);

    useEffect(() => { loadLists(); }, [loadLists]);

    const resolveSourceLabel = (list) => {
        const spid = list.sourcePurseId?.[0] || '';
        if (spid) return `Purse: ${choreLabel(spid)}`;
        return 'Main Purse';
    };

    const purseOptions = React.useMemo(() => {
        return purseAllocations
            .filter(p => p.enabled)
            .map(p => {
                const cs = choreStatuses.find(c => c.choreId === p.instanceId);
                return { value: p.instanceId, label: cs?.instanceLabel || p.instanceId };
            });
    }, [purseAllocations, choreStatuses]);

    const choreLabel = (cid) => {
        const cs = choreStatuses.find(c => c.choreId === cid);
        return cs?.instanceLabel || cid;
    };

    // Candid target -> draft target for editing
    const candidToDraft = (t) => {
        const cid = (Array.isArray(t.choreInstanceId) ? t.choreInstanceId[0] : t.choreInstanceId) || '';
        const isPurse = !!cid;
        const ownerStr = !isPurse ? (typeof t.account?.owner === 'string' ? t.account.owner : t.account?.owner?.toText?.() || '') : '';
        const subBlob = t.account?.subaccount;
        const hasSub = subBlob && subBlob.length > 0 && subBlob[0] && Array.from(subBlob[0]).some(b => b !== 0);
        return {
            type: isPurse ? 'purse' : 'external',
            choreInstanceId: cid,
            owner: ownerStr,
            subaccount: hasSub ? subBlob[0] : null,
            basisPoints: t.basisPoints?.length > 0 ? (Number(t.basisPoints[0]) / 100).toString() : '',
        };
    };

    // Draft target -> Candid target for saving
    const draftToCandid = (d) => {
        const bps = d.basisPoints !== '' && d.basisPoints != null ? [BigInt(Math.round(parseFloat(d.basisPoints) * 100))] : [];
        if (d.type === 'purse') {
            return {
                account: { owner: Principal.fromText('aaaaa-aa'), subaccount: [] },
                basisPoints: bps,
                choreInstanceId: [d.choreInstanceId],
            };
        }
        const subBlob = d.subaccount ? [Array.from(d.subaccount)] : [];
        return {
            account: { owner: Principal.fromText(d.owner), subaccount: subBlob },
            basisPoints: bps,
            choreInstanceId: [],
        };
    };

    const handleAdd = async () => {
        if (!newName.trim()) { setError('Name is required.'); return; }
        if (!newLedger.trim()) { setError('Token ledger canister ID is required.'); return; }
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            await bot.addDistributionList(instanceId, {
                name: newName.trim(),
                tokenLedgerCanisterId: Principal.fromText(newLedger.trim()),
                thresholdAmount: BigInt(newThreshold || 0),
                maxDistributionAmount: BigInt(newMaxDist || 0),
                targets: [],
                sourcePurseId: newSourcePurse ? [newSourcePurse] : [],
                amountMode: BigInt(newAmountMode),
                balancePercent: newAmountMode === '1' ? [BigInt(Math.round(parseFloat(newBalancePct || '100') * 100))] : [],
                minDistributionAmount: BigInt(newMinDist || 0),
            });
            setSuccess('Distribution list added.');
            setAdding(false); setNewName(''); setNewLedger(''); setNewThreshold('0'); setNewMaxDist('0'); setNewMinDist('0'); setNewSourcePurse(''); setNewAmountMode('0'); setNewBalancePct('100');
            await loadLists();
        } catch (err) { setError('Failed to add: ' + err.message); }
        finally { setSaving(false); }
    };

    const handleRemove = async (id) => {
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            await bot.removeDistributionList(instanceId, BigInt(id));
            setSuccess('Distribution list removed.');
            await loadLists();
        } catch (err) { setError('Failed to remove: ' + err.message); }
        finally { setSaving(false); }
    };

    const startEditingTargets = (list) => {
        setEditingTargets(Number(list.id));
        setDraftTargets(list.targets.map(candidToDraft));
    };

    const cancelEditingTargets = () => { setEditingTargets(null); setDraftTargets([]); };

    const startEditingSettings = (list) => {
        const lid = Number(list.id);
        const mode = Number(list.amountMode ?? 0);
        setEditingSettings(lid);
        setDraftSettings({
            amountMode: String(mode),
            balancePercent: list.balancePercent?.[0] != null ? String(Number(list.balancePercent[0]) / 100) : '100',
            minDistributionAmount: String(Number(list.minDistributionAmount ?? 0)),
            maxDistributionAmount: String(Number(list.maxDistributionAmount)),
            thresholdAmount: String(Number(list.thresholdAmount)),
            sourcePurseId: list.sourcePurseId?.[0] || '',
        });
    };
    const cancelEditingSettings = () => { setEditingSettings(null); setDraftSettings({}); };

    const saveSettings = async (listId) => {
        const list = lists.find(l => Number(l.id) === listId);
        if (!list) return;
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const ledger = typeof list.tokenLedgerCanisterId === 'string' ? list.tokenLedgerCanisterId : list.tokenLedgerCanisterId?.toText?.();
            const mode = draftSettings.amountMode || '0';
            await bot.updateDistributionList(instanceId, BigInt(listId), {
                name: list.name,
                tokenLedgerCanisterId: Principal.fromText(ledger),
                thresholdAmount: BigInt(draftSettings.thresholdAmount || 0),
                maxDistributionAmount: BigInt(draftSettings.maxDistributionAmount || 0),
                targets: list.targets,
                sourcePurseId: draftSettings.sourcePurseId ? [draftSettings.sourcePurseId] : [],
                amountMode: BigInt(mode),
                balancePercent: mode === '1' ? [BigInt(Math.round(parseFloat(draftSettings.balancePercent || '100') * 100))] : [],
                minDistributionAmount: BigInt(draftSettings.minDistributionAmount || 0),
            });
            setSuccess('Settings saved.');
            setEditingSettings(null); setDraftSettings({});
            await loadLists();
        } catch (err) { setError('Failed to save settings: ' + err.message); }
        finally { setSaving(false); }
    };

    const saveTargets = async (listId) => {
        const list = lists.find(l => Number(l.id) === listId);
        if (!list) return;
        for (const d of draftTargets) {
            if (d.type === 'external' && !d.owner) { setError('All external targets must have a principal.'); return; }
            if (d.type === 'purse' && !d.choreInstanceId) { setError('All purse targets must have a chore selected.'); return; }
        }
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const ledger = typeof list.tokenLedgerCanisterId === 'string' ? list.tokenLedgerCanisterId : list.tokenLedgerCanisterId?.toText?.();
            await bot.updateDistributionList(instanceId, BigInt(listId), {
                name: list.name,
                tokenLedgerCanisterId: Principal.fromText(ledger),
                thresholdAmount: list.thresholdAmount,
                maxDistributionAmount: list.maxDistributionAmount,
                targets: draftTargets.map(draftToCandid),
                sourcePurseId: list.sourcePurseId || [],
                amountMode: list.amountMode ?? BigInt(0),
                balancePercent: list.balancePercent ?? [],
                minDistributionAmount: list.minDistributionAmount ?? BigInt(0),
            });
            setSuccess('Targets saved.');
            setEditingTargets(null); setDraftTargets([]);
            await loadLists();
        } catch (err) { setError('Failed to save targets: ' + err.message); }
        finally { setSaving(false); }
    };

    const addDraftTarget = (type) => {
        setDraftTargets([...draftTargets, {
            type,
            choreInstanceId: type === 'purse' ? (purseOptions[0]?.value || '') : '',
            owner: '', subaccount: null, basisPoints: '',
        }]);
    };

    const updateDraft = (idx, patch) => {
        setDraftTargets(draftTargets.map((d, i) => i === idx ? { ...d, ...patch } : d));
    };

    const removeDraft = (idx) => {
        setDraftTargets(draftTargets.filter((_, i) => i !== idx));
    };

    const distTokenIds = React.useMemo(() => {
        return lists.map(l => {
            const key = typeof l.tokenLedgerCanisterId === 'string' ? l.tokenLedgerCanisterId : l.tokenLedgerCanisterId?.toText?.() || String(l.tokenLedgerCanisterId);
            return key;
        });
    }, [lists]);
    const distTokenMeta = useTokenMetadata(distTokenIds, identity);
    const getDistTokenSymbol = (principal) => {
        const key = typeof principal === 'string' ? principal : principal?.toText?.() || String(principal);
        return distTokenMeta[key]?.symbol || shortPrincipal(key);
    };

    const lbl = { fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' };
    const tinyBtn = (extra) => ({ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px', ...extra });

    const renderTargetDisplay = (target) => {
        const cid = (Array.isArray(target.choreInstanceId) ? target.choreInstanceId[0] : target.choreInstanceId) || '';
        const bps = target.basisPoints?.length > 0 ? Number(target.basisPoints[0]) : null;
        const pctLabel = bps != null ? `${(bps / 100).toFixed(1)}%` : 'Auto-split';
        if (cid) {
            return (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.75rem' }}>
                    <span style={{ color: theme.colors.primaryText }}>
                        <FaWallet style={{ marginRight: '4px', fontSize: '0.65rem', opacity: 0.7 }} />
                        Purse: {choreLabel(cid)}
                    </span>
                    <span style={{ color: accentColor, fontWeight: '500' }}>{pctLabel}</span>
                </div>
            );
        }
        return (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.75rem' }}>
                <span style={{ color: theme.colors.primaryText, fontFamily: 'monospace' }}>
                    {shortPrincipal(target.account?.owner)}
                </span>
                <span style={{ color: accentColor, fontWeight: '500' }}>{pctLabel}</span>
            </div>
        );
    };

    const renderTargetEditor = (listId) => (
        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${theme.colors.border}` }}>
            {draftTargets.map((d, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px', padding: '6px 8px', background: `${theme.colors.secondaryBg}80`, borderRadius: '6px', flexWrap: 'wrap' }}>
                    <select value={d.type} onChange={e => updateDraft(idx, { type: e.target.value, choreInstanceId: e.target.value === 'purse' ? (purseOptions[0]?.value || '') : '', owner: '', subaccount: null })}
                        style={{ ...inputStyle, width: 'auto', minWidth: '90px', appearance: 'auto', fontSize: '0.78rem' }}>
                        <option value="purse">Purse</option>
                        <option value="external">External</option>
                    </select>
                    {d.type === 'purse' ? (
                        <select value={d.choreInstanceId} onChange={e => updateDraft(idx, { choreInstanceId: e.target.value })}
                            style={{ ...inputStyle, width: 'auto', minWidth: '160px', appearance: 'auto', fontSize: '0.78rem', flex: '1 1 160px' }}>
                            <option value="">Select chore purse...</option>
                            {purseOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    ) : (
                        <div style={{ flex: '1 1 240px' }}>
                            <PrincipalInput
                                value={d.owner}
                                onChange={(val) => updateDraft(idx, { owner: val })}
                                placeholder="Principal ID or ICRC-1 account..."
                                showSubaccountOption={true}
                                onAccountChange={({ principal, subaccount }) => {
                                    updateDraft(idx, { owner: principal, subaccount: subaccount || null });
                                }}
                                style={{ width: '100%' }}
                            />
                        </div>
                    )}
                    <input value={d.basisPoints} onChange={e => updateDraft(idx, { basisPoints: e.target.value })}
                        placeholder="%" title="Percentage (leave blank for auto-split)"
                        style={{ ...inputStyle, width: '60px', textAlign: 'center', fontSize: '0.78rem' }} />
                    <span style={{ fontSize: '0.7rem', color: theme.colors.mutedText }}>%</span>
                    <button onClick={() => removeDraft(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '4px' }}>
                        <FaTrash style={{ fontSize: '0.6rem' }} />
                    </button>
                </div>
            ))}
            <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                <button onClick={() => addDraftTarget('purse')} style={tinyBtn({ color: accentColor, borderColor: `${accentColor}60` })}>
                    <FaPlus style={{ marginRight: '3px', fontSize: '0.6rem' }} /> Purse Target
                </button>
                <button onClick={() => addDraftTarget('external')} style={tinyBtn({})}>
                    <FaPlus style={{ marginRight: '3px', fontSize: '0.6rem' }} /> External Target
                </button>
                <div style={{ flex: '1' }} />
                <button onClick={() => saveTargets(listId)} disabled={saving}
                    style={{ ...buttonStyle, fontSize: '0.7rem', padding: '3px 10px', background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`, color: '#fff', border: 'none', opacity: saving ? 0.6 : 1 }}>
                    <FaSave style={{ marginRight: '3px', fontSize: '0.6rem' }} /> Save Targets
                </button>
                <button onClick={cancelEditingTargets} style={tinyBtn({})}>Cancel</button>
            </div>
            {draftTargets.length > 0 && (() => {
                const totalBps = draftTargets.reduce((s, d) => s + (d.basisPoints ? Math.round(parseFloat(d.basisPoints) * 100) : 0), 0);
                const autoCount = draftTargets.filter(d => !d.basisPoints).length;
                return (
                    <div style={{ marginTop: '6px', fontSize: '0.7rem', color: theme.colors.mutedText }}>
                        Assigned: {(totalBps / 100).toFixed(1)}% &middot; Auto-split targets: {autoCount}
                        {totalBps > 10000 && <span style={{ color: '#ef4444', marginLeft: '8px' }}>Total exceeds 100%!</span>}
                    </div>
                );
            })()}
        </div>
    );

    return (
        <div style={cardStyle}>
            <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>Distribution Lists</h3>
            <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5' }}>
                Configure percentage-based distribution lists to automatically split and send funds to chore purses or external recipients.
            </p>

            {error && <div style={{ padding: '8px 12px', background: '#ef444415', border: '1px solid #ef444430', borderRadius: '8px', color: '#ef4444', fontSize: '0.8rem', marginBottom: '10px' }}>{error}</div>}
            {success && <div style={{ padding: '8px 12px', background: '#22c55e15', border: '1px solid #22c55e30', borderRadius: '8px', color: '#22c55e', fontSize: '0.8rem', marginBottom: '10px' }}>{success}</div>}

            {loading ? (
                <div style={{ textAlign: 'center', padding: '16px', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Loading distribution lists...</div>
            ) : (
                <>
                    {lists.length === 0 && !adding && (
                        <div style={{ textAlign: 'center', padding: '16px', color: theme.colors.mutedText, fontSize: '0.85rem', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                            No distribution lists configured yet.
                        </div>
                    )}

                    {lists.map((list) => {
                        const lid = Number(list.id);
                        const isExpanded = expandedList === lid;
                        const isEditing = editingTargets === lid;
                        const isEditingSet = editingSettings === lid;
                        return (
                            <div key={lid} style={{
                                padding: '12px', marginBottom: '8px',
                                background: theme.colors.primaryBg, borderRadius: '8px',
                                border: `1px solid ${theme.colors.border}`,
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                    <div>
                                        <span style={{ fontSize: '0.85rem', fontWeight: '600', color: theme.colors.primaryText }}>{list.name}</span>
                                        <span style={{ marginLeft: '8px', fontSize: '0.7rem', color: theme.colors.secondaryText }}>#{lid}</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                        <button onClick={() => { setExpandedList(isExpanded ? null : lid); if (isEditing) cancelEditingTargets(); if (isEditingSet) cancelEditingSettings(); }}
                                            style={tinyBtn({})}>
                                            {isExpanded ? 'Collapse' : 'Details'}
                                        </button>
                                        {!isEditing && !isEditingSet && (
                                            <>
                                                <button onClick={() => { setExpandedList(lid); startEditingSettings(list); }}
                                                    style={tinyBtn({ color: accentColor, borderColor: `${accentColor}60` })}>
                                                    <FaEdit style={{ fontSize: '0.6rem' }} /> Settings
                                                </button>
                                                <button onClick={() => { setExpandedList(lid); startEditingTargets(list); }}
                                                    style={tinyBtn({ color: accentColor, borderColor: `${accentColor}60` })}>
                                                    <FaEdit style={{ fontSize: '0.6rem' }} /> Targets
                                                </button>
                                            </>
                                        )}
                                        <button onClick={() => handleRemove(lid)} disabled={saving}
                                            style={tinyBtn({ color: '#ef4444', borderColor: '#ef444440' })}>
                                            <FaTrash style={{ fontSize: '0.6rem' }} />
                                        </button>
                                    </div>
                                </div>
                                <div style={{ marginTop: '6px', fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                                    <span>Token: {getDistTokenSymbol(list.tokenLedgerCanisterId)}</span>
                                    <span>From: {resolveSourceLabel(list)}</span>
                                    <span>Threshold: {Number(list.thresholdAmount).toLocaleString()}</span>
                                    {Number(list.amountMode ?? 0) === 1
                                        ? <span>Amount: {list.balancePercent?.[0] != null ? (Number(list.balancePercent[0]) / 100).toFixed(1) : '100'}% of balance (max {Number(list.maxDistributionAmount).toLocaleString()})</span>
                                        : <span>Amount: {Number(list.minDistributionAmount ?? 0).toLocaleString()} – {Number(list.maxDistributionAmount).toLocaleString()} (random)</span>}
                                    <span>Targets: {list.targets.length}</span>
                                </div>
                                {isExpanded && !isEditing && list.targets.length > 0 && (
                                    <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${theme.colors.border}` }}>
                                        {list.targets.map((target, i) => (
                                            <React.Fragment key={i}>{renderTargetDisplay(target)}</React.Fragment>
                                        ))}
                                    </div>
                                )}
                                {isExpanded && !isEditing && list.targets.length === 0 && (
                                    <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${theme.colors.border}`, fontSize: '0.75rem', color: theme.colors.mutedText }}>
                                        No targets configured. Click "Targets" to add some.
                                    </div>
                                )}
                                {isEditing && renderTargetEditor(lid)}
                                {isEditingSet && (
                                    <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${theme.colors.border}` }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' }}>
                                            <div>
                                                <label style={lbl}>Source Purse</label>
                                                <select value={draftSettings.sourcePurseId || ''} onChange={e => setDraftSettings(s => ({ ...s, sourcePurseId: e.target.value }))}
                                                    style={{ ...inputStyle, width: '100%', appearance: 'auto' }}>
                                                    <option value="">Main Purse</option>
                                                    {purseOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label style={lbl}>Threshold Amount</label>
                                                <input value={draftSettings.thresholdAmount || ''} onChange={e => setDraftSettings(s => ({ ...s, thresholdAmount: e.target.value }))}
                                                    style={{ ...inputStyle, width: '100%' }} type="text" inputMode="numeric" />
                                            </div>
                                        </div>
                                        <div style={{ marginTop: '8px' }}>
                                            <label style={lbl}>Amount Mode</label>
                                            <div style={{ display: 'flex', gap: '0', borderRadius: '6px', overflow: 'hidden', border: `1px solid ${theme.colors.border}`, width: 'fit-content' }}>
                                                {[{ value: '0', label: 'Random in Range' }, { value: '1', label: '% of Balance' }].map(opt => (
                                                    <button key={opt.value} type="button" onClick={() => setDraftSettings(s => ({ ...s, amountMode: opt.value }))}
                                                        style={{
                                                            padding: '5px 14px', fontSize: '0.78rem', border: 'none', cursor: 'pointer',
                                                            background: (draftSettings.amountMode || '0') === opt.value ? accentColor : 'transparent',
                                                            color: (draftSettings.amountMode || '0') === opt.value ? '#fff' : theme.colors.secondaryText,
                                                            fontWeight: (draftSettings.amountMode || '0') === opt.value ? 600 : 400,
                                                            transition: 'all 0.15s',
                                                        }}>
                                                        {opt.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px', marginTop: '8px' }}>
                                            {draftSettings.amountMode === '1' && (
                                                <div>
                                                    <label style={lbl}>Balance %</label>
                                                    <input value={draftSettings.balancePercent || ''} onChange={e => setDraftSettings(s => ({ ...s, balancePercent: e.target.value }))}
                                                        style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="e.g. 50" />
                                                </div>
                                            )}
                                            {draftSettings.amountMode !== '1' && (
                                                <div>
                                                    <label style={lbl}>Min Amount</label>
                                                    <input value={draftSettings.minDistributionAmount || ''} onChange={e => setDraftSettings(s => ({ ...s, minDistributionAmount: e.target.value }))}
                                                        style={{ ...inputStyle, width: '100%' }} type="text" inputMode="numeric" />
                                                </div>
                                            )}
                                            <div>
                                                <label style={lbl}>{draftSettings.amountMode === '1' ? 'Max Amount (cap)' : 'Max Amount'}</label>
                                                <input value={draftSettings.maxDistributionAmount || ''} onChange={e => setDraftSettings(s => ({ ...s, maxDistributionAmount: e.target.value }))}
                                                    style={{ ...inputStyle, width: '100%' }} type="text" inputMode="numeric" />
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                                            <button onClick={() => saveSettings(lid)} disabled={saving}
                                                style={{ ...buttonStyle, fontSize: '0.7rem', padding: '3px 10px', background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`, color: '#fff', border: 'none', opacity: saving ? 0.6 : 1 }}>
                                                <FaSave style={{ marginRight: '3px', fontSize: '0.6rem' }} /> Save Settings
                                            </button>
                                            <button onClick={cancelEditingSettings} style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 10px' }}>Cancel</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {adding ? (
                        <div style={{ padding: '14px', background: `${accentColor}06`, borderRadius: '8px', border: `1px solid ${accentColor}20`, marginTop: '10px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                                <div>
                                    <label style={lbl}>Name</label>
                                    <input value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, width: '100%' }} placeholder="e.g. Revenue Share" />
                                </div>
                                <div>
                                    <label style={lbl}>Token Ledger</label>
                                    <TokenSelector
                                        value={newLedger}
                                        onChange={setNewLedger}
                                        onSelectToken={cacheTokenMeta}
                                        allowCustom={true}
                                        placeholder="Select token..."
                                    />
                                </div>
                                <div>
                                    <label style={lbl}>Source Purse</label>
                                    <select value={newSourcePurse} onChange={(e) => setNewSourcePurse(e.target.value)} style={{ ...inputStyle, width: '100%', appearance: 'auto' }}>
                                        <option value="">Main Purse</option>
                                        {purseOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={lbl}>Threshold Amount</label>
                                    <input value={newThreshold} onChange={(e) => setNewThreshold(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="numeric" />
                                </div>
                            </div>
                            <div style={{ marginTop: '8px' }}>
                                <label style={lbl}>Amount Mode</label>
                                <div style={{ display: 'flex', gap: '0', borderRadius: '6px', overflow: 'hidden', border: `1px solid ${theme.colors.border}`, width: 'fit-content' }}>
                                    {[{ value: '0', label: 'Random in Range' }, { value: '1', label: '% of Balance' }].map(opt => (
                                        <button key={opt.value} type="button" onClick={() => setNewAmountMode(opt.value)}
                                            style={{
                                                padding: '5px 14px', fontSize: '0.78rem', border: 'none', cursor: 'pointer',
                                                background: newAmountMode === opt.value ? accentColor : 'transparent',
                                                color: newAmountMode === opt.value ? '#fff' : theme.colors.secondaryText,
                                                fontWeight: newAmountMode === opt.value ? 600 : 400,
                                                transition: 'all 0.15s',
                                            }}>
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px', marginTop: '8px' }}>
                                {newAmountMode === '1' && (
                                    <div>
                                        <label style={lbl}>Balance %</label>
                                        <input value={newBalancePct} onChange={(e) => setNewBalancePct(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="e.g. 50" />
                                    </div>
                                )}
                                {newAmountMode !== '1' && (
                                    <div>
                                        <label style={lbl}>Min Amount</label>
                                        <input value={newMinDist} onChange={(e) => setNewMinDist(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="numeric" />
                                    </div>
                                )}
                                <div>
                                    <label style={lbl}>{newAmountMode === '1' ? 'Max Amount (cap)' : 'Max Amount'}</label>
                                    <input value={newMaxDist} onChange={(e) => setNewMaxDist(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="numeric" />
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                                <button onClick={handleAdd} disabled={saving} style={{ ...buttonStyle, background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`, color: '#fff', border: 'none', opacity: saving ? 0.6 : 1 }}>
                                    <FaPlus style={{ marginRight: '4px', fontSize: '0.7rem' }} /> Add List
                                </button>
                                <button onClick={() => setAdding(false)} style={{ ...secondaryButtonStyle }}>Cancel</button>
                            </div>
                        </div>
                    ) : (
                        <button onClick={() => { setAdding(true); setError(''); setSuccess(''); }} style={{ ...secondaryButtonStyle, marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <FaPlus style={{ fontSize: '0.7rem' }} /> Add Distribution List
                        </button>
                    )}
                </>
            )}
        </div>
    );
}

// ============================================
// ACTION_TYPE_LABELS lookup for trade log
// ============================================
const TRADE_STATUS_LABELS = { Success: 'Success', Failed: 'Failed', Skipped: 'Skipped' };
const TRADE_STATUS_COLORS = { Success: '#22c55e', Failed: '#ef4444', Skipped: '#f59e0b' };
const DEX_LABELS = { 0: 'ICPSwap', 1: 'KongSwap' };

// ============================================
// Trade Log Viewer
// ============================================
function TradeLogViewer({ getReadyBotActor, theme, accentColor }) {
    const { identity } = useAuth();
    const PAGE_SIZE = 50;
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [stats, setStats] = useState(null);
    const [totalCount, setTotalCount] = useState(0);
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [filterStatus, setFilterStatus] = useState('');
    const [filterChoreType, setFilterChoreType] = useState('');
    // Snapshots indexed by tradeLogId: { before: snap|null, after: snap|null }
    const [snapMap, setSnapMap] = useState({});
    // Track which trade log entries have their snapshot section expanded
    const [expandedSnaps, setExpandedSnaps] = useState(new Set());

    // Collect token IDs from entries for metadata resolution
    const entryTokenIds = React.useMemo(() => {
        const ids = new Set();
        for (const e of entries) {
            ids.add(typeof e.inputToken === 'string' ? e.inputToken : e.inputToken?.toText?.() || String(e.inputToken));
            if (e.outputToken?.length > 0) {
                ids.add(typeof e.outputToken[0] === 'string' ? e.outputToken[0] : e.outputToken[0]?.toText?.() || String(e.outputToken[0]));
            }
        }
        return [...ids];
    }, [entries]);
    const tokenMeta = useTokenMetadata(entryTokenIds, identity);

    const toStr = (p) => typeof p === 'string' ? p : p?.toText?.() || String(p);
    const getSym = (p) => {
        const key = toStr(p);
        return tokenMeta[key]?.symbol || shortPrincipal(key);
    };
    const getDec = (p) => {
        const key = toStr(p);
        return tokenMeta[key]?.decimals ?? 8;
    };

    const filterStatusRef = React.useRef(filterStatus);
    const filterChoreTypeRef = React.useRef(filterChoreType);
    filterStatusRef.current = filterStatus;
    filterChoreTypeRef.current = filterChoreType;

    // Load trade entries + batch-fetch all related snapshots
    const loadData = useCallback(async (pg) => {
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const q = {
                startId: [], limit: [PAGE_SIZE], offset: [(pg ?? 0) * PAGE_SIZE],
                choreId: [], choreTypeId: filterChoreTypeRef.current ? [filterChoreTypeRef.current] : [],
                actionType: [], inputToken: [], outputToken: [],
                status: filterStatusRef.current ? [{ [filterStatusRef.current]: null }] : [],
                fromTime: [], toTime: [],
            };
            const [result, st] = await Promise.all([
                bot.getTradeLog(q),
                bot.getTradeLogStats(),
            ]);
            setEntries(result.entries);
            setHasMore(result.hasMore);
            setTotalCount(Number(result.totalCount));
            setStats(st);

            // Batch-fetch snapshots in the time range of visible entries
            if (result.entries.length > 0) {
                const timestamps = result.entries.map(e => BigInt(e.timestamp));
                const minTs = timestamps.reduce((a, b) => a < b ? a : b);
                const maxTs = timestamps.reduce((a, b) => a > b ? a : b);
                const pad = BigInt(300_000_000_000); // 5 min padding
                try {
                    const snapResult = await bot.getPortfolioSnapshots({
                        startId: [], limit: [200], tradeLogId: [],
                        phase: [], fromTime: [minTs - pad], toTime: [maxTs + pad],
                    });
                    // Index snapshots: after-snaps link by tradeLogId, before-snaps matched by proximity
                    const newMap = {};
                    const afterSnaps = [];
                    const beforeSnaps = [];
                    for (const snap of snapResult.entries) {
                        const phaseKey = Object.keys(snap.phase || {})[0] || '';
                        if (phaseKey === 'After') afterSnaps.push(snap);
                        else if (phaseKey === 'Before') beforeSnaps.push(snap);
                    }
                    // Index after-snapshots by tradeLogId
                    for (const snap of afterSnaps) {
                        const tlid = snap.tradeLogId?.length > 0 ? Number(snap.tradeLogId[0]) : null;
                        if (tlid != null) {
                            if (!newMap[tlid]) newMap[tlid] = { before: null, after: null };
                            newMap[tlid].after = snap;
                        }
                    }
                    // For each trade entry, find the closest Before snapshot (same choreId, just before the trade)
                    for (const entry of result.entries) {
                        const eid = Number(entry.id);
                        const eChore = entry.choreId?.length > 0 ? (typeof entry.choreId[0] === 'string' ? entry.choreId[0] : entry.choreId[0]?.toText?.() || '') : '';
                        const eTs = Number(entry.timestamp);
                        if (!newMap[eid]) newMap[eid] = { before: null, after: null };
                        // Find closest Before with same choreId before this trade's timestamp
                        let bestBefore = null;
                        let bestDist = Infinity;
                        for (const snap of beforeSnaps) {
                            const sChore = snap.choreId?.length > 0 ? (typeof snap.choreId[0] === 'string' ? snap.choreId[0] : snap.choreId[0]?.toText?.() || '') : '';
                            const sTs = Number(snap.timestamp);
                            if (sChore === eChore && sTs <= eTs) {
                                const dist = eTs - sTs;
                                if (dist < bestDist) { bestDist = dist; bestBefore = snap; }
                            }
                        }
                        newMap[eid].before = bestBefore;
                    }
                    setSnapMap(newMap);
                } catch (snapErr) {
                    console.error('Failed to load snapshots:', snapErr);
                }
            }
        } catch (err) {
            setError('Failed to load trade log: ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [getReadyBotActor]);

    useEffect(() => { loadData(0); }, [loadData]);

    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

    const goToPage = (pg) => {
        const clamped = Math.max(0, Math.min(pg, totalPages - 1));
        setPage(clamped);
        setLoading(true);
        setSnapMap({});
        loadData(clamped);
    };

    const applyFilters = () => {
        setPage(0);
        setLoading(true);
        setSnapMap({});
        loadData(0);
    };

    const cardStyle = {
        background: theme.colors.cardGradient,
        borderRadius: '12px',
        border: `1px solid ${theme.colors.border}`,
        padding: '16px',
    };
    const inputStyle = {
        background: theme.colors.inputBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '8px',
        padding: '6px 10px',
        color: theme.colors.primaryText,
        fontSize: '0.8rem',
    };

    const optVal = (arr) => arr?.length > 0 ? arr[0] : null;

    // Render inline snapshot balance changes for a trade entry (collapsible)
    const renderBalanceChanges = (tradeId) => {
        const snaps = snapMap[tradeId];
        if (!snaps || (!snaps.before && !snaps.after)) return null;
        const { before, after } = snaps;

        // Build merged token list
        const tokenMap = new Map();
        const addTokens = (snap, key) => {
            if (!snap?.tokens) return;
            for (const t of snap.tokens) {
                const tid = typeof t.token === 'string' ? t.token : t.token?.toText?.() || String(t.token);
                if (!tokenMap.has(tid)) {
                    const sym = _isPlaceholderSymbol(t.symbol) ? (getTokenMetadataSync(tid)?.symbol || t.symbol) : t.symbol;
                    tokenMap.set(tid, { symbol: sym, decimals: Number(t.decimals) });
                }
                tokenMap.get(tid)[key] = t;
            }
        };
        addTokens(before, 'before');
        addTokens(after, 'after');

        const rows = [...tokenMap.entries()];
        if (rows.length === 0) return null;

        const isExpanded = expandedSnaps.has(tradeId);
        const toggleExpand = () => {
            setExpandedSnaps(prev => {
                const next = new Set(prev);
                if (next.has(tradeId)) next.delete(tradeId);
                else next.add(tradeId);
                return next;
            });
        };

        return (
            <div style={{ marginTop: '6px' }}>
                <button
                    onClick={toggleExpand}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.7rem', color: accentColor, padding: '2px 0', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                    {isExpanded ? '▾' : '▸'} Balance Snapshots
                </button>
                {isExpanded && (
                    <div style={{ marginTop: '4px', padding: '8px 10px', background: theme.colors.cardGradient, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                            <thead>
                                <tr style={{ color: theme.colors.mutedText, textAlign: 'left' }}>
                                    <th style={{ padding: '2px 6px' }}>Token</th>
                                    <th style={{ padding: '2px 6px', textAlign: 'right' }}>Before</th>
                                    <th style={{ padding: '2px 6px', textAlign: 'right' }}>After</th>
                                    <th style={{ padding: '2px 6px', textAlign: 'right' }}>Change</th>
                                    <th style={{ padding: '2px 6px', textAlign: 'right' }}>USD Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(([tid, info]) => {
                                    const dec = info.decimals;
                                    const scale = 10 ** dec;
                                    const bBal = info.before?.balance != null ? Number(info.before.balance) : null;
                                    const aBal = info.after?.balance != null ? Number(info.after.balance) : null;
                                    const diff = (bBal != null && aBal != null) ? aBal - bBal : null;
                                    const diffColor = diff > 0 ? '#22c55e' : diff < 0 ? '#ef4444' : theme.colors.secondaryText;
                                    const diffPrefix = diff > 0 ? '+' : '';
                                    const snapForPrice = info.after || info.before;
                                    const usdPriceE8s = snapForPrice?.priceUsdE8s?.length > 0 ? Number(snapForPrice.priceUsdE8s[0]) : (snapForPrice?.priceUsdE8s != null && typeof snapForPrice.priceUsdE8s !== 'object' ? Number(snapForPrice.priceUsdE8s) : null);
                                    let usdChange = null;
                                    if (diff != null && usdPriceE8s != null && usdPriceE8s > 0) {
                                        usdChange = (diff / scale) * (usdPriceE8s / scale);
                                    }
                                    return (
                                        <tr key={tid} style={{ borderTop: `1px solid ${theme.colors.border}20` }}>
                                            <td style={{ padding: '3px 6px', color: theme.colors.primaryText, fontWeight: '500' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <TokenIcon canisterId={tid} size={14} />
                                                    {info.symbol}
                                                </div>
                                            </td>
                                            <td style={{ padding: '3px 6px', textAlign: 'right', color: theme.colors.secondaryText, fontFamily: 'monospace', fontSize: '0.7rem' }}>
                                                {bBal != null ? formatTokenAmount(bBal, dec) : '—'}
                                            </td>
                                            <td style={{ padding: '3px 6px', textAlign: 'right', color: theme.colors.secondaryText, fontFamily: 'monospace', fontSize: '0.7rem' }}>
                                                {aBal != null ? formatTokenAmount(aBal, dec) : '—'}
                                            </td>
                                            <td style={{ padding: '3px 6px', textAlign: 'right', color: diffColor, fontWeight: '600', fontFamily: 'monospace', fontSize: '0.7rem' }}>
                                                {diff != null ? `${diffPrefix}${formatTokenAmount(Math.abs(diff), dec)}` : '—'}
                                            </td>
                                            <td style={{ padding: '3px 6px', textAlign: 'right', color: usdChange != null ? (usdChange >= 0 ? '#22c55e' : '#ef4444') : theme.colors.mutedText, fontSize: '0.7rem' }}>
                                                {usdChange != null ? `${usdChange >= 0 ? '+' : ''}$${Math.abs(usdChange).toFixed(2)}` : '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '0.95rem', fontWeight: '600' }}>Trade Log</h3>
                    <button
                        onClick={() => { setLoading(true); setSnapMap({}); loadData(page); }}
                        disabled={loading}
                        title="Refresh"
                        style={{ background: 'none', border: 'none', cursor: loading ? 'default' : 'pointer', color: accentColor, padding: '2px', display: 'flex', alignItems: 'center', opacity: loading ? 0.5 : 1 }}
                    >
                        <FaSyncAlt style={{ fontSize: '0.75rem', animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                    </button>
                    <CopyToClipboardButton
                        accentColor={accentColor} theme={theme} label="Copy"
                        getText={() => {
                            if (!entries.length) return '# Trade Log (empty)\n';
                            const lines = [`# Trade Log (${entries.length} entries, page ${page + 1})`];
                            const ACTION_NAMES = { 0: 'trade', 1: 'fund_purse', 2: 'reclaim', 3: 'send' };
                            const fmtAmt = (raw, dec) => { const d = Number(dec || 8); const r = BigInt(raw); const w = r / BigInt(10**d); const f = r % BigInt(10**d); return f === 0n ? `${w}` : `${w}.${f.toString().padStart(d,'0').replace(/0+$/,'')}`; };
                            const fmtTs = (ns) => { try { return new Date(Number(BigInt(ns)/1_000_000n)).toISOString(); } catch(_) { return '?'; } };
                            for (const e of entries) {
                                const st = Object.keys(e.status||{})[0]||'?';
                                const iSym = getSym(e.inputToken); const oSym = optVal(e.outputToken) ? getSym(optVal(e.outputToken)) : '';
                                const pair = oSym ? `${iSym} -> ${oSym}` : iSym;
                                const inAmt = `${fmtAmt(e.inputAmount, getDec(e.inputToken))} ${iSym}`;
                                let detail = inAmt;
                                if (st === 'Success' && optVal(e.outputAmount) && oSym) detail += ` -> ${fmtAmt(optVal(e.outputAmount), getDec(optVal(e.outputToken)))} ${oSym}`;
                                else if (st === 'Failed') detail += ` | ${optVal(e.errorMessage)||'?'}`;
                                const chore = optVal(e.choreId)||'-';
                                lines.push(`#${e.id} | ${fmtTs(e.timestamp)} | ${ACTION_NAMES[Number(e.actionType)]||e.actionType} | ${pair} | ${st}: ${detail} | chore: ${chore}`);
                            }
                            return lines.join('\n') + '\n';
                        }}
                    />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {stats && <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>{totalCount} entries</span>}
                    {totalCount > PAGE_SIZE && (
                        <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>Page {page + 1} of {totalPages}</span>
                    )}
                </div>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ ...inputStyle, appearance: 'auto', minWidth: '100px' }}>
                    <option value="">All statuses</option>
                    <option value="Success">Success</option>
                    <option value="Failed">Failed</option>
                    <option value="Skipped">Skipped</option>
                </select>
                <select value={filterChoreType} onChange={(e) => setFilterChoreType(e.target.value)} style={{ ...inputStyle, appearance: 'auto', minWidth: '120px' }}>
                    <option value="">All chore types</option>
                    <option value="trade">Trade</option>
                    <option value="rebalance">Rebalance</option>
                    <option value="move-funds">Move Funds</option>
                    <option value="distribute-funds">Distribute</option>
                </select>
                <button onClick={applyFilters} style={{ ...inputStyle, cursor: 'pointer', background: `${accentColor}15`, border: `1px solid ${accentColor}30`, color: accentColor, fontWeight: '500' }}>Filter</button>
            </div>

            {error && <div style={{ padding: '8px 12px', background: '#ef444415', border: '1px solid #ef444430', borderRadius: '8px', color: '#ef4444', fontSize: '0.8rem', marginBottom: '10px' }}>{error}</div>}

            {loading ? (
                <div style={{ textAlign: 'center', padding: '20px', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Loading trade log...</div>
            ) : entries.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: theme.colors.mutedText, fontSize: '0.85rem', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                    No trade log entries yet. Entries are recorded when chores execute trades.
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {entries.map((e) => {
                        const statusKey = Object.keys(e.status || {})[0] || 'Failed';
                        const inputDec = getDec(e.inputToken);
                        const outputDec = e.outputToken?.length > 0 ? getDec(e.outputToken[0]) : 8;
                        const isSwap = Number(e.actionType) === 0;
                        const isInflow = Number(e.actionType) === ACTION_TYPE_DETECTED_INFLOW;
                        const isOutflow = Number(e.actionType) === ACTION_TYPE_DETECTED_OUTFLOW;
                        const isReconciliation = isInflow || isOutflow;
                        // Format price as human-readable input/output (e.g., ICP per SNEED)
                        const priceE8s = optVal(e.priceE8s);
                        const nativePrice = priceE8s != null && outputDec != null ? (Number(priceE8s) / (10 ** outputDec)) : null;
                        const humanPrice = nativePrice != null && nativePrice > 0 ? (1 / nativePrice) : null;
                        const outSym = e.outputToken?.length > 0 ? getSym(e.outputToken[0]) : '';
                        const inSym = getSym(e.inputToken);
                        return (
                            <div key={Number(e.id)} style={{
                                padding: '10px 12px', background: isInflow ? '#22c55e08' : isOutflow ? '#f9731608' : theme.colors.primaryBg, borderRadius: '8px',
                                border: `1px solid ${isInflow ? '#22c55e30' : isOutflow ? '#f9731630' : theme.colors.border}`, fontSize: '0.78rem',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '4px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontWeight: '600', color: theme.colors.primaryText }}>#{Number(e.id)}</span>
                                        {isReconciliation ? (
                                            <span style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600',
                                                background: isInflow ? '#22c55e20' : '#f9731620',
                                                color: isInflow ? '#22c55e' : '#f97316',
                                            }}>{isInflow ? 'Inflow Detected' : 'Outflow Detected'}</span>
                                        ) : (
                                            <span style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600',
                                                background: (TRADE_STATUS_COLORS[statusKey] || '#6b7280') + '20',
                                                color: TRADE_STATUS_COLORS[statusKey] || '#6b7280',
                                            }}>{TRADE_STATUS_LABELS[statusKey] || statusKey}</span>
                                        )}
                                        <span style={{ color: theme.colors.mutedText }}>{ACTION_TYPE_LABELS[Number(e.actionType)] || `Type ${Number(e.actionType)}`}</span>
                                    </div>
                                    <span style={{ color: theme.colors.mutedText, fontSize: '0.7rem' }}>{new Date(Number(e.timestamp) / 1_000_000).toLocaleString()}</span>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '4px', color: theme.colors.secondaryText }}>
                                    {isReconciliation ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: isInflow ? '#22c55e' : '#f97316', fontWeight: '500' }}>
                                            <strong>{isInflow ? '+' : '-'}</strong> <TokenIcon canisterId={toStr(e.inputToken)} size={16} /> {formatTokenAmount(e.inputAmount, inputDec)} {inSym}
                                        </div>
                                    ) : (() => {
                                        const at = Number(e.actionType);
                                        const inLabel = at === ACTION_TYPE_DEPOSIT ? 'Funded:' : at === ACTION_TYPE_WITHDRAW ? 'Reclaimed:' : at === ACTION_TYPE_SEND ? 'Sent:' : 'Sold:';
                                        const outLabel = at === ACTION_TYPE_DEPOSIT ? 'To Purse:' : at === ACTION_TYPE_WITHDRAW ? 'To Main:' : at === ACTION_TYPE_SEND ? 'To:' : 'Bought:';
                                        return (
                                            <>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <strong>{inLabel}</strong> <TokenIcon canisterId={toStr(e.inputToken)} size={16} /> {formatTokenAmount(e.inputAmount, inputDec)} {inSym}
                                                </div>
                                                {e.outputToken?.length > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <strong>{outLabel}</strong> <TokenIcon canisterId={toStr(e.outputToken[0])} size={16} /> {optVal(e.outputAmount) != null ? formatTokenAmount(optVal(e.outputAmount), outputDec) : '—'} {outSym}
                                                </div>}
                                            </>
                                        );
                                    })()}
                                    {humanPrice != null && <div><strong>Price:</strong> {humanPrice.toLocaleString(undefined, { maximumSignificantDigits: 6 })} {inSym}/{outSym}</div>}
                                    {optVal(e.dexId) != null && <div><strong>DEX:</strong> {DEX_LABELS[Number(optVal(e.dexId))] || `DEX ${Number(optVal(e.dexId))}`}</div>}
                                    {optVal(e.priceImpactBps) != null && <div><strong>Impact:</strong> {(Number(optVal(e.priceImpactBps)) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%</div>}
                                    {optVal(e.choreId) && <div><strong>Chore:</strong> {optVal(e.choreId)}</div>}
                                    {optVal(e.actionId) != null && <div><strong>Action:</strong> #{Number(optVal(e.actionId))}</div>}
                                    {optVal(e.errorMessage) && <div style={{ color: '#ef4444', gridColumn: '1 / -1' }}><strong>Error:</strong> {optVal(e.errorMessage)}</div>}
                                </div>
                                {isSwap && renderBalanceChanges(Number(e.id))}
                            </div>
                        );
                    })}
                    {totalCount > PAGE_SIZE && (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                            <button onClick={() => goToPage(0)} disabled={page === 0 || loading}
                                style={{ ...inputStyle, cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.4 : 1, padding: '5px 10px' }}>First</button>
                            <button onClick={() => goToPage(page - 1)} disabled={page === 0 || loading}
                                style={{ ...inputStyle, cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.4 : 1, padding: '5px 10px' }}>Prev</button>
                            <span style={{ fontSize: '0.8rem', color: theme.colors.primaryText, fontWeight: '500', minWidth: '80px', textAlign: 'center' }}>
                                {page + 1} / {totalPages}
                            </span>
                            <button onClick={() => goToPage(page + 1)} disabled={!hasMore || loading}
                                style={{ ...inputStyle, cursor: !hasMore ? 'default' : 'pointer', opacity: !hasMore ? 0.4 : 1, padding: '5px 10px' }}>Next</button>
                            <button onClick={() => goToPage(totalPages - 1)} disabled={!hasMore || loading}
                                style={{ ...inputStyle, cursor: !hasMore ? 'default' : 'pointer', opacity: !hasMore ? 0.4 : 1, padding: '5px 10px' }}>Last</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ============================================
// Portfolio Snapshot Viewer
// ============================================
function PortfolioSnapshotViewer({ getReadyBotActor, theme, accentColor }) {
    const [snapshots, setSnapshots] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [stats, setStats] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [expandedKey, setExpandedKey] = useState(null);

    const loadData = useCallback(async () => {
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const [result, st] = await Promise.all([
                bot.getPortfolioSnapshots({ startId: [], limit: [100], tradeLogId: [], phase: [], fromTime: [], toTime: [] }),
                bot.getPortfolioSnapshotStats(),
            ]);
            setSnapshots(result.entries);
            setHasMore(result.hasMore);
            setStats(st);
        } catch (err) {
            setError('Failed to load portfolio snapshots: ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [getReadyBotActor]);

    useEffect(() => { loadData(); }, [loadData]);

    const optVal = (arr) => arr?.length > 0 ? arr[0] : null;
    const getPhase = (snap) => Object.keys(snap.phase || {})[0] || '';
    const getChoreId = (snap) => {
        const c = snap.choreId?.length > 0 ? snap.choreId[0] : null;
        return c ? (typeof c === 'string' ? c : c?.toText?.() || String(c)) : '';
    };

    // Group snapshots into paired (before+after) and unpaired items.
    // Matching: same choreId, trigger text shares the same "Trade N" prefix, Before timestamp < After timestamp.
    const pairedItems = React.useMemo(() => {
        const items = [];
        const used = new Set();

        // Extract the action key from trigger (e.g., "Trade 0 pre-swap" → "Trade 0")
        const actionKey = (trigger) => {
            const m = (trigger || '').match(/^(Trade \d+)/);
            return m ? m[1] : null;
        };

        // Index After snapshots by choreId + actionKey for quick lookup
        const afterIndex = new Map();
        for (const snap of snapshots) {
            if (getPhase(snap) === 'After') {
                const key = getChoreId(snap) + '|' + actionKey(snap.trigger);
                if (!afterIndex.has(key)) afterIndex.set(key, []);
                afterIndex.get(key).push(snap);
            }
        }

        // Walk through Before snapshots and find matching After
        for (const snap of snapshots) {
            if (getPhase(snap) !== 'Before') continue;
            const key = getChoreId(snap) + '|' + actionKey(snap.trigger);
            const afters = afterIndex.get(key);
            if (afters) {
                // Find closest After with timestamp > this Before's timestamp
                let bestAfter = null;
                let bestDist = Infinity;
                for (const a of afters) {
                    if (used.has(Number(a.id))) continue;
                    const dist = Number(a.timestamp) - Number(snap.timestamp);
                    if (dist > 0 && dist < bestDist) { bestDist = dist; bestAfter = a; }
                }
                if (bestAfter) {
                    items.push({ type: 'pair', before: snap, after: bestAfter, key: `pair-${Number(snap.id)}` });
                    used.add(Number(snap.id));
                    used.add(Number(bestAfter.id));
                }
            }
        }

        // Add any unmatched snapshots as singles
        for (const snap of snapshots) {
            if (!used.has(Number(snap.id))) {
                items.push({ type: 'single', snap, key: `single-${Number(snap.id)}` });
                used.add(Number(snap.id));
            }
        }

        // Sort by timestamp descending (newest first), using the Before timestamp for pairs
        items.sort((a, b) => {
            const tsA = a.type === 'pair' ? Number(a.before.timestamp) : Number(a.snap.timestamp);
            const tsB = b.type === 'pair' ? Number(b.before.timestamp) : Number(b.snap.timestamp);
            return tsB - tsA;
        });

        return items;
    }, [snapshots]);

    const cardStyle = {
        background: theme.colors.cardGradient,
        borderRadius: '12px',
        border: `1px solid ${theme.colors.border}`,
        padding: '16px',
    };

    const renderPairedItem = (before, after, itemKey) => {
        const isExpanded = expandedKey === itemKey;
        const trigger = (before?.trigger || after?.trigger || '').replace(/ pre-swap| post-swap/, '');
        const ts = new Date(Number((before || after).timestamp) / 1_000_000).toLocaleString();
        // Merge tokens from both snapshots
        const tokenMap = new Map();
        const addTokens = (snap, phase) => {
            if (!snap?.tokens) return;
            for (const t of snap.tokens) {
                const tid = typeof t.token === 'string' ? t.token : t.token?.toText?.() || String(t.token);
                if (!tokenMap.has(tid)) {
                    const sym = _isPlaceholderSymbol(t.symbol) ? (getTokenMetadataSync(tid)?.symbol || t.symbol) : t.symbol;
                    tokenMap.set(tid, { symbol: sym, decimals: Number(t.decimals) });
                }
                tokenMap.get(tid)[phase] = t;
            }
        };
        addTokens(before, 'before');
        addTokens(after, 'after');

        const rows = [...tokenMap.entries()];

        return (
            <div key={itemKey} style={{
                padding: '10px 12px', background: theme.colors.primaryBg, borderRadius: '8px',
                border: `1px solid ${isExpanded ? accentColor + '30' : theme.colors.border}`, fontSize: '0.78rem',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                    onClick={() => setExpandedKey(isExpanded ? null : itemKey)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600',
                            background: `${accentColor}20`, color: accentColor,
                        }}>Before / After</span>
                        <span style={{ color: theme.colors.secondaryText }}>{trigger}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: theme.colors.mutedText, fontSize: '0.7rem' }}>{ts}</span>
                        <span style={{ color: theme.colors.mutedText }}>{isExpanded ? '▾' : '▸'}</span>
                    </div>
                </div>
                {isExpanded && rows.length > 0 && (
                    <div style={{ marginTop: '8px', borderTop: `1px solid ${theme.colors.border}`, paddingTop: '8px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                            <thead>
                                <tr style={{ color: theme.colors.mutedText, textAlign: 'left' }}>
                                    <th style={{ padding: '2px 6px' }}>Token</th>
                                    <th style={{ padding: '2px 6px', textAlign: 'right' }}>Before</th>
                                    <th style={{ padding: '2px 6px', textAlign: 'right' }}>After</th>
                                    <th style={{ padding: '2px 6px', textAlign: 'right' }}>Change</th>
                                    <th style={{ padding: '2px 6px', textAlign: 'right' }}>USD Change</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(([tid, info]) => {
                                    const dec = info.decimals;
                                    const scale = 10 ** dec;
                                    const bBal = info.before?.balance != null ? Number(info.before.balance) : null;
                                    const aBal = info.after?.balance != null ? Number(info.after.balance) : null;
                                    const diff = (bBal != null && aBal != null) ? aBal - bBal : null;
                                    const diffColor = diff > 0 ? '#22c55e' : diff < 0 ? '#ef4444' : theme.colors.secondaryText;
                                    const diffPrefix = diff > 0 ? '+' : '';
                                    const snapForPrice = info.after || info.before;
                                    const usdP = optVal(snapForPrice?.priceUsdE8s);
                                    const usdPNum = usdP != null ? Number(usdP) : null;
                                    let usdChange = null;
                                    if (diff != null && usdPNum != null && usdPNum > 0) {
                                        usdChange = (diff / scale) * (usdPNum / scale);
                                    }
                                    return (
                                        <tr key={tid} style={{ borderTop: `1px solid ${theme.colors.border}20` }}>
                                            <td style={{ padding: '3px 6px', color: theme.colors.primaryText, fontWeight: '500' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <TokenIcon canisterId={tid} size={14} />
                                                    {info.symbol}
                                                </div>
                                            </td>
                                            <td style={{ padding: '3px 6px', textAlign: 'right', color: theme.colors.secondaryText, fontFamily: 'monospace', fontSize: '0.7rem' }}>
                                                {bBal != null ? formatTokenAmount(bBal, dec) : '—'}
                                            </td>
                                            <td style={{ padding: '3px 6px', textAlign: 'right', color: theme.colors.secondaryText, fontFamily: 'monospace', fontSize: '0.7rem' }}>
                                                {aBal != null ? formatTokenAmount(aBal, dec) : '—'}
                                            </td>
                                            <td style={{ padding: '3px 6px', textAlign: 'right', color: diffColor, fontWeight: '600', fontFamily: 'monospace', fontSize: '0.7rem' }}>
                                                {diff != null ? `${diffPrefix}${formatTokenAmount(Math.abs(diff), dec)}` : '—'}
                                            </td>
                                            <td style={{ padding: '3px 6px', textAlign: 'right', color: usdChange != null ? (usdChange >= 0 ? '#22c55e' : '#ef4444') : theme.colors.mutedText, fontSize: '0.7rem' }}>
                                                {usdChange != null ? `${usdChange >= 0 ? '+' : ''}$${Math.abs(usdChange).toFixed(2)}` : '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    };

    const renderSingleItem = (snap, itemKey) => {
        const isExpanded = expandedKey === itemKey;
        const phaseKey = getPhase(snap);
        const ts = new Date(Number(snap.timestamp) / 1_000_000).toLocaleString();
        return (
            <div key={itemKey} style={{
                padding: '10px 12px', background: theme.colors.primaryBg, borderRadius: '8px',
                border: `1px solid ${theme.colors.border}`, fontSize: '0.78rem',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                    onClick={() => setExpandedKey(isExpanded ? null : itemKey)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: '600', color: theme.colors.primaryText }}>#{Number(snap.id)}</span>
                        <span style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600',
                            background: phaseKey === 'Before' ? '#3b82f620' : '#22c55e20',
                            color: phaseKey === 'Before' ? '#3b82f6' : '#22c55e',
                        }}>{phaseKey || 'Snapshot'}</span>
                        <span style={{ color: theme.colors.secondaryText }}>{snap.trigger}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: theme.colors.mutedText, fontSize: '0.7rem' }}>{ts}</span>
                        <span style={{ color: theme.colors.mutedText }}>{isExpanded ? '▾' : '▸'}</span>
                    </div>
                </div>
                {isExpanded && snap.tokens?.length > 0 && (
                    <div style={{ marginTop: '8px', borderTop: `1px solid ${theme.colors.border}`, paddingTop: '8px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                            <thead>
                                <tr style={{ color: theme.colors.mutedText, textAlign: 'left' }}>
                                    <th style={{ padding: '2px 6px' }}>Token</th>
                                    <th style={{ padding: '2px 6px', textAlign: 'right' }}>Balance</th>
                                    <th style={{ padding: '2px 6px', textAlign: 'right' }}>ICP Value</th>
                                    <th style={{ padding: '2px 6px', textAlign: 'right' }}>USD Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {snap.tokens.map((tok, i) => (
                                    <tr key={i} style={{ color: theme.colors.secondaryText, borderTop: `1px solid ${theme.colors.border}10` }}>
                                        <td style={{ padding: '3px 6px', fontWeight: '500' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <TokenIcon canisterId={typeof tok.token === 'string' ? tok.token : tok.token?.toText?.() || String(tok.token)} size={14} />
                                                {tok.symbol || shortPrincipal(tok.token)}
                                            </div>
                                        </td>
                                        <td style={{ padding: '3px 6px', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.7rem' }}>{formatTokenAmount(tok.balance, tok.decimals)}</td>
                                        <td style={{ padding: '3px 6px', textAlign: 'right', fontSize: '0.7rem' }}>{optVal(tok.valueIcpE8s) != null ? formatTokenAmount(optVal(tok.valueIcpE8s), 8) + ' ICP' : '—'}</td>
                                        <td style={{ padding: '3px 6px', textAlign: 'right', fontSize: '0.7rem' }}>{optVal(tok.valueUsdE8s) != null ? '$' + formatTokenAmount(optVal(tok.valueUsdE8s), 8) : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '0.95rem', fontWeight: '600' }}>Portfolio Snapshots</h3>
                    <button
                        onClick={() => { setLoading(true); loadData(); }}
                        disabled={loading}
                        title="Refresh"
                        style={{ background: 'none', border: 'none', cursor: loading ? 'default' : 'pointer', color: accentColor, padding: '2px', display: 'flex', alignItems: 'center', opacity: loading ? 0.5 : 1 }}
                    >
                        <FaSyncAlt style={{ fontSize: '0.75rem', animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                    </button>
                </div>
                {stats && <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>{Number(stats.totalEntries)} snapshots</span>}
            </div>

            {error && <div style={{ padding: '8px 12px', background: '#ef444415', border: '1px solid #ef444430', borderRadius: '8px', color: '#ef4444', fontSize: '0.8rem', marginBottom: '10px' }}>{error}</div>}

            {loading ? (
                <div style={{ textAlign: 'center', padding: '20px', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Loading snapshots...</div>
            ) : pairedItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: theme.colors.mutedText, fontSize: '0.85rem', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                    No portfolio snapshots yet. Snapshots are taken before and after trades.
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {pairedItems.map((item) => {
                        if (item.type === 'pair') return renderPairedItem(item.before, item.after, item.key);
                        return renderSingleItem(item.snap, item.key);
                    })}
                    {hasMore && (
                        <div style={{ textAlign: 'center', padding: '8px', color: theme.colors.mutedText, fontSize: '0.78rem' }}>
                            More snapshots available...
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ============================================
// Logging Settings Panel
// ============================================
function LoggingSettingsPanel({ getReadyBotActor, theme, accentColor, choreStatuses }) {
    const [settings, setSettings] = useState(null);
    const [overrides, setOverrides] = useState([]);
    const [metaStaleness, setMetaStaleness] = useState(null);
    const [metaInput, setMetaInput] = useState('');
    const [priceStaleness, setPriceStaleness] = useState(null);
    const [priceStaleInput, setPriceStaleInput] = useState('');
    const [priceHistMaxSize, setPriceHistMaxSize] = useState(null);
    const [priceHistMaxInput, setPriceHistMaxInput] = useState('');
    const [tradeLogMaxInput, setTradeLogMaxInput] = useState('');
    const [portfolioLogMaxInput, setPortfolioLogMaxInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [saving, setSaving] = useState(false);

    const loadData = useCallback(async () => {
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const [s, o, ms, ps, phMax] = await Promise.all([
                bot.getLoggingSettings(),
                bot.getChoreLoggingOverrides(),
                bot.getMetadataStaleness ? bot.getMetadataStaleness() : Promise.resolve(3600n),
                bot.getPriceStaleness ? bot.getPriceStaleness() : Promise.resolve(300n),
                bot.getPriceHistoryMaxSize ? bot.getPriceHistoryMaxSize() : Promise.resolve(5000n),
            ]);
            setSettings(s);
            setOverrides(o);
            setTradeLogMaxInput(String(Number(s.maxTradeLogEntries)));
            setPortfolioLogMaxInput(String(Number(s.maxPortfolioLogEntries)));
            const staleSec = Number(ms);
            setMetaStaleness(staleSec);
            setMetaInput(String(staleSec));
            const priceSec = Number(ps);
            setPriceStaleness(priceSec);
            setPriceStaleInput(String(priceSec));
            const histMax = Number(phMax);
            setPriceHistMaxSize(histMax);
            setPriceHistMaxInput(String(histMax));
        } catch (err) {
            setError('Failed to load settings: ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [getReadyBotActor]);

    useEffect(() => { loadData(); }, [loadData]);

    const handleToggleMaster = async (field) => {
        if (!settings) return;
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const updated = { ...settings, [field]: !settings[field] };
            await bot.setLoggingSettings(updated);
            setSettings(updated);
            setSuccess(`${field === 'tradeLogEnabled' ? 'Trade' : 'Portfolio'} logging ${!settings[field] ? 'enabled' : 'disabled'}.`);
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) { setError('Failed to update: ' + err.message); }
        finally { setSaving(false); }
    };

    const handleChoreOverride = async (choreId, field, value) => {
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            // Find existing override for this chore
            const existing = overrides.find(([id]) => id === choreId);
            const current = existing ? existing[1] : { tradeLogEnabled: [], portfolioLogEnabled: [] };
            const updated = { ...current, [field]: value === null ? [] : [value] };
            await bot.setChoreLoggingOverride(choreId, updated);
            setSuccess(`Override updated for ${choreId}.`);
            setTimeout(() => setSuccess(''), 3000);
            await loadData();
        } catch (err) { setError('Failed to set override: ' + err.message); }
        finally { setSaving(false); }
    };

    const handleSaveStaleness = async () => {
        const val = parseInt(metaInput, 10);
        if (isNaN(val) || val < 0) { setError('Staleness must be a non-negative number of seconds.'); return; }
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            await bot.setMetadataStaleness(BigInt(val));
            setMetaStaleness(val);
            setSuccess('Metadata staleness updated to ' + val + 's.');
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) { setError('Failed to update staleness: ' + err.message); }
        finally { setSaving(false); }
    };

    const handleSavePriceStaleness = async () => {
        const val = parseInt(priceStaleInput, 10);
        if (isNaN(val) || val < 0) { setError('Price staleness must be a non-negative number of seconds.'); return; }
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            await bot.setPriceStaleness(BigInt(val));
            setPriceStaleness(val);
            setSuccess('Price staleness updated to ' + val + 's.');
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) { setError('Failed to update price staleness: ' + err.message); }
        finally { setSaving(false); }
    };

    const handleSavePriceHistMaxSize = async () => {
        const val = parseInt(priceHistMaxInput, 10);
        if (isNaN(val) || val < 0) { setError('Max size must be a non-negative number.'); return; }
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            await bot.setPriceHistoryMaxSize(BigInt(val));
            setPriceHistMaxSize(val);
            setSuccess('Price history max size updated to ' + val + '.');
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) { setError('Failed to update price history max size: ' + err.message); }
        finally { setSaving(false); }
    };

    const cardStyle = {
        background: theme.colors.cardGradient,
        borderRadius: '12px',
        border: `1px solid ${theme.colors.border}`,
        padding: '16px',
    };

    const optVal = (arr) => arr?.length > 0 ? arr[0] : null;

    const toggleBtnStyle = (isOn) => ({
        padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '500',
        border: `1px solid ${isOn ? '#22c55e40' : '#ef444440'}`,
        background: isOn ? '#22c55e15' : '#ef444415',
        color: isOn ? '#22c55e' : '#ef4444',
        opacity: saving ? 0.6 : 1,
    });

    const formatDuration = (secs) => {
        if (secs >= 86400) return `${(secs / 86400).toFixed(1)} days`;
        if (secs >= 3600) return `${(secs / 3600).toFixed(1)} hours`;
        if (secs >= 60) return `${(secs / 60).toFixed(0)} min`;
        return `${secs}s`;
    };

    return (
        <div style={cardStyle}>
            <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>Bot &amp; Logging Settings</h3>

            {/* Metadata Staleness Setting */}
            <div style={{ padding: '12px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}`, marginBottom: '16px' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '4px' }}>Token Metadata Staleness</div>
                <p style={{ margin: '0 0 8px 0', fontSize: '0.75rem', color: theme.colors.mutedText, lineHeight: '1.4' }}>
                    How old cached token metadata (symbol, decimals, fees) can be before it's re-fetched at the start of each chore run. Lower values mean fresher data but more network calls.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                        type="number" min="0" step="60"
                        value={metaInput}
                        onChange={(e) => setMetaInput(e.target.value)}
                        disabled={saving || loading}
                        style={{ width: '100px', padding: '4px 8px', fontSize: '0.8rem', background: theme.colors.inputBg, border: `1px solid ${theme.colors.border}`, borderRadius: '6px', color: theme.colors.primaryText }}
                    />
                    <span style={{ fontSize: '0.78rem', color: theme.colors.secondaryText }}>seconds</span>
                    {metaStaleness != null && <span style={{ fontSize: '0.72rem', color: theme.colors.mutedText }}>({formatDuration(metaStaleness)})</span>}
                    <button
                        disabled={saving || metaInput === String(metaStaleness)}
                        onClick={handleSaveStaleness}
                        style={{
                            padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '500',
                            border: `1px solid ${accentColor}40`, background: `${accentColor}15`, color: accentColor,
                            opacity: saving || metaInput === String(metaStaleness) ? 0.5 : 1,
                        }}
                    >Save</button>
                </div>
            </div>

            {/* Price Staleness Setting */}
            <div style={{ padding: '12px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}`, marginBottom: '16px' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '4px' }}>Price Staleness</div>
                <p style={{ margin: '0 0 8px 0', fontSize: '0.75rem', color: theme.colors.mutedText, lineHeight: '1.4' }}>
                    How old a cached price quote can be before it must be re-fetched in the prep phase of a chore run. Lower values mean fresher prices but more DEX calls.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                        type="number" min="0" step="30"
                        value={priceStaleInput}
                        onChange={(e) => setPriceStaleInput(e.target.value)}
                        disabled={saving || loading}
                        style={{ width: '100px', padding: '4px 8px', fontSize: '0.8rem', background: theme.colors.inputBg, border: `1px solid ${theme.colors.border}`, borderRadius: '6px', color: theme.colors.primaryText }}
                    />
                    <span style={{ fontSize: '0.78rem', color: theme.colors.secondaryText }}>seconds</span>
                    {priceStaleness != null && <span style={{ fontSize: '0.72rem', color: theme.colors.mutedText }}>({formatDuration(priceStaleness)})</span>}
                    <button
                        disabled={saving || priceStaleInput === String(priceStaleness)}
                        onClick={handleSavePriceStaleness}
                        style={{
                            padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '500',
                            border: `1px solid ${accentColor}40`, background: `${accentColor}15`, color: accentColor,
                            opacity: saving || priceStaleInput === String(priceStaleness) ? 0.5 : 1,
                        }}
                    >Save</button>
                </div>
            </div>

            {/* Price History Buffer Size */}
            <div style={{ padding: '12px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}`, marginBottom: '16px' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '4px' }}>Price History Buffer Size</div>
                <p style={{ margin: '0 0 8px 0', fontSize: '0.75rem', color: theme.colors.mutedText, lineHeight: '1.4' }}>
                    Maximum number of historical price quotes to retain. Older entries are overwritten in a ring buffer. Used for circuit breakers and price charts.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                        type="number" min="0" step="500"
                        value={priceHistMaxInput}
                        onChange={(e) => setPriceHistMaxInput(e.target.value)}
                        disabled={saving || loading}
                        style={{ width: '100px', padding: '4px 8px', fontSize: '0.8rem', background: theme.colors.inputBg, border: `1px solid ${theme.colors.border}`, borderRadius: '6px', color: theme.colors.primaryText }}
                    />
                    <span style={{ fontSize: '0.78rem', color: theme.colors.secondaryText }}>entries</span>
                    {priceHistMaxSize != null && <span style={{ fontSize: '0.72rem', color: theme.colors.mutedText }}>(current: {priceHistMaxSize.toLocaleString()})</span>}
                    <button
                        disabled={saving || priceHistMaxInput === String(priceHistMaxSize)}
                        onClick={handleSavePriceHistMaxSize}
                        style={{
                            padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '500',
                            border: `1px solid ${accentColor}40`, background: `${accentColor}15`, color: accentColor,
                            opacity: saving || priceHistMaxInput === String(priceHistMaxSize) ? 0.5 : 1,
                        }}
                    >Save</button>
                </div>
            </div>

            <h4 style={{ color: theme.colors.primaryText, margin: '0 0 8px 0', fontSize: '0.88rem', fontWeight: '600' }}>Logging</h4>
            <p style={{ margin: '0 0 12px 0', fontSize: '0.82rem', color: theme.colors.secondaryText, lineHeight: '1.5' }}>
                Control what gets logged. Master toggles apply globally. Per-chore overrides let you enable or disable logging for specific chores.
            </p>

            {error && <div style={{ padding: '8px 12px', background: '#ef444415', border: '1px solid #ef444430', borderRadius: '8px', color: '#ef4444', fontSize: '0.8rem', marginBottom: '10px' }}>{error}</div>}
            {success && <div style={{ padding: '8px 12px', background: '#22c55e15', border: '1px solid #22c55e30', borderRadius: '8px', color: '#22c55e', fontSize: '0.8rem', marginBottom: '10px' }}>{success}</div>}

            {loading ? (
                <div style={{ textAlign: 'center', padding: '20px', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Loading settings...</div>
            ) : settings && (
                <>
                    {/* Master settings */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                        <div style={{ padding: '12px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                            <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '6px' }}>Trade Log</div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', color: theme.colors.secondaryText }}>
                                    <span>Max:</span>
                                    <input type="number" min="100" step="1000"
                                        value={tradeLogMaxInput}
                                        onChange={e => setTradeLogMaxInput(e.target.value)}
                                        style={{ width: '80px', padding: '2px 6px', fontSize: '0.78rem', borderRadius: '4px', border: `1px solid ${theme.colors.border}`, background: theme.colors.secondaryBg, color: theme.colors.primaryText, fontFamily: 'monospace' }}
                                    />
                                    {Number(tradeLogMaxInput) !== Number(settings.maxTradeLogEntries) && (
                                        <button disabled={saving} onClick={async () => {
                                            const val = parseInt(tradeLogMaxInput, 10);
                                            if (isNaN(val) || val < 100) { setError('Min 100 entries'); return; }
                                            setSaving(true); setError(''); setSuccess('');
                                            try {
                                                const bot = await getReadyBotActor();
                                                const updated = { ...settings, maxTradeLogEntries: BigInt(val) };
                                                await bot.setLoggingSettings(updated);
                                                setSettings(updated);
                                                setSuccess('Trade log buffer size updated.');
                                                setTimeout(() => setSuccess(''), 3000);
                                            } catch (err) { setError(err.message); }
                                            finally { setSaving(false); }
                                        }} style={{ padding: '1px 6px', fontSize: '0.7rem', borderRadius: '4px', background: accentColor, color: '#fff', border: 'none', cursor: 'pointer' }}>Save</button>
                                    )}
                                </div>
                                <button disabled={saving} onClick={() => handleToggleMaster('tradeLogEnabled')} style={toggleBtnStyle(settings.tradeLogEnabled)}>
                                    {settings.tradeLogEnabled ? 'ON' : 'OFF'}
                                </button>
                            </div>
                        </div>
                        <div style={{ padding: '12px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                            <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '6px' }}>Portfolio Snapshots</div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', color: theme.colors.secondaryText }}>
                                    <span>Max:</span>
                                    <input type="number" min="100" step="1000"
                                        value={portfolioLogMaxInput}
                                        onChange={e => setPortfolioLogMaxInput(e.target.value)}
                                        style={{ width: '80px', padding: '2px 6px', fontSize: '0.78rem', borderRadius: '4px', border: `1px solid ${theme.colors.border}`, background: theme.colors.secondaryBg, color: theme.colors.primaryText, fontFamily: 'monospace' }}
                                    />
                                    {Number(portfolioLogMaxInput) !== Number(settings.maxPortfolioLogEntries) && (
                                        <button disabled={saving} onClick={async () => {
                                            const val = parseInt(portfolioLogMaxInput, 10);
                                            if (isNaN(val) || val < 100) { setError('Min 100 entries'); return; }
                                            setSaving(true); setError(''); setSuccess('');
                                            try {
                                                const bot = await getReadyBotActor();
                                                const updated = { ...settings, maxPortfolioLogEntries: BigInt(val) };
                                                await bot.setLoggingSettings(updated);
                                                setSettings(updated);
                                                setSuccess('Portfolio snapshot buffer size updated.');
                                                setTimeout(() => setSuccess(''), 3000);
                                            } catch (err) { setError(err.message); }
                                            finally { setSaving(false); }
                                        }} style={{ padding: '1px 6px', fontSize: '0.7rem', borderRadius: '4px', background: accentColor, color: '#fff', border: 'none', cursor: 'pointer' }}>Save</button>
                                    )}
                                </div>
                                <button disabled={saving} onClick={() => handleToggleMaster('portfolioLogEnabled')} style={toggleBtnStyle(settings.portfolioLogEnabled)}>
                                    {settings.portfolioLogEnabled ? 'ON' : 'OFF'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Per-chore overrides */}
                    {choreStatuses && choreStatuses.length > 0 && (
                        <div>
                            <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '8px' }}>Per-Chore Overrides</div>
                            <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginBottom: '8px' }}>
                                "Use Master" means the chore follows the master toggle above.
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {choreStatuses.map((chore) => {
                                    const override = overrides.find(([id]) => id === chore.choreId);
                                    const tradeOvr = override ? optVal(override[1].tradeLogEnabled) : null;
                                    const portfolioOvr = override ? optVal(override[1].portfolioLogEnabled) : null;
                                    return (
                                        <div key={chore.choreId} style={{
                                            padding: '8px 12px', background: theme.colors.primaryBg, borderRadius: '8px',
                                            border: `1px solid ${theme.colors.border}`, fontSize: '0.78rem',
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px',
                                        }}>
                                            <span style={{ fontWeight: '500', color: theme.colors.primaryText, minWidth: '150px' }}>{chore.instanceLabel || chore.choreId}</span>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.7rem' }}>Trade:</span>
                                                <select value={tradeOvr === null ? '' : tradeOvr ? 'on' : 'off'} disabled={saving}
                                                    onChange={(e) => handleChoreOverride(chore.choreId, 'tradeLogEnabled', e.target.value === '' ? null : e.target.value === 'on')}
                                                    style={{ fontSize: '0.72rem', padding: '2px 4px', background: theme.colors.inputBg, border: `1px solid ${theme.colors.border}`, borderRadius: '4px', color: theme.colors.primaryText, appearance: 'auto' }}
                                                >
                                                    <option value="">Use Master</option>
                                                    <option value="on">ON</option>
                                                    <option value="off">OFF</option>
                                                </select>
                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.7rem', marginLeft: '6px' }}>Portfolio:</span>
                                                <select value={portfolioOvr === null ? '' : portfolioOvr ? 'on' : 'off'} disabled={saving}
                                                    onChange={(e) => handleChoreOverride(chore.choreId, 'portfolioLogEnabled', e.target.value === '' ? null : e.target.value === 'on')}
                                                    style={{ fontSize: '0.72rem', padding: '2px 4px', background: theme.colors.inputBg, border: `1px solid ${theme.colors.border}`, borderRadius: '4px', color: theme.colors.primaryText, appearance: 'auto' }}
                                                >
                                                    <option value="">Use Master</option>
                                                    <option value="on">ON</option>
                                                    <option value="off">OFF</option>
                                                </select>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// ============================================
// ACCOUNTS PANEL — named subaccounts & token balances
// ============================================
const DND_TOKEN_CHIP = 'TOKEN_CHIP';

function DraggableTokenChip({ tid, index, symbol, showRemove, onRemove, onReorder, theme, borderColor, isPaused, isFrozen }) {
    const ref = React.useRef(null);

    const [{ isDragging }, drag] = useDrag(() => ({
        type: DND_TOKEN_CHIP,
        item: { tid, index },
        collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }), [tid, index]);

    const [{ isOver }, drop] = useDrop(() => ({
        accept: DND_TOKEN_CHIP,
        hover: (item) => {
            if (item.index === index) return;
            onReorder(item.index, index);
            item.index = index;
        },
        collect: (monitor) => ({ isOver: monitor.isOver() }),
    }), [index, onReorder]);

    drag(drop(ref));

    const statusColor = isFrozen ? '#3b82f6' : isPaused ? '#f59e0b' : null;

    return (
        <div ref={ref} style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            padding: '3px 8px', borderRadius: '6px', background: theme.colors.primaryBg,
            border: `1px solid ${isOver ? theme.colors.accentColor || '#10b981' : statusColor ? statusColor + '50' : borderColor}`,
            fontSize: '0.75rem', color: theme.colors.primaryText,
            opacity: isDragging ? 0.4 : (isPaused || isFrozen) ? 0.7 : 1, cursor: 'grab',
            transition: 'border-color 0.15s',
        }}>
            <FaGripVertical style={{ fontSize: '0.55rem', color: theme.colors.mutedText, flexShrink: 0 }} />
            <TokenIcon canisterId={tid} size={14} />
            <span>{symbol}</span>
            {isFrozen && <FaLock style={{ fontSize: '0.5rem', color: '#3b82f6', flexShrink: 0 }} title="Frozen — no trading or movement" />}
            {isPaused && !isFrozen && <FaPause style={{ fontSize: '0.5rem', color: '#f59e0b', flexShrink: 0 }} title="Paused — no trading" />}
            {showRemove && (
                <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '0.6rem', padding: '0 2px', lineHeight: 1 }}
                    title="Remove token">
                    <FaTimes />
                </button>
            )}
        </div>
    );
}

const DND_REBAL_TARGET = 'REBAL_TARGET';

function DraggableEditingTarget({ index, onReorder, theme, children }) {
    const ref = React.useRef(null);

    const [{ isDragging }, drag, preview] = useDrag(() => ({
        type: DND_REBAL_TARGET,
        item: { index },
        collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }), [index]);

    const [{ isOver }, drop] = useDrop(() => ({
        accept: DND_REBAL_TARGET,
        hover: (item) => {
            if (item.index === index) return;
            onReorder(item.index, index);
            item.index = index;
        },
        collect: (monitor) => ({ isOver: monitor.isOver() }),
    }), [index, onReorder]);

    preview(drop(ref));

    return (
        <div ref={ref} style={{
            marginBottom: '10px', padding: '8px 10px', background: theme.colors.primaryBg,
            borderRadius: '8px', border: `1px solid ${isOver ? '#10b981' : theme.colors.border}`,
            opacity: isDragging ? 0.4 : 1, position: 'relative',
            transition: 'border-color 0.15s',
        }}>
            <div ref={drag} style={{ position: 'absolute', left: '2px', top: '50%', transform: 'translateY(-50%)', cursor: 'grab', padding: '4px 2px', color: theme.colors.mutedText }}>
                <FaGripVertical style={{ fontSize: '0.6rem' }} />
            </div>
            <div style={{ marginLeft: '14px' }}>
                {children}
            </div>
        </div>
    );
}

function AccountsPanel({ getReadyBotActor, theme, accentColor, canisterId }) {
    const { identity } = useAuth();
    const { whitelistedTokens } = useWhitelistTokens();
    const [subaccounts, setSubaccounts] = useState([]);
    const [allBalances, setAllBalances] = useState([]); // SubaccountBalances[]
    const [tokenRegistry, setTokenRegistry] = useState([]); // TokenRegistryEntry[]
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [newName, setNewName] = useState('');
    const [creating, setCreating] = useState(false);
    const [selectedAccount, setSelectedAccount] = useState('main'); // 'main' or subaccount number string
    const [renamingId, setRenamingId] = useState(null);
    const [renameValue, setRenameValue] = useState('');
    // Token registration
    const [addTokenValue, setAddTokenValue] = useState('');
    const [addingToken, setAddingToken] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState(null); // { current, total, found }
    const [showTokenManager, setShowTokenManager] = useState(false);
    // Denomination selector for balances
    const [denomToken, setDenomToken] = useState(CKUSDC_LEDGER);
    const [denomPrices, setDenomPrices] = useState({}); // tokenId -> price in denom units per 1 token
    const [loadingPrices, setLoadingPrices] = useState(false);
    // Token pause/freeze state
    const [pausedTokens, setPausedTokens] = useState(new Set()); // Set of token principal strings
    const [frozenTokens, setFrozenTokens] = useState(new Set()); // Set of token principal strings
    const [togglingToken, setTogglingToken] = useState(null); // token id currently being toggled

    // Manual operation state (Withdraw / Deposit / Send)
    const [activeOp, setActiveOp] = useState(null); // 'withdraw' | 'deposit' | 'send' | null
    const [opToken, setOpToken] = useState(''); // token ledger ID
    const [opAmount, setOpAmount] = useState('');
    const [opDestination, setOpDestination] = useState(''); // principal string for send
    const [opDestSubaccount, setOpDestSubaccount] = useState(''); // hex subaccount for send
    const [opTargetSubaccount, setOpTargetSubaccount] = useState(''); // subaccount number string for deposit
    const [opExecuting, setOpExecuting] = useState(false);

    // Resolve token metadata for display
    const allTokenIds = React.useMemo(() => {
        const ids = new Set();
        for (const sb of allBalances) {
            for (const b of (sb.balances || [])) {
                const t = typeof b.token === 'string' ? b.token : b.token?.toText?.() || String(b.token);
                ids.add(t);
            }
        }
        for (const t of tokenRegistry) {
            const k = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
            ids.add(k);
        }
        if (addTokenValue) ids.add(addTokenValue);
        if (denomToken) ids.add(denomToken);
        return [...ids];
    }, [allBalances, tokenRegistry, addTokenValue, denomToken]);
    const tokenMeta = useTokenMetadata(allTokenIds, identity);

    const getSymbol = (p) => {
        const k = typeof p === 'string' ? p : p?.toText?.() || String(p);
        return tokenMeta[k]?.symbol || shortPrincipal(k);
    };
    const getDecimals = (p) => {
        const k = typeof p === 'string' ? p : p?.toText?.() || String(p);
        return tokenMeta[k]?.decimals ?? 8;
    };

    // Load subaccounts + token registry + pause/freeze state (fast query calls, no inter-canister)
    const loadData = useCallback(async () => {
        try {
            const bot = await getReadyBotActor();
            const [subs, registry, paused, frozen] = await Promise.all([
                bot.getSubaccounts ? bot.getSubaccounts() : [],
                bot.getTokenRegistry ? bot.getTokenRegistry() : [],
                bot.getPausedTokens ? bot.getPausedTokens() : [],
                bot.getFrozenTokens ? bot.getFrozenTokens() : [],
            ]);
            setSubaccounts(subs);
            setTokenRegistry(registry);
            setPausedTokens(new Set(paused.map(p => typeof p === 'string' ? p : p?.toText?.() || String(p))));
            setFrozenTokens(new Set(frozen.map(p => typeof p === 'string' ? p : p?.toText?.() || String(p))));
        } catch (e) { setError('Failed to load accounts: ' + e.message); }
        finally { setLoading(false); }
    }, [getReadyBotActor]);

    useEffect(() => { loadData(); }, [loadData]);

    // Fetch balances directly from ledger canisters (frontend-only, fast, progressive)
    const [balancesLoading, setBalancesLoading] = useState(false);
    const balanceFetchKeyRef = useRef('');
    useEffect(() => {
        if (!canisterId || tokenRegistry.length === 0) { setAllBalances([]); return; }
        // Build a stable key from registry + subaccounts to avoid re-fetching unnecessarily
        const regIds = tokenRegistry.map(t => typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId)).sort().join(',');
        const subIds = subaccounts.map(s => String(s.number)).join(',');
        const key = `${canisterId}:${regIds}:${subIds}`;
        if (key === balanceFetchKeyRef.current) return;
        balanceFetchKeyRef.current = key;
        let cancelled = false;
        setBalancesLoading(true);
        (async () => {
            try {
                const { HttpAgent } = await import('@dfinity/agent');
                const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
                const agent = HttpAgent.createSync({ identity, host });
                if (isLocal) await agent.fetchRootKey();
                const botPrincipal = Principal.fromText(canisterId);

                // Build list of (subaccountNumber, name, subaccountBlob-or-null) entries
                const accounts = [
                    { number: 0, name: 'Main Account', subaccount: [] },
                    ...subaccounts.map(s => ({ number: Number(s.number), name: s.name, subaccount: Array.from(s.subaccount || []) })),
                ];

                const tokenList = tokenRegistry.map(t => {
                    const tid = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
                    return tid;
                });

                // Progressive state: accumulate results keyed by subaccountNumber
                const accumulated = {};
                for (const acc of accounts) {
                    accumulated[acc.number] = { subaccountNumber: acc.number, name: acc.name, balances: [] };
                }

                // Fire all balance queries in parallel (token x account), with concurrency limit
                const CONCURRENCY = 12;
                const jobs = [];
                for (const acc of accounts) {
                    for (const tid of tokenList) {
                        jobs.push({ acc, tid });
                    }
                }

                let completed = 0;
                const queue = [...jobs];
                const runWorker = async () => {
                    while (queue.length > 0 && !cancelled) {
                        const job = queue.shift();
                        if (!job) break;
                        try {
                            const ledgerActor = createLedgerActor(job.tid, { agent });
                            const subParam = job.acc.number === 0 ? [] : [job.acc.subaccount];
                            const balance = await ledgerActor.icrc1_balance_of({ owner: botPrincipal, subaccount: subParam });
                            accumulated[job.acc.number].balances.push({ token: job.tid, balance: BigInt(balance) });
                        } catch (_) {}
                        completed++;
                        // Progressive update: push current state every few completions or at the end
                        if (!cancelled && (completed % Math.max(1, Math.min(tokenList.length, 4)) === 0 || completed === jobs.length)) {
                            setAllBalances(Object.values(accumulated).map(a => ({
                                subaccountNumber: a.subaccountNumber,
                                name: a.name,
                                balances: [...a.balances],
                            })));
                        }
                    }
                };
                const workers = [];
                for (let i = 0; i < Math.min(CONCURRENCY, jobs.length); i++) workers.push(runWorker());
                await Promise.all(workers);
                if (!cancelled) {
                    // Final update
                    setAllBalances(Object.values(accumulated).map(a => ({
                        subaccountNumber: a.subaccountNumber,
                        name: a.name,
                        balances: [...a.balances],
                    })));
                }
            } catch (e) { console.warn('Failed to fetch balances:', e); }
            finally { if (!cancelled) setBalancesLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [canisterId, tokenRegistry, subaccounts, identity]);

    // Fetch denomination prices using shared fetchDenomPrices helper (PriceService-backed).
    // Only depends on denomToken + tokenRegistry (not tokenMeta) so that metadata-loading
    // state updates don't cancel in-flight price fetches. The decFor helper reads the shared
    // cache directly for decimals.
    const denomCacheKeyRef = useRef('');
    useEffect(() => {
        if (!denomToken || tokenRegistry.length === 0) { setDenomPrices({}); setLoadingPrices(false); return; }
        const ids = tokenRegistry.map(t => typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId)).sort().join(',');
        const cacheKey = `${denomToken}:${ids}`;
        if (cacheKey === denomCacheKeyRef.current) return;
        let cancelled = false;
        setLoadingPrices(true);
        (async () => {
            try {
                const decFor = (id) => {
                    const cached = getTokenMetadataSync(id);
                    if (cached?.decimals != null) return Number(cached.decimals);
                    const regEntry = tokenRegistry.find(t => {
                        const k = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
                        return k === id;
                    });
                    if (regEntry?.decimals != null) return Number(regEntry.decimals);
                    return 8;
                };
                const tokenIds = ids.split(',');
                const prices = await fetchDenomPrices(tokenIds, denomToken, decFor);
                if (!cancelled) {
                    denomCacheKeyRef.current = cacheKey;
                    setDenomPrices(prices);
                }
            } catch (e) { console.warn('Failed to fetch denom prices:', e); }
            finally { setLoadingPrices(false); }
        })();
        return () => { cancelled = true; };
    }, [denomToken, tokenRegistry]);

    // --- Subaccount handlers ---
    const handleCreate = async () => {
        if (!newName.trim()) return;
        setCreating(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            await bot.createSubaccount(newName.trim());
            setNewName('');
            setSuccess(`Subaccount "${newName.trim()}" created.`);
            await loadData();
        } catch (e) { setError('Failed to create: ' + e.message); }
        finally { setCreating(false); }
    };

    const handleRename = async (num) => {
        if (!renameValue.trim()) return;
        setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            await bot.renameSubaccount(BigInt(num), renameValue.trim());
            setRenamingId(null); setRenameValue('');
            setSuccess('Renamed.');
            await loadData();
        } catch (e) { setError('Failed to rename: ' + e.message); }
    };

    const handleDelete = async (num) => {
        setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            await bot.deleteSubaccount(BigInt(num));
            if (selectedAccount === String(num)) setSelectedAccount('main');
            setSuccess('Deleted.');
            await loadData();
        } catch (e) { setError('Failed to delete: ' + e.message); }
    };

    // --- Token registry handlers ---
    const handleAddToken = async (tokenData) => {
        if (!addTokenValue) return;
        setAddingToken(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const meta = tokenMeta[addTokenValue];
            const entry = {
                ledgerCanisterId: Principal.fromText(addTokenValue),
                symbol: tokenData?.symbol || meta?.symbol || '???',
                decimals: tokenData?.decimals ?? meta?.decimals ?? 8,
                fee: BigInt(tokenData?.fee ?? meta?.fee ?? 10000),
            };
            await bot.addToken(entry);
            setAddTokenValue('');
            setSuccess(`Token ${entry.symbol} registered.`);
            await loadData();
        } catch (e) { setError('Failed to add token: ' + e.message); }
        finally { setAddingToken(false); }
    };

    const handleRemoveToken = async (ledgerId) => {
        setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const p = typeof ledgerId === 'string' ? Principal.fromText(ledgerId) : ledgerId;
            await bot.removeToken(p);
            setSuccess('Token removed.');
            await loadData();
        } catch (e) { setError('Failed to remove token: ' + e.message); }
    };

    // Toggle pause/freeze for a token
    const handleTogglePause = async (tokenId) => {
        setTogglingToken(tokenId); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const p = Principal.fromText(tokenId);
            if (pausedTokens.has(tokenId)) {
                await bot.unpauseToken(p);
                setSuccess(`${getSymbol(tokenId)} unpaused.`);
            } else {
                await bot.pauseToken(p);
                setSuccess(`${getSymbol(tokenId)} paused — it will not be traded by any chore.`);
            }
            await loadData();
        } catch (e) { setError('Failed to toggle pause: ' + e.message); }
        finally { setTogglingToken(null); }
    };

    const handleToggleFreeze = async (tokenId) => {
        setTogglingToken(tokenId); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const p = Principal.fromText(tokenId);
            if (frozenTokens.has(tokenId)) {
                await bot.unfreezeToken(p);
                setSuccess(`${getSymbol(tokenId)} unfrozen.`);
            } else {
                await bot.freezeToken(p);
                setSuccess(`${getSymbol(tokenId)} frozen — it will not be traded or moved by any chore.`);
            }
            await loadData();
        } catch (e) { setError('Failed to toggle freeze: ' + e.message); }
        finally { setTogglingToken(null); }
    };

    // Get the current account's subaccount number (null for main)
    const currentSubaccountNum = selectedAccount === 'main' ? null : Number(selectedAccount);

    // Get the balance of opToken in the currently selected account (for non-fund ops)
    const opTokenBotBalance = React.useMemo(() => {
        if (!opToken) return null;
        const acctBals = selectedAccount === 'main'
            ? allBalances.find(b => Number(b.subaccountNumber) === 0)
            : allBalances.find(b => Number(b.subaccountNumber) === Number(selectedAccount));
        if (!acctBals) return null;
        const bal = acctBals.balances.find(b => {
            const t = typeof b.token === 'string' ? b.token : b.token?.toText?.() || String(b.token);
            return t === opToken;
        });
        return bal ? bal.balance : 0n;
    }, [opToken, selectedAccount, allBalances]);

    // For fund mode: fetch user wallet balance
    const [walletBalance, setWalletBalance] = useState(null);
    useEffect(() => {
        if (activeOp !== 'fund' || !opToken || !identity) { setWalletBalance(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const ledger = createLedgerActor(opToken, { agentOptions: { identity } });
                const bal = await ledger.icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] });
                if (!cancelled) setWalletBalance(bal);
            } catch { if (!cancelled) setWalletBalance(null); }
        })();
        return () => { cancelled = true; };
    }, [activeOp, opToken, identity]);

    const opTokenBalance = activeOp === 'fund' ? walletBalance : opTokenBotBalance;

    const handleExecuteOp = async () => {
        if (!opToken || !opAmount) return;
        setOpExecuting(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const dec = getDecimals(opToken);
            const amount = BigInt(Math.round(parseFloat(opAmount) * (10 ** dec)));
            if (amount <= 0n) { setError('Amount must be greater than 0'); setOpExecuting(false); return; }
            const tokenPrincipal = Principal.fromText(opToken);
            const fromSub = currentSubaccountNum != null ? [BigInt(currentSubaccountNum)] : [];

            if (activeOp === 'fund') {
                // ICRC-1 transfer from user wallet to bot account
                const botPrincipal = Principal.fromText(canisterId);
                const subEntry = currentSubaccountNum != null ? subaccounts.find(s => Number(s.number) === currentSubaccountNum) : null;
                const toSub = subEntry?.subaccount ? [new Uint8Array(subEntry.subaccount)] : [];
                const ledgerActor = createLedgerActor(opToken, { agentOptions: { identity } });
                const result = await ledgerActor.icrc1_transfer({
                    to: { owner: botPrincipal, subaccount: toSub },
                    amount,
                    fee: [],
                    memo: [],
                    from_subaccount: [],
                    created_at_time: [],
                });
                if ('Ok' in result) {
                    setSuccess(`Funded ${opAmount} ${getSymbol(opToken)} to ${selectedAccount === 'main' ? 'Main Account' : `#${selectedAccount}`}. Block: ${result.Ok.toString()}`);
                    setActiveOp(null); setOpAmount(''); setOpToken('');
                    balanceFetchKeyRef.current = ''; loadData();
                } else {
                    setError('Fund failed: ' + JSON.stringify(result.Err));
                }
            } else if (activeOp === 'withdraw') {
                // Send to user's wallet
                const userPrincipal = identity.getPrincipal();
                const result = await bot.manualSend(tokenPrincipal, fromSub, userPrincipal, [], amount);
                if ('Ok' in result) {
                    setSuccess(`Withdrew ${opAmount} ${getSymbol(opToken)} to your wallet. Block: ${result.Ok.blockIndex.toString()}`);
                    setActiveOp(null); setOpAmount(''); setOpToken('');
                    balanceFetchKeyRef.current = ''; loadData();
                } else {
                    setError('Withdraw failed: ' + JSON.stringify(result.Err));
                }
            } else if (activeOp === 'deposit') {
                // Transfer between bot's own accounts
                const toSub = opTargetSubaccount === 'main' ? [] : [BigInt(opTargetSubaccount)];
                const result = await bot.manualTransfer(tokenPrincipal, fromSub, toSub, amount);
                if ('Ok' in result) {
                    const toLabel = opTargetSubaccount === 'main' ? 'Main Account' : `Subaccount #${opTargetSubaccount}`;
                    setSuccess(`Transferred ${opAmount} ${getSymbol(opToken)} to ${toLabel}. Block: ${result.Ok.blockIndex.toString()}`);
                    setActiveOp(null); setOpAmount(''); setOpToken(''); setOpTargetSubaccount('');
                    balanceFetchKeyRef.current = ''; loadData();
                } else {
                    setError('Transfer failed: ' + JSON.stringify(result.Err));
                }
            } else if (activeOp === 'send') {
                // Send to external account
                if (!opDestination) { setError('Please enter a destination principal'); setOpExecuting(false); return; }
                let destPrincipal;
                try { destPrincipal = Principal.fromText(opDestination); }
                catch { setError('Invalid destination principal'); setOpExecuting(false); return; }
                let destSubBlob = [];
                if (opDestSubaccount.trim()) {
                    // Parse hex subaccount
                    const hex = opDestSubaccount.replace(/^0x/, '').trim();
                    if (hex.length > 0 && hex.length <= 64) {
                        const bytes = [];
                        const padded = hex.padStart(64, '0');
                        for (let i = 0; i < padded.length; i += 2) {
                            bytes.push(parseInt(padded.substr(i, 2), 16));
                        }
                        destSubBlob = [bytes];
                    }
                }
                const result = await bot.manualSend(tokenPrincipal, fromSub, destPrincipal, destSubBlob, amount);
                if ('Ok' in result) {
                    setSuccess(`Sent ${opAmount} ${getSymbol(opToken)} to ${opDestination.slice(0, 10)}... Block: ${result.Ok.blockIndex.toString()}`);
                    setActiveOp(null); setOpAmount(''); setOpToken(''); setOpDestination(''); setOpDestSubaccount('');
                    balanceFetchKeyRef.current = ''; loadData();
                } else {
                    setError('Send failed: ' + JSON.stringify(result.Err));
                }
            }
        } catch (e) { setError('Operation failed: ' + e.message); }
        finally { setOpExecuting(false); }
    };

    // DnD reorder: swap in local state immediately, persist to backend
    const reorderTimeoutRef = useRef(null);
    const handleReorderTokens = useCallback((fromIdx, toIdx) => {
        setTokenRegistry(prev => {
            const updated = [...prev];
            const [moved] = updated.splice(fromIdx, 1);
            updated.splice(toIdx, 0, moved);
            return updated;
        });
        // Debounce persist to backend
        if (reorderTimeoutRef.current) clearTimeout(reorderTimeoutRef.current);
        reorderTimeoutRef.current = setTimeout(async () => {
            try {
                const bot = await getReadyBotActor();
                // Read current local state at persist time
                setTokenRegistry(current => {
                    const ordered = current.map(t => {
                        const tid = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
                        return Principal.fromText(tid);
                    });
                    bot.reorderTokenRegistry(ordered).catch(e => console.warn('Failed to persist token order:', e));
                    return current;
                });
            } catch (e) { console.warn('Failed to reorder tokens:', e); }
        }, 600);
    }, [getReadyBotActor]);

    // Scan for tokens with balances
    const handleScanForTokens = async () => {
        if (scanning) return;
        setScanning(true); setError(''); setSuccess('');
        setScanProgress({ current: 0, total: 0, found: 0 });
        try {
            const bot = await getReadyBotActor();
            // Get already registered token IDs
            const registeredSet = new Set(tokenRegistry.map(t => {
                const k = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
                return k;
            }));
            // Filter whitelisted tokens to those not already registered
            const ledgersToScan = whitelistedTokens
                .map(t => ({ id: t.ledger_id?.toString?.() ?? String(t.ledger_id), symbol: t.symbol, decimals: t.decimals, fee: t.fee }))
                .filter(t => !registeredSet.has(t.id));
            setScanProgress({ current: 0, total: ledgersToScan.length, found: 0 });
            if (ledgersToScan.length === 0) {
                setSuccess('All whitelisted tokens are already registered.');
                setScanning(false); setScanProgress(null);
                return;
            }
            // Create agent for balance checks
            const { HttpAgent } = await import('@dfinity/agent');
            const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
            const agent = HttpAgent.createSync({ identity, host });
            if (isLocal) await agent.fetchRootKey();
            // Get the bot's principal (canister ID) to check its balances
            const botPrincipal = Principal.fromText(canisterId);
            let foundCount = 0;
            let scanned = 0;
            // Scan concurrently with limited parallelism
            const CONCURRENCY = 8;
            const queue = [...ledgersToScan];
            const workers = [];
            for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
                workers.push((async () => {
                    while (queue.length > 0) {
                        const item = queue.shift();
                        if (!item) break;
                        try {
                            const ledgerActor = createLedgerActor(item.id, { agent });
                            const balance = await ledgerActor.icrc1_balance_of({ owner: botPrincipal, subaccount: [] });
                            if (BigInt(balance) > 0n) {
                                await bot.addToken({
                                    ledgerCanisterId: Principal.fromText(item.id),
                                    symbol: item.symbol || '???',
                                    decimals: item.decimals ?? 8,
                                    fee: BigInt(item.fee ?? 10000),
                                });
                                foundCount++;
                            }
                        } catch (_) {}
                        scanned++;
                        setScanProgress({ current: scanned, total: ledgersToScan.length, found: foundCount });
                    }
                })());
            }
            await Promise.all(workers);
            setSuccess(`Scan complete. Found ${foundCount} token${foundCount !== 1 ? 's' : ''} with balances.`);
            await loadData();
        } catch (e) { setError('Scan failed: ' + e.message); }
        finally { setScanning(false); setScanProgress(null); }
    };

    // Get balances for the selected account
    const selectedBalances = React.useMemo(() => {
        if (selectedAccount === 'main') {
            const main = allBalances.find(b => Number(b.subaccountNumber) === 0);
            return main?.balances || [];
        }
        const sub = allBalances.find(b => Number(b.subaccountNumber) === Number(selectedAccount));
        return sub?.balances || [];
    }, [allBalances, selectedAccount]);

    // Token subset for operation form: all balance tokens + all registered tokens
    const opTokenSubset = React.useMemo(() => {
        const seen = new Set();
        const result = [];
        for (const b of selectedBalances) {
            const t = typeof b.token === 'string' ? b.token : b.token?.toText?.() || String(b.token);
            if (!seen.has(t)) { seen.add(t); result.push({ ledger_id: t, symbol: getSymbol(t), name: getSymbol(t) }); }
        }
        for (const t of tokenRegistry) {
            const tid = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
            if (!seen.has(tid)) {
                const sym = _isPlaceholderSymbol(t.symbol) ? getSymbol(tid) : t.symbol;
                seen.add(tid); result.push({ ledger_id: tid, symbol: sym, name: sym });
            }
        }
        return result;
    }, [selectedBalances, tokenRegistry, tokenMeta]);

    const cardBg = theme.colors.cardGradient;
    const borderColor = theme.colors.border;
    const inputStyle = { padding: '6px 10px', borderRadius: '6px', border: `1px solid ${borderColor}`, background: theme.colors.primaryBg, color: theme.colors.primaryText, fontSize: '0.8rem', outline: 'none' };
    const btnStyle = { padding: '4px 10px', borderRadius: '6px', border: `1px solid ${accentColor}40`, background: 'none', color: accentColor, cursor: 'pointer', fontSize: '0.75rem', fontWeight: '500' };
    const dangerBtn = { ...btnStyle, color: '#ef4444', borderColor: '#ef444440' };

    if (loading) return <div style={{ textAlign: 'center', padding: '20px', color: theme.colors.secondaryText }}>Loading accounts...</div>;

    return (
        <DndProvider backend={HTML5Backend}>
        <div>
            {error && <div style={{ padding: '8px 12px', background: '#ef444415', border: '1px solid #ef444430', borderRadius: '8px', color: '#ef4444', fontSize: '0.8rem', marginBottom: '10px' }}>{error}</div>}
            {success && <div style={{ padding: '8px 12px', background: '#22c55e15', border: '1px solid #22c55e30', borderRadius: '8px', color: '#22c55e', fontSize: '0.8rem', marginBottom: '10px' }}>{success}</div>}

            {/* ── Token Registry Section ── */}
            <div style={{ padding: '12px', background: cardBg, borderRadius: '10px', border: `1px solid ${borderColor}`, marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <h4 style={{ margin: 0, fontSize: '0.85rem', color: theme.colors.primaryText, fontWeight: '600' }}>
                        Registered Tokens ({tokenRegistry.length})
                    </h4>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <button onClick={handleScanForTokens} disabled={scanning}
                            style={{ ...btnStyle, opacity: scanning ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <FaSearch style={{ fontSize: '0.6rem', animation: scanning ? 'spin 1s linear infinite' : 'none' }} />
                            {scanning ? 'Scanning...' : 'Scan for Tokens'}
                        </button>
                        <button onClick={() => setShowTokenManager(!showTokenManager)} style={btnStyle}>
                            {showTokenManager ? 'Hide' : 'Manage'}
                        </button>
                        <button onClick={() => { balanceFetchKeyRef.current = ''; setAllBalances([]); setLoading(true); loadData(); }} style={btnStyle}>
                            <FaSyncAlt style={{ fontSize: '0.6rem' }} />
                        </button>
                    </div>
                </div>
                {scanProgress && (
                    <div style={{ fontSize: '0.72rem', color: theme.colors.secondaryText, marginBottom: '6px' }}>
                        Scanning {scanProgress.current}/{scanProgress.total}... Found {scanProgress.found} so far.
                    </div>
                )}
                {/* Registered tokens list (compact, drag-and-drop reorderable) */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: showTokenManager ? '10px' : '0' }}>
                    {tokenRegistry.length === 0 ? (
                        <div style={{ color: theme.colors.mutedText, fontSize: '0.78rem', padding: '4px 0' }}>No tokens registered. Add tokens or scan for tokens with balances.</div>
                    ) : (
                        tokenRegistry.map((t, idx) => {
                            const tid = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
                            return (
                                <DraggableTokenChip
                                    key={tid}
                                    tid={tid}
                                    index={idx}
                                    symbol={_isPlaceholderSymbol(t.symbol) ? getSymbol(tid) : t.symbol}
                                    showRemove={showTokenManager}
                                    onRemove={() => handleRemoveToken(tid)}
                                    onReorder={handleReorderTokens}
                                    theme={theme}
                                    borderColor={borderColor}
                                    isPaused={pausedTokens.has(tid)}
                                    isFrozen={frozenTokens.has(tid)}
                                />
                            );
                        })
                    )}
                </div>
                {/* Add token form */}
                {showTokenManager && (
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '3px' }}>Add Token</label>
                            <TokenSelector
                                value={addTokenValue}
                                onChange={setAddTokenValue}
                                onSelectToken={(data) => {
                                    setAddTokenValue(data.ledger_id);
                                    // Auto-register immediately when selected from dropdown
                                    handleAddToken(data);
                                }}
                                allowCustom={true}
                                placeholder="Search or paste ledger ID..."
                            />
                        </div>
                        {addTokenValue && (
                            <button onClick={() => handleAddToken(null)} disabled={addingToken}
                                style={{ ...btnStyle, opacity: addingToken ? 0.6 : 1, whiteSpace: 'nowrap', marginBottom: '1px' }}>
                                <FaPlus style={{ fontSize: '0.6rem', marginRight: '3px' }} />{addingToken ? 'Adding...' : 'Add'}
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* ── Account Selector ── */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <button
                    onClick={() => setSelectedAccount('main')}
                    style={{
                        padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500',
                        background: selectedAccount === 'main' ? `${accentColor}20` : 'transparent',
                        border: `1px solid ${selectedAccount === 'main' ? accentColor : borderColor}`,
                        color: selectedAccount === 'main' ? accentColor : theme.colors.secondaryText,
                    }}
                >
                    Main Account
                </button>
                {subaccounts.map(s => {
                    const num = String(Number(s.number));
                    const active = selectedAccount === num;
                    return (
                        <button key={num} onClick={() => setSelectedAccount(num)}
                            style={{
                                padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500',
                                background: active ? `${accentColor}20` : 'transparent',
                                border: `1px solid ${active ? accentColor : borderColor}`,
                                color: active ? accentColor : theme.colors.secondaryText,
                            }}
                        >
                            {s.name} <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>#{num}</span>
                        </button>
                    );
                })}
            </div>

            {/* ── Selected Account Balances ── */}
            <div style={{ padding: '12px', background: cardBg, borderRadius: '10px', border: `1px solid ${borderColor}`, marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                    <h4 style={{ margin: 0, fontSize: '0.85rem', color: theme.colors.primaryText, fontWeight: '600' }}>
                        {selectedAccount === 'main' ? 'Main Account' : (() => {
                            const s = subaccounts.find(s => String(Number(s.number)) === selectedAccount);
                            return s ? `${s.name} (#${selectedAccount})` : `Subaccount #${selectedAccount}`;
                        })()}
                        {' '}— Token Balances
                    </h4>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <label style={{ fontSize: '0.7rem', color: theme.colors.secondaryText }}>Value in:</label>
                        <div style={{ width: '160px' }}>
                            <TokenSelector
                                value={denomToken}
                                onChange={(v) => { setDenomToken(v); setDenomPrices({}); }}
                                allowCustom={true}
                                placeholder="Denomination..."
                            />
                        </div>
                        {denomToken && (
                            <button type="button" onClick={() => { setDenomToken(''); setDenomPrices({}); }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.6rem', color: accentColor, padding: '2px' }}
                                title="Clear denomination">
                                <FaTimes />
                            </button>
                        )}
                    </div>
                </div>

                {/* ── Receiving Address Info ── */}
                {canisterId && (() => {
                    const botPrincipal = Principal.fromText(canisterId);
                    const isMain = selectedAccount === 'main';
                    const subEntry = !isMain ? subaccounts.find(s => String(Number(s.number)) === selectedAccount) : null;
                    const subBlob = subEntry?.subaccount ? new Uint8Array(subEntry.subaccount) : null;
                    const icrc1Account = isMain
                        ? encodeIcrcAccount({ owner: botPrincipal })
                        : encodeIcrcAccount({ owner: botPrincipal, subaccount: subBlob });
                    const accountId = computeAccountId(botPrincipal, isMain ? null : subBlob);

                    const copyBtn = (text) => (
                        <button title="Copy" onClick={() => { navigator.clipboard.writeText(text); setSuccess('Copied!'); setTimeout(() => setSuccess(''), 1500); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: accentColor, padding: '2px 4px', fontSize: '0.7rem' }}>
                            <FaCopy />
                        </button>
                    );
                    const addrRow = (label, value, mono = true) => (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                            <span style={{ fontSize: '0.72rem', color: theme.colors.secondaryText, minWidth: '80px', flexShrink: 0 }}>{label}</span>
                            <code style={{ fontSize: '0.72rem', color: theme.colors.primaryText, fontFamily: mono ? 'monospace' : 'inherit',
                                wordBreak: 'break-all', lineHeight: '1.4' }}>{value}</code>
                            {copyBtn(value)}
                        </div>
                    );

                    return (
                        <div style={{ marginBottom: '10px', padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${borderColor}`, fontSize: '0.78rem' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: theme.colors.primaryText, marginBottom: '6px' }}>Receiving Addresses</div>
                            {isMain ? (
                                <>
                                    {addrRow('Principal', canisterId)}
                                    {addrRow('ICRC-1 Account', icrc1Account)}
                                </>
                            ) : (
                                <>
                                    {addrRow('ICRC-1 Account', icrc1Account)}
                                    {addrRow('Principal', canisterId)}
                                    {subBlob && addrRow('Subaccount', Array.from(subBlob).map(b => b.toString(16).padStart(2, '0')).join(''))}
                                </>
                            )}
                            {accountId && addrRow('Account ID', accountId)}
                            <div style={{ fontSize: '0.68rem', color: theme.colors.mutedText, marginTop: '4px', lineHeight: '1.4' }}>
                                Use <strong>ICRC-1 Account</strong> or <strong>Principal</strong> to receive tokens from wallets, DEXes, and IC apps.
                                {' '}<strong>Account ID</strong> is for receiving ICP from centralized exchanges (CEXes) only.
                            </div>
                        </div>
                    );
                })()}

                {selectedBalances.length === 0 ? (
                    <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', padding: '8px 0' }}>
                        {balancesLoading ? 'Fetching balances...' : (tokenRegistry.length === 0 ? 'No token balances. Register some tokens above to see balances.' : 'No token balances found for this account.')}
                    </div>
                ) : (() => {
                    const denomSym = denomToken ? getSymbol(denomToken) : '';
                    const denomSign = getCurrencySign(denomToken);
                    const denomDec = denomToken ? getDecimals(denomToken) : 8;
                    let totalDenomValue = 0;
                    let hasAnyDenomValue = false;

                    const rows = selectedBalances.map((b) => {
                        const tid = typeof b.token === 'string' ? b.token : b.token?.toText?.() || String(b.token);
                        const dec = getDecimals(tid);
                        const humanBal = Number(b.balance) / (10 ** dec);
                        const price = denomPrices[tid];
                        let denomValue = null;
                        if (denomToken && price != null && price > 0) {
                            denomValue = humanBal * price;
                            totalDenomValue += denomValue;
                            hasAnyDenomValue = true;
                        }
                        return { tid, dec, humanBal, balance: b.balance, denomValue, price };
                    });

                    // Build pie chart segments from denom values
                    const pieSegments = hasAnyDenomValue ? rows.filter(r => r.denomValue != null && r.denomValue > 0).map((r) => ({
                        label: getSymbol(r.tid), value: r.denomValue, color: getTokenColor(r.tid),
                    })) : [];

                    const colCount = (denomToken ? (hasAnyDenomValue ? 5 : 4) : 2) + 1; // +1 for Status column

                    return (
                        <>
                            {/* Pie chart for account allocation */}
                            {pieSegments.length > 0 && (
                                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px', padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${borderColor}` }}>
                                    <PieChart segments={pieSegments} label={selectedAccount === 'main' ? 'Main Account' : 'Subaccount'} theme={theme} />
                                </div>
                            )}
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                <thead>
                                    <tr style={{ color: theme.colors.mutedText, textAlign: 'left' }}>
                                        <th style={{ padding: '4px 8px' }}>Token</th>
                                        <th style={{ padding: '4px 8px', textAlign: 'right' }}>Balance</th>
                                        {denomToken && <th style={{ padding: '4px 8px', textAlign: 'right' }}>Price ({denomSign || denomSym})</th>}
                                        {denomToken && <th style={{ padding: '4px 8px', textAlign: 'right' }}>{denomSign ? `Value (${denomSign})` : `Value (${denomSym})`}</th>}
                                        {denomToken && hasAnyDenomValue && <th style={{ padding: '4px 8px', textAlign: 'right' }}>%</th>}
                                        <th style={{ padding: '4px 8px', textAlign: 'center', fontSize: '0.7rem' }}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(({ tid, dec, balance, denomValue, price }) => {
                                        const tPaused = pausedTokens.has(tid);
                                        const tFrozen = frozenTokens.has(tid);
                                        const isToggling = togglingToken === tid;
                                        return (
                                        <tr key={tid} style={{ borderTop: `1px solid ${borderColor}20`, opacity: tFrozen ? 0.55 : tPaused ? 0.7 : 1 }}>
                                            <td style={{ padding: '5px 8px', color: theme.colors.primaryText }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <TokenIcon canisterId={tid} size={18} />
                                                    {getSymbol(tid)}
                                                    {tFrozen && <span style={{ fontSize: '0.6rem', color: '#3b82f6', fontWeight: '600' }}>FROZEN</span>}
                                                    {tPaused && !tFrozen && <span style={{ fontSize: '0.6rem', color: '#f59e0b', fontWeight: '600' }}>PAUSED</span>}
                                                </div>
                                            </td>
                                            <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: theme.colors.secondaryText }}>
                                                {formatTokenAmount(balance, dec)}
                                            </td>
                                            {denomToken && (
                                                <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: price != null ? theme.colors.secondaryText : theme.colors.mutedText, fontSize: '0.75rem' }}>
                                                    {tid === denomToken ? '1.00' : (price != null
                                                        ? formatDenomAmount(price, denomToken, denomSym)
                                                        : (loadingPrices ? '...' : '—'))}
                                                </td>
                                            )}
                                            {denomToken && (
                                                <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: denomValue != null ? theme.colors.primaryText : theme.colors.mutedText, fontSize: '0.78rem' }}>
                                                    {denomValue != null
                                                        ? formatDenomAmount(denomValue, denomToken, denomSym)
                                                        : (loadingPrices ? '...' : '—')}
                                                </td>
                                            )}
                                            {denomToken && hasAnyDenomValue && (
                                                <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.75rem', color: denomValue != null && totalDenomValue > 0 ? accentColor : theme.colors.mutedText }}>
                                                    {denomValue != null && totalDenomValue > 0
                                                        ? ((denomValue / totalDenomValue) * 100).toFixed(1) + '%'
                                                        : '—'}
                                                </td>
                                            )}
                                            <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                                                <div style={{ display: 'flex', gap: '3px', justifyContent: 'center' }}>
                                                    <button
                                                        onClick={() => handleTogglePause(tid)}
                                                        disabled={isToggling}
                                                        title={tPaused ? 'Unpause — allow trading' : 'Pause — prevent trading by all chores'}
                                                        style={{
                                                            background: 'none', border: `1px solid ${tPaused ? '#f59e0b50' : borderColor}`,
                                                            borderRadius: '4px', cursor: isToggling ? 'wait' : 'pointer', padding: '2px 5px',
                                                            color: tPaused ? '#f59e0b' : theme.colors.mutedText, fontSize: '0.6rem',
                                                            opacity: isToggling ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '2px',
                                                        }}
                                                    >
                                                        {tPaused ? <FaPlay style={{ fontSize: '0.5rem' }} /> : <FaPause style={{ fontSize: '0.5rem' }} />}
                                                    </button>
                                                    <button
                                                        onClick={() => handleToggleFreeze(tid)}
                                                        disabled={isToggling}
                                                        title={tFrozen ? 'Unfreeze — allow trading and movement' : 'Freeze — prevent trading and all movement'}
                                                        style={{
                                                            background: 'none', border: `1px solid ${tFrozen ? '#3b82f650' : borderColor}`,
                                                            borderRadius: '4px', cursor: isToggling ? 'wait' : 'pointer', padding: '2px 5px',
                                                            color: tFrozen ? '#3b82f6' : theme.colors.mutedText, fontSize: '0.6rem',
                                                            opacity: isToggling ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '2px',
                                                        }}
                                                    >
                                                        {tFrozen ? <FaLockOpen style={{ fontSize: '0.5rem' }} /> : <FaLock style={{ fontSize: '0.5rem' }} />}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                        );
                                    })}
                                    {/* Total row */}
                                    {denomToken && hasAnyDenomValue && (
                                        <tr style={{ borderTop: `2px solid ${borderColor}40` }}>
                                            <td style={{ padding: '6px 8px', fontWeight: '700', color: theme.colors.primaryText }}>
                                                Total{balancesLoading ? ' (loading...)' : ''}
                                            </td>
                                            <td />
                                            {denomToken && <td />}
                                            <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: '700', color: accentColor, fontSize: '0.85rem' }}>
                                                {formatDenomAmount(totalDenomValue, denomToken, denomSym)}
                                            </td>
                                            <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: '600', color: accentColor, fontSize: '0.75rem' }}>100%</td>
                                            <td />
                                        </tr>
                                    )}
                                    {balancesLoading && !hasAnyDenomValue && (
                                        <tr><td colSpan={colCount} style={{ padding: '4px 8px', fontSize: '0.75rem', color: theme.colors.mutedText }}>Scanning balances...</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </>
                    );
                })()}
                {/* Pause/Freeze legend */}
                {(pausedTokens.size > 0 || frozenTokens.size > 0) && (
                    <div style={{ marginTop: '8px', display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '0.68rem', color: theme.colors.mutedText }}>
                        {pausedTokens.size > 0 && <span><FaPause style={{ fontSize: '0.5rem', color: '#f59e0b', marginRight: '3px' }} />Paused — not traded by any chore</span>}
                        {frozenTokens.size > 0 && <span><FaLock style={{ fontSize: '0.5rem', color: '#3b82f6', marginRight: '3px' }} />Frozen — not traded or moved by any chore</span>}
                    </div>
                )}
                {/* ── Operation Buttons (Fund / Withdraw / Transfer / Send) ── */}
                <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button onClick={() => { setActiveOp(activeOp === 'fund' ? null : 'fund'); setOpToken(''); setOpAmount(''); }}
                        style={{ ...btnStyle, background: activeOp === 'fund' ? `${accentColor}15` : 'none', borderColor: activeOp === 'fund' ? accentColor : `${accentColor}40`, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <FaDownload style={{ fontSize: '0.6rem' }} /> Fund
                    </button>
                    <button onClick={() => { setActiveOp(activeOp === 'withdraw' ? null : 'withdraw'); setOpToken(''); setOpAmount(''); }}
                        style={{ ...btnStyle, background: activeOp === 'withdraw' ? `${accentColor}15` : 'none', borderColor: activeOp === 'withdraw' ? accentColor : `${accentColor}40`, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <FaWallet style={{ fontSize: '0.6rem' }} /> Withdraw
                    </button>
                    <button onClick={() => { setActiveOp(activeOp === 'deposit' ? null : 'deposit'); setOpToken(''); setOpAmount(''); setOpTargetSubaccount(''); }}
                        style={{ ...btnStyle, background: activeOp === 'deposit' ? `${accentColor}15` : 'none', borderColor: activeOp === 'deposit' ? accentColor : `${accentColor}40`, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <FaExchangeAlt style={{ fontSize: '0.6rem' }} /> {selectedAccount === 'main' ? 'Transfer to Subaccount' : 'Transfer'}
                    </button>
                    <button onClick={() => { setActiveOp(activeOp === 'send' ? null : 'send'); setOpToken(''); setOpAmount(''); setOpDestination(''); setOpDestSubaccount(''); }}
                        style={{ ...btnStyle, background: activeOp === 'send' ? `${accentColor}15` : 'none', borderColor: activeOp === 'send' ? accentColor : `${accentColor}40`, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <FaPaperPlane style={{ fontSize: '0.6rem' }} /> Send
                    </button>
                </div>

                {/* ── Operation Form ── */}
                {activeOp && (
                    <div style={{ marginTop: '10px', padding: '12px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${borderColor}` }}>
                        <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '8px' }}>
                            {activeOp === 'fund' && <>Fund from Wallet</>}
                            {activeOp === 'withdraw' && <>Withdraw to Your Wallet</>}
                            {activeOp === 'deposit' && <>{selectedAccount === 'main' ? 'Transfer to Subaccount' : 'Transfer Between Accounts'}</>}
                            {activeOp === 'send' && <>Send to External Account</>}
                            <span style={{ fontSize: '0.7rem', color: theme.colors.mutedText, marginLeft: '8px' }}>
                                {activeOp === 'fund'
                                    ? `(to ${selectedAccount === 'main' ? 'Main Account' : (() => { const s = subaccounts.find(s => String(Number(s.number)) === selectedAccount); return s ? s.name : `#${selectedAccount}`; })()})`
                                    : `(from ${selectedAccount === 'main' ? 'Main Account' : (() => { const s = subaccounts.find(s => String(Number(s.number)) === selectedAccount); return s ? s.name : `#${selectedAccount}`; })()})`}
                            </span>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            {/* Token selector */}
                            <div style={{ minWidth: '180px' }}>
                                <label style={{ fontSize: '0.68rem', color: theme.colors.mutedText, display: 'block', marginBottom: '3px' }}>Token</label>
                                <TokenSelector
                                    value={opToken}
                                    onChange={setOpToken}
                                    tokenSubset={activeOp === 'fund' ? undefined : opTokenSubset}
                                    allowCustom={activeOp === 'fund'}
                                    placeholder="Select token..."
                                />
                            </div>

                            {/* Amount */}
                            <div style={{ minWidth: '120px', flex: 1 }}>
                                <label style={{ fontSize: '0.68rem', color: theme.colors.mutedText, display: 'block', marginBottom: '3px' }}>
                                    Amount
                                    {opToken && opTokenBalance != null && (
                                        <span style={{ marginLeft: '6px', color: theme.colors.secondaryText }}>
                                            ({activeOp === 'fund' ? 'wallet' : 'bal'}: {formatTokenAmount(opTokenBalance, getDecimals(opToken))})
                                        </span>
                                    )}
                                </label>
                                <div style={{ display: 'flex', gap: '4px' }}>
                                    <input type="text" inputMode="decimal" value={opAmount} onChange={(e) => setOpAmount(e.target.value)}
                                        placeholder="0.00" style={{ ...inputStyle, flex: 1 }} />
                                    {opToken && opTokenBalance != null && opTokenBalance > 0n && (
                                        <button onClick={() => {
                                            const dec = getDecimals(opToken);
                                            const fee = tokenRegistry.find(t => {
                                                const tid = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
                                                return tid === opToken;
                                            })?.fee || 0n;
                                            const maxRaw = BigInt(opTokenBalance) > BigInt(fee) ? BigInt(opTokenBalance) - BigInt(fee) : 0n;
                                            setOpAmount((Number(maxRaw) / (10 ** dec)).toString());
                                        }} style={{ ...btnStyle, padding: '4px 6px', fontSize: '0.65rem' }}>Max</button>
                                    )}
                                </div>
                            </div>

                            {/* Deposit: target subaccount selector */}
                            {activeOp === 'deposit' && (
                                <div style={{ minWidth: '160px' }}>
                                    <label style={{ fontSize: '0.68rem', color: theme.colors.mutedText, display: 'block', marginBottom: '3px' }}>Destination</label>
                                    <select value={opTargetSubaccount} onChange={(e) => setOpTargetSubaccount(e.target.value)}
                                        style={{ ...inputStyle, width: '100%' }}>
                                        <option value="">Select destination...</option>
                                        {selectedAccount !== 'main' && <option value="main">Main Account</option>}
                                        {subaccounts.filter(s => String(Number(s.number)) !== selectedAccount).map(s => (
                                            <option key={Number(s.number)} value={String(Number(s.number))}>{s.name} (#{Number(s.number)})</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Send: destination principal */}
                            {activeOp === 'send' && (
                                <div style={{ minWidth: '200px', flex: 2 }}>
                                    <label style={{ fontSize: '0.68rem', color: theme.colors.mutedText, display: 'block', marginBottom: '3px' }}>Destination Principal</label>
                                    <input type="text" value={opDestination} onChange={(e) => setOpDestination(e.target.value)}
                                        placeholder="Principal ID..." style={{ ...inputStyle, width: '100%' }} />
                                </div>
                            )}
                            {activeOp === 'send' && (
                                <div style={{ minWidth: '160px' }}>
                                    <label style={{ fontSize: '0.68rem', color: theme.colors.mutedText, display: 'block', marginBottom: '3px' }}>Subaccount (optional, hex)</label>
                                    <input type="text" value={opDestSubaccount} onChange={(e) => setOpDestSubaccount(e.target.value)}
                                        placeholder="0x00...00" style={{ ...inputStyle, width: '100%' }} />
                                </div>
                            )}
                        </div>

                        {/* Fund: show source wallet info */}
                        {activeOp === 'fund' && identity && (
                            <div style={{ marginTop: '6px', fontSize: '0.72rem', color: theme.colors.secondaryText }}>
                                From your wallet: <span style={{ fontFamily: 'monospace', color: accentColor }}>{identity.getPrincipal().toText()}</span>
                            </div>
                        )}

                        {/* Withdraw: show destination info */}
                        {activeOp === 'withdraw' && identity && (
                            <div style={{ marginTop: '6px', fontSize: '0.72rem', color: theme.colors.secondaryText }}>
                                Destination: <span style={{ fontFamily: 'monospace', color: accentColor }}>{identity.getPrincipal().toText()}</span>
                            </div>
                        )}

                        {/* Execute button */}
                        <div style={{ marginTop: '10px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <button onClick={handleExecuteOp} disabled={opExecuting || !opToken || !opAmount || (activeOp === 'deposit' && !opTargetSubaccount) || (activeOp === 'send' && !opDestination)}
                                style={{
                                    ...btnStyle, padding: '6px 14px', fontWeight: '600',
                                    opacity: (opExecuting || !opToken || !opAmount) ? 0.5 : 1,
                                    background: `${accentColor}15`, borderColor: accentColor,
                                }}>
                                {opExecuting ? 'Executing...' : (
                                    activeOp === 'fund' ? 'Fund' :
                                    activeOp === 'withdraw' ? 'Withdraw' :
                                    activeOp === 'deposit' ? 'Transfer' :
                                    'Send'
                                )}
                            </button>
                            <button onClick={() => setActiveOp(null)} style={{ ...btnStyle, color: theme.colors.mutedText, borderColor: borderColor }}>
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {/* Rename / Delete for non-main subaccounts */}
                {selectedAccount !== 'main' && (
                    <div style={{ marginTop: '10px', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {renamingId === selectedAccount ? (
                            <>
                                <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="New name..." style={inputStyle} autoFocus
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleRename(selectedAccount); if (e.key === 'Escape') setRenamingId(null); }} />
                                <button onClick={() => handleRename(selectedAccount)} style={btnStyle}><FaSave style={{ fontSize: '0.65rem', marginRight: '3px' }} />Save</button>
                                <button onClick={() => setRenamingId(null)} style={btnStyle}><FaTimes style={{ fontSize: '0.65rem' }} /></button>
                            </>
                        ) : (
                            <>
                                <button onClick={() => { setRenamingId(selectedAccount); setRenameValue(subaccounts.find(s => String(Number(s.number)) === selectedAccount)?.name || ''); }} style={btnStyle}>
                                    <FaEdit style={{ fontSize: '0.6rem', marginRight: '3px' }} />Rename
                                </button>
                                <button onClick={() => { if (confirm(`Delete subaccount #${selectedAccount}?`)) handleDelete(Number(selectedAccount)); }} style={dangerBtn}>
                                    <FaTrash style={{ fontSize: '0.6rem', marginRight: '3px' }} />Delete
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* ── Create New Subaccount ── */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="New subaccount name..."
                    style={{ ...inputStyle, flex: 1 }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                />
                <button onClick={handleCreate} disabled={creating || !newName.trim()} style={{ ...btnStyle, opacity: creating || !newName.trim() ? 0.5 : 1 }}>
                    <FaPlus style={{ fontSize: '0.65rem', marginRight: '3px' }} />{creating ? 'Creating...' : 'Create Subaccount'}
                </button>
            </div>
        </div>
        </DndProvider>
    );
}

// ============================================
// DEX Settings Panel (for the Info tab)
// ============================================
function DexSettingsPanel({ canisterId, createBotActor, identity }) {
    const { theme } = useTheme();
    const [dexes, setDexes] = useState(null);
    const [toggling, setToggling] = useState(null); // dexId currently being toggled
    const [error, setError] = useState('');
    const actorRef = useRef(null);

    const getActor = useCallback(async () => {
        if (actorRef.current) return actorRef.current;
        const { HttpAgent } = await import('@dfinity/agent');
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
        const agent = HttpAgent.createSync({ identity, host });
        if (isLocal) await agent.fetchRootKey();
        actorRef.current = createBotActor(canisterId, { agent });
        return actorRef.current;
    }, [canisterId, identity, createBotActor]);

    const loadDexes = useCallback(async () => {
        try {
            const bot = await getActor();
            const list = await bot.getSupportedDexes();
            setDexes(list);
        } catch (e) { setError('Failed to load DEX settings: ' + e.message); }
    }, [getActor]);

    useEffect(() => { loadDexes(); }, [loadDexes]);

    const handleToggle = async (dexId, currentEnabled) => {
        setToggling(dexId);
        setError('');
        try {
            const bot = await getActor();
            await bot.setDexEnabled(dexId, !currentEnabled);
            await loadDexes();
        } catch (e) { setError('Failed to toggle DEX: ' + e.message); }
        finally { setToggling(null); }
    };

    if (!dexes) return null;

    const enabledCount = dexes.filter(d => d.enabled).length;

    return (
        <div style={{ marginTop: '16px', padding: '14px', background: theme.colors.cardGradient, borderRadius: '10px', border: `1px solid ${theme.colors.border}` }}>
            <div style={{ fontSize: '0.85rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '10px' }}>
                DEX Configuration
            </div>
            <p style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, margin: '0 0 10px 0', lineHeight: '1.4' }}>
                Enable or disable DEXes for trading. At least one DEX must remain active.
            </p>
            {error && <div style={{ padding: '6px 10px', background: '#ef444415', border: '1px solid #ef444430', borderRadius: '6px', color: '#ef4444', fontSize: '0.75rem', marginBottom: '8px' }}>{error}</div>}
            <div style={{ display: 'grid', gap: '8px' }}>
                {dexes.map(dex => {
                    const isOnly = dex.enabled && enabledCount <= 1;
                    return (
                        <div key={dex.id} style={{
                            display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px',
                            background: theme.colors.primaryBg, borderRadius: '8px',
                            border: `1px solid ${dex.enabled ? ACCENT + '40' : theme.colors.border}`,
                            opacity: toggling === Number(dex.id) ? 0.6 : 1,
                            transition: 'all 0.2s ease',
                        }}>
                            {/* Toggle switch */}
                            <button
                                onClick={() => handleToggle(Number(dex.id), dex.enabled)}
                                disabled={toggling != null}
                                title={isOnly ? 'Cannot disable the only active DEX' : (dex.enabled ? 'Disable' : 'Enable')}
                                style={{
                                    width: '40px', height: '22px', borderRadius: '11px', border: 'none', cursor: toggling != null ? 'wait' : 'pointer',
                                    background: dex.enabled ? ACCENT : theme.colors.border,
                                    position: 'relative', flexShrink: 0, transition: 'background 0.2s ease',
                                }}
                            >
                                <div style={{
                                    width: '18px', height: '18px', borderRadius: '50%', background: '#fff',
                                    position: 'absolute', top: '2px',
                                    left: dex.enabled ? '20px' : '2px',
                                    transition: 'left 0.2s ease',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                }} />
                            </button>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText }}>
                                    {dex.name}
                                    {isOnly && <span style={{ fontSize: '0.65rem', fontWeight: '400', color: theme.colors.mutedText, marginLeft: '6px' }}>(only active DEX)</span>}
                                </div>
                                <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginTop: '2px' }}>
                                    {dex.description}
                                </div>
                            </div>
                            <div style={{
                                fontSize: '0.7rem', fontWeight: '500', padding: '2px 8px', borderRadius: '4px',
                                background: dex.enabled ? '#22c55e15' : '#ef444415',
                                color: dex.enabled ? '#22c55e' : '#ef4444',
                            }}>
                                {dex.enabled ? 'Active' : 'Disabled'}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ============================================
// Performance Panel — Equity Curve + P&L Summary + Per-Token Flows
// ============================================
function PerformancePanel({ getReadyBotActor, theme, accentColor, choreStatuses }) {
    const [snapshots, setSnapshots] = useState([]);
    const [capitalFlows, setCapitalFlows] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [denomination, setDenomination] = useState('icp'); // 'icp' or 'usd'
    const [equityView, setEquityView] = useState('detailed'); // 'detailed' or 'daily'
    const [tokenRegistry, setTokenRegistry] = useState([]);
    const [lastKnownPrices, setLastKnownPrices] = useState([]);
    const [priceHistory, setPriceHistory] = useState([]);
    const [selectedPricepair, setSelectedPricePair] = useState(null);
    const [dailyPortfolioSummaries, setDailyPortfolioSummaries] = useState([]);
    const [dailyPriceCandles, setDailyPriceCandles] = useState([]);
    const [selectedPurse, setSelectedPurse] = useState('__account__'); // '__account__' = whole account
    const [enabledPurses, setEnabledPurses] = useState([]); // purse IDs with enabled purses
    const [purseAllocations, setPurseAllocations] = useState([]); // full allocation data per purse
    const [purseSnapshots, setPurseSnapshots] = useState([]);
    const [purseLoading, setPurseLoading] = useState(false);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const [snapResult, flows, registry, prices, history, dailyPortfolio, dailyPrices, purseAllocs] = await Promise.all([
                bot.getPortfolioSnapshots({ startId: [], limit: [500], tradeLogId: [], phase: [{ After: null }], fromTime: [], toTime: [] }),
                bot.getCapitalFlows(),
                bot.getTokenRegistry ? bot.getTokenRegistry() : Promise.resolve([]),
                bot.getLastKnownPrices ? bot.getLastKnownPrices() : Promise.resolve([]),
                bot.getPriceHistory ? bot.getPriceHistory({ pairKey: [], limit: [5000], offset: [] }) : Promise.resolve({ entries: [], totalCount: 0n }),
                bot.getDailyPortfolioSummaries ? bot.getDailyPortfolioSummaries({ fromDate: [], toDate: [], limit: [1000], offset: [] }) : Promise.resolve({ entries: [], totalCount: 0n }),
                bot.getDailyPriceCandles ? bot.getDailyPriceCandles({ pairKey: [], fromDate: [], toDate: [], limit: [1000], offset: [] }) : Promise.resolve({ entries: [], totalCount: 0n }),
                bot.getAllPurseAllocations ? bot.getAllPurseAllocations() : Promise.resolve([]),
            ]);
            setSnapshots(snapResult.entries);
            setCapitalFlows(flows);
            setTokenRegistry(registry);
            setLastKnownPrices(prices);
            setPriceHistory(history.entries);
            setDailyPortfolioSummaries(dailyPortfolio.entries || []);
            setDailyPriceCandles(dailyPrices.entries || []);
            const allocs = (purseAllocs || []).filter(p => p.enabled);
            setEnabledPurses(allocs.map(p => p.instanceId));
            setPurseAllocations(allocs);
        } catch (err) {
            setError('Failed to load performance data: ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [getReadyBotActor]);

    // Load purse-specific snapshots when a purse is selected
    useEffect(() => {
        if (selectedPurse === '__account__') { setPurseSnapshots([]); return; }
        let cancelled = false;
        (async () => {
            setPurseLoading(true);
            try {
                const bot = await getReadyBotActor();
                if (!bot || cancelled) return;
                const result = await bot.getPursePortfolioSnapshots(selectedPurse, { startId: [], limit: [500], tradeLogId: [], phase: [], fromTime: [], toTime: [] });
                if (!cancelled) setPurseSnapshots(result.entries || []);
            } catch (e) { if (!cancelled) setPurseSnapshots([]); }
            finally { if (!cancelled) setPurseLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [selectedPurse, getReadyBotActor]);

    const purseLabel = useCallback((purseId) => {
        const cs = choreStatuses?.find(c => c.choreId === purseId);
        return cs?.instanceLabel || cs?.choreName || purseId;
    }, [choreStatuses]);

    useEffect(() => { loadData(); }, [loadData]);

    const optVal = (arr) => (arr?.length > 0 ? arr[0] : null);

    // Build chart data using carry-forward math.
    // - Account view: uses account snapshots; sparse trade snapshots carry
    //   forward values for tokens not present.
    // - Purse view with purse snapshots: uses dedicated purse snapshots.
    // - Purse view fallback: reconstructs from account snapshots by extracting
    //   only the purse's tokens, scaled by the purse/account balance ratio.
    const isPurse = selectedPurse !== '__account__';
    const hasPurseSnaps = isPurse && purseSnapshots.length > 0;

    const selectedPurseAlloc = React.useMemo(() => {
        if (!isPurse) return null;
        return purseAllocations.find(p => p.instanceId === selectedPurse) || null;
    }, [isPurse, selectedPurse, purseAllocations]);

    const chartData = React.useMemo(() => {
        const sourceSnaps = hasPurseSnaps ? purseSnapshots : snapshots;
        const afterSnaps = sourceSnaps
            .filter(s => Object.keys(s.phase || {})[0] === 'After')
            .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

        // For purse fallback: build a set of purse tokens and a ratio map
        // (purseBalance / accountBalance) to estimate the purse's share.
        let purseTokenSet = null;
        let purseBalanceMap = null;
        if (isPurse && !hasPurseSnaps && selectedPurseAlloc?.balances?.length) {
            purseTokenSet = new Set();
            purseBalanceMap = new Map();
            for (const b of selectedPurseAlloc.balances) {
                const key = b.token?.toText?.() || b.token?.toString?.() || '';
                if (key) {
                    purseTokenSet.add(key);
                    purseBalanceMap.set(key, Number(b.balance));
                }
            }
        }

        const lastKnownIcp = new Map();
        const lastKnownUsd = new Map();

        return afterSnaps.map(s => {
            const tokens = s.tokens || [];
            for (const t of tokens) {
                const key = t.token?.toText?.() || t.token?.toString?.() || '';
                if (!key) continue;
                // In purse fallback, skip tokens not belonging to the purse
                if (purseTokenSet && !purseTokenSet.has(key)) continue;

                const vIcp = optVal(t.valueIcpE8s);
                const vUsd = optVal(t.valueUsdE8s);

                if (purseBalanceMap) {
                    // Scale by purse/account balance ratio
                    const accountBal = Number(t.balance);
                    const purseBal = purseBalanceMap.get(key) || 0;
                    const ratio = accountBal > 0 ? purseBal / accountBal : 0;
                    if (vIcp != null) lastKnownIcp.set(key, Number(vIcp) * ratio);
                    if (vUsd != null) lastKnownUsd.set(key, Number(vUsd) * ratio);
                } else {
                    if (vIcp != null) lastKnownIcp.set(key, Number(vIcp));
                    if (vUsd != null) lastKnownUsd.set(key, Number(vUsd));
                }
            }
            let totalIcp = 0;
            let totalUsd = 0;
            for (const v of lastKnownIcp.values()) totalIcp += v;
            for (const v of lastKnownUsd.values()) totalUsd += v;

            const ts = Number(s.timestamp) / 1_000_000;
            return {
                time: ts,
                label: new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
                icp: totalIcp > 0 ? totalIcp / 1e8 : null,
                usd: totalUsd > 0 ? totalUsd / 1e8 : null,
            };
        }).filter(d => (denomination === 'icp' ? d.icp != null : d.usd != null));
    }, [snapshots, purseSnapshots, hasPurseSnaps, isPurse, selectedPurseAlloc, denomination]);

    // Build daily OHLC chart data for portfolio value
    const dailyChartData = React.useMemo(() => {
        return dailyPortfolioSummaries
            .sort((a, b) => Number(a.date) - Number(b.date))
            .map(s => {
                const ts = Number(s.date) / 1_000_000; // ns -> ms
                const scale = 1e8;
                const o = denomination === 'icp' ? Number(s.openValueIcpE8s) / scale : Number(s.openValueUsdE8s) / scale;
                const h = denomination === 'icp' ? Number(s.highValueIcpE8s) / scale : Number(s.highValueUsdE8s) / scale;
                const l = denomination === 'icp' ? Number(s.lowValueIcpE8s) / scale : Number(s.lowValueUsdE8s) / scale;
                const c = denomination === 'icp' ? Number(s.closeValueIcpE8s) / scale : Number(s.closeValueUsdE8s) / scale;
                return {
                    time: ts,
                    label: new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                    open: o, high: h, low: l, close: c,
                    range: [l, h],
                    snapshotCount: Number(s.snapshotCount),
                };
            })
            .filter(d => d.close > 0);
    }, [dailyPortfolioSummaries, denomination]);

    // Build daily OHLC data for price candles
    const dailyPriceCandleData = React.useMemo(() => {
        const map = new Map();
        for (const c of dailyPriceCandles) {
            if (!map.has(c.pairKey)) map.set(c.pairKey, []);
            map.get(c.pairKey).push(c);
        }
        // Sort each pair by date
        for (const [, entries] of map) entries.sort((a, b) => Number(a.date) - Number(b.date));
        return map;
    }, [dailyPriceCandles]);

    // Latest portfolio value
    const latestSnap = chartData.length > 0 ? chartData[chartData.length - 1] : null;
    const latestValueIcp = latestSnap?.icp;
    const latestValueUsd = latestSnap?.usd;

    // Capital deployed
    const capitalIcp = capitalFlows ? Number(capitalFlows.capitalDeployedIcpE8s) / 1e8 : null;
    const capitalUsd = capitalFlows ? Number(capitalFlows.capitalDeployedUsdE8s) / 1e8 : null;

    // Trading P&L
    const pnlIcp = (latestValueIcp != null && capitalIcp != null) ? latestValueIcp - capitalIcp : null;
    const pnlUsd = (latestValueUsd != null && capitalUsd != null) ? latestValueUsd - capitalUsd : null;
    const pnlPctIcp = (pnlIcp != null && capitalIcp && capitalIcp !== 0) ? (pnlIcp / Math.abs(capitalIcp)) * 100 : null;
    const pnlPctUsd = (pnlUsd != null && capitalUsd && capitalUsd !== 0) ? (pnlUsd / Math.abs(capitalUsd)) * 100 : null;

    // Build a principal→symbol map from token registry + snapshot token data
    const symbolMap = React.useMemo(() => {
        const map = {};
        const allPrincipals = new Set();
        for (const entry of tokenRegistry) {
            const key = entry.ledgerCanisterId?.toText?.() || entry.ledgerCanisterId?.toString?.() || '';
            if (!key) continue;
            allPrincipals.add(key);
            if (!_isPlaceholderSymbol(entry.symbol)) map[key] = entry.symbol;
        }
        for (const snap of snapshots) {
            for (const tok of (snap.tokens || [])) {
                const key = tok.token?.toText?.() || tok.token?.toString?.() || '';
                if (!key) continue;
                allPrincipals.add(key);
                if (!_isPlaceholderSymbol(tok.symbol) && !map[key]) map[key] = tok.symbol;
            }
        }
        for (const [, cached] of lastKnownPrices) {
            const inp = cached.inputToken?.toText?.() || cached.inputToken?.toString?.() || '';
            const out = cached.outputToken?.toText?.() || cached.outputToken?.toString?.() || '';
            if (inp) allPrincipals.add(inp);
            if (out) allPrincipals.add(out);
        }
        for (const p of allPrincipals) {
            if (!map[p]) {
                const cached = getTokenMetadataSync(p);
                if (cached?.symbol && !_isPlaceholderSymbol(cached.symbol)) map[p] = cached.symbol;
            }
        }
        return map;
    }, [tokenRegistry, snapshots, lastKnownPrices]);

    // Resolve token symbol from registry, snapshot data, or shared cache
    const tokenSymbol = (principalText) => {
        if (symbolMap[principalText]) return symbolMap[principalText];
        const cached = getTokenMetadataSync(principalText);
        return cached?.symbol || principalText.slice(0, 10) + '...';
    };
    const tokenDecimals = (principalText) => {
        const entry = tokenRegistry.find(t => (t.ledgerCanisterId?.toText?.() || t.ledgerCanisterId?.toString?.() || '') === principalText);
        if (entry?.decimals != null) return Number(entry.decimals);
        const cached = getTokenMetadataSync(principalText);
        return cached?.decimals ?? 8;
    };

    const formatNum = (val, denom) => {
        if (val == null) return '—';
        const prefix = val >= 0 ? '' : '';
        if (denom === 'usd') return prefix + '$' + Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return prefix + Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + ' ICP';
    };

    const pnlColor = (val) => val == null ? theme.colors.secondaryText : val >= 0 ? '#10b981' : '#ef4444';

    const cardStyle = {
        background: theme.colors.surface, border: `1px solid ${theme.colors.border}`,
        borderRadius: '10px', padding: '16px', marginBottom: '12px',
    };

    if (loading) return <div style={{ padding: '20px', color: theme.colors.secondaryText, textAlign: 'center' }}>Loading performance data...</div>;
    if (error) return <div style={{ padding: '20px', color: '#ef4444' }}>{error}</div>;

    const isPurseView = isPurse;

    return (
        <div>
            {/* Scope selector: whole account vs purse */}
            {enabledPurses.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.78rem', color: theme.colors.secondaryText, fontWeight: 500 }}>Scope:</span>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        <button onClick={() => setSelectedPurse('__account__')} style={{
                            padding: '4px 12px', fontSize: '0.75rem', fontWeight: '500', cursor: 'pointer',
                            borderRadius: '5px', border: `1px solid ${!isPurseView ? accentColor : theme.colors.border}`,
                            background: !isPurseView ? accentColor + '22' : 'transparent',
                            color: !isPurseView ? accentColor : theme.colors.secondaryText,
                        }}>Whole Account</button>
                        {enabledPurses.map(pid => (
                            <button key={pid} onClick={() => { setSelectedPurse(pid); setEquityView('detailed'); }} style={{
                                padding: '4px 12px', fontSize: '0.75rem', fontWeight: '500', cursor: 'pointer',
                                borderRadius: '5px', border: `1px solid ${selectedPurse === pid ? accentColor : theme.colors.border}`,
                                background: selectedPurse === pid ? accentColor + '22' : 'transparent',
                                color: selectedPurse === pid ? accentColor : theme.colors.secondaryText,
                            }}>{purseLabel(pid)}</button>
                        ))}
                    </div>
                    {purseLoading && <span style={{ fontSize: '0.72rem', color: theme.colors.secondaryText }}>Loading...</span>}
                </div>
            )}

            {/* P&L Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                {/* Portfolio Value */}
                <div style={cardStyle}>
                    <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>{isPurseView ? 'Purse Value' : 'Portfolio Value'}</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: '700', color: theme.colors.text }}>
                        {formatNum(latestValueIcp, 'icp')}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText }}>
                        {formatNum(latestValueUsd, 'usd')}
                    </div>
                </div>
                {!isPurseView ? <>
                    {/* Net Capital Deployed */}
                    <div style={cardStyle}>
                        <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Net Capital Deployed</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: '700', color: theme.colors.text }}>
                            {formatNum(capitalIcp, 'icp')}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText }}>
                            {formatNum(capitalUsd, 'usd')}
                        </div>
                    </div>
                    {/* Trading P&L */}
                    <div style={cardStyle}>
                        <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Trading P&L</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: '700', color: pnlColor(pnlIcp) }}>
                            {pnlIcp != null ? (pnlIcp >= 0 ? '+' : '-') : ''}{formatNum(pnlIcp, 'icp')}
                            {pnlPctIcp != null && <span style={{ fontSize: '0.8rem', marginLeft: '6px' }}>({pnlPctIcp >= 0 ? '+' : ''}{pnlPctIcp.toFixed(1)}%)</span>}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: pnlColor(pnlUsd) }}>
                            {pnlUsd != null ? (pnlUsd >= 0 ? '+' : '-') : ''}{formatNum(pnlUsd, 'usd')}
                            {pnlPctUsd != null && <span style={{ fontSize: '0.8rem', marginLeft: '6px' }}>({pnlPctUsd >= 0 ? '+' : ''}{pnlPctUsd.toFixed(1)}%)</span>}
                        </div>
                    </div>
                </> : <>
                    {/* Purse Change (first vs latest snapshot) */}
                    {(() => {
                        const first = chartData.length > 0 ? chartData[0] : null;
                        const last = chartData.length > 1 ? chartData[chartData.length - 1] : null;
                        const changeIcp = (first?.icp != null && last?.icp != null) ? last.icp - first.icp : null;
                        const changeUsd = (first?.usd != null && last?.usd != null) ? last.usd - first.usd : null;
                        const pctIcp = (changeIcp != null && first.icp && first.icp !== 0) ? (changeIcp / Math.abs(first.icp)) * 100 : null;
                        const pctUsd = (changeUsd != null && first.usd && first.usd !== 0) ? (changeUsd / Math.abs(first.usd)) * 100 : null;
                        return <>
                            <div style={cardStyle}>
                                <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>First Snapshot Value</div>
                                <div style={{ fontSize: '1.2rem', fontWeight: '700', color: theme.colors.text }}>{first ? formatNum(first.icp, 'icp') : '—'}</div>
                                <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText }}>{first ? formatNum(first.usd, 'usd') : '—'}</div>
                            </div>
                            <div style={cardStyle}>
                                <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Purse Change</div>
                                <div style={{ fontSize: '1.2rem', fontWeight: '700', color: pnlColor(changeIcp) }}>
                                    {changeIcp != null ? (changeIcp >= 0 ? '+' : '-') : ''}{formatNum(changeIcp, 'icp')}
                                    {pctIcp != null && <span style={{ fontSize: '0.8rem', marginLeft: '6px' }}>({pctIcp >= 0 ? '+' : ''}{pctIcp.toFixed(1)}%)</span>}
                                </div>
                                <div style={{ fontSize: '0.85rem', color: pnlColor(changeUsd) }}>
                                    {changeUsd != null ? (changeUsd >= 0 ? '+' : '-') : ''}{formatNum(changeUsd, 'usd')}
                                    {pctUsd != null && <span style={{ fontSize: '0.8rem', marginLeft: '6px' }}>({pctUsd >= 0 ? '+' : ''}{pctUsd.toFixed(1)}%)</span>}
                                </div>
                            </div>
                        </>;
                    })()}
                </>}
            </div>

            {/* Equity Curve Chart */}
            <div style={{ ...cardStyle, padding: '16px 12px 8px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', paddingLeft: '16px', flexWrap: 'wrap', gap: '8px' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: '600', color: theme.colors.text }}>
                        {isPurseView ? 'Purse Value' : 'Equity Curve'}
                        {isPurseView && !hasPurseSnaps && chartData.length > 0 && (
                            <span style={{ fontSize: '0.68rem', fontWeight: '400', color: theme.colors.secondaryText, marginLeft: '8px' }}>(estimated from account data)</span>
                        )}
                    </span>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {(isPurseView ? ['detailed'] : ['detailed', 'daily']).map(v => (
                            <button key={v} onClick={() => setEquityView(v)} style={{
                                padding: '3px 10px', fontSize: '0.72rem', fontWeight: '500', cursor: 'pointer',
                                borderRadius: '4px', border: `1px solid ${equityView === v ? accentColor : theme.colors.border}`,
                                background: equityView === v ? accentColor + '22' : 'transparent',
                                color: equityView === v ? accentColor : theme.colors.secondaryText,
                            }}>{v === 'detailed' ? 'Detailed' : 'Daily OHLC'}</button>
                        ))}
                        <span style={{ width: '1px', height: '16px', background: theme.colors.border, margin: '0 2px' }} />
                        {['icp', 'usd'].map(d => (
                            <button key={d} onClick={() => setDenomination(d)} style={{
                                padding: '3px 10px', fontSize: '0.72rem', fontWeight: '500', cursor: 'pointer',
                                borderRadius: '4px', border: `1px solid ${denomination === d ? accentColor : theme.colors.border}`,
                                background: denomination === d ? accentColor + '22' : 'transparent',
                                color: denomination === d ? accentColor : theme.colors.secondaryText,
                            }}>{d.toUpperCase()}</button>
                        ))}
                    </div>
                </div>
                {equityView === 'detailed' ? (
                    chartData.length > 1 ? (
                        <ResponsiveContainer width="100%" height={280}>
                            <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                <defs>
                                    <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={accentColor} stopOpacity={0.3} />
                                        <stop offset="95%" stopColor={accentColor} stopOpacity={0.02} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke={theme.colors.border} opacity={0.5} />
                                <XAxis dataKey="label" tick={{ fontSize: 11, fill: theme.colors.secondaryText }} tickLine={false} axisLine={{ stroke: theme.colors.border }} />
                                <YAxis tick={{ fontSize: 11, fill: theme.colors.secondaryText }} tickLine={false} axisLine={false}
                                    tickFormatter={v => denomination === 'usd' ? '$' + v.toLocaleString() : v.toLocaleString()} domain={['auto', 'auto']} />
                                <Tooltip
                                    contentStyle={{ background: theme.colors.surface, border: `1px solid ${theme.colors.border}`, borderRadius: '8px', fontSize: '0.82rem' }}
                                    labelStyle={{ color: theme.colors.text }}
                                    formatter={(v) => [denomination === 'usd' ? '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 }) : Number(v).toLocaleString(undefined, { minimumFractionDigits: 4 }) + ' ICP', isPurseView ? 'Purse Value' : 'Portfolio Value']}
                                />
                                <Area type="monotone" dataKey={denomination} stroke={accentColor} fill="url(#equityGrad)" strokeWidth={2} dot={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ textAlign: 'center', padding: '40px 20px', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>
                            {chartData.length === 0
                                ? (isPurseView ? 'No data yet. Purse performance will appear after the chore runs trades or snapshots.' : 'No snapshot data yet. Equity curve will appear after the bot runs and takes portfolio snapshots.')
                                : 'At least 2 snapshots are needed to draw the equity curve.'}
                        </div>
                    )
                ) : (
                    dailyChartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={280}>
                            <ComposedChart data={dailyChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke={theme.colors.border} opacity={0.5} />
                                <XAxis dataKey="label" tick={{ fontSize: 11, fill: theme.colors.secondaryText }} tickLine={false} axisLine={{ stroke: theme.colors.border }} />
                                <YAxis tick={{ fontSize: 11, fill: theme.colors.secondaryText }} tickLine={false} axisLine={false}
                                    tickFormatter={v => denomination === 'usd' ? '$' + v.toLocaleString() : v.toLocaleString()} domain={['auto', 'auto']} />
                                <Tooltip
                                    contentStyle={{ background: theme.colors.surface, border: `1px solid ${theme.colors.border}`, borderRadius: '8px', fontSize: '0.8rem' }}
                                    labelStyle={{ color: theme.colors.text }}
                                    formatter={(v, name) => {
                                        const fmt = denomination === 'usd'
                                            ? '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })
                                            : Number(v).toLocaleString(undefined, { minimumFractionDigits: 4 }) + ' ICP';
                                        const labels = { open: 'Open', high: 'High', low: 'Low', close: 'Close' };
                                        return [fmt, labels[name] || name];
                                    }}
                                />
                                <Bar dataKey="range" fill={accentColor + '18'} stroke={accentColor + '40'} barSize={12} radius={[2, 2, 2, 2]} isAnimationActive={false} />
                                <Line type="monotone" dataKey="open" stroke="#3b82f6" strokeWidth={1.5} dot={{ r: 2, fill: '#3b82f6' }} name="open" />
                                <Line type="monotone" dataKey="close" stroke={accentColor} strokeWidth={2} dot={{ r: 3, fill: accentColor }} name="close" />
                            </ComposedChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ textAlign: 'center', padding: '40px 20px', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>
                            No daily summaries yet. Daily OHLC data will accumulate as the bot takes snapshots over time.
                        </div>
                    )
                )}
            </div>

            {/* Purse Token Holdings (from latest purse snapshot, or from current allocation as fallback) */}
            {isPurseView && (() => {
                const latestPurseSnap = purseSnapshots.length > 0
                    ? [...purseSnapshots].sort((a, b) => Number(b.timestamp) - Number(a.timestamp))[0]
                    : null;
                // Fallback: build token rows from current purse allocation + token registry info
                let tokenRows = [];
                let sourceLabel = null;
                if (latestPurseSnap?.tokens?.length) {
                    tokenRows = latestPurseSnap.tokens;
                    sourceLabel = `Snapshot: ${new Date(Number(latestPurseSnap.timestamp) / 1_000_000).toLocaleString()}`;
                } else if (selectedPurseAlloc?.balances?.length) {
                    tokenRows = selectedPurseAlloc.balances.map(b => {
                        const key = b.token?.toText?.() || b.token?.toString?.() || '';
                        const regEntry = tokenRegistry.find(e => {
                            const ek = e.ledgerCanisterId?.toText?.() || e.ledgerCanisterId?.toString?.() || '';
                            return ek === key;
                        });
                        return {
                            token: b.token,
                            symbol: regEntry?.symbol || '?',
                            decimals: regEntry?.decimals ?? 8,
                            balance: b.balance,
                            valueIcpE8s: [],
                            valueUsdE8s: [],
                        };
                    });
                    sourceLabel = 'Current purse balances';
                }
                if (tokenRows.length === 0) return null;
                return (
                    <div style={cardStyle}>
                        <div style={{ fontSize: '0.85rem', fontWeight: '600', color: theme.colors.text, marginBottom: '10px' }}>Purse Token Holdings</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                            <thead>
                                <tr style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
                                    <th style={{ textAlign: 'left', padding: '6px 8px', color: theme.colors.secondaryText, fontWeight: '500' }}>Token</th>
                                    <th style={{ textAlign: 'right', padding: '6px 8px', color: theme.colors.secondaryText, fontWeight: '500' }}>Balance</th>
                                    <th style={{ textAlign: 'right', padding: '6px 8px', color: theme.colors.secondaryText, fontWeight: '500' }}>Value (ICP)</th>
                                    <th style={{ textAlign: 'right', padding: '6px 8px', color: theme.colors.secondaryText, fontWeight: '500' }}>Value (USD)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tokenRows.map((tok, i) => {
                                    const dec = Number(tok.decimals || 8);
                                    const bal = Number(tok.balance) / (10 ** dec);
                                    const vIcp = tok.valueIcpE8s?.length > 0 ? Number(tok.valueIcpE8s[0]) / 1e8 : null;
                                    const vUsd = tok.valueUsdE8s?.length > 0 ? Number(tok.valueUsdE8s[0]) / 1e8 : null;
                                    return (
                                        <tr key={i} style={{ borderBottom: `1px solid ${theme.colors.border}22` }}>
                                            <td style={{ padding: '6px 8px', color: theme.colors.text, fontWeight: '500' }}>{tok.symbol || '?'}</td>
                                            <td style={{ padding: '6px 8px', textAlign: 'right', color: theme.colors.text, fontFamily: 'monospace' }}>
                                                {bal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: Math.min(dec, 6) })}
                                            </td>
                                            <td style={{ padding: '6px 8px', textAlign: 'right', color: theme.colors.text }}>
                                                {vIcp != null ? vIcp.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : '—'}
                                            </td>
                                            <td style={{ padding: '6px 8px', textAlign: 'right', color: theme.colors.text }}>
                                                {vUsd != null ? '$' + vUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {sourceLabel && (
                            <div style={{ fontSize: '0.68rem', color: theme.colors.secondaryText, marginTop: '6px', textAlign: 'right' }}>
                                {sourceLabel}
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* Per-Token Capital Flows */}
            {!isPurseView && capitalFlows?.perToken?.length > 0 && (
                <div style={cardStyle}>
                    <div style={{ fontSize: '0.85rem', fontWeight: '600', color: theme.colors.text, marginBottom: '10px' }}>Capital Flows by Token</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                        <thead>
                            <tr style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
                                <th style={{ textAlign: 'left', padding: '6px 8px', color: theme.colors.secondaryText, fontWeight: '500' }}>Token</th>
                                <th style={{ textAlign: 'right', padding: '6px 8px', color: '#10b981', fontWeight: '500' }}>Total Inflow</th>
                                <th style={{ textAlign: 'right', padding: '6px 8px', color: '#ef4444', fontWeight: '500' }}>Total Outflow</th>
                                <th style={{ textAlign: 'right', padding: '6px 8px', color: theme.colors.secondaryText, fontWeight: '500' }}>Net</th>
                            </tr>
                        </thead>
                        <tbody>
                            {capitalFlows.perToken.map(([tokenPrincipal, flows]) => {
                                const dec = tokenDecimals(tokenPrincipal);
                                const infl = Number(flows.totalInflowNative);
                                const outfl = Number(flows.totalOutflowNative);
                                const net = infl - outfl;
                                const fmt = (v) => formatTokenAmount(v, dec);
                                return (
                                    <tr key={tokenPrincipal} style={{ borderBottom: `1px solid ${theme.colors.border}22` }}>
                                        <td style={{ padding: '6px 8px', color: theme.colors.text }}>
                                            <span style={{ fontWeight: '500' }}>{tokenSymbol(tokenPrincipal)}</span>
                                        </td>
                                        <td style={{ padding: '6px 8px', textAlign: 'right', color: '#10b981' }}>+{fmt(infl)}</td>
                                        <td style={{ padding: '6px 8px', textAlign: 'right', color: '#ef4444' }}>-{fmt(outfl)}</td>
                                        <td style={{ padding: '6px 8px', textAlign: 'right', color: net >= 0 ? '#10b981' : '#ef4444', fontWeight: '500' }}>
                                            {net >= 0 ? '+' : '-'}{fmt(Math.abs(net))}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Price History Section */}
            <PriceHistorySection
                lastKnownPrices={lastKnownPrices}
                priceHistory={priceHistory}
                dailyPriceCandleData={dailyPriceCandleData}
                tokenRegistry={tokenRegistry}
                symbolMap={symbolMap}
                selectedPricepair={selectedPricepair}
                setSelectedPricePair={setSelectedPricePair}
                theme={theme}
                accentColor={accentColor}
                cardStyle={cardStyle}
            />
        </div>
    );
}

function PriceHistorySection({ lastKnownPrices, priceHistory, dailyPriceCandleData, tokenRegistry, symbolMap, selectedPricepair, setSelectedPricePair, theme, accentColor, cardStyle }) {
    const [priceView, setPriceView] = useState('detailed'); // 'detailed' or 'daily'
    const sym = (principalText) => {
        if (symbolMap && symbolMap[principalText]) return symbolMap[principalText];
        const entry = tokenRegistry.find(t => (t.ledgerCanisterId?.toText?.() || t.ledgerCanisterId?.toString?.() || '') === principalText);
        if (entry?.symbol) return entry.symbol;
        const cached = getTokenMetadataSync(principalText);
        return cached?.symbol || principalText.slice(0, 8) + '..';
    };

    // Build pair options from lastKnownPrices, excluding self-pairs (e.g. SNEED/SNEED)
    const pairOptions = React.useMemo(() => {
        return lastKnownPrices.map(([key, cached]) => {
            const inpText = cached.inputToken?.toText?.() || cached.inputToken?.toString?.() || '';
            const outText = cached.outputToken?.toText?.() || cached.outputToken?.toString?.() || '';
            return { key, inputSymbol: sym(inpText), outputSymbol: sym(outText), inputPrincipal: inpText, outputPrincipal: outText, cached };
        }).filter(p => p.inputPrincipal !== p.outputPrincipal)
          .sort((a, b) => (a.inputSymbol + a.outputSymbol).localeCompare(b.inputSymbol + b.outputSymbol));
    }, [lastKnownPrices, tokenRegistry, symbolMap]);

    // Group price history by pair key
    const historyByPair = React.useMemo(() => {
        const map = new Map();
        for (const entry of priceHistory) {
            const inpText = entry.inputToken?.toText?.() || entry.inputToken?.toString?.() || '';
            const outText = entry.outputToken?.toText?.() || entry.outputToken?.toString?.() || '';
            // Normalize key: sorted lexicographically
            const key = inpText < outText ? inpText + ':' + outText : outText + ':' + inpText;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(entry);
        }
        // Sort each pair's entries by time
        for (const [, entries] of map) entries.sort((a, b) => Number(a.fetchedAt) - Number(b.fetchedAt));
        return map;
    }, [priceHistory]);

    // Default to first pair if none selected
    const activePair = selectedPricepair || (pairOptions.length > 0 ? pairOptions[0].key : null);

    // Get the pair info for display
    const activePairInfo = pairOptions.find(p => p.key === activePair);

    // Build chart data for the selected pair.
    // Since both directions (A→B and B→A) share the same normalized key,
    // we pick a canonical direction from the active pair info and invert
    // entries that were stored in the opposite direction.
    const chartData = React.useMemo(() => {
        if (!activePair || !activePairInfo) return [];
        const canonicalInput = activePairInfo.inputPrincipal;
        const entries = historyByPair.get(activePair) || [];
        const currentEntry = lastKnownPrices.find(([k]) => k === activePair);
        const allEntries = currentEntry ? [...entries, currentEntry[1]] : entries;

        return allEntries.map(entry => {
            const ts = Number(entry.fetchedAt) / 1_000_000; // ns -> ms
            const q = entry.quote;
            const inputAmt = Number(q.inputAmount);
            const outputAmt = Number(q.expectedOutput);
            const entryInput = entry.inputToken?.toText?.() || entry.inputToken?.toString?.() || '';
            const sameDirection = entryInput === canonicalInput;
            const price = sameDirection
                ? (inputAmt > 0 ? outputAmt / inputAmt : 0)
                : (outputAmt > 0 ? inputAmt / outputAmt : 0);
            const spotPrice = Number(q.spotPriceE8s) / 1e8;
            return {
                time: ts,
                label: new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
                price: price,
                spotPrice: spotPrice > 0 ? (sameDirection ? spotPrice : (spotPrice > 0 ? 1 / spotPrice : null)) : null,
            };
        });
    }, [activePair, activePairInfo, historyByPair, lastKnownPrices]);

    // Overall price stats
    const priceStats = React.useMemo(() => {
        if (chartData.length === 0) return null;
        const prices = chartData.map(d => d.price).filter(p => p > 0);
        if (prices.length === 0) return null;
        const current = prices[prices.length - 1];
        const first = prices[0];
        const high = Math.max(...prices);
        const low = Math.min(...prices);
        const change = first > 0 ? ((current - first) / first) * 100 : 0;
        return { current, first, high, low, change, count: prices.length };
    }, [chartData]);

    // Build daily candle chart data for the selected pair
    const dailyCandleChartData = React.useMemo(() => {
        if (!activePair || !dailyPriceCandleData) return [];
        const entries = dailyPriceCandleData.get(activePair) || [];
        return entries.map(c => {
            const ts = Number(c.date) / 1_000_000;
            const o = Number(c.openE8s) / 1e8;
            const h = Number(c.highE8s) / 1e8;
            const l = Number(c.lowE8s) / 1e8;
            const cl = Number(c.closeE8s) / 1e8;
            return {
                time: ts,
                label: new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                open: o, high: h, low: l, close: cl,
                range: [l, h],
                quoteCount: Number(c.quoteCount),
            };
        }).filter(d => d.close > 0);
    }, [activePair, dailyPriceCandleData]);

    if (lastKnownPrices.length === 0 && priceHistory.length === 0) {
        return (
            <div style={{ ...cardStyle, textAlign: 'center', padding: '20px', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>
                No price data yet. Price history will populate after the bot fetches quotes during chore runs.
            </div>
        );
    }

    return (
        <div>
            {/* Current Prices Overview */}
            <div style={cardStyle}>
                <div style={{ fontSize: '0.85rem', fontWeight: '600', color: theme.colors.text, marginBottom: '10px' }}>Last Known Prices</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: activePair ? '0' : undefined }}>
                    {pairOptions.map(p => {
                        const q = p.cached.quote;
                        const inputAmt = Number(q.inputAmount);
                        const outputAmt = Number(q.expectedOutput);
                        const rate = inputAmt > 0 ? (outputAmt / inputAmt) : 0;
                        const age = (Date.now() - Number(p.cached.fetchedAt) / 1_000_000) / 1000;
                        const ageLabel = age < 60 ? `${Math.round(age)}s` : age < 3600 ? `${Math.round(age / 60)}m` : `${(age / 3600).toFixed(1)}h`;
                        const isActive = activePair === p.key;
                        return (
                            <button key={p.key} onClick={() => setSelectedPricePair(p.key)} style={{
                                padding: '6px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.78rem',
                                border: `1px solid ${isActive ? accentColor : theme.colors.border}`,
                                background: isActive ? accentColor + '12' : theme.colors.primaryBg,
                                color: theme.colors.text, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px',
                                minWidth: '120px',
                            }}>
                                <span style={{ fontWeight: '600', fontSize: '0.75rem' }}>{p.inputSymbol}/{p.outputSymbol}</span>
                                <span style={{ fontSize: '0.82rem', fontWeight: '700', color: accentColor }}>
                                    {rate > 0.001 ? rate.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 }) : rate.toExponential(3)}
                                </span>
                                <span style={{ fontSize: '0.68rem', color: theme.colors.mutedText }}>{ageLabel} ago</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Price Chart for Selected Pair */}
            {activePair && (
                <div style={{ ...cardStyle, padding: '16px 12px 8px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', paddingLeft: '16px', flexWrap: 'wrap', gap: '6px' }}>
                        <div>
                            <span style={{ fontSize: '0.85rem', fontWeight: '600', color: theme.colors.text }}>
                                {activePairInfo ? `${activePairInfo.inputSymbol} / ${activePairInfo.outputSymbol}` : 'Price History'}
                            </span>
                            {priceStats && priceView === 'detailed' && (
                                <span style={{ fontSize: '0.78rem', marginLeft: '12px', color: priceStats.change >= 0 ? '#10b981' : '#ef4444', fontWeight: '500' }}>
                                    {priceStats.change >= 0 ? '+' : ''}{priceStats.change.toFixed(2)}%
                                </span>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            {['detailed', 'daily'].map(v => (
                                <button key={v} onClick={() => setPriceView(v)} style={{
                                    padding: '3px 8px', fontSize: '0.7rem', fontWeight: '500', cursor: 'pointer',
                                    borderRadius: '4px', border: `1px solid ${priceView === v ? '#3b82f6' : theme.colors.border}`,
                                    background: priceView === v ? '#3b82f622' : 'transparent',
                                    color: priceView === v ? '#3b82f6' : theme.colors.secondaryText,
                                }}>{v === 'detailed' ? 'Detailed' : 'Daily OHLC'}</button>
                            ))}
                            {priceView === 'detailed' && priceStats && (
                                <div style={{ display: 'flex', gap: '10px', fontSize: '0.7rem', color: theme.colors.secondaryText, marginLeft: '8px' }}>
                                    <span>H: <span style={{ color: '#10b981', fontWeight: '500' }}>{priceStats.high.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span></span>
                                    <span>L: <span style={{ color: '#ef4444', fontWeight: '500' }}>{priceStats.low.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span></span>
                                    <span>{priceStats.count} pts</span>
                                </div>
                            )}
                        </div>
                    </div>
                    {priceView === 'detailed' ? (
                        chartData.length > 1 ? (
                            <ResponsiveContainer width="100%" height={250}>
                                <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                    <defs>
                                        <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke={theme.colors.border} opacity={0.5} />
                                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: theme.colors.secondaryText }} tickLine={false} axisLine={{ stroke: theme.colors.border }} />
                                    <YAxis tick={{ fontSize: 10, fill: theme.colors.secondaryText }} tickLine={false} axisLine={false}
                                        domain={['auto', 'auto']}
                                        tickFormatter={v => v > 0.001 ? v.toLocaleString(undefined, { maximumFractionDigits: 4 }) : v.toExponential(2)} />
                                    <Tooltip
                                        contentStyle={{ background: theme.colors.surface, border: `1px solid ${theme.colors.border}`, borderRadius: '8px', fontSize: '0.8rem' }}
                                        labelStyle={{ color: theme.colors.text }}
                                        formatter={(v, name) => [
                                            Number(v) > 0.001
                                                ? Number(v).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 })
                                                : Number(v).toExponential(4),
                                            name === 'price' ? 'Quote Price' : 'Spot Price'
                                        ]}
                                    />
                                    <Area type="monotone" dataKey="price" stroke="#3b82f6" fill="url(#priceGrad)" strokeWidth={2} dot={false} name="price" />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '30px 20px', color: theme.colors.secondaryText, fontSize: '0.85rem', paddingLeft: '16px' }}>
                                {chartData.length === 0 ? 'No history for this pair yet.' : 'At least 2 data points are needed to draw a chart.'}
                            </div>
                        )
                    ) : (
                        dailyCandleChartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height={250}>
                                <ComposedChart data={dailyCandleChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={theme.colors.border} opacity={0.5} />
                                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: theme.colors.secondaryText }} tickLine={false} axisLine={{ stroke: theme.colors.border }} />
                                    <YAxis tick={{ fontSize: 10, fill: theme.colors.secondaryText }} tickLine={false} axisLine={false}
                                        domain={['auto', 'auto']}
                                        tickFormatter={v => v > 0.001 ? v.toLocaleString(undefined, { maximumFractionDigits: 4 }) : v.toExponential(2)} />
                                    <Tooltip
                                        contentStyle={{ background: theme.colors.surface, border: `1px solid ${theme.colors.border}`, borderRadius: '8px', fontSize: '0.8rem' }}
                                        labelStyle={{ color: theme.colors.text }}
                                        formatter={(v, name) => {
                                            const fmtV = Number(v) > 0.001
                                                ? Number(v).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 })
                                                : Number(v).toExponential(4);
                                            const labels = { open: 'Open', high: 'High', low: 'Low', close: 'Close' };
                                            return [fmtV, labels[name] || name];
                                        }}
                                    />
                                    <Bar dataKey="range" fill="#3b82f618" stroke="#3b82f640" barSize={12} radius={[2, 2, 2, 2]} isAnimationActive={false} />
                                    <Line type="monotone" dataKey="open" stroke="#8b5cf6" strokeWidth={1.5} dot={{ r: 2, fill: '#8b5cf6' }} name="open" />
                                    <Line type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3, fill: '#3b82f6' }} name="close" />
                                </ComposedChart>
                            </ResponsiveContainer>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '30px 20px', color: theme.colors.secondaryText, fontSize: '0.85rem', paddingLeft: '16px' }}>
                                No daily price candles for this pair yet.
                            </div>
                        )
                    )}
                </div>
            )}
        </div>
    );
}

// ============================================
// Circuit Breaker Panel
// ============================================

const CB_CONDITION_TYPES = [
    { value: 0, label: 'Price' },
    { value: 1, label: 'Value' },
    { value: 2, label: 'Balance' },
    { value: 3, label: 'AND Group' },
    { value: 4, label: 'OR Group' },
];
const CB_OPERATORS = [
    { value: 0, label: 'Greater than' },
    { value: 1, label: 'Less than' },
    { value: 2, label: 'Inside range' },
    { value: 3, label: 'Outside range' },
    { value: 4, label: '% Change' },
];
const CB_CHANGE_DIRS = [
    { value: 0, label: 'Up' },
    { value: 1, label: 'Down' },
    { value: 2, label: 'Either direction' },
];
const CB_VALUE_SRC_TYPES = [
    { value: 0, label: 'Specific token' },
    { value: 1, label: 'All tokens in purse' },
    { value: 2, label: 'All tokens in account' },
];
const CB_ACTION_TYPES = [
    { value: 0, label: 'Pause token in rebalance portfolio' },
    { value: 1, label: 'Pause token globally' },
    { value: 2, label: 'Freeze token globally' },
    { value: 3, label: 'Stop chore' },
    { value: 4, label: 'Pause chore' },
    { value: 5, label: 'Stop all chores by type' },
    { value: 6, label: 'Pause all chores by type' },
    { value: 7, label: 'Stop ALL chores' },
    { value: 8, label: 'Pause ALL chores' },
    { value: 9, label: 'Start chore' },
    { value: 10, label: 'Start all chores by type' },
    { value: 11, label: 'Start ALL chores' },
];
const CB_CHORE_TYPES = [
    { value: 'trade', label: 'Trade' },
    { value: 'rebalance', label: 'Rebalance' },
    { value: 'move-funds', label: 'Move Funds' },
    { value: 'distribute-funds', label: 'Distribute Funds' },
    { value: 'snapshot', label: 'Snapshot' },
];
const CB_PERIOD_UNITS = [
    { value: 60, label: 'minutes' },
    { value: 3600, label: 'hours' },
    { value: 86400, label: 'days' },
];

function cbEmptyCondition(type = 0) {
    return { conditionType: type, priceToken1: '', priceToken2: '', balanceToken: '', balanceChoreInstanceId: '',
        valueSources: [], operator: 4, threshold: '', rangeMin: '', rangeMax: '',
        changePercent: '', changeDirection: '2', changePeriodValue: '1', changePeriodUnit: '3600',
        denominationToken: '', children: [] };
}
function cbEmptyAction() {
    return { actionType: 7, token: '', choreInstanceId: '', choreTypeId: '' };
}

function CircuitBreakerPanel({ getReadyBotActor, theme, accentColor, choreStatuses }) {
    const { whitelistedTokens: wlTokens } = useWhitelistTokens();
    const [globalEnabled, setGlobalEnabled] = useState(true);
    const [rules, setRules] = useState([]);
    const [events, setEvents] = useState([]);
    const [eventCount, setEventCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [editingRule, setEditingRule] = useState(null);
    const [showLog, setShowLog] = useState(false);
    const [tokenRegistry, setTokenRegistry] = useState([]);
    const [choreInstances, setChoreInstances] = useState([]);
    const [purseAllocations, setPurseAllocations] = useState([]);

    // Themed select style — fixes white-on-white issue
    const sel = (extra = {}) => ({
        padding: '6px 10px', fontSize: '0.82rem', borderRadius: '6px',
        border: `1px solid ${theme.colors.border}`, cursor: 'pointer',
        background: theme.colors.inputBg || theme.colors.secondaryBg,
        color: theme.colors.primaryText, ...extra,
    });
    const inp = (extra = {}) => ({
        padding: '6px 10px', fontSize: '0.82rem', borderRadius: '6px',
        border: `1px solid ${theme.colors.border}`,
        background: theme.colors.inputBg || theme.colors.secondaryBg,
        color: theme.colors.primaryText, outline: 'none', ...extra,
    });
    const cardSt = { background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`, borderRadius: '8px', padding: '14px', marginBottom: '10px' };
    const btnSm = (extra = {}) => ({
        padding: '5px 12px', fontSize: '0.8rem', border: `1px solid ${theme.colors.border}`,
        borderRadius: '6px', cursor: 'pointer', background: theme.colors.cardBg, color: theme.colors.primaryText,
        display: 'inline-flex', alignItems: 'center', gap: '4px', ...extra,
    });
    const label = { fontSize: '0.78rem', color: theme.colors.secondaryText, fontWeight: 500, whiteSpace: 'nowrap' };
    const sectionTitle = { fontSize: '0.88rem', fontWeight: 600, color: theme.colors.primaryText, margin: '0 0 8px 0' };

    // Token helpers
    const _resolveToken = (principal) => {
        if (!principal) return null;
        const p = typeof principal === 'string' ? principal : principal.toText?.() || principal.toString?.();
        const entry = tokenRegistry.find(t => (t.ledgerCanisterId?.toText?.() || t.ledgerCanisterId?.toString?.()) === p);
        if (entry) return entry;
        const wl = (wlTokens || []).find(t => (t.ledger_id?.toString?.() || t.ledger_id) === p);
        if (wl) return { symbol: wl.symbol, decimals: wl.decimals ?? 8 };
        const cached = getTokenMetadataSync(p);
        return cached ? { symbol: cached.symbol, decimals: cached.decimals ?? 8 } : null;
    };
    const getTokenDecimals = (principal) => {
        const t = _resolveToken(principal);
        return t ? Number(t.decimals) : 8;
    };
    const tokenSymbol = (principal) => {
        if (!principal) return '?';
        const t = _resolveToken(principal);
        if (t) return t.symbol;
        const p = typeof principal === 'string' ? principal : principal.toText?.() || principal.toString?.();
        return p?.substring?.(0, 8) + '...';
    };
    const choreInstanceLabel = (instanceId) => {
        if (!instanceId) return '?';
        const cs = choreStatuses?.find(c => c.choreId === instanceId);
        if (cs) return cs.instanceLabel || cs.choreName || instanceId;
        const inst = choreInstances.find(([id]) => id === instanceId);
        return inst ? (inst[1].label || inst[0]) : instanceId;
    };

    const choreOptionLabel = React.useMemo(() => {
        const labelCounts = {};
        for (const [id, info] of choreInstances) {
            const cs = choreStatuses?.find(c => c.choreId === id);
            const friendly = cs?.instanceLabel || cs?.choreName || info.label || id;
            labelCounts[friendly] = (labelCounts[friendly] || 0) + 1;
        }
        return (id, info) => {
            const cs = choreStatuses?.find(c => c.choreId === id);
            const friendly = cs?.instanceLabel || cs?.choreName || info.label || id;
            const typeName = info.typeId === 'trade' ? 'Trade' : info.typeId === 'rebalance' ? 'Rebalance'
                : info.typeId === 'move-funds' ? 'Move Funds' : info.typeId === 'distribute-funds' ? 'Distribute'
                : info.typeId === 'snapshot' ? 'Snapshot' : info.typeId;
            if (labelCounts[friendly] > 1) return `${friendly} [${id}] (${typeName})`;
            return `${friendly} (${typeName})`;
        };
    }, [choreInstances, choreStatuses]);
    const toTokenUnits = (e8sStr, decimals) => {
        if (!e8sStr && e8sStr !== 0) return '';
        const v = Number(e8sStr);
        if (isNaN(v)) return '';
        return (v / Math.pow(10, decimals)).toString();
    };
    const fromTokenUnits = (unitStr, decimals) => {
        if (!unitStr && unitStr !== 0) return '';
        const v = parseFloat(unitStr);
        if (isNaN(v)) return '';
        return Math.round(v * Math.pow(10, decimals)).toString();
    };

    const accountOptions = React.useMemo(() => {
        const opts = [];
        for (const p of purseAllocations) {
            if (p.enabled) {
                const lbl = choreStatuses?.find(c => c.choreId === p.instanceId)?.instanceLabel || p.instanceId;
                opts.push({ value: p.instanceId, label: `Purse: ${lbl}` });
            }
        }
        return opts;
    }, [purseAllocations, choreStatuses]);

    // Period helpers — convert raw seconds <-> value+unit for UI
    const periodToValueUnit = (totalSeconds) => {
        const s = Number(totalSeconds);
        if (!s || isNaN(s)) return { value: '1', unit: '3600' };
        if (s % 86400 === 0) return { value: (s / 86400).toString(), unit: '86400' };
        if (s % 3600 === 0) return { value: (s / 3600).toString(), unit: '3600' };
        return { value: (s / 60).toString(), unit: '60' };
    };

    const formatPeriod = (totalSeconds) => {
        const s = Number(totalSeconds);
        if (!s || isNaN(s)) return '?';
        if (s >= 86400) { const d = s / 86400; return d === 1 ? '1 day' : `${d} days`; }
        if (s >= 3600) { const h = s / 3600; return h === 1 ? '1 hour' : `${h} hours`; }
        const m = s / 60; return m === 1 ? '1 minute' : `${m} minutes`;
    };

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            const bot = await getReadyBotActor();
            const [rls, enabled, log, tokens, instances, purses] = await Promise.all([
                bot.getCircuitBreakerRules(), bot.getCircuitBreakerEnabled(),
                bot.getCircuitBreakerLog({ startId: [], limit: [50], ruleId: [], fromTime: [], toTime: [] }),
                bot.getTokenRegistry(), bot.listChoreInstances([]),
                bot.getAllPurseAllocations ? bot.getAllPurseAllocations() : [],
            ]);
            setRules(rls); setGlobalEnabled(enabled); setEvents(log.entries);
            setEventCount(Number(log.totalCount)); setTokenRegistry(tokens); setChoreInstances(instances);
            setPurseAllocations(purses);
            setError(null);
        } catch (e) { setError('Failed to load circuit breaker data: ' + e.message); }
        finally { setLoading(false); }
    }, [getReadyBotActor]);
    useEffect(() => { loadData(); }, [loadData]);

    const handleToggleGlobal = async () => {
        try { const bot = await getReadyBotActor(); await bot.setCircuitBreakerEnabled(!globalEnabled); setGlobalEnabled(!globalEnabled); }
        catch (e) { setError('Failed to toggle: ' + e.message); }
    };
    const handleToggleRule = async (id, en) => {
        try { const bot = await getReadyBotActor(); await bot.enableCircuitBreakerRule(id, !en); setRules(prev => prev.map(r => r.id === id ? { ...r, enabled: !en } : r)); }
        catch (e) { setError('Failed to toggle rule: ' + e.message); }
    };
    const handleDeleteRule = async (id) => {
        if (!window.confirm('Delete this circuit breaker rule?')) return;
        try { const bot = await getReadyBotActor(); await bot.removeCircuitBreakerRule(id); setRules(prev => prev.filter(r => r.id !== id)); }
        catch (e) { setError('Failed to delete rule: ' + e.message); }
    };
    const handleClearLog = async () => {
        if (!window.confirm('Clear the entire circuit breaker event log?')) return;
        try { const bot = await getReadyBotActor(); await bot.clearCircuitBreakerLog(); setEvents([]); setEventCount(0); }
        catch (e) { setError('Failed to clear log: ' + e.message); }
    };

    // Serialization: UI -> Candid
    function serializeCondition(c) {
        const periodSeconds = c.changePeriodValue && c.changePeriodUnit
            ? (parseFloat(c.changePeriodValue) * Number(c.changePeriodUnit)).toString() : '';
        const changePercentBps = c.changePercent ? Math.round(parseFloat(c.changePercent) * 100).toString() : '';
        // Convert human-readable token-unit strings to e8s for the backend
        const dec = condAmtDecimals(c);
        const toE8s = (humanStr) => {
            if (!humanStr && humanStr !== 0) return null;
            const v = parseFloat(humanStr);
            if (isNaN(v)) return null;
            return BigInt(Math.round(v * Math.pow(10, dec)));
        };
        const threshE8s = toE8s(c.threshold);
        const rMinE8s = toE8s(c.rangeMin);
        const rMaxE8s = toE8s(c.rangeMax);
        return {
            conditionType: BigInt(c.conditionType),
            priceToken1: c.priceToken1?.length ? [Principal.fromText(c.priceToken1)] : [],
            priceToken2: c.priceToken2?.length ? [Principal.fromText(c.priceToken2)] : [],
            balanceToken: c.balanceToken?.length ? [Principal.fromText(c.balanceToken)] : [],
            balanceChoreInstanceId: c.balanceChoreInstanceId === '__main__' ? ['__main__']
                : (c.balanceChoreInstanceId?.length ? [c.balanceChoreInstanceId] : []),
            valueSources: (c.valueSources || []).map(vs => ({
                sourceType: BigInt(vs.sourceType),
                token: vs.token?.length ? [Principal.fromText(vs.token)] : [],
                choreInstanceId: vs.choreInstanceId === '__main__' ? ['__main__']
                    : (vs.choreInstanceId?.length ? [vs.choreInstanceId] : []),
            })),
            operator: BigInt(c.operator),
            threshold: threshE8s != null ? [threshE8s] : [],
            rangeMin: rMinE8s != null ? [rMinE8s] : [],
            rangeMax: rMaxE8s != null ? [rMaxE8s] : [],
            changePercentBps: changePercentBps ? [BigInt(changePercentBps)] : [],
            changeDirection: c.changeDirection !== '' && c.changeDirection != null ? [BigInt(c.changeDirection)] : [],
            changePeriodSeconds: periodSeconds ? [BigInt(Math.round(parseFloat(periodSeconds)))] : [],
            denominationToken: c.denominationToken?.length ? [Principal.fromText(c.denominationToken)] : [],
            children: (c.children || []).map(serializeCondition),
        };
    }
    function serializeAction(a) {
        return {
            actionType: BigInt(a.actionType),
            token: a.token?.length ? [Principal.fromText(a.token)] : [],
            choreInstanceId: a.choreInstanceId?.length ? [a.choreInstanceId] : [],
            choreTypeId: a.choreTypeId?.length ? [a.choreTypeId] : [],
        };
    }

    // Resolve decimals for the amount unit token of a condition (for display/serialization)
    function condAmtDecimals(c) {
        const ct = Number(c.conditionType);
        if (ct === 0) return getTokenDecimals(c.priceToken2);
        if (ct === 2) return getTokenDecimals(c.balanceToken);
        return getTokenDecimals(c.denominationToken || ICP_LEDGER);
    }

    // Deserialization: Candid -> UI
    // threshold/rangeMin/rangeMax are stored in the editing state as human-readable
    // token-unit strings (e.g. "1.5" for 1.5 ICP) so decimal input works naturally.
    function deserializeCondition(c) {
        const bps = c.changePercentBps?.[0] != null ? Number(c.changePercentBps[0]) : null;
        const periodSec = c.changePeriodSeconds?.[0] != null ? Number(c.changePeriodSeconds[0]) : null;
        const pvu = periodSec ? periodToValueUnit(periodSec) : { value: '1', unit: '3600' };
        // Figure out decimals for amount conversion
        const ct = Number(c.conditionType);
        const denomPid = c.denominationToken?.[0]?.toText?.() || c.denominationToken?.[0]?.toString?.() || '';
        const amtToken = ct === 0 ? (c.priceToken2?.[0]?.toText?.() || c.priceToken2?.[0]?.toString?.() || '')
            : ct === 2 ? (c.balanceToken?.[0]?.toText?.() || c.balanceToken?.[0]?.toString?.() || '')
            : (denomPid || ICP_LEDGER);
        const dec = getTokenDecimals(amtToken);
        return {
            conditionType: ct,
            priceToken1: c.priceToken1?.[0]?.toText?.() || c.priceToken1?.[0]?.toString?.() || '',
            priceToken2: c.priceToken2?.[0]?.toText?.() || c.priceToken2?.[0]?.toString?.() || '',
            balanceToken: c.balanceToken?.[0]?.toText?.() || c.balanceToken?.[0]?.toString?.() || '',
            balanceChoreInstanceId: c.balanceChoreInstanceId?.[0] || '',
            valueSources: (c.valueSources || []).map(vs => ({
                sourceType: Number(vs.sourceType),
                token: vs.token?.[0]?.toText?.() || vs.token?.[0]?.toString?.() || '',
                choreInstanceId: vs.choreInstanceId?.[0] || '',
            })),
            operator: Number(c.operator),
            threshold: c.threshold?.[0] != null ? toTokenUnits(Number(c.threshold[0]).toString(), dec) : '',
            rangeMin: c.rangeMin?.[0] != null ? toTokenUnits(Number(c.rangeMin[0]).toString(), dec) : '',
            rangeMax: c.rangeMax?.[0] != null ? toTokenUnits(Number(c.rangeMax[0]).toString(), dec) : '',
            changePercent: bps != null ? (bps / 100).toString() : '',
            changeDirection: c.changeDirection?.[0] != null ? Number(c.changeDirection[0]).toString() : '2',
            changePeriodValue: pvu.value, changePeriodUnit: pvu.unit,
            denominationToken: denomPid,
            children: (c.children || []).map(deserializeCondition),
        };
    }
    function deserializeAction(a) {
        return { actionType: Number(a.actionType), token: a.token?.[0]?.toText?.() || a.token?.[0]?.toString?.() || '',
            choreInstanceId: a.choreInstanceId?.[0] || '', choreTypeId: a.choreTypeId?.[0] || '' };
    }

    const handleSaveRule = async () => {
        if (!editingRule) return;
        setSaving(true);
        try {
            const bot = await getReadyBotActor();
            const input = { name: editingRule.name, enabled: editingRule.enabled,
                topLevelOperator: BigInt(editingRule.topLevelOperator ?? 0),
                conditions: editingRule.conditions.map(serializeCondition), actions: editingRule.actions.map(serializeAction) };
            if (editingRule.id != null) await bot.updateCircuitBreakerRule(editingRule.id, input);
            else await bot.addCircuitBreakerRule(input);
            setEditingRule(null); await loadData();
        } catch (e) { setError('Failed to save rule: ' + e.message); }
        finally { setSaving(false); }
    };

    const startNewRule = () => setEditingRule({ id: null, name: '', enabled: true, topLevelOperator: 0, conditions: [cbEmptyCondition()], actions: [cbEmptyAction()] });
    const startEditRule = (rule) => setEditingRule({ id: Number(rule.id), name: rule.name, enabled: rule.enabled,
        topLevelOperator: Number(rule.topLevelOperator ?? 0),
        conditions: rule.conditions.map(deserializeCondition), actions: rule.actions.map(deserializeAction) });

    // Deep condition update helper — path is an array of indices into the tree, e.g. [2] = top-level index 2, [1,0] = child 0 of top-level index 1
    const updateCondAtPath = (path, patch) => {
        setEditingRule(r => {
            const applyPatch = (conditions, p) => {
                if (p.length === 1) return conditions.map((c, i) => i === p[0] ? { ...c, ...patch } : c);
                return conditions.map((c, i) => i === p[0] ? { ...c, children: applyPatch(c.children || [], p.slice(1)) } : c);
            };
            return { ...r, conditions: applyPatch(r.conditions, path) };
        });
    };
    const removeCondAtPath = (path) => {
        setEditingRule(r => {
            const applyRemove = (conditions, p) => {
                if (p.length === 1) return conditions.filter((_, i) => i !== p[0]);
                return conditions.map((c, i) => i === p[0] ? { ...c, children: applyRemove(c.children || [], p.slice(1)) } : c);
            };
            return { ...r, conditions: applyRemove(r.conditions, path) };
        });
    };
    const addCondAtPath = (path, newCond) => {
        setEditingRule(r => {
            const applyAdd = (conditions, p) => {
                if (p.length === 0) return [...conditions, newCond];
                return conditions.map((c, i) => i === p[0] ? { ...c, children: applyAdd(c.children || [], p.slice(1)) } : c);
            };
            return { ...r, conditions: applyAdd(r.conditions, path) };
        });
    };
    // Backward-compat flat helper (top-level only)
    const updateCond = (ci, patch) => updateCondAtPath([ci], patch);

    // ── DSL helpers for rich IF…THEN rule summaries ──

    const _pid = (v) => typeof v === 'string' ? v : v?.toText?.() || v?.toString?.() || '';

    // Inline token badge: logo + symbol
    const tkn = (principal) => {
        const p = _pid(principal);
        const sym = tokenSymbol(p);
        return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', verticalAlign: 'middle' }}>
                <TokenIcon canisterId={p} size={14} />
                <span style={{ fontWeight: 600 }}>{sym}</span>
            </span>
        );
    };

    // Keyword span (for DSL keywords like PRICE, BALANCE, etc.)
    const kw = (text, color) => <span style={{ fontWeight: 700, color: color || accentColor, letterSpacing: '0.02em' }}>{text}</span>;
    // Value span (monospace for numeric values)
    const val = (text) => <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.85em' }}>{text}</span>;

    // Format an e8s amount in human-readable token units
    const fmtAmt = (raw, tokenPrincipal) => {
        const p = _pid(tokenPrincipal);
        const dec = getTokenDecimals(p);
        const n = Number(raw);
        if (isNaN(n)) return val('?');
        const human = (n / Math.pow(10, dec));
        const formatted = human % 1 === 0 ? human.toFixed(0) : human.toPrecision(6).replace(/\.?0+$/, '');
        return <>{val(formatted)} {tkn(p)}</>;
    };

    const acctLabel = (choreInstanceId) => {
        if (!choreInstanceId || choreInstanceId === '') return 'main account';
        if (choreInstanceId === '__main__') return 'main purse';
        const lbl = choreStatuses?.find(c => c.choreId === choreInstanceId)?.instanceLabel || choreInstanceId;
        return <>{kw('Purse', theme.colors.secondaryText)}{' '}{val(`"${lbl}"`)}</>;
    };

    // Describe a list of value sources compactly
    const describeValueSources = (sources) => {
        if (!sources || sources.length === 0) return <em>no sources</em>;
        return sources.map((vs, i) => {
            const st = Number(vs.sourceType);
            const sep = i > 0 ? <>{', '}</> : null;
            if (st === 0) {
                const tok = _pid(vs.token?.[0] || vs.token);
                const cid = vs.choreInstanceId?.[0] || vs.choreInstanceId || '';
                return <span key={i}>{sep}{tkn(tok)}{' in '}{acctLabel(cid)}</span>;
            }
            if (st === 1) {
                const cid = vs.choreInstanceId?.[0] || vs.choreInstanceId || '';
                return <span key={i}>{sep}{kw('all tokens in', theme.colors.secondaryText)} {acctLabel(cid)}</span>;
            }
            if (st === 2) {
                const cid = vs.choreInstanceId?.[0] || vs.choreInstanceId || '';
                return <span key={i}>{sep}{kw('all tokens in', theme.colors.secondaryText)} {acctLabel(cid)}</span>;
            }
            return <span key={i}>{sep}{'?'}</span>;
        });
    };

    // Denomination token for value conditions (default ICP)
    const denomPrincipal = (c) => {
        const d = _pid(c.denominationToken?.[0] || c.denominationToken);
        return d || ICP_LEDGER;
    };

    // Rich condition text (returns JSX, recursive for AND/OR groups)
    const conditionText = (c) => {
        const ct = Number(c.conditionType);
        const op = Number(c.operator);

        // ── AND GROUP ──
        if (ct === 3) {
            const children = c.children || [];
            if (children.length === 0) return <>{kw('AND', accentColor)} {'(empty)'}</>;
            return <>{kw('(', accentColor)}{children.map((ch, i) => (
                <span key={i}>{i > 0 && <span style={{ fontWeight: 700, color: accentColor }}>{' AND '}</span>}{conditionText(ch)}</span>
            ))}{kw(')', accentColor)}</>;
        }
        // ── OR GROUP ──
        if (ct === 4) {
            const children = c.children || [];
            if (children.length === 0) return <>{kw('OR', '#e67e22')} {'(empty)'}</>;
            return <>{kw('(', '#e67e22')}{children.map((ch, i) => (
                <span key={i}>{i > 0 && <span style={{ fontWeight: 700, color: '#e67e22' }}>{' OR '}</span>}{conditionText(ch)}</span>
            ))}{kw(')', '#e67e22')}</>;
        }

        // ── PRICE ──
        if (ct === 0) {
            const t1 = _pid(c.priceToken1?.[0] || c.priceToken1);
            const t2 = _pid(c.priceToken2?.[0] || c.priceToken2);
            if (op === 4) {
                const bps = c.changePercentBps?.[0] != null ? Number(c.changePercentBps[0]) : 0;
                const pct = (bps / 100).toFixed(1);
                const dir = Number(c.changeDirection?.[0] ?? 2);
                const dirWord = dir === 0 ? 'rises' : dir === 1 ? 'drops' : 'moves';
                const period = c.changePeriodSeconds?.[0] != null ? formatPeriod(Number(c.changePeriodSeconds[0])) : '?';
                return <>{kw('PRICE')} {tkn(t1)}/{tkn(t2)} {dirWord} {val(`≥${pct}%`)} over {val(period)}</>;
            }
            const threshold = c.threshold?.[0] != null ? Number(c.threshold[0]) : null;
            const rMin = c.rangeMin?.[0] != null ? Number(c.rangeMin[0]) : null;
            const rMax = c.rangeMax?.[0] != null ? Number(c.rangeMax[0]) : null;
            if (op === 0) return <>{kw('PRICE')} {tkn(t1)}/{tkn(t2)} {'>'} {fmtAmt(threshold, t2)}</>;
            if (op === 1) return <>{kw('PRICE')} {tkn(t1)}/{tkn(t2)} {'<'} {fmtAmt(threshold, t2)}</>;
            if (op === 2) return <>{kw('PRICE')} {tkn(t1)}/{tkn(t2)} in [{fmtAmt(rMin, t2)} .. {fmtAmt(rMax, t2)}]</>;
            if (op === 3) return <>{kw('PRICE')} {tkn(t1)}/{tkn(t2)} outside [{fmtAmt(rMin, t2)} .. {fmtAmt(rMax, t2)}]</>;
        }

        // ── BALANCE ──
        if (ct === 2) {
            const tok = _pid(c.balanceToken?.[0] || c.balanceToken);
            const sub = c.balanceChoreInstanceId?.[0] || '';
            if (op === 4) {
                const bps = c.changePercentBps?.[0] != null ? Number(c.changePercentBps[0]) : 0;
                const pct = (bps / 100).toFixed(1);
                const dir = Number(c.changeDirection?.[0] ?? 2);
                const dirWord = dir === 0 ? 'increases' : dir === 1 ? 'decreases' : 'changes';
                const period = c.changePeriodSeconds?.[0] != null ? formatPeriod(Number(c.changePeriodSeconds[0])) : '?';
                return <>{kw('BALANCE')} {tkn(tok)} in {acctLabel(sub)} {dirWord} {val(`≥${pct}%`)} over {val(period)}</>;
            }
            const threshold = c.threshold?.[0] != null ? Number(c.threshold[0]) : null;
            const rMin = c.rangeMin?.[0] != null ? Number(c.rangeMin[0]) : null;
            const rMax = c.rangeMax?.[0] != null ? Number(c.rangeMax[0]) : null;
            if (op === 0) return <>{kw('BALANCE')} {tkn(tok)} in {acctLabel(sub)} {'>'} {fmtAmt(threshold, tok)}</>;
            if (op === 1) return <>{kw('BALANCE')} {tkn(tok)} in {acctLabel(sub)} {'<'} {fmtAmt(threshold, tok)}</>;
            if (op === 2) return <>{kw('BALANCE')} {tkn(tok)} in {acctLabel(sub)} in [{fmtAmt(rMin, tok)} .. {fmtAmt(rMax, tok)}]</>;
            if (op === 3) return <>{kw('BALANCE')} {tkn(tok)} in {acctLabel(sub)} outside [{fmtAmt(rMin, tok)} .. {fmtAmt(rMax, tok)}]</>;
        }

        // ── VALUE ──
        {
            const denom = denomPrincipal(c);
            if (op === 4) {
                const bps = c.changePercentBps?.[0] != null ? Number(c.changePercentBps[0]) : 0;
                const pct = (bps / 100).toFixed(1);
                const dir = Number(c.changeDirection?.[0] ?? 2);
                const dirWord = dir === 0 ? 'increases' : dir === 1 ? 'decreases' : 'changes';
                const period = c.changePeriodSeconds?.[0] != null ? formatPeriod(Number(c.changePeriodSeconds[0])) : '?';
                return <>{kw('VALUE')} of [{describeValueSources(c.valueSources)}] in {tkn(denom)} {dirWord} {val(`≥${pct}%`)} over {val(period)}</>;
            }
            const threshold = c.threshold?.[0] != null ? Number(c.threshold[0]) : null;
            const rMin = c.rangeMin?.[0] != null ? Number(c.rangeMin[0]) : null;
            const rMax = c.rangeMax?.[0] != null ? Number(c.rangeMax[0]) : null;
            if (op === 0) return <>{kw('VALUE')} of [{describeValueSources(c.valueSources)}] {'>'} {fmtAmt(threshold, denom)}</>;
            if (op === 1) return <>{kw('VALUE')} of [{describeValueSources(c.valueSources)}] {'<'} {fmtAmt(threshold, denom)}</>;
            if (op === 2) return <>{kw('VALUE')} of [{describeValueSources(c.valueSources)}] in [{fmtAmt(rMin, denom)} .. {fmtAmt(rMax, denom)}]</>;
            if (op === 3) return <>{kw('VALUE')} of [{describeValueSources(c.valueSources)}] outside [{fmtAmt(rMin, denom)} .. {fmtAmt(rMax, denom)}]</>;
        }

        return '?';
    };

    // Rich action text (returns JSX)
    const actionText = (a) => {
        const at = Number(a.actionType);
        const tok = _pid(a.token?.[0] || a.token);
        const cid = a.choreInstanceId?.[0] || a.choreInstanceId;
        const ctid = a.choreTypeId?.[0] || a.choreTypeId;
        const choreLabel = choreInstanceLabel(cid);
        const choreTypeName = CB_CHORE_TYPES.find(t => t.value === ctid)?.label || ctid || '?';
        switch (at) {
            case 0: return <>{kw('PAUSE', '#e67e22')} {tkn(tok)} in portfolio {val(`"${choreLabel}"`)}</>;
            case 1: return <>{kw('PAUSE', '#e67e22')} {tkn(tok)} globally</>;
            case 2: return <>{kw('FREEZE', '#3498db')} {tkn(tok)} globally</>;
            case 3: return <>{kw('STOP', '#e74c3c')} chore {val(`"${choreLabel}"`)}</>;
            case 4: return <>{kw('PAUSE', '#e67e22')} chore {val(`"${choreLabel}"`)}</>;
            case 5: return <>{kw('STOP', '#e74c3c')} all {val(choreTypeName)} chores</>;
            case 6: return <>{kw('PAUSE', '#e67e22')} all {val(choreTypeName)} chores</>;
            case 7: return <>{kw('STOP ALL', '#e74c3c')} chores</>;
            case 8: return <>{kw('PAUSE ALL', '#e67e22')} chores</>;
            case 9: return <>{kw('START', '#27ae60')} chore {val(`"${choreLabel}"`)}</>;
            case 10: return <>{kw('START', '#27ae60')} all {val(choreTypeName)} chores</>;
            case 11: return <>{kw('START ALL', '#27ae60')} chores</>;
            default: return '?';
        }
    };

    // ── Recursive condition editor ──
    const renderConditionEditor = (cond, path, depth) => {
        const update = (patch) => updateCondAtPath(path, patch);
        const isGroup = cond.conditionType === 3 || cond.conditionType === 4;
        const groupColor = cond.conditionType === 3 ? accentColor : '#e67e22';
        const depthBg = depth > 0 ? `${theme.colors.border}18` : 'transparent';

        return (
            <div key={path.join('-')} style={{
                ...cardSt, position: 'relative',
                marginLeft: depth > 0 ? '16px' : 0,
                borderLeft: isGroup ? `3px solid ${groupColor}` : `3px solid ${theme.colors.border}`,
                background: depthBg,
            }}>
                <button title="Remove condition" style={{ position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', cursor: 'pointer', color: '#e74c3c', fontSize: '1rem' }}
                    onClick={() => removeCondAtPath(path)}><FaTrash /></button>

                {/* Row 1: Type + Operator */}
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
                    <div>
                        <div style={label}>Type</div>
                        <select value={cond.conditionType} onChange={e => {
                            const v = Number(e.target.value);
                            const wasGroup = cond.conditionType === 3 || cond.conditionType === 4;
                            const isNowGroup = v === 3 || v === 4;
                            if (wasGroup && isNowGroup) {
                                update({ conditionType: v });
                            } else {
                                updateCondAtPath(path, { ...cbEmptyCondition(v), conditionType: v, operator: cond.operator });
                            }
                        }} style={sel({ marginTop: '4px', minWidth: '120px' })}>
                            {CB_CONDITION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                    </div>
                    {!isGroup && (
                        <div>
                            <div style={label}>Operator</div>
                            <select value={cond.operator} onChange={e => update({ operator: Number(e.target.value) })}
                                style={sel({ marginTop: '4px', minWidth: '130px' })}>
                                {CB_OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        </div>
                    )}
                </div>

                {/* ── AND/OR GROUP ── */}
                {isGroup && (
                    <div style={{ marginTop: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                            <span style={{ fontWeight: 700, color: groupColor, fontSize: '0.85rem' }}>
                                {cond.conditionType === 3 ? 'ALL (AND)' : 'ANY (OR)'} of:
                            </span>
                            <button style={btnSm({ fontSize: '0.75rem', color: groupColor, borderColor: groupColor })}
                                onClick={() => addCondAtPath(path, cbEmptyCondition())}><FaPlus /> Add Child</button>
                        </div>
                        {(cond.children || []).length === 0 && (
                            <div style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', fontStyle: 'italic', paddingLeft: '16px' }}>
                                No child conditions — add at least one.
                            </div>
                        )}
                        {(cond.children || []).map((child, i) => renderConditionEditor(child, [...path, i], depth + 1))}
                    </div>
                )}

                {/* ── PRICE ── */}
                {cond.conditionType === 0 && (
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '10px', flexWrap: 'wrap' }}>
                        <div style={{ minWidth: '160px', flex: '0 1 200px' }}>
                            <div style={label}>Token 1</div>
                            <TokenSelector value={cond.priceToken1} onChange={v => update({ priceToken1: v })}
                                allowCustom placeholder="Select token..." style={{ marginTop: '4px' }} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', paddingTop: '20px', color: theme.colors.secondaryText, fontWeight: 600 }}>/</div>
                        <div style={{ minWidth: '160px', flex: '0 1 200px' }}>
                            <div style={label}>Token 2</div>
                            <TokenSelector value={cond.priceToken2} onChange={v => update({ priceToken2: v })}
                                allowCustom placeholder="Select token..." style={{ marginTop: '4px' }} />
                        </div>
                    </div>
                )}

                {/* ── BALANCE ── */}
                {cond.conditionType === 2 && (
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '10px', flexWrap: 'wrap' }}>
                        <div style={{ minWidth: '160px', flex: '0 1 200px' }}>
                            <div style={label}>Token</div>
                            <TokenSelector value={cond.balanceToken} onChange={v => update({ balanceToken: v })}
                                allowCustom placeholder="Select token..." style={{ marginTop: '4px' }} />
                        </div>
                        <div>
                            <div style={label}>Account</div>
                            <select value={cond.balanceChoreInstanceId} onChange={e => update({ balanceChoreInstanceId: e.target.value })}
                                style={sel({ marginTop: '4px', minWidth: '150px' })}>
                                <option value="">Main account (full on-chain)</option>
                                <option value="__main__">Main purse (minus allocations)</option>
                                {accountOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        </div>
                    </div>
                )}

                {/* ── VALUE ── */}
                {cond.conditionType === 1 && (
                    <div style={{ marginBottom: '10px' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                            <span style={label}>Value Sources</span>
                            <button style={btnSm({ fontSize: '0.75rem', color: accentColor, borderColor: accentColor })}
                                onClick={() => update({ valueSources: [...(cond.valueSources || []), { sourceType: 0, token: '', choreInstanceId: '' }] })}><FaPlus /> Add Source</button>
                        </div>
                        {(cond.valueSources || []).map((vs, vi) => (
                            <div key={vi} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '6px', paddingLeft: '8px', borderLeft: `2px solid ${theme.colors.border}` }}>
                                <select value={vs.sourceType} onChange={e => {
                                    const v = Number(e.target.value);
                                    update({ valueSources: cond.valueSources.map((s, j) => j === vi ? { ...s, sourceType: v } : s) });
                                }} style={sel({ minWidth: '180px', fontSize: '0.8rem' })}>
                                    {CB_VALUE_SRC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                </select>
                                {vs.sourceType === 0 && (
                                    <>
                                        <div style={{ minWidth: '140px', flex: '0 1 160px' }}>
                                            <TokenSelector value={vs.token} onChange={v => update({ valueSources: cond.valueSources.map((s, j) => j === vi ? { ...s, token: v } : s) })}
                                                allowCustom placeholder="Token..." style={{ width: '100%' }} />
                                        </div>
                                        <select value={vs.choreInstanceId} onChange={e => update({ valueSources: cond.valueSources.map((s, j) => j === vi ? { ...s, choreInstanceId: e.target.value } : s) })}
                                            style={sel({ minWidth: '120px', fontSize: '0.8rem' })}>
                                            <option value="">Main account (full on-chain)</option>
                                            <option value="__main__">Main purse (minus allocations)</option>
                                            {accountOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                    </>
                                )}
                                {vs.sourceType === 1 && (
                                    <select value={vs.choreInstanceId} onChange={e => update({ valueSources: cond.valueSources.map((s, j) => j === vi ? { ...s, choreInstanceId: e.target.value } : s) })}
                                        style={sel({ minWidth: '180px', fontSize: '0.8rem' })}>
                                        <option value="">Select purse...</option>
                                        {accountOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                )}
                                {vs.sourceType === 2 && (
                                    <select value={vs.choreInstanceId} onChange={e => update({ valueSources: cond.valueSources.map((s, j) => j === vi ? { ...s, choreInstanceId: e.target.value } : s) })}
                                        style={sel({ minWidth: '140px', fontSize: '0.8rem' })}>
                                        <option value="">Main account (full on-chain)</option>
                                        <option value="__main__">Main purse (minus allocations)</option>
                                        {accountOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                )}
                                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e74c3c', padding: '4px' }}
                                    onClick={() => update({ valueSources: cond.valueSources.filter((_, j) => j !== vi) })}><FaTrash /></button>
                            </div>
                        ))}
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginTop: '8px' }}>
                            <div style={{ minWidth: '160px', flex: '0 1 200px' }}>
                                <div style={label}>Denomination (default: ICP)</div>
                                <TokenSelector value={cond.denominationToken} onChange={v => update({ denominationToken: v })}
                                    allowCustom placeholder="ICP (default)" style={{ marginTop: '4px' }} />
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Operator-specific (thresholds/ranges/% change) — only for leaf conditions ── */}
                {!isGroup && (cond.operator === 0 || cond.operator === 1) && (() => {
                    const unitToken = cond.conditionType === 0 ? cond.priceToken2
                        : cond.conditionType === 1 ? (cond.denominationToken || ICP_LEDGER)
                        : cond.balanceToken;
                    const unitSym = tokenSymbol(unitToken);
                    return (
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
                            <span style={label}>Threshold:</span>
                            <input type="text" value={cond.threshold} placeholder="0.00"
                                onChange={e => update({ threshold: e.target.value })}
                                style={inp({ width: '140px' })} />
                            <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>{unitSym}</span>
                        </div>
                    );
                })()}
                {!isGroup && (cond.operator === 2 || cond.operator === 3) && (() => {
                    const unitToken = cond.conditionType === 0 ? cond.priceToken2
                        : cond.conditionType === 1 ? (cond.denominationToken || ICP_LEDGER)
                        : cond.balanceToken;
                    const unitSym = tokenSymbol(unitToken);
                    return (
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
                            <span style={label}>Min:</span>
                            <input type="text" value={cond.rangeMin} placeholder="0.00"
                                onChange={e => update({ rangeMin: e.target.value })}
                                style={inp({ width: '120px' })} />
                            <span style={label}>Max:</span>
                            <input type="text" value={cond.rangeMax} placeholder="0.00"
                                onChange={e => update({ rangeMax: e.target.value })}
                                style={inp({ width: '120px' })} />
                            <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>{unitSym}</span>
                        </div>
                    );
                })()}
                {!isGroup && cond.operator === 4 && (
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
                        <div>
                            <div style={label}>Change %</div>
                            <input type="text" value={cond.changePercent} placeholder="e.g. 5"
                                onChange={e => update({ changePercent: e.target.value })}
                                style={inp({ width: '80px', marginTop: '4px' })} />
                        </div>
                        <div>
                            <div style={label}>Direction</div>
                            <select value={cond.changeDirection ?? '2'} onChange={e => update({ changeDirection: e.target.value })}
                                style={sel({ marginTop: '4px', minWidth: '120px' })}>
                                {CB_CHANGE_DIRS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <div style={label}>Over period</div>
                            <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                                <input type="text" value={cond.changePeriodValue} placeholder="1"
                                    onChange={e => update({ changePeriodValue: e.target.value })}
                                    style={inp({ width: '60px' })} />
                                <select value={cond.changePeriodUnit} onChange={e => update({ changePeriodUnit: e.target.value })}
                                    style={sel({ minWidth: '90px' })}>
                                    {CB_PERIOD_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    if (loading) return <div style={{ padding: '20px', color: theme.colors.secondaryText }}>Loading circuit breaker...</div>;

    // ── RULE EDITOR ──
    if (editingRule) {
        return (
            <div style={{ padding: '8px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                    <FaShieldAlt style={{ color: accentColor, fontSize: '1.1rem' }} />
                    <h4 style={{ color: theme.colors.primaryText, margin: 0 }}>
                        {editingRule.id != null ? 'Edit' : 'New'} Circuit Breaker Rule
                    </h4>
                </div>
                {error && <div style={{ color: '#e74c3c', marginBottom: '10px', fontSize: '0.82rem', padding: '6px 10px', background: 'rgba(231,76,60,0.1)', borderRadius: '6px' }}>{error}</div>}

                {/* Name + Enabled */}
                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', marginBottom: '16px', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 300px' }}>
                        <div style={label}>Rule Name</div>
                        <input type="text" value={editingRule.name} placeholder="e.g. BTC crash protection"
                            onChange={e => setEditingRule(r => ({ ...r, name: e.target.value }))}
                            style={inp({ width: '100%', marginTop: '4px', boxSizing: 'border-box' })} />
                    </div>
                    <label style={{ ...label, display: 'flex', alignItems: 'center', gap: '6px', paddingBottom: '6px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={editingRule.enabled} onChange={e => setEditingRule(r => ({ ...r, enabled: e.target.checked }))} />
                        Enabled
                    </label>
                </div>

                {/* ── CONDITIONS ── */}
                <div style={{ marginBottom: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                        <h5 style={sectionTitle}>Conditions</h5>
                        <select value={editingRule.topLevelOperator} onChange={e => setEditingRule(r => ({ ...r, topLevelOperator: Number(e.target.value) }))}
                            style={sel({ minWidth: '80px', fontWeight: 600 })}>
                            <option value={0}>ALL (AND)</option>
                            <option value={1}>ANY (OR)</option>
                        </select>
                        <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                            {editingRule.topLevelOperator === 1 ? 'any condition must be true' : 'all must be true to trigger'}
                        </span>
                        <button style={btnSm({ color: accentColor, borderColor: accentColor, marginLeft: 'auto' })}
                            onClick={() => setEditingRule(r => ({ ...r, conditions: [...r.conditions, cbEmptyCondition()] }))}>
                            <FaPlus /> Add Condition
                        </button>
                    </div>
                    {editingRule.conditions.map((cond, ci) => renderConditionEditor(cond, [ci], 0))}
                </div>

                {/* ── ACTIONS ── */}
                <div style={{ marginBottom: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                        <h5 style={sectionTitle}>Actions</h5>
                        <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>(all execute when conditions are met)</span>
                        <button style={btnSm({ color: accentColor, borderColor: accentColor, marginLeft: 'auto' })}
                            onClick={() => setEditingRule(r => ({ ...r, actions: [...r.actions, cbEmptyAction()] }))}>
                            <FaPlus /> Add Action
                        </button>
                    </div>
                    {editingRule.actions.map((act, ai) => (
                        <div key={ai} style={{ ...cardSt, position: 'relative' }}>
                            <button title="Remove action" style={{ position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', cursor: 'pointer', color: '#e74c3c', fontSize: '1rem' }}
                                onClick={() => setEditingRule(r => ({ ...r, actions: r.actions.filter((_, i) => i !== ai) }))}><FaTrash /></button>
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                                <div>
                                    <div style={label}>Action</div>
                                    <select value={act.actionType} onChange={e => {
                                        const v = Number(e.target.value);
                                        setEditingRule(r => ({ ...r, actions: r.actions.map((a, i) => i === ai ? { ...cbEmptyAction(), actionType: v } : a) }));
                                    }} style={sel({ marginTop: '4px', minWidth: '220px' })}>
                                        {CB_ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                    </select>
                                </div>
                                {[0, 1, 2].includes(act.actionType) && (
                                    <div style={{ minWidth: '160px', flex: '0 1 200px' }}>
                                        <div style={label}>Token</div>
                                        <TokenSelector value={act.token} onChange={v => setEditingRule(r => ({ ...r, actions: r.actions.map((a, i) => i === ai ? { ...a, token: v } : a) }))}
                                            allowCustom placeholder="Select token..." style={{ marginTop: '4px' }} />
                                    </div>
                                )}
                                {[0, 3, 4, 9].includes(act.actionType) && (
                                    <div>
                                        <div style={label}>Chore</div>
                                        <select value={act.choreInstanceId} onChange={e => setEditingRule(r => ({ ...r, actions: r.actions.map((a, i) => i === ai ? { ...a, choreInstanceId: e.target.value } : a) }))}
                                            style={sel({ marginTop: '4px', minWidth: '180px' })}>
                                            <option value="">Select chore...</option>
                                            {choreInstances.filter(([, info]) => act.actionType === 0 ? info.typeId === 'rebalance' : true)
                                                .map(([id, info]) => <option key={id} value={id}>{choreOptionLabel(id, info)}</option>)}
                                        </select>
                                    </div>
                                )}
                                {[5, 6, 10].includes(act.actionType) && (
                                    <div>
                                        <div style={label}>Chore type</div>
                                        <select value={act.choreTypeId} onChange={e => setEditingRule(r => ({ ...r, actions: r.actions.map((a, i) => i === ai ? { ...a, choreTypeId: e.target.value } : a) }))}
                                            style={sel({ marginTop: '4px', minWidth: '150px' })}>
                                            <option value="">Select type...</option>
                                            {CB_CHORE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                        </select>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Save / Cancel */}
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', borderTop: `1px solid ${theme.colors.border}`, paddingTop: '12px' }}>
                    <button onClick={handleSaveRule} disabled={saving || !editingRule.name?.trim()}
                        style={btnSm({ background: accentColor, color: '#fff', borderColor: accentColor, opacity: saving || !editingRule.name?.trim() ? 0.5 : 1, padding: '8px 20px' })}>
                        <FaSave /> {saving ? 'Saving...' : 'Save Rule'}
                    </button>
                    <button onClick={() => { setEditingRule(null); setError(null); }} style={btnSm({ padding: '8px 20px' })}>
                        <FaTimes /> Cancel
                    </button>
                    {!editingRule.name?.trim() && (
                        <span style={{ fontSize: '0.78rem', color: '#e74c3c' }}>Rule name is required</span>
                    )}
                </div>
            </div>
        );
    }

    // ── MAIN VIEW ──
    return (
        <div style={{ padding: '8px 0' }}>
            {error && <div style={{ color: '#e74c3c', marginBottom: '10px', fontSize: '0.82rem', padding: '6px 10px', background: 'rgba(231,76,60,0.1)', borderRadius: '6px' }}>{error}</div>}

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <h4 style={{ color: theme.colors.primaryText, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <FaShieldAlt style={{ color: accentColor }} /> Circuit Breaker
                </h4>
                <button onClick={handleToggleGlobal} style={btnSm({ color: globalEnabled ? '#27ae60' : '#e74c3c' })}>
                    {globalEnabled ? <FaToggleOn size={16} /> : <FaToggleOff size={16} />}
                    {globalEnabled ? 'Enabled' : 'Disabled'}
                </button>
                <button onClick={startNewRule} style={btnSm({ color: accentColor, borderColor: accentColor })}>
                    <FaPlus /> New Rule
                </button>
                <button onClick={() => setShowLog(v => !v)} style={btnSm()}>
                    {showLog ? 'Hide' : 'Show'} Event Log ({eventCount})
                </button>
                <button onClick={loadData} style={btnSm()}><FaSyncAlt /></button>
            </div>

            {rules.length === 0 && (
                <div style={{ color: theme.colors.secondaryText, fontSize: '0.85rem', padding: '20px', textAlign: 'center', ...cardSt }}>
                    No circuit breaker rules configured. Click "New Rule" to create one.
                </div>
            )}
            {rules.map(rule => (
                <div key={Number(rule.id)} style={{ ...cardSt, opacity: rule.enabled ? 1 : 0.55, borderLeft: `3px solid ${rule.enabled ? '#27ae60' : theme.colors.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                        <strong style={{ color: theme.colors.primaryText, fontSize: '0.92rem' }}>{rule.name}</strong>
                        <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px',
                            background: rule.enabled ? 'rgba(39,174,96,0.15)' : 'rgba(231,76,60,0.1)',
                            color: rule.enabled ? '#27ae60' : '#e74c3c', fontWeight: 600 }}>
                            {rule.enabled ? 'Active' : 'Disabled'}
                        </span>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
                            <button onClick={() => handleToggleRule(Number(rule.id), rule.enabled)} style={btnSm()} title={rule.enabled ? 'Disable' : 'Enable'}>
                                {rule.enabled ? <FaPause /> : <FaPlay />}
                            </button>
                            <button onClick={() => startEditRule(rule)} style={btnSm()} title="Edit"><FaEdit /></button>
                            <button onClick={() => handleDeleteRule(Number(rule.id))} style={btnSm({ color: '#e74c3c' })} title="Delete"><FaTrash /></button>
                        </div>
                    </div>
                    <div style={{ fontSize: '0.8rem', lineHeight: '1.8' }}>
                        <div style={{ color: theme.colors.secondaryText, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px' }}>
                            <span style={{ color: accentColor, fontWeight: 700, fontSize: '0.85rem', marginRight: '4px' }}>IF</span>
                            {rule.conditions.map((c, i) => {
                                const isOr = Number(rule.topLevelOperator ?? 0) === 1;
                                const connColor = isOr ? '#e67e22' : accentColor;
                                const connLabel = isOr ? 'OR' : 'AND';
                                return (
                                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px' }}>
                                        {i > 0 && <span style={{ color: connColor, fontWeight: 700, margin: '0 4px' }}>{connLabel}</span>}
                                        <span style={{ color: theme.colors.primaryText }}>{conditionText(c)}</span>
                                    </span>
                                );
                            })}
                        </div>
                        <div style={{ color: theme.colors.secondaryText, marginTop: '4px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px' }}>
                            <span style={{ color: '#e67e22', fontWeight: 700, fontSize: '0.85rem', marginRight: '4px' }}>THEN</span>
                            {rule.actions.map((a, i) => (
                                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px' }}>
                                    {i > 0 && <span style={{ color: theme.colors.secondaryText, margin: '0 2px' }}>{' · '}</span>}
                                    <span style={{ color: theme.colors.primaryText }}>{actionText(a)}</span>
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            ))}

            {showLog && (
                <div style={{ marginTop: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                        <h5 style={sectionTitle}>Event Log</h5>
                        <CopyToClipboardButton
                            accentColor={accentColor} theme={theme} label="Copy"
                            getText={() => {
                                if (!events.length) return '# Circuit Breaker Log (empty)\n';
                                const fmtTs = (ns) => { try { return new Date(Number(BigInt(ns)/1_000_000n)).toISOString(); } catch(_) { return '?'; } };
                                const lines = [`# Circuit Breaker Log (${events.length} entries)`];
                                for (const e of events) {
                                    lines.push(`#${e.id} | ${fmtTs(e.timestamp)} | Rule: "${e.ruleName}" | ${e.conditionSummary} | Actions: ${e.actionsTaken.join(', ')}`);
                                }
                                return lines.join('\n') + '\n';
                            }}
                        />
                        <button onClick={handleClearLog} style={btnSm({ color: '#e74c3c', fontSize: '0.75rem' })}>Clear Log</button>
                    </div>
                    {events.length === 0 ? (
                        <div style={{ color: theme.colors.secondaryText, fontSize: '0.82rem', ...cardSt, textAlign: 'center' }}>No circuit breaker events recorded.</div>
                    ) : (
                        <div style={{ maxHeight: '400px', overflowY: 'auto', borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                            <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
                                <thead><tr style={{ borderBottom: `2px solid ${theme.colors.border}`, background: theme.colors.cardBg }}>
                                    {['Time', 'Rule', 'Conditions', 'Actions Taken'].map(h => (
                                        <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: theme.colors.secondaryText, fontWeight: 600 }}>{h}</th>
                                    ))}
                                </tr></thead>
                                <tbody>
                                    {[...events].reverse().map(evt => (
                                        <tr key={Number(evt.id)} style={{ borderBottom: `1px solid ${theme.colors.border}30` }}>
                                            <td style={{ padding: '6px 10px', color: theme.colors.primaryText, whiteSpace: 'nowrap' }}>
                                                {new Date(Number(evt.timestamp) / 1_000_000).toLocaleString()}
                                            </td>
                                            <td style={{ padding: '6px 10px', color: theme.colors.primaryText, fontWeight: 500 }}>{evt.ruleName}</td>
                                            <td style={{ padding: '6px 10px', color: theme.colors.secondaryText }}>{evt.conditionSummary}</td>
                                            <td style={{ padding: '6px 10px', color: theme.colors.secondaryText }}>{evt.actionsTaken.join('; ')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ============================================
// Bot Log Panel — standalone full bot log viewer
// ============================================
const BOT_LOG_LEVELS = ['Error', 'Warning', 'Info', 'Debug', 'Trace'];
const BOT_LOG_LEVEL_COLORS = { Error: '#ef4444', Warning: '#f59e0b', Info: '#3b82f6', Debug: '#8b5cf6', Trace: '#6b7280' };
const BOT_LOG_LEVEL_ORDER = { Error: 1, Warning: 2, Info: 3, Debug: 4, Trace: 5 };
const BOT_LOG_SOURCES = ['api', 'permissions', 'chore', 'system', 'log'];
const BOT_LOG_TOKEN_TAG_KEYS = new Set(['inputToken', 'outputToken', 'token', 'ledger', 'ledgerId', 'tokenId', 'sellTokenId', 'buyTokenId', 'denomToken']);
const BOT_LOG_AMOUNT_TAG_KEYS = new Set([
    'inputAmount', 'outputAmount', 'amount', 'fee', 'balance',
    'tradeSize', 'tradeSizeUnits', 'sellBalance', 'overshootCap', 'targetReachUnits',
    'effectiveTargetReach', 'maxAffordable', 'balanceDiv4', 'maxTradeUnits', 'minTradeUnits', 'resultTradeSize',
    'buyBalance', 'expectedOutput',
    'sellValue', 'buyValue', 'excessSellValue', 'deficitBuyValue', 'capDenomValue', 'totalValue',
    'tradeSizeDenom', 'maxTradeDenom', 'minTradeDenom',
    'cachedInputAmount', 'cachedExpectedOutput', 'spotPriceE8s',
]);
const BOT_LOG_AMOUNT_TO_TOKEN = {
    inputAmount: 'inputToken', outputAmount: 'outputToken', amount: 'token', fee: 'inputToken', balance: 'token',
    tradeSize: 'sellTokenId', tradeSizeUnits: 'sellTokenId', sellBalance: 'sellTokenId',
    overshootCap: 'sellTokenId', targetReachUnits: 'sellTokenId', effectiveTargetReach: 'sellTokenId',
    maxAffordable: 'sellTokenId', balanceDiv4: 'sellTokenId', maxTradeUnits: 'sellTokenId',
    minTradeUnits: 'sellTokenId', resultTradeSize: 'sellTokenId',
    buyBalance: 'buyTokenId', expectedOutput: 'buyTokenId',
    sellValue: 'denomToken', buyValue: 'denomToken',
    excessSellValue: 'denomToken', deficitBuyValue: 'denomToken', capDenomValue: 'denomToken', totalValue: 'denomToken',
    tradeSizeDenom: 'denomToken', maxTradeDenom: 'denomToken', minTradeDenom: 'denomToken',
    cachedInputAmount: 'inputToken', cachedExpectedOutput: 'outputToken',
    spotPriceE8s: 'inputToken',
};
const BOT_LOG_BPS_TAG_KEYS = new Set([
    'priceImpactBps', 'maxImpactBps', 'maxSlippageBps', 'slippageBps',
    'sellDeviationBps', 'buyDeviationBps', 'combinedDeviationBps',
    'currentBps', 'targetBps', 'thresholdBps', 'deviationBps',
]);
const fmtLogAmt = (raw, decimals = 8) => {
    const n = Number(raw);
    if (isNaN(n) || n === 0) return String(raw);
    return (n / Math.pow(10, decimals)).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: Math.min(decimals, 8) });
};
const fmtBps = (v) => {
    const n = Number(v);
    if (isNaN(n)) return String(v);
    return (n / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + '%';
};

function BotLogPanel({ getReadyBotActor, theme, accentColor }) {
    const { identity } = useAuth();
    const [entries, setEntries] = useState([]);
    const [logConfig, setLogConfig] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [logFilter, setLogFilter] = useState({
        minLevel: [], source: [], caller: [], fromTime: [], toTime: [], startId: [], limit: [50n],
    });
    const [hasMore, setHasMore] = useState(false);
    const [totalMatching, setTotalMatching] = useState(0);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const autoRefreshRef = useRef(null);
    const [savingConfig, setSavingConfig] = useState(false);
    const [configMsg, setConfigMsg] = useState({ text: '', isError: false });

    const allTokenIds = React.useMemo(() => {
        const ids = new Set();
        for (const e of entries) {
            for (const [k, v] of e.tags) {
                if (BOT_LOG_TOKEN_TAG_KEYS.has(k) && v && v.length > 10) ids.add(v);
            }
        }
        return [...ids];
    }, [entries]);
    const tokenMeta = useTokenMetadata(allTokenIds, identity);

    const loadLogs = useCallback(async (filterOverride, silent) => {
        if (!silent) setLoading(true);
        setError('');
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const f = filterOverride || logFilter;
            const [result, config] = await Promise.all([bot.getLogs(f), bot.getLogConfig()]);
            setEntries(result.entries || []);
            setHasMore(result.hasMore);
            setTotalMatching(Number(result.totalMatching));
            setLogConfig(config);
        } catch (e) { if (!silent) setError('Failed to load logs: ' + e.message); }
        finally { if (!silent) setLoading(false); }
    }, [getReadyBotActor, logFilter]);

    useEffect(() => { loadLogs(); }, []);

    useEffect(() => {
        if (autoRefresh) {
            autoRefreshRef.current = setInterval(() => loadLogs(undefined, true), 5000);
        }
        return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
    }, [autoRefresh, loadLogs]);

    const selectedLevelKey = logFilter.minLevel.length > 0 ? Object.keys(logFilter.minLevel[0])[0] : null;
    const selectedLevelNum = selectedLevelKey ? BOT_LOG_LEVEL_ORDER[selectedLevelKey] : null;
    const pageSize = Number(logFilter.limit.length > 0 ? logFilter.limit[0] : 50n);
    const isFirstPage = logFilter.startId.length === 0;

    const cardStyle = { padding: '12px 14px', borderRadius: '10px', border: `1px solid ${theme.colors.border}`, marginBottom: '10px' };

    return (
        <div>
            {loading && !entries.length ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.secondaryText }}>Loading log data...</div>
            ) : (
                <>
                    <div style={{ ...cardStyle, background: `linear-gradient(135deg, ${accentColor}08, ${accentColor}05)`, border: `1px solid ${accentColor}20` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5', flex: 1 }}>
                                Bot Log records all activity — API calls, chore actions, permission changes, and errors.
                                {logConfig && <> Currently storing <strong>{Number(logConfig.entryCount).toLocaleString()}</strong> of {Number(logConfig.maxEntries).toLocaleString()} max entries at <strong>{Object.keys(logConfig.logLevel)[0]}</strong> write level.</>}
                            </p>
                            <CopyToClipboardButton
                                accentColor={accentColor} theme={theme} label="Copy"
                                getText={() => {
                                    if (!entries.length) return '# Bot Log (empty)\n';
                                    const LOG_NAMES = { Off:'OFF', Error:'ERROR', Warning:'WARN', Info:'INFO', Debug:'DEBUG', Trace:'TRACE' };
                                    const lvl = (l) => { for (const k in LOG_NAMES) if (l[k]!==undefined) return LOG_NAMES[k]; return '?'; };
                                    const fmtTs = (ns) => { try { return new Date(Number(BigInt(ns)/1_000_000n)).toISOString(); } catch(_) { return '?'; } };
                                    const lines = [`# Bot Log (${entries.length} entries)`];
                                    for (const e of entries) {
                                        const tags = e.tags?.length ? ' | ' + e.tags.map(([k,v])=>`${k}=${v}`).join(', ') : '';
                                        lines.push(`[${fmtTs(e.timestamp)}] [${lvl(e.level)}] [${e.source}] ${e.message}${tags}`);
                                    }
                                    return lines.join('\n') + '\n';
                                }}
                            />
                        </div>
                    </div>

                    {error && <div style={{ ...cardStyle, background: '#ef444415', border: '1px solid #ef444430', color: '#ef4444', fontSize: '0.85rem' }}>{error}</div>}

                    {/* Toolbar */}
                    <div style={{ ...cardStyle, padding: '0.75rem 1rem' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>Show:</span>
                            {BOT_LOG_LEVELS.map(lvl => {
                                const lvlNum = BOT_LOG_LEVEL_ORDER[lvl];
                                const isIncluded = selectedLevelNum !== null && lvlNum <= selectedLevelNum;
                                const isThreshold = selectedLevelKey === lvl;
                                const color = BOT_LOG_LEVEL_COLORS[lvl];
                                return (
                                    <button key={lvl} onClick={() => {
                                        const nf = { ...logFilter, minLevel: isThreshold ? [] : [{ [lvl]: null }], startId: [] };
                                        setLogFilter(nf); loadLogs(nf);
                                    }} style={{
                                        padding: '2px 10px', borderRadius: '12px', border: `1px solid ${isIncluded ? color : theme.colors.border}`,
                                        background: isThreshold ? `${color}30` : isIncluded ? `${color}15` : 'transparent',
                                        color: isIncluded ? color : theme.colors.secondaryText, fontSize: '0.75rem',
                                        fontWeight: isIncluded ? '600' : '400', cursor: 'pointer',
                                        opacity: selectedLevelNum !== null && !isIncluded ? 0.4 : 1,
                                    }}>{lvl}{isThreshold ? '+' : ''}</button>
                                );
                            })}
                            <div style={{ width: '1px', height: '16px', background: theme.colors.border, margin: '0 4px' }} />
                            <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>Source:</span>
                            {BOT_LOG_SOURCES.map(src => {
                                const isActive = logFilter.source.length > 0 && logFilter.source[0] === src;
                                return (
                                    <button key={src} onClick={() => {
                                        const nf = { ...logFilter, source: isActive ? [] : [src], startId: [] };
                                        setLogFilter(nf); loadLogs(nf);
                                    }} style={{
                                        padding: '2px 10px', borderRadius: '12px', border: `1px solid ${isActive ? accentColor : theme.colors.border}`,
                                        background: isActive ? `${accentColor}20` : 'transparent',
                                        color: isActive ? accentColor : theme.colors.secondaryText, fontSize: '0.75rem',
                                        fontWeight: isActive ? '600' : '400', cursor: 'pointer',
                                    }}>{src}</button>
                                );
                            })}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                            <button onClick={() => loadLogs()} disabled={loading} style={{
                                padding: '4px 12px', borderRadius: '8px', border: `1px solid ${theme.colors.border}`,
                                background: 'transparent', color: theme.colors.primaryText, fontSize: '0.8rem',
                                cursor: 'pointer', opacity: loading ? 0.5 : 1,
                            }}>{loading ? 'Loading...' : 'Refresh'}</button>
                            <label style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                                <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} style={{ cursor: 'pointer' }} />
                                Auto-refresh
                            </label>
                            <div style={{ width: '1px', height: '16px', background: theme.colors.border, margin: '0 2px' }} />
                            <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>Per page:</span>
                            <select value={pageSize} onChange={e => { const nf = { ...logFilter, limit: [BigInt(e.target.value)], startId: [] }; setLogFilter(nf); loadLogs(nf); }}
                                style={{ padding: '3px 6px', borderRadius: '6px', border: `1px solid ${theme.colors.border}`, background: theme.colors.cardBackground || theme.colors.background, color: theme.colors.primaryText, fontSize: '0.8rem', cursor: 'pointer' }}>
                                {[10, 25, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                            <div style={{ flex: 1 }} />
                            {logConfig && (
                                <>
                                    <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>Write level:</span>
                                    <select value={Object.keys(logConfig.logLevel)[0]}
                                        onChange={async (e) => {
                                            setSavingConfig(true); setConfigMsg({ text: '', isError: false });
                                            try {
                                                const newLevel = e.target.value;
                                                const bot = await getReadyBotActor();
                                                await bot.setLogLevel({ [newLevel]: null });
                                                setLogConfig(prev => prev ? { ...prev, logLevel: { [newLevel]: null } } : prev);
                                                setConfigMsg({ text: `Log level set to ${newLevel}`, isError: false });
                                                setTimeout(() => setConfigMsg({ text: '', isError: false }), 3000);
                                                loadLogs(undefined, true);
                                            } catch (err) { setConfigMsg({ text: 'Failed: ' + err.message, isError: true }); }
                                            finally { setSavingConfig(false); }
                                        }}
                                        disabled={savingConfig}
                                        style={{ padding: '3px 8px', borderRadius: '6px', border: `1px solid ${theme.colors.border}`, background: theme.colors.cardBackground || theme.colors.background, color: theme.colors.primaryText, fontSize: '0.8rem', cursor: 'pointer' }}>
                                        {['Off', 'Error', 'Warning', 'Info', 'Debug', 'Trace'].map(l => <option key={l} value={l}>{l}</option>)}
                                    </select>
                                    <button onClick={async () => {
                                        if (!window.confirm('Clear all log entries?')) return;
                                        setSavingConfig(true); setConfigMsg({ text: '', isError: false });
                                        try {
                                            const bot = await getReadyBotActor();
                                            await bot.clearLogs();
                                            setConfigMsg({ text: 'Logs cleared', isError: false });
                                            setTimeout(() => setConfigMsg({ text: '', isError: false }), 3000);
                                            loadLogs();
                                        } catch (err) { setConfigMsg({ text: 'Failed: ' + err.message, isError: true }); }
                                        finally { setSavingConfig(false); }
                                    }} disabled={savingConfig}
                                        style={{ padding: '4px 12px', borderRadius: '8px', border: '1px solid #ef444440', background: '#ef444410', color: '#ef4444', fontSize: '0.8rem', cursor: 'pointer' }}>
                                        Clear Logs
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {configMsg.text && (
                        <div style={{ ...cardStyle, background: configMsg.isError ? '#ef444415' : '#22c55e15', border: `1px solid ${configMsg.isError ? '#ef444430' : '#22c55e30'}`, color: configMsg.isError ? '#ef4444' : '#22c55e', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ flex: 1 }}>{configMsg.text}</span>
                            <button onClick={() => setConfigMsg({ text: '', isError: false })} title="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: '2px', fontSize: '0.9rem', lineHeight: 1, flexShrink: 0, opacity: 0.7 }}>×</button>
                        </div>
                    )}

                    {/* Log entries */}
                    {entries.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {entries.slice().reverse().map(entry => {
                                const levelKey = Object.keys(entry.level)[0];
                                const levelColor = BOT_LOG_LEVEL_COLORS[levelKey] || '#6b7280';
                                const ts = new Date(Number(entry.timestamp) / 1_000_000);
                                const timeStr = ts.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

                                const tagMap = {};
                                for (const [k, v] of entry.tags) tagMap[k] = v;

                                let enhancedMsg = entry.message;
                                enhancedMsg = enhancedMsg.replace(/\bdex (\d+)\b/gi, (_, id) => DEX_NAMES[id] || `DEX ${id}`);
                                enhancedMsg = enhancedMsg.replace(/\b(\d+) bps\b/g, (_, n) => fmtBps(n));
                                for (const [amtKey, tokKey] of Object.entries(BOT_LOG_AMOUNT_TO_TOKEN)) {
                                    const rawVal = tagMap[amtKey];
                                    if (!rawVal || rawVal === '0') continue;
                                    const tokId = tokKey ? tagMap[tokKey] : null;
                                    const dec = tokId && tokenMeta[tokId] ? tokenMeta[tokId].decimals : 8;
                                    const sym = tokId && tokenMeta[tokId] ? tokenMeta[tokId].symbol : '';
                                    const formatted = fmtLogAmt(rawVal, dec);
                                    const re = new RegExp('\\b' + rawVal + '\\b');
                                    if (re.test(enhancedMsg)) {
                                        enhancedMsg = enhancedMsg.replace(re, formatted + (sym ? ` ${sym}` : ''));
                                    }
                                }

                                const renderedTags = [];
                                const skipKeys = new Set();
                                if (tagMap.inputToken) {
                                    const inId = tagMap.inputToken;
                                    const outId = tagMap.outputToken;
                                    const inMeta = tokenMeta[inId];
                                    const outMeta = outId ? tokenMeta[outId] : null;
                                    renderedTags.push(
                                        <span key="token-pair" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '1px 8px', borderRadius: '4px', fontSize: '0.7rem', background: `${accentColor}12`, color: theme.colors.primaryText }}>
                                            <TokenIcon canisterId={inId} size={14} />
                                            <span style={{ fontWeight: 600 }}>{inMeta?.symbol || shortPrincipal(inId)}</span>
                                            {outId && <>
                                                <span style={{ color: theme.colors.mutedText, margin: '0 2px' }}>→</span>
                                                <TokenIcon canisterId={outId} size={14} />
                                                <span style={{ fontWeight: 600 }}>{outMeta?.symbol || shortPrincipal(outId)}</span>
                                            </>}
                                        </span>
                                    );
                                    skipKeys.add('inputToken');
                                    if (outId) skipKeys.add('outputToken');
                                }
                                if (tagMap.inputAmount) {
                                    const inId = tagMap.inputToken;
                                    const outId = tagMap.outputToken;
                                    const inDec = tokenMeta[inId]?.decimals ?? 8;
                                    const inSym = tokenMeta[inId]?.symbol || '';
                                    const outDec = outId ? (tokenMeta[outId]?.decimals ?? 8) : 8;
                                    const outSym = outId ? (tokenMeta[outId]?.symbol || '') : '';
                                    renderedTags.push(
                                        <span key="amounts" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '1px 8px', borderRadius: '4px', fontSize: '0.7rem', background: `${theme.colors.border}60`, color: theme.colors.primaryText, fontFamily: 'monospace' }}>
                                            {fmtLogAmt(tagMap.inputAmount, inDec)}{inSym ? ` ${inSym}` : ''}
                                            {tagMap.outputAmount && <>
                                                <span style={{ color: theme.colors.mutedText }}>→</span>
                                                {fmtLogAmt(tagMap.outputAmount, outDec)}{outSym ? ` ${outSym}` : ''}
                                            </>}
                                        </span>
                                    );
                                    skipKeys.add('inputAmount');
                                    skipKeys.add('outputAmount');
                                }
                                if (tagMap.dexId != null) {
                                    renderedTags.push(
                                        <span key="dex" style={{ padding: '1px 8px', borderRadius: '4px', fontSize: '0.7rem', background: `${theme.colors.border}60`, color: theme.colors.secondaryText }}>
                                            {DEX_NAMES[tagMap.dexId] || `DEX ${tagMap.dexId}`}
                                        </span>
                                    );
                                    skipKeys.add('dexId');
                                }
                                entry.tags.forEach(([k, v], i) => {
                                    if (skipKeys.has(k)) return;
                                    if (BOT_LOG_TOKEN_TAG_KEYS.has(k) && v && v.length > 10) {
                                        const meta = tokenMeta[v];
                                        renderedTags.push(
                                            <span key={`t-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', background: `${theme.colors.border}60`, color: theme.colors.secondaryText }}>
                                                <span style={{ opacity: 0.7 }}>{k}:</span>
                                                <TokenIcon canisterId={v} size={13} />
                                                <span>{meta?.symbol || shortPrincipal(v)}</span>
                                            </span>
                                        );
                                    } else if (BOT_LOG_BPS_TAG_KEYS.has(k)) {
                                        renderedTags.push(
                                            <span key={`t-${i}`} style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', background: `${theme.colors.border}60`, color: theme.colors.secondaryText, fontFamily: 'monospace' }}>
                                                <span style={{ opacity: 0.7 }}>{k.replace(/Bps$/, '')}:</span> {fmtBps(v)}
                                            </span>
                                        );
                                    } else if (BOT_LOG_AMOUNT_TAG_KEYS.has(k)) {
                                        const pairedKey = BOT_LOG_AMOUNT_TO_TOKEN[k];
                                        const pairedId = pairedKey ? tagMap[pairedKey] : null;
                                        const dec = pairedId && tokenMeta[pairedId] ? tokenMeta[pairedId].decimals : 8;
                                        const sym = pairedId && tokenMeta[pairedId] ? tokenMeta[pairedId].symbol : '';
                                        renderedTags.push(
                                            <span key={`t-${i}`} style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', background: `${theme.colors.border}60`, color: theme.colors.secondaryText, fontFamily: 'monospace' }}>
                                                <span style={{ opacity: 0.7 }}>{k}:</span> {fmtLogAmt(v, dec)}{sym ? ` ${sym}` : ''}
                                            </span>
                                        );
                                    } else {
                                        renderedTags.push(
                                            <span key={`t-${i}`} style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', background: `${theme.colors.border}60`, color: theme.colors.secondaryText }}>
                                                <span style={{ opacity: 0.7 }}>{k}:</span> {v}
                                            </span>
                                        );
                                    }
                                });

                                return (
                                    <div key={Number(entry.id)} style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '8px 12px', background: theme.colors.cardBackground || theme.colors.background, borderLeft: `3px solid ${levelColor}`, borderRadius: '4px', fontSize: '0.8rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                            <span style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600', background: `${levelColor}20`, color: levelColor, minWidth: '48px', textAlign: 'center' }}>{levelKey.toUpperCase()}</span>
                                            <span style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', background: `${accentColor}15`, color: accentColor }}>{entry.source}</span>
                                            <span style={{ color: theme.colors.primaryText, flex: 1 }}>{enhancedMsg}</span>
                                            <span style={{ color: theme.colors.mutedText, fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{timeStr}</span>
                                            <span style={{ color: theme.colors.mutedText, fontSize: '0.65rem', opacity: 0.6 }}>#{Number(entry.id)}</span>
                                        </div>
                                        {renderedTags.length > 0 && (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginLeft: '56px', alignItems: 'center' }}>
                                                {renderedTags}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div style={{ ...cardStyle, textAlign: 'center', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>
                            No log entries found{selectedLevelKey || logFilter.source.length > 0 ? ' matching the current filters' : ''}.
                        </div>
                    )}

                    {/* Pagination */}
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '10px', flexWrap: 'wrap' }}>
                        {!isFirstPage && (
                            <button onClick={() => { const nf = { ...logFilter, startId: [] }; setLogFilter(nf); loadLogs(nf); }}
                                style={{ padding: '6px 14px', borderRadius: '8px', border: `1px solid ${theme.colors.border}`, background: 'transparent', color: theme.colors.primaryText, fontSize: '0.8rem', cursor: 'pointer' }}>
                                « Newest
                            </button>
                        )}
                        {!isFirstPage && entries.length > 0 && (
                            <button onClick={() => {
                                const last = entries[entries.length - 1];
                                const nf = { ...logFilter, startId: [BigInt(Number(last.id) + 1)] };
                                setLogFilter(nf); loadLogs(nf);
                            }} style={{ padding: '6px 14px', borderRadius: '8px', border: `1px solid ${theme.colors.border}`, background: 'transparent', color: theme.colors.primaryText, fontSize: '0.8rem', cursor: 'pointer' }}>
                                ‹ Newer
                            </button>
                        )}
                        {entries.length > 0 && Number(entries[0].id) > 0 && (
                            <button onClick={() => {
                                const first = entries[0];
                                const nf = { ...logFilter, startId: [BigInt(Math.max(0, Number(first.id) - pageSize))] };
                                setLogFilter(nf); loadLogs(nf);
                            }} style={{ padding: '6px 14px', borderRadius: '8px', border: `1px solid ${theme.colors.border}`, background: 'transparent', color: theme.colors.primaryText, fontSize: '0.8rem', cursor: 'pointer' }}>
                                Older »
                            </button>
                        )}
                    </div>

                    {logConfig && (
                        <div style={{ textAlign: 'center', padding: '8px', fontSize: '0.7rem', color: theme.colors.mutedText }}>
                            Showing {entries.length} of {totalMatching.toLocaleString()} matching · {Number(logConfig.entryCount).toLocaleString()} total stored · Max: {Number(logConfig.maxEntries).toLocaleString()}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// ============================================
// Logs Tab Panel — combines Bot Log, Trade Log, Portfolio Snapshots, Logging Settings
// ============================================
function LogsTabPanel({ getReadyBotActor, theme, accentColor, choreStatuses }) {
    const [subTab, setSubTab] = useState('trade-log');

    const subTabStyle = (active) => ({
        padding: '5px 14px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: active ? '600' : '400',
        color: active ? accentColor : theme.colors.secondaryText,
        background: active ? `${accentColor}10` : 'transparent',
        border: `1px solid ${active ? accentColor + '40' : theme.colors.border}`,
        borderRadius: '16px', whiteSpace: 'nowrap',
    });

    return (
        <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                <button onClick={() => setSubTab('trade-log')} style={subTabStyle(subTab === 'trade-log')}>Trade Log</button>
                <button onClick={() => setSubTab('snapshots')} style={subTabStyle(subTab === 'snapshots')}>Portfolio Snapshots</button>
                <button onClick={() => setSubTab('bot-log')} style={subTabStyle(subTab === 'bot-log')}>Bot Log</button>
                <button onClick={() => setSubTab('settings')} style={subTabStyle(subTab === 'settings')}>Logging Settings</button>
            </div>
            {subTab === 'bot-log' && <BotLogPanel getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} />}
            {subTab === 'trade-log' && <TradeLogViewer getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} />}
            {subTab === 'snapshots' && <PortfolioSnapshotViewer getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} />}
            {subTab === 'settings' && <LoggingSettingsPanel getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} choreStatuses={choreStatuses} />}
        </div>
    );
}

// ============================================
// Chores Overview Panel — bird's-eye view of all chore instances
// ============================================
const CHORE_TYPE_ICONS = { trade: '📈', rebalance: '⚖️', 'move-funds': '💸', 'distribute-funds': '📤', snapshot: '📊' };
const CHORE_TYPE_LABELS_MAP = { trade: 'Trade', rebalance: 'Rebalance', 'move-funds': 'Move Funds', 'distribute-funds': 'Distribute', snapshot: 'Snapshot' };

function ChoresOverviewPanel({ choreStatuses, cbEvents, theme, accentColor, onNavigateToChore }) {
    if (!choreStatuses || choreStatuses.length === 0) {
        return <div style={{ textAlign: 'center', padding: '24px', color: theme.colors.mutedText, fontSize: '0.85rem' }}>No chore instances found.</div>;
    }

    const fmtNextRun = (chore) => {
        if (chore.nextScheduledRunAt?.length > 0) {
            const ms = Number(chore.nextScheduledRunAt[0]) / 1_000_000;
            if (ms > 0) {
                const diff = ms - Date.now();
                if (diff > 0 && diff < 86400000) {
                    const min = Math.floor(diff / 60000);
                    const sec = Math.floor((diff % 60000) / 1000);
                    return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
                }
                return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            }
        }
        return '—';
    };

    const fmtLastRun = (chore) => {
        if (chore.lastCompletedRunAt?.length > 0) {
            const ms = Number(chore.lastCompletedRunAt[0]) / 1_000_000;
            if (ms > 0) {
                const ago = Date.now() - ms;
                if (ago < 60000) return `${Math.floor(ago / 1000)}s ago`;
                if (ago < 3600000) return `${Math.floor(ago / 60000)}m ago`;
                if (ago < 86400000) return `${Math.floor(ago / 3600000)}h ago`;
                return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            }
        }
        return '—';
    };

    const fmtInterval = (chore) => {
        const s = Number(chore.intervalSeconds);
        if (!s || s <= 0) return '—';
        if (s < 60) return `${s}s`;
        if (s < 3600) return `${Math.floor(s / 60)}m`;
        if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
        return `${(s / 86400).toFixed(1)}d`;
    };

    const stateLabel = (chore) => {
        if (!chore.enabled) return 'Stopped';
        if (chore.paused) return 'Paused';
        if (chore.stopRequested) return 'Stopping';
        if (!('Idle' in chore.conductorStatus)) return 'Running';
        if ('Scheduled' in chore.schedulerStatus) return 'Scheduled';
        return 'Idle';
    };

    const byType = {};
    for (const c of choreStatuses) {
        const tid = c.choreTypeId || c.choreId;
        if (!byType[tid]) byType[tid] = [];
        byType[tid].push(c);
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {Object.entries(byType).map(([typeId, chores]) => (
                <div key={typeId}>
                    <div style={{ fontSize: '0.72rem', fontWeight: '600', color: theme.colors.secondaryText, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '6px 0 4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>{CHORE_TYPE_ICONS[typeId] || '⚙️'}</span>
                        {CHORE_TYPE_LABELS_MAP[typeId] || typeId}
                        <span style={{ fontWeight: '400', opacity: 0.6 }}>({chores.length})</span>
                    </div>
                    {chores.map(chore => {
                        const summaryLamp = getChoreSummaryLamp(chore, cbEvents);
                        const sLamp = getSchedulerLampState(chore, cbEvents);
                        const cLamp = getConductorLampState(chore);
                        const tLamp = getTaskLampState(chore);
                        const state = stateLabel(chore);
                        const isRunning = !('Idle' in chore.conductorStatus);
                        const label = chore.instanceLabel || chore.choreName || chore.choreId;

                        return (
                            <div key={chore.choreId} onClick={() => onNavigateToChore && onNavigateToChore(typeId, chore.choreId)}
                                style={{
                                    padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
                                    border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg,
                                    marginBottom: '4px', transition: 'border-color 0.15s',
                                }}
                                onMouseEnter={e => e.currentTarget.style.borderColor = accentColor + '60'}
                                onMouseLeave={e => e.currentTarget.style.borderColor = theme.colors.border}>
                                {/* Top row: lamp, name, state badge */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                    <StatusLamp state={summaryLamp} size={10} label={sLamp.label} />
                                    <span style={{ fontSize: '0.85rem', fontWeight: '600', color: theme.colors.primaryText, flex: 1 }}>{label}</span>
                                    <span style={{
                                        fontSize: '0.68rem', fontWeight: '600', padding: '2px 8px', borderRadius: '4px',
                                        background: isRunning ? '#22c55e18' : chore.enabled ? `${accentColor}12` : `${theme.colors.border}40`,
                                        color: isRunning ? '#22c55e' : chore.enabled ? accentColor : theme.colors.mutedText,
                                    }}>{state}</span>
                                </div>
                                {/* Detail row: lamps + timing */}
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '0.72rem', color: theme.colors.secondaryText }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title={sLamp.label}>
                                        <StatusLamp state={sLamp.state} size={6} /> Sched
                                    </span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title={cLamp.label}>
                                        <StatusLamp state={cLamp.state} size={6} /> Cond
                                    </span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title={tLamp.label}>
                                        <StatusLamp state={tLamp.state} size={6} /> Task
                                    </span>
                                    <span style={{ marginLeft: 'auto', display: 'flex', gap: '12px' }}>
                                        <span title="Interval">⏱ {fmtInterval(chore)}</span>
                                        <span title="Next run">⏭ {fmtNextRun(chore)}</span>
                                        <span title="Last run">✓ {fmtLastRun(chore)}</span>
                                    </span>
                                </div>
                                {/* Runs count */}
                                <div style={{ display: 'flex', gap: '12px', fontSize: '0.68rem', color: theme.colors.mutedText, marginTop: '4px' }}>
                                    <span>Runs: {Number(chore.totalRunCount || 0)}</span>
                                    {Number(chore.failedRunCount || 0) > 0 && <span style={{ color: '#ef4444' }}>Failed: {Number(chore.failedRunCount)}</span>}
                                    {chore.currentTaskId?.[0] && <span style={{ color: accentColor }}>Task: {chore.currentTaskId[0]}</span>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}

// ============================================
// Trading Bot Logs Section (combines trade log, portfolio snapshots, logging settings)
// ============================================
function TradingBotLogs({ canisterId, createBotActorFn, theme, accentColor, identity, botPanelRef, cbEvents, tokenRegistry, choreInstances }) {
    const [activeTab, setActiveTab] = useState('wallet');
    const [choreStatuses, setChoreStatuses] = useState([]);
    const agentRef = useRef(null);
    const actorRef = useRef(null);

    const getReadyBotActor = useCallback(async () => {
        if (actorRef.current) return actorRef.current;
        const { HttpAgent } = await import('@dfinity/agent');
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
        const agent = HttpAgent.createSync({ identity, host });
        if (isLocal) await agent.fetchRootKey();
        agentRef.current = agent;
        const actor = createBotActorFn(canisterId, { agent });
        actorRef.current = actor;
        return actor;
    }, [canisterId, identity, createBotActorFn]);

    // Load chore statuses for the logging settings per-chore overrides
    useEffect(() => {
        (async () => {
            try {
                const bot = await getReadyBotActor();
                if (bot?.getChoreStatuses) {
                    const statuses = await bot.getChoreStatuses();
                    setChoreStatuses(statuses);
                }
            } catch (_) {}
        })();
    }, [getReadyBotActor]);

    const handleNavigateToChore = useCallback((choreTypeId, choreInstanceId) => {
        if (botPanelRef?.current?.navigateToChore) {
            botPanelRef.current.navigateToChore(choreTypeId, choreInstanceId);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, [botPanelRef]);

    const tabStyle = (active) => ({
        padding: '6px 16px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: '500',
        borderBottom: `2px solid ${active ? accentColor : 'transparent'}`,
        color: active ? accentColor : theme.colors.secondaryText,
        background: 'none', border: 'none', borderRadius: 0, whiteSpace: 'nowrap',
    });

    return (
        <div style={{ marginTop: '16px' }}>
            {/* Tab bar */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px', borderBottom: `1px solid ${theme.colors.border}`, paddingBottom: '0' }}>
                <button onClick={() => setActiveTab('chores')} style={tabStyle(activeTab === 'chores')}>
                    <FaRobot style={{ marginRight: '4px', fontSize: '0.75rem' }} />Chores
                </button>
                <button onClick={() => setActiveTab('wallet')} style={tabStyle(activeTab === 'wallet')}>
                    <FaWallet style={{ marginRight: '4px', fontSize: '0.75rem' }} />Wallet
                </button>
                <button onClick={() => setActiveTab('performance')} style={tabStyle(activeTab === 'performance')}>Performance</button>
                <button onClick={() => setActiveTab('logs')} style={tabStyle(activeTab === 'logs')}>
                    <FaChartLine style={{ marginRight: '4px', fontSize: '0.75rem' }} />Logs
                </button>
                <button onClick={() => setActiveTab('circuit-breaker')} style={tabStyle(activeTab === 'circuit-breaker')}>
                    <FaShieldAlt style={{ marginRight: '4px', fontSize: '0.75rem' }} />Circuit Breaker
                </button>
                <button onClick={() => setActiveTab('quick-trade')} style={tabStyle(activeTab === 'quick-trade')}>
                    <FaExchangeAlt style={{ marginRight: '4px', fontSize: '0.75rem' }} />Quick Trade
                </button>
                <button onClick={() => setActiveTab('recovery')} style={tabStyle(activeTab === 'recovery')}>
                    <FaMedkit style={{ marginRight: '4px', fontSize: '0.75rem' }} />Recovery
                </button>
                <button onClick={() => setActiveTab('script')} style={tabStyle(activeTab === 'script')}>
                    <FaCode style={{ marginRight: '4px', fontSize: '0.75rem' }} />Script
                </button>
            </div>

            {activeTab === 'chores' && <ChoresOverviewPanel choreStatuses={choreStatuses} cbEvents={cbEvents} theme={theme} accentColor={accentColor} onNavigateToChore={handleNavigateToChore} />}
            {activeTab === 'wallet' && <WalletPanel getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} canisterId={canisterId} choreStatuses={choreStatuses} />}
            {activeTab === 'performance' && <PerformancePanel getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} choreStatuses={choreStatuses} />}
            {activeTab === 'logs' && <LogsTabPanel getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} choreStatuses={choreStatuses} />}
            {activeTab === 'circuit-breaker' && <CircuitBreakerPanel getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} choreStatuses={choreStatuses} />}
            {activeTab === 'quick-trade' && <QuickTradePanel canisterId={canisterId} createBotActor={createBotActorFn} identity={identity} tokenRegistry={tokenRegistry} choreInstances={choreInstances} />}
            {activeTab === 'recovery' && <RecoveryPanel getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} canisterId={canisterId} />}
            {activeTab === 'script' && <TradingBotDSLPanel canisterId={canisterId} getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} />}
        </div>
    );
}

// ============================================
// SNAPSHOT CHORE CONFIG PANEL
// ============================================
function SnapshotChoreConfigPanel({ instanceId, theme, accentColor, cardStyle }) {
    const features = [
        { icon: '📊', label: 'Balance Snapshots', desc: 'Captures balances of all registered tokens in the main account.' },
        { icon: '💹', label: 'Price Snapshots', desc: 'Fetches fresh quotes for all registered token pairs, updating price history and daily candles.' },
        { icon: '📁', label: 'Daily Archive', desc: 'Finalizes the previous day\'s OHLC summaries for portfolio value and prices, patching any gaps.' },
    ];

    return (
        <div style={{ ...cardStyle, padding: '16px' }}>
            <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText, marginBottom: '12px' }}>
                This chore runs a full snapshot cycle each time it fires. Use the interval setting above to control how often snapshots are taken.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {features.map((f, i) => (
                    <div key={i} style={{
                        display: 'flex', alignItems: 'flex-start', gap: '10px',
                        padding: '10px 12px', borderRadius: '8px',
                        background: theme.colors.primaryBg, border: `1px solid ${theme.colors.border}`,
                    }}>
                        <span style={{ fontSize: '1.2rem', lineHeight: '1' }}>{f.icon}</span>
                        <div>
                            <div style={{ fontWeight: '600', fontSize: '0.8rem', color: theme.colors.primaryText, marginBottom: '2px' }}>{f.label}</div>
                            <div style={{ fontSize: '0.72rem', color: theme.colors.mutedText }}>{f.desc}</div>
                        </div>
                    </div>
                ))}
            </div>
            <div style={{ marginTop: '12px', padding: '8px 12px', borderRadius: '6px', background: `${accentColor}08`, border: `1px solid ${accentColor}20`, fontSize: '0.72rem', color: theme.colors.secondaryText }}>
                <strong>Pipeline:</strong> Metadata Refresh → Price Fetch → Balance Snapshots → Daily Archive
            </div>
        </div>
    );
}

// ============================================
// Purses Overview Tab
// ============================================
function PursesPanel({ getReadyBotActor, theme, accentColor, canisterId, choreStatuses }) {
    const { identity } = useAuth();
    const [allPurses, setAllPurses] = useState([]);
    const [onChainBalances, setOnChainBalances] = useState({});
    const [loading, setLoading] = useState(true);
    const [balancesLoading, setBalancesLoading] = useState(false);
    const [error, setError] = useState(null);

    const borderColor = theme.colors.border;
    const cardBg = theme.colors.cardBg;

    const tokLabel = (tok) => {
        const p = typeof tok === 'string' ? tok : tok?.toText?.() || tok?.toString?.() || '';
        const cached = getTokenMetadataSync(p);
        return cached?.symbol || p.slice(0, 8) + '...';
    };
    const tokDecimals = (tok) => {
        const p = typeof tok === 'string' ? tok : tok?.toText?.() || tok?.toString?.() || '';
        const cached = getTokenMetadataSync(p);
        return cached?.decimals ?? 8;
    };
    const fmtBal = (raw, decimals) => {
        const n = Number(raw);
        if (isNaN(n)) return '0';
        return (n / (10 ** Number(decimals))).toLocaleString(undefined, { maximumFractionDigits: Number(decimals) });
    };

    const choreLabel = (instanceId) => {
        if (!choreStatuses) return instanceId;
        const cs = choreStatuses.find(c => c.choreId === instanceId);
        return cs?.instanceLabel || instanceId;
    };

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const actor = await getReadyBotActor();
            const [purses, registry] = await Promise.all([
                actor.getAllPurseAllocations(),
                actor.getTokenRegistry ? actor.getTokenRegistry() : [],
            ]);
            setAllPurses(purses);

            // Build full token set from registry + any tokens mentioned in purses
            const tokenSet = new Set();
            for (const t of registry) {
                const tid = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
                tokenSet.add(tid);
            }
            for (const chore of purses) {
                for (const b of chore.balances) {
                    const tok = typeof b.token === 'string' ? b.token : b.token?.toText?.() || String(b.token);
                    tokenSet.add(tok);
                }
            }

            // Fetch on-chain balances for all registered tokens from ledgers
            if (tokenSet.size > 0 && canisterId) {
                setBalancesLoading(true);
                try {
                    const { HttpAgent } = await import('@dfinity/agent');
                    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                    const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
                    const agent = HttpAgent.createSync({ identity, host });
                    if (isLocal) await agent.fetchRootKey();
                    const botPrincipal = Principal.fromText(canisterId);

                    const tokens = [...tokenSet];
                    const results = {};
                    await Promise.all(tokens.map(async (tid) => {
                        try {
                            const ledgerActor = createLedgerActor(tid, { agent });
                            const bal = await ledgerActor.icrc1_balance_of({ owner: botPrincipal, subaccount: [] });
                            results[tid] = BigInt(bal);
                        } catch (_) { results[tid] = 0n; }
                    }));
                    setOnChainBalances(results);
                } catch (e) {
                    console.warn('PursesPanel: failed to fetch on-chain balances', e);
                } finally {
                    setBalancesLoading(false);
                }
            }
        } catch (e) {
            setError(e?.message || String(e));
        } finally {
            setLoading(false);
        }
    }, [getReadyBotActor, canisterId, identity]);

    useEffect(() => { loadData(); }, [loadData]);

    // Compute totals
    const totalAllocated = {};
    const allTokens = new Set();
    for (const chore of allPurses) {
        for (const b of chore.balances) {
            const tok = typeof b.token === 'string' ? b.token : b.token?.toText?.() || String(b.token);
            allTokens.add(tok);
            totalAllocated[tok] = (totalAllocated[tok] || 0n) + BigInt(b.balance);
        }
    }

    const mainPurseEntries = [];
    const seenTokens = new Set();
    for (const tok of allTokens) {
        seenTokens.add(tok);
        const chain = onChainBalances[tok] || 0n;
        const allocated = totalAllocated[tok] || 0n;
        const available = chain > allocated ? chain - allocated : 0n;
        const overcommitted = allocated > chain;
        if (chain > 0n || overcommitted) {
            mainPurseEntries.push({ token: tok, balance: available, onChain: chain, allocated, overcommitted });
        }
    }
    for (const [tok, chain] of Object.entries(onChainBalances)) {
        if (!seenTokens.has(tok) && chain > 0n) {
            mainPurseEntries.push({ token: tok, balance: chain, onChain: chain, allocated: 0n, overcommitted: false });
        }
    }

    const enabledPurses = allPurses.filter(p => p.enabled && p.balances.length > 0);

    const thStyle = { textAlign: 'left', padding: '6px 10px', color: theme.colors.secondaryText, fontWeight: 500, fontSize: '0.78rem' };
    const thStyleR = { ...thStyle, textAlign: 'right' };
    const tdStyle = { padding: '6px 10px', color: theme.colors.primaryText, fontSize: '0.82rem' };
    const tdStyleR = { ...tdStyle, textAlign: 'right', fontFamily: 'monospace' };
    const rowBorder = { borderBottom: `1px solid ${borderColor}` };

    if (loading) return <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText, padding: '16px 0' }}>Loading purse data...</div>;
    if (error) return <div style={{ color: '#e74c3c', fontSize: '0.85rem', padding: '16px 0' }}>{error}</div>;

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <FaWallet style={{ color: accentColor }} /> Purse Overview
                </h3>
                <button onClick={loadData} style={{
                    padding: '4px 10px', fontSize: '0.75rem', border: `1px solid ${borderColor}`,
                    borderRadius: '6px', cursor: 'pointer', background: cardBg, color: theme.colors.primaryText,
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                }}>
                    <FaSyncAlt size={10} /> Refresh
                </button>
                {balancesLoading && <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>fetching balances...</span>}
            </div>

            {/* Main Purse */}
            <div style={{ padding: '12px', background: cardBg, borderRadius: '10px', border: `1px solid ${borderColor}`, marginBottom: '14px' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '0.85rem', fontWeight: 600, color: theme.colors.primaryText }}>
                    Main Purse
                </h4>
                <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText || theme.colors.secondaryText, marginBottom: '8px' }}>
                    Unallocated funds available for chores without a dedicated purse, or to fund chore purses.
                </div>
                {mainPurseEntries.length === 0 ? (
                    <div style={{ fontSize: '0.82rem', color: theme.colors.secondaryText, fontStyle: 'italic' }}>No token balances detected.</div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={rowBorder}>
                                <th style={thStyle}>Token</th>
                                <th style={thStyleR}>Available</th>
                                <th style={thStyleR}>Allocated</th>
                                <th style={thStyleR}>On-chain</th>
                            </tr>
                        </thead>
                        <tbody>
                            {mainPurseEntries.map((e, i) => {
                                const dec = tokDecimals(e.token);
                                return (
                                    <tr key={i} style={rowBorder}>
                                        <td style={tdStyle}>
                                            {tokLabel(e.token)}
                                            {e.overcommitted && <span style={{ color: '#e74c3c', fontSize: '0.72rem', marginLeft: '6px' }}>overcommitted</span>}
                                        </td>
                                        <td style={tdStyleR}>{fmtBal(e.balance, dec)}</td>
                                        <td style={{ ...tdStyleR, color: theme.colors.secondaryText }}>{fmtBal(e.allocated, dec)}</td>
                                        <td style={{ ...tdStyleR, color: theme.colors.secondaryText }}>{fmtBal(e.onChain, dec)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Per-chore purses */}
            {enabledPurses.length === 0 ? (
                <div style={{ fontSize: '0.82rem', color: theme.colors.secondaryText, fontStyle: 'italic', padding: '8px 0' }}>
                    No chores have funded purses yet. Enable a purse in a chore's settings to isolate its balances.
                </div>
            ) : (
                enabledPurses.map((chore) => (
                    <div key={chore.instanceId} style={{ padding: '12px', background: cardBg, borderRadius: '10px', border: `1px solid ${borderColor}`, marginBottom: '10px' }}>
                        <h4 style={{ margin: '0 0 6px 0', fontSize: '0.85rem', fontWeight: 600, color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <FaWallet style={{ color: accentColor, fontSize: '0.75rem' }} />
                            {choreLabel(chore.instanceId)}
                        </h4>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={rowBorder}>
                                    <th style={thStyle}>Token</th>
                                    <th style={thStyleR}>Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {chore.balances.filter(b => Number(b.balance) > 0).map((b, i) => {
                                    const tok = typeof b.token === 'string' ? b.token : b.token?.toText?.() || String(b.token);
                                    const dec = tokDecimals(tok);
                                    return (
                                        <tr key={i} style={rowBorder}>
                                            <td style={tdStyle}>
                                                {tokLabel(tok)}
                                                {b.subaccountNumber?.[0] != null ? ` (sub ${Number(b.subaccountNumber[0])})` : ''}
                                            </td>
                                            <td style={tdStyleR}>{fmtBal(b.balance, dec)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ))
            )}
        </div>
    );
}

// ============================================
// Wallet Panel (combined on-chain balances + purse allocations)
// ============================================
function WalletPanel({ getReadyBotActor, theme, accentColor, canisterId, choreStatuses }) {
    const { identity } = useAuth();
    const { whitelistedTokens } = useWhitelistTokens();
    const [tokenRegistry, setTokenRegistry] = useState([]);
    const [mainBalances, setMainBalances] = useState({});
    const [allPurses, setAllPurses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [balancesLoading, setBalancesLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [scanning, setScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState(null);

    const [activeOp, setActiveOp] = useState(null);
    const [opToken, setOpToken] = useState('');
    const [opAmount, setOpAmount] = useState('');
    const [opDestination, setOpDestination] = useState('');
    const [opDestSubaccount, setOpDestSubaccount] = useState('');
    const [opExecuting, setOpExecuting] = useState(false);

    const [fundTarget, setFundTarget] = useState(null);
    const [fundSource, setFundSource] = useState('main');
    const [fundToken, setFundToken] = useState('');
    const [fundAmount, setFundAmount] = useState('');
    const [reclaimTarget, setReclaimTarget] = useState(null);
    const [reclaimToken, setReclaimToken] = useState('');
    const [reclaimAmount, setReclaimAmount] = useState('');
    const [withdrawTarget, setWithdrawTarget] = useState(null);
    const [withdrawToken, setWithdrawToken] = useState('');
    const [withdrawAmount, setWithdrawAmount] = useState('');
    const [purseSaving, setPurseSaving] = useState(false);
    const [reclaimingAll, setReclaimingAll] = useState(false);
    const [fundSourceBalance, setFundSourceBalance] = useState(null);
    const [fundBalanceLoading, setFundBalanceLoading] = useState(false);

    // Token registration
    const [addTokenValue, setAddTokenValue] = useState('');
    const [addingToken, setAddingToken] = useState(false);
    const [showTokenManager, setShowTokenManager] = useState(false);
    // Denomination selector for value display
    const [denomToken, setDenomToken] = useState(CKUSDC_LEDGER);
    const [denomPrices, setDenomPrices] = useState({});
    const [loadingPrices, setLoadingPrices] = useState(false);
    // Token pause/freeze state
    const [pausedTokens, setPausedTokens] = useState(new Set());
    const [frozenTokens, setFrozenTokens] = useState(new Set());
    const [togglingToken, setTogglingToken] = useState(null);

    const borderColor = theme.colors.border;
    const cardBg = theme.colors.cardBg || theme.colors.cardGradient;
    const inputStyle = { padding: '6px 10px', borderRadius: '6px', border: `1px solid ${borderColor}`, background: theme.colors.primaryBg, color: theme.colors.primaryText, fontSize: '0.8rem', outline: 'none' };
    const btnStyle = { padding: '4px 10px', borderRadius: '6px', border: `1px solid ${accentColor}40`, background: 'none', color: accentColor, cursor: 'pointer', fontSize: '0.75rem', fontWeight: '500' };
    const thStyle = { textAlign: 'left', padding: '6px 10px', color: theme.colors.secondaryText, fontWeight: 500, fontSize: '0.78rem' };
    const thStyleR = { ...thStyle, textAlign: 'right' };
    const tdStyle = { padding: '6px 10px', color: theme.colors.primaryText, fontSize: '0.82rem' };
    const tdStyleR = { ...tdStyle, textAlign: 'right', fontFamily: 'monospace' };
    const rowBorder = { borderBottom: `1px solid ${borderColor}` };

    const allTokenIds = React.useMemo(() => {
        const ids = new Set();
        for (const t of tokenRegistry) {
            const tid = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
            ids.add(tid);
        }
        for (const chore of allPurses) {
            for (const b of chore.balances) {
                const tok = typeof b.token === 'string' ? b.token : b.token?.toText?.() || String(b.token);
                ids.add(tok);
            }
        }
        return [...ids];
    }, [tokenRegistry, allPurses]);
    useTokenMetadata(allTokenIds, identity);

    const tokLabel = (tok) => {
        const p = typeof tok === 'string' ? tok : tok?.toText?.() || tok?.toString?.() || '';
        const cached = getTokenMetadataSync(p);
        return cached?.symbol || shortPrincipal(p);
    };
    const tokDecimals = (tok) => {
        const p = typeof tok === 'string' ? tok : tok?.toText?.() || tok?.toString?.() || '';
        const cached = getTokenMetadataSync(p);
        return cached?.decimals ?? 8;
    };
    const fmtBal = (raw, decimals) => {
        const n = Number(raw);
        if (isNaN(n)) return '0';
        return (n / (10 ** Number(decimals))).toLocaleString(undefined, { maximumFractionDigits: Number(decimals) });
    };
    const choreLabel = (instanceId) => {
        if (!choreStatuses) return instanceId;
        const cs = choreStatuses.find(c => c.choreId === instanceId);
        return cs?.instanceLabel || instanceId;
    };

    const loadData = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const bot = await getReadyBotActor();
            const [registry, purses, paused, frozen] = await Promise.all([
                bot.getTokenRegistry ? bot.getTokenRegistry() : [],
                bot.getAllPurseAllocations(),
                bot.getPausedTokens ? bot.getPausedTokens() : [],
                bot.getFrozenTokens ? bot.getFrozenTokens() : [],
            ]);
            setTokenRegistry(registry);
            setAllPurses(purses);
            setPausedTokens(new Set(paused.map(p => typeof p === 'string' ? p : p?.toText?.() || String(p))));
            setFrozenTokens(new Set(frozen.map(p => typeof p === 'string' ? p : p?.toText?.() || String(p))));

            const tokenSet = new Set();
            for (const t of registry) {
                const tid = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
                tokenSet.add(tid);
            }
            for (const chore of purses) {
                for (const b of chore.balances) {
                    const tok = typeof b.token === 'string' ? b.token : b.token?.toText?.() || String(b.token);
                    tokenSet.add(tok);
                }
            }

            if (tokenSet.size > 0 && canisterId) {
                setBalancesLoading(true);
                try {
                    const { HttpAgent } = await import('@dfinity/agent');
                    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                    const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
                    const agent = HttpAgent.createSync({ identity, host });
                    if (isLocal) await agent.fetchRootKey();
                    const botPrincipal = Principal.fromText(canisterId);

                    const tokens = [...tokenSet];
                    const results = {};
                    await Promise.all(tokens.map(async (tid) => {
                        try {
                            const ledgerActor = createLedgerActor(tid, { agent });
                            const bal = await ledgerActor.icrc1_balance_of({ owner: botPrincipal, subaccount: [] });
                            results[tid] = BigInt(bal);
                        } catch (_) { results[tid] = 0n; }
                    }));
                    setMainBalances(results);
                } catch (e) {
                    console.warn('WalletPanel: failed to fetch on-chain balances', e);
                } finally {
                    setBalancesLoading(false);
                }
            }
        } catch (e) {
            setError(e?.message || String(e));
        } finally {
            setLoading(false);
        }
    }, [getReadyBotActor, canisterId, identity]);

    useEffect(() => { loadData(); }, [loadData]);

    // Fetch denomination prices when denomToken or tokenRegistry changes
    const denomCacheKeyRef = useRef('');
    useEffect(() => {
        if (!denomToken || tokenRegistry.length === 0) { setDenomPrices({}); setLoadingPrices(false); return; }
        const ids = tokenRegistry.map(t => typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId)).sort().join(',');
        const cacheKey = `${denomToken}:${ids}`;
        if (cacheKey === denomCacheKeyRef.current) return;
        let cancelled = false;
        setLoadingPrices(true);
        (async () => {
            try {
                const decFor = (id) => {
                    const cached = getTokenMetadataSync(id);
                    if (cached?.decimals != null) return Number(cached.decimals);
                    const regEntry = tokenRegistry.find(t => {
                        const k = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
                        return k === id;
                    });
                    if (regEntry?.decimals != null) return Number(regEntry.decimals);
                    return 8;
                };
                const tokenIds = ids.split(',');
                const prices = await fetchDenomPrices(tokenIds, denomToken, decFor);
                if (!cancelled) {
                    denomCacheKeyRef.current = cacheKey;
                    setDenomPrices(prices);
                }
            } catch (e) { console.warn('WalletPanel: Failed to fetch denom prices:', e); }
            finally { if (!cancelled) setLoadingPrices(false); }
        })();
        return () => { cancelled = true; };
    }, [denomToken, tokenRegistry]);

    // Token registry handlers
    const handleAddToken = async (tokenData) => {
        if (!addTokenValue) return;
        setAddingToken(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const cached = getTokenMetadataSync(addTokenValue);
            const entry = {
                ledgerCanisterId: Principal.fromText(addTokenValue),
                symbol: tokenData?.symbol || cached?.symbol || '???',
                decimals: tokenData?.decimals ?? cached?.decimals ?? 8,
                fee: BigInt(tokenData?.fee ?? cached?.fee ?? 10000),
            };
            await bot.addToken(entry);
            setAddTokenValue('');
            setSuccess(`Token ${entry.symbol} registered.`);
            await loadData();
        } catch (e) { setError('Failed to add token: ' + e.message); }
        finally { setAddingToken(false); }
    };

    const handleRemoveToken = async (ledgerId) => {
        setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const p = typeof ledgerId === 'string' ? Principal.fromText(ledgerId) : ledgerId;
            await bot.removeToken(p);
            setSuccess('Token removed.');
            await loadData();
        } catch (e) { setError('Failed to remove token: ' + e.message); }
    };

    // Auto-register a token if not already in the registry
    const ensureTokenRegistered = async (tokenId) => {
        const isRegistered = tokenRegistry.some(t => {
            const tid = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
            return tid === tokenId;
        });
        if (isRegistered) return;
        const bot = await getReadyBotActor();
        const cached = getTokenMetadataSync(tokenId);
        await bot.addToken({
            ledgerCanisterId: Principal.fromText(tokenId),
            symbol: cached?.symbol || '???',
            decimals: cached?.decimals ?? 8,
            fee: BigInt(cached?.fee ?? 10000),
        });
    };

    // Fetch user wallet balance when fund mode is active
    const [walletBalance, setWalletBalance] = useState(null);
    useEffect(() => {
        if (activeOp !== 'fund' || !opToken || !identity) { setWalletBalance(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const ledger = createLedgerActor(opToken, { agentOptions: { identity } });
                const bal = await ledger.icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] });
                if (!cancelled) setWalletBalance(bal);
            } catch { if (!cancelled) setWalletBalance(null); }
        })();
        return () => { cancelled = true; };
    }, [activeOp, opToken, identity]);

    const handleScanForTokens = async () => {
        if (scanning) return;
        setScanning(true); setError(''); setSuccess('');
        setScanProgress({ current: 0, total: 0, found: 0 });
        try {
            const bot = await getReadyBotActor();
            const registeredSet = new Set(tokenRegistry.map(t => {
                const k = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
                return k;
            }));
            const ledgersToScan = whitelistedTokens
                .map(t => ({ id: t.ledger_id?.toString?.() ?? String(t.ledger_id), symbol: t.symbol, decimals: t.decimals, fee: t.fee }))
                .filter(t => !registeredSet.has(t.id));
            setScanProgress({ current: 0, total: ledgersToScan.length, found: 0 });
            if (ledgersToScan.length === 0) {
                setSuccess('All whitelisted tokens are already registered.');
                setScanning(false); setScanProgress(null);
                return;
            }
            const { HttpAgent } = await import('@dfinity/agent');
            const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
            const agent = HttpAgent.createSync({ identity, host });
            if (isLocal) await agent.fetchRootKey();
            const botPrincipal = Principal.fromText(canisterId);
            let foundCount = 0;
            let scanned = 0;
            const CONCURRENCY = 8;
            const queue = [...ledgersToScan];
            const workers = [];
            for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
                workers.push((async () => {
                    while (queue.length > 0) {
                        const item = queue.shift();
                        if (!item) break;
                        try {
                            const ledgerActor = createLedgerActor(item.id, { agent });
                            const balance = await ledgerActor.icrc1_balance_of({ owner: botPrincipal, subaccount: [] });
                            if (BigInt(balance) > 0n) {
                                await bot.addToken({
                                    ledgerCanisterId: Principal.fromText(item.id),
                                    symbol: item.symbol || '???',
                                    decimals: item.decimals ?? 8,
                                    fee: BigInt(item.fee ?? 10000),
                                });
                                foundCount++;
                            }
                        } catch (_) {}
                        scanned++;
                        setScanProgress({ current: scanned, total: ledgersToScan.length, found: foundCount });
                    }
                })());
            }
            await Promise.all(workers);
            setSuccess(`Scan complete. Found ${foundCount} token${foundCount !== 1 ? 's' : ''} with balances.`);
            await loadData();
        } catch (e) { setError('Scan failed: ' + e.message); }
        finally { setScanning(false); setScanProgress(null); }
    };

    // Toggle pause/freeze for a token
    const handleTogglePause = async (tokenId) => {
        setTogglingToken(tokenId); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const p = Principal.fromText(tokenId);
            if (pausedTokens.has(tokenId)) {
                await bot.unpauseToken(p);
                setSuccess(`${tokLabel(tokenId)} unpaused.`);
            } else {
                await bot.pauseToken(p);
                setSuccess(`${tokLabel(tokenId)} paused — it will not be traded by any chore.`);
            }
            await loadData();
        } catch (e) { setError('Failed to toggle pause: ' + e.message); }
        finally { setTogglingToken(null); }
    };

    const handleToggleFreeze = async (tokenId) => {
        setTogglingToken(tokenId); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const p = Principal.fromText(tokenId);
            if (frozenTokens.has(tokenId)) {
                await bot.unfreezeToken(p);
                setSuccess(`${tokLabel(tokenId)} unfrozen.`);
            } else {
                await bot.freezeToken(p);
                setSuccess(`${tokLabel(tokenId)} frozen — it will not be traded or moved by any chore.`);
            }
            await loadData();
        } catch (e) { setError('Failed to toggle freeze: ' + e.message); }
        finally { setTogglingToken(null); }
    };

    // Purse allocation totals
    const totalAllocated = {};
    const purseTokenSet = new Set();
    for (const chore of allPurses) {
        for (const b of chore.balances) {
            const tok = typeof b.token === 'string' ? b.token : b.token?.toText?.() || String(b.token);
            purseTokenSet.add(tok);
            totalAllocated[tok] = (totalAllocated[tok] || 0n) + BigInt(b.balance);
        }
    }

    // Main purse = on-chain minus allocated
    const mainPurseEntries = [];
    const seenTokens = new Set();
    for (const tok of purseTokenSet) {
        seenTokens.add(tok);
        const chain = mainBalances[tok] || 0n;
        const allocated = totalAllocated[tok] || 0n;
        const available = chain > allocated ? chain - allocated : 0n;
        const overcommitted = allocated > chain;
        if (chain > 0n || overcommitted) {
            mainPurseEntries.push({ token: tok, balance: available, onChain: chain, allocated, overcommitted });
        }
    }
    for (const [tok, chain] of Object.entries(mainBalances)) {
        if (!seenTokens.has(tok) && chain > 0n) {
            mainPurseEntries.push({ token: tok, balance: chain, onChain: chain, allocated: 0n, overcommitted: false });
        }
    }

    // Main account entries: all registered tokens (even if balance is 0)
    const mainAccountEntries = React.useMemo(() => {
        const entries = [];
        const seen = new Set();
        for (const t of tokenRegistry) {
            const tid = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
            seen.add(tid);
            entries.push({ token: tid, balance: mainBalances[tid] || 0n });
        }
        for (const [tok, bal] of Object.entries(mainBalances)) {
            if (!seen.has(tok)) {
                entries.push({ token: tok, balance: bal });
            }
        }
        return entries;
    }, [tokenRegistry, mainBalances]);

    const registeredTokenIds = tokenRegistry.map(t => {
        const tid = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
        return tid;
    });

    const enabledPurses = allPurses.filter(p => p.enabled && p.balances.length > 0);
    const opTokenBalance = activeOp === 'fund' ? walletBalance : (opToken ? (mainBalances[opToken] || 0n) : null);

    // Token subset for operation form (withdraw/send): all registered tokens
    const walletOpTokenSubset = React.useMemo(() => {
        const seen = new Set();
        const result = [];
        for (const e of mainAccountEntries) {
            if (!seen.has(e.token)) { seen.add(e.token); result.push({ ledger_id: e.token, symbol: tokLabel(e.token), name: tokLabel(e.token) }); }
        }
        for (const tid of registeredTokenIds) {
            if (!seen.has(tid)) { seen.add(tid); result.push({ ledger_id: tid, symbol: tokLabel(tid), name: tokLabel(tid) }); }
        }
        return result;
    }, [mainAccountEntries, registeredTokenIds]);

    const handleExecuteOp = async () => {
        if (!opToken || !opAmount) return;
        setOpExecuting(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const dec = tokDecimals(opToken);
            const amount = BigInt(Math.round(parseFloat(opAmount) * (10 ** dec)));
            if (amount <= 0n) { setError('Amount must be greater than 0'); setOpExecuting(false); return; }
            const tokenPrincipal = Principal.fromText(opToken);

            if (activeOp === 'fund') {
                // ICRC-1 transfer from user wallet to bot's main account, auto-register token
                await ensureTokenRegistered(opToken);
                const botPrincipal = Principal.fromText(canisterId);
                const ledgerActor = createLedgerActor(opToken, { agentOptions: { identity } });
                const result = await ledgerActor.icrc1_transfer({
                    to: { owner: botPrincipal, subaccount: [] },
                    amount,
                    fee: [],
                    memo: [],
                    from_subaccount: [],
                    created_at_time: [],
                });
                if ('Ok' in result) {
                    setSuccess(`Funded ${opAmount} ${tokLabel(opToken)} to Main Account. Block: ${result.Ok.toString()}`);
                    setActiveOp(null); setOpAmount(''); setOpToken('');
                    loadData();
                } else {
                    setError('Fund failed: ' + JSON.stringify(result.Err));
                }
            } else if (activeOp === 'withdraw') {
                const userPrincipal = identity.getPrincipal();
                const result = await bot.withdrawToken(tokenPrincipal, amount, { owner: userPrincipal, subaccount: [] });
                if ('Ok' in result) {
                    setSuccess(`Withdrew ${opAmount} ${tokLabel(opToken)} to your wallet. Block: ${result.Ok.transfer_block_height.toString()}`);
                    setActiveOp(null); setOpAmount(''); setOpToken('');
                    loadData();
                } else {
                    setError('Withdraw failed: ' + JSON.stringify(result.Err));
                }
            } else if (activeOp === 'send') {
                if (!opDestination) { setError('Please enter a destination principal'); setOpExecuting(false); return; }
                let destPrincipal;
                try { destPrincipal = Principal.fromText(opDestination); }
                catch { setError('Invalid destination principal'); setOpExecuting(false); return; }
                let destSubBlob = [];
                if (opDestSubaccount.trim()) {
                    const hex = opDestSubaccount.replace(/^0x/, '').trim();
                    if (hex.length > 0 && hex.length <= 64) {
                        const bytes = [];
                        const padded = hex.padStart(64, '0');
                        for (let i = 0; i < padded.length; i += 2) {
                            bytes.push(parseInt(padded.substr(i, 2), 16));
                        }
                        destSubBlob = [bytes];
                    }
                }
                const result = await bot.manualSend(tokenPrincipal, [], destPrincipal, destSubBlob, amount);
                if ('Ok' in result) {
                    setSuccess(`Sent ${opAmount} ${tokLabel(opToken)} to ${opDestination.slice(0, 10)}... Block: ${result.Ok.blockIndex.toString()}`);
                    setActiveOp(null); setOpAmount(''); setOpToken(''); setOpDestination(''); setOpDestSubaccount('');
                    loadData();
                } else {
                    setError('Send failed: ' + JSON.stringify(result.Err));
                }
            }
        } catch (e) { setError('Operation failed: ' + e.message); }
        finally { setOpExecuting(false); }
    };

    const handleFundPurse = async () => {
        if (!fundTarget || !fundToken || !fundAmount) return;
        setPurseSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const dec = tokDecimals(fundToken);
            const raw = BigInt(Math.round(parseFloat(fundAmount) * (10 ** Number(dec))));
            const tokenPrincipal = typeof fundToken === 'string' ? Principal.fromText(fundToken) : fundToken;
            if (fundSource === 'wallet') {
                const tokId = typeof fundToken === 'string' ? fundToken : fundToken.toText();
                await ensureTokenRegistered(tokId);
                const botPrincipal = Principal.fromText(canisterId);
                const ledgerActor = createLedgerActor(tokId, { agentOptions: { identity } });
                const xferResult = await ledgerActor.icrc1_transfer({
                    to: { owner: botPrincipal, subaccount: [] },
                    amount: raw, fee: [], memo: [], from_subaccount: [], created_at_time: [],
                });
                if ('Err' in xferResult) { setError('Wallet transfer failed: ' + JSON.stringify(xferResult.Err)); return; }
                const fundResult = await bot.fundPurse(fundTarget, tokenPrincipal, raw);
                if ('Err' in fundResult) { setError(typeof fundResult.Err === 'string' ? fundResult.Err : JSON.stringify(fundResult.Err)); return; }
                setSuccess(`Funded ${fundAmount} ${tokLabel(fundToken)} from wallet to ${choreLabel(fundTarget)}`);
            } else {
                const result = await bot.fundPurse(fundTarget, tokenPrincipal, raw);
                if ('Err' in result) { setError(typeof result.Err === 'string' ? result.Err : JSON.stringify(result.Err)); return; }
                setSuccess(`Funded ${fundAmount} ${tokLabel(fundToken)} to ${choreLabel(fundTarget)}`);
            }
            setFundAmount(''); setFundTarget(null); setFundToken('');
            await loadData();
        } catch (e) {
            setError(e?.message || String(e));
        } finally {
            setPurseSaving(false);
        }
    };

    const handleReclaimPurse = async () => {
        if (!reclaimTarget || !reclaimToken || !reclaimAmount) return;
        setPurseSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const dec = tokDecimals(reclaimToken);
            const raw = BigInt(Math.round(parseFloat(reclaimAmount) * (10 ** Number(dec))));
            const result = await bot.reclaimFromPurse(reclaimTarget, typeof reclaimToken === 'string' ? Principal.fromText(reclaimToken) : reclaimToken, raw);
            if ('Err' in result) { setError(typeof result.Err === 'string' ? result.Err : JSON.stringify(result.Err)); return; }
            setSuccess(`Reclaimed ${reclaimAmount} ${tokLabel(reclaimToken)} from ${choreLabel(reclaimTarget)}`);
            setReclaimAmount(''); setReclaimTarget(null); setReclaimToken('');
            await loadData();
        } catch (e) {
            setError(e?.message || String(e));
        } finally {
            setPurseSaving(false);
        }
    };

    const handleWithdrawFromPurse = async () => {
        if (!withdrawTarget || !withdrawToken || !withdrawAmount) return;
        setPurseSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const dec = tokDecimals(withdrawToken);
            const raw = BigInt(Math.round(parseFloat(withdrawAmount) * (10 ** Number(dec))));
            const tokenPrincipal = typeof withdrawToken === 'string' ? Principal.fromText(withdrawToken) : withdrawToken;
            const userPrincipal = identity.getPrincipal();
            const result = await bot.manualSend(tokenPrincipal, [withdrawTarget], userPrincipal, [], raw);
            if ('Err' in result) { setError('Withdraw failed: ' + JSON.stringify(result.Err)); return; }
            setSuccess(`Withdrew ${withdrawAmount} ${tokLabel(withdrawToken)} from ${choreLabel(withdrawTarget)} to wallet. Block: ${result.Ok.blockIndex.toString()}`);
            setWithdrawAmount(''); setWithdrawTarget(null); setWithdrawToken('');
            await loadData();
        } catch (e) {
            setError(e?.message || String(e));
        } finally {
            setPurseSaving(false);
        }
    };

    const handleMaxFundPurse = async () => {
        if (!fundToken || !fundTarget) return;
        const dec = tokDecimals(fundToken);
        if (fundSource === 'wallet') {
            try {
                const { HttpAgent } = await import('@dfinity/agent');
                const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
                const agent = HttpAgent.createSync({ identity, host });
                if (isLocal) await agent.fetchRootKey();
                const userPrincipal = identity.getPrincipal();
                const tokId = typeof fundToken === 'string' ? fundToken : fundToken.toText();
                const ledgerActor = createLedgerActor(tokId, { agent });
                const bal = BigInt(await ledgerActor.icrc1_balance_of({ owner: userPrincipal, subaccount: [] }));
                const fee = BigInt(tokFee(fundToken));
                const max = bal > fee ? bal - fee : 0n;
                setFundAmount((Number(max) / (10 ** Number(dec))).toString());
            } catch (e) { console.warn('Failed to fetch wallet balance', e); }
        } else {
            const tokId = typeof fundToken === 'string' ? fundToken : fundToken?.toText?.() || '';
            const entry = mainPurseEntries.find(e => e.token === tokId);
            if (entry) setFundAmount((Number(entry.balance) / (10 ** Number(dec))).toString());
        }
    };

    const handleMaxReclaimPurse = (choreBalances) => {
        if (!reclaimToken) return;
        const dec = tokDecimals(reclaimToken);
        const tokId = typeof reclaimToken === 'string' ? reclaimToken : reclaimToken?.toText?.() || '';
        const entry = choreBalances.find(b => {
            const p = typeof b.token === 'string' ? b.token : b.token?.toText?.() || String(b.token);
            return p === tokId;
        });
        if (entry) setReclaimAmount((Number(entry.balance) / (10 ** Number(dec))).toString());
    };

    const handleMaxWithdrawPurse = (choreBalances) => {
        if (!withdrawToken) return;
        const dec = tokDecimals(withdrawToken);
        const fee = tokFee(withdrawToken);
        const tokId = typeof withdrawToken === 'string' ? withdrawToken : withdrawToken?.toText?.() || '';
        const entry = choreBalances.find(b => {
            const p = typeof b.token === 'string' ? b.token : b.token?.toText?.() || String(b.token);
            return p === tokId;
        });
        if (entry) {
            const raw = Number(entry.balance);
            const max = raw > fee ? raw - fee : 0;
            setWithdrawAmount((max / (10 ** Number(dec))).toString());
        }
    };

    const tokFee = (tok) => {
        const p = typeof tok === 'string' ? tok : tok?.toText?.() || tok?.toString?.() || '';
        const cached = getTokenMetadataSync(p);
        return cached?.fee != null ? Number(cached.fee) : 10000;
    };

    const handleReclaimAll = async () => {
        const total = enabledPurses.reduce((sum, c) => sum + c.balances.filter(b => Number(b.balance) > 0).length, 0);
        if (total === 0) return;
        if (!window.confirm(`Reclaim all balances from ${enabledPurses.length} purse(s) (${total} token balance(s)) back to main purse?`)) return;
        setReclaimingAll(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            let done = 0;
            for (const chore of enabledPurses) {
                for (const b of chore.balances) {
                    if (Number(b.balance) <= 0) continue;
                    const tok = typeof b.token === 'string' ? b.token : b.token?.toText?.() || String(b.token);
                    const result = await bot.reclaimFromPurse(chore.instanceId, typeof tok === 'string' ? Principal.fromText(tok) : tok, BigInt(b.balance));
                    if ('Ok' in result) done++;
                }
            }
            setSuccess(`Reclaimed ${done} balance(s) back to main purse.`);
            await loadData();
        } catch (e) {
            setError(e?.message || String(e));
        } finally {
            setReclaimingAll(false);
        }
    };

    // DnD reorder: swap in local state immediately, persist to backend
    const reorderTimeoutRef = useRef(null);
    const handleReorderTokens = useCallback((fromIdx, toIdx) => {
        setTokenRegistry(prev => {
            const updated = [...prev];
            const [moved] = updated.splice(fromIdx, 1);
            updated.splice(toIdx, 0, moved);
            return updated;
        });
        if (reorderTimeoutRef.current) clearTimeout(reorderTimeoutRef.current);
        reorderTimeoutRef.current = setTimeout(async () => {
            try {
                const bot = await getReadyBotActor();
                setTokenRegistry(current => {
                    const ordered = current.map(t => {
                        const tid = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
                        return Principal.fromText(tid);
                    });
                    bot.reorderTokenRegistry(ordered).catch(e => console.warn('Failed to persist token order:', e));
                    return current;
                });
            } catch (e) { console.warn('Failed to reorder tokens:', e); }
        }, 600);
    }, [getReadyBotActor]);

    useEffect(() => {
        if (!fundToken || fundSource !== 'wallet') { setFundSourceBalance(null); setFundBalanceLoading(false); return; }
        if (!identity) { setFundSourceBalance(null); return; }
        const tokId = typeof fundToken === 'string' ? fundToken : fundToken?.toText?.() || '';
        let cancelled = false;
        setFundBalanceLoading(true);
        (async () => {
            try {
                const { HttpAgent } = await import('@dfinity/agent');
                const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
                const agent = HttpAgent.createSync({ identity, host });
                if (isLocal) await agent.fetchRootKey();
                const ledger = createLedgerActor(tokId, { agent });
                const bal = BigInt(await ledger.icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] }));
                if (!cancelled) setFundSourceBalance(bal);
            } catch { if (!cancelled) setFundSourceBalance(null); }
            finally { if (!cancelled) setFundBalanceLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [fundToken, fundSource, identity]);

    if (loading) return <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText, padding: '16px 0' }}>Loading wallet data...</div>;

    return (
        <DndProvider backend={HTML5Backend}>
        <div>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <FaWallet style={{ color: accentColor }} /> Wallet
                </h3>
                <button onClick={loadData} style={{
                    padding: '4px 10px', fontSize: '0.75rem', border: `1px solid ${borderColor}`,
                    borderRadius: '6px', cursor: 'pointer', background: cardBg, color: theme.colors.primaryText,
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                }}>
                    <FaSyncAlt size={10} /> Refresh
                </button>
                <button onClick={handleScanForTokens} disabled={scanning} style={{
                    padding: '4px 10px', fontSize: '0.75rem', border: `1px solid ${accentColor}40`,
                    borderRadius: '6px', cursor: scanning ? 'default' : 'pointer', background: 'none', color: accentColor,
                    display: 'inline-flex', alignItems: 'center', gap: '4px', opacity: scanning ? 0.6 : 1,
                }}>
                    <FaSearch style={{ fontSize: '0.6rem', animation: scanning ? 'spin 1s linear infinite' : 'none' }} />
                    {scanning ? 'Scanning...' : 'Scan for Tokens'}
                </button>
                {balancesLoading && <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>fetching balances...</span>}
            </div>

            {scanProgress && (
                <div style={{ fontSize: '0.72rem', color: theme.colors.secondaryText, marginBottom: '10px' }}>
                    Scanning {scanProgress.current}/{scanProgress.total}... Found {scanProgress.found} so far.
                </div>
            )}

            {error && <div style={{ padding: '8px 12px', background: '#ef444415', border: '1px solid #ef444430', borderRadius: '8px', color: '#ef4444', fontSize: '0.8rem', marginBottom: '10px' }}>{error}</div>}
            {success && <div style={{ padding: '8px 12px', background: '#22c55e15', border: '1px solid #22c55e30', borderRadius: '8px', color: '#22c55e', fontSize: '0.8rem', marginBottom: '10px' }}>{success}</div>}

            {/* ── Registered Tokens ── */}
            <div style={{ padding: '12px', background: cardBg, borderRadius: '10px', border: `1px solid ${borderColor}`, marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <h4 style={{ margin: 0, fontSize: '0.85rem', color: theme.colors.primaryText, fontWeight: '600' }}>
                        Registered Tokens ({tokenRegistry.length})
                    </h4>
                    <button onClick={() => setShowTokenManager(!showTokenManager)} style={btnStyle}>
                        {showTokenManager ? 'Hide' : 'Manage'}
                    </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: showTokenManager ? '10px' : '0' }}>
                    {tokenRegistry.length === 0 ? (
                        <div style={{ color: theme.colors.mutedText, fontSize: '0.78rem', padding: '4px 0' }}>No tokens registered. Add tokens or scan for tokens with balances.</div>
                    ) : (
                        tokenRegistry.map((t, idx) => {
                            const tid = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
                            return (
                                <DraggableTokenChip
                                    key={tid}
                                    tid={tid}
                                    index={idx}
                                    symbol={_isPlaceholderSymbol(t.symbol) ? tokLabel(tid) : t.symbol}
                                    showRemove={showTokenManager}
                                    onRemove={() => handleRemoveToken(tid)}
                                    onReorder={handleReorderTokens}
                                    theme={theme}
                                    borderColor={borderColor}
                                    isPaused={pausedTokens.has(tid)}
                                    isFrozen={frozenTokens.has(tid)}
                                />
                            );
                        })
                    )}
                </div>
                {showTokenManager && (
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '3px' }}>Add Token</label>
                            <TokenSelector
                                value={addTokenValue}
                                onChange={setAddTokenValue}
                                onSelectToken={(data) => {
                                    setAddTokenValue(data.ledger_id);
                                    handleAddToken(data);
                                }}
                                allowCustom={true}
                                placeholder="Search or paste ledger ID..."
                            />
                        </div>
                        {addTokenValue && (
                            <button onClick={() => handleAddToken(null)} disabled={addingToken}
                                style={{ ...btnStyle, opacity: addingToken ? 0.6 : 1, whiteSpace: 'nowrap', marginBottom: '1px' }}>
                                <FaPlus style={{ fontSize: '0.6rem', marginRight: '3px' }} />{addingToken ? 'Adding...' : 'Add'}
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* ── Main Account (on-chain balances) ── */}
            <div style={{ padding: '12px', background: cardBg, borderRadius: '10px', border: `1px solid ${borderColor}`, marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                    <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: theme.colors.primaryText }}>
                        Main Account — Token Balances
                    </h4>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <label style={{ fontSize: '0.7rem', color: theme.colors.secondaryText }}>Value in:</label>
                        <div style={{ width: '160px' }}>
                            <TokenSelector
                                value={denomToken}
                                onChange={(v) => { setDenomToken(v); setDenomPrices({}); }}
                                allowCustom={true}
                                placeholder="Denomination..."
                            />
                        </div>
                        {denomToken && (
                            <button type="button" onClick={() => { setDenomToken(''); setDenomPrices({}); }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.6rem', color: accentColor, padding: '2px' }}
                                title="Clear denomination">
                                <FaTimes />
                            </button>
                        )}
                    </div>
                </div>

                {/* Receiving Addresses */}
                {canisterId && (() => {
                    const botPrincipal = Principal.fromText(canisterId);
                    const icrc1Account = encodeIcrcAccount({ owner: botPrincipal });
                    const accountId = computeAccountId(botPrincipal, null);
                    const copyBtn = (text) => (
                        <button title="Copy" onClick={() => { navigator.clipboard.writeText(text); setSuccess('Copied!'); setTimeout(() => setSuccess(''), 1500); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: accentColor, padding: '2px 4px', fontSize: '0.7rem' }}>
                            <FaCopy />
                        </button>
                    );
                    const addrRow = (label, value) => (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                            <span style={{ fontSize: '0.72rem', color: theme.colors.secondaryText, minWidth: '80px', flexShrink: 0 }}>{label}</span>
                            <code style={{ fontSize: '0.72rem', color: theme.colors.primaryText, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: '1.4' }}>{value}</code>
                            {copyBtn(value)}
                        </div>
                    );
                    return (
                        <div style={{ marginBottom: '10px', padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${borderColor}`, fontSize: '0.78rem' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: theme.colors.primaryText, marginBottom: '6px' }}>Receiving Addresses</div>
                            {addrRow('Principal', canisterId)}
                            {addrRow('ICRC-1 Account', icrc1Account)}
                            {accountId && addrRow('Account ID', accountId)}
                            <div style={{ fontSize: '0.68rem', color: theme.colors.mutedText, marginTop: '4px', lineHeight: '1.4' }}>
                                Use <strong>ICRC-1 Account</strong> or <strong>Principal</strong> to receive tokens.
                                {' '}<strong>Account ID</strong> is for receiving ICP from centralized exchanges only.
                            </div>
                        </div>
                    );
                })()}

                {/* Token balance table with denomination, prices, pie chart, and status */}
                {mainAccountEntries.length === 0 ? (
                    <div style={{ fontSize: '0.82rem', color: theme.colors.secondaryText, fontStyle: 'italic' }}>
                        {balancesLoading ? 'Fetching balances...' : (tokenRegistry.length === 0 ? 'No tokens registered. Register tokens in the Accounts panel to see balances.' : 'No token balances found.')}
                    </div>
                ) : (() => {
                    const denomSym = denomToken ? tokLabel(denomToken) : '';
                    const denomSign = getCurrencySign(denomToken);
                    let totalDenomValue = 0;
                    let hasAnyDenomValue = false;

                    const rows = mainAccountEntries.map((e) => {
                        const dec = tokDecimals(e.token);
                        const humanBal = Number(e.balance) / (10 ** dec);
                        const price = denomPrices[e.token];
                        let denomValue = null;
                        if (denomToken && price != null && price > 0) {
                            denomValue = humanBal * price;
                            totalDenomValue += denomValue;
                            hasAnyDenomValue = true;
                        }
                        return { tid: e.token, dec, humanBal, balance: e.balance, denomValue, price };
                    });

                    const pieSegments = hasAnyDenomValue ? rows.filter(r => r.denomValue != null && r.denomValue > 0).map((r) => ({
                        label: tokLabel(r.tid), value: r.denomValue, color: getTokenColor(r.tid),
                    })) : [];

                    const colCount = (denomToken ? (hasAnyDenomValue ? 5 : 4) : 2) + 1;

                    return (
                        <>
                            {pieSegments.length > 0 && (
                                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px', padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${borderColor}` }}>
                                    <PieChart segments={pieSegments} label="Main Account" theme={theme} />
                                </div>
                            )}
                            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: denomToken ? '520px' : '320px' }}>
                                <thead>
                                    <tr style={{ color: theme.colors.mutedText, textAlign: 'left' }}>
                                        <th style={{ padding: '4px 8px' }}>Token</th>
                                        <th style={{ padding: '4px 8px', textAlign: 'right' }}>Balance</th>
                                        {denomToken && <th style={{ padding: '4px 8px', textAlign: 'right' }}>Price ({denomSign || denomSym})</th>}
                                        {denomToken && <th style={{ padding: '4px 8px', textAlign: 'right' }}>{denomSign ? `Value (${denomSign})` : `Value (${denomSym})`}</th>}
                                        {denomToken && hasAnyDenomValue && <th style={{ padding: '4px 8px', textAlign: 'right' }}>%</th>}
                                        <th style={{ padding: '4px 8px', textAlign: 'center', fontSize: '0.7rem' }}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(({ tid, dec, balance, denomValue, price }) => {
                                        const tPaused = pausedTokens.has(tid);
                                        const tFrozen = frozenTokens.has(tid);
                                        const isToggling = togglingToken === tid;
                                        return (
                                        <tr key={tid} style={{ borderTop: `1px solid ${borderColor}20`, opacity: tFrozen ? 0.55 : tPaused ? 0.7 : 1 }}>
                                            <td style={{ padding: '5px 8px', color: theme.colors.primaryText }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <TokenIcon canisterId={tid} size={18} />
                                                    {tokLabel(tid)}
                                                    {tFrozen && <span style={{ fontSize: '0.6rem', color: '#3b82f6', fontWeight: '600' }}>FROZEN</span>}
                                                    {tPaused && !tFrozen && <span style={{ fontSize: '0.6rem', color: '#f59e0b', fontWeight: '600' }}>PAUSED</span>}
                                                </div>
                                            </td>
                                            <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: theme.colors.secondaryText }}>
                                                {formatTokenAmount(balance, dec)}
                                            </td>
                                            {denomToken && (
                                                <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: price != null ? theme.colors.secondaryText : theme.colors.mutedText, fontSize: '0.75rem' }}>
                                                    {tid === denomToken ? '1.00' : (price != null
                                                        ? formatDenomAmount(price, denomToken, denomSym)
                                                        : (loadingPrices ? '...' : '—'))}
                                                </td>
                                            )}
                                            {denomToken && (
                                                <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: denomValue != null ? theme.colors.primaryText : theme.colors.mutedText, fontSize: '0.78rem' }}>
                                                    {denomValue != null
                                                        ? formatDenomAmount(denomValue, denomToken, denomSym)
                                                        : (loadingPrices ? '...' : '—')}
                                                </td>
                                            )}
                                            {denomToken && hasAnyDenomValue && (
                                                <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.75rem', color: denomValue != null && totalDenomValue > 0 ? accentColor : theme.colors.mutedText }}>
                                                    {denomValue != null && totalDenomValue > 0
                                                        ? ((denomValue / totalDenomValue) * 100).toFixed(1) + '%'
                                                        : '—'}
                                                </td>
                                            )}
                                            <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                                                <div style={{ display: 'flex', gap: '3px', justifyContent: 'center' }}>
                                                    <button
                                                        onClick={() => handleTogglePause(tid)}
                                                        disabled={isToggling}
                                                        title={tPaused ? 'Unpause — allow trading' : 'Pause — prevent trading by all chores'}
                                                        style={{
                                                            background: 'none', border: `1px solid ${tPaused ? '#f59e0b50' : borderColor}`,
                                                            borderRadius: '4px', cursor: isToggling ? 'wait' : 'pointer', padding: '2px 5px',
                                                            color: tPaused ? '#f59e0b' : theme.colors.mutedText, fontSize: '0.6rem',
                                                            opacity: isToggling ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '2px',
                                                        }}
                                                    >
                                                        {tPaused ? <FaPlay style={{ fontSize: '0.5rem' }} /> : <FaPause style={{ fontSize: '0.5rem' }} />}
                                                    </button>
                                                    <button
                                                        onClick={() => handleToggleFreeze(tid)}
                                                        disabled={isToggling}
                                                        title={tFrozen ? 'Unfreeze — allow trading and movement' : 'Freeze — prevent trading and all movement'}
                                                        style={{
                                                            background: 'none', border: `1px solid ${tFrozen ? '#3b82f650' : borderColor}`,
                                                            borderRadius: '4px', cursor: isToggling ? 'wait' : 'pointer', padding: '2px 5px',
                                                            color: tFrozen ? '#3b82f6' : theme.colors.mutedText, fontSize: '0.6rem',
                                                            opacity: isToggling ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '2px',
                                                        }}
                                                    >
                                                        {tFrozen ? <FaLockOpen style={{ fontSize: '0.5rem' }} /> : <FaLock style={{ fontSize: '0.5rem' }} />}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                        );
                                    })}
                                    {denomToken && hasAnyDenomValue && (
                                        <tr style={{ borderTop: `2px solid ${borderColor}40` }}>
                                            <td style={{ padding: '6px 8px', fontWeight: '700', color: theme.colors.primaryText }}>
                                                Total{balancesLoading ? ' (loading...)' : ''}
                                            </td>
                                            <td />
                                            {denomToken && <td />}
                                            <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: '700', color: accentColor, fontSize: '0.85rem' }}>
                                                {formatDenomAmount(totalDenomValue, denomToken, denomSym)}
                                            </td>
                                            <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: '600', color: accentColor, fontSize: '0.75rem' }}>100%</td>
                                            <td />
                                        </tr>
                                    )}
                                    {balancesLoading && !hasAnyDenomValue && (
                                        <tr><td colSpan={colCount} style={{ padding: '4px 8px', fontSize: '0.75rem', color: theme.colors.mutedText }}>Scanning balances...</td></tr>
                                    )}
                                </tbody>
                            </table>
                            </div>
                        </>
                    );
                })()}
                {(pausedTokens.size > 0 || frozenTokens.size > 0) && (
                    <div style={{ marginTop: '6px', fontSize: '0.68rem', color: theme.colors.mutedText }}>
                        <FaPause style={{ fontSize: '0.5rem', color: '#f59e0b', marginRight: '3px' }} /> Paused — not traded by any chore
                        {frozenTokens.size > 0 && <>{' '}<FaLock style={{ fontSize: '0.5rem', color: '#3b82f6', marginLeft: '10px', marginRight: '3px' }} /> Frozen — not traded or moved</>}
                    </div>
                )}

                {/* Fund / Withdraw / Send buttons */}
                <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button onClick={() => { setActiveOp(activeOp === 'fund' ? null : 'fund'); setOpToken(''); setOpAmount(''); }}
                        style={{ ...btnStyle, background: activeOp === 'fund' ? `${accentColor}15` : 'none', borderColor: activeOp === 'fund' ? accentColor : `${accentColor}40`, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <FaDownload style={{ fontSize: '0.6rem' }} /> Fund
                    </button>
                    <button onClick={() => { setActiveOp(activeOp === 'withdraw' ? null : 'withdraw'); setOpToken(''); setOpAmount(''); }}
                        style={{ ...btnStyle, background: activeOp === 'withdraw' ? `${accentColor}15` : 'none', borderColor: activeOp === 'withdraw' ? accentColor : `${accentColor}40`, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <FaWallet style={{ fontSize: '0.6rem' }} /> Withdraw
                    </button>
                    <button onClick={() => { setActiveOp(activeOp === 'send' ? null : 'send'); setOpToken(''); setOpAmount(''); setOpDestination(''); setOpDestSubaccount(''); }}
                        style={{ ...btnStyle, background: activeOp === 'send' ? `${accentColor}15` : 'none', borderColor: activeOp === 'send' ? accentColor : `${accentColor}40`, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <FaPaperPlane style={{ fontSize: '0.6rem' }} /> Send
                    </button>
                </div>

                {/* Operation form */}
                {activeOp && (
                    <div style={{ marginTop: '10px', padding: '12px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${borderColor}` }}>
                        <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '8px' }}>
                            {activeOp === 'fund' && <>Fund from Wallet</>}
                            {activeOp === 'withdraw' && <>Withdraw to Your Wallet</>}
                            {activeOp === 'send' && <>Send to External Account</>}
                            <span style={{ fontSize: '0.7rem', color: theme.colors.mutedText, marginLeft: '8px' }}>
                                {activeOp === 'fund' ? '(to Main Account)' : '(from Main Account)'}
                            </span>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            <div style={{ minWidth: '180px' }}>
                                <label style={{ fontSize: '0.68rem', color: theme.colors.mutedText, display: 'block', marginBottom: '3px' }}>Token</label>
                                <TokenSelector
                                    value={opToken}
                                    onChange={setOpToken}
                                    tokenSubset={activeOp === 'fund' ? undefined : walletOpTokenSubset}
                                    allowCustom={activeOp === 'fund'}
                                    placeholder={activeOp === 'fund' ? 'Search or paste ledger ID...' : 'Select token...'}
                                />
                            </div>

                            <div style={{ minWidth: '120px', flex: 1 }}>
                                <label style={{ fontSize: '0.68rem', color: theme.colors.mutedText, display: 'block', marginBottom: '3px' }}>
                                    Amount
                                    {opToken && opTokenBalance != null && (
                                        <span style={{ marginLeft: '6px', color: theme.colors.secondaryText }}>
                                            ({activeOp === 'fund' ? 'wallet' : 'bal'}: {formatTokenAmount(opTokenBalance, tokDecimals(opToken))})
                                        </span>
                                    )}
                                </label>
                                <div style={{ display: 'flex', gap: '4px' }}>
                                    <input type="text" inputMode="decimal" value={opAmount} onChange={(e) => setOpAmount(e.target.value)}
                                        placeholder="0.00" style={{ ...inputStyle, flex: 1 }} />
                                    {opToken && opTokenBalance != null && opTokenBalance > 0n && (
                                        <button onClick={() => {
                                            const dec = tokDecimals(opToken);
                                            const fee = tokenRegistry.find(t => {
                                                const tid = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
                                                return tid === opToken;
                                            })?.fee || 0n;
                                            const maxRaw = BigInt(opTokenBalance) > BigInt(fee) ? BigInt(opTokenBalance) - BigInt(fee) : 0n;
                                            setOpAmount((Number(maxRaw) / (10 ** dec)).toString());
                                        }} style={{ ...btnStyle, padding: '4px 6px', fontSize: '0.65rem' }}>Max</button>
                                    )}
                                </div>
                            </div>

                            {activeOp === 'send' && (
                                <div style={{ minWidth: '200px', flex: 2 }}>
                                    <label style={{ fontSize: '0.68rem', color: theme.colors.mutedText, display: 'block', marginBottom: '3px' }}>Destination Principal</label>
                                    <input type="text" value={opDestination} onChange={(e) => setOpDestination(e.target.value)}
                                        placeholder="Principal ID..." style={{ ...inputStyle, width: '100%' }} />
                                </div>
                            )}
                            {activeOp === 'send' && (
                                <div style={{ minWidth: '160px' }}>
                                    <label style={{ fontSize: '0.68rem', color: theme.colors.mutedText, display: 'block', marginBottom: '3px' }}>Subaccount (optional, hex)</label>
                                    <input type="text" value={opDestSubaccount} onChange={(e) => setOpDestSubaccount(e.target.value)}
                                        placeholder="0x00...00" style={{ ...inputStyle, width: '100%' }} />
                                </div>
                            )}
                        </div>

                        {activeOp === 'fund' && identity && (
                            <div style={{ marginTop: '6px', fontSize: '0.72rem', color: theme.colors.secondaryText }}>
                                From your wallet: <span style={{ fontFamily: 'monospace', color: accentColor }}>{identity.getPrincipal().toText()}</span>
                            </div>
                        )}

                        {activeOp === 'withdraw' && identity && (
                            <div style={{ marginTop: '6px', fontSize: '0.72rem', color: theme.colors.secondaryText }}>
                                Destination: <span style={{ fontFamily: 'monospace', color: accentColor }}>{identity.getPrincipal().toText()}</span>
                            </div>
                        )}

                        <div style={{ marginTop: '10px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <button onClick={handleExecuteOp} disabled={opExecuting || !opToken || !opAmount || (activeOp === 'send' && !opDestination)}
                                style={{
                                    ...btnStyle, padding: '6px 14px', fontWeight: '600',
                                    opacity: (opExecuting || !opToken || !opAmount) ? 0.5 : 1,
                                    background: `${accentColor}15`, borderColor: accentColor,
                                }}>
                                {opExecuting ? 'Executing...' : (
                                    activeOp === 'fund' ? 'Fund' :
                                    activeOp === 'withdraw' ? 'Withdraw' : 'Send'
                                )}
                            </button>
                            <button onClick={() => setActiveOp(null)} style={{ ...btnStyle, color: theme.colors.mutedText, borderColor: borderColor }}>
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Main Purse (unallocated) ── */}
            <div style={{ padding: '12px', background: cardBg, borderRadius: '10px', border: `1px solid ${borderColor}`, marginBottom: '14px' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '0.85rem', fontWeight: 600, color: theme.colors.primaryText }}>
                    Main Purse
                </h4>
                <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText || theme.colors.secondaryText, marginBottom: '8px' }}>
                    Unallocated funds available for chores without a dedicated purse, or to fund chore purses.
                </div>
                {mainPurseEntries.length === 0 ? (
                    <div style={{ fontSize: '0.82rem', color: theme.colors.secondaryText, fontStyle: 'italic' }}>No token balances detected.</div>
                ) : (
                    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '360px' }}>
                        <thead>
                            <tr style={rowBorder}>
                                <th style={thStyle}>Token</th>
                                <th style={thStyleR}>Available</th>
                                <th style={thStyleR}>Allocated</th>
                                <th style={thStyleR}>On-chain</th>
                            </tr>
                        </thead>
                        <tbody>
                            {mainPurseEntries.map((e, i) => {
                                const dec = tokDecimals(e.token);
                                return (
                                    <tr key={i} style={rowBorder}>
                                        <td style={tdStyle}>
                                            {tokLabel(e.token)}
                                            {e.overcommitted && <span style={{ color: '#e74c3c', fontSize: '0.72rem', marginLeft: '6px' }}>overcommitted</span>}
                                        </td>
                                        <td style={tdStyleR}>{fmtBal(e.balance, dec)}</td>
                                        <td style={{ ...tdStyleR, color: theme.colors.secondaryText }}>{fmtBal(e.allocated, dec)}</td>
                                        <td style={{ ...tdStyleR, color: theme.colors.secondaryText }}>{fmtBal(e.onChain, dec)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    </div>
                )}
            </div>

            {/* ── Purse Allocations (per-chore) ── */}
            <div style={{ padding: '12px', background: cardBg, borderRadius: '10px', border: `1px solid ${borderColor}`, marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                    <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <FaWallet style={{ color: accentColor, fontSize: '0.75rem' }} /> Purse Allocations
                    </h4>
                    {enabledPurses.length > 0 && (
                        <button onClick={handleReclaimAll} disabled={reclaimingAll || purseSaving}
                            style={{ ...btnStyle, fontSize: '0.68rem', padding: '3px 8px', color: '#e67e22', borderColor: '#e67e2240', opacity: (reclaimingAll || purseSaving) ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <FaArrowUp size={8} /> {reclaimingAll ? 'Reclaiming...' : 'Reclaim All to Main'}
                        </button>
                    )}
                </div>
                {enabledPurses.length === 0 ? (
                    <div style={{ fontSize: '0.82rem', color: theme.colors.secondaryText, fontStyle: 'italic', padding: '8px 0' }}>
                        No chores have funded purses yet. Enable a purse in a chore's settings to isolate its balances.
                    </div>
                ) : (
                    enabledPurses.map((chore) => {
                        const purseTokenIds = chore.balances.filter(b => Number(b.balance) > 0).map(b => {
                            return typeof b.token === 'string' ? b.token : b.token?.toText?.() || String(b.token);
                        });
                        const allRegTokenIds = tokenRegistry.map(t => {
                            const tid = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
                            return tid;
                        });
                        const mainTokenIds = mainPurseEntries.map(e => e.token);
                        const isFunding = fundTarget === chore.instanceId;
                        const isReclaiming = reclaimTarget === chore.instanceId;
                        const isWithdrawing = withdrawTarget === chore.instanceId;
                        const maxBtnSt = { padding: '2px 6px', fontSize: '0.66rem', border: `1px solid ${borderColor}`, borderRadius: '4px', cursor: 'pointer', background: 'none', color: accentColor, fontWeight: 600, lineHeight: 1 };

                        return (
                            <div key={chore.instanceId} style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${borderColor}`, marginBottom: '10px' }}>
                                <h5 style={{ margin: '0 0 6px 0', fontSize: '0.82rem', fontWeight: 600, color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <FaWallet style={{ color: accentColor, fontSize: '0.7rem' }} />
                                    {choreLabel(chore.instanceId)}
                                </h5>
                                {(() => {
                                    const denomSym = denomToken ? tokLabel(denomToken) : '';
                                    const denomSign = getCurrencySign(denomToken);
                                    let totalPurseValue = 0;
                                    let hasAnyValue = false;
                                    const purseRows = chore.balances.filter(b => Number(b.balance) > 0).map((b) => {
                                        const tok = typeof b.token === 'string' ? b.token : b.token?.toText?.() || String(b.token);
                                        const dec = tokDecimals(tok);
                                        const humanBal = Number(b.balance) / (10 ** dec);
                                        const price = denomPrices[tok];
                                        let denomValue = null;
                                        if (denomToken && price != null && price > 0) {
                                            denomValue = humanBal * price;
                                            totalPurseValue += denomValue;
                                            hasAnyValue = true;
                                        }
                                        return { tok, dec, balance: b.balance, humanBal, price, denomValue };
                                    });
                                    return (
                                    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: denomToken ? '420px' : '260px' }}>
                                        <thead>
                                            <tr style={rowBorder}>
                                                <th style={thStyle}>Token</th>
                                                <th style={thStyleR}>Balance</th>
                                                {denomToken && <th style={thStyleR}>Price ({denomSign || denomSym})</th>}
                                                {denomToken && <th style={thStyleR}>{denomSign ? `Value (${denomSign})` : `Value (${denomSym})`}</th>}
                                                {denomToken && hasAnyValue && <th style={thStyleR}>%</th>}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {purseRows.map(({ tok, dec, balance, price, denomValue }, i) => (
                                                <tr key={i} style={rowBorder}>
                                                    <td style={tdStyle}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                            <TokenIcon canisterId={tok} size={16} />
                                                            {tokLabel(tok)}
                                                        </div>
                                                    </td>
                                                    <td style={tdStyleR}>{fmtBal(balance, dec)}</td>
                                                    {denomToken && (
                                                        <td style={{ ...tdStyleR, color: price != null ? theme.colors.secondaryText : theme.colors.mutedText, fontSize: '0.75rem' }}>
                                                            {tok === denomToken ? '1.00' : (price != null
                                                                ? formatDenomAmount(price, denomToken, denomSym)
                                                                : (loadingPrices ? '...' : '—'))}
                                                        </td>
                                                    )}
                                                    {denomToken && (
                                                        <td style={{ ...tdStyleR, color: denomValue != null ? theme.colors.primaryText : theme.colors.mutedText, fontSize: '0.78rem' }}>
                                                            {denomValue != null
                                                                ? formatDenomAmount(denomValue, denomToken, denomSym)
                                                                : (loadingPrices ? '...' : '—')}
                                                        </td>
                                                    )}
                                                    {denomToken && hasAnyValue && (
                                                        <td style={{ ...tdStyleR, fontSize: '0.75rem', color: denomValue != null && totalPurseValue > 0 ? accentColor : theme.colors.mutedText }}>
                                                            {denomValue != null && totalPurseValue > 0
                                                                ? ((denomValue / totalPurseValue) * 100).toFixed(1) + '%'
                                                                : '—'}
                                                        </td>
                                                    )}
                                                </tr>
                                            ))}
                                            {denomToken && hasAnyValue && (
                                                <tr style={{ borderTop: `2px solid ${borderColor}40` }}>
                                                    <td style={{ ...tdStyle, fontWeight: '700' }}>Total</td>
                                                    <td />
                                                    {denomToken && <td />}
                                                    <td style={{ ...tdStyleR, fontWeight: '700', color: accentColor, fontSize: '0.85rem' }}>
                                                        {formatDenomAmount(totalPurseValue, denomToken, denomSym)}
                                                    </td>
                                                    <td style={{ ...tdStyleR, fontWeight: '600', color: accentColor, fontSize: '0.75rem' }}>100%</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                    </div>
                                    );
                                })()}

                                {/* Fund / Reclaim / Withdraw controls */}
                                <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                                    <button onClick={() => { setFundTarget(isFunding ? null : chore.instanceId); setFundToken(''); setFundAmount(''); setFundSource('main'); setReclaimTarget(null); setWithdrawTarget(null); }}
                                        style={{ ...btnStyle, fontSize: '0.7rem', padding: '3px 8px', background: isFunding ? `${accentColor}15` : 'none', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                        <FaArrowDown size={9} /> Fund
                                    </button>
                                    <button onClick={() => { setReclaimTarget(isReclaiming ? null : chore.instanceId); setReclaimToken(''); setReclaimAmount(''); setFundTarget(null); setWithdrawTarget(null); }}
                                        style={{ ...btnStyle, fontSize: '0.7rem', padding: '3px 8px', color: '#e67e22', borderColor: '#e67e2240', background: isReclaiming ? '#e67e2215' : 'none', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                        <FaArrowUp size={9} /> Reclaim
                                    </button>
                                    <button onClick={() => { setWithdrawTarget(isWithdrawing ? null : chore.instanceId); setWithdrawToken(''); setWithdrawAmount(''); setFundTarget(null); setReclaimTarget(null); }}
                                        style={{ ...btnStyle, fontSize: '0.7rem', padding: '3px 8px', color: '#8e44ad', borderColor: '#8e44ad40', background: isWithdrawing ? '#8e44ad15' : 'none', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                        <FaArrowUp size={9} /> To Wallet
                                    </button>
                                </div>

                                {isFunding && (<>
                                    <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                        <select value={fundSource} onChange={e => { setFundSource(e.target.value); setFundToken(''); setFundAmount(''); setFundSourceBalance(null); }}
                                            style={{ ...inputStyle, width: 'auto', padding: '3px 6px', fontSize: '0.72rem' }}>
                                            <option value="main">Main Purse</option>
                                            <option value="wallet">My Wallet</option>
                                        </select>
                                        <div style={{ minWidth: '140px' }}>
                                            <TokenSelector
                                                value={fundToken}
                                                onChange={v => { setFundToken(v); setFundAmount(''); }}
                                                onSelectToken={cacheTokenMeta}
                                                {...(fundSource === 'wallet'
                                                    ? {}
                                                    : { tokenSubset: mainTokenIds.map(id => ({ ledger_id: id, symbol: tokLabel(id), name: tokLabel(id) })) }
                                                )}
                                                placeholder="Token..."
                                            />
                                        </div>
                                        <input type="number" placeholder="Amount" value={fundAmount} onChange={e => setFundAmount(e.target.value)}
                                            style={{ ...inputStyle, width: '110px', fontSize: '0.78rem' }} step="any" min="0" />
                                        <button onClick={handleMaxFundPurse} disabled={!fundToken} style={maxBtnSt} title="Max available">Max</button>
                                        <button onClick={handleFundPurse} disabled={purseSaving || !fundToken || !fundAmount}
                                            style={{ ...btnStyle, fontSize: '0.7rem', padding: '4px 10px', opacity: (purseSaving || !fundToken || !fundAmount) ? 0.5 : 1 }}>
                                            {purseSaving ? 'Funding...' : 'Fund'}
                                        </button>
                                    </div>
                                    {fundToken && (() => {
                                        const displayBal = fundSource === 'wallet' ? fundSourceBalance : (() => {
                                            const tid = typeof fundToken === 'string' ? fundToken : fundToken?.toText?.() || '';
                                            const e = mainPurseEntries.find(x => x.token === tid);
                                            return e ? BigInt(e.balance) : 0n;
                                        })();
                                        const isLoading = fundSource === 'wallet' && fundBalanceLoading;
                                        return (
                                            <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginTop: '4px', paddingLeft: '2px' }}>
                                                {isLoading ? 'Fetching balance...' : displayBal != null ? (
                                                    <span>
                                                        {fundSource === 'wallet' ? 'Wallet' : 'Main purse'} balance:{' '}
                                                        <span style={{ fontFamily: 'monospace', color: theme.colors.primaryText, fontWeight: 500 }}>
                                                            {fmtBal(displayBal, tokDecimals(fundToken))}
                                                        </span>
                                                        {' '}{tokLabel(fundToken)}
                                                    </span>
                                                ) : null}
                                            </div>
                                        );
                                    })()}
                                </>)}

                                {isReclaiming && (
                                    <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                        <div style={{ minWidth: '140px' }}>
                                            <TokenSelector
                                                value={reclaimToken}
                                                onChange={v => { setReclaimToken(v); setReclaimAmount(''); }}
                                                tokenSubset={purseTokenIds.map(id => ({ ledger_id: id, symbol: tokLabel(id), name: tokLabel(id) }))}
                                                placeholder="Token..."
                                            />
                                        </div>
                                        <input type="number" placeholder="Amount" value={reclaimAmount} onChange={e => setReclaimAmount(e.target.value)}
                                            style={{ ...inputStyle, width: '110px', fontSize: '0.78rem' }} step="any" min="0" />
                                        <button onClick={() => handleMaxReclaimPurse(chore.balances)} disabled={!reclaimToken} style={maxBtnSt} title="Max purse balance">Max</button>
                                        <button onClick={handleReclaimPurse} disabled={purseSaving || !reclaimToken || !reclaimAmount}
                                            style={{ ...btnStyle, fontSize: '0.7rem', padding: '4px 10px', color: '#e67e22', borderColor: '#e67e2240', opacity: (purseSaving || !reclaimToken || !reclaimAmount) ? 0.5 : 1 }}>
                                            {purseSaving ? 'Reclaiming...' : 'Reclaim'}
                                        </button>
                                    </div>
                                )}

                                {isWithdrawing && (
                                    <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                        <div style={{ minWidth: '140px' }}>
                                            <TokenSelector
                                                value={withdrawToken}
                                                onChange={v => { setWithdrawToken(v); setWithdrawAmount(''); }}
                                                tokenSubset={purseTokenIds.map(id => ({ ledger_id: id, symbol: tokLabel(id), name: tokLabel(id) }))}
                                                placeholder="Token..."
                                            />
                                        </div>
                                        <input type="number" placeholder="Amount" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)}
                                            style={{ ...inputStyle, width: '110px', fontSize: '0.78rem' }} step="any" min="0" />
                                        <button onClick={() => handleMaxWithdrawPurse(chore.balances)} disabled={!withdrawToken} style={maxBtnSt} title="Max (minus fee)">Max</button>
                                        <button onClick={handleWithdrawFromPurse} disabled={purseSaving || !withdrawToken || !withdrawAmount}
                                            style={{ ...btnStyle, fontSize: '0.7rem', padding: '4px 10px', color: '#8e44ad', borderColor: '#8e44ad40', opacity: (purseSaving || !withdrawToken || !withdrawAmount) ? 0.5 : 1 }}>
                                            {purseSaving ? 'Sending...' : 'To Wallet'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
        </DndProvider>
    );
}

// ============================================
// Chore Purse Panel (per-chore, inline)
// ============================================
function PursePanel({ instanceId, getReadyBotActor, theme, accentColor, canisterId }) {
    const { identity } = useAuth();
    const [purseEnabled, setPurseEnabled] = useState(null);
    const [purseBalances, setPurseBalances] = useState([]);
    const [mainPurseBalances, setMainPurseBalances] = useState([]);
    const [registeredTokenIds, setRegisteredTokenIds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [fundSource, setFundSource] = useState('main');
    const [fundToken, setFundToken] = useState('');
    const [fundAmount, setFundAmount] = useState('');
    const [reclaimToken, setReclaimToken] = useState('');
    const [reclaimAmount, setReclaimAmount] = useState('');
    const [withdrawToken, setWithdrawToken] = useState('');
    const [withdrawAmount, setWithdrawAmount] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [fundSourceBalance, setFundSourceBalance] = useState(null);
    const [fundBalanceLoading, setFundBalanceLoading] = useState(false);
    // Cross-chore purse sharing
    const [tradingPurseId, setTradingPurseIdState] = useState(null);
    const [otherPurseChores, setOtherPurseChores] = useState([]);
    const [choreLabels, setChoreLabels] = useState({});
    const [refPurseBalances, setRefPurseBalances] = useState([]);

    const cardSt = { background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`, borderRadius: '8px', padding: '14px', marginBottom: '10px' };
    const btnSm = (extra = {}) => ({
        padding: '5px 12px', fontSize: '0.8rem', border: `1px solid ${theme.colors.border}`,
        borderRadius: '6px', cursor: 'pointer', background: theme.colors.cardBg, color: theme.colors.primaryText,
        display: 'inline-flex', alignItems: 'center', gap: '4px', ...extra,
    });
    const inp = (extra = {}) => ({
        padding: '6px 10px', fontSize: '0.82rem', borderRadius: '6px',
        border: `1px solid ${theme.colors.border}`,
        background: theme.colors.inputBg || theme.colors.secondaryBg,
        color: theme.colors.primaryText, outline: 'none', ...extra,
    });

    const tokLabel = (tok) => {
        const p = typeof tok === 'string' ? tok : tok?.toText?.() || tok?.toString?.() || '';
        const cached = getTokenMetadataSync(p);
        return cached?.symbol || p.slice(0, 8) + '...';
    };
    const tokDecimals = (tok) => {
        const p = typeof tok === 'string' ? tok : tok?.toText?.() || tok?.toString?.() || '';
        const cached = getTokenMetadataSync(p);
        return cached?.decimals ?? 8;
    };
    const fmtBal = (raw, decimals) => {
        const n = Number(raw);
        if (isNaN(n)) return '0';
        return (n / (10 ** Number(decimals))).toLocaleString(undefined, { maximumFractionDigits: Number(decimals) });
    };
    const tokFee = (tok) => {
        const p = typeof tok === 'string' ? tok : tok?.toText?.() || tok?.toString?.() || '';
        const cached = getTokenMetadataSync(p);
        return cached?.fee != null ? Number(cached.fee) : 10000;
    };
    const maxBtnSt = { padding: '2px 6px', fontSize: '0.68rem', border: `1px solid ${theme.colors.border}`, borderRadius: '4px', cursor: 'pointer', background: 'none', color: accentColor, fontWeight: 600, lineHeight: 1 };

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const actor = await getReadyBotActor();
            const [allPurses, regTokens, tpId, choreStatuses] = await Promise.all([
                actor.getAllPurseAllocations(),
                actor.getTokenRegistry ? actor.getTokenRegistry() : [],
                actor.getTradingPurseId ? actor.getTradingPurseId(instanceId) : [],
                actor.getChoreStatuses ? actor.getChoreStatuses() : [],
            ]);
            setRegisteredTokenIds(regTokens.map(t => {
                const tid = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
                return tid;
            }));

            // Trading purse override
            const tpVal = Array.isArray(tpId) ? (tpId.length > 0 ? tpId[0] : null) : tpId;
            setTradingPurseIdState(tpVal);

            // Build chore label map and list of other purse-enabled chores
            const labels = {};
            for (const c of choreStatuses) {
                labels[c.choreId] = c.instanceLabel && c.instanceLabel !== c.choreName
                    ? `${c.choreName} — ${c.instanceLabel}` : (c.instanceLabel || c.choreName || c.choreId);
            }
            setChoreLabels(labels);
            const others = allPurses.filter(p => p.enabled && p.instanceId !== instanceId);
            setOtherPurseChores(others.map(p => p.instanceId));

            // If referencing another purse, show its balances
            if (tpVal) {
                const refPurse = allPurses.find(p => p.instanceId === tpVal);
                setRefPurseBalances((refPurse?.balances || []).filter(b => Number(b.balance) > 0));
            } else {
                setRefPurseBalances([]);
            }

            const myPurse = allPurses.find(p => p.instanceId === instanceId);
            const enabled = myPurse?.enabled ?? false;
            setPurseEnabled(enabled);

            if (enabled) {
                const bals = (myPurse?.balances || []).filter(b => Number(b.balance) > 0);
                setPurseBalances(bals);

                // Collect all tokens that have purse allocations across ALL chores (for main purse computation)
                const totalAllocated = {}; // tokenKey -> BigInt total
                const tokenSet = new Set();
                for (const chore of allPurses) {
                    for (const b of chore.balances) {
                        const tok = typeof b.token === 'string' ? b.token : b.token?.toText?.() || String(b.token);
                        const subNum = b.subaccountNumber?.[0] != null ? Number(b.subaccountNumber[0]) : null;
                        const key = subNum != null ? `${tok}:${subNum}` : tok;
                        tokenSet.add(tok);
                        totalAllocated[key] = (totalAllocated[key] || 0n) + BigInt(b.balance);
                    }
                }

                // Fetch on-chain balances for these tokens directly from ledgers
                if (tokenSet.size > 0 && canisterId) {
                    try {
                        const { HttpAgent } = await import('@dfinity/agent');
                        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                        const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
                        const agent = HttpAgent.createSync({ identity, host });
                        if (isLocal) await agent.fetchRootKey();
                        const botPrincipal = Principal.fromText(canisterId);

                        const tokens = [...tokenSet];
                        const onChain = {};
                        await Promise.all(tokens.map(async (tid) => {
                            try {
                                const ledgerActor = createLedgerActor(tid, { agent });
                                const bal = await ledgerActor.icrc1_balance_of({ owner: botPrincipal, subaccount: [] });
                                onChain[tid] = BigInt(bal);
                            } catch (_) { onChain[tid] = 0n; }
                        }));

                        // Compute main purse: on-chain - sum of all chore allocations (main account only, subaccountNumber=null)
                        const mainBals = [];
                        for (const tid of tokens) {
                            const chain = onChain[tid] || 0n;
                            const allocated = totalAllocated[tid] || 0n;
                            const available = chain > allocated ? chain - allocated : 0n;
                            const overcommitted = allocated > chain;
                            if (chain > 0n || overcommitted) {
                                mainBals.push({ token: tid, subaccountNumber: [], balance: available, overcommitted });
                            }
                        }
                        setMainPurseBalances(mainBals);
                    } catch (e) {
                        console.warn('PursePanel: failed to fetch on-chain balances', e);
                        setMainPurseBalances([]);
                    }
                } else {
                    setMainPurseBalances([]);
                }
            } else {
                setPurseBalances([]);
                setMainPurseBalances([]);
            }
        } catch (e) {
            setError(e?.message || String(e));
        } finally {
            setLoading(false);
        }
    }, [instanceId, getReadyBotActor, canisterId, identity]);

    useEffect(() => { loadData(); }, [loadData]);

    const handleToggle = async () => {
        setSaving(true); setError(null); setSuccess(null);
        try {
            const actor = await getReadyBotActor();
            if (purseEnabled) {
                const result = await actor.disablePurse(instanceId);
                if ('Err' in result) { setError(result.Err); return; }
            } else {
                await actor.enablePurse(instanceId);
            }
            await loadData();
            setSuccess(purseEnabled ? 'Purse disabled' : 'Purse enabled');
        } catch (e) {
            setError(e?.message || String(e));
        } finally {
            setSaving(false);
        }
    };

    const handleFund = async () => {
        if (!fundToken || !fundAmount) return;
        setSaving(true); setError(null); setSuccess(null);
        try {
            const actor = await getReadyBotActor();
            const dec = tokDecimals(fundToken);
            const raw = BigInt(Math.round(parseFloat(fundAmount) * (10 ** Number(dec))));
            const tokenPrincipal = typeof fundToken === 'string' ? Principal.fromText(fundToken) : fundToken;
            if (fundSource === 'wallet') {
                const tokId = typeof fundToken === 'string' ? fundToken : fundToken.toText();
                const cached = getTokenMetadataSync(tokId);
                if (cached) {
                    try { await actor.addToken({ ledgerCanisterId: Principal.fromText(tokId), symbol: cached.symbol || '???', decimals: cached.decimals ?? 8, fee: BigInt(cached.fee ?? 10000) }); } catch (_) {}
                }
                const botPrincipal = Principal.fromText(canisterId);
                const ledgerActor = createLedgerActor(tokId, { agentOptions: { identity } });
                const xferResult = await ledgerActor.icrc1_transfer({
                    to: { owner: botPrincipal, subaccount: [] },
                    amount: raw, fee: [], memo: [], from_subaccount: [], created_at_time: [],
                });
                if ('Err' in xferResult) { setError('Wallet transfer failed: ' + JSON.stringify(xferResult.Err)); return; }
                const fundResult = await actor.fundPurse(instanceId, tokenPrincipal, raw);
                if ('Err' in fundResult) { setError(fundResult.Err); return; }
                setSuccess('Funded from wallet successfully');
            } else {
                const result = await actor.fundPurse(instanceId, tokenPrincipal, raw);
                if ('Err' in result) { setError(result.Err); return; }
                setSuccess('Funded successfully');
            }
            setFundAmount('');
            await loadData();
        } catch (e) {
            setError(e?.message || String(e));
        } finally {
            setSaving(false);
        }
    };

    const handleReclaim = async () => {
        if (!reclaimToken || !reclaimAmount) return;
        setSaving(true); setError(null); setSuccess(null);
        try {
            const actor = await getReadyBotActor();
            const dec = tokDecimals(reclaimToken);
            const raw = BigInt(Math.round(parseFloat(reclaimAmount) * (10 ** Number(dec))));
            const result = await actor.reclaimFromPurse(instanceId, typeof reclaimToken === 'string' ? Principal.fromText(reclaimToken) : reclaimToken, raw);
            if ('Err' in result) { setError(result.Err); return; }
            setSuccess('Reclaimed successfully');
            setReclaimAmount('');
            await loadData();
        } catch (e) {
            setError(e?.message || String(e));
        } finally {
            setSaving(false);
        }
    };

    const handleWithdrawToWallet = async () => {
        if (!withdrawToken || !withdrawAmount) return;
        setSaving(true); setError(null); setSuccess(null);
        try {
            const actor = await getReadyBotActor();
            const dec = tokDecimals(withdrawToken);
            const raw = BigInt(Math.round(parseFloat(withdrawAmount) * (10 ** Number(dec))));
            const tokenPrincipal = typeof withdrawToken === 'string' ? Principal.fromText(withdrawToken) : withdrawToken;
            const userPrincipal = identity.getPrincipal();
            const result = await actor.manualSend(tokenPrincipal, [instanceId], userPrincipal, [], raw);
            if ('Err' in result) { setError('Withdraw failed: ' + JSON.stringify(result.Err)); return; }
            setSuccess(`Withdrawn to wallet. Block: ${result.Ok.blockIndex.toString()}`);
            setWithdrawAmount('');
            await loadData();
        } catch (e) {
            setError(e?.message || String(e));
        } finally {
            setSaving(false);
        }
    };

    const handleSetTradingPurse = async (newPurseId) => {
        setSaving(true); setError(null); setSuccess(null);
        try {
            const actor = await getReadyBotActor();
            const optVal = newPurseId ? [newPurseId] : [];
            const result = await actor.setTradingPurseId(instanceId, optVal);
            if (result && 'Err' in result) { setError(result.Err); return; }
            setSuccess(newPurseId ? `Now trading from ${choreLabels[newPurseId] || newPurseId}'s purse` : 'Trading purse override cleared');
            await loadData();
        } catch (e) {
            setError(e?.message || String(e));
        } finally {
            setSaving(false);
        }
    };

    const handleMaxFund = async () => {
        if (!fundToken) return;
        const dec = tokDecimals(fundToken);
        if (fundSource === 'wallet') {
            try {
                const { HttpAgent } = await import('@dfinity/agent');
                const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
                const agent = HttpAgent.createSync({ identity, host });
                if (isLocal) await agent.fetchRootKey();
                const userPrincipal = identity.getPrincipal();
                const tokId = typeof fundToken === 'string' ? fundToken : fundToken.toText();
                const ledgerActor = createLedgerActor(tokId, { agent });
                const bal = BigInt(await ledgerActor.icrc1_balance_of({ owner: userPrincipal, subaccount: [] }));
                const fee = BigInt(tokFee(fundToken));
                const max = bal > fee ? bal - fee : 0n;
                setFundAmount((Number(max) / (10 ** Number(dec))).toString());
            } catch (e) { console.warn('Failed to fetch wallet balance', e); }
        } else {
            const tokId = typeof fundToken === 'string' ? fundToken : fundToken?.toText?.() || '';
            const entry = mainPurseBalances.find(b => { const p = typeof b.token === 'string' ? b.token : b.token?.toText?.() || ''; return p === tokId; });
            if (entry) setFundAmount((Number(entry.balance) / (10 ** Number(dec))).toString());
        }
    };
    const handleMaxReclaim = () => {
        if (!reclaimToken) return;
        const dec = tokDecimals(reclaimToken);
        const tokId = typeof reclaimToken === 'string' ? reclaimToken : reclaimToken?.toText?.() || '';
        const entry = purseBalances.find(b => { const p = typeof b.token === 'string' ? b.token : b.token?.toText?.() || ''; return p === tokId; });
        if (entry) setReclaimAmount((Number(entry.balance) / (10 ** Number(dec))).toString());
    };
    const handleMaxWithdraw = () => {
        if (!withdrawToken) return;
        const dec = tokDecimals(withdrawToken);
        const fee = tokFee(withdrawToken);
        const tokId = typeof withdrawToken === 'string' ? withdrawToken : withdrawToken?.toText?.() || '';
        const entry = purseBalances.find(b => { const p = typeof b.token === 'string' ? b.token : b.token?.toText?.() || ''; return p === tokId; });
        if (entry) {
            const raw = Number(entry.balance);
            const max = raw > fee ? raw - fee : 0;
            setWithdrawAmount((max / (10 ** Number(dec))).toString());
        }
    };

    useEffect(() => {
        if (!fundToken || fundSource !== 'wallet') { setFundSourceBalance(null); setFundBalanceLoading(false); return; }
        if (!identity) { setFundSourceBalance(null); return; }
        const tokId = typeof fundToken === 'string' ? fundToken : fundToken?.toText?.() || '';
        let cancelled = false;
        setFundBalanceLoading(true);
        (async () => {
            try {
                const { HttpAgent } = await import('@dfinity/agent');
                const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
                const agent = HttpAgent.createSync({ identity, host });
                if (isLocal) await agent.fetchRootKey();
                const ledger = createLedgerActor(tokId, { agent });
                const bal = BigInt(await ledger.icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] }));
                if (!cancelled) setFundSourceBalance(bal);
            } catch { if (!cancelled) setFundSourceBalance(null); }
            finally { if (!cancelled) setFundBalanceLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [fundToken, fundSource, identity]);

    if (loading) return <div style={{ fontSize: '0.82rem', color: theme.colors.secondaryText, padding: '8px 0' }}>Loading purse...</div>;

    // Gather all tokens from main purse for fund dropdown
    const mainTokenIds = mainPurseBalances.map(b => typeof b.token === 'string' ? b.token : b.token?.toText?.() || b.token?.toString?.() || '');
    const purseTokenIds = purseBalances.map(b => typeof b.token === 'string' ? b.token : b.token?.toText?.() || b.token?.toString?.() || '');

    return (
        <div style={cardSt}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <h4 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 600, color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <FaWallet style={{ color: accentColor }} /> Chore Purse
                </h4>
                <button onClick={handleToggle} disabled={saving} style={btnSm({ color: purseEnabled ? '#27ae60' : '#e74c3c' })}>
                    {purseEnabled ? <FaToggleOn size={16} /> : <FaToggleOff size={16} />}
                    {purseEnabled ? 'Enabled' : 'Disabled'}
                </button>
                <button onClick={loadData} disabled={saving} style={btnSm()} title="Refresh">
                    <FaSyncAlt size={12} />
                </button>
            </div>

            {error && <div style={{ color: '#e74c3c', fontSize: '0.8rem', marginBottom: '8px' }}>{error}</div>}
            {success && <div style={{ color: '#27ae60', fontSize: '0.8rem', marginBottom: '8px' }}>{success}</div>}

            {/* Trading Purse Override */}
            {(otherPurseChores.length > 0 || tradingPurseId) && (
                <div style={{ marginBottom: '12px', padding: '10px 12px', background: `${accentColor}08`, border: `1px solid ${accentColor}20`, borderRadius: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.78rem', color: theme.colors.secondaryText, fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <FaExchangeAlt size={11} style={{ color: accentColor }} /> Trade from:
                        </span>
                        <select
                            value={tradingPurseId || ''}
                            onChange={e => handleSetTradingPurse(e.target.value || null)}
                            disabled={saving}
                            style={inp({ width: 'auto', padding: '4px 8px', fontSize: '0.78rem', minWidth: '180px' })}
                        >
                            <option value="">— {purseEnabled ? 'Own purse' : 'Main purse'} (default) —</option>
                            {otherPurseChores.map(cid => (
                                <option key={cid} value={cid}>{choreLabels[cid] || cid}</option>
                            ))}
                        </select>
                        {tradingPurseId && (
                            <span style={{ fontSize: '0.72rem', color: accentColor, fontStyle: 'italic' }}>
                                Trades will use {choreLabels[tradingPurseId] || tradingPurseId}'s purse
                            </span>
                        )}
                    </div>
                    {/* Show referenced purse balances */}
                    {tradingPurseId && refPurseBalances.length > 0 && (
                        <div style={{ marginTop: '8px' }}>
                            <div style={{ fontSize: '0.72rem', color: theme.colors.secondaryText, fontWeight: 500, marginBottom: '3px' }}>
                                {choreLabels[tradingPurseId] || tradingPurseId}'s purse balances:
                            </div>
                            <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
                                <tbody>
                                    {refPurseBalances.map((b, i) => {
                                        const p = typeof b.token === 'string' ? b.token : b.token?.toText?.() || b.token?.toString?.() || '';
                                        const dec = tokDecimals(p);
                                        return (
                                            <tr key={i} style={{ borderBottom: `1px solid ${theme.colors.border}22` }}>
                                                <td style={{ padding: '2px 8px', color: theme.colors.primaryText }}>{tokLabel(p)}</td>
                                                <td style={{ padding: '2px 8px', textAlign: 'right', color: theme.colors.primaryText, fontFamily: 'monospace' }}>{fmtBal(b.balance, dec)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {tradingPurseId && refPurseBalances.length === 0 && (
                        <div style={{ marginTop: '6px', fontSize: '0.72rem', color: theme.colors.secondaryText, fontStyle: 'italic' }}>
                            Referenced purse is empty
                        </div>
                    )}
                </div>
            )}

            {purseEnabled && (
                <>
                    {/* Purse Balances */}
                    <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontSize: '0.78rem', color: theme.colors.secondaryText, fontWeight: 500, marginBottom: '4px' }}>Purse Balances</div>
                        {purseBalances.length === 0 ? (
                            <div style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, fontStyle: 'italic' }}>Empty — fund this purse to begin trading</div>
                        ) : (
                            <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
                                        <th style={{ textAlign: 'left', padding: '4px 8px', color: theme.colors.secondaryText, fontWeight: 500 }}>Token</th>
                                        <th style={{ textAlign: 'right', padding: '4px 8px', color: theme.colors.secondaryText, fontWeight: 500 }}>Balance</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {purseBalances.map((b, i) => {
                                        const p = typeof b.token === 'string' ? b.token : b.token?.toText?.() || b.token?.toString?.() || '';
                                        const dec = tokDecimals(p);
                                        return (
                                            <tr key={i} style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
                                                <td style={{ padding: '4px 8px', color: theme.colors.primaryText }}>{tokLabel(p)}{b.subaccountNumber?.[0] != null ? ` (sub ${Number(b.subaccountNumber[0])})` : ''}</td>
                                                <td style={{ padding: '4px 8px', textAlign: 'right', color: theme.colors.primaryText, fontFamily: 'monospace' }}>{fmtBal(b.balance, dec)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* Main Purse Context */}
                    {mainPurseBalances.length > 0 && (
                        <div style={{ marginBottom: '12px' }}>
                            <div style={{ fontSize: '0.78rem', color: theme.colors.secondaryText, fontWeight: 500, marginBottom: '4px' }}>Main Purse (available to fund)</div>
                            <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
                                        <th style={{ textAlign: 'left', padding: '4px 8px', color: theme.colors.secondaryText, fontWeight: 500 }}>Token</th>
                                        <th style={{ textAlign: 'right', padding: '4px 8px', color: theme.colors.secondaryText, fontWeight: 500 }}>Available</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {mainPurseBalances.map((b, i) => {
                                        const p = typeof b.token === 'string' ? b.token : b.token?.toText?.() || b.token?.toString?.() || '';
                                        const dec = tokDecimals(p);
                                        return (
                                            <tr key={i} style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
                                                <td style={{ padding: '4px 8px', color: theme.colors.primaryText }}>
                                                    {tokLabel(p)}
                                                    {b.overcommitted && <span style={{ color: '#e74c3c', fontSize: '0.72rem', marginLeft: '6px' }}>overcommitted</span>}
                                                </td>
                                                <td style={{ padding: '4px 8px', textAlign: 'right', color: theme.colors.primaryText, fontFamily: 'monospace' }}>{fmtBal(b.balance, dec)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Fund */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: fundToken ? '4px' : '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.78rem', color: theme.colors.secondaryText, fontWeight: 500 }}>Fund from:</span>
                        <select value={fundSource} onChange={e => { setFundSource(e.target.value); setFundToken(''); setFundAmount(''); setFundSourceBalance(null); }} style={inp({ width: 'auto', padding: '4px 8px', fontSize: '0.76rem' })}>
                            <option value="main">Main Purse</option>
                            <option value="wallet">My Wallet</option>
                        </select>
                        <div style={{ minWidth: '140px' }}>
                            <TokenSelector
                                value={fundToken}
                                onChange={v => { setFundToken(v); setFundAmount(''); }}
                                onSelectToken={cacheTokenMeta}
                                {...(fundSource === 'wallet'
                                    ? {}
                                    : { tokenSubset: mainTokenIds.map(id => ({ ledger_id: id, symbol: tokLabel(id), name: tokLabel(id) })) }
                                )}
                                placeholder="Token..."
                            />
                        </div>
                        <input type="number" placeholder="Amount" value={fundAmount} onChange={e => setFundAmount(e.target.value)} style={inp({ width: '110px' })} step="any" min="0" />
                        <button onClick={handleMaxFund} disabled={!fundToken} style={maxBtnSt} title="Max available">Max</button>
                        <button onClick={handleFund} disabled={saving || !fundToken || !fundAmount} style={btnSm({ color: accentColor, borderColor: accentColor, opacity: (saving || !fundToken || !fundAmount) ? 0.5 : 1 })}>
                            {saving ? '...' : <><FaArrowDown size={10} /> Fund</>}
                        </button>
                    </div>
                    {fundToken && (() => {
                        const displayBal = fundSource === 'wallet' ? fundSourceBalance : (() => {
                            const tid = typeof fundToken === 'string' ? fundToken : fundToken?.toText?.() || '';
                            const e = mainPurseBalances.find(b => {
                                const p = typeof b.token === 'string' ? b.token : b.token?.toText?.() || '';
                                return p === tid;
                            });
                            return e ? BigInt(e.balance) : 0n;
                        })();
                        const isLoading = fundSource === 'wallet' && fundBalanceLoading;
                        return (
                            <div style={{ fontSize: '0.72rem', color: theme.colors.secondaryText, marginBottom: '8px', paddingLeft: '2px' }}>
                                {isLoading ? 'Fetching balance...' : displayBal != null ? (
                                    <span>
                                        {fundSource === 'wallet' ? 'Wallet' : 'Main purse'} balance:{' '}
                                        <span style={{ fontFamily: 'monospace', color: theme.colors.primaryText, fontWeight: 500 }}>
                                            {fmtBal(displayBal, tokDecimals(fundToken))}
                                        </span>
                                        {' '}{tokLabel(fundToken)}
                                    </span>
                                ) : null}
                            </div>
                        );
                    })()}

                    {/* Reclaim to main purse */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.78rem', color: theme.colors.secondaryText, fontWeight: 500 }}>Reclaim:</span>
                        <div style={{ minWidth: '140px' }}>
                            <TokenSelector
                                value={reclaimToken}
                                onChange={v => { setReclaimToken(v); setReclaimAmount(''); }}
                                tokenSubset={purseTokenIds.map(id => ({ ledger_id: id, symbol: tokLabel(id), name: tokLabel(id) }))}
                                placeholder="Token..."
                            />
                        </div>
                        <input type="number" placeholder="Amount" value={reclaimAmount} onChange={e => setReclaimAmount(e.target.value)} style={inp({ width: '110px' })} step="any" min="0" />
                        <button onClick={handleMaxReclaim} disabled={!reclaimToken} style={maxBtnSt} title="Max purse balance">Max</button>
                        <button onClick={handleReclaim} disabled={saving || !reclaimToken || !reclaimAmount} style={btnSm({ color: '#e67e22', borderColor: '#e67e22', opacity: (saving || !reclaimToken || !reclaimAmount) ? 0.5 : 1 })}>
                            {saving ? '...' : <><FaArrowUp size={10} /> Reclaim</>}
                        </button>
                    </div>

                    {/* Withdraw to wallet */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.78rem', color: theme.colors.secondaryText, fontWeight: 500 }}>Withdraw:</span>
                        <div style={{ minWidth: '140px' }}>
                            <TokenSelector
                                value={withdrawToken}
                                onChange={v => { setWithdrawToken(v); setWithdrawAmount(''); }}
                                tokenSubset={purseTokenIds.map(id => ({ ledger_id: id, symbol: tokLabel(id), name: tokLabel(id) }))}
                                placeholder="Token..."
                            />
                        </div>
                        <input type="number" placeholder="Amount" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} style={inp({ width: '110px' })} step="any" min="0" />
                        <button onClick={handleMaxWithdraw} disabled={!withdrawToken} style={maxBtnSt} title="Max (minus fee)">Max</button>
                        <button onClick={handleWithdrawToWallet} disabled={saving || !withdrawToken || !withdrawAmount} style={btnSm({ color: '#8e44ad', borderColor: '#8e44ad', opacity: (saving || !withdrawToken || !withdrawAmount) ? 0.5 : 1 })}>
                            {saving ? '...' : <><FaArrowUp size={10} /> To Wallet</>}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

// ============================================
// Swap Progress Card — beautiful live visualization of swaps
// ============================================
const DEX_NAMES = { 0: 'ICPSwap', 1: 'KongSwap' };
const DEX_COLORS = { 0: '#3b82f6', 1: '#f59e0b' };

const SwapProgressCard = React.memo(function SwapProgressCard({ entry, isRunning: isRunningProp, theme, accentColor, onDismiss, taskType, pending }) {
    if (!entry && !isRunningProp && !pending) return null;

    const isRebalancer = taskType === 'rebalance';
    // Once we have a terminal result, stop showing the "running" state even if conductor hasn't moved on
    const isRunning = isRunningProp && !(entry?.status === 'Skipped' || entry?.status === 'Success' || entry?.status === 'Failed');

    // When running/pending with no token info yet, show a compact status
    if ((isRunning || pending) && !entry) {
        return (
            <div style={{
                marginTop: '8px', marginBottom: '6px', padding: '10px 14px',
                background: `${accentColor}08`, border: `1px solid ${accentColor}30`,
                borderRadius: '10px', position: 'relative',
            }}>
                {onDismiss && (
                    <button onClick={onDismiss} style={{
                        position: 'absolute', top: '6px', right: '8px', background: 'none',
                        border: 'none', cursor: 'pointer', color: theme.colors.mutedText,
                        fontSize: '0.85rem', padding: '2px 4px', lineHeight: 1,
                    }} title="Dismiss">×</button>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="swap-pulse" style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 20, height: 20, borderRadius: '50%',
                        background: `${accentColor}20`, color: accentColor,
                        fontSize: '0.75rem', fontWeight: '700',
                    }}>⟳</span>
                    <span style={{ fontSize: '0.78rem', fontWeight: '600', color: accentColor }}>
                        {pending && !isRunning ? 'Loading result…' : isRebalancer ? 'Evaluating portfolio…' : 'Preparing swap…'}
                    </span>
                </div>
            </div>
        );
    }

    const cardBorder = isRunning ? `${accentColor}50` : entry?.status === 'Success' ? '#22c55e40' : entry?.status === 'Failed' ? '#ef444440' : `${theme.colors.border}`;
    const cardGlow = isRunning ? `${accentColor}12` : entry?.status === 'Success' ? '#22c55e08' : entry?.status === 'Failed' ? '#ef444408' : theme.colors.cardBg;

    const inSym = entry?.inputSymbol || '???';
    const outSym = entry?.outputSymbol || '???';
    const inAmt = entry?.inputAmount != null ? entry.inputAmount : null;
    const outAmt = entry?.outputAmount != null ? entry.outputAmount : null;
    const inDec = entry?.inputDecimals ?? 8;
    const outDec = entry?.outputDecimals ?? 8;
    const isSkipped = !isRunning && entry?.status === 'Skipped';
    const fmtAmt = (raw, dec) => {
        if (raw == null) return '...';
        const val = Number(raw) / Math.pow(10, dec);
        if (val === 0) return '0';
        const maxFrac = Math.min(dec, 6);
        const formatted = val.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
        if (parseFloat(formatted.replace(/,/g, '')) === 0) {
            return val.toLocaleString(undefined, { maximumSignificantDigits: 2 });
        }
        return formatted;
    };
    const dexName = entry?.dexId != null ? (DEX_NAMES[Number(entry.dexId)] || `DEX #${entry.dexId}`) : null;
    const dexColor = entry?.dexId != null ? (DEX_COLORS[Number(entry.dexId)] || accentColor) : accentColor;
    const priceImpact = entry?.priceImpactBps != null ? (Number(entry.priceImpactBps) / 100).toFixed(2) : null;
    const slippage = entry?.slippageBps != null ? (Number(entry.slippageBps) / 100).toFixed(2) : null;
    const priceE8s = entry?.priceE8s;
    const priceStr = priceE8s != null ? (Number(priceE8s) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 }) : null;

    const statusColor = isRunning ? accentColor : entry?.status === 'Success' ? '#22c55e' : entry?.status === 'Failed' ? '#ef4444' : '#f59e0b';
    const statusLabel = isRunning ? (isRebalancer ? 'Rebalancing...' : 'Swapping...') : entry?.status || 'Unknown';
    const statusIcon = isRunning ? '⟳' : entry?.status === 'Success' ? '✓' : entry?.status === 'Failed' ? '✗' : '⊘';

    const isInfoSkip = isSkipped && !entry?.outputToken && (inAmt == null || Number(inAmt) === 0);

    if (isInfoSkip) {
        return (
            <div style={{
                marginTop: '8px', marginBottom: '6px', padding: '10px 14px',
                background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`,
                borderRadius: '10px', position: 'relative',
            }}>
                {onDismiss && (
                    <button onClick={onDismiss} style={{
                        position: 'absolute', top: '6px', right: '8px', background: 'none',
                        border: 'none', cursor: 'pointer', color: theme.colors.mutedText,
                        fontSize: '0.85rem', padding: '2px 4px', lineHeight: 1,
                    }} title="Dismiss">×</button>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 20, height: 20, borderRadius: '50%',
                        background: `${statusColor}20`, color: statusColor,
                        fontSize: '0.75rem', fontWeight: '700',
                    }}>⊘</span>
                    <span style={{ fontSize: '0.78rem', fontWeight: '600', color: statusColor }}>Skipped</span>
                </div>
                {entry?.errorMessage && (
                    <div style={{
                        marginTop: '6px', padding: '6px 10px', fontSize: '0.75rem',
                        background: `${statusColor}08`, borderRadius: '6px', border: `1px solid ${statusColor}20`,
                        color: theme.colors.secondaryText, lineHeight: 1.4,
                    }}>{entry.errorMessage}</div>
                )}
            </div>
        );
    }

    return (
        <div style={{
            marginTop: '8px', marginBottom: '6px', padding: '12px',
            background: cardGlow, border: `1px solid ${cardBorder}`,
            borderRadius: '10px', position: 'relative', overflow: 'hidden',
        }}>
            {onDismiss && (
                <button onClick={onDismiss} style={{
                    position: 'absolute', top: '6px', right: '8px', background: 'none',
                    border: 'none', cursor: 'pointer', color: theme.colors.mutedText,
                    fontSize: '0.85rem', padding: '2px 4px', lineHeight: 1,
                }} title="Dismiss">×</button>
            )}

            {/* Status badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                <span className={isRunning ? 'swap-pulse' : ''} style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 20, height: 20, borderRadius: '50%',
                    background: `${statusColor}20`, color: statusColor,
                    fontSize: '0.75rem', fontWeight: '700',
                }}>{statusIcon}</span>
                <span style={{ fontSize: '0.78rem', fontWeight: '600', color: statusColor }}>{statusLabel}</span>
                {dexName && (
                    <span style={{
                        marginLeft: 'auto', fontSize: '0.68rem', padding: '2px 8px',
                        borderRadius: '4px', background: `${dexColor}15`, color: dexColor,
                        fontWeight: '600', border: `1px solid ${dexColor}30`,
                    }}>{dexName}</span>
                )}
            </div>

            {/* Token flow */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', marginBottom: '10px' }}>
                {/* Input */}
                <div style={{ textAlign: 'center', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', marginBottom: '3px' }}>
                        <TokenIcon canisterId={entry?.inputToken} size={22} />
                        <span style={{ fontSize: '0.85rem', fontWeight: '600', color: theme.colors.primaryText }}>{inSym}</span>
                    </div>
                    <div style={{ fontSize: '0.82rem', fontWeight: '600', color: isSkipped ? theme.colors.secondaryText : theme.colors.primaryText, fontFamily: 'monospace' }}>
                        {inAmt != null ? `${isSkipped ? '' : entry?.isEstimate ? '~' : '−'}${fmtAmt(inAmt, inDec)}` : '...'}
                    </div>
                </div>

                {/* Arrow */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 4px', flexShrink: 0 }}>
                    <div style={{
                        width: '40px', height: '2px', borderRadius: '1px', position: 'relative',
                        background: isSkipped
                            ? `linear-gradient(to right, ${theme.colors.mutedText}40, #f59e0b, ${theme.colors.mutedText}40)`
                            : `linear-gradient(to right, ${theme.colors.secondaryText}, ${statusColor}, #22c55e)`,
                    }}>
                        {isRunning && (
                            <div className="swap-flow-dot" style={{
                                position: 'absolute', top: '-2px', left: '50%',
                                width: '6px', height: '6px', borderRadius: '50%',
                                background: accentColor,
                            }} />
                        )}
                    </div>
                    <span style={{ fontSize: '0.65rem', color: theme.colors.mutedText, marginTop: '2px' }}>→</span>
                </div>

                {/* Output */}
                <div style={{ textAlign: 'center', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', marginBottom: '3px' }}>
                        <TokenIcon canisterId={entry?.outputToken} size={22} />
                        <span style={{ fontSize: '0.85rem', fontWeight: '600', color: theme.colors.primaryText }}>{outSym}</span>
                    </div>
                    <div style={{ fontSize: '0.82rem', fontWeight: '600', color: isSkipped ? theme.colors.secondaryText : outAmt != null ? '#22c55e' : theme.colors.mutedText, fontFamily: 'monospace' }}>
                        {outAmt != null ? `${isSkipped ? '' : '+'}${fmtAmt(outAmt, outDec)}` : isRunning ? '...' : '—'}
                    </div>
                </div>
            </div>

            {/* Details row */}
            {(priceStr || priceImpact || slippage) && (
                <div style={{
                    display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center',
                    fontSize: '0.7rem', color: theme.colors.secondaryText,
                    paddingTop: '8px', borderTop: `1px solid ${theme.colors.border}30`,
                }}>
                    {priceStr && (
                        <span>Price: <strong style={{ color: theme.colors.primaryText }}>{priceStr}</strong> <span style={{ opacity: 0.7 }}>{outSym}/{inSym}</span></span>
                    )}
                    {priceImpact && (
                        <span>Impact: <strong style={{ color: Number(priceImpact) > 1 ? '#f59e0b' : theme.colors.primaryText }}>{priceImpact}%</strong></span>
                    )}
                    {slippage && (
                        <span>Slippage: <strong style={{ color: Number(slippage) > 2 ? '#f59e0b' : theme.colors.primaryText }}>{slippage}%</strong></span>
                    )}
                </div>
            )}

            {/* Error message */}
            {entry?.errorMessage && (
                <div style={{
                    marginTop: '8px', padding: '6px 10px', fontSize: '0.72rem',
                    background: '#ef444410', borderRadius: '6px', border: '1px solid #ef444425',
                    color: '#ef4444', wordBreak: 'break-word',
                }}>{entry.errorMessage}</div>
            )}
        </div>
    );
}, (prev, next) => {
    if (prev.isRunning !== next.isRunning) return false;
    if (prev.pending !== next.pending) return false;
    if (prev.accentColor !== next.accentColor) return false;
    if (prev.theme !== next.theme) return false;
    if (prev.taskType !== next.taskType) return false;
    if (prev.entry === next.entry) return true;
    if (!prev.entry && !next.entry) return true;
    if (!prev.entry || !next.entry) return false;
    return prev.entry.status === next.entry.status
        && prev.entry.inputAmount === next.entry.inputAmount
        && prev.entry.outputAmount === next.entry.outputAmount
        && prev.entry.inputSymbol === next.entry.inputSymbol
        && prev.entry.outputSymbol === next.entry.outputSymbol
        && prev.entry.errorMessage === next.entry.errorMessage
        && prev.entry.isEstimate === next.entry.isEstimate;
});

// ============================================
// Swap card renderer hook — detects swap tasks from run data and fetches trade log results
// ============================================
const ACTIVE_SWAP_PATTERN = /^trade-action-|^rebalance-exec-/;

function parseTradeLogEntry(e) {
    const inTid = typeof e.inputToken === 'string' ? e.inputToken : e.inputToken?.toText?.() || String(e.inputToken);
    const outTid = e.outputToken?.[0] ? (typeof e.outputToken[0] === 'string' ? e.outputToken[0] : e.outputToken[0]?.toText?.() || String(e.outputToken[0])) : null;
    const inMeta = getTokenMetadataSync(inTid);
    const outMeta = outTid ? getTokenMetadataSync(outTid) : null;
    const status = Object.keys(e.status)[0] || 'Unknown';
    return {
        inputToken: inTid, outputToken: outTid,
        inputSymbol: inMeta?.symbol || '???', outputSymbol: outMeta?.symbol || '???',
        inputDecimals: inMeta?.decimals ?? 8, outputDecimals: outMeta?.decimals ?? 8,
        inputAmount: e.inputAmount, outputAmount: e.outputAmount?.[0] ?? null,
        priceE8s: e.priceE8s?.[0] ?? null, priceImpactBps: e.priceImpactBps?.[0] ?? null,
        slippageBps: e.slippageBps?.[0] ?? null, dexId: e.dexId?.[0] ?? null,
        status, errorMessage: e.errorMessage?.[0] || null, timestamp: e.timestamp,
    };
}

function useSwapCardRenderer(getReadyBotActor, theme, accentColor) {
    const [swapResults, setSwapResults] = React.useState({});
    const [dismissed, setDismissed] = React.useState(new Set());
    const [actionCache, setActionCache] = React.useState({});
    const fetchingRef = useRef(new Set());
    const botActorRef = useRef(getReadyBotActor);
    botActorRef.current = getReadyBotActor;

    const pollTimerRef = useRef({});

    const triggerFetch = useCallback((fetchKey, choreId, poll) => {
        if (fetchingRef.current.has(fetchKey)) return;
        fetchingRef.current.add(fetchKey);
        (async () => {
            try {
                const bot = await botActorRef.current();
                if (!bot) return;
                const result = await bot.getTradeLog({
                    startId: [], limit: [3], offset: [0],
                    choreId: [choreId], choreTypeId: [],
                    actionType: [], inputToken: [], outputToken: [],
                    status: [], fromTime: [], toTime: [],
                });
                const entries = result?.entries || [];
                if (entries.length > 0) {
                    const parsed = parseTradeLogEntry(entries[0]);
                    setSwapResults(prev => {
                        const existing = prev[fetchKey];
                        if (existing && existing.status === parsed.status && existing.inputAmount === parsed.inputAmount && existing.outputAmount === parsed.outputAmount) return prev;
                        return { ...prev, [fetchKey]: parsed };
                    });
                    if (pollTimerRef.current[fetchKey]) { clearTimeout(pollTimerRef.current[fetchKey]); delete pollTimerRef.current[fetchKey]; }
                } else if (poll) {
                    fetchingRef.current.delete(fetchKey);
                    pollTimerRef.current[fetchKey] = setTimeout(() => triggerFetch(fetchKey, choreId, true), 3000);
                }
            } catch {
                if (poll) {
                    fetchingRef.current.delete(fetchKey);
                    pollTimerRef.current[fetchKey] = setTimeout(() => triggerFetch(fetchKey, choreId, true), 3000);
                }
            }
        })();
    }, []);

    const triggerActionFetch = useCallback((choreId) => {
        const cacheKey = `actions:${choreId}`;
        if (fetchingRef.current.has(cacheKey)) return;
        fetchingRef.current.add(cacheKey);
        (async () => {
            try {
                const bot = await botActorRef.current();
                if (!bot) return;
                const actions = await bot.getTradeActions(choreId);
                if (actions?.length > 0) {
                    const map = {};
                    for (const a of actions) {
                        const inTid = typeof a.inputToken === 'string' ? a.inputToken : a.inputToken?.toText?.() || String(a.inputToken);
                        const outTid = a.outputToken?.[0] ? (typeof a.outputToken[0] === 'string' ? a.outputToken[0] : a.outputToken[0]?.toText?.() || String(a.outputToken[0])) : null;
                        map[Number(a.id)] = {
                            inputToken: inTid, outputToken: outTid,
                            minAmount: a.minAmount != null ? Number(a.minAmount) : null,
                            maxAmount: a.maxAmount != null ? Number(a.maxAmount) : null,
                        };
                    }
                    setActionCache(prev => {
                        try { if (JSON.stringify(prev[choreId]) === JSON.stringify(map)) return prev; } catch {}
                        return { ...prev, [choreId]: map };
                    });
                }
            } catch { /* silently ignore */ }
        })();
    }, []);

    const renderSwapCard = useCallback((choreId, run, _chore) => {
        if (!run) return <div className="swap-card-slot" style={{ maxHeight: 0, opacity: 0 }} />;

        const runStamp = run._condStartNs || run.conductorStartedAtMs || '';

        const currentTaskId = run.currentTask?.taskId;
        const isSwapRunning = currentTaskId && ACTIVE_SWAP_PATTERN.test(currentTaskId);

        const recentSwapTask = [...(run.completedTasks || [])].reverse()
            .find(t => ACTIVE_SWAP_PATTERN.test(t.taskId));

        const activeKey = isSwapRunning ? `${choreId}:${runStamp}:${currentTaskId}`
            : recentSwapTask ? `${choreId}:${runStamp}:${recentSwapTask.taskId}` : null;

        const isDismissed = activeKey && dismissed.has(activeKey);
        const showCard = activeKey && !isDismissed;

        if (showCard && recentSwapTask) {
            const fetchKey = `${choreId}:${runStamp}:${recentSwapTask.taskId}`;
            if (!swapResults[fetchKey] && !fetchingRef.current.has(fetchKey)) {
                setTimeout(() => triggerFetch(fetchKey, choreId), 0);
            }
        }

        let entry = showCard ? (swapResults[activeKey] || null) : null;

        // Discard stale entries from a previous run and unlock fetch so we can retry
        if (entry && !isSwapRunning && entry.timestamp && runStamp) {
            const entryNs = BigInt(entry.timestamp);
            const runNs = BigInt(runStamp);
            if (entryNs < runNs) {
                entry = null;
                if (activeKey && fetchingRef.current.has(activeKey)) {
                    fetchingRef.current.delete(activeKey);
                    setTimeout(() => triggerFetch(activeKey, choreId, false), 800);
                }
            }
        }

        if (showCard && isSwapRunning) {
            if (!actionCache[choreId]) {
                setTimeout(() => triggerActionFetch(choreId), 0);
            } else {
                const actionIdMatch = currentTaskId.match(/-(\d+)$/);
                const actionId = actionIdMatch ? Number(actionIdMatch[1]) : null;
                const actionInfo = actionId != null ? actionCache[choreId][actionId] : null;
                const info = actionInfo || Object.values(actionCache[choreId])[0];
                if (info) {
                    const inMeta = getTokenMetadataSync(info.inputToken);
                    const outMeta = info.outputToken ? getTokenMetadataSync(info.outputToken) : null;
                    const actionAmt = info.minAmount != null && info.minAmount > 0
                        ? (info.maxAmount != null && info.maxAmount > info.minAmount
                            ? Math.round((info.minAmount + info.maxAmount) / 2)
                            : info.minAmount)
                        : null;
                    if (!entry) {
                        entry = {
                            inputToken: info.inputToken,
                            outputToken: info.outputToken,
                            inputSymbol: inMeta?.symbol || shortPrincipal(info.inputToken),
                            outputSymbol: outMeta?.symbol || (info.outputToken ? shortPrincipal(info.outputToken) : '???'),
                            inputDecimals: inMeta?.decimals ?? 8,
                            outputDecimals: outMeta?.decimals ?? 8,
                            inputAmount: actionAmt, outputAmount: null,
                            isEstimate: actionAmt != null,
                        };
                    } else if (entry.inputAmount == null && actionAmt != null) {
                        entry = { ...entry, inputAmount: actionAmt, isEstimate: true };
                    }
                }
            }
            const runningFetchKey = `${choreId}:${runStamp}:${currentTaskId}`;
            if (!swapResults[runningFetchKey]) {
                setTimeout(() => triggerFetch(runningFetchKey, choreId, true), 0);
            }
        }

        const resolvedTaskId = isSwapRunning ? currentTaskId : recentSwapTask?.taskId;
        const taskType = resolvedTaskId?.startsWith('rebalance-') ? 'rebalance' : 'trade';
        const isPending = !isSwapRunning && recentSwapTask && !entry;
        const hasContent = showCard && (entry || isPending || isSwapRunning);

        return (
            <div className="swap-card-slot" style={{ maxHeight: hasContent ? 250 : 0, opacity: hasContent ? 1 : 0 }}>
                {hasContent && (
                    <SwapProgressCard
                        entry={entry}
                        isRunning={isSwapRunning}
                        pending={isPending}
                        theme={theme}
                        accentColor={accentColor}
                        taskType={taskType}
                        onDismiss={() => setDismissed(prev => new Set(prev).add(activeKey))}
                    />
                )}
            </div>
        );
    }, [swapResults, dismissed, actionCache, theme, accentColor, triggerFetch, triggerActionFetch]);

    return renderSwapCard;
}

// ============================================
// Trade Fallback Route Tokens Panel
// ============================================
function TradeFallbackPanel({ instanceId, getReadyBotActor, theme, accentColor, secondaryButtonStyle }) {
    const { identity } = useAuth();
    const [tokens, setTokens] = useState(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            const bot = await getReadyBotActor();
            const result = await bot.getTradeFallbackRouteTokens(instanceId);
            setTokens(result);
        } catch { setTokens([]); }
    }, [instanceId, getReadyBotActor]);

    useEffect(() => { load(); }, [load]);

    const save = async (newTokens) => {
        setSaving(true);
        try {
            const bot = await getReadyBotActor();
            await bot.setTradeFallbackRouteTokens(instanceId, newTokens);
            setTokens(newTokens);
        } catch { /* ignore */ }
        setSaving(false);
    };

    const getSymbol = (p) => {
        const k = typeof p === 'string' ? p : p?.toText?.() || String(p);
        const m = getTokenMetadataSync(k);
        return m?.symbol || shortPrincipal(k);
    };

    if (tokens === null) return null;

    return (
        <div style={{ marginBottom: '12px', padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
            <div style={{ fontSize: '0.78rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '4px' }}>Fallback Route Tokens</div>
            <div style={{ fontSize: '0.65rem', color: theme.colors.mutedText, marginBottom: '6px', lineHeight: '1.4' }}>
                When a direct swap has no liquidity or high price impact, trade actions route through these intermediary tokens in order.
            </div>
            {tokens.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' }}>
                    {tokens.map((ft, i) => {
                        const ftKey = typeof ft === 'string' ? ft : ft?.toText?.() || String(ft);
                        return (
                            <div key={ftKey} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', background: `${accentColor}08`, borderRadius: '6px', border: `1px solid ${theme.colors.border}` }}>
                                <span style={{ fontSize: '0.7rem', color: theme.colors.mutedText, fontWeight: '500', width: '16px', textAlign: 'center' }}>{i + 1}.</span>
                                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '5px' }}>
                                    <TokenIcon canisterId={ftKey} size={16} />
                                    <span style={{ fontSize: '0.78rem', color: theme.colors.primaryText, fontWeight: '500' }}>{getSymbol(ft)}</span>
                                </div>
                                {i > 0 && (
                                    <button onClick={() => {
                                        const arr = [...tokens];
                                        [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
                                        save(arr);
                                    }} disabled={saving} style={{ ...secondaryButtonStyle, fontSize: '0.55rem', padding: '1px 4px' }} title="Move up">▲</button>
                                )}
                                {i < tokens.length - 1 && (
                                    <button onClick={() => {
                                        const arr = [...tokens];
                                        [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
                                        save(arr);
                                    }} disabled={saving} style={{ ...secondaryButtonStyle, fontSize: '0.55rem', padding: '1px 4px' }} title="Move down">▼</button>
                                )}
                                <button onClick={() => {
                                    save(tokens.filter((_, j) => j !== i));
                                }} disabled={saving} style={{ ...secondaryButtonStyle, fontSize: '0.55rem', padding: '1px 4px', color: '#ef4444', borderColor: '#ef444440' }} title="Remove">
                                    <FaTrash style={{ fontSize: '0.5rem' }} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, marginBottom: '6px', fontStyle: 'italic' }}>
                    Default: ICP only
                </div>
            )}
            <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                    <TokenSelector
                        value=""
                        onChange={(v) => {
                            if (!v) return;
                            const existing = tokens.map(ft => typeof ft === 'string' ? ft : ft?.toText?.() || String(ft));
                            if (existing.includes(v)) return;
                            save([...tokens, Principal.fromText(v)]);
                        }}
                        onSelectToken={(meta) => { if (meta?.canisterId) setTokenMetadataManual(typeof meta.canisterId === 'string' ? meta.canisterId : meta.canisterId.toText(), meta); }}
                        allowCustom={true}
                        placeholder="Add fallback token..."
                        style={{ fontSize: '0.7rem' }}
                    />
                </div>
            </div>
        </div>
    );
}

// ============================================
// Per-chore log panel (Activity + Trade tabs)
// ============================================
const LOG_LEVEL_PALETTE = { Error: '#ef4444', Warning: '#f59e0b', Info: '#6366f1', Debug: '#8b5cf6', Trace: '#94a3b8' };

function ChoreLogPanel({ instanceId, getReadyBotActor, theme, accentColor }) {
    const { identity } = useAuth();
    const [tab, setTab] = useState('trade');
    const [activityEntries, setActivityEntries] = useState([]);
    const [tradeEntries, setTradeEntries] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [hasMore, setHasMore] = useState({ activity: false, trade: false });
    const [pageSize] = useState(25);
    const loadedRef = useRef({ activity: false, trade: false });

    const optVal = (arr) => arr?.length > 0 ? arr[0] : null;

    const allTokenIds = React.useMemo(() => {
        const ids = new Set();
        for (const e of tradeEntries) {
            ids.add(typeof e.inputToken === 'string' ? e.inputToken : e.inputToken?.toText?.() || String(e.inputToken));
            if (e.outputToken?.length > 0) ids.add(typeof e.outputToken[0] === 'string' ? e.outputToken[0] : e.outputToken[0]?.toText?.() || String(e.outputToken[0]));
        }
        return [...ids];
    }, [tradeEntries]);
    const tokenMeta = useTokenMetadata(allTokenIds, identity);
    const toStr = (p) => typeof p === 'string' ? p : p?.toText?.() || String(p);
    const getSym = (p) => { const k = toStr(p); return tokenMeta[k]?.symbol || shortPrincipal(k); };
    const getDec = (p) => { const k = toStr(p); return tokenMeta[k]?.decimals ?? 8; };

    const activityLimitRef = useRef(pageSize);

    const loadActivity = useCallback(async (more) => {
        setLoading(true);
        setError('');
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            if (more) activityLimitRef.current += pageSize;
            else activityLimitRef.current = pageSize;
            const filter = {
                minLevel: [], source: ['chore:' + instanceId], caller: [],
                fromTime: [], toTime: [], startId: [],
                limit: [BigInt(activityLimitRef.current)],
            };
            const result = await bot.getLogs(filter);
            setActivityEntries(result.entries || []);
            setHasMore(h => ({ ...h, activity: result.hasMore }));
            loadedRef.current.activity = true;
        } catch (e) { setError(e.message || 'Failed to load activity log'); }
        finally { setLoading(false); }
    }, [getReadyBotActor, instanceId, pageSize]);

    const loadTrades = useCallback(async (offset) => {
        setLoading(true);
        setError('');
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const q = {
                startId: [], limit: [pageSize], offset: [offset || 0],
                choreId: [instanceId], choreTypeId: [], actionType: [],
                inputToken: [], outputToken: [], status: [],
                fromTime: [], toTime: [],
            };
            const result = await bot.getTradeLog(q);
            const entries = result.entries || [];
            setTradeEntries(prev => offset > 0 ? [...prev, ...entries] : entries);
            setHasMore(h => ({ ...h, trade: entries.length >= pageSize }));
            loadedRef.current.trade = true;
        } catch (e) { setError(e.message || 'Failed to load trade log'); }
        finally { setLoading(false); }
    }, [getReadyBotActor, instanceId, pageSize]);

    useEffect(() => {
        if (tab === 'activity' && !loadedRef.current.activity) loadActivity();
        if (tab === 'trade' && !loadedRef.current.trade) loadTrades(0);
    }, [tab]);

    const handleRefresh = () => {
        loadedRef.current[tab] = false;
        if (tab === 'activity') { setActivityEntries([]); loadActivity(); }
        else { setTradeEntries([]); loadTrades(0); }
    };

    const borderColor = theme.colors.border;

    return (
        <div style={{ padding: '4px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '10px', borderBottom: `1px solid ${borderColor}`, paddingBottom: '8px' }}>
                {['trade', 'activity'].map(t => (
                    <button key={t} onClick={() => setTab(t)} style={{
                        padding: '4px 14px', borderRadius: '6px 6px 0 0', border: 'none', cursor: 'pointer',
                        fontWeight: tab === t ? '600' : '400', fontSize: '0.78rem',
                        color: tab === t ? accentColor : theme.colors.secondaryText,
                        background: tab === t ? `${accentColor}12` : 'transparent',
                        borderBottom: tab === t ? `2px solid ${accentColor}` : '2px solid transparent',
                    }}>{t === 'activity' ? 'Activity Log' : 'Trade Log'}</button>
                ))}
                <button onClick={handleRefresh} disabled={loading} style={{
                    marginLeft: 'auto', background: 'none', border: 'none', cursor: loading ? 'default' : 'pointer',
                    color: accentColor, padding: '2px', display: 'flex', alignItems: 'center', opacity: loading ? 0.5 : 1,
                }} title="Refresh"><FaSyncAlt style={{ fontSize: '0.7rem', animation: loading ? 'spin 1s linear infinite' : 'none' }} /></button>
                <CopyToClipboardButton
                    accentColor={accentColor} theme={theme} label="Copy"
                    getText={() => {
                        const currentEntries = tab === 'activity' ? activityEntries : tradeEntries;
                        if (!currentEntries.length) return `# Chore ${instanceId} ${tab} log (empty)\n`;
                        const fmtTs = (ns) => { try { return new Date(Number(BigInt(ns)/1_000_000n)).toISOString(); } catch(_) { return '?'; } };
                        if (tab === 'activity') {
                            const LOG_NAMES = { Off:'OFF', Error:'ERROR', Warning:'WARN', Info:'INFO', Debug:'DEBUG', Trace:'TRACE' };
                            const lvl = (l) => { for (const k in LOG_NAMES) if (l[k]!==undefined) return LOG_NAMES[k]; return '?'; };
                            const lines = [`# Chore "${instanceId}" Activity Log (${currentEntries.length} entries)`];
                            for (const e of currentEntries) {
                                const tags = e.tags?.length ? ' | ' + e.tags.map(([k,v])=>`${k}=${v}`).join(', ') : '';
                                lines.push(`[${fmtTs(e.timestamp)}] [${lvl(e.level)}] ${e.message}${tags}`);
                            }
                            return lines.join('\n') + '\n';
                        } else {
                            const ACTION_NAMES = { 0:'trade', 1:'fund_purse', 2:'reclaim', 3:'send' };
                            const fmtAmt = (raw, dec) => { const d = Number(dec||8); const r = BigInt(raw); const w = r/BigInt(10**d); const f = r%BigInt(10**d); return f===0n ? `${w}` : `${w}.${f.toString().padStart(d,'0').replace(/0+$/,'')}`; };
                            const lines = [`# Chore "${instanceId}" Trade Log (${currentEntries.length} entries)`];
                            for (const e of currentEntries) {
                                const st = Object.keys(e.status||{})[0]||'?';
                                const iSym = getSym(e.inputToken); const oTok = e.outputToken?.length>0?e.outputToken[0]:null; const oSym = oTok?getSym(oTok):'';
                                const inAmt = `${fmtAmt(e.inputAmount, getDec(e.inputToken))} ${iSym}`;
                                let detail = inAmt;
                                if (st==='Success' && e.outputAmount?.length>0 && oSym) detail += ` -> ${fmtAmt(e.outputAmount[0], getDec(oTok))} ${oSym}`;
                                else if (st==='Failed') detail += ` | ${e.errorMessage?.length>0?e.errorMessage[0]:'?'}`;
                                lines.push(`#${e.id} | ${fmtTs(e.timestamp)} | ${ACTION_NAMES[Number(e.actionType)]||e.actionType} | ${st}: ${detail}`);
                            }
                            return lines.join('\n') + '\n';
                        }
                    }}
                />
            </div>

            {error && <div style={{ padding: '6px 10px', background: '#ef444415', borderRadius: '6px', color: '#ef4444', fontSize: '0.75rem', marginBottom: '8px' }}>{error}</div>}

            {loading && (activityEntries.length === 0 && tradeEntries.length === 0) ? (
                <div style={{ textAlign: 'center', padding: '16px', color: theme.colors.secondaryText, fontSize: '0.8rem' }}>Loading...</div>
            ) : tab === 'activity' ? (
                activityEntries.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '16px', color: theme.colors.mutedText, fontSize: '0.8rem' }}>No activity log entries for this chore.</div>
                ) : (
                    <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '400px', overflowY: 'auto' }}>
                            {activityEntries.slice().reverse().map(entry => {
                                const levelKey = Object.keys(entry.level)[0];
                                const levelColor = LOG_LEVEL_PALETTE[levelKey] || '#6b7280';
                                const ts = new Date(Number(entry.timestamp) / 1_000_000);
                                const timeStr = ts.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                                const dateStr = ts.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                                return (
                                    <div key={Number(entry.id)} style={{
                                        display: 'flex', gap: '8px', padding: '4px 6px', borderRadius: '4px',
                                        fontSize: '0.72rem', alignItems: 'flex-start',
                                        background: levelKey === 'Error' ? '#ef444408' : levelKey === 'Warning' ? '#f59e0b08' : 'transparent',
                                    }}>
                                        <span style={{ color: levelColor, fontWeight: '700', fontSize: '0.65rem', minWidth: '14px', textAlign: 'center', marginTop: '1px' }}>
                                            {levelKey === 'Error' ? '✗' : levelKey === 'Warning' ? '!' : levelKey === 'Info' ? 'ℹ' : '·'}
                                        </span>
                                        <span style={{ color: theme.colors.mutedText, whiteSpace: 'nowrap', fontSize: '0.68rem' }}>{dateStr} {timeStr}</span>
                                        <span style={{ color: theme.colors.primaryText, flex: 1, wordBreak: 'break-word', lineHeight: '1.4' }}>{entry.message}</span>
                                    </div>
                                );
                            })}
                        </div>
                        {hasMore.activity && (
                            <button onClick={() => loadActivity(true)} disabled={loading} style={{
                                display: 'block', margin: '8px auto 0', padding: '4px 16px', borderRadius: '6px',
                                border: `1px solid ${borderColor}`, background: 'transparent', color: theme.colors.secondaryText,
                                fontSize: '0.75rem', cursor: 'pointer',
                            }}>Load older</button>
                        )}
                    </>
                )
            ) : (
                tradeEntries.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '16px', color: theme.colors.mutedText, fontSize: '0.8rem' }}>No trade log entries for this chore.</div>
                ) : (
                    <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '400px', overflowY: 'auto' }}>
                            {tradeEntries.map(e => {
                                const statusKey = Object.keys(e.status || {})[0] || 'Failed';
                                const statusColor = TRADE_STATUS_COLORS[statusKey] || '#6b7280';
                                const inputDec = getDec(e.inputToken);
                                const outputDec = e.outputToken?.length > 0 ? getDec(e.outputToken[0]) : 8;
                                const inSym = getSym(e.inputToken);
                                const outSym = e.outputToken?.length > 0 ? getSym(e.outputToken[0]) : '';
                                const ts = new Date(Number(e.timestamp) / 1_000_000);
                                const timeStr = ts.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                                const dateStr = ts.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                                const errMsg = optVal(e.errorMessage);
                                return (
                                    <div key={Number(e.id)} style={{
                                        padding: '8px 10px', borderRadius: '6px', fontSize: '0.75rem',
                                        border: `1px solid ${statusColor}25`, background: `${statusColor}06`,
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap', gap: '4px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span style={{ fontWeight: '600', color: theme.colors.primaryText }}>#{Number(e.id)}</span>
                                                <span style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.68rem', fontWeight: '600', background: `${statusColor}20`, color: statusColor }}>{statusKey}</span>
                                                <span style={{ color: theme.colors.mutedText, fontSize: '0.7rem' }}>{ACTION_TYPE_LABELS[Number(e.actionType)] || `Type ${Number(e.actionType)}`}</span>
                                            </div>
                                            <span style={{ color: theme.colors.mutedText, fontSize: '0.68rem' }}>{dateStr} {timeStr}</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                <TokenIcon canisterId={toStr(e.inputToken)} size={15} />
                                                <span style={{ fontFamily: 'monospace' }}>{formatTokenAmount(e.inputAmount, inputDec)}</span> {inSym}
                                            </span>
                                            {outSym && <>
                                                <span style={{ color: theme.colors.mutedText }}>→</span>
                                                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                    <TokenIcon canisterId={toStr(e.outputToken[0])} size={15} />
                                                    <span style={{ fontFamily: 'monospace' }}>{optVal(e.outputAmount) != null ? formatTokenAmount(optVal(e.outputAmount), outputDec) : '—'}</span> {outSym}
                                                </span>
                                            </>}
                                        </div>
                                        {errMsg && <div style={{ marginTop: '4px', color: '#ef4444', fontSize: '0.7rem', wordBreak: 'break-word' }}>{errMsg}</div>}
                                    </div>
                                );
                            })}
                        </div>
                        {hasMore.trade && (
                            <button onClick={() => loadTrades(tradeEntries.length)} disabled={loading} style={{
                                display: 'block', margin: '8px auto 0', padding: '4px 16px', borderRadius: '6px',
                                border: `1px solid ${borderColor}`, background: 'transparent', color: theme.colors.secondaryText,
                                fontSize: '0.75rem', cursor: 'pointer',
                            }}>Load older</button>
                        )}
                    </>
                )
            )}
        </div>
    );
}

// ============================================
// Tabbed container for per-chore config panels
// ============================================
function ChoreConfigTabs({ tabs, theme, accentColor }) {
    const [activeKey, setActiveKey] = useState(tabs[0]?.key || '');
    const activeTab = tabs.find(t => t.key === activeKey) || tabs[0];

    return (
        <div style={{ marginTop: '10px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0', borderBottom: `1px solid ${theme.colors.border}`, marginBottom: '12px' }}>
                {tabs.map(t => {
                    const isActive = t.key === activeTab?.key;
                    return (
                        <button key={t.key} onClick={() => setActiveKey(t.key)} style={{
                            padding: '7px 16px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: isActive ? '600' : '400',
                            color: isActive ? accentColor : theme.colors.secondaryText,
                            background: 'none', border: 'none', borderBottom: `2px solid ${isActive ? accentColor : 'transparent'}`,
                            borderRadius: 0, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '6px',
                        }}>
                            {t.label}
                            {t.badge && (
                                <span style={{
                                    fontSize: '0.65rem', padding: '1px 6px', borderRadius: '8px',
                                    background: isActive ? `${accentColor}15` : `${theme.colors.border}60`,
                                    color: isActive ? accentColor : theme.colors.mutedText, fontWeight: '500',
                                }}>{t.badge}</span>
                            )}
                        </button>
                    );
                })}
            </div>
            {activeTab && activeTab.content}
        </div>
    );
}

// ============================================
// Custom chore configuration renderer (dispatches to real components)
// ============================================
function ControlTabPanel({ chore, controlTabContent: ct, getReadyBotActor, theme, accentColor, cardStyle, inputStyle, buttonStyle, secondaryButtonStyle, savingChore, setSavingChore, choreError, setChoreError, choreSuccess, setChoreSuccess, loadChoreData }) {
    if (!ct) return null;
    const { schedulerLamp, conductorLamp, taskLamp, isStopped, isPaused, isEnabled, isRunning, intervalSeconds, maxIntervalSeconds, hasRange, fmtInt, fmtTime, bestUnit, currentBest, unitMultipliers, choreRunTracker, choreTickNow, startChorePolling, confirmingDelete, setConfirmingDelete, dismissedErrors, setDismissedErrors, renderSwapCard } = ct;
    const accent = accentColor;
    const LAMP_COLORS = { idle: theme.colors.secondaryText, active: '#22c55e', busy: '#f59e0b', error: '#ef4444' };
    return (<>
        {/* Status Grid */}
        <div style={cardStyle}>
            <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>Status</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}`, minHeight: '52px' }}>
                    <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>State</div>
                    <div style={{ fontSize: '0.9rem', fontWeight: '600', color: isStopped ? theme.colors.secondaryText : isPaused ? '#f59e0b' : '#22c55e' }}>
                        {isStopped ? 'Stopped' : isPaused ? 'Paused' : 'Running'}
                    </div>
                </div>
                {[['Scheduler', schedulerLamp], ['Conductor', conductorLamp], ['Task', taskLamp]].map(([name, lamp]) => (
                    <div key={name} style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}`, minHeight: '52px' }}>
                        <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>{name}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ width: 10, height: 10, borderRadius: '50%', display: 'inline-block', background: LAMP_COLORS[lamp.state] || theme.colors.secondaryText }} />
                            <span style={{ fontSize: '0.9rem', color: LAMP_COLORS[lamp.state] || theme.colors.secondaryText, fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }} title={lamp.label}>{lamp.label}</span>
                        </div>
                    </div>
                ))}
                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                    <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Interval</div>
                    <div style={{ fontSize: '0.9rem', color: theme.colors.primaryText, fontWeight: '500' }}>{hasRange ? `${fmtInt(intervalSeconds)}–${fmtInt(maxIntervalSeconds)}` : fmtInt(intervalSeconds)}</div>
                </div>
                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                    <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Next Scheduled Run</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <div style={{ fontSize: '0.85rem', color: theme.colors.primaryText, fontWeight: '500' }}>{fmtTime(chore.nextScheduledRunAt)}</div>
                        {chore.enabled && (
                            <button style={{ background: 'none', border: `1px solid ${theme.colors.border}`, borderRadius: '4px', fontSize: '0.65rem', color: theme.colors.secondaryText, cursor: 'pointer', padding: '2px 6px' }} title="Set next scheduled run time"
                                onClick={() => { const el = document.getElementById(`next-run-picker-${chore.choreId}`); if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none'; }}>Set</button>
                        )}
                    </div>
                    {chore.enabled && (
                        <div id={`next-run-picker-${chore.choreId}`} style={{ display: 'none', marginTop: '6px', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <input type="datetime-local" id={`next-run-input-${chore.choreId}`} style={{ ...inputStyle, fontSize: '0.75rem', width: '200px' }}
                                defaultValue={(() => { const ns = chore.nextScheduledRunAt?.length > 0 ? Number(chore.nextScheduledRunAt[0]) : Date.now() * 1_000_000; const d = new Date(ns / 1_000_000); const pad = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; })()} />
                            <button style={{ ...buttonStyle, fontSize: '0.7rem', padding: '4px 10px', background: `${accent}10`, color: accent, border: `1px solid ${accent}25` }} disabled={savingChore}
                                onClick={async () => { const input = document.getElementById(`next-run-input-${chore.choreId}`); if (!input?.value) return; const tsNanos = BigInt(new Date(input.value).getTime()) * 1_000_000n; setSavingChore(true); setChoreError(''); try { const bot = await getReadyBotActor(); await bot.setChoreNextRun(chore.choreId, tsNanos); setChoreSuccess('Next run time updated.'); const el = document.getElementById(`next-run-picker-${chore.choreId}`); if (el) el.style.display = 'none'; await loadChoreData(); } catch (err) { setChoreError('Failed to set next run: ' + err.message); } finally { setSavingChore(false); } }}>Save</button>
                        </div>
                    )}
                </div>
                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                    <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Last Completed</div>
                    <div style={{ fontSize: '0.85rem', color: theme.colors.primaryText, fontWeight: '500' }}>{fmtTime(chore.lastCompletedRunAt)}</div>
                </div>
                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                    <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Runs (Success / Fail)</div>
                    <div style={{ fontSize: '0.9rem', color: theme.colors.primaryText, fontWeight: '500' }}>{Number(chore.totalSuccessCount)} / {Number(chore.totalFailureCount)}</div>
                </div>
            </div>

            {/* Conductor run card (full detail) — stable placeholder */}
            {(() => {
                const run = choreRunTracker[chore.choreId];
                const hasRun = !!run;
                void choreTickNow;
                const elapsedStr = (startMs, endMs) => { if (!startMs) return '< 0:01'; const end = endMs || Date.now(); const sec = Math.max(0, Math.floor((end - startMs) / 1000)); const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60; return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
                const timeStr = (ms) => ms ? new Date(ms).toLocaleTimeString() : '--:--';
                const dotStyle = (color) => ({ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 });
                const rowBase = { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 8px', borderRadius: '5px', fontSize: '0.78rem' };
                return (
                    <div style={{ overflow: 'hidden', transition: 'max-height 0.35s ease-out, opacity 0.25s ease-out, margin-top 0.35s ease-out', maxHeight: hasRun ? 500 : 0, opacity: hasRun ? 1 : 0, marginTop: hasRun ? 10 : 0 }}>
                        {hasRun && (
                            <div style={{ padding: '10px', background: run.isRunning ? `${accent}06` : theme.colors.primaryBg, border: `1px solid ${run.isRunning ? accent + '30' : theme.colors.border}`, borderRadius: '8px', fontSize: '0.8rem', color: theme.colors.primaryText }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <strong style={{ fontSize: '0.82rem' }}>{run.isRunning ? 'Conductor Running' : 'Last Conductor Run'}</strong>
                                    <span style={{ fontSize: '0.72rem', color: theme.colors.secondaryText }}>{timeStr(run.conductorStartedAtMs)}{run.conductorEndedAtMs ? ` → ${timeStr(run.conductorEndedAtMs)}` : ''}</span>
                                </div>
                                <div style={{ ...rowBase, background: run.isRunning ? `${accent}10` : theme.colors.primaryBg, border: `1px solid ${run.isRunning ? accent + '20' : theme.colors.border}`, marginBottom: '5px' }}>
                                    <span style={dotStyle(run.isRunning ? accent : '#22c55e')} /><span style={{ color: theme.colors.secondaryText, minWidth: 62 }}>Conductor</span><span style={{ flex: 1 }} /><span style={{ fontFamily: 'monospace', fontWeight: '600', fontSize: '0.8rem', color: run.isRunning ? accent : theme.colors.primaryText }}>{elapsedStr(run.conductorStartedAtMs, run.conductorEndedAtMs)}</span>
                                </div>
                                {run.currentTask && (<div style={{ ...rowBase, background: `${accent}10`, border: `1px solid ${accent}20`, marginBottom: '5px' }}><span style={dotStyle(accent)} /><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.76rem' }} title={run.currentTask.taskId}>{run.currentTask.taskId}</span><span style={{ fontFamily: 'monospace', fontWeight: '500', color: accent, fontSize: '0.78rem' }}>{elapsedStr(run.currentTask.startedAtMs, null)}</span></div>)}
                                {renderSwapCard && renderSwapCard(chore.choreId, run, chore)}
                                {run.completedTasks.length > 0 && (
                                    <details style={{ marginTop: '4px' }}><summary style={{ cursor: 'pointer', fontSize: '0.73rem', color: theme.colors.secondaryText, userSelect: 'none', padding: '3px 0' }}>{run.completedTasks.length} completed task{run.completedTasks.length !== 1 ? 's' : ''}</summary>
                                        <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                            {[...run.completedTasks].reverse().map((t, i) => (<div key={i} style={{ ...rowBase, background: theme.colors.primaryBg, border: `1px solid ${theme.colors.border}`, fontSize: '0.73rem' }}><span style={dotStyle(t.succeeded === false ? (theme.colors.error || '#ef4444') : '#22c55e')} /><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.taskId + (t.error ? ' — ' + t.error : '')}>{t.taskId}</span><span style={{ fontFamily: 'monospace', color: theme.colors.secondaryText, fontSize: '0.72rem' }}>{elapsedStr(t.startedAtMs, t.endedAtMs)}</span></div>))}
                                        </div>
                                    </details>
                                )}
                            </div>
                        )}
                    </div>
                );
            })()}
        </div>

        {/* Controls */}
        <div style={cardStyle}>
            <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>Controls</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
                {isStopped && (<div style={{ display: 'inline-flex', position: 'relative' }}>
                    <button style={{ ...buttonStyle, background: `linear-gradient(135deg, ${accent}, ${accent}cc)`, color: '#fff', border: 'none', borderRadius: '8px 0 0 8px', opacity: savingChore ? 0.6 : 1 }} disabled={savingChore}
                        onClick={async () => { setSavingChore(true); setChoreError(''); setChoreSuccess(''); try { const bot = await getReadyBotActor(); await bot.startChore(chore.choreId); setChoreSuccess('Chore started!'); await loadChoreData(); startChorePolling(); } catch (err) { setChoreError('Failed to start: ' + err.message); } finally { setSavingChore(false); } }}>Start</button>
                    <button style={{ ...buttonStyle, background: `linear-gradient(135deg, ${accent}, ${accent}cc)`, color: '#fff', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.3)', borderRadius: '0 8px 8px 0', padding: '0.4rem 0.45rem', minWidth: 'unset', opacity: savingChore ? 0.6 : 1 }} disabled={savingChore} title="Schedule start"
                        onClick={() => { const el = document.getElementById(`schedule-start-panel-${chore.choreId}`); if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none'; }}><span style={{ fontSize: '0.6rem' }}>&#9660;</span></button>
                </div>)}
                {isEnabled && !isPaused && (<button style={{ ...buttonStyle, background: '#f59e0b15', color: '#f59e0b', border: '1px solid #f59e0b40', opacity: savingChore ? 0.6 : 1 }} disabled={savingChore}
                    onClick={async () => { setSavingChore(true); setChoreError(''); setChoreSuccess(''); try { const bot = await getReadyBotActor(); await bot.pauseChore(chore.choreId); setChoreSuccess('Paused.'); await loadChoreData(); } catch (err) { setChoreError('Failed: ' + err.message); } finally { setSavingChore(false); } }}>Pause</button>)}
                {isPaused && (<button style={{ ...buttonStyle, background: `linear-gradient(135deg, ${accent}, ${accent}cc)`, color: '#fff', border: 'none', opacity: savingChore ? 0.6 : 1 }} disabled={savingChore}
                    onClick={async () => { setSavingChore(true); setChoreError(''); setChoreSuccess(''); try { const bot = await getReadyBotActor(); await bot.resumeChore(chore.choreId); setChoreSuccess('Resumed!'); await loadChoreData(); startChorePolling(); } catch (err) { setChoreError('Failed: ' + err.message); } finally { setSavingChore(false); } }}>Resume</button>)}
                {isEnabled && (<button style={{ ...buttonStyle, background: `${theme.colors.error || '#ef4444'}15`, color: theme.colors.error || '#ef4444', border: `1px solid ${theme.colors.error || '#ef4444'}30`, opacity: savingChore ? 0.6 : 1 }} disabled={savingChore}
                    onClick={async () => { setSavingChore(true); setChoreError(''); setChoreSuccess(''); try { const bot = await getReadyBotActor(); await bot.stopChore(chore.choreId); setChoreSuccess('Stopped.'); await loadChoreData(); } catch (err) { setChoreError('Failed: ' + err.message); } finally { setSavingChore(false); } }}>Stop</button>)}
                {!isRunning && (<button style={{ ...buttonStyle, background: `${accent}15`, color: accent, border: `1px solid ${accent}30`, opacity: savingChore ? 0.6 : 1 }} disabled={savingChore}
                    onClick={async () => { setSavingChore(true); setChoreError(''); setChoreSuccess(''); try { const bot = await getReadyBotActor(); await bot.triggerChore(chore.choreId); setChoreSuccess(isStopped ? 'Triggered once.' : 'Triggered!'); await loadChoreData(); startChorePolling(); } catch (err) { setChoreError('Failed: ' + err.message); } finally { setSavingChore(false); } }}>{isStopped ? 'Run Once' : 'Run Now'}</button>)}
                {isStopped && (confirmingDelete === chore.choreId ? (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: '#ef444412', borderRadius: '8px', border: '1px solid #ef444430' }}>
                        <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>Delete?</span>
                        <button style={{ ...buttonStyle, fontSize: '0.7rem', padding: '2px 8px', background: '#ef4444', color: '#fff', border: 'none' }} disabled={savingChore}
                            onClick={async () => { setSavingChore(true); setChoreError(''); setChoreSuccess(''); try { const bot = await getReadyBotActor(); const ok = await bot.deleteChoreInstance(chore.choreId); if (ok) setChoreSuccess('Deleted.'); else setChoreError('Failed.'); setConfirmingDelete(null); await loadChoreData(); } catch (err) { setChoreError('Failed: ' + err.message); } finally { setSavingChore(false); } }}>Confirm</button>
                        <button style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '2px 8px' }} onClick={() => setConfirmingDelete(null)}>Cancel</button>
                    </div>
                ) : (<button style={{ ...buttonStyle, background: '#ef444410', color: '#ef4444', border: '1px solid #ef444425', opacity: savingChore ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: '4px' }} disabled={savingChore}
                    onClick={() => setConfirmingDelete(chore.choreId)}><FaTrash style={{ fontSize: '0.6rem' }} /> Delete</button>)
                )}
            </div>

            {isStopped && (<div id={`schedule-start-panel-${chore.choreId}`} style={{ display: 'none', marginTop: '8px', padding: '10px', background: `${accent}06`, border: `1px solid ${accent}20`, borderRadius: '8px', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, marginRight: '4px' }}>Schedule first run at:</span>
                <input type="datetime-local" id={`schedule-start-input-${chore.choreId}`} style={{ ...inputStyle, fontSize: '0.8rem', padding: '0.35rem 0.5rem', width: 'auto' }} />
                <button style={{ ...buttonStyle, background: `linear-gradient(135deg, ${accent}, ${accent}cc)`, color: '#fff', border: 'none', fontSize: '0.8rem', opacity: savingChore ? 0.6 : 1 }} disabled={savingChore}
                    onClick={async () => { const input = document.getElementById(`schedule-start-input-${chore.choreId}`); if (!input?.value) { setChoreError('Pick a time.'); return; } const sel = new Date(input.value).getTime(); if (sel <= Date.now()) { setChoreError('Must be in the future.'); return; } const tsNanos = BigInt(sel) * 1_000_000n; setSavingChore(true); setChoreError(''); setChoreSuccess(''); try { const bot = await getReadyBotActor(); await bot.scheduleStartChore(chore.choreId, tsNanos); setChoreSuccess('Scheduled!'); const el = document.getElementById(`schedule-start-panel-${chore.choreId}`); if (el) el.style.display = 'none'; await loadChoreData(); startChorePolling(); } catch (err) { setChoreError('Failed: ' + err.message); } finally { setSavingChore(false); } }}>Confirm</button>
                <button style={{ ...buttonStyle, background: 'transparent', color: theme.colors.secondaryText, border: `1px solid ${theme.colors.border}`, fontSize: '0.8rem' }}
                    onClick={() => { const el = document.getElementById(`schedule-start-panel-${chore.choreId}`); if (el) el.style.display = 'none'; }}>Cancel</button>
            </div>)}

            <div style={{ marginTop: '8px' }}>
                <label style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '6px' }}>Frequency:</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', color: theme.colors.secondaryText }}>Every</span>
                    <input type="text" inputMode="numeric" defaultValue={currentBest.value} style={{ ...inputStyle, width: '70px' }} id={`chore-interval-${chore.choreId}`}
                        onChange={() => { const w = document.getElementById(`chore-interval-warn-${chore.choreId}`); if (!w) return; const v = parseFloat(document.getElementById(`chore-interval-${chore.choreId}`)?.value); const u = document.getElementById(`chore-interval-unit-${chore.choreId}`)?.value || 'minutes'; const s = Math.round((v || 0) * (unitMultipliers[u] || 60)); w.style.display = (s > 0 && s < 300) ? 'block' : 'none'; }} />
                    <select id={`chore-interval-unit-${chore.choreId}`} defaultValue={currentBest.unit} style={{ ...inputStyle, width: 'auto', padding: '4px 8px', cursor: 'pointer', appearance: 'auto' }}
                        onChange={() => { const w = document.getElementById(`chore-interval-warn-${chore.choreId}`); if (!w) return; const v = parseFloat(document.getElementById(`chore-interval-${chore.choreId}`)?.value); const u = document.getElementById(`chore-interval-unit-${chore.choreId}`)?.value || 'minutes'; const s = Math.round((v || 0) * (unitMultipliers[u] || 60)); w.style.display = (s > 0 && s < 300) ? 'block' : 'none'; }}>
                        <option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option>
                    </select>
                    <button style={{ ...buttonStyle, background: `${accent}10`, color: accent, border: `1px solid ${accent}25`, opacity: savingChore ? 0.6 : 1 }} disabled={savingChore}
                        onClick={async () => {
                            const valInput = document.getElementById(`chore-interval-${chore.choreId}`); const unitSelect = document.getElementById(`chore-interval-unit-${chore.choreId}`);
                            const val = parseFloat(valInput?.value); const unit = unitSelect?.value || 'days'; const multiplier = unitMultipliers[unit] || 86400; const totalSeconds = Math.round(val * multiplier);
                            if (!val || val <= 0 || totalSeconds < 60) { setChoreError('Interval must be at least 1 minute.'); return; }
                            if (totalSeconds > 365 * 86400) { setChoreError('Interval cannot exceed 365 days.'); return; }
                            if (totalSeconds < 300 && !window.confirm('Intervals < 5 min may not give chores enough time. Continue?')) return;
                            const maxInput = document.getElementById(`chore-max-interval-${chore.choreId}`); const maxUnitSelect = document.getElementById(`chore-max-interval-unit-${chore.choreId}`);
                            let maxSeconds = null;
                            if (maxInput && maxUnitSelect) { const maxVal = parseFloat(maxInput.value?.trim()); if (maxVal && maxVal > 0) { const maxMult = unitMultipliers[maxUnitSelect.value] || 86400; maxSeconds = Math.round(maxVal * maxMult); if (maxSeconds <= totalSeconds) { setChoreError('Max must be > base interval.'); return; } if (maxSeconds > 365 * 86400) { setChoreError('Max cannot exceed 365 days.'); return; } } }
                            setSavingChore(true); setChoreError(''); setChoreSuccess('');
                            try { const bot = await getReadyBotActor(); await bot.setChoreInterval(chore.choreId, BigInt(totalSeconds)); await bot.setChoreMaxInterval(chore.choreId, maxSeconds !== null ? [BigInt(maxSeconds)] : []); setChoreSuccess(maxSeconds !== null ? `Interval: ${fmtInt(totalSeconds)}–${fmtInt(maxSeconds)}` : `Interval: ${fmtInt(totalSeconds)}`); await loadChoreData(); } catch (err) { setChoreError('Failed: ' + err.message); } finally { setSavingChore(false); }
                        }}>Save</button>
                </div>
                <div id={`chore-interval-warn-${chore.choreId}`} style={{ display: intervalSeconds > 0 && intervalSeconds < 300 ? 'block' : 'none', marginTop: '6px', padding: '6px 10px', borderRadius: '6px', background: '#f59e0b12', border: '1px solid #f59e0b30', fontSize: '0.75rem', color: '#f59e0b', lineHeight: '1.4' }}>
                    Intervals shorter than 5 minutes may not give chores enough time to finish before the next run starts.
                </div>
                <div style={{ marginTop: '6px' }}>
                    <button style={{ background: 'none', border: 'none', padding: 0, fontSize: '0.7rem', color: theme.colors.mutedText, cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                        onClick={() => { const el = document.getElementById(`chore-range-panel-${chore.choreId}`); if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none'; }}>
                        {hasRange ? `Randomized range active (up to ${fmtInt(maxIntervalSeconds)}) — edit` : 'Randomize interval...'}
                    </button>
                    <div id={`chore-range-panel-${chore.choreId}`} style={{ display: hasRange ? 'flex' : 'none', marginTop: '6px', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>Max:</span>
                        <input type="text" inputMode="numeric" defaultValue={maxIntervalSeconds != null ? bestUnit(maxIntervalSeconds).value : ''} placeholder="none" style={{ ...inputStyle, width: '70px', fontSize: '0.8rem' }} id={`chore-max-interval-${chore.choreId}`} title="Optional max interval" />
                        <select id={`chore-max-interval-unit-${chore.choreId}`} defaultValue={maxIntervalSeconds != null ? bestUnit(maxIntervalSeconds).unit : currentBest.unit} style={{ ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: '0.8rem', cursor: 'pointer', appearance: 'auto' }}>
                            <option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option>
                        </select>
                        <span style={{ fontSize: '0.65rem', color: theme.colors.mutedText }}>(clear to disable)</span>
                    </div>
                </div>
            </div>
        </div>
    </>);
}

function renderTradingBotChoreConfig({ chore, config, choreTypeId, instanceId, getReadyBotActor, savingChore, setSavingChore, choreError, setChoreError, choreSuccess, setChoreSuccess, loadChoreData, theme, accentColor, cardStyle, inputStyle, buttonStyle, secondaryButtonStyle, canisterId, controlTabContent }) {
    const controlTab = { key: 'control', label: 'Control', content: (
        <ControlTabPanel key={`ctrl-${instanceId}`} chore={chore} controlTabContent={controlTabContent} getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} cardStyle={cardStyle} inputStyle={inputStyle} buttonStyle={buttonStyle} secondaryButtonStyle={secondaryButtonStyle} savingChore={savingChore} setSavingChore={setSavingChore} choreError={choreError} setChoreError={setChoreError} choreSuccess={choreSuccess} setChoreSuccess={setChoreSuccess} loadChoreData={loadChoreData} />
    )};

    const logTab = { key: 'logs', label: 'Logs', content: (
        <ChoreLogPanel key={`log-${instanceId}`} instanceId={instanceId} getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} />
    )};

    const purseTab = { key: 'purse', label: 'Purse', content: (
        <PursePanel key={`purse-${instanceId}`} instanceId={instanceId} getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} canisterId={canisterId} />
    )};

    switch (choreTypeId) {
        case 'trade':
            return (
                <ChoreConfigTabs key={instanceId} theme={theme} accentColor={accentColor} tabs={[
                    controlTab,
                    { key: 'actions', label: 'Actions', content: (
                        <ActionListPanel
                            instanceId={instanceId} getReadyBotActor={getReadyBotActor}
                            theme={theme} accentColor={accentColor} cardStyle={cardStyle}
                            inputStyle={inputStyle} buttonStyle={buttonStyle} secondaryButtonStyle={secondaryButtonStyle}
                            fetchFn="getTradeActions" addFn="addTradeAction" updateFn="updateTradeAction" removeFn="removeTradeAction"
                            allowedTypes={[ACTION_TYPE_TRADE, ACTION_TYPE_DEPOSIT, ACTION_TYPE_WITHDRAW, ACTION_TYPE_SEND]}
                            title="Trade Actions"
                            description="Configure token swaps, deposits, withdrawals, and sends that execute when this chore fires. Each action can have conditions (balance thresholds, price ranges) and frequency limits."
                        />
                    )},
                    purseTab,
                    { key: 'fallback', label: 'Fallback', content: (
                        <TradeFallbackPanel instanceId={instanceId} getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} secondaryButtonStyle={secondaryButtonStyle} />
                    )},
                    logTab,
                ]} />
            );

        case 'rebalance':
            return (
                <ChoreConfigTabs key={instanceId} theme={theme} accentColor={accentColor} tabs={[
                    controlTab,
                    { key: 'config', label: 'Config', content: (
                        <RebalancerConfigPanel
                            instanceId={instanceId} getReadyBotActor={getReadyBotActor}
                            theme={theme} accentColor={accentColor} cardStyle={cardStyle}
                            inputStyle={inputStyle} buttonStyle={buttonStyle} secondaryButtonStyle={secondaryButtonStyle}
                            canisterId={canisterId}
                        />
                    )},
                    purseTab,
                    logTab,
                ]} />
            );

        case 'move-funds':
            return (
                <ChoreConfigTabs key={instanceId} theme={theme} accentColor={accentColor} tabs={[
                    controlTab,
                    { key: 'actions', label: 'Actions', content: (
                        <ActionListPanel
                            instanceId={instanceId} getReadyBotActor={getReadyBotActor}
                            theme={theme} accentColor={accentColor} cardStyle={cardStyle}
                            inputStyle={inputStyle} buttonStyle={buttonStyle} secondaryButtonStyle={secondaryButtonStyle}
                            fetchFn="getMoveFundsActions" addFn="addMoveFundsAction" updateFn="updateMoveFundsAction" removeFn="removeMoveFundsAction"
                            allowedTypes={[ACTION_TYPE_DEPOSIT, ACTION_TYPE_WITHDRAW, ACTION_TYPE_SEND]}
                            title="Move Funds Actions"
                            description="Schedule fund purse, reclaim, and send operations between purses and external addresses."
                        />
                    )},
                    logTab,
                ]} />
            );

        case 'distribute-funds':
            return (
                <ChoreConfigTabs key={instanceId} theme={theme} accentColor={accentColor} tabs={[
                    controlTab,
                    { key: 'config', label: 'Config', content: (
                        <DistributionConfigPanel
                            instanceId={instanceId} getReadyBotActor={getReadyBotActor}
                            theme={theme} accentColor={accentColor} cardStyle={cardStyle}
                            inputStyle={inputStyle} buttonStyle={buttonStyle} secondaryButtonStyle={secondaryButtonStyle}
                        />
                    )},
                    logTab,
                ]} />
            );

        case 'snapshot':
            return (
                <ChoreConfigTabs key={instanceId} theme={theme} accentColor={accentColor} tabs={[
                    controlTab,
                    { key: 'config', label: 'Config', content: (
                        <SnapshotChoreConfigPanel instanceId={instanceId} theme={theme} accentColor={accentColor} cardStyle={cardStyle} />
                    )},
                    logTab,
                ]} />
            );

        default:
            return null;
    }
}

// ============================================
// Quick Trade Panel — One-off trade submission and queue
// ============================================
const ONE_OFF_STATUS = { 0: 'Pending', 1: 'Processing', 2: 'Completed', 3: 'Failed', 4: 'Cancelled' };
const ONE_OFF_STATUS_COLORS = { 0: '#f59e0b', 1: '#3b82f6', 2: '#10b981', 3: '#ef4444', 4: '#6b7280' };

function QuickTradePanel({ canisterId, createBotActor: createBotActorFn, identity, tokenRegistry, choreInstances }) {
    const { theme } = useTheme();
    const { formatValue: denomFormatValue, denomTokenId } = useDenomination();
    const [inputToken, setInputToken] = useState('');
    const [outputToken, setOutputToken] = useState('');
    const [inputAmount, setInputAmount] = useState('');
    const [minOutputAmount, setMinOutputAmount] = useState('');
    const [slippageBps, setSlippageBps] = useState('');
    const [maxImpactBps, setMaxImpactBps] = useState('');
    const [preferredDex, setPreferredDex] = useState('auto');
    const [sourcePurse, setSourcePurse] = useState('main');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [queue, setQueue] = useState([]);
    const [loadingQueue, setLoadingQueue] = useState(false);
    const [inputBalance, setInputBalance] = useState(null);
    const [outputBalance, setOutputBalance] = useState(null);
    const [inputTokenUsdPrice, setInputTokenUsdPrice] = useState(null);
    const actorRef = useRef(null);
    const pollRef = useRef(null);

    const getActor = useCallback(async () => {
        if (actorRef.current) return actorRef.current;
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
        const agent = HttpAgent.createSync({ identity, host });
        if (isLocal) await agent.fetchRootKey();
        actorRef.current = createBotActorFn(canisterId, { agent });
        return actorRef.current;
    }, [canisterId, identity, createBotActorFn]);

    useEffect(() => { actorRef.current = null; }, [identity, canisterId]);

    const tokenSubset = useMemo(() => {
        if (!tokenRegistry || tokenRegistry.length === 0) return undefined;
        return tokenRegistry.map(t => ({
            ledger_id: t.ledgerCanisterId?.toText?.() ?? String(t.ledgerCanisterId),
            symbol: t.symbol,
            decimals: Number(t.decimals),
            fee: Number(t.fee),
        }));
    }, [tokenRegistry]);

    const getTokenDecimals = useCallback((tokenPrincipal) => {
        if (!tokenRegistry || !tokenPrincipal) return 8;
        const entry = tokenRegistry.find(t => {
            const id = t.ledgerCanisterId?.toText?.() ?? String(t.ledgerCanisterId);
            return id === tokenPrincipal;
        });
        return entry ? Number(entry.decimals) : 8;
    }, [tokenRegistry]);

    const getTokenSymbol = useCallback((tokenPrincipal) => {
        if (!tokenRegistry || !tokenPrincipal) return '???';
        const entry = tokenRegistry.find(t => {
            const id = t.ledgerCanisterId?.toText?.() ?? String(t.ledgerCanisterId);
            return id === tokenPrincipal;
        });
        return entry ? entry.symbol : '???';
    }, [tokenRegistry]);

    useEffect(() => {
        if (!inputToken) { setInputTokenUsdPrice(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const decimals = getTokenDecimals(inputToken);
                priceService.setTokenDecimals(inputToken, decimals);
                const icpPrice = inputToken === ICP_LEDGER
                    ? 1
                    : await priceService.getTokenICPPrice(inputToken, decimals);
                const icpUsd = await priceService.getICPUSDPrice();
                if (!cancelled && icpPrice != null && icpUsd > 0) {
                    setInputTokenUsdPrice(icpPrice * icpUsd);
                } else if (!cancelled) {
                    setInputTokenUsdPrice(null);
                }
            } catch { if (!cancelled) setInputTokenUsdPrice(null); }
        })();
        return () => { cancelled = true; };
    }, [inputToken, getTokenDecimals]);

    useEffect(() => {
        let cancelled = false;
        const fetchBalances = async () => {
            if (!inputToken && !outputToken) { setInputBalance(null); setOutputBalance(null); return; }
            try {
                const bot = await getActor();
                if (sourcePurse === 'main') {
                    const bals = await bot.getMainPurseBalances();
                    if (cancelled) return;
                    const findBal = (tok) => {
                        if (!tok) return null;
                        const entry = bals.find(b => (b.token?.toText?.() ?? String(b.token)) === tok);
                        return entry ? entry.balance : 0n;
                    };
                    setInputBalance(findBal(inputToken));
                    setOutputBalance(findBal(outputToken));
                } else {
                    const bals = await bot.getPurseBalances(sourcePurse);
                    if (cancelled) return;
                    const findBal = (tok) => {
                        if (!tok) return null;
                        const entry = bals.find(b => (b.token?.toText?.() ?? String(b.token)) === tok);
                        return entry ? entry.balance : 0n;
                    };
                    setInputBalance(findBal(inputToken));
                    setOutputBalance(findBal(outputToken));
                }
            } catch (_) {
                if (!cancelled) { setInputBalance(null); setOutputBalance(null); }
            }
        };
        fetchBalances();
        return () => { cancelled = true; };
    }, [inputToken, outputToken, sourcePurse, getActor]);

    const refreshBalances = useCallback(async () => {
        if (!inputToken && !outputToken) return;
        try {
            const bot = await getActor();
            const bals = sourcePurse === 'main'
                ? await bot.getMainPurseBalances()
                : await bot.getPurseBalances(sourcePurse);
            const findBal = (tok) => {
                if (!tok) return null;
                const entry = bals.find(b => (b.token?.toText?.() ?? String(b.token)) === tok);
                return entry ? entry.balance : 0n;
            };
            setInputBalance(findBal(inputToken));
            setOutputBalance(findBal(outputToken));
        } catch (_) {}
    }, [inputToken, outputToken, sourcePurse, getActor]);

    const loadQueue = useCallback(async () => {
        try {
            const bot = await getActor();
            const q = await bot.getOneOffTradeQueue();
            setQueue(prev => {
                const wasProcessing = prev.some(e => Number(e.status) <= 1);
                const nowDone = !q.some(e => Number(e.status) <= 1);
                if (wasProcessing && nowDone) refreshBalances();
                return q;
            });
        } catch (_) {}
    }, [getActor, refreshBalances]);

    useEffect(() => {
        loadQueue();
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, [loadQueue]);

    useEffect(() => {
        const hasActive = queue.some(e => Number(e.status) <= 1);
        if (hasActive) {
            if (!pollRef.current) {
                pollRef.current = setInterval(loadQueue, 4000);
            }
        } else {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
    }, [queue, loadQueue]);

    const handleSubmit = async () => {
        setError(''); setSuccess('');
        if (!inputToken || !outputToken) { setError('Select both input and output tokens'); return; }
        if (inputToken === outputToken) { setError('Input and output tokens must be different'); return; }
        const inDec = getTokenDecimals(inputToken);
        const rawAmount = parseTokenAmount(inputAmount, inDec);
        if (!rawAmount || rawAmount === '0') { setError('Enter a valid input amount'); return; }

        setSubmitting(true);
        try {
            const bot = await getActor();
            const input = {
                inputToken: Principal.fromText(inputToken),
                outputToken: Principal.fromText(outputToken),
                inputAmount: BigInt(rawAmount),
                minOutputAmount: minOutputAmount ? [BigInt(parseTokenAmount(minOutputAmount, getTokenDecimals(outputToken)))] : [],
                maxSlippageBps: slippageBps ? [BigInt(Math.round(parseFloat(slippageBps) * 100))] : [],
                maxPriceImpactBps: maxImpactBps ? [BigInt(Math.round(parseFloat(maxImpactBps) * 100))] : [],
                preferredDex: preferredDex === 'auto' ? [] : [BigInt(preferredDex)],
                sourcePurseId: sourcePurse === 'main' ? [] : [sourcePurse],
            };
            const result = await bot.submitOneOffTrade(input);
            if ('Ok' in result) {
                setSuccess(`Trade #${result.Ok} submitted`);
                setInputAmount(''); setMinOutputAmount('');
                await loadQueue();
            } else {
                setError(result.Err);
            }
        } catch (e) {
            setError(e.message || 'Failed to submit trade');
        } finally {
            setSubmitting(false);
        }
    };

    const handleCancel = async (id) => {
        try {
            const bot = await getActor();
            const result = await bot.cancelOneOffTrade(BigInt(id));
            if ('Err' in result) { setError(result.Err); }
            await loadQueue();
        } catch (e) { setError(e.message); }
    };

    const handleClearHistory = async () => {
        try {
            const bot = await getActor();
            await bot.clearOneOffTradeHistory();
            await loadQueue();
        } catch (e) { setError(e.message); }
    };

    const inputStyle = {
        background: theme.colors.secondaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '8px',
        padding: '8px 12px',
        color: theme.colors.primaryText,
        fontSize: '0.85rem',
        width: '100%',
        boxSizing: 'border-box',
        outline: 'none',
    };

    const btnStyle = {
        background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_SECONDARY})`,
        color: '#fff',
        border: 'none',
        borderRadius: '8px',
        padding: '10px 20px',
        cursor: submitting ? 'not-allowed' : 'pointer',
        fontWeight: 600,
        fontSize: '0.85rem',
        opacity: submitting ? 0.6 : 1,
    };

    const completedOrFailed = queue.filter(e => Number(e.status) >= 2);
    const pendingOrProcessing = queue.filter(e => Number(e.status) <= 1);

    return (
        <div style={{ marginTop: '8px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                        <div>
                            <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px', display: 'block' }}>Input Token</label>
                            <TokenSelector value={inputToken} onChange={setInputToken} tokenSubset={tokenSubset} excludeTokens={outputToken ? [outputToken] : []} disabled={submitting} />
                            {inputToken && inputBalance != null && (
                                <div style={{ fontSize: '0.72rem', color: theme.colors.mutedText, marginTop: '3px' }}>
                                    Balance: {formatTokenAmount(inputBalance, getTokenDecimals(inputToken))} {getTokenSymbol(inputToken)}
                                </div>
                            )}
                        </div>
                        <div>
                            <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px', display: 'block' }}>Output Token</label>
                            <TokenSelector value={outputToken} onChange={setOutputToken} tokenSubset={tokenSubset} excludeTokens={inputToken ? [inputToken] : []} disabled={submitting} />
                            {outputToken && outputBalance != null && (
                                <div style={{ fontSize: '0.72rem', color: theme.colors.mutedText, marginTop: '3px' }}>
                                    Balance: {formatTokenAmount(outputBalance, getTokenDecimals(outputToken))} {getTokenSymbol(outputToken)}
                                </div>
                            )}
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                        <div>
                            <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px', display: 'block' }}>Input Amount</label>
                            <input type="text" value={inputAmount} onChange={e => setInputAmount(e.target.value)} placeholder={`0.00 ${getTokenSymbol(inputToken)}`} style={inputStyle} disabled={submitting} />
                            {inputAmount && inputTokenUsdPrice != null && (() => {
                                const parsed = parseFloat(inputAmount);
                                if (!isNaN(parsed) && parsed > 0) {
                                    const usdValue = parsed * inputTokenUsdPrice;
                                    return <div style={{ fontSize: '0.72rem', color: theme.colors.mutedText, marginTop: '3px' }}>{denomFormatValue(usdValue)}</div>;
                                }
                                return null;
                            })()}
                        </div>
                        <div>
                            <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px', display: 'block' }}>Min Output (optional)</label>
                            <input type="text" value={minOutputAmount} onChange={e => setMinOutputAmount(e.target.value)} placeholder={`0.00 ${getTokenSymbol(outputToken)}`} style={inputStyle} disabled={submitting} />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px', marginBottom: '14px' }}>
                        <div>
                            <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px', display: 'block' }}>Slippage (%)</label>
                            <input type="number" step="0.01" value={slippageBps} onChange={e => setSlippageBps(e.target.value)} placeholder="e.g. 1.5" style={inputStyle} disabled={submitting} />
                        </div>
                        <div>
                            <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px', display: 'block' }}>Max Impact (%)</label>
                            <input type="number" step="0.01" value={maxImpactBps} onChange={e => setMaxImpactBps(e.target.value)} placeholder="e.g. 3.0" style={inputStyle} disabled={submitting} />
                        </div>
                        <div>
                            <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px', display: 'block' }}>DEX</label>
                            <select value={preferredDex} onChange={e => setPreferredDex(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }} disabled={submitting}>
                                <option value="auto">Auto (best quote)</option>
                                <option value="0">ICPSwap</option>
                                <option value="1">KongSwap</option>
                            </select>
                        </div>
                        <div>
                            <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px', display: 'block' }}>Source Purse</label>
                            <select value={sourcePurse} onChange={e => setSourcePurse(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }} disabled={submitting}>
                                <option value="main">Main Purse</option>
                                {(choreInstances || []).map(([id, info]) => (
                                    <option key={id} value={id}>{info?.name || id}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                        <button onClick={handleSubmit} disabled={submitting} style={btnStyle}>
                            {submitting ? 'Submitting...' : 'Submit Trade'}
                        </button>
                        {error && <span style={{ color: '#ef4444', fontSize: '0.8rem' }}>{error}</span>}
                        {success && <span style={{ color: ACCENT, fontSize: '0.8rem' }}>{success}</span>}
                    </div>

                    {/* Queue display */}
                    {queue.length > 0 && (
                        <div style={{ borderTop: `1px solid ${theme.colors.border}`, paddingTop: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: theme.colors.primaryText }}>Trade Queue</span>
                                {completedOrFailed.length > 0 && (
                                    <button onClick={handleClearHistory} style={{ background: 'none', border: 'none', color: theme.colors.mutedText, cursor: 'pointer', fontSize: '0.72rem', textDecoration: 'underline' }}>
                                        Clear history
                                    </button>
                                )}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {queue.slice().reverse().map(entry => {
                                    const status = Number(entry.status);
                                    const inDec = getTokenDecimals(entry.inputToken?.toText?.() ?? String(entry.inputToken));
                                    const outDec = getTokenDecimals(entry.outputToken?.toText?.() ?? String(entry.outputToken));
                                    const inSym = getTokenSymbol(entry.inputToken?.toText?.() ?? String(entry.inputToken));
                                    const outSym = getTokenSymbol(entry.outputToken?.toText?.() ?? String(entry.outputToken));
                                    const inAmt = formatTokenAmount(entry.inputAmount, inDec);
                                    const outAmt = entry.outputAmount?.length > 0 ? formatTokenAmount(entry.outputAmount[0], outDec) : null;
                                    const dexLabel = entry.dexUsed?.length > 0 ? DEX_LABELS[Number(entry.dexUsed[0])] : null;
                                    const errMsg = entry.errorMessage?.length > 0 ? entry.errorMessage[0] : null;

                                    return (
                                        <div key={Number(entry.id)} style={{
                                            background: theme.colors.secondaryBg,
                                            borderRadius: '8px',
                                            padding: '8px 12px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px',
                                            fontSize: '0.8rem',
                                        }}>
                                            <span style={{ color: ONE_OFF_STATUS_COLORS[status], fontWeight: 600, minWidth: '72px' }}>
                                                {status === 1 && <span className="swap-pulse">&#9679; </span>}
                                                {ONE_OFF_STATUS[status]}
                                            </span>
                                            <span style={{ color: theme.colors.primaryText }}>
                                                {inAmt} {inSym} <FaArrowRight size={9} color={theme.colors.mutedText} style={{ margin: '0 3px', verticalAlign: 'middle' }} /> {outAmt ? `${outAmt} ${outSym}` : outSym}
                                            </span>
                                            {entry.sourcePurseId?.length > 0 && <span style={{ color: theme.colors.mutedText, fontSize: '0.72rem' }}>from {entry.sourcePurseId[0]}</span>}
                                            {dexLabel && <span style={{ color: theme.colors.mutedText, fontSize: '0.72rem' }}>via {dexLabel}</span>}
                                            {errMsg && <span style={{ color: '#ef4444', fontSize: '0.72rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={errMsg}>{errMsg}</span>}
                                            {status === 0 && (
                                                <button onClick={() => handleCancel(Number(entry.id))} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '2px', marginLeft: 'auto' }} title="Cancel">
                                                    <FaTimes size={11} />
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
        </div>
    );
}

// ============================================
// Recovery Panel — Recover stuck ICPSwap pool funds
// ============================================
const ICPSWAP_FEE_TIERS = [3000, 500, 10000, 30000];

function RecoveryPanel({ getReadyBotActor, theme, accentColor, canisterId }) {
    const { identity } = useAuth();
    const [tokenA, setTokenA] = useState('');
    const [tokenB, setTokenB] = useState('');
    const [checking, setChecking] = useState(false);
    const [recovering, setRecovering] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [poolInfo, setPoolInfo] = useState(null);
    // poolInfo: { poolCanisterId, token0, token1, sym0, sym1, dec0, dec1, fee0, fee1, unusedBal0, unusedBal1, subBal0, subBal1 }

    const cardBg = theme.colors.cardBg;
    const borderColor = theme.colors.border;

    const formatBal = (raw, dec) => {
        if (raw == null) return '...';
        return (Number(raw) / Math.pow(10, dec)).toLocaleString(undefined, { maximumFractionDigits: dec });
    };

    const handleCheck = async () => {
        if (!tokenA || !tokenB || tokenA === tokenB) return;
        setChecking(true);
        setError('');
        setSuccess('');
        setPoolInfo(null);
        try {
            const factoryActor = createIcpSwapFactoryActor(icpSwapFactoryCanisterId, {
                agentOptions: { identity },
            });

            const [t0, t1] = tokenA.toLowerCase() < tokenB.toLowerCase()
                ? [tokenA, tokenB]
                : [tokenB, tokenA];

            let poolCid = null;
            let matchedFeeTier = null;
            for (const feeTier of ICPSWAP_FEE_TIERS) {
                try {
                    const result = await factoryActor.getPool({
                        token0: { address: t0, standard: 'ICRC1' },
                        token1: { address: t1, standard: 'ICRC1' },
                        fee: BigInt(feeTier),
                    });
                    if (result.ok) {
                        const cid = typeof result.ok.canisterId === 'string'
                            ? result.ok.canisterId
                            : result.ok.canisterId.toText?.() || String(result.ok.canisterId);
                        poolCid = cid;
                        matchedFeeTier = feeTier;
                        break;
                    }
                } catch { /* try next tier */ }
            }

            if (!poolCid) {
                setError('No ICPSwap pool found for this token pair.');
                return;
            }

            const poolActor = createIcpSwapActor(poolCid, {
                agentOptions: { identity },
            });

            const botPrincipal = Principal.fromText(canisterId);
            const botSubaccount = Array.from(principalToSubaccount(botPrincipal));

            const metaResult = await poolActor.metadata();
            if (!metaResult.ok) {
                setError('Failed to get pool metadata.');
                return;
            }
            const meta = metaResult.ok;
            const pool0Addr = meta.token0.address;
            const pool1Addr = meta.token1.address;

            const ledger0 = createLedgerActor(pool0Addr, { agentOptions: { identity } });
            const ledger1 = createLedgerActor(pool1Addr, { agentOptions: { identity } });

            const [dec0, dec1, sym0, sym1, fee0, fee1] = await Promise.all([
                ledger0.icrc1_decimals(), ledger1.icrc1_decimals(),
                ledger0.icrc1_symbol(), ledger1.icrc1_symbol(),
                ledger0.icrc1_fee(), ledger1.icrc1_fee(),
            ]);

            // Check bot's unused balance in the pool (deposited but not swapped)
            const unusedResult = await poolActor.getUserUnusedBalance(botPrincipal);
            const unusedBal0 = unusedResult.ok ? BigInt(unusedResult.ok.balance0) : 0n;
            const unusedBal1 = unusedResult.ok ? BigInt(unusedResult.ok.balance1) : 0n;

            // Check bot's subaccount balance in the pool (transferred but not deposited)
            const subBal0 = BigInt(await ledger0.icrc1_balance_of({
                owner: Principal.fromText(poolCid),
                subaccount: [new Uint8Array(botSubaccount)],
            }));
            const subBal1 = BigInt(await ledger1.icrc1_balance_of({
                owner: Principal.fromText(poolCid),
                subaccount: [new Uint8Array(botSubaccount)],
            }));

            setPoolInfo({
                poolCanisterId: poolCid,
                feeTier: matchedFeeTier,
                token0: pool0Addr,
                token1: pool1Addr,
                sym0, sym1,
                dec0: Number(dec0), dec1: Number(dec1),
                fee0: BigInt(fee0), fee1: BigInt(fee1),
                unusedBal0, unusedBal1,
                subBal0, subBal1,
            });

            if (unusedBal0 === 0n && unusedBal1 === 0n && subBal0 === 0n && subBal1 === 0n) {
                setSuccess('No stuck funds found in this pool. Everything looks clean!');
            }
        } catch (e) {
            setError(e.message || 'Failed to check pool');
        } finally {
            setChecking(false);
        }
    };

    const handleRecover = async () => {
        if (!poolInfo) return;
        setRecovering(true);
        setError('');
        setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const result = await bot.recoverPoolFunds(
                Principal.fromText(poolInfo.token0),
                Principal.fromText(poolInfo.token1),
            );
            if (result.Err) {
                setError(typeof result.Err === 'string' ? result.Err : JSON.stringify(result.Err));
            } else if (result.Ok) {
                const r0 = Number(result.Ok.recovered0) / Math.pow(10, poolInfo.dec0);
                const r1 = Number(result.Ok.recovered1) / Math.pow(10, poolInfo.dec1);
                const parts = [];
                if (r0 > 0) parts.push(`${r0.toLocaleString(undefined, { maximumFractionDigits: poolInfo.dec0 })} ${poolInfo.sym0}`);
                if (r1 > 0) parts.push(`${r1.toLocaleString(undefined, { maximumFractionDigits: poolInfo.dec1 })} ${poolInfo.sym1}`);
                setSuccess(parts.length > 0
                    ? `Successfully recovered ${parts.join(' and ')} to main account!`
                    : 'Recovery completed (no additional funds were returned).');
                // Re-check to update display
                handleCheck();
            }
        } catch (e) {
            setError(e.message || 'Recovery failed');
        } finally {
            setRecovering(false);
        }
    };

    const hasStuckFunds = poolInfo && (
        poolInfo.unusedBal0 > 0n || poolInfo.unusedBal1 > 0n ||
        poolInfo.subBal0 > 0n || poolInfo.subBal1 > 0n
    );

    return (
        <div>
            <h3 style={{ margin: '0 0 6px', fontSize: '0.95rem', fontWeight: 600, color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FaMedkit size={14} color={accentColor} /> ICPSwap Pool Recovery
            </h3>
            <p style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, margin: '0 0 14px', lineHeight: '1.5' }}>
                If a swap was interrupted, funds may be stuck in an ICPSwap pool's deposit balance or subaccount.
                Select two tokens to check for recoverable funds.
            </p>

            {error && <div style={{ padding: '8px 12px', background: '#ef444415', border: '1px solid #ef444430', borderRadius: '8px', color: '#ef4444', fontSize: '0.8rem', marginBottom: '10px' }}>{error}</div>}
            {success && <div style={{ padding: '8px 12px', background: '#22c55e15', border: '1px solid #22c55e30', borderRadius: '8px', color: '#22c55e', fontSize: '0.8rem', marginBottom: '10px' }}>{success}</div>}

            <div style={{ padding: '14px', background: cardBg, borderRadius: '10px', border: `1px solid ${borderColor}`, marginBottom: '14px' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '10px' }}>Select Token Pair</div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '12px' }}>
                    <div style={{ flex: 1, minWidth: '180px' }}>
                        <label style={{ display: 'block', fontSize: '0.78rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Token A</label>
                        <TokenSelector value={tokenA} onChange={setTokenA} placeholder="Select token..." excludeTokens={tokenB ? [tokenB] : []} />
                    </div>
                    <div style={{ flex: 1, minWidth: '180px' }}>
                        <label style={{ display: 'block', fontSize: '0.78rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Token B</label>
                        <TokenSelector value={tokenB} onChange={setTokenB} placeholder="Select token..." excludeTokens={tokenA ? [tokenA] : []} />
                    </div>
                </div>
                <button onClick={handleCheck} disabled={!tokenA || !tokenB || tokenA === tokenB || checking} style={{
                    padding: '8px 18px', fontSize: '0.82rem', fontWeight: '600', borderRadius: '8px', border: 'none', cursor: 'pointer',
                    background: accentColor, color: '#fff', opacity: (!tokenA || !tokenB || tokenA === tokenB || checking) ? 0.5 : 1,
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                }}>
                    {checking ? <><FaSyncAlt size={11} style={{ animation: 'spin 1s linear infinite' }} /> Checking Pool...</> : <><FaSearch size={11} /> Check Pool</>}
                </button>
            </div>

            {poolInfo && (
                <div style={{ padding: '14px', background: cardBg, borderRadius: '10px', border: `1px solid ${borderColor}`, marginBottom: '14px' }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '10px' }}>
                        Pool: {poolInfo.sym0}/{poolInfo.sym1}
                        <span style={{ fontWeight: '400', fontSize: '0.75rem', color: theme.colors.secondaryText, marginLeft: '8px' }}>
                            ({poolInfo.feeTier / 10000}% fee tier)
                        </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginBottom: '12px', wordBreak: 'break-all' }}>
                        Pool canister: {poolInfo.poolCanisterId}
                    </div>

                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                        <thead>
                            <tr style={{ borderBottom: `1px solid ${borderColor}` }}>
                                <th style={{ textAlign: 'left', padding: '6px 8px', color: theme.colors.secondaryText, fontWeight: '500' }}>Token</th>
                                <th style={{ textAlign: 'right', padding: '6px 8px', color: theme.colors.secondaryText, fontWeight: '500' }}>Deposited (unused)</th>
                                <th style={{ textAlign: 'right', padding: '6px 8px', color: theme.colors.secondaryText, fontWeight: '500' }}>In Subaccount</th>
                                <th style={{ textAlign: 'right', padding: '6px 8px', color: theme.colors.secondaryText, fontWeight: '500' }}>Total Recoverable</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[
                                { sym: poolInfo.sym0, dec: poolInfo.dec0, unused: poolInfo.unusedBal0, sub: poolInfo.subBal0, tid: poolInfo.token0 },
                                { sym: poolInfo.sym1, dec: poolInfo.dec1, unused: poolInfo.unusedBal1, sub: poolInfo.subBal1, tid: poolInfo.token1 },
                            ].map(row => {
                                const total = row.unused + row.sub;
                                const hasBalance = total > 0n;
                                return (
                                    <tr key={row.tid} style={{ borderBottom: `1px solid ${borderColor}20` }}>
                                        <td style={{ padding: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <TokenIcon tokenId={row.tid} size={18} />
                                            <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>{row.sym}</span>
                                        </td>
                                        <td style={{ textAlign: 'right', padding: '8px', color: row.unused > 0n ? '#f59e0b' : theme.colors.mutedText }}>
                                            {formatBal(row.unused, row.dec)}
                                        </td>
                                        <td style={{ textAlign: 'right', padding: '8px', color: row.sub > 0n ? '#f59e0b' : theme.colors.mutedText }}>
                                            {formatBal(row.sub, row.dec)}
                                        </td>
                                        <td style={{ textAlign: 'right', padding: '8px', fontWeight: hasBalance ? '600' : '400', color: hasBalance ? '#ef4444' : theme.colors.mutedText }}>
                                            {formatBal(total, row.dec)} {row.sym}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    {hasStuckFunds && (
                        <div style={{ marginTop: '14px' }}>
                            <div style={{ fontSize: '0.78rem', color: theme.colors.secondaryText, marginBottom: '10px', lineHeight: '1.5' }}>
                                Stuck funds detected. The recovery process will deposit any subaccount balances into the pool's internal tracking, then withdraw everything back to the bot's main account.
                            </div>
                            <button onClick={handleRecover} disabled={recovering} style={{
                                padding: '8px 20px', fontSize: '0.82rem', fontWeight: '600', borderRadius: '8px', border: 'none', cursor: 'pointer',
                                background: '#ef4444', color: '#fff', opacity: recovering ? 0.6 : 1,
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                            }}>
                                {recovering ? <><FaSyncAlt size={11} style={{ animation: 'spin 1s linear infinite' }} /> Recovering...</> : <><FaMedkit size={11} /> Recover Funds</>}
                            </button>
                        </div>
                    )}

                    {!hasStuckFunds && (
                        <div style={{ marginTop: '10px', fontSize: '0.8rem', color: '#22c55e', fontWeight: '500' }}>
                            No stuck funds found in this pool.
                        </div>
                    )}
                </div>
            )}

            <div style={{ padding: '12px', background: `${accentColor}08`, borderRadius: '10px', border: `1px solid ${accentColor}20` }}>
                <div style={{ fontSize: '0.78rem', color: theme.colors.secondaryText, lineHeight: '1.6' }}>
                    <strong style={{ color: theme.colors.primaryText }}>How funds can get stuck:</strong> When the bot performs a swap on ICPSwap, it first transfers tokens to the pool's subaccount, then calls the pool to execute the swap. If the swap call fails (e.g., due to slippage, a timeout, or pool availability), the transferred tokens remain in the pool's subaccount or deposited balance, waiting to be recovered.
                </div>
            </div>
        </div>
    );
}

export default function TradingBot() {
    const { canisterId } = useParams();
    const { theme } = useTheme();
    const { isAuthenticated, identity } = useAuth();
    const { principalNames, principalNicknames, fetchAllNames } = useNaming();
    const { whitelistedTokens } = useWhitelistTokens();
    const [cbEvents, setCbEvents] = useState(null);
    const [controllers, setControllers] = useState([]);
    const [showWizard, setShowWizard] = useState(false);
    const [hasTokens, setHasTokens] = useState(null);
    const [tokenRegistry, setTokenRegistry] = useState([]);
    const [choreInstances, setChoreInstances] = useState([]);
    const wizardActorRef = useRef(null);
    const botPanelRef = useRef(null);

    const getWizardBotActor = useCallback(async () => {
        if (wizardActorRef.current) return wizardActorRef.current;
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
        const agent = HttpAgent.createSync({ identity, host });
        if (isLocal) await agent.fetchRootKey();
        const actor = createBotActor(canisterId, { agent });
        wizardActorRef.current = actor;
        return actor;
    }, [canisterId, identity]);

    const renderSwapCard = useSwapCardRenderer(getWizardBotActor, theme, ACCENT);

    const renderChoreSummaryExtra = useCallback((choreId, chore, getReadyBotActor) => (
        <ChoreCumulativeSummary choreId={choreId} chore={chore} getReadyBotActor={getReadyBotActor} accentColor={ACCENT} theme={theme} identity={identity} />
    ), [theme, identity]);

    useEffect(() => {
        wizardActorRef.current = null;
    }, [identity, canisterId]);

    useEffect(() => {
        if (!isAuthenticated || !canisterId || !identity) return;
        let cancelled = false;
        (async () => {
            try {
                const bot = await getWizardBotActor();
                const [registry, instances] = await Promise.all([
                    bot.getTokenRegistry ? bot.getTokenRegistry() : [],
                    bot.listChoreInstances ? bot.listChoreInstances([]) : [],
                ]);
                if (!cancelled) {
                    setTokenRegistry(registry);
                    setChoreInstances(instances);
                    const found = registry.length > 0;
                    setHasTokens(found);
                    if (!found) {
                        setShowWizard(true);
                        // Fire-and-forget background token scan
                        if (whitelistedTokens?.length > 0) {
                            (async () => {
                                try {
                                    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                                    const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
                                    const agent = HttpAgent.createSync({ identity, host });
                                    if (isLocal) await agent.fetchRootKey();
                                    const botPrincipal = Principal.fromText(canisterId);
                                    const CONCURRENCY = 8;
                                    const queue = [...whitelistedTokens];
                                    const workers = [];
                                    for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
                                        workers.push((async () => {
                                            while (queue.length > 0) {
                                                if (cancelled) return;
                                                const item = queue.shift();
                                                if (!item) break;
                                                try {
                                                    const tid = item.ledger_id?.toString?.() ?? String(item.ledger_id);
                                                    const ledgerActor = createLedgerActor(tid, { agent });
                                                    const balance = await ledgerActor.icrc1_balance_of({ owner: botPrincipal, subaccount: [] });
                                                    if (BigInt(balance) > 0n) {
                                                        await bot.addToken({
                                                            ledgerCanisterId: Principal.fromText(tid),
                                                            symbol: item.symbol || '???',
                                                            decimals: item.decimals ?? 8,
                                                            fee: BigInt(item.fee ?? 10000),
                                                        });
                                                    }
                                                } catch (_) {}
                                            }
                                        })());
                                    }
                                    await Promise.all(workers);
                                } catch (_) {}
                            })();
                        }
                    }
                }
            } catch (_) { if (!cancelled) setHasTokens(null); }
        })();
        return () => { cancelled = true; };
    }, [isAuthenticated, canisterId, identity, getWizardBotActor, whitelistedTokens]);

    // Naming state
    const [showNamingSection, setShowNamingSection] = useState(false);
    const [nicknameInput, setNicknameInput] = useState('');
    const [publicNameInput, setPublicNameInput] = useState('');
    const [savingNickname, setSavingNickname] = useState(false);
    const [savingPublicName, setSavingPublicName] = useState(false);
    const [namingError, setNamingError] = useState('');
    const [namingSuccess, setNamingSuccess] = useState('');

    const displayInfo = canisterId ? getPrincipalDisplayInfoFromContext(canisterId, principalNames, principalNicknames) : null;

    const isController = identity && controllers.length > 0 &&
        controllers.some(c => c.toString() === identity.getPrincipal().toString());

    // Fetch controllers from the management canister
    useEffect(() => {
        if (!isAuthenticated || !canisterId || !identity) return;
        (async () => {
            try {
                const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                const host = isLocal ? 'http://localhost:4943' : 'https://icp0.io';
                const agent = HttpAgent.createSync({ host, identity });
                if (isLocal) await agent.fetchRootKey();
                const canisterPrincipal = Principal.fromText(canisterId);
                const mgmt = Actor.createActor(managementCanisterIdlFactory, {
                    agent,
                    canisterId: MANAGEMENT_CANISTER_ID,
                    callTransform: (methodName, args, callConfig) => ({
                        ...callConfig,
                        effectiveCanisterId: canisterPrincipal,
                    }),
                });
                const result = await mgmt.canister_status({ canister_id: canisterPrincipal });
                setControllers(result.settings.controllers);
            } catch (_) {
                setControllers([]);
            }
        })();
    }, [isAuthenticated, canisterId, identity]);

    // Load recent CB events for chore status indicators
    useEffect(() => {
        if (!isAuthenticated || !canisterId) return;
        (async () => {
            try {
                const { HttpAgent: HA } = await import('@dfinity/agent');
                const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
                const agent = HA.createSync({ identity, host });
                if (isLocal) await agent.fetchRootKey();
                const bot = createBotActor(canisterId, { agent });
                if (bot?.getCircuitBreakerLog) {
                    const log = await bot.getCircuitBreakerLog({ startId: [], limit: [50], ruleId: [], fromTime: [], toTime: [] });
                    setCbEvents(log.entries || []);
                }
            } catch (_) { /* CB may not be available on older versions */ }
        })();
    }, [isAuthenticated, canisterId, identity]);

    const namingCardStyle = {
        background: theme.colors.cardGradient || theme.colors.cardBackground,
        borderRadius: '14px',
        padding: '1.25rem',
        marginBottom: '1rem',
        border: `1px solid ${theme.colors.border}`,
        boxShadow: theme.colors.cardShadow || 'none',
    };

    const namingButtonStyle = {
        background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_SECONDARY})`,
        color: '#fff',
        border: 'none',
        borderRadius: '10px',
        padding: '0.65rem 1.25rem',
        fontSize: '0.9rem',
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'all 0.2s',
        boxShadow: `0 4px 12px ${ACCENT}30`,
    };

    if (!canisterId) {
        return (
            <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
                <style>{tradingBotStyles}</style>
                <Header />
                <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 16px', textAlign: 'center' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '16px' }}>📊</div>
                    <h1 style={{ color: theme.colors.primaryText, fontSize: '1.5rem', marginBottom: '8px' }}>
                        Trading Bot
                    </h1>
                    <p style={{ color: theme.colors.secondaryText, fontSize: '0.95rem' }}>
                        No canister ID provided. Navigate to a specific trading bot from your wallet or the Sneedapp page.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
            <style>{tradingBotStyles}</style>
            <Header />

            {/* Hero Section */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${ACCENT}15 50%, ${ACCENT_SECONDARY}10 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '2rem 1.5rem',
                position: 'relative',
                overflow: 'hidden'
            }}>
                <div style={{
                    position: 'absolute',
                    top: '-50%',
                    right: '-10%',
                    width: '400px',
                    height: '400px',
                    background: `radial-gradient(circle, ${ACCENT}20 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-30%',
                    left: '5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${ACCENT_SECONDARY}15 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />

                <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                        <div className="trading-bot-float" style={{
                            width: '56px',
                            height: '56px',
                            borderRadius: '16px',
                            background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_SECONDARY})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 8px 32px ${ACCENT}50`,
                            flexShrink: 0,
                            position: 'relative',
                        }}>
                            <BotIcon type="trading" size={28} color="#fff" />
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                marginBottom: '4px'
                            }}>
                                <h1 style={{
                                    fontSize: '1.5rem',
                                    fontWeight: '700',
                                    color: theme.colors.primaryText,
                                    margin: 0,
                                    letterSpacing: '-0.5px'
                                }}>
                                    Sneed Trading Bot
                                </h1>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                <PrincipalDisplay
                                    principal={canisterId}
                                    displayInfo={displayInfo}
                                    showCopyButton={true}
                                    isAuthenticated={isAuthenticated}
                                    noLink={true}
                                />
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                        {isAuthenticated && (
                            <button
                                onClick={() => setShowWizard(true)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                    background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_SECONDARY})`,
                                    border: 'none', borderRadius: '10px',
                                    color: '#fff', fontSize: '0.85rem', fontWeight: '600',
                                    padding: '8px 16px', cursor: 'pointer',
                                    boxShadow: `0 4px 16px ${ACCENT}40`,
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                <img src={WIZARD_SVG_URL} alt="" style={{ width: 18, height: 18, filter: 'brightness(10)', maxWidth: 'none' }} />
                                Setup Wizard
                            </button>
                        )}
                        <Link
                            to="/help/trading_bot"
                            style={{
                                color: ACCENT,
                                fontSize: '0.85rem',
                                textDecoration: 'none',
                                fontWeight: '500',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                            }}
                        >
                            Learn how it works <FaArrowRight size={10} />
                        </Link>
                        {isAuthenticated && (
                            <>
                                <span style={{ color: theme.colors.border }}>|</span>
                                <button
                                    onClick={() => setShowNamingSection(!showNamingSection)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: ACCENT,
                                        fontSize: '0.85rem',
                                        cursor: 'pointer',
                                        padding: 0,
                                        fontWeight: '500',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }}
                                >
                                    {showNamingSection ? (
                                        <>Hide naming options <FaChevronUp size={10} /></>
                                    ) : (
                                        <>{isController ? 'Name this bot' : 'Set nickname'} <FaChevronDown size={10} /></>
                                    )}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>

            <main style={{ maxWidth: '900px', margin: '0 auto', padding: '1.5rem 1rem 3.75rem' }}>
                {/* Naming Section */}
                {showNamingSection && isAuthenticated && (
                    <div className="trading-bot-fade-in" style={{
                        ...namingCardStyle,
                        marginBottom: '1.25rem',
                        background: `linear-gradient(135deg, ${ACCENT}08 0%, ${theme.colors.cardGradient || theme.colors.secondaryBg} 100%)`,
                        border: `1px solid ${ACCENT}20`,
                    }}>
                        <h3 style={{
                            color: theme.colors.primaryText,
                            marginBottom: '0.5rem',
                            fontSize: '1rem',
                            fontWeight: '600',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            <span style={{
                                width: '28px', height: '28px', borderRadius: '8px',
                                background: `${ACCENT}20`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <FaTag size={13} color={ACCENT} />
                            </span>
                            Name Your Trading Bot
                        </h3>
                        <p style={{ color: theme.colors.secondaryText, fontSize: '0.82rem', margin: '0 0 1rem 0', lineHeight: '1.5' }}>
                            Give your bot a personal name so you can identify it easily across the app.
                        </p>

                        {namingError && (
                            <div style={{
                                color: theme.colors.error || '#ef4444',
                                fontSize: '13px',
                                marginBottom: '12px',
                                padding: '8px 12px',
                                backgroundColor: `${theme.colors.error || '#ef4444'}20`,
                                borderRadius: '6px',
                            }}>
                                {namingError}
                            </div>
                        )}

                        {namingSuccess && (
                            <div style={{
                                color: theme.colors.success || '#22c55e',
                                fontSize: '13px',
                                marginBottom: '12px',
                                padding: '8px 12px',
                                backgroundColor: `${theme.colors.success || '#22c55e'}20`,
                                borderRadius: '6px',
                            }}>
                                {namingSuccess}
                            </div>
                        )}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {/* Nickname (private) */}
                            <div>
                                <label style={{
                                    color: theme.colors.secondaryText,
                                    fontSize: '13px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    marginBottom: '6px',
                                }}>
                                    <FaEyeSlash size={11} color={theme.colors.mutedText} />
                                    Private Nickname
                                    <span style={{ color: theme.colors.mutedText, fontWeight: '400' }}>— only you can see this</span>
                                </label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <input
                                        type="text"
                                        value={nicknameInput}
                                        onChange={(e) => setNicknameInput(e.target.value)}
                                        placeholder={displayInfo?.nickname || 'e.g., My DCA Bot'}
                                        style={{
                                            flex: 1,
                                            padding: '10px 12px',
                                            borderRadius: '8px',
                                            border: `1px solid ${theme.colors.border}`,
                                            backgroundColor: theme.colors.primaryBg,
                                            color: theme.colors.primaryText,
                                            fontSize: '14px',
                                        }}
                                    />
                                    <button
                                        onClick={async () => {
                                            if (!nicknameInput.trim()) return;
                                            setSavingNickname(true);
                                            setNamingError('');
                                            setNamingSuccess('');
                                            try {
                                                await setPrincipalNickname(identity, canisterId, nicknameInput.trim());
                                                setNamingSuccess('Nickname saved!');
                                                setNicknameInput('');
                                                if (fetchAllNames) fetchAllNames();
                                            } catch (err) {
                                                setNamingError(`Failed to save nickname: ${err.message}`);
                                            } finally {
                                                setSavingNickname(false);
                                            }
                                        }}
                                        disabled={savingNickname || !nicknameInput.trim()}
                                        style={{
                                            ...namingButtonStyle,
                                            opacity: (savingNickname || !nicknameInput.trim()) ? 0.6 : 1,
                                        }}
                                    >
                                        {savingNickname ? '...' : 'Save'}
                                    </button>
                                </div>
                                {displayInfo?.nickname && (
                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginTop: '4px' }}>
                                        Current: "{displayInfo.nickname}"
                                    </div>
                                )}
                            </div>

                            {/* Public Name (controllers only) */}
                            {isController && (
                                <div>
                                    <label style={{
                                        color: theme.colors.secondaryText,
                                        fontSize: '13px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        marginBottom: '6px',
                                    }}>
                                        <FaGlobe size={11} color={ACCENT} />
                                        Public Name
                                        <span style={{ color: '#f59e0b', fontWeight: '500', fontSize: '12px' }}>— visible to everyone</span>
                                    </label>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <input
                                            type="text"
                                            value={publicNameInput}
                                            onChange={(e) => setPublicNameInput(e.target.value)}
                                            placeholder={displayInfo?.name || "e.g., Alice's Trading Bot"}
                                            style={{
                                                flex: 1,
                                                padding: '10px 12px',
                                                borderRadius: '8px',
                                                border: `1px solid ${theme.colors.border}`,
                                                backgroundColor: theme.colors.primaryBg,
                                                color: theme.colors.primaryText,
                                                fontSize: '14px',
                                            }}
                                        />
                                        <button
                                            onClick={async () => {
                                                if (!publicNameInput.trim()) return;
                                                setSavingPublicName(true);
                                                setNamingError('');
                                                setNamingSuccess('');
                                                try {
                                                    await setPrincipalNameFor(identity, canisterId, publicNameInput.trim());
                                                    setNamingSuccess('Public name saved! Everyone will see this name.');
                                                    setPublicNameInput('');
                                                    if (fetchAllNames) fetchAllNames();
                                                } catch (err) {
                                                    setNamingError(`Failed to save public name: ${err.message}`);
                                                } finally {
                                                    setSavingPublicName(false);
                                                }
                                            }}
                                            disabled={savingPublicName || !publicNameInput.trim()}
                                            style={{
                                                ...namingButtonStyle,
                                                opacity: (savingPublicName || !publicNameInput.trim()) ? 0.6 : 1,
                                            }}
                                        >
                                            {savingPublicName ? '...' : 'Save'}
                                        </button>
                                    </div>
                                    {displayInfo?.name && (
                                        <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginTop: '4px' }}>
                                            Current: "{displayInfo.name}"
                                        </div>
                                    )}
                                    <div style={{
                                        marginTop: '8px',
                                        padding: '8px 12px',
                                        borderRadius: '8px',
                                        background: `#f59e0b10`,
                                        border: `1px solid #f59e0b25`,
                                        fontSize: '0.78rem',
                                        color: theme.colors.secondaryText,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                    }}>
                                        <FaGlobe size={10} color="#f59e0b" />
                                        This name will be visible to anyone who views this canister across the app.
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Authentication check */}
                {!isAuthenticated ? (
                    <div style={{
                        background: theme.colors.cardGradient,
                        borderRadius: '12px',
                        border: `1px solid ${theme.colors.border}`,
                        padding: '2rem',
                        textAlign: 'center',
                    }}>
                        <div style={{ fontSize: '2rem', marginBottom: '12px' }}>🔐</div>
                        <h3 style={{ color: theme.colors.primaryText, margin: '0 0 8px 0' }}>Authentication Required</h3>
                        <p style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', margin: 0 }}>
                            Please log in with Internet Identity to manage this trading bot.
                        </p>
                    </div>
                ) : (
                    <>
                        <BotManagementPanel
                            ref={botPanelRef}
                            canisterId={canisterId}
                            createBotActor={createBotActor}
                            accentColor={ACCENT}
                            accentColorSecondary={ACCENT_SECONDARY}
                            botName="Trading Bot"
                            botIcon={<BotIcon type="trading" size={16} color={ACCENT} />}
                            appId={APP_ID}
                            permissionLabels={PERMISSION_LABELS}
                            permissionDescriptions={PERMISSION_DESCRIPTIONS}
                            multiInstanceChoreTypes={MULTI_INSTANCE_CHORE_TYPES}
                            renderChoreConfig={renderTradingBotChoreConfig}
                            renderChoreSummaryExtra={renderChoreSummaryExtra}
                            renderSwapCard={renderSwapCard}
                            identity={identity}
                            isAuthenticated={isAuthenticated}
                            extraInfoContent={<DexSettingsPanel canisterId={canisterId} createBotActor={createBotActor} identity={identity} />}
                            cbEvents={cbEvents}
                            preferredChoreTypeOrder={['rebalance', 'trade', 'move-funds', 'distribute-funds', 'snapshot']}
                            hideLogTab
                        />
                        <TradingBotLogs
                            canisterId={canisterId}
                            createBotActorFn={createBotActor}
                            theme={theme}
                            accentColor={ACCENT}
                            identity={identity}
                            botPanelRef={botPanelRef}
                            cbEvents={cbEvents}
                            tokenRegistry={tokenRegistry}
                            choreInstances={choreInstances}
                        />
                    </>
                )}
            </main>
            <TradingBotWizard
                isOpen={showWizard}
                onClose={(didDeploy, deployedChoreTypeId, deployedInstanceId) => {
                    setShowWizard(false);
                    if (didDeploy) {
                        setHasTokens(true);
                        wizardActorRef.current = null;
                        if (botPanelRef.current && deployedChoreTypeId) {
                            setTimeout(() => {
                                botPanelRef.current.navigateToChore(deployedChoreTypeId, deployedInstanceId);
                            }, 100);
                        }
                    }
                }}
                getReadyBotActor={getWizardBotActor}
                canisterId={canisterId}
                identity={identity}
                hasTokens={hasTokens}
            />
        </div>
    );
}
