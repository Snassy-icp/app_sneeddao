// The one subaccount codec of Sneed Hub (spec/programmable_accounts.md §3, §4.10). Pure: no React,
// no network, so the wallet, the pockets model, the MCP and the tests share it.
//
// Layouts it knows:
//   - numbered pocket n: the 32-byte big-endian number n (byte 0 is zero for every n < 2^248);
//   - classic Sneed derivation [L][principal][zeros] (sneed_premium, sneedapp, sneed_lock's Sneed
//     wallet, sneed_mon deposits, @dfinity/utils principalToSubAccount);
//   - Sneed Vault `owned(P, i)`: [L][principal][zeros][i as 2 bytes big-endian in 30..31], so
//     owned(P, 0) equals the classic derivation (§3.1, §3.2);
//   - the byte editor's "principal + index" (index right after the principal bytes; equals the
//     vault layout only for 29-byte principals).
//
// Input parsers here produce the same bytes as the copies they will replace (see the comparison
// tests in test/canisters/tests/pockets-model.test.js): pages/ToolsAccount.jsx's helpers,
// SneedMonService.parseSubaccountInput and AccountParser.resolveSubaccount.
import { Principal } from '@dfinity/principal';
import { encodeIcrcAccount, decodeIcrcAccount } from '@dfinity/ledger-icrc';
import { sha224 } from '@dfinity/principal/lib/esm/utils/sha224';
import { getCrc32 } from '@dfinity/principal/lib/esm/utils/getCrc';

export const SUBACCOUNT_LENGTH = 32;
export const VAULT_MAX_INDEX = 65_535;
/// Numbers up to this are shown as "#n"; larger byte-0-zero subaccounts are "exact" pockets.
export const MAX_POCKET_NUMBER = 0xffff_ffffn;

// ---- bytes ----

/// A subaccount in any of the shapes the app meets (Uint8Array, number[], Candid opt `[] | [bytes]`,
/// null) as a Uint8Array, or null for "none". Throws on anything that is not 32 bytes.
export function toBytes(sub) {
    if (sub == null) return null;
    if (Array.isArray(sub) && (sub.length === 0 || (sub.length === 1 && typeof sub[0] !== 'number'))) {
        return sub.length === 0 ? null : toBytes(sub[0]);
    }
    const b = sub instanceof Uint8Array ? sub : Uint8Array.from(sub);
    if (b.length !== SUBACCOUNT_LENGTH) throw new Error('A subaccount is exactly 32 bytes');
    return b;
}

export const zeroSubaccount = () => new Uint8Array(SUBACCOUNT_LENGTH);

/// True for "no subaccount" and for 32 zero bytes: the same ICRC-1 account.
export const isDefault = (sub) => { const b = toBytes(sub); return !b || b.every((x) => x === 0); };

/// The canonical form: null for the default account, else the 32 bytes.
export const canonical = (sub) => (isDefault(sub) ? null : toBytes(sub));

/// As a Candid opt: [] for the default account, [bytes] otherwise.
export const toOpt = (sub) => { const c = canonical(sub); return c ? [c] : []; };

export const bytesToHex = (b) => Array.from(b || [], (x) => x.toString(16).padStart(2, '0')).join('');

export function sameSubaccount(a, b) {
    const x = canonical(a); const y = canonical(b);
    if (!x || !y) return !x && !y;
    for (let i = 0; i < SUBACCOUNT_LENGTH; i++) if (x[i] !== y[i]) return false;
    return true;
}

// ---- numbered pockets ----

