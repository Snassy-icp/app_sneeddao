// Every action Sneed Hub can propose, in one table (spec/sneed_proxy.md §4.1). Admin pages, in-place
// "Propose" buttons and the proposal page all read it. A `proxy` entry must match an entry of the
// sneed_proxy allowlist with the same class; the proxy refuses a call through the wrong class anyway.
//
// Values are the JavaScript forms @dfinity/candid uses (bigint for nat, [] / [x] for opt, Principal).
import { IDL } from '@dfinity/candid';
import { Principal } from '@dfinity/principal';
import { idlFactory as proxyIdl, canisterId as proxyEnvId } from 'declarations/sneed_proxy';
import { idlFactory as lockIdl, canisterId as lockId } from 'declarations/sneed_lock';
import { idlFactory as sneedexIdl, canisterId as sneedexId } from 'declarations/sneedex';
import { idlFactory as premiumIdl, canisterId as premiumId } from 'declarations/sneed_premium';
import { idlFactory as sneedappIdl, canisterId as sneedappId } from 'declarations/sneedapp';
import { idlFactory as rllIdl, canisterId as rllId } from 'declarations/rll';

export const SNEED_GOVERNANCE = 'fi3zi-fyaaa-aaaaq-aachq-cai';
export const SNEED_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';
/// Sneed Hub proposes proxy calls with an expiry this far out (spec §11 Q1).
export const DEFAULT_EXPIRY_DAYS = 14;

// dfx bakes a made-up 8-byte id into the bundle for a canister missing on the network
export const realCanisterId = (text) => {
    try { const b = Principal.fromText(text).toUint8Array(); return b.length === 10 && b[9] === 1 ? text : null; } catch { return null; }
};
export const proxyCanisterId = proxyEnvId ? realCanisterId(proxyEnvId) : null;

/// The proxy's execute functions, by class (GNSF ids are looked up in governance by target method).
export const CLASSES = {
    business: { method: 'execute_business', validator: 'validate_business', gnsf: 6000, topic: 'Application Business Logic', critical: false },
    dapp: { method: 'execute_dapp', validator: 'validate_dapp', gnsf: 6001, topic: 'Dapp Canister Management', critical: false },
    community: { method: 'execute_community', validator: 'validate_community', gnsf: 6002, topic: 'DAO Community Settings', critical: true },
    critical: { method: 'execute_critical', validator: 'validate_critical', gnsf: 6003, topic: 'Critical Dapp Operations', critical: true },
    treasury: { method: 'execute_treasury', validator: 'validate_treasury', gnsf: 6004, topic: 'Treasury & Asset Management', critical: true },
};
/// Voting periods implied by the class (Sneed: 4 days + up to 1 of wait-for-quiet; critical: 5-10 days).
export const votingPeriodText = (cls) => (CLASSES[cls]?.critical ? '5 to 10 days, 67% of votes cast and 20% of all voting power must say yes' : '4 to 5 days, a majority of votes cast and 3% of all voting power must say yes');

const isAdminIn = (list, p) => (list || []).some((a) => a.toText() === p);

/// Canisters with proposable actions. `isAdmin(actor, principalText)` decides "Apply" vs "Propose".
export const CANISTERS = {
    sneed_lock: {
        name: 'Sneed Lock', idl: lockIdl, id: lockId,
        isAdmin: async (a, p) => isAdminIn(await a.get_admin_list(), p), // controllers and governance are admins too
    },
    sneedex: {
        name: 'Sneedex', idl: sneedexIdl, id: sneedexId,
        isAdmin: async (a, p) => isAdminIn((await a.getConfig()).admins, p),
    },
    sneed_premium: {
        name: 'Sneed Premium', idl: premiumIdl, id: premiumId,
        isAdmin: async (a, p) => isAdminIn((await a.getConfig()).admins, p),
    },
    sneedapp: {
        name: 'Sneedapp', idl: sneedappIdl, id: sneedappId,
        isAdmin: async (a, p) => isAdminIn(await a.getAdmins(), p),
    },
    rll: {
        name: 'Rewards (RLL)', idl: rllIdl, id: rllId,
        isAdmin: async (a, p) => a.principal_is_admin(Principal.fromText(p)),
    },
};

