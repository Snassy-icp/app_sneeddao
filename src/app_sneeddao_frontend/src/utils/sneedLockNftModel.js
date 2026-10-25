// What a Sneed Lock NFT holds (spec/sneed_lock_v2.md sections 2 and 3), as plain functions: the
// tokens of a token lock or an ICPSwap LP position, their value, and the lock's state. Shared by
// the Sneed Lock NFT summary (Sneedex offers, /nft_item) and Position.jsx. No canister calls.

const NEVER_NS = 18_446_744_073_709_551_615n;
const big = (v) => (typeof v === 'bigint' ? v : BigInt(v ?? 0));
const opt = (v) => (Array.isArray(v) ? (v.length ? v[0] : null) : (v ?? null));

// ---- v3 math (floats are fine for display; the pool decides) ----
export const sqrtAtTick = (t) => 1.0001 ** (t / 2);
/** Base-unit amounts of liquidity L in [tickLower, tickUpper] at sqrt price sqrtP (token1 per token0, base units). */
export function amountsForLiquidity(L, tickLower, tickUpper, sqrtP) {
    const sl = sqrtAtTick(tickLower); const su = sqrtAtTick(tickUpper);
    if (sqrtP <= sl) return { amount0: L * (su - sl) / (sl * su), amount1: 0, inRange: false };
    if (sqrtP >= su) return { amount0: 0, amount1: L * (su - sl), inRange: false };
    return { amount0: L * (su - sqrtP) / (sqrtP * su), amount1: L * (sqrtP - sl), inRange: true };
}

/** A USD price per whole token, or null when unknown (the price service answers 0 for "no price"). */
export const knownPrice = (p) => (typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : null);

/** USD value of base units at a price, or null when the price is unknown (nothing to value is worth 0). */
function valueOf(units, decimals, price) {
    if (!(units > 0)) return 0;
    const p = knownPrice(price);
    return p === null ? null : (units / 10 ** decimals) * p;
}

/** A token lock: { units (base units, bigint), whole (number), usd (number | null) }. */
export function tokenLockValue(amount, decimals, price) {
    const units = big(amount);
    const usd = valueOf(Number(units), decimals, price);
    return { units, whole: Number(units) / 10 ** decimals, usd };
}

/**
 * An LP position: amounts in the position plus its uncollected fees (tokensOwed), as the lock page
 * counts them, and the total value. usd is null when a side with tokens has no known price.
 * position: { liquidity, tickLower, tickUpper, tokensOwed0, tokensOwed1 }; sqrtPriceX96 from the pool.
 */
export function positionLockValue(position, sqrtPriceX96, d0, d1, p0, p1) {
    const sqrtP = Number(big(sqrtPriceX96)) / 2 ** 96;
    const { amount0, amount1, inRange } = amountsForLiquidity(Number(big(position.liquidity)), Number(position.tickLower), Number(position.tickUpper), sqrtP);
    const fees0 = Number(big(position.tokensOwed0)); const fees1 = Number(big(position.tokensOwed1));
    const total0 = amount0 + fees0; const total1 = amount1 + fees1;
    const v0 = valueOf(total0, d0, p0); const v1 = valueOf(total1, d1, p1);
    return {
        amount0: amount0 / 10 ** d0, amount1: amount1 / 10 ** d1,
        fees0: fees0 / 10 ** d0, fees1: fees1 / 10 ** d1,
        total0: total0 / 10 ** d0, total1: total1 / 10 ** d1,
        inRange,
        usd: v0 === null || v1 === null ? null : v0 + v1,
        usd0: v0, usd1: v1,
    };
}

/**
 * The state of a lock from its LockState (get_lock_state), at nowNs:
 *  { status: 'expired', at }      its unlock time has passed
 *  { status: 'until', at }        locked until a fixed time
 *  { status: 'dissolving', at, delayNs }  dissolving, free at `at`
 *  { status: 'held', delayNs, earliest }  a dissolve delay, not dissolving: free no sooner than `earliest`
 * Times are ns (bigint).
 */
export function lockStatus(state, nowNs) {
    const now = big(nowNs);
    const delayNs = big(state.dissolve_delay);
    const dissolvingUntil = opt(state.dissolving_until);
    const expiry = big(state.expiry);
    if (dissolvingUntil !== null) {
        const at = big(dissolvingUntil);
        return at <= now ? { status: 'expired', at } : { status: 'dissolving', at, delayNs };
    }
    if (expiry >= NEVER_NS) return { status: 'held', delayNs, earliest: big(state.earliest_unlock ?? (now + delayNs)) };
    return expiry <= now ? { status: 'expired', at: expiry } : { status: 'until', at: expiry };
}

/** The lock's kind and assets from a LockState: { kind: 'token', ledger, amount } or { kind: 'position', swap, positionId }. */
export function lockAssets(state) {
    const s = (p) => (p && typeof p.toText === 'function' ? p.toText() : p ? String(p) : null);
    if (state.kind && 'TokenLock' in state.kind) return { kind: 'token', ledger: s(opt(state.ledger)), amount: big(opt(state.amount)) };
    return { kind: 'position', swap: s(opt(state.swap_canister_id)), positionId: big(opt(state.position_id)), token0: s(opt(state.token0)), token1: s(opt(state.token1)) };
}

/** Formats a whole-token number: up to `max` decimals (never more than the token's), grouped. */
export const fmtWhole = (n, decimals = 8, max = 4) => Number(n).toLocaleString('en-US', { maximumFractionDigits: Math.min(decimals, n !== 0 && Math.abs(n) < 1 ? Math.max(max, 6) : max) });

/** /lock/<id>, the lock's own page. */
export const lockPageUrl = (lockId) => `/lock/${big(lockId).toString()}`;
