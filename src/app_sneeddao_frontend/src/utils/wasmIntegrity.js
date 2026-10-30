// Checks a downloaded wasm module before it is installed (the bot upgrade dialog).

import { sha256 } from '@noble/hashes/sha256';

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/// Throws unless `bytes` is a wasm module (plain or gzipped) whose sha256 is `expectedHash` (hex,
/// as the app version publishes it; an opt text may come as [] or [hash]). A version without a
/// published hash is refused: a file from a URL alone can't be trusted.
export function verifyDownloadedWasm(bytes, expectedHash, label = 'this version') {
    const expected = String((Array.isArray(expectedHash) ? expectedHash[0] : expectedHash) || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error(`No published WASM hash for ${label}: refusing to install an unverified file`);
    if (!bytes || bytes.length === 0) throw new Error('Downloaded WASM file is empty');
    const isWasmMagic = bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6D;
    const isGzip = bytes[0] === 0x1F && bytes[1] === 0x8B;
    if (!isWasmMagic && !isGzip) throw new Error('Downloaded file is not a valid WASM module');
    const got = toHex(sha256(bytes));
    if (got !== expected) throw new Error(`Downloaded WASM for ${label} does not match its published hash (got ${got.slice(0, 12)}…, expected ${expected.slice(0, 12)}…): not installed`);
}
