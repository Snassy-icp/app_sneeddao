// Helpers to read ICRC-3 values and to guess what a field means when no
// projection knows the block type (the "generic compact" view).
import { Principal } from '@dfinity/principal';
import { encodeIcrcAccount } from '@dfinity/ledger-icrc';

export const kindOf = (v) => (v ? Object.keys(v)[0] : undefined);
export const inner = (v) => (v ? v[kindOf(v)] : undefined);

export const field = (map, key) => {
    if (!map || !('Map' in map)) return undefined;
    const e = map.Map.find(([k]) => k === key);
    return e ? e[1] : undefined;
};
export const btypeOf = (block) => field(block, 'btype')?.Text ?? field(field(block, 'tx'), 'op')?.Text ?? null;
export const tsOf = (block) => {
    const ts = field(block, 'ts') ?? field(block, 'timestamp');
    return ts && 'Nat' in ts ? ts.Nat : null;
};
export const bytesOf = (v) => (v && 'Blob' in v ? Uint8Array.from(v.Blob) : null);

/// A blob that decodes to a principal of a sensible length.
export const asPrincipal = (v) => {
    const bytes = bytesOf(v);
    if (!bytes || bytes.length === 0 || bytes.length > 29) return null;
    // Only the shapes real principals have: opaque canister ids (ending 0x01,
    // 10 bytes on mainnet), self-authenticating ids (29 bytes ending 0x02),
    // derived ids (ending 0x03) and the anonymous id (0x04). Random memos and
    // hashes rarely match these.
    const last = bytes[bytes.length - 1];
    const plausible = (last === 1 && bytes.length <= 10) || (last === 2 && bytes.length === 29) || (last === 3 && bytes.length === 29) || (last === 4 && bytes.length === 1);
    if (!plausible) return null;
    try {
        return Principal.fromUint8Array(bytes);
    } catch { return null; }
};

/// An ICRC-1 account in the ICRC-3 representation: [owner] or [owner, subaccount].
export const asAccount = (v) => {
    if (!v || !('Array' in v) || v.Array.length === 0 || v.Array.length > 2) return null;
    const owner = asPrincipal(v.Array[0]);
    if (!owner) return null;
    const sub = v.Array[1] ? bytesOf(v.Array[1]) : null;
    if (v.Array[1] && (!sub || sub.length !== 32)) return null;
    const subaccount = sub && sub.some((b) => b !== 0) ? sub : null;
    return { owner, subaccount, text: encodeIcrcAccount({ owner, subaccount: subaccount || undefined }) };
};

const TIME_KEYS = /(^|_)(ts|time|timestamp|expiry|expires|expiration|created_at|deadline)(_at|_ns|_ms|_s)?$|_at$|_time$|_ts$|_expiry$|expiry$/i;
const AMOUNT_KEYS = /(^|_)(amt|amount|fee|balance|credited|used|returned|delivered|value|total|supply|reward|rewards|owed|cycles)(\d|_e8s|_e18|[01])?$|_e8s$|^amount\d$|^fee\d$|^credited\d$|^used\d$|^returned\d$|^delivered\d$/i;
const HASH_KEYS = /^(phash|hash|block_hash|last_block_hash|tx_hash)$/i;
const BYTES_KEYS = /^(memo|nonce|salt|subaccount|sub|seed|signature|sig)(\d|_.*)?$/i;

/// Interpret a Nat as a timestamp, guessing the unit from its magnitude.
export const asTimestampMs = (n) => {
    const x = BigInt(n);
    if (x > 10n ** 17n) return Number(x / 1_000_000n);   // nanoseconds
    if (x > 10n ** 14n) return Number(x / 1_000n);       // microseconds
    if (x > 10n ** 11n) return Number(x);                // milliseconds
    if (x > 10n ** 8n) return Number(x) * 1000;          // seconds
    return null;
};

/// Best guess for how to show a value under `key`, without any schema.
export function guessKind(key, v) {
    const k = kindOf(v);
    if (k === 'Map') return 'map';
    if (k === 'Array') return asAccount(v) ? 'account' : 'array';
    if (k === 'Text') return /^[a-z0-9_-]*:[a-z0-9_-]+$/i.test(v.Text) || key === 'btype' || key === 'op' ? 'tag' : 'text';
    if (k === 'Blob') {
        if (HASH_KEYS.test(key)) return 'hash';
        if (BYTES_KEYS.test(key)) return v.Blob.length === 32 ? 'subaccount' : 'bytes';
        if (asPrincipal(v)) return 'principal';
        if (v.Blob.length === 32) return 'subaccount';
        return 'bytes';
    }
    if (k === 'Nat') {
        if (TIME_KEYS.test(key) && asTimestampMs(v.Nat) !== null) return 'time';
        if (AMOUNT_KEYS.test(key)) return 'amount';
        return 'nat';
    }
    if (k === 'Int') return 'int';
    return 'unknown';
}

export const formatUnits = (n, decimals = 0, maxFraction = 8) => {
    const x = BigInt(n);
    const neg = x < 0n;
    const abs = neg ? -x : x;
    const d = BigInt(decimals);
    const base = 10n ** d;
    const whole = abs / base;
    let frac = (abs % base).toString().padStart(Number(d), '0');
    frac = frac.replace(/0+$/, '').slice(0, maxFraction);
    const wholeText = whole.toLocaleString('en-US');
    return `${neg ? '-' : ''}${wholeText}${frac ? '.' + frac : ''}`;
};

export const formatNat = (n) => BigInt(n).toLocaleString('en-US');

export const formatTime = (ms) => {
    if (ms === null || ms === undefined) return '';
    const d = new Date(ms);
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export const relativeTime = (ms) => {
    const diff = Date.now() - ms;
    const abs = Math.abs(diff);
    const unit = abs < 60_000 ? [1000, 's'] : abs < 3_600_000 ? [60_000, 'm'] : abs < 86_400_000 ? [3_600_000, 'h'] : [86_400_000, 'd'];
    const n = Math.round(abs / unit[0]);
    return diff >= 0 ? `${n}${unit[1]} ago` : `in ${n}${unit[1]}`;
};

export const shortHex = (bytes, keep = 6) => {
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return hex.length <= keep * 2 + 3 ? hex : `${hex.slice(0, keep)}…${hex.slice(-keep)}`;
};
export const fullHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/// Plain JavaScript rendering of a value (for the raw view / JSON export).
export function valueToJson(v) {
    const k = kindOf(v);
    switch (k) {
        case 'Nat': case 'Int': return v[k].toString();
        case 'Text': return v.Text;
        case 'Blob': return { blob: fullHex(v.Blob), length: v.Blob.length };
        case 'Array': return v.Array.map(valueToJson);
        case 'Map': return Object.fromEntries(v.Map.map(([key, val]) => [key, valueToJson(val)]));
        default: return null;
    }
}

/// Flatten the block's top level and its `tx` map for summaries.
export const txEntries = (block) => {
    const tx = field(block, 'tx');
    return tx && 'Map' in tx ? tx.Map : [];
};
