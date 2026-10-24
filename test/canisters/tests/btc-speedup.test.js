// Native Bitcoin phase A4 (spec/sneed_wallet.md §5.2 step 4, §6.3, §8): speed-up (RBF and CPFP),
// sweep, the balance cross-check before large sends, and opt-in explorer history. Pure frontend
// logic with mocked canisters, no PocketIC. Covered:
//   - RBF fee rules (BIP-125 rules 3 and 4 under full-RBF), the extra fee taken from the change,
//     the change dropped when it would fall below 1,000 sats, the no-change case (refused unless
//     the user agrees to a smaller amount), and agreement with a model of the signer's builder;
//   - CPFP package math (parent + child reach the target rate), adding a coin, refusals;
//   - the supersede state machine: both versions pending, whichever is proven mined wins and the
//     other resolves to "replaced", whichever one that is; a failed replacement unlinks; a CPFP
//     child is not taken for confirmed while its parent is pending (its input is never in the
//     canister's UTXO set) and follows its parent when that is replaced;
//   - the expected txid of a replacement and of a child, against a mock signer that builds the
//     transaction from the request;
//   - sweep (every coin, uneconomic ones included by default) and sweep to another principal
//     (offline address of a fixed principal, typed confirmation);
//   - cross-check thresholds and refusal on a mismatch, the btc_caller_balance request and IDL;
//   - explorer history parsing and its privacy (opt-in, no credentials).
import { describe, it, expect } from 'vitest';
import { IDL } from '@dfinity/candid';
import { Principal } from '@dfinity/principal';
import { btc as icPubKeyBtc } from '@dfinity/ic-pub-key/signer';
import { planSend, txVsize, feeFor } from '../../../src/app_sneeddao_frontend/src/utils/btc/select.js';
import { computeTxid, expectedTxid, scriptPubKey } from '../../../src/app_sneeddao_frontend/src/utils/btc/txid.js';
import { newRecord, updateRecord, reconcile, reconcileAll, lockedOutpoints, markMined, minedTxids, canReissue, recordTxid } from '../../../src/app_sneeddao_frontend/src/utils/btc/pending.js';
import { executeSend, executeReplacement, executeCpfp, makeStore, PAY_WITH_CYCLES } from '../../../src/app_sneeddao_frontend/src/utils/btc/send.js';
import {
    planRbf, planCpfp, speedUpStatus, defaultSpeedUp, blocksWaited, parentChangeUtxo, identifyWinner, rbfCycles, cpfpCycles, INCREMENTAL_RELAY_RATE, SPEEDUP_AFTER_BLOCKS,
} from '../../../src/app_sneeddao_frontend/src/utils/btc/speedup.js';
import { planSweep, sweepTarget, confirmTailOk, confirmTailOf, isUneconomic, CONFIRM_TAIL } from '../../../src/app_sneeddao_frontend/src/utils/btc/sweep.js';
import { needsCrossCheck, crossCheckBalance, crossCheckFresh, utxoTotal, utxoFingerprint, CROSSCHECK_SATS, BALANCE_CYCLES } from '../../../src/app_sneeddao_frontend/src/utils/btc/verify.js';
import { parseExplorerTx, fetchExplorerHistory, explorerHistoryAllowed, setExplorerHistoryAllowed, EXPLORER_OK_KEY } from '../../../src/app_sneeddao_frontend/src/utils/btc/history.js';
import { deriveBtcAddress } from '../../../src/app_sneeddao_frontend/src/utils/btc/address.js';
import { signerIdl } from '../../../src/app_sneeddao_frontend/src/utils/btc/signerIdl.js';
import { sendCycles } from '../../../src/app_sneeddao_frontend/src/utils/btc/credit.js';
import { outpointKey, txidHex } from '../../../src/app_sneeddao_frontend/src/utils/btc/utxos.js';

const ME = Principal.selfAuthenticating(new TextEncoder().encode('sneed wallet speedup test')).toText();
const OWN = deriveBtcAddress(ME, 'testnet').address;
const OTHER = deriveBtcAddress(Principal.selfAuthenticating(new Uint8Array(32).fill(9)).toText(), 'testnet').address;
const NET = 'testnet';
const hex64 = (n) => n.toString(16).padStart(64, '0');
const utxo = (n, value, confirmations = 3, height = 100) => ({ txid: hex64(n), vout: n % 3, value: BigInt(value), height, confirmations });
const T0 = 1_760_000_000_000;

function memStorage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

/// The Chain Fusion Signer's builder (tx_utils.rs): our outputs, then change ≥ 1,000 sats to the
/// sender; the txid of the result (non-witness serialisation, v2, locktime 0, nSequence max).
function signerTxid(req, own = OWN) {
    const inputs = req.utxos_to_spend.map((u) => ({ txid: txidHex(u.outpoint.txid), vout: u.outpoint.vout, value: u.value }));
    const total = inputs.reduce((t, i) => t + i.value, 0n);
    const outs = req.outputs.map((o) => ({ script: scriptPubKey(o.destination_address, NET), value: o.sent_satoshis }));
    const remaining = total - outs.reduce((t, o) => t + o.value, 0n) - req.fee_satoshis[0];
    if (remaining < 0n) throw new Error('NotEnoughFunds');
    if (remaining >= 1000n) outs.push({ script: scriptPubKey(own, NET), value: remaining });
    return { txid: computeTxid({ inputs, outputs: outs }), change: remaining >= 1000n ? remaining : 0n, effectiveFee: remaining >= 1000n ? req.fee_satoshis[0] : req.fee_satoshis[0] + remaining };
}
const mockSigner = (log = []) => ({
    btc_caller_send: async (req, pay) => { log.push({ req, pay }); return { Ok: { txid: signerTxid(req).txid } }; },
});

