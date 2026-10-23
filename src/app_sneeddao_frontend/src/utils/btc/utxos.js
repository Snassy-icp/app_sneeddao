// UTXOs and balance of a Bitcoin address from the IC Bitcoin canister's free query endpoints
// (spec/sneed_wallet.md §5.2 steps 2-3). Parsing and the balance summary are pure and tested
// (test/canisters/tests/btc-native.test.js); fetching takes an actor with bitcoinCanisterIdl.
//
//   confirmations = tip_height − height + 1
//   confirmed     = Σ UTXOs with ≥ minConfirmations (default 1) not locked by a pending send
//   pending       = Σ UTXOs below that (the Bitcoin canister only reports mined outputs, so with the
//                   default this is normally 0; mempool incoming needs an explorer, opt-in, A4)
//   locked        = Σ UTXOs that a pending send spends (A2 passes the outpoints; empty in A1)
//
// Txids: the canister returns the txid bytes in internal order; explorers show them reversed.

/// Display hex of a txid blob (reversed byte order, as explorers and the ckBTC minter show it).
export const txidHex = (bytes) => Array.from(bytes).reverse().map((b) => b.toString(16).padStart(2, '0')).join('');

/// "txid:vout" (display order): the key for a UTXO everywhere (locks, history).
export const outpointKey = (u) => `${u.txid}:${u.vout}`;

/// The candid network variant.
export const networkVariant = (network) => {
    if (network !== 'mainnet' && network !== 'testnet' && network !== 'regtest') throw new Error(`Unknown Bitcoin network: ${network}`);
    return { [network]: null };
};

/// A canister UTXO as { txid, vout, value (bigint sats), height, confirmations }.
export function parseUtxo(raw, tipHeight) {
    const height = Number(raw.height);
    const tip = Number(tipHeight);
    return {
        txid: txidHex(raw.outpoint.txid),
        vout: Number(raw.outpoint.vout),
        value: BigInt(raw.value),
        height,
        confirmations: height > tip ? 0 : tip - height + 1,
    };
}

/// Merge pages: the UTXOs of every page parsed against the last page's tip, de-duplicated by outpoint.
export function parseUtxoPages(pages) {
    if (!pages.length) return { utxos: [], tipHeight: 0, tipHash: '' };
    const last = pages[pages.length - 1];
    const tipHeight = Number(last.tip_height);
    const seen = new Set();
    const utxos = [];
    for (const page of pages) {
        for (const raw of page.utxos) {
            const u = parseUtxo(raw, tipHeight);
            const k = outpointKey(u);
            if (seen.has(k)) continue;
            seen.add(k);
            utxos.push(u);
        }
    }
    // newest first, then by outpoint, so the list is stable between refreshes
    utxos.sort((a, b) => (b.height - a.height) || (a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : a.vout - b.vout));
    return { utxos, tipHeight, tipHash: txidHex(last.tip_block_hash) };
}

/// { confirmed, pending, locked, total, count, settling } in sats (bigint). `settling` = confirmed
/// sats with fewer than `settledAt` confirmations (default 6), for the Advanced view.
export function summarizeUtxos(utxos, { minConfirmations = 1, locked = new Set(), settledAt = 6 } = {}) {
    let confirmed = 0n; let pending = 0n; let lockedSats = 0n; let settling = 0n;
    for (const u of utxos) {
        if (locked.has(outpointKey(u))) { lockedSats += u.value; continue; }
        if (u.confirmations >= minConfirmations) {
            confirmed += u.value;
            if (u.confirmations < settledAt) settling += u.value;
        } else pending += u.value;
    }
    return { confirmed, pending, locked: lockedSats, total: confirmed + pending + lockedSats, count: utxos.length, settling };
}

export const MAX_PAGES = 50;

/// Every UTXO of `address`, paging until next_page = null. If the tip moves while paging, start
/// over once so all pages describe one chain state.
export async function fetchUtxos(actor, { network, address, maxPages = MAX_PAGES }) {
    for (let attempt = 0; attempt < 2; attempt++) {
        const pages = [];
        let filter = [];
        let moved = false;
        for (let i = 0; i < maxPages; i++) {
            const page = await actor.bitcoin_get_utxos_query({ network: networkVariant(network), address, filter });
            if (pages.length && Number(page.tip_height) !== Number(pages[0].tip_height)) { moved = true; break; }
            pages.push(page);
            const next = page.next_page?.[0];
            if (!next) return { ...parseUtxoPages(pages), pages: pages.length, complete: true };
            filter = [{ page: next }];
        }
        if (!moved) return { ...parseUtxoPages(pages), pages: pages.length, complete: false };
    }
    throw new Error('The Bitcoin chain moved while reading; try again');
}

/// The canister's own balance query (a cross-check for the UTXO sum; also free).
export async function fetchBalance(actor, { network, address, minConfirmations = null }) {
    return BigInt(await actor.bitcoin_get_balance_query({ network: networkVariant(network), address, min_confirmations: minConfirmations == null ? [] : [minConfirmations] }));
}

/// UTXOs, the summary, and the canister's balance; `mismatch` when the two disagree.
export async function readAddress(actor, { network, address, minConfirmations = 1, locked = new Set() }) {
    const [u, balance] = await Promise.all([fetchUtxos(actor, { network, address }), fetchBalance(actor, { network, address, minConfirmations }).catch(() => null)]);
    const summary = summarizeUtxos(u.utxos, { minConfirmations, locked });
    const confirmedAll = summary.confirmed + u.utxos.filter((x) => locked.has(outpointKey(x)) && x.confirmations >= minConfirmations).reduce((t, x) => t + x.value, 0n);
    return { ...u, summary, canisterBalance: balance, mismatch: u.complete && balance != null && balance !== confirmedAll };
}
