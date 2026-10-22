// Helpers shared by the pocket adapters (spec/programmable_accounts.md §4.2). No React, no keys:
// every call goes through actors the context hands out, made with the user's identity.
import { Principal } from '@dfinity/principal';
import { icrc1Transfer, icrc2Approve, expiresInMs } from '../../icrcTx.js';
import { toOpt } from '../subaccount.js';

const json = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? Array.from(x) : x));

/// A canister's error value as words.
export function errText(e) {
    if (e == null) return 'unknown error';
    if (typeof e === 'string') return e;
    if (e instanceof Error) return e.message;
    const [k, v] = Object.entries(e)[0] || [];
    if (k === 'InsufficientFunds') return `insufficient funds${v?.balance != null ? ` (balance ${v.balance})` : v?.available != null ? ` (available ${v.available})` : ''}`;
    if (k === 'BadFee') return `the fee is now ${v.expected_fee}`;
    if (k === 'GenericError') return v.message;
    if (k === 'InvalidState' || k === 'TransferFailed' || k === 'InternalError') return String(v);
    return v == null || (typeof v === 'object' && !Object.keys(v).length) ? k : `${k}: ${json(v)}`;
}

/// { Ok } | { ok } as the value; { Err } | { err } as a thrown Error.
export function unwrapResult(r, what) {
    if (r && typeof r === 'object') {
        if ('Ok' in r) return r.Ok;
        if ('ok' in r) return r.ok;
        if ('Err' in r) throw new Error(`${what}: ${errText(r.Err)}`);
        if ('err' in r) throw new Error(`${what}: ${errText(r.err)}`);
    }
    return r;
}

export const big = (v) => { try { return v == null ? 0n : BigInt(v); } catch { return 0n; } };
export const principal = (p) => (typeof p === 'string' ? Principal.fromText(p) : p);
export const text = (p) => (typeof p === 'string' ? p : p.toText());
export const minus = (a, b) => (a > b ? a - b : 0n);

/// The ledger fee: from ctx.ledgerMeta when it knows, else icrc1_fee.
export async function feeOf(ctx, ledger) {
    const m = ctx.ledgerMeta ? await ctx.ledgerMeta(text(ledger)) : null;
    if (m?.fee != null) return big(m.fee);
    return big(await ctx.actor('ledger', text(ledger)).icrc1_fee());
}

export const ledgerBalance = (ctx, ledger, account) => ctx.actor('ledger', text(ledger)).icrc1_balance_of({ owner: account.owner, subaccount: toOpt(account.subaccount) });

/// icrc1_transfer from the user's (sub)account; returns the block, throws when refused.
export async function transferFromWallet(ctx, ledger, fromSubaccount, to, amount, fee) {
    const r = await icrc1Transfer(ctx.actor('ledger', text(ledger)), {
        from_subaccount: toOpt(fromSubaccount), to: { owner: to.owner, subaccount: toOpt(to.subaccount) },
        amount: big(amount), fee: fee == null ? [] : [big(fee)], memo: [], created_at_time: [],
    });
    return unwrapResult(r, 'The transfer did not go through');
}

/// icrc2_approve from the user's (sub)account (expires in an hour by default); returns the block.
export async function approveFromWallet(ctx, ledger, fromSubaccount, spender, amount, { expiresAt = expiresInMs() } = {}) {
    const r = await icrc2Approve(ctx.actor('ledger', text(ledger)), {
        from_subaccount: toOpt(fromSubaccount), spender: { owner: spender.owner, subaccount: toOpt(spender.subaccount) }, amount: big(amount),
        expected_allowance: [], expires_at: expiresAt, fee: [], memo: [], created_at_time: [],
    });
    return unwrapResult(r, 'The ledger refused the approval');
}

/// Memoize per context (one wallet refresh): the same read is made once.
export function once(ctx, key, fn) {
    if (!ctx._memo) Object.defineProperty(ctx, '_memo', { value: new Map(), enumerable: false });
    if (!ctx._memo.has(key)) ctx._memo.set(key, Promise.resolve().then(fn).catch((e) => { ctx._memo.delete(key); throw e; }));
    return ctx._memo.get(key);
}