/// A broadcast record of a send planned with planSend (as executeSend writes it).
function sentRecord({ id = 'a', utxos = [utxo(1, 100_000)], amount = 50_000n, rate = 2, max = false, tipAtSend = 1000, to = OTHER } = {}) {
    const plan = planSend({ utxos, amount: max ? null : amount, max, feeRate: rate, destType: 'p2wpkh' });
    if (!plan.ok) throw new Error(plan.message);
    const outputs = [{ address: to, value: plan.amount }];
    const expected = expectedTxid({ inputs: plan.inputs, outputs, change: plan.change, ownAddress: OWN, network: NET });
    const r = newRecord({ id, network: NET, kind: max ? 'sweep' : 'send', plan, outputs, ownAddress: OWN, expected, signingCycles: sendCycles(plan.nInputs, 1), now: T0 });
    return { ...r, state: 'broadcast', txid: expected.txid, broadcastAt: T0, tipAtSend, attempts: 1 };
}
function storeWith(records) {
    const storage = memStorage();
    const store = makeStore(storage, 'k');
    store.mutate(() => records);
    return { storage, store, all: () => store.load().records };
}

// ------------------------------------------------------------------ RBF

describe('RBF replacement fee rules (BIP-125 rules 3 and 4, full-RBF)', () => {
    const orig = sentRecord(); // 1 coin of 100,000 → 50,000 + change, 2 sat/vB, 141 vB, fee 282

    it('pays max(target rate × vsize, old fee + vsize × 1 sat/vB) and keeps the recipient amount', () => {
        expect(orig.vsize).toBe(141);
        expect(orig.fee).toBe('282');
        // 5 sat/vB: the rate binds (705 ≥ 282 + 141)
        const p5 = planRbf({ record: orig, feeRate: 5, network: NET });
        expect(p5.ok).toBe(true);
        expect(p5.fee).toBe(705n);
        expect(p5.rules).toEqual({ rule3: 282n, rule4: 282n + 141n, rate: 705n });
        expect(p5.amount).toBe(50_000n);
        expect(p5.outputs).toEqual([{ address: OTHER, value: 50_000n }]);
        expect(p5.change).toBe(100_000n - 50_000n - 705n);
        expect(p5.extraFee).toBe(705n - 282n);
        expect(p5.inputs.map(outpointKey)).toEqual(orig.request.inputs.map(outpointKey));
        // 2.5 sat/vB: rule 4 binds (old fee + 141 vB × 1 sat/vB = 423 > 353)
        const p25 = planRbf({ record: orig, feeRate: 2.5, network: NET });
        expect(p25.fee).toBe(423n);
        expect(p25.fee - BigInt(orig.fee)).toBeGreaterThanOrEqual(feeFor(p25.vsize, INCREMENTAL_RELAY_RATE));
        // the replacement's feerate is above the original's
        expect(Number(p25.fee) / p25.vsize).toBeGreaterThan(Number(orig.fee) / orig.vsize);
    });

    it('refuses a rate that is not higher than the original', () => {
        expect(planRbf({ record: orig, feeRate: 2, network: NET }).code).toBe('rate_not_higher');
        expect(planRbf({ record: orig, feeRate: 1.5, network: NET }).code).toBe('rate_not_higher');
        expect(planRbf({ record: orig, feeRate: 0, network: NET }).code).toBe('bad_rate');
    });

    it('drops the change when it would fall below 1,000 sats: the whole remainder becomes fee', () => {
        // 1 coin of 52,500 → 50,000 at 2 sat/vB: change 2,500 − 282 = 2,218
        const r = sentRecord({ utxos: [utxo(2, 52_500)] });
        expect(r.change).toBe('2218');
        const p = planRbf({ record: r, feeRate: 12, network: NET }); // with change: 1,692 → change 808 < 1,000
        expect(p.ok).toBe(true);
        expect(p.change).toBe(0n);
        expect(p.vsize).toBe(txVsize(1, ['p2wpkh']));
        expect(p.fee).toBe(2_500n);
        expect(p.amount).toBe(50_000n);
        expect(p.dustToFee).toBe(2_500n - p.minFee);
    });

    it('with no change it refuses, and only sends less to the recipient with explicit consent', () => {
        const r = sentRecord({ utxos: [utxo(3, 80_000)], max: true }); // sweep: no change
        expect(r.change).toBe('0');
        const no = planRbf({ record: r, feeRate: 6, network: NET });
        expect(no.ok).toBe(false);
        expect(no.code).toBe('no_room');
        expect(no.canReduce).toBe(true);
        expect(no.shortBy).toBe(no.minFee - BigInt(r.fee));
        const yes = planRbf({ record: r, feeRate: 6, network: NET, reduceAmount: true });
        expect(yes.ok).toBe(true);
        expect(yes.reduced).toBe(true);
        expect(yes.amount).toBe(BigInt(r.amount) - no.shortBy);
        expect(yes.amount + yes.fee).toBe(80_000n);
        expect(yes.fee).toBe(no.minFee);
        expect(yes.fee - BigInt(r.fee)).toBeGreaterThanOrEqual(feeFor(yes.vsize, INCREMENTAL_RELAY_RATE));
    });

    it('agrees with the signer: no surprise change and no surprise fee, at many rates', () => {
        for (const coins of [[utxo(4, 100_000)], [utxo(5, 51_700)], [utxo(6, 30_000), utxo(7, 25_000)]]) {
            const r = sentRecord({ utxos: coins, amount: 50_000n });
            for (const rate of [2.1, 3, 4.5, 7, 9.999, 13]) {
                const p = planRbf({ record: r, feeRate: rate, network: NET, reduceAmount: true });
                if (!p.ok) continue;
                const req = { utxos_to_spend: p.inputs.map((i) => ({ value: i.value, outpoint: { txid: Uint8Array.from(Buffer.from(i.txid, 'hex')).reverse(), vout: i.vout } })), outputs: p.outputs.map((o) => ({ destination_address: o.address, sent_satoshis: o.value })), fee_satoshis: [p.fee] };
                const built = signerTxid(req);
                expect(built.change).toBe(p.change);
                expect(built.effectiveFee).toBe(p.fee);
            }
        }
    });

    it('signing cost: every input is signed again', () => {
        const r = sentRecord({ utxos: [utxo(6, 30_000), utxo(7, 25_000)] });
        const p = planRbf({ record: r, feeRate: 5, network: NET });
        expect(rbfCycles(p)).toBe(sendCycles(2, 1));
    });
});

