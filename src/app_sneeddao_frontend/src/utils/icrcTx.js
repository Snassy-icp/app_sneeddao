// Every ICRC-1/2 transfer and approval the frontend makes goes through these wrappers so that it
// carries `created_at_time`. With that field set the ledger deduplicates an identical resend
// within 24h (answering Duplicate { duplicate_of }), so retrying after an unknown outcome (a
// network error, a timeout, a reply that failed to decode) can never pay twice.
//
//   icrc1Transfer(ledger, args)      icrc2Approve(ledger, args)      icrc2TransferFrom(ledger, args)
//   icpLegacyTransfer(ledger, args)  (ICP account-identifier `transfer`)
//
// Behaviour, the same for all of them:
//   - args.created_at_time is filled with "now" when empty; the caller's object is not changed.
//   - A thrown call (outcome unknown) is resent once with the very same args, but ONLY on a ledger
//     known to deduplicate (see below). On any other ledger nothing is resent: an
//     OutcomeUnknownError is thrown whose message tells the user to check their balance and
//     history before trying again.
//   - Duplicate { duplicate_of } is answered as Ok(duplicate_of): that transfer happened, once.
//   - CreatedInFuture (our clock ahead of the ledger's) is resent with the ledger's time; TooOld
//     (our clock a day behind) is resent without a time. Nothing was sent in either case, and this
//     happens only when the time was filled in here, never for a caller-chosen time.
//
//
// Which ledgers dedupe. ICRC-1 only says a ledger SHOULD deduplicate, and some custom token
// ledgers don't; resending there after a call that did land pays twice. The rule is a list, never
// a guess from metadata (supported_standards or ICRC-3 do not prove dedupe):
//   - the ICP ledger;
//   - DFINITY's chain-key ledgers (ckBTC, ckETH and the ckERC20 ledgers; keep in sync with
//     CKBTC / CKETH / CKERC20_FALLBACK in utils/ckMinters.js);
//   - SNS ledgers: SNS-W deploys the DFINITY ledger suite for every SNS. utils/SnsUtils.js registers
//     a resolver that answers from the SNS list the app already loaded; before that list is loaded
//     an SNS ledger counts as unknown (no resend), which is the safe side.
//
// No 'external/*' imports so node can test it (scripts/icrcTx.test.mjs).
import { Actor } from '@dfinity/agent';

export const DEDUPING_LEDGERS = new Set([
    'ryjl3-tyaaa-aaaaa-aaaba-cai', // ICP
    'mxzaz-hqaaa-aaaar-qaada-cai', // ckBTC
    'ss2fx-dyaaa-aaaar-qacoq-cai', // ckETH
    'xevnm-gaaaa-aaaar-qafnq-cai', // ckUSDC
    'cngnf-vqaaa-aaaar-qag4q-cai', // ckUSDT
    'bptq2-faaaa-aaaar-qagxq-cai', // ckWBTC
    'pe5t5-diaaa-aaaar-qahwa-cai', // ckEURC
    'nza5v-qaaaa-aaaar-qahzq-cai', // ckXAUT
    'g4tto-rqaaa-aaaar-qageq-cai', // ckLINK
    'etik7-oiaaa-aaaar-qagia-cai', // ckPEPE
    'ebo5g-cyaaa-aaaar-qagla-cai', // ckOCT
    'fxffn-xiaaa-aaaar-qagoa-cai', // ckSHIB
    'j2tuh-yqaaa-aaaar-qahcq-cai', // ckWSTETH
    'ilzky-ayaaa-aaaar-qahha-cai', // ckUNI
    'j7x7x-syaaa-aaaar-qcbea-cai', // ckBAT
]);

let extraResolver = null;
/** utils/SnsUtils.js registers (ledgerIdText) => boolean for SNS ledgers. */
export function setDedupingLedgerResolver(fn) { extraResolver = typeof fn === 'function' ? fn : null; }

/** The canister id (text) of an actor, or null. Test mocks may carry `ledgerId`. */
export function ledgerIdOf(actor) {
    try { return Actor.canisterIdOf(actor).toText(); } catch (_) { /* not an agent actor */ }
    return actor?.ledgerId ? String(actor.ledgerId) : null;
}

