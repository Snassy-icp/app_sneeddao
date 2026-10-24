// sneed_notifications withdraw errors as words, with no imports, so the pocket adapter (which also
// runs in the canister tests) and the notifications page share them.
const icp = (e8s) => `${(Number(e8s) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 })} ICP`;

/// A withdraw error (sneed_notifications WithdrawError) as words.
export function withdrawErrorText(e) {
    const [k, v] = Object.entries(e || {})[0] || [];
    switch (k) {
        case 'not_signed_in': return 'Please log in';
        case 'rate_limited': return 'Too many withdrawals at once; try again in a minute';
        case 'busy': return 'Another withdrawal of yours is under way; try again in a moment';
        case 'invalid': return v;
        case 'amount_too_small': return `Withdraw more than the ledger fee (at least ${icp(v.min_e8s)})`;
        case 'insufficient_balance': return `Your message balance is ${icp(v.balance_e8s)}`;
        case 'duplicate': return `This exact withdrawal was already made (ledger block ${v.ledger_block}); nothing more moved`;
        case 'refused': return v;
        case 'pending': return `An earlier withdrawal of ${icp(v.amount_e8s)} is still waiting for the ledger's answer. It is retried automatically and goes out at most once; check again in a few minutes`;
        default: return k || 'The withdrawal failed';
    }
}