// ------------------------------------------------------------------ CPFP

describe('CPFP package math', () => {
    it('child fee = target × (parent + child vsize) − parent fee, so the package reaches the target', () => {
        const parent = sentRecord(); // fee 282, 141 vB, change 49,718
        const p = planCpfp({ parent, feeRate: 10, ownAddress: OWN });
        expect(p.ok).toBe(true);
        expect(p.vsize).toBe(txVsize(1, ['p2wpkh'])); // 110
        expect(p.fee).toBe(feeFor(141 + 110, 10) - 282n); // 2510 − 282
        expect(p.output).toEqual({ address: OWN, value: BigInt(parent.change) - p.fee });
        expect(p.packageRate).toBeGreaterThanOrEqual(10);
        expect(p.inputs[0]).toMatchObject({ txid: parent.txid, vout: parent.changeVout, value: BigInt(parent.change), unconfirmed: true });
        expect(cpfpCycles(p)).toBe(sendCycles(1, 1));
    });

    it('pays at least 1 sat/vB on its own, and refuses when the parent already pays the rate', () => {
        const parent = sentRecord({ rate: 8 });
        expect(planCpfp({ parent, feeRate: 8, ownAddress: OWN }).code).toBe('rate_not_higher');
        const p = planCpfp({ parent, feeRate: 8.1, ownAddress: OWN });
        expect(p.ok).toBe(true);
        expect(p.fee).toBeGreaterThanOrEqual(feeFor(p.vsize, 1));
    });

    it('needs a change output; adds a confirmed coin when the change is too small', () => {
        const sweep = sentRecord({ utxos: [utxo(8, 80_000)], max: true });
        expect(parentChangeUtxo(sweep)).toBe(null);
        expect(planCpfp({ parent: sweep, feeRate: 10, ownAddress: OWN }).code).toBe('no_change');
        const small = sentRecord({ utxos: [utxo(9, 52_500)] }); // change 2,218
        expect(planCpfp({ parent: small, feeRate: 20, ownAddress: OWN }).code).toBe('change_too_small');
        const other = utxo(10, 20_000);
        const locked = new Set([outpointKey(utxo(9, 52_500))]);
        const p = planCpfp({ parent: small, feeRate: 20, ownAddress: OWN, utxos: [utxo(9, 52_500), other], locked });
        expect(p.ok).toBe(true);
        expect(p.extraCoins).toBe(1);
        expect(p.inputs.map(outpointKey)).toEqual([`${small.txid}:${small.changeVout}`, outpointKey(other)]);
        expect(p.packageRate).toBeGreaterThanOrEqual(20);
    });

    it('the default is RBF when the change pays, else CPFP, else RBF with a smaller amount', () => {
        const r = sentRecord();
        expect(defaultSpeedUp({ rbf: planRbf({ record: r, feeRate: 5, network: NET }), cpfp: planCpfp({ parent: r, feeRate: 5, ownAddress: OWN }) })).toBe('rbf');
        const sw = sentRecord({ utxos: [utxo(11, 80_000)], max: true });
        expect(defaultSpeedUp({ rbf: planRbf({ record: sw, feeRate: 6, network: NET }), cpfp: planCpfp({ parent: sw, feeRate: 6, ownAddress: OWN }) })).toBe('rbf_reduce');
        expect(defaultSpeedUp({ rbf: { ok: false, code: 'no_room', canReduce: false }, cpfp: { ok: true } })).toBe('cpfp');
        expect(defaultSpeedUp({ rbf: { ok: false }, cpfp: { ok: false } })).toBe(null);
    });
});

