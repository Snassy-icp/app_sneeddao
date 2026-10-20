// Checks a .wasm.gz against a canister's module hash and DFINITY's official ledger suite builds:
// sha256(file) must equal the module hash, and sha256(gunzip(file)) is looked up among the raw
// (decompressed) Wasm hashes of every official release. Runs in the browser (and node 18+):
// crypto.subtle and DecompressionStream, nothing leaves the machine.
import { DFINITY_LEDGER_RELEASES } from './dfinityReleases.js';

const RELEASES_BY_RAW = new Map();
for (const [gz, r] of Object.entries(DFINITY_LEDGER_RELEASES)) if (r.raw) RELEASES_BY_RAW.set(r.raw, [...(RELEASES_BY_RAW.get(r.raw) || []), { ...r, gz }]);
/// Official releases whose decompressed Wasm has this SHA-256.
export const officialReleasesForRaw = (raw) => RELEASES_BY_RAW.get(raw) || [];

const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
export const sha256Hex = async (bytes) => toHex(await crypto.subtle.digest('SHA-256', bytes));

export async function gunzip(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/// { fileHash, matchesModule, rawHash, releases, gzipError }
export async function verifyWasmGz(bytes, moduleHash) {
    const fileHash = await sha256Hex(bytes);
    let raw;
    try { raw = await gunzip(bytes); } catch (e) { return { fileHash, matchesModule: fileHash === moduleHash, rawHash: null, releases: [], gzipError: String(e?.message || e) }; }
    const rawHash = await sha256Hex(raw);
    return { fileHash, matchesModule: fileHash === moduleHash, rawHash, releases: officialReleasesForRaw(rawHash), gzipError: null };
}

// Hosts the hub's Content-Security-Policy (connect-src in public/.ic-assets.json5) lets the browser
// download from. Anything else is blocked before it leaves, so the box asks for the file instead.
const ALLOWED_HOSTS = [/^raw\.githubusercontent\.com$/, /^objects\.githubusercontent\.com$/, /^github\.com$/, /^(.+\.)?icp0\.io$/, /^(.+\.)?ic0\.app$/];
export function urlAllowed(url) {
    try { const u = new URL(url); return u.protocol === 'https:' && ALLOWED_HOSTS.some((r) => r.test(u.hostname)); } catch { return false; }
}
