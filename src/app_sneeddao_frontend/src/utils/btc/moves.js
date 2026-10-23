// Native Bitcoin <-> ckBTC moves (spec/sneed_wallet.md §6, phase A3). Custody-relevant. No React;
// every canister and the storage are passed in, so the flows are tested with mocks in
// test/canisters/tests/btc-moves.test.js.
//
// Native -> ckBTC ("Move to ckBTC"):
//   1. the minter's deposit address for the user's account (get_btc_address { owner = me });
//   2. a normal native send to it (send.js executeSend, kind 'toCkbtc'): plan, review, expected
//      txid, pending record, recovery — the record carries `ckbtc` (newDepositInfo), so the
//      conversion survives a reload in the same per-network, per-principal pending store;
//   3. once the deposit output has the minter's min_confirmations, update_balance as the user
//      (automatically while btc.html is open, and on "Check / finish"), with backoff; the
//      result moves the conversion to minted / too_small / tainted, or keeps waiting.
//   Phases (movePhase): submitting → (unknown) → waiting_confs → minting → minted,
//   or failed / replaced / dropped (the send) / too_small / tainted (the minter).
//
// ckBTC -> native ("Move to my Bitcoin address"): icrc2_approve the minter on the ck ledger for
// amount + one ledger fee (headroom; what is not used lapses within the hour), then
// retrieve_btc_with_approval { address = the user's own native address } (ckMinters.js
// ckbtcWithdraw), tracked with retrieve_btc_status_v2. Its records live in their own store
// (movesKey), so the native send reconciliation never touches them.
import { Principal } from '@dfinity/principal';
import {
    ckbtcMinter, ckbtcWithdraw, planBtcWithdrawal, btcWithdrawErrorText, updateBalanceErrorText, formatUnits,
} from '../ckMinters.js';
import { txidHex, fetchUtxos } from './utxos.js';
import { MIN_SEND_SATS } from './select.js';
import { loadRecords, saveRecords } from './pending.js';

export const BLOCK_MINUTES = 10;
/// The deposit is the first output of the move's transaction (change, if any, comes after it).
export const DEPOSIT_VOUT = 0;
const MAX_LOG = 30;
const s = (n) => (n == null ? null : String(n));
const big = (n) => (n == null ? null : BigInt(n));
const P = (x) => (typeof x === 'string' ? Principal.fromText(x) : x);
const sub = (hex) => (hex ? [Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)))] : []);

// ---------------------------------------------------------------- minter terms

/// The numbers the move dialogs show, from ckMinters.js ckbtcInfo (get_minter_info + get_deposit_fee).
/// checkFee: get_deposit_fee when it answered, else kyt_fee (the same fee under its old name).
export function minterTerms(info) {
    if (!info) return null;
    return {
        minConfirmations: Number(info.min_confirmations),
        checkFee: BigInt(info.deposit_fee ?? info.kyt_fee ?? 0),
        minDeposit: info.deposit_btc_min_amount?.[0] != null ? BigInt(info.deposit_btc_min_amount[0]) : null,
        retrieveMin: BigInt(info.retrieve_btc_min_amount),
    };
}

/// An honest wait: blocks still needed × 10 minutes ("about 40 minutes (4 blocks)"). Blocks vary;
/// the UI says it can take longer.
export function depositEta(minConfirmations, confirmations = 0) {
    const left = Math.max(0, Number(minConfirmations) - Number(confirmations || 0));
    return { blocks: left, minutes: left * BLOCK_MINUTES, text: left === 0 ? 'any moment now' : `about ${left * BLOCK_MINUTES} minutes (${left} block${left === 1 ? '' : 's'})` };
}

/// Smallest deposit the move allows: our send minimum, the minter's deposit minimum, and more than
/// the check fee (a deposit at or below it mints nothing).
export function depositMin(terms) {
    let m = MIN_SEND_SATS;
    if (terms?.minDeposit != null && terms.minDeposit > m) m = terms.minDeposit;
    if (terms && terms.checkFee + 1n > m) m = terms.checkFee + 1n;
    return m;
}

