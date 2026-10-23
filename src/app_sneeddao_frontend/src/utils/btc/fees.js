// Bitcoin fee rates for native sends (spec/sneed_wallet.md §5.4, Q4 decided: mempool.space first).
//
// The browser fetches mempool.space's recommended rates (sat/vB) for the network (mainnet, or
// testnet4 on staging). No address or principal is sent: the request is the same for everyone.
// The answer is third-party data, so it is bounded before use:
//   - every value must be a finite number in (0, SANE_MAX]; otherwise the whole answer is refused
//     and the user picks a custom rate (Advanced) instead. We never fall back to the signer's own
//     median (fee_satoshis = null), which underestimates and gives no preview.
//   - rates are raised to at least MIN_RATE and made monotone (slow ≤ normal ≤ fast).
// The fee is always shown in sats before signing, and a fee far above "fast" needs an extra yes.
//
// Privacy (user decision, 2026-10-23): fees are fetched only when the send form is open, never on
// wallet or card load; only the generic recommended-fees endpoint is called (no address, no txid);
// no credentials, no referrer. The UI names mempool.space as the source next to the fee choice,
// always offers a visible "Custom" rate, and has a remembered "Don't look up fees (enter my own)"
// switch (feeLookupDisabled / setFeeLookupDisabled). A custom rate gets warnings, not a block,
// when it is unusual but valid.
// Pure apart from fetchFeeRates (which takes fetchImpl) and the switch; cached in memory for CACHE_MS.

export const MEMPOOL_API = Object.freeze({
    mainnet: 'https://mempool.space/api',
    testnet: 'https://mempool.space/testnet4/api',
});
/// sat/vB. 1 sat/vB is the relay minimum the IC's Bitcoin adapter can count on.
export const MIN_RATE = 1;
/// A recommended rate above this is treated as a broken or hostile answer.
export const SANE_MAX = 2000;
/// Custom rates above this are refused as typos (a 1-in-1-out send would pay > 0.011 BTC).
export const CUSTOM_MAX = 10000;
/// Custom rates above this get a warning.
export const CUSTOM_WARN_ABOVE = 500;
export const CACHE_MS = 60_000;
/// Rough confirmation targets of mempool.space's tiers (fastestFee ≈ next block, halfHourFee ≈ 3,
/// hourFee ≈ 6).
export const TIER_BLOCKS = Object.freeze({ slow: 6, normal: 3, fast: 1 });
export const TIERS = Object.freeze(['slow', 'normal', 'fast']);

const num = (v) => (typeof v === 'number' ? v : NaN);

/// mempool.space /v1/fees/recommended → { ok, tiers: { slow, normal, fast }, minimum } or { ok: false, error }.
export function parseRecommended(json) {
    if (!json || typeof json !== 'object') return { ok: false, error: 'No fee data' };
    const raw = { fast: num(json.fastestFee), normal: num(json.halfHourFee), slow: num(json.hourFee), minimum: num(json.minimumFee) };
    for (const [k, v] of Object.entries(raw)) {
        if (!Number.isFinite(v) || v <= 0 || v > SANE_MAX) return { ok: false, error: `Implausible fee rate from mempool.space (${k}: ${String(v)})` };
    }
    const slow = Math.max(MIN_RATE, raw.slow);
    const normal = Math.max(slow, raw.normal);
    const fast = Math.max(normal, raw.fast);
    return { ok: true, tiers: { slow, normal, fast }, minimum: Math.max(MIN_RATE, raw.minimum) };
}

