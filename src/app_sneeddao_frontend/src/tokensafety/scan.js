// Rebuilds the holder table of an ICRC ledger from its block log, in the
// browser. The ledger suite's older `get_blocks` API serves 2000 blocks per
// request from its archives (the ICRC-3 endpoint serves 100), so it is used
// when present, with ICRC-3 as the fallback for other ledgers.
import { IDL } from '@dfinity/candid';
import { Principal } from '@dfinity/principal';
import { encodeIcrcAccount } from '@dfinity/ledger-icrc';
import { actor, withTimeout } from '../health/agent.js';
import { fetchBlocks, createIcrc3Actor } from '../utils/icrc3/client.js';

// The ledger suite's generic value: ICRC-3's Value plus 64-bit numbers.
const Value = IDL.Rec();
Value.fill(IDL.Variant({
    Blob: IDL.Vec(IDL.Nat8), Text: IDL.Text, Nat: IDL.Nat, Nat64: IDL.Nat64, Int: IDL.Int, Int64: IDL.Int64,
    Array: IDL.Vec(Value), Map: IDL.Vec(IDL.Tuple(IDL.Text, Value)),
}));
const GetBlocksArgs = IDL.Record({ start: IDL.Nat, length: IDL.Nat });
const BlockRange = IDL.Record({ blocks: IDL.Vec(Value) });
const legacyIdl = ({ IDL }) => IDL.Service({
    get_blocks: IDL.Func([GetBlocksArgs], [IDL.Record({
        chain_length: IDL.Nat64, certificate: IDL.Opt(IDL.Vec(IDL.Nat8)), first_index: IDL.Nat, blocks: IDL.Vec(Value),
        archived_blocks: IDL.Vec(IDL.Record({ start: IDL.Nat, length: IDL.Nat, callback: IDL.Func([GetBlocksArgs], [BlockRange], ['query']) })),
    })], ['query']),
});
const archiveIdl = (method) => ({ IDL }) => IDL.Service({ [method]: IDL.Func([GetBlocksArgs], [BlockRange], ['query']) });

// The `get_transactions` family (NatLabs-style Motoko ledgers, and the
// ledger suite's older endpoint): typed records instead of generic values.
const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const Transaction = IDL.Record({
    kind: IDL.Text, timestamp: IDL.Nat64,
    index: IDL.Opt(IDL.Nat), // NatLabs ledgers number their records (a plain nat decodes into the opt)
    mint: IDL.Opt(IDL.Record({ to: Account, amount: IDL.Nat, memo: IDL.Opt(IDL.Vec(IDL.Nat8)), created_at_time: IDL.Opt(IDL.Nat64) })),
    burn: IDL.Opt(IDL.Record({ from: Account, amount: IDL.Nat, memo: IDL.Opt(IDL.Vec(IDL.Nat8)), created_at_time: IDL.Opt(IDL.Nat64), spender: IDL.Opt(Account) })),
    transfer: IDL.Opt(IDL.Record({ from: Account, to: Account, amount: IDL.Nat, fee: IDL.Opt(IDL.Nat), memo: IDL.Opt(IDL.Vec(IDL.Nat8)), created_at_time: IDL.Opt(IDL.Nat64), spender: IDL.Opt(Account) })),
    approve: IDL.Opt(IDL.Record({ from: Account, spender: Account, amount: IDL.Nat, fee: IDL.Opt(IDL.Nat), memo: IDL.Opt(IDL.Vec(IDL.Nat8)), created_at_time: IDL.Opt(IDL.Nat64), expected_allowance: IDL.Opt(IDL.Nat), expires_at: IDL.Opt(IDL.Nat64) })),
});
const TxRange = IDL.Record({ transactions: IDL.Vec(Transaction) });
const txIdl = ({ IDL }) => IDL.Service({
    get_total_tx: IDL.Func([], [IDL.Nat], ['query']), // NatLabs ledgers: the only true total
    get_transactions: IDL.Func([GetBlocksArgs], [IDL.Record({
        log_length: IDL.Nat, first_index: IDL.Nat, transactions: IDL.Vec(Transaction),
        archived_transactions: IDL.Vec(IDL.Record({ start: IDL.Nat, length: IDL.Nat, callback: IDL.Func([GetBlocksArgs], [TxRange], ['query']) })),
    })], ['query']),
});
const txArchiveIdl = (method) => ({ IDL }) => IDL.Service({ [method]: IDL.Func([GetBlocksArgs], [TxRange], ['query']) });