/// Is `amount` (sats arriving at the deposit address) a deposit the minter will mint?
/// { ok, min, receive (ckBTC after the check fee), error }.
export function depositGuard({ amount, terms, symbol = 'ckBTC' }) {
    if (!terms) return { ok: false, min: null, receive: null, error: "Waiting for the minter's terms." };
    const min = depositMin(terms);
    if (amount == null) return { ok: false, min, receive: null, error: 'Enter an amount.' };
    const a = BigInt(amount);
    if (a < min) {
        return { ok: false, min, receive: null, error: `Too small to move: the minter needs at least ${min.toLocaleString('en-US')} sats (it ignores deposits under ${(terms.minDeposit ?? 0n).toLocaleString('en-US')} sats and takes a ${terms.checkFee.toLocaleString('en-US')} sats check fee). Nothing would arrive as ${symbol}.` };
    }
    return { ok: true, min, receive: a - terms.checkFee, error: null };
}

// ---------------------------------------------------------------- native -> ckBTC: the record

/// The `ckbtc` part of a toCkbtc pending record (amounts as strings, BigInt-safe JSON).
export function newDepositInfo({ pair, owner, subaccount = null, depositAddress, terms, amount }) {
    return {
        minter: pair.minter,
        ledger: pair.ledger,
        symbol: pair.symbol,
        owner: String(owner),
        subaccount, // hex or null (Main)
        depositAddress,
        vout: DEPOSIT_VOUT,
        minConfirmations: terms.minConfirmations,
        checkFee: s(terms.checkFee),
        minDeposit: s(terms.minDeposit),
        expectedMint: s(BigInt(amount) - terms.checkFee),
        status: 'waiting', // waiting | checked | minted | too_small | tainted
        confirmations: null,
        checks: 0,
        lastCheckAt: null,
        nextCheckAt: null,
        mintedAmount: null,
        mintBlock: null,
        message: null,
    };
}

export const CK_FINAL = Object.freeze(['minted', 'too_small', 'tainted']);
export const MOVE_FINAL = Object.freeze(['minted', 'too_small', 'tainted', 'failed', 'replaced', 'dropped']);
const SENT_STATES = ['broadcast', 'confirmed'];

/// Where a move to ckBTC stands, from the send state and the conversion state.
///   submitting      the signer is working (or the page closed during the call: see unknown)
///   unknown         the send's outcome is unknown (send recovery in Activity)
///   failed          the send failed: nothing left the address
///   replaced/dropped the send never made it
///   waiting_confs   sent; waiting for the minter's confirmations
///   minting         enough confirmations (or the minter checked it): update_balance finishes it
///   minted / too_small / tainted   the minter's verdict
export function movePhase(r) {
    const ck = r?.ckbtc;
    if (!ck) return null;
    if (CK_FINAL.includes(ck.status)) return ck.status;
    if (['submitting', 'unknown', 'failed', 'replaced', 'dropped'].includes(r.state)) return r.state;
    if (ck.status === 'checked') return 'minting';
    if (ck.confirmations != null && ck.confirmations >= ck.minConfirmations) return 'minting';
    return 'waiting_confs';
}

/// Backoff after a check, by what it found (`checks` = checks so far, including this one).
export function backoffMs(outcome, checks = 1) {
    switch (outcome) {
        case 'checked': return 2 * 60_000; // passed the check, the ledger was busy: retry soon
        case 'busy': return 60_000; // AlreadyProcessing / TemporarilyUnavailable / call failed
        case 'error': return 5 * 60_000; // GenericError
        default: return Math.min(60_000 * 2 ** Math.max(0, checks - 1), 15 * 60_000); // pending / not seen
    }
}

/// Should the page call update_balance for this record now? { due, reason }. `manual` (the
/// "Check / finish" button) skips the backoff and the confirmation wait, never a final state.
export function checkDue(r, { now, manual = false } = {}) {
    const ck = r?.ckbtc;
    if (!ck) return { due: false, reason: 'not a move' };
    const phase = movePhase(r);
    if (MOVE_FINAL.includes(phase)) return { due: false, reason: 'final' };
    if (!SENT_STATES.includes(r.state)) return { due: false, reason: 'the send has not gone out yet' };
    if (manual) return { due: true, reason: 'asked' };
    if (ck.nextCheckAt && now < ck.nextCheckAt) return { due: false, reason: 'backing off' };
    if (phase === 'minting') return { due: true, reason: 'enough confirmations' };
    if (ck.confirmations == null) {
        // not seen at the deposit address: unmined yet, or already minted and spent by the minter
        const since = r.broadcastAt || r.createdAt;
        if (now - since >= ck.minConfirmations * BLOCK_MINUTES * 60_000) return { due: true, reason: 'the expected wait has passed' };
    }
    return { due: false, reason: 'waiting for confirmations' };
}

