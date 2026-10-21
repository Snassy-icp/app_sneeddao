// Addresses and encodings for ck conversions (pure; no React, no network):
//   - Bitcoin addresses as the ckBTC minter accepts them (P2PKH, P2SH, P2WPKH, P2WSH, P2TR),
//     following the minter's own parser (dfinity/ic rs/bitcoin/ckbtc/minter/src/address.rs)
//   - Ethereum addresses with the EIP-55 checksum
//   - an IC principal (and subaccount) as the bytes32 the ckETH helper contract takes
//   - the call data for the helper contract's depositEth / depositErc20 and the ERC-20 calls
// Checked against the official libraries in test/canisters/tests/ck-convert-utils.test.js.
import { sha256 } from '@noble/hashes/sha256';
import { keccak_256 } from '@noble/hashes/sha3';
import { Principal } from '@dfinity/principal';

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// ---- Bitcoin ----

export const BTC_ADDRESS_TYPES = { P2PKH: 'p2pkh', P2SH: 'p2sh', P2WPKH: 'p2wpkh', P2WSH: 'p2wsh', P2TR: 'p2tr' };
const HRP = { mainnet: 'bc', testnet: 'tb', regtest: 'bcrt' };
const BASE58_VERSIONS = { mainnet: { 0x00: 'p2pkh', 0x05: 'p2sh' }, testnet: { 0x6f: 'p2pkh', 0xc4: 'p2sh' }, regtest: { 0x6f: 'p2pkh', 0xc4: 'p2sh' } };

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function bech32Polymod(values) {
    const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const v of values) {
        const top = chk >>> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ v;
        for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
    }
    return chk >>> 0;
}
const hrpExpand = (hrp) => [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));

/// Decode a bech32/bech32m string. Returns { hrp, data (5-bit words), encoding: 'bech32'|'bech32m' } or null.
export function bech32Decode(str) {
    if (typeof str !== 'string' || str.length < 8 || str.length > 90) return null;
    if (str !== str.toLowerCase() && str !== str.toUpperCase()) return null;
    const s = str.toLowerCase();
    const pos = s.lastIndexOf('1');
    if (pos < 1 || pos + 7 > s.length) return null;
    const hrp = s.slice(0, pos);
    for (const c of hrp) { const k = c.charCodeAt(0); if (k < 33 || k > 126) return null; }
    const data = [];
    for (const c of s.slice(pos + 1)) { const v = BECH32_CHARSET.indexOf(c); if (v < 0) return null; data.push(v); }
    const pm = bech32Polymod(hrpExpand(hrp).concat(data));
    const encoding = pm === BECH32_CONST ? 'bech32' : pm === BECH32M_CONST ? 'bech32m' : null;
    if (!encoding) return null;
    return { hrp, data: data.slice(0, -6), encoding };
}

function convertBits(data, from, to, pad) {
    let acc = 0; let bits = 0; const out = []; const maxv = (1 << to) - 1;
    for (const v of data) {
        if (v < 0 || v >> from) return null;
        acc = (acc << from) | v; bits += from;
        while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); }
    }
    if (pad) { if (bits) out.push((acc << (to - bits)) & maxv); } else if (bits >= from || ((acc << (to - bits)) & maxv)) return null;
    return out;
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/// Base58 decode (no checksum handling). Returns Uint8Array or null.
export function base58Decode(str) {
    if (typeof str !== 'string' || !str) return null;
    let n = 0n;
    for (const c of str) { const v = B58.indexOf(c); if (v < 0) return null; n = n * 58n + BigInt(v); }
    const bytes = [];
    while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
    for (const c of str) { if (c !== '1') break; bytes.unshift(0); }
    return Uint8Array.from(bytes);
}

/**
 * Parse a Bitcoin address the way the ckBTC minter does.
 * Returns { ok: true, type, network } or { ok: false, error } (a sentence for the user).
 * `network` is the one expected ('mainnet' default); an address of another network is refused.
 */
