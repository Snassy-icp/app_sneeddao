// Native Bitcoin <-> ckBTC moves, phase A3 (spec/sneed_wallet.md §6; utils/btc/moves.js):
//   - availability: no move (button, minter or ledger call) while the Bitcoin surface is off
//     (prod with the beta switch off, other builds); the ck pair per network (ckTESTBTC on
//     staging testnet4, ckBTC on mainnet), and the ckBTC row's button only where the pair is ckBTC;
//   - native -> ckBTC: the minter's terms and the minimum-amount guard, the conversion record
//     inside the pending send record (written before the signer call), its phases (submitting →
//     broadcast → waiting confirmations → minting → minted, and every failure), resume after a
//     reload, the automatic-check schedule with backoff, and every update_balance answer
//     (decoded through the minter candid, as the agent hands them over);
//   - ckBTC -> native: the plan (minimum, max, approve = amount + one ledger fee), the exact approve
//     and retrieve_btc_with_approval calls, every outcome, status tracking;
//   - against the mock ckBTC minter + a real ICRC ledger on PocketIC: a deposit minted end to end
//     through finishDeposit, and a move out whose approve + burn the real ledger accepts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDL } from '@dfinity/candid';
import { Principal } from '@dfinity/principal';
import { IDL as IDL2 } from '@icp-sdk/core/candid';
import {
    minterTerms, depositEta, depositMin, depositGuard, newDepositInfo, movePhase, checkDue, backoffMs, applyUpdateBalance, applyKnownUtxos,
    finishDeposit, noteConfirmations, activeDeposits, planMoveToBtc, newWithdrawRecord, executeWithdraw, withdrawState, refreshWithdraw,
    activeWithdrawals, makeMovesStore, movesKey, MOVE_FINAL, DEPOSIT_VOUT,
} from '../../../src/app_sneeddao_frontend/src/utils/btc/moves.js';
import {
    btcNativeStatus, btcSurface, ckMoveFor, ckRowMoveShown, btcPageHref, CK_PAIRS, BTC_NETWORKS, PROD_FRONTEND_CANISTER, BETA_KEY, MAINNET_DEV_KEY,
} from '../../../src/app_sneeddao_frontend/src/utils/btc/network.js';
import { executeSend, makeStore } from '../../../src/app_sneeddao_frontend/src/utils/btc/send.js';
import { storeKey, reconcileAll } from '../../../src/app_sneeddao_frontend/src/utils/btc/pending.js';
import { planSend } from '../../../src/app_sneeddao_frontend/src/utils/btc/select.js';
import { deriveBtcAddress } from '../../../src/app_sneeddao_frontend/src/utils/btc/address.js';
import { ckbtcMinterIdl, CKBTC, APPROVAL_TTL_NS } from '../../../src/app_sneeddao_frontend/src/utils/ckMinters.js';
import { createPic, actorAs, account, admin, alice, T, BUILD, wasm } from '../lib/pic.js';

const SRC = '../../../src/app_sneeddao_frontend/src/';
const src = (p) => readFileSync(fileURLToPath(new URL(`${SRC}${p}`, import.meta.url)), 'utf8');
const ME = Principal.selfAuthenticating(new TextEncoder().encode('sneed wallet moves test')).toText();
const OWN_T = deriveBtcAddress(ME, 'testnet').address;
const OWN_M = deriveBtcAddress(ME, 'mainnet').address;
// a stand-in for the minter's deposit address (any P2WPKH address of the network)
const DEPOSIT_T = deriveBtcAddress(Principal.selfAuthenticating(new Uint8Array(32).fill(9)).toText(), 'testnet').address;
const hex64 = (n) => n.toString(16).padStart(64, '0');
const utxo = (n, value, confirmations = 3, height = 100) => ({ txid: hex64(n), vout: 0, value: BigInt(value), height, confirmations });
/// display txid (hex) -> the minter's internal byte order
const internal = (hex) => Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)).reverse());

function memStorage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
const brokenStorage = () => ({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} });

// the mainnet minter's answers, read anonymously on 2026-10-23 (get_minter_info, get_deposit_fee)
const MAINNET_INFO = { min_confirmations: 4, retrieve_btc_min_amount: 50_000n, kyt_fee: 100n, deposit_btc_min_amount: [300n], deposit_fee: 100n };
const TERMS = minterTerms(MAINNET_INFO);

// the minter's candid, as the agent decodes replies (opt = [] | [x], blobs = Uint8Array)
const minterSvc = ckbtcMinterIdl({ IDL });
const fn = (name) => minterSvc._fields.find(([n]) => n === name)[1];
const decodeReply = (name, value) => IDL.decode(fn(name).retTypes, IDL.encode(fn(name).retTypes, [value]))[0];
const ub = (value) => decodeReply('update_balance', value);

const B = (n) => BigInt(n);
const NOW = 1_800_000_000_000;

