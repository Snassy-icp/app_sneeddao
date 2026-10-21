// Topping up a canister with cycles from ICP: an ICP transfer to the CMC's subaccount for the
// canister (memo TPUP), then `notify_top_up(block)` at the CMC. Every top-up in the frontend goes
// through `topUpCanisterWithIcp` so that a failed or interrupted notify never loses the ICP or
// pays twice:
//
//   1. A pending record {canister, amount, created_at_time, owner} is saved in localStorage
//      BEFORE the transfer; the transfer carries that created_at_time, so resending it is
//      deduplicated by the ledger (Duplicate { duplicate_of } gives us the block back).
//   2. The block index goes into the record before notify_top_up is called.
//   3. The record is removed only on a final outcome (Ok, Refunded, InvalidTransaction,
//      TransactionTooOld). Processing, Other, or a thrown call keep it.
//   4. While a record exists for a canister, a new top-up of that canister sends no ICP: it
//      finishes the pending one (resend-with-dedupe or re-notify the stored block) instead.
//
// notify_top_up is idempotent at the CMC and only mints for the right block + subaccount, so
// re-notifying is always safe; anyone may call it (see /tools/recover-topup).
//
// This module has no 'external/*' imports so node can test it (scripts/cyclesTopUp.test.mjs).
import { Principal } from '@dfinity/principal';
import { principalToSubAccount } from '@dfinity/utils';

export const CMC_CANISTER_ID_TEXT = 'rkp4c-7iaaa-aaaaa-aaaca-cai';
// "TPUP" = 0x50555054 as a little-endian u64
export const TOP_UP_MEMO = new Uint8Array([0x54, 0x50, 0x55, 0x50, 0x00, 0x00, 0x00, 0x00]);
export const ICP_FEE_E8S = 10_000n;
export const STORAGE_KEY = 'sneed_pending_cmc_topups_v1';
export const PENDING_TOPUPS_EVENT = 'sneed:pending-topups-changed';

const FINAL = new Set(['ok', 'refunded', 'invalid', 'too_old']);

// ---------------------------------------------------------------- storage (never throws)

function defaultStorage() {
    try { return typeof window !== 'undefined' ? window.localStorage : null; } catch (_) { return null; }
}

