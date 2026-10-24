// Speed up a stuck native Bitcoin send (spec/sneed_wallet.md §8 "Broadcast but stuck", phase A4).
// Pure (plans and decisions), tested in test/canisters/tests/btc-speedup.test.js. Custody-relevant:
// this decides the fee of a second signature over coins that are already on their way.
//
// Two ways, both through btc_caller_send:
//
// RBF (replace): sign the SAME inputs again with a higher fee. The Chain Fusion Signer sets
//   nSequence 0xFFFFFFFF, so its transactions do not signal BIP-125; the replacement relies on
//   full-RBF, which Bitcoin Core relays by default since 28.0 (mempoolfullrbf=1; the option is gone
//   in later versions). The IC's Bitcoin adapter applies no mempool policy of its own: it
//   advertises each transaction it is given to its peers (inv) for 10 minutes
//   (rs/bitcoin/adapter/src/transaction_store.rs), so whether a replacement spreads is up to
//   those peers. Their replacement rules (BIP-125 rules 3 and 4, kept by full-RBF):
//     rule 3: the replacement pays at least the absolute fee of what it replaces;
//     rule 4: and on top of that its own vsize × the incremental relay feerate (1 sat/vB; Core 30
//             lowered the default to 0.1, so 1 is safe for both);
//   and its feerate must be higher than the original's. The recipient's amount stays the same: the
//   extra fee comes out of the change. If the change would drop below 1,000 sats it is removed and
//   the whole remainder becomes fee (as select.js does). If even that is not enough, the plan
//   fails with `no_room`; only with the user's explicit consent (`reduceAmount`) does the
//   recipient's amount go down instead.
//
// CPFP (child pays for parent): spend the stuck transaction's own change output (unconfirmed, so
//   it is not in the IC Bitcoin canister's UTXO set: we pass it by hand; the signer spends exactly
//   what we give it and P2WPKH signatures commit to the value, which we know) back to our own
//   address, with a fee so that parent + child together reach the target rate:
//     child fee = ceil(rate × (parent vsize + child vsize)) − parent fee   (at least 1 sat/vB alone)
//   If the change can't cover that and leave ≥ 1,000 sats, confirmed coins are added. It only works
//   while the parent is still in mempools (a parent below the network's minimum is better
//   replaced).
//
// Default: RBF when the change allows it (no amount change), else CPFP.
import { txVsize, feeFor, rateMsat, spendable, CHANGE_MIN_SATS, MIN_SEND_SATS, INPUT_VBYTES } from './select.js';
import { addressType } from './txid.js';
import { outpointKey, fetchUtxos } from './utxos.js';
import { sendCycles } from './credit.js';
import { recordTxid, pendingChild, groupMembers } from './pending.js';

/// sat/vB: the incremental relay feerate a replacement must add over the original's fee (rule 4).
export const INCREMENTAL_RELAY_RATE = 1;
/// sat/vB: the lowest rate a CPFP child pays on its own.
export const CHILD_MIN_RATE = 1;
/// Speed-up is offered once a send has waited this many blocks unmined (or at once when its rate is
/// below the current "Slow"); Advanced offers it any time while it is pending.
export const SPEEDUP_AFTER_BLOCKS = 2;
const BLOCK_MS = 10 * 60 * 1000;

const big = (x) => BigInt(x ?? 0);
const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/// Inputs, outputs, totals and output types of a pending record (amounts BigInt).
export function recordShape(r, network) {
    const inputs = (r.request?.inputs || []).map((i) => ({ ...i, value: big(i.value) }));
    const outputs = (r.request?.outputs || []).map((o) => ({ address: o.address, value: big(o.value) }));
    const total = inputs.reduce((t, i) => t + i.value, 0n);
    const sent = outputs.reduce((t, o) => t + o.value, 0n);
    const types = outputs.map((o) => addressType(o.address, network));
    return { inputs, outputs, total, sent, fee: big(r.fee), change: big(r.change), types, vsize: Number(r.vsize) || null };
}

/// How many blocks a send has waited: from the tip at sending when recorded, else from the time.
export function blocksWaited(r, { tipHeight = null, now }) {
    if (tipHeight != null && r.tipAtSend != null) return Math.max(0, Number(tipHeight) - Number(r.tipAtSend));
    const t = r.broadcastAt || r.createdAt;
    return t ? Math.max(0, Math.floor((now - t) / BLOCK_MS)) : 0;
}

/**
 * May this record be sped up, and is it worth offering? { can, offer, reason, why }.
 *   can    a speed-up is possible at all (Advanced shows it)
 *   offer  the casual view offers it (waited SPEEDUP_AFTER_BLOCKS, or rate below current "Slow")
 */