const utxoKey = (u) => `${txidHex(u.outpoint.txid)}:${Number(u.outpoint.vout)}`;
const depositKey = (r) => `${r.txid || r.expectedTxid}:${r.ckbtc?.vout ?? DEPOSIT_VOUT}`;
const statusUtxo = (st) => { const k = Object.keys(st)[0]; return k === 'Minted' ? st.Minted.utxo : st[k]; };

/**
 * What an update_balance answer means for record `r`. `res` = the candid reply ({ Ok } | { Err })
 * or { thrown: message } when the call failed. Returns { ck (the new ckbtc part), outcome,
 * message, event }. outcome: minted | too_small | tainted | checked | pending | not_seen | busy | error.
 * Only the record's own deposit (its txid, vout 0) decides its fate; other deposits the same call
 * minted are reported in `message`.
 */
export function applyUpdateBalance(r, res, { now }) {
    const ck = r.ckbtc;
    const key = depositKey(r);
    const checks = (ck.checks || 0) + 1;
    const base = { ...ck, checks, lastCheckAt: now };
    const next = (outcome) => now + backoffMs(outcome, checks);
    const done = (status, outcome, message, extra = {}) => ({ ck: { ...base, ...extra, status, nextCheckAt: null, message }, outcome, message, event: `update_balance: ${outcome}` });
    const later = (outcome, message, extra = {}) => ({ ck: { ...base, ...extra, nextCheckAt: next(outcome), message }, outcome, message, event: `update_balance: ${outcome}` });

    if (res && 'thrown' in res) return later('busy', `Couldn't reach the minter (${String(res.thrown).split('\n')[0].slice(0, 160)}). Trying again shortly.`);
    if (res && 'Ok' in res) {
        const mine = res.Ok.find((st) => utxoKey(statusUtxo(st)) === key);
        const others = res.Ok.filter((st) => st !== mine && 'Minted' in st);
        const otherText = others.length ? ` The same check also minted ${others.length} other deposit${others.length === 1 ? '' : 's'} to your account.` : '';
        if (mine && 'Minted' in mine) {
            const amt = BigInt(mine.Minted.minted_amount);
            return done('minted', 'minted', `Minted ${formatUnits(amt, 8)} ${ck.symbol} (ledger block ${String(mine.Minted.block_index)}).${otherText}`, { mintedAmount: s(amt), mintBlock: s(mine.Minted.block_index) });
        }
        if (mine && 'ValueTooSmall' in mine) return done('too_small', 'too_small', `The minter did not mint this deposit: ${String(mine.ValueTooSmall.value)} sats is too small to pay its check fee.${otherText}`);
        if (mine && 'Tainted' in mine) return done('tainted', 'tainted', `The minter's Bitcoin checker flagged this deposit (${String(mine.Tainted.value)} sats) and quarantined it; no ${ck.symbol} was minted. Contact DFINITY's ckBTC support with the transaction id.${otherText}`);
        if (mine && 'Checked' in mine) return later('checked', `The deposit passed the minter's check, but minting didn't finish (the ledger was busy). Trying again shortly.${otherText}`, { status: 'checked' });
        return later('not_seen', `The minter didn't report this deposit yet.${otherText}`);
    }
    const err = res?.Err;
    const k = err ? Object.keys(err)[0] : null;
    if (k === 'NoNewUtxos') {
        const v = err.NoNewUtxos;
        const pend = (v.pending_utxos?.[0] || []).find((p) => `${txidHex(p.outpoint.txid)}:${Number(p.outpoint.vout)}` === key);
        if (pend) {
            const c = Number(pend.confirmations);
            return later('pending', `The minter sees the deposit with ${c} of ${Number(v.required_confirmations)} confirmations.`, { confirmations: c });
        }
        const susp = (v.suspended_utxos?.[0] || []).find((x) => utxoKey(x.utxo) === key);
        if (susp) {
            if ('Quarantined' in susp.reason) return done('tainted', 'tainted', `The minter's Bitcoin checker flagged this deposit and quarantined it; no ${ck.symbol} was minted. Contact DFINITY's ckBTC support with the transaction id.`);
            return done('too_small', 'too_small', `The minter did not mint this deposit: ${String(susp.utxo.value)} sats is too small to pay its check fee.`);
        }
        return later('not_seen', updateBalanceErrorText(err));
    }
    if (k === 'AlreadyProcessing' || k === 'TemporarilyUnavailable') return later('busy', updateBalanceErrorText(err));
    return later('error', updateBalanceErrorText(err));
}

