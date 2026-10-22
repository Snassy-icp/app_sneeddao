// Tests for src/utils/icrcTx.js (created_at_time + safe retry on every ICRC transfer/approve)
// and src/utils/stakeJournal.js, with a mocked ledger that dedupes like the real one.
//   node --test scripts/icrcTx.test.mjs
//   TX_IMPL=legacy node --test scripts/icrcTx.test.mjs   (the old direct call: the regressions fail)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as tx from '../src/utils/icrcTx.js';

const legacy = process.env.TX_IMPL === 'legacy';
// The old code: `await ledger.icrc1_transfer(args)` with created_at_time: [], retried by hand.
const icrc1Transfer = legacy
    ? async (l, a) => { try { return await l.icrc1_transfer(a); } catch (_) { return l.icrc1_transfer(a); } }
    : tx.icrc1Transfer;

/** ICRC-1 ledger mock. `failReplyOnce`: apply the first call, then throw (reply lost). */
const ICP = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const SNS_LEDGER = 'hvgxa-wqaaa-aaaaq-aacia-cai';
const CUSTOM = 'aaaaa-aa';

function mockLedger({ ledgerTimeNs = null, failReplyOnce = false, ledgerId = ICP } = {}) {
    const seen = new Map();
    let failed = false;
    const l = {
        ledgerId, calls: 0,
        debits: [], next: 1n,
        async icrc1_transfer(a) {
            l.calls++;
            const now = ledgerTimeNs ?? BigInt(Date.now()) * 1_000_000n;
            const t = a.created_at_time?.[0];
            if (t != null) {
                if (t > now + 60_000_000_000n) return { Err: { CreatedInFuture: { ledger_time: now } } };
                if (t < now - 86_400_000_000_000n) return { Err: { TooOld: null } };
                const key = JSON.stringify(a, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
                if (seen.has(key)) return { Err: { Duplicate: { duplicate_of: seen.get(key) } } };
                seen.set(key, l.next);
            }
            const b = l.next++;
            l.debits.push({ amount: a.amount, block: b, t });
            if (failReplyOnce && !failed) { failed = true; throw new Error('network: reply lost'); }
            return { Ok: b };
        },
    };
    return l;
}

const args = () => ({ to: { owner: 'x', subaccount: [] }, amount: 5n, fee: [], memo: [], from_subaccount: [], created_at_time: [] });

test('regression: unknown ledger + lost reply: no second call, outcome-unknown error tells the user to check', async () => {
    const l = mockLedger({ failReplyOnce: true, ledgerId: CUSTOM });
    let err = null;
    try { await icrc1Transfer(l, args()); } catch (e) { err = e; }
    assert.equal(l.calls, 1, 'resent on a ledger not known to dedupe');
    assert.ok(err, 'no error for an unknown outcome');
    assert.equal(err.code, 'OUTCOME_UNKNOWN');
    assert.match(err.message, /Check your balance/);
});

test('an SNS ledger counts as deduping once SnsUtils registered the resolver; unknown before', async () => {
    tx.setDedupingLedgerResolver(null);
    assert.equal(tx.ledgerDedupes(SNS_LEDGER), false);
    tx.setDedupingLedgerResolver((id) => id === SNS_LEDGER);
    assert.equal(tx.ledgerDedupes(SNS_LEDGER), true);
    assert.equal(tx.ledgerDedupes(CUSTOM), false);
    assert.equal(tx.ledgerDedupes(ICP), true);
    assert.equal(tx.ledgerDedupes('mxzaz-hqaaa-aaaar-qaada-cai'), true); // ckBTC
    const l = mockLedger({ failReplyOnce: true, ledgerId: SNS_LEDGER });
    assert.deepEqual(await tx.icrc1Transfer(l, args()), { Ok: 1n });
    assert.equal(l.debits.length, 1);
    tx.setDedupingLedgerResolver(null);
});

test('a deduping ledger whose resend also throws: outcome-unknown error, still one debit', async () => {
    let calls = 0;
    const l = { ledgerId: ICP, async icrc1_transfer() { calls++; throw new Error('down'); } };
    await assert.rejects(tx.icrc1Transfer(l, args()), (e) => e.code === 'OUTCOME_UNKNOWN');
    assert.equal(calls, 2);
});

test('regression: a lost reply followed by a retry pays once, and the block comes back', async () => {
    const l = mockLedger({ failReplyOnce: true });
    const r = await icrc1Transfer(l, args());
    assert.equal(l.debits.length, 1, 'paid twice');
    assert.deepEqual(r, { Ok: 1n });
});

test('regression: created_at_time is set on the transfer', async () => {
    const l = mockLedger();
    await icrc1Transfer(l, args());
    assert.ok(l.debits[0].t != null, 'no created_at_time');
});

test('the caller args object is not changed', async () => {
    const a = args();
    await tx.icrc1Transfer(mockLedger(), a);
    assert.deepEqual(a.created_at_time, []);
});

test('our clock ahead of the ledger: resent with the ledger time, paid once', async () => {
    const l = mockLedger({ ledgerTimeNs: BigInt(Date.now() - 3_600_000) * 1_000_000n });
    const r = await tx.icrc1Transfer(l, args());
    assert.ok('Ok' in r);
    assert.equal(l.debits.length, 1);
});

test('our clock a day behind: resent without a time, paid once', async () => {
    const l = mockLedger({ ledgerTimeNs: BigInt(Date.now() + 2 * 86_400_000) * 1_000_000n });
    const r = await tx.icrc1Transfer(l, args());
    assert.ok('Ok' in r);
    assert.equal(l.debits.length, 1);
});

test('a caller-chosen created_at_time is kept and its Duplicate is answered as Ok', async () => {
    const l = mockLedger();
    const a = { ...args(), created_at_time: [BigInt(Date.now()) * 1_000_000n] };
    const r1 = await tx.icrc1Transfer(l, a);
    const r2 = await tx.icrc1Transfer(l, a);
    assert.deepEqual(r1, r2);
    assert.equal(l.debits.length, 1);
});

test('ledger errors are passed through', async () => {
    const l = { async icrc1_transfer() { return { Err: { InsufficientFunds: { balance: 1n } } }; } };
    assert.deepEqual(await tx.icrc1Transfer(l, args()), { Err: { InsufficientFunds: { balance: 1n } } });
});

test('legacy ICP transfer gets { timestamp_nanos } and TxDuplicate becomes Ok', async () => {
    let seenArg = null;
    const l = { ledgerId: ICP, async transfer(a) { seenArg = a; return { Err: { TxDuplicate: { duplicate_of: 9n } } }; } };
    const r = await tx.icpLegacyTransfer(l, { to: [], fee: { e8s: 1n }, memo: 0n, from_subaccount: [], created_at_time: [], amount: { e8s: 1n } });
    assert.ok(typeof seenArg.created_at_time[0].timestamp_nanos === 'bigint');
    assert.deepEqual(r, { Ok: 9n });
});

test('approval expiry helper is about an hour ahead', () => {
    const [ns] = tx.expiresInMs();
    const ms = Number(ns / 1_000_000n) - Date.now();
    assert.ok(ms > 3_590_000 && ms <= 3_600_000);
});

test('stake journal: entry before transfer, block after, removed after claim', async () => {
    const m = new Map();
    globalThis.window = {
        localStorage: { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) },
        dispatchEvent: () => true,
    };
    globalThis.Event = globalThis.Event || class { constructor(t) { this.type = t; } };
    const j = await import('../src/utils/stakeJournal.js');
    const id = j.journalStake({ kind: 'sns', ledger: 'L', governance: 'G', memo: 7, subaccount: new Uint8Array([1, 255]), amount: 10n, owner: 'P' });
    assert.equal(j.loadPendingStakes().length, 1);
    j.updateStake(id, { block: 42n });
    const [rec] = j.loadPendingStakes();
    assert.equal(rec.block, '42');
    assert.equal(rec.subaccount, '01ff');
    assert.equal(rec.memo, '7');
    assert.deepEqual(Array.from(j.hexToBytes(rec.subaccount)), [1, 255]);
    j.removeStake(id);
    assert.equal(j.loadPendingStakes().length, 0);
    m.set(j.STAKE_JOURNAL_KEY, 'not json');
    assert.deepEqual(j.loadPendingStakes(), []);
});
