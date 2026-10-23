// TransactionList's CSV export (src/app_sneeddao_frontend/src/utils/txCsv.js). The old inline
// export divided every amount by 1e8 whatever the token's decimals (ckUSDC has 6, ckETH 18),
// wrote locale-formatted numbers and times, joined memo bytes as decimal numbers, and left the
// block index empty for rows read from the ledger (and for block 0).
import { describe, it, expect } from 'vitest';
import { Principal } from '@dfinity/principal';
import { encodeIcrcAccount } from '@dfinity/ledger-icrc';
import { transactionsToCsv, formatDecimal, csvCell, CSV_HEADERS } from '../../../src/app_sneeddao_frontend/src/utils/txCsv.js';

const alice = Principal.fromText('aaaaa-aa');
const bob = Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai');
const sub = new Uint8Array(32); sub[31] = 7;
const TS = 1_700_000_000_000_000_000n; // 2023-11-14T22:13:20Z in ns

const transfer = (amount, extra = {}) => ({
    kind: 'transfer', timestamp: TS, mint: [], burn: [], approve: [],
    transfer: [{ from: { owner: alice, subaccount: [] }, to: { owner: bob, subaccount: [sub] }, amount, fee: [10_000n], memo: [], created_at_time: [], spender: [], ...extra }],
});
const rows = (csv) => csv.trim().split(/\r?\n/).map((l) => l.split(','));

describe('transaction CSV export', () => {
    it('writes the header row', () => {
        expect(rows(transactionsToCsv([], {}))[0]).toEqual(CSV_HEADERS);
    });

    it("uses the token's decimals, exactly", () => {
        const csv = transactionsToCsv([{ id: 5n, transaction: transfer(1_500_000n) }], { decimals: 6, symbol: 'ckUSDC', ledger: 'xevnm-gaaaa-aaaar-qafnq-cai' });
        const r = rows(csv)[1];
        expect(r[3]).toBe('1.5');
        expect(r[4]).toBe('0.01');
        expect(formatDecimal(123456789012345678901234n, 18)).toBe('123456.789012345678901234');
        expect(formatDecimal(0n, 8)).toBe('0');
    });

    it('writes ISO times, ICRC-1 accounts, hex memos and the ledger', () => {
        const tx = transfer(100_000_000n, { memo: [[0xde, 0xad, 0xbe, 0xef]] });
        const r = rows(transactionsToCsv([{ id: 9n, transaction: tx }], { decimals: 8, symbol: 'SNEED', ledger: 'hvgxa-wqaaa-aaaaq-aacia-cai' }))[1];
        expect(r[0]).toBe('2023-11-14T22:13:20.000Z');
        expect(r[1]).toBe('transfer');
        expect(r[2]).toBe('SNEED');
        expect(r[5]).toBe('aaaaa-aa');
        expect(r[6]).toBe(encodeIcrcAccount({ owner: bob, subaccount: sub }));
        expect(r[7]).toBe('deadbeef');
        expect(r[8]).toBe('9');
        expect(r[9]).toBe('hvgxa-wqaaa-aaaaq-aacia-cai');
    });

    it('fills the block index for ledger rows and for block 0', () => {
        const csv = transactionsToCsv([{ ...transfer(1n), txIndex: 42 }, { id: 0n, transaction: transfer(1n) }], { decimals: 8 });
        expect(rows(csv)[1][8]).toBe('42');
        expect(rows(csv)[2][8]).toBe('0');
    });

    it('escapes cells and defuses spreadsheet formulas', () => {
        expect(csvCell('a,"b"')).toBe('"a,""b"""');
        expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
        expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
        expect(csvCell('-1.5')).toBe('-1.5');
    });
});
