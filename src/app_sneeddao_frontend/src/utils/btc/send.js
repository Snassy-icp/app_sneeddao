// The native Bitcoin send itself (spec/sneed_wallet.md §5.3 steps 4-6, §8). Custody-relevant.
// No React; every canister and the storage are passed in, so the whole flow is tested with
// mocks in test/canisters/tests/btc-send.test.js.
//
//   1. buildSendRequest: the exact SendBtcRequest — the chosen UTXOs in our order, our outputs,
//      and an explicit fee_satoshis (never null: the signer's own default underestimates).
//   2. executeSend: compute expectedTxid, write a `submitting` record (refuse to send when it
//      can't be written), call btc_caller_send(req, opt CallerPaysIcrc2Cycles), and record the
//      outcome: Ok → broadcast (txid checked against the expected one), typed Err → failed,
//      throw/timeout → unknown (the coins stay locked; §8 recovery).
//   3. reissueSend: the identical request again for an `unknown` record (same txid).
//   4. verifySignerAddress: once per principal and network, before the first send, ask the
//      signer for our address (0.079B cycles) and refuse to send if it differs from the one we
//      derive offline (§5.2 step 1).
//   5. executeReplacement / executeCpfp (phase A4, utils/btc/speedup.js plans): a speed-up is a
//      send like any other (record first, expected txid, same outcomes), linked to the stuck
//      record in the same atomic write: an RBF replacement joins its supersede group and marks the
//      original `supersededBy` (cleared again if the replacement fails); a CPFP child names its
//      `parent`, which gets `cpfpBy`.
import { Principal } from '@dfinity/principal';
import { expectedTxid, txidToInternal } from './txid.js';
import { networkVariant } from './utxos.js';
import { sendCycles } from './credit.js';
import { newRecord, updateRecord, loadRecords, saveRecords, canReissue, groupId, recordTxid } from './pending.js';
import { sendErrorInfo, callFailureText, addressErrorText } from './errors.js';

export const PAY_WITH_CYCLES = Object.freeze([{ CallerPaysIcrc2Cycles: null }]);

/// The candid SendBtcRequest for a plan (select.js) to `outputs` ([{ address, value }]).
export function buildSendRequest({ inputs, outputs, fee, network }) {
    return {
        fee_satoshis: [BigInt(fee)],
        network: networkVariant(network),
        utxos_to_spend: inputs.map((u) => ({
            height: Number(u.height),
            value: BigInt(u.value),
            outpoint: { txid: txidToInternal(u.txid), vout: Number(u.vout) },
        })),
        address_type: { P2WPKH: null },
        outputs: outputs.map((o) => ({ destination_address: o.address, sent_satoshis: BigInt(o.value) })),
    };
}

/// The request stored in a record, rebuilt for the signer (identical to the first one).
export const requestFromRecord = (r) => buildSendRequest({ inputs: r.request.inputs, outputs: r.request.outputs, fee: r.request.fee, network: r.network });

/// A store over (storage, key) that always re-reads before writing, so two tabs don't undo each other.
export function makeStore(storage, key) {
    return {
        load: () => loadRecords(storage, key),
        /// apply fn(records) → records; true when saved
        mutate(fn) {
            const cur = loadRecords(storage, key);
            if (!cur.ok) return false;
            return saveRecords(storage, key, fn(cur.records));
        },
    };
}

/**
 * Send `plan` (select.js planSend, ok) of `amount` to `toAddress`.
 *   signer       actor with btc_caller_send
 *   store        makeStore(...)
 *   ownAddress   our P2WPKH address (for the change output and the txid)
 *   kind/extra   'send', or 'toCkbtc' with extra = { ckbtc } (moves.js newDepositInfo), 'sweep', ...
 *   outputs      [{ address, value }] instead of one output of plan.amount to toAddress
 *   link         (records, rec) → records: patch related records in the same write (speed-ups)
 *   tipHeight    the Bitcoin tip now, kept as tipAtSend (speed-up counts blocks from it)
 * Returns { state: 'broadcast'|'failed'|'unknown'|'not_sent', record, txid?, error?, info? }.
 * 'not_sent' means the record could not be written, so the signer was never called.
 */
