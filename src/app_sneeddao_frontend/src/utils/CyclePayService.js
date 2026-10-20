// CyclePay (cyclepay.org, 2bwus-iiaaa-aaaac-bee3a-cai): cycles for ck-USDC, at the protocol price.
// The payer approves CyclePay on the ck-USDC ledger for amount + fee, then topup_ckusdc pulls it and
// delivers the cycles; a request_id names the payment, so a retry resumes it and never pays twice.
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { createActor as createLedger } from 'external/icrc1_ledger';

export const CYCLEPAY_CANISTER_ID = '2bwus-iiaaa-aaaac-bee3a-cai';
export const CKUSDC_LEDGER_ID = 'xevnm-gaaaa-aaaar-qafnq-cai';
export const CKUSDC_DECIMALS = 6;
const host = 'https://icp0.io';

/// Only on mainnet networks: CyclePay has no local deployment.
export const cyclePayAvailable = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging';

const idlFactory = ({ IDL }) => {
    const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
    const Terms = IDL.Record({
        max_amount_atomic: IDL.Nat64, step_atomic: IDL.Nat64, ledger: IDL.Principal, fee_read_at: IDL.Opt(IDL.Nat64),
        fee_atomic: IDL.Nat64, min_amount_atomic: IDL.Nat64, spender: Account,
    });
    const OrderDestination = IDL.Variant({ Canister: IDL.Principal, Ledger: IDL.Null });
    const Status = IDL.Variant({
        Refunding: IDL.Null, Fulfilling: IDL.Null, Refunded: IDL.Null, Pulling: IDL.Null,
        Delivered: IDL.Null, Rejected: IDL.Null, Pulled: IDL.Null, Deferred: IDL.Null,
    });
    // Only the fields Sneed Hub reads; candid subtyping drops the rest.
    const Payment = IDL.Record({
        request_id: IDL.Text, status: Status, amount_atomic: IDL.Nat64, cycles: IDL.Opt(IDL.Nat64),
        error: IDL.Opt(IDL.Text), deferred_until: IDL.Opt(IDL.Nat64), amount_usd_cents: IDL.Nat64,
    });
    const Args = IDL.Record({
        request_id: IDL.Text, amount_atomic: IDL.Nat, destination: OrderDestination, beneficiary: IDL.Opt(IDL.Principal),
        project_id: IDL.Opt(IDL.Text), confirm_system_canister: IDL.Opt(IDL.Bool),
    });
    const XdrRate = IDL.Record({ xdr_usd_x10000: IDL.Nat64, stale: IDL.Bool });
    return IDL.Service({
        get_ckusdc_terms: IDL.Func([], [Terms], ['query']),
        get_xdr_rate_status: IDL.Func([], [XdrRate], ['query']),
        topup_ckusdc: IDL.Func([Args], [IDL.Variant({ Ok: Payment, Err: IDL.Record({ code: IDL.Text, message: IDL.Text, resets_at: IDL.Opt(IDL.Nat64) }) })], []),
        topup_ckusdc_status: IDL.Func([IDL.Text], [IDL.Opt(Payment)], ['query']),
    });
};

const agentFor = (identity) => HttpAgent.createSync({ host, identity: identity || undefined });
const cyclePay = (identity) => Actor.createActor(idlFactory, { agent: agentFor(identity), canisterId: CYCLEPAY_CANISTER_ID });
const ckUsdcLedger = (identity) => createLedger(CKUSDC_LEDGER_ID, { agent: agentFor(identity) });

/// { minUsd, maxUsd, feeUsd (one ledger fee), cyclesPerUsd } — 1 XDR buys 1T cycles.
export async function getCkUsdcTerms() {
    const [t, rate] = await Promise.all([cyclePay().get_ckusdc_terms(), cyclePay().get_xdr_rate_status()]);
    const usd = (atomic) => Number(atomic) / 10 ** CKUSDC_DECIMALS;
    const usdPerXdr = Number(rate.xdr_usd_x10000) / 10_000;
    return {
        minUsd: usd(t.min_amount_atomic), maxUsd: usd(t.max_amount_atomic), feeUsd: usd(t.fee_atomic),
        feeAtomic: BigInt(t.fee_atomic), spender: t.spender.owner,
        cyclesPerUsd: usdPerXdr > 0 ? 1e12 / usdPerXdr : null, rateStale: rate.stale,
    };
}

export async function getCkUsdcBalance(identity) {
    const bal = await ckUsdcLedger(identity).icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] });
    return Number(bal) / 10 ** CKUSDC_DECIMALS;
}

/// Whole cents, as CyclePay requires.
export const toAtomicCents = (usd) => BigInt(Math.round(usd * 100)) * 10_000n;

const TERMINAL = ['Delivered', 'Refunded', 'Rejected', 'Deferred'];
const statusOf = (p) => Object.keys(p.status)[0];

/// Approve and pay `usd` (whole cents) for cycles to `canisterId`; waits up to ~2 minutes for the
/// delivery. Returns { status, cycles, error }: status 'Delivered' on success; 'Deferred' when the
/// daily limit holds it (CyclePay delivers it later); otherwise still in progress or refunded.
export async function topUpWithCkUsdc(identity, canisterId, usd, { feeAtomic, onStatus } = {}) {
    const amount = toAtomicCents(usd);
    const fee = feeAtomic ?? 10_000n;
    const approve = await ckUsdcLedger(identity).icrc2_approve({
        from_subaccount: [], spender: { owner: Principal.fromText(CYCLEPAY_CANISTER_ID), subaccount: [] },
        amount: amount + fee, expected_allowance: [], expires_at: [BigInt(Date.now() + 10 * 60_000) * 1_000_000n],
        fee: [], memo: [], created_at_time: [],
    });
    if ('Err' in approve) {
        const e = approve.Err;
        throw new Error('InsufficientFunds' in e ? 'Not enough ck-USDC for the payment and the ledger fees' : `The ck-USDC ledger refused the approval: ${Object.keys(e)[0]}`);
    }
    const requestId = `sneedhub-${crypto.randomUUID()}`;
    const args = { request_id: requestId, amount_atomic: amount, destination: { Canister: Principal.fromText(String(canisterId)) }, beneficiary: [], project_id: [], confirm_system_canister: [] };
    const r = await cyclePay(identity).topup_ckusdc(args);
    if ('Err' in r) throw new Error(`CyclePay: ${r.Err.message || r.Err.code}`);
    let p = r.Ok;
    for (let i = 0; i < 40 && !TERMINAL.includes(statusOf(p)); i++) {
        onStatus?.(statusOf(p));
        await new Promise((res) => setTimeout(res, 3000));
        p = (await cyclePay(identity).topup_ckusdc_status(requestId))[0] || p;
    }
    return { status: statusOf(p), cycles: p.cycles[0] != null ? Number(p.cycles[0]) : 0, error: p.error[0] || null, requestId };
}