/// A typed transaction as the generic block applyBlock understands.
function txToBlock(t, defaultFee) {
    const acct = (a) => ({ Array: [{ Blob: a.owner.toUint8Array() }, ...(a.subaccount?.[0] ? [{ Blob: Uint8Array.from(a.subaccount[0]) }] : [])] });
    const entries = [];
    const x = t.transfer?.[0] || t.mint?.[0] || t.burn?.[0] || t.approve?.[0];
    if (!x) return { Map: [['btype', { Text: t.kind }], ['ts', { Nat64: t.timestamp }], ['tx', { Map: [] }]] };
    entries.push(['amt', { Nat: x.amount }]);
    if (x.from) entries.push(['from', acct(x.from)]);
    if (x.to) entries.push(['to', acct(x.to)]);
    if (t.transfer?.[0] || t.approve?.[0]) entries.push(['fee', { Nat: x.fee?.[0] !== undefined ? x.fee[0] : defaultFee }]);
    return { Map: [['btype', { Text: t.kind }], ['ts', { Nat64: t.timestamp }], ['tx', { Map: entries }]] };
}

// ---- value helpers tolerant of both encodings ----
const kind = (v) => (v ? Object.keys(v)[0] : undefined);
const field = (map, key) => { if (!map || !('Map' in map)) return undefined; const e = map.Map.find(([k]) => k === key); return e ? e[1] : undefined; };
const num = (v) => { const k = kind(v); return k === 'Nat' || k === 'Nat64' || k === 'Int' || k === 'Int64' ? BigInt(v[k]) : undefined; };
const text = (v) => (v && 'Text' in v ? v.Text : undefined);
const isZero = (bytes) => bytes.every((b) => b === 0);

/// "owner" or ICRC-1 textual account for an ICRC-3 account value.
export function accountOf(v) {
    if (!v || !('Array' in v) || v.Array.length === 0) return null;
    const ownerBytes = v.Array[0]?.Blob;
    if (!ownerBytes) return null;
    let owner;
    try { owner = Principal.fromUint8Array(Uint8Array.from(ownerBytes)); } catch { return null; }
    const sub = v.Array[1]?.Blob ? Uint8Array.from(v.Array[1].Blob) : null;
    const subaccount = sub && sub.length === 32 && !isZero(sub) ? sub : null;
    return { owner: owner.toText(), key: encodeIcrcAccount({ owner, subaccount: subaccount || undefined }) };
}

