// Signing credit for native Bitcoin (spec/sneed_wallet.md §5.3 step 4, §7; Q5 decided: users
// always pay). The user pays the Chain Fusion Signer in cycles from their own account on the
// cycles ledger: an ICRC-2 approve of the signer for exactly what the next calls cost, valid
// for one hour, then each signer call carries `opt variant { CallerPaysIcrc2Cycles }` and the
// signer takes its fee with the cycles ledger's `withdraw_from`.
//
// Costs, from dfinity/chain-fusion-signer src/signer/api/src/methods.rs (read 2026-10-23):
//   btc_caller_send     95B + 37B per input + 1B per output, where the signer always prices
//                       one extra output for a possible change (lib.rs: outputs.len() + 1)
//   btc_caller_address  0.079B
//   btc_caller_balance  0.113B
// and from dfinity/cycles-ledger (storage.rs): every approve costs the 0.1B ledger fee, and every
// withdraw_from uses `amount + 0.1B` of the allowance and of the balance.
// So the allowance a set of signer calls needs is Σ (cost + 0.1B), and the balance needs that
// plus 0.1B for the approve itself when a new approve is made.
//
// Pure apart from readCredit / approveSigner / revokeSigner, which take a cycles-ledger actor
// (the ICRC-1/2 IDL in external/icrc1_ledger fits it).
import { Principal } from '@dfinity/principal';
import { SIGNER_CANISTER } from './network.js';

export const CYCLES_LEDGER = 'um5iw-rqaaa-aaaaq-qaaba-cai';
export const CYCLES_LEDGER_FEE = 100_000_000n; // 0.1B
export const SEND_BASE_CYCLES = 95_000_000_000n;
export const SEND_PER_INPUT_CYCLES = 37_000_000_000n;
export const SEND_PER_OUTPUT_CYCLES = 1_000_000_000n;
export const ADDRESS_CYCLES = 79_000_000n;
/// btc_caller_balance (the replicated balance cross-check, phase A4): methods.rs BtcCallerBalance.
export const BALANCE_CYCLES = 113_000_000n;
export const APPROVAL_TTL_NS = 3_600n * 1_000_000_000n; // one hour, as ckMinters.js
/// An allowance that expires sooner than this is renewed instead of used.
export const APPROVAL_MIN_LEFT_NS = 10n * 60n * 1_000_000_000n;
/// The usual send (1 input → 1 recipient + change), for "enough for ~N sends".
export const TYPICAL_SEND_CYCLES = SEND_BASE_CYCLES + SEND_PER_INPUT_CYCLES + 2n * SEND_PER_OUTPUT_CYCLES;

/// What btc_caller_send charges for `nInputs` inputs and `nOutputs` requested outputs (change
/// excluded: the signer adds one output to the price whether change is made or not).
export function sendCycles(nInputs, nOutputs = 1) {
    return SEND_BASE_CYCLES + BigInt(nInputs) * SEND_PER_INPUT_CYCLES + BigInt(nOutputs + 1) * SEND_PER_OUTPUT_CYCLES;
}

/// What one signer charge uses from the allowance (and the balance): the charge plus the
/// withdraw_from fee.
export const withAllowanceFee = (cycles) => BigInt(cycles) + CYCLES_LEDGER_FEE;

/**
 * Plan the payment for a set of signer charges.
 *   balance      the user's cycles-ledger balance
 *   allowance    { allowance, expiresAt (ns or null) } granted to the signer
 *   charges      [cycles] the signer will take, one per call
 *   nowNs        current time in ns
 * Returns { allowanceNeeded, approveNeeded, balanceNeeded, shortfall, signerCycles, ledgerFees,
 *           totalCycles }.
 */
export function creditPlan({ balance, allowance = { allowance: 0n, expiresAt: null }, charges, nowNs }) {
    const signerCycles = charges.reduce((t, c) => t + BigInt(c), 0n);
    const allowanceNeeded = charges.reduce((t, c) => t + withAllowanceFee(c), 0n);
    const current = BigInt(allowance?.allowance ?? 0n);
    const exp = allowance?.expiresAt == null ? null : BigInt(allowance.expiresAt);
    const fresh = exp == null || exp > BigInt(nowNs) + APPROVAL_MIN_LEFT_NS;
    const approveNeeded = !(current >= allowanceNeeded && fresh);
    const balanceNeeded = allowanceNeeded + (approveNeeded ? CYCLES_LEDGER_FEE : 0n);
    const bal = BigInt(balance ?? 0n);
    const shortfall = bal >= balanceNeeded ? 0n : balanceNeeded - bal;
    const ledgerFees = BigInt(charges.length) * CYCLES_LEDGER_FEE + (approveNeeded ? CYCLES_LEDGER_FEE : 0n);
    return { allowanceNeeded, approveNeeded, balanceNeeded, shortfall, signerCycles, ledgerFees, totalCycles: signerCycles + ledgerFees };
}

/// icrc2_approve args: the signer may take exactly `amount` within the next hour. `expected` (the
/// allowance we read) makes the ledger refuse if something else changed it meanwhile.
export function approveArgs({ amount, nowNs, expected = null, ttlNs = APPROVAL_TTL_NS, signer = SIGNER_CANISTER }) {
    return {
        from_subaccount: [],
        spender: { owner: Principal.fromText(signer), subaccount: [] },
        amount: BigInt(amount),
        expected_allowance: expected == null ? [] : [BigInt(expected)],
        expires_at: [BigInt(nowNs) + ttlNs],
        fee: [CYCLES_LEDGER_FEE],
        memo: [],
        created_at_time: [BigInt(nowNs)],
    };
}

