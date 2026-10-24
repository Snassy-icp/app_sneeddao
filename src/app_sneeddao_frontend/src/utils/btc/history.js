// Native Bitcoin history, v1 (spec/sneed_wallet.md §5.6). The IC Bitcoin canister has no history
// API, so history is built from:
//   1. our own send log (utils/btc/pending.js records): complete for what Sneed Wallet did;
//   2. receives: every UTXO not created by one of our sends is "received at height h". Receives
//      are remembered in this browser (localStorage, per network and principal), so they stay
//      listed after they are spent.
// 3. explorer history (phase A4, Advanced, opt-in): mempool.space's address API. It tells
//    mempool.space which address the user looks up, so the page asks once (remembered per browser,
//    EXPLORER_OK_KEY) and never calls it before that; after the yes it is fetched only when the
//    Activity tab is open. Pure apart from the storage helpers and the fetch (fetchImpl injected).
export const RECEIVES_MAX = 500;
export const receivesKey = (network, principal) => `sneed_btc_receives_v1:${network}:${String(principal)}`;

export function loadReceives(storage, key) {
    try {
        const v = JSON.parse(storage?.getItem(key) || '[]');
        return Array.isArray(v) ? v : [];
    } catch { return []; }
}

export function saveReceives(storage, key, list) {
    try { storage?.setItem(key, JSON.stringify(list.slice(0, RECEIVES_MAX))); } catch { /* storage blocked */ }
}

/// Our own txids (sent or expected), so their change outputs are not counted as receives.
export function ownTxids(records) {
    const s = new Set();
    for (const r of records) { if (r.txid) s.add(r.txid); if (r.expectedTxid) s.add(r.expectedTxid); }
    return s;
}

/// Merge the remembered receives with the current UTXOs. Returns the new list (newest first).
export function mergeReceives(prev, utxos, own) {
    const byKey = new Map(prev.filter((x) => !own.has(x.txid)).map((x) => [`${x.txid}:${x.vout}`, x]));
    for (const u of utxos) {
        if (own.has(u.txid)) continue;
        const k = `${u.txid}:${u.vout}`;
        byKey.set(k, { txid: u.txid, vout: u.vout, value: String(u.value), height: u.height });
    }
    return [...byKey.values()].sort((a, b) => (b.height - a.height) || (a.txid < b.txid ? -1 : 1));
}

/// The Activity view's two lists, newest first: { sends, receives }. (A mixed timeline needs block
/// times, which the Bitcoin canister's UTXO answer does not carry.)
///   records   pending.js records
///   receives  mergeReceives output
///   tipHeight to show confirmations; unspent = current outpoint keys, to flag spent receives
export function buildHistory({ records, receives, tipHeight = null, unspent = new Set() }) {
    const sends = records
        .map((r) => ({ kind: r.kind || 'send', id: r.id, at: r.createdAt, state: r.state, txid: r.txid || r.expectedTxid, amount: BigInt(r.amount || 0), fee: BigInt(r.fee || 0), to: r.request?.outputs?.[0]?.address, record: r }))
        .sort((a, b) => b.at - a.at);
    const recv = receives
        .map((x) => ({
            kind: 'receive', id: `${x.txid}:${x.vout}`, height: x.height, txid: x.txid, vout: x.vout, amount: BigInt(x.value),
            confirmations: tipHeight != null && x.height <= tipHeight ? tipHeight - x.height + 1 : null,
            spent: !unspent.has(`${x.txid}:${x.vout}`),
        }))
        .sort((a, b) => b.height - a.height);
    return { sends, receives: recv };
}