/// After a `not_seen`: the minter's known UTXOs (get_known_utxos, the ones it already processed)
/// list our deposit → it was minted earlier (another tab, device, or the /convert page). The
/// amount is the deposit minus the check fee; the block is not known here.
export function applyKnownUtxos(r, known, { now }) {
    const key = depositKey(r);
    const u = (known || []).find((x) => utxoKey(x) === key);
    if (!u) return null;
    const ck = r.ckbtc;
    const amt = BigInt(u.value) - BigInt(ck.checkFee || 0);
    const message = `Minted earlier: the minter already processed this deposit (≈ ${formatUnits(amt > 0n ? amt : 0n, 8)} ${ck.symbol}).`;
    return { ck: { ...ck, status: 'minted', mintedAmount: s(amt > 0n ? amt : 0n), mintBlock: null, nextCheckAt: null, lastCheckAt: now, message }, outcome: 'minted', message, event: 'get_known_utxos: minted earlier' };
}

/// Replace record `id`'s ckbtc part with `ck` (pure; appends an event).
export function setCk(records, id, ck, { now, event = null, detail = null } = {}) {
    return records.map((r) => {
        if (r.id !== id) return r;
        const log = event ? [...(r.log || []), { at: now, event, ...(detail ? { detail } : {}) }].slice(-MAX_LOG) : r.log;
        return { ...r, ckbtc: ck, updatedAt: now, log };
    });
}

/// Confirmations of the deposit output, read from the IC Bitcoin canister (free query): the
/// number, or null when the output is not at the deposit address (not mined yet, or the minter
/// already spent it after minting).
export async function depositConfirmations(bitcoin, { network, record }) {
    const u = await fetchUtxos(bitcoin, { network, address: record.ckbtc.depositAddress });
    const key = depositKey(record);
    const hit = u.utxos.find((x) => `${x.txid}:${x.vout}` === key);
    return hit ? hit.confirmations : null;
}

/**
 * One check of a move to ckBTC, as the user: update_balance { owner = me }, then (when the minter
 * didn't report our deposit) get_known_utxos. Writes the result to the store, re-reading the
 * record first so two tabs don't undo each other. Returns { outcome, message } or { skipped }.
 *   makeActor(idl, canisterId)  bound to the user's agent
 */
export async function finishDeposit({ makeActor, store, id, now = Date.now, manual = false }) {
    const cur = store.load();
    if (!cur.ok) return { skipped: true, message: cur.error };
    const r = cur.records.find((x) => x.id === id);
    if (!r?.ckbtc) return { skipped: true, message: 'No such move.' };
    const t = now();
    const due = checkDue(r, { now: t, manual });
    if (!due.due) return { skipped: true, message: due.reason };
    const m = ckbtcMinter(makeActor, r.ckbtc.minter);
    const arg = { owner: [P(r.ckbtc.owner)], subaccount: sub(r.ckbtc.subaccount) };
    let res;
    try { res = await m.update_balance(arg); } catch (e) { res = { thrown: String(e?.message || e) }; }
    let a = applyUpdateBalance(r, res, { now: now() });
    if (a.outcome === 'not_seen') {
        try {
            const known = await m.get_known_utxos(arg);
            const k = applyKnownUtxos({ ...r, ckbtc: a.ck }, known, { now: now() });
            if (k) a = k;
        } catch { /* keep the not_seen answer */ }
    }
    store.mutate((rs) => {
        const fresh = rs.find((x) => x.id === id);
        if (!fresh?.ckbtc || CK_FINAL.includes(fresh.ckbtc.status)) return rs; // another tab finished it
        // the minter's count when it gave one, else the newest one the store has (the page's
        // Bitcoin canister read may have updated it while the call ran)
        const ck = { ...a.ck, confirmations: a.outcome === 'pending' ? a.ck.confirmations : fresh.ckbtc.confirmations };
        return setCk(rs, id, ck, { now: now(), event: a.event, detail: a.message?.slice(0, 300) });
    });
    return { outcome: a.outcome, message: a.message };
}

