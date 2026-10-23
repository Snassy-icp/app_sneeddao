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
            inputs: plan.inputs.map((u) => ({ txid: u.txid, vout: u.vout, value: s(u.value), height: u.height })),
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

/// The record's inputs as outpoint keys.
const inputKeys = (r) => (r.request?.inputs || []).map(outpointKey);

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
export function reconcile(record, { utxoKeys, now, mempool = null }) {
    const st = record.state;
    if (FINAL_STATES.includes(st)) return { state: st, action: 'none', reason: 'final' };
    const keys = inputKeys(record);
    const gone = keys.filter((k) => !utxoKeys.has(k));
    if (keys.length && gone.length === keys.length) {
        const txid = record.txid || record.expectedTxid;
        if (record.changeVout != null && utxoKeys.has(`${txid}:${record.changeVout}`)) return { state: 'confirmed', action: 'none', reason: 'change output is in the UTXO set' };
        return { state: 'confirmed', action: 'none', reason: mempool?.confirmed ? 'mempool.space shows it confirmed' : 'all inputs were spent' };
    }
    if (gone.length) {
        // some inputs spent, some not: another transaction took them, so ours can never confirm
        return { state: 'replaced', action: 'none', reason: `${gone.length} of ${keys.length} inputs were spent by another transaction` };
    }
    // every input still unspent
    if (st === 'submitting') {
        // a record left in submitting means the page closed during the call: outcome unknown
        return { state: 'unknown', action: 'wait', reason: 'the page closed while the signer was working' };
    }
    if (st === 'unknown') {
        if (mempool?.seen) return { state: 'broadcast', action: 'wait', reason: 'mempool.space has the transaction' };
        if (now - (record.lastAttemptAt || record.createdAt) >= REISSUE_AFTER_MS) return { state: 'unknown', action: 'offer_reissue', reason: 'not seen for 30 minutes' };
        return { state: 'unknown', action: 'wait', reason: 'waiting for the transaction to show up' };
    }
    // broadcast
    if (now - (record.broadcastAt || record.createdAt) >= DROP_AFTER_MS && !mempool?.seen) return { state: 'broadcast', action: 'offer_drop', reason: 'not mined after 14 days' };
    return { state: 'broadcast', action: 'wait', reason: 'waiting for a block' };
}

/// May this record be re-issued now? Only an `unknown` send whose inputs are all still unspent.
export function canReissue(record, utxoKeys) {
    if (record.state !== 'unknown') return false;
    const keys = inputKeys(record);
    return keys.length > 0 && keys.every((k) => utxoKeys.has(k));
}

/// Apply reconcile() to every record except those whose call is still running in this page
/// (`inFlight` ids); returns { records, changed }.
export function reconcileAll(records, { utxoKeys, now, inFlight = new Set() }) {
    let changed = false;
    let out = records;
    for (const r of records) {
        if (inFlight.has(r.id)) continue;
        const d = reconcile(r, { utxoKeys, now });
        if (d.state !== r.state) {
            out = updateRecord(out, r.id, { state: d.state, ...(d.state === 'confirmed' && !r.txid ? { txid: r.expectedTxid } : {}) }, { now, event: `-> ${d.state}`, detail: d.reason });
            changed = true;
        }
    }
    return { records: out, changed };
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
