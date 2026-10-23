// A principal's Sneed Wallet Bitcoin address, derived offline (spec/sneed_wallet.md §3.1, §5.2).
//
// The Chain Fusion Signer (grghe-syaaa-aaaar-qabyq-cai) derives each caller's BTC key from its own
// threshold ECDSA key (key_1) with the derivation path [0x00 (schema Btc), caller principal bytes]
// and returns the P2WPKH address of that key. The derivation is public-key-only (BIP-32-like, as
// the IC's ic_secp256k1::PublicKey::derive_subkey_with_chain_code), so anyone can compute any
// principal's address without an IC call. This is a port of @dfinity/ic-pub-key 1.0.2
// (src/ecdsa/secp256k1.ts DerivationPath.ckd / ckd_pub / derive_offset and src/signer/btc.ts),
// using the audited @noble libraries the app already ships. Checked against that library and its
// published vectors in test/canisters/tests/btc-native.test.js.
//
// The signer uses one key for every network: mainnet, testnet (testnet4) and regtest differ only
// in the address prefix (bc / tb / bcrt).
//
// Pure: no React, no network. Cached per (principal, network) in memory.
import { secp256k1 } from '@noble/curves/secp256k1';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha512';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { Principal } from '@dfinity/principal';

const Point = secp256k1.ProjectivePoint;
const ORDER = secp256k1.CURVE.n;

const fromHex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const bytesToBig = (b) => (b.length ? BigInt(`0x${toHex(b)}`) : 0n);

/// The signer canister's public key and chain code (its key_1 key derived for the signer canister),
/// as published in @dfinity/ic-pub-key 1.0.2 (src/signer/btc.ts CHAIN_FUSION_SIGNER_PUBKEY /
/// CHAIN_FUSION_SIGNER_CHAINCODE).
export const SIGNER_PUBKEY_HEX = '0259761672ec7ee3bdc5eca95ba5f6a493d1133b86a76163b68af30c06fe3b75c0';
export const SIGNER_CHAINCODE_HEX = 'f666a98c7f70fe281ca8142f14eb4d1e0934a439237da83869e2cfd924b270c0';
/// The signer's schema byte for a principal's default Bitcoin key (derivation_path.rs Schema::Btc).
export const BTC_SCHEMA = 0x00;

const HRP = { mainnet: 'bc', testnet: 'tb', regtest: 'bcrt' };

// ---- key derivation (ic_secp256k1 DerivationPath) ----

/// HMAC-SHA512(chain_code, input || idx) → [next chain code, offset < n]; on offset ≥ n, retry with
/// input = 0x01 || next chain code (as ic_secp256k1 / SLIP-0010).
function ckd(idx, input, chainCode) {
    const msg = new Uint8Array(input.length + idx.length);
    msg.set(input);
    msg.set(idx, input.length);
    const out = hmac(sha512, chainCode, msg);
    const offset = bytesToBig(out.subarray(0, 32));
    const next = Uint8Array.from(out.subarray(32, 64));
    if (offset >= ORDER) {
        const retry = new Uint8Array(33);
        retry[0] = 0x01;
        retry.set(next, 1);
        return ckd(idx, retry, chainCode);
    }
    return [next, offset];
}

/// One public derivation step: point + offset·G (never the point at infinity).
function ckdPub(idx, point, chainCode) {
    const input = point.toRawBytes(true);
    for (;;) {
        const [next, offset] = ckd(idx, input, chainCode);
        const pt = offset === 0n ? point : point.add(Point.BASE.multiply(offset));
        if (!pt.equals(Point.ZERO)) return [next, pt];
        input[0] = 0x01;
        input.set(next, 1);
    }
}

/// Derive a SEC1-compressed public key along `path` (array of byte arrays).
export function deriveSubkey(pubkey, chainCode, path) {
    let point = Point.fromHex(pubkey);
    let cc = chainCode;
    for (const idx of path) [cc, point] = ckdPub(idx, point, cc);
    return { publicKey: point.toRawBytes(true), chainCode: cc };
}

// ---- P2WPKH (BIP-173 bech32, witness v0) ----

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function polymod(values) {
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
function toWords(bytes) {
    let acc = 0; let bits = 0; const out = [];
    for (const b of bytes) {
        acc = (acc << 8) | b; bits += 8;
        while (bits >= 5) { bits -= 5; out.push((acc >> bits) & 31); }
    }
    if (bits) out.push((acc << (5 - bits)) & 31);
    return out;
}
function bech32Encode(hrp, words) {
    const values = hrpExpand(hrp).concat(words, [0, 0, 0, 0, 0, 0]);
    const mod = polymod(values) ^ 1; // bech32 (not bech32m): witness v0
    const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >> (5 * (5 - i))) & 31);
    return `${hrp}1${words.concat(checksum).map((w) => CHARSET[w]).join('')}`;
}

/// The P2WPKH address of a compressed public key on `network`.
export function p2wpkhAddress(publicKey, network = 'mainnet') {
    const hrp = HRP[network];
    if (!hrp) throw new Error(`Unknown Bitcoin network: ${network}`);
    if (publicKey.length !== 33 || (publicKey[0] !== 2 && publicKey[0] !== 3)) throw new Error('Expected a compressed public key');
    const hash = ripemd160(sha256(publicKey));
    return bech32Encode(hrp, [0, ...toWords(hash)]);
}

// ---- the signer's address for a principal ----

const asPrincipal = (p) => (typeof p === 'string' ? Principal.fromText(p) : p);

/// { address, publicKey (hex), network, path } for `principal` on `network`, as the signer's
/// btc_caller_address would return for that caller (address_type = P2WPKH).
export function deriveBtcAddress(principal, network = 'mainnet', { pubkeyHex = SIGNER_PUBKEY_HEX, chainCodeHex = SIGNER_CHAINCODE_HEX } = {}) {
    const p = asPrincipal(principal);
    const path = [Uint8Array.of(BTC_SCHEMA), p.toUint8Array()];
    const { publicKey } = deriveSubkey(fromHex(pubkeyHex), fromHex(chainCodeHex), path);
    return { address: p2wpkhAddress(publicKey, network), publicKey: toHex(publicKey), network, path: path.map(toHex) };
}

// ---- cache (spec §5.2 step 1: per principal) ----

const memo = new Map();

/// The address for (principal, network), derived once per page load (a few ms) and kept in memory.
/// Nothing is persisted: the address is always recomputed from the principal, never trusted from storage.
export function btcAddressFor(principal, network = 'mainnet') {
    const text = typeof principal === 'string' ? principal : principal.toText();
    const key = `${network}:${text}`;
    if (!memo.has(key)) memo.set(key, deriveBtcAddress(text, network).address);
    return memo.get(key);
}

/// `bitcoin:` URI for a QR code (BIP-21).
export const bitcoinUri = (address) => `bitcoin:${address}`;