/// Opt-in only (a user click; it tells mempool.space this txid): { seen, confirmed } or { error }.
export async function checkTxOnMempool(network, txid, { fetchImpl = (typeof fetch !== 'undefined' ? fetch : null) } = {}) {
    const base = { mainnet: 'https://mempool.space/api', testnet: 'https://mempool.space/testnet4/api' }[network];
    if (!base || !fetchImpl || !/^[0-9a-f]{64}$/.test(txid)) return { error: 'Not available' };
    try {
        // /tx/<id>/status answers {confirmed:false} even for unknown txids; /tx/<id> gives 404 for them
        const res = await fetchImpl(`${base}/tx/${txid}`, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
        if (res.status === 404) return { seen: false, confirmed: false };
        if (!res.ok) return { error: `mempool.space answered ${res.status}` };
        const j = await res.json();
        return { seen: true, confirmed: Boolean(j?.status?.confirmed) };
    } catch (e) {
        return { error: `Couldn't reach mempool.space (${e?.message || e})` };
    }
}

// ---------------------------------------------------------------- explorer history (opt-in, A4)

export const MEMPOOL_BASE = Object.freeze({ mainnet: 'https://mempool.space/api', testnet: 'https://mempool.space/testnet4/api' });
/// The user agreed (once, per browser) that Activity may ask mempool.space for this address's history.
export const EXPLORER_OK_KEY = 'sneed_btc_explorer_history_ok_v1';
export function explorerHistoryAllowed(storage) {
    try { return storage?.getItem(EXPLORER_OK_KEY) === '1'; } catch { return false; }
}
export function setExplorerHistoryAllowed(on, storage) {
    try { if (on) storage?.setItem(EXPLORER_OK_KEY, '1'); else storage?.removeItem(EXPLORER_OK_KEY); } catch { /* storage blocked: asked again next time */ }
}

/// One mempool.space transaction as seen from `address`: { txid, net (sats, + in / − out), fee,
/// confirmed, height, time }. Values that are not finite non-negative integers make it null (the
/// answer is third-party data).
export function parseExplorerTx(tx, address) {
    if (!tx || typeof tx.txid !== 'string' || !/^[0-9a-f]{64}$/.test(tx.txid)) return null;
    const amt = (v) => (Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null);
    let net = 0n;
    for (const o of Array.isArray(tx.vout) ? tx.vout : []) {
        if (o?.scriptpubkey_address !== address) continue;
        const v = amt(o.value); if (v == null) return null; net += v;
    }
    for (const i of Array.isArray(tx.vin) ? tx.vin : []) {
        if (i?.prevout?.scriptpubkey_address !== address) continue;
        const v = amt(i.prevout.value); if (v == null) return null; net -= v;
    }
    const fee = amt(tx.fee);
    const st = tx.status || {};
    return { txid: tx.txid, net, fee, confirmed: Boolean(st.confirmed), height: Number.isSafeInteger(st.block_height) ? st.block_height : null, time: Number.isSafeInteger(st.block_time) ? st.block_time * 1000 : null };
}

/// mempool.space history of `address` (first page: unconfirmed + newest confirmed; `afterTxid`
/// pages back through confirmed ones). { ok, txs, more, last } or { ok: false, error }.
export async function fetchExplorerHistory(network, address, { afterTxid = null, fetchImpl = (typeof fetch !== 'undefined' ? fetch : null) } = {}) {
    const base = MEMPOOL_BASE[network];
    if (!base || !fetchImpl || !/^[a-z0-9]{14,90}$/i.test(String(address || ''))) return { ok: false, error: 'Not available' };
    if (afterTxid != null && !/^[0-9a-f]{64}$/.test(afterTxid)) return { ok: false, error: 'Bad page' };
    const url = afterTxid ? `${base}/address/${address}/txs/chain/${afterTxid}` : `${base}/address/${address}/txs`;
    try {
        const res = await fetchImpl(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
        if (!res.ok) return { ok: false, error: `mempool.space answered ${res.status}` };
        const j = await res.json();
        if (!Array.isArray(j)) return { ok: false, error: 'Unexpected answer from mempool.space' };
        const txs = j.map((t) => parseExplorerTx(t, address)).filter(Boolean);
        const confirmed = txs.filter((t) => t.confirmed);
        return { ok: true, txs, more: confirmed.length >= 25, last: confirmed.length ? confirmed[confirmed.length - 1].txid : null };
    } catch (e) {
        return { ok: false, error: `Couldn't reach mempool.space (${e?.message || e})` };
    }
}
