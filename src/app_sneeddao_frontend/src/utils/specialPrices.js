// Special prices (spec/special_prices.md): every canister that charges users has, next to its
// regular and premium prices, an admin price (for that canister's admins) and partner prices
// (per principal, with a public label and an optional expiry). The price charged is the lowest
// applicable one. These helpers read them from a canister actor and work out what a given user
// pays, so pages can show a "Partner price" / "Admin price" badge.
//
// Every canister exposes the same methods:
//   get_special_prices() -> { admin_prices : Prices; partners : vec { principal; label; prices; expires_at } }
//   get_special_prices_for(principal) -> { admin_prices : opt Prices; partner : opt { label; prices; expires_at } }
//   set_admin_prices(Prices), set_partner_prices(principal, { label; prices; expires_at }), remove_partner_prices(principal)
// where Prices is a record of `opt nat`, one per fee the canister charges.
//
// Calls fail softly (null) against a canister that does not have them yet, so the frontend works
// with both the old and the new canister during a proposal window.

const opt = (v) => (Array.isArray(v) ? (v.length ? v[0] : null) : v ?? null);

/// The special prices that apply to `principal` on the canister behind `actor`, or null.
/// Returns { admin: Prices|null, partner: { label, prices, expiresAt }|null } with Prices as
/// { field: bigint|null }.
export async function fetchSpecialPricesFor(actor, principal) {
    if (!actor || !principal || typeof actor.get_special_prices_for !== 'function') return null;
    try {
        const r = await actor.get_special_prices_for(principal);
        const admin = opt(r.admin_prices);
        const partner = opt(r.partner);
        return {
            admin: admin ? unwrapPrices(admin) : null,
            partner: partner ? { label: partner.label, prices: unwrapPrices(partner.prices), expiresAt: opt(partner.expires_at) } : null,
        };
    } catch {
        return null;
    }
}

/// The public configuration: { admin: Prices, partners: [{ principal, label, prices, expiresAt }] }, or null.
export async function fetchSpecialPrices(actor) {
    if (!actor || typeof actor.get_special_prices !== 'function') return null;
    try {
        const r = await actor.get_special_prices();
        return {
            admin: unwrapPrices(r.admin_prices),
            partners: r.partners.map((p) => ({ principal: p.principal, label: p.label, prices: unwrapPrices(p.prices), expiresAt: opt(p.expires_at) })),
        };
    } catch {
        return null;
    }
}

/// A Candid record of `opt nat` fields as { field: bigint|null }.
export function unwrapPrices(rec) {
    return Object.fromEntries(Object.entries(rec || {}).map(([k, v]) => [k, opt(v)]));
}

/// { field: bigint|null } back to the Candid record of `opt nat`.
export function wrapPrices(prices) {
    return Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, v === null || v === undefined ? [] : [BigInt(v)]]));
}

/// The price a user pays for one fee, with the tier that gave it: the lowest of regular, premium
/// (when `isPremium` and a premium price exists), admin and partner (from fetchSpecialPricesFor).
/// Ties keep the earlier tier, as the canisters do. Returns { amount: bigint, tier, partnerLabel }.
export function effectivePrice({ regular, premium = null, isPremium = false, special = null, field }) {
    let amount = BigInt(regular ?? 0);
    let tier = 'regular';
    const consider = (v, t) => {
        if (v === null || v === undefined) return;
        const b = BigInt(v);
        if (b < amount) { amount = b; tier = t; }
    };
    if (isPremium) consider(premium, 'premium');
    if (special?.admin) consider(special.admin[field], 'admin');
    if (special?.partner) {
        const exp = special.partner.expiresAt;
        const live = exp === null || exp === undefined || BigInt(exp) > BigInt(Date.now()) * 1_000_000n;
        if (live) consider(special.partner.prices[field], 'partner');
    }
    return { amount, tier, partnerLabel: tier === 'partner' ? special.partner.label : null };
}

/// `price_tier` as written by the canisters (variant or text) as a plain string.
export function tierName(t) {
    if (!t) return 'regular';
    if (typeof t === 'string') return t;
    const k = Object.keys(t)[0];
    return k || 'regular';
}
