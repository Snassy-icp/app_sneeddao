import { Principal } from '@dfinity/principal';
import { Actor, HttpAgent } from '@dfinity/agent';

// Sneed Premium canister ID (staging)
export const SNEED_PREMIUM_CANISTER_ID = 'sf5tm-dqaaa-aaaae-qgyla-cai';

// Time constants (in nanoseconds) - must match backend
export const NS_PER_SECOND = 1_000_000_000n;
export const NS_PER_MINUTE = 60_000_000_000n;
export const NS_PER_HOUR = 3_600_000_000_000n;
export const NS_PER_DAY = 86_400_000_000_000n;
export const NS_PER_WEEK = 604_800_000_000_000n;
export const NS_PER_MONTH = 2_592_000_000_000_000n;
export const NS_PER_YEAR = 31_536_000_000_000_000n;

// ICP e8s constant
export const E8S_PER_ICP = 100_000_000n;

// Sneed Premium IDL Factory
const sneedPremiumIdlFactory = ({ IDL }) => {
    const Account = IDL.Record({
        owner: IDL.Principal,
        subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
    });
    
    const Membership = IDL.Record({
        principal: IDL.Principal,
        expiration: IDL.Int,
        lastUpdated: IDL.Int,
    });
    
    const MembershipStatus = IDL.Variant({
        Active: IDL.Record({ expiration: IDL.Int }),
        Expired: IDL.Record({ expiredAt: IDL.Int }),
        NotFound: IDL.Null,
    });
    
    const IcpTier = IDL.Record({
        amountE8s: IDL.Nat,
        durationNs: IDL.Nat,
        name: IDL.Text,
        active: IDL.Bool,
    });
    
    const VotingPowerTier = IDL.Record({
        minVotingPowerE8s: IDL.Nat,
        durationNs: IDL.Nat,
        name: IDL.Text,
        active: IDL.Bool,
    });
    
    const Config = IDL.Record({
        admins: IDL.Vec(IDL.Principal),
        icpLedgerId: IDL.Principal,
        sneedGovernanceId: IDL.Principal,
        paymentRecipient: Account,
        minClaimIntervalNs: IDL.Nat,
    });
    
    const PurchaseError = IDL.Variant({
        NotAuthorized: IDL.Null,
        InsufficientPayment: IDL.Record({ required: IDL.Nat, received: IDL.Nat }),
        InvalidTier: IDL.Null,
        TierNotActive: IDL.Null,
        TransferFailed: IDL.Text,
        InternalError: IDL.Text,
    });
    
    const ClaimError = IDL.Variant({
        NotAuthorized: IDL.Null,
        NoEligibleNeurons: IDL.Null,
        InsufficientVotingPower: IDL.Record({ required: IDL.Nat, found: IDL.Nat }),
        NoActiveTiers: IDL.Null,
        AlreadyClaimedRecently: IDL.Record({ lastClaimTime: IDL.Int, intervalNs: IDL.Nat, nextClaimTime: IDL.Int }),
        InternalError: IDL.Text,
    });
    
    const AdminError = IDL.Variant({
        NotAuthorized: IDL.Null,
        InvalidInput: IDL.Text,
        NotFound: IDL.Null,
    });
    
    const PromoCode = IDL.Record({
        code: IDL.Text,
        durationNs: IDL.Nat,
        maxClaims: IDL.Nat,
        claimCount: IDL.Nat,
        expiration: IDL.Opt(IDL.Int),
        notes: IDL.Opt(IDL.Text),
        createdBy: IDL.Principal,
        createdAt: IDL.Int,
        active: IDL.Bool,
    });
    
    const PromoCodeClaim = IDL.Record({
        code: IDL.Text,
        claimedBy: IDL.Principal,
        claimedAt: IDL.Int,
        durationGrantedNs: IDL.Nat,
    });
    
    const CreatePromoCodeRequest = IDL.Record({
        durationNs: IDL.Nat,
        maxClaims: IDL.Nat,
        expiration: IDL.Opt(IDL.Int),
        notes: IDL.Opt(IDL.Text),
    });
    
    const PromoCodeError = IDL.Variant({
        NotAuthorized: IDL.Null,
        InvalidCode: IDL.Null,
        CodeExpired: IDL.Null,
        CodeFullyClaimed: IDL.Null,
        CodeInactive: IDL.Null,
        AlreadyClaimed: IDL.Null,
        InternalError: IDL.Text,
    });
    
    const PurchaseResult = IDL.Variant({
        ok: Membership,
        err: PurchaseError,
    });
    
    const ClaimResult = IDL.Variant({
        ok: Membership,
        err: ClaimError,
    });
    
    const PromoCodeResult = IDL.Variant({
        ok: Membership,
        err: PromoCodeError,
    });
    
    const AdminResultUnit = IDL.Variant({
        ok: IDL.Null,
        err: AdminError,
    });
    
    const AdminResultMembership = IDL.Variant({
        ok: Membership,
        err: AdminError,
    });
    
    const AdminResultPromoCode = IDL.Variant({
        ok: PromoCode,
        err: AdminError,
    });
    
    const AdminResultPromoCodes = IDL.Variant({
        ok: IDL.Vec(PromoCode),
        err: AdminError,
    });
    
    const AdminResultPromoCodeClaims = IDL.Variant({
        ok: IDL.Vec(PromoCodeClaim),
        err: AdminError,
    });
    
    return IDL.Service({
        // Query methods
        checkMembership: IDL.Func([IDL.Principal], [MembershipStatus], ['query']),
        getMembershipDetails: IDL.Func([IDL.Principal], [IDL.Opt(Membership)], ['query']),
        getDepositAccount: IDL.Func([IDL.Principal], [Account], ['query']),
        getIcpTiers: IDL.Func([], [IDL.Vec(IcpTier)], ['query']),
        getAllIcpTiers: IDL.Func([], [IDL.Vec(IcpTier)], ['query']),
        getVotingPowerTiers: IDL.Func([], [IDL.Vec(VotingPowerTier)], ['query']),
        getAllVotingPowerTiers: IDL.Func([], [IDL.Vec(VotingPowerTier)], ['query']),
        getConfig: IDL.Func([], [Config], ['query']),
        getAllMemberships: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Principal, Membership))], ['query']),
        getCanisterId: IDL.Func([], [IDL.Principal], ['query']),
        isCallerAdmin: IDL.Func([], [IDL.Bool], ['query']),
        
        // Purchase/Claim methods
        purchaseWithIcp: IDL.Func([], [PurchaseResult], []),
        claimWithVotingPower: IDL.Func([], [ClaimResult], []),
        claimPromoCode: IDL.Func([IDL.Text], [PromoCodeResult], []),
        
        // Admin methods
        updateConfig: IDL.Func([Config], [AdminResultUnit], []),
        addAdmin: IDL.Func([IDL.Principal], [AdminResultUnit], []),
        removeAdmin: IDL.Func([IDL.Principal], [AdminResultUnit], []),
        addIcpTier: IDL.Func([IcpTier], [AdminResultUnit], []),
        updateIcpTier: IDL.Func([IDL.Nat, IcpTier], [AdminResultUnit], []),
        removeIcpTier: IDL.Func([IDL.Nat], [AdminResultUnit], []),
        addVpTier: IDL.Func([VotingPowerTier], [AdminResultUnit], []),
        updateVpTier: IDL.Func([IDL.Nat, VotingPowerTier], [AdminResultUnit], []),
        removeVpTier: IDL.Func([IDL.Nat], [AdminResultUnit], []),
        setMembershipAdmin: IDL.Func([IDL.Principal, IDL.Int], [AdminResultMembership], []),
        extendMembershipAdmin: IDL.Func([IDL.Principal, IDL.Nat], [AdminResultMembership], []),
        revokeMembership: IDL.Func([IDL.Principal], [AdminResultUnit], []),
        setIcpLedgerId: IDL.Func([IDL.Principal], [AdminResultUnit], []),
        setSneedGovernanceId: IDL.Func([IDL.Principal], [AdminResultUnit], []),
        setPaymentRecipient: IDL.Func([Account], [AdminResultUnit], []),
        setMinClaimInterval: IDL.Func([IDL.Nat], [AdminResultUnit], []),
        
        // Promo code admin methods
        createPromoCode: IDL.Func([CreatePromoCodeRequest], [AdminResultPromoCode], []),
        getPromoCodes: IDL.Func([], [AdminResultPromoCodes], ['query']),
        getPromoCodeClaims: IDL.Func([IDL.Text], [AdminResultPromoCodeClaims], ['query']),
        deactivatePromoCode: IDL.Func([IDL.Text], [AdminResultUnit], []),
        reactivatePromoCode: IDL.Func([IDL.Text], [AdminResultUnit], []),
        deletePromoCode: IDL.Func([IDL.Text], [AdminResultUnit], []),
    });
};

