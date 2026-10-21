// State-machine tests for src/utils/cyclesTopUp.js with a mocked ICP ledger and CMC.
//   node --test scripts/cyclesTopUp.test.mjs                    (new helper: all pass)
//   TOPUP_IMPL=legacy node --test --test-name-pattern=regression scripts/cyclesTopUp.test.mjs
//                                                               (old inline flow: regressions fail)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Principal } from '@dfinity/principal';
import { principalToSubAccount } from '@dfinity/utils';
import * as helper from '../src/utils/cyclesTopUp.js';

const legacy = process.env.TOPUP_IMPL === 'legacy';
const impl = legacy ? await import('./fixtures/legacyTopUp.mjs') : helper;
const { loadPendingTopUps, getPendingTopUp, finishPendingTopUp, renotifyTopUp, describeTopUpResult, cyclesOrThrow, STORAGE_KEY, TOP_UP_MEMO } = helper;

const CANISTER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const CMC = 'rkp4c-7iaaa-aaaaa-aaaca-cai';
const USER = '2vxsx-fae';

function memStorage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

/** ICP ledger mock: dedupes on identical args when created_at_time is set, like the real one. */
function mockLedger({ ledgerTimeNs = null } = {}) {
    const seen = new Map();
    const l = {
        transfers: [], // applied debits
        calls: 0,
        nextBlock: 1000n,
        script: [], // per-call overrides: 'throw-after-apply' | 'throw' | {Err}
        async icrc1_transfer(args) {
            l.calls++;
            const step = l.script.shift();
            if (step && step !== 'throw-after-apply' && step !== 'throw') return step;
            if (step === 'throw') throw new Error('network down');
            const cat = args.created_at_time[0];
            if (ledgerTimeNs != null && cat != null && cat > ledgerTimeNs + 60_000_000_000n) {
                return { Err: { CreatedInFuture: { ledger_time: ledgerTimeNs } } };
            }
            const key = cat != null ? JSON.stringify(args, (_, x) => (typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? Array.from(x) : x)) : null;
            if (key && seen.has(key)) return { Err: { Duplicate: { duplicate_of: seen.get(key) } } };
            const block = l.nextBlock++;
            l.transfers.push({ args, block });
            if (key) seen.set(key, block);
            if (step === 'throw-after-apply') throw new Error('reply lost');
            return { Ok: block };
        },
    };
    return l;
}

/** CMC mock: answers from a script; default Ok(1T). Records every notify. */
function mockCmc(script = [], onNotify = () => {}) {
    const c = {
        notifies: [],
        async notify_top_up(arg) {
            c.notifies.push(arg);
            onNotify(arg);
            const step = script.length ? script.shift() : { Ok: 1_000_000_000_000n };
            if (step === 'throw') throw new Error('CMC unreachable');
            return step;
        },
    };
    return c;
}

const run = (o) => impl.topUpCanisterWithIcp({ canisterId: CANISTER, amountE8s: 50_000_000n, owner: USER, processingRetries: 0, sleep: async () => {}, now: () => 1_760_000_000_000, ...o });
const swallow = async (p) => { try { return await p; } catch (e) { return { thrown: e }; } };

// ------------------------------------------------------------- regressions (fail on old code)

test('regression: retry after a failed notify sends no second transfer and re-notifies the same block', async () => {
    const storage = memStorage();
    const ledger = mockLedger();
    const cmc = mockCmc(['throw']); // first notify fails, second succeeds
    await swallow(run({ ledger, cmc, storage }));
    const second = await swallow(run({ ledger, cmc, storage }));
    assert.equal(ledger.transfers.length, 1, 'only one ICP transfer may land');
    assert.equal(cmc.notifies.length, 2);
    assert.equal(cmc.notifies[1].block_index, cmc.notifies[0].block_index);
    assert.equal(second.status, 'ok');
    assert.equal(second.resumed, true);
});

test('regression: retry after the transfer reply was lost does not pay twice', async () => {
    const storage = memStorage();
    const ledger = mockLedger();
    ledger.script = ['throw-after-apply'];
    const cmc = mockCmc();
    await swallow(run({ ledger, cmc, storage }));
    const second = await swallow(run({ ledger, cmc, storage }));
    assert.equal(ledger.transfers.length, 1, 'the resend must be deduplicated');
    assert.equal(second.status, 'ok');
    assert.equal(cmc.notifies[0].block_index, 1000n);
});

test('regression: the block index is persisted before notify_top_up is called', async () => {
    const storage = memStorage();
    const ledger = mockLedger();
    let seen = null;
    const cmc = mockCmc([], () => { seen = JSON.parse(storage.getItem(STORAGE_KEY) || '{}')[CANISTER]; });
    await swallow(run({ ledger, cmc, storage }));
    assert.ok(seen, 'a pending record exists while notifying');
    assert.equal(seen.blockIndex, '1000');
    assert.equal(seen.amountE8s, '50000000');
});

test('regression: transfer sets created_at_time and the TPUP memo to the CMC subaccount', async () => {
    const storage = memStorage();
    const ledger = mockLedger();
    await swallow(run({ ledger, cmc: mockCmc(), storage }));
    const a = ledger.transfers[0].args;
    assert.equal(a.created_at_time.length, 1, 'created_at_time must be set for dedupe');
    assert.equal(a.created_at_time[0], 1_760_000_000_000n * 1_000_000n);
    assert.deepEqual(Array.from(a.memo[0]), Array.from(TOP_UP_MEMO));
    assert.equal(a.to.owner.toText(), CMC);
    assert.deepEqual(Array.from(a.to.subaccount[0]), Array.from(principalToSubAccount(Principal.fromText(CANISTER))));
});