// ------------------------------------------------------------------ when to offer

describe('speed-up offer', () => {
    it(`is offered after ${SPEEDUP_AFTER_BLOCKS} blocks unmined, or at once below the current "Slow" rate`, () => {
        const r = sentRecord({ tipAtSend: 1000 });
        expect(blocksWaited(r, { tipHeight: 1001, now: T0 })).toBe(1);
        expect(speedUpStatus(r, { records: [r], tipHeight: 1001, now: T0 })).toMatchObject({ can: true, offer: false });
        expect(speedUpStatus(r, { records: [r], tipHeight: 1002, now: T0 })).toMatchObject({ can: true, offer: true });
        expect(speedUpStatus(r, { records: [r], tipHeight: 1000, now: T0, tiers: { slow: 3, normal: 5, fast: 8 } })).toMatchObject({ offer: true });
        // without a recorded tip, from the time (10 minutes a block)
        const old = { ...r, tipAtSend: undefined };
        expect(blocksWaited(old, { tipHeight: 2000, now: T0 + 25 * 60_000 })).toBe(2);
    });

    it('is not possible for unknown/confirmed sends, CPFP children, superseded sends, or sends with a pending child', () => {
        const r = sentRecord();
        expect(speedUpStatus({ ...r, state: 'unknown' }, { records: [], now: T0 }).can).toBe(false);
        expect(speedUpStatus({ ...r, state: 'confirmed' }, { records: [], now: T0 }).can).toBe(false);
        expect(speedUpStatus({ ...r, kind: 'cpfp', parent: 'x' }, { records: [], now: T0 }).can).toBe(false);
        const repl = { ...sentRecord({ id: 'b' }), state: 'broadcast' };
        expect(speedUpStatus({ ...r, supersededBy: 'b' }, { records: [repl], now: T0 }).can).toBe(false);
        expect(speedUpStatus({ ...r, supersededBy: 'b' }, { records: [{ ...repl, state: 'failed' }], now: T0 }).can).toBe(true);
        const child = { id: 'c', kind: 'cpfp', parent: r.id, state: 'broadcast' };
        expect(speedUpStatus(r, { records: [r, child], now: T0 }).can).toBe(false);
    });
});

// ------------------------------------------------------------------ the supersede state machine