/**
 * Create a Sneed Premium actor instance
 * @param {Identity} identity - Optional identity for authenticated calls
 * @returns {Actor} Sneed Premium actor
 */
export const createSneedPremiumActor = async (identity = null) => {
    const agentOptions = { host: 'https://icp-api.io' };
    if (identity) {
        agentOptions.identity = identity;
    }
    const agent = await HttpAgent.create(agentOptions);
    
    return Actor.createActor(sneedPremiumIdlFactory, {
        agent,
        canisterId: SNEED_PREMIUM_CANISTER_ID,
    });
};

/**
 * Format a duration in nanoseconds to a human-readable string
 * @param {bigint|number} durationNs - Duration in nanoseconds
 * @returns {string} Human-readable duration
 */
export const formatDuration = (durationNs) => {
    const ns = BigInt(durationNs);
    
    if (ns >= NS_PER_YEAR) {
        const years = Number(ns / NS_PER_YEAR);
        const remaining = ns % NS_PER_YEAR;
        const months = Number(remaining / NS_PER_MONTH);
        if (months > 0) {
            return `${years} year${years !== 1 ? 's' : ''} ${months} month${months !== 1 ? 's' : ''}`;
        }
        return `${years} year${years !== 1 ? 's' : ''}`;
    }
    
    if (ns >= NS_PER_MONTH) {
        const months = Number(ns / NS_PER_MONTH);
        const remaining = ns % NS_PER_MONTH;
        const days = Number(remaining / NS_PER_DAY);
        if (days > 0) {
            return `${months} month${months !== 1 ? 's' : ''} ${days} day${days !== 1 ? 's' : ''}`;
        }
        return `${months} month${months !== 1 ? 's' : ''}`;
    }
    
    if (ns >= NS_PER_WEEK) {
        const weeks = Number(ns / NS_PER_WEEK);
        const remaining = ns % NS_PER_WEEK;
        const days = Number(remaining / NS_PER_DAY);
        if (days > 0) {
            return `${weeks} week${weeks !== 1 ? 's' : ''} ${days} day${days !== 1 ? 's' : ''}`;
        }
        return `${weeks} week${weeks !== 1 ? 's' : ''}`;
    }
    
    if (ns >= NS_PER_DAY) {
        const days = Number(ns / NS_PER_DAY);
        const remaining = ns % NS_PER_DAY;
        const hours = Number(remaining / NS_PER_HOUR);
        if (hours > 0) {
            return `${days} day${days !== 1 ? 's' : ''} ${hours} hour${hours !== 1 ? 's' : ''}`;
        }
        return `${days} day${days !== 1 ? 's' : ''}`;
    }
    
    if (ns >= NS_PER_HOUR) {
        const hours = Number(ns / NS_PER_HOUR);
        return `${hours} hour${hours !== 1 ? 's' : ''}`;
    }
    
    if (ns >= NS_PER_MINUTE) {
        const minutes = Number(ns / NS_PER_MINUTE);
        return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
    
    const seconds = Number(ns / NS_PER_SECOND);
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
};

/**
 * Format ICP amount from e8s to human-readable
 * @param {bigint|number} e8s - Amount in e8s
 * @returns {string} Formatted ICP amount
 */
export const formatIcp = (e8s) => {
    const amount = Number(BigInt(e8s)) / Number(E8S_PER_ICP);
    return `${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 8 })} ICP`;
};

/**
 * Format voting power from e8s to human-readable
 * @param {bigint|number} e8s - Voting power in e8s
 * @returns {string} Formatted voting power
 */
export const formatVotingPower = (e8s) => {
    const amount = Number(BigInt(e8s)) / Number(E8S_PER_ICP);
    if (amount >= 1_000_000) {
        return `${(amount / 1_000_000).toFixed(2)}M VP`;
    }
    if (amount >= 1_000) {
        return `${(amount / 1_000).toFixed(2)}K VP`;
    }
    return `${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} VP`;
};

/**
 * Format a timestamp (nanoseconds since epoch) to a human-readable date
 * @param {bigint|number} timestampNs - Timestamp in nanoseconds
 * @returns {string} Formatted date string
 */
export const formatTimestamp = (timestampNs) => {
    const ms = Number(BigInt(timestampNs) / 1_000_000n);
    return new Date(ms).toLocaleString();
};

/**
 * Check if a membership is active
 * @param {object} status - MembershipStatus from canister
 * @returns {boolean} True if active
 */
export const isMembershipActive = (status) => {
    return 'Active' in status;
};

/**
 * Get expiration from membership status
 * @param {object} status - MembershipStatus from canister
 * @returns {bigint|null} Expiration timestamp or null
 */
export const getExpirationFromStatus = (status) => {
    if ('Active' in status) {
        return BigInt(status.Active.expiration);
    }
    if ('Expired' in status) {
        return BigInt(status.Expired.expiredAt);
    }
    return null;
};

/**
 * Calculate time remaining until expiration
 * @param {bigint|number} expirationNs - Expiration timestamp in nanoseconds
 * @returns {string} Human-readable time remaining
 */
export const getTimeRemaining = (expirationNs) => {
    const now = BigInt(Date.now()) * 1_000_000n;
    const expiration = BigInt(expirationNs);
    
    if (expiration <= now) {
        return 'Expired';
    }
    
    const remaining = expiration - now;
    return formatDuration(remaining);
};

/**
 * Parse duration input (e.g., "30 days", "1 month", "1 year") to nanoseconds
 * @param {number} amount - Amount of time units
 * @param {string} unit - Time unit (days, weeks, months, years)
 * @returns {bigint} Duration in nanoseconds
 */
export const parseDurationToNs = (amount, unit) => {
    const n = BigInt(amount);
    switch (unit.toLowerCase()) {
        case 'second':
        case 'seconds':
            return n * NS_PER_SECOND;
        case 'minute':
        case 'minutes':
            return n * NS_PER_MINUTE;
        case 'hour':
        case 'hours':
            return n * NS_PER_HOUR;
        case 'day':
        case 'days':
            return n * NS_PER_DAY;
        case 'week':
        case 'weeks':
            return n * NS_PER_WEEK;
        case 'month':
        case 'months':
            return n * NS_PER_MONTH;
        case 'year':
        case 'years':
            return n * NS_PER_YEAR;
        default:
            return n * NS_PER_DAY; // Default to days
    }
};

/**
 * Parse ICP input to e8s
 * @param {number|string} icp - ICP amount
 * @returns {bigint} Amount in e8s
 */
export const parseIcpToE8s = (icp) => {
    const amount = parseFloat(icp);
    if (isNaN(amount) || amount < 0) {
        throw new Error('Invalid ICP amount');
    }
    return BigInt(Math.round(amount * Number(E8S_PER_ICP)));
};

