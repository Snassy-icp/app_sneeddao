// Display rules for Sneed Lock pages (audit 2026-11-02, low findings; pure, no imports).
//
// Expiry: a lock with a dissolve delay that is not dissolving carries 2^64-1 ns. Shown as a date
// that is the year 2554, and some pages called it "Never", which it is not: it unlocks once its
// owner dissolves it. It reads "until dissolved" everywhere.
//
// Decimals: pages fell back to 8 decimals when a token's were unknown (and `decimals || 8` turned
// a real 0 into 8), showing amounts off by powers of ten. Unknown decimals now show the raw base
// units, with a note, and no money value.

export const NEVER_NS = 18_446_744_073_709_551_615n;
export const UNTIL_DISSOLVED = 'until dissolved';
export const RAW_UNITS_NOTE = 'raw units: this token\'s decimals are unknown';

/** "until dissolved", "unknown" (no expiry), or `fmt(date)` for an expiry in ns (bigint/number/string). */
export function lockExpiryLabel(expiryNs, fmt = (d) => d.toLocaleString()) {
    if (expiryNs === undefined || expiryNs === null || expiryNs === '') return 'unknown';
    let e;
    try { e = BigInt(expiryNs); } catch { return 'unknown'; }
    if (e <= 0n) return 'unknown';
    if (e >= NEVER_NS) return UNTIL_DISSOLVED;
    return fmt(new Date(Number(e / 1_000_000n)));
}

/** The token's decimals as a number, or null when unknown (missing, not an integer 0..36). */
export function knownDecimals(d) {
    if (d === undefined || d === null || d === '') return null;
    const n = Number(d);
    return Number.isInteger(n) && n >= 0 && n <= 36 ? n : null;
}

/** Decimals to format with: the known ones, else 0 (raw base units). */
export const displayDecimals = (d) => knownDecimals(d) ?? 0;
