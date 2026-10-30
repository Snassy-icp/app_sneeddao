// Special prices (admin / partner) and Premium, as the frontend's utils/specialPrices.js applies them:
// the lowest of the regular price, the premium price (members only), the admin price (principals on
// the canister's admin list) and an unexpired partner price.
import { idlFactory as premiumIdl } from './idl/sneed_premium.did.js';
import { actor, CANISTERS, opt, toPrincipal } from './ic.js';

/// { admin_prices, partner } with opts unwrapped, or null when the canister has no such method.
export const specialPricesFor = async (a, principal) => {
  try {
    const r = await a.get_special_prices_for(toPrincipal(principal));
    return { admin: opt(r.admin_prices), partner: opt(r.partner) };
  } catch { return null; }
};

/// The effective price for `field` and which tier gave it.
export const effectivePrice = ({ regular, premium = null, isPremium = false, special = null, field, nowNs = BigInt(Date.now()) * 1_000_000n }) => {
  let best = { price: BigInt(regular), tier: 'regular' };
  const consider = (v, tier) => { if (v != null && BigInt(v) < best.price) best = { price: BigInt(v), tier }; };
  if (isPremium && premium != null) consider(premium, 'premium');
  if (special?.admin) consider(opt(special.admin[field]), 'admin');
  if (special?.partner) {
    const exp = opt(special.partner.expires_at);
    if (exp == null || BigInt(exp) > nowNs) consider(opt(special.partner.prices[field]), `partner (${special.partner.label})`);
  }
  return best;
};

/// Premium membership of a principal: { active, expires } (Sneed Premium checkMembership), read with
/// `anon` (a write context's actor factory, or the shared anonymous one).
export const premiumStatus = async (principal, anon = actor) => {
  const p = await anon(premiumIdl, CANISTERS.sneed_premium);
  const s = await p.checkMembership(toPrincipal(principal));
  if ('Active' in s) return { active: true, expires: s.Active.expiration };
  if ('Expired' in s) return { active: false, expired_at: s.Expired.expiredAt };
  return { active: false };
};
