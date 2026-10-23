// Error texts for native Bitcoin sends (spec/sneed_wallet.md §5.3 step 6), in the style of
// btcWithdrawErrorText. Pure, tested.
//
// What a typed Err from btc_caller_send means (signer lib.rs): the signer first takes its fee
// (PAYMENT_GUARD.deduct), then builds, signs and broadcasts. So:
//   - PaymentError: nothing was charged and nothing was sent;
//   - BuildP2wpkhError / InternalError: the signing cycles were charged, nothing was broadcast
//     (a broadcast failure also comes back as InternalError).
// Either way the coins did not move, and the pending record becomes `failed`.

const k0 = (v) => (v && typeof v === 'object' ? Object.keys(v)[0] : null);
const sats = (n) => `${BigInt(n).toLocaleString('en-US')} sats`;
const cyc = (n) => `${(Number(n) / 1e9).toFixed(2).replace(/\.00$/, '')}B cycles`;

function withdrawFromText(e) {
    const k = k0(e);
    const v = e?.[k];
    switch (k) {
        case 'InsufficientAllowance': return `the signer's allowance on the cycles ledger is too small (${cyc(v.allowance)} left). Approve again and retry.`;
        case 'InsufficientFunds': return `your signing credit is too low (${cyc(v.balance)}). Top up and retry.`;
        case 'TemporarilyUnavailable': return 'the cycles ledger is busy. Retry in a moment.';
        case 'FailedToWithdrawFrom': return `the cycles ledger could not pay the signer (${v.rejection_reason}).`;
        case 'GenericError': return `the cycles ledger refused: ${v.message}.`;
        case 'TooOld':
        case 'CreatedInFuture': return 'the cycles ledger refused the timing of the payment. Retry.';
        default: return `the cycles ledger refused the payment (${k || 'unknown'}).`;
    }
}

/// { text, charged, topUp } for a PaymentError.
function paymentErrorText(e) {
    const k = k0(e);
    const v = e?.[k];
    switch (k) {
        case 'InsufficientFunds': return { text: `Not enough signing credit: the signer needs ${cyc(v.needed)}, ${cyc(v.available)} are available. Top up your signing credit, then send again.`, topUp: true };
        case 'LedgerWithdrawFromError': {
            const inner = k0(v.error);
            return { text: `Payment for signing failed: ${withdrawFromText(v.error)}`, topUp: inner === 'InsufficientFunds', reapprove: inner === 'InsufficientAllowance' };
        }
        case 'LedgerUnreachable': return { text: 'The signer could not reach the cycles ledger. Nothing was sent; try again later.' };
        case 'UnsupportedPaymentType':
        case 'InvalidPatron': return { text: `The signer refused the payment method (${k}). Nothing was sent.` };
        case 'LedgerTransferFromError': return { text: 'The signer could not take its fee. Nothing was sent.' };
        default: return { text: `Payment for signing failed (${k || 'unknown'}). Nothing was sent.` };
    }
}

/**
 * A btc_caller_send / btc_caller_sign Err as { text, charged, topUp?, reapprove? }:
 *   charged  the signing cycles were spent
 *   topUp    the fix is more signing credit
 *   reapprove the fix is a new approval
 */
export function sendErrorInfo(err) {
    const k = k0(err);
    const v = err?.[k];
    if (k === 'PaymentError') return { charged: false, ...paymentErrorText(v) };
    if (k === 'BuildP2wpkhError') {
        const b = k0(v);
        const bv = v?.[b];
        const tail = ' Your bitcoin did not move; the signing cycles for this attempt were spent.';
        switch (b) {
            case 'NotEnoughFunds': return { charged: true, text: `The signer counted ${sats(bv.available)} in the chosen coins, but ${sats(bv.required)} are needed. Refresh your balance and try again.${tail}` };
            case 'WrongBitcoinNetwork': return { charged: true, text: `The recipient address is for another Bitcoin network.${tail}` };
            case 'InvalidDestinationAddress': return { charged: true, text: `The signer could not read the recipient address ${bv.address}.${tail}` };
            case 'InvalidSourceAddress':
            case 'NotP2WPKHSourceAddress': return { charged: true, text: `The signer could not use your own address (${b}). Please report this.${tail}` };
            default: return { charged: true, text: `The signer could not build the transaction (${b || 'unknown'}).${tail}` };
        }
    }
    if (k === 'InternalError') return { charged: true, text: `The signer reported an error: ${v.msg}. Your bitcoin did not move; the signing cycles for this attempt were spent.` };
    return { charged: false, text: `Unknown answer from the signer (${k || 'empty'}).` };
}

export const sendErrorText = (err) => sendErrorInfo(err).text;

/// btc_caller_address Err (GetAddressError) as text.
export function addressErrorText(err) {
    const k = k0(err);
    if (k === 'PaymentError') return paymentErrorText(err.PaymentError).text;
    if (k === 'InternalError') return `The signer reported an error: ${err.InternalError.msg}`;
    return `Unknown answer from the signer (${k || 'empty'}).`;
}

/// A thrown call (agent error, timeout, closed tab): the outcome is unknown.
export function callFailureText(e) {
    const m = String(e?.message || e || '');
    return `No answer from the signer${m ? ` (${m.split('\n')[0].slice(0, 200)})` : ''}. The send may or may not have gone out; the coins stay reserved until we know. See Activity for what happens next.`;
}
