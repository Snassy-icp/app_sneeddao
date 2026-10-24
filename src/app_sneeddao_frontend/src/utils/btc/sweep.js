// Sweep: send everything at this address to one destination in one transaction (spec/sneed_wallet.md
// §6.3, phase A4). Pure, tested in test/canisters/tests/btc-speedup.test.js. Custody-relevant.
//
// Max vs sweep:
//   - Max (select.js) sends every spendable coin minus the fee; it is the everyday "send all".
//   - Sweep is for emptying the address (leaving Sneed Wallet, the principal-migration wizard of
//     spec/derivation_origin.md). Policy (decided here): it includes EVERY confirmed coin not
//     reserved by a pending send, also the small ones that cost more fee to spend (68 vB × rate)
//     than they are worth ("uneconomic"), because the point is to leave nothing behind; the review
//     says how many there are and what they cost, and Advanced can leave them out. Unconfirmed coins
//     can't be swept (the IC Bitcoin canister lists mined outputs only) and coins reserved by
//     pending sends stay behind: the review says how much stays.
//   - Sweep to another principal: the target's Sneed Wallet address is derived offline
//     (address.js, the same derivation the signer uses for that principal), shown together with
//     the principal, and the user must type the address's last characters to confirm.
import { Principal } from '@dfinity/principal';
import { txVsize, feeFor, rateMsat, spendable, INPUT_VBYTES, MIN_SEND_SATS, OUTPUT_VBYTES } from './select.js';
import { outpointKey } from './utxos.js';
import { btcAddressFor } from './address.js';

/// How many characters of the destination the user types to confirm a sweep.
export const CONFIRM_TAIL = 8;

const sum = (us) => us.reduce((t, u) => t + u.value, 0n);
const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/// A coin is uneconomic at `rate` when spending it costs at least what it is worth.
export const isUneconomic = (u, rate) => u.value <= feeFor(INPUT_VBYTES, rate);

/**
 * Plan a sweep of every confirmed, unreserved coin to one destination of `destType`.
 *   dropUneconomic  leave out coins that cost more to spend than they are worth (Advanced)
 * Returns { ok: true, inputs, total, amount, fee, change: 0n, vsize, feeRate, max: true, sweep: true,
 *   nInputs, hasChange: false, estimatedFee, dustToFee: 0n, uneconomic: { count, sats, included },
 *   leftBehind: { reserved, unconfirmed, uneconomic } } or { ok: false, code, message }.
 */
export function planSweep({ utxos, locked = new Set(), feeRate, destType, dropUneconomic = false }) {
    if (rateMsat(feeRate) == null) return fail('bad_rate', 'Choose a fee rate.');
    if (!OUTPUT_VBYTES[destType]) return fail('bad_dest', 'Unsupported destination address type.');
    const pool = spendable(utxos, { locked });
    const small = pool.filter((u) => isUneconomic(u, feeRate));
    const set = dropUneconomic ? pool.filter((u) => !isUneconomic(u, feeRate)) : pool;
    const reserved = sum(utxos.filter((u) => locked.has(outpointKey(u))));
    const unconfirmed = sum(utxos.filter((u) => u.confirmations < 1 && !locked.has(outpointKey(u))));
    const leftBehind = { reserved, unconfirmed, uneconomic: dropUneconomic ? sum(small) : 0n };
    if (!set.length) return fail('no_funds', 'No confirmed coins to sweep.', { leftBehind });
    const v = txVsize(set.length, [destType]);
    const fee = feeFor(v, feeRate);
    const total = sum(set);
    const amount = total - fee;
    if (amount < MIN_SEND_SATS) return fail('max_too_small', 'After the network fee, less than 1,000 sats would arrive.', { total, fee, leftBehind });
    return {
        ok: true, inputs: set, total, amount, fee, change: 0n, vsize: v, feeRate: Number(feeRate), max: true, sweep: true,
        nInputs: set.length, hasChange: false, estimatedFee: fee, dustToFee: 0n,
        uneconomic: { count: small.length, sats: sum(small), included: !dropUneconomic },
        leftBehind,
    };
}

/**
 * The Sneed Wallet Bitcoin address of another principal (offline, as the signer derives it), as
 * the sweep target. Refuses invalid text, the anonymous principal, the management canister and
 * the user's own principal. { ok: true, principal, address } or { ok: false, error }.
 */
export function sweepTarget(text, network, { me = null } = {}) {
    const t = String(text ?? '').trim();
    if (!t) return { ok: false, error: 'Enter the principal to sweep to.' };
    let p;
    try { p = Principal.fromText(t); } catch { return { ok: false, error: 'That is not a valid principal.' }; }
    const pt = p.toText();
    if (p.isAnonymous()) return { ok: false, error: 'The anonymous principal has no wallet.' };
    if (pt === 'aaaaa-aa') return { ok: false, error: 'The management canister has no wallet.' };
    if (me && pt === String(me)) return { ok: false, error: 'That is your own principal: its address is this one.' };
    return { ok: true, principal: pt, address: btcAddressFor(pt, network) };
}

/// The characters the user must type for `address`.
export const confirmTailOf = (address) => String(address || '').slice(-CONFIRM_TAIL);
/// Did the user type the destination's last CONFIRM_TAIL characters (case-insensitive, trimmed)?
export function confirmTailOk(typed, address) {
    const want = confirmTailOf(address).toLowerCase();
    return want.length === CONFIRM_TAIL && String(typed ?? '').trim().toLowerCase() === want;
}