/// n (bigint, number or decimal text) as 32 bytes big-endian; null when negative, too large or not a number.
export function numberToSubaccount(n) {
    let v;
    try { v = BigInt(typeof n === 'string' ? n.trim() : n); } catch { return null; }
    if (v < 0n) return null;
    const out = zeroSubaccount();
    for (let i = 31; i >= 0 && v > 0n; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
    return v > 0n ? null : out;
}

/// The subaccount as a big-endian number (0n for the default account).
export function subaccountToNumber(sub) {
    const b = toBytes(sub);
    let v = 0n;
    if (b) for (const x of b) v = (v << 8n) | BigInt(x);
    return v;
}

/// n when this is numbered pocket #n (1 <= n <= MAX_POCKET_NUMBER), else null. Main is not numbered.
export function pocketNumber(sub) {
    const v = subaccountToNumber(sub);
    return v >= 1n && v <= MAX_POCKET_NUMBER ? Number(v) : null;
}

// ---- input parsers (the byte editor's modes) ----

/// Hex (0x optional, spaces and dashes ignored), right-aligned. Over 64 digits: null, or the first
/// 64 with `overlong: 'truncate'` (AccountParser's behaviour). Empty: null, or zeros with `allowEmpty`.
export function hexToSubaccount(hex, { overlong = 'reject', allowEmpty = false } = {}) {
    if (typeof hex !== 'string') return null;
    let h = hex.trim();
    if (h.toLowerCase().startsWith('0x')) h = h.slice(2);
    h = h.replace(/[\s-]/g, '');
    if (!/^[0-9a-fA-F]*$/.test(h)) return null;
    if (!h && !allowEmpty) return null;
    if (h.length > 64) { if (overlong !== 'truncate') return null; h = h.slice(0, 64); }
    h = h.padStart(64, '0');
    const out = zeroSubaccount();
    for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return out;
}

/// UTF-8 text, left-aligned (1..32 bytes).
export function textToSubaccount(text) {
    if (typeof text !== 'string') return null;
    const enc = new TextEncoder().encode(text);
    if (enc.length === 0 || enc.length > 32) return null;
    const out = zeroSubaccount();
    out.set(enc, 0);
    return out;
}

/// Comma-separated byte values (0..255), right-aligned by default (the byte editor) or left-aligned
/// (AccountParser's 'bytes').
export function byteListToSubaccount(input, align = 'right') {
    if (typeof input !== 'string') return null;
    const parts = input.trim().split(',').map((s) => s.trim()).filter((s) => s !== '');
    if (parts.length === 0 || parts.length > 32) return null;
    const vals = [];
    for (const p of parts) {
        const n = parseInt(p, 10);
        if (Number.isNaN(n) || n < 0 || n > 255) return null;
        vals.push(n);
    }
    const out = zeroSubaccount();
    out.set(vals, align === 'left' ? 0 : 32 - vals.length);
    return out;
}

const toPrincipal = (p) => (typeof p === 'string' ? Principal.fromText(p.trim()) : p);

/// The classic Sneed derivation [L][principal][zeros] (= owned(P, 0)).
export function principalToSubaccount(p) {
    const bytes = toPrincipal(p).toUint8Array();
    const out = zeroSubaccount();
    out[0] = bytes.length;
    out.set(bytes, 1);
    return out;
}

/// An index value as `len` big-endian bytes: format 'number' | 'hex' | 'bytes' (right-aligned).
export function indexToBytes(format, value, len) {
    const v = (value || '').trim();
    if (!v) return new Uint8Array(len);
    if (format === 'number') {
        let n; try { n = BigInt(v); } catch { return null; }
        if (n < 0n) return null;
        const out = new Uint8Array(len);
        for (let i = len - 1; i >= 0 && n > 0n; i--) { out[i] = Number(n & 0xffn); n >>= 8n; }
        return n > 0n ? null : out;
    }
    if (format === 'hex') {
        let h = v.replace(/^0x/i, '').replace(/[\s-]/g, '');
        if (!/^[0-9a-fA-F]*$/.test(h) || h.length > len * 2) return null;
        h = h.padStart(len * 2, '0');
        const out = new Uint8Array(len);
        for (let i = 0; i < len; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
        return out;
    }
    if (format === 'bytes') {
        const parts = v.split(',').map((s) => s.trim()).filter((s) => s !== '');
        if (parts.length > len) return null;
        const vals = [];
        for (const p of parts) { const n = parseInt(p, 10); if (Number.isNaN(n) || n < 0 || n > 255) return null; vals.push(n); }
        const out = new Uint8Array(len);
        out.set(vals, len - vals.length);
        return out;
    }
    return new Uint8Array(len);
}

/// The byte editor's "principal + index": [L][principal][index right after it].
export function principalWithIndexToSubaccount(p, indexFormat = 'number', indexValue = '') {
    let bytes;
    try { bytes = toPrincipal(p).toUint8Array(); } catch { return null; }
    if (bytes.length > 30) return null;
    const out = zeroSubaccount();
    out[0] = bytes.length;
    out.set(bytes, 1);
    const room = 31 - bytes.length;
    if (room > 0 && indexValue && indexValue.trim()) {
        const idx = indexToBytes(indexFormat, indexValue, room);
        if (!idx) return null;
        out.set(idx, 1 + bytes.length);
    }
    return out;
}

// ---- Sneed Vault namespace (§3.1, §3.2) ----

const isAnonymous = (bytes) => bytes.length === 1 && bytes[0] === 0x04;

/// owned(owner, index): the vault subaccount of `owner` number `index` (0..65,535). Throws for the
/// anonymous principal, the management canister and indices out of range.
export function ownedSubaccount(owner, index) {
    const bytes = toPrincipal(owner).toUint8Array();
    if (bytes.length === 0 || bytes.length > 29) throw new Error('This principal cannot own vault subaccounts');
    if (isAnonymous(bytes)) throw new Error('The anonymous principal cannot own vault subaccounts');
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i > VAULT_MAX_INDEX) throw new Error('A vault index is 0..65535');
    const out = zeroSubaccount();
    out[0] = bytes.length;
    out.set(bytes, 1);
    out[30] = (i >> 8) & 0xff;
    out[31] = i & 0xff;
    return out;
}

/// { owner, index } when `sub` is canonical in the vault namespace, else null (§3.2).
export function parseOwnedSubaccount(sub) {
    let b;
    try { b = toBytes(sub); } catch { return null; }
    if (!b) return null;
    const L = b[0];
    if (L < 1 || L > 29) return null;
    const pb = b.slice(1, 1 + L);
    if (isAnonymous(pb)) return null;
    for (let i = 1 + L; i < 30; i++) if (b[i] !== 0) return null;
    let owner;
    try { owner = Principal.fromUint8Array(pb); } catch { return null; }
    return { owner, index: (b[30] << 8) | b[31] };
}

/// The byte editor's reading of [L][principal][rest]: the principal and the rest as an index, or
/// null (the "principal-derived" hint of §4.10).
export function principalInfo(sub) {
    let b;
    try { b = toBytes(sub); } catch { return null; }
    if (!b) return null;
    const L = b[0];
    if (L === 0 || L > 29) return null;
    const pb = b.slice(1, 1 + L);
    let principal;
    try { principal = Principal.fromUint8Array(pb); } catch { return null; }
    const re = principal.toUint8Array();
    if (re.length !== L || re.some((x, i) => x !== pb[i])) return null;
    const rest = b.slice(1 + L);
    let n = 0n;
    for (const x of rest) n = (n << 8n) | BigInt(x);
    return {
        principalText: principal.toText(),
        indexBytes: rest,
        indexHex: bytesToHex(rest).replace(/^0+/, '') || '0',
        indexNumber: n.toString(),
        hasIndex: rest.some((x) => x !== 0),
        availableBytes: rest.length,
    };
}

// ---- one entry point for typed input ----

/// What the user typed for a subaccount (the free-text field of Sneed Monitor's auto top-up): an
/// index number or hex. '' = the default account (null). Throws on anything else. Same bytes as
/// SneedMonService.parseSubaccountInput.
export function parseSubaccountInput(text) {
    const t = (text || '').trim();
    if (!t) return null;
    const b = /^\d+$/.test(t) && t.length < 64 ? numberToSubaccount(t) : hexToSubaccount(t, { allowEmpty: true });
    if (!b) throw new Error('A subaccount is an index number or up to 64 hex digits');
    return isDefault(b) ? null : b;
}

/// Resolve the byte editor's input `{ type, value, align?, indexFormat?, indexValue?, index? }` to
/// 32 bytes, or null when it is not valid. Types: 'hex', 'number', 'text', 'bytes', 'principal'
/// (classic, or + index with indexValue), 'vault' (owned(value, index)).
export function parseSubaccount({ type, value, align = 'right', indexFormat = 'number', indexValue = '', index = 0 } = {}) {
    const v = typeof value === 'string' ? value.trim() : value;
    if (v === '' || v == null) return null;
    switch (type) {
        case 'hex': return hexToSubaccount(v);
        case 'number': return numberToSubaccount(v);
        case 'text': return textToSubaccount(value);
        case 'bytes': return byteListToSubaccount(v, align);
        case 'principal': return principalWithIndexToSubaccount(v, indexFormat, indexValue);
        case 'vault': try { return ownedSubaccount(v, index); } catch { return null; }
        default: return null;
    }
}

// ---- accounts as text ----

/// ICRC-1 textual account: "<principal>" or "<principal>-<checksum>.<hex without leading zeros>"
/// (numbered pocket #3 ends in ".3").
export function encodeAccount({ owner, subaccount }) {
    const sub = canonical(subaccount);
    return encodeIcrcAccount({ owner: toPrincipal(owner), subaccount: sub || undefined });
}

/// { owner, subaccount (canonical: null for the default account) } from ICRC-1 text; throws when invalid.
export function decodeAccount(text) {
    const a = decodeIcrcAccount(text.trim());
    return { owner: a.owner, subaccount: a.subaccount ? canonical(a.subaccount) : null };
}

/// The ICP ledger's 64-hex account identifier of an account.
export function accountIdentifierHex({ owner, subaccount }) {
    const pb = toPrincipal(owner).toUint8Array();
    const sub = toBytes(subaccount) || zeroSubaccount();
    const sep = new Uint8Array([0x0a, ...new TextEncoder().encode('account-id')]);
    const pre = new Uint8Array(sep.length + pb.length + 32);
    pre.set(sep, 0); pre.set(pb, sep.length); pre.set(sub, sep.length + pb.length);
    const hash = sha224(pre);
    const crc = getCrc32(hash);
    const out = new Uint8Array(32);
    out[0] = (crc >>> 24) & 0xff; out[1] = (crc >>> 16) & 0xff; out[2] = (crc >>> 8) & 0xff; out[3] = crc & 0xff;
    out.set(hash, 4);
    return bytesToHex(out);
}

/// A short display of a subaccount: "#n" for numbered pockets, "#0a1b…" for exact ones, "" for Main.
export function shortSubaccount(sub) {
    if (isDefault(sub)) return '';
    const n = pocketNumber(sub);
    if (n != null) return `#${n}`;
    const hex = bytesToHex(toBytes(sub)).replace(/^0+/, '') || '0';
    return `#${hex.slice(0, 4)}…`;
}
