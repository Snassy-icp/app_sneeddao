// Which price tier a Sneedapp mint price came from (spec/special_prices.md), for the
// "Admin price" / "Partner price" badge. getAppMintPrice(appId, user).applicable already includes
// special prices (Sneed DAO apps only), so the badge shows only when `applicable` is below the
// user's regular or premium price; the overrides from get_special_prices_for tell which tier gave it.
// Against a Sneedapp without special prices this returns { tier: 'regular' | 'premium' }.
import { fetchSpecialPricesFor, effectivePrice } from './specialPrices';

export async function mintPriceTier(factory, principal, appPrice) {
    const base = BigInt(appPrice.isPremium ? appPrice.premium : appPrice.regular);
    const plain = { tier: appPrice.isPremium ? 'premium' : 'regular', partnerLabel: null };
    if (BigInt(appPrice.applicable) >= base) return plain;
    const special = await fetchSpecialPricesFor(factory, principal);
    if (!special) return plain;
    const e = effectivePrice({ regular: base, special, field: 'mint_fee_e8s' });
    return e.tier === 'admin' || e.tier === 'partner' ? { tier: e.tier, partnerLabel: e.partnerLabel } : plain;
}