/// icrc2_approve args that set the signer's allowance to 0 (costs the 0.1B ledger fee).
export function revokeArgs({ nowNs, signer = SIGNER_CANISTER }) {
    return {
        from_subaccount: [],
        spender: { owner: Principal.fromText(signer), subaccount: [] },
        amount: 0n,
        expected_allowance: [],
        expires_at: [],
        fee: [CYCLES_LEDGER_FEE],
        memo: [],
        created_at_time: [BigInt(nowNs)],
    };
}

/// How many typical sends the balance pays for (approve fee counted once).
export function sendsAffordable(balance) {
    const b = BigInt(balance ?? 0n) - CYCLES_LEDGER_FEE;
    return b <= 0n ? 0 : Number(b / withAllowanceFee(TYPICAL_SEND_CYCLES));
}

/// A sentence for an icrc2_approve error.
export function approveErrorText(err) {
    const k = err && Object.keys(err)[0];
    const v = err?.[k];
    switch (k) {
        case 'InsufficientFunds': return `Not enough signing credit for the approval fee (balance ${v.balance} cycles).`;
        case 'AllowanceChanged': return 'The signer allowance changed while you were approving. Try again.';
        case 'Expired': return 'The approval would already be expired (clock problem). Check your device clock and try again.';
        case 'BadFee': return `The cycles ledger asks a fee of ${v.expected_fee} cycles. Try again.`;
        case 'TooOld':
        case 'CreatedInFuture': return 'Your device clock is off by too much. Fix the clock and try again.';
        case 'Duplicate': return 'This approval was already made.';
        case 'TemporarilyUnavailable': return 'The cycles ledger is busy. Try again in a moment.';
        case 'GenericError': return `The cycles ledger refused: ${v.message}`;
        default: return `The cycles ledger refused the approval (${k || 'unknown error'}).`;
    }
}

/// { balance, allowance, expiresAt } for `me` on the cycles ledger.
export async function readCredit(cyclesLedger, me, signer = SIGNER_CANISTER) {
    const owner = typeof me === 'string' ? Principal.fromText(me) : me;
    const [balance, a] = await Promise.all([
        cyclesLedger.icrc1_balance_of({ owner, subaccount: [] }),
        cyclesLedger.icrc2_allowance({ account: { owner, subaccount: [] }, spender: { owner: Principal.fromText(signer), subaccount: [] } }),
    ]);
    return { balance: BigInt(balance), allowance: BigInt(a.allowance), expiresAt: a.expires_at?.[0] != null ? BigInt(a.expires_at[0]) : null };
}

/// Approve the signer for exactly `amount`. { ok: true, block } or { ok: false, error, raw }.
/// A Duplicate answer means the same approve already landed (a retried request), so it is ok.
export async function approveSigner(cyclesLedger, { amount, nowNs, expected = null }) {
    const res = await cyclesLedger.icrc2_approve(approveArgs({ amount, nowNs, expected }));
    if (res && 'Ok' in res) return { ok: true, block: BigInt(res.Ok) };
    if (res?.Err && 'Duplicate' in res.Err) return { ok: true, block: BigInt(res.Err.Duplicate.duplicate_of) };
    return { ok: false, error: approveErrorText(res?.Err), raw: res?.Err };
}

/// Set the signer's allowance to 0.
export async function revokeSigner(cyclesLedger, { nowNs }) {
    const res = await cyclesLedger.icrc2_approve(revokeArgs({ nowNs }));
    if (res && 'Ok' in res) return { ok: true, block: BigInt(res.Ok) };
    return { ok: false, error: approveErrorText(res?.Err), raw: res?.Err };
}

// ---- ICP → cycles (the CMC's rate) ----

/// Cycles the CMC mints for `e8s` ICP at `xdrPermyriadPerIcp` (1 T cycles = 1 XDR):
/// cycles = e8s × permyriad.
export const cyclesForIcp = (e8s, xdrPermyriadPerIcp) => BigInt(e8s) * BigInt(xdrPermyriadPerIcp);
/// ICP e8s needed for at least `cycles` (rounded up).
export const icpForCycles = (cycles, xdrPermyriadPerIcp) => {
    const p = BigInt(xdrPermyriadPerIcp);
    if (p <= 0n) throw new Error('No ICP/XDR rate');
    return (BigInt(cycles) + p - 1n) / p;
};
/// Value of `cycles` in USD from the ICP price and the CMC rate (null when either is missing).
export function cyclesUsd(cycles, { icpUsd, xdrPermyriadPerIcp }) {
    if (!icpUsd || !xdrPermyriadPerIcp) return null;
    return (Number(cycles) / (Number(xdrPermyriadPerIcp) * 1e8)) * icpUsd;
}
/// "134B" / "1.25T" cycles.
const trim = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
export function formatCycles(cycles) {
    const n = Number(cycles);
    if (n >= 1e12) return `${trim((n / 1e12).toFixed(n >= 1e13 ? 1 : 3))}T`;
    if (n >= 1e9) return `${trim((n / 1e9).toFixed(n >= 1e11 ? 0 : 2))}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
    return `${n}`;
}
