// CSV export of ledger transactions (TransactionList's "Export CSV"). Pure, so it can be tested.
//
//   transactionsToCsv(txs, { decimals, symbol, ledger }) -> CSV text (RFC 4180, CRLF)
//
// Takes rows as TransactionList holds them: from the index ({ id, transaction: {...} }) or from the
// ledger ({ txIndex, kind, timestamp, transfer: [...] , ... }). Columns: time (ISO 8601, UTC),
// type, token, amount and fee (exact decimals in whole tokens, never masked), from, to (ICRC-1
// textual accounts, subaccount included), memo (hex), block index, ledger.
import { encodeIcrcAccount } from '@dfinity/ledger-icrc';

export const CSV_HEADERS = ['time', 'type', 'token', 'amount', 'fee', 'from', 'to', 'memo', 'block_index', 'ledger'];

const opt = (v) => (Array.isArray(v) ? v[0] : v);

/** Base units -> exact decimal string, no grouping ("1234.5", "0.000001"). */
export function formatDecimal(amount, decimals) {
    if (amount == null) return '';
    let v = BigInt(amount);
    const neg = v < 0n;
    if (neg) v = -v;
    const d = BigInt(Math.max(0, Number(decimals) || 0));
    const div = 10n ** d;
    const int = (v / div).toString();
    const frac = d > 0n ? (v % div).toString().padStart(Number(d), '0').replace(/0+$/, '') : '';
    return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

const toHex = (bytes) => Array.from(bytes || [], (b) => Number(b).toString(16).padStart(2, '0')).join('');

function accountText(acc) {
    if (!acc?.owner) return '';
    const sub = opt(acc.subaccount);
    try {
        return encodeIcrcAccount({ owner: acc.owner, subaccount: sub && sub.length ? new Uint8Array(sub) : undefined });
    } catch {
        return acc.owner.toString();
    }
}

function isoTime(ns) {
    if (ns == null || ns === '') return '';
    try { return new Date(Number(BigInt(ns) / 1_000_000n)).toISOString(); } catch { return ''; }
}

/** One transaction -> the CSV columns, as strings. */
export function txToCsvRow(tx, { decimals = 8, symbol = '', ledger = '' } = {}) {
    const t = tx?.transaction || tx || {};
    const kind = t.kind || Object.keys(t).find((k) => ['transfer', 'mint', 'burn', 'approve'].includes(k) && opt(t[k])) || 'unknown';
    const op = opt(t.transfer) || opt(t.mint) || opt(t.burn) || opt(t.approve) || {};
    const from = opt(t.transfer)?.from || opt(t.burn)?.from || opt(t.approve)?.from;
    const to = opt(t.transfer)?.to || opt(t.mint)?.to || opt(t.approve)?.spender;
    const fee = opt(op.fee);
    const memo = opt(op.memo);
    const index = tx?.id ?? tx?.txIndex;
    return [
        isoTime(t.timestamp ?? tx?.timestamp),
        kind,
        symbol || '',
        op.amount != null ? formatDecimal(op.amount, decimals) : '',
        fee != null ? formatDecimal(fee, decimals) : '',
        accountText(from),
        accountText(to),
        memo && memo.length ? toHex(memo) : '',
        index != null ? String(index) : '',
        ledger || '',
    ];
}

/** Quote a cell when needed; a text cell that a spreadsheet would run as a formula gets a leading '. */
export function csvCell(value) {
    let s = value == null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function transactionsToCsv(txs, opts) {
    const lines = [CSV_HEADERS, ...(txs || []).map((tx) => txToCsvRow(tx, opts))];
    return lines.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Hand the CSV to the browser as a download. */
export function downloadCsv(csv, filename) {
    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