describe('RBF supersede: both versions pending, whichever is mined wins', () => {
    async function replaced({ utxos = [utxo(1, 100_000)], rate = 6, max = false, reduceAmount = false } = {}) {
        const orig = sentRecord({ utxos, max });
        const { store, all } = storeWith([orig]);
        const plan = planRbf({ record: orig, feeRate: rate, network: NET, reduceAmount });
        expect(plan.ok).toBe(true);
        const log = [];
        const res = await executeReplacement({ signer: mockSigner(log), store, original: orig, plan, network: NET, ownAddress: OWN, id: 'r2', tipHeight: 1003, now: () => T0 + 1000 });
        return { orig, plan, res, store, all, log };
    }

    it('writes the replacement before the call, in the same group, with its expected txid = the signer\'s', async () => {
        const { orig, plan, res, all, log } = await replaced();
        expect(res.state).toBe('broadcast');
        expect(res.drift).toBe(false);
        const [o, r2] = all();
        expect(r2).toMatchObject({ id: 'r2', group: orig.id, replaces: orig.id, replacesTxid: orig.txid, speedUp: 'rbf', state: 'broadcast', tipAtSend: 1003, kind: 'send' });
        expect(o.supersededBy).toBe('r2');
        expect(o.state).toBe('broadcast');
        const exp = expectedTxid({ inputs: plan.inputs, outputs: plan.outputs, change: plan.change, ownAddress: OWN, network: NET });
        expect(r2.expectedTxid).toBe(exp.txid);
        expect(r2.txid).toBe(exp.txid);
        expect(r2.expectedTxid).not.toBe(orig.txid);
        // same inputs, same recipient amount, fee as planned, paid with cycles
        expect(log[0].pay).toEqual(PAY_WITH_CYCLES);
        expect(log[0].req.fee_satoshis).toEqual([plan.fee]);
        expect(log[0].req.outputs).toEqual([{ destination_address: OTHER, sent_satoshis: 50_000n }]);
        expect(log[0].req.utxos_to_spend.map((u) => txidHex(u.outpoint.txid))).toEqual(orig.request.inputs.map((i) => i.txid));
        // the coins stay locked (both versions spend them)
        expect(lockedOutpoints(all()).has(outpointKey(orig.request.inputs[0]))).toBe(true);
    });

    it('nothing mined yet: both stay pending', async () => {
        const { orig, all } = await replaced();
        const { records, changed } = reconcileAll(all(), { utxoKeys: new Set([outpointKey(orig.request.inputs[0])]), now: T0 + 2000 });
        expect(changed).toBe(false);
        expect(records.map((r) => r.state)).toEqual(['broadcast', 'broadcast']);
    });

    it('the replacement is mined (its change shows up): it is confirmed, the original replaced', async () => {
        const { all } = await replaced();
        const [, r2] = all();
        const { records } = reconcileAll(all(), { utxoKeys: new Set([`${r2.txid}:${r2.changeVout}`]), now: T0 + 2000 });
        expect(records.find((r) => r.id === 'r2').state).toBe('confirmed');
        const o = records.find((r) => r.id === 'a');
        expect(o.state).toBe('replaced');
        expect(o.replacedBy).toBe(r2.txid);
    });

    it('the original is mined after all: it is confirmed, the replacement replaced', async () => {
        const { orig, all } = await replaced();
        const { records } = reconcileAll(all(), { utxoKeys: new Set([`${orig.txid}:${orig.changeVout}`]), now: T0 + 2000 });
        expect(records.find((r) => r.id === 'a').state).toBe('confirmed');
        const r2 = records.find((r) => r.id === 'r2');
        expect(r2.state).toBe('replaced');
        expect(r2.replacedBy).toBe(orig.txid);
    });

    it('no change on either and no proof yet: both wait to be identified; a lookup settles it', async () => {
        const { all } = await replaced({ utxos: [utxo(3, 80_000)], max: true, reduceAmount: true });
        const recs = all();
        const empty = new Set();
        const d = reconcile(recs[0], { utxoKeys: empty, now: T0 + 2000, records: recs });
        expect(d.action).toBe('identify');
        expect(reconcileAll(recs, { utxoKeys: empty, now: T0 + 2000 }).changed).toBe(false);
        // the recipient's UTXOs (IC Bitcoin canister, free) show the replacement's output 0
        const r2 = recs[1];
        const bitcoin = { bitcoin_get_utxos_query: async ({ address }) => ({ utxos: address === OTHER ? [{ outpoint: { txid: Uint8Array.from(Buffer.from(r2.txid, 'hex')).reverse(), vout: 0 }, value: 1n, height: 5 }] : [], tip_height: 10, tip_block_hash: new Uint8Array(32), next_page: [] }) };
        const win = await identifyWinner(bitcoin, { network: NET, members: recs });
        expect(win).toBe(r2.txid);
        const settled = reconcileAll(markMined(recs, win, { now: T0 + 3000, via: 'recipient output' }), { utxoKeys: empty, now: T0 + 3000 }).records;
        expect(settled.map((r) => r.state)).toEqual(['replaced', 'confirmed']);
    });

    it('a later send of ours that spends a version\'s change proves that version was mined', async () => {
        const { orig, all } = await replaced();
        const later = { ...sentRecord({ id: 'z', utxos: [{ txid: orig.txid, vout: orig.changeVout, value: BigInt(orig.change), height: 200, confirmations: 2 }], amount: 20_000n }), state: 'confirmed' };
        const recs = [...all(), later];
        expect(minedTxids(recs, new Set()).has(orig.txid)).toBe(true);
        const { records } = reconcileAll(recs, { utxoKeys: new Set(), now: T0 + 2000 });
        expect(records.find((r) => r.id === 'a').state).toBe('confirmed');
        expect(records.find((r) => r.id === 'r2').state).toBe('replaced');
    });

    it('a replacement the signer refused unlinks: the original carries on alone', async () => {
        const orig = sentRecord();
        const { store, all } = storeWith([orig]);
        const plan = planRbf({ record: orig, feeRate: 6, network: NET });
        const signer = { btc_caller_send: async () => ({ Err: { InternalError: { msg: 'broadcast failed' } } }) };
        const res = await executeReplacement({ signer, store, original: orig, plan, network: NET, ownAddress: OWN, id: 'r2', now: () => T0 + 1 });
        expect(res.state).toBe('failed');
        const [o, r2] = all();
        expect(r2.state).toBe('failed');
        expect(o.supersededBy).toBe(null);
        // inputs spent, no change seen: the single remaining version is confirmed as before
        const { records } = reconcileAll(all(), { utxoKeys: new Set(), now: T0 + 2 });
        expect(records.find((r) => r.id === 'a').state).toBe('confirmed');
    });

    it('refuses to replace a send that is no longer waiting', async () => {
        const orig = { ...sentRecord(), state: 'confirmed' };
        const { store } = storeWith([orig]);
        let called = false;
        const res = await executeReplacement({ signer: { btc_caller_send: async () => { called = true; } }, store, original: { ...orig, state: 'broadcast' }, plan: planRbf({ record: { ...orig, state: 'broadcast' }, feeRate: 6, network: NET }), network: NET, ownAddress: OWN, id: 'r2' });
        expect(res.state).toBe('refused');
        expect(called).toBe(false);
    });

    it('a move to ckBTC keeps its conversion on the replacement', async () => {
        const orig = { ...sentRecord(), kind: 'toCkbtc', ckbtc: { minter: 'm', ledger: 'l', symbol: 'ckTESTBTC', depositAddress: OTHER, vout: 0, checkFee: '100', minConfirmations: 4, status: 'waiting', checks: 3, expectedMint: '49900' } };
        const { store, all } = storeWith([orig]);
        const plan = planRbf({ record: orig, feeRate: 6, network: NET });
        await executeReplacement({ signer: mockSigner(), store, original: orig, plan, network: NET, ownAddress: OWN, id: 'r2', now: () => T0 });
        const r2 = all()[1];
        expect(r2.kind).toBe('toCkbtc');
        expect(r2.ckbtc).toMatchObject({ depositAddress: OTHER, vout: 0, status: 'waiting', checks: 0, expectedMint: '49900' });
    });
});