// ------------------------------------------------------------- helper state machine

test('happy path: one transfer, one notify, record removed', async () => {
    const storage = memStorage();
    const r = await run({ ledger: mockLedger(), cmc: mockCmc(), storage });
    assert.equal(r.status, 'ok');
    assert.equal(r.cycles, 1_000_000_000_000n);
    assert.equal(r.blockIndex, 1000n);
    assert.equal(cyclesOrThrow(r), 1e12);
    assert.equal(loadPendingTopUps(storage).length, 0);
});

test('Processing keeps the record; finishPendingTopUp later completes it', async () => {
    const storage = memStorage();
    const ledger = mockLedger();
    const cmc = mockCmc([{ Err: { Processing: null } }]);
    const r = await run({ ledger, cmc, storage });
    assert.equal(r.status, 'processing');
    assert.equal(r.final, false);
    assert.throws(() => cyclesOrThrow(r), /still processing/);
    assert.equal(getPendingTopUp(CANISTER, storage).blockIndex, '1000');
    const f = await finishPendingTopUp({ ledger, cmc, canisterId: CANISTER, owner: USER, storage, processingRetries: 0 });
    assert.equal(f.status, 'ok');
    assert.equal(ledger.transfers.length, 1);
    assert.equal(loadPendingTopUps(storage).length, 0);
});

test('Processing is retried in place before giving up', async () => {
    const storage = memStorage();
    const cmc = mockCmc([{ Err: { Processing: null } }, { Err: { Processing: null } }]);
    const r = await impl.topUpCanisterWithIcp({ ledger: mockLedger(), cmc, canisterId: CANISTER, amountE8s: 1n, storage, processingRetries: 2, sleep: async () => {} });
    assert.equal(r.status, 'ok');
    assert.equal(cmc.notifies.length, 3);
});

test('Refunded is final and surfaces the refund block', async () => {
    const storage = memStorage();
    const r = await run({ ledger: mockLedger(), cmc: mockCmc([{ Err: { Refunded: { reason: 'canister gone', block_index: [77n] } } }]), storage });
    assert.equal(r.status, 'refunded');
    assert.equal(r.refundBlock, 77n);
    assert.match(describeTopUpResult(r), /block 77/);
    assert.equal(loadPendingTopUps(storage).length, 0);
});

test('InvalidTransaction and TransactionTooOld are final; Other is kept', async () => {
    for (const [err, status, kept] of [
        [{ InvalidTransaction: 'bad memo' }, 'invalid', false],
        [{ TransactionTooOld: 5n }, 'too_old', false],
        [{ Other: { error_code: 3n, error_message: 'busy' } }, 'other', true],
    ]) {
        const storage = memStorage();
        const r = await run({ ledger: mockLedger(), cmc: mockCmc([{ Err: err }]), storage });
        assert.equal(r.status, status);
        assert.equal(!!getPendingTopUp(CANISTER, storage), kept, status);
    }
});

test('a definite transfer error removes the record and never notifies', async () => {
    const storage = memStorage();
    const ledger = mockLedger();
    ledger.script = [{ Err: { InsufficientFunds: { balance: 5_000_000n } } }];
    const cmc = mockCmc();
    const r = await run({ ledger, cmc, storage });
    assert.equal(r.status, 'transfer_failed');
    assert.match(r.reason, /Insufficient funds: 0.05/);
    assert.equal(cmc.notifies.length, 0);
    assert.equal(loadPendingTopUps(storage).length, 0);
});

test('a transfer that throws before landing is kept; the retry sends it once', async () => {
    const storage = memStorage();
    const ledger = mockLedger();
    ledger.script = ['throw'];
    const cmc = mockCmc();
    const r1 = await run({ ledger, cmc, storage });
    assert.equal(r1.status, 'transfer_unknown');
    assert.equal(getPendingTopUp(CANISTER, storage).blockIndex, null);
    const r2 = await run({ ledger, cmc, storage, amountE8s: 999n });
    assert.equal(r2.status, 'ok');
    assert.equal(ledger.transfers.length, 1);
    assert.equal(ledger.transfers[0].args.amount, 50_000_000n, 'the pending amount is used, not the new one');
});

test('CreatedInFuture (fast client clock) retries with the ledger time', async () => {
    const storage = memStorage();
    const ledger = mockLedger({ ledgerTimeNs: 1_700_000_000_000_000_000n });
    const r = await run({ ledger, cmc: mockCmc(), storage });
    assert.equal(r.status, 'ok');
    assert.equal(ledger.transfers[0].args.created_at_time[0], 1_700_000_000_000_000_000n);
});

test('another login never resends a block-less pending transfer', async () => {
    const storage = memStorage();
    const ledger = mockLedger();
    ledger.script = ['throw'];
    await run({ ledger, cmc: mockCmc(), storage });
    const r = await run({ ledger, cmc: mockCmc(), storage, owner: 'aaaaa-aa' });
    assert.equal(r.status, 'needs_owner');
    assert.equal(ledger.calls, 1);
});

test('renotifyTopUp notifies any block and clears a matching pending record', async () => {
    const storage = memStorage();
    const cmc = mockCmc(['throw']);
    await run({ ledger: mockLedger(), cmc, storage });
    const r = await renotifyTopUp({ cmc, canisterId: ` ${CANISTER} `, blockIndex: ' 1000 ', storage });
    assert.equal(r.status, 'ok');
    assert.equal(cmc.notifies[1].block_index, 1000n);
    assert.equal(loadPendingTopUps(storage).length, 0);
});

test('broken storage does not break the top-up', async () => {
    const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    const r = await run({ ledger: mockLedger(), cmc: mockCmc(), storage: bad });
    assert.equal(r.status, 'ok');
});