/// A custom rate typed by the user: { ok, rate, warn } or { ok: false, error }. Only nonsense is
/// refused (not a number, ≤ 0, more than 3 decimals, above CUSTOM_MAX); unusual but valid rates
/// pass with a warning the form shows.
export function validateCustomRate(text, tiers = null) {
    const s = String(text ?? '').trim();
    if (!s) return { ok: false, error: 'Enter a fee rate in sat/vB.' };
    if (!/^\d+(\.\d{1,3})?$/.test(s)) return { ok: false, error: 'A fee rate is a number like 3 or 2.5 (sat/vB).' };
    const rate = Number(s);
    if (rate <= 0) return { ok: false, error: 'The fee rate must be above 0.' };
    if (rate > CUSTOM_MAX) return { ok: false, error: `${rate} sat/vB looks like a typo; this form takes at most ${CUSTOM_MAX}.` };
    const warns = [];
    if (rate < MIN_RATE) warns.push(`Below ${MIN_RATE} sat/vB many nodes won't relay the transaction; it may never confirm, and its coins stay reserved until you mark it dropped.`);
    if (tiers && rate < tiers.slow) warns.push(`Below the current "Slow" rate (${tiers.slow} sat/vB): it may take a long time to confirm.`);
    if (tiers && rate > tiers.fast * 3) warns.push(`More than 3× the current "Fast" rate (${tiers.fast} sat/vB).`);
    else if (rate > CUSTOM_WARN_ABOVE) warns.push(`That is a very high rate (over ${CUSTOM_WARN_ABOVE} sat/vB).`);
    return { ok: true, rate, warn: warns.length ? warns.join(' ') : null };
}

/// Does this send need the extra "yes, the fee is right" tick (spec §5.3 step 3)?
/// A fee above 10% of the amount, or a rate above 3× "Fast".
export function feeNeedsExtraConfirm({ fee, amount, feeRate, tiers = null }) {
    const reasons = [];
    if (amount > 0n && fee * 10n > amount) reasons.push('the network fee is more than 10% of the amount');
    if (tiers && feeRate > tiers.fast * 3) reasons.push('the fee rate is more than 3× the current "Fast" rate');
    return reasons;
}

// ---- "Don't look up fees (enter my own)", remembered per browser ----
export const NO_LOOKUP_KEY = 'sneed_btc_no_fee_lookup_v1';
export function feeLookupDisabled(storage = (typeof window !== 'undefined' ? window.localStorage : null)) {
    try { return storage?.getItem(NO_LOOKUP_KEY) === '1'; } catch { return false; }
}
export function setFeeLookupDisabled(on, storage = (typeof window !== 'undefined' ? window.localStorage : null)) {
    try { if (on) storage?.setItem(NO_LOOKUP_KEY, '1'); else storage?.removeItem(NO_LOOKUP_KEY); } catch { /* storage blocked: not remembered */ }
}

const cache = new Map();
export const clearFeeCache = () => cache.clear();

/// Recommended rates for `network` ('mainnet' | 'testnet'). { ok, tiers, minimum, at, source } or { ok: false, error }.
export async function fetchFeeRates(network, { fetchImpl = (typeof fetch !== 'undefined' ? fetch : null), now = Date.now, timeoutMs = 8000, fresh = false } = {}) {
    const base = MEMPOOL_API[network];
    if (!base) return { ok: false, error: `No fee source for ${network}` };
    const hit = cache.get(network);
    if (!fresh && hit && now() - hit.at < CACHE_MS) return hit;
    if (!fetchImpl) return { ok: false, error: 'No network access' };
    let timer = null;
    try {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        if (ctrl) timer = setTimeout(() => ctrl.abort(), timeoutMs);
        const res = await fetchImpl(`${base}/v1/fees/recommended`, { signal: ctrl?.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
        if (!res.ok) return { ok: false, error: `mempool.space answered ${res.status}` };
        const parsed = parseRecommended(await res.json());
        if (!parsed.ok) return parsed;
        const out = { ...parsed, at: now(), source: 'mempool.space' };
        cache.set(network, out);
        return out;
    } catch (e) {
        return { ok: false, error: e?.name === 'AbortError' ? 'mempool.space did not answer in time' : `Couldn't reach mempool.space (${e?.message || e})` };
    } finally {
        if (timer) clearTimeout(timer);
    }
}
