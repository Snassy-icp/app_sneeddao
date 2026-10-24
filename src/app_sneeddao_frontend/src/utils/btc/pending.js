// Pending native-Bitcoin sends and the UTXOs they lock (spec/sneed_wallet.md §5.5, §8). Pure
// apart from the storage handle, tested in test/canisters/tests/btc-send.test.js.
//
// Storage, for now: this browser's localStorage, keyed by network and principal. The spec's
// target is the user's backend layout store (synced across devices), but that store
// (app_sneeddao_backend get/set_wallet_layout) only holds lists of principals, so it needs a
// canister change by proposal first. Until then:
//   - a send made on another device is not known here; its coins are not locked here, and a
//     second send from here that picks them fails at the network (no BTC is lost, the signing
//     cycles are);
//   - if localStorage can't be read or written, sends are BLOCKED ("can't check pending sends"),
//     as Oisy does with PendingTransactionsNotAvailable. Receive still works.
//
// A record is written BEFORE the signer is called (state `submitting`) and every later step
// updates it, with a short event log for support ("Help → BTC send log").
//
// States: submitting → broadcast | failed | unknown; broadcast → confirmed | replaced | dropped;
// unknown → broadcast | confirmed | replaced | (re-issue) ...
// Locked UTXOs = inputs of records in submitting, broadcast or unknown.
//
// Speed-up (phase A4, utils/btc/speedup.js):
//   - RBF: a replacement record spends the SAME inputs at a higher fee. It joins the original's
//     group (`group` = the first record's id; `replaces` = the record it replaced) and the original
//     gets `supersededBy`. Both stay pending and both lock the inputs. Once the inputs are spent,
//     whichever txid is proven mined becomes `confirmed` and every other member `replaced`
//     (`replacedBy` = the winning txid). Proof that a txid was mined (minedTxids): one of its
//     outputs is in our UTXO set (the change), a later record of ours spends one of its outputs,
//     or a lookup marked it (`minedSeen`: the recipient's UTXOs on the IC Bitcoin canister, or the
//     opt-in mempool.space check). Without proof the members wait with action 'identify'.
//   - CPFP: a child record (kind 'cpfp', `parent` = the stuck record's id) spends the parent's
//     unconfirmed change output (an input flagged `unconfirmed`: the Bitcoin canister lists mined
//     outputs only, so its absence from the UTXO set means nothing) plus, if needed, confirmed
//     coins. It pays to our own address (output 0), so it is confirmed when that output shows up,
//     and replaced when its parent was replaced or dropped.
import { outpointKey } from './utxos.js';

export const STORE_VERSION = 1;
export const LOCKING_STATES = Object.freeze(['submitting', 'broadcast', 'unknown']);
export const FINAL_STATES = Object.freeze(['confirmed', 'failed', 'replaced', 'dropped']);
/// An `unknown` send can be re-issued (the identical request) after this long unseen.
export const REISSUE_AFTER_MS = 30 * 60 * 1000;
/// A broadcast send whose inputs are still unspent after this long may be marked dropped.
export const DROP_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_RECORDS = 200;
const MAX_LOG = 30;

export const storeKey = (network, principal) => `sneed_btc_pending_v${STORE_VERSION}:${network}:${String(principal)}`;

