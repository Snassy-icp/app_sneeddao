// The txid of a send before it is signed (spec/sneed_wallet.md §5.3 step 5). Pure, tested
// against real mainnet transactions in test/canisters/tests/btc-send.test.js.
//
// A segwit txid is double-SHA256 of the transaction WITHOUT witnesses, so it is fixed once the
// inputs, outputs, version, locktime and sequences are. The Chain Fusion Signer builds
// (tx_utils.rs build_p2wpkh_transaction): version 2, locktime 0, every input with an empty
// scriptSig and nSequence 0xFFFFFFFF, inputs in our order, outputs in our order, then the change
// output (to the sender's own address) when the remainder is ≥ 1,000 sats. Knowing the txid up
// front lets the pending record (utils/btc/pending.js) find the transaction after a lost reply,
// and makes a re-issued identical send a harmless duplicate.
import { sha256 } from '@noble/hashes/sha256';
import { bech32Decode, base58Decode, parseBtcAddress } from '../ckAddress.js';

export const SIGNER_TX_VERSION = 2;
export const SIGNER_TX_LOCKTIME = 0;
export const SIGNER_TX_SEQUENCE = 0xffffffff;

const fromHex = (h) => {
    if (!/^([0-9a-f]{2})*$/i.test(h)) throw new Error('Bad hex');
    return Uint8Array.from((h.match(/../g) || []).map((x) => parseInt(x, 16)));
};
const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/// Display txid (as explorers show it) → the 32 bytes in transaction (internal) order.
export const txidToInternal = (display) => {
    const b = fromHex(display);
    if (b.length !== 32) throw new Error('A txid is 32 bytes');
    return b.reverse();
};

function fiveToEight(words) {
    let acc = 0; let bits = 0; const out = [];
    for (const v of words) {
        acc = (acc << 5) | v; bits += 5;
        while (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
    }
    return Uint8Array.from(out);
}

/// The scriptPubKey an address pays to. Throws on an address that is invalid or of another network.
export function scriptPubKey(address, network) {
    const p = parseBtcAddress(address, network);
    if (!p.ok) throw new Error(p.error);
    const a = String(address).trim();
    if (p.type === 'p2wpkh' || p.type === 'p2wsh' || p.type === 'p2tr') {
        const d = bech32Decode(a);
        const version = d.data[0];
        const program = fiveToEight(d.data.slice(1));
        return Uint8Array.from([version === 0 ? 0x00 : 0x50 + version, program.length, ...program]);
    }
    const hash = base58Decode(a).slice(1, 21);
    if (p.type === 'p2pkh') return Uint8Array.from([0x76, 0xa9, 0x14, ...hash, 0x88, 0xac]);
    return Uint8Array.from([0xa9, 0x14, ...hash, 0x87]); // p2sh
}

/// Address type for the size estimate (select.js OUTPUT_VBYTES), or null when invalid.
export function addressType(address, network) {
    const p = parseBtcAddress(address, network);
    return p.ok ? p.type : null;
}

const u32le = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
const u64le = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
function varint(n) {
    if (n < 0xfd) return Uint8Array.of(n);
    if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >> 8);
    return Uint8Array.from([0xfe, ...u32le(n)]);
}
const concat = (parts) => {
    const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
};

/**
 * The non-witness serialisation of a transaction whose inputs all have empty scriptSigs
 * (native segwit inputs, as every Sneed Wallet input is).
 *   inputs:  [{ txid (display hex), vout }]
 *   outputs: [{ script (Uint8Array), value (sats) }]
 */
export function serializeNonWitness({ inputs, outputs, version = SIGNER_TX_VERSION, locktime = SIGNER_TX_LOCKTIME, sequence = SIGNER_TX_SEQUENCE }) {
    const parts = [u32le(version), varint(inputs.length)];
    for (const i of inputs) parts.push(txidToInternal(i.txid), u32le(i.vout), varint(0), u32le(i.sequence ?? sequence));
    parts.push(varint(outputs.length));
    for (const o of outputs) parts.push(u64le(o.value), varint(o.script.length), o.script);
    parts.push(u32le(locktime));
    return concat(parts);
}

/// txid (display hex) of such a transaction.
export function computeTxid(tx) {
    return toHex(sha256(sha256(serializeNonWitness(tx))).reverse());
}

/**
 * The txid the signer's transaction will have for this send.
 *   inputs    [{ txid, vout }] in request order
 *   outputs   [{ address, value }] in request order
 *   change    sats returned to `ownAddress` (0n / null for none)
 * Returns { txid, changeVout } (changeVout null without change).
 */
export function expectedTxid({ inputs, outputs, change = 0n, ownAddress, network }) {
    const outs = outputs.map((o) => ({ script: scriptPubKey(o.address, network), value: BigInt(o.value) }));
    let changeVout = null;
    if (change != null && BigInt(change) > 0n) {
        changeVout = outs.length;
        outs.push({ script: scriptPubKey(ownAddress, network), value: BigInt(change) });
    }
    return { txid: computeTxid({ inputs, outputs: outs }), changeVout };
}
