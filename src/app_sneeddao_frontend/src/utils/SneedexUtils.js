import { createActor } from 'declarations/sneedex';
import { Principal } from '@dfinity/principal';
import { Actor, HttpAgent } from '@dfinity/agent';

// Sneedex canister ID (staging)
export const SNEEDEX_CANISTER_ID = 'igm46-laaaa-aaaae-qgwra-cai';

// Canister kind IDs (must match backend)
export const CANISTER_KIND_UNKNOWN = 0;
export const CANISTER_KIND_ICP_NEURON_MANAGER = 1;

// Canister kind names for display
export const CANISTER_KIND_NAMES = {
    [CANISTER_KIND_UNKNOWN]: 'Generic Canister',
    [CANISTER_KIND_ICP_NEURON_MANAGER]: 'ICP Neuron Manager',
};

// Validation constants (must match backend)
export const MAX_CANISTER_TITLE_LENGTH = 100;
export const MAX_CANISTER_DESCRIPTION_LENGTH = 4000;

/**
 * Sanitize text for safe display (prevents XSS)
 * React already escapes text in JSX, but this provides additional safety
 * for cases where we might need to render HTML or use dangerouslySetInnerHTML
 * @param {string} text - Text to sanitize
 * @returns {string} Sanitized text
 */
export const sanitizeText = (text) => {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

// ICRC-1 Ledger IDL for basic operations
const icrc1IdlFactory = ({ IDL: idl }) => {
    const Account = idl.Record({
        owner: idl.Principal,
        subaccount: idl.Opt(idl.Vec(idl.Nat8)),
    });
    const TransferArg = idl.Record({
        to: Account,
        fee: idl.Opt(idl.Nat),
        memo: idl.Opt(idl.Vec(idl.Nat8)),
        from_subaccount: idl.Opt(idl.Vec(idl.Nat8)),
        created_at_time: idl.Opt(idl.Nat64),
        amount: idl.Nat,
    });
    const TransferError = idl.Variant({
        GenericError: idl.Record({ message: idl.Text, error_code: idl.Nat }),
        TemporarilyUnavailable: idl.Null,
        BadBurn: idl.Record({ min_burn_amount: idl.Nat }),
        Duplicate: idl.Record({ duplicate_of: idl.Nat }),
        BadFee: idl.Record({ expected_fee: idl.Nat }),
        CreatedInFuture: idl.Record({ ledger_time: idl.Nat64 }),
        TooOld: idl.Null,
        InsufficientFunds: idl.Record({ balance: idl.Nat }),
    });
    const TransferResult = idl.Variant({
        Ok: idl.Nat,
        Err: TransferError,
    });
    return idl.Service({
        icrc1_balance_of: idl.Func([Account], [idl.Nat], ['query']),
        icrc1_transfer: idl.Func([TransferArg], [TransferResult], []),
        icrc1_fee: idl.Func([], [idl.Nat], ['query']),
        icrc1_decimals: idl.Func([], [idl.Nat8], ['query']),
        icrc1_symbol: idl.Func([], [idl.Text], ['query']),
    });
};

/**
 * Create an ICRC-1 ledger actor
 * @param {string} ledgerId - Ledger canister ID
 * @param {Identity} identity - Optional identity for authenticated calls
 * @returns {Actor} ICRC-1 ledger actor
 */
export const createLedgerActor = async (ledgerId, identity = null) => {
    const agentOptions = { host: 'https://icp-api.io' };
    if (identity) {
        agentOptions.identity = identity;
    }
    const agent = await HttpAgent.create(agentOptions);
    
    return Actor.createActor(icrc1IdlFactory, {
        agent,
        canisterId: ledgerId,
    });
};

/**
 * Create a Sneedex actor instance
 * @param {Identity} identity - Optional identity for authenticated calls
 * @returns {Actor} Sneedex actor
 */
export const createSneedexActor = (identity = null) => {
    const options = {};
    if (identity) {
        options.agentOptions = { identity };
    }
    return createActor(SNEEDEX_CANISTER_ID, options);
};

/**
 * Format a BigInt amount to a human-readable string
 * @param {BigInt|number} amount - Amount in e8s (or smallest unit)
 * @param {number} decimals - Number of decimals (default 8 for ICP)
 * @returns {string} Formatted amount
 */
export const formatAmount = (amount, decimals = 8) => {
    if (!amount && amount !== 0n && amount !== 0) return '—';
    const num = Number(amount) / Math.pow(10, decimals);
    // Show full precision, then trim trailing zeros
    const formatted = num.toFixed(decimals);
    // Remove trailing zeros and trailing decimal point
    let trimmed = formatted.replace(/\.?0+$/, '');
    // If it's a whole number, just return it
    if (!trimmed.includes('.')) {
        return trimmed;
    }
    return trimmed;
};

/**
 * Parse a human-readable amount to e8s
 * @param {string|number} amount - Human-readable amount
 * @param {number} decimals - Number of decimals (default 8 for ICP)
 * @returns {BigInt} Amount in e8s
 */
export const parseAmount = (amount, decimals = 8) => {
    // Use Math.round to avoid floating point precision issues
    const num = parseFloat(amount) * Math.pow(10, decimals);
    return BigInt(Math.round(num));
};

/**
 * Format a timestamp to a human-readable date string
 * @param {BigInt|number} timestamp - Timestamp in nanoseconds
 * @returns {string} Formatted date
 */
export const formatDate = (timestamp) => {
    if (!timestamp) return '—';
    // Convert nanoseconds to milliseconds
    const ms = Number(timestamp) / 1_000_000;
    return new Date(ms).toLocaleString();
};

/**
 * Format time remaining until expiration
 * @param {BigInt|number} expiration - Expiration timestamp in nanoseconds
 * @returns {string} Time remaining string
 */
export const formatTimeRemaining = (expiration) => {
    if (!expiration) return 'No expiration';
    // Convert nanoseconds to milliseconds
    const expirationMs = Number(expiration) / 1_000_000;
    const remaining = expirationMs - Date.now();
    
    if (remaining <= 0) return 'Expired';
    
    const days = Math.floor(remaining / 86400000);
    const hours = Math.floor((remaining % 86400000) / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
};

/**
 * Get the offer state as a string
 * @param {Object} state - Offer state variant
 * @returns {string} State name
 */
export const getOfferStateString = (state) => {
    if ('Draft' in state) return 'Draft';
    if ('PendingEscrow' in state) return 'Pending Escrow';
    if ('Active' in state) return 'Active';
    if ('Completed' in state) return 'Completed';
    if ('Expired' in state) return 'Expired';
    if ('Cancelled' in state) return 'Cancelled';
    if ('Claimed' in state) return 'Claimed';
    if ('Reclaimed' in state) return 'Reclaimed';
    return 'Unknown';
};

/**
 * Get the bid state as a string
 * @param {Object} state - Bid state variant
 * @returns {string} State name
 */
export const getBidStateString = (state) => {
    if ('Pending' in state) return 'Pending';
    if ('Won' in state) return 'Won';
    if ('Lost' in state) return 'Lost';
    if ('Refunded' in state) return 'Refunded';
    if ('ClaimedBySeller' in state) return 'Claimed';
    return 'Unknown';
};

/**
 * Get the asset type string
 * @param {Object} asset - Asset variant
 * @returns {string} Asset type
 */
export const getAssetType = (asset) => {
    if ('Canister' in asset) return 'Canister';
    if ('SNSNeuron' in asset) return 'SNSNeuron';
    if ('ICRC1Token' in asset) return 'ICRC1Token';
    return 'Unknown';
};

/**
 * Get asset details
 * @param {Object} assetEntry - Asset entry with asset and escrowed
 * @returns {Object} Formatted asset details
 */
export const getAssetDetails = (assetEntry) => {
    const { asset, escrowed } = assetEntry;
    
    if ('Canister' in asset) {
        // Convert BigInt to Number for canister_kind
        const rawKind = asset.Canister.canister_kind?.[0];
        const canisterKind = rawKind !== undefined ? Number(rawKind) : 0;
        
        // Get cached total stake for neuron managers (convert from optional)
        const rawCachedStake = asset.Canister.cached_total_stake_e8s?.[0];
        const cachedTotalStakeE8s = rawCachedStake !== undefined ? Number(rawCachedStake) : null;
        
        // Get title and description (optional fields)
        const title = asset.Canister.title?.[0] || null;
        const description = asset.Canister.description?.[0] || null;
        
        return {
            type: 'Canister',
            canister_id: asset.Canister.canister_id.toString(),
            canister_kind: canisterKind, // 0 = unknown, 1 = ICP Neuron Manager
            controllers_snapshot: asset.Canister.controllers_snapshot[0]?.map(p => p.toString()) || [],
            cached_total_stake_e8s: cachedTotalStakeE8s, // For neuron managers: total staked ICP (no maturity)
            title,
            description,
            escrowed,
        };
    }
    
    if ('SNSNeuron' in asset) {
        // Convert neuron_id bytes to hex string
        const neuronIdHex = Array.from(asset.SNSNeuron.neuron_id.id)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        
        // Get cached stake (convert from optional)
        const rawCachedStake = asset.SNSNeuron.cached_stake_e8s?.[0];
        const cachedStakeE8s = rawCachedStake !== undefined ? Number(rawCachedStake) : null;
        
        return {
            type: 'SNSNeuron',
            governance_id: asset.SNSNeuron.governance_canister_id.toString(),
            neuron_id: neuronIdHex,
            hotkeys_snapshot: asset.SNSNeuron.hotkeys_snapshot[0]?.map(p => p.toString()) || [],
            cached_stake_e8s: cachedStakeE8s, // Cached stake amount
            escrowed,
        };
    }
    
    if ('ICRC1Token' in asset) {
        return {
            type: 'ICRC1Token',
            ledger_id: asset.ICRC1Token.ledger_canister_id.toString(),
            amount: asset.ICRC1Token.amount,
            escrowed,
        };
    }
    
    return { type: 'Unknown', escrowed };
};

/**
 * Convert expiration days to nanoseconds from now
 * @param {number} days - Number of days
 * @returns {BigInt} Expiration timestamp in nanoseconds
 */
export const daysToExpirationNs = (days) => {
    const ms = Date.now() + (days * 24 * 60 * 60 * 1000);
    return BigInt(ms) * 1_000_000n;
};

/**
 * Create an asset variant for the canister
 * @param {string} type - Asset type: 'canister', 'neuron', or 'token'
 * @param {Object} details - Asset details
 * @returns {Object} Asset variant for candid
 */
export const createAssetVariant = (type, details) => {
    switch (type) {
        case 'canister':
            return {
                Canister: {
                    canister_id: Principal.fromText(details.canister_id),
                    canister_kind: details.canister_kind !== undefined ? [details.canister_kind] : [], // Optional nat
                    controllers_snapshot: [],
                    cached_total_stake_e8s: [], // Optional, populated by backend after activation
                    title: details.title ? [details.title] : [], // Optional text
                    description: details.description ? [details.description] : [], // Optional text
                }
            };
        case 'neuron':
            // Convert hex neuron ID to bytes
            const neuronIdBytes = [];
            for (let i = 0; i < details.neuron_id.length; i += 2) {
                neuronIdBytes.push(parseInt(details.neuron_id.substr(i, 2), 16));
            }
            return {
                SNSNeuron: {
                    governance_canister_id: Principal.fromText(details.governance_id),
                    neuron_id: { id: neuronIdBytes },
                    hotkeys_snapshot: [],
                    cached_stake_e8s: [], // Optional, populated by backend after activation
                }
            };
        case 'token':
            return {
                ICRC1Token: {
                    ledger_canister_id: Principal.fromText(details.ledger_id),
                    amount: parseAmount(details.amount, details.decimals || 8),
                }
            };
        default:
            throw new Error(`Unknown asset type: ${type}`);
    }
};

/**
 * Get error message from Sneedex error
 * @param {Object} error - Sneedex error variant
 * @returns {string} Human-readable error message
 */
export const getErrorMessage = (error) => {
    if ('NotAuthorized' in error) return 'Not authorized to perform this action';
    if ('OfferNotFound' in error) return 'Offer not found';
    if ('BidNotFound' in error) return 'Bid not found';
    if ('InvalidState' in error) return `Invalid state: ${error.InvalidState}`;
    if ('InvalidPrice' in error) return `Invalid price: ${error.InvalidPrice}`;
    if ('InvalidAsset' in error) return `Invalid asset: ${error.InvalidAsset}`;
    if ('InvalidExpiration' in error) return 'Invalid expiration date';
    if ('OfferExpired' in error) return 'Offer has expired';
    if ('BidTooLow' in error) return `Bid too low. Minimum: ${formatAmount(error.BidTooLow.minimum)}`;
    if ('InsufficientFunds' in error) return `Insufficient funds. Required: ${formatAmount(error.InsufficientFunds.required)}, Available: ${formatAmount(error.InsufficientFunds.available)}`;
    if ('EscrowFailed' in error) return `Escrow failed: ${error.EscrowFailed}`;
    if ('TransferFailed' in error) return `Transfer failed: ${error.TransferFailed}`;
    if ('CanisterError' in error) return `Canister error: ${error.CanisterError}`;
    if ('GovernanceError' in error) return `Governance error: ${error.GovernanceError}`;
    if ('AssetTypeNotSupported' in error) return 'Asset type not supported';
    if ('OfferMustHaveBuyoutOrExpiration' in error) return 'Offer must have a buyout price or expiration';
    if ('CannotCancelWithBids' in error) return 'Cannot cancel offer with existing bids';
    return 'Unknown error';
};

/**
 * Format fee rate from basis points to percentage
 * @param {number|BigInt} bps - Fee rate in basis points
 * @returns {string} Formatted percentage string (e.g., "2.5%")
 */
export const formatFeeRate = (bps) => {
    const rate = Number(bps) / 100;
    return `${rate}%`;
};

/**
 * Calculate marketplace fee from bid amount
 * @param {BigInt|number} bidAmount - Bid amount in e8s
 * @param {number|BigInt} feeRateBps - Fee rate in basis points
 * @returns {BigInt} Fee amount in e8s
 */
export const calculateMarketplaceFee = (bidAmount, feeRateBps) => {
    const amount = BigInt(bidAmount);
    const rate = BigInt(feeRateBps);
    return amount * rate / 10000n;
};

/**
 * Get offer details including fee rate
 * @param {Object} offer - Offer object from backend
 * @returns {Object} Parsed offer details
 */
export const getOfferFeeInfo = (offer) => {
    const feeRateBps = Number(offer.fee_rate_bps || 0);
    return {
        feeRateBps,
        feeRatePercent: feeRateBps / 100,
        feeRateFormatted: formatFeeRate(feeRateBps),
    };
};