describe('CPFP child records', () => {
    async function withChild() {
        const parent = sentRecord();
        const { store, all } = storeWith([parent]);
        const plan = planCpfp({ parent, feeRate: 10, ownAddress: OWN });
        const log = [];
        const res = await executeCpfp({ signer: mockSigner(log), store, parent, plan, network: NET, ownAddress: OWN, id: 'c1', tipHeight: 1004, now: () => T0 + 5 });
        return { parent, plan, res, all, log };
    }

    it('spends the parent\'s unconfirmed change back to us, with the expected txid', async () => {
        const { parent, plan, res, all, log } = await withChild();
        expect(res.state).toBe('broadcast');
        const [p, c] = all();
        expect(p.cpfpBy).toBe('c1');
        expect(c).toMatchObject({ kind: 'cpfp', parent: parent.id, parentTxid: parent.txid, changeVout: 0, state: 'broadcast' });
        expect(c.request.inputs[0]).toMatchObject({ txid: parent.txid, vout: parent.changeVout, unconfirmed: true });
        expect(log[0].req.outputs).toEqual([{ destination_address: OWN, sent_satoshis: plan.output.value }]);
        expect(log[0].req.fee_satoshis).toEqual([plan.fee]);
        expect(c.txid).toBe(expectedTxid({ inputs: plan.inputs, outputs: [plan.output], change: 0n, ownAddress: OWN, network: NET }).txid);
    });

    it('is NOT taken for confirmed while the parent is pending (its input is never in the UTXO set)', async () => {
        const { parent, all } = await withChild();
        const utxoKeys = new Set([outpointKey(parent.request.inputs[0])]);
        // the old rule ("every input gone → confirmed") would confirm the child here
        const d = reconcile(all()[1], { utxoKeys, now: T0 + 10, records: all() });
        expect(d.state).toBe('broadcast');
        expect(reconcileAll(all(), { utxoKeys, now: T0 + 10 }).changed).toBe(false);
    });

    it('both mined in one block: parent and child confirmed', async () => {
        const { all } = await withChild();
        const c = all()[1];
        const { records } = reconcileAll(all(), { utxoKeys: new Set([`${c.txid}:0`]), now: T0 + 10 });
        expect(records.map((r) => r.state)).toEqual(['confirmed', 'confirmed']);
    });

    it('parent mined first: the child waits on the now-confirmed change, then confirms', async () => {
        const { parent, all } = await withChild();
        const step1 = reconcileAll(all(), { utxoKeys: new Set([`${parent.txid}:${parent.changeVout}`]), now: T0 + 10 }).records;
        expect(step1.map((r) => r.state)).toEqual(['confirmed', 'broadcast']);
        const c = step1[1];
        const step2 = reconcileAll(step1, { utxoKeys: new Set([`${c.txid}:0`]), now: T0 + 20 }).records;
        expect(step2[1].state).toBe('confirmed');
    });

    it('follows its parent when the parent was replaced', async () => {
        const { all } = await withChild();
        const recs = updateRecord(all(), 'a', { state: 'replaced', replacedBy: 'f'.repeat(64) }, { now: T0 });
        const { records } = reconcileAll(recs, { utxoKeys: new Set(), now: T0 + 10 });
        expect(records[1].state).toBe('replaced');
    });

    it('an unknown child can be re-issued although its parent output is not in the UTXO set', async () => {
        const { all } = await withChild();
        const c = { ...all()[1], state: 'unknown' };
        expect(canReissue(c, new Set())).toBe(true);
    });
});

// ------------------------------------------------------------------ sweep

