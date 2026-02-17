/**
 * TradingBot — Management page for a Sneed Trading Bot canister.
 *
 * Route: /trading_bot/:canisterId
 *
 * Uses the reusable BotManagementPanel for Info, Botkeys, Chores framework, and Log tabs.
 * The per-chore configuration panels are custom to the trading bot.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import Header from '../components/Header';
import BotManagementPanel from '../components/BotManagementPanel';
import TokenSelector from '../components/TokenSelector';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
// Trading bot Candid declarations — aligned with staking bot API for shared BotManagementPanel.
import { createActor as createBotActor } from 'external/sneed_trading_bot';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { decodeIcrcAccount, encodeIcrcAccount } from '@dfinity/ledger-icrc';
import { FaChartLine, FaPlus, FaTrash, FaEdit, FaSave, FaTimes, FaSyncAlt, FaSearch, FaGripVertical, FaLock, FaLockOpen, FaPause, FaPlay } from 'react-icons/fa';
import TokenIcon from '../components/TokenIcon';
import PrincipalInput from '../components/PrincipalInput';
import { useWhitelistTokens } from '../contexts/WhitelistTokensContext';
import priceService from '../services/PriceService';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ComposedChart, Bar, Line } from 'recharts';

// Trading bot accent colors — green/teal for trading
const ACCENT = '#10b981';
const ACCENT_SECONDARY = '#34d399';

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
    'ManageSubaccounts': 'Manage Subaccounts',
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
};

const PERMISSION_DESCRIPTIONS = {
    'FullPermissions': 'Grants all permissions, including any added in future versions',
    'ManagePermissions': 'Add/remove botkey principals and manage their permissions',
    'ViewChores': 'View bot chore statuses, configurations, and settings',
    'ViewLogs': 'Read bot log entries and view log configuration',
    'ManageLogs': 'Set log level, max entries, and clear logs',
    'ViewPortfolio': 'View balances, subaccounts, and portfolio state',
    'ManageSubaccounts': 'Create, rename, and delete named subaccounts',
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
    [ACTION_TYPE_DEPOSIT]: 'Deposit',
    [ACTION_TYPE_WITHDRAW]: 'Withdraw',
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

// ============================================
// TOKEN METADATA CACHE — shared across panels
// ============================================
// Global in-memory cache: canisterId -> { symbol, name, decimals, fee }
const _tokenMetaCache = new Map();

/** Resolve a canister principal to token metadata. Uses cache, falls back to ICRC-1 metadata call. */
async function resolveTokenMeta(canisterId, identity) {
    const key = typeof canisterId === 'string' ? canisterId : canisterId?.toText?.() || String(canisterId);
    if (_tokenMetaCache.has(key)) return _tokenMetaCache.get(key);
    try {
        const actor = createLedgerActor(key, { agentOptions: { identity } });
        const metadata = await actor.icrc1_metadata();
        const info = { symbol: 'TOKEN', name: 'Unknown', decimals: 8, fee: 0n };
        for (const [k, v] of metadata) {
            if (k === 'icrc1:symbol' && 'Text' in v) info.symbol = v.Text;
            else if (k === 'icrc1:name' && 'Text' in v) info.name = v.Text;
            else if (k === 'icrc1:decimals' && 'Nat' in v) info.decimals = Number(v.Nat);
            else if (k === 'icrc1:fee' && 'Nat' in v) info.fee = v.Nat;
        }
        _tokenMetaCache.set(key, info);
        return info;
    } catch {
        const fallback = { symbol: key.slice(0, 5) + '...', name: key, decimals: 8, fee: 0n };
        _tokenMetaCache.set(key, fallback);
        return fallback;
    }
}

/** Store metadata from TokenSelector's onSelectToken callback into the cache. */
function cacheTokenMeta(tokenData) {
    if (!tokenData?.ledger_id) return;
    _tokenMetaCache.set(tokenData.ledger_id, {
        symbol: tokenData.symbol || 'TOKEN',
        name: tokenData.name || 'Unknown',
        decimals: tokenData.decimals ?? 8,
        fee: tokenData.fee ?? 0n,
    });
}

/**
 * Hook that resolves an array of canister IDs to metadata, returning a map.
 * Updates as each token resolves.
 */