describe('moves: off while the Bitcoin surface is off, the ck pair per network', () => {
    const PROD = { DFX_NETWORK: 'ic', CANISTER_ID_APP_SNEEDDAO_FRONTEND: PROD_FRONTEND_CANISTER };
    const STAGING = { DFX_NETWORK: 'staging', CANISTER_ID_APP_SNEEDDAO_FRONTEND: '2icdp-6qaaa-aaaal-qjt6a-cai' };
    const DEV = 'tksci-hao7i-2jb3u-kjrhm-t6ada-pubbx-rj2rj-dvz3x-eczyu-ogj25-aae';
    const mem = (init = {}) => { const s = memStorage(); for (const [k, v] of Object.entries(init)) s.setItem(k, v); return s; };

    it('prod with the beta switch off (any storage state): no pair, no row button, inactive surface', () => {
        for (const storage of [mem(), mem({ [BETA_KEY]: '0' }), mem({ [MAINNET_DEV_KEY]: '1' }), null, brokenStorage()]) {
            const st = btcNativeStatus({ e: PROD, hostname: 'app.sneeddao.com', principal: ME, storage, url: '' });
            expect(ckMoveFor(st)).toBe(null);
            expect(ckRowMoveShown(st, CKBTC.ledger)).toBe(false);
            expect(btcSurface(st, true).active).toBe(false);
        }
    });
    it('prod with the switch on: ckBTC on mainnet, and the ckBTC row gets the button', () => {
        const st = btcNativeStatus({ e: PROD, hostname: 'app.sneeddao.com', principal: ME, storage: mem({ [BETA_KEY]: '1' }), url: '' });
        expect(ckMoveFor(st)).toEqual({ symbol: 'ckBTC', ledger: CKBTC.ledger, minter: CKBTC.minter });
        expect(ckRowMoveShown(st, CKBTC.ledger)).toBe(true);
        expect(ckRowMoveShown(st, CK_PAIRS.testnet.ledger)).toBe(false);
    });
    it('staging testnet4 pairs with ckTESTBTC (so the ckBTC row has no button); developer mainnet with ckBTC', () => {
        const t = btcNativeStatus({ e: STAGING, hostname: 'x.icp0.io', principal: ME, storage: mem(), url: '' });
        expect(ckMoveFor(t)).toEqual({ symbol: 'ckTESTBTC', ledger: 'mc6ru-gyaaa-aaaar-qaaaq-cai', minter: 'ml52i-qqaaa-aaaar-qaaba-cai' });
        expect(ckRowMoveShown(t, CKBTC.ledger)).toBe(false);
        const d = btcNativeStatus({ e: STAGING, hostname: 'x.icp0.io', principal: DEV, storage: mem({ [MAINNET_DEV_KEY]: '1' }), url: '' });
        expect(ckMoveFor(d).minter).toBe(CKBTC.minter);
        expect(ckRowMoveShown(d, CKBTC.ledger)).toBe(true);
        expect(BTC_NETWORKS.mainnet.ck).toBe(CK_PAIRS.mainnet);
    });
    it('other builds have no moves', () => {
        for (const e of [{ DFX_NETWORK: 'ic', CANISTER_ID_APP_SNEEDDAO_FRONTEND: 'aaaaa-aa' }, { DFX_NETWORK: 'local' }, {}]) {
            expect(ckMoveFor(btcNativeStatus({ e, hostname: 'localhost', principal: ME, storage: mem({ [BETA_KEY]: '1' }), url: '' }))).toBe(null);
        }
        expect(ckMoveFor(null)).toBe(null);
    });
    it('btc.html links keep the headless developer-mode parameter', () => {
        expect(btcPageHref({ devSource: 'param' }, 'move')).toBe('/btc.html?btcnet=mainnet#move');
        expect(btcPageHref({ devSource: 'toggle' }, 'move-tobtc')).toBe('/btc.html#move-tobtc');
        expect(btcPageHref(null, 'send')).toBe('/btc.html#send');
    });
    it('every surface takes its moves through ckMoveFor / ckRowMoveShown and an active surface', () => {
        expect(src('btc/useBtcWallet.js')).toMatch(/const ck = surface\.active \? ckMoveFor\(status\) : null;/);
        expect(src('btc/useMoves.js')).toMatch(/if \(!ck \|\| !makeActor\) return undefined;/);
        expect(src('btc/BtcApp.jsx')).toMatch(/const tabs = TABS\.filter\(\(\[k\]\) => k !== 'move' \|\| w\.ck\);/);
        expect(src('btc/BtcApp.jsx')).toMatch(/\{w\.cfg && isAuthenticated && \(/);
        expect(src('components/btc/BtcNativeSection.jsx')).toMatch(/const ck = ckMoveFor\(status\);/);
        expect(src('components/btc/BtcNativeSection.jsx')).toMatch(/\.\.\.\(ck \? \[\{ key: 'tock'/);
        expect(src('TokenCard.jsx')).toMatch(/const ckToBtcActions = isBtcCard && !hideButtons && ckRowMoveShown\(btcStatusMe, pocketLedger\)/);
        // the native → ck signing happens on btc.html only (no analytics): the SPA only navigates there
        expect(src('components/btc/BtcNativeSection.jsx')).not.toMatch(/btc_caller_send|executeSend/);
        expect(src('TokenCard.jsx')).not.toMatch(/executeWithdraw|retrieve_btc_with_approval/);
    });
});

describe('native → ckBTC: terms and the minimum', () => {
    it('reads the minter terms (check fee from get_deposit_fee, else kyt_fee)', () => {
        expect(TERMS).toEqual({ minConfirmations: 4, checkFee: 100n, minDeposit: 300n, retrieveMin: 50_000n });
        expect(minterTerms({ ...MAINNET_INFO, deposit_fee: null, kyt_fee: 2_000n }).checkFee).toBe(2_000n);
        expect(minterTerms({ ...MAINNET_INFO, deposit_btc_min_amount: [] }).minDeposit).toBe(null);
        expect(minterTerms(null)).toBe(null);
    });
    it('an honest wait: blocks left × 10 minutes', () => {
        expect(depositEta(4)).toEqual({ blocks: 4, minutes: 40, text: 'about 40 minutes (4 blocks)' });
        expect(depositEta(4, 3).text).toBe('about 10 minutes (1 block)');
        expect(depositEta(4, 6).text).toBe('any moment now');
    });
    it('refuses amounts that would arrive below the minimum or the check fee', () => {
        expect(depositMin(TERMS)).toBe(1_000n); // our send minimum is above the minter's 300
        expect(depositMin({ ...TERMS, minDeposit: 5_000n })).toBe(5_000n);
        expect(depositMin({ ...TERMS, checkFee: 2_000n })).toBe(2_001n);
        expect(depositGuard({ amount: 999n, terms: TERMS })).toMatchObject({ ok: false, min: 1_000n });
        expect(depositGuard({ amount: 999n, terms: TERMS }).error).toMatch(/at least 1,000 sats.*100 sats check fee/);
        expect(depositGuard({ amount: 4_999n, terms: { ...TERMS, minDeposit: 5_000n } }).ok).toBe(false);
        expect(depositGuard({ amount: 1_000n, terms: TERMS })).toEqual({ ok: true, min: 1_000n, receive: 900n, error: null });
        expect(depositGuard({ amount: 51_000n, terms: TERMS }).receive).toBe(50_900n);
        expect(depositGuard({ amount: 51_000n, terms: null }).ok).toBe(false);
        expect(depositGuard({ amount: null, terms: TERMS }).ok).toBe(false);
    });
    it('the send form enforces the guard before review and again right before signing', () => {
        const send = src('components/btc/BtcSend.jsx');
        expect(send).toMatch(/const canReview = plan\?\.ok && !storeBlocked && step === 'edit' && \(!guard \|\| guard\.ok\);/);
        expect(send).toMatch(/if \(move && !depositGuard\(\{ amount: plan\.amount, terms: move\.terms \}\)\.ok\) throw/);
        expect(send).toMatch(/kind: move \? 'toCkbtc' : 'send'/);
    });
});

/// A toCkbtc send through executeSend with a mock signer; returns the store and the record.
async function sentMove({ storage = memStorage(), signerReply = 'ok', amount = 60_000n } = {}) {
    const store = makeStore(storage, storeKey('testnet', ME));
    const plan = planSend({ utxos: [utxo(1, 100_000)], amount, feeRate: 2, destType: 'p2wpkh' });
    expect(plan.ok).toBe(true);
    let seenBefore = null;
    let expected = null;
    const signer = {
        btc_caller_send: async (req) => {
            // the conversion record is already stored when the signer is called
            seenBefore = store.load().records.find((r) => r.id === 'm1');
            if (signerReply === 'throw') throw new Error('timeout');
            if (signerReply === 'err') return { Err: { InternalError: { msg: 'boom' } } };
            return { Ok: { txid: expected } };
        },
    };
    const pair = CK_PAIRS.testnet;
    const r = await executeSend({
        signer, store, plan, toAddress: DEPOSIT_T, network: 'testnet', ownAddress: OWN_T, id: 'm1', kind: 'toCkbtc',
        extra: { ckbtc: newDepositInfo({ pair, owner: ME, depositAddress: DEPOSIT_T, terms: TERMS, amount: plan.amount }) },
        now: () => NOW, onSubmitting: (rec) => { expected = rec.expectedTxid; },
    });
    return { store, storage, plan, r, seenBefore, rec: () => store.load().records.find((x) => x.id === 'm1') };
}

describe('native → ckBTC: the conversion record', () => {
    it('is part of the pending send record, written before the signer is called', async () => {
        const { r, seenBefore, rec } = await sentMove();
        expect(seenBefore).toMatchObject({ kind: 'toCkbtc', state: 'submitting', ckbtc: { status: 'waiting', depositAddress: DEPOSIT_T, owner: ME, minter: CK_PAIRS.testnet.minter, ledger: CK_PAIRS.testnet.ledger, minConfirmations: 4, checkFee: '100', expectedMint: '59900', vout: 0 } });
        expect(movePhase(seenBefore)).toBe('submitting');
        expect(r.state).toBe('broadcast');
        expect(rec().request.outputs[DEPOSIT_VOUT]).toEqual({ address: DEPOSIT_T, value: '60000' });
        expect(movePhase(rec())).toBe('waiting_confs');
    });

    it('phases: waiting for confirmations → minting at the minter\'s count → minted', async () => {
        const { store, rec } = await sentMove();
        expect(checkDue(rec(), { now: NOW + 60_000 })).toEqual({ due: false, reason: 'waiting for confirmations' });
        noteConfirmations(store, 'm1', 2, { now: NOW });
        expect(rec().ckbtc.confirmations).toBe(2);
        expect(movePhase(rec())).toBe('waiting_confs');
        expect(checkDue(rec(), { now: NOW + 60_000 }).due).toBe(false);
        expect(checkDue(rec(), { now: NOW + 60_000, manual: true }).due).toBe(true); // "Check / finish" asks anyway
        noteConfirmations(store, 'm1', 4, { now: NOW });
        expect(movePhase(rec())).toBe('minting');
        expect(checkDue(rec(), { now: NOW + 60_000 })).toEqual({ due: true, reason: 'enough confirmations' });
        const a = applyUpdateBalance(rec(), ub({ Ok: [{ Minted: { block_index: 77n, minted_amount: 59_900n, utxo: { outpoint: { txid: internal(rec().txid), vout: 0 }, value: 60_000n, height: 900_000 } } }] }), { now: NOW });
        expect(a.outcome).toBe('minted');
        expect(a.ck).toMatchObject({ status: 'minted', mintedAmount: '59900', mintBlock: '77', nextCheckAt: null });
        expect(movePhase({ ...rec(), ckbtc: a.ck })).toBe('minted');
        expect(checkDue({ ...rec(), ckbtc: a.ck }, { now: NOW, manual: true }).due).toBe(false);
        expect(activeDeposits([{ ...rec(), ckbtc: a.ck }])).toEqual([]);
    });

    it('failures of the send: failed (typed Err), unknown (no answer); no minter call for either', async () => {
        const f = await sentMove({ signerReply: 'err' });
        expect(f.r.state).toBe('failed');
        expect(movePhase(f.rec())).toBe('failed');
        expect(MOVE_FINAL).toContain('failed');
        expect(checkDue(f.rec(), { now: NOW, manual: true })).toEqual({ due: false, reason: 'final' });
        const u = await sentMove({ signerReply: 'throw' });
        expect(movePhase(u.rec())).toBe('unknown');
        expect(checkDue(u.rec(), { now: NOW + 3_600_000, manual: true })).toEqual({ due: false, reason: 'the send has not gone out yet' });
        expect(activeDeposits([u.rec()])).toHaveLength(1); // still watched: it may have gone out
    });

    it('resumes after a reload: submitting → unknown → confirmed (inputs spent) → checks due, backoff kept', async () => {
        const storage = memStorage();
        const { rec } = await sentMove({ storage, signerReply: 'throw' });
        // the page closed during the call: the record is back to `submitting` on disk
        const key = storeKey('testnet', ME);
        storage.setItem(key, JSON.stringify([{ ...rec(), state: 'submitting' }]));
        // reload: a new store over the same storage, reconcile against the UTXO set (inputs unspent)
        const store2 = makeStore(storage, key);
        const inputs = new Set([`${hex64(1)}:0`]);
        store2.mutate((rs) => reconcileAll(rs, { utxoKeys: inputs, now: NOW + 1_000 }).records);
        expect(movePhase(store2.load().records[0])).toBe('unknown');
        // the transaction was mined: inputs left the UTXO set
        store2.mutate((rs) => reconcileAll(rs, { utxoKeys: new Set(), now: NOW + 2_000 }).records);
        const r2 = store2.load().records[0];
        expect(r2.state).toBe('confirmed');
        expect(movePhase(r2)).toBe('waiting_confs');
        // not seen at the deposit address yet: due once the expected 4 blocks have passed
        expect(checkDue(r2, { now: NOW + 39 * 60_000 }).due).toBe(false);
        expect(checkDue(r2, { now: NOW + 41 * 60_000 })).toEqual({ due: true, reason: 'the expected wait has passed' });
        // a check that finds it pending sets a backoff that survives another reload
        const minter = { update_balance: async () => ({ Err: { NoNewUtxos: { current_confirmations: [], required_confirmations: 4, pending_utxos: [[{ outpoint: { txid: internal(r2.txid), vout: 0 }, value: 60_000n, confirmations: 3 }]], suspended_utxos: [[]] } } }) };
        const out = await finishDeposit({ makeActor: () => minter, store: store2, id: 'm1', now: () => NOW + 41 * 60_000 });
        expect(out.outcome).toBe('pending');
        const store3 = makeStore(storage, key);
        const r3 = store3.load().records[0];
        expect(r3.ckbtc).toMatchObject({ confirmations: 3, checks: 1 });
        expect(r3.ckbtc.nextCheckAt).toBe(NOW + 41 * 60_000 + 60_000);
        expect(checkDue(r3, { now: NOW + 41 * 60_000 + 30_000 })).toEqual({ due: false, reason: 'backing off' });
        expect(checkDue(r3, { now: NOW + 41 * 60_000 + 30_000, manual: true }).due).toBe(true);
        expect(checkDue(r3, { now: NOW + 41 * 60_000 + 61_000 }).due).toBe(false); // 3 < 4 confirmations
    });

    it('backoff: 1, 2, 4, 8 … minutes, capped at 15; busy 1 min; checked 2 min; error 5 min', () => {
        expect([1, 2, 3, 4, 5, 6].map((n) => backoffMs('pending', n) / 60_000)).toEqual([1, 2, 4, 8, 15, 15]);
        expect(backoffMs('not_seen', 2)).toBe(120_000);
        expect(backoffMs('busy', 9)).toBe(60_000);
        expect(backoffMs('checked', 9)).toBe(120_000);
        expect(backoffMs('error', 1)).toBe(300_000);
    });
});

describe('native → ckBTC: update_balance answers (decoded through the minter candid)', () => {
    let r;
    beforeAll(async () => { const m = await sentMove(); r = { ...m.rec(), ckbtc: { ...m.rec().ckbtc, confirmations: 4 } }; });
    const mine = (value = 60_000n) => ({ outpoint: { txid: internal(r.txid), vout: 0 }, value, height: 900_000 });
    const other = { outpoint: { txid: internal(hex64(99)), vout: 1 }, value: 5_000n, height: 900_001 };

    it('Minted for our deposit closes it; others minted in the same call are mentioned', () => {
        const a = applyUpdateBalance(r, ub({ Ok: [{ Minted: { block_index: 5n, minted_amount: 4_900n, utxo: other } }, { Minted: { block_index: 6n, minted_amount: 59_900n, utxo: mine() } }] }), { now: NOW });
        expect(a).toMatchObject({ outcome: 'minted', ck: { status: 'minted', mintedAmount: '59900', mintBlock: '6', checks: 1, lastCheckAt: NOW } });
        expect(a.message).toMatch(/Minted 0\.000599 ckTESTBTC \(ledger block 6\)\. The same check also minted 1 other deposit/);
    });
    it('only other deposits minted: ours is not seen yet, keep checking', () => {
        const a = applyUpdateBalance(r, ub({ Ok: [{ Minted: { block_index: 5n, minted_amount: 4_900n, utxo: other } }] }), { now: NOW });
        expect(a).toMatchObject({ outcome: 'not_seen', ck: { status: 'waiting', nextCheckAt: NOW + 60_000 } });
    });
    it('ValueTooSmall and Tainted are final; Checked retries in 2 minutes', () => {
        expect(applyUpdateBalance(r, ub({ Ok: [{ ValueTooSmall: mine(90n) }] }), { now: NOW })).toMatchObject({ outcome: 'too_small', ck: { status: 'too_small', nextCheckAt: null } });
        const t = applyUpdateBalance(r, ub({ Ok: [{ Tainted: mine() }] }), { now: NOW });
        expect(t).toMatchObject({ outcome: 'tainted', ck: { status: 'tainted' } });
        expect(t.message).toMatch(/quarantined/);
        const c = applyUpdateBalance(r, ub({ Ok: [{ Checked: mine() }] }), { now: NOW });
        expect(c).toMatchObject({ outcome: 'checked', ck: { status: 'checked', nextCheckAt: NOW + 120_000 } });
        expect(movePhase({ ...r, ckbtc: c.ck })).toBe('minting');
    });
    it('NoNewUtxos: our pending confirmations, suspended (quarantined / too small), or not there', () => {
        const nn = (x) => ub({ Err: { NoNewUtxos: { current_confirmations: [], required_confirmations: 4, pending_utxos: [x.pending || []], suspended_utxos: [x.suspended || []] } } });
        const p = applyUpdateBalance(r, nn({ pending: [{ outpoint: mine().outpoint, value: 60_000n, confirmations: 2 }] }), { now: NOW });
        expect(p).toMatchObject({ outcome: 'pending', ck: { confirmations: 2 } });
        expect(p.message).toMatch(/2 of 4 confirmations/);
        expect(applyUpdateBalance(r, nn({ suspended: [{ utxo: mine(), reason: { Quarantined: null }, earliest_retry: 0n }] }), { now: NOW }).ck.status).toBe('tainted');
        expect(applyUpdateBalance(r, nn({ suspended: [{ utxo: mine(200n), reason: { ValueTooSmall: null }, earliest_retry: 0n }] }), { now: NOW }).ck.status).toBe('too_small');
        const n = applyUpdateBalance(r, nn({ pending: [{ outpoint: other.outpoint, value: 1n, confirmations: 1 }] }), { now: NOW });
        expect(n).toMatchObject({ outcome: 'not_seen', ck: { status: 'waiting', confirmations: 4 } });
        // the minter's reply without the opt fields at all
        const bare = applyUpdateBalance(r, ub({ Err: { NoNewUtxos: { current_confirmations: [], required_confirmations: 4, pending_utxos: [], suspended_utxos: [] } } }), { now: NOW });
        expect(bare.outcome).toBe('not_seen');
    });
    it('AlreadyProcessing / TemporarilyUnavailable / a failed call retry in a minute; GenericError in five', () => {
        expect(applyUpdateBalance(r, ub({ Err: { AlreadyProcessing: null } }), { now: NOW })).toMatchObject({ outcome: 'busy', ck: { nextCheckAt: NOW + 60_000 } });
        expect(applyUpdateBalance(r, ub({ Err: { TemporarilyUnavailable: 'overloaded' } }), { now: NOW }).message).toMatch(/busy: overloaded/);
        expect(applyUpdateBalance(r, { thrown: 'Network error\nmore' }, { now: NOW })).toMatchObject({ outcome: 'busy', ck: { status: 'waiting' } });
        const g = applyUpdateBalance(r, ub({ Err: { GenericError: { error_code: 7n, error_message: 'nope' } } }), { now: NOW });
        expect(g).toMatchObject({ outcome: 'error', ck: { nextCheckAt: NOW + 300_000 } });
        expect(g.message).toMatch(/Minter error 7: nope/);
    });
    it('get_known_utxos after not_seen: minted earlier elsewhere', () => {
        expect(applyKnownUtxos(r, [other], { now: NOW })).toBe(null);
        const k = applyKnownUtxos(r, [other, mine()], { now: NOW });
        expect(k).toMatchObject({ outcome: 'minted', ck: { status: 'minted', mintedAmount: '59900', mintBlock: null } });
    });
    it('finishDeposit: calls as the user with owner = the record owner, falls back to known UTXOs, never undoes another tab', async () => {
        const storage = memStorage();
        const store = makeStore(storage, storeKey('testnet', ME));
        store.mutate(() => [r]);
        const calls = [];
        const minter = {
            update_balance: async (a) => { calls.push(['update_balance', a]); return ub({ Err: { NoNewUtxos: { current_confirmations: [], required_confirmations: 4, pending_utxos: [[]], suspended_utxos: [[]] } } }); },
            get_known_utxos: async (a) => { calls.push(['get_known_utxos', a]); return [mine()]; },
        };
        const made = [];
        const out = await finishDeposit({ makeActor: (idl, id) => { made.push(id); return minter; }, store, id: r.id, now: () => NOW });
        expect(made).toEqual([CK_PAIRS.testnet.minter]);
        expect(calls.map((c) => c[0])).toEqual(['update_balance', 'get_known_utxos']);
        expect(calls[0][1].owner[0].toText()).toBe(ME);
        expect(calls[0][1].subaccount).toEqual([]);
        expect(out.outcome).toBe('minted');
        expect(store.load().records[0].ckbtc.status).toBe('minted');
        // final now: further checks are skipped without a call
        expect(await finishDeposit({ makeActor: () => minter, store, id: r.id, now: () => NOW, manual: true })).toMatchObject({ skipped: true });
        expect(calls).toHaveLength(2);
        // another tab finishes it while our call runs: our answer does not overwrite it
        store.mutate(() => [r]);
        const slow = { update_balance: async () => { store.mutate((rs) => rs.map((x) => ({ ...x, ckbtc: { ...x.ckbtc, status: 'minted', mintBlock: '9' } }))); return ub({ Err: { AlreadyProcessing: null } }); } };
        await finishDeposit({ makeActor: () => slow, store, id: r.id, now: () => NOW });
        expect(store.load().records[0].ckbtc).toMatchObject({ status: 'minted', mintBlock: '9' });
        // unreadable storage: nothing is called
        const blocked = makeStore(brokenStorage(), 'k');
        expect(await finishDeposit({ makeActor: () => { throw new Error('no call'); }, store: blocked, id: r.id })).toMatchObject({ skipped: true });
    });
});

describe('ckBTC → native: amounts and the calls', () => {
    const FEE = { bitcoin_fee: 212n, minter_fee: 300n };
    it('plan: the minter minimum, max = balance − ledger fee, approve = amount + one ledger fee', () => {
        const low = planMoveToBtc({ amount: 49_999n, balance: 100_000n, ledgerFee: 10n, minAmount: 50_000n, fee: FEE });
        expect(low.ok).toBe(false);
        expect(low.errors.join(' ')).toMatch(/minimum withdrawal is 0\.0005/);
        const p = planMoveToBtc({ amount: 50_000n, balance: 100_000n, ledgerFee: 10n, minAmount: 50_000n, fee: FEE });
        expect(p).toMatchObject({ ok: true, max: 99_990n, approveAmount: 50_010n, spend: 50_010n, receive: 49_488n, networkFee: 512n });
        expect(planMoveToBtc({ amount: 99_991n, balance: 100_000n, ledgerFee: 10n, minAmount: 50_000n, fee: FEE }).ok).toBe(false);
        expect(planMoveToBtc({ amount: 99_990n, balance: 100_000n, ledgerFee: 10n, minAmount: 50_000n, fee: FEE })).toMatchObject({ ok: true, approveAmount: 100_000n });
        expect(planMoveToBtc({ amount: null, balance: 100_000n, ledgerFee: 10n, minAmount: 50_000n, fee: FEE }).approveAmount).toBe(null);
    });

    const pair = CK_PAIRS.mainnet;
    const mkRecord = (amount = 60_000n) => {
        const plan = planMoveToBtc({ amount, balance: 1_000_000n, ledgerFee: 10n, minAmount: 50_000n, fee: FEE });
        return newWithdrawRecord({ id: 'w1', network: 'mainnet', pair, plan, amount, ledgerFee: 10n, address: OWN_M, owner: ME, now: NOW });
    };
    /// makeActor over a mock ledger and minter, recording every call
    const mocks = ({ approve = () => ({ Ok: 11n }), retrieve = () => ({ Ok: { block_index: 42n } }) } = {}) => {
        const calls = [];
        const ledger = { icrc2_approve: async (a) => { calls.push(['icrc2_approve', a]); return approve(a); } };
        const minter = { retrieve_btc_with_approval: async (a) => { calls.push(['retrieve_btc_with_approval', a]); return retrieve(a); } };
        return { calls, makeActor: (idl, id) => (String(id) === pair.ledger ? ledger : String(id) === pair.minter ? minter : (() => { throw new Error(`unexpected ${id}`); })()) };
    };
    const NOW_NS = BigInt(NOW) * 1_000_000n;

    it('approve the minter for amount + fee (1 hour), then retrieve to the own address: requested', async () => {
        const store = makeMovesStore(memStorage(), movesKey('mainnet', ME));
        const { calls, makeActor } = mocks();
        const steps = [];
        const r = await executeWithdraw({ makeActor, store, record: mkRecord(), nowNs: NOW_NS, now: () => NOW, onStep: (s) => steps.push(s) });
        expect(r).toEqual({ state: 'requested', blockIndex: 42n });
        expect(steps).toEqual(['approve', 'withdraw', 'done']);
        const [ap, rt] = calls;
        expect(ap[0]).toBe('icrc2_approve');
        expect(ap[1].spender.owner.toText()).toBe(pair.minter);
        expect(ap[1].spender.subaccount).toEqual([]);
        expect(ap[1].amount).toBe(60_010n);
        expect(ap[1].fee).toEqual([10n]);
        expect(ap[1].from_subaccount).toEqual([]);
        expect(ap[1].expires_at).toEqual([NOW_NS + APPROVAL_TTL_NS]);
        expect(rt).toEqual(['retrieve_btc_with_approval', { address: OWN_M, amount: 60_000n, from_subaccount: [] }]);
        const rec = store.load().records[0];
        expect(rec).toMatchObject({ kind: 'toBtc', state: 'requested', blockIndex: '42', approveBlock: '11', amount: '60000', approveAmount: '60010', address: OWN_M, minter: pair.minter, ledger: pair.ledger });
        expect(rec.log.map((l) => l.event)).toEqual(['created', 'approved', 'requested']);
        expect(activeWithdrawals([rec])).toHaveLength(1);
    });
    it('the minter refuses (typed Err): failed, nothing burned', async () => {
        const store = makeMovesStore(memStorage(), movesKey('mainnet', ME));
        const { makeActor } = mocks({ retrieve: () => ({ Err: { AmountTooLow: 50_000n } }) });
        const r = await executeWithdraw({ makeActor, store, record: mkRecord(), nowNs: NOW_NS, now: () => NOW });
        expect(r.state).toBe('failed');
        expect(r.error).toMatch(/Too small.*Nothing was burned; the approval lapses within the hour/);
        expect(store.load().records[0].state).toBe('failed');
    });
    it('no answer from the minter: unknown (it may have burned)', async () => {
        const store = makeMovesStore(memStorage(), movesKey('mainnet', ME));
        const { makeActor } = mocks({ retrieve: () => { throw new Error('Request timed out'); } });
        const r = await executeWithdraw({ makeActor, store, record: mkRecord(), nowNs: NOW_NS, now: () => NOW });
        expect(r.state).toBe('unknown');
        expect(store.load().records[0]).toMatchObject({ state: 'unknown', approveBlock: '11' });
    });
    it('the approve fails: failed, the minter is never asked', async () => {
        const store = makeMovesStore(memStorage(), movesKey('mainnet', ME));
        const { calls, makeActor } = mocks({ approve: () => ({ Err: { InsufficientFunds: { balance: 5n } } }) });
        const r = await executeWithdraw({ makeActor, store, record: mkRecord(), nowNs: NOW_NS, now: () => NOW });
        expect(r.state).toBe('failed');
        expect(r.error).toMatch(/Nothing was moved/);
        expect(calls.map((c) => c[0])).toEqual(['icrc2_approve']);
    });
    it('the record can\'t be saved: nothing is called', async () => {
        const { calls, makeActor } = mocks();
        const r = await executeWithdraw({ makeActor, store: makeMovesStore(brokenStorage(), 'k'), record: mkRecord(), nowNs: NOW_NS });
        expect(r.state).toBe('not_sent');
        expect(calls).toEqual([]);
    });
    it('tracks the minter status (retrieve_btc_status_v2) to the end', async () => {
        const txid = hex64(0xabc);
        expect(withdrawState({ Pending: null })).toMatchObject({ state: 'requested', status: 'Pending' });
        expect(withdrawState({ Submitted: { txid: internal(txid) } })).toEqual({ state: 'requested', status: 'Submitted', txid });
        expect(withdrawState({ Confirmed: { txid: internal(txid) } })).toEqual({ state: 'confirmed', status: 'Confirmed', txid });
        expect(withdrawState({ AmountTooLow: null }).state).toBe('too_low');
        expect(withdrawState({ Unknown: null }, 'requested').state).toBe('requested');
        expect(withdrawState({ Reimbursed: { account: { owner: Principal.fromText(ME), subaccount: [] }, mint_block_index: 9n, amount: 59_000n, reason: { CallFailed: null } } })).toMatchObject({ state: 'reimbursed', amount: '59000', mintBlock: '9' });

        const store = makeMovesStore(memStorage(), movesKey('mainnet', ME));
        const { makeActor } = mocks();
        await executeWithdraw({ makeActor, store, record: mkRecord(), nowNs: NOW_NS, now: () => NOW });
        let status = { Submitted: { txid: internal(txid) } };
        const asked = [];
        const minter = { retrieve_btc_status_v2: async (a) => { asked.push(a); return decodeReply('retrieve_btc_status_v2', status); } };
        await refreshWithdraw({ makeActor: () => minter, store, record: store.load().records[0], now: () => NOW });
        expect(asked[0]).toEqual({ block_index: 42n });
        expect(store.load().records[0]).toMatchObject({ state: 'requested', status: 'Submitted', txid });
        status = { Confirmed: { txid: internal(txid) } };
        await refreshWithdraw({ makeActor: () => minter, store, record: store.load().records[0], now: () => NOW });
        expect(store.load().records[0]).toMatchObject({ state: 'confirmed', txid });
        expect(activeWithdrawals(store.load().records)).toEqual([]);
        expect(await refreshWithdraw({ makeActor: () => minter, store, record: store.load().records[0] })).toBe(null);
        expect(asked).toHaveLength(2);
    });
});

// ---- the mock ckBTC minter (test/canisters/canisters/MockCkBtcMinter.mo) + a real ICRC ledger ----

const ledgerGz = resolve(BUILD, 'ledger.wasm.gz');
const haveWasms = existsSync(ledgerGz) && existsSync(resolve(BUILD, 'MockCkBtcMinter.wasm'));
const Account = IDL2.Record({ owner: IDL2.Principal, subaccount: IDL2.Opt(IDL2.Vec(IDL2.Nat8)) });
const MetadataValue = IDL2.Variant({ Nat: IDL2.Nat, Int: IDL2.Int, Text: IDL2.Text, Blob: IDL2.Vec(IDL2.Nat8) });
const LedgerArg = IDL2.Variant({
    Init: IDL2.Record({
        minting_account: Account, transfer_fee: IDL2.Nat, decimals: IDL2.Opt(IDL2.Nat8), token_symbol: IDL2.Text, token_name: IDL2.Text,
        metadata: IDL2.Vec(IDL2.Tuple(IDL2.Text, MetadataValue)), initial_balances: IDL2.Vec(IDL2.Tuple(Account, IDL2.Nat)),
        feature_flags: IDL2.Opt(IDL2.Record({ icrc2: IDL2.Bool })),
        archive_options: IDL2.Record({ num_blocks_to_archive: IDL2.Nat64, trigger_threshold: IDL2.Nat64, controller_id: IDL2.Principal, cycles_for_archive_creation: IDL2.Opt(IDL2.Nat64) }),
    }),
    Upgrade: IDL2.Opt(IDL2.Record({})),
});
const testIdl = ({ IDL: I }) => {
    const A = I.Record({ owner: I.Principal, subaccount: I.Opt(I.Vec(I.Nat8)) });
    const Reason = I.Variant({ CallFailed: I.Null, TaintedDestination: I.Record({ kyt_fee: I.Nat64, kyt_provider: I.Principal }) });
    const S = I.Variant({
        Unknown: I.Null, Pending: I.Null, Signing: I.Null, Sending: I.Record({ txid: I.Vec(I.Nat8) }), Submitted: I.Record({ txid: I.Vec(I.Nat8) }),
        AmountTooLow: I.Null, Confirmed: I.Record({ txid: I.Vec(I.Nat8) }),
        Reimbursed: I.Record({ account: A, mint_block_index: I.Nat64, amount: I.Nat64, reason: Reason }),
        WillReimburse: I.Record({ account: A, amount: I.Nat64, reason: Reason }),
    });
    return I.Service({
        test_add_utxo: I.Func([I.Principal, I.Nat64, I.Nat32, I.Nat8], [], []),
        test_confirm_all: I.Func([I.Nat32], [], []),
        test_set_status: I.Func([I.Nat64, S], [], []),
    });
};
const ledgerIdl = ({ IDL: I }) => {
    const A = I.Record({ owner: I.Principal, subaccount: I.Opt(I.Vec(I.Nat8)) });
    return I.Service({
        icrc1_balance_of: I.Func([A], [I.Nat], ['query']),
        icrc2_allowance: I.Func([I.Record({ account: A, spender: A })], [I.Record({ allowance: I.Nat, expires_at: I.Opt(I.Nat64) })], ['query']),
    });
};

describe.skipIf(!haveWasms)('moves against the mock ckBTC minter + a real ICRC ledger (PocketIC)', () => {
    let pic, minterId, ledgerId;
    const P = (id) => (typeof id === 'string' ? Principal.fromText(id) : id);
    const makeActor = (idl, id) => actorAs(pic, idl, P(id), alice);
    const ALICE_ADDR = deriveBtcAddress(alice.toText(), 'mainnet').address;
    const bal = () => actorAs(pic, ledgerIdl, ledgerId, alice).icrc1_balance_of(account(alice));

    beforeAll(async () => {
        let appSubnet;
        ({ pic, appSubnet } = await createPic());
        const create = () => pic.createCanister({ sender: admin, cycles: 100n * T, targetSubnetId: appSubnet, controllers: [admin] });
        minterId = await create(); ledgerId = await create();
        await pic.installCode({ sender: admin, canisterId: ledgerId, wasm: readFileSync(ledgerGz), arg: IDL2.encode([LedgerArg], [{ Init: {
            minting_account: account(minterId), transfer_fee: 10n, decimals: [8], token_symbol: 'ckBTC', token_name: 'ckBTC', metadata: [],
            initial_balances: [[account(alice), 1_000_000n]], feature_flags: [{ icrc2: true }],
            archive_options: { num_blocks_to_archive: 1000n, trigger_threshold: 2000n, controller_id: admin, cycles_for_archive_creation: [10n * T] },
        } }]) });
        await pic.installCode({ sender: admin, canisterId: minterId, wasm: wasm('MockCkBtcMinter'), arg: IDL2.encode([IDL2.Record({ ledger: IDL2.Principal })], [{ ledger: ledgerId }]) });
    }, 180_000);
    afterAll(async () => { await pic?.tearDown(); });

    it('a move to ckBTC: pending at 2 of 4 confirmations, then minted (amount − check fee) by "Check / finish"', async () => {
        // the deposit the mock minter knows: txid bytes (internal order) [7, 1, 2, …, 31], vout 0
        const txInternal = Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? 7 : i));
        const txid = Array.from(txInternal).reverse().map((b) => b.toString(16).padStart(2, '0')).join('');
        const pair = { symbol: 'ckBTC', ledger: ledgerId.toText(), minter: minterId.toText() };
        const rec = {
            id: 'pic1', kind: 'toCkbtc', network: 'mainnet', state: 'broadcast', createdAt: NOW, broadcastAt: NOW, txid, expectedTxid: txid,
            request: { inputs: [], outputs: [{ address: 'bc1qdeposit', value: '60000' }], fee: '300' }, amount: '60000', fee: '300', log: [],
            ckbtc: newDepositInfo({ pair, owner: alice.toText(), depositAddress: 'bc1qdeposit', terms: TERMS, amount: 60_000n }),
        };
        const store = makeStore(memStorage(), storeKey('mainnet', alice.toText()));
        store.mutate(() => [rec]);
        const t = actorAs(pic, testIdl, minterId, admin);
        await t.test_add_utxo(alice, 60_000n, 2, 7);
        const before = await bal();
        const first = await finishDeposit({ makeActor, store, id: 'pic1', manual: true });
        expect(first.outcome).toBe('pending');
        expect(store.load().records[0].ckbtc).toMatchObject({ confirmations: 2, status: 'waiting' });
        expect(movePhase(store.load().records[0])).toBe('waiting_confs');
        await t.test_confirm_all(6);
        const done = await finishDeposit({ makeActor, store, id: 'pic1', manual: true });
        expect(done.outcome).toBe('minted');
        const ck = store.load().records[0].ckbtc;
        expect(ck).toMatchObject({ status: 'minted', mintedAmount: '59900' });
        expect(ck.mintBlock).not.toBe(null);
        expect(await bal()).toBe(before + 59_900n);
        // already minted: a further check finds nothing new and the record stays minted
        expect((await finishDeposit({ makeActor, store, id: 'pic1', manual: true })).skipped).toBe(true);
    });

    it('a move to the Bitcoin address: the real ledger takes the approve (amount + fee) and the burn; status tracked', async () => {
        const before = await bal();
        const pair = { symbol: 'ckBTC', ledger: ledgerId.toText(), minter: minterId.toText() };
        const fee = await makeActor(ckbtcMinterIdl, minterId).estimate_withdrawal_fee({ amount: [60_000n] });
        const plan = planMoveToBtc({ amount: 60_000n, balance: before, ledgerFee: 10n, minAmount: 50_000n, fee });
        expect(plan).toMatchObject({ ok: true, approveAmount: 60_010n });
        const store = makeMovesStore(memStorage(), movesKey('mainnet', alice.toText()));
        const record = newWithdrawRecord({ id: 'wpic', network: 'mainnet', pair, plan, amount: 60_000n, ledgerFee: 10n, address: ALICE_ADDR, owner: alice.toText(), now: Date.now() });
        const nowNs = BigInt(Math.round(await pic.getTime())) * 1_000_000n;
        const r = await executeWithdraw({ makeActor, store, record, nowNs });
        expect(r.state).toBe('requested');
        // the approve's fee and the burned amount left the account; the headroom stays approved until it lapses
        expect(await bal()).toBe(before - 10n - 60_000n);
        const left = await actorAs(pic, ledgerIdl, ledgerId, alice).icrc2_allowance({ account: account(alice), spender: account(minterId) });
        expect(left.allowance).toBe(10n);
        expect(left.expires_at[0]).toBe(nowNs + APPROVAL_TTL_NS);
        const t = actorAs(pic, testIdl, minterId, admin);
        await t.test_set_status(r.blockIndex, { Confirmed: { txid: Array.from({ length: 32 }, (_, i) => i) } });
        await refreshWithdraw({ makeActor, store, record: store.load().records[0] });
        expect(store.load().records[0]).toMatchObject({ state: 'confirmed', status: 'Confirmed' });
    });
});