describe('sweep', () => {
    it('includes every confirmed, unreserved coin by default, uneconomic ones too; no change', () => {
        const coins = [utxo(1, 100_000), utxo(2, 600), utxo(4, 500), utxo(5, 40_000), { ...utxo(7, 9_000), confirmations: 0 }];
        const locked = new Set([outpointKey(utxo(5, 40_000))]);
        const p = planSweep({ utxos: coins, locked, feeRate: 10, destType: 'p2wpkh' });
        expect(p.ok).toBe(true);
        expect(p.nInputs).toBe(3);
        expect(p.change).toBe(0n);
        expect(p.vsize).toBe(txVsize(3, ['p2wpkh']));
        expect(p.fee).toBe(feeFor(p.vsize, 10));
        expect(p.amount).toBe(101_100n - p.fee);
        expect(p.uneconomic).toEqual({ count: 2, sats: 1_100n, included: true });
        expect(p.leftBehind).toMatchObject({ reserved: 40_000n, unconfirmed: 9_000n, uneconomic: 0n });
        expect(isUneconomic(utxo(2, 600), 10)).toBe(true); // 68 vB × 10 = 680 ≥ 600
        // Advanced: leave the uneconomic coins behind
        const q = planSweep({ utxos: coins, locked, feeRate: 10, destType: 'p2wpkh', dropUneconomic: true });
        expect(q.nInputs).toBe(1);
        expect(q.leftBehind.uneconomic).toBe(1_100n);
        expect(planSweep({ utxos: [utxo(1, 1_500)], feeRate: 10, destType: 'p2wpkh' }).code).toBe('max_too_small');
    });

    it("derives another principal's address offline (fixed principal = ic-pub-key's signer vector)", () => {
        const p = 'nggqm-p5ozz-i5hfv-bejmq-2gtow-4dtqw-vjatn-4b4yw-s5mzs-i46su-6ae';
        expect(sweepTarget(p, 'mainnet')).toEqual({ ok: true, principal: p, address: 'bc1qwug6tj9z7tgvsp4u8sfzvjzatzs9rmwwck6qky' });
        expect(sweepTarget(` ${p} `, 'testnet').address).toBe('tb1qwug6tj9z7tgvsp4u8sfzvjzatzs9rmwwjspndh');
        // and for Mr Sneed's test principal, the same as DFINITY's library
        const mr = 'tksci-hao7i-2jb3u-kjrhm-t6ada-pubbx-rj2rj-dvz3x-eczyu-ogj25-aae';
        expect(sweepTarget(mr, 'mainnet').address).toBe(icPubKeyBtc.chainFusionSignerBtcAddressFor(Principal.fromText(mr), 'mainnet').response.btc_address);
        expect(sweepTarget('', 'mainnet').ok).toBe(false);
        expect(sweepTarget('not-a-principal', 'mainnet').ok).toBe(false);
        expect(sweepTarget('2vxsx-fae', 'mainnet').ok).toBe(false);
        expect(sweepTarget('aaaaa-aa', 'mainnet').ok).toBe(false);
        expect(sweepTarget(p, 'mainnet', { me: p }).ok).toBe(false);
    });

    it('needs the destination\'s last characters typed to confirm', () => {
        const a = 'bc1qwug6tj9z7tgvsp4u8sfzvjzatzs9rmwwck6qky';
        expect(confirmTailOf(a)).toBe('wwck6qky');
        expect(CONFIRM_TAIL).toBe(8);
        expect(confirmTailOk('wwck6qky', a)).toBe(true);
        expect(confirmTailOk(' WWCK6QKY ', a)).toBe(true);
        expect(confirmTailOk('wck6qky', a)).toBe(false);
        expect(confirmTailOk('', a)).toBe(false);
        expect(confirmTailOk('anything', '')).toBe(false);
    });

    it('a sweep to another principal sends everything to that principal\'s derived address', async () => {
        const target = sweepTarget('nggqm-p5ozz-i5hfv-bejmq-2gtow-4dtqw-vjatn-4b4yw-s5mzs-i46su-6ae', NET);
        const plan = planSweep({ utxos: [utxo(1, 100_000), utxo(2, 30_000)], feeRate: 3, destType: 'p2wpkh' });
        const storage = memStorage();
        const store = makeStore(storage, 'k');
        const log = [];
        const res = await executeSend({ signer: mockSigner(log), store, plan, toAddress: target.address, network: NET, ownAddress: OWN, id: 's1', kind: 'sweep', extra: { sweep: { principal: target.principal } }, now: () => T0 });
        expect(res.state).toBe('broadcast');
        expect(log[0].req.outputs).toEqual([{ destination_address: target.address, sent_satoshis: plan.amount }]);
        expect(log[0].req.utxos_to_spend).toHaveLength(2);
        expect(signerTxid(log[0].req).change).toBe(0n);
        expect(store.load().records[0]).toMatchObject({ kind: 'sweep', sweep: { principal: target.principal }, changeVout: null });
    });
});

// ------------------------------------------------------------------ balance cross-check