export function speedUpStatus(r, { records = [], tipHeight = null, now, tiers = null }) {
    const no = (why) => ({ can: false, offer: false, why });
    if (r.state !== 'broadcast') return no('Only a send that went out and is waiting for a block can be sped up.');
    if (r.kind === 'cpfp') return no('This is already a speed-up. Speed up the original send instead, if it still waits.');
    if (r.supersededBy && records.some((x) => x.id === r.supersededBy && x.state !== 'failed')) return no('A faster version of this send exists; speed up that one.');
    if (pendingChild(records, r)) return no('This send already has a speed-up (CPFP) on its way.');
    const waited = blocksWaited(r, { tipHeight, now });
    const slowNow = tiers && Number(r.feeRate) < tiers.slow;
    const offer = waited >= SPEEDUP_AFTER_BLOCKS || Boolean(slowNow);
    const reason = slowNow ? `its fee rate (${r.feeRate} sat/vB) is below the current "Slow" rate (${tiers.slow} sat/vB)` : `${waited} block${waited === 1 ? '' : 's'} without a confirmation`;
    return { can: true, offer, reason, waited };
}

/**
 * Plan an RBF replacement of `record` at `feeRate` (sat/vB).
 *   reduceAmount  the user agreed that the recipient gets less when the change can't pay
 * Returns { ok: true, inputs, outputs, amount, fee, change, vsize, feeRate, extraFee, minFee,
 *   rules: { rule3, rule4, rate }, reduced, dustToFee, nInputs } or { ok: false, code, message, ... }.
 * The outputs keep the original's order and addresses; the change (if any) comes last again.
 */
export function planRbf({ record, feeRate, network, reduceAmount = false }) {
    if (rateMsat(feeRate) == null) return fail('bad_rate', 'Choose a fee rate.');
    const sh = recordShape(record, network);
    if (!sh.inputs.length || !sh.outputs.length) return fail('bad_record', 'This record has no inputs or outputs to replace.');
    if (sh.inputs.some((i) => i.unconfirmed)) return fail('unconfirmed_input', 'A speed-up that spends unconfirmed coins can\'t be replaced here.');
    if (sh.types.some((t) => !t)) return fail('bad_dest', 'A destination of this send no longer parses for this network.');
    const oldRate = Number(record.feeRate) || 0;
    if (Number(feeRate) <= oldRate) return fail('rate_not_higher', `Choose a rate above the current ${oldRate} sat/vB.`);
    const n = sh.inputs.length;
    const need = (v) => {
        const rule3 = sh.fee;
        const rule4 = sh.fee + feeFor(v, INCREMENTAL_RELAY_RATE);
        const rate = feeFor(v, feeRate);
        const min = rule4 > rate ? rule4 : rate;
        return { min: min > rule3 ? min : rule3, rules: { rule3, rule4, rate } };
    };
    const done = (p) => ({ ok: true, nInputs: n, inputs: sh.inputs, feeRate: Number(feeRate), extraFee: p.fee - sh.fee, oldFee: sh.fee, ...p });
    // 1. keep a change output (the usual case)
    const vW = txVsize(n, [...sh.types, 'p2wpkh']);
    const w = need(vW);
    const changeW = sh.total - sh.sent - w.min;
    if (changeW >= CHANGE_MIN_SATS) {
        return done({ outputs: sh.outputs, amount: sh.sent, fee: w.min, change: changeW, vsize: vW, minFee: w.min, rules: w.rules, reduced: false, dustToFee: 0n });
    }
    // 2. no change: everything left over is fee (the signer would add no change anyway)
    const vN = txVsize(n, sh.types);
    const nn = need(vN);
    const left = sh.total - sh.sent;
    if (left >= nn.min) {
        return done({ outputs: sh.outputs, amount: sh.sent, fee: left, change: 0n, vsize: vN, minFee: nn.min, rules: nn.rules, reduced: false, dustToFee: left - nn.min });
    }
    // 3. only by sending less (explicit consent, a single recipient)
    const shortBy = nn.min - left;
    if (!reduceAmount || sh.outputs.length !== 1) {
        return fail('no_room', `The change can't pay the higher fee: ${shortBy} sats are missing. A replacement could only pay it by sending ${shortBy} sats less to the recipient.`, { shortBy, canReduce: sh.outputs.length === 1 && sh.outputs[0].value - shortBy >= MIN_SEND_SATS, minFee: nn.min, rules: nn.rules });
    }
    const amount = sh.outputs[0].value - shortBy;
    if (amount < MIN_SEND_SATS) return fail('no_room', 'Even sending less, under 1,000 sats would arrive. Use CPFP or wait.', { shortBy, canReduce: false });
    return done({ outputs: [{ address: sh.outputs[0].address, value: amount }], amount, fee: nn.min, change: 0n, vsize: vN, minFee: nn.min, rules: nn.rules, reduced: true, reducedBy: shortBy, dustToFee: 0n });
}