export async function executeSend({ signer, store, plan, toAddress = null, outputs: outs = null, network, ownAddress, id, kind = 'send', extra = null, link = null, tipHeight = null, now = Date.now, onSubmitting = null }) {
    const outputs = outs || [{ address: toAddress, value: plan.amount }];
    const expected = expectedTxid({ inputs: plan.inputs, outputs, change: plan.change, ownAddress, network });
    const t0 = now();
    const rec = newRecord({ id, network, kind, plan, outputs, ownAddress, expected, signingCycles: sendCycles(plan.inputs.length, outputs.length), now: t0 });
    // a move to ckBTC carries its conversion record (utils/btc/moves.js) in the same pending record
    if (extra) Object.assign(rec, extra);
    if (tipHeight != null) rec.tipAtSend = Number(tipHeight);
    rec.attempts = 1;
    rec.lastAttemptAt = t0;
    if (!store.mutate((rs) => (link ? link([...rs, rec], rec) : [...rs, rec]))) {
        return { state: 'not_sent', record: rec, error: "Couldn't save the pending send on this device, so nothing was sent. Allow site storage and try again." };
    }
    onSubmitting?.(rec);
    return callSigner({ signer, store, record: rec, request: buildSendRequest({ inputs: plan.inputs, outputs, fee: plan.fee, network }), now });
}

/**
 * RBF: replace the broadcast `original` with `plan` (speedup.js planRbf, ok): the same inputs, the
 * same recipients (or, with consent, a smaller amount), a higher fee. Refused unless the original
 * is still broadcast in the store. The original stays pending until one version is mined.
 */
export async function executeReplacement({ signer, store, original, plan, network, ownAddress, id, tipHeight = null, now = Date.now, onSubmitting = null }) {
    const cur = store.load();
    const live = cur.ok ? cur.records.find((r) => r.id === original.id) : null;
    if (!live || live.state !== 'broadcast') return { state: 'refused', error: 'This send is no longer waiting for a block, so it was not replaced. Nothing was sent.' };
    const extra = {
        group: groupId(original),
        replaces: original.id,
        replacesTxid: recordTxid(original),
        speedUp: 'rbf',
        ...(plan.reduced ? { reducedBy: String(plan.reducedBy) } : {}),
    };
    // a move to ckBTC keeps its conversion on the version that wins
    if (original.ckbtc) {
        extra.ckbtc = { ...original.ckbtc, status: 'waiting', confirmations: null, checks: 0, lastCheckAt: null, nextCheckAt: null, message: null, ...(plan.reduced ? { expectedMint: String(plan.amount - BigInt(original.ckbtc.checkFee || 0)) } : {}) };
    }
    const t = now();
    const res = await executeSend({
        signer, store, plan, outputs: plan.outputs, network, ownAddress, id, kind: original.kind || 'send', extra, tipHeight, now, onSubmitting,
        link: (rs, rec) => updateRecord(rs, original.id, { supersededBy: rec.id }, { now: t, event: 'replacement', detail: `replaced by ${rec.expectedTxid} (fee ${rec.fee} sats)` }),
    });
    if (res.state === 'failed') {
        store.mutate((rs) => updateRecord(rs, original.id, { supersededBy: null }, { now: now(), event: 'replacement failed', detail: res.error }));
    }
    return res;
}

/**
 * CPFP: a child (speedup.js planCpfp, ok) that spends `parent`'s unconfirmed change back to our
 * own address. Refused unless the parent is still broadcast.
 */
export async function executeCpfp({ signer, store, parent, plan, network, ownAddress, id, tipHeight = null, now = Date.now, onSubmitting = null }) {
    const cur = store.load();
    const live = cur.ok ? cur.records.find((r) => r.id === parent.id) : null;
    if (!live || live.state !== 'broadcast') return { state: 'refused', error: 'The stuck send is no longer waiting for a block, so no speed-up was sent.' };
    const t = now();
    const res = await executeSend({
        signer, store, plan, outputs: [plan.output], network, ownAddress, id, kind: 'cpfp', tipHeight, now, onSubmitting,
        extra: { parent: parent.id, parentTxid: recordTxid(parent), speedUp: 'cpfp', changeVout: 0, packageRate: plan.packageRate },
        link: (rs, rec) => updateRecord(rs, parent.id, { cpfpBy: rec.id }, { now: t, event: 'cpfp', detail: `child ${rec.expectedTxid} (fee ${rec.fee} sats, package ${plan.packageRate.toFixed(2)} sat/vB)` }),
    });
    return res;
}