describe('balance cross-check before large sends', () => {
    it('triggers above 25% of the balance, above 1,000,000 sats, and on every sweep', () => {
        expect(needsCrossCheck({ leaving: 25_000n, balance: 100_000n }).needed).toBe(false); // exactly 25%
        expect(needsCrossCheck({ leaving: 25_001n, balance: 100_000n }).needed).toBe(true);
        expect(needsCrossCheck({ leaving: 1_000_000n, balance: 100_000_000n }).needed).toBe(false);
        expect(needsCrossCheck({ leaving: CROSSCHECK_SATS + 1n, balance: 100_000_000n })).toMatchObject({ needed: true, reasons: ['it moves more than 1,000,000 sats'] });
        expect(needsCrossCheck({ leaving: 1_000n, balance: 100_000n, sweep: true }).needed).toBe(true);
        // Mr Sneed's ~59k sats: a 20k send is above 25%
        expect(needsCrossCheck({ leaving: 20_000n, balance: 59_000n }).needed).toBe(true);
        expect(needsCrossCheck({ leaving: 10_000n, balance: 59_000n }).needed).toBe(false);
    });

    it('asks btc_caller_balance (min 1 confirmation, paid with cycles) and passes when it agrees', async () => {
        const calls = [];
        const signer = { btc_caller_balance: async (req, pay) => { calls.push({ req, pay }); return { Ok: { balance: 130_000n } }; } };
        const utxos = [utxo(1, 100_000), utxo(2, 30_000), { ...utxo(3, 5), confirmations: 0 }];
        expect(utxoTotal(utxos)).toBe(130_000n);
        const r = await crossCheckBalance({ signer, network: NET, local: utxoTotal(utxos), fingerprint: utxoFingerprint(utxos), now: () => T0 });
        expect(r).toMatchObject({ ok: true, verified: 130_000n, at: T0 });
        expect(calls[0].req).toEqual({ network: { testnet: null }, address_type: { P2WPKH: null }, min_confirmations: [1] });
        expect(calls[0].pay).toEqual([{ CallerPaysIcrc2Cycles: null }]);
        expect(BALANCE_CYCLES).toBe(113_000_000n);
        expect(crossCheckFresh(r, { fingerprint: utxoFingerprint(utxos), now: T0 + 60_000 })).toBe(true);
        expect(crossCheckFresh(r, { fingerprint: utxoFingerprint([utxo(1, 100_000)]), now: T0 + 60_000 })).toBe(false);
        expect(crossCheckFresh(r, { fingerprint: utxoFingerprint(utxos), now: T0 + 11 * 60_000 })).toBe(false);
    });

    it('refuses on a mismatch that a fresh read does not explain, and on errors', async () => {
        const signer = { btc_caller_balance: async () => ({ Ok: { balance: 90_000n } }) };
        const bad = await crossCheckBalance({ signer, network: NET, local: 130_000n, reread: async () => ({ total: 130_000n }) });
        expect(bad.ok).toBe(false);
        expect(bad.mismatch).toBe(true);
        expect(bad.error).toMatch(/Nothing was sent/);
        // a block arrived between the two reads: the re-read agrees, so it passes
        const ok = await crossCheckBalance({ signer, network: NET, local: 130_000n, reread: async () => ({ total: 90_000n, fingerprint: 'x' }) });
        expect(ok).toMatchObject({ ok: true, reread: true, local: 90_000n });
        const err = await crossCheckBalance({ signer: { btc_caller_balance: async () => ({ Err: { PaymentError: { InsufficientFunds: { needed: 213_000_000n, available: 0n } } } }) }, network: NET, local: 1n });
        expect(err.ok).toBe(false);
        expect(err.error).toMatch(/signing credit/);
        const thrown = await crossCheckBalance({ signer: { btc_caller_balance: async () => { throw new Error('timeout'); } }, network: NET, local: 1n });
        expect(thrown.ok).toBe(false);
    });

    it('the signer IDL has btc_caller_balance as in the deployed candid', () => {
        const svc = signerIdl({ IDL });
        const fn = svc._fields.find(([n]) => n === 'btc_caller_balance')[1];
        const args = [{ network: { mainnet: null }, address_type: { P2WPKH: null }, min_confirmations: [1] }, [{ CallerPaysIcrc2Cycles: null }]];
        expect(IDL.decode(fn.argTypes, IDL.encode(fn.argTypes, args))).toEqual(args);
        const ok = [{ Ok: { balance: 59_000n } }];
        expect(IDL.decode(fn.retTypes, IDL.encode(fn.retTypes, ok))).toEqual(ok);
    });
});

// ------------------------------------------------------------------ explorer history (opt-in)

describe('explorer history (opt-in)', () => {
    const A = OWN;
    it('computes the net amount for our address and refuses implausible values', () => {
        const tx = { txid: 'a'.repeat(64), fee: 300, status: { confirmed: true, block_height: 90, block_time: 1_700_000_000 }, vin: [{ prevout: { scriptpubkey_address: A, value: 100_000 } }], vout: [{ scriptpubkey_address: OTHER, value: 50_000 }, { scriptpubkey_address: A, value: 49_700 }] };
        expect(parseExplorerTx(tx, A)).toEqual({ txid: tx.txid, net: -50_300n, fee: 300n, confirmed: true, height: 90, time: 1_700_000_000_000 });
        expect(parseExplorerTx({ ...tx, vout: [{ scriptpubkey_address: A, value: -1 }] }, A)).toBe(null);
        expect(parseExplorerTx({ ...tx, txid: 'nope' }, A)).toBe(null);
    });

    it('is off until the user agrees, and fetches without credentials or referrer', async () => {
        const st = memStorage();
        expect(explorerHistoryAllowed(st)).toBe(false);
        setExplorerHistoryAllowed(true, st);
        expect(st.getItem(EXPLORER_OK_KEY)).toBe('1');
        expect(explorerHistoryAllowed(st)).toBe(true);
        const seen = [];
        const fetchImpl = async (url, opts) => { seen.push({ url, opts }); return { ok: true, json: async () => [] }; };
        const r = await fetchExplorerHistory('testnet', A, { fetchImpl });
        expect(r).toEqual({ ok: true, txs: [], more: false, last: null });
        expect(seen[0].url).toBe(`https://mempool.space/testnet4/api/address/${A}/txs`);
        expect(seen[0].opts).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
        expect((await fetchExplorerHistory('testnet', 'bad address!', { fetchImpl })).ok).toBe(false);
    });
});

// keep recordTxid exported and used (the Activity view groups by it)
it('recordTxid prefers the signer\'s txid', () => {
    expect(recordTxid({ txid: 'b', expectedTxid: 'a' })).toBe('b');
    expect(recordTxid({ txid: null, expectedTxid: 'a' })).toBe('a');
});