/// Apply one block to the balances. Returns the operation name or null.
export function applyBlock(block, state) {
    const tx = field(block, 'tx');
    const btype = (text(field(block, 'btype')) || text(field(tx, 'op')) || '').toLowerCase(); // NatLabs ledgers shout: "TRANSFER"
    const amt = num(field(tx, 'amt')) ?? 0n;
    const fee = num(field(tx, 'fee')) ?? num(field(block, 'fee')) ?? 0n;
    const ts = num(field(block, 'ts'));
    if (ts !== undefined) { if (state.firstTs === null) state.firstTs = ts; state.lastTs = ts; }
    const from = accountOf(field(tx, 'from'));
    const to = accountOf(field(tx, 'to'));
    // Per-account origin statistics for the distribution-by-origin checks.
    const stat = (acct) => { let st = state.accounts.get(acct.key); if (!st) { st = { owner: acct.owner, firstFrom: null, senders: new Set(), inCount: 0, outCount: 0, firstTs: ts ?? null, lastTs: ts ?? null, received: 0n, sent: 0n }; state.accounts.set(acct.key, st); } if (ts !== undefined) st.lastTs = ts; return st; };
    const noteIn = (acct, fromAcct, amount) => { if (!acct) return; const st = stat(acct); st.inCount += 1; st.received += amount; if (fromAcct) { if (!st.firstFrom) st.firstFrom = fromAcct.key; st.senders.add(fromAcct.owner); } else if (!st.firstFrom) st.firstFrom = 'mint'; };
    const noteOut = (acct, amount) => { if (!acct) return; const st = stat(acct); st.outCount += 1; st.sent += amount; };
    const add = (acct, delta) => {
        if (!acct) return;
        const next = (state.balances.get(acct.key) || 0n) + delta;
        state.balances.set(acct.key, next);
        if (!state.owners.has(acct.key)) state.owners.set(acct.key, acct.owner);
        // An account that goes below zero moved tokens the log never gave it:
        // a balance seeded at genesis outside the log. Remember how deep.
        if (next < 0n && next < (state.deficits.get(acct.key) ?? 0n)) state.deficits.set(acct.key, next);
    };
    // The ledger suite may route fees to a collector: the block names it
    // (`fee_col`) or points at the block that did (`fee_col_block`).
    const feeCol = accountOf(field(block, 'fee_col'));
    if (feeCol) state.feeCollector = feeCol;
    const collect = (f) => { if (f > 0n && (feeCol || field(block, 'fee_col_block') !== undefined) && state.feeCollector) add(state.feeCollector, f); else state.feesBurned += f; };
    switch (btype) {
        case '1xfer': case '2xfer': case 'xfer': case 'transfer':
            add(from, -(amt + fee)); add(to, amt); collect(fee); noteOut(from, amt); noteIn(to, from, amt); state.fees += fee; state.transfers += 1; return 'xfer';
        case '1mint': case 'mint':
            add(to, amt); noteIn(to, null, amt); state.minted += amt; state.mints += 1; state.mintEvents.push({ ts, amt, to: to?.key }); return 'mint';
        case '1burn': case 'burn':
            add(from, -amt); noteOut(from, amt); state.burned += amt; state.burns += 1; return 'burn';
        case '2approve': case 'approve':
            add(from, -fee); collect(fee); state.fees += fee; state.approves += 1; return 'approve';
        default:
            state.unknown += 1; return null;
    }
}

