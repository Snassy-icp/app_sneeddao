// UTXO selection, transaction size and fee math for native Bitcoin sends (spec/sneed_wallet.md
// §5.3 step 2). Pure, tested in test/canisters/tests/btc-send.test.js. Custody-relevant: this
// decides which coins are spent, how much goes to the recipient and how much becomes fee.
//
// What the Chain Fusion Signer does with our request (tx_utils.rs build_p2wpkh_transaction):
//   - it spends exactly `utxos_to_spend`, in our order, then our outputs in our order;
//   - remainder = Σ inputs − Σ outputs − fee_satoshis; a remainder ≥ 1,000 sats becomes one
//     change output back to the sender's address (appended last), a smaller one becomes fee.
// So every plan here passes an explicit fee and decides the change itself:
//   - change ≥ 1,000 sats: fee = the estimate *with* the change output, change = the rest;
//   - otherwise: no change, fee = everything left over (the estimate without change plus the
//     "dust added to fee", shown to the user). The signer then sees remainder 0 and adds nothing.
//
// vsize = 11 + 68·inputs + Σ output sizes by type (P2WPKH 31, P2PKH 34, P2SH 32, P2WSH/P2TR 43),
// as Oisy's btc-utxos.utils.ts. 68 vB per P2WPKH input is a slight overestimate (a 72-byte
// signature gives 67.75 vB), so the real rate is never below the chosen one.
//
// Amounts are BigInt sats. Fee rates are sat/vB numbers (decimals allowed, kept to 1/1000).
import { outpointKey } from './utxos.js';

export const TX_OVERHEAD_VBYTES = 11;
export const INPUT_VBYTES = 68;
export const OUTPUT_VBYTES = Object.freeze({ p2wpkh: 31, p2pkh: 34, p2sh: 32, p2wsh: 43, p2tr: 43 });
/// The signer's DUST_THRESHOLD: a remainder below this is not returned as change.
export const CHANGE_MIN_SATS = 1000n;
/// The smallest amount we send (spec §5.3: refuse below 1,000 sats; above every dust limit).
export const MIN_SEND_SATS = 1000n;

/// vsize of a transaction with `nInputs` P2WPKH inputs and outputs of `outputTypes`.
export function txVsize(nInputs, outputTypes) {
    let v = TX_OVERHEAD_VBYTES + INPUT_VBYTES * nInputs;
    for (const t of outputTypes) {
        const s = OUTPUT_VBYTES[t];
        if (!s) throw new Error(`Unknown output type ${t}`);
        v += s;
    }
    return v;
}

/// A fee rate (sat/vB) as integer millisats per vbyte; null when not a positive finite number.
export function rateMsat(rate) {
    const n = Number(rate);
    if (!Number.isFinite(n) || n <= 0) return null;
    return BigInt(Math.round(n * 1000));
}

/// ceil(vsize × rate) in sats (BigInt).
export function feeFor(vsize, rate) {
    const m = rateMsat(rate);
    if (m == null) throw new Error('Invalid fee rate');
    const num = BigInt(vsize) * m;
    return (num + 999n) / 1000n;
}

/// Spendable UTXOs: at least `minConfirmations` and not locked by a pending send; largest first
/// (ties: more confirmations first, then by outpoint, so plans are deterministic).
export function spendable(utxos, { locked = new Set(), minConfirmations = 1 } = {}) {
    return utxos
        .filter((u) => u.confirmations >= minConfirmations && !locked.has(outpointKey(u)))
        .slice()
        .sort((a, b) => (a.value === b.value
            ? (b.confirmations - a.confirmations) || (outpointKey(a) < outpointKey(b) ? -1 : 1)
            : (b.value > a.value ? 1 : -1)));
}

const sum = (us) => us.reduce((t, u) => t + u.value, 0n);

/// Fit `amount` into exactly these inputs at `rate`. null when it does not fit.
function fit(inputs, amount, rate, destType) {
    const total = sum(inputs);
    const n = inputs.length;
    const vWith = txVsize(n, [destType, 'p2wpkh']);
    const feeWith = feeFor(vWith, rate);
    const change = total - amount - feeWith;
    if (change >= CHANGE_MIN_SATS) {
        return { inputs, total, amount, fee: feeWith, change, vsize: vWith, estimatedFee: feeWith, dustToFee: 0n };
    }
    const vNo = txVsize(n, [destType]);
    const feeNo = feeFor(vNo, rate);
    if (total - amount < feeNo) return null;
    const fee = total - amount; // the whole remainder: the signer adds no change
    return { inputs, total, amount, fee, change: 0n, vsize: vNo, estimatedFee: feeNo, dustToFee: fee - feeNo };
}