function readAll(storage) {
    try {
        const raw = storage?.getItem(STORAGE_KEY);
        const v = raw ? JSON.parse(raw) : {};
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (_) { return {}; }
}

function writeAll(storage, all) {
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (_) { /* full or blocked */ }
    try { if (typeof window !== 'undefined') window.dispatchEvent(new Event(PENDING_TOPUPS_EVENT)); } catch (_) {}
}

/** All pending top-ups, oldest first. Amounts and blocks are strings (BigInt-safe). */
export function loadPendingTopUps(storage = defaultStorage()) {
    return Object.values(readAll(storage)).sort((a, b) => (a.createdMs || 0) - (b.createdMs || 0));
}

export function getPendingTopUp(canisterId, storage = defaultStorage()) {
    return readAll(storage)[String(canisterId)] || null;
}

export function savePendingTopUp(record, storage = defaultStorage()) {
    const all = readAll(storage);
    all[record.canisterId] = record;
    writeAll(storage, all);
}

/** Forget a pending record (user dismissal, or a final outcome). */
export function removePendingTopUp(canisterId, storage = defaultStorage()) {
    const all = readAll(storage);
    if (!(String(canisterId) in all)) return;
    delete all[String(canisterId)];
    writeAll(storage, all);
}

// ---------------------------------------------------------------- notify

/**
 * notify_top_up once and normalise the answer:
 * { status: 'ok'|'processing'|'refunded'|'invalid'|'too_old'|'other'|'error', final, cycles?, refundBlock?, reason? }
 * Never throws.
 */
export async function notifyTopUpOnce({ cmc, canisterId, blockIndex }) {
    let res;
    try {
        res = await cmc.notify_top_up({
            block_index: BigInt(blockIndex),
            canister_id: Principal.fromText(String(canisterId)),
        });
    } catch (e) {
        return { status: 'error', final: false, reason: e?.message || String(e) };
    }
    if (res && 'Ok' in res) return { status: 'ok', final: true, cycles: BigInt(res.Ok) };
    const err = res?.Err || {};
    if ('Processing' in err) return { status: 'processing', final: false };
    if ('Refunded' in err) {
        const rb = err.Refunded.block_index?.[0];
        return { status: 'refunded', final: true, reason: err.Refunded.reason, refundBlock: rb !== undefined ? BigInt(rb) : null };
    }
    if ('InvalidTransaction' in err) return { status: 'invalid', final: true, reason: err.InvalidTransaction };
    if ('TransactionTooOld' in err) return { status: 'too_old', final: true, reason: `blocks before ${err.TransactionTooOld} can no longer be notified` };
    if ('Other' in err) return { status: 'other', final: false, reason: `${err.Other.error_message} (code ${err.Other.error_code})` };
    return { status: 'error', final: false, reason: `Unknown CMC answer: ${safeJson(res)}` };
}

/** notify, retrying a few times while the CMC answers Processing. */
export async function notifyTopUp({ cmc, canisterId, blockIndex, processingRetries = 2, sleep = defaultSleep }) {
    let out = await notifyTopUpOnce({ cmc, canisterId, blockIndex });
    for (let i = 0; i < processingRetries && out.status === 'processing'; i++) {
        await sleep(2000);
        out = await notifyTopUpOnce({ cmc, canisterId, blockIndex });
    }
    return out;
}

// ---------------------------------------------------------------- transfer

function transferArgs(rec) {
    return {
        to: { owner: Principal.fromText(CMC_CANISTER_ID_TEXT), subaccount: [principalToSubAccount(Principal.fromText(rec.canisterId))] },
        amount: BigInt(rec.amountE8s),
        fee: [BigInt(rec.feeE8s ?? ICP_FEE_E8S)],
        memo: [TOP_UP_MEMO],
        from_subaccount: [],
        created_at_time: [BigInt(rec.createdAtTime)],
    };
}

/**
 * Send (or resend, deduplicated) the record's transfer.
 * Returns { block } | { failed: err } (definitely not sent) | throws (outcome unknown).
 */
async function sendTransfer(ledger, rec, storage) {
    let res = await ledger.icrc1_transfer(transferArgs(rec));
    if (res && 'Err' in res && 'CreatedInFuture' in res.Err) {
        // Our clock is ahead of the ledger's; nothing was sent. Use the ledger's time.
        rec.createdAtTime = String(res.Err.CreatedInFuture.ledger_time);
        savePendingTopUp(rec, storage);
        res = await ledger.icrc1_transfer(transferArgs(rec));
    }
    if (res && 'Ok' in res) return { block: BigInt(res.Ok) };
    const err = res?.Err || {};
    if ('Duplicate' in err) return { block: BigInt(err.Duplicate.duplicate_of) };
    return { failed: err };
}

function describeTransferErr(err) {
    if (err && 'InsufficientFunds' in err) {
        return `Insufficient funds: ${(Number(err.InsufficientFunds.balance) / 1e8).toFixed(4)} ICP available`;
    }
    if (err && 'TooOld' in err) return 'TooOld';
    return `Transfer failed: ${safeJson(err)}`;
}

// ---------------------------------------------------------------- the flow

/**
 * Finish a pending top-up: resend its transfer (deduplicated) if we never learned its block,
 * then notify. Sends no new ICP. `owner` (principal text) guards the resend: a record made by
 * another identity is only re-notified, never re-transferred.
 */
export async function finishPendingTopUp({ ledger, cmc, canisterId, owner, storage = defaultStorage(), processingRetries, sleep }) {
    const rec = getPendingTopUp(canisterId, storage);
    if (!rec) return { status: 'none', final: true, canisterId: String(canisterId) };
    const base = { canisterId: rec.canisterId, amountE8s: BigInt(rec.amountE8s), resumed: true };

    if (rec.blockIndex == null) {
        if (!ledger || (rec.owner && owner && rec.owner !== owner)) {
            return { ...base, status: 'needs_owner', final: false, reason: 'This top-up was started by another login; sign in as that principal to finish it.' };
        }
        let sent;
        try { sent = await sendTransfer(ledger, rec, storage); } catch (e) {
            rec.lastError = e?.message || String(e);
            savePendingTopUp(rec, storage);
            return { ...base, status: 'transfer_unknown', final: false, reason: rec.lastError };
        }
        if (sent.failed) {
            removePendingTopUp(rec.canisterId, storage);
            if ('TooOld' in sent.failed) {
                // More than 24h: the ledger no longer dedupes, so we cannot tell if it landed.
                return { ...base, status: 'stale', final: true, reason: 'The transfer is older than 24 hours, so its outcome cannot be checked here. Look for an ICP transfer to the CMC in your wallet history and use /tools/recover-topup with its block index.' };
            }
            return { ...base, status: 'transfer_failed', final: true, reason: describeTransferErr(sent.failed) };
        }
        rec.blockIndex = String(sent.block);
        savePendingTopUp(rec, storage);
    }
    return notifyAndSettle({ cmc, rec, base, storage, processingRetries, sleep });
}

async function notifyAndSettle({ cmc, rec, base, storage, processingRetries, sleep }) {
    const out = await notifyTopUp({ cmc, canisterId: rec.canisterId, blockIndex: rec.blockIndex, processingRetries, sleep });
    if (out.final) removePendingTopUp(rec.canisterId, storage);
    else { rec.lastError = out.reason || out.status; savePendingTopUp(rec, storage); }
    return { ...base, ...out, blockIndex: BigInt(rec.blockIndex) };
}

/**
 * Top up `canisterId` with `amountE8s` ICP (fee on top). If a top-up of this canister is still
 * pending, that one is finished instead and no ICP is sent (result.resumed = true).
 *
 * Result: { status, final, canisterId, amountE8s, blockIndex?, cycles?, refundBlock?, reason?, resumed }
 *   status 'ok' | 'processing' | 'refunded' | 'invalid' | 'too_old' | 'other' | 'error'
 *        | 'transfer_failed' (nothing sent) | 'transfer_unknown' (kept pending, retry is safe)
 *        | 'needs_owner' | 'stale'
 * Never throws for ledger/CMC failures.
 */
export async function topUpCanisterWithIcp({
    ledger, cmc, canisterId, amountE8s, owner = null, feeE8s = ICP_FEE_E8S,
    storage = defaultStorage(), now = () => Date.now(), processingRetries, sleep,
}) {
    const cid = Principal.fromText(String(canisterId)).toText();
    if (getPendingTopUp(cid, storage)) {
        return finishPendingTopUp({ ledger, cmc, canisterId: cid, owner, storage, processingRetries, sleep });
    }
    const ms = now();
    const rec = {
        canisterId: cid,
        amountE8s: String(amountE8s),
        feeE8s: String(feeE8s),
        createdAtTime: String(BigInt(ms) * 1_000_000n),
        createdMs: ms,
        owner: owner ? String(owner) : null,
        blockIndex: null,
        lastError: null,
    };
    const base = { canisterId: cid, amountE8s: BigInt(amountE8s), resumed: false };
    savePendingTopUp(rec, storage);

    let sent;
    try { sent = await sendTransfer(ledger, rec, storage); } catch (e) {
        rec.lastError = e?.message || String(e);
        savePendingTopUp(rec, storage);
        return { ...base, status: 'transfer_unknown', final: false, reason: rec.lastError };
    }
    if (sent.failed) {
        removePendingTopUp(cid, storage);
        return { ...base, status: 'transfer_failed', final: true, reason: describeTransferErr(sent.failed) };
    }
    rec.blockIndex = String(sent.block);
    savePendingTopUp(rec, storage);
    return notifyAndSettle({ cmc, rec, base, storage, processingRetries, sleep });
}

/** Re-notify an arbitrary block for a canister (recovery tool). Touches no pending record. */
export async function renotifyTopUp({ cmc, canisterId, blockIndex, storage = defaultStorage() }) {
    const cid = Principal.fromText(String(canisterId).trim()).toText();
    const out = await notifyTopUp({ cmc, canisterId: cid, blockIndex: BigInt(String(blockIndex).trim()) });
    const rec = getPendingTopUp(cid, storage);
    if (out.final && rec && rec.blockIndex === String(BigInt(String(blockIndex).trim()))) removePendingTopUp(cid, storage);
    return { ...out, canisterId: cid, blockIndex: BigInt(String(blockIndex).trim()) };
}

// ---------------------------------------------------------------- presentation

const icp = (e8s) => (Number(e8s) / 1e8).toFixed(4).replace(/\.?0+$/, '');

/** A user-facing sentence for any non-'ok' (or resumed) result. */
export function describeTopUpResult(r, formatCycles = (c) => `${Number(c).toLocaleString()}`) {
    const blk = r.blockIndex != null ? ` (ICP ledger block ${r.blockIndex})` : '';
    const pendingTail = ' Your ICP is safe at the CMC; use "Finish top-up" (or Try again) later, it will not pay twice.';
    switch (r.status) {
        case 'ok':
            return r.resumed
                ? `Nothing new was sent: an earlier top-up of ${icp(r.amountE8s)} ICP to this canister was still pending${blk}, and it has now been completed (${formatCycles(Number(r.cycles))} cycles added). Submit again to send your new amount.`
                : `Added ${formatCycles(Number(r.cycles))} cycles${blk}.`;
        case 'processing': return `The CMC is still processing the top-up${blk}.${pendingTail}`;
        case 'other':
        case 'error': return `Cycles not minted yet${blk}: ${r.reason}.${pendingTail}`;
        case 'transfer_unknown': return `The ICP transfer's outcome is unknown (${r.reason}). Try again: the retry is deduplicated by the ledger, so it cannot pay twice.`;
        case 'refunded': return `Top-up refunded${blk}: ${r.reason}${r.refundBlock != null ? `. Refund is ICP ledger block ${r.refundBlock}` : ''}.`;
        case 'invalid': return `Invalid top-up transaction${blk}: ${r.reason}`;
        case 'too_old': return `Top-up transaction too old to notify${blk}: ${r.reason}`;
        case 'transfer_failed': return r.reason;
        case 'needs_owner':
        case 'stale': return r.reason;
        case 'none': return 'No pending top-up for this canister.';
        default: return `Top-up status ${r.status}${blk}${r.reason ? `: ${r.reason}` : ''}`;
    }
}

/** For call sites: cycles added (as Number) on a fresh success; otherwise throws Error(description). */
export function cyclesOrThrow(r, formatCycles) {
    if (r.status === 'ok' && !r.resumed) return Number(r.cycles);
    const e = new Error(describeTopUpResult(r, formatCycles));
    e.topUpResult = r;
    throw e;
}

function defaultSleep(ms) { return new Promise((res) => setTimeout(res, ms)); }
function safeJson(v) {
    try { return JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)); } catch (_) { return String(v); }
}
