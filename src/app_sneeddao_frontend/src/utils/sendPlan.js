// How a wallet send is split between the two places a user's tokens can be:
// the wallet itself (the user's principal account on the ledger) and the
// user's Sneed Lock subaccount (the "backend"; only its unlocked part can move).
//
// Each source pays its own transfer fee:
//   - from the wallet: icrc1_transfer of `amount`, costs amount + fee;
//   - from the backend: sneed_lock.transfer_tokens(amount), which requires
//     amount + fee <= backend balance - locked.
// A send that uses both makes two transfers to the recipient and so pays two
// fees. The largest amount that can be sent is therefore the sum of what each
// source can give after its own fee, counting a source only when it holds
// more than one fee.
//
// All amounts are BigInt base units.

const toBig = (v) => {
    try {
        if (v === undefined || v === null || v === '') return 0n;
        return BigInt(v);
    } catch {
        return 0n;
    }
};

/// The two balances and the fee a send can use.
export function sendSources(token) {
    const fee = toBig(token?.fee);
    const hasBalance = token?.balance !== undefined && token?.balance !== null;
    const frontend = hasBalance ? toBig(token.balance) : toBig(token?.available);
    let backend;
    if (token?.balance_backend !== undefined && token?.balance_backend !== null) {
        backend = toBig(token.balance_backend) - toBig(token.locked);
    } else if (token?.available_backend !== undefined && token?.available_backend !== null) {
        backend = toBig(token.available_backend);
    } else if (hasBalance && token?.available !== undefined && token?.available !== null) {
        backend = toBig(token.available) - frontend;
    } else {
        backend = 0n;
    }
    if (backend < 0n) backend = 0n;
    return { frontend: frontend < 0n ? 0n : frontend, backend, fee };
}

/// What each source can give after paying its own fee (0 when it cannot pay it).
function usable(token, { frontendOnly = false } = {}) {
    const { frontend, backend, fee } = sendSources(token);
    const frontendUsable = frontend > fee ? frontend - fee : 0n;
    const backendUsable = !frontendOnly && backend > fee ? backend - fee : 0n;
    return { frontendUsable, backendUsable, fee };
}

/// The largest amount that a send can deliver. `frontendOnly` is for sends the
/// backend cannot make (ICP legacy transfers to an account id).
export function maxSendable(token, opts) {
    const { frontendUsable, backendUsable } = usable(token, opts);
    return frontendUsable + backendUsable;
}

/// Split `amount` into { send_from_backend, send_from_frontend }, preferring a
/// single transfer (backend first, then wallet) and splitting only when neither
/// source alone can cover it. Returns null when the amount cannot be sent.
export function planSend(token, amount, opts) {
    const a = toBig(amount);
    if (a <= 0n) return null;
    const { frontendUsable, backendUsable } = usable(token, opts);
    if (a <= backendUsable) return { send_from_backend: a, send_from_frontend: 0n };
    if (a <= frontendUsable) return { send_from_backend: 0n, send_from_frontend: a };
    if (backendUsable > 0n && frontendUsable > 0n && a <= backendUsable + frontendUsable) {
        return { send_from_backend: backendUsable, send_from_frontend: a - backendUsable };
    }
    return null;
}

/// Number of ledger fees a planned send pays.
export function planFeeCount(plan) {
    if (!plan) return 0;
    return (plan.send_from_backend > 0n ? 1 : 0) + (plan.send_from_frontend > 0n ? 1 : 0);
}

// ---- pockets (spec/programmable_accounts.md §4.2) ----
// In "All pockets" mode a send keeps the Main + Sneed Lock split above, reading both through the
// pockets model when it has them (Main = the 'w:0' pocket, Sneed Lock = 'h:sneed_lock:wallet');
// with one pocket selected a send uses that pocket only (planFromPocket).

const MAIN_POCKET = 'w:0';
const LOCK_POCKET = 'h:sneed_lock:wallet';

/// The token with `balance`, `balance_backend` and `locked` taken from the pockets model where it
/// knows them for this ledger (else the token's own fields).
export function tokenWithPockets(token, pockets, ledgerId) {
    if (!token || !pockets?.length || !ledgerId) return token;
    const l = String(ledgerId);
    const main = pockets.find((p) => p.id === MAIN_POCKET)?.balances?.get(l);
    const lock = pockets.find((p) => p.id === LOCK_POCKET)?.balances?.get(l);
    if (!main && !lock) return token;
    const out = { ...token };
    if (main) out.balance = main.total;
    if (lock) { out.balance_backend = lock.total; out.locked = lock.locked ?? 0n; }
    return out;
}

/// A send from one pocket: `withdrawable` is what that pocket can deliver (its adapter's rules).
/// Returns { amount, fees: 1 } or null when it can't.
export function planFromPocket(withdrawable, amount) {
    const a = toBig(amount);
    if (a <= 0n || a > toBig(withdrawable)) return null;
    return { amount: a, fees: 1 };
}
