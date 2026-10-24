// Balance cross-check before large sends, and "Verify balance" (spec/sneed_wallet.md §4, §5.2 step 4,
// phase A4). Pure apart from the signer call, tested in test/canisters/tests/btc-speedup.test.js.
//
// The free Bitcoin canister queries answer from a single replica and are not certified, so a
// lying or stale replica could show coins that don't exist or hide some. The signer's
// btc_caller_balance (0.113B cycles, from its methods.rs; paid like every signer call with
// CallerPaysIcrc2Cycles, plus the cycles ledger's 0.1B withdraw fee) asks the Bitcoin canister
// with a replicated update call (ic-cdk-bitcoin-canister bitcoin_get_balance), i.e. an answer the
// whole subnet agreed on. Before a large send we compare it with the sum of the UTXOs the query
// gave us (all of them, including coins reserved by pending sends: the canister doesn't know our
// mempool), and refuse the send if they differ. A block between the two reads can make them differ
// honestly, so on a difference the UTXOs are read once more and compared again.
//
// When (decided here; the DAO can tune it later): a send whose coins leaving the address
// (amount + fee) are above 25% of the balance, or above 1,000,000 sats (0.01 BTC), and every
// sweep. A check that passed is reused for 10 minutes while the UTXO set is unchanged. Skipping it
// is possible only in the review's Advanced section, with a warning.
//
// btc_caller_balance is marked deprecated in the signer's candid; it is still the only update path
// a frontend can pay for (spec §5.2). If it errors, the send is refused like a mismatch (skippable
// in Advanced).
import { networkVariant, outpointKey } from './utxos.js';
import { BALANCE_CYCLES } from './credit.js';
import { addressErrorText } from './errors.js';

export const CROSSCHECK_SHARE_PERCENT = 25n;
export const CROSSCHECK_SATS = 1_000_000n;
export const CROSSCHECK_TTL_MS = 10 * 60 * 1000;
export { BALANCE_CYCLES };

const PAY = [{ CallerPaysIcrc2Cycles: null }];

/// Σ of every UTXO with ≥ 1 confirmation (what bitcoin_get_balance with min_confirmations = 1 counts).
export const utxoTotal = (utxos) => utxos.filter((u) => u.confirmations >= 1).reduce((t, u) => t + u.value, 0n);

/// A fingerprint of the UTXO set, so a passed check is reused only for the same coins.
export const utxoFingerprint = (utxos) => utxos.filter((u) => u.confirmations >= 1).map(outpointKey).sort().join(',');

/**
 * Does this send need the cross-check? { needed, reasons }.
 *   leaving  sats leaving the address (amount + fee)
 *   balance  the UTXO-derived total (utxoTotal)
 */
export function needsCrossCheck({ leaving, balance, sweep = false }) {
    const reasons = [];
    const l = BigInt(leaving ?? 0n);
    const b = BigInt(balance ?? 0n);
    if (sweep) reasons.push('it empties the address');
    if (l * 100n > b * CROSSCHECK_SHARE_PERCENT) reasons.push(`it moves more than ${CROSSCHECK_SHARE_PERCENT}% of your balance`);
    if (l > CROSSCHECK_SATS) reasons.push(`it moves more than ${CROSSCHECK_SATS.toLocaleString('en-US')} sats`);
    return { needed: reasons.length > 0, reasons };
}

/// Is a previous passed check still good for these coins? `last` = { ok, fingerprint, at }.
export const crossCheckFresh = (last, { fingerprint, now }) => Boolean(last?.ok && last.fingerprint === fingerprint && now - last.at < CROSSCHECK_TTL_MS);

/**
 * Ask the signer for the replicated balance and compare it with `local` (utxoTotal of the query).
 *   reread  async () → { total, fingerprint } | null: read the UTXOs again (on a difference)
 * Returns { ok: true, verified, local, at, fingerprint, reread? } or
 *         { ok: false, mismatch?, verified?, local, error }.
 */
export async function crossCheckBalance({ signer, network, local, fingerprint = null, reread = null, now = Date.now }) {
    let res;
    try {
        res = await signer.btc_caller_balance({ network: networkVariant(network), address_type: { P2WPKH: null }, min_confirmations: [1] }, PAY);
    } catch (e) {
        return { ok: false, local, error: `Couldn't get the verified balance from the signer (${String(e?.message || e).split('\n')[0].slice(0, 200)}). Nothing was sent.` };
    }
    if (!res || !('Ok' in res)) return { ok: false, local, error: `Couldn't get the verified balance: ${addressErrorText(res?.Err)} Nothing was sent.` };
    const verified = BigInt(res.Ok.balance);
    if (verified === BigInt(local)) return { ok: true, verified, local: BigInt(local), at: now(), fingerprint };
    if (reread) {
        let again = null;
        try { again = await reread(); } catch { again = null; }
        if (again && BigInt(again.total) === verified) return { ok: true, verified, local: BigInt(again.total), at: now(), fingerprint: again.fingerprint ?? null, reread: true };
    }
    try { console.error('[btc] balance cross-check failed', { verified: String(verified), local: String(local) }); } catch { /* no console */ }
    return {
        ok: false, mismatch: true, verified, local: BigInt(local),
        error: `Stopped: the Bitcoin canister's verified balance is ${verified.toLocaleString('en-US')} sats, but the coins this page read add up to ${BigInt(local).toLocaleString('en-US')} sats. Nothing was sent. Refresh and try again in a few minutes; if it persists, report it to Sneed support.`,
    };
}