async function callSigner({ signer, store, record, request, now }) {
    let res;
    try {
        res = await signer.btc_caller_send(request, PAY_WITH_CYCLES);
    } catch (e) {
        const error = callFailureText(e);
        store.mutate((rs) => updateRecord(rs, record.id, { state: 'unknown', error }, { now: now(), event: 'call failed', detail: String(e?.message || e).slice(0, 300) }));
        return { state: 'unknown', record: { ...record, state: 'unknown', error }, error };
    }
    if (res && 'Ok' in res) {
        const txid = res.Ok.txid;
        const drift = txid !== record.expectedTxid;
        const t = now();
        store.mutate((rs) => updateRecord(rs, record.id, { state: 'broadcast', txid, broadcastAt: t, error: null, txidDrift: drift || undefined },
            { now: t, event: 'broadcast', detail: drift ? `txid ${txid} differs from expected ${record.expectedTxid}` : null }));
        if (drift) {
            try { console.warn('[btc] signer txid differs from expectedTxid: the local builder has drifted', { expected: record.expectedTxid, txid }); } catch { /* no console */ }
        }
        return { state: 'broadcast', txid, drift, record: { ...record, state: 'broadcast', txid } };
    }
    const info = sendErrorInfo(res?.Err);
    store.mutate((rs) => updateRecord(rs, record.id, { state: 'failed', error: info.text, charged: info.charged }, { now: now(), event: 'failed', detail: info.text }));
    return { state: 'failed', error: info.text, info, record: { ...record, state: 'failed', error: info.text } };
}

/// Re-issue the identical send of an `unknown` record (spec §8). `utxoKeys` = current UTXO set.
export async function reissueSend({ signer, store, record, utxoKeys, now = Date.now }) {
    if (!canReissue(record, utxoKeys)) return { state: 'refused', error: 'This send can only be repeated while its outcome is unknown and its coins are unspent.' };
    const t = now();
    if (!store.mutate((rs) => updateRecord(rs, record.id, { state: 'submitting', attempts: (record.attempts || 1) + 1, lastAttemptAt: t }, { now: t, event: 're-issue' }))) {
        return { state: 'not_sent', error: "Couldn't save the pending send on this device, so nothing was sent." };
    }
    return callSigner({ signer, store, record: { ...record, state: 'submitting' }, request: requestFromRecord(record), now });
}

// ---- address check against the signer (once) ----

export const verifiedKey = (network, principal) => `sneed_btc_addr_verified_v1:${network}:${String(principal)}`;

/// Did we already check this address against the signer on this device?
export function isAddressVerified(storage, network, principal, address) {
    try { return storage?.getItem(verifiedKey(network, principal)) === address; } catch { return false; }
}

/// Ask the signer for our address (paid) and compare. { ok: true } | { ok: false, mismatch?, error }.
export async function verifySignerAddress({ signer, network, expected, storage = null, principal = null }) {
    let res;
    try {
        res = await signer.btc_caller_address({ network: networkVariant(network), address_type: { P2WPKH: null } }, PAY_WITH_CYCLES);
    } catch (e) {
        return { ok: false, error: `Couldn't check your address with the signer (${String(e?.message || e).split('\n')[0]}). Try again.` };
    }
    if (!res || !('Ok' in res)) return { ok: false, error: addressErrorText(res?.Err) };
    const got = res.Ok.address;
    if (got !== expected) {
        try { console.error('[btc] signer address differs from the offline derivation', { expected, got }); } catch { /* no console */ }
        return { ok: false, mismatch: true, got, error: `Stopped: the signer says your address is ${got}, but this page computed ${expected}. Nothing was sent. Please report this to Sneed support.` };
    }
    try { storage?.setItem(verifiedKey(network, principal), expected); } catch { /* storage blocked: we check again next time */ }
    return { ok: true };
}

/// The principal the signer acts for must be the logged-in one (never anonymous).
export function assertSigningPrincipal(identity) {
    const p = identity?.getPrincipal?.();
    if (!p || p.isAnonymous?.() || p.toText() === Principal.anonymous().toText()) throw new Error('Sign in first: Bitcoin is signed for your principal.');
    return p;
}
