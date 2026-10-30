// How much to pay into the Premium deposit subaccount before purchaseWithIcp (the Premium page's
// "Pay Now"). The canister matches the WHOLE deposit balance to a tier's price, so the deposit must
// end up holding exactly the price: send only what is missing.

/// { send } (e8s to transfer, 0n when the deposit already holds exactly the price), or
/// { tooMuch: true } when the deposit already holds more than the price (no tier would match: it
/// must be withdrawn first).
export function planPremiumPayment(depositE8s, priceE8s) {
    const deposit = BigInt(depositE8s);
    const price = BigInt(priceE8s);
    if (deposit === price) return { send: 0n };
    if (deposit < price) return { send: price - deposit };
    return { tooMuch: true };
}