/// Field hints for display, by argument position: bps, e8s:<SYMBOL>, ns, seconds, days, principal, bool.
export const ACTIONS = {
    // Pilot (spec §9): Sneed Lock fees
    'sneed_lock.admin_set_lock_fees_icp': {
        canister: 'sneed_lock', method: 'admin_set_lock_fees_icp', route: 'proxy', class: 'business', reply: 'result',
        label: 'Set Sneed Lock fees',
        fields: { 0: { kind: 'e8s:ICP', name: 'Token lock fee', keep: true }, 1: { kind: 'e8s:ICP', name: 'Position lock fee', keep: true }, 2: { kind: 'e8s:ICP', name: 'Premium token lock fee', keep: true }, 3: { kind: 'e8s:ICP', name: 'Premium position lock fee', keep: true } },
        read: async (a) => { const f = await a.get_lock_fees_icp(); return [[f.token_lock_fee_icp_e8s], [f.position_lock_fee_icp_e8s], [f.premium_token_lock_fee_icp_e8s], [f.premium_position_lock_fee_icp_e8s]]; },
        page: '/sneedlock_info',
    },
    'sneed_lock.set_max_lock_length_days': {
        canister: 'sneed_lock', method: 'set_max_lock_length_days', route: 'proxy', class: 'business', reply: 'any',
        label: 'Set the maximum lock length',
        fields: { 0: { kind: 'days', name: 'Maximum lock length' } },
        page: '/sneedlock_info',
    },
    'sneedex.setMarketplaceFeeRate': {
        canister: 'sneedex', method: 'setMarketplaceFeeRate', route: 'proxy', class: 'business', reply: 'result',
        label: 'Set Sneedex marketplace fee rate',
        fields: { 0: { kind: 'bps', name: 'Marketplace cut' } },
        read: async (a) => [await a.getMarketplaceFeeRate()],
        page: '/sneedex',
    },
    'sneedex.setOfferCreationFee': {
        canister: 'sneedex', method: 'setOfferCreationFee', route: 'proxy', class: 'business', reply: 'result',
        label: 'Set Sneedex offer creation fee',
        fields: { 0: { kind: 'e8s:ICP', name: 'Offer creation fee' } },
        page: '/sneedex',
    },
    'sneedex.setPremiumOfferCreationFee': {
        canister: 'sneedex', method: 'setPremiumOfferCreationFee', route: 'proxy', class: 'business', reply: 'result',
        label: 'Set Sneedex Premium offer creation fee',
        fields: { 0: { kind: 'e8s:ICP', name: 'Premium offer creation fee' } },
        page: '/sneedex',
    },
    'sneedex.setPremiumAuctionCutBps': {
        canister: 'sneedex', method: 'setPremiumAuctionCutBps', route: 'proxy', class: 'business', reply: 'result',
        label: 'Set Sneedex Premium auction cut',
        fields: { 0: { kind: 'bps', name: 'Premium auction cut' } },
        page: '/sneedex',
    },
    'sneed_premium.setMinClaimInterval': {
        canister: 'sneed_premium', method: 'setMinClaimInterval', route: 'proxy', class: 'business', reply: 'result',
        label: 'Set the Premium claim interval',
        fields: { 0: { kind: 'ns', name: 'Minimum time between claims' } },
        page: '/premium',
    },
    'sneedapp.setCreationFee': {
        canister: 'sneedapp', method: 'setCreationFee', route: 'proxy', class: 'business', reply: 'any',
        label: 'Set the app mint fee',
        fields: { 0: { kind: 'e8s:ICP', name: 'Mint fee' } },
        page: '/sneedapp',
    },
    'sneedapp.setPremiumCreationFee': {
        canister: 'sneedapp', method: 'setPremiumCreationFee', route: 'proxy', class: 'business', reply: 'any',
        label: 'Set the Premium app mint fee',
        fields: { 0: { kind: 'e8s:ICP', name: 'Premium mint fee' } },
        page: '/sneedapp',
    },
    'rll.set_token_min_distribution': {
        canister: 'rll', method: 'set_token_min_distribution', route: 'proxy', class: 'business', reply: 'result',
        label: 'Set a token\'s minimum distribution',
        fields: { 0: { kind: 'principal', name: 'Token ledger' }, 1: { kind: 'nat', name: 'Minimum (base units)' } },
        page: '/rll',
    },
    'rll.set_token_max_distribution': {
        canister: 'rll', method: 'set_token_max_distribution', route: 'proxy', class: 'business', reply: 'result',
        label: 'Set a token\'s maximum distribution',
        fields: { 0: { kind: 'principal', name: 'Token ledger' }, 1: { kind: 'nat', name: 'Maximum (base units)' } },
        page: '/rll',
    },
};

// ---- Candid ----

/// The argument types of `method` in a service's IDL factory.
export function argTypesOf(idlFactory, method) {
    const svc = idlFactory({ IDL });
    const f = svc._fields.find(([name]) => name === method);
    if (!f) throw new Error(`No method ${method} in this interface`);
    return f[1].argTypes;
}

export const ProxyCallType = () => argTypesOf(proxyIdl, 'execute_business');
export const AllowlistUpdateType = () => argTypesOf(proxyIdl, 'set_allowlist');