/// Store the deposit's confirmation count (from depositConfirmations) on the record.
export function noteConfirmations(store, id, confirmations, { now = Date.now() } = {}) {
    return store.mutate((rs) => rs.map((r) => {
        if (r.id !== id || !r.ckbtc || CK_FINAL.includes(r.ckbtc.status)) return r;
        if (r.ckbtc.confirmations === confirmations) return r;
        return { ...r, ckbtc: { ...r.ckbtc, confirmations }, updatedAt: now };
    }));
}

/// The toCkbtc records the page should watch now (sent, not final).
export const activeDeposits = (records) => (records || []).filter((r) => r.kind === 'toCkbtc' && r.ckbtc && !MOVE_FINAL.includes(movePhase(r)));

// ---------------------------------------------------------------- ckBTC -> native

export const MOVES_VERSION = 1;
export const movesKey = (network, principal) => `sneed_btc_moves_v${MOVES_VERSION}:${network}:${String(principal)}`;

/**
 * A ck → native move of `amount` (sats of ckBTC to burn). Wraps ckMinters.js planBtcWithdrawal
 * (minimum = retrieve_btc_min_amount, the approve's ledger fee, the minter + Bitcoin fee estimate)
 * and sets the allowance to amount + one ledger fee.
 * { ok, errors, max, approveAmount, spend, receive, networkFee }.
 */
export function planMoveToBtc({ amount, balance, ledgerFee, minAmount, fee }) {
    const p = planBtcWithdrawal({ amount, balance, ledgerFee, minAmount, fee });
    const amt = amount == null ? null : BigInt(amount);
    return { ...p, approveAmount: amt == null ? null : amt + BigInt(ledgerFee ?? 0) };
}

export const WITHDRAW_FINAL = Object.freeze(['failed', 'confirmed', 'reimbursed', 'too_low', 'dismissed']);

export function newWithdrawRecord({ id, network, pair, plan, amount, ledgerFee, address, owner, now }) {
    return {
        v: MOVES_VERSION,
        id,
        kind: 'toBtc',
        network,
        state: 'approving', // approving | requesting | requested | unknown | failed | confirmed | reimbursing | reimbursed | too_low | dismissed
        createdAt: now,
        updatedAt: now,
        owner: String(owner),
        address,
        minter: pair.minter,
        ledger: pair.ledger,
        symbol: pair.symbol,
        amount: s(amount),
        approveAmount: s(plan.approveAmount),
        ledgerFee: s(ledgerFee),
        estimateFee: s(plan.networkFee),
        estimateReceive: s(plan.receive),
        approveBlock: null,
        blockIndex: null,
        status: null,
        txid: null,
        error: null,
        log: [{ at: now, event: 'created' }],
    };
}

/// Patch record `id` (pure), with an event.
export function patchRecord(records, id, patch, { now, event = null, detail = null } = {}) {
    return records.map((r) => {
        if (r.id !== id) return r;
        const log = event ? [...(r.log || []), { at: now, event, ...(detail ? { detail } : {}) }].slice(-MAX_LOG) : r.log;
        return { ...r, ...patch, updatedAt: now, log };
    });
}

/// A store over (storage, key), as send.js makeStore (load-modify-save, read back).
export function makeMovesStore(storage, key) {
    return {
        load: () => loadRecords(storage, key),
        mutate(fn) {
            const cur = loadRecords(storage, key);
            if (!cur.ok) return false;
            return saveRecords(storage, key, fn(cur.records));
        },
    };
}

/**
 * Run a ck → native move: write the record, approve + retrieve_btc_with_approval (ckMinters.js
 * ckbtcWithdraw), record the outcome. Returns { state, record?, blockIndex?, error? }:
 *   not_sent   the record couldn't be saved: nothing was called
 *   failed     the approve failed, or the minter answered with an error: nothing was burned
 *   unknown    the retrieve call itself failed: the minter may or may not have taken it
 *   requested  the minter burned the ckBTC and queued the Bitcoin payment (blockIndex)
 */