export function defaultStorage() {
    try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

/// Read every record: { ok: true, records } or { ok: false, error } (then sends are blocked).
export function loadRecords(storage, key) {
    try {
        if (!storage) throw new Error('no storage');
        const raw = storage.getItem(key);
        if (raw == null) return { ok: true, records: [] };
        const v = JSON.parse(raw);
        if (!Array.isArray(v)) throw new Error('not a list');
        return { ok: true, records: v };
    } catch (e) {
        return { ok: false, error: `Can't check pending Bitcoin sends on this device (${e?.message || e}), so sending is paused. Allow site storage for this page, or try another browser.` };
    }
}

/// Write the records and read them back. true only when the write really stuck.
export function saveRecords(storage, key, records) {
    try {
        if (!storage) return false;
        const text = JSON.stringify(records.slice(-MAX_RECORDS));
        storage.setItem(key, text);
        return storage.getItem(key) === text;
    } catch {
        return false;
    }
}

/// Outpoint keys ("txid:vout") that pending sends spend.
export function lockedOutpoints(records) {
    const s = new Set();
    for (const r of records) if (LOCKING_STATES.includes(r.state)) for (const i of r.request?.inputs || []) s.add(outpointKey(i));
    return s;
}

/// The txid a record stands for: the signer's answer, else the one we computed.
export const recordTxid = (r) => r.txid || r.expectedTxid;
/// The supersede group of a record (RBF): the id of the first send of the chain.
export const groupId = (r) => r.group || r.id;

/**
 * Txids proven mined, from what the IC Bitcoin canister and our own records show:
 *   - every txid with an output in our UTXO set (the canister lists mined outputs only);
 *   - every txid one of our records spends a confirmed output of (we only ever spend confirmed
 *     coins, except a CPFP child's input flagged `unconfirmed`, which proves nothing);
 *   - every record marked `minedSeen` by a lookup.
 */
export function minedTxids(records, utxoKeys) {
    const out = new Set();
    for (const k of utxoKeys) out.add(String(k).split(':')[0]);
    for (const r of records) {
        for (const i of r.request?.inputs || []) if (!i.unconfirmed) out.add(i.txid);
        if (r.minedSeen) out.add(recordTxid(r));
    }
    return out;
}

/// The other live versions of a record (RBF group members that did not fail), oldest first.
export function groupMembers(records, r) {
    const g = groupId(r);
    return records.filter((x) => groupId(x) === g && x.state !== 'failed').sort((a, b) => a.createdAt - b.createdAt);
}

/// The CPFP child of `r` that is still pending, if any.
export const pendingChild = (records, r) => records.find((x) => x.kind === 'cpfp' && x.parent === r.id && !FINAL_STATES.includes(x.state)) || null;

const s = (n) => (n == null ? null : String(n));

/**
 * A new `submitting` record. Amounts are stored as strings (BigInt-safe JSON).
 *   plan     from select.js planSend
 *   outputs  [{ address, value }] as sent to the signer
 *   expected { txid, changeVout } from txid.js expectedTxid
 */
export function newRecord({ id, network, kind = 'send', plan, outputs, ownAddress, expected, signingCycles, now }) {
    return {
        v: STORE_VERSION,
        id,
        kind,
        network,
        state: 'submitting',
        createdAt: now,
        updatedAt: now,
        expectedTxid: expected.txid,
        changeVout: expected.changeVout,
        txid: null,
        ownAddress,
        // everything needed to re-issue the identical btc_caller_send
        request: {
            inputs: plan.inputs.map((u) => ({ txid: u.txid, vout: u.vout, value: s(u.value), height: u.height, ...(u.unconfirmed ? { unconfirmed: true } : {}) })),
            outputs: outputs.map((o) => ({ address: o.address, value: s(o.value) })),
            fee: s(plan.fee),
        },
        amount: s(plan.amount),
        change: s(plan.change),
        fee: s(plan.fee),
        feeRate: plan.feeRate,
        vsize: plan.vsize,
        signingCycles: s(signingCycles),
        attempts: 0,
        error: null,
        log: [{ at: now, event: 'created' }],
    };
}

/// Records with record `id` patched and an event appended (pure).
export function updateRecord(records, id, patch, { now, event = null, detail = null } = {}) {
    return records.map((r) => {
        if (r.id !== id) return r;
        const log = event ? [...(r.log || []), { at: now, event, ...(detail ? { detail } : {}) }].slice(-MAX_LOG) : r.log;
        return { ...r, ...patch, updatedAt: now, log };
    });
}

/// The record's confirmed inputs as outpoint keys (a CPFP child's unconfirmed parent output is
/// never in the canister's UTXO set, so it is left out of every "spent?" test).
const inputKeys = (r) => (r.request?.inputs || []).filter((i) => !i.unconfirmed).map(outpointKey);
const hasUnconfirmedInput = (r) => (r.request?.inputs || []).some((i) => i.unconfirmed);

/// What a record whose fate is not decided yet waits for (state submitting / unknown / broadcast).
function waiting(record, { now, mempool }) {
    const st = record.state;
    if (st === 'submitting') {
        // a record left in submitting means the page closed during the call: outcome unknown
        return { state: 'unknown', action: 'wait', reason: 'the page closed while the signer was working' };
    }
    if (st === 'unknown') {
        if (mempool?.seen) return { state: 'broadcast', action: 'wait', reason: 'mempool.space has the transaction' };
        if (now - (record.lastAttemptAt || record.createdAt) >= REISSUE_AFTER_MS) return { state: 'unknown', action: 'offer_reissue', reason: 'not seen for 30 minutes' };
        return { state: 'unknown', action: 'wait', reason: 'waiting for the transaction to show up' };
    }
    if (now - (record.broadcastAt || record.createdAt) >= DROP_AFTER_MS && !mempool?.seen) return { state: 'broadcast', action: 'offer_drop', reason: 'not mined after 14 days' };
    return { state: 'broadcast', action: 'wait', reason: 'waiting for a block' };
}

/// A CPFP child: confirmed when its own output (vout 0, to us) is mined; replaced when its parent
/// lost (replaced / dropped / failed) or one of its confirmed coins went elsewhere.
function reconcileChild(record, { utxoKeys, now, mempool, ctx, mined }) {
    const txid = recordTxid(record);
    if (mined.has(txid) || utxoKeys.has(`${txid}:0`) || mempool?.confirmed) return { state: 'confirmed', action: 'none', reason: 'its output to you is mined' };
    const parent = ctx.find((x) => x.id === record.parent);
    if (parent && ['replaced', 'dropped', 'failed'].includes(parent.state)) {
        return { state: 'replaced', action: 'none', reason: `the transaction it sped up was ${parent.state}`, patch: { replacedBy: parent.replacedBy || null } };
    }
    const keys = inputKeys(record);
    if (keys.some((k) => !utxoKeys.has(k))) return { state: 'replaced', action: 'none', reason: 'one of its coins was spent by another transaction' };
    return waiting(record, { now, mempool });
}

/**
 * What a record's state is now, given the current UTXO set of the address (outpoint keys; the
 * IC Bitcoin canister lists mined outputs only) and, when the user asked, what mempool.space
 * says about the expected txid (`mempool`: { seen, confirmed } or null).
 * Returns { state, action, reason }:
 *   action 'none'            nothing to do
 *   action 'wait'            keep watching
 *   action 'offer_reissue'   unknown and unseen for 30 min: offer the identical send again
 *                            (same txid, a harmless duplicate if it did go out; costs signing
 *                            cycles again)
 *   action 'offer_drop'      broadcast long ago and never mined: offer to mark it dropped
 */
export function reconcile(record, { utxoKeys, now, mempool = null, records = null, mined = null }) {
    const st = record.state;
    if (FINAL_STATES.includes(st)) return { state: st, action: 'none', reason: 'final' };
    const ctx = records || [record];
    const proven = mined || minedTxids(ctx, utxoKeys);
    if (record.kind === 'cpfp' && record.parent) return reconcileChild(record, { utxoKeys, now, mempool, ctx, mined: proven });
    const keys = inputKeys(record);
    const gone = keys.filter((k) => !utxoKeys.has(k));
    if (keys.length && gone.length === keys.length) {
        const txid = recordTxid(record);
        // RBF: several versions spend these inputs; only the one proven mined is confirmed
        const members = groupMembers(ctx, record);
        if (members.length > 1) {
            const won = (x) => x.state === 'confirmed' || proven.has(recordTxid(x)) || (x.id === record.id && mempool?.confirmed);
            if (won(record)) return { state: 'confirmed', action: 'none', reason: 'this version was mined' };
            const winner = members.find((x) => x.id !== record.id && won(x));
            if (winner) return { state: 'replaced', action: 'none', reason: `another version (${recordTxid(winner)}) was mined`, patch: { replacedBy: recordTxid(winner) } };
            return { state: st === 'submitting' ? 'unknown' : st, action: 'identify', reason: 'its coins were spent; which version was mined is not known yet' };
        }
        if (record.changeVout != null && utxoKeys.has(`${txid}:${record.changeVout}`)) return { state: 'confirmed', action: 'none', reason: 'change output is in the UTXO set' };
        return { state: 'confirmed', action: 'none', reason: mempool?.confirmed ? 'mempool.space shows it confirmed' : 'all inputs were spent' };
    }
    if (gone.length) {
        // some inputs spent, some not: another transaction took them, so ours can never confirm
        return { state: 'replaced', action: 'none', reason: `${gone.length} of ${keys.length} inputs were spent by another transaction` };
    }
    // every input still unspent
    return waiting(record, { now, mempool });
}

/// May this record be re-issued now? Only an `unknown` send whose inputs are all still unspent.
/// A CPFP child's unconfirmed parent output can't be checked here; its confirmed coins must be unspent.
export function canReissue(record, utxoKeys) {
    if (record.state !== 'unknown') return false;
    const keys = inputKeys(record);
    return (keys.length > 0 || hasUnconfirmedInput(record)) && keys.every((k) => utxoKeys.has(k));
}

/// Apply reconcile() to every record except those whose call is still running in this page
/// (`inFlight` ids); returns { records, changed }. Sends and replacements first, then CPFP
/// children (whose fate follows their parent's).
export function reconcileAll(records, { utxoKeys, now, inFlight = new Set() }) {
    let changed = false;
    let out = records;
    for (const children of [false, true]) {
        const mined = minedTxids(out, utxoKeys);
        for (const r0 of out.filter((x) => (x.kind === 'cpfp' && Boolean(x.parent)) === children)) {
            if (inFlight.has(r0.id)) continue;
            const r = out.find((x) => x.id === r0.id);
            const d = reconcile(r, { utxoKeys, now, records: out, mined });
            if (d.state !== r.state) {
                const patch = { state: d.state, ...(d.patch || {}), ...(d.state === 'confirmed' && !r.txid ? { txid: r.expectedTxid } : {}) };
                out = updateRecord(out, r.id, patch, { now, event: `-> ${d.state}`, detail: d.reason });
                changed = true;
            }
        }
    }
    return { records: out, changed };
}

/// Mark `txid`'s record as proven mined (a lookup found it); reconcileAll then settles its group.
export function markMined(records, txid, { now, via }) {
    return records.map((r) => (recordTxid(r) === txid && !r.minedSeen ? { ...r, minedSeen: true, updatedAt: now, log: [...(r.log || []), { at: now, event: 'mined', detail: via }].slice(-MAX_LOG) } : r));
}

/// A random record id.
export function newId() {
    try {
        const b = new Uint8Array(8);
        globalThis.crypto.getRandomValues(b);
        return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    } catch {
        return `${Date.now().toString(16)}${Math.floor(Math.random() * 1e9).toString(16)}`;
    }
}

/** The note on a replaced send naming the version that was mined: the faster one, or the original. */
export function minedVersionNote(record, records) {
    const mined = records.find((x) => recordTxid(x) === record.replacedBy);
    if (!mined) return '';
    return BigInt(mined.fee ?? 0) > BigInt(record.fee ?? 0) ? ' (your faster version)' : ' (your original version)';
}
