import { Principal } from '@dfinity/principal';
import { principalToSubAccount } from '@dfinity/utils';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';

// Helpers for moving freshly claimed locked-position fees from the user's
// backend wallet (their subaccount on sneed_lock, where the ICPSwap pool
// delivers them) on to their frontend wallet (their principal's main account).
//
// Everything here is best effort: if any step fails or times out, the fees are
// simply left in the backend wallet, from where the user can move them later.

const toPrincipal = (p) => (typeof p === 'string' ? Principal.fromText(p) : p);
const keyOf = (p) => toPrincipal(p).toText();

// Balance of the user's backend wallet (sneed_lock subaccount) on a ledger.
export const readBackendWalletBalance = async (ledgerId, userPrincipal) => {
    const ledger = createLedgerActor(toPrincipal(ledgerId));
    return BigInt(await ledger.icrc1_balance_of({
        owner: Principal.fromText(sneedLockCanisterId),
        subaccount: [principalToSubAccount(userPrincipal)]
    }));
};

// Snapshot backend-wallet balances before a claim so that the delivery of the
// claimed amount can be recognised afterwards. Returns a Map keyed by ledger
// text; ledgers that could not be read are absent.
export const readBackendWalletBaselines = async (ledgerIds, userPrincipal) => {
    const baselines = new Map();
    for (const ledgerId of ledgerIds) {
        if (!ledgerId) continue;
        try {
            baselines.set(keyOf(ledgerId), await readBackendWalletBalance(ledgerId, userPrincipal));
        } catch (e) {
            console.warn('Could not read backend wallet baseline for', keyOf(ledgerId), e);
        }
    }
    return baselines;
};

// Forward claimed fees to the frontend wallet.
//   claimed: [{ ledger, amount }] where amount is what the pool reported as
//            claimed (before its delivery fee)
//   baselines: Map from readBackendWalletBaselines (may be empty)
// Returns one entry per token describing what happened.
export const forwardClaimedFees = async ({ identity, claimed, baselines = new Map(), onStatus = () => {}, timeoutMs = 30000 }) => {
    const user = identity.getPrincipal();
    const sneedLock = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
    const results = [];

    for (const { ledger, amount } of claimed) {
        if (!ledger) continue;
        const ledgerId = toPrincipal(ledger);
        const ledgerKey = ledgerId.toText();
        const claimedAmount = BigInt(amount);
        if (claimedAmount === 0n) continue;

        let fee;
        try {
            fee = BigInt(await createLedgerActor(ledgerId).icrc1_fee());
        } catch (e) {
            results.push({ ledger: ledgerKey, forwarded: false, reason: 'fee lookup failed' });
            continue;
        }

        // The pool charges one ledger fee on delivery; forwarding costs one more.
        // Only forward when the result is still a positive amount.
        const delivered = claimedAmount > fee ? claimedAmount - fee : 0n;
        if (delivered <= fee) {
            results.push({ ledger: ledgerKey, forwarded: false, reason: 'amount too small to forward' });
            continue;
        }
        const forwardAmount = delivered - fee;

        // Wait for the pool's asynchronous delivery to land in the backend wallet.
        // With a baseline we wait for the balance to rise by the delivered amount;
        // without one we only require the balance to cover the delivery.
        const baseline = baselines.get(ledgerKey);
        const target = (baseline !== undefined ? baseline : 0n) + delivered;
        const deadline = Date.now() + timeoutMs;
        let landed = false;
        while (Date.now() < deadline) {
            try {
                if ((await readBackendWalletBalance(ledgerId, user)) >= target) {
                    landed = true;
                    break;
                }
            } catch (e) {
                console.warn('Backend wallet balance check failed for', ledgerKey, e);
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        if (!landed) {
            results.push({ ledger: ledgerKey, forwarded: false, reason: 'delivery still pending' });
            continue;
        }

        // Move exactly the claimed amount, never any other backend-wallet funds.
        onStatus('💸 Moving fees to your wallet...');
        try {
            const result = await sneedLock.transfer_tokens(user, [], ledgerId, forwardAmount);
            if ('Ok' in result) {
                results.push({ ledger: ledgerKey, forwarded: true, amount: forwardAmount });
            } else {
                results.push({ ledger: ledgerKey, forwarded: false, reason: JSON.stringify(result.Err, (k, v) => typeof v === 'bigint' ? v.toString() : v) });
            }
        } catch (e) {
            results.push({ ledger: ledgerKey, forwarded: false, reason: e.message || String(e) });
        }
    }

    return results;
};

export const describeForwarding = (results) => {
    if (results.length === 0) return 'Nothing to forward';
    const moved = results.filter(r => r.forwarded).length;
    const left = results.length - moved;
    if (left === 0) return 'Fees moved to your wallet';
    if (moved === 0) return 'Fees are in your backend wallet';
    return 'Some fees moved to your wallet, the rest are in your backend wallet';
};