function useTokenMetadata(canisterIds, identity) {
    const [meta, setMeta] = useState(() => {
        const m = {};
        for (const id of canisterIds) {
            const key = typeof id === 'string' ? id : id?.toText?.() || String(id);
            if (_tokenMetaCache.has(key)) m[key] = _tokenMetaCache.get(key);
        }
        return m;
    });
    const prevIdsRef = useRef('');

    useEffect(() => {
        const ids = canisterIds.map(id => typeof id === 'string' ? id : id?.toText?.() || String(id));
        const key = ids.sort().join(',');
        if (key === prevIdsRef.current) return;
        prevIdsRef.current = key;

        let mounted = true;
        const missing = ids.filter(id => !_tokenMetaCache.has(id));
        if (missing.length === 0) {
            // All cached
            const m = {};
            for (const id of ids) m[id] = _tokenMetaCache.get(id);
            setMeta(m);
            return;
        }
        // Resolve missing in parallel
        (async () => {
            await Promise.all(missing.map(id => resolveTokenMeta(id, identity)));
            if (!mounted) return;
            const m = {};
            for (const id of ids) m[id] = _tokenMetaCache.get(id) || { symbol: shortPrincipal(id), name: id, decimals: 8, fee: 0n };
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
    // Subaccount fields: number index into bot's named subaccounts ('' = not set)
    const [fSourceSubaccount, setFSourceSubaccount] = useState('');
    const [fTargetSubaccount, setFTargetSubaccount] = useState('');
    // Named subaccounts loaded from the bot
    const [subaccounts, setSubaccounts] = useState([]);
    // Price direction toggle: 'output_per_input' means "SNEED per ICP", 'input_per_output' means "ICP per SNEED"
    const [fPriceDirection, setFPriceDirection] = useState('input_per_output');
    // Denomination token state: null = native, otherwise a canister ID string
    const [fTradeSizeDenom, setFTradeSizeDenom] = useState('');
    const [fPriceDenom, setFPriceDenom] = useState('');
    const [fBalanceDenom, setFBalanceDenom] = useState('');

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

    // Load named subaccounts for Deposit/Withdraw selectors
    const loadSubaccounts = useCallback(async () => {
        try {
            const bot = await getReadyBotActor();
            if (bot?.getSubaccounts) {
                const subs = await bot.getSubaccounts();
                setSubaccounts(subs);
            }
        } catch (_) {}
    }, [getReadyBotActor]);
    useEffect(() => { loadSubaccounts(); }, [loadSubaccounts]);

    // Helper: extract optional Candid value
    const optVal = (arr) => arr?.length > 0 ? arr[0] : null;

    const principalToStr = (p) => typeof p === 'string' ? p : p?.toText?.() || String(p);

    const resetForm = () => {
        setFActionType(allowedTypes[0]); setFInputToken(''); setFOutputToken('');
        setFMinAmount(''); setFMaxAmount(''); setFAmountMode(0); setFBalancePercent('100');
        setFEnabled(true);
        setFMinBalance(''); setFMaxBalance(''); setFMinPrice(''); setFMaxPrice('');
        setFMaxPriceImpactBps(''); setFMaxSlippageBps(''); setFDestOwner('');
        setFSourceSubaccount(''); setFTargetSubaccount('');
        setFPriceDirection('input_per_output');
        setFTradeSizeDenom(''); setFPriceDenom(''); setFBalanceDenom('');
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
        setFSourceSubaccount(optVal(action.sourceSubaccount) != null ? String(Number(optVal(action.sourceSubaccount))) : '');
        setFTargetSubaccount(optVal(action.targetSubaccount) != null ? String(Number(optVal(action.targetSubaccount))) : '');
        // Auto-expand conditions if any condition fields are set
        const hasConditions = optVal(action.minBalance) != null || optVal(action.maxBalance) != null ||
            optVal(action.minPrice) != null || optVal(action.maxPrice) != null ||
            optVal(action.maxPriceImpactBps) != null || optVal(action.maxSlippageBps) != null ||
            bDenom || pDenom;
        setShowConditions(hasConditions);
        setFormMode({ id: Number(action.id) });
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
            actionType: BigInt(fActionType),
            enabled: fEnabled,
            inputToken: Principal.fromText(fInputToken),
            outputToken: fActionType === ACTION_TYPE_TRADE && fOutputToken ? [Principal.fromText(fOutputToken)] : [],
            minAmount: fMinAmount ? BigInt(parseTokenAmount(fMinAmount, amountDecimals)) : BigInt(0),
            maxAmount: fMaxAmount ? BigInt(parseTokenAmount(fMaxAmount, amountDecimals)) : BigInt(0),
            amountMode: BigInt(fAmountMode),
            balancePercent: fAmountMode === 1 ? [BigInt(Math.round(Number(fBalancePercent) * 100))] : [],
            preferredDex: [],
            sourceSubaccount: fSourceSubaccount !== '' ? [BigInt(fSourceSubaccount)] : [],
            targetSubaccount: fTargetSubaccount !== '' ? [BigInt(fTargetSubaccount)] : [],
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
                actionType: action.actionType,
                enabled: !action.enabled,
                inputToken: action.inputToken,
                outputToken: action.outputToken?.length > 0 ? action.outputToken : [],
                minAmount: action.minAmount,
                maxAmount: action.maxAmount,
                amountMode: action.amountMode ?? BigInt(0),
                balancePercent: action.balancePercent?.length > 0 ? action.balancePercent : [],
                preferredDex: action.preferredDex?.length > 0 ? action.preferredDex : [],
                sourceSubaccount: action.sourceSubaccount?.length > 0 ? action.sourceSubaccount : [],
                targetSubaccount: action.targetSubaccount?.length > 0 ? action.targetSubaccount : [],
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
                                onChange={setFOutputToken}
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
                        <label style={labelStyle}>{fAmountMode === 1 ? 'Min Amount (cap)' : 'Min Amount'}{amountSymLabel}</label>
                        <input value={fMinAmount} onChange={(e) => setFMinAmount(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="0.0" />
                    </div>
                    <div>
                        <label style={labelStyle}>{fAmountMode === 1 ? 'Max Amount (cap)' : 'Max Amount'}{amountSymLabel}</label>
                        <input value={fMaxAmount} onChange={(e) => setFMaxAmount(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="decimal" placeholder="0.0" />
                    </div>
                    {fActionType === ACTION_TYPE_TRADE && (
                        <div>
                            <label style={labelStyle}>Amount Denomination</label>
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
                    {/* Deposit: target subaccount selector */}
                    {fActionType === ACTION_TYPE_DEPOSIT && (
                        <div>
                            <label style={labelStyle}>Destination Subaccount</label>
                            <select value={fTargetSubaccount} onChange={(e) => setFTargetSubaccount(e.target.value)} style={{ ...inputStyle, width: '100%', appearance: 'auto' }}>
                                <option value="">— Select subaccount —</option>
                                {subaccounts.map(s => <option key={Number(s.number)} value={String(Number(s.number))}>{s.name} (#{Number(s.number)})</option>)}
                            </select>
                            {subaccounts.length === 0 && <div style={{ fontSize: '0.65rem', color: theme.colors.mutedText, marginTop: '2px' }}>No subaccounts yet. Create one in the Accounts tab.</div>}
                        </div>
                    )}
                    {/* Withdraw / Send: source subaccount selector */}
                    {(fActionType === ACTION_TYPE_WITHDRAW || fActionType === ACTION_TYPE_SEND) && (
                        <div>
                            <label style={labelStyle}>Source Subaccount</label>
                            <select value={fSourceSubaccount} onChange={(e) => setFSourceSubaccount(e.target.value)} style={{ ...inputStyle, width: '100%', appearance: 'auto' }}>
                                <option value="">Main Account</option>
                                {subaccounts.map(s => <option key={Number(s.number)} value={String(Number(s.number))}>{s.name} (#{Number(s.number)})</option>)}
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
                            </>)}
                        </div>
                    )}
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
                                                #{Number(action.id)} — {ACTION_TYPE_LABELS[Number(action.actionType)] || `Type ${Number(action.actionType)}`}
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
                                                    {Number(action.minAmount) > 0 && <div><strong>Min cap:</strong> {actTsDenom && hasCurrencySign(actTsDenom)
                                                        ? `${formatDenomAmount(Number(formatTokenAmount(action.minAmount, amtDec)), actTsDenom, amtSym)} of ${inputSym}`
                                                        : `${formatTokenAmount(action.minAmount, amtDec)} ${actTsDenom ? `${amtSym} of ${inputSym}` : inputSym}`}</div>}
                                                    {Number(action.maxAmount) > 0 && <div><strong>Max cap:</strong> {actTsDenom && hasCurrencySign(actTsDenom)
                                                        ? `${formatDenomAmount(Number(formatTokenAmount(action.maxAmount, amtDec)), actTsDenom, amtSym)} of ${inputSym}`
                                                        : `${formatTokenAmount(action.maxAmount, amtDec)} ${actTsDenom ? `${amtSym} of ${inputSym}` : inputSym}`}</div>}
                                                </>
                                            ) : (
                                                <>
                                                    <div><strong>Min:</strong> {actTsDenom && hasCurrencySign(actTsDenom)
                                                        ? `${formatDenomAmount(Number(formatTokenAmount(action.minAmount, amtDec)), actTsDenom, amtSym)} of ${inputSym}`
                                                        : `${formatTokenAmount(action.minAmount, amtDec)} ${actTsDenom ? `${amtSym} of ${inputSym}` : inputSym}`}</div>
                                                    <div><strong>Max:</strong> {actTsDenom && hasCurrencySign(actTsDenom)
                                                        ? `${formatDenomAmount(Number(formatTokenAmount(action.maxAmount, amtDec)), actTsDenom, amtSym)} of ${inputSym}`
                                                        : `${formatTokenAmount(action.maxAmount, amtDec)} ${actTsDenom ? `${amtSym} of ${inputSym}` : inputSym}`}</div>
                                                </>
                                            )}
                                            {optVal(action.destinationOwner) && <div><strong>Dest:</strong> {shortPrincipal(optVal(action.destinationOwner))}</div>}
                                            {optVal(action.targetSubaccount) != null && (() => {
                                                const sub = subaccounts.find(s => Number(s.number) === Number(optVal(action.targetSubaccount)));
                                                return <div><strong>To Sub:</strong> {sub ? `${sub.name} (#${Number(sub.number)})` : `#${Number(optVal(action.targetSubaccount))}`}</div>;
                                            })()}
                                            {optVal(action.sourceSubaccount) != null && (() => {
                                                const sub = subaccounts.find(s => Number(s.number) === Number(optVal(action.sourceSubaccount)));
                                                return <div><strong>From Sub:</strong> {sub ? `${sub.name} (#${Number(sub.number)})` : `#${Number(optVal(action.sourceSubaccount))}`}</div>;
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
                                            {action.lastExecutedAt?.length > 0 && (
                                                <div><strong>Last run:</strong> {new Date(Number(action.lastExecutedAt[0]) / 1_000_000).toLocaleString()}</div>
                                            )}
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

    // Resolve token metadata for all target tokens + denomination token
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
        return [...ids];
    }, [targets, settings]);
    const tokenMeta = useTokenMetadata(allTokenIds, identity);

    const getTokenLabel = (principal) => {
        const key = typeof principal === 'string' ? principal : principal?.toText?.() || String(principal);
        const m = tokenMeta[key];
        return m ? `${m.symbol} (${m.name})` : shortPrincipal(key);
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

    // --- Frontend-only balance fetching (direct to ledger canisters) ---
    const fetchBalances = useCallback(async () => {
        if (!canisterId || targetTokenIds.length === 0) return;
        const key = `${canisterId}:${targetTokenIds.join(',')}`;
        if (key === balanceFetchRef.current && Object.keys(tokenBalances).length > 0) return;
        balanceFetchRef.current = key;
        setBalancesLoading(true);
        try {
            const { HttpAgent } = await import('@dfinity/agent');
            const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';
            const agent = HttpAgent.createSync({ identity, host });
            if (isLocal) await agent.fetchRootKey();
            const botPrincipal = Principal.fromText(canisterId);
            const results = {};
            await Promise.all(targetTokenIds.map(async (tid) => {
                try {
                    const ledgerActor = createLedgerActor(tid, { agent });
                    const bal = await ledgerActor.icrc1_balance_of({ owner: botPrincipal, subaccount: [] });
                    results[tid] = BigInt(bal);
                } catch (_) { results[tid] = 0n; }
            }));
            setTokenBalances(results);
        } catch (e) { console.warn('Failed to fetch rebalance balances:', e); }
        finally { setBalancesLoading(false); }
    }, [canisterId, targetTokenIds, identity]);

    // --- Frontend-only price fetching (via PriceService) ---
    const fetchPrices = useCallback(async () => {
        if (!denomKey || targetTokenIds.length === 0) return;
        const key = `${denomKey}:${targetTokenIds.join(',')}`;
        if (key === priceFetchRef.current && Object.keys(denomPrices).length > 0) return;
        priceFetchRef.current = key;
        setPricesLoading(true);
        try {
            const decFor = (id) => tokenMeta[id]?.decimals ?? 8;
            // Set decimals in PriceService
            for (const tid of targetTokenIds) priceService.setTokenDecimals(tid, decFor(tid));
            if (denomKey !== ICP_LEDGER) priceService.setTokenDecimals(denomKey, decFor(denomKey));

            const getIcpPrice = async (tid) => {
                if (tid === ICP_LEDGER) return 1;
                const fiatPeg = FIAT_USD_PEG[tid];
                if (fiatPeg != null) {
                    const icpUsd = await priceService.getICPUSDPrice();
                    if (icpUsd > 0) return fiatPeg / icpUsd;
                    return null;
                }
                return await priceService.getTokenICPPrice(tid, decFor(tid));
            };

            const [tokenResults, denomIcpPriceRaw] = await Promise.all([
                Promise.all(targetTokenIds.map(async (tid) => {
                    try { return { tid, icpPrice: await getIcpPrice(tid) }; }
                    catch (_) { return { tid, icpPrice: null }; }
                })),
                denomKey !== ICP_LEDGER ? getIcpPrice(denomKey).catch(() => null) : Promise.resolve(1),
            ]);
            const denomIcpPrice = (denomIcpPriceRaw != null && isFinite(denomIcpPriceRaw) && denomIcpPriceRaw > 0) ? denomIcpPriceRaw : null;
            const prices = {};
            for (const { tid, icpPrice } of tokenResults) {
                if (tid === denomKey) { prices[tid] = 1; continue; }
                if (icpPrice != null && denomIcpPrice != null) {
                    prices[tid] = icpPrice / denomIcpPrice;
                } else { prices[tid] = null; }
            }
            setDenomPrices(prices);
        } catch (e) { console.warn('Failed to fetch rebalance prices:', e); }
        finally { setPricesLoading(false); }
    }, [denomKey, targetTokenIds, tokenMeta]);

    // Auto-fetch balances + prices when targets are known
    useEffect(() => { if (targetTokenIds.length > 0 && canisterId) fetchBalances(); }, [fetchBalances]);
    useEffect(() => { if (targetTokenIds.length > 0 && denomKey) fetchPrices(); }, [fetchPrices]);

    // Auto-refresh every 30s
    useEffect(() => {
        if (targetTokenIds.length === 0 || !canisterId) return;
        refreshTimerRef.current = setInterval(() => {
            balanceFetchRef.current = ''; // force re-fetch
            priceFetchRef.current = '';
            fetchBalances();
            fetchPrices();
        }, 30_000);
        return () => clearInterval(refreshTimerRef.current);
    }, [fetchBalances, fetchPrices, targetTokenIds, canisterId]);

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
            return { label: getSymbol(tid), value: Number(t.targetBps), color: CHART_COLORS[i % CHART_COLORS.length] };
        }),
    [targets, tokenMeta]);

    // Chart segments — live editing preview
    const editingTargetSegments = React.useMemo(() => {
        if (!editingTargets) return null;
        return editingTargets.map((t, i) => ({
            label: t.token ? getSymbol(t.token) : `Token ${i + 1}`,
            value: Math.max(0, (parseFloat(t.targetBps) || 0) * 100),
            color: CHART_COLORS[i % CHART_COLORS.length],
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
        return portfolioStatus.tokens.map((tok, i) => ({
            label: tok.symbol, value: tok.currentBps, color: CHART_COLORS[i % CHART_COLORS.length],
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
                                                    <span style={{ flex: 1, fontSize: '0.78rem', color: theme.colors.primaryText, fontWeight: '500' }}>{getTokenLabel(ft)}</span>
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
                                                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
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
                                                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
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
                                                        style={{ flex: 1, accentColor: CHART_COLORS[i % CHART_COLORS.length], cursor: t.locked ? 'not-allowed' : 'pointer', height: '6px', opacity: t.locked ? 0.5 : 1 }}
                                                    />
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                                        <input
                                                            value={t.targetBps}
                                                            onChange={(e) => {
                                                                if (t.locked) return;
                                                                const v = e.target.value;
                                                                const num = parseFloat(v);
                                                                if (!isNaN(num) && v.trim() !== '' && num >= 0 && num <= 100) {
                                                                    setLinkedTarget(i, num);
                                                                } else {
                                                                    const arr = [...editingTargets]; arr[i] = { ...arr[i], targetBps: v }; setEditingTargets(arr);
                                                                }
                                                            }}
                                                            onBlur={() => {
                                                                if (t.locked) return;
                                                                const num = parseFloat(editingTargets[i].targetBps);
                                                                if (!isNaN(num)) setLinkedTarget(i, Math.max(0, Math.min(100, num)));
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
                                                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
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

    // New list form
    const [newName, setNewName] = useState('');
    const [newLedger, setNewLedger] = useState('');
    const [newThreshold, setNewThreshold] = useState('0');
    const [newMaxDist, setNewMaxDist] = useState('0');
    const [newSourceSub, setNewSourceSub] = useState('');

    const loadLists = useCallback(async () => {
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const result = await bot.getDistributionLists(instanceId);
            setLists(result);
        } catch (err) { setError('Failed to load distribution lists: ' + err.message); }
        finally { setLoading(false); }
    }, [getReadyBotActor, instanceId]);

    useEffect(() => { loadLists(); }, [loadLists]);

    const loadSubaccounts = useCallback(async () => {
        try {
            const bot = await getReadyBotActor();
            if (bot?.getSubaccounts) {
                const subs = await bot.getSubaccounts();
                setSubaccounts(subs);
            }
        } catch (_) {}
    }, [getReadyBotActor]);
    useEffect(() => { loadSubaccounts(); }, [loadSubaccounts]);

    const subaccountBlobFromNumber = (num) => {
        const bytes = new Uint8Array(32);
        let n = BigInt(num);
        for (let i = 31; i >= 0; i--) {
            bytes[i] = Number(n & 0xFFn);
            n >>= 8n;
        }
        return [...bytes];
    };

    const resolveSubaccountName = (sourceSubBlob) => {
        if (!sourceSubBlob || sourceSubBlob.length === 0) return 'Main Account';
        const blob = sourceSubBlob[0];
        if (!blob || blob.length === 0) return 'Main Account';
        const bytes = Array.from(blob);
        if (bytes.every(b => b === 0)) return 'Main Account';
        const match = subaccounts.find(s => {
            const sBytes = Array.from(s.subaccount || []);
            return sBytes.length === bytes.length && sBytes.every((b, i) => b === bytes[i]);
        });
        return match ? `${match.name} (#${Number(match.number)})` : 'Custom Subaccount';
    };

    const handleAdd = async () => {
        if (!newName.trim()) { setError('Name is required.'); return; }
        if (!newLedger.trim()) { setError('Token ledger canister ID is required.'); return; }
        setSaving(true); setError(''); setSuccess('');
        try {
            const bot = await getReadyBotActor();
            const sourceSubBlob = newSourceSub ? [subaccountBlobFromNumber(newSourceSub)] : [];
            await bot.addDistributionList(instanceId, {
                name: newName.trim(),
                sourceSubaccount: sourceSubBlob,
                tokenLedgerCanisterId: Principal.fromText(newLedger.trim()),
                thresholdAmount: BigInt(newThreshold || 0),
                maxDistributionAmount: BigInt(newMaxDist || 0),
                targets: [],
            });
            setSuccess('Distribution list added.');
            setAdding(false); setNewName(''); setNewLedger(''); setNewThreshold('0'); setNewMaxDist('0'); setNewSourceSub('');
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

    // Resolve token metadata for ledger tokens in distribution lists
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

    return (
        <div style={cardStyle}>
            <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>Distribution Lists</h3>
            <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5' }}>
                Configure percentage-based distribution lists to automatically split and send funds to multiple recipients.
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

                    {lists.map((list) => (
                        <div key={Number(list.id)} style={{
                            padding: '12px', marginBottom: '8px',
                            background: theme.colors.primaryBg, borderRadius: '8px',
                            border: `1px solid ${theme.colors.border}`,
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                <div>
                                    <span style={{ fontSize: '0.85rem', fontWeight: '600', color: theme.colors.primaryText }}>{list.name}</span>
                                    <span style={{ marginLeft: '8px', fontSize: '0.7rem', color: theme.colors.secondaryText }}>#{Number(list.id)}</span>
                                </div>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <button onClick={() => setExpandedList(expandedList === Number(list.id) ? null : Number(list.id))}
                                        style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px' }}>
                                        {expandedList === Number(list.id) ? 'Collapse' : 'Details'}
                                    </button>
                                    <button onClick={() => handleRemove(Number(list.id))} disabled={saving}
                                        style={{ ...secondaryButtonStyle, fontSize: '0.7rem', padding: '3px 8px', color: '#ef4444', borderColor: '#ef444440' }}>
                                        <FaTrash style={{ fontSize: '0.6rem' }} />
                                    </button>
                                </div>
                            </div>
                            <div style={{ marginTop: '6px', fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                                <span>Token: {getDistTokenSymbol(list.tokenLedgerCanisterId)}</span>
                                <span>From: {resolveSubaccountName(list.sourceSubaccount)}</span>
                                <span>Threshold: {Number(list.thresholdAmount).toLocaleString()}</span>
                                <span>Max: {Number(list.maxDistributionAmount).toLocaleString()}</span>
                                <span>Targets: {list.targets.length}</span>
                            </div>
                            {expandedList === Number(list.id) && list.targets.length > 0 && (
                                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${theme.colors.border}` }}>
                                    {list.targets.map((target, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.75rem' }}>
                                            <span style={{ color: theme.colors.primaryText, fontFamily: 'monospace' }}>
                                                {shortPrincipal(target.account.owner)}
                                            </span>
                                            <span style={{ color: accentColor, fontWeight: '500' }}>
                                                {target.basisPoints?.length > 0 ? `${(Number(target.basisPoints[0]) / 100).toFixed(1)}%` : 'Auto-split'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}

                    {/* Add Distribution List Form */}
                    {adding ? (
                        <div style={{ padding: '14px', background: `${accentColor}06`, borderRadius: '8px', border: `1px solid ${accentColor}20`, marginTop: '10px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                                <div>
                                    <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Name</label>
                                    <input value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, width: '100%' }} placeholder="e.g. Revenue Share" />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Token Ledger</label>
                                    <TokenSelector
                                        value={newLedger}
                                        onChange={setNewLedger}
                                        onSelectToken={cacheTokenMeta}
                                        allowCustom={true}
                                        placeholder="Select token..."
                                    />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Source Subaccount</label>
                                    <select value={newSourceSub} onChange={(e) => setNewSourceSub(e.target.value)} style={{ ...inputStyle, width: '100%', appearance: 'auto' }}>
                                        <option value="">Main Account</option>
                                        {subaccounts.map(s => <option key={Number(s.number)} value={String(Number(s.number))}>{s.name} (#{Number(s.number)})</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Threshold Amount</label>
                                    <input value={newThreshold} onChange={(e) => setNewThreshold(e.target.value)} style={{ ...inputStyle, width: '100%' }} type="text" inputMode="numeric" />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Max Distribution Amount</label>
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
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [stats, setStats] = useState(null);
    const [query, setQuery] = useState({ startId: [], limit: [50], choreId: [], choreTypeId: [], actionType: [], inputToken: [], outputToken: [], status: [], fromTime: [], toTime: [] });
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

    // Load trade entries + batch-fetch all related snapshots
    const loadData = useCallback(async (q) => {
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const [result, st] = await Promise.all([
                bot.getTradeLog(q || query),
                bot.getTradeLogStats(),
            ]);
            setEntries(result.entries);
            setHasMore(result.hasMore);
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
    }, [getReadyBotActor, query]);

    useEffect(() => { loadData(); }, [loadData]);

    const applyFilters = () => {
        const q = {
            startId: [], limit: [50],
            choreId: [], choreTypeId: filterChoreType ? [filterChoreType] : [],
            actionType: [], inputToken: [], outputToken: [],
            status: filterStatus ? [{ [filterStatus]: null }] : [],
            fromTime: [], toTime: [],
        };
        setQuery(q);
        setLoading(true);
        setSnapMap({});
        loadData(q);
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
                if (!tokenMap.has(tid)) tokenMap.set(tid, { symbol: t.symbol, decimals: Number(t.decimals) });
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
                        onClick={() => { setLoading(true); setSnapMap({}); loadData(); }}
                        disabled={loading}
                        title="Refresh"
                        style={{ background: 'none', border: 'none', cursor: loading ? 'default' : 'pointer', color: accentColor, padding: '2px', display: 'flex', alignItems: 'center', opacity: loading ? 0.5 : 1 }}
                    >
                        <FaSyncAlt style={{ fontSize: '0.75rem', animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                    </button>
                </div>
                {stats && <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>{Number(stats.totalEntries)} entries</span>}
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
                    {[...entries].sort((a, b) => Number(b.id) - Number(a.id)).map((e) => {
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
                                    ) : (
                                        <>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <strong>In:</strong> <TokenIcon canisterId={toStr(e.inputToken)} size={16} /> {formatTokenAmount(e.inputAmount, inputDec)} {inSym}
                                            </div>
                                            {e.outputToken?.length > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <strong>Out:</strong> <TokenIcon canisterId={toStr(e.outputToken[0])} size={16} /> {optVal(e.outputAmount) != null ? formatTokenAmount(optVal(e.outputAmount), outputDec) : '—'} {outSym}
                                            </div>}
                                        </>
                                    )}
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
                    {hasMore && (
                        <button onClick={() => {
                            const lastId = entries[entries.length - 1]?.id;
                            const nextQ = { ...query, startId: lastId != null ? [Number(lastId) + 1] : [] };
                            setQuery(nextQ); setLoading(true); loadData(nextQ);
                        }} style={{ ...inputStyle, cursor: 'pointer', textAlign: 'center', marginTop: '4px', background: `${accentColor}10`, color: accentColor, fontWeight: '500', border: `1px solid ${accentColor}30` }}>Load More...</button>
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
    const [subaccounts, setSubaccounts] = useState([]);

    const resolveSubaccountLabel = useCallback((subBlob) => {
        if (!subBlob || subBlob.length === 0) return null;
        const blob = subBlob[0];
        if (!blob || blob.length === 0) return null;
        const bytes = Array.from(blob);
        if (bytes.every(b => b === 0)) return null;
        const match = subaccounts.find(s => {
            const sBytes = Array.from(s.subaccount || []);
            return sBytes.length === bytes.length && sBytes.every((b, i) => b === bytes[i]);
        });
        return match ? `${match.name} (#${Number(match.number)})` : 'Subaccount';
    }, [subaccounts]);

    const loadData = useCallback(async () => {
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const [result, st, subs] = await Promise.all([
                bot.getPortfolioSnapshots({ startId: [], limit: [100], tradeLogId: [], phase: [], fromTime: [], toTime: [] }),
                bot.getPortfolioSnapshotStats(),
                bot.getSubaccounts ? bot.getSubaccounts() : [],
            ]);
            setSnapshots(result.entries);
            setHasMore(result.hasMore);
            setStats(st);
            setSubaccounts(subs);
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
        const subLabel = resolveSubaccountLabel((before || after)?.subaccount);

        // Merge tokens from both snapshots
        const tokenMap = new Map();
        const addTokens = (snap, phase) => {
            if (!snap?.tokens) return;
            for (const t of snap.tokens) {
                const tid = typeof t.token === 'string' ? t.token : t.token?.toText?.() || String(t.token);
                if (!tokenMap.has(tid)) tokenMap.set(tid, { symbol: t.symbol, decimals: Number(t.decimals) });
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
                        {subLabel && <span style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: '500',
                            background: '#8b5cf620', color: '#8b5cf6',
                        }}>{subLabel}</span>}
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
        const subLabel = resolveSubaccountLabel(snap.subaccount);

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
                        {subLabel && <span style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: '500',
                            background: '#8b5cf620', color: '#8b5cf6',
                        }}>{subLabel}</span>}
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
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: '0.78rem', color: theme.colors.secondaryText }}>Max entries: {Number(settings.maxTradeLogEntries).toLocaleString()}</span>
                                <button disabled={saving} onClick={() => handleToggleMaster('tradeLogEnabled')} style={toggleBtnStyle(settings.tradeLogEnabled)}>
                                    {settings.tradeLogEnabled ? 'ON' : 'OFF'}
                                </button>
                            </div>
                        </div>
                        <div style={{ padding: '12px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                            <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '6px' }}>Portfolio Snapshots</div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: '0.78rem', color: theme.colors.secondaryText }}>Max entries: {Number(settings.maxPortfolioLogEntries).toLocaleString()}</span>
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

function DraggableTokenChip({ tid, index, symbol, showRemove, onRemove, onReorder, theme, borderColor }) {
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

    return (
        <div ref={ref} style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            padding: '3px 8px', borderRadius: '6px', background: theme.colors.primaryBg,
            border: `1px solid ${isOver ? theme.colors.accentColor || '#10b981' : borderColor}`,
            fontSize: '0.75rem', color: theme.colors.primaryText,
            opacity: isDragging ? 0.4 : 1, cursor: 'grab',
            transition: 'border-color 0.15s',
        }}>
            <FaGripVertical style={{ fontSize: '0.55rem', color: theme.colors.mutedText, flexShrink: 0 }} />
            <TokenIcon canisterId={tid} size={14} />
            <span>{symbol}</span>
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

    // Load subaccounts + token registry only (fast query calls, no inter-canister)
    const loadData = useCallback(async () => {
        try {
            const bot = await getReadyBotActor();
            const [subs, registry] = await Promise.all([
                bot.getSubaccounts ? bot.getSubaccounts() : [],
                bot.getTokenRegistry ? bot.getTokenRegistry() : [],
            ]);
            setSubaccounts(subs);
            setTokenRegistry(registry);
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
                            if (BigInt(balance) > 0n) {
                                accumulated[job.acc.number].balances.push({ token: job.tid, balance: BigInt(balance) });
                            }
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

    // Fetch denomination prices using frontend-only PriceService (fast, cached)
    // Uses two-hop via ICP: get each token's ICP price + denom token's ICP price, then divide.
    // tokenMeta provides accurate decimals for any token we've seen.
    const denomCacheKeyRef = useRef('');
    useEffect(() => {
        if (!denomToken || tokenRegistry.length === 0) { setDenomPrices({}); return; }
        // Stable key: denom + sorted token IDs + denomination decimals (so we re-fetch if metadata loads)
        const ids = tokenRegistry.map(t => typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId)).sort().join(',');
        const denomDec = tokenMeta[denomToken]?.decimals;
        const cacheKey = `${denomToken}:${ids}:d${denomDec ?? '?'}`;
        if (cacheKey === denomCacheKeyRef.current) return;
        denomCacheKeyRef.current = cacheKey;
        let cancelled = false;
        setLoadingPrices(true);
        (async () => {
            try {
                // Build a decimals lookup from registry + tokenMeta (tokenMeta is authoritative)
                const decFor = (id) => {
                    const meta = tokenMeta[id];
                    if (meta?.decimals != null) return Number(meta.decimals);
                    const regEntry = tokenRegistry.find(t => {
                        const k = typeof t.ledgerCanisterId === 'string' ? t.ledgerCanisterId : t.ledgerCanisterId?.toText?.() || String(t.ledgerCanisterId);
                        return k === id;
                    });
                    if (regEntry?.decimals != null) return Number(regEntry.decimals);
                    return 8; // safe default
                };

                const tokenIds = ids.split(',');
                // Set decimals in PriceService for all tokens we'll query
                for (const tid of tokenIds) {
                    priceService.setTokenDecimals(tid, decFor(tid));
                }
                if (denomToken && denomToken !== ICP_LEDGER) {
                    priceService.setTokenDecimals(denomToken, decFor(denomToken));
                }

                // Helper: get a token's ICP price, using fiat-peg derivation for stablecoins
                // (avoids relying on potentially illiquid/nonexistent individual token/ICP pools)
                const getIcpPrice = async (tid, dec) => {
                    if (tid === ICP_LEDGER) return 1;
                    const fiatPeg = FIAT_USD_PEG[tid];
                    if (fiatPeg != null) {
                        // Derive from the liquid ICP/USDC pool: tokenIcpPrice = fiatUsdPeg / icpUsdPrice
                        const icpUsd = await priceService.getICPUSDPrice();
                        if (icpUsd > 0) return fiatPeg / icpUsd;
                        return null;
                    }
                    return await priceService.getTokenICPPrice(tid, dec);
                };

                // Fetch all token->ICP prices in parallel
                const icpPricePromises = tokenIds.map(async (tid) => {
                    try {
                        const p = await getIcpPrice(tid, decFor(tid));
                        return { tid, icpPrice: p };
                    } catch (_) { return { tid, icpPrice: null }; }
                });
                // Fetch denomination token -> ICP price
                let denomIcpPrice = 1;
                if (denomToken !== ICP_LEDGER) {
                    try {
                        denomIcpPrice = await getIcpPrice(denomToken, decFor(denomToken));
                    } catch (_) { denomIcpPrice = null; }
                }
                const results = await Promise.all(icpPricePromises);
                if (cancelled) return;
                // Sanity-check denom price
                if (denomIcpPrice != null && (denomIcpPrice <= 0 || !isFinite(denomIcpPrice))) {
                    denomIcpPrice = null;
                }
                const prices = {};
                for (const { tid, icpPrice } of results) {
                    if (tid === denomToken) { prices[tid] = 1; continue; }
                    if (icpPrice != null && denomIcpPrice != null && denomIcpPrice > 0) {
                        prices[tid] = icpPrice / denomIcpPrice;
                    } else {
                        prices[tid] = null;
                    }
                }
                if (!cancelled) setDenomPrices(prices);
            } catch (e) { console.warn('Failed to fetch denom prices:', e); }
            finally { if (!cancelled) setLoadingPrices(false); }
        })();
        return () => { cancelled = true; };
    }, [denomToken, tokenRegistry, tokenMeta]); // tokenMeta included for accurate decimals

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
                                    symbol={t.symbol || getSymbol(tid)}
                                    showRemove={showTokenManager}
                                    onRemove={() => handleRemoveToken(tid)}
                                    onReorder={handleReorderTokens}
                                    theme={theme}
                                    borderColor={borderColor}
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
                    const pieSegments = hasAnyDenomValue ? rows.filter(r => r.denomValue != null && r.denomValue > 0).map((r, i) => ({
                        label: getSymbol(r.tid), value: r.denomValue, color: CHART_COLORS[i % CHART_COLORS.length],
                    })) : [];

                    const colCount = denomToken ? 4 : 2;

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
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(({ tid, dec, balance, denomValue, price }) => (
                                        <tr key={tid} style={{ borderTop: `1px solid ${borderColor}20` }}>
                                            <td style={{ padding: '5px 8px', color: theme.colors.primaryText }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <TokenIcon canisterId={tid} size={18} />
                                                    {getSymbol(tid)}
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
                                        </tr>
                                    ))}
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
function PerformancePanel({ getReadyBotActor, theme, accentColor }) {
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
    const [subaccounts, setSubaccounts] = useState([]);
    const [selectedSubaccount, setSelectedSubaccount] = useState('main'); // 'main' or 'all' or subaccount blob key

    const loadData = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const bot = await getReadyBotActor();
            if (!bot) return;
            const [snapResult, flows, registry, prices, history, dailyPortfolio, dailyPrices, subs] = await Promise.all([
                bot.getPortfolioSnapshots({ startId: [], limit: [500], tradeLogId: [], phase: [{ After: null }], fromTime: [], toTime: [] }),
                bot.getCapitalFlows(),
                bot.getTokenRegistry ? bot.getTokenRegistry() : Promise.resolve([]),
                bot.getLastKnownPrices ? bot.getLastKnownPrices() : Promise.resolve([]),
                bot.getPriceHistory ? bot.getPriceHistory({ pairKey: [], limit: [5000], offset: [] }) : Promise.resolve({ entries: [], totalCount: 0n }),
                bot.getDailyPortfolioSummaries ? bot.getDailyPortfolioSummaries({ fromDate: [], toDate: [], subaccount: [], limit: [1000], offset: [] }) : Promise.resolve({ entries: [], totalCount: 0n }),
                bot.getDailyPriceCandles ? bot.getDailyPriceCandles({ pairKey: [], fromDate: [], toDate: [], limit: [1000], offset: [] }) : Promise.resolve({ entries: [], totalCount: 0n }),
                bot.getSubaccounts ? bot.getSubaccounts() : Promise.resolve([]),
            ]);
            setSnapshots(snapResult.entries);
            setCapitalFlows(flows);
            setTokenRegistry(registry);
            setLastKnownPrices(prices);
            setPriceHistory(history.entries);
            setDailyPortfolioSummaries(dailyPortfolio.entries || []);
            setDailyPriceCandles(dailyPrices.entries || []);
            setSubaccounts(subs);
        } catch (err) {
            setError('Failed to load performance data: ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [getReadyBotActor]);

    useEffect(() => { loadData(); }, [loadData]);

    const optVal = (arr) => (arr?.length > 0 ? arr[0] : null);

    // Build chart data from After-phase snapshots (detailed view)
    const chartData = React.useMemo(() => {
        return snapshots
            .filter(s => Object.keys(s.phase || {})[0] === 'After')
            .filter(s => {
                // Filter by selected subaccount
                const sub = s.subaccount?.length > 0 ? s.subaccount[0] : null;
                if (selectedSubaccount === 'all') return true;
                if (selectedSubaccount === 'main') return !sub || (sub && Array.from(sub).every(b => b === 0));
                return false;
            })
            .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
            .map(s => {
                const ts = Number(s.timestamp) / 1_000_000; // ns -> ms
                const icpVal = optVal(s.totalValueIcpE8s);
                const usdVal = optVal(s.totalValueUsdE8s);
                return {
                    time: ts,
                    label: new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
                    icp: icpVal != null ? Number(icpVal) / 1e8 : null,
                    usd: usdVal != null ? Number(usdVal) / 1e6 : null,
                };
            })
            .filter(d => (denomination === 'icp' ? d.icp != null : d.usd != null));
    }, [snapshots, denomination, selectedSubaccount]);

    // Build daily OHLC chart data for portfolio value
    const dailyChartData = React.useMemo(() => {
        return dailyPortfolioSummaries
            .filter(s => {
                const sub = s.subaccount?.length > 0 ? s.subaccount[0] : null;
                if (selectedSubaccount === 'all') return true;
                if (selectedSubaccount === 'main') return !sub || (sub && Array.from(sub).every(b => b === 0));
                return false;
            })
            .sort((a, b) => Number(a.date) - Number(b.date))
            .map(s => {
                const ts = Number(s.date) / 1_000_000; // ns -> ms
                const scale = denomination === 'icp' ? 1e8 : 1e6;
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
    }, [dailyPortfolioSummaries, denomination, selectedSubaccount]);

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

    // Available subaccount options for the equity curve
    const subaccountOptions = React.useMemo(() => {
        const opts = [{ value: 'main', label: 'Main Account' }, { value: 'all', label: 'All Accounts' }];
        for (const s of subaccounts) {
            opts.push({ value: 'sub-' + Number(s.number), label: `${s.name} (#${Number(s.number)})` });
        }
        return opts;
    }, [subaccounts]);

    // Latest portfolio value
    const latestSnap = chartData.length > 0 ? chartData[chartData.length - 1] : null;
    const latestValueIcp = latestSnap?.icp;
    const latestValueUsd = latestSnap?.usd;

    // Capital deployed
    const capitalIcp = capitalFlows ? Number(capitalFlows.capitalDeployedIcpE8s) / 1e8 : null;
    const capitalUsd = capitalFlows ? Number(capitalFlows.capitalDeployedUsdE8s) / 1e6 : null;

    // Trading P&L
    const pnlIcp = (latestValueIcp != null && capitalIcp != null) ? latestValueIcp - capitalIcp : null;
    const pnlUsd = (latestValueUsd != null && capitalUsd != null) ? latestValueUsd - capitalUsd : null;
    const pnlPctIcp = (pnlIcp != null && capitalIcp && capitalIcp !== 0) ? (pnlIcp / Math.abs(capitalIcp)) * 100 : null;
    const pnlPctUsd = (pnlUsd != null && capitalUsd && capitalUsd !== 0) ? (pnlUsd / Math.abs(capitalUsd)) * 100 : null;

    // Resolve token symbol from registry
    const tokenSymbol = (principalText) => {
        const entry = tokenRegistry.find(t => (t.ledgerCanisterId?.toText?.() || t.ledgerCanisterId?.toString?.() || '') === principalText);
        return entry?.symbol || principalText.slice(0, 10) + '...';
    };
    const tokenDecimals = (principalText) => {
        const entry = tokenRegistry.find(t => (t.ledgerCanisterId?.toText?.() || t.ledgerCanisterId?.toString?.() || '') === principalText);
        return entry?.decimals != null ? Number(entry.decimals) : 8;
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

    return (
        <div>
            {/* P&L Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                {/* Portfolio Value */}
                <div style={cardStyle}>
                    <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Portfolio Value</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: '700', color: theme.colors.text }}>
                        {formatNum(latestValueIcp, 'icp')}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText }}>
                        {formatNum(latestValueUsd, 'usd')}
                    </div>
                </div>
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
            </div>

            {/* Equity Curve Chart */}
            <div style={{ ...cardStyle, padding: '16px 12px 8px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', paddingLeft: '16px', flexWrap: 'wrap', gap: '8px' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: '600', color: theme.colors.text }}>Equity Curve</span>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {subaccountOptions.length > 2 && (
                            <select value={selectedSubaccount} onChange={e => setSelectedSubaccount(e.target.value)} style={{
                                padding: '3px 8px', fontSize: '0.72rem', borderRadius: '4px',
                                border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg,
                                color: theme.colors.text, marginRight: '4px', appearance: 'auto',
                            }}>
                                {subaccountOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        )}
                        {['detailed', 'daily'].map(v => (
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
                                    formatter={(v) => [denomination === 'usd' ? '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 }) : Number(v).toLocaleString(undefined, { minimumFractionDigits: 4 }) + ' ICP', 'Portfolio Value']}
                                />
                                <Area type="monotone" dataKey={denomination} stroke={accentColor} fill="url(#equityGrad)" strokeWidth={2} dot={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ textAlign: 'center', padding: '40px 20px', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>
                            {chartData.length === 0 ? 'No snapshot data yet. Equity curve will appear after the bot runs and takes portfolio snapshots.' : 'At least 2 snapshots are needed to draw the equity curve.'}
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

            {/* Per-Token Capital Flows */}
            {capitalFlows?.perToken?.length > 0 && (
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
                selectedPricepair={selectedPricepair}
                setSelectedPricePair={setSelectedPricePair}
                theme={theme}
                accentColor={accentColor}
                cardStyle={cardStyle}
            />
        </div>
    );
}

function PriceHistorySection({ lastKnownPrices, priceHistory, dailyPriceCandleData, tokenRegistry, selectedPricepair, setSelectedPricePair, theme, accentColor, cardStyle }) {
    const [priceView, setPriceView] = useState('detailed'); // 'detailed' or 'daily'
    // Resolve token symbol from principal text
    const sym = (principalText) => {
        const entry = tokenRegistry.find(t => (t.ledgerCanisterId?.toText?.() || t.ledgerCanisterId?.toString?.() || '') === principalText);
        return entry?.symbol || principalText.slice(0, 8) + '..';
    };

    // Build pair options from lastKnownPrices
    const pairOptions = React.useMemo(() => {
        return lastKnownPrices.map(([key, cached]) => {
            const inpText = cached.inputToken?.toText?.() || cached.inputToken?.toString?.() || '';
            const outText = cached.outputToken?.toText?.() || cached.outputToken?.toString?.() || '';
            return { key, inputSymbol: sym(inpText), outputSymbol: sym(outText), inputPrincipal: inpText, outputPrincipal: outText, cached };
        }).sort((a, b) => (a.inputSymbol + a.outputSymbol).localeCompare(b.inputSymbol + b.outputSymbol));
    }, [lastKnownPrices, tokenRegistry]);

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

    // Build chart data for the selected pair
    const chartData = React.useMemo(() => {
        if (!activePair) return [];
        const entries = historyByPair.get(activePair) || [];
        // Also append the current lastKnown price for this pair
        const currentEntry = lastKnownPrices.find(([k]) => k === activePair);
        const allEntries = currentEntry ? [...entries, currentEntry[1]] : entries;

        return allEntries.map(entry => {
            const ts = Number(entry.fetchedAt) / 1_000_000; // ns -> ms
            const q = entry.quote;
            const inputAmt = Number(q.inputAmount);
            const outputAmt = Number(q.expectedOutput);
            // Price: how much output per 1 unit of input
            const price = inputAmt > 0 ? outputAmt / inputAmt : 0;
            // Spot price from the quote
            const spotPrice = Number(q.spotPriceE8s) / 1e8;
            return {
                time: ts,
                label: new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
                price: price,
                spotPrice: spotPrice > 0 ? spotPrice : null,
            };
        });
    }, [activePair, historyByPair, lastKnownPrices]);

    // Get the pair info for display
    const activePairInfo = pairOptions.find(p => p.key === activePair);

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
// Trading Bot Logs Section (combines trade log, portfolio snapshots, logging settings)
// ============================================
function TradingBotLogs({ canisterId, createBotActorFn, theme, accentColor, identity }) {
    const [activeTab, setActiveTab] = useState('accounts');
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

    const tabStyle = (active) => ({
        padding: '6px 16px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: '500',
        borderBottom: `2px solid ${active ? accentColor : 'transparent'}`,
        color: active ? accentColor : theme.colors.secondaryText,
        background: 'none', border: 'none', borderRadius: 0,
    });

    return (
        <div style={{ marginTop: '16px' }}>
            {/* Tab bar */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', borderBottom: `1px solid ${theme.colors.border}`, paddingBottom: '0' }}>
                <button onClick={() => setActiveTab('accounts')} style={tabStyle(activeTab === 'accounts')}>Accounts</button>
                <button onClick={() => setActiveTab('performance')} style={tabStyle(activeTab === 'performance')}>Performance</button>
                <button onClick={() => setActiveTab('trade')} style={tabStyle(activeTab === 'trade')}>Trade Log</button>
                <button onClick={() => setActiveTab('snapshots')} style={tabStyle(activeTab === 'snapshots')}>Portfolio Snapshots</button>
                <button onClick={() => setActiveTab('settings')} style={tabStyle(activeTab === 'settings')}>Logging Settings</button>
            </div>

            {activeTab === 'accounts' && <AccountsPanel getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} canisterId={canisterId} />}
            {activeTab === 'performance' && <PerformancePanel getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} />}
            {activeTab === 'trade' && <TradeLogViewer getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} />}
            {activeTab === 'snapshots' && <PortfolioSnapshotViewer getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} />}
            {activeTab === 'settings' && <LoggingSettingsPanel getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} choreStatuses={choreStatuses} />}
        </div>
    );
}

// ============================================
// SNAPSHOT CHORE CONFIG PANEL
// ============================================
function SnapshotChoreConfigPanel({ instanceId, theme, accentColor, cardStyle }) {
    const features = [
        { icon: '📊', label: 'Balance Snapshots', desc: 'Captures balances of all registered tokens across main account and all named subaccounts.' },
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
// Custom chore configuration renderer (dispatches to real components)
// ============================================
function renderTradingBotChoreConfig({ chore, config, choreTypeId, instanceId, getReadyBotActor, theme, accentColor, cardStyle, inputStyle, buttonStyle, secondaryButtonStyle, canisterId }) {
    switch (choreTypeId) {
        case 'trade':
            return (
                <ActionListPanel
                    key={instanceId}
                    instanceId={instanceId}
                    getReadyBotActor={getReadyBotActor}
                    theme={theme}
                    accentColor={accentColor}
                    cardStyle={cardStyle}
                    inputStyle={inputStyle}
                    buttonStyle={buttonStyle}
                    secondaryButtonStyle={secondaryButtonStyle}
                    fetchFn="getTradeActions"
                    addFn="addTradeAction"
                    updateFn="updateTradeAction"
                    removeFn="removeTradeAction"
                    allowedTypes={[ACTION_TYPE_TRADE, ACTION_TYPE_DEPOSIT, ACTION_TYPE_WITHDRAW, ACTION_TYPE_SEND]}
                    title="Trade Actions"
                    description="Configure token swaps, deposits, withdrawals, and sends that execute when this chore fires. Each action can have conditions (balance thresholds, price ranges) and frequency limits."
                />
            );

        case 'rebalance':
            return (
                <RebalancerConfigPanel
                    key={instanceId}
                    instanceId={instanceId}
                    getReadyBotActor={getReadyBotActor}
                    theme={theme}
                    accentColor={accentColor}
                    cardStyle={cardStyle}
                    inputStyle={inputStyle}
                    buttonStyle={buttonStyle}
                    secondaryButtonStyle={secondaryButtonStyle}
                    canisterId={canisterId}
                />
            );

        case 'move-funds':
            return (
                <ActionListPanel
                    key={instanceId}
                    instanceId={instanceId}
                    getReadyBotActor={getReadyBotActor}
                    theme={theme}
                    accentColor={accentColor}
                    cardStyle={cardStyle}
                    inputStyle={inputStyle}
                    buttonStyle={buttonStyle}
                    secondaryButtonStyle={secondaryButtonStyle}
                    fetchFn="getMoveFundsActions"
                    addFn="addMoveFundsAction"
                    updateFn="updateMoveFundsAction"
                    removeFn="removeMoveFundsAction"
                    allowedTypes={[ACTION_TYPE_DEPOSIT, ACTION_TYPE_WITHDRAW, ACTION_TYPE_SEND]}
                    title="Move Funds Actions"
                    description="Schedule deposit, withdraw, and send operations between subaccounts and external addresses."
                />
            );

        case 'distribute-funds':
            return (
                <DistributionConfigPanel
                    key={instanceId}
                    instanceId={instanceId}
                    getReadyBotActor={getReadyBotActor}
                    theme={theme}
                    accentColor={accentColor}
                    cardStyle={cardStyle}
                    inputStyle={inputStyle}
                    buttonStyle={buttonStyle}
                    secondaryButtonStyle={secondaryButtonStyle}
                />
            );

        case 'snapshot':
            return (
                <SnapshotChoreConfigPanel
                    key={instanceId}
                    instanceId={instanceId}
                    theme={theme}
                    accentColor={accentColor}
                    cardStyle={cardStyle}
                />
            );

        default:
            return null;
    }
}

export default function TradingBot() {
    const { canisterId } = useParams();
    const { theme } = useTheme();
    const { isAuthenticated, identity } = useAuth();

    if (!canisterId) {
        return (
            <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
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
            <Header />
            <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px 60px' }}>
                {/* Page header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                    <div style={{
                        width: '44px', height: '44px', borderRadius: '12px',
                        background: `linear-gradient(135deg, ${ACCENT}30, ${ACCENT}10)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <FaChartLine style={{ color: ACCENT, fontSize: '20px' }} />
                    </div>
                    <div>
                        <h1 style={{ color: theme.colors.primaryText, fontSize: '1.3rem', margin: 0, fontWeight: '700' }}>
                            Sneed Trading Bot
                        </h1>
                        <div style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', fontFamily: 'monospace' }}>
                            {canisterId}
                        </div>
                    </div>
                </div>

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
                            canisterId={canisterId}
                            createBotActor={createBotActor}
                            accentColor={ACCENT}
                            accentColorSecondary={ACCENT_SECONDARY}
                            botName="Trading Bot"
                            botIcon={<FaChartLine style={{ color: ACCENT, fontSize: '16px' }} />}
                            appId={APP_ID}
                            permissionLabels={PERMISSION_LABELS}
                            permissionDescriptions={PERMISSION_DESCRIPTIONS}
                            multiInstanceChoreTypes={MULTI_INSTANCE_CHORE_TYPES}
                            renderChoreConfig={renderTradingBotChoreConfig}
                            identity={identity}
                            isAuthenticated={isAuthenticated}
                            extraInfoContent={<DexSettingsPanel canisterId={canisterId} createBotActor={createBotActor} identity={identity} />}
                        />
                        <TradingBotLogs
                            canisterId={canisterId}
                            createBotActorFn={createBotActor}
                            theme={theme}
                            accentColor={ACCENT}
                            identity={identity}
                        />
                    </>
                )}
            </div>
        </div>
    );
}
