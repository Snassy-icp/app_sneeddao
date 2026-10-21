// Which price tier a sneed_pad quote reflects (spec/special_prices.md), for the "Admin price" /
// "Partner price" badge next to the fees. The pad's quote already carries the effective fees (it
// is computed for the caller); this works out whether an admin or partner price gave them.
// Returns { creation: { tier, partnerLabel }, control: { tier, partnerLabel } }, or null when the
// pad has no special prices yet (an older pad) or the call fails.
import { fetchSpecialPricesFor, effectivePrice } from '../utils/specialPrices';

export async function padQuoteTiers(actor, principal, quote, { index = false } = {}) {
    if (!actor || !principal || !quote) return null;
    const [special, cfg] = await Promise.all([fetchSpecialPricesFor(actor, principal), actor.get_config().catch(() => null)]);
    if (!special || !cfg) return null;
    const base = index
        ? (quote.premium ? cfg.premium_index_creation_fee_e8s : cfg.index_creation_fee_e8s)
        : (quote.premium ? cfg.premium_creation_fee_e8s : cfg.creation_fee_e8s);
    const creation = effectivePrice({ regular: base, special, field: index ? 'index_creation_fee_e8s' : 'creation_fee_e8s' });
    const control = quote.control_fee_e8s > 0n
        ? effectivePrice({ regular: cfg.sneed_dao_control_fee_e8s, special, field: 'sneed_dao_control_fee_e8s' })
        : { tier: 'regular', partnerLabel: null };
    return { creation, control };
}