const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/**
 * Plan a send of `amount` sats (or everything with `max`) to one destination of `destType`.
 *   utxos            parsed UTXOs (utils/btc/utxos.js parseUtxo)
 *   locked           Set of outpoint keys locked by pending sends (utils/btc/pending.js)
 *   feeRate          sat/vB
 *   inputs           optional coin control: spend exactly these (each must be spendable)
 * Returns { ok: true, inputs, total, amount, fee, change, vsize, estimatedFee, dustToFee,
 *           feeRate, max, hasChange, nInputs } or { ok: false, code, message, ... }.
 */
export function planSend({ utxos, locked = new Set(), minConfirmations = 1, amount = null, max = false, feeRate, destType, inputs: chosen = null }) {
    if (rateMsat(feeRate) == null) return fail('bad_rate', 'Choose a fee rate.');
    if (!OUTPUT_VBYTES[destType]) return fail('bad_dest', 'Unsupported destination address type.');
    const pool = spendable(utxos, { locked, minConfirmations });
    let set = pool;
    if (chosen) {
        const keys = new Set(pool.map(outpointKey));
        const bad = chosen.find((u) => !keys.has(outpointKey(u)));
        if (bad) return fail('locked_input', `Coin ${outpointKey(bad)} can't be spent now (unconfirmed or used by a pending send).`);
        if (!chosen.length) return fail('no_funds', 'Choose at least one coin.');
        set = spendable(chosen, { minConfirmations: 0 });
    }
    if (!set.length) return fail('no_funds', 'No confirmed coins to spend. Received coins can be spent after one confirmation.');
    const done = (p) => ({ ok: true, ...p, feeRate: Number(feeRate), max, hasChange: p.change > 0n, nInputs: p.inputs.length });

    if (max) {
        const v = txVsize(set.length, [destType]);
        const fee = feeFor(v, feeRate);
        const total = sum(set);
        const amt = total - fee;
        if (amt < MIN_SEND_SATS) return fail('max_too_small', 'After the network fee, less than 1,000 sats would arrive.', { total, fee });
        return done({ inputs: set, total, amount: amt, fee, change: 0n, vsize: v, estimatedFee: fee, dustToFee: 0n });
    }

    const amt = typeof amount === 'bigint' ? amount : null;
    if (amt == null || amt <= 0n) return fail('no_amount', 'Enter an amount.');
    if (amt < MIN_SEND_SATS) return fail('below_min', 'The smallest amount you can send is 1,000 sats.');

    if (chosen) {
        const p = fit(set, amt, feeRate, destType);
        if (!p) return fail('insufficient', 'The chosen coins don\'t cover the amount plus the network fee.', { needed: amt + feeFor(txVsize(set.length, [destType]), feeRate), available: sum(set) });
        return done(p);
    }

    // largest first until it fits ...
    let plan = null;
    for (let n = 1; n <= set.length && !plan; n++) plan = fit(set.slice(0, n), amt, feeRate, destType);
    if (!plan) {
        return fail('insufficient', 'Not enough confirmed bitcoin for this amount plus the network fee.', { needed: amt + feeFor(txVsize(set.length, [destType]), feeRate), available: sum(set) });
    }
    // ... then drop the smallest inputs while it still fits (each input costs a 37B-cycle signature)
    for (let i = plan.inputs.length - 1; i >= 0 && plan.inputs.length > 1; i--) {
        const rest = plan.inputs.filter((_, j) => j !== i);
        const p = fit(rest, amt, feeRate, destType);
        if (p) plan = p;
    }
    return done(plan);
}

/// "0.001" (BTC, up to 8 decimals) → sats; { ok, sats } or { ok: false, error }.
export function parseBtcAmount(text) {
    const s = String(text ?? '').trim().replace(/,/g, '');
    if (!s) return { ok: false, error: 'Enter an amount.' };
    const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
    if (!m || (m[1] === '' && (m[2] ?? '') === '')) return { ok: false, error: 'Enter a number like 0.001.' };
    if ((m[2] || '').length > 8) return { ok: false, error: 'Bitcoin has at most 8 decimals (1 sat = 0.00000001).' };
    const sats = BigInt(m[1] || '0') * 100_000_000n + BigInt((m[2] || '').padEnd(8, '0') || '0');
    if (sats <= 0n) return { ok: false, error: 'Enter an amount above 0.' };
    return { ok: true, sats };
}

/// sats → "0.00123" (no trailing zeros), for inputs (never masked).
export function satsToBtcText(sats) {
    const v = BigInt(sats);
    const whole = v / 100_000_000n;
    const frac = (v % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : `${whole}`;
}