export async function executeWithdraw({ makeActor, store, record, nowNs, now = Date.now, onStep = () => {} }) {
    if (!store.mutate((rs) => [...rs, record])) {
        return { state: 'not_sent', error: "Couldn't save the move on this device, so nothing was done. Allow site storage and try again." };
    }
    let stage = 'approve';
    try {
        const r = await ckbtcWithdraw(makeActor, {
            address: record.address, amount: BigInt(record.amount), approveAmount: BigInt(record.approveAmount), ledgerFee: big(record.ledgerFee),
            ledgerId: record.ledger, minterId: record.minter, nowNs,
            onStep: (st, info) => {
                onStep(st);
                if (st === 'withdraw') {
                    stage = 'withdraw';
                    store.mutate((rs) => patchRecord(rs, record.id, { state: 'requesting', approveBlock: s(info?.approveBlock) }, { now: now(), event: 'approved', detail: `allowance ${record.approveAmount}` }));
                }
            },
        });
        store.mutate((rs) => patchRecord(rs, record.id, { state: 'requested', blockIndex: s(r.blockIndex), approveBlock: s(r.approveBlock), error: null }, { now: now(), event: 'requested', detail: `burn block ${r.blockIndex}` }));
        return { state: 'requested', blockIndex: r.blockIndex };
    } catch (e) {
        const text = String(e?.message || e);
        // nothing burned: the approve failed, or the minter answered with a typed error
        const sure = stage === 'approve' || e?.minterErr;
        const state = sure ? 'failed' : 'unknown';
        const error = sure
            ? `${text}${stage === 'withdraw' ? ' Nothing was burned; the approval lapses within the hour.' : ' Nothing was moved.'}`
            : `No answer from the minter (${text.split('\n')[0].slice(0, 160)}). It may or may not have taken the request; check its list below before trying again.`;
        store.mutate((rs) => patchRecord(rs, record.id, { state, error }, { now: now(), event: state, detail: text.slice(0, 300) }));
        return { state, error };
    }
}

/// What a retrieve_btc_status_v2 answer means for a record: { state, status, txid, detail }.
export function withdrawState(status, prev = 'requested') {
    const k = status ? Object.keys(status)[0] : 'Unknown';
    const v = status?.[k];
    const tx = v?.txid ? txidHex(v.txid) : null;
    switch (k) {
        case 'Pending': case 'Signing': return { state: 'requested', status: k, txid: null };
        case 'Sending': case 'Submitted': return { state: 'requested', status: k, txid: tx };
        case 'Confirmed': return { state: 'confirmed', status: k, txid: tx };
        case 'AmountTooLow': return { state: 'too_low', status: k, txid: null };
        case 'WillReimburse': return { state: 'reimbursing', status: k, txid: null, amount: s(v.amount) };
        case 'Reimbursed': return { state: 'reimbursed', status: k, txid: null, amount: s(v.amount), mintBlock: s(v.mint_block_index) };
        default: return { state: prev, status: 'Unknown', txid: null }; // pruned or not yet visible: keep what we had
    }
}

/// Refresh one ck → native move from the minter (a free query). Returns the new state or null.
export async function refreshWithdraw({ makeActor, store, record, now = Date.now }) {
    if (record.blockIndex == null || WITHDRAW_FINAL.includes(record.state)) return null;
    const st = await ckbtcMinter(makeActor, record.minter).retrieve_btc_status_v2({ block_index: BigInt(record.blockIndex) });
    const w = withdrawState(st, record.state);
    if (w.state === record.state && w.status === record.status && (w.txid || null) === (record.txid || null)) return w;
    store.mutate((rs) => patchRecord(rs, record.id, { state: w.state, status: w.status, txid: w.txid || record.txid, ...(w.amount ? { reimbursed: w.amount } : {}), ...(w.mintBlock ? { reimburseBlock: w.mintBlock } : {}) },
        { now: now(), event: `status ${w.status}`, detail: w.txid || null }));
    return w;
}

export const activeWithdrawals = (records) => (records || []).filter((r) => r.kind === 'toBtc' && r.blockIndex != null && !WITHDRAW_FINAL.includes(r.state));

/// Text for a ck → native error (re-exported for the UI).
export { btcWithdrawErrorText };