/** True only for ledgers known to deduplicate by created_at_time (see the rule above). */
export function ledgerDedupes(ledgerId) {
    if (!ledgerId) return false;
    const id = String(ledgerId);
    if (DEDUPING_LEDGERS.has(id)) return true;
    try { return !!extraResolver?.(id); } catch (_) { return false; }
}

/** Thrown when a call's outcome is unknown and it was not (or could not be) safely resent. */
export class OutcomeUnknownError extends Error {
    constructor(method, cause) {
        const what = method === 'icrc2_approve' ? 'approval' : 'transfer';
        super(`The ledger did not answer (${cause?.message || cause}), so it is not known whether the ${what} went through. Check your balance and transaction history before trying again, so you do not pay twice.`);
        this.name = 'OutcomeUnknownError';
        this.code = 'OUTCOME_UNKNOWN';
        this.cause = cause;
    }
}

const nowNs = () => BigInt(Date.now()) * 1_000_000n;

/** [now in ns], for a created_at_time opt field. */
export const createdAtNow = () => [nowNs()];

/** [now + ms in ns], for an approval's expires_at opt field (default one hour). */
export const expiresInMs = (ms = 60 * 60 * 1000) => [BigInt(Date.now() + ms) * 1_000_000n];

const isEmptyOpt = (v) => v == null || (Array.isArray(v) && v.length === 0);

async function callWithDedupe(actor, method, args, { legacy = false } = {}) {
    if (!actor || typeof actor[method] !== 'function') throw new Error(`${method} is not available on this ledger actor`);
    const retryUnknown = ledgerDedupes(ledgerIdOf(actor));
    const filled = isEmptyOpt(args.created_at_time);
    const stamp = (ns) => (legacy ? [{ timestamp_nanos: ns }] : [ns]);
    let a = filled ? { ...args, created_at_time: stamp(nowNs()) } : args;

    const send = async () => {
        try { return await actor[method](a); } catch (e) {
            if (!retryUnknown) throw new OutcomeUnknownError(method, e);
            // Unknown outcome on a deduping ledger: resend the identical args; a landed first try
            // comes back as Duplicate.
            try { return await actor[method](a); } catch (_) { throw new OutcomeUnknownError(method, e); }
        }
    };

    let r = await send();
    const err = r && typeof r === 'object' ? r.Err : undefined;
    if (err && filled) {
        if (!legacy && 'CreatedInFuture' in err) {
            a = { ...a, created_at_time: [BigInt(err.CreatedInFuture.ledger_time)] };
            r = await send();
        } else if (legacy && 'TxCreatedInFuture' in err) {
            a = { ...a, created_at_time: stamp(nowNs() - 120_000_000_000n) };
            r = await send();
        } else if (('TooOld' in err) || ('TxTooOld' in err)) {
            a = { ...a, created_at_time: [] };
            try { r = await actor[method](a); } catch (e) { throw new OutcomeUnknownError(method, e); } // no time: never resent
        }
    }
    const e2 = r && typeof r === 'object' ? r.Err : undefined;
    if (e2 && 'Duplicate' in e2) return { Ok: e2.Duplicate.duplicate_of };
    if (e2 && 'TxDuplicate' in e2) return { Ok: e2.TxDuplicate.duplicate_of };
    return r;
}

/** ledger.icrc1_transfer(args) with created_at_time and a safe retry. Returns the ledger's answer. */
export const icrc1Transfer = (ledger, args) => callWithDedupe(ledger, 'icrc1_transfer', args);

/** ledger.icrc2_approve(args) with created_at_time and a safe retry. */
export const icrc2Approve = (ledger, args) => callWithDedupe(ledger, 'icrc2_approve', args);

/** ledger.icrc2_transfer_from(args) with created_at_time and a safe retry. */
export const icrc2TransferFrom = (ledger, args) => callWithDedupe(ledger, 'icrc2_transfer_from', args);

/** ICP ledger `transfer` (account identifier) with created_at_time { timestamp_nanos }. */
export const icpLegacyTransfer = (ledger, args) => callWithDedupe(ledger, 'transfer', args, { legacy: true });