/// The stuck record's change output as a UTXO for the child (unconfirmed: we pass it by hand).
export function parentChangeUtxo(parent) {
    if (parent.changeVout == null || big(parent.change) <= 0n) return null;
    return { txid: recordTxid(parent), vout: Number(parent.changeVout), value: big(parent.change), height: 0, confirmations: 0, unconfirmed: true };
}

/**
 * Plan a CPFP child for `parent` at package rate `feeRate`.
 *   utxos/locked  the wallet's coins (confirmed ones may be added when the change is too small)
 * Returns { ok: true, inputs, output { address, value }, amount, fee, change: 0n, vsize, feeRate,
 *   packageRate, packageFee, packageVsize, parentFee, parentVsize, extraCoins, nInputs }
 * or { ok: false, code, message }.
 */
export function planCpfp({ parent, feeRate, ownAddress, utxos = [], locked = new Set() }) {
    if (rateMsat(feeRate) == null) return fail('bad_rate', 'Choose a fee rate.');
    const ch = parentChangeUtxo(parent);
    if (!ch) return fail('no_change', 'This send has no change output back to you, so there is nothing to build a speed-up (CPFP) on.');
    const pFee = big(parent.fee);
    const pV = Number(parent.vsize);
    if (!pV) return fail('bad_record', 'The size of the stuck transaction is not recorded.');
    if (Number(pFee) / pV >= Number(feeRate)) return fail('rate_not_higher', `The stuck transaction already pays ${(Number(pFee) / pV).toFixed(2)} sat/vB. Choose a higher rate.`);
    const extra = spendable(utxos, { locked });
    const inputs = [ch];
    for (let k = 0; ; k++) {
        const v = txVsize(inputs.length, ['p2wpkh']);
        const pkg = feeFor(pV + v, feeRate);
        const own = feeFor(v, CHILD_MIN_RATE);
        const fee = pkg - pFee > own ? pkg - pFee : own;
        const total = inputs.reduce((t, u) => t + u.value, 0n);
        const out = total - fee;
        if (out >= CHANGE_MIN_SATS) {
            return {
                ok: true, inputs: inputs.slice(), output: { address: ownAddress, value: out }, amount: out, fee, change: 0n, vsize: v, feeRate: Number(feeRate),
                packageFee: pFee + fee, packageVsize: pV + v, packageRate: Number(pFee + fee) / (pV + v), parentFee: pFee, parentVsize: pV,
                extraCoins: inputs.length - 1, nInputs: inputs.length, dustToFee: 0n,
            };
        }
        if (k >= extra.length) return fail('change_too_small', `The change (${ch.value} sats) can't pay the speed-up fee and you have no other confirmed coin to add.`, { needed: fee + CHANGE_MIN_SATS, available: total });
        inputs.push(extra[k]);
    }
}

/// The signing cost of each way (cycles): RBF re-signs every input; CPFP signs the child's inputs.
export const rbfCycles = (plan) => sendCycles(plan.nInputs, plan.outputs.length);
export const cpfpCycles = (plan) => sendCycles(plan.nInputs, 1);

/// Which way to offer first: RBF when it works without touching the amount, else CPFP, else RBF
/// with a smaller amount (only with consent), else none.
export function defaultSpeedUp({ rbf, cpfp }) {
    if (rbf?.ok && !rbf.reduced) return 'rbf';
    if (cpfp?.ok) return 'cpfp';
    if (rbf && !rbf.ok && rbf.canReduce) return 'rbf_reduce';
    return null;
}

/// Records of a group whose coins are spent but whose winner is unknown (action 'identify').
export const unsettledGroup = (records, r) => groupMembers(records, r).filter((x) => ['broadcast', 'unknown', 'submitting'].includes(x.state));

/**
 * Find which version of an RBF group was mined, from the recipient's UTXOs on the IC Bitcoin
 * canister (a free query; nothing goes to a third party): the version whose first output is there.
 * Returns the winning txid or null (the recipient may have spent it already: then ask mempool.space).
 */
export async function identifyWinner(bitcoin, { network, members, maxPages = 5 }) {
    const byAddr = new Map();
    for (const m of members) {
        const out0 = m.request?.outputs?.[0]?.address;
        if (out0) byAddr.set(out0, [...(byAddr.get(out0) || []), m]);
    }
    for (const [address, ms] of byAddr) {
        let u;
        try { u = await fetchUtxos(bitcoin, { network, address, maxPages }); } catch { continue; } // eslint-disable-line no-await-in-loop
        const keys = new Set(u.utxos.map(outpointKey));
        const hit = ms.find((m) => keys.has(`${recordTxid(m)}:0`));
        if (hit) return recordTxid(hit);
    }
    return null;
}

/// vbytes one more coin adds to a child (for the "adds a coin" note).
export const EXTRA_INPUT_VBYTES = INPUT_VBYTES;