/// The `get_transactions` family, read as a sequential walk rather than by
/// range: NatLabs archives ignore the requested length, page their first
/// bucket by 100 and the rest by 1000, and hold duplicated records with
/// wrapped index labels. Every record carries its own index, so the walk
/// advances by what came back and keeps the first record seen per index.
export async function walkTransactions(txLedger, total, { onProgress, timeoutMs, defaultFee }) {
    const records = new Map();
    const indexOf = (t, fallback) => (t.index?.[0] !== undefined ? Number(t.index[0]) : fallback);
    const put = (i, t) => { if (!records.has(i)) records.set(i, t); };
    const head = await withTimeout(txLedger.get_transactions({ start: 0n, length: 2000n }), timeoutMs, 'get_transactions');
    const archives = new Map();
    let archivedEnd = 0n;
    for (const at of head.archived_transactions) {
        const [id, method] = at.callback;
        archives.set(`${id.toText()}:${method}`, { id, method });
        if (at.start + at.length > archivedEnd) archivedEnd = at.start + at.length;
    }
    for (const { id, method } of archives.values()) {
        const a = await actor(txArchiveIdl(method), id);
        let cursor = 0n;
        for (let guard = 0; guard < 5000; guard++) {
            const r = await withTimeout(a[method]({ start: cursor, length: 2000n }), timeoutMs, 'archive get_transactions');
            if (r.transactions.length === 0) break;
            r.transactions.forEach((t, k) => put(indexOf(t, Number(cursor) + k), t));
            cursor += BigInt(r.transactions.length);
            onProgress?.(Math.min(records.size, total), total);
        }
    }
    // The ledger's own, not yet archived, records: ask from the tail of the
    // log backwards to where the archives end. NatLabs ledgers answer any
    // intersecting request with their whole buffer, labelled; others page.
    let cursor = BigInt(Math.max(Number(archivedEnd), total - 2000, 0));
    const seenArchived = records.size;
    for (let guard = 0; guard < 5000; guard++) {
        const r = await withTimeout(txLedger.get_transactions({ start: cursor, length: 2000n }), timeoutMs, 'get_transactions');
        if (r.transactions.length === 0) break;
        let maxIdx = Number(cursor) - 1;
        r.transactions.forEach((t, k) => { const i = indexOf(t, Number(cursor) + k); put(i, t); if (i > maxIdx) maxIdx = i; });
        onProgress?.(Math.min(records.size, total), total);
        if (r.transactions.length < 2000) break;
        cursor = BigInt(maxIdx + 1);
    }
    // Paged ledgers may hold more than 2000 local records below the tail.
    let low = BigInt(Math.max(Number(archivedEnd), 0));
    const lowest = [...records.keys()].filter((i) => records.size > seenArchived).sort((x, y) => x - y);
    for (let guard = 0; guard < 5000 && low < BigInt(Math.max(total - 2000, 0)); guard++) {
        const r = await withTimeout(txLedger.get_transactions({ start: low, length: 2000n }), timeoutMs, 'get_transactions');
        if (r.transactions.length === 0) break;
        r.transactions.forEach((t, k) => put(indexOf(t, Number(low) + k), t));
        low += BigInt(r.transactions.length);
        onProgress?.(Math.min(records.size, total), total);
    }
    void lowest;
    const indices = [...records.keys()].sort((x, y) => x - y);
    const missing = indices.length ? indices[indices.length - 1] + 1 - indices.length : total;
    // A few lost records (the NatLabs archive overwrites some with duplicates)
    // still leave a usable picture; report them. Many means no picture at all.
    if (missing > Math.max(100, Math.floor(total / 1000))) throw new Error(`the ledger's history has gaps: ${missing.toLocaleString('en-US')} of ${(indices.length + missing).toLocaleString('en-US')} records could not be read`);
    return { blocks: indices.map((i) => txToBlock(records.get(i), defaultFee)), gaps: missing };
}