export function parseBtcAddress(address, network = 'mainnet') {
    const a = String(address ?? '').trim();
    if (!a) return { ok: false, error: 'Enter a Bitcoin address.' };
    const hrp = HRP[network];
    if (!hrp) return { ok: false, error: `Unknown network ${network}.` };
    // Segwit / taproot (bech32, bech32m)
    const lower = a.toLowerCase();
    if (lower.startsWith(`${hrp}1`) || /^(bc|tb|bcrt)1/.test(lower)) {
        const d = bech32Decode(a);
        if (!d) return { ok: false, error: 'This is not a valid bech32 address (checksum or characters wrong).' };
        if (d.hrp !== hrp) return { ok: false, error: `This address is for Bitcoin ${Object.keys(HRP).find((k) => HRP[k] === d.hrp) || d.hrp}, not ${network}.` };
        if (d.data.length < 1) return { ok: false, error: 'Empty witness program.' };
        const version = d.data[0];
        const program = convertBits(d.data.slice(1), 5, 8, false);
        if (!program || program.length < 2 || program.length > 40) return { ok: false, error: 'Invalid witness program.' };
        if (version === 0) {
            if (d.encoding !== 'bech32') return { ok: false, error: 'Segwit v0 addresses must use the bech32 checksum.' };
            if (program.length === 20) return { ok: true, type: 'p2wpkh', network };
            if (program.length === 32) return { ok: true, type: 'p2wsh', network };
            return { ok: false, error: 'Invalid segwit v0 program length.' };
        }
        if (version === 1) {
            if (d.encoding !== 'bech32m') return { ok: false, error: 'Taproot addresses must use the bech32m checksum.' };
            if (program.length === 32) return { ok: true, type: 'p2tr', network };
            return { ok: false, error: 'Invalid taproot program length.' };
        }
        return { ok: false, error: `Witness version ${version} is not supported by the ckBTC minter.` };
    }
    // Legacy (base58check)
    const raw = base58Decode(a);
    if (!raw || raw.length !== 25) return { ok: false, error: 'This is not a valid Bitcoin address.' };
    const body = raw.slice(0, 21);
    const sum = sha256(sha256(body)).slice(0, 4);
    if (!sum.every((b, i) => b === raw[21 + i])) return { ok: false, error: 'The address checksum is wrong (a typo?).' };
    const type = BASE58_VERSIONS[network][raw[0]];
    if (!type) {
        const other = Object.keys(BASE58_VERSIONS).find((n) => BASE58_VERSIONS[n][raw[0]]);
        return { ok: false, error: other ? `This address is for Bitcoin ${other}, not ${network}.` : 'Unknown Bitcoin address version.' };
    }
    return { ok: true, type, network };
}

export const btcAddressTypeLabel = (t) => ({ p2pkh: 'Legacy (P2PKH)', p2sh: 'Script (P2SH)', p2wpkh: 'Native SegWit (P2WPKH)', p2wsh: 'SegWit script (P2WSH)', p2tr: 'Taproot (P2TR)' }[t] || t);

// ---- Ethereum ----