/// The canister key whose id (on this network) is `canisterIdText`.
export function canisterKeyOf(canisterIdText) {
    return Object.keys(CANISTERS).find((k) => CANISTERS[k].id && CANISTERS[k].id === canisterIdText) || null;
}

/// The registry entry for (canister id, method), or null.
export function findAction(canisterIdText, method) {
    const key = canisterKeyOf(canisterIdText);
    if (!key) return null;
    const actionKey = `${key}.${method}`;
    return ACTIONS[actionKey] ? { key: actionKey, ...ACTIONS[actionKey] } : null;
}

/// Encode an action's argument tuple.
export function encodeArgs(actionKey, args) {
    const a = ACTIONS[actionKey];
    if (!a) throw new Error(`Unknown action ${actionKey}`);
    return new Uint8Array(IDL.encode(argTypesOf(CANISTERS[a.canister].idl, a.method), args));
}

/// Decode a target method's argument bytes with the target's own interface; null if unknown.
export function decodeArgs(canisterIdText, method, bytes) {
    const action = findAction(canisterIdText, method);
    if (!action) return null;
    const types = argTypesOf(CANISTERS[action.canister].idl, method);
    return { action, types, values: IDL.decode(types, toBytes(bytes)) };
}

export const toBytes = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));

/// A ProxyCall: { canister, method, arg, note, expires_at } in @dfinity/candid form.
export function encodeProxyCall(call) {
    return new Uint8Array(IDL.encode(ProxyCallType(), [call]));
}
export function decodeProxyCall(payload) {
    return IDL.decode(ProxyCallType(), toBytes(payload))[0];
}

/// Build the ProxyCall for an action with an expiry (default 14 days) and an optional note.
export function proxyCallFor(actionKey, args, { note = '', expiryDays = DEFAULT_EXPIRY_DAYS, nowMs = Date.now() } = {}) {
    const a = ACTIONS[actionKey];
    const id = CANISTERS[a.canister].id;
    if (!id) throw new Error(`${CANISTERS[a.canister].name} has no canister id on this network`);
    return {
        canister: Principal.fromText(id),
        method: a.method,
        arg: encodeArgs(actionKey, args),
        note: note ? [note.slice(0, 500)] : [],
        expires_at: expiryDays ? [BigInt(nowMs + expiryDays * 86_400_000) * 1_000_000n] : [],
    };
}

// ---- hashes (as the proxy computes them) ----

export async function sha256(bytes) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', toBytes(bytes)));
}
export const hex = (bytes) => Array.from(toBytes(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (h) => new Uint8Array((h.match(/../g) || []).map((x) => parseInt(x, 16)));

function leb128(n) {
    let v = BigInt(n);
    const out = [];
    do {
        let byte = Number(v & 0x7fn);
        v >>= 7n;
        if (v !== 0n) byte |= 0x80;
        out.push(byte);
    } while (v !== 0n);
    return new Uint8Array(out);
}
const concat = (parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let i = 0;
    for (const p of parts) { out.set(p, i); i += p.length; }
    return out;
};
const cmp = (a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; };
const utf8 = (t) => new TextEncoder().encode(t);

/// The ICRC-3 representation-independent hash of a value ({ Blob } | { Text } | { Nat } | { Map }).
export async function hashValue(v) {
    if ('Blob' in v) return sha256(v.Blob);
    if ('Text' in v) return sha256(utf8(v.Text));
    if ('Nat' in v) return sha256(leb128(v.Nat));
    if ('Array' in v) return sha256(concat(await Promise.all(v.Array.map(hashValue))));
    if ('Map' in v) {
        const pairs = await Promise.all(v.Map.map(async ([k, x]) => concat([await sha256(utf8(k)), await hashValue(x)])));
        pairs.sort(cmp);
        return sha256(concat(pairs));
    }
    throw new Error('Unsupported value');
}

/// The `payload_hash` of a ProxyCall, as the proxy logs it: the ICRC-3 hash of its fields.
export async function payloadHash(call) {
    const fields = [['canister', { Blob: call.canister.toUint8Array() }], ['method', { Text: call.method }], ['arg', { Blob: toBytes(call.arg) }]];
    if (call.note?.length) fields.push(['note', { Text: call.note[0] }]);
    if (call.expires_at?.length) fields.push(['expires_at', { Nat: call.expires_at[0] }]);
    return hashValue({ Map: fields });
}

/// The argument hash a validator text claims ("Argument: 14 bytes, SHA-256 9f2c…"), or null.
export function claimedArgHash(validatorText) {
    const m = /^Argument: \d+ bytes, SHA-256 ([0-9a-f]{64})$/m.exec(validatorText || '');
    return m ? m[1] : null;
}