/// Scan the whole log of `ledgerId` (up to maxBlocks). Reports progress as
/// (blocksDone, total). Returns { skipped, total, mode } when too large.
/** @param {string} ledgerId @param {{ maxBlocks?: number, onProgress?: (done: number, total: number) => void, concurrency?: number, timeoutMs?: number, defaultFee?: bigint }} [options] */
export async function scanLedger(ledgerId, options = {}) {
    const { maxBlocks, onProgress, concurrency = 6, timeoutMs = 60000, defaultFee = 0n } = options;
    const ledger = await actor(legacyIdl, ledgerId);
    const txLedger = await actor(txIdl, ledgerId);
    let total = null; let mode = 'legacy';
    try {
        const head = await withTimeout(ledger.get_blocks({ start: 0n, length: 0n }), timeoutMs, 'get_blocks');
        total = Number(head.chain_length);
    } catch {
        try {
            mode = 'icrc3';
            const a = await createIcrc3Actor(Principal.fromText(ledgerId));
            const head = await withTimeout(a.icrc3_get_blocks([]), timeoutMs, 'icrc3_get_blocks');
            total = Number(head.log_length);
        } catch (e3) {
            mode = 'transactions';
            let head;
            try { head = await withTimeout(txLedger.get_transactions({ start: 0n, length: 0n }), timeoutMs, 'get_transactions'); }
            catch { throw new Error('the ledger exposes none of get_blocks, icrc3_get_blocks or get_transactions, so its history cannot be read'); }
            // NatLabs ledgers answer log_length with the requested range's
            // length; their get_total_tx has the real figure.
            const natlabs = await withTimeout(txLedger.get_total_tx(), timeoutMs, 'get_total_tx').catch(() => null);
            total = natlabs !== null ? Number(natlabs) : Number(head.log_length);
        }
    }
    if (maxBlocks !== undefined && total > maxBlocks) return { skipped: true, total, mode };

    const state = { balances: new Map(), owners: new Map(), accounts: new Map(), deficits: new Map(), rawFinal: new Map(), feeCollector: null, feesBurned: 0n, netSupply: 0n, gaps: 0, firstTs: null, lastTs: null, minted: 0n, burned: 0n, fees: 0n, mints: 0, burns: 0, transfers: 0, approves: 0, unknown: 0, mintEvents: [], total, mode };
    if (mode === 'transactions') {
        const { blocks, gaps } = await walkTransactions(txLedger, total, { onProgress, timeoutMs, defaultFee });
        state.total = blocks.length + gaps;
        state.gaps = gaps;
        for (const b of blocks) applyBlock(b, state);
        for (const v of state.balances.values()) state.netSupply += v;
        finish(state);
        return state;
    }
    const CHUNK = mode === 'icrc3' ? 100 : 2000;
    const chunks = []; for (let s = 0; s < total; s += CHUNK) chunks.push([s, Math.min(CHUNK, total - s)]);
    const results = new Array(chunks.length); // blocks per chunk, in order
    let next = 0; let done = 0;
    const archives = new Map();
    const archiveActor = async (id, method) => { const key = `${id.toText()}:${method}`; if (!archives.has(key)) archives.set(key, await actor(archiveIdl(method), id)); return archives.get(key); };

    const fetchLegacy = async (start, length) => {
        const r = await withTimeout(ledger.get_blocks({ start: BigInt(start), length: BigInt(length) }), timeoutMs, 'get_blocks');
        const out = []; // [index, block]
        let i = Number(r.first_index);
        for (const b of r.blocks) out.push([i++, b]);
        for (const ab of r.archived_blocks) {
            const [id, method] = ab.callback;
            const a = await archiveActor(id, method);
            let s = ab.start; const end = ab.start + ab.length;
            for (let guard = 0; guard < 50 && s < end; guard++) {
                const br = await withTimeout(a[method]({ start: s, length: end - s }), timeoutMs, 'archive get_blocks');
                if (br.blocks.length === 0) break;
                let j = Number(s);
                for (const b of br.blocks) out.push([j++, b]);
                s += BigInt(br.blocks.length);
            }
        }
        return out.sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    };
    const fetchIcrc3 = async (start, length) => (await fetchBlocks(Principal.fromText(ledgerId), start, length)).map((b) => b.block);
    const worker = async () => {
        while (next < chunks.length) {
            const i = next++;
            const [start, length] = chunks[i];
            let blocks = null; let lastErr = null;
            for (let attempt = 0; attempt < 3 && !blocks; attempt++) {
                try { blocks = mode === 'legacy' ? await fetchLegacy(start, length) : await fetchIcrc3(start, length); } catch (e) { lastErr = e; }
            }
            if (!blocks) throw lastErr || new Error(`Could not fetch blocks ${start}..${start + length}`);
            if (blocks.length !== length) throw new Error(`Ledger served ${blocks.length} of ${length} blocks at ${start}`);
            results[i] = blocks;
            done += length;
            onProgress?.(done, total);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
    // apply in log order so first/last timestamps are right
    for (const blocks of results) for (const b of blocks) applyBlock(b, state);
    // What the log accounts for: mints minus burns and burned fees. Any
    // reported supply above this was created outside the log.
    for (const v of state.balances.values()) state.netSupply += v;
    finish(state);
    return state;
}

/// Keep the final log-derived balance of every account that went negative
/// (its genesis balance is its real balance minus this), then drop the
/// non-positive entries from the holder table.
function finish(state) {
    state.rawFinal = new Map();
    for (const k of state.deficits.keys()) state.rawFinal.set(k, state.balances.get(k) ?? 0n);
    for (const [k, v] of [...state.balances]) if (v <= 0n) state.balances.delete(k);
}

/// Aggregate account balances by owner principal, largest first.
export function holdersByOwner(state) {
    const byOwner = new Map();
    for (const [key, bal] of state.balances) {
        const owner = state.owners.get(key) || key;
        byOwner.set(owner, (byOwner.get(owner) || 0n) + bal);
    }
    return [...byOwner.entries()].sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0)).map(([owner, balance]) => ({ owner, balance }));
}