/// EIP-55 checksummed form of a 0x address (throws if not 20 bytes of hex).
export function toChecksumAddress(address) {
    const a = String(address).trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error('Not an Ethereum address');
    const lower = a.slice(2).toLowerCase();
    const hash = toHex(keccak_256(new TextEncoder().encode(lower)));
    let out = '0x';
    for (let i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
    return out;
}

/**
 * Validate an Ethereum address. All-lowercase or all-uppercase hex is accepted as is; mixed case
 * must match its EIP-55 checksum (a mixed-case typo is caught). Returns { ok, address (checksummed), error }.
 */
export function parseEthAddress(address) {
    const a = String(address ?? '').trim();
    if (!a) return { ok: false, error: 'Enter an Ethereum address.' };
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return { ok: false, error: 'An Ethereum address is 0x followed by 40 hex characters.' };
    const body = a.slice(2);
    const checksummed = toChecksumAddress(a);
    const mixed = body !== body.toLowerCase() && body !== body.toUpperCase();
    if (mixed && checksummed !== a) return { ok: false, error: 'The address checksum (upper/lower case) is wrong: a typo?' };
    if (/^0x0{40}$/i.test(a)) return { ok: false, error: 'That is the zero address; funds sent there are lost.' };
    return { ok: true, address: checksummed, checksummed: mixed };
}

// ---- IC principal as bytes32 (ckETH helper contract) ----

/**
 * The 32-byte encoding the ckETH/ckERC20 helper contracts take: one length byte, the principal's
 * bytes, then zeros. Same as DFINITY's principal_to_bytes.js / encodePrincipalToEthAddress.
 */
export function principalToBytes32(principal) {
    const p = typeof principal === 'string' ? Principal.fromText(principal) : principal;
    const raw = p.toUint8Array();
    if (raw.length > 29) throw new Error('Principal too long');
    const out = new Uint8Array(32);
    out[0] = raw.length;
    out.set(raw, 1);
    return `0x${toHex(out)}`;
}

/// A 32-byte subaccount as bytes32 hex (all zeros for the default account).
export function subaccountToBytes32(subaccount) {
    const out = new Uint8Array(32);
    if (subaccount && subaccount.length) {
        if (subaccount.length !== 32) throw new Error('A subaccount is 32 bytes');
        out.set(subaccount);
    }
    return `0x${toHex(out)}`;
}

// ---- Call data (Solidity ABI, static types only) ----

export const SELECTORS = {
    depositEth: '17c819c4', // depositEth(bytes32,bytes32)
    depositErc20: 'db9751af', // depositErc20(address,uint256,bytes32,bytes32)
    approve: '095ea7b3', // approve(address,uint256)
    allowance: 'dd62ed3e', // allowance(address,address)
    balanceOf: '70a08231', // balanceOf(address)
};
/// First four bytes of keccak256(signature), hex without 0x.
export const selectorOf = (signature) => toHex(keccak_256(new TextEncoder().encode(signature))).slice(0, 8);

const word = (hexNo0x) => hexNo0x.toLowerCase().padStart(64, '0');
const addrWord = (address) => word(parseEthAddressStrict(address).slice(2));
const uintWord = (n) => {
    const v = BigInt(n);
    if (v < 0n || v >= 1n << 256n) throw new Error('uint256 out of range');
    return word(v.toString(16));
};
const b32Word = (hex) => {
    const h = String(hex).replace(/^0x/, '');
    if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error('bytes32 must be 32 bytes of hex');
    return h.toLowerCase();
};
function parseEthAddressStrict(a) {
    const r = parseEthAddress(a);
    if (!r.ok) throw new Error(r.error);
    return r.address;
}

export const encodeDepositEth = (principal, subaccount = null) =>
    `0x${SELECTORS.depositEth}${b32Word(principalToBytes32(principal))}${b32Word(subaccountToBytes32(subaccount))}`;
export const encodeDepositErc20 = (token, amount, principal, subaccount = null) =>
    `0x${SELECTORS.depositErc20}${addrWord(token)}${uintWord(amount)}${b32Word(principalToBytes32(principal))}${b32Word(subaccountToBytes32(subaccount))}`;
export const encodeErc20Approve = (spender, amount) => `0x${SELECTORS.approve}${addrWord(spender)}${uintWord(amount)}`;
export const encodeErc20Allowance = (owner, spender) => `0x${SELECTORS.allowance}${addrWord(owner)}${addrWord(spender)}`;
export const encodeErc20BalanceOf = (owner) => `0x${SELECTORS.balanceOf}${addrWord(owner)}`;
/// A uint256 return value (0x-hex) as bigint.
export const decodeUint = (hex) => (hex && hex !== '0x' ? BigInt(hex.length > 66 ? `0x${hex.slice(2, 66)}` : hex) : 0n);
